// NULLPUNKT – verformbare Autos (Hafen): Kugeltreffer auf Autolack drückt eine Delle ein, eine Granate knautscht die
// Karosserie; Verschiebung begrenzt. Bilder tools/out/deform-vorher.png / -nachher.png. Aufruf: node tools/deform-test.mjs
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? r() : setTimeout(f, 50)); f(); }); }, s);
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=0&enemies=0&quality=low`);
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive && G.deform); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Hafen geladen, Verformung aktiv');
  const r0 = await p.evaluate(() => {
    const G = window.__game, T = G.THREE, D = G.deform, P = G.player;
    G.input.allowUnlockedMouse = true;
    const m = D.statics[0];
    m.updateWorldMatrix(true, false);
    const a = m.geometry.attributes.position.array;
    // frei sichtbare Seitenfläche eines Autos (Dreieck mit waagrechter Normale, Blick aus 4 m nicht verdeckt)
    let v, n, eye;
    for (let i = 0; i + 8 < a.length; i += 9 * 37) {
      const c = new T.Vector3(a[i], a[i + 1], a[i + 2]).add(new T.Vector3(a[i + 3], a[i + 4], a[i + 5])).add(new T.Vector3(a[i + 6], a[i + 7], a[i + 8])).multiplyScalar(1 / 3).applyMatrix4(m.matrixWorld);
      const e1 = new T.Vector3(a[i + 3] - a[i], a[i + 4] - a[i + 1], a[i + 5] - a[i + 2]), e2 = new T.Vector3(a[i + 6] - a[i], a[i + 7] - a[i + 1], a[i + 8] - a[i + 2]);
      const nn = e1.cross(e2).normalize().transformDirection(m.matrixWorld);
      if (Math.abs(nn.y) > 0.3 || c.y < 0.5) continue;
      const ey = c.clone().addScaledVector(new T.Vector3(nn.x, 0, nn.z).normalize(), 4);
      const gy = G.world.groundHeight(ey.x, ey.z, ey.y + 3);
      if (!Number.isFinite(gy) || Math.abs(gy - (c.y - 1)) > 1.5) continue;
      const from = new T.Vector3(ey.x, gy + 1.6, ey.z), dir = c.clone().sub(from), dist = dir.length();
      const h = G.world.raycast(from, dir.normalize(), dist + 0.5);
      if (h && Math.abs(h.distance - dist) < 0.15) { v = c; n = nn; eye = ey; break; }
    }
    if (!v) return { statics: D.statics.length, verts: a.length / 3, none: true };
    window.__dt = { v, n };
    const gy = G.world.groundHeight(eye.x, eye.z, eye.y + 3);
    P.body.teleport(new T.Vector3(eye.x, gy + 0.05, eye.z));
    P.yaw = Math.atan2(-(v.x - eye.x), -(v.z - eye.z)); P.pitch = Math.atan2(v.y - (gy + 1.6), 4);
    return { statics: D.statics.length, verts: a.length / 3 };
  });
  check(r0.statics >= 1 && !r0.none, `Autolack-Meshes: ${r0.statics} (${r0.verts} Punkte), sichtbare Seite gefunden`);
  await gameWait(p, 0.8);
  await p.screenshot({ path: 'tools/out/deform-vorher.png' });
  const r1 = await p.evaluate(() => {
    const G = window.__game, D = G.deform, { v, n } = window.__dt;
    const t = new G.THREE.Vector3(0, 1, 0).cross(n); if (t.lengthSq() < 0.01) t.set(1, 0, 0); t.normalize();
    const b = n.clone().cross(t).normalize();
    for (let i = 0; i < 6; i++) G.events.emit('impact', { point: v.clone().addScaledVector(t, ((i % 3) - 1) * 0.08).addScaledVector(b, (Math.floor(i / 3) - 0.5) * 0.08), normal: n.clone(), surface: 'vehicle', weaponId: 'ar_m17' });
    const m = D.statics[0], a = m.geometry.attributes.position.array, o = m.userData.deform.orig;
    let max = 0; for (let i = 0; i < a.length; i += 3) max = Math.max(max, Math.hypot(a[i] - o[i], a[i + 1] - o[i + 1], a[i + 2] - o[i + 2]));
    return { dents: D.dents, verts: a.length / 3, max };
  });
  check(r1.dents >= 6 && r1.max > 0.02 && r1.max < 0.2, `Kugeldellen: ${r1.dents}, tiefste ${(r1.max * 100).toFixed(1)} cm, ${r1.verts} Punkte nach Unterteilung`);
  const r2 = await p.evaluate(() => {
    const G = window.__game, D = G.deform, { v, n } = window.__dt;
    G.events.emit('explosion', { position: v.clone().addScaledVector(n, 0.8).setY(v.y - 0.3), radius: 6, type: 'frag', weaponId: 'frag', nonLethal: false });
    const m = D.statics[0], a = m.geometry.attributes.position.array, o = m.userData.deform.orig;
    let max = 0, moved = 0; for (let i = 0; i < a.length; i += 3) { const s = Math.hypot(a[i] - o[i], a[i + 1] - o[i + 1], a[i + 2] - o[i + 2]); max = Math.max(max, s); if (s > 0.05) moved++; }
    return { max, moved };
  });
  check(r2.max > 0.15 && r2.max <= 0.381 && r2.moved > 50, `Granate knautscht: ${r2.moved} Punkte > 5 cm, max ${(r2.max * 100).toFixed(0)} cm (Grenze 38)`);
  await gameWait(p, 0.8);
  await p.screenshot({ path: 'tools/out/deform-nachher.png' });
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
