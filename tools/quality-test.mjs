// NULLPUNKT — Prüfung „Grafikqualität: Automatisch“ (engine/device.js, engine/dynres.js, main.js applyAutoTier), 21.10.
//
// 1. Klassifizierung bekannter GPU-Namen und Schätzung aus dem GPU-Test (reine Logik im Browser).
// 2. Erster Start ohne quality-Parameter: SwiftShader = „software“ → Stufe low, Profil 'nullpunkt:geraet' gespeichert,
//    Hinweis auf fehlende GPU-Beschleunigung beim Matchbeginn.
// 3. Entlastung mitten im Match: Stufe künstlich auf „medium“ (wie ein zu optimistisch gewähltes Gerät), dynamische
//    Auflösung + Entlastungsstufen regeln (SwiftShader ist langsam genug), wantTierDrop → Revanche startet auf „low“,
//    gelernte Stufe gemerkt, Hinweis „gesenkt“; Entlastung zum neuen Match auf 0.
// 4. Kein neues Shader-Programm durch die Entlastung (Pässe/Schattentakt ohne Neukompilieren).
// 5. Wechsel von fester Stufe auf „Automatisch“ in laufender Sitzung (GPU-Name vorgetäuscht: Intel HD 4000): GPU-Klasse
//    und nachgeholter GPU-Test gelten sofort (→ low), nicht nur die Gerätewerte.
// 6. Ein schlechter GPU-Test ist keine Obergrenze (RTX 3060 vorgetäuscht, gespeicherter Test 60 ms/MPx): Start low,
//    Obergrenze high; nach einem Match mit Reserve → medium, gelernt; nach dem Neuladen gleich medium.
// 7. Feste Auflösungsskala (75 %): Entlastung und Messung laufen trotzdem, die Skala bleibt fest.
//
// Aufruf: NP_BASE=http://localhost:8765/ node tools/quality-test.mjs [--seconds=70] [--nur=5,6,7]
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const SECONDS = Number(opt.seconds || 70);
const ONLY = opt.nur ? new Set(String(opt.nur).split(',').map(Number)) : null; // nur diese Teile (5–7; 1–4 gehören zusammen)
const want = (n) => !ONLY || ONLY.has(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { ok: true, checks: {}, errors: [] };
const pass = (k, v = 'ok') => { out.checks[k] = v; };
const fail = (k, v) => { out.ok = false; out.checks[k] = `FEHLER: ${v}`; };

const browser = await chromium.launch({ args: GL_ARGS });
const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => out.errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text()); });
const waitFor = async (fn, ms, label) => {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await page.evaluate(fn); } catch { /* lädt */ }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`Zeitüberschreitung: ${label}`);
    await sleep(300);
  }
};

