// Karten-Prüfbilder (Realismus-Prüfung 26.10., Etappe K0): lädt eine Karte in dev/post.html (echte Bildkette:
// Belichtungsautomatik, Farbstufe, AO, Lichtstrahlen, Linse; ohne Waffe/HUD) und speichert Blicke in Augenhöhe als
// JPEG – gleiche Kamera für Vorher/Nachher. Hervorgegangen aus kaudit.mjs/kqueue.sh der Prüfung (Arbeitsordner).
//
//   node tools/karten-audit.mjs <karte> [Blicke …] [--quality=high] [--tag=vorher] [--out=tools/out/karten-audit]
//        [--renders=6] [--w=1024] [--h=576] [--fov=62] [--q=&weather=klar]
//   node tools/karten-audit.mjs --alle [--tag=…]        alle Karten mit ihren Standardblicken, nacheinander
//   node tools/karten-audit.mjs --liste                 Standardblicke ausgeben
//
// Blick: "name:x,y,z,gier,neigung[,fov]" (Grad; Gier 0 = Blick nach −z, +90 = nach −x; Neigung + = nach oben)
//   y: Zahl = absolut · g1.7 = 1,7 m über dem Gelände (Großkarten) · i1.7 = über dem Boden (Strahl von 3 m, Innenräume)
//   x = sA3 → Startpunkt Team A Nr. 3 (z wird ignoriert; Gier 'sp' = Blickrichtung des Startpunkts)
// Ohne Blicke: die Standardblicke der Karte (BLICKE). Ausgabe: <out>/[<tag>-]<karte>-<name>.jpg
// Großkarten brauchen mehr Bilder, bis Gras-/Streuringe nachgezogen sind (--renders=12 ist dort Standard).
// Server: NP_BASE (Standard :8765). Rechenintensiv (SwiftShader ≈ 1 Bild/s): nie zwei große Karten gleichzeitig.
import { chromium, BASE, GL_ARGS } from './pw.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

/** Standardblicke je Karte: Prüfung 26.10. (karten-realismus.md §3) + Sofort-Fehler K0. */
export const BLICKE = {
  hafen: [
    '3b-halle:20,i1.7,16,0,0', '6-halle-quer:38,i1.7,-2,90,0',
    'k0-container:-20,i1.7,12.5,150,-3',           // offener Container (−24,4, 22,2): Außenhaut + Türflügel
    'k0-pfuetze:50,i1.7,14,-28,-6',                // Osthof: Pfütze vor Schuppen 4 (Material „wet“)
    'k0-pfuetze2:45,i1.7,4,-75,-8',
  ],
  altstadt: ['1-marktgasse:-32.5,i1.7,40,0,0', '2-brunnenplatz:-12,i1.7,6,-90,0', '3-ostgasse:33,i1.7,44,0,0', '4-oelbaumplatz:50,i1.7,-4,-80,0', '5-spawnB:sB3,i1.7,0,sp,0'],
  werk: [
    '1-halle:-6,i1.7,22,10,0', '2-laufsteg:19.5,6.9,24,15,-5', '3-gasse:26.6,i1.9,17,0,2', '4-lkwhof:-40,i1.7,42,0,0', '5-aussenlager:-65,i1.7,40,0,0',
    'k0-feuer:-6.3,i1.6,24.6,4,-10',               // Feuertonne (−6, 21) aus 3,6 m
    'k0-rost:20.3,6.9,26,0,-22',                   // Gitterrost-Laufsteg von oben schräg (Moiré)
  ],
  bibliothek: ['1-mittelgang:0,i1.7,22,0,0', '2-nische:14,i1.7,7.2,90,0', '3-galerie:35.5,6.1,15,0,0', '4-verboten:0,i1.7,-14,0,0', 'k0-globus:0,i1.7,8.5,0,14'],
  range: ['1-schiesslinie:0,i1.7,38,0,0', '2-waffenkammer:4,i1.7,55,-90,0', '3-ziele:0,i1.7,-60,180,0'],
  grenzland: ['1-dorfplatz:-1.5,g1.7,91,36,-3', '2-gehoeft:-130,g1.7,90,132,0', '3-bruecke:40,g1.7,2,0,0', '4-kieswerk:130,g1.7,-90,-45,0', '5-feld:-90,g1.7,-60,21,0'],
  niemandsland: ['1-graben:-8,g1.7,114.8,-90,0', '2-trichterfeld:0,g1.7,100,0,0', '3-dorfruine:-105,g1.7,20,37,0', '4-kapelle:110,g1.7,10,-43,0', '5-panzer:0,g1.7,30,0,0'],
  brandwald: ['1-graben:sA3,g1.7,0,-90,0', 'd1-pfuetzen-oben:sA3,g5,0,-90,-40', '2-front:0,g1.7,100,0,0', '3-gewaechshaus:-85,g1.7,30,43,0', '4-holzplatz:90,g1.7,-5,-43,0', '5-wald:-140,g1.7,110,45,0',
    'k0-pfuetze-graben:45,g2.5,97.5,0,-35',        // Grabenpfütze (45, 93,5): vorher 1,9 m über dem Grabenboden
    'k0-pfuetze-boden:-171,g1.7,-13,0,-15',        // Bodenpfützen (−170…−172, −17…−20): vorher bis 6,2 m, Rand 0,9 m Luft
  ],
};
const BIG = new Set(['grenzland', 'niemandsland', 'brandwald']);

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const pos = args.filter((a) => !a.startsWith('--'));
if (opt.liste) { for (const [k, v] of Object.entries(BLICKE)) console.log(k.padEnd(13), v.join('  ')); process.exit(0); }
const OUT = String(opt.out || 'tools/out/karten-audit');
const quality = String(opt.quality || 'high');
const tag = opt.tag ? String(opt.tag) + '-' : '';
const W = +(opt.w || 1024), H = +(opt.h || 576);
mkdirSync(OUT, { recursive: true });

