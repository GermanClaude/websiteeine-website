// NULLPUNKT — Befehlsrad-Test (ui/command-wheel.js, bots/ai/orders.js) in Headless-Chromium (spielen.html, SwiftShader).
//   Offline (TDM Hafen, 5 Verbündete, Gegner tot und ohne Wiedereinstieg): jeder Befehl über den Eingabeweg (Aktion
//   „befehl“ halten, Maus in Richtung des Felds, loslassen – input.simulate, Auswertung durch HUD/Befehlsrad) und Prüfung des
//   Verhaltens. Die Spielzeit wird dafür ohne Rendern im Takt 1/30 s weitergeschaltet (Eingabe, Spieler, Bots, Waffen, Modus,
//   HUD – wie tools/sim.mjs); das Rendern unter SwiftShader wäre sonst der Engpass:
//     • Mir folgen: der Spieler läuft (Eingabe vorwärts, 5,4 m/s) einen Navigationspfad ab – Folgende im Mittel ≤ 8 m entfernt
//     • Position halten: Spieler geht weg – Bots bleiben ≤ 3 m an ihrer Stellung
//     • Sammeln: alle ≤ 6 m beim Spieler · Formation Keil, dann Kreis: rundum ≤ 7,5 m
//     • Angreifen: Punkt unter dem Fadenkreuz, Bots rücken an (≤ 10 m oder Abstand −60 %), Weltmarkierung sichtbar
//     • Verteidigen: alle ≤ 10 m am Punkt · Ausschwärmen: auffächern (mittlerer Abstand untereinander ≥ 6 m)
//     • Frei handeln: Befehle und Markierung weg · Rad ohne Auswahl: kein Befehl · Gefecht: Folgende schießen trotzdem
//   Bildschirmfotos (tools/out/order-*.png): Rad offen (Desktop 1280×720), Markierung, Kreis, Telefon (915×412, Touch:
//   antippen → Felder; ziehen → Richtung).
//   Online (Host + 1 Client, Koop, 640×360): Client befiehlt „Mir folgen“ über sein Rad → Host-Bots seines Teams folgen seiner
//   Puppe (Befehl kommt als 'order' beim Host an, Bots bleiben nah an der Puppe, während der Client läuft).
// Voraussetzung: Server auf 8765; online zusätzlich node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/order-test.mjs [--only=offline,phone,online] [--quality=low] [--size=1280x720]
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
const list = (a) => (a && a.length ? a.map(r1).join(', ') : '–');

async function waitForLoad() {
  for (let i = 0; i < 30; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 5)) return;
    if (i % 4 === 0) info(`Last ${l1} > 5 – warte`);
    await sleep(20000);
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

