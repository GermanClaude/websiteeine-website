// NULLPUNKT – Abnahme Triebwerk/Getriebe (docs/planung/panzer-mp.md §A.10) ohne Browser: echte 3D-Fahrzeugsim
// (vehicles/sim.js + drivetrain.js) auf einer Ersatzwelt (Ebene bzw. Hang entlang −Z, Oberfläche „dirt“).
// Aufruf: node tools/tank-drive-test.mjs   (Exit-Code ≠ 0 bei Fehlern; -v = Messwerte ausführlich)
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// 'three' und 'three/addons/…' wie die Import-Map der Seite auf die mitgelieferten Dateien abbilden
const THREE_URL = pathToFileURL(new URL('../assets/vendor/three/three.module.min.js', import.meta.url).pathname).href;
const ADDONS_URL = pathToFileURL(new URL('../assets/vendor/three/addons/', import.meta.url).pathname).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === 'three') return { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(ADDONS_URL)} + s.slice(13), shortCircuit: true };
  return n(s, c); }`), import.meta.url);
const THREE = await import('three');
const { VehicleBody, STEP } = await import('../assets/js/game/vehicles/sim.js');
const { VEHICLES } = await import('../assets/js/game/vehicles/data.js');
const { gearName, gearList } = await import('../assets/js/game/vehicles/drivetrain.js');

const VERBOSE = process.argv.includes('-v');
let fail = 0, count = 0;
const rows = [];
const check = (ok, text, val = '') => {
  count++;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${text}${val !== '' ? ` → ${val}` : ''}`);
  rows.push([text, val, ok]);
};
const kmh = (v) => v * 3.6;
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

/** Ersatzwelt: Ebene oder Hang (Steigung in Grad, bergauf Richtung −Z), überall dieselbe Oberfläche. */
function makeWorld(slopeDeg = 0, surface = 'dirt') {
  const tan = Math.tan(slopeDeg * Math.PI / 180);
  const n = new THREE.Vector3(0, 1, tan).normalize();
  return {
    heightAt: (x, z) => -z * tan,
    normalAt: (x, z, out) => out.copy(n),
    surfaceAt: () => surface,
  };
}

/** Fahrzeug aufsetzen (Lage passend zum Hang), Federn setzen lassen, danach Stillstand. */
function makeBody(type, world, slopeDeg = 0) {
  const b = new VehicleBody(VEHICLES[type]);
  b.setPose(new THREE.Vector3(0, 0.05, 0), 0);
  if (slopeDeg) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), slopeDeg * Math.PI / 180);
    const o = new THREE.Vector3(0, 0.05, 0);
    b.quat.copy(q);
    b.pos.copy(b.com).applyQuaternion(q).add(o);
    b.prevPos.copy(b.pos); b.prevQuat.copy(b.quat);
  }
  b.controls.handbrake = true;
  for (let i = 0; i < 90; i++) b.update(STEP, world);
  b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0);
  b.controls.handbrake = false;
  b.drivetrain.run();
  return b;
}

/** secs Sekunden takten; fn(b, t) je Schritt vor dem Takt (Steuerung), after(b, t) danach (Messung). */
function run(b, world, secs, fn, after) {
  let t = 0;
  const n = Math.round(secs / STEP);
  for (let i = 0; i < n; i++) {
    if (fn) fn(b, t);
    b.update(STEP, world);
    t += STEP;
    if (after) after(b, t);
  }
  return t;
}
const yawRate = (b) => b.angVel.y;

const flat = makeWorld(0);

/* ------------------------------------------------------------------ Gangliste */
{
  const m = VEHICLES.mbt, j = VEHICLES.jeep;
  check(JSON.stringify(gearList(m)) === '[-2,-1,0,1,2,3,4,5]', 'gearList KP-1', gearList(m).join(' '));
  check(JSON.stringify(gearList(j)) === '[-1,0,1,2,3,4]', 'gearList GW-4', gearList(j).join(' '));
  check([-2, -1, 0, 1, 5].map((g) => gearName(m, g)).join(' ') === 'R2 R1 N 1 5', 'gearName KP-1', [-2, -1, 0, 1, 5].map((g) => gearName(m, g)).join(' '));
  check(gearName(j, -1) === 'R' && gearName(j, 0) === 'N' && gearName(j, 4) === '4', 'gearName GW-4', `${gearName(j, -1)} ${gearName(j, 0)} ${gearName(j, 4)}`);
}

