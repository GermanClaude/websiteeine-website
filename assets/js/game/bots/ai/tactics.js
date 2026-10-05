// NULLPUNKT — Kartenanalyse für Bots (einmal pro Welt): Spielachse (Spawn A → B), drei Spuren
// (links/Mitte/rechts nach seitlichem Abstand), Machtpositionen (erhöht, viel Deckung), erhöhte
// Posten (Dächer/Laufstege mit Deckung), sowie Zielwahl fürs Umherziehen, Flankenpunkte, Posten mit
// Sicht auf einen Ort und Deckungssuche.
import * as THREE from 'three';

const cache = new WeakMap();
const _v = new THREE.Vector3();
const _e = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Höhe über dem Kartenboden, ab der ein Knoten als erhöht gilt (Dach, Laufsteg, Obergeschoss). */
export const HIGH_Y = 2.2;

function centroid(list) {
  const c = new THREE.Vector3();
  if (!list || !list.length) return c;
  for (const s of list) c.add(s.position || s);
  return c.multiplyScalar(1 / list.length);
}

/** Analyse (gecacht pro Welt). */
export function analyze(world) {
  if (!world) return null;
  let A = cache.get(world);
  if (A) return A;
  const nav = world.nav;
  const nodes = nav ? nav.nodes : [];
  const sa = centroid(world.spawns && world.spawns.A);
  const sb = centroid(world.spawns && world.spawns.B);
  let axis = new THREE.Vector3(sb.x - sa.x, 0, sb.z - sa.z);
  let length = axis.length();
  if (length < 5) { axis.set(0, 0, 1); length = 60; } else axis.multiplyScalar(1 / length);
  const perp = new THREE.Vector3(-axis.z, 0, axis.x);
  const center = sa.clone().lerp(sb, 0.5);
  // Spurzuordnung über Quantile des seitlichen Abstands
  const lat = nodes.map((n) => (n.position.x - center.x) * perp.x + (n.position.z - center.z) * perp.z);
  const sorted = [...lat].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.33)] ?? -10;
  const q2 = sorted[Math.floor(sorted.length * 0.67)] ?? 10;
  const lanes = [[], [], []];
  const along = new Float32Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const l = lat[i];
    lanes[l < q1 ? 0 : l < q2 ? 1 : 2].push(n);
    along[i] = ((n.position.x - sa.x) * axis.x + (n.position.z - sa.z) * axis.z) / length;
  }
  // Machtpositionen: erhöht mit Deckung, oder viele Deckungsrichtungen
  const ground = nodes.length ? Math.min(...nodes.slice(0, 400).map((n) => n.position.y)) : 0;
  const hot = nodes.filter((n) => (n.position.y - ground > HIGH_Y && n.cover) || (n.cover && n.coverDirs && n.coverDirs.length >= 3 && n.coverDirs.length <= 5));
  // Erhöhte Posten: über Bodenniveau, unter freiem Himmel mit Ausblick (keine Obergeschoss-Innenräume),
  // bevorzugt mit Deckung (Brüstung/Kisten)
  const high = nodes.filter((n) => n.position.y - ground > HIGH_Y);
  const open = high.filter((n) => overlooks(world, n.position));
  const covered = open.filter((n) => n.cover);
  const perch = covered.length >= 8 ? covered : open;
  A = { nav, nodes, sa, sb, axis, perp, center, length, lanes, along, hot, high, perch, perchSet: new Set(perch), ground, idOf: new Map(nodes.map((n, i) => [n, i])) };
  cache.set(world, A);
  return A;
}

const rnd = (a, b) => a + Math.random() * (b - a);

const LOOK_DIRS = Array.from({ length: 8 }, (_, i) => [Math.sin((i * Math.PI) / 4), Math.cos((i * Math.PI) / 4)]);

/** Aussichtspunkt? Freier Himmel über dem Knoten und auf Augenhöhe in ≥ 2 von 8 Richtungen 10 m frei. */
function overlooks(world, p) {
  if (!world || typeof world.lineOfSight !== 'function') return true;
  _e.set(p.x, p.y + 0.6, p.z);
  _t.set(p.x, p.y + 5, p.z);
  if (!world.lineOfSight(_e, _t)) return false;
  _e.y = p.y + 1.55;
  let free = 0;
  for (let i = 0; i < LOOK_DIRS.length && free < 2; i++) {
    _t.set(p.x + LOOK_DIRS[i][0] * 10, p.y + 1.3, p.z + LOOK_DIRS[i][1] * 10);
    if (world.lineOfSight(_e, _t)) free++;
  }
  return free >= 2;
}

/**
 * Ziel zum Umherziehen: Teams spuren- und frontbasiert (Richtung Gegnerseite), FFA belebte Zonen in
 * mittlerer Entfernung, erhöhte Posten bevorzugt (Vertikalität). Abstand zu den Zielen der
 * Teamkameraden (Verteilung über die Karte). → NavGraph-Knoten | null
 */
