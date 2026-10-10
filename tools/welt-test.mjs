// NULLPUNKT – Wunschpaket 10.10. (2) in Headless-Chromium (spielen.html, SwiftShader):
//   Werk (Realistisch): kein Munitionsgewinn beim Abschuss, Munition und Waffe an der Leiche aufnehmen (mappoints.js
//   Beute); MG-Stellung bedienen (unendlich Munition, Drehbereich 250°, Ausrüstung kommt zurück); Bauen (building.js):
//   Sandsackwall wird fertig, hält Kugeln auf, Explosion zerstört ihn; Pionier darf Bunker/MG-Nest.
//   Altstadt: Türen (doors.js) öffnen/schließen, Durchschuss durch die geschlossene Tür trifft dahinter, Beschuss zerlegt sie.
//   Hafen: drei Rolltore der Lagerhalle mit Schaltpult, Tor fährt.
//   Online (--online): Bauwerk des Clients erscheint beim Host und beim Client.
// Aufruf: node tools/welt-test.mjs [--only=werk,altstadt,hafen,online]   (Server NP_BASE; online Relay 7777)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const ONLY = opt.only ? String(opt.only).split(',') : ['werk', 'altstadt', 'hafen', ...(opt.online ? ['online'] : [])];
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
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; G.timeScale = 4; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? (G.timeScale = 1, r()) : setTimeout(f, 50)); f(); }); }, s);

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errors = [];

