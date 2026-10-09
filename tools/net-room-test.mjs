// NULLPUNKT – Prüft NetSystem (net/index.js) mit Host + mehreren Clients in Headless-Browsern über ein lokales Relay:
// Beitritt, Roster-Abgleich, Teamausgleich, Einstellungen, Teamwechsel, voller Raum, Nachrichten (zuverlässig/schnell,
// Weiterleitung), Zeitabgleich, Empfehlung, Spielstart (cfg an alle), bereit, Kick (+ Sperre), Austritt, schnelles Spiel
// (öffentliche Liste, Einstieg ins laufende Spiel), Versionsprüfung, Host im Hintergrund, Host beendet.
// Voraussetzung: Server auf 8765 und node tools/nostr-relay.mjs 7777. Ein Browser, mehrere Kontexte.
// Aufruf: node tools/net-room-test.mjs
import { chromium, BASE } from './pw.mjs';

const RELAY = process.env.NP_RELAY || 'ws://127.0.0.1:7777';
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
let fail = 0;
let count = 0;
const check = (ok, text) => { count++; console.log((ok ? 'OK   ' : 'FEHL ') + text); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = {};

async function open(name, extra = '') {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] Seitenfehler:`, e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] Konsole:`, m.text()); });
  await p.goto(`${BASE}dev/net-room.html?name=${encodeURIComponent(name)}&relays=${RELAY}${extra}`);
  await p.waitForFunction(() => window.__room && window.__room.ready, null, { timeout: 15000 });
  pages[name] = p;
  return p;
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const join = (p, code, name, opts = {}) => p.evaluate(async ([c, n, o]) => {
  if (o.timeout) window.__room.net.joinTimeout = o.timeout;
  try { const r = await window.__room.net.join(c, { name: n }); return { ok: true, id: r.id, team: r.team }; } catch (e) { return { ok: false, code: e.code, text: e.message }; }
}, [code, name, opts]);
const waitFor = (p, fn, arg, timeout = 10000) => p.waitForFunction(fn, arg, { timeout }).then(() => true).catch(() => false);
const roster = (p) => p.evaluate(() => window.__room.net.roster.map((r) => ({ id: r.id, name: r.name, team: r.team, ready: r.ready, isHost: r.isHost, ping: r.ping, loadout: r.loadout })));
const sig = (r) => r.map((e) => `${e.id}:${e.name}:${e.team}`).sort().join(',');