export function pickRoamGoal(bot, A, taken = []) {
  if (!A || !A.nodes.length) return null;
  const pos = bot.position;
  const team = bot.team;
  const tries = 24;
  let best = null, bestScore = -Infinity;
  const forward = team === 'B' ? -1 : 1; // B läuft rückwärts entlang der Achse
  const lane = bot.lane ?? 1;
  const push = Math.min(0.85, 0.42 + (bot.G.time.elapsed - (bot.spawnTime || 0)) * 0.006 + Math.random() * 0.25);
  for (let k = 0; k < tries; k++) {
    let n;
    if (A.perch.length && Math.random() < (team ? PERCH_TRY : PERCH_TRY * 0.5)) n = A.perch[(Math.random() * A.perch.length) | 0];
    else if (team && Math.random() < 0.72) {
      const L = A.lanes[Math.random() < 0.8 ? lane : (Math.random() * 3) | 0];
      n = L[(Math.random() * L.length) | 0];
    } else if (A.hot.length && Math.random() < 0.35) n = A.hot[(Math.random() * A.hot.length) | 0];
    else n = A.nodes[(Math.random() * A.nodes.length) | 0];
    if (!n) continue;
    const i = A.idOf.get(n);
    let s = 0;
    const d = n.position.distanceTo(pos);
    if (team) {
      const t = forward > 0 ? A.along[i] : 1 - A.along[i];
      s -= Math.abs(t - push) * 6;
    } else {
      s -= Math.abs(d - 28) * 0.08;
    }
    if (d < 8) s -= 3;
    if (n.cover) s += 0.6;
    if (A.perchSet.has(n)) s += team ? PERCH_BONUS : PERCH_BONUS * 0.5;
    for (const t of taken) if (t && t.distanceToSquared(n.position) < 100) s -= 2.5;
    if (bot.lastGoal && bot.lastGoal.distanceToSquared(n.position) < 64) s -= 2;
    s += Math.random() * 1.2;
    if (s > bestScore) { bestScore = s; best = n; }
  }
  return best;
}

const PERCH_TRY = 0.22; // Anteil der Kandidaten aus den erhöhten Posten (FFA: halb so viele)
const PERCH_BONUS = 1.1; // Bewertungsbonus erhöhter Posten (FFA: halb so groß)

/** Ist der Knoten ein erhöhter Posten? */
export function isPerch(A, node) {
  return !!(A && node && A.perchSet.has(node));
}

/**
 * Erhöhter Posten im Umkreis von center mit Sicht auf center (Augenhöhe → Oberkörper am Ort). Zuerst
 * Aussichtspunkte unter freiem Himmel (A.perch), dann übrige erhöhte Knoten (z. B. Fenster im
 * Obergeschoss). Prüft höchstens `tests` zufällige Kandidaten (je ein Sichtstrahl). → Knoten | null
 */
export function perchNear(bot, A, center, radius, { tests = 4, minDist = 4, maxFromBot = 60 } = {}) {
  if (!A || !A.high.length) return null;
  const world = bot.G.world;
  const r2 = radius * radius, m2 = minDist * minDist, b2 = maxFromBot * maxFromBot;
  const first = _perchA, rest = _perchB;
  first.length = rest.length = 0;
  for (let i = 0; i < A.high.length; i++) {
    const n = A.high[i];
    const d2 = n.position.distanceToSquared(center);
    if (d2 > r2 || d2 < m2 || n.position.distanceToSquared(bot.position) > b2) continue;
    (A.perchSet.has(n) ? first : rest).push(n);
  }
  for (let k = 0; k < tests; k++) {
    const list = first.length ? first : rest;
    if (!list.length) break;
    const i = (Math.random() * list.length) | 0;
    const n = list[i];
    list[i] = list[list.length - 1];
    list.pop();
    _e.copy(n.position).setY(n.position.y + 1.55);
    _t.copy(center).setY(center.y + 1.4); // Oberkörper/Kopf eines Stehenden am Ort
    if (!world || !world.lineOfSight || world.lineOfSight(_e, _t)) return n;
  }
  return null;
}
const _perchA = [], _perchB = [];

/** Flankenpunkt: seitlich versetzt zum Ziel, auf dem NavGraph, nicht im direkten Anlauf. */
export function flankPoint(bot, A, targetPos) {
  if (!A || !A.nav) return null;
  _v.subVectors(targetPos, bot.position).setY(0);
  const d = _v.length();
  if (d < 8) return null;
  _v.multiplyScalar(1 / d);
  const side = Math.random() < 0.5 ? -1 : 1;
  // erhöhte Flanke (Dach/Laufsteg mit Sicht aufs Ziel) bevorzugt
  if (Math.random() < 0.5) {
    const n = perchNear(bot, A, targetPos, 18, { tests: 2, minDist: 7 });
    if (n) return n.position.clone();
  }
  for (const s of [side, -side]) {
    const p = targetPos.clone().addScaledVector(new THREE.Vector3(-_v.z, 0, _v.x), s * rnd(9, 15)).addScaledVector(_v, -rnd(2, 6));
    const n = A.nav.nearest(p);
    if (n && n.position.distanceTo(p) < 6 && n.position.distanceTo(targetPos) > 6) return n.position.clone();
  }
  return null;
}

/** Deckungspunkt gegen eine Bedrohung (nav.coverNear) mit Belegungsprüfung. */
export function findCover(bot, threatPos, radius = 12, occupied = []) {
  const nav = bot.G.world && bot.G.world.nav;
  if (!nav || !nav.coverNear) return null;
  const n = nav.coverNear(bot.position, threatPos, radius);
  if (!n) return null;
  for (const o of occupied) if (o && o.distanceToSquared(n.position) < 1.2) return null;
  return n;
}

/** Rückzugspunkt: weg von der Bedrohung, möglichst ohne Sicht. */
export function retreatPoint(bot, threatPos) {
  const nav = bot.G.world && bot.G.world.nav;
  if (!nav) return null;
  _v.subVectors(bot.position, threatPos).setY(0);
  if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0);
  _v.normalize();
  const want = bot.position.clone().addScaledVector(_v, 12);
  const cands = nav.nodesInRadius(want, 8);
  let best = null, bs = -Infinity;
  for (let i = 0; i < Math.min(14, cands.length); i++) {
    const n = cands[i];
    let s = n.position.distanceTo(threatPos) * 0.3 - n.position.distanceTo(want) * 0.2;
    if (n.cover) s += 2;
    if (s > bs) { bs = s; best = n; }
  }
  return best ? best.position.clone() : null;
}
