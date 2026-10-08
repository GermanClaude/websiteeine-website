// NULLPUNKT – Mehrspieler: Anti-Cheat des Hosts (Vertrag §8). Reine Logik ohne DOM/three.js – in Node prüfbar
// (tools/net-proto-test.mjs). Der Host füttert sie mit den Zuständen, Schüssen und Treffermeldungen seiner Clients:
//
//   const ac = new AntiCheat({ onKick: (peer, reason, text) => net.kick(peer, text) });
//   ac.onSpawn(peer, [x, y, z], now)                         // Spawn/Teleport durch den Host (erlaubt)
//   ac.onState(peer, {x, y, z, flags}, now, {alive})          // → {ok, correct?:[x,y,z], reason, kick}
//   ac.onShot(peer, weaponDef, now)                           // → true = Feuerrate eingehalten
//   ac.validateHit(peer, claim, ctx)                          // → {ok, dmg, reason, kick}
//   ac.validateMelee(peer, claim, ctx)                        // → {ok, dmg, reason, kick}
//
// Bewegung, zwei Prüfungen je Zustand:
//   • Schritt: Abstand zum letzten gültigen Zustand ≤ max(teleport, vMax × Δt + slack) – Δt = Host-Zeit seit dem letzten
//     Zustand (höchstens 1 s). Gebündelt ankommende Pakete sind einzeln kurz; nach Paketverlust/Aussetzern wächst Δt mit.
//     Ein einzelner Sprung > 6 m (Rutschen ≈ 7 m) ohne Spawn → Rücksetzung (correct) + Verstoß 'teleport'.
//   • Budget: angesparte Laufstrecke (höchstens budgetWindow Sekunden) gegen Tempo-Hacks über mehrere Pakete ('tempo').
//   Aufwärts genauso (Schritt > max(teleportUp, Steigtempo × Δt + Stufe) bzw. Steig-Budget → 'steigen'), abwärts freier Fall.
// Nach Spawn/Rücksetzung gelten Schonfristen + Laufzeit (rtt), Zustände des vorigen Lebens werden still verworfen.
// Meldet der Client „tot“, während seine Puppe beim Host lebt (Spawn unterwegs), bleibt der Anker unverändert.
// Verstöße sind gewichtet und klingen mit der Zeit ab; ab `threshold` wird einmalig onKick(peer, grund, text) gerufen
// (und das Ergebnis trägt `kick`). Protokoll: ac.log = [{t, peer, reason, text, weight, score}] (für das Host-Menü).
import { damageAt, zoneMult } from '../../shared/weapons.data.js';
import { FLAGS } from './protocol.js';

/** Gewicht je Verstoß (Summe ≥ threshold → Kick). */
export const AC_WEIGHTS = Object.freeze({
  tempo: 2, teleport: 3, steigen: 2, korrektur: 2, feuerrate: 2, schaden: 5, reichweite: 3, position: 2, herkunft: 2,
  waffe: 4, ausruestung: 4, doppelt: 3, team: 1, sicht: 2, ungueltig: 1, flut: 1,
});

/** Lesbare Gründe (Protokoll im Host-Menü, Kick-Grund). */
export const AC_TEXT = Object.freeze({
  tempo: 'Bewegung zu schnell', teleport: 'Teleport', steigen: 'Steigt zu schnell', korrektur: 'Rücksetzung ignoriert',
  feuerrate: 'Feuerrate überschritten', schaden: 'Schaden zu hoch', reichweite: 'Treffer außer Reichweite',
  position: 'Ziel nicht am Trefferpunkt', herkunft: 'Schuss nicht von der eigenen Position', waffe: 'Unbekannte Waffe',
  ausruestung: 'Waffe nicht in der Ausrüstung', doppelt: 'Doppelte Treffermeldung', team: 'Treffer auf eigenes Team',
  sicht: 'Treffer ohne Sichtlinie (gehäuft)', ungueltig: 'Ungültige Meldung', flut: 'Nachrichtenflut',
});