/* ------------------------------------------------------------------ KP-1 Ebene, Automatik */
{
  const b = makeBody('mbt', flat);
  b.controls.gearbox = 'auto';
  b.controls.throttle = 1;
  let t30 = null, vmax = 0;
  run(b, flat, 70, (bb, t) => { if (t30 === null && kmh(bb.speed) >= 30) t30 = t; vmax = Math.max(vmax, kmh(bb.speed)); });
  check(vmax >= 62 && vmax <= 72, 'KP-1 Spitze eben (Automatik) 62–72 km/h', `${f1(vmax)} km/h, Gang ${gearName(b.def, b.drive.gear)}, ${Math.round(b.drive.rpm)}/min`);
  check(t30 !== null && t30 >= 5 && t30 <= 8, 'KP-1 0→30 km/h 5–8 s', t30 === null ? 'nie' : `${f1(t30)} s`);
}

/* ------------------------------------------------------------------ KP-1 rückwärts R2 (Gang halten, Vollgas) */
{
  const b = makeBody('mbt', flat);
  b.controls.gearbox = 'hold';
  b.drivetrain.shift(-2);
  b.controls.throttle = 1;
  let vmin = 0;
  run(b, flat, 30, (bb) => { vmin = Math.min(vmin, kmh(bb.speed)); });
  check(b.drive.gear === -2, 'R2 eingelegt (zweimal runter aus N)', gearName(b.def, b.drive.gear));
  check(-vmin >= 24 && -vmin <= 32, 'KP-1 rückwärts R2 24–32 km/h', `${f1(-vmin)} km/h`);
}

/* ------------------------------------------------------------------ Gang halten: 3. Gang ohne Taste */
{
  const b = makeBody('mbt', flat);
  b.controls.gearbox = 'hold';
  b.drivetrain.shift(3);
  b.controls.throttle = 0;
  run(b, flat, 20);
  let lo = 1e9, hi = -1e9;
  run(b, flat, 10, (bb) => { lo = Math.min(lo, kmh(bb.speed)); hi = Math.max(hi, kmh(bb.speed)); });
  check(lo >= 20 && hi <= 28 && hi - lo <= 2, 'Gang halten 3. Gang: 20–28 km/h, ±1 km/h über 10 s', `${f1(lo)}–${f1(hi)} km/h, ${Math.round(b.drive.rpm)}/min`);
  check(!b.sleeping, 'im Gang mit Regler kein Schlaf', b.sleeping ? 'schläft' : 'wach');
  // Schalten 3 → 4: Schaltpause ohne Zugkraft, Drehzahl fällt
  const rpm0 = b.drive.rpm;
  b.drivetrain.shift(1);
  let pause = 0, forceIn = 0, rpmMin = 1e9;
  run(b, flat, 1.2, null, (bb) => {
    if (bb.drive.shifting) { pause += STEP; forceIn = Math.max(forceIn, bb.drivetrain.force); rpmMin = Math.min(rpmMin, bb.drive.rpm); }
  });
  check(pause >= 0.4 && pause <= 0.62 && forceIn <= 0, 'Schaltpause 0,4–0,6 s ohne Zugkraft', `${pause.toFixed(2)} s, Zugkraft max ${Math.round(forceIn)} N`);
  check(rpmMin < rpm0 - 300 && b.drive.gear === 4, 'Hochschalten: Drehzahl fällt', `${Math.round(rpm0)} → ${Math.round(rpmMin)}/min, Gang ${b.drive.gear}`);
  // Vollgas 4. Gang
  b.controls.throttle = 1;
  run(b, flat, 15);
  if (VERBOSE) console.log(`     4. Gang Vollgas: ${f1(kmh(b.speed))} km/h, ${Math.round(b.drive.rpm)}/min`);
  // Richtungssperre: in Fahrt zweimal runter in Richtung R → bleibt in N, Meldung blocked
  const b2 = makeBody('mbt', flat);
  b2.controls.gearbox = 'hold';
  b2.drivetrain.shift(2);
  run(b2, flat, 6);
  let blocked = false;
  b2.drivetrain.onGear = (g, bl) => { if (bl) blocked = true; };
  b2.drivetrain.shift(-3);
  run(b2, flat, 0.8);
  check(b2.drive.targetGear === 0 && blocked, 'Richtungssperre: R erst unter 1,5 m/s', `Ziel ${gearName(b2.def, b2.drive.targetGear)}, Meldung ${blocked ? 'ja' : 'nein'}, ${f1(kmh(b2.speed))} km/h`);
}

