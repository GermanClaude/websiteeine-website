// NULLPUNKT — VR-Test Hände/Waffen (27.10.) mit dem Emulator IWER (Meta Quest 3) in Headless-Chromium (SwiftShader).
//
// Prüft: Handschuhe + Unterarme an beiden Controllern sichtbar; Nebenhand greift mit der Griff-Taste den Vorderschaft →
// beidhändig, der Lauf zeigt vom Griff zur Nebenhand; Holster (Griff-Taste Haupthand an der Hüfte → Pistole, über der
// Schulter → Hauptwaffe); echtes Gehen 1:1 (Headset 1 m vor → Körper 1 m vor); Steuerungs-Seite im VR-Menü mit
// Tastenerfassung (taktische Granate auf linke Griff-Taste, dann zurücksetzen). Bilder unter tools/out/vr/hand-*.png.
//
// Aufruf (Server: npx http-server -p 8765 -s -c-1 . bzw. NP_BASE):
//   node tools/vr-hand-test.mjs [--map=hafen] [--mode=tdm] [--quality=low] [--size=800x450] [--base=http://127.0.0.1:8765/]
//                          [--timeout=240] [--aa] [--rebuild]
//   --quality  Grafikstufe am Bildschirm (Standard low); IWER meldet den Quest-Browser → VR-Grafik „Niedrig“, danach zurück
//   --aa       VR-Modus schon vor dem Laden an (Kontext mit MSAA wie nach dem Neuladen), sonst wird er im Match eingeschaltet
//   --vrq=wie  Einstellung „VR-Grafik“ (auto | niedrig | wie) – „wie“ behält die Bildschirmstufe (Aussehen prüfen)
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
  try { await page.screenshot({ path: p, timeout: 120000 }); summary.screenshots.push(p); } catch (e) { summary.warnings.push(`Bildschirmfoto ${name}: ${e.message}`); }
};


