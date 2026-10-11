// NULLPUNKT – Panzergenerationen (Nutzer 11.10.): Niemandsland stellt mit „Panzer-Generation: Karte“ den 1.-WK-Panzer
// auf, ?panzer=wk2 tauscht die Kampfpanzer einer Karte gegen den 2.-WK-Panzer; Besatzung/Waffen je Generation;
// Lobby zeigt die Auswahl. Aufruf: node tools/tank-era-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
async function match(url) {
  const p = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&allies=0&enemies=0&quality=low&${url}`);
  let ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.vehicles && G.vehicles.list && G.vehicles.list.length); }).catch(() => false); if (!ok) await sleep(1000); }
  return { p, ok };
}
try {
  // 1) Niemandsland, Generation „Karte“ → 1. Weltkrieg
  let { p, ok } = await match('mode=tdm&map=niemandsland');
  check(ok, 'Niemandsland geladen, Fahrzeuge da');
  let r = await p.evaluate(() => {
    const V = window.__game.vehicles;
    const tanks = V.list.filter((v) => v.def.drive === 'tracked');
    const v = tanks.find((x) => x.type === 'wk1'), l = tanks.find((x) => x.type === 'wk1l');
    return { n: tanks.length, types: [...new Set(tanks.map((x) => `${x.type}:${x.spawnTeam}`))].sort(), seats: v ? v.seats.map((s) => s.def.id) : [], gun: v ? v.seats[1].weapons[0].def.name : '', mech: v ? v.seats.some((s) => s.def.mechanic) : false, limits: v && v.def.turretLimits,
      light: l ? { seats: l.seats.length, gun: l.seats[1].weapons[0].def.name, limits: l.def.turretLimits || null, auto: l.seats.some((s) => s.def.loader) } : null };
  });
  check(r.n >= 4 && r.types.join() === 'wk1:B,wk1l:A', `Niemandsland: ${r.n} Panzer, je Team eigenes Vorbild (${r.types.join(', ')})`);
  check(r.light && r.light.seats === 2 && /37 mm/.test(r.light.gun) && !r.light.limits && !r.light.auto, `1. WK Team A: leichter Drehturm-Panzer, 2 Mann, ${r.light ? r.light.gun : '?'}`);
  check(r.seats.length === 6 && r.mech, `1. WK: 6 Mann (${r.seats.join(', ')})`);
  check(/57 mm/.test(r.gun) && Array.isArray(r.limits), `1. WK: ${r.gun}, Schwenkbereich ±${r.limits ? r.limits[1] : '?'}`);
  await p.close();
  // 2) Hafen mit ?panzer=wk2 → Kampfpanzer der Autoaufstellung werden 2.-WK-Panzer, Geländewagen bleiben
  ({ p, ok } = await match('mode=tdm&map=hafen&vehicles=1&panzer=wk2'));
  check(ok, 'Hafen geladen, Fahrzeuge da');
  r = await p.evaluate(() => {
    const G = window.__game, V = G.vehicles;
    const types = V.list.map((v) => v.type);
    const h = V.list.find((x) => x.type === 'wk2h');
    const v = V.list.find((x) => x.type === 'wk2');
    // Spieler als Bug-MG-Schütze: Wanne-MG schwenkt nur ±0,45 rad
    let mg = null;
    if (v) {
      const i = v.seats.findIndex((s) => s.def.mount === 'cmg');
      const s = v.seats[i];
      s.intent.aimDir = new G.THREE.Vector3(1, 0, 0).applyQuaternion(v.body.quat);
      for (let k = 0; k < 300; k++) v._aimSeat(s, 1 / 60);
      mg = { yaw: v.mount.cmgYaw, w: s.weapons[0].def.id };
    }
    return { types, thermal: v ? !!v.def.noThermal : null, mg, seats: v ? v.seats.length : 0, heavy: h ? { team: h.spawnTeam, gun: h.seats[1].weapons[0].def.name, hp: h.maxHealth } : null };
  });
  check(r.types.includes('wk2') && r.types.includes('wk2h') && !r.types.includes('mbt') && r.types.includes('jeep'), `Hafen ?panzer=wk2: ${r.types.join(', ')}`);
  check(r.heavy && r.heavy.team === 'B' && /88 mm/.test(r.heavy.gun), `2. WK Team B: schwerer Panzer (${r.heavy ? r.heavy.gun + ', ' + r.heavy.hp + ' LP' : '?'})`);
  check(r.seats === 5 && r.thermal === true, `2. WK: 5 Mann, kein Wärmebild`);
  check(r.mg && r.mg.w === 'wk2_mg' && Math.abs(r.mg.yaw + 0.45) < 0.02, `Bug-MG im Kugelstand begrenzt (${r.mg ? r.mg.yaw.toFixed(2) : '?'} rad)`);
  await p.close();
  // 3) Lobby: Auswahl „Panzer-Generation“
  const lp = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  lp.on('pageerror', (e) => errors.push(e.message));
  await lp.goto(`${BASE}spielen.html`);
  await lp.waitForFunction(() => document.querySelector('[data-veh]'), null, { timeout: 120000 }).catch(() => null);
  const n = await lp.evaluate(() => document.querySelectorAll('[data-era]').length);
  await lp.evaluate(() => { const b = document.querySelector('[data-era="wk1"]'); if (b) b.click(); });
  await sleep(300);
  const sel = await lp.evaluate(() => { const b = document.querySelector('[data-era="wk1"]'); return b && b.getAttribute('aria-checked'); });
  const saved = await lp.evaluate(() => { try { return JSON.parse(localStorage.getItem('nullpunkt:settings') || '{}').lastTankEra; } catch { return null; } });
  check(n === 4 && sel === 'true', `Lobby: 4 Generationen, „1. WK“ gewählt (${sel}, gespeichert ${saved})`);
  await lp.screenshot({ path: 'tools/out/tank-era-lobby.png' });
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
