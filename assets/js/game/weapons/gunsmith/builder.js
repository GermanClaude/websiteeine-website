// Geometrie-Baukasten für prozedurale Waffen.
// Koordinaten der Waffe: x = rechts, v = oben (y), u = vorwärts entlang der Laufachse (z = −u).
// Ursprung = Griffpunkt der rechten Hand (Oberkante Pistolengriff). Maßeinheit Meter.
// Alle Teile werden pro Material zusammengeführt (statisch) bzw. pro animiertem Teil separat gehalten.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getMat, UV_SCALE, lodInfo, LOD_SKIP, liteKey } from './materials.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

// Würfel mit 45°-Fasen an allen Kanten (44 Dreiecke, fängt Glanzkanten ein)
export function chamferBoxGeometry(w, h, d, c) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  c = Math.max(0, Math.min(c, hx * 0.95, hy * 0.95, hz * 0.95));
  const half = [hx, hy, hz];
  const V = (s, axis) => s.map((sv, i) => sv * (i === axis ? half[i] : half[i] - c));
  const tris = [];
  const quad = (a, b, cc, d2) => { tris.push(a, b, cc, a, cc, d2); };
  for (let axis = 0; axis < 3; axis++) {
    const [a1, a2] = [0, 1, 2].filter(i => i !== axis);
    for (const s of [-1, 1]) {
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => { const v = [0, 0, 0]; v[axis] = s; v[a1] = p; v[a2] = q; return V(v, axis); });
      quad(cs[0], cs[1], cs[2], cs[3]);
    }
  }
  if (c > 0) {
    for (let e = 0; e < 3; e++) {
      const [a, b] = [0, 1, 2].filter(i => i !== e);
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const mk = (se, face) => { const v = [0, 0, 0]; v[e] = se; v[a] = sa; v[b] = sb; return V(v, face); };
        quad(mk(-1, a), mk(1, a), mk(1, b), mk(-1, b));
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const s = [sx, sy, sz];
      tris.push(V(s, 0), V(s, 1), V(s, 2));
    }
  }
  const pos = new Float32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t += 3) {
    let [A, B, C] = [tris[t], tris[t + 1], tris[t + 2]];
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const g = [A[0] + B[0] + C[0], A[1] + B[1] + C[1], A[2] + B[2] + C[2]];
    if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] < 0) [B, C] = [C, B];
    pos.set(A, t * 3); pos.set(B, t * 3 + 3); pos.set(C, t * 3 + 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// Box-projizierte UVs pro Dreieck (Maserung läuft entlang der Waffenlänge)
export function boxUV(geo, scale = UV_SCALE) {
  const p = geo.attributes.position.array, n = p.length / 3;
  const uv = new Float32Array(n * 2), inv = 1 / scale;
  for (let t = 0; t < n; t += 3) {
    const i = t * 3;
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
    for (let k = 0; k < 3; k++) {
      const j = (t + k) * 3, x = p[j], y = p[j + 1], z = p[j + 2];
      let U, W;
      if (nx >= ny && nx >= nz) { U = z; W = y; } else if (ny >= nz) { U = z; W = x; } else { U = x; W = y; }
      uv[(t + k) * 2] = U * inv; uv[(t + k) * 2 + 1] = W * inv;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Gebrauchsspuren an Fasen (PC): Dreiecke, deren Normale im Bauteil-Raum schräg steht, sind Fasen/Rundungen einer
// Kiste bzw. die Fasen einer Extrusion – dort reibt sich die Oberfläche blank (Attribut wearDirt.x; Fleckigkeit im Shader)
function edgeWear(geo, kind) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position.array, n = p.length / 3, wd = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const i = t * 3;
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx = Math.abs(nx / l); ny = Math.abs(ny / l); nz = Math.abs(nz / l);
    let w;
    if (kind === 'box') w = Math.max(nx, ny, nz) < 0.93 ? 1 : 0;
    else w = nz > 0.12 && nz < 0.96 ? 1 : 0;   // Extrusion: Deckel z-gerichtet, Wände ⟂ z, Fasen dazwischen
    for (let k = 0; k < 3; k++) wd[(t + k) * 2] = w;
  }
  g.setAttribute('wearDirt', new THREE.BufferAttribute(wd, 2));
  return g;
}

function normalizeGeo(geo, keepUV) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'wearDirt' && !(keepUV && name === 'uv')) g.deleteAttribute(name);   // wearDirt: Gebrauchsspuren (cavityColors)
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!keepUV || !g.attributes.uv) boxUV(g);
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

