// NULLPUNKT — Bodenstreu in 3D (21.10., Brandwald; eigene Geometrie) (Owner: world).
// Ring um die Kamera (wie der Grasring): verkohlte Zweige, Äste mit Seitenzweigen, graue Stöcke, gewölbte
// Rindenstücke, Holzkohlebrocken und Steine. Jede 2-m-Zelle erzeugt ihren Inhalt deterministisch aus ihrer Lage –
// beim Gehen bleibt alles an seinem Platz. Nur Optik (keine Kollision, kein Netz). Dichten je m² aus der Karte
// (def.litter), Reichweite und Schatten je Qualitätsstufe.
import * as THREE from 'three';
import { rng, createSimplex } from './noise.js';

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** Reichweite (m) und Schatten je Stufe. */
const RANGE = { low: 9, medium: 16, high: 24, ultra: 32 };
const CELL = 2;

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------
class Mesh {
  constructor() { this.P = []; this.U = []; this.I = []; }
  v(x, y, z, u, w) { this.P.push(x, y, z); this.U.push(u, w); return this.P.length / 3 - 1; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setIndex(this.I);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Gekrümmtes, verjüngtes Rohr entlang einer Punktfolge pts [[x,y,z]…], Radien r0→r1, `sides` Seiten. */
function tube(M, pts, r0, r1, sides) {
  const rings = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
    const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
    const h = Math.abs(d.y) < 0.9 ? _up : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(d, h).normalize(), e2 = new THREE.Vector3().crossVectors(e1, d).normalize();
    if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    const t = i / (pts.length - 1), r = r0 + (r1 - r0) * t, ring = [];
    for (let j = 0; j <= sides; j++) {
      const ph = (j / sides) * TAU, ca = Math.cos(ph), sa = Math.sin(ph);
      ring.push(M.v(pts[i][0] + (e1.x * ca + e2.x * sa) * r, pts[i][1] + (e1.y * ca + e2.y * sa) * r, pts[i][2] + (e1.z * ca + e2.z * sa) * r, j / sides * 0.2, len));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = rings[i][j], b = rings[i + 1][j], c = rings[i + 1][j + 1], d = rings[i][j + 1];
    M.I.push(a, b, c, a, c, d);
  }
  // Enden: Spitze bzw. flacher Deckel (Bruch)
  const last = pts[pts.length - 1], tip = M.v(last[0], last[1], last[2], 0.1, len);
  for (let j = 0; j < sides; j++) M.I.push(rings[rings.length - 1][j], tip, rings[rings.length - 1][j + 1]);
  const first = pts[0], cap = M.v(first[0], first[1], first[2], 0.1, 0);
  for (let j = 0; j < sides; j++) M.I.push(rings[0][j + 1], cap, rings[0][j]);
}

/** Gebogener Pfad entlang +x (Länge L), liegt auf dem Boden (y ≈ Radius), leichte Wellen. */
function path(r, L, n, rad, wob = 0.08) {
  const pts = [], ph = r() * TAU, ph2 = r() * TAU;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = (t - 0.5) * L;
    pts.push([x, rad + Math.max(0, Math.sin(t * 3 + ph2)) * rad * 0.8, Math.sin(t * 2.4 + ph) * L * wob]);
  }
  return pts;
}

/** Zweig (Länge 1): dünn, gekrümmt, 1–2 Seitenzweige. */
function twigGeometry(seed, detail) {
  const r = rng(seed), M = new Mesh(), sides = detail ? 4 : 3;
  const main = path(r, 1, detail ? 4 : 2, 0.018, 0.1);
  tube(M, main, 0.02, 0.008, sides);
  const ns = 1 + (r() < 0.5 ? 1 : 0);
  for (let k = 0; k < ns; k++) {
    const i = 1 + Math.floor(r() * (main.length - 2)), [x, y, z] = main[i], s = r() < 0.5 ? 1 : -1, l = 0.18 + r() * 0.3;
    tube(M, [[x, y, z], [x + l * 0.5, y + 0.01, z + s * l * 0.45], [x + l * 0.85, y + 0.005, z + s * l * 0.8]], 0.009, 0.004, 3);
  }
  return M.build();
}

/** Ast (Länge 1): kräftiger, Bruchende, mehrere Seitenzweige und Stümpfe; liegt mit einem Ende leicht erhöht. */
function branchGeometry(seed, detail) {
  const r = rng(seed), M = new Mesh(), sides = detail ? 6 : 4;
  const main = path(r, 1, detail ? 6 : 3, 0.04, 0.06).map(([x, y, z], i, a) => [x, y + (i / (a.length - 1)) * 0.06, z]);
  tube(M, main, 0.04, 0.016, sides);
  const ns = detail ? 3 + Math.floor(r() * 3) : 2;
  for (let k = 0; k < ns; k++) {
    const i = 1 + Math.floor(r() * (main.length - 2)), [x, y, z] = main[i], s = r() < 0.5 ? 1 : -1, l = 0.12 + r() * 0.35;
    const up = r() < 0.4 ? 0.12 + r() * 0.15 : 0.01;
    tube(M, [[x, y, z], [x + l * 0.4, y + up * 0.6, z + s * l * 0.5], [x + l * 0.7, y + up, z + s * l * 0.85]], 0.016, 0.005, detail ? 4 : 3);
  }
  return M.build();
}

/** Gewölbtes Rindenstück (1 × 0,6), Wölbung nach oben, beidseitig. */
function barkGeometry(seed) {
  const r = rng(seed), M = new Mesh(), nx = 4, nz = 3, bend = 0.12 + r() * 0.1;
  const ids = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx - 0.5, w = j / nz - 0.5;
    const edge = 1 - (Math.abs(u) > 0.4 ? (Math.abs(u) - 0.4) * 2 : 0) * r();
    ids.push(M.v(u * edge, 0.02 + (0.25 - w * w) * bend * 2 + (r() - 0.5) * 0.015, w * 0.6, u, w));
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1;
    M.I.push(a, d, c, a, c, b, a, c, d, a, b, c);
  }
  return M.build();
}

