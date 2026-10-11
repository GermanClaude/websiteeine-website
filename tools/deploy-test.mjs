// NULLPUNKT – Einsatzkarte auf großen Karten (Bibliothek, TDM): nach dem Tod öffnet die Draufsicht mit Basis und
// Verbündeten; Auswahl eines Kameraden setzt dich knapp hinter ihm ein. Aufruf: node tools/deploy-test.mjs (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? r() : setTimeout(f, 50)); f(); }); }, s);
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 560 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=bibliothek&allies=3&enemies=3&diff=rekrut&quality=low`);
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Bibliothek TDM läuft');
  const r = await p.evaluate(() => {
    const G = window.__game, P = G.player;
    G.input.allowUnlockedMouse = true;
    for (const a of G.actors) if (a.isBot) { a._upd = a.update; a.update = () => {}; }
    const foes = G.actors.filter((a) => a.team !== P.team);
    // Gegner weit weg (Kameraden gelten als sicher)
    foes.forEach((f, i) => { f.body.teleport(new G.THREE.Vector3(-30 + i * 2, 0.1, -24)); f.position.copy(f.body.position); });
    const ally = G.actors.find((a) => a.isBot && a.team === P.team);
    ally.body.teleport(new G.THREE.Vector3(0, 0.1, 17.5)); ally.position.copy(ally.body.position); ally.lastDamageTime = -100;
    window.__ally = ally;
    G.combat.damage(P, { amount: 999, attacker: foes[0], weaponId: 'ar_m17', zone: 'body', point: P.position.clone(), distance: 10 });
    return { deployMap: !!G.mode.deployMap, dead: !P.alive };
  });
  check(r.deployMap && r.dead, 'Einsatzkarte aktiv, Spieler gefallen');
  await gameWait(p, 1.6);
  const r2 = await p.evaluate(() => {
    const G = window.__game, root = document.querySelector('.dp-root');
    const pts = G.mode.deployPoints(G.player);
    if (G.hud && G.hud.deploy) G.hud.deploy.interacted = true; // kein automatischer Einsatz während des Bildschirmfotos
    return { open: !!(root && !root.hidden), hq: pts.some((x) => x.kind === 'hq'), allies: pts.filter((x) => x.kind === 'squad').length, safe: pts.filter((x) => x.kind === 'squad' && x.available).length };
  });
  check(r2.open && r2.hq && r2.allies >= 3 && r2.safe >= 1, `Draufsicht offen: Basis + ${r2.allies} Kameraden (${r2.safe} verfügbar)`);
  await p.screenshot({ path: 'tools/out/deploy-bibliothek.png' }).catch(() => {});
  const r3 = await p.evaluate(async () => {
    const G = window.__game, a = window.__ally;
    const was = { alive: G.player.alive, open: !!(G.hud && G.hud.deploy && G.hud.deploy.isOpen), hud: !!G.hud, left: G.mode.respawnLeft(G.player) };
    G.mode.setDeploy({ kind: 'squad', id: a.id });
    const ds = G.hud && G.hud.deploy;
    if (ds && ds.isOpen) { ds.sel = { kind: 'squad', id: a.id }; ds._go(true); } else G.mode.deployNow(G.player); // „Einsatz“ (verzichtet auf den Sanitäter)
    await new Promise((r) => { const t = G.time.elapsed + 8; const f = () => (G.player.alive || G.time.elapsed > t ? r() : setTimeout(f, 50)); f(); });
    return { alive: G.player.alive, d: G.player.position.distanceTo(a.position), was };
  });
  check(!r3.was.alive && r3.was.open, `Einsatzkarte wartet (Sanitäter in der Nähe: ${r3.was.left.toFixed(0)} s)`);
  check(r3.alive && r3.d < 3, `beim Kameraden eingesetzt (Abstand ${r3.d.toFixed(1)} m)`);
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