// Kontur-Hilfen: Punktliste [[a,b],…] → THREE.Shape (optional Rundungen über 'arc'-Einträge)
export function shapeFrom(pts, holes = []) {
  const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([a, b]) => new THREE.Vector2(a, b))));
  return s;
}

// Abgerundetes Rechteck/Langloch als Punktliste
export function roundRect(a0, b0, a1, b1, r, seg = 3) {
  const pts = [];
  r = Math.min(r, (a1 - a0) / 2, (b1 - b0) / 2);
  const corners = [[a1 - r, b0 + r, -Math.PI / 2], [a1 - r, b1 - r, 0], [a0 + r, b1 - r, Math.PI / 2], [a0 + r, b0 + r, Math.PI]];
  for (const [ca, cb, st] of corners) for (let i = 0; i <= seg; i++) {
    const t = st + (i / seg) * Math.PI / 2;
    pts.push([ca + Math.cos(t) * r, cb + Math.sin(t) * r]);
  }
  return pts;
}

// Kreis/Ellipse als Punktliste
export function ellipsePts(ca, cb, ra, rb, seg = 16, a0 = 0, a1 = Math.PI * 2) {
  const pts = [], closed = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6, n = closed ? seg : seg + 1;
  for (let i = 0; i < n; i++) { const t = a0 + (a1 - a0) * i / seg; pts.push([ca + Math.cos(t) * ra, cb + Math.sin(t) * rb]); }
  return pts;
}

// Detailstufe der Ego-Modelle (Nutzer 13.10.2026: „den PC so originalgetreu wie möglich, beim Handy eine abgeschwächte
// Version“): grobe Zeiger (Touch) → leichte Fassung, sonst volle Auflösung (feinere Distanzfeld-Netze, echte Durchbrüche).
// 15.10. (Nutzer: Bildeinbrüche, ältere Grafikkarten): volle Fassung nur auf den PC-Stufen hoch/ultra (setWeaponDetail,
// vom Viewmodel je Match gesetzt); niedrig/mittel am PC bekommen die Standardfassung, Touch eine noch leichtere (lite).
const PC = !(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
export const DETAIL = { pc: PC, max: PC, lite: !PC };
/** Detailstufe der Ego-Modelle nach Grafikstufe (Vitrine/Arsenal ohne Aufruf: volle Fassung am PC). */
export function setWeaponDetail(quality) {
  DETAIL.max = PC && (quality === 'high' || quality === 'ultra');
  DETAIL.lite = !PC;
}

// ---------------------------------------------------------------- Bauteil-Cache (24.10.2026, Vorarbeit V3)
// Jede Aufsatz-Kombination war ein kompletter Neubau (M-17 am PC ≈ 4,8 s und ≈ 61 MB Geometrie je Kombination). Teure
// Netze (Distanzfelder, Profile) hängen aber nicht von den Aufsätzen ab: Ein Bauplan legt sie in b.shared(id, fn) an,
// sie werden je (Modell, Stufe, Block) einmal gerechnet und in allen Varianten wiederverwendet. Beim Zusammenführen je
// Teil × Material stehen die geteilten Stücke vorn; das fertige Netz wird geteilt, solange es dieselben Stücke enthält
// (übrige Stücke per Prüfsumme verglichen) – dann bleiben Draw Calls und Aussehen genau wie beim Neubau. Weicht eine
// spätere Variante ab (z. B. andere Optik aus demselben Material), bekommt sie die geteilten Stücke als Ausschnitt des
// ersten Netzes (ohne Kopie) und die übrigen als eigenes Netz (ein Draw Call mehr statt doppeltem Speicher).
// Regel: Ein geteilter Block legt nur Geometrie an (keine Teile, Anker, Meta) und hängt nicht von b.att ab.
const SHARED = new Map();   // 'Modell:Stufe:Block' → [{ part, geo, mat, order }]
const MERGED = new Map();   // 'Modell:Stufe:Teil|Material|Ordnung|Signatur' → zusammengeführte Geometrie
const SHONLY = new Map();   // 'Modell:Stufe:Teil|Material|Ordnung|geteilte Stücke' → Ausschnitt nur der geteilten Stücke

// Prüfsumme einer Geometrie (alle Attribute als 32-Bit-Wörter, zwei unabhängige Streuwerte)
function geoSig(g) {
  let h1 = 0x811c9dc5 | 0, h2 = 0x9747b28c | 0;
  for (const name of ['position', 'normal', 'uv', 'wearDirt']) {
    const a = g.attributes[name];
    h1 = Math.imul(h1 ^ name.length, 16777619);
    if (!a) continue;
    const w = new Uint32Array(a.array.buffer, a.array.byteOffset, a.array.length);
    for (let i = 0; i < w.length; i++) { h1 = Math.imul(h1 ^ w[i], 16777619); h2 = Math.imul(h2 ^ w[i], 0x5bd1e995); h2 ^= h2 >>> 15; }
  }
  return g.attributes.position.count + '.' + (h1 >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36);
}

// Geteilte Stücke auf Ausschnitte des zusammengeführten Netzes umlenken (Speicher nur einmal, nicht doppelt)
function viewInto(merged, items) {
  let off = 0;
  for (const it of items) {
    const n = it.geo.attributes.position.count;
    if (it.shared) {
      for (const [name, a] of Object.entries(it.geo.attributes)) {
        const m = merged.attributes[name];
        if (m && a.array.byteOffset === 0 && a.array.buffer.byteLength === a.array.byteLength) it.geo.setAttribute(name, new THREE.BufferAttribute(m.array.subarray(off * a.itemSize, (off + n) * a.itemSize), a.itemSize));
      }
    }
    off += n;
  }
}

// Ausschnitt der ersten n Ecken eines Netzes als eigene Geometrie (teilt die Arrays, keine Kopie)
function prefixView(merged, n) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(merged.attributes)) g.setAttribute(name, new THREE.BufferAttribute(a.array.subarray(0, n * a.itemSize), a.itemSize));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

