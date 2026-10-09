// NULLPUNKT — Prozedurale Fahrzeugmodelle (GROSSKAMPF_PLAN §6.7): KP-1 Mammut (Kampfpanzer), GW-4 Steppe (Geländewagen).
//
// Baukasten aus Grundkörpern, je Material zu einem Mesh verschmolzen (wenige Draw Calls), drei LOD-Stufen
// (THREE.LOD; Abstände je Qualitätsstufe). UVs weltmaßstäblich (1 m) über boxUV → passen zu den Fotoscan-Sätzen.
// Ketten: geschlossene Bandschleife um Triebrad/Leitrad mit Lauf-UV (Texturversatz = Kettenlauf).
// Vorlagen werden je Typ/Team/Stufe einmal gebaut und geklont (Geometrien/Materialien geteilt).
//
// createVehicleModel(type, { team, quality }) → {
//   root, turret, gun, cmg, mg, wheels:[{pivot, spin, steer, side, local}], trackMats:[L, R], trackLoop (m),
//   lenses:[Mesh], cones:[Mesh], setLights(on), setWreck(on), dispose(),
//   // Besatzung (panzer-mp.md §3.7/§D.2, nur KP-1; beim Geländewagen hatches = {} und interior = null):
//   hatches:{driver, commander, loader} (Drehpunkt an der Scharnierkante), setHatch(id, t 0…1),
//   interior (Turmraum, unsichtbar), setInterior(on), setBreech(t 0…1), setRack({mbt_ap, mbt_he}), setHeld(type|null)
// }
// Luken und Innenraum liegen außerhalb der LOD-Stufen (eigene Netze; der Innenraum nur für den lokalen Insassen).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxUV } from '../engine/textures.js';
import { VEHICLES, mountY, staticComp } from './data.js';
import { vehicleMaterials, trackMaterial, markingMaterial, applyVehicleLook } from './materials.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const PI = Math.PI, HP = PI / 2;
const LOD_DIST = { low: [0, 18, 50], medium: [0, 28, 75], high: [0, 40, 110], ultra: [0, 55, 140] };
/** env-look: Detailteile (Rückrollen, Zähne, Schürzensegmente, Seile, Staukästen, Profilreifen …) nur ab medium –
 * low behält exakt die bisherige Geometrie (Dreiecke ≤ vorher). Wird je Vorlage in template() gesetzt. */
let HQ = true;
/** Detailstufe der Vorlage: 0 = low (Bestand), 1 = medium, 2 = high/ultra (Budget panzer-mp.md §D.3). */
let DET = 2;
/** Optisch 7 Laufrollen je Seite (ab medium) – die Federung rechnet weiter mit den 5 Federstrahlen aus data.js. */
const ROAD7 = [-2.65, -1.767, -0.883, 0, 0.883, 1.767, 2.65];

/** LOD-Stufe, die gerade gebaut wird (Kantenabnutzung nur in den Nahstufen). */
let CUR_LOD = 0;

/**
 * env-look: Kantenabstand je Ecke (Attribut aVehE) für die Kantenabnutzung im Lack-Shader. Je Dreieck und Kante:
 * Abstand der gegenüberliegenden Ecke zur Kante (linear interpoliert = Abstand zur Kante), wenn die Kante eine harte,
 * konvexe Außenkante ist (Nachbardreieck mit anderer Normale, liegt „hinter“ der eigenen Ebene); sonst groß.
 * Glatte Übergänge (Zylindermantel, Torus), innere Diagonalen und offene Ränder bleiben ohne Abnutzung.
 */
const EDGE_FAR = 9;
function edgeAttribute(g) {
  const P = g.attributes.position.array, N = g.attributes.normal ? g.attributes.normal.array : null;
  const nt = P.length / 9, out = new Float32Array(P.length).fill(EDGE_FAR);
  if (!N || CUR_LOD > 1) return out;
  const key = (v) => `${Math.round(P[v * 3] * 400)},${Math.round(P[v * 3 + 1] * 400)},${Math.round(P[v * 3 + 2] * 400)}`;
  const vk = new Array(nt * 3);
  for (let v = 0; v < nt * 3; v++) vk[v] = key(v);
  const edges = new Map();
  const ek = (a, b) => (vk[a] < vk[b] ? `${vk[a]}|${vk[b]}` : `${vk[b]}|${vk[a]}`);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = t * 3 + ((k + 1) % 3), b = t * 3 + ((k + 2) % 3), kk = ek(a, b);
    let list = edges.get(kk);
    if (!list) edges.set(kk, (list = []));
    list.push(t);
  }
  const cen = (t, o) => { o[0] = (P[t * 9] + P[t * 9 + 3] + P[t * 9 + 6]) / 3; o[1] = (P[t * 9 + 1] + P[t * 9 + 4] + P[t * 9 + 7]) / 3; o[2] = (P[t * 9 + 2] + P[t * 9 + 5] + P[t * 9 + 8]) / 3; return o; };
  const c1 = [0, 0, 0], c2 = [0, 0, 0];
  // Normale derselben Lage in Dreieck t (Ecke mit gleichem Schlüssel)
  const normAt = (t, k) => { for (let j = 0; j < 3; j++) if (vk[t * 3 + j] === k) return t * 3 + j; return -1; };
  for (let t = 0; t < nt; t++) {
    const i0 = t * 9;
    // Flächennormale
    const ux = P[i0 + 3] - P[i0], uy = P[i0 + 4] - P[i0 + 1], uz = P[i0 + 5] - P[i0 + 2];
    const wx = P[i0 + 6] - P[i0], wy = P[i0 + 7] - P[i0 + 1], wz = P[i0 + 8] - P[i0 + 2];
    let fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const area2 = Math.hypot(fx, fy, fz);
    if (area2 < 1e-9) continue;
    fx /= area2; fy /= area2; fz /= area2;
    cen(t, c1);
    for (let k = 0; k < 3; k++) {
      const a = t * 3 + ((k + 1) % 3), b = t * 3 + ((k + 2) % 3);
      const list = edges.get(ek(a, b));
      let wear = false;
      if (list) for (const t2 of list) {
        if (t2 === t) continue;
        const a2 = normAt(t2, vk[a]), b2 = normAt(t2, vk[b]);
        if (a2 < 0 || b2 < 0) continue;
        const smooth = N[a * 3] * N[a2 * 3] + N[a * 3 + 1] * N[a2 * 3 + 1] + N[a * 3 + 2] * N[a2 * 3 + 2] > 0.985
          && N[b * 3] * N[b2 * 3] + N[b * 3 + 1] * N[b2 * 3 + 1] + N[b * 3 + 2] * N[b2 * 3 + 2] > 0.985;
        if (smooth) { wear = false; break; }
        cen(t2, c2);
        if (fx * (c2[0] - c1[0]) + fy * (c2[1] - c1[1]) + fz * (c2[2] - c1[2]) < -1e-5) wear = true;
      }
      if (!wear) continue;
      const lab = Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
      const h = lab > 1e-9 ? area2 / lab : 0; // Höhe der Ecke k über der Kante
      out[(t * 3 + k) * 3 + k] = h;
      out[a * 3 + k] = 0;
      out[b * 3 + k] = 0;
    }
  }
  return out;
}

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
  build(parent, { shadow = true, off = null } = {}) {
    for (const [mat, list] of this.map) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      if (!merged.attributes.uv) boxUV(merged, 1);
      // env-look: Position im Fahrzeugraum (Gruppen-Versatz des Turms/Rohrs) für Schlamm/Staub/Tarnung im Lack-Shader
      if (HQ) {
        const P = merged.attributes.position, A = new Float32Array(P.count * 3);
        const ox = off ? off[0] : 0, oy = off ? off[1] : 0, oz = off ? off[2] : 0;
        for (let i = 0; i < P.count; i++) { A[i * 3] = P.getX(i) + ox; A[i * 3 + 1] = P.getY(i) + oy; A[i * 3 + 2] = P.getZ(i) + oz; }
        merged.setAttribute('aVeh', new THREE.BufferAttribute(A, 3));
        if (mat.userData && mat.userData.vehPaint) merged.setAttribute('aVehE', new THREE.BufferAttribute(edgeAttribute(merged), 3));
      }
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

/** env-look (medium+): Laufrolle mit Gummibandage, lackierter Radscheibe, Nabe und (high) Radmuttern. */
function addRoadWheelHQ(B, S, paint, x, y, z, r, seg, lod) {
  const sx = Math.sign(x) || 1;
  B.add(cyl(r, r, 0.42, seg), S.rubber, [x, y, z], [0, 0, HP]);
  B.add(cyl(r * 0.78, r * 0.78, 0.44, seg), paint, [x, y, z], [0, 0, HP]);
  B.add(cyl(r * 0.24, r * 0.26, 0.5, Math.max(6, seg >> 1)), S.dark, [x, y, z], [0, 0, HP]);
  if (lod === 0 && DET === 2) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    B.add(box(0.03, 0.03, 0.03), S.dark, [x + sx * 0.225, y + Math.sin(a) * 0.15, z + Math.cos(a) * 0.15]);
  }
}

