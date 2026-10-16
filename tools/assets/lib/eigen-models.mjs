// NULLPUNKT — eigene Requisiten-Modelle (Nutzer 16.10.: „selbiges gilt für die Gegenstände, wie Autos, Sandsäcke …“).
// Ersetzt die früheren Poly-Haven-Modelle unter derselben Id: jedes Modell wird aus three.js-Grundkörpern gebaut
// (Drehkörper, abgerundete Quader, Rohre, Extrusionen, verformte Kugeln), exakt in den Hüllquader des alten Modells
// eingepasst (tools/assets/eigen-modelle.json — Platzierung, Kollision und Minikarte bleiben gleich) und mit eigenen
// Texturen (Generatoren unten bzw. lib/eigen-gen.mjs, UV in Metern) als glTF-Dokument geschrieben. tools/assets/models.mjs
// verarbeitet die Datei danach wie jede Quelle (Verschmelzen, LOD-Kette, KTX2, Meshopt).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { EIGEN } from './eigen-gen.mjs';
import { makeNoise, clamp01, smooth, mix, hex, mix3, assemble, toLin } from './vorlage-gen.mjs';

const SPEC = JSON.parse(readFileSync(new URL('../eigen-modelle.json', import.meta.url), 'utf8'));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const hashI = (a, b, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const frac = (x) => x - Math.floor(x);
const toS8 = (x) => Math.round(255 * clamp01(x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(clamp01(x), 1 / 2.4) - 0.055));

/* ================================================================== Texturen für Modelle (Kachel = 1 m) */
const MGEN = {
  // Lack auf Blech, neutral grau (Farbe per tint): Abplatzer, Kratzer, Rost an Kanten (rust 0..1), Schmutz unten
  paint: ({ seed = 1, rust = 0.3, wear = 0.3, gloss = 0.45 } = {}) => (size) => {
    const n1 = makeNoise(seed), n2 = makeNoise(seed + 1), n3 = makeNoise(seed + 2);
    const paint = hex('#9a9a9a'), rustC = hex('#6e3d1e'), rustL = hex('#9a5a2a'), bare = hex('#77787a');
    return assemble(size, (u, v, p) => {
      const rn = n1(u, v, 8, 8, 5) * 0.75 + n2(u, v, 40, 40, 3) * 0.25;
      const rustM = smooth(0.86 - rust * 0.16, 0.89 - rust * 0.16, rn);
      const chip = smooth(0.86 - wear * 0.1, 0.88 - wear * 0.1, n2(u + 0.3, v, 30, 30, 4)) * (1 - rustM);
      const sc = smooth(0.93, 0.97, n3(u, v, 160, 8, 2)) * wear;
      p.h = 0.5 - chip * 0.08 - rustM * 0.05 + (n3(u, v, 200, 200, 2) - 0.5) * 0.03;
      let col = paint.map((x) => x * (0.93 + 0.1 * (n3(u, v, 6, 6, 4) - 0.5)));
      col = mix3(col, bare, Math.max(chip, sc) * 0.9);
      col = mix3(col, mix3(rustC, rustL, n2(u, v, 60, 60, 2)), rustM);
      p.col = col;
      p.rough = mix(1 - gloss, 0.85, rustM) + sc * 0.1;
      p.metal = chip * 0.8 + sc * 0.5;
    }, { normal: 2, cav: [0.003, 1.5], aoMin: 0.7 });
  },
  // Kunststoff (HDPE/PP), neutral: feine Narbung, Schrammen, Kalkschleier
  plastic: ({ seed = 11, gloss = 0.5 } = {}) => (size) => {
    const n1 = makeNoise(seed), n2 = makeNoise(seed + 1);
    return assemble(size, (u, v, p) => {
      const g = n1(u, v, 300, 300, 2), sc = smooth(0.94, 0.98, n2(u, v, 140, 10, 2));
      p.h = 0.5 + (g - 0.5) * 0.08 - sc * 0.05;
      p.col = hex('#9c9c9c').map((x) => x * (0.95 + 0.05 * (g - 0.5) + 0.08 * (n2(u, v, 5, 5, 4) - 0.5) + sc * 0.15));
      p.rough = 1 - gloss + sc * 0.2 + (g - 0.5) * 0.05;
    }, { normal: 1, cav: [0.003, 1], aoMin: 0.85 });
  },
  // Reifen-Gummi mit Profil (Querrillen in v, 4 cm Teilung) und Abrieb
  tread: () => (size) => {
    const n1 = makeNoise(31), n2 = makeNoise(32);
    return assemble(size, (u, v, p) => {
      const f = frac(v * 25 + (Math.floor(u * 6) % 2) * 0.5), groove = smooth(0.1, 0.0, Math.min(f, 1 - f)) + smooth(0.08, 0.0, Math.abs(frac(u * 6) - 0.5)) * 0.6;
      p.h = 0.6 - clamp01(groove) * 0.5 + (n1(u, v, 200, 200, 2) - 0.5) * 0.05;
      p.col = hex('#2a2a2b').map((x) => x * (0.85 + 0.25 * n2(u, v, 20, 20, 3) + clamp01(groove) * -0.2));
      p.rough = 0.85;
    }, { normal: 6, cav: [0.003, 1.5], aoMin: 0.5 });
  },
  // Schwarzer Müllsack: glänzende Folie mit Knitterfalten
  bag: () => (size) => {
    const n1 = makeNoise(41), n2 = makeNoise(42), n3 = makeNoise(43);
    return assemble(size, (u, v, p) => {
      const w = Math.abs(n1(u, v, 6, 6, 4) - 0.5) * 2, w2 = Math.abs(n2(u, v, 14, 14, 3) - 0.5) * 2;
      p.h = (1 - w) * 0.6 + (1 - w2) * 0.3;
      p.col = hex('#141516').map((x) => x * (0.9 + 0.3 * n3(u, v, 8, 8, 3)));
      p.rough = 0.25 + w2 * 0.2;
    }, { normal: 8, cav: [0.004, 1.5], aoMin: 0.6 });
  },
  // Abdeckplane (Stoff), neutral dunkel: Gewebe + Knitter
  cloth: () => (size) => {
    const n1 = makeNoise(51), n2 = makeNoise(52);
    return assemble(size, (u, v, p) => {
      const weave = 0.5 + 0.25 * Math.sin(u * Math.PI * 2 * 260) + 0.25 * Math.sin(v * Math.PI * 2 * 260);
      const crease = Math.abs(n1(u, v, 5, 5, 4) - 0.5) * 2;
      p.h = weave * 0.15 + (1 - crease) * 0.6;
      p.col = hex('#8f8f8f').map((x) => x * (0.88 + 0.1 * weave + 0.1 * (n2(u, v, 6, 6, 4) - 0.5)));
      p.rough = 0.85;
    }, { normal: 5, cav: [0.004, 1.5], aoMin: 0.6 });
  },
  // Papiersack (Zement): Kraftpapier hell, Falten, Staub
  paper: () => (size) => {
    const n1 = makeNoise(61), n2 = makeNoise(62);
    return assemble(size, (u, v, p) => {
      const crease = Math.abs(n1(u, v, 7, 7, 4) - 0.5) * 2;
      p.h = (1 - crease) * 0.4 + (n2(u, v, 200, 200, 2) - 0.5) * 0.05;
      p.col = hex('#c9bfa9').map((x) => x * (0.9 + 0.12 * (n2(u, v, 9, 9, 4) - 0.5) + 0.08 * crease));
      p.rough = 0.9;
    }, { normal: 4, cav: [0.004, 1.5], aoMin: 0.65 });
  },
  // Rinde (abgestorbener Stamm): Längsrisse, Borkenplatten, Moos/Flechten
  bark: () => (size) => {
    const n1 = makeNoise(71), n2 = makeNoise(72), n3 = makeNoise(73);
    return assemble(size, (u, v, p) => {
      const ridge = Math.abs(n1(u, v, 14, 3, 4) - 0.5) * 2;
      const crack = smooth(0.12, 0.0, ridge);
      p.h = 0.3 + ridge * 0.6 + (n2(u, v, 80, 30, 2) - 0.5) * 0.1;
      let col = hex('#5a4c3e').map((x) => x * (0.8 + 0.4 * ridge));
      col = mix3(col, hex('#2a221b'), crack * 0.8);
      p.col = mix3(col, hex('#6b6e4a'), smooth(0.65, 0.8, n3(u, v, 6, 6, 4)) * 0.5);
      p.rough = 0.9;
    }, { normal: 9, cav: [0.006, 2], aoMin: 0.35 });
  },
  // Kahles Holz (Stammbruch, Äste): gebleicht, Längsfasern
  deadwood: () => (size) => {
    const n1 = makeNoise(81), n2 = makeNoise(82);
    return assemble(size, (u, v, p) => {
      const fib = n1(u, v, 4, 120, 3);
      p.h = 0.5 + (fib - 0.5) * 0.4;
      p.col = hex('#8a7f70').map((x) => x * (0.8 + 0.4 * fib + 0.1 * (n2(u, v, 6, 6, 3) - 0.5)));
      p.rough = 0.85;
    }, { normal: 6, cav: [0.004, 2], aoMin: 0.45 });
  },
  // Fels (Bruchstein): Schichtung, Körnung, Flechten
  rock: () => (size) => {
    const n1 = makeNoise(91), n2 = makeNoise(92), n3 = makeNoise(93);
    return assemble(size, (u, v, p) => {
      const g = n2(u, v, 120, 120, 3), strata = n1(u, v, 3, 18, 4);
      p.h = 0.5 + (g - 0.5) * 0.3 + (strata - 0.5) * 0.3;
      let col = mix3(hex('#6d6a63'), hex('#8e8a80'), strata).map((x) => x * (0.85 + 0.3 * (g - 0.5)));
      p.col = mix3(col, hex('#8b8a62'), smooth(0.7, 0.85, n3(u, v, 10, 10, 4)) * 0.5);
      p.rough = 0.88;
    }, { normal: 7, cav: [0.005, 2], aoMin: 0.4 });
  },
  // Terrakotta (Blumentopf): gebrannter Ton, Kalkränder, Erdreste
  clay: () => (size) => {
    const n1 = makeNoise(101), n2 = makeNoise(102);
    return assemble(size, (u, v, p) => {
      const g = n1(u, v, 160, 160, 2);
      p.h = 0.5 + (g - 0.5) * 0.1;
      let col = hex('#9a5536').map((x) => x * (0.88 + 0.2 * (g - 0.5) + 0.12 * (n2(u, v, 5, 5, 4) - 0.5)));
      p.col = mix3(col, hex('#c2b5a0'), smooth(0.65, 0.85, n2(u + 0.4, v, 8, 3, 4)) * 0.5);
      p.rough = 0.88;
    }, { normal: 2, cav: [0.003, 1.2], aoMin: 0.7 });
  },
  // Gummi/Schlauch/Kabel
  rubber: () => (size) => EIGEN.rubber(size),
};
// Sätze aus lib/eigen-gen.mjs (Holz, Beton, Wellpappe, Gitter …) sind ebenfalls verwendbar: { gen: 'wood_crate' }

/** Neutrale (wenig gesättigte) Bildteile auf die Zielfarbe tönen; Rost/Beschriftung behalten ihre Farbe. */
function tintNeutral(img, tint, amount = 1) {
  const d = img.data, n = d.length / 4, t = hex(tint);
  let s = [0, 0, 0], c = 0;
  const W = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    W[i] = (1 - smooth(0.1, 0.3, sat)) * amount;
    if (W[i] > 0.5) { s[0] += toLin(r); s[1] += toLin(g); s[2] += toLin(b); c++; }
  }
  const base = s.map((x) => x / Math.max(1, c));
  const k = t.map((tv, ch) => tv / Math.max(1e-4, base[ch]));
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) {
    const x = toLin(d[i * 4 + ch] / 255);
    d[i * 4 + ch] = toS8(mix(x, x * k[ch], W[i]));
  }
}

