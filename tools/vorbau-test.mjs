// NULLPUNKT – Vorbau der Waffenmodelle ohne Ruckler (24.10., Vorarbeiten V1/V2/V5 vor dem Umbau aller Waffen auf Foto-Detailgrad):
//  V1  PC mit Grafikstufe „niedrig“: keine volle (max) Ego-Fassung, weder im Lobby-Vorbau noch im Ladebildschirm; Wechsel der
//      Grafikstufe in der Lobby (Vorlagen der alten Stufe frei, Vorbau neu) und im Match → Waffe in der Hand wird in der neuen
//      Stufe neu gebaut, Vorlagen der alten Stufe freigegeben.
//  V2  Bots bauen keine Ego-Fassungen (Aufsatz-Auswahl, Waffensteuerung, Optik-Montage lesen nur die Bot-Fassung).
//  V5  Aufheben einer teuren Waffe ohne fertige Ego-Fassung: sofort ein Platzhalter (Ego-Grundfassung bzw. Bot-Fassung, kein Bau im
//      Bild), die Ego-Fassung entsteht im Leerlauf – nie in Ruhe mitten im Spiel – und ersetzt ihn (nicht mitten im Nachladen, Tarnung
//      des Vorbesitzers bleibt); Vorrat im Ladebildschirm baut die Waffen der Bots in der aktuellen Stufe. Nur-Werte-Aufsatz (Munition)
//      und Waffen alter Bauweise sofort vollständig; die Waffe in der Hand bleibt in der Hand (auch bei einem Wechsel mitten in einem
//      laufenden Auftrag); MG-Stellung ohne Platzhalter.
// Aufruf: node tools/vorbau-test.mjs   (Server NP_BASE; ≈ 8 min im Container)
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

  // Schritte im Leerlauf, bis nichts mehr ansteht (Spiel läuft weiter) – liefert Dauer je Schritt und ob die Waffe in der Hand blieb
  await p.evaluate(() => {
    // Einträge/Aufträge des Viewmodels vergessen (Prüfaufbau) – mit Abmeldung der Halter (Freigabe je Waffe, models.js), wie es das
    // Viewmodel beim Verwerfen selbst tut
    window.__forget = (match) => {
      const vm = window.__game.player.weapon.viewModel;
      for (const [mk, e] of [...vm._models]) if (match(mk)) { vm._dropEntry(e); vm._models.delete(mk); }
      for (const j of vm._bgJobs || []) if (match(j.mk)) vm._dropEntry(j.entry);
      vm._bgJobs = (vm._bgJobs || []).filter((j) => !match(j.mk));
    };
    window.__idleSteps = async (n = 80) => {
      const vm = window.__game.player.weapon.viewModel, steps = [];
      let lost = false;
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        const worked = vm.backgroundStep({ idle: true });
        if (worked) steps.push(Math.round(performance.now() - t));
        if (!(vm.cur && vm.cur.model.parent === vm.gun)) lost = true;
        if (!worked && !vm.buildState().jobs.length) break;
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      }
      return { steps, lost };
    };
  });

  // ---- V5: Nur-Werte-Aufsatz (Munition) teilt Vorlage und Kontaktgitter der eigenen M-17 → sofort vollständig, bleibt in der Hand
  const n1 = await p.evaluate(async () => {
    const G = window.__game, w = G.player.weapon, vm = w.viewModel;
    window.__forget((mk) => mk === 'ar_m17#hohlspitz'); // falls der Vorrat sie schon hatte: den Weg „Vorlage da, Eintrag fehlt“ prüfen
    w.setLoadout({ primary: 'ar_m17', secondary: w.slots[1] ? w.slots[1].id : null, pickup: { id: 'ar_m17', att: { munition: 'hohlspitz' } }, keepPickups: true });
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.mk === 'ar_m17#hohlspitz'); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const st = vm.buildState();
    const idle = await window.__idleSteps();
    return { cur: vm.cur && vm.cur.mk, stub: st.stub, collider: !!vm.cur.collider, inGun: st.inGun, jobs: st.jobs.filter((j) => j.mk === 'ar_m17#hohlspitz').length, lost: idle.lost, inGunAfter: vm.buildState().inGun, gunChildren: vm.gun.children.length };
  });
  check(n1.cur === 'ar_m17#hohlspitz' && !n1.stub && n1.collider && n1.jobs === 0, `Munition Hohlspitz: sofort Ego-Fassung mit geteiltem Kontaktgitter (${JSON.stringify(n1)})`);
  check(n1.inGun && !n1.lost && n1.inGunAfter && n1.gunChildren > 0, 'Waffe bleibt in der Hand (auch nach den Hintergrund-Schritten)');

  // ---- V5: Wechsel mitten in einem laufenden Vorrat-Auftrag (Vorlage + Kontaktgitter fertig) → Eintrag in die Hand, Rest im Leerlauf
  const n2 = await p.evaluate(async () => {
    const G = window.__game, w = G.player.weapon, vm = w.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const att = { muendung: 'kompensator' };
    M.releaseWeaponTemplate('p9', 'first', att);
    window.__forget((mk) => mk === 'pi_p9#kompensator');
    vm.prefetch([{ id: 'pi_p9', att }]);
    vm._prefetchTris = vm._prefetchN = 0; // Budget des Ladebildschirms hier nicht maßgeblich
    const job = vm._bgJobs.find((j) => j.mk === 'pi_p9#kompensator');
    vm._bgPump(job, true); vm._bgPump(job, true); // Vorlage, Kontaktgitter
    const stepAtSwap = job.step;
    w.setLoadout({ primary: 'pi_p9', secondary: null, pickup: { id: 'pi_p9', att }, keepPickups: true });
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.mk === 'pi_p9#kompensator'); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const same = vm.cur === job.entry;
    const idle = await window.__idleSteps();
    const st = vm.buildState();
    return { stepAtSwap, same, stub: st.stub, lost: idle.lost, inGun: st.inGun, gunChildren: vm.gun.children.length, jobs: st.jobs.length };
  });
  check(n2.stepAtSwap === 2 && n2.same && !n2.stub, `Wechsel bei laufendem Auftrag (Schritt ${n2.stepAtSwap}): Eintrag des Auftrags in der Hand`);
  check(!n2.lost && n2.inGun && n2.gunChildren > 0 && n2.jobs === 0, `… Shader-Schritt hängt ihn nicht aus der Hand (${JSON.stringify(n2)})`);

  // ---- V5: teure Waffe ohne Ego-Fassung aufheben (M-17 mit Schalldämpfer + Laser – die Kombination trägt kein Bot)
  const s2 = await p.evaluate(async () => {
    const G = window.__game, w = G.player.weapon, vm = w.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const att = { muendung: 'daempfer', taktisch: 'laser' };
    const had = M.hasWeaponModel('m17', { att });
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
    const out = { had, syncMs: Math.round(t1 - t0), longest: Math.round(longest), cur: vm.cur && vm.cur.mk, stub: st.stub, curLod: st.curLod, curTier: st.curTier, jobs: st.jobs, egoBuilt: M.hasWeaponModel('m17', { att }), camo: vm.cur && vm.cur.model.userData.camo, inGun: st.inGun };
    // lange Ruhe mitten im Spiel (gezogen, kein Schuss, kein Treffer): der Vorlagenbau (Sekunden am Stück) darf trotzdem nicht laufen
    for (let i = 0; i < 60 && vm._equipT < 1; i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    vm._restT = vm._time - 30;
    out.calm = vm._quietNow();
    let quietWorked = 0, quietLongest = 0;
    for (let i = 0; i < 6; i++) {
      const t = performance.now();
      if (vm.backgroundStep({ idle: false, quiet: true })) quietWorked++;
      quietLongest = Math.max(quietLongest, performance.now() - t);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    out.quiet = { worked: quietWorked, longest: Math.round(quietLongest), egoBuilt: M.hasWeaponModel('m17', { att }), stub: vm.buildState().stub };
    return out;
  });
  console.log(`     Aufheben: setLoadout ${s2.syncMs} ms, längstes Bild bis zum Tausch ${s2.longest} ms (SwiftShader)`);
  check(!s2.had, 'M-17 mit Schalldämpfer war noch nicht gebaut');
  check(s2.cur === 'ar_m17#daempfer+laser' && s2.stub && s2.curLod === 'first' && s2.inGun, `sofort in der Hand: Platzhalter = Ego-Grundfassung der M-17 (${s2.cur}, ${s2.curLod}/${s2.curTier})`);
  check(!s2.egoBuilt, 'Ego-Fassung nicht im Bild des Aufhebens gebaut');
  check(s2.jobs.some((j) => j.mk.startsWith('ar_m17#') && j.prio === 2), `dringender Hintergrund-Auftrag (${JSON.stringify(s2.jobs)})`);
  check(s2.camo === 'wald', `Platzhalter trägt die Tarnung des Vorbesitzers (${s2.camo})`);
  check(s2.calm && !s2.quiet.egoBuilt && s2.quiet.stub && s2.quiet.longest < 300, `in Ruhe mitten im Spiel kein Vorlagenbau (${JSON.stringify(s2.quiet)})`);
  // Leerlauf (Pausenmenü/tot) bzw. Ruhe: Schritte bis zum Tausch – vorher mit der Bot-Fassung nachladen (Teile/Schacht fehlen ihr)
  const s3 = await p.evaluate(async () => {
    const G = window.__game, vm = G.player.weapon.viewModel;
    vm.playReload(true, 0);
    const reloading = !!(vm.action && vm.action.type === 'reload');
    let lost = false;
    const steps = [];
    let swappedDuringReload = false;
    for (let i = 0; i < 80; i++) {
      if (vm.action && vm.action.type === 'reload' && !vm.cur.stub) swappedDuringReload = true;
      if (vm.cur.model.parent !== vm.gun) lost = true;
      const t = performance.now();
      const worked = vm.backgroundStep({ idle: true });
      if (worked) steps.push(Math.round(performance.now() - t));
      if (!worked && !vm.buildState().jobs.length) break;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // Spiel läuft weiter (Ziehen fertig → Tausch)
    }
    const st = vm.buildState();
    return { steps, stub: st.stub, curTier: st.curTier, jobs: st.jobs.length, collider: !!vm.cur.collider, att: vm.cur.att, reloading, swappedDuringReload, camo: vm.cur.model.userData.camo, lost, inGun: st.inGun };
  });
  console.log(`     Hintergrund-Schritte im Leerlauf (ms): ${s3.steps.join(', ')}`);
  check(s3.reloading, 'Nachladen mit dem Platzhalter in der Hand läuft');
  check(!s3.swappedDuringReload, 'kein Tausch mitten im Nachladen');
  check(!s3.stub && s3.curTier === 'std' && s3.collider && s3.jobs === 0 && s3.inGun && !s3.lost, `Ego-Fassung ersetzt den Platzhalter (${s3.curTier}, ${s3.att})`);
  check(s3.camo === 'wald', `Ego-Fassung mit derselben Tarnung (${s3.camo})`);

  // ---- V5: Foto-Waffe ohne Ego-Grundfassung → Bot-Fassung; abgelegt, bevor der Bau begann → Auftrag verworfen
  const b1 = await p.evaluate(async () => {
    const G = window.__game, w = G.player.weapon, vm = w.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const att = { muendung: 'daempfer' };
    for (const a of [null, att]) M.releaseWeaponTemplate('p9', 'first', a);
    window.__forget((mk) => mk.startsWith('pi_p9'));
    const keep = { primary: 'ar_m17', secondary: null };
    w.setLoadout({ primary: 'pi_p9', secondary: null, pickup: { id: 'pi_p9', att }, keepPickups: true });
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.mk === 'pi_p9#daempfer'); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const st = vm.buildState();
    const out = { cur: vm.cur && vm.cur.mk, stub: st.stub, curLod: st.curLod, inGun: st.inGun, job: st.jobs.some((j) => j.mk === 'pi_p9#daempfer') };
    // wieder ablegen (andere Waffe), dann Leerlauf: der Auftrag für die P-9 entfällt, nichts wird gebaut
    w.setLoadout(keep);
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.mk === 'ar_m17'); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    await window.__idleSteps();
    out.after = { job: vm.buildState().jobs.some((j) => j.mk === 'pi_p9#daempfer'), built: M.hasWeaponModel('p9', { att }), entry: vm._models.has('pi_p9#daempfer') };
    return out;
  });
  check(b1.cur === 'pi_p9#daempfer' && b1.stub && b1.curLod === 'third' && b1.inGun && b1.job, `P-9 ohne Ego-Vorlage: Bot-Fassung als Platzhalter (${b1.curLod})`);
  check(!b1.after.job && !b1.after.built && !b1.after.entry, `abgelegt vor dem Bau → Auftrag verworfen, nichts gebaut (${JSON.stringify(b1.after)})`);

  // ---- V5: Waffe alter Bauweise ohne Messung (Kosten unbekannt) und MG-Stellung → sofort Ego-Fassung wie bisher, kein Platzhalter
  const c1 = await p.evaluate(async () => {
    const G = window.__game, P = G.player, w = P.weapon, vm = w.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const W = G.data.WEAPONS;
    // 25.10.: ohne ar_kv47 – die KV-47 ist jetzt Foto-Waffe (PHOTO_MODELS, Platzhalter-Fall wie die P-9 oben)
    const ids = ['smg_vp9', 'smg_qx90', 'mr_sk14', 'sg_bulldog', 'pi_adler'].filter((id) => W[id] && !M.isPhotoWeapon(W[id].model || id));
    const id = ids.find((x) => M.weaponBuildCost(W[x].model || x) === null && !vm._models.has(x)) || ids[0];
    const unknown = M.weaponBuildCost(W[id].model || id) === null;
    w.setLoadout({ primary: id, secondary: null, pickup: { id }, keepPickups: true });
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.id === id); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const st = vm.buildState();
    const out = { id, unknown, stub: st.stub, curTier: st.curTier, collider: !!vm.cur.collider, inGun: st.inGun, kvPhoto: M.isPhotoWeapon('kv47') };
    // MG-Stellung (künstlich am Spieler, wie mappoints.js): HM-60 sofort als Ego-Fassung
    const e = { x: P.position.x, y: P.position.y, z: P.position.z, dx: 0, dz: -1, arc: 1.2 };
    out.mounted = G.points.mount(e);
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.id === 'lmg_hm60'); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const s2 = vm.buildState();
    out.mg = { cur: vm.cur && vm.cur.mk, stub: s2.stub, curTier: s2.curTier, inGun: s2.inGun };
    G.points.unmount();
    w.setLoadout({ primary: 'ar_m17', secondary: null });
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.mk === 'ar_m17'); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return out;
  });
  check(!c1.stub && c1.curTier === 'std' && c1.collider && c1.inGun, `alte Bauweise (${c1.id}, Kosten ${c1.unknown ? 'unbekannt' : 'gemessen'}) sofort als Ego-Fassung`);
  check(c1.kvPhoto, 'KV-47 ist Foto-Waffe (Platzhalter-Fall, nicht alte Bauweise)');
  check(c1.mounted && c1.mg.cur && c1.mg.cur.startsWith('lmg_hm60') && !c1.mg.stub && c1.mg.curTier === 'std', `MG-Stellung: HM-60 sofort als Ego-Fassung (${JSON.stringify(c1.mg)})`);

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
    return { tier: M.weaponDetailTier(), firstJobs: first.jobs.length, curTier: st.curTier, entries: st.entries, oldLeft: ego.filter((x) => !x.k.includes(':max')).map((x) => x.k), selfShadow: vm._selfShadow, inGun: st.inGun };
  });
  check(s4.tier === 'max' && s4.firstJobs > 0, `Stufenwechsel → Neubau eingereiht (${s4.firstJobs} Aufträge)`);
  check(s4.curTier === 'max' && s4.inGun && s4.entries.every((e) => e.tier === 'max'), `Waffen in max (${s4.entries.map((e) => `${e.mk}:${e.tier}`).join(', ')})`);
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
