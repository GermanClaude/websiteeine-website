// NULLPUNKT – TDM Ultimate (Runden, ein Leben), Messerwerte und durchlöcherte Wände in Headless-Chromium.
//   Ultimate (Werk, 2 gegen 3): Runde 1 läuft, gefallene Gegner kommen nicht zurück, alle Gegner tot → Runde an A
//   (Punkt = Rundensieg), nach der Pause Runde 2 mit allen wieder am Leben.
//   Messer: Standardmesser braucht zwei Stiche (60 Schaden), von hinten einer; Machete trifft im Bogen mehrere.
//   Wand: Pistolenbeschuss auf eine Stelle Beton erzeugt erst nach vielen Treffern ein Loch, danach geht die Kugel durch.
// Aufruf: node tools/ult-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
async function until(p, fn, arg, ms = 60000, every = 300) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(every);
  }
}
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; G.timeScale = 4; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? (G.timeScale = 1, r()) : setTimeout(f, 50)); f(); }); }, s);

const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=ult&map=werk&allies=1&enemies=3&diff=rekrut&quality=low`);
  const ok = await until(p, () => { const G = window.__game; return G && G.match && G.match.state === 'playing' && G.player.alive && G.mode && G.mode.started && G.mode.id; }, null, 400000, 1000);
  check(ok === 'ult', `TDM Ultimate läuft (${ok})`);
  await p.evaluate(() => { const G = window.__game; G.player.godMode = true; G.input.allowUnlockedMouse = true; });
  // Messer: zwei Stiche
  const kn = await p.evaluate(() => {
    const G = window.__game;
    const W = G.data.WEAPONS;
    return { knife: W.knife.damage.max, karambit: W.karambit.damage.max, machete: W.machete.damage.max, cleave: !!W.machete.melee.cleave, tomahawk: W.tomahawk.melee.lungeRange };
  });
  check(kn.knife * 2 >= 100 && kn.knife < 100 && kn.machete >= 100 && kn.cleave && kn.tomahawk > 6, `Messerwerte ${JSON.stringify(kn)}`);
  // Runde 1: alle Gegner fallen
  const r1 = await p.evaluate(() => {
    const G = window.__game;
    const P = G.player;
    const foes = G.actors.filter((a) => a.alive && a.team !== P.team && !a.isStreakEntity);
    for (const f of foes) G.combat.damage(f, { amount: 9999, attacker: P, weaponId: 'ar_m17', zone: 'body', point: f.position.clone(), distance: 5 });
    return { round: G.mode.round, n: foes.length };
  });
  await gameWait(p, 1);
  const end1 = await p.evaluate(() => { const G = window.__game; return { phase: G.mode.phase, A: G.mode.scores.A, B: G.mode.scores.B, dead: G.actors.filter((a) => a.team !== G.player.team && !a.alive).length }; });
  check(r1.round === 1 && end1.phase === 'pause' && end1.A === 1 && end1.dead === r1.n, `Runde 1 an Team A (Phase ${end1.phase}, Stand ${end1.A}:${end1.B}, Gegner tot ${end1.dead}/${r1.n})`);
  await gameWait(p, 5.5);
  const r2 = await p.evaluate(() => { const G = window.__game; return { round: G.mode.round, phase: G.mode.phase, alive: G.actors.filter((a) => a.alive).length, all: G.actors.length }; });
  check(r2.round === 2 && r2.phase === 'kampf' && r2.alive === r2.all, `Runde 2: alle wieder da (${r2.alive}/${r2.all})`);
  // Wand durchlöchern: Pistole auf eine Stelle Beton (nahe Wand suchen)
  const wall = await p.evaluate(() => {
    const G = window.__game;
    const T = G.THREE;
    const P = G.player;
    const o = P.getEyePosition(new T.Vector3());
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dir = new T.Vector3(Math.sin(a), 0, Math.cos(a));
      const h = G.world.raycast(o, dir, 30);
      if (h && h.surface === 'concrete' && !h.solid) {
        const W = G.data.WEAPONS.pi_p9;
        let shots = 0;
        while (!G.holes.at(h.point) && shots < 400) { G.combat.fireHitscan({ shooter: P, origin: o, dir, range: 60, weapon: W }); shots++; }
        const hole = G.holes.at(h.point);
        const exit = hole ? G.combat._penetrate(G.world.raycast(o, dir, 30), dir, W.penetration, W) : null;
        return { shots, hole: !!hole, holes: G.holes.holes.length, exit: !!exit, d: h.distance };
      }
    }
    return null;
  });
  if (check(!!wall, 'Betonwand in Reichweite gefunden')) {
    check(wall.hole && wall.shots > 25, `Loch nach ${wall.shots} Pistolenschüssen (${wall.holes} Loch/Löcher)`);
    check(wall.exit, 'durch das Loch geht die Pistolenkugel hindurch');
  }
  await p.screenshot({ path: 'tools/out/ultimate.png' }).catch(() => {});
  await ctx.close();
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
