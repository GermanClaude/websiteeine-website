// NULLPUNKT — Befehle des Spielers an verbündete Bots (Befehlsrad, ui/command-wheel.js; online schickt ein Client 'order'
// an den Host, net/sync-host.js → BotManager.issueOrder). Ein Befehl liegt als `bot.command` am Bot und hat Vorrang vor
// Truppbefehlen (ai/squad.js lässt befehligte Bots in Ruhe, ihr `bot.order` bleibt leer) und Missionszielen. Das Hirn
// (ai/brain.js) bleibt zuständig für Granaten ausweichen, Zurückschießen und Deckung – der Befehl legt fest, wo der Bot
// kämpft und wohin er sich bewegt (Zielart 'command', Prüfstand „Befehl“):
//   follow     „Mir folgen“: lockere Doppelreihe hinter dem Anführer (je Bot ein Platz, vorausberechnet aus seinem Tempo);
//              im Gefecht frei kämpfen, aber an der Leine (> 12 m vom Platz → feuernd zurück zum Platz)
//   formation  wie follow, Form Reihe | Keil | Kreis (Kreis: rundum um den Anführer, Blick nach außen, steht er: hocken)
//   hold       „Position halten“: Stelle beim Befehl (Deckung ≤ 3 m in Blickrichtung des Anführers), geduckt, kämpft von dort
//   regroup    „Sammeln“: zum Anführer sprinten, enger Ring, rundum sichern; zieht er > 8 m weiter, sammeln sie neu
//   attack     „Angreifen“: Punkt unter dem Fadenkreuz bzw. Gegner im Fadenkreuz (Funkmeldung an alle) – breite Linie,
//              vorrücken und dabei feuern (nahe Gegner < 22 m werden normal bekämpft), am Ziel 12 s sichern, dann frei;
//              Ziel tot oder 75 s um → frei
//   defend     „Verteidigen“: Halbkreis um den Punkt, zur Feindseite (Deckung bevorzugt), halten wie hold
//   spread     „Ausschwärmen“: fächern links/rechts um den Zielpunkt auf (Flanken, Kreuzfeuer), 10 s halten, dann frei
//   free       „Frei handeln“: Befehl aufheben
// Ende: Tod des Bots (`bot.spawnTime` ≠ `command.life`), Ablauf (`until`), Anführer verlässt das Match. Solange der Anführer
// tot ist, ruhen die anführerbezogenen Befehle (follow/formation/regroup) – der Bot handelt dann frei.
// Quittung: nach dem Befehl dreht sich der Bot kurz zum Anführer (≤ 35 m, ohne sichtbaren Gegner).
import * as THREE from 'three';
import { analyze, findCover } from './tactics.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ack = new THREE.Vector3();

