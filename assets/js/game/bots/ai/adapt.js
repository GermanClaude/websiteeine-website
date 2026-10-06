// NULLPUNKT — Lernende Bots (ai-adapt). Ein Spielermodell beobachtet den Spieler (Kampfdistanzen, Waffenklassen,
// Lieblingsplätze je Karte als Raster, bevorzugte Spur, Anschlag vs. Hüfte, Lehnen/Hinlegen/Rutschen/Fahrzeuge,
// Granaten, Todesarten, Reaktionszeit, Bewegungsanteil, Kopftreffer) und speichert es über Matches hinweg
// (localStorage 'nullpunkt:botAdapt', global + je Karte, exponentieller Zerfall je Match → folgt Stiländerungen).
// Daraus werden Eigenschaften (0…1) und ein Anpassungsplan für die GEGNERISCHEN Bots abgeleitet, skaliert mit der
// Schwierigkeit (ADAPT_LEVEL): Lieblingsplätze vorzielen und kontrollieren, Camper von hinten anlaufen und
// ausräuchern (Blend/Splitter), mehr Gegen-Scharfschützen + Rauch gegen Fernkämpfer, gegen Nahkämpfer Winkel halten
// statt nachrennen, Hinterhalt-Routen meiden, Lieblingsspur sichern, selbst öfter lehnen/liegen.
// Im Match wird nach jedem Abschuss/Tod live nachjustiert (bot:adapt { type: 'retune' … }).
// Fairness (feste Grenzen): Reaktion, Zielfehler, Nachführen, Kopftreffer, Sichtweite/-feld, Schaden, Vorhalt,
// Rückstoßausgleich und Denktakt bleiben unverändert (FROZEN); nur taktische Neigungen werden mit Obergrenzen
// verschoben. Bots nutzen kein Live-Wissen über den Spieler, nur das gelernte Modell + ihre eigene Wahrnehmung.
// Einstellung „Lernende Bots“ (adaptiveBots, Standard an): aus = weder lernen noch anpassen.
// Prüfstand: ?botlearn=off|fresh|camper|sniper|close (synthetisches Modell, wird nicht gespeichert).
import * as THREE from 'three';
import { analyze, perchNear } from './tactics.js';

export const STORE_KEY = 'nullpunkt:botAdapt';
const VERSION = 1;
const DECAY = 0.6; // Gewicht des bisherigen Modells je abgeschlossenem Match
const CELL = 6; // m, Rasterweite der Platz-Karten
const MAX_CELLS = 64;
/** Anpassungsstärke je Schwierigkeit: Rekrut keine, Regulär leicht, Veteran mittel, Elite stark. */
export const ADAPT_LEVEL = Object.freeze({ rekrut: 0, regulaer: 0.35, veteran: 0.65, elite: 1 });
/** Werte, die die Anpassung nie verändert (Fairness). */
export const FROZEN = Object.freeze(['reaction', 'aimError', 'tracking', 'burst', 'headshotChance', 'spotRate', 'viewDistance', 'fov', 'damageScale', 'prediction', 'recoilComp', 'senseHz', 'thinkInterval', 'falloff']);

const _v = new THREE.Vector3();
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const conf = (x, n) => clamp01(x / n);
const rnd = (a, b) => a + Math.random() * (b - a);
const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const NUM = ['n', 't', 'mv', 'camp', 'veh', 'k', 'kc', 'km', 'kl', 'hs', 'sh', 'ads', 'lean', 'prone', 'slide', 'nade', 'd', 'db', 'dx', 'ds', 'rt', 'rn'];

function emptyStats() { const o = { cls: {} }; for (const k of NUM) o[k] = 0; return o; }
function emptyMap() { return { heat: {}, danger: {}, lanes: [0, 0, 0] }; }

