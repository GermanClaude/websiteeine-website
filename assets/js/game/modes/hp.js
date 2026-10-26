// NULLPUNKT — Stellung (hp, 26.10., Plan M1 / modi-neu §3): Herrschaft mit genau einer aktiven Zone, die in fester
// Reihenfolge wandert (world.objectives.hp aus world/maps/modus-ziele.js; Karten ohne Daten: Herrschaftsflaggen B → A → C).
// Keine Einnahmezeit: Wer allein in der Zone steht, hält sie (pointsPerSecond Teampunkte je Sekunde); stehen beide Teams
// drin, ist sie umkämpft (keine Punkte, der Besitz bleibt stehen); steht niemand drin, ist sie neutral. preview s vor dem
// Wechsel erscheint die nächste Zone gedimmt (objectives[1], next: true) auf Karte, Minikarte und HUD.
// Persönlich: „Stellung gehalten“ je holdChunk s in der gehaltenen Zone, „Stellung eingenommen“ für den ersten des Teams,
// Abschüsse an der Zone (verteidigt/angegriffen); Medaillen Bollwerk, Stellungskämpfer, Vorhut; Zähler hpTime
// (Herausforderung, Endbildschirm, Spalte „Haltezeit“). Einstellungen (B6): Wechsel 45/60/90 s, Punkteziel 150/250/350.
// Online rechnet der Host; Clients bekommen den Zustand über netExtra (hp, hh) – keine eigene Nachricht, kein NET_VERSION.

import * as THREE from 'three';
import { modeOptionValues, parseModeOptions } from '../../shared/modes.data.js';
import { DomMode } from './dom.js';

const NOTICE_GAP = 4; // s zwischen zwei „umkämpft“-Hinweisen

export class HoldPointMode extends DomMode {
  constructor(G, modeId, opts = {}) {
    super(G, modeId, opts);
    const o = this.def.objective || {};
    this.options = modeOptionValues(modeId, this._rawOptions(G, opts));
    this.hpCfg = {
      rotate: Number(this.options.wechsel) || o.rotate || 60, preview: o.preview ?? 10, pps: o.pointsPerSecond || 1,
      chunk: o.holdChunk || 5, clear: o.spawnClear ?? 25, bulwark: o.bulwark || 30, zoneKills: o.zoneKills || 5, nextShare: o.nextShare ?? 0.34,
    };
    // Punkteziel: ausdrücklich (URL/Raum-Einstellung) vor der Modus-Option
    const explicit = Number(opts.scoreLimit ?? opts.score);
    if (!(Number.isFinite(explicit) && explicit > 0) && Number(this.options.ziel) > 0) this.scoreLimit = Number(this.options.ziel);
    this.zones = [];
    this.idx = 0;
    this.serial = 0; // Zahl der Wechsel (Netz: Abbild erkennt einen Wechsel auch bei gleicher Zone)
    this.rotLeft = this.hpCfg.rotate;
    this.preview = false;
    this.owner = null;
    this.contested = false;
    this.counts = { A: 0, B: 0 };
    this.heldTime = { A: 0, B: 0 };
    this._acc = 0;
    this._accTeam = null;
    this._hold = new Map(); // actor → { chunk, life, kills, bulwark }
    this._entered = new Map(); // actor → Zeitpunkt des Betretens der aktiven Zone
    this._firstIn = null;
    this._vanguardDone = false;
    this._contestNoteAt = -1e9;
  }

  /** Einstellungen: online vom Host (cfg.net.modeOpts), offline aus der Lobby (settings.modeOptions), Prüfwerkzeuge ?mopt=. */
  _rawOptions(G, opts) {
    if (opts && opts.modeOpts) return opts.modeOpts;
    const net = G.match && G.match.net;
    if (net) return net.modeOpts || {};
    let raw = {};
    try { raw = { ...((G.settings.get('modeOptions') || {})[this.id] || {}) }; } catch { raw = {}; }
    const url = G.params && typeof G.params.get === 'function' ? G.params.get('mopt') : null;
    return url ? { ...raw, ...parseModeOptions(url) } : raw;
  }

  /* ------------------------------------------------------------ Zonen */

  get zone() { return this.zones[this.idx] || null; }
  get nextZone() { return this.zones.length > 1 ? this.zones[(this.idx + 1) % this.zones.length] : null; }

