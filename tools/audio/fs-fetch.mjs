// Freesound: Metadaten (Lizenz, Beschreibung, Tags, Originalformat) je Klang + HQ-Vorschau (Ogg Vorbis ~192 kbit/s,
// gleiche Lizenz wie das Original; ohne Konto abrufbar). Aufruf: node tools/audio/fs-fetch.mjs <id> [<id> …]
// IDs müssen in tools/out/audio/candidates.json stehen (fs-search.mjs). Ergebnis: tools/out/audio/raw/fs_<id>.ogg,
// tools/out/audio/meta/<id>.json. Bricht ab, wenn die Lizenz nicht CC0 oder CC-BY ist.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'tools/out/audio');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) NULLPUNKT-audio-research';
const cand = JSON.parse(readFileSync(resolve(OUT, 'candidates.json'), 'utf8'));
mkdirSync(resolve(OUT, 'raw'), { recursive: true }); mkdirSync(resolve(OUT, 'meta'), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').trim();
const curl = (args) => execFileSync('curl', ['-sS', '-L', '--fail', '--max-time', '60', '-A', UA, ...args], { maxBuffer: 64 << 20 });

const LICENSES = {
  'publicdomain/zero/1.0': { id: 'CC0-1.0', ok: true },
  'licenses/by/4.0': { id: 'CC-BY-4.0', ok: true, attribution: true },
  'licenses/by/3.0': { id: 'CC-BY-3.0', ok: true, attribution: true },
};
for (const id of process.argv.slice(2)) {
  const c = cand[id];
  if (!c) { console.error(`${id}: nicht in candidates.json`); continue; }
  const metaPath = resolve(OUT, 'meta', `${id}.json`), rawPath = resolve(OUT, 'raw', `fs_${id}.ogg`);
  if (existsSync(metaPath) && existsSync(rawPath)) { console.log(`${id}: vorhanden`); continue; }
  const html = curl([c.page]).toString('utf8');
  const licUrl = (html.match(/title="Go to the full license text" href="([^"]+)"/) || [])[1] || '';
  const key = Object.keys(LICENSES).find(k => licUrl.includes(k));
  const lic = key ? LICENSES[key] : { id: `UNBEKANNT (${licUrl})`, ok: false };
  const desc = strip((html.match(/<div id="soundDescriptionSection">([\s\S]*?)<\/div>/) || [])[1] || '');
  const tags = [...html.matchAll(/href="\/browse\/tags\/([^/"]+)\/"/g)].map(m => decodeURIComponent(m[1]));
  const field = (name) => strip((html.match(new RegExp(`${name}</p>\\s*<p class="no-margins">([^<]*)</p>`)) || [])[1] || '');
  const remix = /remix of|sources of this sound|class="bw-sound-page__sources"/i.test(html) ? 'prüfen' : '';
  const meta = {
    ...c, licenseUrl: licUrl, license: lic.id, licenseOk: lic.ok, attributionRequired: !!lic.attribution,
    description: desc.slice(0, 1200), tags: [...new Set(tags)].slice(0, 30),
    original: { type: field('Type'), duration: field('Duration'), size: field('File size'), sampleRate: field('Sample rate'), bitDepth: field('Bit depth'), channels: field('Channels') },
    remixNote: remix, fetched: new Date().toISOString().slice(0, 10),
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  if (!lic.ok) { console.error(`${id}: Lizenz ${lic.id} → übersprungen`); await sleep(1200); continue; }
  writeFileSync(rawPath, curl([c.preview]));
  console.log(`${id}: ${lic.id} ${meta.original.type} ${meta.original.sampleRate} ${meta.original.channels} — ${c.user} — ${c.title} | ${desc.slice(0, 140).replace(/\n/g, ' ')}`);
  await sleep(1200);
}
