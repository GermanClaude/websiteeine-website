// Freesound-Suche ohne Konto (HTML-Suchseite, nur Lizenzfilter CC0) → Kandidatenliste.
// Aufruf: node tools/audio/fs-search.mjs "<query>" [maxDauer=8] [seiten=1] [sort=downloads|rating]
// Schreibt/ergänzt tools/out/audio/candidates.json (id → Metadaten). Höflich: 1,5 s Pause je Anfrage.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'tools/out/audio/candidates.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) NULLPUNKT-audio-research';
const [q, maxDur = '8', pages = '1', sort = 'downloads', lic = 'cc0'] = process.argv.slice(2);
if (!q) { console.error('query fehlt'); process.exit(1); }
const SORT = { downloads: 'Downloads (most first)', rating: 'Rating (highest first)', relevance: 'Automatic by relevance' }[sort] || sort;
const LIC = lic === 'by' ? '"Attribution"' : '"Creative Commons 0"';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const attr = (blk, k) => (blk.match(new RegExp(`data-${k}="([^"]*)"`)) || [])[1];
const dec = s => s?.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

mkdirSync(dirname(OUT), { recursive: true });
const db = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
let added = 0; const rows = [];
for (let p = 1; p <= +pages; p++) {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=${encodeURIComponent(`license:${LIC} duration:[0 TO ${maxDur}]`)}&s=${encodeURIComponent(SORT)}&page=${p}`;
  const html = execFileSync('curl', ['-sS', '-L', '--max-time', '40', '-A', UA, url], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const parts = html.split('class="bw-search__result"').slice(1);
  for (const blk of parts) {
    const id = attr(blk, 'sound-id'); if (!id) continue;
    const license = (blk.match(/title="License: ([^"]+)"/) || [])[1] || '?';
    const r = {
      id: +id, user: attr(blk, 'username'), userId: +attr(blk, 'user-id'), title: dec(attr(blk, 'title')),
      duration: +attr(blk, 'duration'), sr: +attr(blk, 'samplerate'), downloads: +attr(blk, 'num-downloads'),
      rating: +((blk.match(/Average rating of ([\d.]+)/) || [])[1] || 0), license,
      page: `https://freesound.org/people/${attr(blk, 'username')}/sounds/${id}/`,
      preview: attr(blk, 'mp3')?.replace('-lq.mp3', '-hq.ogg'), query: q,
    };
    rows.push(r);
    if (!db[id]) { db[id] = r; added++; }
  }
  if (parts.length < 10) break;
  await sleep(1500);
}
writeFileSync(OUT, JSON.stringify(db, null, 1));
for (const r of rows) console.log(`${String(r.id).padStart(7)} ${r.duration.toFixed(2).padStart(6)}s ${String(r.downloads).padStart(6)}dl ★${r.rating.toFixed(1)} ${r.license.padEnd(20)} ${r.user} — ${r.title}`);
console.error(`${rows.length} Treffer, ${added} neu, gesamt ${Object.keys(db).length}`);