const TEX_CACHE = new Map();
/** Texturensatz eines Materials → PNG-Puffer { albedo, normal, orm }. spec: { gen | mgen, opt, tint, decal(x, y) → [r,g,b,a] } */
async function texSet(spec, size) {
  const key = JSON.stringify({ ...spec, decal: spec.decal ? spec.decal.toString() : null, size });
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const set = spec.gen ? EIGEN[spec.gen](size) : MGEN[spec.mgen](spec.opt || {})(size);
  if (spec.tint) tintNeutral(set.albedo, spec.tint, spec.tintAmount ?? 1);
  if (spec.bright) for (let i = 0; i < set.albedo.data.length; i++) if (i % 4 !== 3) set.albedo.data[i] = toS8(toLin(set.albedo.data[i] / 255) * spec.bright);
  if (spec.rough != null || spec.metal != null) {
    const o = set.orm.data;
    for (let i = 0; i < o.length; i += 4) {
      if (spec.rough != null) o[i + 1] = Math.round(clamp01(spec.rough + (o[i + 1] / 255 - 0.5) * 0.3) * 255);
      if (spec.metal != null) o[i + 2] = Math.round(spec.metal * 255);
    }
  }
  if (spec.decal) {
    // Aufdruck in Kachel-Koordinaten (Meter, 0..1): Farbe sRGB 0..1 mit Deckung a
    const a = set.albedo.data, o = set.orm.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = spec.decal((x + 0.5) / size, 1 - (y + 0.5) / size);
      if (!r || r[3] <= 0) continue;
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) a[i + ch] = Math.round(mix(a[i + ch], r[ch] * 255 * (0.85 + 0.15 * (a[i + ch] / 255)), r[3]));
      o[i + 2] = Math.round(o[i + 2] * (1 - r[3]));
    }
  }
  const png = async (img) => sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  const out = { albedo: await png(set.albedo), normal: await png(set.normal), orm: await png(set.orm) };
  TEX_CACHE.set(key, out);
  return out;
}

/* ================================================================== Geometrie-Bausteine (Meter, y oben) */
const G = {
  /** abgerundeter Quader, Mitte (x, y, z) */
  box(w, h, d, x = 0, y = 0, z = 0, r = 0.004, seg = 2) {
    const g = r > 0 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
    return g.translate(x, y, z);
  },
  /** Zylinder/Kegelstumpf entlang axis ('y' | 'x' | 'z'), Mitte (x, y, z) */
  cyl(rt, rb, h, x = 0, y = 0, z = 0, { seg = 24, axis = 'y', open = false } = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    return g.translate(x, y, z);
  },
  /** Drehkörper um y aus [[r, y], …] */
  lathe(pts, seg = 32, x = 0, y = 0, z = 0) {
    return new THREE.LatheGeometry(pts.map(([r, yy]) => new THREE.Vector2(Math.max(1e-4, r), yy)), seg).translate(x, y, z);
  },
  /** Torus (Ring) in der xz-Ebene (axis 'y') bzw. quer */
  torus(R, r, x = 0, y = 0, z = 0, { seg = 32, tseg = 8, axis = 'y', arc = Math.PI * 2 } = {}) {
    const g = new THREE.TorusGeometry(R, r, tseg, seg, arc);
    if (axis === 'y') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateY(Math.PI / 2);
    return g.translate(x, y, z);
  },
  /** Rohr entlang eines Polygonzugs (gerundete Ecken über Catmull-Rom, tension) */
  tube(pts, r, { seg = 8, steps = null, closed = false, curve = 'catmullrom', tension = 0.2 } = {}) {
    const c = new THREE.CatmullRomCurve3(pts.map((p) => V(...p)), closed, curve, tension);
    return new THREE.TubeGeometry(c, steps || Math.max(8, pts.length * 10), r, seg, closed);
  },
  /** gerader Stab zwischen zwei Punkten */
  rod(a, b, r, seg = 8) {
    const A = V(...a), B = V(...b), len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize());
    g.applyQuaternion(q);
    const m = A.clone().add(B).multiplyScalar(0.5);
    return g.translate(m.x, m.y, m.z);
  },
  /** Profil (2D-Punkte [a, b] in der Ebene) entlang axis um depth extrudiert, Mitte der Tiefe bei 0 */
  extrude(pts, depth, axis = 'z', { bevel = 0.004, bseg = 1, curveSeg = 8 } = {}) {
    const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-3, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: bseg, curveSegments: curveSeg });
    g.translate(0, 0, -(depth - 2 * bevel) / 2);
    if (axis === 'x') g.rotateY(Math.PI / 2); else if (axis === 'y') g.rotateX(-Math.PI / 2);
    return g;
  },
  /** Kugel/Ikosaeder mit Verformung */
  blob(r, x, y, z, { detail = 3, fn = null, sx = 1, sy = 1, sz = 1, flat = false } = {}) {
    let g = new THREE.IcosahedronGeometry(r, detail);
    if (!flat) { g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); } // glatt schattiert
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = V(p.getX(i), p.getY(i), p.getZ(i));
      if (fn) v.multiplyScalar(fn(v.clone().normalize(), v));
      p.setXYZ(i, v.x * sx + x, v.y * sy + y, v.z * sz + z);
    }
    g.computeVertexNormals();
    return g;
  },
  /** Positionen verformen (fn(v) ändert v); Normalen neu */
  warp(g, fn) {
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
    return g;
  },
  rot(g, rx = 0, ry = 0, rz = 0, about = null) {
    if (about) g.translate(-about[0], -about[1], -about[2]);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')));
    if (about) g.translate(...about);
    return g;
  },
};

/* ================================================================== Modell-Bau */
class Model {
  constructor(id) { this.id = id; this.items = []; this.mats = new Map(); }
  mat(name, spec) { this.mats.set(name, spec); return name; }
  /** g: Geometrie, m: Material, o: { part, uv: 'box' | 'cyl' | 'keep', tile, ax (Achse für cyl) } */
  add(g, m, o = {}) { if (Array.isArray(g)) { for (const x of g) this.add(x, m, o); return this; } this.items.push({ g, m, o }); return this; }
}

/** Nicht-gleichmäßige Einpassung: alle Geometrien eines Teils in den Ziel-Hüllquader. */
function fitItems(items, target) {
  const b = new THREE.Box3();
  for (const it of items) { it.g.computeBoundingBox(); b.union(it.g.boundingBox); }
  const size = b.getSize(V()), tsize = V(target.max[0] - target.min[0], target.max[1] - target.min[1], target.max[2] - target.min[2]);
  const s = V(tsize.x / (size.x || 1), tsize.y / (size.y || 1), tsize.z / (size.z || 1));
  const m = new THREE.Matrix4().makeTranslation(target.min[0], target.min[1], target.min[2])
    .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z)).multiply(new THREE.Matrix4().makeTranslation(-b.min.x, -b.min.y, -b.min.z));
  for (const it of items) it.g.applyMatrix4(m); // applyMatrix4 transformiert Normalen mit der Normalenmatrix
  return s;
}