/** Reihenfolge im Rad (im Uhrzeigersinn ab oben). */
export const ORDER_IDS = Object.freeze(['follow', 'hold', 'regroup', 'formation', 'attack', 'defend', 'spread', 'free']);
/** label/hint: Rad und Meldungen; dur: Laufzeit in s; point: braucht den Punkt unter dem Fadenkreuz. */
export const ORDER_DEFS = Object.freeze({
  follow: { label: 'Mir folgen', hint: 'Locker hinter dir, im Gefecht an deiner Seite.', dur: 900 },
  hold: { label: 'Position halten', hint: 'Bleiben, wo sie sind – geduckt in Deckung.', dur: 600 },
  regroup: { label: 'Sammeln', hint: 'Sofort zu dir, enger Ring, rundum sichern.', dur: 150 },
  formation: { label: 'Formation', hint: 'Reihe, Keil oder Kreis um dich.', dur: 900 },
  attack: { label: 'Angreifen', hint: 'Ziel im Fadenkreuz angreifen.', dur: 75, point: true },
  defend: { label: 'Verteidigen', hint: 'Punkt im Fadenkreuz halten.', dur: 600, point: true },
  spread: { label: 'Ausschwärmen', hint: 'Breit auffächern und flankieren.', dur: 50, point: true },
  free: { label: 'Frei handeln', hint: 'Befehle aufheben, eigene Entscheidung.', dur: 0 },
});
/** Formen für „Formation“ (das Rad wechselt reihum). */
export const FORMATIONS = Object.freeze(['reihe', 'keil', 'kreis']);
export const FORMATION_LABELS = Object.freeze({ locker: 'Locker', reihe: 'Reihe', keil: 'Keil', kreis: 'Kreis' });
/** Reichweite eines Befehls (m um den Anführer) und höchstens so viele Bots. */
export const ORDER_RADIUS = 40;
export const ORDER_MAX = 12;
/** Befehle, die am Anführer hängen (ruhen, solange er tot ist). */
const LEADER_KINDS = new Set(['follow', 'formation', 'regroup']);
/** Befehle mit fester Stellung (kämpfen nur von dort). */
const ANCHOR_KINDS = new Set(['hold', 'defend']);
const ACK = 0.9; // s: Quittung (Blick zum Anführer)
const ATTACK_SECURE = 12; // s am Angriffsziel sichern
const SPREAD_HOLD = 10; // s in der Flanke halten

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/* ================================================================ Anführer */

const _lead = new WeakMap();

/**
 * Bewegungszustand des Anführers (für alle Bots gleich, aus Positionsänderungen – gilt auch für Puppen ohne
 * Geschwindigkeit): Tempo, Laufrichtung bzw. Blickrichtung (steht er), mit Hysterese 1,5/0,8 m/s.
 */
function leaderState(leader, now) {
  const p = leader.position;
  let s = _lead.get(leader);
  if (!s) {
    s = { px: p.x, pz: p.z, at: now, vx: 0, vz: 0, hx: 0, hz: -1, speed: 0, moving: false };
    _lead.set(leader, s);
  }
  const dt = now - s.at;
  if (dt >= 0.15 || dt < 0) {
    if (dt > 0 && dt < 2) {
      const k = Math.min(1, dt * 4);
      s.vx += ((p.x - s.px) / dt - s.vx) * k;
      s.vz += ((p.z - s.pz) / dt - s.vz) * k;
    } else { s.vx = 0; s.vz = 0; }
    s.px = p.x; s.pz = p.z; s.at = now;
  }
  const sp = Math.hypot(s.vx, s.vz);
  s.speed = sp;
  s.moving = s.moving ? sp > 0.8 : sp > 1.5;
  if (s.moving && sp > 0.3) { s.hx = s.vx / sp; s.hz = s.vz / sp; }
  else {
    const yaw = Number.isFinite(leader.yaw) ? leader.yaw : 0;
    s.hx = -Math.sin(yaw); s.hz = -Math.cos(yaw);
  }
  return s;
}

/** Versatz eines Platzes (vorwärts f, rechts r in m) je Form; Kreis/Ring: Weltwinkel (dreht nicht mit). */
function slotOffset(shape, k, n, out) {
  if (shape === 'reihe') { out.f = -(2.8 + k * 2.3); out.r = (k % 2 ? 0.35 : -0.35); out.world = false; return out; }
  if (shape === 'keil') {
    const row = Math.floor(k / 2) + 1;
    out.f = -(1.2 + row * 2.3); out.r = (k % 2 ? 1 : -1) * row * 2.3; out.world = false; return out;
  }
  if (shape === 'kreis' || shape === 'ring') {
    const a = (k / Math.max(1, n)) * Math.PI * 2 + 0.4;
    const R = shape === 'ring' ? clamp(2.2 + n * 0.25, 2.4, 4.5) : clamp(2.6 + n * 0.4, 3, 6.5);
    out.f = Math.cos(a) * R; out.r = Math.sin(a) * R; out.world = true; return out;
  }
  // locker: Doppelreihe, versetzt
  const row = Math.floor(k / 2);
  out.f = -(2.6 + row * 2.3); out.r = (k % 2 ? 1 : -1) * (1.7 + row * 0.35); out.world = false;
  return out;
}

