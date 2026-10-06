// hands-v3: erzeugt das Handschuhnetz (ein geglättetes, gehäutetes Netz je Hand) für assets/js/game/weapons/gunsmith/arms.js.
//   node tools/assets/hands/build-hand.mjs [--res=0.0008] [--high=3500] [--low=1500] [--obj]
// Ablauf: vorzeichenbehaftetes Distanzfeld aus anatomischen Grundkörpern in der Bindehaltung (handdims.js) – Mittelhand
// aus vier Mittelhandknochen + Platte, Daumen- und Kleinfingerballen, Ballen unter den Grundgelenken, Mulde in der
// Handfläche, Knöchelköpfe, gepolsterter Knöchelschutz (4 Segmente), Rückenpolster, je Finger 3 sich verjüngende Glieder
// (leicht ovaler Querschnitt, Gelenkhöcker oben, Beugefalten unten, Polster auf Grund-/Mittelglied, runde Kuppe mit
// Polster), Daumen (Mittelhand/Grund/End), Handgelenk + Neopren-Bündchen mit Klettlasche – glatt vereinigt (smooth-min);
// Oberfläche über Surface Nets (Grob-/Feingitter), Ecken auf die Fläche projiziert, mit meshoptimizer vereinfacht
// (Normalen + Hautgewichte als Attribute → Kanten bleiben an den Gelenken dicht), erneut projiziert; Normalen aus dem
// Feldgradienten; Hautgewichte je Gelenk über Gelenkebenen (Produktform, glatt, ≤ 4 Knochen; Bündchen am Unterarm-
// Knochen 16); Masken (Leder-Innenhand, Polster, Bündchen, Abrieb) + Umgebungsverdeckung (Feld-AO) je Ecke.
// Ausgabe: assets/js/game/weapons/gunsmith/glove-mesh.js (quantisiert, base64; rechte Hand, die linke spiegelt arms.js).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from '../../../assets/vendor/three/three.module.min.js';
import { MeshoptSimplifier } from '../node_modules/meshoptimizer/index.js';
import { FINGERS, THUMB, THUMB_REST, BIND_SPLAY, BIND_CURL, BIND_THUMB_FLEX, handDimsKey } from '../../../assets/js/game/weapons/gunsmith/handdims.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const RES = Number(opt.res || 0.0008);
const TARGET = { high: Number(opt.high || 3500), low: Number(opt.low || 1500) };
const t0 = Date.now();

// ------------------------------------------------------------------ Knochen in Bindehaltung (wie Arm/applyPose, rechte Hand)
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const bones = [];   // { M: Matrix4 Welt, inv: Matrix3 (Welt→lokal Rotation), o: Ursprung, len, parent }
function addBone(parent, pos, quat, len) {
  const L = new THREE.Matrix4().compose(pos, quat, V(1, 1, 1));
  const M = parent >= 0 ? bones[parent].M.clone().multiply(L) : L;
  const o = V().setFromMatrixPosition(M);
  const q = new THREE.Quaternion().setFromRotationMatrix(M);
  const qi = q.clone().invert();
  const dir = V(0, 0, -1).applyQuaternion(q);
  bones.push({ M, o, q, qi, dir, len, parent, end: o.clone().addScaledVector(dir, len) });
  return bones.length - 1;
}
const eul = (x, y) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, 0));
addBone(-1, V(), new THREE.Quaternion(), 0);                                         // 0 Hand
for (let i = 0; i < 4; i++) {
  const f = FINGERS[i], c = BIND_CURL[i];
  const b0 = addBone(0, V(f.x, f.y, f.z), eul(-c[0], BIND_SPLAY[i]), f.len[0]);
  const b1 = addBone(b0, V(0, 0, -f.len[0]), eul(-c[1], 0), f.len[1]);
  addBone(b1, V(0, 0, -f.len[1]), eul(-c[2], 0), f.len[2]);
}
function basisQuat(F, B) {
  const z = V(-F[0], -F[1], -F[2]).normalize();
  const y = V(...B); y.addScaledVector(z, -y.dot(z)).normalize();
  const x = V().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const TQ = basisQuat(THUMB_REST.F, THUMB_REST.B);
const t0b = addBone(0, V(...THUMB.base), TQ, THUMB.len[0]);
const t1b = addBone(t0b, V(0, 0, -THUMB.len[0]), eul(-BIND_THUMB_FLEX[0], 0), THUMB.len[1]);
addBone(t1b, V(0, 0, -THUMB.len[1]), eul(-BIND_THUMB_FLEX[1], 0), THUMB.len[2]);
addBone(-1, V(), new THREE.Quaternion(), 0);                                         // 16 Unterarm (Bündchen)
const FB = (i, s) => 1 + i * 3 + s, TB = (s) => 13 + s, FORE = 16;

// ------------------------------------------------------------------ Distanzfeld-Bausteine (Skalar, ohne Allokation)
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }
// Punkt in Knochenraum (Rotation + Ursprung)
const _l = [0, 0, 0];
function toLocal(b, x, y, z) {
  const B = bones[b], q = B.qi; let px = x - B.o.x, py = y - B.o.y, pz = z - B.o.z;
  // Quaternion-Rotation (q * p * q^-1)
  const ix = q.w * px + q.y * pz - q.z * py, iy = q.w * py + q.z * px - q.x * pz, iz = q.w * pz + q.x * py - q.y * px, iw = -q.x * px - q.y * py - q.z * pz;
  _l[0] = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  _l[1] = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  _l[2] = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return _l;
}
// abgerundeter Kegel entlang −Z (0 … −h), Querschnitt in y um flat gestaucht
function roundCone(lx, ly, lz, r1, r2, h, flat = 1) {
  const qx = Math.hypot(lx, ly / flat), qy = -lz;
  const b = (r1 - r2) / h, a = Math.sqrt(1 - b * b);
  const k = -b * qx + a * qy;
  if (k < 0) return Math.hypot(qx, qy) - r1;
  if (k > a * h) return Math.hypot(qx, qy - h) - r2;
  return qx * a + qy * b - r1;
}
function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az;
  const h = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
  return Math.hypot(px - dx * h, py - dy * h, pz - dz * h) - r;
}
function ellipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function roundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
function rotY(x, z, a, out) { const c = Math.cos(a), s = Math.sin(a); out[0] = c * x + s * z; out[1] = -s * x + c * z; return out; }
const _r = [0, 0];

