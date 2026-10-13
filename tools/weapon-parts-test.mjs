// NULLPUNKT – Waffenmodelle auf schwebende Teile prüfen (Nutzer 13.10.2026: Karambit-Klinge hing frei vor dem Griff,
// Trommelmagazin unter einem Kastenmagazin). Baut jedes Modell (Ego-Detailstufe) ohne Aufsätze und mit jedem einzelnen
// passenden Aufsatz, verbindet Meshes, deren Hüllquader sich (mit 1,5 mm Spiel) berühren, und meldet Gruppen, die nicht
// am größten Teil hängen. Hüllquader sind großzügig: was hier auffällt, schwebt sicher; nicht jeder Fehler fällt auf.
// Voraussetzung: Server auf 8765. Aufruf: node tools/weapon-parts-test.mjs [--verbose]
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const VERBOSE = process.argv.includes('--verbose');
const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}spielen.html`, { waitUntil: 'load' });

const res = await page.evaluate(async () => {
  const M = await import('/assets/js/game/weapons/models.js');
  const { WEAPONS, WEAPON_IDS } = await import('/assets/js/shared/weapons.data.js');
  const A = await import('/assets/js/shared/attachments.data.js');
  const THREE = await import('three');
  const GAP = 0.0015;
  const keys = new Map(); // Modell → Waffendefinition (für passende Aufsätze)
  for (const id of WEAPON_IDS) { const d = WEAPONS[id]; const k = d && (d.model || id); if (k && M.MODEL_KEYS.includes(k) && !keys.has(k)) keys.set(k, d); }
  for (const k of [...M.GUN_KEYS, ...M.MELEE_KEYS]) if (!keys.has(k)) keys.set(k, null);
  const out = [];
  let builds = 0;
  const check = (key, att) => {
    let root;
    try { root = M.createWeaponModel(key, { lod: 'first', att }); } catch (e) { out.push({ key, att, error: String(e.message || e) }); return; }
    builds++;
    root.updateMatrixWorld(true);
    const items = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === 'rounds' || o.name === 'follower') return;
      let hidden = false;
      for (let p = o; p; p = p.parent) if (p.visible === false) { hidden = true; break; }
      if (hidden) return;
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) return;
      items.push({ o, box: box.expandByScalar(GAP), name: o.name || (o.material && o.material.name) || '?', parent: o.parent && o.parent.name });
    });
    // Zusammenhang über berührende Hüllquader (Union-Find)
    const up = items.map((_, i) => i);
    const find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (items[i].box.intersectsBox(items[j].box)) up[find(i)] = find(j);
    const groups = new Map();
    items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
    const list = [...groups.values()].sort((a, b) => b.length - a.length);
    for (const g of list.slice(1)) {
      const box = new THREE.Box3();
      for (const it of g) box.union(it.box);
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      // Abstand zum Hauptteil
      let gap = Infinity;
      for (const it of g) for (const m of list[0]) gap = Math.min(gap, it.box.distanceToPoint(m.box.getCenter(new THREE.Vector3())) - m.box.getSize(new THREE.Vector3()).length() / 2);
      out.push({ key, att, n: g.length, names: [...new Set(g.map((it) => `${it.name}@${it.parent || ''}`))].slice(0, 4), at: c.toArray().map((x) => +x.toFixed(3)), size: s.toArray().map((x) => +x.toFixed(3)) });
    }
  };
  for (const [key, def] of keys) {
    check(key, null);
    if (!def) continue;
    let info = null;
    try { info = M.getWeaponModelInfo(key); } catch { /* */ }
    const opts = A.attachmentsFor(def, info);
    for (const [slot, ids] of Object.entries(opts)) for (const id of ids) check(key, { [slot]: id });
  }
  return { builds, models: keys.size, out };
});
await browser.close();

const real = res.out;
console.log(`${res.models} Modelle, ${res.builds} Bauvarianten geprüft`);
for (const f of real) {
  const att = f.att ? Object.entries(f.att).map(([k, v]) => `${k}:${v}`).join(',') : 'Werk';
  if (f.error) console.log(`FEHL ${f.key} [${att}] Baufehler: ${f.error}`);
  else console.log(`FEHL ${f.key} [${att}] ${f.n} Teil(e) frei: ${f.names.join(' | ')} bei ${f.at.join('/')} (Größe ${f.size.join('×')})`);
}
if (errors.length) console.log(`Seitenfehler: ${errors.slice(0, 3).join(' | ')}`);
console.log(real.length || errors.length ? `${real.length} Befunde` : 'Keine schwebenden Teile gefunden');
if (VERBOSE) console.log(JSON.stringify(real, null, 1));
process.exit(real.length || errors.length ? 1 : 0);
