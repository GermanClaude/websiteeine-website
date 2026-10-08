// NULLPUNKT — Prüft die Mehrspieler-Puppen (bot.puppet, BotManager.spawnPuppet/removeBot/addBot/puppetFired) im echten
// Offline-Match über dev/puppet.html (Headless-Chromium, WebGL über SwiftShader): zwei Puppen laufen ~10 s ein Skript
// (Kreis, Sprint, Ducken, Liegen, Anschlag, Nachladen, Waffenwechsel, Schüsse); geprüft werden Pose, Animation, Schüsse
// (weapon:fire cosmetic + Leuchtspur, kein Schaden), Trefferzonen (combat.fireHitscan), removeBot, addBot, Seitenfehler.
// Zwei Bildschirmfotos in verschiedenen Haltungen: tools/out/puppet-1-ducken-liegen.png, tools/out/puppet-2-liegen-anschlag.png.
//
// Voraussetzung: Server auf 8765 (npx http-server -p 8765 -s -c-1 .).
// Aufruf: node tools/puppet-test.mjs [--map=hafen] [--mode=tdm] [--quality=low] [--size=1024x576] [--ts=1] [--smoke]
//   --ts     Zeitraffer des Spiels (debugApi.setTimeScale; SwiftShader schafft nur ≈ 1–3 Bilder/s)
//   --smoke  danach zusätzlich 20 s normales Offline-Match ohne Puppen (tools/smoke.mjs) als Rückfallprüfung
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
const [W, H] = String(opt.size || '1024x576').split('x').map(Number);
const qs = new URLSearchParams({ auto: '1', map: String(opt.map || 'hafen'), mode: String(opt.mode || 'tdm'), quality: String(opt.quality || 'low') });
if (opt.ts) qs.set('ts', String(opt.ts));
const url = `${BASE}dev/puppet.html?${qs}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rechner teilen sich mehrere Prüfläufe: bei hoher Last warten (höchstens 10 min)
async function waitForLoad() {
  for (let i = 0; i < 10; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 6)) return;
    console.log(`     Last ${l1} > 6 – warte 60 s`);
    await sleep(60000);
  }
}
await waitForLoad();

const errors = [];
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/favicon|Failed to load resource.*(404|net::ERR_ABORTED)/.test(text)) return;
  errors.push(text);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('crash', () => errors.push('[crash] Renderer-Prozess abgestürzt'));

let fail = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHL ') + text); if (!ok) fail++; };
const P = (fn, arg) => page.evaluate(fn, arg);
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await P(fn); } catch { /* Seite lädt */ }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Zeitüberschreitung: ${label}`);
    await sleep(200);
  }
}
/** Skript anhalten, `settle` s Spielzeit abwarten (Übergänge der Animation), Bild ohne Tafel/Ego-Waffe, weiter. */
async function shot(file, settle) {
  await P(() => window.__puppet.hold(true));
  let ok = false;
  try {
    await waitFor(new Function(`return window.__puppet.heldFor >= ${settle}`), 120000, 'Pose eingeschwungen');
    await P(() => window.__puppet.shotMode(true));
    await waitFor(new Function(`return window.__puppet.heldFor >= ${settle + 0.15}`), 60000, 'Bild ohne Tafel');
    await page.locator('#game').screenshot({ path: file, timeout: 120000 });
    console.log(`     Bild: ${file}`);
    ok = true;
  } catch (err) {
    console.log(`     Bild ${file} fehlgeschlagen: ${String(err.message).split('\n')[0]}`);
  }
  await P(() => { window.__puppet.shotMode(false); window.__puppet.hold(false); });
  return ok;
}

const t0 = Date.now();
try {
  console.log(`     ${url}`);
  await page.goto(url);
  await waitFor(() => window.__puppet && window.__puppet.playing, 240000, 'Match läuft');
  console.log(`     Match läuft nach ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  // Bild 1: A duckt, B liegt
  await waitFor(() => window.__puppet.done || (window.__puppet.phase === 'ducken' && window.__puppet.phaseB === 'liegen'), 300000, 'Phase ducken/liegen');
  check(await shot(`${OUT}/puppet-1-ducken-liegen.png`, 1.6), 'Bildschirmfoto 1 (A geduckt, B liegend)');
  // Bild 2: A liegt (voll), B steht im Anschlag
  await waitFor(() => window.__puppet.done || window.__puppet.proneReady, 300000, 'A liegt');
  check(await shot(`${OUT}/puppet-2-liegen-anschlag.png`, 0.5), 'Bildschirmfoto 2 (A liegend, B im Anschlag)');
  await waitFor(() => window.__puppet.done, 600000, 'Szenario fertig');
  const res = await P(() => ({ checks: window.__puppet.checks, results: window.__puppet.results, errors: window.__puppet.errors, ok: window.__puppet.ok }));
  for (const [name, c] of Object.entries(res.checks)) check(c.ok, `${name}${c.detail ? ` – ${c.detail}` : ''}`);
  for (const e of res.errors) errors.push(e);
  if (res.results && res.results.puppets) console.log(`     ${JSON.stringify(res.results.puppets)}`);
} catch (err) {
  check(false, `Ablauf: ${err.message}`);
  try { console.log(JSON.stringify(await P(() => window.__puppet && { phase: window.__puppet.phase, log: window.__puppet.log.slice(-12) }))); } catch { /* egal */ }
}
const uniq = [...new Set(errors)];
check(uniq.length === 0, `keine Seiten-/Konsolenfehler${uniq.length ? `: ${uniq.slice(0, 6).join(' | ')}` : ''}`);
await browser.close();
console.log(`     Dauer ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (opt.smoke) {
  await waitForLoad();
  console.log('     Rückfallprüfung: 20 s Offline-Match ohne Puppen (tools/smoke.mjs)');
  const r = spawnSync(process.execPath, ['tools/smoke.mjs', `--params=mode=${qs.get('mode')}&map=${qs.get('map')}`, '--seconds=20', `--quality=${qs.get('quality')}`, '--shots=1', `--out=${OUT}/puppet-smoke`], { stdio: 'inherit' });
  check(r.status === 0, `Offline-Match ohne Puppen (smoke, Code ${r.status})`);
}
console.log(fail ? `${fail} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
process.exit(fail ? 1 : 0);
