// Welle 2 – Gewehre & MPs: K-36 Kurzer (AR-Karabiner, Rotpunkt), BX-20 Stier (Bullpup, 1,6×-Optik),
// G-7 Wächter (Kampfgewehr, Trommeldiopter), KM-7 Wespe (Kompakt-MP, Magazin im Griff),
// SM-45 Keiler (schwere MP, Rotpunkt), LM-8 Bär (Trommel-LMG mit Zweibein).
// Koordinaten wie alle Waffen: x rechts, v oben, u vorn (Lauf), Ursprung = Pistolengriff der rechten Hand.
import { redDot, acog, birdcage, brake, akBrake, ejectionPort, triggerGuard, arGrip, slots, roundRect, ellipsePts } from './parts.js';
import { arLower, arMag, octagon } from './guns-ar.js';
import { magRounds } from './magfill.js';

// Klappbares Kimme-/Korn-Paar (Ersatzvisier) – Korn vorn auf Höhe der Visierlinie
function postFront(b, mat, u, v, axis) {
  b.box(mat, 0.014, v - axis - 0.008, 0.012, 0, (v + axis) / 2 - 0.002, u, { c: 0.0015 });
  if (b.hi) {
    for (const s of [-1, 1]) b.box(mat, 0.003, 0.016, 0.01, s * 0.0085, v - 0.004, u, { c: 0.0008 });
    b.box('steel', 0.0022, 0.012, 0.003, 0, v - 0.006, u, { c: 0 });
  }
}

export function k36(b) {
  const axis = 0.093;
  arLower(b, { lowerMat: 'alu', upperMat: 'alu', gripMat: 'grip', axis });
  // Kurzer M-LOK-Handschutz (achteckig) bis vor den Gasblock
  b.front('alu', octagon(0.0235, axis), 0.17, 0.118, { bevel: 0.002 });
  b.rail('alu', 0, axis + 0.0218, 0.12, 0.286);
  for (const s of [-1, 1]) slots(b, s * 0.0218, axis, 0.14, 4, 0.034, 0.02, 0.007);
  slots(b, 0, axis - 0.0218, 0.14, 4, 0.034, 0.02, 0.007, Math.PI / 2);
  if (b.hi) {
    // Abgewinkelter Vordergriff-Stummel (Handstopp) + Riemenöse vorn
    b.side('polymer', [[0.2, axis - 0.022], [0.262, axis - 0.022], [0.252, axis - 0.042], [0.236, axis - 0.046], [0.214, axis - 0.034]], 0.018, 0, { bevel: 0.002 });
    b.torus('steel', 0.006, 0.0014, -0.024, axis - 0.01, 0.276, { ry: Math.PI / 2, tseg: 12 });
  }
  // Kurzer Lauf, Gasblock unter dem Handschutz, Mündungsbremse
  b.cyl('steelDark', 0.0096, 0.0096, 0.06, 0, axis, 0.318, { seg: b.seg(14, 6) });
  const end = brake(b, 0.346, axis, 0.0118, 0.052);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Skelettschaft (Polymer) auf dem Pufferrohr
  b.side('polymer', [
    [-0.165, 0.112], [-0.2, 0.118], [-0.262, 0.12], [-0.276, 0.114], [-0.276, 0.004], [-0.266, -0.004], [-0.25, 0.0],
    [-0.236, 0.03], [-0.205, 0.064], [-0.172, 0.074], [-0.165, 0.08],
  ], 0.03, 0, { bevel: 0.0035, bevelSeg: 2, holes: [[[-0.25, 0.04], [-0.2, 0.08], [-0.19, 0.1], [-0.252, 0.104]]] });
  b.box('rubber', 0.034, 0.124, 0.012, 0, 0.06, -0.282, { c: 0.004 });
  if (b.hi) b.box('polymer', 0.01, 0.009, 0.044, 0, 0.074, -0.2, { c: 0.002 });
  // Rotpunkt (Röhre) auf der Schiene
  redDot(b, 0.0, 0.124);
  arMag(b, 'smokeDark');
  b.anchor('leftHandGrip', 0, axis - 0.024, 0.232, { data: { style: 'under', r: 0.024 } });
  b.meta = { sight: 'reddot', axis, kind: 'rifle' };
}

