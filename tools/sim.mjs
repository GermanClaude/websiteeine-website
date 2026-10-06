// Schnelle Match-Simulation ohne Rendern (Systeme direkt takten), danach Aufnahmen.
// Ergebnisse: tools/out/sim-<name>.json und Aufnahmen tools/out/sim-<name>-<i>.png
// node tools/sim.mjs --map=hafen --mode=tdm --seconds=120 [--dt=0.0333] [--diff=regulaer] [--shots=3] [--mobile] [--name=x] [--extra="allies=5&enemies=6"] [--player=god|mortal|center]
// Der Spieler ist standardmäßig unverwundbar (debugApi.godMode → Match ungewertet, keine EP). Server: NP_BASE (Standard :8765).
import { chromium, devices, BASE, GL_ARGS } from './pw.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('tools/out', { recursive: true });

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const map = opt.map || 'hafen', mode = opt.mode || 'tdm';
const name = opt.name || `${map}-${mode}${opt.mobile ? '-m' : ''}`;
const q = new URLSearchParams({ autostart: '1', map, mode, diff: opt.diff || 'regulaer', time: String(opt.time || 900), score: String(opt.score || 999), quality: opt.quality || 'low' });
if (opt.extra) for (const [k, v] of new URLSearchParams(opt.extra)) q.set(k, v);
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = opt.mobile
  ? await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 }, isMobile: true, hasTouch: true })
  : await browser.newContext({ viewport: { width: Number(opt.w || 1100), height: Number(opt.h || 620) } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`${BASE}spielen.html?${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && (window.__game.match.state === 'countdown' || window.__game.match.state === 'playing'), null, { timeout: 150000 });
// Countdown überspringen + Simulator installieren
await page.evaluate(async (god) => {
  const G = window.__game;
  if (god) G.debugApi.godMode(true);
  G.match.countdown = 0.001;
  G.events.on('actor:hit', (e) => { if (e.target === G.player) { window.__sim.pdmg += e.amount; window.__sim.phits++; } });
  G.events.on('kill', (e) => {
    if (e.victim === G.player) window.__sim.pdeaths++;
    const k = e.weaponId || 'none';
    window.__sim.deathsBy[k] = (window.__sim.deathsBy[k] || 0) + 1;
    if ((k === 'world' || k === 'fall') && e.victim && e.victim.position) window.__sim.envDeaths = (window.__sim.envDeaths || []).concat([[e.victim.name, k, e.victim.position.x.toFixed(1), e.victim.position.y.toFixed(1), e.victim.position.z.toFixed(1)]]);
  });
  // bots-scale: Taktik-Ereignisse, Eroberungen, Panzerung/Heilung/Markieren zählen
  G.events.on('bot:tactic', (e) => { const s = window.__sim, k = e && e.type || '?'; if (s) s.tactics[k] = (s.tactics[k] || 0) + 1; });
  G.events.on('objective:captured', () => { if (window.__sim) window.__sim.captures++; });
  // ai-adapt: Anpassungs-Ereignisse und Bot-Granaten (Art) zählen
  G.events.on('bot:adapt', (e) => { const s = window.__sim, k = e && e.type || '?'; if (s) s.adapt[k] = (s.adapt[k] || 0) + 1; });
  G.events.on('grenade:throw', (e) => { const s = window.__sim; if (s && e && e.actor && e.actor.isBot) s.nades[e.type || '?'] = (s.nades[e.type || '?'] || 0) + 1; });
  for (const ev of ['gadget:heal', 'spot', 'armor:plate', 'player:stance']) G.events.on(ev, (e) => { const s = window.__sim; if (s && e && e.actor && e.actor.isBot && (ev !== 'armor:plate' || e.phase === 'end')) s.ev[ev] = (s.ev[ev] || 0) + 1; });
  G.events.on('actor:spawn', ({ actor }) => {
    if (actor !== G.player || !window.__simCenter) return;
    const n = G.world.nav.nearest(window.__simCenter);
    if (n) { G.player.body.teleport(n.position); G.player.yaw = Math.random() * 6.28; }
  });
  const phys = await import('./assets/js/game/engine/physics.js');
  window.__sim = {
    pdmg: 0, pdeaths: 0, phits: 0, firstHitAfterSeen: [],
    visits: new Map(), dist: new Map(), last: new Map(), errors: [], inWall: 0, deathsBy: {}, falls: 0,
    tactics: {}, ev: {}, adapt: {}, nades: {}, goals: {}, captures: 0, botMs: 0, botTicks: 0, botMax: 0, botSamples: [], wallWalk: 0, inWallWhere: [],
    run(seconds, dt) {
      const G = window.__game;
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i++) {
        if (G.match.state === 'countdown') { G.match.countdown = 0; }
        if (G.match.state !== 'playing' && G.match.state !== 'countdown') break;
        if (G.match.state === 'countdown') {
          // einmal regulär weiterschalten
          G.match.state = 'playing';
          document.body.dataset.matchState = 'playing';
          G.events.emit('match:state', { state: 'playing', prev: 'countdown' });
          G.match.startedAt = G.time.elapsed;
          G.events.emit('match:start', { modeId: G.match.modeId, mapId: G.match.mapId });
        }
        G.time.dt = dt; G.time.elapsed += dt; G.time.real += dt; G.time.frame++;
        try {
          G.player.update(dt);
          const tb = performance.now();
          G.bots.update(dt);
          const mb = performance.now() - tb;
          this.botMs += mb; this.botTicks++; if (mb > this.botMax) this.botMax = mb;
          if (this.botSamples.length < 20000) this.botSamples.push(mb);
          phys.separateActors(G.actors);
          G.weapons.update(dt);
          if (G.mode) G.mode.update(dt);
          for (const a of G.actors) {
            if (a.alive || a.respawnAt == null || G.time.elapsed < a.respawnAt) continue;
            if (G.mode && G.mode.canRespawn && G.mode.canRespawn(a) === false) continue;
            G.spawnActor(a);
          }
          G.world.update(dt, G.camera);
          G.effects.update(dt);
        } catch (err) { this.errors.push(String(err && err.stack || err)); if (this.errors.length > 5) break; }
        // Statistik
        if (G.time.frame % 6 === 0) {
          for (const b of G.bots.bots) {
            if (!b.alive) continue;
            if (!b.team || b.team !== G.player.team) this.goals[b.goal.kind] = (this.goals[b.goal.kind] || 0) + 1; // Gegner des Spielers
            const key = `${Math.floor(b.position.x / 4)},${Math.floor(b.position.z / 4)}`;
            this.visits.set(key, (this.visits.get(key) || 0) + 1);
            const l = this.last.get(b);
            if (l) this.dist.set(b, (this.dist.get(b) || 0) + Math.hypot(b.position.x - l.x, b.position.z - l.z));
            this.last.set(b, b.position.clone());
            if (b.nav.stuck.level >= 3 && !b._simStuckSeen) { this.stuckEvents = (this.stuckEvents || 0) + 1; b._simStuckSeen = true; this.stuckWhere = (this.stuckWhere || []).concat([[b.name, b.position.x.toFixed(1), b.position.y.toFixed(1), b.position.z.toFixed(1), b.goal.kind]]); }
            if (b.nav.stuck.level < 2) b._simStuckSeen = false;
            // in Wand? (Kollisionskapsel steckt fest)
            if (G.world.collider && G.time.frame % 60 === 0) {
              const hit = G.world.collider.capsuleIntersect(b.body.collisionCapsule);
              if (hit && hit.depth > 0.12) { this.inWall++; if (this.inWallWhere.length < 12) this.inWallWhere.push([b.name, +b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1), +hit.depth.toFixed(2)]); }
              // gegen die Wand laufen: will sich bewegen, Wandkontakt, kaum Geschwindigkeit
              const wn = b.body.wallNormal, v = b.body.velocity, mx = b._mx || 0, mz = b._mz || 0, ml = Math.hypot(mx, mz);
              if (wn && ml > 0.3 && (mx * wn.x + mz * wn.z) / ml < -0.7 && Math.hypot(v.x, v.z) < 0.4) { this.wallWalk++; if ((this.wallWhere || (this.wallWhere = [])).length < 8) this.wallWhere.push([b.name, +b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1), b.goal.kind]); }
            }
          }
        }
        if (G.mode && G.mode.isOver) break;
      }
      return this.report();
    },
    report() {
      const G = window.__game;
      const bots = G.bots.bots.map((b) => ({ n: b.name, t: b.team, a: b.alive, g: b.goal.kind, k: b.stats.kills, d: b.stats.deaths, sh: b.stats.shotsFired, hit: b.stats.shotsHit, dist: Math.round(this.dist.get(b) || 0), st: b.nav.stuck.level, w: b.weapon && b.weapon.currentDef && b.weapon.currentDef.id, p: [+b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1)] }));
      const sm = this.botSamples.slice().sort((a, b) => a - b);
      const perf = { botAvg: +(this.botMs / Math.max(1, this.botTicks)).toFixed(3), botP95: +(sm[Math.floor(sm.length * 0.95)] || 0).toFixed(3), botMax: +this.botMax.toFixed(2), ticks: this.botTicks };
      return { perf, tactics: this.tactics, ev: this.ev, adapt: this.adapt, nades: this.nades, goals: this.goals, adaptSnap: G.bots.adapt ? G.bots.adapt.snapshot() : null, captures: this.captures, wallWalk: this.wallWalk, wallWhere: this.wallWhere || [], inWallWhere: this.inWallWhere, stuckWhere: (this.stuckWhere || []).slice(-12), deathsBy: this.deathsBy, envDeaths: this.envDeaths || [], stuckEvents: this.stuckEvents || 0, pdmg: Math.round(this.pdmg), phits: this.phits, pdeaths: this.pdeaths, t: +G.time.elapsed.toFixed(1), state: G.match.state, kills: G.combat.killCount, scores: G.mode && G.mode.scores, cells: this.visits.size, inWall: this.inWall, errors: this.errors.slice(0, 3), stats: G.bots.stats(), player: { k: G.player.stats.kills, d: G.player.stats.deaths }, bots };
    },
  };
}, opt.player !== 'mortal');
if (opt.player === 'center') await page.evaluate(async () => {
  const G = window.__game;
  const T = await import('./assets/js/game/bots/ai/tactics.js');
  const A = T.analyze(G.world);
  window.__simCenter = A.center.clone();
  G.player.godMode = false;
  G.events.emit('actor:spawn', { actor: G.player });
});
const total = Number(opt.seconds || 90), dt = Number(opt.dt || 1 / 30), chunk = 10;
let rep = null;
const t0 = Date.now();
for (let s = 0; s < total; s += chunk) {
  rep = await page.evaluate(([c, d]) => window.__sim.run(c, d), [Math.min(chunk, total - s), dt]);
  console.log(`t=${rep.t} kills=${rep.kills} scores=${JSON.stringify(rep.scores)} cells=${rep.cells} states=${JSON.stringify(rep.stats.states)} inWall=${rep.inWall} ms=${rep.stats.ms}${rep.errors.length ? ' ERR ' + rep.errors[0] : ''}`);
  if (rep.state !== 'playing') break;
}
console.log(`Echtzeit ${(Date.now() - t0) / 1000}s  Tode nach Waffe ${JSON.stringify(rep.deathsBy)}  Umwelt ${JSON.stringify(rep.envDeaths)} Festhänge-Stufen>=3: ${rep.stuckEvents}`);
if (!opt.brief) for (const b of rep.bots) console.log(`${b.n.padEnd(12)} ${String(b.t).padEnd(4)} ${b.g.padEnd(9)} K${b.k} D${b.d} Schüsse ${b.sh} Treffer ${b.hit} Weg ${b.dist} m stuck ${b.st} ${b.w} @${b.p.join(',')}`);
if (rep.stuckWhere.length) console.log('Festhängen:', JSON.stringify(rep.stuckWhere));
console.log(`Bots-CPU ${JSON.stringify(rep.perf)}  Taktik ${JSON.stringify(rep.tactics)}  Ereignisse ${JSON.stringify(rep.ev)}  Eroberungen ${rep.captures}  Wandlaufen ${rep.wallWalk} ${JSON.stringify(rep.wallWhere)}  inWall ${rep.inWall} ${JSON.stringify(rep.inWallWhere)}`);
console.log(`Anpassung ${JSON.stringify(rep.adapt)}  Bot-Granaten ${JSON.stringify(rep.nades)}  Gegner-Ziele ${JSON.stringify(rep.goals)}\nModell ${JSON.stringify(rep.adaptSnap)}`);
console.log(`Spieler K${rep.player.k} D${rep.player.d} Treffer erhalten ${rep.phits} Schaden ${rep.pdmg} Tode ${rep.pdeaths}`);
writeFileSync(`tools/out/sim-${name}.json`, JSON.stringify(rep));
// Aufnahmen: hinter Bots stellen
const shots = Number(opt.shots ?? 2);
for (let i = 0; i < shots; i++) {
  await page.evaluate((i) => {
    const G = window.__game;
    const alive = G.bots.bots.filter((b) => b.alive);
    const b = alive[(i * 3) % Math.max(1, alive.length)];
    if (!b) return;
    const yaw = b.yaw + (i % 2 ? 0.6 : -0.5);
    const x = b.position.x + Math.sin(yaw) * 3.4, z = b.position.z + Math.cos(yaw) * 3.4;
    G.debugApi.teleport(x, b.position.y + 0.2, z);
    G.player.body.velocity.set(0, 0, 0);
    G.debugApi.lookAt(b.position.x, b.position.y + 1.2, b.position.z);
    window.__sim.run(0.2, 1 / 30);
  }, i);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `tools/out/sim-${name}-${i}.png`, timeout: 120000 });
}
console.log(logs.length ? logs.slice(0, 20).join('\n') : 'keine Konsolenfehler');
await browser.close();
