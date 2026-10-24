// Prüft: baut der Vorbau (matchAssetJobs) bei Grafikstufe „niedrig“ am PC die volle (':max') Ego-Fassung mit?
// node tools/ref/vorbau.mjs – misst nach Matchbeginn (Schießstand, quality=low) die Bauzeit der max-Vorlage:
// 0 ms = sie wurde unnötig vorgebaut; > 0 = richtig (erst bei Bedarf). Server: NP_BASE.
import { chromium, BASE, GL_ARGS } from '../pw.mjs';
const b = await chromium.launch({ args: GL_ARGS });
const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto(`${BASE}spielen.html?autostart=1&mode=training&map=range&quality=low`);
const t0 = Date.now();
for (;;) {
  const st = await p.evaluate(() => window.__game && window.__game.match && window.__game.match.state).catch(() => null);
  if (st === 'playing') break;
  if (Date.now() - t0 > 400000) { console.log('Zeitüberschreitung', st); break; }
  await new Promise((r) => setTimeout(r, 2000));
}
const r = await p.evaluate(async () => {
  const M = await import('/assets/js/game/weapons/models.js');
  const B = await import('/assets/js/game/weapons/gunsmith/builder.js');
  const now = { max: B.DETAIL.max, lite: B.DETAIL.lite, quality: window.__game.renderer.quality };
  const save = { ...B.DETAIL };
  const time = (max, lite, key) => { B.DETAIL.max = max; B.DETAIL.lite = lite; const t = performance.now(); M.getWeaponModelInfo(key, 'first'); return Math.round(performance.now() - t); };
  const res = { now, std_m17: time(false, false, 'm17'), max_m17: time(true, false, 'm17'), std_p9: time(false, false, 'p9'), max_p9: time(true, false, 'p9') };
  Object.assign(B.DETAIL, save);
  return res;
});
console.log(JSON.stringify(r), 'Ladezeit bis playing', Math.round((Date.now() - t0) / 1000), 's');
await b.close();
