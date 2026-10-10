// NULLPUNKT – Fahrzeuge online Ende-zu-Ende (docs/planung/panzer-mp.md §C.12): Host + 2 Clients („Anna“, „Bert“) in
// Headless-Chromium über das lokale Nostr-Relay, Hafen, Raum-Einstellung „Fahrzeuge“ an, Anna und Bert im selben Team
// (pvp 'coop'), Außenansicht aus, Nachladen manuell. Geprüft wird:
//   1. Host: 4 Fahrzeuge, je Team 1 Panzer (spawnTeam A/B); Clients sehen dieselben vid/Typ/Team ≤ 3 s.
//   2. Anna steigt ein (requestEnter) → Fahrersitz bei allen; Bert → Richtschütze (Sitz 1).
//   3. Anna fährt (simulate: Gang hoch, Gas) ≥ 20 m; nach dem Bremsen Lage bei Host/Anna/Bert ≤ 0,5 m gleich.
//   4. Bert schießt auf den feindlichen Panzer → Treffer beim Host, 'vh' bei Bert, HP bei allen gleich ≤ 1 s.
//   5. Bert wechselt in Sitz 4 (Ladeschütze, ≥ 1,1 s inaktiv): falsche Ladefolge → 'vn', richtige Folge (Blick über
//      seat.look) → geladen beim Host; zurück in Sitz 2, zweiter Schuss.
//   6. Zerstörung (Host senkt die HP, Bot im Panzer): Wrack bei allen, Abschussliste mit mbt_ap; Entfernen +
//      Wiedererscheinen (Host verkürzt Zeiten) → neue vid bei allen, Team B.
//   7. Anti-Cheat: Wechsel auf besetzten Sitz → abgelehnt; keine Verstöße/'correct' für Anna während der Fahrt; Bert steigt
//      aus → Lage = 'vo' ± 0,5 m, keine Verstöße; Einsteigen aus > 40 m → 'vn' weit.
//   8. thirdPerson aus → Clients bieten keine Außenansicht an; Bert schließt die Seite im Panzer → Sitz frei ≤ 5 s.
// Voraussetzung: Server auf 8765 (npx http-server -p 8765 -s -c-1 .) und node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/mp-vehicle-test.mjs [--size=640x360] [--quality=low] [--params="netlag=80"] [--limit=20 (min)]
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
const LIMIT = (Number(opt.limit) || 20) * 60 * 1000; // ohne Lastwartezeit vor dem Start

