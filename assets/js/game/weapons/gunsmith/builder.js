// Geometrie-Baukasten für prozedurale Waffen.
// Koordinaten der Waffe: x = rechts, v = oben (y), u = vorwärts entlang der Laufachse (z = −u).
// Ursprung = Griffpunkt der rechten Hand (Oberkante Pistolengriff). Maßeinheit Meter.
// Alle Teile werden pro Material zusammengeführt (statisch) bzw. pro animiertem Teil separat gehalten.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getMat, UV_SCALE } from './materials.js';

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

function normalizeGeo(geo, keepUV) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(keepUV && name === 'uv')) g.deleteAttribute(name);
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

export class Builder {
  constructor(lod = 'first') {
    this.lod = lod;
    this.hi = lod !== 'third';
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

  _push(geo, mat, o, keepUV = false) {
    const part = this.parts.get(o.part || 'static');
    if (!part) throw new Error('Unbekanntes Teil ' + o.part);
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ');
    _q.setFromEuler(_e);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    _p.set(o.x || 0, o.v || 0, -(o.u || 0)).sub(part.pivot);
    _m.compose(_p, _q, _s);
    if (o.pre) geo.applyMatrix4(o.pre);
    geo.applyMatrix4(_m);
    part.items.push({ geo: normalizeGeo(geo, keepUV), mat, order: o.renderOrder || 0 });
    return geo;
  }

  // Quader (Breite x, Höhe v, Länge u), zentriert. o.c = Fase, o.r = Rundung
  box(mat, w, h, l, x, v, u, o = {}) {
    let geo;
    if (this.hi && o.r) geo = roundedBox(w, h, l, o.r, o.rs ?? 1);
    else if (this.hi && o.c !== 0) geo = chamferBoxGeometry(w, h, l, o.c ?? Math.min(w, h, l) * 0.12);
    else geo = new THREE.BoxGeometry(w, h, l);
    return this._push(geo, mat, { ...o, x, v, u });
  }

  // Zylinder entlang u (Standard), v oder x. rF = Radius vorne/oben, rB = hinten/unten
  cyl(mat, rF, rB, l, x, v, u, o = {}) {
    const seg = o.seg ?? this.seg(16);
    const geo = new THREE.CylinderGeometry(rF, rB, l, seg, 1, !!o.open, o.t0 ?? 0, o.tl ?? Math.PI * 2);
    if (o.axis === 'v') { /* bereits entlang y */ }
    else if (o.axis === 'x') geo.rotateZ(-Math.PI / 2);
    else geo.rotateX(-Math.PI / 2);
    return this._push(geo, mat, { ...o, x, v, u });
  }

  // Rotationskörper um die u-Achse. pts = [[du, r], …] (du vorwärts ab u)
  lathe(mat, pts, x, v, u, o = {}) {
    const seg = o.seg ?? this.seg(16);
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
    const shape = pts instanceof THREE.Shape ? pts : shapeFrom(pts, o.holes);
    const bev = o.bevel ?? 0.002;
    const geo = this._extrude(shape, width, bev, o);
    const realBev = this.hi && bev > 0 ? Math.min(bev, width * 0.45) : 0;
    geo.translate(0, 0, -(width - 2 * realBev) / 2);
    geo.rotateY(Math.PI / 2);
    return this._push(geo, mat, { ...o, x, v: o.v || 0, u: o.u || 0 });
  }

  // Querschnitt [[x, v], …] entlang u extrudiert (von u bis u + l)
  front(mat, pts, l, u, o = {}) {
    const shape = pts instanceof THREE.Shape ? pts : shapeFrom(pts, o.holes);
    const bev = o.bevel ?? 0;
    const geo = this._extrude(shape, l, bev, o);
    const realBev = this.hi && bev > 0 ? Math.min(bev, l * 0.45) : 0;
    geo.translate(0, 0, -(l - realBev));
    return this._push(geo, mat, { ...o, x: o.x || 0, v: o.v || 0, u });
  }

  // Draufsicht [[x, u], …] entlang v extrudiert (Höhe h, zentriert bei v)
  top(mat, pts, h, v, o = {}) {
    const shape = pts instanceof THREE.Shape ? pts : shapeFrom(pts, o.holes);
    const bev = o.bevel ?? 0.0015;
    const geo = this._extrude(shape, h, bev, o);
    const realBev = this.hi && bev > 0 ? Math.min(bev, h * 0.45) : 0;
    geo.translate(0, 0, -(h - 2 * realBev) / 2);
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
    const geo = new THREE.TorusGeometry(R, r, o.seg ?? this.seg(8, 4), o.tseg ?? this.seg(20, 8), o.arc ?? Math.PI * 2);
    return this._push(geo, mat, { ...o, x, v, u });
  }

  sphere(mat, r, x, v, u, o = {}) {
    const geo = new THREE.SphereGeometry(r, o.seg ?? this.seg(16, 7), o.hseg ?? this.seg(12, 5), 0, Math.PI * 2, o.p0 ?? 0, o.pl ?? Math.PI);
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
        const geo = items.length === 1 ? items[0].geo : mergeGeometries(items.map(i => i.geo), false);
        if (items.length > 1) items.forEach(i => i.geo.dispose());
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, getMat(items[0].mat));
        mesh.name = `${p.name}:${k.split('|')[0]}`;
        mesh.renderOrder = items[0].order;
        if (getMat(items[0].mat).transparent) mesh.castShadow = false;
        else { mesh.castShadow = true; }
        mesh.receiveShadow = false;
        obj.add(mesh);
        tris += geo.attributes.position.count / 3;
        meshes++;
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

function roundedBox(w, h, l, r, seg = 1) {
  return new RoundedBoxGeometry(w, h, l, seg, r);
}