/* ================================================================ Erteilen */

let _nextId = 1;

function navOf(G) { return G.world && G.world.nav; }

/** Begehbarer Punkt nahe p (≤ maxD, ähnliche Höhe) – sonst null. */
function walkable(G, p, maxD = 3.5) {
  const nav = navOf(G);
  if (!nav || typeof nav.nearest !== 'function') return null;
  const n = nav.nearest(p);
  if (!n || flat(n.position, p) > maxD || Math.abs(n.position.y - p.y) > 2.2) return null;
  return n.position;
}

/** Freie Sicht auf Brusthöhe zwischen a und b? */
function clear(G, a, b) {
  const W = G.world;
  if (!W || typeof W.lineOfSight !== 'function') return true;
  _a.set(a.x, a.y + 1.1, a.z);
  _b.set(b.x, b.y + 1.1, b.z);
  return W.lineOfSight(_a, _b);
}

/** Feindseite (Spawn des Gegners) eines Teams → Vector3 | null. */
function enemySide(G, team) {
  const A = analyze(G.world);
  if (!A) return null;
  return team === 'B' ? A.sa : A.sb;
}

/**
 * Befehl an Bots erteilen (BotManager.issueOrder sucht sie aus). kind: ORDER_IDS; leader: befehlender Akteur;
 * o: { point (Vector3), target (Akteur), formation }. 'free' löscht. → Anzahl betroffener Bots.
 */
export function issueCommand(G, bots, leader, kind, o = {}, now = 0) {
  if (!ORDER_DEFS[kind]) return 0;
  if (kind === 'free') {
    for (const b of bots) { b.command = null; b._thinkT = Math.min(b._thinkT, 0.05); }
    return bots.length;
  }
  const def = ORDER_DEFS[kind];
  const lp = leader.position;
  const L = leaderState(leader, now);
  // Punkt: Fadenkreuz, sonst 30 m voraus; Ziel-Akteur: dessen Position
  const target = kind === 'attack' && o.target && o.target.alive ? o.target : null;
  let point = null;
  if (target) point = target.position.clone();
  else if (o.point && Number.isFinite(o.point.x)) point = o.point.clone();
  else if (def.point) point = new THREE.Vector3(lp.x + L.hx * 30, lp.y, lp.z + L.hz * 30);
  // Zielpunkt auf begehbaren Boden (Treffer an Wand/Decke → nächster Knoten)
  if (point && !target) { const w = walkable(G, point, 8); if (w) point.copy(w); }
  const shape = kind === 'follow' ? 'locker' : kind === 'formation' ? (FORMATIONS.includes(o.formation) ? o.formation : 'keil') : kind === 'regroup' ? 'ring' : null;
  // Plätze: nächster Bot bekommt den nächsten Platz
  const list = [...bots].sort((a, b) => a.position.distanceToSquared(lp) - b.position.distanceToSquared(lp));
  const n = list.length;
  const id = _nextId++;
  // Anmarschrichtung (Anführer → Punkt) und Feindseite
  const u = new THREE.Vector3(L.hx, 0, L.hz);
  if (point) { u.set(point.x - lp.x, 0, point.z - lp.z); if (u.lengthSq() < 1) u.set(L.hx, 0, L.hz); u.normalize(); }
  const enemy = enemySide(G, leader.team);
  for (let k = 0; k < n; k++) {
    const b = list[k];
    const c = {
      kind, by: leader, id, issued: now, until: now + def.dur, life: b.spawnTime, slot: k, slots: n, shape,
      formation: kind === 'formation' ? shape : null, point: point ? point.clone() : null, target,
      pos: new THREE.Vector3().copy(b.position), lookAt: new THREE.Vector3(), hasLook: false, crouch: false,
      spot: null, arrivedAt: 0, ackUntil: now + ACK, rally: null, failAt: 0, dir: u.clone(),
    };
    if (kind === 'hold') {
      // Blickrichtung des Anführers; Deckung ≤ 3 m gegen diese Richtung
      _v.set(b.position.x + L.hx * 25, b.position.y, b.position.z + L.hz * 25);
      const nav = navOf(G);
      const cn = nav && nav.coverNear ? nav.coverNear(b.position, _v, 3) : null;
      c.spot = cn ? cn.position.clone() : (walkable(G, b.position, 1.5) || b.position).clone();
      c.lookAt.set(c.spot.x + L.hx * 25, c.spot.y + 1.2, c.spot.z + L.hz * 25);
      c.hasLook = true;
    } else if (kind === 'defend') {
      c.spot = defendSpot(G, point, enemy, u, k, n);
      _v.subVectors(c.spot, point).setY(0);
      if (_v.lengthSq() < 0.5) _v.copy(enemy ? _w.subVectors(enemy, point).setY(0) : u);
      _v.normalize();
      c.lookAt.set(c.spot.x + _v.x * 25, c.spot.y + 1.2, c.spot.z + _v.z * 25);
      c.hasLook = true;
    } else if (kind === 'attack' && !target) {
      c.spot = lineSpot(G, point, u, k, n, 2.5);
    } else if (kind === 'spread') {
      c.spot = flankSpot(G, point, lp, u, k);
    } else if (kind === 'regroup') {
      c.rally = (walkable(G, lp, 3) || lp).clone();
    }
    // Ziel im Fadenkreuz: allen bekannt machen (Funk)
    if (target && b.memory && typeof b.memory.hear === 'function') b.memory.hear(target, target.position, now, 3, 'radio');
    b.command = c;
    if (b.order) b.order.kind = null;
    b.coverNode = null;
    b._thinkT = Math.min(b._thinkT, 0.05 + k * 0.04);
  }
  return n;
}

