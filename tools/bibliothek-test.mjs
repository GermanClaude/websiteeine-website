// NULLPUNKT – Bibliothek: lädt die Karte, prüft Startpunkte (frei, am Boden), läuft alle vier Treppen zur Galerie hoch
// (Taste W) und über eine Brücke, prüft die Minikarte (Regale sichtbar, kein Dach darüber).
// Aufruf: node tools/bibliothek-test.mjs [--layout]   (Server NP_BASE; --layout schreibt tools/out/bibliothek-layout.json)
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s`;
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ts()} ${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };

const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && /NULLPUNKT/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=bibliothek&allies=0&enemies=0&quality=low`);
  let ok = false;
  for (let i = 0; i < 400 && !ok && !errors.length; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Bibliothek geladen, Match läuft');
  await p.evaluate(() => { const G = window.__game; G.player.godMode = true; G.input.allowUnlockedMouse = true; });
  // Startpunkte: am Boden und frei
  const sp = await p.evaluate(() => {
    const G = window.__game, T = G.THREE, W = G.world, bad = [];
    const sp = W.spawns || (W.def && W.def.spawns) || G.match.spawns || {};
    let n = 0;
    for (const k of Object.keys(sp)) for (const s0 of sp[k] || []) {
      n++;
      const s = s0.position || s0;
      const gy = W.groundHeight(s.x, s.z, 3);
      let blocked = false;
      for (let a = 0; a < 8; a++) { const d = new T.Vector3(Math.sin(a * 0.785), 0, Math.cos(a * 0.785)); if (W.raycast(new T.Vector3(s.x, 1, s.z), d, 0.45)) blocked = true; }
      if (gy == null || gy > 0.3 || blocked) bad.push(`${k}(${s.x},${s.z}) gy=${gy && gy.toFixed(2)}${blocked ? ' eng' : ''}`);
    }
    return { n, bad };
  });
  check(sp.n > 30 && !sp.bad.length, `Startpunkte frei und am Boden (${sp.n}${sp.bad.length ? ': ' + sp.bad.join(', ') : ''})`);
  // Treppen hochlaufen
  const climb = async (x, z, yaw, label) => {
    await p.evaluate(([x, z, yaw]) => { const G = window.__game, P = G.player; P.body.position.set(x, 0.1, z); if (P.body.velocity) P.body.velocity.set(0, 0, 0); P.yaw = yaw; P.pitch = 0; }, [x, z, yaw]);
    await p.keyboard.down('KeyW');
    const t0 = Date.now();
    let r = null;
    while (Date.now() - t0 < 90000) {
      r = await p.evaluate(() => { const P = window.__game.player.body.position; return { x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), t: window.__game.time.elapsed }; });
      if (r.y > 4.2 && Math.abs(r.x) > 34) break;
      await sleep(400);
    }
    await p.keyboard.up('KeyW');
    check(r && r.y > 4.2 && Math.abs(r.x) > 34, `Treppe ${label}: oben auf der Galerie (${JSON.stringify(r)})`);
  };
  await climb(24.5, 21.2, -Math.PI / 2, 'NO');
  await climb(24.5, -21.2, -Math.PI / 2, 'SO');
  await climb(-24.5, 21.2, Math.PI / 2, 'NW');
  await climb(-24.5, -21.2, Math.PI / 2, 'SW');
  // über die Brücke z=11 quer über den Mittelgang
  await p.evaluate(() => { const G = window.__game, P = G.player; P.body.position.set(-16, 4.5, 11); if (P.body.velocity) P.body.velocity.set(0, 0, 0); P.yaw = -Math.PI / 2; });
  await p.keyboard.down('KeyW');
  let br = null; const t1 = Date.now();
  while (Date.now() - t1 < 200000) { br = await p.evaluate(() => { const P = window.__game.player.body.position; return { x: +P.x.toFixed(1), y: +P.y.toFixed(2), z: +P.z.toFixed(1) }; }); if (br.x > 16 || br.y < 3.5) break; await sleep(500); }
  await p.keyboard.up('KeyW');
  check(br && br.x > 16 && br.y > 4.2, `Brücke überquert (${JSON.stringify(br)})`);
  // Minikarte: Regale als Wände da, kein Dach-Fußabdruck über der Halle
  const mm = await p.evaluate(() => {
    const f = window.__game.world.debugData.footprints;
    return { walls: f.filter((x) => x.kind === 'wall' && x.y0 < 1).length, roof: f.filter((x) => (x.kind === 'roof' || x.kind === 'building') && x.hw > 20).length };
  });
  check(mm.walls > 40 && mm.roof === 0, `Minikarte: ${mm.walls} Wände/Regale, ${mm.roof} Dachflächen darüber`);
  if (process.argv.includes('--layout')) {
    const lay = await p.evaluate(() => {
      const out = [];
      for (const f of window.__game.world.debugData.footprints) {
        if (!['building', 'container', 'cover', 'wall', 'catwalk', 'stairs', 'pillar'].includes(f.kind)) continue;
        let w = f.hw * 2, d = f.hd * 2;
        if (w * d < 0.8 && f.kind !== 'pillar') continue;
        let r = ((f.ry % Math.PI) + Math.PI) % Math.PI;
        if (Math.abs(r - Math.PI / 2) < 0.01) { [w, d] = [d, w]; r = 0; }
        if (r > Math.PI / 2) r -= Math.PI;
        const row = [+f.x.toFixed(1), +f.z.toFixed(1), +w.toFixed(1), +d.toFixed(1), f.kind === 'pillar' ? 'cover' : f.kind];
        if (Math.abs(r) > 0.01) row.push(+(-r).toFixed(2));
        out.push(row);
      }
      return out;
    });
    mkdirSync('tools/out', { recursive: true });
    writeFileSync('tools/out/bibliothek-layout.json', JSON.stringify(lay));
    console.log(`Layout: ${lay.length} Einträge → tools/out/bibliothek-layout.json`);
  }
  await p.evaluate(() => { const G = window.__game, P = G.player; P.body.position.set(0, 0.1, 19); P.yaw = 0; P.pitch = -0.05; });
  await sleep(2500);
  await p.screenshot({ path: 'tools/out/bibliothek.png' }).catch(() => {});
} catch (err) {
  console.log('FEHL Abbruch:', (err && err.stack) || err);
  fail++;
} finally {
  await browser.close();
}
check(!errors.length, `keine Seitenfehler${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
