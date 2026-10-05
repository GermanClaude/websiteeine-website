// NULLPUNKT Asset-Pipeline — gemeinsame Hilfen (Pfade, Netz, JSON, Logging).
// Alle Skripte laufen mit Node ≥ 20; npm-Abhängigkeiten liegen außerhalb des Repos in tools/out/npm
// (siehe tools/assets/setup.sh) und werden über den Symlink tools/assets/node_modules gefunden.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const TOOLS = join(ROOT, 'tools/assets');
export const CACHE = join(ROOT, 'tools/out/assets-cache');   // gitignored: Rohdaten, API-Antworten
export const SRC = join(CACHE, 'src');
export const OUT = join(ROOT, 'assets/lib');                  // ausgelieferte Bibliothek
export const META = join(TOOLS, 'build-meta');                 // Build-Ergebnisse je Asset (klein, versioniert)
export const SOURCES = join(TOOLS, 'sources.json');

/** Version der Verarbeitung — erhöhen, wenn sich Ausgaben ändern sollen (erzwingt Neubau). */
export const PIPELINE_VERSION = 3;

export const TIER_NAMES = { 512: 'low', 1024: 'medium/high', 2048: 'ultra' };

export function ensureDir(d) { mkdirSync(d, { recursive: true }); return d; }
export function readJSON(f, fallback) {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
}
export function writeJSON(f, data, pretty = 2) {
  ensureDir(dirname(f));
  const tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, pretty) + '\n');
  renameSync(tmp, f);
}
export function writeFileAtomic(f, buf) {
  ensureDir(dirname(f));
  const tmp = f + '.tmp';
  writeFileSync(tmp, buf);
  renameSync(tmp, f);
}
export const fileSize = (f) => { try { return statSync(f).size; } catch { return 0; } };
export const hash = (obj) => createHash('sha1').update(typeof obj === 'string' ? obj : JSON.stringify(obj)).digest('hex').slice(0, 12);
export const rel = (f) => f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f;

const t0 = Date.now();
export function log(...a) { console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a); }

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch mit Wiederholung (Proxy setzt gelegentlich Verbindungen zurück). */
export async function fetchRetry(url, { tries = 5, as = 'buffer' } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      if (as === 'json') return await r.json();
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      last = e;
      await sleep(800 * (i + 1));
    }
  }
  throw last;
}

/** Download in den Cache (einmalig). → Pfad */
export async function download(url, file, { md5 } = {}) {
  if (existsSync(file) && fileSize(file) > 0) return file;
  const buf = await fetchRetry(url);
  if (md5) {
    const got = createHash('md5').update(buf).digest('hex');
    if (got !== md5) throw new Error(`md5 mismatch ${url}: ${got} != ${md5}`);
  }
  writeFileAtomic(file, buf);
  return file;
}

/** API-Antworten cachen (Poly Haven / ambientCG). */
export async function apiJSON(url, cacheName) {
  const f = join(CACHE, 'api', cacheName);
  if (existsSync(f)) return readJSON(f);
  const j = await fetchRetry(url, { as: 'json' });
  writeJSON(f, j, 0);
  return j;
}

export function loadSources() { return readJSON(SOURCES); }

/** Kommandozeile: --key=value / --flag / Positionsargumente */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) { const [k, ...v] = a.slice(2).split('='); opts[k] = v.length ? v.join('=') : true; }
    else opts._.push(a);
  }
  return opts;
}

/** Einfacher Job-Pool für async-Aufgaben. */
export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; results[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  return results;
}

/** Bytes hübsch. */
export const fmtBytes = (b) => b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(0) + ' KB';

/**
 * GPU-Speicher einer KTX2-Textur schätzen (inkl. Mip-Kette ×4/3).
 * loader.js transkodiert ETC1S auf dem Desktop nach BC1 (0,5 B/px; BC7 ist abgeschaltet, ETC1S gewinnt dadurch keine
 * Qualität) bzw. mit Alpha nach BC3 (1 B/px); mobil nach ETC1/ETC2 (0,5 B/px) bzw. ETC2-RGBA/ASTC (1 B/px).
 * UASTC → BC7/ASTC/ETC2-RGBA (1 B/px). rgba8: Rückfall ohne Kompressionsformat (4 B/px).
 */
export function gpuBytes(w, h, { codec = 'etc1s', alpha = false, mips = true } = {}) {
  const m = mips ? 4 / 3 : 1;
  const px = w * h * m;
  const bpp = codec === 'etc1s' && !alpha ? 0.5 : 1;
  return { desktop: Math.round(px * bpp), mobile: Math.round(px * bpp), rgba8: Math.round(px * 4) };
}
export function addGpu(a, b) { return { desktop: a.desktop + b.desktop, mobile: a.mobile + b.mobile, rgba8: a.rgba8 + b.rgba8 }; }
export const GPU0 = () => ({ desktop: 0, mobile: 0, rgba8: 0 });