/** a·fa + b (Zahlen, Klassen); neues Objekt. */
function mixStats(a, b, fa) {
  const o = emptyStats();
  for (const k of NUM) o[k] = (a && +a[k] || 0) * fa + (b && +b[k] || 0);
  for (const s of [a && a.cls, b && b.cls]) if (s) for (const c in s) o.cls[c] = (o.cls[c] || 0) + (s === (a && a.cls) ? fa : 1) * (+s[c] || 0);
  return o;
}
/** Zellen [w, x, y, z, fx, fz] mischen (Position gewichtet gemittelt, Blickrichtung aufsummiert). */
function mixCells(a, b, fa) {
  const o = {};
  for (const [src, f] of [[a, fa], [b, 1]]) {
    if (!src) continue;
    for (const k in src) {
      const c = src[k];
      if (!Array.isArray(c) || !(c[0] > 0)) continue;
      const w = c[0] * f;
      const t = o[k] || (o[k] = [0, 0, 0, 0, 0, 0]);
      const W = t[0] + w;
      for (let i = 1; i <= 3; i++) t[i] = (t[i] * t[0] + (c[i] || 0) * w) / W;
      t[4] += (c[4] || 0) * f; t[5] += (c[5] || 0) * f;
      t[0] = W;
    }
  }
  // kleine Gewichte verwerfen, auf MAX_CELLS begrenzen
  const keys = Object.keys(o).filter((k) => o[k][0] >= 0.15).sort((x, y) => o[y][0] - o[x][0]).slice(0, MAX_CELLS);
  const r = {};
  for (const k of keys) r[k] = o[k].map((v) => Math.round(v * 100) / 100);
  return r;
}
function mixMap(a, b, fa) {
  return {
    heat: mixCells(a && a.heat, b && b.heat, fa),
    danger: mixCells(a && a.danger, b && b.danger, fa),
    lanes: [0, 1, 2].map((i) => ((a && a.lanes && +a.lanes[i]) || 0) * fa + ((b && b.lanes && +b.lanes[i]) || 0)),
  };
}
function addCell(cells, pos, w, fx = 0, fz = 0) {
  const k = key(pos.x, pos.z);
  const c = cells[k] || (cells[k] = [0, 0, 0, 0, 0, 0]);
  const W = c[0] + w;
  c[1] = (c[1] * c[0] + pos.x * w) / W; c[2] = (c[2] * c[0] + pos.y * w) / W; c[3] = (c[3] * c[0] + pos.z * w) / W;
  c[4] += fx * w; c[5] += fz * w; c[0] = W;
}

export function loadStore() {
  try {
    const raw = globalThis.localStorage && localStorage.getItem(STORE_KEY);
    const o = raw ? JSON.parse(raw) : null;
    if (o && o.v === VERSION && o.g && o.maps) return o;
  } catch { /* gesperrt/kaputt → neu */ }
  return { v: VERSION, g: emptyStats(), maps: {} };
}
function saveStore(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch { /* voll/gesperrt */ } }
export function clearStore() { try { localStorage.removeItem(STORE_KEY); } catch { /* egal */ } }

/** Eigenschaften (0…1) aus Statistik + Platz-Karte. */
export function traitsOf(S, M) {
  const k = Math.max(1, S.k), t = Math.max(1, S.t), d = Math.max(1, S.d), min = t / 60;
  const ck = conf(S.k, 6), ct = conf(S.t, 120), cd = conf(S.d, 5);
  const cls = S.cls || {};
  const longShare = Math.max(S.kl / k, ((cls.sniper || 0) + (cls.marksman || 0)) / k);
  const closeShare = Math.max(S.kc / k, ((cls.shotgun || 0) + 0.5 * (cls.smg || 0)) / k);
  let lanePref = 0, lane = 1;
  const L = (M && M.lanes) || [0, 0, 0], lt = L[0] + L[1] + L[2];
  if (lt > 60) { lane = L.indexOf(Math.max(...L)); lanePref = clamp01((L[lane] / lt - 0.4) / 0.35); }
  let heatW = 0;
  for (const c of Object.values((M && M.heat) || {})) heatW = Math.max(heatW, c[0]);
  return {
    camper: ct * clamp01((S.camp / t - 0.12) / 0.3),
    aggressive: ct * clamp01((S.mv / t - 0.55) / 0.3),
    longRange: ck * clamp01(longShare * 1.6 - 0.25),
    closeRange: ck * clamp01(closeShare * 1.6 - 0.35),
    peeker: ct * clamp01((S.lean + S.prone) / min / 4),
    slider: ct * clamp01(S.slide / min / 2),
    nader: ct * clamp01(S.nade / min / 1.5),
    vehicle: ct * clamp01((S.veh / t) * 3),
    hipfire: conf(S.sh, 60) * clamp01((1 - S.ads / Math.max(1, S.sh) - 0.4) / 0.4),
    fastReact: conf(S.rn, 5) * clamp01((0.9 - S.rt / Math.max(1, S.rn)) / 0.5),
    headhunter: ck * clamp01((S.hs / k - 0.25) / 0.35),
    weakBehind: cd * clamp01((S.db / d - 0.2) / 0.4),
    weakNade: cd * clamp01((S.dx / d - 0.1) / 0.3),
    weakSniper: cd * clamp01((S.ds / d - 0.15) / 0.35),
    hotConf: clamp01(heatW / 6),
    lanePref, lane,
  };
}

/** Anpassungsplan aus Eigenschaften und Stärke s (0…1). Alle Werte gedeckelt. */
export function planOf(T, s, spots) {
  const has = spots && spots.length > 0;
  return {
    s,
    check: has && s > 0 ? Math.min(0.55, s * (0.15 + 0.45 * T.camper + 0.25 * T.hotConf)) : 0,
    preaim: has && s > 0,
    flankCamp: s >= 0.6 ? 0.35 + 0.4 * T.camper : 0, // Anteil der Kontrollen von hinten (nur Veteran/Elite)
    nadeCamper: s * (0.25 + 0.5 * T.camper),
    flash: s >= 0.6,
    smoke: s >= 0.6 ? Math.min(0.8, s * (0.3 + 0.7 * T.longRange)) * (T.longRange > 0.2 ? 1 : 0) : 0,
    marksmen: Math.min(2, Math.floor(s * 2 * Math.max(T.longRange, T.weakSniper * 0.6) + 0.35)),
    hold: Math.min(0.6, s * T.closeRange * 0.7),
    avoid: s * 2.5,
    lane: s * T.lanePref,
    favLane: T.lane,
  };
}