/** Seite mit Hilfen ausstatten (window.__ot). */
async function instrument(p) {
  await p.evaluate(async () => {
    const G = window.__game;
    G.input.allowUnlockedMouse = true;
    const phys = await import(new URL('assets/js/game/engine/physics.js', location.href).href);
    const V = G.player.position.constructor;
    const T = (window.__ot = { V });
    T.allies = () => G.bots.bots.filter((b) => !b.puppet && b.team === G.player.team);
    T.alive = () => T.allies().filter((b) => b.alive);
    T.dists = (to) => T.alive().map((b) => b.position.distanceTo(to ? new V(to[0], to[1], to[2]) : G.player.position));
    T.kinds = () => T.alive().map((b) => (b.command ? b.command.kind : '-'));
    T.notices = () => [...document.querySelectorAll('.h-notice')].map((n) => n.textContent);
    /** Spielzeit ohne Rendern weiterschalten (wie tools/sim.mjs); je Schritt Steuerung (T.walkStep) und optional Messung. */
    T.step = (sec, dt = 1 / 30, each = null) => {
      const n = Math.max(1, Math.round(sec / dt));
      for (let i = 0; i < n; i++) {
        G.time.dt = dt; G.time.elapsed += dt; G.time.real += dt; G.time.frame++;
        if (T.walkStep) T.walkStep();
        G.input.update(dt);
        G.player.update(dt);
        G.bots.update(dt);
        phys.separateActors(G.actors);
        G.weapons.update(dt);
        if (G.mode) G.mode.update(dt);
        G.hud.update(dt);
        G.input.endFrame();
        if (each) each(i);
      }
    };
    /** Spieler einen Navigationspfad entlang steuern (Eingabe vorwärts + Blick zum nächsten Wegpunkt; festgefahren → weiter). */
    T.walk = (to) => {
      const path = G.world.nav.findPath(G.player.position, new V(to[0], to[1], to[2])) || [];
      if (!path.length) return 0;
      const pts = [G.player.position.clone(), ...path];
      let i = 1, best = Infinity, bestAt = G.time.elapsed;
      T.walking = true;
      T.walkStep = () => {
        const q = G.player.position;
        while (i < pts.length && Math.hypot(pts[i].x - q.x, pts[i].z - q.z) < 1.3) { i++; best = Infinity; }
        if (i >= pts.length || !G.player.alive) { G.input.simulate.move(null); T.walking = false; T.walkStep = null; return; }
        const dx = pts[i].x - q.x, dz = pts[i].z - q.z, d = Math.hypot(dx, dz);
        if (d < best - 1) { best = d; bestAt = G.time.elapsed; } else if (G.time.elapsed - bestAt > 3) { i++; best = Infinity; bestAt = G.time.elapsed; }
        G.player.yaw = Math.atan2(-dx, -dz);
        G.player.pitch = 0;
        G.input.simulate.move(0, 1);
      };
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += pts[k].distanceTo(pts[k - 1]);
      return len;
    };
    /** Navigationsknoten im Abstand [a, b] vom Spieler (gleiche Höhe ± 2 m, erreichbar; optional mit Sicht). */
    T.nodeAt = (a, b, sight = false) => {
      const nav = G.world.nav;
      const pp = G.player.position;
      const eye = G.player.getEyePosition(new V());
      const cand = nav.nodes.filter((n) => { const d = n.position.distanceTo(pp); return d >= a && d <= b && Math.abs(n.position.y - pp.y) < 2; });
      cand.sort(() => Math.random() - 0.5);
      for (const n of cand.slice(0, 300)) {
        if (sight) { const q = n.position.clone(); q.y += 0.6; if (!G.world.lineOfSight(eye, q)) continue; }
        const path = nav.findPath(pp, n.position);
        if (path && path.length) return [n.position.x, n.position.y, n.position.z];
      }
      return null;
    };
    /** Testaufbau: Verbündete 5–15 m um den Spieler versetzen. */
    T.gather = () => {
      const pp = G.player.position;
      const nodes = G.world.nav.nodesInRadius(pp, 16).filter((n) => n.position.distanceTo(pp) > 5 && Math.abs(n.position.y - pp.y) < 1.5);
      T.alive().forEach((b, i) => { const n = nodes[(i * 7) % Math.max(1, nodes.length)]; if (n) { b.body.teleport(n.position.clone()); b.nav.reset(); } });
      return nodes.length;
    };
    T.enemiesOff = () => {
      for (const a of G.actors) {
        if (a === G.player || !G.combat.isHostile(G.player, a)) continue;
        if (a.alive) G.combat.damage(a, { amount: 9999, attacker: G.player, zone: 'body', dir: new V(0, 0, -1) });
        a.respawnAt = Infinity;
      }
    };
    /** Befehlsrad über den Eingabeweg: halten, Maus in Richtung Feld i, (optional) loslassen. → 'ok' oder Fehlertext */
    T.order = (i, keep = false) => {
      const wheel = G.hud.wheel;
      const a = (i * Math.PI) / 4;
      G.input.simulate.press('befehl');
      T.step(0.1);
      if (!wheel.isOpen) return 'Rad nicht offen';
      G.input.simulate.look(Math.sin(a) * 160, -Math.cos(a) * 160);
      T.step(0.1);
      if (wheel.sel !== i) return `Auswahl ${wheel.sel} statt ${i}`;
      if (keep) return 'ok';
      G.input.simulate.release('befehl');
      T.step(0.1);
      return wheel.isOpen ? 'Rad noch offen' : 'ok';
    };
  });
}

