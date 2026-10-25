// LMG: HM-60 Hammer (gurtgespeist). Nach Foto neu gebaut: VP-9 Viper → guns-vp9.js (24.10.), QX-90 → guns-qx90.js (25.10.)
import { ejectionPort, triggerGuard } from './parts.js';
import { magRounds } from './magfill.js';

export function hm60(b) {
  const axis = 0.082;
  // Gehäuse: Kasten mit Seitenplatten und Nieten
  b.side('steel', [[-0.13, 0.035], [0.215, 0.035], [0.215, 0.108], [-0.13, 0.108]], 0.05, 0, { bevel: 0.0025 });
  b.side('steel', [[-0.06, 0.035], [0.12, 0.035], [0.11, 0.018], [-0.04, 0.018]], 0.04, 0, { bevel: 0.002 });
  if (b.hi) {
    for (let i = 0; i < 6; i++) { b.screw('steelBright', 0.0252, 0.045, -0.11 + i * 0.06, 'x', 0.0026); b.screw('steelBright', -0.0252, 0.045, -0.11 + i * 0.06, 'x', 0.0026); }
    for (const s of [-1, 1]) b.box('steel', 0.002, 0.02, 0.22, s * 0.0255, 0.08, 0.04, { c: 0.0006 });
  }
  // Zuführdeckel (klappbar, Scharnier vorn) mit Riegel hinten
  b.part('cover', 0, 0.108, 0.2);
  b.side('steel', [[-0.05, 0.108], [0.2, 0.108], [0.205, 0.116], [0.19, 0.13], [-0.03, 0.13], [-0.05, 0.122]], 0.052, 0, { part: 'cover', bevel: 0.0025 });
  b.box('steel', 0.03, 0.012, 0.016, 0, 0.13, -0.035, { part: 'cover', c: 0.002 });
  if (b.hi) {
    for (let i = 0; i < 4; i++) b.box('steel', 0.054, 0.003, 0.006, 0, 0.122, 0.03 + i * 0.04, { part: 'cover', c: 0.0008 });
    b.cyl('steel', 0.006, 0.006, 0.058, 0, 0.11, 0.2, { part: 'cover', axis: 'x', seg: 10 });
  }
  // Kimme: Leiter-Visier hinten
  b.box('steel', 0.026, 0.014, 0.03, 0, 0.115, -0.08, { c: 0.002 });
  b.side('steel', [[-0.088, 0.122], [-0.072, 0.122], [-0.074, 0.143], [-0.086, 0.143]], 0.02, 0, { bevel: 0.001 });
  b.box('cavity', 0.004, 0.005, 0.014, 0, 0.1405, -0.08, { c: 0 });
  // Gurtzuführung links + Munitionskasten + Gurt
  b.part('mag', -0.06, 0.0, 0.1);
  b.box('paintOlive', 0.075, 0.1, 0.13, -0.065, -0.012, 0.1, { part: 'mag', c: 0.004 });
  // Deckel locker auf dem Kasten (Teil 'lid', Scharnier an der Außenkante): hüpft beim Rückstoß unterschiedlich hoch
  // (viewmodel.js _animLid, Nutzer 13.10.2026)
  b.part('lid', -0.1045, 0.026, 0.1, 'mag');
  b.box('paintOlive', 0.079, 0.012, 0.134, -0.065, 0.032, 0.1, { part: 'lid', c: 0.003 });
  if (b.hi) {
    b.box('steel', 0.03, 0.004, 0.012, -0.065, 0.04, 0.1, { part: 'lid', c: 0.001 });
    for (const u of [0.045, 0.155]) b.cyl('steel', 0.003, 0.003, 0.02, -0.1045, 0.027, u, { part: 'lid', seg: 8 }); // Scharnierhülsen
    b.box('paintYellow', 0.0006, 0.018, 0.06, -0.1025, -0.01, 0.1, { part: 'mag', c: 0 });
    for (let i = 0; i < 4; i++) b.box('paintOlive', 0.002, 0.08, 0.004, -0.1035, -0.015, 0.05 + i * 0.033, { part: 'mag', c: 0 });
  }
  // Gurt: Patronen parallel zur Laufachse entlang eines Bogens vom Kasten ins Gehäuse. Platz 0 steckt im Gehäuse;
  // geht der Kasten zur Neige, wird das Gurtende kürzer (magfill.js, Glied je Patrone)
  b.part('belt', 0, 0, 0, 'mag');
  const beltAt = (t) => [-0.075 + t * 0.05 + Math.sin(t * Math.PI) * -0.012, 0.035 + t * 0.06 + Math.sin(t * Math.PI) * 0.018, 0.098];
  magRounds(b, { part: 'belt', cal: 'r308', fit: 0.066, link: true, stagger: false, follower: false, spread: 9, path: Array.from({ length: 9 }, (_, i) => beltAt(1 - i / 8)) });
  if (!b.hi) b.box('brass', 0.03, 0.06, 0.05, -0.06, 0.06, 0.095, { part: 'belt', rz: -0.5 });
  b.anchor('magGrab', -0.065, -0.01, 0.1, { part: 'mag', data: { w: 0.0375, d: 0.065 } });
  // Pistolengriff + Abzugsbügel
  b.side('grip', [
    [0.03, 0.022], [0.026, 0.0], [0.018, -0.04], [0.01, -0.07], [0.0, -0.08], [-0.028, -0.08], [-0.032, -0.068],
    [-0.022, -0.035], [-0.014, 0.0], [-0.018, 0.022],
  ], 0.032, 0, { bevel: 0.008, bevelSeg: 2 });
  triggerGuard(b, 'steel', 0.034, 0.1, 0.02, 0.034, { t: 0.005, w: 0.014, trigPos: 0.28 });
  // Schulterstütze (lang, Polymer)
  b.side('polymer', [
    [-0.125, 0.104], [-0.3, 0.098], [-0.46, 0.094], [-0.47, 0.088], [-0.47, -0.05], [-0.455, -0.056], [-0.3, -0.02],
    [-0.16, 0.022], [-0.125, 0.036],
  ], 0.044, 0, { bevel: 0.006, bevelSeg: 2 });
  b.box('steel', 0.048, 0.15, 0.012, 0, 0.022, -0.476, { c: 0.003 });
  if (b.hi) b.side('steel', [[-0.47, -0.06], [-0.47, -0.02], [-0.44, -0.03], [-0.45, -0.07]], 0.03, 0, { bevel: 0.002 });   // Schulterstütze-Klappe
  // Ladehebel rechts (animiert)
  b.part('charge', 0.03, 0.06, 0.13);
  b.box('steel', 0.008, 0.012, 0.03, 0.028, 0.06, 0.13, { part: 'charge', c: 0.002 });
  b.cyl('steel', 0.006, 0.007, 0.024, 0.042, 0.06, 0.138, { part: 'charge', axis: 'x', seg: b.seg(10, 5) });
  b.anchor('chargeGrab', 0.052, 0.06, 0.138, { part: 'charge', data: { travel: [0, 0, 0.1], style: 'right' } });
  ejectionPort(b, 0.0252, 0.072, 0.03, 0.05, 0.018);
  b.part('bolt', 0, axis, 0.03);
  // Handschutz (gerippt), Lauf, Gaszylinder, Tragegriff, Zweibein
  b.lathe('polymer', [[0, 0], [0, 0.026], [0.006, 0.031], [0.2, 0.031], [0.215, 0.026], [0.215, 0]], 0, axis - 0.004, 0.215, { seg: b.seg(16, 6) });
  if (b.hi) for (let i = 0; i < 9; i++) b.torus('polymer', 0.031, 0.0025, 0, axis - 0.004, 0.235 + i * 0.02, { seg: 6, tseg: 16 });
  b.cyl('steelDark', 0.0125, 0.0135, 0.45, 0, axis, 0.655, { seg: b.seg(14, 6) });
  b.cyl('steel', 0.011, 0.011, 0.17, 0, axis - 0.03, 0.52, { seg: b.seg(12, 5) });
  b.box('steel', 0.02, 0.03, 0.03, 0, axis - 0.016, 0.6, { c: 0.003 });
  // Tragegriff
  b.tube('steel', [[0, axis + 0.012, 0.42], [0, axis + 0.05, 0.43], [0, axis + 0.058, 0.47], [0, axis + 0.05, 0.51], [0, axis + 0.012, 0.52]], 0.0055);
  b.box('polymer', 0.016, 0.014, 0.07, 0, axis + 0.058, 0.47, { c: 0.004 });
  // Zweibein (eingeklappt nach vorn)
  for (const s of [-1, 1]) {
    b.cyl('steel', 0.0045, 0.0045, 0.2, s * 0.012, axis - 0.042, 0.71, { rz: 0, ry: s * -0.03, seg: b.seg(8, 4) });
    b.box('rubber', 0.012, 0.01, 0.022, s * 0.015, axis - 0.042, 0.815, { c: 0.002 });
  }
  b.box('steel', 0.034, 0.016, 0.022, 0, axis - 0.036, 0.6, { c: 0.002 });
  // Korn + Mündungsfeuerdämpfer (kegelförmig, geschlitzt)
  b.box('steel', 0.006, 0.05, 0.008, 0, axis + 0.034, 0.83, { c: 0.001 });
  b.box('steel', 0.016, 0.012, 0.022, 0, axis + 0.014, 0.83, { c: 0.002 });
  b.lathe('steelDark', [[0, 0], [0, 0.0135], [0.008, 0.0145], [0.065, 0.019], [0.065, 0.014]], 0, axis, 0.88, { seg: b.seg(14, 6) });
  if (b.hi) for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; b.box('cavity', 0.003, 0.003, 0.045, Math.cos(a) * 0.0168, axis + Math.sin(a) * 0.0168, 0.915, { rz: a, c: 0 }); }
  b.bore(0.012, 0, axis, 0.9455);
  b.anchor('muzzle', 0, axis, 0.946);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.32, gw: 0.016, gd: 0.02, gu: 0.006, ho: 0.039, tu: 0.03 } });
  b.anchor('magWell', -0.06, 0.0, 0.1);
  b.anchor('sight', 0, 0.1405, -0.08, { data: { type: 'iron', eyeRelief: 0.28 } });
  b.anchor('leftHandGrip', 0, axis - 0.035, 0.32, { data: { style: 'under', r: 0.031 } });
  b.meta = { sight: 'iron', axis, kind: 'lmg' };
}
