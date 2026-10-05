// NULLPUNKT — automatischer Smoke-Test für spielen.html (Headless-Chromium, WebGL über SwiftShader).
//
// Startet ein Match, wartet auf state 'playing', simuliert Eingaben (Laufen, Blick, Feuerstöße, ADS,
// Nachladen, Springen, Ducken/Rutschen, Granate, Waffenwechsel – Desktop per Tastatur/Maus, Mobil per
// Touch über CDP), misst FPS/Akteure/Abschüsse/Leben, macht Screenshots, beendet optional das Match
// über debugApi und prüft Endbildschirm + Profil, wiederholt optional Revanchen (Leck-Prüfung).
// Gibt eine JSON-Zusammenfassung aus und endet mit Code 1 bei Konsolenfehlern oder fehlgeschlagenen Prüfungen.
//
// Aufruf (Server muss laufen: npx http-server -p 8765 -s -c-1 .; andere Adresse: NP_BASE oder --base):
//   node tools/smoke.mjs [--params="map=hafen&time=60&score=5"] [--seconds=20] [--mobile]
//                        [--shots=4] [--end] [--restarts=0] [--quality=low] [--size=1280x720]
//                        [--base=http://localhost:8765/] [--out=tools/out/smoke] [--lobby] [--warn-fail]
//   --params   URL-Parameter für spielen.html (autostart=1 wird ergänzt, außer mit --lobby; Standard
//              „time=60&score=5“ = zuletzt gewählter Modus/Karte; am schnellsten lädt „mode=training&map=range“).
//              Test-Parameter god=1/timescale=… wirken nur zusammen mit debug=1 (Match dann ungewertet).
//   --seconds  Dauer der Eingabesimulation
//   --mobile   Touch-Gerät (Querformat 915×412, Touch-Eingaben über CDP)
//   --shots    Anzahl Screenshots während der Simulation (gleichmäßig verteilt)
//   --end      Match per debugApi.endMatch() beenden, Endbildschirm + profile.recordMatch prüfen
//   --restarts N  danach N× „Revanche“ (onRestart) – Speicherwerte je Match für Leck-Prüfung
//   --lobby    über die Lobby starten (klickt den Startknopf) statt autostart
//   --warn-fail  auch Konsolen-Warnungen lassen den Test scheitern
//   --natural  Matchende nicht erzwingen: auf Zeit-/Punktelimit warten (max. 3 × time-Parameter + 60 s), dann erst endMatch()
import { chromium, devices, BASE as DEFAULT_BASE, GL_ARGS } from './pw.mjs';
import { mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const BASE = String(opt.base || DEFAULT_BASE);
const SECONDS = Number(opt.seconds || 20);
const SHOTS = Number(opt.shots ?? 4);
const RESTARTS = Number(opt.restarts || 0);
const OUT = String(opt.out || 'tools/out/smoke');
const MOBILE = !!opt.mobile;
const [W, H] = String(opt.size || (MOBILE ? '915x412' : '1280x720')).split('x').map(Number);
mkdirSync(OUT.includes('/') ? OUT.slice(0, OUT.lastIndexOf('/')) : '.', { recursive: true });

const qs = new URLSearchParams(String(opt.params || 'time=60&score=5'));
if (!opt.lobby) qs.set('autostart', '1');
if (opt.quality) qs.set('quality', String(opt.quality));
const url = `${BASE}spielen.html?${qs}`;

const summary = {
  url, mobile: MOBILE, ok: true, checks: {}, errors: [], warnings: [], missingModules: [], infos: [],
  samples: [], screenshots: [], matches: [],
};
const fail = (name, detail) => { summary.ok = false; summary.checks[name] = `FEHLER: ${detail}`; };
const pass = (name, detail = 'ok') => { summary.checks[name] = detail; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: GL_ARGS });
const ctx = MOBILE
  ? await browser.newContext({ ...devices['Pixel 7'], viewport: { width: W, height: H }, screen: { width: W, height: H }, isMobile: true, hasTouch: true })
  : await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const MODULE_RE = /\/assets\/js\/(game|shared)\//;