const GLOVE = 1.045;   // Handschuhzugabe auf die Fingerradien

// Gruppen: 0 Handfläche/-rücken, 1 Daumenballen, 2 Daumen, 3–6 Finger, 7 Handgelenk/Bündchen; Zusatzfelder Polster/Lasche
const G = new Float64Array(8);
const AUX = { pad: 1, tab: 1 };
function fingerD(i, x, y, z) {
  const f = FINGERS[i];
  let d = 1;
  let pad = 1;
  for (let s = 0; s < 3; s++) {
    const b = FB(i, s), l = toLocal(b, x, y, z), lx = l[0], ly = l[1], lz = l[2];
    const r1 = f.r[s] * GLOVE, r2 = (s < 2 ? f.r[s + 1] : f.r[s] * 0.84) * GLOVE, h = f.len[s] + (s === 2 ? 0.0015 : 0);
    let ds = roundCone(lx, ly, lz, r1, r2, h, 0.9);
    if (s === 0) ds = roundCone(lx, ly, lz + 0.004, r1 * 1.04, r2, h + 0.004, 0.9);   // Grundglied reicht in den Handteller
    // Gelenkhöcker (Rückseite) am proximalen Gelenk von Mittel-/Endglied
    if (s > 0) ds = smin(ds, Math.hypot(lx, ly - r1 * 0.32, lz + 0.0005) - r1 * 0.8, 0.004);
    // Beugefalte (Innenseite) am proximalen Gelenk + Mitte des Grundglieds (Handschuhfalte)
    if (s > 0) ds = smax(ds, -(Math.hypot(ly + r1 * 1.0, lz - 0.0006) - 0.0011), 0.0014);
    // Kuppenpolster (Innenseite, abgeflacht)
    if (s === 2) ds = smin(ds, ellipsoid(lx, ly + r2 * 0.35, lz + h * 0.62, r1 * 0.86, r1 * 0.62, h * 0.42), 0.003);
    // TPR-Polster auf Grund- und Mittelglied
    if (s < 2) {
      const pl = roundBox(lx, ly - r1 * 0.86, lz + h * 0.52, r1 * 0.6, 0.0014, h * (s ? 0.27 : 0.3), 0.0011);
      pad = Math.min(pad, pl);
      ds = smin(ds, pl, 0.0016);
    }
    d = s === 0 ? ds : smin(d, ds, 0.0025);
  }
  AUX.fpad = pad;
  return d;
}
function thumbD(x, y, z) {
  let d = 1;
  for (let s = 0; s < 3; s++) {
    const l = toLocal(TB(s), x, y, z), lx = l[0], ly = l[1], lz = l[2];
    const r1 = THUMB.r[s] * GLOVE * (s === 0 ? 0.92 : 1), r2 = (s < 2 ? THUMB.r[s + 1] : THUMB.r[2] * 0.82) * GLOVE, h = THUMB.len[s] + (s === 2 ? 0.0015 : 0);
    let ds = roundCone(lx, ly, lz, r1, r2, h, s === 0 ? 0.85 : 0.88);
    if (s > 0) ds = smin(ds, Math.hypot(lx, ly - r1 * 0.3, lz + 0.0005) - r1 * 0.8, 0.004);
    if (s > 0) ds = smax(ds, -(Math.hypot(ly + r1 * 0.95, lz - 0.0006) - 0.0011), 0.0014);
    if (s === 2) ds = smin(ds, ellipsoid(lx, ly + r2 * 0.35, lz + h * 0.6, r1 * 0.86, r1 * 0.62, h * 0.42), 0.003);
    d = s === 0 ? ds : smin(d, ds, 0.003);
  }
  return d;
}
function palmD(x, y, z) {
  // Mittelhandknochen (Handwurzel → Grundgelenk)
  let d = 1;
  for (let i = 0; i < 4; i++) {
    const f = FINGERS[i], ax = -0.0165 + i * 0.011;
    d = smin(d, capsule(x, y, z, ax, -0.001, -0.016, f.x, f.y + 0.0015, f.z + 0.008, (i === 3 ? 0.0088 : 0.0098)), 0.012);
  }
  // Platte (füllt zwischen den Knochen), zum Handgelenk schmaler; Handrücken quer gewölbt
  const t = clamp(-z / 0.08, 0, 1), sx = 0.8 + 0.2 * t;
  const dome = 0.0035 * Math.cos(clamp(x / 0.04, -1, 1) * Math.PI / 2);
  d = smin(d, roundBox(x / sx, y - dome * 0.5 + 0.0012, z + 0.044, 0.03, 0.0105, 0.031, 0.008) * sx, 0.008);
  // Handwurzel
  d = smin(d, roundBox(x, y + 0.0005, z + 0.007, 0.0235, 0.0135, 0.012, 0.011), 0.01);
  // Kleinfingerballen
  rotY(x - 0.0255, z + 0.036, 0.08, _r);
  d = smin(d, ellipsoid(_r[0], y + 0.0095, _r[1], 0.0105, 0.0098, 0.027), 0.008);
  // Ballen unter den Grundgelenken
  d = smin(d, capsule(x, y, z, -0.025, -0.0085, -0.0715, 0.024, -0.0085, -0.0655, 0.0078), 0.008);
  // Mulde in der Handfläche
  d = smax(d, -ellipsoid(x - 0.003, y + 0.0262, z + 0.047, 0.017, 0.0085, 0.021), 0.007);
  // Knöchelköpfe
  for (const f of FINGERS) d = smin(d, Math.hypot(x - f.x, y - f.y - 0.0048, z - f.z - 0.0045) - 0.0083, 0.005);
  return d;
}
function knucklePadD(x, y, z) {
  // Knöchelschutz: entlang der Knöchellinie gebogene, 4-teilige Polsterleiste; Rückenpolster
  const zl = -0.0745 + 0.0055 * smooth(0.005, 0.03, x) - 0.0016 * Math.cos(x / 0.03);
  const yb = 0.0158 - 4.2 * x * x;
  let d = roundBox(x + 0.0012, y - yb, z - zl, 0.0345, 0.0021, 0.0085, 0.0017);
  for (let i = 0; i < 3; i++) {
    const gx = (FINGERS[i].x + FINGERS[i + 1].x) * 0.5;
    d = smax(d, -(Math.abs(x - gx) - 0.0006), 0.0008);
  }
  const back = roundBox(x - 0.003, y - (0.0146 - 3.6 * x * x), z + 0.041, 0.0165, 0.0013, 0.0145, 0.0012);
  return Math.min(d, back);
}
function wristD(x, y, z) {
  // Handgelenk + Bündchen bis +6 cm (steckt im Ärmel), leicht oval, Neopren-Wulst am Rand
  const t = clamp(z / 0.05, 0, 1);
  const ax = 0.0262 + 0.0035 * t, ay = 0.0178 + 0.0042 * t;
  const zc = clamp(z, -0.006, 0.058);
  let d = ellipsoid(x, y + 0.0008, z - zc, ax, ay, 0.012);
  d = Math.max(d, z - 0.062);
  // Wulst
  d = smin(d, ellipsoid(x, y + 0.0008, z - 0.04, ax + 0.0013, ay + 0.0013, 0.008), 0.004);
  return d;
}
function tabD(x, y, z) {
  // Klettlasche auf dem Handgelenk (ulnar), der Wölbung folgend
  const yb = 0.0195 + 0.0009 - 9 * (x - 0.004) * (x - 0.004);
  return roundBox(x - 0.004, y - yb, z - 0.019, 0.0165, 0.0013, 0.0082, 0.0011);
}
function thenarD(x, y, z) {
  rotY(x + 0.0215, z + 0.03, -0.38, _r);
  return ellipsoid(_r[0], y + 0.0115, _r[1], 0.0135, 0.0105, 0.023);
}

