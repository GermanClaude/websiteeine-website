// NULLPUNKT – Fenster (Altstadt): Glasfenster der Häuser sind beweglich (F öffnet/schließt), eine Kugel, ein Messerhieb
// oder eine Explosion zerbricht die Scheibe (Flügel weg, Kollision frei). Bilder tools/out/window-*.png.
// Aufruf: node tools/window-test.mjs   (Server NP_BASE)
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
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=altstadt&allies=0&enemies=0&quality=low`);
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive && G.doors); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Altstadt geladen');
  // Erdgeschoss-Fenster mit freiem Platz davor suchen, Spieler 1,1 m davor (außen), Blick auf die Scheibe
  const r0 = await p.evaluate(() => {
    const G = window.__game, T = G.THREE, D = G.doors, P = G.player;
    G.input.allowUnlockedMouse = true;
    const wins = D.items.map((it, i) => ({ it, i })).filter((o) => o.it.type === 'window');
    const picks = [];
    for (const { it, i } of wins) {
      const d = it.d, cx = d.hx + d.dc[0] * d.w / 2, cz = d.hz + d.dc[1] * d.w / 2;
      const ox = cx - d.dopen[0] * 1.1, oz = cz - d.dopen[1] * 1.1;
      const gy = G.world.groundHeight(ox, oz, d.y + 1);
      if (!Number.isFinite(gy) || Math.abs(d.y - gy - 0.97) > 0.25) continue;
      picks.push({ i, ox, oz, gy, cx, cz, cy: d.y + d.h / 2 });
      if (picks.length >= 3) break;
    }
    window.__wt = picks;
    if (!picks.length) return { n: wins.length, picks: 0 };
    const k = picks[0];
    P.body.teleport(new T.Vector3(k.ox, k.gy + 0.05, k.oz));
    P.yaw = Math.atan2(-(k.cx - k.ox), -(k.cz - k.oz)); P.pitch = -0.05;
    return { n: wins.length, picks: picks.length, drawCalls: G.renderer && G.renderer.renderer ? G.renderer.renderer.info.render.calls : null };
  });
  check(r0.n >= 100, `${r0.n} Glasfenster auf Altstadt`);
  check(r0.picks >= 3, `${r0.picks} Erdgeschoss-Fenster mit Platz davor gefunden`);
  await gameWait(p, 0.8);
  await p.screenshot({ path: 'tools/out/window-zu.png' });
  // F: Hinweis + öffnen
  const r1 = await p.evaluate(() => { const G = window.__game, D = G.doors, k = window.__wt[0]; return { near: D.near && D.near.i === k.i ? D.near.text : D.near && D.near.text }; });
  check(r1.near === 'Fenster öffnen', `Hinweis „${r1.near}“`);
  await p.evaluate(() => { const G = window.__game; G.doors.request(window.__wt[0].i, 't'); });
  await gameWait(p, 1.0);
  const r2 = await p.evaluate(() => { const G = window.__game, it = G.doors.items[window.__wt[0].i]; return { t: it.t, text: G.doors.near && G.doors.near.text }; });
  check(r2.t === 1 && r2.text === 'Fenster schließen', `Fenster offen (t ${r2.t}, „${r2.text}“)`);
  await p.screenshot({ path: 'tools/out/window-offen.png' });
  await p.evaluate(() => { const G = window.__game; G.doors.request(window.__wt[0].i, 't'); });
  await gameWait(p, 1.0);
  // Schuss: Strahl vom Auge trifft die Scheibe (Oberfläche Glas, Festkörper des Fensters) → onHit wie combat.js
  const r3 = await p.evaluate(() => {
    const G = window.__game, T = G.THREE, D = G.doors, k = window.__wt[0], it = D.items[k.i];
    const eye = new T.Vector3(k.ox, k.gy + 1.6, k.oz), dir = new T.Vector3(k.cx, k.cy, k.cz).sub(eye).normalize();
    const h = G.world.raycast(eye, dir, 5);
    const hitsPane = !!(h && h.surface === 'glass' && h.solid === it.solid);
    if (h && h.solid && typeof h.solid.onHit === 'function') h.solid.onHit(25, G.player, G.data.WEAPONS.ar_m17);
    const h2 = G.world.raycast(eye, dir, 5);
    return { hitsPane, broken: it.broken, inSolids: G.building.extra.includes(it.solid), after: h2 ? h2.surface : 'frei' };
  });
  check(r3.hitsPane, 'Kugelstrahl trifft die Scheibe (Glas)');
  check(r3.broken && !r3.inSolids && r3.after !== 'glass', `Schuss zerbricht die Scheibe (danach: ${r3.after})`);
  await gameWait(p, 0.6);
  await p.screenshot({ path: 'tools/out/window-kaputt.png' });
  // Messer gegen das zweite, Granate gegen das dritte Fenster
  const r4 = await p.evaluate(() => {
    const G = window.__game, T = G.THREE, D = G.doors, [, a, b] = window.__wt;
    G.events.emit('impact', { point: new T.Vector3(a.cx, a.cy, a.cz), normal: new T.Vector3(0, 0, 1), surface: 'glass', shooter: G.player, weaponId: 'knife', melee: true });
    G.events.emit('explosion', { position: new T.Vector3(b.ox, b.gy + 0.3, b.oz), radius: 5, type: 'frag', weaponId: 'frag', attacker: G.player });
    return { knife: D.items[a.i].broken, frag: D.items[b.i].broken };
  });
  check(r4.knife, 'Messerhieb zerbricht eine Scheibe');
  check(r4.frag, 'Granate zerbricht eine Scheibe');
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
