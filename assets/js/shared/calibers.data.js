// NULLPUNKT — Kaliber und Schussklang je Waffe (Nutzer 12.10.: „jede Waffe soll anders klingen, schwere Kaliber richtig
// wuchtig und weit hörbar, kleine eher mickrig“). Reine Daten, genutzt von engine/audio.js (Pegel, Bass, Nachhall,
// Hörweite, Aufnahme-Stimme) und bots/manager.js (wie weit Bots einen Schuss hören).
//
// Kaliber: db = Mündungsknall relativ zu 5,56 mm (gemessene Spitzenpegel: 9 mm ≈ 160 dB, 5,56 ≈ 165, 7,62×51 ≈ 168,
// .338 ≈ 171, .50 BMG ≈ 175), hear = Hörweite in m (Spielmaßstab), weight 0…1 = Wucht (Bass, Sub-Druck, Nachhall,
// Tonlage), subsonic = kein Überschallknall (dumpfer).
export const CALIBERS = {
  '4.6x30':  { label: '4,6 × 30 mm', db: -7,   hear: 170,  weight: 0.06 },
  '5.7x28':  { label: '5,7 × 28 mm', db: -5,   hear: 220,  weight: 0.12 },
  '9x19':    { label: '9 × 19 mm',   db: -6,   hear: 200,  weight: 0.18 },
  '.45acp':  { label: '.45 ACP',     db: -5,   hear: 210,  weight: 0.34, subsonic: true },
  '.357':    { label: '.357 Magnum', db: -1,   hear: 330,  weight: 0.5 },
  '.50ae':   { label: '.50 AE',      db: 2.5,  hear: 420,  weight: 0.7 },
  '5.56':    { label: '5,56 mm',     db: 0,    hear: 460,  weight: 0.4 },
  '7.62x25': { label: '7,62 × 25 mm', db: -3,   hear: 260,  weight: 0.22 },   // Tokarew (PS-41 Wirbel, 26.10.): heiß geladen, scharfer Knall
  '7.62x39': { label: '7,62 × 39 mm', db: 1.5, hear: 540,  weight: 0.55 },
  '7.62x51': { label: '7,62 × 51 mm', db: 3,   hear: 680,  weight: 0.68 },
  '.338':    { label: '.338',        db: 5.5,  hear: 950,  weight: 0.85 },
  '.50bmg':  { label: '.50 BMG',     db: 9,    hear: 1500, weight: 1 },
  '12ga':    { label: 'Kaliber 12',  db: 2.5,  hear: 420,  weight: 0.64, subsonic: true },
  '40mm':    { label: '40 mm',       db: -6,   hear: 230,  weight: 0.5, subsonic: true },
  '90mm':    { label: '90 mm',       db: 9,    hear: 1300, weight: 1, subsonic: true },
};

/**
 * Klang je Waffe: Kaliber, Aufnahme-Stimme (echte Waffe, siehe assets/lib/audio/manifest.json), Tonlage, eigene
 * Klangfarbe tone = [Frequenz Hz, dB] oder mehrere [[f, dB], …] (Resonanz von Lauf/Gehäuse), db = Zuschlag (kurzer Lauf lauter),
 * pcal = Eichung des eigenen Schusses (dB, aus tools/gunsound-test.mjs --eichen: gleicht Aufnahme + Körperkamera-
 * Sättigung aus, damit danach nur das Kaliber den Pegel bestimmt).
 */