/** Stellung k von n im Halbkreis um den Punkt zur Feindseite (Deckung gegen außen bevorzugt). */
function defendSpot(G, P, enemy, u, k, n) {
  _w.copy(enemy || P).sub(P).setY(0);
  if (_w.lengthSq() < 4) _w.copy(u);
  _w.normalize();
  const base = Math.atan2(_w.x, _w.z);
  const a = base + (n > 1 ? (k / (n - 1) - 0.5) * 2.6 : 0);
  const R = clamp(3.5 + n * 0.5, 4, 8);
  _v.set(P.x + Math.sin(a) * R, P.y, P.z + Math.cos(a) * R);
  const nav = navOf(G);
  _a.set(P.x + Math.sin(a) * 30, P.y, P.z + Math.cos(a) * 30);
  const cn = nav && nav.coverNear ? nav.coverNear(_v, _a, 3.5) : null;
  if (cn && flat(cn.position, P) < R + 4) return cn.position.clone();
  return (walkable(G, _v, 4) || P).clone();
}

/** Platz k von n in einer Linie quer zur Anmarschrichtung, `back` m vor dem Punkt (→ out bzw. neuer Vektor). */
function lineSpot(G, P, u, k, n, back, out = new THREE.Vector3()) {
  const off = (k - (n - 1) / 2) * 3.2;
  _v.set(P.x - u.x * back - u.z * off, P.y, P.z - u.z * back + u.x * off);
  return out.copy(walkable(G, _v, 4) || P);
}

/** Flankenplatz k: abwechselnd links/rechts des Ziels, immer weiter seitlich (50°, 70°, 90° …), Deckung zum Ziel. */
function flankSpot(G, P, L, u, k) {
  const D = flat(P, L);
  const R = clamp(D * 0.55, 10, 24);
  const side = k % 2 ? 1 : -1;
  const ang = side * (0.87 + Math.floor(k / 2) * 0.35);
  // von P aus zurück Richtung Anführer (−u), um ang gedreht
  const bx = -u.x, bz = -u.z;
  const c = Math.cos(ang), s = Math.sin(ang);
  _v.set(P.x + (bx * c - bz * s) * R, P.y, P.z + (bx * s + bz * c) * R);
  const nav = navOf(G);
  const cn = nav && nav.coverNear ? nav.coverNear(_v, P, 5) : null;
  if (cn) return cn.position.clone();
  return (walkable(G, _v, 5) || P).clone();
}

