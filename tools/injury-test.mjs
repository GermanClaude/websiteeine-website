// NULLPUNKT – Verletzungen: Armtreffer (Waffe zittert), Beintreffer (humpeln), Blutung (verliert Leben), Verband (Taste N)
// stillt alles, Sanitäter belebt einen gefallenen Teamkameraden mit F wieder (Werk, offline).
// Aufruf: node tools/injury-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? r() : setTimeout(f, 50)); f(); }); }, s);

const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=werk&allies=2&enemies=2&diff=rekrut&quality=low&cls=sanitaeter`);
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive && G.injuries); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Match läuft, Verletzungssystem aktiv');
  // Bots einfrieren, Spieler ist Sanitäter
  await p.evaluate(() => { const G = window.__game; G.input.allowUnlockedMouse = true; for (const a of G.actors) if (a.isBot) { a._upd = a.update; a.update = () => {}; } const P = G.player; P.cls = 'sanitaeter'; P.applyClass(); });
  // Armtreffer + Blutung (Zufall erzwingen)
  const r1 = await p.evaluate(() => {
    const G = window.__game, P = G.player, T = G.THREE;
    const foe = G.actors.find((a) => a.team !== P.team);
    const rnd = Math.random; Math.random = () => 0.01;
    G.combat.damage(P, { amount: 20, attacker: foe, weaponId: 'ar_m17', zone: 'limb', point: P.position.clone().add(new T.Vector3(0, 1.3, 0)), distance: 10 });
    G.combat.damage(P, { amount: 18, attacker: foe, weaponId: 'ar_m17', zone: 'limb', point: P.position.clone().add(new T.Vector3(0, 0.5, 0)), distance: 10 });
    Math.random = rnd;
    const j = P.injury;
    return { arm: !!(j && j.arm), leg: !!(j && j.leg), bleed: j ? j.bleed : 0, hp: P.health };
  });
  check(r1.arm && r1.leg && r1.bleed > 0, `Arm + Bein getroffen, Blutung ${r1.bleed}/s (Leben ${r1.hp.toFixed(0)})`);
  await gameWait(p, 3);
  const hp2 = await p.evaluate(() => window.__game.player.health);
  check(hp2 < r1.hp - 3, `Blutung kostet Leben (${r1.hp.toFixed(0)} → ${hp2.toFixed(0)})`);
  // Verband mit N
  await p.keyboard.press('KeyN');
  await gameWait(p, 2.6);
  const r3 = await p.evaluate(() => { const j = window.__game.player.injury; return j ? { arm: j.arm, leg: j.leg, bleed: j.bleed, b: j.bandages } : null; });
  check(r3 && !r3.arm && !r3.leg && !(r3.bleed > 0) && r3.b === 1, `Verband: alles versorgt (${JSON.stringify(r3)})`);
  // Wiederbeleben: verbündeter Bot fällt neben dem Sanitäter
  const r4 = await p.evaluate(() => {
    const G = window.__game, P = G.player;
    const ally = G.actors.find((a) => a.isBot && a.team === P.team && a.alive);
    const foe = G.actors.find((a) => a.team !== P.team);
    const pos = P.position.clone().add(new G.THREE.Vector3(1.2, 0, 0));
    ally.body.teleport(pos); ally.position.copy(ally.body.position);
    G.combat.damage(ally, { amount: 999, attacker: foe, weaponId: 'ar_m17', zone: 'body', point: ally.position.clone(), distance: 10 });
    window.__ally = ally;
    return { dead: !ally.alive, near: !!G.injuries.near, respawnIn: ally.respawnAt - G.time.elapsed };
  });
  await gameWait(p, 0.3);
  const near = await p.evaluate(() => !!window.__game.injuries.near);
  check(r4.dead && near && r4.respawnIn > 5, `Kamerad gefallen, „Wiederbeleben“ angeboten (Respawn wartet ${r4.respawnIn.toFixed(1)} s)`);
  await p.keyboard.press('KeyF');
  await gameWait(p, 2.5);
  const r5 = await p.evaluate(() => { const a = window.__ally; return { alive: a.alive, hp: a.health, d: a.position.distanceTo(window.__game.player.position) }; });
  check(r5.alive && r5.hp <= 60 && r5.d < 3, `wiederbelebt an Ort und Stelle (Leben ${r5.hp}, Abstand ${r5.d.toFixed(1)} m)`);
  // Sanitäter-Bot belebt den Spieler
  const r6 = await p.evaluate(() => {
    const G = window.__game, P = G.player;
    const medic = window.__ally; medic.cls = 'sanitaeter'; if (medic.applyClass) medic.applyClass();
    if (!medic.gadget || medic.gadget.id !== 'medkit') medic.gadget = { id: 'medkit', charges: 3, cooldownUntil: 0 };
    const foe = G.actors.find((a) => a.team !== P.team);
    G.combat.damage(P, { amount: 999, attacker: foe, weaponId: 'ar_m17', zone: 'body', point: P.position.clone(), distance: 10 });
    const d = G.injuries.down.get(P);
    return { dead: !P.alive, medic: !!(d && d.medic), respawnIn: P.respawnAt - G.time.elapsed, gad: medic.gadget && medic.gadget.id, ma: medic.alive, team: medic.team === P.team, dist: medic.position.distanceTo(P.position) };
  });
  await gameWait(p, 3);
  const r7 = await p.evaluate(() => { const P = window.__game.player; return { alive: P.alive, hp: P.health }; });
  check(r6.dead && r7.alive && r7.hp <= 60, `Sanitäter-Bot hat den Spieler wiederbelebt (Leben ${r7.hp})`);
  await p.screenshot({ path: 'tools/out/injury.png' }).catch(() => {});
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
