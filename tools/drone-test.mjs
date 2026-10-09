// NULLPUNKT – FPV-Drohne (Serienprämie 'drohne': modes/drone.js, modes/streaks.js, ui/drone-hud.js, net/sync-host.js,
// net/sync-client.js) in Headless-Chromium (spielen.html, SwiftShader).
//   Offline (TDM Werk): Serie freischalten (debugApi.giveStreak), Taste streak4 → Drohne startet vor dem Kopf, Körper bleibt
//     stehen, Kamera in der Drohne, Drohnen-HUD an; Fliegen (Tempo ≤ 18 m/s, mit Schub ≤ 26 m/s); gegen eine Wand: langsam
//     → bleibt davor stehen, schnell → zerschellt, nie dahinter; Sprengung neben einem Bot → Bot tot, Abschuss zählt für den
//     Spieler mit Ursache 'drohne' (Abschussliste: FPV-Drohne), Kamera zurück; Akku-Ablauf; Abbrechen; Tod des Spielers im
//     Flug; Abschuss der Drohne durch einen Bot-Schuss (world.raycast); Bot-Drohne (Autopilot) endet von selbst; Matchende.
//   Online (--online, Host + 1 Client über das lokale Relay): Host gibt der Puppe des Clients die Serie → Client bekommt
//     'sk', Taste streak4 → Host bestätigt ('sa'), Host sieht die Drohne (folgt der Lage des Clients); Client fliegt zu einem
//     angehaltenen Bot des Hosts und sprengt → Bot tot, Abschuss für die Puppe mit Ursache 'drohne' (Host) bzw. den Spieler
//     (Client); erfundene Sprengung (Teleport 80 m) → abgelehnt, keine Explosion, Drohne beim Client beendet, Anti-Cheat-Eintrag;
//     Drohne des Host-Spielers erscheint beim Client als Abbild, der Client schießt sie ab (Treffermeldung 'drone' h, der Host
//     prüft und entscheidet) → Abbild weg, Punkte „Drohne abgeschossen“ beim Client.
//   VR (nachgestellt): G.xr.presenting → Taste startet nicht (Hinweis, bleibt bereit); 'xr:start' im Flug → Abbruch.
// Bilder: tools/out/drone-hud-pc.png, drone-hud-handy.png, drone-aussen.png, drone-online-host.png
// Voraussetzung: Server (NP_BASE, Standard http://localhost:8765/); online zusätzlich node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/drone-test.mjs [--only=offline,handy,vr,online] [--quality=low] [--size=960x540]
import { chromium, devices, BASE, GL_ARGS } from './pw.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const ONLY = opt.only ? String(opt.only).split(',') : opt.online ? ['offline', 'handy', 'vr', 'online'] : ['offline', 'handy', 'vr'];
const QUALITY = String(opt.quality || 'low');
const [W, H] = String(opt.size || '960x540').split('x').map(Number);
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

