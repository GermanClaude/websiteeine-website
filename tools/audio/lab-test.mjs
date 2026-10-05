// Rauchtest für dev/audio-lab.html: lädt die Seite (Desktop + Handy), entsperrt Audio, spielt alle A/B-Knöpfe,
// misst alle Paare, sammelt Konsolenfehler und Screenshots. Aufruf: NP_BASE=http://localhost:8790/ node tools/audio/lab-test.mjs
import { chromium, devices, BASE } from '../pw.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = new URL('../out/audio/lab/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const result = {};
for (const [tag, ctxOpts] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', { ...devices['Pixel 7'] }]]) {
  const ctx = await browser.newContext(ctxOpts), page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + 'dev/audio-lab.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__audioLab2?.audio, null, { timeout: 30000 });
  await page.click('#unlock');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}${tag}-top.png`, fullPage: false });
  if (tag === 'desktop') {
    const buttons = await page.$$('#groups button');
    let clicked = 0;
    for (const b of buttons) { await b.click(); clicked++; await page.waitForTimeout(120); }
    await page.waitForTimeout(1500);
    // Perspektiven / Innen
    for (const sel of ['#persp button[data-v="40"]', '#room button[data-v="indoor"]', '#tailmode button[data-v="both"]']) await page.click(sel);
    const rows = await page.$$('#groups .panel:first-child button.rec');
    for (const b of rows) { await b.click(); await page.waitForTimeout(150); }
    await page.click('#tabs button[data-tab="measure"]');
    const measured = await page.evaluate(async () => (await window.__audioLab2.measureAll()).map(r => ({ rec: r.rec, proc: r.proc, r: r.r && { dur: +r.r.dur.toFixed(2), crest: +r.r.crest.toFixed(1), bw: Math.round(r.r.bw), loud: +r.r.loud.toFixed(1), d40: r.r.d40 }, p: r.p && { dur: +r.p.dur.toFixed(2), crest: +r.p.crest.toFixed(1), bw: Math.round(r.p.bw), loud: +r.p.loud.toFixed(1), d40: r.p.d40 } })));
    await page.screenshot({ path: `${OUT}${tag}-measure.png`, fullPage: true });
    for (const t of ['blind', 'hybrid', 'verdict']) { await page.click(`#tabs button[data-tab="${t}"]`); await page.waitForTimeout(200); await page.screenshot({ path: `${OUT}${tag}-${t}.png`, fullPage: true }); }
    await page.click('#tabs button[data-tab="blind"]'); await page.click('#blindNew'); await page.waitForTimeout(800); await page.click('#blindA'); await page.click('#blindB'); await page.click('#voteA');
    const blindMsg = await page.textContent('#blindMsg');
    const info = await page.evaluate(() => ({ samples: window.__audioLab2.samples.buffers.size, ram: window.__audioLab2.samples.ram, bytes: window.__audioLab2.samples.bytes, sErr: window.__audioLab2.samples.errors, sLast: window.__audioLab2.samples.lastError, eng: window.__audioLab2.audio.info() }));
    result[tag] = { clicked, errors, info: { ...info, eng: { errors: info.eng.errors, lastError: info.eng.lastError, played: info.eng.played, dropped: info.eng.dropped } }, blindMsg, measured };
  } else {
    await page.click('#groups button.rec');
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${OUT}${tag}-full.png`, fullPage: true });
    result[tag] = { errors, horizontalOverflowPx: overflow };
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}result.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ desktop: { clicked: result.desktop.clicked, errors: result.desktop.errors, info: result.desktop.info, blindMsg: result.desktop.blindMsg }, phone: result.phone }, null, 1));
