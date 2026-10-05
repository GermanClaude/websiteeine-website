// NULLPUNKT — Rechenintensiver Teil des Großkarten-Aufbaus als reine Datenfunktionen (Owner: world):
// Gelände erzeugen, Kollisions-/Kugel-BVH, Startpunkte einrasten, Navigation (feine Graphen in Ortschaften über
// navbuild.js + implizites 4-m-Gitter im freien Gelände, an den Rändern verknüpft). Ohne three – läuft im Welt-Worker
// (bigjob.worker.js) parallel zum Hauptthread, als Rückfall direkt im Hauptthread.
import { TriangleBVH } from '../bvh.js';
import { buildNavData, makeTests, AGENT_R, KNEE, DIRS8 } from '../navbuild.js';
import { Heightfield } from './heightfield.js';
import { CompositeBVH } from './composite.js';
import { generateTerrain } from './generate.js';

/** Gelände erzeugen → { hf (Heightfield), data (toData), roads } */
export async function terrainJob(spec, onStage) {
  const { hf, roads } = await generateTerrain(spec, { onProgress: (p, l) => onStage?.(l) });
  return { hf, data: hf.toData(), roads, river: hf.riverLine };
}

const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/**
 * job: { colTris, bulletTris, bulletData, terrainObject,
 *        points: [{ x, y, z }]                      // Startpunkte/Flaggen: Suche ab y + 1,2 m abwärts
 *        sites: [{ id, bounds:{minX,maxX,minZ,maxZ,minY,maxY}, points:[{x,y,z}], exclude, seeds:[{x,y,z}] }],
 *        grid: { bounds, spacing, exclude:[rect] }, seeds: [{ x, z }] }
 * → { col, bullet (TriangleBVH.toData), snapped: [y], nav: { nodes, stats }, ms }
 */
export function worldJob(job, hf, onStage) {
  const ms = {};
  let t = performance.now();
  onStage?.('Kollision');
  const col = new TriangleBVH(job.colTris);
  ms.col = Math.round(performance.now() - t);
  const comp = new CompositeBVH(hf, col, { terrainObject: job.terrainObject });
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
  const snapped = job.points.map(p => {
    const y0 = (p.y ?? hf.heightAt(p.x, p.z)) + 1.2;
    return comp.raycast(p.x, y0, p.z, 0, -1, 0, y0 + 40, hit) ? y0 - hit.t : hf.heightAt(p.x, p.z);
  });

  t = performance.now();
  onStage?.('Kugel-BVH');
  const bullet = new TriangleBVH(job.bulletTris, job.bulletData);
  ms.bullet = Math.round(performance.now() - t);

  t = performance.now();
  onStage?.('Navigation');
  const nav = buildBigNav(job, hf, col, comp);
  ms.nav = Math.round(performance.now() - t);
  return { col: col.toData(), bullet: bullet.toData(), snapped, nav, ms };
}

