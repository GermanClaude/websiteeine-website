// Pistolen: P-9 Kompakt (Polymer, Schlagbolzen) und Adler .50 (schwere Edelstahlpistole mit Dreieckslauf)
import { slots, engrave } from './parts.js';
import { magRounds } from './magfill.js';
import { sdPolygon, extrudeRound, smin, surfaceNets } from './sdf.js';

const RAKE = 0.3;

// Magazin im Griff: fällt entlang der Griffachse heraus
// cal = Kaliber (magfill.js): oberste Patronen an den Lippen bzw. leerer Zubringer (Stahl, beim Wechsel sichtbar)
function gripMag(b, { u, v, w, len, depth, plate = 'polymer', body = 'steel', rake = RAKE, cal = 'p9' }) {
  b.part('mag', 0, v, u);
  const s = Math.sin(rake), c = Math.cos(rake);
  // Körper (im Griff verborgen, sichtbar beim Wechsel)
  b.box(body, w, len, depth, 0, v + c * len / 2 + 0.004, u + s * len / 2, { part: 'mag', rx: -rake, c: 0.0015 });
  b.box(plate, w + 0.005, 0.009, depth + 0.008, 0, v, u + 0.002, { part: 'mag', rx: -rake, c: 0.0025 });
  const at = (l) => [0, v + 0.004 + c * l, u + s * l];
  magRounds(b, { cal, fit: depth - 0.003, width: w - 0.003, depth: depth - 0.002, path: [at(len + 0.002), at(0.02)] });
  b.anchor('magGrab', 0, v - 0.004, u + 0.004, { part: 'mag', data: { w: 0.011, d: 0.016 } });
}