export function bx20(b) {
  const axis = 0.074;
  // Bullpup-Schale (Polymer, Oliv): Gehäuse vom Schaftende bis vor den Griff, Abzugsbügel umschließt die ganze Hand
  b.side('polymerOD', [
    [-0.37, 0.1], [-0.08, 0.104], [0.06, 0.104], [0.13, 0.098], [0.17, 0.088], [0.18, 0.06], [0.17, 0.046], [0.06, 0.04],
    [0.04, 0.03], [-0.07, 0.03], [-0.09, 0.0], [-0.18, -0.006], [-0.36, -0.02], [-0.372, -0.012], [-0.376, 0.09],
  ], 0.05, 0, { bevel: 0.006, bevelSeg: 2 });
  // Großer Bügel vorn (Handschutz für die Schusshand)
  b.side('polymerOD', [[0.06, 0.04], [0.074, 0.03], [0.07, -0.06], [0.05, -0.078], [0.03, -0.078], [0.046, -0.06], [0.05, 0.03]], 0.026, 0, { bevel: 0.003 });
  b.side('polymerOD', [[0.05, -0.078], [-0.05, -0.08], [-0.05, -0.066], [0.04, -0.064]], 0.022, 0, { bevel: 0.002 });
  arGrip(b, 'grip', { top: 0.034 });
  triggerGuard(b, 'polymerOD', 0.012, 0.05, 0.03, 0.024, { t: 0.004, trigPos: 0.4 });
  // Wangenauflage + Schaftkappe
  b.box('rubber', 0.052, 0.122, 0.014, 0, 0.04, -0.378, { c: 0.005 });
  if (b.hi) {
    b.box('polymer', 0.048, 0.012, 0.16, 0, 0.106, -0.26, { c: 0.004 });
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.box('cavity', 0.0012, 0.004, 0.028, s * 0.0252, 0.06, -0.33 + i * 0.036, { c: 0 });
    for (const s of [-1, 1]) b.box('steel', 0.003, 0.012, 0.012, s * 0.026, 0.08, -0.03, { c: 0.001 });      // Querbolzen
  }
  // Auswurffenster rechts nahe der Wange (Bullpup), Verschluss
  ejectionPort(b, 0.0255, axis, -0.14, 0.06, 0.018);
  b.part('bolt', 0, axis, -0.14);
  b.box('steelBright', 0.004, 0.014, 0.05, 0.022, axis, -0.14, { part: 'bolt', c: 0.001 });
  // Lauf mit Gasrohr, Mündungsfeuerdämpfer
  b.cyl('steelDark', 0.0105, 0.0105, 0.25, 0, axis, 0.3, { seg: b.seg(14, 6) });
  b.cyl('steel', 0.006, 0.006, 0.16, 0, axis + 0.022, 0.24, { seg: b.seg(10, 5) });
  b.box('steel', 0.022, 0.03, 0.024, 0, axis + 0.01, 0.31, { c: 0.003 });
  const end = birdcage(b, 0.425, axis, 0.0112);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Klapp-Vordergriff (Polymer)
  b.side('polymerOD', [[0.145, 0.046], [0.19, 0.046], [0.186, 0.0], [0.18, -0.06], [0.172, -0.072], [0.152, -0.072], [0.146, -0.06], [0.148, 0.0]], 0.026, 0, { bevel: 0.006, bevelSeg: 2 });
  if (b.hi) for (let i = 0; i < 4; i++) b.box('cavity', 0.027, 0.003, 0.004, 0, -0.01 - i * 0.014, 0.188, { c: 0 });
  // Ladehebel links vorn (Schlitz in der Schale)
  b.part('charge', -0.026, 0.09, 0.11);
  b.box('steel', 0.012, 0.008, 0.012, -0.03, 0.09, 0.11, { part: 'charge', c: 0.002 });
  b.cyl('polymer', 0.0055, 0.0055, 0.016, -0.04, 0.09, 0.11, { part: 'charge', axis: 'x', seg: b.seg(10, 5) });
  b.anchor('chargeGrab', -0.046, 0.09, 0.112, { part: 'charge', data: { travel: [0, 0, 0.085], style: 'pull' } });
  if (b.hi) b.box('cavity', 0.002, 0.006, 0.1, -0.0252, 0.09, 0.07, { c: 0 });
  // Integrierte Optik (Tragegriff-Zielfernrohr) mit Ersatz-Kimme
  b.side('polymerOD', [[-0.13, 0.104], [-0.11, 0.122], [0.07, 0.122], [0.1, 0.104]], 0.03, 0, { bevel: 0.003 });
  acog(b, -0.075, 0.122);
  // Magazin hinter dem Griff (gebogen, durchscheinend rauchgrau wie beim Vorbild – Patronen sichtbar)
  b.part('mag', 0, 0.0, -0.14);
  b.side('smokeGrey', [[-0.112, 0.032], [-0.11, -0.02], [-0.1, -0.08], [-0.088, -0.13], [-0.134, -0.142], [-0.148, -0.088], [-0.158, -0.026], [-0.164, 0.032]], 0.022, 0, { part: 'mag', bevel: 0.002 });
  b.box('polymer', 0.027, 0.008, 0.05, 0, -0.139, -0.11, { part: 'mag', rx: -0.25, c: 0.002 });
  if (b.hi) {
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) b.box('polymer', 0.0016, 0.004, 0.044, s * 0.0118, -0.06 - i * 0.022, -0.128 + i * 0.006, { part: 'mag', rx: -0.18, c: 0 });
  }
  magRounds(b, { cal: 'r556', width: 0.019, depth: 0.044, show: 'all', path: [[0, 0.036, -0.138], [0, -0.02, -0.134], [0, -0.08, -0.1235], [0, -0.12, -0.113]] });
  b.anchor('magGrab', 0, -0.07, -0.128, { part: 'mag', data: { w: 0.0113, d: 0.028 } });
  b.anchor('magWell', 0, 0.0, -0.14);
  b.anchor('boltCatch', -0.0255, 0.02, -0.06);
  b.anchor('rightHandGrip', 0, 0.0, 0, { data: { rake: 0.32, gw: 0.015, gd: 0.023, gu: 0.0, ho: 0.018, tu: 0.034 } });
  b.anchor('leftHandGrip', 0, -0.02, 0.168, { data: { style: 'post', rake: 0.08, gw: 0.016, gd: 0.02, gu: 0, ho: 0.012 } });
  b.meta = { sight: 'acog', axis, kind: 'rifle' };
}

