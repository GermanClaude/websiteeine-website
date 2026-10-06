// Kontakt Hand ↔ Waffe (hands): Dreiecksgitter je beweglichem Waffenteil (Gehäuse, Magazin, Schlitten …) im
// Teilraum, einmal je Modell gebaut. Abfrage: nächstes Dreieck um einen Punkt (Weltraum) → vorzeichenbehafteter
// Abstand (innen negativ, über die Flächennormale wie das Prüfwerkzeug tools/out/hands2/probe.mjs) und die
// Richtung, in die der Punkt heraus muss. Arm.contact() (arms.js) nutzt das, um Handballen/Daumen/Finger je Bild
// aus der Waffe zu schieben und greifende Finger an die Oberfläche zu legen.
import * as THREE from 'three';

const CELL = 0.022;                 // m Gitterweite (Teilraum)
const OFF = 1 << 9, SPAN = 1 << 10;
const key = (x, y, z) => ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF);
const _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Vector3();

function visibleChain(o, stop) {
  for (let p = o; p && p !== stop; p = p.parent) if (!p.visible) return false;
  return true;
}

export class GunCollider {
  /** model: Waffenmodell (Group). Effekte (transparent/additiv) und Skinned Meshes zählen nicht. */
  constructor(model) {
    this.model = model;
    this.groups = [];
    model.updateMatrixWorld(true);
    const byObj = new Map();
    model.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return;
      const m = o.material;
      if (!m || m.transparent || m.blending === THREE.AdditiveBlending || m.visible === false) return;
      if (o.name && /flash|muzzle|smoke|haze|reticle|lens/i.test(o.name)) return;
      const parent = o.parent || model;
      if (!byObj.has(parent)) byObj.set(parent, []);
      byObj.get(parent).push(o);
    });
    for (const [obj, meshes] of byObj) {
      const tri = [];
      const relInv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      for (const mesh of meshes) {
        const rel = new THREE.Matrix4().multiplyMatrices(relInv, mesh.matrixWorld);
        const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
        const cnt = idx ? idx.count : pos.count;
        const V = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) { _p.fromBufferAttribute(pos, i).applyMatrix4(rel); V[i * 3] = _p.x; V[i * 3 + 1] = _p.y; V[i * 3 + 2] = _p.z; }
        for (let i = 0; i + 2 < cnt; i += 3) {
          const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
          tri.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2], V[c * 3], V[c * 3 + 1], V[c * 3 + 2]);
        }
      }
      const n = tri.length / 9;
      if (!n) continue;
      const T = new Float32Array(tri), N = new Float32Array(n * 3);
      const grid = new Map();
      const box = new THREE.Box3();
      for (let t = 0; t < n; t++) {
        const o = t * 9;
        const ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2];
        const vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-12) continue;            // entartet
        N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
        const x0 = Math.floor(Math.min(T[o], T[o + 3], T[o + 6]) / CELL), x1 = Math.floor(Math.max(T[o], T[o + 3], T[o + 6]) / CELL);
        const y0 = Math.floor(Math.min(T[o + 1], T[o + 4], T[o + 7]) / CELL), y1 = Math.floor(Math.max(T[o + 1], T[o + 4], T[o + 7]) / CELL);
        const z0 = Math.floor(Math.min(T[o + 2], T[o + 5], T[o + 8]) / CELL), z1 = Math.floor(Math.max(T[o + 2], T[o + 5], T[o + 8]) / CELL);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
          const k = key(x, y, z);
          let c = grid.get(k);
          if (!c) grid.set(k, (c = []));
          c.push(t);
        }
        for (let k = 0; k < 9; k += 3) box.expandByPoint(_p.set(T[o + k], T[o + k + 1], T[o + k + 2]));
      }
      this.groups.push({ obj, T, N, grid, box, inv: new THREE.Matrix4(), scale: 1, rot: new THREE.Quaternion(), on: true, stamp: new Uint32Array(n) });
    }
    this._stamp = 1;
    this.frame = -1;
  }

  /** Einmal je Bild nach updateMatrixWorld: Teil-Lagen und Sichtbarkeit übernehmen. */
  sync() {
    for (const g of this.groups) {
      g.on = visibleChain(g.obj, this.model.parent);
      if (!g.on) continue;
      g.obj.matrixWorld.decompose(_t, g.rot, _s);
      g.scale = _s.x || 1;
      g.inv.copy(g.obj.matrixWorld).invert();
    }
  }

  /**
   * Nächste Oberfläche um p (Weltraum) bis maxD. Ergebnis in out: d (vorzeichenbehaftet, m, innen < 0),
   * dir (Weltrichtung „heraus“), hit (bool). Rückgabe out.hit.
   */
  query(p, maxD, out) {
    out.hit = false; out.d = Infinity;
    let best = Infinity;
    for (const g of this.groups) {
      if (!g.on) continue;
      _p.copy(p).applyMatrix4(g.inv);
      const md = maxD / g.scale;
      if (g.box.distanceToPoint(_p) > Math.min(md, best)) continue;
      const stamp = ++this._stamp >= 0xffffffff ? (this._stamp = 1) : this._stamp;
      const r = Math.ceil(md / CELL);
      const cx = Math.floor(_p.x / CELL), cy = Math.floor(_p.y / CELL), cz = Math.floor(_p.z / CELL);
      const T = g.T, N = g.N, st = g.stamp;
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        const cell = g.grid.get(key(x, y, z));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const t = cell[i];
          if (st[t] === stamp) continue;
          st[t] = stamp;
          const d2 = closestOnTri(T, t * 9, _p.x, _p.y, _p.z);
          if (d2 < best * best && d2 <= md * md) {
            best = Math.sqrt(d2);
            out.hit = true; out.g = g;
            out.cx = CP[0]; out.cy = CP[1]; out.cz = CP[2];
            out.nx = N[t * 3]; out.ny = N[t * 3 + 1]; out.nz = N[t * 3 + 2];
            out.px = _p.x; out.py = _p.y; out.pz = _p.z;
          }
        }
      }
      if (out.hit && out.g === g) out.dl = best;
    }
    if (!out.hit) return false;
    const g = out.g;
    const dx = out.px - out.cx, dy = out.py - out.cy, dz = out.pz - out.cz;
    const inside = dx * out.nx + dy * out.ny + dz * out.nz < 0 && out.dl > 1e-5;
    const l = Math.hypot(dx, dy, dz);
    // Richtung heraus: vom Punkt zur Oberfläche (innen) bzw. von der Oberfläche weg (außen); auf der Fläche: Normale
    if (l > 1e-6) { const s = inside ? -1 / l : 1 / l; out.dir.set(dx * s, dy * s, dz * s); } else out.dir.set(out.nx, out.ny, out.nz);
    out.dir.applyQuaternion(g.rot);
    out.d = (inside ? -out.dl : out.dl) * g.scale;
    return true;
  }
}

// Nächster Punkt auf Dreieck (Ericson, Real-Time Collision Detection 5.1.5) → CP, Rückgabe Abstand²
const CP = new Float64Array(3);
function closestOnTri(T, o, px, py, pz) {
  const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let x, y, z;
  if (d1 <= 0 && d2 <= 0) { x = ax; y = ay; z = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { x = bx; y = by; z = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); x = ax + abx * v; y = ay + aby * v; z = az + abz * v; }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { x = cx; y = cy; z = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); x = ax + acx * w; y = ay + acy * w; z = az + acz * w; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); x = bx + (cx - bx) * w; y = by + (cy - by) * w; z = bz + (cz - bz) * w; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; x = ax + abx * v + acx * w; y = ay + aby * v + acy * w; z = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  CP[0] = x; CP[1] = y; CP[2] = z;
  return (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
}

/** Ergebnisobjekt für GunCollider.query (wiederverwendbar). */
export function contactHit() { return { hit: false, d: Infinity, dir: new THREE.Vector3(), g: null, dl: 0, cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 }; }
