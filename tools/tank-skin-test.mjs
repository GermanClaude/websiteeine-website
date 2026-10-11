// NULLPUNKT – Panzer-Tarnungen (Nutzer 11.10.): Erfahrung im Panzer, Freischalten, gewählte Tarnung färbt die Fahrzeuge
// des eigenen Teams, Lobby-Auswahl mit gesperrten Tarnungen. Aufruf: node tools/tank-skin-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('np-skin-init')) { localStorage.setItem('nullpunkt.panzer', JSON.stringify({ xp: 140, skin: 'wald' })); sessionStorage.setItem('np-skin-init', '1'); } } catch { /* */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&allies=0&enemies=0&quality=medium&mode=tdm&map=hafen&vehicles=1`);
  let ok = false;
  for (let i = 0; i < 500 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.vehicles && G.vehicles.list.length && G.player.team); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Hafen mit Fahrzeugen');
  await sleep(1500);
  let r = await p.evaluate(async () => {
    const G = window.__game, M = await import('/assets/js/game/vehicles/materials.js'), S = M.vehicleMaterials();
    const own = G.player.team, other = own === 'A' ? 'B' : 'A';
    return { own: S.paint[own].color.getHex(), other: S.paint[other].color.getHex(), team: own };
  });
  check(r.own === 0x4b5a35 && r.other !== 0x4b5a35, `eigenes Team (${r.team}) im Waldtarn, Gegner im Standardlack`);
  // Erfahrung: im Panzer sitzen + Fahrzeug zerstören → Wüstensand (150) freigeschaltet
  r = await p.evaluate(async () => {
    const G = window.__game, V = G.vehicles, P = G.player;
    const own = V.list.find((v) => v.def.drive === 'tracked' && v.spawnTeam === P.team) || V.list.find((v) => v.def.drive === 'tracked');
    const foe = V.list.find((v) => v !== own);
    const notes = [];
    G.events.on('injury:notice', (e) => notes.push(e.text));
    V.enter(P, own, 0);
    const x0 = V.tankProgress.p.xp;
    const t0 = G.time.elapsed; while (G.time.elapsed < t0 + 3) await new Promise((res) => setTimeout(res, 50));
    const x1 = V.tankProgress.p.xp;
    G.events.emit('vehicle:destroyed', { vehicle: { team: P.team === 'A' ? 'B' : 'A' }, by: P, weaponId: 'mbt_ap' });
    void foe;
    return { x0, x1, x2: V.tankProgress.p.xp, notes };
  });
  check(r.x1 > r.x0, `Erfahrung im Panzer ${r.x0.toFixed(1)} → ${r.x1.toFixed(1)}`);
  check(r.x2 >= 150 && r.notes.some((t) => /Wüstensand/.test(t)), `Fahrzeug zerstört → ${r.x2.toFixed(0)}, „${r.notes.join(' | ')}“`);
  await p.evaluate(() => window.__game.vehicles.tankProgress.dispose());
  // Lobby: Auswahl mit Sperren
  await p.goto(`${BASE}spielen.html`);
  await p.waitForFunction(() => document.querySelector('[data-tskin]'), null, { timeout: 120000 }).catch(() => null);
  r = await p.evaluate(() => {
    const b = [...document.querySelectorAll('[data-tskin]')];
    const locked = b.filter((x) => x.getAttribute('aria-disabled') === 'true').length;
    const w = document.querySelector('[data-tskin="wueste"]'); if (w) w.click();
    return { n: b.length, locked };
  });
  await sleep(300);
  const sel = await p.evaluate(() => { const b = document.querySelector('[data-tskin="wueste"]'); return { on: b && b.getAttribute('aria-checked'), saved: JSON.parse(localStorage.getItem('nullpunkt.panzer') || '{}').skin }; });
  check(r.n === 8 && r.locked >= 4 && sel.on === 'true' && sel.saved === 'wueste', `Lobby: ${r.n} Tarnungen, ${r.locked} gesperrt, Wüstensand gewählt (${sel.saved})`);
  await p.evaluate(() => { const el = document.querySelector('[data-tskin]'); if (el) el.scrollIntoView(); });
  await p.screenshot({ path: 'tools/out/tank-skin-lobby.png' });
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