export function p9(b) {
  // Nach dem Vorbild Glock 17 Gen5 (Nutzer 13.10.2026: Probe „so realistisch wie möglich“): Maße 1:1 (Schlitten
  // 187 × 25,5 mm, Lauf 114 mm), Schlitten mit Fasen und abgeschrägter Nase, je 7 Griffrillen hinten/vorn, Auswurf-
  // fenster mit Laufhaube, Auszieher, Abdeckplatte, Werksvisierung (weißes U, weißer Punkt); Polymerrahmen mit Schiene
  // (ein Querschlitz), Seriennummernplatte, eckigem Abzugsbügel, Abzug mit Sicherungszüngel, geradem Gen5-Griff mit
  // Aussparung vorn unten, drei Querstiften, Schlittenfang, Zerlegehebel, Magazinknopf. Eigene Materialien.
  const axis = 0.068;
  const SL = 'slideNitride', FR = 'polymerSatin';
  // ---------------------------------------------------------------- Schlitten (animiert)
  b.part('slide', 0, axis, 0);
  const sec = [[-0.01275, 0.0518], [0.01275, 0.0518], [0.01275, 0.0795], [0.0104, 0.0846], [-0.0104, 0.0846], [-0.01275, 0.0795]];
  b.front(SL, sec, 0.181, -0.041, { part: 'slide', bevel: 0.0012 });
  // Nase: vorn oben abgeschrägt, seitlich leicht eingezogen
  b.side(SL, [[0.1395, 0.0518], [0.1462, 0.0518], [0.1462, 0.0742], [0.1436, 0.0808], [0.1398, 0.0843], [0.1395, 0.0843]], 0.0236, 0, { part: 'slide', bevel: 0.0016 });
  // Ausschnitt unten vorn (Laufführung) und Mündung, Führungsstange der Schließfeder
  b.circle('cavity', 0.0046, 0, axis, 0.14625, { part: 'slide', seg: 18 });
  b.cyl('barrelNitride', 0.0064, 0.0064, 0.0024, 0, axis, 0.1452, { part: 'slide', seg: b.seg(18, 8), open: true });
  b.circle('cavity', 0.0043, 0, 0.0586, 0.14625, { part: 'slide', seg: 14 });
  b.cyl('steelDark', 0.0024, 0.0024, 0.004, 0, 0.0586, 0.1438, { seg: 10 });
  if (b.hi) {
    // Griffrillen: 7 hinten, 7 vorn (Gen5), jeweils beidseitig, mit hellem Grat dazwischen
    for (const s of [-1, 1]) for (let i = 0; i < 7; i++) {
      b.box('cavity', 0.0012, 0.0212, 0.0015, s * 0.01276, 0.0656, -0.0365 + i * 0.0036, { part: 'slide', c: 0 });
      b.box('cavity', 0.0012, 0.0168, 0.0015, s * 0.01276, 0.0672, 0.1095 + i * 0.0036, { part: 'slide', c: 0 });
    }
    // Auswurffenster (oben + rechts) mit Laufhaube, Auszieher mit Ladeanzeige
    b.box('cavity', 0.0152, 0.0006, 0.042, 0.0016, 0.08465, 0.04, { part: 'slide', c: 0 });
    b.box('cavity', 0.0006, 0.0118, 0.042, 0.01279, 0.0784, 0.04, { part: 'slide', c: 0 });
    b.box('barrelNitride', 0.0136, 0.0014, 0.0402, 0.0012, 0.0841, 0.0405, { part: 'slide', c: 0.0004 });
    b.box('barrelNitride', 0.0012, 0.0096, 0.0402, 0.0125, 0.0784, 0.0405, { part: 'slide', c: 0.0003 });
    b.box('steelBright', 0.0016, 0.0036, 0.0175, 0.0131, 0.0786, 0.0095, { part: 'slide', c: 0.0004 });
    b.box('steelBright', 0.0019, 0.0018, 0.004, 0.0134, 0.0786, 0.0035, { part: 'slide', c: 0.0003 });
    // Abdeckplatte hinten, Schlagbolzenkanal
    b.box(SL, 0.0166, 0.021, 0.0008, 0, 0.0664, -0.0414, { part: 'slide', c: 0.0003 });
    b.circle('cavity', 0.0012, 0, axis, -0.0425, { part: 'slide', ry: Math.PI, seg: 10 });
    // Fuge Schlitten/Rahmen
    for (const s of [-1, 1]) b.box('cavity', 0.0006, 0.0009, 0.176, s * 0.0129, 0.0522, 0.051, { c: 0 });
  }
  // Werksvisierung: Kimme mit weißem U (Rückseite gerillt), Korn mit weißem Punkt
  b.box('steel', 0.0174, 0.0064, 0.0086, 0, 0.0878, -0.031, { part: 'slide', c: 0.0012 });
  b.box('cavity', 0.0034, 0.0038, 0.0092, 0, 0.0902, -0.031, { part: 'slide', c: 0 });
  b.box('steel', 0.0036, 0.0058, 0.0055, 0, 0.0876, 0.1345, { part: 'slide', c: 0.0008 });
  if (b.hi) {
    for (const s of [-1, 1]) b.box('paintWhite', 0.0009, 0.0034, 0.0004, s * 0.0026, 0.0899, -0.03535, { part: 'slide', c: 0 });
    b.box('paintWhite', 0.0062, 0.0009, 0.0004, 0, 0.0879, -0.03535, { part: 'slide', c: 0 });
    for (let i = 0; i < 3; i++) b.box('cavity', 0.0172, 0.0004, 0.0004, 0, 0.0858 + i * 0.0014, -0.0354, { part: 'slide', c: 0 });
    b.circle('paintWhite', 0.0011, 0, 0.0885, 0.13175, { part: 'slide', seg: 10 });
  }
  b.anchor('slideGrab', 0, 0.075, -0.024, { part: 'slide', data: { travel: [0, 0, 0.032] } });
  // ---------------------------------------------------------------- Rahmen (Polymer)
  const FRAME = [[-0.034, 0.0518], [0.141, 0.0518], [0.141, 0.0386], [0.137, 0.034], [0.074, 0.034], [0.066, 0.039], [0.022, 0.0402], [-0.034, 0.037], [-0.047, 0.0402]];
  const GUARD = [[0.012, 0.04], [0.008, 0.012], [0.02, 0.004], [0.072, 0.004], [0.078, 0.012], [0.08, 0.036], [0.074, 0.036], [0.071, 0.014], [0.068, 0.01], [0.023, 0.01], [0.016, 0.016], [0.018, 0.04]];
  const GRIP = [
    [-0.036, 0.038], [0.014, 0.04], [0.013, 0.026], [0.0102, 0.012], [0.0078, -0.004], [0.005, -0.02], [0.0022, -0.036],
    [-0.0015, -0.05], [-0.0035, -0.0575], [-0.012, -0.0585], [-0.044, -0.0585], [-0.0492, -0.0505], [-0.0492, -0.03],
    [-0.0462, -0.005], [-0.0432, 0.015], [-0.0422, 0.024], [-0.0502, 0.032], [-0.0522, 0.0372],
  ];
  if (b.hi) {
    // Ego-Detailstufe: Rahmen + Abzugsbügel als ein weich verrundetes Spritzgussteil (Hohlkehlen), Griff mit ovalem
    // Querschnitt wie beim Vorbild (Distanzfelder, sdf.js)
    const frameF = (x, v, u) => smin(extrudeRound(sdPolygon(u, v, FRAME), x, 0.0116, 0.0013), extrudeRound(sdPolygon(u, v, GUARD), x, 0.006, 0.0016), 0.0028);
    b._push(surfaceNets(frameF, [-0.0135, 0.0, -0.05], [0.0135, 0.0545, 0.1435], 0.0015), FR, {});
    const gripF = (x, v, u) => extrudeRound(sdPolygon(u, v, GRIP) + 0.0052 * (x / 0.0145) ** 2, x, 0.0145, 0.0016);
    b._push(surfaceNets(gripF, [-0.0165, -0.0615, -0.0555], [0.0165, 0.0415, 0.0165], 0.0017), 'grip', {});
  } else {
    b.side(FR, FRAME, 0.0232, 0, { bevel: 0.0022 });
  }
  // Schiene (zwei Seitenleisten, ein Querschlitz) und Seriennummernplatte unter dem Staubschutz
  for (const s of [-1, 1]) b.box(FR, 0.0016, 0.0034, 0.062, s * 0.0122, 0.0368, 0.106, { c: 0.0006 });
  if (b.hi) {
    b.box('cavity', 0.0248, 0.0036, 0.0045, 0, 0.0355, 0.097, { c: 0 });
    b.box('steelBright', 0.008, 0.0008, 0.012, 0, 0.0338, 0.078, { c: 0.0003 });
  }
  // Eckiger Abzugsbügel (Unterschnitt hinten) + Abzug mit Sicherungszüngel
  if (!b.hi) b.side(FR, GUARD, 0.012, 0, { bevel: 0.0012 });
  b.side(FR, [[0.03, 0.042], [0.034, 0.03], [0.031, 0.016], [0.027, 0.016], [0.028, 0.03], [0.026, 0.042]], 0.006, 0, { bevel: 0.0008 });
  if (b.hi) b.side('steelDark', [[0.0315, 0.04], [0.0332, 0.03], [0.0305, 0.02], [0.0292, 0.02], [0.0312, 0.03], [0.0298, 0.04]], 0.0016, 0, { bevel: 0.0003 });
  b.anchor('trigger', 0, 0.025, 0.03);
  // Gerader Gen5-Griff (ohne Fingermulden), gestippelt, Biberschwanz (Ego: weiche Form oben, Bots: Profil)
  if (!b.hi) b.side('grip', GRIP, 0.029, 0, { bevel: 0.0058, bevelSeg: 3 });
  if (b.hi) {
    // Schlittenfang, Zerlegehebel (gerillt), drei Querstifte, Magazinknopf, eingeprägtes Logo
    b.box('steel', 0.0012, 0.0036, 0.016, -0.0122, 0.0478, 0.005, { c: 0.0004 });
    b.box('steel', 0.0032, 0.0046, 0.005, -0.0128, 0.0458, 0.0125, { c: 0.0006 });
    b.box('steel', 0.0246, 0.0042, 0.009, 0, 0.0475, 0.05, { c: 0.0008 });
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.box('cavity', 0.0004, 0.0032, 0.0007, s * 0.0124, 0.0475, 0.0472 + i * 0.0028, { c: 0 });
    for (const [v, u] of [[0.0455, 0.024], [0.0472, 0.037], [0.0455, -0.026]]) b.cyl('steel', 0.0011, 0.0011, 0.0242, 0, v, u, { axis: 'x', seg: 8 });
    b.box(FR, 0.0032, 0.0085, 0.0065, -0.0124, 0.031, 0.006, { c: 0.001 });
    for (const s of [-1, 1]) b.box(FR, 0.0006, 0.007, 0.014, s * 0.0147, 0.022, -0.026, { rx: -RAKE, c: 0.001 });
  }
  // Prägung links am Schlitten (Typ, Kaliber)
  engrave(b, -0.0131, 0.0735, 0.098, ['P-9 KOMPAKT', '9 MM'], { part: 'slide', dir: -1, h: 0.0015, cw: 0.0009, line: 0.0026 });
  gripMag(b, { u: -0.026, v: -0.056, w: 0.021, len: 0.085, depth: 0.03, plate: FR });
  b.anchor('ejection', 0.006, 0.084, 0.04, { rz: 0.5 });
  b.anchor('muzzle', 0, axis, 0.147);
  const grip = { rake: RAKE, gw: 0.0145, gd: 0.0265, gu: -0.0025, ho: 0.0, tu: 0.052, wrap: 0.38, tf: 0.055 };   // wrap/tf: hands-v3 (Daumen links am Rahmen)
  b.anchor('rightHandGrip', 0, -0.015, -0.019, { data: grip });
  b.anchor('magWell', 0, -0.056, -0.026);
  b.anchor('sight', 0, 0.0895, -0.031, { data: { type: 'iron', eyeRelief: 0.36 } });
  b.anchor('leftHandGrip', 0, -0.015, -0.019, { data: { style: 'pistol', ...grip } });
  b.meta = { sight: 'iron', axis, kind: 'pistol' };
}

