// NULLPUNKT — Klangbank (Owner: audio): fertige AudioBuffer + priorisierte Render-Warteschlange.
// Die Synthese läuft in Modul-Workern (synth.worker.js, übertragbare Puffer); der Hauptthread kopiert
// Ergebnisse nur noch in AudioBuffer. Ohne Worker-Unterstützung rendert der Hauptthread in Leerlauf-
// Häppchen. Schlüssel: `${name}#${variante}@${abtastrate}` – die Abtastrate ist je Eintrag fest, daher kann
// schon vor dem AudioContext (Lobby, noch keine Nutzergeste) vorgerendert werden.
import { renderEntry, renderSteps } from './render.js';

/** Prioritäten der Warteschlange (höher = früher; bei Gleichstand erst Variante 0 aller Klänge). */
export const PRIO = { urgent: 100, ui: 90, loadout: 85, music: 82, core: 80, amb: 60, t1: 50, t2: 40, lazy: 20 };

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const HAS_CTOR = (() => {
  try { return typeof AudioBuffer === 'function' && new AudioBuffer({ length: 1, sampleRate: 16000 }).length === 1; } catch { return false; }
})();
const idle = typeof requestIdleCallback === 'function'
  ? (fn) => requestIdleCallback(fn, { timeout: 250 })
  : (fn) => setTimeout(() => fn(null), 32);
const PER_WORKER = 2;      // Aufträge je Worker gleichzeitig (Pipeline, falls der Hauptthread kurz blockiert)
const IDLE_CLOSE = 4000;   // ms ohne Arbeit → Worker beenden (Speicher frei)
const CHUNK = 32768;       // Samples je Kopierschritt großer Puffer (Musik/Atmo: nie ein langer Block im Hauptthread)
const STORE_BUDGET = 2;    // ms Kopierzeit je Takt

export const nameOfKey = (key) => key.slice(0, key.indexOf('#'));

function allocBuffer(channels, length, sr, ctx) {
  if (HAS_CTOR) return new AudioBuffer({ length, numberOfChannels: channels, sampleRate: sr });
  return ctx ? ctx.createBuffer(channels, length, sr) : null;
}
function copyInto(b, src, ch, from = 0, to = src.length) {
  const part = from === 0 && to === src.length ? src : src.subarray(from, to);
  if (b.copyToChannel) b.copyToChannel(part, ch, from); else b.getChannelData(ch).set(part, from);
}

/** Float32-Kanäle → AudioBuffer (ohne Kontext, falls der Konstruktor existiert). */
export function makeBuffer(chs, sr, ctx = null) {
  const list = Array.isArray(chs) ? chs : [chs];
  const b = allocBuffer(list.length, list[0].length, sr, ctx);
  if (!b) return null;
  for (let i = 0; i < list.length; i++) copyInto(b, list[i], i);
  return b;
}

class SoundBank {
  constructor() {
    this.buffers = new Map();   // key → AudioBuffer
    this.raw = new Map();       // key → { chs, sr } (nur alte Browser ohne AudioBuffer-Konstruktor, bis ein Kontext da ist)
    this.jobs = new Map();      // key → { key, name, v, sr, prio, seq, running, cancelled, worker, it }
    this.failed = new Set();
    this.waiters = [];
    this.pool = null; this.poolBroken = false; this.respawns = 0;
    this.ctx = null; this.seq = 0;
    this.storeQ = []; this._storeT = 0;   // große Ergebnisse: stückweise in den AudioBuffer kopieren
    this._sched = false; this._pumping = false; this._closeT = 0;
    this.stats = { rendered: 0, workerMs: 0, mainMs: 0, maxMainMs: 0, bytes: 0, released: 0, errors: 0, lastError: null, workers: 0, mode: 'worker' };
  }

