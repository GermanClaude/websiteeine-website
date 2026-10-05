// Rauchtest für dev/audio-lab.html (Hybrid-Klanglabor): lädt die Seite (Desktop + Handy), entsperrt Audio, wartet auf
// die Aufnahmen, spielt alle A/B-Knöpfe, schaltet Räume/Profile/Gehör, sammelt Konsolenfehler und Screenshots.
// Aufruf: node tools/audio/lab-test.mjs [--quality=low|medium|high]  (Server: NP_BASE, Standard http://localhost:8765/)
import { chromium, devices, BASE } from '../pw.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const Q = opt.quality || 'high';
const OUT = new URL('../out/audio/lab/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const result = {};
for (const [tag, ctxOpts] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', { ...devices['Pixel 7'] }]]) {
  const ctx = await browser.newContext(ctxOpts), page = await ctx.newPage(), errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}dev/audio-lab.html?quality=${tag === 'phone' ? 'low' : Q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__audioLab?.audio, null, { timeout: 60000 });
  await page.click('#unlock');
  await page.waitForFunction(() => window.__audioLab.audio.samples.idle && window.__audioLab.audio.samples.info().sounds > 20, null, { timeout: 300000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}${tag}-top.png` });
  const buttons = await page.$$('#groups button');
  let clicked = 0;
  for (const b of buttons) { await b.click(); clicked++; await page.waitForTimeout(tag === 'phone' ? 60 : 90); }
  for (const r of ['buero', 'flur', 'halle', 'frei']) {
    await page.click(`#tabs button[data-tab="room"]`);
    await page.click(`#roomSel2 button[data-v="${r}"]`); await page.waitForTimeout(300);
    await page.click('#roomShot'); await page.waitForTimeout(250);
  }
  await page.click('#flash'); await page.waitForTimeout(600);
  const hearing = await page.evaluate(() => window.__audioLab.audio.info().hearing);
  for (const m of ['handy', 'lautsprecher', 'kopfhoerer']) await page.click(`#mixSel button[data-v="${m}"]`);
  await page.screenshot({ path: `${OUT}${tag}-room.png`, fullPage: tag === 'phone' });
  for (const t of ['blind', 'memory', 'verdict']) { await page.click(`#tabs button[data-tab="${t}"]`); await page.waitForTimeout(200); await page.screenshot({ path: `${OUT}${tag}-${t}.png`, fullPage: true }); }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const info = await page.evaluate(() => { const i = window.__audioLab.audio.info(); return { played: i.played, recorded: i.recorded, missed: i.missed, errors: i.errors, samples: i.samples, samplesMB: i.samplesMB, bankMB: i.bankMB, totalMB: i.totalMB, samplesErrors: i.samplesErrors, lastError: i.lastError }; });
  result[tag] = { clicked, errors, hearing, overflow, info };
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}result.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
