// Ego-Arme: Handschuhhände als SkinnedMesh (je Hand 1 Draw Call, 17 Knochen: Hand, Fingerglieder, Daumen, Unterarm),
// Unter-/Oberarm-Ärmel mit Tarnmuster, Zwei-Knochen-IK von der Schulter zum Handgelenk, Uhr + Klebeband.
// Handkoordinaten (rechte Hand): Handgelenk im Ursprung, Finger −Z, Handrücken +Y, Daumen −X.
// Die linke Hand ist gespiegelt gebaut (gleiche Semantik: Finger −Z, Handrücken +Y, Daumen +X).
//
// Griff-Löser: Jede Griffart beschreibt einen Kollisionskörper (elliptischer Zylinder / Kugel) im Ankerraum.
// Die Hand wird so platziert, dass die Handfläche ihn berührt; die Fingerglieder beugen sich der Reihe nach,
// bis sie anliegen; der Zeigefinger sucht den Abzug; die Daumenausrichtung wird gesucht, bis die Kuppe ihr
// Ziel auf der Gegenseite erreicht. Ergebnisse werden je Griffart + Maßen gecacht.
import * as THREE from 'three';
import { chamferBoxGeometry } from './builder.js';
import { camoMap, watchFaceTexture, tapeMap, fbm } from './textures.js';
import { takeMaterials, parkMaterials } from './materials.js';
import { contactHit, MultiCollider } from './contact.js';

// Fingermaße + Bindehaltung des Handschuhnetzes (hands-v3): gemeinsam mit tools/assets/hands/build-hand.mjs
import { FINGERS, THUMB, THUMB_REST, BIND_SPLAY, BIND_CURL, BIND_THUMB_FLEX, handDimsKey } from './handdims.js';
import { GLOVE_MESH } from './glove-mesh.js';

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
const WRIST_FLEX = 1.2, WRIST_EXT = 1.0, WRIST_DEV = 0.42;   // rad (≈ 69°, 57°, 24°)
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
const wrapF = (s, w = 0) => (w ? s.U.clone().multiplyScalar(Math.cos(w)).addScaledVector(s.V, Math.sin(w)) : s.U);
const wrapB = (s, w) => s.V.clone().multiplyScalar(Math.cos(w)).addScaledVector(s.U, -Math.sin(w)).addScaledVector(s.A, -0.05);
const leftOf = (s, ext, up, fwd) => s.c.clone().addScaledVector(s.V, -(s.b + ext)).addScaledVector(s.A, -up).addScaledVector(s.U, fwd);

