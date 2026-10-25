// Alle Waffen (GUN_KEYS) einer Detailstufe in einer Seite: node tools/ref/alle.mjs [max|std|lite|third]
// Ausgabe je Zeile: Stufe Schlüssel Dreiecke Meshes Bauzeit-ms (Budgets: waffen-bauanleitung.md 3.4).
import { chromium, BASE, GL_ARGS } from '../pw.mjs';
const tier = process.argv[2] || 'std';
const b = await chromium.launch({ args: GL_ARGS });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto(`${BASE}dev/fotostudio.html?model=frag&w=64&h=64&ao=0`);
for (let i = 0; i < 200; i++) { if (await p.evaluate(() => !!(window.__studio && window.__studio.ready)).catch(() => false)) break; await new Promise((r) => setTimeout(r, 300)); }
const r = await p.evaluate(async (tier) => {
  const M = await import('/assets/js/game/weapons/models.js');
  const B = await import('/assets/js/game/weapons/gunsmith/builder.js');
  B.DETAIL.max = tier === 'max'; B.DETAIL.lite = tier === 'lite';
  const lod = tier === 'third' ? 'third' : 'first';
  const out = [];
  for (const k of M.GUN_KEYS) { const t0 = performance.now(); const i = M.getWeaponModelInfo(k, lod); out.push([k, i.triangles, i.meshes, Math.round(performance.now() - t0)]); }
  return out;
}, tier);
for (const x of r) console.log(tier, x.join(' '));
await b.close();
