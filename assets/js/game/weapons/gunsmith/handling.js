// Handhabungsprofile je Waffenmodell für die Ego-Ansicht (Positionen im Kameraraum, Meter/Radiant).
// Abgestimmt auf eine Viewmodel-Kamera mit vertikalem Sichtfeld ≈ 54°.

export const ID_TO_MODEL = {
  ar_kv47: 'kv47', ar_m17: 'm17', smg_vp9: 'vp9', smg_qx90: 'qx90', lmg_hm60: 'hm60', mr_sk14: 'sk14',
  sr_brecher: 'brecher', sg_bulldog: 'bulldog', pi_p9: 'p9', pi_adler: 'adler', knife: 'knife',
};

// Hüfte (wie CoD Mobile): Waffe etwas höher und mittiger, rechte Hand mit Daumen und Fingern am Pistolengriff
// sichtbar (Abzug bei ~80 % Bildhöhe), Mündung angehoben und kaum seitlich gedreht, leicht gekantet (Oberseite
// zur Bildmitte) – der Schaft fällt steil unter den Bildrand statt als Block in die rechte untere Ecke zu laufen.
// Die Stützhand greift den Handschutz von unten (GRIPS.under/flat/pump in arms.js), der Unterarm kommt kurz und
// steil von unten. Linke Schulter tiefer und etwas vor der Kamera; nicht weiter nach vorn: sonst knickt der
// Ellbogen bei Inspizieren/Nachladen VOR die Hand und der Ärmel zeigt als „Dose“ zur Kamera.
// Sprint: sprintPos/-Rot addieren sich zur Hüftpose (absolute Sprintpose unverändert gegenüber der alten Hüfte).
const RIFLE = {
  hip: [0.11, -0.175, -0.44], hipRot: [0.16, 0.02, 0.15],
  sprintPos: [0.01, -0.08, 0.07], sprintRot: [0.15, 0.64, 0.57],
  crouchPos: [-0.012, -0.006, 0.012], crouchRot: [0.0, 0.0, 0.07],
  kick: { back: 0.026, up: 0.045, side: 0.01, roll: 0.045, kickRot: 0.02 },
  weight: 1.0, reload: 'mag', action: 'auto', leftGrip: 'under', shell: 'rifle', flash: 1.0, flashLen: 1.0,
  shoulderR: [0.19, -0.3, 0.06], shoulderL: [-0.2, -0.4, -0.12], poleR: [0.6, -1, 0.1], poleL: [-0.7, -1, 0.05],
  reloadTime: 2.2, emptyTime: 2.8, equipTime: 0.55, boltTime: 0.06, boltTravel: 0.035,
  inspect: 3.2,
};

const PISTOL = {
  ...RIFLE,
  hip: [0.11, -0.13, -0.32], hipRot: [0.02, 0.06, 0.0],
  sprintPos: [-0.01, -0.035, 0.03], sprintRot: [-0.5, 0.32, 0.28],
  crouchPos: [-0.008, -0.004, 0.008], crouchRot: [0, 0, 0.05],
  kick: { back: 0.03, up: 0.09, side: 0.008, roll: 0.03, kickRot: 0.06 },
  weight: 0.65, reload: 'pistol', action: 'pistol', leftGrip: 'pistol', shell: 'pistol', flash: 0.7, flashLen: 0.6,
  shoulderR: [0.19, -0.3, 0.16], shoulderL: [-0.2, -0.3, 0.14], poleR: [0.8, -1, 0.3], poleL: [-0.9, -1, 0.2],
  reloadTime: 1.45, emptyTime: 1.85, equipTime: 0.32,
  inspect: 2.6,
};