export const AC_DEFAULTS = Object.freeze({
  tolerance: 0.35, // Bewegung: Höchsttempo je Zustand + 35 %
  slack: 0.75, // m Zusatz je Prüfung (Rundung, Interpolation)
  budgetWindow: 1.0, // s angesparte Bewegungszeit (gebündelte Pakete, kurze Aussetzer)
  teleport: 6, // m: Mindestgrenze eines einzelnen Schritts (darüber nur, wenn Δt × Tempo es erklärt)
  teleportUp: 3.5, // m: Mindestgrenze eines einzelnen Schritts nach oben
  stepWindow: 2.0, // s: höchstens so viel Host-Zeit erklärt einen einzelnen Schritt (Paketverlust, Aussetzer)
  // Höchsttempo (m/s) je Zustand – player.js: Gehen 5,4 · Sprint 8,2 · Ducken 2,6 · Liegen 1,05 · Rutschen +2,9
  // (Hang ≤ 11,8); in der Luft bleibt der Schwung (Rutschsprung ≈ 11 m/s)
  speeds: Object.freeze({ walk: 5.4, sprint: 8.2, crouch: 2.6, prone: 1.05, slide: 11.1, air: 9.5, swim: 4.5 }),
  boost: 1.25, // Waffen-Tempo (≤ 1,07) × Adrenalin (1,12) × Gefälle
  climb: 8, // m/s aufwärts (Sprung 7,3 m/s, Klettern)
  climbWindow: 0.5, // s angesparte Steigzeit (Steig-Budget)
  stepUp: 1.2, // m Stufen/Kanten ohne Budget
  fall: 45, // m/s abwärts (freier Fall)
  rpmTolerance: 0.2, // Feuerrate + 20 %
  burst: 3, // Schüsse, die sich durch Paketbündelung stauen dürfen
  hitRadius: 2.5, // m: Ziel muss so nah am gemeldeten Punkt gewesen sein …
  hitWindow: 0.4, // s: … irgendwann in diesem Zeitfenster (+ Laufzeit des Schützen + Interpolation beim Schützen)
  interp: 0.45, // s: Interpolation + Fortschreiben beim Schützen (sync-client: ≤ 0,4 s Puffer), falls ctx.interp fehlt
  maxRewind: 2, // s: weiter zurück wird nie geprüft (Positionsverlauf des Hosts ≥ so lang)
  targetHeight: 1.9, // m: Zielkörper als senkrechte Strecke ab der Fußposition
  originRadius: 3.5, // m: Schussursprung ↔ bekannte Position des Schützen
  rangeSlack: 1.05,
  meleeSlack: 1.75, // m Zusatzreichweite für Nahkampf (Latenz)
  damageMult: 1, // Spielstil (Realistisch: bulletMult 1,5)
  damageTolerance: 0.02,
  threshold: 20,
  decayPerSec: 0.05, // ≈ 3 Punkte je Minute
  minGap: 0.5, // s: derselbe Verstoß zählt höchstens so oft
  spawnGrace: 1.5, // s nach Spawn: Zustände des vorigen Lebens still verwerfen (+ Laufzeit ctx.rtt; Client-Bild ≤ 1 s)
  correctGrace: 0.75, // s nach Rücksetzung: Abweichungen ohne neuen Verstoß (Nachricht unterwegs, + Laufzeit ctx.rtt)
  correctRadius: 2.5, // m: so nah an der Rücksetzposition gilt die Rücksetzung als übernommen
  losWindow: 20, // weiche Sichtprüfung: letzte n Treffer …
  losRatio: 0.6, // … davon mindestens dieser Anteil ohne Sicht → Verstoß
  losMin: 10,
  serialMemory: 512,
  logMax: 300,
  weights: AC_WEIGHTS,
  onKick: null,
});

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Position aus [x,y,z] | {x,y,z} | {pos:[…]} | {position:{…}} lesen → [x,y,z] oder null. */
export function readPos(s) {
  if (!s) return null;
  if (Array.isArray(s)) return s.length >= 3 && num(s[0]) && num(s[1]) && num(s[2]) ? [s[0], s[1], s[2]] : null;
  if (num(s.x) && num(s.y) && num(s.z)) return [s.x, s.y, s.z];
  if (s.pos) return readPos(s.pos);
  if (s.position) return readPos(s.position);
  return null;
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const distH = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Abstand eines Punkts zur senkrechten Strecke [foot.y, foot.y + h] über der Fußposition. */
export function distToBody(point, foot, h) {
  const dy = point[1] < foot[1] ? foot[1] - point[1] : point[1] > foot[1] + h ? point[1] - (foot[1] + h) : 0;
  return Math.hypot(point[0] - foot[0], dy, point[2] - foot[2]);
}

/**
 * Positionsverlauf je Akteur (Ringpuffer) für die Trefferprüfung: record(id, t, x, y, z); range(id, t0, t1).
 * Der Host trägt hier jeden Simulationsschritt alle Akteure ein (Bots, Host-Spieler, Puppen).
 */
export class PositionHistory {
  constructor(seconds = 1.5) {
    this.seconds = seconds;
    this.map = new Map();
  }

  record(id, t, x, y, z) {
    let list = this.map.get(id);
    if (!list) this.map.set(id, (list = []));
    list.push({ t, x, y, z });
    const cut = t - this.seconds;
    let drop = 0;
    while (drop < list.length - 1 && list[drop].t < cut) drop++;
    if (drop) list.splice(0, drop);
  }

  /** Stichproben im Zeitraum [t0, t1] (plus je eine davor/danach, damit Lücken abgedeckt sind). */
  range(id, t0, t1) {
    const list = this.map.get(id);
    if (!list || !list.length) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.t >= t0 && s.t <= t1) out.push(s);
      else if (s.t < t0 && (i + 1 >= list.length || list[i + 1].t >= t0)) out.push(s);
      else if (s.t > t1) { out.push(s); break; }
    }
    return out;
  }

  latest(id) {
    const list = this.map.get(id);
    return list && list.length ? list[list.length - 1] : null;
  }

  remove(id) { this.map.delete(id); }
  clear() { this.map.clear(); }
}

