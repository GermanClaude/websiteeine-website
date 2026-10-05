// HDRI-Kandidaten prüfen (Sonnenhöhe/Dominanz, Himmelshelligkeit) vor der Aufnahme in sources.json:
// node tools/assets/hdri-probe.mjs <polyhaven-id…>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { download, ensureDir, CACHE } from './lib/common.mjs';
import { phFiles } from './lib/sources.mjs';
import { analyze, readHDR } from './lib/hdr.mjs';
for (const id of process.argv.slice(2)) {
  const f = (await phFiles(id)).hdri['1k'].hdr;
  const p = await download(f.url, join(ensureDir(join(CACHE, 'probe')), id + '_1k.hdr'));
  const a = analyze(readHDR(readFileSync(p)));
  console.log(id.padEnd(28), 'elev', a.sun.elevationDeg, 'dom', a.sun.dominance, 'peak', a.sun.peak, 'sky', a.skyLuminance);
}