/** Keilförmiger Panzerblock: Grundriss (x, v = vorwärts) als Prisma ab y0, Oberseite fällt von hBack (hinten) nach
 * hFront (vorn) ab – Zusatzpanzerung am Turm. */
function wedge(pts, y0, hBack, hFront) {
  const g = topExtrude(pts, 1);
  const P = g.attributes.position;
  let zf = Infinity, zb = -Infinity;
  for (let i = 0; i < P.count; i++) { zf = Math.min(zf, P.getZ(i)); zb = Math.max(zb, P.getZ(i)); }
  for (let i = 0; i < P.count; i++) {
    const k = (P.getZ(i) - zf) / Math.max(1e-6, zb - zf); // 0 = vorn … 1 = hinten
    P.setY(i, y0 + (P.getY(i) > 0.5 ? hFront + (hBack - hFront) * k : 0));
  }
  g.computeVertexNormals();
  return g;
}

/** env-look: Laufwerk und Wanne – Rückrollen, Triebrad mit Zahnkränzen, Leitrad mit Speichen, Schürzensegmente mit
 * Gummiunterkante, Zusatzpanzerung am Glacis, Scheinwerferschutzbügel, Abschleppösen, Heckgitter, Auspuffgitter,
 * Seitenkästen, Winkelspiegel, Kanister und Schanzzeug. Nur HQ (medium+); DET 2 (high/ultra) mit Kleinteilen. */
function mbtDetail(B, S, paint, lod, seg) {
  const W = VEHICLES.mbt.wheels;
  const hi = DET === 2;
  for (const sx of [-1, 1]) {
    if (lod < 2) for (const z of [-1.95, 0, 1.95]) {
      B.add(cyl(0.1, 0.1, 0.2, Math.max(8, seg >> 1)), S.rubber, [sx * W.x, 0.78, z], [0, 0, HP]);
      B.add(cyl(0.045, 0.045, 0.34, 6), S.dark, [sx * (W.x - 0.12), 0.78, z], [0, 0, HP]);
    }
    if (lod === 0 || (lod === 1 && hi)) {
      // Triebrad: lackierte Scheibe + Nabe; Leitrad: Nabe (Speichen s. u.)
      B.add(cyl(0.25, 0.25, 0.52, seg), paint, [sx * W.x, 0.55, 3.05], [0, 0, HP]);
      B.add(cyl(0.1, 0.11, 0.56, Math.max(6, seg >> 1)), S.dark, [sx * W.x, 0.55, 3.05], [0, 0, HP]);
      B.add(cyl(0.09, 0.1, 0.5, Math.max(6, seg >> 1)), S.dark, [sx * W.x, 0.56, -3.12], [0, 0, HP]);
    }
    if (lod === 0) {
      // Triebrad (hinten): zwei Zahnkränze
      for (const dx of [-0.13, 0.13]) for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2;
        B.add(box(0.07, 0.075, 0.07), S.dark, [sx * W.x + dx, 0.55 + Math.sin(a) * 0.34, 3.05 + Math.cos(a) * 0.34], [a, 0, 0]);
      }
      // Leitrad (vorn): Speichen auf der Außenseite
      if (hi) for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2 + 0.3;
        B.add(box(0.05, 0.05, 0.2), paint, [sx * (W.x + 0.235), 0.56 + Math.sin(a) * 0.15, -3.12 + Math.cos(a) * 0.15], [a, 0, 0]);
      }
      // Schürze in Segmenten mit Gummiunterkante; die beiden vorderen als dicke Panzerschürze; (high) Schrauben
      for (let i = 0; i < 6; i++) {
        const z = -2.55 + i * 1.04;
        B.add(box(i < 2 ? 0.07 : 0.014, 0.46, 0.98), paint, [sx * (i < 2 ? 1.855 : 1.828), 0.73, z], [0, 0, sx * 0.035]);
        B.add(box(0.025, 0.14, 0.96), S.rubber, [sx * 1.82, 0.44, z]);
        if (hi) for (let j = 0; j < 4; j++) B.add(box(0.02, 0.026, 0.026), S.dark, [sx * (i < 2 ? 1.896 : 1.842), 0.92, z - 0.36 + j * 0.24]);
      }
      B.add(box(0.04, 0.4, 0.14), S.rubber, [sx * 1.78, 0.56, -3.2]);
      B.add(box(0.5, 0.42, 0.03), S.rubber, [sx * 1.42, 0.55, 3.66]);
    }
    if (lod < 2) {
      // Seitenkästen über den Ketten (vorn, neben dem Turm)
      B.add(box(0.3, 0.22, 1.05), paint, [sx * 1.57, 1.74, -1.45]);
      if (lod === 0 && hi) {
        B.add(box(0.31, 0.02, 1.07), S.dark, [sx * 1.57, 1.83, -1.45]);
        for (const dz of [-0.3, 0.3]) B.add(box(0.03, 0.06, 0.05), S.dark, [sx * 1.725, 1.76, -1.45 + dz]);
      }
    }
    if (lod === 0 && hi) {
      // Auspuffgitter seitlich hinten (Lamellen)
      B.add(box(0.03, 0.26, 0.62), S.dark, [sx * 1.765, 1.3, 3.0]);
      for (let j = 0; j < 4; j++) B.add(box(0.04, 0.03, 0.6), paint, [sx * 1.775, 1.2 + j * 0.065, 3.0], [0, 0, sx * 0.5]);
      // Scheinwerferschutzbügel
      const L = VEHICLES.mbt.lights[sx < 0 ? 0 : 1];
      B.add(box(0.4, 0.03, 0.03), S.dark, [L[0], L[1] + 0.17, L[2] - 0.14]);
      for (const dx of [-0.19, 0.19]) B.add(box(0.03, 0.2, 0.03), S.dark, [L[0] + dx, L[1] + 0.08, L[2] - 0.14]);
      // Abschleppösen vorn/hinten
      B.add(new THREE.TorusGeometry(0.075, 0.024, 4, 8), S.dark, [sx * 0.9, 0.86, -3.66], [0, HP, 0]);
      B.add(new THREE.TorusGeometry(0.075, 0.024, 4, 8), S.dark, [sx * 0.6, 0.95, 3.66], [0, HP, 0]);
    }
  }
  if (lod < 2) {
    // geteiltes Glacis: zwei aufgesetzte Zusatzpanzerplatten (Spalt in der Mitte)
    for (const sx of [-1, 1]) {
      B.add(box(1.2, 0.06, 0.9), paint, [sx * 0.68, 1.31, -3.05], [-0.49, 0, 0]);
      if (lod === 0 && hi) for (let j = 0; j < 4; j++) B.add(box(0.04, 0.03, 0.04), S.dark, [sx * (0.2 + j * 0.32), 1.53, -2.68], [-0.49, 0, 0]);
    }
    // Fahrer-Winkelspiegel vor der Luke
    for (let i = -1; i <= 1; i++) B.add(box(0.14, 0.08, 0.1), S.optic, [-0.55 + i * 0.2, 1.66, -2.66 + Math.abs(i) * 0.06], [0, -i * 0.35, 0]);
    // Kanister auf dem Motordeck
    for (const sx of [-1, 1]) {
      B.add(box(0.17, 0.46, 0.34), paint, [sx * 1.45, 1.86, 2.75]);
      if (lod === 0) B.add(box(0.05, 0.05, 0.12), S.dark, [sx * 1.45, 2.11, 2.68]);
    }
    // Heckplatte: Lüftergitter zwischen den Auspuffkästen
    B.add(box(1.1, 0.34, 0.03), S.dark, [0, 1.15, 3.6]);
    if (lod === 0 && hi) for (let j = 0; j < 5; j++) B.add(box(1.06, 0.03, 0.05), paint, [0, 1.03 + j * 0.06, 3.62], [0.6, 0, 0]);
  }
  if (lod === 0) {
    // Schaufel + Brechstange neben der Fahrerluke
    B.add(cyl(0.018, 0.018, 1.1, 6), S.canvas, [0.35, 1.65, -1.75], [HP, 0, 0]);
    B.add(box(0.22, 0.02, 0.28), S.dark, [0.35, 1.65, -1.08]);
    B.add(cyl(0.014, 0.014, 1.2, 6), S.dark, [0.62, 1.65, -1.6], [HP, 0, 0]);
    if (hi) {
      // Vorschlaghammer auf dem Motordeck, Deckel-Fugen
      B.add(cyl(0.02, 0.02, 0.9, 6), S.canvas, [-0.9, 1.7, 1.5], [HP, 0, 0]);
      B.add(box(0.1, 0.08, 0.18), S.dark, [-0.9, 1.7, 1.02]);
      for (const z of [1.2, 2.8]) B.add(box(2.62, 0.012, 0.02), S.dark, [0, 1.668, z]);
    }
  }
}

