// Weiche Formen für Waffenteile aus Distanzfeldern (Nutzer 13.10.2026: Waffen wie das reale Vorbild – organische
// Griffe, gerundete Übergänge statt Kästen). Ein Feld f(x, v, u) < 0 ist innen; surfaceNets vernetzt die Nullfläche
// (Surface Nets: ein Punkt je Zelle mit Vorzeichenwechsel, Vierecke über jede geschnittene Gitterkante) und rechnet
// die Normalen aus dem Feldgradienten – dadurch glatte Schattierung ohne sichtbare Facetten.
// Koordinaten wie im Bauplan: x quer, v hoch, u nach vorn (Ausgabe: x, v, −u).
import * as THREE from 'three';

const clamp = (a, lo, hi) => (a < lo ? lo : a > hi ? hi : a);

/** Vorzeichenbehafteter Abstand zu einem Polygon [[a, b], …] (innen negativ). */
export function sdPolygon(px, py, v) {
  let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2;
  let s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    const wx = px - v[i][0], wy = py - v[i][1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= v[i][1], c2 = py < v[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** Profil d2 quer (x) auf ±h extrudiert, alle Kanten mit Radius r gerundet. */
export function extrudeRound(d2, x, h, r) {
  const wx = d2 + r, wy = Math.abs(x) - h + r;
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - r;
}

/** Weiche Vereinigung (Hohlkehle mit Radius ≈ k). */
export function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

/**
 * Nullfläche von f im Quader [min, max] (je [x, v, u]) mit Gitterweite step vernetzen → BufferGeometry
 * (Position + Normale, indiziert). Dreiecke ≈ 2 × Fläche / step².
 */
export function surfaceNets(f, min, max, step) {
  const nx = Math.ceil((max[0] - min[0]) / step) + 1, ny = Math.ceil((max[1] - min[1]) / step) + 1, nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const val = new Float32Array(nx * ny * nz);
  const id = (x, y, z) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    val[id(x, y, z)] = f(min[0] + x * step, min[1] + y * step, min[2] + z * step);
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const cid = (x, y, z) => x + cx * (y + cy * z);
  const pos = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    let neg = 0;
    for (let k = 0; k < 8; k++) { const c = corner[k]; cv[k] = val[id(x + c[0], y + c[1], z + c[2])]; if (cv[k] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const va = cv[a], vb = cv[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb), A = corner[a], B = corner[b];
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; n++;
    }
    cell[cid(x, y, z)] = pos.length / 3;
    pos.push(min[0] + (x + sx / n) * step, min[1] + (y + sy / n) * step, min[2] + (z + sz / n) * step);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let z = 1; z < cz; z++) for (let y = 1; y < cy; y++) for (let x = 0; x < cx; x++) {   // Kanten entlang x
    const a = val[id(x, y, z)], b = val[id(x + 1, y, z)];
    if ((a < 0) === (b < 0)) continue;
    quad(cell[cid(x, y - 1, z - 1)], cell[cid(x, y, z - 1)], cell[cid(x, y, z)], cell[cid(x, y - 1, z)], a < 0);
  }
  for (let z = 1; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 1; x < cx; x++) {   // entlang y (v)
    const a = val[id(x, y, z)], b = val[id(x, y + 1, z)];
    if ((a < 0) === (b < 0)) continue;
    quad(cell[cid(x - 1, y, z - 1)], cell[cid(x - 1, y, z)], cell[cid(x, y, z)], cell[cid(x, y, z - 1)], a < 0);
  }
  for (let z = 0; z < cz; z++) for (let y = 1; y < cy; y++) for (let x = 1; x < cx; x++) {   // entlang z (u)
    const a = val[id(x, y, z)], b = val[id(x, y, z + 1)];
    if ((a < 0) === (b < 0)) continue;
    quad(cell[cid(x - 1, y - 1, z)], cell[cid(x, y - 1, z)], cell[cid(x, y, z)], cell[cid(x - 1, y, z)], a < 0);
  }
  // Normalen aus dem Feldgradienten; Ausgabe in Bauplan-Achsen (x, v, −u)
  const e = step * 0.5;
  const out = new Float32Array(pos.length), nrm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    out[i] = x; out[i + 1] = y; out[i + 2] = -z;
    nrm[i] = gx / l; nrm[i + 1] = gy / l; nrm[i + 2] = -gz / l;
  }
  // Wicklung je Dreieck an der Feldnormale ausrichten (Vorderseite außen)
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = out[b] - out[a], uy = out[b + 1] - out[a + 1], uz = out[b + 2] - out[a + 2];
    const vx = out[c] - out[a], vy = out[c + 1] - out[a + 1], vz = out[c + 2] - out[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]) < 0) {
      const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}
