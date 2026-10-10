// Online „Infiziert“ und „Waffenspiel“ (Host + 1 Client über das lokale Relay, normaler Weg über net.host/join).
//   inf: genau ein Infizierter zu Beginn; Team und Zufallswaffe des Clients stimmen mit seiner Puppe beim Host überein;
//        ein Überlebender fällt durch einen Infizierten → Team B beim Host und beim Client, HUD-Meldung beim Client,
//        nach dem Wiedereinstieg Messer (wenn es der Client selbst war); keine Anti-Cheat-Verstöße.
//   gun: beide starten mit Stufe 1; Abschuss der Puppe beim Host → Client wechselt auf die Waffe der Stufe 2
//        (gun:promote), Punktetabelle zeigt Stufe 2; Host erlaubt Nachbarstufen (netWeaponsOf); keine Verstöße.
// Aufruf: node tools/modes-online-test.mjs [--only=inf,gun]   (Server NP_BASE, Relay node tools/nostr-relay.mjs 7777)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const ONLY = opt.only ? String(opt.only).split(',') : ['inf', 'gun'];
const RELAY = process.env.NP_RELAY || 'ws://localhost:7777';
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const info = (t) => console.log(`${ts()}      ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(p, fn, arg, ms = 60000, every = 500) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(every);
  }
}

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });

async function session(modeId, run) {
  info(`— ${modeId} —`);
  const ctxs = [];
  const errors = [];
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
  try {
    const host = await open('Host');
    const cl = await open('Client');
    const code = await host.evaluate((m) => window.__game.net.host({ name: 'Modi', mode: m, map: 'werk', maxPlayers: 4, teamSize: 3, pvp: 'pvp', botFill: true, difficulty: 'rekrut', weather: 'standard', time: 'standard', style: 'arcade' }).then((r) => r.code, (e) => 'FEHLER:' + e.code), modeId);
    const mode = await host.evaluate(() => window.__game.net.room && window.__game.net.room.settings.mode);
    if (!check(/^[A-Z2-9]{6}$/.test(code) && mode === modeId, `Raum ${code}, Modus ${mode}`)) return;
    let j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Bert' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
    if (!j.ok) { info(`Beitritt ${j.code} – zweiter Versuch`); j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Bert' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code); }
    if (!check(j.ok, `Client tritt bei (${j.id || j.code})`)) return;
    await until(host, () => window.__game.net.roster.length === 2, null, 20000);
    await host.evaluate(() => window.__game.net.startMatch());
    const ok = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.mode && window.__game.mode.started && window.__game.mode.id, null, 900000, 1000)));
    if (!check(ok.every((m) => m === modeId), `Host + Client im Match (${ok.join(', ')})`)) return;
    await sleep(3000); // Identitäten/Modus-Zustand nach dem Start
    await cl.evaluate(() => {
      const G = window.__game;
      const C = (window.__mt = { infects: 0, promotes: 0 });
      G.events.on('infect', () => { C.infects++; });
      G.events.on('gun:promote', (e) => { if (e && e.actor === G.player) C.promotes++; });
    });
    await run(host, cl, j.id);
    const ac = await host.evaluate((id) => { const a = window.__game.net.anticheat; return a ? a.log.filter((e) => e.peer === id).map((e) => e.reason) : []; }, j.id);
    check(!ac.length, `Anti-Cheat des Hosts: keine Verstöße des Clients (${ac.join(', ') || 'keine'})`);
    check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
  }
}

async function infected(host, cl, cid) {
  const st = await host.evaluate((id) => {
    const G = window.__game;
    const pup = G.actors.find((a) => a.netId === id);
    return { nB: G.actors.filter((a) => a.team === 'B').length, nA: G.actors.filter((a) => a.team === 'A').length, team: pup && pup.team, lo: pup && pup.loadout && pup.loadout.primary };
  }, cid);
  check(st.nB === 1 && st.nA >= 2, `Host: genau ein Infizierter zu Beginn (A ${st.nA}, B ${st.nB})`);
  const same = await until(cl, (want) => { const p = window.__game.player; const w = p.weapon && p.weapon.currentDef; return p.team === want.team && (want.team === 'B' ? w && w.id === 'knife' : p.loadout && p.loadout.primary === want.lo) && { team: p.team, w: w && w.id }; }, st, 20000);
  check(!!same, `Client: Team ${same ? same.team : '?'} und Waffe ${same ? same.w : '?'} wie die Puppe beim Host (${st.team}, ${st.lo})`);
  // Ein Überlebender fällt durch einen Infizierten (bevorzugt der Client selbst)
  const kill = await host.evaluate((id) => {
    const G = window.__game;
    const zero = G.actors.find((a) => a.team === 'B' && a.alive);
    const pup = G.actors.find((a) => a.netId === id);
    const victim = pup && pup.team === 'A' && pup.alive ? pup : G.actors.find((a) => a.team === 'A' && a.alive && a !== G.player && Number.isInteger(a.netId));
    if (!zero || !victim) return null;
    G.combat.damage(victim, { amount: 9999, attacker: zero, weaponId: 'knife', zone: 'body', point: victim.position.clone(), distance: 1 });
    return { netId: victim.netId, self: victim === pup, team: victim.team, name: victim.name };
  }, cid);
  if (!check(!!kill && kill.team === 'B', `Host: ${kill ? kill.name : '?'} infiziert (Team ${kill ? kill.team : '?'})`)) return;
  const seen = await until(cl, (k) => {
    const G = window.__game;
    const a = k.self ? G.player : G.actors.find((x) => x.netId === k.netId);
    return a && a.team === 'B' && window.__mt.infects >= 1 && { infects: window.__mt.infects };
  }, kill, 20000);
  check(!!seen, `Client: Teamwechsel übernommen, HUD-Meldung (${seen ? seen.infects : 0})`);
  if (kill.self) {
    const knife = await until(cl, () => { const p = window.__game.player; const w = p.weapon && p.weapon.currentDef; return p.alive && w && w.id === 'knife' && w.id; }, null, 400000, 1000); // SwiftShader: Spielzeit läuft langsam
    if (!check(knife === 'knife', `Client: nach dem Wiedereinstieg als Infizierter mit Messer (${knife})`)) {
      const dc = await cl.evaluate(() => { const G = window.__game; const p = G.player; return { alive: p.alive, team: p.team, w: p.weapon && p.weapon.currentDef && p.weapon.currentDef.id, lo: p.loadout, at: p.respawnAt, now: G.time.elapsed, hold: G.match.respawnHold, st: G.match.state }; });
      const dh = await host.evaluate((id) => { const G = window.__game; const a = G.actors.find((x) => x.netId === id); return a && { alive: a.alive, team: a.team, at: a.respawnAt, now: G.time.elapsed, lo: a.loadout }; }, cid);
      info(`Diagnose Client ${JSON.stringify(dc)}`);
      info(`Diagnose Host-Puppe ${JSON.stringify(dh)}`);
    }
  }
}

async function gungame(host, cl, cid) {
  const steps = await host.evaluate(() => window.__game.mode.steps.slice(0, 3));
  const start = await until(cl, (s0) => { const w = window.__game.player.weapon.currentDef; return w && w.id === s0 && w.id; }, steps[0], 20000);
  check(start === steps[0], `Client: Stufe 1 mit ${start} (${steps[0]})`);
  const kill = await host.evaluate((id) => {
    const G = window.__game;
    const pup = G.actors.find((a) => a.netId === id);
    const victim = G.actors.find((a) => a !== pup && a !== G.player && a.alive && a.isBot && !a.isRemoteHuman);
    if (!pup || !victim) return null;
    G.combat.damage(victim, { amount: 9999, attacker: pup, weaponId: G.mode.weaponFor(G.mode.levelOf(pup)), zone: 'body', point: victim.position.clone(), distance: 5 });
    return { level: G.mode.levelOf(pup), allow: G.mode.netWeaponsOf(pup), lo: pup.loadout && pup.loadout.primary };
  }, cid);
  if (!check(!!kill && kill.level === 1, `Host: Abschuss der Puppe → Stufe ${kill ? kill.level + 1 : '?'} (${kill && kill.lo})`)) return;
  check(steps.every((s) => kill.allow.includes(s)), `Host: Anti-Cheat erlaubt Nachbarstufen (${kill.allow.join(', ')})`);
  const up = await until(cl, (s1) => { const G = window.__game; const w = G.player.weapon.currentDef; return w && w.id === s1 && window.__mt.promotes >= 1 && { w: w.id, row: G.mode.scoreboard().find((r) => r.isPlayer).extra.value }; }, steps[1], 20000);
  check(!!up && up.row === 2, `Client: Waffe der Stufe 2 (${up ? up.w : '?'}), HUD-Meldung, Punktetabelle Stufe ${up ? up.row : '?'}`);
}

try {
  if (ONLY.includes('inf')) await session('inf', infected);
  if (ONLY.includes('gun')) await session('gun', gungame);
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
