// Sturmgewehre & Präzisionsgewehr: M-17 Falke (M4-artig, Holo), KV-47 (AK-artig, Holz), SK-14 (DMR, ACOG)
import { holoSight, acog, birdcage, brake, ejectionPort, triggerGuard, arGrip, slots, roundRect, engrave, qdCup } from './parts.js';
import { magRounds } from './magfill.js';

// Achteckiger Querschnitt um (0, axis)
export function octagon(r, axis) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    pts.push([Math.cos(a) * r, axis + Math.sin(a) * r]);
  }
  return pts;
}

// Gemeinsamer AR-Unterbau (Lower, Upper, Puffer, Griff, Abzug) – Grundlage für M-17 und SK-14
export function arLower(b, { lowerMat = 'alu', upperMat = 'alu', gripMat = 'grip', axis = 0.093, upperFront = 0.118 } = {}) {
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
    // Wahlhebel-Markierungen links (Sicher / Einzel / Dauer) um den Drehpunkt
    for (const [v, u] of [[0.0665, -0.012], [0.0635, -0.0025], [0.0565, 0.0015]]) b.box('paintWhite', 0.0004, 0.0018, 0.0018, -0.0113, v, u, { c: 0 });
    // Prägung links am Magazinschacht: Typenbezeichnung, Kaliber, Seriennummer
    engrave(b, -0.0136, 0.041, 0.112, ['M-17 FALKE', 'KAL 5,56', 'NP 104729'], { dir: -1 });
    // Riegel am Ladehebel (links)
    b.box(upperMat, 0.006, 0.0055, 0.012, -0.0235, 0.108, -0.079, { part: 'charge', c: 0.001 });
    // Nach dem AR-15-Vorbild (Nutzer 13.10.2026): Wahlhebel mit runder Nabe, Schutzrippe um den Magazinknopf,
    // Verschlussfang mit Riffelung, Kerben der Schlossmutter, QD-Aufnahme der Endplatte, Scharnierstange des
    // Staubschutzdeckels, Abzugsachse
    b.cyl('steel', 0.0058, 0.0058, 0.003, -0.0126, 0.061, -0.006, { axis: 'x', seg: 16 });
    b.box('steel', 0.0028, 0.0042, 0.016, -0.0142, 0.064, 0.0, { rx: -0.5, c: 0.001 });
    b.box('cavity', 0.0006, 0.0012, 0.004, -0.0141, 0.061, -0.006, { c: 0 });
    b.side(lowerMat, [[0.03, 0.05], [0.058, 0.05], [0.06, 0.066], [0.054, 0.068], [0.034, 0.068], [0.03, 0.064]], 0.0014, 0.0117, { bevel: 0.0005 });
    for (let i = 0; i < 4; i++) b.box('cavity', 0.0006, 0.0008, 0.006, -0.0151, 0.054 + i * 0.0032, 0.06, { c: 0 });
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; b.box('cavity', 0.0022, 0.0022, 0.0084, Math.cos(a) * 0.0172, axis + Math.sin(a) * 0.0172, -0.074, { c: 0 }); }
    b.cyl('steel', 0.0198, 0.0198, 0.003, 0, axis, -0.069, { seg: 18 });
    b.cyl('steelDark', 0.0045, 0.0045, 0.006, -0.018, axis - 0.012, -0.069, { axis: 'x', seg: 12 });
    b.cyl('steel', 0.0011, 0.0011, 0.052, 0.0172, 0.0795, 0.047, { seg: 6 });
    for (const s of [-1, 1]) b.screw('steelBright', s * 0.0114, 0.051, 0.022, 'x', 0.0021); // Abzugsachse
  }
  b.anchor('rightHandGrip', 0, 0.0, 0, { data: { rake: 0.32, gw: 0.015, gd: 0.023, gu: 0.0, ho: 0.018, tu: 0.034 } });
  b.anchor('magWell', 0, 0.0, 0.088);
}

// PMAG-artiges Polymermagazin, Teil 'mag' mit Drehpunkt im Schacht. Durchscheinendes Material (smoke*, wie
// Lancer-Magazine): alle Patronen sichtbar, sonst nur die obersten an den Lippen (magfill.js)
export function arMag(b, mat, o = {}) {
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
  }
  // Patronen (5,56): Doppelreihe entlang der Krümmung, Mitte der obersten knapp über den Lippen
  magRounds(b, {
    cal: 'r556', width: 0.0195, depth: 0.058, show: mat.startsWith('smoke') ? 'all' : 3,
    path: [[0, 0.0505, 0.0885], [0, 0.0, 0.0895], [0, -0.05 * len, 0.0955], [0, -0.1 * len, 0.1055], [0, -0.133 * len, 0.114]],
  });
  b.anchor('magGrab', 0, -0.07 * len, 0.099, { part: 'mag', data: { w: 0.0113, d: 0.029 } });
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
  // Stahl: nur die obersten Patronen (7,62 NATO, auf die Magazintiefe gestaucht) bzw. der leere Zubringer
  magRounds(b, { cal: 'r308', fit: 0.057, width: 0.021, depth: 0.06, pitch: 0.0066, path: [[0, 0.051, 0.0885], [0, 0.0, 0.0895], [0, -0.075, 0.0925]] });
  b.anchor('magGrab', 0, -0.05, 0.0915, { part: 'mag', data: { w: 0.012, d: 0.0305 } });
  // Zweibein-Adapter
  if (b.hi) b.box('alu', 0.02, 0.012, 0.03, 0, axis - 0.034, 0.385, { c: 0.002 });
  b.anchor('leftHandGrip', 0, axis - 0.026, 0.27, { data: { style: 'under', r: 0.026 } });
  b.meta = { sight: 'acog', axis, kind: 'rifle' };
}
