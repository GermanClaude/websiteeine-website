// NULLPUNKT – Stellung (hp, 26.10., Plan M1): Daten, Lage der Zonen im Prüfstand und Spiellogik.
//   daten (Node, ohne Browser): je Arena-Karte ≥ 2 Zonen mit eindeutigen Ids, Radius 3–8 m, im Kartenrahmen, ≥ 20 m von
//         beiden Startbereichen, spiegelgerecht (mittlerer Abstand zu Start A und B gleich ± 3 m); Modus-Daten (online,
//         Optionen, Punkte, Medaillen, Herausforderung) vollständig; Optionen bereinigen sich.
//   logik (Node, ohne Browser): HoldPointMode mit nachgebautem Spielkontext – allein = gehalten (1 Punkt/s, „Stellung
//         gehalten“ je 5 s, „eingenommen“), beide Teams = umkämpft (keine Punkte), leer = neutral, Bollwerk nach 30 s,
//         Vorschau 10 s vor dem Wechsel, Wechsel nach 45 s (?mopt=wechsel:45), Abbild (Client) übernimmt den Zustand
//         über netState/applyNetState samt Haltezeiten, Wiedereinstieg-Sperrzone, Bots in der Vorschau, Punkteziel.
//   welt (dev/world.html je Karte, nacheinander): Bodenhöhe der Zone, Mittelpunkt frei (Kapsel), ≥ 3 Navigationsknoten
//         im Kreis und Höhenband, Weg von beiden Startbereichen (Weglängen A/B), Kartenpunkte (mappoints.js) ≥ 4 m
//         außerhalb des Kreises; Draufsicht je Zone + Übersicht als Bild (tools/out/hp-<karte>-*.png).
//   spiel (spielen.html, Werk, niedrig): allein in der Zone → gehalten, 1 Punkt/s, „Stellung gehalten“; Gegner dazu →
//         umkämpft, keine Punkte; leer → neutral; Vorschau 10 s vor dem Wechsel, Wechsel nach „wechsel“ s (?mopt=);
//         Hinweise, Haltezeit in der Tabelle, Medaille Bollwerk, Abschuss an der Zone, Punkteziel beendet das Match.
// Aufruf: node tools/hp-test.mjs [--part=daten,welt,spiel] [--maps=werk,altstadt,hafen,bibliothek] [--shots=0]
//         (Server NP_BASE; Bilder nach tools/out/)
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { mkdirSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { MAPS } from '../assets/js/shared/maps.data.js';
import { MODES, SCORE_RULES, SCORE_LABELS, MEDALS, CHALLENGE_POOL, ONLINE_MODE_IDS, modeOptionValues, challengeStats } from '../assets/js/shared/modes.data.js';
import { MODUS_ZIELE } from '../assets/js/game/world/maps/modus-ziele.js';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const PARTS = String(opt.part || 'daten,logik,welt,spiel').split(',');
const ARENA = ['werk', 'altstadt', 'hafen', 'bibliothek'];
const MAP_LIST = opt.maps ? String(opt.maps).split(',') : ARENA;
// Bilder im Prüfstand: alle Zonen (Standard), --shots=N nur die ersten N je Karte, --shots=0 keine (Software-GL: ≈ 1 min je Bild)
const SHOTS = opt.shots !== '0';
const SHOT_N = opt.shots && opt.shots !== true && Number(opt.shots) > 0 ? Number(opt.shots) : Infinity;
mkdirSync('tools/out', { recursive: true });
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const info = (t) => console.log(`${ts()}      ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(p, fn, arg, ms = 60000, every = 400) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn, arg); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(every);
  }
}

/* ------------------------------------------------------------ daten */

function daten() {
  info('— Daten —');
  const m = MODES.hp;
  check(!!m && m.online && m.onlineVehicles && ONLINE_MODE_IDS.includes('hp'), 'Modus hp: online, mit Fahrzeugen (Arena: nur zivile), in ONLINE_MODE_IDS');
  check(['hold', 'hpcapture', 'hpdefend', 'hpassault'].every((k) => SCORE_RULES[k] > 0 && SCORE_LABELS[k]), 'Punkte-Gründe hold/hpcapture/hpdefend/hpassault mit Text');
  check(['bollwerk', 'stellungskaempfer', 'vorhut'].every((k) => MEDALS[k] && MEDALS[k].xp > 0), 'Medaillen Bollwerk, Stellungskämpfer, Vorhut');
  check(CHALLENGE_POOL.some((c) => c.stat === 'hpTime') && challengeStats({ counters: { hpTime: 91.6 } }).hpTime === 91, 'Herausforderung „Halte die Stellung …“ (hpTime)');
  const o1 = modeOptionValues('hp', { wechsel: '45', ziel: 'x' });
  const o2 = modeOptionValues('hp', null);
  check(o1.wechsel === 45 && o1.ziel === 250 && o2.wechsel === 60, `Optionen bereinigt (${JSON.stringify(o1)}, Standard ${JSON.stringify(o2)})`);
  for (const id of ARENA) {
    const zs = (MODUS_ZIELE[id] || {}).hp || [];
    const meta = MAPS[id];
    check(zs.length >= 2 && new Set(zs.map((z) => z.id)).size === zs.length, `${id}: ${zs.length} Zonen, Ids eindeutig`);
    check(Array.isArray(meta.modes) && meta.modes.includes('hp'), `${id}: maps.data modes enthält hp`);
    const b = meta.bounds;
    const sa = meta.spawns.A, sb = meta.spawns.B;
    let dA = 0, dB = 0;
    for (const z of zs) {
      const inB = z.x - z.radius >= b.minX && z.x + z.radius <= b.maxX && z.z - z.radius >= b.minZ && z.z + z.radius <= b.maxZ;
      const a = Math.hypot(z.x - sa[0], z.z - sa[1]), c = Math.hypot(z.x - sb[0], z.z - sb[1]);
      dA += a; dB += c;
      check(z.radius >= 3 && z.radius <= 8 && inB && Math.min(a, c) >= 20 && (!z.band || z.band[0] < 0 && z.band[1] > 1.8),
        `${id} ${z.id} ${z.name}: r ${z.radius}, im Rahmen ${inB}, Start A ${a.toFixed(0)} m / B ${c.toFixed(0)} m${z.band ? `, Band ${z.band.join('…')}` : ''}`);
    }
    dA /= zs.length; dB /= zs.length;
    check(Math.abs(dA - dB) <= 3, `${id}: spiegelgerecht – mittlerer Abstand Start A ${dA.toFixed(1)} m, Start B ${dB.toFixed(1)} m`);
  }
}

/* ------------------------------------------------------------ logik */

async function logik() {
  info('— Logik (Node) —');
  // 'three' und 'three/addons/' wie die Import-Map der Seite auf die mitgelieferten Dateien abbilden
  const T_URL = pathToFileURL(new URL('../assets/vendor/three/three.module.min.js', import.meta.url).pathname).href;
  const A_URL = pathToFileURL(new URL('../assets/vendor/three/addons/', import.meta.url).pathname).href;
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify(T_URL)}, shortCircuit: true }; if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(A_URL)} + s.slice(13), shortCircuit: true }; return n(s, c); }`), import.meta.url);
  const THREE = await import('three');
  const { HoldPointMode } = await import('../assets/js/game/modes/hp.js');
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mkEvents = () => {
    const subs = new Map();
    const on = (n, f) => { (subs.get(n) || subs.set(n, []).get(n)).push(f); return () => {}; };
    return { on, emit: (n, e) => { for (const f of subs.get(n) || []) f(e); }, scope: () => ({ on, dispose() {} }) };
  };
  const zones = [
    { id: '1', name: 'Eins', position: V(0, 0, 0), radius: 5, band: null },
    { id: '2', name: 'Zwei', position: V(40, 0, 0), radius: 5, band: [-1, 2] },
    { id: '3', name: 'Drei', position: V(-40, 3, 0), radius: 4, band: null },
  ];
  const world = { name: 'Testfeld', objectives: { hp: zones, dom: [] }, spawns: { A: [{ position: V(0, 0, 40) }], B: [{ position: V(0, 0, -40) }], ffa: [] } };
  const actor = (id, team, x, z, extra = {}) => ({ id, name: id, team, alive: true, position: V(x, 0, z), stats: { kills: 0, deaths: 0 }, netId: extra.netId, isPlayer: !!extra.player, isBot: !extra.player, ...extra });
  const pA = actor('player', 'A', 0, 30, { player: true, netId: 1 });
  const bA = actor('bA', 'A', 0, 35, { netId: 1001 });
  const eB = actor('eB', 'B', 0, -35, { netId: 1002 });
  const G = { events: mkEvents(), actors: [pA, bA, eB], player: pA, time: { elapsed: 0 }, world, match: { state: 'playing', mapId: 'testfeld', net: null },
    settings: { get: () => ({}) }, params: new URLSearchParams('mopt=wechsel:45') };
  const log = { score: [], medal: [], notice: [], move: 0 };
  G.events.on('score', (e) => { if (e.actor === pA) log.score.push(e.reason); });
  G.events.on('medal', (e) => { if (e.actor === pA) log.medal.push(e.id); });
  G.events.on('mode:notice', (e) => log.notice.push(e.text));
  G.events.on('hp:move', () => { log.move++; });
  const M = new HoldPointMode(G, 'hp', { streaks: false });
  M.start();
  const run = (sec, dt = 0.1) => { for (let t = 0; t < sec - 1e-6; t += dt) { G.time.elapsed += dt; M.update(dt); } };
  check(M.options.wechsel === 45 && Math.abs(M.rotLeft - 45) < 1e-6 && M.zones.length === 3 && M.objectives.length === 1, `?mopt=wechsel:45 → Wechsel alle ${M.options.wechsel} s, ${M.zones.length} Zonen`);
  pA.position.set(1, 0, 1);
  run(10);
  check(M.owner === 'A' && M.scores.A === 10 && log.score.filter((r) => r === 'hold').length === 2 && log.score.includes('hpcapture'), `allein: gehalten, ${M.scores.A} Punkte in 10 s, ${log.score.filter((r) => r === 'hold').length}× „Stellung gehalten“, eingenommen`);
  eB.position.set(-1, 0, -1);
  run(5);
  check(M.contested && M.scores.A === 10 && M.scores.B === 0 && M.owner === 'A', `beide Teams: umkämpft, keine Punkte (${M.scores.A}:${M.scores.B}), Besitz bleibt ${M.owner}`);
  eB.alive = false;
  run(5);
  check(!M.contested && M.owner === 'A' && M.scores.A === 15, `Gegner fällt: wieder gehalten (${M.scores.A})`);
  pA.position.set(0, 0, 30);
  run(1);
  check(M.owner === null && log.notice.some((t) => /geräumt/.test(t)), `leer: neutral (${M.owner}), Hinweis „Stellung geräumt“`);
  pA.position.set(0, 0, 0.5);
  run(16); // gesamt 37 s: Vorschau ab 35 s
  check(M.preview && M.objectives.length === 2 && M.objectives[1].next && M.objectives[1].id === '2' && log.notice.some((t) => /wandert in/.test(t)), `Vorschau nach ${45 - Math.round(M.rotLeft)} s: nächste Zone ${M.objectives[1] && M.objectives[1].id} gedimmt`);
  const nxt = [0, 1, 2, 3, 4, 5].map((i) => M.objectiveFor(actor(`bot${i}`, i % 2 ? 'A' : 'B', 0, 20)).id);
  check(nxt.includes('2') && nxt.includes('1'), `Bots in der Vorschau: ein Teil geht schon zur nächsten Zone (${nxt.join(',')})`);
  // Bollwerk: seit Wiedereintritt (21 s) + weitere – Medaille nach 30 s am Stück in diesem Leben
  run(8.5);
  check(M.idx === 1 && M.serial === 1 && !M.preview && M.objectives.length === 1 && M.owner === null && log.move === 1 && log.notice.some((t) => /Neue Stellung: Zwei/.test(t)), `Wechsel nach 45 s: Zone ${M.idx + 1}, neutral, Hinweis`);
  check(log.medal.includes('bollwerk'), `Bollwerk nach 30 s gehalten (${log.medal.join(', ')})`);
  // Höhenband: auf dem Dach über Zone 2 zählt nicht
  pA.position.set(40, 4, 0);
  run(2);
  check(M.owner === null, `Höhenband: 4 m über der Zone zählt nicht (${M.owner})`);
  pA.position.set(40.5, 0, 0);
  run(3);
  check(M.owner === 'A' && log.medal.includes('vorhut'), `Vorhut: erster in der neuen Zone (${log.medal.join(', ')})`);
  // Abbild (Client): Zustand übernehmen
  const G2 = { ...G, events: mkEvents(), time: { elapsed: 0 }, match: { state: 'playing', mapId: 'testfeld', net: { modeOpts: { wechsel: 45 } }, netLive: true } };
  const cA = { ...pA, stats: {} }, cB = { ...bA, stats: {} }, cE = { ...eB, stats: {} };
  G2.actors = [cA, cB, cE]; G2.player = cA;
  const notes2 = [];
  G2.events.on('mode:notice', (e) => notes2.push(e.text));
  const R = new HoldPointMode(G2, 'hp', { replica: true, streaks: false });
  R.start();
  const byNet = (id) => G2.actors.find((a) => a.netId === id) || null;
  R.applyNetState(M.netState(), byNet);
  check(R.idx === M.idx && R.owner === 'A' && R.scores.A === M.scores.A && R.objectives[0].id === '2' && Math.round(cA.stats.hpTime) === Math.floor(pA.stats.hpTime) && notes2.some((t) => /Neue Stellung/.test(t)),
    `Abbild: Zone ${R.idx + 1}, Besitz ${R.owner}, Punkte ${R.scores.A}, Haltezeit ${cA.stats.hpTime} s (Host ${pA.stats.hpTime.toFixed(1)} s)`);
  M.rotLeft = 9.5; run(0.2);
  R.applyNetState(M.netState(), byNet);
  check(R.preview && R.objectives.length === 2 && R.objectives[1].id === '3', `Abbild: Vorschau übernommen (${R.objectives.map((o) => o.id + (o.next ? '+' : '')).join(',')})`);
  R.update(1); // zählt selbst weiter
  check(R.rotLeft <= 9.3 && R.rotLeft >= 8, `Abbild zählt die Restzeit selbst (${R.rotLeft.toFixed(1)} s, Host ${M.rotLeft.toFixed(1)} s vor 1 s)`);
  // Wiedereinstieg: Sperrzone ≥ 25 m
  const av = M.spawnAvoid();
  check(av && av.length === 1 && av[0].radius + 6 === 25 && av[0].position === M.zone.position, `Wiedereinstieg: Sperrzone ${av && av[0].radius + 6} m um die aktive Zone`);
  // Tabelle + Punkteziel
  const row = M.scoreboard().find((r) => r.isPlayer);
  check(row.extra.label === 'Haltezeit' && /^\d+:\d\d$/.test(row.extra.value), `Tabelle: Haltezeit ${row.extra.value}`);
  M.scores.A = M.scoreLimit - 1;
  run(1.2);
  check(M.isOver && M.result && M.result.reason === 'score' && M.result.playerWon && M.result.playerSummary.counters.hpTime > 30, `Punkteziel ${M.scoreLimit}: Sieg, Haltezeit im Ergebnis ${Math.round(M.result && M.result.playerSummary.counters.hpTime)} s`);
}