  key(name, v, sr) { return `${name}#${v}@${sr}`; }
  has(key) { return this.buffers.has(key); }
  get(key) { return this.buffers.get(key) || null; }
  pending(key) { const j = this.jobs.get(key); return !!j && !j.cancelled; }
  get queued() { let n = 0; for (const j of this.jobs.values()) if (!j.cancelled) n++; return n; }
  get idle() { return this.queued === 0; }
  get bytes() { return this.stats.bytes; }
  _settled(k) { return this.buffers.has(k) || this.raw.has(k) || this.failed.has(k) || !this.pending(k); }

  /** Kontext für alte Browser (createBuffer); wandelt bis dahin zurückgehaltene Rohdaten um. */
  setContext(ctx) {
    if (!ctx || this.ctx === ctx) return;
    this.ctx = ctx;
    for (const [k, r] of this.raw) this._store(k, r.chs, r.sr);
    this.raw.clear();
    this._notify();
  }

  /** Klang anfordern (oder Priorität anheben). Gibt den Schlüssel zurück. */
  request(name, v, sr, prio = PRIO.t2) {
    const key = this.key(name, v, sr);
    if (this.buffers.has(key) || this.raw.has(key) || this.failed.has(key)) return key;
    const j = this.jobs.get(key);
    if (j) {
      if (j.cancelled) { j.cancelled = false; j.prio = prio; } else if (prio > j.prio) j.prio = prio;
      if (!j.running) this._schedule();
      return key;
    }
    this.jobs.set(key, { key, name, v, sr, prio, seq: this.seq++, running: false, cancelled: false, worker: null, it: null });
    this._schedule();
    return key;
  }

  /** Wartende Aufträge verwerfen (laufende werden beim Eintreffen ignoriert). pred(name, key) */
  cancel(pred) {
    for (const [k, j] of this.jobs) {
      if (j.cancelled || !pred(j.name, k)) continue;
      if (j.running) j.cancelled = true; else this.jobs.delete(k);
    }
    this._notify();
  }

  /** Fertige Puffer freigeben (Speicher) und passende Aufträge verwerfen. pred(name, key) */
  release(pred) {
    for (const [k, b] of this.buffers) {
      if (!pred(nameOfKey(k), k)) continue;
      this.buffers.delete(k); this.stats.bytes -= b.length * b.numberOfChannels * 4; this.stats.released++;
    }
    for (const k of [...this.raw.keys()]) if (pred(nameOfKey(k), k)) this.raw.delete(k);
    this.cancel(pred);
  }

  /** Synchron im Hauptthread rendern (nur Offline-Messung und winzige Menüklänge außerhalb des Spiels). */
  renderNow(name, v, sr) {
    const key = this.key(name, v, sr);
    if (this.buffers.has(key)) return this.buffers.get(key);
    const t0 = clock();
    try {
      const b = makeBuffer(renderEntry(name, v, sr), sr, this.ctx);
      if (b) this._publish(key, b);
    } catch (err) { this._fail(key, err); }
    this._mainTime(clock() - t0);
    const j = this.jobs.get(key);
    if (j) { if (j.running) j.cancelled = true; else this.jobs.delete(key); }
    this._notify();
    return this.buffers.get(key) || null;
  }

