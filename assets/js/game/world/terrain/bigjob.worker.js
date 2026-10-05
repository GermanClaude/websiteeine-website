// NULLPUNKT — Welt-Worker für Großkarten (Owner: world): Gelände erzeugen, danach BVHs + Navigation (bigjob.js).
// Das Höhenfeld bleibt zwischen beiden Aufträgen im Worker (kein zweiter Transfer).
import { terrainJob, worldJob, worldTransferables } from './bigjob.js';

let hf = null;
self.onmessage = async (e) => {
  const { id, type } = e.data || {};
  const stage = (s) => self.postMessage({ id, stage: s });
  try {
    if (type === 'terrain') {
      const r = await terrainJob(e.data.spec, stage);
      hf = r.hf;
      self.postMessage({ id, result: { data: r.data, roads: r.roads, river: r.river } });
    } else if (type === 'world') {
      if (!hf) throw new Error('Gelände fehlt');
      const r = worldJob(e.data.job, hf, stage);
      self.postMessage({ id, result: r }, worldTransferables(r));
      hf = null;
    }
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err?.message || err) });
  }
};
