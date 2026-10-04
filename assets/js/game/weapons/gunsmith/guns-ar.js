// Sturmgewehre & Präzisionsgewehr: M-17 Falke (M4-artig, Holo), KV-47 (AK-artig, Holz), SK-14 (DMR, ACOG)
import { holoSight, acog, birdcage, akBrake, brake, ejectionPort, triggerGuard, arGrip, slots, roundRect, ellipsePts } from './parts.js';

// Achteckiger Querschnitt um (0, axis)
function octagon(r, axis) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    pts.push([Math.cos(a) * r, axis + Math.sin(a) * r]);
  }
  return pts;
}

// Gemeinsamer AR-Unterbau (Lower, Upper, Puffer, Griff, Abzug) – Grundlage für M-17 und SK-14
function arLower(b, { lowerMat = 'alu', upperMat = 'alu', gripMat = 'grip', axis = 0.093, upperFront = 0.118 } = {}) {
  // Unteres Gehäuse (Seitenprofil)
  b.side(lowerMat, [
    [-0.066, 0.071], [0.122, 0.071], [0.124, 0.03], [0.119, 0.004], [0.052, 0.002], [0.05, 0.034], [-0.028, 0.034], [-0.05, 0.04], [-0.066, 0.056],
  ], 0.022, 0, { bevel: 0.0022 });
  // Magazinschacht (breiter, ausgestellt)
  b.side(lowerMat, [[0.05, 0.05], [0.123, 0.05], [0.125, 0.006], [0.121, -0.002], [0.052, -0.002]], 0.027, 0, { bevel: 0.002 });
  // Oberes Gehäuse
  b.side(upperMat, [
    [-0.07, 0.07], [upperFront, 0.07], [upperFront, 0.108], [upperFront - 0.004, 0.115], [-0.064, 0.115], [-0.07, 0.11],
  ], 0.025, 0, { bevel: 0.0025 });
  // Schiene oben
  b.rail(upperMat, 0, 0.115, -0.064, upperFront);
  // Vorderer Hilfsschließer (rechts hinten)
  b.cyl(upperMat, 0.0075, 0.0085, 0.03, 0.016, 0.1, -0.035, { ry: -0.35, seg: b.seg(12, 5) });
  if (b.hi) b.cyl('steel', 0.0068, 0.0068, 0.008, 0.021, 0.1, -0.05, { ry: -0.35, seg: 12 });
  // Hülsenabweiser
  b.box(upperMat, 0.008, 0.016, 0.014, 0.014, 0.1, 0.003, { c: 0.003 });
  // Auswurffenster rechts + offener Staubschutzdeckel
  ejectionPort(b, 0.0127, 0.093, 0.047, 0.05, 0.018);
  if (b.hi) b.box('alu', 0.012, 0.0015, 0.05, 0.019, 0.081, 0.047, { rz: -0.5, c: 0 });
  // Verschlussträger im Fenster (animiert beim Schuss)
  b.part('bolt', 0, 0.093, 0.047);
  b.box('steelBright', 0.004, 0.014, 0.046, 0.0105, 0.093, 0.047, { part: 'bolt', c: 0.001 });
  // Ladehebel (T-Griff hinten, animiert)
  b.part('charge', 0, 0.108, -0.07);
  b.box(upperMat, 0.012, 0.007, 0.03, 0, 0.108, -0.072, { part: 'charge', c: 0.0015 });
  b.box(upperMat, 0.042, 0.008, 0.011, 0, 0.108, -0.083, { part: 'charge', c: 0.002 });
  b.anchor('chargeGrab', -0.012, 0.108, -0.085, { part: 'charge', data: { travel: [0, 0, 0.065], style: 'release' } });
  b.anchor('boltCatch', -0.0145, 0.062, 0.06);
  // Pufferrohr + Schlossmutter
  b.cyl('alu', 0.0145, 0.0145, 0.2, 0, axis, -0.165, { seg: b.seg(16, 6) });
  b.cyl('steel', 0.0175, 0.0175, 0.008, 0, axis, -0.074, { seg: b.seg(12, 6) });
  // Griff
  arGrip(b, gripMat);
  // Abzugsbügel + Abzug
  triggerGuard(b, lowerMat, 0.016, 0.052, 0.034, 0.028);
  // Bedienelemente
  if (b.hi) {
    b.box('steel', 0.004, 0.008, 0.012, 0.013, 0.058, 0.045, { c: 0.001 });                  // Magazinhalter
    b.box('steel', 0.004, 0.018, 0.008, -0.013, 0.06, 0.06, { c: 0.001 });                   // Verschlussfang
    b.box('steel', 0.004, 0.005, 0.018, -0.0125, 0.056, -0.012, { rx: 0.4, c: 0.001 });       // Sicherung
    for (const [u, v] of [[0.0, 0.05], [0.06, 0.06], [-0.045, 0.06], [0.108, 0.095]]) { b.screw('steel', 0.0118, v, u, 'x', 0.0026); b.screw('steel', -0.0118, v, u, 'x', 0.0026); }
  }
  b.anchor('rightHandGrip', 0, 0.0, 0, { data: { rake: 0.32, gw: 0.015, gd: 0.023, gu: 0.0, ho: 0.018, tu: 0.034 } });
  b.anchor('magWell', 0, 0.0, 0.088);
}