/** UV in Metern: Quaderprojektion je Dreieck (dominante Normalenachse) oder zylindrisch um die Teilachse. */
function uvFor(g, o, center) {
  const tile = o.tile || 1;
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.attributes.position, n = ng.attributes.normal, cnt = p.count;
  const uv = new Float32Array(cnt * 2);
  const old = ng.attributes.uv;
  if (o.uv === 'keep' && old) {
    const [su, sv] = o.uvScale || [1, 1];
    for (let i = 0; i < cnt; i++) { uv[i * 2] = old.getX(i) * su + (o.uvOff?.[0] || 0); uv[i * 2 + 1] = old.getY(i) * sv + (o.uvOff?.[1] || 0); }
  } else if (o.uv === 'cyl') {
    const ax = o.ax || 'y';
    const R = o.r || 0.25;
    for (let t = 0; t < cnt; t += 3) {
      const us = [];
      for (let k = 0; k < 3; k++) {
        const i = t + k, x = p.getX(i) - center.x, y = p.getY(i) - center.y, z = p.getZ(i) - center.z;
        const [a, b, h] = ax === 'y' ? [x, z, y] : ax === 'x' ? [y, z, x] : [x, y, z];
        us.push([Math.atan2(b, a) / (Math.PI * 2) * (Math.PI * 2 * R), h]);
      }
      const C = Math.PI * 2 * R;
      const maxU = Math.max(...us.map((q) => q[0]));
      for (const q of us) if (maxU - q[0] > C / 2) q[0] += C;
      // Deckel (Normale entlang der Achse): planar
      const ni = n.getY(t), nx = n.getX(t), nz = n.getZ(t);
      const axial = ax === 'y' ? Math.abs(ni) : ax === 'x' ? Math.abs(nx) : Math.abs(nz);
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        if (axial > 0.8) {
          const x = p.getX(i) - center.x, y = p.getY(i) - center.y, z = p.getZ(i) - center.z;
          const [a, b] = ax === 'y' ? [x, z] : ax === 'x' ? [y, z] : [x, y];
          uv[i * 2] = a / tile; uv[i * 2 + 1] = b / tile;
        } else { uv[i * 2] = us[k][0] / tile; uv[i * 2 + 1] = us[k][1] / tile; }
      }
    }
  } else {
    const fn = V();
    const a = V(), b = V(), c = V();
    for (let t = 0; t < cnt; t += 3) {
      a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
      fn.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
      for (let k = 0; k < 3; k++) {
        const i = t + k, x = p.getX(i) - center.x, y = p.getY(i) - center.y, z = p.getZ(i) - center.z;
        let u, v;
        if (ax >= ay && ax >= az) { u = z * Math.sign(fn.x || 1); v = y; } else if (ay >= az) { u = x; v = z * Math.sign(fn.y || 1); } else { u = -x * Math.sign(fn.z || 1); v = y; }
        if (o.swap) [u, v] = [v, u];
        uv[i * 2] = u / tile + (o.uvOff?.[0] || 0); uv[i * 2 + 1] = v / tile + (o.uvOff?.[1] || 0);
      }
    }
  }
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
  return ng;
}

/** glTF-UV: v = 0 ist die oberste Bildzeile — gespiegelt, damit „oben“ im Modell „oben“ im Bild ist. */
const flipV = (a) => { const o = new Float32Array(a); for (let i = 1; i < o.length; i += 2) o[i] = 1 - o[i]; return o; };

/** Modell → glTF-Dokument (ein Knoten je Teil, ein Primitive je Material). size = Texturgröße. */
export async function buildModelDoc(id, size = 1024) {
  const def = MODELS[id];
  if (!def) throw new Error(`eigen-models: ${id} fehlt`);
  const M = new Model(id);
  def(M);
  const spec = SPEC[id];
  // Teile einpassen (benannte Varianten je in ihren Teilquader, sonst alles in den Gesamtquader)
  const parts = new Map();
  for (const it of M.items) { const k = it.o.part || id; if (!parts.has(k)) parts.set(k, []); parts.get(k).push(it); }
  for (const [k, items] of parts) {
    for (const it of items) if (!it.g.attributes.normal) it.g.computeVertexNormals();
    const target = spec.parts?.[k] || spec.box;
    fitItems(items, target);
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(id);
  doc.getRoot().setDefaultScene(scene);
  const matObj = new Map();
  for (const [name, s] of M.mats) {
    const t = await texSet(s, s.size || size);
    const mk = (suffix, png) => doc.createTexture(`${name}_${suffix}`).setImage(png).setMimeType('image/png').setURI(`${id}_${name}_${suffix}.png`);
    const orm = mk('orm', t.orm);
    const m = doc.createMaterial(name).setBaseColorTexture(mk('diff', t.albedo)).setNormalTexture(mk('nor', t.normal))
      .setMetallicRoughnessTexture(orm).setOcclusionTexture(orm).setRoughnessFactor(1).setMetallicFactor(1);
    if (s.doubleSided) m.setDoubleSided(true);
    matObj.set(name, m);
  }
  for (const [k, items] of parts) {
    const node = doc.createNode(k), mesh = doc.createMesh(k);
    const center = new THREE.Box3(); for (const it of items) { it.g.computeBoundingBox(); center.union(it.g.boundingBox); }
    const c = center.getCenter(V()); c.y = center.min.y;
    const byMat = new Map();
    for (const it of items) { const g = uvFor(it.g, it.o, it.o.center ? V(...it.o.center) : c); if (!byMat.has(it.m)) byMat.set(it.m, []); byMat.get(it.m).push(g); }
    for (const [mname, geos] of byMat) {
      const g = mergeGeometries(geos, false);
      const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', acc(new Float32Array(g.attributes.position.array), 'VEC3'))
        .setAttribute('NORMAL', acc(new Float32Array(g.attributes.normal.array), 'VEC3'))
        .setAttribute('TEXCOORD_0', acc(flipV(g.attributes.uv.array), 'VEC2'))
        .setMaterial(matObj.get(mname));
      mesh.addPrimitive(prim);
    }
    node.setMesh(mesh);
    scene.addChild(node);
  }
  return doc;
}

/** GLB-Bytes eines Modells */
export async function buildModelGLB(id, size = 1024) {
  return new NodeIO().writeBinary(await buildModelDoc(id, size));
}

/** Fingerabdruck (Rezept, Dateiname im Zwischenspeicher): ganze Bausteindatei + Maße des Modells */
const FILE_SRC = readFileSync(new URL(import.meta.url), 'utf8');
export const modelHash = (id) => createHash('sha1').update(FILE_SRC + id + JSON.stringify(SPEC[id] || null)).digest('hex').slice(0, 12);

/* ================================================================== Modelle */
// Jede Funktion baut in natürlichen Maßen (m); die Einpassung gleicht auf den alten Hüllquader ab.
export const MODELS = {};

/* ---------------------------------------------------------------- Fässer, Kanister, Munition */
/** Stahlfass 200 l: Mantel mit zwei Rollsicken, gebördelte Ränder, Deckel mit zwei Spundstopfen */
function drum(M, { r = 0.29, h = 0.88, mat, label = null }) {
  const sick = (y) => [[r, y - 0.018], [r + 0.012, y - 0.008], [r + 0.012, y + 0.008], [r, y + 0.018]];
  const prof = [[0.0, 0.006], [r - 0.02, 0.006], [r - 0.012, 0.0], [r + 0.008, 0.004], [r + 0.008, 0.02], [r, 0.03],
    ...sick(h * 0.33), ...sick(h * 0.66), [r, h - 0.03], [r + 0.008, h - 0.02], [r + 0.008, h - 0.004], [r - 0.012, h], [r - 0.02, h - 0.008], [0.0, h - 0.008]];
  M.add(G.lathe(prof, 40), mat, { uv: 'cyl', r });
  for (const [x, z, rr] of [[r * 0.55, 0, 0.032], [-r * 0.6, r * 0.1, 0.02]]) M.add(G.cyl(rr, rr, 0.016, x, h - 0.002, z, { seg: 14 }), mat);
  if (label) M.add(G.cyl(r + 0.0015, r + 0.0015, 0.2, 0, h * 0.5, 0, { seg: 40, open: true }).rotateY(0), label, { uv: 'cyl', r: r + 0.0015, tile: 1 });
}
MODELS.barrel_01 = (M) => {
  const red = M.mat('barrel_red', { mgen: 'paint', opt: { seed: 201, rust: 0.45, wear: 0.4, gloss: 0.5 }, tint: '#9e2219' });
  // Gefahrgut-Raute auf dem Mantel (Band auf halber Höhe): gelbes Quadrat übereck
  const lab = M.mat('barrel_red_label', { mgen: 'paint', opt: { seed: 202, rust: 0.4, wear: 0.4 }, tint: '#9e2219', decal: (x, y) => {
    const cx = 0.12, cy = 0.5, d = Math.abs(x - cx) + Math.abs(y - cy) * 1.0;
    if (d < 0.075) return d > 0.068 ? [0.1, 0.08, 0.05, 1] : [0.86, 0.68, 0.1, 1];
    return null;
  } });
  drum(M, { r: 0.281, h: 0.879, mat: red, label: lab });
};
MODELS.barrel_02 = (M) => {
  // Kunststofffass blau (Spundfass): umlaufende Rippen, gerundete Kanten, zwei Spunde
  const blue = M.mat('barrel_blue', { mgen: 'plastic', opt: { seed: 211, gloss: 0.45 }, tint: '#1d4f9c' });
  const r = 0.244, h = 0.88;
  const prof = [[0, 0.004], [r - 0.03, 0.004], [r - 0.005, 0.02], [r, 0.05]];
  for (const y of [0.2, 0.32, 0.56, 0.68]) prof.push([r, y - 0.012], [r + 0.008, y], [r, y + 0.012]);
  prof.push([r, h - 0.05], [r + 0.01, h - 0.035], [r + 0.01, h - 0.012], [r - 0.012, h], [0, h - 0.004]);
  M.add(G.lathe(prof, 36), blue, { uv: 'cyl', r });
  for (const [x, z] of [[0.13, 0.05], [-0.13, -0.05]]) M.add(G.cyl(0.03, 0.032, 0.022, x, h - 0.004, z, { seg: 12 }), blue);
};
MODELS.barrel_03 = (M) => {
  const gray = M.mat('barrel_gray', { mgen: 'paint', opt: { seed: 221, rust: 0.6, wear: 0.5, gloss: 0.4 }, tint: '#4f6474' });
  drum(M, { r: 0.317, h: 0.93, mat: gray });
};

/** Wehrmachtskanister: Körper mit X-Sicke, Schweißnaht, drei Griffe, Verschluss */
function jerrycan(M, mat) {
  const W = 0.35, H = 0.46, D = 0.165;
  M.add(G.box(W, H - 0.03, D, 0, (H - 0.03) / 2, 0, 0.018, 3), mat);
  // X-Sicken (beidseitig)
  for (const s of [1, -1]) {
    const z = s * (D / 2 + 0.002);
    const a = Math.atan2(H - 0.12, W - 0.08), len = Math.hypot(W - 0.08, H - 0.12);
    for (const sg of [1, -1]) M.add(G.rot(G.box(len, 0.022, 0.008, 0, 0, 0, 0.004), 0, 0, sg * a).translate(0, (H - 0.03) / 2, z), mat);
    M.add(G.box(W - 0.05, 0.01, 0.006, 0, 0.05, z), mat); M.add(G.box(W - 0.05, 0.01, 0.006, 0, H - 0.09, z), mat);
  }
  M.add(G.box(W + 0.006, 0.012, D + 0.006, 0, H * 0.5, 0, 0.004), mat); // Naht
  for (const x of [-0.1, 0, 0.1]) M.add(G.tube([[x - 0.025, H - 0.03, 0], [x - 0.02, H + 0.02, 0], [x + 0.02, H + 0.02, 0], [x + 0.025, H - 0.03, 0]], 0.008, { seg: 6 }), mat);
  // Ausguss mit Hebelverschluss vorn
  M.add(G.cyl(0.024, 0.026, 0.035, W / 2 - 0.05, H - 0.02, 0, { seg: 14 }), mat);
  M.add(G.box(0.05, 0.014, 0.03, W / 2 - 0.03, H + 0.004, 0, 0.004), mat);
}
MODELS.metal_jerrycan = (M) => jerrycan(M, M.mat('jerrycan_red', { mgen: 'paint', opt: { seed: 231, rust: 0.4, wear: 0.5, gloss: 0.5 }, tint: '#8f2219' }));
MODELS.metal_jerrycan_green = (M) => jerrycan(M, M.mat('jerrycan_green', { mgen: 'paint', opt: { seed: 232, rust: 0.3, wear: 0.4, gloss: 0.35 }, tint: '#2c3a30' }));

MODELS.ammo_box = (M) => {
  // Munitionskiste (Kaliber .30): Körper, Deckel mit Dichtfalz, Verschlusshebel, Tragegriff, Schablonenschrift-Band
  const od = M.mat('ammo_od', { mgen: 'paint', opt: { seed: 241, rust: 0.25, wear: 0.5, gloss: 0.35 }, tint: '#4a4e33', decal: (x, y) => (y > 0.06 && y < 0.075 && x > 0.02 && x < 0.2 ? [0.85, 0.82, 0.6, 0.85] : null) });
  const W = 0.086, H = 0.177, L = 0.257;
  M.add(G.box(W, H - 0.03, L, 0, (H - 0.03) / 2, 0, 0.004), od);
  M.add(G.box(W + 0.006, 0.03, L + 0.004, 0, H - 0.017, 0, 0.004), od);           // Deckel
  M.add(G.box(W - 0.02, 0.006, L - 0.06, 0, H + 0.0, 0, 0.002), od);              // Prägung
  M.add(G.tube([[0, H + 0.002, -0.06], [0, H + 0.012, -0.05], [0, H + 0.012, 0.05], [0, H + 0.002, 0.06]], 0.005), od); // Griff (umgelegt)
  M.add(G.box(0.012, 0.06, 0.035, 0, H - 0.04, L / 2 + 0.006, 0.003), od);        // Verschlusshebel
  M.add(G.box(0.03, 0.02, 0.01, 0, H - 0.02, -L / 2 - 0.004, 0.003), od);         // Scharnier
};

/** Holzkiste mit Deckel, Leisten, Eckwinkeln und Seilgriffen */
MODELS.wooden_military_crate = (M) => {
  const wood = M.mat('crate_wood', { gen: 'wood_crate', tint: '#6b5236', tintAmount: 0.4, bright: 0.55 });
  const metal = M.mat('crate_metal', { mgen: 'paint', opt: { seed: 251, rust: 0.5, wear: 0.4 }, tint: '#3a3a35' });
  const rope = M.mat('crate_rope', { gen: 'burlap', bright: 0.9 });
  const L = 1.24, H = 0.46, D = 0.52;
  M.add(G.box(L - 0.02, H - 0.06, D - 0.02, 0, (H - 0.06) / 2, 0, 0.006), wood, { tile: 1.87 });
  M.add(G.box(L, 0.06, D, 0, H - 0.03, 0, 0.008), wood, { tile: 1.87 });             // Deckel
  for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) M.add(G.box(0.08, H - 0.07, D + 0.012, x, (H - 0.07) / 2, 0, 0.006), wood, { tile: 1.87, uvOff: [0.3, 0.1] }); // Stirnleisten
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.add(G.box(0.05, 0.05, 0.05, sx * (L / 2 - 0.02), H - 0.025, sz * (D / 2 - 0.02), 0.004), metal);
  for (const sx of [-1, 1]) M.add(G.tube([[sx * (L / 2 + 0.004), H * 0.6, -0.1], [sx * (L / 2 + 0.04), H * 0.5, -0.06], [sx * (L / 2 + 0.04), H * 0.5, 0.06], [sx * (L / 2 + 0.004), H * 0.6, 0.1]], 0.012), rope);
  for (const z of [-0.12, 0.12]) M.add(G.box(0.06, 0.012, 0.03, L / 2 - 0.25, H, z, 0.003), metal); // Verschlüsse
};
/** Zwei lange Transportkisten (oliv, abgerundet), versetzt nebeneinander — wie das alte Modellpaar */
MODELS.old_military_crate = (M) => {
  const od = M.mat('mcrate_od', { mgen: 'paint', opt: { seed: 261, rust: 0.35, wear: 0.55, gloss: 0.3 }, tint: '#4d553a' });
  const strap = M.mat('mcrate_strap', { gen: 'canvas', tint: '#3c3a2e' });
  const one = (x, z) => {
    const L = 0.82, H = 0.3, D = 0.4;
    M.add(G.box(L, H - 0.02, D, x, (H - 0.02) / 2, z, 0.05, 4), od);
    M.add(G.box(L + 0.01, 0.025, D + 0.01, x, H * 0.62, z, 0.01), od);   // Deckelfuge/Falz
    for (const dx of [-0.24, 0.24]) M.add(G.box(0.05, H + 0.004, D + 0.012, x + dx, H / 2, z, 0.006), strap); // Gurte
    for (const s of [-1, 1]) M.add(G.box(0.03, 0.04, 0.05, x + s * (L / 2 + 0.01), H * 0.55, z, 0.008), od); // Griffe
  };
  one(-0.46, 0.06); one(0.46, -0.32);
};

