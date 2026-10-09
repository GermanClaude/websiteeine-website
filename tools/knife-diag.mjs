import { chromium, BASE, GL_ARGS } from './pw.mjs';
const browser = await chromium.launch({ args: GL_ARGS });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || /NULLPUNKT|Messer/.test(m.text())) console.log('CONSOLE', m.type(), m.text().slice(0, 300)); });
await page.goto(`${BASE}spielen.html?auto=1&mode=${process.argv[2] || 'messer'}&map=werk&quality=low`);
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => { const G = window.__game; return G ? { st: G.match && G.match.state, mode: G.mode && G.mode.modeId, actors: G.actors && G.actors.length, scr: document.querySelector('.m-screen:not([hidden]), [data-screen]:not([hidden])') ? (document.querySelector('.m-screen:not([hidden]), [data-screen]:not([hidden])').className || '').slice(0, 60) : null } : null; }).catch((e) => String(e).slice(0, 100));
  console.log(i * 10 + 10, 's', JSON.stringify(s));
  if (s && s.st === 'playing') break;
}
await browser.close();
