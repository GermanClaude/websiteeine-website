// Umrisse aus einem gerade gestellten Referenzfoto verfolgen (aus den M-17/P-9-Konturskripten verallgemeinert).
// node tools/ref/kontur.mjs <bild.png|jpg> <regeln.mjs> <ausgabe.json>   (Beispiel: tools/ref/regeln-m17-beispiel.mjs)
// regeln.mjs: export const PARTS = { NAME: { test: (x, y, L) => bool, tol: 1.3 }, … };
//             export const HOLES = { NAME: { seed: [x, y], box: [x0, y0, x1, y1], tol: 1.2, light: 200 }, … };
//   test bekommt Fotopixel x, y und L(x, y) = Helligkeit 0…255 (0,3 R + 0,59 G + 0,11 B); Funktionen müssen in sich
//   geschlossen sein (keine äußeren Variablen – sie werden als Text in den Browser gegeben).
// Ausgabe: { NAME: [[x, y], …] } in Fotopixeln (ganzzahlig), Außenumriss gegen den Uhrzeigersinn egal (sdPolygon ist richtungsfrei).
import { chromium } from '../pw.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [img, rules, out = 'kontur.json'] = process.argv.slice(2);
const R = await import(pathToFileURL(resolve(rules)).href);
const parts = Object.fromEntries(Object.entries(R.PARTS || {}).map(([k, v]) => [k, { test: v.test.toString(), tol: v.tol ?? 1.3 }]));
const holes = R.HOLES || {};
const mime = img.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent('<canvas id=c></canvas>');
const res = await p.evaluate(async ({ data, parts, holes }) => {
  const im = new Image(); im.src = data; await im.decode();
  const c = document.getElementById('c'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
  const L = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return 255; const i = ((y | 0) * W + (x | 0)) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };
  const S = 2, gw = Math.floor(W / S), gh = Math.floor(H / S);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function largest(m) {
    const lab = new Int32Array(gw * gh); let best = 0, bestN = 0, id = 0;
    for (let i = 0; i < gw * gh; i++) {
      if (!m[i] || lab[i]) continue;
      id++; let n = 0; const st = [i]; lab[i] = id;
      while (st.length) { const k = st.pop(); n++; const x = k % gw, y = (k / gw) | 0;
        for (const [dx, dy] of N4) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const kk = yy * gw + xx; if (m[kk] && !lab[kk]) { lab[kk] = id; st.push(kk); } } }
      if (n > bestN) { bestN = n; best = id; }
    }
    for (let i = 0; i < gw * gh; i++) m[i] = lab[i] === best ? 1 : 0;
    return m;
  }
  function fillHoles(m) {
    const o = new Uint8Array(gw * gh); const st = [0]; o[0] = 1;
    while (st.length) { const k = st.pop(); const x = k % gw, y = (k / gw) | 0;
      for (const [dx, dy] of N4) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const kk = yy * gw + xx; if (!m[kk] && !o[kk]) { o[kk] = 1; st.push(kk); } } }
    const r = new Uint8Array(gw * gh); for (let i = 0; i < gw * gh; i++) r[i] = o[i] ? 0 : 1; return r;
  }
  function trace(m) {   // Moore-Randverfolgung
    const at = (x, y) => (x >= 0 && y >= 0 && x < gw && y < gh ? m[y * gw + x] : 0);
    let sx = -1, sy = -1;
    outer: for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (m[y * gw + x]) { sx = x; sy = y; break outer; }
    if (sx < 0) return [];
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const pts = []; let x = sx, y = sy, dir = 7, guard = 0;
    do {
      pts.push([x * S + 1, y * S + 1]);
      const k = (dir + 6) % 8; let found = false;
      for (let t = 0; t < 8; t++) { const nd = (k + t) % 8, nx = x + dirs[nd][0], ny = y + dirs[nd][1]; if (at(nx, ny)) { x = nx; y = ny; dir = nd; found = true; break; } }
      if (!found) break;
    } while ((x !== sx || y !== sy) && ++guard < 400000);
    return pts;
  }
  function simplify(pts, tol) {
    if (pts.length < 4 || !tol) return pts;
    const rec = (a, b) => { let mx = 0, mi = -1; const [x1, y1] = pts[a], [x2, y2] = pts[b]; const l = Math.hypot(x2 - x1, y2 - y1) || 1;
      for (let i = a + 1; i < b; i++) { const dd = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / l; if (dd > mx) { mx = dd; mi = i; } }
      return mx > tol ? [...rec(a, mi).slice(0, -1), ...rec(mi, b)] : [pts[a], pts[b]]; };
    const h = pts.length >> 1; return [...rec(0, h).slice(0, -1), ...rec(h, pts.length - 1).slice(0, -1)];
  }
  const out = {};
  for (const [k, v] of Object.entries(parts)) {
    const test = new Function('return ' + v.test)();
    const m = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) m[y * gw + x] = test(x * S + 1, y * S + 1, L) ? 1 : 0;
    const pts = trace(fillHoles(largest(m)));
    out[k] = simplify(pts, v.tol).map(([x, y]) => [Math.round(x), Math.round(y)]);
  }
  for (const [k, v] of Object.entries(holes)) {     // helle Fläche um einen Saatpunkt im Rahmen fluten
    const m = new Uint8Array(gw * gh), [bx0, by0, bx1, by1] = v.box, light = v.light ?? 200;
    const st = [((v.seed[1] / S) | 0) * gw + ((v.seed[0] / S) | 0)];
    while (st.length) { const kk = st.pop(); if (kk < 0 || kk >= gw * gh || m[kk]) continue; const x = kk % gw, y = (kk / gw) | 0;
      if (x * S < bx0 || x * S > bx1 || y * S < by0 || y * S > by1 || L(x * S + 1, y * S + 1) < light) continue; m[kk] = 1;
      for (const [dx, dy] of N4) st.push((y + dy) * gw + x + dx); }
    out[k] = simplify(trace(m), v.tol ?? 1.2).map(([x, y]) => [Math.round(x), Math.round(y)]);
  }
  return { W, H, out };
}, { data: `data:image/${mime};base64,` + readFileSync(img).toString('base64'), parts, holes });
writeFileSync(out, JSON.stringify(res.out));
console.log('Bild', res.W, '×', res.H);
for (const [k, v] of Object.entries(res.out)) console.log(k.padEnd(14), v.length, 'Punkte');
await b.close();