/** Bauteil-Cache leeren: alle Modelle bzw. nur Modell key (optional nur eine Stufe). Geometrien gibt models.js frei. */
export function clearPartCache(key = null, tier = null) {
  const pre = key ? key + ':' + (tier ? tier + ':' : '') : '';
  for (const m of [SHARED, MERGED, SHONLY]) for (const k of [...m.keys()]) if (k.startsWith(pre)) m.delete(k);
}

export class Builder {
  // tier: feste Detailstufe 'max' | 'std' | 'lite' (24.10., V4 – z. B. Schießstand: alle Waffen leicht vorbauen),
  // sonst nach DETAIL
  constructor(lod = 'first', tier = null) {
    this.lod = lod;
    this.hi = lod !== 'third';
    this.max = this.hi && (tier ? tier === 'max' : DETAIL.max);
    this.lite = this.hi && !this.max && (tier ? tier === 'lite' : DETAIL.lite);
    this.parts = new Map();
    this.anchors = [];
    this.meta = {};
    this.part('static');
  }

  // Animiertes Teil mit Drehpunkt (x, v, u); parent = anderes Teil
  part(name, x = 0, v = 0, u = 0, parent = 'static') {
    if (!this.parts.has(name)) this.parts.set(name, { name, pivot: new THREE.Vector3(x, v, -u), parent: name === 'static' ? null : parent, items: [] });
    return name;
  }

  seg(n, lo) { return this.hi ? n : (lo ?? Math.max(4, Math.round(n / 2.5))); }

  /** Detailstufe als Kennung ('max' | 'std' | 'lite' | 'third'). */
  get tier() { return !this.hi ? 'third' : this.max ? 'max' : this.lite ? 'lite' : 'std'; }

