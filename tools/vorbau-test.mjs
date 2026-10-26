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
//  26.10. (Vorab Etappe 2) Waffenspiel: Ladebildschirm nur aktuelle + nächste Stufen (nicht die Lobby-Ausrüstung), Rest als
//      Plan-Aufträge; Aufstieg im Fenster echt, sonst Platzhalter ohne Bau im Bild; Bau im Todesbildschirm angerechnet. Schießstand
//      PC hoch: nur die Ausrüstung voll, übrige Waffen leicht im Leerlauf (Pausenmenü), in der Waffenkammer gewählte Waffe noch im
//      Pausenmenü voll gebaut (kein Bau beim Weiterspielen, kein Platzhalter).
//  Prüfung 26.10.: Waffenspiel-Ladebildschirm zusätzlich alle Waffen alter Bauweise der Leiter, Plan nur Foto-Waffen; im
//      Pausenmenü während der Bedienung keine schweren Schritte; mit eingeschaltetem VR-Modus ganze Leiter im Ladebildschirm.
//      Nachprüfung: Waffenkammer durchgeklickt → kein Bau während der Bedienung, nur die zuletzt gewählte Waffe wird gebaut.
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

  // ---- V5: Wechsel mitten in einem laufenden Vorrat-Auftrag (Vorlage fertig; 26.10.: danach Shader, Griffe, zuletzt das Kontaktgitter)
  //      → Eintrag in die Hand, Rest im Leerlauf – der Shader-Schritt läuft mit der Waffe in der Hand
  const n2 = await p.evaluate(async () => {
    const G = window.__game, w = G.player.weapon, vm = w.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const att = { muendung: 'kompensator' };
    M.releaseWeaponTemplate('p9', 'first', att);
    window.__forget((mk) => mk === 'pi_p9#kompensator');
    vm.prefetch([{ id: 'pi_p9', att }]);
    vm._prefetchTris = vm._prefetchN = 0; // Budget des Ladebildschirms hier nicht maßgeblich
    const job = vm._bgJobs.find((j) => j.mk === 'pi_p9#kompensator');
    vm._bgPump(job, true); // Vorlage
    const stepAtSwap = job.step;
    w.setLoadout({ primary: 'pi_p9', secondary: null, pickup: { id: 'pi_p9', att }, keepPickups: true });
    for (let i = 0; i < 60 && !(vm.cur && vm.cur.mk === 'pi_p9#kompensator'); i++) await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const same = vm.cur === job.entry;
    const idle = await window.__idleSteps();
    const st = vm.buildState();
    return { stepAtSwap, same, stub: st.stub, lost: idle.lost, inGun: st.inGun, gunChildren: vm.gun.children.length, jobs: st.jobs.length };
  });
  check(n2.stepAtSwap === 1 && n2.same && !n2.stub, `Wechsel bei laufendem Auftrag (Schritt ${n2.stepAtSwap}): Eintrag des Auftrags in der Hand`);
  check(!n2.lost && n2.inGun && n2.gunChildren > 0 && n2.jobs === 0, `… Shader-Schritt hängt ihn nicht aus der Hand (${JSON.stringify(n2)})`);

  // ---- V5: teure Waffe ohne Ego-Fassung aufheben (M-17 mit Schalldämpfer + Laser – die Kombination trägt kein Bot)
  const s2 = await p.evaluate(async () => {
    const G = window.__game, w = G.player.weapon, vm = w.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const att = { muendung: 'daempfer', taktisch: 'laser' };
    // (26.10.: Bots tragen zufällige Aufsätze – hatte der Vorrat genau diese Kombination schon gebaut, z. B. mit Hohlspitz, die
    // Vorlage samt Einträgen vergessen, sonst prüfte der Fall nichts)
    window.__forget((mk) => mk.startsWith('ar_m17#daempfer+laser'));
    M.releaseWeaponTemplate('m17', 'first', att);
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
  await p.close();

  // ---- 26.10. (Vorab Etappe 2) Waffenspiel: Ladebildschirm baut nur die aktuelle + die nächsten LADDER_AHEAD Stufen (nicht die
  //      Lobby-Ausrüstung), den Rest Plan-Aufträge im Leerlauf; Aufstieg ohne Bau im Bild (echte Fassung bzw. Platzhalter);
  //      Bauzeit im Todesbildschirm wird angerechnet (Wiedereinstieg nicht später)
  const g = await ctx.newPage();
  g.on('pageerror', (e) => errors.push(e.message));
  g.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await g.goto(`${BASE}spielen.html?autostart=1&mode=gun&map=range&quality=low&allies=0&enemies=3&primary=ar_k36&secondary=pi_kobra`);
  ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await g.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Waffenspiel läuft (PC, niedrig, Lobby-Ausrüstung K-36 + Kobra)');
  const g1 = await g.evaluate(async () => {
    const G = window.__game, P = G.player, vm = P.weapon.viewModel, W = G.data.WEAPONS;
    const M = await import('/assets/js/game/weapons/models.js');
    const VM = await import('/assets/js/game/weapons/viewmodel.js');
    for (const bt of G.bots.bots) bt.update = () => {}; // Bots stehen still
    const steps = G.mode.steps, win = VM.ladderWindow(steps, 0).map((id) => W[id].model);
    const ego = M.weaponTemplateStats().filter((x) => x.k.includes(':first')).map((x) => x.k.split(':')[0]);
    const st = vm.buildState();
    // Prüfung 26.10.: Foto-Waffen vor den Waffen alter Bauweise (die baut der Aufstieg in Millisekunden)
    const photo = st.jobs.filter((j) => j.plan).map((j) => M.isPhotoWeapon(W[j.mk.split('#')[0]].model));
    // übrige Leiter: Foto-Waffen gebaut (Countdown) oder als Plan-Auftrag offen; Waffen alter Bauweise schon im Ladebildschirm
    const planned = st.jobs.filter((j) => j.plan).map((j) => W[j.mk.split('#')[0]].model);
    const ladder = [...new Set(steps.filter((id) => W[id].cls !== 'melee').map((id) => W[id].model))];
    return { win, ego, plan: st.jobs.filter((j) => j.plan).map((j) => `${j.mk}:${j.prio}`), photoFirst: photo.indexOf(false) < 0 || !photo.slice(photo.indexOf(false)).includes(true),
      missing: ladder.filter((k) => !ego.includes(k) && !planned.includes(k)), oldMissing: ladder.filter((k) => !M.isPhotoWeapon(k) && !ego.includes(k)),
      slots: P.weapon.slots.map((s) => s.id), lobbyBuilt: ['k36', 'kobra'].filter((k) => ego.includes(k)) };
  });
  check(g1.win.every((k) => g1.ego.includes(k)), `Fenster vorgebaut (${g1.win.join(', ')})`);
  check(g1.oldMissing.length === 0, `Waffen alter Bauweise der Leiter im Ladebildschirm gebaut (fehlend: ${g1.oldMissing.join(', ') || '–'})`);
  check(g1.missing.length === 0 && g1.plan.every((x) => x.endsWith(':0')), `übrige Foto-Waffen gebaut oder als Plan-Aufträge im Leerlauf (offen: ${g1.plan.join(', ') || '–'}; fehlend: ${g1.missing.join(', ') || '–'})`);
  check(g1.photoFirst, 'Plan: Foto-Waffen vor den Waffen alter Bauweise');
  check(g1.lobbyBuilt.length === 0 && g1.slots.join() === 'smg_vp9', `Lobby-Ausrüstung nicht gebaut, Start mit der Stufe-1-Waffe (${g1.slots.join(', ')}; gebaut: ${g1.lobbyBuilt.join(', ') || '–'})`);
  // Aufstieg innerhalb des Fensters: echte Fassung, kein Bau im Bild
  const g2 = await g.evaluate(async () => {
    const G = window.__game, P = G.player, vm = P.weapon.viewModel, THREE = await import('three');
    const M = await import('/assets/js/game/weapons/models.js');
    const fr = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    G.debugApi.godMode(true);
    const n0 = M.weaponTemplateStats().length;
    const v = G.bots.bots.find((b) => b.alive);
    G.combat.damage(v, { amount: 9999, attacker: P, weaponId: P.weapon.currentDef.id, zone: 'body', dir: new THREE.Vector3(0, 0, -1) });
    for (let i = 0; i < 200 && !(vm.cur && vm.cur.id === G.mode.steps[1]); i++) await fr();
    return { cur: vm.cur && vm.cur.id, stub: !!vm.cur.stub, built: M.weaponTemplateStats().length - n0 };
  });
  check(g2.cur === 'smg_qx90' && !g2.stub && g2.built === 0, `Aufstieg im Fenster: ${g2.cur} sofort echt, keine Vorlage gebaut (${g2.built})`);
  // Aufstieg auf eine noch nicht gebaute Foto-Waffe (Adler, Stufe 9): Platzhalter, auch in Ruhe kein Vorlagenbau; im Todesbildschirm
  // gebaut und getauscht, Wiedereinstieg trotz Bau nicht später (Bauzeit angerechnet)
  const g3 = await g.evaluate(async () => {
    const G = window.__game, P = G.player, vm = P.weapon.viewModel, mode = G.mode, THREE = await import('three');
    const M = await import('/assets/js/game/weapons/models.js');
    const fr = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    for (const [mk, e] of [...vm._models]) if (mk.startsWith('pi_adler')) { vm._dropEntry(e); vm._models.delete(mk); }
    for (const j of vm._bgJobs || []) if (j.mk.startsWith('pi_adler')) vm._dropEntry(j.entry);
    vm._bgJobs = (vm._bgJobs || []).filter((j) => !j.mk.startsWith('pi_adler'));
    M.releaseWeaponTemplate('adler', 'first');
    mode._setLevel(P, 8); mode._flush();
    for (let i = 0; i < 200 && !(vm.cur && vm.cur.id === 'pi_adler' && vm._equipT >= 1); i++) await fr();
    const out = { stub: !!vm.cur.stub, lod: vm.cur.ud.lod, built: M.hasWeaponModel('adler') };
    vm._restT = vm._time - 30; // lange Ruhe
    for (let i = 0; i < 8; i++) await fr();
    out.calmBuilt = M.hasWeaponModel('adler');
    G.debugApi.godMode(false);
    const killer = G.bots.bots.find((b) => b.alive) || G.bots.bots[0];
    const sim0 = G.time.elapsed;
    G.combat.damage(P, { amount: 9999, attacker: killer, weaponId: 'smg_vp9', zone: 'head', dir: new THREE.Vector3(0, 0, 1) });
    for (let i = 0; i < 4000 && !P.alive; i++) await fr();
    out.deadSim = +(G.time.elapsed - sim0).toFixed(2); out.nominal = mode.respawnDelay; out.alive = P.alive;
    // Prüfung 26.10.: nach dem Wiedereinstieg wieder unverwundbar – unter Last (≈ 1 Bild/s) traf sonst ein Bot vor dem Tausch
    G.debugApi.godMode(true);
    for (let i = 0; i < 400 && vm.cur.stub; i++) { if (!P.alive) break; await fr(); }
    out.after = { stub: !!vm.cur.stub, built: M.hasWeaponModel('adler'), cur: vm.cur.id, alive: P.alive };
    return out;
  });
  check(g3.stub && g3.lod === 'third' && !g3.built, `Aufstieg ohne fertige Fassung: Platzhalter (Bot-Fassung), kein Bau im Bild (${JSON.stringify({ stub: g3.stub, lod: g3.lod })})`);
  check(!g3.calmBuilt, 'in Ruhe mitten im Spiel kein Vorlagenbau');
  check(g3.alive && g3.deadSim < g3.nominal - 0.1, `Bauzeit auf den Wiedereinstieg angerechnet (Spielzeit tot ${g3.deadSim} s statt ${g3.nominal} s – der Bau verlängert den Todesbildschirm nicht)`);
  check(g3.after.built && !g3.after.stub && g3.after.cur === 'pi_adler', `Adler im Leerlauf gebaut und getauscht (${JSON.stringify(g3.after)})`);
  await g.close();

  // ---- 26.10. Schießstand PC hoch: nur die Ausrüstung voll vorgebaut, die übrigen Waffen als Plan-Aufträge in der leichten Stufe
  //      (Vorlage + Shader, kein Eintrag); im Pausenmenü (Waffenkammer) gebaut; die dort gewählte Waffe entsteht noch im Pausenmenü voll
  const t = await ctx.newPage();
  t.on('pageerror', (e) => errors.push(e.message));
  t.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await t.goto(`${BASE}spielen.html?autostart=1&mode=training&map=range&quality=high&allies=0&enemies=0&primary=ar_m17&secondary=pi_p9`);
  ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await t.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing'); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Schießstand läuft (PC, hoch)');
  const t1 = await t.evaluate(async () => {
    const G = window.__game, vm = G.player.weapon.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const fr = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const gun = (k) => !/^(knife|frag|semtex|impact|molotov|flash|smoke|plate):/.test(k);
    const maxEgo = M.weaponTemplateStats().filter((x) => x.k.includes(':first:max') && gun(x.k)).map((x) => x.k.split(':')[0]);
    const st = vm.buildState();
    const out = { maxEgo, plan: st.jobs.filter((j) => j.plan).length, warm: st.jobs.filter((j) => j.plan && j.warm === 'std').length };
    const st0 = G.match.state;
    G.match.state = 'paused'; // wie das Pausenmenü (Waffenkammer) – ohne Menü, das kopflos auf die Zeigersperre wartete
    // Prüfung 26.10.: solange im Menü bedient wird (Eingabe < 1,5 s her), keine schweren Plan-Schritte (Klicks blieben sonst hängen)
    const n0in = M.weaponTemplateStats().length;
    for (let i = 0; i < 12; i++) { window.dispatchEvent(new PointerEvent('pointerdown')); await fr(); }
    out.builtWhileInput = M.weaponTemplateStats().length - n0in;
    const std0 = M.weaponTemplateStats().filter((x) => /:first\|?/.test(x.k) && !x.k.includes(':max') && !x.k.includes(':lite')).length;
    for (let i = 0; i < 300 && vm.buildState().jobs.some((j) => j.plan); i++) await fr();
    out.stdBuilt = M.weaponTemplateStats().filter((x) => /:first\|?/.test(x.k) && !x.k.includes(':max') && !x.k.includes(':lite')).length - std0;
    out.left = vm.buildState().jobs.filter((j) => j.plan).length;
    // Nachprüfung 26.10.: Waffenkammer durchgeklickt (Eingabe läuft) → auch die gewählte Waffe nicht gebaut; abgewählte entfallen
    const maxN = () => M.weaponTemplateStats().filter((x) => x.k.includes(':first:max') && gun(x.k)).length;
    const m0 = maxN();
    for (const id of ['smg_qx90', 'ar_kv47']) {
      G.mode.setWeapon('primary', id);
      for (let i = 0; i < 6; i++) { window.dispatchEvent(new PointerEvent('pointerdown')); await fr(); }
    }
    out.clickBuilt = maxN() - m0;
    // Waffenkammer (Pausenmenü): gewählte Waffe wird noch im Pausenmenü in max gebaut; nach dem Weiterspielen Wechsel ohne Bau
    const had = M.hasWeaponModel('vp9');
    G.mode.setWeapon('primary', 'smg_vp9');
    for (let i = 0; i < 2000 && !(M.hasWeaponModel('vp9') && !vm.buildState().jobs.some((j) => j.mk === 'smg_vp9')); i++) await fr();
    out.builtInPause = !had && M.hasWeaponModel('vp9');
    const bs = vm.buildState();
    out.clickLeft = [...bs.entries.map((e) => e.mk), ...bs.jobs.filter((j) => !j.plan).map((j) => j.mk)].filter((mk) => /qx90|kv47/.test(mk));
    out.clickMax = maxN() - m0;
    const n0 = M.weaponTemplateStats().length;
    G.match.state = st0;
    for (let i = 0; i < 100 && !(vm.cur && vm.cur.id === 'smg_vp9'); i++) await fr();
    out.pick = { cur: vm.cur && vm.cur.id, stub: !!(vm.cur && vm.cur.stub), tier: vm.cur && vm.cur.tier, built: M.weaponTemplateStats().length - n0 };
    return out;
  });
  check(t1.maxEgo.sort().join() === 'm17,p9', `nur die Ausrüstung in max vorgebaut (${t1.maxEgo.join(', ')})`);
  check(t1.plan > 10 && t1.warm === t1.plan, `übrige Waffen als Plan-Aufträge in der leichten Stufe (${t1.warm}/${t1.plan})`);
  check(t1.builtWhileInput === 0, `Pausenmenü während der Bedienung: keine Vorlage gebaut (${t1.builtWhileInput})`);
  check(t1.stdBuilt > 0, `Pausenmenü: Hintergrund baut die leichte Fassung (${t1.stdBuilt} gebaut, ${t1.left} offen)`);
  check(t1.clickBuilt === 0, `Waffenkammer durchgeklickt (QX-90, KV-47): während der Bedienung keine Vorlage gebaut (${t1.clickBuilt})`);
  check(t1.builtInPause, 'Waffenkammer: gewählte Waffe noch im Pausenmenü in max gebaut');
  check(!t1.clickLeft.length && t1.clickMax === 1, `… nur die zuletzt gewählte Waffe gebaut, abgewählte ohne Eintrag/Auftrag (${t1.clickLeft.join(', ') || '–'}; ${t1.clickMax} neu in max)`);
  check(t1.pick.cur === 'smg_vp9' && !t1.pick.stub && t1.pick.tier === 'max' && t1.pick.built === 0, `… nach dem Weiterspielen sofort in der Hand, kein Bau im Bild (${JSON.stringify(t1.pick)})`);
  await t.close();

  // ---- Prüfung 26.10.: Waffenspiel mit eingeschaltetem VR-Modus baut die ganze Leiter im Ladebildschirm (in der Brille keine schweren
  //      Plan-Schritte – sonst käme ab Stufe 4 bis zum Tod die Bot-Fassung in die Hand); eigener Kontext (Einstellung bleibt dort)
  const vctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await vctx.addInitScript(() => { try { localStorage.removeItem('nullpunkt.aufsaetze'); localStorage.setItem('nullpunkt:settings', JSON.stringify({ vrEnabled: true })); } catch { /* */ } });
  const v = await vctx.newPage();
  v.on('pageerror', (e) => errors.push(e.message));
  v.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await v.goto(`${BASE}spielen.html?autostart=1&mode=gun&map=range&quality=low&allies=0&enemies=1`);
  ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await v.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing'); }).catch(() => false); if (!ok) await sleep(1000); }
  const v1 = await v.evaluate(async () => {
    const G = window.__game, W = G.data.WEAPONS, vm = G.player.weapon.viewModel;
    const M = await import('/assets/js/game/weapons/models.js');
    const ego = M.weaponTemplateStats().filter((x) => x.k.includes(':first')).map((x) => x.k.split(':')[0]);
    const ladder = [...new Set(G.mode.steps.filter((id) => W[id].cls !== 'melee').map((id) => W[id].model))];
    return { vr: G.settings ? G.settings.get('vrEnabled') : null, all: G.match.prebuildAll, missing: ladder.filter((k) => !ego.includes(k)), plan: vm.buildState().jobs.filter((j) => j.plan).length };
  });
  check(ok && v1.all && v1.missing.length === 0 && v1.plan === 0, `VR-Modus an: ganze Leiter vorgebaut, keine Plan-Aufträge (${JSON.stringify(v1)})`);
  await vctx.close();
} catch (err) {
  check(false, `Ablauf abgebrochen: ${err.message.split('\n')[0]}`);
} finally {
  await browser.close();
}
check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
console.log(`${count - fail}/${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
