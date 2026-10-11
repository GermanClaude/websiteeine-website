// NULLPUNKT – Zerstörung: zerstörbare Wandpaneele (Werk: Betonwände der Tank-Auffangwannen) brechen nach Explosionen
// heraus (Kugel/Kollision gehen danach durch), Autos sind Fahrzeugblech (Gewehrkugel geht durch). Aufruf: node tools/destruction-test.mjs
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
async function open(map) {
  const p = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
  p.on('pageerror', (e) => errors.push(`${map}: ${e.message}`));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=${map}&allies=0&enemies=0&quality=low`);
  for (let i = 0; i < 400; i++) { const ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive); }).catch(() => false); if (ok) break; await sleep(1000); }
  return p;
}
try {
  const p = await open('werk');
  const r = await p.evaluate(() => {
    const G = window.__game, D = G.destruction, T = G.THREE;
    if (!D || !D.panels.length) return { n: D ? D.panels.length : -1 };
    const pn = D.panels[0];
    const n = new T.Vector3(Math.sin(pn.d.ry), 0, Math.cos(pn.d.ry));
    const from = pn.center.clone().addScaledVector(n, 2), dir = n.clone().negate();
    const before = G.world.raycast(from, dir, 6);
    // drei Granaten direkt davor
    for (let i = 0; i < 3 && pn.alive; i++) G.combat.explode({ position: pn.center.clone().addScaledVector(n, 0.8), radius: 6, maxDamage: 150, type: 'frag' });
    const after = G.world.raycast(from, dir, 6);
    return { n: D.panels.length, broken: D.broken, alive: pn.alive, before: before ? +before.distance.toFixed(2) : null, after: after ? +after.distance.toFixed(2) : null };
  });
  check(r.n > 10, `Werk: ${r.n} zerstörbare Paneele`);
  check(r.alive === false && r.broken >= 1, `Paneel nach Explosionen herausgebrochen (${r.broken} gebrochen)`);
  check(r.before != null && r.before < 2.3 && (r.after == null || r.after > 2.3), `Strahl ging vorher an die Wand (${r.before} m), jetzt hindurch (${r.after} m)`);
  await p.screenshot({ path: 'tools/out/destruction-werk.png' }).catch(() => {});
  await p.context().close();
  const h = await open('hafen');
  const c = await h.evaluate(() => {
    const G = window.__game, T = G.THREE;
    // ein Auto finden: Fußabdrücke 'vehicle' der Minikarte, Strahl quer durch
    const fp = G.world.debugData.footprints.filter((f) => f.kind === 'vehicle' && f.hw < 1.2 && f.hd > 1.8);
    for (const f of fp) {
      const side = new T.Vector3(Math.cos(f.ry), 0, -Math.sin(f.ry));
      const from = new T.Vector3(f.x, (f.y0 || 0) + 0.8, f.z).addScaledVector(side, 3), dir = side.clone().negate();
      const hit = G.world.raycast(from, dir, 6);
      if (!hit || hit.surface !== 'vehicle') continue;
      const W = G.data.WEAPONS.ar_m17, P = G.data.WEAPONS.pi_p9;
      return { surface: hit.surface, rifle: !!G.combat._penetrate(hit, dir, W.penetration, W), pistol: !!G.combat._penetrate(hit, dir, P.penetration, P) };
    }
    return { surface: null, n: fp.length };
  });
  check(c.surface === 'vehicle' && c.rifle, `Auto: Fahrzeugblech, Gewehrkugel geht durch (${JSON.stringify(c)})`);
  await h.context().close();
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
