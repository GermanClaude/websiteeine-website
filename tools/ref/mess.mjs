// Messung je Waffe und Detailstufe (Pflicht vor jedem Commit, waffen-bauanleitung.md 3.6):
//   node tools/ref/mess.mjs <keys=m17,p9> [stufen=max,std,lite,third] [--att='{"optik":"rotpunkt"}']
// Je Modell × Stufe eine frische Seite: Dreiecke, Meshes (Draw Calls, davon transparent), Materialien,
// „Bau“ = erster Bau inkl. Materialien/Texturen, „Geo“ = zweiter Bau nur Geometrie (Bauplan direkt),
// Geometrie-Speicher (Attribut-Bytes, nicht indiziert ≈ 96–120 B/Dreieck), Texturen (Anzahl, MB inkl. Mipmaps),
// Kontaktgitter (Ego). Server: NP_BASE (Standard http://localhost:8765/).
import { chromium, BASE, GL_ARGS } from '../pw.mjs';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const attArg = (process.argv.find((a) => a.startsWith('--att=')) || '').slice(6);
const att = attArg ? JSON.parse(attArg) : null;
const keys = (args[0] || 'm17,p9').split(','), tiers = (args[1] || 'max,std,lite,third').split(',');
const b = await chromium.launch({ args: GL_ARGS });
const rows = [];
for (const key of keys) for (const tier of tiers) {
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto(`${BASE}dev/fotostudio.html?model=frag&w=64&h=64&ao=0`);
  for (let i = 0; i < 200; i++) { if (await p.evaluate(() => !!(window.__studio && window.__studio.ready)).catch(() => false)) break; await new Promise((r) => setTimeout(r, 300)); }
  const r = await p.evaluate(async ({ key, tier, att }) => {
    const M = await import('/assets/js/game/weapons/models.js');
    const B = await import('/assets/js/game/weapons/gunsmith/builder.js');
    const C = await import('/assets/js/game/weapons/gunsmith/contact.js');
    B.DETAIL.max = tier === 'max'; B.DETAIL.lite = tier === 'lite';
    const lod = tier === 'third' ? 'third' : 'first';
    const t0 = performance.now();
    const m = M.createWeaponModel(key, { lod, att });
    const buildMs = performance.now() - t0;
    // Bauplan-Funktion über die Importe von models.js finden (auch neue guns-<name>.js)
    const src = await (await fetch('/assets/js/game/weapons/models.js')).text();
    let fn = null;
    for (const [, f] of src.matchAll(/from '\.\/gunsmith\/([\w-]+)\.js'/g)) { const mod = await import('/assets/js/game/weapons/gunsmith/' + f + '.js'); if (typeof mod[key] === 'function') { fn = mod[key]; break; } }
    let geoMs = null;
    if (fn) { const t = performance.now(); const bb = new B.Builder(lod); bb.att = att; fn(bb); bb.build(key); geoMs = performance.now() - t; }
    let col = null;
    if (lod === 'first') { const t = performance.now(); const g = new C.GunCollider(m); col = [Math.round(performance.now() - t), Math.round(g.groups.reduce((n, x) => n + x.T.length / 9, 0))]; }
    let meshes = 0, transp = 0, bytes = 0; const mats = new Set(), tex = new Map();
    m.traverse((o) => {
      if (!o.isMesh) return;
      meshes++; if (o.material.transparent) transp++; mats.add(o.material.name);
      for (const a of Object.values(o.geometry.attributes)) bytes += a.array.byteLength;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) { const t = o.material[k]; if (t && t.image) tex.set(t.source ? t.source.uuid : t.uuid, t.image.width * t.image.height); }
    });
    const texPx = [...tex.values()].reduce((a, v) => a + v, 0);
    return { key, tier, tris: m.userData.info.triangles, meshes, transp, mats: mats.size, buildMs: Math.round(buildMs), geoMs: geoMs === null ? null : Math.round(geoMs),
      geoMB: +(bytes / 1048576).toFixed(1), tex: tex.size, texMB: +(texPx * 4 * 4 / 3 / 1048576).toFixed(1), colMs: col && col[0], colTris: col && col[1] };
  }, { key, tier, att });
  console.log(JSON.stringify(r));
  rows.push(r);
  await p.close();
}
console.log('\nModell Stufe   Dreiecke  Meshes(tr.)  Bau ms  Geo ms  Geo MB  Tex(MB)    Kontakt');
for (const r of rows) console.log(`${r.key.padEnd(6)} ${r.tier.padEnd(5)} ${String(r.tris).padStart(9)}  ${String(r.meshes).padStart(4)} (${String(r.transp).padStart(2)})  ${String(r.buildMs).padStart(6)}  ${String(r.geoMs).padStart(6)}  ${String(r.geoMB).padStart(6)}  ${String(r.tex).padStart(2)} (${r.texMB})  ${r.colMs ?? '–'} ms/${r.colTris ?? '–'}`);
await b.close();
