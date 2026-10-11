// NULLPUNKT – Klassen (Nutzer 11.10.): Waffen je Klasse getrennt, neue Klasse „Besatzung“ (MP, Pistole, Splitter- und
// Rauchgranate, Fernglas 6× markiert, Notreparatur, schneller Sitzwechsel), Pionier trägt den Klappspaten als eigene
// Waffe (Mausrad) und gräbt tiefer als 2,4 m. Aufruf: node tools/class-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? r() : setTimeout(f, 50)); f(); }); }, s);
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
async function match(url) {
  const p = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&allies=0&enemies=0&quality=low&${url}`);
  let ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player && G.player.alive); }).catch(() => false); if (!ok) await sleep(1000); }
  return { p, ok };
}
try {
  // 1) Daten: Waffenklassen je Klasse
  const C = await import('../assets/js/shared/classes.data.js');
  check(C.classAllows('sturm', 'ar') && !C.classAllows('sturm', 'sniper') && !C.classAllows('aufklaerer', 'ar') && C.classAllows('aufklaerer', 'sniper')
    && C.classAllows('pionier', 'lmg') && !C.classAllows('sanitaeter', 'lmg') && C.classAllows('besatzung', 'smg') && !C.classAllows('besatzung', 'ar'), 'Waffen je Klasse getrennt');
  check(C.SOLDIER_CLASS_ORDER.includes('besatzung') && C.CLASSES.besatzung.gadget === 'fernglas', 'Klasse Besatzung mit Fernglas');
  // 2) Besatzung im Match
  let { p, ok } = await match('mode=tdm&map=hafen&cls=besatzung');
  check(ok, 'Hafen als Besatzung');
  let r = await p.evaluate(() => {
    const G = window.__game, P = G.player, w = P.weapon;
    return { cls: P.classDef && P.classDef.id, prim: w.slots[0].def.cls, sec: w.slots[1] && w.slots[1].def.cls, lethal: w.equipment.lethal.id, tac: w.equipment.tactical.id, gadget: P.gadget && P.gadget.id, ab: P.ability && P.ability.id };
  });
  check(r.cls === 'besatzung' && r.prim === 'smg' && r.sec === 'pistol', `Besatzung: ${r.prim} + ${r.sec}`);
  check(r.lethal === 'frag' && r.tac === 'smoke' && r.gadget === 'fernglas' && r.ab === 'notreparatur', `Splitter ${r.lethal}, Rauch ${r.tac}, ${r.gadget}, ${r.ab}`);
  await p.evaluate(() => { const G = window.__game; G.input.allowUnlockedMouse = true; const o = G.input.down.bind(G.input); G.input.down = (a) => (a === 'gadget' ? true : o(a)); });
  await gameWait(p, 0.6);
  r = await p.evaluate(() => { const G = window.__game, P = G.player; const el = document.getElementById('np-bino'); return { on: !!P.binoOn, fov: P.camera.fov, base: P.baseFov, overlay: !!(el && el.style.display !== 'none') }; });
  check(r.on && r.overlay && r.fov < r.base / 3, `Fernglas: ${r.fov.toFixed(1)}° statt ${r.base.toFixed(1)}°, Maske sichtbar`);
  await p.screenshot({ path: 'tools/out/class-fernglas.png' });
  await p.evaluate(() => { delete window.__game.input.down; });
  await gameWait(p, 0.4);
  r = await p.evaluate(() => ({ on: !!window.__game.player.binoOn, fov: window.__game.player.camera.fov }));
  check(!r.on, 'Fernglas weg nach Loslassen');
  await p.close();
  // 3) Pionier: Spaten als dritte Waffe, Graben tiefer als 2,4 m
  ({ p, ok } = await match('mode=tdm&map=niemandsland&cls=pionier&vehicles=0'));
  check(ok, 'Niemandsland als Pionier');
  r = await p.evaluate(() => { const w = window.__game.player.weapon; return w.slots.map((s) => s.id); });
  check(r.includes('spaten') && r.length >= 2, `Waffen per Mausrad: ${r.join(', ')}`);
  r = await p.evaluate(async () => {
    const G = window.__game, P = G.player, w = P.weapon, T = G.THREE;
    const i = w.slots.findIndex((s) => s.id === 'spaten');
    w.switchTo(i);
    const t0 = G.time.elapsed; while (G.time.elapsed < t0 + 1.2) await new Promise((res) => setTimeout(res, 50));
    const x = P.position.x + 1.3, z = P.position.z;
    const h0 = G.world.terrain.heightfield.heightAt(x, z);
    for (let k = 0; k < 14; k++) G.digging.apply(x, z);
    const h1 = G.world.terrain.heightfield.heightAt(x, z);
    return { cur: w.currentDef.id, depth: h0 - h1 };
  });
  check(r.cur === 'spaten', `Spaten in der Hand (${r.cur})`);
  check(r.depth > 3.5, `Graben tiefer als 2,4 m: ${r.depth.toFixed(2)} m`);
  await p.screenshot({ path: 'tools/out/class-spaten.png' });
  await p.close();
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
