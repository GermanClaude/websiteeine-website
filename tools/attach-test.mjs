// NULLPUNKT – Aufsätze: gespeicherte Auswahl (localStorage) wirkt im Match auf Werte (Magazin, Dämpfer, Optik, Rückstoß)
// und Modell (Optik-Art, Vordergriff mit Griffart 'post', Schalldämpfer verlängert die Mündung); Zielen durch die neue Optik
// (Bild tools/out/attach-ads.png). Aufruf: node tools/attach-test.mjs   (Server NP_BASE)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0, count = 0;
const check = (ok, t) => { count++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${t}`); if (!ok) fail++; return ok; };
const gameWait = (p, s) => p.evaluate((sec) => { const G = window.__game; const t = G.time.elapsed + sec; const r0 = performance.now(); return new Promise((r) => { const f = () => (G.time.elapsed >= t || performance.now() - r0 > 240000 ? r() : setTimeout(f, 50)); f(); }); }, s);
const ATT = {
  ar_m17: { optik: 'acog', muendung: 'daempfer', unterlauf: 'griff', taktisch: 'laser', magazin: 'erweitert', munition: 'hohlspitz' },
  pi_p9: { muendung: 'daempfer', magazin: 'erweitert' },
};
const browser = await chromium.launch({ args: GL_ARGS });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript((a) => { try { localStorage.setItem('nullpunkt.aufsaetze', a); } catch { /* */ } }, JSON.stringify(ATT));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}spielen.html?autostart=1&mode=tdm&map=hafen&allies=0&enemies=0&primary=ar_m17&secondary=pi_p9&quality=low`);
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) { ok = await p.evaluate(() => { const G = window.__game; return !!(G && G.match && G.match.state === 'playing' && G.player.alive); }).catch(() => false); if (!ok) await sleep(1000); }
  check(ok, 'Match läuft');
  const r = await p.evaluate(() => {
    const G = window.__game, w = G.player.weapon, d = w.currentDef, base = G.data.WEAPONS.ar_m17, vm = w.viewModel;
    const cur = vm && vm.cur;
    const lh = cur && cur.ud.leftHandGrip;
    const mz = cur && cur.ud.muzzle;
    const tpl = G.data.WEAPONS.ar_m17;
    return {
      id: d.id, key: d.attKey, mag: d.mag, baseMag: base.mag, sup: !!d.suppressed, sight: d.sight, zoom: d.adsZoom,
      rv: d.recoil.vertical, rv0: base.recoil.vertical, dmg: d.damage.max, dmg0: tpl.damage.max, hip: d.hipSpread, hip0: base.hipSpread,
      slotMag: w.slots[0].mag, vmAtt: cur && cur.att, vmSight: cur && cur.ud.info.sight, grip: lh && lh.userData && lh.userData.style,
      muzzleZ: mz ? mz.position.z : 0, sec: w.slots[1] && w.slots[1].def.attKey, secSup: w.slots[1] && !!w.slots[1].def.suppressed,
    };
  });
  check(r.id === 'ar_m17' && r.key && r.key.includes('daempfer'), `Hauptwaffe mit Aufsätzen (${r.key})`);
  check(r.mag === Math.round(r.baseMag * 1.5) && r.slotMag === r.mag, `Erweitertes Magazin: ${r.baseMag} → ${r.mag} (geladen ${r.slotMag})`);
  check(r.sup, 'Schalldämpfer: Waffe gedämpft');
  check(r.sight === 'acog' && r.zoom === 2.4, `Optik 2,4× (${r.sight}, ${r.zoom})`);
  check(r.rv < r.rv0, `Vordergriff/Dämpfer: Hochschlag ${r.rv0.toFixed(4)} → ${r.rv.toFixed(4)}`);
  check(r.dmg > r.dmg0 && r.hip < r.hip0, `Hohlspitz + Laser: Schaden ${r.dmg0} → ${r.dmg}, Hüftstreuung ${r.hip0} → ${r.hip.toFixed(3)}`);
  check(r.vmAtt && r.vmSight === 'acog', `Ego-Modell mit Aufsätzen (Visier ${r.vmSight})`);
  check(r.grip === 'post', `linke Hand am Vordergriff (Griffart ${r.grip})`);
  check(r.muzzleZ < -0.6, `Mündung vor dem Schalldämpfer (z ${r.muzzleZ.toFixed(3)})`);
  check(r.sec && r.secSup, `Zweitwaffe mit Aufsätzen (${r.sec})`);
  // Zielen durch die Optik
  await p.evaluate(() => { const G = window.__game; G.input.allowUnlockedMouse = true; const o = G.input.active.bind(G.input); G.input.active = (a) => (a === 'ads' ? true : o(a)); });
  await gameWait(p, 1.2);
  const ads = await p.evaluate(() => window.__game.player.weapon.adsProgress);
  check(ads > 0.95, `Im Anschlag (${ads.toFixed(2)})`);
  await p.screenshot({ path: 'tools/out/attach-ads.png' });
  await p.evaluate(() => { const G = window.__game; delete G.input.active; });
  await gameWait(p, 0.8);
  await p.screenshot({ path: 'tools/out/attach-hip.png' });
  // Im Match bearbeiten (Pause → Ausrüstung): Optik tauschen gilt sofort, Munition bleibt; Messer-Reiter vorhanden
  await p.evaluate(() => { const G = window.__game; G.player.weapon.slots[0].mag = 7; G.menus.showEquip(); });
  await sleep(500);
  const e1 = await p.evaluate(() => {
    const root = document.querySelector('.eq-host');
    const sel = root && root.querySelector('select[data-att-w="ar_m17"][data-att-slot="optik"]');
    const stats = root ? root.querySelectorAll('.lp-attstats span').length : 0;
    const tab = root && root.querySelector('[data-lslot="melee"]');
    if (sel) { sel.value = 'holo'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    return { sel: !!sel, stats, tab: !!tab };
  });
  check(e1.sel && e1.stats >= 4, `Pausemenü: Aufsätze im Match wählbar, Werte-Vergleich (${e1.stats} Werte)`);
  check(e1.tab, 'Pausemenü: Reiter „Messer“');
  await p.evaluate(() => { const t = document.querySelector('.eq-host [data-lslot="melee"]'); if (t) t.click(); });
  await sleep(300);
  const e2 = await p.evaluate(() => document.querySelectorAll('.eq-host .lp-item').length);
  check(e2 >= 4, `Messer-Auswahl im Match (${e2} Nahkampfwaffen)`);
  await p.evaluate(() => { const b = document.querySelector('[data-act="apply"]'); if (b) b.click(); });
  await sleep(300);
  await p.evaluate(() => { const G = window.__game; if (G.menus && typeof G.menus._resume === 'function') G.menus._resume(); });
  await gameWait(p, 0.6);
  const e3 = await p.evaluate(() => { const w = window.__game.player.weapon; return { optik: w.currentDef.att && w.currentDef.att.optik, mag: w.slots[0].mag, vm: w.viewModel.cur.att, sight: w.viewModel.cur.ud.info.sight }; });
  check(e3.optik === 'holo' && e3.vm.includes('holo') && e3.sight === 'holo', `Optik sofort getauscht (${e3.optik}, Modell ${e3.sight})`);
  check(e3.mag <= 7, `Munition bleibt (Magazin ${e3.mag})`);
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
}
console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
