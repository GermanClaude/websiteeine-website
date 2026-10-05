// NULLPUNKT — Navigationsgraph: Abtastung + Verbindungen als reine Daten (Owner: world)
// Ohne three-Abhängigkeit, damit der Aufbau im Welt-Worker (worldgen.worker.js) laufen kann.
// Die Laufzeit-Klasse NavGraph (A*, Deckung, Glättung) liegt in navgraph.js und baut auf diesen Daten auf.

export const AGENT_R = 0.36;      // Kapselradius (+ Reserve)
export const HEAD = 1.75;         // nötige Kopffreiheit
export const WALK_NY = 0.7;       // max. ~45° Neigung (steilere Schrägen wie Schutzschilde nicht begehbar)
export const KNEE = 0.62, CHEST = 1.25, TOP = 1.62, STEP_RAY = 0.5;
export const DIRS8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

// ---------------------------------------------------------------------------
// Geometrische Tests auf der Kollisions-BVH
// ---------------------------------------------------------------------------
export function makeTests(bvh) {
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
    // knapp über Stufenhöhe (niedrige Hindernisse 0,45–0,62 m), Knie: Mitte + seitlich, Brust, Kopf
    if (ray(a.x, a.y + STEP_RAY, a.z, ux, uy, uz, len)) return false;
    if (ray(a.x + px, a.y + STEP_RAY, a.z + pz, ux, uy, uz, len)) return false;
    if (ray(a.x - px, a.y + STEP_RAY, a.z - pz, ux, uy, uz, len)) return false;
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
// Aufbau
// ---------------------------------------------------------------------------
/**
 * Tastet die begehbaren Flächen ab und liefert den Graph als reine Daten (ohne three – läuft auch im Worker).
 * src: { colliderBVH, bounds: {minX,maxX,minZ,maxZ,minY,maxY}, navPoints: [{x,y,z}], exclude, seeds: [{x,y?,z}] }
 * → { nodes: [{ x, y, z, links, drop, cover, coverHigh, coverDirs: [x,z, …], coverDir: [x,y,z]|null }],
 *     removed: [{x,y,z}], stats }
 */
export function buildNavData(src, { spacing = 1.5 } = {}) {
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
    // in beide Richtungen prüfen (Strahlen starten am jeweiligen Knoten)
    if (T.segmentClear(v(A), v(B)) && T.segmentClear(v(B), v(A))) { links[ai].add(bi); links[bi].add(ai); }
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
    nodes[keep[i]] = { x: r.x, y: r.y, z: r.z, links: nl, cover: false, coverDir: null, coverDirs: [], coverHigh: false, drop: [...drops[i]].filter(k => keep[k] >= 0).map(k => keep[k]) };
  }
  // Deckung: Hindernis auf Brusthöhe (geduckt) in der Nähe
  let coverCount = 0;
  for (const n of nodes) {
    let sx = 0, sz = 0;
    for (const [dx, dz] of DIRS8) {
      if (!T.ray(n.x, n.y + 0.9, n.z, dx, 0, dz, 1.25)) continue;
      n.coverDirs.push(-dx, -dz);
      sx -= dx; sz -= dz;
      if (T.ray(n.x, n.y + 1.65, n.z, dx, 0, dz, 1.25)) n.coverHigh = true;
    }
    const nd = n.coverDirs.length / 2;
    if (nd && nd < 7) {
      n.cover = true; coverCount++;
      const l = Math.hypot(sx, sz);
      n.coverDir = l * l > 0.01 ? [sx / l, 0, sz / l] : [n.coverDirs[0], 0, n.coverDirs[1]];
    }
  }
  const ms = performance.now() - t0;
  let linkCount = 0; for (const n of nodes) linkCount += n.links.length;
  return {
    nodes,
    removed: removed.map(r => ({ x: r.x, y: r.y, z: r.z })),
    stats: { nodes: nodes.length, links: linkCount, drops: dropCount, cover: coverCount, removed: removed.length, ms: Math.round(ms) },
  };
}