export const GRIPS = {
  // Rechte Hand am Pistolengriff, Zeigefinger am Abzug, Daumen links am Gehäuse
  // wrap (hands-v3, Pistolen): Hand um die Griffachse nach hinten gedreht – Handballen rechts hinten, Daumenwurzel links
  // hinten am Griffrücken (hoch im Biber), Daumen liegt links am Rahmen unter dem Schlitten nach vorn (nicht darüber)
  pistolGrip: {
    shape: d => gripShape(d), F: (d, s) => wrapF(s, d.wrap), B: (d, s) => (d.wrap ? wrapB(s, d.wrap) : [1, 0.05, 0.3]), hOff: d => d.ho ?? 0.018, pc: [0, -0.0175, -0.066],
    index: 'trigger', thumb: (d, s) => leftOf(s, 0.011, d.tu ?? 0.034, d.wrap ? (d.tf ?? 0.03) : s.a * 0.35),
  },
  // Linke Hand unter dem Handschutz (Handfläche links unten, Finger um die rechte Seite, Daumen links vorn).
  // Finger schräg nach vorn oben → das Handgelenk liegt hinten unten, der Unterarm kommt kurz und steil von
  // unten (CoD-Mobile-Hüfte) statt als langer Schlauch von links.
  under: {
    shape: d => barShape(d), F: () => [0.62, 0.45, -0.64], B: () => [-0.55, -1, -0.12], hOff: () => 0, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => s.c.clone().add(V3(-(s.a + 0.01), -0.004, -0.068)),
  },
  // Linke Hand flach unter dem Vorderschaft (Repetierer)
  flat: {
    shape: d => barShape(d), F: () => [0.7, 0.3, -0.65], B: () => [-0.42, -1, -0.06], hOff: () => 0, pc: [0, -0.0175, -0.05],
    thumb: (d, s) => s.c.clone().add(V3(-(s.a + 0.011), 0.0, -0.06)),
  },
  // Linke Hand am Pumpschaft
  pump: {
    shape: d => barShape(d), F: () => [0.62, 0.46, -0.64], B: () => [-0.58, -1, -0.1], hOff: () => 0, pc: [0, -0.0175, -0.05],
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
const KEYS = ['rake', 'gw', 'gd', 'gu', 'gl', 'ho', 'tu', 'r', 'w', 'h', 'd', 'wrap', 'tf'];

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

// ---------------------------------------------------------------- Handschuhnetz (hands-v3)
// Ein geglättetes, gehäutetes Netz je Hand aus glove-mesh.js (erzeugt von tools/assets/hands/build-hand.mjs aus einem
// Distanzfeld anatomischer Grundkörper, ≈ 3,5k Dreiecke high / 1,5k low): weiche Hautgewichte über die Gelenke
// (≤ 4 Knochen je Ecke), Bündchen auf dem Unterarm-Knochen 16 (folgt dem Ärmel, steckt immer darin); Masken (Leder-
// Innenhand, Polster, Bündchen, Abrieb) + Umgebungsverdeckung als Attribute für den Handschuh-Shader. Die Kapseln
// (FINGERS/THUMB) bleiben unsichtbar die Messkörper für Kontaktlöser und Prüfwerkzeuge.
const DEC = {};
function unb64(s, T) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); }
function decodeGlove(lod) {
  if (DEC[lod]) return DEC[lod];
  if (GLOVE_MESH.key !== handDimsKey()) console.warn('[arms] glove-mesh.js passt nicht zu handdims.js – node tools/assets/hands/build-hand.mjs ausführen');
  const M = GLOVE_MESH[lod], n = M.n, q = unb64(M.pos, Uint16Array), nq = unb64(M.nrm, Int8Array);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) { const k = i % 3; pos[i] = M.lo[k] + q[i] * M.sc[k]; nrm[i] = nq[i] / 127; }
  return (DEC[lod] = { n, pos, nrm, idx: unb64(M.idx, Uint16Array), ski: unb64(M.ski, Uint8Array), skw: unb64(M.skw, Uint8Array), msk: unb64(M.msk, Uint8Array), ao: unb64(M.ao, Uint8Array) });
}
function gloveGeometry(mirror, lod = 'high') {
  const D = decodeGlove(lod === 'low' ? 'low' : 'high');
  const pos = D.pos.slice(), nrm = D.nrm.slice(), idx = D.idx.slice();
  if (mirror) {
    for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nrm[i] = -nrm[i]; }
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = a; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(D.ski, 4));
  g.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(D.skw, 4, true));
  g.setAttribute('gloveMask', new THREE.Uint8BufferAttribute(D.msk, 4, true));
  g.setAttribute('gloveAO', new THREE.Uint8BufferAttribute(D.ao, 1, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function thumbRestQuat(mirror = false) {
  const q = basisQuat(THUMB_REST.F, THUMB_REST.B);
  if (mirror) { q.y = -q.y; q.z = -q.z; }
  return q.clone();
}
// Bindehaltung im Pose-Format (applyPose spiegelt für die linke Hand)
function bindPose() {
  const q = thumbRestQuat(false);
  return { f: BIND_CURL.map((c, i) => [c[0], c[1], c[2], BIND_SPLAY[i] - FINGERS[i].splay * 0.5]), t: [q.x, q.y, q.z, q.w, BIND_THUMB_FLEX[0], BIND_THUMB_FLEX[1]] };
}

// Ärmel (hands-v3): Stoffrohr entlang −Z (0 = Ellbogen/Schulter → −len = Handgelenk/Ellbogen) mit Muskelform, zum
// Ende ovaler (Unterarm am Handgelenk), schräg verlaufenden Stauchfalten (an den Enden dichter), über dem elastischen
// Saum gebauschter Stoff (bunch) und Saumeinzug (cinch); beide Enden als gerundete, umgeschlagene Kante mit Futter
// nach innen – aus keinem Winkel ist eine offene Röhre oder Rückseite zu sehen (Material zusätzlich beidseitig).
// Vertex-Farben = Stoffschattierung (Faltentäler dunkler, Säume/Futter abgedunkelt). userData.fit(z) → {rx, ry}:
// Außenmaß ohne Falten an lokaler Höhe z (für Zubehör-Ringe, Klettlasche, Uhr).
function sleeveGeometry(len, rA, rB, folds, seed = 1, { bulge = 0, bulgeAt = 0.3, seg = 16, oval = 0, bunch = 0, cinch = 0, lining = 0.016, N = 26 } = {}) {
  const S = THREE.MathUtils.smoothstep, lip = 0.0017;
  const radius = (t) => rB + (rA - rB) * (1 - S(t, 0.06, 1)) + bulge * Math.exp(-(((t - bulgeAt) / 0.2) ** 2)) - cinch * S(t, 1 - 0.04 / len, 1);
  const ovalT = (t) => oval * S(t, 0.55, 1);
  const prof = [];   // [z, r, Faltenanteil, Helligkeit, t]
  const r0 = radius(0), r1 = radius(1);
  prof.push([-lining, r0 - 2 * lip, 0, 0.4, 0], [-0.004, r0 - 2 * lip, 0, 0.46, 0]);
  for (let k = 0; k <= 4; k++) { const a = Math.PI * (1 - k / 4); prof.push([Math.sin(a) * lip, r0 - lip + Math.cos(a) * lip, 0, 0.5 + 0.08 * k, 0]); }
  for (let i = 1; i < N; i++) {
    const t = 1 - Math.pow(1 - i / N, 1.5);
    const fw = 0.7 + 0.8 * Math.exp(-t / 0.14) + 1.1 * Math.exp(-(1 - t) / 0.12);
    const shade = 1 - 0.12 * Math.exp(-t / 0.05) - 0.12 * Math.exp(-(1 - t) / 0.05);
    prof.push([-t * len, radius(t), fw, shade, t]);
  }
  for (let k = 0; k <= 4; k++) { const a = Math.PI * (k / 4); prof.push([-len - Math.sin(a) * lip, r1 - lip + Math.cos(a) * lip, 0, 0.82 - 0.08 * k, 1]); }
  prof.push([-len + 0.004, r1 - 2 * lip, 0, 0.46, 1], [-len + lining, r1 - 2 * lip, 0, 0.4, 1]);
  const rows = prof.length, cols = seg + 1;
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2), col = new Float32Array(rows * cols * 3);
  const uS = 2 * Math.PI * rA / 0.22;
  for (let i = 0; i < rows; i++) {
    const [z, r0_, fw, shade, t] = prof[i];
    const dEnd = (1 - t) * len, ot = ovalT(t), sx = 1.06 + 0.07 * ot, sy = 0.94 - 0.1 * ot;
    const env = bunch * S(dEnd, 0.075, 0.03) * S(dEnd, 0.004, 0.016) * (fw > 0 ? 1 : 0);
    for (let j = 0; j < cols; j++) {
      const th = (j / seg) * Math.PI * 2;
      // schräge, unregelmäßige Faltenringe: Phase wandert mit dem Umfang
      const ph = t * Math.PI * folds * 1.7 + seed + 0.9 * Math.sin(th * 2 + seed) + 0.45 * Math.sin(th * 3 - seed * 1.7);
      const f = Math.sin(ph) * 0.62 + Math.sin(ph * 2.3 + seed * 2 + th) * 0.38;
      // Bausch über dem Saum: wulstige, ungleichmäßige Ringe (≈ 1,6 cm), nach außen gewölbt
      const pb = dEnd / 0.016 * Math.PI * 2 + 1.3 * Math.sin(th + seed) + 0.6 * Math.sin(2 * th - seed * 1.3);
      const puff = Math.pow(0.5 + 0.5 * Math.sin(pb), 0.8) * (0.75 + 0.25 * Math.sin(th * 3 + seed * 2.1));
      const r = r0_ + f * 0.003 * fw * (fw > 0 ? 1 : 0) + env * puff;
      const k = i * cols + j;
      pos[k * 3] = Math.sin(th) * r * sx; pos[k * 3 + 1] = Math.cos(th) * r * sy; pos[k * 3 + 2] = z;
      uv[k * 2] = (j / seg) * uS; uv[k * 2 + 1] = -z / 0.22;
      const c = shade * (fw > 0 ? 0.9 + 0.13 * f * Math.min(1, fw) : 1) * (env > 0 ? 0.86 + 0.2 * puff * env / bunch : 1);
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = c;
    }
  }
  const idx = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * cols + j, b = a + cols, c = b + 1, d = a + 1;
    idx.push(a, d, b, d, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Naht schließen: erste und letzte Spalte teilen die Position → gleiche Normale
  const n = g.attributes.normal;
  for (let i = 0; i < rows; i++) {
    const a = i * cols, b = a + seg;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  g.userData.fit = (z) => {
    const t = THREE.MathUtils.clamp(-z / len, 0, 1), r = radius(t), ot = ovalT(t);
    return { rx: r * (1.06 + 0.07 * ot), ry: r * (0.94 - 0.1 * ot) };
  };
  return g;
}

// ---------------------------------------------------------------- Arm-Rig

class Arm {
  constructor(side, mats, lod = 'high') {
    this.side = side;            // 1 = rechts, −1 = links
    this.group = new THREE.Group();
    this.group.name = side > 0 ? 'arm-rechts' : 'arm-links';
    const geo = gloveGeometry(side < 0, lod);
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
    // Unterarm-Knochen (16): trägt das Bündchen, folgt in solve() dem Ärmel (Ursprung Handgelenk, +Z zum Ellbogen)
    const foreBone = new THREE.Bone(); foreBone.name = 'unterarm'; bones.push(foreBone);
    this.foreBone = foreBone;
    this.mesh = new THREE.SkinnedMesh(geo, mats.glove);
    this.mesh.name = 'handschuh';
    this.mesh.add(hand, foreBone);
    this.applyPose(bindPose());   // Bindehaltung des Netzes (leicht gespreizt/gebeugt)
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // Ärmel (Unter- und Oberarm) + Ellbogen
    this.upperLen = 0.33; this.foreLen = 0.3;
    // Unterarm: kräftig am Ellbogen (Muskelbauch), schlank zum Bündchen; Oberarm kaum verjüngt
    // Unterarm: zum Handgelenk oval, über dem elastischen Saum gebauscht, Saum liegt eng über dem Handschuh-Bündchen
    const seg = lod === 'low' ? 14 : 20;
    this.fore = new THREE.Mesh(sleeveGeometry(this.foreLen + 0.008, 0.049, 0.0355, 3.2, side > 0 ? 1 : 2.4, { bulge: 0.004, bulgeAt: 0.22, oval: 1, bunch: 0.0036, cinch: 0.0046, seg, N: lod === 'low' ? 22 : 30 }), mats.sleeve);
    this.upper = new THREE.Mesh(sleeveGeometry(this.upperLen, 0.056, 0.05, 2.2, side > 0 ? 3 : 4.1, { bulge: 0.002, bulgeAt: 0.55, seg: lod === 'low' ? 14 : 18 }), mats.sleeve);
    const elbowGeo = new THREE.SphereGeometry(0.05, 12, 8);
    elbowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(elbowGeo.attributes.position.count * 3).fill(0.86), 3));
    this.elbow = new THREE.Mesh(elbowGeo, mats.sleeve);
    for (const m of [this.fore, this.upper, this.elbow]) { m.frustumCulled = false; this.group.add(m); }
    // Klettlasche am Ärmelsaum (Außenseite, über dem Bausch), Klebeband am rechten Unterarm, Uhr an der Innenseite
    // des linken Handgelenks (auf dem Unterarm-Knochen: sitzt auf dem Bündchen, das dem Ärmel folgt)
    const fit = this.fore.geometry.userData.fit, zEnd = -(this.foreLen + 0.008);
    const tabFit = fit(zEnd + 0.02);
    const tabGeo = chamferBoxGeometry(0.019, 0.0022, 0.026, 0.0009);
    tabGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tabGeo.attributes.position.count * 3).fill(0.9), 3));
    // UV wie der Ärmel (≈ 0,22 m je Kachel), sonst zeigt die Lasche nur einen Tarnfleck
    { const p = tabGeo.attributes.position, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = 0.3 + p.getX(i) / 0.22; uv[i * 2 + 1] = 0.6 + p.getZ(i) / 0.22; } tabGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    const tab = new THREE.Mesh(tabGeo, mats.sleeve);
    const ta = side * 0.42;   // Winkel um die Ärmelachse (von oben zur Außenseite)
    tab.position.set(Math.sin(ta) * (tabFit.rx + 0.0036), Math.cos(ta) * (tabFit.ry + 0.0036), zEnd + 0.017);
    tab.rotation.set(0.06, 0, -ta * 0.92);
    tab.frustumCulled = false;
    this.fore.add(tab);
    if (side > 0) {
      // Radius = Ärmelprofil an dieser Stelle (+ Faltenhöhe), damit das Band anliegt
      const tf = fit(-0.21);
      const tape = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.032, 18, 1, true), mats.tape);
      tape.geometry.rotateX(Math.PI / 2);
      tape.scale.set(tf.rx + 0.0034, tf.ry + 0.0034, 1);
      tape.position.z = -0.21;
      this.fore.add(tape);
    } else {
      // Uhrgruppe: Ursprung auf der Handgelenksachse, lokal +Y zeigt zur Handflächenseite; Band umschließt das
      // Handschuh-Bündchen (≈ 2,8 × 2,0 cm Halbachsen bei +1 cm)
      const watch = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.016, 22, 1, true), mats.watchCase);
      band.rotation.x = Math.PI / 2; band.scale.set(0.0292, 0.0222, 1);
      const caseM = new THREE.Mesh(chamferBoxGeometry(0.03, 0.009, 0.034, 0.0032), mats.watchCase);
      caseM.position.y = 0.0262;
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0115, 20), mats.watchFace);
      // Zifferblatt: nach außen (+Y), Ziffern lesbar vom Handgelenk zu den Fingern
      face.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      face.position.y = 0.0308;
      watch.add(band, caseM, face);
      watch.position.set(0, -0.0008, 0.0105);
      watch.rotation.z = Math.PI;
      this.foreBone.add(watch);
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

  /**
   * Kontakt mit der Waffe (hands): Hand (Ziel T.pos/T.quat im Elternraum der Arme, Pose bereits per applyPose gesetzt)
   * starr aus der Waffe schieben (Handballen, Fingergrund, Daumenballen), dann je Finger-/Daumenkette die Glieder
   * aus der Oberfläche drehen – je Punkt das Gelenk der Kette mit dem größten Hebel (Daumengrund frei, sonst nur
   * Beugeachse, in Gelenkgrenzen) – und bei grip greifende Finger an die Oberfläche beugen (Spalt ≤ 2,5 mm). Was
   * danach noch steckt, schiebt ein zweiter starrer Durchgang (alle Punkte) heraus. col: GunCollider (contact.js).
   * Ändert T.pos und die Knochen. opts: { grip: bool, skipIndex: bool (Zeigefinger am Abzug), push: m }
   */
  contact(col, T, opts = {}) {
    const hand = this.handBone;
    hand.position.copy(T.pos); hand.quaternion.copy(T.quat);
    hand.updateMatrixWorld(true);
    hand.matrixWorld.decompose(_c1, _cq, _cs);
    this._sc = _cs.x || 1;
    this._start = (this._start || V3()).copy(hand.position);
    this._maxPush = (opts.push ?? 0.08) / this._sc;
    // Requisit in DIESER Hand (Granate, Messer, Platte) bewegt sich mit ihr: nur für Finger/Daumen, nicht starr
    const cc = opts.own ? _multi.set([col, opts.own]) : col;
    if (this._rigid(col, false)) opts.own?.sync();
    this._chains(cc, opts);
    const saved = _saved;
    if (opts.grip) {
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) saved[i * 3 + k] = this.fingers[i][k].rotation.x;
      this._grip(cc, opts); this._chains(cc, opts);
    }
    if (this._rigid(col, true)) { opts.own?.sync(); this._chains(cc, opts); }
    // Handballen/Fingergrund haben Vorrang (Finger lösen sich danach über ihre Gelenke)
    if (this._rigid(col, false)) { opts.own?.sync(); this._chains(cc, opts); }
    // Greifen darf nie verschlechtern: steckt ein Finger danach noch, zwischen dem Stand vor dem Anlegen und dem
    // angelegten halbieren (hands 2: früher ganz zurück – die Finger standen dann 2–4 cm vom Handschutz ab)
    if (opts.grip) for (let i = 0; i < 4; i++) {
      if (this._fingerPen(cc, i) <= 0.0015) continue;
      const ch = this.fingers[i];
      for (let k = 0; k < 3; k++) _gripCur[k] = ch[k].rotation.x;
      let lo = 0, hi = 1;
      for (let it = 0; it < 6; it++) {
        const mid = (lo + hi) / 2;
        for (let k = 0; k < 3; k++) ch[k].rotation.x = saved[i * 3 + k] + (_gripCur[k] - saved[i * 3 + k]) * mid;
        ch[0].updateMatrixWorld(true);
        if (this._fingerPen(cc, i) <= 0.0012) lo = mid; else hi = mid;
      }
      for (let k = 0; k < 3; k++) ch[k].rotation.x = saved[i * 3 + k] + (_gripCur[k] - saved[i * 3 + k]) * lo;
      ch[0].updateMatrixWorld(true);
      this._unpenChain(cc, ch, FINGERS[i].len, FINGERS[i].r, this._sc, false, TS_F);
    }
    if (opts.grip && opts.rest) this._gripSearch(cc, opts);
    // hands 2: was jetzt noch steckt (Daumen am Schlitten/Trommelkran, Finger im Bügel, Handballen beim Griff an
    // Schlitten oder Granate): erst Ersatzhaltungen je Kette, dann ein weiterer starrer Durchgang mit mehr Spielraum
    this._rescue(cc);
    this._maxPush = 0.13 / this._sc;
    if (this._rigid(col, true)) { opts.own?.sync(); this._chains(cc, opts); this._rescue(cc); }
    if (opts.rest) this._restNudge(cc, opts);
    T.pos.copy(hand.position);
  }

  // Größtes Eindringen der ganzen Hand (Handballen, Finger, Daumen)
  _handPen(col) {
    const hand = this.handBone, sc = this._sc;
    let worst = -Infinity;
    for (let k = 0; k < 9; k++) { const R = RIGID[k]; _c1.set(R.p[0] * this.side, R.p[1], R.p[2]).applyMatrix4(hand.matrixWorld); worst = Math.max(worst, col.pen(_c1, R.r * sc, _hit)); }
    for (let i = 0; i < 5; i++) worst = Math.max(worst, this._chainPen(col, i));
    return worst;
  }

  /**
   * Ruhegriff (hands 2, einmal je Waffe gemerkt): steckt die Hand danach noch (zwischen eng stehenden Griffteilen
   * eingeklemmt, Brecher/Bulldog), kleine Versätze entlang der Handachsen probieren (je mit Lösen der Ketten).
   */
  _restNudge(col, opts) {
    const hand = this.handBone;
    let best = this._handPen(col);
    if (best <= 0.0015) return;
    const bones = this._allBones || (this._allBones = [...this.fingers.flat(), ...this.thumb]);
    const base = _nudgeBase, keep = _nudgeKeep;
    bones.forEach((b, i) => b.quaternion.toArray(base, i * 4));
    base[60] = hand.position.x; base[61] = hand.position.y; base[62] = hand.position.z;
    keep.set(base);
    for (let ax = 0; ax < 6 && best > 0.0015; ax++) {
      _c5.set(ax >> 1 === 0 ? 1 : 0, ax >> 1 === 1 ? 1 : 0, ax >> 1 === 2 ? 1 : 0).multiplyScalar(ax & 1 ? -1 : 1).applyQuaternion(hand.quaternion);
      for (const st of NUDGE) {
        bones.forEach((b, i) => b.quaternion.fromArray(base, i * 4));
        hand.position.set(base[60], base[61], base[62]).addScaledVector(_c5, st / this._sc);
        hand.updateMatrixWorld(true);
        opts.own?.sync();
        this._chains(col, opts);
        const p = this._handPen(col);
        if (p < best - 0.0005) { best = p; bones.forEach((b, i) => b.quaternion.toArray(keep, i * 4)); keep[60] = hand.position.x; keep[61] = hand.position.y; keep[62] = hand.position.z; }
      }
    }
    bones.forEach((b, i) => b.quaternion.fromArray(keep, i * 4));
    hand.position.set(keep[60], keep[61], keep[62]);
    hand.updateMatrixWorld(true);
    opts.own?.sync();
  }

  // Abstand (m) von Mittel-/Endglied eines Fingers zur Waffe (wie das Prüfwerkzeug; ≤ 0 = liegt an)
  _fingerGap(col, i) {
    const f = FINGERS[i], H = _hit;
    let g = 0.06;
    for (let s = 1; s < 3; s++) for (const t of TS_F) {
      const r = f.r[s] * 0.92 * this._sc;
      if (col.query(segPoint(this.fingers[i][s], f.len[s], t, _c1), r + 0.06, H)) g = Math.min(g, H.d - r);
    }
    return g;
  }

  /**
   * Ruhegriff (hands 2, nur beim gemerkten Lösen): greifende Finger, die nach dem Anlegen noch > 5 mm abstehen
   * (kleiner Finger hinter dem Handschutz, Finger neben dem Griff), im Grundgelenk abspreizen und neu anlegen; es
   * bleibt die Lage mit dem kleinsten Abstand ohne Eindringen.
   */
  _gripSearch(col, opts) {
    for (let i = 0; i < 4; i++) {
      if (i === 0 && opts.skipIndex) continue;
      const ch = this.fingers[i];
      let g0 = this._fingerGap(col, i);
      if (g0 <= 0.005) continue;
      for (let k = 0; k < 3; k++) { ch[k].quaternion.toArray(_rsBest, k * 4); ch[k].quaternion.toArray(_rsBase, k * 4); }
      for (const sp of GRIP_SPLAY) {
        for (let k = 0; k < 3; k++) ch[k].quaternion.fromArray(_rsBase, k * 4);
        ch[0].rotation.y += sp * this.side;
        ch[0].updateMatrixWorld(true);
        this._grip(col, opts, i);
        if (this._fingerPen(col, i) > 0.0012) continue;
        const g = this._fingerGap(col, i);
        if (g < g0 - 0.002) { g0 = g; for (let k = 0; k < 3; k++) ch[k].quaternion.toArray(_rsBest, k * 4); }
      }
      for (let k = 0; k < 3; k++) ch[k].quaternion.fromArray(_rsBest, k * 4);
      ch[0].updateMatrixWorld(true);
    }
  }

  // Größtes Eindringen einer Kette (0–3 Finger, 4 Daumen)
  _chainPen(col, i) {
    if (i < 4) return this._fingerPen(col, i);
    let worst = -Infinity;
    for (let s = 0; s < 3; s++) for (const t of TS_T) worst = Math.max(worst, col.pen(segPoint(this.thumb[s], THUMB.len[s], t, _c1), THUMB.r[s] * 0.92 * this._sc, _hit));
    return worst;
  }

  // Ersatzhaltungen (hands 2) für Ketten, die nach dem Lösen noch > 1,5 mm stecken: Grundgelenk abspreizen bzw.
  // (Daumen) um seine drei Achsen drehen, Glieder strecken oder beugen – je mit Lösen; die beste Haltung bleibt.
  _rescue(col) {
    const sc = this._sc;
    for (let i = 0; i < 5; i++) {
      const thumb = i === 4, ch = thumb ? this.thumb : this.fingers[i];
      let best = this._chainPen(col, i);
      if (best <= 0.0015) continue;
      for (let k = 0; k < 3; k++) { ch[k].quaternion.toArray(_rsBest, k * 4); ch[k].quaternion.toArray(_rsBase, k * 4); }
      const C = thumb ? RESCUE_T : RESCUE_F;
      for (let c = 0; c < C.length && best > 0.0015; c++) {
        for (let k = 0; k < 3; k++) ch[k].quaternion.fromArray(_rsBase, k * 4);
        const a = C[c];
        if (thumb) {
          ch[0].quaternion.multiply(_cq2.setFromAxisAngle(_c5.set(a[0], a[1], a[2]).normalize(), a[3]));
          if (a[4] >= 0) { ch[1].rotation.x = -a[4]; ch[2].rotation.x = -a[4]; }
        } else {
          ch[0].rotation.y += a[0] * this.side;
          if (a[1] >= 0) for (let k = 0; k < 3; k++) ch[k].rotation.x = -a[1] * FMAX[k];
        }
        ch[0].updateMatrixWorld(true);
        this._unpenChain(col, ch, thumb ? THUMB.len : FINGERS[i].len, thumb ? THUMB.r : FINGERS[i].r, sc, thumb, thumb ? TS_T : TS_F);
        const p = this._chainPen(col, i);
        if (p < best - 0.0003) { best = p; for (let k = 0; k < 3; k++) ch[k].quaternion.toArray(_rsBest, k * 4); }
      }
      for (let k = 0; k < 3; k++) ch[k].quaternion.fromArray(_rsBest, k * 4);
      ch[0].updateMatrixWorld(true);
    }
  }

  /**
   * Schnellprüfung (hands 2) für Bilder ohne Lösen (low/medium): Hand auf T setzen (Knochen wie gesetzt) und das
   * größte Eindringen an Handballen, Fingergliedern und Daumen messen (≈ 30 Abfragen statt mehrerer Hundert).
   */
  quickPen(col, T) {
    const hand = this.handBone;
    hand.position.copy(T.pos); hand.quaternion.copy(T.quat);
    hand.updateMatrixWorld(true);
    hand.matrixWorld.decompose(_c1, _cq, _cs);
    const sc = _cs.x || 1;
    let worst = -Infinity;
    for (let k = 0; k < 9; k += 2) { const R = RIGID[k]; _c1.set(R.p[0] * this.side, R.p[1], R.p[2]).applyMatrix4(hand.matrixWorld); worst = Math.max(worst, col.pen(_c1, R.r * sc, _hit)); }
    for (let i = 0; i < 4; i++) for (let s = 0; s < 3; s++) for (const t of s ? QTS : QTS0) worst = Math.max(worst, col.pen(segPoint(this.fingers[i][s], FINGERS[i].len[s], t, _c1), FINGERS[i].r[s] * 0.92 * sc, _hit));
    for (let s = 0; s < 3; s++) for (const t of QTS) worst = Math.max(worst, col.pen(segPoint(this.thumb[s], THUMB.len[s], t, _c1), THUMB.r[s] * 0.92 * sc, _hit));
    return worst;
  }

  _fingerPen(col, i) {
    let worst = -Infinity;
    for (let s = 0; s < 3; s++) for (const t of TS_F) worst = Math.max(worst, col.pen(segPoint(this.fingers[i][s], FINGERS[i].len[s], t, _c1), FINGERS[i].r[s] * 0.92 * this._sc, _hit));
    return worst;
  }

  // Starr herausschieben: all = alle Hand-Punkte (sonst nur Handballen/Fingergrund/Daumenballen). true = bewegt.
  _rigid(col, all) {
    const hand = this.handBone, H = _hit, sc = this._sc;
    let moved = false;
    for (let it = 0; it < 6; it++) {
      // Mittel der Eindringvektoren (eingeklemmte Hand pendelt nicht zwischen zwei Seiten), Länge ≥ halbe Tiefe
      let worst = CONTACT_TOL, wd = null, n = 0;
      _c8.set(0, 0, 0);
      const test = (p, r) => { const pen = col.pen(p, r, H); if (pen > CONTACT_TOL) { _c8.addScaledVector(H.dir, pen); n++; if (pen > worst) { worst = pen; wd = _c3.copy(H.dir); } } };
      for (let k = 0; k < RIGID.length; k++) {
        const R = RIGID[k];
        if (R.bone < 0) _c1.set(R.p[0] * this.side, R.p[1], R.p[2]).applyMatrix4(hand.matrixWorld);
        else segPoint(R.bone < 13 ? this.fingers[(R.bone - 1) / 3 | 0][0] : this.thumb[0], R.len, R.t, _c1);
        test(_c1, R.r * sc);
      }
      if (all) {
        for (let i = 0; i < 4; i++) for (let s = 0; s < 3; s++) for (const t of TS_F) test(segPoint(this.fingers[i][s], FINGERS[i].len[s], t, _c1), FINGERS[i].r[s] * 0.92 * sc);
        for (let s = 0; s < 3; s++) for (const t of TS_T) test(segPoint(this.thumb[s], THUMB.len[s], t, _c1), THUMB.r[s] * 0.92 * sc);
      }
      if (!wd) break;
      const avg = _c8.divideScalar(n), al = avg.length();
      if (al > worst * 0.5) wd.copy(avg).divideScalar(al); else if (al > 1e-5) wd.copy(avg).divideScalar(al).multiplyScalar(Math.max(al, worst * 0.5) / worst);
      else break;   // ringsum gleich tief eingeklemmt: Finger lösen das über die Gelenke
      _c1.setFromMatrixPosition(hand.matrixWorld).addScaledVector(wd, worst + 0.0004);
      _c1.applyMatrix4(_cm.copy(hand.parent.matrixWorld).invert());
      hand.position.copy(_c1);
      if (hand.position.distanceTo(this._start) > this._maxPush) hand.position.sub(this._start).setLength(this._maxPush).add(this._start);
      hand.updateMatrixWorld(true);
      moved = true;
    }
    return moved;
  }

  // Alle Ketten (Daumen, vier Finger) aus der Waffe drehen
  _chains(col, opts) {
    const sc = this._sc;
    this._unpenChain(col, this.thumb, THUMB.len, THUMB.r, sc, true, TS_T);
    for (let i = 0; i < 4; i++) this._unpenChain(col, this.fingers[i], FINGERS[i].len, FINGERS[i].r, sc, false, TS_F);
  }

  // Kette: je Glied den tiefsten Punkt suchen und über das wirksamste Gelenk (0..s) herausdrehen
  _unpenChain(col, ch, lens, radii, sc, freeBase, ts) {
    const H = _hit;
    let baseTurn = 0;
    for (let s = 0; s < 3; s++) {
      const r = radii[s] * 0.92 * sc;
      for (let it = 0; it < 5; it++) {
        let worst = CONTACT_TOL;
        for (const t of ts) {
          const pen = col.pen(segPoint(ch[s], lens[s], t, _c1), r, H);
          if (pen > worst) { worst = pen; _c4.copy(_c1); _c3.copy(H.dir); }
        }
        if (worst <= CONTACT_TOL) break;
        // wirksamstes Gelenk wählen
        let bj = -1, bv = 0, bdc = 0;
        for (let j = s; j >= 0; j--) {
          if (freeBase && j === 0) {
            if (baseTurn >= 0.8) continue;
            ch[0].getWorldPosition(_c2);
            const l = _c6.crossVectors(_c5.subVectors(_c4, _c2), _c3).length();
            if (l > bv) { bv = l; bj = 0; bdc = 0; }
            continue;
          }
          const vn = this._flexRate(ch[j], _c4, _c3);
          if (Math.abs(vn) < 2e-4) continue;
          const want = THREE.MathUtils.clamp((worst + 0.0005) / vn, -0.6, 0.6);
          const cur = -ch[j].rotation.x, lim = j === 0 ? FLIM0 : FLIM;
          const got = THREE.MathUtils.clamp(cur + want, lim[0], j === 0 ? lim[1] : FMAX[j]) - cur;
          if (Math.abs(got) < 1e-3) continue;
          const eff = Math.abs(vn) * Math.abs(got / want);
          if (eff > bv) { bv = eff; bj = j; bdc = got; }
        }
        if (bj < 0) break;
        if (freeBase && bj === 0) {
          ch[0].getWorldPosition(_c2);
          const ax = _c6.crossVectors(_c5.subVectors(_c4, _c2), _c3);
          const l = ax.length();
          let da = Math.min(0.35, (worst + 0.0005) / l, 0.8 - baseTurn);
          baseTurn += da;
          ax.divideScalar(l).applyQuaternion(ch[0].getWorldQuaternion(_cq).invert());
          ch[0].quaternion.multiply(_cq2.setFromAxisAngle(ax, da));
          ch[0].updateMatrixWorld(true);
        } else {
          ch[bj].rotation.x -= bdc;
          ch[bj].updateMatrixWorld(true);
        }
      }
    }
  }

  // Bewegung (m/rad) von Punkt p entlang dir beim Beugen des Glieds (Beugen = Drehung um −X des Glieds)
  _flexRate(bone, p, dir) {
    bone.getWorldPosition(_c2);
    _c5.set(1, 0, 0).applyQuaternion(bone.getWorldQuaternion(_cq)).negate();
    return _c6.crossVectors(_c5, _c7.subVectors(p, _c2)).dot(dir);
  }

  // Greifende Finger an die Oberfläche beugen: nächster Punkt von Mittel-/Endglied, über Mittel- und Endgelenk
  _grip(col, opts, only = -1) {
    const H = _hit, sc = this._sc;
    for (let i = 0; i < 4; i++) {
      if ((i === 0 && opts.skipIndex) || (only >= 0 && i !== only)) continue;
      const ch = this.fingers[i], f = FINGERS[i];
      for (let it = 0; it < 5; it++) {
        let g = Infinity, gs = -1;
        for (let s = 1; s < 3; s++) for (const t of TS_F) {
          segPoint(ch[s], f.len[s], t, _c1);
          if (col.query(_c1, f.r[s] * sc + 0.05, H) && H.d - f.r[s] * 0.92 * sc < g) { g = H.d - f.r[s] * 0.92 * sc; gs = s; _c4.copy(_c1); _c3.copy(H.dir).negate(); }
        }
        if (gs < 0 || g <= 0.002) break;
        // Gelenk mit dem größten Hebel zur Oberfläche (Grund-, Mittel- oder Endgelenk; Endgelenk nur für Punkte am Endglied)
        let bj = -1, bv = 2e-4;
        for (const j of gs === 2 ? [0, 1, 2] : [0, 1]) {
          const vn = this._flexRate(ch[j], _c4, _c3);
          if (vn > bv && -ch[j].rotation.x < FMAX[j] - 1e-3) { bv = vn; bj = j; }
        }
        if (bj < 0) break;
        const cur = -ch[bj].rotation.x;
        ch[bj].rotation.x = -Math.min(FMAX[bj], cur + Math.min(0.5, (g - 0.0008) / bv));
        ch[bj].updateMatrixWorld(true);
      }
    }
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
    // Handgelenk-Grenzen (hands): Unterarmrichtung im Handraum (+Z = gerade) auf natürliche Bereiche begrenzen –
    // Beugung ≤ 70°, Streckung ≤ 60°, Abspreizung ≤ 25°; den Rest übernehmen Ellbogen/Oberarm (Ärmel dehnt sich).
    const dl = fd.applyQuaternion(_cq.copy(wristQuat).invert());
    const pitch = THREE.MathUtils.clamp(Math.atan2(-dl.y, dl.z), -WRIST_EXT, WRIST_FLEX);
    const yaw = THREE.MathUtils.clamp(Math.atan2(dl.x, dl.z), -WRIST_DEV, WRIST_DEV);
    fd.set(Math.tan(yaw), -Math.tan(pitch), 1).normalize().applyQuaternion(wristQuat);
    E.copy(W).addScaledVector(fd, Lf);
    const up = _upA.set(0, 1, 0).applyQuaternion(wristQuat);
    orient(this.fore, E, W, up, 0.03);
    const S0 = this.shoulder;
    orient(this.upper, S0, E, _upB.set(0, 1, 0), 0.0);
    this.upper.scale.z = THREE.MathUtils.clamp(S0.distanceTo(E) / Lu, 0.6, 1.6);
    this.elbow.position.copy(E);
    this.elbowPos = E;
    // Bündchen-Knochen = Ärmel am Handgelenk (gleiche Drehung wie der Unterarm-Ärmel, Ursprung im Handgelenk)
    this.foreBone.position.copy(W);
    this.foreBone.quaternion.copy(this.fore.quaternion);
  }
}
// Fingermaße für Prüfwerkzeuge (tools/out/hands2/probe.mjs)
Arm.FINGER_R = FINGERS.map(f => f.r.slice());
Arm.FINGER_L = FINGERS.map(f => f.len.slice());
const _upA = V3(), _upB = V3(), _oz = V3(), _oy = V3(), _ox = V3(), _fd = V3();
const _c1 = V3(), _c2 = V3(), _c3 = V3(), _c4 = V3(), _c5 = V3(), _c6 = V3(), _c7 = V3(), _c8 = V3(), _cs = V3();
const _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cm = new THREE.Matrix4();
const _hit = contactHit(), _multi = new MultiCollider(), _saved = new Float32Array(12);
const _gripCur = new Float32Array(3), _rsBest = new Float32Array(12), _rsBase = new Float32Array(12);
const _nudgeBase = new Float32Array(63), _nudgeKeep = new Float32Array(63), NUDGE = [0.004, 0.008, 0.013, 0.02];
const QTS0 = [0.5], QTS = [0.5, 0.92], GRIP_SPLAY = [0.12, -0.12, 0.24, -0.24, 0.36, -0.36];
// Ersatzhaltungen (hands 2) – Finger: [Abspreizen rad, Beugung als Anteil von FMAX (−1 = lassen)];
// Daumen: [Achse x, y, z (Grundgliedraum), Winkel rad, Beugung Mittel-/Endglied rad (−1 = lassen)]
const RESCUE_F = [[0.2, -1], [-0.2, -1], [0.4, -1], [-0.4, -1], [0, 0.04], [0, 0.95], [0.25, 0.5], [-0.25, 0.5]];
const RESCUE_T = [[1, 0, 0, 0.5, -1], [1, 0, 0, -0.5, -1], [0, 1, 0, 0.5, -1], [0, 1, 0, -0.5, -1], [0, 0, 1, 0.6, -1], [0, 0, 1, -0.6, -1], [1, 0, 0, 0.9, 0.1], [0, 1, 0, -0.9, 0.1], [0, 0, 0, 0, 0.05], [1, 0, 0, -0.9, 0.5]];
// Starre Kontaktpunkte: Handballen (Handraum, x gespiegelt je Seite), Fingergrund, Daumenballen
const RIGID = [];
for (const x of [-0.025, 0, 0.025]) for (const z of [-0.065, -0.035, -0.01]) RIGID.push({ bone: -1, p: [x, 0, z], r: 0.011 });
for (let i = 0; i < 4; i++) RIGID.push({ bone: 1 + i * 3, len: FINGERS[i].len[0], t: 0.15, r: FINGERS[i].r[0] * 0.92 });
RIGID.push({ bone: 13, len: THUMB.len[0], t: 0.2, r: THUMB.r[0] * 0.92 });
function segPoint(bone, len, t, out) { return out.set(0, 0, -len * t).applyMatrix4(bone.matrixWorld); }
const TS_F = [0.15, 0.5, 0.9], TS_T = [0.2, 0.6, 0.95];          // Messpunkte je Glied (wie tools/out/hands2/probe.mjs)
const CONTACT_TOL = 0.0006;                                       // m zulässiges Eindringen beim Lösen
const FLIM0 = [-0.25, FMAX[0]], FLIM = [-0.1, 0];                 // Beugegrenzen Grundglied / Mittel-+Endglied (oben FMAX)

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