async function open(params) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&diff=rekrut&quality=low&${params}`);
  const ok = await until(p, () => { const G = window.__game; return G && G.match && G.match.state === 'playing' && G.player.alive && G.points; }, null, 400000, 1000);
  if (ok) await p.evaluate(() => { const G = window.__game; G.player.godMode = true; G.input.allowUnlockedMouse = true; for (const b of G.bots.bots) { b._upd = b.update; b.update = () => {}; } });
  return { ctx, p, ok };
}

async function werk() {
  const { ctx, p, ok } = await open('mode=tdm&map=werk&allies=1&enemies=3&style=realistisch');
  if (!check(!!ok, 'Werk (Realistisch) läuft')) return ctx.close();
  // Beute
  const kill = await p.evaluate(() => {
    const G = window.__game;
    const P = G.player;
    const w = P.weapon;
    for (const st of w.slots) if (st && st.def && st.def.reserve > 0) st.reserve = 0;
    const foe = G.actors.find((a) => a.alive && a !== P && G.combat.isHostile(P, a));
    foe.position.set(P.position.x + 3, P.position.y, P.position.z);
    const fw = foe.weapon && foe.weapon.currentDef && foe.weapon.currentDef.id;
    G.combat.damage(foe, { amount: 9999, attacker: P, weaponId: w.currentDef.id, zone: 'body', point: foe.position.clone(), distance: 3 });
    return { res: w.slots.map((s) => s.reserve), loot: G.points.loot.map((l) => ({ ammo: l.ammo, weapon: l.weapon })), fw, style: G.match.style };
  });
  check(kill.style === 'realistisch' && kill.res.every((r) => r === 0), `Realistisch: kein Munitionsgewinn beim Abschuss (Reserve ${kill.res.join('/')})`);
  check(kill.loot.length === 1 && kill.loot[0].ammo && !!kill.loot[0].weapon, `Beute an der Leiche: ${JSON.stringify(kill.loot)}`);
  await p.evaluate(() => { const G = window.__game; const l = G.points.loot[0]; G.player.position.set(l.position.x + 0.5, l.position.y + 0.05, l.position.z); });
  const nearL = await until(p, () => { const G = window.__game; return G.points.near && G.points.near.loot && G.points.near.text; }, null, 30000);
  check(!!nearL, `Aufforderung an der Leiche (${nearL})`);
  const took = await p.evaluate(() => { const G = window.__game; G.points.use(); return G.player.weapon.slots.map((s) => s.reserve); });
  check(took.some((r) => r > 0), `Munition aufgenommen (Reserve ${took.join('/')})`);
  const wl = await until(p, () => { const G = window.__game; return G.points.near && G.points.near.loot && G.points.near.loot.weapon; }, null, 20000);
  const swapped = await p.evaluate((wid) => { const G = window.__game; G.points.use(); return G.player.weapon.slots.map((s) => s.id).includes(wid) && G.player.weapon.slots.map((s) => s.id).join(','); }, wl);
  check(!!swapped, `Waffe von der Leiche aufgehoben (${wl} → ${swapped})`);

  // MG-Stellung
  const em = await p.evaluate(() => { const G = window.__game; const e = (G.world.emplacements || [])[0]; if (!e) return null; G.player.position.set(e.x, e.y + 0.05, e.z); return { n: G.world.emplacements.length, x: e.x, z: e.z }; });
  if (check(!!em, `Werk: ${em ? em.n : 0} MG-Stellung(en)`)) {
    const nm = await until(p, () => { const G = window.__game; return G.points.near && G.points.near.mount && G.points.near.text; }, null, 30000);
    check(!!nm, `Aufforderung „${nm}“`);
    const before = await p.evaluate(() => window.__game.player.weapon.slots.map((s) => `${s.id}:${s.reserve}`).join(','));
    const m = await p.evaluate(() => { const G = window.__game; const ok = G.points.use(); const P = G.player; P.yaw = P.mounted.yaw0 + Math.PI; return { ok, w: P.weapon.currentDef.id, inf: P.weapon.infiniteAmmo }; });
    check(m.ok && m.w === 'lmg_hm60' && m.inf, `MG bedient: ${m.w}, unendlich Munition ${m.inf}`);
    await gameWait(p, 0.3);
    const yaw = await p.evaluate(() => { const P = window.__game.player; let d = P.yaw - P.mounted.yaw0; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) * 180 / Math.PI; });
    check(yaw <= 125.5, `Drehbereich begrenzt (${yaw.toFixed(1)}° ≤ 125°)`);
    const after = await p.evaluate(() => { const G = window.__game; G.points.unmount(); return { m: !!G.player.mounted, w: G.player.weapon.slots.map((s) => `${s.id}:${s.reserve}`).join(',') }; });
    check(!after.m && after.w === before, `MG verlassen, Ausrüstung zurück (${after.w})`);
  }

  // Bauen
  const kinds = await p.evaluate(() => { const G = window.__game; const P = G.player; const a = G.building.kindsFor(P).join(','); P.cls = 'pionier'; P.applyClass(); const b = G.building.kindsFor(P).join(','); P.cls = 'sturm'; P.applyClass(); return { a, b }; });
  check(kinds.a === 'sandsack,mulde' && kinds.b === 'sandsack,mulde,mgnest,bunker', `Baubar: Sturm ${kinds.a} · Pionier ${kinds.b}`);
  const placed = await p.evaluate(() => {
    const G = window.__game;
    const P = G.player;
    const s0 = G.mode.spawns ? null : null;
    const sp = (G.world.spawns.A || G.world.spawns.ffa || [])[0];
    P.position.set(sp.position ? sp.position.x : sp.x, sp.position ? sp.position.y : 0.05, sp.position ? sp.position.z : sp.z);
    P.yaw = 0;
    G.building.open('sandsack');
    return true;
  });
  await gameWait(p, 0.2);
  const put = await p.evaluate(() => { const G = window.__game; const m = G.building.mode; const ok = m && m.ok; const r = G.building.place(); return { ok, r, n: G.building.list.length }; });
  if (check(put.r && put.n === 1, `Sandsackwall gesetzt (Vorschau grün ${put.ok})`)) {
    await gameWait(p, 3.5);
    const shot = await p.evaluate(() => {
      const G = window.__game;
      const s = G.building.list[0];
      const T = G.THREE;
      const dir = new T.Vector3(Math.sin(s.ry), 0, Math.cos(s.ry));
      const o = new T.Vector3(s.x - dir.x * 6, s.y + 0.5, s.z - dir.z * 6);
      const h = G.world.raycast(o, dir, 20);
      return { done: s.done, hit: h && h.structure === s.id, d: h && h.distance };
    });
    check(shot.done && shot.hit, `Wall fertig und hält Kugeln auf (Treffer in ${shot.d && shot.d.toFixed(2)} m)`);
    const gone = await p.evaluate(() => { const G = window.__game; const s = G.building.list[0]; G.events.emit('explosion', { position: new G.THREE.Vector3(s.x, s.y + 0.5, s.z), radius: 5, type: 'frag' }); return G.building.list.length; });
    check(gone === 0, 'Explosion zerstört den Wall');
  }
  await ctx.close();
}

async function altstadt() {
  const { ctx, p, ok } = await open('mode=tdm&map=altstadt&allies=1&enemies=2');
  if (!check(!!ok, 'Altstadt läuft')) return ctx.close();
  const d = await p.evaluate(() => { const G = window.__game; const items = G.doors.items.filter((x) => x.type === 'door'); const i = G.doors.items.findIndex((x) => x.type === 'door' && x.target === 0); return { n: items.length, i }; });
  if (!check(d.n > 0 && d.i >= 0, `Altstadt: ${d.n} bewegliche Türen`)) return ctx.close();
  // Durchschuss: Bot hinter die geschlossene Tür, Schuss von vorn
  const pen = await p.evaluate(async (i) => {
    const G = window.__game;
    const T = G.THREE;
    const it = G.doors.items[i];
    const dd = it.d;
    const mid = new T.Vector3(dd.hx + dd.dc[0] * dd.w / 2, dd.y + 1.2, dd.hz + dd.dc[1] * dd.w / 2);
    const n = new T.Vector3(dd.dopen[0], 0, dd.dopen[1]); // nach innen
    const foe = G.actors.find((a) => a.alive && a !== G.player && G.combat.isHostile(G.player, a));
    // Bot wieder rechnen lassen (Trefferzonen folgen der Lage erst im eigenen Update), drei Bilder lang festhalten
    if (foe._upd) foe.update = foe._upd;
    const at = new T.Vector3(mid.x + n.x * 1.5, dd.y, mid.z + n.z * 1.5);
    await new Promise((r) => { let k = 0; const f = () => { foe.position.copy(at); if (++k >= 4) r(); else requestAnimationFrame(f); }; f(); });
    const o = mid.clone().addScaledVector(n, -4);
    const dir = mid.clone().sub(o).normalize();
    const W = G.data.WEAPONS.ar_kv47;
    const first = G.world.raycast(o, dir, 10);
    const r = G.combat.fireHitscan({ shooter: G.player, origin: o, dir, range: 50, weapon: W });
    return { door: first && first.solid === it.solid, hit: r.hit, pen: r.penetrated, hp: it.hp };
  }, d.i);
  check(pen.door, `Strahl trifft die geschlossene Tür (Leben ${pen.hp})`);
  check(pen.hit === 'actor' && pen.pen, `Durchschuss: Treffer hinter der Tür (${pen.hit}, durchschlagen ${pen.pen})`);
  // Öffnen / Schließen
  await p.evaluate((i) => window.__game.doors.act(i, 't', null), d.i);
  await gameWait(p, 0.8);
  const op = await p.evaluate((i) => window.__game.doors.items[i].t, d.i);
  check(op === 1, `Tür geöffnet (t ${op})`);
  await p.evaluate((i) => window.__game.doors.act(i, 't', null), d.i);
  await gameWait(p, 0.8);
  // Beschuss zerlegt die Tür
  const br = await p.evaluate((i) => {
    const G = window.__game;
    const T = G.THREE;
    const it = G.doors.items[i];
    const dd = it.d;
    const mid = new T.Vector3(dd.hx + dd.dc[0] * dd.w / 2, dd.y + 1.0, dd.hz + dd.dc[1] * dd.w / 2);
    const n = new T.Vector3(dd.dopen[0], 0, dd.dopen[1]);
    const o = mid.clone().addScaledVector(n, -3);
    const dir = mid.clone().sub(o).normalize();
    for (let k = 0; k < 12 && !it.broken; k++) G.combat.fireHitscan({ shooter: G.player, origin: o, dir, range: 50, weapon: G.data.WEAPONS.sr_brecher });
    const h = G.world.raycast(o, dir, 10);
    return { broken: it.broken, free: !h || h.solid !== it.solid };
  }, d.i);
  check(br.broken && br.free, `Beschuss zerlegt die Tür (zerbrochen ${br.broken}, Weg frei ${br.free})`);
  await ctx.close();
}

async function hafen() {
  const { ctx, p, ok } = await open('mode=tdm&map=hafen&allies=1&enemies=2');
  if (!check(!!ok, 'Hafen läuft')) return ctx.close();
  const g = await p.evaluate(() => { const G = window.__game; const gs = G.doors.items.map((x, i) => [x, i]).filter(([x]) => x.type === 'gate'); return { n: gs.length, i: gs.length ? gs[0][1] : -1, b: gs.length ? gs[0][0].bottom : null }; });
  if (!check(g.n === 3, `Lagerhalle: ${g.n} Rolltore mit Schaltpult`)) return ctx.close();
  await p.evaluate((i) => { const G = window.__game; const it = G.doors.items[i]; const [px, pz] = it.d.panels[0]; G.player.position.set(px + 0.3, 0.1, pz); }, g.i);
  const near = await until(p, () => { const G = window.__game; return G.doors.near && G.doors.near.text; }, null, 20000);
  check(!!near && /Tor/.test(near), `Aufforderung am Schaltpult („${near}“)`);
  await p.evaluate((i) => window.__game.doors.request(i, 't'), g.i);
  await gameWait(p, 3.6);
  const b1 = await p.evaluate((i) => window.__game.doors.items[i].bottom, g.i);
  check(Math.abs(b1 - g.b) > 1, `Tor fährt (Unterkante ${g.b.toFixed(2)} → ${b1.toFixed(2)} m)`);
  await ctx.close();
}

async function online() {
  const ctxs = [];
  try {
    const mk = async (name) => {
      const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
      ctxs.push(ctx);
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      await p.goto(`${BASE}spielen.html?relays=${encodeURIComponent(RELAY)}&quality=low`);
      await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 300000 });
      await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
      return p;
    };
    const host = await mk('Host');
    const cl = await mk('Client');
    const code = await host.evaluate(() => window.__game.net.host({ name: 'Bau', mode: 'tdm', map: 'werk', maxPlayers: 4, teamSize: 2, pvp: 'pvp', botFill: true, difficulty: 'rekrut', weather: 'standard', time: 'standard', style: 'arcade', timeLimit: 1200 }).then((r) => r.code));
    const j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Bert' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
    if (!check(j.ok, `Client tritt bei (${j.id || j.code})`)) return;
    await until(host, () => window.__game.net.roster.length === 2, null, 20000);
    const tl = await host.evaluate(() => window.__game.net.room.settings.timeLimit);
    check(tl === 1200, `Raum-Einstellung Rundendauer 20 min (${tl} s)`);
    await host.evaluate(() => window.__game.net.startMatch());
    const ok = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.building, null, 900000, 1000)));
    if (!check(ok.every(Boolean), 'Host + Client im Match')) return;
    const limit = await host.evaluate(() => { const m = window.__game.mode; return m.timeLimit ?? m.opts?.timeLimit ?? m.time ?? null; });
    info(`Zeitlimit des Modus beim Host: ${limit}`);
    await cl.evaluate(() => { const G = window.__game; G.input.allowUnlockedMouse = true; G.building.open('sandsack'); });
    await sleep(1500);
    const put = await cl.evaluate(() => { const G = window.__game; const ok = G.building.mode && G.building.mode.ok; G.building.place(); return ok; });
    const seen = await Promise.all([host, cl].map((p) => until(p, () => window.__game.building.list.length === 1 && window.__game.building.list[0].k, null, 30000)));
    check(seen.every((k) => k === 'sandsack'), `Bauwerk des Clients beim Host und Client (${seen.join(', ')}; Vorschau ${put})`);
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
  }
}

try {
  if (ONLY.includes('werk')) await werk();
  if (ONLY.includes('altstadt')) await altstadt();
  if (ONLY.includes('hafen')) await hafen();
  if (ONLY.includes('online')) await online();
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
