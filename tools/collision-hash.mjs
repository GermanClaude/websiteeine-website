// Mehrspieler-Prüfung: Ist die Bewegungskollision jeder Karte auf allen Grafikstufen gleich?
// Baut jede Karte in dev/world.html je Stufe (Standard: low und high), bildet einen reihenfolgeunabhängigen Hash über
// alle Kollisionsdreiecke (auf 1 mm gerundet; Großkarte zusätzlich das Höhenfeld) und vergleicht die Stufen.
// Bei Abweichungen: Orte (2-m-Raster) mit den meisten nur auf einer Stufe vorhandenen Dreiecken.
//
//   node tools/collision-hash.mjs [--maps=hafen,altstadt,werk,range,grenzland] [--qualities=low,high] [--top=12]
//   Ergebnis zusätzlich in tools/out/collision-hash.json. Exit-Code 1 bei Abweichung.
//   --no-veg: Großkarte ohne Vegetations-Kollision (Stämme/Felsen) – prüft nur Orte, Requisiten und Gelände.
// Server: NP_BASE (Standard :8765). Rechenintensiv (SwiftShader): nur eine Seite gleichzeitig.
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const MAPS = String(opt.maps || 'hafen,altstadt,werk,range,grenzland').split(',').filter(Boolean);
const QS = String(opt.qualities || 'low,high').split(',').filter(Boolean);
const TOP = Number(opt.top || 12);
mkdirSync('tools/out', { recursive: true });

const browser = await chromium.launch({ args: GL_ARGS });