/** env-look: Turm – Keil-Zusatzpanzerung vorn, Seitenmodule, Staukästen, Rauchwurfbecher (2×4), Optikkopf mit Klappen,
 * Rundblickperiskop, Winkelspiegel der Ladeluke, Lukenring mit MG-Lafette, Staukorb mit Gepäck und Ersatzkettengliedern,
 * Hebeösen, Windsensor, Antennen, Dachnähte. Nur HQ (medium+); DET 2 (high/ultra) mit Kleinteilen. */
function turretDetail(T, S, paint, lod, seg) {
  const hi = DET === 2;
  if (lod < 2) {
    for (const sx of [-1, 1]) {
      // Keilpanzer vor den Wangen (Oberseite fällt nach vorn ab)
      const P = [[0.66, 1.9], [1.1, 2.42], [1.36, 0.93]].map(([x, v]) => [sx * x, v]);
      T.add(wedge(sx < 0 ? P.reverse() : P, 0.1, 0.66, 0.4), paint);
      // Seitenmodul (Abstandspanzer) + Staukasten seitlich hinten
      T.add(box(0.07, 0.56, 1.1), paint, [sx * 1.39, 0.4, -0.4]);
      T.add(box(0.3, 0.44, 0.92), paint, [sx * 1.505, 0.46, 1.05]);
      // Rauchwurfbecher: Block mit 4 Bechern je Seite
      T.add(box(0.42, 0.07, 0.22), S.dark, [sx * 1.11, 0.815, -0.7]);
      for (let i = 0; i < 4; i++) T.add(cyl(0.05, 0.05, 0.26, lod === 0 ? 8 : 6, lod > 0), S.dark, [sx * (0.98 + i * 0.087), 0.92, -0.76], [-0.75, 0, sx * 0.3]);
      if (lod === 0) {
        T.add(box(0.31, 0.02, 0.94), S.dark, [sx * 1.505, 0.69, 1.05]);
        if (hi) for (let j = 0; j < 6; j++) T.add(box(0.03, 0.035, 0.035), S.dark, [sx * 1.43, 0.22 + (j % 2) * 0.36, -0.85 + (j >> 1) * 0.45]);
      }
    }
    // Richtschützen-Optikkopf: Schutzhaube (Klappen s. u.)
    T.add(box(0.48, 0.05, 0.6), paint, [0.62, 1.165, -0.98]);
    // Rundblickperiskop des Kommandanten (fest, links vorn)
    T.add(cyl(0.12, 0.14, 0.12, Math.max(8, seg >> 1)), paint, [-1.0, 0.84, -0.3]);
    T.add(box(0.28, 0.24, 0.28), paint, [-1.0, 1.02, -0.3]);
    T.add(box(0.2, 0.1, 0.02), S.optic, [-1.0, 1.03, -0.445]);
    // Kommandantenkuppel: Öffnung unter dem Deckel
    T.add(cyl(0.34, 0.34, 0.012, seg), S.dark, [-0.62, 1.024, 0.62]);
    // Staukorb: Seitenholme, Planenrolle
    for (const sx of [-1, 1]) T.add(box(0.04, 0.04, 0.5), S.dark, [sx * 1.18, 0.5, 2.25]);
    T.add(cyl(0.12, 0.12, 1.5, Math.max(8, seg >> 1)), S.canvas, [0.1, 0.5, 2.3], [0, 0, HP]);
    // Winkelspiegel an der Ladeluke
    for (let i = 0; i < 3; i++) { const a = -0.9 + i * 0.9; T.add(box(0.12, 0.07, 0.06), S.optic, [0.6 + Math.sin(a) * 0.36, 0.83, 0.55 - Math.cos(a) * 0.36], [0, a, 0]); }
  }
  if (lod === 0) {
    for (const [x, z] of [[-1.15, -0.8], [1.15, -0.8], [-1.0, 1.7], [1.0, 1.7]]) T.add(new THREE.TorusGeometry(0.05, 0.014, 4, 8), S.dark, [x, 0.8, z], [0, x > 0 ? HP : -HP, 0]);
    T.add(cyl(0.015, 0.015, 0.42, 5), S.dark, [0.15, 0.99, 1.65]);
    T.add(box(0.08, 0.06, 0.16), S.dark, [0.15, 1.2, 1.65]);
    T.add(cyl(0.012, 0.012, 1.9, 4), S.dark, [-0.95, 1.73, 1.55]);
    T.add(cyl(0.05, 0.06, 0.08, 8), S.dark, [-0.95, 0.82, 1.55]);
    for (const z of [-0.6, 0.6]) T.add(box(2.2, 0.012, 0.02), S.dark, [0, 0.785, z]);
    if (hi) {
      // Optikkopf: aufgeklappte Panzerklappen; Periskop: Haube + Rückfenster
      for (const sx of [-1, 1]) T.add(box(0.025, 0.24, 0.16), paint, [0.62 + sx * 0.25, 0.98, -1.3], [0, sx * 0.5, 0]);
      T.add(box(0.32, 0.03, 0.34), paint, [-1.0, 1.155, -0.32]);
      T.add(box(0.2, 0.1, 0.02), S.optic, [-1.0, 1.03, -0.155]);
      // Lukenring der Ladeschützenluke mit MG-Lafette (Zapfen, Waffe, Gurtkasten)
      T.add(new THREE.TorusGeometry(0.37, 0.022, 4, 18), S.dark, [0.6, 0.81, 0.55], [HP, 0, 0]);
      T.add(cyl(0.02, 0.02, 0.3, 6), S.dark, [0.6, 0.97, 0.17]);
      T.add(box(0.08, 0.1, 0.42), S.dark, [0.6, 1.14, 0.08]);
      T.add(cyl(0.016, 0.016, 0.5, 6), S.dark, [0.6, 1.16, -0.36], [HP, 0, 0]);
      T.add(box(0.1, 0.1, 0.14), paint, [0.67, 1.1, 0.12]);
      // Antennenfuß, Ersatzkettenglieder am Staukorb-Heck, Gepäck
      T.add(cyl(0.05, 0.06, 0.08, 8), S.dark, [0.95, 0.82, 1.55]);
      for (let i = 0; i < 3; i++) {
        const x = -0.75 + i * 0.68;
        T.add(box(0.62, 0.15, 0.035), S.dark, [x, 0.3, 2.52]);
        for (const dx of [-0.32, 0.32]) T.add(box(0.04, 0.07, 0.06), S.dark, [x + dx, 0.3, 2.53]);
      }
      for (let i = 0; i < 5; i++) T.add(box(0.025, 0.4, 0.025), S.dark, [-0.95 + i * 0.475, 0.29, 2.48]);
      T.add(box(0.36, 0.22, 0.24), S.dark, [0.75, 0.21, 2.2]);
      T.add(box(0.16, 0.34, 0.3), paint, [-1.0, 0.27, 2.25]);
    }
  }
}

