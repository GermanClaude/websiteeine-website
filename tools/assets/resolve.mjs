// Ergänzt sources.json aus den Quell-APIs: Autor(en), Seiten-URL, reale Größe (Texturen), Polygonzahl (Modelle).
// Prüft dabei die Lizenz (Poly Haven + ambientCG: ausschließlich CC0). Aufruf: node tools/assets/resolve.mjs
import { apiJSON, loadSources, log, SOURCES, writeJSON } from './lib/common.mjs';

const src = loadSources();
const PH = 'https://api.polyhaven.com';
const ACG = 'https://ambientcg.com/api/v2/full_json';

async function phInfo(id) { return apiJSON(`${PH}/info/${id}`, `ph_info_${id}.json`); }
async function acgInfo(id) {
  const j = await apiJSON(`${ACG}?id=${id}&include=tagData,dimensionsData,downloadData`, `acg_info_${id}.json`);
  const a = j.foundAssets?.[0];
  if (!a) throw new Error('ambientCG: nicht gefunden ' + id);
  return a;
}

let changed = 0;
const all = [...src.textures, ...src.hdris, ...src.models];
for (const e of all) {
  try {
    if (e.source === 'polyhaven') {
      const info = await phInfo(e.sourceId);
      e.url = `https://polyhaven.com/a/${e.sourceId}`;
      e.author = Object.keys(info.authors || {}).join(', ');
      e.license = 'CC0-1.0';
      e.name = info.name;
      if (src.textures.includes(e) && info.dimensions) e.sizeM = info.dimensions.map((v) => +(v / 1000).toFixed(2));
      if (src.models.includes(e)) { e.polycount = info.polycount; e.dimensionsM = (info.dimensions || []).map((v) => +(v / 1000).toFixed(3)); }
    } else if (e.source === 'ambientcg') {
      const a = await acgInfo(e.sourceId);
      e.url = `https://ambientcg.com/view?id=${e.sourceId}`;
      e.author = 'Lennart Demes (ambientCG)';
      e.license = 'CC0-1.0';
      e.name = a.displayName;
      if (a.dimensionX && a.dimensionY) e.sizeM = [+(a.dimensionX / 100).toFixed(2), +(a.dimensionY / 100).toFixed(2)];
    } else if (e.source === 'derived') {
      const base = src.textures.find((t) => t.id === e.base);
      e.url = base?.url || '';
      e.author = `NULLPUNKT (prozedurales Tarnmuster, CC0) auf Basis von „${base?.name || e.base}“ von ${base?.author || '?'}`;
      e.license = 'CC0-1.0';
      e.name = e.id;
      if (base?.sizeM) e.sizeM = base.sizeM;
    }
    changed++;
  } catch (err) {
    log('FEHLER', e.id, err.message);
  }
}
writeJSON(SOURCES, src, 1);
log(`aufgelöst: ${changed}/${all.length}`);
