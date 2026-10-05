// NULLPUNKT — Rechenintensiver, deterministischer Teil des Kartenaufbaus als reine Datenfunktion (Owner: world):
// Kollisions- und Kugel-BVH, Startpunkte am Boden einrasten, Navigationsgraph abtasten, Sonden-Gitter backen.
// Ohne three-Abhängigkeit: läuft im Welt-Worker (worldgen.worker.js) parallel zu Octree/Licht im Hauptthread,
// als Rückfall auch direkt im Hauptthread (runWorldJob). loadWorld teilt die Arbeit auf zwei Worker auf:
// parts ['col'] (Kollision → Startpunkte → Navigation) und ['bullet'] (Kugel-BVH → Sonden-Gitter).
import { TriangleBVH } from './bvh.js';
import { buildNavData } from './navbuild.js';
import { bakeProbes, probeTransferables } from './probes.js';

/**
 * job: { parts?: ['col', 'bullet'] (Standard beide), colTris: Float32Array, bulletTris: Float32Array, bulletData: Uint32Array,
 *        points: [{ x, y, z, fallbackY }]   // Startpunkte/Flaggen: Suche ab y + 1,2 m abwärts
 *        nav: { bounds, points: [{x,y,z}], exclude, spacing, seeds: [Index in points] },
 *        probes?: { bounds, tier, sunDir, albedo (Uint8Array RGB je Kugel-Dreieck), lights } }
 * → { col?, bullet? (TriangleBVH.toData), snapped?: [y], nav? (buildNavData), probes? (bakeProbes), ms }
 */
export function buildWorldData(job, onStage) {
  const ms = {};
  const parts = job.parts || ['col', 'bullet'];
  const out = { ms };
  let t = performance.now();
  if (parts.includes('col')) {
    onStage?.('Kollision');
    const col = new TriangleBVH(job.colTris);
    ms.col = Math.round(performance.now() - t);

    // Startpunkte einrasten (Standard-Suchhöhe knapp über Kopfhöhe, unter jeder Zimmerdecke)
    const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
    out.snapped = job.points.map(p => {
      const y0 = p.y + 1.2;
      return col.raycast(p.x, y0, p.z, 0, -1, 0, y0 + 10, hit) ? y0 - hit.t : p.fallbackY;
    });

    t = performance.now();
    onStage?.('Navigation');
    const n = job.nav;
    const seeds = n.seeds.map(i => ({ x: job.points[i].x, y: out.snapped[i], z: job.points[i].z }));
    out.nav = buildNavData({ colliderBVH: col, bounds: n.bounds, navPoints: n.points, exclude: n.exclude, seeds }, { spacing: n.spacing });
    ms.nav = Math.round(performance.now() - t);
    out.col = col.toData();
  }
  if (parts.includes('bullet')) {
    t = performance.now();
    onStage?.('Kugel-BVH');
    const bullet = new TriangleBVH(job.bulletTris, job.bulletData);
    ms.bullet = Math.round(performance.now() - t);
    if (job.probes) {
      t = performance.now();
      onStage?.('Licht');
      try { out.probes = bakeProbes(bullet, job.probes); } catch (err) { out.probesError = String((err && err.message) || err); }
      ms.probes = Math.round(performance.now() - t);
    }
    out.bullet = bullet.toData();
  }
  return out;
}

/** Puffer des Ergebnisses für den Transfer aus dem Worker. */
export function resultTransferables(r) {
  return [
    ...(r.col ? TriangleBVH.transferables(r.col) : []),
    ...(r.bullet ? TriangleBVH.transferables(r.bullet) : []),
    ...probeTransferables(r.probes),
  ];
}