  /** fn(ok) sobald alle Schlüssel fertig (oder verworfen/fehlgeschlagen) sind; optional mit Zeitlimit (ms). */
  whenReady(keys, fn, timeoutMs = 0) {
    if (keys.every((k) => this._settled(k))) { fn(keys.every((k) => this.buffers.has(k) || this.raw.has(k))); return; }
    const w = { keys, fn, timer: 0 };
    if (timeoutMs > 0) w.timer = setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); fn(false); }, timeoutMs);
    this.waiters.push(w);
  }

  _notify() {
    if (!this.waiters.length) return;
    const due = [];
    this.waiters = this.waiters.filter((w) => {
      if (!w.keys.every((k) => this._settled(k))) return true;
      due.push(w); return false;
    });
    for (const w of due) {
      clearTimeout(w.timer);
      try { w.fn(w.keys.every((k) => this.buffers.has(k) || this.raw.has(k))); } catch (err) { this._error(err); }
    }
  }

  _store(key, chs, sr) {
    const t0 = clock();
    const b = makeBuffer(chs, sr, this.ctx);
    if (!b) { this.raw.set(key, { chs, sr }); return; }
    this._publish(key, b);
    this._mainTime(clock() - t0);
  }

  _publish(key, b) {
    const old = this.buffers.get(key);
    if (old) this.stats.bytes -= old.length * old.numberOfChannels * 4;
    this.buffers.set(key, b);
    this.stats.rendered++; this.stats.bytes += b.length * b.numberOfChannels * 4;
  }

  /** Worker-Ergebnis übernehmen: kleine Puffer sofort, große stückweise über mehrere Takte. */
  _accept(j, chs) {
    if (chs[0].length <= CHUNK || (!HAS_CTOR && !this.ctx)) {
      this.jobs.delete(j.key);
      this._store(j.key, chs, j.sr);
      return;
    }
    j.worker = 'store';
    this.storeQ.push({ j, chs, b: null, ch: 0, off: 0 });
    this._pumpStore();
  }

  _pumpStore() {
    if (this._storeT || !this.storeQ.length) return;
    this._storeT = setTimeout(() => {
      this._storeT = 0;
      const t0 = clock();
      while (this.storeQ.length && clock() - t0 < STORE_BUDGET) {
        const it = this.storeQ[0], { j, chs } = it;
        if (j.cancelled || this.jobs.get(j.key) !== j) { this.storeQ.shift(); if (this.jobs.get(j.key) === j) this.jobs.delete(j.key); continue; }
        if (!it.b) it.b = allocBuffer(chs.length, chs[0].length, j.sr, this.ctx);
        const end = Math.min(chs[it.ch].length, it.off + CHUNK);
        copyInto(it.b, chs[it.ch], it.ch, it.off, end);
        it.off = end;
        if (it.off >= chs[it.ch].length) { it.ch++; it.off = 0; }
        if (it.ch >= chs.length) { this.storeQ.shift(); this.jobs.delete(j.key); this._publish(j.key, it.b); }
      }
      this._mainTime(clock() - t0);
      this._notify();
      this._pumpStore();
    }, 0);
  }

  _mainTime(ms) { this.stats.mainMs += ms; if (ms > this.stats.maxMainMs) this.stats.maxMainMs = ms; }
  _error(err) { this.stats.errors++; this.stats.lastError = String((err && err.stack) || err); }
  _fail(key, err) { this.failed.add(key); this._error(err); }

  // ---------------------------------------------------------------- Verteilung

  _schedule() {
    if (this._sched) return;
    this._sched = true;
    queueMicrotask(() => { this._sched = false; this._dispatch(); });
  }

  /** Bester wartender Auftrag: Priorität, dann Variante (0 zuerst), dann Reihenfolge. */
  _next() {
    let best = null;
    for (const j of this.jobs.values()) {
      if (j.running || j.cancelled) continue;
      if (!best || j.prio > best.prio || (j.prio === best.prio && (j.v < best.v || (j.v === best.v && j.seq < best.seq)))) best = j;
    }
    return best;
  }

  _dispatch() {
    clearTimeout(this._closeT);
    if (!this.queued) { this._armClose(); return; }
    if (!this._ensurePool()) { this._pumpMain(); return; }
    for (const w of this.pool) {
      while (w.inflight.size < PER_WORKER) {
        const j = this._next(); if (!j) return;
        j.running = true; j.worker = w; w.inflight.add(j.key);
        try { w.postMessage({ key: j.key, name: j.name, v: j.v, sr: j.sr }); } catch (err) { this._poolFailed(err); return; }
      }
    }
  }

  _ensurePool() {
    if (this.pool) return true;
    if (this.poolBroken) return false;
    try {
      if (typeof Worker === 'undefined') throw new Error('Keine Web Worker');
      const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
      const n = Math.max(1, Math.min(2, hc - 2));
      const url = new URL('./synth.worker.js', import.meta.url);
      this.pool = [];
      for (let i = 0; i < n; i++) {
        const w = new Worker(url, { type: 'module', name: 'nullpunkt-audio' });
        w.inflight = new Set();
        w.onmessage = (e) => this._onMessage(w, e.data || {});
        w.onerror = (e) => { e?.preventDefault?.(); this._poolFailed(e?.message || 'Worker-Fehler'); };
        w.onmessageerror = () => this._poolFailed('Nachricht nicht lesbar');
        this.pool.push(w);
      }
      this.stats.workers = n; this.stats.mode = 'worker';
      return true;
    } catch (err) {
      this._poolFailed(err);
      return false;
    }
  }

  _onMessage(w, d) {
    if (!d.key) return;
    w.inflight.delete(d.key);
    const j = this.jobs.get(d.key), mine = !!j && j.worker === w;
    if (d.error) { if (mine) this.jobs.delete(d.key); this._fail(d.key, d.error); }
    else if (mine && !j.cancelled && !this.buffers.has(d.key)) { this.stats.workerMs += d.ms || 0; this._accept(j, d.chs); }
    else if (mine) this.jobs.delete(d.key);
    this._notify();
    this._dispatch();
  }

  /** Worker nicht nutzbar (z. B. ohne Modul-Worker-Unterstützung): Aufträge zurück in die Warteschlange. */
  _poolFailed(err) {
    const hadResults = this.stats.workerMs > 0;
    this._terminate();
    for (const j of this.jobs.values()) {
      if (!j.running || j.worker === 'store') continue;
      j.running = false; j.worker = null;
      if (j.cancelled) this.jobs.delete(j.key);
    }
    this._error(err);
    // Lief der Pool schon (Laufzeitfehler, z. B. Speicher), einmal neu starten; sonst Hauptthread
    if (!(hadResults && this.respawns++ < 2)) { this.poolBroken = true; this.stats.mode = 'main'; this.stats.workers = 0; }
    this._notify();
    this._schedule();
  }

  _terminate() {
    if (!this.pool) return;
    for (const w of this.pool) { try { w.terminate(); } catch { /* bereits beendet */ } }
    this.pool = null;
  }

  _armClose() {
    if (!this.pool) return;
    this._closeT = setTimeout(() => {
      if (this.queued || !this.pool || this.pool.some((w) => w.inflight.size)) return;
      this._terminate();
    }, IDLE_CLOSE);
  }

  // ---------------------------------------------------------------- Rückfall: Hauptthread

  _pumpMain() {
    if (this._pumping) return;
    this._pumping = true;
    idle((deadline) => { this._pumping = false; this._sliceMain(deadline); });
  }

  _sliceMain(deadline) {
    const t0 = clock(), budget = Math.min(10, Math.max(3, deadline?.timeRemaining?.() ?? 4));
    let job = null;
    while (clock() - t0 < budget) {
      job = [...this.jobs.values()].find((j) => j.running && !j.worker) || this._next();
      if (!job) break;
      if (job.cancelled) { this.jobs.delete(job.key); continue; }
      job.running = true;
      try {
        if (!job.it) job.it = renderSteps(job.name, job.v, job.sr);
        const r = job.it.next();
        if (r.done) { this.jobs.delete(job.key); this._store(job.key, r.value, job.sr); }
      } catch (err) { this.jobs.delete(job.key); this._fail(job.key, err); }
    }
    this._mainTime(clock() - t0);
    this._notify();
    if (this.queued) this._pumpMain();
  }

  info() {
    return { ...this.stats, buffers: this.buffers.size, queued: this.queued, MB: +(this.stats.bytes / 1048576).toFixed(2) };
  }
}

/** Gemeinsame Bank aller Engines einer Seite (Puffer sind kontextunabhängig). */
export const bank = new SoundBank();
