// Ego-Arme: Handschuhhände als SkinnedMesh (je Hand 1 Draw Call, 16 Knochen mit Fingergliedern),
// Unter-/Oberarm-Ärmel mit Tarnmuster, Zwei-Knochen-IK von der Schulter zum Handgelenk, Uhr + Klebeband.
// Handkoordinaten (rechte Hand): Handgelenk im Ursprung, Finger −Z, Handrücken +Y, Daumen −X.
// Die linke Hand ist gespiegelt gebaut (gleiche Semantik: Finger −Z, Handrücken +Y, Daumen +X).
//
// Griff-Löser: Jede Griffart beschreibt einen Kollisionskörper (elliptischer Zylinder / Kugel) im Ankerraum.
// Die Hand wird so platziert, dass die Handfläche ihn berührt; die Fingerglieder beugen sich der Reihe nach,
// bis sie anliegen; der Zeigefinger sucht den Abzug; die Daumenausrichtung wird gesucht, bis die Kuppe ihr
// Ziel auf der Gegenseite erreicht. Ergebnisse werden je Griffart + Maßen gecacht.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxUV, chamferBoxGeometry } from './builder.js';
import { camoMap, fabricNormal, watchFaceTexture, tapeMap } from './textures.js';
import { takeMaterials, parkMaterials } from './materials.js';

const FINGERS = [
  { x: -0.0285, y: 0.001, z: -0.08, len: [0.043, 0.027, 0.022], r: [0.0094, 0.0088, 0.0082], splay: 0.07 },
  { x: -0.0093, y: 0.002, z: -0.084, len: [0.047, 0.03, 0.023], r: [0.0097, 0.0091, 0.0084], splay: 0.0 },
  { x: 0.0102, y: 0.001, z: -0.081, len: [0.044, 0.028, 0.022], r: [0.0093, 0.0087, 0.008], splay: -0.06 },
  { x: 0.0285, y: -0.002, z: -0.073, len: [0.034, 0.022, 0.019], r: [0.0084, 0.0078, 0.0073], splay: -0.14 },
];
const THUMB = { base: [-0.027, -0.011, -0.018], len: [0.042, 0.032, 0.026], r: [0.0128, 0.0112, 0.0101] };

const GLOVE = new THREE.Color(0x2e3032), PALM = new THREE.Color(0x5b554b), PAD = new THREE.Color(0x1d1e20), CUFF = new THREE.Color(0x3a3c36);

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v1 = V3(), _v2 = V3(), _v3 = V3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _qa = new THREE.Quaternion();
const AX = V3(1, 0, 0);

