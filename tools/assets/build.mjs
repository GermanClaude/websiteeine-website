// Baut die ganze Bibliothek: Texturen → HDRIs → Modelle → Manifest + CREDITS.md.
// Jede Einheit läuft als eigener Kindprozess (der WASM-Encoder ist einfädig); --jobs=N parallel (Standard 2).
// Bereits aktuelle Assets (gleiches Rezept, Dateien vorhanden) werden übersprungen; --force baut neu.
// Aufruf: node tools/assets/build.mjs [--jobs=2] [--only=textures|hdris|models] [--force] [ids…]
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadSources, log, parseArgs, pool, TOOLS } from './lib/common.mjs';

const args = parseArgs();
const jobs = Number(args.jobs || 2);
const src = loadSources();
const want = (id) => !args._.length || args._.includes(id);
const only = args.only ? String(args.only).split(',') : ['textures', 'hdris', 'models'];

function run(script, ids) {
  return new Promise((resolve) => {
    // nice: der Rechner ist geteilt — Kodierung mit niedriger Priorität
    const p = spawn('nice', ['-n', '10', process.execPath, join(TOOLS, script), ...ids, ...(args.force ? ['--force'] : [])], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => resolve(code));
  });
}

let failed = 0;
const step = async (script, ids) => {
  const codes = await pool(ids, jobs, (id) => run(script, [id]));
  failed += codes.filter((c) => c !== 0).length;
};

if (only.includes('textures')) {
  const base = src.textures.filter((t) => t.source !== 'derived' && want(t.id)).map((t) => t.id);
  const derived = src.textures.filter((t) => t.source === 'derived' && want(t.id)).map((t) => t.id);
  // Helden (2048) zuerst, damit lange Läufe früh beginnen
  base.sort((a, b) => Math.max(...src.textures.find((t) => t.id === b).tiers) - Math.max(...src.textures.find((t) => t.id === a).tiers));
  log(`Texturen: ${base.length} + ${derived.length} abgeleitet`);
  await step('textures.mjs', base);
  await step('textures.mjs', derived);
}
if (only.includes('hdris')) {
  const ids = src.hdris.filter((h) => want(h.id)).map((h) => h.id);
  log(`HDRIs: ${ids.length}`);
  await step('hdri.mjs', ids);
}
if (only.includes('models')) {
  const ids = src.models.filter((m) => want(m.id)).map((m) => m.id);
  log(`Modelle: ${ids.length}`);
  await step('models.mjs', ids);
}
log('Manifest …');
await run('manifest.mjs', []);
log(failed ? `fertig mit ${failed} Fehlern` : 'fertig');
process.exitCode = failed ? 1 : 0;
