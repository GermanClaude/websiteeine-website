// NULLPUNKT — VR-Test mit dem WebXR-Emulator IWER (Meta Quest 3, Touch-Controller) in Headless-Chromium (SwiftShader).
//
// Ablauf: Match starten (niedrige Qualität), VR-Modus einschalten, „VR starten“ anklicken → XR-Sitzung läuft und zeichnet
// Bilder ohne Fehler; linker Stick → Spieler läuft; rechter Stick → Drehung um genau einen Schritt; Abzug → weapon:fire;
// Headset absenken → Ducken; Kopf zur Seite (Versatz bzw. Neigen) → Lehnen; Handgelenk-Anzeige zeigt die Munition und
// zählt nach dem Feuern herunter; Y (linke Hand) → VR-Menü; „VR beenden“ über Stick + A → normales Bild + Pausenmenü.
// Bildschirmfotos der VR-Ansicht und des Bildes danach unter tools/out/vr/.
//
// Aufruf (Server: npx http-server -p 8765 -s -c-1 . bzw. NP_BASE):
//   node tools/vr-test.mjs [--map=hafen] [--mode=tdm] [--quality=low] [--size=800x450] [--base=http://127.0.0.1:8765/]
//                          [--timeout=240] [--aa] [--rebuild]
//   --quality  Grafikstufe am Bildschirm (Standard low); IWER meldet den Quest-Browser → VR-Grafik „Niedrig“, danach zurück
//   --aa       VR-Modus schon vor dem Laden an (Kontext mit MSAA wie nach dem Neuladen), sonst wird er im Match eingeschaltet
// Emulator: npm i --prefix tools/out/vr iwer esbuild (einmalig; tools/out ist nicht im Repo). Das Bündel
// tools/out/vr/iwer.iife.js entsteht beim ersten Lauf aus tools/vr-iwer-entry.mjs (nur Test, nie ausgeliefert).
import { chromium, BASE as DEFAULT_BASE, GL_ARGS } from './pw.mjs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools/out/vr');
const BUNDLE = join(OUT, 'iwer.iife.js');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const BASE = String(opt.base || DEFAULT_BASE);
const MAP = String(opt.map || 'hafen');
const MODE = String(opt.mode || 'tdm');
const [W, H] = String(opt.size || '800x450').split('x').map(Number);
const T = Number(opt.timeout || 240) * 1000;
const QUALITY = String(opt.quality || 'low');
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------ Emulator-Bündel */

async function bundle() {
  if (existsSync(BUNDLE) && !opt.rebuild) return readFileSync(BUNDLE, 'utf8');
  const esb = join(OUT, 'node_modules/esbuild/lib/main.js');
  if (!existsSync(esb) || !existsSync(join(OUT, 'node_modules/iwer'))) {
    console.error('IWER/esbuild fehlen: npm i --prefix tools/out/vr iwer esbuild');
    process.exit(2);
  }
  const esbuild = await import(pathToFileURL(esb).href);
  await esbuild.build({
    entryPoints: [join(ROOT, 'tools/vr-iwer-entry.mjs')], bundle: true, format: 'iife', target: 'es2020',
    outfile: BUNDLE, nodePaths: [join(OUT, 'node_modules')], logLevel: 'warning', legalComments: 'inline',
  });
  return readFileSync(BUNDLE, 'utf8');
}

/* ------------------------------------------------------------ Test */

const summary = { ok: true, url: '', checks: {}, errors: [], warnings: [], screenshots: [] };
const pass = (k, v = 'ok') => { summary.checks[k] = v; console.log(`  ok    ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); };
const fail = (k, v) => { summary.ok = false; summary.checks[k] = `FEHLER: ${v}`; console.log(`  FEHLER ${k}: ${v}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const code = await bundle();
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript({ content: code });
if (opt.aa) {
  // VR-Einstellung vor dem Start (renderer.js erzeugt den Kontext dann mit MSAA)
  await ctx.addInitScript(() => {
    try {
      const k = 'nullpunkt:settings';
      const v = JSON.parse(localStorage.getItem(k) || '{}');
      v.vrEnabled = true;
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* */ }
  });
}
const page = await ctx.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') summary.errors.push(t);
  else if (m.type() === 'warning' && /NULLPUNKT|xr|XR/.test(t)) summary.warnings.push(t);
});
page.on('pageerror', (e) => summary.errors.push(`pageerror: ${e.message}`));

