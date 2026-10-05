// NULLPUNKT — Aufnahme-Bibliothek (Owner: audio): CC0-Aufnahmen aus assets/lib/audio (Manifest + MP3).
// Lädt nur, was gebraucht wird (Ausrüstung, Karte, Bots), priorisiert und gedrosselt; dekodiert in einem
// OfflineAudioContext mit Ziel-Abtastrate je Qualitätsstufe (kein AudioContext/keine Nutzergeste nötig →
// schon in der Lobby). Dekodieren läuft im Browser abseits des Hauptthreads; der Hauptthread prüft nur die
// führende Stille (≤ 50 ms) und mischt bei Stufe „low“ auf Mono (in Häppchen). MP3 = auf iOS sicher.
// Speichergrenze je Stufe mit LRU-Freigabe nicht angehefteter Klänge. Fehlt die Bibliothek (404, offline),
// bleibt die prozedurale Engine allein aktiv – nie stumm.
import { PRIO } from './bank.js';

export const LIB_URL = new URL('../../../../lib/audio/', import.meta.url);

/**
 * Qualitätsstufen (Plan §10 A9): Varianten je Lage, Dekodier-Abtastrate, Kanäle, Speichergrenze (MB, nur Aufnahmen),
 * gleichzeitige Ladeaufträge. `group` überschreibt `maxVar` je Manifest-Gruppe (Schritte brauchen Abwechslung).
 */
export const SAMPLE_TIERS = {
  high: { label: 'Hoch', maxVar: { near: 4, far: 2, tail: 2, oneshot: 4, mech: 1, bed: 1 }, group: {}, rate: {}, ch: {}, capMB: 44, concurrency: 3 },
  medium: { label: 'Mittel', maxVar: { near: 3, far: 2, tail: 1, oneshot: 3, mech: 1, bed: 1 }, group: { step: 4 }, rate: { near: 32000, oneshot: 32000, tail: 24000, bed: 22050 }, ch: { tail: 1 }, capMB: 26, concurrency: 2 },
  low: { label: 'Niedrig', maxVar: { near: 2, far: 1, tail: 1, oneshot: 2, mech: 0, bed: 1 }, group: { step: 3, impact: 2 }, rate: { near: 32000, far: 22050, tail: 22050, oneshot: 32000, mech: 32000, bed: 16000 }, ch: { near: 1, far: 1, tail: 1, oneshot: 1, mech: 1, bed: 1 }, capMB: 13, concurrency: 1 },
};
export const tierFor = (q) => (q === 'low' ? 'low' : q === 'medium' ? 'medium' : 'high');

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const OAC = typeof window !== 'undefined' ? (window.OfflineAudioContext || window.webkitOfflineAudioContext) : (typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null);
const HAS_CTOR = (() => { try { return typeof AudioBuffer === 'function' && new AudioBuffer({ length: 1, sampleRate: 16000 }).length === 1; } catch { return false; } })();
const yieldTask = () => new Promise((r) => setTimeout(r, 0));
const LEAD_MAX = 0.05;        // s: höchstens so viel führende Stille abschneiden (Decoder-Polster)
const MIX_CHUNK = 131072;     // Samples je Häppchen beim Abmischen auf Mono

/** decodeAudioData in Promise- und Callback-Form (ältere Safari kennen nur Callbacks). */
function decodeWith(ctx, ab) {
  return new Promise((resolve, reject) => {
    let done = false;
    const ok = (b) => { if (!done) { done = true; resolve(b); } };
    const ko = (e) => { if (!done) { done = true; reject(e || new Error('Dekodieren fehlgeschlagen')); } };
    try {
      const p = ctx.decodeAudioData(ab, ok, ko);
      if (p && typeof p.then === 'function') p.then(ok, ko);
    } catch (err) { ko(err); }
  });
}

class SampleLibrary {
  constructor() {
    this.enabled = true;
    this.tierId = null; this.tier = null;
    this.man = null; this.unavailable = null; this._manP = null;
    this.buffers = new Map();   // name → [{ buffer, offset, v, bytes }] (Varianten in Ladereihenfolge)
    this.jobs = new Map();      // `${name}#${v}` → { name, v, prio, seq, running }
    this.failed = new Set();
    this.used = new Map();      // name → letzte Nutzung (ms) für LRU
    this.pins = new Set();
    this.waiters = [];
    this.running = 0; this.seq = 0;
    this.ctx = null;            // Live-Kontext als letzter Dekodier-Rückfall
    this.decoders = new Map();
    this.listeners = new Set(); // fn(name) wenn ein Klang (erste Variante) bereitsteht
    this.stats = { files: 0, bytesDl: 0, bytes: 0, decodeMs: 0, mainMs: 0, maxMainMs: 0, errors: 0, lastError: null, evicted: 0, decodeMode: 'offline' };
  }