export class AntiCheat {
  constructor(opts = {}) {
    this.opts = { ...AC_DEFAULTS, ...opts, speeds: { ...AC_DEFAULTS.speeds, ...(opts.speeds || {}) }, weights: { ...AC_WEIGHTS, ...(opts.weights || {}) } };
    this.peers = new Map();
    /** Protokoll [{t, peer, reason, text, weight, score}] (neueste zuletzt). */
    this.log = [];
  }

  _peer(id) {
    let p = this.peers.get(id);
    if (!p) {
      p = {
        id, pos: null, t: 0, flags: 0, budgetH: 0, budgetUp: 0, score: 0, scoreAt: 0, kicked: false, strikes: 0,
        spawnPos: null, spawnAt: -1e9, correctPos: null, correctAt: -1e9, lastStrike: new Map(),
        shotBuckets: new Map(), hitBuckets: new Map(), serials: new Set(), serialOrder: [], los: [],
      };
      this.peers.set(id, p);
    }
    return p;
  }

  /** Client entfernen (Austritt). */
  remove(id) { this.peers.delete(id); }

  /** Alles vergessen (neues Match) – Protokoll bleibt, außer clearLog. */
  reset({ clearLog = false } = {}) {
    this.peers.clear();
    if (clearLog) this.log.length = 0;
  }

  /** Aktueller Verstoß-Stand eines Clients. */
  score(id, nowSec) {
    const p = this.peers.get(id);
    if (!p) return 0;
    return num(nowSec) ? Math.max(0, p.score - this.opts.decayPerSec * Math.max(0, nowSec - p.scoreAt)) : p.score;
  }

