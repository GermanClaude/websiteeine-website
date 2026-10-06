// NULLPUNKT — Vegetation für Großkarten (Owner: world): Fichten, Laubbäume, Büsche, Schilf, Felsen und ein Grasring
// um die Kamera. Je Art ein InstancedMesh für die Nähe (Karten mit Laub-Atlas, Wind) und eines für die Ferne
// (Einfachmodell bis zur Nebelkante); Instanzen werden nach Kamerabewegung kompakt umsortiert (wenige Draw Calls).
// Stämme und Felsen liefern Kollisions-/Kugel-Dreiecke; Laub blockiert keine Kugeln.
import * as THREE from 'three';
import { createFoliage, foliageUniforms } from '../atlas.js';
import { rng, hash2, createSimplex, smoothstep } from './noise.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/** Fichte aus hängenden Zweigkarten in Etagen (Atlaszelle 0 = Laub), ≈ 90 Dreiecke, Höhe ≈ 11 m bei s = 1. */
function spruceGeometry() {
  const P = [], U = [], N = [];
  const u0 = 0.005, u1 = 0.495, v0 = 0.505, v1 = 0.995;
  const tiers = 8, H = 11, R0 = 2.5;
  const quad = (a, b, c, d, n) => {
    for (const [p, uv] of [[a, [u0, v0]], [b, [u1, v0]], [c, [u1, v1]], [a, [u0, v0]], [c, [u1, v1]], [d, [u0, v1]]]) { P.push(...p); U.push(...uv); N.push(...n); }
  };
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers, y = 1.4 + f * (H - 2.6), r = R0 * Math.pow(1 - f, 0.85) + 0.35;
    const cards = t < 5 ? 6 : 4;
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI * 2 + t * 0.9;
      const ca = Math.cos(a), sa = Math.sin(a), w = r * 0.62;
      const px = -sa * w / 2, pz = ca * w / 2;
      const inY = y + 0.55, outY = y - r * 0.32;
      const ix = ca * 0.12, iz = sa * 0.12, ox = ca * r, oz = sa * r;
      const n = [ca * 0.45, 0.85, sa * 0.45];
      quad([ix - px * 0.4, inY, iz - pz * 0.4], [ix + px * 0.4, inY, iz + pz * 0.4], [ox + px, outY, oz + pz], [ox - px, outY, oz - pz], n);
    }
  }
  // Spitze: zwei gekreuzte senkrechte Karten
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2, ca = Math.cos(a) * 0.6, sa = Math.sin(a) * 0.6;
    quad([-ca, H - 1.8, -sa], [ca, H - 1.8, sa], [ca * 0.1, H + 0.3, sa * 0.1], [-ca * 0.1, H + 0.3, -sa * 0.1], [sa, 0.5, -ca]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.computeBoundingSphere();
  return g;
}

/** Grasbüschel aus 7 schmalen Halmen (Vertexfarbe: dunkler Fuß → helle Spitze), ohne Textur/Alpha-Test.
 * blades > 0 (env-look, medium+): dichter Horst aus gebogenen Halmen mit Knick (3 Dreiecke je Halm), Farbe je Halm
 * leicht verschieden (grün/strohig), Normalen zwischen Halmfläche und oben (weiches, aber plastisches Licht). */
function grassGeometry(blades = 0) {
  if (blades > 0) return grassClumpGeometry(blades);
  const P = [], C = [], N = [], r = rng(5);
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.22, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 0.32 + r() * 0.34, w = 0.035 + r() * 0.02, lean = (r() - 0.5) * 0.35, ang = r() * Math.PI;
    const cx = Math.cos(ang) * w, cz = Math.sin(ang) * w, lx = Math.cos(a) * lean * h, lz = Math.sin(a) * lean * h;
    P.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + lx, h, z + lz);
    C.push(0.42, 0.45, 0.32, 0.42, 0.45, 0.32, 1, 1, 0.92);
    N.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.computeBoundingSphere();
  return g;
}

