// Prüft die Vorarbeiten für Foto-Waffen (24.10.): Schrift-Atlas (V6), Bauteil-Cache (V3), Atlas je Stufe und
// Freigabe je Waffe (V4), Bot-Stufe ≤ 600 Dreiecke (V9). Am Beispiel M-17 und P-9 in einer Seite.
//   node tools/waffen-cache-test.mjs   (Server: NP_BASE, Standard http://localhost:8765/) – Exit-Code 1 bei Fehlern
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const b = await chromium.launch({ args: GL_ARGS });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${BASE}dev/fotostudio.html?model=frag&w=64&h=64&ao=0`);
for (let i = 0; i < 200; i++) { if (await p.evaluate(() => !!(window.__studio && window.__studio.ready)).catch(() => false)) break; await new Promise((r) => setTimeout(r, 300)); }
const out = await p.evaluate(async () => {
  const M = await import('/assets/js/game/weapons/models.js');
  const B = await import('/assets/js/game/weapons/gunsmith/builder.js');
  const res = [], ok = (name, cond) => res.push([!!cond, name]);
  const sig = (m) => { let n = 0, s = 0; m.traverse((o) => { if (o.isMesh) { n++; const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 97) s += a[i]; } }); return n + ':' + s.toFixed(6); };
  const bytes = (m, seen) => { let n = 0; m.traverse((o) => { if (o.isMesh) for (const a of Object.values(o.geometry.attributes)) if (!seen.has(a.array.buffer)) { seen.add(a.array.buffer); n += a.array.byteLength; } }); return n; };
  const mats = (m) => { const s = []; m.traverse((o) => { if (o.isMesh) s.push(o.material); }); return s; };
  B.DETAIL.max = true; B.DETAIL.lite = false;
  // V6: alle Gravuren der M-17 in einem Material (je Teil ein Netz)
  const base = M.createWeaponModel('m17');
  const schrift = mats(base).filter((m) => m.name.startsWith('gs:schrift:m17'));
  ok('V6 Schrift: ' + schrift.length + ' Netze, ein Material', schrift.length >= 1 && schrift.length <= 2 && new Set(schrift).size === 1);
  ok('V6 keine Einzel-Schriftmaterialien mehr', !mats(base).some((m) => m.name.includes('m17mark')));
  // V3: Aufsatz-Variante teilt die teuren Netze (fast kein neuer Speicher, schnell)
  const seen = new Set(); bytes(base, seen);
  let t = performance.now(); const v = M.createWeaponModel('m17', { att: { optik: 'rotpunkt', muendung: 'daempfer' } }); const vms = performance.now() - t;
  const vb = bytes(v, seen);
  ok(`V3 Variante ${Math.round(vms)} ms, ${(vb / 1048576).toFixed(1)} MB neu`, vb < 4 * 1048576);
  ok('V3 Variante hat die Aufsätze (mehr Netze)', v.userData.info.meshes > base.userData.info.meshes);
  // V9: Bot-Stufen
  ok('V9 M-17 Bot-Stufe ≤ 600 Dreiecke (' + M.getWeaponModelInfo('m17', 'third').triangles + ')', M.getWeaponModelInfo('m17', 'third').triangles <= 600);
  ok('V9 P-9 Bot-Stufe ≤ 400 Dreiecke', M.getWeaponModelInfo('p9', 'third').triangles <= 400);
  // V4: Freigabe je Waffe (Halter-Zähler, keep, Stufen) und Neubau gleich
  const s1 = sig(base), furn1 = mats(base).find((m) => m.name === 'gs:m17Furn');
  let disposed = 0; furn1.map.addEventListener('dispose', () => disposed++);
  M.createWeaponModel('p9');
  const rel = M.holdWeaponModel('p9');
  M.freeIdleWeaponModels([]);
  ok('V4 M-17 (Grundmodell + Variante) freigegeben', !M.hasWeaponModel('m17') && !M.hasWeaponModel('m17', { att: { optik: 'rotpunkt', muendung: 'daempfer' } }));
  ok('V4 gehaltene P-9 bleibt', M.hasWeaponModel('p9'));
  ok('V4 Bot-Stufe bleibt', M.hasWeaponModel('m17', { lod: 'third' }));
  ok('V4 Atlas-Textur freigegeben', disposed === 1);
  const again = M.createWeaponModel('m17');
  ok('V4 Neubau nach Freigabe gleich', sig(again) === s1 && mats(again).find((m) => m.name === 'gs:m17Furn') !== furn1);
  rel();
  M.freeIdleWeaponModels(['m17']);
  ok('V4 P-9 nach Abmeldung frei, M-17 (keep) bleibt', !M.hasWeaponModel('p9') && M.hasWeaponModel('m17'));
  M.preloadWeaponModels(['m17'], ['first'], 'std');
  B.DETAIL.max = false;
  M.freeIdleWeaponModels(['m17']);
  ok('V4 andere Stufe (max) frei, aktuelle (std) bleibt', !M.hasWeaponModel('m17', { tier: 'max' }) && M.hasWeaponModel('m17', { tier: 'std' }));
  // V4: Handy-Fassung mit halbem Atlas, gleiche Geometrie wie bisher, Tarnung greift
  B.DETAIL.lite = true;
  const l = M.createWeaponModel('m17'), lm = mats(l).find((m) => m.name.startsWith('gs:m17Furn'));
  ok('V4 lite-Atlas ' + (lm && lm.map.image.width) + '×' + (lm && lm.map.image.height), lm && lm.name === 'gs:m17Furn@lite' && lm.map.image.width === 1024 && lm.map.image.height === 512);
  const pl = mats(M.createWeaponModel('p9')).filter((m) => m.name.startsWith('gs:p9'));
  ok('V4 P-9 lite-Atlanten halb (' + pl.map((m) => m.map.image.width + '×' + m.map.image.height).join(', ') + ')', pl.length === 2 && pl.every((m) => m.name.endsWith('@lite') && m.map.image.width === 1024));
  const c = M.applyCamo(M.createWeaponModel('m17'), 'wald');
  let camo = false; c.traverse((o) => { if (o.isMesh && o.userData.baseMat && o.userData.baseMat.name === 'gs:m17Furn@lite' && o.material.name.includes(':camo:')) camo = true; });
  ok('V4 Tarnung auf dem Handy-Atlas', camo);
  // Schrift-Atlas (Nachbesserung 24.10.): zu breiter Stempel wird kleiner gezeichnet statt den Waffenbau abzubrechen;
  // kurze Texte unverändert (PC-Stufe: Schriftfelder werden gezeichnet)
  B.DETAIL.max = true; B.DETAIL.lite = false;
  const S = await import('/assets/js/game/weapons/gunsmith/schrift.js');
  const bt = new B.Builder('first'); bt.key = 'test';
  const lang = 'MADE BY NULLPUNKT WAFFENWERK GMBH · KAL 7,62 × 39 MM';
  let err = null;
  try { S.schrift('test').mark(bt, lang, 0.01, 0, 0, 0.002); S.schrift('test').mark(bt, lang, 0.01, 0, 0, 0.002, { vertical: true }); S.schrift('test').mark(bt, 'M17', 0.01, 0, 0, 0.002); } catch (e) { err = e.message; }
  const as = S.schrift('test').aspect, g = document.createElement('canvas').getContext('2d');
  g.font = '600 64px Arial, Helvetica, sans-serif';
  const kurz = (Math.ceil(g.measureText('M17').width) + 8) / Math.ceil(64 * 1.2);   // wie bisher gemessen
  ok('Schrift: langer Stempel passt (' + (err || 'ok') + '), Seitenverhältnis ' + as(lang).toFixed(2) + ', kurzer Text gleich', !err && as(lang) > 15 && as('M17') === kurz);
  return res;
});
let fail = errors.length;
for (const [good, name] of out) { console.log((good ? 'OK     ' : 'FEHLER ') + name); if (!good) fail++; }
for (const e of errors) console.log('Seitenfehler:', e);
await b.close();
console.log(fail ? `${fail} Fehler` : 'alles ok');
process.exit(fail ? 1 : 0);
