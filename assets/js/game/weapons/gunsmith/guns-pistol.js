// Pistolen: P-9 Kompakt (Polymer, Schlagbolzen) und Adler .50 (schwere Edelstahlpistole mit Dreieckslauf)
import { slots } from './parts.js';

const RAKE = 0.3;

// Magazin im Griff: fällt entlang der Griffachse heraus
function gripMag(b, { u, v, w, len, depth, plate = 'polymer', body = 'steel', rake = RAKE }) {
  b.part('mag', 0, v, u);
  const s = Math.sin(rake), c = Math.cos(rake);
  // Körper (im Griff verborgen, sichtbar beim Wechsel)
  b.box(body, w, len, depth, 0, v + c * len / 2 + 0.004, u + s * len / 2, { part: 'mag', rx: -rake, c: 0.0015 });
  b.box(plate, w + 0.005, 0.009, depth + 0.008, 0, v, u + 0.002, { part: 'mag', rx: -rake, c: 0.0025 });
  if (b.hi) b.cyl('brass', 0.0045, 0.0045, 0.018, 0, v + c * len + 0.002, u + s * len + 0.004, { part: 'mag', seg: 8 });
  b.anchor('magGrab', 0, v - 0.004, u + 0.004, { part: 'mag', data: { w: 0.011, d: 0.016 } });
}

export function p9(b) {
  const axis = 0.068;
  // Schlitten (animiert): kantiger Querschnitt mit Fasen
  b.part('slide', 0, axis, 0);
  const sec = [[-0.0128, 0.052], [0.0128, 0.052], [0.0128, 0.077], [0.0094, 0.0848], [-0.0094, 0.0848], [-0.0128, 0.077]];
  b.front('steel', sec, 0.185, -0.04, { part: 'slide', bevel: 0.0018 });
  if (b.hi) {
    // Schlittenfasen vorne (Nase)
    b.box('steel', 0.022, 0.006, 0.012, 0, 0.083, 0.14, { part: 'slide', rx: 0.35, c: 0.001 });
    // Griffrillen hinten + vorne
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) {
      b.box('steelDark', 0.0012, 0.019, 0.0013, s * 0.0127, 0.066, -0.035 + i * 0.0035, { part: 'slide', c: 0 });
      if (i < 5) b.box('steelDark', 0.0012, 0.015, 0.0013, s * 0.0127, 0.066, 0.112 + i * 0.0035, { part: 'slide', c: 0 });
    }
    // Auswurffenster mit Laufhaube
    b.box('cavity', 0.0158, 0.0006, 0.04, 0.0016, 0.0849, 0.04, { part: 'slide', c: 0 });
    b.box('steelBright', 0.0145, 0.0014, 0.0375, 0.0012, 0.0853, 0.0412, { part: 'slide', c: 0.0004 });
  }
  // Visierung: Kimme mit zwei Punkten, Korn mit Punkt (Tritium)
  b.box('steel', 0.0175, 0.0065, 0.009, 0, 0.0878, -0.031, { part: 'slide', c: 0.0012 });
  b.box('cavity', 0.0036, 0.0035, 0.0094, 0, 0.0902, -0.031, { part: 'slide', c: 0 });
  b.box('steel', 0.0038, 0.0058, 0.006, 0, 0.0875, 0.137, { part: 'slide', c: 0.0008 });
  if (b.hi) {
    for (const s of [-1, 1]) b.circle('glowGreen', 0.0011, s * 0.0055, 0.0888, -0.0355, { part: 'slide', seg: 8 });
    b.circle('glowGreen', 0.0012, 0, 0.0888, 0.1339, { part: 'slide', seg: 8 });
  }
  b.circle('cavity', 0.0046, 0, axis, 0.1452, { part: 'slide' });
  b.cyl('steelBright', 0.0062, 0.0062, 0.002, 0, axis, 0.1442, { part: 'slide', seg: b.seg(14, 6), open: true });
  b.anchor('slideGrab', 0, 0.075, -0.024, { part: 'slide', data: { travel: [0, 0, 0.032] } });
  // Rahmen (Polymer) mit Zubehörschiene
  b.side('polymer', [[-0.034, 0.052], [0.141, 0.052], [0.141, 0.038], [0.128, 0.034], [0.07, 0.034], [0.06, 0.04], [0.02, 0.04], [-0.034, 0.037], [-0.046, 0.04]], 0.0232, 0, { bevel: 0.0022 });
  if (b.hi) for (let i = 0; i < 3; i++) b.box('cavity', 0.016, 0.0015, 0.004, 0, 0.0336, 0.085 + i * 0.012, { c: 0 });
  // Eckiger Abzugsbügel + Abzug mit Sicherungszüngel
  b.side('polymer', [[0.012, 0.04], [0.008, 0.012], [0.02, 0.004], [0.072, 0.004], [0.078, 0.012], [0.08, 0.036], [0.074, 0.036], [0.071, 0.014], [0.068, 0.01], [0.023, 0.01], [0.016, 0.016], [0.018, 0.04]], 0.012, 0, { bevel: 0.0012 });
  b.side('polymer', [[0.03, 0.042], [0.034, 0.03], [0.031, 0.016], [0.027, 0.016], [0.028, 0.03], [0.026, 0.042]], 0.006, 0, { bevel: 0.0008 });
  b.anchor('trigger', 0, 0.025, 0.03);
  // Griff mit Fingermulden (gestippelt), geneigt
  b.side('grip', [
    [-0.036, 0.038], [0.014, 0.04], [0.013, 0.022], [0.007, 0.008], [0.01, -0.004], [0.004, -0.016], [0.007, -0.026],
    [0.002, -0.038], [-0.003, -0.05], [-0.01, -0.056], [-0.043, -0.056], [-0.048, -0.045], [-0.049, -0.02], [-0.044, 0.005],
    [-0.04, 0.022], [-0.045, 0.031], [-0.046, 0.038],
  ], 0.029, 0, { bevel: 0.006, bevelSeg: 2 });
  if (b.hi) b.box('polymer', 0.004, 0.006, 0.006, -0.0132, 0.045, 0.006, { c: 0.001 });   // Schlittenfang
  gripMag(b, { u: -0.026, v: -0.056, w: 0.021, len: 0.085, depth: 0.03 });
  b.anchor('ejection', 0.006, 0.084, 0.04, { rz: 0.5 });
  b.anchor('muzzle', 0, axis, 0.147);
  const grip = { rake: RAKE, gw: 0.0145, gd: 0.0265, gu: -0.0025, ho: 0.0, tu: 0.06 };
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
  gripMag(b, { u: -0.024, v: -0.086, w: 0.024, len: 0.11, depth: 0.036, plate: 'steel', body: 'steel' });
  b.anchor('ejection', 0.018, 0.084, 0.042, { rz: 0.35 });
  const grip = { rake: RAKE, gw: 0.0185, gd: 0.0255, gu: 0.0, ho: 0.0105, tu: 0.065 };
  b.anchor('rightHandGrip', 0, -0.018, -0.02, { data: grip });
  b.anchor('magWell', 0, -0.086, -0.024);
  b.anchor('sight', 0, 0.1035, -0.054, { data: { type: 'iron', eyeRelief: 0.36 } });
  b.anchor('leftHandGrip', 0, -0.018, -0.02, { data: { style: 'pistol', ...grip } });
  b.meta = { sight: 'iron', axis, kind: 'pistol' };
}

export { slots };
