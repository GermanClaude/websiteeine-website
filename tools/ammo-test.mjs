// NULLPUNKT – Munition pro Abschuss (weapons/index.js _killAmmo, WeaponController.grantAmmo, HUD „+30“) in Headless-Chromium
// (spielen.html, SwiftShader).
//   Offline (TDM Hafen, Gottmodus): Abschuss eines Bots über combat.damage mit dem Spieler als Schützen →
//     • Sturmgewehr: Vorrat +1 Magazin (30), Obergrenze reserve + mag greift (Rest bzw. nichts), HUD „+30“ am Zähler
//     • HM-60 Hammer: 20 Schuss direkt in den Gurt, Überschuss in den Vorrat, voll → nichts
//     • Messer-Abschuss → gehaltene Waffe; Abschuss mit der Pistole (Gewehr in der Hand) → Pistole, HUD „+15 P-9 Kompakt“
//     • leeres Magazin + leerer Vorrat: kein automatisches Nachladen; Teamabschuss/Selbstmord: nichts; Einstellung aus: nichts
//     • HUD Realismus: nur „Munition aufgenommen“ ohne Zahl
//   Online (--online, Host + 1 Client über das lokale Relay): Host bestätigt einen Abschuss mit der Puppe des Clients als
//   Schützen → beim Client steigt der Vorrat genau einmal (+30), der Host bekommt nichts; Abschuss des Host-Spielers → nur
//   der Host bekommt Munition; cfg.net.killAmmo kommt beim Client an.
// Bildschirmfotos: tools/out/ammo-plus30.png (HUD „+30“), tools/out/ammo-hm60.png („+20“), tools/out/ammo-realismus.png.
// Voraussetzung: Server (NP_BASE, Standard http://localhost:8765/); online zusätzlich node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/ammo-test.mjs [--only=offline,online] [--quality=low] [--size=960x540]
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const ONLY = opt.only ? String(opt.only).split(',') : opt.online ? ['offline', 'online'] : ['offline'];
const QUALITY = String(opt.quality || 'low');
const [W, H] = String(opt.size || '960x540').split('x').map(Number);
const RELAY = process.env.NP_RELAY || 'ws://localhost:7777';
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);

async function waitForLoad() {
  for (let i = 0; i < 6; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 14)) return;
    if (i % 3 === 0) info(`Last ${l1} > 14 – warte`);
    await sleep(20000);
  }
}

async function until(p, fn, arg, timeout = 60000, every = 400) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}

