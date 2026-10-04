// Screenshot + Konsolenfehler einer Seite (Headless-Chromium mit WebGL über SwiftShader).
// Aufruf: node tools/shot.mjs <url> <out.png> [--wait=ms] [--mobile] [--size=1280x720] [--eval="js"] [--click=selector]
// Server vorher starten:  npx http-server -p 8765 -s -c-1 .
import { chromium, devices } from '/opt/node-tools/node_modules/playwright/index.mjs';

const [url, out = 'tools/out/shot.png', ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const [w, h] = String(opt.size || '1280x720').split('x').map(Number);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = opt.mobile
  ? await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true })
  : await browser.newContext({ viewport: { width: w, height: h } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'load' });
if (opt.click) await page.click(opt.click);
await page.waitForTimeout(Number(opt.wait || 2500));
if (opt.eval) console.log('eval:', JSON.stringify(await page.evaluate(opt.eval)));
await page.screenshot({ path: out, fullPage: !!opt.full });
console.log(logs.length ? logs.join('\n') : 'keine Konsolenfehler');
await browser.close();
