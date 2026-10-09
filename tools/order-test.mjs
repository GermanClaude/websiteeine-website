// NULLPUNKT — Befehlsrad-Test (ui/command-wheel.js, bots/ai/orders.js) in Headless-Chromium (spielen.html, SwiftShader).
//   Offline (TDM Hafen, 5 Verbündete, Gegner tot und ohne Wiedereinstieg): jeder Befehl über den Eingabeweg (Taste
//   „befehl“ halten, Maus in Richtung des Felds, loslassen) und Prüfung des Verhaltens:
//     • Mir folgen: Spieler läuft einen Navigationspfad ab (Eingabe vorwärts, 5,4 m/s) – Folgende im Mittel ≤ 8 m entfernt
//     • Position halten: Spieler geht weg – Bots bleiben ≤ 3 m an ihrer Stellung
//     • Sammeln: alle ≤ 6 m beim Spieler · Formation Keil/Kreis: Kreis rundum ≤ 7,5 m
//     • Angreifen: Punkt unter dem Fadenkreuz, Bots rücken an (≤ 10 m oder Abstand −60 %), Weltmarkierung sichtbar
//     • Verteidigen: alle ≤ 10 m am Punkt · Ausschwärmen: auffächern (mittlerer Abstand untereinander ≥ 6 m)
//     • Frei handeln: Befehle weg · Gefecht: ein Gegner taucht auf – Folgende schießen trotzdem
//   Bildschirmfotos: Rad offen (Desktop), Markierung, Telefon (Touch: antippen → Felder; ziehen → Richtung).
//   Online (Host + 1 Client, Koop): Client befiehlt „Mir folgen“ → Host-Bots seines Teams folgen seiner Puppe.
// Voraussetzung: Server auf 8765; online zusätzlich node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/order-test.mjs [--only=offline|phone|online] [--quality=low] [--size=1280x720]
import { chromium, devices, BASE, GL_ARGS } from './pw.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const ONLY = opt.only ? String(opt.only).split(',') : ['offline', 'phone', 'online'];
const QUALITY = String(opt.quality || 'low');
const [W, H] = String(opt.size || '1280x720').split('x').map(Number); // Bildschirmfotos (Verhalten läuft in 640×360)
const RELAY = process.env.NP_RELAY || 'ws://127.0.0.1:7777';
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);
const r1 = (v) => Math.round(v * 10) / 10;

async function waitForLoad() {
  for (let i = 0; i < 15; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 5)) return;
    info(`Last ${l1} > 5 – warte 40 s`);
    await sleep(40000);
  }
}

async function until(p, fn, arg, timeout = 60000, every = 400) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}

/** Spielzeit warten (SwiftShader läuft oft langsamer als Echtzeit; dt ist auf 1/20 s begrenzt). */
async function gameWait(p, sec, timeout = 120000) {
  const t = await p.evaluate(() => window.__game.time.elapsed);
  await until(p, (end) => window.__game.time.elapsed >= end, t + sec, timeout, 200);
}