  /**
   * Verstoß verbuchen. Gibt {counted, score, kick} zurück; kick = Grund, sobald die Schwelle erstmals erreicht ist.
   * Derselbe Grund zählt höchstens alle opts.minGap Sekunden (ein Aussetzer erzeugt keine Lawine).
   */
  strike(id, reason, nowSec, detail = null) {
    const o = this.opts;
    const p = this._peer(id);
    const last = p.lastStrike.get(reason);
    if (last != null && nowSec - last < o.minGap) return { counted: false, score: this.score(id, nowSec), kick: null };
    p.lastStrike.set(reason, nowSec);
    const weight = o.weights[reason] ?? 1;
    p.score = this.score(id, nowSec) + weight;
    p.scoreAt = nowSec;
    p.strikes++;
    const entry = { t: nowSec, peer: id, reason, text: AC_TEXT[reason] || reason, weight, score: Math.round(p.score * 10) / 10 };
    if (detail != null) entry.detail = detail;
    this.log.push(entry);
    if (this.log.length > o.logMax) this.log.splice(0, this.log.length - o.logMax);
    let kick = null;
    if (!p.kicked && p.score >= o.threshold) {
      p.kicked = true;
      kick = reason;
      entry.kick = true;
      if (typeof o.onKick === 'function') {
        try { o.onKick(id, reason, AC_TEXT[reason] || reason); } catch (err) { console.warn('[net] Anti-Cheat onKick', err); }
      }
    }
    return { counted: true, score: p.score, kick };
  }

  /* ------------------------------------------------------------ Bewegung */

  /** Host setzt den Client (Spawn, Modus-Teleport): neue Ausgangsposition, alte Zustände werden kurz verworfen. */
  onSpawn(id, pos, nowSec) {
    const p = this._peer(id);
    const v = readPos(pos);
    p.pos = v;
    p.t = nowSec;
    p.spawnPos = v;
    p.spawnAt = nowSec;
    p.correctPos = null;
    p.flags = 0; // erster Schritt nach dem Spawn: großzügigstes Tempo (Luft)
    p.budgetH = this._capH(this.opts.speeds.sprint);
    p.budgetUp = this.opts.stepUp;
  }

  /** Alias für Teleports durch den Host (z. B. Modus setzt den Spieler um). */
  onTeleport(id, pos, nowSec) { this.onSpawn(id, pos, nowSec); }

  /** Rücksetzung, die der Host von sich aus geschickt hat (z. B. aus der Karte gefallen). */
  onCorrect(id, pos, nowSec) {
    const p = this._peer(id);
    p.correctPos = readPos(pos);
    p.correctAt = nowSec;
  }

  _speedFor(flags) {
    const s = this.opts.speeds;
    const f = typeof flags === 'number' ? flags : 0;
    if (f & FLAGS.SLIDING) return s.slide;
    if (f & FLAGS.SWIMMING) return s.swim;
    // Liegen/Ducken nur, wenn nicht gleichzeitig Sprint gemeldet (Übergänge) – höherer Wert gewinnt
    if (f & FLAGS.SPRINT) return s.sprint;
    if (!(f & FLAGS.ON_GROUND)) return Math.max(s.air, s.sprint);
    if (f & FLAGS.PRONE) return s.prone;
    if (f & FLAGS.CROUCH) return s.crouch;
    return s.walk;
  }

  _capH(speed) {
    const o = this.opts;
    return speed * o.boost * (1 + o.tolerance) * o.budgetWindow + o.slack;
  }

  _capUp() {
    const o = this.opts;
    return o.climb * (1 + o.tolerance) * o.climbWindow + o.stepUp;
  }

