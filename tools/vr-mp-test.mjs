// NULLPUNKT — VR im Mehrspieler: Host (normaler Browser) + Client mit WebXR-Emulator IWER (Meta Quest 3) in Headless-Chromium
// über ein lokales Nostr-Relay (spielen.html, WebGL über SwiftShader). Geprüft wird:
//   • Gerät im Roster: Client erst 'pc', nach „VR starten“ 'vr' (Symbol in der Punktetabelle des Hosts), nach dem Ende
//     wieder 'pc'.
//   • Zustände des Clients in VR tragen den VR-Zusatz (48 statt 37 Byte), der Host reicht ihn in seinen Schnappschüssen weiter.
//   • Puppe des VR-Clients beim Host: Kopf dreht sich (Blick-Gelenke) relativ zur Waffe, wenn der Client den Kopf dreht;
//     Waffe folgt der Neigung des Controllers; die Waffe wandert mit der Hand; die linke Hand verlässt den Vordergriff, wenn
//     die Nebenhand weit weg ist; echtes Ducken → Puppe duckt sich.
//   • keine Seiten-/Konsolenfehler.
// Voraussetzung: Server auf 8765 (npx http-server -p 8765 -s -c-1 .), node tools/nostr-relay.mjs 7777, Emulator
// (npm i --prefix tools/out/vr iwer esbuild; Bündel tools/out/vr/iwer.iife.js entsteht mit node tools/vr-test.mjs).
// Aufruf: node tools/vr-mp-test.mjs [--map=hafen] [--size=800x450] [--quality=low] [--params="netlag=150"]
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools/out/vr');
const BUNDLE = join(OUT, 'iwer.iife.js');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const RELAY = process.env.NP_RELAY || 'ws://127.0.0.1:7777';
const [W, H] = String(opt.size || '800x450').split('x').map(Number);
const QUALITY = String(opt.quality || 'low');
const MAP = String(opt.map || 'hafen');
const EXTRA = typeof opt.params === 'string' && opt.params ? '&' + opt.params.replace(/^[?&]+/, '') : '';
mkdirSync(OUT, { recursive: true });
if (!existsSync(BUNDLE)) { console.error('Emulator-Bündel fehlt – einmal node tools/vr-test.mjs ausführen (baut tools/out/vr/iwer.iife.js)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0;
let count = 0;
const check = (ok, text) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${text}`); if (!ok) fail++; return ok; };
const info = (text) => console.log(`${ts()}      ${text}`);
const deg = (r) => `${(r * 180 / Math.PI).toFixed(0)}°`;

// Rechner teilt sich Prüfläufe: bei hoher Last warten (höchstens 10 min)
for (let i = 0; i < 10; i++) {
  let l1 = 0;
  try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { break; }
  if (!(l1 > 5)) break;
  info(`Last ${l1} > 5 – warte 60 s`);
  await sleep(60000);
}

const browser = await chromium.launch({ args: [...GL_ARGS, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errors = {};
async function open(name, vr) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  if (vr) {
    await ctx.addInitScript({ content: readFileSync(BUNDLE, 'utf8') });
    await ctx.addInitScript(() => {
      try { const k = 'nullpunkt:settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.vrEnabled = true; localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ }
    });
  }
  const p = await ctx.newPage();
  errors[name] = [];
  p.on('pageerror', (e) => { errors[name].push(`[pageerror] ${e.message}`); console.log(`[${name}] Seitenfehler: ${e.message}`); });
  p.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'warning' && /VR-Arme/.test(text)) { errors[name].push(text); console.log(`[${name}] ${text}`); }
    if (m.type() !== 'error') return;
    if (/favicon|Failed to load resource|net::ERR_|WebGL|GL_INVALID|AudioContext/i.test(text)) return;
    errors[name].push(text);
    console.log(`[${name}] Konsole: ${text.slice(0, 300)}`);
  });
  await p.goto(`${BASE}spielen.html?quality=${QUALITY}&relays=${encodeURIComponent(RELAY)}${EXTRA}`);
  await p.waitForFunction(() => window.__game && window.__game.net && window.__game.match.state === 'lobby', null, { timeout: 120000 });
  await p.evaluate((n) => { window.__game.settings.set('playerName', n); }, name);
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
const shot = async (p, name) => { try { await p.screenshot({ path: join(OUT, `${name}.png`), timeout: 120000 }); info(`Bild tools/out/vr/${name}.png`); } catch (e) { info(`Bild ${name}: ${e.message}`); } };

/** Puppe des VR-Clients im Bild des Hosts (Knochen 7 = linke Hand, Modellraum des Soldaten). */
const puppetView = (p, id) => ev(p, (cid) => {
  const G = window.__game;
  const b = G.bots && G.bots.byNetId(cid);
  if (!b || !b.soldier) return null;
  const a = b.soldier.anim;
  const np = b.netPose;
  const vr = np && np.vr ? { aimYaw: np.vr.aimYaw, aimPitch: np.vr.aimPitch, main: np.vr.main && [...np.vr.main], off: np.vr.off && [...np.vr.off] } : null;
  const head = a.headCenter.toArray();
  return {
    alive: b.alive, yaw: b.yaw, pitch: b.pitch, stance: b.stance, vr, vrW: b._vrW || 0, animEvery: b.animEvery,
    glance: { yaw: a.glance.yaw, pitch: a.glance.pitch, until: a.glance.until }, aimPitch: a.aimPitch, bodyYaw: a.bodyYaw,
    gunRel: a.gunPos.toArray().map((v, i) => v - head[i]), handLToGrip: a.wp[7].distanceTo(a.handLGrip), handLRel: a.wp[7].toArray().map((v, i) => v - head[i]),
    pos: b.position.toArray(),
  };
}, id);
/** Host stellt sich d m vor die Puppe und blickt sie an (sonst animiert der Host sie gedrosselt/gar nicht). */
const facepuppet = (p, id, d = 2.6) => ev(p, ([cid, dist]) => {
  const G = window.__game;
  const b = G.bots.byNetId(cid);
  if (!b) return false;
  const f = [-Math.sin(b.yaw), -Math.cos(b.yaw)];
  const x = b.position.x + f[0] * dist, z = b.position.z + f[1] * dist;
  G.debugApi.teleport(x, b.position.y + 0.1, z);
  G.player.yaw = Math.atan2(-(b.position.x - x), -(b.position.z - z));
  G.player.pitch = -0.08;
  return true;
}, [id, d]);
/** IWER: Kopf/Controller (Position absolut im Spielraum, Drehung um Y bzw. X). */
const setHead = (p, o) => ev(p, (q) => {
  const d = window.__iwer;
  if (q.y != null) d.position.y = q.y;
  if (q.yaw != null) d.quaternion.set(0, Math.sin(q.yaw / 2), 0, Math.cos(q.yaw / 2));
}, o);
const setHand = (p, side, o) => ev(p, ([s, q]) => {
  const c = window.__iwer.controllers[s];
  if (q.pos) c.position.set(q.pos[0], q.pos[1], q.pos[2]);
  if (q.pitch != null) c.quaternion.set(Math.sin(q.pitch / 2), 0, 0, Math.cos(q.pitch / 2));
}, [side, o]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

try {
  // ================================================================== Raum, Beitritt, Start
  const host = await open('Hosti', false);
  const cl = await open('Vera', true);
  info(`zwei Seiten geladen (${QUALITY}, ${W}×${H}, Karte ${MAP}${EXTRA ? `, ${EXTRA.slice(1)}` : ''})`);
  const code = await ev(host, (map) => window.__game.net.host({
    name: 'VR-MP', mode: 'tdm', map, maxPlayers: 2, teamSize: 1, pvp: 'pvp', botFill: false, difficulty: 'rekrut',
    weather: 'standard', time: 'standard', style: 'arcade',
  }).then((r) => r.code, (e) => 'FEHLER:' + e.code), MAP);
  check(/^[A-Z2-9]{6}$/.test(code), `Host öffnet Raum ${code}`);
  const joinOnce = () => ev(cl, (c) => window.__game.net.join(c, { name: 'Vera' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
  let j = await joinOnce();
  if (!j.ok && (j.code === 'keine-antwort' || j.code === 'verbindung-fehlgeschlagen')) { info(`Beitritt ${j.code} – zweiter Versuch`); j = await joinOnce(); }
  check(j.ok, `Client tritt bei (id ${j.id || j.code})`);
  if (!j.ok) throw new Error('kein Beitritt');
  const CID = j.id;
  await until(host, () => window.__game.net.roster.length === 2, null, 20000);
  const dev0 = await ev(host, (id) => { const r = window.__game.net.rosterEntry(id); return r && r.device; }, CID);
  check(dev0 === 'pc', `Roster beim Host: Gerät des Clients vor VR = ${dev0}`);
  const hostDev = await ev(cl, () => { const r = window.__game.net.rosterEntry(1); return r && r.device; });
  check(hostDev === 'pc', `Roster beim Client: Gerät des Hosts = ${hostDev}`);
  const cfg = await ev(host, () => { const c = window.__game.net.startMatch(); return c && { mode: c.modeId, map: c.mapId }; });
  check(!!cfg, `Host startet ${cfg && cfg.mode}/${cfg && cfg.map} (1 gegen 1, ohne Bots)`);
  const inMatch = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, null, 600000, 1000)));
  check(inMatch.every(Boolean), 'Host + Client im Match, eigene Spieler leben');
  if (!inMatch.every(Boolean)) throw new Error('Match nicht erreicht');
  await ev(host, () => { window.__game.player.godMode = true; });

  // Zustandspakete des Clients mitschneiden (Typ 2), Schnappschüsse des Hosts (Typ 1)
  await ev(cl, () => {
    const net = window.__game.net;
    const orig = net.sendFast.bind(net);
    window.__stateSizes = [];
    net.sendFast = (to, buf) => { try { if (new DataView(buf).getUint8(0) === 2) { window.__stateSizes.push(buf.byteLength); if (window.__stateSizes.length > 30) window.__stateSizes.shift(); } } catch { /* */ } return orig(to, buf); };
  });
  await ev(host, () => {
    const net = window.__game.net;
    const orig = net.sendFast.bind(net);
    net.sendFast = (to, buf) => { try { if (new DataView(buf).getUint8(0) === 1) window.__lastSnap = buf.slice(0); } catch { /* */ } return orig(to, buf); };
  });
  const sizes0 = await until(cl, () => window.__stateSizes.length >= 3 && [...new Set(window.__stateSizes)], null, 60000);
  check(sizes0 && sizes0.length === 1 && sizes0[0] === 37, `Zustand ohne VR: ${sizes0 && sizes0.join('/')} Byte`);

  // ================================================================== VR starten (Client)
  const xrDiag = () => ev(cl, () => {
    const G = window.__game, x = G.xr, b = document.querySelector('.xr-start');
    return { supported: x && x.supported, enabled: x && x.enabled, state: G.match.state, locked: !!(G.input && G.input.locked), starting: x && x.starting, presenting: x && x.presenting, button: b ? (b.hidden ? 'verborgen' : 'sichtbar') : 'fehlt' };
  });
  // Knopf im Bild erscheint nur ohne Zeiger-Sperre; mit Sperre (PC) wie dokumentiert: Esc → Pausenmenü → „VR starten“
  const floating = await until(cl, () => window.__game.xr && window.__game.xr.supported === true && (() => { const b = document.querySelector('.xr-start'); return b && !b.hidden; })(), null, 20000);
  let how = 'Knopf im Bild';
  if (!floating) {
    info(`Knopf im Bild verborgen (${JSON.stringify(await xrDiag())}) – Sperre lösen → Pausenmenü`);
    await ev(cl, () => { try { document.exitPointerLock(); } catch { /* */ } });
    if (!(await until(cl, () => window.__game.match.state === 'paused', null, 15000))) await ev(cl, () => window.__game.pause());
    how = 'Pausenmenü';
  }
  const sel = floating ? '.xr-start' : '[data-screen="pause"] [data-act="vr"]';
  const sup = await until(cl, (q) => { const b = document.querySelector(q); return !!(b && !b.hidden && b.offsetParent !== null); }, sel, 60000);
  check(!!sup && (await ev(cl, () => window.__game.xr.supported === true)), `Client: VR unterstützt (IWER Quest 3), „VR starten“ über ${how}${sup ? '' : ` – ${JSON.stringify(await xrDiag())}`}`);
  await cl.click(sel);
  const ready = await until(cl, () => window.__game.xr.presenting && window.__game.xr.ready, null, 120000);
  check(!!ready, 'Client: XR-Sitzung läuft, Höhe kalibriert');
  if (!ready) throw new Error('keine XR-Sitzung');
  const base = await ev(cl, () => ({ head: [__iwer.position.x, __iwer.position.y, __iwer.position.z], r: [__iwer.controllers.right.position.x, __iwer.controllers.right.position.y, __iwer.controllers.right.position.z], l: [__iwer.controllers.left.position.x, __iwer.controllers.left.position.y, __iwer.controllers.left.position.z] }));
  info(`IWER: Kopf ${base.head.map((v) => v.toFixed(2))}, rechts ${base.r.map((v) => v.toFixed(2))}, links ${base.l.map((v) => v.toFixed(2))}`);

  // Gerät → 'vr' beim Host, Symbol in der Punktetabelle
  const devVr = await until(host, (id) => { const r = window.__game.net.rosterEntry(id); return r && r.device === 'vr'; }, CID, 60000);
  check(!!devVr, 'Roster beim Host: Gerät des Clients = vr (nach VR-Start)');
  const board = await ev(host, (id) => {
    const G = window.__game;
    G.hud._renderBoard();
    const html = G.hud.el.board.innerHTML;
    const el = G.hud.el.board.querySelector('.sb-human[data-dev="vr"]');
    return { vr: !!el, title: el && el.getAttribute('title'), pc: !!G.hud.el.board.querySelector('.sb-human[data-dev="pc"]'), len: html.length, id };
  }, CID);
  check(board.vr && /VR-Brille/.test(board.title || ''), `Punktetabelle des Hosts: VR-Symbol beim Client („${board.title}“), eigenes Gerät PC ${board.pc ? 'ja' : 'nein'}`);
  await host.keyboard.down('Tab');
  await until(host, () => !window.__game.hud.el.board.hidden, null, 30000);
  await shot(host, 'vr-mp-tabelle');
  await host.keyboard.up('Tab');

  const sizes1 = await until(cl, () => { const s = window.__stateSizes.slice(-5); return s.length === 5 && s.every((n) => n === 48) && s; }, null, 60000);
  check(!!sizes1, `Zustand in VR: ${sizes1 ? sizes1[0] : '?'} Byte (37 + 11 VR-Zusatz)`);
  const snapVr = await until(host, async (id) => {
    if (!window.__lastSnap) return null;
    const P = await import('/assets/js/game/net/protocol.js');
    const d = P.decodeSnapshot(window.__lastSnap);
    const e = d && d.entities.find((x) => x.id === id);
    return e && e.vr ? { bytes: window.__lastSnap.byteLength, n: d.entities.length, main: !!e.vr.main } : null;
  }, CID, 60000);
  check(!!snapVr, `Schnappschuss des Hosts reicht den VR-Zusatz weiter (${snapVr && snapVr.bytes} Byte, ${snapVr && snapVr.n} Akteure, Hand ${snapVr && snapVr.main})`);

  // ================================================================== Körpersprache der Puppe beim Host
  await facepuppet(host, CID);
  await until(host, (id) => { const b = window.__game.bots.byNetId(id); return b && b.animEvery === 1; }, CID, 30000);
  const p0 = await until(host, (id) => { const b = window.__game.bots.byNetId(id); return !!(b && b.netPose && b.netPose.vr && b._vrW > 0.9); }, CID, 60000) && await puppetView(host, CID);
  check(!!(p0 && p0.vr && p0.vr.main), `Puppe beim Host hat VR-Pose (Hand ${p0 && p0.vr && p0.vr.main && p0.vr.main.map((v) => v.toFixed(2))}, Gewicht ${p0 && p0.vrW.toFixed(2)})`);
  info(`Ausgang: Kopf ${deg(p0.yaw)} / Hand ${deg(p0.vr.aimYaw)}, Blick ${deg(p0.glance.yaw)}, Neigung ${deg(p0.aimPitch)}, Waffe rel. Kopf ${p0.gunRel.map((v) => v.toFixed(2))}`);
  await shot(host, 'vr-mp-puppe-1-gerade');

  // (1) Kopf 60° nach links, Controller bleibt → Puppe: Kopf dreht, Waffe/Körper nicht
  await setHead(cl, { yaw: 60 * Math.PI / 180 });
  const p1 = await until(host, ([id, y0]) => {
    const b = window.__game.bots.byNetId(id);
    const g = b && b.soldier.anim.glance;
    return b && b.netPose.vr && Math.atan2(Math.sin(b.yaw - y0), Math.cos(b.yaw - y0)) > 0.85 && g.yaw > 0.85 && g;
  }, [CID, p0.yaw], 90000) && await puppetView(host, CID);
  check(!!p1 && Math.abs(wrap(p1.vr.aimYaw - p0.vr.aimYaw)) < 0.2, `Kopf dreht 60°: Puppe Kopf ${p1 ? deg(wrap(p1.yaw - p0.yaw)) : '?'}, Blick-Gelenke ${p1 ? deg(p1.glance.yaw) : '?'}, Hand bleibt (${p1 ? deg(wrap(p1.vr.aimYaw - p0.vr.aimYaw)) : '?'})`);
  await shot(host, 'vr-mp-puppe-2-kopf-links');
  await setHead(cl, { yaw: 0 });
  await until(host, (id) => { const b = window.__game.bots.byNetId(id); return b && Math.abs(b.soldier.anim.glance.yaw) < 0.2; }, CID, 60000);

  // (2) Controller 35° nach oben → Waffe der Puppe hebt sich (aimPitch), Kopf blickt geradeaus (Blick-Gelenke nach unten)
  await setHand(cl, 'right', { pitch: 35 * Math.PI / 180 });
  const p2 = await until(host, (id) => { const b = window.__game.bots.byNetId(id); return b && b.netPose.vr && b.netPose.vr.aimPitch > 0.45 && b.soldier.anim.aimPitch > 0.45; }, CID, 90000) && await puppetView(host, CID);
  check(!!p2, `Controller 35° hoch: Hand-Neigung ${p2 ? deg(p2.vr.aimPitch) : '?'}, Waffe der Puppe ${p2 ? deg(p2.aimPitch) : '?'}, Blick-Gelenke ${p2 ? deg(p2.glance.pitch) : '?'}`);
  await setHand(cl, 'right', { pitch: 0 });

  // (3) Haupthand 25 cm nach rechts und 20 cm hoch → Waffe der Puppe wandert mit
  const pA = await puppetView(host, CID);
  await setHand(cl, 'right', { pos: [base.r[0] + 0.25, base.r[1] + 0.2, base.r[2]] });
  const p3 = await until(host, ([id, m0]) => {
    const b = window.__game.bots.byNetId(id);
    const m = b && b.netPose.vr && b.netPose.vr.main;
    return m && m[0] - m0[0] > 0.18 && m[1] - m0[1] > 0.14;
  }, [CID, pA.vr.main], 90000) && (await sleep(1500), await puppetView(host, CID));
  const dGun = p3 ? p3.gunRel.map((v, i) => v - pA.gunRel[i]) : null;
  check(!!p3 && dGun[1] > 0.1 && Math.hypot(dGun[0], dGun[2]) > 0.1, `Hand 25 cm rechts/20 cm hoch: Netz ${p3 ? p3.vr.main.map((v, i) => (v - pA.vr.main[i]).toFixed(2)) : '?'} m, Waffe der Puppe bewegt ${dGun ? dGun.map((v) => v.toFixed(2)) : '?'} m (Modellraum)`);
  await shot(host, 'vr-mp-puppe-3-hand');
  await setHand(cl, 'right', { pos: base.r });

  // (4) Nebenhand 45 cm nach links → linke Hand der Puppe verlässt den Vordergriff
  const l0 = await puppetView(host, CID);
  await setHand(cl, 'left', { pos: [base.l[0] - 0.45, base.l[1] + 0.1, base.l[2] + 0.1] });
  const p4 = await until(host, (id) => { const b = window.__game.bots.byNetId(id); const a = b && b.soldier.anim; return a && a.wp[7].distanceTo(a.handLGrip) > 0.12; }, CID, 90000) && await puppetView(host, CID);
  check(!!p4, `Nebenhand weit weg: linke Hand der Puppe ${l0 ? l0.handLToGrip.toFixed(2) : '?'} → ${p4 ? p4.handLToGrip.toFixed(2) : '?'} m vom Vordergriff`);
  await shot(host, 'vr-mp-puppe-4-nebenhand');
  await setHand(cl, 'left', { pos: base.l });

  // (5) echtes Ducken (Headset 0,95 m) → Puppe duckt
  await setHead(cl, { y: 0.95 });
  const p5 = await until(host, (id) => { const b = window.__game.bots.byNetId(id); return b && b.stance === 'crouch'; }, CID, 90000);
  check(!!p5, 'Headset 0,95 m: Puppe beim Host duckt (Haltungs-Bits)');
  await setHead(cl, { y: base.head[1] });
  await until(host, (id) => { const b = window.__game.bots.byNetId(id); return b && b.stance === 'stand'; }, CID, 90000);

  // ================================================================== VR beenden
  await ev(cl, () => window.__game.xr.end());
  const out = await until(cl, () => !window.__game.xr.presenting, null, 60000);
  check(!!out, 'Client: VR beendet');
  const devPc = await until(host, (id) => { const r = window.__game.net.rosterEntry(id); return r && r.device === 'pc'; }, CID, 60000);
  check(!!devPc, 'Roster beim Host: Gerät wieder pc');
  const p6 = await until(host, (id) => { const b = window.__game.bots.byNetId(id); return b && b.netPose && !b.netPose.vr && b._vrW === 0 && b.soldier.anim.glance.until !== Infinity; }, CID, 90000);
  check(!!p6, 'Puppe ohne VR-Pose: Waffe zurück im Animator, Blick freigegeben');
  const sizes2 = await until(cl, () => { const s = window.__stateSizes.slice(-5); return s.length === 5 && s.every((n) => n === 37) && s; }, null, 60000);
  check(!!sizes2, 'Zustand nach VR wieder 37 Byte');
} catch (err) {
  check(false, `Ablauf: ${err && err.message ? err.message : err}`);
}
for (const [n, list] of Object.entries(errors)) check(list.length === 0, `${n}: ${list.length} Seiten-/Konsolenfehler${list.length ? ` – ${list.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(fail ? `${fail} von ${count} Prüfungen fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