const V = (a) => a.map((v) => +v.toFixed(3));
try {
  await page.goto(summary.url, { waitUntil: 'load', timeout: T });
  if (!(await until('match läuft', () => window.__game && window.__game.match.state === 'playing'))) throw new Error('kein Match');
  await G(() => { __game.player.godMode = true; __game.settings.set('vrEnabled', true); });
  await until('VR unterstützt', () => window.__game.xr && window.__game.xr.supported === true, null, 30000);
  await until('Knopf „VR starten“', () => { const b = document.querySelector('.xr-start'); return b && !b.hidden; }, null, 30000);
  await page.click('.xr-start');
  if (!(await until('VR bereit', () => window.__game.xr.presenting && window.__game.xr.ready, null, 120000))) throw new Error('keine XR-Sitzung');
  // Controller in eine natürliche Haltung: rechts vorn auf Brusthöhe, links etwas tiefer
  await G(() => {
    const h = __iwer.position;
    __iwer.controllers.right.position.set(h.x + 0.18, h.y - 0.3, h.z - 0.35);
    __iwer.controllers.left.position.set(h.x - 0.2, h.y - 0.45, h.z - 0.25);
    __iwer.controllers.right.quaternion.set(0, 0, 0, 1);
    __iwer.controllers.left.quaternion.set(0, 0, 0, 1);
  });
  await frames(6);
  const vis = await G(() => {
    const A = __game.viewmodel.rig.arms;
    return { rechts: A.right.group.visible && A.right.mesh.visible, links: A.left.group.visible && A.left.mesh.visible, oberarm: A.right.upper.visible, unterarm: A.right.fore.visible };
  });
  if (vis.rechts && vis.links && !vis.oberarm && vis.unterarm) pass('Hände sichtbar', vis); else fail('Hände sichtbar', JSON.stringify(vis));
  await shot('hand-haende');
  // beide Hände vor dem Gesicht (freie Nebenhand, Haupthand mit Waffe) – Griff links halb gedrückt
  await G(() => {
    const h = __iwer.position;
    __iwer.controllers.right.position.set(h.x + 0.12, h.y - 0.18, h.z - 0.42);
    __iwer.controllers.left.position.set(h.x - 0.16, h.y - 0.16, h.z - 0.34);
    const a = 0.35; __iwer.controllers.left.quaternion.set(0, Math.sin(a / 2), 0, Math.cos(a / 2));
  });
  await frames(5);
  await shot('hand-vorn');
  await G(() => __iwer.controllers.left.updateButtonValue('squeeze', 0.5));
  await frames(3);
  await shot('hand-vorn-faust');
  await G(() => { __iwer.controllers.left.updateButtonValue('squeeze', 0); __iwer.controllers.left.quaternion.set(0, 0, 0, 1); });

  // Beidhändig: linke Hand an den Vorderschaft, Griff-Taste
  const sup = await G(() => { const s = __game.viewmodel.rig.xrSupport(); return s ? { off: s.off.toArray(), len: s.len, steer: s.steer } : null; });
  if (!sup) fail('Stützgriff', 'Waffe ohne Vorderschaft');
  else {
    // Vorderschaft in Welt → Trackingraum (Rig) → linker Controller dorthin
    await G(() => {
      const xr = __game.xr, T = __game.THREE;
      const s = __game.viewmodel.rig.xrSupport();
      const w = s.off.clone().applyQuaternion(xr.gun.quat).add(xr.gun.pos);
      const inv = new T.Matrix4().copy(xr.rig.matrixWorld).invert();
      w.applyMatrix4(inv);
      __iwer.controllers.left.position.set(w.x, w.y, w.z);
    });
    await frames(3);
    await G(() => __iwer.controllers.left.updateButtonValue('squeeze', 1));
    if (await until('beidhändig (Griff am Vorderschaft)', () => window.__game.xr.gun.two === true, null, 60000)) {
      const d0 = await G(() => __game.xr.gun.dir.toArray());
      // Nebenhand 15 cm nach rechts → Lauf schwenkt nach rechts
      await G(() => { __iwer.controllers.left.position.x += 0.15; });
      await frames(4);
      const r = await G(() => {
        const xr = __game.xr, s = __game.viewmodel.rig.xrSupport();
        const want = xr.hands.off.gripW.pos.clone().sub(xr.gun.pos).normalize();
        const have = s.off.clone().normalize().applyQuaternion(xr.gun.quat);
        return { winkel: Math.acos(Math.min(1, want.dot(have))) * 180 / Math.PI, dir: xr.gun.dir.toArray(), links: __game.viewmodel.rig.arms.left.group.visible };
      });
      const turn = Math.acos(Math.min(1, d0[0] * r.dir[0] + d0[1] * r.dir[1] + d0[2] * r.dir[2])) * 180 / Math.PI;
      if (r.winkel < 3 && turn > 5) pass('Lauf folgt der Nebenhand', `Abweichung ${r.winkel.toFixed(1)}°, geschwenkt ${turn.toFixed(1)}°`);
      else fail('Lauf folgt der Nebenhand', `Abweichung ${r.winkel.toFixed(1)}°, geschwenkt ${turn.toFixed(1)}°`);
      await shot('hand-beidhaendig');
      await G(() => __iwer.controllers.left.updateButtonValue('squeeze', 0));
      if (await until('loslassen', () => window.__game.xr.gun.two === false, null, 30000)) pass('Vorderschaft loslassen');
    }
  }

  // Holster: Hüfte → Pistole, Schulter → Hauptwaffe
  const idx0 = await G(() => __game.player.weapon.index);
  const grab = async (dx, dy, dz) => {
    await G(([x, y, z]) => { const h = __iwer.position; __iwer.controllers.right.position.set(h.x + x, h.y + y, h.z + z); }, [dx, dy, dz]);
    await frames(3);
    await G(() => __iwer.controllers.right.updateButtonValue('squeeze', 1));
    await frames(3);
    await G(() => __iwer.controllers.right.updateButtonValue('squeeze', 0));
  };
  await grab(0.25, -0.75, 0.0);
  if (await until('Holster Hüfte → Pistole', (i) => window.__game.player.weapon.index !== i, idx0, 60000)) pass('Holster Hüfte → Pistole', await G(() => `Platz ${__game.player.weapon.index}, ${__game.player.weapon.def && __game.player.weapon.def.name}`));
  await frames(10);
  const idx1 = await G(() => __game.player.weapon.index);
  await grab(0.12, 0.02, 0.18);
  if (await until('Holster Rücken → Hauptwaffe', (i) => window.__game.player.weapon.index !== i, idx1, 60000)) pass('Holster Rücken → Hauptwaffe', await G(() => `Platz ${__game.player.weapon.index}, ${__game.player.weapon.def && __game.player.weapon.def.name}`));
  await G(() => { const h = __iwer.position; __iwer.controllers.right.position.set(h.x + 0.18, h.y - 0.3, h.z - 0.35); });

  // Echtes Gehen 1:1: Headset in 10-cm-Schritten 1 m nach vorn (Trackingraum −z)
  const p0 = await G(() => __game.player.position.toArray());
  for (let i = 0; i < 10; i++) { await G(() => { __iwer.position.z -= 0.1; __iwer.controllers.right.position.z -= 0.1; __iwer.controllers.left.position.z -= 0.1; }); await frames(1); }
  await frames(6);
  const p1 = await G(() => __game.player.position.toArray());
  const walked = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  if (Math.abs(walked - 1) < 0.12) pass('echtes Gehen 1:1', `${walked.toFixed(2)} m für 1 m im Raum`); else fail('echtes Gehen 1:1', `${walked.toFixed(2)} m für 1 m im Raum`);

  // Steuerungs-Seite: Y → Menü, „Steuerung“, „Taktische Granate“ → linke Griff-Taste, dann zurücksetzen
  await G(() => __iwer.controllers.left.updateButtonValue('y-button', 1));
  await frames(2);
  await G(() => __iwer.controllers.left.updateButtonValue('y-button', 0));
  await until('VR-Menü', () => window.__game.xr.menu.open, null, 60000);
  await G(() => { const a = -80 * Math.PI / 180; __iwer.controllers.right.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2)); });
  await frames(2);
  const pick = async (id) => {
    for (let i = 0; i < 12 && (await G(() => { const m = __game.xr.menu; return m.items[m.focus] && m.items[m.focus].id; })) !== id; i++) {
      await G(() => __iwer.controllers.right.updateAxes('thumbstick', 0, 1)); await frames(2);
      await G(() => __iwer.controllers.right.updateAxes('thumbstick', 0, 0)); await frames(2);
    }
    await G(() => __iwer.controllers.right.updateButtonValue('a-button', 1)); await frames(2);
    await G(() => __iwer.controllers.right.updateButtonValue('a-button', 0)); await frames(2);
  };
  await pick('steuerung');
  if (await until('Steuerungs-Seite', () => window.__game.xr.menu.kind === 'steuerung', null, 30000)) {
    await frames(2);
    await shot('hand-steuerung');
    await pick('ctl:tactical');
    if (await until('Tastenerfassung läuft', () => !!window.__game.xr._capture, null, 30000)) {
      await frames(3);
      await G(() => __iwer.controllers.left.updateButtonValue('squeeze', 1)); await frames(3);
      await G(() => __iwer.controllers.left.updateButtonValue('squeeze', 0)); await frames(2);
      const b = await G(() => { const o = __game.settings.get('bindings'); return o && o.xr ? o.xr.tactical : null; });
      if (Array.isArray(b) && b[0] === 'XrN1') pass('Taste belegt (taktisch → linke Griff-Taste)', b); else fail('Taste belegt', JSON.stringify(b));
      await frames(2);
      await shot('hand-steuerung-belegt');
    }
    await pick('ctl:standard');
    const after = await G(() => { const o = __game.settings.get('bindings'); return o && o.xr ? o.xr : null; });
    if (!after || !Object.keys(after).length) pass('VR-Belegung zurückgesetzt'); else fail('VR-Belegung zurückgesetzt', JSON.stringify(after));
  }
} catch (err) {
  fail('Ablauf', err && err.message ? err.message : String(err));
}
const relevant = summary.errors.filter((e) => !/favicon|net::ERR_ABORTED|Failed to load resource/.test(e));
if (relevant.length) fail('Konsolenfehler', `${relevant.length}: ${relevant.slice(0, 5).join(' | ')}`); else pass('Konsolenfehler', 'keine');
await browser.close();
console.log(JSON.stringify({ ok: summary.ok, checks: summary.checks, warnings: summary.warnings.slice(0, 10), screenshots: summary.screenshots }, null, 2));
process.exit(summary.ok ? 0 : 1);