if (want(1)) try {
  await page.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=1&enemies=2&time=600`, { waitUntil: 'load' });
  await waitFor(() => window.__game && window.__game.renderer && window.__game.renderer.auto, 120000, 'Renderer');

  // 1. Logik
  const logic = await page.evaluate(async () => {
    const D = await import(new URL('assets/js/game/engine/device.js', location.href).href);
    const c = (n, touch = false, short = 400) => D.classifyGpu(n, { touch, short }).cap;
    return {
      uhd: c('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'),
      iris: c('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'),
      rtx: c('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'),
      mx: c('ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)'),
      apu: c('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'),
      soft: c('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'),
      adreno650: c('Adreno (TM) 650', true), adreno610: c('Adreno (TM) 610', true), adreno702: c('Adreno (TM) 702', true), mali57: c('Mali-G57 MC2', true),
      iphone: c('Apple GPU', true, 390), ipad: c('Apple GPU', true, 820), unknown: c('WebKit WebGL'),
      // Firefox: Stellvertreter-Namen („…, or similar“, dom/canvas/SanitizeRenderer.cpp)
      ffRadeon: c('ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar'),
      ffIntel: c('ANGLE (Intel, Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0), or similar'),
      ffGeforce: c('ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar'),
      ffAdreno: c('Adreno (TM) 650, or similar', true),
      bench: [0.2, 1, 4].map((m) => D.benchTier(m, { touch: false, dpr: 1 }, { width: 1920, height: 1080 })),
    };
  });
  const caps = {
    uhd: 'low', iris: 'medium', rtx: 'high', mx: 'medium', apu: 'medium', soft: 'low', adreno650: 'medium', adreno610: 'low', adreno702: 'low', mali57: 'low',
    iphone: 'low', ipad: 'medium', unknown: null, ffRadeon: null, ffIntel: 'medium', ffGeforce: 'high', ffAdreno: null,
  };
  const bad = Object.entries(caps).filter(([k, v]) => logic[k] !== v).map(([k, v]) => `${k}: ${logic[k]} statt ${v}`);
  if (bad.length) fail('klassen', bad.join(', ')); else pass('klassen', Object.keys(caps).length + ' Fälle');
  if (logic.bench.join(',') === 'high,medium,low') pass('gpuTest', logic.bench.join(',')); else fail('gpuTest', logic.bench.join(','));

  // 2. Erster Start
  const first = await page.evaluate(() => {
    const G = window.__game;
    let prof = null;
    try { prof = JSON.parse(localStorage.getItem('nullpunkt:geraet')); } catch { /* ignore */ }
    return { auto: G.renderer.auto, quality: G.renderer.quality, gpu: G.renderer.gpu, prof };
  });
  if (first.gpu && first.gpu.cls === 'software' && first.quality === 'low') pass('ersterStart', `${first.quality} (${first.auto.reason})`);
  else fail('ersterStart', JSON.stringify(first));
  if (first.prof && first.prof.tier === 'low' && first.prof.gpu) pass('profilGemerkt'); else fail('profilGemerkt', JSON.stringify(first.prof));

  await waitFor(() => window.__game.match.state === 'playing', 300000, 'Match läuft');
  const notice = await waitFor(() => { const t = [...document.querySelectorAll('.h-notices')].map((e) => e.textContent).join(' '); return /GPU-Beschleunigung/.test(t) ? 'ja' : null; }, 15000, 'Hinweis GPU-Beschleunigung').catch(() => null);
  if (notice) pass('hinweisSoftware'); else fail('hinweisSoftware', 'kein Hinweis im HUD');

  // 3. Entlastung: Stufe auf medium (wie eine zu hohe Erstwahl), dann regeln lassen
  await page.evaluate(() => {
    const G = window.__game;
    G.player.godMode = true;
    G.renderer.setQuality('medium');
    // wie warmUp beim Matchstart: Welt, Viewmodel (auch Teile außer Sicht, z. B. die Uhr) und Pässe samt EASU-Variante
    const r = G.renderer.renderer;
    r.compile(G.scene, G.camera);
    r.compile(G.viewmodel.scene, G.viewmodel.camera);
    G.renderer.compilePost();
    G.perf.reset();
  });
  await sleep(8000); // Programme der neuen Stufe entstehen in den ersten Bildern
  // 4. Entlastung 3 direkt: keine neuen Programme (Pässe/Schattentakt/Partikel/Bots nur ausgelassen bzw. seltener)
  const forced = await page.evaluate(async () => {
    const G = window.__game, r = G.renderer.renderer;
    const p0 = r.info.programs.length;
    const set0 = new Set(r.info.programs);
    G.perf.relief = 3;
    G.perf.reliefGpu = true; // wie bei GPU-Engpass: auch Bloom und Kantenglättung aus
    await new Promise((res) => setTimeout(res, 6000));
    const mid = { progs: r.info.programs.length, neu: r.info.programs.filter((p) => !set0.has(p)).map((p) => p.name), shadowEvery: G.renderer.shadowEvery, pipeRelief: G.renderer.pipeline.relief, postRelief: G.renderer.pipeline.postRelief, fx: G.effects.scale };
    G.perf.reset();
    G.renderer.relief = G.renderer.postRelief = 0;
    return { p0, ...mid };
  });
  if (forced.progs <= forced.p0 && forced.pipeRelief === 3 && forced.postRelief === 3 && forced.shadowEvery >= 4) pass('ohneNeukompilieren', `${forced.p0} → ${forced.progs} Programme, Schatten jedes ${forced.shadowEvery}. Bild, Partikel ×${Math.round(forced.fx * 100) / 100}`);
  else fail('ohneNeukompilieren', JSON.stringify(forced));
  const t0 = Date.now();
  let st = null;
  const seen = new Set();
  while (Date.now() - t0 < SECONDS * 1000) {
    st = await page.evaluate(() => {
      const G = window.__game, P = G.perf, R = G.renderer;
      return { relief: P.relief, scale: R.resolutionScale, want: P.wantTierDrop, fps: P.stats.fps, load: P.stats.load, rRelief: R.relief, shadowEvery: R.shadowEvery, progs: R.renderer.info.programs.length };
    });
    seen.add(st.relief);
    if (st.relief >= 2 && st.want) break;
    await sleep(1000);
  }
  out.relief = st;
  if (st.relief >= 1 && st.rRelief === st.relief) pass('entlastung', `Stufe ${st.relief}, Skala ${st.scale}, Schatten jedes ${st.shadowEvery}. Bild, ${st.fps} FPS`);
  else fail('entlastung', JSON.stringify(st));
  if (st.want) pass('stufeVormerken'); else fail('stufeVormerken', JSON.stringify(st));

  // Revanche: Stufe sinkt auf low, gelernt gemerkt, Hinweis
  await page.evaluate(() => window.__game.debugApi.endMatch());
  await waitFor(() => window.__game.match.state === 'ended', 30000, 'Matchende');
  await sleep(1500);
  await page.evaluate(() => window.__game.menus.onRestart());
  await waitFor(() => window.__game.match.state === 'playing', 300000, 'Revanche');
  const after = await page.evaluate(() => {
    const G = window.__game;
    let prof = null;
    try { prof = JSON.parse(localStorage.getItem('nullpunkt:geraet')); } catch { /* ignore */ }
    return { quality: G.renderer.quality, relief: G.perf.relief, rRelief: G.renderer.relief, learned: prof && prof.learned, text: [...document.querySelectorAll('.h-notices')].map((e) => e.textContent).join(' ') };
  });
  if (after.quality === 'low') pass('revancheNiedrig'); else fail('revancheNiedrig', after.quality);
  if (after.learned === 'low') pass('gelerntGemerkt'); else fail('gelerntGemerkt', String(after.learned));
  if (after.relief === 0 && after.rRelief === 0) pass('entlastungZurueck'); else fail('entlastungZurueck', `${after.relief}/${after.rRelief}`);
  if (/gesenkt/.test(after.text)) pass('hinweisGesenkt'); else out.checks.hinweisGesenkt = 'nicht mehr sichtbar (Hinweis bereits ausgeblendet?)';
} catch (err) {
  fail('ablauf', err.message);
}

/* ---- 5–7: eigene Kontexte (frischer localStorage), kleine Karte ---- */
const RANGE = `${BASE}spielen.html?autostart=1&mode=tdm&map=range&allies=1&enemies=1&time=600`;
/** Neuer Kontext mit vorgetäuschtem GPU-Namen und vorbelegtem localStorage (nur beim ersten Laden). */
async function fresh(gpu, storage) {
  const c = await browser.newContext({ viewport: { width: 320, height: 180 } });
  await c.addInitScript(([name, st]) => {
    if (name) {
      for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
        if (!C) continue;
        const orig = C.prototype.getParameter;
        C.prototype.getParameter = function getParameter(p) { return p === 37446 ? name : orig.call(this, p); }; // UNMASKED_RENDERER_WEBGL
      }
    }
    try { if (!sessionStorage.getItem('qt-init')) { sessionStorage.setItem('qt-init', '1'); for (const [k, v] of Object.entries(st || {})) localStorage.setItem(k, JSON.stringify(v)); } } catch { /* ohne Speicher */ }
  }, [gpu, storage]);
  const p = await c.newPage();
  p.on('pageerror', (e) => out.errors.push(`[pageerror] ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text()); });
  return { c, p };
}
const waitIn = async (p, fn, ms, label) => {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await p.evaluate(fn); } catch { /* lädt */ }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`Zeitüberschreitung: ${label}`);
    await sleep(300);
  }
};
const DEV = 'assets/js/game/engine/device.js';