export function adler(b) {
  const axis = 0.074;
  // Fester Lauf: rechteckiger Unterteil + schmale Oberschiene, seitliche Flachpaneele (zweifarbig)
  b.front('stainless', [[-0.0148, 0.055], [0.0148, 0.055], [0.0148, 0.083], [0.0118, 0.087], [-0.0118, 0.087], [-0.0148, 0.083]], 0.142, 0.086, { bevel: 0.0014 });
  b.front('stainless', [[-0.0085, 0.086], [0.0085, 0.086], [0.0072, 0.0985], [-0.0072, 0.0985]], 0.14, 0.087, { bevel: 0.001 });
  if (b.hi) {
    for (let i = 0; i < 11; i++) b.box('steelDark', 0.0146, 0.0012, 0.0022, 0, 0.0986, 0.096 + i * 0.0115, { c: 0 });
    for (const s of [-1, 1]) {
      b.box('steelDark', 0.001, 0.015, 0.11, s * 0.0149, 0.069, 0.158, { c: 0 });
      b.box('stainless', 0.0012, 0.003, 0.11, s * 0.0149, 0.0785, 0.158, { c: 0 });
    }
  }
  b.box('stainless', 0.0042, 0.0072, 0.012, 0, 0.1018, 0.217, { c: 0.0008 });
  b.circle('cavity', 0.0066, 0, axis, 0.2285);
  b.anchor('muzzle', 0, axis, 0.229);
  // Schlitten (animiert)
  b.part('slide', 0, axis, 0);
  b.front('stainless', [[-0.0166, 0.055], [0.0166, 0.055], [0.0166, 0.087], [0.0115, 0.0975], [-0.0115, 0.0975], [-0.0166, 0.087]], 0.15, -0.064, { part: 'slide', bevel: 0.0018 });
  b.box('stainless', 0.03, 0.03, 0.012, 0, 0.074, 0.083, { part: 'slide', rx: -0.35, c: 0.002 });
  if (b.hi) {
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) b.box('steelDark', 0.0012, 0.022, 0.0016, s * 0.0167, 0.072, -0.058 + i * 0.0036, { part: 'slide', rx: 0.12, c: 0 });
    // Auswurffenster rechts
    b.box('cavity', 0.0012, 0.012, 0.042, 0.0167, 0.084, 0.042, { part: 'slide', c: 0 });
    b.box('steelBright', 0.001, 0.008, 0.036, 0.0161, 0.084, 0.043, { part: 'slide', c: 0 });
    // Beidseitige Sicherung
    for (const s of [-1, 1]) b.box('steel', 0.0045, 0.007, 0.018, s * 0.0188, 0.087, -0.048, { part: 'slide', c: 0.0012 });
  }
  b.box('steel', 0.02, 0.0075, 0.01, 0, 0.1005, -0.054, { part: 'slide', c: 0.0012 });
  b.box('cavity', 0.004, 0.004, 0.0105, 0, 0.1032, -0.054, { part: 'slide', c: 0 });
  b.anchor('slideGrab', 0, 0.082, -0.045, { part: 'slide', data: { travel: [0, 0, 0.036] } });
  // Rahmen (schwarz): massiver Block unter dem Lauf bis zur Mündung
  b.side('steel', [[-0.062, 0.056], [0.228, 0.056], [0.228, 0.036], [0.216, 0.03], [0.1, 0.03], [0.092, 0.04], [0.02, 0.042], [-0.04, 0.04], [-0.064, 0.046]], 0.031, 0, { bevel: 0.0024 });
  if (b.hi) for (let i = 0; i < 3; i++) b.box('cavity', 0.02, 0.0015, 0.005, 0, 0.0298, 0.15 + i * 0.016, { c: 0 });
  // Großer eckiger Abzugsbügel mit Fingerhaken
  b.side('steel', [
    [0.016, 0.042], [0.012, 0.004], [0.02, -0.01], [0.09, -0.01], [0.098, -0.005], [0.1, 0.003], [0.094, 0.008], [0.094, 0.034],
    [0.087, 0.034], [0.087, 0.002], [0.082, -0.004], [0.024, -0.004], [0.019, 0.006], [0.022, 0.042],
  ], 0.013, 0, { bevel: 0.0014 });
  b.side('stainless', [[0.038, 0.044], [0.042, 0.026], [0.037, 0.008], [0.033, 0.009], [0.036, 0.026], [0.034, 0.044]], 0.006, 0, { bevel: 0.0008 });
  b.anchor('trigger', 0, 0.02, 0.036);
  // Griff: Rahmen + Gummigriffschalen mit Fingermulden
  b.side('steel', [
    [-0.04, 0.046], [0.02, 0.044], [0.017, 0.0], [0.012, -0.04], [0.006, -0.074], [0.0, -0.086], [-0.044, -0.086], [-0.052, -0.074],
    [-0.056, -0.04], [-0.052, 0.0], [-0.05, 0.03], [-0.062, 0.042], [-0.064, 0.048],
  ], 0.028, 0, { bevel: 0.004 });
  b.side('rubber', [
    [-0.036, 0.034], [0.013, 0.034], [0.012, 0.016], [0.007, 0.004], [0.01, -0.008], [0.004, -0.022], [0.007, -0.034],
    [0.002, -0.05], [0.002, -0.066], [-0.004, -0.076], [-0.04, -0.077], [-0.046, -0.04], [-0.044, 0.0],
  ], 0.037, 0, { bevel: 0.008, bevelSeg: 2 });
  // Außenliegender Hahn (animiert)
  b.part('hammer', 0, 0.066, -0.06);
  b.side('steel', [[-0.058, 0.064], [-0.062, 0.062], [-0.078, 0.082], [-0.076, 0.092], [-0.068, 0.092], [-0.064, 0.082], [-0.056, 0.072]], 0.0085, 0, { part: 'hammer', bevel: 0.001 });
  if (b.hi) b.box('cavity', 0.009, 0.005, 0.005, 0, 0.084, -0.07, { part: 'hammer', rx: -0.7, c: 0 });
  if (b.hi) {
    for (const s of [-1, 1]) for (const [v, u] of [[0.022, -0.012], [-0.058, -0.03]]) b.screw('steelBright', s * 0.0186, v, u, 'x', 0.0024);
    b.box('steel', 0.004, 0.006, 0.026, -0.0168, 0.05, 0.005, { c: 0.001 }); // Schlittenfang links
    b.box('steel', 0.004, 0.009, 0.007, -0.0145, 0.03, 0.016, { c: 0.001 }); // Magazinknopf
    b.box('steelBright', 0.003, 0.008, 0.012, 0.0152, 0.05, 0.065, { c: 0.001 }); // Zerlegeknopf
    for (const u of [0.02, 0.07]) b.cyl('steelBright', 0.0013, 0.0013, 0.0312, 0, 0.049, u, { axis: 'x', seg: 8 }); // Rahmenstifte
    engrave(b, -0.0156, 0.0705, 0.19, ['ADLER .50'], { dir: -1, h: 0.0019, cw: 0.0012, line: 0.003 });
  }
  gripMag(b, { u: -0.024, v: -0.086, w: 0.024, len: 0.11, depth: 0.036, plate: 'steel', body: 'steel', cal: 'p50' });
  b.anchor('ejection', 0.018, 0.084, 0.042, { rz: 0.35 });
  const grip = { rake: RAKE, gw: 0.0185, gd: 0.0255, gu: 0.0, ho: 0.0105, tu: 0.056, wrap: 0.38, tf: 0.055 };   // wrap/tf: hands-v3
  b.anchor('rightHandGrip', 0, -0.018, -0.02, { data: grip });
  b.anchor('magWell', 0, -0.086, -0.024);
  b.anchor('sight', 0, 0.1035, -0.054, { data: { type: 'iron', eyeRelief: 0.36 } });
  b.anchor('leftHandGrip', 0, -0.018, -0.02, { data: { style: 'pistol', ...grip } });
  b.meta = { sight: 'iron', axis, kind: 'pistol' };
}

export { slots };
