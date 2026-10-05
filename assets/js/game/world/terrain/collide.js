// NULLPUNKT — Kapsel-Kollision auf Großkarten (Owner: world): Fassade mit genau der Octree-API, die
// engine/physics.js nutzt (capsuleIntersect, getCapsuleTriangles, triangleCapsuleIntersect, rayIntersect).
// Dreiecke kommen auf Abruf aus dem Höhenfeld (2–8 unter der Kapsel) und aus der Kollisions-BVH der Bauwerke –
// kein three-Octree über die ganze Karte (Aufbauzeit, Speicher).
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { bvhBoxQuery } from './composite.js';

const _c = new THREE.Vector3(), _c2 = new THREE.Vector3();

export class TerrainCollider {
  /**
   * @param {import('./heightfield.js').Heightfield} hf
   * @param {import('../bvh.js').TriangleBVH} bvh Kollisions-BVH der Bauwerke/Bäume
   * @param {import('./composite.js').CompositeBVH} composite für rayIntersect
   */
  constructor(hf, bvh, composite) {
    this.hf = hf; this.bvh = bvh; this.composite = composite;
    this._oc = new Octree(); // nur für triangleCapsuleIntersect (reine Geometrie-Methode)
    this._poolA = []; this._poolB = [];
    this._stack = new Int32Array(128);
    this._range = [0, 0];
    this._capTmp = null;
    this.stats = { queries: 0 };
  }

  _gather(capsule, out, pool) {
    const r = capsule.radius;
    const minX = Math.min(capsule.start.x, capsule.end.x) - r, maxX = Math.max(capsule.start.x, capsule.end.x) + r;
    const minY = Math.min(capsule.start.y, capsule.end.y) - r, maxY = Math.max(capsule.start.y, capsule.end.y) + r;
    const minZ = Math.min(capsule.start.z, capsule.end.z) - r, maxZ = Math.max(capsule.start.z, capsule.end.z) + r;
    let k = 0;
    const push = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
      let t = pool[k];
      if (!t) { t = pool[k] = new THREE.Triangle(); }
      t.a.set(ax, ay, az); t.b.set(bx, by, bz); t.c.set(cx, cy, cz);
      out.push(t); k++;
    };
    const hf = this.hf;
    if (hf.contains((minX + maxX) / 2, (minZ + maxZ) / 2)) {
      const rg = hf.rangeY(minX, minZ, maxX, maxZ, this._range);
      if (rg[0] <= maxY && rg[1] >= minY) hf.forEachTriangle(minX, minZ, maxX, maxZ, push);
    }
    bvhBoxQuery(this.bvh, minX, minY, minZ, maxX, maxY, maxZ, push, this._stack);
    this.stats.queries++;
    return out;
  }

  /** Wie Octree.getCapsuleTriangles: hängt THREE.Triangle an (gepoolt – gültig bis zum nächsten Aufruf). */
  getCapsuleTriangles(capsule, triangles) { return this._gather(capsule, triangles, this._poolA); }

  triangleCapsuleIntersect(capsule, triangle) { return this._oc.triangleCapsuleIntersect(capsule, triangle); }

  /** Wie Octree.capsuleIntersect: { normal, depth } | false. */
  capsuleIntersect(capsule) {
    const cap = this._capTmp || (this._capTmp = capsule.clone());
    cap.copy(capsule);
    const tris = this._gather(cap, [], this._poolB);
    let hit = false;
    for (let i = 0; i < tris.length; i++) {
      const res = this._oc.triangleCapsuleIntersect(cap, tris[i]);
      if (res) { hit = true; cap.translate(res.normal.multiplyScalar(res.depth)); }
    }
    if (!hit) return false;
    const v = cap.getCenter(_c).sub(capsule.getCenter(_c2));
    const depth = v.length();
    return { normal: v.normalize().clone(), depth };
  }

  /** Wie Octree.rayIntersect: { distance, triangle, position } | false. */
  rayIntersect(ray) {
    const h = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
    const o = ray.origin, d = ray.direction;
    if (!this.composite.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 1e4, h)) return false;
    const p = new THREE.Vector3().copy(d).multiplyScalar(h.t).add(o);
    const n = new THREE.Vector3(h.nx, h.ny, h.nz);
    // Ersatz-Dreieck senkrecht zur Normalen (nur getNormal()/Position werden genutzt)
    const t1 = new THREE.Vector3(1, 0, 0); if (Math.abs(n.x) > 0.9) t1.set(0, 0, 1);
    const u = t1.cross(n).normalize(), w = new THREE.Vector3().crossVectors(n, u);
    const tri = new THREE.Triangle(p.clone(), p.clone().add(u), p.clone().add(w));
    return { distance: h.t, triangle: tri, position: p };
  }

  clear() { this._poolA.length = 0; this._poolB.length = 0; }
}
