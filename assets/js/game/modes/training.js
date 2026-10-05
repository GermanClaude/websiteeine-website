// NULLPUNKT — Schießstand: Klappziele (world.targets) mit Trefferzonen, Schaden nach Distanz (combat.falloff),
// Treffer-/Genauigkeits-/TTK-Statistik, unbegrenzte Reserve, freie Waffenwahl und der Zeitlauf „Parcours“
// (12 Ziele nacheinander, Strafzeit pro Fehlschuss, Bestzeit je Waffe in localStorage 'nullpunkt:training').
// Trefferzuordnung: world.raycast wird für die Matchdauer umhüllt und merkt sich Zieltreffer; 'impact' bestätigt.

import { WEAPONS } from '../../shared/weapons.data.js';
import { BaseMode } from './base.js';
import { falloff } from '../combat.js';

const STORE = 'nullpunkt:training';
const TARGET_HP = 100;
const RAISE_DELAY = 2.4;
const BENCH_BACK = 2; // m hinter der Feuerlinie (hinter dem Schießtisch, Bahnschild noch über dem Blickfeld)
const PARCOURS = { count: 12, mix: { 10: 3, 25: 3, 50: 3, 75: 2, 100: 1 }, missPenalty: 0.25, countdown: 3, gap: 0.3 };

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? { best: v.best && typeof v.best === 'object' ? v.best : {}, runs: v.runs | 0 } : { best: {}, runs: 0 };
  } catch {
    return { best: {}, runs: 0 };
  }
}

function saveStore(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* Speicher gesperrt */ }
}