function watchErrors(p, list) {
  p.on('pageerror', (e) => list.push(`[pageerror] ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR_|WebGL|GL_|AudioContext/i.test(m.text())) list.push(m.text()); });
}

/** Hilfen auf der Seite (window.__at): Abschuss, Waffenstand, Aufnahme-Ereignisse. */
const instrument = (p) => p.evaluate(() => {
  const G = window.__game;
  const T = G.THREE;
  const A = (window.__at = { pickups: [] });
  G.events.on('ammo:pickup', (e) => { if (e.actor === G.player) A.pickups.push({ w: e.weaponId, n: e.amount, mag: e.mag, res: e.reserve }); });
  /** lebender Gegner von `who` (Host: Bots; sonst neu eingesetzt) */
  A.enemy = (who = G.player) => {
    const list = G.actors.filter((a) => a !== who && !a.isPlayer && !a.isRemoteHuman && G.combat.isHostile(who, a));
    let b = list.find((a) => a.alive) || list[0] || null;
    if (b && !b.alive) G.spawnActor(b);
    return b;
  };
  A.ally = () => G.actors.find((a) => a !== G.player && a.alive && !G.combat.isHostile(G.player, a)) || null;
  /** Abschuss eines Gegners durch `who` (Standard: eigener Spieler) mit Waffe weaponId (Standard: gehaltene) */
  A.kill = (weaponId, who = G.player) => {
    const b = A.enemy(who);
    if (!b) return false;
    const w = weaponId !== undefined ? weaponId : (G.player.weapon.currentDef || {}).id;
    G.combat.damage(b, { amount: 9999, attacker: who, weaponId: w, zone: 'body', dir: new T.Vector3(0, 0, -1) });
    return !b.alive;
  };
  A.slot = (id) => { const s = G.player.weapon.slots.find((x) => x.id === id); return s ? { id: s.id, mag: s.mag, reserve: s.reserve } : null; };
  A.cur = () => { const s = G.player.weapon.current; return { id: s.id, mag: s.mag, reserve: s.reserve }; };
  A.set = (id, mag, reserve) => { const s = G.player.weapon.slots.find((x) => x.id === id); if (s) { s.mag = mag; s.reserve = reserve; } return !!s; };
  A.again = () => { const g = document.querySelector('.h-again'); return g ? { text: g.textContent, anims: g.getAnimations().length } : null; };
  /** HUD-Animation „+30“ für das Foto anhalten (sonst blendet sie während des Fotos unter SwiftShader schon aus) */
  A.freeze = (ms = 520) => { for (const a of document.querySelector('.h-again').getAnimations()) { a.pause(); a.currentTime = ms; } };
  A.notices = () => [...document.querySelectorAll('.h-notice')].map((n) => n.textContent);
  return true;
});

async function offline(browser) {
  info('— Offline —');
  await waitForLoad();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const errs = [];
  watchErrors(p, errs);
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=1&enemies=3&diff=rekrut&primary=ar_m17&secondary=pi_p9&quality=${QUALITY}`);
  const ok = await until(p, () => window.__game && window.__game.match.state === 'playing' && window.__game.player.alive && window.__game.player.weapon, null, 400000, 1000);
  if (!check(!!ok, 'Match läuft (TDM Hafen)')) { await ctx.close(); return; }
  await instrument(p);
  const base = await p.evaluate(() => {
    const G = window.__game;
    G.debugApi.godMode(true);
    G.input.allowUnlockedMouse = true;
    return { on: G.weapons.killAmmoEnabled(), set: G.settings.get('killAmmo'), cur: window.__at.cur(), slots: G.player.weapon.slots.map((s) => s.id) };
  });
  info(`Ausrüstung ${base.slots.join(' + ')}, gehalten ${base.cur.id} ${base.cur.mag}/${base.cur.reserve}`);
  check(base.on === true && base.set === true, `Einstellung „Munition pro Abschuss“ Standard an (killAmmoEnabled ${base.on})`);

  // --- Sturmgewehr: +1 Magazin in den Vorrat, Obergrenze reserve + mag
  const ar = await p.evaluate(() => {
    const A = window.__at;
    const id = A.cur().id;
    A.set(id, 12, 90);
    const before = A.cur();
    const killed = A.kill();
    const after = A.cur();
    return { id, before, after, killed, pick: A.pickups.slice(-1)[0] || null, n: A.pickups.length, again: A.again() };
  });
  check(ar.killed && ar.after.reserve === ar.before.reserve + 30 && ar.after.mag === ar.before.mag && ar.n === 1,
    `${ar.id}: Abschuss → Vorrat ${ar.before.reserve} → ${ar.after.reserve} (+30), Magazin bleibt ${ar.after.mag}`);
  check(!!ar.again && ar.again.text === '+30' && ar.again.anims > 0, `HUD am Zähler: „${ar.again && ar.again.text}“ (Animation ${ar.again && ar.again.anims})`);
  await p.evaluate(() => window.__at.freeze());
  await p.screenshot({ path: `${OUT}/ammo-plus30.png` });
  info(`Bild: ${OUT}/ammo-plus30.png`);
  const cap = await p.evaluate(() => {
    const A = window.__at;
    const id = A.cur().id;
    A.set(id, 30, 140);
    const n0 = A.pickups.length;
    A.kill();
    const r1 = A.cur().reserve;
    const p1 = A.pickups.length - n0;
    A.kill();
    return { r1, r2: A.cur().reserve, p1, p2: A.pickups.length - n0 - p1 };
  });
  check(cap.r1 === 150 && cap.p1 === 1 && cap.r2 === 150 && cap.p2 === 0, `Obergrenze reserve + mag = 150: 140 → ${cap.r1} (nur +10), dann ${cap.r2} (kein weiteres Ereignis: ${cap.p2})`);

  // --- leer: kein automatisches Nachladen
  const empty = await p.evaluate(async () => {
    const G = window.__game;
    const A = window.__at;
    const w = G.player.weapon;
    const id = A.cur().id;
    A.set(id, 0, 0);
    w._autoReloadAt = Infinity; // Zustand nach erfolglosem Auto-Nachladen (Vorrat war leer)
    A.kill();
    await new Promise((r) => setTimeout(r, 1500));
    return { cur: A.cur(), reloading: w.isReloading };
  });
  check(empty.cur.mag === 0 && empty.cur.reserve === 30 && !empty.reloading, `leeres Magazin + leerer Vorrat: Vorrat 0 → ${empty.cur.reserve}, kein Selbst-Nachladen (Magazin ${empty.cur.mag}, lädt ${empty.reloading})`);

  // --- Messer-Abschuss → gehaltene Waffe; Pistolen-Abschuss mit dem Gewehr in der Hand → Pistole
  const other = await p.evaluate(() => {
    const A = window.__at;
    const id = A.cur().id;
    A.set(id, 30, 60);
    A.set('pi_p9', 15, 20);
    A.kill('knife');
    const knife = A.cur().reserve;
    A.kill('pi_p9');
    return { knife, pistol: A.slot('pi_p9'), rifle: A.cur().reserve, again: A.again() };
  });
  check(other.knife === 90, `Messer-Abschuss → gehaltene Waffe: Vorrat 60 → ${other.knife}`);
  check(other.pistol && other.pistol.reserve === 35 && other.rifle === 90, `Pistolen-Abschuss (Gewehr gehalten) → P-9 Vorrat 20 → ${other.pistol && other.pistol.reserve}, Gewehr unverändert ${other.rifle}`);
  check(other.again && /^\+15 P-9/.test(other.again.text), `HUD nennt die andere Waffe: „${other.again && other.again.text}“`);

  // --- Teamabschuss / Selbstmord / Einstellung aus: nichts
  const none = await p.evaluate(() => {
    const G = window.__game;
    const A = window.__at;
    const n0 = A.pickups.length;
    const r0 = A.cur().reserve;
    // Teamabschuss/Selbstmord direkt am Hörer (Friendly Fire ist aus – combat.js meldet so etwas gar nicht erst)
    const ally = A.ally();
    if (ally) G.weapons._killAmmo({ victim: ally, killer: G.player, weaponId: A.cur().id, suicide: false });
    G.weapons._killAmmo({ victim: G.player, killer: G.player, weaponId: 'frag', suicide: true });
    G.settings.set('killAmmo', false);
    const off = G.weapons.killAmmoEnabled();
    A.kill();
    G.settings.set('killAmmo', true);
    return { ally: !!ally, n: A.pickups.length - n0, r: A.cur().reserve - r0, off };
  });
  check(none.ally && none.n === 0 && none.r === 0 && none.off === false, `Teamabschuss, Selbstmord und Einstellung aus: keine Munition (Ereignisse ${none.n}, Vorrat ${none.r >= 0 ? '+' : ''}${none.r})`);

  // --- HM-60 Hammer: 20 Schuss direkt in den Gurt
  const hm = await p.evaluate(() => {
    const G = window.__game;
    const A = window.__at;
    G.debugApi.giveWeapon('lmg_hm60');
    const w = G.player.weapon;
    w._switch = null; w.isSwitching = false;
    A.set('lmg_hm60', 50, 200);
    A.kill();
    const a = A.slot('lmg_hm60');
    A.set('lmg_hm60', 95, 200);
    A.kill();
    const b = A.slot('lmg_hm60');
    A.set('lmg_hm60', 100, 300);
    const n0 = A.pickups.length;
    A.kill();
    const c = A.slot('lmg_hm60');
    A.set('lmg_hm60', 60, 200);
    A.kill();
    return { a, b, c, full: A.pickups.length - n0 - 1, again: A.again(), held: A.cur().id };
  });
  check(hm.held === 'lmg_hm60' && hm.a.mag === 70 && hm.a.reserve === 200, `HM-60: Abschuss → Gurt 50 → ${hm.a.mag} (+20 direkt), Vorrat ${hm.a.reserve}`);
  check(hm.b.mag === 100 && hm.b.reserve === 215, `HM-60: Gurt 95 → ${hm.b.mag}, Überschuss in den Vorrat 200 → ${hm.b.reserve}`);
  check(hm.c.mag === 100 && hm.c.reserve === 300 && hm.full === 0, `HM-60 voll (100/300): keine Munition (${hm.c.mag}/${hm.c.reserve})`);
  check(hm.again && hm.again.text === '+20', `HUD HM-60: „${hm.again && hm.again.text}“`);
  await p.evaluate(() => window.__at.freeze());
  await p.screenshot({ path: `${OUT}/ammo-hm60.png` });

  // --- HUD Realismus: kein Zähler, nur ein Hinweis ohne Zahl
  const real = await p.evaluate(async () => {
    const G = window.__game;
    const A = window.__at;
    G.settings.set('hudStyle', 'aus');
    await new Promise((r) => setTimeout(r, 100));
    for (const a of document.querySelector('.h-again').getAnimations()) a.cancel();
    // andere Hinweise wegräumen: der Munitions-Hinweis erscheint nur, wenn gerade keiner sichtbar ist
    const hud = G.hud;
    if (hud && hud._notices) { for (const x of hud._notices) x.n.remove(); hud._notices.length = 0; }
    A.set('lmg_hm60', 40, 200);
    A.kill();
    const notes = A.notices();
    const res = { notes, anims: document.querySelector('.h-again').getAnimations().length, mag: A.slot('lmg_hm60').mag };
    return res;
  });
  const note = real.notes.find((t) => /Munition/.test(t)) || '';
  check(real.mag === 60 && /^Munition aufgenommen$/.test(note) && !/\d/.test(note) && real.anims === 0, `Realismus-HUD: Hinweis „${note}“ ohne Zahl, kein „+20“ (Gurt ${real.mag})`);
  await p.screenshot({ path: `${OUT}/ammo-realismus.png` });
  await p.evaluate(() => window.__game.settings.set('hudStyle', 'voll'));
  check(!errs.length, `keine Seiten-/Konsolenfehler${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

async function online(browser) {
  info('— Online (Host + 1 Client) —');
  await waitForLoad();
  const pages = [];
  const errs = {};
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const p = await ctx.newPage();
    errs[name] = [];
    watchErrors(p, errs[name]);
    await p.goto(`${BASE}spielen.html?quality=low&relays=${encodeURIComponent(RELAY)}`);
    await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 180000 });
    await p.evaluate((n) => window.__game.settings.set('playerName', n), name);
    pages.push(ctx);
    return p;
  };
  try {
    const host = await open('Hosti');
    const cl = await open('Anna');
    const code = await host.evaluate(() => window.__game.net.host({ name: 'Munition', mode: 'tdm', map: 'hafen', maxPlayers: 4, teamSize: 3, pvp: 'pvp', botFill: true, difficulty: 'rekrut', style: 'arcade' }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
    check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
    const roomOn = await host.evaluate(() => window.__game.net.room.settings.killAmmo);
    check(roomOn === true, `Raum-Einstellung killAmmo Standard an (${roomOn})`);
    let j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
    if (!j.ok) { info(`Beitritt ${j.code} – zweiter Versuch`); j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Anna' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code); }
    if (!check(j.ok, `Client tritt bei (${j.ok ? `id ${j.id}` : j.code})`)) return;
    await until(host, () => window.__game.net.roster.length === 2, null, 20000);
    await host.evaluate(() => window.__game.net.startMatch());
    const inMatch = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 600000, 1000)));
    if (!check(inMatch.every(Boolean), 'Host + Client im Match')) return;
    await instrument(host);
    await instrument(cl);
    const cfgCl = await cl.evaluate(() => ({ ka: window.__game.match.net && window.__game.match.net.killAmmo, on: window.__game.weapons.killAmmoEnabled() }));
    check(cfgCl.ka === true && cfgCl.on === true, `Client: cfg.net.killAmmo ${cfgCl.ka}, aktiv ${cfgCl.on}`);
    // niemand stirbt nebenbei (Wiedereinstieg füllt die Munition auf): Host-Spieler und Annas Puppe unverwundbar
    await host.evaluate((aId) => { const G = window.__game; G.debugApi.godMode(true); const a = G.net.actorById(aId); if (a) a.invulnerable = true; }, j.id);
    const c0 = await cl.evaluate(() => { const A = window.__at; window.__game.player.godMode = true; A.set(A.cur().id, 30, 60); return A.cur(); });
    const h0 = await host.evaluate(() => { const A = window.__at; A.set(A.cur().id, 30, 60); return { cur: A.cur(), n: A.pickups.length }; });
    // Host bestätigt einen Abschuss mit Annas Puppe als Schützin (wie nach ihren Treffermeldungen)
    const k1 = await host.evaluate((aId) => {
      const G = window.__game;
      const anna = G.net.actorById(aId);
      if (!anna) return null;
      const w = anna.loadout && anna.loadout.primary;
      const killed = window.__at.kill(w || null, anna);
      return { killed, w };
    }, j.id);
    check(!!k1 && k1.killed, `Host: Bot von Annas Puppe abgeschossen (Waffe ${k1 && k1.w})`);
    const got = await until(cl, () => window.__at.pickups.length >= 1 && window.__at.cur(), null, 30000, 500);
    await sleep(4000); // keine zweite Gutschrift (spätere Abgleiche, doppelte Zustellung)
    const c1 = await cl.evaluate(() => ({ cur: window.__at.cur(), n: window.__at.pickups.length, kills: window.__game.player.stats.kills, again: window.__at.again() }));
    check(!!got && c1.n === 1 && c1.cur.reserve === c0.reserve + 30, `Client: Vorrat ${c0.reserve} → ${c1.cur.reserve} genau einmal (${c1.n} Gutschrift, HUD „${c1.again && c1.again.text}“)`);
    const h1 = await host.evaluate(() => ({ cur: window.__at.cur(), n: window.__at.pickups.length }));
    check(h1.n === h0.n && h1.cur.reserve === h0.cur.reserve, `Host bekommt für Annas Abschuss nichts (Vorrat ${h0.cur.reserve} → ${h1.cur.reserve})`);
    // Abschuss des Host-Spielers: nur der Host
    const k2 = await host.evaluate(() => window.__at.kill());
    await sleep(3000);
    const h2 = await host.evaluate(() => ({ cur: window.__at.cur(), n: window.__at.pickups.length }));
    const c2 = await cl.evaluate(() => ({ cur: window.__at.cur(), n: window.__at.pickups.length }));
    check(k2 && h2.n === h0.n + 1 && h2.cur.reserve === h0.cur.reserve + 30 && c2.n === 1 && c2.cur.reserve === c1.cur.reserve,
      `Host-Abschuss: Host ${h0.cur.reserve} → ${h2.cur.reserve}, Client unverändert ${c2.cur.reserve} (${c2.n} Gutschrift)`);
    const e = Object.entries(errs).filter(([, l]) => l.length);
    check(!e.length, `keine Seiten-/Konsolenfehler${e.length ? `: ${e.map(([n, l]) => `${n}: ${l.slice(0, 2).join(' | ')}`).join('; ')}` : ''}`);
  } finally {
    for (const c of pages) await c.close().catch(() => {});
  }
}

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
try {
  if (ONLY.includes('offline')) await offline(browser);
  if (ONLY.includes('online')) await online(browser);
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
