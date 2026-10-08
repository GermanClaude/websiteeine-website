// NULLPUNKT – Mehrspieler-Lasttest (Stufe 1): ein echter Host (spielen.html, SwiftShader, niedrige Qualität, kleines Fenster)
// + 12 leichte Last-Clients (dev/fake-client.html: nur NetSystem, kein WebGL) über das lokale Nostr-Relay.
//   1. Host öffnet TDM auf Hafen mit teamSize 16 und startet allein (31 Bots + Host = 32 Akteure) → Bildrate „vorher“.
//   2. 12 Last-Clients treten dem laufenden Match bei (welcome.cfg → 'loadout' → 'ready'), laufen glaubhaft im Kreis
//      (30 Hz PKT_STATE) und melden ab und zu Treffer → je Beitritt verlässt ein Bot das Match (weiter 32 Akteure).
//   3. Messfenster: Bildrate/Bildzeit des Hosts, Bytes/s je Client und gesamt (Nutzlast + ~60 Byte Kopf je Paket),
//      Schnappschussgröße, G.net.recommendation(), Anti-Cheat-Protokoll (Bewegung muss 0 sein), Treffer, Seitenfehler.
//   4. 4 Clients gehen → Bots füllen nach; Matchende → alle Clients bekommen 'end'.
// Ergebnis: tools/out/mp-load.json. Voraussetzung: Server 8765 + node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/mp-load-test.mjs [--clients=12] [--mode=tdm|ffa] [--seconds=30] [--params="netlag=…"] [--keep]
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const RELAY = process.env.NP_RELAY || 'ws://127.0.0.1:7777';
const N = Math.max(1, Math.min(31, Number(opt.clients) || 12));
const MODE = opt.mode === 'ffa' ? 'ffa' : 'tdm';
const TEAM = MODE === 'ffa' ? 16 : 16; // FFA: 2 × teamSize Teilnehmer, TDM: 16 je Team → immer 32 Akteure
const SECONDS = Math.max(10, Number(opt.seconds) || 30);
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
const load = () => { try { return readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number); } catch { return [0, 0, 0]; } };

async function waitForLoad() {
  for (let i = 0; i < 10; i++) {
    const [l1] = load();
    if (!(l1 > 6)) return;
    info(`Last ${l1} > 6 – warte 60 s`);
    await sleep(60000);
  }
}
await waitForLoad();

const errors = {};
const watch = (name, p) => {
  errors[name] = [];
  p.on('pageerror', (e) => { errors[name].push(`[pageerror] ${e.message}`); console.log(`[${name}] Seitenfehler: ${e.message}`); });
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/favicon|Failed to load resource|net::ERR_|WebGL|GL_INVALID|AudioContext/i.test(text)) return;
    errors[name].push(text);
    console.log(`[${name}] Konsole: ${text.slice(0, 300)}`);
  });
};
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

/** Bildrate des Hosts über ms messen (rAF-Abstände): {fps, avgMs, p95Ms, maxMs, frames}. */
const measureFrames = (p, ms) => p.evaluate((dur) => new Promise((resolve) => {
  const dts = [];
  let last = null;
  const t0 = performance.now();
  const step = (now) => {
    if (last != null) dts.push(now - last);
    last = now;
    if (now - t0 < dur) requestAnimationFrame(step);
    else {
      dts.sort((a, b) => a - b);
      const sum = dts.reduce((a, b) => a + b, 0);
      resolve({ frames: dts.length, fps: Math.round((dts.length / (sum / 1000)) * 10) / 10, avgMs: Math.round(sum / Math.max(1, dts.length)), p95Ms: Math.round(dts[Math.floor(dts.length * 0.95)] || 0), maxMs: Math.round(dts[dts.length - 1] || 0) });
    }
  };
  requestAnimationFrame(step);
}), ms);

