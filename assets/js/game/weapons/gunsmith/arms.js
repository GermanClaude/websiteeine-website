// Ego-Arme: Handschuhhände als SkinnedMesh (je Hand 1 Draw Call, 16 Knochen mit Fingergliedern),
// Unter-/Oberarm-Ärmel mit Tarnmuster, Zwei-Knochen-IK von der Schulter zum Handgelenk, Uhr + Klebeband.
// Handkoordinaten (rechte Hand): Handgelenk im Ursprung, Finger −Z, Handrücken +Y, Daumen −X.
// Die linke Hand ist gespiegelt gebaut (gleiche Semantik: Finger −Z, Handrücken +Y).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { boxUV, chamferBoxGeometry } from './builder.js';
import { camoMap, fabricNormal, watchFaceTexture, tapeMap } from './textures.js';

const FINGERS = [
  { x: -0.0285, y: 0.001, z: -0.08, len: [0.043, 0.027, 0.022], r: [0.0094, 0.0088, 0.0082], splay: 0.07 },
  { x: -0.0093, y: 0.002, z: -0.084, len: [0.047, 0.03, 0.023], r: [0.0097, 0.0091, 0.0084], splay: 0.0 },
  { x: 0.0102, y: 0.001, z: -0.081, len: [0.044, 0.028, 0.022], r: [0.0093, 0.0087, 0.008], splay: -0.06 },
  { x: 0.0285, y: -0.002, z: -0.073, len: [0.034, 0.022, 0.019], r: [0.0084, 0.0078, 0.0073], splay: -0.14 },
];
const THUMB = { base: [-0.027, -0.011, -0.018], len: [0.042, 0.032, 0.026], r: [0.0128, 0.0112, 0.0101] };

const GLOVE = new THREE.Color(0x2c2e30), PALM = new THREE.Color(0x5b554b), PAD = new THREE.Color(0x141516), CUFF = new THREE.Color(0x3a3c36);

// Fingerposen: f = [beuge1, beuge2, beuge3, spreizung] je Finger (Zeige→kleiner Finger),
// t = [Opposition, Adduktion, Beugung1, Beugung2, Beugung3] Daumen
export const POSES = {
  relaxed: { f: [[0.25, 0.3, 0.2, 0], [0.3, 0.35, 0.2, 0], [0.35, 0.4, 0.25, 0], [0.4, 0.45, 0.3, 0]], t: [0.2, 0.0, 0.1, 0.15, 0.1] },
  open: { f: [[0.05, 0.08, 0.05, 0.05], [0.05, 0.08, 0.05, 0], [0.05, 0.1, 0.05, -0.04], [0.08, 0.1, 0.06, -0.08]], t: [0.0, -0.1, 0.0, 0.05, 0.05] },
  trigger: { f: [[0.32, 0.5, 0.3, 0.06], [1.28, 1.45, 0.75, 0], [1.32, 1.45, 0.75, -0.02], [1.35, 1.4, 0.7, -0.06]], t: [0.95, 0.25, 0.3, 0.45, 0.3] },
  support: { f: [[0.85, 0.85, 0.45, 0.1], [0.95, 0.9, 0.5, 0.02], [1.0, 0.95, 0.5, -0.04], [1.05, 0.95, 0.5, -0.1]], t: [0.3, 0.2, 0.1, 0.15, 0.1] },
  pump: { f: [[1.05, 1.05, 0.55, 0.05], [1.1, 1.05, 0.55, 0], [1.12, 1.05, 0.55, -0.03], [1.15, 1.05, 0.55, -0.08]], t: [0.5, 0.2, 0.2, 0.3, 0.2] },
  flat: { f: [[0.45, 0.5, 0.3, 0.06], [0.5, 0.55, 0.3, 0], [0.55, 0.55, 0.3, -0.04], [0.6, 0.55, 0.3, -0.1]], t: [0.2, 0.1, 0.05, 0.1, 0.1] },
  post: { f: [[1.15, 1.3, 0.7, 0.04], [1.2, 1.35, 0.7, 0], [1.25, 1.35, 0.7, -0.03], [1.3, 1.35, 0.7, -0.07]], t: [0.95, 0.25, 0.3, 0.45, 0.3] },
  wrap: { f: [[1.0, 1.1, 0.6, 0.0], [1.05, 1.15, 0.6, 0], [1.1, 1.15, 0.6, -0.02], [1.15, 1.15, 0.6, -0.06]], t: [0.3, 0.3, 0.1, 0.15, 0.1] },
  mag: { f: [[0.75, 0.85, 0.45, 0.05], [0.85, 0.9, 0.5, 0], [0.95, 0.95, 0.5, -0.03], [1.05, 1.0, 0.55, -0.08]], t: [0.7, 0.2, 0.2, 0.3, 0.2] },
  pinch: { f: [[0.7, 0.85, 0.55, 0.0], [1.2, 1.35, 0.8, 0], [1.3, 1.4, 0.8, -0.03], [1.35, 1.4, 0.8, -0.07]], t: [0.8, 0.5, 0.35, 0.5, 0.4] },
  fist: { f: [[1.45, 1.6, 0.9, 0.0], [1.5, 1.6, 0.9, 0], [1.5, 1.6, 0.9, -0.02], [1.5, 1.6, 0.9, -0.05]], t: [1.1, 0.5, 0.4, 0.6, 0.5] },
  knife: { f: [[1.35, 1.45, 0.8, 0.02], [1.38, 1.5, 0.8, 0], [1.4, 1.5, 0.8, -0.02], [1.42, 1.5, 0.8, -0.05]], t: [1.0, 0.4, 0.35, 0.5, 0.4] },
  ball: { f: [[0.75, 0.55, 0.35, 0.16], [0.8, 0.55, 0.35, 0.04], [0.85, 0.6, 0.35, -0.08], [0.9, 0.65, 0.4, -0.2]], t: [0.8, 0.2, 0.2, 0.3, 0.25] },
};