  /**
   * Geteilter Block (Bauteil-Cache, siehe oben): fn() legt teure Netze an; je (this.key, Stufe, id) nur einmal
   * gerechnet, danach werden die fertigen Stücke an derselben Stelle eingehängt. Ohne Modellschlüssel (Werkzeuge)
   * und in der Bot-Stufe einfach fn().
   */
  shared(id, fn) {
    if (!this.hi || !this.key) return fn();
    const ck = this.key + ':' + this.tier + ':' + id;
    const hit = SHARED.get(ck);
    if (hit && hit.every((it) => this.parts.has(it.part))) {
      hit.forEach((it, i) => this.parts.get(it.part).items.push({ geo: it.geo, mat: it.mat, order: it.order, shared: ck + '#' + i }));
      return;
    }
    const before = new Map([...this.parts].map(([n, p]) => [n, p.items.length])), anchors = this.anchors.length;
    fn();
    if (this.anchors.length !== anchors) throw new Error('Bauteil-Cache ' + ck + ': Anker in einem geteilten Block');
    const list = [];
    for (const [n, p] of this.parts) for (let i = before.get(n) ?? 0; i < p.items.length; i++) {
      const it = p.items[i];
      it.shared = ck + '#' + list.length;
      list.push({ part: n, geo: it.geo, mat: it.mat, order: it.order });
    }
    SHARED.set(ck, list);
  }

