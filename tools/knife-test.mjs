// Kurztest „Nur Messer“: Match startet, alle Akteure tragen nur das Messer, keine Granaten, Bots erzielen Abschüsse.
import { chromium, BASE, GL_ARGS } from './pw.mjs';
const browser = await chromium.launch({ args: GL_ARGS });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|404/.test(m.text())) errors.push(m.text()); });
let fail = 0;
const check = (ok, t) => { console.log((ok ? 'OK   ' : 'FEHL ') + t); if (!ok) fail++; };
await page.goto(`${BASE}spielen.html?autostart=1&mode=messer&map=werk&quality=low`);
await page.waitForFunction(() => window.__game && window.__game.match && window.__game.match.state === 'playing', null, { timeout: 600000 });
check(true, 'Match „Nur Messer“ läuft');
const info = () => page.evaluate(() => {
  const G = window.__game;
  return {
    mode: G.mode && (G.mode.modeId || G.mode.id || (G.mode.def && G.mode.def.id)), lock: !!(G.mode && G.mode.lockLoadout),
    actors: G.actors.map((a) => {
      const w = a.weapon;
      const slots = w && w.slots ? w.slots.map((s) => s.def && s.def.id) : [];
      const eq = w && w.equipment ? [w.equipment.lethal && w.equipment.lethal.id, w.equipment.tactical && w.equipment.tactical.id] : [];
      return { p: !!a.isPlayer, team: a.team, slots, eq, cur: w && w.currentDef && w.currentDef.id };
    }),
    scores: G.mode && G.mode.scores, kills: G.actors.reduce((n, a) => n + ((a.stats && a.stats.kills) || 0), 0),
  };
});
let i = await info();
check(i.mode === 'messer' && i.lock, `Modus messer, Ausrüstung gesperrt (${i.mode}, ${i.lock})`);
const bad = i.actors.filter((a) => a.slots.some((s) => s !== 'knife') || a.eq.some(Boolean));
check(i.actors.length > 2 && bad.length === 0, `alle ${i.actors.length} Akteure nur Messer, keine Granaten${bad.length ? ': ' + JSON.stringify(bad.slice(0, 3)) : ''}`);
// Zeitraffer ×4: Messer brauchen seit 10.10. zwei Stiche, SwiftShader unter Last läuft mit ~1 Bild/s
await page.evaluate(() => { window.__game.timeScale = 4; });
for (let t = 0; t < 30 && i.kills < 2; t++) { await page.waitForTimeout(10000); i = await info(); }
check(i.kills >= 2, `Abschüsse im Match: ${i.kills} (Teams ${JSON.stringify(i.scores)})`);
const bad2 = i.actors.filter((a) => a.slots.some((s) => s !== 'knife') || a.eq.some(Boolean));
check(bad2.length === 0, 'nach Wiedereinstiegen weiterhin nur Messer');
await page.screenshot({ path: 'tools/out/knife-mode.png' });
check(errors.length === 0, `keine Seitenfehler ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(fail ? `${fail} Fehler` : 'Alle Prüfungen bestanden');
process.exit(fail ? 1 : 0);
