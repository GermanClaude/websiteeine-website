// NULLPUNKT — Prozedurale Fahrzeugmodelle (GROSSKAMPF_PLAN §6.7): KP-1 Mammut (Kampfpanzer), GW-4 Steppe (Geländewagen).
//
// Baukasten aus Grundkörpern, je Material zu einem Mesh verschmolzen (wenige Draw Calls), drei LOD-Stufen
// (THREE.LOD; Abstände je Qualitätsstufe). UVs weltmaßstäblich (1 m) über boxUV → passen zu den Fotoscan-Sätzen.
// Ketten: geschlossene Bandschleife um Triebrad/Leitrad mit Lauf-UV (Texturversatz = Kettenlauf).
// Vorlagen werden je Typ/Team/Stufe einmal gebaut und geklont (Geometrien/Materialien geteilt).
//
// createVehicleModel(type, { team, quality }) → {
//   root, turret, gun, cmg, mg, wheels:[{pivot, spin, steer, side, local}], trackMats:[L, R], trackLoop (m),
//   lenses:[Mesh], cones:[Mesh], setLights(on), setWreck(on), dispose()
// }
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxUV } from '../engine/textures.js';
import { VEHICLES, mountY } from './data.js';
import { vehicleMaterials, trackMaterial } from './materials.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const PI = Math.PI, HP = PI / 2;
const LOD_DIST = { low: [0, 18, 50], medium: [0, 28, 75], high: [0, 40, 110], ultra: [0, 55, 140] };

/** Sammelt Geometrien je Material und verschmilzt sie. */
class Bucket {
  constructor() { this.map = new Map(); this.tag = new Map(); }
  add(geom, mat, pos = null, rot = null, scl = null, { keepUV = false, tag = null } = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    geom.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUV && k === 'uv')) g.deleteAttribute(k);
    g.clearGroups();
    _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _q, _s.set(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1));
    g.applyMatrix4(_m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
    if (tag) this.tag.set(mat, tag);
    return this;
  }
  build(parent, { shadow = true } = {}) {
    for (const [mat, list] of this.map) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      if (!merged.attributes.uv) boxUV(merged, 1);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      const tag = this.tag.get(mat);
      if (tag) Object.assign(mesh.userData, tag);
      parent.add(mesh);
    }
    this.map.clear();
    this.tag.clear();
    return parent;
  }
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, seg, open = false) => new THREE.CylinderGeometry(r1, r2, h, Math.max(3, seg | 0), 1, open);

