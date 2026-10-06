// NULLPUNKT — Soldaten-Ausrüstung: 8 Ausrüstungsvarianten (Kopfbedeckung, Gesichtsschutz, Brille, Weste,
// Rucksack, Ärmel, Knieschoner, Holster …) × 3 Detailstufen → eine geteilte, gecachte Geometrie.
// Farben kommen über Palettenplätze aus dem Material (Farbschema) → dieselbe Geometrie für alle Schemata.
// Koordinaten: Modellraum der Bindepose (Füße im Ursprung, Blick −Z, rechts +X, Arme hängen).
// Körper aus gedrehten Profilen mit elliptischem Querschnitt (weiche Silhouette, nahtlose Stoff-UVs in Metern),
// Ausrüstung aus abgerundeten Quadern; auf Stufe 2 nur noch die Silhouette tragenden Teile.
// Gesichter sind verdeckt (Realismus-Plan C1: Sturmhaube, Halstuch, Shemagh, Gasmaske + Schutzbrillen) – wie Bodycam,
// das Gesichter verpixelt; so entsteht kein „Uncanny Valley“ aus der Nähe.
import * as THREE from 'three';
import { SkinBuilder, limb, lathe as latheBase, rbox, ellipsoid, cyl, torus, xf } from './builder.js';
import { SKIN_TONES } from './materials.js';

export const VARIANTS = [
  { id: 'sturm', name: 'Sturm', head: 'helmet', cover: true, nvg: true, ears: true, face: 'gaiter', eyes: 'shades', vest: 'plate', back: 'assault', knees: true, holster: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'spaeher', name: 'Späher', head: 'boonie', face: 'shemagh', eyes: 'shades', shemagh: true, vest: 'rig', back: 'hydration', knees: false, holster: false, sleeves: 'rolled', skin: 2, hair: '#3b2a1c' },
  { id: 'funker', name: 'Funker', head: 'cap', ears: true, face: 'gaiter', eyes: 'glasses', vest: 'plate', back: 'radio', knees: false, holster: true, sleeves: 'long', skin: 0, hair: '#5a4026' },
  { id: 'grenadier', name: 'Grenadier', head: 'helmet', face: 'balaclava', eyes: 'goggles', vest: 'plate', back: 'none', knees: true, dump: true, sleeves: 'long', skin: 3, hair: '#18120d' },
  { id: 'schatten', name: 'Schatten', head: 'beanie', face: 'balaclava', eyes: null, vest: 'light', back: 'none', knees: false, holster: true, sleeves: 'long', skin: 4, hair: '#141110' },
  { id: 'bastion', name: 'Bastion', head: 'helmet', face: 'gasmask', eyes: null, vest: 'heavy', back: 'none', knees: true, pauldrons: true, dump: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'kundschafter', name: 'Kundschafter', head: 'wrap', ears: true, face: 'gaiter', eyes: 'shades', vest: 'rig', back: 'assault', knees: true, sleeves: 'rolled', skin: 5, hair: '#4a3420' },
  { id: 'pionier', name: 'Pionier', head: 'cap', capBack: true, ears: true, face: 'gaiter', eyes: 'shades', vest: 'plate', back: 'none', knees: true, holster: true, dump: true, sleeves: 'long', skin: 2, hair: '#2e2016' },
  // Klassen-Ausführungen (bots-scale): Sanitäter (leichte Weste, Armbinde mit rotem Kreuz, Sanitätstasche), Panzerpionier
  // (schwere Weste mit Schulterschutz, Werfer RW-90 auf dem Rücken), Scharfschütze (Tarnüberwurf/„Ghillie“ über Kopf und Schultern)
  { id: 'sanitaeter', name: 'Sanitäter', head: 'helmet', cover: true, ears: true, face: 'gaiter', eyes: 'glasses', vest: 'light', back: 'medbag', armband: 'medic', knees: false, holster: true, sleeves: 'long', skin: 3, hair: '#2a2119' },
  { id: 'panzerpionier', name: 'Panzerpionier', head: 'helmet', face: 'balaclava', eyes: 'goggles', vest: 'heavy', back: 'launcher', knees: true, pauldrons: true, dump: true, sleeves: 'long', skin: 0, hair: '#18120d' },
  { id: 'scharfschuetze', name: 'Scharfschütze', head: 'boonie', face: 'shemagh', eyes: null, shemagh: true, vest: 'rig', back: 'hydration', ghillie: true, knees: false, holster: false, sleeves: 'rolled', skin: 5, hair: '#3b2a1c' },
];
export const VARIANT_IDS = VARIANTS.map((v) => v.id);

// Detailstufen: Profilsegmente (Gliedmaßen/Rumpf), Ringe, Kappenringe, Rundquader, Kugel-Segmente, Zylinder
const Q = [
  { seg: 10, tseg: 12, rings: 3, cap: 2, rb: 1, sw: 12, sh: 8, cs: 10 },
  { seg: 7, tseg: 9, rings: 2, cap: 1, rb: 0, sw: 9, sh: 6, cs: 7 },
  { seg: 4, tseg: 6, rings: 1, cap: 1, rb: 0, sw: 6, sh: 3, cs: 4 },
];

const cache = new Map();

// Helm nach hinten gekippt (≈ 17°): Vorderkante über den Augenbrauen, Nackenschutz hinten tiefer – wie ein echter Helm
const HELMET_TILT = new THREE.Matrix4().makeTranslation(0, 1.692, 0.008)
  .multiply(new THREE.Matrix4().makeRotationX(0.3))
  .multiply(new THREE.Matrix4().makeTranslation(0, -1.692, -0.008));
const tiltHelmet = (g) => g.applyMatrix4(HELMET_TILT);
// Umgebungsverdeckung je Detailstufe (Strahlen, Zellmaß)
const AO = [{ cell: 0.02, dirs: 8 }, { cell: 0.022, dirs: 8 }, { cell: 0.03, dirs: 6, steps: [0.04, 0.09, 0.16] }];

/**
 * Geometrie (gecacht) für Variante × Detailstufe. `schemeId` wird ignoriert (Farben aus dem Material) und bleibt
 * nur für die bisherige Signatur erhalten.
 */
export function soldierGeometry(variantId, schemeId, lod = 0) {
  void schemeId;
  const l = Math.max(0, Math.min(2, lod | 0));
  const key = `${variantId}|${l}`;
  let g = cache.get(key);
  if (!g) {
    const v = VARIANTS.find((x) => x.id === variantId) || VARIANTS[0];
    g = buildSoldier(v, l);
    g.userData.key = key;
    cache.set(key, g);
  }
  return g;
}