function basisQuat(F, B, out = new THREE.Quaternion()) {
  const z = (F.isVector3 ? _v1.copy(F).negate() : _v1.set(-F[0], -F[1], -F[2])).normalize();
  const y = B.isVector3 ? _v2.copy(B) : _v2.set(B[0], B[1], B[2]);
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = _v3.crossVectors(y, z).normalize();
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

// ---------------------------------------------------------------- Kollisionskörper

function makeCyl(c, A, U, a, b, h0 = -1, h1 = 1) {
  const An = A.clone().normalize();
  const Un = U.clone().addScaledVector(An, -U.dot(An)).normalize();
  return { type: 'cyl', c: c.clone(), A: An, U: Un, V: V3().crossVectors(An, Un), a, b, h0, h1 };
}
function makeSphere(c, r) { return { type: 'sphere', c: c.clone(), r }; }

function inside(s, p, r) {
  _d.subVectors(p, s.c);
  if (s.type === 'sphere') return _d.lengthSq() <= (s.r + r) * (s.r + r);
  const h = _d.dot(s.A);
  if (h < s.h0 - r * 0.5 || h > s.h1 + r * 0.5) return false;
  const u = _d.dot(s.U) / (s.a + r), v = _d.dot(s.V) / (s.b + r);
  return u * u + v * v <= 1;
}

// Nächster Punkt auf der Achse (Zylinder) bzw. Mittelpunkt (Kugel)
function axisPoint(s, p, out) {
  if (s.type === 'sphere') return out.copy(s.c);
  const h = THREE.MathUtils.clamp(_d.subVectors(p, s.c).dot(s.A), s.h0, s.h1);
  return out.copy(s.c).addScaledVector(s.A, h);
}

// Oberflächenpunkt, dessen Außennormale in Richtung n zeigt
function surfacePoint(s, n, out) {
  if (s.type === 'sphere') return out.copy(n).normalize().multiplyScalar(s.r).add(s.c);
  const nu = n.dot(s.U), nv = n.dot(s.V);
  const den = Math.sqrt(s.a * s.a * nu * nu + s.b * s.b * nv * nv) || 1;
  return out.copy(s.c).addScaledVector(s.U, s.a * s.a * nu / den).addScaledVector(s.V, s.b * s.b * nv / den);
}

// Körper vom Ankerraum in den Handraum (Hand bei pos/quat im Ankerraum), optional gespiegelt (linke Hand)
function toHand(s, pos, quat, mirror) {
  const inv = quat.clone().invert();
  const P = v => { const r = v.clone().sub(pos).applyQuaternion(inv); if (mirror) r.x = -r.x; return r; };
  const D = v => { const r = v.clone().applyQuaternion(inv); if (mirror) r.x = -r.x; return r; };
  if (s.type === 'sphere') return makeSphere(P(s.c), s.r);
  return makeCyl(P(s.c), D(s.A), D(s.U), s.a, s.b, s.h0, s.h1);
}

// ---------------------------------------------------------------- Vorwärtskinematik (rechte Hand)

const _fq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
const _fp = [V3(), V3(), V3(), V3()];
function fingerFK(i, th, splay) {
  const f = FINGERS[i];
  _fp[0].set(f.x, f.y, f.z);
  _fq[0].setFromEuler(_e.set(-th[0], splay, 0));
  for (let s = 0; s < 3; s++) {
    if (s > 0) _fq[s].copy(_fq[s - 1]).multiply(_qa.setFromAxisAngle(AX, -th[s]));
    _fp[s + 1].set(0, 0, -f.len[s]).applyQuaternion(_fq[s]).add(_fp[s]);
  }
}

const _tq = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
const _tp = [V3(), V3(), V3(), V3()];
function thumbFK(q, flex) {
  _tp[0].fromArray(THUMB.base);
  _tq[0].copy(q);
  for (let s = 0; s < 3; s++) {
    if (s > 0) _tq[s].copy(_tq[s - 1]).multiply(_qa.setFromAxisAngle(AX, -flex[s - 1]));
    _tp[s + 1].set(0, 0, -THUMB.len[s]).applyQuaternion(_tq[s]).add(_tp[s]);
  }
}

const FMAX = [1.55, 1.75, 1.3];
const FREE = [1.2, 1.45, 0.95];
const START = [0.06, 0.1, 0.06];

// Finger der Reihe nach beugen, bis jedes Glied anliegt
function curlFinger(i, shape, splay, free = FREE) {
  const f = FINGERS[i], th = START.slice(), steps = 32;
  for (let s = 0; s < 3; s++) {
    let hit = false;
    const lo = START[s], hi = FMAX[s];
    for (let k = 0; k <= steps; k++) {
      th[s] = lo + (hi - lo) * k / steps;
      fingerFK(i, th, splay);
      _a.lerpVectors(_fp[s], _fp[s + 1], 0.55);
      if (inside(shape, _fp[s + 1], f.r[s] * 0.92) || inside(shape, _a, f.r[s] * 0.92)) {
        hit = true;
        th[s] = Math.max(lo, th[s] - (hi - lo) / steps * 0.5);
        break;
      }
    }
    if (!hit) th[s] = free[s];
    curlFinger.hits[s] = hit;
  }
  return th;
}
curlFinger.hits = [false, false, false];

// Zeigefinger mit der Kuppe an einen Punkt (Abzug) führen; Rückgabe [b1, b2, b3, Zusatzspreizung]
function reachFinger(i, target, splay, shape) {
  let best = [0.3, 0.6, 0.3, 0], bestCost = Infinity;
  const f = FINGERS[i];
  const evalAt = (t0, t1, sp) => {
    const th = [t0, t1, t1 * 0.6];
    fingerFK(i, th, splay + sp);
    _a.lerpVectors(_fp[2], _fp[3], 0.6).add(_b.set(0, -f.r[2] * 0.9, 0).applyQuaternion(_fq[2]));
    let cost = _a.distanceToSquared(target) + sp * sp * 0.0004;
    if (shape) for (let s = 0; s < 3; s++) { _c.lerpVectors(_fp[s], _fp[s + 1], 0.6); if (inside(shape, _c, f.r[s] * 0.7)) cost += 0.002; }
    if (cost < bestCost) { bestCost = cost; best = [th[0], th[1], th[2], sp]; }
  };
  for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) for (let c = 0; c <= 5; c++) evalAt(-0.15 + a / 12 * 1.45, b / 12 * 1.7, -0.1 + c * 0.09);
  const [c0, c1, , cs] = best;
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = -2; c <= 2; c++) evalAt(c0 + a * 0.04, Math.max(0, c1 + b * 0.045), cs + c * 0.03);
  reachFinger.cost = bestCost;
  return best;
}

// Daumen: Richtung des Grundglieds (α zur Seite, β zur Handfläche), Kuppe zum Ziel, Glieder legen sich an
const TF0 = V3(0, 0, -1), TS = V3(-1, 0, 0), TP = V3(0, -1, 0), CUP = V3(0.006, -0.038, -0.07);
function thumbBase(alpha, beta, shape, out) {
  const D = _a.copy(TF0).multiplyScalar(Math.cos(alpha)).addScaledVector(TS, Math.sin(alpha)).multiplyScalar(Math.cos(beta)).addScaledVector(TP, Math.sin(beta)).normalize();
  const mid = _b.fromArray(THUMB.base).addScaledVector(D, 0.035);
  const tgt = shape ? axisPoint(shape, mid, _c) : _c.copy(CUP);
  const pad = tgt.sub(mid);
  pad.addScaledVector(D, -pad.dot(D));
  if (pad.lengthSq() < 1e-8) pad.copy(TP).addScaledVector(D, -TP.dot(D));
  pad.normalize().negate();          // Nagel = Gegenrichtung der Kuppe
  return basisQuat(D.clone(), pad.clone(), out);
}

function solveThumb(shape, target, free = [0.3, 0.25]) {
  const q = new THREE.Quaternion();
  let best = null, bestCost = Infinity;
  const flex = [0, 0];
  const tryAt = (al, be, k) => {
    thumbBase(al, be, shape, q);
    flex[0] = shape ? k : free[0]; flex[1] = shape ? k * 0.85 : free[1];
    thumbFK(q, flex);
    let pen = 0;
    if (shape) for (let s = 0; s < 3; s++) {
      _d.lerpVectors(_tp[s], _tp[s + 1], 0.5);
      if (inside(shape, _d, THUMB.r[s] * 0.75)) pen += 0.002;
      if (inside(shape, _tp[s + 1], THUMB.r[s] * 0.75)) pen += 0.002;
    }
    // Kuppe/Glieder nicht durch die Handfläche
    for (const p of [_tp[2], _tp[3]]) if (Math.abs(p.x) < 0.036 && p.y > -0.028 && p.y < 0.02 && p.z < -0.012 && p.z > -0.085) pen += 0.003;
    const cost = _tp[3].distanceToSquared(target) + pen + (shape ? k * k * 0.00012 : 0);
    if (cost < bestCost) { bestCost = cost; best = { al, be, k, q: q.clone(), flex: flex.slice() }; }
  };
  const ks = shape ? [0.08, 0.3, 0.55, 0.85] : [0];
  for (let i = 0; i <= 9; i++) for (let j = 0; j <= 9; j++) for (const k of ks) tryAt(-0.35 + i * 0.2, -0.6 + j * 0.23, k);
  const b0 = best;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (const dk of shape ? [-0.1, 0, 0.1] : [0]) tryAt(b0.al + i * 0.065, b0.be + j * 0.075, Math.max(0, b0.k + dk));
  best.cost = bestCost;
  return best;
}