/** env-look: Rohr – Mantelblende mit Stirnplatte und Kragen, Rauchabsauger mit Übergängen, Wärmeschutzhülle in
 * Segmenten (Spannbänder), Mündungsreferenz mit Spiegelgehäuse. Nur HQ. */
function gunDetail(Gb, S, paint, lod, seg) {
  if (lod > 1) return;
  Gb.add(box(0.98, 0.6, 0.1), paint, [0, 0, -0.3]);
  for (const sx of [-1, 1]) Gb.add(box(0.08, 0.6, 0.38), paint, [sx * 0.52, 0, -0.1], [0, sx * 0.35, 0]);
  Gb.add(cyl(0.17, 0.2, 0.12, seg), paint, [0, 0, -0.41], [HP, 0, 0]);
  for (const [z, a, b] of [[-2.65, 0.088, 0.145], [-3.55, 0.145, 0.088]]) Gb.add(cyl(a, b, 0.1, seg, true), paint, [0, 0, z], [HP, 0, 0]);
  if (lod === 0 && DET === 2) {
    for (const z of [-0.95, -2.2, -3.95, -4.85]) Gb.add(cyl(0.095, 0.095, 0.04, 14), S.dark, [0, 0, z], [HP, 0, 0]);
    for (let i = 0; i < 6; i++) Gb.add(box(0.035, 0.035, 0.035), S.dark, [-0.4 + i * 0.16, 0.26, -0.36]);
    Gb.add(box(0.1, 0.08, 0.1), S.dark, [0, 0.14, -5.47]);
    Gb.add(box(0.02, 0.1, 0.02), S.dark, [0, 0.12, -5.38]);
  }
}

function buildMBT(lod, S, team) {
  CUR_LOD = lod;
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
    if (lod === 0 && !HQ) for (let i = 0; i < 6; i++) B.add(box(0.07, 0.04, 0.9), S.dark, [sx * 1.8, 0.95, -2.5 + i * 1.05]);
  }
  if (HQ) mbtDetail(B, S, paint, lod, seg);
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
    if (!HQ) for (let i = 0; i < 5; i++) B.add(box(0.5, 0.05, 0.16), S.dark, [0.6, 1.28 - i * 0.05, -3.12 + i * 0.09], [-0.5, 0, 0]);
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
    if (lod < 2 && HQ) { const rs = lod === 0 ? (DET === 2 ? 18 : 14) : (DET === 2 ? 10 : 8); for (const z of ROAD7) addRoadWheelHQ(B, S, paint, x, W.radius, z, W.radius, rs, lod); }
    else if (lod < 2) for (const z of W.z) addRoadWheel(B, S, x, W.radius, z, W.radius, seg, lod);
    B.add(cyl(0.32, 0.32, 0.5, seg), S.dark, [x, 0.55, 3.05], [0, 0, HP]);
    B.add(cyl(0.3, 0.3, 0.46, seg), S.dark, [x, 0.56, -3.12], [0, 0, HP]);
  }
  if (HQ && lod < 2) {
    // Abschleppseile an den Wannenflanken (durchhängend, Ösen an den Enden) – im selben Bucket (ein Draw Call)
    for (const sx of [-1, 1]) {
      const x = sx * 1.785, curve = new THREE.CatmullRomCurve3([[x, 1.42, -2.3], [x, 1.36, -1.2], [x, 1.34, 0], [x, 1.36, 1.2], [x, 1.42, 2.3]].map((p) => new THREE.Vector3(...p)));
      B.add(new THREE.TubeGeometry(curve, lod === 0 ? 40 : 16, 0.022, lod === 0 ? 6 : 4, false), S.dark);
      if (lod === 0) for (const z of [-2.36, 2.36]) B.add(new THREE.TorusGeometry(0.055, 0.018, 5, 10), S.dark, [x, 1.43, z], [0, HP, 0]);
    }
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
  T.add(box(0.34, 0.24, 0.04), S.optic, [0.62, 0.98, -1.23]);
  T.add(cyl(0.42, 0.44, 0.24, seg), paint, [-0.62, 0.9, 0.62]);
  if (lod === 0) {
    const nv = DET === 2 ? 8 : 6;
    for (let i = 0; i < nv; i++) {
      const a = (i / nv) * PI * 2;
      T.add(box(0.12, 0.08, 0.06), S.optic, [-0.62 + Math.sin(a) * 0.43, 0.98, 0.62 + Math.cos(a) * 0.43], [0, a, 0]);
    }
    // Ladeschützenluke, Antenne
    T.add(cyl(0.3, 0.3, 0.05, seg), S.dark, [0.6, 0.8, 0.55]);
    T.add(cyl(0.012, 0.012, 2.3, 4), S.dark, [0.95, 1.9, 1.55]);
  }
  // Nebelwurfbecher (ab medium: 2×4 im Block, turretDetail)
  if (lod < 2 && !HQ) {
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
  if (HQ) turretDetail(T, S, paint, lod, seg);
  const turLod = new THREE.Group();
  T.build(turLod, { off: D.turretPivot });
  if (HQ && lod < 2) {
    // taktische Kennung (Schablone) an den Turm-Staukästen
    const MK = new Bucket();
    for (const sx of [-1, 1]) MK.add(new THREE.PlaneGeometry(0.66, 0.165), markingMaterial(team), [sx * 1.662, 0.46, 1.05], [0, sx * HP, 0], null, { keepUV: true });
    MK.build(turLod, { shadow: false, off: D.turretPivot });
  }
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
  if (HQ) gunDetail(Gb, S, paint, lod, seg);
  const gunLod = new THREE.Group();
  Gb.build(gunLod, { off: [D.turretPivot[0] + D.gunPivot[0], D.turretPivot[1] + D.gunPivot[1], D.turretPivot[2] + D.gunPivot[2]] });
  gun.add(gunLod);

  // Kommandanten-MG (fernbedient)
  const cmg = new THREE.Group();
  const C = new Bucket();
  C.add(box(0.3, 0.2, 0.34), paint, [0, -0.05, 0.1]);
  C.add(box(0.14, 0.16, 0.62), S.dark, [0, 0.08, -0.15]);
  C.add(cyl(0.024, 0.024, 0.85, 8), S.dark, [0, 0.08, -0.8], [HP, 0, 0]);
  if (lod < 2) { C.add(box(0.12, 0.16, 0.24), S.dark, [0.16, 0.02, 0.02]); C.add(box(0.16, 0.12, 0.16), S.optic, [-0.17, 0.08, -0.05]); }
  const cmgLod = new THREE.Group();
  C.build(cmgLod, { shadow: lod < 2, off: [D.turretPivot[0] + D.cmgPivot[0], D.turretPivot[1] + D.cmgPivot[1], D.turretPivot[2] + D.cmgPivot[2]] });
  cmg.add(cmgLod);

  return { hull, tur, gun, cmg };
}

function tireGeometry(r, w, seg, tread = false) {
  if (tread) return treadTire(r, w);
  const pts = [[r * 0.62, -w / 2], [r * 0.86, -w * 0.52], [r * 0.97, -w * 0.4], [r, 0], [r * 0.97, w * 0.4], [r * 0.86, w * 0.52], [r * 0.62, w / 2]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, seg);
  return g;
}

/** env-look: Geländereifen mit Stollenprofil (versetzte Blöcke, Schulterstollen) – Lathe mit 48 Segmenten, die
 * Laufflächen-Ringe nach Winkel ausgelenkt. */
function treadTire(r, w) {
  const prof = [[0.62, -0.5], [0.86, -0.52], [0.95, -0.44], [0.985, -0.3], [1, -0.12], [1, 0.12], [0.985, 0.3], [0.95, 0.44], [0.86, 0.52], [0.62, 0.5]];
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(r * x, w * y)), 48);
  const P = g.attributes.position;
  const lugs = 16;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), rad = Math.hypot(x, z);
    if (rad < r * 0.94) continue;
    const a = Math.atan2(z, x), side = y < 0 ? 0 : 0.5;
    const on = Math.sin((a * lugs) / 1 + side * PI * 2 + (Math.abs(y) > w * 0.25 ? 0.6 : 0)) > 0 ? 1 : 0;
    const k = (rad + on * r * 0.045) / rad;
    P.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** env-look: Geländewagen – Seilwinde, Abschleppösen, Blinker, Scheinwerferringe, Wischer, Außenspiegel, Antenne,
 * Trittbretter, Kotflügelverbreiterungen, Rammschutz, Planenrolle, Schmutzfänger; high: Munitionskisten, Spaten,
 * Anhängerkupplung, Scheinwerfergitter. Nur HQ (medium+). */