// PMAG-artiges Polymermagazin, Teil 'mag' mit Drehpunkt im Schacht
function arMag(b, mat, o = {}) {
  const len = o.len ?? 1;
  b.part('mag', 0, 0.0, 0.088);
  const pts = [
    [0.118, 0.045], [0.119, 0.0], [0.124, -0.05 * len], [0.133, -0.1 * len], [0.146, -0.142 * len],
    [0.09, -0.152 * len], [0.077, -0.104 * len], [0.066, -0.052 * len], [0.059, 0.0], [0.058, 0.045],
  ];
  b.side(mat, pts, 0.0225, 0, { part: 'mag', bevel: 0.002 });
  // Bodenplatte
  b.box(mat, 0.027, 0.008, 0.064, 0, -0.149 * len - 0.002, 0.118, { part: 'mag', rx: -0.2, c: 0.002 });
  if (b.hi) {
    // Griffrippen unten
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.box(mat, 0.002, 0.004, 0.05, s * 0.0118, -0.105 * len - i * 0.009, 0.112 + i * 0.002, { part: 'mag', rx: -0.22, c: 0 });
    // Patrone sichtbar oben
    b.cyl('brass', 0.0046, 0.0046, 0.03, 0, 0.051, 0.092, { part: 'mag', seg: 8 });
    b.cyl('copper', 0.0016, 0.0046, 0.012, 0, 0.051, 0.113, { part: 'mag', seg: 8 });
  }
  b.anchor('magGrab', 0, -0.07 * len, 0.099, { part: 'mag', data: { w: 0.0113, d: 0.029 } });
}

export function m17(b) {
  const axis = 0.093;
  arLower(b, { lowerMat: 'alu', upperMat: 'alu', gripMat: 'gripTan', axis });
  // Freischwebender M-LOK-Handschutz (achteckig) mit Schiene
  b.front('alu', octagon(0.024, axis), 0.245, 0.118, { bevel: 0.002 });
  b.rail('alu', 0, axis + 0.0222, 0.12, 0.36);
  for (const s of [-1, 1]) slots(b, s * 0.0222, axis, 0.15, 6, 0.033, 0.02, 0.007);
  slots(b, 0, axis - 0.0222, 0.15, 6, 0.033, 0.02, 0.007, Math.PI / 2);
  if (b.hi) {
    b.box('alu', 0.03, 0.004, 0.012, 0, axis - 0.024, 0.118, { c: 0.001 });      // Ring am Übergang
    // Handstopp unten
    b.side('polymer', [[0.29, axis - 0.022], [0.335, axis - 0.022], [0.33, axis - 0.034], [0.318, axis - 0.036]], 0.016, 0, { bevel: 0.002 });
  }
  // Lauf + Gasblock + Mündungsfeuerdämpfer
  b.cyl('steelDark', 0.0098, 0.0098, 0.1, 0, axis, 0.41, { seg: b.seg(14, 6) });
  b.cyl('steelDark', 0.0118, 0.0118, 0.012, 0, axis, 0.372, { seg: b.seg(14, 6) });
  const end = birdcage(b, 0.457, axis, 0.0108);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Klappkorn (eingeklappt) vorn auf der Schiene
  if (b.hi) b.box('alu', 0.016, 0.008, 0.024, 0, axis + 0.034, 0.345, { c: 0.002 });
  // Teleskopschaft (FDE)
  b.side('polymerTan', [
    [-0.165, 0.112], [-0.2, 0.122], [-0.276, 0.127], [-0.29, 0.122], [-0.29, 0.002], [-0.282, -0.006], [-0.264, -0.002],
    [-0.242, 0.036], [-0.212, 0.068], [-0.178, 0.074], [-0.165, 0.08],
  ], 0.036, 0, { bevel: 0.004, bevelSeg: 2 });
  b.box('rubber', 0.04, 0.134, 0.014, 0, 0.06, -0.297, { c: 0.004 });
  if (b.hi) {
    b.box('polymer', 0.012, 0.01, 0.05, 0, 0.074, -0.205, { c: 0.002 });              // Verstellhebel
    b.cyl('steel', 0.006, 0.006, 0.04, 0, 0.012, -0.27, { axis: 'x', seg: 10 });      // Riemenbügel
  }
  // Holo-Visier
  holoSight(b, 0.0, 0.124);
  arMag(b, 'polymerTan');
  // Linke Hand: unter dem Handschutz
  b.anchor('leftHandGrip', 0, axis - 0.024, 0.255, { data: { style: 'under', r: 0.024 } });
  b.meta = { sight: 'holo', axis, kind: 'rifle' };
}