/* ------------------------------------------------------------------ Steigung 31° (60 %), Erde */
{
  const hill = makeWorld(31);
  const b = makeBody('mbt', hill, 31);
  b.controls.gearbox = 'hold';
  b.drivetrain.setGear(1);
  b.controls.throttle = 1;
  run(b, hill, 6);
  let lo = 1e9;
  run(b, hill, 6, (bb) => { lo = Math.min(lo, kmh(bb.speed)); });
  check(lo >= 2.5, 'KP-1 31° Hang, 1. Gang, Erde: ≥ 2,5 km/h bergauf', `${f1(lo)} km/h, ${Math.round(b.drive.rpm)}/min, Schlupf ${b.drive.slip.toFixed(2)}`);

  const b3 = makeBody('mbt', hill, 31);
  b3.controls.gearbox = 'hold';
  b3.drivetrain.setGear(3);
  b3.controls.throttle = 1;
  let hi3 = -1e9;
  run(b3, hill, 3);
  run(b3, hill, 7, (bb) => { hi3 = Math.max(hi3, kmh(bb.speed)); });
  check(hi3 <= 0.5, 'KP-1 31° Hang, 3. Gang: schafft es nicht', `max ${f1(hi3)} km/h, Lugging ${b3.drive.lugging ? 'ja' : 'nein'}`);

  const hill10 = makeWorld(10);
  const b5 = makeBody('mbt', hill10, 10);
  b5.controls.gearbox = 'hold';
  b5.drivetrain.setGear(5);
  b5.controls.throttle = 1;
  let hi5 = -1e9;
  run(b5, hill10, 10, (bb) => { hi5 = Math.max(hi5, kmh(bb.speed)); });
  check(hi5 <= 2, 'KP-1 10° Hang, 5. Gang aus dem Stand: ≤ 2 km/h', `max ${f1(hi5)} km/h`);

  if (VERBOSE) {
    for (const [deg, g, surf] of [[25, 2, 'dirt'], [31, 2, 'dirt'], [33, 1, 'grass'], [36, 1, 'dirt'], [20, 3, 'dirt']]) {
      const w = makeWorld(deg, surf);
      const bb = makeBody('mbt', w, deg);
      bb.controls.gearbox = 'hold'; bb.drivetrain.setGear(g); bb.controls.throttle = 1;
      run(bb, w, 10);
      console.log(`     ${deg}° ${surf} Gang ${g}: ${f1(kmh(bb.speed))} km/h`);
    }
  }
}

/* ------------------------------------------------------------------ Neutrallenkung */
{
  const b = makeBody('mbt', flat);
  b.controls.gearbox = 'hold';
  b.controls.steer = 1;
  run(b, flat, 3);
  let wmin = 1e9, wmax = -1e9, vmax = 0;
  run(b, flat, 3, (bb) => { const w = Math.abs(yawRate(bb)); wmin = Math.min(wmin, w); wmax = Math.max(wmax, w); vmax = Math.max(vmax, Math.abs(bb.speed)); });
  check(wmin >= 0.6 && wmax <= 0.9 && vmax < 0.5, 'Neutrallenkung (N + Lenken) 0,6–0,9 rad/s, < 0,5 m/s', `${wmin.toFixed(2)}–${wmax.toFixed(2)} rad/s, ${vmax.toFixed(2)} m/s, ${Math.round(b.drive.rpm)}/min`);
}

/* ------------------------------------------------------------------ Ausrollen in N, Bremse */
{
  const b = makeBody('mbt', flat);
  b.controls.gearbox = 'auto';
  b.controls.throttle = 1;
  run(b, flat, 30, (bb) => { if (kmh(bb.speed) >= 30) bb.controls.throttle = 0.4; });
  // auf ~30 km/h, dann N und laufen lassen
  b.controls.gearbox = 'hold';
  b.controls.throttle = 0;
  b.drivetrain.setGear(0);
  const v0 = kmh(b.speed);
  let tStop = null;
  run(b, flat, 20, (bb, t) => { if (tStop === null && Math.abs(bb.speed) < 0.3) tStop = t; });
  check(tStop !== null && tStop >= 3 && tStop <= 12, 'Ausrollen KP-1 in N von 30 km/h: 3–12 s', `${f1(v0)} km/h → ${tStop === null ? 'steht nicht' : f1(tStop) + ' s'}`);

  const c = makeBody('mbt', flat);
  c.controls.gearbox = 'auto';
  c.controls.throttle = 1;
  for (let i = 0; i < 60 * 40 && kmh(c.speed) < 40; i++) c.update(STEP, flat);
  const v1 = kmh(c.speed);
  c.controls.throttle = 0; c.controls.brake = 1;
  let tB = null;
  run(c, flat, 10, (bb, t) => { if (tB === null && Math.abs(bb.speed) < 0.3) tB = t; });
  check(tB !== null && tB <= 4 && v1 >= 38, 'Bremse KP-1 von 40 km/h: ≤ 4 s', `${f1(v1)} km/h → ${tB === null ? 'steht nicht' : f1(tB) + ' s'}`);
}