  /**
   * Zustand eines Clients prüfen. state: {x,y,z,flags} (decodeState().entity) oder {pos:[x,y,z], flags}.
   * ctx: { alive?: bool (Puppe lebt beim Host), clientAlive?: bool (Client meldet „lebt“), rtt?: s }.
   *   alive === false → nicht geprüft, neuer Anker beim nächsten Spawn/Zustand.
   *   clientAlive === false bei lebender Puppe (Spawn unterwegs) → verworfen, Anker bleibt.
   * → { ok, reason, correct?: [x,y,z] (Rücksetzposition, Host schickt 'correct'), kick: grund|null }
   */
  onState(id, state, nowSec, ctx = {}) {
    const o = this.opts;
    const p = this._peer(id);
    const pos = readPos(state);
    if (!pos) return { ok: false, reason: 'ungueltig', kick: this.strike(id, 'ungueltig', nowSec).kick };
    if (ctx.alive === false) { p.pos = null; return { ok: true, reason: 'tot', kick: null }; }
    if (ctx.clientAlive === false) return { ok: false, reason: 'tot-client', kick: null };
    const flags = typeof state.flags === 'number' ? state.flags : 0;
    if (!p.pos) {
      p.pos = pos; p.t = nowSec; p.flags = flags;
      p.budgetH = this._capH(o.speeds.sprint); p.budgetUp = o.stepUp;
      return { ok: true, reason: 'anker', kick: null };
    }
    const rtt = num(ctx.rtt) ? Math.min(1.5, Math.max(0, ctx.rtt)) : 0;
    // Nach einem Spawn kommen noch Zustände aus dem vorigen Leben an – still verwerfen
    if (p.spawnPos) {
      if (nowSec - p.spawnAt < o.spawnGrace + rtt && dist3(pos, p.spawnPos) > o.teleport) return { ok: false, reason: 'veraltet', kick: null };
      p.spawnPos = null;
    }
    // Rücksetzung unterwegs: abwarten, bis der Client sie übernommen hat
    if (p.correctPos) {
      if (dist3(pos, p.correctPos) <= o.correctRadius) {
        p.pos = pos; p.t = nowSec; p.correctPos = null; p.flags = flags;
        p.budgetH = 0; p.budgetUp = o.stepUp;
        return { ok: true, reason: 'korrigiert', kick: null };
      }
      if (nowSec - p.correctAt < o.correctGrace + rtt) return { ok: false, reason: 'korrektur', correct: null, kick: null };
      p.correctAt = nowSec;
      const s = this.strike(id, 'korrektur', nowSec);
      return { ok: false, reason: 'korrektur', correct: p.correctPos.slice(), kick: s.kick };
    }
    const dt = Math.min(2, Math.max(0, nowSec - p.t));
    // Budget nach dem gemeldeten Zustand; der einzelne Schritt darf bei Übergängen (Sprint → Rutschen, Rutschen →
    // Sprung) das schnellere der beiden Zustandstempi nutzen
    const speed = this._speedFor(flags);
    const vMax = speed * o.boost * (1 + o.tolerance);
    const vStep = Math.max(speed, this._speedFor(p.flags)) * o.boost * (1 + o.tolerance);
    // Obergrenze des Budgets: budgetWindow – hing der Host länger (langes Bild, die Zustände der Lücke kommen danach
    // gebündelt an), gilt für dieses Bündel (0,25 s Host-Zeit) die ganze Lücke (höchstens stepWindow)
    const climb = o.climb * (1 + o.tolerance);
    const gap = Math.min(dt, o.stepWindow);
    if (vMax * gap + o.slack > this._capH(speed)) { p.capH = vMax * gap + o.slack; p.capUp = climb * gap + o.stepUp; p.capUntil = nowSec + 0.25; }
    const burst = nowSec <= (p.capUntil || -1);
    const capH = burst ? Math.max(this._capH(speed), p.capH) : this._capH(speed);
    const budgetH = Math.min(capH, p.budgetH + vMax * dt);
    const budgetUp = Math.min(burst ? Math.max(this._capUp(), p.capUp) : this._capUp(), p.budgetUp + climb * dt);
    const hd = distH(pos, p.pos);
    const dy = pos[1] - p.pos[1];
    const stepDt = Math.min(o.stepWindow, dt);
    const stepH = Math.max(o.teleport, vStep * stepDt + o.slack);
    const stepUp = Math.max(o.teleportUp, climb * stepDt + o.stepUp + o.slack);
    // Budget darf ins Minus gehen (Defizit bleibt bestehen) – erst unter −slack ist es ein Verstoß
    const afterH = budgetH - hd;
    const afterUp = budgetUp - Math.max(0, dy);
    let reason = null;
    if (hd > stepH) reason = 'teleport';
    else if (-dy > o.fall * dt + o.teleport) reason = 'teleport';
    else if (dy > stepUp) reason = 'steigen';
    else if (afterH < -o.slack) reason = 'tempo';
    else if (afterUp < -o.slack) reason = 'steigen';
    if (reason) {
      p.correctPos = p.pos.slice();
      p.correctAt = nowSec;
      p.t = nowSec;
      p.budgetH = Math.max(0, budgetH);
      p.budgetUp = Math.max(0, budgetUp);
      const s = this.strike(id, reason, nowSec, { dist: Math.round(Math.hypot(hd, dy) * 100) / 100, dt: Math.round(dt * 1000) / 1000 });
      return { ok: false, reason, correct: p.correctPos.slice(), kick: s.kick };
    }
    p.budgetH = afterH;
    p.budgetUp = afterUp;
    p.pos = pos;
    p.t = nowSec;
    p.flags = flags;
    return { ok: true, reason: 'ok', kick: null };
  }

