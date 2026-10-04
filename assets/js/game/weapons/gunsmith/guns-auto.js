// Maschinenpistolen & LMG: VP-9 Viper (MP5-artig), QX-90 (P90-artiger Bullpup, Rotpunkt), HM-60 Hammer (gurtgespeist)
import { redDot, ejectionPort, triggerGuard, slots, roundRect, ellipsePts } from './parts.js';

// Bogenförmiges Magazin: Zentrum (cu, cv) vor dem Magazin, Radien rFront < rBack, Winkelspanne sweep
function curvedMag(b, mat, cu, cv, rFront, rBack, sweep, width, o = {}) {
  const n = b.hi ? 8 : 3;
  const arc = (r, a0, a1) => { const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]); } return p; };
  b.side(mat, [...arc(rBack, Math.PI, Math.PI + sweep), ...arc(rFront, Math.PI + sweep, Math.PI)], width, 0, { part: 'mag', bevel: o.bevel ?? 0.0018 });
  const a = Math.PI + sweep, rm = (rFront + rBack) / 2;
  b.box(mat, width + 0.004, 0.006, rBack - rFront + 0.006, 0, cv + Math.sin(a) * rm - 0.003, cu + Math.cos(a) * rm, { part: 'mag', rx: sweep, c: 0.0015 });
  return (t) => { const aa = Math.PI + sweep * t; return [cu + Math.cos(aa) * rm, cv + Math.sin(aa) * rm]; };
}