/** Seitenprofil (u = vorwärts, y) als Extrusion entlang X (Breite w, mittig). */
function sideExtrude(pts, w, bevel = false) {
  const sh = new THREE.Shape(pts.map(([u, y]) => new THREE.Vector2(u, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: bevel, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -w / 2);
  g.rotateY(HP); // Profil-u → −Z (vorn), Extrusion → X
  return g;
}

/** Grundriss (x, v = vorwärts) als Extrusion entlang Y (Höhe h, ab y = 0). */
function topExtrude(pts, h, bevel = false) {
  const sh = new THREE.Shape(pts.map(([x, v]) => new THREE.Vector2(x, v)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: bevel, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1, curveSegments: 4 });
  g.rotateX(-HP); // Profil-v → −Z (vorn), Extrusion → +Y
  return g;
}

/**
 * Geschlossene Kettenschleife: Mittellinie pts [[z, y], …] (Seitenansicht), Bandbreite w (X), Stärke t.
 * UV: u = Lauflänge (nahtlos, ganzzahlige Wiederholungen), v = quer. Liefert { geometry, k, length }.
 */
function trackLoop(pts, w, t, repeatLen = 0.64) {
  const n = pts.length;
  let L = 0;
  const seg = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(l); L += l;
  }
  const k = Math.max(1, Math.round(L / repeatLen));
  let cz = 0, cy = 0;
  for (const p of pts) { cz += p[0]; cy += p[1]; }
  cz /= n; cy /= n;
  const pos = [], nor = [], uv = [];
  const quad = (P, N, U) => {
    // P: 4 Punkte [x,y,z]; Wicklung an Normale anpassen
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy2 = e1[2] * e2[0] - e1[0] * e2[2], cz2 = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = cx * N[0] + cy2 * N[1] + cz2 * N[2] < 0;
    const idx = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const j of idx) { pos.push(...P[j]); nor.push(...N); uv.push(...U[j]); }
  };
  let s = 0;
  const hw = w / 2, ht = t / 2;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const l = seg[i];
    const tz = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l;
    let nz = ty, ny = -tz;
    const mz = (a[0] + b[0]) / 2 - cz, my = (a[1] + b[1]) / 2 - cy;
    if (nz * mz + ny * my < 0) { nz = -nz; ny = -ny; }
    const u0 = (s / L) * k, u1 = ((s + l) / L) * k;
    s += l;
    const oA = [a[0] + nz * ht, a[1] + ny * ht], oB = [b[0] + nz * ht, b[1] + ny * ht];
    const iA = [a[0] - nz * ht, a[1] - ny * ht], iB = [b[0] - nz * ht, b[1] - ny * ht];
    // außen / innen
    quad([[-hw, oA[1], oA[0]], [hw, oA[1], oA[0]], [hw, oB[1], oB[0]], [-hw, oB[1], oB[0]]], [0, ny, nz], [[u0, 0], [u0, 1], [u1, 1], [u1, 0]]);
    quad([[-hw, iA[1], iA[0]], [hw, iA[1], iA[0]], [hw, iB[1], iB[0]], [-hw, iB[1], iB[0]]], [0, -ny, -nz], [[u0, 0.1], [u0, 0.9], [u1, 0.9], [u1, 0.1]]);
    // Flanken
    for (const sx of [-1, 1]) {
      const x = sx * hw;
      quad([[x, oA[1], oA[0]], [x, oB[1], oB[0]], [x, iB[1], iB[0]], [x, iA[1], iA[0]]], [sx, 0, 0], [[u0, 0], [u1, 0], [u1, 0.08], [u0, 0.08]]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { geometry: g, k, length: L };
}

function arc(cz, cy, r, a0, a1, steps, out) {
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    out.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
}

/** Mittellinie der Panzerkette (Seitenansicht, z vorn negativ). */
function mbtTrackPath(lod) {
  const steps = [6, 4, 2][lod];
  const t = 0.035;
  const pts = [];
  pts.push([-2.65, t]);
  pts.push([2.65, t]);
  arc(3.05, 0.55, 0.32 + t, -PI * 0.62, HP, steps + 2, pts); // Triebrad hinten
  arc(-3.12, 0.56, 0.3 + t, HP, PI * 1.38, steps + 2, pts);  // Leitrad vorn
  return pts;
}

function addRoadWheel(B, S, x, y, z, r, seg, lod) {
  B.add(cyl(r, r, 0.42, seg), S.rubber, [x, y, z], [0, 0, HP]);
  if (lod < 2) {
    B.add(cyl(r * 0.72, r * 0.72, 0.46, seg), S.dark, [x, y, z], [0, 0, HP]);
    B.add(cyl(r * 0.22, r * 0.22, 0.5, Math.max(6, seg / 2)), S.dark, [x, y, z], [0, 0, HP]);
  }
}

function buildMBT(lod, S, team) {
  const D = VEHICLES.mbt;
  const seg = [20, 12, 7][lod];
  const paint = S.paint[team] || S.paint.null;
  const mark = S.mark[team] || S.mark.null;
  const hull = new THREE.Group();
  const B = new Bucket();
  // Wanne unten (zwischen den Ketten) mit Bugkeil
  B.add(sideExtrude([[3.3, 0.5], [3.62, 0.96], [-3.58, 0.96], [-3.4, 0.5]], 2.3), paint);
  // Wanne oben inkl. Kettenabdeckungen (Glacis, Deck, Heck)
  B.add(sideExtrude([[3.64, 0.95], [2.42, 1.6], [-2.95, 1.63], [-3.55, 1.42], [-3.6, 0.95]], 3.52, lod === 0), paint);
  // Seitenschürzen
  for (const sx of [-1, 1]) {
    B.add(box(0.06, 0.5, 6.3), paint, [sx * 1.79, 0.72, 0.1]);
    if (lod === 0) for (let i = 0; i < 6; i++) B.add(box(0.07, 0.04, 0.9), S.dark, [sx * 1.8, 0.95, -2.5 + i * 1.05]);
  }
  // Heck: Motordeck-Gitter, Auspuff, Rücklichter
  if (lod < 2) {
    B.add(box(2.6, 0.04, 1.6), S.dark, [0, 1.645, 2.0]);
    if (lod === 0) for (let i = 0; i < 9; i++) B.add(box(2.5, 0.05, 0.05), paint, [0, 1.67, 1.3 + i * 0.17]);
    B.add(box(0.7, 0.28, 0.22), S.dark, [-1.0, 1.15, 3.62]);
    B.add(box(0.7, 0.28, 0.22), S.dark, [1.0, 1.15, 3.62]);
    B.add(box(0.12, 0.08, 0.04), S.rearLamp, [-1.5, 1.32, 3.62]);
    B.add(box(0.12, 0.08, 0.04), S.rearLamp, [1.5, 1.32, 3.62]);
  }
  // Bug: Fahrerluke, Scheinwerfergehäuse, Abschlepphaken, Ersatzkettenglieder
  B.add(cyl(0.34, 0.34, 0.06, seg), S.dark, [-0.55, 1.62, -2.35]);
  for (const L of D.lights) B.add(box(0.34, 0.24, 0.2), S.dark, [L[0], L[1], L[2] + 0.1]);
  if (lod === 0) {
    for (const sx of [-1, 1]) B.add(box(0.14, 0.14, 0.3), S.dark, [sx * 0.9, 0.78, -3.5]);
    for (let i = 0; i < 5; i++) B.add(box(0.5, 0.05, 0.16), S.dark, [0.6, 1.28 - i * 0.05, -3.12 + i * 0.09], [-0.5, 0, 0]);
    // Werkzeug an der Flanke
    B.add(box(0.06, 0.08, 1.4), S.canvas, [1.74, 1.05, 1.2]);
    B.add(box(0.05, 0.1, 1.1), S.dark, [-1.74, 1.05, 1.3]);
  }
  // Kennung am Heck
  B.add(cyl(0.2, 0.2, 0.02, seg), mark, [0.0, 1.25, 3.615], [HP, 0, 0]);
  // Laufwerk: Laufrollen, Triebrad, Leitrad
  const W = D.wheels;
  for (const sx of [-1, 1]) {
    const x = sx * W.x;
    if (lod < 2) for (const z of W.z) addRoadWheel(B, S, x, W.radius, z, W.radius, seg, lod);
    B.add(cyl(0.32, 0.32, 0.5, seg), S.dark, [x, 0.55, 3.05], [0, 0, HP]);
    B.add(cyl(0.3, 0.3, 0.46, seg), S.dark, [x, 0.56, -3.12], [0, 0, HP]);
  }
  B.build(hull, { shadow: true });
  // Ketten (eigenes Material je Seite → Texturlauf)
  const path = mbtTrackPath(lod);
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const { geometry, k, length } = trackLoop(path, 0.62, 0.07);
    geometry.translate(sx * W.x, 0, 0);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, S.paint.null);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.track = i; mesh.userData.trackK = k; mesh.userData.trackLen = length;
    hull.add(mesh);
  }
  // Scheinwerfer-Gläser
  const LB = new Bucket();
  for (const L of D.lights) LB.add(cyl(0.11, 0.11, 0.04, seg), S.lensOff, [L[0], L[1], L[2] - 0.01], [HP, 0, 0], null, { tag: { lens: true } });
  LB.build(hull, { shadow: false });

  // Turm
  const tur = new THREE.Group();
  const T = new Bucket();
  T.add(topExtrude([[-0.72, 1.86], [0.72, 1.86], [1.32, 0.95], [1.34, -1.5], [0.95, -2.0], [-0.95, -2.0], [-1.34, -1.5], [-1.32, 0.95]], 0.78, lod === 0), paint);
  T.add(cyl(1.02, 1.05, 0.14, seg + 4), S.dark, [0, -0.03, 0.1]);
  // Richtschützen-Optik, Kommandantenkuppel
  T.add(box(0.42, 0.36, 0.55), paint, [0.62, 0.96, -0.95]);
  T.add(box(0.34, 0.24, 0.04), S.glass, [0.62, 0.98, -1.23]);
  T.add(cyl(0.42, 0.44, 0.24, seg), paint, [-0.62, 0.9, 0.62]);
  if (lod === 0) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      T.add(box(0.12, 0.08, 0.06), S.glass, [-0.62 + Math.sin(a) * 0.43, 0.98, 0.62 + Math.cos(a) * 0.43], [0, a, 0]);
    }
    // Ladeschützenluke, Antenne
    T.add(cyl(0.3, 0.3, 0.05, seg), S.dark, [0.6, 0.8, 0.55]);
    T.add(cyl(0.012, 0.012, 2.3, 4), S.dark, [0.95, 1.9, 1.55]);
  }
  // Nebelwurfbecher
  if (lod < 2) {
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      T.add(cyl(0.055, 0.055, 0.3, 8), S.dark, [sx * (1.1 + i * 0.06), 0.62, -0.75 - i * 0.08], [-0.6, 0, sx * 0.4]);
    }
  }
  // Staukorb hinten mit Gepäck
  if (lod < 2) {
    T.add(box(2.4, 0.04, 0.5), S.dark, [0, 0.08, 2.25]);
    for (const sx of [-1, 0, 1]) T.add(box(0.04, 0.42, 0.04), S.dark, [sx * 1.18, 0.29, 2.48]);
    T.add(box(2.4, 0.04, 0.04), S.dark, [0, 0.5, 2.48]);
    if (lod === 0) { T.add(box(0.8, 0.35, 0.4), S.canvas, [-0.6, 0.27, 2.24]); T.add(box(0.6, 0.3, 0.38), S.canvas, [0.55, 0.25, 2.24]); }
  }
  for (const sx of [-1, 1]) T.add(cyl(0.18, 0.18, 0.02, seg), mark, [sx * 1.335, 0.42, 0.3], [0, 0, HP]);
  const turLod = new THREE.Group();
  T.build(turLod);
  tur.add(turLod);

  // Rohr (Wiege + Mantelblende)
  const gun = new THREE.Group();
  const Gb = new Bucket();
  Gb.add(box(1.05, 0.7, 0.5), paint, [0, 0, 0.0]);
  Gb.add(cyl(0.11, 0.1, 0.5, seg), S.dark, [0, 0, -0.45], [HP, 0, 0]);
  Gb.add(cyl(0.085, 0.085, 5.1, seg), paint, [0, 0, -2.95], [HP, 0, 0]);
  Gb.add(cyl(0.145, 0.145, 0.8, seg), paint, [0, 0, -3.1], [HP, 0, 0]);
  Gb.add(cyl(0.105, 0.11, 0.3, seg), S.dark, [0, 0, -5.4], [HP, 0, 0]);
  if (lod === 0) {
    for (const z of [-1.6, -4.3]) Gb.add(cyl(0.1, 0.1, 0.08, seg), S.dark, [0, 0, z], [HP, 0, 0]);
    Gb.add(box(0.06, 0.06, 0.12), S.dark, [0, 0.1, -5.45]);
  }
  Gb.add(box(0.12, 0.1, 0.22), S.dark, [D.coax[0], D.coax[1], -0.28]);
  const gunLod = new THREE.Group();
  Gb.build(gunLod);
  gun.add(gunLod);

  // Kommandanten-MG (fernbedient)
  const cmg = new THREE.Group();
  const C = new Bucket();
  C.add(box(0.3, 0.2, 0.34), paint, [0, -0.05, 0.1]);
  C.add(box(0.14, 0.16, 0.62), S.dark, [0, 0.08, -0.15]);
  C.add(cyl(0.024, 0.024, 0.85, 8), S.dark, [0, 0.08, -0.8], [HP, 0, 0]);
  if (lod < 2) { C.add(box(0.12, 0.16, 0.24), S.dark, [0.16, 0.02, 0.02]); C.add(box(0.16, 0.12, 0.16), S.glass, [-0.17, 0.08, -0.05]); }
  const cmgLod = new THREE.Group();
  C.build(cmgLod, { shadow: lod < 2 });
  cmg.add(cmgLod);

  return { hull, tur, gun, cmg };
}

