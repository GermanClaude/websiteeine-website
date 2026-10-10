// NULLPUNKT – Klassen-Fähigkeiten (Taste J, classes.data.js ABILITIES) in Headless-Chromium (spielen.html, SwiftShader).
//   Offline (TDM, Werk): Sturm „Kampfrausch“ (Nachlade-/Rückstoßfaktor aktiv, endet nach 8 s), Sanitäter „Regeneration“
//   (Leben steigen trotz frischem Schaden), Pionier „Nachschub“ (Reserve und Granaten voll), Aufklärer „Aufklärungspuls“
//   (Gegner im Umkreis markiert, Minikarte), Abklingzeit (zweiter Einsatz abgelehnt, HUD-Meldung), Taste J löst aus.
//   Online (--online, Host + 1 Client über das lokale Relay): Sanitäter-Client setzt Regeneration ein → Leben der Puppe
//   steigen beim Host; keine Anti-Cheat-Verstöße.
// Aufruf: node tools/ability-test.mjs [--online]   (Server NP_BASE; online zusätzlich node tools/nostr-relay.mjs 7777)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const RELAY = process.env.NP_RELAY || 'ws://localhost:7777';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const info = (t) => console.log(`${ts()}      ${t}`);
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
// Spielzeit abwarten (SwiftShader: Spielzeit läuft langsamer als die Echtzeit)
// Wartezeiten mit Zeitraffer ×4 (SwiftShader: oft unter 2 Bildern/s, je Bild höchstens 0,05 s Spielzeit)
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; G.timeScale = 4; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? (G.timeScale = 1, r()) : setTimeout(f, 50)); f(); }); }, s);
const setClass = (p, cls) => p.evaluate((c) => { const P = window.__game.player; P.cls = c; P.applyClass(); P.abilityReadyAt = 0; return P.ability && P.ability.id; }, cls);

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errors = [];

