// NULLPUNKT — Kaliber und Durchschlag (22.10.). Richtwerte für ein Geschoss auf kurze/mittlere Distanz: Durchmesser
// (mm), Mündungsenergie (J) und Eindringtiefe je Werkstoff (cm). Die Werte sind gerundete Größenordnungen aus
// Beschusstests (Kiefernholz, Baustahl, Vollziegel, Beton C25, festgestampfte Erde, Sandsack, Gipsputz/Trockenbau) –
// genug, damit sich die Waffen deutlich unterscheiden: 9 mm geht durch eine Holzplanke und Blech, bleibt aber in
// Ziegel und Beton stecken; 7,62 × 51 nimmt dünne Mauern nach ein paar Treffern; .50 BMG fetzt durch fast alles.
// Spielmechanik (combat.js, bullet-holes.js): Treffer an derselben Stelle graben weiter (Kratertiefe wächst), bis die
// Restdicke durchschlagen wird; dahinter fliegt die Kugel mit dem Energierest weiter.

/** pen: Eindringtiefe (cm) je Werkstoff · frag: Neigung zum Zerlegen (Krater weiter, weniger tief) · d: mm · E: J */
export const CALIBERS = Object.freeze({
  '46':     { name: '4,6 × 30 mm',   d: 4.6,  E: 480,   frag: 0.2, pen: { wood: 16, steel: 0.35, brick: 2.5, concrete: 1.5, dirt: 10, sand: 9,  plaster: 12, glass: 40, fabric: 40, tile: 2 } },
  '57':     { name: '5,7 × 28 mm',   d: 5.7,  E: 530,   frag: 0.2, pen: { wood: 18, steel: 0.4,  brick: 3,   concrete: 1.8, dirt: 11, sand: 10, plaster: 13, glass: 40, fabric: 40, tile: 2.5 } },
  '9mm':    { name: '9 × 19 mm',     d: 9.0,  E: 520,   frag: 0.1, pen: { wood: 15, steel: 0.25, brick: 2,   concrete: 1.2, dirt: 12, sand: 10, plaster: 10, glass: 35, fabric: 40, tile: 1.5 } },
  '45':     { name: '.45 ACP',       d: 11.4, E: 560,   frag: 0.1, pen: { wood: 12, steel: 0.2,  brick: 1.8, concrete: 1,   dirt: 11, sand: 9,  plaster: 9,  glass: 30, fabric: 40, tile: 1.5 } },
  '357':    { name: '.357 Magnum',   d: 9.1,  E: 1000,  frag: 0.15, pen: { wood: 22, steel: 0.4, brick: 3,   concrete: 2,   dirt: 16, sand: 13, plaster: 14, glass: 40, fabric: 40, tile: 2.5 } },
  '50ae':   { name: '.50 AE',        d: 12.7, E: 1900,  frag: 0.15, pen: { wood: 26, steel: 0.5, brick: 4,   concrete: 2.5, dirt: 20, sand: 15, plaster: 16, glass: 45, fabric: 45, tile: 3 } },
  '556':    { name: '5,56 × 45 mm',  d: 5.7,  E: 1750,  frag: 0.45, pen: { wood: 35, steel: 0.6, brick: 8,   concrete: 5,   dirt: 30, sand: 25, plaster: 28, glass: 50, fabric: 50, tile: 6 } },
  '68':     { name: '6,8 × 51 mm',   d: 7.0,  E: 3400,  frag: 0.3, pen: { wood: 55, steel: 0.9,  brick: 13,  concrete: 9,   dirt: 42, sand: 35, plaster: 40, glass: 60, fabric: 60, tile: 9 } },
  '762x39': { name: '7,62 × 39 mm',  d: 7.9,  E: 2100,  frag: 0.25, pen: { wood: 45, steel: 0.6, brick: 10,  concrete: 6,   dirt: 35, sand: 30, plaster: 34, glass: 55, fabric: 55, tile: 7 } },
  '762x51': { name: '7,62 × 51 mm',  d: 7.8,  E: 3300,  frag: 0.25, pen: { wood: 65, steel: 0.9, brick: 15,  concrete: 10,  dirt: 45, sand: 38, plaster: 45, glass: 60, fabric: 60, tile: 10 } },
  '338':    { name: '.338 Lapua',    d: 8.6,  E: 6600,  frag: 0.2, pen: { wood: 100, steel: 1.5, brick: 25,  concrete: 15,  dirt: 65, sand: 55, plaster: 70, glass: 80, fabric: 80, tile: 15 } },
  '50bmg':  { name: '.50 BMG',       d: 12.7, E: 18000, frag: 0.3, pen: { wood: 200, steel: 2.5, brick: 50,  concrete: 32,  dirt: 110, sand: 90, plaster: 120, glass: 120, fabric: 120, tile: 30 } },
  '12g':    { name: '12/70 Posten',  d: 8.4,  E: 280,   frag: 0.05, pen: { wood: 5, steel: 0.1, brick: 0.5, concrete: 0.4, dirt: 6,  sand: 5,  plaster: 4,  glass: 20, fabric: 25, tile: 0.5 } },
  '12slug': { name: '12/70 Flintenlaufgeschoss', d: 18.5, E: 3200, frag: 0.1, pen: { wood: 30, steel: 0.4, brick: 6, concrete: 4, dirt: 25, sand: 20, plaster: 25, glass: 50, fabric: 50, tile: 5 } },
});