// ---------------------------------------------------------------- Handschuh-/Ärmel-Texturen (hands, hands-v3)
// Prozedural, kachelbar, je Größe gecacht. Handschuh (hands-v3) = eine RGBA-Detailkarte, im Shader dreiachsig über die
// Bindeposition gelegt (keine UV-Nähte, klebt an der Haut): R Strickstoff-Höhe (Stretch-Rücken), G Narbung des
// Synthetikleders (Innenhand), B Abrieb/Schmutz, A Faser-Helligkeit. Ärmel = Ripstop-Gewebe als Normal-Map.
// Größe je Qualität: low 256², medium 512², high/ultra 1024².
const TEX = new Map();
function texCanvas(S) { const c = document.createElement('canvas'); c.width = c.height = S; return c; }
function mkTex(c, srgb, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}
function normalFromHeight(h, S, strength) {
  const c = texCanvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = h[y * S + ((x - 1 + S) % S)], r = h[y * S + ((x + 1) % S)], u = h[((y - 1 + S) % S) * S + x], b = h[((y + 1) % S) * S + x];
    let nx = (l - r) * strength, ny = (u - b) * strength, nz = 1;
    const k = 1 / Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4;
    d[i] = (nx * k * 0.5 + 0.5) * 255; d[i + 1] = (ny * k * 0.5 + 0.5) * 255; d[i + 2] = (nz * k * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
export function gloveDetail(S = 512) {
  const key = 'gloveD' + S;
  if (TEX.has(key)) return TEX.get(key);
  // Kachel = 3,5 cm: 40 Maschenstäbchen (0,9 mm), Leder-Poren ≈ 0,3 mm, Abrieb-Flecken ≈ 3–6 mm
  const grain = fbm(S, S, { seed: 71, period: S >= 1024 ? 96 : 64, octaves: 2, gain: 0.55 });
  const pore = fbm(S, S, { seed: 72, period: 28, octaves: 2, gain: 0.5 });
  const crease = fbm(S, S, { seed: 76, period: 9, octaves: 3, gain: 0.5 });
  const wear = fbm(S, S, { seed: 73, period: 8, octaves: 3 }), fib = fbm(S, S, { seed: 75, period: S >> 3, octaves: 2 });
  const d = new Uint8Array(S * S * 4), cols = 40, rows = 52;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, u = (x / S) * cols, v = (y / S) * rows, fu = u - Math.floor(u);
    // Rechts-Links-Maschen: Stäbchen mit V-förmig versetzten Schlaufen
    const loop = 0.5 + 0.5 * Math.sin((v + Math.abs(fu - 0.5) * 1.2) * Math.PI * 2);
    const knit = 0.18 + 0.62 * Math.sin(fu * Math.PI) * (0.55 + 0.45 * loop) + (fib[i] - 0.5) * 0.25;
    const leather = 0.55 + (grain[i] - 0.5) * 0.7 - Math.max(0, pore[i] - 0.6) * 1.6 - Math.pow(1 - Math.abs(crease[i] - 0.5) * 2, 8) * 0.35;
    d[i * 4] = THREE.MathUtils.clamp(knit, 0, 1) * 255;
    d[i * 4 + 1] = THREE.MathUtils.clamp(leather, 0, 1) * 255;
    d[i * 4 + 2] = THREE.MathUtils.clamp(wear[i], 0, 1) * 255;
    d[i * 4 + 3] = THREE.MathUtils.clamp(0.5 + (fib[i] - 0.5) * 1.4, 0, 1) * 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  TEX.set(key, t);
  return t;
}
export function sleeveWeave(S = 512) {
  const key = 'weave' + S;
  if (TEX.has(key)) return TEX.get(key);
  // 6 Ripstop-Karos je Kachel (Kachel ≈ 3,7 cm auf dem Ärmel), Grundbindung mit 2 px-Fäden
  const h = new Float32Array(S * S), cell = S / 6, th = Math.max(2, S >> 8);
  const n = fbm(S, S, { seed: 81, period: 16, octaves: 2 });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = (x / th) | 0, wy = (y / th) | 0;
    const base = (wx + wy) & 1 ? 0.35 + 0.25 * Math.sin((x % th) / th * Math.PI) : 0.35 + 0.25 * Math.sin((y % th) / th * Math.PI);
    const gx = Math.abs((x % cell) - cell / 2) > cell / 2 - th * 1.5, gy = Math.abs((y % cell) - cell / 2) > cell / 2 - th * 1.5;
    h[y * S + x] = base + (gx || gy ? 0.45 : 0) + n[y * S + x] * 0.25;
  }
  const t = mkTex(normalFromHeight(h, S, 1.4), false, 6);
  TEX.set(key, t);
  return t;
}
const texSize = q => (q === 'low' ? 256 : q === 'medium' ? 512 : 1024);

/**
 * Klassen-Handschuhton (hands-v3): taktische Töne statt Pappe/Haut – Standard Schwarz/Anthrazit, Klassen behalten
 * ihren Farbton (Grau, Coyote, Braun, Oliv, Dunkeloliv, Elite schwarz), Sättigung ≤ 0,32, Helligkeit 0,2–0,42
 * (Untergrenze: schwarzer Handschuh säuft im Schatten nicht ab; Glanzsaum im Shader hält die Kontur).
 */
const GLOVE_DEFAULT = '#383a3d';
const _hsl = {};
export function gloveTone(hex, out = new THREE.Color()) {
  if (!hex || /^#?f{6}$/i.test(hex)) return out.set(GLOVE_DEFAULT);
  out.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  return out.setHSL(_hsl.h, Math.min(_hsl.s, 0.32), THREE.MathUtils.clamp(_hsl.l * 0.82, 0.2, 0.42), THREE.SRGBColorSpace);
}

// Handschuh-Shader (hands-v3): MeshStandardMaterial + Einschübe. Masken je Ecke (gloveMask: Leder, Polster, Bündchen,
// Abrieb; gloveAO) → Grundfarbe je Zone (Stretch-Rücken, dunkleres Synthetikleder innen, TPR-Polster, Neopren-
// Bündchen), Nähte als scharfe Linien auf den Zonengrenzen (Ableitungs-geglättet), Abrieb an Kuppen/Handballen,
// Feld-AO; Rauheit je Zone; Mikrorelief (Strick/Narbung/Nahtrillen) über Höhen-Ableitungen (ohne Tangenten/UVs, ab
// medium); weicher Stoff-Glanzsaum (Sheen) aus der diffusen Beleuchtung → Kontur bleibt auch im Schatten lesbar.
function makeGloveMaterial(S) {
  const m = new THREE.MeshStandardMaterial({ color: GLOVE_DEFAULT, roughness: 0.85, metalness: 0.0 });
  const U = { gloveDetail: { value: gloveDetail(S) }, gloveTile: { value: 1 / 0.035 }, gloveBump: { value: 0.00032 }, gloveSheen: { value: 0.32 } };
  m.userData.gloveU = U;
  m.defines = { GLOVE_BUMP: '' };
  m.customProgramCacheKey = () => 'glove-v3';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 gloveMask;\nattribute float gloveAO;\nvarying vec4 vGM;\nvarying float vGAO;\nvarying vec3 vBP;\nvarying vec3 vBN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGM = gloveMask; vGAO = gloveAO; vBP = position; vBN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D gloveDetail; uniform float gloveTile; uniform float gloveBump; uniform float gloveSheen;
varying vec4 vGM; varying float vGAO; varying vec3 vBP; varying vec3 vBN;
float gL, gPad, gCuf, gWear, gH;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 bw = abs(normalize(vBN)); bw *= bw; bw *= bw; bw /= (bw.x + bw.y + bw.z);
  vec3 P = vBP * gloveTile;
  vec4 tx = texture2D(gloveDetail, P.zy) * bw.x + texture2D(gloveDetail, P.xz) * bw.y + texture2D(gloveDetail, P.xy) * bw.z;
  gL = smoothstep(0.4, 0.6, vGM.x); gPad = smoothstep(0.4, 0.6, vGM.y); gCuf = smoothstep(0.35, 0.65, vGM.z) * (1.0 - gPad);
  vec3 base = diffuseColor.rgb;
  vec3 fabric = base * (0.9 + 0.3 * (tx.a - 0.5)) * (0.94 + 0.12 * tx.r);
  vec3 leather = base * vec3(0.6, 0.6, 0.63) * (0.9 + 0.3 * (tx.g - 0.5));
  vec3 padC = base * 0.56 * (0.95 + 0.1 * tx.g);
  vec3 cuffC = base * 0.8 * (0.92 + 0.16 * tx.r);
  vec3 col = mix(mix(fabric, leather, gL), padC, gPad);
  col = mix(col, cuffC, gCuf);
  float sw = fwidth(vGM.x) * 1.3 + 0.012, pw = fwidth(vGM.y) * 1.3 + 0.012, cw = fwidth(vGM.z) * 1.3 + 0.012;
  float seam = max((1.0 - smoothstep(0.0, sw, abs(vGM.x - 0.5))) * (1.0 - gCuf), 1.0 - smoothstep(0.0, pw, abs(vGM.y - 0.5)));
  seam = max(seam, 1.0 - smoothstep(0.0, cw, abs(vGM.z - 0.5)));
  // Steppnaht neben der Kappnaht (heller Faden, gestrichelt entlang der Grenze)
  float st = (1.0 - smoothstep(0.0, sw, abs(abs(vGM.x - 0.5) - 0.09))) * step(0.5, fract(dot(P, vec3(9.0, 11.0, 13.0)))) * (1.0 - gCuf);
  col *= 1.0 - 0.5 * seam;
  col = mix(col, base * 1.25 + 0.012, st * 0.35);
  gWear = vGM.w * smoothstep(0.3, 0.7, tx.b + vGM.w * 0.3);
  col = mix(col, col * 1.55 + 0.018, gWear * 0.55);
  col *= 0.88 + 0.24 * tx.b * (1.0 - gWear);
  col *= mix(1.0, vGAO, 0.85);
  diffuseColor.rgb = col;
  gH = mix(tx.r * 0.75, tx.g * 0.55, gL) * (1.0 - gPad) + gPad * (0.5 + tx.g * 0.15) - seam * 0.9 + gCuf * tx.r * 0.2;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(mix(0.86, 0.6, gL), 0.5, gPad);
roughnessFactor = mix(roughnessFactor, 0.92, gCuf) - gWear * 0.18 + 0.06 * (vGAO - 0.7);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef GLOVE_BUMP
{
  vec2 dH = vec2(dFdx(gH), dFdy(gH)) * gloveBump;
  vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
  vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
  float det = dot(sX, R1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2));
}
#endif`)
      .replace('#include <opaque_fragment>', `{
  float fr = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
  fr = fr * fr * fr;
  vec3 irr = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb, vec3(0.03));
  outgoingLight += irr * fr * gloveSheen * mix(1.0, 0.4, gL) * (1.0 - 0.6 * gPad) * vec3(0.92, 0.95, 1.0);
}
#include <opaque_fragment>`);
  };
  return m;
}