async function offline() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=werk&allies=2&enemies=4&diff=rekrut&quality=low`);
  const ok = await until(p, () => { const G = window.__game; return G && G.match && G.match.state === 'playing' && G.player.alive; }, null, 400000, 1000);
  if (!check(!!ok, 'Match läuft')) return;
  await p.evaluate(() => {
    const G = window.__game;
    G.player.godMode = true;
    G.input.allowUnlockedMouse = true;
    window.__ab = { notices: [] };
    for (const e of ['ability:use', 'ability:denied', 'ability:ready']) G.events.on(e, (x) => window.__ab.notices.push(e + ':' + x.id));
  });

  // Sturm: Kampfrausch
  check(await setClass(p, 'sturm') === 'kampfrausch', 'Sturm hat Kampfrausch');
  const rush = await p.evaluate(() => { const G = window.__game; const P = G.player; const ok = P.useAbility(); const w = P.weapon; return { ok, reload: w._rush('rushReload'), recoil: w._rush('rushRecoil'), left: P.rushUntil - G.time.elapsed }; });
  check(rush.ok && Math.abs(rush.reload - 1.45) < 1e-6 && Math.abs(rush.recoil - 0.65) < 1e-6 && rush.left > 7, `Kampfrausch aktiv (Nachladen ×${rush.reload}, Rückstoß ×${rush.recoil}, ${rush.left.toFixed(1)} s)`);
  const again = await p.evaluate(() => window.__game.player.useAbility());
  check(!again, 'zweiter Einsatz während der Abklingzeit abgelehnt');
  await gameWait(p, 8.3);
  const after = await p.evaluate(() => window.__game.player.weapon._rush('rushReload'));
  check(after === 1, `Kampfrausch endet (Faktor ${after})`);

  // Sanitäter: Regeneration (frischer Schaden blockiert die normale Regeneration)
  check(await setClass(p, 'sanitaeter') === 'regeneration', 'Sanitäter hat Regeneration');
  const h0 = await p.evaluate(() => { const G = window.__game; const P = G.player; P.godMode = false; P.health = 30; P.lastDamageTime = G.time.elapsed + 30; P.useAbility(); return P.health; });
  await gameWait(p, 2);
  const h1 = await p.evaluate(() => { const P = window.__game.player; const h = P.health; P.godMode = true; return h; });
  check(h1 - h0 >= 18, `Leben steigen: ${h0.toFixed(0)} → ${h1.toFixed(0)} in 2 s`);

  // Pionier: Nachschub
  check(await setClass(p, 'pionier') === 'nachschub', 'Pionier hat Nachschub');
  const sup = await p.evaluate(() => {
    const P = window.__game.player;
    const w = P.weapon;
    for (const st of w.slots) if (st && st.def && st.def.reserve > 0) st.reserve = 0;
    if (w.equipment.lethal.id) w.equipment.lethal.count = 0;
    P.useAbility();
    return { res: w.slots.filter((s) => s && s.def && s.def.reserve > 0).map((s) => `${s.reserve}/${s.def.reserve}`), full: w.slots.every((s) => !s || !s.def || !(s.def.reserve > 0) || s.reserve === s.def.reserve), nade: w.equipment.lethal.count };
  });
  check(sup.full && sup.nade > 0, `Reserve voll (${sup.res.join(', ')}), Granaten ${sup.nade}`);

  // Aufklärer: Aufklärungspuls – Gegner in 60 m vor den Spieler stellen
  check(await setClass(p, 'aufklaerer') === 'aufklaerungspuls', 'Aufklärer hat Aufklärungspuls');
  const pulse = await p.evaluate(() => {
    const G = window.__game;
    const P = G.player;
    const foes = G.actors.filter((a) => a.alive && a !== P && G.combat.isHostile(P, a));
    foes[0].position.set(P.position.x + 20, P.position.y, P.position.z);
    const ok = P.useAbility();
    const marked = foes.filter((a) => a.spottedUntil > G.time.elapsed && a.spottedBy === P.team).length;
    return { ok, marked, near: foes.filter((a) => a.position.distanceTo(P.position) <= 90).length };
  });
  check(pulse.ok && pulse.marked >= 1 && pulse.marked === pulse.near, `Aufklärungspuls markiert ${pulse.marked} von ${pulse.near} Gegnern in 90 m`);

  // Taste J (Eingabe-Aktion 'faehigkeit')
  await setClass(p, 'sturm');
  await p.mouse.click(400, 225).catch(() => {});
  await p.keyboard.down('KeyJ');
  await gameWait(p, 0.3);
  await p.keyboard.up('KeyJ');
  const key = await p.evaluate(() => { const G = window.__game; return G.player.rushUntil > G.time.elapsed; });
  check(key, 'Taste J löst die Fähigkeit aus');
  const notices = await p.evaluate(() => [...document.querySelectorAll('.h-notice')].map((n) => n.textContent));
  info(`HUD: ${notices.join(' | ')}`);
  check(notices.some((t) => /Kampfrausch/.test(t)), 'HUD-Meldung zur Fähigkeit');

  // Kartenpunkte (mappoints.js): Werk hat 7 (je Startbereich Munition + Sanität, Sirene, 2× Leitstand)
  const pts = await p.evaluate(() => { const G = window.__game; return G.points ? G.points.points.map((q) => `${q.kind}@${q.position.x.toFixed(0)},${q.position.y.toFixed(1)},${q.position.z.toFixed(0)}`) : null; });
  check(pts && pts.length === 7 && pts.some((t) => t.startsWith('sirene')), `Werk: ${pts ? pts.length : 0} Kartenpunkte (${pts ? pts.join(' ') : '–'})`);
  const goTo = (kind) => p.evaluate((k) => {
    const G = window.__game;
    const q = G.points.points.find((x) => x.kind === k);
    G.player.position.set(q.position.x + 0.8, q.position.y + 0.05, q.position.z);
    if (G.player.body && G.player.body.position) G.player.body.position.copy(G.player.position);
    return q.i;
  }, kind);
  await goTo('munition');
  const near = await until(p, () => { const G = window.__game; const b = document.querySelector('.ht-prompt'); return G.points.near && b && !b.hidden && b.textContent; }, null, 30000);
  check(!!near && /Munitionskiste/.test(near), `HUD-Aufforderung am Punkt (${near})`);
  await p.evaluate(() => { const w = window.__game.player.weapon; for (const st of w.slots) if (st && st.def && st.def.reserve > 0) st.reserve = 0; });
  await p.keyboard.down('KeyF');
  await gameWait(p, 0.3);
  await p.keyboard.up('KeyF');
  const ammo = await p.evaluate(() => window.__game.player.weapon.slots.filter((s) => s && s.def && s.def.reserve > 0).every((s) => s.reserve === s.def.reserve));
  check(ammo, 'Taste F an der Munitionskiste füllt die Reserve auf');
  await goTo('sirene');
  const mark = await until(p, () => {
    const G = window.__game;
    if (!G.points.near || G.points.near.point.kind !== 'sirene') return null;
    const P = G.player;
    const foe = G.actors.find((a) => a.alive && a !== P && G.combat.isHostile(P, a));
    foe.position.set(P.position.x + 10, P.position.y, P.position.z);
    G.points.use();
    return { marked: foe.spottedUntil > G.time.elapsed && foe.spottedBy === P.team, left: G.points.near.left };
  }, null, 30000);
  check(!!mark && mark.marked, `Werkssirene markiert einen Gegner in 10 m (${JSON.stringify(mark)})`);
  await p.screenshot({ path: 'tools/out/kartenpunkt-werk.png' }).catch(() => {});
  await ctx.close();
}

async function online() {
  const ctxs = [];
  try {
    const open = async (name) => {
      const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
      ctxs.push(ctx);
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      await p.goto(`${BASE}spielen.html?relays=${encodeURIComponent(RELAY)}&quality=low`);
      await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 300000 });
      await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
      return p;
    };
    const host = await open('Host');
    const cl = await open('Client');
    const code = await host.evaluate(() => window.__game.net.host({ name: 'Faehig', mode: 'tdm', map: 'werk', maxPlayers: 4, teamSize: 3, pvp: 'pvp', botFill: true, difficulty: 'rekrut', weather: 'standard', time: 'standard', style: 'arcade' }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
    const j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Bert' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
    if (!check(j.ok, `Client tritt bei (${j.id || j.code})`)) return;
    await until(host, () => window.__game.net.roster.length === 2, null, 20000);
    await host.evaluate(() => window.__game.net.startMatch());
    const ok = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 900000, 1000)));
    if (!check(ok.every(Boolean), 'Host + Client im Match')) return;
    await sleep(3000);
    await Promise.all([host, cl].map((p) => p.evaluate(() => { window.__game.input.allowUnlockedMouse = true; })));
    // Puppe beim Host auf Sanitäter stellen (wie nach einem Ausrüstungswechsel), Client ebenso
    await host.evaluate((id) => { const pup = window.__game.actors.find((a) => a.netId === id); pup.cls = 'sanitaeter'; pup.health = 30; pup.lastDamageTime = 1e9; }, j.id);
    await setClass(cl, 'sanitaeter');
    const h0 = await host.evaluate((id) => window.__game.actors.find((a) => a.netId === id).health, j.id);
    await cl.evaluate(() => window.__game.player.useAbility());
    const up = await until(host, (a) => { const pup = window.__game.actors.find((x) => x.netId === a.id); return pup.health >= a.h0 + 20 && pup.health; }, { id: j.id, h0 }, 30000, 300);
    check(!!up, `Host: Leben der Puppe ${h0.toFixed(0)} → ${up ? up.toFixed(0) : '?'} (Regeneration)`);
    const ac = await host.evaluate((id) => { const a = window.__game.net.anticheat; return a ? a.log.filter((e) => e.peer === id).map((e) => e.reason) : []; }, j.id);
    check(!ac.length, `Anti-Cheat: keine Verstöße (${ac.join(', ') || 'keine'})`);
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
  }
}

try {
  await offline();
  if (opt.online) await online();
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
