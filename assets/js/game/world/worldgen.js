// NULLPUNKT — Rechenintensiver, deterministischer Teil des Kartenaufbaus als reine Datenfunktion (Owner: world):
// Kollisions- und Kugel-BVH, Startpunkte am Boden einrasten, Navigationsgraph abtasten.
// Ohne three-Abhängigkeit: läuft im Welt-Worker (worldgen.worker.js) parallel zu Octree/Licht im Hauptthread,
// als Rückfall auch direkt im Hauptthread (runWorldJob).
import { TriangleBVH } from './bvh.js';
import { buildNavData } from './navbuild.js';

/**
 * job: { colTris: Float32Array, bulletTris: Float32Array, bulletData: Uint32Array,
 *        points: [{ x, y, z, fallbackY }]   // Startpunkte/Flaggen: Suche ab y + 1,2 m abwärts
 *        nav: { bounds, points: [{x,y,z}], exclude, spacing, seeds: [Index in points] } }
 * → { col, bullet (TriangleBVH.toData), snapped: [y], nav (buildNavData), ms: { col, bullet, nav } }
 */
export function buildWorldData(job, onStage) {
  const ms = {};
  let t = performance.now();
  onStage?.('Kollision');
  const col = new TriangleBVH(job.colTris);
  ms.col = Math.round(performance.now() - t);

  // Startpunkte einrasten (Standard-Suchhöhe knapp über Kopfhöhe, unter jeder Zimmerdecke)
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
  const snapped = job.points.map(p => {
    const y0 = p.y + 1.2;
    return col.raycast(p.x, y0, p.z, 0, -1, 0, y0 + 10, hit) ? y0 - hit.t : p.fallbackY;
  });

  t = performance.now();
  onStage?.('Kugel-BVH');
  const bullet = new TriangleBVH(job.bulletTris, job.bulletData);
  ms.bullet = Math.round(performance.now() - t);

  t = performance.now();
  onStage?.('Navigation');
  const n = job.nav;
  const seeds = n.seeds.map(i => ({ x: job.points[i].x, y: snapped[i], z: job.points[i].z }));
  const nav = buildNavData({ colliderBVH: col, bounds: n.bounds, navPoints: n.points, exclude: n.exclude, seeds }, { spacing: n.spacing });
  ms.nav = Math.round(performance.now() - t);
  return { col: col.toData(), bullet: bullet.toData(), snapped, nav, ms };
}

/** Puffer des Ergebnisses für den Transfer aus dem Worker. */
export function resultTransferables(r) {
  return [...TriangleBVH.transferables(r.col), ...TriangleBVH.transferables(r.bullet)];
}
