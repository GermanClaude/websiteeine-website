// NULLPUNKT — Leistungsmessung im laufenden Match (Headless-Chromium, WebGL über SwiftShader).
//
// SwiftShader rendert auf der CPU (≈ 0,2–2 FPS) – echte GPU-Bildraten sind hier nicht messbar. Gemessen wird deshalb,
// was die Geräte-GPU nicht ändert: Hauptthread-CPU je Bild (rAF-Rückrufe), Zeit je System (bots, world, render …),
// Draw Calls/Dreiecke/Programme je Bild, neu kompilierte Shader-Programme mitten im Match (Ruckler), lange Aufgaben,
// Heap-Wachstum (Allokationen → Speicherbereinigung) und optional ein CPU-Profil (CDP) mit den teuersten Funktionen.
//
// Aufruf (Server muss laufen; NP_BASE wie bei smoke.mjs):
//   node tools/perf-test.mjs [--params="mode=tdm&map=hafen&allies=6&enemies=6"] [--quality=low] [--seconds=30]
//                            [--size=960x540] [--mobile] [--profile] [--top=25] [--warm=4] [--effects]
//   --profile  CPU-Profil über die Messdauer (Selbstzeit je Funktion und je Datei)
//   --warm     Sekunden nach Matchbeginn, die nicht gemessen werden (Standard 4)
//   --effects  während der Messung Explosion/Einschläge/Leichen nahe der Kamera auslösen (erstes Auftauchen = Ruckler?)
//   --god      Spieler unverwundbar (gleiche Kameraszene über die ganze Messung)
//   --combat   Kampfablauf je 4 s (Feuerstoß, Nachladen, Waffenwechsel) über input.simulate
// Ausgabe: JSON auf stdout.
import { chromium, devices, BASE as DEFAULT_BASE, GL_ARGS } from './pw.mjs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const BASE = String(opt.base || DEFAULT_BASE);
const SECONDS = Number(opt.seconds || 30);
const WARM = Number(opt.warm ?? 4);
const MOBILE = !!opt.mobile;
const TOP = Number(opt.top || 25);
const [W, H] = String(opt.size || (MOBILE ? '915x412' : '960x540')).split('x').map(Number);
const qs = new URLSearchParams(String(opt.params || 'mode=tdm&map=hafen&allies=6&enemies=6'));
qs.set('autostart', '1');
if (opt.quality) qs.set('quality', String(opt.quality));
const url = `${BASE}spielen.html?${qs}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = { url, size: `${W}x${H}`, mobile: MOBILE, errors: [], load: {}, frames: {}, systems: {}, render: {}, programs: {}, longTasks: {}, heap: {} };
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = MOBILE
  ? await browser.newContext({ ...devices['Pixel 7'], viewport: { width: W, height: H }, screen: { width: W, height: H }, isMobile: true, hasTouch: true })
  : await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text()); });
page.on('pageerror', (e) => out.errors.push(`[pageerror] ${e.message}`));

// Vor allen Seitenskripten: rAF-Rückrufe zeitlich erfassen, lange Aufgaben sammeln
await page.addInitScript(() => {
  const P = (window.__perf = { on: false, frames: [], sys: null, cur: null, long: [], compiles: 0, compileMs: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (!P.on) { cb(t); return; }
    P.cur = { cpu: 0, sys: {} };
    const s = performance.now();
    try { cb(t); } finally {
      P.cur.cpu = performance.now() - s;
      P.cur.t = t;
      P.frames.push(P.cur);
      P.cur = null;
    }
  });
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (P.on) P.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
  } catch { /* ohne Long-Task-API */ }
  // Shader-Übersetzungen mitten im Match zählen (linkProgram + erster Statusabruf blockieren)
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const link = C.prototype.linkProgram;
    C.prototype.linkProgram = function (p) { if (P.on) P.compiles++; return link.call(this, p); };
    const gpp = C.prototype.getProgramParameter;
    C.prototype.getProgramParameter = function (p, n) {
      if (!P.on) return gpp.call(this, p, n);
      const s = performance.now();
      try { return gpp.call(this, p, n); } finally { P.compileMs += performance.now() - s; }
    };
  }
});

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
const waitFor = async (fn, timeout, label) => {
  const s = Date.now();
  for (;;) {
    let v = null;
    try { v = await page.evaluate(fn); } catch { /* lädt */ }
    if (v) return v;
    if (Date.now() - s > timeout) throw new Error(`Zeitüberschreitung: ${label}`);
    await sleep(250);
  }
};
try {
  await waitFor(() => window.__game && ['countdown', 'playing'].includes(window.__game.match.state), 400000, 'Match-Start');
  out.load.toCountdownS = Math.round((Date.now() - t0) / 100) / 10;
  await waitFor(() => window.__game.match.state === 'playing', 300000, 'Countdown');
  out.load.toPlayingS = Math.round((Date.now() - t0) / 100) / 10;
  await sleep(WARM * 1000);

  // Systeme einhängen (nach dem Matchstart: G.points/G.holes … entstehen je Match)
  await page.evaluate(async ({ god }) => {
    const G = window.__game;
    const P = window.__perf;
    // Soldaten-Geometrien (bots/soldier/gear.js): entsteht mitten im Match eine neue Ausführung, fehlte sie im Vorbau
    try { P.gear = await import(new URL('assets/js/game/bots/soldier/gear.js', location.href).href); P.sgeo0 = P.gear.soldierGeometryStats().count; } catch { P.gear = null; }
    if (god && G.player) G.player.godMode = true;
    const wrap = (key, obj, name) => {
      if (!obj || typeof obj[name] !== 'function' || obj[name].__perfWrapped) return;
      const orig = obj[name];
      const f = function (...a) {
        const s = performance.now();
        try { return orig.apply(this, a); } finally {
          const d = performance.now() - s;
          if (P.cur) P.cur.sys[key] = (P.cur.sys[key] || 0) + d;
        }
      };
      f.__perfWrapped = true;
      obj[name] = f;
    };
    const list = [['input', G.input, 'update'], ['player', G.player, 'update'], ['bots', G.bots, 'update'], ['vehicles', G.vehicles, 'update'],
      ['points', G.points, 'update'], ['building', G.building, 'update'], ['doors', G.doors, 'update'], ['injuries', G.injuries, 'update'],
      ['gore', G.gore, 'update'], ['destruction', G.destruction, 'update'], ['deform', G.deform, 'update'], ['armor', G.combat, 'tickArmor'],
      ['weapons', G.weapons, 'update'], ['mode', G.mode, 'update'], ['world', G.world, 'update'], ['effects', G.effects, 'update'],
      ['holes', G.holes, 'update'], ['trees', G.trees, 'update'], ['hud', G.hud, 'update'], ['audio', G.audio, 'update'], ['render', G.renderer, 'render']];
    for (const [k, o, n] of list) wrap(k, o, n);
    // Draw Calls des ganzen Bildes (inkl. Schatten und Nachbearbeitung) direkt nach render()
    const R = G.renderer;
    const r0 = R.render;
    R.render = function (...a) {
      const res = r0.apply(this, a);
      if (P.cur) { const i = R.renderer.info.render; P.cur.calls = i.calls; P.cur.tris = i.triangles; }
      return res;
    };
    P.programs0 = (R.renderer.info.programs || []).map((p) => p.name + '|' + p.cacheKey.length);
    P.progSet0 = new Set(R.renderer.info.programs || []);
    P.tex0 = R.renderer.info.memory.textures;
    P.geo0 = R.renderer.info.memory.geometries;
    P.on = true;
  }, { god: !!opt.god });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  if (opt.profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  // Heap-Verlauf (Summe der Anstiege ≈ Allokationen zwischen Speicherbereinigungen)
  let heapPrev = null, heapUp = 0, heapMin = Infinity, heapMax = 0, gcDrops = 0;
  const tm = Date.now();
  let k = 0;
  while (Date.now() - tm < SECONDS * 1000) {
    await page.evaluate(({ i, combat }) => {
      const G = window.__game;
      const S = G.input && G.input.simulate;
      if (!S) return;
      S.look(25, i % 2 ? 2 : -2); // langsam umsehen
      if (!combat) return;
      // Kampfablauf je 4 s: Feuerstoß, Nachladen, Waffenwechsel hin und zurück (Handkontakt, Mündungsfeuer, Hülsen)
      const ph = i % 40;
      if (ph === 0) S.press('fire');
      if (ph === 6) S.release('fire');
      if (ph === 8) S.tap('reload');
      if (ph === 24) S.tap('swap');
      if (ph === 32) S.tap('swap');
    }, { i: k, combat: !!opt.combat });
    if (opt.effects && k % 8 === 3) {
      await page.evaluate(() => {
        const G = window.__game;
        const c = G.camera;
        if (!c || !G.effects) return;
        const p = c.position.clone().add(c.getWorldDirection(c.position.clone()).multiplyScalar(8));
        try { G.effects.explosion?.(p, { radius: 5 }); } catch (e) { /* API je Version */ }
      });
    }
    const h = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    if (heapPrev != null) { if (h >= heapPrev) heapUp += h - heapPrev; else gcDrops++; }
    heapPrev = h; heapMin = Math.min(heapMin, h); heapMax = Math.max(heapMax, h);
    k++;
    await sleep(100);
  }
  const elapsed = (Date.now() - tm) / 1000;
  let profile = null;
  if (opt.profile) profile = (await cdp.send('Profiler.stop')).profile;
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

  const res = await page.evaluate(() => {
    const soldierGeo = window.__perf.gear ? `${window.__perf.sgeo0}→${window.__perf.gear.soldierGeometryStats().count}` : null;
    const G = window.__game;
    const P = window.__perf;
    P.on = false;
    const R = G.renderer;
    const progs = (R.renderer.info.programs || []).filter((p) => !P.progSet0.has(p)).map((p) => p.name);
    return {
      frames: P.frames, long: P.long, compiles: P.compiles, compileMs: P.compileMs, newPrograms: progs,
      programs: (R.renderer.info.programs || []).length, info: R.info(), actors: G.actors.length, tex0: P.tex0, geo0: P.geo0,
      alive: G.actors.filter((a) => a.alive).length, perf: G.perf ? { ...G.perf.stats, wantTierDrop: G.perf.wantTierDrop, plateau: G.perf.plateau } : null,
      quality: R.quality, preset: { shadowInterval: R.preset.shadowInterval, particleScale: R.preset.particleScale, decals: R.preset.decals }, soldierGeo,
      relief: G.perf ? G.perf.relief : null,
    };
  });
  const fr = res.frames.filter((f) => f.cpu > 0);
  const cpus = fr.map((f) => f.cpu).sort((a, b) => a - b);
  const q = (p) => cpus.length ? Math.round(cpus[Math.min(cpus.length - 1, Math.floor(p * cpus.length))] * 10) / 10 : null;
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
  out.frames = { n: fr.length, fpsSwiftShader: Math.round((fr.length / elapsed) * 10) / 10, cpuAvg: avg(cpus), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) };
  const keys = new Set();
  for (const f of fr) for (const key of Object.keys(f.sys)) keys.add(key);
  const sys = {};
  for (const key of keys) {
    const v = fr.map((f) => f.sys[key] || 0);
    const sv = v.slice().sort((x, y) => x - y);
    sys[key] = { avg: avg(v), p50: Math.round(sv[sv.length >> 1] * 100) / 100, max: Math.round(Math.max(...v) * 10) / 10 };
  }
  const sum = Object.values(sys).reduce((a, s) => a + s.avg, 0);
  sys._summe = { avg: Math.round(sum * 100) / 100 };
  out.systems = Object.fromEntries(Object.entries(sys).sort((a, b) => b[1].avg - a[1].avg));
  const worst = fr.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 5);
  out.worstFrames = worst.map((f) => ({ cpu: Math.round(f.cpu), sys: Object.fromEntries(Object.entries(f.sys).filter(([, v]) => v > 2).map(([k2, v]) => [k2, Math.round(v)])) }));
  out.render = { drawCallsAvg: avg(fr.map((f) => f.calls || 0)), drawCallsMax: Math.max(...fr.map((f) => f.calls || 0)), trisAvgK: Math.round(avg(fr.map((f) => f.tris || 0)) / 100) / 10, quality: res.quality, preset: res.preset, info: { geometries: `${res.geo0}→${res.info.geometries}`, textures: `${res.tex0}→${res.info.textures}`, pixelRatio: res.info.pixelRatio, scale: res.info.resolutionScale } };
  out.programs = { total: res.programs, linkedDuringMeasure: res.compiles, statusWaitMs: Math.round(res.compileMs), newPrograms: res.newPrograms };
  out.longTasks = { n: res.long.length, totalMs: res.long.reduce((a, b) => a + b, 0), max: res.long.length ? Math.max(...res.long) : 0 };
  const MB = (b) => Math.round((b / 1048576) * 10) / 10;
  out.heap = { growthMBs: MB(heapUp / elapsed), drops: gcDrops, minMB: MB(heapMin), maxMB: MB(heapMax) };
  out.cdp = {
    scriptMsPerS: Math.round(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / elapsed),
    taskMsPerS: Math.round(((m1.TaskDuration - m0.TaskDuration) * 1000) / elapsed),
    layoutPerS: Math.round(((m1.LayoutCount - m0.LayoutCount) / elapsed) * 10) / 10,
    styleRecalcPerS: Math.round(((m1.RecalcStyleCount - m0.RecalcStyleCount) / elapsed) * 10) / 10,
  };
  out.match = { actors: res.actors, alive: res.alive, dynres: res.perf, relief: res.relief, soldierGeometries: res.soldierGeo };
  if (profile) {
    // Selbstzeit je Knoten aus Stichproben
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dts = profile.timeDeltas;
    for (let i = 0; i < profile.samples.length; i++) {
      const n = byId.get(profile.samples[i]);
      self.set(n.id, (self.get(n.id) || 0) + (dts[i] || 0));
    }
    const fn = new Map();
    const file = new Map();
    let total = 0;
    for (const [id, us] of self) {
      const cf = byId.get(id).callFrame;
      total += us;
      if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
      const f = (cf.url || '').replace(/^.*\/assets\/js\//, '').replace(/^.*\/vendor\//, 'vendor/');
      const key = `${cf.functionName || '(anonym)'} ${f}:${cf.lineNumber + 1}`;
      fn.set(key, (fn.get(key) || 0) + us);
      const fk = f || cf.functionName;
      file.set(fk, (file.get(fk) || 0) + us);
    }
    const ms = (us) => Math.round(us / 100) / 10;
    out.profile = {
      totalMs: ms(total),
      functions: [...fn].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k2, v]) => `${ms(v)} ms  ${k2}`),
      files: [...file].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k2, v]) => `${ms(v)} ms  ${k2}`),
    };
  }
} catch (err) {
  out.errors.push(`[ablauf] ${err.message}`);
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(out.errors.length ? 1 : 0);