/* ---------------------------------------------------------------- Behälter, Säcke, Reifen */
MODELS.old_tyre = (M) => {
  const tyre = M.mat('tyre', { mgen: 'tread' });
  const prof = [[0.2, -0.068], [0.212, -0.078], [0.26, -0.082], [0.288, -0.074], [0.299, -0.05], [0.3, -0.02], [0.3, 0.02], [0.299, 0.05], [0.288, 0.074], [0.26, 0.082], [0.212, 0.078], [0.2, 0.068], [0.196, 0.0], [0.2, -0.068]];
  M.add(G.rot(G.lathe(prof, 48), Math.PI / 2, 0, 0), tyre, { uv: 'cyl', ax: 'z', r: 0.3, tile: 1 });
};
MODELS.cardboard_box_01 = (M) => {
  const cb = M.mat('cardboard', { gen: 'cardboard' });
  const tape = M.mat('tape', { mgen: 'plastic', opt: { seed: 271, gloss: 0.7 }, tint: '#b49766' });
  const W = 0.386, H = 0.342, D = 0.516;
  M.add(G.warp(G.box(W, H, D, 0, H / 2, 0, 0.006, 3), (v) => { const k = Math.cos((v.y / H - 0.5) * Math.PI) * 0.008; v.x += Math.sign(v.x) * k; v.z += Math.sign(v.z) * k * 0.6; }), cb);
  M.add(G.box(0.004, 0.002, D - 0.01, 0, H + 0.001, 0, 0), cb);                        // Klappenfuge
  M.add(G.box(0.06, 0.003, D + 0.004, 0, H + 0.0015, 0, 0.001), tape);
  for (const s of [-1, 1]) M.add(G.box(0.06, 0.09, 0.003, 0, H - 0.045, s * (D / 2 + 0.0015), 0.001), tape);
};
MODELS.cement_bag = (M) => {
  const red = (x, y) => { const band = frac(y + 0.11) < 0.22; if (!band) return null; const letter = Math.abs(frac(x * 9) - 0.5) < 0.16 && Math.abs(frac(y + 0.11) - 0.11) < 0.035; return letter ? [0.92, 0.9, 0.86, 1] : [0.62, 0.1, 0.08, 0.95]; };
  const paper = M.mat('cement_paper', { mgen: 'paper', decal: red });
  const W = 0.463, H = 0.178, D = 0.699;
  const g = G.box(W, H, D, 0, H / 2, 0, 0.06, 6);
  G.warp(g, (v) => { const fx = Math.min(1, Math.abs(v.x) / (W / 2)), fz = Math.min(1, Math.abs(v.z) / (D / 2)); const bulge = (1 - fx ** 4) * (1 - fz ** 6); v.y = H * 0.12 + (v.y - H * 0.12) * (0.55 + 0.45 * bulge); });
  M.add(g, paper);
  for (const s of [-1, 1]) M.add(G.box(W * 0.92, 0.012, 0.03, 0, H * 0.25, s * (D / 2 - 0.01), 0.005), paper); // gefalzte Enden
};
MODELS.trashbag = (M) => {
  const bag = M.mat('trashbag', { mgen: 'bag' });
  const n = makeNoise(281);
  const body = G.blob(0.26, 0, 0.24, 0, { detail: 4, sy: 0.95, fn: (d) => 1 + 0.12 * (n(frac(Math.atan2(d.z, d.x) / 6.283), (d.y + 1) / 2, 5, 3, 3) - 0.5) * 2 });
  M.add(G.warp(body, (v) => { if (v.y < 0.03) v.y = 0.03 * Math.max(0, v.y + 0.2) / 0.23; }), bag); // flach aufliegender Boden
  M.add(G.lathe([[0.0, 0.47], [0.07, 0.47], [0.03, 0.52], [0.02, 0.55], [0.05, 0.575], [0.0, 0.575]], 12), bag); // Knoten
};
MODELS.industrial_pastic_container = (M) => {
  const pl = M.mat('crate_blue', { mgen: 'plastic', opt: { seed: 291, gloss: 0.45 }, tint: '#1d3c9c' });
  const W = 0.458, H = 0.419, D = 0.631, t = 0.012;
  M.add(G.box(W - 0.03, t, D - 0.03, 0, t / 2, 0, 0.004), pl);
  for (const s of [-1, 1]) {
    M.add(G.box(t, H - 0.02, D - 0.02, s * (W / 2 - 0.015 - t / 2), H / 2, 0, 0.003), pl);
    M.add(G.box(W - 0.02, H - 0.02, t, 0, H / 2, s * (D / 2 - 0.015 - t / 2), 0.003), pl);
    for (const z of [-0.2, -0.1, 0, 0.1, 0.2]) M.add(G.box(0.012, H - 0.06, 0.012, s * (W / 2 - 0.012), H / 2 - 0.01, z, 0.004), pl);
    for (const x of [-0.12, 0, 0.12]) M.add(G.box(0.012, H - 0.06, 0.012, x, H / 2 - 0.01, s * (D / 2 - 0.012), 0.004), pl);
    M.add(G.box(0.14, 0.035, 0.03, 0, H - 0.07, s * (D / 2 - 0.004), 0.01), pl);   // Griffleiste
  }
  // umlaufender Rand oben
  for (const s of [-1, 1]) { M.add(G.box(W, 0.025, 0.02, 0, H - 0.0125, s * (D / 2 - 0.01), 0.005), pl); M.add(G.box(0.02, 0.025, D, s * (W / 2 - 0.01), H - 0.0125, 0, 0.005), pl); }
};
MODELS.propane_tank = (M) => {
  const red = M.mat('propane_red', { mgen: 'paint', opt: { seed: 301, rust: 0.3, wear: 0.4, gloss: 0.55 }, tint: '#a02219', decal: (x, y) => (Math.abs(y - 0.32) < 0.035 && frac(x * 3) < 0.4 ? [0.92, 0.9, 0.85, 1] : null) });
  const brass = M.mat('propane_valve', { mgen: 'paint', opt: { seed: 302, rust: 0, wear: 0.8, gloss: 0.7 }, tint: '#9a7a3a', metal: 0.9 });
  const r = 0.165;
  M.add(G.lathe([[0.13, 0], [0.15, 0.002], [0.15, 0.055], [0.12, 0.06], [r - 0.02, 0.07], [r, 0.11], [r, 0.4], [r - 0.02, 0.44], [0.11, 0.465], [0.05, 0.475], [0, 0.476]], 36), red, { uv: 'cyl', r });
  // Schutzkragen mit Griffausschnitten
  M.add(G.lathe([[0.085, 0.46], [0.09, 0.46], [0.09, 0.553], [0.085, 0.553]], 28), red);
  M.add(G.torus(0.088, 0.008, 0, 0.553, 0, { seg: 28 }), red);
  M.add(G.cyl(0.018, 0.022, 0.05, 0, 0.5, 0, { seg: 12 }), brass);
  M.add(G.cyl(0.012, 0.012, 0.03, 0.025, 0.51, 0, { seg: 10, axis: 'x' }), brass);
};

