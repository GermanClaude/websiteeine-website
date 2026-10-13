// NULLPUNKT – Feuermodi (Nutzer 13.10.2026: „realistische Waffenmodi, je nach Waffe“) in Headless-Chromium (spielen.html):
//   • M-17: Standard Dauerfeuer, Taste „feuermodus“ → Einzelfeuer → Dauerfeuer (Kreis), HUD zeigt die Feuerart
//   • Einzelfeuer: Abzug 1 s gehalten → genau 1 Schuss; Dauerfeuer: Abzug gehalten → mehrere Schüsse
//   • Wahlhebel im Ego-Modell dreht auf EINZEL (π/2) bzw. DAUER (π)
//   • VP-9: Dauer → Feuerstoß (3) → Einzel; Feuerstoß gehalten → genau 3 Schuss
//   • P-9 (nur Einzelfeuer): Taste ändert nichts
// Bildschirmfoto: tools/out/firemode-hud.png. Aufruf: node tools/firemode-test.mjs (Server NP_BASE, Standard :8765)
import { chromium, BASE, GL_ARGS } from './pw.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, text) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
async function until(p, fn, arg, timeout = 60000, every = 400) {
  const t0 = Date.now();
  for (;;) { let v = null; try { v = await p.evaluate(fn, arg); } catch { v = null; } if (v) return v; if (Date.now() - t0 > timeout) return null; await sleep(every); }
}
const b = await chromium.launch({ args: GL_ARGS });
async function match(primary) {
  const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=0&enemies=1&diff=rekrut&primary=${primary}&secondary=pi_p9&quality=low`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.player.weapon, null, 400000, 1000);
  check(!!ok, `${primary}: Match läuft`);
  await p.evaluate((id) => { const G = window.__game; G.debugApi.godMode(true); G.input.allowUnlockedMouse = true; if (G.player.weapon.currentDef.id !== id) G.player.weapon.setLoadout({ primary: id, secondary: 'pi_p9' }); }, primary);
  await gameWait(p, 2.0);   // Ziehen abwarten
  check(await p.evaluate(() => window.__game.player.weapon.currentDef.id) === primary, `${primary} in der Hand`);
  return { p, errs };
}
// Spielzeit statt Wanduhr (SwiftShader rendert langsam): warten, bis die Spielzeit um dt weiter ist
const gameWait = async (p, dt) => { const t0 = await p.evaluate(() => window.__game.time.elapsed); await until(p, (t) => window.__game.time.elapsed >= t, t0 + dt, 120000, 100); };
const tap = async (p, a) => { await p.evaluate((a) => window.__game.input.simulate.tap(a), a); await gameWait(p, 0.15); };
const hold = async (p, ms) => {
  const m0 = await p.evaluate(() => window.__game.player.weapon.current.mag);
  await p.evaluate(() => window.__game.input.simulate.press('fire')); await gameWait(p, ms / 1000);
  await p.evaluate(() => window.__game.input.simulate.release('fire')); await gameWait(p, 0.4);
  const m1 = await p.evaluate(() => window.__game.player.weapon.current.mag);
  return m0 - m1;
};
const state = (p) => p.evaluate(() => { const G = window.__game, w = G.player.weapon; return { mode: w.fireMode, hud: (document.querySelector('.h-wname .m') || {}).textContent, sel: w.viewModel ? w.viewModel._selAng : null, mag: w.current.mag }; });
const refill = (p) => p.evaluate(() => { const w = window.__game.player.weapon; w.current.mag = w.current.def.mag; });

// ---- M-17
{
  const { p, errs } = await match('ar_m17');
  let s = await state(p);
  check(s.mode === 'auto', `M-17 Standard: ${s.mode} (HUD „${s.hud}“)`);
  check(Math.abs((s.sel ?? 0) - Math.PI) < 0.05, `Wahlhebel auf DAUER (${(s.sel ?? NaN).toFixed(2)} rad)`);
  const nAuto = await hold(p, 900);
  check(nAuto >= 5, `Dauerfeuer 0,9 s gehalten: ${nAuto} Schuss`);
  await refill(p);
  await tap(p, 'feuermodus'); await gameWait(p, 0.3);
  s = await state(p);
  check(s.mode === 'semi' && /halb|einzel/i.test(s.hud || ''), `nach Umschalten: ${s.mode} (HUD „${s.hud}“)`);
  check(Math.abs((s.sel ?? 0) - Math.PI / 2) < 0.05, `Wahlhebel auf EINZEL (${(s.sel ?? NaN).toFixed(2)} rad)`);
  const nSemi = await hold(p, 1000);
  check(nSemi === 1, `Einzelfeuer 1 s gehalten: ${nSemi} Schuss`);
  await p.screenshot({ path: 'tools/out/firemode-hud.png' });
  await tap(p, 'feuermodus');
  s = await state(p);
  check(s.mode === 'auto', `nochmal umschalten: ${s.mode}`);
  check(errs.length === 0, `keine Seitenfehler (${errs.slice(0, 2).join(' | ')})`);
  await p.close();
}
// ---- VP-9 (Feuerstoß) und P-9 (nur Einzel)
{
  const { p, errs } = await match('smg_vp9');
  await tap(p, 'feuermodus');
  let s = await state(p);
  check(s.mode === 'burst' && /3/.test(s.hud || ''), `VP-9 Feuerstoß: ${s.mode} (HUD „${s.hud}“)`);
  const nB = await hold(p, 1000);
  check(nB === 3, `Feuerstoß 1 s gehalten: ${nB} Schuss`);
  await tap(p, 'feuermodus');
  s = await state(p);
  check(s.mode === 'semi', `VP-9 weiter: ${s.mode}`);
  await tap(p, 'slot2'); await gameWait(p, 1.2);
  await tap(p, 'feuermodus');
  s = await state(p);
  check(s.mode === 'semi', `P-9 bleibt Einzelfeuer: ${s.mode} (HUD „${s.hud}“)`);
  await tap(p, 'slot1'); await gameWait(p, 1.2);
  s = await state(p);
  check(s.mode === 'semi', `VP-9 merkt sich die Feuerart nach dem Wechsel: ${s.mode}`);
  check(errs.length === 0, `keine Seitenfehler (${errs.slice(0, 2).join(' | ')})`);
  await p.close();
}
await b.close();
console.log(fail ? `${fail} von ${count} Prüfungen fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
