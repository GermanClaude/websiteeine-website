// Wetter × Tageszeit-Bogen: rendert eine Karte aus einem Blickwinkel in allen Tageszeiten (Spalten) und Wetterlagen
// (Zeilen) über dev/post.html (echte Bildkette). Server auf :8765.
// node tools/wetter-matrix.mjs <karte> x,y,z,gier,neigung [--quality=high] [--tag=a] [--times=…] [--weathers=…]
// Ausgabe: tools/out/wetter/<tag>-<karte>.png (+ Einzelbilder)
import { chromium, BASE } from './pw.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
const [map, camS] = args.filter((a) => !a.startsWith('--'));
const [x, y, z, yaw, pitch] = camS.split(',').map((s, i) => (i === 1 && s.startsWith('g') ? s : Number(s)));
const times = String(opt.times || 'morgen,vormittag,mittag,nachmittag,abend').split(',');
const weathers = String(opt.weathers || 'klar,dunst,morgennebel,bewoelkt').split(',');
const quality = String(opt.quality || 'high'), tag = String(opt.tag || 'a'), OUT = 'tools/out/wetter';
const W = 640, H = 360;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const cells = [];
for (const w of weathers) for (const t of times) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.error(w, t, e.message));
  await page.goto(`${BASE}dev/post.html?map=${map}&quality=${quality}&debug=0&fov=60&weather=${w}&tod=${t}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dev?.ready, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#panel, #mini, #progress, #marks, .xh { display: none !important; }' });
  await page.evaluate(() => { for (const id of ['b-marks', 'b-vm']) document.getElementById(id)?.click(); });
  await page.evaluate(([x, y, z, yaw, pitch]) => {
    window.__dev.paused = true;
    if (typeof y === 'string') y = (window.__dev.world.groundHeight(x, z, 400) ?? 0) + Number(y.slice(1));
    window.__dev.setCam(x, y, z, (yaw * Math.PI) / 180, (pitch * Math.PI) / 180);
    window.__dev.R.exposure.reset();
    for (let i = 0; i < 4; i++) window.__dev.render();
  }, [x, y, z, yaw, pitch]);
  await page.waitForTimeout(300);
  const file = `${OUT}/${tag}-${map}-${w}-${t}.png`;
  await page.screenshot({ path: file, type: 'png', timeout: 180000 });
  cells.push([w, t, file]);
  console.log(w, t);
  await page.close();
}
const page = await browser.newPage({ viewport: { width: W * times.length / 2, height: (H / 2) * weathers.length } });
const b64 = (f) => readFileSync(f).toString('base64');
await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${times.length},${W / 2}px)">${cells.map(([w, t, f]) => `<div style="position:relative;width:${W / 2}px;height:${H / 2}px"><img src="data:image/png;base64,${b64(f)}" style="width:100%;height:100%"><span style="position:absolute;left:4px;top:2px;font:600 11px sans-serif;color:#fff;text-shadow:0 0 3px #000">${t} · ${w}</span></div>`).join('')}</body>`);
await page.screenshot({ path: `${OUT}/${tag}-${map}.png` });
console.log('→', `${OUT}/${tag}-${map}.png`);
await browser.close();