/* ================================================================ Abfrage */

/** Aktiver Befehl eines Bots oder null (abgelaufene/ungültige werden gelöscht; Truppbefehle verworfen). */
export function commandFor(bot, now) {
  const c = bot.command;
  if (!c) return null;
  const G = bot.G;
  const by = c.by;
  if (!bot.alive || c.life !== bot.spawnTime || now > c.until || !by || !G.actors.includes(by) || bot.puppet ||
      (c.kind === 'attack' && c.target && (!c.target.alive || !G.actors.includes(c.target)))) {
    bot.command = null;
    return null;
  }
  if (LEADER_KINDS.has(c.kind) && !by.alive) return null; // ruht
  if (bot.order && bot.order.kind) bot.order.kind = null; // bot.js liest bot.order (Haltung, Niederhalten)
  return c;
}

/** Hat der Bot gerade einen Spielerbefehl (ai/squad.js: nicht überschreiben)? */
export function isCommanded(bot, now) {
  const c = bot.command;
  return !!(c && c.kind && bot.alive && c.life === bot.spawnTime && now <= c.until);
}

/* ================================================================ Ausführen */

/** Gewünschte Stelle (c.pos), Blick (c.lookAt/hasLook), Hocken (c.crouch) dieses Augenblicks. */
function desired(bot, c, now) {
  const G = bot.G;
  const leader = c.by;
  c.hasLook = c.kind === 'hold' || c.kind === 'defend';
  c.crouch = false;
  if (LEADER_KINDS.has(c.kind)) {
    const L = leaderState(leader, now);
    const lp = leader.position;
    // vorausberechnet (0,6 s), damit Folgende nicht hinterherhängen
    const ax = lp.x + (L.moving ? L.vx * 0.6 : 0), az = lp.z + (L.moving ? L.vz * 0.6 : 0);
    let cx = ax, cz = az, cy = lp.y;
    if (c.kind === 'regroup') {
      // Sammelpunkt folgt dem Anführer erst, wenn er > 8 m weiterzieht (sonst stehen sie im Ring)
      if (!c.rally || flat(c.rally, lp) > 8) c.rally = (walkable(G, lp, 3) || lp).clone();
      cx = c.rally.x; cz = c.rally.z; cy = c.rally.y;
    }
    const o = slotOffset(c.shape, c.slot, c.slots, _slot);
    let hx = L.hx, hz = L.hz;
    if (o.world) { hx = 0; hz = -1; }
    const rx = -hz, rz = hx;
    _v.set(cx + hx * o.f + rx * o.r, cy, cz + hz * o.f + rz * o.r);
    // Platz begehbar und vom Anführer aus sichtbar (nicht hinter einer Wand) – sonst näher heran, notfalls beim Anführer
    let p = walkable(G, _v, 3);
    if (!p || !clear(G, lp, p)) {
      _v.set(cx + (hx * o.f + rx * o.r) * 0.45, cy, cz + (hz * o.f + rz * o.r) * 0.45);
      p = walkable(G, _v, 2.5);
      if (!p || !clear(G, lp, p)) p = walkable(G, lp, 3) || lp;
    }
    // Weg dorthin gescheitert → 3 s lang direkt zum Anführer
    if (now < c.failAt) p = walkable(G, lp, 3) || lp;
    c.pos.copy(p);
    // Blick: am Platz in Laufrichtung des Anführers, seitlich gefächert; Kreis/Ring nach außen
    if (o.world) {
      _w.set(c.pos.x - cx, 0, c.pos.z - cz);
      if (_w.lengthSq() < 0.01) _w.set(L.hx, 0, L.hz);
      _w.normalize();
      c.lookAt.set(c.pos.x + _w.x * 20, c.pos.y + 1.2, c.pos.z + _w.z * 20);
      c.crouch = !L.moving;
    } else {
      const fan = o.r === 0 ? 0 : Math.sign(o.r) * 0.45;
      const yaw = Math.atan2(-L.hx, -L.hz) - fan;
      c.lookAt.set(c.pos.x - Math.sin(yaw) * 20, c.pos.y + 1.2, c.pos.z - Math.cos(yaw) * 20);
      c.crouch = !L.moving && c.kind === 'formation' && L.speed < 0.3 && now - c.issued > 3;
    }
    c.hasLook = true;
    return;
  }
  if (ANCHOR_KINDS.has(c.kind)) {
    c.pos.copy(c.spot);
    c.crouch = true;
    return;
  }
  if (c.kind === 'attack' && c.target) {
    // Ziel-Akteur: Linie 6 m davor, Punkt wandert mit dem Ziel
    const tp = c.target.position;
    c.point.copy(tp);
    _w.set(tp.x - bot.position.x, 0, tp.z - bot.position.z);
    if (_w.lengthSq() > 1) c.dir.copy(_w.normalize());
    lineSpot(G, tp, c.dir, c.slot, c.slots, 6, c.pos);
  } else c.pos.copy(c.spot || c.point || bot.position);
  // Blick zum Ziel; angekommen: Sektor um die Angriffsrichtung absuchen (sweep)
  if (c.arrivedAt && c.sweep) { c.lookAt.copy(c.sweep); c.hasLook = true; }
  else if (c.point) { c.lookAt.set(c.point.x, c.point.y + 1.2, c.point.z); c.hasLook = true; }
}
const _slot = { f: 0, r: 0, world: false };