/* ---------------------------------------------------------------- Stadt, Versorgung */
MODELS.metal_trash_can = (M) => {
  const zinc = M.mat('trash_zinc', { gen: 'metal_galvanized', bright: 0.9 });
  const rust = M.mat('trash_rust', { mgen: 'paint', opt: { seed: 311, rust: 0.9, wear: 0.7, gloss: 0.3 }, tint: '#6d6f6c' });
  const can = (part, mat, tilt) => {
    const r = 0.26, h = 0.84;
    const prof = [[0.0, 0.0], [r - 0.02, 0.0], [r - 0.01, 0.02]];
    for (let k = 0; k < 4; k++) { const y = 0.12 + k * 0.2; prof.push([r - 0.008 + k * 0.004, y - 0.02], [r + 0.004 + k * 0.004, y], [r - 0.008 + k * 0.004, y + 0.02]); }
    prof.push([r + 0.012, h - 0.01], [r + 0.02, h], [r + 0.005, h + 0.004], [r - 0.006, h - 0.02], [0, h - 0.02]);
    M.add(G.lathe(prof, 36), mat, { part, uv: 'cyl', r });
    for (const s of [-1, 1]) M.add(G.torus(0.05, 0.008, 0, 0, 0, { axis: 'z', seg: 12, arc: Math.PI }).rotateZ(s > 0 ? -Math.PI / 2 : Math.PI / 2).translate(s * (r + 0.01), h - 0.12, 0), mat, { part });
    // Deckel (schräg aufgelegt, seitlich verrutscht)
    const lid = G.lathe([[0, 0.05], [0.12, 0.045], [r + 0.02, 0.01], [r + 0.03, 0], [r + 0.02, -0.012], [0, 0.0]], 36);
    G.rot(lid, 0, 0, tilt).translate(0.12, h + 0.03, 0);
    M.add(lid, mat, { part, uv: 'cyl', r });
    M.add(G.tube([[0.07, h + 0.09, 0], [0.09, h + 0.12, 0], [0.17, h + 0.12, 0], [0.19, h + 0.09, 0]], 0.009).rotateZ(tilt * 0.5), mat, { part });
  };
  can('metal_trash_can_handle_left', zinc, -0.12);
  can('metal_trash_can_rust', rust, 0.1);
};
MODELS.exterior_aircon_unit = (M) => {
  const clean = M.mat('ac_case', { mgen: 'paint', opt: { seed: 321, rust: 0.05, wear: 0.15, gloss: 0.45 }, tint: '#c9c9c1' });
  const rusty = M.mat('ac_case_rusted', { gen: 'metal_rust_painted', bright: 0.95 });
  const grille = M.mat('ac_grille', { mgen: 'paint', opt: { seed: 322, rust: 0.2, wear: 0.2 }, tint: '#2b2c2c' });
  const bracket = M.mat('ac_bracket', { gen: 'metal_galvanized', bright: 0.75 });
  const unit = (part, mat) => {
    const W = 0.8, H = 0.6, D = 0.3;
    M.add(G.box(W, H, D, 0, H / 2, 0, 0.012), mat, { part });
    // Lüftergitter vorn: Ringe + Speichen, dunkler Lüftertopf dahinter
    const cx = -0.1, cy = H / 2, z = D / 2 + 0.004;
    M.add(G.cyl(0.215, 0.215, 0.01, cx, cy, D / 2 - 0.002, { seg: 32, axis: 'z' }), grille, { part });
    for (const rr of [0.06, 0.1, 0.14, 0.18, 0.215]) M.add(G.torus(rr, 0.004, cx, cy, z, { axis: 'z', seg: 32, tseg: 4 }), grille, { part });
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; M.add(G.rod([cx, cy, z], [cx + Math.cos(a) * 0.215, cy + Math.sin(a) * 0.215, z], 0.004, 4), grille, { part }); }
    // Lamellen rechts, Anschlusskasten
    for (let k = 0; k < 9; k++) M.add(G.box(0.17, 0.008, 0.01, 0.27, 0.12 + k * 0.045, D / 2 + 0.004, 0.002), grille, { part });
    M.add(G.box(0.12, 0.14, 0.05, W / 2 + 0.02, 0.18, 0.05, 0.006), mat, { part });
    // Konsolen (Winkel zur Wand, unten)
    for (const x of [-0.3, 0.3]) {
      M.add(G.box(0.04, 0.03, D + 0.06, x, -0.015, -0.03, 0.003), bracket, { part });
      M.add(G.box(0.04, 0.32, 0.03, x, -0.16, -D / 2 - 0.045, 0.003), bracket, { part });
      M.add(G.rod([x, -0.3, -D / 2 - 0.04], [x, -0.02, D / 2 - 0.02], 0.01, 6), bracket, { part });
    }
  };
  unit('exterior_aircon_unit', clean);
  unit('exterior_aircon_unit_rusted', rusty);
};
MODELS.fire_hydrant = (M) => {
  const fresh = M.mat('hydrant', { mgen: 'paint', opt: { seed: 331, rust: 0.15, wear: 0.3, gloss: 0.6 }, tint: '#b2271d' });
  const aged = M.mat('hydrant_aged', { mgen: 'paint', opt: { seed: 332, rust: 0.8, wear: 0.7, gloss: 0.35 }, tint: '#8e2a20' });
  const one = (part, mat) => {
    M.add(G.lathe([[0.12, 0], [0.12, 0.035], [0.1, 0.045], [0.085, 0.06], [0.085, 0.52], [0.1, 0.53], [0.105, 0.56], [0.095, 0.57], [0.088, 0.62], [0.07, 0.68], [0.04, 0.71], [0.0, 0.715]], 28), mat, { part, uv: 'cyl', r: 0.09 });
    M.add(G.cyl(0.022, 0.026, 0.05, 0, 0.735, 0, { seg: 5 }), mat, { part });              // Fünfkant
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; M.add(G.cyl(0.008, 0.008, 0.02, Math.cos(a) * 0.105, 0.045, Math.sin(a) * 0.105, { seg: 6 }), mat, { part }); }
    for (const s of [-1, 1]) {
      M.add(G.cyl(0.032, 0.035, 0.07, s * 0.115, 0.43, 0, { seg: 16, axis: 'x' }), mat, { part });
      M.add(G.cyl(0.03, 0.03, 0.025, s * 0.16, 0.43, 0, { seg: 5, axis: 'x' }), mat, { part });
    }
    M.add(G.cyl(0.05, 0.055, 0.09, 0, 0.4, 0.12, { seg: 18, axis: 'z' }), mat, { part });   // Pumpenstutzen vorn
    M.add(G.cyl(0.045, 0.045, 0.03, 0, 0.4, 0.175, { seg: 5, axis: 'z' }), mat, { part });
    M.add(G.tube([[0.12, 0.4, 0.02], [0.1, 0.3, 0.08], [0.04, 0.33, 0.15]], 0.004, { seg: 4 }), mat, { part }); // Kette
  };
  one('fire_hydrant', fresh); one('fire_hydrant_aged', aged);
};
MODELS.concrete_road_barrier = (M) => {
  const conc = M.mat('barrier_concrete', { gen: 'concrete_dirty', bright: 1.15 });
  const prof = [[-0.3, 0], [0.3, 0], [0.3, 0.075], [0.2, 0.33], [0.08, 0.81], [-0.08, 0.81], [-0.2, 0.33], [-0.3, 0.075]];
  M.add(G.extrude(prof, 1.54, 'x', { bevel: 0.012, bseg: 2 }), conc);
  // Hebeschlaufen / Kopplungsnuten an den Stirnseiten
  for (const s of [-1, 1]) M.add(G.box(0.06, 0.12, 0.16, s * 0.75, 0.62, 0, 0.01), conc);
};
MODELS.utility_box_01 = (M) => {
  const pnt = M.mat('ubox_paint', { mgen: 'paint', opt: { seed: 341, rust: 0.2, wear: 0.35, gloss: 0.35 }, tint: '#8a958d', decal: (x, y) => (y > 0.86 && y < 0.88 && x > 0.1 && x < 0.3 ? [0.9, 0.8, 0.1, 1] : null) });
  const conc = M.mat('ubox_plinth', { gen: 'concrete_panels' });
  const dark = M.mat('ubox_dark', { mgen: 'paint', opt: { seed: 342, rust: 0.1 }, tint: '#2f3330' });
  const W = 0.52, D = 0.43;
  M.add(G.box(W - 0.02, 0.12, D - 0.04, 0, 0.06, 0, 0.01), conc);
  M.add(G.box(W - 0.04, 0.94, D - 0.06, 0, 0.12 + 0.47, 0, 0.01), pnt);
  M.add(G.warp(G.box(W, 0.06, D, 0, 1.09, 0, 0.012, 3), (v) => { v.y += (1 - (Math.abs(v.z) / (D / 2)) ** 2) * 0.012; }), pnt); // Dach
  for (const s of [-1, 1]) {
    M.add(G.box(0.004, 0.86, 0.004, s * 0.005, 0.57, D / 2 - 0.028, 0), dark);           // Türfuge Mitte
    for (let k = 0; k < 5; k++) M.add(G.box(0.18, 0.008, 0.006, s * 0.12, 0.9 + k * 0.025, D / 2 - 0.028, 0.002), dark); // Lüftung
  }
  M.add(G.box(0.02, 0.05, 0.014, 0.04, 0.6, D / 2 - 0.024, 0.004), dark);                  // Schloss
};
MODELS.power_box_01 = (M) => {
  const pnt = M.mat('pbox_paint', { mgen: 'paint', opt: { seed: 351, rust: 0.25, wear: 0.3, gloss: 0.4 }, tint: '#b6b9b2' });
  const inner = M.mat('pbox_inner', { mgen: 'paint', opt: { seed: 352, rust: 0.05, wear: 0.1 }, tint: '#c9c7bd' });
  const brk = M.mat('pbox_breaker', { mgen: 'plastic', opt: { seed: 353, gloss: 0.4 }, tint: '#dcd9cf' });
  const cable = M.mat('pbox_cable', { mgen: 'rubber' });
  const W = 0.38, H = 0.5, D = 0.16;
  const z0 = -0.047;
  M.add(G.box(W, H, 0.012, 0, 0, z0 + 0.006, 0.003), pnt);                                   // Rückwand
  for (const s of [-1, 1]) { M.add(G.box(0.012, H, D, s * (W / 2 - 0.006), 0, z0 + D / 2, 0.003), pnt); M.add(G.box(W, 0.012, D, 0, s * (H / 2 - 0.006), z0 + D / 2, 0.003), pnt); }
  M.add(G.box(W - 0.04, H - 0.04, 0.006, 0, 0, z0 + 0.03, 0.002), inner);                     // Montageplatte
  for (const y of [0.13, 0.0, -0.13]) {
    M.add(G.box(W - 0.08, 0.012, 0.01, 0, y, z0 + 0.04, 0.002), pnt);                          // Hutschiene
    for (let k = 0; k < 7; k++) M.add(G.box(0.03, 0.08, 0.06, -0.12 + k * 0.04, y, z0 + 0.07, 0.004), brk);
  }
  for (const x of [-0.1, 0.0, 0.1]) M.add(G.tube([[x, -H / 2 - 0.02, z0 + 0.06], [x, -0.2, z0 + 0.06], [x + 0.02, -0.18, z0 + 0.05]], 0.008, { seg: 6 }), cable);
  // Tür offen (links angeschlagen, ~105°)
  const door = G.box(W, H, 0.014, W / 2, 0, 0, 0.004);
  G.rot(door, 0, -1.83, 0).translate(-W / 2, 0, z0 + D);
  M.add(door, pnt);
};

