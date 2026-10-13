// NULLPUNKT – Online: Waffe einer gefallenen Spielerin aufheben (Nutzer 13.10.2026: auch die Waffen der ersten Stunde
// sollen andere aufheben und bis zum eigenen Tod benutzen können). Host + 1 Client über das lokale Nostr-Relay:
//   • Host ist Spieler der ersten Stunde (nullpunkt:og) mit UR-1 Ursprung in „Gold der ersten Stunde“.
//   • Client Anna (keine erste Stunde) sieht die Waffe gesperrt, der Host stirbt neben ihr → Beute mit Waffe + Gold.
//   • Anna hebt sie auf (F/use): Waffe in der Hand, Gold bleibt; Host erlaubt sie für Annas Puppe (Anti-Cheat).
//   • Anna trifft damit einen Host-Bot → Host bestätigt die Treffer; Host sieht die Waffe in Annas Händen.
//   • Anna stirbt → die aufgehobene Waffe fällt erneut (Host kann sie wieder aufheben); nach dem Einsatz hat Anna
//     wieder ihre eigene Ausrüstung.
// Voraussetzung: Server auf 8765 und node tools/nostr-relay.mjs 7777. Aufruf: node tools/loot-online-test.mjs
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const RELAY = process.env.NP_RELAY || 'ws://127.0.0.1:7777';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0;
let count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);

const browser = await chromium.launch({ args: GL_ARGS });
const errors = {};
async function open(name, og) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  if (og) await ctx.addInitScript(() => { try { localStorage.setItem('nullpunkt:og', JSON.stringify({ og: true })); } catch { /* */ } });
  const p = await ctx.newPage();
  errors[name] = [];
  p.on('pageerror', (e) => { errors[name].push(e.message); console.log(`[${name}] Seitenfehler: ${e.message}`); });
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource|net::ERR_|WebGL|GL_INVALID|AudioContext/i.test(t)) return;
    errors[name].push(t);
    console.log(`[${name}] Konsole: ${t.slice(0, 300)}`);
  });
  await p.goto(`${BASE}spielen.html?quality=low&relays=${encodeURIComponent(RELAY)}`);
  await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 120000 });
  await p.evaluate((n) => {
    const G = window.__game;
    G.settings.set('playerName', n);
    const log = (window.__mp = { kills: [], hits: [] });
    G.events.on('kill', (e) => log.kills.push({ v: e.victim && e.victim.netId, k: e.killer && e.killer.netId, w: e.weaponId }));
    G.events.on('actor:hit', (e) => log.hits.push({ t: e.target && e.target.netId, a: e.attacker && e.attacker.netId, w: e.weaponId || null }));
  }, name);
  return p;
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
async function until(p, fn, arg, timeout = 60000, every = 500) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}

/** Seite p: Spieler (oder Puppe id) stirbt neben dem Akteur near (Netz-Id) – Host teleportiert/tötet. */
const placeNear = (host, mover, near, dist) => ev(host, ([m, n, d]) => {
  const G = window.__game;
  const T = G.THREE;
  const a = m === 'self' ? G.player : G.net.actorById(m);
  const b = n === 'self' ? G.player : G.net.actorById(n);
  if (!a || !b) return null;
  for (let k = 0; k < 16; k++) {
    const ang = b.yaw + (k * Math.PI) / 8;
    const pos = new T.Vector3(b.position.x - Math.sin(ang) * d, b.position.y, b.position.z - Math.cos(ang) * d);
    const e1 = b.getEyePosition(new T.Vector3());
    if (G.world.lineOfSight(e1, pos.clone().setY(pos.y + 0.5))) { a.body.teleport(pos); return [pos.x, pos.y, pos.z]; }
  }
  return null;
}, [mover, near, dist]);

