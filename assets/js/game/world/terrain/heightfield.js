// NULLPUNKT — Höhenfeld für Großkarten: Höhe/Normale, Strahlen (Block-Max-Hierarchie + Zellen-DDA), Dreiecke für die
// Kapselkollision, Bodenart aus der Splat-Karte (Owner: world). Ohne three-Abhängigkeit (läuft auch im Welt-Worker).
//
// Raster: n × n Stützpunkte im Abstand res ab (minX, minZ); Zelle (i, j) wird entlang der Diagonale (0,0)–(1,1)
// geteilt – genau wie das Gelände-Mesh (chunks.js) und die Kollision. heights: Float32Array, Zeile j = z.

/** Oberflächen-Indizes wie builder.js SURFACES ('concrete', 'metal', 'wood', 'dirt', 'sand', 'grass', …, 'water' = 7). */
export const SURF = { concrete: 0, wood: 2, dirt: 3, sand: 4, grass: 5, water: 7 };
/** Splat-Kanäle: R = Erde/Weg, G = Kies, B = Fels/Geröll, A = Acker/Schlamm; Gras = Rest. */
const LAYER_SURF = [SURF.grass, SURF.dirt, SURF.sand, SURF.concrete, SURF.dirt];

const BLOCK = 8; // Zellen je Block der Max-Hierarchie

export class Heightfield {
  /**
   * @param {{ n:number, res:number, minX:number, minZ:number, heights:Float32Array, splat?:Uint8Array, mask?:Uint8Array, waterY?:number }} o
   */
  constructor(o) {
    this.n = o.n; this.res = o.res; this.minX = o.minX; this.minZ = o.minZ;
    this.size = (o.n - 1) * o.res;
    this.maxX = this.minX + this.size; this.maxZ = this.minZ + this.size;
    this.heights = o.heights;
    this.splat = o.splat || null;   // RGBA8 je Stützpunkt
    this.mask = o.mask || null;     // 1 = Asphaltstraße, 2 = befestigter Platz
    this.waterY = o.waterY ?? -Infinity;
    this.inv = 1 / o.res;
    if (o.bmax && o.bmin) { this.nb = o.nb; this.bmax = o.bmax; this.bmin = o.bmin; this.maxH = o.maxH; this.minH = o.minH; }
    else this.buildBlocks();
  }

  /** Reine Daten (Worker-Transfer). */
  toData() {
    const { n, res, minX, minZ, heights, splat, mask, waterY, nb, bmax, bmin, maxH, minH } = this;
    return { n, res, minX, minZ, heights, splat, mask, waterY, nb, bmax, bmin, maxH, minH };
  }

  static fromData(d) { return new Heightfield(d); }