/** Host: Bytes je Client zählen (zuverlässig + schnell, Nutzlast + 60 Byte Kopf je Paket wie UploadMeter). */
const instrumentHost = (p) => p.evaluate(() => {
  const N = window.__game.net;
  const G = window.__game;
  const m = (window.__bytes = { per: {}, rel: {}, pkts: {}, snapBytes: 0, snaps: 0, snapEnts: 0, since: performance.now(), game0: G.time.elapsed });
  const add = (id, n) => { m.per[id] = (m.per[id] || 0) + n + 60; m.pkts[id] = (m.pkts[id] || 0) + 1; };
  const origJson = N._sendJsonTo.bind(N);
  // zuverlässig je Typ in drei Töpfen: 'real' = Echtzeit-getrieben (Modus bei Änderung/≥ 1 Hz, Roster, Akteursliste …),
  // 'fake' = von den Treffermeldungen der Last-Clients ausgelöst (Treffer/Abschüsse mit Last-Client als Angreifer, Punkte),
  // 'game' = Spielzeit-getrieben (Bots: Treffer, Abschüsse, Spawns, Granaten/Explosionen) – wird auf Spielzeit = Echtzeit
  // hochgerechnet (SwiftShader-Host: ein Bild ≤ 50 ms Spielzeit, bei 1–2 FPS läuft das Spiel nur mit ≈ 7 % Echtzeit)
  m.real = 0; m.game = 0; m.fake = 0; m.types = {};
  const fakeId = (re, json) => { const v = Number((re.exec(json) || [])[1]); return v > 1 && v < 1000; };
  N._sendJsonTo = (peer, json) => {
    const ok = origJson(peer, json);
    if (ok && peer && peer.id) {
      const n = json.length + 60;
      add(peer.id, json.length);
      m.rel[peer.id] = (m.rel[peer.id] || 0) + n;
      const t = (/^\{"t":"([^"]+)"/.exec(json) || [])[1] || '?';
      const ev = t === 'ev' ? (/"e":"([^"]+)"/.exec(json) || [])[1] : null;
      let pot = 'game';
      if ((t === 'hit' && fakeId(/"attacker":(\d+)/, json)) || (t === 'kill' && fakeId(/"killer":(\d+)/, json)) || ev === 'sc' || ev === 'md') pot = 'fake';
      else if (!['hit', 'kill', 'spawn', 'ev'].includes(t)) pot = 'real';
      m[pot] += n;
      const k = ev ? `ev:${ev}` : t;
      const e = (m.types[k] = m.types[k] || { real: 0, game: 0, fake: 0, n: 0 });
      e[pot] += n;
      e.n++;
    }
    return ok;
  };
  const origFast = N.sendFast.bind(N);
  N.sendFast = (to, buf, ex) => {
    const n = origFast(to, buf, ex);
    if (n && typeof to === 'number') { add(to, buf.byteLength); if (new DataView(buf).getUint8(0) === 1) { m.snaps++; m.snapBytes += buf.byteLength; m.snapEnts += new DataView(buf).getUint16(9, true); } }
    return n;
  };
  window.__resetBytes = () => { m.per = {}; m.rel = {}; m.pkts = {}; m.snapBytes = 0; m.snaps = 0; m.snapEnts = 0; m.real = 0; m.game = 0; m.fake = 0; m.types = {}; m.since = performance.now(); m.game0 = G.time.elapsed; };
});
const hostBytes = (p) => p.evaluate(() => { const m = window.__bytes; return { ...m, sec: (performance.now() - m.since) / 1000, gameSec: window.__game.time.elapsed - m.game0 }; });
const hostView = (p) => p.evaluate(() => {
  const G = window.__game;
  const bots = G.bots.bots.filter((b) => !b.isRemoteHuman);
  const by = { A: 0, B: 0, none: 0 };
  for (const b of bots) by[b.team === 'A' ? 'A' : b.team === 'B' ? 'B' : 'none']++;
  const puppets = G.bots.bots.filter((b) => b.isRemoteHuman);
  return {
    state: G.match.state, roster: G.net.roster.length, humansA: G.net.roster.filter((r) => r.team !== 'B').length, humansB: G.net.roster.filter((r) => r.team === 'B').length,
    bots: bots.length, botsBy: by, puppets: puppets.length, alivePuppets: puppets.filter((b) => b.alive).length, actors: G.actors.filter((a) => Number.isInteger(a.netId)).length,
  };
});

