// NULLPUNKT — Gelände-Darstellung: Kacheln (128 m) mit Entfernungs-LOD und Schürzen gegen Risse, dazu der grobe
// Kulissenring bis zur Nebelkante (Owner: world). Ein Draw Call je sichtbarer Kachel + 1 für den Ring.
//
// LOD-Stufe k nutzt jeden 2^k-ten Stützpunkt (Stufe 0 = volle Auflösung, auf low beginnt die Kette bei 2 m).
// Die Diagonale jeder Zelle liegt wie im Höhenfeld (0,0)–(1,1) → auf Stufe 0 deckungsgleich mit der Kollision.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class TerrainChunks {
  /**
   * @param {import('./heightfield.js').Heightfield} hf
   * @param {THREE.Material} material
   * @param {{ chunk?: number, steps?: number[], dists?: number[], skirt?: number }} [o]
   *   steps: Rasterschritte je Stufe (Zellen), dists: Umschaltabstände (m) zwischen den Stufen
   */
  constructor(hf, material, o = {}) {
    this.hf = hf;
    this.material = material;
    this.chunk = o.chunk ?? 128;
    this.steps = o.steps || [1, 2, 4, 8];
    this.dists = o.dists || [70, 200, 380];
    this.skirt = o.skirt ?? 3;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.cells = Math.round(hf.size / hf.res);
    this.per = Math.round(this.chunk / hf.res); // Zellen je Kachel
    this.count = Math.ceil(this.cells / this.per);
    this.chunks = [];
    this._index = new Map(); // Schritt → gemeinsamer Index-Puffer
    this.stats = { chunks: 0, triangles: 0, geometries: 0 };
  }

  /** Gemeinsamer Index (gleiche Topologie für alle Kacheln einer Stufe, inkl. Schürzen). */
  _indexFor(m) {
    if (this._index.has(m)) return this._index.get(m);
    const idx = [];
    for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
      const v00 = b * m + a, v10 = v00 + 1, v01 = v00 + m, v11 = v01 + 1;
      idx.push(v00, v01, v11, v00, v11, v10);
    }
    // Schürzen: 4 Kanten, je m Vertices oben (Rand) + m unten (ab m*m, in Kantenreihenfolge)
    const base = m * m;
    const edges = [
      (k) => k,                     // Nord (b = 0), a läuft
      (k) => (m - 1) * m + k,       // Süd (b = m-1)
      (k) => k * m,                 // West (a = 0)
      (k) => k * m + m - 1,         // Ost (a = m-1)
    ];
    edges.forEach((top, e) => {
      const off = base + e * m;
      for (let k = 0; k < m - 1; k++) {
        const t0 = top(k), t1 = top(k + 1), s0 = off + k, s1 = off + k + 1;
        // beidseitig sichtbar ist unnötig: Material ist FrontSide → beide Windungen anlegen
        idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
      }
    });
    const attr = new THREE.BufferAttribute(m * m + 4 * m > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
    this._index.set(m, attr);
    return attr;
  }

  _geometry(ci, cj, lv) {
    const hf = this.hf, s = this.steps[lv], per = this.per;
    const m = Math.floor(per / s) + 1;
    const i0 = ci * per, j0 = cj * per;
    const total = m * m + 4 * m;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const nrm = [0, 1, 0];
    const lim = hf.n - 1;
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const i = Math.min(lim, i0 + a * s), j = Math.min(lim, j0 + b * s), o = (b * m + a) * 3;
      pos[o] = hf.minX + i * hf.res; pos[o + 1] = hf.heights[j * hf.n + i]; pos[o + 2] = hf.minZ + j * hf.res;
      hf.vertexNormal(i, j, nrm);
      nor[o] = nrm[0]; nor[o + 1] = nrm[1]; nor[o + 2] = nrm[2];
    }
    const depth = this.skirt * (1 + lv);
    const edges = [(k) => k, (k) => (m - 1) * m + k, (k) => k * m, (k) => k * m + m - 1];
    edges.forEach((top, e) => {
      for (let k = 0; k < m; k++) {
        const src = top(k) * 3, dst = (m * m + e * m + k) * 3;
        pos[dst] = pos[src]; pos[dst + 1] = pos[src + 1] - depth; pos[dst + 2] = pos[src + 2];
        nor[dst] = nor[src]; nor[dst + 1] = nor[src + 1]; nor[dst + 2] = nor[src + 2];
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(this._indexFor(m));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData.tris = (m - 1) * (m - 1) * 2;
    this.stats.geometries++;
    return g;
  }

  /** Alle Kacheln anlegen (gröbste Stufe sofort, feinere bei Bedarf). onProgress(0..1). */
  async build(onProgress) {
    let slice = performance.now();
    const coarsest = this.steps.length - 1;
    for (let cj = 0; cj < this.count; cj++) for (let ci = 0; ci < this.count; ci++) {
      const geos = new Array(this.steps.length).fill(null);
      geos[coarsest] = this._geometry(ci, cj, coarsest);
      const mesh = new THREE.Mesh(geos[coarsest], this.material);
      mesh.name = `terrain-${ci}-${cj}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData.surface = 'grass';
      mesh.userData.terrain = true;
      const hf = this.hf;
      const x0 = hf.minX + ci * this.chunk, z0 = hf.minZ + cj * this.chunk;
      const box = geos[coarsest].boundingBox;
      this.chunks.push({ ci, cj, mesh, geos, lv: coarsest, min: new THREE.Vector3(x0, box.min.y, z0), max: new THREE.Vector3(x0 + this.chunk, box.max.y, z0 + this.chunk) });
      this.group.add(mesh);
      if (performance.now() - slice > 10) { onProgress?.((cj * this.count + ci) / (this.count * this.count)); await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
    }
    this.stats.chunks = this.chunks.length;
  }

  /** Stufe je Kachel nach Abstand Kamera → Kachel-AABB; feinere Geometrie wird bei Bedarf erzeugt (max. 2 je Bild). */
  update(camera, budget = 2) {
    const p = camera.position;
    let tris = 0, made = 0;
    for (const c of this.chunks) {
      _v.set(Math.max(c.min.x, Math.min(p.x, c.max.x)), Math.max(c.min.y, Math.min(p.y, c.max.y)), Math.max(c.min.z, Math.min(p.z, c.max.z)));
      const d = _v.distanceTo(p);
      let lv = 0;
      while (lv < this.dists.length && d > this.dists[lv] * (c.lv > lv ? 0.92 : 1)) lv++;
      lv = Math.min(lv, this.steps.length - 1);
      // fehlende feine Geometrie schrittweise erzeugen, bis dahin die nächstgröbere vorhandene zeigen
      let use = lv;
      while (!c.geos[use]) {
        if (made < budget) { c.geos[use] = this._geometry(c.ci, c.cj, use); made++; break; }
        use++;
      }
      if (use !== c.lv || c.mesh.geometry !== c.geos[use]) { c.lv = use; c.mesh.geometry = c.geos[use]; }
      tris += c.geos[use].userData.tris;
    }
    this.stats.triangles = tris;
  }

  /** Feine Stufen um einen Punkt vorab bauen (Startpunkt, Ladebildschirm). */
  prewarm(x, z, radius = 160) {
    for (const c of this.chunks) {
      const dx = Math.max(c.min.x - x, 0, x - c.max.x), dz = Math.max(c.min.z - z, 0, z - c.max.z);
      const d = Math.hypot(dx, dz);
      for (let lv = 0; lv < this.steps.length; lv++) if (!c.geos[lv] && d <= (this.dists[lv] ?? Infinity) && d <= radius) c.geos[lv] = this._geometry(c.ci, c.cj, lv);
    }
  }

  dispose() {
    for (const c of this.chunks) for (const g of c.geos) g?.dispose();
    this.chunks = [];
  }
}

/**
 * Kulissenring: grobes Gitter (step m) von −R…R ohne das Innere des Höhenfelds; innen 1 m unter dem Gelände
 * (überlappt, damit keine Fuge entsteht). heightFn(x, z) liefert die Grundform außerhalb.
 */
export function createFarRing(hf, heightFn, material, { radius = 1000, step = 20 } = {}) {
  const n = Math.round((radius * 2) / step) + 1;
  const inner = hf.size / 2 - step * 1.5; // Überlappung
  const pos = [], nor = [], idx = [];
  const map = new Int32Array(n * n).fill(-1);
  const H = (x, z) => {
    if (hf.contains(x, z)) return hf.heightAt(x, z) - 1.2;
    // außen: Höhenfeldrand → Grundform weich überblenden (24 m)
    const cx = Math.max(hf.minX, Math.min(hf.maxX, x)), cz = Math.max(hf.minZ, Math.min(hf.maxZ, z));
    const d = Math.hypot(x - cx, z - cz);
    const k = Math.min(1, d / 40);
    return (hf.heightAt(cx, cz) - 0.6) * (1 - k) + heightFn(x, z) * k;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -radius + i * step, z = -radius + j * step;
    if (Math.abs(x) < inner - step && Math.abs(z) < inner - step) continue;
    map[j * n + i] = pos.length / 3;
    pos.push(x, H(x, z), z);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = map[j * n + i], b = map[j * n + i + 1], c = map[(j + 1) * n + i], d = map[(j + 1) * n + i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    idx.push(a, c, d, a, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  void nor;
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'terrain-far';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  return mesh;
}