  /** Block-Minimum/-Maximum neu berechnen (nach Änderungen an heights). */
  buildBlocks() {
    const n = this.n, H = this.heights, cells = n - 1;
    const nb = this.nb = Math.ceil(cells / BLOCK);
    const bmax = this.bmax = new Float32Array(nb * nb), bmin = this.bmin = new Float32Array(nb * nb);
    let gMax = -Infinity, gMin = Infinity;
    for (let bj = 0; bj < nb; bj++) for (let bi = 0; bi < nb; bi++) {
      let mx = -Infinity, mn = Infinity;
      const i0 = bi * BLOCK, j0 = bj * BLOCK, i1 = Math.min(n - 1, i0 + BLOCK), j1 = Math.min(n - 1, j0 + BLOCK);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const h = H[j * n + i]; if (h > mx) mx = h; if (h < mn) mn = h; }
      bmax[bj * nb + bi] = mx; bmin[bj * nb + bi] = mn;
      if (mx > gMax) gMax = mx; if (mn < gMin) gMin = mn;
    }
    this.maxH = gMax; this.minH = gMin;
  }

  /** Höhe am Stützpunkt (geklemmt). */
  h(i, j) {
    const n = this.n;
    i = i < 0 ? 0 : i > n - 1 ? n - 1 : i; j = j < 0 ? 0 : j > n - 1 ? n - 1 : j;
    return this.heights[j * n + i];
  }

  /** Geländehöhe bei (x, z) – exakt auf den Dreiecken (wie Mesh und Kollision). */
  heightAt(x, z) {
    const n = this.n;
    let fx = (x - this.minX) * this.inv, fz = (z - this.minZ) * this.inv;
    if (fx < 0) fx = 0; else if (fx > n - 1.000001) fx = n - 1.000001;
    if (fz < 0) fz = 0; else if (fz > n - 1.000001) fz = n - 1.000001;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const H = this.heights, o = j * n + i;
    const h00 = H[o], h10 = H[o + 1], h01 = H[o + n], h11 = H[o + n + 1];
    return tx >= tz ? h00 + (h10 - h00) * tx + (h11 - h10) * tz : h00 + (h01 - h00) * tz + (h11 - h01) * tx;
  }

  /** Geglättete Normale (Mittendifferenzen über ±1 Raster). out = {x,y,z} (wird zurückgegeben). */
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const r = this.res;
    const hx = this.heightAt(x + r, z) - this.heightAt(x - r, z);
    const hz = this.heightAt(x, z + r) - this.heightAt(x, z - r);
    const nx = -hx, ny = 2 * r, nz = -hz, l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  /** Normale am Stützpunkt (für Mesh-Vertices). */
  vertexNormal(i, j, out) {
    const hx = this.h(i + 1, j) - this.h(i - 1, j), hz = this.h(i, j + 1) - this.h(i, j - 1);
    const nx = -hx, ny = 2 * this.res, nz = -hz, l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }

  /** Innerhalb des Höhenfelds (xz)? */
  contains(x, z) { return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ; }

  /** Kleinste/größte Höhe in einem Rechteck (blockweise, konservativ). → [min, max] */
  rangeY(minX, minZ, maxX, maxZ, out = [0, 0]) {
    const B = BLOCK * this.res, nb = this.nb;
    const bi0 = Math.max(0, Math.floor((minX - this.minX) / B)), bi1 = Math.min(nb - 1, Math.floor((maxX - this.minX) / B));
    const bj0 = Math.max(0, Math.floor((minZ - this.minZ) / B)), bj1 = Math.min(nb - 1, Math.floor((maxZ - this.minZ) / B));
    let mn = Infinity, mx = -Infinity;
    for (let bj = bj0; bj <= bj1; bj++) for (let bi = bi0; bi <= bi1; bi++) {
      const k = bj * nb + bi; if (this.bmin[k] < mn) mn = this.bmin[k]; if (this.bmax[k] > mx) mx = this.bmax[k];
    }
    out[0] = mn; out[1] = mx;
    return out;
  }

  /**
   * Alle Gelände-Dreiecke, deren Zellen das Rechteck berühren: cb(ax, ay, az, bx, by, bz, cx, cy, cz).
   * Windung: Normale nach oben.
   */
  forEachTriangle(minX, minZ, maxX, maxZ, cb) {
    const n = this.n, r = this.res, H = this.heights;
    const i0 = Math.max(0, Math.floor((minX - this.minX) * this.inv)), i1 = Math.min(n - 2, Math.floor((maxX - this.minX) * this.inv));
    const j0 = Math.max(0, Math.floor((minZ - this.minZ) * this.inv)), j1 = Math.min(n - 2, Math.floor((maxZ - this.minZ) * this.inv));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = j * n + i;
      const x0 = this.minX + i * r, z0 = this.minZ + j * r, x1 = x0 + r, z1 = z0 + r;
      const h00 = H[o], h10 = H[o + 1], h01 = H[o + n], h11 = H[o + n + 1];
      cb(x0, h00, z0, x0, h01, z1, x1, h11, z1);
      cb(x0, h00, z0, x1, h11, z1, x1, h10, z0);
    }
  }

  /**
   * Strahl gegen das Gelände. dir normiert. out = { t, nx, ny, nz } (Normale zur Strahlquelle gedreht).
   * Block-Max-Hierarchie überspringt Bereiche, über denen der Strahl verläuft; nur betroffene Zellen werden getestet.
   * @returns {boolean}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    if (!(maxDist > 0)) return false;
    // Global: Strahl startet über dem höchsten Punkt und steigt → kein Treffer
    if (oy > this.maxH && dy >= 0) return false;
    // Auf das Rechteck klemmen
    let t0 = 0, t1 = maxDist;
    const minX = this.minX, minZ = this.minZ, maxX = this.maxX, maxZ = this.maxZ;
    if (Math.abs(dx) < 1e-12) { if (ox < minX || ox > maxX) return false; }
    else { let a = (minX - ox) / dx, b = (maxX - ox) / dx; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    if (Math.abs(dz) < 1e-12) { if (oz < minZ || oz > maxZ) return false; }
    else { let a = (minZ - oz) / dz, b = (maxZ - oz) / dz; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    if (t0 > t1) return false;
    // Höhe: über dem Maximum bleibt der Strahl ab dort, wo er es überschreitet
    if (dy > 0 && oy + dy * t0 > this.maxH) return false;
    if (dy < 0) { const tTop = (this.maxH - oy) / dy; if (tTop > t0) t0 = tTop; if (t0 > t1) return false; }
    // Senkrechter Strahl: direkte Höhe
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) {
      if (!(Math.abs(dy) > 0)) return false;
      const t = (this.heightAt(ox, oz) - oy) / dy;
      if (t < 1e-5 || t > maxDist) return false;
      if (out) {
        this.normalAt(ox, oz, _n);
        const f = _n.y * dy > 0 ? -1 : 1;
        out.t = t; out.nx = _n.x * f; out.ny = _n.y * f; out.nz = _n.z * f;
      }
      return true;
    }
    const B = BLOCK * this.res, nb = this.nb;
    const eps = 1e-6;
    let t = t0;
    let bi = Math.min(nb - 1, Math.max(0, Math.floor((ox + dx * (t + eps) - minX) / B)));
    let bj = Math.min(nb - 1, Math.max(0, Math.floor((oz + dz * (t + eps) - minZ) / B)));
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? B / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-12 ? B / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-12 ? ((minX + (bi + (sx > 0 ? 1 : 0)) * B) - ox) / dx : Infinity;
    let tmz = Math.abs(dz) > 1e-12 ? ((minZ + (bj + (sz > 0 ? 1 : 0)) * B) - oz) / dz : Infinity;
    for (let guard = 0; guard < 4 * nb + 4 && t <= t1; guard++) {
      const tn = Math.min(tmx, tmz, t1);
      const ya = oy + dy * t, yb = oy + dy * tn;
      if ((ya < yb ? ya : yb) <= this.bmax[bj * nb + bi] + 1e-4) {
        if (this._cells(ox, oy, oz, dx, dy, dz, t, tn, out)) return true;
      }
      if (tn >= t1) break;
      if (tmx < tmz) { t = tmx; tmx += tdx; bi += sx; if (bi < 0 || bi >= nb) break; }
      else { t = tmz; tmz += tdz; bj += sz; if (bj < 0 || bj >= nb) break; }
    }
    return false;
  }

  /** Zellen-DDA zwischen ta und tb. */
  _cells(ox, oy, oz, dx, dy, dz, ta, tb, out) {
    const n = this.n, r = this.res, H = this.heights, minX = this.minX, minZ = this.minZ;
    const eps = 1e-6;
    let i = Math.floor((ox + dx * (ta + eps) - minX) / r), j = Math.floor((oz + dz * (ta + eps) - minZ) / r);
    if (i < 0) i = 0; else if (i > n - 2) i = n - 2;
    if (j < 0) j = 0; else if (j > n - 2) j = n - 2;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? r / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-12 ? r / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-12 ? ((minX + (i + (sx > 0 ? 1 : 0)) * r) - ox) / dx : Infinity;
    let tmz = Math.abs(dz) > 1e-12 ? ((minZ + (j + (sz > 0 ? 1 : 0)) * r) - oz) / dz : Infinity;
    let t = ta;
    for (let guard = 0; guard < 64 && t <= tb + eps; guard++) {
      const tn = Math.min(tmx, tmz, tb);
      const o = j * n + i;
      const h00 = H[o], h10 = H[o + 1], h01 = H[o + n], h11 = H[o + n + 1];
      const cmax = Math.max(h00, h10, h01, h11);
      const ya = oy + dy * t, yb = oy + dy * tn;
      if ((ya < yb ? ya : yb) <= cmax + 1e-4) {
        const x0 = minX + i * r, z0 = minZ + j * r;
        let best = Infinity, bnx = 0, bny = 1, bnz = 0;
        // Dreieck 1: (00, 01, 11)  Dreieck 2: (00, 11, 10)
        for (let k = 0; k < 2; k++) {
          const ax = x0, ay = h00, az = z0;
          let e1x, e1y, e1z, e2x, e2y, e2z;
          if (k === 0) { e1x = 0; e1y = h01 - h00; e1z = r; e2x = r; e2y = h11 - h00; e2z = r; }
          else { e1x = r; e1y = h11 - h00; e1z = r; e2x = r; e2y = h10 - h00; e2z = 0; }
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
          const inv = 1 / det;
          const tx = ox - ax, ty = oy - ay, tz = oz - az;
          const u = (tx * px + ty * py + tz * pz) * inv;
          if (u < -1e-7 || u > 1 + 1e-7) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < -1e-7 || u + v > 1 + 1e-7) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > 1e-5 && tt < best) {
            best = tt;
            bnx = e1y * e2z - e1z * e2y; bny = e1z * e2x - e1x * e2z; bnz = e1x * e2y - e1y * e2x;
          }
        }
        if (best <= tb + 1e-4 && best >= ta - 1e-4) {
          if (out) {
            const l = Math.hypot(bnx, bny, bnz) || 1;
            let nx = bnx / l, ny = bny / l, nz = bnz / l;
            if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
            out.t = best; out.nx = nx; out.ny = ny; out.nz = nz;
          }
          return true;
        }
      }
      if (tn >= tb) break;
      if (tmx < tmz) { t = tmx; tmx += tdx; i += sx; if (i < 0 || i > n - 2) break; }
      else { t = tmz; tmz += tdz; j += sz; if (j < 0 || j > n - 2) break; }
    }
    return false;
  }

  /** Splat-Gewichte am nächsten Stützpunkt → [gras, erde, kies, fels, acker] (0..1). */
  layersAt(x, z, out = [0, 0, 0, 0, 0]) {
    if (!this.splat) { out.fill(0); out[0] = 1; return out; }
    const n = this.n;
    const i = Math.min(n - 1, Math.max(0, Math.round((x - this.minX) * this.inv)));
    const j = Math.min(n - 1, Math.max(0, Math.round((z - this.minZ) * this.inv)));
    const o = (j * n + i) * 4, S = this.splat;
    out[1] = S[o] / 255; out[2] = S[o + 1] / 255; out[3] = S[o + 2] / 255; out[4] = S[o + 3] / 255;
    out[0] = Math.max(0, 1 - out[1] - out[2] - out[3] - out[4]);
    return out;
  }

  /** Maskenwert am nächsten Stützpunkt (1 = Asphalt, 2 = befestigt). */
  maskAt(x, z) {
    if (!this.mask) return 0;
    const n = this.n;
    const i = Math.min(n - 1, Math.max(0, Math.round((x - this.minX) * this.inv)));
    const j = Math.min(n - 1, Math.max(0, Math.round((z - this.minZ) * this.inv)));
    return this.mask[j * n + i];
  }

  /** Oberflächen-Index (builder SURFACES) des Geländes bei (x, z) für Schritte/Einschläge. */
  surfaceIndexAt(x, z, y = this.heightAt(x, z)) {
    if (y < this.waterY - 0.05) return SURF.water;
    if (this.maskAt(x, z)) return SURF.concrete;
    const L = this.layersAt(x, z, _layers);
    let best = 0, bw = L[0];
    for (let k = 1; k < 5; k++) if (L[k] > bw) { bw = L[k]; best = k; }
    return LAYER_SURF[best];
  }
}

const _n = { x: 0, y: 1, z: 0 };
const _layers = [0, 0, 0, 0, 0];
