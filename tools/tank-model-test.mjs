// NULLPUNKT – Abnahme Fahrzeugmodelle (docs/planung/panzer-mp.md §D.3/§D.4) im Browser: dev/vehicles.html?enter=0.
// Prüft Dreiecke je Grafikstufe (low exakt wie vorher), Draw Calls, benannte Teile (Luken, Innenraum, Verschluss),
// die Modell-API (setHatch/setRack/setHeld/setBreech/setInterior), Wrack-Umschaltung und den Geländewagen.
// Bilder (vorher/nachher, low und high, beide Teamfarben) nach tools/out/panzer/ (wird nicht eingecheckt).
// Aufruf: node tools/tank-model-test.mjs [--shots=vorher|nachher] [--q=low,high] [--only-shots]   (Exit-Code ≠ 0 bei Fehlern)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const SHOTS = arg('shots'); // 'vorher' | 'nachher' | null
const ONLY_SHOTS = process.argv.includes('--only-shots');
const OUT = new URL('./out/panzer/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Budget (§D.3); low: exakt der Stand vor der Detaillierung
const BASE_LOW = { mbt: [4936, 2784, 864], jeep: [3088, 2020, 1248] };
const BUDGET = {
  mbt: { medium: [11000, 4000, 1000], high: [18000, 5000, 1000], ultra: [18000, 5000, 1000] },
  jeep: { medium: [10000, 2500, 1300], high: [10000, 2500, 1300], ultra: [10000, 2500, 1300] },
};
const EXTRA = { low: { hatches: 300, interior: 600 }, medium: { hatches: 450, interior: 1500 }, high: { hatches: 450, interior: 3000 }, ultra: { hatches: 450, interior: 3000 } };
// Draw Calls (Nahstufe, ohne Schattenpass) vor der Detaillierung – höchstens +4
const BASE_CALLS = { mbt: { low: 19, high: 22 }, jeep: { low: 23, high: 26 } };

async function waitForLoad() {
  for (let i = 0; i < 10; i++) {
    let l1 = 0;
    try { l1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return; }
    if (!(l1 > 6)) return;
    console.log(`     Last ${l1} > 6 – warte 60 s`);
    await sleep(60000);
  }
}

let fail = 0, count = 0;
const check = (ok, text, val = '') => {
  count++;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${text}${val !== '' ? ` → ${val}` : ''}`);
};

await waitForLoad();
const errors = [];
const browser = await chromium.launch({ args: GL_ARGS });
const ctx = await browser.newContext({ viewport: SHOTS ? { width: 960, height: 540 } : { width: 640, height: 360 } });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|Failed to load resource.*(404|net::ERR_ABORTED)/.test(t)) return;
  errors.push(t);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

/** Prüfstand laden, Sim synchron einschwingen lassen, Hilfen (Kamera, Zählung) im Seitenkontext anlegen. */
async function open(type, quality, lite) {
  await page.goto(BASE + `dev/vehicles.html?type=${type}&quality=${quality}&enter=0${lite ? '&lite=1' : ''}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__dev && window.__dev.main && window.__dev.sys.attached, null, { timeout: 180000 });
  await page.addStyleTag({ content: '#panel, #hud { display: none !important; }' });
  await page.evaluate(async () => {
    const D = window.__dev, G = D.G, sys = D.sys;
    const step = (sec, dt = 1 / 60) => { for (let i = 0, n = Math.round(sec / dt); i < n; i++) { G.time.elapsed += dt; G.time.frame++; sys.update(dt); } };
    step(3);
    // Zählung je LOD-Stufe: sichtbare Netze (Draw Calls ohne Schattenpass) und Dreiecke
    // (LOD-Stufen werden unabhängig von der aktuellen Kamera gezählt; unsichtbare Teile wie Innenraum/Kegel nicht)
    const visit = (o, lvl, acc, force = false) => {
      if (!o.visible && !force) return acc;
      if (o.isMesh) { acc.calls++; acc.tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
      if (o.isLOD) { visit(o.levels[Math.min(lvl, o.levels.length - 1)].object, lvl, acc, true); return acc; }
      for (const c of o.children) visit(c, lvl, acc);
      return acc;
    };
    const calls = (model, lvl = 0) => visit(model.root, lvl, { calls: 0, tris: 0 });
    const cam = D.player.camera;
    D.player.update = () => {}; // Kamera gehört jetzt dem Test
    const look = (p, t, fov = 50) => { cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(...p); cam.lookAt(...t); D.player.baseFov = fov; };
    const frames = (n = 3) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    let mats = null;
    try { mats = await import('/assets/js/game/vehicles/materials.js'); } catch { mats = null; }
    const models = await import('/assets/js/game/vehicles/models.js');
    window.__mt = { step, calls, look, frames, mats, models };
  });
}

async function shots(quality, wait) {
  if (wait) await waitForLoad();
  await open('mbt', quality, false);
  const pre = SHOTS;
  // Fotoscan-Materialien abwarten (gleiches Bild vorher/nachher)
  await page.evaluate(async () => { const M = window.__mt.mats; if (M && M.upgradeVehicleMaterials) await Promise.race([M.upgradeVehicleMaterials(window.__dev.G.renderer.renderer, window.__dev.G.renderer.quality), new Promise((r) => setTimeout(r, 30000))]); });
  // zweiter Panzer (Team B) und Geländewagen stehen daneben; Sim danach anhalten (Modellzustand gehört dem Test)
  await page.evaluate(() => {
    const D = window.__dev, M = window.__mt;
    D.__b = D.spawn('mbt', new D.G.THREE.Vector3(-11, 0.05, 28), 0.5, 'B');
    M.step(3);
    D.sys.update = () => {};
  });
  const motive = [
    ['aussen-vorn', 'A: 3/4 vorn', (v) => ({ p: [v.x - 7.2, v.y + 3.1, v.z - 8.4], t: [v.x, v.y + 1.3, v.z] })],
    ['aussen-hinten', 'A: 3/4 hinten', (v) => ({ p: [v.x + 7.4, v.y + 3.6, v.z + 8.8], t: [v.x, v.y + 1.4, v.z + 0.3] })],
    ['laufwerk', 'Laufwerk nah', (v) => ({ p: [v.x - 4.6, v.y + 1.05, v.z - 1.9], t: [v.x - 1.5, v.y + 0.7, v.z + 0.6], fov: 55 })],
    ['turm-oben', 'Turm von oben', (v) => ({ p: [v.x + 1.4, v.y + 8.2, v.z + 3.6], t: [v.x, v.y + 2.2, v.z + 0.1] })],
    ['luken', 'Luken offen', (v) => ({ p: [v.x - 3.4, v.y + 4.4, v.z + 2.6], t: [v.x - 0.1, v.y + 2.3, v.z - 0.8], fov: 55 }), 'luken'],
    ['luken-vorn', 'Luken offen (Fahrer, Kommandant, Ladeschütze), vorn links oben', (v) => ({ p: [v.x - 4.4, v.y + 4.3, v.z - 5.8], t: [v.x - 0.3, v.y + 1.9, v.z - 1.0] }), 'luken'],
    ['team-b', 'B: 3/4 vorn, Halbtotale beider Teams', (v) => ({ p: [v.x - 2.5, v.y + 5.5, v.z - 19], t: [v.x - 5.5, v.y + 1.2, v.z] })],
    ['innen-verschluss', 'Innenraum: Blick zum Verschluss', null, 'innen-vorn'],
    ['innen-gestell', 'Innenraum: Blick zum Gestell (Granate in der Hand)', null, 'innen-hinten'],
  ];
  for (const [name, label, pose, special] of motive) {
    const r = await page.evaluate(({ pose, special }) => {
      const D = window.__dev, M = window.__mt, v = D.main, md = v.model, THREE = D.G.THREE;
      for (const id of ['driver', 'commander', 'loader']) md.setHatch?.(id, special === 'luken' ? 1 : 0);
      md.setInterior?.(!!(special && special.startsWith('innen')));
      md.setBreech?.(special === 'innen-vorn' ? 1 : 0);
      md.setRack?.({ mbt_ap: 14, mbt_he: 9 });
      md.setHeld?.(special === 'innen-hinten' ? 'mbt_he' : null);
      v.model.root.updateMatrixWorld(true);
      if (special && special.startsWith('innen')) {
        const t = md.turret, eye = t.localToWorld(new THREE.Vector3(0.55, 0.62, 0.35));
        const at = special === 'innen-vorn' ? t.localToWorld(new THREE.Vector3(0.05, 0.42, -0.65)) : t.localToWorld(new THREE.Vector3(0.1, 0.4, 1.6));
        M.look(eye.toArray(), at.toArray(), 75);
      } else {
        const P = new Function('v', `return (${pose})(v)`)(v.position);
        M.look(P.p, P.t, P.fov || 50);
      }
      return true;
    }, { pose: pose ? pose.toString() : null, special: special || null });
    void r;
    await page.evaluate(() => window.__mt.frames(3));
    const file = `${OUT}${pre}-${quality}-${name}.png`;
    await page.screenshot({ path: file, timeout: 180000 });
    console.log(`     Bild ${label}: ${file}`);
  }
  // Geländewagen 3/4 vorn
  await page.evaluate(() => {
    const D = window.__dev, M = window.__mt, v = D.other.position;
    for (const id of ['driver', 'commander', 'loader']) D.main.model.setHatch?.(id, 0);
    D.main.model.setInterior?.(false);
    M.look([v.x - 5.0, v.y + 2.3, v.z - 6.2], [v.x, v.y + 1.0, v.z + 0.2], 50);
  });
  await page.evaluate(() => window.__mt.frames(3));
  await page.screenshot({ path: `${OUT}${pre}-${quality}-gw4.png`, timeout: 180000 });
  console.log(`     Bild GW-4 3/4 vorn: ${OUT}${pre}-${quality}-gw4.png`);
  const st = await page.evaluate(() => {
    const D = window.__dev, M = window.__mt;
    return { mbt: [0, 1, 2].map((l) => M.calls(D.main.model, l)), jeep: [0, 1, 2].map((l) => M.calls(D.other.model, l)) };
  });
  console.log(`     ${quality}: KP-1 Draw Calls/Dreiecke je LOD ${st.mbt.map((x) => `${x.calls}/${Math.round(x.tris)}`).join(' · ')} | GW-4 ${st.jeep.map((x) => `${x.calls}/${Math.round(x.tris)}`).join(' · ')}`);
}

try {
  mkdirSync(OUT, { recursive: true });
  if (SHOTS) {
    const qs = (arg('q') || 'low,high').split(',');
    for (const q of qs) await shots(q, q !== qs[0]);
    if (ONLY_SHOTS) throw 'fertig';
  }

  // 1) Dreiecke je Stufe (Vorlagen, unabhängig von der Seitenstufe) – Last wurde zu Beginn geprüft (ein Browser)
  if (SHOTS) await waitForLoad();
  await open('mbt', 'low', true);
  const tri = await page.evaluate(() => {
    const M = window.__mt.models, out = {};
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      out[q] = { mbt: M.vehicleTriangles('mbt', q), jeep: M.vehicleTriangles('jeep', q), extra: M.vehicleExtraTriangles ? M.vehicleExtraTriangles('mbt', q) : null };
    }
    M.vehicleTriangles('mbt', 'low'); // Lack-Haken wieder auf die Seitenstufe
    return out;
  });
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const t = tri[q];
    if (q === 'low') {
      check(t.mbt.join() === BASE_LOW.mbt.join(), 'KP-1 low: LOD-Dreiecke unverändert', t.mbt.join('/'));
      check(t.jeep.join() === BASE_LOW.jeep.join(), 'GW-4 low: LOD-Dreiecke unverändert', t.jeep.join('/'));
    } else {
      check(t.mbt.every((n, i) => n <= BUDGET.mbt[q][i]), `KP-1 ${q}: LOD-Dreiecke im Budget ${BUDGET.mbt[q].join('/')}`, t.mbt.join('/'));
      check(t.jeep.every((n, i) => n <= BUDGET.jeep[q][i]), `GW-4 ${q}: LOD-Dreiecke im Budget ${BUDGET.jeep[q].join('/')}`, t.jeep.join('/'));
    }
    const E = EXTRA[q];
    check(!!t.extra && t.extra.hatches > 0 && t.extra.hatches <= E.hatches, `KP-1 ${q}: Luken ≤ ${E.hatches}`, t.extra ? t.extra.hatches : 'fehlt');
    check(!!t.extra && t.extra.interior > 0 && t.extra.interior <= E.interior, `KP-1 ${q}: Innenraum ≤ ${E.interior}`, t.extra ? t.extra.interior : 'fehlt');
  }

  // 2) Teile und API (Seite low)
  let r = await page.evaluate(() => {
    const D = window.__dev, M = window.__mt, v = D.main, md = v.model;
    const out = {};
    out.names = ['driver', 'commander', 'loader'].map((k) => (md.hatches && md.hatches[k] ? md.hatches[k].name : null));
    out.hatchParent = md.hatches && md.hatches.commander && md.hatches.loader ? [md.hatches.commander.parent === md.turret, md.hatches.loader.parent === md.turret] : [false, false];
    out.interior = !!md.interior && md.interior.parent === md.turret && md.interior.visible === false;
    const br = md.gun && md.gun.getObjectByName('breech');
    out.breech = !!br;
    // setHatch dreht (Weltmatrix ändert sich), t = 0 stellt wieder her
    const mw = (o) => { md.root.updateMatrixWorld(true); return o.matrixWorld.elements.slice(); };
    out.hatchTurn = ['driver', 'commander', 'loader'].map((k) => {
      const h = md.hatches?.[k]; if (!h) return false;
      md.setHatch(k, 0); const a = mw(h);
      md.setHatch(k, 1); const b = mw(h);
      const ang = h.quaternion.angleTo(new D.G.THREE.Quaternion());
      md.setHatch(k, 0); const c = mw(h);
      const diff = (x, y) => x.some((e, i) => Math.abs(e - y[i]) > 1e-4);
      return diff(a, b) && !diff(a, c) && ang > 1.6 && ang < 2.0;
    });
    // Innenraum, Gestell, Granate in der Hand, Verschluss
    md.setInterior(true);
    out.interiorOn = md.interior.visible === true && br && br.visible !== false;
    const seen = () => { let n = 0; md.interior.traverse((o) => { if (o.isMesh && o.userData.rack && o.visible) n += o.userData.shown; }); return n; };
    md.setRack({ mbt_ap: 22, mbt_he: 18 }); const full = seen();
    md.setRack({ mbt_ap: 3, mbt_he: 1 }); const few = seen();
    md.setRack({ mbt_ap: 0, mbt_he: 0 }); const none = seen();
    md.setRack({ mbt_ap: 99, mbt_he: 99 }); const capped = seen();
    out.rack = { full, few, none, capped };
    md.setHeld('mbt_ap'); const heldOn = md.interior.getObjectByName('held');
    out.held = [!!heldOn && heldOn.visible];
    md.setHeld(null); out.held.push(!!heldOn && !heldOn.visible);
    md.setHeld('mbt_he'); out.held.push(!!heldOn && heldOn.visible);
    md.setHeld(null);
    const k0 = br ? br.getObjectByName('breech:keil') : null;
    md.setBreech(0); const y0 = k0 ? k0.position.y : 0;
    md.setBreech(1); const y1 = k0 ? k0.position.y : 0;
    out.breechMove = !!k0 && y1 < y0 - 0.05;
    md.setBreech(0);
    md.setInterior(false);
    out.interiorOff = md.interior.visible === false;
    // Wrack: Luken zu, Innenraum aus, zurück
    md.setHatch('loader', 1); md.setInterior(true);
    md.setWreck(true);
    out.wreck = md.interior.visible === false && md.hatches.loader.quaternion.angleTo(new D.G.THREE.Quaternion()) < 1e-3;
    md.setWreck(false);
    out.unwreck = md.meshes.every((o) => o.material === o.userData.baseMat);
    // Draw Calls (Nahstufe) und Vorwärmliste
    out.calls = M.calls(md, 0).calls;
    out.callsJeep = M.calls(D.other.model, 0).calls;
    const warm = M.mats && M.mats.vehicleWarmMaterials ? M.mats.vehicleWarmMaterials('low') : [];
    const used = new Set();
    md.interior.traverse((o) => { if (o.isMesh) used.add(o.material); });
    for (const h of Object.values(md.hatches)) h.traverse((o) => { if (o.isMesh) used.add(o.material); });
    const S = M.mats.vehicleMaterials();
    const known = new Set([...Object.values(S.paint), S.dark, S.rubber, S.canvas, S.glass, S.interior, S.wreck, ...warm]);
    out.unwarmed = [...used].filter((m) => !known.has(m)).map((m) => m.name);
    out.warm = warm.map((m) => m && m.name);
    return out;
  });
  check(r.names.join() === 'hatch:driver,hatch:commander,hatch:loader', 'Luken benannt', r.names.join(','));
  check(r.hatchParent.every(Boolean), 'Kommandanten-/Ladeschützenluke hängen am Turm');
  check(r.interior, 'Innenraum am Turm, unsichtbar');
  check(r.breech, 'Verschluss am Rohr');
  check(r.hatchTurn.every(Boolean), 'setHatch dreht um 100–110° und schließt wieder', r.hatchTurn.join(','));
  check(r.interiorOn && r.interiorOff, 'setInterior schaltet Innenraum + Verschluss');
  check(r.rack.full > r.rack.few && r.rack.few === 4 && r.rack.none === 0 && r.rack.capped === r.rack.full, 'setRack: sichtbare Granaten, gekappt', JSON.stringify(r.rack));
  check(r.held.every(Boolean), 'setHeld zeigt/verbirgt die Granate');
  check(r.breechMove, 'setBreech: Keil fährt nach unten');
  check(r.wreck && r.unwreck, 'Wrack: Luken zu, Innenraum aus, zurück');
  check(r.calls <= BASE_CALLS.mbt.low + 4, `KP-1 low: Draw Calls ≤ ${BASE_CALLS.mbt.low} + 4`, r.calls);
  check(r.callsJeep <= BASE_CALLS.jeep.low + 4, `GW-4 low: Draw Calls ≤ ${BASE_CALLS.jeep.low} + 4`, r.callsJeep);
  check(r.unwarmed.length === 0, 'Neue Materialien in vehicleWarmMaterials()', r.unwarmed.join(',') || r.warm.join(','));
  await page.evaluate(() => window.__mt.frames(2));

  // 3) Stufe high: Draw Calls, Teile
  await open('mbt', 'high', true);
  r = await page.evaluate(async () => {
    const D = window.__dev, M = window.__mt, md = D.main.model;
    md.setInterior(true); md.setHatch('commander', 1); md.setRack({ mbt_ap: 22, mbt_he: 18 }); md.setHeld('mbt_ap');
    await M.frames(2);
    md.setInterior(false); md.setHatch('commander', 0); md.setHeld(null);
    await M.frames(1);
    return { calls: M.calls(md, 0).calls, callsJeep: M.calls(D.other.model, 0).calls, hatches: Object.keys(md.hatches || {}).length };
  });
  check(r.calls <= BASE_CALLS.mbt.high + 4, `KP-1 high: Draw Calls ≤ ${BASE_CALLS.mbt.high} + 4`, r.calls);
  check(r.callsJeep <= BASE_CALLS.jeep.high + 4, `GW-4 high: Draw Calls ≤ ${BASE_CALLS.jeep.high} + 4`, r.callsJeep);
  check(r.hatches === 3, 'high: drei Luken');

  // 4) Geländewagen rendert fehlerfrei
  await open('jeep', 'high', true);
  r = await page.evaluate(async () => { const D = window.__dev, M = window.__mt; await M.frames(2); return { type: D.main.type, hatches: Object.keys(D.main.model.hatches || {}).length, interior: D.main.model.interior }; });
  check(r.type === 'jeep' && r.hatches === 0 && r.interior === null, 'GW-4: Prüfstand lädt (ohne Luken/Innenraum)');
} catch (err) {
  if (err !== 'fertig') { console.error(err); fail++; }
}
check(errors.length === 0, 'Keine Konsolenfehler', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