page.on('console', (m) => {
  const type = m.type();
  const text = m.text();
  const loc = m.location() || {};
  if (type === 'error' && /Failed to load resource.*404/.test(text) && MODULE_RE.test(loc.url || '')) {
    const u = loc.url.replace(BASE, '');
    if (!summary.missingModules.includes(u)) summary.missingModules.push(u);
    return;
  }
  if (type === 'error') summary.errors.push(text);
  else if (type === 'warning') summary.warnings.push(text);
  else if (type === 'info' && text.startsWith('[NULLPUNKT]')) summary.infos.push(text);
});
page.on('pageerror', (e) => summary.errors.push(`[pageerror] ${e.message}`));
page.on('crash', () => summary.errors.push('[crash] Renderer-Prozess abgestürzt'));
browser.on('disconnected', () => summary.infos.push('[smoke] Browser getrennt'));
page.on('requestfailed', (r) => {
  if (MODULE_RE.test(r.url())) { const u = r.url().replace(BASE, ''); if (!summary.missingModules.includes(u)) summary.missingModules.push(u); return; }
  summary.errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
});

const state = () => page.evaluate(() => (window.__game && window.__game.debugApi ? window.__game.debugApi.state() : { state: window.__game ? window.__game.match.state : 'none' }));

async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await page.evaluate(fn); } catch { /* Seite lädt */ }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Zeitüberschreitung: ${label}`);
    await sleep(250);
  }
}

let shotN = 0;
async function shot(tag) {
  const file = `${OUT}-${String(++shotN).padStart(2, '0')}-${tag}.png`;
  try {
    // SwiftShader + schwere Karten: ein Bild kann > 30 s dauern – kein Testabbruch deswegen
    await page.screenshot({ path: file, timeout: 120000 });
    summary.screenshots.push(file);
  } catch (err) {
    summary.infos.push(`[smoke] Screenshot ${tag} übersprungen: ${String(err.message).split('\n')[0]}`);
  }
}

/* ---------------------------------------------------------- Touch über CDP */
let cdp = null;
async function touch(type, points) {
  if (!cdp) cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
}
async function center(sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, sel);
}
async function tapTouch(sel, holdMs = 60) {
  const c = await center(sel);
  if (!c) return false;
  await touch('touchStart', [{ ...c, id: 9 }]);
  await sleep(holdMs);
  await touch('touchEnd', []);
  return true;
}

/* ---------------------------------------------------------- Eingabeskripte */
async function desktopInput(seconds, onTick) {
  const k = page.keyboard;
  const m = page.mouse;
  const t0 = Date.now();
  let phase = 0;
  await m.move(W / 2, H / 2);
  while (Date.now() - t0 < seconds * 1000) {
    const p = phase++ % 10;
    await k.down('KeyW');
    if (p === 0) { await k.down('ShiftLeft'); await sleep(500); await k.press('KeyC'); await sleep(400); await k.up('ShiftLeft'); await k.press('KeyC'); }
    if (p === 1) { await m.down(); for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__game.input.simulate.look(8, -1)); await sleep(110); } await m.up(); }
    if (p === 2) { await m.down({ button: 'right' }); await sleep(600); await m.down(); await sleep(1200); await m.up(); await m.up({ button: 'right' }); }
    if (p === 3) { await k.press('KeyR'); await sleep(300); }
    if (p === 4) { await k.press('Space'); await sleep(300); await k.down('KeyA'); await sleep(400); await k.up('KeyA'); }
    if (p === 5) { await k.press('KeyG'); await sleep(400); }
    if (p === 6) { await k.press('Digit2'); await sleep(900); for (let i = 0; i < 3; i++) { await m.down(); await sleep(150); await m.up(); await sleep(250); } await k.press('Digit1'); }
    if (p === 7) { await m.wheel(0, 120); await sleep(400); await m.wheel(0, 120); }
    if (p === 8) { await k.press('KeyC'); await sleep(300); await k.down('KeyD'); await sleep(300); await k.up('KeyD'); await k.press('KeyC'); }
    if (p === 9) { await k.press('KeyV'); await page.evaluate(() => window.__game.input.simulate.look(-200, 0)); }
    await page.evaluate(() => window.__game.input.simulate.look(Math.random() * 60 - 30, Math.random() * 10 - 5));
    await sleep(250);
    await k.up('KeyW');
    await onTick();
  }
}

async function mobileInput(seconds, onTick) {
  const t0 = Date.now();
  let phase = 0;
  // erster Touch schaltet in den Touch-Modus
  await touch('touchStart', [{ x: W * 0.7, y: H * 0.4, id: 1 }]);
  await touch('touchEnd', []);
  await sleep(200);
  while (Date.now() - t0 < seconds * 1000) {
    const p = phase++ % 6;
    const sx = W * 0.15, sy = H * 0.72;
    const fire = await center('.tc-fire-r');
    // Joystick nach vorn + gleichzeitig Feuerknopf halten und ziehen (Blick beim Feuern)
    await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
    await touch('touchMove', [{ x: sx, y: sy - 50, id: 1 }]);
    if (fire && p % 2 === 0) {
      await touch('touchStart', [{ x: sx, y: sy - 50, id: 1 }, { ...fire, id: 2 }]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: sx, y: sy - 50, id: 1 }, { x: fire.x - i * 6, y: fire.y, id: 2 }]); await sleep(50); }
      await touch('touchEnd', [{ x: sx, y: sy - 50, id: 1 }]);
    } else {
      // Sprint-Sperre: weit nach oben ziehen und loslassen
      await touch('touchMove', [{ x: sx, y: sy - 160, id: 1 }]);
      await sleep(300);
    }
    await touch('touchEnd', []);
    // Blick ziehen (rechte Hälfte)
    await touch('touchStart', [{ x: W * 0.62, y: H * 0.45, id: 3 }]);
    for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: W * 0.62 + i * 14, y: H * 0.45, id: 3 }]); await sleep(30); }
    await touch('touchEnd', []);
    const btn = ['.tc-ads', '.tc-reload', '.tc-jump', '.tc-crouch', '.tc-grenade', '.tc-swap'][p];
    await tapTouch(btn);
    if (p === 0) { await sleep(300); await tapTouch('.tc-ads'); }
    await sleep(200);
    await onTick();
  }
}

/* ---------------------------------------------------------- Ablauf */
let exitCode = 0;
try {
  await page.goto(url, { waitUntil: 'load' });
  if (opt.lobby) {
    await waitFor(() => window.__game && window.__game.match.state === 'lobby', 60000, 'Lobby');
    await sleep(600);
    const btn = await page.$('[data-act="start"], [data-action="start"], #menu-root button.primary');
    if (!btn) throw new Error('Startknopf in der Lobby nicht gefunden');
    await btn.click();
  }
  await waitFor(() => window.__game && ['countdown', 'playing'].includes(window.__game.match.state), 90000, 'Match-Start');
  pass('matchStarted');
  await waitFor(() => window.__game.match.state === 'playing', 60000, 'Countdown');
  pass('playing');
  // Headless gewährt keinen Pointer-Lock: Maustasten auch ohne Sperre zulassen (wie autostart)
  await page.evaluate(() => { window.__game.input.allowUnlockedMouse = true; });
  const profileBefore = await page.evaluate(() => window.__game.profile.get().matches);
  await shot('start');

  const shotEvery = SHOTS > 0 ? (SECONDS * 1000) / (SHOTS + 1) : Infinity;
  const tStart = Date.now();
  let nextShot = tStart + shotEvery;
  let lastSample = 0;
  const onTick = async () => {
    const now = Date.now();
    if (now - lastSample > 500) {
      lastSample = now;
      const s = await state();
      summary.samples.push({ t: Math.round((now - tStart) / 100) / 10, fps: s.fps, alive: s.alive, actors: s.actors, kills: s.kills, health: s.player && s.player.health, state: s.state, weapon: s.player && s.player.weapon, mag: s.player && s.player.mag });
    }
    if (now >= nextShot && summary.screenshots.length < SHOTS + 1) { nextShot += shotEvery; await shot('play'); }
  };
  if (MOBILE) await mobileInput(SECONDS, onTick); else await desktopInput(SECONDS, onTick);

  const s = await state();
  summary.final = s;
  const fps = summary.samples.map((x) => x.fps).filter((x) => x > 0);
  summary.fps = { avg: fps.length ? Math.round((fps.reduce((a, b) => a + b, 0) / fps.length) * 10) / 10 : 0, min: fps.length ? Math.min(...fps) : 0 };
  summary.inputMode = await page.evaluate(() => window.__game.input.mode);
  if (MOBILE) { if (summary.inputMode === 'touch') pass('touchMode'); else fail('touchMode', summary.inputMode); }
  if (s.actors > 1) pass('actors', s.actors); else fail('actors', s.actors);
  const shots = await page.evaluate(() => window.__game.player.stats.shotsFired);
  if (shots > 0) pass('playerFired', shots); else fail('playerFired', 'keine Schüsse');
  summary.kills = s.kills;
  summary.checks.kills = s.kills > 0 ? s.kills : 'keine (bei kurzer Dauer möglich)';

  const runEnd = async (label) => {
    if (opt.natural) {
      const limit = (Number(qs.get("time")) || 120) * 3 + 60; // SwiftShader: dt-Klemme bremst die Simulationszeit
      try {
        await waitFor(() => window.__game.match.state === 'ended', limit * 1000, `${label}: natürliches Matchende`);
        pass(`naturalEnd-${label}`, 'Limit erreicht');
      } catch { fail(`naturalEnd-${label}`, `kein Ende nach ${limit} s`); }
    }
    if (await page.evaluate(() => window.__game.match.state) !== 'ended') {
      await page.evaluate(() => window.__game.debugApi.endMatch());
    }
    await waitFor(() => window.__game.match.state === 'ended', 20000, `${label}: Matchende`);
    await waitFor(() => { const r = document.getElementById('menu-root'); return r && r.children.length > 0 && document.getElementById('match-banner').hidden; }, 15000, `${label}: Endbildschirm`);
    const info = await page.evaluate(() => {
      const G = window.__game;
      const i = G.renderer.info();
      return { result: G.lastResult && G.lastResult.playerSummary ? G.lastResult.playerSummary.result : null, xp: G.lastProgression ? G.lastProgression.xpGained : null, matches: G.profile.get().matches, geometries: i.geometries, textures: i.textures, programs: i.programs, listeners: G.events.count(), sceneChildren: G.scene.children.length, menuText: document.getElementById('menu-root').innerText.slice(0, 160) };
    });
    summary.matches.push({ label, ...info });
    await shot(`end-${label}`);
    return info;
  };

  if (opt.end || RESTARTS > 0) {
    const info = await runEnd('m1');
    if (info.matches === profileBefore + 1) pass('profileRecorded', `${profileBefore} → ${info.matches}, +${info.xp} XP`); else fail('profileRecorded', `${profileBefore} → ${info.matches}`);
    if (info.menuText) pass('endScreen', info.menuText.split('\n')[0]); else fail('endScreen', 'leer');
    for (let r = 0; r < RESTARTS; r++) {
      await page.evaluate(() => window.__game.menus.onRestart());
      await waitFor(() => window.__game.match.state === 'playing', 90000, `Revanche ${r + 1}`);
      await sleep(2500);
      await runEnd(`m${r + 2}`);
    }
    if (RESTARTS > 0) {
      const first = summary.matches[0];
      const last = summary.matches[summary.matches.length - 1];
      const leak = last.geometries - first.geometries > 40 || last.textures - first.textures > 12 || last.listeners !== first.listeners || Math.abs(last.sceneChildren - first.sceneChildren) > 3;
      if (leak) fail('leaks', `Geo ${first.geometries}→${last.geometries}, Tex ${first.textures}→${last.textures}, Listener ${first.listeners}→${last.listeners}, Szene ${first.sceneChildren}→${last.sceneChildren}`);
      else pass('leaks', `Geo ${first.geometries}→${last.geometries}, Tex ${first.textures}→${last.textures}, Listener ${last.listeners}`);
    }
  }
} catch (err) {
  fail('ablauf', err.message);
  try { await shot('fehler'); } catch { /* ignore */ }
}

if (summary.errors.length) fail('konsole', `${summary.errors.length} Fehler`);
if (summary.missingModules.length) fail('module', `nicht ladbar: ${summary.missingModules.join(', ')}`);
if (opt['warn-fail'] && summary.warnings.length) fail('warnungen', `${summary.warnings.length} Warnungen`);
summary.samples = summary.samples.slice(-40);
console.log(JSON.stringify(summary, null, 2));
exitCode = summary.ok ? 0 : 1;
await browser.close();
process.exit(exitCode);