/* ------------------------------------------------------------ welt */

async function welt(browser) {
  info('— Prüfstand —');
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  for (const id of MAP_LIST) {
    await p.goto(`${BASE}dev/world.html?map=${id}&quality=low&show=modeobj`, { timeout: 300000, waitUntil: 'domcontentloaded' });
    const ok = await until(p, (m) => window.__dev && window.__dev.ready && window.__dev.world && window.__dev.world.id === m, id, 400000, 1500);
    if (!check(!!ok, `${id}: Prüfstand geladen`)) continue;
    const res = await p.evaluate(async (mapId) => {
      const D = window.__dev;
      const W = D.world;
      const T = D.G.THREE;
      const { POINT_LAYOUT } = await import('/assets/js/game/mappoints.js');
      const { MAPS } = await import('/assets/js/shared/maps.data.js');
      const meta = MAPS[mapId];
      const pts = [];
      for (const [kind, ref, dx, dz] of POINT_LAYOUT[mapId] || []) {
        let bx = null, bz = null;
        if (ref[0] === 's') { const s = meta.spawns[ref[1]]; if (s) { bx = s[0]; bz = s[1]; } }
        else { const f = (meta.flags || []).find((x) => x.id === ref[1]); if (f) { bx = f.x; bz = f.z; } }
        if (bx != null) pts.push({ kind, x: bx + dx, z: bz + dz });
      }
      const bvh = W.debugData.colliderBVH;
      const hit = { t: 0 };
      const blocked = (p) => {
        for (const hy of [0.6, 1.4]) for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (bvh.raycast(p.x, p.y + hy, p.z, Math.cos(a), 0, Math.sin(a), 0.33, hit)) return true;
        }
        return false;
      };
      const len = (from, path) => { let L = 0, q = from; for (const x of path) { L += q.distanceTo(x); q = x; } return L; };
      const cen = (list) => { const v = new T.Vector3(); for (const s of list) v.add(s.position); return v.multiplyScalar(1 / Math.max(1, list.length)); };
      const SA = cen(W.spawns.A), SB = cen(W.spawns.B);
      const out = [];
      for (const z of W.objectives.hp || []) {
        const band = z.band || [-2.6, 2.6];
        let nodes = 0;
        for (const n of W.nav.nodes) {
          const dx = n.position.x - z.position.x, dz = n.position.z - z.position.z, dy = n.position.y - z.position.y;
          if (dx * dx + dz * dz <= z.radius * z.radius && dy >= band[0] && dy <= band[1]) nodes++;
        }
        const near = W.nav.nearestReachable(z.position);
        const pa = W.nav.findPath(SA, z.position), pb = W.nav.findPath(SB, z.position);
        const endOk = (path) => path.length && path[path.length - 1].distanceTo(z.position) <= z.radius;
        const pd = pts.map((q) => ({ kind: q.kind, edge: Math.hypot(q.x - z.position.x, q.z - z.position.z) - z.radius })).sort((a, b) => a.edge - b.edge);
        out.push({
          id: z.id, name: z.name, x: z.position.x, y: +z.position.y.toFixed(2), z: z.position.z, r: z.radius, band,
          blocked: blocked(z.position), nodes, nearD: near ? +near.position.distanceTo(z.position).toFixed(2) : null,
          pathA: endOk(pa) ? Math.round(len(SA, pa)) : null, pathB: endOk(pb) ? Math.round(len(SB, pb)) : null,
          point: pd[0] ? { kind: pd[0].kind, edge: +pd[0].edge.toFixed(1) } : null,
        });
      }
      return out;
    }, id);
    let sumA = 0, sumB = 0;
    for (const z of res) {
      const pOk = !z.point || z.point.edge >= 4;
      check(!z.blocked && z.nodes >= 3 && z.nearD != null && z.nearD <= z.r && z.pathA != null && z.pathB != null && pOk,
        `${id} ${z.id} ${z.name}: y ${z.y}, frei ${!z.blocked}, ${z.nodes} Nav-Knoten im Band, Weg A ${z.pathA} m / B ${z.pathB} m, nächster Kartenpunkt ${z.point ? `${z.point.kind} ${z.point.edge} m vom Rand` : '–'}`);
      sumA += z.pathA || 0; sumB += z.pathB || 0;
    }
    if (res.length) check(Math.abs(sumA - sumB) / Math.max(sumA, sumB) <= 0.15, `${id}: Wege gesamt A ${sumA} m / B ${sumB} m (≤ 15 % Unterschied)`);
    if (SHOTS) {
      // Übersicht von oben + je Zone eine Schrägsicht (Ring + Höhenband sichtbar)
      await p.evaluate(() => { const el = document.getElementById('panel'); if (el) el.style.display = 'none'; });
      for (const z of res.slice(0, SHOT_N)) {
        // Schrägsicht von Süden; unter einem Dach (Strahl nach oben) bleibt die Kamera knapp unter der Decke
        await p.evaluate((q) => {
          const D = window.__dev;
          const bvh = D.world.debugData.colliderBVH;
          const hit = { t: 0 };
          let h = 12 + q.r;
          if (bvh.raycast(q.x, q.y + 1.8, q.z, 0, 1, 0, 30, hit)) h = Math.max(2.6, Math.min(h, hit.t + 1.8 - 0.6));
          const back = h < 8 ? q.r + 5 : q.r + 8;
          const pitch = -Math.atan2(h - 0.5, back);
          D.setCam(q.x, q.y + h, q.z + back, 0, pitch);
          D.setToggles(['modeobj']);
          D.render();
        }, z);
        await sleep(400);
        await p.screenshot({ path: `tools/out/hp-${id}-${z.id}.png`, timeout: 180000 });
      }
    }
  }
  check(!errors.length, `Prüfstand ohne Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

/* ------------------------------------------------------------ spiel */

async function spiel(browser) {
  info('— Spiel (Werk) —');
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=hp&map=werk&allies=1&enemies=2&diff=rekrut&quality=low&debug=1&mopt=wechsel:45`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  const ok = await until(p, () => { const G = window.__game; return G && G.match && G.match.state === 'playing' && G.player.alive && G.mode && G.mode.started && G.mode.id; }, null, 400000, 1000);
  if (!check(ok === 'hp', `Stellung läuft (${ok})`)) { await ctx.close(); return; }
  // Bots aus dem Weg: eingefroren und weit weg (Spiellogik ohne Zufall prüfen)
  const setup = await p.evaluate(() => {
    const G = window.__game;
    const M = G.mode;
    G.player.godMode = true;
    window.__hp = { notices: [], medals: [], scores: [], moves: 0 };
    G.events.on('mode:notice', (e) => window.__hp.notices.push(e.text));
    G.events.on('medal', (e) => { if (e.actor === G.player) window.__hp.medals.push(e.id); });
    G.events.on('score', (e) => { if (e.actor === G.player) window.__hp.scores.push(e.reason); });
    G.events.on('hp:move', () => { window.__hp.moves++; });
    window.__park = () => {
      let k = 0;
      for (const b of G.bots.bots) {
        b.body.teleport(new G.THREE.Vector3(-74 + (k++ % 3) * 2, 0.2, b.team === 'A' ? 42 : -42));
        b.body.velocity.set(0, 0, 0);
        b._parked = true;
      }
    };
    // Bots denken nicht (bleiben geparkt); Wiedereinstiege aus
    for (const b of G.bots.bots) { b.brain = b.brain || {}; }
    G.bots._hpFrozen = true;
    const upd = G.bots.update.bind(G.bots);
    G.bots.update = (dt) => { if (!G.bots._hpFrozen) upd(dt); };
    window.__park();
    return { rot: M.rotLeft, opt: M.options, limit: M.scoreLimit, zone: M.zone.name, n: M.zones.length };
  });
  check(setup.opt.wechsel === 45 && Math.abs(setup.rot - 45) < 3, `Option ?mopt=wechsel:45 wirkt (Restzeit ${setup.rot.toFixed(1)} s, Punkteziel ${setup.limit})`);
  // Spieler in die Zone
  const into = (q) => p.evaluate((w) => {
    const G = window.__game; const z = G.mode.objectives[0];
    G.debugApi.teleport(z.position.x + (w ? w.dx : 0), z.position.y + 0.3, z.position.z + (w ? w.dz : 0));
    G.player.body.velocity.set(0, 0, 0);
  }, q);
  const gameWait = (s) => p.evaluate((sec) => { const G = window.__game; G.timeScale = 4; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 300000 ? (G.timeScale = 1, r()) : setTimeout(f, 50)); f(); }); }, s);
  await into();
  await gameWait(1);
  const s0 = await p.evaluate(() => { const M = window.__game.mode; return { owner: M.owner, A: M.scores.A, team: window.__game.player.team, rot: M.rotLeft }; });
  await gameWait(8);
  const s1 = await p.evaluate(() => { const M = window.__game.mode; const r = M.scoreboard().find((x) => x.isPlayer); return { owner: M.owner, A: M.scores.A, held: window.__game.player.stats.hpTime, row: r && r.extra, scores: window.__hp.scores.slice() }; });
  const gain = s1.A - s0.A;
  check(s0.owner === s0.team && s1.owner === s0.team && gain >= 6 && gain <= 10, `allein in der Zone: gehalten, ${gain} Punkte in 8 s Spielzeit`);
  check(s1.scores.includes('hpcapture') && s1.scores.includes('hold'), `„Stellung eingenommen“ und „Stellung gehalten“ (${[...new Set(s1.scores)].join(', ')})`);
  check(s1.row && s1.row.label === 'Haltezeit' && /^0:\d\d$/.test(s1.row.value), `Tabelle: Haltezeit ${s1.row && s1.row.value}`);
  // Gegner dazu → umkämpft, keine Punkte
  await p.evaluate(() => {
    const G = window.__game; const z = G.mode.objectives[0];
    const e = G.bots.bots.find((b) => b.team !== G.player.team && b.alive);
    e.body.teleport(new G.THREE.Vector3(z.position.x + 1.5, z.position.y + 0.3, z.position.z));
    e.body.velocity.set(0, 0, 0);
    window.__enemy = e;
  });
  await gameWait(1);
  const c0 = await p.evaluate(() => { const M = window.__game.mode; return { c: M.contested, A: M.scores.A, B: M.scores.B }; });
  await gameWait(4);
  const c1 = await p.evaluate(() => { const M = window.__game.mode; return { c: M.contested, A: M.scores.A, B: M.scores.B, owner: M.owner, n: window.__hp.notices.slice(-4) }; });
  check(c0.c && c1.c && c1.A === c0.A && c1.B === c0.B, `Gegner in der Zone: umkämpft, keine Punkte (${c0.A}:${c0.B} → ${c1.A}:${c1.B})`);
  check(c1.n.some((t) => /umkämpft/.test(t)), `Hinweis „Stellung umkämpft“ (${c1.n.join(' | ')})`);
  // Abschuss an der Zone
  await p.evaluate(() => { const G = window.__game; const e = window.__enemy; G.combat.damage(e, { amount: 9999, attacker: G.player, weaponId: 'ar_m17', zone: 'body', point: e.position.clone(), distance: 2 }); });
  await gameWait(0.5);
  const k = await p.evaluate(() => ({ scores: window.__hp.scores.slice(), c: window.__game.mode.contested }));
  check(k.scores.includes('hpdefend') && !k.c, `Abschuss an der eigenen Stellung → „Stellung verteidigt“, nicht mehr umkämpft`);
  // Spieler raus → neutral
  await p.evaluate(() => { const G = window.__game; const s = G.world.spawns[G.player.team][0]; G.debugApi.teleport(s.position.x, s.position.y + 0.3, s.position.z); window.__park(); });
  await gameWait(1.5);
  const n0 = await p.evaluate(() => window.__game.mode.owner);
  check(n0 === null, `leere Zone: neutral (${n0})`);
  // Bollwerk: 30 s halten ohne zu fallen
  await into({ dx: 0.5, dz: 0.5 });
  const pre = await p.evaluate(() => window.__game.mode.rotLeft);
  if (pre < 34) { info(`Restzeit ${pre.toFixed(1)} s – warte den Wechsel ab`); await gameWait(pre + 0.5); await into({ dx: 0.5, dz: 0.5 }); }
  await gameWait(31);
  const bw = await p.evaluate(() => ({ medals: window.__hp.medals.slice(), owner: window.__game.mode.owner }));
  check(bw.medals.includes('bollwerk'), `Medaille Bollwerk nach 30 s (${bw.medals.join(', ')})`);
  // Vorschau und Wechsel
  const left = await p.evaluate(() => window.__game.mode.rotLeft);
  await gameWait(Math.max(0, left - 9));
  const pv = await p.evaluate(() => { const M = window.__game.mode; return { prev: M.preview, objs: M.objectives.map((o) => `${o.id}${o.next ? '+' : ''}`), hud: (document.querySelector('.h-hpt') || {}).textContent || '', next: document.querySelectorAll('.h-mk.is-next').length }; });
  check(pv.prev && pv.objs.length === 2 && pv.objs[1].endsWith('+') && pv.next === 1, `Vorschau: nächste Zone gedimmt (${pv.objs.join(', ')}; HUD „${pv.hud.trim()}“)`);
  if (SHOTS) { await sleep(800); await p.screenshot({ path: 'tools/out/hp-spiel-vorschau.png', timeout: 120000 }); }
  const idx0 = await p.evaluate(() => window.__game.mode.idx);
  await gameWait(10);
  const mv = await p.evaluate(() => { const M = window.__game.mode; return { idx: M.idx, moves: window.__hp.moves, prev: M.preview, owner: M.owner, rot: M.rotLeft, n: window.__hp.notices.slice(-3), objs: M.objectives.map((o) => o.id), name: M.zone.name }; });
  const mvHint = [...mv.n].reverse().find((t) => /Neue Stellung/.test(t)) || '–';
  check(mv.idx === (idx0 + 1) % setup.n && mv.moves >= 1 && !mv.prev && mv.objs.length === 1 && mv.rot > 30 && mvHint.includes(mv.name), `Wechsel: Zone ${idx0 + 1} → ${mv.idx + 1}, Restzeit neu ${mv.rot.toFixed(0)} s, Hinweis „${mvHint}“`);
  // Neue Zone halten und Bild mit HUD
  await into();
  await gameWait(2);
  if (SHOTS) { await sleep(800); await p.screenshot({ path: 'tools/out/hp-spiel-halten.png', timeout: 120000 }); }
  // Punkteziel beendet das Match
  await p.evaluate(() => { const M = window.__game.mode; M.scores[window.__game.player.team] = M.scoreLimit - 2; });
  await gameWait(3);
  const end = await until(p, () => { const G = window.__game; return G.mode.isOver && G.mode.result && { reason: G.mode.result.reason, won: G.mode.result.playerWon, held: G.mode.result.extra && G.mode.result.extra.held, hpTime: G.mode.result.playerSummary.counters.hpTime }; }, null, 60000);
  check(!!end && end.reason === 'score' && end.won && end.hpTime > 30, `Punkteziel beendet das Match (Sieg ${end && end.won}, Haltezeit ${end && Math.round(end.hpTime)} s, Team ${JSON.stringify(end && end.held)})`);
  if (SHOTS && end) {
    await until(p, () => !!document.querySelector('.e-stats'), null, 60000);
    await sleep(1500);
    await p.screenshot({ path: 'tools/out/hp-spiel-ende.png', timeout: 120000 });
  }
  check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

let browser = null;
try {
  if (PARTS.includes('daten')) daten();
  if (PARTS.includes('logik')) await logik();
  if (PARTS.includes('welt') || PARTS.includes('spiel')) browser = await chromium.launch({ args: GL_ARGS });
  if (PARTS.includes('welt')) await welt(browser);
  if (PARTS.includes('spiel')) await spiel(browser);
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  if (browser) await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