/* ---------------------------------------------------------------- Fahrzeug unter Plane */
MODELS.covered_car = (M) => {
  const cover = M.mat('car_cover', { mgen: 'cloth', tint: '#596069' });
  const tyre = M.mat('car_tyre', { mgen: 'tread' });
  const L = 4.37, W = 1.78;
  // Seitenriss (z = Länge, y = Höhe) als Spline: Heckschürze, Kofferraum, Heckscheibe, Dach, Frontscheibe, Haube, Bug
  const top = [[L / 2, 0.5], [L / 2 - 0.12, 0.86], [L / 2 - 0.6, 0.97], [L / 2 - 1.0, 1.08], [L / 2 - 1.45, 1.36], [0.0, 1.41],
    [-L / 2 + 1.75, 1.36], [-L / 2 + 1.15, 0.98], [-L / 2 + 0.55, 0.86], [-L / 2 + 0.08, 0.72], [-L / 2, 0.5]];
  const shape = new THREE.Shape();
  shape.moveTo(L / 2 - 0.04, 0.22);
  shape.splineThru(top.map(([z, y]) => new THREE.Vector2(z, y)));
  shape.lineTo(-L / 2 + 0.04, 0.22);
  shape.lineTo(L / 2 - 0.04, 0.22);
  const body = new THREE.ExtrudeGeometry(shape, { depth: W - 0.3, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 5, curveSegments: 48 });
  body.translate(0, 0, -(W - 0.3) / 2);
  G.rot(body, 0, Math.PI / 2, 0);
  const n = makeNoise(361);
  G.warp(body, (v) => {
    // Fahrgastzelle verjüngt sich nach oben, Flanken leicht gewölbt, Plane hängt durch und wirft Falten
    const t = clamp01((v.y - 0.9) / 0.5);
    v.x *= (1 - 0.2 * t) * (1 + 0.03 * Math.sin(clamp01((v.y - 0.2) / 0.7) * Math.PI));
    v.y += (n(frac(v.x / W + 0.5), frac(v.z / L + 0.5), 6, 14, 3) - 0.5) * 0.045 * (0.4 + 0.6 * t);
  });
  M.add(body, cover, { tile: 1.5 });
  // Schürze bis knapp über den Boden, Reifen schauen heraus
  for (const [x, z] of [[-0.74, -1.35], [0.74, -1.35], [-0.74, 1.4], [0.74, 1.4]]) M.add(G.lathe([[0.21, -0.1], [0.3, -0.1], [0.32, -0.06], [0.32, 0.06], [0.3, 0.1], [0.21, 0.1]], 24).rotateZ(Math.PI / 2).translate(x, 0.32, z), tyre, { uv: 'cyl', ax: 'x', r: 0.32 });
};