/** Taktische Neigungen anpassen (FROZEN bleibt unberührt). → nur die geänderten Felder. */
export function tuneDiff(base, T, s) {
  const o = {};
  if (!(s > 0)) return o;
  o.flank = Math.min(Math.max(base.flank, 0.7), base.flank + Math.min(0.3, s * (0.25 * T.camper + 0.15 * T.weakBehind + 0.1 * T.longRange)));
  o.cover = Math.min(Math.max(base.cover, 0.98), base.cover + Math.min(0.2, s * (0.15 * T.fastReact + 0.12 * T.longRange + 0.08 * T.headhunter)));
  o.grenadeChance = Math.min(Math.max(base.grenadeChance, 0.55), base.grenadeChance * (1 + Math.min(1.2, s * (1.2 * T.camper + 0.6 * T.weakNade))));
  o.strafeChance = Math.min(0.9, base.strafeChance + Math.min(0.12, s * 0.12 * Math.max(T.longRange, T.headhunter)));
  o.peekChance = Math.min(0.9, base.peekChance + Math.min(0.15, s * 0.15 * T.peeker));
  o.prone = T.peeker * s > 0.2 ? Math.max(base.prone, s >= 0.6 ? 1 : 0.5) : base.prone;
  o.chaseTime = base.chaseTime * (1 - 0.3 * s * T.closeRange);
  return o;
}

/** Synthetisches Modell (Prüfstand, ?botlearn=camper|sniper|close). */
export function synthModel(preset, world, mapId, playerTeam = 'A') {
  const A = analyze(world);
  const st = loadStore();
  const S = emptyStats();
  const M = emptyMap();
  if (!A) return st;
  const enemySide = playerTeam === 'B' ? A.sa : A.sb;
  const face = (p) => { _v.subVectors(enemySide, p).setY(0); const l = _v.length() || 1; return [_v.x / l, _v.z / l]; };
  const spot = (p, w) => { const [fx, fz] = face(p); addCell(M.heat, p, w, fx, fz); };
  const nearNode = (p) => (A.nav && A.nav.nearest(p)) || { position: p.clone() };
  Object.assign(S, { n: 3, t: 900, sh: 900, ads: 600, d: 12, rt: 8, rn: 12, k: 30 });
  if (preset === 'camper') {
    Object.assign(S, { mv: 250, camp: 420, kc: 6, km: 18, kl: 6, hs: 8, lean: 40, prone: 10, nade: 4, db: 6, dx: 2, ds: 1 });
    S.cls = { ar: 24, smg: 6 };
    spot(nearNode(A.center).position, 30);
    const p2 = perchNear({ position: A.center, team: playerTeam, G: { world } }, A, A.center, 24, { tests: 6, minDist: 6 });
    if (p2) spot(p2.position, 12);
  } else if (preset === 'sniper') {
    Object.assign(S, { mv: 200, camp: 300, kc: 2, km: 6, kl: 22, hs: 14, ads: 820, prone: 30, db: 2, dx: 1, ds: 1 });
    S.cls = { sniper: 20, ar: 10 };
    const own = playerTeam === 'B' ? A.sb : A.sa;
    spot(nearNode(own.clone().lerp(A.center, 0.55)).position, 24);
  } else if (preset === 'close') {
    Object.assign(S, { mv: 700, camp: 40, kc: 22, km: 6, kl: 2, hs: 4, ads: 150, slide: 40, db: 3, dx: 1 });
    S.cls = { shotgun: 18, smg: 8, ar: 4 };
    spot(nearNode(A.center).position, 8);
  }
  st.g = S;
  st.maps[mapId] = M;
  return st;
}

export class BotAdapt {
  constructor(mgr) {
    this.mgr = mgr;
    this.G = mgr.G;
    this._subs = null;
    this.counts = {};
    this.reset();
  }

  reset() {
    this.cur = emptyStats();
    this.curMap = emptyMap();
    this.store = null;
    this.mapId = null;
    this.active = false;
    this.level = 0;
    this.preset = null;
    this.traits = traitsOf(emptyStats(), emptyMap());
    this.plan = planOf(this.traits, 0, []);
    this.spots = [];
    this.danger = null;
    this.dangerMax = 0;
    this._diff = null;
    this._base = null;
    this._sampleT = 0;
    this._anchor = new THREE.Vector3();
    this._anchorSet = false;
    this._anchorT = 0;
    this.camping = false;
    this._react = new Map();
    this._dirty = false;
    this._retuneAt = 0;
    this._leanAt = -1e9;
    this._committed = false;
    this._q = [0, 0];
    this.counts = {};
    this.ms = 0;
    this.msMax = 0;
  }