const hostBrowser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const fakeBrowser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const result = { clients: N, mode: MODE, map: 'hafen', teamSize: TEAM, params: EXTRA.slice(1) || null, load: {} };
try {
  // ================================================================== Host allein (32 Akteure: Host + 31 Bots)
  const hctx = await hostBrowser.newContext({ viewport: { width: 480, height: 270 } });
  const host = await hctx.newPage();
  watch('Host', host);
  await host.goto(`${BASE}spielen.html?quality=low&relays=${encodeURIComponent(RELAY)}${EXTRA}`);
  await host.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 120000 });
  await host.evaluate(() => window.__game.settings.set('playerName', 'Host'));
  const code = await host.evaluate(([mode, ts]) => window.__game.net.host({
    name: 'Lasttest', mode, map: 'hafen', maxPlayers: 32, teamSize: ts, pvp: 'pvp', botFill: true, difficulty: 'rekrut', weather: 'standard', time: 'standard', style: 'arcade',
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code), [MODE, TEAM]);
  check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code} (${MODE}, Hafen, teamSize ${TEAM})`);
  await host.evaluate(() => window.__game.net.startMatch());
  const playing = await until(host, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 240000, 1000);
  check(!!playing, 'Host im Match (playing)');
  // Host unverwundbar und ruhig (Messung ohne Todesbildschirm-Wechsel), Zeit reicht für den ganzen Test
  await host.evaluate(() => { const G = window.__game; G.player.invulnerable = true; G.mode.timeLeft = 3600; });
  await instrumentHost(host);
  const v0 = await hostView(host);
  info(`Host allein: ${v0.actors} Akteure (${v0.bots} Bots ${JSON.stringify(v0.botsBy)})`);
  await sleep(5000);
  result.load.before = load();
  const before = await measureFrames(host, 15000);
  result.hostBefore = before;
  info(`Host vorher: ${before.fps} FPS, Bildzeit Ø ${before.avgMs} ms, p95 ${before.p95Ms} ms (Last ${result.load.before.join(' ')})`);

  // ================================================================== 12 Last-Clients treten bei
  const fakes = [];
  for (let i = 0; i < N; i++) {
    const ctx = await fakeBrowser.newContext({ viewport: { width: 320, height: 200 } });
    const p = await ctx.newPage();
    const name = `Last${String(i + 1).padStart(2, '0')}`;
    watch(name, p);
    await p.goto(`${BASE}dev/fake-client.html?name=${name}&relays=${encodeURIComponent(RELAY)}${EXTRA}`);
    await p.waitForFunction(() => window.__fake && window.__fake.st.ready, null, { timeout: 60000 });
    fakes.push({ name, p });
  }
  info(`${N} Last-Client-Seiten geladen (eigener Browser ohne WebGL)`);
  const joins = [];
  for (let i = 0; i < N; i += 4) {
    const batch = fakes.slice(i, i + 4);
    joins.push(...(await Promise.all(batch.map((f) => f.p.evaluate((c) => window.__fake.join(c), code)))));
  }
  check(joins.every((j) => j.ok), `${joins.filter((j) => j.ok).length}/${N} Last-Clients treten dem laufenden Match bei (${joins.map((j) => (j.ok ? j.id : j.code)).join(',')})`);
  const spawned = await Promise.all(fakes.map((f) => until(f.p, () => window.__fake.st.spawns >= 1, null, 90000, 1000)));
  check(spawned.every(Boolean), `alle ${N} Last-Clients gespawnt ('spawn' vom Host, Bewegung ab dem Spawnpunkt)`);
  await until(host, (n) => window.__game.bots.bots.filter((b) => b.isRemoteHuman).length === n, N, 30000);
  await sleep(4000);
  const v1 = await hostView(host);
  const humans = N + 1;
  const wantBots = MODE === 'ffa' ? 2 * TEAM - humans : 2 * TEAM - humans;
  check(v1.puppets === N && v1.bots === wantBots && v1.actors === 32, `Host: ${v1.puppets} Puppen, ${v1.bots} Bots ${JSON.stringify(v1.botsBy)}, Menschen A ${v1.humansA}/B ${v1.humansB}, ${v1.actors} Akteure (erwartet ${wantBots} Bots, 32 Akteure)`);
  result.rosterIn = v1;

  // ================================================================== Messfenster
  await host.evaluate(() => window.__resetBytes());
  const fakeStart = await Promise.all(fakes.map((f) => f.p.evaluate(() => window.__fake.stats())));
  result.load.during = load();
  const during = await measureFrames(host, SECONDS * 1000);
  result.hostWith = during;
  const bytes = await hostBytes(host);
  const fakeEnd = await Promise.all(fakes.map((f) => f.p.evaluate(() => window.__fake.stats())));
  info(`Host mit ${N} Clients: ${during.fps} FPS, Bildzeit Ø ${during.avgMs} ms, p95 ${during.p95Ms} ms, max ${during.maxMs} ms (Last ${result.load.during.join(' ')})`);
  const perClient = Object.values(bytes.per).map((b) => b / bytes.sec);
  const totalUp = perClient.reduce((a, b) => a + b, 0);
  const snapAvg = bytes.snaps ? bytes.snapBytes / bytes.snaps : 0;
  const entAvg = bytes.snaps ? bytes.snapEnts / bytes.snaps : 0;
  const snapRate = bytes.snaps / bytes.sec / Math.max(1, perClient.length);
  // Hochrechnung auf einen flüssigen Host (20 Schnappschüsse/s, Spielzeit = Echtzeit): SwiftShader schafft nur wenige
  // Bilder/s, der Host schickt höchstens einen Schnappschuss je Bild und Ereignisse folgen der (gedrosselten) Spielzeit
  const relPer = Object.values(bytes.rel);
  const nCl = Math.max(1, relPer.length);
  const relReal = relPer.reduce((a, b) => a + b, 0) / nCl / bytes.sec;
  // hochgerechnet: Echtzeit-Teil je Sekunde + Bot-Ereignisse je Spielsekunde (Spielzeit = Echtzeit), skaliert auf alle 32
  // Akteure (die Menschen kämpfen so viel wie Bots: × 32 / Bots); die künstlichen Treffermeldungen der Last-Clients zählen
  // dabei nicht (sie sind in der Skalierung enthalten)
  const gameSec = Math.max(1e-3, bytes.gameSec);
  const fightScale = 32 / Math.max(1, v1.bots);
  const relGame = bytes.real / nCl / bytes.sec + (bytes.game / nCl / gameSec) * fightScale;
  const at20 = (snapAvg + 60) * 20 + relGame;
  result.reliableTypes = Object.fromEntries(Object.entries(bytes.types).map(([k, v]) => [k, {
    n: v.n, realBps: Math.round((v.real + v.fake) / nCl / bytes.sec), projBps: Math.round(v.real / nCl / bytes.sec + (v.game / nCl / gameSec) * fightScale),
  }]));
  result.bandwidth = {
    perClientAvg: Math.round(perClient.reduce((a, b) => a + b, 0) / Math.max(1, perClient.length)), perClientMax: Math.round(Math.max(...perClient)),
    totalUpload: Math.round(totalUp), snapshotAvgBytes: Math.round(snapAvg), snapshotAvgEntities: Math.round(entAvg * 10) / 10, snapshotsPerClientPerSec: Math.round(snapRate * 10) / 10,
    reliablePerClientReal: Math.round(relReal), reliablePerClientGame: Math.round(relGame), gameSeconds: Math.round(bytes.gameSec * 10) / 10, fightScale: Math.round(fightScale * 100) / 100,
    perClientAt20Hz: Math.round(at20), totalAt20Hz: Math.round(at20 * perClient.length), share: Math.round((entAvg / 32) * 100) / 100,
    seconds: Math.round(bytes.sec),
  };
  info(`Upload Host (gemessen bei ${during.fps} FPS): je Client Ø ${(result.bandwidth.perClientAvg / 1024).toFixed(1)} KB/s (max ${(result.bandwidth.perClientMax / 1024).toFixed(1)}), gesamt ${(totalUp / 1024).toFixed(1)} KB/s; Schnappschuss Ø ${result.bandwidth.snapshotAvgBytes} B (${result.bandwidth.snapshotAvgEntities} von 32 Akteuren = ${result.bandwidth.share}), ${result.bandwidth.snapshotsPerClientPerSec}/s je Client; zuverlässig ${result.bandwidth.reliablePerClientReal} B/s gemessen; hochgerechnet (Spielzeit = Echtzeit, ${result.bandwidth.gameSeconds} s Spielzeit gemessen, Kämpfe × ${result.bandwidth.fightScale}) ${result.bandwidth.reliablePerClientGame} B/s; je Typ (gemessen → hochgerechnet B/s) ${Object.entries(result.reliableTypes).map(([k, v]) => `${k} ${v.n}× ${v.realBps}→${v.projBps}`).join(', ')}`);
  info(`Hochgerechnet auf 20 Schnappschüsse/s: je Client ${(at20 / 1024).toFixed(1)} KB/s, gesamt ${(at20 * perClient.length / 1024).toFixed(0)} KB/s für ${perClient.length} Clients`);
  // Empfang der Clients (Gegenprobe) und deren Upload
  const recv = fakeEnd.map((e, i) => ({ inBps: (e.bytesIn - fakeStart[i].bytesIn) / (e.sec - fakeStart[i].sec), outBps: (e.sentBytes - fakeStart[i].sentBytes) / (e.sec - fakeStart[i].sec), sendHz: (e.sent - fakeStart[i].sent) / (e.sec - fakeStart[i].sec), snapHz: (e.snaps - fakeStart[i].snaps) / (e.sec - fakeStart[i].sec) }));
  result.clientsRecv = {
    inAvg: Math.round(recv.reduce((a, r) => a + r.inBps, 0) / recv.length), outAvg: Math.round(recv.reduce((a, r) => a + r.outBps, 0) / recv.length),
    sendHz: Math.round((recv.reduce((a, r) => a + r.sendHz, 0) / recv.length) * 10) / 10, snapHz: Math.round((recv.reduce((a, r) => a + r.snapHz, 0) / recv.length) * 10) / 10,
  };
  info(`Clients: Empfang Ø ${(result.clientsRecv.inAvg / 1024).toFixed(1)} KB/s Nutzlast (${result.clientsRecv.snapHz} Schnappschüsse/s), Senden Ø ${result.clientsRecv.outAvg} B/s (${result.clientsRecv.sendHz} Zustände/s)`);
  const rec = await host.evaluate(() => window.__game.net.recommendation());
  result.recommendation = rec;
  check(rec && rec.measured === true, `Empfehlung gemessen: bis ${rec && rec.max} Spieler („${rec && rec.reason}“, Upload ${rec && rec.upload} B/s, ${rec && rec.fps} FPS, ${rec && rec.cores} Kerne)`);
  // Anti-Cheat
  const ac = await host.evaluate(() => (window.__game.net.anticheat ? window.__game.net.anticheat.log.map((l) => ({ peer: l.peer, reason: l.reason, detail: l.detail })) : []));
  const MOVE = new Set(['tempo', 'teleport', 'steigen', 'korrektur']);
  const moveFp = ac.filter((l) => MOVE.has(l.reason));
  const byReason = {};
  for (const l of ac) byReason[l.reason] = (byReason[l.reason] || 0) + 1;
  result.anticheat = { total: ac.length, byReason, movement: moveFp.length };
  const corrects = fakeEnd.reduce((a, e) => a + e.corrects, 0);
  check(moveFp.length === 0 && corrects === 0, `Anti-Cheat: 0 Bewegungs-Verstöße bei glaubhafter Bewegung (${moveFp.length}, 'correct' an Clients: ${corrects}); Protokoll gesamt ${JSON.stringify(byReason)}`);
  if (moveFp.length) info(`Bewegungs-Verstöße: ${JSON.stringify(moveFp.slice(0, 8))}`);
  const claims = fakeEnd.reduce((a, e) => a + e.claims, 0);
  const confirmed = fakeEnd.reduce((a, e) => a + e.confirmed, 0);
  const deaths = fakeEnd.reduce((a, e) => a + e.deaths, 0);
  const spawns = fakeEnd.reduce((a, e) => a + e.spawns, 0);
  result.combat = { claims, confirmed, deaths, spawns, kills: fakeEnd.reduce((a, e) => a + e.kills, 0) };
  check(claims > 0 && confirmed > 0, `Treffermeldungen: ${claims} gesendet, ${confirmed} vom Host bestätigt ('hit' mit Client als Angreifer); Tode ${deaths}, Spawns ${spawns}`);
  // ein Schnappschuss je Host-Bild (höchstens 20/s): bei SwiftShader-Bildraten also ≈ FPS
  check(during.frames > 0 && result.clientsRecv.snapHz >= Math.min(20, during.fps) * 0.7, `Host liefert jedem Client einen Schnappschuss je Bild (${result.clientsRecv.snapHz}/s je Client bei ${during.fps} FPS)`);

  // ================================================================== Tod + Wiedereinstieg unter Last (Spawn-Sprünge dürfen nicht anschlagen)
  const acBefore = ac.length;
  const victims = await host.evaluate((ids) => {
    const G = window.__game;
    G.mode.respawnDelay = 0.4;
    const out = [];
    for (const id of ids) {
      const a = G.net.actorById(id);
      const bot = a && G.bots.bots.find((b) => !b.isRemoteHuman && G.combat.isHostile(b, a));
      if (a && a.alive && bot) { G.combat.damage(a, { amount: 500, attacker: bot, weaponId: 'ar_m17', zone: 'head', dir: new G.THREE.Vector3(1, 0, 0) }); out.push(id); }
    }
    return out;
  }, joins.filter((j) => j.ok).slice(-3).map((j) => j.id));
  const victimPages = fakes.filter((f, i) => joins[i].ok && victims.includes(joins[i].id));
  const respawned = await Promise.all(victimPages.map((f) => until(f.p, () => window.__fake.st.deaths >= 1 && window.__fake.st.spawns >= 2 && window.__fake.st.alive, null, 120000, 1000)));
  await sleep(5000);
  const acAfterRespawn = await host.evaluate(() => window.__game.net.anticheat.log.map((l) => ({ peer: l.peer, reason: l.reason })));
  const newMove = acAfterRespawn.slice(acBefore).filter((l) => MOVE.has(l.reason));
  check(victims.length > 0 && respawned.every(Boolean) && newMove.length === 0, `Tod + Wiedereinstieg unter Last: ${victims.length} Clients abgeschossen, alle wieder im Kreis am neuen Spawnpunkt, Bewegungs-Verstöße danach ${newMove.length}`);

  // ================================================================== 4 Clients gehen → Bots füllen nach
  const leaving = fakes.slice(0, Math.min(4, N));
  const vBefore = await hostView(host);
  await Promise.all(leaving.map((f) => f.p.evaluate(() => window.__fake.leave())));
  const refilled = await until(host, ([n, b]) => window.__game.bots.bots.filter((x) => x.isRemoteHuman).length === n && window.__game.bots.bots.filter((x) => !x.isRemoteHuman).length === b, [N - leaving.length, vBefore.bots + leaving.length], 30000);
  const v2 = await hostView(host);
  result.rosterAfterLeave = v2;
  check(!!refilled && v2.actors === 32, `${leaving.length} Clients gehen: Puppen ${vBefore.puppets} → ${v2.puppets}, Bots ${vBefore.bots} → ${v2.bots} ${JSON.stringify(v2.botsBy)}, Roster ${v2.roster}, ${v2.actors} Akteure`);

  // ================================================================== Matchende
  await host.evaluate(() => window.__game.debugApi.endMatch());
  const ends = await Promise.all(fakes.slice(leaving.length).map((f) => until(f.p, () => window.__fake.st.ended, null, 30000)));
  check(ends.every(Boolean), `Matchende: alle ${ends.length} verbliebenen Clients bekommen 'end'`);
  const fakeErr = fakeEnd.flatMap((e) => e.errors);
  const errs = Object.entries(errors).filter(([, l]) => l.length);
  check(!errs.length && !fakeErr.length, `keine Seiten-/Konsolenfehler${errs.length ? `: ${errs.map(([n, l]) => `${n} ${l.length}`).join(', ')}` : ''}${fakeErr.length ? ` (Clients: ${fakeErr.join(' | ')})` : ''}`);
  result.load.after = load();
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  writeFileSync(`${OUT}/mp-load.json`, JSON.stringify(result, null, 2));
  if (!opt.keep) { await fakeBrowser.close(); await hostBrowser.close(); }
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