const WHEEL = ['follow', 'attack', 'spread', 'defend', 'hold', 'regroup', 'formation', 'free'];
const order = (p, id, keep = false) => p.evaluate(([i, k]) => window.__ot.order(i, k), [WHEEL.indexOf(id), keep]);
const step = (p, sec) => p.evaluate((s) => window.__ot.step(s), sec);

// =================================================================== Offline
async function offline(browser) {
  info('— Offline (Desktop) —');
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const p = await ctx.newPage();
  const big = async (on) => { await p.setViewportSize(on ? { width: W, height: H } : { width: 640, height: 360 }); await sleep(on ? 2500 : 300); };
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|WebGL|GL_|AudioContext/i.test(m.text())) errs.push(m.text()); });
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=5&enemies=1&diff=rekrut&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive, null, 400000, 1000);
  if (!check(!!ok, 'Match läuft (TDM Hafen, 5 Verbündete)')) { await ctx.close(); return; }
  await instrument(p);
  await p.evaluate(() => window.__ot.enemiesOff());
  await step(p, 1);
  const binds = await p.evaluate(() => ({ kb: window.__game.input.label('befehl', 'kb'), pad: window.__game.input.label('befehl', 'pad') }));
  check(!!binds.kb && !!binds.pad, `Aktion „befehl“ belegt (Tastatur ${binds.kb}, Gamepad ${binds.pad})`);
  const nAllies = await p.evaluate(() => window.__ot.alive().length);
  info(`${nAllies} verbündete Bots leben`);

  // --- Mir folgen (Testaufbau: Verbündete um den Spieler)
  await p.evaluate(() => window.__ot.gather());
  await step(p, 0.5);
  let r = await order(p, 'follow');
  let kinds = await p.evaluate(() => window.__ot.kinds());
  check(r === 'ok' && kinds.length && kinds.every((k) => k === 'follow'), `Mir folgen über das Rad (${r}): ${kinds.join(',')}`);
  const toast = await p.evaluate(() => window.__ot.notices().join(' | '));
  check(/Befehl: Mir folgen \(\d+ Bots?\)/.test(toast), `Hinweis: „${toast}“`);
  await step(p, 2);
  const target = await p.evaluate(() => window.__ot.nodeAt(45, 70));
  const len = await p.evaluate((t) => window.__ot.walk(t), target);
  const walk = await p.evaluate(() => {
    const T = window.__ot, G = window.__game;
    const s = [];
    const p0 = G.player.position.clone();
    T.step(40, 1 / 30, (i) => { if (i % 15 === 0 && T.walking) { const d = T.dists(); if (d.length) s.push(d.reduce((a, b) => a + b, 0) / d.length); } });
    return { s, moved: G.player.position.distanceTo(p0), walking: T.walking };
  });
  info(`Spieler läuft ${r1(len)} m Pfad (Eingabe vorwärts), Luftlinie ${r1(walk.moved)} m${walk.walking ? ' – Pfad nicht beendet' : ''}`);
  const meanFollow = walk.s.length ? walk.s.reduce((a, b) => a + b, 0) / walk.s.length : 99;
  check(meanFollow <= 8, `Mir folgen: mittlerer Abstand beim Laufen ${r1(meanFollow)} m (≤ 8), höchstens ${r1(Math.max(...walk.s))} m (${walk.s.length} Proben)`);
  await step(p, 3);
  const endD = await p.evaluate(() => window.__ot.dists());
  check(endD.length && Math.max(...endD) <= 9, `Mir folgen: nach dem Anhalten alle nah (${list(endD)} m)`);
  await sleep(1500);
  await p.screenshot({ path: `${OUT}/order-follow.png`, timeout: 120000 });

  // --- Position halten
  r = await order(p, 'hold');
  await step(p, 4);
  const spots = await p.evaluate(() => window.__ot.alive().map((b) => !!(b.command && b.command.spot)));
  check(r === 'ok' && spots.length && spots.every(Boolean), `Position halten (${r}): alle mit Stellung (${spots.length})`);
  const away = await p.evaluate(() => window.__ot.nodeAt(28, 45));
  await p.evaluate((t) => window.__ot.walk(t), away);
  const hold = await p.evaluate(() => {
    const T = window.__ot;
    let worst = 0;
    T.step(12, 1 / 30, (i) => { if (i % 15 === 0) for (const b of T.alive()) if (b.command && b.command.spot) worst = Math.max(worst, b.position.distanceTo(b.command.spot)); });
    return { worst, d: T.alive().map((b) => (b.command && b.command.spot ? b.position.distanceTo(b.command.spot) : 99)), pd: T.dists() };
  });
  check(hold.worst <= 3, `Position halten: größte Abweichung von der Stellung ${r1(hold.worst)} m (≤ 3), zuletzt ${list(hold.d)} m; Spieler jetzt ${list(hold.pd)} m entfernt`);

  // --- Sammeln
  await p.evaluate(() => { const T = window.__ot; let k = 0; while (T.walking && k++ < 60) T.step(0.5); });
  const before = await p.evaluate(() => window.__ot.dists());
  r = await order(p, 'regroup');
  const reg = await p.evaluate(() => {
    const T = window.__ot;
    for (let k = 0; k < 40; k++) { T.step(0.5); const d = T.dists(); if (d.length && Math.max(...d) <= 6) return { t: (k + 1) * 0.5, d }; }
    return { t: null, d: T.dists() };
  });
  check(r === 'ok' && reg.t !== null, `Sammeln (${r}): vorher ${list(before)} m → nach ${reg.t ?? '> 20'} s ${list(reg.d)} m (alle ≤ 6)`);
  await step(p, 2);
  const crouch = await p.evaluate(() => window.__ot.alive().filter((b) => b.crouching).length);
  info(`Sammeln: ${crouch} Bots hocken (Rundumsicherung)`);

  // --- Formation (Keil, dann Kreis)
  r = await order(p, 'formation');
  let form = await p.evaluate(() => window.__ot.alive().map((b) => b.command && b.command.formation));
  check(r === 'ok' && form.every((f) => f === 'keil'), `Formation 1. Wahl: Keil (${form.join(',')})`);
  await step(p, 2);
  r = await order(p, 'formation');
  form = await p.evaluate(() => window.__ot.alive().map((b) => b.command && b.command.formation));
  check(r === 'ok' && form.every((f) => f === 'kreis'), `Formation 2. Wahl: Kreis (${form.join(',')})`);
  await step(p, 8);
  const ring = await p.evaluate(() => {
    const pp = window.__game.player.position;
    const a = window.__ot.alive().map((b) => Math.atan2(b.position.x - pp.x, b.position.z - pp.z)).sort((x, y) => x - y);
    let gap = 0;
    for (let i = 0; i < a.length; i++) gap = Math.max(gap, i === a.length - 1 ? a[0] + Math.PI * 2 - a[i] : a[i + 1] - a[i]);
    return { d: window.__ot.dists(), gap: (gap * 180) / Math.PI };
  });
  check(ring.d.length && Math.max(...ring.d) <= 7.5 && ring.gap < 200, `Formation Kreis: Abstände ${list(ring.d)} m, größte Winkellücke ${Math.round(ring.gap)}°`);
  await sleep(1500);
  await p.screenshot({ path: `${OUT}/order-kreis.png`, timeout: 120000 });

  // --- Angreifen (Punkt unter dem Fadenkreuz), mit Bildschirmfoto des offenen Rads
  const atk = await p.evaluate(() => window.__ot.nodeAt(30, 50, true));
  check(!!atk, `Angriffsziel mit Sicht gefunden (${list(atk)})`);
  if (atk) {
    await p.evaluate((t) => window.__game.debugApi.lookAt(t[0], t[1] + 0.3, t[2]), atk);
    await step(p, 0.2);
    const d0 = await p.evaluate((t) => window.__ot.dists(t), atk);
    await big(true);
    r = await order(p, 'attack', true);
    await sleep(2500);
    await p.screenshot({ path: `${OUT}/order-wheel-desktop.png`, timeout: 120000 });
    await p.evaluate(() => { window.__game.input.simulate.release('befehl'); window.__ot.step(0.1); });
    kinds = await p.evaluate(() => window.__ot.kinds());
    check(r === 'ok' && kinds.every((k) => k === 'attack'), `Angreifen (${r}): Befehl an alle (${kinds.join(',')})`);
    const pt = await p.evaluate(() => { const b = window.__ot.alive()[0]; return b && b.command && b.command.point ? [b.command.point.x, b.command.point.y, b.command.point.z] : null; });
    info(`Angriffspunkt unter dem Fadenkreuz ${list(pt)} – angepeilter Knoten ${list(atk)}`);
    const mark = await p.evaluate(() => { const m = document.querySelector('.cw-mark'); return m ? m.textContent : null; });
    check(!!mark, `Weltmarkierung: „${mark}“`);
    await step(p, 1.5);
    await sleep(2500);
    await p.screenshot({ path: `${OUT}/order-marker-desktop.png`, timeout: 120000 });
    await big(false);
    const res = await p.evaluate((t) => {
      const T = window.__ot;
      let best = Infinity;
      for (let k = 0; k < 40; k++) { T.step(0.5); const d = T.dists(t); const m = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length); best = Math.min(best, m); if (m <= 10) break; }
      return best;
    }, pt || atk);
    const m0 = d0.reduce((a, b) => a + b, 0) / Math.max(1, d0.length);
    check(res <= 10 || res <= m0 * 0.4, `Angreifen: mittlerer Abstand zum Ziel ${r1(m0)} → ${r1(res)} m`);
  }

  // --- Verteidigen
  const def = await p.evaluate(() => window.__ot.nodeAt(15, 30, true));
  if (def) {
    await p.evaluate((t) => window.__game.debugApi.lookAt(t[0], t[1] + 0.3, t[2]), def);
    await step(p, 0.2);
    r = await order(p, 'defend');
    const dd = await p.evaluate(() => {
      const T = window.__ot;
      const b0 = T.alive()[0];
      const pt = b0 && b0.command && b0.command.point ? [b0.command.point.x, b0.command.point.y, b0.command.point.z] : null;
      if (!pt) return null;
      for (let k = 0; k < 40; k++) { T.step(0.5); const d = T.dists(pt); if (d.length && Math.max(...d) <= 10) return { d, k: T.kinds() }; }
      return { d: T.dists(pt), k: T.kinds() };
    });
    check(r === 'ok' && dd && dd.k.every((k) => k === 'defend') && Math.max(...dd.d) <= 10, `Verteidigen (${r}): Abstände zum Punkt ${dd ? list(dd.d) : '–'} m (≤ 10)`);
  } else check(false, 'Verteidigungspunkt gefunden');

  // --- Ausschwärmen
  const spr = await p.evaluate(() => window.__ot.nodeAt(30, 45, true));
  if (spr) {
    await p.evaluate((t) => window.__game.debugApi.lookAt(t[0], t[1] + 0.3, t[2]), spr);
    await step(p, 0.2);
    r = await order(p, 'spread');
    await step(p, 10);
    const sp = await p.evaluate(() => {
      const b = window.__ot.alive();
      let s = 0, n = 0;
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { s += b[i].position.distanceTo(b[j].position); n++; }
      const pt = b[0] && b[0].command && b[0].command.point;
      return { pair: n ? s / n : 0, toPt: pt ? b.map((x) => x.position.distanceTo(pt)) : [], kinds: b.map((x) => (x.command ? x.command.kind : '-')) };
    });
    check(r === 'ok' && sp.pair >= 6, `Ausschwärmen (${r}): mittlerer Abstand untereinander ${r1(sp.pair)} m, zum Ziel ${list(sp.toPt)} m (${sp.kinds.join(',')})`);
  }

  // --- Frei handeln
  r = await order(p, 'free');
  await step(p, 1.2);
  const free = await p.evaluate(() => window.__ot.alive().map((b) => `${b.command ? b.command.kind : '-'}/${b.goal.kind}`));
  check(r === 'ok' && free.every((s) => s.startsWith('-/') && !s.endsWith('/command')), `Frei handeln (${r}): ${free.join(', ')}`);
  const noMark = await p.evaluate(() => !document.querySelector('.cw-mark'));
  check(noMark, 'Frei handeln: Weltmarkierung entfernt');

  // --- Abbrechen: Rad ohne Auswahl loslassen (länger als ein Antippen) → kein Befehl
  const cancel = await p.evaluate(() => {
    const G = window.__game, T = window.__ot;
    G.input.simulate.press('befehl'); T.step(0.1);
    const open = G.hud.wheel.isOpen;
    G.hud.wheel._openAt -= 1000; // gehalten statt angetippt
    G.input.simulate.release('befehl'); T.step(0.1);
    return { open, closed: !G.hud.wheel.isOpen, kinds: T.kinds() };
  });
  check(cancel.open && cancel.closed && cancel.kinds.every((k) => k === '-'), `Rad ohne Auswahl losgelassen: geschlossen, kein Befehl (${cancel.kinds.join(',')})`);

  // --- Gefecht: Folgende wehren sich (Gegner taucht 14–24 m vor ihnen auf)
  await order(p, 'follow');
  await step(p, 3);
  const fight = await p.evaluate(() => {
    const G = window.__game, T = window.__ot;
    const e = G.actors.find((a) => a !== G.player && G.combat.isHostile(G.player, a));
    const b = T.alive()[0];
    if (!e || !b) return null;
    const eye = b.getEyePosition(new T.V());
    const near = G.world.nav.nodesInRadius(b.position, 24).filter((n) => n.position.distanceTo(b.position) > 14);
    const n = near.find((x) => { const q = x.position.clone(); q.y += 1.4; return G.world.lineOfSight(eye, q); }) || near[0];
    if (!n) return null;
    G.spawnActor(e, { position: n.position.clone(), yaw: 0 });
    if (!e.alive) return null;
    const t0 = G.time.elapsed;
    T.step(8);
    const al = T.alive();
    const res = {
      shots: al.filter((x) => x.weapon && x.weapon.lastShotTime > t0).length,
      engaged: al.filter((x) => x.gunner.rec && x.gunner.rec.actor === e).length,
      enemyAlive: e.alive,
      still: al.filter((x) => x.command && x.command.kind === 'follow').length,
    };
    T.enemiesOff();
    return res;
  });
  if (fight) check(fight.shots > 0 || fight.engaged > 0 || !fight.enemyAlive, `Gefecht mit Befehl: ${fight.shots} Bots haben geschossen, ${fight.engaged} zielen, Gegner ${fight.enemyAlive ? 'lebt' : 'tot'}, ${fight.still} folgen weiter`);
  else info('Gefechtsprüfung übersprungen (kein Gegner einsetzbar)');
  const stats = await p.evaluate(() => window.__game.bots.stats());
  info(`Bot-Statistik: Befehle ${stats.commanded}, Ziele ${JSON.stringify(stats.states)}, ${stats.ms} ms/Bild`);

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
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive, null, 400000, 1000);
  if (!check(!!ok, 'Telefon: Match läuft')) { await ctx.close(); return; }
  await instrument(p);
  await p.evaluate(() => { window.__ot.enemiesOff(); window.__ot.gather(); });
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: q.id || 1, radiusX: 4, radiusY: 4, force: 1 })) });
  const center = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, sel);
  // Spielzeit gezielt weiterschalten, damit Touch-Ereignisse in Eingabe/HUD ankommen (echte Bilder sind unter Last langsam)
  const frames = (s) => step(p, s);
  await touch('touchStart', [{ x: PW * 0.7, y: PH * 0.4 }]);
  await touch('touchEnd', []);
  await frames(0.3);
  await sleep(1500);
  const btn = await until(p, () => { const e = document.querySelector('.tc-befehl'); return !!e && getComputedStyle(e).display !== 'none'; }, null, 30000, 500);
  check(!!btn, 'Touch-Knopf „Befehlsrad“ sichtbar (Verbündete vorhanden)');
  const overlap = await p.evaluate(() => {
    const me = document.querySelector('.tc-befehl').getBoundingClientRect();
    const hits = [];
    for (const e of document.querySelectorAll('#touch-ui .tc-btn')) {
      if (e.classList.contains('tc-befehl') || getComputedStyle(e).display === 'none') continue;
      const r = e.getBoundingClientRect();
      if (r.width && r.left < me.right && r.right > me.left && r.top < me.bottom && r.bottom > me.top) hits.push(e.className);
    }
    return { hits, rect: [Math.round(me.left), Math.round(me.top), Math.round(me.width), Math.round(me.height)] };
  });
  check(overlap.hits.length === 0, `Befehlsrad-Knopf (${overlap.rect.join(', ')}) überdeckt keine anderen Knöpfe${overlap.hits.length ? ': ' + overlap.hits.join(', ') : ''}`);
  const c = await center('.tc-befehl');
  await p.evaluate(() => { window.__game.hud.wheel.tapMs = 4000; }); // CDP-Rundläufe unter Last dauern länger als ein echtes Antippen
  // Antippen → Rad bleibt offen, Felder antippbar
  await touch('touchStart', [{ ...c, id: 5 }]);
  await frames(0.05);
  await touch('touchEnd', []);
  await frames(0.15);
  const tap = await p.evaluate(() => window.__game.hud.wheel.isOpen && window.__game.hud.wheel.tap);
  check(!!tap, 'Antippen öffnet das Rad zum Antippen');
  await sleep(2500);
  await p.screenshot({ path: `${OUT}/order-wheel-phone.png`, timeout: 120000 });
  const item = await center('.cw-item[data-i="5"]'); // Sammeln
  if (item) {
    await touch('touchStart', [{ ...item, id: 6 }]);
    await touch('touchEnd', []);
  }
  await frames(0.2);
  const kinds = await p.evaluate(() => window.__ot.kinds());
  check(kinds.length && kinds.every((k) => k === 'regroup'), `Telefon: „Sammeln“ angetippt (${kinds.join(',')})`);
  await sleep(2500);
  await p.screenshot({ path: `${OUT}/order-toast-phone.png`, timeout: 120000 });
  // Halten und ziehen (nach links = Formation)
  await touch('touchStart', [{ ...c, id: 7 }]);
  await frames(0.1);
  for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: c.x - k * 14, y: c.y + k, id: 7 }]); await frames(0.03); }
  const sel = await p.evaluate(() => window.__game.hud.wheel.sel);
  await sleep(2500);
  await p.screenshot({ path: `${OUT}/order-wheel-phone-drag.png`, timeout: 120000 });
  await touch('touchEnd', []);
  await frames(0.2);
  const form = await p.evaluate(() => window.__ot.kinds());
  check(sel === 6 && form.length && form.every((k) => k === 'formation'), `Telefon: nach links ziehen (Feld ${sel}) + loslassen → Formation (${form.join(',')})`);
  check(errs.length === 0, `Telefon: keine Seitenfehler (${errs.length})${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

// =================================================================== Online
async function online(browser) {
  info('— Online (Host + 1 Client, Koop) —');
  const ctxs = [];
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const p = await ctx.newPage();
    p.__errs = [];
    p.on('pageerror', (e) => p.__errs.push(e.message));
    await p.goto(`${BASE}spielen.html?quality=low&relays=${encodeURIComponent(RELAY)}`);
    await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 120000 });
    await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
    ctxs.push(ctx);
    return p;
  };
  try {
    const host = await open('Hosti');
    const cl = await open('Anna');
    const code = await host.evaluate(() => window.__game.net.host({
      name: 'Befehl-Test', mode: 'tdm', map: 'hafen', maxPlayers: 4, teamSize: 4, pvp: 'coop', botFill: true, difficulty: 'rekrut',
      weather: 'standard', time: 'standard', style: 'arcade',
    }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
    check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
    const join = () => cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id, team: r.team }), (e) => ({ ok: false, code: e.code })), code);
    let j = await join();
    if (!j.ok && (j.code === 'keine-antwort' || j.code === 'verbindung-fehlgeschlagen')) j = await join();
    check(j.ok, `Client tritt bei (${j.ok ? `id ${j.id}, Team ${j.team}` : j.code})`);
    if (!j.ok) return;
    await until(host, () => window.__game.net.roster.length === 2, null, 15000);
    await host.evaluate(() => window.__game.net.startMatch());
    const both = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 600000, 1000)));
    if (!check(both.every(Boolean), 'Host + Client im Match')) return;
    await instrument(host);
    await host.evaluate(() => window.__ot.enemiesOff());
    await sleep(1500);
    const before = await host.evaluate((id) => {
      const G = window.__game;
      const pup = G.bots.byNetId(id);
      return { team: pup && pup.team, d: G.bots.bots.filter((b) => !b.puppet && pup && b.team === pup.team && b.alive).map((b) => Math.round(b.position.distanceTo(pup.position))) };
    }, j.id);
    info(`Host: Bots im Team des Clients (${before.team}): ${before.d.length}, Abstand zur Puppe ${before.d.join(', ')} m`);
    // Client: kurz vorwärts laufen, dann „Mir folgen“ über sein Rad (Eingabeweg wie offline, aber in Echtzeit)
    await cl.evaluate(() => { const G = window.__game; G.input.allowUnlockedMouse = true; G.input.simulate.move(0, 1); });
    await sleep(5000);
    await cl.evaluate(() => window.__game.input.simulate.move(null));
    await cl.evaluate(() => window.__game.input.simulate.press('befehl'));
    const opened = await until(cl, () => window.__game.hud.wheel.isOpen, null, 30000, 100);
    await cl.evaluate(() => window.__game.input.simulate.look(0, -160));
    const selected = await until(cl, () => window.__game.hud.wheel.sel === 0, null, 30000, 100);
    await cl.evaluate(() => window.__game.input.simulate.release('befehl'));
    const closed = await until(cl, () => !window.__game.hud.wheel.isOpen, null, 30000, 100);
    const ctoast = await cl.evaluate(() => [...document.querySelectorAll('.h-notice')].map((x) => x.textContent).join(' | '));
    check(!!(opened && selected && closed), `Client: Rad geöffnet, „Mir folgen“ gewählt, bestätigt – Hinweis „${ctoast}“`);
    const got = await until(host, (id) => {
      const G = window.__game;
      const pup = G.bots.byNetId(id);
      const n = G.bots.bots.filter((b) => !b.puppet && b.command && b.command.by === pup && b.command.kind === 'follow').length;
      return n || null;
    }, j.id, 30000, 300);
    check(!!got, `Host: ${got || 0} Bots folgen der Puppe des Clients (Befehl über das Netz)`);
    if (got) {
      await cl.evaluate(() => window.__game.input.simulate.move(0, 1));
      const samples = [];
      for (let k = 0; k < 12; k++) {
        await sleep(1000);
        const d = await host.evaluate((id) => {
          const G = window.__game;
          const pup = G.bots.byNetId(id);
          const v = G.bots.bots.filter((b) => !b.puppet && b.alive && b.command && b.command.by === pup).map((b) => b.position.distanceTo(pup.position));
          return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        }, j.id);
        if (d !== null) samples.push(d);
      }
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
      const fps = await host.evaluate(() => window.__game.renderer.info().fps);
      info(`Host ${fps} FPS; mittlerer Abstand der Folgenden zur laufenden Puppe: ${list(samples)} m`);
      check(!!close, `Host: Folgende nach dem Anhalten nah an der Puppe (${close ? close.join(', ') : '–'} m, ≤ 10)`);
    }
    check(host.__errs.length === 0 && cl.__errs.length === 0, `online: keine Seitenfehler (${host.__errs.length}/${cl.__errs.length})${[...host.__errs, ...cl.__errs].slice(0, 2).join(' | ')}`);
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
  }
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
