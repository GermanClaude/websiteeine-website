// NULLPUNKT — MapBuilder: sammelt statische Geometrie, verschmilzt sie pro Material/Chunk,
// backt Ambient Occlusion in Vertexfarben, erzeugt Kollisions- und Kugel-Geometrie (Owner: world)
import * as THREE from 'three';
import { getMaterial, surfaceOf, preloadMaterials, proceduralNames, libraryPendingNames, materialAlbedo } from '../engine/textures.js';
import { createDecalMaterials, createSignAtlas, createFoliage, DECAL_CELLS, DECAL_ROWS, DEFAULT_SIGNS } from './atlas.js';
import { PropInstances, placementMatrix, forEachBulletTri, MODEL_SURFACE } from './libprops.js';
import { assets } from '../../../lib/loader.js';

export const SURFACES = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'grass', 'glass', 'water', 'tile', 'fabric', 'flesh'];
const SURF_INDEX = Object.fromEntries(SURFACES.map((s, i) => [s, i]));
/** Mittlere Albedo der Bibliotheks-Requisiten je Oberfläche (Sonden-Rückprall). */
const PROP_ALBEDO = { concrete: 0.4, metal: 0.3, wood: 0.32, dirt: 0.3, sand: 0.45, grass: 0.25, glass: 0.2, water: 0.1, tile: 0.4, fabric: 0.3, flesh: 0.35 };

// ---------------------------------------------------------------------------
// Wachsende Typed Arrays
// ---------------------------------------------------------------------------
class FBuf {
  constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2; while (c < this.n + k) c *= 2;
    const b = new Float32Array(c); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  view() { return this.a.subarray(0, this.n); }
}
class U8Buf {
  constructor(n = 2048) { this.a = new Uint8Array(n); this.n = 0; }
  ensure(k) {
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2; while (c < this.n + k) c *= 2;
    const b = new Uint8Array(c); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  push(v) { this.ensure(1); this.a[this.n++] = v; }
  view() { return this.a.subarray(0, this.n); }
}

const _c = new THREE.Color();
function linearTint(t) {
  if (!t) return [1, 1, 1];
  if (Array.isArray(t)) return t;
  _c.set(t); // sRGB-Hex → linear (ColorManagement)
  return [_c.r, _c.g, _c.b];
}
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Flags pro Vertex
const F_INTERIOR = 1, F_GROUND = 2, F_NOISE = 4;

// ---------------------------------------------------------------------------
// Lokale Primitive (nicht indiziert): { p: Float32Array, n: Float32Array, uv: Float32Array|null }
// ---------------------------------------------------------------------------
const FACES = [
  // n, u, v
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
];

/** Box [-w/2,w/2]×[0,h]×[-d/2,d/2]; Seitenflächen optional in Höhenreihen geteilt (für AO-Verlauf). */
function boxPrim(w, h, d, rows, skip, fit) {
  const hw = w / 2, hd = d / 2, hh = h / 2;
  // Zeilengrenzen der Seitenflächen (v läuft von −h/2 bis h/2)
  const ys = [-hh];
  if (rows) for (const r of rows) { const yy = r - hh; if (yy > -hh + 0.02 && yy < hh - 0.02) ys.push(yy); }
  ys.push(hh);
  let quads = 0;
  for (let f = 0; f < 6; f++) if (!(skip && skip[f])) quads += f < 4 ? ys.length - 1 : 1;
  const P = new Float32Array(quads * 18), N = new Float32Array(quads * 18), U = fit ? new Float32Array(quads * 12) : null;
  let pi = 0, ui = 0;
  for (let f = 0; f < 6; f++) {
    if (skip && skip[f]) continue;
    const [n, u, v] = FACES[f];
    const eu = Math.abs(u[0]) * hw + Math.abs(u[1]) * hh + Math.abs(u[2]) * hd;
    const ev = Math.abs(v[0]) * hw + Math.abs(v[1]) * hh + Math.abs(v[2]) * hd;
    const cx = n[0] * hw, cy = hh + n[1] * hh, cz = n[2] * hd;
    const side = f < 4;
    const nr = side ? ys.length - 1 : 1;
    for (let r = 0; r < nr; r++) {
      const v0 = side ? ys[r] : -ev, v1 = side ? ys[r + 1] : ev;
      for (let k = 0; k < 6; k++) {
        const c = QUAD_IDX[k];
        const a = c === 1 || c === 2 ? eu : -eu, bb = c >= 2 ? v1 : v0;
        P[pi] = cx + u[0] * a + v[0] * bb; P[pi + 1] = cy + u[1] * a + v[1] * bb; P[pi + 2] = cz + u[2] * a + v[2] * bb;
        N[pi] = n[0]; N[pi + 1] = n[1]; N[pi + 2] = n[2];
        pi += 3;
        if (U) { U[ui++] = (a + eu) / (2 * eu); U[ui++] = (bb + ev) / (2 * ev); }
      }
    }
  }
  return { p: P, n: N, uv: U };
}
const QUAD_IDX = [0, 1, 2, 0, 2, 3]; // Ecken: 0 (−u,v0) 1 (+u,v0) 2 (+u,v1) 3 (−u,v1)

/** Nur Kollisionsdreiecke einer Box (36 Ecken, ohne Normalen/UV) – gecacht je Maß. */
const _collBoxCache = new Map();
function collBox(w, h, d) {
  const key = w + ',' + h + ',' + d;
  let p = _collBoxCache.get(key);
  if (!p) { p = boxPrim(w, h, d, null, null, false); if (_collBoxCache.size > 4096) _collBoxCache.clear(); _collBoxCache.set(key, p); }
  return p;
}

/** Zylinder entlang y von 0..h, Radius unten r0 / oben r1. */
function cylPrim(r0, r1, h, seg, caps, rows, arc = Math.PI * 2) {
  const slope = (r0 - r1) / h;
  const ys = [0]; if (rows) for (const s of rows) if (s > 0.02 && s < h - 0.02) ys.push(s); ys.push(h);
  const circ = (r0 + r1) / 2;
  const nRows = ys.length - 1;
  const capCount = caps ? (r1 > 0 ? 1 : 0) + (r0 > 0 ? 1 : 0) : 0;
  const nV = seg * nRows * 6 + capCount * seg * 3;
  const P = new Float32Array(nV * 3), N = new Float32Array(nV * 3), U = new Float32Array(nV * 2);
  let pi = 0, ui = 0;
  const put = (x, y, z, nx, ny, nz, u, v) => {
    P[pi] = x; P[pi + 1] = y; P[pi + 2] = z; N[pi] = nx; N[pi + 1] = ny; N[pi + 2] = nz; pi += 3;
    U[ui++] = u; U[ui++] = v;
  };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * arc, a1 = ((i + 1) / seg) * arc;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const l0 = 1 / Math.hypot(c0, slope, s0), l1 = 1 / Math.hypot(c1, slope, s1);
    for (let r = 0; r < nRows; r++) {
      const y0 = ys[r], y1 = ys[r + 1];
      const ra = r0 + (r1 - r0) * (y0 / h), rb = r0 + (r1 - r0) * (y1 / h);
      // Ecken 0 (a0,y0) 1 (a1,y0) 2 (a1,y1) 3 (a0,y1) in Reihenfolge 0,2,1,0,3,2
      for (let k = 0; k < 6; k++) {
        const c = CYL_IDX[k], second = c === 1 || c === 2, top = c >= 2;
        const cc = second ? c1 : c0, ss = second ? s1 : s0, rr = top ? rb : ra, l = second ? l1 : l0;
        put(cc * rr, top ? y1 : y0, ss * rr, cc * l, slope * l, ss * l, (second ? a1 : a0) * circ, top ? y1 : y0);
      }
    }
  }
  if (caps) {
    for (const top of [0, 1]) {
      const y = top ? h : 0, rr = top ? r1 : r0, ny = top ? 1 : -1;
      if (rr <= 0) continue;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * arc, a1 = ((i + 1) / seg) * arc;
        const xa = Math.cos(a0) * rr, za = Math.sin(a0) * rr, xb = Math.cos(a1) * rr, zb = Math.sin(a1) * rr;
        put(0, y, 0, 0, ny, 0, 0, 0);
        if (top) { put(xb, y, zb, 0, ny, 0, xb, zb); put(xa, y, za, 0, ny, 0, xa, za); }
        else { put(xa, y, za, 0, ny, 0, xa, za); put(xb, y, zb, 0, ny, 0, xb, zb); }
      }
    }
  }
  return { p: P, n: N, uv: U };
}
const CYL_IDX = [0, 2, 1, 0, 3, 2];