/** Eine Karte auf einer Stufe bauen → { count, hash, tris: Float64Array-ähnlich [h, x, y, z]… , hf } */
async function measure(map, quality) {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (opt['no-veg']) {
    // nur für diese Prüfung: Vegetation ohne Kollisionsdreiecke ausliefern
    await page.route('**/world/terrain/vegetation.js', async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace('colliders() {', 'colliders() { return { col: new Float32Array(0), bullet: new Float32Array(0) };');
      await route.fulfill({ response: res, body });
    });
  }
  const t0 = Date.now();
  await page.goto(`${BASE}dev/world.html?map=${map}&quality=${quality}&debug=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dev && window.__dev.ready, null, { timeout: 420000 });
  const r = await page.evaluate(() => {
    window.__dev.paused = true; // Bildschleife anhalten (Rechenzeit)
    const w = window.__dev.world;
    const bvh = w.debugData.colliderBVH;
    const tri = bvh.tri, n = bvh.count;
    const q = (v) => Math.round(v * 1000) | 0;
    const out = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      // FNV-1a über die 9 gerundeten Koordinaten
      let h = 0x811c9dc5;
      for (let k = 0; k < 9; k++) { h ^= q(tri[i * 9 + k]); h = Math.imul(h, 0x01000193); }
      out[i * 4] = h >>> 0;
      out[i * 4 + 1] = Math.round((tri[i * 9] + tri[i * 9 + 3] + tri[i * 9 + 6]) / 3 * 10) / 10;
      out[i * 4 + 2] = Math.round((tri[i * 9 + 1] + tri[i * 9 + 4] + tri[i * 9 + 7]) / 3 * 10) / 10;
      out[i * 4 + 3] = Math.round((tri[i * 9 + 2] + tri[i * 9 + 5] + tri[i * 9 + 8]) / 3 * 10) / 10;
    }
    // Großkarte: Höhenfeld (Gelände-Kollision) mitprüfen
    let hf = null;
    const H = w.debugData.heightfield;
    if (H && H.heights) {
      let h = 0x811c9dc5;
      for (let i = 0; i < H.heights.length; i++) { h ^= Math.round(H.heights[i] * 1000) | 0; h = Math.imul(h, 0x01000193); }
      hf = { n: H.n, res: H.res, hash: (h >>> 0).toString(16) };
    }
    return { count: n, tris: out, hf, quality: w.stats?.quality || null, assets: w.stats?.assets ? { models: w.stats.assets.models, skipped: (w.stats.assets.modelsSkipped || []).length, fallbacks: w.stats.propFallbacks || 0 } : null };
  });
  await ctx.close();
  // reihenfolgeunabhängiger Gesamt-Hash: sortierte Dreiecks-Hashes
  const hs = new Uint32Array(r.count);
  for (let i = 0; i < r.count; i++) hs[i] = r.tris[i * 4];
  hs.sort();
  let h = 0x811c9dc5;
  for (let i = 0; i < hs.length; i++) { h ^= hs[i]; h = Math.imul(h, 0x01000193); }
  return { ...r, hash: (h >>> 0).toString(16), ms: Date.now() - t0, errors };
}

/** Dreiecke, die nur in a vorkommen (Multimenge) → nach 2-m-Zellen gruppiert. */
function onlyIn(a, b) {
  const cnt = new Map();
  for (let i = 0; i < b.count; i++) { const k = b.tris[i * 4]; cnt.set(k, (cnt.get(k) || 0) + 1); }
  const cells = new Map();
  let total = 0;
  for (let i = 0; i < a.count; i++) {
    const k = a.tris[i * 4], c = cnt.get(k) || 0;
    if (c > 0) { cnt.set(k, c - 1); continue; }
    total++;
    const x = a.tris[i * 4 + 1], y = a.tris[i * 4 + 2], z = a.tris[i * 4 + 3];
    const key = `${Math.round(x / 2) * 2},${Math.round(z / 2) * 2}`;
    const e = cells.get(key) || { x: Math.round(x / 2) * 2, z: Math.round(z / 2) * 2, n: 0, yMin: Infinity, yMax: -Infinity };
    e.n++; e.yMin = Math.min(e.yMin, y); e.yMax = Math.max(e.yMax, y);
    cells.set(key, e);
  }
  return { total, cells: [...cells.values()].sort((p, q) => q.n - p.n).slice(0, TOP).map((e) => `(${e.x}, ${e.z}) y ${e.yMin.toFixed(1)}…${e.yMax.toFixed(1)}: ${e.n}`) };
}

const report = {};
let bad = 0;
for (const map of MAPS) {
  const res = {};
  for (const q of QS) {
    try {
      res[q] = await measure(map, q);
      console.log(`${map.padEnd(10)} ${q.padEnd(6)} ${String(res[q].count).padStart(7)} Dreiecke  Hash ${res[q].hash}${res[q].hf ? `  Höhenfeld ${res[q].hf.hash}` : ''}  (${(res[q].ms / 1000).toFixed(0)} s${res[q].assets ? `, Modelle ${res[q].assets.models}, übersprungen ${res[q].assets.skipped}, Ersatz ${res[q].assets.fallbacks}` : ''})${res[q].errors.length ? `  Fehler: ${res[q].errors.join(' | ')}` : ''}`);
    } catch (err) {
      console.log(`${map.padEnd(10)} ${q.padEnd(6)} FEHLER ${err.message}`);
      res[q] = null;
    }
  }
  const [a, b] = QS.map((q) => res[q]);
  const entry = { qualities: Object.fromEntries(QS.map((q) => [q, res[q] ? { count: res[q].count, hash: res[q].hash, hf: res[q].hf, assets: res[q].assets } : null])) };
  if (a && b) {
    const same = a.hash === b.hash && a.count === b.count && (a.hf?.hash || '') === (b.hf?.hash || '');
    entry.identical = same;
    if (!same) {
      bad++;
      const da = onlyIn(a, b), db = onlyIn(b, a);
      entry.onlyIn = { [QS[0]]: da, [QS[1]]: db };
      console.log(`  ABWEICHUNG: nur ${QS[0]} ${da.total}, nur ${QS[1]} ${db.total}${(a.hf?.hash || '') !== (b.hf?.hash || '') ? ', Höhenfeld verschieden' : ''}`);
      for (const [q, d] of [[QS[0], da], [QS[1], db]]) if (d.total) console.log(`    nur ${q}: ${d.cells.join(' · ')}`);
    } else console.log('  gleich ✓');
  } else { entry.identical = null; bad++; }
  report[map] = entry;
}
await browser.close();
writeFileSync('tools/out/collision-hash.json', JSON.stringify(report, null, 1));
console.log(bad ? `\n${bad} Karte(n) mit Abweichung/Fehler` : '\nAlle Karten: Kollision auf allen Stufen gleich.');
process.exit(bad ? 1 : 0);