export function vp9(b) {
  const axis = 0.06;
  // Gehäuse (Blechprägung, oben gerundet)
  b.front('steel', roundRect(-0.0185, 0.034, 0.0185, 0.093, 0.013, b.hi ? 4 : 1), 0.285, -0.082, { bevel: 0.0015 });
  if (b.hi) {
    // Prägesicken seitlich
    for (const s of [-1, 1]) b.box('steel', 0.002, 0.006, 0.2, s * 0.0188, 0.05, 0.05, { c: 0.0008 });
    for (const [u, v] of [[-0.05, 0.045], [0.12, 0.045], [-0.07, 0.07]]) { b.screw('steelBright', 0.019, v, u, 'x', 0.003); b.screw('steelBright', -0.019, v, u, 'x', 0.003); }
  }
  // Endkappe hinten + Schulterstützen-Führung
  b.box('steel', 0.042, 0.06, 0.012, 0, 0.064, -0.086, { c: 0.003 });
  // Spannhebel-Rohr oben vorn
  b.cyl('steel', 0.0118, 0.0118, 0.2, 0, 0.084, 0.3, { seg: b.seg(14, 6) });
  b.cyl('steel', 0.0118, 0.0105, 0.012, 0, 0.084, 0.406, { seg: b.seg(14, 6) });
  // Spannhebel (links, animiert – „HK-Schlag“)
  b.part('charge', -0.012, 0.09, 0.3);
  b.box('steel', 0.005, 0.006, 0.026, -0.012, 0.09, 0.3, { part: 'charge', c: 0.001 });
  b.box('steel', 0.022, 0.006, 0.006, -0.022, 0.093, 0.31, { part: 'charge', rz: 0.5, c: 0.0012 });
  b.cyl('polymer', 0.005, 0.005, 0.012, -0.034, 0.1, 0.31, { part: 'charge', axis: 'x', rz: 0.5, seg: b.seg(10, 5) });
  b.anchor('chargeGrab', -0.036, 0.1, 0.31, { part: 'charge', data: { travel: [0, 0, 0.075], style: 'hkslap' } });
  if (b.hi) b.box('cavity', 0.002, 0.004, 0.09, -0.0118, 0.088, 0.26, { c: 0 });               // Schlitz im Rohr
  // Kimme: Trommel-Diopter hinten
  b.box('steel', 0.03, 0.012, 0.03, 0, 0.098, -0.06, { c: 0.003 });
  b.cyl('steel', 0.0115, 0.0115, 0.022, 0, 0.104, -0.06, { axis: 'x', seg: b.seg(14, 6) });
  if (b.hi) b.circle('cavity', 0.0018, 0, 0.1145, -0.0485, { seg: 8 });
  // Korn: geschlossener Ringtunnel vorn
  b.box('steel', 0.016, 0.014, 0.022, 0, 0.097, 0.392, { c: 0.002 });
  b.torus('steel', 0.0105, 0.0026, 0, 0.1125, 0.392, { rx: 0, seg: b.seg(8, 4), tseg: b.seg(20, 8) });
  b.cyl('steel', 0.0011, 0.0015, 0.012, 0, 0.108, 0.392, { axis: 'v', seg: 6 });
  // Lauf + Dreifach-Warzen-Mündung
  b.cyl('steelDark', 0.0085, 0.0085, 0.08, 0, axis, 0.4, { seg: b.seg(14, 6) });
  b.cyl('steelDark', 0.0095, 0.0095, 0.024, 0, axis, 0.43, { seg: b.seg(14, 6) });
  if (b.hi) for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * Math.PI * 2 / 3; b.box('steelDark', 0.006, 0.004, 0.01, Math.cos(a) * 0.0105, axis + Math.sin(a) * 0.0105, 0.425, { rz: a - Math.PI / 2, c: 0.0008 }); }
  b.circle('cavity', 0.0045, 0, axis, 0.4425);
  b.anchor('muzzle', 0, axis, 0.445);
  // Schlanker Handschutz (Polymer) mit Rillen
  b.side('polymer', [
    [0.2, 0.074], [0.355, 0.074], [0.362, 0.068], [0.362, 0.046], [0.35, 0.034], [0.215, 0.03], [0.2, 0.034],
  ], 0.04, 0, { bevel: 0.006, bevelSeg: 2 });
  if (b.hi) for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.box('cavity', 0.0015, 0.004, 0.022, s * 0.0198, 0.05, 0.225 + i * 0.027, { c: 0 });
  // Auswurffenster rechts + Verschluss
  ejectionPort(b, 0.0186, 0.068, 0.05, 0.045, 0.016);
  b.part('bolt', 0, 0.068, 0.05);
  b.box('steelBright', 0.004, 0.012, 0.04, 0.016, 0.068, 0.05, { part: 'bolt', c: 0.001 });
  // Griffstück (Polymer) mit Abzugsbügel, Pistolengriff
  b.side('polymer', [
    [-0.07, 0.036], [0.088, 0.036], [0.088, 0.018], [0.075, 0.012], [-0.04, 0.012], [-0.07, 0.022],
  ], 0.032, 0, { bevel: 0.003 });
  b.side('grip', [
    [0.03, 0.014], [0.026, -0.01], [0.018, -0.04], [0.012, -0.068], [0.002, -0.08], [-0.026, -0.08], [-0.03, -0.07],
    [-0.022, -0.04], [-0.016, -0.01], [-0.02, 0.014],
  ], 0.034, 0, { bevel: 0.008, bevelSeg: 2 });
  triggerGuard(b, 'polymer', 0.032, 0.085, 0.014, 0.032, { t: 0.006, w: 0.016, trigPos: 0.25 });
  if (b.hi) {
    b.box('polymer', 0.005, 0.012, 0.016, 0.017, 0.028, -0.03, { c: 0.001 });                // Wahlhebel
    b.box('paintWhite', 0.0005, 0.003, 0.003, 0.0198, 0.028, -0.04, { c: 0 });
    b.box('paintSignal', 0.0005, 0.003, 0.003, 0.0198, 0.028, -0.022, { c: 0 });
  }
  // Magazinschacht + Magazinhalter
  b.box('steel', 0.03, 0.026, 0.044, 0, 0.026, 0.107, { c: 0.002 });
  if (b.hi) b.box('steel', 0.016, 0.005, 0.012, 0, 0.012, 0.08, { rx: 0.3, c: 0.001 });
  // Stark gebogenes Magazin
  b.part('mag', 0, 0.02, 0.105);
  const at = curvedMag(b, 'steel', 0.31, 0.03, 0.188, 0.222, 0.7, 0.024);
  if (b.hi) {
    for (let i = 1; i < 5; i++) { const [mu, mv] = at(i / 5.2); for (const s of [-1, 1]) b.box('steel', 0.0018, 0.003, 0.03, s * 0.0125, mv, mu, { part: 'mag', rx: 0.7 * i / 5.2, c: 0 }); }
    b.cyl('brass', 0.0045, 0.0045, 0.018, 0, 0.032, 0.1, { part: 'mag', seg: 8 });
  }
  const [gu, gv] = at(0.45);
  b.anchor('magGrab', 0, gv, gu, { part: 'mag' });
  // Einschiebe-Schulterstütze (A3): zwei Streben + Schaftkappe
  for (const s of [-1, 1]) {
    b.box('steel', 0.004, 0.012, 0.21, s * 0.0215, 0.075, -0.18, { c: 0.001 });
    b.box('steel', 0.004, 0.01, 0.05, s * 0.0215, 0.04, -0.26, { rx: -0.6, c: 0.001 });
  }
  b.side('rubber', [[-0.272, 0.095], [-0.28, 0.1], [-0.292, 0.096], [-0.296, 0.06], [-0.294, 0.0], [-0.288, -0.03], [-0.278, -0.034], [-0.272, -0.025]], 0.046, 0, { bevel: 0.006 });
  b.box('steel', 0.046, 0.016, 0.01, 0, 0.075, -0.27, { c: 0.002 });
  b.box('steel', 0.046, 0.012, 0.01, 0, 0.0, -0.275, { c: 0.002 });
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.3 } });
  b.anchor('magWell', 0, 0.02, 0.105);
  b.anchor('sight', 0, 0.1145, -0.06, { data: { type: 'iron', eyeRelief: 0.16 } });
  b.anchor('leftHandGrip', 0, 0.03, 0.29, { data: { style: 'under', r: 0.022 } });
  b.meta = { sight: 'iron', axis, kind: 'smg' };
}

