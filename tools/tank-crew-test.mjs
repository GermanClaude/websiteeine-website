// NULLPUNKT – Abnahme Besatzung, Sichten, manuelles Nachladen (docs/planung/panzer-mp.md §B.10) im Browser:
// dev/vehicles.html?type=mbt&quality=low. Die Logik wird über window.__dev synchron getaktet (unabhängig von der
// Bildrate unter SwiftShader); danach Bilder je Sicht für PC (1280×720) und Handy (844×390, Touch-Modus) nach
// tools/out/panzer/ (wird nicht eingecheckt).
// Aufruf: node tools/tank-crew-test.mjs [--no-shots]   (Exit-Code ≠ 0 bei Fehlern)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const SHOTS = !process.argv.includes('--no-shots');
const OUT = new URL('./out/panzer/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForLoad() {
  for (let i = 0; i < 10; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 6)) return;
    console.log(`     Last ${l1} > 6 – warte 60 s`);
    await sleep(60000);
  }
}

let fail = 0, count = 0;
const check = (ok, text, val = '') => {
  count++;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${text}${val !== '' ? ` → ${val}` : ''}`);
};

await waitForLoad();
const errors = [];
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|Failed to load resource.*(404|net::ERR_ABORTED)/.test(t)) return;
  errors.push(t);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

try {
  await page.goto(BASE + 'dev/vehicles.html?type=mbt&quality=low&lite=1&cam=tp', { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__dev && window.__dev.main && window.__dev.sys.attached, null, { timeout: 180000 });

  // Hilfen im Seitenkontext: synchroner Takt, Schusszähler, Sitzwechsel abwarten
  await page.evaluate(() => {
    const D = window.__dev, G = D.G, sys = D.sys;
    const shots = [];
    G.events.on('vehicle:fire', (e) => shots.push({ t: G.time.elapsed, v: e.vehicle.id, seat: e.seat, w: e.weaponId, actor: e.actor ? e.actor.id : null }));
    const step = (sec, dt = 1 / 60, until = null) => {
      const n = Math.round(sec / dt);
      for (let i = 0; i < n; i++) {
        G.time.elapsed += dt; G.time.frame++;
        D.input.update(dt);
        if (D.player.vehicle) sys.updateOccupant(D.player, dt); else D.player.update(dt);
        sys.update(dt);
        D.input.endFrame();
        if (until && until()) return i * dt;
      }
      return sec;
    };
    const seat = () => D.player.vehicleSeat;
    const toSeat = (i) => { sys.requestSeat(D.player, i); step(1.3); return D.player.vehicle.seatOf(D.player); };
    window.__crew = { shots, step, seat, toSeat };
  });

  // 1) Sitze, Fahrer ohne Waffe
  let r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, v = D.main, p = D.player;
    C.step(0.3);
    const out = { ids: v.seats.map((s) => s.def.id), seat: v.seatOf(p), driverWeapons: v.seats[0].weapons.length };
    const n0 = C.shots.length;
    D.input.simulate.tap('fire'); C.step(0.1);
    out.driverShots = C.shots.length - n0;
    out.gunLoaded = v.gun && v.gun.step;
    return out;
  });
  check(r.ids.join(',') === 'driver,gunner,commander,loader', 'Sitze KP-1 in fester Reihenfolge', r.ids.join(','));
  check(r.seat === 0, 'Einsteigen: Fahrersitz', r.seat);
  check(r.driverWeapons === 0 && r.driverShots === 0, 'Fahrer hat keine Waffe und kann nicht feuern', `${r.driverWeapons}/${r.driverShots}`);
  check(r.gunLoaded === 'geladen', 'Startzustand: Kanone geladen', r.gunLoaded);

  // 2) Sitzwechsel 1,2 s, Sitz inaktiv
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, G = D.G, sys = D.sys, v = D.main, p = D.player;
    const t0 = G.time.elapsed;
    sys.requestSeat(p, 1);
    const out = { seat: v.seatOf(p), ready: +(v.seats[1].readyAt - t0).toFixed(3) };
    const n0 = C.shots.length;
    D.input.simulate.tap('fire'); C.step(0.2);
    out.inactiveShots = C.shots.length - n0;
    out.canFireEarly = v.canFire(1);
    const waited = C.step(3, 1 / 60, () => v.canFire(1));
    out.until = +(G.time.elapsed - t0).toFixed(3);
    out.canFire = v.canFire(1);
    void waited;
    return out;
  });
  check(r.seat === 1, 'Sitzwechsel bucht sofort um (Richtschütze)', r.seat);
  check(Math.abs(r.ready - 1.2) <= 0.1, 'Sitzwechsel-Sperre 1,2 s', `${r.ready} s`);
  check(r.inactiveShots === 0 && !r.canFireEarly, 'Sitz während des Wechsels inaktiv (kein Schuss)', r.inactiveShots);
  check(r.canFire && Math.abs(r.until - 1.2) <= 0.1, 'Richtschütze nach 1,2 ±0,1 s bereit', `${r.until} s`);

  // 3) Richtschütze feuert die Kanone, danach leer; zweiter Schuss ohne Laden unmöglich
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, v = D.main;
    const n0 = C.shots.length;
    D.input.simulate.tap('fire'); C.step(0.1);
    const s1 = C.shots.slice(n0);
    const out = { shots: s1.length, w: s1[0] && s1[0].w, step: v.gun.step, loaded: v.gun.loaded, breech: v.gun.breechOpen };
    C.step(0.5);
    const n1 = C.shots.length;
    D.input.simulate.tap('fire'); C.step(0.1);
    out.again = C.shots.length - n1;
    return out;
  });
  check(r.shots === 1 && r.w === 'mbt_ap', 'Richtschütze feuert die Kanone (PG)', `${r.shots} × ${r.w}`);
  check(r.step === 'leer' && r.loaded === null && r.breech === true, 'Nach dem Schuss: leer, Keil offen', `${r.step}/${r.loaded}/${r.breech}`);
  check(r.again === 0, 'Ohne Laden kein zweiter Schuss', r.again);

  // 4) Kommandant feuert das MG
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, v = D.main;
    const seat = C.toSeat(2);
    const n0 = C.shots.length;
    D.input.simulate.press('fire'); C.step(0.6); D.input.simulate.release('fire'); C.step(0.05);
    const s = C.shots.slice(n0);
    return { seat, n: s.length, w: s[0] && s[0].w };
  });
  check(r.seat === 2 && r.n >= 3 && r.w === 'mbt_cmg', 'Kommandant feuert das MG', `${r.n} × ${r.w}`);

  // 5) Sichten aller Sitze schaltbar; Außenansicht abschaltbar; C schaltet durch
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, G = D.G, sys = D.sys, v = D.main, p = D.player;
    const res = {};
    for (const i of [0, 1, 2, 3]) {
      C.toSeat(i);
      const seat = C.seat();
      const ids = [];
      for (const vi of sys.allowedViews(seat)) { sys.setSeatView(p, vi); C.step(0.05); ids.push(sys.camera.view && sys.camera.view.id); }
      // Taste C (crouch) schaltet weiter
      const before = seat.view;
      D.input.simulate.tap('crouch'); C.step(0.05);
      res[seat.def.id] = { ids, cycled: seat.view !== before };
    }
    G.match.net = { thirdPerson: false };
    const seat = C.seat();
    const allowed = sys.allowedViews(seat).map((i) => seat.def.views[i].id);
    let sawTp = false;
    for (let k = 0; k < 6; k++) { D.input.simulate.tap('crouch'); C.step(0.05); if (sys.camera.view && sys.camera.view.tp) sawTp = true; }
    delete G.match.net;
    return { res, allowed, sawTp };
  });
  const want = { driver: 'spiegel,luke,aussen', gunner: 'optik,weit,aussen', commander: 'periskop,luke,aussen', loader: 'innen,luke,aussen' };
  for (const [k, ids] of Object.entries(want)) check(r.res[k] && r.res[k].ids.join(',') === ids && r.res[k].cycled, `Sichten ${k} schaltbar (Taste C)`, r.res[k] && r.res[k].ids.join(','));
  check(!r.allowed.includes('aussen') && !r.sawTp, 'thirdPerson: false → keine Außenansicht', r.allowed.join(','));

  // 6) Luke offen → verwundbar, zu → NULL_HITBOX
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, sys = D.sys, p = D.player;
    C.toSeat(2);
    const proto = Object.getPrototypeOf(p).raycastHitboxes;
    sys.setSeatView(p, 0); C.step(0.8);
    const closed = { inv: p.invulnerable, hb: p.raycastHitboxes !== proto && p.raycastHitboxes() === null, hatch: C.seat().hatchT };
    sys.setSeatView(p, 1); C.step(0.2);
    const mid = { inv: p.invulnerable };
    C.step(0.6);
    const open = { inv: !!p.invulnerable, hb: p.raycastHitboxes === proto, hatch: C.seat().hatchT, h: p.body.height };
    sys.setSeatView(p, 0); C.step(0.8);
    return { closed, mid, open, closed2: { inv: p.invulnerable, hb: p.raycastHitboxes !== proto } };
  });
  check(r.closed.inv === true && r.closed.hb && r.closed.hatch === 0, 'Luke zu: unverwundbar, NULL_HITBOX', JSON.stringify(r.closed));
  check(r.mid.inv === true, 'Luke öffnet: Schutz erst ab hatchT ≥ 0,5', JSON.stringify(r.mid));
  check(r.open.inv === false && r.open.hb && r.open.hatch === 1, 'Luke offen: Trefferzonen aktiv, verwundbar', JSON.stringify(r.open));
  check(r.closed2.inv === true && r.closed2.hb, 'Luke wieder zu: geschützt', JSON.stringify(r.closed2));

  // 7) Manuelles Nachladen (Ladeschütze, Sicht innen)
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, G = D.G, sys = D.sys, v = D.main, p = D.player;
    const out = {};
    C.toSeat(3);
    const seat = C.seat();
    sys.setSeatView(p, 0); C.step(0.05);
    const g = v.gun;
    out.start = g.step;
    const I = v.def.interior, eye = I.loaderEye;
    const yawTo = (pt) => Math.atan2(-(pt[0] - eye[0]), -(pt[2] - eye[2]));
    out.wrong = sys.requestLoad(p, v, 'einschieben');
    seat.look.relYaw = yawTo(I.breech);
    out.blick = sys.requestLoad(p, v, 'greifen');
    const rack0 = g.rack.mbt_ap;
    seat.look.relYaw = yawTo(I.rack);
    const t0 = G.time.elapsed;
    let act = 0;
    out.grab = sys.requestLoad(p, v, 'greifen');
    act += g.busy;
    out.busy = sys.requestLoad(p, v, 'einschieben');
    C.step(1.05);
    out.held = { step: g.step, held: g.held, rack: g.rack.mbt_ap, rack0 };
    out.blick2 = sys.requestLoad(p, v, 'einschieben');
    seat.look.relYaw = yawTo(I.breech);
    out.push = sys.requestLoad(p, v, 'einschieben');
    act += g.busy;
    C.step(0.85);
    out.pushed = { step: g.step, loaded: g.loaded };
    out.close = sys.requestLoad(p, v, 'schliessen');
    act += g.busy;
    C.step(0.45);
    out.done = { step: g.step, loaded: g.loaded, breech: g.breechOpen, t: +(G.time.elapsed - t0).toFixed(2), act: +act.toFixed(2) };
    // zweite Runde über die Tastatur: R (greifen) … LMT (einschieben) … R (schließen) – erst Schuss
    C.toSeat(1);
    D.input.simulate.tap('fire'); C.step(0.1);
    out.shot2 = g.step;
    C.toSeat(3);
    seat.look.relYaw = 0;
    const s3 = C.seat();
    s3.look.relYaw = yawTo(I.rack);
    D.input.simulate.tap('reload'); C.step(1.1);
    out.keyGrab = g.step;
    s3.look.relYaw = yawTo(I.breech);
    D.input.simulate.tap('fire'); C.step(0.9);
    out.keyPush = g.step;
    D.input.simulate.tap('reload'); C.step(0.5);
    out.keyClose = g.step;
    out.rackNow = { ...g.rack };
    return out;
  });
  check(r.start === 'leer', 'Ladeschütze: Kanone leer nach dem Schuss', r.start);
  check(r.wrong && r.wrong.ok === false && r.wrong.why === 'schritt', 'Falsche Reihenfolge abgelehnt', JSON.stringify(r.wrong));
  check(r.blick && r.blick.ok === false && r.blick.why === 'blick', 'Greifen ohne Blick aufs Gestell abgelehnt', JSON.stringify(r.blick));
  check(r.grab && r.grab.ok && r.busy && r.busy.why === 'busy', 'Greifen läuft (1,0 s), währenddessen gesperrt', JSON.stringify(r.busy));
  check(r.held.step === 'gegriffen' && r.held.held === 'mbt_ap' && r.held.rack === r.held.rack0 - 1, 'Granate in der Hand, Gestell zählt runter', JSON.stringify(r.held));
  check(r.blick2 && r.blick2.why === 'blick', 'Einschieben ohne Blick zum Verschluss abgelehnt', JSON.stringify(r.blick2));
  check(r.push && r.push.ok && r.pushed.step === 'eingeschoben', 'Einschieben (0,8 s)', JSON.stringify(r.pushed));
  check(r.close && r.close.ok && r.done.step === 'geladen' && r.done.loaded === 'mbt_ap' && !r.done.breech, 'Verschluss zu → geladen', JSON.stringify(r.done));
  check(r.done.act >= 2.2 - 1e-6, 'Handlungszeit ≥ 2,2 s', `${r.done.act} s (gesamt ${r.done.t} s)`);
  check(r.shot2 === 'leer' && r.keyGrab === 'gegriffen' && r.keyPush === 'eingeschoben' && r.keyClose === 'geladen', 'Tastenfolge R → LMT → R lädt', `${r.keyGrab}/${r.keyPush}/${r.keyClose}`);

  // 8) Munitionswunsch SG, Gestell, Automatik 8 s / 5 s, Auffüllen, Störung
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, G = D.G, sys = D.sys, v = D.main, p = D.player;
    const out = {};
    const g = v.gun;
    C.toSeat(1);
    // Waffenwahl SG = Munitionswunsch
    const seat = C.seat();
    seat.intent.weapon = 1; C.step(0.05);
    out.wishSel = seat.weapons[seat.weaponIndex].def.id;
    // Automatik per Regel, ohne Ladeschütze: 8 s
    G.match.net = { vehReload: 'automatisch' };
    const n0 = C.shots.length;
    D.input.simulate.tap('fire'); C.step(0.05);
    out.fired = C.shots.slice(n0).map((s) => s.w);
    const t0 = C.shots[C.shots.length - 1].t;
    out.autoMax = g.autoMax;
    C.step(10, 1 / 60, () => g.step === 'geladen');
    out.t8 = +(G.time.elapsed - t0).toFixed(2);
    out.loadedHe = g.loaded;
    // Bot im Ladeschützensitz: 5 s
    const bot = { id: 'lader', name: 'Lader', team: 'A', isBot: true, alive: true, health: 100, maxHealth: 100, yaw: 0, pitch: 0, stats: {}, body: new D.player.body.constructor({ radius: 0.35, height: 1.8 }) };
    Object.defineProperty(bot, 'position', { get: () => bot.body.position });
    G.actors.push(bot);
    out.botSeat = sys.enter(bot, v, 3);
    const n1 = C.shots.length;
    D.input.simulate.tap('fire'); C.step(0.05);
    out.fired2 = C.shots.length - n1;
    const t1 = C.shots[C.shots.length - 1].t;
    out.autoMax2 = g.autoMax;
    C.step(10, 1 / 60, () => g.step === 'geladen');
    out.t5 = +(G.time.elapsed - t1).toFixed(2);
    sys.removeFromSeat(bot, { teleport: false });
    G.actors.splice(G.actors.indexOf(bot), 1);
    delete G.match.net;
    // Auffüllen am eigenen Stellplatz (Ersatz-Eintrag ohne Fahrzeug)
    const r0 = { ...g.rack };
    sys.spawns.push({ type: 'mbt', position: v.position.clone(), yaw: 0, team: 'A', respawn: 90, vehicle: null, respawnAt: null, _test: true });
    C.step(4.2);
    out.refill = { before: r0, after: { ...g.rack }, flag: g.refilling };
    sys.spawns.splice(sys.spawns.findIndex((s) => s._test), 1);
    // Störung: Treffer ≥ 60 während „gegriffen“ → Granate fällt
    G.match.net = { vehReload: 'manuell' };
    C.toSeat(1);
    D.input.simulate.tap('fire'); C.step(0.05);
    C.toSeat(3);
    const ls = C.seat(), I = v.def.interior, eye = I.loaderEye;
    ls.look.relYaw = Math.atan2(-(I.rack[0] - eye[0]), -(I.rack[2] - eye[2]));
    sys.requestLoad(p, v, 'munition', 'mbt_ap');
    sys.requestLoad(p, v, 'greifen'); C.step(1.1);
    const rk = g.rack.mbt_ap;
    out.beforeDrop = g.step;
    v.applyDamage(70, { kind: 'shell', zone: 'hull' });
    out.drop = { step: g.step, held: g.held, rack: g.rack.mbt_ap - rk };
    v.repair(1000);
    delete G.match.net;
    return out;
  });
  check(r.wishSel === 'mbt_he', 'Richtschütze wählt SG (Munitionswunsch)', r.wishSel);
  check(r.fired.length === 1 && r.fired[0] === 'mbt_ap', 'Gefeuert wird die geladene Granate (PG), nicht die gewählte', r.fired.join(','));
  check(Math.abs(r.autoMax - 8) < 1e-6 && Math.abs(r.t8 - 8) <= 0.1, 'Automatik ohne Ladeschütze 8,0 s', `${r.t8} s`);
  check(r.loadedHe === 'mbt_he', 'Automatik lädt den Wunsch (SG)', r.loadedHe);
  check(r.botSeat === 3 && r.fired2 === 1 && Math.abs(r.autoMax2 - 5) < 1e-6 && Math.abs(r.t5 - 5) <= 0.1, 'Automatik mit Ladeschütze 5,0 s', `${r.t5} s`);
  check(r.refill.flag && r.refill.after.mbt_ap + r.refill.after.mbt_he - r.refill.before.mbt_ap - r.refill.before.mbt_he === 2, 'Auffüllen am Stellplatz (+1 je 2 s)', JSON.stringify(r.refill));
  check(r.beforeDrop === 'gegriffen' && r.drop.step === 'leer' && r.drop.held === null && r.drop.rack === 1, 'Treffer ≥ 60: Granate fällt zurück ins Gestell', JSON.stringify(r.drop));

  // 9) Pad: Aussteigen nur per Halten (0,5 s)
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, p = D.player;
    D.input.lastDevice = 'gamepad';
    D.input.simulate.press('interact'); C.step(0.3);
    const mid = !!p.vehicle;
    C.step(0.4); D.input.simulate.release('interact'); C.step(0.05);
    const after = !!p.vehicle;
    D.input.lastDevice = 'keyboard';
    return { mid, after };
  });
  check(r.mid === true && r.after === false, 'Pad: Aussteigen erst nach 0,5 s Halten', JSON.stringify(r));

  // 10) Bot-Einzelbesatzung: Autopilot + aimAt → Turm dreht, Bot feuert (Richtschützensitz stellvertretend)
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, G = D.G, v = D.main;
    const bot = D.autopilotLap(v);
    if (!bot) return { err: 'kein Bot' };
    const target = v.position.clone().add(new G.THREE.Vector3(60, 2, -60));
    const yaw0 = v.mount.turretYaw;
    const n0 = C.shots.length;
    let fired = null;
    v.aimAt(bot, target, true);
    C.step(14, 1 / 60, () => { v.aimAt(bot, target, true); const s = C.shots.slice(n0).find((x) => x.actor === 'bot' && (x.w === 'mbt_ap' || x.w === 'mbt_he')); if (s) fired = s; return !!fired; });
    const gs = v.seats[1];
    const out = { proxy: !!gs.proxy, yaw: +(v.mount.turretYaw - yaw0).toFixed(2), fired: fired && fired.w, moved: +v.body.speed.toFixed(2), gun: v.gun.step };
    v.leave(bot);
    G.actors.splice(G.actors.indexOf(bot), 1);
    return out;
  });
  check(!r.err && Math.abs(r.yaw) > 0.3, 'Bot-Fahrer dreht den Turm (stellvertretender Richtschütze)', `Δ ${r.yaw} rad, Stellvertreter ${r.proxy}`);
  check(!!r.fired, 'Bot feuert die Kanone (Automatik lädt)', `${r.fired} (Kanone ${r.gun})`);

  // 10b) Geländewagen: Sichten aus fp/tp, offene Sitze verwundbar, MG feuert
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, sys = D.sys, p = D.player, j = D.other;
    if (p.vehicle) sys.exit(p);
    const seat = sys.enter(p, j, 1);
    C.step(0.2);
    const s = C.seat();
    const ids = sys.allowedViews(s).map((i) => s.def.views[i].id).join(',');
    sys.setSeatView(p, 0); C.step(0.1);
    const exposed = !p.invulnerable && s.hatchT === 1;
    const n0 = C.shots.length;
    D.input.simulate.press('fire'); C.step(0.5); D.input.simulate.release('fire'); C.step(0.05);
    const shots = C.shots.slice(n0).filter((x) => x.w === 'jeep_mg').length;
    sys.exit(p); C.step(0.1);
    return { type: j.type, seat, ids, exposed, shots, out: !p.vehicle };
  });
  check(r.type === 'jeep' && r.seat === 1 && r.ids === 'mg,aussen', 'GW-4: Sichten MG/Außen', `${r.type} ${r.ids}`);
  check(r.exposed && r.shots >= 2 && r.out, 'GW-4: offener Sitz verwundbar, MG feuert, Aussteigen', JSON.stringify(r));

  // 11) VR-Rückfall: Sicht luke, Turm folgt player.yaw
  r = await page.evaluate(() => {
    const D = window.__dev, C = window.__crew, G = D.G, sys = D.sys, v = D.main, p = D.player;
    G.xr = { presenting: true };
    if (p.vehicle) sys.exit(p);
    sys.enter(p, v, 0); C.step(0.1);
    const drv = sys.camera.view && sys.camera.view.id;
    sys.requestSeat(p, 1); C.step(1.4);
    const gun = sys.camera.view && sys.camera.view.id;
    const want = v.yaw + 1.0;
    p.yaw = want; p.pitch = 0;
    for (let i = 0; i < 330; i++) { p.yaw = want; p.pitch = 0; C.step(1 / 60); } // bis 180° bei 40°/s
    const err = Math.abs(((v.yaw + v.mount.turretYaw - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    sys.requestSeat(p, 2); C.step(1.4);
    const cmd = sys.camera.view && sys.camera.view.id;
    delete G.xr;
    return { drv, gun, cmd, err: +err.toFixed(3) };
  });
  check(r.drv === 'luke' && r.cmd === 'luke', 'VR: Fahrer/Kommandant fest in „Luke offen“', `${r.drv}/${r.cmd}`);
  check(r.gun === 'optik' && r.err < 0.05, 'VR: Richtschütze, Turm folgt player.yaw', `${r.gun}, Fehler ${r.err} rad`);

  check(errors.length === 0, 'Keine Konsolenfehler (Logikteil)', errors.slice(0, 3).join(' | '));

  // 12) Bilder je Sicht: PC 1280×720 und Handy 844×390 (Touch-Modus)
  if (SHOTS) {
    mkdirSync(OUT, { recursive: true });
    await waitForLoad();
    const frames = (n) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
    await page.evaluate(() => {
      const D = window.__dev, sys = D.sys, p = D.player;
      if (p.vehicle) sys.exit(p);
      D.addEnemy();
      D.addDummies?.();
      sys.enter(p, D.main, 0);
      window.__crew.step(0.2);
    });
    const views = { 0: ['spiegel', 'luke', 'aussen'], 1: ['optik', 'weit', 'aussen'], 2: ['periskop', 'luke', 'aussen'], 3: ['innen', 'luke', 'aussen'] };
    for (const [w, h, tag, touch] of [[1280, 720, 'pc', false], [844, 390, 'handy', true]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((t) => { if (t) document.body.dataset.inputMode = 'touch'; else delete document.body.dataset.inputMode; dispatchEvent(new Event('resize')); }, touch);
      for (const [si, ids] of Object.entries(views)) {
        for (let vi = 0; vi < ids.length; vi++) {
          await page.evaluate(([s, i]) => {
            const D = window.__dev, C = window.__crew, sys = D.sys, p = D.player, v = D.main;
            if (v.seatOf(p) !== +s) C.toSeat(+s);
            sys.setSeatView(p, i);
            const seat = C.seat();
            // Blick: Ladeschütze zum Gestell, sonst nach vorn zur Zielpuppe
            if (seat.def.loader) seat.look.relYaw = 2.6;
            else if (seat.def.mount) { seat.look.yaw = v.yaw + 0.08; seat.look.pitch = -0.02; } else seat.look.relYaw = 0;
            C.step(0.8);
          }, [si, vi]);
          await frames(2);
          const file = `${OUT}sicht-${tag}-${si}-${ids[vi]}.png`;
          await page.screenshot({ path: file });
          console.log(`     Bild ${file}`);
        }
      }
    }
    check(errors.length === 0, 'Keine Konsolenfehler (Bilder)', errors.slice(0, 3).join(' | '));
  }
} catch (err) {
  check(false, 'Testlauf', String(err && err.stack || err));
} finally {
  await browser.close();
}
console.log(`\n${count - fail}/${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