  onStart() {
    const w = this.G.world;
    let list = w && w.objectives && Array.isArray(w.objectives.hp) ? w.objectives.hp : [];
    if (!list.length) list = fallbackZones(w);
    this.zones = list.map((z, i) => ({
      id: String(z.id ?? i + 1), name: z.name || `Stellung ${i + 1}`,
      position: z.position.clone ? z.position.clone() : new THREE.Vector3(z.position.x, z.position.y, z.position.z),
      radius: z.radius || 5, band: Array.isArray(z.band) ? z.band.slice(0, 2) : null,
    }));
    this.idx = 0;
    this.serial = 0;
    this.rotLeft = this.hpCfg.rotate;
    this.preview = false;
    this._resetZone();
    this._buildObjectives();
    this._emit(true);
  }

  onMatchStart() {
    const z = this.zone;
    if (z) this._notice(`Stellung: ${z.name} – halte sie allein.`, 'gold');
  }

  _resetZone() {
    this.owner = null;
    this.contested = false;
    this.counts = { A: 0, B: 0 };
    this._acc = 0;
    this._accTeam = null;
    this._entered.clear();
    this._firstIn = null;
    this._vanguardDone = false;
    for (const h of this._hold.values()) h.chunk = 0;
  }

  /** objectives = [aktive Zone, (nächste Zone in der Vorschau)] – dieselbe Form wie Herrschaftsflaggen (HUD, Minikarte, Bots). */
  _buildObjectives() {
    const out = [];
    const z = this.zone;
    if (z) out.push(this._obj(z, false));
    const n = this.preview ? this.nextZone : null;
    if (n && n !== z) out.push(this._obj(n, true));
    this.objectives = out;
  }

  _obj(z, next) {
    return {
      id: z.id, name: z.name, position: z.position, radius: z.radius, band: z.band, owner: null, capturingTeam: null, progress: 0, control: 0,
      contested: false, counts: { A: 0, B: 0 }, present: [], lastOwner: null, next, ring: true,
    };
  }

  /** Aktive Zone in objectives[0] an den Zustand angleichen. */
  _syncActive() {
    const f = this.objectives[0];
    if (!f) return;
    f.owner = this.owner;
    f.contested = this.contested;
    f.counts.A = this.counts.A;
    f.counts.B = this.counts.B;
    f.control = this.owner === 'A' ? 1 : this.owner === 'B' ? -1 : 0;
    f.progress = this.owner ? 1 : 0;
  }

  /* ------------------------------------------------------------ Ablauf (Host / offline) */

  tick(dt, playing) {
    if (!playing || !this.zones.length) return;
    const G = this.G;
    const C = this.hpCfg;
    let changed = false;
    // Wanderung: Vorschau, dann Wechsel
    this.rotLeft -= dt;
    if (!this.preview && this.zones.length > 1 && this.rotLeft <= C.preview) { this._showPreview(); changed = true; }
    if (this.rotLeft <= 0) { this._advance(); changed = true; }
    const f = this.objectives[0];
    if (!f) return;
    // Anwesenheit
    const now = G.time.elapsed;
    let A = 0;
    let B = 0;
    f.present.length = 0;
    for (const a of G.actors) {
      if (!a.alive || a.isStreakEntity || (a.team !== 'A' && a.team !== 'B') || !this._inZone(a, f)) { this._entered.delete(a); continue; }
      if (a.team === 'A') A++; else B++;
      f.present.push(a);
      if (!this._entered.has(a)) this._entered.set(a, now);
      if (!this._firstIn) this._firstIn = a;
    }
    const contested = A > 0 && B > 0;
    const team = !contested && (A || B) ? (A ? 'A' : 'B') : null;
    if (A !== this.counts.A || B !== this.counts.B) changed = true;
    this.counts.A = A;
    this.counts.B = B;
    if (contested !== this.contested) {
      this.contested = contested;
      changed = true;
      if (contested) this._contestNote();
    }
    // Besitz: allein drin = gehalten, niemand = neutral, beide = bleibt stehen
    if (!contested && team !== this.owner) {
      const prev = this.owner;
      this.owner = team;
      changed = true;
      this._syncActive();
      if (team) this._taken(team, prev, f);
      else this._left(prev, f);
    }
    // Punkte: 1 je Sekunde Alleinbesitz; persönlich „Stellung gehalten“
    if (this.owner && !contested) {
      const t = this.owner;
      if (this._accTeam !== t) { this._accTeam = t; this._acc = 0; }
      this._acc += dt * C.pps;
      this.heldTime[t] += dt;
      let n = 0;
      while (this._acc >= 1 - 1e-6) { this._acc -= 1; n++; } // 1e-6: Rundungsfehler der Bildzeiten aufsummiert
      for (const a of f.present) if (a.team === t) this._holdTick(a, dt);
      if (n) {
        this.scores[t] += n;
        G.events.emit('mode:tick', { scores: { ...this.scores }, held: { A: t === 'A' ? 1 : 0, B: t === 'B' ? 1 : 0 } });
        this._afterScore();
      }
    }
    this._syncActive();
    if (changed || now - this._emitAt > 1) this._emit(changed);
  }