/**
 * Befehl als Ziel umsetzen (aus ai/brain.js think). rec: sichtbares Ziel (oder null); set: brain.set(goal, kind, now, o).
 * → true, wenn das Ziel gesetzt ist; false = normales Gefecht (Bot nahe seinem Platz, Gegner nah).
 */
export function commandStep(bot, c, now, rec, set) {
  const goal = bot.goal;
  desired(bot, c, now);
  const d = bot.position.distanceTo(c.pos);
  // Weg zum Befehlsziel gescheitert
  if (goal.kind === 'command' && bot.nav.failed && now > c.failAt + 3) {
    if (LEADER_KINDS.has(c.kind)) c.failAt = now + 3;
    else if (c.kind === 'hold') { c.spot.copy(bot.position); c.failAt = now; } // Stellung unerreichbar: hier halten
    else if (c.spot && c.point && c.spot.distanceTo(c.point) > 1) { c.spot = c.point.clone(); c.failAt = now; } // direkt zum Punkt
    else { bot.command = null; return false; }
  }
  if (rec) {
    const ed = rec.pos.distanceTo(bot.position);
    if (ANCHOR_KINDS.has(c.kind)) {
      // noch unterwegs zur Stellung: weiterlaufen und feuern (naher Gegner → normal kämpfen)
      if (d > 2.5) {
        if (ed < 10) return false;
        moveUnderFire(bot, c, now, set, 'run');
        return true;
      }
      // verletzt: Deckung höchstens 4 m neben der Stellung (wird die neue Stellung), sonst bleiben
      const D = bot.diff;
      if (bot.health < D.retreatHealth && now > (c._coverAt || 0)) {
        c._coverAt = now + 4;
        const n = anchorCover(bot, c, rec.pos);
        if (n) c.spot.copy(n.position);
      }
      // aus der Stellung kämpfen (bot.js: goal.hold → nur ducken/spähen, nicht vorgehen)
      set(goal, 'engage', now, { look: 'target' });
      bot.coverNode = null;
      goal.move.copy(c.pos); goal.hasMove = true; goal.tolerance = 0.8; goal.hold = true;
      return true;
    }
    if (LEADER_KINDS.has(c.kind)) {
      const leash = c.kind === 'regroup' ? 7 : 12;
      if (d > leash && ed > 8) { moveUnderFire(bot, c, now, set, 'run'); return true; }
      return false;
    }
    // Angriff/Ausschwärmen: vorrücken und feuern, nahe Gegner normal bekämpfen
    if (ed < 22 || d < 4 || c.arrivedAt) return false;
    moveUnderFire(bot, c, now, set, 'run');
    return true;
  }
  // --- ohne sichtbaren Gegner
  // Quittung: kurz zum Anführer sehen
  const leader = c.by;
  let lookAt = c.hasLook ? c.lookAt : null;
  const ack = now < c.ackUntil && leader.alive && leader.position.distanceTo(bot.position) < 35;
  if (ack) { _ack.copy(leader.position); _ack.y += 1.5; lookAt = _ack; }
  let speed = 'run';
  let tol = 1.2;
  if (LEADER_KINDS.has(c.kind)) {
    const L = leaderState(leader, now);
    speed = d > 11 ? 'sprint' : d > 4 || L.moving ? 'run' : 'walk';
    tol = c.kind === 'regroup' ? 1 : 1.4;
  } else if (ANCHOR_KINDS.has(c.kind)) {
    speed = d > 12 ? 'sprint' : 'run';
    tol = 0.8;
  } else {
    speed = d > 18 ? 'sprint' : 'run';
    tol = 1.6;
    if (d < 3.5 && !c.arrivedAt) c.arrivedAt = now;
    if (c.arrivedAt && now - c.arrivedAt > (c.kind === 'attack' ? ATTACK_SECURE : SPREAD_HOLD)) { bot.command = null; return false; }
    if (c.arrivedAt) { c.crouch = true; sweep(bot, c, now); }
  }
  const moving = d > tol + 0.6;
  set(goal, 'command', now, {
    move: c.pos, speed, tolerance: tol, crouch: c.crouch,
    look: lookAt && (!moving || d < 6 || ack) ? 'point' : 'move', lookAt,
  });
  goal.sub = c.kind;
  goal.repath = LEADER_KINDS.has(c.kind) ? 2 : 1.5;
  return true;
}

