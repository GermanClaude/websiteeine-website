// NULLPUNKT — hängt beim Veröffentlichen an jede eigene Moduladresse „?v=<Fassung>“ an.
// So holt jeder Browser nach einem Update die neuen Dateien, statt alte und neue Module aus dem Cache zu mischen.
// Erfasst: statische/dynamische Importe und Re-Exporte, new URL('…js', import.meta.url) (Worker), Pfadlisten wie
// MODULES in main.js sowie modulepreload-/Skript-Adressen in den HTML-Seiten (assets/js und assets/lib). assets/vendor (three.js) bleibt
// unverändert, weil sich diese Dateien nie ändern und die Importmap sie über den bloßen Namen „three“ auflöst.
// Aufruf: node tools/stamp.mjs <Zielordner> <Fassung>
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const [dst, build] = process.argv.slice(2);
if (!dst || !/^[\w.-]+$/.test(build || '')) { console.error('Aufruf: node tools/stamp.mjs <Zielordner> <Fassung>'); process.exit(1); }
const root = resolve(dst);
const roots = [join(root, 'assets', 'js'), join(root, 'assets', 'lib')];
const tag = `?v=${build}`;

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});
const inRoots = (abs) => roots.some((r) => abs.startsWith(r + sep));
const ownModule = (abs) => inRoots(abs) && abs.endsWith('.js') && existsSync(abs);

let files = 0, refs = 0;
const missing = [];
for (const file of roots.filter((r) => existsSync(r)).flatMap(walk)) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(/(['"`])(\.{1,2}\/[^'"`\s$?#]*?\.js)\1/g, (m, q, rel) => {
    const abs = resolve(dirname(file), rel);
    if (!ownModule(abs)) {
      if (inRoots(abs)) missing.push(`${relative(root, file)} → ${rel}`);
      return m;
    }
    refs++;
    return `${q}${rel}${tag}${q}`;
  });
  if (out !== src) { writeFileSync(file, out); files++; }
}

for (const page of ['index.html', 'spielen.html', '404.html']) {
  const file = join(root, page);
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  const out = src.replace(/\b(href|src)="(assets\/(?:js|lib)\/[^"?#]+\.js)"/g, (m, attr, rel) => {
    if (!ownModule(resolve(root, rel))) { missing.push(`${page} → ${rel}`); return m; }
    refs++;
    return `${attr}="${rel}${tag}"`;
  });
  if (out !== src) { writeFileSync(file, out); files++; }
}

if (missing.length) {
  console.error(`Verweise auf fehlende Module:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`Fassung ${build}: ${refs} Moduladressen in ${files} Dateien gestempelt`);
