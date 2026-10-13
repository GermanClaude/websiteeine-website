// NULLPUNKT – Laufbohrung an jeder Mündung (Nutzer 13.10.2026: „man sollte eine Mündung haben und darin ein schwarzes
// Loch“ – bei einer Waffe war vorne kein Schussloch). Baut jede Schusswaffe (Ego-Detailstufe) ohne Aufsatz und mit jedem
// Mündungsgerät, schießt vom Mündungsanker aus Strahlen von vorn auf die Waffe (Mitte und 4 Punkte auf 1,4 mm Radius)
// und verlangt, dass jeder Strahl zuerst die schwarze Bohrung trifft (Material „cavity“).
// Voraussetzung: Server auf 8765. Aufruf: node tools/muzzle-bore-test.mjs [--verbose]
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const VERBOSE = process.argv.includes('--verbose');
const browser = await chromium.launch({ args: GL_ARGS });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}spielen.html`, { waitUntil: 'load' });

const res = await page.evaluate(async () => {
  const M = await import('/assets/js/game/weapons/models.js');
  const THREE = await import('three');
  // Werfer schießen Raketen/Granaten aus eigenen Rohren (eigene Prüfung im Modell), Revolver-Trommel ist kein Lauf
  const SKIP = new Set(['donner', 'hammer', 'trommel']);
  const out = [];
  const rc = new THREE.Raycaster();
  for (const key of M.GUN_KEYS) {
    if (SKIP.has(key)) continue;
    for (const muendung of [null, 'daempfer', 'kompensator', 'bremse', 'feuerdaempfer']) {
      const root = M.createWeaponModel(key, { lod: 'first', att: muendung ? { muendung } : null });
      root.updateMatrixWorld(true);
      const mz = root.userData.muzzle;
      const meshes = [];
      root.traverse((o) => { if (o.isMesh && o.visible) { meshes.push(o); o.material = [].concat(o.material).map((m) => { const c = m.clone(); c.side = THREE.DoubleSide; c.name = m.name; return c; })[0]; } });
      const p = mz.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(0, 0, -1).transformDirection(root.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
      const offs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
      const fails = [];
      for (const [a, b] of offs) {
        const o = p.clone().addScaledVector(fwd, 0.08).addScaledVector(side, a * 0.0014).addScaledVector(up, b * 0.0014);
        rc.set(o, fwd.clone().negate());
        rc.far = 0.2;
        const hit = rc.intersectObjects(meshes, false)[0];
        const name = hit ? String(hit.object.material.name || hit.object.name) : 'nichts';
        if (!/cavity/.test(name)) fails.push(`${a},${b}:${name}${hit ? '@' + (hit.distance - 0.08).toFixed(3) : ''}`);
      }
      if (fails.length) out.push({ key, muendung, fails });
    }
  }
  return out;
});

let bad = 0;
const seen = new Set();
for (const r of res) {
  bad++;
  if (VERBOSE || !seen.has(r.key)) console.log(`FEHLT ${r.key}${r.muendung ? ' + ' + r.muendung : ''}: ${r.fails.join(' | ')}`);
  seen.add(r.key);
}
for (const e of errors) console.log('Seitenfehler:', e);
console.log(bad ? `${bad} Varianten ohne sichtbare Bohrung (${seen.size} Modelle)` : 'Alle Mündungen haben eine Bohrung');
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
