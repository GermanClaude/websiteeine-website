// NULLPUNKT – Panzer-Schadensmodell (Nutzer 11.10., wie War Thunder): Durchschlag einer Panzergranate verwundet bzw.
// tötet die Besatzung nahe der Einschlagstelle, Treffer am Munitionsgestell zündet das Lager (Turm abgesprengt);
// Innenraum-Sicht auch für Richtschütze/Kommandant. Aufruf: node tools/tank-damage-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + 'dev/vehicles.html?type=mbt&quality=low&enter=0&lite=1', { waitUntil: 'load', timeout: 180000 });
  await p.waitForFunction(() => window.__dev && window.__dev.main && window.__dev.sys.attached, null, { timeout: 180000 });
  const r = await p.evaluate(() => {
    const D = window.__dev, G = D.G, sys = D.sys, v = D.main, T = G.THREE || window.THREE;
    const step = (sec, dt = 1 / 60) => { for (let i = 0, n = Math.round(sec / dt); i < n; i++) { G.time.elapsed += dt; G.time.frame++; sys.update(dt); } };
    step(1);
    const enemy = { team: 'B', alive: true, isPlayer: false, name: 'Feind', position: v.position.clone() };
    v.hostileTo = () => true;
    const crits = [];
    G.events.on('vehicle:crit', (e) => crits.push(e.notes.join(' | ')));
    // Spieler als Richtschütze, Innenraum-Sicht
    sys.enter(D.player, v, 1); step(0.4);
    const views = v.seats[1].def.views.map((x) => x.id);
    sys.setSeatView(D.player, views.indexOf('innen')); step(0.3);
    const interiorOn = !!(v.model.interior && v.model.interior.visible);
    // Durchschlag an der Richtschützen-Position
    const P = v.body.toWorld(new v.body.pos.constructor().fromArray(v.seats[1].def.pos).add(new v.body.pos.constructor(0, 0.7, 0)), new v.body.pos.constructor());
    const h0 = D.player.health;
    v.applyDamage(150, { attacker: enemy, weaponId: 'mbt_ap', zone: 'hull', kind: 'shell', point: P });
    const h1 = D.player.health, alive1 = D.player.alive;
    // Munitionslager: viele Versuche am Gestell bis zur Zündung
    let boom = false, held = 0;
    const I = v.def.interior;
    const hitRack = () => {
      v.health = v.maxHealth; v.zones.hull.hp = v.maxHealth;
      const q = new v.body.quat.constructor().setFromAxisAngle(new v.body.pos.constructor(0, 1, 0), v.mount.turretYaw);
      const L = new v.body.pos.constructor().fromArray(I.rack).applyQuaternion(q).add(new v.body.pos.constructor().fromArray(v.def.turretPivot));
      v.applyDamage(60, { attacker: enemy, weaponId: 'mbt_ap', zone: 'turret', kind: 'shell', point: v.body.toWorld(L, new v.body.pos.constructor()) });
    };
    // Bunker zu: Sprengklappen halten (Munition weg, Panzer lebt)
    for (let i = 0; i < 40 && v.alive && !crits.some((t) => /Sprengklappen/.test(t)); i++) { v.gun.rack.mbt_ap = 20; v.gun.step = 'leer'; hitRack(); }
    held = v.alive && crits.some((t) => /Sprengklappen/.test(t)) ? 1 : 0;
    const rackAfter = v.gun.rack.mbt_ap;
    // Bunker offen (Ladeschütze greift gerade): Treffer zündet
    for (let i = 0; i < 40 && v.alive; i++) {
      v.gun.rack.mbt_ap = 20; v.gun.step = 'offen';
      hitRack();
      if (!v.alive) boom = true;
    }
    return { views, interiorOn, h0, h1, alive1, crits, boom, held, rackAfter, ammo: !!v._ammoRack, turY: v.model.turret ? v.model.turret.position.y : 0, pivotY: v.def.turretPivot[1] };
  });
  check(r.views.includes('innen') && r.interiorOn, `Richtschütze: Sicht „Turm innen“ (${r.views.join(', ')}), Innenraum sichtbar`);
  check(r.h1 < r.h0, `Durchschlag verwundet den Richtschützen (${r.h0} → ${r.h1}${r.alive1 ? '' : ', ausgefallen'})`);
  check(r.crits.some((t) => /Richtschütze/.test(t)), `Trefferbericht: ${r.crits[0] || '–'}`);
  check(r.held === 1 && r.rackAfter === 0, `Bunker zu: Sprengklappen halten, Munition weg (${r.rackAfter}), Panzer lebt`);
  check(r.boom && r.ammo && r.crits.some((t) => /offen getroffen/.test(t)), 'Bunker offen: Treffer zündet die Munition');
  check(r.turY > r.pivotY + 1, `Turm abgesprengt (y ${r.turY.toFixed(2)})`);
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
