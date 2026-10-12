// NULLPUNKT – Geheimnis „Clawd“ (Hafen, Obergeschoss-Büro in Lagerhalle 3): Figur vorhanden, nicht durch die Decke oder
// im Vorbeigehen mit abgewandtem Blick gefunden, beim Ansehen gefunden (secret:found, HUD-Hinweis, Profil), hüpft dann.
// Bilder tools/out/clawd-nah.png, tools/out/clawd-raum.png. Aufruf: node tools/clawd-test.mjs [quality]
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t, v = '') => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}${v !== '' ? ` → ${v}` : ''}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 60000 ? r() : setTimeout(f, 50)); f(); }); }, s);
const quality = process.argv[2] || 'medium';
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=0&enemies=0&quality=${quality}`);
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive && G.world); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Hafen geladen');
  const info = await p.evaluate(() => {
    const G = window.__game, c = G.scene.getObjectByName('clawd');
    window.__sf = [];
    G.events.on('secret:found', (e) => window.__sf.push(e.id));
    G.input.allowUnlockedMouse = true;
    if (!c) return null;
    let tris = 0; c.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const p = c.getWorldPosition(new G.THREE.Vector3());
    return { x: p.x, y: p.y, z: p.z, tris };
  });
  check(!!info, 'Clawd steht in der Szene', info ? `(${info.x.toFixed(2)}, ${info.y.toFixed(2)}, ${info.z.toFixed(2)}), ${info.tris} Dreiecke` : '');
  check(info && info.tris <= 200, 'Wenige Dreiecke (≤ 200)');
  // Spieler hinstellen und auf einen Punkt blicken lassen
  const place = (x, y, z, lx, ly, lz) => p.evaluate(([x, y, z, lx, ly, lz]) => {
    const G = window.__game, T = G.THREE, P = G.player;
    P.body.teleport(new T.Vector3(x, y, z));
    if (P.velocity) P.velocity.set(0, 0, 0);
    const eye = y + 1.6;
    P.yaw = Math.atan2(-(lx - x), -(lz - z)); P.pitch = Math.atan2(ly - eye, Math.hypot(lx - x, lz - z));
  }, [x, y, z, lx, ly, lz]);
  const found = () => p.evaluate(() => window.__sf.includes('hafen-clawd'));
  const fy = 3.62, cy = info ? info.y + 0.1 : 4.5;
  // 1) Erdgeschoss direkt darunter, Blick nach oben: nicht gefunden (andere Ebene)
  await place(35.0, 0.14, -16.6, info.x, cy, info.z);
  await gameWait(p, 0.6);
  check(!(await found()), 'Vom Erdgeschoss durch die Decke: nicht gefunden');
  // 2) Obergeschoss, 3 m entfernt, Blick weg: nicht gefunden
  await place(36.5, fy, -15.2, 36.5, 1.6 + fy, -10);
  await gameWait(p, 0.6);
  check(!(await found()), 'Oben in 3 m mit abgewandtem Blick: nicht gefunden');
  // 3) Obergeschoss, Blick auf Clawd: gefunden, Hinweis, Profil
  await place(35.3, fy, -15.4, info.x, cy, info.z);
  await gameWait(p, 0.3);
  check(await found(), 'Angesehen: Geheimnis gefunden (secret:found)');
  await gameWait(p, 0.2);
  const toast = await p.evaluate(() => document.body.textContent.includes('Geheimnis gefunden: Clawd'));
  check(toast, 'HUD-Hinweis „Geheimnis gefunden: Clawd“');
  const prof = await p.evaluate(() => { try { return JSON.stringify(localStorage).includes('hafen-clawd'); } catch { return false; } });
  check(prof, 'Im Profil gespeichert');
  const hop = await p.evaluate(() => window.__game.scene.getObjectByName('clawd').children[0].position.y);
  check(hop > 0.001, 'Clawd hüpft beim Fund', hop.toFixed(3));
  await p.screenshot({ path: 'tools/out/clawd-raum.png', timeout: 180000 });
  // Nahaufnahme (in die Hocke, 0,8 m davor)
  await place(info.x + 0.25, fy, info.z + 0.85, info.x, info.y + 0.08, info.z);
  await p.evaluate(() => { const P = window.__game.player; if ('crouch' in P) P.crouch = true; });
  await gameWait(p, 2.5);
  await p.screenshot({ path: 'tools/out/clawd-nah.png', timeout: 180000 });
  // Einmal pro Runde: erneutes Ansehen meldet nicht noch einmal
  await place(35.3, fy, -15.4, info.x, cy, info.z);
  await gameWait(p, 0.5);
  check(await p.evaluate(() => window.__sf.filter((id) => id === 'hafen-clawd').length === 1), 'Nur einmal pro Runde gemeldet');
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
  console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
  process.exit(fail ? 1 : 0);
}