/** Feuernd weiterlaufen (Ziel 'command', Blick auf den Gegner; bot.js schießt, solange er sichtbar ist). */
function moveUnderFire(bot, c, now, set, speed) {
  set(bot.goal, 'command', now, { move: c.pos, speed, look: 'target', tolerance: 1.4 });
  bot.goal.sub = c.kind;
  bot.goal.repath = 2;
  bot.coverNode = null;
}

/** Am Ziel sichern: Blick schwenkt um die Angriffsrichtung (c.sweep, von desired() übernommen). */
function sweep(bot, c, now) {
  if (now < (c._sweepAt || 0)) return;
  c._sweepAt = now + 1.6 + Math.random() * 1.6;
  const base = Math.atan2(c.dir.x, c.dir.z) + (Math.random() - 0.5) * 1.6;
  const p = bot.position;
  if (!c.sweep) c.sweep = new THREE.Vector3();
  c.sweep.set(p.x + Math.sin(base) * 20, p.y + 1.2, p.z + Math.cos(base) * 20);
  c.lookAt.copy(c.sweep);
  c.hasLook = true;
}

/** Verletzt unter Beschuss mit fester Stellung: Deckung höchstens 4 m von der Stellung (sonst bleiben). */
export function anchorCover(bot, c, threat) {
  if (!ANCHOR_KINDS.has(c.kind) || !c.spot) return null;
  const n = findCover(bot, threat, 4, bot.manager.coverClaims(bot));
  return n && n.position.distanceTo(c.spot) < 4.5 ? n : null;
}

/** Hält der Befehl eine feste Stellung (hold/defend)? */
export function isAnchored(c) { return !!(c && ANCHOR_KINDS.has(c.kind)); }