export class TrainingMode extends BaseMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.teams = false;
    this.scores = {};
    this.scoreLimit = 0;
    this.timeLimit = 0;
    this.timeLeft = Infinity;
    this.targets = [];
    this.tstate = new Map(); // Ziel → { hp, firstHit, downAt }
    this.stats = this._blankStats();
    this.parcours = { state: 'idle', t: 0, list: [], index: 0, misses: 0, shots: 0, hits: 0, startAt: 0, result: null, countdown: 0, active: null, nextAt: 0 };
    this.store = loadStore();
    this.lastHit = null;
    this._world = null;
    this._orig = null;
    this._targetHits = [];
    this._shotSerial = 0;
    this._hitSerial = -1;
  }

  _blankStats() {
    return { shots: 0, hits: 0, headshots: 0, down: 0, damage: 0, ttk: [], longest: 0 };
  }

  /* ------------------------------------------------------------ Lebenszyklus */

  onAttach(scope) {
    scope.on('weapon:fire', (p) => {
      if (!p || p.actor !== this.G.player) return;
      this._shotSerial += 1;
      this.stats.shots += 1;
      if (this.parcours.state === 'running') this.parcours.shots += 1;
    });
    scope.on('impact', (p) => this._onImpact(p));
  }

  onStart() {
    const w = this.G.world;
    this.targets = w && Array.isArray(w.targets) ? w.targets : [];
    for (const t of this.targets) {
      this.tstate.set(t, { hp: TARGET_HP, firstHit: 0, downAt: 0 });
      if (t.raise) t.raise();
    }
    this._wrap(w);
    this.scores[this.G.player ? this.G.player.id : 'player'] = 0;
  }

  onDetach() {
    this._unwrap();
  }

  _wrap(w) {
    if (!w || this._orig || typeof w.raycast !== 'function' || !this.targets.length) return;
    const orig = w.raycast;
    const own = Object.prototype.hasOwnProperty.call(w, 'raycast');
    this._world = w;
    this._orig = { fn: orig, own };
    const self = this;
    w.raycast = function raycastTargets(o, d, m) {
      const h = orig.call(w, o, d, m);
      // Liste statt Einzelwert: der Durchschuss-Test von combat strahlt rückwärts erneut aufs Ziel
      if (h && h.targetId != null) { self._targetHits.push(h); if (self._targetHits.length > 6) self._targetHits.shift(); }
      return h;
    };
  }

  _unwrap() {
    if (!this._orig || !this._world) return;
    if (this._orig.own) this._world.raycast = this._orig.fn;
    else delete this._world.raycast;
    this._orig = null;
    this._world = null;
  }

  /* ------------------------------------------------------------ Treffer */

  _onImpact(p) {
    if (!p || !p.point || !this._targetHits.length) return;
    const h = this._targetHits.find((x) => x.point === p.point) || this._targetHits.find((x) => x.point.distanceToSquared(p.point) < 0.0004);
    this._targetHits.length = 0;
    if (!h || p.shooter !== this.G.player) return;
    const target = this.targets.find((t) => t.id === h.targetId);
    if (!target) return;
    const G = this.G;
    const def = WEAPONS[p.weaponId];
    if (!def) return;
    const eye = G.player.getEyePosition(new G.THREE.Vector3());
    const dist = eye.distanceTo(h.point);
    const zone = h.zone === 'head' ? 'head' : 'body';
    const dmg = falloff(def, dist) * (zone === 'head' ? def.headMult || 1.4 : 1);
    const st = this.tstate.get(target);
    if (!st || st.hp <= 0) return;
    const now = G.time.elapsed;
    if (target.hit) target.hit();
    // Pro Schuss nur ein Treffer (Schrot)
    if (this._hitSerial !== this._shotSerial) {
      this._hitSerial = this._shotSerial;
      this.stats.hits += 1;
      if (zone === 'head') this.stats.headshots += 1;
      if (this.parcours.state === 'running') this.parcours.hits += 1;
    }
    this.stats.damage += dmg;
    this.stats.longest = Math.max(this.stats.longest, Math.round(dist * 10) / 10);
    if (!st.firstHit) st.firstHit = now;
    const parc = this.parcours.state === 'running' && this.parcours.active && this.parcours.active.has(target);
    st.hp -= parc ? TARGET_HP : dmg;
    const killed = st.hp <= 0;
    let ttk = null;
    if (killed) {
      ttk = Math.max(0, now - st.firstHit);
      st.downAt = now;
      st.firstHit = 0;
      this.stats.down += 1;
      this.stats.ttk.push(ttk);
      if (this.stats.ttk.length > 50) this.stats.ttk.shift();
      if (target.drop) target.drop();
      this.award(G.player, 'target', zone === 'head' ? 30 : 20);
      this.scores[G.player.id] = this.stats.down;
      if (parc) this._parcoursHit(target);
    }
    this.lastHit = { distance: Math.round(dist * 10) / 10, zone, damage: Math.round(dmg), killed, ttk, targetDistance: target.distance, lane: target.lane, weaponId: def.id, time: now };
    G.events.emit('training:hit', { target, point: h.point.clone(), zone, damage: dmg, distance: dist, killed, ttk });
  }

  /* ------------------------------------------------------------ Takt */

  tick(dt, playing) {
    const G = this.G;
    const p = G.player;
    // Unbegrenzte Reserve
    if (p && p.weapon && this.def.infiniteAmmo !== false) {
      for (const s of p.weapon.slots || []) if (s && s.def && s.def.reserve) s.reserve = Math.max(s.reserve, s.def.reserve);
      const eq = p.weapon.equipment && p.weapon.equipment.lethal;
      if (eq && eq.id && eq.count < 1 && (!this._nadeAt || G.time.elapsed - this._nadeAt > 4)) { this._nadeAt = G.time.elapsed; eq.count = 1; }
    }
    if (!playing) return;
    const now = G.time.elapsed;
    // Freies Schießen: umgefallene Ziele wieder aufstellen
    if (this.parcours.state === 'idle' || this.parcours.state === 'done') {
      for (const t of this.targets) {
        const st = this.tstate.get(t);
        if (st && st.hp <= 0 && now - st.downAt > RAISE_DELAY) {
          st.hp = TARGET_HP;
          if (t.raise) t.raise();
        }
        if (st && st.firstHit && now - st.firstHit > 3 && st.hp > 0) { st.hp = TARGET_HP; st.firstHit = 0; }
      }
    }
    if (p && G.input && G.input.pressed('interact')) this.interact();
    this._tickParcours(dt, now);
  }

  /* ------------------------------------------------------------ Parcours */

  /** Startet/bricht den Parcours ab (Taste F/E, HUD-Knopf). */
  interact() {
    const P = this.parcours;
    if (P.state === 'running' || P.state === 'countdown') this.abortParcours();
    else this.startParcours();
  }

  startParcours() {
    const G = this.G;
    if (!this.targets.length || this.isOver) return false;
    const P = this.parcours;
    const byDist = new Map();
    for (const t of this.targets) {
      const list = byDist.get(t.distance) || [];
      list.push(t);
      byDist.set(t.distance, list);
    }
    const pick = [];
    for (const [d, n] of Object.entries(PARCOURS.mix)) {
      const list = shuffle((byDist.get(Number(d)) || []).slice());
      pick.push(...list.slice(0, n));
    }
    while (pick.length < PARCOURS.count && pick.length < this.targets.length) {
      const t = this.targets[(Math.random() * this.targets.length) | 0];
      if (!pick.includes(t)) pick.push(t);
    }
    // Abwechselnd nah/fern, Bahnen gemischt
    P.list = shuffle(pick).slice(0, PARCOURS.count);
    P.index = 0;
    P.misses = 0;
    P.shots = 0;
    P.hits = 0;
    P.t = 0;
    P.result = null;
    P.state = 'countdown';
    P.countdown = PARCOURS.countdown;
    P.active = new Set();
    P.nextAt = 0;
    for (const t of this.targets) {
      const st = this.tstate.get(t);
      st.hp = TARGET_HP;
      st.firstHit = 0;
      if (t.drop) t.drop();
    }
    G.events.emit('training:parcours', { phase: 'countdown', value: Math.ceil(P.countdown), total: P.list.length });
    G.events.emit('ui:sound', { name: 'countdown' });
    return true;
  }

  abortParcours() {
    const P = this.parcours;
    if (P.state !== 'running' && P.state !== 'countdown') return;
    P.state = 'idle';
    P.active = null;
    for (const t of this.targets) { const st = this.tstate.get(t); st.hp = TARGET_HP; if (t.raise) t.raise(); }
    this.G.events.emit('training:parcours', { phase: 'abort' });
    this.G.events.emit('ui:sound', { name: 'back' });
  }

  _tickParcours(dt, now) {
    const P = this.parcours;
    const G = this.G;
    if (P.state === 'countdown') {
      const before = Math.ceil(P.countdown);
      P.countdown -= dt;
      const after = Math.ceil(P.countdown);
      if (after !== before && after > 0) { G.events.emit('training:parcours', { phase: 'countdown', value: after, total: P.list.length }); G.events.emit('ui:sound', { name: 'countdown' }); }
      if (P.countdown <= 0) {
        P.state = 'running';
        P.t = 0;
        P.startAt = now;
        P.nextAt = now;
        G.events.emit('training:parcours', { phase: 'start', total: P.list.length });
        G.events.emit('ui:sound', { name: 'go' });
      }
      return;
    }
    if (P.state !== 'running') return;
    P.t += dt;
    // bis zu zwei Ziele gleichzeitig
    while (P.index < P.list.length && P.active.size < 2 && now >= P.nextAt) {
      const t = P.list[P.index++];
      const st = this.tstate.get(t);
      st.hp = TARGET_HP;
      if (t.raise) t.raise();
      P.active.add(t);
      P.nextAt = now + PARCOURS.gap;
    }
  }

  _parcoursHit(target) {
    const P = this.parcours;
    P.active.delete(target);
    const G = this.G;
    G.events.emit('training:parcours', { phase: 'progress', done: P.index - P.active.size, total: P.list.length });
    if (P.index >= P.list.length && P.active.size === 0) {
      P.state = 'done';
      P.misses = Math.max(0, P.shots - P.hits);
      const time = P.t + P.misses * PARCOURS.missPenalty;
      const wid = G.player.weapon && G.player.weapon.currentDef ? G.player.weapon.currentDef.id : 'unbekannt';
      const prevBest = this.store.best[wid];
      const overall = Object.values(this.store.best).reduce((m, v) => Math.min(m, v), Infinity);
      const newBest = !Number.isFinite(prevBest) || time < prevBest;
      if (newBest) this.store.best[wid] = Math.round(time * 100) / 100;
      this.store.runs += 1;
      saveStore(this.store);
      P.result = { time, raw: P.t, misses: P.misses, accuracy: P.shots ? P.hits / P.shots : 0, weaponId: wid, best: this.store.best[wid], prevBest: Number.isFinite(prevBest) ? prevBest : null, newBest, overallBest: Math.min(overall, time) };
      this.award(G.player, 'target', Math.max(50, Math.round(400 - time * 12)));
      G.events.emit('training:parcours', { phase: 'done', result: P.result });
      G.events.emit('ui:sound', { name: newBest ? 'levelup' : 'confirm' });
      for (const t of this.targets) { const st = this.tstate.get(t); st.hp = TARGET_HP; st.downAt = G.time.elapsed; }
    }
  }

  /** Bestzeit (s) für eine Waffe oder insgesamt. */
  bestTime(weaponId) {
    if (weaponId) return Number.isFinite(this.store.best[weaponId]) ? this.store.best[weaponId] : null;
    const v = Object.values(this.store.best).filter(Number.isFinite);
    return v.length ? Math.min(...v) : null;
  }

  /** Freie Waffenwahl im Schießstand (HUD). slot: 'primary'|'secondary'|'lethal'. */
  setWeapon(slot, id) {
    const p = this.G.player;
    if (!p || !p.weapon || typeof p.weapon.setLoadout !== 'function') return false;
    const lo = { ...(p.loadout || {}) };
    lo[slot] = id;
    p.loadout = lo;
    p.weapon.setLoadout(lo);
    this.G.events.emit('training:weapon', { slot, id });
    return true;
  }

  /* ------------------------------------------------------------ Kennzahlen */

  summary() {
    const s = this.stats;
    const avg = s.ttk.length ? s.ttk.reduce((a, b) => a + b, 0) / s.ttk.length : null;
    return {
      shots: s.shots, hits: s.hits, accuracy: s.shots ? s.hits / s.shots : 0, headshots: s.headshots,
      headRate: s.hits ? s.headshots / s.hits : 0, down: s.down, avgTtk: avg, lastTtk: s.ttk.length ? s.ttk[s.ttk.length - 1] : null,
      longest: s.longest, damage: Math.round(s.damage), last: this.lastHit,
    };
  }

  decide() {
    return { winner: 'draw' };
  }

  allowOvertime() {
    return false;
  }

  canRespawn() {
    return true;
  }

  /**
   * Schütze startet (und respawnt) an der Feuerlinie einer mittleren Bahn, Blick die Bahn hinunter –
   * nicht an einem der allgemeinen Kartenstartpunkte hinter der Rückwand. Der Platz wird aus den
   * Klappzielen abgeleitet (Ziel steht `distance` Meter vor der Feuerlinie); ohne Ziele wie üblich.
   */
  chooseSpawn(actor) {
    return this._benchSpot() || super.chooseSpawn(actor);
  }

  _benchSpot() {
    const w = this.G.world;
    const list = w && Array.isArray(w.targets) ? w.targets : [];
    if (!list.length) return null;
    // Bahnmitte = mittleres x der Ziele einer Bahn; Feuerlinie = Ziel-z + Entfernung (Ziele liegen in −Z, Gierwinkel 0)
    const lanes = new Map();
    let line = -Infinity;
    for (const t of list) {
      if (!t.position || !Number.isFinite(t.distance)) continue;
      const l = lanes.get(t.lane) || { lane: t.lane, sx: 0, n: 0 };
      l.sx += t.position.x;
      l.n += 1;
      lanes.set(t.lane, l);
      line = Math.max(line, t.position.z + t.distance);
    }
    if (!lanes.size) return null;
    const centers = [...lanes.values()].sort((a, b) => a.lane - b.lane).map((l) => l.sx / l.n);
    const midX = centers.reduce((m, c) => m + c, 0) / centers.length;
    let x = centers[0];
    for (const c of centers) if (Math.abs(c - midX) < Math.abs(x - midX) - 0.01) x = c;
    const z = line + BENCH_BACK;
    const y = typeof w.groundHeight === 'function' ? w.groundHeight(x, z, 3) : 0;
    return { position: new this.G.THREE.Vector3(x, Number.isFinite(y) ? y : 0, z), yaw: 0, source: 'training' };
  }

  resultExtra() {
    return { training: this.summary(), parcours: this.parcours.result, best: this.bestTime() };
  }

  buildResult(reason) {
    const r = super.buildResult(reason);
    r.playerWon = false;
    r.draw = true; // neutral (kein Sieg/keine Niederlage), Banner/Endbildschirm zeigen „Training beendet“
    r.winner = 'draw';
    r.training = true;
    if (r.playerSummary) {
      r.playerSummary.result = 'draw';
      // Trefferquote des Schießstands in die Profilstatistik
      r.playerSummary.shotsFired = Math.max(r.playerSummary.shotsFired, this.stats.shots);
      r.playerSummary.shotsHit = Math.min(r.playerSummary.shotsFired, Math.max(r.playerSummary.shotsHit, this.stats.hits));
    }
    return r;
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