  _holdOf(a) {
    let h = this._hold.get(a);
    if (!h) { h = { chunk: 0, life: 0, kills: 0, bulwark: false }; this._hold.set(a, h); }
    return h;
  }

  _holdTick(a, dt) {
    const C = this.hpCfg;
    const h = this._holdOf(a);
    h.chunk += dt;
    h.life += dt;
    if (a.stats) a.stats.hpTime = (a.stats.hpTime || 0) + dt;
    this.count(a, 'hpTime', dt);
    if (h.chunk >= C.chunk - 1e-6) { h.chunk -= C.chunk; this.award(a, 'hold'); }
    if (!h.bulwark && h.life >= C.bulwark - 1e-6) { h.bulwark = true; this.medals.award(a, 'bollwerk'); }
  }

  /** Team hält die Zone allein (vorher neutral, umkämpft oder beim Gegner). */
  _taken(team, prev, f) {
    // „Stellung eingenommen“: wer im Team zuerst drin war
    let first = null;
    let t0 = Infinity;
    for (const a of f.present) if (a.team === team && (this._entered.get(a) ?? Infinity) < t0) { t0 = this._entered.get(a); first = a; }
    if (first) { this.award(first, 'hpcapture'); this.count(first, 'hpCaptures'); }
    // Vorhut: der Erste in einer neuen Zone, wenn sein Team sie als Erstes hält
    if (!this._vanguardDone) {
      this._vanguardDone = true;
      const v = this._firstIn;
      if (v && v.alive && v.team === team) this.medals.award(v, 'vorhut');
    }
    this.G.events.emit('hp:taken', { mode: this, zone: this._public(f), team, prev });
    this._announceOwner(team, prev);
  }

  _left(prev, f) {
    this.G.events.emit('hp:neutral', { mode: this, zone: this._public(f), prev });
    this._announceOwner(null, prev);
  }

  _showPreview() {
    this.preview = true;
    this._buildObjectives();
    this._syncActive();
    const n = this.nextZone;
    if (n) this._notice(`Stellung wandert in ${Math.max(1, Math.ceil(this.rotLeft))} s: ${n.name}`, 'signal');
    this._refreshBots();
  }

  _advance() {
    const prev = this.zone;
    this.idx = (this.idx + 1) % this.zones.length;
    this.serial++;
    this.rotLeft = this.hpCfg.rotate;
    this.preview = false;
    this._resetZone();
    this._buildObjectives();
    const z = this.zone;
    this._notice(`Neue Stellung: ${z.name}`, 'gold');
    this.G.events.emit('hp:move', { mode: this, zone: this._public(this.objectives[0]), prev: prev ? prev.id : null, index: this.idx, serial: this.serial });
    this._refreshBots();
  }

  /** Bots fragen ihr Ziel sonst erst nach 2,5–4 s neu ab (bots/ai/brain.js objectiveFor): beim Wechsel sofort. */
  _refreshBots() {
    for (const a of this.G.actors) if (a.isBot && a._objAt != null) a._objAt = 0;
    this._assign.clear();
  }

  /* ------------------------------------------------------------ Hinweise (Host und Abbild gleich) */

  _notice(text, tone) { this.G.events.emit('mode:notice', { text, tone }); }

  _announceOwner(team, prev) {
    const p = this.G.player;
    const mine = p && (p.team === 'A' || p.team === 'B') ? p.team : null;
    const z = this.zone;
    if (!mine || !z) return;
    if (team === mine) this._notice(`Stellung ${z.name} gehalten.`, 'ally');
    else if (team) this._notice(prev === mine ? `Stellung ${z.name} verloren.` : `Der Gegner hält die Stellung.`, 'enemy');
    else if (prev === mine) this._notice('Stellung geräumt.', 'dim');
  }