// ---------------------------------------------------------------- Posen

function makePose(f, thumb) {
  const t = [thumb.q.x, thumb.q.y, thumb.q.z, thumb.q.w, thumb.flex[0], thumb.flex[1]];
  if (t[3] < 0) for (let k = 0; k < 4; k++) t[k] = -t[k];
  return { f: f.map(a => [a[0], a[1], a[2], a[3] ?? 0]), t };
}

// Freie Posen (ohne Gegenstand) bzw. mit Gegenstand im Handraum (Messergriff, Granate)
export const PROP_SHAPES = {
  knife: { pos: [0.003, -0.029, -0.058], r: 0.0135 },
  grenade: { pos: [0.004, -0.049, -0.061], r: 0.031 },
};
function freePose(fingers, thumbTarget, shape = null, thumbFree) {
  const f = fingers.map((th, i) => (shape && !th ? curlFinger(i, shape, FINGERS[i].splay * 0.5).concat(0) : th));
  return makePose(f, solveThumb(shape, V3(...thumbTarget), thumbFree));
}

export const POSES = {};
function buildFreePoses() {
  const knifeShape = makeCyl(V3(...PROP_SHAPES.knife.pos), V3(1, 0, 0), V3(0, 1, 0), PROP_SHAPES.knife.r, PROP_SHAPES.knife.r, -0.06, 0.06);
  const ballShape = makeSphere(V3(...PROP_SHAPES.grenade.pos), PROP_SHAPES.grenade.r);
  const pinShape = makeSphere(V3(-0.026, -0.045, -0.112), 0.004);
  POSES.relaxed = freePose([[0.32, 0.38, 0.22, 0.02], [0.38, 0.42, 0.24, 0], [0.44, 0.48, 0.27, -0.02], [0.5, 0.52, 0.3, -0.05]], [-0.05, -0.028, -0.085], null, [0.25, 0.2]);
  POSES.open = freePose([[0.06, 0.08, 0.05, 0.06], [0.06, 0.08, 0.05, 0], [0.07, 0.1, 0.05, -0.05], [0.1, 0.1, 0.06, -0.1]], [-0.075, -0.012, -0.06], null, [0.08, 0.06]);
  POSES.fist = freePose([[1.45, 1.6, 0.95, 0], [1.5, 1.62, 0.95, 0], [1.5, 1.62, 0.95, 0], [1.5, 1.6, 0.95, 0]], [-0.006, -0.05, -0.07], null, [0.45, 0.4]);
  POSES.flat = freePose([[0.12, 0.12, 0.08, 0.03], [0.12, 0.12, 0.08, 0], [0.14, 0.12, 0.08, -0.03], [0.16, 0.14, 0.1, -0.06]], [-0.06, -0.016, -0.08], null, [0.1, 0.08]);
  POSES.knife = freePose([null, null, null, null], [-0.012, -0.052, -0.074], knifeShape, [0.5, 0.45]);
  POSES.ball = freePose([null, null, null, null], [-0.032, -0.06, -0.09], ballShape, [0.3, 0.25]);
  POSES.pinch = freePose([null, [1.25, 1.45, 0.85, 0], [1.3, 1.5, 0.85, 0], [1.35, 1.5, 0.85, 0]], [-0.026, -0.045, -0.112], pinShape, [0.3, 0.3]);
  POSES.wrap = freePose([[1.0, 1.1, 0.6, 0], [1.05, 1.15, 0.6, 0], [1.1, 1.15, 0.6, 0], [1.15, 1.15, 0.6, -0.04]], [-0.02, -0.05, -0.07], null, [0.3, 0.25]);
}

// ---------------------------------------------------------------- Griffarten

// Pistolengriff-Körper aus Anker-Daten: rake (Neigung), gw/gd (halbe Breite/Tiefe), gu (Mitte vor dem Anker), gl (Länge)
function gripShape(d, grow = 0, forward = 0) {
  const r = d.rake ?? 0.3;
  const A = V3(0, -Math.cos(r), Math.sin(r)), U = V3(0, -Math.sin(r), -Math.cos(r));
  return makeCyl(V3(0, 0, -(d.gu ?? 0)).addScaledVector(U, forward), A, U, (d.gd ?? 0.023) + grow, (d.gw ?? 0.015) + grow, -0.035, d.gl ?? 0.11);
}
function barShape(d, A = V3(0, 0, -1)) {
  const w = d.w ?? d.r ?? 0.024, h = d.h ?? d.r ?? 0.024;
  return makeCyl(V3(0, h, 0), A, V3(1, 0, 0), w, h, -0.12, 0.12);
}
const leftOf = (s, ext, up, fwd) => s.c.clone().addScaledVector(s.V, -(s.b + ext)).addScaledVector(s.A, -up).addScaledVector(s.U, fwd);

