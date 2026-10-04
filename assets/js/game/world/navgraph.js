// NULLPUNKT — Navigationsgraph für Bots (Owner: world)
// Automatisch aus der Kollisionsgeometrie abgetastet: begehbare Flächen auf allen Ebenen (Dächer,
// Laufstege, Treppen), Verbindungen mit Kapsel-Freiraumprüfung, einseitige Absprung-Kanten,
// Deckungspunkte. A* mit binärem Heap + String-Pulling-Glättung.
import * as THREE from 'three';

const AGENT_R = 0.36;      // Kapselradius (+ Reserve)
const HEAD = 1.75;         // nötige Kopffreiheit
const WALK_NY = 0.64;      // max. ~50° Neigung
const KNEE = 0.62, CHEST = 1.25, TOP = 1.62;
const DIRS8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

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
// Geometrische Tests auf der Kollisions-BVH
// ---------------------------------------------------------------------------
function makeTests(bvh) {
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0 };
  const ray = (ox, oy, oz, dx, dy, dz, len) => bvh.occluded(ox, oy, oz, dx, dy, dz, len);

  /** Boden unter (x, z) zwischen yHigh und yLow; liefert y oder NaN. */
  const groundAt = (x, z, yHigh, yLow) => {
    if (!bvh.raycast(x, yHigh, z, 0, -1, 0, yHigh - yLow, hit)) return NaN;
    if (hit.ny < WALK_NY) return NaN;
    return yHigh - hit.t;
  };

  /** Freiraum an einem Punkt: Kopf + 8 Richtungen auf zwei Höhen. */
  const nodeClear = (x, y, z) => {
    if (ray(x, y + 0.08, z, 0, 1, 0, HEAD - 0.08)) return false;
    for (const h of [KNEE, TOP]) for (const [dx, dz] of DIRS8) if (ray(x, y + h, z, dx, 0, dz, AGENT_R)) return false;
    return true;
  };

  /** Begehbare Strecke A→B (Kapsel passt durch, Boden durchgehend, keine Lücken). */
  const segmentClear = (a, b, groundStep = 0.4) => {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const hl = Math.hypot(dx, dz);
    if (hl < 1e-4) return Math.abs(dy) < 0.5;
    const len = Math.hypot(dx, dy, dz);
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const px = -dz / hl * AGENT_R * 0.92, pz = dx / hl * AGENT_R * 0.92;
    // Knie: Mitte + seitlich, Brust, Kopf
    if (ray(a.x, a.y + KNEE, a.z, ux, uy, uz, len)) return false;
    if (ray(a.x + px, a.y + KNEE, a.z + pz, ux, uy, uz, len)) return false;
    if (ray(a.x - px, a.y + KNEE, a.z - pz, ux, uy, uz, len)) return false;
    if (ray(a.x, a.y + CHEST, a.z, ux, uy, uz, len)) return false;
    if (ray(a.x + px, a.y + TOP, a.z + pz, ux, uy, uz, len)) return false;
    if (ray(a.x - px, a.y + TOP, a.z - pz, ux, uy, uz, len)) return false;
    // durchgehender Boden ohne Stufen > Stufenhöhe
    const n = Math.max(2, Math.ceil(hl / groundStep));
    let prevY = a.y;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + dx * t, z = a.z + dz * t, y = a.y + dy * t;
      const gy = groundAt(x, z, y + 0.55, y - 0.75);
      if (Number.isNaN(gy) || Math.abs(gy - prevY) > 0.46) return false;
      prevY = gy;
    }
    return Math.abs(b.y - prevY) <= 0.46;
  };

  /** Standfläche: Boden auch ±0,35 m daneben (keine Knoten auf Brüstungen, Geländern, Fensterbänken). */
  const support = (x, y, z) => {
    let ok = 0;
    for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) {
      const gy = groundAt(x + dx, z + dz, y + 0.3, y - 0.35);
      if (!Number.isNaN(gy)) ok++;
    }
    return ok >= 3;
  };

  return { ray, groundAt, nodeClear, segmentClear, support, hit };
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
/**
 * Tastet die begehbaren Flächen ab und baut den Graph.
 * src: { colliderBVH, bounds: {minX,maxX,minZ,maxZ,minY,maxY}, navPoints: Vector3[], seeds: Vector3[] }
 */