  _contestNote() {
    const now = this.G.time.elapsed;
    const p = this.G.player;
    if (!p || now - this._contestNoteAt < NOTICE_GAP) return;
    this._contestNoteAt = now;
    this._notice('Stellung umkämpft.', 'signal');
  }

  /* ------------------------------------------------------------ Punkte an der Zone */

  onSpawn(actor) {
    const h = this._hold.get(actor);
    if (h) { h.life = 0; h.kills = 0; h.bulwark = false; h.chunk = 0; }
  }

  onKillScored(killer, victim) {
    const f = this.objectives[0];
    if (!f || !killer || !victim) return;
    const kIn = killer.position && this._inZone(killer, f);
    const vIn = victim.position && this._inZone(victim, f);
    if (!kIn && !vIn) return;
    this.award(killer, this.owner === killer.team ? 'hpdefend' : 'hpassault');
    const h = this._holdOf(killer);
    h.kills += 1;
    if (h.kills === this.hpCfg.zoneKills) this.medals.award(killer, 'stellungskaempfer');
  }

  /* ------------------------------------------------------------ Bots und Wiedereinstieg */

  /** Aktive Zone; in der Vorschau setzt ein fester Teil jedes Teams schon zur nächsten um. */
  objectiveFor(bot) {
    if (!bot || (bot.team !== 'A' && bot.team !== 'B') || !this.objectives.length) return null;
    const now = this.G.time.elapsed;
    let f = this.objectives[0];
    const nx = this.objectives[1];
    if (nx && nx.next && share(bot) < this.hpCfg.nextShare) f = nx;
    const cur = this._assign.get(bot);
    if (cur && cur.id === f.id && cur.serial === this.serial && now < cur.until) return { id: f.id, position: cur.point, radius: f.radius, kind: cur.kind };
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * f.radius * 0.6;
    const point = f.position.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
    // Halten heißt drinstehen: fast alle „einnehmen“ (Deckung im Kreis), ein Viertel der Halter sichert von außen
    const kind = !f.next && this.owner === bot.team && !this.contested && share(bot, 7) < 0.25 ? 'defend' : 'capture';
    this._assign.set(bot, { id: f.id, point, kind, serial: this.serial, until: now + 6 + Math.random() * 5 });
    return { id: f.id, position: point, radius: f.radius, kind };
  }

  /** Wiedereinstieg weg von der Stellung (weich) … */
  spawnAttract() {
    const z = this.zone;
    if (!z) return null;
    const out = [{ position: z.position, weight: -60 }];
    const n = this.preview ? this.nextZone : null;
    if (n) out.push({ position: n.position, weight: -25 });
    return out;
  }

  /** … und nicht näher als spawnClear m (wie eine Gefahrenzone, modes/spawns.js: Abzug im Umkreis radius + 6 m). */
  spawnAvoid() {
    const z = this.zone;
    return z ? [{ position: z.position, radius: Math.max(1, this.hpCfg.clear - 6) }] : [];
  }

  /** HUD-Einnahmebalken (ui/hud.js): Titel, Zustand, Ton, Balken = verbleibende Zeit an diesem Ort. */
  captureView(f, p) {
    const mine = p && p.team;
    const z = this.zone;
    let text;
    let tone;
    if (this.contested) { text = 'Umkämpft – keine Punkte'; tone = 'c'; }
    else if (this.owner && this.owner === mine) { text = 'Gehalten · +1 Punkt/s'; tone = 'a'; }
    else if (this.owner) { text = 'Gegner hält'; tone = 'e'; }
    else { text = 'Halten'; tone = 'n'; }
    return { title: `Stellung ${z ? z.name : f.id}`, text, tone, bar: this.hpCfg.rotate > 0 ? this.rotLeft / this.hpCfg.rotate : 0 };
  }

  /* ------------------------------------------------------------ Tabelle, Ergebnis */