export const GRIPS = {
  // Rechte Hand am Pistolengriff, Zeigefinger am Abzug, Daumen links am Gehäuse
  pistolGrip: {
    shape: d => gripShape(d), F: (d, s) => s.U, B: () => [1, 0.05, 0.3], hOff: d => d.ho ?? 0.018, pc: [0, -0.0175, -0.066],
    index: 'trigger', thumb: (d, s) => leftOf(s, 0.011, d.tu ?? 0.034, s.a * 0.35),
  },
  // Linke Hand unter dem Handschutz (Handfläche links unten, Finger um die rechte Seite, Daumen links vorn)
  under: {
    shape: d => barShape(d), F: () => [0.9, 0.3, -0.42], B: () => [-0.45, -1, -0.04], hOff: () => 0, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => s.c.clone().add(V3(-(s.a + 0.01), -0.004, -0.068)),
  },
  // Linke Hand flach unter dem Vorderschaft (Repetierer)
  flat: {
    shape: d => barShape(d), F: () => [0.95, 0.15, -0.35], B: () => [-0.32, -1, 0], hOff: () => 0, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => s.c.clone().add(V3(-(s.a + 0.011), 0.0, -0.06)),
  },
  // Linke Hand am Pumpschaft
  pump: {
    shape: d => barShape(d), F: () => [0.88, 0.32, -0.38], B: () => [-0.5, -1, -0.03], hOff: () => 0, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => s.c.clone().add(V3(-(s.a + 0.01), -0.004, -0.065)),
  },
  // Linke Hand am senkrechten Vordergriff (QX-90)
  post: {
    shape: d => gripShape({ gw: 0.0275, gd: 0.023, ...d }), F: (d, s) => s.U, B: () => [-1, 0.05, 0], hOff: d => d.ho ?? 0.024, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => leftOf(s, 0.011, 0.045, 0.0),
  },
  // Stützhand an der Pistole: umfasst die Schusshand, Daumen vorn am Rahmen
  pistol: {
    shape: d => gripShape(d, 0.019, 0.012), F: (d, s) => s.U, B: () => [-1, -0.12, 0.06], hOff: d => (d.ho ?? 0) + 0.03, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => leftOf(s, -0.007, 0.022, 0.012),
  },
  // Magazin seitlich greifen (linke Hand)
  mag: {
    shape: d => makeCyl(V3(), V3(0, -1, 0), V3(0, 0, -1), d.d ?? 0.03, d.w ?? 0.012, -0.06, 0.06),
    F: () => [0.08, 0, -1], B: () => [-1, 0.05, 0.15], hOff: () => -0.012, pc: [0, -0.0175, -0.046],
    thumb: (d, s) => s.c.clone().addScaledVector(s.V, -(s.b + 0.011)).addScaledVector(s.U, -s.a * 0.5).addScaledVector(s.A, -0.01),
  },
  // Magazin oben (QX-90): Handfläche auf dem Magazin
  magTop: {
    shape: d => makeCyl(V3(0, -(d.h ?? 0.015), 0), V3(0, 0, -1), V3(1, 0, 0), d.w ?? 0.025, d.h ?? 0.015, -0.17, 0.17),
    F: () => [1, 0, -0.3], B: () => [0.12, 1, 0.1], hOff: () => 0, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => s.c.clone().add(V3(-(s.a + 0.011), 0.0, -0.03)),
  },
  // Messer (Hauptwaffe): Hammergriff, Klinge nach vorn
  knife: {
    shape: d => makeCyl(V3(), V3(0, 0, 1), V3(0, 1, 0), 0.0142, 0.0118, -0.055, 0.05),
    F: () => [0, -1, -0.15], B: () => [1, 0.25, 0], hOff: () => -0.014, pc: [0, -0.0175, -0.045],
    thumb: (d, s) => V3(-0.022, -0.012, -0.035),
  },
  // Kleinteile mit Zeigefinger + Daumen greifen (Spannhebel, Kammerstängel): Punktplatzierung
  pinchSide: { point: [-0.026, -0.045, -0.112], knob: 0.006, F: () => [0.15, 0.1, -1], B: () => [-0.2, 1, 0.1] },
  pinchRight: { point: [-0.026, -0.045, -0.112], knob: 0.006, F: () => [-0.2, 0.25, -1], B: () => [0.8, -0.55, 0] },
  boltKnob: { point: [-0.026, -0.05, -0.105], knob: 0.011, F: () => [-0.1, 0.2, -1], B: () => [0.4, 1, 0] },
  slapTop: { point: [0, -0.0175, -0.06], pose: 'flat', F: () => [0.2, -0.3, -1], B: () => [0, 1, 0.2] },
  slapSide: { point: [0, -0.0175, -0.062], pose: 'flat', F: () => [0.15, 0.3, -1], B: () => [-1, 0.15, 0.25] },
  rack: { point: [0, -0.03, -0.06], pose: 'wrap', F: () => [0.95, -0.1, -0.2], B: () => [0, 1, 0] },
};

const gripCache = new Map();
const KEYS = ['rake', 'gw', 'gd', 'gu', 'gl', 'ho', 'tu', 'r', 'w', 'h', 'd'];