function field(x, y, z) {
  const p = palmD(x, y, z), kp = knucklePadD(x, y, z), th = thenarD(x, y, z), tm = thumbD(x, y, z), w = wristD(x, y, z), tb = tabD(x, y, z);
  G[0] = smin(p, kp, 0.0022); G[1] = th; G[2] = tm; G[7] = smin(w, tb, 0.0015);
  AUX.pad = kp; AUX.tab = tb;
  let fpad = 1;
  for (let i = 0; i < 4; i++) { G[3 + i] = fingerD(i, x, y, z); fpad = Math.min(fpad, AUX.fpad); }
  AUX.fpadAll = fpad;
  let d = smin(G[0], G[1], 0.01);
  d = smin(d, G[2], 0.009);
  let fd = G[3];
  for (let i = 1; i < 4; i++) fd = smin(fd, G[3 + i], 0.0025);
  d = smin(d, fd, 0.0055);
  d = smin(d, G[7], 0.013);
  return d;
}

// ------------------------------------------------------------------ Gitter (grob → fein) + Surface Nets
// Gitterrahmen aus den Knochen (Enden ± 2,2 cm) und dem Bündchen
const BX = [-0.06, 0.05], BY = [-0.04, 0.032], BZ = [-0.1, 0.07];
for (const b of bones) for (const p of [b.o, b.end]) {
  BX[0] = Math.min(BX[0], p.x - 0.022); BX[1] = Math.max(BX[1], p.x + 0.022);
  BY[0] = Math.min(BY[0], p.y - 0.022); BY[1] = Math.max(BY[1], p.y + 0.022);
  BZ[0] = Math.min(BZ[0], p.z - 0.022);
}
function sample(res) {
  const nx = Math.ceil((BX[1] - BX[0]) / res) + 1, ny = Math.ceil((BY[1] - BY[0]) / res) + 1, nz = Math.ceil((BZ[1] - BZ[0]) / res) + 1;
  return { nx, ny, nz, res, f: new Float32Array(nx * ny * nz) };
}
const C = sample(0.0032);
for (let k = 0; k < C.nz; k++) for (let j = 0; j < C.ny; j++) for (let i = 0; i < C.nx; i++)
  C.f[(k * C.ny + j) * C.nx + i] = field(BX[0] + i * C.res, BY[0] + j * C.res, BZ[0] + k * C.res);
