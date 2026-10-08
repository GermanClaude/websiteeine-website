// NULLPUNKT – Mehrspieler: Kampfrate einer vollen Bot-Runde messen (Kalibrierung RELIABLE_BYTES in net/recommend.js, §13).
// Der Host schickt jedes Treffer-/Abschuss-/Spawn-/Granaten-Ereignis zuverlässig an jeden Client; wie viele davon je
// Sekunde anfallen, hängt an der Kampfdichte. Auf dem Prüfrechner (SwiftShader, ≈ 1 Bild/s, ≤ 50 ms Spielzeit je Bild)
// läuft eine Runde nur mit ≈ 5 % Echtzeit – daher hier: Offline-Runde (= Host-Runde ohne Netz) mit abgeschaltetem Zeichnen,
// damit die Simulation viele Spielsekunden schafft; gezählt wird je Spielsekunde. Nachrichtengrößen (inkl. 60 Byte
// Paketkopf) aus dem Lasttest (tools/out/mp-load.json, sonst Standardwerte).
// Aufruf: node tools/mp-fight-rate.mjs [--mode=tdm] [--map=hafen] [--diff=regulaer] [--game=90] [--real=300]
// Voraussetzung: Server auf 8765. Ergebnis: tools/out/mp-fight.json.
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const MODE = opt.mode || 'tdm';
const MAP = opt.map || 'hafen';
const DIFF = opt.diff || 'regulaer';
const GAME_S = Number(opt.game || 90);
const REAL_S = Number(opt.real || 300);
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const ts = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s`;
const info = (text) => console.log(`${ts()}      ${text}`);

// Nachrichtengrößen (Byte inkl. Paketkopf): gemessen im Lasttest, Granaten-/Explosions-Ereignisse geschätzt
let sizes = { hit: 225, kill: 270, spawn: 230, ev: 170 };
try {
  const j = JSON.parse(readFileSync(`${OUT}mp-load.json`, 'utf8'));
  if (j.fight && j.fight.sizes) sizes = { ...sizes, ...j.fight.sizes };
} catch { /* Standardwerte */ }

const browser = await chromium.launch({ args: GL_ARGS });
let fail = 0;
let result = null;
try {
  const page = await (await browser.newContext({ viewport: { width: 320, height: 180 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}spielen.html?quality=low&autostart=1&mode=${MODE}&map=${MAP}&diff=${DIFF}&allies=15&enemies=16`);
  await page.waitForFunction(() => window.__game && window.__game.match && window.__game.match.state === 'playing' && window.__game.player.alive, null, { timeout: 300000, polling: 1000 });
  const actors = await page.evaluate(() => {
    const G = window.__game;
    G.player.invulnerable = true; // der Spieler steht still (Zuschauer), Bots kämpfen
    G.renderer.render = () => {}; // nur Simulation – sonst schafft SwiftShader ≈ 1 Bild/s
    const c = (window.__fight = { hits: 0, kills: 0, spawns: 0, ev: 0, game: 0, frames: 0, bots: G.bots.bots.length });
    G.events.on('actor:hit', () => { c.hits++; });
    G.events.on('kill', () => { c.kills++; });
    G.events.on('actor:spawn', () => { c.spawns++; });
    for (const n of ['grenade:throw', 'grenade:explode', 'projectile:launch', 'projectile:detonate', 'projectile:dud']) G.events.on(n, () => { c.ev++; });
    G.events.on('explosion', (e) => { if (e && !e.source) c.ev++; });
    const t = G.time.elapsed;
    const tick = () => { c.game = G.time.elapsed - t; c.frames = G.time.frame; requestAnimationFrame(tick); };
    tick();
    return G.bots.bots.length + 1;
  });
  info(`Runde läuft: ${MODE}/${MAP}, ${actors} Akteure (${DIFF}), Zeichnen aus – messe ${GAME_S} s Spielzeit (höchstens ${REAL_S} s)`);
  const tEnd = Date.now() + REAL_S * 1000;
  let c = null;
  while (Date.now() < tEnd) {
    await new Promise((r) => setTimeout(r, 5000));
    c = await page.evaluate(() => ({ ...window.__fight, state: window.__game.match.state }));
    if (c.game >= GAME_S || c.state !== 'playing') break;
  }
  const g = Math.max(1e-3, c.game);
  const scale = 32 / Math.max(1, actors - 1); // der Spieler kämpft nicht mit
  const rate = { hits: (c.hits / g) * scale, kills: (c.kills / g) * scale, spawns: (c.spawns / g) * scale, ev: (c.ev / g) * scale };
  const bps = rate.hits * sizes.hit + rate.kills * sizes.kill + rate.spawns * sizes.spawn + rate.ev * sizes.ev;
  result = { mode: MODE, map: MAP, diff: DIFF, actors, gameSec: Math.round(g * 10) / 10, realSec: Math.round((Date.now() - t0) / 1000), counts: c, per32: rate, sizes, bps: Math.round(bps) };
  info(`${result.gameSec} s Spielzeit: ${c.hits} Treffer, ${c.kills} Abschüsse, ${c.spawns} Spawns, ${c.ev} Granaten-/Raketen-Ereignisse`);
  info(`je Spielsekunde bei 32 kämpfenden Akteuren: ${rate.hits.toFixed(1)} Treffer, ${rate.kills.toFixed(2)} Abschüsse, ${rate.spawns.toFixed(2)} Spawns, ${rate.ev.toFixed(2)} Ereignisse → ${Math.round(bps)} B/s je Client (Größen ${JSON.stringify(sizes)})`);
  if (g < GAME_S * 0.5) { console.log(`FEHL nur ${g.toFixed(1)} s Spielzeit erreicht`); fail++; }
  if (errors.length) { console.log(`FEHL Seitenfehler: ${errors.join(' | ')}`); fail++; }
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  if (result) writeFileSync(`${OUT}mp-fight.json`, JSON.stringify(result, null, 2));
  await browser.close();
}
process.exit(fail ? 1 : 0);