function solveGrip(style, d, side) {
  const g = GRIPS[style] || GRIPS.under;
  const mirror = side < 0;
  const quat = new THREE.Quaternion(), pos = V3();
  if (g.point) {
    // Punktplatzierung: Griffpunkt der Hand liegt auf dem Anker
    basisQuat(g.F(d), g.B(d), quat);
    const pc = V3(...g.point);
    if (mirror) pc.x = -pc.x;
    pos.copy(pc).applyQuaternion(quat).negate();
    if (!POSES.relaxed) buildFreePoses();
    let pose;
    if (g.knob) {
      const s = toHand(makeSphere(V3(), g.knob), pos, quat, mirror);
      const f = [curlFinger(0, s, FINGERS[0].splay * 0.5, [0.9, 1.1, 0.7]).concat(0), [1.2, 1.4, 0.85, 0], [1.25, 1.45, 0.85, 0], [1.3, 1.45, 0.85, 0]];
      pose = makePose(f, solveThumb(s, s.c, [0.3, 0.3]));
    } else pose = POSES[g.pose] || POSES.relaxed;
    return { pos, quat, pose };
  }
  const sA = g.shape(d);
  const ov = d.__ov || {};
  const F = ov.F || g.F(d, sA), B = ov.B || g.B(d, sA);
  basisQuat(F.isVector3 ? F : V3(...F), B.isVector3 ? B : V3(...B), quat);
  // Kontakt: Oberflächenpunkt, dessen Normale zum Handrücken zeigt
  const n = V3(0, 1, 0).applyQuaternion(quat);
  if (sA.type === 'cyl') n.addScaledVector(sA.A, -n.dot(sA.A)).normalize();
  const S = surfacePoint(sA, n, V3());
  if (sA.type === 'cyl') S.addScaledVector(sA.A, g.hOff(d));
  const pc = V3(...(ov.pc || g.pc));
  if (mirror) pc.x = -pc.x;
  pos.copy(S).sub(pc.applyQuaternion(quat));
  // Finger + Daumen im Handraum lösen
  const sH = toHand(sA, pos, quat, mirror);
  const f = [];
  for (let i = 0; i < 4; i++) {
    const splay = FINGERS[i].splay * 0.5;
    if (i === 0 && g.index === 'trigger' && d.trigger && !mirror) {
      const T = V3(...d.trigger).sub(pos).applyQuaternion(quat.clone().invert());
      f.push(reachFinger(0, T, splay, sH));
    } else f.push(curlFinger(i, sH, splay).concat(0));
  }
  const tA = ov.T ? V3(...ov.T) : g.thumb(d, sA);
  const tH = tA.sub(pos).applyQuaternion(quat.clone().invert());
  if (mirror) tH.x = -tH.x;
  const th = solveThumb(sH, tH);
  const pose = makePose(f, th);
  return { pos, quat, pose, thumbCost: th.cost };
}

/**
 * Handtransformation relativ zum Ankerrahmen für eine Griffart + gelöste Fingerpose (gecacht).
 * side: 1 = rechte Hand, −1 = linke Hand.
 */
export function gripTransform(style, data = {}, side = 1, outPos = V3(), outQuat = new THREE.Quaternion()) {
  const d = data || {};
  let key = style + '|' + side;
  for (const k of KEYS) if (d[k] !== undefined) key += '|' + k + d[k];
  if (d.trigger) key += '|t' + d.trigger.join(',');
  let r = gripCache.get(key);
  if (!r) { r = solveGrip(style, d, side); gripCache.set(key, r); }
  outPos.copy(r.pos); outQuat.copy(r.quat);
  return { pos: outPos, quat: outQuat, pose: r.pose };
}

// ---------------------------------------------------------------- Geometrie

function tag(geo, bone, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  // Handflächenseite heller (Wildleder), Rücken dunkel
  const nrm = g.attributes.normal;
  for (let i = 0; i < n; i++) {
    const c = typeof color === 'function' ? color(nrm.getY(i), g.attributes.position.getY(i)) : color;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const sideColor = (ny) => (ny < -0.35 ? PALM : GLOVE);

function capsule(r0, r1, len, seg = 10) {
  // Leicht konisches Fingerglied mit runden Enden, entlang −Z ab Ursprung
  const pts = [];
  const cap = 3;
  for (let i = 0; i <= cap; i++) { const a = -Math.PI / 2 + (i / cap) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
  for (let i = 0; i <= cap; i++) { const a = (i / cap) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r1, len + Math.sin(a) * r1)); }
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(-Math.PI / 2);
  // leicht abgeflacht (Finger sind breiter als hoch)
  g.scale(1.08, 0.92, 1);
  return g;
}

function buildHandGeometry(mirror) {
  const parts = [];
  // Handfläche: verjüngt zum Handgelenk
  const palm = new RoundedBoxGeometry(0.084, 0.032, 0.09, 3, 0.012);
  palm.translate(0, 0.0, -0.045);
  const pa = palm.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const z = pa.getZ(i), t = THREE.MathUtils.clamp(-z / 0.09, 0, 1);
    pa.setX(i, pa.getX(i) * (0.72 + 0.28 * t));
    // gewölbter Handrücken, Handballen
    const y = pa.getY(i);
    if (y > 0) pa.setY(i, y + 0.004 * Math.cos(pa.getX(i) / 0.04 * Math.PI / 2));
    else pa.setY(i, y - 0.003 * (1 - t));
  }
  palm.computeVertexNormals();
  const palmS = mergeVerticesSmooth(palm);

  parts.push(tag(palmS, 0, sideColor));
  // Daumenballen
  const thenar = new THREE.SphereGeometry(0.019, 10, 8);
  thenar.scale(0.9, 0.75, 1.5);
  thenar.translate(-0.021, -0.009, -0.03);
  parts.push(tag(thenar, 0, sideColor));
  // Knöchelschutz (hart) + Polster auf dem Handrücken
  const knuckle = bent(new RoundedBoxGeometry(0.068, 0.008, 0.024, 2, 0.0035), 5);
  knuckle.translate(0, 0.0175, -0.074);
  parts.push(tag(knuckle, 0, PAD));
  const backPad = bent(new RoundedBoxGeometry(0.046, 0.004, 0.036, 2, 0.0018), 7);
  backPad.translate(0.002, 0.0178, -0.036);
  parts.push(tag(backPad, 0, PAD));
  // Bündchen + Klettverschluss
  const cuff = new THREE.CylinderGeometry(0.036, 0.033, 0.055, 14, 1, false);
  cuff.rotateX(Math.PI / 2);
  cuff.scale(1.05, 0.85, 1);
  cuff.translate(0, 0.0, 0.022);
  parts.push(tag(cuff, 0, CUFF));
  const strap = bent(new RoundedBoxGeometry(0.046, 0.005, 0.022, 1, 0.002), 9);
  strap.translate(0.003, 0.0305, 0.02);
  parts.push(tag(strap, 0, PAD));

  // Finger
  let bone = 1;
  for (const f of FINGERS) {
    for (let s = 0; s < 3; s++) {
      const len = f.len[s], r0 = f.r[s], r1 = s < 2 ? f.r[s + 1] : f.r[s] * 0.88;
      const g = capsule(r0, r1, len, 12);
      // Ruheposition entlang −Z ab Knöchel
      let z = f.z;
      for (let k = 0; k < s; k++) z -= f.len[k];
      g.translate(f.x, f.y, z);
      parts.push(tag(g, bone + s, sideColor));
      if (s < 2) {
        // Gepolsterte Glieder auf dem Fingerrücken
        const pad = new RoundedBoxGeometry(r0 * 1.35, 0.003, len * (s ? 0.42 : 0.5), 1, 0.0012);
        pad.translate(f.x, f.y + r0 * 0.86, z - len * 0.5);
        parts.push(tag(pad, bone + s, PAD));
      }
    }
    bone += 3;
  }
  // Daumen (Ruhe entlang seiner eigenen −Z-Achse; Ausrichtung über Knochen-Ruhedrehung)
  const tq = thumbRestQuat();
  let tz = 0;
  for (let s = 0; s < 3; s++) {
    const len = THUMB.len[s], r0 = THUMB.r[s], r1 = s < 2 ? THUMB.r[s + 1] : THUMB.r[s] * 0.88;
    const g = capsule(r0, r1, len, 12);
    if (s === 2) {
      const pad = new RoundedBoxGeometry(r0 * 1.3, 0.003, len * 0.45, 1, 0.0012);
      pad.translate(0, r0 * 0.86, -len * 0.45);
      g.deleteAttribute('uv');
      const merged = mergeGeometries([g.toNonIndexed(), tagPlain(pad)]);
      g.dispose();
      merged.translate(0, 0, tz);
      merged.applyQuaternion(tq);
      merged.translate(...THUMB.base);
      parts.push(tag(merged, 13 + s, sideColor));
    } else {
      g.translate(0, 0, tz);
      g.applyQuaternion(tq);
      g.translate(...THUMB.base);
      parts.push(tag(g, 13 + s, sideColor));
    }
    tz -= len;
  }
  let geo = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  if (mirror) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); n.setX(i, -n.getX(i)); }
    // Dreiecksumlauf umkehren
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name], sz = a.itemSize, arr = a.array;
      for (let t = 0; t < a.count; t += 3) for (let k = 0; k < sz; k++) { const tmp = arr[(t + 1) * sz + k]; arr[(t + 1) * sz + k] = arr[(t + 2) * sz + k]; arr[(t + 2) * sz + k] = tmp; }
    }
  }
  boxUV(geo, 0.03);
  geo.computeBoundingSphere();
  return geo;
}