if (want(5)) {
  const INTEL = 'ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const { c, p } = await fresh(INTEL, { 'nullpunkt:settings': { quality: 'high' } });
  try {
    await p.goto(RANGE, { waitUntil: 'load' });
    await waitIn(p, () => window.__game && window.__game.renderer && window.__game.match.state === 'playing', 300000, 'Match (feste Stufe)');
    const r = await p.evaluate(async (dev) => {
      const D = await import(new URL(dev, location.href).href);
      const S = (await import(new URL('assets/js/shared/settings.js', location.href).href)).settings;
      const G = window.__game, R = G.renderer;
      const before = { quality: R.quality, decision: D.autoDecision() && { tier: D.autoDecision().tier, pending: D.autoDecision().pending, cls: D.autoDecision().cls } };
      S.set('quality', 'auto');
      await new Promise((res) => setTimeout(res, 500));
      let prof = null;
      try { prof = JSON.parse(localStorage.getItem('nullpunkt:geraet')); } catch { /* ignore */ }
      return { before, after: { quality: R.quality, auto: R.auto && { tier: R.auto.tier, reason: R.auto.reason, pending: R.auto.pending }, bench: prof && prof.bench } };
    }, DEV);
    out.wechselAuto = r;
    if (r.before.quality === 'high' && r.before.decision && r.before.decision.pending && r.after.quality === 'low' && r.after.auto && !r.after.auto.pending && r.after.bench && r.after.bench.msPerMpix > 0) {
      pass('wechselAufAutomatisch', `high → ${r.after.quality} (${r.after.auto.reason}), Test nachgeholt ${r.after.bench.msPerMpix} ms/MPx`);
    } else fail('wechselAufAutomatisch', JSON.stringify(r));
  } catch (err) { fail('wechselAufAutomatisch', err.message); }
  await c.close();
}

