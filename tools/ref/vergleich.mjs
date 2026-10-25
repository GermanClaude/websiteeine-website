// Modell gegen Referenzfoto: gleiche Ansicht, gleicher Maßstab (Fotostudio, waffen-bauanleitung.md 1.6).
// node tools/ref/vergleich.mjs <modell-key> <foto (gerade gestellt)> <ref-modul.js> <x0> <y0> <breite> <höhe> [maßstab=0.5] [tag]
//   Ausschnitt x0,y0,breite,höhe in Fotopixeln; das Ref-Modul liefert PPM, U(x), V(y) (Foto → Modell).
//   Ergebnis: <tag>-render.png, <tag>-pair.png (oben Foto, unten Modell), <tag>-blend.png (50 % überblendet) im aktuellen Ordner.
//   Server muss laufen (NP_BASE, Standard http://localhost:8765/). TIER=max|std|lite|third wählt die Detailstufe
//   (ohne: am PC die volle Fassung).
import { chromium, BASE, GL_ARGS } from '../pw.mjs';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [key, foto, refPath, X0, Y0, CW, CH, S = '0.5', tag = 'vergleich'] = process.argv.slice(2);
const R = await import(pathToFileURL(resolve(refPath)).href);
const x0 = +X0, y0 = +Y0, cw = +CW, ch = +CH, s = +S, d = 4;
const W = Math.round(cw * s), H = Math.round(ch * s);
const fov = 2 * Math.atan(H / (R.PPM * s) / 2 / d) * 180 / Math.PI;
const mu = R.U(x0 + cw / 2), mv = R.V(y0 + ch / 2);
const yaw = R.U(x0 + 1) > R.U(x0) ? 90 : -90;          // Mündung rechts → rechte Seite
const tier = process.env.TIER ? `&tier=${process.env.TIER}` : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ args: GL_ARGS });
const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto(`${BASE}dev/fotostudio.html?model=${key}&yaw=${yaw}&pitch=0&dist=${d}&fov=${fov}&w=${W}&h=${H}&bg=ffffff&floor=0&mu=${mu}&mv=${mv}&env=1.2${tier}`);
for (let i = 0; i < 400; i++) { if (await p.evaluate(() => !!(window.__studio && window.__studio.ready)).catch(() => false)) break; await sleep(500); }
await sleep(1000);
await p.screenshot({ path: `${tag}-render.png` });
await b.close();
const mime = foto.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
const src = `data:image/${mime};base64,${readFileSync(foto).toString('base64')}`, ren = `data:image/png;base64,${readFileSync(`${tag}-render.png`).toString('base64')}`;
const b2 = await chromium.launch();
const q = await b2.newPage({ viewport: { width: W, height: H * 2 } });
const bg = (extra = '') => `<div style="${extra}width:${W}px;height:${H}px;background:url(${src}) -${x0 * s}px -${y0 * s}px / auto no-repeat;background-size:var(--bs)"></div>`;
const sizeJs = (f) => `(()=>{const i=new Image();i.src='${src}';i.decode().then(()=>{document.documentElement.style.setProperty('--bs', (i.width*${s})+'px auto');window.${f}=1;});})()`;
await q.setContent(`<body style="margin:0;background:#fff">${bg()}<img src="${ren}" style="display:block"><script>${sizeJs('ok1')}</script></body>`);
await q.waitForFunction(() => window.ok1);
await q.screenshot({ path: `${tag}-pair.png` });
await q.setViewportSize({ width: W, height: H });
await q.setContent(`<body style="margin:0;position:relative">${bg('position:absolute;')}<img src="${ren}" style="position:absolute;opacity:.5"><script>${sizeJs('ok2')}</script></body>`);
await q.waitForFunction(() => window.ok2);
await q.screenshot({ path: `${tag}-blend.png` });
await b2.close();
console.log('ok', `${tag}-render.png`, `${tag}-pair.png`, `${tag}-blend.png`, { W, H, fov: +fov.toFixed(3), mu: +mu.toFixed(4), mv: +mv.toFixed(4), yaw });