// Platte entlang X zur Handrücken-Wölbung biegen (y −= k·x²)
function bent(g, k) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - k * p.getX(i) * p.getX(i));
  g.computeVertexNormals();
  return g;
}

function tagPlain(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
}

// Glättet Normalen einer Box (für die Handfläche)
function mergeVerticesSmooth(geo) {
  geo.deleteAttribute('uv');
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  // Gleiche Positionen → gemittelte Normalen
  const p = g.attributes.position, n = g.attributes.normal, map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }
  for (const idx of map.values()) {
    let x = 0, y = 0, z = 0;
    for (const i of idx) { x += n.getX(i); y += n.getY(i); z += n.getZ(i); }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of idx) n.setXYZ(i, x / l, y / l, z / l);
  }
  return g;
}

function thumbRestQuat(mirror = false) {
  const q = basisQuat([-0.62, -0.42, -0.66], [-0.75, 0.6, -0.1]);
  if (mirror) { q.y = -q.y; q.z = -q.z; }
  return q.clone();
}

// Ärmel: konisches Rohr mit Falten entlang −Z (0 → −len)
function sleeveGeometry(len, rA, rB, folds, seed = 1, seg = 14) {
  const pts = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r = rA + (rB - rA) * t;
    r += Math.sin(t * Math.PI * folds + seed) * 0.0025 + Math.sin(t * Math.PI * folds * 2.3 + seed * 2) * 0.0012;
    pts.push(new THREE.Vector2(r, t * len));
  }
  pts.unshift(new THREE.Vector2(rA * 0.7, -0.004));
  pts.push(new THREE.Vector2(rB * 1.04, len + 0.002), new THREE.Vector2(rB * 0.8, len + 0.006));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(-Math.PI / 2);
  g.scale(1.06, 0.94, 1);
  // UVs: Umfang/Länge auf ca. 0.22 m Kachelgröße skalieren
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * rA / 0.22), uv.getY(i) * (len / 0.22));
  return g;
}

// ---------------------------------------------------------------- Arm-Rig