  attach(G) {
    this.G = G;
    if (this._subs) this._subs.dispose();
    this.reset();
    const s = (this._subs = G.events.scope());
    const P = () => G.player;
    s.on('kill', (e) => this._onKill(e));
    s.on('actor:hit', (e) => this._onHit(e));
    s.on('weapon:fire', (e) => { if (this.active && e && e.actor === P()) { this.cur.sh++; if (P().weapon && P().weapon.ads) this.cur.ads++; } });
    s.on('grenade:throw', (e) => { if (this.active && e && e.actor === P()) this.cur.nade++; });
    s.on('player:lean', (e) => { const now = G.time.elapsed; if (this.active && e && e.dir && now - this._leanAt > 1.5) { this._leanAt = now; this.cur.lean++; } });
    s.on('player:stance', (e) => { if (this.active && e && e.actor === P() && e.stance === 'prone' && e.prev !== 'prone' && !e.denied) this.cur.prone++; });
    s.on('player:slide', (e) => { if (this.active && e && e.phase === 'start') this.cur.slide++; });
    s.on('match:end', () => this.commit());
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    this.active = false;
  }

  /** Matchbeginn (aus spawnBots): Modell laden, Stärke festlegen, Plan berechnen. */
  begin(diff, modeId) {
    const G = this.G;
    const mapId = (G.match && G.match.mapId) || 'map';
    if (this.active && this.mapId === mapId) return;
    let param = null;
    try { param = new URLSearchParams(globalThis.location ? location.search : '').get('botlearn'); } catch { param = null; }
    const on = param ? param !== 'off' : !(G.settings && G.settings.get && G.settings.get('adaptiveBots') === false);
    this.mapId = mapId;
    this.active = on && modeId !== 'training';
    this.level = this.active ? ADAPT_LEVEL[diff && diff.id] ?? 0.35 : 0;
    this.preset = param && param !== 'off' && param !== 'fresh' ? param : null;
    const team = G.player && G.player.team;
    this.store = this.preset ? synthModel(this.preset, G.world, mapId, team || 'A') : param === 'fresh' ? { v: VERSION, g: emptyStats(), maps: {} } : loadStore();
    // Spurgrenzen (seitlicher Abstand, wie tactics.analyze)
    const A = analyze(G.world);
    if (A) {
      let q1 = -Infinity, q2 = -Infinity;
      const lat = (p) => (p.x - A.center.x) * A.perp.x + (p.z - A.center.z) * A.perp.z;
      for (const n of A.lanes[0]) q1 = Math.max(q1, lat(n.position));
      for (const n of A.lanes[1]) q2 = Math.max(q2, lat(n.position));
      this._q = [q1, q2];
    }
    this.retune(G.time.elapsed, true);
  }

  /** Eigener Schwierigkeitsdatensatz der gegnerischen Bots (gemeinsam, wird live angepasst). */
  diffFor(base, team, ffa) {
    const G = this.G;
    const pt = G.player && G.player.team;
    if (!(ffa || !team || (pt && team !== pt) || (!pt && team === 'B'))) return base;
    if (!this._diff || this._base !== base) { this._base = base; this._diff = { ...base }; }
    this._applyTune();
    return this._diff;
  }

  /** Gegner des Spielers und Anpassung aktiv? */
  on(bot) {
    if (!this.active || !(this.level > 0)) return false;
    const pt = this.G.player && this.G.player.team;
    return !bot.team || !pt || bot.team !== pt;
  }

  /** Zusätzliche Schützen-Rollen (Gegen-Scharfschützen) für eine gegnerische Gruppe. */
  extraMarksmen() { return this.active ? this.plan.marksmen : 0; }

  note(bot, type, extra = null) {
    this.counts[type] = (this.counts[type] || 0) + 1;
    this.G.events.emit('bot:adapt', { type, bot, level: this.level, ...(extra || {}) });
  }

  /* ---------------------------------------------------------------- Beobachten */

  update(dt, now) {
    if (!this.active) return;
    const t0 = performance.now();
    this._update(dt, now);
    this._time(t0);
  }

  /** Eigene Rechenzeit (Prüfstand: ms gesamt + größter Einzelaufruf). */
  _time(t0) { const d = performance.now() - t0; this.ms += d; if (d > this.msMax) this.msMax = d; }

  _update(dt, now) {
    this._sampleT += dt;
    if (this._sampleT >= 0.25) { const st = this._sampleT; this._sampleT = 0; this._sample(st); }
    if (this._dirty && now >= this._retuneAt) this.retune(now);
  }