/** Gecachte Geometrien (Diagnose/Speicherschätzung): { count, bytes, triangles: {key: n} } */
export function soldierGeometryStats() {
  let bytes = 0;
  const triangles = {};
  for (const [k, g] of cache) { bytes += g.userData.bytes || 0; triangles[k] = g.userData.triangles; }
  return { count: cache.size, bytes, triangles };
}

export function disposeSoldierGeometries() {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

/* ======================================================================== Aufbau */

function buildSoldier(V, lod) {
  const q = Q[lod];
  const B = new SkinBuilder({ ao: globalThis.__npNoAO ? null : AO[lod] });
  const L0 = lod === 0, L01 = lod <= 1, FAR = lod === 2;
  const skin = SKIN_TONES[V.skin % SKIN_TONES.length];

  // Materialien: color = feste Farbe (sRGB-Hex), pal = Schemafarbe (+ shade = sRGB-Faktor); cls = Materialklasse
  const C = {
    top: { color: '#dadada', camo: 1, detail: 1, cls: 'cloth' },
    pants: { color: '#c6c6c6', camo: 1, detail: 1, cls: 'cloth', wear: 0.3 },
    cover: { color: '#d2d2d2', camo: 1, detail: 1, cls: 'cloth' }, // Helmbezug im Tarnmuster
    gear: { pal: 'gear', detail: 1, shine: 0.04, cls: 'gear' },
    gear2: { pal: 'gear2', detail: 1, shine: 0.04, cls: 'gear' },
    flap: { pal: 'gear2', shade: 0.92, detail: 1, shine: 0.04, cls: 'gear' },
    strap: { pal: 'strap', detail: 0.8, cls: 'gear' },
    helmet: { pal: 'helmet', detail: 0.6, shine: 0.16, cls: 'hard' },
    helmetDark: { pal: 'helmet', shade: 0.78, detail: 0.6, shine: 0.16, cls: 'hard' },
    skin: { color: skin, detail: 0.6, shine: 0.3, cls: 'skin' },
    hair: { color: V.hair, detail: 0.8, shine: 0.08, cls: 'cloth' },
    glove: { pal: 'glove', detail: 0.8, shine: 0.16, cls: 'leather', wear: 0.5 },
    boot: { pal: 'boot', detail: 0.7, shine: 0.3, cls: 'leather', wear: 0.6 },
    sole: { color: '#17181a', detail: 0.4, shine: 0.08, cls: 'hard' },
    metal: { pal: 'metal', detail: 0.2, shine: 0.88, cls: 'hard' },
    plastic: { color: '#1e2022', detail: 0.5, shine: 0.42, cls: 'hard' },
    lens: { color: '#0b1014', detail: 0, shine: 1, cls: 'glass' },
    smoke: { color: '#2b3034', detail: 0, shine: 1, cls: 'glass' }, // Schießbrille (getönt)
    accent: { pal: 'accent', detail: 0, emis: 0.55, shine: 0.3, cls: 'hard' },
    // Teamfarben-Bänder (Arm, Helm): großflächig, daher schwächer leuchtend (≈ 0,6 Eigenleuchten)
    band: { pal: 'accent', detail: 0.3, emis: 0.27, shine: 0.25, cls: 'gear' },
    // Schutzbrille/Maskengläser: hellgrau spiegelnd mit kleinem Glanzlicht → Blickrichtung lesbar
    visor: { color: '#8ea4b0', detail: 0, shine: 1, emis: 0.1, cls: 'glass' },
    mag: { color: '#2a2b2c', detail: 0.4, shine: 0.55, cls: 'hard' },
    knee: { pal: 'gear2', shade: 0.85, detail: 0.7, shine: 0.2, cls: 'hard', wear: 0.8 },
    eye: { color: '#17120e', detail: 0, shine: 0.9, cls: 'glass' },
    eyeWhite: { color: '#c9c0b4', detail: 0, shine: 0.6, cls: 'glass' },
    socket: { color: shade(skin, 0.66), detail: 0.4, shine: 0.12, cls: 'skin' }, // Augenpartie (Schatten unter der Stirn)
    brow: { color: shade(V.hair, 0.9), detail: 0.6, shine: 0.05, cls: 'cloth' },
    patch: { pal: 'gear', shade: 0.72, detail: 1, cls: 'gear' },
    knit: { color: '#2a2b2c', detail: 1, shine: 0, cls: 'cloth' },
    sand: { color: '#4b4c3c', detail: 1, cls: 'cloth' }, // Shemagh (dunkles Oliv – heller Sand las sich als Haut)
    // bots-scale: Sanitäter-Kennzeichen, Werferrohr, Tarnüberwurf (Jute-Streifen)
    medWhite: { color: '#d4d2c8', detail: 0.4, shine: 0.1, emis: 0.12, cls: 'cloth' },
    medRed: { color: '#9a1c18', detail: 0.3, shine: 0.1, emis: 0.1, cls: 'cloth' },
    tube: { color: '#3c4130', detail: 0.6, shine: 0.22, cls: 'hard', wear: 0.5 },
    jute: { color: '#55553a', camo: 0.5, detail: 1, shine: 0, cls: 'cloth' },
    jute2: { color: '#6b6444', detail: 1, shine: 0, cls: 'cloth' },
  };
  const covered = V.face === 'balaclava';
  const lowerCovered = covered || V.face === 'gaiter' || V.face === 'shemagh' || V.face === 'gasmask';
  // Sturmhaube: dunkler Stoff in Ausrüstungsfarbe; Halstuch im Tarnmuster der Uniform; Shemagh oliv-braun
  const faceFab = V.face === 'shemagh' ? C.sand : V.face === 'gaiter' ? { color: '#bdbdbd', camo: 1, detail: 1, cls: 'cloth' } : { pal: 'gear2', shade: 0.72, detail: 1, cls: 'cloth' };
  const add = (geo, bone, mat) => B.add(geo, { bone, ...mat });
  const pair = (geo, boneL, boneR, mat) => B.add(geo, { bone: boneL, mirrorBone: boneR, ...mat });
  const R = (w, h, d, r, opts) => rbox(w, h, d, r, q.rb, opts);
  const E = (rx, ry, rz, opts, cut, ws = q.sw, hs = q.sh) => ellipsoid(rx, ry, rz, FAR ? Math.min(ws, 6) : ws, FAR ? Math.min(hs, 3) : hs, opts, cut);
  // Drehprofile auf Stufe 2 ausdünnen (jeder zweite Punkt, Enden bleiben)
  const lathe = (profile, seg, opts) => latheBase(FAR ? profile.filter((_, i) => i === 0 || i === profile.length - 1 || i % 2 === 0) : profile, seg, opts);
  // Tasche mit Deckel (Deckel oben, rundum etwas größer → liest sich als überstehende Klappe)
  const pouch = (w, h, d, x, y, z, bone = 'chest', mat = C.gear2) => {
    add(R(w, h, d, Math.min(0.014, d * 0.3), { p: [x, y, z] }), bone, mat);
    if (L0) add(rbox(w + 0.006, h * 0.3, d + 0.006, 0.004, 1, { p: [x, y + h * 0.36, z] }), bone, C.flap);
  };

  /* ------------------------------------------------------------ Beine */
  pair(lathe([[0.058, 0.44], [0.064, 0.5], [0.075, 0.6], [0.086, 0.72], [0.092, 0.83], [0.094, 0.9], [0.08, 0.96]], q.seg, { p: [-0.098, 0, 0.004], s: [1, 1, 1.06] }), 'thighL', 'thighR', C.pants);
  if (!FAR) {
    // Beintasche (Cargo) mit Deckel
    pair(R(0.045, 0.14, 0.12, 0.02, { p: [-0.178, 0.7, 0.008], r: [0, 0, 0.06] }), 'thighL', 'thighR', { ...C.pants, color: '#c8c8c8' });
    if (L0) pair(rbox(0.05, 0.03, 0.128, 0.006, 1, { p: [-0.181, 0.772, 0.008], r: [0, 0, 0.06] }), 'thighL', 'thighR', { ...C.pants, color: '#b4b4b4' });
  }
  if (V.holster && !FAR) {
    add(R(0.06, 0.17, 0.1, 0.022, { p: [0.193, 0.74, 0.022], r: [0.08, 0, -0.06] }), 'thighR', C.gear2);
    add(R(0.03, 0.075, 0.04, 0.008, { p: [0.195, 0.845, 0.055], r: [0.25, 0, -0.06] }), 'thighR', C.plastic);
    if (L01) add(torus(0.088, 0.008, 3, q.cs + 2, { p: [0.098, 0.66, 0.006], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] }), 'thighR', C.strap);
  }
  // Knie (Gelenkfüller) + Unterschenkel mit Wade
  if (L01) pair(E(0.06, 0.06, 0.062, { p: [-0.1, 0.49, 0.0] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'shinL', 'shinR', { ...C.pants, wear: 0.7 });
  pair(lathe([[0.047, 0.17], [0.05, 0.22], [0.061, 0.3], [0.067, 0.37], [0.064, 0.44], [0.06, 0.5]], q.seg, { p: [-0.1, 0, 0.006], s: [1, 1, 1.1] }), 'shinL', 'shinR', C.pants);
  if (V.knees) {
    pair(R(0.1, 0.12, 0.045, 0.02, { p: [-0.1, 0.5, -0.066], r: [-0.1, 0, 0] }), 'shinL', 'shinR', C.knee);
    if (L0) pair(torus(0.064, 0.007, 3, q.cs, { p: [-0.1, 0.45, 0.006], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'shinL', 'shinR', C.strap);
  }
  // Stiefel: Schaft, Hosenaufschlag, Fuß mit Sohle und Zehenkappe, Schnürung
  pair(cyl(0.058, 0.061, 0.15, q.cs, { p: [-0.1, 0.13, -0.002], s: [1, 1, 1.08] }, FAR), 'shinL', 'shinR', C.boot);
  if (L01) pair(torus(0.058, 0.013, 4, q.cs, { p: [-0.1, 0.21, 0.004], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'shinL', 'shinR', C.pants);
  if (L0) for (let i = 0; i < 4; i++) pair(rbox(0.042, 0.006, 0.01, 0, 0, { p: [-0.1, 0.085 + i * 0.03, -0.063] }), 'shinL', 'shinR', C.plastic);
  pair(R(0.096, 0.07, 0.235, 0.032, { p: [-0.1, 0.058, -0.048] }), 'footL', 'footR', C.boot);
  if (L01) pair(E(0.048, 0.034, 0.05, { p: [-0.1, 0.048, -0.135] }, undefined, q.sw / 2 + 1, q.sh / 2), 'footL', 'footR', { ...C.boot, wear: 1 });
  pair(rbox(0.1, 0.022, 0.242, 0.008, L0 ? 1 : 0, { p: [-0.1, 0.011, -0.049] }), 'footL', 'footR', C.sole);

  /* ------------------------------------------------------------ Becken + Rumpf (elliptische Profile) */
  add(lathe([[0.05, 0.79], [0.115, 0.82], [0.15, 0.87], [0.162, 0.93], [0.158, 0.98], [0.146, 1.03]], q.tseg, { s: [1, 1, 0.7], p: [0, 0, 0.006] }), 'hips', C.pants);
  if (!FAR) pair(E(0.07, 0.085, 0.06, { p: [-0.065, 0.9, 0.05] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'hips', 'hips', C.pants);
  add(lathe([[0.143, 0.99], [0.14, 1.06], [0.146, 1.13], [0.156, 1.2], [0.16, 1.23]], q.tseg, { s: [1.04, 1, 0.72], p: [0, 0, 0.006] }), 'spine', C.top);
  add(lathe([[0.156, 1.18], [0.172, 1.26], [0.182, 1.33], [0.18, 1.39], [0.162, 1.44], [0.118, 1.475], [0.07, 1.495]], q.tseg, { s: [1.08, 1, 0.68], p: [0, 0, 0.006] }), 'chest', C.top);
  // Trapez + Schultern
  if (!FAR) pair(E(0.085, 0.048, 0.07, { p: [-0.115, 1.452, 0.014] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'chest', 'chest', C.top);
  // Kragen
  if (!FAR) add(cyl(0.064, 0.078, 0.06, q.cs, { p: [0, 1.495, 0.014], s: [1, 1, 0.92] }, true), 'chest', V.shemagh ? C.sand : C.top);
  // Gefechtsgürtel (Ring um das Becken) mit Schnalle, Taschen, Erste-Hilfe-Tasche hinten
  add(cyl(0.165, 0.165, 0.058, q.tseg, { p: [0, 0.995, 0.006], s: [1.03, 1, 0.74] }), 'hips', C.gear);
  if (!FAR) {
    add(R(0.06, 0.04, 0.012, 0.004, { p: [0, 0.995, -0.124] }), 'hips', C.metal);
    pair(R(0.058, 0.085, 0.07, 0.018, { p: [-0.168, 0.968, 0.04] }), 'hips', 'hips', C.gear2);
    add(R(0.1, 0.075, 0.055, 0.018, { p: [0.055, 0.97, 0.132] }), 'hips', C.gear2);
    if (L0) add(rbox(0.026, 0.026, 0.008, 0, 0, { p: [0.055, 0.975, 0.162] }), 'hips', C.accent); // Sanitätskreuz-Patch
  }
  if (V.dump && !FAR) add(R(0.1, 0.13, 0.08, 0.028, { p: [-0.125, 0.9, 0.122], r: [0.1, 0.3, 0] }), 'hips', C.gear2);
  if (V.vest === 'heavy') add(R(0.17, 0.15, 0.03, 0.014, { p: [0, 0.885, -0.12], r: [-0.12, 0, 0] }), 'hips', C.gear);

  /* ------------------------------------------------------------ Westen */
  const vest = V.vest;
  if (vest === 'plate' || vest === 'heavy' || vest === 'light') {
    const heavy = vest === 'heavy';
    const t = vest === 'light' ? 0.038 : 0.052;
    add(R(0.29, 0.3, t, 0.022, { p: [0, 1.285, -0.118 - t / 2] }), 'chest', C.gear);
    add(R(0.3, 0.32, t, 0.022, { p: [0, 1.29, 0.128 + t / 2] }), 'chest', C.gear);
    // Kummerbund (Ring um den Bauch) mit Seitentaschen
    add(cyl(0.178, 0.172, 0.13, q.tseg, { p: [0, 1.18, 0.006], s: [1.06, 1, 0.82] }), 'chest', C.gear);
    // Schulterträger (mit Polster)
    pair(R(0.065, 0.028, 0.27, 0.012, { p: [-0.1, 1.462, 0.006], r: [0, 0, 0.18] }), 'chest', 'chest', C.gear);
    if (L0) pair(R(0.07, 0.016, 0.13, 0.008, { p: [-0.104, 1.478, -0.02], r: [0, 0, 0.18] }), 'chest', 'chest', C.gear2);
    // MOLLE-Reihen auf der Front (feine Gurtbänder)
    if (L0) for (let i = 0; i < 3; i++) add(rbox(0.27, 0.01, 0.005, 0, 0, { p: [0, 1.32 + i * 0.035, -0.12 - t - 0.002] }), 'chest', C.strap);
    if (vest !== 'light') {
      for (const x of [-0.088, 0, 0.088]) {
        pouch(0.076, 0.115, 0.045, x, 1.19, -0.19);
        if (L0) add(R(0.058, 0.03, 0.026, 0.006, { p: [x, 1.262, -0.183] }), 'chest', C.mag);
      }
      if (!FAR) add(R(0.17, 0.075, 0.03, 0.01, { p: [0, 1.358, -0.183] }), 'chest', C.gear2);
      if (!FAR) pouch(0.058, 0.13, 0.055, -0.205, 1.22, 0.04);
      if (L01) add(cyl(0.006, 0.008, 0.22, 4, { p: [-0.21, 1.39, 0.055] }), 'chest', C.plastic);
      // Seitentaschen am Kummerbund
      if (L0) pair(R(0.03, 0.1, 0.08, 0.01, { p: [-0.196, 1.16, -0.02] }), 'chest', 'chest', C.gear2);
    } else if (!FAR) {
      add(R(0.15, 0.08, 0.03, 0.01, { p: [0, 1.22, -0.168] }), 'chest', C.gear2);
    }
    // Teamabzeichen + Namensband; Tragegriff hinten oben
    const fz = vest === 'light' ? -0.158 : -0.172;
    add(rbox(0.07, 0.045, 0.006, 0, 0, { p: [0.078, 1.39, fz - 0.003] }), 'chest', C.accent);
    if (L0) add(rbox(0.11, 0.024, 0.005, 0, 0, { p: [-0.066, 1.39, fz - 0.002] }), 'chest', C.patch);
    if (L0) for (let i = 0; i < 3; i++) add(rbox(0.26, 0.012, 0.006, 0, 0, { p: [0, 1.2 + i * 0.06, 0.155 + t] }), 'chest', C.strap);
    if (L0) add(torus(0.035, 0.008, 3, 8, { p: [0, 1.44, 0.135 + t], r: [0, 0, 0] }, Math.PI), 'chest', C.strap);
    if (heavy) {
      add(torus(0.098, 0.03, 4, q.cs + 2, { p: [0, 1.478, 0.008], r: [Math.PI / 2, 0, 0], s: [1.06, 0.92, 1] }), 'chest', C.gear);
      pair(R(0.035, 0.16, 0.13, 0.014, { p: [-0.205, 1.23, 0.0] }), 'chest', 'chest', C.gear2);
    }
  } else if (vest === 'rig') {
    add(R(0.31, 0.14, 0.07, 0.022, { p: [0, 1.18, -0.142] }), 'chest', C.gear);
    for (const x of [-0.105, -0.035, 0.035, 0.105]) {
      pouch(0.062, 0.1, 0.03, x, 1.205, -0.19);
      if (L0) add(R(0.05, 0.025, 0.022, 0.005, { p: [x, 1.268, -0.186] }), 'chest', C.mag);
    }
    pair(R(0.045, 0.014, 0.26, 0.005, { p: [-0.1, 1.468, 0.006], r: [0, 0, 0.18] }), 'chest', 'chest', C.strap);
    pair(rbox(0.04, 0.33, 0.012, 0, 0, { p: [-0.055, 1.3, 0.13], r: [0, 0, -0.55] }), 'chest', 'chest', C.strap);
    pair(rbox(0.04, 0.22, 0.012, 0, 0, { p: [-0.105, 1.33, -0.122], r: [0.08, 0, 0.12] }), 'chest', 'chest', C.strap);
    add(rbox(0.06, 0.04, 0.006, 0, 0, { p: [0.09, 1.38, -0.128] }), 'chest', C.accent);
  }

  /* ------------------------------------------------------------ Rucksäcke */
  if (V.back === 'assault') {
    add(R(0.27, 0.34, 0.14, 0.048, { p: [0, 1.26, 0.25] }), 'chest', C.gear2);
    if (!FAR) {
      add(R(0.23, 0.07, 0.1, 0.03, { p: [0, 1.43, 0.25] }), 'chest', C.gear);
      if (L01) pair(rbox(0.012, 0.3, 0.025, 0, 0, { p: [-0.137, 1.26, 0.25] }), 'chest', 'chest', C.strap);
      add(cyl(0.048, 0.048, 0.3, q.cs, { p: [0, 1.49, 0.26], r: [0, 0, Math.PI / 2] }), 'chest', { pal: 'gear', shade: 0.85, detail: 1, cls: 'gear' });
      if (L0) for (let i = 0; i < 2; i++) add(rbox(0.22, 0.01, 0.005, 0, 0, { p: [0, 1.2 + i * 0.06, 0.322] }), 'chest', C.strap);
    }
  } else if (V.back === 'radio') {
    add(R(0.21, 0.27, 0.11, 0.028, { p: [0, 1.27, 0.235] }), 'chest', C.plastic);
    if (!FAR) add(R(0.23, 0.29, 0.03, 0.01, { p: [0, 1.27, 0.175] }), 'chest', C.gear);
    add(cyl(0.006, 0.01, 0.55, 4, { p: [0.075, 1.61, 0.26], r: [-0.12, 0, -0.06] }), 'chest', C.plastic);
    if (L01) add(cyl(0.022, 0.022, 0.04, q.cs, { p: [-0.06, 1.42, 0.255] }), 'chest', C.metal);
    if (L0) add(rbox(0.12, 0.05, 0.012, 0, 0, { p: [0, 1.32, 0.292] }), 'chest', C.mag);
  } else if (V.back === 'medbag') {
    // Sanitätstasche: weißes Feld mit rotem Kreuz (von hinten auf Distanz lesbar)
    add(R(0.25, 0.22, 0.12, 0.03, { p: [0, 1.24, 0.235] }), 'chest', C.gear2);
    add(rbox(0.11, 0.11, 0.004, 0, 0, { p: [0, 1.25, 0.297] }), 'chest', C.medWhite);
    add(rbox(0.075, 0.022, 0.004, 0, 0, { p: [0, 1.25, 0.3] }), 'chest', C.medRed);
    add(rbox(0.022, 0.075, 0.004, 0, 0, { p: [0, 1.25, 0.3] }), 'chest', C.medRed);
    if (!FAR) add(R(0.2, 0.05, 0.1, 0.02, { p: [0, 1.375, 0.235] }), 'chest', C.flap);
  } else if (V.back === 'launcher') {
    // Werfer RW-90 schräg auf dem Rücken (Rohr, Kappen, Visier, Griffstück) + kleiner Rucksack mit Ersatzraketen
    add(R(0.24, 0.26, 0.11, 0.03, { p: [0, 1.25, 0.225] }), 'chest', C.gear2);
    add(cyl(0.052, 0.052, 1.02, q.cs, { p: [0.02, 1.2, 0.315], r: [0, 0, 0.55] }), 'chest', C.tube);
    add(cyl(0.062, 0.062, 0.1, q.cs, { p: [-0.245, 1.633, 0.315], r: [0, 0, 0.55] }), 'chest', C.plastic);
    add(cyl(0.062, 0.062, 0.1, q.cs, { p: [0.285, 0.767, 0.315], r: [0, 0, 0.55] }), 'chest', C.plastic);
    if (!FAR) {
      add(rbox(0.035, 0.07, 0.05, 0, 0, { p: [0.04, 1.2, 0.37], r: [0, 0, 0.55] }), 'chest', C.plastic);
      add(rbox(0.03, 0.09, 0.04, 0, 0, { p: [0.12, 1.06, 0.36], r: [0, 0, 0.55] }), 'chest', C.plastic);
      pair(rbox(0.012, 0.36, 0.024, 0, 0, { p: [-0.12, 1.26, 0.2] }), 'chest', 'chest', C.strap);
    }
  } else if (V.back === 'hydration') {
    add(R(0.2, 0.31, 0.065, 0.028, { p: [0, 1.28, 0.205] }), 'chest', C.gear2);
    if (L01) add(cyl(0.008, 0.008, 0.3, 4, { p: [-0.13, 1.34, -0.03], r: [0.4, 0, 0.3] }), 'chest', C.plastic);
  }

  /* ------------------------------------------------------------ Hals + Kopf */
  const neckMat = covered || V.face === 'gaiter' ? faceFab : V.shemagh ? C.sand : C.skin;
  const neckFab = V.face === 'gaiter' || V.shemagh; // Halstuch/Shemagh: weiter Stoffschlauch statt Hals
  add(cyl(neckFab ? 0.066 : 0.052, neckFab ? 0.072 : 0.06, 0.13, q.cs, { p: [0, 1.53, 0.014], s: [1, 1, 1.05] }), 'neck', neckMat);
  if (V.shemagh) add(torus(0.072, 0.034, 5, q.cs, { p: [0, 1.5, 0.01], r: [Math.PI / 2, 0, 0] }), 'neck', C.sand);
  if (V.face === 'gaiter' && !FAR) add(torus(0.064, 0.016, 4, q.cs, { p: [0, 1.488, 0.012], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] }), 'neck', faceFab);

  const wrapHead = V.head === 'wrap';
  // Hinterkopf: Haar (kurz) unter Helm/Kappe/Hut, sonst Stoff der Sturmhaube bzw. des Kopftuchs
  const skullMat = covered ? faceFab : wrapHead ? { pal: 'gear2', shade: 1.05, detail: 1, cls: 'cloth' } : C.hair;
  // Schädel; Gesicht in Ober- (Augenpartie) und Unterteil (Mund/Kiefer) – das Unterteil trägt bei Halstuch/Shemagh/
  // Sturmhaube den Stoff (Theta von oben gemessen: 0,42π ≈ Höhe Nasenwurzel)
  add(E(0.093, 0.106, 0.104, { p: [0, 1.697, 0.014] }), 'head', skullMat);
  const CUT = Math.PI * 0.42;
  const upperMat = covered ? faceFab : C.skin;
  const lowerMat = lowerCovered && V.face !== 'gasmask' ? faceFab : C.skin;
  add(E(0.08, 0.094, 0.072, { p: [0, 1.652, -0.034] }, { thetaLength: CUT }), 'head', upperMat);
  add(E(lowerCovered && V.face !== 'gasmask' ? 0.087 : 0.08, 0.094, lowerCovered && V.face !== 'gasmask' ? 0.082 : 0.072, { p: [0, 1.652, lowerCovered && V.face !== 'gasmask' ? -0.03 : -0.034] }, { thetaStart: CUT, thetaLength: Math.PI - CUT }), 'head', lowerMat);
  if (!FAR) add(E(0.058, 0.038, 0.05, { p: [0, 1.592, -0.052] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'head', lowerMat);
  // Stoff über der Nase: kleiner Wulst + Saum (Halstuch hochgezogen)
  if (lowerCovered && V.face !== 'gasmask' && !covered && L01) {
    add(E(0.022, 0.016, 0.018, { p: [0, 1.666, -0.1] }, undefined, 8, 6), 'head', lowerMat);
    if (L0) add(torus(0.084, 0.006, 3, 16, { p: [0, 1.673, -0.03], r: [Math.PI / 2 + 0.22, 0, 0], s: [1, 1.0, 1] }, Math.PI), 'head', { ...lowerMat, shade: (lowerMat.shade || 1) * 0.85 });
  }
  if (covered && !FAR) add(R(0.112, 0.036, 0.03, 0.013, { p: [0, 1.69, -0.088] }), 'head', C.skin); // Augenschlitz
  if (L01 && V.face !== 'gasmask') {
    if (!lowerCovered) add(E(0.012, 0.026, 0.018, { p: [0, 1.668, -0.103], r: [-0.3, 0, 0] }, undefined, 6, 5), 'head', C.skin);
    if (!covered) add(E(0.05, 0.012, 0.02, { p: [0, 1.71, -0.084] }, undefined, q.sw / 2 + 2, q.sh / 2), 'head', C.skin); // Brauenbogen
    // Augenpartie: dunklere Mulde unter der Stirn (liest sich auch auf Distanz als Gesicht)
    if (!covered) add(E(0.058, 0.017, 0.011, { p: [0, 1.696, -0.091] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'head', C.socket);
    const eyesHidden = V.eyes === 'shades' || V.eyes === 'glasses' || V.eyes === 'goggles';
    if (L0 && !eyesHidden) {
      pair(E(0.0135, 0.0062, 0.005, { p: [-0.032, 1.694, -0.0985] }, undefined, 6, 4), 'head', 'head', C.eyeWhite);
      pair(E(0.0052, 0.0052, 0.003, { p: [-0.032, 1.694, -0.1025] }, undefined, 5, 4), 'head', 'head', C.eye);
      if (!covered) pair(rbox(0.034, 0.009, 0.012, 0, 0, { p: [-0.034, 1.716, -0.098], r: [0, 0, -0.1] }), 'head', 'head', C.brow);
    } else if (!eyesHidden) {
      add(rbox(0.07, 0.011, 0.01, 0, 0, { p: [0, 1.694, -0.1] }), 'head', C.eye);
    }
    if (!covered && !lowerCovered) add(rbox(0.036, 0.007, 0.01, 0, 0, { p: [0, 1.616, -0.098] }), 'head', { color: shade(skin, 0.78), detail: 0.2, shine: 0.25, cls: 'skin' });
  }

  // Haare (nur unter Kappe/Boonie sichtbar: kurze Seiten)
  if (V.head === 'cap' || V.head === 'boonie' || V.head === 'bare') {
    add(E(0.098, 0.1, 0.11, { p: [0, 1.705, 0.016] }, { thetaLength: Math.PI * 0.5 }), 'head', C.hair);
    if (!FAR) add(E(0.094, 0.07, 0.09, { p: [0, 1.67, 0.04] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'head', C.hair);
  }

  // Kopfbedeckungen
  const helmet = V.head === 'helmet';
  if (helmet) {
    // Schale (mit Bezug im Tarnmuster oder lackiert), Rand, Schienen, Nachtsichthalterung, Akku-Tasche, Kinnriemen
    const shellMat = V.cover ? C.cover : C.helmet;
    add(tiltHelmet(E(0.122, 0.12, 0.134, { p: [0, 1.692, 0.008] }, { thetaLength: Math.PI * 0.55 })), 'head', shellMat);
    if (!FAR) {
      add(tiltHelmet(torus(0.121, 0.008, 3, q.cs + 4, { p: [0, 1.674, 0.008], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] })), 'head', C.helmetDark);
      pair(tiltHelmet(R(0.014, 0.03, 0.13, 0.004, { p: [-0.122, 1.712, 0.008] })), 'head', 'head', C.plastic);
      add(tiltHelmet(R(0.05, 0.034, 0.026, 0.008, { p: [0, 1.757, -0.126], r: [-0.45, 0, 0] })), 'head', C.metal);
      add(tiltHelmet(R(0.08, 0.06, 0.04, 0.016, { p: [0, 1.73, 0.138], r: [0.3, 0, 0] })), 'head', C.gear2);
      if (L01) pair(tiltHelmet(rbox(0.01, 0.1, 0.006, 0, 0, { p: [-0.098, 1.63, -0.02], r: [0.15, 0, -0.08] })), 'head', 'head', C.strap); // Kinnriemen
      if (L0) add(tiltHelmet(rbox(0.05, 0.03, 0.004, 0, 0, { p: [0, 1.79, 0.1], r: [0.9, 0, 0] })), 'head', C.patch); // Klettfeld hinten
    }
    if (V.nvg && !FAR) {
      // hochgeklapptes Nachtsichtgerät: Halterung + Doppelokular quer vor der Helmstirn
      add(tiltHelmet(R(0.03, 0.035, 0.025, 0.008, { p: [0, 1.768, -0.14], r: [-0.6, 0, 0] })), 'head', C.plastic);
      add(tiltHelmet(R(0.085, 0.032, 0.046, 0.012, { p: [0, 1.795, -0.152], r: [-0.95, 0, 0] })), 'head', C.plastic);
      if (L01) pair(tiltHelmet(cyl(0.013, 0.013, 0.006, q.cs, { p: [-0.024, 1.812, -0.168], r: [-0.95 + Math.PI / 2, 0, 0] })), 'head', 'head', C.lens);
    }
    add(tiltHelmet(R(0.026, 0.02, 0.03, 0.006, { p: [0, 1.805, 0.065], r: [0.55, 0, 0] })), 'head', C.accent);
    // Teamband um die Helmschale (auf jeder Stufe – Erkennung auf Distanz)
    add(tiltHelmet(torus(0.121, 0.011, 3, q.cs + 4, { p: [0, 1.724, 0.008], r: [Math.PI / 2, 0, 0], s: [1, 1.09, 1] })), 'head', C.band);
  } else if (V.head === 'cap') {
    const back = V.capBack ? -1 : 1;
    const capMat = { pal: 'gear', shade: 1.08, detail: 1, cls: 'cloth' };
    add(E(0.104, 0.08, 0.115, { p: [0, 1.718, 0.012] }, { thetaLength: Math.PI * 0.5 }), 'head', capMat);
    add(R(0.145, 0.012, 0.1, 0.005, { p: [0, 1.726, -0.128 * back + 0.006], r: [-0.14 * back, 0, 0] }), 'head', { pal: 'gear', shade: 0.92, detail: 1, cls: 'cloth' });
    add(rbox(0.04, 0.03, 0.006, 0, 0, { p: [0, 1.76, back > 0 ? -0.102 : 0.116], r: [back > 0 ? -0.45 : 0.45, 0, 0] }), 'head', C.accent);
    add(torus(0.103, 0.008, 3, q.cs + 2, { p: [0, 1.727, 0.012], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'head', C.band);
    if (L0) add(E(0.012, 0.006, 0.012, { p: [0, 1.797, 0.012] }, undefined, 6, 3), 'head', capMat); // Knopf
  } else if (V.head === 'boonie') {
    add(cyl(0.098, 0.11, 0.08, q.cs, { p: [0, 1.772, 0.012], s: [1, 1, 1.08] }), 'head', C.top);
    add(E(0.098, 0.022, 0.106, { p: [0, 1.812, 0.012] }, { thetaLength: Math.PI * 0.5 }), 'head', C.top);
    add(cyl(0.185, 0.195, 0.014, q.cs + 3, { p: [0, 1.735, 0.012], r: [0.04, 0, 0], s: [1, 1, 1.05] }), 'head', C.top);
    add(cyl(0.112, 0.112, 0.022, q.cs, { p: [0, 1.752, 0.012], s: [1, 1, 1.08] }), 'head', C.band); // Hutband in Teamfarbe
    add(rbox(0.035, 0.022, 0.006, 0, 0, { p: [0.0, 1.752, -0.11] }), 'head', C.accent);
    if (V.ghillie) {
      // Tarnüberwurf: Jute-Streifen auf Hutkrempe und Nacken (Kopf) + Umhang über Schultern/Rücken (Brust); feste Anordnung
      add(E(0.2, 0.05, 0.21, { p: [0, 1.75, 0.02] }, { thetaLength: Math.PI * 0.5 }, q.sw, Math.max(3, q.sh / 2)), 'head', C.jute);
      add(E(0.27, 0.2, 0.2, { p: [0, 1.4, 0.07] }, { thetaLength: Math.PI * 0.55 }), 'chest', C.jute);
      const n = FAR ? 6 : L01 ? 14 : 22;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (i % 3) * 0.37;
        const onHead = i % 2 === 0;
        const r = onHead ? 0.17 + (i % 4) * 0.012 : 0.22 + (i % 5) * 0.01;
        const x = Math.sin(a) * r, z = Math.cos(a) * r * (onHead ? 1 : 0.85) + (onHead ? 0.012 : 0.08);
        if (!onHead && z < -0.05) continue; // vorn frei (Waffe/Gesicht)
        const len = onHead ? 0.09 + (i % 3) * 0.03 : 0.16 + (i % 4) * 0.05;
        const y = onHead ? 1.73 - len * 0.45 : 1.42 - len * 0.45;
        add(rbox(0.035, len, 0.012, 0, 0, { p: [x, y, z], r: [Math.cos(a) * 0.35, a, -Math.sin(a) * 0.35] }), onHead ? 'head' : 'chest', i % 3 ? C.jute : C.jute2);
      }
    }
  } else if (V.head === 'beanie') {
    add(E(0.103, 0.104, 0.114, { p: [0, 1.703, 0.012] }, { thetaLength: Math.PI * 0.55 }), 'head', C.knit);
    add(cyl(0.106, 0.108, 0.04, q.cs + 2, { p: [0, 1.718, 0.012], s: [1, 1, 1.07] }), 'head', { ...C.knit, color: '#323334' });
    add(rbox(0.03, 0.02, 0.006, 0, 0, { p: [0.045, 1.72, -0.106] }), 'head', C.accent);
    add(torus(0.107, 0.008, 3, q.cs + 2, { p: [0, 1.742, 0.012], r: [Math.PI / 2, 0, 0], s: [1, 1.07, 1] }), 'head', C.band);
  } else if (wrapHead) {
    // Kopftuch: über den Schädel gebunden, Stirnwulst, Knoten mit Enden im Nacken, Teamband
    const wrap = { pal: 'gear2', shade: 1.05, detail: 1, cls: 'cloth' };
    add(E(0.1, 0.104, 0.11, { p: [0, 1.703, 0.014] }, { thetaLength: Math.PI * 0.56 }), 'head', wrap);
    if (!FAR) add(torus(0.098, 0.012, 4, q.cs + 2, { p: [0, 1.715, 0.014], r: [Math.PI / 2 + 0.12, 0, 0], s: [1, 1.1, 1] }), 'head', { ...wrap, shade: 0.9 });
    if (L01) add(E(0.03, 0.026, 0.024, { p: [0, 1.7, 0.122] }, undefined, 8, 6), 'head', wrap);
    if (L01) pair(rbox(0.03, 0.09, 0.008, 0, 0, { p: [-0.018, 1.64, 0.13], r: [0.25, 0, 0.18] }), 'head', 'head', wrap);
    add(torus(0.1, 0.008, 3, q.cs + 2, { p: [0, 1.742, 0.014], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] }), 'head', C.band);
  }
  // Headset (Gehörschutz)
  if (V.ears) {
    pair(cyl(0.033, 0.033, 0.03, q.cs, { p: [-0.1, 1.668, 0.01], r: [0, 0, Math.PI / 2] }), 'head', 'head', C.plastic);
    if (L0) pair(cyl(0.024, 0.024, 0.008, q.cs, { p: [-0.117, 1.668, 0.01], r: [0, 0, Math.PI / 2] }), 'head', 'head', { ...C.plastic, color: '#2a2d30' });
    if (!helmet && !FAR) add(torus(0.106, 0.009, 3, q.cs, { p: [0, 1.67, 0.012], s: [1, 1.12, 1] }, Math.PI), 'head', C.plastic);
    if (L0) add(cyl(0.004, 0.004, 0.08, 3, { p: [0.088, 1.625, -0.058], r: [0.2, 0.8, 1.2] }), 'head', C.plastic);
  }
  // Brillen / Maske
  if (V.eyes === 'goggles') {
    add(R(0.13, 0.046, 0.034, 0.016, { p: [0, 1.697, -0.093] }), 'head', { color: '#25282a', detail: 0.3, shine: 0.3, cls: 'hard' });
    if (!FAR) pair(R(0.05, 0.032, 0.008, 0.01, { p: [-0.031, 1.697, -0.111] }), 'head', 'head', C.visor);
    else add(R(0.11, 0.032, 0.008, 0.01, { p: [0, 1.697, -0.111] }), 'head', C.visor);
    if (!FAR) add(torus(0.112, 0.008, 3, q.cs, { p: [0, 1.697, 0.012], r: [Math.PI / 2, 0, 0], s: [1, 1.13, 1] }), 'head', C.strap);
  } else if (V.eyes === 'shades' || V.eyes === 'glasses') {
    // Schutzbrille als gebogenes Glasband (Panorama), Bügel bis zum Ohr
    const glass = V.eyes === 'shades' ? C.lens : C.smoke;
    if (FAR) add(rbox(0.112, 0.027, 0.014, 0, 0, { p: [0, 1.694, -0.099] }), 'head', glass);
    else {
      add(E(0.1, 0.06, 0.113, { p: [0, 1.694, 0.0] }, { phiStart: Math.PI * 1.5 - Math.PI * 0.36, phiLength: Math.PI * 0.72, thetaStart: Math.PI * 0.4, thetaLength: Math.PI * 0.2 }, 14, 4), 'head', glass);
      if (L0) add(E(0.101, 0.06, 0.114, { p: [0, 1.6945, 0.0] }, { phiStart: Math.PI * 1.5 - Math.PI * 0.37, phiLength: Math.PI * 0.74, thetaStart: Math.PI * 0.385, thetaLength: Math.PI * 0.03 }, 14, 1), 'head', C.plastic);
      if (L01) pair(rbox(0.006, 0.008, 0.1, 0, 0, { p: [-0.096, 1.697, -0.03] }), 'head', 'head', C.plastic);
    }
  }
  if (V.face === 'gasmask') {
    add(E(0.07, 0.074, 0.06, { p: [0, 1.64, -0.065] }), 'head', { color: '#2a2d2f', detail: 0.6, shine: 0.32, cls: 'leather' });
    // Sichtgläser deutlich vor der Maske, hell mit Glanzlicht (Blickrichtung erkennbar), dunkle Fassung
    pair(cyl(0.031, 0.031, 0.012, q.cs, { p: [-0.036, 1.69, -0.108], r: [Math.PI / 2 - 0.15, 0, 0] }), 'head', 'head', { color: '#151617', detail: 0, shine: 0.4, cls: 'hard' });
    pair(cyl(0.025, 0.025, 0.006, q.cs, { p: [-0.036, 1.69, -0.116], r: [Math.PI / 2 - 0.15, 0, 0] }), 'head', 'head', C.visor);
    // Filter dunkel (nicht in Hautfarbe – wirkte sonst wie ein Haarknoten)
    add(cyl(0.032, 0.032, 0.048, q.cs, { p: [0.035, 1.59, -0.115], r: [1.1, 0.4, 0] }), 'head', { color: '#1c1e1f', detail: 0.5, shine: 0.25, cls: 'hard' });
    if (!FAR) add(cyl(0.018, 0.018, 0.012, q.cs, { p: [0.044, 1.578, -0.136], r: [1.1, 0.4, 0] }), 'head', C.metal);
    add(E(0.1, 0.11, 0.106, { p: [0, 1.692, 0.018] }, { thetaLength: Math.PI * 0.62 }), 'head', C.top);
    if (L01) pair(rbox(0.012, 0.012, 0.11, 0, 0, { p: [-0.092, 1.67, 0.01], r: [0.4, 0, 0] }), 'head', 'head', C.strap); // Maskenbänder
  }

  /* ------------------------------------------------------------ Arme */
  pair(E(0.068, 0.072, 0.07, { p: [-0.198, 1.418, 0.0] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'upperArmL', 'upperArmR', C.top);
  pair(lathe([[0.046, 1.13], [0.05, 1.18], [0.057, 1.26], [0.06, 1.33], [0.062, 1.4]], q.seg, { p: [-0.19, 0, 0.0], s: [0.96, 1, 1.04] }), 'upperArmL', 'upperArmR', C.top);
  // Armbinde in Teamfarbe rund um den Oberarm (auch aus der Ferne und von hinten sichtbar)
  pair(cyl(0.066, 0.064, 0.06, q.cs, { p: [-0.19, 1.275, 0.0], s: [0.97, 1, 1.05] }, true), 'upperArmL', 'upperArmR', C.band);
  if (L0) pair(rbox(0.006, 0.05, 0.05, 0, 0, { p: [-0.256, 1.345, 0.0] }), 'upperArmL', 'upperArmR', C.patch); // Ärmeltaschen-Klett
  if (V.armband === 'medic') {
    // Armbinde Sanitäter (weiß, rotes Kreuz außen) unter dem Teamband
    pair(cyl(0.067, 0.065, 0.07, q.cs, { p: [-0.19, 1.2, 0.0], s: [0.97, 1, 1.05] }, true), 'upperArmL', 'upperArmR', C.medWhite);
    pair(rbox(0.006, 0.046, 0.014, 0, 0, { p: [-0.259, 1.2, 0.0] }), 'upperArmL', 'upperArmR', C.medRed);
    pair(rbox(0.006, 0.014, 0.046, 0, 0, { p: [-0.259, 1.2, 0.0] }), 'upperArmL', 'upperArmR', C.medRed);
  }
  if (V.pauldrons) pair(E(0.08, 0.06, 0.086, { p: [-0.21, 1.41, 0.0] }, { thetaLength: Math.PI * 0.5 }), 'upperArmL', 'upperArmR', C.gear);
  const rolled = V.sleeves === 'rolled';
  if (L01) pair(E(0.047, 0.045, 0.048, { p: [-0.19, 1.155, 0.004] }, undefined, q.sw / 2 + 1, q.sh / 2), 'foreArmL', 'foreArmR', rolled ? C.skin : { ...C.top, wear: 0.6 });
  pair(lathe([[0.038, 0.91], [0.041, 0.96], [0.049, 1.06], [0.05, 1.12], [0.046, 1.17]], q.seg, { p: [-0.19, 0, 0.0], s: [0.92, 1, 1.08] }), 'foreArmL', 'foreArmR', rolled ? C.skin : C.top);
  if (rolled) pair(torus(0.05, 0.015, 4, q.cs, { p: [-0.19, 1.12, 0.0], r: [Math.PI / 2, 0, 0] }), 'foreArmL', 'foreArmR', C.top);
  if (!FAR) pair(cyl(0.044, 0.042, 0.05, q.cs, { p: [-0.19, 0.93, 0] }), 'foreArmL', 'foreArmR', C.glove);
  if (L0) add(R(0.016, 0.026, 0.034, 0.004, { p: [-0.232, 0.962, 0] }), 'foreArmL', C.plastic);
  // Hände: Handfläche (innen = +X links), gekrümmte Finger, Daumen, Knöchelpolster
  pair(R(0.032, 0.085, 0.08, 0.014, { p: [-0.19, 0.86, 0.0] }), 'handL', 'handR', C.glove);
  if (!FAR) {
    pair(R(0.028, 0.06, 0.075, 0.012, { p: [-0.181, 0.8, 0.0], r: [0, 0, 0.6] }), 'handL', 'handR', C.glove);
    pair(R(0.022, 0.052, 0.022, 0.009, { p: [-0.178, 0.865, -0.048], r: [0.35, 0, 0.35] }), 'handL', 'handR', C.glove);
  }
  if (L0) pair(rbox(0.008, 0.038, 0.066, 0, 0, { p: [-0.207, 0.87, 0.0] }), 'handL', 'handR', C.plastic);

  const geo = B.build();
  geo.userData.variant = V.id;
  geo.userData.lod = lod;
  return geo;
}

/** Farbe aufhellen/abdunkeln (sRGB-Hex). */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
}

export { shade, xf, limb };