  extraRow(a) {
    const t = a.stats ? Math.floor(a.stats.hpTime || 0) : 0;
    return { label: 'Haltezeit', value: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` };
  }

  resultExtra() {
    return { zones: this.zones.length, moves: this.serial, held: { A: Math.round(this.heldTime.A), B: Math.round(this.heldTime.B) } };
  }

  /* ------------------------------------------------------------ Mehrspieler */

  /** [Index aktiv, Besitzer, umkämpft, Anwesende A, B, s bis Wechsel (ganz), Vorschau, Wechselzähler] + Haltezeiten je netId. */
  netExtra(s) {
    s.hp = [this.idx, this.owner || '', this.contested ? 1 : 0, this.counts.A | 0, this.counts.B | 0, Math.max(0, Math.ceil(this.rotLeft)), this.preview ? 1 : 0, this.serial];
    const hh = [];
    for (const a of this.G.actors) if (Number.isInteger(a.netId) && a.stats && a.stats.hpTime >= 1) hh.push([a.netId, Math.floor(a.stats.hpTime)]);
    s.hh = hh;
  }

  applyNetExtra(s, find) {
    if (Array.isArray(s.hh) && typeof find === 'function') for (const [id, t] of s.hh) { const a = find(id); if (a && a.stats) a.stats.hpTime = Number(t) || 0; }
    if (!Array.isArray(s.hp) || !this.zones.length) return;
    const [idx, owner, cont, a, b, left, prev, serial] = s.hp;
    let changed = false;
    const i = ((Number(idx) | 0) % this.zones.length + this.zones.length) % this.zones.length;
    if (i !== this.idx || (Number.isFinite(serial) && serial !== this.serial)) {
      const moved = this.serial !== 0 || i !== this.idx;
      this.idx = i;
      this.serial = Number(serial) | 0;
      this.preview = !!prev;
      this._resetZone();
      this._buildObjectives();
      changed = true;
      if (moved) {
        this._notice(`Neue Stellung: ${this.zone.name}`, 'gold');
        this.G.events.emit('hp:move', { mode: this, zone: this._public(this.objectives[0]), index: this.idx, serial: this.serial });
      }
    }
    if (!!prev !== this.preview) {
      this.preview = !!prev;
      this._buildObjectives();
      changed = true;
      const n = this.nextZone;
      if (this.preview && n) this._notice(`Stellung wandert in ${Math.max(1, Math.ceil(Number(left) || 0))} s: ${n.name}`, 'signal');
    }
    // Restzeit: das Abbild zählt selbst (replicaTick) und springt nur bei größerer Abweichung
    if (Number.isFinite(left) && Math.abs(this.rotLeft - left) > 1.1) this.rotLeft = left;
    const own = owner === 'A' || owner === 'B' ? owner : null;
    const c = !!cont;
    if (c && !this.contested) this._contestNote();
    this.contested = c;
    this.counts.A = a | 0;
    this.counts.B = b | 0;
    if (own !== this.owner) {
      const before = this.owner;
      this.owner = own;
      changed = true;
      this._announceOwner(own, before);
    }
    this._syncActive();
    this._emit(changed || this.G.time.elapsed - this._emitAt > 1);
  }

  /** Abbild: Restzeit bis zum Wechsel zwischen den Zuständen des Hosts weiterzählen. */
  replicaTick(dt) {
    const G = this.G;
    if (G.match && (G.match.state === 'playing' || G.match.netLive)) this.rotLeft = Math.max(0, this.rotLeft - dt);
  }

  onDetach() {
    super.onDetach();
    this._hold.clear();
    this._entered.clear();
    this._firstIn = null;
  }
}

/** Fester Anteil 0…1 je Bot (aus der Id), damit dieselben Bots vorausgehen. */
function share(bot, salt = 0) {
  const s = String(bot.id ?? bot.name ?? '');
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

/** Ohne Kartendaten: Herrschaftsflaggen der Karte (B in der Mitte zuerst), sonst Mitte zwischen den Startbereichen. */
function fallbackZones(w) {
  const dom = w && w.objectives && Array.isArray(w.objectives.dom) ? w.objectives.dom : [];
  if (dom.length) {
    const order = { B: 0, A: 1, C: 2 };
    const sorted = dom.slice().sort((x, y) => (order[x.id] ?? 9) - (order[y.id] ?? 9));
    return sorted.map((f, i) => ({ id: String(i + 1), name: `Flagge ${f.id}`, position: f.position, radius: f.radius || 5 }));
  }
  const avg = (list) => {
    const v = new THREE.Vector3();
    for (const s of list || []) v.add(s.position);
    return list && list.length ? v.multiplyScalar(1 / list.length) : v;
  };
  const a = avg(w && w.spawns && w.spawns.A);
  const b = avg(w && w.spawns && w.spawns.B);
  return [{ id: '1', name: 'Mitte', position: a.clone().lerp(b, 0.5), radius: 6 }];
}
