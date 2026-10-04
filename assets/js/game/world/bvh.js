// NULLPUNKT — Dreiecks-BVH für schnelle Strahltests (Kugeln, Sichtlinien, Nav-Abtastung) (Owner: world)
// Flache Typed-Array-Struktur, Binned-SAH-Aufbau, stapelbasierte Traversierung ohne Allokationen.

const BINS = 12;
const LEAF = 4;

export class TriangleBVH {
  /**
   * @param {Float32Array} tris  9 Floats pro Dreieck (a, b, c)
   * @param {Uint32Array} [data] beliebige Nutzdaten pro Dreieck (z. B. surface | object << 8)
   */
  constructor(tris, data) {
    this.count = (tris.length / 9) | 0;
    this._build(tris, data || new Uint32Array(this.count));
    this._stack = new Int32Array(128);
  }

  _build(src, srcData) {
    const n = this.count;
    const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n);
    const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      for (let k = 0; k < 3; k++) {
        const a = src[o + k], b = src[o + 3 + k], c = src[o + 6 + k];
        bmin[i * 3 + k] = Math.min(a, b, c); bmax[i * 3 + k] = Math.max(a, b, c);
      }
      cx[i] = (bmin[i * 3] + bmax[i * 3]) * 0.5; cy[i] = (bmin[i * 3 + 1] + bmax[i * 3 + 1]) * 0.5; cz[i] = (bmin[i * 3 + 2] + bmax[i * 3 + 2]) * 0.5;
    }
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const maxNodes = Math.max(1, n * 2);
    const nMin = new Float32Array(maxNodes * 3), nMax = new Float32Array(maxNodes * 3);
    const nLeft = new Int32Array(maxNodes), nStart = new Int32Array(maxNodes), nCount = new Int32Array(maxNodes);
    let nodeCount = 0;
    const cent = [cx, cy, cz];
    const binCnt = new Int32Array(BINS), binMin = new Float32Array(BINS * 3), binMax = new Float32Array(BINS * 3);
    const leftArea = new Float32Array(BINS), leftCnt = new Int32Array(BINS);

    const newNode = (start, end) => {
      const id = nodeCount++;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = start; i < end; i++) {
        const t = idx[i] * 3;
        if (bmin[t] < x0) x0 = bmin[t]; if (bmin[t + 1] < y0) y0 = bmin[t + 1]; if (bmin[t + 2] < z0) z0 = bmin[t + 2];
        if (bmax[t] > x1) x1 = bmax[t]; if (bmax[t + 1] > y1) y1 = bmax[t + 1]; if (bmax[t + 2] > z1) z1 = bmax[t + 2];
      }
      nMin[id * 3] = x0; nMin[id * 3 + 1] = y0; nMin[id * 3 + 2] = z0;
      nMax[id * 3] = x1; nMax[id * 3 + 1] = y1; nMax[id * 3 + 2] = z1;
      nStart[id] = start; nCount[id] = end - start; nLeft[id] = -1;
      return id;
    };
    if (n === 0) { newNode(0, 0); }
    else {
      const work = [newNode(0, n)];
      while (work.length) {
        const id = work.pop();
        const start = nStart[id], end = start + nCount[id], cnt = end - start;
        if (cnt <= LEAF) continue;
        // Zentroid-Grenzen
        let best = -1, bestPos = 0, bestCost = Infinity;
        for (let axis = 0; axis < 3; axis++) {
          const c = cent[axis];
          let mn = Infinity, mx = -Infinity;
          for (let i = start; i < end; i++) { const v = c[idx[i]]; if (v < mn) mn = v; if (v > mx) mx = v; }
          if (mx - mn < 1e-6) continue;
          binCnt.fill(0); binMin.fill(Infinity); binMax.fill(-Infinity);
          const k = BINS / (mx - mn) * 0.99999;
          for (let i = start; i < end; i++) {
            const t = idx[i], b = Math.min(BINS - 1, ((c[t] - mn) * k) | 0);
            binCnt[b]++;
            for (let q = 0; q < 3; q++) {
              if (bmin[t * 3 + q] < binMin[b * 3 + q]) binMin[b * 3 + q] = bmin[t * 3 + q];
              if (bmax[t * 3 + q] > binMax[b * 3 + q]) binMax[b * 3 + q] = bmax[t * 3 + q];
            }
          }
          // Präfix von links
          let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity, lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity, lc = 0;
          for (let b = 0; b < BINS - 1; b++) {
            if (binCnt[b]) {
              lx0 = Math.min(lx0, binMin[b * 3]); ly0 = Math.min(ly0, binMin[b * 3 + 1]); lz0 = Math.min(lz0, binMin[b * 3 + 2]);
              lx1 = Math.max(lx1, binMax[b * 3]); ly1 = Math.max(ly1, binMax[b * 3 + 1]); lz1 = Math.max(lz1, binMax[b * 3 + 2]);
            }
            lc += binCnt[b];
            leftCnt[b] = lc;
            leftArea[b] = lc ? area(lx1 - lx0, ly1 - ly0, lz1 - lz0) : 0;
          }
          let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity, rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity, rc = 0;
          for (let b = BINS - 1; b > 0; b--) {
            if (binCnt[b]) {
              rx0 = Math.min(rx0, binMin[b * 3]); ry0 = Math.min(ry0, binMin[b * 3 + 1]); rz0 = Math.min(rz0, binMin[b * 3 + 2]);
              rx1 = Math.max(rx1, binMax[b * 3]); ry1 = Math.max(ry1, binMax[b * 3 + 1]); rz1 = Math.max(rz1, binMax[b * 3 + 2]);
            }
            rc += binCnt[b];
            const lcB = leftCnt[b - 1];
            if (!lcB || !rc) continue;
            const cost = leftArea[b - 1] * lcB + area(rx1 - rx0, ry1 - ry0, rz1 - rz0) * rc;
            if (cost < bestCost) { bestCost = cost; best = axis; bestPos = mn + b / k; }
          }
        }
        let mid;
        if (best < 0) mid = start + (cnt >> 1); // alles deckungsgleich → Hälfte
        else {
          const c = cent[best];
          let i = start, j = end - 1;
          while (i <= j) {
            if (c[idx[i]] < bestPos) i++;
            else { const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; j--; }
          }
          mid = i;
          if (mid === start || mid === end) mid = start + (cnt >> 1);
        }
        const l = newNode(start, mid), r = newNode(mid, end);
        nLeft[id] = l; // rechter Knoten = l + 1
        nCount[id] = 0;
        work.push(l, r);
      }
    }
    // Dreiecke in Blattreihenfolge kopieren (v0, e1, e2)
    const tri = new Float32Array(n * 9), data = new Uint32Array(n), orig = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const s = idx[i] * 9, d = i * 9;
      const ax = src[s], ay = src[s + 1], az = src[s + 2];
      tri[d] = ax; tri[d + 1] = ay; tri[d + 2] = az;
      tri[d + 3] = src[s + 3] - ax; tri[d + 4] = src[s + 4] - ay; tri[d + 5] = src[s + 5] - az;
      tri[d + 6] = src[s + 6] - ax; tri[d + 7] = src[s + 7] - ay; tri[d + 8] = src[s + 8] - az;
      data[i] = srcData[idx[i]]; orig[i] = idx[i];
    }
    this.tri = tri; this.data = data; this.orig = orig;
    this.nMin = nMin.slice(0, nodeCount * 3); this.nMax = nMax.slice(0, nodeCount * 3);
    this.nLeft = nLeft.slice(0, nodeCount); this.nStart = nStart.slice(0, nodeCount); this.nCount = nCount.slice(0, nodeCount);
    this.nodeCount = nodeCount;
  }

  /**
   * Nächster Treffer. out = { t, tri, nx, ny, nz } (Normale zur Strahlquelle gedreht, normiert).
   * @returns {boolean}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out, anyHit = false) {
    if (!this.count) return false;
    const ix = 1 / (Math.abs(dx) > 1e-12 ? dx : 1e-12), iy = 1 / (Math.abs(dy) > 1e-12 ? dy : 1e-12), iz = 1 / (Math.abs(dz) > 1e-12 ? dz : 1e-12);
    const { nMin, nMax, nLeft, nStart, nCount, tri } = this;
    const stack = this._stack;
    let sp = 0, best = maxDist, bestTri = -1;
    stack[sp++] = 0;
    while (sp > 0) {
      const id = stack[--sp], b = id * 3;
      // Slab-Test
      let t0 = (nMin[b] - ox) * ix, t1 = (nMax[b] - ox) * ix;
      let tmin = t0 < t1 ? t0 : t1, tmax = t0 < t1 ? t1 : t0;
      t0 = (nMin[b + 1] - oy) * iy; t1 = (nMax[b + 1] - oy) * iy;
      tmin = Math.max(tmin, t0 < t1 ? t0 : t1); tmax = Math.min(tmax, t0 < t1 ? t1 : t0);
      t0 = (nMin[b + 2] - oz) * iz; t1 = (nMax[b + 2] - oz) * iz;
      tmin = Math.max(tmin, t0 < t1 ? t0 : t1); tmax = Math.min(tmax, t0 < t1 ? t1 : t0);
      if (tmax < 0 || tmin > tmax || tmin > best) continue;
      const left = nLeft[id];
      if (left < 0) {
        const s = nStart[id], e = s + nCount[id];
        for (let i = s; i < e; i++) {
          const o = i * 9;
          const e1x = tri[o + 3], e1y = tri[o + 4], e1z = tri[o + 5], e2x = tri[o + 6], e2y = tri[o + 7], e2z = tri[o + 8];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-10 && det < 1e-10) continue;
          const inv = 1 / det;
          const tx = ox - tri[o], ty = oy - tri[o + 1], tz = oz - tri[o + 2];
          const u = (tx * px + ty * py + tz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t > 1e-5 && t < best) {
            best = t; bestTri = i;
            if (anyHit) return true;
          }
        }
      } else {
        // nahes Kind zuletzt pushen (wird zuerst geprüft): grob nach Mittelpunktsabstand
        const r = left + 1, lb = left * 3, rb = r * 3;
        const dl = (nMin[lb] + nMax[lb] - 2 * ox) * dx + (nMin[lb + 1] + nMax[lb + 1] - 2 * oy) * dy + (nMin[lb + 2] + nMax[lb + 2] - 2 * oz) * dz;
        const dr = (nMin[rb] + nMax[rb] - 2 * ox) * dx + (nMin[rb + 1] + nMax[rb + 1] - 2 * oy) * dy + (nMin[rb + 2] + nMax[rb + 2] - 2 * oz) * dz;
        if (sp > stack.length - 3) continue; // Sicherheitsnetz (sollte nie greifen)
        if (dl < dr) { stack[sp++] = r; stack[sp++] = left; } else { stack[sp++] = left; stack[sp++] = r; }
      }
    }
    if (bestTri < 0) return false;
    if (out) {
      const o = bestTri * 9;
      const e1x = tri[o + 3], e1y = tri[o + 4], e1z = tri[o + 5], e2x = tri[o + 6], e2y = tri[o + 7], e2z = tri[o + 8];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
      out.t = best; out.tri = bestTri; out.nx = nx; out.ny = ny; out.nz = nz; out.data = this.data[bestTri];
    }
    return true;
  }

  /** Irgendein Treffer innerhalb maxDist? (Sichtlinien) */
  occluded(ox, oy, oz, dx, dy, dz, maxDist) {
    return this.raycast(ox, oy, oz, dx, dy, dz, maxDist, null, true);
  }

  /**
   * Alle Treffer entlang eines senkrechten Strahls von yTop nach unten (für Nav-Abtastung).
   * cb(y, normalY (vorzeichenbehaftet, Dreieckswindung), data) für jeden Treffer (unsortiert).
   */
  verticalHits(x, z, yTop, yBottom, cb) {
    if (!this.count) return;
    const { nMin, nMax, nLeft, nStart, nCount, tri } = this;
    const stack = this._stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const id = stack[--sp], b = id * 3;
      if (x < nMin[b] || x > nMax[b] || z < nMin[b + 2] || z > nMax[b + 2] || nMax[b + 1] < yBottom || nMin[b + 1] > yTop) continue;
      const left = nLeft[id];
      if (left >= 0) { stack[sp++] = left; stack[sp++] = left + 1; continue; }
      const s = nStart[id], e = s + nCount[id];
      for (let i = s; i < e; i++) {
        const o = i * 9;
        const ax = tri[o], az = tri[o + 2];
        const e1x = tri[o + 3], e1z = tri[o + 5], e2x = tri[o + 6], e2z = tri[o + 8];
        // 2D-Baryzentrik in xz
        const det = e1x * e2z - e2x * e1z;
        if (det > -1e-9 && det < 1e-9) continue; // senkrechte Fläche
        const px = x - ax, pz = z - az;
        const u = (px * e2z - e2x * pz) / det, v = (e1x * pz - px * e1z) / det;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        const y = tri[o + 1] + u * tri[o + 4] + v * tri[o + 7];
        if (y > yTop || y < yBottom) continue;
        const e1y = tri[o + 4], e2y = tri[o + 7];
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz) || 1;
        cb(y, ny / l, this.data[i]);
      }
    }
  }
}

function area(x, y, z) { return x * y + y * z + z * x; }
