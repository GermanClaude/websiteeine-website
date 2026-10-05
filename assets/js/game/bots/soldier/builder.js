// NULLPUNKT — Geometrie-Baukasten für Soldaten: Grundformen (gedrehte Profile, abgerundete Quader,
// Ellipsoide, Zylinder) im Modellraum der Bindepose, je Teil einem Knochen starr zugeordnet.
// build() fügt alles zu EINER indizierten Geometrie zusammen → ein Draw Call pro Soldat und LOD.
//
// Attribute (quantisiert, ≈ 42 B je Vertex statt 84 B):
//   position Float32×3 · normal Int8×3 (normiert) · uv Float32×2 in METERN (gedrehte Teile: abgewickelte
//   Mantelkoordinaten, Quader: Box-Projektion) · color Uint8×3 (normiert, linear) · aNp Uint8×4 (normiert:
//   Tarnmuster-Anteil, Gewebe-Detail, Leuchtanteil, Glanz) · aNq Uint8×4 (roh: Palettenplatz, Materialklasse,
//   Abnutzung 0..255, Teil-Zufall 0..255) · skinIndex Uint8×4 · skinWeight Uint8×4 (normiert).
// Farben sind vom Farbschema unabhängig: Teile mit Palettenplatz (`pal`) tragen nur einen Helligkeitsfaktor,
// die Schemafarbe kommt als Uniform aus dem Material → eine Geometrie je Variante × LOD für alle Schemata.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BONE } from './rig.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const TAU = Math.PI * 2;

/** Palettenplätze (Schemafarben im Material, Index 0 = Vertexfarbe direkt). */
export const PALETTE = ['', 'gear', 'gear2', 'strap', 'helmet', 'glove', 'boot', 'metal', 'accent'];
export const PAL = Object.fromEntries(PALETTE.map((n, i) => [n, i]));
/** Materialklassen (Detailtextur-Maßstab, Normalenstärke, Kavität, Rauheit – siehe materials.js CLASS_PARAMS). */
export const CLASSES = ['cloth', 'gear', 'skin', 'hard', 'leather', 'glass'];
export const CLS = Object.fromEntries(CLASSES.map((n, i) => [n, i]));

/** Maßstab der eingebauten UV-Koordinaten in Metern merken (xf skaliert mit). */
function nuv(geo, su, sv) {
  geo.userData.npUv = [su, sv];
  return geo;
}

/** Transformation anwenden: { p:[x,y,z], r:[x,y,z] (Euler XYZ), s:[x,y,z] | Zahl }. */
export function xf(geo, { p, r, s } = {}) {
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'XYZ');
  _q.setFromEuler(_e);
  if (s == null) _s.set(1, 1, 1); else if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  _p.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  const u = geo.userData.npUv;
  if (u && s != null) { u[0] *= (Math.abs(_s.x) + Math.abs(_s.z)) / 2; u[1] *= Math.abs(_s.y); }
  return geo;
}

/**
 * Gliedmaße/Rumpfsegment entlang Y (gedrehtes Profil): Radius rBot unten (yBot) → rTop oben (yTop),
 * optional halbkugelige Kappen, Muskelwölbung bulge (Anteil) bei bulgeAt (0..1 von unten).
 * opts: { seg, rings, caps: [unten, oben], bulge, bulgeAt, sx, sz, x, z }
 */
export function limb(yBot, yTop, rBot, rTop, { seg = 10, rings = 4, caps = [true, true], bulge = 0, bulgeAt = 0.6, sx = 1, sz = 1, x = 0, z = 0, capRings = 3 } = {}) {
  const pts = [];
  const cr = Math.max(1, capRings);
  if (caps[0]) for (let i = 0; i < cr; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / cr);
    pts.push([Math.max(1e-4, rBot * Math.cos(a)), yBot + rBot * Math.sin(a) * 0.85]);
  } else pts.push([1e-4, yBot], [rBot * 0.98, yBot]);
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const b = 1 + bulge * Math.exp(-((t - bulgeAt) ** 2) / 0.06);
    pts.push([(rBot + (rTop - rBot) * t) * b, yBot + (yTop - yBot) * t]);
  }
  if (caps[1]) for (let i = 1; i <= cr; i++) {
    const a = (Math.PI / 2) * (i / cr);
    pts.push([Math.max(1e-4, rTop * Math.cos(a)), yTop + rTop * Math.sin(a) * 0.85]);
  } else pts.push([rTop * 0.98, yTop], [1e-4, yTop]);
  const g = lathe(pts, seg);
  if (sx !== 1 || sz !== 1 || x || z) xf(g, { p: [x, 0, z], s: [sx, 1, sz] });
  return g;
}

