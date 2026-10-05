// NULLPUNKT — Navigation auf Großkarten (Owner: world): NavGraph mit gewichtetem A* (schneller auf langen Wegen,
// Expansionsgrenze) und billigerem String-Pulling im freien Gelände; API wie world/navgraph.js NavGraph
// (+ findPathAsync für die Großkarten-API, plan §4.5).
import * as THREE from 'three';
import { NavGraph } from '../navgraph.js';

export class BigNavGraph extends NavGraph {
  /**
   * @param {Array} nodes Knoten { id, position, links, cover, coverDir, coverDirs, coverHigh, drop, cost, kind (0 fein, 1 Gelände) }
   * @param {object} tests makeTests(CompositeBVH der Kollision)
   * @param {{ hf, col }} o Höhenfeld + Kollisions-BVH der Bauwerke (für schnelle Geländestrecken)
   */
  constructor(nodes, tests, o) {
    super(nodes, tests, { cell: 4 });
    this.hf = o.hf; this.col = o.col;
    this.weight = 1.3;       // Heuristik-Gewicht (≤ 30 % längere Wege möglich, viel weniger Expansionen)
    this.maxExpand = 30000;
    this.lastExpanded = 0;
  }

  _astar(start, goal) {
    const nodes = this.nodes, g = this._g, from = this._from, closed = this._closed, heap = this._heap, W = this.weight;
    const stamp = ++this._stamp;
    if (stamp > 4e9) { closed.fill(0); this._seen.fill(0); this._stamp = 1; }
    const seen = this._seen;
    heap.clear();
    const gp = nodes[goal].position;
    g[start] = 0; from[start] = -1; seen[start] = stamp;
    heap.push(start, nodes[start].position.distanceTo(gp) * W);
    let iter = 0;
    while (heap.n > 0 && iter++ < this.maxExpand) {
      const cur = heap.pop();
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      if (cur === goal) {
        this.lastExpanded = iter;
        const path = [];
        for (let c = goal; c !== -1; c = from[c]) path.push(c);
        return path.reverse();
      }
      const cp = nodes[cur].position, gc = g[cur];
      for (const nb of nodes[cur].links) {
        if (closed[nb] === stamp) continue;
        const np = nodes[nb].position, dy = np.y - cp.y;
        const cost = gc + cp.distanceTo(np) + (dy > 0 ? dy * 0.6 : 0) + (nodes[nb].cost || 0);
        if (seen[nb] !== stamp || cost < g[nb]) {
          seen[nb] = stamp; g[nb] = cost; from[nb] = cur;
          heap.push(nb, cost + np.distanceTo(gp) * W);
        }
      }
    }
    this.lastExpanded = iter;
    return null;
  }

  findPath(from, to, { smooth = true } = {}) {
    const a = this.nearestReachable(from), b = this.nearestReachable(to);
    if (!a || !b) return [];
    const ids = this._astar(a.id, b.id);
    if (!ids) return [];
    const pts = [from.clone()], kinds = [1];
    for (const id of ids) { pts.push(this.nodes[id].position.clone()); kinds.push(this.nodes[id].kind ?? 0); }
    const end = to.clone(), last = pts[pts.length - 1];
    if (end.distanceTo(last) > 0.3 && end.distanceTo(last) < 8 && this._tests.segmentClear(last, end)) { pts.push(end); kinds.push(kinds[kinds.length - 1]); }
    const out = smooth ? this._smoothK(pts, kinds) : pts;
    out.shift();
    return out;
  }

  /** Wie findPath, aber als Promise (Großkarten-API; synchron berechnet, nächster Mikrotask). */
  findPathAsync(from, to, opts = {}) { return Promise.resolve().then(() => this.findPath(from, to, opts)); }

  /** Freie Geländestrecke (nur Bauwerke/Stämme als Hindernis, Gelände ohne Graben/Kuppe, kein tiefes Wasser). */
  _terrainClear(A, B) {
    const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return true;
    if (len > 40) return false;
    const ux = dx / len, uy = dy / len, uz = dz / len, col = this.col, hf = this.hf;
    const hl = Math.hypot(dx, dz) || 1, px = -dz / hl * 0.33, pz = dx / hl * 0.33;
    if (col.occluded(A.x + px, A.y + 0.55, A.z + pz, ux, uy, uz, len)) return false;
    if (col.occluded(A.x - px, A.y + 0.55, A.z - pz, ux, uy, uz, len)) return false;
    if (col.occluded(A.x, A.y + 1.3, A.z, ux, uy, uz, len)) return false;
    const n = Math.ceil(hl / 2);
    for (let i = 1; i < n; i++) {
      const t = i / n, x = A.x + dx * t, z = A.z + dz * t, h = hf.heightAt(x, z);
      if (h < hf.waterY - 0.75 || Math.abs(h - (A.y + dy * t)) > 0.9) return false;
    }
    return true;
  }

  _smoothK(pts, kinds) {
    if (pts.length <= 2) return pts;
    const t = this._tests, out = [pts[0]];
    let anchor = 0;
    while (anchor < pts.length - 1) {
      let next = anchor + 1;
      for (let j = Math.min(pts.length - 1, anchor + 8); j > anchor + 1; j--) {
        const A = pts[anchor], B = pts[j];
        let coarse = true;
        for (let k = anchor; k <= j; k++) if (kinds[k] !== 1) { coarse = false; break; }
        if (coarse) { if (this._terrainClear(A, B)) { next = j; break; } continue; }
        if (j > anchor + 6 || A.distanceTo(B) > 22) continue;
        let ok = true;
        for (let k = anchor + 1; k < j; k++) if (Math.abs(pts[k].y - (A.y + (B.y - A.y) * ((k - anchor) / (j - anchor)))) > 0.45) { ok = false; break; }
        if (ok && t.segmentClear(A, B, 0.5)) { next = j; break; }
      }
      out.push(pts[next]);
      anchor = next;
    }
    return out;
  }
}

/** Knoten aus den reinen Job-Daten (bigjob.js) → BigNavGraph. */
export function bigNavFromData(data, tests, o) {
  const nodes = data.nodes.map((n, id) => {
    const coverDirs = [];
    for (let k = 0; k < n.coverDirs.length; k += 2) coverDirs.push(new THREE.Vector3(n.coverDirs[k], 0, n.coverDirs[k + 1]));
    return {
      id, position: new THREE.Vector3(n.x, n.y, n.z), links: n.links, cover: n.cover,
      coverDir: n.coverDir ? new THREE.Vector3(n.coverDir[0], n.coverDir[1], n.coverDir[2]) : null,
      coverDirs, coverHigh: n.coverHigh, drop: n.drop, cost: n.cost || 0, kind: n.kind,
    };
  });
  const nav = new BigNavGraph(nodes, tests, o);
  nav.stats = { ...data.stats };
  nav.removed = [];
  return nav;
}
