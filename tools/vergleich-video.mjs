// Vergleichsbilder „Video-Vorlage ↔ Spiel“ (Grafik-Plan Etappe 0, docs/planung/grafik-vorlage-plan.md): rendert die
// Karten in dev/world.html aus Blickwinkeln wie im Gemini-Video und legt jedes Bild neben das passende Videobild.
// Aufruf (Server auf :8765):  node tools/vergleich-video.mjs [hafen-halle,werk-gasse,…] [--quality=high] [--tag=vorher]
// Ausgabe: tools/out/vergleich/<tag>-<name>.png (Spielbild) und tools/out/vergleich/<tag>-bogen.png (Video | Spiel je Zeile)
import { chromium, BASE } from './pw.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// name: [Karte, Videobild, x, y, z, Gierwinkel °, Neigung °, senkrechtes Sichtfeld °] (Gierwinkel 0 = Blick nach −z)
export const VIEWS = {
  'hafen-halle':     ['hafen', 'bild-0_3s', 2, 1.7, 3, -90, 2, 50],     // Lagerhalle 3 von der Rampe, Rolltore offen
  'hafen-container': ['hafen', 'bild-2_0s', -18, 1.7, 22, 0, 1, 50],    // Containergasse Richtung Kranplatz
  'werk-halle':      ['werk', 'bild-3_5s', 0, 1.7, 24, 0, 12, 55],      // Walzhalle: Laufstege, Kranbahn
  'werk-gasse':      ['werk', 'bild-6_5s', 26, 1.7, 22, 0, 2, 55],      // Gasse zwischen Halle und Kesselhaus
  'altstadt-platz':  ['altstadt', 'bild-7_8s', 0, 2.2, 15, 0, -2, 50],  // Brunnenplatz (Video: Third Person)
};
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
const only = (args.find((a) => !a.startsWith('--')) || Object.keys(VIEWS).join(',')).split(',');
const tag = String(opt.tag || 'vorher');
const quality = String(opt.quality || 'high');
const OUT = 'tools/out/vergleich';
const W = 1280, H = 720;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const done = [];
for (const name of only) {
  const v = VIEWS[name];
  if (!v) { console.error('unbekannt:', name); continue; }
  const [map, frame, x, y, z, yaw, pitch, fov] = v;
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.error(name, e.message));
  await page.goto(`${BASE}dev/world.html?map=${map}&quality=${quality}&debug=0&fov=${fov}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dev?.ready, null, { timeout: 300000 });
  await page.addStyleTag({ content: '#panel, #mini, #progress { display: none !important; }' });
  await page.evaluate(([x, y, z, yaw, pitch]) => {
    window.__dev.paused = true;
    window.__dev.setCam(x, y, z, (yaw * Math.PI) / 180, (pitch * Math.PI) / 180);
    window.__dev.render();
    window.__dev.render();
  }, [x, y, z, yaw, pitch]);
  await page.waitForTimeout(400);
  const file = `${OUT}/${tag}-${name}.png`;
  writeFileSync(file, await page.screenshot({ type: 'png', timeout: 180000 }));
  done.push([name, `docs/planung/vorlage-video/${frame}.jpg`, file]);
  console.log(name, '→', file);
  await page.close();
}
// Bogen: links Video, rechts Spiel (je 640 × 360), Beschriftung oben links
if (done.length) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 360 * done.length } });
  const b64 = (f) => readFileSync(f).toString('base64');
  const row = ([name, vid, game]) => `<div style="position:relative;height:360px">
    <img src="data:image/jpeg;base64,${b64(vid)}" style="width:640px;height:360px;object-fit:cover;float:left">
    <img src="data:image/png;base64,${b64(game)}" style="width:640px;height:360px;float:left">
    <span style="position:absolute;left:8px;top:6px;font:600 16px sans-serif;color:#fff;text-shadow:0 0 4px #000">${name}: Video | Spiel (${quality})</span></div>`;
  await page.setContent(`<body style="margin:0;background:#000">${done.map(row).join('')}</body>`);
  await page.screenshot({ path: `${OUT}/${tag}-bogen.png` });
  console.log('Bogen →', `${OUT}/${tag}-bogen.png`);
}
await browser.close();