function tireGeometry(r, w, seg) {
  const pts = [[r * 0.62, -w / 2], [r * 0.86, -w * 0.52], [r * 0.97, -w * 0.4], [r, 0], [r * 0.97, w * 0.4], [r * 0.86, w * 0.52], [r * 0.62, w / 2]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, seg);
  return g;
}

function buildJeep(lod, S, team) {
  const D = VEHICLES.jeep;
  const seg = [18, 11, 6][lod];
  const paint = S.paint[team] || S.paint.null;
  const mark = S.mark[team] || S.mark.null;
  const hull = new THREE.Group();
  const B = new Bucket();
  // Rahmen
  for (const sx of [-1, 1]) B.add(box(0.12, 0.16, 4.3), S.dark, [sx * 0.5, 0.52, 0]);
  // Motorhaube + Front
  B.add(sideExtrude([[0.9, 0.66], [0.9, 1.2], [2.2, 1.13], [2.36, 1.05], [2.36, 0.64]], 1.72, lod === 0), paint);
  // Wanne: Boden, Seiten, Heck, Spritzwand, Armaturenbrett
  B.add(box(1.86, 0.08, 3.06), paint, [0, 0.88, 0.63]);
  for (const sx of [-1, 1]) {
    B.add(box(0.06, 0.48, 3.06), paint, [sx * 0.93, 1.1, 0.63]);
    B.add(box(0.36, 0.05, 1.15), paint, [sx * 0.88, 0.99, -1.47]);            // Kotflügel vorn
    B.add(box(0.36, 0.05, 0.5), paint, [sx * 0.88, 0.9, -2.15], [-0.45, 0, 0]);
    B.add(box(0.32, 0.26, 0.95), paint, [sx * 0.76, 1.03, 1.38]);              // Radkasten hinten
  }
  B.add(box(1.86, 0.48, 0.06), paint, [0, 1.1, 2.15]);
  B.add(box(1.86, 0.5, 0.08), paint, [0, 1.05, -0.88]);
  B.add(box(1.8, 0.06, 0.32), S.interior, [0, 1.28, -0.75]);
  // Grill, Stoßstangen, Rücklichter
  B.add(box(1.3, 0.4, 0.05), S.dark, [0, 0.86, -2.38]);
  if (lod === 0) for (let i = 0; i < 7; i++) B.add(box(0.05, 0.36, 0.04), paint, [-0.45 + i * 0.15, 0.86, -2.41]);
  B.add(box(2.0, 0.16, 0.18), S.dark, [0, 0.56, -2.48]);
  B.add(box(1.9, 0.14, 0.14), S.dark, [0, 0.62, 2.28]);
  for (const sx of [-1, 1]) B.add(box(0.1, 0.12, 0.03), S.rearLamp, [sx * 0.78, 1.1, 2.19]);
  for (const L of D.lights) B.add(cyl(0.12, 0.12, 0.12, seg), S.dark, [L[0], L[1], L[2] + 0.04], [HP, 0, 0]);
  // Windschutzscheibe (Rahmen + Glas), Überrollbügel
  for (const sx of [-1, 1]) B.add(box(0.05, 0.55, 0.05), S.dark, [sx * 0.86, 1.52, -0.92]);
  B.add(box(1.77, 0.05, 0.05), S.dark, [0, 1.8, -0.92]);
  B.add(box(1.77, 0.05, 0.05), S.dark, [0, 1.26, -0.92]);
  for (const sx of [-1, 1]) {
    B.add(cyl(0.035, 0.035, 1.0, 8), S.dark, [sx * 0.86, 1.6, 0.3]);
    B.add(cyl(0.03, 0.03, 1.9, 8), S.dark, [sx * 0.86, 1.62, 1.15], [1.08, 0, 0]);
  }
  B.add(cyl(0.035, 0.035, 1.72, 8), S.dark, [0, 2.1, 0.3], [0, 0, HP]);
  // Sitze, Lenkrad
  for (const sx of [-1, 1]) {
    B.add(box(0.5, 0.14, 0.5), S.canvas, [sx * 0.46, 1.0, -0.1]);
    B.add(box(0.5, 0.56, 0.1), S.canvas, [sx * 0.46, 1.3, 0.18], [-0.12, 0, 0]);
  }
  B.add(box(1.5, 0.14, 0.5), S.canvas, [0, 1.0, 1.6]);
  B.add(box(1.5, 0.5, 0.1), S.canvas, [0, 1.28, 1.9], [-0.1, 0, 0]);
  if (lod < 2) {
    B.add(new THREE.TorusGeometry(0.18, 0.022, 6, seg), S.dark, [-0.46, 1.48, -0.6], [-0.95, 0, 0]);
    B.add(cyl(0.022, 0.022, 0.5, 6), S.dark, [-0.46, 1.32, -0.75], [-0.95 + HP, 0, 0]);
  }
  // MG-Sockel
  B.add(cyl(0.06, 0.08, 0.9, 10), S.dark, [D.mgPivot[0], 1.42, D.mgPivot[2]]);
  // Ersatzrad, Kanister
  if (lod < 2) {
    B.add(tireGeometry(0.4, 0.28, seg), S.rubber, [0.45, 1.25, 2.33], [HP, 0, 0]);
    B.add(cyl(0.24, 0.24, 0.29, seg), S.dark, [0.45, 1.25, 2.33], [HP, 0, 0]);
  }
  if (lod === 0) for (const sx of [-1, 1]) B.add(box(0.16, 0.44, 0.32), sx < 0 ? paint : S.dark, [sx * -0.55 - 0.1, 1.2, 2.3]);
  // Kennung
  B.add(cyl(0.24, 0.24, 0.015, seg), mark, [0, 1.165, -1.62], [0.05, 0, 0]);
  B.add(cyl(0.15, 0.15, 0.015, seg), mark, [-0.5, 1.12, 2.186], [HP, 0, 0]);
  B.build(hull, { shadow: true });
  // Glas
  const GB = new Bucket();
  GB.add(box(1.66, 0.5, 0.015), S.glass, [0, 1.53, -0.92], [-0.08, 0, 0]);
  GB.build(hull, { shadow: false });
  const LB = new Bucket();
  for (const L of D.lights) LB.add(cyl(0.1, 0.1, 0.03, seg), S.lensOff, [L[0], L[1], L[2] - 0.03], [HP, 0, 0], null, { tag: { lens: true } });
  LB.build(hull, { shadow: false });

  // MG (eigene Lafette)
  const mg = new THREE.Group();
  const M = new Bucket();
  M.add(box(0.16, 0.2, 0.78), S.dark, [0, 0.08, -0.12]);
  M.add(cyl(0.028, 0.028, 1.0, 8), S.dark, [0, 0.1, -0.85], [HP, 0, 0]);
  M.add(cyl(0.048, 0.048, 0.5, 10), S.dark, [0, 0.1, -0.68], [HP, 0, 0]);
  M.add(box(0.14, 0.2, 0.3), paint, [-0.17, 0.06, -0.08]);
  M.add(box(0.72, 0.46, 0.03), paint, [0, 0.12, -0.42]);
  M.add(box(0.05, 0.12, 0.05), S.dark, [-0.08, 0.06, 0.3]);
  M.add(box(0.05, 0.12, 0.05), S.dark, [0.08, 0.06, 0.3]);
  M.add(box(0.12, 0.1, 0.14), S.dark, [0, -0.06, 0.05]);
  const mgLod = new THREE.Group();
  M.build(mgLod, { shadow: lod < 2 });
  mg.add(mgLod);

  // Räder (eigene Drehpunkte)
  const wheels = [];
  const W = D.wheels;
  W.z.forEach((z, axle) => {
    for (const sx of [-1, 1]) {
      const spin = new THREE.Group();
      const R = new Bucket();
      R.add(tireGeometry(W.radius, 0.32, seg), S.rubber, null, [0, 0, HP]);
      R.add(cyl(0.25, 0.25, 0.3, seg), S.dark, null, [0, 0, HP]);
      if (lod === 0) R.add(cyl(0.08, 0.08, 0.34, 8), paint, null, [0, 0, HP]);
      R.build(spin, { shadow: true });
      wheels.push({ spin, axle, side: sx, x: sx * W.x, z });
    }
  });
  return { hull, mg, wheels };
}