/** Navigation: feine Ortschafts-Graphen + grobes Geländegitter + Verknüpfung + Erreichbarkeit. */
function buildBigNav(job, hf, col, comp) {
  const T = makeTests(comp);
  const nodes = [];
  const fineStats = [];
  // 1) Ortschaften (navbuild über Gelände + Bauwerke)
  const siteOf = [];
  for (const s of job.sites || []) {
    const d = buildNavData({ colliderBVH: comp, bounds: s.bounds, navPoints: s.points || [], exclude: s.exclude || [], seeds: s.seeds || [] }, { spacing: s.spacing || 1.5 });
    const off = nodes.length;
    for (const n of d.nodes) {
      nodes.push({ x: n.x, y: n.y, z: n.z, links: n.links.map(k => k + off), drop: n.drop.map(k => k + off), cover: n.cover, coverHigh: n.coverHigh, coverDirs: n.coverDirs, coverDir: n.coverDir, cost: 0, kind: 0 });
      siteOf.push(s.id);
    }
    fineStats.push({ id: s.id, ...d.stats });
  }
  const fineCount = nodes.length;

  // 2) Grobes Gitter im freien Gelände
  const g = job.grid, sp = g.spacing || 4, b = g.bounds;
  const gw = Math.floor((b.maxX - b.minX) / sp), gh = Math.floor((b.maxZ - b.minZ) / sp);
  const cell = new Int32Array(gw * gh).fill(-1);
  const wy = hf.waterY;
  const n3 = { x: 0, y: 1, z: 0 };
  const free = (x, y, z) => {
    if (col.occluded(x, y + 0.1, z, 0, 1, 0, 1.7)) return false;
    for (let k = 0; k < 8; k += 2) { const [dx, dz] = DIRS8[k]; if (col.occluded(x, y + KNEE, z, dx, 0, dz, AGENT_R + 0.12)) return false; }
    return true;
  };
  const JIT = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const cx = b.minX + (i + 0.5) * sp, cz = b.minZ + (j + 0.5) * sp;
    if ((g.exclude || []).some(r => inRect(r, cx, cz))) continue;
    for (const [ox, oz] of JIT) {
      const x = cx + ox * 1.1, z = cz + oz * 1.1;
      const y = hf.heightAt(x, z);
      if (y < wy - 0.75) break; // tiefes Wasser
      hf.normalAt(x, z, n3);
      if (n3.y < 0.74) continue;
      if (!free(x, y, z)) continue;
      cell[j * gw + i] = nodes.length;
      nodes.push({ x, y, z, links: [], drop: [], cover: false, coverHigh: false, coverDirs: [], coverDir: null, cost: y < wy - 0.12 ? 8 : 0, kind: 1 });
      break;
    }
  }
  const link = (a, c) => { if (!nodes[a].links.includes(c)) nodes[a].links.push(c); if (!nodes[c].links.includes(a)) nodes[c].links.push(a); };
  let coarseLinks = 0;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const a = cell[j * gw + i];
    if (a < 0) continue;
    const A = nodes[a];
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
      const c = cell[jj * gw + ii];
      if (c < 0) continue;
      const B = nodes[c];
      const hd = Math.hypot(B.x - A.x, B.z - A.z), dy = B.y - A.y;
      if (Math.abs(dy) > hd * 0.75) continue;
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, my = hf.heightAt(mx, mz);
      if (my < wy - 0.75) continue;
      if (Math.abs(my - (A.y + B.y) / 2) > 0.9) continue; // Graben/Kuppe dazwischen
      const len = Math.hypot(B.x - A.x, dy, B.z - A.z), ux = (B.x - A.x) / len, uy = dy / len, uz = (B.z - A.z) / len;
      if (col.occluded(A.x, A.y + 0.5, A.z, ux, uy, uz, len)) continue;
      if (col.occluded(A.x, A.y + 1.25, A.z, ux, uy, uz, len)) continue;
      link(a, c); coarseLinks++;
    }
    // Deckung (Bäume, Felsen, Mauern) auf Brusthöhe
    let sx = 0, sz = 0;
    for (const [dx, dz] of DIRS8) {
      if (!col.occluded(A.x, A.y + 0.9, A.z, dx, 0, dz, 1.6)) continue;
      A.coverDirs.push(-dx, -dz); sx -= dx; sz -= dz;
      if (col.occluded(A.x, A.y + 1.65, A.z, dx, 0, dz, 1.6)) A.coverHigh = true;
    }
    const nd = A.coverDirs.length / 2;
    if (nd && nd < 7) { A.cover = true; const l = Math.hypot(sx, sz); A.coverDir = l > 0.1 ? [sx / l, 0, sz / l] : [A.coverDirs[0], 0, A.coverDirs[1]]; }
  }

  // 3) Ränder der Ortschaften: grobe Knoten mit nahen feinen Knoten verbinden (begehbare Strecke in beide Richtungen)
  const hash = new Map(), hc = 3;
  const key = (i, j) => i * 100003 + j;
  for (let k = 0; k < fineCount; k++) {
    const n = nodes[k], kk = key(Math.floor(n.x / hc), Math.floor(n.z / hc));
    if (!hash.has(kk)) hash.set(kk, []);
    hash.get(kk).push(k);
  }
  let stitched = 0;
  for (let k = fineCount; k < nodes.length; k++) {
    const A = nodes[k];
    const near = (job.sites || []).some(s => A.x > s.bounds.minX - sp * 2 && A.x < s.bounds.maxX + sp * 2 && A.z > s.bounds.minZ - sp * 2 && A.z < s.bounds.maxZ + sp * 2);
    if (!near) continue;
    const cand = [];
    const i0 = Math.floor((A.x - 6) / hc), i1 = Math.floor((A.x + 6) / hc), j0 = Math.floor((A.z - 6) / hc), j1 = Math.floor((A.z + 6) / hc);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const f of hash.get(key(i, j)) || []) {
      const F = nodes[f], d = Math.hypot(F.x - A.x, F.z - A.z);
      if (d < 6 && Math.abs(F.y - A.y) < 1.4) cand.push([d, f]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    let made = 0;
    for (let m = 0; m < Math.min(5, cand.length) && made < 2; m++) {
      const F = nodes[cand[m][1]];
      if (T.segmentClear(A, F) && T.segmentClear(F, A)) { link(k, cand[m][1]); made++; stitched++; }
    }
  }

  // 4) Erreichbarkeit: von den Saatpunkten (Startbereiche, Flaggen) aus; Inseln entfernen
  const N = nodes.length;
  const seen = new Uint8Array(N);
  const nearestNode = (x, z) => { let bi = -1, bd = Infinity; for (let k = 0; k < N; k++) { const d = (nodes[k].x - x) ** 2 + (nodes[k].z - z) ** 2; if (d < bd && nodes[k].links.length) { bd = d; bi = k; } } return bi; };
  const stack = [];
  for (const s of job.seeds || []) { const k = nearestNode(s.x, s.z); if (k >= 0 && !seen[k]) { seen[k] = 1; stack.push(k); } }
  while (stack.length) { const c = stack.pop(); for (const k of nodes[c].links) if (!seen[k]) { seen[k] = 1; stack.push(k); } for (const k of nodes[c].drop) if (!seen[k]) { seen[k] = 1; stack.push(k); } }
  const remap = new Int32Array(N).fill(-1);
  const out = [];
  for (let k = 0; k < N; k++) if (seen[k]) { remap[k] = out.length; out.push(nodes[k]); }
  for (const n of out) { n.links = n.links.map(k => remap[k]).filter(k => k >= 0); n.drop = n.drop.map(k => remap[k]).filter(k => k >= 0); }
  let links = 0, cover = 0, fine = 0;
  for (const n of out) { links += n.links.length; if (n.cover) cover++; if (n.kind === 0) fine++; }
  return { nodes: out, stats: { nodes: out.length, fine, coarse: out.length - fine, links, coarseLinks, stitched, cover, removed: N - out.length, sites: fineStats } };
}

export function worldTransferables(r) {
  return [...TriangleBVH.transferables(r.col), ...TriangleBVH.transferables(r.bullet)];
}

export { Heightfield };