const qs = new URLSearchParams({ autostart: '1', debug: '1', mode: MODE, map: MAP, quality: QUALITY });
summary.url = `${BASE}spielen.html?${qs}`;
console.log(`VR-Test: ${summary.url}`);

/** Wartet, bis fn() (im Seitenkontext) wahr ist. */
async function until(name, fn, arg, ms = T) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
    return true;
  } catch {
    fail(name, `Zeitüberschreitung (${Math.round(ms / 1000)} s)`);
    return false;
  }
}
const G = (fn, arg) => page.evaluate(fn, arg);
/** n weitere Spielbilder abwarten (SwiftShader: 1–3 Bilder/s). */
async function frames(n) {
  const f0 = await G(() => window.__game.time.frame);
  await page.waitForFunction((f) => window.__game.time.frame >= f, f0 + n, { timeout: T, polling: 100 });
}
const shot = async (name) => {
  const p = join(OUT, `${name}.png`);
  try { await page.screenshot({ path: p }); summary.screenshots.push(p); } catch (e) { summary.warnings.push(`Bildschirmfoto ${name}: ${e.message}`); }
};

try {
  await page.goto(summary.url, { waitUntil: 'load', timeout: T });
  if (!(await until('match läuft', () => window.__game && window.__game.match.state === 'playing'))) throw new Error('kein Match');
  pass('match läuft', await G(() => `${__game.match.modeId}/${__game.match.mapId}, Qualität ${__game.renderer.quality}, MSAA ${__game.renderer.msaa}`));
  const q2d = await G(() => __game.renderer.quality);

  // VR-Einstellung, Emulator meldet Quest 3
  await G(() => { __game.player.godMode = true; __game.settings.set('vrEnabled', true); });
  if (await until('VR unterstützt', () => window.__game.xr && window.__game.xr.supported === true, null, 30000)) pass('VR unterstützt', 'navigator.xr meldet immersive-vr (IWER Quest 3)');
  if (await until('Knopf „VR starten“', () => { const b = document.querySelector('.xr-start'); return b && !b.hidden; }, null, 30000)) pass('Knopf „VR starten“');

  // Sitzung starten (Klick = Nutzergeste)
  await page.click('.xr-start');
  if (!(await until('XR-Sitzung', () => window.__game.xr.presenting && window.__game.renderer.renderer.xr.isPresenting, null, 60000))) throw new Error('keine XR-Sitzung');
  pass('XR-Sitzung', await G(() => `Referenzraum ${__game.xr.space}, Qualität ${__game.renderer.quality}`));
  if (await until('VR bereit (Höhe gemessen)', () => window.__game.xr.ready)) pass('VR bereit', await G(() => `Kopfhöhe ${__game.xr.calib.toFixed(2)} m`));
  const f0 = await G(() => __game.time.frame);
  await frames(6);
  const f1 = await G(() => __game.time.frame);
  pass('Bilder in VR', `${f1 - f0} Bilder, ${summary.errors.length} Konsolenfehler`);
  await shot('vr-ansicht');

  // Laufen: linker Stick nach vorn
  const p0 = await G(() => __game.player.position.toArray());
  await G(() => __iwer.controllers.left.updateAxes('thumbstick', 0, -1));
  await frames(14);
  await G(() => __iwer.controllers.left.updateAxes('thumbstick', 0, 0));
  const p1 = await G(() => __game.player.position.toArray());
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  if (moved > 0.3) pass('Laufen (linker Stick)', `${moved.toFixed(2)} m`); else fail('Laufen (linker Stick)', `nur ${moved.toFixed(2)} m`);

  // Drehen in Schritten (rechter Stick)
  const step = await G(() => Number(__game.settings.get('vrTurnStep')));
  const y0 = await G(() => __game.xr.rigYaw);
  await G(() => __iwer.controllers.right.updateAxes('thumbstick', 1, 0));
  await frames(3);
  await G(() => __iwer.controllers.right.updateAxes('thumbstick', 0, 0));
  await frames(2);
  const y1 = await G(() => __game.xr.rigYaw);
  const dyaw = Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0)) * 180 / Math.PI;
  if (Math.abs(dyaw + step) < 0.5) pass('Drehen (Schritt)', `${dyaw.toFixed(1)}° (Schritt ${step}°)`); else fail('Drehen (Schritt)', `${dyaw.toFixed(1)}° statt −${step}°`);

  // Handgelenk-Anzeige
  if (await until('Handgelenk-Anzeige', () => window.__game.xr.wrist && window.__game.xr.wrist.mesh.visible && window.__game.xr.wrist.draws > 0, null, 60000)) {
    pass('Handgelenk-Anzeige', await G(() => `sichtbar, Munition „${__game.xr.wrist.lastAmmo}“`));
  }
  const ammo0 = await G(() => __game.xr.wrist.lastAmmo);

  // Feuern mit dem Abzug (Haupthand rechts)
  await G(() => { window.__fires = 0; window.__offFire = __game.events.on('weapon:fire', (e) => { if (e.actor === __game.player) window.__fires++; }); });
  await G(() => __iwer.controllers.right.updateButtonValue('trigger', 1));
  await until('Feuern (Abzug)', () => window.__fires >= 2, null, 90000);
  await G(() => __iwer.controllers.right.updateButtonValue('trigger', 0));
  const fires = await G(() => window.__fires);
  if (fires > 0) pass('Feuern (Abzug)', `${fires} Schüsse (weapon:fire)`);
  const aim = await G(() => ({ dir: __game.xr.aimDir.toArray().map((v) => +v.toFixed(3)), dist: +__game.xr.aimDist.toFixed(1) }));
  pass('Zielstrahl', aim);
  // Munition am Handgelenk zählt herunter (Anzeige ≤ 10×/s)
  if (await until('Handgelenk: Munition aktualisiert', (a) => window.__game.xr.wrist.lastAmmo !== a, ammo0, 60000)) {
    pass('Handgelenk: Munition aktualisiert', await G((a) => `„${a}“ → „${__game.xr.wrist.lastAmmo}“`, ammo0));
  }
  await shot('vr-feuer');

  // Headset absenken → Ducken; wieder hoch → Stehen
  const h0 = await G(() => __iwer.position.y);
  await G(() => { __iwer.position.y = 0.95; });
  if (await until('Ducken (Headset tiefer)', () => window.__game.player.crouching === true || window.__game.player.stance === 'crouch', null, 60000)) {
    pass('Ducken (Headset tiefer)', await G(() => `Haltung ${__game.player.stance}, Verhältnis ${(((1.65 + __iwer.position.y - __game.xr.calib) / 1.65)).toFixed(2)}`));
  }
  await G((h) => { __iwer.position.y = h; }, h0);
  if (await until('Aufstehen (Headset hoch)', () => window.__game.player.stance === 'stand' && !window.__game.player.crouching, null, 60000)) pass('Aufstehen (Headset hoch)');

  // Lehnen: Kopf 30 cm zur Seite
  const x0 = await G(() => __iwer.position.x);
  await G((x) => { __iwer.position.x = x + 0.3; }, x0);
  if (await until('Lehnen (Kopf seitlich)', () => window.__game.player.lean > 0.3, null, 60000)) {
    pass('Lehnen (Kopf seitlich)', await G(() => `xrLean ${__game.player.xrLean.toFixed(2)}, lean ${__game.player.lean.toFixed(2)}`));
  }
  await G((x) => { __iwer.position.x = x; }, x0);
  await until('Lehnen zurück', () => Math.abs(window.__game.player.lean) < 0.15, null, 60000);
  // Lehnen: Kopf nach links neigen (Rollen 30°)
  await G(() => { const a = 30 * Math.PI / 180; __iwer.quaternion.set(0, 0, Math.sin(a / 2), Math.cos(a / 2)); });
  if (await until('Lehnen (Kopf geneigt)', () => window.__game.player.lean < -0.3, null, 60000)) {
    pass('Lehnen (Kopf geneigt)', await G(() => `xrLean ${__game.player.xrLean.toFixed(2)}, lean ${__game.player.lean.toFixed(2)}`));
  }
  await G(() => { __iwer.quaternion.set(0, 0, 0, 1); });
  await until('Neigen zurück', () => Math.abs(window.__game.player.lean) < 0.15, null, 60000);

  // VR-Menü: Y (linke Hand) → Pause + Menü in der Brille
  await G(() => __iwer.controllers.left.updateButtonValue('y-button', 1));
  await frames(2);
  await G(() => __iwer.controllers.left.updateButtonValue('y-button', 0));
  if (await until('VR-Menü (Y)', () => window.__game.match.state === 'paused' && window.__game.xr.menu.open, null, 60000)) pass('VR-Menü (Y)', 'Pause, Menü in der Brille');
  await frames(2);
  await shot('vr-menue');
  // „VR beenden“: Strahl weg von der Tafel (Controller nach unten), Stick runter bis „VR beenden“, A
  await G(() => { const a = -80 * Math.PI / 180; __iwer.controllers.right.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2)); });
  await frames(2);
  const cur = () => G(() => __game.xr.menu.items[__game.xr.menu.focus] && __game.xr.menu.items[__game.xr.menu.focus].id);
  for (let i = 0; i < 6 && (await cur()) !== 'beenden'; i++) {
    await G(() => __iwer.controllers.right.updateAxes('thumbstick', 0, 1));
    await frames(2);
    await G(() => __iwer.controllers.right.updateAxes('thumbstick', 0, 0));
    await frames(2);
  }
  const focus = await cur();
  if (focus === 'beenden') pass('Menü: Auswahl per Stick', focus); else fail('Menü: Auswahl per Stick', `Auswahl ${focus}`);
  await G(() => __iwer.controllers.right.updateButtonValue('a-button', 1));
  await frames(2);
  await G(() => __iwer.controllers.right.updateButtonValue('a-button', 0));
  if (await until('VR beendet', () => !window.__game.xr.presenting && !window.__game.renderer.renderer.xr.isPresenting, null, 60000)) pass('VR beendet', 'Menü „VR beenden“');
  if (await until('2D-Pausenmenü', () => window.__game.match.state === 'paused' && !!document.querySelector('[data-screen="pause"]'), null, 30000)) pass('2D-Pausenmenü');
  const q = await G(() => ({ quality: __game.renderer.quality, width: __game.renderer.width, height: __game.renderer.height, canvasParent: __game.canvas.parentElement && __game.canvas.parentElement.id }));
  if (q.quality === q2d) pass('Bildschirm wiederhergestellt', q); else fail('Bildschirm wiederhergestellt', `Stufe ${q.quality} statt ${q2d}`);
  // Fortsetzen (2D): die normale rAF-Schleife simuliert und zeichnet wieder (das unscharfe Pausenmenü bremst SwiftShader stark)
  await G(() => __game.debugApi.resume());
  await until('weiter im 2D-Spiel', () => window.__game.match.state === 'playing', null, 30000);
  const g0 = await G(() => __game.time.frame);
  await sleep(4000);
  const g1 = await G(() => __game.time.frame);
  if (g1 > g0) pass('normale Schleife läuft wieder', `${g1 - g0} Bilder in 4 s, renderer.xr.isPresenting ${await G(() => __game.renderer.renderer.xr.isPresenting)}`);
  else fail('normale Schleife läuft wieder', 'keine Bilder');
  await shot('nach-vr');
} catch (err) {
  fail('Ablauf', err && err.message ? err.message : String(err));
}

const relevant = summary.errors.filter((e) => !/favicon|net::ERR_ABORTED|Failed to load resource/.test(e));
if (relevant.length) fail('Konsolenfehler', `${relevant.length}: ${relevant.slice(0, 5).join(' | ')}`);
else pass('Konsolenfehler', 'keine');
await browser.close();
console.log(JSON.stringify({ ok: summary.ok, checks: summary.checks, warnings: summary.warnings.slice(0, 10), screenshots: summary.screenshots }, null, 2));
process.exit(summary.ok ? 0 : 1);