function jeepDetail(B, S, paint, lod, seg) {
  const D = VEHICLES.jeep;
  if (lod < 2) {
    for (const sx of [-1, 1]) {
      B.add(box(0.06, 0.06, 1.6), paint, [sx * 0.96, 0.66, 0.35]);                  // Trittbrett
      B.add(box(0.08, 0.06, 1.1), S.rubber, [sx * 1.0, 1.0, -1.47]);               // Kotflügelverbreiterung
      B.add(box(0.07, 0.05, 0.04), S.lensOff, [sx * 0.88, 0.86, -2.4]);             // Blinker
    }
    B.add(cyl(0.09, 0.09, 0.62, Math.max(8, seg >> 1)), S.dark, [0, 0.56, -2.62], [0, 0, HP]); // Seilwinde
  }
  if (lod === 0) {
    for (const sx of [-1, 1]) B.add(new THREE.TorusGeometry(0.06, 0.016, 4, 10), S.dark, [sx * 0.62, 0.48, -2.6], [0, HP, 0]); // Ösen
    for (const L of D.lights) B.add(new THREE.TorusGeometry(0.125, 0.015, 4, 16), S.dark, [L[0], L[1], L[2] - 0.03]);
    for (const sx of [-1, 1]) {
      B.add(box(0.5, 0.012, 0.02), S.dark, [sx * 0.42, 1.31, -0.96], [0, 0, sx * 0.25]); // Wischer
      B.add(cyl(0.01, 0.01, 0.3, 4), S.dark, [sx * 0.98, 1.62, -0.92], [0, 0, sx * 1.1]); // Spiegelarm
      B.add(box(0.03, 0.16, 0.12), S.dark, [sx * 1.1, 1.7, -0.92]);
      B.add(box(0.005, 0.13, 0.1), S.glass, [sx * 1.118, 1.7, -0.92]);
    }
    B.add(cyl(0.008, 0.008, 1.8, 4), S.dark, [-0.86, 2.0, 2.1]);                     // Antenne
    B.add(cyl(0.03, 0.035, 0.08, 6), S.dark, [-0.86, 1.1, 2.1]);
  }
  // Rammschutz vor dem Grill, Planenrolle auf der Heckwand, Schmutzfänger hinten
  if (lod < 2) {
    const rs = lod === 0 ? 8 : 5;
    for (const sx of [-1, 1]) B.add(cyl(0.025, 0.025, 0.62, rs), S.dark, [sx * 0.42, 0.9, -2.6]);
    for (const y of [0.74, 1.18]) B.add(cyl(0.025, 0.025, 0.9, rs), S.dark, [0, y, -2.6], [0, 0, HP]);
    B.add(cyl(0.085, 0.085, 1.5, lod === 0 ? 10 : 6), S.canvas, [0, 1.43, 2.1], [0, 0, HP]);
    for (const sx of [-1, 1]) B.add(box(0.32, 0.34, 0.02), S.rubber, [sx * 0.86, 0.56, 1.92]);
  }
  if (lod === 0 && DET === 2) {
    // Gurte der Planenrolle, Munitionskisten neben dem MG-Sockel, Spaten am Seitenblech, Anhängerkupplung,
    // Schutzgitter der Scheinwerfer, Haubenverschlüsse
    for (const x of [-0.5, 0.5]) B.add(box(0.04, 0.19, 0.19), S.dark, [x, 1.43, 2.1]);
    for (const sx of [-1, 1]) { B.add(box(0.3, 0.2, 0.18), S.dark, [sx * 0.42, 1.02, 0.95]); B.add(box(0.06, 0.03, 0.12), S.dark, [sx * 0.42, 1.135, 0.95]); }
    B.add(cyl(0.016, 0.016, 0.9, 6), S.canvas, [0.97, 1.16, 0.75], [HP, 0, 0]);
    B.add(box(0.02, 0.2, 0.16), S.dark, [0.97, 1.16, 1.26]);
    B.add(box(0.14, 0.08, 0.16), S.dark, [0, 0.56, 2.4]);
    B.add(new THREE.TorusGeometry(0.045, 0.014, 4, 8), S.dark, [0, 0.56, 2.5], [HP, 0, 0]);
    for (const L of D.lights) for (const dx of [-0.07, 0, 0.07]) B.add(box(0.012, 0.24, 0.012), S.dark, [L[0] + dx, L[1], L[2] - 0.1]);
    for (const sx of [-1, 1]) B.add(box(0.05, 0.06, 0.08), S.dark, [sx * 0.82, 1.12, -1.7]);
  }
}