export function g7(b) {
  const axis = 0.074;
  // Geprägtes Stahlgehäuse (rund oben), Spannhebelrohr darüber
  b.front('steel', roundRect(-0.0195, 0.04, 0.0195, 0.104, 0.014, b.hi ? 4 : 1), 0.33, -0.1, { bevel: 0.0015 });
  if (b.hi) {
    for (const s of [-1, 1]) b.box('steel', 0.002, 0.007, 0.25, s * 0.0198, 0.056, 0.06, { c: 0.0008 });
    for (const [u, v] of [[-0.08, 0.05], [0.16, 0.05], [-0.09, 0.09]]) { b.screw('steelBright', 0.0201, v, u, 'x', 0.003); b.screw('steelBright', -0.0201, v, u, 'x', 0.003); }
  }
  b.cyl('steel', 0.0125, 0.0125, 0.27, 0, 0.096, 0.36, { seg: b.seg(14, 6) });
  b.part('charge', -0.013, 0.1, 0.36);
  b.box('steel', 0.005, 0.006, 0.03, -0.013, 0.1, 0.36, { part: 'charge', c: 0.001 });
  b.box('steel', 0.024, 0.006, 0.006, -0.024, 0.104, 0.372, { part: 'charge', rz: 0.5, c: 0.0012 });
  b.cyl('polymer', 0.0055, 0.0055, 0.014, -0.037, 0.11, 0.372, { part: 'charge', axis: 'x', rz: 0.5, seg: b.seg(10, 5) });
  b.anchor('chargeGrab', -0.04, 0.112, 0.372, { part: 'charge', data: { travel: [0, 0, 0.085], style: 'hkslap' } });
  if (b.hi) b.box('cavity', 0.002, 0.004, 0.11, -0.0125, 0.098, 0.31, { c: 0 });
  // Trommeldiopter hinten + Ringkorn vorn
  const sv = 0.131;
  b.box('steel', 0.03, 0.012, 0.03, 0, 0.11, -0.075, { c: 0.002 });
  b.cyl('steel', 0.008, 0.008, 0.03, 0, 0.118, -0.075, { axis: 'x', seg: b.seg(14, 6) });
  b.front('steel', ellipsePts(0, sv, 0.013, 0.013, b.seg(24, 8)), 0.01, -0.08, { holes: [ellipsePts(0, sv, 0.0044, 0.0044, b.seg(16, 6))], bevel: 0.0012, curveSeg: 6 });
  if (b.hi) for (const s of [-1, 1]) b.side('steel', [[-0.09, 0.112], [-0.06, 0.112], [-0.062, 0.137], [-0.07, 0.143], [-0.083, 0.143], [-0.09, 0.136]], 0.0035, s * 0.0168, { bevel: 0.0008 });
  b.box('steel', 0.018, 0.016, 0.024, 0, 0.11, 0.47, { c: 0.002 });
  b.torus('steel', 0.011, 0.0028, 0, sv - 0.002, 0.47, { seg: b.seg(8, 4), tseg: b.seg(20, 8) });
  b.cyl('steel', 0.0012, 0.0016, 0.014, 0, sv - 0.006, 0.47, { axis: 'v', seg: 6 });
  // Lauf, Kornträger, Mündungsfeuerdämpfer (Schlitze)
  b.cyl('steelDark', 0.0105, 0.0105, 0.14, 0, axis, 0.54, { seg: b.seg(14, 6) });
  const end = birdcage(b, 0.61, axis, 0.0118);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Breiter Handschutz (Polymer, Rillen)
  b.side('polymer', [[0.2, 0.084], [0.44, 0.084], [0.452, 0.076], [0.452, 0.046], [0.44, 0.032], [0.215, 0.028], [0.2, 0.034]], 0.048, 0, { bevel: 0.006, bevelSeg: 2 });
  if (b.hi) for (let i = 0; i < 7; i++) for (const s of [-1, 1]) b.box('cavity', 0.0015, 0.005, 0.024, s * 0.0238, 0.056, 0.222 + i * 0.03, { c: 0 });
  // Auswurffenster + Verschluss
  ejectionPort(b, 0.0196, 0.072, 0.05, 0.056, 0.018);
  b.part('bolt', 0, 0.072, 0.05);
  b.box('steelBright', 0.004, 0.014, 0.05, 0.017, 0.072, 0.05, { part: 'bolt', c: 0.001 });
  // Griffstück + Pistolengriff, Abzugsbügel
  b.side('polymer', [[-0.07, 0.042], [0.095, 0.042], [0.095, 0.022], [0.08, 0.016], [-0.04, 0.016], [-0.07, 0.026]], 0.034, 0, { bevel: 0.003 });
  b.side('grip', [[0.03, 0.018], [0.026, -0.01], [0.018, -0.042], [0.012, -0.07], [0.002, -0.083], [-0.028, -0.083], [-0.032, -0.072], [-0.022, -0.04], [-0.016, -0.01], [-0.02, 0.018]], 0.035, 0, { bevel: 0.008, bevelSeg: 2 });
  triggerGuard(b, 'polymer', 0.032, 0.088, 0.018, 0.034, { t: 0.006, w: 0.016, trigPos: 0.25 });
  if (b.hi) {
    b.box('polymer', 0.005, 0.012, 0.016, 0.018, 0.03, -0.03, { c: 0.001 });
    b.box('paintWhite', 0.0005, 0.003, 0.003, 0.0206, 0.03, -0.042, { c: 0 });
    b.box('paintSignal', 0.0005, 0.003, 0.003, 0.0206, 0.03, -0.018, { c: 0 });
  }
  // Fester Schaft (Polymer, schwarz)
  b.side('polymer', [
    [-0.1, 0.104], [-0.14, 0.106], [-0.36, 0.11], [-0.372, 0.104], [-0.374, -0.03], [-0.36, -0.04], [-0.3, -0.03],
    [-0.2, 0.008], [-0.12, 0.03], [-0.1, 0.04],
  ], 0.042, 0, { bevel: 0.006, bevelSeg: 2 });
  b.box('rubber', 0.046, 0.15, 0.012, 0, 0.035, -0.38, { c: 0.004 });
  // Stahlmagazin (gerade, 20 Schuss)
  b.box('steel', 0.032, 0.028, 0.05, 0, 0.03, 0.12, { c: 0.002 });
  b.part('mag', 0, 0.02, 0.12);
  b.side('steel', [[0.096, 0.024], [0.098, -0.04], [0.104, -0.112], [0.154, -0.11], [0.15, -0.04], [0.146, 0.024]], 0.026, 0, { part: 'mag', bevel: 0.0018 });
  b.box('steel', 0.03, 0.007, 0.056, 0, -0.114, 0.129, { part: 'mag', rx: -0.06, c: 0.002 });
  if (b.hi) {
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) b.box('steel', 0.0016, 0.026, 0.004, s * 0.0135, -0.06, 0.106 + i * 0.016, { part: 'mag', c: 0 });
  }
  // Stahl (7,62 NATO, gestaucht): oberste Patronen an den Lippen bzw. leerer Zubringer
  magRounds(b, { cal: 'r308', fit: 0.046, width: 0.023, depth: 0.048, path: [[0, 0.03, 0.121], [0, -0.04, 0.124], [0, -0.097, 0.128]] });
  b.anchor('magGrab', 0, -0.06, 0.128, { part: 'mag', data: { w: 0.013, d: 0.026 } });
  b.anchor('magWell', 0, 0.02, 0.12);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.3, gw: 0.0175, gd: 0.022, gu: 0.005, ho: 0.044, tu: 0.02 } });
  b.anchor('sight', 0, sv, -0.08, { data: { type: 'iron', eyeRelief: 0.14 } });
  b.anchor('leftHandGrip', 0, 0.028, 0.33, { data: { style: 'under', w: 0.024, h: 0.026 } });
  b.meta = { sight: 'iron', axis, kind: 'rifle' };
}