class Arm {
  constructor(side, mats) {
    this.side = side;            // 1 = rechts, −1 = links
    this.group = new THREE.Group();
    this.group.name = side > 0 ? 'arm-rechts' : 'arm-links';
    const geo = buildHandGeometry(side < 0);
    // Knochen
    const bones = [];
    const hand = new THREE.Bone(); hand.name = 'hand'; bones.push(hand);
    this.fingers = [];
    for (const f of FINGERS) {
      const chain = [];
      let parent = hand;
      for (let s = 0; s < 3; s++) {
        const b = new THREE.Bone();
        if (s === 0) b.position.set(f.x * side, f.y, f.z);
        else b.position.set(0, 0, -f.len[s - 1]);
        parent.add(b); bones.push(b); chain.push(b); parent = b;
      }
      this.fingers.push(chain);
    }
    const thumb = [];
    let parent = hand;
    const tq = thumbRestQuat(side < 0);
    for (let s = 0; s < 3; s++) {
      const b = new THREE.Bone();
      if (s === 0) { b.position.set(THUMB.base[0] * side, THUMB.base[1], THUMB.base[2]); b.quaternion.copy(tq); }
      else b.position.set(0, 0, -THUMB.len[s - 1]);
      parent.add(b); bones.push(b); thumb.push(b); parent = b;
    }
    this.thumb = thumb;
    this.handBone = hand;
    this.mesh = new THREE.SkinnedMesh(geo, mats.glove);
    this.mesh.name = 'handschuh';
    this.mesh.add(hand);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // Ärmel (Unter- und Oberarm) + Ellbogen
    this.upperLen = 0.33; this.foreLen = 0.3;
    this.fore = new THREE.Mesh(sleeveGeometry(this.foreLen + 0.008, 0.047, 0.039, 3.2, side > 0 ? 1 : 2.4), mats.sleeve);
    this.upper = new THREE.Mesh(sleeveGeometry(this.upperLen, 0.056, 0.049, 2.2, side > 0 ? 3 : 4.1), mats.sleeve);
    this.elbow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mats.sleeve);
    for (const m of [this.fore, this.upper, this.elbow]) { m.frustumCulled = false; this.group.add(m); }
    // Klebeband am rechten Unterarm, Uhr an der Innenseite des linken Handgelenks
    if (side > 0) {
      const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.0455, 0.0455, 0.032, 16, 1, true), mats.tape);
      tape.geometry.rotateX(Math.PI / 2);
      tape.scale.set(1.06, 0.94, 1);
      tape.position.z = -0.21;
      this.fore.add(tape);
    } else {
      // Uhrgruppe: Ursprung auf der Handgelenksachse, lokal +Y zeigt zur Handflächenseite
      const watch = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.018, 18, 1, true), mats.watchCase);
      band.rotation.x = Math.PI / 2; band.scale.set(1.08, 0.9, 1);
      const caseM = new THREE.Mesh(chamferBoxGeometry(0.032, 0.01, 0.036, 0.0035), mats.watchCase);
      caseM.position.y = 0.0365;
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0122, 20), mats.watchFace);
      // Zifferblatt: nach außen (+Y), Ziffern lesbar vom Handgelenk zu den Fingern
      face.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      face.position.y = 0.0418;
      watch.add(band, caseM, face);
      watch.position.set(0, -0.001, 0.013);
      watch.rotation.z = Math.PI;
      this.handBone.add(watch);
      this.watch = watch;
    }
    this.align = 0.7;            // 0 = reine IK, 1 = Unterarm exakt in Handachse
    this.shoulder = new THREE.Vector3(side * 0.2, -0.3, 0.14);
    this.pole = new THREE.Vector3(side * 0.7, -1, 0.15);
  }

  // Finger + Daumen in eine (gemischte) Pose bringen
  applyPose(pose) {
    const side = this.side;
    for (let i = 0; i < 4; i++) {
      const c = pose.f[i], ch = this.fingers[i];
      ch[0].rotation.set(-c[0], (c[3] + FINGERS[i].splay * 0.5) * side, 0);
      ch[1].rotation.set(-c[1], 0, 0);
      ch[2].rotation.set(-c[2], 0, 0);
    }
    const t = pose.t;
    this.thumb[0].quaternion.set(t[0], t[1] * side, t[2] * side, t[3]).normalize();
    this.thumb[1].rotation.set(-t[4], 0, 0);
    this.thumb[2].rotation.set(-t[5], 0, 0);
  }

  // Handgelenk setzen und Arm per Zwei-Knochen-IK anschließen (alles im Elternraum der Arme)
  solve(wristPos, wristQuat) {
    const hand = this.handBone;
    hand.position.copy(wristPos);
    hand.quaternion.copy(wristQuat);
    const S = _v1.copy(this.shoulder);
    const W = wristPos;
    const toW = _v2.subVectors(W, S);
    let d = toW.length();
    const Lu = this.upperLen, Lf = this.foreLen;
    const maxD = Lu + Lf - 0.002;
    if (d > maxD) { S.copy(W).addScaledVector(toW.normalize(), -maxD); toW.subVectors(W, S); d = maxD; }
    d = Math.max(d, Math.abs(Lu - Lf) + 0.01);
    const dir = toW.normalize();
    const a = (Lu * Lu - Lf * Lf + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, Lu * Lu - a * a));
    const pole = _v3.copy(this.pole);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const E = this._elbow || (this._elbow = new THREE.Vector3());
    E.copy(S).addScaledVector(dir, a).addScaledVector(pole, h);
    // Unterarm folgt überwiegend der Handachse (gerades Handgelenk), Oberarm streckt sich zur Schulter
    const back = _upB.set(0, 0, 1).applyQuaternion(wristQuat);
    const ik = _fd.subVectors(E, W).normalize();
    // Je stärker Handachse und IK-Richtung auseinanderliegen, desto mehr gilt die reine IK (kein Arm durchs Bild)
    const agree = THREE.MathUtils.smoothstep(ik.dot(back), -0.1, 0.55);
    const fd = ik.lerp(back, this.align * agree).normalize();
    E.copy(W).addScaledVector(fd, Lf);
    const up = _upA.set(0, 1, 0).applyQuaternion(wristQuat);
    orient(this.fore, E, W, up, 0.03);
    const S0 = this.shoulder;
    orient(this.upper, S0, E, _upB.set(0, 1, 0), 0.0);
    this.upper.scale.z = THREE.MathUtils.clamp(S0.distanceTo(E) / Lu, 0.6, 1.6);
    this.elbow.position.copy(E);
    this.elbowPos = E;
  }
}
const _upA = V3(), _upB = V3(), _oz = V3(), _oy = V3(), _ox = V3(), _fd = V3();

function orient(mesh, from, to, up, extend) {
  const z = _oz.subVectors(from, to).normalize();     // lokal +Z zeigt zurück zum Ursprung
  const y = _oy.copy(up).addScaledVector(z, -up.dot(z));
  if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(z, -z.y);
  y.normalize();
  const x = _ox.crossVectors(y, z);
  mesh.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
  mesh.position.copy(from).addScaledVector(z, extend);
}

