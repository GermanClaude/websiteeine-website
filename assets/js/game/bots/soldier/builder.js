// NULLPUNKT — Geometrie-Baukasten für Soldaten: Grundformen (gedrehte Profile, abgerundete Quader,
// Ellipsoide, Zylinder) im Modellraum der Bindepose, je Teil einem Knochen starr zugeordnet.
// build() fügt alles zu EINER indizierten Geometrie mit skinIndex/skinWeight, Vertexfarben,
// Box-Projektions-UVs und dem Materialattribut aNp zusammen → ein Draw Call pro Soldat und LOD.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BONE } from './rig.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** Transformation anwenden: { p:[x,y,z], r:[x,y,z] (Euler XYZ), s:[x,y,z] | Zahl }. */
export function xf(geo, { p, r, s } = {}) {
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'XYZ');
  _q.setFromEuler(_e);
  if (s == null) _s.set(1, 1, 1); else if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  _p.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
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
    pts.push(new THREE.Vector2(Math.max(1e-4, rBot * Math.cos(a)), yBot + rBot * Math.sin(a) * 0.85));
  } else pts.push(new THREE.Vector2(1e-4, yBot), new THREE.Vector2(rBot * 0.98, yBot));
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const b = 1 + bulge * Math.exp(-((t - bulgeAt) ** 2) / 0.06);
    pts.push(new THREE.Vector2((rBot + (rTop - rBot) * t) * b, yBot + (yTop - yBot) * t));
  }
  if (caps[1]) for (let i = 1; i <= cr; i++) {
    const a = (Math.PI / 2) * (i / cr);
    pts.push(new THREE.Vector2(Math.max(1e-4, rTop * Math.cos(a)), yTop + rTop * Math.sin(a) * 0.85));
  } else pts.push(new THREE.Vector2(rTop * 0.98, yTop), new THREE.Vector2(1e-4, yTop));
  const g = new THREE.LatheGeometry(pts, seg);
  if (sx !== 1 || sz !== 1 || x || z) xf(g, { p: [x, 0, z], s: [sx, 1, sz] });
  return g;
}

/** Beliebiges Drehprofil [[r, y], …] (von unten nach oben). */
export function lathe(profile, seg = 10, opts = {}) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)), seg);
  return xf(g, opts);
}

/** Abgerundeter Quader (seg 0 → einfacher Quader). */
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
  return xf(g, opts);
}

export function cyl(rTop, rBot, h, seg = 10, opts = {}, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  return xf(g, opts);
}

export function torus(r, tube, rs = 6, ts = 12, opts = {}, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(r, tube, rs, ts, arc);
  return xf(g, opts);
}

/* ------------------------------------------------------------------ Zusammenbau */

export class SkinBuilder {
  constructor({ uvScale = 2 } = {}) {
    this.parts = [];
    this.uvScale = uvScale;
    this.triangles = 0;
  }

  /**
   * Teil hinzufügen. o: { bone, color, camo=0, detail=0, emis=0, shine=0, mirror }
   * mirror: zusätzlich an x gespiegelt (bone für die Spiegelung via o.mirrorBone).
   */
  add(geo, o) {
    if (!geo) return;
    const bone = typeof o.bone === 'number' ? o.bone : BONE[o.bone];
    if (bone === undefined) throw new Error('Unbekannter Knochen ' + o.bone);
    _c.set(o.color || '#ffffff');
    this.parts.push({ geo, bone, r: _c.r, g: _c.g, b: _c.b, np: [o.camo || 0, o.detail ?? (o.camo ? 1 : 0), o.emis || 0, o.shine || 0] });
    if (o.mirrorBone) {
      const m = geo.clone();
      m.scale(-1, 1, 1);
      flipWinding(m);
      const mb = BONE[o.mirrorBone];
      this.parts.push({ geo: m, bone: mb, r: _c.r, g: _c.g, b: _c.b, np: [o.camo || 0, o.detail ?? (o.camo ? 1 : 0), o.emis || 0, o.shine || 0] });
    }
  }

  build() {
    let nv = 0, ni = 0;
    for (const p of this.parts) {
      nv += p.geo.attributes.position.count;
      ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const col = new Float32Array(nv * 3);
    const np = new Float32Array(nv * 4);
    const si = new Uint16Array(nv * 4);
    const sw = new Float32Array(nv * 4);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    const S = this.uvScale;
    for (const p of this.parts) {
      const g = p.geo;
      const P = g.attributes.position.array;
      if (!g.attributes.normal) g.computeVertexNormals();
      const N = g.attributes.normal.array;
      const n = g.attributes.position.count;
      for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        const k = vo + i;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        let u, v;
        if (ax >= ay && ax >= az) { u = z * Math.sign(nx || 1); v = y; }
        else if (ay >= az) { u = x; v = z; }
        else { u = -x * Math.sign(nz || 1); v = y; }
        uv[k * 2] = u * S + p.bone * 0.137;
        uv[k * 2 + 1] = v * S;
        col[k * 3] = p.r; col[k * 3 + 1] = p.g; col[k * 3 + 2] = p.b;
        np[k * 4] = p.np[0]; np[k * 4 + 1] = p.np[1]; np[k * 4 + 2] = p.np[2]; np[k * 4 + 3] = p.np[3];
        si[k * 4] = p.bone;
        sw[k * 4] = 1;
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
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('aNp', new THREE.BufferAttribute(np, 4));
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    out.userData.triangles = io / 3;
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