export function wespe(b) {
  const axis = 0.058;
  // Kompaktes Polymergehäuse, Spannhebel oben hinten (T-Griff), Magazin im Pistolengriff
  b.side('polymer', [
    [-0.1, 0.086], [0.13, 0.086], [0.142, 0.078], [0.142, 0.03], [0.13, 0.02], [0.05, 0.016], [0.036, 0.008], [-0.03, 0.008], [-0.1, 0.03],
  ], 0.034, 0, { bevel: 0.004, bevelSeg: 2 });
  b.rail('polymer', 0, 0.086, -0.08, 0.12, { w: 0.018 });
  if (b.hi) {
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.box('cavity', 0.0013, 0.004, 0.02, s * 0.0172, 0.05, 0.06 + i * 0.022, { c: 0 });
    for (const s of [-1, 1]) b.screw('steel', s * 0.0172, 0.07, -0.06, 'x', 0.0026);
  }
  // Griff mit Magazinschacht (Magazin fällt entlang der Griffachse)
  const rake = 0.2;
  b.side('grip', [[0.03, 0.01], [0.032, -0.04], [0.024, -0.1], [0.016, -0.112], [-0.022, -0.112], [-0.028, -0.1], [-0.02, -0.04], [-0.024, 0.01]], 0.034, 0, { bevel: 0.007, bevelSeg: 2, rx: 0 });
  triggerGuard(b, 'polymer', 0.034, 0.09, 0.012, 0.034, { t: 0.005, w: 0.014, trigPos: 0.2 });
  b.part('mag', 0, -0.112, 0.004);
  b.box('steel', 0.022, 0.15, 0.03, 0, -0.04, 0.004, { part: 'mag', rx: -rake * 0.4, c: 0.0015 });
  b.box('polymer', 0.028, 0.012, 0.036, 0, -0.118, 0.006, { part: 'mag', rx: -rake * 0.4, c: 0.003 });
  // Stahl (9 mm): oberste Patronen an den Lippen bzw. leerer Zubringer, entlang der leicht geneigten Achse
  magRounds(b, { cal: 'p9', fit: 0.027, width: 0.019, depth: 0.028, path: [[0, 0.0398, 0.0104], [0, -0.1, -0.0008]] });
  b.anchor('magGrab', 0, -0.116, 0.01, { part: 'mag', data: { w: 0.012, d: 0.018 } });
  b.anchor('magWell', 0, -0.112, 0.004);
  // Lauf + Mündungsgewinde, Korn und Kimme (offen)
  b.cyl('steelDark', 0.0082, 0.0082, 0.06, 0, axis, 0.17, { seg: b.seg(12, 6) });
  b.cyl('steelDark', 0.0098, 0.0098, 0.016, 0, axis, 0.204, { seg: b.seg(12, 6) });
  b.circle('cavity', 0.0042, 0, axis, 0.2122);
  b.anchor('muzzle', 0, axis, 0.214);
  const sv = 0.104;
  postFront(b, 'polymer', 0.122, sv, 0.086);
  b.box('polymer', 0.026, 0.012, 0.016, 0, 0.094, -0.07, { c: 0.002 });
  if (b.hi) for (const s of [-1, 1]) b.box('polymer', 0.007, 0.012, 0.012, s * 0.0075, sv - 0.004, -0.07, { c: 0.001 });
  // Spannhebel (T-Griff hinten oben)
  b.part('charge', 0, 0.082, -0.1);
  b.box('polymer', 0.01, 0.008, 0.02, 0, 0.078, -0.1, { part: 'charge', c: 0.0015 });
  b.box('polymer', 0.036, 0.008, 0.01, 0, 0.078, -0.112, { part: 'charge', c: 0.002 });
  b.anchor('chargeGrab', -0.014, 0.078, -0.114, { part: 'charge', data: { travel: [0, 0, 0.055], style: 'pull' } });
  // Auswurf rechts, Verschluss
  ejectionPort(b, 0.0172, 0.062, 0.03, 0.036, 0.014);
  b.part('bolt', 0, 0.062, 0.03);
  b.box('steelBright', 0.004, 0.01, 0.03, 0.0145, 0.062, 0.03, { part: 'bolt', c: 0.001 });
  // Klappbarer Vordergriff (eingeklappt nach unten) + Teleskopschaft (Drahtstreben)
  b.side('polymer', [[0.1, 0.018], [0.13, 0.018], [0.128, -0.05], [0.12, -0.06], [0.106, -0.06], [0.1, -0.05]], 0.024, 0, { bevel: 0.005, bevelSeg: 2 });
  for (const s of [-1, 1]) b.box('steel', 0.004, 0.006, 0.17, s * 0.0155, 0.07, -0.18, { c: 0.001 });
  b.box('rubber', 0.04, 0.07, 0.012, 0, 0.05, -0.268, { c: 0.004 });
  b.anchor('rightHandGrip', 0, -0.012, 0, { data: { rake, gw: 0.016, gd: 0.022, gu: 0.0, ho: 0.03, tu: 0.04 } });
  b.anchor('sight', 0, sv, -0.07, { data: { type: 'iron', eyeRelief: 0.16 } });
  b.anchor('leftHandGrip', 0, -0.02, 0.115, { data: { style: 'post', rake: 0.05, gw: 0.012, gd: 0.014, gu: 0, ho: 0.01 } });
  b.meta = { sight: 'iron', axis, kind: 'smg' };
}

