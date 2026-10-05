// Screenshots der Asset-Bibliothek (dev/assets.html) zur Sichtprüfung + Konsolenfehler.
// Aufruf: node tools/assets/shots.mjs [out-dir] [--only=name,…] [--mobile]
// Server: wie die übrigen Werkzeuge (NP_BASE, Standard http://localhost:8765/).
import { chromium, devices, BASE, GL_ARGS } from '../pw.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, ROOT } from './lib/common.mjs';

const args = parseArgs();
const out = args._[0] || join(ROOT, 'tools/out/assets-shots');
mkdirSync(out, { recursive: true });

export const SHOTS = [
  ['tex-hero', 'tab=textures&id=concrete_floor_worn&tier=1024&hdri=freight_station'],
  ['tex-container', 'tab=textures&id=container&tier=1024&hdri=freight_station'],
  ['tex-grid-metal', 'tab=textures&grid=1&ui=0&cat=metal&tier=512&hdri=abandoned_slipway'],
  ['tex-grid-masonry', 'tab=textures&grid=1&ui=0&cat=masonry&tier=512&hdri=old_outdoor_theater'],
  ['tex-grid-interior', 'tab=textures&grid=1&ui=0&cat=interior&tier=512&hdri=burnt_warehouse'],
  ['tex-grid-ground', 'tab=textures&grid=1&ui=0&cat=ground&tier=512&hdri=zwartkops_straight_morning'],
  ['tex-grid-fabric', 'tab=textures&grid=1&ui=0&cat=fabric&tier=512&hdri=old_outdoor_theater'],
  ['tex-grid-weapon', 'tab=textures&grid=1&ui=0&cat=weapon&tier=1024&hdri=industrial_pipe_and_valve_01'],
  ['mdl-rifle', 'tab=models&id=bolt_action_rifle_7_62&tier=2048&hdri=industrial_pipe_and_valve_01'],
  ['mdl-barrel', 'tab=models&id=barrel_01&tier=1024&hdri=freight_station'],
  ['mdl-hydrant', 'tab=models&id=fire_hydrant&tier=1024&hdri=old_outdoor_theater'],
  ['mdl-grid-urban', 'tab=models&grid=1&ui=0&cat=urban&tier=512&hdri=freight_station'],
  ['mdl-grid-industrial', 'tab=models&grid=1&ui=0&cat=industrial&tier=512&hdri=abandoned_slipway'],
  ['mdl-grid-interior', 'tab=models&grid=1&ui=0&cat=interior&tier=512&hdri=burnt_warehouse'],
  ['mdl-grid-military', 'tab=models&grid=1&ui=0&cat=military&tier=512&hdri=zwartkops_straight_morning'],
  ['mdl-grid-containers', 'tab=models&grid=1&ui=0&cat=containers&tier=512&hdri=freight_station'],
  ['mdl-grid-nature', 'tab=models&grid=1&ui=0&cat=nature&tier=512&hdri=old_outdoor_theater'],
  ['mdl-grid-modular', 'tab=models&grid=1&ui=0&cat=modular&tier=512&hdri=abandoned_slipway'],
  ['hdri-freight', 'tab=hdris&id=freight_station&tier=1024&hdri=freight_station'],
  ['hdri-night', 'tab=hdris&id=cobblestone_street_night&tier=1024'],
  ['hdri-basement', 'tab=hdris&id=debris_basement_corridor&tier=1024'],
  ['maps', 'tab=maps&hdri=abandoned_slipway'],
];

const only = args.only ? String(args.only).split(',') : null;
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = args.mobile
  ? await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true })
  : await browser.newContext({ viewport: { width: 1280, height: 720 } });
let errors = 0;
for (const [name, q] of SHOTS) {
  if (only && !only.includes(name)) continue;
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  // three.js' FileLoader liest Antworten als Stream (Fortschritt) — Chromium meldet das als ERR_ABORTED, obwohl alle
  // Bytes ankommen (geprüft: fetch + getReader liefert die volle Länge). Diese Meldung daher nicht als Fehler zählen.
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`); });
  const t0 = Date.now();
  await page.goto(`${BASE}dev/assets.html?shot=1&spin=0&${q}`, { waitUntil: 'load' });
  try { await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 180000 }); } catch { logs.push('[timeout] nicht bereit'); }
  await page.waitForTimeout(1200);
  const budget = await page.evaluate(() => window.__assets?.budget?.()).catch(() => null);
  const file = join(out, `${name}${args.mobile ? '-m' : ''}.png`);
  await page.screenshot({ path: file, timeout: 180000 });
  errors += logs.length;
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s, geladen ${budget ? (budget.downloadedBytes / 1048576).toFixed(2) + ' MB, GPU ≈ ' + (budget.gpu.desktop / 1048576).toFixed(1) + ' MB' : '?'} → ${file}`);
  for (const l of logs) console.log('   ', l);
  await page.close();
}
await browser.close();
console.log(errors ? `${errors} Konsolenmeldungen` : 'keine Konsolenfehler');
