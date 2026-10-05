// NULLPUNKT — Navigationsgraph für Bots (Owner: world)
// Automatisch aus der Kollisionsgeometrie abgetastet: begehbare Flächen auf allen Ebenen (Dächer,
// Laufstege, Treppen), Verbindungen mit Kapsel-Freiraumprüfung, einseitige Absprung-Kanten,
// Deckungspunkte. A* mit binärem Heap + String-Pulling-Glättung.
import * as THREE from 'three';
import { KNEE, makeTests, buildNavData } from './navbuild.js';


// ---------------------------------------------------------------------------
// Binärer Min-Heap (Knoten-IDs nach f-Wert)
// ---------------------------------------------------------------------------
class Heap {
  constructor(cap) { this.ids = new Int32Array(cap); this.keys = new Float32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(id, k) {
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = k;
  }
  pop() {
    const top = this.ids[0], lastId = this.ids[--this.n], lastK = this.keys[this.n];
    let i = 0;
    while (true) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastK) break;
      this.ids[i] = this.ids[c]; this.keys[i] = this.keys[c]; i = c;
    }
    this.ids[i] = lastId; this.keys[i] = lastK;
    return top;
  }
}

// ---------------------------------------------------------------------------
// NavGraph
// ---------------------------------------------------------------------------
export class NavGraph {
  constructor(nodes, tests, { cell = 3 } = {}) {
    this.nodes = nodes;
    this._tests = tests;
    this._cell = cell;
    this._hash = new Map();
    for (const n of nodes) {
      const k = this._key(Math.floor(n.position.x / cell), Math.floor(n.position.z / cell));
      if (!this._hash.has(k)) this._hash.set(k, []);
      this._hash.get(k).push(n);
    }
    const N = nodes.length;
    this._g = new Float32Array(N);
    this._from = new Int32Array(N);
    this._closed = new Uint32Array(N);
    this._seen = new Uint32Array(N);
    this._stamp = 1;
    this._heap = new Heap(Math.max(16, N * 8));
    this._v = new THREE.Vector3();
  }

  _key(i, j) { return (i + 2048) * 4096 + (j + 2048); }