export function keiler(b) {
  const axis = 0.066;
  // Polymergehäuse (kantig, UMP-artig) mit Schiene oben
  b.side('polymer', [
    [-0.09, 0.098], [0.24, 0.098], [0.252, 0.09], [0.252, 0.046], [0.24, 0.036], [0.11, 0.032], [0.1, 0.02], [-0.05, 0.02], [-0.09, 0.04],
  ], 0.044, 0, { bevel: 0.005, bevelSeg: 2 });
  b.rail('alu', 0, 0.098, -0.07, 0.24);
  for (const s of [-1, 1]) b.rail('alu', s * 0.022, 0.07, 0.17, 0.235, { rz: -s * Math.PI / 2, flat: true });
  if (b.hi) {
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.box('cavity', 0.0013, 0.006, 0.012, s * 0.0222, 0.05, 0.12 + i * 0.02, { c: 0 });
    for (const s of [-1, 1]) for (const u of [-0.06, 0.08]) b.screw('steel', s * 0.0222, 0.084, u, 'x', 0.0028);
  }
  // Griff (integriert), Abzugsbügel
  arGrip(b, 'grip', { top: 0.024, w: 0.032 });
  triggerGuard(b, 'polymer', 0.02, 0.07, 0.022, 0.03, { t: 0.006, w: 0.016, trigPos: 0.3 });
  // Kastenmagazin (gerade, breit: .45)
  b.box('polymer', 0.034, 0.024, 0.046, 0, 0.02, 0.135, { c: 0.002 });
  b.part('mag', 0, 0.01, 0.135);
  // Durchscheinendes Rauch-Polymer (wie beim Vorbild): .45-Doppelreihe sichtbar, Rippen und Boden undurchsichtig
  b.side('smokeDark', [[0.112, 0.016], [0.114, -0.05], [0.118, -0.13], [0.16, -0.13], [0.16, -0.05], [0.158, 0.016]], 0.03, 0, { part: 'mag', bevel: 0.0022 });
  b.box('polymer', 0.034, 0.008, 0.052, 0, -0.134, 0.139, { part: 'mag', c: 0.002 });
  if (b.hi) {
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.box('polymer', 0.0016, 0.004, 0.04, s * 0.0152, -0.04 - i * 0.02, 0.138, { part: 'mag', c: 0 });
  }
  magRounds(b, { cal: 'p45', width: 0.027, depth: 0.044, show: 'all', path: [[0, 0.022, 0.135], [0, -0.05, 0.137], [0, -0.117, 0.139]] });
  b.anchor('magGrab', 0, -0.07, 0.137, { part: 'mag', data: { w: 0.015, d: 0.024 } });
  b.anchor('magWell', 0, 0.01, 0.135);
  // Lauf mit Kompensator
  b.cyl('steelDark', 0.0105, 0.0105, 0.07, 0, axis, 0.285, { seg: b.seg(14, 6) });
  const end = akBrake(b, 0.32, axis);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Spannhebel links vorn (nicht mitlaufend)
  b.part('charge', -0.024, 0.08, 0.22);
  b.box('steel', 0.01, 0.008, 0.016, -0.027, 0.08, 0.22, { part: 'charge', c: 0.0015 });
  b.box('polymer', 0.014, 0.012, 0.012, -0.034, 0.08, 0.222, { part: 'charge', c: 0.003 });
  b.anchor('chargeGrab', -0.04, 0.08, 0.222, { part: 'charge', data: { travel: [0, 0, 0.07], style: 'pull' } });
  if (b.hi) b.box('cavity', 0.002, 0.005, 0.09, -0.0222, 0.08, 0.18, { c: 0 });
  // Auswurffenster rechts + Verschluss
  ejectionPort(b, 0.0222, 0.072, 0.03, 0.05, 0.018);
  b.part('bolt', 0, 0.072, 0.03);
  b.box('steelBright', 0.004, 0.014, 0.045, 0.019, 0.072, 0.03, { part: 'bolt', c: 0.001 });
  // Seitlich klappbarer Schaft (ausgeklappt)
  b.side('polymer', [
    [-0.09, 0.09], [-0.12, 0.096], [-0.27, 0.1], [-0.28, 0.094], [-0.28, 0.004], [-0.27, -0.004], [-0.24, 0.006],
    [-0.2, 0.03], [-0.13, 0.048], [-0.09, 0.05],
  ], 0.03, 0, { bevel: 0.004, bevelSeg: 2, holes: [[[-0.245, 0.03], [-0.15, 0.06], [-0.15, 0.08], [-0.25, 0.08]]] });
  b.box('rubber', 0.034, 0.1, 0.012, 0, 0.05, -0.286, { c: 0.004 });
  if (b.hi) b.cyl('steel', 0.0065, 0.0065, 0.036, 0, 0.07, -0.09, { axis: 'v', seg: 10 });   // Klappgelenk
  // Rotpunkt (Ring) auf der Schiene
  redDot(b, -0.02, 0.106, { style: 'ring' });
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.32, gw: 0.016, gd: 0.023, gu: 0.0, ho: 0.02, tu: 0.034 } });
  b.anchor('leftHandGrip', 0, 0.034, 0.205, { data: { style: 'under', w: 0.022, h: 0.024 } });
  b.meta = { sight: 'reddot', axis, kind: 'smg' };
}