try {
  const host = await open('Hosti', true);
  const anna = await open('Anna', false);
  // Host: UR-1 Ursprung + Gold als Ausrüstung (Lobby-Auswahl wie per Klick)
  const prep = await ev(host, () => {
    const G = window.__game;
    const P = G.profile;
    P.equipCosmetic('weapon', 'ar_ursprung', 'og');
    const lobby = G.menus && G.menus.lobby;
    if (lobby && lobby.cfg) { lobby.cfg.primary = 'ar_ursprung'; lobby.cfg.secondary = 'pi_funke'; }
    G.settings.set('lastLoadout', { primary: 'ar_ursprung', secondary: 'pi_funke', cls: 'sturm' });
    const lo = G.net._localLoadout();
    return { og: !!P.get().og, unlocked: P.isUnlocked('ar_ursprung'), lo };
  });
  check(prep.og && prep.unlocked && prep.lo && prep.lo.primary === 'ar_ursprung', `Host ist erste Stunde, Ausrüstung ${prep.lo && prep.lo.primary} / ${prep.lo && JSON.stringify(prep.lo.camo || {})}`);
  const annaLocked = await ev(anna, () => !window.__game.profile.isUnlocked('ar_ursprung') && !window.__game.profile.get().og);
  check(annaLocked, 'Anna: keine erste Stunde, UR-1 Ursprung gesperrt');

  const code = await ev(host, () => window.__game.net.host({
    name: 'Beute-Test', mode: 'tdm', map: 'hafen', maxPlayers: 2, teamSize: 2, pvp: 'pvp', botFill: true, difficulty: 'rekrut',
    weather: 'standard', time: 'standard', style: 'arcade',
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
  check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
  let j = await ev(anna, (c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id, team: r.team }), (e) => ({ ok: false, code: e.code })), code);
  if (!j.ok) { info(`Beitritt ${j.code} – zweiter Versuch`); j = await ev(anna, (c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id, team: r.team }), (e) => ({ ok: false, code: e.code })), code); }
  check(j.ok, `Anna tritt bei (id ${j.id}, Team ${j.team})`);
  const A = j.id;
  await until(host, () => window.__game.net.roster.length === 2, null, 15000);
  const cfg = await ev(host, () => { const c = window.__game.net.startMatch(); return c && { mode: c.modeId, map: c.mapId, lo: c.loadout }; });
  check(!!cfg, `Host startet TDM/Hafen`);
  const playing = await Promise.all([host, anna].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 600000, 1000)));
  check(playing.every(Boolean), 'beide im Match');
  if (!playing.every(Boolean)) throw new Error('Match nicht erreicht');
  const H = await ev(host, () => window.__game.net.selfId);

  const hostGun = await ev(host, () => {
    const G = window.__game;
    const w = G.player.weapon;
    const i = w.slots.findIndex((s) => s.id === 'ar_ursprung');
    if (i >= 0 && i !== w.index) w.switchTo(i);
    return { slots: w.slots.map((s) => s.id), camo: G.player.loadout && G.player.loadout.camo };
  });
  check(hostGun.slots.includes('ar_ursprung'), `Host trägt ${hostGun.slots.join(', ')} (Tarnung ${JSON.stringify(hostGun.camo || {})})`);
  const seenLo = await until(anna, (h) => { const a = window.__game.net.actorById(h); return a && a.loadout && a.loadout.primary === 'ar_ursprung' && { camo: a.loadout.camo || null }; }, H, 30000);
  check(!!seenLo && seenLo.camo && seenLo.camo.ar_ursprung === 'og', `Anna kennt die Ausrüstung des Hosts (UR-1, Tarnung ${seenLo && JSON.stringify(seenLo.camo)})`);
  await until(host, () => window.__game.player.weapon.currentDef.id === 'ar_ursprung', null, 15000);

  // ================================================================ Host fällt neben Anna
  const at = await placeNear(host, 'self', A, 1.2);
  check(!!at, 'Host steht 1,2 m neben Anna');
  await until(anna, ([h, p]) => { const a = window.__game.net.actorById(h); return a && Math.hypot(a.position.x - p[0], a.position.z - p[2]) < 0.6; }, [H, at], 30000, 1000);
  await ev(host, () => { const G = window.__game; G.player.godMode = false; G.combat.damage(G.player, { amount: 9999 }); });
  check(!!(await until(host, () => !window.__game.player.alive, null, 10000)), 'Host stirbt');
  const loot = await until(anna, () => { const l = (window.__game.points.loot || []).find((x) => x.weapon === 'ar_ursprung'); return l && { camo: l.camo, att: l.att, pos: [l.position.x, l.position.y, l.position.z] }; }, null, 30000);
  check(!!loot, `Anna: Beute UR-1 Ursprung liegt (Tarnung ${loot && loot.camo}, Aufsätze ${loot && JSON.stringify(loot.att)})`);
  check(!!loot && loot.camo === 'og', 'liegende Waffe behält Gold der ersten Stunde');

  // ================================================================ Anna hebt auf
  const near = await until(anna, () => { const n = window.__game.points.near; return n && n.loot && n.loot.weapon === 'ar_ursprung' && n.text; }, null, 30000);
  check(!!near, `Anna: Hinweis „${near}“`);
  const took = await ev(anna, () => {
    const G = window.__game;
    const ok = G.points.near && G.points.near.loot ? G.points.use() : false;
    const w = G.player.weapon;
    return { ok, slots: w.slots.map((s) => s.id), cur: w.currentDef && w.currentDef.id, pick: w._pickups && w._pickups.ar_ursprung };
  });
  check(took.ok && took.slots.includes('ar_ursprung'), `Anna hebt auf: ${took.slots.join(', ')}`);
  await until(anna, () => window.__game.player.weapon.currentDef.id === 'ar_ursprung', null, 15000);
  check(!!took.pick && took.pick.camo === 'og', `Anna: Gold bleibt an der aufgehobenen Waffe (${took.pick && took.pick.camo})`);
  const allowed = await until(host, (a) => { const p = window.__game.net.actorById(a); return p && p._lootWeapons && p._lootWeapons.has('ar_ursprung'); }, A, 20000);
  check(!!allowed, 'Host erlaubt UR-1 Ursprung für Annas Puppe (Anti-Cheat)');

  // ================================================================ Anna schießt damit
  const target = await ev(host, (aId) => {
    const G = window.__game;
    const T = G.THREE;
    const a = G.net.actorById(aId);
    const list = G.bots.bots.filter((b) => !b.isRemoteHuman && G.combat.isHostile(a, b));
    const bot = list.find((b) => b.alive) || list[0];
    if (!a || !bot) return null;
    if (!bot.alive) G.spawnActor(bot);
    G.bots.setPuppet(bot, true);
    const eye = a.getEyePosition(new T.Vector3());
    for (let k = 0; k < 16; k++) {
      const ang = a.yaw + (k * Math.PI) / 8;
      const pos = new T.Vector3(a.position.x - Math.sin(ang) * 7, a.position.y, a.position.z - Math.cos(ang) * 7);
      if (G.world.lineOfSight(eye, pos.clone().setY(pos.y + 1.2)) && G.world.lineOfSight(eye, pos.clone().setY(pos.y + 0.4))) {
        bot.body.teleport(pos); bot.health = bot.maxHealth; bot.godMode = false;
        return { id: bot.netId, pos: [pos.x, pos.y, pos.z] };
      }
    }
    return null;
  }, A);
  check(!!target, 'Ziel-Bot vor Anna gestellt');
  await until(anna, ([id, tp]) => { const a = window.__game.net.actorById(id); return a && a.alive && Math.hypot(a.position.x - tp[0], a.position.z - tp[2]) < 0.6; }, [target.id, target.pos], 30000, 1000);
  const fired = await ev(anna, async (id) => {
    const G = window.__game;
    const T = G.THREE;
    const p = G.player;
    const def = p.weapon.currentDef;
    let hits = 0;
    for (let i = 0; i < 10; i++) {
      const tgt = G.net.actorById(id);
      if (!tgt || !tgt.alive) break;
      const eye = p.getEyePosition(new T.Vector3());
      const dir = tgt.position.clone().setY(tgt.position.y + 1.25).sub(eye).normalize();
      G.debugApi.lookAt(eye.x + dir.x, eye.y + dir.y, eye.z + dir.z);
      p._shotSerial = (p._shotSerial || 0) + 1;
      const r = G.combat.fireHitscan({ shooter: p, origin: eye, dir, range: def.range, weapon: def });
      if (r && r.hit === 'actor') hits++;
      await new Promise((res) => setTimeout(res, 250));
    }
    return { hits, weapon: def.id };
  }, target.id);
  check(fired.weapon === 'ar_ursprung' && fired.hits >= 3, `Anna trifft lokal ${fired.hits}× mit ${fired.weapon}`);
  const hostHits = await until(host, ([t, a]) => { const n = window.__mp.hits.filter((h) => h.t === t && h.a === a).length; return n >= 3 && n; }, [target.id, A], 20000);
  check(!!hostHits, `Host bestätigt ${hostHits || 0} Treffer von Anna mit der aufgehobenen Waffe`);
  const killW = await ev(host, ([t, a]) => (window.__mp.kills.find((k) => k.v === t && k.k === a) || {}).w || null, [target.id, A]);
  if (killW) check(killW === 'ar_ursprung', `Abschuss mit Waffe ${killW}`);

  // ================================================================ Host sieht die Waffe bei Anna
  // Spielzeit läuft unter SwiftShader-Last sehr langsam: Host direkt wieder einsetzen (Respawn ist nicht Gegenstand)
  await ev(host, () => { const G = window.__game; if (!G.player.alive) G.spawnActor(G.player); });
  check(!!(await until(host, () => window.__game.player.alive, null, 30000, 1000)), 'Host wieder im Einsatz');
  const seenGun = await until(host, (a) => { const p = window.__game.net.actorById(a); const id = p && p.weapon && p.weapon.currentDef && p.weapon.currentDef.id; return id === 'ar_ursprung' && id; }, A, 20000);
  check(!!seenGun, `Host sieht UR-1 Ursprung in Annas Händen (${seenGun})`);
  const carry = await ev(host, (a) => { const p = window.__game.net.actorById(a); return p && p._carry ? p._carry.ar_ursprung || null : null; }, A);
  check(!!carry && carry.camo === 'og', `Host zeigt die Waffe bei Anna in Gold (${carry && carry.camo})`);
  const hostLoot = await ev(host, (h) => (window.__game.points.loot || []).filter((x) => x.netId === h && x.weapon === 'ar_ursprung').length, H);
  check(hostLoot === 0, 'aufgehobene Waffe liegt beim Host nicht mehr am Boden (nicht doppelt aufhebbar)');

  // ================================================================ Anna fällt → Waffe fällt wieder, eigene Ausrüstung danach
  await ev(host, () => { window.__game.player.godMode = true; }); // Bots sollen den Host hier nicht erwischen
  const at2 = await placeNear(host, 'self', A, 1.2);
  check(!!at2, 'Host steht wieder neben Anna');
  await sleep(1500);
  await ev(host, (a) => { const G = window.__game; G.mode.respawnDelay = 0.4; const p = G.net.actorById(a); if (p) { p.godMode = false; G.combat.damage(p, { amount: 9999 }); } }, A);
  check(!!(await until(anna, () => !window.__game.player.alive, null, 15000)), 'Anna stirbt');
  const loot2 = await until(host, () => { const l = (window.__game.points.loot || []).find((x) => x.weapon === 'ar_ursprung'); return l && { camo: l.camo }; }, null, 20000);
  check(!!loot2, `Host: UR-1 Ursprung liegt wieder (Tarnung ${loot2 && loot2.camo})`);
  if (loot2) check(loot2.camo === 'og', 'auch beim zweiten Fallen bleibt das Gold');
  let near2 = await until(host, () => { const n = window.__game.points.near; return n && n.loot && n.loot.weapon === 'ar_ursprung' && n.text; }, null, 8000);
  if (!near2) {
    // Waffe ist vom Körper weggefallen: hingehen (Host darf sich frei setzen) – geprüft wird das Aufheben, nicht der Fall
    const d = await ev(host, () => {
      const G = window.__game;
      const l = G.points.loot.find((x) => x.weapon === 'ar_ursprung');
      const P = G.player;
      const dist = l ? Math.hypot(l.position.x - P.position.x, l.position.z - P.position.z) : null;
      if (l) P.body.teleport(l.position.clone().setY(l.position.y + 0.05));
      return { dist, dy: l ? l.position.y - P.position.y : null, pt: G.points.near && (G.points.near.point ? 'Kartenpunkt' : Object.keys(G.points.near).join('/')) };
    });
    info(`Host war ${d.dist && d.dist.toFixed(2)} m (Höhe ${d.dy && d.dy.toFixed(2)}) von der Waffe entfernt, nah: ${d.pt} – hingestellt`);
    near2 = await until(host, () => { const n = window.__game.points.near; return n && n.loot && n.loot.weapon === 'ar_ursprung' && n.text; }, null, 15000);
    if (!near2) info(`Zustand Host: ${JSON.stringify(await ev(host, () => { const G = window.__game; const P = G.player; const l = G.points.loot.find((x) => x.weapon === 'ar_ursprung'); return { alive: P.alive, st: G.match.state, veh: !!P.vehicle, mounted: !!P.mounted, now: G.time.elapsed, until: l && l.until, d: l && Math.hypot(l.position.x - P.position.x, l.position.z - P.position.z), dy: l && l.position.y - P.position.y, near: G.points.near, pts: G.points.points.map((q) => Math.hypot(q.position.x - P.position.x, q.position.z - P.position.z)).sort((a, b) => a - b)[0] }; }))}`);
  }
  if (near2) {
    const took2 = await ev(host, () => { const G = window.__game; G.points.use(); return G.player.weapon.slots.map((s) => s.id); });
    check(took2.includes('ar_ursprung'), `Host hebt sie wieder auf: ${took2.join(', ')}`);
  } else check(false, 'Host steht nicht nah genug an der Waffe');
  await ev(host, (a) => { const G = window.__game; const p = G.net.actorById(a); if (p && !p.alive) G.spawnActor(p); }, A);
  const back = await until(anna, () => window.__game.player.alive && window.__game.player.weapon.slots.map((s) => s.id), null, 120000, 1000);
  check(!!back && !back.includes('ar_ursprung'), `Anna nach dem Tod wieder mit eigener Ausrüstung (aufgehobene Waffe gilt bis zum Tod): ${back && back.join(', ')}`);

  for (const [n, e] of Object.entries(errors)) check(e.length === 0, `${n}: keine Seitenfehler${e.length ? ` (${e.slice(0, 2).join(' | ')})` : ''}`);
} catch (err) {
  console.log(`ABBRUCH: ${err.message}`);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfungen fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