/**
 * Beliebiges Drehprofil [[r, y], …] (von unten nach oben). UV in Metern: u = Umfang (mittlerer Radius),
 * v = Bogenlänge entlang des Profils → Stoffmuster laufen ohne Nähte und Verzerrung um Arme/Beine/Rumpf.
 */
export function lathe(profile, seg = 10, opts = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
  const g = new THREE.LatheGeometry(pts, seg);
  const n = pts.length;
  const arc = new Float32Array(n);
  let rSum = 0, wSum = 0;
  for (let j = 1; j < n; j++) {
    const l = pts[j].distanceTo(pts[j - 1]);
    arc[j] = arc[j - 1] + l;
    rSum += (pts[j].x + pts[j - 1].x) * 0.5 * l; wSum += l;
  }
  const rMean = wSum > 0 ? rSum / wSum : pts[0].x;
  const uv = g.attributes.uv;
  for (let i = 0; i <= seg; i++) for (let j = 0; j < n; j++) {
    const k = i * n + j;
    if (k < uv.count) uv.setXY(k, (i / seg) * TAU * rMean, arc[j]);
  }
  nuv(g, 1, 1);
  return xf(g, opts);
}

/** Abgerundeter Quader (seg 0 → einfacher Quader). UV: Box-Projektion beim Zusammenbau. */
export function rbox(w, h, d, r, seg, opts = {}) {
  const g = seg > 0 && r > 0.002
    ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4))
    : new THREE.BoxGeometry(w, h, d);
  return xf(g, opts);
}

/** Ellipsoid (optional Kugelausschnitt über phi/theta). */
export function ellipsoid(rx, ry, rz, ws = 12, hs = 8, opts = {}, { phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI } = {}) {
  const g = new THREE.SphereGeometry(1, ws, hs, phiStart, phiLength, thetaStart, thetaLength);
  g.scale(rx, ry, rz);
  nuv(g, phiLength * (rx + rz) * 0.5, thetaLength * ry);
  return xf(g, opts);
}

export function cyl(rTop, rBot, h, seg = 10, opts = {}, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  nuv(g, TAU * (rTop + rBot) * 0.5, h);
  return xf(g, opts);
}

export function torus(r, tube, rs = 6, ts = 12, opts = {}, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(r, tube, rs, ts, arc);
  nuv(g, arc * r, TAU * tube);
  return xf(g, opts);
}

/* ------------------------------------------------------------------ Zusammenbau */

const hash01 = (n) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/**
 * Umgebungsverdeckung je Vertex backen (Bindepose). Belegungsgitter (Zellmaß cell) aus allen Dreiecksflächen, je
 * Vertex `dirs` kosinusgewichtete Strahlen in die Halbkugel um die Normale, je Strahl wenige Schritte bis `reach`.
 * Ein naher Treffer verdeckt stärker als ein ferner. → Uint8Array (255 = frei). Kosten: LOD0 ≈ 5–15 ms einmalig.
 */