export const WEAPON_SOUND = {
  // Sturmgewehre / Karabiner
  ar_m17:     { cal: '5.56',    voice: 'ar',           pitch: 1,    tone: [1500, 2] },        // AR-15
  ar_k36:     { cal: '5.56',    voice: 'blk',          pitch: 1.05, tone: [[3400, 4], [180, -3]], db: 1.5, pcal: 1 }, // kurzer Lauf (.300 BLK): greller, lauter
  ar_bx20:    { cal: '5.56',    voice: 'ar',           pitch: 0.93, tone: [[700, 4.5], [4500, -4]], pcal: -0.9 },         // Bullpup: kastig, tiefer
  ar_kv47:    { cal: '7.62x39', voice: 'ar_heavy',     pitch: 1,    tone: [[1200, 2.5], [150, 2]], pcal: -0.2 },          // AK-47
  ar_g7:      { cal: '7.62x51', voice: 'dmr',          pitch: 0.94, tone: [2100, 3.5], pcal: 0.1 },        // SKS, scharfer Knall
  mr_sk14:    { cal: '7.62x51', voice: 'sniper',       pitch: 1.02, tone: [[1800, 2], [350, 2.5]], pcal: -0.9 },        // Tikka
  // Maschinengewehre
  lmg_hm60:   { cal: '7.62x51', voice: 'lmg',          pitch: 1,    tone: [450, 2], pcal: 0.9 },           // Mosin 7,62×54R
  lmg_lm8:    { cal: '5.56',    voice: 'blk',          pitch: 0.94, tone: [[480, 3], [2800, -3]], pcal: 1.3 }, // schwerer Lauf, .300 BLK tiefer
  // Maschinenpistolen
  smg_vp9:    { cal: '9x19',    voice: 'smg',          pitch: 1,    tone: [[1100, 3], [3500, -2]], pcal: 0.2 },          // Carl Gustav M45
  // 26.10.: Die PPSch-Aufnahme gehört jetzt exklusiv der PS-41 Wirbel (echtes Vorbild); QX-90 bekommt die MP-Stimme, höher und greller
  smg_qx90:   { cal: '5.7x28',  voice: 'smg',          pitch: 1.18, tone: [3800, 3], pcal: 0.9 },          // Carl Gustav M45, hochgezogen: 5,7 mm scharf
  smg_wirbel: { cal: '7.62x25', voice: 'ppsh',         pitch: 1.0,  tone: [[1300, 3], [3600, 1.5]], pcal: -0.2 },   // PPSh 7,62×25 (eigene Aufnahme, 26.10.)
  smg_wespe:  { cal: '4.6x30',  voice: 'bersa',        pitch: 1.08, tone: [4200, 2.5], pcal: -2.5 },        // Bersa .380: dünn
  smg_keiler: { cal: '.45acp',  voice: 'pistol_heavy', pitch: 0.96, tone: [380, 3], pcal: -2.7 },           // 1911 .45: dumpf
  // Pistolen
  pi_p9:      { cal: '9x19',    voice: 'pistol',       pitch: 1.03, tone: [[2600, 3], [600, -2]], pcal: 0.9 },        // Walther PPQ
  pi_adler:   { cal: '.50ae',   voice: 'lever',        pitch: 1.04, tone: [900, 2], pcal: 1.2 },           // Marlin .30-30
  pi_p9a:     { cal: '9x19',    voice: 'pistol',       pitch: 1.07, tone: [[3400, 4], [700, -2.5]], db: 1, pcal: 1.1 },  // Walther PPQ, Kompensator: greller, lauter (26.10.)
  pi_kobra:   { cal: '.357',    voice: 'revolver',     pitch: 0.97, tone: [[2000, 3.5], [5500, 3]], pcal: -2 },          // S&W 642 Revolver
  // Scharfschützen
  sr_brecher: { cal: '.338',    voice: 'springfield',  pitch: 0.95, tone: [500, 2], pcal: -0.7 },           // Springfield 1917 .30-06
  sr_titan:   { cal: '.50bmg',  voice: 'sniper_heavy', pitch: 0.97, tone: [250, 3], pcal: -4.5 },           // .50 BMG
  // Flinten
  sg_bulldog: { cal: '12ga',    voice: 'model12',      pitch: 0.95, tone: [260, 4], pcal: -0.9 },           // Winchester Model 12
  sg_hagel:   { cal: '12ga',    voice: 'shotgun',      pitch: 1.1,  tone: [1800, 3.5], pcal: 0.1 },          // Benelli Nova
  sg_zwilling: { cal: '12ga',   voice: 'model12',      pitch: 0.92, tone: [[240, 4], [1400, 2.5]], db: 1.5, pcal: -1.2 },   // Coach Gun 20″ (26.10.): tiefer, kurzer Lauf lauter
  // Werfer und Unterlauf (Synthese; nur Pegel/Hörweite)
  at_donner:  { cal: '90mm',    tone: [200, 3] },
  gl_hammer:  { cal: '40mm',    tone: [300, 2] },
  gl_trommel: { cal: '40mm',    tone: [340, 2] },
  ub_gl40:    { cal: '40mm',    tone: [300, 2] },
  ub_schrot:  { cal: '12ga',    voice: 'shotgun',      pitch: 1.08, tone: [1700, 2], pcal: 0.1 },
  // Waffen der ersten Stunde: eigener Ton (heller, sauberer Knall bzw. kurzer Kompensator-Bellton)
  ar_ursprung: { cal: '5.56',    voice: 'ar',           pitch: 0.97, tone: [[2400, 3], [260, 2]] },
  pi_funke:    { cal: '9x19',    voice: 'pistol',       pitch: 0.96, tone: [[1500, 3], [4200, 2]], pcal: 0.9 },
  // Geschütze, Fahrzeug-MGs
  sentry:     { cal: '5.56',    voice: 'ar',           pitch: 1.04, tone: [1000, 2] },
  mbt_coax:   { cal: '7.62x51', voice: 'lmg',          pitch: 1.03, tone: [520, 2], pcal: 0.9 },
  mbt_cmg:    { cal: '.50bmg',  voice: 'sniper_heavy', pitch: 1.04, tone: [300, 2], pcal: -4.5 },
  jeep_mg:    { cal: '.50bmg',  voice: 'sniper_heavy', pitch: 1.06, tone: [340, 2], pcal: -4.5 },
  wk2_mg:     { cal: '7.62x51', voice: 'ar_heavy',     pitch: 0.94, tone: [700, 2], pcal: -0.2 },
  wk1_mg:     { cal: '7.62x51', voice: 'dmr',          pitch: 0.9,  tone: [420, 2.5], pcal: 0.1 },
};

/** Kaliber einer Waffe (Daten → sonst nach Klasse) → { id, ...CALIBERS[id] }. */
const CLASS_CAL = { pistol: '9x19', smg: '9x19', ar: '5.56', marksman: '7.62x51', lmg: '7.62x51', sniper: '.338', shotgun: '12ga', launcher: '40mm', under: '40mm' };
export function caliberOf(id, def = null) {
  const c = WEAPON_SOUND[id]?.cal || def?.sound?.cal || CLASS_CAL[def?.cls] || '5.56';
  return { id: c, ...(CALIBERS[c] || CALIBERS['5.56']) };
}

/** Wie weit Bots einen Schuss hören (m): Kaliber-Hörweite, im Spielmaßstab gestaucht (5,56 ≈ 78 m wie bisher 75). */
export function botHearRange(id, def = null) {
  return Math.max(30, Math.min(240, caliberOf(id, def).hear * 0.17));
}