  _push(geo, mat, o, keepUV = false) {
    if (this.lite) mat = liteKey(mat);   // Handy: Atlas-Materialien mit eigenem, kleinerem Atlas (V4)
    const part = this.parts.get(o.part || 'static');
    if (!part) throw new Error('Unbekanntes Teil ' + o.part);
    if (!this.hi) {
      // Bot-Detailstufe: Durchsicht/Leuchten/Hohlräume und Kleinteile < 9 mm weglassen
      geo.computeBoundingBox();
      const s = geo.boundingBox.getSize(_p);
      const sc = Math.max(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
      if (LOD_SKIP.has(mat) || Math.max(s.x, s.y, s.z) * sc < 0.009) { geo.dispose(); return null; }
    }
    if (this.max && o._edge === 'box') geo = edgeWear(geo, 'box');
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ');
    _q.setFromEuler(_e);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _p.set(o.x || 0, o.v || 0, -(o.u || 0)).sub(part.pivot);
    _m.compose(_p, _q, _s);
    if (o.pre) geo.applyMatrix4(o.pre);
    geo.applyMatrix4(_m);
    const ng = normalizeGeo(geo, keepUV);
    if (this.max && !ng.attributes.wearDirt) ng.setAttribute('wearDirt', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    part.items.push({ geo: ng, mat, order: o.renderOrder || 0 });
    return geo;
  }

  // Quader (Breite x, Höhe v, Länge u), zentriert. o.c = Fase, o.r = Rundung
  box(mat, w, h, l, x, v, u, o = {}) {
    let geo;
    if (this.hi && o.r) geo = roundedBox(w, h, l, o.r, o.rs ?? 1);
    else if (this.hi && o.c !== 0) geo = chamferBoxGeometry(w, h, l, o.c ?? Math.min(w, h, l) * 0.12);
    else geo = new THREE.BoxGeometry(w, h, l);
    return this._push(geo, mat, { ...o, x, v, u, _edge: 'box' });
  }

  // Zylinder entlang u (Standard), v oder x. rF = Radius vorne/oben, rB = hinten/unten
  cyl(mat, rF, rB, l, x, v, u, o = {}) {
    const seg = this.hi ? (o.seg ?? 16) : Math.min(o.seg ?? 6, 6);
    const geo = new THREE.CylinderGeometry(rF, rB, l, seg, 1, !!o.open, o.t0 ?? 0, o.tl ?? Math.PI * 2);
    if (o.axis === 'v') { /* bereits entlang y */ }
    else if (o.axis === 'x') geo.rotateZ(-Math.PI / 2);
    else geo.rotateX(-Math.PI / 2);
    return this._push(geo, mat, { ...o, x, v, u });
  }

  // Rotationskörper um die u-Achse. pts = [[du, r], …] (du vorwärts ab u)
  lathe(mat, pts, x, v, u, o = {}) {
    const seg = this.hi ? (o.seg ?? 16) : Math.min(o.seg ?? 5, 5);
    if (!this.hi) pts = simplifyProfile(pts, 0.0032);
    const geo = new THREE.LatheGeometry(pts.map(([du, r]) => new THREE.Vector2(Math.max(0, r), du)), seg, o.t0 ?? 0, o.tl ?? Math.PI * 2);
    if (o.axis === 'v') geo.rotateY(0);
    else if (o.axis === 'x') geo.rotateZ(-Math.PI / 2);
    else geo.rotateX(-Math.PI / 2);
    return this._push(geo, mat, { ...o, x, v, u });
  }

  _extrude(shape, depth, bevel, o) {
    const bev = this.hi && bevel > 0 ? Math.min(bevel, depth * 0.45) : 0;
    return new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(1e-4, depth - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev,
      bevelSegments: o.bevelSeg ?? 1, curveSegments: o.curveSeg ?? (this.hi ? 8 : 3), steps: 1,
    });
  }

  // Seitenprofil [[u, v], …] quer extrudiert (Breite entlang x), zentriert bei x
  side(mat, pts, width, x = 0, o = {}) {
    const shape = pts instanceof THREE.Shape ? pts : shapeFrom(pts, this.hi || o.keepHoles ? o.holes : []);
    const bev = o.bevel ?? 0.002;
    const geo = this._extrude(shape, width, bev, o);
    const realBev = this.hi && bev > 0 ? Math.min(bev, width * 0.45) : 0;
    geo.translate(0, 0, -(width - 2 * realBev) / 2);
    if (this.max) edgeWear(geo, 'extrude');
    geo.rotateY(Math.PI / 2);
    return this._push(geo, mat, { ...o, x, v: o.v || 0, u: o.u || 0 });
  }

  // Querschnitt [[x, v], …] entlang u extrudiert (von u bis u + l)
  front(mat, pts, l, u, o = {}) {
    const shape = pts instanceof THREE.Shape ? pts : shapeFrom(pts, this.hi || o.keepHoles ? o.holes : []);
    const bev = o.bevel ?? 0;
    const geo = this._extrude(shape, l, bev, o);
    const realBev = this.hi && bev > 0 ? Math.min(bev, l * 0.45) : 0;
    geo.translate(0, 0, -(l - realBev));
    if (this.max) edgeWear(geo, 'extrude');
    return this._push(geo, mat, { ...o, x: o.x || 0, v: o.v || 0, u });
  }

  // Draufsicht [[x, u], …] entlang v extrudiert (Höhe h, zentriert bei v)
  top(mat, pts, h, v, o = {}) {
    const shape = pts instanceof THREE.Shape ? pts : shapeFrom(pts, o.holes);
    const bev = o.bevel ?? 0.0015;
    const geo = this._extrude(shape, h, bev, o);
    const realBev = this.hi && bev > 0 ? Math.min(bev, h * 0.45) : 0;
    geo.translate(0, 0, -(h - 2 * realBev) / 2);
    if (this.max) edgeWear(geo, 'extrude');
    geo.rotateX(-Math.PI / 2);
    return this._push(geo, mat, { ...o, x: o.x || 0, v, u: o.u || 0 });
  }

  // Rohr entlang Punkten [[x, v, u], …]
  tube(mat, pts, r, o = {}) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, v, u]) => new THREE.Vector3(x, v, -u)), !!o.closed, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, o.tubSeg ?? this.seg(Math.max(4, pts.length * 4), Math.max(2, pts.length)), r, o.seg ?? this.seg(8, 4), !!o.closed);
    return this._push(geo, mat, { ...o, x: 0, v: 0, u: 0 });
  }

  // Ring (Torus), Standard: Öffnung zeigt nach vorn (Ebene x/v)
  torus(mat, R, r, x, v, u, o = {}) {
    const geo = new THREE.TorusGeometry(R, r, this.hi ? (o.seg ?? 8) : 3, this.hi ? (o.tseg ?? 20) : Math.min(o.tseg ?? 6, 6), o.arc ?? Math.PI * 2);
    return this._push(geo, mat, { ...o, x, v, u });
  }

  sphere(mat, r, x, v, u, o = {}) {
    const geo = new THREE.SphereGeometry(r, this.hi ? (o.seg ?? 16) : Math.min(o.seg ?? 6, 6), this.hi ? (o.hseg ?? 12) : Math.min(o.hseg ?? 4, 4), 0, Math.PI * 2, o.p0 ?? 0, o.pl ?? Math.PI);
    return this._push(geo, mat, { ...o, x, v, u });
  }

  // Fläche (z. B. Absehen, Linse) mit eigenen UVs, Normale zeigt nach hinten (+z, zum Auge)
  plane(mat, w, h, x, v, u, o = {}) {
    const geo = new THREE.PlaneGeometry(w, h);
    return this._push(geo, mat, { ...o, x, v, u }, true);
  }

  circle(mat, r, x, v, u, o = {}) {
    const geo = new THREE.CircleGeometry(r, o.seg ?? this.seg(20, 8));
    return this._push(geo, mat, { ...o, x, v, u }, !!o.keepUV);
  }

  // Laufbohrung an der Mündung (Stirnfläche bei u): schwarzes Loch mit blank polierter, angefaster Krone – auch auf
  // schwarzem Stahl als Loch lesbar (Nutzer 13.10.2026: „eine Mündung und darin ein schwarzes Loch“).
  // u = Lage der Lochscheibe, ≈ 0,5 mm vor der Stirnfläche.
  bore(r, x, v, u, o = {}) {
    this.circle('cavity', r, x, v, u, o);
    if (!this.hi) return;
    const w = Math.max(0.0007, r * 0.3);
    this.lathe('crown', [[-0.0009, r * 0.98], [-0.0002, r + w]], x, v, u, { ...o, seg: o.seg ?? 24 });
  }

  // Picatinny-Schiene von u0 bis u1 auf Höhe v (Unterkante), optional seitlich/unten via rz
  rail(mat, x, v, u0, u1, o = {}) {
    const w = o.w ?? 0.021, base = o.base ?? 0.0045, len = u1 - u0;
    const rz = o.rz || 0;
    const rot = (dx, dv) => [x + dx * Math.cos(rz) - dv * Math.sin(rz), v + dx * Math.sin(rz) + dv * Math.cos(rz)];
    const [bx, bv] = rot(0, base / 2);
    this.box(mat, w * 0.82, base, len, bx, bv, (u0 + u1) / 2, { ...o, rz, c: 0.0012 });
    if (this.hi && !o.flat) {
      const pitch = 0.01, n = Math.floor(len / pitch);
      const start = u0 + (len - (n - 1) * pitch) / 2;
      const [tx, tv] = rot(0, base + 0.0016);
      for (let i = 0; i < n; i++) this.box(mat, w, 0.0032, 0.0052, tx, tv, start + i * pitch, { ...o, rz, c: 0 });
    } else {
      const [tx, tv] = rot(0, base + 0.0016);
      this.box(mat, w, 0.0032, len, tx, tv, (u0 + u1) / 2, { ...o, rz, c: 0 });
    }
  }

  // Picatinny-Schiene nach MIL-STD-1913: Schwalbenschwanz mit 45°-Flanken, 21,2 mm breit, Querschlitze 5,2 mm bei
  // 10 mm Teilung. v = Unterkante, Oberkante bei v + h; rz dreht um die Unterkante (seitliche/untere Schienen).
  picatinny(mat, x, v, u0, u1, o = {}) {
    if (!this.hi) return this.rail(mat, x, v, u0, u1, { ...o, flat: true });
    const h = o.h ?? 0.0077, rz = o.rz || 0, len = u1 - u0, c = Math.cos(rz), sn = Math.sin(rz);
    const P = (pts) => pts.map(([dx, dt]) => { const dv = h + dt; return [x + dx * c - dv * sn, v + dx * sn + dv * c]; });
    const spine = [[0.0091, -0.0031], [0.0079, -0.0043], [0.0079, -h], [-0.0079, -h], [-0.0079, -0.0043], [-0.0091, -0.0031]];
    const tooth = [[-0.0101, 0], [0.0101, 0], [0.0106, -0.0005], [0.0106, -0.0014], [0.009, -0.0031], [-0.009, -0.0031], [-0.0106, -0.0014], [-0.0106, -0.0005]];
    const { rz: _rz, x: _x, v: _v, ...po } = o;   // Querschnitt ist schon gedreht/verschoben
    this.front(mat, P(spine), len, u0, { ...po, bevel: 0.0004 });
    const n = Math.max(1, Math.floor((len + 0.0052) / 0.01)), start = u0 + (len - (n * 0.01 - 0.0052)) / 2;
    for (let i = 0; i < n; i++) this.front(mat, P(tooth), 0.0048, start + i * 0.01, { ...po, bevel: 0.00035 });
  }

  // Kleiner Schraub-/Nietenkopf (nur hohe Detailstufe)
  screw(mat, x, v, u, axis = 'x', r = 0.0028, o = {}) {
    if (!this.hi) return;
    this.cyl(mat, r, r, 0.0016, x, v, u, { ...o, axis, seg: 8 });
  }

  // Ankerpunkt (Object3D) – optional an animiertes Teil gebunden
  anchor(name, x, v, u, o = {}) {
    this.anchors.push({ name, part: o.part || 'static', pos: new THREE.Vector3(x, v, -u), rot: new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ'), data: o.data });
  }

  // Zusammenbau: Teile → Gruppen, Material-Merge, Anker, Statistik
  build(key) {
    if (!this.hi) return this._buildMerged(key);
    const root = new THREE.Group();
    root.name = `waffe:${key}:${this.lod}`;
    const objs = new Map();
    let tris = 0, meshes = 0;
    const makeObj = (p) => {
      if (objs.has(p.name)) return objs.get(p.name);
      let obj;
      if (p.name === 'static') obj = root;
      else {
        obj = new THREE.Group();
        obj.name = p.name;
        const parent = this.parts.get(p.parent);
        const parentObj = makeObj(parent);
        obj.position.copy(p.pivot).sub(parent.name === 'static' ? new THREE.Vector3() : parent.pivot);
        parentObj.add(obj);
      }
      objs.set(p.name, obj);
      return obj;
    };
    for (const p of this.parts.values()) {
      const obj = makeObj(p);
      const byMat = new Map();
      for (const it of p.items) {
        const k = it.mat + '|' + it.order;
        if (!byMat.has(k)) byMat.set(k, []);
        byMat.get(k).push(it);
      }
      for (const [k, items] of byMat) {
        const geos = [];
        if (items.length === 1) geos.push(items[0].geo);
        else if (this.key && items.some((i) => i.shared)) {
          // Teil × Material mit geteilten Stücken (Bauteil-Cache): geteilte vorn, fertiges Netz wiederverwenden
          const sh = items.filter((i) => i.shared), rest = items.filter((i) => !i.shared);
          const base = this.key + ':' + this.tier + ':' + p.name + '|' + k + '|', shSig = sh.map((i) => i.shared).join(',');
          const mk = base + shSig + '|' + rest.map((i) => geoSig(i.geo)).join(',');
          let geo = MERGED.get(mk);
          if (geo) geos.push(geo);
          else if (SHONLY.has(base + shSig)) {
            geos.push(SHONLY.get(base + shSig));
            if (rest.length) geos.push(rest.length === 1 ? rest[0].geo : mergeGeometries(rest.map((i) => i.geo), false));
          } else {
            const all = [...sh, ...rest];
            geo = mergeGeometries(all.map((i) => i.geo), false);
            viewInto(geo, all);
            MERGED.set(mk, geo);
            SHONLY.set(base + shSig, prefixView(geo, sh.reduce((n, i) => n + i.geo.attributes.position.count, 0)));
            geos.push(geo);
          }
          rest.forEach((i) => { if (!geos.includes(i.geo)) i.geo.dispose(); });
        } else {
          geos.push(mergeGeometries(items.map(i => i.geo), false));
          items.forEach(i => i.geo.dispose());
        }
        for (const geo of geos) {
          if (!(items.some((i) => i.shared) && geo.boundingSphere && geo.boundingBox)) {   // geteilte Netze haben ihre Hülle schon
            geo.computeBoundingSphere();
            geo.computeBoundingBox();
          }
          const mesh = new THREE.Mesh(geo, getMat(items[0].mat));
          mesh.name = `${p.name}:${k.split('|')[0].replace(/@lite$/, '')}`;   // Handy-Atlas: gleicher Name
          mesh.renderOrder = items[0].order;
          if (getMat(items[0].mat).transparent) mesh.castShadow = false;
          else { mesh.castShadow = true; }
          mesh.receiveShadow = false;
          obj.add(mesh);
          tris += geo.attributes.position.count / 3;
          meshes++;
        }
      }
    }
    for (const a of this.anchors) {
      const parentObj = objs.get(a.part) || makeObj(this.parts.get(a.part));
      const o = new THREE.Object3D();
      o.name = a.name;
      o.position.copy(a.pos).sub(a.part === 'static' ? new THREE.Vector3() : this.parts.get(a.part).pivot);
      o.rotation.copy(a.rot);
      if (a.data) Object.assign(o.userData, a.data);
      parentObj.add(o);
    }
    root.userData.stats = { triangles: Math.round(tris), meshes };
    return root;
  }
}

Builder.prototype._buildMerged = function (key) {
  // Bot-Detailstufe: alle Teile (außer Magazin-Baugruppe und meta.botParts) in zwei Vertex-Farb-Meshes (Metall/Matt)
  const root = new THREE.Group();
  root.name = `waffe:${key}:${this.lod}`;
  const objs = new Map();
  const makeObj = (p) => {
    if (objs.has(p.name)) return objs.get(p.name);
    let obj;
    if (p.name === 'static') obj = root;
    else {
      obj = new THREE.Group();
      obj.name = p.name;
      const parent = this.parts.get(p.parent);
      makeObj(parent).add(obj);
      obj.position.copy(p.pivot).sub(parent.name === 'static' ? new THREE.Vector3() : parent.pivot);
    }
    objs.set(p.name, obj);
    return obj;
  };
  for (const p of this.parts.values()) makeObj(p);
  root.updateMatrixWorld(true);
  // Eigene Baugruppen: Magazin und die Teile, die ein Bot-Rig sichtbar bewegt (meta.botParts, z. B. Kipplauf 'barrels', 26.10.) –
  // je ein Metall-/Matt-Netz unter der Teilgruppe; alles andere verschmilzt in den Ursprung (ohne botParts wie bisher)
  const own = ['mag', ...(this.meta.botParts || [])].filter((n) => objs.has(n));
  const ownOf = (p) => { for (let q = p; q; q = q.parent ? this.parts.get(q.parent) : null) if (own.includes(q.name)) return q.name; return 'root'; };
  const inv = new Map(own.map((n) => [n, objs.get(n).matrixWorld.clone().invert()]));
  const buckets = { root: { metal: [], matte: [] }, mag: { metal: [], matte: [] } };
  for (const n of own) buckets[n] ??= { metal: [], matte: [] };
  const m = new THREE.Matrix4();
  for (const p of this.parts.values()) {
    const obj = objs.get(p.name), where = ownOf(p);
    m.copy(obj.matrixWorld);
    if (where !== 'root') m.premultiply(inv.get(where));
    for (const it of p.items) {
      const g = it.geo;
      g.applyMatrix4(m);
      const li = lodInfo(it.mat), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) li.color.toArray(col, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      buckets[where][li.metal ? 'metal' : 'matte'].push(g);
    }
  }
  let tris = 0, meshes = 0;
  for (const [where, groups] of Object.entries(buckets)) {
    for (const [kind, geos] of Object.entries(groups)) {
      if (!geos.length) continue;
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach(g => g.dispose());
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, getMat(kind === 'metal' ? 'lodMetal' : 'lodMatte'));
      mesh.name = `${where}:${kind}`;
      mesh.castShadow = true; mesh.receiveShadow = false;
      (where === 'root' ? root : objs.get(where)).add(mesh);
      tris += geo.attributes.position.count / 3; meshes++;
    }
  }
  for (const a of this.anchors) {
    const o = new THREE.Object3D();
    o.name = a.name;
    o.position.copy(a.pos).sub(a.part === 'static' ? new THREE.Vector3() : this.parts.get(a.part).pivot);
    o.rotation.copy(a.rot);
    if (a.data) Object.assign(o.userData, a.data);
    objs.get(a.part).add(o);
  }
  root.userData.stats = { triangles: Math.round(tris), meshes };
  return root;
};

// Douglas-Peucker für Lathe-Profile [[du, r], …] (Endpunkte bleiben erhalten)
function simplifyProfile(pts, tol) {
  if (pts.length <= 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const rec = (a, b) => {
    let best = -1, bd = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = true; rec(a, best); rec(best, b); }
  };
  rec(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}

function roundedBox(w, h, l, r, seg = 1) {
  return new RoundedBoxGeometry(w, h, l, seg, r);
}