export const HANDLING = {
  m17: { ...RIFLE },
  kv47: { ...RIFLE, hip: [0.132, -0.14, -0.39], kick: { back: 0.03, up: 0.055, side: 0.014, roll: 0.055, kickRot: 0.025 }, flash: 1.15, reloadTime: 2.35, emptyTime: 3.05 },
  sk14: { ...RIFLE, kick: { back: 0.034, up: 0.07, side: 0.01, roll: 0.04, kickRot: 0.035 }, action: 'semi', flash: 1.2, flashLen: 1.2, weight: 1.15 },
  vp9: { ...RIFLE, hip: [0.128, -0.127, -0.36], kick: { back: 0.018, up: 0.032, side: 0.01, roll: 0.035, kickRot: 0.015 }, shell: 'pistol', weight: 0.8, flash: 0.8, flashLen: 0.8, reloadTime: 1.95, emptyTime: 2.5 },
  qx90: { ...RIFLE, hip: [0.12, -0.135, -0.37], kick: { back: 0.016, up: 0.028, side: 0.01, roll: 0.03, kickRot: 0.012 }, leftGrip: 'post', reload: 'top', shell: 'pistol', weight: 0.8, flash: 0.8, flashLen: 0.8, reloadTime: 2.75, emptyTime: 3.35 },
  hm60: { ...RIFLE, hip: [0.135, -0.157, -0.4], kick: { back: 0.028, up: 0.04, side: 0.014, roll: 0.05, kickRot: 0.02 }, reload: 'belt', weight: 1.6, flash: 1.3, flashLen: 1.3, reloadTime: 6.2, emptyTime: 7.4, equipTime: 0.95 },
  brecher: { ...RIFLE, hip: [0.13, -0.135, -0.38], kick: { back: 0.06, up: 0.11, side: 0.01, roll: 0.05, kickRot: 0.08 }, action: 'bolt', leftGrip: 'flat', shell: 'big', weight: 1.4, flash: 1.6, flashLen: 1.6, reloadTime: 3.0, emptyTime: 3.9, equipTime: 0.85 },
  bulldog: { ...RIFLE, hip: [0.13, -0.13, -0.38], kick: { back: 0.065, up: 0.1, side: 0.012, roll: 0.06, kickRot: 0.08 }, action: 'pump', reload: 'shell', leftGrip: 'pump', shell: 'shotgun', weight: 1.2, flash: 1.9, flashLen: 1.1, reloadTime: 1.2, emptyTime: 3.6 },
  p9: { ...PISTOL },
  adler: { ...PISTOL, kick: { back: 0.045, up: 0.15, side: 0.012, roll: 0.05, kickRot: 0.1 }, shell: 'big', flash: 1.0, flashLen: 0.8, weight: 0.85, reloadTime: 1.9, emptyTime: 2.35 },
  // Messer: Klinge schräg nach vorn oben zur Bildmitte, Handrücken + Knöchel zur Kamera, Handgelenk zeigt nach
  // unten zum Unterarm (Klinge ⊥ Handgelenkachse im Hammergriff). Zeigt die Handgelenkachse zur Kamera, sieht man
  // Handschuhbund und Ärmel als „Dose“ von vorn – deshalb nicht die Klinge senkrecht stellen.
  knife: {
    ...PISTOL, hip: [0.13, -0.12, -0.34], hipRot: [0.29, 0.37, -2.87], sprintPos: [0.0, -0.05, 0.05], sprintRot: [-0.35, 0.15, 0.2],
    action: 'knife', leftGrip: 'none', reload: 'none', shell: 'none', flash: 0, weight: 0.5, equipTime: 0.25,
  },
};

// Schneller Messerhieb mit der linken Hand (Schusswaffe in der rechten): Schlüsselbilder [u, Wert] für
// Handgelenk-Position, Fingerrichtung F und Handrücken B im Kameraraum (Klinge = Daumenseite = F × B).
// Handrücken und Klingenfläche zeigen zur Kamera, der Unterarm kommt von unten – nie frontal auf die Faust.
export const KNIFE_MELEE = {
  pos: [[0.0, [-0.24, -0.34, -0.22]], [0.08, [-0.2, -0.04, -0.3]], [0.2, [0.0, -0.07, -0.42]], [0.36, [0.11, -0.11, -0.4]], [0.52, [0.12, -0.19, -0.35]], [0.74, [-0.14, -0.42, -0.2]]],
  F: [[0.0, [0.1, 0.9, -0.4]], [0.08, [-0.2, 0.95, -0.2]], [0.2, [0.3, 0.85, -0.42]], [0.36, [0.55, 0.75, -0.35]], [0.52, [0.45, 0.8, -0.35]], [0.74, [0.2, 0.9, -0.4]]],
  B: [[0.0, [0.3, 0.2, 0.93]], [0.08, [0.6, 0.15, 0.78]], [0.2, [0.55, 0.05, 0.83]], [0.36, [0.2, 0.15, 0.97]], [0.52, [0.15, 0.2, 0.97]], [0.74, [0.3, 0.3, 0.9]]],
};

export function handlingFor(modelKey) {
  return HANDLING[modelKey] || HANDLING.m17;
}