// Unveränderliche Primitive werden je Maß wiederverwendet (Container, Räder, Riegel … wiederholen sich oft)
const _primCache = new Map();
function cachedPrim(key, make) {
  let p = _primCache.get(key);
  if (!p) { if (_primCache.size > 8192) _primCache.clear(); p = make(); _primCache.set(key, p); }
  return p;
}

/** Keil: Grundfläche w×d, steigt entlang +z von 0 auf h (Rampe). */
function wedgePrim(w, h, d) {
  const hw = w / 2, hd = d / 2;
  const v = {
    a: [-hw, 0, -hd], b: [hw, 0, -hd], c: [hw, 0, hd], e: [-hw, 0, hd], f: [hw, h, hd], g: [-hw, h, hd],
  };
  // Windung gegen den Uhrzeigersinn von außen → Normalen zeigen nach außen
  const tris = [
    [v.a, v.b, v.c], [v.a, v.c, v.e],               // Boden
    [v.a, v.f, v.b], [v.a, v.g, v.f],               // Schräge
    [v.e, v.f, v.g], [v.e, v.c, v.f],               // Rückwand (+z)
    [v.a, v.e, v.g],                                // links
    [v.b, v.f, v.c],                                // rechts
  ];
  const P = [], N = [];
  for (const [p0, p1, p2] of tris) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [p0, p1, p2]) { P.push(p[0], p[1], p[2]); N.push(nx, ny, nz); }
  }
  return { p: new Float32Array(P), n: new Float32Array(N), uv: null };
}

/** Beliebige BufferGeometry → nicht indiziertes Primitiv. */
function geomPrim(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  return { p: g.attributes.position.array, n: g.attributes.normal.array, uv: g.attributes.uv ? g.attributes.uv.array : null };
}