export function sk14(b) {
  const axis = 0.093;
  arLower(b, { lowerMat: 'aluTan', upperMat: 'aluTan', gripMat: 'grip', axis, upperFront: 0.13 });
  // Längerer, runder Handschutz mit Schienen in 3/6/9/12 Uhr
  b.cyl('aluTan', 0.0255, 0.0255, 0.285, 0, axis, 0.272, { seg: b.seg(16, 8) });
  b.rail('aluTan', 0, axis + 0.024, 0.13, 0.41);
  b.rail('aluTan', 0.024, axis, 0.3, 0.4, { rz: -Math.PI / 2 });
  b.rail('aluTan', -0.024, axis, 0.3, 0.4, { rz: Math.PI / 2 });
  if (b.hi) {
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) b.box('cavity', 0.012, 0.004, 0.018, s * 0.018, axis - 0.018, 0.15 + i * 0.034, { rz: s * 0.78, c: 0 });
  }
  // Schwerer Lauf + Mündungsbremse
  b.cyl('steelDark', 0.011, 0.012, 0.16, 0, axis, 0.493, { seg: b.seg(14, 6) });
  const end = brake(b, 0.572, axis, 0.0135, 0.065);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Präzisionsschaft mit Wangenauflage
  b.side('aluTan', [
    [-0.16, 0.112], [-0.18, 0.118], [-0.21, 0.126], [-0.3, 0.126], [-0.31, 0.12], [-0.31, -0.012], [-0.3, -0.018],
    [-0.28, -0.012], [-0.25, 0.03], [-0.22, 0.062], [-0.18, 0.074], [-0.16, 0.08],
  ], 0.038, 0, { bevel: 0.004, bevelSeg: 2, holes: [roundRect(-0.27, 0.02, -0.235, 0.06, 0.012, 3)] });
  b.box('polymer', 0.032, 0.012, 0.09, 0, 0.133, -0.25, { c: 0.004 });                  // Wangenauflage
  b.box('rubber', 0.042, 0.142, 0.016, 0, 0.055, -0.318, { c: 0.004 });
  if (b.hi) for (const du of [-0.225, -0.275]) b.cyl('steel', 0.004, 0.004, 0.044, 0, 0.123, du, { axis: 'v', seg: 8 });
  acog(b, 0.0, 0.124);
  // Gerades Stahlmagazin (20 Schuss)
  b.part('mag', 0, 0.0, 0.088);
  b.side('steel', [[0.119, 0.045], [0.12, 0.0], [0.124, -0.09], [0.064, -0.096], [0.058, 0.0], [0.058, 0.045]], 0.024, 0, { part: 'mag', bevel: 0.0018 });
  b.box('steel', 0.028, 0.008, 0.066, 0, -0.096, 0.092, { part: 'mag', rx: -0.06, c: 0.002 });
  if (b.hi) for (const s of [-1, 1]) b.box('steel', 0.0015, 0.07, 0.008, s * 0.0122, -0.03, 0.105, { part: 'mag', c: 0 });
  b.anchor('magGrab', 0, -0.05, 0.0915, { part: 'mag', data: { w: 0.012, d: 0.0305 } });
  // Zweibein-Adapter
  if (b.hi) b.box('alu', 0.02, 0.012, 0.03, 0, axis - 0.034, 0.385, { c: 0.002 });
  b.anchor('leftHandGrip', 0, axis - 0.026, 0.27, { data: { style: 'under', r: 0.026 } });
  b.meta = { sight: 'acog', axis, kind: 'rifle' };
}