const jobs = opt.alle ? Object.keys(BLICKE).map((m) => [m, BLICKE[m]]) : [[pos[0], pos.length > 1 ? pos.slice(1) : BLICKE[pos[0]]]];
if (!jobs[0][0] || !jobs[0][1]) { console.error('Aufruf: node tools/karten-audit.mjs <karte> [Blicke …] | --alle | --liste'); process.exit(2); }

const browser = await chromium.launch({ args: GL_ARGS });
let fail = 0;
for (const [map, views] of jobs) {
  const t0 = Date.now();
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => { fail++; console.log('FEHLER', map, e.message); });
  await page.goto(`${BASE}dev/post.html?map=${map}&quality=${quality}&debug=0&fov=${opt.fov || 62}${opt.q || ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dev?.ready, null, { timeout: 900000, polling: 2000 });
  console.log(map, 'geladen', ((Date.now() - t0) / 1000).toFixed(0), 's');
  await page.evaluate((n) => { window.__renders = n; }, +(opt.renders || (BIG.has(map) ? 12 : 6)));
  await page.addStyleTag({ content: '#panel, #mini, #progress, #marks, .xh, #stats { display: none !important; }' });
  await page.evaluate(() => { for (const id of ['b-marks', 'b-vm']) document.getElementById(id)?.click(); });
  for (const v0 of views) {
    // Blick nur mit Namen → Standardblick der Karte
    const v = v0.includes(':') ? v0 : (BLICKE[map] || []).find((b) => b.startsWith(v0 + ':')) || v0;
    const [name, spec] = v.split(':');
    if (!spec) { fail++; console.log('FEHLER unbekannter Blick', map, v0); continue; }
    const info = await page.evaluate((parts) => {
      let [x, y, z, yaw, pitch, fov] = parts;
      const D = window.__dev; D.paused = true;
      if (String(x).startsWith('s')) {
        const t = String(x)[1], i = +String(x).slice(2), sp = D.world.spawns[t][i];
        x = sp.position.x; z = sp.position.z;
        if (yaw === 'sp') yaw = (sp.yaw * 180) / Math.PI;
      }
      x = +x; z = +z;
      const inner = String(y).startsWith('i');
      const g = D.world.groundHeight ? D.world.groundHeight(x, z, inner ? 3 : 400) : 0;
      const yy = String(y).startsWith('g') || inner ? (g ?? 0) + Number(String(y).slice(1)) : +y;
      if (fov) { D.camera.fov = +fov; D.camera.updateProjectionMatrix(); }
      D.setCam(x, yy, z, (+yaw * Math.PI) / 180, (+pitch * Math.PI) / 180);
      D.R.exposure.reset();
      for (let i = 0; i < (window.__renders || 6); i++) D.render();
      const r = D.R.info();
      return { y: +yy.toFixed(2), ground: g == null ? null : +g.toFixed(2), dc: r.drawCalls, tris: r.triangles ?? r.render?.triangles };
    }, spec.split(','));
    const file = `${OUT}/${tag}${map}-${name}.jpg`;
    writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 86, timeout: 300000 }));
    console.log(' ', name, JSON.stringify(info), '→', file, ((Date.now() - t0) / 1000).toFixed(0), 's');
  }
  await page.context().close();
}
await browser.close();
process.exit(fail ? 1 : 0);