if (want(6)) {
  const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const { c, p } = await fresh(RTX, { 'nullpunkt:geraet': { v: 1, gpu: RTX, bench: { msPerMpix: 60, at: Date.now() }, learned: null } }); // 60 ms/MPx: bei 320×180 → low
  try {
    await p.goto(RANGE, { waitUntil: 'load' });
    await waitIn(p, () => window.__game && window.__game.renderer && window.__game.match.state === 'playing', 300000, 'Match 1');
    const a = await p.evaluate(() => { const R = window.__game.renderer; return { quality: R.quality, ceiling: R.auto && R.auto.ceiling, reason: R.auto && R.auto.reason }; });
    if (a.quality === 'low' && a.ceiling === 'high') pass('testKeineObergrenze', `Start ${a.quality} (${a.reason}), Obergrenze ${a.ceiling}`);
    else fail('testKeineObergrenze', JSON.stringify(a));
    // Match mit Reserve (SwiftShader schafft das nicht – Ergebnis des Reglers vorgeben)
    await p.evaluate(() => { const G = window.__game; G.perf.stepUpOk = () => true; G.debugApi.endMatch(); });
    await waitIn(p, () => window.__game.match.state === 'ended', 30000, 'Matchende');
    await sleep(1500);
    await p.evaluate(() => window.__game.menus.onRestart());
    await waitIn(p, () => window.__game.match.state === 'playing', 300000, 'Revanche');
    const b = await p.evaluate(() => {
      let prof = null;
      try { prof = JSON.parse(localStorage.getItem('nullpunkt:geraet')); } catch { /* ignore */ }
      return { quality: window.__game.renderer.quality, learned: prof && prof.learned };
    });
    if (b.quality === 'medium' && b.learned === 'medium') pass('hochstufenTrotzTest', `Revanche ${b.quality}, gelernt ${b.learned}`);
    else fail('hochstufenTrotzTest', JSON.stringify(b));
    await p.reload({ waitUntil: 'load' });
    await waitIn(p, () => window.__game && window.__game.renderer && window.__game.renderer.auto, 120000, 'Renderer nach Neuladen');
    const d = await p.evaluate(() => { const R = window.__game.renderer; return { quality: R.quality, reason: R.auto.reason }; });
    if (d.quality === 'medium' && /gelernt/.test(d.reason)) pass('neuladenGelernt', `${d.quality} (${d.reason})`);
    else fail('neuladenGelernt', JSON.stringify(d));
  } catch (err) { fail('hochstufenTrotzTest', err.message); }
  await c.close();
}

if (want(7)) {
  const { c, p } = await fresh(null, { 'nullpunkt:settings': { quality: 'auto', renderScale: '75' } });
  try {
    await p.goto(`${RANGE.replace('enemies=1', 'enemies=4')}`, { waitUntil: 'load' });
    await waitIn(p, () => window.__game && window.__game.match.state === 'playing', 300000, 'Match (feste Skala)');
    await p.evaluate(() => { window.__game.player.godMode = true; });
    const t0 = Date.now();
    let st = null;
    while (Date.now() - t0 < 60000) {
      st = await p.evaluate(() => { const G = window.__game; return { fps: G.perf.stats.fps, relief: G.perf.relief, scale: G.renderer.resolutionScale, rRelief: G.renderer.relief }; });
      if (st.relief >= 1) break;
      await sleep(1000);
    }
    out.festeSkala = st;
    if (st.fps > 0 && st.relief >= 1 && Math.abs(st.scale - 0.75) < 1e-3 && st.rRelief === st.relief) pass('festeSkalaEntlastung', `Skala ${st.scale}, Entlastung ${st.relief}, ${st.fps} FPS`);
    else fail('festeSkalaEntlastung', JSON.stringify(st));
  } catch (err) { fail('festeSkalaEntlastung', err.message); }
  await c.close();
}

if (out.errors.length) fail('konsole', out.errors.slice(0, 5).join(' | '));
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(out.ok ? 0 : 1);