export function bakeVertexAO(pos, nor, idx, nIdx, { cell = 0.022, dirs = 10, reach = 0.2, strength = 0.85 } = {}) {
  const nv = pos.length / 3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  const pad = reach + cell * 2;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const inv = 1 / cell;
  const gx = Math.ceil((x1 - x0) * inv) + 1, gy = Math.ceil((y1 - y0) * inv) + 1, gz = Math.ceil((z1 - z0) * inv) + 1;
  const grid = new Uint8Array(gx * gy * gz);
  const mark = (x, y, z) => {
    const i = ((x - x0) * inv) | 0, j = ((y - y0) * inv) | 0, k = ((z - z0) * inv) | 0;
    grid[(k * gy + j) * gx + i] = 1;
  };
  // Flächen rastern (baryzentrisch, Schrittweite ≤ halbe Zelle)
  for (let t = 0; t < nIdx; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b] - ax, by = pos[b + 1] - ay, bz = pos[b + 2] - az;
    const cx = pos[c] - ax, cy = pos[c + 1] - ay, cz = pos[c + 2] - az;
    const len = Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz), Math.hypot(cx - bx, cy - by, cz - bz));
    const n = Math.min(40, Math.max(1, Math.ceil(len * inv * 2)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n;
      mark(ax + bx * u + cx * v, ay + by * u + cy * v, az + bz * u + cz * v);
    }
  }
  // Richtungen (kosinusgewichtet um +Z, Fibonacci), je Vertex in die Normalenbasis gedreht
  const D = new Float32Array(dirs * 3);
  for (let i = 0; i < dirs; i++) {
    const r = Math.sqrt((i + 0.5) / dirs), phi = i * 2.399963;
    D[i * 3] = r * Math.cos(phi); D[i * 3 + 1] = r * Math.sin(phi); D[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - r * r));
  }
  const STEPS = [0.035, 0.06, 0.09, 0.13, 0.17, reach].filter((s) => s <= reach + 1e-6);
  const occ = (x, y, z) => {
    const i = ((x - x0) * inv) | 0, j = ((y - y0) * inv) | 0, k = ((z - z0) * inv) | 0;
    if (i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz) return 0;
    return grid[(k * gy + j) * gx + i];
  };
  const out = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
    let nx = nor[v * 3] / 127, ny = nor[v * 3 + 1] / 127, nz = nor[v * 3 + 2] / 127;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // Tangentenbasis: u = normalize(cross(a, n)) mit a = X (bzw. Y, wenn n fast parallel zu X)
    const tx = Math.abs(nx) < 0.9 ? 1 : 0, ty = 1 - tx;
    let ux = ty * nz, uy = -tx * nz, uz = tx * ny - ty * nx;
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    // Start knapp außerhalb der eigenen Fläche (eigene Zelle nicht treffen)
    const ox = px + nx * cell * 1.1, oy = py + ny * cell * 1.1, oz = pz + nz * cell * 1.1;
    let blocked = 0;
    for (let d = 0; d < dirs; d++) {
      const a = D[d * 3], b = D[d * 3 + 1], c = D[d * 3 + 2];
      const dx = ux * a + wx * b + nx * c, dy = uy * a + wy * b + ny * c, dz = uz * a + wz * b + nz * c;
      for (let s = 0; s < STEPS.length; s++) {
        const L = STEPS[s];
        if (occ(ox + dx * L, oy + dy * L, oz + dz * L)) { blocked += 1 - (s / STEPS.length) * 0.6; break; }
      }
    }
    const a = 1 - strength * (blocked / dirs);
    out[v] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  return out;
}

export class SkinBuilder {
  /** opts.ao: Einstellungen für bakeVertexAO (null = keine Verdeckung, z. B. ferne Stufe). */
  constructor({ ao = null } = {}) {
    this.parts = [];
    this.triangles = 0;
    this.ao = ao;
  }

  /**
   * Teil hinzufügen. o: { bone, color (Hex, direkt) | pal (Palettenplatz) + shade (sRGB-Faktor, Standard 1),
   *   camo = 0, detail = 0, emis = 0, shine = 0, cls ('cloth'|'gear'|'skin'|'hard'|'leather'|'glass'), wear = 0,
   *   mirrorBone } – mirrorBone: zusätzlich an x gespiegelt an diesen Knochen.
   */
  add(geo, o) {
    if (!geo) return;
    const bone = typeof o.bone === 'number' ? o.bone : BONE[o.bone];
    if (bone === undefined) throw new Error('Unbekannter Knochen ' + o.bone);
    const pal = o.pal ? PAL[o.pal] : 0;
    if (pal === undefined) throw new Error('Unbekannter Palettenplatz ' + o.pal);
    let r, g, b;
    if (pal) {
      // Helligkeitsfaktor (linear) / 2 → Shader multipliziert mit 2 (Faktoren bis 2 möglich)
      const f = Math.pow(o.shade ?? 1, 2.2) * 0.5;
      r = g = b = Math.min(1, f);
    } else {
      _c.set(o.color || '#ffffff');
      r = _c.r; g = _c.g; b = _c.b;
    }
    const cls = CLS[o.cls || (o.camo ? 'cloth' : 'gear')] ?? 1;
    const np = [o.camo || 0, o.detail ?? (o.camo ? 1 : 0), o.emis || 0, o.shine || 0];
    const seed = hash01(this.parts.length * 7 + bone * 131 + 17);
    const nq = [pal, cls, Math.round(Math.min(1, Math.max(0, o.wear || 0)) * 255), Math.floor(seed * 255)];
    this.parts.push({ geo, bone, r, g, b, np, nq, seed });
    if (o.mirrorBone) {
      const m = geo.clone();
      m.userData = { ...geo.userData, npUv: geo.userData.npUv ? [...geo.userData.npUv] : undefined };
      m.scale(-1, 1, 1);
      flipWinding(m);
      const mb = BONE[o.mirrorBone];
      this.parts.push({ geo: m, bone: mb, r, g, b, np, nq: [nq[0], nq[1], nq[2], (nq[3] + 97) & 255], seed: hash01(seed * 1e6 + 3) });
    }
  }

