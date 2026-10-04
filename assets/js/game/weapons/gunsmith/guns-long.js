// Langwaffen: Brecher .338 (Repetier-Scharfschützengewehr) und Bulldog 12 (Vorderschaftrepetierflinte)
import { sniperScope, brake, ejectionPort, roundRect } from './parts.js';

export function brecher(b) {
  const axis = 0.074;
  // Daumenloch-Schaft (oliv) – Seitenprofil mit Daumenloch und Abzugsbügel-Öffnung
  const outer = [
    [0.39, 0.058], [0.39, 0.014], [0.375, -0.006], [0.135, -0.009], [0.132, -0.022], [0.07, -0.022], [0.068, -0.05],
    [0.056, -0.06], [0.032, -0.058], [0.024, -0.066], [0.014, -0.088], [0.0, -0.098], [-0.042, -0.098], [-0.1, -0.082],
    [-0.33, -0.064], [-0.43, -0.078], [-0.462, -0.084], [-0.47, -0.07], [-0.47, 0.086], [-0.455, 0.1], [-0.3, 0.106],
    [-0.13, 0.1], [-0.098, 0.08], [-0.07, 0.056],
  ];
  const thumb = [[-0.034, 0.03], [-0.07, 0.036], [-0.105, 0.024], [-0.118, -0.016], [-0.104, -0.058], [-0.054, -0.066], [-0.034, -0.048], [-0.026, -0.004]];
  const guard = [[0.06, -0.012], [0.06, -0.044], [0.05, -0.05], [0.034, -0.048], [0.03, -0.024], [0.036, -0.012]];
  b.side('polymerOD', outer, 0.052, 0, { holes: [thumb, guard], bevel: 0.007, bevelSeg: b.hi ? 2 : 1 });
  if (b.hi) {
    // Griffflächen gestippelt, Vorderschaft-Schlitze
    b.side('grip', [[0.024, -0.03], [0.02, -0.066], [0.006, -0.09], [-0.03, -0.09], [-0.032, -0.06], [-0.022, -0.03]], 0.0535, 0, { bevel: 0.004 });
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.box('cavity', 0.0015, 0.016, 0.04, s * 0.0262, 0.025, 0.17 + i * 0.05, { c: 0 });
  }
  b.box('rubber', 0.056, 0.17, 0.018, 0, 0.008, -0.478, { c: 0.005 });
  // Verstellbare Wangenauflage mit Rändelknöpfen
  b.box('polymerOD', 0.046, 0.016, 0.15, 0, 0.115, -0.3, { c: 0.004 });
  if (b.hi) for (const du of [-0.24, -0.36]) { b.cyl('steel', 0.003, 0.003, 0.03, 0, 0.098, du, { axis: 'v', seg: 8 }); b.cyl('knurl', 0.008, 0.008, 0.006, 0.03, 0.06, du, { axis: 'x', seg: 12 }); }
  // Einbein unter dem Schaft
  if (b.hi) { b.cyl('steel', 0.006, 0.006, 0.06, 0, -0.09, -0.4, { axis: 'v', seg: 10 }); b.cyl('rubber', 0.011, 0.011, 0.01, 0, -0.122, -0.4, { axis: 'v', seg: 12 }); }
  // System (Stahlzylinder) mit Schiene
  b.cyl('steel', 0.0175, 0.0175, 0.27, 0, axis, 0.065, { seg: b.seg(18, 7) });
  b.box('steel', 0.024, 0.01, 0.25, 0, axis + 0.016, 0.065, { c: 0.002 });
  b.rail('steel', 0, axis + 0.021, -0.06, 0.19);
  ejectionPort(b, 0.0172, axis + 0.004, 0.06, 0.07, 0.016);
  // Verschluss mit Kammerstängel (animiert: hoch drehen, zurück, vor, runter)
  b.part('boltHandle', 0, axis, -0.05);
  b.cyl('steelBright', 0.0098, 0.0098, 0.13, 0, axis, -0.02, { part: 'boltHandle', seg: b.seg(14, 6) });
  b.cyl('steel', 0.013, 0.012, 0.03, 0, axis, -0.085, { part: 'boltHandle', seg: b.seg(14, 6) });
  b.cyl('steel', 0.0045, 0.0055, 0.05, 0.035, axis - 0.012, -0.045, { part: 'boltHandle', rz: 1.2, ry: -0.2, seg: b.seg(10, 5) });
  b.sphere('polymer', 0.011, 0.058, axis - 0.022, -0.05, { part: 'boltHandle', sx: 1, sy: 1, sz: 1.15 });
  b.anchor('boltGrab', 0.062, axis - 0.024, -0.05, { part: 'boltHandle', data: { travel: [0, 0, 0.1], rot: 1.05, style: 'bolt' } });
  // Magazin (Box)
  b.part('mag', 0, 0.0, 0.1);
  b.box('steel', 0.032, 0.07, 0.07, 0, 0.0, 0.1, { part: 'mag', c: 0.002 });
  b.box('polymer', 0.036, 0.01, 0.074, 0, -0.035, 0.1, { part: 'mag', c: 0.002 });
  b.anchor('magGrab', 0, -0.025, 0.1, { part: 'mag' });
  // Abzug
  b.side('steel', [[0.048, -0.006], [0.05, -0.02], [0.044, -0.04], [0.04, -0.038], [0.044, -0.02], [0.043, -0.006]], 0.006, 0, { bevel: 0.0008 });
  // Kannelierter Lauf + große Mündungsbremse
  b.cyl('steelDark', 0.0118, 0.0135, 0.62, 0, axis, 0.5, { seg: b.seg(16, 6) });
  if (b.hi) for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; b.box('cavity', 0.003, 0.0012, 0.34, Math.cos(a) * 0.0124, axis + Math.sin(a) * 0.0124, 0.6, { rz: a + Math.PI / 2, c: 0 }); }
  const end = brake(b, 0.808, axis, 0.0175, 0.085);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Zweibein (eingeklappt) unter dem Vorderschaft
  b.box('steel', 0.03, 0.012, 0.03, 0, -0.016, 0.35, { c: 0.003 });
  for (const s of [-1, 1]) {
    b.cyl('steel', 0.0045, 0.0045, 0.18, s * 0.011, -0.024, 0.255, { seg: b.seg(8, 4) });
    if (b.hi) b.box('rubber', 0.012, 0.012, 0.018, s * 0.011, -0.024, 0.16, { c: 0.002 });
  }
  sniperScope(b, -0.075, axis + 0.0274);
  b.anchor('rightHandGrip', 0, -0.035, 0.0, { data: { rake: 0.36 } });
  b.anchor('magWell', 0, 0.0, 0.1);
  b.anchor('leftHandGrip', 0, -0.009, 0.27, { data: { style: 'flat', r: 0.026 } });
  b.meta = { sight: 'sniper', axis, kind: 'sniper' };
}

