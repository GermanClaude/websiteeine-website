// Umrisse (Fotopixel) farbig über das Referenzfoto zeichnen – Kontrolle der Konturen.
// node tools/ref/ueberlagern.mjs <foto> <polygone.json | ref-modul.js> <out.png> [x0 y0 breite höhe maßstab]
//   ref-modul.js: alle exportierten Listen der Form [[x, y], …] (≥ 3 Punkte) werden gezeichnet.
import { chromium } from '../pw.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [foto, quelle, out, cx = 0, cy = 0, cw = 0, ch = 0, s = 0.5] = process.argv.slice(2);
let P;
if (quelle.endsWith('.json')) P = JSON.parse(readFileSync(quelle, 'utf8'));
else { const m = await import(pathToFileURL(resolve(quelle)).href); P = Object.fromEntries(Object.entries(m).filter(([, v]) => Array.isArray(v) && v.length >= 3 && Array.isArray(v[0]) && v[0].length === 2)); }
const mime = foto.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 300 } });
await p.setContent('<body style=margin:0><canvas id=c></canvas></body>');
const size = await p.evaluate(async ([src, P, cx, cy, cw, ch, s]) => {
  const img = new Image(); img.src = src; await img.decode();
  cw = cw || img.width; ch = ch || img.height;
  const c = document.getElementById('c'); c.width = Math.round(cw * s); c.height = Math.round(ch * s);
  const g = c.getContext('2d'); g.drawImage(img, cx, cy, cw, ch, 0, 0, cw * s, ch * s);
  const cols = ['#f00', '#0a0', '#00f', '#f0f', '#fa0', '#0aa', '#a50', '#08f', '#f08', '#880', '#408', '#0f0'];
  g.font = 'bold 14px Arial'; g.lineWidth = 1.5;
  Object.entries(P).forEach(([k, pl], i) => {
    g.strokeStyle = g.fillStyle = cols[i % cols.length]; g.beginPath();
    pl.forEach(([x, y], n) => { const X = (x - cx) * s, Y = (y - cy) * s; n ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.closePath(); g.stroke(); g.fillText(k, (pl[0][0] - cx) * s + 3, (pl[0][1] - cy) * s - 3);
  });
  return [c.width, c.height];
}, [`data:image/${mime};base64,` + readFileSync(foto).toString('base64'), P, +cx, +cy, +cw, +ch, +s]);
await p.setViewportSize({ width: size[0], height: size[1] });
await p.screenshot({ path: out });
await b.close();
console.log('ok', out, size.join('×'));