const F = sample(RES);
let exact = 0;
for (let k = 0; k < F.nz; k++) {
  const z = BZ[0] + k * RES, cz = Math.min((z - BZ[0]) / C.res, C.nz - 1.001), kz = cz | 0, fz = cz - kz;
  for (let j = 0; j < F.ny; j++) {
    const y = BY[0] + j * RES, cy = Math.min((y - BY[0]) / C.res, C.ny - 1.001), ky = cy | 0, fy = cy - ky;
    for (let i = 0; i < F.nx; i++) {
      const x = BX[0] + i * RES, cx = Math.min((x - BX[0]) / C.res, C.nx - 1.001), kx = cx | 0, fx = cx - kx;
      const c = (a, b, e) => C.f[((kz + e) * C.ny + ky + b) * C.nx + kx + a];
      const v = (1 - fz) * ((1 - fy) * ((1 - fx) * c(0, 0, 0) + fx * c(1, 0, 0)) + fy * ((1 - fx) * c(0, 1, 0) + fx * c(1, 1, 0)))
        + fz * ((1 - fy) * ((1 - fx) * c(0, 0, 1) + fx * c(1, 0, 1)) + fy * ((1 - fx) * c(0, 1, 1) + fx * c(1, 1, 1)));
      const idx = (k * F.ny + j) * F.nx + i;
      if (Math.abs(v) > 0.0055) F.f[idx] = v; else { F.f[idx] = field(x, y, z); exact++; }
    }
  }
}
console.log(`grid ${F.nx}×${F.ny}×${F.nz} (exact ${exact}) ${Date.now() - t0} ms`);