  _sample(dt) {
    const G = this.G, p = G.player;
    if (!p || !p.alive || !G.match || G.match.state !== 'playing') { this._anchorSet = false; this.camping = false; return; }
    const c = this.cur, pos = p.position;
    c.t += dt;
    const v = p.body && p.body.velocity;
    const hs = v ? Math.hypot(v.x, v.z) : 0;
    if (p.vehicle) c.veh += dt;
    if (hs > 1.5 || p.vehicle) c.mv += dt;
    // Spur
    const A = analyze(G.world);
    if (A) {
      const l = (pos.x - A.center.x) * A.perp.x + (pos.z - A.center.z) * A.perp.z;
      this.curMap.lanes[l < this._q[0] ? 0 : l < this._q[1] ? 1 : 2] += dt;
    }
    // Campen: ≥ 6 s im Umkreis von 3 m (nicht im Fahrzeug)
    if (!this._anchorSet || p.vehicle || Math.hypot(pos.x - this._anchor.x, pos.z - this._anchor.z) > 3) {
      this._anchor.copy(pos); this._anchorSet = true; this._anchorT = 0; this.camping = false;
      return;
    }
    const before = this._anchorT;
    this._anchorT += dt;
    this.camping = this._anchorT >= 4;
    if (this._anchorT >= 6) {
      const add = before < 6 ? this._anchorT : dt;
      c.camp += add;
      const yaw = p.yaw || 0;
      addCell(this.curMap.heat, this._anchor, add / 10, -Math.sin(yaw), -Math.cos(yaw));
      if (before < 6 || Math.floor(this._anchorT / 15) !== Math.floor(before / 15)) { this._dirty = true; this._retuneAt = Math.min(this._retuneAt || Infinity, G.time.elapsed + 1); }
    }
  }

  _onKill({ victim, killer, weaponId, headshot, explosive } = {}) {
    if (!this.active) return;
    const G = this.G, P = G.player, c = this.cur;
    if (!P || !victim) return;
    if (killer === P && victim !== P) {
      c.k++;
      if (headshot) c.hs++;
      _v.subVectors(victim.position, P.position);
      const d = _v.length();
      if (d < 12) c.kc++; else if (d < 35) c.km++; else c.kl++;
      const def = G.data && G.data.WEAPONS && G.data.WEAPONS[weaponId];
      const cls = def ? def.cls : explosive ? 'explosive' : 'other';
      c.cls[cls] = (c.cls[cls] || 0) + 1;
      const l = Math.hypot(_v.x, _v.z) || 1;
      addCell(this.curMap.heat, P.position, 1.5, _v.x / l, _v.z / l);
      if (victim.isBot) addCell(this.curMap.danger, victim.position, 1);
    } else if (victim === P) {
      c.d++;
      this._react.clear();
      if (killer && killer !== P && killer.position) {
        _v.subVectors(killer.position, P.position).setY(0);
        const l = _v.length() || 1;
        const yaw = P.yaw || 0;
        if ((-Math.sin(yaw) * _v.x - Math.cos(yaw) * _v.z) / l < -0.2) c.db++;
        if (explosive) c.dx++;
        const def = G.data && G.data.WEAPONS && G.data.WEAPONS[weaponId];
        if (def && (def.cls === 'sniper' || def.cls === 'marksman')) c.ds++;
      }
    } else return;
    this._dirty = true;
    this._retuneAt = G.time.elapsed + 0.5;
  }

  _onHit({ target, attacker } = {}) {
    if (!this.active || !target || !attacker) return;
    const P = this.G.player, now = this.G.time.elapsed;
    if (target === P && attacker.isBot) { if (!this._react.has(attacker)) this._react.set(attacker, now); return; }
    if (attacker !== P || !target.isBot) return;
    target._adaptHitAt = now;
    target._adaptHitDist = target.position.distanceTo(P.position);
    const t0 = this._react.get(target);
    if (t0 != null) { this._react.delete(target); const rt = now - t0; if (rt < 3) { this.cur.rt += rt; this.cur.rn++; } }
  }

  /* ---------------------------------------------------------------- Anpassen */

  /** Eigenschaften/Plan neu berechnen und auf die gegnerischen Bots anwenden. */
  retune(now, initial = false) {
    this._dirty = false;
    this._retuneAt = 0;
    const st = this.store || loadStore();
    const S = mixStats(st.g, this.cur, 1);
    const M = mixMap(st.maps[this.mapId], this.curMap, 1);
    this.traits = traitsOf(S, M);
    // Lieblingsplätze (max. 4)
    const cells = Object.values(M.heat).filter((c) => c[0] >= 1.5).sort((a, b) => b[0] - a[0]).slice(0, 4);
    const top = cells.length ? cells[0][0] : 1;
    this.spots = cells.map((c) => {
      const fl = Math.hypot(c[4], c[5]);
      return { pos: new THREE.Vector3(c[1], c[2], c[3]), w: c[0], norm: c[0] / top, facing: fl > 0.3 ? new THREE.Vector3(c[4] / fl, 0, c[5] / fl) : null, claim: 0 };
    });
    this.danger = M.danger;
    this.dangerMax = 0;
    for (const k in M.danger) this.dangerMax = Math.max(this.dangerMax, M.danger[k][0]);
    this.plan = planOf(this.traits, this.level, this.spots);
    this._applyTune();
    if (this.active) {
      const T = this.traits, r = (x) => Math.round(x * 100) / 100;
      this.G.events.emit('bot:adapt', {
        type: 'retune', initial, level: this.level,
        traits: { camper: r(T.camper), longRange: r(T.longRange), closeRange: r(T.closeRange), peeker: r(T.peeker), aggressive: r(T.aggressive), fastReact: r(T.fastReact), weakBehind: r(T.weakBehind) },
        spots: this.spots.length,
      });
      this.counts.retune = (this.counts.retune || 0) + 1;
    }
  }