let fail = 0;
let count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);

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
const killer = setTimeout(() => { console.log(`${ts()} FEHL Zeitlimit ${LIMIT / 60000} min überschritten`); browser.close().finally(() => process.exit(1)); }, LIMIT);
const pages = {};
const errors = {};

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  errors[name] = [];
  p.on('pageerror', (e) => { errors[name].push(`[pageerror] ${e.message}`); console.log(`[${name}] Seitenfehler: ${e.message}`); });
  p.on('console', (m) => {
    if (m.type() !== 'error' && !(m.type() === 'warning' && /\[vehicles\]|\[net\]/.test(m.text()))) return;
    const text = m.text();
    if (/favicon|Failed to load resource|net::ERR_|WebGL|GL_INVALID|AudioContext/i.test(text)) return;
    errors[name].push(text);
    console.log(`[${name}] Konsole: ${text.slice(0, 300)}`);
  });
  await p.goto(`${BASE}spielen.html?quality=${QUALITY}&relays=${encodeURIComponent(RELAY)}${EXTRA}`);
  await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 120000 });
  await p.evaluate((n) => { window.__game.settings.set('playerName', n); }, name);
  await p.evaluate(() => {
    const G = window.__game;
    const log = (window.__mv = { kills: [], vh: 0, vn: [], vo: [], corrects: 0, vs: 0 });
    G.events.on('kill', (e) => log.kills.push({ v: e.victim && e.victim.netId, k: e.killer && e.killer.netId, w: e.weaponId }));
    G.net.on('correct', () => { log.corrects++; });
    G.net.on('ev', (m) => {
      if (!m) return;
      if (m.e === 'vh') log.vh++;
      else if (m.e === 'vn') log.vn.push(m.why);
      else if (m.e === 'vo') log.vo.push(m.pos);
      else if (m.e === 'vs') log.vs++;
    });
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
const shot = async (p, name) => { try { await p.screenshot({ path: `${OUT}/mpv-${name}.png` }); } catch { /* */ } };
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/**
 * Host-Seite verbergen wie ein Hintergrund-Tab (mp-test): ohne Zeichnen simuliert der Host im 20-Hz-Takt des Workers –
 * unter SwiftShader-Last zeichnet eine sichtbare Seite oft nur 0,2–1 Bilder/s (Spielzeit 0,05 s je Bild).
 */
const hidePage = (p, on) => ev(p, (h) => {
  if (h && !window.__rafOrig) {
    window.__rafOrig = window.requestAnimationFrame;
    window.__rafHeld = [];
    window.requestAnimationFrame = (cb) => { window.__rafHeld.push(cb); return 0; };
  }
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
  if (!h && window.__rafOrig) {
    window.requestAnimationFrame = window.__rafOrig;
    window.__rafOrig = null;
    for (const cb of window.__rafHeld.splice(0)) window.requestAnimationFrame(cb);
  }
}, on);
/**
 * Einsteigen anfragen (wie ein Spieler, der bei Ablehnung erneut F drückt: höchstens 3 Versuche) und warten, bis der Host
 * den Menschen im Sitz hat. → { ok, tries, vn: [Ablehnungen] }
 */
async function enterSeat(host, page, id, vid, seat = null) {
  const vn0 = await ev(page, () => window.__mv.vn.length);
  for (let k = 1; k <= 3; k++) {
    await ev(page, ([v, s]) => { const G = window.__game; G.vehicles.requestEnter(G.player, G.vehicles.list.find((x) => x.netId === v), s); }, [vid, seat]);
    const ok = await until(host, ([v, i]) => { const x = window.__game.vehicles.list.find((y) => y.netId === v); return !!x && x.seats.some((s) => s.actor && s.actor.netId === i); }, [vid, id], 20000, 300);
    if (ok) return { ok: true, tries: k, vn: await ev(page, (n) => window.__mv.vn.slice(n), vn0) };
  }
  const diag = await ev(host, ([v, i]) => {
    const G = window.__game, V = G.vehicles, x = V.list.find((y) => y.netId === v), a = G.net.actorById(i);
    return { box: x && a ? +V._boxDistance(x, a.position, 0.9).toFixed(2) : null, alive: a && a.alive, inVeh: a && !!a.vehicle, live: V.live, state: G.match.state, netLive: G.match.netLive, rejects: V.net && V.net.stats.rejects };
  }, [vid, id]);
  return { ok: false, tries: 3, vn: await ev(page, (n) => window.__mv.vn.slice(n), vn0), diag };
}
/**
 * Fahrzeug (optional) umstellen und den Menschen an den Ausstiegspunkt seines Sitzes setzen; kommt die Rücksetzung nicht an
 * (Nachricht während eines langen Bildes), erneut senden. → Ergebnis von __placeNear (+ ok)
 */
async function placeActor(host, page, id, vid, seat, moveVehicle) {
  const r = await ev(host, ([v, i, s, m]) => window.__placeNear(v, i, s, m), [vid, id, seat, moveVehicle]);
  if (!r) return null;
  for (let k = 0; k < 4; k++) {
    const here = await until(page, (pp) => { const p = window.__game.player.position; return Math.hypot(p.x - pp[0], p.z - pp[2]) < 0.6; }, r.pos, 12000, 300);
    if (here && await hostSees(host, id, r.pos, 0.8, 15000)) return { ...r, ok: true, tries: k + 1 };
    await ev(host, ([i, pos]) => { const G = window.__game; G.net.anticheat.onTeleport(i, pos, G.net.serverTime()); G.net.send(i, { t: 'correct', pos: [pos[0], pos[1] + 0.05, pos[2]] }); }, [id, r.pos]);
  }
  return { ...r, ok: false };
}
/** Host sieht die Puppe (Zustand angekommen) nahe pos? */
const hostSees = (host, id, pos, r = 0.8, timeout = 30000) => until(host, ([i, pp, rr]) => {
  const a = window.__game.net.actorById(i);
  return !!a && Math.hypot(a.position.x - pp[0], a.position.z - pp[2]) < rr;
}, [id, pos, r], timeout, 300);

/** Fahrzeuge einer Seite: vid, Typ, Team, Lage, HP, Sitze (netId je Sitz). */
const vehs = (p) => ev(p, () => {
  const V = window.__game.vehicles;
  return (V.list || []).map((v) => ({
    vid: v.netId, type: v.type, team: v.spawnTeam, alive: v.alive, wreck: v.wreck, hp: Math.round(v.health), pos: [v.body.pos.x, v.body.pos.y, v.body.pos.z],
    speed: v.body.speed, seats: v.seats.map((s) => (s.actor ? (s.actor.isPlayer ? window.__game.net.selfId : s.actor.netId) : 0)), visible: v.model.root.visible,
  }));
});

try {
  // ================================================================== Raum + Start
  const host = await open('Hosti');
  const anna = await open('Anna');
  const bert = await open('Bert');
  info(`drei Seiten geladen (${QUALITY}, ${W}×${H}${EXTRA ? `, ${EXTRA.slice(1)}` : ''})`);
  const code = await ev(host, () => window.__game.net.host({
    name: 'Panzer-Test', mode: 'tdm', map: 'hafen', maxPlayers: 4, teamSize: 3, pvp: 'coop', botFill: false, difficulty: 'rekrut',
    weather: 'standard', time: 'standard', style: 'arcade', vehicles: true, thirdPerson: false, vehReload: 'manuell',
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
  check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code} (Fahrzeuge an, Außenansicht aus, Nachladen manuell)`);
  const joinOnce = (p, n) => ev(p, ([c, nm]) => window.__game.net.join(c, { name: nm }).then((r) => ({ ok: true, id: r.id, team: r.team }), (e) => ({ ok: false, code: e.code })), [code, n]);
  const joins = [];
  for (const [p, n] of [[anna, 'Anna'], [bert, 'Bert']]) {
    let r = await joinOnce(p, n);
    if (!r.ok && (r.code === 'keine-antwort' || r.code === 'verbindung-fehlgeschlagen')) { info(`${n}: ${r.code} – zweiter Versuch`); r = await joinOnce(p, n); }
    joins.push(r);
  }
  check(joins.every((j) => j.ok), `Anna + Bert treten bei (${joins.map((j) => (j.ok ? `id ${j.id}/${j.team}` : j.code)).join(', ')})`);
  const [A, B] = joins.map((j) => j.id);
  await until(host, () => window.__game.net.roster.length === 3, null, 15000);
  const cfg = await ev(host, () => { const c = window.__game.net.startMatch(); return c && { map: c.mapId, veh: c.net.vehicles, tp: c.net.thirdPerson, rl: c.net.vehReload, botsB: c.net.botsB }; });
  check(!!cfg && cfg.map === 'hafen' && cfg.veh === true && cfg.tp === false && cfg.rl === 'manuell', `Host startet Hafen mit Fahrzeugen (Bots B ${cfg && cfg.botsB})`);
  const inMatch = await Promise.all([host, anna, bert].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 600000, 1000)));
  if (!check(inMatch.every(Boolean), 'Host + Anna + Bert im Zustand playing, eigener Spieler lebt')) throw new Error('Match nicht erreicht');
  const fps = await Promise.all([host, anna, bert].map((p) => ev(p, () => window.__game.renderer.info().fps)));
  info(`Bildrate (SwiftShader, drei Seiten): Host ${fps[0]}, Anna ${fps[1]}, Bert ${fps[2]} FPS`);
  // Host: Feind-Bots ruhen (kein Beschuss, keine Werfer), Menschen unverwundbar – geprüft wird das Netz, nicht das Gefecht
  await ev(host, async () => { window.__groundRay = (await import('./assets/js/game/vehicles/sim.js')).groundRay; });
  await ev(host, () => {
    const G = window.__game;
    G.player.godMode = true;
    window.__freeze = () => { for (const b of G.bots.bots) { if (b.isRemoteHuman) { b.invulnerable = true; continue; } if (!b._frozenTest) { b._frozenTest = true; b.update = () => {}; } } };
    window.__freeze();
    setInterval(window.__freeze, 500);
    window.__hv = { hits: [], seat: [], gun: [] };
    G.events.on('vehicle:hit', (e) => window.__hv.hits.push({ vid: e.vehicle.netId, amt: e.amount, by: e.attacker && e.attacker.netId, w: e.weaponId }));
    // Diagnose: Abpraller, Schüsse (Ursprung/Richtung), Austritt eines Clients und frei gewordene Sitze (Host-Zeit)
    window.__hv.rico = []; window.__hv.fires = []; window.__hv.left = {}; window.__hv.freed = {};
    G.events.on('vehicle:ricochet', (e) => window.__hv.rico.push({ vid: e.vehicle.netId, by: e.attacker && e.attacker.netId, w: e.weaponId }));
    G.events.on('vehicle:fire', (e) => { if (e.weaponId && e.weaponId.startsWith('mbt_') && e.weaponId !== 'mbt_coax') window.__hv.fires.push({ vid: e.vehicle.netId, by: e.actor && e.actor.netId, w: e.weaponId, o: e.origin && [e.origin.x, e.origin.y, e.origin.z].map((x) => +x.toFixed(2)), d: e.dir && [e.dir.x, e.dir.y, e.dir.z].map((x) => +x.toFixed(3)) }); });
    G.events.on('net:peer', (e) => { if (e && e.joined === false) window.__hv.left[e.id] = performance.now(); });
    G.events.on('vehicle:seat', (e) => window.__hv.seat.push({ vid: e.vehicle.netId, seat: e.seat, by: e.actor && e.actor.netId, t: G.time.elapsed, ready: e.vehicle.seats[e.seat].readyAt }));
    // Fahrzeug auf einen freien Stellplatz nahe eines Menschen stellen (moveVehicle) und den Menschen an den Ausstiegspunkt
    // seines Sitzes setzen – wie ein Modus-Teleport des Hosts: Anti-Cheat-Anker neu + 'correct' an den Client
    window.__placeNear = (vid, actorId, seat = 0, moveVehicle = true) => {
      const V = G.vehicles, v = V.list.find((x) => x.netId === vid);
      const a = actorId === G.net.selfId ? G.player : G.net.actorById(actorId);
      if (!v || !a) return null;
      if (moveVehicle) {
        // Stellplatz mit freier Bahn nach vorn (≥ 30 m in Brust- und Dachhöhe, drei Spuren) – die Fahrprüfung braucht 20 m
        // geradeaus; zu enge Plätze werden ausgeschlossen und weiter gesucht
        const others = V.list.filter((o) => o !== v).map((o) => o.body.pos);
        const rejected = [];
        let pick = null;
        // nahe dem Menschen, sonst nahe dem Panzer selbst bzw. der Kartenmitte (der Mensch wird ohnehin dorthin gesetzt)
        const centers = [a.position.clone(), v.body.pos.clone()];
        if (G.world.bounds) { const mc = G.world.bounds.getCenter(a.position.clone()); mc.y = v.body.pos.y - 1; centers.push(mc); }
        for (let n = 0; n < 30 && !pick; n++) {
          const c = centers[Math.min(centers.length - 1, Math.floor(n / 10))];
          const spot = V.findSpot(c, v.type, { avoid: [...others, ...rejected], maxR: 90 });
          if (!spot) { n = Math.floor(n / 10) * 10 + 9; continue; }
          const T = spot.position.constructor;
          let best = spot.yaw, bestLen = -1;
          for (let k = 0; k < 16; k++) {
            const yaw = (k / 16) * Math.PI * 2;
            const d = new T(-Math.sin(yaw), 0, -Math.cos(yaw));
            let len = 40;
            for (const h of [0.8, 2.0]) for (const side of [-1.4, 0, 1.4]) {
              const o = spot.position.clone().add(new T(Math.cos(yaw) * side, h, -Math.sin(yaw) * side));
              const hit = V._rc ? V._rc.orig.call(G.world, o, d, 40) : G.world.raycast(o, d, 40);
              if (hit && hit.distance < len) len = hit.distance;
            }
            // Bahn auch befahrbar: fester Boden (Fahrzeug-Bodenstrahl, kein Wasser) ohne Stufe alle 6 m bis 30 m
            if (len >= 30 && window.__groundRay) {
              for (const dd of [6, 12, 18, 24, 30]) {
                const o = spot.position.clone().addScaledVector(d, dd); o.y += 3;
                const g = window.__groundRay(G.world, o, new T(0, -1, 0), 8, {});
                if (!g || Math.abs(3 - g.distance) > 1.5) { len = Math.min(len, dd - 6); break; }
              }
            }
            if (len > bestLen) { bestLen = len; best = yaw; }
            if (len >= 30) break;
          }
          if (bestLen >= 30) pick = { pos: spot.position, yaw: best, len: bestLen };
          else rejected.push(spot.position);
        }
        if (!pick) return null;
        v.body.setPose(pick.pos, pick.yaw);
        window.__freeAhead = pick.len;
      }
      const ex = V._findExit(v, seat);
      if (!ex) return null;
      if (a === G.player) G.debugApi.teleport(ex.x, ex.y, ex.z);
      else {
        G.net.anticheat.onTeleport(actorId, [ex.x, ex.y, ex.z], G.net.serverTime());
        G.net.send(actorId, { t: 'correct', pos: [ex.x, ex.y + 0.05, ex.z] });
      }
      return { pos: [ex.x, ex.y, ex.z], box: V._boxDistance(v, ex, 0.9) };
    };
  });

  await hidePage(host, true);
  // Spielzeit des Hosts: unter Fremdlast schafft auch der verborgene Host oft nur 1–2 Bilder/s (je Bild ≤ 0,05 s Spielzeit) –
  // Zeitfaktor 1,6 hält jeden Schritt unter der Fahrzeug-Obergrenze (5 × 1/60 s), die Prüfung braucht so weniger Echtzeit
  await ev(host, () => window.__game.debugApi.setTimeScale(1.6));
  const hostHz = await (async () => { const a = await ev(host, () => window.__game.time.frame); await sleep(3000); const b = await ev(host, () => window.__game.time.frame); return (b - a) / 3; })();
  info(`Host-Seite verborgen (Simulation im Worker-Takt): ${hostHz.toFixed(1)} Bilder/s`);

  // ================================================================== 1. Fahrzeuge, beide Teams
  const hv = await until(host, () => { const L = window.__game.vehicles.list; return L.length >= 4 ? L.length : null; }, null, 30000);
  const hostV = await vehs(host);
  const tanks = hostV.filter((v) => v.type === 'mbt');
  check(hv === 4 && hostV.every((v) => Number.isInteger(v.vid) && v.vid > 0), `Host: ${hostV.length} Fahrzeuge mit Netz-Id (${hostV.map((v) => `${v.vid}:${v.type}/${v.team}`).join(', ')})`);
  check(tanks.length === 2 && tanks.some((v) => v.team === 'A') && tanks.some((v) => v.team === 'B') && hostV.filter((v) => v.team === 'A').length === hostV.filter((v) => v.team === 'B').length,
    'je Team ein Panzer, gleich viele Fahrzeuge je Team');
  const marks = await ev(host, () => window.__game.vehicles.list.map((v) => {
    let col = null;
    v.model.root.traverse((o) => { if (col == null && o.material && o.material.name && /mark|team/i.test(o.material.name) && o.material.color) col = o.material.color.getHex(); });
    return { team: v.spawnTeam, col };
  }));
  info(`Teamfarben (Markierungsmaterial): ${marks.map((m) => `${m.team}=${m.col != null ? '#' + m.col.toString(16) : '?'}`).join(', ')}`);
  const sig = (L) => L.map((v) => `${v.vid}:${v.type}:${v.team}`).sort().join(',');
  const t1 = Date.now();
  const seen = await Promise.all([anna, bert].map((p) => until(p, (s) => {
    const L = window.__game.vehicles.list;
    return L.length && L.map((v) => `${v.netId}:${v.type}:${v.spawnTeam}`).sort().join(',') === s && L.every((v) => v.model.root.visible);
  }, sig(hostV), 30000, 300)));
  check(seen.every(Boolean), `Clients sehen dieselben vid/Typ/Team (${((Date.now() - t1) / 1000).toFixed(1)} s nach dem Host-Abruf)`);
  const tA = tanks.find((v) => v.team === 'A'), tB = tanks.find((v) => v.team === 'B');

  // ================================================================== 2. Einsteigen
  const placed = await placeActor(host, anna, A, tA.vid, 0, true);
  info(`Panzer A (vid ${tA.vid}) neben Anna gestellt: ${placed ? `Abstand ${placed.box.toFixed(2)} m, freie Bahn ${(await ev(host, () => window.__freeAhead)).toFixed(0)} m` : 'kein Platz!'}`);
  if (placed && placed.tries > 1) info(`Anna: Rücksetzung ${placed.tries}× gesendet (${placed.ok ? 'angekommen' : 'nicht angekommen'})`);
  const eA = await enterSeat(host, anna, A, tA.vid, null);
  if (!eA.ok || eA.tries > 1) info(`Anna einsteigen: ${JSON.stringify(eA)}`);
  const annaIn = await until(host, ([vid, id]) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v && v.seats[0].actor && v.seats[0].actor.netId === id; }, [tA.vid, A], 5000);
  const annaInAll = await Promise.all([anna, bert].map((p) => until(p, ([vid, id]) => {
    const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid);
    const a = v && v.seats[0].actor;
    return !!a && (a.isPlayer ? G.net.selfId : a.netId) === id;
  }, [tA.vid, A], 15000)));
  check(annaIn && annaInAll.every(Boolean), 'Anna sitzt am Steuer – beim Host, bei Anna und bei Bert');
  check(await ev(anna, () => !!window.__game.player.vehicle && window.__game.vehicles.camera && !window.__game.vehicles.allowedViews(window.__game.player.vehicleSeat).some((i) => window.__game.player.vehicleSeat.def.views[i].tp)),
    'Anna: Außenansicht nicht angeboten (Raum-Einstellung aus)');
  const placedB = await placeActor(host, bert, B, tA.vid, 1, false);
  info(`Bert an den Panzer gesetzt: ${placedB ? `Abstand ${placedB.box.toFixed(2)} m` : 'kein Ausstiegspunkt!'}`);
  const eB = await enterSeat(host, bert, B, tA.vid, 1);
  if (!eB.ok || eB.tries > 1) info(`Bert einsteigen: ${JSON.stringify(eB)}`);
  const bertIn = await Promise.all([host, anna, bert].map((p) => until(p, ([vid, id]) => {
    const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid), a = v && v.seats[1].actor;
    return !!a && (a.isPlayer ? G.net.selfId : a.netId) === id;
  }, [tA.vid, B], 20000)));
  check(bertIn.every(Boolean), 'Bert sitzt als Richtschütze (Sitz 2) – überall');
  await shot(anna, '2-anna-fahrer');

  // ================================================================== 3. Fahren
  const p0 = (await vehs(host)).find((v) => v.vid === tA.vid).pos;
  const acN0 = await ev(host, (id) => window.__game.net.anticheat.log.filter((l) => l.peer === id).length, A);
  const annaCorr0 = await ev(anna, () => window.__mv.corrects);
  await ev(anna, () => { const S = window.__game.input.simulate; S.press('move_forward'); });
  await sleep(1500);
  await ev(anna, () => { const S = window.__game.input.simulate; S.release('move_forward'); });
  await sleep(600);
  await ev(anna, () => { const S = window.__game.input.simulate; S.press('move_forward'); }); // 2. Gang
  const gear = await until(host, (vid) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v.body.drive.gear >= 1 ? v.body.drive.gear : null; }, tA.vid, 30000);
  info(`Host: Gang ${gear} eingelegt (Anna hält W = Vollgas)`);
  const moved = await until(host, ([vid, a]) => {
    const v = window.__game.vehicles.list.find((x) => x.netId === vid), p = v.body.pos;
    const d = Math.hypot(p.x - a[0], p.z - a[2]);
    return d >= 20 ? d : null;
  }, [tA.vid, p0], 600000, 500);
  await ev(anna, () => { const S = window.__game.input.simulate; S.release('move_forward'); S.press('jump'); });
  // runter bis N (so oft S tippen, wie der Gang hoch ist), dabei bremsen bis Stillstand
  const gNow = await ev(host, (vid) => window.__game.vehicles.list.find((x) => x.netId === vid).body.drive.targetGear, tA.vid);
  for (let i = 0; i < gNow; i++) { await ev(anna, () => window.__game.input.simulate.press('move_back')); await sleep(500); await ev(anna, () => window.__game.input.simulate.release('move_back')); await sleep(500); }
  const drv = await ev(host, ([vid, a]) => {
    const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid), p = v.body.pos, D = v.body.drive;
    return { d: Math.hypot(p.x - a[0], p.z - a[2]), kmh: v.body.speed * 3.6, gear: D.gear, rpm: Math.round(D.rpm), thr: +(v.body.controls.throttle || 0).toFixed(2), fps: G.time.frame, t: G.time.elapsed };
  }, [tA.vid, p0]);
  check(!!moved, `Anna fährt ${moved ? moved.toFixed(1) : '–'} m (Host-Sim, Gang/Gas aus Annas Absicht; ${JSON.stringify(drv)})`);
  const stopped = await until(host, (vid) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return Math.abs(v.body.speed) < 0.15 && v.body.drive.gear === 0 ? true : null; }, tA.vid, 120000, 500);
  await ev(anna, () => window.__game.input.simulate.release('jump'));
  info(`Host: Panzer steht${stopped ? '' : ' NICHT'} (Gang N)`);
  await sleep(2500);
  const posH = (await vehs(host)).find((v) => v.vid === tA.vid).pos;
  const posA = (await vehs(anna)).find((v) => v.vid === tA.vid).pos;
  const posB = (await vehs(bert)).find((v) => v.vid === tA.vid).pos;
  check(d3(posH, posA) <= 0.5 && d3(posH, posB) <= 0.5, `Lage nach dem Bremsen gleich: Anna ${d3(posH, posA).toFixed(2)} m, Bert ${d3(posH, posB).toFixed(2)} m`);
  const acDrive = await ev(host, ([id, n]) => window.__game.net.anticheat.log.filter((l) => l.peer === id).slice(n).map((l) => l.reason), [A, acN0]);
  const annaCorr = (await ev(anna, () => window.__mv.corrects)) - annaCorr0;
  check(acDrive.length === 0 && annaCorr === 0, `keine Verstöße/'correct' für Anna während der Fahrt (${acDrive.join(', ') || '–'}, correct ${annaCorr})`);
  await shot(bert, '3-bert-nach-fahrt');

  // ================================================================== 4. Schuss auf den feindlichen Panzer
  // Feindpanzer frei sichtbar vor den eigenen stellen (Host), Bert zielt über seinen Blick (Optik-Sicht = Lafette)
  const target = await ev(host, ([va, vb]) => {
    const G = window.__game, V = G.vehicles;
    const a = V.list.find((x) => x.netId === va), b = V.list.find((x) => x.netId === vb);
    const P = a.body.pos;
    const T = P.constructor;
    const fwd = new T(0, 0, -1).applyQuaternion(a.body.quat);
    const a0 = Math.atan2(fwd.z, fwd.x);
    const order = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8];
    for (const strict of [true]) for (const dist of [40, 30, 25, 20, 50, 60, 15]) {
      for (const k of order) {
        const ang = a0 + (k / 16) * Math.PI * 2;
        const x = P.x + Math.cos(ang) * dist, z = P.z + Math.sin(ang) * dist;
        const hit = V._rc ? V._rc.orig.call(G.world, new T(x, P.y + 10, z), new T(0, -1, 0), 25) : G.world.raycast(new T(x, P.y + 10, z), new T(0, -1, 0), 25);
        if (!hit || Math.abs(hit.point.y - (P.y - 1)) > 3) continue;
        const pos = new T(x, hit.point.y, z);
        // Breitseite zum Schützen (Abpraller bei flachem Auftreffwinkel ausgeschlossen): Fahrtrichtung quer zur Schusslinie
        const yawB = Math.atan2(-Math.sin(ang), Math.cos(ang));
        if (strict && !V._clear(pos, yawB, b.def)) continue;
        // Sicht vom Turm zur Mitte des Ziels frei (Welt ohne Fahrzeuge)
        const from = new T(P.x, P.y + 1.6, P.z), to = new T(x, hit.point.y + 1.2, z);
        const d = to.clone().sub(from), len = d.length();
        const w = V._rc ? V._rc.orig.call(G.world, from, d.normalize(), len) : null;
        if (w && w.distance < len - 1) continue;
        b.body.setPose(pos, yawB);
        return { pos: [x, hit.point.y + 1.0, z], dist };
      }
    }
    return null;
  }, [tA.vid, tB.vid]);
  if (!check(!!target, `Feindpanzer (vid ${tB.vid}) in ${target ? target.dist : '–'} m frei vor den eigenen gestellt`)) throw new Error('kein Platz für den Feindpanzer');
  await sleep(1500);
  const aimAt = async (pt) => ev(bert, (p) => {
    const G = window.__game, v = G.player.vehicle, seat = v && v.seats[v.seatOf(G.player)];
    if (!seat) return false;
    const m = new (v.body.pos.constructor)(), d = m.clone();
    v.muzzle(seat.index, m, d, true);
    const dx = p[0] - m.x, dy = p[1] - m.y, dz = p[2] - m.z;
    seat.look.yaw = Math.atan2(-dx, -dz);
    seat.look.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    window.__aimPt = p;
    return true;
  }, pt);
  // Blick jedes Bild nachführen (der Spieler „hält“ die Maus ruhig auf dem Ziel)
  await ev(bert, () => {
    const G = window.__game;
    if (window.__aimT) clearInterval(window.__aimT);
    window.__aimT = setInterval(() => {
      const v = G.player.vehicle, seat = v && v.seats[v.seatOf(G.player)], p = window.__aimPt;
      if (!seat || !p || !seat.def.mount) return;
      const m = new (v.body.pos.constructor)(), d = m.clone();
      v.muzzle(seat.index, m, d, true);
      seat.look.yaw = Math.atan2(-(p[0] - m.x), -(p[2] - m.z));
      seat.look.pitch = Math.atan2(p[1] - m.y, Math.hypot(p[0] - m.x, p[2] - m.z));
    }, 100);
  });
  await aimAt(target.pos);
  const aligned = await until(host, ([vid, id]) => {
    const v = window.__game.vehicles.list.find((x) => x.netId === vid), s = v.seats[1];
    return s.actor && s.actor.netId === id && s.aimError < 0.012 && v.gun.step === 'geladen' ? { err: s.aimError } : null;
  }, [tA.vid, B], 180000, 500);
  const aimDiag = aligned ? '' : JSON.stringify(await ev(host, (vid) => {
    const v = window.__game.vehicles.list.find((x) => x.netId === vid), s = v.seats[1], d = s.intent.aimDir;
    return { err: +(s.aimError || 0).toFixed(3), ty: +v.mount.turretYaw.toFixed(3), gp: +v.mount.gunPitch.toFixed(3), aim: d ? [+d.x.toFixed(3), +d.y.toFixed(3), +d.z.toFixed(3)] : null, step: v.gun.step, actor: s.actor && s.actor.netId, up: v.body.up(new (v.body.pos.constructor)()).y.toFixed(3), hp: Math.round(v.health) };
  }, tA.vid));
  check(!!aligned, `Host: Turm folgt Berts Zielrichtung (Fehler ${aligned ? (aligned.err * 1000).toFixed(1) : '–'} mrad), Kanone geladen ${aimDiag}`);
  const hpB0 = (await vehs(host)).find((v) => v.vid === tB.vid).hp;
  const vh0 = await ev(bert, () => window.__mv.vh);
  await ev(bert, () => window.__game.input.simulate.tap('fire'));
  const hit1 = await until(host, ([vid, id]) => window.__hv.hits.find((h) => h.vid === vid && h.by === id && h.w && h.w.startsWith('mbt_')), [tB.vid, B], 60000, 300);
  if (!check(!!hit1, `Host: Treffer auf den Feindpanzer durch Berts Puppe (${hit1 ? `${Math.round(hit1.amt)} Schaden, ${hit1.w}` : 'kein Treffer'})`)) {
    info(`Diagnose Bert: ${JSON.stringify(await ev(bert, (vid) => {
      const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid), si = v.seatOf(G.player), st = v.seats[si];
      const r3 = (o) => (o ? [o.x, o.y, o.z].map((x) => +(+x).toFixed(3)) : null);
      const m = new (v.body.pos.constructor)(), d = m.clone();
      v.muzzle(st.index, m, d, true);
      return { si, view: st.view, eff: G.vehicles._eff && G.vehicles._eff.view && G.vehicles._eff.view.id, look: { yaw: +st.look.yaw.toFixed(3), pitch: +st.look.pitch.toFixed(3), relYaw: st.look.relYaw }, aimWant: r3(st.aimWant), aimDir: r3(st.intent.aimDir), aimAt: r3(st.intent.aimAt), ready: st.readyAt, now: G.time.elapsed, pos: r3(v.body.pos), muzzle: r3(m), mdir: r3(d), aimPt: window.__aimPt, sent: G.vehicles.net && G.vehicles.net._in ? { y: G.vehicles.net._in.aimYaw, p: G.vehicles.net._in.aimPitch } : null };
    }, tA.vid))}`);
    info(`Diagnose Schuss: ${JSON.stringify(await ev(host, (vid) => { const b = window.__game.vehicles.list.find((x) => x.netId === vid); return { fires: window.__hv.fires, rico: window.__hv.rico, hits: window.__hv.hits, target: b && [b.body.pos.x, b.body.pos.y, b.body.pos.z].map((x) => +x.toFixed(2)), hp: b && b.health, team: b && b.team }; }, tB.vid))}`);
  }
  const vhOk = await until(bert, (n) => window.__mv.vh > n, vh0, 15000);
  check(!!vhOk, "Bert bekommt 'vh' (Treffermarker)");
  const vsSeen = await Promise.all([anna, bert].map((p) => ev(p, () => window.__mv.vs)));
  check(vsSeen.every((n) => n >= 1), `'vs' (Kanonenschuss-Darstellung) bei Anna und Bert (${vsSeen.join('/')})`);
  const hpH = (await vehs(host)).find((v) => v.vid === tB.vid).hp;
  const t4 = Date.now();
  const hpSame = await Promise.all([anna, bert].map((p) => until(p, ([vid, hp]) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v && Math.round(v.health) === hp; }, [tB.vid, hpH], 8000, 100)));
  check(hpH < hpB0 && hpSame.every(Boolean), `HP des Feindpanzers bei allen gleich: ${hpB0} → ${hpH} (${((Date.now() - t4) / 1000).toFixed(1)} s)`);
  const gunHost = await ev(host, (vid) => { const g = window.__game.vehicles.list.find((x) => x.netId === vid).gun; return { step: g.step, loaded: g.loaded, auto: g.auto }; }, tA.vid);
  const gunBert = await until(bert, ([vid, st]) => { const g = window.__game.vehicles.list.find((x) => x.netId === vid).gun; return g.step === st ? g.step : null; }, [tA.vid, gunHost.step], 8000);
  check(gunHost.step === 'leer' && !gunHost.auto && gunBert === 'leer', `nach dem Schuss: Kanone leer, kein Automatik-Laden (manuell) – Host + Bert (${gunHost.step}/${gunBert})`);
  await shot(bert, '4-bert-schuss');

  // ================================================================== 5. Ladeschütze
  const nSeat0 = await ev(host, () => window.__hv.seat.length);
  await ev(bert, () => { const G = window.__game; G.vehicles.requestSeat(G.player, 3); });
  const sw = await until(host, ([n, id]) => window.__hv.seat.slice(n).find((e) => e.by === id && e.seat === 3), [nSeat0, B], 20000);
  check(!!sw && sw.ready - sw.t >= 1.1, `Bert wechselt in Sitz 4 (Ladeschütze), inaktiv ${sw ? (sw.ready - sw.t).toFixed(2) : '–'} s`);
  const bertSeat3 = await until(bert, () => { const G = window.__game, v = G.player.vehicle; return v && v.seatOf(G.player) === 3; }, null, 15000);
  check(!!bertSeat3, 'Bert sieht sich im Sitz 4');
  // Wechselzeit abwarten (Host-Zeit)
  await until(host, ([vid]) => { const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid); return G.time.elapsed > (v.seats[3].readyAt || 0) + 0.1; }, [tA.vid], 60000, 300);
  const vn0 = await ev(bert, () => window.__mv.vn.length);
  await ev(bert, () => { const G = window.__game; G.vehicles.requestLoad(G.player, G.player.vehicle, 'einschieben'); });
  const tWrong = Date.now();
  // unter Fremdlast (Seiten mit 1 Bild/s) kann die Antwort lange unterwegs sein → großzügig warten, Laufzeit ausgeben
  const wrong = await until(bert, (n) => window.__mv.vn.slice(n)[0] || null, vn0, 45000);
  const hostWhy = await ev(host, (id) => (window.__game.vehicles.net.rejectLog || []).filter((r) => r.id === id).map((r) => r.why).slice(-3), B);
  check(wrong === 'schritt', `falsche Ladefolge (einschieben zuerst) → 'vn' ${wrong} nach ${((Date.now() - tWrong) / 1000).toFixed(1)} s (Host: ${hostWhy.join(', ') || '–'})`);
  const vnAfterWrong = await ev(bert, () => window.__mv.vn.length);
  // Blick aufs Gestell, greifen
  const look = (which) => ev(bert, (w) => {
    const G = window.__game, v = G.player.vehicle, seat = v.seats[v.seatOf(G.player)];
    const I = v.def.interior, eye = I.loaderEye || [0, 0, 0], p = I[w];
    seat.look.relYaw = Math.atan2(-(p[0] - eye[0]), -(p[2] - eye[2]));
    window.__lookYaw = seat.look.relYaw;
    return seat.look.relYaw;
  }, which);
  await ev(bert, () => {
    if (window.__lookT) clearInterval(window.__lookT);
    window.__lookT = setInterval(() => { const G = window.__game, v = G.player.vehicle; if (v && window.__lookYaw != null) v.seats[v.seatOf(G.player)].look.relYaw = window.__lookYaw; }, 50);
  });
  const step = (k) => ev(bert, (kk) => { const G = window.__game; G.vehicles.requestLoad(G.player, G.player.vehicle, kk); }, k);
  const hostStep = (st) => until(host, ([vid, s]) => window.__game.vehicles.list.find((x) => x.netId === vid).gun.step === s, [tA.vid, st], 60000, 300);
  await look('rack');
  await sleep(800);
  await step('greifen');
  const s1 = await hostStep('gegriffen');
  await look('breech');
  await sleep(800);
  await step('einschieben');
  const s2 = await hostStep('eingeschoben');
  await step('schliessen');
  const s3 = await hostStep('geladen');
  await ev(bert, () => { window.__lookYaw = null; });
  const vnLoad = await ev(bert, (n) => window.__mv.vn.slice(n), vnAfterWrong);
  check(!!(s1 && s2 && s3), `richtige Ladefolge → geladen beim Host (gegriffen ${!!s1}, eingeschoben ${!!s2}, geladen ${!!s3}; weitere Ablehnungen: ${vnLoad.join(', ') || '–'})`);
  const loadedBert = await until(bert, (vid) => { const g = window.__game.vehicles.list.find((x) => x.netId === vid).gun; return g.step === 'geladen' && g.loaded ? g.loaded : null; }, tA.vid, 8000);
  check(!!loadedBert, `Bert sieht „geladen“ (${loadedBert})`);
  await shot(bert, '5-bert-lader');

  // ================================================================== 6. Zerstörung, Wrack, Wiedererscheinen
  await ev(bert, () => { const G = window.__game; G.vehicles.requestSeat(G.player, 1); });
  await until(host, ([vid, id]) => { const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid), s = v.seats[1]; return s.actor && s.actor.netId === id && G.time.elapsed > (s.readyAt || 0) + 0.1; }, [tA.vid, B], 60000, 300);
  // Bot in den Feindpanzer (Insasse → Abschuss in der Liste), HP niedrig
  const botId = await ev(host, (vid) => {
    const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid);
    const bot = G.bots.bots.find((b) => !b.isRemoteHuman && b.team === 'B' && b.alive);
    if (!bot) return 0;
    bot.invulnerable = false;
    if (!v.alive || G.vehicles.enter(bot, v, 0) < 0) return -1;
    v.health = 6; v.zones.hull.hp = 6;
    return bot.netId;
  }, tB.vid);
  check(botId > 0, `Bot ${botId} sitzt im Feindpanzer, HP 6`);
  await aimAt(target.pos);
  const aligned2 = await until(host, ([vid, id]) => {
    const v = window.__game.vehicles.list.find((x) => x.netId === vid), s = v.seats[1];
    return s.actor && s.actor.netId === id && s.aimError < 0.012 ? { err: s.aimError } : null;
  }, [tA.vid, B], 120000, 500);
  check(!!aligned2, 'zurück im Richtschützensitz, Turm ausgerichtet');
  await ev(bert, () => window.__game.input.simulate.tap('fire'));
  const dead = await until(host, (vid) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v && !v.alive; }, tB.vid, 60000, 300);
  check(!!dead, 'zweiter Schuss: Feindpanzer zerstört (Host)');
  const wreckAll = await Promise.all([anna, bert].map((p) => until(p, (vid) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v && !v.alive && v.wreck; }, tB.vid, 10000)));
  check(wreckAll.every(Boolean), 'Wrack bei Anna und Bert');
  const kfAll = await Promise.all([host, anna, bert].map((p) => until(p, (id) => { const k = window.__mv.kills.find((e) => e.v === id); return k ? k.w : null; }, botId, 10000)));
  const kfName = await ev(anna, () => window.__game.vehicles.weaponName('mbt_ap'));
  check(kfAll.every((w) => w === 'mbt_ap') && !!kfName, `Abschussliste: Ursache mbt_ap überall (${kfAll.join('/')}), Name „${kfName}“`);
  await shot(anna, '6-wrack');
  // Wrack sofort räumen, Wiedererscheinen in 1 s
  await ev(host, (vid) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); if (v) v.wreckLeft = 0.2; }, tB.vid);
  await until(host, (vid) => !window.__game.vehicles.list.some((x) => x.netId === vid), tB.vid, 30000, 300);
  await ev(host, () => { const G = window.__game; for (const sp of G.vehicles.spawns) if (!sp.vehicle && sp.respawnAt != null) sp.respawnAt = G.time.elapsed + 0.5; });
  const newB = await until(host, (old) => { const v = window.__game.vehicles.list.find((x) => x.type === 'mbt' && x.spawnTeam === 'B' && x.alive); return v && v.netId !== old ? v.netId : null; }, tB.vid, 60000, 300);
  const newAll = await Promise.all([anna, bert].map((p) => until(p, ([nv, old]) => {
    const L = window.__game.vehicles.list;
    const v = L.find((x) => x.netId === nv);
    return v && v.type === 'mbt' && v.spawnTeam === 'B' && !L.some((x) => x.netId === old) && v.model.root.visible;
  }, [newB, tB.vid], 15000)));
  check(!!newB && newAll.every(Boolean), `Wrack entfernt, neuer Panzer Team B (vid ${tB.vid} → ${newB}) bei allen`);

  // ================================================================== 7. Anti-Cheat
  const vn1 = await ev(bert, () => window.__mv.vn.length);
  await ev(bert, () => { const G = window.__game; G.vehicles.requestSeat(G.player, 0); }); // Annas Sitz
  const occ = await until(bert, (n) => window.__mv.vn.slice(n)[0] || null, vn1, 15000);
  const still = await ev(host, ([vid, a]) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v.seats[0].actor && v.seats[0].actor.netId === a; }, [tA.vid, A]);
  check(occ === 'besetzt' && still, `Wechsel auf Annas Sitz → 'vn' ${occ}, Anna bleibt Fahrerin`);
  const acB0 = await ev(host, (id) => window.__game.net.anticheat.log.filter((l) => l.peer === id).length, B);
  const bertCorr0 = await ev(bert, () => window.__mv.corrects);
  await ev(bert, () => { const G = window.__game; G.vehicles.requestExit(G.player); });
  const vo = await until(bert, () => window.__mv.vo[0] || null, null, 15000);
  await sleep(1200);
  const bertPos = await ev(bert, () => { const p = window.__game.player; return { pos: [p.position.x, p.position.y, p.position.z], veh: !!p.vehicle }; });
  check(!!vo && !bertPos.veh && d3(vo, bertPos.pos) <= 0.5, `Bert steigt aus: Lage = 'vo' (${vo ? d3(vo, bertPos.pos).toFixed(2) : '–'} m)`);
  const seatFree = await Promise.all([host, anna].map((p) => until(p, (vid) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v && !v.seats[1].actor; }, tA.vid, 10000)));
  check(seatFree.every(Boolean), 'Richtschützensitz frei bei Host und Anna');
  await sleep(2500);
  const acB = await ev(host, ([id, n]) => window.__game.net.anticheat.log.filter((l) => l.peer === id).slice(n).map((l) => l.reason), [B, acB0]);
  const bertCorr = (await ev(bert, () => window.__mv.corrects)) - bertCorr0;
  check(acB.length === 0 && bertCorr === 0, `keine Verstöße nach dem Aussteigen (${acB.join(', ') || '–'}, correct ${bertCorr})`);
  // Einsteigen aus der Ferne (neuer Feindpanzer, unbesetzt)
  const far = await ev(bert, (vid) => { const G = window.__game, v = G.vehicles.list.find((x) => x.netId === vid); return v ? G.vehicles._boxDistance(v, G.player.position, 0.9) : null; }, newB);
  const vn2 = await ev(bert, () => window.__mv.vn.length);
  await ev(bert, (vid) => { const G = window.__game; G.vehicles.remote.enter(G.vehicles.list.find((v) => v.netId === vid), 0); }, newB);
  const weitHost = await until(host, (id) => (window.__game.vehicles.net.rejectLog || []).some((r) => r.id === id && r.why === 'weit'), B, 30000, 300);
  const weit = await until(bert, (n) => window.__mv.vn.slice(n).find((w) => w === 'weit') || null, vn2, 30000);
  check(!!weitHost && weit === 'weit' && far > 10, `Einsteigen aus ${far ? far.toFixed(0) : '–'} m → Host lehnt ab (${weitHost ? 'weit' : '–'}), 'vn' bei Bert: ${weit}`);
  const notIn = await ev(host, ([vid, id]) => !window.__game.vehicles.list.find((x) => x.netId === vid).seats.some((s) => s.actor && s.actor.netId === id), [newB, B]);
  check(notIn, 'Bert sitzt nicht im fernen Panzer');

  // ================================================================== 8. Seite schließen im Panzer
  await placeActor(host, bert, B, tA.vid, 2, false);
  const eB2 = await enterSeat(host, bert, B, tA.vid, 2);
  if (!eB2.ok || eB2.tries > 1) info(`Bert einsteigen (2): ${JSON.stringify(eB2)}`);
  const bertIn2 = await until(host, ([vid, id]) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return v.seats.findIndex((s) => s.actor && s.actor.netId === id); }, [tA.vid, B], 20000);
  check(bertIn2 != null && bertIn2 >= 0, `Bert steigt wieder ein (Sitz ${bertIn2 != null ? bertIn2 + 1 : '–'})`);
  let tClose = Date.now();
  // wie ein echter Browser beim Schließen des Tabs: pagehide (persisted false), dann zu – Playwright löst es selbst nicht aus.
  // Zeit ab dem Ereignis in der Seite (nicht ab dem Playwright-Aufruf: unter Fremdlast braucht schon der Seitenaufruf Sekunden)
  const tPage = await ev(bert, () => { const t = Date.now(); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); return t; }).catch(() => 0);
  if (tPage > 0) tClose = tPage;
  await bert.close();
  delete pages.Bert;
  const freed = await until(host, ([vid, id]) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return !v.seats.some((s) => s.actor && s.actor.netId === id); }, [tA.vid, B], 15000, 200);
  const freedS = (Date.now() - tClose) / 1000;
  const freedAnna = await until(anna, ([vid, id]) => { const v = window.__game.vehicles.list.find((x) => x.netId === vid); return !v.seats.some((s) => s.actor && s.actor.netId === id); }, [tA.vid, B], 8000, 200);
  // Spiellogik des Hosts: Austritt erhalten → Sitz frei (Host-Uhr); die Wanduhr enthält unter SwiftShader (≈ 1 Bild/s je
  // Seite) zusätzlich Sekunden für Seitenaufrufe und Bildtakt
  const hostLat = freed ? await ev(host, (id) => { const t0 = window.__hv.left[id]; return t0 ? (performance.now() - t0) / 1000 : null; }, B) : null;
  check(!!freed && !!freedAnna && (freedS <= 5 || (hostLat != null && hostLat <= 5)), `Bert schließt die Seite im Panzer → Sitz frei nach ${freedS.toFixed(1)} s Wanduhr, Host ab Austritt ≤ ${hostLat != null ? hostLat.toFixed(1) : '–'} s (Host + Anna)`);

  // Bandbreite (Host): Fahrzeug-Anhang je Client
  const bw = await ev(host, () => { const s = window.__game.net.sync.snapStats; return { sent: s.sent, bytes: s.bytes, vbytes: s.vbytes || 0, vblocks: s.vblocks || 0 }; });
  info(`Schnappschüsse: ${bw.sent} Pakete, ${bw.bytes} B gesamt, Fahrzeug-Anhang ${bw.vbytes} B (${(100 * bw.vbytes / Math.max(1, bw.bytes)).toFixed(0)} %), ${bw.vblocks} Blöcke`);
  const vst = await ev(host, () => window.__game.vehicles.net.stats);
  info(`Fahrzeug-Netz (Host): ${JSON.stringify(vst)}`);

  for (const [n, list] of Object.entries(errors)) check(list.length === 0, `${n}: keine Seiten-/Konsolenfehler${list.length ? ` (${list.slice(0, 3).join(' | ')})` : ''}`);
} catch (err) {
  console.error(err);
  fail++;
} finally {
  clearTimeout(killer);
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfungen fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