// ---------------------------------------------------------------------------
// MapBuilder
// ---------------------------------------------------------------------------
export class MapBuilder {
  constructor({ bounds, seed = 1, chunkSize = 30, groundNoise = 0.14, splitTris = 24000, interiorTint = [1, 0.95, 0.86] } = {}) {
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.chunkSize = chunkSize;
    this.splitTris = splitTris;
    this.interiorTint = interiorTint;
    this.groundNoise = groundNoise;
    let s = seed >>> 0 || 1;
    this.rand = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.buckets = new Map();
    this.colTris = new FBuf(65536);
    this.footprints = [];
    this.interiors = [];
    this.navPoints = [];
    this.navBlockers = [];
    this.navExclude = [];
    this.decals = [];
    this.signs = [];
    this.signDefs = {};
    this.plants = [];
    this.lights = [];
    this.glows = [];      // weiche Lichthöfe (ein Draw Call für alle)
    this.objects = [];    // dynamische/separate Objekte: { object, update }
    this.materials = new Set();
    this.floors = [];     // { minX, maxX, minZ, maxZ, y }
    this.openings = [];   // Fenster/Tore aus arch.wall(): { x, y, z (Mitte), ux, uz (Wandrichtung), w, h, t, kind, glass } – Lichtstrahlen
    this.models = [];     // Bibliotheks-Requisiten: { id, x, y, z, o } (model())
    this.interiorScale = null; // 0..1: Anteil des gebackenen Innenraumlichts (null = voll; mit Sonden-Gitter gesetzt)
    this.lib = null;      // Set verfügbarer Modell-IDs (Bibliothek nutzbar) oder null (nur prozedural)
    this.library = null;  // async ({ names, models }, onProgress) → { models: Map id → Vorlage|null } (loadWorld)
    this.stats = { prims: 0 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._nm = new THREE.Matrix3();
  }

  /** Zufall im Bereich */
  rnd(a = 0, b = 1) { return a + (b - a) * this.rand(); }
  pick(arr) { return arr[Math.floor(this.rand() * arr.length) % arr.length]; }

  _chunk(x, z) {
    const b = this.bounds, cs = this.chunkSize;
    const nx = Math.max(1, Math.ceil((b.maxX - b.minX) / cs));
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - b.minX) / cs)));
    const cz = Math.max(0, Math.floor((z - b.minZ) / cs));
    return cz * nx + cx;
  }

  _bucket(mat, chunk, cast, matOpts) {
    const key = mat + (matOpts ? JSON.stringify(matOpts) : '') + '|' + chunk + '|' + (cast ? 1 : 0);
    let bk = this.buckets.get(key);
    if (!bk) {
      bk = { mat, matOpts, chunk, cast, pos: new FBuf(), nor: new FBuf(), uv: new FBuf(), col: new FBuf(), flg: new U8Buf(), bullet: new U8Buf(1024) };
      this.buckets.set(key, bk);
      this.materials.add(mat);
    }
    return bk;
  }

  /** Transformationsmatrix aus Position/Rotation/Skalierung. */
  _matrix(x, y, z, o) {
    this._e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    this._q.setFromEuler(this._e);
    this._s.set(o.sx || 1, o.sy || 1, o.sz || 1);
    this._p.set(x, y, z);
    return this._m.compose(this._p, this._q, this._s);
  }

  /**
   * Schreibt ein lokales Primitiv mit Matrix m in den Material-Bucket.
   * o: { tint, uv: 'world'|'local'|'fit'|'keep', uvScale, uvOffset:[u,v], uvSwap (u/v tauschen), cast, bullet, interior, ground, noise,
   *      aoFloor, aoMin, aoH, ao(false), chunkAt:[x,z] }
   */
  _emit(prim, m, mat, o, center) {
    this.stats.prims++;
    const e = m.elements;
    this._nm.getNormalMatrix(m);
    const ne = this._nm.elements;
    const cast = o.cast !== false;
    const bk = this._bucket(mat, o.chunk ?? this._chunk(center[0], center[2]), cast, o.matOpts || null);
    const nV = prim.p.length / 3;
    bk.pos.ensure(nV * 3); bk.nor.ensure(nV * 3); bk.uv.ensure(nV * 2); bk.col.ensure(nV * 3); bk.flg.ensure(nV); bk.bullet.ensure(nV / 3);
    const P = bk.pos.a, N = bk.nor.a, UV = bk.uv.a, C = bk.col.a, FL = bk.flg.a;
    let pi = bk.pos.n, ui = bk.uv.n, fi = bk.flg.n;
    const tint = linearTint(o.tint);
    const uvMode = o.uv || 'world', uvs = 1 / (o.uvScale || 1), uo = o.uvOffset || [0, 0], uvSwap = !!o.uvSwap;
    const ao = o.ao !== false;
    const floorY = o.aoFloor ?? center[1];
    const aoMin = o.aoMin ?? 0.5, aoH = o.aoH ?? 1.1;
    const grad = ao && this._grad(o, center[1]);
    const flags = (o.interior === false ? 0 : F_INTERIOR) | (o.ground ? F_GROUND : 0) | (o.noise ? F_NOISE : 0);
    const lp = prim.p, ln = prim.n, luv = prim.uv;
    for (let i = 0; i < nV; i++) {
      const x = lp[i * 3], y = lp[i * 3 + 1], z = lp[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = ln[i * 3], b = ln[i * 3 + 1], c = ln[i * 3 + 2];
      let nx = ne[0] * a + ne[3] * b + ne[6] * c, ny = ne[1] * a + ne[4] * b + ne[7] * c, nz = ne[2] * a + ne[5] * b + ne[8] * c;
      const l = 1 / (Math.hypot(nx, ny, nz) || 1); nx *= l; ny *= l; nz *= l;
      P[pi] = wx; P[pi + 1] = wy; P[pi + 2] = wz;
      N[pi] = nx; N[pi + 1] = ny; N[pi + 2] = nz;
      // UV
      let u, v;
      if ((uvMode === 'fit' || uvMode === 'keep') && luv) { u = luv[i * 2]; v = luv[i * 2 + 1]; if (uvMode === 'keep') { u *= uvs; v *= uvs; } }
      else {
        let px, py, pz, qx, qy, qz;
        if (uvMode === 'local') { px = x; py = y; pz = z; qx = a; qy = b; qz = c; } else { px = wx; py = wy; pz = wz; qx = nx; qy = ny; qz = nz; }
        const ax = Math.abs(qx), ay = Math.abs(qy), az = Math.abs(qz);
        if (ax >= ay && ax >= az) { u = qx > 0 ? -pz : pz; v = py; }
        else if (ay >= az) { u = px; v = qy > 0 ? -pz : pz; }
        else { u = qz > 0 ? px : -px; v = py; }
        u *= uvs; v *= uvs;
      }
      if (uvSwap) { const s = u; u = v; v = s; }
      UV[ui] = u + uo[0]; UV[ui + 1] = v + uo[1];
      // AO
      let k = 1;
      if (ao) {
        if (ny < -0.6) k = 0.62;
        else if (grad && ny < 0.6) k = aoMin + (1 - aoMin) * smoothstep(0, aoH, wy - floorY);
      }
      C[pi] = tint[0] * k; C[pi + 1] = tint[1] * k; C[pi + 2] = tint[2] * k;
      FL[fi] = flags;
      pi += 3; ui += 2; fi++;
    }
    bk.pos.n = bk.nor.n = bk.col.n = pi; bk.uv.n = ui; bk.flg.n = fi;
    const bv = o.bullet === false ? 0 : 1;
    for (let t = 0; t < nV / 3; t++) bk.bullet.push(bv);
  }

  _collTris(prim, m) {
    if (this._noCollide) return; // Ersatzform einer Bibliotheks-Requisite: nur Optik (siehe _resolveModels)
    const e = m.elements, lp = prim.p, n = lp.length / 3;
    this.colTris.ensure(n * 3);
    const C = this.colTris.a; let ci = this.colTris.n;
    for (let i = 0; i < n; i++) {
      const x = lp[i * 3], y = lp[i * 3 + 1], z = lp[i * 3 + 2];
      C[ci++] = e[0] * x + e[4] * y + e[8] * z + e[12];
      C[ci++] = e[1] * x + e[5] * y + e[9] * z + e[13];
      C[ci++] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    this.colTris.n = ci;
  }

  _footprint(x, z, w, d, ry, y0, y1, kind) {
    if (kind === false) return;
    const h = y1 - y0;
    if (!kind || kind === 'auto') kind = h > 2.6 ? 'building' : h > 0.45 ? 'cover' : 'floor';
    this.footprints.push({ x, z, hw: w / 2, hd: d / 2, ry: ry || 0, y0, y1, kind });
  }

  /** Bekommt das Primitiv einen AO-Verlauf vom Boden aus? (am Boden stehend oder aoFloor gesetzt) */
  _grad(o, y) {
    if (o.ao === false) return false;
    if (o.grad !== undefined) return o.grad;
    return o.aoFloor !== undefined || Math.abs(y) < 0.06;
  }

  /** Höhenreihen (lokal ab Unterkante) für den AO-Verlauf an Seitenflächen */
  _rows(h, o, y) {
    if (!this._grad(o, y)) return null;
    const base = (o.aoFloor ?? y) - y; // Bodenhöhe relativ zur Unterkante
    return h > 0.4 ? [base + 0.22, base + 0.6, base + 1.2] : null;
  }

  // ---------------------------------------------------------------------------
  // Öffentliche Primitive
  // ---------------------------------------------------------------------------
  /**
   * Quader. (x, z) = Mitte, y = Unterkante. Rotation um die Mitte (o.ry, o.rx, o.rz).
   * o: mat-Optionen siehe _emit + { collide=true, minimap ('auto'|false|kind), skip:[6 bools], visual=true }
   */
  box(x, y, z, w, h, d, mat, o = {}) {
    const m = this._matrix(x, y, z, o);
    const rotated = !!(o.rx || o.rz);
    if (o.visual !== false) {
      const uvMode = o.uv || (((o.ry || 0) % (Math.PI / 2) !== 0 || rotated) ? 'local' : 'world');
      const rows = uvMode === 'fit' ? null : this._rows(h, o, y), fit = uvMode === 'fit';
      const prim = cachedPrim(`b${w},${h},${d},${rows},${o.skip},${fit}`, () => boxPrim(w, h, d, rows, o.skip, fit));
      const oo = uvMode === 'local' && !o.uvOffset ? { ...o, uv: 'local', uvOffset: [x * 0.37 % 1, z * 0.53 % 1] } : { ...o, uv: uvMode };
      this._emit(prim, m, mat, oo, [x, y, z]);
      if (mat.startsWith('plaster') && o.damage !== false && !rotated && h >= 1.8 && w >= 1.2 && d <= 0.6) this._plasterDamage(x, y, z, w, h, d, o);
    }
    if (o.collide !== false) {
      this._collTris(collBox(w, h, d), m);
      if (!rotated) this._footprint(x, z, w, d, o.ry, y, y + h, o.minimap);
      else this._footprint(x, z, w, d, o.ry, y, y + h * Math.cos(o.rx || 0) + d * Math.abs(Math.sin(o.rx || 0)), o.minimap);
    }
    return this;
  }

  /** Quader über Min/Max-Koordinaten (achsenparallel) */
  boxMM(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    return this.box((x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), mat, o);
  }

  /** Zylinder (Achse y; o.axis 'x'|'z' legt ihn hin – dann ist (x,y,z) die Mitte). */
  cyl(x, y, z, r, h, mat, o = {}) {
    const seg = o.seg || (r > 0.6 ? 20 : r > 0.25 ? 14 : 8);
    const rows = o.axis ? null : this._rows(h, o, y), r1 = o.r1 ?? r, caps = o.caps !== false;
    const prim = cachedPrim(`c${r},${r1},${h},${seg},${caps},${rows},${o.arc}`, () => cylPrim(r, r1, h, seg, caps, rows, o.arc));
    let oo = o;
    if (o.axis === 'x' || o.axis === 'z') {
      // liegend: Mitte bei (x,y,z)
      const rz = o.axis === 'x' ? -Math.PI / 2 : 0, rx = o.axis === 'z' ? Math.PI / 2 : 0;
      oo = { ...o, rx: (o.rx || 0) + rx, rz: (o.rz || 0) + rz };
      const m = this._matrix(0, 0, 0, oo);
      const off = new THREE.Vector3(0, -h / 2, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m));
      const m2 = this._matrix(x + off.x, y + off.y, z + off.z, oo);
      if (o.visual !== false) this._emit(prim, m2, mat, { ...oo, uv: 'keep', grad: false }, [x, y, z]);
      if (o.collide !== false) {
        const L = h, R = r;
        const dir = o.axis === 'x' ? 'x' : 'z';
        const ry = o.ry || 0;
        // Kollision als Quader
        this._collTris(collBox(dir === 'x' ? L : R * 2, R * 2, dir === 'x' ? R * 2 : L), this._matrix(x, y - R, z, { ry }));
        this._footprint(x, z, dir === 'x' ? L : R * 2, dir === 'x' ? R * 2 : L, ry, y - R, y + R, o.minimap);
      }
      return this;
    }
    const m = this._matrix(x, y, z, o);
    if (o.visual !== false) this._emit(prim, m, mat, { ...o, uv: 'keep' }, [x, y, z]);
    if (o.collide !== false) {
      const cp = r >= 0.3 ? cachedPrim(`c${r},${r1},${h},8,true,null,undefined`, () => cylPrim(r, r1, h, 8, true, null)) : collBox(r * 2, h, r * 2);
      this._collTris(cp, m);
      this._footprint(x, z, r * 2, r * 2, 0, y, y + h, o.minimap ?? (h > 2.6 ? 'pillar' : 'auto'));
    }
    return this;
  }

  /** Keil/Rampe: Grundfläche w×d, steigt entlang lokal +z auf h. (x,z) Mitte, y Unterkante. */
  wedge(x, y, z, w, h, d, mat, o = {}) {
    const m = this._matrix(x, y, z, o);
    const prim = wedgePrim(w, h, d);
    if (o.visual !== false) this._emit(prim, m, mat, { ...o, uv: o.uv || 'local', grad: false }, [x, y, z]);
    if (o.collide !== false) {
      this._collTris(prim, m);
      this._footprint(x, z, w, d, o.ry, y, y + h, o.minimap ?? 'stairs');
    }
    return this;
  }

  /** Eigene Geometrie (lokal). o.position/rotation per x,y,z + rx/ry/rz/sx/sy/sz. */
  geom(geometry, x, y, z, mat, o = {}) {
    const m = this._matrix(x, y, z, o);
    const prim = geomPrim(geometry);
    if (o.visual !== false) this._emit(prim, m, mat, { ...o, uv: o.uv || (prim.uv ? 'keep' : 'world') }, [x, y, z]);
    if (o.collide) {
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      if (o.collide === 'mesh') this._collTris(prim, m);
      else {
        const w = (bb.max.x - bb.min.x) * (o.sx || 1), h = (bb.max.y - bb.min.y) * (o.sy || 1), d = (bb.max.z - bb.min.z) * (o.sz || 1);
        const c = new THREE.Vector3((bb.max.x + bb.min.x) / 2, bb.min.y, (bb.max.z + bb.min.z) / 2).applyMatrix4(m);
        this._collTris(collBox(w, h, d), this._matrix(c.x, c.y, c.z, { ry: o.ry }));
        this._footprint(c.x, c.z, w, d, o.ry, c.y, c.y + h, o.minimap);
      }
    }
    return this;
  }

  /** Unsichtbarer Kollisionsquader (Kartengrenzen, Wasser-Kante). Kugeln fliegen hindurch. */
  collider(x, y, z, w, h, d, o = {}) {
    if (this._noCollide) return this;
    this._collTris(collBox(w, h, d), this._matrix(x, y, z, o));
    if (o.minimap) this._footprint(x, z, w, d, o.ry, y, y + h, o.minimap);
    if (o.navBlock !== false) this.navBlockers.push({ x, z, hw: w / 2 + 0.2, hd: d / 2 + 0.2, ry: o.ry || 0 });
    return this;
  }

  /** Nur Kollision + Kugeln (z. B. vereinfachte Hülle eines Detailobjekts). */
  solid(x, y, z, w, h, d, o = {}) {
    return this.box(x, y, z, w, h, d, 'black', { ...o, visual: false });
  }

  /**
   * Unterteilte Bodenfläche mit AO aus der Footprint-Rasterung und großflächiger Farbvariation.
   * o: { y=0, cell=1, tint, collide=true }
   */
  ground(x0, z0, x1, z1, mat, o = {}) {
    const y = o.y ?? 0, cell = o.cell ?? 1;
    const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell));
    const P = [], N = [];
    const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const ax = x0 + i * dx, az = z0 + j * dz, bx = ax + dx, bz = az + dz;
      P.push(ax, 0, az, ax, 0, bz, bx, 0, bz, ax, 0, az, bx, 0, bz, bx, 0, az);
      for (let k = 0; k < 6; k++) N.push(0, 1, 0);
    }
    const prim = { p: new Float32Array(P), n: new Float32Array(N), uv: null };
    // In Chunks aufteilen wäre ideal; Bodenflächen sind groß → nach Mittelpunkt
    const m = this._matrix(0, y, 0, {});
    this._emit(prim, m, mat, { ...o, uv: 'world', ground: o.groundAO !== false, noise: true, cast: false, grad: false, chunk: o.chunk ?? this._chunk((x0 + x1) / 2, (z0 + z1) / 2) }, [(x0 + x1) / 2, y, (z0 + z1) / 2]);
    if (o.collide !== false) {
      const t = o.thickness ?? 0.5;
      this._collTris(collBox(x1 - x0, t, z1 - z0), this._matrix((x0 + x1) / 2, y - t, (z0 + z1) / 2, {}));
    }
    if (o.floor !== false) this.floors.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), y });
    if (o.minimap) this._footprint((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0), 0, y - 0.01, y, o.minimap);
    return this;
  }

  /**
   * Großer Boden in Kacheln (aufgeteilt in Chunks für Culling). Kollision als EIN Quader über die ganze Fläche:
   * die Chunkgröße hängt auf Großkarten von der Grafikstufe ab – die Kollision muss auf jedem Rechner gleich sein.
   */
  groundTiled(x0, z0, x1, z1, mat, o = {}) {
    const cs = this.chunkSize;
    const tile = o.collide === false ? o : { ...o, collide: false };
    for (let z = z0; z < z1 - 1e-6; z += cs) for (let x = x0; x < x1 - 1e-6; x += cs) {
      this.ground(x, z, Math.min(x1, x + cs), Math.min(z1, z + cs), mat, tile);
    }
    if (o.collide !== false) {
      const t = o.thickness ?? 0.5;
      this._collTris(collBox(x1 - x0, t, z1 - z0), this._matrix((x0 + x1) / 2, (o.y ?? 0) - t, (z0 + z1) / 2, {}));
    }
    return this;
  }

  /** Innenraum-Volumen: Flächen innen werden abgedunkelt (gebackenes Innenraumlicht). */
  interior(minX, minZ, maxX, maxZ, minY, maxY, factor = 0.62, tint = null) {
    let t = tint || this.interiorTint;
    // Mit Sonden-Gitter (loadWorld setzt interiorScale) liefert das Gitter die Innenraum-Dunkelheit fürs indirekte
    // Licht; hier bleibt nur ein Rest (sonst wäre auch das Sonnenlicht durchs Fenster abgedunkelt)
    if (this.interiorScale != null) {
      const k = this.interiorScale;
      factor = 1 - (1 - factor) * k;
      t = t ? t.map(c => 1 - (1 - c) * Math.min(1, k * 1.6)) : t;
    }
    this.interiors.push({ minX, minZ, maxX, maxZ, minY, maxY, factor, tint: t });
    this._interiorGrid = null;
    return this;
  }

  /** Bereich ohne Navigationsknoten (z. B. unerreichbare Dächer). */
  noNav(minX, minZ, maxX, maxZ, minY = -1e9, maxY = 1e9) { this.navExclude.push({ minX, minZ, maxX, maxZ, minY, maxY }); return this; }

  /** Zusätzlicher Navigationspunkt (Türdurchgänge, Treppenenden). */
  navPoint(x, y, z) { this.navPoints.push(new THREE.Vector3(x, y, z)); return this; }

  /** Navigationspunkte entlang einer Linie (schmale Treppen, Stege, Brücken). */
  navLine(x0, y0, z0, x1, y1, z1, step = 1.2) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i <= n; i++) { const t = i / n; this.navPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t); }
    return this;
  }

  /** Boden-/Wand-Decal aus dem Decal-Atlas. normal: [nx,ny,nz] (Standard nach oben). */
  /** o.tangent: [x,y,z] Richtung der Decal-Breite (w) – für Wände, deren Muster waagerecht liegen muss. */
  decal(x, y, z, w, d, cell, o = {}) {
    this.decals.push({ x, y, z, w, d, cell: typeof cell === 'string' ? DECAL_CELLS[cell] : cell, ry: o.ry ?? (o.tangent ? 0 : this.rand() * Math.PI * 2), normal: o.normal || null, tangent: o.tangent || null, kind: o.kind || (cell === 'puddle' ? 'wet' : cell === 'arrow' || cell === 'hatch' || cell === 'line' || cell === 'stencil' ? 'paint' : 'grime'), tint: o.tint, opacity: o.opacity ?? 1 });
    return this;
  }

  /**
   * Putzschäden an Putzwänden (F41: statt identischer Flecken alle 3 m in der Kacheltextur): je Wandseite
   * 0–2 Stellen pro 4 m, weltweit zufällig (eigener, positionsabhängiger Zufall – der Karten-Zufall bleibt
   * unberührt): ausgebrochener Putz mit Bruchstein/Ziegel, ausgebesserte Stellen, aufsteigende Feuchte.
   */
  _plasterDamage(x, y, z, w, h, d, o) {
    let seed = (Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663) ^ Math.imul(Math.round(y * 100) + 7, 83492791)) >>> 0;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const ry = o.ry || 0, c = Math.cos(ry), sn = Math.sin(ry);
    const tx = c, tz = -sn, nzx = sn, nzz = c; // lokale +x (Wandlänge) und +z (Wandnormale) in Welt
    for (const side of [1, -1]) {
      const n = Math.min(Math.floor(rnd() * 1.8 * (w / 4) + rnd() * 0.6), Math.ceil(w / 4) * 2);
      for (let i = 0; i < n; i++) {
        const k = rnd();
        const cell = k < 0.42 ? 'chip_stone' : k < 0.6 ? 'chip_brick' : k < 0.85 ? 'plaster_patch' : 'damp';
        const sw = cell === 'damp' ? 1.2 + rnd() * 1.6 : 0.45 + rnd() * 0.85, sh = cell === 'damp' ? 0.6 + rnd() * 0.5 : sw * (0.55 + rnd() * 0.35);
        if (sw > w - 0.3 || sh > h - 0.5) continue;
        const u = (rnd() - 0.5) * (w - sw - 0.2);
        const v = cell === 'damp' ? sh / 2 + 0.02 : 0.3 + sh / 2 + rnd() * Math.max(0, h - 0.6 - sh);
        const off = side * (d / 2);
        this.decal(x + tx * u + nzx * off, y + v, z + tz * u + nzz * off, sw, sh, cell, {
          normal: [nzx * side, 0, nzz * side], tangent: [tx * side, 0, tz * side],
          tint: cell === 'plaster_patch' ? o.tint : undefined, opacity: cell === 'damp' ? 0.8 : 1,
        });
      }
    }
  }

  /** Schild mit Canvas-Text. def: { text, sub, bg, fg, style } registriert unter key. */
  defineSign(key, def) { this.signDefs[key] = def; return this; }
  sign(x, y, z, w, h, key, o = {}) {
    this.signs.push({ x, y, z, w, h, key, ry: o.ry || 0, lit: !!o.lit, back: o.back !== false, depth: o.depth ?? 0.05, frame: o.frame });
    return this;
  }

  /** Pflanze/Foliage-Karte (instanziert). kind: 'bush'|'grass'|'weeds'|'palm'|'olive'|'ivy'|'flowers'|'reeds' */
  plant(kind, x, y, z, o = {}) {
    this.plants.push({ kind, x, y, z, s: o.s ?? (0.8 + this.rand() * 0.5), ry: o.ry ?? this.rand() * Math.PI * 2, tint: o.tint });
    return this;
  }

  /**
   * Lichtquelle (Punkt/Spot). Wird beim Aufbau als echtes Licht erzeugt (begrenzte Anzahl; nicht auf low) und ins
   * Sonden-Gitter gebacken. o.realtime: false = nur gebacken (kostet zur Laufzeit nichts), o.bake: false = nicht
   * backen, o.group 0..2 = Lichtgruppe (sonst nach Farbe: warm/kalt/rot).
   */
  light(type, x, y, z, o = {}) { this.lights.push({ type, x, y, z, ...o }); return this; }

  /** Weicher Lichthof um eine Lampe (additiver Punkt-Sprite; alle Lichthöfe zusammen ein Draw Call). */
  glow(x, y, z, o = {}) { this.glows.push({ x, y, z, size: o.size ?? 1.4, color: o.color || '#ffb060', intensity: o.intensity ?? 1 }); return this; }

  /** Separates Objekt (animiert, nicht verschmolzen). */
  object(obj, o = {}) { this.objects.push({ object: obj, update: o.update || null, bullet: o.bullet || false, surface: o.surface }); return this; }

  /** Steht das Bibliotheksmodell zur Verfügung (Bibliothek nutzbar und Modell im Manifest)? */
  hasModel(id) { return !!this.lib && this.lib.has(id); }

  /**
   * Requisite aus der Asset-Bibliothek (glb, instanziert, LOD nach Abstand). (x, y, z) = Unterkante-Mitte des
   * Hüllquaders (o.pivot 'center': Mitte), Drehung ry/rx/rz um diesen Punkt, Skalierung s bzw. sx/sy/sz.
   * o: { part (Teil/Variante, z. B. 'exterior_aircon_unit_rusted'), collide (true; ab 0,25 m Höhe Quader-Kollision),
   *      shrink (Kollisionsquader waagerecht verkleinern, 0..1), bullet (true: Dreiecke der gröbsten Stufe), minimap,
   *      surface, tint (Instanzfarbe), interior (false: kein gebackenes Innenraumlicht), maxDist, castShadow,
   *      fallback: (b) => … prozeduraler Ersatz, falls das Modell nicht lädt }
   */
  model(id, x, y, z, o = {}) { this.models.push({ id, x, y, z, o: this._noCollide ? { ...o, collide: false } : o }); return this; }

  // ---------------------------------------------------------------------------
  // Fertigstellung
  // ---------------------------------------------------------------------------
  /** Rasterisiert Footprints am Boden für weiche Kontaktschatten. */
  _groundAORaster() {
    const b = this.bounds, res = 0.25;
    const W = Math.ceil((b.maxX - b.minX) / res) + 8, H = Math.ceil((b.maxZ - b.minZ) / res) + 8;
    const ox = b.minX - 4 * res, oz = b.minZ - 4 * res;
    const occ = new Float32Array(W * H);
    for (const f of this.footprints) {
      if (f.y0 > 0.6 || f.kind === 'floor' || f.kind === 'water' || f.kind === 'zone') continue;
      const h = f.y1 - Math.max(0, f.y0);
      if (h < 0.15) continue;
      const val = Math.min(1, h / 1.4) * (f.y0 > 0.25 ? 0.5 : 1);
      const c = Math.cos(f.ry), s = Math.sin(f.ry);
      const ex = Math.abs(c) * f.hw + Math.abs(s) * f.hd, ez = Math.abs(s) * f.hw + Math.abs(c) * f.hd;
      const i0 = Math.max(0, Math.floor((f.x - ex - ox) / res)), i1 = Math.min(W - 1, Math.ceil((f.x + ex - ox) / res));
      const j0 = Math.max(0, Math.floor((f.z - ez - oz) / res)), j1 = Math.min(H - 1, Math.ceil((f.z + ez - oz) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = ox + (i + 0.5) * res - f.x, pz = oz + (j + 0.5) * res - f.z;
        const lx = px * c - pz * s, lz = px * s + pz * c;
        if (Math.abs(lx) <= f.hw && Math.abs(lz) <= f.hd) { const o = j * W + i; if (val > occ[o]) occ[o] = val; }
      }
    }
    // zweimal Box-Blur (≈ Gauß)
    const tmp = new Float32Array(W * H);
    const blurPass = (src, dst, r, horiz) => {
      const k = 1 / (2 * r + 1);
      if (horiz) for (let j = 0; j < H; j++) { let acc = 0; for (let i = -r; i <= r; i++) acc += src[j * W + Math.min(W - 1, Math.max(0, i))]; for (let i = 0; i < W; i++) { dst[j * W + i] = acc * k; acc += src[j * W + Math.min(W - 1, i + r + 1)] - src[j * W + Math.max(0, i - r)]; } }
      else for (let i = 0; i < W; i++) { let acc = 0; for (let j = -r; j <= r; j++) acc += src[Math.min(H - 1, Math.max(0, j)) * W + i]; for (let j = 0; j < H; j++) { dst[j * W + i] = acc * k; acc += src[Math.min(H - 1, j + r + 1) * W + i] - src[Math.max(0, j - r) * W + i]; } }
    };
    for (let pass = 0; pass < 2; pass++) { blurPass(occ, tmp, 3, true); blurPass(tmp, occ, 3, false); }
    this._aoRaster = { occ, W, H, ox, oz, res };
    return this._aoRaster;
  }

  _sampleAO(x, z) {
    const r = this._aoRaster; if (!r) return 0;
    const fx = (x - r.ox) / r.res - 0.5, fz = (z - r.oz) / r.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const g = (a, b) => (a < 0 || b < 0 || a >= r.W || b >= r.H) ? 0 : r.occ[b * r.W + a];
    return (g(i, j) * (1 - tx) + g(i + 1, j) * tx) * (1 - tz) + (g(i, j + 1) * (1 - tx) + g(i + 1, j + 1) * tx) * tz;
  }

  /** Gebackenes Innenraumlicht: dunkler und leicht warm (Himmelslicht dringt kaum ein). → Volumen oder null */
  _interiorAt(x, y, z) {
    const g = this._interiorGrid || this._buildInteriorGrid();
    const list = g.cells.get(Math.floor(x / g.cs) * 8192 + Math.floor(z / g.cs));
    if (!list) return null;
    let best = null;
    for (const v of list) {
      if (x > v.minX && x < v.maxX && z > v.minZ && z < v.maxZ && y > v.minY && y < v.maxY && (!best || v.factor < best.factor)) best = v;
    }
    return best;
  }

  /** Raster (4 m) über die Innenraum-Volumen: jede Ecke prüft nur die Volumen ihrer Zelle. */
  _buildInteriorGrid() {
    const cs = 4, cells = new Map();
    for (const v of this.interiors) {
      for (let i = Math.floor(v.minX / cs); i <= Math.floor(v.maxX / cs); i++) for (let j = Math.floor(v.minZ / cs); j <= Math.floor(v.maxZ / cs); j++) {
        const k = i * 8192 + j;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(v);
      }
    }
    this._interiorGrid = { cs, cells };
    return this._interiorGrid;
  }

  /** Großflächiges Farb-Rauschen (Kachelwiederholung kaschieren) */
  _noise(x, z) {
    const h = (i, j) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const val = (sx, sz) => {
      const i = Math.floor(sx), j = Math.floor(sz), tx = sx - i, tz = sz - j;
      const fx = tx * tx * (3 - 2 * tx), fz = tz * tz * (3 - 2 * tz);
      return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fz) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fz;
    };
    return val(x / 9, z / 9) * 0.6 + val(x / 3.1 + 17, z / 3.1 + 5) * 0.4;
  }

  /**
   * Baut Meshes, BVHs und Collider. onProgress(0..1, label).
   * @returns {Promise<object>} Ergebnis mit group, meshes, objects, bulletTris/bulletData (Kugel-Dreiecke), colTris (Kollision) …
   */
  async build({ onProgress, quality = 'high', anisotropy = 4 } = {}) {
    this._quality = quality;
    this._anisotropy = anisotropy;
    const step = async (p, label) => { onProgress?.(p, label); await new Promise(r => setTimeout(r, 0)); };
    // Hauptthread in Zeitscheiben freigeben (Ladebalken, Eingaben), ohne bei jedem Schritt zu warten
    let slice = performance.now();
    const breathe = async () => { if (performance.now() - slice > 12) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); } };
    const group = new THREE.Group();
    group.name = 'world-static';

    // Materialien: Fotoscan-Sätze + Requisiten aus der Bibliothek laden (Netz) und gleichzeitig die übrigen
    // prozeduralen Texturen im Worker-Pool erzeugen
    const extra = ['concrete'];
    if (this.signs.length) extra.push('metal_painted');
    const used = [...new Set([...this.materials, ...extra, ...libraryPendingNames()])];
    let libP = null, libFrac = 0, procFrac = 0;
    const report = (label) => onProgress?.(0.05 + (libP ? (libFrac * 0.7 + procFrac * 0.3) : procFrac) * 0.5, label);
    if (this.library) libP = this.library({ names: used, models: [...new Set(this.models.map(m => m.id))] }, (p, l) => { libFrac = p; report(l); });
    const [libRes] = await Promise.all([libP, preloadMaterials(proceduralNames(used), (p, n) => { procFrac = p; report('Texturen: ' + n); })]);
    await step(0.56, 'Geometrie');
    this._resolveModels(libRes?.models || new Map());
    this._groundAORaster();

    // Buckets → finale Vertexfarben
    const perMat = new Map();
    for (const bk of this.buckets.values()) {
      await breathe();
      const n = bk.pos.n / 3;
      if (!n) continue;
      const P = bk.pos.a, N = bk.nor.a, C = bk.col.a, F = bk.flg.a;
      for (let i = 0; i < n; i++) {
        const fl = F[i];
        if (!fl) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        let k = 1;
        if (fl & F_INTERIOR && this.interiors.length) {
          const v = this._interiorAt(x + N[i * 3] * 0.06, y + N[i * 3 + 1] * 0.06, z + N[i * 3 + 2] * 0.06);
          if (v) { k *= v.factor; if (v.tint) { C[i * 3] *= v.tint[0]; C[i * 3 + 1] *= v.tint[1]; C[i * 3 + 2] *= v.tint[2]; } }
        }
        if (fl & F_GROUND && y < 0.6) k *= 1 - this._sampleAO(x, z) * 0.62;
        if (fl & F_NOISE) k *= 1 - this.groundNoise * 0.5 + this._noise(x, z) * this.groundNoise;
        if (k !== 1) { C[i * 3] *= k; C[i * 3 + 1] *= k; C[i * 3 + 2] *= k; }
      }
      const key = bk.mat + (bk.matOpts ? JSON.stringify(bk.matOpts) : '');
      if (!perMat.has(key)) perMat.set(key, []);
      perMat.get(key).push(bk);
    }

    // Meshes erzeugen: kleine Materialien in einem Mesh, große pro Chunk
    const meshes = [];
    const makeMesh = (list, mat, matOpts, cast) => {
      let total = 0; for (const b of list) total += b.pos.n;
      const pos = new Float32Array(total), nor = new Float32Array(total), col = new Float32Array(total), uv = new Float32Array(total / 3 * 2);
      const bullet = new Uint8Array(total / 9);
      let o = 0, ou = 0, ot = 0;
      for (const b of list) {
        pos.set(b.pos.view(), o); nor.set(b.nor.view(), o); col.set(b.col.view(), o); uv.set(b.uv.view(), ou); bullet.set(b.bullet.view(), ot);
        o += b.pos.n; ou += b.uv.n; ot += b.bullet.n;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const material = getMaterial(mat, { ...(matOpts || {}), vertexColors: true });
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.name = mat;
      mesh.userData.surface = material.userData.surface;
      mesh.userData.bullet = bullet;
      group.add(mesh);
      meshes.push(mesh);
      return mesh;
    };
    for (const list of perMat.values()) {
      const { mat, matOpts } = list[0];
      let tris = 0; for (const b of list) tris += b.pos.n / 9;
      for (const cast of [true, false]) {
        const sub = list.filter(b => b.cast === cast);
        if (!sub.length) continue;
        // erst ab vielen Dreiecken pro Chunk teilen (weniger Draw Calls; Karten sind kompakt)
        if (tris < (quality === 'low' ? Infinity : this.splitTris)) makeMesh(sub, mat, matOpts, cast);
        else for (const b of sub) makeMesh([b], mat, matOpts, cast);
      }
      await breathe();
    }
    await step(0.62, 'Details');

    // Decals, Schilder, Foliage
    const decalMeshes = this._buildDecals(group);
    const signMesh = this._buildSigns(group, meshes);
    const foliage = createFoliage(this.plants, quality);
    for (const f of foliage.meshes) group.add(f);

    // Lichter (Definitionen bleiben für die Lichtgruppen des Sonden-Gitters erhalten – auf low nur gebacken)
    const lights = [];
    const lightDefs = this.lights.map(L => ({ ...L }));
    for (const L of (quality === 'low' ? [] : this.lights)) {
      if (L.realtime === false) continue; // nur gebacken (Sonden-Gitter)
      let light;
      if (L.type === 'spot') {
        light = new THREE.SpotLight(L.color || '#ffd7a0', L.intensity ?? 20, L.distance ?? 18, L.angle ?? 0.9, L.penumbra ?? 0.6, 2);
        light.target.position.set(L.tx ?? L.x, L.ty ?? 0, L.tz ?? L.z);
        group.add(light.target);
      } else light = new THREE.PointLight(L.color || '#ffd7a0', L.intensity ?? 10, L.distance ?? 12, 2);
      light.position.set(L.x, L.y, L.z);
      light.castShadow = false;
      light.userData.priority = L.priority ?? 1;
      group.add(light);
      lights.push(light);
    }
    for (const ob of this.objects) group.add(ob.object);
    this._buildGlows(group);
    const props = this._props ? this._props.build() : null;
    if (props) group.add(props);

    await step(0.66, 'Kugel-Geometrie');
    // Dreiecke für die Kugel-BVH aus sichtbarer Geometrie (pro Dreieck: Oberfläche + Mesh-Index);
    // die BVHs selbst baut loadWorld im Welt-Worker (worldgen.js)
    const objects = [];
    let triCount = 0;
    for (const m of meshes) { const b = m.userData.bullet; for (let i = 0; i < b.length; i++) triCount += b[i]; }
    let btris = new Float32Array(triCount * 9), bdata = new Uint32Array(triCount);
    // Albedo je Kugel-Dreieck (linear·255): Materialfarbe × mittlere Textur × Vertexfarbe – Farbe des Sonnen-Rückpralls
    // im Sonden-Gitter (world/probes.js)
    let balb = new Uint8Array(triCount * 3);
    let bi = 0;
    meshes.forEach(m => {
      const objIndex = objects.push(m) - 1;
      const pos = m.geometry.attributes.position.array, bl = m.userData.bullet;
      const col = m.geometry.attributes.color?.array || null;
      const alb = materialAlbedo(m.material);
      const sid = SURF_INDEX[m.userData.surface] ?? 0;
      for (let t = 0; t < bl.length; t++) {
        if (!bl[t]) continue;
        btris.set(pos.subarray(t * 9, t * 9 + 9), bi * 9);
        for (let ch = 0; ch < 3; ch++) {
          const vc = col ? (col[t * 9 + ch] + col[t * 9 + 3 + ch] + col[t * 9 + 6 + ch]) / 3 : 1;
          balb[bi * 3 + ch] = Math.min(255, Math.round(alb[ch] * vc * 255));
        }
        bdata[bi++] = sid | (objIndex << 8);
      }
      delete m.userData.bullet;
    });
    // Kugeltreffer auf Bibliotheks-Requisiten (gröbste LOD-Stufe je Instanz)
    if (this._propBullet && this._propBullet.tris.n) {
      const pb = this._propBullet, n = pb.tris.n / 9;
      const t2 = new Float32Array((bi + n) * 9), d2 = new Uint32Array(bi + n), a2 = new Uint8Array((bi + n) * 3);
      t2.set(btris.subarray(0, bi * 9)); d2.set(bdata.subarray(0, bi)); a2.set(balb.subarray(0, bi * 3));
      t2.set(pb.tris.view(), bi * 9);
      const objIdx = new Map();
      for (let i = 0; i < n; i++) {
        const g = pb.group[i];
        let k = objIdx.get(g);
        if (k === undefined) { k = objects.push(this._props.hitObject(g) || group) - 1; objIdx.set(g, k); }
        d2[bi + i] = pb.surf[i] | (k << 8);
        const a = PROP_ALBEDO[SURFACES[pb.surf[i]]] ?? 0.35;
        a2[(bi + i) * 3] = a2[(bi + i) * 3 + 1] = a2[(bi + i) * 3 + 2] = Math.round(a * 255);
      }
      btris = t2; bdata = d2; balb = a2; bi += n; triCount += n;
    }

    // Kollisionsgeometrie (Weltkoordinaten, 9 Floats je Dreieck)
    const colArr = this.colTris.view().slice();

    let drawTris = 0; for (const m of meshes) drawTris += m.geometry.attributes.position.count / 3;
    const stats = { meshes: meshes.length, triangles: drawTris, bulletTris: triCount, colliderTris: colArr.length / 9, prims: this.stats.prims, signAtlas: this.signAtlasSize || null };
    this._releaseScratch();
    if (this._props) Object.assign(stats, { propInstances: this._props.stats.instances, propGroups: this._props.stats.groups, propMeshes: this._props.stats.meshes, propFallbacks: this._propFallbacks || 0 });
    const propsOut = this._props;
    this._props = null; this._propBullet = null;
    return {
      group, meshes, decalMeshes, signMesh, foliage, lights, objects, props: propsOut,
      bulletTris: btris, bulletData: bdata, bulletAlbedo: balb, colTris: colArr, lightDefs,
      stats,
    };
  }

  /**
   * Bau-Zwischendaten freigeben (nach build()): Die Buckets sind in die Meshes kopiert, Bodenraster und
   * Innenraumgitter wurden nur für die Vertexfarben gebraucht, Decal-/Schild-/Pflanzen-/Licht-Listen sind verbaut.
   * Danach bleiben nur footprints, navPoints, navExclude und objects (Minikarte, Navigation, world.update).
   */
  _releaseScratch() {
    this.buckets.clear();
    this.colTris = new FBuf(16);
    this._aoRaster = null;
    this._interiorGrid = null;
    this.interiors = [];
    this.navBlockers = [];
    this.decals = [];
    this.signs = [];
    this.signDefs = {};
    this.plants = [];
    this.lights = [];
    this.glows = [];
    this.floors = [];
    this.models = [];
    this.materials.clear();
  }

  /**
   * Bibliotheks-Requisiten auflösen (nach dem Laden): Instanzen anlegen, Kollision, Footprint, Kugeltreffer;
   * fehlt ein Modell, zeichnet der prozedurale Ersatz (o.fallback) in die Buckets.
   *
   * Mehrspieler: Die Bewegungskollision darf nicht davon abhängen, ob das Modell geladen wurde (Grafikstufe „niedrig“
   * überspringt Modelle über dem Download-Budget, Zeitlimit, Netz). Deshalb: Kollisionsquader immer aus den
   * Manifest-Maßen (`size`, gleich für alle Texturstufen) – geladen oder nicht –, und der Ersatz ist reine Optik
   * (seine eigenen Kollisionsaufrufe werden verworfen). Teil-Auswahl (o.part) hat keine Manifest-Maße → keine
   * automatische Kollision (die Karte setzt dann einen festen Quader, vgl. festesModell in hafen-ausstattung.js).
   */
  _resolveModels(templates) {
    if (!this.models.length) return;
    const props = new PropInstances({ quality: this._quality });
    const bullet = { tris: new FBuf(65536), surf: [], group: [] };
    let fallbacks = 0;
    const col = new THREE.Color(), tmpBox = new THREE.Box3(), v = new THREE.Vector3(), mCol = new THREE.Matrix4(), tr = new THREE.Matrix4();
    const sizeBox = new THREE.Box3();
    const manifest = assets.manifest && assets.manifest.models;
    for (const pl of this.models) {
      const { id, x, y, z, o } = pl;
      const tpl = templates.get(id);
      // Kollision (unabhängig vom Laden): Hüllquader in Manifest-Maßen, Unterkante-Mitte im Ursprung
      const ms = manifest && manifest[id] && manifest[id].size;
      if (o.collide !== false && !o.part && Array.isArray(ms) && ms.length === 3) {
        sizeBox.min.set(-ms[0] / 2, 0, -ms[2] / 2); sizeBox.max.set(ms[0] / 2, ms[1], ms[2] / 2);
        this._modelCollision(sizeBox, x, y, z, o, tmpBox, v, mCol, tr);
      }
      if (!tpl) {
        if (o.fallback) {
          this._noCollide = (this._noCollide || 0) + 1;
          try { o.fallback(this); } finally { this._noCollide--; }
          fallbacks++;
        }
        continue;
      }
      const parts = PropInstances.selectParts(tpl, o.part);
      const box = PropInstances.boxOf(tpl, parts);
      const M = placementMatrix(box, x, y, z, o);
      // Instanzfarbe: gebackenes Innenraumlicht (wie die Wände ringsum) × Tönung
      let color = null;
      if (o.tint) color = col.set(o.tint).clone();
      if (o.interior !== false && this.interiors.length) {
        tmpBox.copy(box).applyMatrix4(M); tmpBox.getCenter(v);
        const iv = this._interiorAt(v.x, Math.min(v.y, tmpBox.min.y + 0.5), v.z);
        if (iv) { color = color || new THREE.Color(1, 1, 1); color.multiplyScalar(iv.factor); if (iv.tint) color.multiply(col.setRGB(iv.tint[0], iv.tint[1], iv.tint[2])); }
      }
      const g = props.add(tpl, parts, M, color, o);
      // ohne Manifest-Maße (sollte nicht vorkommen): wie bisher aus der geladenen Vorlage
      if (o.collide !== false && !o.part && !(Array.isArray(ms) && ms.length === 3)) this._modelCollision(box, x, y, z, o, tmpBox, v, mCol, tr);
      if (o.bullet !== false) {
        const sid = SURF_INDEX[o.surface || MODEL_SURFACE[id] || 'metal'] ?? 1;
        forEachBulletTri(tpl, parts, M, (...t) => {
          bullet.tris.ensure(9); bullet.tris.a.set(t, bullet.tris.n); bullet.tris.n += 9;
          bullet.surf.push(sid); bullet.group.push(g);
        });
      }
    }
    this._props = props.stats.instances ? props : null;
    if (globalThis.__npCheckModelSizes) this._checkModelSizes(templates);
    this.modelIdsUsed = [...new Set(this.models.filter(m => templates.get(m.id)).map(m => m.id))];
    this._propBullet = bullet;
    this._propFallbacks = fallbacks;
  }

  /** Kollisionsquader + Footprint einer Bibliotheks-Platzierung (box = Hüllquader in Modellmaßen). */
  _modelCollision(box, x, y, z, o, tmpBox, v, mCol, tr) {
    const M = placementMatrix(box, x, y, z, o);
    const size = box.getSize(v);
    const sx = size.x, sy = size.y, sz = size.z;
    const sc = new THREE.Vector3(); M.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    const h = sy * sc.y;
    if (h < (o.minCollideH ?? 0.25)) return;
    const k = o.shrink ?? 1;
    tr.makeTranslation((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    mCol.multiplyMatrices(M, tr);
    // Quader in Modellmaßen (die Skalierung steckt in mCol); waagerecht ggf. verkleinert
    this._collTris(collBox(sx * k, Math.min(sy, (o.collideH ?? Infinity) / sc.y), sz * k), mCol);
    tmpBox.copy(box).applyMatrix4(M);
    const tilted = !!(o.rx || o.rz);
    const kind = o.minimap ?? (h > 1.0 ? 'cover' : 'prop');
    if (tilted) this._footprint((tmpBox.min.x + tmpBox.max.x) / 2, (tmpBox.min.z + tmpBox.max.z) / 2, (tmpBox.max.x - tmpBox.min.x) * k, (tmpBox.max.z - tmpBox.min.z) * k, 0, tmpBox.min.y, tmpBox.max.y, kind);
    else { v.set((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2).applyMatrix4(M); this._footprint(v.x, v.z, sx * sc.x * k, sz * sc.z * k, o.ry || 0, tmpBox.min.y, tmpBox.max.y, kind); }
  }

  /** Prüfhilfe (globalThis.__npCheckModelSizes = true): Manifest-Maße gegen geladene Vorlagen; Abweichungen > 1 cm
   *  landen in globalThis.__npModelSizeMismatch. */
  _checkModelSizes(templates) {
    const manifest = assets.manifest && assets.manifest.models, s = new THREE.Vector3();
    const out = [];
    for (const [id, tpl] of templates) {
      const ms = tpl && manifest && manifest[id] && manifest[id].size;
      if (!ms) continue;
      tpl.box.getSize(s);
      const d = Math.max(Math.abs(s.x - ms[0]), Math.abs(s.y - ms[1]), Math.abs(s.z - ms[2]));
      if (d > 0.01) out.push(`${id}: Vorlage ${s.x.toFixed(3)}×${s.y.toFixed(3)}×${s.z.toFixed(3)} / Manifest ${ms.join('×')}`);
    }
    (globalThis.__npModelSizeMismatch ||= []).push(...out);
  }

  _buildGlows(group) {
    if (!this.glows.length) return null;
    const n = this.glows.length, P = new Float32Array(n * 3), C = new Float32Array(n * 3), S = new Float32Array(n);
    this.glows.forEach((g, i) => {
      P.set([g.x, g.y, g.z], i * 3);
      const c = linearTint(g.color);
      C.set([c[0] * g.intensity, c[1] * g.intensity, c[2] * g.intensity], i * 3);
      S[i] = g.size;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(S, 1));
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute vec3 aColor; uniform float uScale; varying vec3 vColor; varying float vFade;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = -mv.z;
          gl_PointSize = clamp(aSize * uScale / max(d, 0.5), 1.0, 160.0); vColor = aColor; vFade = clamp(1.0 - d / 240.0, 0.0, 1.0) * smoothstep(0.4, 2.5, d); }`,
      fragmentShader: `varying vec3 vColor; varying float vFade;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; float a = pow(1.0 - d, 2.4) * vFade; gl_FragColor = vec4(vColor * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    mat.userData.disposable = true;
    const pts = new THREE.Points(geo, mat);
    pts.name = 'glows'; pts.renderOrder = 5; pts.matrixAutoUpdate = false;
    const v2 = new THREE.Vector2();
    pts.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(v2);
      mat.uniforms.uScale.value = v2.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 60) / 2));
    };
    group.add(pts);
    return pts;
  }

  _buildDecals(group) {
    if (!this.decals.length) return [];
    const mats = createDecalMaterials(this._quality);
    const byKind = { grime: [], wet: [], paint: [], light: [] };
    for (const d of this.decals) byKind[d.kind]?.push(d);
    const out = [];
    const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3();
    for (const kind of Object.keys(byKind)) {
      const list = byKind[kind];
      if (!list.length) continue;
      const P = [], N = [], U = [], C = [];
      for (const d of list) {
        const cell = d.cell, cu = (cell % 4) / 4, cv = 1 - (Math.floor(cell / 4) + 1) / DECAL_ROWS;
        nrm.set(...(d.normal || [0, 1, 0])).normalize();
        let ax = null, bx = null;
        if (d.tangent) {
          // feste Ausrichtung: Breite entlang −tangent, Höhe entlang (−tangent) × nrm (bei Wänden: nach oben);
          // so zeigt die Vorderseite (bx × ax = nrm) aus der Wand heraus
          ax = new THREE.Vector3(...d.tangent).normalize().negate();
          bx = new THREE.Vector3().crossVectors(ax, nrm);
        } else {
          q.setFromUnitVectors(up, nrm);
          q2.setFromAxisAngle(up, d.ry);
          q.multiply(q2);
        }
        const tint = linearTint(d.tint).slice();
        // gebackenes Innenraumlicht wie bei der Wand dahinter
        const iv = this.interiors.length ? this._interiorAt(d.x + nrm.x * 0.06, d.y + nrm.y * 0.06, d.z + nrm.z * 0.06) : null;
        if (iv) for (let c = 0; c < 3; c++) tint[c] *= iv.factor * (iv.tint ? iv.tint[c] : 1);
        const corners = [[-d.w / 2, -d.d / 2, 0, 0], [d.w / 2, -d.d / 2, 1, 0], [d.w / 2, d.d / 2, 1, 1], [-d.w / 2, d.d / 2, 0, 1]];
        const lift = 0.012;
        for (const k of [0, 2, 1, 0, 3, 2]) {
          const [a, b, u, w] = corners[k];
          if (ax) v.set(ax.x * a + bx.x * b, ax.y * a + bx.y * b, ax.z * a + bx.z * b);
          else v.set(a, 0, b).applyQuaternion(q);
          P.push(d.x + v.x + nrm.x * lift, d.y + v.y + nrm.y * lift, d.z + v.z + nrm.z * lift);
          N.push(nrm.x, nrm.y, nrm.z);
          U.push(cu + (u * 0.98 + 0.01) / 4, cv + (w * 0.98 + 0.01) / DECAL_ROWS);
          C.push(tint[0], tint[1], tint[2], d.opacity);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats[kind]);
      mesh.receiveShadow = kind !== 'light'; mesh.renderOrder = kind === 'light' ? 2 : 1; mesh.matrixAutoUpdate = false;
      mesh.name = 'decals-' + kind;
      group.add(mesh);
      out.push(mesh);
    }
    return out;
  }

  _buildSigns(group, meshes) {
    if (!this.signs.length) return null;
    const keys = [...new Set(this.signs.map(s => s.key))];
    const aspectOf = k => { const s = this.signs.find(q => q.key === k); return s.w / s.h; };
    const atlas = createSignAtlas(keys.map(k => ({ key: k, aspect: aspectOf(k), ...(this.signDefs[k] || DEFAULT_SIGNS[k] || { text: k }) })),
      { quality: this._quality, anisotropy: this._anisotropy });
    this.signAtlasSize = [atlas.width, atlas.height];
    const buf = { lit: { P: [], N: [], U: [] }, std: { P: [], N: [], U: [] } };
    const v = new THREE.Vector3(), e = new THREE.Euler(), q = new THREE.Quaternion();
    for (const s of this.signs) {
      const r = atlas.rects[s.key];
      const { P, N, U } = s.lit ? buf.lit : buf.std;
      q.setFromEuler(e.set(0, s.ry, 0));
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const corners = [[-s.w / 2, 0, r.u0, r.v0], [s.w / 2, 0, r.u1, r.v0], [s.w / 2, s.h, r.u1, r.v1], [-s.w / 2, s.h, r.u0, r.v1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [a, b, uu, vv] = corners[k];
        v.set(a, b, s.depth + 0.006).applyQuaternion(q);
        P.push(s.x + v.x, s.y + v.y, s.z + v.z); N.push(n.x, n.y, n.z); U.push(uu, vv);
      }
      // Trägerplatte (mit Kugeltreffer)
      if (s.back) this.box(s.x, s.y - 0.02, s.z, s.w + 0.06, s.h + 0.04, s.depth * 2, s.frame || 'metal_painted', { ry: s.ry, tint: '#3a3d40', collide: false, minimap: false, ao: false, chunk: -1 });
    }
    // Trägerplatten wurden nach dem Mesh-Bau ergänzt → separater kleiner Bucket-Mesh
    const lateBuckets = [...this.buckets.values()].filter(b => b.chunk === -1);
    for (const bk of lateBuckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(bk.pos.view().slice(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(bk.nor.view().slice(), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(bk.uv.view().slice(), 2));
      g.setAttribute('color', new THREE.BufferAttribute(bk.col.view().slice(), 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, getMaterial(bk.mat, { vertexColors: true }));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'sign-backs'; mesh.matrixAutoUpdate = false;
      mesh.userData.surface = 'metal';
      mesh.userData.bullet = bk.bullet.view().slice();
      group.add(mesh); meshes.push(mesh);
      this.buckets.delete([...this.buckets.entries()].find(([, b]) => b === bk)[0]);
    }
    let first = null;
    for (const kind of ['std', 'lit']) {
      const { P, N, U } = buf[kind];
      if (!P.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, kind === 'lit' ? atlas.litMaterial : atlas.material);
      mesh.receiveShadow = true; mesh.name = 'signs-' + kind; mesh.matrixAutoUpdate = false;
      group.add(mesh);
      first = first || mesh;
    }
    return first;
  }
}
