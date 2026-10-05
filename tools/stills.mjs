// Standbilder der Karten für die Website („Durchblick“, §03): rendert jede Karte in dev/world.html
// aus einer festen Kamera und speichert WebP (≈ 60 KB) unter assets/img/maps/<id>.webp (+ <id>-s.webp, halbe Breite).
// Aufruf (Server auf :8765):  node tools/stills.mjs [hafen,altstadt,…] [--try]   (--try: nur PNG-Vorschau in tools/out/)
import { chromium, BASE } from './pw.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

// Kamera je Karte: [x, y, z, Gierwinkel °, Neigung °, senkrechtes Sichtfeld °] (Gierwinkel 0 = Blick nach −z)
export const CAMS = {
  hafen: [-15, 9, 47, 0, -10, 40],
  altstadt: [-6, 11, 46, 0, -12, 40],
  werk: [-38, 8, 46, 10, -8, 40],
  range: [0, 4, 26, 0, -5, 40],
};
const W = 1600;
const H = 600;
const args = process.argv.slice(2);
const only = (args.find((a) => !a.startsWith('--')) || Object.keys(CAMS).join(',')).split(',');
const tryMode = args.includes('--try');
const camArg = args.find((a) => a.startsWith('--cam='));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
mkdirSync('assets/img/maps', { recursive: true });
for (const id of only) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.error(id, e.message));
  const cam = camArg ? camArg.slice(6).split(',').map(Number) : CAMS[id];
  await page.goto(`${BASE}dev/world.html?map=${id}&quality=high&debug=0&fov=${cam[5] || 40}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dev?.ready, null, { timeout: 240000 });
  await page.addStyleTag({ content: '#panel, #mini, #progress { display: none !important; }' });
  await page.evaluate(([x, y, z, yaw, pitch]) => {
    window.__dev.paused = true;
    window.__dev.setCam(x, y, z, (yaw * Math.PI) / 180, (pitch * Math.PI) / 180);
    window.__dev.render();
    window.__dev.render();
  }, cam);
  await page.waitForTimeout(400);
  const png = await page.screenshot({ type: 'png', timeout: 180000 });
  if (tryMode) { writeFileSync(`tools/out/still-${id}${camArg ? `-${cam.join('_')}` : ''}.png`, png); console.log(id, 'Vorschau', cam.join(',')); await page.close(); continue; }
  // WebP über den Browser-Encoder (kein Werkzeug nötig); Qualität so wählen, dass ≈ 60 KB herauskommen
  const out = await page.evaluate(async ({ b64, W, H }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const enc = (w, h, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); return c.toDataURL('image/webp', q); };
    let q = 0.72;
    let big = enc(W, H, q);
    while (big.length * 0.75 > 64000 && q > 0.3) { q -= 0.06; big = enc(W, H, q); }
    const small = enc(W / 2, H / 2, Math.min(0.8, q + 0.08));
    return { big: big.split(',')[1], small: small.split(',')[1], q };
  }, { b64: png.toString('base64'), W, H });
  writeFileSync(`assets/img/maps/${id}.webp`, Buffer.from(out.big, 'base64'));
  writeFileSync(`assets/img/maps/${id}-s.webp`, Buffer.from(out.small, 'base64'));
  console.log(id, `q=${out.q.toFixed(2)}`, Math.round(Buffer.from(out.big, 'base64').length / 1024), 'KB +', Math.round(Buffer.from(out.small, 'base64').length / 1024), 'KB');
  await page.close();
}
await browser.close();