/* ---------------------------------------------------------------- Werkstatt */
MODELS.hanging_industrial_lamp = (M) => {
  const shade = M.mat('lamp_shade', { mgen: 'paint', opt: { seed: 371, rust: 0.2, wear: 0.3, gloss: 0.55 }, tint: '#33473b' });
  const white = M.mat('lamp_inner', { mgen: 'paint', opt: { seed: 372, rust: 0.05, wear: 0.05, gloss: 0.6 }, tint: '#e9e7df' });
  const cable = M.mat('lamp_cable', { mgen: 'rubber' });
  const bulb = M.mat('lamp_bulb', { mgen: 'plastic', opt: { seed: 373, gloss: 0.8 }, tint: '#fff3d6', bright: 1.1 });
  M.add(G.cyl(0.04, 0.04, 0.015, 0, -0.0075, 0, { seg: 16 }), shade);                      // Deckenrosette
  M.add(G.cyl(0.006, 0.006, 0.93, 0, -0.48, 0, { seg: 6 }), cable);
  M.add(G.lathe([[0.03, -0.94], [0.045, -0.95], [0.05, -1.02], [0.1, -1.08], [0.2, -1.17], [0.265, -1.25], [0.275, -1.26], [0.27, -1.265]].reverse(), 32), shade, { uv: 'cyl', r: 0.15 });
  M.add(G.lathe([[0.26, -1.255], [0.19, -1.17], [0.095, -1.085], [0.04, -1.03], [0.0, -1.025]].reverse(), 32), white, { uv: 'cyl', r: 0.15 });
  M.add(G.blob(0.055, 0, -1.17, 0, { detail: 2, sy: 1.25 }), bulb);
};
MODELS.hand_truck = (M) => {
  const frame = M.mat('htruck_frame', { mgen: 'paint', opt: { seed: 381, rust: 0.35, wear: 0.5, gloss: 0.45 }, tint: '#8b231c' });
  const tyre = M.mat('htruck_tyre', { mgen: 'tread' });
  const steel = M.mat('htruck_steel', { gen: 'metal_galvanized', bright: 0.8 });
  for (const s of [-1, 1]) M.add(G.tube([[s * 0.2, 0.05, 0.08], [s * 0.2, 0.7, 0.02], [s * 0.21, 1.25, -0.02], [s * 0.16, 1.39, -0.06], [s * 0.05, 1.4, -0.07]], 0.014, { seg: 8, steps: 40 }), frame);
  M.add(G.rod([-0.06, 1.4, -0.07], [0.06, 1.4, -0.07], 0.014), frame);
  for (const y of [0.35, 0.65, 0.95]) M.add(G.rod([-0.2, y, 0.06 - y * 0.06], [0.2, y, 0.06 - y * 0.06], 0.009), frame);
  M.add(G.box(0.42, 0.012, 0.36, 0, 0.012, 0.25, 0.004), steel);                          // Schaufel
  M.add(G.rod([-0.28, 0.13, -0.02], [0.28, 0.13, -0.02], 0.012), steel);                   // Achse
  for (const s of [-1, 1]) {
    M.add(G.lathe([[0.03, -0.035], [0.11, -0.035], [0.13, -0.02], [0.13, 0.02], [0.11, 0.035], [0.03, 0.035]], 24).rotateZ(Math.PI / 2).translate(s * 0.255, 0.13, -0.02), tyre, { uv: 'cyl', ax: 'x', r: 0.13 });
    M.add(G.rod([s * 0.2, 0.05, 0.08], [s * 0.22, 0.13, -0.02], 0.01), frame);
  }
};
MODELS.metal_tool_chest = (M) => {
  const red = M.mat('chest_red', { mgen: 'paint', opt: { seed: 391, rust: 0.15, wear: 0.4, gloss: 0.6 }, tint: '#a3201b' });
  const steel = M.mat('chest_steel', { gen: 'metal_galvanized', bright: 1.05 });
  const W = 0.68, D = 0.32;
  M.add(G.box(W, 0.42, D, 0, 0.21, 0, 0.008), red);
  for (let k = 0; k < 5; k++) {
    const y = 0.05 + k * 0.075;
    M.add(G.box(W - 0.04, 0.066, 0.01, 0, y + 0.03, D / 2 + 0.003, 0.003), red);
    M.add(G.box(W - 0.12, 0.012, 0.012, 0, y + 0.05, D / 2 + 0.012, 0.004), steel);
  }
  M.add(G.box(W, 0.16, D, 0, 0.5, 0, 0.008), red);                                         // Aufsatz
  M.add(G.box(W - 0.04, 0.04, 0.01, 0, 0.47, D / 2 + 0.003, 0.003), red);
  const lid = G.box(W, 0.02, D, 0, 0.0, D / 2, 0.006);                                     // Deckel offen (nach hinten)
  G.rot(lid, -1.75, 0, 0).translate(0, 0.585, -D / 2);
  M.add(lid, red);
  for (const s of [-1, 1]) M.add(G.box(0.012, 0.05, 0.1, s * (W / 2 + 0.006), 0.5, 0, 0.004), steel);
};
MODELS.portable_generator = (M) => {
  const frame = M.mat('gen_frame', { mgen: 'paint', opt: { seed: 401, rust: 0.2, wear: 0.4, gloss: 0.5 }, tint: '#1e1f1f' });
  const tank = M.mat('gen_tank', { mgen: 'paint', opt: { seed: 402, rust: 0.1, wear: 0.4, gloss: 0.6 }, tint: '#c49a1c' });
  const eng = M.mat('gen_engine', { gen: 'gunmetal_worn', bright: 1.6 });
  const L = 0.8, H = 0.56, D = 0.55;
  for (const sx of [-1, 1]) {
    M.add(G.tube([[sx * L / 2, 0.02, -D / 2 + 0.02], [sx * L / 2, H - 0.02, -D / 2 + 0.02], [sx * L / 2, H - 0.02, D / 2 - 0.02], [sx * L / 2, 0.02, D / 2 - 0.02]], 0.014, { closed: true, tension: 0.05, steps: 60 }), frame);
    for (const sz of [-1, 1]) M.add(G.rod([-L / 2, 0.03, sz * (D / 2 - 0.02)], [L / 2, 0.03, sz * (D / 2 - 0.02)], 0.012), frame);
  }
  M.add(G.box(0.36, 0.3, 0.3, -0.08, 0.2, 0, 0.02), eng);                                   // Motor
  M.add(G.box(0.26, 0.24, 0.32, 0.22, 0.17, 0, 0.02), eng);                                 // Lichtmaschine
  M.add(G.box(0.62, 0.13, 0.38, 0, H - 0.1, 0, 0.05, 4), tank);                             // Tank
  M.add(G.cyl(0.04, 0.04, 0.03, -0.18, H - 0.02, 0.05, { seg: 14 }), frame);
  M.add(G.cyl(0.06, 0.06, 0.22, -0.2, 0.2, -0.2, { seg: 16, axis: 'x' }), eng);             // Auspuff
  M.add(G.box(0.2, 0.14, 0.01, 0.22, 0.2, D / 2 - 0.08, 0.004), frame);                     // Schalttafel
};
MODELS.tool_cart = (M) => {
  const green = M.mat('cart_green', { mgen: 'paint', opt: { seed: 411, rust: 0.35, wear: 0.5, gloss: 0.45 }, tint: '#2c513a' });
  const tyre = M.mat('cart_tyre', { mgen: 'tread' });
  const steel = M.mat('cart_steel', { gen: 'metal_galvanized', bright: 0.8 });
  const L = 1.15, D = 0.7, H = 0.96;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.add(G.box(0.035, H - 0.14, 0.035, sx * (L / 2 - 0.02), 0.12 + (H - 0.14) / 2, sz * (D / 2 - 0.02), 0.004), green);
  M.add(G.box(L, 0.04, D, 0, H - 0.02, 0, 0.008), green);                                   // Platte oben (Rand)
  M.add(G.box(L - 0.04, 0.12, D - 0.04, 0, H - 0.1, 0, 0.006), green);                    // Schubladenblock
  for (const x of [-0.27, 0.27]) { M.add(G.box(0.5, 0.09, 0.008, x, H - 0.1, D / 2 - 0.016, 0.003), green); M.add(G.box(0.14, 0.012, 0.014, x, H - 0.08, D / 2 - 0.008, 0.004), steel); }
  M.add(G.box(L - 0.02, 0.03, D - 0.02, 0, 0.26, 0, 0.006), green);                        // Ablage unten
  for (const s of [-1, 1]) M.add(G.box(L - 0.02, 0.05, 0.01, 0, 0.29, s * (D / 2 - 0.01), 0.003), green);
  M.add(G.tube([[L / 2 - 0.02, H - 0.1, -0.25], [L / 2 + 0.1, H - 0.08, -0.25], [L / 2 + 0.1, H - 0.08, 0.25], [L / 2 - 0.02, H - 0.1, 0.25]], 0.014, { tension: 0.1 }), steel); // Schiebebügel
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    M.add(G.box(0.05, 0.03, 0.05, sx * (L / 2 - 0.02), 0.115, sz * (D / 2 - 0.02), 0.004), steel);
    M.add(G.lathe([[0.015, -0.02], [0.045, -0.02], [0.05, 0], [0.045, 0.02], [0.015, 0.02]], 16).rotateZ(Math.PI / 2).translate(sx * (L / 2 - 0.02), 0.05, sz * (D / 2 - 0.02)), tyre, { uv: 'cyl', ax: 'x', r: 0.05 });
  }
};