const { nx, ny, nz } = F, NI = (i, j, k) => (k * ny + j) * nx + i;
const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
const CI = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
const P = [];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const corner = new Float64Array(8);
for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
  let mask = 0;
  for (let c = 0; c < 8; c++) { const v = F.f[NI(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; corner[c] = v; if (v < 0) mask |= 1 << c; }
  if (mask === 0 || mask === 255) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const va = corner[a], vb = corner[b];
    if ((va < 0) === (vb < 0)) continue;
    const t = va / (va - vb);
    sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
  }
  cellV[CI(i, j, k)] = P.length / 3;
  P.push(BX[0] + (i + sx / n) * RES, BY[0] + (j + sy / n) * RES, BZ[0] + (k + sz / n) * RES);
}
const T = [];
function quad(a, b, c, d) { if (a < 0 || b < 0 || c < 0 || d < 0) return; T.push(a, b, c, a, c, d); }
for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const v0 = F.f[NI(i, j, k)] < 0;
  if (i < nx - 1 && v0 !== (F.f[NI(i + 1, j, k)] < 0)) quad(cellV[CI(i, j - 1, k - 1)], cellV[CI(i, j, k - 1)], cellV[CI(i, j, k)], cellV[CI(i, j - 1, k)]);
  if (j < ny - 1 && v0 !== (F.f[NI(i, j + 1, k)] < 0)) quad(cellV[CI(i - 1, j, k - 1)], cellV[CI(i, j, k - 1)], cellV[CI(i, j, k)], cellV[CI(i - 1, j, k)]);
  if (k < nz - 1 && v0 !== (F.f[NI(i, j, k + 1)] < 0)) quad(cellV[CI(i - 1, j - 1, k)], cellV[CI(i, j - 1, k)], cellV[CI(i, j, k)], cellV[CI(i - 1, j, k)]);
}
console.log(`surface nets: ${P.length / 3} verts, ${T.length / 3} tris ${Date.now() - t0} ms`);

