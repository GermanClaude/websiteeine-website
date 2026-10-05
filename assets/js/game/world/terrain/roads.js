// NULLPUNKT — Straßennetz für Fahrzeuge (Owner: world): Graph (Knoten alle ~10 m, Kreuzungen verbunden), A*,
// Abstand zur nächsten Straße, befahrbare Fläche je Fahrzeugklasse; dazu die Asphaltbänder als Meshes.
import * as THREE from 'three';

const CLASS = {
  wheeled: { maxSlope: 25, maxWater: 0.6, offroad: 1.6 },
  tracked: { maxSlope: 35, maxWater: 1.1, offroad: 1.15 },
};

export class RoadNetwork {
  /**
   * @param {Array<{ id, kind, width, samples: Float32Array, bridge, name }>} roads aus generateTerrain
   * @param {import('./heightfield.js').Heightfield} hf
   * @param {{ blockers?: Array<{minX,maxX,minZ,maxZ}> }} [o] Gebäudeflächen (nicht befahrbar)
   */
  constructor(roads, hf, o = {}) {
    this.hf = hf;
    this.blockers = o.blockers || [];
    this.roads = roads.map(r => {
      const pts = [];
      for (let k = 0; k < r.samples.length; k += 3) pts.push(new THREE.Vector3(r.samples[k], r.samples[k + 1], r.samples[k + 2]));
      return { id: r.id, kind: r.kind, width: r.width, name: r.name, bridge: r.bridge, points: pts };
    });
    // Graph: jeder 5. Abtastpunkt (≈ 10 m) + Endpunkte
    const nodes = this.nodes = [];
    for (const r of this.roads) {
      r.nodes = [];
      for (let k = 0; k < r.points.length; k += 5) r.nodes.push(k);
      if (r.nodes[r.nodes.length - 1] !== r.points.length - 1) r.nodes.push(r.points.length - 1);
      let prev = -1;
      for (const k of r.nodes) {
        const id = nodes.length;
        nodes.push({ id, position: r.points[k].clone(), links: [], road: r.id, kind: r.kind, bridge: !!(r.bridge && k >= r.bridge[0] && k <= r.bridge[1]) });
        if (prev >= 0) { nodes[prev].links.push(id); nodes[id].links.push(prev); }
        prev = id;
      }
      r.nodeIds = r.nodes.map((_, i) => nodes.length - r.nodes.length + i);
    }
    // Kreuzungen: Endpunkte nahe einer anderen Straße mit deren nächstem Knoten verbinden
    for (const r of this.roads) for (const end of [r.nodeIds[0], r.nodeIds[r.nodeIds.length - 1]]) {
      const p = nodes[end].position;
      let best = -1, bd = 14;
      for (const n of nodes) {
        if (n.road === r.id) continue;
        const d = Math.hypot(n.position.x - p.x, n.position.z - p.z);
        if (d < bd) { bd = d; best = n.id; }
      }
      if (best >= 0 && !nodes[end].links.includes(best)) { nodes[end].links.push(best); nodes[best].links.push(end); }
    }
    this.stats = { roads: this.roads.length, nodes: nodes.length, km: +(this.roads.reduce((s, r) => s + (r.points.length - 1) * 2, 0) / 1000).toFixed(2) };
  }

