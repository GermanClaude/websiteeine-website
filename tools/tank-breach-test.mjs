// NULLPUNKT – Panzer zerstören Gebäude (Nutzer 21.10.): Hauptgeschütz, MG und Rammen auf Grenzland (Dorf).
// Geprüft wird im Spiel (Einzelspiel, Fahrzeuge an, Bots aus; Granaten per ShellPool.fire, MG per combat.fireHitscan,
// Rammen wie ein Spieler: Spieler am Steuer, Taste W gedrückt, Spielschritte synchron – Prüfung 21.10.: mit gesetzter
// Geschwindigkeit fiel nicht auf, dass der Panzer hinter der Bresche an Möbeln hängen blieb):
//   1. Obergrenze der Wandausschnitte je Stufe (niedrig 8, hoch/ultra am Desktop 16).
//   2. PG stanzt ein schmales Loch (≤ 0,55 m größter Radius) und fliegt weiter (Durchschlag ≥ 1 Wand).
//   3. SG reißt eine große, unregelmäßige Bresche (≥ 0,7 m, kein Richtungsradius 0); ein zweiter Treffer daneben lässt
//      DIESELBE Bresche wachsen (gleiche Id, größere Fläche). Wand: Gasthaus-Südseite (z = 53,5, ohne Fenster).
//      SG gegen ein geschlossenes Fenster und eine geschlossene Tür: zündet am Flügel (nicht erst im Haus), der Flügel
//      zerbricht, die Fassade bekommt die Bresche.
//   4. Durchgang: Kugel-/Granatenstrahl (world.raycast) und Sichtlinie gehen durch die SG-Bresche; ein Spieler läuft
//      (Körperphysik, Sprung über die Bruchkante) durch die Rammbresche ins Haus.
//   5. MG: 7,62 mm (Koax) höhlt die Wand nach vielen Treffern aus, 12,7 mm (.50) schlägt nach wenigen durch.
//   6. Rammen: Geländewagen reißt nur an bzw. prallt ab (keine Bresche in Fahrzeugbreite), auch an Tür-/Fensterzarge
//      und Laden keine Scheinbresche; Kampfpanzer (Vollgas) bricht in Fahrzeugbreite durch, wird langsamer und fährt in
//      das Haus – auch in eingerichtete Häuser (Mühlweg, Gasthaus: Möbel geben nach); Tür und Fenster in der Bresche
//      zerbrechen, Läden schweben nicht in der Öffnung, Schutt bleibt am Fuß liegen; eine zweite, überlappende Rammung
//      schließt nichts wieder; ein streifender Panzer reißt nur an; Sandsäcke/Gelände bleiben fest; Zugmaschine gegen
//      eine Wand, die unten keine ist (Mauerfuß, Treppe dahinter): die Wand darüber bricht.
//   9. Kugeln: Panzerung hält 5,56 mm auf, Blech (Pkw, Jeep, Zugmaschine) wird durchschlagen.
//   7. Netz: Nachricht für Späteinsteiger (breachState) ohne Umschlag-Felder, erneut angewandt → identischer Umriss.
//   8. keine Seitenfehler. Bildschirmfotos vorher/nachher: tools/out/breach-*.png
// Aufruf: node tools/tank-breach-test.mjs [--quality=low] [--size=960x540] [--noshots]   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const QUALITY = String(opt.quality || 'low');
const [W, H] = String(opt.size || '960x540').split('x').map(Number);
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const info = (t) => console.log(`     ${t}`);
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
const killer = setTimeout(() => { console.log('FEHL Zeitlimit 40 min überschritten'); browser.close().finally(() => process.exit(1)); }, 40 * 60000);
try {
  const p = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR_|AudioContext/i.test(m.text())) errors.push(m.text()); });
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=grenzland&allies=0&enemies=0&vehicles=1&quality=${QUALITY}`, { waitUntil: 'load', timeout: 300000 });
  await p.waitForFunction(() => { const G = window.__game; return G && G.match && (G.match.state === 'playing' || G.match.state === 'countdown') && G.holes && G.vehicles && G.vehicles.list.some((v) => v.type === 'mbt'); }, null, { timeout: 900000, polling: 2000 });
  // Hilfen im Seitenkontext (Fahrzeugdaten, Schalter für Bildschirmfotos, feste Physikschritte)
  await p.evaluate(async () => {
    const G = window.__game, T = await import('three');
    const VD = await import('./assets/js/game/vehicles/data.js');
    const SH = await import('./assets/js/game/world/shading.js');
    const W = G.world, Hs = G.holes, S = G.vehicles;
    const V3 = (x, y, z) => new T.Vector3(x, y, z);
    const gy = (x, z) => (W.heightAt ? W.heightAt(x, z) : 0);
    G.player.godMode = true;
    // stehende Pkw im Weg (Dorfplatz) zur Seite
    for (const v of S.list) if (v.def.civil && v.body.pos.distanceTo(V3(8, 0.5, 79)) < 4) v.body.setPose(V3(-70, gy(-70, 0), 0), 0);
    const roll = (v, sec, keep = null, dt = 1 / 60) => {
      for (let i = 0, n = Math.round(sec / dt); i < n; i++) {
        G.time.elapsed += dt;
        const c = v.body.controls; c.handbrake = false; c.brake = 0; c.throttle = 0; c.steer = 0;
        if (keep) keep(v);
        v.body.update(dt, W); v.sync(dt); S.shells.update(dt); S.breaching.update(); Hs.update(dt);
      }
    };
    const fire = (type, ammo, o, tgt) => {
      const d = tgt.clone().sub(o).normalize(), s = S.shells.fire(VD.vehicleWeapon(type, ammo), o, d, null, null);
      for (let i = 0; i < 40 && S.shells.list.includes(s); i++) S.shells.update(1 / 120);
      return s;
    };
    const area = (h) => { let a = 0; for (const r of h.sprof) a += r * r; return a; };
    const look = (px, pz, tx, ty, tz) => {
      const P = G.player, y0 = gy(px, pz);
      P.body.position.set(px, y0 + 0.05, pz); P.body.velocity.set(0, 0, 0);
      const dx = tx - px, dz = tz - pz;
      P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(ty - (y0 + 1.6), Math.hypot(dx, dz));
    };
    const quiet = () => { try { if (G.viewmodel && G.viewmodel.scene) G.viewmodel.scene.visible = false; G.hud?.hide?.(); } catch { /* nur Bild */ } };
    // Fahren wie ein Spieler: Spieler am Steuer (Fahrersitz), Tasten über Playwright; Spielschritte synchron wie die
    // Hauptschleife (Sitz → Fahrzeuge → Löcher), ohne zu zeichnen
    const seat = (v, x, z, yaw) => {
      const P = G.player;
      if (P.vehicle) S.removeFromSeat(P, { teleport: false });
      v.body.setPose(V3(x, gy(x, z), z), yaw); v.body.vel.set(0, 0, 0); v.body.angVel.set(0, 0, 0); v.body.wake();
      if (v.health < v.def.health) v.health = v.def.health;
      S.enter(P, v, 0);
      return P.vehicle === v;
    };
    const drive = (sec, cb = null, dt = 1 / 30) => {
      const P = G.player;
      for (let i = 0, n = Math.round(sec / dt); i < n; i++) {
        G.time.elapsed += dt;
        S.updateOccupant(P, dt); S.update(dt); Hs.update(dt);
        if (cb && cb(i * dt) === false) break;
      }
    };
    const leave = () => { const P = G.player; if (P.vehicle) S.removeFromSeat(P, { teleport: false }); };
    window.__t = { G, T, VD, SH, W, Hs, S, V3, gy, roll, fire, area, look, quiet, seat, drive, leave };
  });
  const frames = (n = 3) => p.evaluate(async (k) => { const G = window.__game, f0 = G.time.frame, t0 = Date.now(); while (G.time.frame < f0 + k && Date.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 100)); }, n);
  const shot = async (name, cam, settle = 4) => {
    if (opt.noshots) return;
    await p.evaluate((c) => { window.__t.look(...c); window.__t.quiet(); }, cam);
    await frames(settle); // nach Treffern: Feuerball/Staub abklingen lassen
    await p.evaluate(() => window.__t.quiet());
    await frames(1);
    try { await p.screenshot({ path: `${OUT}/breach-${name}.png`, timeout: 300000 }); info(`Bild ${OUT}/breach-${name}.png`); } catch (e) { info(`Bild ${name} fehlgeschlagen: ${e.message.split('\n')[0]}`); }
  };

  // 1. Obergrenze
  const cut = await p.evaluate(() => ({ max: window.__t.SH.CUT_MAX, q: window.__game.renderer.quality, fu: window.__game.renderer.renderer.capabilities.maxFragmentUniforms }));
  check(cut.max === (cut.q === 'high' || cut.q === 'ultra' ? 16 : 8), `Wandausschnitte je Stufe: ${cut.q} → CUT_MAX ${cut.max} (Fragment-Uniforms ${cut.fu})`);

  // 2. PG durch die Gasthaus-Südwand (z = 53,5, x = −21,5) und weiter
  await shot('pg-vorher', [-23, 46.5, -21.5, 1.6, 53.5]);
  const ap = await p.evaluate(() => {
    const { S, Hs, V3, fire } = window.__t;
    const n0 = Hs._sync.size, p0 = S.breaching.stats.apPass;
    const s = fire('mbt', 'mbt_ap', V3(-21.5, 2.0, 48.5), V3(-21.5, 1.7, 53.5));
    const hs = [...Hs._sync.values()].slice(n0);
    const wall = hs.find((h) => Math.abs(h.pos.z - 53.5) < 0.3);
    return { pass: S.breaching.stats.apPass - p0, walls: s.walls | 0, r: hs.map((h) => +h.r.toFixed(2)), z: hs.map((h) => +h.pos.z.toFixed(2)), rw: wall ? wall.r : null };
  });
  check(ap.pass >= 1 && ap.rw != null && ap.rw <= 0.55, `PG: schmale Durchschläge (Radien ${ap.r.join(', ')} m an z ${ap.z.join(', ')}), fliegt durch ${ap.pass} Wand/Wände weiter`);

  // 3. SG: große Bresche, zweiter Treffer daneben vergrößert sie (Gasthaus-Südwand bei x = −28)
  await shot('sg-vorher', [-29.5, 46, -27, 1.5, 53.5]);
  const he = await p.evaluate(() => {
    const { Hs, V3, fire, area } = window.__t;
    const n0 = Hs._sync.size;
    fire('mbt', 'mbt_he', V3(-28, 2.4, 47.5), V3(-28, 1.5, 53.5));
    const h = [...Hs._sync.values()][n0];
    if (!h) return null;
    const first = { id: h.sync, r: h.r, a: area(h), min: Math.min(...h.sprof), prof: Array.from(h.sprof, (x) => +x.toFixed(2)), z: h.pos.z };
    // zweiter Treffer rechts neben der Öffnung (Normale −z: θ = 180° zeigt nach +x)
    const right = h.sprof[8] * 1.15 + 0.3;
    fire('mbt', 'mbt_he', V3(-28 + right, 2.4, 47.5), V3(-28 + right, 1.4, 53.5));
    return { first, id2: h.sync, r2: h.r, a2: area(h), n: Hs._sync.size - n0, pos: h.pos.toArray().map((x) => +x.toFixed(2)), x2: +(-28 + right).toFixed(2) };
  });
  check(!!he && Math.abs(he.first.z - 53.5) < 0.3 && he.first.r >= 0.7 && he.first.min > 0.1, `SG: Bresche r ${he && he.first.r.toFixed(2)} m, Umriss ${he && he.first.prof.join(' ')}`);
  check(!!he && he.id2 === he.first.id && he.a2 > he.first.a * 1.15 && he.n === 1, `zweite SG bei x ${he && he.x2}: dieselbe Bresche (Id ${he && he.id2}) wächst (Fläche ×${he && (he.a2 / he.first.a).toFixed(2)}, r ${he && he.r2.toFixed(2)} m)`);
  await shot('sg-nachher', [-29.5, 46, -27, 1.5, 53.5], 24);

  // 3b. SG gegen geschlossenes Fenster und geschlossene Tür (Flügel = building.js-Festkörper): Zündung am Flügel, Flügel
  // zerbrochen, Bresche in der Fassade (vorher flog die Granate durch und riss die Wand erst innen auf)
  const leafs = await p.evaluate(() => {
    const { G, S, Hs, V3, fire } = window.__t;
    const D = G.doors;
    // Grenzland-Türen stehen offen: schließen wie ein Spieler (Lage + Kollisionsteile neu)
    for (const it of D.items) if (it.type === 'door' && !it.broken) { it.target = 0; it.t = 0; D._pose(it); }
    const one = (it, pre) => {
      const d = it.d, c = d.dc || [1, 0], L = Math.hypot(c[0], c[1]) || 1;
      const ctr = V3(d.hx + (c[0] / L) * d.w * 0.5, d.y + Math.min(d.h * 0.5, 1.2), d.hz + (c[1] / L) * d.w * 0.5);
      const nr = V3(-c[1] / L, 0, c[0] / L);
      for (const sg of [1, -1]) {
        const o = ctr.clone().addScaledVector(nr, 12 * sg), dir = nr.clone().multiplyScalar(-sg);
        const tr = S.traceShell(o, dir, 30, { vehicle: null, age: 1, shooter: null });
        if (!tr || !tr.solid || !String(tr.solid.id).startsWith(pre) || tr.distance < 11) continue;
        const n0 = Hs._syncId, ex = [];
        const off = G.events.on('explosion', (e) => ex.push(e.position.clone()));
        fire('mbt', 'mbt_he', o, ctr);
        for (let i = 0; i < 10; i++) { G.time.elapsed += 0.05; S.update(0.05); Hs.update(0.05); }
        off();
        const nb = [...Hs._sync.values()].filter((h) => h.sync > n0);
        const facade = nb.some((h) => h.n.dot(dir) < -0.9 && h.pos.distanceTo(ctr) < 1.6);
        const outside = ex.length > 0 && ex[0].clone().sub(ctr).dot(dir) < 0.5;
        return { id: String(tr.solid.id), broken: !!it.broken, facade, outside, n: nb.length };
      }
      return null;
    };
    const res = {};
    for (const it of D.items) if (it.type === 'window' && !it.broken && !res.win) res.win = one(it, 'win');
    for (const it of D.items) if (it.type === 'door' && !it.broken && it.d.h > 1.8 && !res.door) res.door = one(it, 'door');
    return res;
  });
  for (const [k, r] of Object.entries({ Fenster: leafs.win, Tür: leafs.door })) {
    check(!!r && r.broken && r.facade && r.outside, `SG gegen geschlossene(s) ${k} ${r ? r.id : '–'}: Zündung am Flügel (${r && r.outside ? 'außen' : 'innen'}), Flügel ${r && r.broken ? 'zerbrochen' : 'heil'}, Bresche in der Fassade ${r && r.facade ? 'ja' : 'nein'}`);
  }

  // 4a. Strahl und Sicht durch die SG-Bresche
  const pass = await p.evaluate(() => {
    const { W, Hs, V3 } = window.__t;
    const h = [...Hs._sync.values()].find((x) => Math.abs(x.pos.z - 53.5) < 0.3 && x.r > 0.7);
    if (!h) return { ray: 0, los: false };
    const c = h.pos;
    const ray = W.raycast(V3(c.x, c.y, 51.5), V3(0, 0, 1), 3);
    const los = W.lineOfSight(V3(c.x, c.y, 51.5), V3(c.x, c.y, 54.3)); // knapp hinter die Rückseite (drinnen steht Einrichtung)
    return { ray: ray ? +ray.distance.toFixed(2) : null, los };
  });
  check(pass.ray === null || pass.ray > 2.4, `Kugel-/Granatenstrahl geht durch die Bresche (Treffer ${pass.ray === null ? 'keiner' : pass.ray + ' m'})`);
  check(pass.los, 'Sichtlinie durch die Bresche frei');

  // 5. MG: 7,62 (Koax) und 12,7 mm (Kommandanten-MG) an der Südwand des Hauses bei z = 60
  await shot('mg-vorher', [17, 52, 17.3, 1.5, 60]);
  const mg = await p.evaluate(() => {
    const { G, Hs, VD, V3 } = window.__t;
    const shoot = (def, o, tgt, n, spread) => {
      let pen = 0;
      for (let i = 0; i < n; i++) {
        const d = tgt.clone().sub(o).normalize();
        d.x += (Math.random() - 0.5) * spread; d.y += (Math.random() - 0.5) * spread; d.normalize();
        const r = G.combat.fireHitscan({ shooter: null, origin: o, dir: d, range: def.range, weapon: def });
        if (r && r.penetrated) pen++;
      }
      return pen;
    };
    const holes0 = Hs.holes.length;
    const coax = VD.VEHICLE_WEAPONS.mbt_coax, cmg = VD.VEHICLE_WEAPONS.mbt_cmg;
    const p1 = shoot(coax, V3(18.4, 2.2, 45), V3(18.4, 1.5, 60), 40, 0.008);
    const holes1 = Hs.holes.length;
    const p2 = shoot(cmg, V3(16.2, 2.2, 45), V3(16.2, 1.5, 60), 4, 0.001);
    const thr = Hs.holes.filter((h) => h.through && !h.exit && Math.abs(h.pos.z - 60) < 0.2 && Math.abs(h.pos.x - 16.2) < 0.3);
    return { coax: coax.caliber, cmg: cmg.caliber, holes: holes1 - holes0, p1, p2, thr: thr.length, cut: thr.some((h) => h.cut) };
  });
  check(mg.coax === '762x51' && mg.holes >= 3 && mg.p1 >= 1, `Koax-MG (${mg.coax}): ${mg.holes} Löcher, nach Dauerfeuer ${mg.p1} Durchschüsse`);
  check(mg.cmg === '50bmg' && mg.p2 >= 1 && mg.thr >= 1, `.50-MG (${mg.cmg}): Durchschlag nach wenigen Treffern (${mg.p2} von 4, Durchbruch ${mg.cut ? 'ausgeschnitten' : 'Loch'})`);
  await shot('mg-nachher', [17, 54, 17.3, 1.5, 60], 8);

  // 6a. Geländewagen rammt die Westwand des Hauses am Dorfplatz (x = 12) bei z = 82 mit 14 m/s
  const jeep = await p.evaluate(() => {
    const { G, S, Hs, V3, gy, roll } = window.__t;
    const v = S.list.find((x) => x.type === 'jeep');
    const ev = []; const off = G.events.on('wall:breach', (e) => ev.push(e.kind));
    v.body.setPose(V3(6.5, gy(6.5, 82.4), 82.4), -Math.PI / 2);
    roll(v, 0.3);
    v.body.vel.set(14, 0, 0); v.body.wake();
    roll(v, 1.5);
    const front = v.body.pos.x + v.def.hullBox[5];
    off();
    return { kinds: ev, front: +front.toFixed(2), vx: +v.body.vel.x.toFixed(2), full: ev.includes(3), n: Hs._sync.size };
  });
  check(!jeep.full && jeep.front < 12.4, `Geländewagen (14 m/s): ${jeep.kinds.includes(4) ? 'Anriss, ' : ''}keine Bresche in Fahrzeugbreite, prallt ab (Front x ${jeep.front}, vx ${jeep.vx})`);

  // 6b. Kampfpanzer rammt mit Vollgas (Spieler am Steuer, W gehalten) und fährt hinein
  await p.waitForFunction(() => window.__game.match.state === 'playing', null, { timeout: 600000, polling: 1000 });
  await shot('rammen-vorher', [4, 72, 12, 1.4, 79]);
  const vA = await p.evaluate(() => {
    const { G, S, seat } = window.__t;
    const v = S.list.find((x) => x.type === 'mbt' && x.team === 'A');
    window.__t.tankA = v;
    // Tür und Fenster in der Westwand (x ≈ 12,2, z 77–81, Erdgeschoss): sollen in der Rammbresche zerbrechen
    const D = G.doors;
    window.__t.leaves = D ? D.items.map((it, i) => ({ it, i })).filter(({ it }) => it.type !== 'gate' && Math.abs(it.d.hx - 12.2) < 0.3 && Math.abs(it.d.hz - 79) < 2.2 && it.d.y < 2) : [];
    return seat(v, 3, 79, -Math.PI / 2);
  });
  await p.keyboard.down('KeyW');
  const ram = await p.evaluate(() => {
    const { G, drive } = window.__t, v = window.__t.tankA, P = G.player, leaves = window.__t.leaves;
    const leaves0 = leaves.filter(({ it }) => !it.broken).length;
    const ev = []; const off = G.events.on('wall:breach', (e) => ev.push({ kind: e.kind, size: e.size }));
    let shook = 0; const sh0 = P.shake; P.shake = function (k) { shook = Math.max(shook, k); return sh0.call(this, k); };
    let vBefore = 0, vAfter = null, hit = false;
    drive(8, () => {
      const sp = Math.hypot(v.body.vel.x, v.body.vel.z);
      if (!hit && ev.some((e) => e.kind === 3)) { hit = true; vAfter = sp; }
      if (!hit) vBefore = sp;
    });
    off(); P.shake = sh0;
    return { seated: P.vehicle === v, ev, vBefore: +vBefore.toFixed(2), vAfter: vAfter == null ? null : +vAfter.toFixed(2), x: +v.body.pos.x.toFixed(2), shook: +shook.toFixed(2),
      leaves0, leaves: leaves.length, broken: leaves.filter(({ it }) => it.broken).length, rubble: window.__t.Hs._rubble ? window.__t.Hs._rubble.count : 0 };
  });
  await p.keyboard.up('KeyW');
  await p.evaluate(() => window.__t.leave());
  if (!vA) info('Spieler kam nicht ans Steuer');
  const full = ram.ev.find((e) => e.kind === 3);
  check(!!full && full.size >= 3, `Kampfpanzer (Vollgas): Durchbruch in Fahrzeugbreite (Breite ${full && full.size} m)`);
  check(ram.vAfter != null && ram.vAfter < ram.vBefore - 0.3, `bremst beim Durchbruch (${ram.vBefore} → ${ram.vAfter} m/s)`);
  check(ram.x > 13.5, `fährt mit Vollgas durch die Bresche ins Haus (Wannenmitte x ${ram.x}, Wand bei 12,0–12,3)`);
  check(ram.seated && ram.shook >= 0.7, `Kamerawackeln für den Fahrer (${ram.shook})`);
  check(ram.leaves0 >= 1 && ram.broken === ram.leaves, `Tür/Fenster in der Rammbresche zerbrochen (${ram.broken} von ${ram.leaves}, vorher heil ${ram.leaves0})`);
  check(ram.rubble >= 10, `Schutt liegt am Fuß der Breschen (${ram.rubble} Brocken)`);
  // 4b. Spieler läuft (Körperphysik, Sprung über die Bruchkante) durch die Rammbresche ins Haus (Innenboden erhöht)
  const walk = await p.evaluate(() => {
    const { G, W, Hs, gy } = window.__t;
    const h = [...Hs._sync.values()].find((x) => Math.abs(x.pos.x - 12) < 0.3 && x.r > 1.5);
    const B = G.player.body;
    B.position.set(11.0, gy(11.0, 79.2), 79.2); B.velocity.set(0, 0, 0);
    for (let i = 0; i < 20; i++) B.step(1 / 60, W);
    const x0 = B.position.x;
    for (let i = 0; i < 80; i++) { B.velocity.x = 3.5; B.velocity.z = 0; if (i === 0) B.velocity.y = 5; B.step(1 / 60, W); }
    return { found: !!h, x0: +x0.toFixed(2), x1: +B.position.x.toFixed(2), y1: +B.position.y.toFixed(2) };
  });
  check(walk.found && walk.x1 > 12.3 + 0.5, `Spieler läuft durch die Rammbresche ins Haus (x ${walk.x0} → ${walk.x1}, Füße y ${walk.y1})`);
  await shot('rammen-nachher', [4, 72, 12, 1.4, 79], 24);
  await shot('rammen-innen', [15, 81.5, 9, 1.4, 78.5]);

  // 6e. Eingerichtete Häuser (Prüfung 21.10.: der Panzer brach durch und blieb an Küchenzeile/Schrank/Tisch stehen):
  // Mühlweg-Südwand (z 37,5) zweimal, Gasthaus-Nordwand (z 62,5) – mit Vollgas mindestens 2 m ins Haus
  const houses = [
    { name: 'Mühlweg x −23,5', x: -23.5, z: 21, yaw: Math.PI, wall: 37.5, axis: 'z', sgn: 1, i: 1 },
    { name: 'Mühlweg x −24,5', x: -24.5, z: 21, yaw: Math.PI, wall: 37.5, axis: 'z', sgn: 1, i: 1, again: true },
    { name: 'Gasthaus-Nordwand x −29', x: -29, z: 76, yaw: 0, wall: 62.5, axis: 'z', sgn: -1, i: 2 },
  ];
  for (const hs of houses) {
    await p.evaluate((h) => { const { S, seat } = window.__t; const v = S.list.filter((x) => x.type === 'mbt')[h.i]; window.__t.cur = v; return seat(v, h.x, h.z, h.yaw); }, hs);
    await p.keyboard.down('KeyW');
    const r = await p.evaluate((h) => {
      const { G, S, drive } = window.__t, v = window.__t.cur;
      const ev = []; const off = G.events.on('wall:breach', (e) => ev.push(e.kind));
      const c0 = S.breaching.stats.crush;
      let best = -99;
      drive(12, () => { best = Math.max(best, (v.body.pos[h.axis] - h.wall) * h.sgn); });
      off();
      return { full: ev.includes(3), into: +best.toFixed(2), crush: S.breaching.stats.crush - c0 };
    }, hs);
    await p.keyboard.up('KeyW');
    // Loslassen im Sitz übernehmen (Gang-halten-Schaltung wartet sonst beim nächsten Einsteigen auf die Flanke)
    await p.evaluate(() => window.__t.drive(0.2));
    check((r.full || hs.again) && r.into > 2.0, `${hs.name}: ${r.full ? 'Durchbruch' : 'Bresche vorhanden'}, Panzer fährt ${r.into} m hinter die Wandfläche (Einrichtung gibt nach: ${r.crush} Stellen)`);
    if (hs.name.startsWith('Mühlweg x −23')) { await p.evaluate(() => window.__t.leave()); await shot('rammen-moebel', [-19, 31, -23.5, 1.4, 38.5]); }
  }
  // Fensterläden/Sims in der Mühlweg-Bresche schweben nicht (Ausschnitt vorn 15 cm weit): Strahl auf Ladenhöhe frei
  const shutter = await p.evaluate(() => {
    const { W, V3 } = window.__t;
    const out = [];
    for (const x of [-25.4, -24.8, -23.5, -22.4]) {
      const h = W.raycast(V3(x, 1.9, 35), V3(0, 0, 1), 4);
      out.push({ x, z: h ? +h.point.z.toFixed(2) : null, s: h ? h.surface : null });
    }
    return out;
  });
  check(shutter.every((q) => q.z === null || q.z > 37.85), `keine Läden/Simse in der Rammbresche (Strahlen auf 1,9 m: ${shutter.map((q) => `${q.x}→${q.z ?? 'frei'}`).join(', ')})`);
  await p.evaluate(() => window.__t.leave());

  // 6f. Zweite, überlappende Rammung neben der ersten (Haus am Dorfplatz, z 82,2): eigene Bresche oder Vereinigung –
  // nichts, was offen war, schließt sich (Prüfung 21.10.: der Umriss wurde um die neue Mitte gekappt)
  const over = await p.evaluate(() => {
    const { G, S, Hs, V3, gy, roll } = window.__t;
    const probe = () => { const o = []; for (let z = 76.6; z <= 81.4; z += 0.4) for (const y of [0.9, 1.6, 2.4]) o.push(!!Hs._cutAt(V3(12.1, y, z), 1)); return o; };
    const p0 = probe();
    const v = S.list.filter((x) => x.type === 'mbt')[3];
    v.body.setPose(V3(3, gy(3, 82.2), 82.2), -Math.PI / 2);
    roll(v, 0.3);
    const ev = []; const off = G.events.on('wall:breach', (e) => ev.push(e.kind));
    v.body.vel.set(5, 0, 0); v.body.wake();
    roll(v, 2.5, (vv) => { if (vv.body.pos.x > 6) vv.body.vel.x = Math.max(vv.body.vel.x, 2.5); });
    off();
    const p1 = probe();
    const closed = p0.filter((o, k) => o && !p1[k]).length;
    const A = window.__t.tankA;
    const inA = [...Hs._sync.values()].filter((h) => Math.abs(h.pos.x - 12) < 0.5 && S.breaching.fits(A, h)).length;
    return { full: ev.includes(3), open0: p0.filter(Boolean).length, closed, inA };
  });
  check(over.full && over.open0 > 10 && over.closed === 0, `zweite Rammung daneben: Durchbruch, von ${over.open0} offenen Prüfpunkten der ersten Bresche schließen sich ${over.closed}`);
  await shot('rammen-zweite', [3.5, 74, 12, 1.4, 80.6], 24); // überlappende Breschen: kein Rand in der Öffnung

  // 6g. Kampfpanzer streift die Gasthaus-Südwand (10°, 5 m/s): nur Anrisse am Kontaktpunkt, keine Front in Fahrzeuglänge
  const graze = await p.evaluate(() => {
    const { G, S, Hs, V3, gy, roll, T } = window.__t;
    const v = S.list.filter((x) => x.type === 'mbt')[2];
    const a = 0.1745, n0 = Hs._syncId;
    v.body.setPose(V3(-38, gy(-38, 50), 50), -Math.PI / 2 - a);
    roll(v, 0.3);
    const ev = []; const off = G.events.on('wall:breach', (e) => ev.push(e.kind));
    v.body.vel.set(5 * Math.cos(a), 0, 5 * Math.sin(a)); v.body.wake();
    const f = new T.Vector3();
    roll(v, 4, (vv) => { vv.body.forward(f); const sp = Math.max(4, vv.body.vel.length()); vv.body.vel.x = f.x * sp; vv.body.vel.z = f.z * sp; });
    off();
    let open = 0;
    for (let x = -40; x <= -15; x += 0.1) if ([...Hs._sync.values()].some((h) => h.sync > n0 && Hs._cutAt(V3(x, 1.2, 53.49), 1) === h)) open += 0.1;
    return { full: ev.filter((k) => k === 3).length, part: ev.filter((k) => k === 4).length, open: +open.toFixed(1) };
  });
  check(graze.full === 0 && graze.open < 4.5, `streifender Panzer (10°): ${graze.part} Anrisse, kein Durchbruch, neu offen ${graze.open} m Wandlänge`);

  // 6h. Geländewagen mit Vollgas gegen die Kate-Ostwand (x 37, Tür/Zarge/Läden): keine Scheinbresche
  await p.evaluate(() => { const { S, seat } = window.__t; const v = S.list.find((x) => x.type === 'jeep' && x.team === 'A') || S.list.find((x) => x.type === 'jeep'); window.__t.cur = v; return seat(v, 62, 66, Math.PI / 2); });
  await p.keyboard.down('KeyW');
  await frames(2); // Räder (Automatik) lesen input.move – erst im nächsten Spielbild gesetzt
  const jd = await p.evaluate(() => {
    const { G, S, Hs, drive } = window.__t, v = window.__t.cur, n0 = Hs._syncId;
    const ev = []; const off = G.events.on('wall:breach', (e) => ev.push(e.kind));
    let vmax = 0;
    drive(7, () => { vmax = Math.max(vmax, Math.hypot(v.body.vel.x, v.body.vel.z)); });
    off();
    const nb = [...Hs._sync.values()].filter((h) => h.sync > n0 && Math.abs(h.pos.x - 37) < 1);
    return { full: ev.includes(3), vmax: +vmax.toFixed(1), x: +v.body.pos.x.toFixed(2), tn: nb.map((h) => +h.tn.toFixed(2)) };
  });
  await p.keyboard.up('KeyW');
  await p.evaluate(() => window.__t.leave());
  check(jd.vmax > 8 && !jd.full && jd.tn.every((t) => t >= 0.12), `Geländewagen (bis ${jd.vmax} m/s) an Tür/Zarge/Laden der Kate: kein Durchbruch, Anrisse durch die ganze Mauer (Dicken ${jd.tn.join(', ') || '–'} m)`);

  // 9. Kugeln (5,56 mm) von oben: Panzerung hält, Blech wird durchschlagen
  const veh = await p.evaluate(async () => {
    const { G, S, W, V3 } = window.__t;
    const WD = await import('./assets/js/shared/weapons.data.js');
    const def = (WD.WEAPONS || {}).ar_m17;
    const res = {};
    for (const v of S.list.filter((q) => q.alive)) {
      if (res[v.type]) continue;
      const o = v.body.pos.clone().add(V3(0.2, 4.8, 0.1)), d = V3(0, -1, 0);
      const h = W.raycast(o, d, 8);
      if (!h || h.vehicle !== v) continue;
      const r = G.combat.fireHitscan({ shooter: null, origin: o, dir: d, range: 30, weapon: def });
      res[v.type] = { armored: !!v.def.armored, pen: !!(r && r.penetrated) };
    }
    return res;
  });
  const vs = Object.entries(veh);
  check(vs.length >= 3 && vs.every(([, r]) => r.pen === !r.armored), `Kugeln: ${vs.map(([k, r]) => `${k} ${r.pen ? 'durch' : 'hält'}`).join(', ')}`);

  // 6c. Sandsäcke und Gelände bleiben fest
  const solid = await p.evaluate(() => {
    const { Hs, W, V3 } = window.__t;
    // Sandsackwall am Funkhügel (Linie (−131, −132) → (−125, −129)), waagrecht von Norden angeschnitten
    const n = V3(-3, 0, 6).normalize(), y = window.__t.gy(-128, -130.5);
    const sand = W.raycast(V3(-128, y + 0.45, -130.5).addScaledVector(n, 3), n.clone().negate(), 5);
    const ground = W.raycast(V3(0, 20, 0), V3(0, -1, 0), 40);
    const sw = sand ? Hs.wallAt(sand.point, n, 0.9) : null;
    const gw = ground ? Hs.wallAt(ground.point, V3(0, 1, 0), 0.9) : null;
    return { sand: sand && sand.surface, sw: !!sw, gw: !!gw };
  });
  check(!solid.sw && !solid.gw, `Sandsäcke (${solid.sand}) und Gelände: keine Bresche möglich`);

  // 6d. Unterbau: an der Gasthaus-Südwand ist unten keine Wand zu finden (Mauerfuß, dahinter die Treppe – bis ≈ 1 m
  // keine Wand); eine Zugmaschine (8,2 t, 16 m/s) trifft zuerst ihn – die Wand darüber nimmt den Stoß auf und bricht
  const truck = await p.evaluate(() => {
    const { G, S, Hs, VD, V3, gy, roll } = window.__t;
    const n = V3(0, 0, -1), x = -31;
    const low = Hs.wallAt(V3(x, gy(x, 53) + 0.5, 53.5), n, 0.95), high = Hs.wallAt(V3(x, gy(x, 53) + 1.6, 53.5), n, 0.95);
    const hb = VD.VEHICLES.zugmaschine.hullBox, z0 = 53.5 - (hb[5] - hb[2] + 1.0);
    const v = S.spawnVehicle('zugmaschine', V3(x, gy(x, z0), z0), Math.PI, 'A');
    if (!v) return null;
    roll(v, 0.2);
    const ev = []; const off = G.events.on('wall:breach', (e) => ev.push(e.kind));
    v.body.vel.set(0, 0, 16); v.body.wake();
    roll(v, 1.2);
    off();
    const front = +(v.body.pos.z + hb[5] - hb[2]).toFixed(2);
    S.removeVehicle(v);
    return { low: !!low, high: !!high, kinds: [...new Set(ev)], front };
  });
  // (Dahinter steht die Holztreppe: sie gab früher nicht nach und hielt die Zugmaschine auf – jetzt drückt das schwere
  // Fahrzeug sie nieder wie Einrichtung; der Mauerfuß im Ausschnitt ist ohnehin offen.)
  check(!!truck && !truck.low && truck.high && truck.kinds.some((k) => k === 3 || k === 4) && truck.front < 58, `Zugmaschine (16 m/s) gegen Wand auf Unterbau: ${truck && truck.kinds.includes(3) ? 'Durchbruch' : 'Anriss'} in der Wand darüber (Front z ${truck && truck.front}, Wand bei 53,5)`);

  // 7. Nachricht für Späteinsteiger: ohne t/e, erneut angewandt identisch
  const net = await p.evaluate(() => {
    const { Hs } = window.__t;
    const st = Hs.breachState();
    const bad = st.filter((m) => 't' in m || 'e' in m || !Array.isArray(m.r) || m.r.length !== 16 || !Number.isFinite(m.w));
    const m = { ...st[0], id: 9999 };
    const h = Hs.applyBreach(m, { quiet: true });
    const o = Hs._sync.get(st[0].id);
    const same = !!h && !!o && h.pos.distanceTo(o.pos) < 1e-6 && h.sprof.every((r, k) => Math.abs(r - o.sprof[k]) < 1e-6) && Math.abs(h.tn - o.tn) < 1e-6 && h.seed === o.seed;
    Hs.removeWhere((x) => x === h || x === h.exitHole);
    Hs._sync.delete(9999);
    return { n: st.length, bad: bad.length, same };
  });
  check(net.n >= 3 && net.bad === 0 && net.same, `breachState: ${net.n} Breschen, Felder ohne Umschlag-Namen, erneut angewandt identisch`);
  const perf = await p.evaluate(() => { const { Hs, SH } = window.__t; return { cuts: Hs._cutList.length, on: SH.CUTS.want, holes: Hs.holes.length }; });
  info(`Ausschnitte: ${perf.cuts} insgesamt, ${perf.on} im Shader, ${perf.holes} Löcher`);
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  clearTimeout(killer);
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
