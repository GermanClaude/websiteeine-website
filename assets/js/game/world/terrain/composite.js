// NULLPUNKT — Fassade „Gelände + Bauwerke“ mit der Abfrage-API von TriangleBVH (raycast/occluded/verticalHits),
// damit Nav-Abtastung (navbuild.js), Sichtlinien, Kugeln und physics.collisionRay unverändert funktionieren
// (Owner: world). Ohne three-Abhängigkeit (läuft auch im Welt-Worker).

export class CompositeBVH {
  /**
   * @param {import('./heightfield.js').Heightfield} hf
   * @param {import('../bvh.js').TriangleBVH|null} bvh Bauwerke (Kollision oder Kugel-Geometrie)
   * @param {{ terrainObject?: number }} [o] Objektindex für Gelände-Treffer (data = Oberfläche | index << 8)
   */
  constructor(hf, bvh, o = {}) {
    this.hf = hf;
    this.bvh = bvh;
    this.terrainObject = o.terrainObject ?? 0;
    this.count = (bvh?.count || 0) + 1;
    this._h = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
    this._g = { t: 0, nx: 0, ny: 1, nz: 0 };
  }

  /** Nächster Treffer (Bauwerk oder Gelände). out wie TriangleBVH: { t, tri (−1 = Gelände), nx, ny, nz, data }. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out, anyHit = false) {
    const h = this._h;
    let best = maxDist, found = false;
    if (this.bvh && this.bvh.count && this.bvh.raycast(ox, oy, oz, dx, dy, dz, maxDist, anyHit ? null : h, anyHit)) {
      if (anyHit) return true;
      best = h.t; found = true;
      if (out) { out.t = h.t; out.tri = h.tri; out.nx = h.nx; out.ny = h.ny; out.nz = h.nz; out.data = h.data; }
    }
    const g = this._g;
    if (this.hf.raycast(ox, oy, oz, dx, dy, dz, best, anyHit ? null : g)) {
      if (anyHit) return true;
      if (!found || g.t < best) {
        found = true;
        if (out) {
          const x = ox + dx * g.t, z = oz + dz * g.t;
          out.t = g.t; out.tri = -1; out.nx = g.nx; out.ny = g.ny; out.nz = g.nz;
          out.data = this.hf.surfaceIndexAt(x, z, oy + dy * g.t) | (this.terrainObject << 8);
        }
      }
    }
    return found;
  }

  occluded(ox, oy, oz, dx, dy, dz, maxDist) { return this.raycast(ox, oy, oz, dx, dy, dz, maxDist, null, true); }

  /** Alle Treffer eines senkrechten Strahls: Bauwerke + Geländeoberfläche (Oberseite). */
  verticalHits(x, z, yTop, yBottom, cb) {
    if (this.bvh && this.bvh.count) this.bvh.verticalHits(x, z, yTop, yBottom, cb);
    const hf = this.hf;
    if (!hf.contains(x, z)) return;
    const y = hf.heightAt(x, z);
    if (y > yTop || y < yBottom) return;
    const n = hf.normalAt(x, z, _n);
    cb(y, n.y, hf.surfaceIndexAt(x, z, y));
  }
}

const _n = { x: 0, y: 1, z: 0 };

/**
 * Dreiecke einer TriangleBVH, deren AABB die Box berührt: cb(ax, ay, az, bx, by, bz, cx, cy, cz).
 * (Box-Abfrage über die flachen Knoten-Arrays; Speicherform je Dreieck: a, e1 = b − a, e2 = c − a.)
 */
export function bvhBoxQuery(bvh, minX, minY, minZ, maxX, maxY, maxZ, cb, stack = new Int32Array(128)) {
  if (!bvh || !bvh.count) return;
  const { nMin, nMax, nLeft, nStart, nCount, tri } = bvh;
  let sp = 0;
  stack[sp++] = 0;
  while (sp > 0) {
    const id = stack[--sp], b = id * 3;
    if (nMin[b] > maxX || nMax[b] < minX || nMin[b + 1] > maxY || nMax[b + 1] < minY || nMin[b + 2] > maxZ || nMax[b + 2] < minZ) continue;
    const left = nLeft[id];
    if (left >= 0) { if (sp < stack.length - 2) { stack[sp++] = left; stack[sp++] = left + 1; } continue; }
    const s = nStart[id], e = s + nCount[id];
    for (let i = s; i < e; i++) {
      const o = i * 9;
      const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
      const bx = ax + tri[o + 3], by = ay + tri[o + 4], bz = az + tri[o + 5];
      const cx = ax + tri[o + 6], cy = ay + tri[o + 7], cz = az + tri[o + 8];
      if (Math.min(ax, bx, cx) > maxX || Math.max(ax, bx, cx) < minX) continue;
      if (Math.min(ay, by, cy) > maxY || Math.max(ay, by, cy) < minY) continue;
      if (Math.min(az, bz, cz) > maxZ || Math.max(az, bz, cz) < minZ) continue;
      cb(ax, ay, az, bx, by, bz, cx, cy, cz);
    }
  }
}
