// Kontakt Hand ↔ Waffe (hands): Dreiecksgitter je beweglichem Waffenteil (Gehäuse, Magazin, Schlitten …) im
// Teilraum, einmal je Modell gebaut. Abfrage: nächstes Dreieck um einen Punkt (Weltraum) → vorzeichenbehafteter
// Abstand (innen negativ, über die Flächennormale wie das Prüfwerkzeug tools/out/hands2/probe.mjs) und die
// Richtung, in die der Punkt heraus muss. Arm.contact() (arms.js) nutzt das, um Handballen/Daumen/Finger je Bild
// aus der Waffe zu schieben und greifende Finger an die Oberfläche zu legen.
import * as THREE from 'three';

const CELL = 0.012;                 // m Gitterweite (Teilraum; 15.10.: 22 → 12 mm, weniger Dreiecke je Zelle)
const QUANT = 0.003;                // m Raster der Vereinfachung großer Teile (Kontaktnetz, nicht die Grafik)
const DECIMATE_FROM = 3000;         // Dreiecke je Teil, ab denen vereinfacht wird
const TIE = 2e-5;                   // m (Teilraum) gleich nahe Dreiecke (gemeinsame Kante/Ecke)
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
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.userData.noContact || !o.geometry?.attributes?.position) return;
      const m = o.material;
      // Durchscheinende Magazine (userData.solid, magfill) zählen; Patronen/Zubringer darin nicht
      if (!m || (m.transparent && !m.userData.solid) || m.blending === THREE.AdditiveBlending || m.visible === false) return;
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
      if (!tri.length) continue;
      // Leistung (Nutzer 15.10.: Bildeinbrüche beim Schießen/Nachladen): die M-17 in voller Detailstufe hat ~535 000
      // Dreiecke (Distanzfeld-Netze, Schritt < 1 mm) – jede Fingerabfrage prüfte Hunderte je Zelle. Große Teile werden
      // fürs Kontaktnetz auf ein Raster von 3 mm zusammengefasst (Ecken je Zelle gemittelt, entartete, doppelte und
      // umgeklappte Dreiecke fallen weg) – Abweichung ≤ ~1 mm, Fingerkontakt unverändert genau genug.
      const T = tri.length / 9 > DECIMATE_FROM ? decimate(tri, QUANT) : new Float32Array(tri);
      const n = T.length / 9;
      if (!n) continue;
      const N = new Float32Array(n * 3);
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
      g.scale = Math.min(_s.x, _s.y, _s.z);
      if (!(g.scale > 0.05)) { g.on = false; continue; }   // weggeskaliertes Teil (ausgeblendet)
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
      // nur Zellen, die die Suchkugel schneiden (vorher immer der ganze Würfel ±r Zellen, d. h. 27–343 Zellen à 22 mm)
      const r = Math.min(6, Math.ceil(md / CELL)), rr = Math.min(md, r * CELL);
      const cx = Math.floor(_p.x / CELL), cy = Math.floor(_p.y / CELL), cz = Math.floor(_p.z / CELL);
      const x0 = Math.max(cx - r, Math.floor((_p.x - rr) / CELL)), x1 = Math.min(cx + r, Math.floor((_p.x + rr) / CELL));
      const y0 = Math.max(cy - r, Math.floor((_p.y - rr) / CELL)), y1 = Math.min(cy + r, Math.floor((_p.y + rr) / CELL));
      const z0 = Math.max(cz - r, Math.floor((_p.z - rr) / CELL)), z1 = Math.min(cz + r, Math.floor((_p.z + rr) / CELL));
      const T = g.T, N = g.N, st = g.stamp;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const cell = g.grid.get(key(x, y, z));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const t = cell[i];
          if (st[t] === stamp) continue;
          st[t] = stamp;
          const d2 = closestOnTri(T, t * 9, _p.x, _p.y, _p.z);
          if (d2 > md * md || d2 > (best + TIE) * (best + TIE)) continue;
          // Vorzeichen (hands 2): liegt der nächste Punkt auf einer Kante/Ecke, gilt „innen“ nur, wenn ALLE gleich
          // nahen Dreiecke innen sagen – eine einzelne Flächennormale an einer Außenkante meldete Punkte 4 cm
          // neben der Waffe als 4 cm tief drin
          const sd = (_p.x - CP[0]) * N[t * 3] + (_p.y - CP[1]) * N[t * 3 + 1] + (_p.z - CP[2]) * N[t * 3 + 2];
          const dd = Math.sqrt(d2);
          if (dd < best - TIE) {
            best = dd;
            out.hit = true; out.g = g; out.outv = sd >= 0;
            out.cx = CP[0]; out.cy = CP[1]; out.cz = CP[2];
            out.nx = N[t * 3]; out.ny = N[t * 3 + 1]; out.nz = N[t * 3 + 2];
            out.px = _p.x; out.py = _p.y; out.pz = _p.z;
          } else if (sd >= 0 && out.g === g) out.outv = true;
        }
      }
      if (out.hit && out.g === g) out.dl = best;
    }
    if (!out.hit) return false;
    const g = out.g;
    const dx = out.px - out.cx, dy = out.py - out.cy, dz = out.pz - out.cz;
    const inside = !out.outv && out.dl > 1e-5;
    const l = Math.hypot(dx, dy, dz);
    // Richtung heraus: vom Punkt zur Oberfläche (innen) bzw. von der Oberfläche weg (außen); auf der Fläche: Normale
    if (l > 1e-6) { const s = inside ? -1 / l : 1 / l; out.dir.set(dx * s, dy * s, dz * s); } else out.dir.set(out.nx, out.ny, out.nz);
    out.dir.applyQuaternion(g.rot);
    out.d = (inside ? -out.dl : out.dl) * g.scale;
    return true;
  }
}

