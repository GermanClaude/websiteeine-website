// NULLPUNKT – Graben (Niemandsland): Klappspaten-Hieb in den Erdboden hebt Erde aus (Höhenfeld, Bodenhöhe, Geländekachel),
// höchstens 2,4 m tief; der Spieler steht danach tiefer. Aufruf: node tools/dig-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? r() : setTimeout(f, 50)); f(); }); }, s);
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=niemandsland&allies=0&enemies=0&quality=low`);
  let ok = false;
  for (let i = 0; i < 600 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive && G.digging); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Niemandsland geladen, Graben aktiv');
  // Spieler ins Niemandsland, Klappspaten als Nahkampfwaffe, Blick schräg nach unten
  const r0 = await p.evaluate(() => {
    const G = window.__game, P = G.player, T = G.THREE;
    G.input.allowUnlockedMouse = true;
    const x = -30, z = 60, y = G.world.groundHeight(x, z, 40);
    P.body.teleport(new T.Vector3(x, y + 0.1, z)); P.yaw = 0; P.pitch = -0.75;
    P.weapon.setLoadout({ ...(P.loadout || {}), melee: 'spaten' });
    return { y, melee: P.weapon.meleeId };
  });
  check(r0.melee === 'spaten', `Klappspaten ausgerüstet (${r0.melee})`);
  const before = await p.evaluate(() => { const G = window.__game, P = G.player; const fwd = { x: P.position.x, z: P.position.z - 1.2 }; window.__dig = fwd; return G.world.groundHeight(fwd.x, fwd.z, 40); });
  for (let i = 0; i < 8; i++) { await p.evaluate(() => window.__game.player.weapon.melee()); await gameWait(p, 0.8); }
  const r1 = await p.evaluate(() => { const G = window.__game, d = window.__dig; return { n: G.digging.count, after: G.world.groundHeight(d.x, d.z, 40) }; });
  check(r1.n >= 4, `${r1.n} Spatenhiebe haben gegraben`);
  check(r1.after < before - 1.0, `Boden vor dem Spieler tiefer: ${before.toFixed(2)} → ${r1.after.toFixed(2)} m`);
  // Höchsttiefe 2,4 m
  const r2 = await p.evaluate(() => { const G = window.__game, d = window.__dig; for (let i = 0; i < 20; i++) G.digging.apply(d.x, d.z); return G.world.groundHeight(d.x, d.z, 40); });
  check(r2 >= before - 2.45 && r2 <= before - 2.0, `höchstens 2,4 m tief (${(before - r2).toFixed(2)} m)`);
  // hineinlaufen: Spieler steht im Loch tiefer
  await p.evaluate(() => { const G = window.__game, P = G.player, d = window.__dig; P.body.teleport(new G.THREE.Vector3(d.x, G.world.groundHeight(d.x, d.z, 40) + 1.5, d.z)); });
  await gameWait(p, 1.2);
  const r3 = await p.evaluate(() => window.__game.player.body.position.y);
  check(r3 < before - 1.6, `Spieler steht im Loch (y ${r3.toFixed(2)})`);
  await p.evaluate(() => { const P = window.__game.player; P.pitch = 0.1; });
  await sleep(1500);
  await p.screenshot({ path: 'tools/out/dig.png' }).catch(() => {});
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
