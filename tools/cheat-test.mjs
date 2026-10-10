// NULLPUNKT – Cheat-Menü (cheats.js, ui/cheat-menu.js, modes/base.js – seit 10.10. in allen Modi) in Headless-Chromium
// (spielen.html, SwiftShader).
//   Offline (Nur Messer, Werk, Spieler im Gottmodus): Tastenfolge Ziffernblock 1-2-3-4 → Code-Feld (Spiel läuft weiter);
//     falscher Code → Meldung, kein Menü; „NULLPUNKT“ → Menü; Esc schließt ohne Pause; Folge öffnet danach ohne Code;
//     falsche oder zu langsame Folge (über 3 s) → nichts. Aimbot rundum (360°): richtet auf einen sichtbaren (angehaltenen)
//     Bot HINTER dem Spieler aus (Winkelfehler < 3°); Markierungen sichtbar (mit Entfernung, auch ohne Sichtlinie);
//     Auto-Messer sticht einen nahen Bot ab (normale Nahkampf-Aktion); Messer ohne Abklingzeit (Hieb sperrt nicht, normal
//     schon); ESP (Rahmen, Name, Leben, Entfernung); Echter Spin (eigene Sicht dreht sich); Ausweichen bewegt den Spieler, wenn ein Bot auf ihn zielt (normales Tempo, kein Sprung in der Lage); Spinbot
//     dreht nur die übertragene Gierung (netPoseOf), Kamera bleibt; Auto-Sprung; Symbol in der Punktetabelle; Matchende
//     setzt zurück; neues Match (TDM): neues System ohne Reste (Fenster, Haltemaus, Spinbot), die Folge verlangt wieder den
//     Code; Schusswaffen-Aimbot + Auto-Feuer erledigen einen Bot hinter dem Spieler (Kopftreffer).
//   Online (--online, Host + 1 Client über das lokale Relay, Online-Team-Deathmatch): Host-Schalter
//     „Cheat-Menü“ sichtbar (Standard erlaubt); Client schaltet frei und aktiviert → Host-Roster cheat, Symbol in der
//     Punktetabelle des Hosts; Ausweichen (angehaltener Host-Bot zielt auf die Puppe), Auto-Messer (Abschuss beim Host
//     gewertet; Schnellangriff mit der Schusswaffe in der Hand), Schusswaffen-Aimbot + Auto-Feuer (Abschuss beim Host),
//     Messer ohne Abklingzeit (Stiche beim Host angenommen; Prüfung: ohne Ausnahme Feuerrate-Verstoß, mit keiner)
//     und Spinbot (Puppe dreht sich, Sicht des Clients nicht) ohne Verstoß oder Rücksetzung durch das Anti-Cheat des Hosts;
//     Host verbietet → Schalter des Clients aus, Roster zurück, Folge öffnet nichts („vom Host deaktiviert“).
// Tastenfolge über CDP (Zeitstempel = Absendezeit, siehe sequence) – page.keyboard.press wartet je Taste auf ein Bild.
// Bilder: tools/out/cheat-code.png, cheat-menu.png, cheat-aimbot.png, cheat-markers.png, cheat-scoreboard.png,
//   cheat-host-setting.png, cheat-online-host.png, cheat-gun.png, cheat-esp.png
// Voraussetzung: Server (NP_BASE, Standard http://localhost:8765/); online zusätzlich node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/cheat-test.mjs [--only=offline,online] [--online] [--quality=low] [--size=800x450]
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const ONLY = opt.only ? String(opt.only).split(',') : opt.online ? ['offline', 'online'] : ['offline'];
const QUALITY = String(opt.quality || 'low');
const [W, H] = String(opt.size || '800x450').split('x').map(Number);
const RELAY = process.env.NP_RELAY || 'ws://localhost:7777';
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));

async function waitForLoad() {
  for (let i = 0; i < 6; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 14)) return;
    if (i % 3 === 0) info(`Last ${l1} > 14 – warte`);
    await sleep(20000);
  }
}

async function until(p, fn, arg, timeout = 60000, every = 300) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}