/**
 * Eindringtest für einen Kugelpunkt (Mittelpunkt p, Radius r): erst kleine Suche (r + 1 mm); findet sie nichts,
 * liegt p aber in der Hüllbox eines Teils, kann der Punkt tief innen stecken → große Suche (65 mm).
 * Rückgabe: Eindringtiefe (m, > 0 = steckt drin) oder −Infinity; Richtung heraus in out.dir.
 */
GunCollider.prototype.pen = function pen(p, r, out) {
  if (this.query(p, r + 0.001, out)) return r - out.d;
  for (const g of this.groups) {
    if (!g.on) continue;
    _p.copy(p).applyMatrix4(g.inv);
    if (g.box.containsPoint(_p)) return this.query(p, 0.065, out) ? r - out.d : -Infinity;
  }
  return -Infinity;
};

/**
 * Vertex-Clustering: Ecken auf ein Raster q (m) zusammenfassen (Mittelwert je Zelle), Dreiecke neu verbinden; entartete,
 * doppelte und gegenüber dem Original umgeklappte Dreiecke entfallen (Vorzeichen innen/außen hängt an den Normalen).
 */
function decimate(tri, q) {
  const n = tri.length / 9, ids = new Map(), sum = [], cnt = [];
  const vid = new Int32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const x = tri[i * 3], y = tri[i * 3 + 1], z = tri[i * 3 + 2];
    const k = Math.floor(x / q) + ',' + Math.floor(y / q) + ',' + Math.floor(z / q);
    let id = ids.get(k);
    if (id === undefined) { id = cnt.length; ids.set(k, id); cnt.push(0); sum.push(0, 0, 0); }
    vid[i] = id; cnt[id]++; sum[id * 3] += x; sum[id * 3 + 1] += y; sum[id * 3 + 2] += z;
  }
  for (let id = 0; id < cnt.length; id++) { sum[id * 3] /= cnt[id]; sum[id * 3 + 1] /= cnt[id]; sum[id * 3 + 2] /= cnt[id]; }
  const seen = new Set(), out = [];
  for (let t = 0; t < n; t++) {
    const a = vid[t * 3], b = vid[t * 3 + 1], c = vid[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
    const key = lo + ',' + mid + ',' + hi;
    if (seen.has(key)) continue;
    // Normale vorher/nachher
    const o = t * 9;
    const n0 = triNormal(tri[o], tri[o + 1], tri[o + 2], tri[o + 3], tri[o + 4], tri[o + 5], tri[o + 6], tri[o + 7], tri[o + 8]);
    const n0x = _n0[0], n0y = _n0[1], n0z = _n0[2];
    const n1 = triNormal(sum[a * 3], sum[a * 3 + 1], sum[a * 3 + 2], sum[b * 3], sum[b * 3 + 1], sum[b * 3 + 2], sum[c * 3], sum[c * 3 + 1], sum[c * 3 + 2]);
    if (!n0 || !n1 || n0x * _n0[0] + n0y * _n0[1] + n0z * _n0[2] < 0.3) continue;
    seen.add(key);
    out.push(sum[a * 3], sum[a * 3 + 1], sum[a * 3 + 2], sum[b * 3], sum[b * 3 + 1], sum[b * 3 + 2], sum[c * 3], sum[c * 3 + 1], sum[c * 3 + 2]);
  }
  return new Float32Array(out);
}
const _n0 = new Float64Array(3);
function triNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
  if (l < 1e-14) return false;
  _n0[0] = nx / l; _n0[1] = ny / l; _n0[2] = nz / l;
  return true;
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
export function contactHit() { return { hit: false, outv: true, d: Infinity, dir: new THREE.Vector3(), g: null, dl: 0, cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0 }; }

/** Mehrere Kollisionskörper als einer (Waffe + sichtbare Requisiten wie Granate, Messer, Platte). */
export class MultiCollider {
  constructor() { this.list = []; this._h = contactHit(); }
  set(list) { this.list = list; return this; }
  sync() { for (const c of this.list) c.sync(); }
  query(p, maxD, out) {
    out.hit = false; out.d = Infinity;
    const h = this._h;
    for (const c of this.list) if (c.query(p, maxD, h) && h.d < out.d) { out.hit = true; out.d = h.d; out.dir.copy(h.dir); out.g = h.g; }
    return out.hit;
  }
  pen(p, r, out) {
    let best = -Infinity;
    const h = this._h;
    for (const c of this.list) { const v = c.pen(p, r, h); if (v > best) { best = v; out.d = h.d; out.dir.copy(h.dir); out.g = h.g; out.hit = h.hit; } }
    return best;
  }
}