/** Brocken (Stein/Holzkohle): verbeultes Ikosaeder, unten abgeflacht. */
function lumpGeometry(seed, flat, detail) {
  const r = rng(seed), noise = createSimplex(seed);
  const g = new THREE.IcosahedronGeometry(0.5, detail ? 1 : 0);
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + noise(v.x * 2.1 + seed, v.z * 2.1 + v.y) * 0.28;
    v.multiplyScalar(k);
    v.y = v.y < 0 ? v.y * 0.3 : v.y * flat;
    v.x *= 1 + r() * 0.04;
    pos.setXYZ(i, v.x, v.y + 0.15 * flat, v.z);
  }
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  out.computeBoundingSphere();
  g.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// Streu
// ---------------------------------------------------------------------------
/** Arten: Dichte-Schlüssel, Größenbereich, Material, Farbe, Schatten. */
const KINDS = [
  { key: 'twigs', geo: (s, d) => twigGeometry(s, d), size: [0.25, 0.9], mat: 'borke_verkohlt', col: ['#3b3733', '#4a4540', '#2a2724'], flat: true },
  { key: 'sticks', geo: (s, d) => twigGeometry(s + 50, d), size: [0.3, 1.0], mat: 'totholz', col: ['#8b857c', '#76716a', '#9a948a'], flat: true },
  { key: 'branches', geo: (s, d) => branchGeometry(s, d), size: [0.9, 2.4], mat: 'borke_verkohlt', col: ['#36322e', '#45403a'], flat: true, shadow: true },
  { key: 'bark', geo: (s) => barkGeometry(s), size: [0.12, 0.32], mat: 'borke_verkohlt', col: ['#2e2b28', '#3d3934'], flat: true },
  { key: 'coals', geo: (s, d) => lumpGeometry(s, 0.7, d), size: [0.05, 0.14], mat: 'borke_verkohlt', col: ['#1d1b1a', '#262321'], flat: false },
  { key: 'stones', geo: (s, d) => lumpGeometry(s + 9, 0.55, d), size: [0.05, 0.24], mat: 'concrete_dark', col: ['#7d776e', '#6a655d', '#8a8378'], flat: false, shadow: true },
];

export class Litter {
  /**
   * o: { hf, spec { seed, twigs, sticks, branches, bark, coals, stones (je m²) }, quality, blocked(x, z) }
   */
  constructor(o) {
    this.hf = o.hf; this.spec = o.spec || {}; this.quality = o.quality || 'high';
    this.blocked = o.blocked || (() => false);
    this.R = RANGE[this.quality] ?? 24;
    this.group = new THREE.Group();
    this.group.name = 'bodenstreu';
    this.noise = createSimplex((this.spec.seed || 5) + 3);
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this.stats = { items: 0 };
  }