/* -------------------------------------------------------------- Vorlagen */

const TEMPLATES = new Map();

function lodOf(levels, dists) {
  const L = new THREE.LOD();
  levels.forEach((o, i) => L.addLevel(o, dists[i], i ? 2 : 0));
  return L;
}

function template(type, team, quality) {
  const key = `${type}:${team}:${quality}`;
  if (TEMPLATES.has(key)) return TEMPLATES.get(key);
  const S = vehicleMaterials();
  const dists = LOD_DIST[quality] || LOD_DIST.high;
  const root = new THREE.Group();
  root.name = `vehicle:${type}`;
  if (type === 'mbt') {
    const D = VEHICLES.mbt;
    const lv = [0, 1, 2].map((l) => buildMBT(l, S, team));
    root.add(lodOf(lv.map((x) => x.hull), dists));
    const tur = new THREE.Group(); tur.name = 'turret';
    tur.position.fromArray(D.turretPivot);
    tur.add(lodOf(lv.map((x) => x.tur), dists));
    const gun = new THREE.Group(); gun.name = 'gun';
    gun.position.fromArray(D.gunPivot);
    gun.add(lodOf(lv.map((x) => x.gun), dists));
    tur.add(gun);
    const cmg = new THREE.Group(); cmg.name = 'cmg';
    cmg.position.fromArray(D.cmgPivot);
    cmg.add(lodOf(lv.map((x) => x.cmg), dists));
    tur.add(cmg);
    root.add(tur);
  } else {
    const D = VEHICLES.jeep;
    const lv = [0, 1, 2].map((l) => buildJeep(l, S, team));
    root.add(lodOf(lv.map((x) => x.hull), dists));
    const mg = new THREE.Group(); mg.name = 'mg';
    mg.position.fromArray(D.mgPivot);
    mg.add(lodOf(lv.map((x) => x.mg), dists));
    root.add(mg);
    const my = mountY(D);
    lv[0].wheels.forEach((w0, i) => {
      const pivot = new THREE.Group();
      pivot.name = `wheel${i}`;
      pivot.position.set(w0.x, my - (D.wheels.rest - D.wheels.comp), w0.z);
      const spin = new THREE.Group(); spin.name = 'spin';
      spin.add(lodOf(lv.map((x) => x.wheels[i].spin), dists));
      pivot.add(spin);
      pivot.userData = { axle: w0.axle, side: w0.side };
      root.add(pivot);
    });
  }
  // Lichtkegel (unbeleuchtet, additiv – nur sichtbar, wenn die Scheinwerfer an sind)
  for (const L of VEHICLES[type].lights) {
    const g = new THREE.ConeGeometry(1.5, 9, 14, 1, true);
    g.translate(0, -4.5, 0);
    g.rotateX(-HP);
    const cone = new THREE.Mesh(g, S.cone);
    cone.position.fromArray(L);
    cone.position.z -= 0.05;
    cone.rotation.x = -0.06;
    cone.visible = false;
    cone.userData.cone = true;
    cone.renderOrder = 5;
    root.add(cone);
  }
  TEMPLATES.set(key, root);
  return root;
}