// Materialsatz der Arme (überdauert das Match, siehe takeMaterials in materials.js)
function makeArmMaterials() {
  const watchTex = watchFaceTexture();
  const set = {
    glove: makeGloveMaterial(512),
    // Ärmel beidseitig: Futter/Saum zeigen Stoff, nie eine offene Rückseite
    sleeve: new THREE.MeshStandardMaterial({ map: camoMap('arid'), vertexColors: true, roughness: 0.9, metalness: 0.0, normalMap: sleeveWeave(512), normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide }),
    tape: new THREE.MeshStandardMaterial({ map: tapeMap(), roughness: 0.6, metalness: 0.0 }),
    watchCase: new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.55, metalness: 0.2 }),
    watchFace: new THREE.MeshStandardMaterial({ map: watchTex, emissive: 0xffffff, emissiveMap: watchTex, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.0 }),
  };
  for (const [k, m] of Object.entries(set)) m.name = 'vm:' + k;
  return set;
}

export class Arms {
  /** camo: Palettenname ('arid' | 'wood' | 'neutral') oder 5 Hex-Farben (siehe textures.js CAMO_PALETTES). */
  constructor({ camo = 'arid', quality = 'high' } = {}) {
    this.mats = takeMaterials('arms', makeArmMaterials);
    this.camo = null;
    this.setCamo(camo);
    this.setQuality(quality);
    getPose('relaxed');
    this.group = new THREE.Group();
    this.group.name = 'arme';
    // LOD: Handschuhnetz ≈ 3,5k Dreiecke je Hand (high/medium) bzw. ≈ 1,5k (low), Ärmel 20 bzw. 14 Segmente
    const lod = quality === 'low' ? 'low' : 'high';
    this.right = new Arm(1, this.mats, lod);
    this.left = new Arm(-1, this.mats, lod);
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

  /** Texturgröße/Mikrorelief je Qualität (Karten werden getauscht; low ohne Relief → eigenes Programm). */
  setQuality(q) {
    const S = texSize(q);
    if (S === this._texS) return;
    this._texS = S;
    const g = this.mats.glove, sl = this.mats.sleeve;
    if (g.userData.gloveU) g.userData.gloveU.gloveDetail.value = gloveDetail(S);
    // Mikrorelief erst ab medium (low: nur Zonenfarben, Nähte, AO, Glanzsaum)
    const bump = q !== 'low';
    if (g.defines && ('GLOVE_BUMP' in g.defines) !== bump) { if (bump) g.defines.GLOVE_BUMP = ''; else delete g.defines.GLOVE_BUMP; g.needsUpdate = true; }
    sl.normalMap = sleeveWeave(S);
  }

  /** Handschuhfarbe (Klassen-Look, sRGB-Hex); Töne werden auf taktische Werte gebracht (gloveTone). */
  setGlove(hex) { gloveTone(hex, this.mats.glove.color); }

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
