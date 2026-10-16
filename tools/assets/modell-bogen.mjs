// Sichtprüfung eigener Modelle: dev/assets.html je Modell (Stufe 1024, eigener Himmel) → Bogen.
// node tools/assets/modell-bogen.mjs id1,id2,… [out.png]   (Server auf :8765)
import { chromium, BASE, GL_ARGS } from '../pw.mjs';
const ids = (process.argv[2] || '').split(',').filter(Boolean);
const out = process.argv[3] || 'tools/out/modell-bogen.png';
const browser = await chromium.launch({ args: GL_ARGS });
const shots = [];
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
  page.on('pageerror', (e) => console.error(id, e.message));
  await page.goto(`${BASE}dev/assets.html?tab=models&id=${id}&tier=1024&hdri=np_sky_nachmittag_klar&ui=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__assets?.ready ?? document.querySelector('canvas'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3500);
  shots.push([id, (await page.screenshot({ type: 'png' })).toString('base64')]);
  await page.close();
}
const cols = Math.min(4, shots.length), page = await browser.newPage({ viewport: { width: cols * 480, height: Math.ceil(shots.length / cols) * 360 } });
await page.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},480px)">${shots.map(([id, b]) => `<div style="position:relative"><img src="data:image/png;base64,${b}"><span style="position:absolute;left:6px;top:4px;color:#fff;font:600 13px sans-serif;text-shadow:0 0 3px #000">${id}</span></div>`).join('')}</body>`);
await page.screenshot({ path: out });
await browser.close();
console.log('→', out);