  _applyTune() {
    if (!this._diff || !this._base) return;
    Object.assign(this._diff, this._base, tuneDiff(this._base, this.traits, this.active ? this.level : 0));
  }

  /** Gefahrenzellen (wo der Spieler Bots erwischt) beim Umherziehen meiden. */
  roamPenalty(pos) {
    if (!this.danger || this.dangerMax < 2) return 0;
    const c = this.danger[key(pos.x, pos.z)];
    return c ? this.plan.avoid * Math.min(1, c[0] / this.dangerMax) : 0;
  }

  /** Trupp-Flanke (squad.js): Seite hinter der gelernten Blickrichtung an einem Lieblingsplatz bevorzugen (negativ = besser). */
  flankBias(contact, p) {
    if (!(this.plan.flankCamp > 0)) return 0;
    for (const s of this.spots) {
      if (!s.facing || Math.hypot(s.pos.x - contact.x, s.pos.z - contact.z) > 8) continue;
      _v.subVectors(p, s.pos).setY(0).normalize();
      return 10 * this.level * (_v.x * s.facing.x + _v.z * s.facing.z);
    }
    return 0;
  }

  /** Spur für einen gegnerischen Bot (Lieblingsspur des Spielers sichern). */
  laneFor(lane) {
    return this.active && Math.random() < this.plan.lane ? this.plan.favLane : lane;
  }

  /** Beim Verfolgen des Spielers lieber einen Winkel halten (Nahkämpfer)? */
  holdRoll(bot, rec) {
    return rec.actor === this.G.player && this.plan.hold > 0 && Math.random() < this.plan.hold;
  }

  /** Granaten-Faktor gegen einen campenden Spieler (aus eigener Wahrnehmung rec). */
  nadeMul(bot, rec) {
    if (rec.actor !== this.G.player || !this.camping) return 1;
    if (Math.hypot(rec.pos.x - this._anchor.x, rec.pos.z - this._anchor.z) > 4) return 1;
    return 1 + Math.min(2.5, 2.5 * this.level * (0.5 + 0.5 * this.traits.camper));
  }

  /**
   * Lieblingsplatz kontrollieren statt frei umherziehen. → { move, watch, speed, hold, node } oder null.
   * Veteran/Elite laufen Camper-Plätze teils von hinten an (gegen die gelernte Blickrichtung).
   */
  checkGoal(bot, now, A) {
    const t0 = performance.now();
    const r = this._checkGoal(bot, now, A);
    this._time(t0);
    return r;
  }

  _checkGoal(bot, now, A) {
    const P = this.plan;
    if (!(P.check > 0) || !A || now < (bot._adaptCheckAt || 0)) return null;
    bot._adaptCheckAt = now + rnd(14, 24);
    if (Math.random() >= P.check) return null;
    let best = null, bs = -Infinity;
    for (const s of this.spots) {
      const d = s.pos.distanceTo(bot.position);
      if (d < 8) continue;
      const sc = s.norm * 2 - d / 60 - (now < s.claim ? 1.5 : 0) + Math.random() * 0.6;
      if (sc > bs) { bs = sc; best = s; }
    }
    if (!best) return null;
    best.claim = now + 10;
    const watch = best.pos.clone();
    watch.y += 1.2;
    const world = this.G.world;
    // von hinten (gegen die gelernte Blickrichtung)
    if (best.facing && Math.random() < P.flankCamp && A.nav) {
      for (let i = 0; i < 3; i++) {
        const back = rnd(8, 13), side = rnd(-6, 6);
        _v.copy(best.pos).addScaledVector(best.facing, -back);
        _v.x += -best.facing.z * side; _v.z += best.facing.x * side;
        const n = A.nav.nearest(_v);
        if (n && n.position.distanceTo(_v) < 5 && n.position.distanceTo(best.pos) > 5) {
          this.note(bot, 'flank_camp');
          return { move: n.position.clone(), watch, speed: 'run', hold: rnd(5, 8), node: n };
        }
      }
    }
    // überwachen: erhöhter Posten oder Knoten mit Sicht auf den Platz
    let n = perchNear(bot, A, best.pos, 22, { tests: 3, minDist: 7, maxFromBot: best.pos.distanceTo(bot.position) + 10 });
    if (!n && A.nav) {
      for (let i = 0; i < 4 && !n; i++) {
        const ang = Math.atan2(bot.position.x - best.pos.x, bot.position.z - best.pos.z) + rnd(-0.9, 0.9);
        const r = rnd(10, 18);
        _v.set(best.pos.x + Math.sin(ang) * r, best.pos.y, best.pos.z + Math.cos(ang) * r);
        const c = A.nav.nearest(_v);
        if (c && c.position.distanceTo(_v) < 5 && world && world.lineOfSight && world.lineOfSight(_v.copy(c.position).setY(c.position.y + 1.5), watch)) n = c;
      }
    }
    if (!n) return null;
    this.note(bot, 'check');
    return { move: n.position.clone(), watch, speed: 'run', hold: rnd(5, 9), node: n };
  }