/** Fahrzeugmodell erzeugen (Klon der Vorlage). quality: low|medium|high|ultra. */
export function createVehicleModel(type, { team = null, quality = 'high' } = {}) {
  const S = vehicleMaterials();
  const tpl = template(type, team, quality);
  const root = tpl.clone(true);
  const model = {
    root, type,
    turret: root.getObjectByName('turret') || null,
    gun: root.getObjectByName('gun') || null,
    cmg: root.getObjectByName('cmg') || null,
    mg: root.getObjectByName('mg') || null,
    wheels: [], trackMats: [], trackK: [1, 1], trackLen: [1, 1],
    lenses: [], cones: [], meshes: [],
    lightsOn: false, wrecked: false,
  };
  const tm = [trackMaterial(), trackMaterial()];
  root.traverse((o) => {
    if (o.isMesh) {
      model.meshes.push(o);
      if (o.userData.lens) model.lenses.push(o);
      if (o.userData.cone) model.cones.push(o);
      if (o.userData.track != null) {
        o.material = tm[o.userData.track];
        model.trackK[o.userData.track] = o.userData.trackK;
        model.trackLen[o.userData.track] = o.userData.trackLen;
      }
      o.userData.baseMat = o.material;
    }
    if (o.name && o.name.startsWith('wheel')) model.wheels.push({ pivot: o, spin: o.getObjectByName('spin'), axle: o.userData.axle, side: o.userData.side });
  });
  if (type === 'mbt') model.trackMats = tm;
  else for (const m of tm) { m.map.dispose(); m.dispose(); }

  model.setLights = (on) => {
    model.lightsOn = !!on && !model.wrecked;
    for (const l of model.lenses) l.material = model.lightsOn ? S.lensOn : S.lensOff;
    for (const c of model.cones) c.visible = model.lightsOn;
  };
  model.setWreck = (on) => {
    model.wrecked = !!on;
    for (const o of model.meshes) {
      if (o.userData.cone) continue;
      const base = o.userData.baseMat;
      if (on) {
        if (base === S.glass || o.userData.lens) { o.visible = false; continue; }
        o.material = S.wreck;
      } else { o.visible = true; o.material = base; }
    }
    if (on) model.setLights(false);
  };
  /** Kettenlauf: Geschwindigkeit links/rechts (m/s) über dt. */
  model.scrollTracks = (vl, vr, dt) => {
    for (let i = 0; i < model.trackMats.length; i++) {
      const v = i === 0 ? vl : vr;
      const t = model.trackMats[i].map;
      t.offset.x = (t.offset.x - (v * dt * model.trackK[i]) / model.trackLen[i]) % 1;
    }
  };
  model.dispose = () => {
    root.removeFromParent();
    for (const m of model.trackMats) { m.map.dispose(); m.dispose(); }
    model.trackMats = [];
  };
  return model;
}

/** Vorlagen vorbauen (Ladebildschirm) – optional. */
export function prepareVehicleModels(types, teams = ['A', 'B'], quality = 'high') {
  for (const t of types) for (const team of teams) template(t, team, quality);
}

/** Dreiecke je LOD-Stufe (Prüfung/Budget). */
export function vehicleTriangles(type, quality = 'high') {
  const tpl = template(type, 'A', quality);
  const out = [0, 0, 0];
  tpl.traverse((o) => {
    if (!o.isLOD) return;
    o.levels.forEach((lv, i) => lv.object.traverse((m) => {
      if (m.isMesh) out[i] += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    }));
  });
  return out.map(Math.round);
}