export function bulldog(b) {
  const axis = 0.06;
  // System (Stahl, brüniert) mit gerundeter Oberseite
  b.side('steelDark', [
    [-0.07, 0.016], [0.152, 0.016], [0.152, 0.08], [0.14, 0.088], [-0.05, 0.09], [-0.07, 0.084],
  ], 0.036, 0, { bevel: 0.004, bevelSeg: 2 });
  ejectionPort(b, 0.0181, 0.058, 0.085, 0.07, 0.024, 'steelDark');
  if (b.hi) {
    // Ladeöffnung unten
    b.box('cavity', 0.022, 0.002, 0.06, 0, 0.0155, 0.09, { c: 0 });
    for (const [u, v] of [[-0.045, 0.03], [0.012, 0.03]]) { b.screw('steelBright', 0.0185, v, u, 'x', 0.003); b.screw('steelBright', -0.0185, v, u, 'x', 0.003); }
    // Seitliche Patronenhalterung links (4 Schrotpatronen)
    b.box('polymer', 0.004, 0.034, 0.1, -0.0205, 0.055, 0.035, { c: 0.001 });
    for (let i = 0; i < 4; i++) {
      b.cyl('shellRed', 0.0105, 0.0105, 0.05, -0.0315, 0.058, -0.003 + i * 0.025, { axis: 'v', seg: 10 });
      b.cyl('brass', 0.0108, 0.0108, 0.012, -0.0315, 0.027, -0.003 + i * 0.025, { axis: 'v', seg: 10 });
    }
  }
  b.anchor('shellPort', 0, 0.012, 0.09);
  // Abzugsgruppe + Bügel
  b.side('steel', [[-0.05, 0.018], [0.06, 0.018], [0.064, 0.006], [-0.03, 0.006]], 0.03, 0, { bevel: 0.002 });
  b.side('steel', [[0.0, 0.008], [0.0, -0.014], [0.012, -0.024], [0.055, -0.024], [0.066, -0.01], [0.066, 0.008], [0.06, 0.008], [0.058, -0.008], [0.05, -0.018], [0.014, -0.018], [0.006, -0.01], [0.006, 0.008]], 0.012, 0, { bevel: 0.0012 });
  b.side('steel', [[0.024, 0.008], [0.027, -0.004], [0.022, -0.018], [0.018, -0.016], [0.021, -0.004], [0.02, 0.008]], 0.006, 0, { bevel: 0.0008 });
  // Walnuss-Schaft mit halbem Pistolengriff
  b.side('woodWalnut', [
    [-0.066, 0.086], [-0.13, 0.081], [-0.26, 0.074], [-0.4, 0.068], [-0.404, 0.062], [-0.404, -0.078], [-0.39, -0.083],
    [-0.3, -0.06], [-0.18, -0.03], [-0.1, -0.014], [-0.065, -0.03], [-0.045, -0.046], [-0.024, -0.048], [-0.008, -0.026],
    [0.0, 0.0], [-0.008, 0.016], [-0.066, 0.018],
  ], 0.04, 0, { bevel: 0.009, bevelSeg: 2 });
  b.side('rubber', [[-0.404, 0.066], [-0.424, 0.066], [-0.428, 0.05], [-0.428, -0.082], [-0.42, -0.094], [-0.404, -0.09]], 0.044, 0, { bevel: 0.004 });
  if (b.hi) b.box('polymer', 0.03, 0.006, 0.022, 0, -0.06, -0.035, { rx: 0.5, c: 0.002 });          // Griffkappe
  // Lauf mit Laufschiene + Perlkorn
  b.cyl('steelDark', 0.0118, 0.0118, 0.47, 0, axis, 0.387, { seg: b.seg(16, 6) });
  b.box('steelDark', 0.008, 0.003, 0.46, 0, axis + 0.026, 0.385, { c: 0.0008 });
  for (let i = 0; i < (b.hi ? 12 : 2); i++) b.box('steelDark', 0.004, 0.014, 0.005, 0, axis + 0.018, 0.17 + i * (b.hi ? 0.038 : 0.42), { c: 0 });
  b.sphere('paintWhite', 0.0026, 0, axis + 0.0298, 0.61, { seg: 8, hseg: 6 });
  b.circle('cavity', 0.0095, 0, axis, 0.6225);
  b.anchor('muzzle', 0, axis, 0.623);
  // Röhrenmagazin + Kappe + Laufschelle
  b.cyl('steel', 0.0112, 0.0112, 0.4, 0, axis - 0.025, 0.352, { seg: b.seg(14, 6) });
  b.cyl('knurl', 0.0125, 0.0125, 0.026, 0, axis - 0.025, 0.565, { seg: b.seg(14, 6) });
  b.box('steel', 0.016, 0.04, 0.014, 0, axis - 0.012, 0.535, { c: 0.003 });
  // Vorderschaft (Walnuss, gerippt) – animiert
  b.part('pump', 0, axis - 0.022, 0.3);
  const ribs = [[0, 0.0135], [0.005, 0.021]];
  const nR = b.hi ? 11 : 2, L = 0.19;
  for (let i = 0; i < nR; i++) { const u = 0.014 + i * (L / nR); ribs.push([u, 0.0235], [u + L / nR * 0.55, 0.0235], [u + L / nR * 0.75, 0.0218]); }
  ribs.push([L + 0.012, 0.022], [L + 0.018, 0.0135]);
  b.lathe('woodWalnut', ribs, 0, axis - 0.022, 0.205, { part: 'pump', seg: b.seg(16, 6), sx: 0.92, sy: 1.08 });
  for (const s of [-1, 1]) b.box('steel', 0.003, 0.006, 0.1, s * 0.0125, axis - 0.024, 0.16, { part: 'pump', c: 0.0008 });
  b.anchor('pumpGrab', 0, axis - 0.048, 0.3, { part: 'pump', data: { travel: [0, 0, 0.085] } });
  // Einzelne Patrone für die Ladeanimation (standardmäßig verborgen)
  b.part('shell', 0, 0.012, 0.09);
  b.cyl('shellRed', 0.0105, 0.0105, 0.055, 0, 0.012, 0.09, { part: 'shell', seg: b.seg(10, 5) });
  b.cyl('brass', 0.0109, 0.0109, 0.013, 0, 0.012, 0.059, { part: 'shell', seg: b.seg(10, 5) });
  b.anchor('rightHandGrip', 0, -0.014, -0.03, { data: { rake: 0.5 } });
  b.anchor('sight', 0, 0.0915, -0.045, { data: { type: 'iron', eyeRelief: 0.22 } });
  b.anchor('leftHandGrip', 0, axis - 0.048, 0.3, { part: 'pump', data: { style: 'pump', r: 0.024 } });
  b.meta = { sight: 'iron', axis, kind: 'shotgun', hidden: ['shell'] };
}