// Griffarten: Fingerrichtung F und Handrückenrichtung B im Ankerraum, Kontaktpunkt p (Handraum)
// (Werte für die rechte bzw. linke Hand gleichermaßen; die gespiegelte Hand kümmert sich um die Seite.)
export const GRIPS = {
  pistolGrip: { F: rake => [0, -Math.sin(rake) - 0.05, -Math.cos(rake)], B: [1, 0.08, 0.0], p: [-0.016, -0.029, -0.054], pose: 'trigger' },
  under: { F: () => [0.95, 0.25, -0.55], B: [-0.42, -1, -0.1], p: [0.0, -0.018, -0.058], pose: 'support' },
  flat: { F: () => [0.95, 0.1, -0.45], B: [-0.25, -1, 0], p: [0.0, -0.017, -0.055], pose: 'flat' },
  pump: { F: () => [0.9, 0.3, -0.5], B: [-0.45, -1, -0.1], p: [0.0, -0.018, -0.056], pose: 'pump' },
  post: { F: rake => [0.05, -Math.sin(rake), -Math.cos(rake)], B: [-1, 0.1, 0.1], p: [0.002, -0.03, -0.056], pose: 'post' },
  pistol: { F: () => [0.42, -0.62, -0.6], B: [-0.85, -0.3, 0.25], p: [0.006, -0.042, -0.05], pose: 'wrap' },
  mag: { F: () => [0.0, -0.25, -1], B: [-1, 0, 0], p: [0.0, -0.022, -0.05], pose: 'mag' },
  magTop: { F: () => [0.6, 0, -0.8], B: [0, 1, 0], p: [0.0, -0.03, -0.05], pose: 'mag' },
  pinchSide: { F: () => [0.15, 0.1, -1], B: [-0.2, 1, 0.1], p: [-0.022, -0.018, -0.088], pose: 'pinch' },
  pinchRight: { F: () => [-0.2, -0.1, -1], B: [0.6, 1, 0], p: [-0.024, -0.02, -0.088], pose: 'pinch' },
  boltKnob: { F: () => [-0.1, 0.2, -1], B: [0.4, 1, 0], p: [-0.02, -0.022, -0.086], pose: 'pinch' },
  slapTop: { F: () => [0.2, -0.3, -1], B: [0, 1, 0.2], p: [0.0, -0.022, -0.06], pose: 'flat' },
  rack: { F: () => [0.95, -0.1, -0.2], B: [0, 1, 0], p: [0.0, -0.03, -0.06], pose: 'wrap' },
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

function basisQuat(F, B, out = new THREE.Quaternion()) {
  const z = _v1.set(-F[0], -F[1], -F[2]).normalize();
  const y = _v2.set(B[0], B[1], B[2]);
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = _v3.crossVectors(y, z).normalize();
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

/** Lokale Handtransformation (relativ zum Ankerrahmen) für eine Griffart. */
export function gripTransform(style, data = {}, outPos = new THREE.Vector3(), outQuat = new THREE.Quaternion()) {
  const g = GRIPS[style] || GRIPS.under;
  basisQuat(g.F(data.rake ?? 0.3), g.B, outQuat);
  const p = _v1.set(g.p[0], g.p[1], g.p[2]).applyQuaternion(outQuat);
  outPos.copy(p).negate();
  return { pos: outPos, quat: outQuat, pose: g.pose };
}

// ---------- Geometrie ----------

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
  // Knöchelschutz (hart) + Polster auf den Grundgliedern
  const knuckle = chamferBoxGeometry(0.07, 0.012, 0.03, 0.004);
  knuckle.translate(0, 0.019, -0.073);
  parts.push(tag(knuckle, 0, PAD));
  const backPad = chamferBoxGeometry(0.05, 0.006, 0.04, 0.0025);
  backPad.translate(0.002, 0.0175, -0.035);
  parts.push(tag(backPad, 0, PAD));
  // Bündchen + Klettverschluss
  const cuff = new THREE.CylinderGeometry(0.036, 0.033, 0.055, 14, 1, true);
  cuff.rotateX(Math.PI / 2);
  cuff.scale(1.05, 0.85, 1);
  cuff.translate(0, 0.0, 0.022);
  parts.push(tag(cuff, 0, CUFF));
  const strap = chamferBoxGeometry(0.05, 0.008, 0.024, 0.002);
  strap.translate(0.004, 0.031, 0.02);
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
      if (s === 0) {
        const pad = chamferBoxGeometry(r0 * 1.7, 0.005, len * 0.55, 0.0018);
        pad.translate(f.x, f.y + r0 * 0.95, z - len * 0.45);
        parts.push(tag(pad, bone, PAD));
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
    g.translate(0, 0, tz);
    g.applyQuaternion(tq);
    g.translate(...THUMB.base);
    parts.push(tag(g, 13 + s, sideColor));
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

// Glättet Normalen einer Box (für die Handfläche) ohne Indexverlust
function mergeVerticesSmooth(geo) {
  geo.deleteAttribute('uv');
  const g = geo.toNonIndexed();
  geo.dispose();
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
  const d = [-0.62, -0.42, -0.66];
  const q = basisQuat(d, [-0.75, 0.6, -0.1]);
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

// ---------- Arm-Rig ----------

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
    this.thumbRest = tq;
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
    this.fore = new THREE.Mesh(sleeveGeometry(this.foreLen + 0.03, 0.047, 0.037, 3.2, side > 0 ? 1 : 2.4), mats.sleeve);
    this.upper = new THREE.Mesh(sleeveGeometry(this.upperLen, 0.056, 0.049, 2.2, side > 0 ? 3 : 4.1), mats.sleeve);
    this.elbow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mats.sleeve);
    for (const m of [this.fore, this.upper, this.elbow]) { m.frustumCulled = false; this.group.add(m); }
    // Klebeband am rechten Unterarm, Uhr am linken Handgelenk (Innenseite)
    if (side > 0) {
      const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.0455, 0.0455, 0.032, 16, 1, true), mats.tape);
      tape.geometry.rotateX(Math.PI / 2);
      tape.scale.set(1.06, 0.94, 1);
      tape.position.z = -0.21;
      this.fore.add(tape);
    } else {
      const watch = new THREE.Group();
      const caseM = new THREE.Mesh(chamferBoxGeometry(0.036, 0.012, 0.04, 0.004), mats.watchCase);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0135, 20), mats.watchFace);
      face.rotation.x = -Math.PI / 2; face.position.y = 0.0062;
      face.rotation.z = Math.PI / 2;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0395, 0.0395, 0.022, 16, 1, true), mats.watchCase);
      band.rotation.x = Math.PI / 2; band.scale.set(1.04, 0.9, 1); band.position.y = -0.034;
      watch.add(caseM, face, band);
      // Innenseite des Handgelenks (Handflächenseite), am Bündchen
      watch.position.set(0, -0.034, 0.04);
      watch.rotation.z = Math.PI;
      this.handBone.add(watch);
      this.watch = watch;
    }
    this.shoulder = new THREE.Vector3(side * 0.2, -0.3, 0.14);
    this.pole = new THREE.Vector3(side * 0.7, -1, 0.15);
    this.curls = POSES.relaxed;
    this._pose = clonePose(POSES.relaxed);
  }

  // Finger in eine (gemischte) Pose bringen
  applyPose(pose) {
    const side = this.side;
    for (let i = 0; i < 4; i++) {
      const c = pose.f[i], ch = this.fingers[i];
      ch[0].rotation.set(-c[0], c[3] * side + FINGERS[i].splay * side * 0.5, 0);
      ch[1].rotation.set(-c[1], 0, 0);
      ch[2].rotation.set(-c[2], 0, 0);
    }
    // Daumen: Opposition (vor die Handfläche) um die Handlängsachse, Adduktion zur Zeigefingerseite,
    // danach Beugung der drei Glieder um die eigene Querachse
    const t = pose.t;
    _e.set(0, -t[1] * side, t[0] * side, 'ZYX');
    this.thumb[0].quaternion.setFromEuler(_e).multiply(this.thumbRest);
    this.thumb[0].rotateX(-t[2]);
    this.thumb[1].rotation.set(-t[3], 0, 0);
    this.thumb[2].rotation.set(-t[4], 0, 0);
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
    const E = new THREE.Vector3().copy(S).addScaledVector(dir, a).addScaledVector(pole, h);
    // Unterarm: von Ellbogen zum Handgelenk, Verdrehung folgt dem Handrücken
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(wristQuat);
    orient(this.fore, E, W, up, 0.02);
    orient(this.upper, S, E, new THREE.Vector3(0, 1, 0), 0.0);
    this.elbow.position.copy(E);
    this.elbowPos = E;
  }
}