  build(getMaterial) {
    const q = this.quality, detail = q !== 'low', shadowOk = q === 'high' || q === 'ultra';
    const area = Math.PI * this.R * this.R;
    this.kinds = KINDS.filter((k) => (this.spec[k.key] || 0) > 0).map((k, ki) => {
      const cap = Math.ceil(area * this.spec[k.key] * 1.35 + 16);
      const vars = [0, 1, 2].map((v) => {
        const g = k.geo(1000 + ki * 97 + v * 13, detail);
        const m = new THREE.InstancedMesh(g, getMaterial(k.mat), Math.ceil(cap / 3) + 8);
        m.name = 'streu-' + k.key; m.count = 0; m.frustumCulled = false;
        m.castShadow = !!(k.shadow && shadowOk); m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
        return m;
      });
      return { ...k, vars, cols: k.col.map((c) => new THREE.Color(c)) };
    });
    return this.group;
  }

  update(camera, force = false) {
    const p = camera.position;
    if (!force && this._last.distanceToSquared(p) < 2.25) return;
    this._last.copy(p);
    const hf = this.hf, R = this.R, R2 = R * R, sp = this.spec, seed = sp.seed || 5;
    const cnt = this.kinds.map((k) => k.vars.map(() => 0));
    const c0x = Math.floor((p.x - R) / CELL), c1x = Math.floor((p.x + R) / CELL), c0z = Math.floor((p.z - R) / CELL), c1z = Math.floor((p.z + R) / CELL);
    let items = 0;
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const mx = (cx + 0.5) * CELL - p.x, mz = (cz + 0.5) * CELL - p.z;
      if (mx * mx + mz * mz > (R + CELL) * (R + CELL)) continue;
      // Zellen-Zufall (deterministisch) und großräumige Häufung (mal dicht, mal fast leer)
      const r = rng(((cx * 73856093) ^ (cz * 19349663) ^ (seed * 83492791)) >>> 0);
      const clump = 0.35 + 1.3 * Math.max(0, this.noise(cx * CELL / 23, cz * CELL / 23) * 0.5 + 0.5);
      this.kinds.forEach((k, ki) => {
        const lam = sp[k.key] * CELL * CELL * clump;
        let n = Math.floor(lam); if (r() < lam - n) n++;
        for (let i = 0; i < n; i++) {
          const x = (cx + r()) * CELL, z = (cz + r()) * CELL, v = Math.floor(r() * 3), s = k.size[0] + Math.pow(r(), 1.6) * (k.size[1] - k.size[0]);
          const yaw = r() * TAU, ci = Math.floor(r() * k.cols.length), tone = 0.82 + r() * 0.3;
          const dx = x - p.x, dz = z - p.z;
          if (dx * dx + dz * dz > R2 || !hf.contains(x, z) || this.blocked(x, z)) continue;
          const y = hf.heightAt(x, z);
          if (y < hf.waterY + 0.04) continue;
          const mesh = k.vars[v];
          const kk = cnt[ki][v];
          if (kk >= mesh.instanceMatrix.count) continue;
          // auf die Geländeneigung legen, um die Normale drehen
          hf.normalAt(x, z, _n);
          _q.setFromUnitVectors(_up, _n);
          _q2.setFromAxisAngle(_up, yaw);
          _q.multiply(_q2);
          _s.set(s, k.flat ? s : s * (0.8 + r() * 0.4), s);
          _p.set(x, y - (k.flat ? 0.006 : s * 0.12), z);
          _m.compose(_p, _q, _s).toArray(mesh.instanceMatrix.array, kk * 16);
          const c = k.cols[ci], a = mesh.instanceColor.array;
          a[kk * 3] = c.r * tone; a[kk * 3 + 1] = c.g * tone; a[kk * 3 + 2] = c.b * tone;
          cnt[ki][v] = kk + 1;
          items++;
        }
      });
    }
    this.kinds.forEach((k, ki) => k.vars.forEach((mesh, v) => {
      const c = cnt[ki][v];
      mesh.count = c; mesh.visible = c > 0;
      if (c) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, c * 16); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, c * 3); mesh.instanceColor.needsUpdate = true; }
    }));
    this.stats.items = items;
  }

  dispose() { this.group.traverse((o) => { if (o.isInstancedMesh) { o.geometry.dispose(); o.dispose(); } }); }
}