/* ---------------------------------------------------------------- Möbel, Regale */
MODELS.metal_office_desk = (M) => {
  const gray = M.mat('desk_metal', { mgen: 'paint', opt: { seed: 421, rust: 0.1, wear: 0.35, gloss: 0.4 }, tint: '#a5a8a3' });
  const top = M.mat('desk_top', { mgen: 'plastic', opt: { seed: 422, gloss: 0.3 }, tint: '#6d6c63' });
  const steel = M.mat('desk_steel', { gen: 'metal_galvanized' });
  const L = 2.0, D = 0.94, H = 0.787;
  M.add(G.box(L, 0.035, D, 0, H - 0.0175, 0, 0.008), top);
  for (const s of [-1, 1]) {
    const x = s * (L / 2 - 0.23);
    M.add(G.box(0.44, H - 0.06, D - 0.06, x, (H - 0.06) / 2 + 0.01, 0, 0.006), gray);       // Schubladenblock
    for (const [y, h] of [[0.6, 0.14], [0.42, 0.18], [0.16, 0.3]]) {
      M.add(G.box(0.4, h - 0.012, 0.012, x, y, D / 2 - 0.024, 0.004), gray);
      M.add(G.box(0.12, 0.014, 0.016, x, y + h / 2 - 0.035, D / 2 - 0.014, 0.004), steel);
    }
  }
  M.add(G.box(L - 0.9, 0.4, 0.014, 0, H - 0.25, -D / 2 + 0.06, 0.004), gray);                 // Sichtblende
  M.add(G.box(L - 0.9, 0.1, D - 0.1, 0, H - 0.09, 0, 0.004), gray);                           // Mittelschublade
};
MODELS.schoolchair_01 = (M) => {
  const shell = M.mat('chair_shell', { mgen: 'plastic', opt: { seed: 431, gloss: 0.5 }, tint: '#22408a' });
  const steel = M.mat('chair_steel', { mgen: 'paint', opt: { seed: 432, rust: 0.1, wear: 0.5, gloss: 0.6 }, tint: '#9fa1a3', metal: 0.6 });
  const seat = G.box(0.44, 0.03, 0.42, 0, 0.45, 0.02, 0.012, 3);
  M.add(G.warp(seat, (v) => { v.y -= (1 - (v.x / 0.22) ** 2) * 0.012; v.y += (v.z > 0.18 ? (v.z - 0.18) * 0.2 : 0); }), shell);
  const back = G.box(0.42, 0.26, 0.022, 0, 0.82, -0.2, 0.012, 3);
  M.add(G.warp(back, (v) => { v.z -= (v.x / 0.21) ** 2 * 0.03; v.z -= (v.y - 0.82) * 0.12; }), shell);
  for (const s of [-1, 1]) {
    M.add(G.tube([[s * 0.2, 0.0, 0.25], [s * 0.21, 0.43, 0.2], [s * 0.21, 0.44, -0.16], [s * 0.2, 0.8, -0.21], [s * 0.19, 0.93, -0.24]], 0.011, { steps: 50 }), steel);
    M.add(G.tube([[s * 0.2, 0.0, -0.3], [s * 0.21, 0.43, -0.18]], 0.011), steel);
    M.add(G.cyl(0.014, 0.014, 0.012, s * 0.2, 0.006, 0.25, { seg: 10 }), shell);
    M.add(G.cyl(0.014, 0.014, 0.012, s * 0.2, 0.006, -0.3, { seg: 10 }), shell);
  }
  M.add(G.rod([-0.21, 0.42, 0.12], [0.21, 0.42, 0.12], 0.009), steel);
};
MODELS.steel_frame_shelves_01 = (M) => {
  const frame = M.mat('shelf_frame', { mgen: 'paint', opt: { seed: 441, rust: 0.3, wear: 0.4, gloss: 0.35 }, tint: '#3b3e3c' });
  const board = M.mat('shelf_board', { gen: 'osb', bright: 0.85 });
  const L = 1.1, D = 0.5, H = 2.14;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    M.add(G.box(0.035, H, 0.004, sx * (L / 2 - 0.0175), H / 2, sz * (D / 2 - 0.002), 0), frame); // Winkelprofil (zwei Schenkel)
    M.add(G.box(0.004, H, 0.035, sx * (L / 2 - 0.002), H / 2, sz * (D / 2 - 0.0175), 0), frame);
  }
  for (const y of [0.1, 0.55, 1.0, 1.45, 1.9]) {
    M.add(G.box(L - 0.01, 0.018, D - 0.01, 0, y, 0, 0.003), board, { tile: 2.5 });
    for (const s of [-1, 1]) { M.add(G.box(L, 0.035, 0.004, 0, y - 0.026, s * (D / 2 - 0.002), 0), frame); M.add(G.box(0.004, 0.035, D, s * (L / 2 - 0.002), y - 0.026, 0, 0), frame); }
  }
  for (const s of [-1, 1]) M.add(G.rod([s * (L / 2 - 0.01), 0.15, -D / 2 + 0.01], [s * (L / 2 - 0.01), 1.85, D / 2 - 0.01], 0.004, 4), frame); // Diagonalen
};
MODELS.worn_metal_rack = (M) => {
  const rust = M.mat('rack_rust', { mgen: 'paint', opt: { seed: 451, rust: 0.95, wear: 0.8, gloss: 0.25 }, tint: '#6a5644' });
  const L = 0.915, D = 0.6, H = 1.9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.add(G.box(0.03, H, 0.03, sx * (L / 2 - 0.015), H / 2, sz * (D / 2 - 0.015), 0.003), rust);
  for (const y of [0.15, 0.6, 1.05, 1.5, 1.88]) {
    for (const s of [-1, 1]) { M.add(G.box(L, 0.025, 0.02, 0, y, s * (D / 2 - 0.01), 0.003), rust); M.add(G.box(0.02, 0.025, D, s * (L / 2 - 0.01), y, 0, 0.003), rust); }
    for (let k = 1; k < 8; k++) M.add(G.box(0.008, 0.008, D - 0.03, -L / 2 + k * L / 8, y + 0.01, 0, 0.002), rust); // Gitterstäbe
  }
};
MODELS.plastic_monobloc_chair_01 = (M) => {
  const pl = M.mat('monobloc', { mgen: 'plastic', opt: { seed: 461, gloss: 0.4 }, tint: '#e3e1d8' });
  const seat = G.box(0.46, 0.035, 0.44, 0, 0.43, 0.02, 0.015, 3);
  M.add(G.warp(seat, (v) => { v.y -= (1 - (v.x / 0.23) ** 2) * (1 - ((v.z - 0.02) / 0.22) ** 2) * 0.025; }), pl);
  const back = G.box(0.46, 0.44, 0.025, 0, 0.65, -0.2, 0.015, 3);
  M.add(G.warp(back, (v) => { v.z -= (v.x / 0.23) ** 2 * 0.06; v.z -= (v.y - 0.43) * 0.25; v.x *= 1 - (v.y - 0.43) * 0.15; }), pl);
  for (let k = 0; k < 4; k++) M.add(G.box(0.3, 0.018, 0.03, 0, 0.6 + k * 0.055, -0.23 - (0.12 + k * 0.055) * 0.25, 0.006), pl); // Rippen
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.add(G.rod([sx * 0.2, 0.41, sz * 0.18 + 0.01], [sx * 0.29, 0.0, sz * 0.27 + 0.01], 0.026, 10), pl); // gespreizte Beine
  for (const s of [-1, 1]) M.add(G.tube([[s * 0.23, 0.62, -0.2], [s * 0.26, 0.62, 0.0], [s * 0.25, 0.58, 0.2], [s * 0.22, 0.43, 0.22]], 0.02, { steps: 30 }), pl); // Armlehnen
};
MODELS.wetfloorsign_01 = (M) => {
  const sign = M.mat('sign_yellow', { mgen: 'plastic', opt: { seed: 471, gloss: 0.55 }, tint: '#e2c013', decal: (x, y) => {
    const cx = frac(x + 0.5) - 0.5, cy = y - 0.36; // Warnzeichen mittig auf jeder Tafel (y = Höhe)
    const tri = cy > -0.12 && cy < 0.06 && Math.abs(cx) < (0.06 - cy) * 0.75;
    const inner = cy > -0.1 && cy < 0.03 && Math.abs(cx) < (0.03 - cy) * 0.6;
    return tri && !inner ? [0.08, 0.08, 0.08, 1] : null;
  } });
  const H = 0.63, W = 0.3;
  for (const s of [-1, 1]) {
    const p = G.box(W, H - 0.04, 0.012, 0, (H - 0.04) / 2, 0, 0.01, 2);
    G.rot(p, s * 0.27, 0, 0, [0, H - 0.04, 0]);
    M.add(p.translate(0, 0, 0), sign);
  }
  M.add(G.box(W * 0.6, 0.05, 0.03, 0, H - 0.02, 0, 0.012), sign);                            // Griff
};

/* ---------------------------------------------------------------- Natur */
MODELS.dead_tree_trunk_02 = (M) => {
  const bark = M.mat('trunk_bark', { mgen: 'bark' });
  const wood = M.mat('trunk_wood', { mgen: 'deadwood' });
  const n = makeNoise(481);
  const L = 4.0, R = 0.34;
  const g = new THREE.CylinderGeometry(1, 1, L, 20, 40, true);
  g.rotateZ(Math.PI / 2);
  G.warp(g, (v) => {
    const t = (v.x / L) + 0.5, a = Math.atan2(v.z, v.y);
    const r = R * (1.15 - 0.45 * t) * (1 + 0.12 * (n(frac(a / 6.283), t, 8, 6, 3) - 0.5) * 2) * (t < 0.06 ? 1 + (0.06 - t) * 5 : 1);
    v.y = v.y * r + Math.sin(t * Math.PI) * 0.12; v.z = v.z * r + Math.sin(t * 2.4) * 0.15;
  });
  M.add(g, bark, { uv: 'cyl', ax: 'x', r: R, tile: 1.2 });
  // Bruchflächen an den Enden
  M.add(G.warp(G.cyl(R * 1.38, R * 1.38, 0.02, -L / 2, 0.0, 0.0, { seg: 20, axis: 'x' }), (v) => { v.x += (n(frac(v.y * 3 + 0.5), frac(v.z * 3 + 0.5), 4, 4, 2) - 0.5) * 0.1; }), wood);
  M.add(G.cyl(R * 0.72, R * 0.72, 0.02, L / 2, 0.0, Math.sin(2.4) * 0.15, { seg: 20, axis: 'x' }), wood);
  // Aststümpfe
  for (const [x, a, len, r] of [[-0.8, 0.6, 0.6, 0.07], [0.3, 2.2, 0.45, 0.06], [1.1, -0.5, 0.7, 0.05], [-1.5, 3.6, 0.35, 0.08]]) {
    const b = G.cyl(r * 0.6, r, len, 0, len / 2, 0, { seg: 8 });
    G.rot(b, a, 0, 0.3);
    M.add(b.translate(x, Math.sin((x / L + 0.5) * Math.PI) * 0.12, Math.sin((x / L + 0.5) * 2.4) * 0.15), bark, { tile: 1.2 });
  }
};
MODELS.rock_07 = (M) => {
  const rock = M.mat('rock', { mgen: 'rock' });
  const n = makeNoise(491);
  M.add(G.blob(0.15, 0, 0.07, 0, { detail: 3, sx: 0.55, sy: 0.5, sz: 1.05, fn: (d) => 0.8 + 0.35 * n(frac(Math.atan2(d.z, d.x) / 6.283), (d.y + 1) / 2, 4, 3, 3) - (d.y < -0.5 ? 0.15 : 0) }), rock, { tile: 0.6 });
  G.warp(M.items[M.items.length - 1].g, (v) => { v.x = Math.round(v.x * 40) / 40 * 0.3 + v.x * 0.7; }); // leicht facettiert
};
MODELS.planter_pot_clay = (M) => {
  const clay = M.mat('pot_clay', { mgen: 'clay' });
  const soil = M.mat('pot_soil', { gen: 'dirt', bright: 0.7 });
  M.add(G.lathe([[0.0, 0.0], [0.085, 0.0], [0.09, 0.01], [0.115, 0.18], [0.128, 0.185], [0.132, 0.222], [0.12, 0.222], [0.115, 0.2], [0.1, 0.03], [0.0, 0.03]], 32), clay, { uv: 'cyl', r: 0.11, tile: 0.8 });
  M.add(G.cyl(0.114, 0.114, 0.01, 0, 0.19, 0, { seg: 28 }), soil, { tile: 0.8 });
};
