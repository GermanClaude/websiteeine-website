// NULLPUNKT – Granatwerfer (Nutzer 11.10.): GW-40 Hammer (Zweitwaffe) und GW-6 Trommel (Hauptwaffe) des Pioniers
// verschießen 40-mm-Granaten im Bogen; Unterlauf-Aufsätze 40-mm-Granatwerfer und Schrotflinte am Sturmgewehr (Taste U).
// Bilder tools/out/launcher-*.png. Aufruf: node tools/launcher-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? r() : setTimeout(f, 50)); f(); }); }, s);
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
async function match(url, att = null) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  if (att) await ctx.addInitScript((a) => { try { localStorage.setItem('nullpunkt.aufsaetze', a); } catch { /* */ } }, JSON.stringify(att));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&allies=0&enemies=0&quality=low&mode=tdm&map=hafen&debug=1&${url}`);
  let ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player && G.player.alive); }).catch(() => false); if (!ok) await sleep(1000); }
  await p.evaluate(() => { const G = window.__game; G.input.allowUnlockedMouse = true; });
  return { p, ok };
}
const press = (p, action) => p.evaluate((a) => { const I = window.__game.input; const o = I.pressed.bind(I); I.pressed = (x) => { if (x !== a) return o(x); I.pressed = o; return true; }; }, action);
const shoot = (p) => p.evaluate(() => { const w = window.__game.player.weapon; w._fireBuffer = 0.2; });
try {
  // 1) Pionier: Trommel (Hauptwaffe) + Hammer (Zweitwaffe)
  let { p, ok } = await match('cls=pionier&primary=gl_trommel&secondary=gl_hammer');
  check(ok, 'Pionier mit Granatwerfern');
  let r = await p.evaluate(() => { const w = window.__game.player.weapon; return w.slots.map((s) => `${s.id}:${s.mag}`); });
  check(r[0] === 'gl_trommel:5' && r[1] === 'gl_hammer:1', `Waffen ${r.join(', ')}`);
  await p.evaluate(() => { const P = window.__game.player; P.pitch = 0.25; });
  await gameWait(p, 0.6);
  await p.screenshot({ path: 'tools/out/launcher-trommel.png' });
  await p.evaluate(() => { const G = window.__game; window.__boom = 0; G.events.on('projectile:impact', () => { window.__boom++; }); });
  await shoot(p);
  await gameWait(p, 0.15);
  r = await p.evaluate(() => { const G = window.__game; const L = G.weapons.projectiles || []; const R = L[0]; return { n: L.length, grenade: !!(R && R.P && R.P.grenade), mag: G.player.weapon.current.mag }; });
  check(r.n >= 1 && r.grenade && r.mag === 4, `Trommel: Granate im Flug (${r.n}), Magazin ${r.mag}`);
  await gameWait(p, 6.5);
  r = await p.evaluate(() => ({ boom: window.__boom, left: (window.__game.weapons.projectiles || []).length }));
  check(r.boom > 0 || r.left === 0, `Granate schlägt ein (${r.boom} Einschlag, ${r.left} noch im Flug)`);
  await p.evaluate(() => window.__game.player.weapon.switchTo(1));
  await gameWait(p, 1.2);
  await p.screenshot({ path: 'tools/out/launcher-hammer.png' });
  await shoot(p);
  await gameWait(p, 0.15);
  r = await p.evaluate(() => { const G = window.__game; return { mag: G.player.weapon.current.mag, id: G.player.weapon.currentDef.id }; });
  check(r.id === 'gl_hammer' && r.mag === 0, `Hammer abgefeuert (${r.id}, ${r.mag})`);
  await p.context().close();
  // 2) Sturm: M-17 mit Unterlauf-Granatwerfer
  ({ p, ok } = await match('primary=ar_m17', { ar_m17: { unterlauf: 'granatwerfer' } }));
  check(ok, 'Sturm mit Unterlauf-Granatwerfer');
  await gameWait(p, 0.5);
  await p.screenshot({ path: 'tools/out/launcher-unterlauf-gl.png' });
  await press(p, 'unterlauf');
  await gameWait(p, 0.3);
  r = await p.evaluate(() => { const w = window.__game.player.weapon; return { on: !!w.underOn, u: w.current.under && `${w.current.under.mag}|${w.current.under.reserve}`, main: w.current.mag }; });
  check(r.on && r.u === '1|3', `Unterlauf an (${r.u})`);
  await shoot(p);
  await gameWait(p, 0.15);
  r = await p.evaluate(() => { const G = window.__game, w = G.player.weapon; const L = G.weapons.projectiles || []; return { n: L.length, u: `${w.current.under.mag}|${w.current.under.reserve}`, main: w.current.mag, hud: (document.querySelector('.h-wname .n') || {}).textContent }; });
  check(r.n >= 1 && r.u.startsWith('0|'), `40-mm-Granate verschossen (${r.u}, Gewehr ${r.main}, „${r.hud}“)`);
  await gameWait(p, 2.6);
  r = await p.evaluate(() => { const w = window.__game.player.weapon; return `${w.current.under.mag}|${w.current.under.reserve}`; });
  check(r === '1|2', `Unterlauf automatisch nachgeladen (${r})`);
  await press(p, 'unterlauf');
  await gameWait(p, 0.3);
  r = await p.evaluate(() => !!window.__game.player.weapon.underOn);
  check(!r, 'zurück auf das Gewehr');
  await p.context().close();
  // 3) Unterlauf-Schrotflinte
  ({ p, ok } = await match('primary=ar_m17', { ar_m17: { unterlauf: 'schrotlauf' } }));
  check(ok, 'Sturm mit Unterlauf-Schrotflinte');
  await press(p, 'unterlauf');
  await gameWait(p, 0.3);
  await p.evaluate(() => { const G = window.__game; window.__pel = 0; G.events.on('weapon:fire', (e) => { if (e.actor === G.player) window.__pel = e.pellets; }); G.player.weapon._fireBuffer = 0.3; });
  await gameWait(p, 0.5);
  r = await p.evaluate(() => { const w = window.__game.player.weapon; return { pel: window.__pel, u: `${w.current.under.mag}|${w.current.under.reserve}`, on: w.underOn }; });
  check(r.pel === 8 && r.u === '3|12', `Schrotschuss mit ${r.pel} Kugeln (${r.u})`);
  await p.screenshot({ path: 'tools/out/launcher-unterlauf-schrot.png' });
  await p.context().close();
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
