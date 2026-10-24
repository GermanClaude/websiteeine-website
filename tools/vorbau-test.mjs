// NULLPUNKT – Vorbau der Waffenmodelle ohne Ruckler (24.10., Vorarbeiten V1/V2/V5 vor dem Umbau aller Waffen auf Foto-Detailgrad):
//  V1  PC mit Grafikstufe „niedrig“: keine volle (max) Ego-Fassung, weder im Lobby-Vorbau noch im Ladebildschirm; Wechsel der
//      Grafikstufe in der Lobby (Vorlagen der alten Stufe frei, Vorbau neu) und im Match → Waffe in der Hand wird in der neuen
//      Stufe neu gebaut, Vorlagen der alten Stufe freigegeben.
//  V2  Bots bauen keine Ego-Fassungen (Aufsatz-Auswahl, Waffensteuerung, Optik-Montage lesen nur die Bot-Fassung).
//  V5  Aufheben einer teuren Waffe ohne fertige Ego-Fassung: sofort die Bot-Fassung (kein Bau im Bild), die Ego-Fassung entsteht
//      im Hintergrund und ersetzt sie (nicht mitten im Nachladen, Tarnung des Vorbesitzers bleibt); Vorrat im Ladebildschirm baut
//      die Waffen der Bots in der aktuellen Stufe.
// Aufruf: node tools/vorbau-test.mjs   (Server NP_BASE; ≈ 6 min im Container)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  // keine gespeicherten Aufsätze: eigene Waffen in Grundfassung
  await ctx.addInitScript(() => { try { localStorage.removeItem('nullpunkt.aufsaetze'); } catch { /* */ } });
  // ---- V1 Lobby: Grafikstufe hoch → Lobby-Vorbau in max; → niedrig: max-Vorlagen frei, Vorbau neu in std
  {
    const lp = await ctx.newPage();
    lp.on('pageerror', (e) => errors.push(e.message));
    lp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await lp.goto(`${BASE}spielen.html?quality=high`);
    const ego = () => lp.evaluate(async () => {
      const G = window.__game;
      if (!G || !G.match || G.match.state !== 'lobby' || !G.modules.models) return null;
      return G.modules.models.weaponTemplateStats().filter((x) => x.k.includes(':first')).map((x) => x.k);
    }).catch(() => null);
    let e1 = null;
    for (let i = 0; i < 240; i++) { e1 = await ego(); if (e1 && e1.includes('m17:first:max') && e1.includes('p9:first:max')) break; await sleep(1000); }
    check(e1 && e1.includes('m17:first:max'), `Lobby (hoch): Vorbau in max (${(e1 || []).join(', ')})`);
    await lp.evaluate(() => window.__game.debugApi.setQuality('low'));
    let e2 = null;
    for (let i = 0; i < 240; i++) { e2 = await ego(); if (e2 && e2.includes('m17:first') && e2.includes('p9:first')) break; await sleep(1000); }
    check(e2 && !e2.some((k) => k.includes(':max')) && e2.includes('m17:first') && e2.includes('p9:first'),
      `Lobby (hoch → niedrig): max frei, Vorbau neu in std (${(e2 || []).join(', ')})`);
    await lp.close();
  }

  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=2&enemies=3&quality=low`);
  let ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Match läuft (PC, Grafikstufe niedrig)');

  // ---- V1 + V2: welche Ego-Vorlagen gibt es nach dem Start?
  const s1 = await p.evaluate(async () => {
    const M = await import('/assets/js/game/weapons/models.js');
    const G = window.__game;
    const vm = G.player.weapon.viewModel;
    const ego = M.weaponTemplateStats().filter((x) => x.k.includes(':first'));
    const own = new Set(['knife', 'frag', 'semtex', 'impact', 'molotov', 'flash', 'smoke', 'plate', ...G.player.weapon.slots.map((x) => x.def.model)]);
    // Bot-Waffen (Vorrat): stehen als Einträge im Viewmodel, nicht als Ego-Vorlagen außerhalb davon
    const entryKeys = new Set([...vm._models.values()].map((e) => e.key));
    const strayEgo = ego.filter((x) => !own.has(x.k.split(':')[0]) && !entryKeys.has(x.k.split(':')[0]));
    return { slots: G.player.weapon.slots.map((x) => x.id), tier: M.weaponDetailTier(), quality: G.renderer.quality, max: ego.filter((x) => x.k.includes(':max')).map((x) => x.k), strayEgo: strayEgo.map((x) => x.k), entries: vm.buildState().entries, deferBuilds: !!vm.deferBuilds };
  });
  check(s1.quality === 'low' && s1.tier === 'std', `Detailstufe std bei Grafikstufe ${s1.quality} (${s1.tier})`);
  check(s1.max.length === 0, `keine max-Ego-Vorlage gebaut (${s1.max.join(', ') || '–'})`);
  check(s1.strayEgo.length === 0, `keine Ego-Vorlage außer eigener Ausrüstung und Vorrat (${s1.strayEgo.join(', ') || '–'})`);
  check(s1.deferBuilds, 'Hintergrund-Bau im Spiel eingeschaltet');
  const prefetched = s1.entries.filter((e) => !s1.slots.includes(e.mk));
  console.log(`     Vorrat im Ladebildschirm: ${prefetched.map((e) => `${e.mk}:${e.tier}`).join(', ') || '–'}`);
  check(prefetched.every((e) => e.tier === 'std' && !e.stub && e.collider), 'Vorrat in der aktuellen Stufe, mit Kontaktgitter');

  // ---- V5: teure Waffe ohne Ego-Fassung aufheben (M-17 mit Schalldämpfer + Laser – die Kombination trägt kein Bot)
  const s2 = await p.evaluate(async () => {
    const G = window.__game, w = G.player.weapon, vm = w.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const att = { muendung: 'daempfer', taktisch: 'laser' };
    const had = M.hasWeaponTemplate('m17', 'first', att);
    const t0 = performance.now();
    w.setLoadout({ primary: 'ar_m17', secondary: w.slots[1] ? w.slots[1].id : null, pickup: { id: 'ar_m17', att, camo: 'wald' }, keepPickups: true });
    const t1 = performance.now();
    // Wechsel läuft im Spiel (Wegstecken, dann _swapNow): Bilder abwarten, längstes messen
    let longest = 0;
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.mk === 'ar_m17#daempfer+laser'); i++) {
      const f0 = performance.now();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      longest = Math.max(longest, performance.now() - f0);
    }
    const st = vm.buildState();
    return { had, syncMs: Math.round(t1 - t0), longest: Math.round(longest), cur: vm.cur && vm.cur.mk, stub: st.stub, curTier: st.curTier, jobs: st.jobs, egoBuilt: M.hasWeaponTemplate('m17', 'first', att), camo: vm.cur && vm.cur.model.userData.camo };
  });
  console.log(`     Aufheben: setLoadout ${s2.syncMs} ms, längstes Bild bis zum Tausch ${s2.longest} ms (SwiftShader)`);
  check(!s2.had, 'M-17 mit Schalldämpfer war noch nicht gebaut');
  check(s2.cur === 'ar_m17#daempfer+laser' && s2.stub && s2.curTier === 'third', `sofort in der Hand: Bot-Fassung (${s2.cur}, ${s2.curTier})`);
  check(!s2.egoBuilt, 'Ego-Fassung nicht im Bild des Aufhebens gebaut');
  check(s2.jobs.some((j) => j.mk.startsWith('ar_m17#') && j.prio === 2), `dringender Hintergrund-Auftrag (${JSON.stringify(s2.jobs)})`);
  check(s2.camo === 'wald', `Bot-Fassung trägt die Tarnung des Vorbesitzers (${s2.camo})`);
  // Leerlauf (Pausenmenü/tot) bzw. Ruhe: Schritte bis zum Tausch – vorher mit der Bot-Fassung nachladen (Teile/Schacht fehlen ihr)
  const s3 = await p.evaluate(async () => {
    const G = window.__game, vm = G.player.weapon.viewModel;
    vm.playReload(true, 0);
    const reloading = !!(vm.action && vm.action.type === 'reload');
    const steps = [];
    let swappedDuringReload = false;
    for (let i = 0; i < 80; i++) {
      if (vm.action && vm.action.type === 'reload' && !vm.cur.stub) swappedDuringReload = true;
      const t = performance.now();
      const worked = vm.backgroundStep({ idle: true });
      if (worked) steps.push(Math.round(performance.now() - t));
      if (!worked && !vm.buildState().jobs.length) break;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // Spiel läuft weiter (Ziehen fertig → Tausch)
    }
    const st = vm.buildState();
    return { steps, stub: st.stub, curTier: st.curTier, jobs: st.jobs.length, collider: !!vm.cur.collider, att: vm.cur.att, reloading, swappedDuringReload, camo: vm.cur.model.userData.camo };
  });
  console.log(`     Hintergrund-Schritte (ms): ${s3.steps.join(', ')}`);
  check(s3.reloading, 'Nachladen mit der Bot-Fassung in der Hand läuft');
  check(!s3.swappedDuringReload, 'kein Tausch mitten im Nachladen');
  check(!s3.stub && s3.curTier === 'std' && s3.collider && s3.jobs === 0, `Ego-Fassung ersetzt die Bot-Fassung (${s3.curTier}, ${s3.att})`);
  check(s3.camo === 'wald', `Ego-Fassung mit derselben Tarnung (${s3.camo})`);

  // ---- V1: Grafikstufe im Match → hoch: Waffe in der Hand in max neu, Vorlagen der alten Stufe frei
  const s4 = await p.evaluate(async () => {
    const G = window.__game, vm = G.player.weapon.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    G.debugApi.setQuality('high');
    const first = vm.buildState();
    for (let i = 0; i < 60; i++) {
      const worked = vm.backgroundStep({ idle: true });
      if (!worked && !vm.buildState().jobs.length) break;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    vm.backgroundStep({ idle: true }); // Freigabe
    const st = vm.buildState();
    const ego = M.weaponTemplateStats().filter((x) => x.k.includes(':first'));
    return { tier: M.weaponDetailTier(), firstJobs: first.jobs.length, curTier: st.curTier, entries: st.entries, oldLeft: ego.filter((x) => !x.k.includes(':max')).map((x) => x.k), selfShadow: vm._selfShadow };
  });
  check(s4.tier === 'max' && s4.firstJobs > 0, `Stufenwechsel → Neubau eingereiht (${s4.firstJobs} Aufträge)`);
  check(s4.curTier === 'max' && s4.entries.every((e) => e.tier === 'max'), `Waffen in max (${s4.entries.map((e) => `${e.mk}:${e.tier}`).join(', ')})`);
  check(s4.selfShadow, 'Eigenschatten mit der vollen Stufe an');
  check(s4.oldLeft.length === 0, `Ego-Vorlagen der alten Stufe freigegeben (${s4.oldLeft.join(', ') || '–'})`);

  // ---- weiterspielen: Schießen mit der neuen Fassung, keine Fehler
  await p.evaluate(() => { const G = window.__game; G.debugApi.setQuality('low'); });
  await p.evaluate(async () => {
    const vm = window.__game.player.weapon.viewModel;
    for (let i = 0; i < 60; i++) { if (!vm.backgroundStep({ idle: true }) && !vm.buildState().jobs.length) break; await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }
  });
  await p.keyboard.down('KeyW'); await sleep(1500); await p.keyboard.up('KeyW');
  const s5 = await p.evaluate(() => { const vm = window.__game.player.weapon.viewModel; return vm.buildState(); });
  check(s5.curTier === 'std' && !s5.stub, `zurück auf niedrig → std (${s5.curTier})`);
} catch (err) {
  check(false, `Ablauf abgebrochen: ${err.message.split('\n')[0]}`);
} finally {
  await browser.close();
}
check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
console.log(`${count - fail}/${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