// Gradient + Projektion auf die Fläche
const _g = [0, 0, 0];
function grad(x, y, z, h = 0.00015) {
  _g[0] = field(x + h, y, z) - field(x - h, y, z); _g[1] = field(x, y + h, z) - field(x, y - h, z); _g[2] = field(x, y, z + h) - field(x, y, z - h);
  const l = Math.hypot(_g[0], _g[1], _g[2]) || 1; _g[0] /= l; _g[1] /= l; _g[2] /= l;
  return _g;
}
function project(pos) {
  for (let v = 0; v < pos.length; v += 3) for (let it = 0; it < 3; it++) {
    const d = field(pos[v], pos[v + 1], pos[v + 2]);
    if (Math.abs(d) < 2e-6) break;
    const g = grad(pos[v], pos[v + 1], pos[v + 2]);
    const s = clamp(d, -RES, RES);
    pos[v] -= g[0] * s; pos[v + 1] -= g[1] * s; pos[v + 2] -= g[2] * s;
  }
}
// Umlauf: Dreiecksnormale zeigt nach außen (Feldgradient)
function orientTris(pos, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
    const g = grad((pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3);
    if (nx_ * g[0] + ny_ * g[1] + nz_ * g[2] < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
}
const pos0 = new Float32Array(P);
project(pos0);
const idx0 = new Uint32Array(T);
orientTris(pos0, idx0);

// ------------------------------------------------------------------ Hautgewichte
// Gelenkebene: Lot = Winkelhalbierende von Eltern- und Kindrichtung, Übergangsbreite w (± um die Ebene)
function jointBeta(child, x, y, z, w) {
  const B = bones[child], par = bones[B.parent];
  let nx_ = B.dir.x, ny_ = B.dir.y, nz_ = B.dir.z;
  if (par.len > 0) { nx_ += par.dir.x; ny_ += par.dir.y; nz_ += par.dir.z; const l = Math.hypot(nx_, ny_, nz_); nx_ /= l; ny_ /= l; nz_ /= l; }
  const s = (x - B.o.x) * nx_ + (y - B.o.y) * ny_ + (z - B.o.z) * nz_;
  return smooth(-w, w, s);
}
function chainWeights(chain, x, y, z, ws, out) {
  // chain: Knochenindizes [b0, b1, b2]; Eltern von b0 = Hand
  const b0 = jointBeta(chain[0], x, y, z, ws[0]), b1 = jointBeta(chain[1], x, y, z, ws[1]), b2 = jointBeta(chain[2], x, y, z, ws[2]);
  out[0] += 1 - b0; out[chain[0]] += b0 * (1 - b1); out[chain[1]] += b0 * b1 * (1 - b2); out[chain[2]] += b0 * b1 * b2;
}
const FW = FINGERS.map((f) => [0.0085, f.r[0] * 0.62, f.r[1] * 0.62]);
const TW = [0.013, 0.0075, 0.0068];
const tmpW = new Float64Array(17);
function weightsAt(x, y, z, out) {
  out.fill(0);
  field(x, y, z);
  // Gruppen weich nach Nähe mischen (τ = 1,6 mm); Handfläche über die seitlich nächsten Fingerketten (Grundgelenk-Übergang)
  const tau = 0.0016;
  let gmin = Infinity;
  for (let g = 0; g < 8; g++) gmin = Math.min(gmin, G[g]);
  const gw = new Float64Array(8);
  let sum = 0;
  for (let g = 0; g < 8; g++) { gw[g] = Math.exp(-(G[g] - gmin) / tau); sum += gw[g]; }
  for (let g = 0; g < 8; g++) gw[g] /= sum;
  // Handfläche: nächste Finger nach seitlichem Abstand zur Grundgliedachse
  if (gw[0] > 1e-4) {
    tmpW.fill(0);
    let ls = 0; const lw = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const B = bones[FB(i, 0)], px = x - B.o.x, py = y - B.o.y, pz = z - B.o.z, s = px * B.dir.x + py * B.dir.y + pz * B.dir.z;
      const lat = Math.hypot(px - B.dir.x * s, py - B.dir.y * s, pz - B.dir.z * s);
      lw[i] = Math.exp(-lat / 0.0035); ls += lw[i];
    }
    for (let i = 0; i < 4; i++) if (lw[i] / ls > 1e-3) {
      const tw = new Float64Array(17);
      chainWeights([FB(i, 0), FB(i, 1), FB(i, 2)], x, y, z, FW[i], tw);
      for (let b = 0; b < 17; b++) tmpW[b] += tw[b] * lw[i] / ls;
    }
    // Ränder der Handfläche (seitlich weit weg von den Fingern) gehören der Hand
    for (let b = 0; b < 17; b++) out[b] += tmpW[b] * gw[0];
  }
  if (gw[1] > 1e-4) { tmpW.fill(0); chainWeights([TB(0), TB(1), TB(2)], x, y, z, TW, tmpW); for (let b = 0; b < 17; b++) out[b] += gw[1] * (b === 0 ? 0.45 + 0.55 * tmpW[b] : 0.55 * tmpW[b]); }
  if (gw[2] > 1e-4) { tmpW.fill(0); chainWeights([TB(0), TB(1), TB(2)], x, y, z, TW, tmpW); for (let b = 0; b < 17; b++) out[b] += gw[2] * tmpW[b]; }
  for (let i = 0; i < 4; i++) if (gw[3 + i] > 1e-4) { tmpW.fill(0); chainWeights([FB(i, 0), FB(i, 1), FB(i, 2)], x, y, z, FW[i], tmpW); for (let b = 0; b < 17; b++) out[b] += gw[3 + i] * tmpW[b]; }
  out[0] += gw[7];
  // Handgelenk: Anteil der Hand geht hinter dem Gelenk auf den Unterarm über (Bündchen bleibt im Ärmel)
  const bw = smooth(-0.004, 0.02, z);
  out[FORE] += out[0] * bw; out[0] *= 1 - bw;
  return out;
}

// ------------------------------------------------------------------ Masken + AO
function masksAt(x, y, z, n, out) {
  field(x, y, z);
  const d = Math.min(...G);
  // Leder: Innenseite (gruppenlokal), Fingerkuppen umschlossen; Bündchen ausgenommen
  let leather = 0, wsum = 0;
  const tau = 0.0016;
  for (let g = 0; g < 8; g++) {
    const w = Math.exp(-(G[g] - d) / tau); if (w < 1e-3) continue;
    let L = 0;
    if (g >= 2 && g <= 6) {
      // Fingerkette: nächstes Glied
      let best = Infinity, bb = 0;
      const chain = g === 2 ? [TB(0), TB(1), TB(2)] : [FB(g - 3, 0), FB(g - 3, 1), FB(g - 3, 2)];
      for (const b of chain) { const l = toLocal(b, x, y, z); const h = bones[b].len; const t = clamp(-l[2], 0, h); const dd = Math.hypot(l[0], l[1], -l[2] - t); if (dd < best) { best = dd; bb = b; } }
      const B = bones[bb], q = B.qi;
      const nl = V(n[0], n[1], n[2]).applyQuaternion(q);
      L = smooth(-0.32, 0.12, -nl.y - 0.05);
      const l = toLocal(bb, x, y, z);
      if (bb === chain[2]) L = Math.max(L, smooth(B.len - 0.0095, B.len - 0.004, -l[2]));
      if (g === 2 && bb === chain[0]) L = Math.max(L, smooth(-0.1, 0.25, -nl.y + 0.15));
    } else if (g === 0 || g === 1) {
      L = smooth(0.12, -0.12, n[1]);
      if (g === 1) L = Math.max(L, smooth(0.35, 0.05, n[1]));
    }
    leather += L * w; wsum += w;
  }
  leather /= wsum;
  const cuff = smooth(-0.003, 0.016, z);
  leather *= 1 - cuff;
  const padF = Math.min(AUX.pad, AUX.fpadAll);
  // weiches Feld (Iso 0,5 ≈ 0,7 mm neben der Polsterkante) → die Naht im Shader verläuft glatt statt entlang der Dreiecke
  const padField = (e) => clamp(0.5 - (e - d - 0.0007) / 0.0032, 0, 1);
  const pad = Math.max(padField(padF) * (1 - smooth(0.004, 0.009, z)), padField(AUX.tab));
  // Abrieb: Kuppen Daumen/Zeige-/Mittelfinger, Handballenkante, Knöchelschutz-Kanten
  let wear = 0;
  for (const [b, k] of [[FB(0, 2), 1], [FB(1, 2), 0.9], [FB(2, 2), 0.6], [FB(3, 2), 0.5], [TB(2), 1]]) {
    const l = toLocal(b, x, y, z); wear = Math.max(wear, k * smooth(bones[b].len - 0.012, bones[b].len - 0.001, -l[2]) * smooth(0.0125, 0.005, Math.hypot(l[0], l[1])));
  }
  wear = Math.max(wear, 0.55 * smooth(-0.004, -0.018, y) * smooth(-0.03, -0.012, z) * smooth(0.0, 0.03, x));
  wear = Math.max(wear, 0.35 * pad * smooth(0.0, 0.004, Math.abs(y - 0.016)));
  out[0] = leather; out[1] = pad; out[2] = cuff; out[3] = wear;
  // Feld-AO (5 Proben entlang der Normale)
  let occ = 0;
  for (let i = 1; i <= 5; i++) {
    const dl = i * 0.0028;
    occ += (dl - field(x + n[0] * dl, y + n[1] * dl, z + n[2] * dl)) / Math.pow(2, i - 1);
  }
  out[4] = clamp(1 - occ * 95, 0.25, 1);
  return out;
}

// ------------------------------------------------------------------ Vereinfachen + Attribute
await MeshoptSimplifier.ready;
const W17 = new Float64Array(17);
function build(target) {
  const nv = pos0.length / 3;
  const pos = new Float32Array(pos0), idx = new Uint32Array(idx0);
  // Attribute für den Vereinfacher: Normale (3) + größtes Hautgewicht + Daumen-/Fingergrund-Anteil (Gelenkringe bleiben)
  const AS = 6, attr = new Float32Array(nv * AS);
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], g = grad(x, y, z);
    weightsAt(x, y, z, W17);
    let mx = 0; for (let b = 0; b < 17; b++) mx = Math.max(mx, W17[b]);
    attr.set([g[0], g[1], g[2], mx, W17[0] + W17[FORE], W17[13]], v * AS);
  }
  const [cnt, err] = MeshoptSimplifier.simplifyWithUpdate(idx, pos, 3, attr, AS, [0.35, 0.35, 0.35, 1.2, 0.8, 0.6], null, target * 3, 0.05, ['Regularize']);
  let ind = idx.slice(0, cnt);
  // kompaktieren
  const remap = new Int32Array(nv).fill(-1); const keep = [];
  for (let i = 0; i < ind.length; i++) { const v = ind[i]; if (remap[v] < 0) { remap[v] = keep.length; keep.push(v); } ind[i] = remap[v]; }
  const n = keep.length, P2 = new Float32Array(n * 3);
  keep.forEach((v, i) => P2.set(pos.subarray(v * 3, v * 3 + 3), i * 3));
  project(P2);
  orientTris(P2, ind);
  // Attribute je Ecke
  const N2 = new Float32Array(n * 3), SKI = new Uint8Array(n * 4), SKW = new Uint8Array(n * 4), MSK = new Uint8Array(n * 4), AO = new Uint8Array(n);
  const m = new Float64Array(5);
  for (let v = 0; v < n; v++) {
    const x = P2[v * 3], y = P2[v * 3 + 1], z = P2[v * 3 + 2], g = grad(x, y, z);
    N2.set(g, v * 3);
    weightsAt(x, y, z, W17);
    const order = [...W17.keys()].sort((a, b) => W17[b] - W17[a]).slice(0, 4).filter((b) => W17[b] > 0.004);
    const s = order.reduce((a, b) => a + W17[b], 0);
    let acc = 0;
    order.forEach((b, k) => { SKI[v * 4 + k] = b; const q = k === order.length - 1 ? 255 - acc : Math.round(W17[b] / s * 255); SKW[v * 4 + k] = q; acc += q; });
    masksAt(x, y, z, g, m);
    for (let k = 0; k < 4; k++) MSK[v * 4 + k] = Math.round(clamp(m[k], 0, 1) * 255);
    AO[v] = Math.round(m[4] * 255);
  }
  return { n, tris: ind.length / 3, err, pos: P2, nrm: N2, idx: ind, ski: SKI, skw: SKW, msk: MSK, ao: AO };
}
const out = {};
for (const lod of ['high', 'low']) {
  const r = build(TARGET[lod]);
  out[lod] = r;
  console.log(`${lod}: ${r.n} verts, ${r.tris} tris, err ${r.err.toFixed(4)} ${Date.now() - t0} ms`);
}

