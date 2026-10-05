// Erzeugt die <link rel="modulepreload">-Liste in spielen.html aus dem Importgraphen des Spiels.
//
// Ohne Build-Schritt entdeckt der Browser Module erst, wenn er das importierende Modul geladen und geparst
// hat – bei ~140 Modulen sind das über ein Dutzend Netz-Rundläufe bis zur Lobby. Mit modulepreload holt
// er alle parallel. Erfasst werden: statische Importe ab assets/js/game/main.js, die dynamisch vor der
// Lobby geladenen Subsysteme (Tabelle MODULES in main.js) und deren statische Importe. Kartenmodule
// (erst beim Matchstart) und Worker bleiben außen vor.
//
// Aufruf: node tools/preload.mjs          → schreibt spielen.html (zwischen den modulepreload-Markern)
//         node tools/preload.mjs --check  → Exit-Code 1, wenn die Liste veraltet ist oder Dateien fehlen
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, 'spielen.html');
const ENTRY = 'assets/js/game/main.js';
const IMPORT_MAP = { three: 'assets/vendor/three/three.module.min.js', 'three/addons/': 'assets/vendor/three/addons/' };
const START = '<!-- modulepreload:start – node tools/preload.mjs -->';
const END = '<!-- modulepreload:end -->';

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const STATIC_RES = [
  /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
  /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/g,
];

function resolveSpec(spec, fromFile) {
  if (spec === 'three') return IMPORT_MAP.three;
  if (spec.startsWith('three/addons/')) return IMPORT_MAP['three/addons/'] + spec.slice('three/addons/'.length);
  if (!spec.startsWith('.')) return null;
  return normalize(join(dirname(fromFile), spec)).split('\\').join('/');
}

function staticImports(file) {
  const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
  const out = [];
  for (const re of STATIC_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const r = resolveSpec(m[1], file);
      if (r) out.push(r);
    }
  }
  return out;
}

/** Subsysteme, die main.js vor der Lobby dynamisch lädt (MODULES-Tabelle: ['./pfad.js', [...]]). */
function mainDynamic() {
  const src = stripComments(readFileSync(join(ROOT, ENTRY), 'utf8'));
  const table = src.slice(src.indexOf('const MODULES'), src.indexOf('};', src.indexOf('const MODULES')));
  return [...table.matchAll(/\[\s*'(\.\/[^']+\.js)'\s*,/g)].map((m) => resolveSpec(m[1], ENTRY));
}

const order = [];
const seen = new Set();
const missing = [];
const queue = [ENTRY];
let dynamicAdded = false;
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!existsSync(join(ROOT, file))) { missing.push(file); continue; }
  order.push(file);
  for (const dep of staticImports(file)) if (!seen.has(dep)) queue.push(dep);
  if (!dynamicAdded) { dynamicAdded = true; for (const dep of mainDynamic()) if (!seen.has(dep)) queue.push(dep); }
}

const block = [START, ...order.map((f) => `  <link rel="modulepreload" href="${f}">`), `  ${END}`].join('\n');
const html = readFileSync(HTML, 'utf8');
let next;
if (html.includes(START) && html.includes(END)) {
  next = html.slice(0, html.indexOf(START)) + block + html.slice(html.indexOf(END) + END.length);
} else {
  const lines = html.split('\n');
  const idx = lines.findIndex((l) => l.includes('rel="modulepreload"'));
  if (idx < 0) throw new Error('spielen.html: kein modulepreload-Eintrag und keine Marker gefunden');
  const rest = lines.filter((l, i) => i < idx || !l.includes('rel="modulepreload"'));
  rest.splice(idx, 0, `  ${block}`);
  next = rest.join('\n');
}

const check = process.argv.includes('--check');
if (missing.length) console.error(`Fehlende Module: ${missing.map((f) => relative(ROOT, join(ROOT, f))).join(', ')}`);
if (check) {
  const stale = next !== html;
  console.log(stale ? 'modulepreload-Liste veraltet – node tools/preload.mjs ausführen.' : `modulepreload-Liste aktuell (${order.length} Module).`);
  process.exit(stale || missing.length ? 1 : 0);
}
if (next !== html) writeFileSync(HTML, next);
console.log(`${order.length} Module in spielen.html vorgeladen${next === html ? ' (unverändert)' : ''}.`);
if (missing.length) process.exit(1);