  build() {
    let nv = 0, ni = 0;
    for (const p of this.parts) {
      nv += p.geo.attributes.position.count;
      ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3);
    const nor = new Int8Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const col = new Uint8Array(nv * 3);
    const np = new Uint8Array(nv * 4);
    const nq = new Uint8Array(nv * 4);
    const si = new Uint8Array(nv * 4);
    const sw = new Uint8Array(nv * 4);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
    const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    let vo = 0, io = 0;
    for (const p of this.parts) {
      const g = p.geo;
      const P = g.attributes.position.array;
      if (!g.attributes.normal) g.computeVertexNormals();
      const N = g.attributes.normal.array;
      const U = g.userData.npUv && g.attributes.uv ? g.attributes.uv.array : null;
      const su = U ? g.userData.npUv[0] : 1, sv = U ? g.userData.npUv[1] : 1;
      // Teil-Versatz der Muster (keine gleich ausgerichteten Flecken auf benachbarten Teilen)
      const ou = p.seed * 7.31, ov = hash01(p.seed * 1e7) * 5.17;
      const n = g.attributes.position.count;
      const cr = u8(p.r), cg = u8(p.g), cb = u8(p.b);
      const n0 = u8(p.np[0]), n1 = u8(p.np[1]), n2 = u8(p.np[2]), n3 = u8(p.np[3]);
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const k = vo + i;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        nor[k * 3] = q8(nx); nor[k * 3 + 1] = q8(ny); nor[k * 3 + 2] = q8(nz);
        let u, v;
        if (U) { u = U[i * 2] * su; v = U[i * 2 + 1] * sv; } else {
          const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          if (ax >= ay && ax >= az) { u = z * Math.sign(nx || 1); v = y; }
          else if (ay >= az) { u = x; v = z; }
          else { u = -x * Math.sign(nz || 1); v = y; }
        }
        uv[k * 2] = u + ou;
        uv[k * 2 + 1] = v + ov;
        col[k * 3] = cr; col[k * 3 + 1] = cg; col[k * 3 + 2] = cb;
        np[k * 4] = n0; np[k * 4 + 1] = n1; np[k * 4 + 2] = n2; np[k * 4 + 3] = n3;
        nq[k * 4] = p.nq[0]; nq[k * 4 + 1] = p.nq[1]; nq[k * 4 + 2] = p.nq[2]; nq[k * 4 + 3] = p.nq[3];
        si[k * 4] = p.bone;
        sw[k * 4] = 255;
      }
      if (g.index) {
        const I = g.index.array;
        for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
        io += I.length;
      } else {
        for (let i = 0; i < n; i++) idx[io + i] = vo + i;
        io += n;
      }
      vo += n;
      g.dispose();
    }
    // Umgebungsverdeckung je Vertex (Kontaktschatten unter Taschen, zwischen den Beinen, unter Helm/Kragen …)
    const ao = this.ao ? bakeVertexAO(pos, nor, idx, io, this.ao) : null;
    const out = new THREE.BufferGeometry();
    if (ao) out.setAttribute('aNo', new THREE.BufferAttribute(ao, 1, true));
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    out.setAttribute('aNp', new THREE.BufferAttribute(np, 4, true));
    out.setAttribute('aNq', new THREE.BufferAttribute(nq, 4, false));
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4, false));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    out.userData.triangles = io / 3;
    out.userData.bytes = pos.byteLength + nor.byteLength + uv.byteLength + col.byteLength + np.byteLength + nq.byteLength + si.byteLength + sw.byteLength + idx.byteLength + (ao ? ao.byteLength : 0);
    this.triangles = io / 3;
    this.parts = [];
    return out;
  }
}

/** Dreiecksreihenfolge umdrehen (nach Spiegelung an einer Ebene). */
function flipWinding(g) {
  if (g.index) {
    const I = g.index.array;
    for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      const s = a.itemSize;
      for (let i = 0; i < a.count; i += 3) for (let c = 0; c < s; c++) {
        const t = a.array[(i + 1) * s + c]; a.array[(i + 1) * s + c] = a.array[(i + 2) * s + c]; a.array[(i + 2) * s + c] = t;
      }
    }
  }
}