  /* ------------------------------------------------------------ Feuerrate */

  _bucket(map, def, nowSec) {
    const o = this.opts;
    const rate = (Math.max(1, def.rpm || 60) * (1 + o.rpmTolerance)) / 60;
    const cap = o.burst + (def.fireMode === 'burst' && def.burstCount > 1 ? def.burstCount : 0);
    let b = map.get(def.id);
    if (!b) map.set(def.id, (b = { tokens: cap, t: nowSec }));
    b.tokens = Math.min(cap, b.tokens + Math.max(0, nowSec - b.t) * rate);
    b.t = nowSec;
    if (b.tokens >= 1 - 1e-9) { b.tokens -= 1; return true; }
    return false;
  }

  /** Ein Schuss des Clients (z. B. aus dem Schusszähler des Zustands). false = schneller als rpm + 20 %. */
  onShot(id, weaponDef, nowSec) {
    if (!weaponDef || !weaponDef.id) { this.strike(id, 'waffe', nowSec); return false; }
    const p = this._peer(id);
    if (this._bucket(p.shotBuckets, weaponDef, nowSec)) return true;
    this.strike(id, 'feuerrate', nowSec, weaponDef.id);
    return false;
  }

  /* ------------------------------------------------------------ Treffer */

  _def(ctx, wid) {
    if (!wid || typeof wid !== 'string') return null;
    if (typeof ctx.weaponDef === 'function') return ctx.weaponDef(wid) || null;
    if (ctx.weapons && typeof ctx.weapons === 'object') return ctx.weapons[wid] || null;
    return null;
  }

  _history(ctx, targetId, t0, t1) {
    const h = ctx.history;
    if (typeof h === 'function') return h(targetId, t0, t1) || [];
    if (h && typeof h.range === 'function') return h.range(targetId, t0, t1);
    const tp = ctx.target && readPos(ctx.target.pos || ctx.target.position || null);
    return tp ? [{ t: t1, x: tp[0], y: tp[1], z: tp[2] }] : [];
  }

  /**
   * Wie weit der Zielverlauf zurück geprüft wird (s): Grundfenster + Laufzeit des Schützen (rtt, Hin- und Rückweg) +
   * seine Interpolation/Fortschreibung (ctx.interp) – der Schütze sah das Ziel so weit in der Vergangenheit.
   */
  _rewind(ctx) {
    const o = this.opts;
    const rtt = num(ctx.rtt) ? Math.min(1, Math.max(0, ctx.rtt)) : 0;
    const interp = num(ctx.interp) ? Math.min(1, Math.max(0, ctx.interp)) : o.interp;
    return Math.min(o.maxRewind, o.hitWindow + rtt + interp);
  }