/* ------------------------------------------------------------------ Schlaf */
{
  const b = makeBody('mbt', flat);
  b.wake();
  let tSleep = null;
  run(b, flat, 4, (bb, t) => { bb.controls.handbrake = true; bb.controls.throttle = 0; bb.drivetrain.park(STEP); if (tSleep === null && bb.sleeping) tSleep = t; });
  check(tSleep !== null && tSleep <= 2, 'Schlaf: unbesetzt in N nach ≤ 2 s', tSleep === null ? 'schläft nicht' : `${f1(tSleep)} s, Motor ${b.drive.rpm ? 'an' : 'aus'}`);
  check(b.drive.rpm === 0, 'Motor aus nach 2 s ohne Fahrer', `${Math.round(b.drive.rpm)}/min`);
}

/* ------------------------------------------------------------------ GW-4 */
{
  const j = makeBody('jeep', flat);
  j.controls.gearbox = 'auto';
  j.controls.throttle = 1;
  let t40 = null, vmax = 0;
  run(j, flat, 60, (bb, t) => { if (t40 === null && kmh(bb.speed) >= 40) t40 = t; vmax = Math.max(vmax, kmh(bb.speed)); });
  check(vmax >= 95 && vmax <= 120, 'GW-4 Spitze 95–120 km/h', `${f1(vmax)} km/h, Gang ${gearName(j.def, j.drive.gear)}`);
  check(t40 !== null && t40 <= 4, 'GW-4 0→40 km/h ≤ 4 s', t40 === null ? 'nie' : `${f1(t40)} s`);
  const r = makeBody('jeep', flat);
  r.controls.gearbox = 'auto';
  r.controls.throttle = -1;
  let vmin = 0;
  run(r, flat, 20, (bb) => { vmin = Math.min(vmin, kmh(bb.speed)); });
  if (VERBOSE) console.log(`     GW-4 rückwärts: ${f1(-vmin)} km/h`);
  check(-vmin >= 20 && -vmin <= 40, 'GW-4 rückwärts (Automatik) 20–40 km/h', `${f1(-vmin)} km/h`);
}

/* ------------------------------------------------------------------ Schaden → Leistung */
{
  const b = makeBody('mbt', flat);
  b.controls.gearbox = 'auto';
  b.controls.throttle = 1;
  b.mods.torque = 0.5; b.mods.cutRpm = 1992;
  let vmax = 0;
  run(b, flat, 40, (bb) => { vmax = Math.max(vmax, kmh(bb.speed)); });
  check(vmax > 25 && vmax < 55, 'Motor zerstört (Notlauf): langsamer', `${f1(vmax)} km/h`);
  const c = makeBody('mbt', flat);
  c.controls.gearbox = 'hold';
  c.mods.maxGear = 2;
  c.drivetrain.shift(5);
  c.controls.throttle = 1;
  run(c, flat, 20);
  check(c.drive.gear === 2 && kmh(c.speed) < 20, 'Kette beschädigt: höchstens 2. Gang', `Gang ${c.drive.gear}, ${f1(kmh(c.speed))} km/h`);
  const d = makeBody('mbt', flat);
  d.controls.gearbox = 'auto';
  d.controls.throttle = 1;
  d.mods.immobile = true;
  run(d, flat, 5);
  check(Math.abs(kmh(d.speed)) < 0.5, 'bewegungsunfähig: steht', `${f1(kmh(d.speed))} km/h`);
}

/* ------------------------------------------------------------------ Autopilot-Runde (Bots: Automatik, wie dev/vehicles.js autopilotLap) */
{
  const { updateAutopilot } = await import('../assets/js/game/vehicles/autopilot.js');
  for (const type of ['mbt', 'jeep']) {
    const b = makeBody(type, flat);
    b.setPose(new THREE.Vector3(0, 0.05, 28), 0);
    for (let i = 0; i < 30; i++) b.update(STEP, flat);
    const veh = { body: b, def: b.def };
    const P = (x, z) => new THREE.Vector3(x, 0, z);
    const it = { path: [P(0, -20), P(40, -20), P(40, 10), P(-10, 25), P(0, 28)], arriveRadius: 5, throttle: 0, steer: 0, brake: 0 };
    let t = 0, vmax = 0;
    while (t < 120 && !it.arrived) {
      updateAutopilot(veh, it, STEP, flat);
      b.controls.gearbox = 'auto';
      b.controls.throttle = it.throttle; b.controls.steer = it.steer; b.controls.brake = it.brake || 0; b.controls.handbrake = false;
      b.update(STEP, flat);
      vmax = Math.max(vmax, kmh(Math.abs(b.speed)));
      t += STEP;
    }
    check(!!it.arrived && !(it.stuckCount > 2), `Autopilot-Runde ${type === 'mbt' ? 'KP-1' : 'GW-4'} (Automatik) kommt an`, `${it.arrived ? f1(t) + ' s' : 'nicht angekommen'}, max ${f1(vmax)} km/h, festgefahren ${it.stuckCount || 0}×`);
  }
}

console.log(`\n${count - fail}/${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