  /** Nächster Straßenknoten. */
  nearest(pos) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) { const d = (n.position.x - pos.x) ** 2 + (n.position.z - pos.z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  /** Abstand (xz) zur nächsten Straßenmitte → { distance, road, point, width, kind } */
  distanceTo(x, z) {
    let bd = Infinity, br = null, bp = null;
    for (const r of this.roads) {
      const P = r.points;
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1], ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1e-9;
        let t = ((x - a.x) * ex + (z - a.z) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(x - px, z - pz);
        if (d < bd) { bd = d; br = r; bp = [px, a.y + (b.y - a.y) * t, pz]; }
      }
    }
    return { distance: bd, road: br?.id ?? null, kind: br?.kind ?? null, width: br?.width ?? 0, point: bp ? new THREE.Vector3(bp[0], bp[1], bp[2]) : null };
  }

  /**
   * Befahrbarkeit bei (x, z) für 'wheeled' (Rad, ≤ 25°) bzw. 'tracked' (Kette, ≤ 35°).
   * → { ok, slope (Grad), water (Tiefe m), onRoad, surface, cost (1 = Straße, >1 Gelände) }
   */
  drivable(x, z, cls = 'wheeled') {
    const c = CLASS[cls] || CLASS.wheeled, hf = this.hf;
    if (!hf.contains(x, z)) return { ok: false, slope: 90, water: 0, onRoad: false, surface: 'dirt', cost: Infinity };
    const y = hf.heightAt(x, z), n = hf.normalAt(x, z, _n);
    const slope = Math.acos(Math.min(1, n.y)) * 180 / Math.PI;
    const water = Math.max(0, hf.waterY - y);
    const rd = this.distanceTo(x, z);
    const onRoad = rd.distance <= rd.width / 2 + 0.5;
    const blocked = this.blockers.some(b => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
    const ok = !blocked && (onRoad || (slope <= c.maxSlope && water <= c.maxWater));
    const surf = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'grass', 'glass', 'water'][hf.surfaceIndexAt(x, z, y)] || 'grass';
    return { ok, slope, water, onRoad, surface: onRoad && rd.kind === 'asphalt' ? 'concrete' : surf, cost: !ok ? Infinity : onRoad ? 1 : c.offroad * (1 + slope / 45) };
  }

  /** A* über den Straßengraphen → Wegpunkte (Vector3) von der Straße bei from bis zur Straße bei to (inkl. to). */
  findPath(from, to) {
    const a = this.nearest(from), b = this.nearest(to);
    if (!a || !b) return [];
    const N = this.nodes.length, g = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = [a.id]; g[a.id] = 0;
    const h = (i) => this.nodes[i].position.distanceTo(b.position);
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (g[open[k]] + h(open[k]) < g[open[bi]] + h(open[bi])) bi = k;
      const c = open.splice(bi, 1)[0];
      if (c === b.id) break;
      if (closed[c]) continue;
      closed[c] = 1;
      for (const nb of this.nodes[c].links) {
        const cost = g[c] + this.nodes[c].position.distanceTo(this.nodes[nb].position);
        if (cost < g[nb]) { g[nb] = cost; prev[nb] = c; if (!open.includes(nb)) open.push(nb); }
      }
    }
    if (a.id !== b.id && prev[b.id] < 0) return [];
    const out = [];
    for (let c = b.id; c >= 0; c = prev[c]) out.push(this.nodes[c].position.clone());
    out.reverse();
    out.push(new THREE.Vector3(to.x, to.y ?? this.hf.heightAt(to.x, to.z), to.z));
    return out;
  }

  /** Asphaltbänder (ein Mesh je Material), knapp über dem planierten Gelände; Brückenabschnitte ausgelassen. */
  buildMeshes(getMaterial) {
    const group = new THREE.Group();
    group.name = 'roads';
    const P = [], N = [], U = [];
    for (const r of this.roads) {
      if (r.kind !== 'asphalt') continue;
      const pts = r.points, hw = r.width / 2;
      let v = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        if (r.bridge && k >= r.bridge[0] && k < r.bridge[1]) { v += 2; continue; }
        const a = pts[k], b = pts[k + 1];
        const ta = tangent(pts, k), tb = tangent(pts, k + 1);
        const la = 2;
        const corner = (p, t, s) => { const x = p.x - t.z * hw * s, z = p.z + t.x * hw * s; return [x, this.hf.heightAt(x, z) + 0.035, z]; };
        const a0 = corner(a, ta, -1), a1 = corner(a, ta, 1), b0 = corner(b, tb, -1), b1 = corner(b, tb, 1);
        const ua0 = 0, ua1 = r.width / 5, va = v / 5, vb = (v + la) / 5;
        for (const [p, u, vv] of [[a0, ua0, va], [b0, ua0, vb], [b1, ua1, vb], [a0, ua0, va], [b1, ua1, vb], [a1, ua1, va]]) { P.push(p[0], p[1], p[2]); N.push(0, 1, 0); U.push(u, vv); }
        v += la;
      }
    }
    if (P.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const base = getMaterial('asphalt');
      const mat = base.clone();
      mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
      mat.userData = { ...base.userData, disposable: true, surface: 'concrete' };
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'roads-asphalt';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    return group;
  }
}

function tangent(pts, k) {
  const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

const _n = { x: 0, y: 1, z: 0 };