/** Seite mit Beobachtern und Hilfen ausstatten. */
async function instrument(p) {
  await p.evaluate(() => {
    const G = window.__game;
    G.input.allowUnlockedMouse = true;
    const T = (window.__ot = {});
    // Verbündete KI-Bots (offline/Host)
    T.allies = () => G.bots.bots.filter((b) => !b.puppet && b.team === G.player.team);
    T.alive = () => T.allies().filter((b) => b.alive);
    T.dists = (to) => T.alive().map((b) => b.position.distanceTo(to || G.player.position));
    T.kinds = () => T.alive().map((b) => (b.command ? b.command.kind : '-'));
    // Spieler einen Navigationspfad entlang steuern (echte Bewegung über die Eingabe: vorwärts + Blick zum nächsten Wegpunkt,
    // Laufen 5,4 m/s); festgefahren (3 s Spielzeit ohne 1 m Fortschritt) → Wegpunkt überspringen
    T.walk = (to) => {
      const nav = G.world.nav;
      const path = nav.findPath(G.player.position, to) || [];
      if (!path.length) return 0;
      const pts = [G.player.position.clone(), ...path];
      let i = 1;
      let best = Infinity, bestAt = G.time.elapsed;
      clearInterval(T._walk);
      T.walking = true;
      const stop = () => { clearInterval(T._walk); G.input.simulate.move(null); T.walking = false; };
      T._walk = setInterval(() => {
        const p = G.player.position;
        while (i < pts.length && Math.hypot(pts[i].x - p.x, pts[i].z - p.z) < 1.3) { i++; best = Infinity; }
        if (i >= pts.length || !G.player.alive) { stop(); return; }
        const dx = pts[i].x - p.x, dz = pts[i].z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < best - 1) { best = d; bestAt = G.time.elapsed; }
        else if (G.time.elapsed - bestAt > 3) { i++; best = Infinity; bestAt = G.time.elapsed; }
        G.player.yaw = Math.atan2(-dx, -dz);
        G.player.pitch = 0;
        G.input.simulate.move(0, 1);
      }, 30);
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += pts[k].distanceTo(pts[k - 1]);
      return len;
    };
    // Navigationsknoten im Abstand [a, b] vom Spieler (bevorzugt mit Sicht, gleiche Höhe ± 2 m)
    T.nodeAt = (a, b, sight = false) => {
      const nav = G.world.nav;
      const pp = G.player.position;
      const eye = G.player.getEyePosition(new pp.constructor());
      const list = nav.nodes.filter((n) => { const d = n.position.distanceTo(pp); return d >= a && d <= b && Math.abs(n.position.y - pp.y) < 2; });
      list.sort(() => Math.random() - 0.5);
      for (const n of list.slice(0, 200)) {
        if (sight) { const q = n.position.clone(); q.y += 1.2; if (!G.world.lineOfSight(eye, q)) continue; }
        const path = nav.findPath(pp, n.position);
        if (path && path.length) return [n.position.x, n.position.y, n.position.z];
      }
      return null;
    };
    T.notices = () => [...document.querySelectorAll('.h-notice')].map((n) => n.textContent);
    // Testaufbau: Verbündete 5–15 m um den Spieler versetzen (Knoten auf Spielerhöhe)
    T.gather = () => {
      const nav = G.world.nav;
      const pp = G.player.position;
      const nodes = nav.nodesInRadius(pp, 16).filter((n) => n.position.distanceTo(pp) > 5 && Math.abs(n.position.y - pp.y) < 1.5);
      T.alive().forEach((b, i) => { const n = nodes[(i * 7) % Math.max(1, nodes.length)]; if (n) { b.body.teleport(n.position.clone()); b.nav.reset(); } });
      return nodes.length;
    };
    T.enemiesOff = () => {
      for (const a of G.actors) {
        if (a === G.player || !G.combat.isHostile(G.player, a)) continue;
        if (a.alive) G.combat.damage(a, { amount: 9999, attacker: null, zone: 'body', dir: new G.player.position.constructor(0, 0, -1) });
        a.respawnAt = Infinity;
      }
    };
  });
}

/** Wheel-Feld i (0 = oben, im Uhrzeigersinn) über den Eingabeweg wählen und bestätigen. */
const WHEEL = ['follow', 'attack', 'spread', 'defend', 'hold', 'regroup', 'formation', 'free'];
async function order(p, id, { keep = false } = {}) {
  const i = WHEEL.indexOf(id);
  const a = (i * Math.PI) / 4;
  await p.evaluate(() => window.__game.input.simulate.press('befehl'));
  await until(p, () => window.__game.hud.wheel.isOpen, null, 8000, 50);
  await sleep(150);
  await p.evaluate(([x, y]) => window.__game.input.simulate.look(x, y), [Math.sin(a) * 160, -Math.cos(a) * 160]);
  await until(p, (k) => window.__game.hud.wheel.sel === k, i, 8000, 50);
  if (keep) return;
  await p.evaluate(() => window.__game.input.simulate.release('befehl'));
  await until(p, () => !window.__game.hud.wheel.isOpen, null, 8000, 50);
  await sleep(200);
}