  /**
   * Nach jeder Entscheidung (bot.js): Lieblingsplätze vorzielen, Camper mit Blend/Splitter ausräuchern,
   * Rauch zwischen sich und einen Fernkämpfer legen.
   */
  afterThink(bot, now) {
    if (!this.on(bot) || !bot.alive) return;
    const t0 = performance.now();
    this._afterThink(bot, now);
    this._time(t0);
  }

  _afterThink(bot, now) {
    const goal = bot.goal;
    const P = this.G.player;
    const gr = bot.gunner && bot.gunner.rec;
    const visible = gr && gr.visible;
    // 1) Vorzielen auf gelernte Plätze unterwegs
    if (this.plan.preaim && !visible && goal.kind !== 'grenade' && goal.kind !== 'evade' && goal.hasMove) {
      const was = bot._adaptAim;
      let aim = null;
      if (goal.look === 'move' || (was && goal.look === 'point' && goal.lookAt.distanceToSquared(was.pos) < 0.01)) {
        const v = bot.body && bot.body.velocity;
        const hs = v ? Math.hypot(v.x, v.z) : 0;
        for (const s of this.spots) {
          const d = s.pos.distanceTo(bot.position);
          if (d < 6 || d > 40) continue;
          if (hs > 1) {
            const a = Math.atan2(-(s.pos.x - bot.position.x), -(s.pos.z - bot.position.z)) - Math.atan2(-v.x, -v.z);
            if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > 1.4) continue;
          }
          aim = s;
          break;
        }
      }
      if (aim) {
        if (!was || was.spot !== aim) {
          bot._adaptAim = { spot: aim, pos: new THREE.Vector3() };
          this.note(bot, 'preaim');
        }
        goal.look = 'point'; goal.hasLook = true;
        goal.lookAt.copy(aim.pos); goal.lookAt.y += 1.2;
        bot._adaptAim.pos.copy(goal.lookAt);
      } else if (was) {
        if (goal.look === 'point' && goal.lookAt.distanceToSquared(was.pos) < 0.01) { goal.look = 'move'; goal.hasLook = false; }
        bot._adaptAim = null;
      }
    }
    if (!P || !P.alive || bot.throwPlan || now < (bot._adaptNadeAt || 0)) return;
    const tactics = this.mgr.tactics;
    // 2) Camper ausräuchern (eigene Wahrnehmung: frische Erinnerung an den Spieler nahe am Campingplatz)
    if (this.camping && this.plan.nadeCamper > 0) {
      const r = bot.memory.get(P);
      if (r && now - r.time < 4 && Math.hypot(r.pos.x - this._anchor.x, r.pos.z - this._anchor.z) < 4) {
        const d = r.pos.distanceTo(bot.position);
        if (d > 8 && d < 30) {
          bot._adaptNadeAt = now + rnd(8, 14);
          if (Math.random() < this.plan.nadeCamper && !this._friendNear(bot, r.pos, 7)) {
            const kinds = this.plan.flash ? ['flash', 'frag', 'semtex', 'impact'] : ['frag', 'semtex', 'impact'];
            _v.copy(r.pos); _v.y += 0.2;
            if (tactics && tactics._throw(bot, _v, kinds, now)) { this.note(bot, 'nade_camper', { kind: bot.throwPlan.type }); return; }
          }
        }
      }
    }
    // 3) Rauch gegen Fernkämpfer: gerade aus großer Distanz vom Spieler getroffen
    if (this.plan.smoke > 0 && bot._adaptHitAt && now - bot._adaptHitAt < 1.5 && bot._adaptHitDist > 35) {
      bot._adaptNadeAt = now + rnd(10, 16);
      bot._adaptHitAt = 0;
      if (Math.random() < this.plan.smoke) {
        _v.subVectors(P.position, bot.position).setY(0).normalize().multiplyScalar(5).add(bot.position);
        if (tactics && tactics._throw(bot, _v, ['smoke'], now)) this.note(bot, 'smoke_sniper');
      }
    }
  }

  _friendNear(bot, p, r) {
    for (const a of this.G.actors) if (a !== bot && a.alive && a.team && a.team === bot.team && a.position.distanceTo(p) < r) return true;
    return false;
  }

  /* ---------------------------------------------------------------- Speichern + Anzeige */

  /** Matchende: aktuelles Match mit Zerfall ins gespeicherte Modell übernehmen (nicht bei Prüfstand-Vorgaben). */
  commit() {
    if (!this.active || this._committed) return;
    this._committed = true;
    if (this.cur.t < 20) return;
    const st = this.store || loadStore();
    this.cur.n = 1;
    st.g = mixStats(st.g, this.cur, DECAY);
    st.maps[this.mapId] = mixMap(st.maps[this.mapId], this.curMap, DECAY);
    // Hilfswerte im Speicher runden (klein halten)
    for (const k of NUM) st.g[k] = Math.round(st.g[k] * 100) / 100;
    for (const c in st.g.cls) st.g.cls[c] = Math.round(st.g.cls[c] * 100) / 100;
    st.maps[this.mapId].lanes = st.maps[this.mapId].lanes.map((x) => Math.round(x));
    this.store = st;
    this.cur = emptyStats();
    this.curMap = emptyMap();
    if (!this.preset) saveStore(st);
    this.retune(this.G.time.elapsed);
  }

  /** Eine Zeile für den Endbildschirm (leer bei Rekrut, aus oder Training). */
  summaryLine() {
    if (!this.active || !(this.level > 0)) return '';
    const T = this.traits, P = this.plan;
    const items = [];
    if (this.spots.length && (T.camper > 0.3 || T.hotConf > 0.5)) items.push([Math.max(T.camper, T.hotConf * 0.8), P.flankCamp > 0 ? 'Sie kontrollieren deine Lieblingsplätze und kommen von hinten' : 'Sie zielen auf deine Lieblingsplätze vor']);
    if (T.camper > 0.4 && P.nadeCamper > 0.3) items.push([T.camper * 0.9, P.flash ? 'Camper werden mit Blend- und Splittergranaten ausgeräuchert' : 'Camper bekommen mehr Granaten']);
    if (T.longRange > 0.3) items.push([T.longRange, P.marksmen > 0 ? 'mehr Gegen-Scharfschützen, Rauch auf langen Sichtlinien' : 'mehr Deckung auf langen Sichtlinien']);
    if (T.closeRange > 0.3) items.push([T.closeRange, 'gegen deinen Nahkampf halten sie Winkel statt anzustürmen']);
    if (T.weakBehind > 0.3) items.push([T.weakBehind, 'mehr Flankenangriffe']);
    if (T.peeker > 0.3) items.push([T.peeker * 0.8, 'sie lehnen und liegen jetzt selbst öfter']);
    if (T.lanePref > 0.3) items.push([T.lanePref * 0.7, 'deine Lieblingsroute wird bewacht']);
    if (this.dangerMax >= 2) items.push([0.35, 'sie meiden Wege, auf denen du ihnen auflauerst']);
    if (T.fastReact > 0.4) items.push([T.fastReact * 0.6, 'mehr Deckung gegen deine schnellen Reaktionen']);
    if (!items.length) return 'Die Bots beobachten deinen Stil – mit jedem Match stellen sie sich gezielter darauf ein.';
    items.sort((a, b) => b[0] - a[0]);
    const txt = items.slice(0, 3).map((x) => x[1]);
    txt[0] = txt[0].charAt(0).toUpperCase() + txt[0].slice(1);
    return `Die Bots haben sich auf deinen Stil eingestellt: ${txt.join('; ')}.`;
  }

  /** Zustand für Prüfstand/Entwicklerwerkzeuge. */
  snapshot() {
    const r = (x) => Math.round(x * 100) / 100;
    const T = {};
    for (const k in this.traits) T[k] = r(this.traits[k]);
    const D = this._diff, B = this._base;
    const frozenOk = !D || !B || FROZEN.every((k) => JSON.stringify(D[k]) === JSON.stringify(B[k]));
    const tuned = D && B ? Object.fromEntries(['flank', 'cover', 'grenadeChance', 'strafeChance', 'peekChance', 'prone', 'chaseTime'].map((k) => [k, [r(B[k]), r(D[k])]])) : null;
    return { ms: +this.ms.toFixed(1), msMax: +this.msMax.toFixed(2), active: this.active, level: this.level, preset: this.preset, traits: T, plan: { ...this.plan }, spots: this.spots.map((s) => [r(s.pos.x), r(s.pos.z), r(s.w)]), counts: { ...this.counts }, frozenOk, tuned, camping: this.camping, cur: { t: r(this.cur.t), camp: r(this.cur.camp), k: this.cur.k, d: this.cur.d } };
  }
}
