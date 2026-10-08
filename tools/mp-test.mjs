// NULLPUNKT – Mehrspieler Ende-zu-Ende (Stufe 1): Host + 2 Clients spielen echte Matches in Headless-Chromium über ein
// lokales Nostr-Relay (spielen.html, WebGL über SwiftShader). Geprüft wird das ganze Spiel, nicht nur das Netz:
//   • Raum: Host öffnet (G.net.host), zwei Clients treten bei (G.net.join), Host startet TDM auf Hafen (kleine Teams).
//   • alle drei erreichen 'playing'; jeder Client sieht Host und den anderen Client als Puppen, Positionen nach Bewegung
//     ≤ 0,5 m an der maßgeblichen Position (Host-Spieler bzw. eigener Spieler des anderen Clients).
//   • Client schießt einen Host-Bot (echte Treffermeldung über combat.fireHitscan → 'hit' → Anti-Cheat → combat.damage):
//     Schaden + Abschuss beim Host, Abschuss in allen Abschusslisten, Teampunkte überall gleich.
//   • Host-Bot schadet einem Client → dessen Lebenspunkte sinken; Tod + Respawn des Clients.
//   • Anti-Cheat: Client springt 20 m → 'correct' setzt ihn zurück, Protokoll beim Host.
//   • Client verlässt mitten im Match → Puppe überall weg, ein Bot füllt nach.
//   • kurzes Match endet (Restzeit beim Host) → Endbildschirm bei Host und Client, Zusammenfassung beim Client.
//   • Herrschaft: Flaggenzustand synchron; Einstieg ins laufende Match (welcome.cfg); Kick mitten im Match.
// Voraussetzung: Server auf 8765 (npx http-server -p 8765 -s -c-1 .) und node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/mp-test.mjs [--size=640x360] [--quality=low] [--keep] [--skip-dom] [--params="netlag=150&netjitter=30&netloss=5"]
//   --params: zusätzliche URL-Parameter für alle Seiten (z. B. Netz-Chaos ?netlag/netjitter/netloss, net/index.js).
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const RELAY = process.env.NP_RELAY || 'ws://127.0.0.1:7777';
const [W, H] = String(opt.size || '640x360').split('x').map(Number);
const QUALITY = String(opt.quality || 'low');
const EXTRA = typeof opt.params === 'string' && opt.params ? '&' + opt.params.replace(/^[?&]+/, '') : '';
const OUT = 'tools/out';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;

let fail = 0;
let count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);

// Rechner teilt sich Prüfläufe: bei hoher Last warten (höchstens 10 min)
async function waitForLoad() {
  for (let i = 0; i < 10; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 6)) return;
    info(`Last ${l1} > 6 – warte 60 s`);
    await sleep(60000);
  }
}
await waitForLoad();

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const pages = {};
const errors = {};

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  errors[name] = [];
  p.on('pageerror', (e) => { errors[name].push(`[pageerror] ${e.message}`); console.log(`[${name}] Seitenfehler: ${e.message}`); });
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/favicon|Failed to load resource|net::ERR_|WebGL|GL_INVALID|AudioContext/i.test(text)) return;
    errors[name].push(text);
    console.log(`[${name}] Konsole: ${text.slice(0, 300)}`);
  });
  await p.goto(`${BASE}spielen.html?quality=${QUALITY}&relays=${encodeURIComponent(RELAY)}${EXTRA}`);
  await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 120000 });
  await p.evaluate((n) => { window.__game.settings.set('playerName', n); }, name);
  // Beobachter: Abschüsse, Treffer, Spawns, Korrekturen (je Seite)
  await p.evaluate(() => {
    const G = window.__game;
    const log = (window.__mp = { kills: [], hits: [], spawns: [], corrects: 0, ends: 0, objectives: [], explosions: [], grenades: 0, scores: [] });
    G.events.on('explosion', (e) => log.explosions.push(e.type || '?'));
    G.events.on('grenade:throw', () => { log.grenades++; });
    G.events.on('score', (e) => { if (e.actor === G.player) log.scores.push(e.reason); });
    G.events.on('kill', (e) => log.kills.push({ v: e.victim && e.victim.netId, vn: e.victim && e.victim.name, k: e.killer && e.killer.netId, w: e.weaponId }));
    G.events.on('actor:hit', (e) => log.hits.push({ t: e.target && e.target.netId, a: e.attacker && e.attacker.netId, amt: e.amount, pred: !!e.predicted }));
    G.events.on('actor:spawn', (e) => log.spawns.push(e.actor && e.actor.netId));
    G.events.on('match:end', () => { log.ends++; });
    G.events.on('objective:captured', (e) => log.objectives.push({ id: e.objective && e.objective.id, team: e.team }));
    G.net.on('correct', () => { log.corrects++; });
    // Host: feindlicher Bot für ein Ziel – lebend bevorzugt, sonst sofort wieder eingesetzt (kleine Teams)
    window.__hostileBot = (actor) => {
      const list = G.bots.bots.filter((b) => !b.isRemoteHuman && G.combat.isHostile(actor, b));
      let bot = list.find((b) => b.alive) || list[0] || null;
      if (bot && !bot.alive) G.spawnActor(bot);
      return bot;
    };
  });
  pages[name] = p;
  return p;
}

const ev = (p, fn, arg) => p.evaluate(fn, arg);
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
const state = (p) => ev(p, () => window.__game.match.state);
const shot = async (p, name) => { try { await p.screenshot({ path: `${OUT}/mp-${name}.png` }); } catch { /* */ } };

/** Ansicht einer Seite: eigener Spieler + alle Akteure mit Netz-Id. */
const view = (p) => ev(p, () => {
  const G = window.__game;
  const pl = G.player;
  return {
    state: G.match.state, self: G.net.selfId, team: pl.team, alive: pl.alive, hp: Math.round(pl.health),
    pos: [pl.position.x, pl.position.y, pl.position.z], yaw: pl.yaw,
    actors: G.actors.filter((a) => Number.isInteger(a.netId)).map((a) => ({ id: a.netId, name: a.name, team: a.team, alive: a.alive, puppet: !!a.puppet, human: !!(a.isPlayer || a.isRemoteHuman), hp: Math.round(a.health), pos: [a.position.x, a.position.y, a.position.z] })),
    scores: G.mode ? { ...G.mode.scores } : null,
  };
});
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function bothInMatch(list, timeout = 300000) {
  const ok = await Promise.all(list.map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, timeout, 1000)));
  return ok.every(Boolean);
}