function orient(mesh, from, to, up, extend) {
  const z = new THREE.Vector3().subVectors(from, to).normalize();     // lokal +Z zeigt zurück zum Ursprung
  const y = up.clone().addScaledVector(z, -up.dot(z));
  if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(z, -z.y);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  mesh.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
  mesh.position.copy(from).addScaledVector(z, extend);
}

function clonePose(p) { return { f: p.f.map(a => a.slice()), t: p.t.slice() }; }

/** Mischt zwei Posen (a → b mit Gewicht w) in out. */
export function mixPose(a, b, w, out) {
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) out.f[i][k] = a.f[i][k] + (b.f[i][k] - a.f[i][k]) * w;
  for (let k = 0; k < 5; k++) out.t[k] = a.t[k] + (b.t[k] - a.t[k]) * w;
  return out;
}

export function newPose(name = 'relaxed') { return clonePose(POSES[name] || POSES.relaxed); }

export class Arms {
  constructor() {
    const watchTex = watchFaceTexture();
    this.mats = {
      glove: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0, normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.22, 0.22) }),
      sleeve: new THREE.MeshStandardMaterial({ map: camoMap('arid'), roughness: 0.92, metalness: 0.0, normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.3, 0.3) }),
      tape: new THREE.MeshStandardMaterial({ map: tapeMap(), roughness: 0.6, metalness: 0.0 }),
      watchCase: new THREE.MeshStandardMaterial({ color: 0x1b1c1d, roughness: 0.55, metalness: 0.2 }),
      watchFace: new THREE.MeshStandardMaterial({ map: watchTex, emissive: 0xffffff, emissiveMap: watchTex, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.0 }),
    };
    this.group = new THREE.Group();
    this.group.name = 'arme';
    this.right = new Arm(1, this.mats);
    this.left = new Arm(-1, this.mats);
    this.group.add(this.right.group, this.left.group);
    this._watchTimer = 0;
  }

  update(dt) {
    // Uhr minütlich neu zeichnen
    if ((this._watchTimer += dt) > 20) {
      this._watchTimer = 0;
      const tex = this.mats.watchFace.map;
      tex.userData.redraw?.();
    }
  }

  dispose() {
    this.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of Object.values(this.mats)) m.dispose();
    this.right.mesh.skeleton.dispose();
    this.left.mesh.skeleton.dispose();
  }
}