/** Waffe → Kaliber (ohne Eintrag: nach Klang-Profil/Klasse). */
const WEAPON_CALIBER = {
  ar_kv47: '762x39', ar_m17: '556', ar_k36: '556', ar_bx20: '68', ar_g7: '762x51',
  smg_vp9: '9mm', smg_qx90: '57', smg_wespe: '46', smg_keiler: '45',
  lmg_hm60: '762x51', lmg_lm8: '556', mr_sk14: '762x51',
  sr_brecher: '338', sr_titan: '50bmg',
  sg_bulldog: '12g', sg_hagel: '12g', ub_schrot: '12g',
  pi_p9: '9mm', pi_adler: '50ae', pi_kobra: '357',
};
const PROFILE_CALIBER = { pistol: '9mm', pistol_heavy: '357', smg: '9mm', ar: '556', ar_heavy: '762x39', lmg: '762x51', sniper: '338', shotgun: '12g' };

/** Kaliber einer Waffendefinition (def.caliber überschreibt) → Eintrag aus CALIBERS. */
export function caliberOf(def) {
  if (!def) return CALIBERS['9mm'];
  if (def.caliber && CALIBERS[def.caliber]) return CALIBERS[def.caliber];
  if (def.antiMateriel) return CALIBERS['50bmg'];
  const id = WEAPON_CALIBER[def.id] || PROFILE_CALIBER[def.sound?.profile] || null;
  if (id) return CALIBERS[id];
  return (def.penetration || 0) >= 0.75 ? CALIBERS['762x51'] : CALIBERS['9mm'];
}

/** Oberfläche (Material-userData.surface) → Werkstoff der Tabelle. */
export const SURFACE_MATERIAL = Object.freeze({
  wood: 'wood', metal: 'steel', vehicle: 'steel', concrete: 'concrete', tile: 'brick', plaster: 'plaster',
  dirt: 'dirt', grass: 'dirt', sand: 'sand', glass: 'glass', fabric: 'fabric', brick: 'brick',
});

/**
 * Eindringtiefe (m) eines Geschosses in eine Oberfläche, mit Distanzverlust (Energie ~ (1 − d/Reichweite·0,5)).
 * Leere/unbekannte Oberflächen (Wasser, Fleisch) → 0.
 */
export function penetrationDepth(def, surface, distance = 0) {
  const cal = caliberOf(def);
  const mat = SURFACE_MATERIAL[surface];
  if (!mat) return 0;
  const cm = cal.pen[mat] ?? 0;
  const range = def?.range || 100;
  const loss = 1 - Math.min(0.6, (distance / range) * 0.5);
  return (cm / 100) * loss;
}
