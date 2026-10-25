// Maschinenpistolen & LMG: QX-90 (P90-artiger Bullpup, Rotpunkt), HM-60 Hammer (gurtgespeist).
// Die VP-9 Viper ist seit 24.10.2026 nach Foto neu gebaut: guns-vp9.js.
import { redDot, ejectionPort, triggerGuard, ellipsePts } from './parts.js';
import { magRounds } from './magfill.js';

export function qx90(b) {
  const axis = 0.066;
  // Aufbau wie beim Vorbild in Schichten statt einer flachen Platte (Nutzer 13.10.: „sieht scheiße aus“):
  // schmaler Kern (Abzugsbügel/Vordergriff), breitere Schaftbacken mit Daumenloch, Griffsäule, graues Oberteil,
  // geschlossenes Visiergehäuse über dem Magazin, Laufnase vorn.
  const outer = [
    [-0.215, 0.098], [0.165, 0.098], [0.2, 0.094], [0.228, 0.085], [0.246, 0.072], [0.252, 0.058], [0.25, 0.044],
    [0.24, 0.03], [0.236, 0.016], [0.239, -0.004], [0.237, -0.03], [0.229, -0.06], [0.215, -0.08], [0.196, -0.089],
    [0.1, -0.093], [0.0, -0.095], [-0.08, -0.091], [-0.15, -0.079], [-0.2, -0.06], [-0.226, -0.032], [-0.235, 0.0],
    [-0.236, 0.04], [-0.232, 0.07], [-0.226, 0.088],
  ];
  const front = [[0.05, 0.03], [0.12, 0.03], [0.168, 0.022], [0.188, 0.002], [0.194, -0.028], [0.188, -0.056], [0.17, -0.072], [0.06, -0.075], [0.036, -0.062], [0.03, -0.032], [0.033, 0.0], [0.04, 0.022]];
  const thumb = ellipsePts(-0.072, -0.03, 0.029, 0.036, b.hi ? 16 : 6).map(([u, v]) => [u - (v + 0.03) * 0.25, v]);
  // Kern: Bügel um die vordere Öffnung, Vordergriff, Unterseite
  b.side('polymer', outer, 0.046, 0, { holes: [front, thumb], bevel: 0.009, bevelSeg: b.hi ? 3 : 1 });
  // Schaftbacken (breiter, stark gerundet) mit Daumenloch
  const cheek = [[-0.034, 0.072], [-0.222, 0.072], [-0.231, 0.045], [-0.233, 0.0], [-0.224, -0.03], [-0.198, -0.057], [-0.15, -0.076],
    [-0.08, -0.088], [-0.04, -0.091], [-0.03, -0.07], [-0.031, -0.03], [-0.034, 0.02]];
  b.side('polymer', cheek, 0.06, 0, { holes: [thumb], bevel: 0.013, bevelSeg: b.hi ? 4 : 1 });
  // Griffsäule zwischen Daumenloch und Abzugsöffnung (etwas schmaler, eigene Kante)
  b.side('polymer', [[-0.036, 0.06], [0.03, 0.06], [0.032, 0.02], [0.028, -0.03], [0.034, -0.062], [0.02, -0.093], [-0.03, -0.094], [-0.04, -0.06], [-0.036, -0.02]],
    0.052, 0, { bevel: 0.01, bevelSeg: b.hi ? 3 : 1 });
  // Oberteil (grau) mit Laufnase: über die ganze Länge, vorn abgerundet
  b.side('polymerGrey', [[-0.222, 0.068], [0.17, 0.068], [0.214, 0.072], [0.236, 0.08], [0.244, 0.09], [0.226, 0.1], [0.17, 0.104], [-0.215, 0.104], [-0.226, 0.09]],
    0.062, 0, { bevel: 0.007, bevelSeg: b.hi ? 2 : 1 });
  b.lathe('polymerGrey', [[0, 0.0175], [0.022, 0.0165], [0.03, 0.0135], [0.03, 0]], 0, axis, 0.236, { seg: b.seg(16, 6) });
  // Gummikappe hinten
  b.side('rubber', [[-0.222, 0.07], [-0.234, 0.05], [-0.239, 0.0], [-0.231, -0.034], [-0.218, -0.05], [-0.226, -0.02], [-0.228, 0.04]], 0.056, 0, { bevel: 0.006 });
  if (b.hi) {
    for (const s of [-1, 1]) {
      // Spannhebel-Schlitz im Oberteil, flache Mulde auf der Schaftbacke, Griffrillen am Vordergriff
      b.box('cavity', 0.001, 0.004, 0.07, s * 0.0311, 0.078, 0.15, { c: 0 });
      b.side('polymerGrey', ellipsePts(-0.165, 0.025, 0.04, 0.026, 14), 0.002, s * 0.0301, { bevel: 0 });
      for (let i = 0; i < 5; i++) b.box('polymer', 0.004, 0.0025, 0.016, s * 0.0242, -0.01 - i * 0.012, 0.214, { c: 0 });
    }
    // Wahlschalter-Scheibe unter dem Abzug, Riemenöse hinten, Auswurföffnung unten im Griff, Schrauben
    b.cyl('polymerGrey', 0.011, 0.011, 0.042, 0, -0.084, 0.09, { axis: 'v', seg: 16 });
    b.cyl('steel', 0.0045, 0.0045, 0.064, 0, 0.02, -0.215, { axis: 'x', seg: 8 });
    b.box('cavity', 0.02, 0.003, 0.05, 0, -0.0945, -0.008, { c: 0 });
    for (const [u, v] of [[-0.17, 0.045], [-0.12, -0.06], [0.13, 0.045], [0.0, 0.035]]) {
      const x = u < -0.035 ? 0.0302 : u < 0.03 ? 0.0262 : 0.0232;
      b.screw('steel', x, v, u, 'x', 0.0026); b.screw('steel', -x, v, u, 'x', 0.0026);
    }
  }
  // Transluzentes Magazin oben mit sichtbaren, quer liegenden Patronen
  b.part('mag', 0, 0.116, 0.0);
  b.box('smoke', 0.05, 0.03, 0.34, 0, 0.114, 0.0, { part: 'mag', r: 0.007 });
  b.box('polymer', 0.052, 0.02, 0.028, 0, 0.112, -0.178, { part: 'mag', c: 0.003 });
  // Patronen (5,7×28) quer in zwei Lagen; Zuführung hinten am Schwarzteil – das Magazin leert sich von vorn
  // Signalfarbener Zubringer wandert mit jedem Schuss nach hinten – der Füllstand ist auf einen Blick zu sehen
  magRounds(b, { cal: 'p57', axis: 'x', show: 'all', width: 0.026, fol: [0.026, 0.008, 0.046], folMat: 'paintSignal', path: [[0, 0.114, -0.154], [0, 0.114, 0.158]] });
  // Füllstand-Skala auf beiden Seiten: Striche bei 10, 20, 30, 40 Patronen (lang bei 20/40), Ende bei 50
  if (b.hi) for (const s of [-1, 1]) for (let r = 10; r <= 50; r += 10) {
    const u = -0.154 + (r - 0.5) * (0.312 / 49), long = r % 20 === 0 || r === 50;
    b.box('paintWhite', 0.0008, long ? 0.016 : 0.009, 0.0016, s * 0.0254, 0.121 - (long ? 0 : 0.0035), u, { part: 'mag', c: 0 });
  }
  // Bot-Detailstufe: Rauchkörper als undurchsichtiger Block
  if (!b.hi) b.box('smokeDark', 0.046, 0.026, 0.32, 0, 0.114, 0.0, { part: 'mag' });
  b.anchor('magGrab', 0, 0.13, -0.09, { part: 'mag' });
  // Visierhaube über dem Magazin (Ring-Reflex wie beim Vorbild): lang und flach, Seitenwände mit schrägen Enden,
  // Dach und Boden, vorn/hinten offen (Durchblick). Nur ohne getauschte Optik (Aufsätze setzen ihr eigenes Visier auf).
  if (!(b.att && b.att.optik && b.att.optik !== 'ring')) {
    const wall = [[-0.05, 0.1], [0.095, 0.1], [0.07, 0.184], [0.058, 0.196], [-0.018, 0.196], [-0.032, 0.184]];
    for (const s of [-1, 1]) b.side('polymerGrey', wall, 0.0075, s * 0.0292, { bevel: 0.0028, bevelSeg: b.hi ? 2 : 1 });
    b.box('polymerGrey', 0.066, 0.009, 0.082, 0, 0.1925, 0.02, { r: 0.0042 });
    b.box('polymerGrey', 0.052, 0.007, 0.11, 0, 0.1365, 0.022, { c: 0.002 });
  }
  const sAxis = redDot(b, 0.008, 0.14, { style: 'ring', mat: 'polymer' });
  // Lauf + Mündungsfeuerdämpfer vorn
  b.cyl('steelDark', 0.0085, 0.0085, 0.04, 0, axis, 0.262, { seg: b.seg(12, 6) });
  b.lathe('steelDark', [[0, 0], [0, 0.0105], [0.004, 0.011], [0.03, 0.011], [0.032, 0.0088], [0.032, 0.005]], 0, axis, 0.272, { seg: b.seg(12, 6) });
  if (b.hi) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.box('cavity', 0.0025, 0.0025, 0.016, Math.cos(a) * 0.0105, axis + Math.sin(a) * 0.0105, 0.292, { rz: a, c: 0 }); }
  b.bore(0.0045, 0, axis, 0.3045);
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
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.22, gw: 0.0275, gd: 0.034, gu: -0.0065, ho: 0.02, tu: 0.04 } });
  b.anchor('trigger', 0, 0.006, 0.048);
  b.anchor('magWell', 0, 0.116, 0.0);
  b.anchor('leftHandGrip', 0, -0.03, 0.215, { data: { style: 'post', rake: 0.25, gw: 0.0275, gd: 0.023, gu: 0, ho: 0.024 } });
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