function buildJeep(lod, S, team) {
  CUR_LOD = lod;
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
  // Sitze, Lenkrad (env-look LOD0: gepolsterte Kissen mit gerundeten Kanten)
  const seat = (w, h, d, pos, rot) => {
    if (HQ && lod === 0) { const g = topExtrude([[-w / 2 + 0.04, d / 2 - 0.04], [w / 2 - 0.04, d / 2 - 0.04], [w / 2 - 0.04, -d / 2 + 0.04], [-w / 2 + 0.04, -d / 2 + 0.04]], h - 0.08, true); g.translate(0, -h / 2 + 0.04, 0); B.add(g, S.canvas, pos, rot); }
    else B.add(box(w, h, d), S.canvas, pos, rot);
  };
  for (const sx of [-1, 1]) {
    seat(0.5, 0.14, 0.5, [sx * 0.46, 1.0, -0.1]);
    seat(0.5, 0.56, 0.1, [sx * 0.46, 1.3, 0.18], [-0.12, 0, 0]);
  }
  seat(1.5, 0.14, 0.5, [0, 1.0, 1.6]);
  seat(1.5, 0.5, 0.1, [0, 1.28, 1.9], [-0.1, 0, 0]);
  if (lod < 2) {
    B.add(new THREE.TorusGeometry(0.18, 0.022, 6, seg), S.dark, [-0.46, 1.48, -0.6], [-0.95, 0, 0]);
    B.add(cyl(0.022, 0.022, 0.5, 6), S.dark, [-0.46, 1.32, -0.75], [-0.95 + HP, 0, 0]);
  }
  // MG-Sockel
  B.add(cyl(0.06, 0.08, 0.9, 10), S.dark, [D.mgPivot[0], 1.42, D.mgPivot[2]]);
  // Ersatzrad, Kanister
  if (lod < 2) {
    B.add(tireGeometry(0.4, 0.28, seg, HQ && lod === 0), S.rubber, [0.45, 1.25, 2.33], [HP, 0, 0]);
    B.add(cyl(0.24, 0.24, 0.29, seg), S.dark, [0.45, 1.25, 2.33], [HP, 0, 0]);
  }
  if (lod === 0) for (const sx of [-1, 1]) B.add(box(0.16, 0.44, 0.32), sx < 0 ? paint : S.dark, [sx * -0.55 - 0.1, 1.2, 2.3]);
  // Kennung
  B.add(cyl(0.24, 0.24, 0.015, seg), mark, [0, 1.165, -1.62], [0.05, 0, 0]);
  B.add(cyl(0.15, 0.15, 0.015, seg), mark, [-0.5, 1.12, 2.186], [HP, 0, 0]);
  if (HQ) jeepDetail(B, S, paint, lod, seg);
  B.build(hull, { shadow: true });
  if (HQ && lod < 2) {
    const MK = new Bucket();
    for (const sx of [-1, 1]) MK.add(new THREE.PlaneGeometry(0.5, 0.125), markingMaterial(team), [sx * 0.866, 0.95, -1.62], [0, sx * HP, 0], null, { keepUV: true });
    MK.build(hull, { shadow: false });
  }
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
  M.build(mgLod, { shadow: lod < 2, off: D.mgPivot });
  mg.add(mgLod);

  // Räder (eigene Drehpunkte)
  const wheels = [];
  const W = D.wheels;
  W.z.forEach((z, axle) => {
    for (const sx of [-1, 1]) {
      const spin = new THREE.Group();
      const R = new Bucket();
      R.add(tireGeometry(W.radius, 0.32, seg, HQ && lod === 0), S.rubber, null, [0, 0, HP]);
      R.add(cyl(0.25, 0.25, 0.3, seg), S.dark, null, [0, 0, HP]);
      if (lod === 0) R.add(cyl(0.08, 0.08, 0.34, 8), paint, null, [0, 0, HP]);
      if (HQ && lod === 0) {
        // Felgenring + Radmuttern (außen)
        R.add(new THREE.TorusGeometry(0.22, 0.02, 4, 18), S.dark, [sx * 0.155, 0, 0], [0, HP, 0]);
        for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; R.add(box(0.03, 0.03, 0.03), S.dark, [sx * 0.175, Math.sin(a) * 0.12, Math.cos(a) * 0.12]); }
      }
      R.build(spin, { shadow: true, off: [sx * W.x, W.radius, z] });
      wheels.push({ spin, axle, side: sx, x: sx * W.x, z });
    }
  });
  return { hull, mg, wheels };
}

/* -------------------------------------------------------------- Besatzung: Luken, Turm-Innenraum */

// Rückfall, falls data.js (noch) keine Lage liefert (panzer-mp.md §B.1)
const HATCH_DEF = {
  driver: { space: 'hull', pos: [-0.55, 1.65, -2.35], r: 0.34 },
  commander: { space: 'turret', pos: [-0.62, 1.03, 0.62], r: 0.38 },
  loader: { space: 'turret', pos: [0.6, 0.83, 0.55], r: 0.3 },
};
const INTERIOR_DEF = { breech: [0, 0.42, -0.55], rack: [0, 0.45, 1.55], loaderEye: [0.55, 0.62, 0.35] };
/** Scharnier je Luke: Achse und Drehsinn (offen = +HATCH_OPEN um die Achse). Fahrer und Kommandant hinten
 * (Deckel stellt sich hinter dem Kopf auf), Ladeschütze außen rechts. */
const HATCH_HINGE = { driver: { axis: 'x', sign: 1, side: [0, 0, 1] }, commander: { axis: 'x', sign: 1, side: [0, 0, 1] }, loader: { axis: 'z', sign: -1, side: [1, 0, 0] } };
const HATCH_OPEN = 1.8; // ≈ 103°
const HATCH_LIFT = 0.01; // Deckel liegt 1 cm über dem festen Deckel bzw. Lukenring (kein Z-Fighting)

/** Bewegliche Luke: Gruppe am Scharnier (Drehpunkt), ein Netz (Lack). ≤ 100 Dreiecke. */
function buildHatch(id, def, S, paint, base = null) {
  const H = HATCH_HINGE[id], r = def.r, h = 0.05, seg = DET === 2 ? 16 : 12;
  const pivot = new THREE.Group();
  pivot.name = `hatch:${id}`;
  // Scharnierkante: Lukenmitte + r in Richtung side, auf der Unterkante des Deckels
  pivot.position.set(def.pos[0] + H.side[0] * r, def.pos[1] + HATCH_LIFT, def.pos[2] + H.side[2] * r);
  const c = [-H.side[0] * r, h / 2, -H.side[2] * r]; // Deckelmitte relativ zum Scharnier
  const B = new Bucket();
  B.add(cyl(r, r * 0.96, h, seg), paint, c);
  // Scharnierblock, Griff, (high) Versteifungsrippe quer zum Scharnier
  const along = H.axis === 'x';
  B.add(box(along ? r * 0.7 : 0.08, 0.06, along ? 0.08 : r * 0.7), paint, [H.side[0] * 0.02, 0.03, H.side[2] * 0.02]);
  B.add(box(along ? 0.16 : 0.03, 0.03, along ? 0.03 : 0.16), paint, [c[0] * 1.55, h + 0.015, c[2] * 1.55]);
  if (DET === 2) B.add(box(along ? 0.05 : r * 1.5, 0.025, along ? r * 1.5 : 0.05), paint, [c[0], h + 0.012, c[2]]);
  B.build(pivot, { shadow: true, off: [pivot.position.x + (base ? base[0] : 0), pivot.position.y + (base ? base[1] : 0), pivot.position.z + (base ? base[2] : 0)] });
  pivot.userData.hatch = { id, axis: H.axis, sign: H.sign };
  return pivot;
}

/** Geschlossene Körper nach innen kehren (Wicklung + Normalen) – Innenraum-Hülle mit Vorderseiten-Material. */
function inward(geom) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  if (g !== geom) geom.dispose();
  for (const name of Object.keys(g.attributes)) {
    const A = g.attributes[name], n = A.itemSize, a = A.array;
    for (let t = 0; t < A.count; t += 3) for (let k = 0; k < n; k++) {
      const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k, tmp = a[i1];
      a[i1] = a[i2]; a[i2] = tmp;
    }
  }
  const N = g.attributes.normal;
  if (N) for (let i = 0; i < N.array.length; i++) N.array[i] = -N.array[i];
  return g;
}

/** Granate (Spitze zeigt nach −Z, Boden bei z = 0) mit Vertex-Farben. full: ganze Patrone (in der Hand),
 * sonst nur der sichtbare Vorderteil im Gestell. Farben: PG schwarz/gold, SG oliv/gelb. */