// ------------------------------------------------------------------ Kodieren
const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');
function encode(r) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < r.n; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], r.pos[v * 3 + k]); hi[k] = Math.max(hi[k], r.pos[v * 3 + k]); }
  const sc = hi.map((h, k) => (h - lo[k]) / 65535 || 1);
  const q = new Uint16Array(r.n * 3), nq = new Int8Array(r.n * 3);
  for (let v = 0; v < r.n; v++) for (let k = 0; k < 3; k++) {
    q[v * 3 + k] = Math.round((r.pos[v * 3 + k] - lo[k]) / sc[k]);
    nq[v * 3 + k] = Math.round(clamp(r.nrm[v * 3 + k], -1, 1) * 127);
  }
  return { n: r.n, tris: r.tris, lo: lo.map((x) => +x.toFixed(7)), sc: sc.map((x) => +x.toPrecision(7)), pos: b64(q), nrm: b64(nq), idx: b64(new Uint16Array(r.idx)), ski: b64(r.ski), skw: b64(r.skw), msk: b64(r.msk), ao: b64(r.ao) };
}
const enc = { key: handDimsKey(), bones: 17, high: encode(out.high), low: encode(out.low) };
const js = `// ERZEUGT von tools/assets/hands/build-hand.mjs (hands-v3) – nicht von Hand ändern.
// Handschuhnetz (rechte Hand, Bindehaltung aus handdims.js), quantisiert: pos Uint16 (lo + q·sc), nrm Int8, idx Uint16,
// Hautindizes/-gewichte Uint8×4 (Knochen 0 Hand, 1–12 Finger, 13–15 Daumen, 16 Unterarm), msk Uint8×4
// (Leder, Polster, Bündchen, Abrieb), ao Uint8.
export const GLOVE_MESH = ${JSON.stringify(enc)};
`;
writeFileSync(resolve(ROOT, 'assets/js/game/weapons/gunsmith/glove-mesh.js'), js);
console.log(`glove-mesh.js ${(js.length / 1024).toFixed(1)} KB, ${Date.now() - t0} ms`);

if (opt.obj) {
  for (const lod of ['high', 'low']) {
    const r = out[lod]; let s = '';
    for (let v = 0; v < r.n; v++) s += `v ${r.pos[v * 3]} ${r.pos[v * 3 + 1]} ${r.pos[v * 3 + 2]}\n`;
    for (let t = 0; t < r.idx.length; t += 3) s += `f ${r.idx[t] + 1} ${r.idx[t + 1] + 1} ${r.idx[t + 2] + 1}\n`;
    writeFileSync(resolve(ROOT, `tools/out/hands4/glove-${lod}.obj`), s);
  }
}
