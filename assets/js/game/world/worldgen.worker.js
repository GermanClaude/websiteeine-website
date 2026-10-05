// NULLPUNKT — Welt-Worker (Owner: world): BVHs + Navigationsgraph abseits des Hauptthreads (siehe worldgen.js).
import { buildWorldData, resultTransferables } from './worldgen.js';

self.onmessage = (e) => {
  const job = e.data || {};
  try {
    const result = buildWorldData(job, stage => self.postMessage({ id: job.id, stage }));
    self.postMessage({ id: job.id, result }, resultTransferables(result));
  } catch (err) {
    self.postMessage({ id: job.id, error: String((err && err.message) || err) });
  }
};