function clonePose(p) { return { f: p.f.map(a => a.slice()), t: p.t.slice() }; }

/** Mischt zwei Posen (a → b mit Gewicht w) in out (Daumen-Quaternion normiert, gleiche Hemisphäre). */
export function mixPose(a, b, w, out) {
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) out.f[i][k] = a.f[i][k] + (b.f[i][k] - a.f[i][k]) * w;
  const sgn = a.t[0] * b.t[0] + a.t[1] * b.t[1] + a.t[2] * b.t[2] + a.t[3] * b.t[3] < 0 ? -1 : 1;
  for (let k = 0; k < 4; k++) out.t[k] = a.t[k] + (b.t[k] * sgn - a.t[k]) * w;
  const l = Math.hypot(out.t[0], out.t[1], out.t[2], out.t[3]) || 1;
  for (let k = 0; k < 4; k++) out.t[k] /= l;
  for (let k = 4; k < 6; k++) out.t[k] = a.t[k] + (b.t[k] - a.t[k]) * w;
  return out;
}

export function copyPose(a, out) {
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) out.f[i][k] = a.f[i][k];
  for (let k = 0; k < 6; k++) out.t[k] = a.t[k];
  return out;
}

export function getPose(name) {
  if (!POSES.relaxed) buildFreePoses();
  return POSES[name] || POSES.relaxed;
}

export function newPose(name = 'relaxed') { return clonePose(getPose(name)); }

// Materialsatz der Arme (überdauert das Match, siehe takeMaterials in materials.js)
function makeArmMaterials() {
  const watchTex = watchFaceTexture();
  const set = {
    glove: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0, normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.22, 0.22) }),
    sleeve: new THREE.MeshStandardMaterial({ map: camoMap('arid'), roughness: 0.92, metalness: 0.0, normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.3, 0.3) }),
    tape: new THREE.MeshStandardMaterial({ map: tapeMap(), roughness: 0.6, metalness: 0.0 }),
    watchCase: new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.55, metalness: 0.2 }),
    watchFace: new THREE.MeshStandardMaterial({ map: watchTex, emissive: 0xffffff, emissiveMap: watchTex, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.0 }),
  };
  for (const [k, m] of Object.entries(set)) m.name = 'vm:' + k;
  return set;
}

export class Arms {
  /** camo: Palettenname ('arid' | 'wood' | 'neutral') oder 5 Hex-Farben (siehe textures.js CAMO_PALETTES). */
  constructor({ camo = 'arid' } = {}) {
    this.mats = takeMaterials('arms', makeArmMaterials);
    this.camo = null;
    this.setCamo(camo);
    getPose('relaxed');
    this.group = new THREE.Group();
    this.group.name = 'arme';
    this.right = new Arm(1, this.mats);
    this.left = new Arm(-1, this.mats);
    this.group.add(this.right.group, this.left.group);
    this._watchTimer = 0;
  }

  /** Ärmel-Tarnmuster wechseln (Team des Spielers); Texturen sind gecacht, kein Neuaufbau der Geometrie. */
  setCamo(camo) {
    const key = Array.isArray(camo) ? camo.join(',') : camo;
    const cur = Array.isArray(this.camo) ? this.camo.join(',') : this.camo;
    if (key === cur) return;
    this.camo = camo;
    // Nur die Textur wechselt (Karte war schon gesetzt) → gleiches Shaderprogramm, kein needsUpdate nötig
    this.mats.sleeve.map = camoMap(camo);
  }

  update(dt) {
    // Uhr regelmäßig neu zeichnen (Minutenanzeige)
    if ((this._watchTimer += dt) > 20) {
      this._watchTimer = 0;
      const tex = this.mats.watchFace.map;
      tex.userData.redraw?.();
    }
  }

  /** Geometrie und Skelette sind je Instanz; die Materialien gehen in den Vorrat (Shaderprogramme bleiben gelinkt). */
  dispose() {
    this.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    this.right.mesh.skeleton.dispose();
    this.left.mesh.skeleton.dispose();
    parkMaterials('arms', this.mats);
  }
}

/** Fehlersuche (Waffenlabor): gelöste Griffdaten inkl. Daumen-/Fingerkuppen im Ankerraum. */
export function gripDebug(style, data = {}, side = 1) {
  const g = GRIPS[style];
  const r = solveGrip(style, data, side);
  const toA = p => { const v = p.clone(); if (side < 0) v.x = -v.x; return v.applyQuaternion(r.quat).add(r.pos).toArray().map(x => +x.toFixed(4)); };
  const q = new THREE.Quaternion(r.pose.t[0], r.pose.t[1], r.pose.t[2], r.pose.t[3]);
  thumbFK(q, [r.pose.t[4], r.pose.t[5]]);
  const thumb = _tp.map(toA);
  const fingers = r.pose.f.map((th, i) => { fingerFK(i, th, th[3] + FINGERS[i].splay * 0.5); return toA(_fp[3]); });
  const sA = g.shape ? g.shape(data) : null;
  const sH = sA ? toHand(sA, r.pos, r.quat, side < 0) : null;
  const hits = sH ? [0, 1, 2, 3].map(i => { curlFinger(i, sH, FINGERS[i].splay * 0.5); return curlFinger.hits.map(h => (h ? 1 : 0)).join(''); }) : null;
  return { hits, thumbCost: r.thumbCost, pos: r.pos.toArray().map(x => +x.toFixed(4)), thumb, fingers, f: r.pose.f.map(a => a.map(x => +x.toFixed(2))), target: sA && g.thumb ? g.thumb(data, sA).toArray().map(x => +x.toFixed(4)) : null, shapeC: sA ? sA.c.toArray() : null };
}