  _reject(id, reason, nowSec, detail) {
    const s = AC_WEIGHTS[reason] != null ? this.strike(id, reason, nowSec, detail) : { kick: null };
    return { ok: false, dmg: 0, reason, kick: s.kick };
  }

  /** Gemeinsame Prüfungen für Schuss- und Nahkampftreffer. → null (weiter) oder Ablehnung. */
  _common(id, claim, ctx, nowSec, def) {
    const sh = ctx.shooter || null;
    const tg = ctx.target || null;
    if (!def) return this._reject(id, 'waffe', nowSec, claim && claim.weapon);
    if (sh && Array.isArray(sh.weapons) && !sh.weapons.includes(def.id)) return this._reject(id, 'ausruestung', nowSec, def.id);
    // Tote Schützen/Ziele: Latenz (Schuss vor dem eigenen Tod abgegeben) – ablehnen ohne Verstoß
    if (sh && sh.alive === false) return { ok: false, dmg: 0, reason: 'schuetze-tot', kick: null };
    if (!tg || tg.alive === false) return { ok: false, dmg: 0, reason: 'ziel-tot', kick: null };
    if (!ctx.ffa && sh && sh.team && tg.team && sh.team === tg.team) return this._reject(id, 'team', nowSec);
    // Doppelte Meldung (Seriennummer + Schrotkugel)
    const pellet = Number.isInteger(claim.pellet) ? claim.pellet : 0;
    if (pellet < 0 || pellet >= Math.max(1, def.pellets || 1)) return this._reject(id, 'ungueltig', nowSec, 'pellet');
    const p = this._peer(id);
    const serial = Number.isFinite(claim.serial) ? claim.serial : null;
    if (serial != null) {
      const key = `${def.id}:${serial}:${pellet}:${claim.target}`;
      if (p.serials.has(key)) return this._reject(id, 'doppelt', nowSec);
      p.serials.add(key);
      p.serialOrder.push(key);
      if (p.serialOrder.length > this.opts.serialMemory) p.serials.delete(p.serialOrder.shift());
      // Neue Schussnummer → Feuerrate (unabhängig von onShot)
      const shotKey = `${def.id}:${serial}`;
      if (!p.serials.has(shotKey)) {
        p.serials.add(shotKey);
        p.serialOrder.push(shotKey);
        if (!this._bucket(p.hitBuckets, def, nowSec)) return this._reject(id, 'feuerrate', nowSec, def.id);
      }
    }
    return null;
  }

  _damageCap(def, ctx) {
    const o = this.opts;
    const mult = num(ctx.damageMult) ? ctx.damageMult : o.damageMult;
    const zoneMax = Math.max(1, def.headMult || 1, def.limbMult || 1);
    return { mult, abs: (def.damage ? def.damage.max : 0) * zoneMax * mult * (1 + o.damageTolerance) };
  }