  /** Knoten im Radius (sortiert nach Entfernung). */
  nodesInRadius(pos, r) {
    const c = this._cell, out = [];
    const i0 = Math.floor((pos.x - r) / c), i1 = Math.floor((pos.x + r) / c), j0 = Math.floor((pos.z - r) / c), j1 = Math.floor((pos.z + r) / c);
    const r2 = r * r;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this._hash.get(this._key(i, j));
      if (!list) continue;
      for (const n of list) if (n.position.distanceToSquared(pos) <= r2) out.push(n);
    }
    out.sort((a, b) => a.position.distanceToSquared(pos) - b.position.distanceToSquared(pos));
    return out;
  }

  /** Nächster Knoten (Höhenunterschied stärker gewichtet → gleiche Ebene bevorzugt). */
  nearest(pos) {
    const c = this._cell;
    const ci = Math.floor(pos.x / c), cj = Math.floor(pos.z / c);
    let best = null, bd = Infinity;
    for (let ring = 0; ring < 40; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
        const list = this._hash.get(this._key(i, j));
        if (!list) continue;
        for (const n of list) {
          const dx = n.position.x - pos.x, dz = n.position.z - pos.z, dy = (n.position.y - pos.y);
          const d = dx * dx + dz * dz + dy * dy * (dy > 0 ? 6 : 3);
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best && (ring * c) * (ring * c) > bd) break;
    }
    return best;
  }

  /** Nächster Knoten, der von pos aus direkt erreichbar ist (Sichtlinie auf Kniehöhe). */
  nearestReachable(pos) {
    const cands = this.nodesInRadius(pos, 6);
    const t = this._tests;
    cands.sort((a, b) => {
      const da = a.position.distanceToSquared(pos) + (a.position.y - pos.y) ** 2 * 4;
      const db = b.position.distanceToSquared(pos) + (b.position.y - pos.y) ** 2 * 4;
      return da - db;
    });
    for (let i = 0; i < Math.min(8, cands.length); i++) {
      const n = cands[i], p = n.position;
      if (Math.abs(p.y - pos.y) > 2.2) continue;
      const dx = p.x - pos.x, dy = p.y - pos.y, dz = p.z - pos.z, l = Math.hypot(dx, dy, dz);
      if (l < 0.05 || !t.ray(pos.x, pos.y + KNEE, pos.z, dx / l, dy / l, dz / l, l)) return n;
    }
    return cands[0] || this.nearest(pos);
  }

  /**
   * A*-Pfad von from nach to. Liefert Wegpunkte (ohne Startpunkt, inkl. Endpunkt).
   * Leeres Array, wenn kein Weg existiert.
   */
  findPath(from, to, { smooth = true } = {}) {
    const a = this.nearestReachable(from), b = this.nearestReachable(to);
    if (!a || !b) return [];
    const ids = this._astar(a.id, b.id);
    if (!ids) return [];
    const pts = [from.clone()];
    for (const id of ids) pts.push(this.nodes[id].position.clone());
    const end = to.clone();
    // Endpunkt nur übernehmen, wenn vom letzten Knoten aus erreichbar
    const last = pts[pts.length - 1];
    if (end.distanceTo(last) > 0.3) {
      if (end.distanceTo(last) < 8 && this._tests.segmentClear(last, end)) pts.push(end);
    }
    const out = smooth ? this._smooth(pts) : pts;
    out.shift();
    return out;
  }

  _astar(start, goal) {
    const nodes = this.nodes, g = this._g, from = this._from, closed = this._closed, heap = this._heap;
    const stamp = ++this._stamp;
    if (stamp > 4e9) { closed.fill(0); this._seen.fill(0); this._stamp = 1; }
    const seen = this._seen;
    heap.clear();
    const gp = nodes[goal].position;
    g[start] = 0; from[start] = -1;
    seen[start] = stamp;
    heap.push(start, nodes[start].position.distanceTo(gp));
    let iter = 0;
    while (heap.n > 0 && iter++ < 60000) {
      const cur = heap.pop();
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      if (cur === goal) {
        const path = [];
        for (let c = goal; c !== -1; c = from[c]) path.push(c);
        return path.reverse();
      }
      const cp = nodes[cur].position, gc = g[cur];
      for (const nb of nodes[cur].links) {
        if (closed[nb] === stamp) continue;
        const np = nodes[nb].position;
        const dy = np.y - cp.y;
        const cost = gc + cp.distanceTo(np) + (dy > 0 ? dy * 0.6 : 0) + (nodes[nb].cost || 0);
        if (seen[nb] !== stamp || cost < g[nb]) {
          seen[nb] = stamp;
          g[nb] = cost; from[nb] = cur;
          heap.push(nb, cost + np.distanceTo(gp));
        }
      }
    }
    return null;
  }

  /** String-Pulling: überspringt Wegpunkte, solange die direkte Strecke begehbar ist. */
  _smooth(pts) {
    if (pts.length <= 2) return pts;
    const t = this._tests;
    const out = [pts[0]];
    let anchor = 0;
    while (anchor < pts.length - 1) {
      let next = anchor + 1;
      for (let j = Math.min(pts.length - 1, anchor + 6); j > anchor + 1; j--) {
        const A = pts[anchor], B = pts[j];
        if (A.distanceTo(B) > 22) continue;
        // keine Abkürzung über Höhenwechsel hinweg (Treppen/Absprünge bleiben erhalten)
        let ok = true;
        for (let k = anchor + 1; k < j; k++) if (Math.abs(pts[k].y - (A.y + (B.y - A.y) * ((k - anchor) / (j - anchor)))) > 0.45) { ok = false; break; }
        if (ok && t.segmentClear(A, B, 0.5)) { next = j; break; }
      }
      out.push(pts[next]);
      anchor = next;
    }
    return out;
  }

  /** Zufälliger Knoten (optional gefiltert). */
  randomNode(filter) {
    const N = this.nodes.length;
    if (!N) return null;
    if (!filter) return this.nodes[(Math.random() * N) | 0];
    for (let i = 0; i < 40; i++) { const n = this.nodes[(Math.random() * N) | 0]; if (filter(n)) return n; }
    const list = this.nodes.filter(filter);
    return list.length ? list[(Math.random() * list.length) | 0] : null;
  }

  /**
   * Deckungspunkt in der Nähe, dessen Deckung zwischen Knoten und Bedrohung liegt.
   * Bevorzugt nahe Punkte, die von threatPos aus nicht einsehbar sind.
   */
  coverNear(pos, threatPos, radius = 12) {
    const cands = this.nodesInRadius(pos, radius).filter(n => n.cover);
    const t = this._tests;
    const scored = [];
    for (const n of cands) {
      const p = n.position;
      let tx = threatPos.x - p.x, tz = threatPos.z - p.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let best = -1;
      for (const d of n.coverDirs) { const dot = -(d.x * tx + d.z * tz); if (dot > best) best = dot; }
      if (best < 0.45) continue;
      const toThreat = p.distanceTo(threatPos), self = p.distanceTo(pos);
      if (toThreat < 4) continue;
      scored.push({ n, s: self + (1 - best) * 6 - Math.min(toThreat, 30) * 0.08 });
    }
    scored.sort((a, b) => a.s - b.s);
    // Sichtprüfung: Kopf der Bedrohung → Brust (geduckt) am Knoten
    for (let i = 0; i < Math.min(6, scored.length); i++) {
      const p = scored[i].n.position;
      const ex = threatPos.x, ey = threatPos.y + 1.5, ez = threatPos.z;
      const dx = p.x - ex, dy = p.y + 0.95 - ey, dz = p.z - ez, l = Math.hypot(dx, dy, dz);
      if (t.ray(ex, ey, ez, dx / l, dy / l, dz / l, l - 0.3)) return scored[i].n;
    }
    return scored.length ? scored[0].n : null;
  }
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------
/** NavGraph aus den reinen Daten von buildNavData (z. B. aus dem Welt-Worker) + Kollisions-BVH für Laufzeittests. */
export function navFromData(data, colliderBVH) {
  const nodes = data.nodes.map((n, id) => {
    const coverDirs = [];
    for (let k = 0; k < n.coverDirs.length; k += 2) coverDirs.push(new THREE.Vector3(n.coverDirs[k], 0, n.coverDirs[k + 1]));
    return {
      id, position: new THREE.Vector3(n.x, n.y, n.z), links: n.links, cover: n.cover,
      coverDir: n.coverDir ? new THREE.Vector3(n.coverDir[0], n.coverDir[1], n.coverDir[2]) : null,
      coverDirs, coverHigh: n.coverHigh, drop: n.drop,
    };
  });
  const nav = new NavGraph(nodes, makeTests(colliderBVH));
  nav.stats = { ...data.stats };
  nav.removed = data.removed;
  return nav;
}