const SHELL_COL = {
  mbt_ap: { body: 0x17181a, band: 0xc19a3a, nose: 0x1d1e20, tip: 0x6a5524, len: 0.2, tipR: 0.008 },
  mbt_he: { body: 0x4b5233, band: 0xd9b52a, nose: 0x4b5233, tip: 0x6f6a58, len: 0.15, tipR: 0.022 },
};
const _col = new THREE.Color();
function shellGeometry(type, n, { full = false, band = true, body = true } = {}) {
  const C = SHELL_COL[type] || SHELL_COL.mbt_ap, R = 0.06, parts = [];
  const part = (g, hexA, hexB = hexA, z0 = 0) => {
    // Zylinder liegt entlang Y → nach −Z drehen; Farbe unten (Boden) hexA, oben (Spitze) hexB
    g.rotateX(-HP);
    g.translate(0, 0, z0);
    const P = g.attributes.position, col = new Float32Array(P.count * 3);
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < P.count; i++) { zmin = Math.min(zmin, P.getZ(i)); zmax = Math.max(zmax, P.getZ(i)); }
    const a = new THREE.Color().setHex(hexA), b = new THREE.Color().setHex(hexB);
    for (let i = 0; i < P.count; i++) {
      const k = zmax > zmin ? (zmax - P.getZ(i)) / (zmax - zmin) : 0;
      _col.copy(a).lerp(b, k);
      col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  let z = 0;
  if (full) {
    if (DET > 0) part(new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.03, n), 0xa98a45, 0xa98a45, -0.015); // Bodenstück (Messing)
    part(new THREE.CylinderGeometry(R + 0.002, R + 0.002, 0.55, n), 0x8b7c57, 0x8b7c57, -0.305); // Treibladung (Hülse)
    z = -0.58;
  }
  // Geschossrumpf, Ring, Haube (offen – der Boden steckt im Gestell bzw. in der Hülse)
  if (body) part(new THREE.CylinderGeometry(R, R, 0.06, n, 1, true), C.body, C.body, z - 0.03);
  if (band) part(new THREE.CylinderGeometry(R + 0.002, R + 0.002, 0.025, n, 1, true), C.band, C.band, z - 0.0725);
  const zb = z - (band ? 0.085 : body ? 0.06 : 0);
  part(new THREE.CylinderGeometry(C.tipR, R, C.len, n, 1, true), band ? C.nose : C.band, C.tip, zb - C.len / 2);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/**
 * Turm-Innenraum (Ladeschützen-Sicht, panzer-mp.md §D.2): Hülle nach innen gekehrt, Bodenplatte, Munitionsgestell im
 * Turmheck (je Sorte ein Netz, Sichtbarkeit über drawRange), Granate in der Hand, Lampe, Haltegriffe; Verschluss mit
 * Keil als eigene Gruppe am Rohr. Alles unsichtbar, keine Schatten.
 */
function buildInterior(S, D) {
  const I = Object.assign({}, INTERIOR_DEF, D.interior || {});
  const ammo = Object.assign({ mbt_ap: 22, mbt_he: 18 }, D.ammo || {});
  const n = DET === 2 ? 8 : DET === 1 ? 6 : 5;
  const grp = new THREE.Group();
  grp.name = 'interior';
  grp.visible = false;
  // Hülle: Grundriss des Turms nach innen versetzt (Stirn dick gepanzert), Boden 6 cm über dem Turmring
  const B = new Bucket();
  const foot = [[-0.9, 1.15], [0.9, 1.15], [1.24, 0.8], [1.25, -1.45], [0.9, -1.92], [-0.9, -1.92], [-1.25, -1.45], [-1.24, 0.8]];
  B.add(inward(topExtrude(foot, 0.69)), S.cabin, [0, 0.06, 0]);
  B.add(box(1.5, 0.02, 1.3), S.dark, [0.15, 0.07, 0.3]);                          // Bodenplatte
  B.add(box(0.74, 0.62, 0.03), S.dark, [0, 0.42, -1.135]);                         // Rahmen der Rohrdurchführung
  // Richtschützenplatz (rechts vorn), Kommandantenplatz (links), Funkgerät (links hinten)
  B.add(box(0.36, 0.3, 0.32), S.dark, [0.8, 0.5, -0.85]);
  B.add(box(0.2, 0.28, 0.46), S.dark, [-1.12, 0.48, 0.95]);
  if (DET > 0) {
    B.add(box(0.12, 0.1, 0.16), S.rubber, [0.8, 0.6, -0.65]);
    B.add(box(0.4, 0.06, 0.38), S.canvas, [-0.62, 0.3, 0.55]);
    B.add(box(0.4, 0.24, 0.05), S.canvas, [-0.62, 0.45, 0.76], [-0.12, 0, 0]);
  }
  // Munitionsgestell: Rahmen um die Granatenböden
  const rk = I.rack, rw = 1.62, rz0 = rk[2] - 0.36;
  B.add(box(rw, 0.035, 0.76), S.dark, [rk[0], rk[1] - 0.29, rk[2]]);
  B.add(box(rw, 0.035, 0.76), S.dark, [rk[0], rk[1] + 0.29, rk[2]]);
  for (const sx of [-1, 1]) B.add(box(0.035, 0.6, 0.76), S.dark, [rk[0] + sx * rw / 2, rk[1], rk[2]]);
  B.add(box(rw, 0.56, 0.02), S.dark, [rk[0], rk[1], rz0 + 0.02]);                   // Lochplatte (Granaten stecken darin)
  // Lampe (leuchtet, kein echtes Licht) + Haltegriffe am Dach
  B.add(box(0.16, 0.04, 0.08), S.dark, [0.15, 0.735, 0.1]);
  B.add(box(0.12, 0.02, 0.05), S.lensOn, [0.15, 0.71, 0.1]);
  for (const [x, z] of DET === 2 ? [[0.55, -0.15], [0.95, 0.4], [-0.25, 0.95]] : DET === 1 ? [[0.55, -0.15], [0.95, 0.4]] : [[0.95, 0.4]]) {
    B.add(box(0.03, 0.03, 0.26), S.dark, [x, 0.67, z]);
    if (DET === 2) for (const dz of [-0.12, 0.12]) B.add(box(0.025, 0.07, 0.025), S.dark, [x, 0.715, z + dz]);
  }
  B.build(grp, { shadow: false });
  // Granaten im Gestell: Spalten von links (PG) nach rechts (SG), je Spalte von unten nach oben
  const rows = DET === 0 ? 3 : 4, cols = DET === 0 ? 8 : 10;
  const dx = DET === 0 ? 0.19 : 0.155, dy = DET === 0 ? 0.17 : 0.135;
  const slots = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) slots.push([rk[0] + (c - (cols - 1) / 2) * dx, rk[1] + (r - (rows - 1) / 2) * dy, rz0]);
  const nAp = Math.min(ammo.mbt_ap, Math.round(slots.length * ammo.mbt_ap / (ammo.mbt_ap + ammo.mbt_he)));
  const sets = { mbt_ap: slots.slice(0, nAp), mbt_he: slots.slice(nAp) };
  for (const type of ['mbt_ap', 'mbt_he']) {
    const list = sets[type];
    if (!list.length) continue;
    const proto = shellGeometry(type, n, { band: DET === 2, body: DET > 0 });
    const per = proto.attributes.position.count;
    const geoms = list.map((p) => proto.clone().translate(p[0], p[1], p[2]));
    proto.dispose();
    const g = mergeGeometries(geoms, false);
    for (const x of geoms) x.dispose();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, S.shell);
    mesh.name = `rack:${type}`;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.rack = type; mesh.userData.per = per; mesh.userData.slots = list.length; mesh.userData.shown = list.length;
    grp.add(mesh);
  }
  // Granate in den Händen: vor der Ladeschützen-Kamera, leicht unten, Spitze Richtung Verschluss
  const held = new THREE.Group();
  held.name = 'held';
  held.visible = false;
  const eye = I.loaderEye;
  held.position.set(eye[0] - 0.12, eye[1] - 0.36, eye[2] - 0.15);
  held.rotation.set(-0.12, 0.08, 0);
  for (const type of ['mbt_ap', 'mbt_he']) {
    const g = shellGeometry(type, n, { full: true, band: DET > 0 });
    g.translate(0, 0, 0.4);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, S.shell);
    m.name = `held:${type}`;
    m.castShadow = false; m.receiveShadow = false;
    held.add(m);
  }
  grp.add(held);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  // Verschluss (Kind des Rohrs, folgt der Rohrerhöhung): Bodenstück, Keil (fährt nach unten), Rücklaufschutz
  const br = new THREE.Group();
  br.name = 'breech';
  br.visible = false;
  br.position.set(I.breech[0] - D.gunPivot[0], I.breech[1] - D.gunPivot[1], I.breech[2] - D.gunPivot[2]);
  const V = new Bucket();
  V.add(box(0.5, 0.48, 0.42), S.steel, [0, 0, 0]);                                 // Bodenstück
  V.add(box(0.58, 0.5, 0.36), S.cabin, [0, 0.02, -0.42]);                           // Wiege
  if (DET === 2) V.add(cyl(0.2, 0.22, 0.2, 12, true), S.steel, [0, 0, -0.3], [HP, 0, 0]); // Verschlussring
  V.add(cyl(0.085, 0.085, 0.03, DET === 2 ? 12 : 8, true), S.rubber, [0, 0, 0.205], [HP, 0, 0]); // Ladeöffnung (dunkel)
  V.add(box(0.15, 0.15, 0.01), S.rubber, [0, 0, 0.214]);
  if (DET > 0) {
    for (const sx of [-1, 1]) {
      V.add(box(0.035, 0.035, 0.75), S.cabin, [sx * 0.33, -0.12, 0.5]);            // Rücklaufschutz
      if (DET === 2) V.add(cyl(0.045, 0.045, 0.6, 8, true), S.dark, [sx * 0.2, 0.3, -0.3], [HP, 0, 0]); // Rohrbremsen
    }
    V.add(box(0.7, 0.035, 0.035), S.cabin, [0, -0.12, 0.86]);
    V.add(box(0.66, 0.3, 0.02), S.cabin, [0, -0.29, 0.86]);                         // Hülsenfangblech
  }
  V.build(br, { shadow: false });
  const keil = new THREE.Group();
  keil.name = 'breech:keil';
  keil.position.set(0, 0, 0.235);
  const K = new Bucket();
  K.add(box(0.42, 0.44, 0.06), S.steel, [0, 0, 0]);
  K.add(box(0.06, 0.04, 0.1), S.rubber, [0.16, 0.12, 0.06]);                        // Griff
  K.build(keil, { shadow: false });
  br.add(keil);
  br.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { interior: grp, breech: br };
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
  HQ = quality !== 'low';
  DET = quality === 'low' ? 0 : quality === 'medium' ? 1 : 2;
  applyVehicleLook(quality); // Tarnung/Schlamm/Staub (nur medium+; low entfernt den Haken)
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
    // Besatzung: bewegliche Luken (außerhalb der LOD-Stufen, Nahstufen-Details), Innenraum + Verschluss (unsichtbar)
    CUR_LOD = 0;
    const paint = S.paint[team] || S.paint.null;
    for (const id of ['driver', 'commander', 'loader']) {
      const d = (D.hatches && D.hatches[id]) || {};
      const def = { space: d.space || HATCH_DEF[id].space, pos: d.pos || HATCH_DEF[id].pos, r: d.r || HATCH_DEF[id].r };
      const inTur = def.space === 'turret';
      (inTur ? tur : root).add(buildHatch(id, def, S, paint, inTur ? D.turretPivot : null));
    }
    const crew = buildInterior(S, D);
    tur.add(crew.interior);
    gun.add(crew.breech);
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
      pivot.position.set(w0.x, my - (D.wheels.rest - staticComp(D)), w0.z);
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
  const hq = quality !== 'low';
  const tm = [trackMaterial(hq), trackMaterial(hq)];
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
  else for (const m of tm) { m.map.dispose(); m.normalMap?.dispose(); m.dispose(); }

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
        if (base === S.glass || base === S.optic || o.userData.lens) { o.visible = false; continue; }
        o.material = S.wreck;
      } else { o.visible = true; o.material = base; }
    }
    if (on) {
      model.setLights(false);
      for (const id of Object.keys(model.hatches)) model.setHatch(id, 0);
      model.setInterior(false);
      model.setHeld(null);
    } else applyRack();
  };
  /** Kettenlauf: Geschwindigkeit links/rechts (m/s) über dt. */
  model.scrollTracks = (vl, vr, dt) => {
    for (let i = 0; i < model.trackMats.length; i++) {
      const v = i === 0 ? vl : vr;
      const t = model.trackMats[i].map;
      t.offset.x = (t.offset.x - (v * dt * model.trackK[i]) / model.trackLen[i]) % 1;
      if (model.trackMats[i].normalMap) model.trackMats[i].normalMap.offset.x = t.offset.x;
    }
  };
  // Besatzung (panzer-mp.md §3.7): Luken, Innenraum, Verschluss, Gestell, Granate in der Hand – nur KP-1
  model.hatches = {};
  for (const id of ['driver', 'commander', 'loader']) { const h = root.getObjectByName(`hatch:${id}`); if (h) model.hatches[id] = h; }
  model.interior = (model.turret && model.turret.getObjectByName('interior')) || null;
  model.breech = (model.gun && model.gun.getObjectByName('breech')) || null;
  const keil = model.breech ? model.breech.getObjectByName('breech:keil') : null;
  const held = model.interior ? model.interior.getObjectByName('held') : null;
  const racks = [];
  if (model.interior) model.interior.traverse((o) => { if (o.isMesh && o.userData.rack) racks.push({ mesh: o, type: o.userData.rack, per: o.userData.per, slots: o.userData.slots, own: false }); });
  const want = { mbt_ap: Infinity, mbt_he: Infinity };
  const clamp01 = (t) => Math.max(0, Math.min(1, Number(t) || 0));
  /** Sichtbare Granaten anwenden – eigene Geometriekopie erst, wenn weniger als alle gezeigt werden und der
   * Innenraum sichtbar ist (fremde Panzer teilen weiter die Vorlage). */
  const applyRack = () => {
    for (const R of racks) {
      const n = Math.max(0, Math.min(R.slots, Math.floor(want[R.type] ?? R.slots)));
      R.mesh.userData.shown = n;
      R.mesh.visible = n > 0;
      if (n < R.slots && !R.own) {
        if (!model.interior.visible) continue;
        R.mesh.geometry = R.mesh.geometry.clone();
        R.own = true;
      }
      if (R.own) R.mesh.geometry.setDrawRange(0, n * R.per);
    }
  };
  model.setHatch = (id, t) => {
    const h = model.hatches[id];
    if (!h) return;
    const H = h.userData.hatch, a = (model.wrecked ? 0 : clamp01(t)) * HATCH_OPEN * H.sign;
    h.rotation.set(H.axis === 'x' ? a : 0, 0, H.axis === 'z' ? a : 0);
  };
  model.setInterior = (on) => {
    if (!model.interior) return;
    const v = !!on && !model.wrecked;
    model.interior.visible = v;
    if (model.breech) model.breech.visible = v;
    if (v) applyRack();
  };
  model.setBreech = (t) => { if (keil) keil.position.y = -0.3 * clamp01(t); };
  model.setRack = (counts) => {
    if (!racks.length || !counts) return;
    for (const k of ['mbt_ap', 'mbt_he']) if (counts[k] != null) want[k] = Number(counts[k]) || 0;
    applyRack();
  };
  model.setHeld = (type) => {
    if (!held) return;
    held.visible = !!type;
    for (const c of held.children) c.visible = c.name === `held:${type}`;
  };
  model.dispose = () => {
    root.removeFromParent();
    for (const R of racks) if (R.own) { R.mesh.geometry.dispose(); R.own = false; }
    for (const m of model.trackMats) { m.map.dispose(); m.normalMap?.dispose(); m.dispose(); }
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

/** Dreiecke der Besatzungsteile außerhalb der LOD-Stufen (Prüfung/Budget §D.3): Luken, Innenraum inkl. Verschluss. */
export function vehicleExtraTriangles(type, quality = 'high') {
  const tpl = template(type, 'A', quality);
  const out = { hatches: 0, interior: 0 };
  const count = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
  tpl.traverse((o) => {
    if (o.name.startsWith('hatch:')) out.hatches += count(o);
    else if (o.name === 'interior' || o.name === 'breech') out.interior += count(o);
  });
  out.hatches = Math.round(out.hatches); out.interior = Math.round(out.interior);
  return out;
}