export function lm8(b) {
  const axis = 0.08;
  // Schweres Stahlgehäuse (kastenförmig) mit Deckel, Schiene, Tragegriff
  b.front('steel', roundRect(-0.021, 0.036, 0.021, 0.108, 0.006, b.hi ? 3 : 1), 0.34, -0.1, { bevel: 0.0018 });
  if (b.hi) {
    for (const s of [-1, 1]) { b.box('steel', 0.002, 0.008, 0.3, s * 0.0212, 0.06, 0.07, { c: 0.0008 }); for (const u of [-0.07, 0.04, 0.2]) b.screw('steelBright', s * 0.0215, 0.09, u, 'x', 0.003); }
  }
  b.rail('steel', 0, 0.108, -0.08, 0.2);
  // Ladehebel rechts (wie KV-47)
  b.part('charge', 0.03, 0.07, 0.14);
  b.box('steel', 0.012, 0.01, 0.04, 0.024, 0.07, 0.14, { part: 'charge', c: 0.002 });
  b.cyl('steel', 0.006, 0.006, 0.02, 0.036, 0.07, 0.148, { part: 'charge', axis: 'x', seg: b.seg(10, 5) });
  b.anchor('chargeGrab', 0.046, 0.07, 0.148, { part: 'charge', data: { travel: [0, 0, 0.09], style: 'right' } });
  // Auswurf rechts + Verschluss
  ejectionPort(b, 0.0212, 0.082, 0.05, 0.06, 0.02);
  b.part('bolt', 0, 0.082, 0.05);
  b.box('steelBright', 0.004, 0.015, 0.055, 0.018, 0.082, 0.05, { part: 'bolt', c: 0.001 });
  // Schwerer Lauf mit Kühlrippen, Tragegriff, Zweibein (eingeklappt), Mündungsfeuerdämpfer
  b.cyl('steelDark', 0.0135, 0.0135, 0.36, 0, axis, 0.42, { seg: b.seg(16, 6) });
  if (b.hi) for (let i = 0; i < 10; i++) b.cyl('steelDark', 0.0158, 0.0158, 0.006, 0, axis, 0.3 + i * 0.016, { seg: 16 });
  const end = birdcage(b, 0.6, axis, 0.0135);
  b.anchor('muzzle', 0, axis, end + 0.002);
  b.box('steel', 0.034, 0.03, 0.03, 0, axis + 0.004, 0.28, { c: 0.003 });
  b.box('polymer', 0.014, 0.012, 0.09, 0, axis + 0.06, 0.28, { c: 0.004 });
  for (const du of [-0.04, 0.04]) b.box('steel', 0.01, 0.042, 0.01, 0, axis + 0.034, 0.28 + du, { c: 0.002 });
  for (const s of [-1, 1]) {
    b.box('steel', 0.007, 0.007, 0.22, s * 0.012, axis - 0.022, 0.43, { rx: 0.03, c: 0.0015 });
    b.box('rubber', 0.01, 0.01, 0.022, s * 0.012, axis - 0.026, 0.326, { c: 0.002 });
  }
  b.cyl('steel', 0.012, 0.012, 0.04, 0, axis - 0.012, 0.54, { axis: 'x', seg: b.seg(10, 5) });
  // Korn vorn (Säule mit Schutzohren), Kimme hinten (Visier mit Schieber)
  const sv = 0.134;
  postFront(b, 'steel', 0.57, sv, axis + 0.012);
  b.box('steel', 0.03, 0.02, 0.04, 0, 0.118, -0.06, { c: 0.002 });
  if (b.hi) for (const s of [-1, 1]) b.box('steel', 0.008, 0.016, 0.012, s * 0.008, sv - 0.004, -0.06, { c: 0.001 });
  // Handschutz (Polymer, breit) unter dem Lauf
  b.side('polymer', [[0.2, axis - 0.012], [0.33, axis - 0.012], [0.34, axis - 0.02], [0.34, axis - 0.046], [0.33, axis - 0.054], [0.21, axis - 0.054], [0.2, axis - 0.046]], 0.052, 0, { bevel: 0.006, bevelSeg: 2 });
  // Griff, Abzugsbügel, Schaft (Holz-Polymer, Daumenloch)
  arGrip(b, 'grip', { top: 0.036, w: 0.032 });
  triggerGuard(b, 'steel', 0.02, 0.07, 0.034, 0.03, { t: 0.005, w: 0.013, trigPos: 0.3 });
  b.side('polymer', [
    [-0.1, 0.106], [-0.4, 0.1], [-0.41, 0.094], [-0.41, -0.03], [-0.4, -0.04], [-0.34, -0.03], [-0.2, 0.0], [-0.12, 0.03], [-0.1, 0.036],
  ], 0.042, 0, { bevel: 0.006, bevelSeg: 2, holes: [[[-0.19, 0.03], [-0.13, 0.05], [-0.13, 0.08], [-0.19, 0.08]]] });
  b.box('rubber', 0.046, 0.142, 0.012, 0, 0.032, -0.414, { c: 0.004 });
  // Trommelmagazin (75 Schuss): flacher Zylinder unter dem Gehäuse + Zuführhals
  b.box('steel', 0.036, 0.022, 0.05, 0, 0.026, 0.115, { c: 0.002 });
  b.part('mag', 0, 0.02, 0.115);
  b.box('polymer', 0.03, 0.05, 0.046, 0, -0.01, 0.118, { part: 'mag', rx: -0.12, c: 0.003 });
  // Trommel: Mantel + rechte Wand undurchsichtig, linke Wand durchsichtig (Fenster: Patronenböden der Spirale
  // sichtbar, wie bei Trommeln mit Klarsichtdeckel). Innen ein nach innen gewandter Mantel + Innenwand rechts.
  b.cyl('polymer', 0.072, 0.072, 0.07, 0, -0.1, 0.13, { part: 'mag', axis: 'x', seg: b.seg(26, 10), open: b.hi });
  b.cyl('steel', 0.074, 0.074, 0.012, 0, -0.1, 0.13, { part: 'mag', axis: 'x', seg: b.seg(26, 10) });
  if (b.hi) {
    b.lathe('polymer', [[0.035, 0.0708], [-0.035, 0.0708]], 0, -0.1, 0.13, { part: 'mag', axis: 'x', seg: 26 });
    b.circle('polymer', 0.072, 0.035, -0.1, 0.13, { part: 'mag', ry: Math.PI / 2, seg: 26 });
    b.circle('polymer', 0.071, 0.0345, -0.1, 0.13, { part: 'mag', ry: -Math.PI / 2, seg: 26 });
    b.circle('smokeDark', 0.072, -0.035, -0.1, 0.13, { part: 'mag', ry: -Math.PI / 2, seg: 26 });
    for (const s of [-1, 1]) {
      b.cyl('steel', 0.024, 0.024, 0.006, s * 0.037, -0.1, 0.13, { part: 'mag', axis: 'x', seg: 16 });
      b.cyl('knurl', 0.008, 0.008, 0.012, s * 0.043, -0.1, 0.13, { part: 'mag', axis: 'x', seg: 12 });
      if (s > 0) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; b.box('polymer', 0.003, 0.008, 0.03, s * 0.0362, -0.1 + Math.sin(a) * 0.05, 0.13 + Math.cos(a) * 0.05, { part: 'mag', rx: -a, c: 0 }); }
    }
  }
  // Patronen (5,56): zwei im Hals, dann die Spirale von außen nach innen – leert sich von innen her
  magRounds(b, {
    cal: 'r556', width: 0.026, follower: false, neck: 2, path: [[0, 0.03, 0.115], [0, 0.0, 0.117], [0, -0.03, 0.121]],
    drum: { c: [0, -0.1, 0.13], r0: 0.0615, dr: 0.0105, rmin: 0.03, a0: 1.73 },
  });
  b.anchor('magGrab', -0.03, -0.1, 0.13, { part: 'mag', data: { w: 0.036, d: 0.07 } });
  b.anchor('magWell', 0, 0.02, 0.115);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.32, gw: 0.016, gd: 0.022, gu: 0.004, ho: 0.03, tu: 0.034 } });
  b.anchor('sight', 0, sv, -0.08, { data: { type: 'iron', eyeRelief: 0.2 } });
  b.anchor('leftHandGrip', 0, axis - 0.054, 0.27, { data: { style: 'under', w: 0.026, h: 0.022 } });
  b.meta = { sight: 'iron', axis, kind: 'lmg' };
}