export function kv47(b) {
  const axis = 0.072;
  // Gehäuse (gestanzt): Unterteil + Deckel mit gewölbter Oberseite
  b.side('steel', [
    [-0.1, 0.048], [0.205, 0.048], [0.205, 0.088], [-0.1, 0.088],
  ], 0.034, 0, { bevel: 0.002 });
  b.side('steel', [
    [-0.08, 0.048], [0.16, 0.048], [0.158, 0.03], [0.13, 0.024], [0.03, 0.024], [0.0, 0.03], [-0.04, 0.032], [-0.08, 0.04],
  ], 0.034, 0, { bevel: 0.002 });
  // Verschlussdeckel (gewölbt) mit Rippen hinten
  b.front('steel', [...ellipsePts(0, 0.088, 0.0175, 0.016, b.hi ? 14 : 6, 0, Math.PI), [-0.0175, 0.086], [0.0175, 0.086]].slice(0, -1), 0.26, -0.09, { bevel: 0.0015 });
  if (b.hi) {
    for (let i = 0; i < 3; i++) b.box('steel', 0.03, 0.002, 0.004, 0, 0.104, -0.07 + i * 0.012, { c: 0 });
    // Nieten
    for (const [u, v] of [[-0.06, 0.07], [-0.03, 0.06], [0.03, 0.04], [0.12, 0.04], [0.18, 0.062], [0.19, 0.04], [-0.085, 0.06]]) { b.screw('steelBright', 0.0172, v, u, 'x', 0.0022); b.screw('steelBright', -0.0172, v, u, 'x', 0.0022); }
  }
  // Sicherungshebel (lang, rechts) – charakteristisch
  b.side('steel', [[-0.035, 0.084], [0.11, 0.084], [0.115, 0.078], [0.1, 0.074], [-0.02, 0.078], [-0.04, 0.07], [-0.05, 0.075]], 0.003, 0.0185, { bevel: 0.0006 });
  // Auswurffenster
  ejectionPort(b, 0.0172, 0.072, 0.07, 0.07, 0.018);
  // Verschlussträger mit Ladehebel rechts (animiert)
  b.part('bolt', 0.018, 0.075, 0.105);
  b.box('steelBright', 0.006, 0.01, 0.062, 0.016, 0.077, 0.075, { part: 'bolt', c: 0.001 });
  b.cyl('steelBright', 0.0045, 0.006, 0.026, 0.03, 0.077, 0.108, { part: 'bolt', axis: 'x', seg: b.seg(10, 5) });
  b.anchor('chargeGrab', 0.04, 0.077, 0.108, { part: 'bolt', data: { travel: [0, 0, 0.085], style: 'right' } });
  // Pistolengriff (schwarz, Bakelit)
  b.side('grip', [
    [0.032, 0.03], [0.028, 0.01], [0.022, -0.02], [0.012, -0.06], [0.004, -0.078], [-0.024, -0.082], [-0.03, -0.076],
    [-0.02, -0.04], [-0.01, -0.01], [-0.004, 0.026], [0.0, 0.03],
  ], 0.03, 0, { bevel: 0.007, bevelSeg: 2 });
  triggerGuard(b, 'steel', 0.03, 0.098, 0.026, 0.03, { t: 0.004, w: 0.01, trigPos: 0.3 });
  // Kimme (Visierblock vor dem Deckel) + Visierklappe
  b.box('steel', 0.024, 0.02, 0.05, 0, 0.093, 0.205, { c: 0.002 });
  b.side('steel', [[0.19, 0.103], [0.24, 0.103], [0.24, 0.109], [0.205, 0.112], [0.19, 0.112]], 0.02, 0, { bevel: 0.001 });
  b.box('steel', 0.022, 0.009, 0.004, 0, 0.1165, 0.2, { c: 0.0005 });
  b.box('cavity', 0.0035, 0.0042, 0.0045, 0, 0.1195, 0.2, { c: 0 });
  // Lauf, Gasrohr, Handschutz (Holz)
  b.cyl('steelDark', 0.0105, 0.0105, 0.42, 0, axis, 0.44, { seg: b.seg(14, 6) });
  b.cyl('steel', 0.0095, 0.0095, 0.21, 0, axis + 0.026, 0.335, { seg: b.seg(12, 5) });
  b.box('steel', 0.022, 0.044, 0.03, 0, axis + 0.012, 0.445, { c: 0.003 });                  // Gasblock
  // Oberer Handschutz (Holz) um das Gasrohr
  b.lathe('woodWarm', [[0, 0], [0, 0.0145], [0.01, 0.0162], [0.13, 0.0158], [0.145, 0.0128], [0.145, 0]], 0, axis + 0.026, 0.215, { seg: b.seg(14, 6) });
  // Unterer Handschutz (Holz) mit Fingermulden
  b.side('woodWarm', [
    [0.205, axis + 0.016], [0.395, axis + 0.016], [0.405, axis + 0.004], [0.4, axis - 0.022], [0.37, axis - 0.03],
    [0.33, axis - 0.026], [0.31, axis - 0.03], [0.27, axis - 0.026], [0.25, axis - 0.03], [0.22, axis - 0.028], [0.205, axis - 0.02],
  ], 0.036, 0, { bevel: 0.006, bevelSeg: 2 });
  b.box('steel', 0.038, 0.05, 0.008, 0, axis, 0.405, { c: 0.002 });                           // Halteband
  // Korn mit Schutzohren
  b.box('steel', 0.018, 0.018, 0.026, 0, axis + 0.006, 0.63, { c: 0.002 });
  b.side('steel', [[0.618, axis + 0.014], [0.644, axis + 0.014], [0.64, axis + 0.04], [0.628, axis + 0.046], [0.62, axis + 0.04]], 0.018, 0, { bevel: 0.001, holes: [[[0.626, axis + 0.02], [0.636, axis + 0.02], [0.635, axis + 0.036], [0.627, axis + 0.036]]] });
  b.cyl('steel', 0.0012, 0.0016, 0.028, 0, axis + 0.034, 0.631, { axis: 'v', seg: 6 });
  // Putzstock unter dem Lauf
  b.cyl('steel', 0.0032, 0.0032, 0.22, 0, axis - 0.017, 0.52, { seg: 6 });
  const end = akBrake(b, 0.65, axis);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Holzschaft
  b.side('woodWarm', [
    [-0.095, 0.086], [-0.2, 0.074], [-0.355, 0.06], [-0.37, 0.058], [-0.37, -0.068], [-0.355, -0.07], [-0.27, -0.035],
    [-0.16, 0.0], [-0.11, 0.028], [-0.095, 0.034],
  ], 0.038, 0, { bevel: 0.006, bevelSeg: 2 });
  b.box('steel', 0.04, 0.132, 0.008, 0, -0.005, -0.374, { c: 0.003 });                        // Schaftkappe
  if (b.hi) {
    b.box('steel', 0.034, 0.012, 0.03, 0, 0.004, -0.29, { rx: 0.24, c: 0.002 });            // Riemenöse
    b.screw('steelBright', 0.0192, 0.06, -0.13, 'x', 0.003); b.screw('steelBright', -0.0192, 0.06, -0.13, 'x', 0.003);
  }
  // Bananenmagazin (Stahl, gerippt)
  b.part('mag', 0, 0.02, 0.135);
  // Bogen: Zentrum vor dem Magazin, Radius ~0.33
  const C = [0.135 + 0.33, 0.026];
  const arc = (r, a0, a1, n) => { const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]); } return p; };
  const n = b.hi ? 8 : 4;
  const outerArc = arc(0.33 + 0.034, Math.PI, Math.PI + 0.62, n);       // Rückseite des Magazins (größerer Radius)
  const innerArc = arc(0.3, Math.PI + 0.62, Math.PI, n);       // Vorderseite
  b.side('steel', [...outerArc, ...innerArc], 0.026, 0, { part: 'mag', bevel: 0.002 });
  if (b.hi) {
    // Verstärkungsrippen
    for (let i = 1; i < 6; i++) {
      const a = Math.PI + 0.62 * i / 6, r = 0.3325;
      for (const s of [-1, 1]) b.box('steel', 0.002, 0.004, 0.052, s * 0.0135, C[1] + Math.sin(a) * r, C[0] + Math.cos(a) * r, { part: 'mag', rx: a - Math.PI, c: 0 });
    }
    b.cyl('brass', 0.0055, 0.0055, 0.03, 0, 0.032, 0.153, { part: 'mag', seg: 8 });
  }
  const aEnd = Math.PI + 0.62;
  b.box('steel', 0.03, 0.006, 0.07, 0, C[1] + Math.sin(aEnd) * 0.3325 - 0.003, C[0] + Math.cos(aEnd) * 0.3325, { part: 'mag', rx: 0.62, c: 0.0015 });
  b.anchor('magGrab', 0, -0.07, 0.147, { part: 'mag', data: { w: 0.013, d: 0.03 } });
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.38, gw: 0.015, gd: 0.017, gu: 0.009, ho: 0.028, tu: 0.04 } });
  b.anchor('magWell', 0, 0.02, 0.135);
  b.anchor('sight', 0, 0.1195, 0.2, { data: { type: 'iron', eyeRelief: 0.38 } });
  b.anchor('leftHandGrip', 0, axis - 0.03, 0.31, { data: { style: 'under', w: 0.018, h: 0.023 } });
  b.meta = { sight: 'iron', axis, kind: 'rifle' };
}