function grassClumpGeometry(n) {
  const P = [], C = [], N = [], r = rng(11);
  const push = (v, c, nn) => { P.push(v[0], v[1], v[2]); C.push(c[0], c[1], c[2]); N.push(nn[0], nn[1], nn[2]); };
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 0.2, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 0.28 + r() * 0.42 * (1 - d * 1.5), w = 0.016 + r() * 0.014;
    const lean = 0.12 + r() * 0.32, la = a + (r() - 0.5) * 1.2; // nach außen gebogen
    const ang = la + Math.PI / 2, cx = Math.cos(ang) * w, cz = Math.sin(ang) * w;
    const ox = Math.cos(la), oz = Math.sin(la);
    const mh = h * (0.5 + r() * 0.1), ml = lean * 0.3 * h, tl = lean * h;
    const bL = [x - cx, 0, z - cz], bR = [x + cx, 0, z + cz];
    const mL = [x - cx * 0.75 + ox * ml, mh, z - cz * 0.75 + oz * ml], mR = [x + cx * 0.75 + ox * ml, mh, z + cz * 0.75 + oz * ml];
    const tip = [x + ox * tl, h * (1 - lean * 0.25), z + oz * tl];
    // Farbe je Halm: grün ↔ strohig, Fuß dunkel (Selbstschatten im Horst)
    const dry = r() < 0.22 ? 0.5 + r() * 0.5 : r() * 0.15, br = 0.85 + r() * 0.3;
    const mix3 = (g, y) => [g[0] + (y[0] - g[0]) * dry, g[1] + (y[1] - g[1]) * dry, g[2] + (y[2] - g[2]) * dry].map(v => v * br);
    const cB = mix3([0.3, 0.36, 0.24], [0.42, 0.4, 0.28]), cM = mix3([0.68, 0.76, 0.52], [0.9, 0.82, 0.56]), cT = mix3([1, 1, 0.82], [1.1, 0.98, 0.7]);
    const fn = [-oz * 0.45, 0.85, ox * 0.45]; // zur Biegung geneigte Normale
    const nl = Math.hypot(fn[0], fn[1], fn[2]); fn[0] /= nl; fn[1] /= nl; fn[2] /= nl;
    const nT = [ox * 0.3, 0.95, oz * 0.3];
    push(bL, cB, fn); push(bR, cB, fn); push(mR, cM, fn);
    push(bL, cB, fn); push(mR, cM, fn); push(mL, cM, fn);
    push(mL, cM, fn); push(mR, cM, fn); push(tip, cT, nT);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.computeBoundingSphere();
  return g;
}

