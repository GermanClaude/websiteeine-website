// Ausschnitt vergrößern (Kleinteile, Kanten ablesen): node tools/ref/crop.mjs <in> <out.png> <x> <y> <breite> <höhe> [maßstab=2]
import { chromium } from '../pw.mjs';
import { readFileSync } from 'node:fs';
const [f, out, x, y, w, h, s = 2] = process.argv.slice(2);
if (!f || !out || h === undefined) { console.log('Aufruf: node tools/ref/crop.mjs <in> <out.png> x y w h [s]'); process.exit(1); }
const mime = f.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Math.round(w * s), height: Math.round(h * s) } });
await p.setContent('<body style="margin:0;overflow:hidden"></body>');
await p.evaluate(async ([x, y, w, h, s, src]) => {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(img, x, y, w, h, 0, 0, w * s, h * s); document.body.appendChild(c);
}, [+x, +y, +w, +h, +s, `data:image/${mime};base64,${readFileSync(f).toString('base64')}`]);
await p.screenshot({ path: out });
console.log('ok', out);
await b.close();
