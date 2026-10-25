// Referenzfoto gerade stellen: node tools/ref/rotimg.mjs <in.jpg|png> <out.png> <grad>
// Grad gegen den Uhrzeigersinn positiv; der an einer langen geraden Kante gemessene Winkel
// deg = atan2(y2 − y1, x2 − x1) · 180/π stellt sie waagrecht (waffen-bauanleitung.md 1.2). Rand weiß.
import { chromium } from '../pw.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [f, out, deg] = process.argv.slice(2);
if (!f || !out || deg === undefined) { console.log('Aufruf: node tools/ref/rotimg.mjs <in> <out.png> <grad>'); process.exit(1); }
const mime = f.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent('<canvas id=c></canvas>');
const url = await p.evaluate(async ([data, deg]) => {
  const img = new Image(); img.src = data; await img.decode();
  const a = -deg * Math.PI / 180, W = img.width, H = img.height;
  const nw = Math.ceil(Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))), nh = Math.ceil(Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a)));
  const c = document.getElementById('c'); c.width = nw; c.height = nh;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, nw, nh);
  g.imageSmoothingQuality = 'high';
  g.translate(nw / 2, nh / 2); g.rotate(a); g.drawImage(img, -W / 2, -H / 2);
  return c.toDataURL('image/png');
}, [`data:image/${mime};base64,` + readFileSync(f).toString('base64'), +deg]);
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('ok', out);
await b.close();