/** Material der Grashalme: Vertexfarbe × Instanzfarbe, beidseitig, Wind wie das Laub (foliageUniforms). */
function grassMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.name = 'vegetation-gras'; m.userData.disposable = true; m.userData.surface = 'grass';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = foliageUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sw = max(0.0, position.y) * 0.22;
      transformed.x += sin(uTime * 1.9 + ip.x * 0.35 + ip.z * 0.21) * sw;
      transformed.z += cos(uTime * 1.5 + ip.z * 0.33) * sw * 0.6;`);
  };
  m.customProgramCacheKey = () => 'np-gras-v1';
  return m;
}

function merge(geoms) {
  const parts = geoms.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.computeBoundingSphere();
  for (const g of [...geoms, ...parts]) g.dispose();
  return out;
}

/** Ferne Fichte: Kegel + Stammstumpf. */
function farSpruce() {
  const cone = new THREE.ConeGeometry(2.6, 9.4, 7, 1, true); cone.translate(0, 1.5 + 4.7, 0);
  const trunk = new THREE.CylinderGeometry(0.2, 0.25, 1.6, 4, 1, true); trunk.translate(0, 0.8, 0);
  return merge([cone, trunk]);
}
/** Ferner Laubbaum: abgeflachter Ikosaeder + Stamm. */
function farBroadleaf() {
  const crown = new THREE.IcosahedronGeometry(2.9, 0); crown.scale(1, 0.82, 1); crown.translate(0, 5.0, 0);
  const trunk = new THREE.CylinderGeometry(0.2, 0.28, 3.2, 4, 1, true); trunk.translate(0, 1.6, 0);
  return merge([crown, trunk]);
}
/** Fels: verformter Ikosaeder. */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, r = rng(seed);
  const offs = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offs.has(key)) offs.set(key, 0.75 + r() * 0.45);
    const k = offs.get(key);
    p.setXYZ(i, p.getX(i) * k * 1.15, Math.max(-0.35, p.getY(i) * k * 0.62), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * @param {object} o { hf, spec (def.vegetation), quality, tier (TIERS-Eintrag), blocked(x, z) → bool, bounds (Spielfläche) }
 */
export class Vegetation {
  constructor(o) {
    this.hf = o.hf; this.spec = o.spec || {}; this.quality = o.quality; this.tier = o.tier;
    this.blocked = o.blocked || (() => false);
    this.bounds = o.bounds;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.species = {};
    this.rocks = [];
    this.stats = { trees: 0, bushes: 0, rocks: 0, reeds: 0, grass: 0, near: 0, far: 0 };
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this._lastGrass = new THREE.Vector3(1e9, 0, 1e9);
    this._place();
  }

  _add(kind, x, z, s, ry) {
    const sp = this.species[kind] || (this.species[kind] = { list: [] });
    sp.list.push(x, this.hf.heightAt(x, z) - 0.05, z, s, ry);
  }

  /** Deterministische Verteilung (Wälder, Randwald, Einzelbäume, Hecken, Büsche, Schilf, Felsen). */
  _place() {
    const hf = this.hf, spec = this.spec, dens = this.tier.density ?? 1;
    const r = rng(spec.seed || 99), noise = createSimplex((spec.seed || 99) + 5);
    const n3 = { x: 0, y: 1, z: 0 };
    const okTree = (x, z) => {
      if (!hf.contains(x, z) || this.blocked(x, z)) return false;
      const y = hf.heightAt(x, z);
      if (y < hf.waterY + 0.5) return false;
      return hf.normalAt(x, z, n3).y > 0.8;
    };
    const tree = (x, z, spruceShare) => {
      if (!okTree(x, z)) return;
      const kind = r() < spruceShare ? 'fichte' : 'laub';
      this._add(kind, x, z, (kind === 'fichte' ? 0.75 : 0.85) + r() * 0.55, r() * Math.PI * 2);
    };
    // Wälder (Kreise mit verrauschtem Rand)
    for (const f of spec.forests || []) {
      const step = f.step ?? 5.2;
      for (let z = f.z - f.r; z <= f.z + f.r; z += step) for (let x = f.x - f.r; x <= f.x + f.r; x += step) {
        const jx = x + (r() - 0.5) * step * 0.9, jz = z + (r() - 0.5) * step * 0.9;
        const d = Math.hypot(jx - f.x, jz - f.z) / f.r + noise(jx / 30, jz / 30) * 0.22;
        if (d > 1) continue;
        const p = (f.density ?? 0.7) * dens * (1 - smoothstep(0.75, 1, d) * 0.6);
        if (r() > p) { if (d > 0.7 && r() < 0.35 * dens) this._add('busch', jx, jz, 0.8 + r() * 0.6, r() * 6.28); continue; }
        tree(jx, jz, f.spruce ?? 0.6);
      }
    }
    // Randwald hinter der Spielfläche (Rahmen, verdeckt den Horizont)
    const ring = spec.ring;
    if (ring) {
      const b = this.bounds, step = ring.step ?? 6.5;
      for (let z = hf.minZ + 4; z < hf.maxZ - 4; z += step) for (let x = hf.minX + 4; x < hf.maxX - 4; x += step) {
        const out = Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
        if (out < (ring.inset ?? -6)) continue;
        const jx = x + (r() - 0.5) * step, jz = z + (r() - 0.5) * step;
        const p = (ring.density ?? 0.6) * dens * (0.55 + 0.45 * smoothstep(-0.3, 0.4, noise(jx / 55, jz / 55)));
        if (r() < p) tree(jx, jz, ring.spruce ?? 0.75);
      }
    }
    // Einzelbäume auf Wiesen
    const sc = spec.scatter;
    if (sc) {
      const b = this.bounds;
      const count = Math.round((sc.count ?? 120) * dens);
      for (let k = 0; k < count * 3 && (this.species.laub?.list.length || 0) / 5 < 1e5; k++) {
        const x = b.minX + r() * (b.maxX - b.minX), z = b.minZ + r() * (b.maxZ - b.minZ);
        if (noise(x / 70, z / 70) < 0.1) continue;
        if (r() < 0.34) tree(x, z, 0.25);
      }
    }
    // Hecken/Baumreihen entlang Linien
    for (const h of spec.hedges || []) {
      const pts = h.pts;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d < L; d += h.step ?? 3) {
          const t = d / L, x = ax + (bx - ax) * t + (r() - 0.5) * 1.2, z = az + (bz - az) * t + (r() - 0.5) * 1.2;
          if (!okTree(x, z)) continue;
          if (h.trees && r() < h.trees) this._add(r() < 0.3 ? 'fichte' : 'laub', x, z, 0.75 + r() * 0.4, r() * 6.28);
          else this._add('busch', x, z, 0.9 + r() * 0.7, r() * 6.28);
        }
      }
    }
    // Schilf am Ufer
    if (spec.reeds && hf.riverLine) {
      const line = hf.riverLine;
      for (let k = 0; k < line.length - 1; k++) {
        const [ax, az] = line[k], [bx, bz] = line[k + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
        for (let m = 0; m < 3 * dens; m++) {
          const t = r(), side = r() < 0.5 ? -1 : 1, off = (spec.reeds.offset ?? 8.5) + (r() - 0.5) * 4;
          const x = ax + (bx - ax) * t + nx * off * side, z = az + (bz - az) * t + nz * off * side;
          if (!hf.contains(x, z) || this.blocked(x, z)) continue;
          const y = hf.heightAt(x, z);
          if (y < hf.waterY - 0.25 || y > hf.waterY + 0.9) continue;
          this._add('schilf', x, z, 0.8 + r() * 0.6, r() * 6.28);
        }
      }
    }
    // Felsen (steile Hänge, Kuppen) – Kollision + Deckung
    const rk = spec.rocks;
    if (rk) {
      const b = this.bounds;
      for (let k = 0, made = 0; k < (rk.count ?? 100) * 12 && made < (rk.count ?? 100); k++) {
        const x = b.minX - 30 + r() * (b.maxX - b.minX + 60), z = b.minZ - 30 + r() * (b.maxZ - b.minZ + 60);
        if (!hf.contains(x, z) || this.blocked(x, z)) continue;
        const ny = hf.normalAt(x, z, n3).y;
        if (ny > 0.95 && r() > 0.12) continue;
        if (hf.heightAt(x, z) < hf.waterY + 0.3) continue;
        this.rocks.push({ x, y: hf.heightAt(x, z) - 0.25, z, s: 0.6 + r() * r() * 2.2, ry: r() * 6.28, v: k % 3 });
        made++;
      }
      for (const p of rk.extra || []) this.rocks.push({ x: p[0], y: hf.heightAt(p[0], p[1]) - 0.3, z: p[1], s: p[2] ?? 1.5, ry: r() * 6.28, v: 0 });
    }
    // Matrizen vorberechnen
    for (const [kind, sp] of Object.entries(this.species)) {
      const L = sp.list, n = L.length / 5;
      sp.count = n;
      sp.mats = new Float32Array(n * 16);
      sp.cols = new Float32Array(n * 3);
      const tints = TINTS[kind];
      for (let i = 0; i < n; i++) {
        _q.setFromAxisAngle(_up, L[i * 5 + 4]); _s.setScalar(L[i * 5 + 3]); _p.set(L[i * 5], L[i * 5 + 1], L[i * 5 + 2]);
        _m.compose(_p, _q, _s); _m.toArray(sp.mats, i * 16);
        _c.set(tints[(hash2(i, n, 3) * tints.length) | 0]).multiplyScalar(0.92 + hash2(i, 7) * 0.16).toArray(sp.cols, i * 3);
      }
    }
    this.stats.trees = (this.species.fichte?.count || 0) + (this.species.laub?.count || 0);
    this.stats.bushes = this.species.busch?.count || 0;
    this.stats.reeds = this.species.schilf?.count || 0;
    this.stats.rocks = this.rocks.length;
  }

  /**
   * Kollisions-/Kugel-Dreiecke: Stämme (Sechskant-Prismen) innerhalb der Spielfläche + 30 m und alle Felsen.
   * → { col: Float32Array, bullet: Float32Array }
   */
  colliders() {
    const out = [];
    const b = this.bounds;
    const prism = (x, y, z, r, h) => {
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
        out.push(x0, y, z0, x1, y, z1, x1, y + h, z1, x0, y, z0, x1, y + h, z1, x0, y + h, z0);
      }
    };
    for (const kind of ['fichte', 'laub']) {
      const sp = this.species[kind];
      if (!sp) continue;
      for (let i = 0; i < sp.count; i++) {
        const x = sp.list[i * 5], y = sp.list[i * 5 + 1], z = sp.list[i * 5 + 2], s = sp.list[i * 5 + 3];
        if (x < b.minX - 30 || x > b.maxX + 30 || z < b.minZ - 30 || z > b.maxZ + 30) continue;
        prism(x, y - 0.3, z, (kind === 'fichte' ? 0.2 : 0.24) * s, 3.4 * s);
      }
    }
    for (const rk of this.rocks) {
      const g = this._rockGeoms ? this._rockGeoms[rk.v] : (this._rockGeoms = [rockGeometry(11), rockGeometry(23), rockGeometry(37)])[rk.v];
      const p = g.index ? g.toNonIndexed().attributes.position : g.attributes.position;
      _q.setFromAxisAngle(_up, rk.ry); _s.setScalar(rk.s); _p.set(rk.x, rk.y, rk.z); _m.compose(_p, _q, _s);
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(_m); out.push(v.x, v.y, v.z); }
    }
    const arr = new Float32Array(out);
    return { col: arr, bullet: arr };
  }

  /** Meshes anlegen (Laub-Material aus atlas.js, Stämme/Felsen aus engine/textures.js). */
  build(getMaterial) {
    const q = this.quality, t = this.tier;
    const proto = (kind) => createFoliage([{ kind, x: 0, y: 0, z: 0, s: 1, ry: 0 }], q).meshes[0];
    const make = (geom, mat, n, name, cast) => {
      const m = new THREE.InstancedMesh(geom, mat, Math.max(1, n));
      m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const tp = proto('tree'), bp = proto('bush'), rp = proto('reeds'), gp = proto('grass');
    this._protos = [tp, bp, rp, gp];
    const foliageMat = tp.material, foliageMatN = gp.material;
    const farMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    farMat.name = 'vegetation-far'; farMat.userData.disposable = true; farMat.userData.surface = 'wood';
    farMat.color.setRGB(0.46, 0.5, 0.44); // Instanzfarben sind für das Laub-Atlas gedacht → einfarbige Ferne dunkler
    const bark = getMaterial('bark');
    this._own = [farMat];
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3.4, 7, 1, true); trunkGeo.translate(0, 1.7, 0);
    const spruceGeo = spruceGeometry();
    this._geoms = [trunkGeo, spruceGeo];
    const sp = this.species;
    const nearCap = (kind) => Math.min(sp[kind]?.count || 0, kind === 'busch' ? 3000 : 2400);
    if (sp.fichte) {
      sp.fichte.near = make(spruceGeo, foliageMat, nearCap('fichte'), 'veg-fichte', t.treeShadow);
      const fg = farSpruce(); this._geoms.push(fg);
      sp.fichte.far = make(fg, farMat, sp.fichte.count, 'veg-fichte-fern', false);
    }
    if (sp.laub) {
      sp.laub.near = make(tp.geometry, foliageMat, nearCap('laub'), 'veg-laub', t.treeShadow);
      const fg = farBroadleaf(); this._geoms.push(fg);
      sp.laub.far = make(fg, farMat, sp.laub.count, 'veg-laub-fern', false);
    }
    const trunkCap = nearCap('fichte') + nearCap('laub');
    this.trunks = trunkCap ? make(trunkGeo, bark, trunkCap, 'veg-staemme', t.treeShadow) : null;
    if (sp.busch) sp.busch.near = make(bp.geometry, foliageMat, nearCap('busch'), 'veg-busch', false);
    if (sp.schilf) sp.schilf.near = make(rp.geometry, foliageMatN, sp.schilf.count, 'veg-schilf', false);
    // Felsen: statisch, ein InstancedMesh je Variante
    if (this.rocks.length) {
      const rockMat = getMaterial('concrete_dark');
      this._rockGeoms = this._rockGeoms || [rockGeometry(11), rockGeometry(23), rockGeometry(37)];
      for (let v = 0; v < 3; v++) {
        const list = this.rocks.filter(r => r.v === v);
        if (!list.length) continue;
        const m = new THREE.InstancedMesh(this._rockGeoms[v], rockMat, list.length);
        list.forEach((rk, i) => {
          _q.setFromAxisAngle(_up, rk.ry); _s.setScalar(rk.s); _p.set(rk.x, rk.y, rk.z); _m.compose(_p, _q, _s); m.setMatrixAt(i, _m);
          m.setColorAt(i, _c.set('#a39a8c').multiplyScalar(0.8 + hash2(i, v) * 0.3));
        });
        m.name = 'veg-felsen'; m.castShadow = q !== 'low'; m.receiveShadow = true;
        m.computeBoundingSphere();
        this.group.add(m);
      }
    }
    // Grasring (eigene Halme statt Laub-Atlas: liest sich auf Wiesen besser und braucht keinen Alpha-Test)
    if (t.grass > 0) {
      const gg = grassGeometry(t.grassBlades || 0), gm = grassMaterial();
      this._geoms.push(gg); this._own.push(gm);
      this.grass = make(gg, gm, t.grassCap, 'veg-gras', false);
    }
    return this.group;
  }

  /** Nah/Fern-Zuordnung neu schreiben, wenn sich die Kamera ≥ 4 m bewegt hat; Grasring ab 1,5 m. */
  update(camera, force = false) {
    const p = camera.position, t = this.tier;
    if (force || this._last.distanceToSquared(p) > 16) {
      this._last.copy(p);
      const near2 = t.treeNear * t.treeNear, far2 = t.treeFar * t.treeFar, bush2 = (t.treeNear * 0.6) ** 2, reed2 = (t.treeNear * 0.5) ** 2;
      let trunkN = 0, nearAll = 0, farAll = 0;
      for (const [kind, sp] of Object.entries(this.species)) {
        if (!sp.near && !sp.far) continue;
        let nn = 0, nf = 0;
        const L = sp.list, nearCap = sp.near ? sp.near.instanceMatrix.count : 0;
        const lim2 = kind === 'busch' ? bush2 : kind === 'schilf' ? reed2 : near2;
        for (let i = 0; i < sp.count; i++) {
          const dx = L[i * 5] - p.x, dz = L[i * 5 + 2] - p.z, d2 = dx * dx + dz * dz;
          if (d2 < lim2 && nn < nearCap) {
            sp.near.instanceMatrix.array.set(sp.mats.subarray(i * 16, i * 16 + 16), nn * 16);
            sp.near.instanceColor.array.set(sp.cols.subarray(i * 3, i * 3 + 3), nn * 3);
            nn++;
            if (this.trunks && (kind === 'fichte' || kind === 'laub') && trunkN < this.trunks.instanceMatrix.count) {
              this.trunks.instanceMatrix.array.set(sp.mats.subarray(i * 16, i * 16 + 16), trunkN * 16);
              this.trunks.instanceColor.array.set(TRUNK_COL[kind], trunkN * 3);
              trunkN++;
            }
          } else if (sp.far && d2 < far2) {
            sp.far.instanceMatrix.array.set(sp.mats.subarray(i * 16, i * 16 + 16), nf * 16);
            sp.far.instanceColor.array.set(sp.cols.subarray(i * 3, i * 3 + 3), nf * 3);
            nf++;
          }
        }
        for (const [mesh, c] of [[sp.near, nn], [sp.far, nf]]) {
          if (!mesh) continue;
          mesh.count = c; mesh.visible = c > 0;
          if (c) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, c * 16); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, c * 3); mesh.instanceColor.needsUpdate = true; }
        }
        nearAll += nn; farAll += nf;
      }
      if (this.trunks) {
        const tm = this.trunks; tm.count = trunkN; tm.visible = trunkN > 0;
        if (trunkN) { tm.instanceMatrix.clearUpdateRanges(); tm.instanceMatrix.addUpdateRange(0, trunkN * 16); tm.instanceMatrix.needsUpdate = true; tm.instanceColor.clearUpdateRanges(); tm.instanceColor.addUpdateRange(0, trunkN * 3); tm.instanceColor.needsUpdate = true; }
      }
      this.stats.near = nearAll; this.stats.far = farAll;
    }
    if (this.grass && (force || this._lastGrass.distanceToSquared(p) > 2.25)) {
      this._lastGrass.copy(p);
      this._updateGrass(p);
    }
  }

  _updateGrass(p) {
    const hf = this.hf, t = this.tier, R = t.grass, st = t.grassStep, g = this.grass, cap = g.instanceMatrix.count;
    const y0 = hf.heightAt(p.x, p.z);
    if (p.y - y0 > R * 1.5) { g.count = 0; g.visible = false; this.stats.grass = 0; return; }
    const i0 = Math.floor((p.x - R) / st), i1 = Math.floor((p.x + R) / st), j0 = Math.floor((p.z - R) / st), j1 = Math.floor((p.z + R) / st);
    const L = [0, 0, 0, 0, 0];
    let k = 0;
    const arr = g.instanceMatrix.array, col = g.instanceColor.array;
    for (let j = j0; j <= j1 && k < cap; j++) for (let i = i0; i <= i1 && k < cap; i++) {
      const x = (i + hash2(i, j, 1)) * st, z = (j + hash2(i, j, 2)) * st;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > R) continue;
      if (!hf.contains(x, z) || this.blocked(x, z)) continue;
      hf.layersAt(x, z, L);
      if (L[0] < 0.55 || hf.maskAt(x, z)) continue;
      const y = hf.heightAt(x, z);
      if (y < hf.waterY + 0.1) continue;
      const s = (0.75 + 0.6 * hash2(i, j, 3)) * smoothstep(R, R * 0.72, d) * (0.6 + L[0] * 0.5);
      if (s < 0.08) continue;
      _q.setFromAxisAngle(_up, hash2(i, j, 4) * 6.283); _s.set(s, s * (0.8 + hash2(i, j, 5) * 0.5), s); _p.set(x, y - 0.03, z);
      _m.compose(_p, _q, _s); _m.toArray(arr, k * 16);
      _c.set(GRASS_TINT[(hash2(i, j, 6) * GRASS_TINT.length) | 0]).toArray(col, k * 3);
      k++;
      // env-look (high+): nah an der Kamera dichter (3 weitere Horste je Zelle, versetzt und kleiner)
      if (t.grassNear && d < t.grassNear) {
        for (let e = 0; e < 3 && k < cap; e++) {
          const ex = (i + (hash2(i, j, 11 + e) + (e === 0 ? 0.5 : 0)) % 1) * st, ez = (j + (hash2(i, j, 21 + e) + (e === 1 ? 0.5 : 0)) % 1) * st;
          if (this.blocked(ex, ez) || hf.maskAt(ex, ez)) continue;
          const es = s * (0.55 + 0.4 * hash2(i, j, 31 + e)) * smoothstep(t.grassNear, t.grassNear * 0.7, d);
          if (es < 0.08) continue;
          _q.setFromAxisAngle(_up, hash2(i, j, 41 + e) * 6.283); _s.set(es, es * (0.8 + hash2(i, j, 51 + e) * 0.6), es); _p.set(ex, hf.heightAt(ex, ez) - 0.03, ez);
          _m.compose(_p, _q, _s); _m.toArray(arr, k * 16);
          _c.set(GRASS_TINT[(hash2(i, j, 61 + e) * GRASS_TINT.length) | 0]).toArray(col, k * 3);
          k++;
        }
      }
    }
    g.count = k; g.visible = k > 0;
    if (k) { g.instanceMatrix.clearUpdateRanges(); g.instanceMatrix.addUpdateRange(0, k * 16); g.instanceMatrix.needsUpdate = true; g.instanceColor.clearUpdateRanges(); g.instanceColor.addUpdateRange(0, k * 3); g.instanceColor.needsUpdate = true; }
    this.stats.grass = k;
  }

  dispose() {
    for (const g of this._geoms || []) g.dispose();
    for (const g of this._rockGeoms || []) g.dispose();
    for (const m of this._own || []) m.dispose();
    for (const p of this._protos || []) p.geometry.dispose();
    this.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
}

const TINTS = {
  fichte: ['#56705a', '#4d6a55', '#5e7a5c', '#4a6350'],
  laub: ['#8ea866', '#7f9c5c', '#a0b070', '#93a35e'],
  busch: ['#87a06a', '#9fb27a', '#7c955f'],
  schilf: ['#c2bc88', '#aab07a', '#b8b880'],
};
const GRASS_TINT = ['#8fa25a', '#9aab62', '#a7b26c', '#86994f', '#b3b878'];
const TRUNK_COL = { fichte: new Float32Array([0.62, 0.55, 0.5]), laub: new Float32Array([0.85, 0.8, 0.72]) };
