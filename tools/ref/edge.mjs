// Ober-/Unterkanten dunkler Läufe je Spalte (Endpunkte für die Kalibrierung auf ±1 px):
// node tools/ref/edge.mjs <bild> <x0> <x1> <schritt> <y0> <y1> [schwelle=200]  → je Spalte „x: y0-y1 …“
import { chromium } from '../pw.mjs';
import { readFileSync } from 'node:fs';
const [f, x0, x1, st, y0, y1, thr = 200] = process.argv.slice(2);
if (!f || y1 === undefined) { console.log('Aufruf: node tools/ref/edge.mjs <bild> x0 x1 schritt y0 y1 [schwelle]'); process.exit(1); }
const mime = f.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent('<canvas id=c></canvas>');
const r = await p.evaluate(async ([data, x0, x1, st, y0, y1, thr]) => {
  const img = new Image(); img.src = data; await img.decode();
  const c = document.getElementById('c'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width;
  const L = (x, y) => { const i = (y * W + x) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };
  const out = [];
  for (let x = x0; x <= x1; x += st) {
    const runs = []; let inR = false, s = 0;
    for (let y = y0; y <= y1; y++) { const k = L(x, y) < thr; if (k && !inR) { inR = true; s = y; } if (!k && inR) { inR = false; runs.push([s, y - 1]); } }
    if (inR) runs.push([s, y1]);
    out.push(x + ': ' + runs.filter((q) => q[1] - q[0] > 2).map((q) => q.join('-')).join(' '));
  }
  return [img.width, img.height, out.join('\n')];
}, [`data:image/${mime};base64,` + readFileSync(f).toString('base64'), +x0, +x1, +st, +y0, +y1, +thr]);
console.log('Bild', r[0], '×', r[1]); console.log(r[2]);
await b.close();