/** Hilfen auf der Seite (window.__dt): Ereignisse, Start, Lage, Ziele. */
const instrument = (p) => p.evaluate(() => {
  const G = window.__game;
  const T = G.THREE;
  const D = (window.__dt = { ends: [], kills: [], explosions: [], pilots: [], activates: [], scores: [], destroyed: [] });
  G.events.on('score', (e) => { if (e.actor === G.player) D.scores.push(e.reason); });
  G.events.on('streak:destroyed', (e) => D.destroyed.push({ id: e.streakId, by: e.by ? e.by.name : null, owner: e.owner ? e.owner.name : null }));
  G.events.on('drone:end', (e) => D.ends.push({ why: e.why, own: e.owner === G.player, net: !!e.net, owner: e.owner ? e.owner.name : null, by: e.by ? e.by.name : null }));
  G.events.on('kill', (e) => D.kills.push({ victim: e.victim ? e.victim.name : null, killer: e.killer ? e.killer.name : null, mine: e.killer === G.player, weapon: e.weaponId, victimRef: e.victim }));
  G.events.on('explosion', (e) => D.explosions.push({ type: e.type, w: e.weaponId, pos: [e.position.x, e.position.y, e.position.z], net: !!e.net, by: e.attacker ? e.attacker.name : null }));
  G.events.on('drone:pilot', (e) => D.pilots.push(e.on));
  G.events.on('streak:activate', (e) => D.activates.push({ id: e.streakId, own: e.actor === G.player, by: e.actor ? e.actor.name : null }));
  D.st = () => G.mode.streaks;
  D.pilot = () => G.mode.streaks.pilot;
  D.state = () => {
    const d = G.mode.streaks.pilot;
    const p = G.player;
    return {
      pilot: !!d, piloting: !!p.piloting, droneAttr: document.body.dataset.drone || '', hud: !!document.querySelector('.dr-hud:not([hidden])'),
      vm: G.viewmodel.scene.visible, body: p.position.toArray(), cam: G.camera.position.toArray(), alive: p.alive,
      drone: d ? { pos: d.position.toArray(), speed: d.speed, battery: d.battery, yaw: d.yaw, netId: d.netId, role: d.role } : null,
      ents: G.mode.streaks.entities.filter((e) => e.kind === 'drohne' && e.alive).length,
    };
  };
  /** Wand in der Nähe des Spielers: kürzester waagerechter Strahl 5…18 m (Kollisionsgeometrie) → {yaw, dist} */
  D.wall = () => {
    const p = G.player;
    const eye = p.getEyePosition(new T.Vector3());
    eye.y += 0.6;
    let best = null;
    for (let i = 0; i < 24; i++) {
      const yaw = (i / 24) * Math.PI * 2;
      const dir = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const h = G.world.raycast(eye, dir, 22);
      if (!h || h.distance < 5 || h.distance > 18) continue;
      if (Math.abs(h.normal.y) > 0.3) continue;
      const facing = -(h.normal.x * dir.x + h.normal.z * dir.z);
      if (facing < 0.85) continue; // möglichst senkrecht auf die Wand
      if (!best || h.distance < best.dist) best = { yaw, dist: h.distance, point: h.point.toArray(), normal: h.normal.toArray() };
    }
    return best;
  };
  /** Gegner-Bot mit freier Sicht nahe am Spieler (Abstand 6…30 m) */
  D.enemy = () => {
    const p = G.player;
    const eye = p.getEyePosition(new T.Vector3());
    let best = null;
    for (const a of G.actors) {
      if (!a.alive || a === p || !G.combat.isHostile(p, a) || a.isRemoteHuman) continue;
      const c = a.position.clone(); c.y += 1.1;
      const d = c.distanceTo(eye);
      if (!best || d < best.d) best = { a, d };
    }
    return best ? best.a : null;
  };
  D.tapFire = () => G.input.simulate.tap('fire');
  /** Simulationszeit abwarten (Headless-Chromium zeichnet nur wenige Bilder je Sekunde; dt ist je Bild begrenzt). */
  D.simWait = async (sec, maxMs = 90000, stop = null) => {
    const t0 = G.time.elapsed;
    const r0 = performance.now();
    while (G.time.elapsed - t0 < sec && performance.now() - r0 < maxMs) {
      if (stop && stop()) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return G.time.elapsed - t0;
  };
  /** Bis zum Start der eigenen Drohne warten (Bilder) */
  D.waitPilot = async (maxMs = 120000) => {
    const r0 = performance.now();
    while (!G.mode.streaks.pilot && performance.now() - r0 < maxMs) await new Promise((r) => setTimeout(r, 30));
    return G.mode.streaks.pilot;
  };
  /** Drohne starten (Serie geben, Taste 6) */
  D.launch = async () => {
    if (!G.mode.streaks.isReady(G.player, 'drohne')) G.debugApi.giveStreak('drohne');
    G.input.simulate.tap('streak4');
    return D.waitPilot();
  };
  return true;
});

/* =================================================================== Offline */

async function offline(browser) {
  info('— Offline (TDM Werk) —');
  await waitForLoad();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const errs = [];
  watchErrors(p, errs);
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=werk&allies=2&enemies=3&diff=rekrut&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.mode && window.__game.mode.streaks, null, 400000, 1000);
  if (!check(!!ok, 'Match läuft (TDM Werk)')) { await ctx.close(); return; }
  await instrument(p);
  const setup = await p.evaluate(() => {
    const G = window.__game;
    G.debugApi.godMode(true);
    G.input.allowUnlockedMouse = true;
    const st = G.mode.streaks;
    return { order: st.order, defs: st.defs.map((d) => `${d.id}:${d.kills}`), key: G.input.label('streak4'), pad: G.input.bindings.pad.streak4, touch: [...document.querySelectorAll('#touch-ui .tc-streak')].map((b) => `${b.dataset.action}=${b.dataset.streak || ''}`) };
  });
  check(setup.order.join(',') === 'uav,strike,sentry,drohne' && setup.defs.join(',') === 'uav:4,drohne:5,strike:6,sentry:8',
    `Plätze ${setup.order.join('/')} (Tasten fest), Fortschritt nach Abschüssen ${setup.defs.join(' ')}`);
  check(setup.key === '6' && setup.pad.join() === 'Pad6+Pad13' && setup.touch.includes('streak4=drohne') && setup.touch.includes('streak2=strike'),
    `Belegung: Taste ${setup.key}, Gamepad ${setup.pad.join()}, Touch ${setup.touch.join(' ')}`);

  // Gamepad LT + ▼ (Akkord der Serie 4) ohne bereite Drohne: ▼ bleibt Lampe/Platte (wie vor der Drohne)
  const chord = (p2) => p2.evaluate(() => {
    const G = window.__game;
    const I = G.input;
    I.simulate.code('Pad6+Pad13', true);
    const acts = ['light', 'plate', 'streak4'].filter((a) => I.pressed(a));
    I.simulate.code('Pad6+Pad13', false);
    for (const a of ['light', 'plate', 'streak4']) I.consume(a); // nichts auslösen
    return acts;
  });
  const ch0 = await chord(p);
  check(ch0.join(',') === 'light,plate', `Gamepad LT + ▼ ohne bereite Drohne → ${ch0.join('/')} (wie bisher)`);

  // --- Fortschritt: 5 Abschüsse → bereit (Abschüsse über combat.damage mit dem Spieler)
  const prog = await p.evaluate(() => {
    const G = window.__game;
    const st = G.mode.streaks;
    const ready = [];
    const off = G.events.on('streak:ready', (e) => { if (e.actor === G.player) ready.push(e.streakId); });
    let k = 0;
    for (let i = 0; i < 12 && k < 5; i++) {
      const b = G.actors.find((a) => a.alive && a !== G.player && G.combat.isHostile(G.player, a));
      if (!b) { G.debugApi.spawnBots(1); continue; }
      G.combat.damage(b, { amount: 9999, attacker: G.player, weaponId: G.player.weapon.currentDef.id, zone: 'body', dir: new G.THREE.Vector3(0, 0, -1) });
      if (!b.alive) k++;
    }
    off();
    return { k, ready, isReady: st.isReady(G.player, 'drohne'), panel: [...document.querySelectorAll('.h-streak')].map((n) => `${n.dataset.id}${n.classList.contains('is-ready') ? '*' : ''}:${n.querySelector('kbd').textContent}`) };
  });
  check(prog.k === 5 && prog.ready.includes('uav') && prog.ready.includes('drohne') && prog.isReady, `5 Abschüsse → bereit: ${prog.ready.join(', ')}`);
  const panel = (await until(p, () => {
    const l = [...document.querySelectorAll('.h-streak')].map((n) => `${n.dataset.id}${n.classList.contains('is-ready') ? '*' : ''}:${n.querySelector('kbd').textContent}`);
    return l.join(' ').includes('*') && l;
  }, null, 20000, 200)) || [];
  check(panel.join(' ') === 'uav*:3 drohne*:6 strike:4 sentry:5', `HUD-Leiste (nach Abschüssen, Taste je Platz): ${panel.join(' ')}`);
  const ch1 = await chord(p);
  check(ch1.join(',') === 'streak4', `Gamepad LT + ▼ mit bereiter Drohne → ${ch1.join('/')}`);

  // --- Start
  const body0 = await p.evaluate(() => { window.__game.input.simulate.tap('streak4'); return window.__game.player.position.toArray(); });
  const s1 = await until(p, () => window.__dt.pilot() && window.__dt.state(), null, 30000, 100);
  if (!check(!!s1 && s1.pilot && s1.piloting, 'Taste 6 (streak4) → Drohne fliegt, Spieler steuert sie')) { await ctx.close(); return; }
  const startOff = Math.hypot(s1.drone.pos[0] - body0[0], s1.drone.pos[2] - body0[2]);
  const startUp = s1.drone.pos[1] - body0[1];
  check(startOff > 0.3 && startOff < 2.5 && startUp > 1.6 && startUp < 3.2, `Start vor dem Kopf: ${f1(startOff)} m vor, ${f1(startUp)} m über den Füßen`);
  check(s1.droneAttr === '1' && s1.hud && s1.vm === false, `Drohnen-HUD an (body[data-drone] ${s1.droneAttr}, Waffe ausgeblendet ${!s1.vm})`);
  const camD = Math.hypot(s1.cam[0] - s1.drone.pos[0], s1.cam[1] - s1.drone.pos[1], s1.cam[2] - s1.drone.pos[2]);
  check(camD < 0.5, `Kamera sitzt in der Drohne (${f1(camD)} m)`);
  // Taste ohne Bereitschaft (Aufklärer ist bereit, wird im Flug aber nicht eingesetzt)
  await p.evaluate(async () => { window.__game.input.simulate.tap('streak1'); await window.__dt.simWait(0.2); });
  const uavDuring = await p.evaluate(() => window.__game.mode.streaks.uavActive(window.__game.player));
  check(!uavDuring, 'im Flug keine andere Serie (Taste 3 bleibt ohne Wirkung)');
  await p.screenshot({ path: `${OUT}/drone-hud-pc.png`, timeout: 180000 });
  info(`Bild: ${OUT}/drone-hud-pc.png`);

  // --- Fliegen: vorwärts, Körper bleibt stehen, Höchsttempo
  const fly = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    const d = D.pilot();
    // freie Richtung (längster waagerechter Strahl in Flughöhe), leicht nach oben
    let best = { yaw: d.yaw, dist: 0 };
    for (let i = 0; i < 24; i++) {
      const yaw = (i / 24) * Math.PI * 2;
      const dir = new G.THREE.Vector3(-Math.sin(yaw), 0.08, -Math.cos(yaw)).normalize();
      const h = G.world.raycast(d.position, dir, 120);
      const dist = h ? h.distance : 120;
      if (dist > best.dist) best = { yaw, dist };
    }
    d.yaw = best.yaw;
    d.pitch = 0.08;
    const p0 = d.position.clone();
    const b0 = G.player.position.clone();
    G.input.simulate.move(0, 1);
    let vmax = 0;
    await D.simWait(2.2, 90000, () => { vmax = Math.max(vmax, d.speed); return !d.alive; });
    const sim = G.time.elapsed;
    const moved = d.position.distanceTo(p0);
    G.input.simulate.press('sprint');
    let vboost = 0;
    await D.simWait(1.2, 60000, () => { vboost = Math.max(vboost, d.speed); return !d.alive; });
    G.input.simulate.release('sprint');
    G.input.simulate.move(0, 0);
    return { moved, body: G.player.position.distanceTo(b0), vmax, vboost, alive: d.alive, ended: d.ended, boostLeft: d.boostLeft, sim };
  });
  info(`Flug: ${f1(fly.moved)} m, Körper ${fly.body.toFixed(2)} m, Tempo ${f1(fly.vmax)} m/s, Schub ${f1(fly.vboost)} m/s${fly.alive ? '' : `, Ende ${fly.ended}`}`);
  check(fly.moved > 6 && fly.body < 0.3, `vorwärts geflogen (${f1(fly.moved)} m), Körper steht (${fly.body.toFixed(2)} m)`);
  check(fly.vmax <= 18.6 && (fly.vmax > 10 || !fly.alive), `Höchsttempo ohne Schub ${f1(fly.vmax)} m/s (≤ 18)`);
  if (fly.alive) check(fly.vboost > fly.vmax + 1 && fly.vboost <= 26.6, `Schub ${f1(fly.vboost)} m/s (≤ 26)`);
  // Steigen/Sinken
  const climb = await p.evaluate(async () => {
    const G = window.__game;
    const d = window.__dt.pilot();
    if (!d) return null;
    await window.__dt.simWait(0.6); // ausbremsen
    const y0 = d.position.y;
    G.input.simulate.press('jump');
    await window.__dt.simWait(0.8);
    G.input.simulate.release('jump');
    const y1 = d.position.y;
    G.input.simulate.press('crouch');
    await window.__dt.simWait(0.6);
    G.input.simulate.release('crouch');
    return { up: y1 - y0, down: y1 - d.position.y, crouch: G.player.crouching, jumped: G.player.body.velocity.y > 1 };
  });
  if (climb) check(climb.up > 0.8 && climb.down > 0.3 && !climb.crouch && !climb.jumped, `Leertaste steigt (+${f1(climb.up)} m), C sinkt (−${f1(climb.down)} m), Körper springt/duckt nicht`);
  // Abbrechen (F) – falls die Drohne beim Flug schon irgendwo anstieß, neu starten
  await p.evaluate(async () => { if (!window.__dt.pilot()) await window.__dt.launch(); window.__game.input.simulate.tap('interact'); });
  const ab = await until(p, () => !window.__dt.pilot() && window.__dt.state(), null, 120000, 100);
  const lastEnd = await p.evaluate(() => window.__dt.ends.slice(-1)[0] || null);
  check(!!ab && !ab.piloting && ab.droneAttr === '' && !ab.hud && ab.vm === true && lastEnd && lastEnd.why === 'abbruch', `F bricht ab (${lastEnd && lastEnd.why}), Kamera zurück, HUD aus, Waffe wieder da`);
  const camBack = ab ? Math.hypot(ab.cam[0] - ab.body[0], ab.cam[2] - ab.body[2]) : 99;
  check(camBack < 0.6, `Kamera wieder am Körper (${f1(camBack)} m)`);

  // --- Wand: langsam → bleibt davor; schnell → zerschellt; nie dahinter
  const wall = await p.evaluate(() => window.__dt.wall());
  if (check(!!wall, `Wand gefunden (${wall ? f1(wall.dist) : '-'} m)`)) {
    for (const [label, thrust, expectCrash] of [['langsam', 0.3, false], ['schnell', 1, true]]) {
      const r = await p.evaluate(async ({ wall, thrust }) => {
        const G = window.__game;
        const T = G.THREE;
        G.player.yaw = wall.yaw;
        G.player.pitch = 0;
        const d = await window.__dt.launch();
        if (!d) return { err: 'kein Start' };
        d.yaw = wall.yaw;
        d.pitch = 0;
        d.velocity.set(0, 0, 0);
        const n = new T.Vector3().fromArray(wall.normal);
        const wp = new T.Vector3().fromArray(wall.point);
        // Abstand zur Wandebene (positiv = davor)
        const sd = () => d.position.clone().sub(wp).dot(n);
        let minSd = sd();
        G.input.simulate.move(0, thrust);
        await window.__dt.simWait(3.2, 120000, () => { minSd = Math.min(minSd, sd()); return !d.alive; });
        G.input.simulate.move(0, 0);
        const res = { alive: d.alive, ended: d.ended, minSd, end: sd() };
        if (d.alive) G.input.simulate.tap('interact');
        return res;
      }, { wall, thrust });
      info(`Wand ${label}: kleinster Abstand ${r.minSd != null ? r.minSd.toFixed(2) : '-'} m, ${r.err ? r.err : r.alive ? 'fliegt noch' : `Ende ${r.ended}`}`);
      check(!r.err && r.minSd > 0.05, `Wand ${label}: kein Durchdringen (Abstand zur Wand ≥ ${r.minSd != null ? r.minSd.toFixed(2) : '?'} m)`);
      if (expectCrash) check(!r.alive && r.ended === 'aufprall', `Wand ${label}: harter Aufprall → zerschellt (${r.ended})`);
      else check(!r.err && (r.alive || r.ended !== 'aufprall'), `Wand ${label}: sanftes Anlegen ohne Absturz (${r.alive ? 'fliegt' : r.ended})`);
      await until(p, () => !window.__dt.pilot(), null, 120000, 100);
    }
  }

  // --- Sprengung neben einem Bot
  const boom = await p.evaluate(async () => {
    const G = window.__game;
    const T = G.THREE;
    const D = window.__dt;
    const st = G.mode.streaks;
    const d = await D.launch();
    if (!d) return { err: 'kein Start' };
    let bot = D.enemy();
    if (!bot) { G.debugApi.spawnBots(1); bot = D.enemy(); }
    if (!bot) return { err: 'kein Gegner' };
    bot.update = () => {}; // Ziel stillhalten (nur für den Test)
    // Punkt 0,9 m neben der Brust mit freier Sicht
    const chest = bot.position.clone(); chest.y += 1.1;
    let spot = null;
    for (let i = 0; i < 8 && !spot; i++) {
      const a = (i / 8) * Math.PI * 2;
      const c = chest.clone().add(new T.Vector3(Math.sin(a) * 0.9, 0.2, Math.cos(a) * 0.9));
      if (G.world.lineOfSight(c, chest)) spot = c;
    }
    if (!spot) return { err: 'kein freier Punkt' };
    d.position.copy(spot);
    d.velocity.set(0, 0, 0);
    const kills0 = G.player.stats.kills;
    const score0 = G.player.stats.score;
    const n0 = D.kills.length;
    await D.simWait(0.05);
    d.position.copy(spot);
    d.velocity.set(0, 0, 0);
    G.input.simulate.tap('fire');
    const r1 = performance.now();
    while (D.pilot() && performance.now() - r1 < 30000) await new Promise((r) => setTimeout(r, 30));
    await D.simWait(0.1);
    const k = D.kills.slice(n0).find((x) => x.victimRef === bot) || null;
    const feed = [...document.querySelectorAll('.kf-row')].map((r) => r.querySelector('.kf-w') && r.querySelector('.kf-w').getAttribute('title')).filter(Boolean);
    const ex = D.explosions.slice(-3).find((e) => e.w === 'drohne') || null;
    return {
      botAlive: bot.alive, kill: k ? { killer: k.killer, mine: k.mine, weapon: k.weapon } : null, kills: G.player.stats.kills - kills0, score: G.player.stats.score - score0,
      feed, ex, end: D.ends.slice(-1)[0], state: D.state(), lifeKills: st.progress(G.player).kills,
    };
  });
  if (boom.err) check(false, `Sprengung: ${boom.err}`);
  else {
    check(!!boom.ex && boom.ex.by === (await p.evaluate(() => window.__game.player.name)), `Explosion (Ursache ${boom.ex && boom.ex.w}, Angreifer = Spieler)`);
    check(!boom.botAlive && boom.kill && boom.kill.mine && boom.kill.weapon === 'drohne', `Bot tot, Abschuss für den Spieler mit Ursache „${boom.kill && boom.kill.weapon}“`);
    check(boom.kills === 1 && boom.score >= 100, `Statistik: +${boom.kills} Abschuss, +${boom.score} Punkte`);
    check(boom.feed.includes('FPV-Drohne'), `Abschussliste: „${boom.feed[0] || '-'}“`);
    check(boom.end && boom.end.why === 'boom' && !boom.state.pilot && !boom.state.hud && boom.state.vm, `Kamera nach der Sprengung zurück (Ende ${boom.end && boom.end.why})`);
    check(boom.lifeKills === 5, `Drohnen-Abschuss zählt nicht für die nächste Serie (Leben ${boom.lifeKills})`);
  }

  // --- Akku
  const bat = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    const d = await D.launch();
    if (!d) return { err: 'kein Start' };
    d.battery = 0.6;
    await D.simWait(1.5, 90000, () => !d.alive);
    await D.simWait(0.1);
    return { ended: d.ended, pilot: !!D.pilot(), notice: [...document.querySelectorAll('.h-notice')].map((n) => n.textContent).join(' | ') };
  });
  check(!bat.err && bat.ended === 'akku' && !bat.pilot, `Akku leer → Absturz (${bat.ended}), Kamera zurück; Hinweis „${bat.notice}“`);

  // --- Signal/Reichweite
  const sig = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    const d = await D.launch();
    if (!d) return { err: 'kein Start' };
    d.launch.x -= 130; // Startpunkt 130 m weg: Signal schwach
    await D.simWait(0.3);
    const r0 = performance.now();
    while (performance.now() - r0 < 20000 && !document.querySelector('.dr-warn').textContent) await new Promise((r) => setTimeout(r, 50));
    const nz = document.querySelector('.dr-noise');
    const weak = { signal: d.signal, noise: nz.hidden ? 0 : Number(getComputedStyle(nz).opacity), warn: document.querySelector('.dr-warn').textContent };
    d.launch.x -= 30;
    await D.simWait(1, 60000, () => !d.alive);
    return { weak, ended: d.ended };
  });
  check(!sig.err && sig.weak.signal < 0.7 && sig.weak.noise > 0.3 && /Signal/.test(sig.weak.warn), `ab 110 m schwaches Signal (${sig.weak && sig.weak.signal.toFixed(2)}), Rauschen ${sig.weak && sig.weak.noise.toFixed(2)}, „${sig.weak && sig.weak.warn}“`);
  check(sig.ended === 'signal', `über 150 m Abbruch (${sig.ended})`);

  // --- Abschuss durch einen Bot-Schuss (world.raycast → Trefferkugel)
  const shot = await p.evaluate(async () => {
    const G = window.__game;
    const T = G.THREE;
    const D = window.__dt;
    const d = await D.launch();
    if (!d) return { err: 'kein Start' };
    G.input.simulate.press('jump'); // ein Stück steigen, dann schweben
    await D.simWait(0.4);
    G.input.simulate.release('jump');
    let bot = D.enemy();
    if (!bot) { G.debugApi.spawnBots(1); bot = D.enemy(); }
    if (!bot) return { err: 'kein Gegner' };
    const def = G.data.WEAPONS[(bot.weapon && bot.weapon.currentDef && bot.weapon.currentDef.id) || 'ar_kv47'];
    // Schütze 6 m neben der Drohne (Sichtlinie), Schüsse direkt auf die Drohne
    const hp0 = d.health;
    let n = 0;
    for (; n < 12 && d.alive; n++) {
      const from = d.position.clone().add(new T.Vector3(0, 0, 0));
      const origin = from.clone().add(new T.Vector3(3.5, 0.4, 3.5));
      const dir = d.position.clone().sub(origin).normalize();
      G.combat.fireHitscan({ shooter: bot, origin, dir, range: 100, weapon: def });
      await D.simWait(0.02, 5000);
    }
    await D.simWait(0.1);
    return { hp0, alive: d.alive, ended: d.ended, n, end: D.ends.slice(-1)[0], feed: document.querySelector('.kf-row') ? document.querySelector('.kf-row').textContent : '' };
  });
  check(!shot.err && !shot.alive && shot.ended === 'abschuss' && shot.end && shot.end.by, `Drohne (${shot.hp0} LP) nach ${shot.n} Treffern abgeschossen (${shot.ended}, von ${shot.end && shot.end.by}); Liste „${shot.feed}“`);

  // --- Tod des Spielers im Flug
  const death = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    const d = await D.launch();
    if (!d) return { err: 'kein Start' };
    G.debugApi.godMode(false);
    let bot = D.enemy();
    if (!bot) { G.debugApi.spawnBots(1); bot = D.enemy(); }
    G.combat.damage(G.player, { amount: 9999, attacker: bot, weaponId: 'ar_kv47', zone: 'body', dir: new G.THREE.Vector3(0, 0, 1) });
    await D.simWait(0.1);
    const s = D.state();
    return { alive: s.alive, droneAlive: d.alive, ended: d.ended, pilot: s.pilot, hud: s.hud, attr: s.droneAttr, vm: s.vm };
  });
  check(!death.err && !death.alive && !death.droneAlive && death.ended === 'tot' && !death.pilot && !death.hud && death.attr === '' && death.vm === false,
    `Spieler stirbt im Flug → Drohne weg (${death.ended}), HUD aus, Waffe bleibt im Tod ausgeblendet`);
  // Wiedereinstieg abwarten
  const back = await until(p, () => window.__game.player.alive, null, 240000, 300);
  check(!!back, 'Wiedereinstieg nach dem Tod');
  await p.evaluate(() => { window.__game.debugApi.godMode(true); });
  const vmBack = await p.evaluate(() => window.__game.viewmodel.scene.visible && !window.__game.player.piloting);
  check(vmBack, 'nach dem Wiedereinstieg: Waffe sichtbar, nicht mehr im Drohnenflug');

  // --- Bot-Drohne (Autopilot): startet und endet von selbst (Sprengung, Absturz oder Akku)
  const bd = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    const st = G.mode.streaks;
    const ally = G.actors.find((a) => a.alive && a.isBot && a !== G.player && !G.combat.isHostile(G.player, a));
    if (!ally) return { err: 'kein Verbündeter' };
    const s = st._st(ally);
    if (!s.ready.includes('drohne')) s.ready.push('drohne');
    let ok = st.activate(ally, 'drohne');
    if (!ok) {
      // kein Gegner in Reichweite: einen herholen
      const e = D.enemy();
      if (e) { e.body.teleport(ally.position.clone().add(new G.THREE.Vector3(12, 0, 0))); }
      ok = st.activate(ally, 'drohne');
    }
    const d = st.droneOf(ally);
    if (!ok || !d) return { err: 'kein Start' };
    d.battery = Math.min(d.battery, 6);
    // Besitzer unverwundbar, solange geprüft wird (sonst endet die Drohne mit 'tot', bevor der Autopilot etwas zeigt)
    const inv = ally.invulnerable;
    ally.invulnerable = true;
    let maxD = 0;
    G.debugApi.setTimeScale(2);
    const secs = await D.simWait(8, 240000, () => { maxD = Math.max(maxD, d.distance); return !d.alive; });
    G.debugApi.setTimeScale(1);
    ally.invulnerable = inv;
    return { alive: d.alive, ended: d.ended, maxD, secs };
  });
  check(!bd.err && !bd.alive && ['boom', 'aufprall', 'akku', 'signal', 'abschuss'].includes(bd.ended), `Bot-Drohne endet von selbst (${bd.ended || bd.err}, ${f1(bd.maxD)} m geflogen, ${f1(bd.secs)} s)`);

  // --- Drohne von außen (Abbild vor der Kamera, Rotoren drehen)
  await p.evaluate(async () => {
    const G = window.__game;
    const T = G.THREE;
    const st = G.mode.streaks;
    const { Drone } = await import('./assets/js/game/modes/drone.js');
    const p = G.player;
    p.pitch = -0.16;
    await window.__dt.simWait(0.1, 20000);
    const eye = p.getEyePosition(new T.Vector3());
    const fwd = new T.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const pos = eye.clone().addScaledVector(fwd, 0.75);
    pos.y -= 0.13;
    const ally = G.actors.find((a) => a !== p && !G.combat.isHostile(p, a)) || p;
    const d = new Drone(st, ally, { role: 'replica', position: pos, launch: pos, yaw: p.yaw + 2.4, pitch: 0, params: st.byId.drohne.params, netId: 0 });
    d.seenAt = 1e9; d.netAt = G.time.elapsed;
    st.entities.push(d);
    window.__dt.view = d;
    window.__dt.viewPos = pos.toArray();
    G.viewmodel.scene.visible = false;
    G.hud.hide();
  });
  await p.evaluate(() => window.__dt.simWait(0.8, 60000));
  // leichte Neigung (Seitwärtsflug) und Stillstand an der Stelle zeigen
  await p.evaluate(() => { const d = window.__dt.view; d.netPos.fromArray(window.__dt.viewPos); d.position.fromArray(window.__dt.viewPos); d.netVel.set(0, 0, 0); d.roll = -0.18; d.tilt = 0.12; });
  await p.evaluate(() => window.__dt.simWait(0.05, 30000));
  await p.screenshot({ path: `${OUT}/drone-aussen.png`, timeout: 180000 });
  info(`Bild: ${OUT}/drone-aussen.png`);
  await p.evaluate(() => { const d = window.__dt.view; d.end('ende', null, null, { quiet: true }); window.__game.hud.show(); window.__game.viewmodel.scene.visible = true; });

  // --- Matchende im Flug
  const endm = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    if (!(await D.launch())) return { err: 'kein Start' };
    G.debugApi.endMatch();
    await new Promise((r) => setTimeout(r, 1500));
    const au = G.mode.streaks.droneAudio;
    const eye = G.player.getEyePosition(new G.player.position.constructor());
    return {
      pilot: !!D.pilot(), piloting: !!G.player.piloting, attr: document.body.dataset.drone || '', end: D.ends.slice(-1)[0], state: G.match.state,
      voices: au.voices.size + (au.static ? 1 : 0), cam: G.camera.position.distanceTo(eye), fov: G.camera.fov, base: G.player.baseFov || 0,
    };
  });
  check(!endm.err && !endm.pilot && !endm.piloting && endm.attr === '' && endm.end && endm.end.why === 'ende', `Matchende im Flug → Drohne weg (${endm.end && endm.end.why}), Zustand ${endm.state}`);
  check(!endm.err && endm.voices === 0 && endm.cam < 0.8 && Math.abs(endm.fov - endm.base) < 12, `Matchende: Summen aus (${endm.voices} Stimmen), Kamera im Kopf (${endm.cam != null ? endm.cam.toFixed(2) : '?'} m, fov ${endm.fov != null ? endm.fov.toFixed(1) : '?'})`);
  check(!errs.length, `keine Seiten-/Konsolenfehler${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

/* =================================================================== Handy (Touch) */

async function handy(browser) {
  info('— Handy (Touch, Querformat) —');
  await waitForLoad();
  const dev = devices['iPhone 13'] ? { ...devices['iPhone 13'], viewport: { width: 844, height: 390 } } : { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
  const ctx = await browser.newContext({ ...dev, viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  watchErrors(p, errs);
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=werk&allies=1&enemies=2&diff=rekrut&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.mode && window.__game.mode.streaks, null, 400000, 1000);
  if (!check(!!ok, 'Match läuft (Touch)')) { await ctx.close(); return; }
  await instrument(p);
  const t = await p.evaluate(() => {
    const G = window.__game;
    G.debugApi.godMode(true);
    G.debugApi.giveStreak('drohne');
    return { mode: G.input.mode, btns: [...document.querySelectorAll('#touch-ui .tc-streak')].map((b) => `${b.dataset.streak}:${getComputedStyle(b).display !== 'none'}`) };
  });
  check(t.mode === 'touch' && t.btns.length === 4 && t.btns.every((x) => x.endsWith('true')), `Touch: vier Serienknöpfe sichtbar (${t.btns.join(' ')})`);
  await p.evaluate(() => window.__dt.simWait(0.1, 20000));
  // echter Fingertipp auf den Drohnen-Knopf
  const box = await p.evaluate(() => { const r = document.querySelector('#touch-ui .tc-streak[data-action="streak4"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.touchscreen.tap(box.x, box.y);
  const s = await until(p, () => window.__dt.pilot() && window.__dt.state(), null, 30000, 100);
  check(!!s && s.pilot, 'Antippen des Drohnen-Knopfs startet die Drohne');
  await p.evaluate(() => window.__dt.simWait(0.3, 30000));
  const tb = await p.evaluate(() => ({
    drone: [...document.querySelectorAll('.dr-touch .dr-tb')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.dataset.act),
    hiddenBtns: [...document.querySelectorAll('#touch-ui .tc-btn:not(.tc-pause):not(.tc-score)')].filter((b) => getComputedStyle(b).display !== 'none').length,
    menu: [...document.querySelectorAll('#touch-ui :is(.tc-pause, .tc-score)')].filter((b) => getComputedStyle(b).display !== 'none').length,
    stick: getComputedStyle(document.querySelector('#touch-ui .tc-stick')).display !== 'none',
  }));
  check(tb.drone.join(',') === 'interact,jump,crouch,sprint,fire' && tb.hiddenBtns === 0 && tb.menu === 2 && tb.stick, `Touch im Flug: Knöpfe ${tb.drone.join('/')}, übrige Knöpfe aus (Pause/Tabelle bleiben: ${tb.menu}), Stick bleibt`);
  // Hoch-Knopf halten
  const up = await p.evaluate(() => { const r = document.querySelector('.dr-touch .dr-up').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, y0: window.__dt.pilot().position.y }; });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: up.x, y: up.y }] });
  await p.evaluate(() => window.__dt.simWait(0.8, 60000));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const y1 = await p.evaluate(() => window.__dt.pilot() ? window.__dt.pilot().position.y : null);
  check(y1 != null && y1 - up.y0 > 0.5, `Hoch-Knopf gehalten → steigt (+${y1 != null ? (y1 - up.y0).toFixed(1) : '?'} m)`);
  await p.evaluate(() => window.__dt.simWait(0.2, 30000));
  await p.screenshot({ path: `${OUT}/drone-hud-handy.png`, timeout: 180000 });
  info(`Bild: ${OUT}/drone-hud-handy.png`);
  // Sprengen-Knopf
  const bx = await p.evaluate(() => { const r = document.querySelector('.dr-touch .dr-boom').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.touchscreen.tap(bx.x, bx.y);
  const e = await until(p, () => !window.__dt.pilot() && window.__dt.ends.slice(-1)[0], null, 30000, 100);
  check(!!e && e.why === 'boom', `Sprengen-Knopf → Sprengung (${e && e.why})`);
  await p.evaluate(() => window.__dt.simWait(0.1, 30000));
  const after = await p.evaluate(() => ({ visible: [...document.querySelectorAll('#touch-ui .tc-btn')].filter((b) => getComputedStyle(b).display !== 'none').length, dr: !!document.querySelector('.dr-touch:not([hidden])') }));
  check(after.visible > 5 && !after.dr, `danach normale Touch-Knöpfe wieder da (${after.visible})`);
  check(!errs.length, `keine Seiten-/Konsolenfehler${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

/* =================================================================== VR (Sitzung nachgestellt) */

async function vr(browser) {
  info('— VR (nachgestellt: G.xr.presenting, Ereignis xr:start) —');
  await waitForLoad();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const errs = [];
  watchErrors(p, errs);
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=werk&allies=1&enemies=2&diff=rekrut&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.mode && window.__game.mode.streaks, null, 400000, 1000);
  if (!check(!!ok, 'Match läuft (VR-Prüfung)')) { await ctx.close(); return; }
  await instrument(p);
  // In VR: Taste/Knopf → kein Start, Hinweis, Prämie bleibt bereit
  const inVr = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    G.debugApi.godMode(true);
    G.input.allowUnlockedMouse = true;
    G.debugApi.giveStreak('drohne');
    const refused = [];
    const off = G.events.on('streak:refused', (e) => refused.push(e.reason));
    // Während einer echten Sitzung taktet die Brille die Bilder (die rAF-Schleife setzt aus) – daher der Einsatz synchron
    // wie aus StreakManager.update (Taste streak4), danach sofort zurück
    const was = G.xr.presenting;
    let started;
    G.xr.presenting = true;
    try { started = G.mode.streaks._playerActivate('drohne'); } finally { G.xr.presenting = was; }
    await D.simWait(0.3, 30000);
    const res = { started: !!started, pilot: !!D.pilot(), refused: refused.slice(), ready: G.mode.streaks.isReady(G.player, 'drohne'), notice: [...document.querySelectorAll('.h-notice')].map((n) => n.textContent).join(' | ') };
    off();
    return res;
  });
  check(!inVr.started && !inVr.pilot && inVr.refused.includes('vr') && inVr.ready, `in VR kein Start (${inVr.refused.join(',')}), Prämie bleibt bereit; Hinweis „${inVr.notice}“`);
  // Sitzung beginnt mitten im Flug → Drohne bricht ab, Kamera/HUD zurück
  const start = await p.evaluate(async () => {
    const G = window.__game;
    const D = window.__dt;
    const d = await D.launch();
    if (!d) return { err: 'kein Start' };
    G.events.emit('xr:start', { space: 'local-floor' });
    await D.simWait(0.1, 30000);
    return { ended: d.ended, pilot: !!D.pilot(), piloting: !!G.player.piloting, attr: document.body.dataset.drone || '', vm: G.viewmodel.scene.visible };
  });
  check(!start.err && start.ended === 'abbruch' && !start.pilot && !start.piloting && start.attr === '' && start.vm, `VR-Sitzung im Flug → Drohne bricht ab (${start.ended || start.err}), HUD aus, Waffe zurück`);
  check(!errs.length, `keine Seiten-/Konsolenfehler${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

/* =================================================================== Online */

async function online(browser) {
  info('— Online (Host + 1 Client) —');
  await waitForLoad();
  const pages = [];
  const errs = {};
  const open = async (name, w = 640, h = 360) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    errs[name] = [];
    watchErrors(p, errs[name]);
    await p.goto(`${BASE}spielen.html?quality=low&relays=${encodeURIComponent(RELAY)}`);
    await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 180000 });
    await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
    pages.push(ctx);
    return p;
  };
  try {
    const host = await open('Hosti', 800, 450);
    const cl = await open('Anna');
    const code = await host.evaluate(() => window.__game.net.host({ name: 'Drohne', mode: 'tdm', map: 'werk', maxPlayers: 4, teamSize: 3, pvp: 'pvp', botFill: true, difficulty: 'rekrut', style: 'arcade' }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
    check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
    let j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
    if (!j.ok) { info(`Beitritt ${j.code} – zweiter Versuch`); j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code); }
    if (!check(j.ok, `Client tritt bei (${j.ok ? `id ${j.id}` : j.code})`)) return;
    await until(host, () => window.__game.net.roster.length === 2, null, 20000);
    await host.evaluate(() => window.__game.net.startMatch());
    const inMatch = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 600000, 1000)));
    if (!check(inMatch.every(Boolean), 'Host + Client im Match')) return;
    await instrument(host);
    await instrument(cl);
    const cfg = await Promise.all([host, cl].map((p) => p.evaluate(() => { const st = window.__game.mode.streaks; return st ? `${st.replica ? 'Abbild' : 'Host'}:${st.defs.map((d) => d.id).join(',')}` : 'keine'; })));
    check(cfg[0] === 'Host:drohne' && cfg[1] === 'Abbild:drohne', `online nur die Drohne: Host ${cfg[0]}, Client ${cfg[1]}`);
    // SwiftShader zeichnet hier nur ~1 Bild/s: die Spielzeit des Clients läuft weit langsamer als die Echtzeit → Spielraum der
    // Flugdauer beim Host für den Prüflauf vergrößern (Standard 2,2 = Clients ab ≈ 9 Bildern/s)
    await host.evaluate((aId) => { const G = window.__game; G.debugApi.godMode(true); G.mode.streaks.netTimeFactor = 60; const a = G.net.actorById(aId); if (a) a.invulnerable = true; }, j.id);
    await cl.evaluate(() => { window.__game.player.godMode = true; window.__game.input.allowUnlockedMouse = true; });

    // --- Host gibt Annas Puppe die Serie (wie nach 5 Abschüssen) → Client bekommt 'sk'
    await host.evaluate((aId) => { const G = window.__game; const a = G.net.actorById(aId); G.mode.streaks.onKill(a, 5); }, j.id);
    const rdy = await until(cl, () => {
      const l = [...document.querySelectorAll('.h-streak')].map((n) => n.dataset.id + (n.classList.contains('is-ready') ? '*' : '')).join(' ');
      return window.__game.mode.streaks.isReady(window.__game.player, 'drohne') && l.includes('*') && l;
    }, null, 30000, 200);
    check(!!rdy && /drohne\*/.test(rdy), `Client: Serie bereit laut Host (Leiste ${rdy})`);
    // --- Ziel beim Host: Gegner-Bot 9 m vor Annas Puppe, angehalten
    const tgt = await host.evaluate((aId) => {
      const G = window.__game;
      const T = G.THREE;
      const anna = G.net.actorById(aId);
      const eye = anna.getEyePosition(new T.Vector3());
      const bot = G.actors.find((a) => a.alive && a.isBot && !a.isRemoteHuman && G.combat.isHostile(anna, a));
      if (!bot) return null;
      // freie Richtung suchen
      for (let i = 0; i < 16; i++) {
        const yaw = (anna.yaw || 0) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
        const dir = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const to = eye.clone().addScaledVector(dir, 9);
        if (!G.world.lineOfSight(eye, to)) continue;
        const ground = G.world.raycast(to.clone().setY(to.y + 1), new T.Vector3(0, -1, 0), 10);
        if (!ground) continue;
        bot.body.teleport(ground.point.clone());
        bot.update = () => {}; // stillhalten (nur für den Test)
        return { yaw, netId: bot.netId, name: bot.name, pos: ground.point.toArray() };
      }
      return null;
    }, j.id);
    if (!check(!!tgt, `Host: Ziel-Bot ${tgt && tgt.name} angehalten (9 m vor Anna)`)) return;
    await cl.evaluate(() => window.__dt.simWait(0.6, 30000));
    // --- Client startet die Drohne
    await cl.evaluate((yaw) => { const G = window.__game; G.player.yaw = yaw; G.player.pitch = 0; G.input.simulate.tap('streak4'); }, tgt.yaw);
    const cs = await until(cl, () => window.__dt.pilot() && window.__dt.state(), null, 30000, 100);
    check(!!cs && cs.drone.netId > 0, `Client: Host bestätigt, Drohne #${cs && cs.drone.netId} fliegt lokal`);
    const hs = await until(host, (aId) => { const G = window.__game; const a = G.net.actorById(aId); const d = G.mode.streaks.droneOf(a); return d && { role: d.role, netId: d.netId, pos: d.position.toArray(), inScene: !!d.group.parent && d.group.visible }; }, j.id, 20000, 100);
    check(!!hs && hs.role === 'remote' && hs.inScene && cs && hs.netId === cs.drone.netId, `Host sieht die Drohne (Rolle ${hs && hs.role}, #${hs && hs.netId}, in der Szene)`);
    // ein Stück fliegen: Host folgt der Lage
    await cl.evaluate(async () => { const G = window.__game; G.input.simulate.press('jump'); await window.__dt.simWait(0.6, 60000); G.input.simulate.release('jump'); await window.__dt.simWait(0.8, 60000); });
    await sleep(1500); // Host-Bilder (Glättung)
    const cpos = await cl.evaluate(() => window.__dt.pilot().position.toArray());
    const hpos = await host.evaluate((aId) => { const G = window.__game; const d = G.mode.streaks.droneOf(G.net.actorById(aId)); return d ? d.position.toArray() : null; }, j.id);
    const lag = hpos ? Math.hypot(cpos[0] - hpos[0], cpos[1] - hpos[1], cpos[2] - hpos[2]) : 99;
    check(lag < 1.5, `Host folgt der Lage des Clients (Abstand ${lag.toFixed(2)} m)`);
    // Host-Spieler hinter Anna stellen und zur Drohne sehen (Bild)
    await host.evaluate((aId) => {
      const G = window.__game;
      const T = G.THREE;
      const a = G.net.actorById(aId);
      const d = G.mode.streaks.droneOf(a);
      if (!a || !d) return;
      // Standpunkt 3 m neben der Drohne mit freier Sicht und Boden darunter
      for (let i = 0; i < 12; i++) {
        const ang = (a.yaw || 0) + Math.PI + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
        const eye = d.position.clone().add(new T.Vector3(-Math.sin(ang) * 1.8, 0.3, -Math.cos(ang) * 1.8));
        if (!G.world.lineOfSight(d.position, eye)) continue;
        const g = G.world.raycast(eye, new T.Vector3(0, -1, 0), 6);
        if (!g || eye.y - g.point.y < 1.2) continue;
        G.debugApi.teleport(g.point.x, g.point.y + 0.05, g.point.z);
        break;
      }
      G.debugApi.lookAt(d.position.x, d.position.y - 0.1, d.position.z);
    }, j.id);
    await host.evaluate(() => window.__dt.simWait(0.15, 30000));
    await host.evaluate((aId) => { const G = window.__game; const d = G.mode.streaks.droneOf(G.net.actorById(aId)); if (d) G.debugApi.lookAt(d.position.x, d.position.y - 0.1, d.position.z); }, j.id);
    await host.evaluate(() => window.__dt.simWait(0.1, 30000));
    await host.screenshot({ path: `${OUT}/drone-online-host.png`, timeout: 180000 });
    info(`Bild: ${OUT}/drone-online-host.png`);
    // --- zum Bot fliegen (Blick auf die Brust, langsam), nah dran sprengen
    const k0 = await host.evaluate((aId) => window.__game.net.actorById(aId).stats.kills, j.id);
    const fly = await cl.evaluate(async (botId) => {
      const G = window.__game;
      const T = G.THREE;
      const d = window.__dt.pilot();
      const bot = G.net.actorById(botId);
      if (!d || !bot) return { err: 'fehlt' };
      const t0 = performance.now();
      let dist = 99;
      let f = -1;
      while (performance.now() - t0 < 120000 && d.alive) {
        if (G.time.frame === f) { await new Promise((r) => setTimeout(r, 15)); continue; }
        f = G.time.frame; // je Bild einmal nachsteuern
        const c = bot.position.clone(); c.y += 1.1;
        const v = c.clone().sub(d.position);
        dist = v.length();
        if (dist < 1.6) break;
        d.yaw = Math.atan2(-v.x, -v.z);
        d.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
        G.input.simulate.move(0, dist > 4 ? 0.5 : 0.25);
      }
      G.input.simulate.move(0, 0);
      await window.__dt.simWait(0.1, 20000);
      G.input.simulate.tap('fire');
      await window.__dt.simWait(0.1, 20000);
      return { dist, alive: d.alive, ended: d.ended };
    }, tgt.netId);
    info(`Client: Abstand zum Ziel ${fly.dist != null ? fly.dist.toFixed(2) : '-'} m, Drohne ${fly.ended || (fly.alive ? 'fliegt' : '?')}`);
    const hk = await until(host, ({ aId, botId }) => {
      const G = window.__game;
      const k = window.__dt.kills.find((x) => x.weapon === 'drohne');
      return k && { ...k, victimRef: undefined, botDead: !G.net.actorById(botId).alive, kills: G.net.actorById(aId).stats.kills, check: G.net.sync.lastDroneCheck };
    }, { aId: j.id, botId: tgt.netId }, 30000, 200);
    check(!!hk && hk.botDead && hk.killer === 'Anna' && hk.weapon === 'drohne', `Host: Bot tot, Abschuss für ${hk && hk.killer} mit Ursache „${hk && hk.weapon}“ (Prüfung ${hk && hk.check ? (hk.check.ok ? 'gültig' : hk.check.reason) : '-'})`);
    check(!!hk && hk.kills === k0 + 1, `Host: Annas Abschüsse ${k0} → ${hk && hk.kills}`);
    const ck = await until(cl, () => { const k = window.__dt.kills.find((x) => x.weapon === 'drohne'); return k && { mine: k.mine, ex: window.__dt.explosions.some((e) => e.w === 'drohne' && e.net), pilot: !!window.__dt.pilot() }; }, null, 30000, 200);
    check(!!ck && ck.mine && ck.ex && !ck.pilot, `Client: Abschuss als eigener gemeldet, Explosion vom Host dargestellt, Kamera zurück`);
    // --- unplausible Sprengung (Teleport 80 m)
    // neue Serie (wie nach Tod + 5 Abschüssen): „verdient“ zurücksetzen, dann 5 Abschüsse
    await host.evaluate((aId) => { const G = window.__game; const st = G.mode.streaks; const a = G.net.actorById(aId); st._st(a).earned.delete('drohne'); st.onKill(a, 5); }, j.id);
    const rdy2 = await until(cl, () => window.__game.mode.streaks.isReady(window.__game.player, 'drohne'), null, 20000, 200);
    check(!!rdy2, 'Client: Serie erneut bereit');
    await sleep(800);
    await cl.evaluate(() => window.__game.input.simulate.tap('streak4'));
    const c2 = await until(cl, () => window.__dt.pilot() && window.__dt.state(), null, 30000, 100);
    if (!check(!!c2, 'Client: zweite Drohne fliegt')) return;
    await cl.evaluate(() => window.__dt.simWait(0.3, 30000));
    // Weg durch eine Wand (erfundene Lage hinter der nächsten Wand, direkt beim Host geprüft): Lage bleibt davor stehen
    const wall = await host.evaluate(async (aId) => {
      const G = window.__game;
      const T = G.THREE;
      const d = G.mode.streaks.droneOf(G.net.actorById(aId));
      if (!d || d.role !== 'remote') return { err: 'keine Client-Drohne beim Host' };
      const { collisionRay } = await import(new URL('assets/js/game/engine/physics.js', location.href).href);
      const a = d.check.pos.clone();
      for (let i = 0; i < 32; i++) {
        const yaw = (i * Math.PI) / 16;
        for (const pitch of [0, -0.6]) {
          const dir = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
          const h = collisionRay(G.world, a, dir, 12, {});
          if (!h || h.distance < 0.5) continue;
          for (let k = 0.6; k <= 4; k += 0.2) {
            const b = a.clone().addScaledVector(dir, h.distance + k);
            const back = collisionRay(G.world, b, dir.clone().negate(), h.distance + k, {});
            if (!back || h.distance + k - back.distance - h.distance < 0.3 || back.distance < 0.4) continue;
            const r = G.mode.streaks.netPose(d.owner, { d: d.netId, p: b.toArray(), y: 0, pi: 0 });
            return { r, wallAt: +h.distance.toFixed(2), behind: +(h.distance + k).toFixed(2), now: +d.check.pos.distanceTo(a).toFixed(2), pitch };
          }
        }
      }
      return { err: 'keine Wand in Reichweite' };
    }, j.id);
    if (wall.err) info(`Wand-Prüfung entfällt: ${wall.err}`);
    else check(wall.r && !wall.r.ok && wall.r.reason === 'wand' && wall.now < wall.wallAt, `Host: Lage hinter der Wand (${wall.behind} m, Wand bei ${wall.wallAt} m) verworfen (${wall.r && wall.r.reason}), Drohne bleibt davor (${wall.now} m)`);
    const ex0 = await host.evaluate(() => window.__dt.explosions.length);
    const ac0 = await host.evaluate(() => (window.__game.net.anticheat ? window.__game.net.anticheat.log.length : 0));
    await cl.evaluate(() => {
      const G = window.__game;
      const d = window.__dt.pilot();
      const p = d.position;
      G.net.sync.sendDrone({ a: 'x', d: d.netId, p: [p.x + 80, p.y, p.z + 10] }); // Sprengung weit weg (erfunden)
      d.end('boom', null, null, { quiet: true, pending: true }); // wie Drone.detonate: beim Client sofort zu Ende
    });
    const rej = await until(host, () => { const c = window.__game.net.sync.lastDroneCheck; return c && !c.ok && c; }, null, 20000, 100);
    await sleep(1500);
    const hx = await host.evaluate((n) => ({ ex: window.__dt.explosions.slice(n).filter((e) => e.w === 'drohne').length, ac: window.__game.net.anticheat ? window.__game.net.anticheat.log.slice(-3).map((e) => e.reason) : [] }), ex0);
    check(!!rej && rej.reason === 'weg' && hx.ex === 0, `Host lehnt die Teleport-Sprengung ab (${rej && rej.reason}), keine Explosion (${hx.ex})`);
    check(hx.ac.includes('drohne'), `Anti-Cheat-Protokoll: ${hx.ac.join(', ')} (vorher ${ac0} Einträge)`);
    const cEnd = await until(cl, () => { const e = window.__dt.ends.slice(-1)[0]; return !window.__dt.pilot() && e && e.why === 'abgelehnt' && { ...e, notice: [...document.querySelectorAll('.h-notice')].some((n) => /Sprengung vom Host abgelehnt/.test(n.textContent)) }; }, null, 20000, 100);
    check(!!cEnd && cEnd.why === 'abgelehnt' && cEnd.notice, `Client: nach lokaler Sprengung Rückmeldung „abgelehnt“ (${cEnd && cEnd.why}, Hinweis ${cEnd && cEnd.notice})`);
    // --- Drohne des Host-Spielers erscheint beim Client als Abbild
    await host.evaluate(() => { const G = window.__game; G.debugApi.giveStreak('drohne'); G.input.allowUnlockedMouse = true; G.input.simulate.tap('streak4'); });
    const hd = await until(host, () => window.__dt.pilot() && window.__dt.pilot().netId, null, 30000, 100);
    const rep = await until(cl, (id) => { const d = window.__game.mode.streaks.entities.find((e) => e.kind === 'drohne' && e.netId === id && e.alive); return d && { role: d.role, owner: d.owner.name }; }, hd, 30000, 200);
    check(!!rep && rep.role === 'replica' && rep.owner === 'Hosti', `Client sieht die Drohne des Hosts (${rep && rep.role}, Besitzer ${rep && rep.owner})`);
    // Client schießt die Drohne des Hosts ab: Host stellt sie 5 m vor Annas Kopf (freie Sicht)
    const place = await host.evaluate((aId) => {
      const G = window.__game;
      const T = G.THREE;
      const a = G.net.actorById(aId);
      const d = window.__dt.pilot();
      if (!a || !d) return null;
      const hostile = G.combat.isHostile(a, G.player);
      const eye = a.getEyePosition(new T.Vector3());
      for (let i = 0; i < 16; i++) {
        const yaw = (a.yaw || 0) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
        const to = eye.clone().add(new T.Vector3(-Math.sin(yaw) * 5, 0.6, -Math.cos(yaw) * 5));
        if (!G.world.lineOfSight(eye, to)) continue;
        d.position.copy(to); d.launch.copy(to); d.velocity.set(0, 0, 0); d.battery = 120;
        return { hostile, pos: to.toArray() };
      }
      return { hostile, pos: null };
    }, j.id);
    if (place && place.hostile && place.pos) {
      // Vergleich mit der aktuellen Lage beim Host (die Drohne darf sich dort noch etwas bewegen, z. B. keepClear an einer Kante)
      let gap = null;
      const near = await until(cl, ({ id, pos }) => { const d = window.__game.mode.streaks.entities.find((e) => e.kind === 'drohne' && e.netId === id && e.alive); return d && d.position.distanceTo(new window.__game.THREE.Vector3().fromArray(pos)) < 0.8; }, { id: hd, pos: place.pos }, 30000, 200)
        || await (async () => {
          const hp = await host.evaluate(() => { const d = window.__dt.pilot(); return d ? d.position.toArray() : null; });
          const cp = await cl.evaluate((id) => { const d = window.__game.mode.streaks.entities.find((e) => e.kind === 'drohne' && e.netId === id && e.alive); return d ? d.position.toArray() : null; }, hd);
          gap = { host: hp && Math.hypot(hp[0] - place.pos[0], hp[1] - place.pos[1], hp[2] - place.pos[2]), client: hp && cp && Math.hypot(hp[0] - cp[0], hp[1] - cp[1], hp[2] - cp[2]) };
          return hp && cp && gap.client < 0.8;
        })();
      check(!!near, `Client: Abbild der Host-Drohne an der neuen Stelle${gap ? ` (Host-Drohne ${f1(gap.host)} m von der Stelle, Abbild ${f1(gap.client)} m von der Host-Drohne)` : ''}`);
      const shot = await cl.evaluate(async (id) => {
        const G = window.__game;
        const T = G.THREE;
        const d = G.mode.streaks.entities.find((e) => e.kind === 'drohne' && e.netId === id && e.alive);
        const def = G.player.weapon.currentDef;
        let n = 0;
        const r0 = performance.now();
        while (n < 20 && d.alive && performance.now() - r0 < 120000) {
          const eye = G.player.getEyePosition(new T.Vector3());
          const dir = d.position.clone().sub(eye).normalize();
          G.player._shotSerial = (G.player._shotSerial || 0) + 1;
          G.combat.fireHitscan({ shooter: G.player, origin: eye, dir, range: def.range || 100, weapon: def });
          n++;
          await new Promise((r) => setTimeout(r, 400));
        }
        return { n, alive: d.alive, ended: d.ended, weapon: def.id };
      }, hd);
      const hEnd = await until(host, () => { const e = window.__dt.ends.find((x) => x.own && x.why === 'abschuss'); return e; }, null, 30000, 200);
      check(!!hEnd && hEnd.by === 'Anna', `Host: eigene Drohne von ${hEnd && hEnd.by} abgeschossen (Client-Meldungen, ${shot.n} Schüsse ${shot.weapon})`);
      const cDone = await until(cl, (id) => !window.__game.mode.streaks.entities.some((e) => e.kind === 'drohne' && e.netId === id && e.alive) && { scores: window.__dt.scores.slice(), destroyed: window.__dt.destroyed.slice(-1)[0] || null }, hd, 30000, 200);
      check(!!cDone && cDone.scores.includes('drone') && cDone.destroyed && cDone.destroyed.by === 'Anna', `Client: Abbild weg, Punkte „Drohne abgeschossen“ (${cDone && cDone.scores.join(',')})`);
      // Messerhieb eines Clients auf eine Drohne (1,4 m vor dem Kopf): Host nimmt ihn an (kein Verstoß); 5 m entfernt → abgelehnt
      await host.evaluate(() => { const G = window.__game; G.debugApi.giveStreak('drohne'); G.input.simulate.tap('streak4'); });
      const hd2 = await until(host, (old) => window.__dt.pilot() && window.__dt.pilot().netId !== old && window.__dt.pilot().netId, hd, 30000, 100);
      const knife = hd2 && await host.evaluate(async (aId) => {
        const G = window.__game;
        const T = G.THREE;
        const a = G.net.actorById(aId);
        const st = G.mode.streaks;
        const d = window.__dt.pilot();
        const ac = G.net.anticheat;
        const n0 = ac ? ac.log.length : 0;
        const eye = a.getEyePosition(new T.Vector3());
        const put = (dist) => {
          for (let i = 0; i < 16; i++) {
            const yaw = (a.yaw || 0) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
            const to = eye.clone().add(new T.Vector3(-Math.sin(yaw) * dist, 0, -Math.cos(yaw) * dist));
            if (!G.world.lineOfSight(eye, to)) continue;
            d.position.copy(to); d.velocity.set(0, 0, 0); d.check.hist.length = 0;
            return true;
          }
          return false;
        };
        const weapons = G.net.sync._weaponsOf(a, aId);
        if (!put(5)) return { err: 'kein Platz' };
        const far = st.netHit(a, { d: d.netId, w: 'knife', dmg: 135, s: 90001 }, weapons);
        await new Promise((r) => setTimeout(r, 900)); // Feuerrate
        if (!put(1.4)) return { err: 'kein Platz' };
        const near = st.netHit(a, { d: d.netId, w: 'knife', dmg: 135, s: 90002 }, weapons);
        return { far, near, alive: d.alive, strikes: ac ? ac.log.slice(n0).map((e) => e.reason) : [] };
      }, j.id);
      check(!!knife && !knife.err && !knife.far.ok && knife.near.ok && knife.near.dmg > 0 && !knife.alive && !knife.strikes.includes('ausruestung'),
        `Host: Messerhieb auf eine Drohne 1,4 m → ${knife && knife.near && (knife.near.ok ? `${knife.near.dmg} Schaden` : knife.near.reason)}, 5 m → ${knife && knife.far && knife.far.reason}; Verstöße: ${knife && knife.strikes ? knife.strikes.join(',') || 'keine' : '?'}`);
    } else {
      info(`Host und Client im selben Team (${place && place.hostile}) – Abschuss-Prüfung entfällt, Abbruch statt dessen`);
      await host.evaluate(() => window.__game.input.simulate.tap('interact'));
      const gone = await until(cl, (id) => !window.__game.mode.streaks.entities.some((e) => e.kind === 'drohne' && e.netId === id && e.alive), hd, 30000, 200);
      check(!!gone, 'Abbruch des Hosts: Abbild beim Client verschwindet');
    }
    const e = Object.entries(errs).filter(([, l]) => l.length);
    check(!e.length, `keine Seiten-/Konsolenfehler${e.length ? `: ${e.map(([n, l]) => `${n}: ${l.slice(0, 2).join(' | ')}`).join('; ')}` : ''}`);
  } finally {
    for (const c of pages) await c.close().catch(() => {});
  }
}

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
try {
  if (ONLY.includes('offline')) await offline(browser);
  if (ONLY.includes('handy')) await handy(browser);
  if (ONLY.includes('vr')) await vr(browser);
  if (ONLY.includes('online')) await online(browser);
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