  /** Stufe festlegen (einmal je Seite; Puffer hängen an Rate/Kanälen). */
  configure({ quality, enabled } = {}) {
    if (enabled != null) this.enabled = !!enabled;
    if (quality && !this.tierId) { this.tierId = tierFor(quality); this.tier = SAMPLE_TIERS[this.tierId]; }
  }
  setContext(ctx) { if (ctx && !this.ctx) this.ctx = ctx; }
  onLoaded(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get ready() { return !!this.man; }
  get capBytes() { return (this.tier?.capMB || 40) * 1048576; }

  /** Manifest einmal laden (Promise → true/false). */
  manifest() {
    if (this.man) return Promise.resolve(true);
    if (this.unavailable) return Promise.resolve(false);
    if (!this._manP) {
      if (typeof fetch !== 'function' || !OAC) { this.unavailable = 'keine Fetch-/WebAudio-Unterstützung'; return Promise.resolve(false); }
      this._manP = fetch(new URL('manifest.json', LIB_URL), { cache: 'no-cache' })
        .then((r) => { if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`); return r.json(); })
        .then((m) => { if (!m || !m.sounds) throw new Error('manifest.json ohne sounds'); this.man = m; this._pump(); this._notify(); return true; })
        .catch((err) => { this.unavailable = String(err?.message || err); this._notify(); return false; });
    }
    return this._manP;
  }

  entry(name) { return this.man?.sounds?.[name] || null; }
  /** Klang existiert in der Bibliothek (Manifest geladen) und ist in dieser Stufe vorgesehen. */
  known(name) { const s = this.entry(name); return !!s && this._maxVar(s) > 0; }
  /** Anzahl geladener Varianten. */
  count(name) { return this.buffers.get(name)?.length || 0; }
  has(name) { return this.enabled && this.count(name) > 0; }
  pending(name) { for (const j of this.jobs.values()) if (j.name === name) return true; return false; }

  _maxVar(s) {
    const t = this.tier || SAMPLE_TIERS.high;
    const g = t.group[s.group], l = t.maxVar[s.layer];
    return Math.min(s.variants.length, g ?? l ?? 4);
  }
  _rate(s) { const t = this.tier || SAMPLE_TIERS.high; return Math.min(s.rate, t.rate[s.layer] ?? s.rate); }
  _ch(s) { const t = this.tier || SAMPLE_TIERS.high; return Math.min(s.ch, t.ch[s.layer] ?? s.ch); }
  /** Geschätzter Speicher eines Klangs in dieser Stufe (Bytes, Float32). */
  estimate(name) {
    const s = this.entry(name); if (!s) return 0;
    return s.variants.slice(0, this._maxVar(s)).reduce((a, v) => a + v.dur * this._rate(s) * this._ch(s) * 4, 0);
  }

  /** Variante v (Index in der Ladereihenfolge) → { buffer, offset, v } */
  get(name, i = 0) {
    const list = this.buffers.get(name); if (!list?.length) return null;
    this.used.set(name, clock());
    return list[((i % list.length) + list.length) % list.length];
  }

  /** Alle Varianten der Namen anfordern (Priorität anheben, falls schon in der Warteschlange). */
  request(names, prio = PRIO.t2) {
    if (!this.enabled) return;
    for (const name of names) {
      if (!name) continue;
      if (!this.man) { (this._early || (this._early = new Map())).set(name, Math.max(prio, this._early?.get(name) || 0)); continue; }
      const s = this.entry(name); if (!s) continue;
      const n = this._maxVar(s), have = this.buffers.get(name) || [];
      for (let i = 0; i < n; i++) {
        const v = s.variants[i].v, k = `${name}#${v}`;
        if (have.some((x) => x.v === v) || this.failed.has(k)) continue;
        const j = this.jobs.get(k);
        // Variante 0 eines Klangs zuerst (wie die Klangbank): weitere Varianten etwas tiefer einsortiert
        const p = prio - (i ? 4 : 0);
        if (j) { if (p > j.prio) j.prio = p; } else this.jobs.set(k, { name, v, idx: i, prio: p, seq: this.seq++, running: false });
      }
    }
    this.manifest().then(() => this._pump());
  }

  /** Wartende Aufträge verwerfen (laufende werden beim Eintreffen verworfen). */
  cancel(pred) {
    for (const [k, j] of this.jobs) if (!j.running && pred(j.name)) this.jobs.delete(k);
    if (this._early) for (const n of [...this._early.keys()]) if (pred(n)) this._early.delete(n);
    this._notify();
  }

  /** Geladene Klänge freigeben. pred(name) */
  release(pred) {
    for (const [name, list] of [...this.buffers]) {
      if (!pred(name)) continue;
      for (const x of list) this.stats.bytes -= x.bytes;
      this.buffers.delete(name); this.used.delete(name); this.stats.evicted += list.length;
    }
    this.cancel(pred);
  }

  /** Anheften: diese Namen werden von der Speichergrenze nie verdrängt (aktuelle Ausrüstung, Karte, Kern). */
  pin(names, replace = false) { if (replace) this.pins.clear(); for (const n of names) if (n) this.pins.add(n); }

  /** fn(ok) sobald alle Namen mindestens eine Variante haben (oder endgültig fehlen); optional Zeitlimit. */
  whenReady(names, fn, timeoutMs = 0) {
    const w = { names, fn, timer: 0 };
    if (this._settled(w)) { fn(this._ok(w)); return; }
    if (timeoutMs > 0) w.timer = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); fn(this._ok(w)); }, timeoutMs);
    this.waiters.push(w);
  }
  _ok(w) { return w.names.every((n) => this.count(n) > 0); }
  _settled(w) {
    if (this.unavailable || !this.enabled) return true;
    if (!this.man) return false;
    return w.names.every((n) => this.count(n) > 0 || !this.entry(n) || (!this.pending(n) && !this._early?.has(n)));
  }
  _notify() {
    if (!this.waiters.length) return;
    const due = [];
    this.waiters = this.waiters.filter((w) => { if (!this._settled(w)) return true; due.push(w); return false; });
    for (const w of due) { clearTimeout(w.timer); try { w.fn(this._ok(w)); } catch (err) { this._error(err); } }
  }

  get queued() { let n = 0; for (const j of this.jobs.values()) if (!j.running) n++; return n + this.running + (this._early?.size || 0); }
  get idle() { return !this.enabled || !!this.unavailable || (!!this.man && this.queued === 0); }

  // ---------------------------------------------------------------- Laden

  _decoder(rate) {
    if (this.decoders.has(rate)) return this.decoders.get(rate);
    let d = null;
    for (const r of [rate, 44100]) {
      try { d = new OAC(1, 1, r); break; } catch { /* Rate nicht unterstützt (ältere Safari) */ }
    }
    if (!d && this.ctx) { d = this.ctx; this.stats.decodeMode = 'live'; }
    this.decoders.set(rate, d);
    return d;
  }

  _next() {
    let best = null;
    for (const j of this.jobs.values()) {
      if (j.running) continue;
      if (!best || j.prio > best.prio || (j.prio === best.prio && (j.idx < best.idx || (j.idx === best.idx && j.seq < best.seq)))) best = j;
    }
    return best;
  }

  _pump() {
    if (!this.man || !this.enabled) return;
    if (this._early) { const e = this._early; this._early = null; for (const [n, p] of e) this.request([n], p); }
    const limit = this.tier?.concurrency || 2;
    // Während des Spiels höchstens ein Auftrag gleichzeitig (Netz/Dekoder teilen sich das Gerät mit dem Spiel)
    const cap = this.inPlay ? 1 : limit;
    while (this.running < cap) {
      const j = this._next(); if (!j) break;
      j.running = true; this.running++;
      this._load(j).finally(() => {
        this.running--; this.jobs.delete(`${j.name}#${j.v}`);
        this._notify();
        this._pump();
      });
    }
    this._notify();
  }

  async _load(j) {
    const s = this.entry(j.name), meta = s?.variants.find((x) => x.v === j.v);
    if (!s || !meta) return;
    const key = `${j.name}#${j.v}`;
    try {
      const rate = this._rate(s), wantCh = this._ch(s);
      const need = meta.dur * rate * wantCh * 4;
      if (!this._room(need, j)) { this.stats.skipped = (this.stats.skipped || 0) + 1; return; } // Speichergrenze: später erneut anfordern
      const res = await fetch(new URL(meta.file, LIB_URL));
      if (!res.ok) throw new Error(`${meta.file}: HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      this.stats.bytesDl += ab.byteLength; this.stats.files++;
      if (!this.enabled) return;
      const dec = this._decoder(rate);
      if (!dec) throw new Error('kein Dekoder');
      const t0 = clock();
      let buf = await decodeWith(dec, ab);
      this.stats.decodeMs += clock() - t0;
      if (wantCh === 1 && buf.numberOfChannels > 1) buf = await this._mono(buf, dec);
      const t1 = clock();
      const offset = this._lead(buf, meta.peakDb);
      const bytes = buf.length * buf.numberOfChannels * 4;
      const list = this.buffers.get(j.name) || [];
      if (!list.some((x) => x.v === j.v)) {
        list.push({ buffer: buf, offset, v: j.v, bytes, idx: j.idx });
        list.sort((a, b) => a.idx - b.idx);
        this.buffers.set(j.name, list);
        this.stats.bytes += bytes;
        if (!this.used.has(j.name)) this.used.set(j.name, clock());
      }
      this._main(clock() - t1);
      if (list.length === 1) for (const fn of this.listeners) { try { fn(j.name); } catch (err) { this._error(err); } }
    } catch (err) {
      this.failed.add(key); this._error(err);
    }
  }

  /** Platz schaffen: LRU-Freigabe nicht angehefteter, seit ≥ 20 s ungenutzter Klänge. */
  _room(need, j) {
    const cap = this.capBytes;
    if (this.stats.bytes + need <= cap) return true;
    const now = clock();
    const cand = [...this.buffers.keys()].filter((n) => !this.pins.has(n) && n !== j.name && now - (this.used.get(n) || 0) > 20000)
      .sort((a, b) => (this.used.get(a) || 0) - (this.used.get(b) || 0));
    for (const n of cand) {
      if (this.stats.bytes + need <= cap) break;
      this.release((x) => x === n);
    }
    if (this.stats.bytes + need <= cap) return true;
    // Erste Variante angehefteter Klänge immer (sonst wäre der Klang ganz weg), weitere nur mit Platz
    return this.pins.has(j.name) && j.idx === 0;
  }

  /** Führende Stille unter −60 dB (relativ zur Spitze laut Manifest), höchstens 50 ms → Startversatz (s). */
  _lead(buf, peakDb) {
    const thr = Math.pow(10, ((peakDb ?? -1.5) - 60) / 20), max = Math.min(buf.length, Math.floor(buf.sampleRate * LEAD_MAX));
    let i0 = max;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const x = buf.getChannelData(c); let i = 0;
      while (i < i0 && Math.abs(x[i]) < thr) i++;
      i0 = Math.min(i0, i);
    }
    return i0 >= 8 && i0 < max ? i0 / buf.sampleRate : 0;
  }

  /** Stereo → Mono (Mittelwert), in Häppchen über mehrere Aufgaben (lange Atmo-Betten). */
  async _mono(buf, dec) {
    const n = buf.length, sr = buf.sampleRate;
    const out = HAS_CTOR ? new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr }) : dec.createBuffer(1, n, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1), m = new Float32Array(n);
    for (let i0 = 0; i0 < n; i0 += MIX_CHUNK) {
      const t = clock(), i1 = Math.min(n, i0 + MIX_CHUNK);
      for (let i = i0; i < i1; i++) m[i] = (L[i] + R[i]) * 0.5;
      this._main(clock() - t);
      if (i1 < n) await yieldTask();
    }
    if (out.copyToChannel) out.copyToChannel(m, 0); else out.getChannelData(0).set(m);
    return out;
  }

  _main(ms) { this.stats.mainMs += ms; if (ms > this.stats.maxMainMs) this.stats.maxMainMs = ms; }
  _error(err) { this.stats.errors++; this.stats.lastError = String(err?.message || err); }

  info() {
    let sounds = 0, variants = 0;
    for (const l of this.buffers.values()) { sounds++; variants += l.length; }
    return {
      enabled: this.enabled, tier: this.tierId, available: !!this.man, unavailable: this.unavailable, sounds, variants,
      MB: +(this.stats.bytes / 1048576).toFixed(2), capMB: this.tier?.capMB ?? null, downloadKB: Math.round(this.stats.bytesDl / 1024),
      queued: this.queued, running: this.running, failed: this.failed.size, pins: this.pins.size, ...this.stats,
      decodeMs: Math.round(this.stats.decodeMs), mainMs: +this.stats.mainMs.toFixed(1), maxMainMs: +this.stats.maxMainMs.toFixed(2),
    };
  }
}

/** Gemeinsame Bibliothek aller Engines einer Seite (AudioBuffer sind kontextunabhängig). */
export const library = new SampleLibrary();