function watchErrors(p, list) {
  p.on('pageerror', (e) => list.push(`[pageerror] ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR_|WebGL|GL_|AudioContext/i.test(m.text())) list.push(m.text()); });
}

const SEQ = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];
const cdps = new WeakMap();
/**
 * Ziffernblock-Folge wie von einer echten Tastatur: über CDP abgeschickt, ohne auf die Bestätigung des Renderers zu
 * warten (page.keyboard.press wartet je Taste auf das nächste Bild – unter SwiftShader mit 1–3 fps dauern vier Tasten
 * dann länger als das 3-s-Fenster). Zeitstempel der Ereignisse = Absendezeit; gap = ms zwischen zwei Tasten.
 */
async function sequence(p, keys = SEQ, gap = 60) {
  let s = cdps.get(p);
  if (!s) { s = await p.context().newCDPSession(p); cdps.set(p, s); }
  const pending = [];
  for (const code of keys) {
    const vk = 96 + Number(code.slice(-1)); // VK_NUMPAD0 + n
    const ev = { code, key: code.slice(-1), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, location: 3, isKeypad: true };
    pending.push(s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ev }));
    await sleep(25);
    pending.push(s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev }));
    await sleep(gap);
  }
  await Promise.all(pending);
  await sleep(250);
}

/** Bildschirmfoto (SwiftShader ist langsam: großzügige Frist, ein Fehlschlag bricht den Test nicht ab). */
async function shot(p, name) {
  try { await p.screenshot({ path: `${OUT}/${name}`, timeout: 180000, animations: 'disabled' }); info(`Bild: ${OUT}/${name}`); } catch (err) { info(`Bild ${name} fehlgeschlagen: ${String(err.message || err).split('\n')[0]}`); }
}

const dlg = (p) => p.evaluate(() => { const d = document.querySelector('.cm-dlg'); return d ? d.dataset.cheat : null; });

/** Hilfen auf der Seite (window.__ct): Simulationszeit abwarten, Bots anhalten/platzieren, Winkel, Gierung über das Netz. */
const instrument = (p) => p.evaluate(async () => {
  const G = window.__game;
  const T = G.THREE;
  const C = (window.__ct = { jumps: 0 });
  const bot = await import(new URL('assets/js/game/bots/bot.js', location.href).href);
  C.netYaw = () => bot.netPoseOf(G.player, {}).yaw;
  G.events.on('player:jump', () => { C.jumps++; });
  // Simulationszeit abwarten (SwiftShader unter Last: 1–3 fps, je Bild höchstens 0,05 s – daher großzügige Frist)
  C.simWait = async (sec, maxMs = 240000, stop = null) => {
    const t0 = G.time.elapsed;
    const r0 = performance.now();
    while (G.time.elapsed - t0 < sec && performance.now() - r0 < maxMs) {
      if (stop && stop()) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return G.time.elapsed - t0;
  };
  C.sys = () => G.mode && G.mode.cheats;
  C.enemies = () => G.actors.filter((a) => a !== G.player && a.isBot && !a.isRemoteHuman && G.combat.isHostile(G.player, a));
  /** alle Bots anhalten (nur für den Test) */
  C.freezeAll = () => { for (const b of G.actors) if (b.isBot && !b._ctFrozen) { b._ctFrozen = true; b.update = () => {}; } };
  /** Bodenpunkt in Richtung yaw (relativ zur Sicht) im Abstand d mit freier Sicht vom Auge – oder null */
  C.spot = (d, rel = 0) => {
    const p = G.player;
    const eye = p.getEyePosition(new T.Vector3());
    for (let i = 0; i < 24; i++) {
      const yaw = p.yaw + rel + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
      const dir = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const to = eye.clone().addScaledVector(dir, d);
      const chest = to.clone(); chest.y -= 0.5;
      if (!G.world.lineOfSight(eye, chest) || !G.world.lineOfSight(eye, to)) continue;
      const ground = G.world.raycast(to.clone().setY(to.y + 0.5), new T.Vector3(0, -1, 0), 6);
      if (!ground || Math.abs(ground.point.y - p.position.y) > 0.6) continue;
      // Platz für den Körper (keine Wand direkt daneben)
      return { pos: ground.point.clone(), yaw };
    }
    return null;
  };
  /** Darstellung eines angehaltenen Bots an seine Position (update ruht – sonst steht das Modell am alten Ort) */
  C.sync = (b) => {
    const s = b.soldier;
    if (s && s.state === 'alive' && typeof s.place === 'function') s.place(b.body.position, Number.isFinite(s.anim && s.anim.bodyYaw) ? s.anim.bodyYaw : b.yaw);
  };
  /** Bot b an Stelle s setzen, wiederbeleben falls nötig, anhalten */
  C.place = (b, s) => {
    if (!b.alive) G.spawnActor(b);
    b.body.teleport(s.pos.clone());
    if (b.body.velocity) b.body.velocity.set(0, 0, 0);
    b.health = b.maxHealth;
    if (!b._ctFrozen) { b._ctFrozen = true; b.update = () => {}; }
    C.sync(b);
    return true;
  };
  /** alle anderen Gegner weit weg (fernster Navigationspunkt) */
  C.banish = (keep) => {
    const p = G.player;
    const nodes = G.world.nav.nodesInRadius(p.position, 400).sort((a, b) => b.position.distanceTo(p.position) - a.position.distanceTo(p.position));
    let i = 0;
    for (const b of C.enemies()) {
      if (b === keep) continue;
      const n = nodes[(i++ * 3) % Math.max(1, nodes.length)];
      if (n) { if (!b.alive) G.spawnActor(b); b.body.teleport(n.position.clone()); }
      if (!b._ctFrozen) { b._ctFrozen = true; b.update = () => {}; }
      C.sync(b);
    }
  };
  /** Winkel (°) zwischen Laufrichtung des Spielers und Auge → Punkt */
  C.err = (pt) => {
    const p = G.player;
    const eye = p.getEyePosition(new T.Vector3());
    const dir = p.getAimDirection(new T.Vector3());
    const to = pt.clone().sub(eye).normalize();
    return Math.acos(Math.max(-1, Math.min(1, dir.dot(to)))) * 180 / Math.PI;
  };
  C.notices = () => [...document.querySelectorAll('.h-notice')].map((n) => n.textContent);
  return true;
});

async function offline(browser) {
  info('— Offline (Nur Messer, Werk) —');
  await waitForLoad();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const errs = [];
  watchErrors(p, errs);
  await p.goto(`${BASE}spielen.html?autostart=1&mode=messer&map=werk&allies=1&enemies=3&diff=rekrut&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.mode, null, 600000, 1000);
  if (!check(!!ok, 'Match „Nur Messer“ läuft')) { await ctx.close(); return; }
  await instrument(p);
  const base = await p.evaluate(() => {
    const G = window.__game;
    G.debugApi.godMode(true);
    G.input.allowUnlockedMouse = true;
    const s = window.__ct.sys();
    return { has: !!s, active: s && s.active, unlocked: s && s.unlocked, hold: typeof G.holdUi === 'function', mode: G.mode.id, fps: G.renderer.info().fps };
  });
  info(`Bildrate ${base.fps} fps`);
  check(base.has && !base.active && !base.unlocked && base.hold, `Cheat-System im Modus ${base.mode}, alles aus, gesperrt`);

  // --- Tastenfolge + falscher Code
  await p.click('#game-canvas', { position: { x: 20, y: 20 } }).catch(() => {});
  await sequence(p);
  let v = await dlg(p);
  const run1 = await p.evaluate(() => ({ st: window.__game.match.state, hold: !!window.__game.match.uiHold, focus: document.activeElement && document.activeElement.matches('[data-cm-code]') }));
  check(v === 'code' && run1.st === 'playing' && run1.hold && run1.focus, `Folge 1-2-3-4 → Code-Feld (Spiel ${run1.st}, Maus frei ${run1.hold}, Fokus im Feld ${run1.focus})`);
  await p.keyboard.type('nullpunkt');
  await shot(p, 'cheat-code.png');
  await p.keyboard.press('Enter');
  await sleep(200);
  v = await dlg(p);
  const wrong = await p.evaluate(() => ({ unlocked: window.__ct.sys().unlocked, notes: window.__ct.notices(), hold: !!window.__game.match.uiHold }));
  check(v === null && !wrong.unlocked && wrong.notes.some((t) => /Falscher Code/i.test(t)) && !wrong.hold, `falscher Code „nullpunkt“ → kein Menü, Meldung „${wrong.notes.find((t) => /Code/i.test(t)) || '–'}“`);
  await sequence(p, ['Numpad1', 'Numpad2', 'Numpad4', 'Numpad3']);
  check((await dlg(p)) === null, 'falsche Reihenfolge 1-2-4-3 → nichts');
  await sequence(p, SEQ, 1150);
  check((await dlg(p)) === null, 'Folge zu langsam (über 3 s) → nichts');

  // --- richtiger Code
  await sequence(p);
  check((await dlg(p)) === 'code', 'Folge erneut → Code-Feld');
  await p.keyboard.type('NULLPUNKT');
  await p.keyboard.press('Enter');
  await sleep(300);
  v = await dlg(p);
  const right = await p.evaluate(() => ({ unlocked: window.__ct.sys().unlocked, rows: document.querySelectorAll('.cm-dlg [data-cheat-id]').length }));
  check(v === 'menu' && right.unlocked && right.rows === 10, `„NULLPUNKT“ → Cheat-Menü (${right.rows} Schalter)`);
  await p.click('[data-cheat-id="aimbot"]');
  await p.click('[data-cheat-id="markieren"]');
  await sleep(200);
  const t1 = await p.evaluate(() => ({ on: { ...window.__ct.sys().on }, aria: document.querySelector('[data-cheat-id="aimbot"]').getAttribute('aria-checked') }));
  check(t1.on.aimbot && t1.on.markieren && t1.aria === 'true' && !t1.on.spinbot, `Schalter per Klick: Aimbot ${t1.on.aimbot}, Markieren ${t1.on.markieren}`);
  await shot(p, 'cheat-menu.png');
  await p.keyboard.press('Escape');
  await sleep(250);
  const esc = await p.evaluate(() => ({ st: window.__game.match.state, hold: !!window.__game.match.uiHold }));
  check((await dlg(p)) === null && esc.st === 'playing' && !esc.hold, `Esc schließt das Menü, keine Pause (${esc.st})`);
  await sequence(p);
  check((await dlg(p)) === 'menu', 'Folge öffnet danach direkt das Menü (ohne Code)');
  if (await dlg(p)) { await p.keyboard.press('Escape'); await sleep(200); } // ohne offenes Fenster wäre Esc die Pause
  check(await p.evaluate(() => window.__game.match.state === 'playing'), 'Match läuft weiter');

  // --- Aimbot rundum (360°): angehaltener Bot schräg HINTER dem Spieler
  const aim = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    C.freezeAll();
    const b = C.enemies()[0];
    const s = C.spot(8, 2.7);
    if (!b || !s) return { err: !b ? 'kein Gegner' : 'kein freier Platz' };
    C.place(b, s);
    C.banish(b);
    const y0 = G.player.yaw;
    await C.simWait(1.0);
    const pt = b.position.clone(); pt.y += b.body.height * 0.62;
    const head = b.position.clone(); head.y += b.body.height * 0.9;
    return { err: null, deg: Math.min(C.err(pt), C.err(head)), turned: Math.abs(Math.atan2(Math.sin(G.player.yaw - y0), Math.cos(G.player.yaw - y0))) * 180 / Math.PI, target: sys.target === b, name: b.name, d: G.player.position.distanceTo(b.position) };
  });
  if (aim.err) check(false, `Aimbot-Aufbau: ${aim.err}`);
  else check(aim.target && aim.deg < 3 && aim.turned > 100, `Aimbot rundum: Blick auf ${aim.name} (${f1(aim.d)} m, gedreht ${f1(aim.turned)}°) – Winkelfehler ${aim.deg.toFixed(2)}°`);
  await shot(p, 'cheat-aimbot.png');

  // --- Markierungen
  const mk = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    await C.simWait(0.1);
    const list = C.sys().ui.visibleMarkers();
    const eye = G.player.getEyePosition(new G.THREE.Vector3());
    const hidden = list.filter((m) => { const a = G.actors.find((x) => x.id === m.id); if (!a) return false; const c = a.position.clone(); c.y += 1; return !G.world.lineOfSight(eye, c); });
    return { n: list.length, list: list.slice(0, 4), wall: hidden.length, target: C.sys().target && C.sys().target.id };
  });
  check(mk.n >= 1 && mk.list.some((m) => m.id === mk.target && /^\d+ m$/.test(m.text)), `Markierungen sichtbar: ${mk.n} (${mk.list.map((m) => m.text).join(', ')}), davon ohne Sichtlinie ${mk.wall}`);
  // Gegner hinter einer Wand: Markierung trotzdem (Bot an eine verdeckte Stelle)
  const wall = await p.evaluate(async () => {
    const G = window.__game;
    const T = G.THREE;
    const C = window.__ct;
    const p = G.player;
    const eye = p.getEyePosition(new T.Vector3());
    const b = C.enemies().find((x) => x !== C.sys().target);
    if (!b) return { err: 'kein zweiter Gegner' };
    // verdeckter Punkt im Sichtfeld: entlang der Blickrichtung hinter dem ersten Hindernis
    for (let i = 0; i < 24; i++) {
      const yaw = p.yaw + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 36);
      const dir = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const hit = G.world.raycast(eye, dir, 40);
      if (!hit || hit.distance < 3 || hit.distance > 30) continue;
      const beyond = eye.clone().addScaledVector(dir, hit.distance + 2.5);
      const ground = G.world.raycast(beyond.clone().setY(beyond.y + 1.5), new T.Vector3(0, -1, 0), 8);
      if (!ground) continue;
      const c = ground.point.clone(); c.y += 1.1;
      if (G.world.lineOfSight(eye, c)) continue;
      if (!b.alive) G.spawnActor(b);
      b.body.teleport(ground.point.clone());
      C.sync(b);
      await C.simWait(0.15);
      const m = C.sys().ui.visibleMarkers().find((x) => x.id === b.id);
      return { ok: !!m, text: m && m.text, d: p.position.distanceTo(b.position) };
    }
    return { err: 'kein verdeckter Punkt im Blickfeld' };
  });
  if (wall.err) info(`Markierung durch Wand nicht geprüft: ${wall.err}`);
  else check(wall.ok, `Markierung durch die Wand: ${wall.text || '–'} (${f1(wall.d)} m, keine Sichtlinie)`);
  await shot(p, 'cheat-markers.png');

  // --- Auto-Messer: Bot knapp in Reichweite, 50° seitlich
  const knife = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    sys.set('aimbot', false);
    sys.set('automesser', true);
    const b = C.enemies().find((x) => x.alive) || C.enemies()[0];
    const s = C.spot(1.9, 0.9);
    if (!b || !s) return { err: !b ? 'kein Gegner' : 'kein freier Platz' };
    C.place(b, s);
    C.banish(b);
    const k0 = G.player.stats.kills;
    const s0 = sys.stats.stabs;
    await C.simWait(2.5, 240000,() => !b.alive);
    return { err: null, dead: !b.alive, kills: G.player.stats.kills - k0, stabs: sys.stats.stabs - s0, name: b.name, w: G.player.weapon.currentDef.id };
  });
  if (knife.err) check(false, `Auto-Messer-Aufbau: ${knife.err}`);
  else check(knife.dead && knife.kills >= 1 && knife.stabs >= 1, `Auto-Messer: ${knife.name} abgestochen (Abschüsse +${knife.kills}, Stiche ${knife.stabs}, Waffe ${knife.w})`);
  const far = await p.evaluate(async () => {
    const C = window.__ct;
    const sys = C.sys();
    const b = C.enemies().find((x) => x.alive && x._ctFrozen) || C.enemies()[0];
    const s = C.spot(4.2, 0);
    if (!b || !s) return null;
    C.place(b, s);
    const s0 = sys.stats.stabs;
    await C.simWait(0.8);
    const r = { stabs: sys.stats.stabs - s0, alive: b.alive };
    sys.set('automesser', false);
    return r;
  });
  check(!!far && far.stabs === 0 && far.alive, `Auto-Messer: Gegner in 4,2 m (außer Reichweite) → kein Stich (${far && far.stabs})`);

  // --- Messer ohne Abklingzeit: der Hieb sperrt nicht (normal ≈ 0,75 s)
  const turbo = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    const w = G.player.weapon;
    C.banish(null);
    await C.simWait(1.2, 240000, () => !w.isMeleeing);
    const normal = w.melee();
    await C.simWait(0.2);
    const normalBusy = w.isMeleeing;
    await C.simWait(1.2, 240000, () => !w.isMeleeing);
    sys.set('turbomesser', true);
    const flag = G.player.cheatFastKnife === true;
    const fast = w.melee();
    await C.simWait(0.2);
    const fastBusy = w.isMeleeing;
    const again = w.melee();
    await C.simWait(0.2);
    sys.set('turbomesser', false);
    return { normal, normalBusy, flag, fast, fastBusy, again, off: G.player.cheatFastKnife === false };
  });
  check(turbo.normal && turbo.normalBusy && turbo.flag && turbo.fast && !turbo.fastBusy && turbo.again && turbo.off,
    `Messer ohne Abklingzeit: normal nach 0,2 s noch im Hieb (${turbo.normalBusy}), mit Schalter frei (${!turbo.fastBusy}), sofort neuer Hieb (${turbo.again})`);

  // --- ESP: Rahmen, Name, Leben, Entfernung (Bot vor dem Spieler)
  const esp = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    const b = C.enemies().find((x) => x.alive) || C.enemies()[0];
    const s = C.spot(9, 0);
    if (!b || !s) return { err: !b ? 'kein Gegner' : 'kein freier Platz' };
    C.place(b, s);
    b.health = Math.round(b.maxHealth * 0.5);
    sys.set('esp', true);
    await C.simWait(0.15);
    const list = sys.ui.visibleEsp();
    const me = list.find((e) => String(e.id) === String(b.id));
    return { err: null, n: list.length, me, name: b.name };
  });
  if (esp.err) check(false, `ESP-Aufbau: ${esp.err}`);
  else check(!!esp.me && esp.me.name === esp.name && /^\d+ m$/.test(esp.me.dist) && esp.me.h > esp.me.w && esp.me.hp === 50, `ESP: Rahmen um ${esp.name} (${esp.me ? `${esp.me.w}×${esp.me.h} px, ${esp.me.dist}, Leben ${esp.me.hp} %` : 'fehlt'}), sichtbar ${esp.n}`);
  await shot(p, 'cheat-esp.png');
  await p.evaluate(() => window.__ct.sys().set('esp', false));

  // --- Echter Spin: die eigene Sicht dreht sich (kein Ziel erfasst)
  const real = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    C.banish(null);
    sys.set('spin360', true);
    let turn = 0;
    let prev = G.player.yaw;
    const t0 = G.time.elapsed;
    while (G.time.elapsed - t0 < 0.6) {
      await new Promise((r) => setTimeout(r, 25));
      const y = G.player.yaw;
      turn += Math.abs(Math.atan2(Math.sin(y - prev), Math.cos(y - prev)));
      prev = y;
    }
    sys.set('spin360', false);
    return { deg: turn * 180 / Math.PI, sim: G.time.elapsed - t0 };
  });
  check(real.deg > 300, `Echter Spin: Sicht ${Math.round(real.deg)}° in ${f1(real.sim)} s gedreht`);

  // --- Ausweichen: Bot zielt auf den Spieler
  const dodge = await p.evaluate(async () => {
    const G = window.__game;
    const T = G.THREE;
    const C = window.__ct;
    const sys = C.sys();
    const p = G.player;
    sys.set('ausweichen', true);
    const b = C.enemies().find((x) => x.alive) || C.enemies()[0];
    const s = C.spot(11, Math.PI); // hinter dem Spieler – kein Einfluss der Sicht
    if (!b || !s) return { err: !b ? 'kein Gegner' : 'kein freier Platz' };
    C.place(b, s);
    C.banish(b);
    await C.simWait(0.3);
    const start = p.position.clone();
    const d0 = sys.stats.dodges;
    let maxD = 0, maxV = 0, maxStep = 0;
    let last = p.position.clone();
    const aimAt = () => {
      const e = b.getEyePosition(new T.Vector3());
      const c = p.position.clone(); c.y += 1.15;
      const to = c.sub(e);
      b.yaw = Math.atan2(-to.x, -to.z);
      b.pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    };
    aimAt();
    await C.simWait(1.2, 240000,() => {
      aimAt(); // der (angehaltene) Bot zielt weiter auf den Spieler
      maxD = Math.max(maxD, p.position.distanceTo(start));
      maxV = Math.max(maxV, Math.hypot(p.body.velocity.x, p.body.velocity.z));
      maxStep = Math.max(maxStep, p.position.distanceTo(last));
      last.copy(p.position);
      return false;
    });
    const dodges = sys.stats.dodges - d0;
    sys.set('ausweichen', false);
    // Gegenprobe: Bot zielt daneben → kein Ausweichen
    b.yaw += 0.6;
    const d1 = sys.stats.dodges;
    sys.set('ausweichen', true);
    await C.simWait(0.6);
    const idle = sys.stats.dodges - d1;
    sys.set('ausweichen', false);
    return { err: null, dodges, maxD, maxV, maxStep, idle, d: p.position.distanceTo(b.position) };
  });
  if (dodge.err) check(false, `Ausweichen-Aufbau: ${dodge.err}`);
  else {
    check(dodge.dodges >= 1 && dodge.maxD > 0.8, `Ausweichen: Bot zielt aus ${f1(dodge.d)} m → ${dodge.dodges} Seitschritt(e), bis ${f1(dodge.maxD)} m bewegt`);
    check(dodge.maxV <= 6.5 && dodge.maxStep < 1, `Ausweichen ohne Übertempo/Teleport: höchstens ${f1(dodge.maxV)} m/s, größter Bildschritt ${dodge.maxStep.toFixed(2)} m`);
    check(dodge.idle === 0, `Bot zielt daneben → kein Ausweichen (${dodge.idle})`);
  }

  // --- Spinbot: übertragene Gierung dreht, Kamera nicht
  const spin = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    const p = G.player;
    sys.set('spinbot', true);
    const y0 = p.yaw;
    const q0 = p.camera.quaternion.clone();
    let turn = 0;
    let prev = C.netYaw();
    await C.simWait(0.8, 240000,() => {
      const y = C.netYaw();
      turn += Math.abs(Math.atan2(Math.sin(y - prev), Math.cos(y - prev)));
      prev = y;
      return false;
    });
    const camDeg = q0.angleTo(p.camera.quaternion) * 180 / Math.PI;
    const r = { turn: turn * 180 / Math.PI, yawDiff: Math.abs(p.yaw - y0) * 180 / Math.PI, camDeg, net: C.netYaw(), own: p.yaw };
    sys.set('spinbot', false);
    r.after = C.netYaw() === (p.yaw || 0);
    return r;
  });
  check(spin.turn > 180 && spin.yawDiff < 0.5 && spin.camDeg < 3, `Spinbot: sichtbare Gierung ${Math.round(spin.turn)}° gedreht, eigene Sicht ${spin.yawDiff.toFixed(2)}°, Kamera ${spin.camDeg.toFixed(2)}°`);
  check(spin.after, 'Spinbot aus → übertragene Gierung = eigene Sicht');

  // --- Auto-Sprung
  const hop = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    sys.set('bunnyhop', true);
    const j0 = C.jumps;
    G.input.simulate.press('jump');
    await C.simWait(2.5);
    G.input.simulate.release('jump');
    const on = C.jumps - j0;
    sys.set('bunnyhop', false);
    const j1 = C.jumps;
    G.input.simulate.press('jump');
    await C.simWait(2.0);
    G.input.simulate.release('jump');
    return { on, off: C.jumps - j1 };
  });
  check(hop.on >= 3 && hop.off <= 1, `Auto-Sprung: Taste gehalten → ${hop.on} Sprünge (aus: ${hop.off})`);

  // --- Punktetabelle: Symbol beim eigenen Spieler
  const sb = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    C.sys().set('markieren', true);
    G.input.simulate.press('scoreboard');
    await C.simWait(0.5);
    const me = document.querySelector('.sb-row.is-me');
    const icon = me && me.querySelector('.sb-cheat');
    const others = document.querySelectorAll('.sb-row:not(.is-me) .sb-cheat').length;
    return { icon: !!icon, title: icon && icon.getAttribute('title'), others, row: G.mode.scoreboard().find((r) => r.isPlayer).cheat };
  });
  check(sb.icon && sb.title === 'Cheat-Menü aktiv' && sb.others === 0 && sb.row === true, `Punktetabelle: Symbol „${sb.title}“ beim eigenen Spieler, bei Bots keins (${sb.others})`);
  await shot(p, 'cheat-scoreboard.png');
  const sbOff = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    C.sys().reset();
    await C.simWait(0.5);
    const n = document.querySelectorAll('.sb-row.is-me .sb-cheat').length;
    G.input.simulate.release('scoreboard');
    return n;
  });
  check(sbOff === 0, 'alle Schalter aus → kein Symbol mehr');

  // --- Matchende setzt zurück; neues Match (TDM): Folge reagiert nicht
  const end = await p.evaluate(async () => {
    const G = window.__game;
    const C = window.__ct;
    const sys = C.sys();
    sys.set('spinbot', true);
    sys.set('markieren', true);
    G.debugApi.endMatch();
    await new Promise((r) => setTimeout(r, 300));
    return { st: G.match.state, active: sys.active, spin: G.player.spinYaw, marks: sys.ui.visibleMarkers().length };
  });
  check(end.st === 'ended' && !end.active && end.spin == null, `Matchende: Schalter aus (aktiv ${end.active}, Spinbot ${end.spin})`);
  await p.evaluate(() => { window.__ct.old = window.__ct.sys(); window.__game.debugApi.start({ modeId: 'tdm', mapId: 'werk', allies: 1, enemies: 2, difficulty: 'rekrut' }); });
  const tdm = await until(p, () => window.__game.match.state === 'playing' && window.__game.mode && window.__game.mode.id === 'tdm' && window.__game.player.alive, null, 300000, 1000);
  if (check(!!tdm, 'neues Match TDM läuft')) {
    await p.evaluate(() => { window.__game.input.allowUnlockedMouse = true; });
    await instrument(p);
    await sequence(p);
    const t = await p.evaluate(() => {
      const G = window.__game;
      const old = window.__ct.old;
      const s = G.mode.cheats;
      return { dlg: document.querySelector('.cm-dlg') && document.querySelector('.cm-dlg').dataset.cheat, fresh: !!s && s !== old && !s.unlocked, layer: !!(old && old.ui.layer), hold: !!G.match.uiHold, spin: G.player.spinYaw, st: G.match.state };
    });
    check(t.dlg === 'code' && t.fresh && !t.layer && t.spin == null && t.st === 'playing', `TDM: neues Cheat-System, Folge verlangt wieder den Code (${t.dlg}), keine Reste (alte Ebene ${t.layer}, Spinbot ${t.spin})`);
    if (t.dlg === 'code') {
      await p.keyboard.type('NULLPUNKT');
      await p.keyboard.press('Enter');
      await sleep(300);
      check((await dlg(p)) === 'menu', 'TDM: Code → Menü');
      await p.keyboard.press('Escape');
      await sleep(250);
    }
    // Schusswaffen-Aimbot + Auto-Feuer: angehaltener Bot hinter dem Spieler, Kopftreffer
    const gun = await p.evaluate(async () => {
      const G = window.__game;
      const C = window.__ct;
      const sys = C.sys();
      G.debugApi.godMode(true);
      C.freezeAll();
      const b = C.enemies()[0];
      const s = C.spot(14, Math.PI);
      if (!b || !s) return { err: !b ? 'kein Gegner' : 'kein freier Platz' };
      C.place(b, s);
      C.banish(b);
      let head = 0, hits = 0;
      const off = G.events.on('actor:hit', (e) => { if (e && e.attacker === G.player && e.target === b) { hits++; if (e.zone === 'head') head++; } });
      const y0 = G.player.yaw;
      const k0 = G.player.stats.kills;
      sys.set('aimbot', true);
      sys.set('autofeuer', true);
      const on = sys.on.aimbot && sys.on.autofeuer;
      const sim = await C.simWait(4, 240000, () => !b.alive);
      const turned = Math.abs(Math.atan2(Math.sin(G.player.yaw - y0), Math.cos(G.player.yaw - y0))) * 180 / Math.PI;
      if (typeof off === 'function') off();
      return { err: null, on, dead: !b.alive, kills: G.player.stats.kills - k0, shots: sys.stats.shots || 0, hits, head, turned, sim, w: G.player.weapon.currentDef.id, d: s.pos.distanceTo(G.player.position) };
    });
    if (gun.err) check(false, `Schusswaffen-Aimbot-Aufbau: ${gun.err}`);
    else check(gun.on && gun.dead && gun.kills >= 1 && gun.head >= 1 && gun.turned > 100, `Schusswaffen-Aimbot + Auto-Feuer (${gun.w}, ${f1(gun.d)} m hinter dem Spieler): gedreht ${f1(gun.turned)}°, ${gun.shots} Abzug-Bilder, Treffer ${gun.hits} (Kopf ${gun.head}), Abschuss ${gun.kills} (${f1(gun.sim)} s)`);
    await shot(p, 'cheat-gun.png');
    await p.evaluate(() => { const s = window.__ct.sys(); s.set('aimbot', false); s.set('autofeuer', false); });
  }
  check(!errs.length, `keine Seiten-/Konsolenfehler${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

async function online(browser) {
  info('— Online (Host + 1 Client, Team-Deathmatch) —');
  await waitForLoad();
  const pages = [];
  const errs = {};
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const p = await ctx.newPage();
    errs[name] = [];
    watchErrors(p, errs[name]);
    await p.goto(`${BASE}spielen.html?quality=${QUALITY}&relays=${encodeURIComponent(RELAY)}`);
    await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 180000 });
    await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
    pages.push(ctx);
    return p;
  };
  try {
    const host = await open('Hosti');
    const cl = await open('Anna');
    const code = await host.evaluate(() => window.__game.net.host({ name: 'Messer', mode: 'tdm', map: 'werk', maxPlayers: 4, teamSize: 3, pvp: 'pvp', botFill: true, difficulty: 'rekrut', style: 'arcade' }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
    check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
    // Online-Team-Deathmatch (Cheat-Menü gilt seit 10.10. in allen Modi)
    const room = await host.evaluate(() => {
      const N = window.__game.net;
      window.__game.menus.net.showRoom();
      return { cheat: N.room.settings.cheatMenu, mode: N.room.settings.mode };
    });
    check(room.cheat === true, `Raum-Einstellung cheatMenu Standard erlaubt (${room.cheat})`);
    await sleep(600);
    const swi = await host.evaluate(() => {
      const b = document.querySelector('[data-toggle="cheatMenu"]');
      if (b) b.scrollIntoView({ block: 'center' });
      return b ? { on: b.getAttribute('aria-checked'), text: b.closest('.nr-switch').textContent.replace(/\s+/g, ' ').trim() } : null;
    });
    check(!!swi && swi.on === 'true', `Host-Einstellung sichtbar: „${swi && swi.text}“ (${swi && swi.on})`);
    await shot(host, 'cheat-host-setting.png');
    let j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
    if (!j.ok) { info(`Beitritt ${j.code} – zweiter Versuch`); j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code); }
    if (!check(j.ok, `Client tritt bei (${j.ok ? `id ${j.id}` : j.code})`)) return;
    await until(host, () => window.__game.net.roster.length === 2, null, 20000);
    await host.evaluate(() => window.__game.net.startMatch());
    const inMatch = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.mode && window.__game.mode.id, null, 600000, 1000)));
    if (!check(inMatch.every((m) => m === 'tdm'), `Host + Client im Online-Match (${inMatch.join(', ')})`)) return;
    await instrument(host);
    await instrument(cl);
    // Host-Bots angehalten (nur für den Test): der Client bleibt am Leben, Ausweichen/Auto-Messer unten gezielt aufgebaut
    await host.evaluate(() => { const G = window.__game; G.debugApi.godMode(true); G.input.allowUnlockedMouse = true; window.__ct.freezeAll(); });
    await cl.evaluate(() => { const G = window.__game; G.player.godMode = true; G.input.allowUnlockedMouse = true; });
    const cfg = await cl.evaluate(() => window.__game.match.net && window.__game.match.net.cheatMenu);
    check(cfg === true, `Client: cfg.net.cheatMenu ${cfg}`);
    // Client schaltet frei und aktiviert „Gegner markieren“
    await sequence(cl);
    check((await dlg(cl)) === 'code', 'Client: Folge → Code-Feld');
    await cl.keyboard.type('NULLPUNKT');
    await cl.keyboard.press('Enter');
    await sleep(300);
    check((await dlg(cl)) === 'menu', 'Client: Code → Menü');
    await cl.click('[data-cheat-id="markieren"]');
    await cl.keyboard.press('Escape');
    const rosterOn = await until(host, (id) => { const e = window.__game.net.rosterEntry(id); return e && e.cheat === true; }, j.id, 20000, 300);
    check(!!rosterOn, 'Host: Roster-Eintrag des Clients cheat = true');
    const hostSb = await host.evaluate(async (id) => {
      const G = window.__game;
      G.input.simulate.press('scoreboard');
      await window.__ct.simWait(0.6, 30000);
      const row = G.mode.scoreboard().find((r) => r.actor && r.actor.netId === id);
      const icons = [...document.querySelectorAll('.sb-row .sb-cheat')].map((n) => n.closest('.sb-row').querySelector('.sb-n').textContent);
      return { row: row && row.cheat, icons, me: G.mode.scoreboard().find((r) => r.isPlayer).cheat };
    }, j.id);
    check(hostSb.row === true && hostSb.icons.includes('Anna') && !hostSb.me, `Host-Punktetabelle: Symbol bei ${hostSb.icons.join(', ') || '–'} (Host selbst ${!!hostSb.me})`);
    await shot(host, 'cheat-online-host.png');
    await host.evaluate(() => window.__game.input.simulate.release('scoreboard'));
    const clSelf = await cl.evaluate(() => window.__game.mode.scoreboard().find((r) => r.isPlayer).cheat);
    check(clSelf === true, 'Client: eigene Zeile mit Symbol');

    // Online-Wirkung ohne Anti-Cheat-Folgen: Host hält seine Bots an; ein Gegner-Bot zielt auf die Puppe des Clients
    // (Ausweichen), danach steht er neben ihr (Auto-Messer). Spinbot: die Puppe beim Host dreht sich, die Sicht des Clients nicht.
    const acCount = () => host.evaluate((id) => { const ac = window.__game.net.anticheat; return ac ? ac.log.filter((e) => e.peer === id).map((e) => e.reason) : null; }, j.id);
    const ac0 = await acCount();
    await cl.evaluate(() => { const C = window.__ct; C.corrects = 0; window.__game.net.on('correct', () => { C.corrects++; }); });
    await until(cl, () => window.__game.player.alive, null, 60000, 500);
    const prep = await host.evaluate((id) => {
      const G = window.__game;
      const C = window.__ct;
      C.freezeAll();
      const pup = G.actors.find((a) => a.netId === id);
      if (!pup || !pup.alive) return { err: 'Puppe des Clients fehlt oder tot' };
      const foes = G.actors.filter((a) => a.isBot && !a.isRemoteHuman && G.combat.isHostile(pup, a));
      const b = foes.find((a) => a.alive) || foes[0];
      if (!b) return { err: 'kein gegnerischer Bot' };
      const chest = pup.position.clone(); chest.y += 1.15;
      const spot = G.world.nav.nodesInRadius(pup.position, 18).map((n) => n.position).find((q) => {
        const d = q.distanceTo(pup.position);
        if (d < 7 || Math.abs(q.y - pup.position.y) > 1.5) return false;
        const e = q.clone(); e.y += 1.6;
        return G.world.lineOfSight(e, chest);
      });
      if (!spot) return { err: 'kein Platz mit Sicht auf den Client' };
      // übrige Gegner weit weg
      const far = G.world.nav.nodesInRadius(pup.position, 400).sort((x, y) => y.position.distanceTo(pup.position) - x.position.distanceTo(pup.position));
      let i = 0;
      for (const o of foes) if (o !== b && o.alive) { const n = far[(i++ * 3) % Math.max(1, far.length)]; if (n) { o.body.teleport(n.position.clone()); C.sync(o); } }
      C.place(b, { pos: spot.clone() });
      C.foe = b;
      C.pup = pup;
      C.stopAim = false;
      return { err: null, name: b.name, netId: b.netId, d: spot.distanceTo(pup.position) };
    }, j.id);
    if (prep.err) check(false, `Online-Aufbau: ${prep.err}`);
    else {
      // Host: Bot zielt fortlaufend auf die Puppe (bis stopAim); Client: Ausweichen an, Seitschritte zählen
      const aiming = host.evaluate(async () => {
        const G = window.__game;
        const C = window.__ct;
        const r0 = performance.now();
        while (!C.stopAim && performance.now() - r0 < 300000) {
          const b = C.foe;
          const e = b.getEyePosition(new G.THREE.Vector3());
          const to = C.pup.position.clone(); to.y += 1.15; to.sub(e);
          b.yaw = Math.atan2(-to.x, -to.z);
          b.pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
          await new Promise((r) => setTimeout(r, 25));
        }
        return true;
      });
      const dodgeOn = await cl.evaluate(async () => {
        const G = window.__game;
        const C = window.__ct;
        const sys = C.sys();
        const p = G.player;
        sys.set('ausweichen', true);
        const d0 = sys.stats.dodges;
        const start = p.position.clone();
        let maxD = 0, maxV = 0;
        const sim = await C.simWait(6, 240000, () => {
          maxD = Math.max(maxD, p.position.distanceTo(start));
          maxV = Math.max(maxV, Math.hypot(p.body.velocity.x, p.body.velocity.z));
          return sys.stats.dodges - d0 >= 3;
        });
        sys.set('ausweichen', false);
        return { dodges: sys.stats.dodges - d0, maxD, maxV, sim, threat: sys.threat ? sys.threat.name : null };
      });
      await host.evaluate(() => { window.__ct.stopAim = true; });
      await aiming;
      check(dodgeOn.dodges >= 1 && dodgeOn.maxD > 0.5 && dodgeOn.maxV <= 6.5, `Client: Ausweichen online – ${dodgeOn.dodges} Seitschritt(e) vor ${prep.name} (${f1(prep.d)} m), bis ${f1(dodgeOn.maxD)} m, höchstens ${f1(dodgeOn.maxV)} m/s (${f1(dodgeOn.sim)} s)`);
      // Auto-Messer: Bot (angehalten) direkt neben die Puppe des Clients
      const near = await host.evaluate(() => {
        const G = window.__game;
        const T = G.THREE;
        const C = window.__ct;
        const pup = C.pup;
        const b = C.foe;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const q = pup.position.clone().add(new T.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5));
          const e = pup.position.clone(); e.y += 1.2;
          const t = q.clone(); t.y += 1.1;
          if (!G.world.lineOfSight(e, t)) continue;
          const g = G.world.raycast(q.clone().setY(q.y + 0.8), new T.Vector3(0, -1, 0), 3);
          if (!g || Math.abs(g.point.y - pup.position.y) > 0.4) continue;
          C.place(b, { pos: g.point.clone() });
          return { ok: true };
        }
        return { ok: false };
      });
      if (!near.ok) info('Auto-Messer online nicht geprüft: kein Platz neben der Puppe');
      else {
        const hostKills = () => host.evaluate((id) => { const r = window.__game.mode.scoreboard().find((x) => x.actor && x.actor.netId === id); return r ? r.kills : -1; }, j.id);
        const hk0 = await hostKills();
        const stab = await cl.evaluate(async (fid) => {
          const G = window.__game;
          const C = window.__ct;
          const sys = C.sys();
          sys.set('automesser', true);
          const s0 = sys.stats.stabs;
          const k0 = G.player.stats.kills;
          const foe = () => G.actors.find((a) => a.netId === fid);
          const sim = await C.simWait(6, 240000, () => G.player.stats.kills > k0 || (foe() && !foe().alive));
          sys.set('automesser', false);
          return { stabs: sys.stats.stabs - s0, kills: G.player.stats.kills - k0, dead: !!(foe() && !foe().alive), sim };
        }, prep.netId);
        const hostDead = await until(host, () => !window.__ct.foe.alive, null, 30000, 300);
        const hk1 = await hostKills();
        check(stab.stabs >= 1 && !!hostDead && hk1 > hk0, `Client: Auto-Messer online – ${stab.stabs} Stich(e), Bot beim Host ${hostDead ? 'abgestochen' : 'lebt'}, Abschuss für den Client beim Host ${hk0} → ${hk1} (${f1(stab.sim)} s)`);
        // Messer ohne Abklingzeit online: Bot mit sehr viel Gesundheit neben der Puppe, Client sticht schnell hintereinander
        const tough = await host.evaluate(() => {
          const G = window.__game;
          const T = G.THREE;
          const C = window.__ct;
          const pup = C.pup;
          const b = C.foe;
          C.turboHits = 0;
          C.foeMax = C.foeMax || b.maxHealth;
          if (!C.turboListen) { C.turboListen = true; G.events.on('weapon:meleeHit', (e) => { if (e.actor === C.pup && e.target === C.foe) C.turboHits++; }); }
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const q = pup.position.clone().add(new T.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5));
            const e = pup.position.clone(); e.y += 1.2;
            const t = q.clone(); t.y += 1.1;
            if (!G.world.lineOfSight(e, t)) continue;
            const g = G.world.raycast(q.clone().setY(q.y + 0.8), new T.Vector3(0, -1, 0), 3);
            if (!g || Math.abs(g.point.y - pup.position.y) > 0.4) continue;
            C.place(b, { pos: g.point.clone() });
            b.maxHealth = b.health = 1e6;
            return true;
          }
          return false;
        });
        if (!tough) info('Messer ohne Abklingzeit online nicht geprüft: kein Platz neben der Puppe');
        else {
          const tb = await cl.evaluate(async () => {
            const G = window.__game;
            const C = window.__ct;
            const sys = C.sys();
            sys.set('turbomesser', true);
            sys.set('automesser', true);
            const s0 = sys.stats.stabs;
            const sim = await C.simWait(3, 240000, () => sys.stats.stabs - s0 >= 12);
            sys.set('automesser', false);
            sys.set('turbomesser', false);
            return { stabs: sys.stats.stabs - s0, sim };
          });
          const got = await until(host, (n) => window.__ct.turboHits >= Math.min(n, 4) && window.__ct.turboHits, tb.stabs, 20000, 300);
          check(tb.stabs >= 4 && got >= 4, `Client: Messer ohne Abklingzeit online – ${tb.stabs} Stiche in ${f1(tb.sim)} s, beim Host angenommen ${got || 0}`);
        }
        // Prüfregel direkt: 20 Stiche in derselben Sekunde – ohne Ausnahme Feuerrate-Verstoß, mit ctx.noRate keiner
        const rule = await host.evaluate(async () => {
          const N = window.__game.net;
          const AC = N.anticheat.constructor;
          const { WEAPONS } = await import(new URL('assets/js/shared/weapons.data.js', location.href).href);
          const run = (noRate) => {
            const ac = new AC({ onKick: () => {} });
            const out = [];
            for (let i = 0; i < 20; i++) {
              const r = ac.validateMelee(77, { target: 5, weapon: 'knife', serial: i + 1, dmg: 135 }, { now: 100, noRate, weapons: WEAPONS, shooter: { alive: true, team: 'A', weapons: ['knife'] }, target: { alive: true, team: 'B' } });
              out.push(r.reason);
            }
            return out;
          };
          const a = run(false);
          const b = run(true);
          return { without: a.filter((x) => x === 'feuerrate').length, with: b.filter((x) => x === 'feuerrate').length, okWith: b.filter((x) => x === 'ok').length };
        });
        check(rule.without > 0 && rule.with === 0 && rule.okWith === 20, `Anti-Cheat-Regel: 20 Stiche/Sekunde ohne Ausnahme ${rule.without}× Feuerrate, mit Ausnahme ${rule.with}× (angenommen ${rule.okWith})`);
      }
      // Spinbot: Gierung der Puppe beim Host dreht sich, die eigene Sicht des Clients bleibt
      const yaw0 = await cl.evaluate(() => { window.__ct.sys().set('spinbot', true); return window.__game.player.yaw; });
      const spun = await host.evaluate(async () => {
        const C = window.__ct;
        const pup = C.pup;
        let turn = 0;
        let prev = pup.yaw;
        await C.simWait(3, 240000, () => {
          const y = pup.yaw;
          turn += Math.abs(Math.atan2(Math.sin(y - prev), Math.cos(y - prev)));
          prev = y;
          return turn > Math.PI * 2;
        });
        return turn * 180 / Math.PI;
      });
      const yaw1 = await cl.evaluate(() => { window.__ct.sys().set('spinbot', false); return window.__game.player.yaw; });
      const own = Math.abs(Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0))) * 180 / Math.PI;
      check(spun > 180 && own < 0.5, `Spinbot online: Puppe beim Host ${Math.round(spun)}° gedreht, eigene Sicht des Clients ${own.toFixed(2)}°`);
      // Schusswaffen-Aimbot + Auto-Feuer online: angehaltener Host-Bot ~12 m von der Puppe, der Host wertet den Abschuss
      const far = await host.evaluate(() => {
        const G = window.__game;
        const T = G.THREE;
        const C = window.__ct;
        const pup = C.pup;
        const b = C.foe;
        const e = pup.position.clone(); e.y += 1.5;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const q = pup.position.clone().add(new T.Vector3(Math.cos(a) * 12, 0, Math.sin(a) * 12));
          const t = q.clone(); t.y += 1.3;
          if (!G.world.lineOfSight(e, t)) continue;
          const g = G.world.raycast(q.clone().setY(q.y + 1.5), new T.Vector3(0, -1, 0), 4);
          if (!g || Math.abs(g.point.y - pup.position.y) > 0.8) continue;
          t.copy(g.point); t.y += 1.5;
          if (!G.world.lineOfSight(e, t)) continue;
          if (!b.alive) G.spawnActor(b);
          C.place(b, { pos: g.point.clone() });
          b.maxHealth = C.foeMax || 100;
          b.health = b.maxHealth;
          return { ok: true, d: pup.position.distanceTo(g.point) };
        }
        return { ok: false };
      });
      if (!far.ok) info('Schusswaffen-Aimbot online nicht geprüft: kein freier Platz in 12 m');
      else {
        const hostKills = () => host.evaluate((id) => { const r = window.__game.mode.scoreboard().find((x) => x.actor && x.actor.netId === id); return r ? r.kills : -1; }, j.id);
        const gk0 = await hostKills();
        const shoot = await cl.evaluate(async () => {
          const G = window.__game;
          const C = window.__ct;
          const sys = C.sys();
          const w = G.player.weapon;
          sys.set('aimbot', true);
          sys.set('autofeuer', true);
          const k0 = G.player.stats.kills;
          const sim = await C.simWait(6, 240000, () => G.player.stats.kills > k0);
          sys.set('aimbot', false);
          sys.set('autofeuer', false);
          return { shots: sys.stats.shots || 0, kills: G.player.stats.kills - k0, sim, w: w.currentDef.id };
        });
        const foeDead = await until(host, () => !window.__ct.foe.alive, null, 30000, 300);
        const gk1 = await hostKills();
        check(!!foeDead && gk1 > gk0 && shoot.shots > 0, `Client: Schusswaffen-Aimbot + Auto-Feuer online (${shoot.w}, ${f1(far.d)} m) – ${shoot.shots} Abzug-Bilder, Bot beim Host ${foeDead ? 'erledigt' : 'lebt'}, Abschuss für den Client beim Host ${gk0} → ${gk1} (${f1(shoot.sim)} s)`);
      }
      const ac1 = await acCount();
      const corr = await cl.evaluate(() => window.__ct.corrects);
      const fresh = ac0 && ac1 ? ac1.slice(ac0.length) : null;
      check(!!fresh && !fresh.length && corr === 0, `Anti-Cheat des Hosts: keine Verstöße des Clients (${fresh ? fresh.join(', ') || 'keine' : '–'}), Rücksetzungen ${corr}`);
    }

    // Host verbietet → Client: Schalter aus, Roster zurück, Folge öffnet nichts
    await host.evaluate(() => { const N = window.__game.net; N.updateSettings({ cheatMenu: false }); });
    const off = await until(cl, () => { const G = window.__game; const s = G.mode.cheats; return G.net.room.settings.cheatMenu === false && s && !s.active && { notes: window.__ct.notices() }; }, null, 20000, 300);
    check(!!off, `Client: Host verbietet → alle Schalter aus${off ? ` (Meldung „${off.notes.find((t) => /Host/.test(t)) || '–'}“)` : ''}`);
    const rosterOff = await until(host, (id) => { const e = window.__game.net.rosterEntry(id); return e && e.cheat === false; }, j.id, 20000, 300);
    check(!!rosterOff, 'Host: Roster-Eintrag des Clients wieder cheat = false');
    await sleep(500);
    await sequence(cl);
    const blocked = await cl.evaluate(() => ({ dlg: !!document.querySelector('.cm-dlg'), notes: window.__ct.notices() }));
    check(!blocked.dlg && blocked.notes.some((t) => /vom Host deaktiviert/i.test(t)), `Client: Folge öffnet nichts („${blocked.notes.find((t) => /Host/.test(t)) || '–'}“)`);
    const e = Object.entries(errs).filter(([, l]) => l.length);
    check(!e.length, `keine Seiten-/Konsolenfehler${e.length ? `: ${e.map(([n, l]) => `${n}: ${l.slice(0, 2).join(' | ')}`).join('; ')}` : ''}`);
  } finally {
    for (const c of pages) await c.close().catch(() => {});
  }
}

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
try {
  if (ONLY.includes('offline')) await offline(browser);
  if (ONLY.includes('online')) await online(browser);
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