export function qx90(b) {
  const axis = 0.066;
  // Hauptkörper: organisches Profil mit Abzugs-/Stützhandöffnung vorn und Daumenloch hinten
  const outer = [
    [-0.215, 0.098], [0.165, 0.098], [0.2, 0.094], [0.228, 0.085], [0.246, 0.072], [0.252, 0.058], [0.25, 0.044],
    [0.24, 0.03], [0.236, 0.016], [0.239, -0.004], [0.237, -0.03], [0.229, -0.06], [0.215, -0.08], [0.196, -0.089],
    [0.1, -0.093], [0.0, -0.095], [-0.08, -0.091], [-0.15, -0.079], [-0.2, -0.06], [-0.226, -0.032], [-0.235, 0.0],
    [-0.236, 0.04], [-0.232, 0.07], [-0.226, 0.088],
  ];
  const front = [[0.05, 0.03], [0.12, 0.03], [0.168, 0.022], [0.188, 0.002], [0.194, -0.028], [0.188, -0.056], [0.17, -0.072], [0.06, -0.075], [0.036, -0.062], [0.03, -0.032], [0.033, 0.0], [0.04, 0.022]];
  const thumb = ellipsePts(-0.072, -0.03, 0.029, 0.036, b.hi ? 16 : 6).map(([u, v]) => [u - (v + 0.03) * 0.25, v]);
  b.side('polymer', outer, 0.055, 0, { holes: [front, thumb], bevel: 0.011, bevelSeg: b.hi ? 3 : 1 });
  // Oberes Gehäuseband (dunkelgrau, etwas breiter) mit Spannhebel-Schlitz
  b.side('polymerGrey', [[-0.21, 0.07], [0.17, 0.07], [0.205, 0.078], [0.228, 0.086], [0.205, 0.1], [-0.21, 0.1]], 0.058, 0, { bevel: 0.004 });
  if (b.hi) {
    for (const s of [-1, 1]) {
      b.box('cavity', 0.001, 0.004, 0.07, s * 0.0291, 0.074, 0.15, { c: 0 });
      // Griffrillen am Vordergriff
      for (let i = 0; i < 5; i++) b.box('polymer', 0.004, 0.0025, 0.016, s * 0.0262, -0.01 - i * 0.012, 0.214, { c: 0 });
    }
    // Wahlschalter-Scheibe unter dem Abzug, Riemenöse, Schrauben
    b.cyl('polymerGrey', 0.011, 0.011, 0.04, 0, -0.084, 0.09, { axis: 'v', seg: 16 });
    b.cyl('steel', 0.0045, 0.0045, 0.062, 0, 0.02, -0.215, { axis: 'x', seg: 8 });
    for (const [u, v] of [[-0.17, 0.04], [0.13, 0.045], [-0.12, -0.06], [0.0, 0.06]]) { b.screw('steel', 0.0278, v, u, 'x', 0.0026); b.screw('steel', -0.0278, v, u, 'x', 0.0026); }
  }
  // Schaftkappe (Gummi) hinten
  b.side('rubber', [[-0.226, 0.088], [-0.236, 0.06], [-0.24, 0.0], [-0.232, -0.034], [-0.22, -0.05], [-0.228, -0.02], [-0.23, 0.04]], 0.05, 0, { bevel: 0.004 });
  // Transluzentes Magazin oben mit sichtbaren, quer liegenden Patronen
  b.part('mag', 0, 0.116, 0.0);
  b.box('smoke', 0.05, 0.03, 0.34, 0, 0.114, 0.0, { part: 'mag', r: 0.007 });
  b.box('polymer', 0.052, 0.02, 0.028, 0, 0.112, -0.178, { part: 'mag', c: 0.003 });
  if (b.hi) {
    for (let i = 0; i < 14; i++) for (const row of [0, 1]) {
      const u = -0.15 + i * 0.022 + row * 0.011, v = 0.108 + row * 0.01;
      b.cyl('brass', 0.0034, 0.0034, 0.032, -0.004, v, u, { part: 'mag', axis: 'x', seg: 6 });
      b.cyl('copper', 0.0008, 0.0034, 0.008, 0.016, v, u, { part: 'mag', axis: 'x', seg: 6 });
    }
  } else {
    b.box('brass', 0.04, 0.02, 0.31, 0, 0.113, 0.0, { part: 'mag' });
  }
  b.anchor('magGrab', 0, 0.13, -0.09, { part: 'mag' });
  // Visierbrücke über dem Magazin + Ringvisier
  for (const s of [-1, 1]) b.side('polymer', [[-0.02, 0.095], [0.085, 0.095], [0.074, 0.138], [-0.008, 0.138]], 0.006, s * 0.0285, { bevel: 0.0018 });
  b.box('polymer', 0.063, 0.007, 0.08, 0, 0.1365, 0.033, { c: 0.0025 });
  const sAxis = redDot(b, 0.008, 0.14, { style: 'ring', mat: 'polymer' });
  // Lauf + Mündungsfeuerdämpfer vorn
  b.cyl('steelDark', 0.0085, 0.0085, 0.04, 0, axis, 0.262, { seg: b.seg(12, 6) });
  b.lathe('steelDark', [[0, 0], [0, 0.0105], [0.004, 0.011], [0.03, 0.011], [0.032, 0.0088], [0.032, 0.005]], 0, axis, 0.272, { seg: b.seg(12, 6) });
  if (b.hi) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.box('cavity', 0.0025, 0.0025, 0.016, Math.cos(a) * 0.0105, axis + Math.sin(a) * 0.0105, 0.292, { rz: a, c: 0 }); }
  b.circle('cavity', 0.0045, 0, axis, 0.3045);
  b.anchor('muzzle', 0, axis, 0.305);
  // Spannhebel beidseitig vorn (animiert)
  b.part('charge', 0, 0.074, 0.18);
  for (const s of [-1, 1]) b.box('polymerGrey', 0.008, 0.009, 0.014, s * 0.032, 0.074, 0.185, { part: 'charge', c: 0.002 });
  b.anchor('chargeGrab', -0.037, 0.074, 0.185, { part: 'charge', data: { travel: [0, 0, 0.06], style: 'pull' } });
  // Abzug in der vorderen Öffnung
  b.side('polymer', [[0.044, 0.028], [0.054, 0.028], [0.056, 0.0], [0.049, -0.016], [0.045, -0.004]], 0.008, 0, { bevel: 0.001 });
  // Hülsenauswurf nach unten durch den Griff
  b.anchor('ejection', 0, -0.094, -0.01, { rz: -Math.PI / 2 });
  b.part('bolt', 0, axis, 0.0);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.22 } });
  b.anchor('magWell', 0, 0.116, 0.0);
  b.anchor('leftHandGrip', 0, -0.03, 0.215, { data: { style: 'post', rake: 0.25 } });
  b.meta = { sight: 'reddot', axis, kind: 'smg', sightAxis: sAxis };
}

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
  if (b.hi) {
    b.box('paintOlive', 0.079, 0.012, 0.134, -0.065, 0.032, 0.1, { part: 'mag', c: 0.003 });
    b.box('steel', 0.03, 0.004, 0.012, -0.065, 0.04, 0.1, { part: 'mag', c: 0.001 });
    b.box('paintYellow', 0.0006, 0.018, 0.06, -0.1025, -0.01, 0.1, { part: 'mag', c: 0 });
    for (let i = 0; i < 4; i++) b.box('paintOlive', 0.002, 0.08, 0.004, -0.1035, -0.015, 0.05 + i * 0.033, { part: 'mag', c: 0 });
  }
  // Gurt: Patronen parallel zur Laufachse entlang eines Bogens vom Kasten ins Gehäuse
  b.part('belt', 0, 0, 0, 'mag');
  const nB = b.hi ? 9 : 3;
  for (let i = 0; i < nB; i++) {
    const t = i / (nB - 1);
    const x = -0.075 + t * 0.05 + Math.sin(t * Math.PI) * -0.012, v = 0.035 + t * 0.06 + Math.sin(t * Math.PI) * 0.018;
    if (b.hi) {
      b.cyl('brass', 0.0055, 0.0055, 0.05, x, v, 0.09, { part: 'belt', seg: 8 });
      b.cyl('copper', 0.0015, 0.0052, 0.016, x, v, 0.123, { part: 'belt', seg: 8 });
      b.box('steel', 0.012, 0.004, 0.008, x, v - 0.005, 0.075, { part: 'belt', c: 0.001 });
    } else if (i === 0) {
      b.box('brass', 0.03, 0.06, 0.05, -0.06, 0.06, 0.095, { part: 'belt', rz: -0.5 });
    }
  }
  b.anchor('magGrab', -0.105, -0.01, 0.1, { part: 'mag' });
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
  b.circle('cavity', 0.012, 0, axis, 0.9455);
  b.anchor('muzzle', 0, axis, 0.946);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.32 } });
  b.anchor('magWell', -0.06, 0.0, 0.1);
  b.anchor('sight', 0, 0.1405, -0.08, { data: { type: 'iron', eyeRelief: 0.22 } });
  b.anchor('leftHandGrip', 0, axis - 0.035, 0.32, { data: { style: 'under', r: 0.031 } });
  b.meta = { sight: 'iron', axis, kind: 'lmg' };
}