try {
  // ================================================================== Raum + Start
  const host = await open('Hosti');
  const c1 = await open('Anna');
  const c2 = await open('Bert');
  info(`drei Seiten geladen (${QUALITY}, ${W}×${H}${EXTRA ? `, ${EXTRA.slice(1)}` : ''})`);
  const code = await ev(host, () => window.__game.net.host({
    name: 'MP-Test', mode: 'tdm', map: 'hafen', maxPlayers: 4, teamSize: 3, pvp: 'pvp', botFill: true, difficulty: 'rekrut',
    weather: 'standard', time: 'standard', style: 'arcade',
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
  check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
  const joins = await Promise.all([c1, c2].map((p, i) => ev(p, ([c, n]) => window.__game.net.join(c, { name: n }).then((r) => ({ ok: true, id: r.id, team: r.team }), (e) => ({ ok: false, code: e.code })), [code, i ? 'Bert' : 'Anna'])));
  check(joins.every((j) => j.ok), `zwei Clients treten bei (${joins.map((j) => (j.ok ? `id ${j.id}/${j.team}` : j.code)).join(', ')})`);
  const [A, B] = joins.map((j) => j.id);
  await until(host, () => window.__game.net.roster.length === 3, null, 15000);
  const cfg = await ev(host, () => { const c = window.__game.net.startMatch(); return c && { mode: c.modeId, map: c.mapId, botsA: c.net.botsA, botsB: c.net.botsB }; });
  check(!!cfg && cfg.mode === 'tdm' && cfg.map === 'hafen', `Host startet TDM/Hafen (Bots ${cfg && cfg.botsA}/${cfg && cfg.botsB})`);
  const inMatch = await bothInMatch([host, c1, c2]);
  check(inMatch, 'Host + beide Clients im Zustand playing, eigener Spieler lebt');
  if (!inMatch) {
    for (const [n, p] of Object.entries(pages)) info(`${n}: ${JSON.stringify(await ev(p, () => ({ st: window.__game.match.state, cd: window.__game.match.countdown, fr: window.__game.time.frame, real: Math.round(window.__game.time.real), hidden: document.hidden, alive: window.__game.player.alive, net: window.__game.debugApi.state().net, sync: !!window.__game.net.sync, active: window.__game.net.sync && window.__game.net.sync.active, hp: window.__game.net.sync && window.__game.net.sync.hostPlaying })).catch((e) => e.message))}`);
    throw new Error('Match nicht erreicht');
  }
  await shot(c1, '1-start-anna');
  const fps = await Promise.all([host, c1, c2].map((p) => ev(p, () => window.__game.renderer.info().fps)));
  info(`Bildrate (SwiftShader, drei Seiten): Host ${fps[0]}, Anna ${fps[1]}, Bert ${fps[2]} FPS`);

  // ================================================================== Puppen + Positionen
  // Bewegung: Host-Spieler und Bert gehen 1,5 m zur Seite (Bert innerhalb des Anti-Cheat-Budgets)
  await ev(host, () => { const p = window.__game.player; window.__game.debugApi.teleport(p.position.x + 1.5, p.position.y + 0.2, p.position.z); });
  await ev(c2, () => { const p = window.__game.player; p.body.teleport(new window.__game.THREE.Vector3(p.position.x - 1.5, p.position.y + 0.2, p.position.z)); });
  const sees = (v, id) => v.actors.find((a) => a.id === id);
  // bis die Bewegungen überall angekommen sind (SwiftShader: Host-Bilder bis 3 s, Schnappschüsse entsprechend selten)
  let vh, v1, v2;
  const settleT0 = Date.now();
  for (;;) {
    await sleep(2000);
    [vh, v1, v2] = await Promise.all([view(host), view(c1), view(c2)]);
    const ok = sees(v1, 1) && sees(v1, B) && sees(v2, A) && sees(vh, B) && d3(sees(v1, 1).pos, vh.pos) < 0.5 && d3(sees(v1, B).pos, v2.pos) < 0.5 && d3(sees(v2, A).pos, v1.pos) < 0.5 && d3(sees(vh, B).pos, v2.pos) < 0.5;
    if (ok || Date.now() - settleT0 > 40000) break;
  }
  info(`Positionen angeglichen nach ${((Date.now() - settleT0) / 1000).toFixed(0)} s`);
  check(!!sees(v1, 1) && sees(v1, 1).puppet && !!sees(v1, B) && sees(v1, B).puppet && sees(v1, B).human, `Anna sieht Host (1) und Bert (${B}) als Puppen (Menschen)`);
  check(!!sees(v2, 1) && !!sees(v2, A) && sees(v2, A).puppet, `Bert sieht Host und Anna (${A}) als Puppen`);
  check(!!sees(vh, A) && sees(vh, A).puppet && !!sees(vh, B) && sees(vh, B).human, 'Host hat Puppen für Anna und Bert');
  const botsHost = vh.actors.filter((a) => !a.human).length;
  check(botsHost === (cfg.botsA + cfg.botsB) && v1.actors.filter((a) => !a.human).length === botsHost, `Bots: Host ${botsHost}, Anna sieht ${v1.actors.filter((a) => !a.human).length}`);
  const e1 = d3(sees(v1, 1).pos, vh.pos);
  const e2 = d3(sees(v1, B).pos, v2.pos);
  const e3 = d3(sees(v2, A).pos, v1.pos);
  const e4 = d3(sees(vh, B).pos, v2.pos);
  check(e1 < 0.5 && e2 < 0.5 && e3 < 0.5 && e4 < 0.5, `Positionen: Anna→Host ${e1.toFixed(2)} m, Anna→Bert ${e2.toFixed(2)} m, Bert→Anna ${e3.toFixed(2)} m, Host→Bert ${e4.toFixed(2)} m`);
  const botSync = vh.actors.filter((a) => !a.human && a.alive).map((b) => { const o = sees(v1, b.id); return o ? d3(o.pos, b.pos) : 99; });
  info(`Bot-Abweichung Anna (laufende Bots, ~0,1–0,4 s Interpolation): max ${Math.max(...botSync).toFixed(2)} m`);

  // ================================================================== Glätte: Host zieht einen Bot (KI aus) gleichmäßig geradeaus, Anna misst jedes Bild
  // Position des Bots exakt zur Zeit jedes Schnappschusses (x0 + v·t) – jede Unruhe bei Anna kommt aus Netz/Interpolation
  const glideInfo = await ev(host, () => {
    const G = window.__game;
    const bot = G.bots.bots.find((b) => !b.isRemoteHuman && b.alive);
    if (!bot) return null;
    G.bots.setPuppet(bot, true);
    bot.invulnerable = true;
    const p0 = [bot.position.x, bot.position.y, bot.position.z];
    const t0 = G.net.serverTime();
    const sync = G.net.sync;
    const orig = sync._sendSnapshot.bind(sync);
    const np = { pos: p0.slice(), vel: [4.5, 0, 0], yaw: -Math.PI / 2, pitch: 0, flags: 1 | 64, weapon: null, lean: 0, shots: 0 };
    sync._sendSnapshot = (t) => {
      np.pos[0] = p0[0] + 4.5 * Math.max(0, t - t0);
      bot.body.position.set(np.pos[0], np.pos[1], np.pos[2]);
      bot.netPose = np;
      orig(t);
    };
    window.__glide = { bot, orig, sync };
    return { id: bot.netId, x0: p0[0], t0 };
  });
  // Host-Tab „verborgen“: der Hintergrund-Takt simuliert mit bis zu 20 Hz ohne Zeichnen – Schnappschüsse in echter Rate
  // (SwiftShader zeichnet sonst nur ~1 Bild/s, dann gibt es auch nur ~1 Schnappschuss/s)
  const hideHost = (on) => ev(host, (h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, on);
  if (glideId) await hideHost(true);
  await sleep(1500);
  const glideF0 = await ev(host, () => [window.__game.time.frame, performance.now()]);
  const glideId = glideInfo && glideInfo.id;
  const glide = glideId && await ev(c1, ([id, ms]) => new Promise((resolve) => {
    const G = window.__game;
    const a = G.net.actorById(id);
    const pts = [];
    const t0 = performance.now();
    const step = (now) => {
      if (a && a.alive) pts.push([now, a.position.x, a.position.z, G.net.serverTime()]);
      if (now - t0 < ms) requestAnimationFrame(step); else resolve(pts);
    };
    requestAnimationFrame(step);
  }), [glideId, 20000]);
  const glideF1 = await ev(host, () => [window.__game.time.frame, performance.now()]);
  const hostHz = (glideF1[0] - glideF0[0]) / Math.max(0.001, (glideF1[1] - glideF0[1]) / 1000);
  if (glideId) await hideHost(false);
  await ev(host, () => { const g = window.__glide; if (g) { g.sync._sendSnapshot = g.orig; g.bot.invulnerable = false; window.__game.bots.setPuppet(g.bot, false); } });
  {
    // Je Bild bei Anna: gezeigte Stelle x ↔ wahre Bahn x0 + v·(t − t0) → Darstellungsverzug D = (Host-Zeit − t0) − (x − x0)/v.
    // Glatt heißt: D bleibt (fast) gleich – Springen/Stehenbleiben/Zurückspringen ändern D. Unabhängig von Annas Bildrate.
    const V = 4.5;
    let back = 0, side = 0;
    const pts = (glide || []).filter((q) => q[1] - glideInfo.x0 > 0.5); // erst sobald der Bot sichtbar läuft
    const D = pts.map((q) => (q[3] - glideInfo.t0) - (q[1] - glideInfo.x0) / V);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][1] - pts[i - 1][1] < -0.05) back++;
      side = Math.max(side, Math.abs(pts[i][2] - pts[0][2]));
    }
    const sorted = [...D].sort((x, y) => x - y);
    const q = (f) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))] || 0;
    const spread = sorted.length ? sorted[sorted.length - 1] - sorted[0] : 0;
    const vd = await ev(c1, () => (window.__game.net.sync && window.__game.net.sync.viewDelay ? window.__game.net.sync.viewDelay() : null));
    check(pts.length >= 4 && back === 0 && spread < 0.45, `Glätte bei Anna (Bot 4,5 m/s geradeaus, Host ${hostHz.toFixed(1)} Bilder/s im Hintergrund-Takt, ${pts.length} Bilder bei Anna): Darstellungsverzug Median ${(q(0.5) * 1000).toFixed(0)} ms, Schwankung ${(spread * 1000).toFixed(0)} ms (≙ ${(spread * V).toFixed(2)} m), rückwärts ${back}, seitlich ${side.toFixed(2)} m, viewDelay ${vd == null ? '–' : (vd * 1000).toFixed(0) + ' ms'}`);
  }

  // ================================================================== Anna schießt einen Host-Bot ab
  const target = await ev(host, ([aId]) => {
    const G = window.__game;
    const T = G.THREE;
    const anna = G.net.actorById(aId);
    const bot = anna && window.__hostileBot(anna);
    if (!anna || !bot) return null;
    // Ziel festhalten (KI aus) und 7 m vor Anna stellen – Richtung mit freier Sicht
    G.bots.setPuppet(bot, true);
    const eye = anna.getEyePosition(new T.Vector3());
    for (let k = 0; k < 16; k++) {
      const a = anna.yaw + (k * Math.PI) / 8;
      const pos = new T.Vector3(anna.position.x - Math.sin(a) * 7, anna.position.y, anna.position.z - Math.cos(a) * 7);
      const chest = pos.clone(); chest.y += 1.2;
      if (G.world.lineOfSight(eye, chest) && G.world.lineOfSight(eye, pos.clone().setY(pos.y + 0.4))) {
        bot.body.teleport(pos);
        bot.yaw = a;
        bot.health = bot.maxHealth;
        return { id: bot.netId, name: bot.name, team: bot.team, pos: [pos.x, pos.y, pos.z] };
      }
    }
    return null;
  }, [A]);
  check(!!target, `Ziel-Bot ${target && target.name} (${target && target.id}) vor Anna gestellt`);
  const scoresBefore = await ev(host, () => ({ ...window.__game.mode.scores }));
  // bis Anna den Bot am neuen Platz sieht (SwiftShader: einige Sekunden)
  await until(c1, ([id, tp]) => { const a = window.__game.net.actorById(id); return a && a.alive && Math.hypot(a.position.x - tp[0], a.position.y - tp[1], a.position.z - tp[2]) < 0.6; }, [target.id, target.pos], 30000, 1000);
  const seenTarget = await ev(c1, (id) => { const a = window.__game.net.actorById(id); return a ? { alive: a.alive, pos: [a.position.x, a.position.y, a.position.z] } : null; }, target.id);
  check(!!seenTarget && seenTarget.alive && d3(seenTarget.pos, target.pos) < 0.6, `Anna sieht den Ziel-Bot an seinem Platz (${seenTarget ? d3(seenTarget.pos, target.pos).toFixed(2) : '–'} m)`);
  const fired = await ev(c1, async (id) => {
    const G = window.__game;
    const T = G.THREE;
    const p = G.player;
    const def = p.weapon.currentDef;
    let claims = 0;
    const off = G.net.on('*', () => {});
    const send = G.net.send.bind(G.net);
    G.net.send = (to, msg, ex) => { if (msg && msg.t === 'hit') claims++; return send(to, msg, ex); };
    let hits = 0;
    for (let i = 0; i < 12; i++) {
      const tgt = G.net.actorById(id);
      if (!tgt || !tgt.alive) break;
      const eye = p.getEyePosition(new T.Vector3());
      const chest = tgt.position.clone(); chest.y += 1.25;
      const dir = chest.sub(eye).normalize();
      G.debugApi.lookAt(eye.x + dir.x, eye.y + dir.y, eye.z + dir.z);
      p._shotSerial = (p._shotSerial || 0) + 1;
      const r = G.combat.fireHitscan({ shooter: p, origin: eye, dir, range: def.range, weapon: def });
      if (r && r.hit === 'actor') hits++;
      await new Promise((res) => setTimeout(res, 250));
    }
    G.net.send = send;
    off();
    return { hits, claims, weapon: def.id };
  }, target.id);
  check(fired.hits >= 4 && fired.claims >= 4, `Anna trifft lokal ${fired.hits}× (${fired.weapon}), ${fired.claims} Treffermeldungen an den Host`);
  const killedOnHost = await until(host, ([id, aId]) => window.__mp.kills.some((k) => k.v === id && k.k === aId), [target.id, A], 20000);
  check(!!killedOnHost, 'Host: Ziel-Bot von Annas Puppe abgeschossen (kill-Ereignis mit Anna als Schützin)');
  const hostHits = await ev(host, ([id, aId]) => window.__mp.hits.filter((h) => h.t === id && h.a === aId).length, [target.id, A]);
  check(hostHits >= 3, `Host: ${hostHits} bestätigte Treffer von Anna auf den Bot (Anti-Cheat ok)`);
  const feeds = await Promise.all([host, c1, c2].map((p) => until(p, (name) => [...document.querySelectorAll('.kf-row')].some((r) => r.textContent.includes(name)), target.name, 15000)));
  check(feeds.every(Boolean), `Abschuss in allen drei Abschusslisten (${feeds.map((f) => (f ? 'ja' : 'nein')).join('/')})`);
  const annaTeam = v1.team;
  const scoreSync = await Promise.all([host, c1, c2].map((p) => until(p, ([t, n]) => window.__game.mode && window.__game.mode.scores[t] >= n && window.__game.mode.scores[t], [annaTeam, (scoresBefore[annaTeam] || 0) + 1], 15000)));
  const hostScore = await ev(host, () => ({ ...window.__game.mode.scores }));
  const s1 = await ev(c1, () => ({ ...window.__game.mode.scores }));
  const s2 = await ev(c2, () => ({ ...window.__game.mode.scores }));
  check(scoreSync.every(Boolean) && s1.A === hostScore.A && s1.B === hostScore.B && s2.A === hostScore.A && s2.B === hostScore.B, `Teampunkte überall gleich (Host ${hostScore.A}:${hostScore.B}, Anna ${s1.A}:${s1.B}, Bert ${s2.A}:${s2.B})`);
  const annaKills = await until(c1, () => window.__game.player.stats.kills >= 1 && window.__game.player.stats.kills, null, 10000);
  check(!!annaKills, `Anna: eigene Abschüsse aus dem Host-Zustand (${annaKills})`);
  await shot(c1, '2-abschuss-anna');

  // ================================================================== Anna wirft eine Granate (Host erzeugt sie, alle sehen sie)
  const gTarget = await ev(host, ([aId]) => {
    const G = window.__game;
    const T = G.THREE;
    const anna = G.net.actorById(aId);
    const bot = anna && window.__hostileBot(anna);
    if (!anna || !bot) return null;
    G.bots.setPuppet(bot, true);
    const eye = anna.getEyePosition(new T.Vector3());
    for (let k = 0; k < 16; k++) {
      const a = anna.yaw + (k * Math.PI) / 8;
      const pos = new T.Vector3(anna.position.x - Math.sin(a) * 4, anna.position.y, anna.position.z - Math.cos(a) * 4);
      if (G.world.lineOfSight(eye, pos.clone().setY(pos.y + 1))) { bot.body.teleport(pos); bot.health = bot.maxHealth; return { id: bot.netId, pos: [pos.x, pos.y, pos.z] }; }
    }
    return null;
  }, [A]);
  await ev(host, () => window.__game.debugApi.setTimeScale(3));
  await sleep(2500);
  const thrown = await ev(c1, (tp) => {
    const G = window.__game;
    const T = G.THREE;
    const p = G.player;
    const eye = p.getEyePosition(new T.Vector3());
    const dir = new T.Vector3(tp[0], tp[1] + 0.3, tp[2]).sub(eye).normalize();
    const g = G.weapons.throwGrenade(p, 'frag', { dir, cook: 2.2 });
    return { local: !!g, remote: !!(g && g.remote), cid: g && g.cid };
  }, gTarget.pos);
  check(thrown.local && thrown.remote, `Anna wirft: Meldung an den Host, lokal nur Darstellungs-Granate (cid ${thrown.cid})`);
  const hostBoom = await until(host, () => window.__mp.explosions.includes('frag'), null, 60000);
  check(!!hostBoom, 'Host: Granate aus Annas Puppe explodiert (echte Wirkung)');
  const booms = await Promise.all([c1, c2].map((p) => until(p, () => window.__mp.explosions.includes('frag'), null, 30000)));
  const adopted = await ev(c1, () => window.__mp.grenades);
  check(booms.every(Boolean) && adopted === 1, `Explosion bei Anna und Bert nachgespielt (Anna: ${adopted} Wurf-Ereignis – Host-Granate übernimmt die eigene Darstellung)`);
  const gDmg = await ev(host, ([id, aId]) => window.__mp.hits.some((h) => h.t === id && h.a === aId), [gTarget.id, A]);
  check(gDmg, 'Host: Granatenschaden am Bot mit Anna als Angreiferin');
  await ev(host, () => window.__game.debugApi.setTimeScale(1));

  // ================================================================== Nahkampf: Anna sticht einen Bot (Meldung 'melee')
  const mTarget = await ev(host, ([aId]) => {
    const G = window.__game;
    const T = G.THREE;
    const anna = G.net.actorById(aId);
    const bot = anna && window.__hostileBot(anna);
    if (!anna || !bot) return null;
    G.bots.setPuppet(bot, true);
    bot.body.teleport(new T.Vector3(anna.position.x - Math.sin(anna.yaw) * 1.3, anna.position.y, anna.position.z - Math.cos(anna.yaw) * 1.3));
    bot.health = bot.maxHealth;
    return bot.netId;
  }, [A]);
  await sleep(3000);
  const stab = await ev(c1, (id) => {
    const G = window.__game;
    const t = G.net.actorById(id);
    if (!t || !t.alive) return null;
    const pt = t.position.clone(); pt.y += 1.1;
    return G.combat.damage(t, { amount: 135, attacker: G.player, weaponId: 'knife', zone: 'body', dir: pt.clone().sub(G.player.position).normalize(), point: pt });
  }, mTarget);
  const meleeKill = await until(host, ([id, aId]) => window.__mp.kills.some((k) => k.v === id && k.k === aId && k.w === 'knife'), [mTarget, A], 30000);
  check(stab > 0 && !!meleeKill, `Nahkampf: Annas Messer (vorhergesagt ${Math.round(stab || 0)}) → Abschuss beim Host`);

  // ================================================================== Host-Bot schadet Bert, Tod + Respawn
  const dmg = await ev(host, ([bId]) => {
    const G = window.__game;
    const bert = G.net.actorById(bId);
    const bot = G.bots.bots.find((b) => !b.isRemoteHuman && G.combat.isHostile(b, bert));
    if (!bert || !bot) return null;
    G.mode.respawnDelay = 0.4;
    G.debugApi.setTimeScale(3);
    const dir = bert.position.clone().sub(bot.position).normalize();
    const dealt = G.combat.damage(bert, { amount: 35, attacker: bot, weaponId: 'ar_m17', zone: 'body', dir, point: bert.position.clone() });
    return { dealt, hp: bert.health, bot: bot.name };
  }, [B]);
  check(!!dmg && dmg.dealt > 0, `Host: Bot ${dmg && dmg.bot} trifft Berts Puppe (${dmg && Math.round(dmg.dealt)} Schaden, ${dmg && Math.round(dmg.hp)} LP)`);
  const bertHp = await until(c2, () => window.__game.player.health < 90 && Math.round(window.__game.player.health), null, 10000);
  const bertHit = await ev(c2, () => window.__mp.hits.some((h) => h.t === window.__game.net.selfId && !h.pred));
  check(!!bertHp && bertHit, `Bert: Lebenspunkte sinken auf ${bertHp} (Treffer vom Host, Schadensrichtung)`);
  const posBefore = (await view(c2)).pos;
  await ev(host, ([bId]) => {
    const G = window.__game;
    const bert = G.net.actorById(bId);
    const bot = G.bots.bots.find((b) => !b.isRemoteHuman && G.combat.isHostile(b, bert));
    G.combat.damage(bert, { amount: 500, attacker: bot, weaponId: 'ar_m17', zone: 'head', dir: bert.position.clone().sub(bot.position).normalize() });
  }, [B]);
  const bertDead = await until(c2, () => !window.__game.player.alive, null, 10000);
  check(!!bertDead, 'Bert stirbt (kill vom Host → Todeskamera)');
  const deathShown = await until(c2, () => window.__mp.kills.some((k) => k.v === window.__game.net.selfId), null, 5000);
  check(!!deathShown, "Bert: lokales 'kill'-Ereignis (Abschussliste, Todesbildschirm)");
  const respawned = await until(c2, () => window.__game.player.alive, null, 120000, 1000);
  await ev(host, () => window.__game.debugApi.setTimeScale(1));
  const posAfter = (await view(c2)).pos;
  check(!!respawned, `Bert spawnt wieder (Host 'spawn'), neuer Ort ${d3(posBefore, posAfter).toFixed(1)} m entfernt`);
  await sleep(2500);
  const bertOnHost = await ev(host, (bId) => { const a = window.__game.net.actorById(bId); return a ? { alive: a.alive, pos: [a.position.x, a.position.y, a.position.z] } : null; }, B);
  const vb = await view(c2);
  check(!!bertOnHost && bertOnHost.alive && d3(bertOnHost.pos, vb.pos) < 1, `Host: Berts Puppe lebt wieder am gemeldeten Ort (${bertOnHost ? d3(bertOnHost.pos, vb.pos).toFixed(2) : '–'} m)`);

  // ================================================================== Client: „Ausrüsten“ hält den Wiedereinstieg auch beim Host an, „Einsatz“ setzt ein
  await ev(host, (bId) => {
    const G = window.__game;
    G.mode.respawnDelay = 3;
    const bert = G.net.actorById(bId);
    const bot = G.bots.bots.find((b) => !b.isRemoteHuman && G.combat.isHostile(b, bert));
    G.combat.damage(bert, { amount: 500, attacker: bot, weaponId: 'ar_m17', zone: 'head', dir: new G.THREE.Vector3(1, 0, 0) });
  }, B);
  const dead2 = await until(c2, () => !window.__game.player.alive && window.__game.match.state === 'playing' && window.__game.player.respawnAt != null, null, 15000);
  const opened = dead2 && await ev(c2, () => {
    const G = window.__game;
    G.hud.deploy.open('equip');
    // andere Hauptwaffe wählen (wie das Ausrüsten-Feld: mode.setLoadout → gilt beim nächsten Einsatz)
    G.mode.setLoadout({ ...G.player.loadout, primary: 'smg_vp9' });
    return { open: G.hud.deploy.isOpen, hold: G.match.respawnHold };
  });
  const heldOnHost = await until(host, (bId) => { const G = window.__game; const a = G.net.actorById(bId); return a && !a.alive && G.mode.respawnHolds.has(a); }, B, 15000);
  const remain = () => Promise.all([
    ev(c2, () => window.__game.respawnRemaining()),
    ev(host, (bId) => { const G = window.__game; const a = G.net.actorById(bId); return a && !a.alive && a.respawnAt != null ? a.respawnAt - G.time.elapsed : null; }, B),
  ]);
  const r1 = await remain();
  await sleep(4000);
  const r2 = await remain();
  const steady = r1.every((v) => Number.isFinite(v) && v > 0.05) && r2.every((v) => Number.isFinite(v)) && Math.abs(r2[0] - r1[0]) < 0.15 && Math.abs(r2[1] - r1[1]) < 0.15;
  check(!!opened && opened.open && opened.hold && !!heldOnHost && steady,
    `Bert „Ausrüsten“: Wiedereinstieg angehalten – Rest bei Bert ${r1[0] != null ? r1[0].toFixed(2) : '–'} → ${r2[0] != null ? r2[0].toFixed(2) : '–'} s, beim Host ${r1[1] != null ? r1[1].toFixed(2) : '–'} → ${r2[1] != null ? r2[1].toFixed(2) : '–'} s (4 s gewartet)`);
  // Restzeit auf beiden Seiten auf 0,3 s kürzen (SwiftShader: Spielzeit läuft ~20× langsamer), dann „Einsatz“
  await ev(host, (bId) => { const G = window.__game; const a = G.net.actorById(bId); if (a && !a.alive) a.respawnAt = G.time.elapsed + 0.3; }, B);
  await ev(c2, () => { const G = window.__game; if (!G.player.alive) G.player.respawnAt = G.time.elapsed + 0.3; });
  await ev(c2, () => { const b = window.__game.hud.deploy.root.querySelector('.dp-go'); if (b) b.click(); });
  const deployed = await until(c2, () => window.__game.player.alive, null, 120000, 500);
  const newLo = await until(host, (bId) => { const a = window.__game.net.actorById(bId); return a && a.alive && a.loadout && a.loadout.primary; }, B, 10000);
  const ownLo = await ev(c2, () => window.__game.player.weapon && window.__game.player.weapon.slots && window.__game.player.weapon.slots.map((x) => x && x.id).join(','));
  check(!!deployed && newLo === 'smg_vp9' && /smg_vp9/.test(ownLo || ''), `„Einsatz“: Bert spawnt (Host setzt ein), neue Hauptwaffe beim Host ${newLo} / bei Bert ${ownLo}`);

  // ================================================================== Sturzschaden: Meldung an sich selbst, Host wendet ihn an
  await sleep(1500);
  const fallBefore = await ev(c2, () => Math.round(window.__game.player.health));
  await ev(c2, () => window.__game.combat.damage(window.__game.player, { amount: 30, attacker: null, weaponId: 'fall', zone: 'body', dir: new window.__game.THREE.Vector3(0, -1, 0) }));
  const fallHp = await until(c2, (h) => window.__game.player.health <= h - 20 && Math.round(window.__game.player.health), fallBefore, 20000);
  check(!!fallHp, `Sturzschaden über den Host: Bert ${fallBefore} → ${fallHp} LP`);

  // ================================================================== Anti-Cheat: Teleport 20 m
  // Berts Puppe währenddessen unverwundbar (sonst kann ein Bot ihn mitten in der Prüfung abschießen → neuer Spawn-Anker)
  await ev(host, (bId) => {
    const N = window.__game.net;
    const a = N.actorById(bId);
    if (a) a.invulnerable = true;
    window.__ac = [];
    const orig = N.checkState.bind(N);
    N.checkState = (pid, st, ctx) => { const r = orig(pid, st, ctx); if (pid === bId) window.__ac.push(`${N.serverTime().toFixed(1)} ${st.x.toFixed(1)},${st.z.toFixed(1)} f${st.flags} lebt ${ctx.alive} → ${r.reason}`); return r; };
  }, B);
  await sleep(1500);
  const origin = (await view(c2)).pos;
  // 20 m Richtung Kartenmitte (am Rand würde die Kartengrenze den Sprung kürzen)
  const jumped = await ev(c2, () => {
    const G = window.__game;
    const p = G.player;
    const c = G.world.bounds.getCenter(new G.THREE.Vector3());
    const d = new G.THREE.Vector3(c.x - p.position.x, 0, c.z - p.position.z);
    if (d.lengthSq() < 1) d.set(1, 0, 0);
    d.normalize().multiplyScalar(20);
    p.body.teleport(new G.THREE.Vector3(p.position.x + d.x, p.position.y + 0.5, p.position.z + d.z));
    return [p.position.x, p.position.y, p.position.z];
  });
  info(`Bert springt ${d3(jumped, origin).toFixed(1)} m`);
  const corrected = await until(c2, () => window.__mp.corrects > 0, null, 15000);
  await sleep(3000);
  const back = (await view(c2)).pos;
  const acLog = await ev(host, (bId) => window.__game.net.anticheat.log.filter((l) => l.peer === bId).map((l) => l.reason), B);
  check(!!corrected && d3(back, origin) < 3, `Teleport 20 m → 'correct' vom Host, Bert zurück (${d3(back, origin).toFixed(1)} m vom Ausgangspunkt), Protokoll: ${acLog.join(', ')}`);
  const bertHost2 = await ev(host, (bId) => { const a = window.__game.net.actorById(bId); return a ? [a.position.x, a.position.y, a.position.z] : null; }, B);
  if (!check(!!bertHost2 && d3(bertHost2, origin) < 3, `Host: Berts Puppe ist nicht mitgesprungen (${bertHost2 ? d3(bertHost2, origin).toFixed(1) : '–'} m)`)) {
    info(`Anti-Cheat-Verlauf: ${(await ev(host, () => window.__ac.slice(-12))).join(' | ')}`);
    info(`Bert-Ereignisse: ${JSON.stringify(await ev(c2, () => ({ kills: window.__mp.kills.slice(-3), spawns: window.__mp.spawns.slice(-3) })))}`);
  }

  // ================================================================== Sturz aus 9 m (Host setzt Bert dort ein) + Rutschen: kein Anti-Cheat-Verstoß
  const acN = await ev(host, (bId) => window.__game.net.anticheat.log.filter((l) => l.peer === bId).length, B);
  const corrN = await ev(c2, () => window.__mp.corrects);
  await ev(host, (bId) => {
    const N = window.__game.net;
    window.__slideStates = 0;
    const orig = N.checkState.bind(N);
    N.checkState = (pid, st, ctx) => { if (pid === bId && (st.flags & 128)) window.__slideStates++; return orig(pid, st, ctx); };
  }, B);
  const drop = await ev(host, (bId) => {
    const G = window.__game;
    const T = G.THREE;
    const bert = G.net.actorById(bId);
    if (!bert || !bert.alive) return null;
    const base = bert.position.clone();
    const up = (v, h) => v.clone().setY(v.y + h);
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const p = new T.Vector3(base.x + Math.sin(a) * (k ? 3 : 0), base.y, base.z + Math.cos(a) * (k ? 3 : 0));
      if (G.world.lineOfSight(up(p, 0.6), up(p, 11)) && G.world.lineOfSight(up(base, 0.6), up(p, 0.6))) {
        const spot = up(p, 9);
        G.spawnActor(bert, { position: spot, yaw: bert.yaw });
        return { from: [spot.x, spot.y, spot.z], ground: base.y };
      }
    }
    return null;
  }, B);
  const landed = drop && await until(c2, (gy) => { const p = window.__game.player; return p.alive && p.body.onGround && p.position.y < gy + 1.5 && p.position.y; }, drop.ground, 60000, 500);
  check(!!landed, `Bert fällt ${drop ? (drop.from[1] - (landed || drop.ground)).toFixed(1) : '–'} m (Host-Spawn in der Luft) und landet`);
  // Rutschen aus dem Sprint (player._startSlide wie die Taste), bis es endet
  const slid = await ev(c2, () => {
    const G = window.__game;
    const p = G.player;
    if (!p.alive || !p.body.onGround) return null;
    p.body.velocity.set(-Math.sin(p.yaw) * 8.2, 0, -Math.cos(p.yaw) * 8.2);
    p.sprinting = true;
    p._startSlide();
    return { sliding: p.sliding, x: p.position.x, z: p.position.z };
  });
  const slideEnd = slid && await until(c2, () => !window.__game.player.sliding && [window.__game.player.position.x, window.__game.player.position.z], null, 60000, 300);
  await sleep(2500);
  const acAfter = await ev(host, ([bId, n]) => window.__game.net.anticheat.log.filter((l) => l.peer === bId).slice(n).map((l) => l.reason), [B, acN]);
  const slideStates = await ev(host, () => window.__slideStates);
  const corrAfter = await ev(c2, () => window.__mp.corrects);
  check(!!slid && slid.sliding && !!slideEnd && slideStates > 0 && !acAfter.length && corrAfter === corrN,
    `Rutschen ${slid && slideEnd ? Math.hypot(slideEnd[0] - slid.x, slideEnd[1] - slid.z).toFixed(1) : '–'} m (${slideStates} Zustände mit Rutsch-Bit beim Host) + Sturz: Anti-Cheat ${acAfter.length ? acAfter.join(',') : 'ohne Verstoß'}, 'correct' ${corrAfter - corrN}`);
  await ev(host, (bId) => { const a = window.__game.net.actorById(bId); if (a) a.invulnerable = false; }, B);

  // ================================================================== Bert verlässt das Match
  const botsBefore = await ev(host, () => window.__game.bots.bots.filter((b) => !b.isRemoteHuman).length);
  await ev(c2, () => { window.__game.net.leave('verlassen'); window.__game.menus.onQuit(); });
  const goneHost = await until(host, (bId) => !window.__game.net.actorById(bId), B, 15000);
  const goneAnna = await until(c1, (bId) => !window.__game.net.actorById(bId), B, 15000);
  const refill = await until(host, (n) => window.__game.bots.bots.filter((b) => !b.isRemoteHuman).length === n + 1, botsBefore, 15000);
  check(!!goneHost && !!goneAnna, 'Bert verlässt: Puppe beim Host und bei Anna entfernt');
  check(!!refill, `ein Bot füllt Berts Platz auf (${botsBefore} → ${botsBefore + 1})`);
  const annaSeesRefill = await until(c1, (n) => window.__game.actors.filter((a) => a.puppet && !a.isRemoteHuman).length === n, botsBefore + 1, 15000);
  check(!!annaSeesRefill, 'Anna sieht den nachgefüllten Bot');
  check(await until(c2, () => window.__game.match.state === 'lobby' && !window.__game.net.online, null, 30000), 'Bert ist zurück in der Lobby (offline)');

  // ================================================================== kurzes Match endet
  await ev(host, () => { window.__game.debugApi.setTimeScale(3); window.__game.mode.timeLeft = 0.6; });
  const ended = await Promise.all([host, c1].map((p) => until(p, () => window.__game.match.state === 'ended' || window.__game.menus.current === 'end', null, 150000)));
  check(ended.every(Boolean), 'Matchende bei Host und Anna (Zeit abgelaufen)');
  const endScreens = await Promise.all([host, c1].map((p) => until(p, () => window.__game.menus.current === 'end', null, 30000)));
  check(endScreens.every(Boolean), 'Endbildschirm bei Host und Anna');
  const annaRes = await ev(c1, () => { const r = window.__game.lastResult; return r ? { ps: !!r.playerSummary, kills: r.playerSummary && r.playerSummary.kills, rows: r.scoreboard.length, me: r.scoreboard.filter((x) => x.isPlayer).length, won: r.playerWon, reason: r.reason } : null; });
  check(!!annaRes && annaRes.ps && annaRes.kills >= 1 && annaRes.me === 1, `Anna: Ergebnis vom Host mit eigener Zusammenfassung (${annaRes && annaRes.kills} Abschüsse, ${annaRes && annaRes.rows} Zeilen, Grund ${annaRes && annaRes.reason})`);
  await shot(c1, '3-ende-anna');
  check(await until(host, () => window.__game.net.room.state === 'lobby', null, 10000), 'Raum wieder in der Lobby');
  await Promise.all([host, c1].map((p) => ev(p, () => window.__game.menus.onQuit())));
  check(!!(await until(c1, () => window.__game.match.state === 'lobby' && window.__game.menus.current === 'room', null, 20000)), "Anna: 'Zurück in den Raum' → Raum-Bildschirm");

  if (!opt['skip-dom']) {
    // ================================================================== Herrschaft: Ziele, Einstieg ins laufende Match, Kick
    await ev(host, () => window.__game.net.updateSettings({ mode: 'dom', map: 'hafen' }));
    await sleep(500);
    await ev(host, () => window.__game.net.startMatch());
    check(await bothInMatch([host, c1]), 'Herrschaft: Host + Anna im Match');
    // Bert tritt dem laufenden Match bei
    const rj = await ev(c2, (c) => window.__game.net.join(c, { name: 'Bert' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
    check(rj.ok, `Bert tritt dem laufenden Match bei (id ${rj.id || rj.code})`);
    const B2 = rj.id;
    check(await bothInMatch([c2]), 'Bert lädt und spawnt im laufenden Match (welcome.cfg)');
    const seenB2 = await until(host, (id) => { const a = window.__game.net.actorById(id); return a && a.alive; }, B2, 30000);
    check(!!seenB2, 'Host: Puppe für Bert angelegt und eingesetzt');
    // Flagge A an Team A (Host-Modus) → Abbild bei den Clients
    await ev(host, () => { const m = window.__game.mode; const f = m.objectives[0]; f.control = 1; m._capture(f, 'A'); });
    const flagSync = await Promise.all([c1, c2].map((p) => until(p, () => { const f = window.__game.mode && window.__game.mode.objectives[0]; return f && f.owner === 'A' && f.id; }, null, 15000)));
    check(flagSync.every(Boolean), `Flagge ${flagSync[0]} gehört bei Anna und Bert Team A`);
    const capEv = await ev(c1, () => window.__mp.objectives.some((o) => o.team === 'A'));
    check(capEv, "Anna: 'objective:captured' (HUD-Hinweis) aus dem Host-Zustand");
    // Kick mitten im Match
    await ev(host, (id) => window.__game.net.kick(id, 'Test-Kick'), A);
    const kickedOut = await until(c1, () => window.__game.match.state === 'lobby' && !window.__game.net.online, null, 30000);
    const annaGone = await until(host, (id) => !window.__game.net.actorById(id), A, 15000);
    check(!!kickedOut && !!annaGone, 'Kick: Anna zurück in der Lobby, Puppe beim Host entfernt');
    check(!!(await until(c2, (id) => !window.__game.net.actorById(id), A, 15000)), 'Bert: Annas Puppe entfernt');
    // Host verlässt das laufende Match (Pausenmenü „Match verlassen“) → Bert zurück in den Raum
    await ev(host, () => window.__game.menus.onQuit());
    check(!!(await until(c2, () => window.__game.match.state === 'lobby' && window.__game.menus.current === 'room' && window.__game.net.online, null, 60000)), "Host bricht ab: Bert bekommt 'end' (abgebrochen) und ist zurück im Raum");

    // ================================================================== Abschuss bestätigt: Marke fallen lassen + aufsammeln
    await ev(host, () => window.__game.net.updateSettings({ mode: 'kc', map: 'hafen' }));
    await sleep(500);
    await ev(host, () => window.__game.net.startMatch());
    check(await bothInMatch([host, c2]), 'Abschuss bestätigt: Host + Bert im Match');
    await sleep(3000);
    const kcBefore = await ev(c2, () => ({ team: window.__game.player.team, score: window.__game.mode.scores[window.__game.player.team] || 0 }));
    const tagDrop = await ev(host, (bId) => {
      const G = window.__game;
      const T = G.THREE;
      const bert = G.net.actorById(bId);
      const bot = bert && window.__hostileBot(bert);
      if (!bert || !bot) return null;
      G.bots.setPuppet(bot, true);
      bot.body.teleport(new T.Vector3(bert.position.x + 0.8, bert.position.y, bert.position.z));
      G.combat.damage(bot, { amount: 500, attacker: bert, weaponId: 'ar_m17', zone: 'body', dir: new T.Vector3(1, 0, 0) });
      return { bot: bot.netId };
    }, rj.id);
    check(!!tagDrop, 'Host: Bot neben Berts Puppe ausgeschaltet (Marke fällt)');
    const picked = await until(c2, (n) => window.__mp.scores.includes('confirm') && (window.__game.mode.scores[window.__game.player.team] || 0) >= n + 1, kcBefore.score, 90000);
    check(!!picked, "Bert: Marke bestätigt (Host-Aufsammeln, Punkt 'confirm' + Teampunkt)");
    const tagsLeft = await until(c2, () => window.__game.mode.tags.length === 0, null, 20000);
    check(!!tagsLeft, 'Marke beim Client verschwunden');
    await ev(host, () => window.__game.debugApi.endMatch());
    check(!!(await until(c2, () => window.__game.match.state === 'ended', null, 60000)), 'Abschuss bestätigt endet auch bei Bert');

    // ================================================================== Jeder gegen jeden: Wertung je netId
    await Promise.all([host, c2].map((p) => ev(p, () => window.__game.menus.onQuit())));
    await until(host, () => window.__game.match.state === 'lobby', null, 30000);
    await ev(host, () => window.__game.net.updateSettings({ mode: 'ffa', map: 'hafen', teamSize: 2 }));
    await sleep(500);
    await ev(host, () => window.__game.net.startMatch());
    check(await bothInMatch([host, c2]), 'Jeder gegen jeden: Host + Bert im Match');
    const ffaTeams = await ev(c2, () => window.__game.actors.filter((a) => a.puppet).every((a) => a.team === null) && window.__game.player.team === null);
    check(ffaTeams, 'FFA: alle Puppen und der eigene Spieler ohne Team');
    await ev(host, () => {
      const G = window.__game;
      const bot = G.bots.bots.find((b) => !b.isRemoteHuman && b.alive);
      G.combat.damage(bot, { amount: 500, attacker: G.player, weaponId: 'ar_m17', zone: 'head', dir: new G.THREE.Vector3(1, 0, 0) });
    });
    const ffaScore = await until(c2, () => window.__game.mode.scores.net_1 >= 1 && window.__game.mode.standing(window.__game.player).leaderName, null, 30000);
    check(!!ffaScore, `FFA: Wertung des Hosts beim Client unter seiner Puppe (Führender laut HUD: ${ffaScore})`);
    // Online-Pause: Menü offen, Simulation läuft weiter (Host-Restzeit und die des Clients)
    await ev(host, () => window.__game.debugApi.pause());
    const snap = () => ev(host, () => ({ st: window.__game.match.state, live: window.__game.match.netLive, tl: window.__game.mode.timeLeft, el: window.__game.time.elapsed, fr: window.__game.time.frame }));
    const p1 = await snap();
    const b1 = await ev(c2, () => window.__game.mode.timeLeft);
    await sleep(5000);
    const p2 = await snap();
    const b2 = await until(c2, (b) => window.__game.mode.timeLeft < b - 0.05 && window.__game.mode.timeLeft, b1, 15000);
    check(p1.st === 'paused' && p1.live && p2.el > p1.el && p2.tl < p1.tl && !!b2, `Online-Pause beim Host: Menü offen, Zeit läuft weiter (Host ${p1.tl.toFixed(1)} → ${p2.tl.toFixed(1)} s, Bert ${b1.toFixed(1)} → ${b2 && b2.toFixed(1)} s)`);
    // Host-Tab verborgen: Bilder über den Worker-Takt (rAF ruht in echten Browsern)
    const hide = (on) => ev(host, (h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, on);
    await hide(true);
    const h1 = await snap();
    await sleep(4000);
    const h2 = await snap();
    await hide(false);
    check(h2.fr - h1.fr >= 20 && h2.el > h1.el, `verborgener Host-Tab: Hintergrund-Takt simuliert weiter (${h2.fr - h1.fr} Bilder in 4 s)`);
    await ev(host, () => window.__game.debugApi.endMatch());
    const ffaEnd = await until(c2, () => { const r = window.__game.lastResult; return window.__game.match.state === 'ended' && r && { winner: r.winner, placement: r.placement, won: r.playerWon, me: r.scoreboard.filter((x) => x.isPlayer).length }; }, null, 60000);
    // Sieger-Id aus Sicht des Clients: Host-Spieler → net_1, Berts Puppe → player, Bots unverändert
    const hostWinner = await ev(host, () => window.__game.lastResult && window.__game.lastResult.winner);
    const bertPuppetId = await ev(host, (id) => { const a = window.__game.net.actorById(id); return a ? a.id : null; }, rj.id);
    const expectWinner = hostWinner === 'player' ? 'net_1' : hostWinner === bertPuppetId ? 'player' : hostWinner;
    check(!!ffaEnd && ffaEnd.winner === expectWinner && ffaEnd.me === 1 && ffaEnd.placement >= 1, `FFA-Ende bei Bert: Sieger ${ffaEnd && ffaEnd.winner} (Host: ${hostWinner}), Platz ${ffaEnd && ffaEnd.placement}`);
  }

  const errs = Object.entries(errors).filter(([, l]) => l.length);
  check(!errs.length, `keine Seiten-/Konsolenfehler${errs.length ? `: ${errs.map(([n, l]) => `${n} ${l.length}`).join(', ')}` : ''}`);
} catch (err) {
  console.log('FEHL Abbruch:', err && err.stack || err);
  fail++;
  for (const [n, p] of Object.entries(pages)) await shot(p, `fehler-${n}`);
} finally {
  if (!opt.keep) await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