try {
  // ------------------------------------------------------------------ Host
  const host = await open('Hosti', '&level=12');
  const code = await ev(host, () => window.__room.net.host({
    name: 'Prüfraum', mode: 'tdm', map: 'hafen', maxPlayers: 3, teamSize: 4, pvp: 'pvp', botFill: true, public: true,
    weather: 'zufall', time: 'zufall', difficulty: 'veteran',
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
  check(/^[A-HJ-NP-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
  const hs = await ev(host, () => ({ online: window.__room.net.online, role: window.__room.net.role, selfId: window.__room.net.selfId, room: window.__room.net.room }));
  check(hs.online && hs.role === 'host' && hs.selfId === 1 && hs.room.state === 'lobby' && hs.room.settings.maxPlayers === 3 && hs.room.settings.name === 'Prüfraum', 'Host-Zustand (online, role, selfId 1, room)');
  check(await ev(host, () => ['net:status', 'net:room', 'net:roster', 'net:recommend'].every((n) => window.__room.events.some((e) => e.name === n))), 'Host-Ereignisse net:status/room/roster/recommend');

  // ------------------------------------------------------------------ zwei Clients gleichzeitig
  const c1 = await open('Anna', '&level=7');
  const c2 = await open('Bert', '&level=3&primary=smg_vp9');
  const t0 = Date.now();
  const [j1, j2] = await Promise.all([join(c1, code.toLowerCase(), 'Anna'), join(c2, code, 'Bert')]);
  check(j1.ok && j2.ok, `zwei Clients treten gleichzeitig bei (${Date.now() - t0} ms) ${j1.ok ? '' : j1.code} ${j2.ok ? '' : j2.code}`);
  check(new Set([j1.id, j2.id]).size === 2 && [j1.id, j2.id].every((i) => i === 2 || i === 3), `netIds ${j1.id}, ${j2.id} (ab 2)`);
  check([j1.team, j2.team].sort().join('') === 'AB', `Teamausgleich: ${j1.team}/${j2.team} (Host A → einer A, einer B)`);
  const synced3 = await Promise.all([c1, c2].map((p) => waitFor(p, () => window.__room.net.roster.length === 3)));
  const r0 = await roster(host);
  const r1 = await roster(c1);
  const r2 = await roster(c2);
  check(synced3.every(Boolean) && sig(r0) === sig(r1) && sig(r1) === sig(r2) && r0.length === 3, `Roster auf allen gleich: ${sig(r0)}`);
  check(r1.find((e) => e.id === 1).isHost && r1.find((e) => e.name === 'Bert').loadout.primary === 'smg_vp9', 'Roster: Host markiert, Ausrüstung übertragen');
  check(await ev(host, () => window.__room.events.filter((e) => e.name === 'net:peer' && e.p.joined).length) === 2, 'Host: net:peer joined ×2');

  // ------------------------------------------------------------------ voller Raum
  const c3 = await open('Cleo');
  const j3 = await join(c3, code, 'Cleo');
  check(!j3.ok && j3.code === 'abgelehnt:voll', `voller Raum → ${j3.code}`);

  // ------------------------------------------------------------------ Einstellungen
  await ev(host, () => window.__room.net.updateSettings({ maxPlayers: 4, map: 'altstadt', weather: 'dunst', teamSize: 5, mode: 'gun' }));
  const gotRoom = await waitFor(c1, () => window.__room.net.room.settings.map === 'altstadt' && window.__room.net.room.settings.maxPlayers === 4);
  const s1 = await ev(c1, () => window.__room.net.room.settings);
  check(gotRoom && s1.weather === 'dunst' && s1.teamSize === 5 && s1.mode === 'tdm', `Einstellungen an Clients verteilt (Karte ${s1.map}, ${s1.maxPlayers} Spieler, Modus „gun“ online abgelehnt → ${s1.mode})`);
  check(await ev(c1, () => window.__room.events.some((e) => e.name === 'net:room' && e.p.room.settings.map === 'altstadt')), 'Client: net:room-Ereignis');
  await ev(host, () => window.__room.net.updateSettings({ teamSize: 4 }));
  // Fahrzeuge (panzer-mp.md §C.1): Standard = VEHICLES_ONLINE_DEFAULT, Außenansicht an, Nachladen manuell; Normalisierung
  const vdef = await ev(host, async () => (await import('../assets/js/game/net/index.js')).VEHICLES_ONLINE_DEFAULT);
  check(typeof vdef === 'boolean' && s1.vehicles === vdef && s1.thirdPerson === true && s1.vehReload === 'manuell', `Fahrzeug-Standard: vehicles ${s1.vehicles} (= ${vdef}), thirdPerson an, vehReload manuell`);
  const norm = await ev(host, async () => {
    const m = await import('../assets/js/game/net/index.js');
    const n = m.normalizeSettings;
    return {
      missing: n({ mode: 'tdm' }, { mode: 'tdm' }).vehicles, onOff: [n({ vehicles: true }).vehicles, n({ vehicles: false }).vehicles, n({ vehicles: 'ja' }).vehicles],
      keep: n({ teamSize: 3 }, { ...m.DEFAULT_ROOM, vehicles: !m.VEHICLES_ONLINE_DEFAULT }).vehicles,
      tp: [n({}).thirdPerson, n({ thirdPerson: false }).thirdPerson, n({ thirdPerson: 0 }).thirdPerson],
      rl: [n({ vehReload: 'automatisch' }).vehReload, n({ vehReload: 'quatsch' }).vehReload, n({}).vehReload], def: m.VEHICLES_ONLINE_DEFAULT,
    };
  });
  check(norm.missing === norm.def && norm.onOff.join() === 'true,false,false' && norm.keep === !norm.def, `normalizeSettings vehicles: fehlt → Standard, sonst Wahrheitswert, Basis bleibt (${JSON.stringify(norm.onOff)})`);
  check(norm.tp.join() === 'true,false,true' && norm.rl.join() === 'automatisch,manuell,manuell', `normalizeSettings thirdPerson (nur false = aus) / vehReload (${norm.rl.join(', ')})`);
  await ev(host, () => window.__room.net.updateSettings({ vehicles: true, thirdPerson: false, vehReload: 'automatisch' }));
  const gotVeh = await waitFor(c2, () => window.__room.net.room.settings.thirdPerson === false && window.__room.net.room.settings.vehReload === 'automatisch');
  check(gotVeh, 'Fahrzeug-Einstellungen an Clients verteilt (thirdPerson aus, Nachladen automatisch)');

  const j3b = await join(c3, code, 'Cleo');
  check(j3b.ok && j3b.id === 4, `nach Erhöhung tritt Cleo bei (id ${j3b.id}, Team ${j3b.team})`);
  check((await Promise.all([host, c1, c2, c3].map((p) => waitFor(p, () => window.__room.net.roster.length === 4)))).every(Boolean), 'Roster mit 4 Spielern überall');

  // ------------------------------------------------------------------ Teamwechsel
  const otherTeam = j3b.team === 'A' ? 'B' : 'A';
  await ev(host, ([id, t]) => window.__room.net.setTeam(id, t), [4, otherTeam]);
  check(await waitFor(c1, ([id, t]) => window.__room.net.roster.some((r) => r.id === id && r.team === t), [4, otherTeam]), `Teamwechsel Cleo → ${otherTeam} kommt bei Anna an`);

  // ------------------------------------------------------------------ Nachrichten
  await ev(host, () => window.__room.net.send('all', { t: 'test-alle', x: 1 }));
  await ev(c1, () => window.__room.net.send(1, { t: 'test-host', y: 2 }));
  await ev(c1, () => window.__room.net.send('others', { t: 'chat', text: 'Hallo' }));
  const blocked = await ev(c1, () => window.__room.net.send('others', { t: 'kill', victim: 1 }));
  await ev(host, ([id]) => window.__room.net.send(id, { t: 'nur-du' }), [j2.id]);
  await sleep(600);
  const gotAll = await Promise.all([c1, c2, c3].map((p) => ev(p, () => window.__room.msgs.some((m) => m.m.t === 'test-alle' && m.from === 1))));
  check(gotAll.every(Boolean), 'send(all) vom Host erreicht alle Clients (from = 1)');
  check(await ev(host, ([id]) => window.__room.msgs.some((m) => m.m.t === 'test-host' && m.from === id && m.m.y === 2), [j1.id]), 'Client → Host (from = netId)');
  const chats = await Promise.all([host, c2, c3, c1].map((p) => ev(p, () => window.__room.msgs.filter((m) => m.m.t === 'chat').map((m) => m.from))));
  check(chats[0].length === 0 && chats[1][0] === j1.id && chats[2][0] === j1.id && chats[3].length === 0, `Weiterleitung 'others' über den Host (${JSON.stringify(chats)})`);
  check(blocked === 0 && !(await ev(c2, () => window.__room.msgs.some((m) => m.m.t === 'kill'))), 'Clients können keine Spielnachrichten (kill) an andere schicken');
  const onlyYou = await Promise.all([c1, c2].map((p) => ev(p, () => window.__room.msgs.some((m) => m.m.t === 'nur-du'))));
  check(!onlyYou[0] && onlyYou[1], 'send(netId) nur an diesen Client');
  // schnell: Snapshot Host → alle, Zustand Client → Host
  await ev(host, () => {
    const { proto, net } = window.__room;
    net.sendFast('all', proto.encodeSnapshot(42, net.serverTime(), [{ id: 1, x: 1.5, y: 2, z: -3, yaw: 0.5, weapon: 'ar_m17', hp: 90, flags: proto.FLAGS.ALIVE }]));
  });
  await ev(c2, () => { const { proto, net } = window.__room; net.sendFast(1, proto.encodeState(7, 1.25, { x: 4, y: 0, z: 5, weapon: 'smg_vp9', flags: 1 })); });
  await sleep(500);
  const snaps = await Promise.all([c1, c2, c3].map((p) => ev(p, () => {
    const f = window.__room.fast.find((x) => x.type === 1);
    if (!f) return null;
    const d = window.__room.proto.decodeSnapshot(f.buf);
    return { tick: d.tick, x: d.entities[0].x, w: d.entities[0].weaponId, from: f.from };
  })));
  check(snaps.every((s) => s && s.tick === 42 && s.x === 1.5 && s.w === 'ar_m17' && s.from === 1), 'sendFast(all): Snapshot bei allen Clients dekodiert');
  const state = await ev(host, () => { const f = window.__room.fast.find((x) => x.type === 2); if (!f) return null; const d = window.__room.proto.decodeState(f.buf); return { seq: d.seq, z: d.entity.z, w: d.entity.weaponId, from: f.from }; });
  check(state && state.seq === 7 && state.z === 5 && state.w === 'smg_vp9' && state.from === j2.id, `sendFast Client → Host: Zustand von ${state && state.from}`);

  // ------------------------------------------------------------------ Zeitabgleich + Laufzeit
  await sleep(2500);
  const hostClock = await ev(host, () => window.__room.net.serverTime() - Date.now() / 1000);
  for (const [name, p] of [['Anna', c1], ['Bert', c2], ['Cleo', c3]]) {
    const c = await ev(p, () => ({ d: window.__room.net.serverTime() - Date.now() / 1000, synced: window.__room.net.timeSynced, rtt: window.__room.net.peerRtt(1) }));
    const diff = Math.abs(c.d - hostClock) * 1000;
    check(c.synced && diff < 40, `${name}: Host-Zeit geschätzt, Abweichung ${diff.toFixed(1)} ms`);
    check(c.rtt > 0 && c.rtt < 200, `${name}: peerRtt(Host) ${c.rtt.toFixed(1)} ms`);
  }
  const hrtt = await ev(host, ([id]) => window.__room.net.peerRtt(id), [j1.id]);
  check(hrtt > 0 && hrtt < 200, `Host: peerRtt(Anna) ${hrtt.toFixed(1)} ms`);
  const pings = await waitFor(c1, () => window.__room.net.roster.filter((r) => !r.isHost).every((r) => r.ping > 0), null, 6000);
  check(pings, 'Roster enthält Pings der Clients');

  // ------------------------------------------------------------------ Empfehlung
  const rec = await ev(host, () => window.__room.net.recommendation());
  check(rec && Number.isInteger(rec.max) && rec.max >= 2 && rec.max <= 8 && rec.measured === false && typeof rec.reason === 'string' && 'cores' in rec && 'memory' in rec && 'upload' in rec && 'fps' in rec,
    `recommendation(): bis ${rec.max} Spieler – „${rec.reason}“ (Kerne ${rec.cores}, Speicher ${rec.memory}, gemessen ${rec.measured})`);

  // ------------------------------------------------------------------ Spielstart
  const hostCfg = await ev(host, () => window.__room.net.startMatch());
  const rosterNow = await roster(host);
  const humans = { A: rosterNow.filter((r) => r.team === 'A').length, B: rosterNow.filter((r) => r.team === 'B').length };
  check(hostCfg && hostCfg.net.role === 'host' && hostCfg.mapId === 'altstadt' && hostCfg.modeId === 'tdm' && hostCfg.difficulty === 'veteran', 'startMatch: Host-cfg (Rolle host, Karte, Modus, Schwierigkeit)');
  check(hostCfg.weather === 'dunst' && hostCfg.timeOfDay !== 'zufall' && typeof hostCfg.timeOfDay === 'string', `Wetter/Zeit aufgelöst: ${hostCfg.weather} / ${hostCfg.timeOfDay}`);
  check(hostCfg.allies === 4 - humans.A && hostCfg.enemies === 4 - humans.B && hostCfg.net.botsA === hostCfg.allies && hostCfg.net.humans.A === humans.A,
    `Bots + Menschen = teamSize 4 (Menschen ${humans.A}/${humans.B} → Bots ${hostCfg.allies}/${hostCfg.enemies})`);
  check(await ev(host, () => window.__room.started.length === 1 && window.__room.net.room.state === 'match'), 'Host startet selbst (startGame), Raum im Zustand match');
  const starts = await Promise.all([c1, c2, c3].map((p) => waitFor(p, () => window.__room.started.length === 1).then(() => ev(p, () => ({ cfg: window.__room.started[0], self: window.__room.net.selfId, state: window.__room.net.room.state, roster: window.__room.net.roster })))));
  check(starts.every((s) => s.cfg && s.cfg.net.role === 'client' && s.cfg.net.selfId === s.self && s.cfg.mapId === 'altstadt' && s.cfg.weather === hostCfg.weather && s.cfg.timeOfDay === hostCfg.timeOfDay && s.cfg.net.roomCode === code && s.state === 'match'),
    "'start' {cfg} bei allen Clients (Rolle client, eigene netId, gleiche Karte/Wetter/Zeit)");
  check(starts.every((s) => s.cfg.net.team === s.roster.find((r) => r.id === s.self).team), 'cfg.net.team = eigenes Team laut Roster');
  check([hostCfg, ...starts.map((s) => s.cfg)].every((c) => c.net.vehicles === true && c.net.thirdPerson === false && c.net.vehReload === 'automatisch'), 'cfg.net.vehicles/thirdPerson/vehReload bei Host und Clients');
  check(starts[1].cfg.loadout && starts[1].cfg.loadout.primary === 'smg_vp9' && starts[0].cfg.loadout.primary === 'ar_m17', 'Clients starten mit eigener Ausrüstung');
  // bereit
  await Promise.all([c1, c2].map((p) => ev(p, () => window.__room.net.onMatchStart(window.__room.started[0]))));
  check(await waitFor(host, ([a, b]) => window.__room.net.roster.filter((r) => r.ready).map((r) => r.id).sort().join() === [a, b].sort().join(), [j1.id, j2.id]), "'ready' von Anna und Bert im Host-Roster");

  check(!(await ev(host, () => window.__room.net.allReady())), 'allReady() = false, solange Cleo/Host nicht bereit sind');
  // Anti-Cheat-Helfer des Hosts: Teleport → 'correct' {pos} an den Client + Protokoll
  const acRes = await ev(host, ([id]) => {
    const n = window.__room.net;
    n.anticheat.onSpawn(id, [0, 0, 0], n.serverTime());
    n.checkState(id, { x: 0.1, y: 0, z: 0, flags: 65 });
    return n.checkState(id, { x: 50, y: 0, z: 0, flags: 65 });
  }, [j1.id]);
  check(acRes && !acRes.ok && acRes.reason === 'teleport', `checkState erkennt Teleport (${acRes && acRes.reason})`);
  check(await waitFor(c1, () => window.__room.msgs.some((m) => m.m.t === 'correct' && m.from === 1 && Math.abs(m.m.pos[0] - 0.1) < 1e-6)), "Client bekommt 'correct' {pos} vom Host");
  check(await ev(host, ([id]) => window.__room.net.anticheat.log.some((l) => l.peer === id && l.reason === 'teleport'), [j1.id]), 'Anti-Cheat-Protokoll {t, peer, reason}');

  // ------------------------------------------------------------------ Kick
  await ev(host, () => window.__room.net.kick(4, 'Test-Kick'));
  const kicked = await waitFor(c3, () => window.__room.events.some((e) => e.name === 'net:kicked' && e.p.reason === 'Test-Kick'));
  check(kicked && !(await ev(c3, () => window.__room.net.online)), 'Cleo bekommt net:kicked {reason} und ist offline');
  check(await waitFor(c1, () => window.__room.net.roster.length === 3 && !window.__room.net.roster.some((r) => r.id === 4)), 'Roster ohne Cleo bei Anna');
  const j3c = await join(c3, code, 'Cleo');
  check(!j3c.ok && j3c.code === 'abgelehnt:gekickt', `gekickter Client kann nicht wieder beitreten (${j3c.code})`);

  // ------------------------------------------------------------------ Austritt
  await ev(c2, () => window.__room.net.leave());
  check(await waitFor(host, ([id]) => window.__room.events.some((e) => e.name === 'net:peer' && e.p.id === id && e.p.joined === false), [j2.id]), 'Bert verlässt: Host bekommt net:peer joined:false');
  check(await waitFor(c1, () => window.__room.net.roster.length === 2), 'Roster bei Anna: 2 Spieler');
  check(!(await ev(c2, () => window.__room.net.online)) && !(await ev(c2, () => window.__room.events.some((e) => e.name === 'net:error'))), 'Bert offline ohne Fehlermeldung');

  // ------------------------------------------------------------------ Version
  await ev(c2, () => { window.__room.net.build = 'alte-fassung'; });
  const jv = await join(c2, code, 'Bert');
  check(!jv.ok && jv.code === 'abgelehnt:version', `andere Fassung → ${jv.code}`);

  // ------------------------------------------------------------------ Öffentliche Liste + schnelles Spiel (laufendes Spiel)
  const c4 = await open('Dora');
  const seen = await ev(c4, (c) => new Promise((resolve) => {
    const stop = window.__room.net.watchPublic((list) => { const g = list.find((x) => x.code === c); if (g) { stop(); resolve(g); } });
    setTimeout(() => { stop(); resolve(null); }, 12000);
  }), code);
  check(seen && seen.name === 'Prüfraum' && seen.map === 'altstadt' && seen.mode === 'tdm' && seen.max === 4 && seen.compatible && seen.state === 'match',
    `öffentliche Liste: ${seen ? `${seen.name}, ${seen.map}, ${seen.players}/${seen.max}, Level ${seen.level}, ${seen.state}` : 'nicht gefunden'}`);
  const qp = await ev(c4, (c) => window.__room.net.quickPlay({ name: 'Dora', filter: (g) => g.code === c }).then((r) => r && { id: r.id, team: r.team }, (e) => ({ error: e.code })), code);
  check(qp && qp.id > 1, `quickPlay tritt bei (id ${qp && qp.id}, Team ${qp && qp.team})`);
  const late = await waitFor(c4, () => window.__room.started.length === 1);
  const lateCfg = await ev(c4, () => window.__room.started[0]);
  check(late && lateCfg.net.role === 'client' && lateCfg.mapId === 'altstadt' && lateCfg.weather === hostCfg.weather, 'Einstieg ins laufende Spiel: welcome.cfg startet das Spiel');

  // ------------------------------------------------------------------ Host im Hintergrund
  await ev(host, () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check(await waitFor(c1, () => window.__room.events.some((e) => e.name === 'net:host-away' && e.p.away === true)) &&
    await ev(c4, () => true) && await waitFor(c4, () => window.__room.msgs.some((m) => m.m.t === 'host-away' && m.m.away === true)), "Host-Tab verborgen → 'host-away' {away:true}");
  await ev(host, () => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  check(await waitFor(c1, () => window.__room.events.some((e) => e.name === 'net:host-away' && e.p.away === false)), "Host-Tab wieder sichtbar → 'host-away' {away:false}");

  // ------------------------------------------------------------------ Spielende → Raum zurück in die Lobby
  await ev(host, () => window.__room.net.onMatchEnd({ winner: 'A' }));
  check(await waitFor(c1, () => window.__room.net.room.state === 'lobby'), 'onMatchEnd (Host): Raum wieder im Zustand lobby');

  // ------------------------------------------------------------------ Host beendet
  await ev(host, () => window.__room.net.leave());
  const gone = await Promise.all([c1, c4].map((p) => waitFor(p, () => window.__room.events.some((e) => e.name === 'net:error' && e.p.code === 'host-weg'))));
  check(gone.every(Boolean), "Host verlässt: Clients bekommen net:error {code:'host-weg'}");
  check(!(await ev(c1, () => window.__room.net.online)) && !(await ev(host, () => window.__room.net.online)), 'alle offline');

  // ------------------------------------------------------------------ falscher Code
  const jn = await join(c1, 'ZZZZZZ', 'Anna', { timeout: 5000 });
  check(!jn.ok && jn.code === 'kein-host', `falscher Code → ${jn.code}`);
  const errs = await Promise.all(Object.values(pages).map((p) => ev(p, () => window.__room.events.filter((e) => e.name === 'net:status').length)));
  check(errs.every((n) => n >= 1), 'net:status auf allen Seiten');
} catch (err) {
  console.log('FEHL Abbruch:', err && err.stack || err);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