export function buildNavGraph(src, { spacing = 1.5, debug = false } = {}) {
  const t0 = performance.now();
  const bvh = src.colliderBVH;
  const T = makeTests(bvh);
  const b = src.bounds;
  const yTop = (b.maxY ?? 30) + 1, yBot = (b.minY ?? -5) - 1;
  const nx = Math.floor((b.maxX - b.minX) / spacing), nz = Math.floor((b.maxZ - b.minZ) / spacing);
  const ox = b.minX + ((b.maxX - b.minX) - (nx - 1) * spacing) / 2, oz = b.minZ + ((b.maxZ - b.minZ) - (nz - 1) * spacing) / 2;
  const cols = new Array(nx * nz);
  const excl = src.exclude || [];
  const excluded = (x, y, z) => excl.some(e => x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ && y >= e.minY && y <= e.maxY);
  const raw = []; // { x, y, z, i, j }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = ox + i * spacing, z = oz + j * spacing;
    // Treffer von oben nach unten; Tiefenzähler: Oberseite (ny>0) = Eintritt in Festkörper,
    // Unterseite (ny<0) = Austritt. Kandidat = Oberseite, über der Luft ist (Tiefe 0).
    const hits = [];
    bvh.verticalHits(x, z, yTop, yBot, (y, ny) => { if (Math.abs(ny) > 0.001) hits.push(y, ny); }); // auch steile Kegelflächen zählen (Ein-/Austritt)
    const order = [];
    for (let k = 0; k < hits.length; k += 2) order.push(k);
    order.sort((p, q) => (hits[q] - hits[p]) || (hits[q + 1] - hits[p + 1]));
    const list = [];
    let depth = 0, lastY = Infinity;
    for (const k of order) {
      const y = hits[k], ny = hits[k + 1];
      if (ny > 0) {
        if (depth === 0 && ny >= WALK_NY && lastY - y >= 0.12 && !(excl.length && excluded(x, y, z)) && T.nodeClear(x, y, z) && T.support(x, y, z)) {
          list.push(raw.length);
          raw.push({ x, y, z, i, j, extra: false });
          lastY = y;
        }
        depth++;
      } else depth = Math.max(0, depth - 1);
    }
    cols[j * nx + i] = list;
  }
  // Zusatzpunkte (Türen, Treppenenden)
  for (const p of src.navPoints || []) {
    const gy = T.groundAt(p.x, p.z, p.y + 0.6, p.y - 1.2);
    if (Number.isNaN(gy) || !T.nodeClear(p.x, gy, p.z)) continue;
    raw.push({ x: p.x, y: gy, z: p.z, i: Math.round((p.x - ox) / spacing), j: Math.round((p.z - oz) / spacing), extra: true });
  }

  // Verbindungen
  const links = raw.map(() => new Set());
  const v = (n) => ({ x: n.x, y: n.y, z: n.z });
  const tryLink = (ai, bi) => {
    if (ai === bi || links[ai].has(bi)) return;
    const A = raw[ai], B = raw[bi];
    const hd = Math.hypot(B.x - A.x, B.z - A.z), dy = Math.abs(B.y - A.y);
    if (dy > 0.5 + hd * 0.95) return;
    if (T.segmentClear(v(A), v(B))) { links[ai].add(bi); links[bi].add(ai); }
  };
  const colAt = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? null : cols[j * nx + i];
  for (let ai = 0; ai < raw.length; ai++) {
    const A = raw[ai];
    if (A.extra) continue;
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const list = colAt(A.i + di, A.j + dj);
      if (list) for (const bi of list) tryLink(ai, bi);
    }
  }
  // Zusatzpunkte mit Nachbarn verbinden
  for (let ai = 0; ai < raw.length; ai++) {
    const A = raw[ai];
    if (!A.extra) continue;
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      const list = colAt(A.i + di, A.j + dj);
      if (!list) continue;
      for (const bi of list) if (Math.hypot(raw[bi].x - A.x, raw[bi].z - A.z) < spacing * 2.3) tryLink(ai, bi);
    }
    for (let bi = 0; bi < raw.length; bi++) if (raw[bi].extra && bi !== ai && Math.hypot(raw[bi].x - A.x, raw[bi].z - A.z) < spacing * 2.3) tryLink(ai, bi);
  }
  // Einseitige Absprünge (Kanten von Containern, Dächern, Laufstegen)
  const drops = raw.map(() => new Set());
  let dropCount = 0;
  for (let ai = 0; ai < raw.length; ai++) {
    const A = raw[ai];
    if (A.extra || links[ai].size >= 8) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // Gibt es auf gleicher Höhe einen Nachbarn in dieser Richtung? Dann keine Kante.
      const same = colAt(A.i + di, A.j + dj);
      if (same && same.some(bi => links[ai].has(bi))) continue;
      for (const dist of [1, 2]) {
        const list = colAt(A.i + di * dist, A.j + dj * dist);
        if (!list) continue;
        const bi = list.find(k => A.y - raw[k].y > 0.9 && A.y - raw[k].y < 3.6 && links[k].size >= 2);
        if (bi === undefined) continue;
        const B = raw[bi];
        // horizontale Strecke auf Höhe A bis über B frei, dann senkrecht runter frei
        const hx = B.x - A.x, hz = B.z - A.z, hl = Math.hypot(hx, hz);
        if (T.ray(A.x, A.y + KNEE, A.z, hx / hl, 0, hz / hl, hl) || T.ray(A.x, A.y + TOP, A.z, hx / hl, 0, hz / hl, hl)) continue;
        if (T.ray(B.x, A.y + KNEE, B.z, 0, -1, 0, A.y + KNEE - B.y - 0.15)) continue;
        drops[ai].add(bi); dropCount++;
        break;
      }
    }
  }

  // Stark zusammenhängende Hauptkomponente bestimmen (vorwärts ∩ rückwärts erreichbar)
  const N = raw.length;
  const fwd = raw.map((_, i) => [...links[i], ...drops[i]]);
  const rev = raw.map(() => []);
  for (let i = 0; i < N; i++) for (const k of fwd[i]) rev[k].push(i);
  const bfs = (start, adj) => { const seen = new Uint8Array(N); const q = [start]; seen[start] = 1; while (q.length) { const c = q.pop(); for (const k of adj[c]) if (!seen[k]) { seen[k] = 1; q.push(k); } } return seen; };
  // Saat: Knoten nahe der Startpunkte, sonst der mit den meisten Nachbarn nahe der Mitte
  let seed = -1;
  const center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const seedPts = (src.seeds && src.seeds.length) ? src.seeds : [center];
  let bestSize = -1;
  for (const sp of seedPts.slice(0, 6)) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < N; i++) { const d = (raw[i].x - sp.x) ** 2 + (raw[i].z - sp.z) ** 2 + ((raw[i].y - (sp.y ?? raw[i].y)) ** 2) * 4; if (d < bd && links[i].size > 2) { bd = d; bi = i; } }
    if (bi < 0) continue;
    const f = bfs(bi, fwd); let size = 0; for (let i = 0; i < N; i++) size += f[i];
    if (size > bestSize) { bestSize = size; seed = bi; }
  }
  if (seed < 0) seed = 0;
  const F = N ? bfs(seed, fwd) : new Uint8Array(0), R = N ? bfs(seed, rev) : new Uint8Array(0);
  const keep = new Int32Array(N).fill(-1);
  const nodes = [];
  const removed = [];
  for (let i = 0; i < N; i++) {
    if (F[i] && R[i]) { keep[i] = nodes.length; nodes.push(null); } else removed.push(raw[i]);
  }
  for (let i = 0; i < N; i++) {
    if (keep[i] < 0) continue;
    const r = raw[i];
    const nl = [];
    for (const k of fwd[i]) if (keep[k] >= 0) nl.push(keep[k]);
    nodes[keep[i]] = { id: keep[i], position: new THREE.Vector3(r.x, r.y, r.z), links: nl, cover: false, coverDir: null, coverDirs: [], coverHigh: false, drop: [...drops[i]].filter(k => keep[k] >= 0).map(k => keep[k]) };
  }
  // Deckung: Hindernis auf Brusthöhe (geduckt) in der Nähe
  let coverCount = 0;
  for (const n of nodes) {
    const p = n.position;
    const sum = new THREE.Vector3();
    for (const [dx, dz] of DIRS8) {
      if (!T.ray(p.x, p.y + 0.9, p.z, dx, 0, dz, 1.25)) continue;
      const away = new THREE.Vector3(-dx, 0, -dz);
      n.coverDirs.push(away);
      sum.add(away);
      if (T.ray(p.x, p.y + 1.65, p.z, dx, 0, dz, 1.25)) n.coverHigh = true;
    }
    if (n.coverDirs.length && n.coverDirs.length < 7) {
      n.cover = true; coverCount++;
      n.coverDir = sum.lengthSq() > 0.01 ? sum.normalize() : n.coverDirs[0].clone();
    }
  }
  const nav = new NavGraph(nodes, T);
  const ms = performance.now() - t0;
  let linkCount = 0; for (const n of nodes) linkCount += n.links.length;
  nav.stats = { nodes: nodes.length, links: linkCount, drops: dropCount, cover: coverCount, removed: removed.length, ms: Math.round(ms) };
  nav.removed = removed;
  if (debug) nav.report = validateNavGraph(nav, src, removed);
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