// =================================================================== Offline
async function offline(browser) {
  info('— Offline (Desktop) —');
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  const big = async (on) => { await p.setViewportSize(on ? { width: W, height: H } : { width: 640, height: 360 }); await sleep(on ? 1500 : 300); };
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|WebGL|GL_|AudioContext/i.test(m.text())) errs.push(m.text()); });
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=5&enemies=1&diff=rekrut&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive, null, 300000, 1000);
  if (!check(!!ok, 'Match läuft (TDM Hafen, 5 Verbündete)')) { await ctx.close(); return; }
  await instrument(p);
  await p.evaluate(() => window.__ot.enemiesOff());
  await gameWait(p, 1.5);
  const binds = await p.evaluate(() => ({ kb: window.__game.input.label('befehl', 'kb'), pad: window.__game.input.label('befehl', 'pad') }));
  check(!!binds.kb && !!binds.pad, `Aktion „befehl“ belegt (Tastatur ${binds.kb}, Gamepad ${binds.pad})`);
  const nAllies = await p.evaluate(() => window.__ot.alive().length);
  info(`${nAllies} verbündete Bots leben`);

  // --- Mir folgen (Testaufbau: Verbündete um den Spieler)
  await p.evaluate(() => window.__ot.gather());
  await gameWait(p, 0.5);
  await order(p, 'follow');
  let kinds = await p.evaluate(() => window.__ot.kinds());
  check(kinds.filter((k) => k === 'follow').length >= Math.min(3, nAllies), `Mir folgen: ${kinds.filter((k) => k === 'follow').length}/${kinds.length} Bots (${kinds.join(',')})`);
  const toast = await p.evaluate(() => window.__ot.notices().join(' | '));
  check(/Befehl: Mir folgen \(\d+ Bots?\)/.test(toast), `Hinweis: „${toast}“`);
  await gameWait(p, 3);
  const target = await p.evaluate(() => window.__ot.nodeAt(45, 70));
  const len = await p.evaluate((t) => window.__ot.walk(new window.__game.player.position.constructor(...t)), target);
  info(`Spieler läuft ${r1(len)} m (Eingabe vorwärts, 5,4 m/s) – ${await p.evaluate(() => window.__game.renderer.info().fps)} FPS`);
  const samples = [];
  for (let k = 0; k < 80; k++) {
    await gameWait(p, 0.5);
    const s = await p.evaluate(() => ({ d: window.__ot.dists(), walking: window.__ot.walking }));
    if (s.d.length) samples.push(s.d.reduce((a, b) => a + b, 0) / s.d.length);
    if (!s.walking) break;
  }
  await gameWait(p, 3);
  const endD = await p.evaluate(() => window.__ot.dists());
  const meanFollow = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 99;
  check(meanFollow <= 8, `Mir folgen: mittlerer Abstand beim Laufen ${r1(meanFollow)} m (≤ 8), höchstens ${r1(Math.max(...samples))} m`);
  check(endD.length && Math.max(...endD) <= 9, `Mir folgen: nach dem Anhalten alle nah (${endD.map(r1).join(', ')} m)`);
  await p.screenshot({ path: `${OUT}/order-follow.png` });

  // --- Position halten
  await order(p, 'hold');
  await gameWait(p, 4);
  const spots = await p.evaluate(() => window.__ot.alive().map((b) => (b.command && b.command.spot ? [b.command.spot.x, b.command.spot.y, b.command.spot.z] : null)));
  check(spots.every(Boolean), `Position halten: alle mit Stellung (${spots.length})`);
  const away = await p.evaluate(() => window.__ot.nodeAt(28, 45));
  await p.evaluate((t) => window.__ot.walk(new window.__game.player.position.constructor(...t)), away);
  await gameWait(p, 9);
  const holdD = await p.evaluate(() => window.__ot.alive().map((b) => (b.command && b.command.spot ? b.position.distanceTo(b.command.spot) : 99)));
  const pd = await p.evaluate(() => window.__ot.dists());
  check(holdD.every((d) => d <= 3), `Position halten: Abstand zur Stellung ${holdD.map(r1).join(', ')} m (≤ 3), Spieler jetzt ${pd.map(r1).join(', ')} m entfernt`);

  // --- Sammeln
  await until(p, () => !window.__ot.walking, null, 30000, 300);
  const before = await p.evaluate(() => window.__ot.dists());
  await order(p, 'regroup');
  let regOk = null;
  for (let k = 0; k < 40 && !regOk; k++) {
    await gameWait(p, 0.5);
    const d = await p.evaluate(() => window.__ot.dists());
    if (d.length && Math.max(...d) <= 6) regOk = d;
  }
  const after = await p.evaluate(() => window.__ot.dists());
  check(!!regOk, `Sammeln: vorher ${before.map(r1).join(', ')} m → ${after.map(r1).join(', ')} m (alle ≤ 6)`);
  await gameWait(p, 2);
  const crouch = await p.evaluate(() => window.__ot.alive().filter((b) => b.crouching).length);
  info(`Sammeln: ${crouch} Bots gehen in die Hocke (Rundumsicherung)`);

  // --- Formation (Keil, dann Kreis)
  await order(p, 'formation');
  let form = await p.evaluate(() => window.__ot.alive().map((b) => b.command && b.command.formation));
  check(form.every((f) => f === 'keil'), `Formation 1. Wahl: Keil (${form.join(',')})`);
  await gameWait(p, 2);
  await order(p, 'formation');
  form = await p.evaluate(() => window.__ot.alive().map((b) => b.command && b.command.formation));
  check(form.every((f) => f === 'kreis'), `Formation 2. Wahl: Kreis (${form.join(',')})`);
  await gameWait(p, 8);
  const ring = await p.evaluate(() => {
    const pp = window.__game.player.position;
    const a = window.__ot.alive().map((b) => Math.atan2(b.position.x - pp.x, b.position.z - pp.z)).sort((x, y) => x - y);
    let gap = 0;
    for (let i = 0; i < a.length; i++) gap = Math.max(gap, ((a[(i + 1) % a.length] - a[i]) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2);
    return { d: window.__ot.dists(), gap: (gap * 180) / Math.PI };
  });
  check(ring.d.length && Math.max(...ring.d) <= 7.5 && ring.gap < 200, `Formation Kreis: Abstände ${ring.d.map(r1).join(', ')} m, größte Winkellücke ${Math.round(ring.gap)}°`);
  await p.screenshot({ path: `${OUT}/order-kreis.png` });

  // --- Angreifen (Punkt unter dem Fadenkreuz), mit Bildschirmfoto des offenen Rads
  const atk = await p.evaluate(() => window.__ot.nodeAt(30, 50, true));
  check(!!atk, `Angriffsziel mit Sicht gefunden (${atk && atk.map(r1).join(', ')})`);
  if (atk) {
    await p.evaluate((t) => window.__game.debugApi.lookAt(t[0], t[1] + 0.3, t[2]), atk);
    await gameWait(p, 0.4);
    const d0 = await p.evaluate((t) => window.__ot.dists(new window.__game.player.position.constructor(...t)), atk);
    await big(true);
    await order(p, 'attack', { keep: true });
    await sleep(800);
    await p.screenshot({ path: `${OUT}/order-wheel-desktop.png`, timeout: 120000 });
    await p.evaluate(() => window.__game.input.simulate.release('befehl'));
    await until(p, () => !window.__game.hud.wheel.isOpen, null, 8000, 50);
    kinds = await p.evaluate(() => window.__ot.kinds());
    check(kinds.every((k) => k === 'attack'), `Angreifen: Befehl an alle (${kinds.join(',')})`);
    const pt = await p.evaluate(() => { const b = window.__ot.alive()[0]; return b && b.command && b.command.point ? [b.command.point.x, b.command.point.y, b.command.point.z] : null; });
    info(`Angriffspunkt (Fadenkreuz) ${pt && pt.map(r1).join(', ')} – Ziel ${atk.map(r1).join(', ')}`);
    const mark = await p.evaluate(() => { const m = document.querySelector('.cw-mark'); return m ? m.textContent : null; });
    check(!!mark, `Weltmarkierung: „${mark}“`);
    await gameWait(p, 2);
    await p.screenshot({ path: `${OUT}/order-marker-desktop.png`, timeout: 120000 });
    await big(false);
    let best = null;
    for (let k = 0; k < 30; k++) {
      await gameWait(p, 0.5);
      const d = await p.evaluate((t) => window.__ot.dists(new window.__game.player.position.constructor(...t)), pt || atk);
      const m = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
      best = best === null ? m : Math.min(best, m);
      if (m <= 10) break;
    }
    const m0 = d0.reduce((a, b) => a + b, 0) / Math.max(1, d0.length);
    check(best <= 10 || best <= m0 * 0.4, `Angreifen: mittlerer Abstand zum Ziel ${r1(m0)} → ${r1(best)} m`);
  }

  // --- Verteidigen
  const def = await p.evaluate(() => window.__ot.nodeAt(15, 30, true));
  if (def) {
    await p.evaluate((t) => window.__game.debugApi.lookAt(t[0], t[1] + 0.3, t[2]), def);
    await gameWait(p, 0.4);
    await order(p, 'defend');
    const pt = await p.evaluate(() => { const b = window.__ot.alive()[0]; return b && b.command && b.command.point ? [b.command.point.x, b.command.point.y, b.command.point.z] : null; });
    let dd = null;
    for (let k = 0; k < 40; k++) {
      await gameWait(p, 0.5);
      dd = await p.evaluate((t) => window.__ot.dists(new window.__game.player.position.constructor(...t)), pt);
      if (dd.length && Math.max(...dd) <= 10) break;
    }
    kinds = await p.evaluate(() => window.__ot.kinds());
    check(kinds.every((k) => k === 'defend') && dd && Math.max(...dd) <= 10, `Verteidigen: Abstände zum Punkt ${dd && dd.map(r1).join(', ')} m (≤ 10)`);
  } else check(false, 'Verteidigungspunkt gefunden');

  // --- Ausschwärmen
  const spr = await p.evaluate(() => window.__ot.nodeAt(30, 45, true));
  if (spr) {
    await p.evaluate((t) => window.__game.debugApi.lookAt(t[0], t[1] + 0.3, t[2]), spr);
    await gameWait(p, 0.4);
    await order(p, 'spread');
    await gameWait(p, 10);
    const sp = await p.evaluate(() => {
      const b = window.__ot.alive();
      let s = 0, n = 0;
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { s += b[i].position.distanceTo(b[j].position); n++; }
      const pt = b[0] && b[0].command && b[0].command.point;
      return { pair: n ? s / n : 0, toPt: pt ? b.map((x) => x.position.distanceTo(pt)) : [], kinds: b.map((x) => (x.command ? x.command.kind : '-')) };
    });
    check(sp.pair >= 6, `Ausschwärmen: mittlerer Abstand untereinander ${r1(sp.pair)} m, zum Ziel ${sp.toPt.map(r1).join(', ')} m (${sp.kinds.join(',')})`);
  }

  // --- Frei handeln
  await order(p, 'free');
  await gameWait(p, 1.2);
  const free = await p.evaluate(() => window.__ot.alive().map((b) => `${b.command ? b.command.kind : '-'}/${b.goal.kind}`));
  check(free.every((s) => s.startsWith('-/') && !s.endsWith('/command')), `Frei handeln: ${free.join(', ')}`);
  const noMark = await p.evaluate(() => !document.querySelector('.cw-mark'));
  check(noMark, 'Frei handeln: Weltmarkierung entfernt');

  // --- Gefecht: Folgende wehren sich (Gegner taucht 20 m vor ihnen auf)
  await order(p, 'follow');
  await gameWait(p, 3);
  const fight = await p.evaluate(() => {
    const G = window.__game;
    const e = G.actors.find((a) => a !== G.player && G.combat.isHostile(G.player, a));
    if (!e) return null;
    const b = window.__ot.alive()[0];
    const nav = G.world.nav;
    const near = nav.nodesInRadius(b.position, 24).filter((n) => n.position.distanceTo(b.position) > 14);
    const eye = b.getEyePosition(new b.position.constructor());
    const n = near.find((x) => { const q = x.position.clone(); q.y += 1.4; return G.world.lineOfSight(eye, q); }) || near[0];
    if (!n) return null;
    e.respawnAt = null;
    G.spawnActor ? G.spawnActor(e, { position: n.position.clone(), yaw: 0 }) : null;
    if (!e.alive) return null;
    e.body.teleport(n.position.clone());
    window.__ot.t0 = G.time.elapsed;
    window.__ot.enemy = e;
    return true;
  });
  if (fight) {
    await gameWait(p, 8);
    const f = await p.evaluate(() => {
      const t0 = window.__ot.t0;
      const b = window.__ot.alive();
      return {
        shots: b.filter((x) => x.weapon && x.weapon.lastShotTime > t0).length,
        engaged: b.filter((x) => x.gunner.rec && x.gunner.rec.actor === window.__ot.enemy).length,
        enemyAlive: window.__ot.enemy.alive,
        still: b.filter((x) => x.command && x.command.kind === 'follow').length,
      };
    });
    check(f.shots > 0 || f.engaged > 0 || !f.enemyAlive, `Gefecht mit Befehl: ${f.shots} Bots haben geschossen, ${f.engaged} zielen, Gegner ${f.enemyAlive ? 'lebt' : 'tot'}, ${f.still} folgen weiter`);
    await p.evaluate(() => window.__ot.enemiesOff());
  } else info('Gefechtsprüfung übersprungen (kein Gegner einsetzbar)');

  check(errs.length === 0, `keine Seitenfehler (${errs.length})${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

// =================================================================== Telefon
async function phone(browser) {
  info('— Telefon (Touch, 915×412) —');
  const PW = 915, PH = 412;
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: PW, height: PH }, screen: { width: PW, height: PH }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=4&enemies=1&diff=rekrut&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive, null, 300000, 1000);
  if (!check(!!ok, 'Telefon: Match läuft')) { await ctx.close(); return; }
  await instrument(p);
  await p.evaluate(() => window.__ot.enemiesOff());
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: q.id || 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const center = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, sel);
  await touch('touchStart', [{ x: PW * 0.7, y: PH * 0.4 }]);
  await touch('touchEnd', []);
  await gameWait(p, 1);
  const btn = await until(p, () => { const e = document.querySelector('.tc-befehl'); return !!e && getComputedStyle(e).display !== 'none'; }, null, 15000, 300);
  check(!!btn, 'Touch-Knopf „Befehlsrad“ sichtbar (Verbündete vorhanden)');
  // Überdeckung mit anderen Knöpfen?
  const overlap = await p.evaluate(() => {
    const me = document.querySelector('.tc-befehl').getBoundingClientRect();
    const hits = [];
    for (const e of document.querySelectorAll('#touch-ui .tc-btn')) {
      if (e.classList.contains('tc-befehl') || getComputedStyle(e).display === 'none') continue;
      const r = e.getBoundingClientRect();
      if (r.width && r.left < me.right && r.right > me.left && r.top < me.bottom && r.bottom > me.top) hits.push(e.className);
    }
    return hits;
  });
  check(overlap.length === 0, `Befehlsrad-Knopf überdeckt keine anderen Knöpfe${overlap.length ? ': ' + overlap.join(', ') : ''}`);
  const c = await center('.tc-befehl');
  // Antippen → Rad bleibt offen, Felder antippbar
  await touch('touchStart', [{ ...c, id: 5 }]);
  await sleep(60);
  await touch('touchEnd', []);
  const tap = await until(p, () => window.__game.hud.wheel.isOpen && window.__game.hud.wheel.tap, null, 8000, 100);
  check(!!tap, 'Antippen öffnet das Rad zum Antippen');
  await sleep(400);
  await p.screenshot({ path: `${OUT}/order-wheel-phone.png` });
  const item = await center('.cw-item[data-i="5"]'); // Sammeln
  await touch('touchStart', [{ ...item, id: 6 }]);
  await sleep(60);
  await touch('touchEnd', []);
  await sleep(400);
  const kinds = await p.evaluate(() => window.__ot.kinds());
  check(kinds.length && kinds.every((k) => k === 'regroup'), `Telefon: „Sammeln“ angetippt (${kinds.join(',')})`);
  await p.screenshot({ path: `${OUT}/order-toast-phone.png` });
  // Halten und ziehen (nach links = Formation)
  await touch('touchStart', [{ ...c, id: 7 }]);
  await until(p, () => window.__game.hud.wheel.isOpen, null, 8000, 50);
  for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: c.x - k * 14, y: c.y, id: 7 }]); await sleep(40); }
  await until(p, () => window.__game.hud.wheel.sel === 6, null, 8000, 50);
  await sleep(300);
  await p.screenshot({ path: `${OUT}/order-wheel-phone-drag.png` });
  await touch('touchEnd', []);
  await sleep(500);
  const form = await p.evaluate(() => window.__ot.kinds());
  check(form.length && form.every((k) => k === 'formation'), `Telefon: Ziehen nach links + Loslassen → Formation (${form.join(',')})`);
  check(errs.length === 0, `Telefon: keine Seitenfehler (${errs.length})${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

// =================================================================== Online
async function online(browser) {
  info('— Online (Host + 1 Client, Koop) —');
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const p = await ctx.newPage();
    p.__errs = [];
    p.on('pageerror', (e) => p.__errs.push(e.message));
    await p.goto(`${BASE}spielen.html?quality=low&relays=${encodeURIComponent(RELAY)}`);
    await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 120000 });
    await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
    return p;
  };
  const host = await open('Hosti');
  const cl = await open('Anna');
  const code = await host.evaluate(() => window.__game.net.host({
    name: 'Befehl-Test', mode: 'tdm', map: 'hafen', maxPlayers: 4, teamSize: 4, pvp: 'coop', botFill: true, difficulty: 'rekrut',
    weather: 'standard', time: 'standard', style: 'arcade',
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
  check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
  let j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id, team: r.team }), (e) => ({ ok: false, code: e.code })), code);
  if (!j.ok && (j.code === 'keine-antwort' || j.code === 'verbindung-fehlgeschlagen')) j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id, team: r.team }), (e) => ({ ok: false, code: e.code })), code);
  check(j.ok, `Client tritt bei (${j.ok ? `id ${j.id}, Team ${j.team}` : j.code})`);
  if (!j.ok) return;
  await until(host, () => window.__game.net.roster.length === 2, null, 15000);
  await host.evaluate(() => window.__game.net.startMatch());
  const both = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 600000, 1000)));
  if (!check(both.every(Boolean), 'Host + Client im Match')) return;
  await instrument(host);
  // Gegner aus (Host), damit Bewegungen ungestört bleiben
  await host.evaluate(() => window.__ot.enemiesOff());
  await sleep(1500);
  const allies = await host.evaluate((id) => {
    const G = window.__game;
    const pup = G.bots.byNetId(id);
    return { team: pup && pup.team, bots: G.bots.bots.filter((b) => !b.puppet && pup && b.team === pup.team && b.alive).map((b) => Math.round(b.position.distanceTo(pup.position))) };
  }, j.id);
  info(`Host: Bots im Team des Clients ${allies.bots.length} (Abstand ${allies.bots.join(', ')} m)`);
  // Client geht 6 s geradeaus (eigener Spieler, normale Bewegung), dann „Mir folgen“ über sein Rad
  await cl.evaluate(() => { const G = window.__game; G.input.allowUnlockedMouse = true; G.input.simulate.move(0, 1); });
  await sleep(6000);
  await cl.evaluate(() => window.__game.input.simulate.move(null));
  await sleep(500);
  const n = await cl.evaluate(() => window.__game.hud.wheel.issue('follow'));
  const ctoast = await cl.evaluate(() => [...document.querySelectorAll('.h-notice')].map((x) => x.textContent).join(' | '));
  info(`Client: ${n} Bots in Reichweite, Hinweis „${ctoast}“`);
  const got = await until(host, (id) => {
    const G = window.__game;
    const pup = G.bots.byNetId(id);
    const list = G.bots.bots.filter((b) => !b.puppet && b.command && b.command.by === pup && b.command.kind === 'follow');
    return list.length ? list.length : null;
  }, j.id, 20000, 300);
  check(!!got, `Host: ${got || 0} Bots folgen der Puppe des Clients (Befehl über das Netz)`);
  if (got) {
    // Client läuft weiter – die Bots müssen der Puppe hinterher
    await cl.evaluate(() => window.__game.input.simulate.move(0, 1));
    await sleep(5000);
    await cl.evaluate(() => window.__game.input.simulate.move(null));
    let close = null;
    for (let k = 0; k < 30 && !close; k++) {
      await sleep(1000);
      close = await host.evaluate((id) => {
        const G = window.__game;
        const pup = G.bots.byNetId(id);
        const d = G.bots.bots.filter((b) => !b.puppet && b.alive && b.command && b.command.by === pup).map((b) => b.position.distanceTo(pup.position));
        return d.length && Math.max(...d) <= 10 ? d.map((x) => Math.round(x * 10) / 10) : null;
      }, j.id);
    }
    check(!!close, `Host: folgende Bots nah an der Puppe (${close ? close.join(', ') : '–'} m, ≤ 10)`);
  }
  check(host.__errs.length === 0 && cl.__errs.length === 0, `online: keine Seitenfehler (${host.__errs.length}/${cl.__errs.length})${[...host.__errs, ...cl.__errs].slice(0, 2).join(' | ')}`);
}

await waitForLoad();
const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
try {
  if (ONLY.includes('offline')) await offline(browser);
  if (ONLY.includes('phone')) { await waitForLoad(); await phone(browser); }
  if (ONLY.includes('online')) { await waitForLoad(); await online(browser); }
} catch (err) {
  check(false, `Abbruch: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : err}`);
} finally {
  await browser.close();
}
console.log(`${ts()} ${fail ? `FEHLER: ${fail} von ${count} Prüfungen` : `alle ${count} Prüfungen bestanden`}`);
process.exit(fail ? 1 : 0);