/**
 * Tastet die begehbaren Flächen ab und baut den Graph (synchron im Hauptthread; loadWorld nutzt den Worker).
 * src: { colliderBVH, bounds: {minX,maxX,minZ,maxZ,minY,maxY}, navPoints: Vector3[], seeds: Vector3[] }
 */
export function buildNavGraph(src, { spacing = 1.5, debug = false } = {}) {
  const nav = navFromData(buildNavData(src, { spacing }), src.colliderBVH);
  if (debug) nav.report = validateNavGraph(nav, src, nav.removed);
  return nav;
}

/** Prüft den Graph (Debug): Inseln, Spawns/Ziele erreichbar, Verbindungen frei. */
export function validateNavGraph(nav, src, removed = nav.removed || []) {
  const problems = [];
  const T = nav._tests;
  // entfernte Inseln gruppieren
  const islands = [];
  for (const r of removed) {
    const isl = islands.find(s => Math.hypot(s.x - r.x, s.z - r.z) < 6 && Math.abs(s.y - r.y) < 1.5);
    if (isl) isl.n++; else islands.push({ x: r.x, y: r.y, z: r.z, n: 1 });
  }
  for (const s of islands) if (s.n >= 10) problems.push(`Nicht erreichbare Fläche (${s.n} Punkte) bei (${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)})`);
  // Verbindungen nachprüfen
  let bad = 0;
  for (const n of nav.nodes) for (const k of n.links) {
    const m = nav.nodes[k];
    if (n.drop && n.drop.includes(k)) continue;
    if (k > n.id && !T.segmentClear(n.position, m.position)) bad++;
  }
  if (bad) problems.push(`${bad} Verbindungen ohne Kapsel-Freiraum`);
  // Spawns & Ziele
  for (const [team, list] of Object.entries(src.spawns || {})) {
    list.forEach((s, i) => {
      const n = nav.nearestReachable(s.position);
      if (!n || n.position.distanceTo(s.position) > 3) problems.push(`Spawn ${team}#${i} ohne Navigationsknoten in der Nähe (${s.position.x.toFixed(1)}, ${s.position.z.toFixed(1)})`);
    });
  }
  for (const o of src.objectives?.dom || []) {
    const n = nav.nearestReachable(o.position);
    if (!n || n.position.distanceTo(o.position) > o.radius) problems.push(`Flagge ${o.id} nicht über den Navigationsgraph erreichbar`);
  }
  // Stichprobe: Pfade zwischen Team-Spawns
  const A = src.spawns?.A?.[0]?.position, B = src.spawns?.B?.[0]?.position;
  if (A && B) {
    const t0 = performance.now();
    const path = nav.findPath(A, B);
    const ms = performance.now() - t0;
    if (!path.length) problems.push('Kein Pfad zwischen Team-A- und Team-B-Spawn');
    else nav.stats.samplePath = { points: path.length, ms: +ms.toFixed(2) };
  }
  return { problems, islands };
}