  /**
   * Treffermeldung prüfen. claim (Vertrag §4 'hit'): {target, zone, dmg, weapon, dist, origin:[x,y,z], point:[x,y,z],
   * serial, pellet}. ctx: {
   *   now (s, Host-Zeit), ffa, damageMult?, rtt? (s, Laufzeit des Schützen – verlängert das Zeitfenster),
   *   weaponDef(id) | weapons {id: def},
   *   shooter: {alive, team, pos, weapons:[ids der Ausrüstung]}, target: {alive, team, pos?},
   *   history(targetId, t0, t1) → [{t,x,y,z}] | PositionHistory, los?(origin, point) → bool (weich)
   * }
   * → {ok, dmg (vom Host anzuwenden, ≤ Meldung), reason, kick}
   */
  validateHit(id, claim, ctx = {}) {
    const o = this.opts;
    const nowSec = num(ctx.now) ? ctx.now : 0;
    if (!claim || typeof claim !== 'object') return this._reject(id, 'ungueltig', nowSec);
    const def = this._def(ctx, claim.weapon);
    const common = this._common(id, claim, ctx, nowSec, def);
    if (common) return common;
    const origin = readPos(claim.origin);
    const point = readPos(claim.point);
    if (!origin || !point || !num(claim.dmg) || claim.dmg < 0) return this._reject(id, 'ungueltig', nowSec);
    const dist = dist3(origin, point);
    if (dist > (def.range || 0) * o.rangeSlack + 1) return this._reject(id, 'reichweite', nowSec, Math.round(dist));
    const shooterPos = ctx.shooter && readPos(ctx.shooter.pos || ctx.shooter.position || null);
    if (shooterPos && distToBody(origin, shooterPos, o.targetHeight) > o.originRadius) return this._reject(id, 'herkunft', nowSec);
    const samples = this._history(ctx, claim.target, nowSec - this._rewind(ctx), nowSec);
    if (samples.length) {
      let best = Infinity;
      for (const s of samples) best = Math.min(best, distToBody(point, readPos(s), o.targetHeight));
      if (best > o.hitRadius) return this._reject(id, 'position', nowSec, Math.round(best * 10) / 10);
    }
    const cap = this._damageCap(def, ctx);
    if (claim.dmg > cap.abs) return this._reject(id, 'schaden', nowSec, Math.round(claim.dmg));
    const zone = claim.zone === 'head' || claim.zone === 'limb' ? claim.zone : 'body';
    const hostMax = damageAt(def, Math.max(0, dist - 1.5)) * zoneMult(def, zone) * cap.mult * (1 + o.damageTolerance);
    const dmg = Math.max(0, Math.min(claim.dmg, hostMax));
    // Weiche Sichtprüfung: nur gehäufte Treffer ohne Sichtlinie zählen (Vegetation je Grafikstufe verschieden)
    if (typeof ctx.los === 'function') {
      const p = this._peer(id);
      let seen = true;
      try { seen = !!ctx.los(origin, point); } catch { seen = true; }
      p.los.push(seen ? 0 : 1);
      if (p.los.length > o.losWindow) p.los.shift();
      const miss = p.los.reduce((a, b) => a + b, 0);
      if (p.los.length >= o.losMin && miss / p.los.length >= o.losRatio) {
        p.los.length = 0;
        const s = this.strike(id, 'sicht', nowSec);
        return { ok: true, dmg, reason: 'sicht', kick: s.kick };
      }
    }
    return { ok: true, dmg, reason: 'ok', kick: null };
  }

  /**
   * Nahkampftreffer prüfen. claim: {target, weapon, serial}. ctx wie validateHit (shooter.pos und Zielverlauf
   * bzw. target.pos für die Entfernung). → {ok, dmg, reason, kick}
   */
  validateMelee(id, claim, ctx = {}) {
    const o = this.opts;
    const nowSec = num(ctx.now) ? ctx.now : 0;
    if (!claim || typeof claim !== 'object') return this._reject(id, 'ungueltig', nowSec);
    const def = this._def(ctx, claim.weapon);
    if (def && def.cls !== 'melee') return this._reject(id, 'ungueltig', nowSec, 'kein Nahkampf');
    const common = this._common(id, claim, ctx, nowSec, def);
    if (common) return common;
    const shooterPos = ctx.shooter && readPos(ctx.shooter.pos || ctx.shooter.position || null);
    if (shooterPos) {
      const samples = this._history(ctx, claim.target, nowSec - this._rewind(ctx), nowSec);
      if (samples.length) {
        let best = Infinity;
        for (const s of samples) best = Math.min(best, distH(shooterPos, readPos(s)));
        if (best > (def.range || 2.5) + o.meleeSlack) return this._reject(id, 'reichweite', nowSec, Math.round(best * 10) / 10);
      }
    }
    const cap = this._damageCap(def, ctx);
    const want = num(claim.dmg) ? claim.dmg : def.damage.max * cap.mult;
    return { ok: true, dmg: Math.max(0, Math.min(want, cap.abs)), reason: 'ok', kick: null };
  }
}
