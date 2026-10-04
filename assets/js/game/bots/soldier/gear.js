// NULLPUNKT — Soldaten-Ausrüstung: 8 Ausrüstungsvarianten (Kopfbedeckung, Gesicht, Weste, Rucksack,
// Ärmel, Knieschoner, Holster …) × Farbschema × 3 Detailstufen → eine geteilte, gecachte Geometrie.
// Koordinaten: Modellraum der Bindepose (Füße im Ursprung, Blick −Z, rechts +X, Arme hängen).
import { SkinBuilder, limb, lathe, rbox, ellipsoid, cyl, torus, xf } from './builder.js';
import { SCHEMES, SKIN_TONES } from './materials.js';

export const VARIANTS = [
  { id: 'sturm', name: 'Sturm', head: 'helmet', nvg: true, ears: true, face: 'none', vest: 'plate', back: 'assault', knees: true, holster: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'spaeher', name: 'Späher', head: 'boonie', face: 'shades', beard: true, shemagh: true, vest: 'rig', back: 'hydration', knees: false, holster: false, sleeves: 'rolled', skin: 2, hair: '#3b2a1c' },
  { id: 'funker', name: 'Funker', head: 'cap', ears: true, face: 'none', vest: 'plate', back: 'radio', knees: false, holster: true, sleeves: 'long', skin: 0, hair: '#5a4026' },
  { id: 'grenadier', name: 'Grenadier', head: 'helmet', face: 'balaclava', goggles: true, vest: 'plate', back: 'none', knees: true, dump: true, sleeves: 'long', skin: 3, hair: '#18120d' },
  { id: 'schatten', name: 'Schatten', head: 'beanie', face: 'balaclava', vest: 'light', back: 'none', knees: false, holster: true, sleeves: 'long', skin: 4, hair: '#141110' },
  { id: 'bastion', name: 'Bastion', head: 'helmet', face: 'gasmask', vest: 'heavy', back: 'none', knees: true, pauldrons: true, dump: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'kundschafter', name: 'Kundschafter', head: 'bare', ears: true, face: 'none', beard: true, vest: 'rig', back: 'assault', knees: true, sleeves: 'rolled', skin: 5, hair: '#4a3420' },
  { id: 'pionier', name: 'Pionier', head: 'cap', capBack: true, ears: true, face: 'shades', vest: 'plate', back: 'none', knees: true, holster: true, dump: true, sleeves: 'long', skin: 2, hair: '#2e2016' },
];
export const VARIANT_IDS = VARIANTS.map((v) => v.id);

// Detailstufen: Profilsegmente, Ringe, Kappenringe, Rundquader-Segmente, Kugel-Segmente
const Q = [
  { seg: 12, rings: 4, cap: 3, rb: 1, big: 2, sw: 16, sh: 11, cs: 12 },
  { seg: 7, rings: 2, cap: 2, rb: 0, big: 1, sw: 9, sh: 6, cs: 7 },
  { seg: 5, rings: 1, cap: 1, rb: 0, big: 0, sw: 6, sh: 4, cs: 5 },
];

const cache = new Map();

/** Geometrie (gecacht) für Variante × Schema × Detailstufe. */
export function soldierGeometry(variantId, schemeId, lod = 0) {
  const key = `${variantId}|${schemeId}|${lod}`;
  let g = cache.get(key);
  if (!g) {
    const v = VARIANTS.find((x) => x.id === variantId) || VARIANTS[0];
    g = buildSoldier(v, SCHEMES[schemeId] || SCHEMES.A, Math.max(0, Math.min(2, lod)));
    g.userData.key = key;
    cache.set(key, g);
  }
  return g;
}

export function disposeSoldierGeometries() {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

/* ======================================================================== Aufbau */

function buildSoldier(V, S, lod) {
  const q = Q[lod];
  const B = new SkinBuilder({ uvScale: 2.1 });
  const L0 = lod === 0, L01 = lod <= 1;
  const skin = SKIN_TONES[V.skin % SKIN_TONES.length];

  // Farb-/Materialvorgaben
  const C = {
    top: { color: '#ececec', camo: 1, detail: 1 },
    pants: { color: '#d6d6d6', camo: 1, detail: 1 },
    gear: { color: S.gear, detail: 1, shine: 0.05 },
    gear2: { color: S.gear2, detail: 1, shine: 0.05 },
    strap: { color: S.strap, detail: 0.8 },
    helmet: { color: S.helmet, detail: 0.45, shine: 0.18 },
    skin: { color: skin, detail: 0, shine: 0.32 },
    hair: { color: V.hair, detail: 0.7, shine: 0.1 },
    glove: { color: S.glove, detail: 0.7, shine: 0.18 },
    boot: { color: S.boot, detail: 0.35, shine: 0.38 },
    sole: { color: '#18191a', detail: 0.2, shine: 0.1 },
    metal: { color: S.metal, detail: 0, shine: 0.88 },
    plastic: { color: '#1e2022', detail: 0.25, shine: 0.45 },
    lens: { color: '#10161c', detail: 0, shine: 1 },
    accent: { color: S.accent, detail: 0, emis: 0.75, shine: 0.3 },
    mag: { color: '#2a2b2c', detail: 0.2, shine: 0.55 },
    knee: { color: S.gear2, detail: 0.6, shine: 0.2 },
    eye: { color: '#1b1612', detail: 0, shine: 0.9 },
    eyeWhite: { color: '#cfc6bb', detail: 0, shine: 0.6 },
    lip: { color: shade(skin, 0.82), detail: 0, shine: 0.3 },
  };
  const knit = { color: '#2b2c2d', detail: 1, shine: 0 };
  const fabricFace = V.face === 'balaclava' ? { color: shade(S.gear2, 0.8), detail: 1 } : null;
  const add = (geo, bone, mat, extra = {}) => B.add(geo, { bone, ...mat, ...extra });
  const pair = (geo, boneL, boneR, mat) => B.add(geo, { bone: boneL, mirrorBone: boneR, ...mat });
  const R = (w, h, d, r, opts, big = false) => rbox(w, h, d, r, big ? q.big : q.rb, opts);

  /* ------------------------------------------------------------ Beine */
  // Oberschenkel (leicht nach vorn gewölbt)
  pair(limb(0.47, 0.93, 0.068, 0.094, { seg: q.seg, rings: q.rings, capRings: q.cap, bulge: 0.06, bulgeAt: 0.55, sx: 1, sz: 1.1, x: -0.1, z: 0.005 }), 'thighL', 'thighR', C.pants);
  if (L01) {
    // Beintasche außen
    pair(R(0.045, 0.14, 0.12, 0.018, { p: [-0.19, 0.71, 0.005], r: [0, 0, 0.04] }), 'thighL', 'thighR', { ...C.pants, color: '#c4c4c4' });
    if (L0) pair(rbox(0.05, 0.03, 0.125, 0, 0, { p: [-0.192, 0.79, 0.005], r: [0, 0, 0.04] }), 'thighL', 'thighR', { ...C.pants, color: '#b8b8b8' });
  }
  if (V.holster) {
    add(R(0.065, 0.17, 0.1, 0.02, { p: [0.205, 0.74, 0.02], r: [0.08, 0, -0.06] }), 'thighR', C.gear2);
    add(rbox(0.032, 0.075, 0.04, 0, 0, { p: [0.205, 0.845, 0.055], r: [0.25, 0, -0.06] }), 'thighR', C.plastic);
    if (L01) add(torus(0.098, 0.009, 3, q.cs, { p: [0.1, 0.66, 0.005], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'thighR', C.strap);
  }
  // Unterschenkel mit Wade
  pair(lathe([[0.048, 0.15], [0.052, 0.2], [0.064, 0.3], [0.07, 0.38], [0.068, 0.45], [0.064, 0.51]].map(([r, y]) => [r, y]), q.seg, { p: [-0.1, 0, 0.004], s: [1, 1, 1.08] }), 'shinL', 'shinR', C.pants);
  // Knieschoner
  if (V.knees) {
    pair(R(0.105, 0.13, 0.05, 0.022, { p: [-0.1, 0.495, -0.07], r: [-0.12, 0, 0] }, true), 'shinL', 'shinR', C.knee);
    if (L01) pair(torus(0.068, 0.008, 3, q.cs, { p: [-0.1, 0.44, 0.005], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'shinL', 'shinR', C.strap);
  }
  // Stiefelschaft + Hosenabschluss
  pair(cyl(0.062, 0.064, 0.15, q.cs, { p: [-0.1, 0.135, -0.002] }), 'shinL', 'shinR', C.boot);
  if (L01) pair(torus(0.062, 0.012, 4, q.cs, { p: [-0.1, 0.215, 0], r: [Math.PI / 2, 0, 0] }), 'shinL', 'shinR', C.pants);
  if (L0) for (let i = 0; i < 3; i++) pair(rbox(0.05, 0.008, 0.01, 0, 0, { p: [-0.1, 0.105 + i * 0.035, -0.062] }), 'shinL', 'shinR', C.plastic);
  // Fuß: Stiefel + Sohle + Zehenkappe
  pair(R(0.1, 0.07, 0.25, 0.03, { p: [-0.1, 0.06, -0.05] }, true), 'footL', 'footR', C.boot);
  pair(rbox(0.108, 0.026, 0.27, 0.008, L0 ? 1 : 0, { p: [-0.1, 0.013, -0.052] }), 'footL', 'footR', C.sole);
  if (L01) pair(ellipsoid(0.05, 0.035, 0.05, q.sw / 2, q.sh / 2, { p: [-0.1, 0.05, -0.15] }), 'footL', 'footR', C.boot);

  /* ------------------------------------------------------------ Becken */
  add(R(0.33, 0.2, 0.215, 0.075, { p: [0, 0.915, 0.008] }, true), 'hips', C.pants);
  add(ellipsoid(0.12, 0.07, 0.1, q.sw / 2, q.sh / 2, { p: [0, 0.84, 0.0] }), 'hips', C.pants);
  // Gefechtsgürtel
  add(R(0.355, 0.065, 0.245, 0.03, { p: [0, 0.995, 0.004] }, true), 'hips', C.gear);
  if (L01) {
    add(rbox(0.065, 0.045, 0.012, 0, 0, { p: [0, 0.995, -0.124] }), 'hips', C.metal);
    pair(R(0.06, 0.09, 0.075, 0.015, { p: [-0.175, 0.965, 0.045] }), 'hips', 'hips', C.gear2);
    add(R(0.11, 0.08, 0.06, 0.015, { p: [0.06, 0.97, 0.135] }), 'hips', C.gear2);
  }
  if (V.dump) add(R(0.1, 0.13, 0.08, 0.025, { p: [-0.13, 0.9, 0.125], r: [0.1, 0, 0] }), 'hips', C.gear2);
  if (V.vest === 'heavy') add(R(0.17, 0.16, 0.035, 0.015, { p: [0, 0.88, -0.125], r: [-0.12, 0, 0] }), 'hips', C.gear);

  /* ------------------------------------------------------------ Rumpf */
  add(R(0.31, 0.22, 0.2, 0.075, { p: [0, 1.1, 0.005] }, true), 'spine', C.top);
  add(R(0.355, 0.27, 0.215, 0.085, { p: [0, 1.3, 0.008] }, true), 'chest', C.top);
  add(R(0.39, 0.12, 0.19, 0.055, { p: [0, 1.4, 0.004] }, true), 'chest', C.top);
  // Schulterkuppen (Trapez)
  pair(ellipsoid(0.095, 0.06, 0.085, q.sw / 2, q.sh / 2, { p: [-0.14, 1.435, 0.01] }), 'chest', 'chest', C.top);
  // Kragen
  add(cyl(0.075, 0.09, 0.05, q.cs, { p: [0, 1.47, 0.01] }, true), 'chest', V.shemagh ? { color: '#b9a582', detail: 1 } : C.top);

  // Westen
  const vest = V.vest;
  if (vest === 'plate' || vest === 'heavy' || vest === 'light') {
    const heavy = vest === 'heavy';
    const t = vest === 'light' ? 0.04 : 0.055;
    add(R(0.29, 0.3, t, 0.02, { p: [0, 1.27, -0.105 - t / 2] }, true), 'chest', C.gear);
    add(R(0.3, 0.32, t, 0.02, { p: [0, 1.28, 0.112 + t / 2] }, true), 'chest', C.gear);
    pair(R(0.05, 0.19, 0.21, 0.018, { p: [-0.168, 1.19, 0.004] }), 'chest', 'chest', C.gear);
    pair(R(0.065, 0.03, 0.26, 0.012, { p: [-0.105, 1.452, 0.004] }), 'chest', 'chest', C.gear);
    if (vest !== 'light') {
      // Magazintaschen
      for (const x of [-0.088, 0, 0.088]) {
        add(R(0.078, 0.12, 0.046, 0.012, { p: [x, 1.175, -0.183] }), 'chest', C.gear2);
        if (L0) add(rbox(0.058, 0.03, 0.026, 0, 0, { p: [x, 1.245, -0.18] }), 'chest', C.mag);
      }
      if (L01) add(R(0.17, 0.075, 0.03, 0.01, { p: [0, 1.345, -0.172] }), 'chest', C.gear2);
      // Funkgerät links
      add(R(0.06, 0.13, 0.055, 0.012, { p: [-0.2, 1.2, 0.045] }), 'chest', C.gear2);
      if (L01) add(cyl(0.006, 0.008, 0.22, 4, { p: [-0.205, 1.37, 0.06] }), 'chest', C.plastic);
    } else if (L01) {
      add(R(0.15, 0.08, 0.03, 0.01, { p: [0, 1.2, -0.16] }), 'chest', C.gear2);
    }
    // Teamabzeichen + Namensband
    add(rbox(0.07, 0.045, 0.006, 0, 0, { p: [0.075, 1.375, vest === 'light' ? -0.17 : -0.188] }), 'chest', C.accent);
    if (L0) add(rbox(0.11, 0.025, 0.005, 0, 0, { p: [-0.065, 1.375, vest === 'light' ? -0.169 : -0.187] }), 'chest', { color: shade(S.gear, 0.75), detail: 1 });
    if (L0) for (let i = 0; i < 3; i++) add(rbox(0.26, 0.012, 0.006, 0, 0, { p: [0, 1.2 + i * 0.06, 0.142 + t] }), 'chest', C.strap);
    if (heavy) {
      // Halsschutz + Leistenschutz (Becken) + Seitenplatten
      add(torus(0.1, 0.03, 4, q.cs, { p: [0, 1.475, 0.005], r: [Math.PI / 2, 0, 0], s: [1.05, 1, 1] }), 'chest', C.gear);
      pair(R(0.035, 0.16, 0.13, 0.012, { p: [-0.198, 1.22, 0.0] }), 'chest', 'chest', C.gear2);
    }
  } else if (vest === 'rig') {
    add(R(0.31, 0.14, 0.07, 0.02, { p: [0, 1.17, -0.135] }, true), 'chest', C.gear);
    for (const x of [-0.105, -0.035, 0.035, 0.105]) {
      add(R(0.062, 0.1, 0.03, 0.01, { p: [x, 1.195, -0.182] }), 'chest', C.gear2);
      if (L0) add(rbox(0.05, 0.025, 0.022, 0, 0, { p: [x, 1.255, -0.178] }), 'chest', C.mag);
    }
    // Träger (X auf dem Rücken)
    pair(rbox(0.045, 0.012, 0.25, 0, 0, { p: [-0.1, 1.455, 0.004] }), 'chest', 'chest', C.strap);
    pair(rbox(0.04, 0.33, 0.012, 0, 0, { p: [-0.055, 1.29, 0.124], r: [0, 0, -0.55] }), 'chest', 'chest', C.strap);
    pair(rbox(0.04, 0.24, 0.012, 0, 0, { p: [-0.11, 1.3, -0.117], r: [0, 0, 0.12] }), 'chest', 'chest', C.strap);
    add(rbox(0.06, 0.04, 0.006, 0, 0, { p: [0.09, 1.365, -0.118] }), 'chest', C.accent);
  }

  // Rucksäcke
  if (V.back === 'assault') {
    add(R(0.27, 0.34, 0.14, 0.045, { p: [0, 1.25, 0.24] }, true), 'chest', C.gear2);
    if (L01) {
      add(R(0.23, 0.07, 0.1, 0.03, { p: [0, 1.42, 0.24] }), 'chest', C.gear);
      pair(rbox(0.012, 0.3, 0.025, 0, 0, { p: [-0.137, 1.25, 0.24] }), 'chest', 'chest', C.strap);
      add(cyl(0.05, 0.05, 0.3, q.cs, { p: [0, 1.48, 0.25], r: [0, 0, Math.PI / 2] }), 'chest', { color: shade(S.gear, 0.85), detail: 1 });
    }
  } else if (V.back === 'radio') {
    add(R(0.21, 0.27, 0.11, 0.025, { p: [0, 1.26, 0.225] }, true), 'chest', C.plastic);
    add(R(0.23, 0.29, 0.03, 0.01, { p: [0, 1.26, 0.165] }), 'chest', C.gear);
    add(cyl(0.006, 0.01, 0.55, 4, { p: [0.075, 1.6, 0.25], r: [-0.12, 0, -0.06] }), 'chest', C.plastic);
    if (L01) add(cyl(0.022, 0.022, 0.04, q.cs, { p: [-0.06, 1.41, 0.245] }), 'chest', C.metal);
  } else if (V.back === 'hydration') {
    add(R(0.2, 0.31, 0.065, 0.025, { p: [0, 1.27, 0.2] }, true), 'chest', C.gear2);
    if (L01) add(cyl(0.008, 0.008, 0.3, 4, { p: [-0.13, 1.33, -0.02], r: [0.4, 0, 0.3] }), 'chest', C.plastic);
  }

  /* ------------------------------------------------------------ Hals + Kopf */
  const neckMat = V.face === 'balaclava' ? fabricFace : V.shemagh ? { color: '#b9a582', detail: 1 } : C.skin;
  add(cyl(0.056, 0.062, 0.12, q.cs, { p: [0, 1.53, 0.012] }), 'neck', neckMat);
  if (V.shemagh) add(torus(0.075, 0.035, 5, q.cs, { p: [0, 1.5, 0.008], r: [Math.PI / 2, 0, 0] }), 'neck', { color: '#b9a582', detail: 1 });

  const headCovered = V.face === 'balaclava';
  const faceMat = headCovered ? fabricFace : C.skin;
  // Schädel + Kiefer + Kinn
  add(ellipsoid(0.097, 0.114, 0.11, q.sw, q.sh, { p: [0, 1.687, 0.006] }), 'head', faceMat);
  add(R(0.118, 0.1, 0.1, 0.038, { p: [0, 1.622, -0.034] }, true), 'head', faceMat);
  if (L01) add(ellipsoid(0.042, 0.03, 0.036, q.sw / 2, q.sh / 2, { p: [0, 1.586, -0.07] }), 'head', faceMat);
  if (headCovered) {
    // Augenschlitz der Sturmhaube
    add(R(0.1, 0.038, 0.03, 0.012, { p: [0, 1.69, -0.088] }), 'head', C.skin);
  }
  if (L01 && V.face !== 'gasmask') {
    // Nase, Augen, Brauen, Mund
    if (!headCovered) add(ellipsoid(0.017, 0.033, 0.022, 6, 5, { p: [0, 1.665, -0.106], r: [-0.25, 0, 0] }), 'head', C.skin);
    if (L0) {
      pair(ellipsoid(0.015, 0.009, 0.006, 6, 4, { p: [-0.034, 1.692, -0.101] }), 'head', 'head', C.eyeWhite);
      pair(ellipsoid(0.007, 0.007, 0.004, 5, 4, { p: [-0.034, 1.692, -0.106] }), 'head', 'head', C.eye);
      if (!headCovered) {
        pair(rbox(0.034, 0.008, 0.012, 0, 0, { p: [-0.035, 1.711, -0.1], r: [0, 0, -0.08] }), 'head', 'head', C.hair);
        add(rbox(0.04, 0.008, 0.01, 0, 0, { p: [0, 1.618, -0.09] }), 'head', C.lip);
      }
    } else {
      add(rbox(0.08, 0.012, 0.01, 0, 0, { p: [0, 1.692, -0.1] }), 'head', C.eye);
    }
    if (!headCovered && V.head !== 'helmet') pair(ellipsoid(0.012, 0.03, 0.02, 5, 4, { p: [-0.098, 1.67, 0.006] }), 'head', 'head', C.skin);
  }
  if (V.beard && !headCovered) add(R(0.122, 0.07, 0.094, 0.03, { p: [0, 1.598, -0.04] }), 'head', C.hair);

  // Haare (sichtbar bei Mütze/Kappe/barhäuptig)
  if (V.head === 'bare' || V.head === 'cap' || V.head === 'boonie') {
    add(ellipsoid(0.102, 0.1, 0.115, q.sw, q.sh, { p: [0, 1.7, 0.012] }, { thetaLength: Math.PI * 0.52 }), 'head', C.hair);
    if (L01) add(R(0.17, 0.05, 0.1, 0.02, { p: [0, 1.66, 0.06] }), 'head', C.hair);
  }

  // Kopfbedeckungen
  const helmet = V.head === 'helmet';
  if (helmet) {
    add(ellipsoid(0.124, 0.122, 0.137, q.sw, q.sh, { p: [0, 1.69, 0.004] }, { thetaLength: Math.PI * 0.56 }), 'head', C.helmet);
    if (L01) {
      add(torus(0.124, 0.008, 3, q.cs + 4, { p: [0, 1.672, 0.004], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'head', { ...C.helmet, color: shade(S.helmet, 0.8) });
      pair(rbox(0.014, 0.03, 0.13, 0, 0, { p: [-0.124, 1.71, 0.004] }), 'head', 'head', C.plastic);
      add(rbox(0.05, 0.035, 0.025, 0, 0, { p: [0, 1.755, -0.128], r: [-0.4, 0, 0] }), 'head', C.metal);
      add(R(0.08, 0.06, 0.04, 0.015, { p: [0, 1.73, 0.135], r: [0.3, 0, 0] }), 'head', C.gear2);
    }
    if (V.nvg) {
      add(rbox(0.03, 0.06, 0.03, 0, 0, { p: [0, 1.78, -0.15], r: [-0.9, 0, 0] }), 'head', C.plastic);
      add(cyl(0.02, 0.02, 0.085, q.cs, { p: [0, 1.82, -0.17], r: [-0.5, 0, 0] }), 'head', C.plastic);
      if (L01) add(cyl(0.021, 0.021, 0.006, q.cs, { p: [0, 1.858, -0.15], r: [-0.5, 0, 0] }), 'head', C.lens);
    }
    // IR-Strobe (Teamfarbe)
    add(rbox(0.026, 0.02, 0.03, 0, 0, { p: [0, 1.8, 0.06], r: [0.5, 0, 0] }), 'head', C.accent);
  } else if (V.head === 'cap') {
    const back = V.capBack ? -1 : 1;
    add(ellipsoid(0.108, 0.08, 0.118, q.sw, q.sh, { p: [0, 1.715, 0.006] }, { thetaLength: Math.PI * 0.5 }), 'head', { color: shade(S.gear, 1.05), detail: 1 });
    add(R(0.15, 0.012, 0.1, 0.005, { p: [0, 1.722, -0.13 * back], r: [-0.12 * back, 0, 0] }), 'head', { color: shade(S.gear, 0.9), detail: 1 });
    if (!V.capBack) add(rbox(0.04, 0.03, 0.006, 0, 0, { p: [0, 1.76, -0.107], r: [-0.45, 0, 0] }), 'head', C.accent);
    else add(rbox(0.04, 0.03, 0.006, 0, 0, { p: [0, 1.76, 0.112], r: [0.45, 0, 0] }), 'head', C.accent);
  } else if (V.head === 'boonie') {
    add(cyl(0.1, 0.112, 0.08, q.cs, { p: [0, 1.77, 0.006] }), 'head', C.top);
    add(cyl(0.1, 0.1, 0.012, q.cs, { p: [0, 1.81, 0.006] }), 'head', C.top);
    add(cyl(0.19, 0.2, 0.014, q.cs + 2, { p: [0, 1.733, 0.006], r: [0.04, 0, 0] }), 'head', C.top);
    add(cyl(0.114, 0.114, 0.022, q.cs, { p: [0, 1.75, 0.006] }), 'head', C.strap);
    add(rbox(0.035, 0.022, 0.006, 0, 0, { p: [0.0, 1.75, -0.117] }), 'head', C.accent);
  } else if (V.head === 'beanie') {
    add(ellipsoid(0.106, 0.105, 0.117, q.sw, q.sh, { p: [0, 1.7, 0.006] }, { thetaLength: Math.PI * 0.55 }), 'head', knit);
    add(cyl(0.11, 0.112, 0.04, q.cs, { p: [0, 1.715, 0.006] }), 'head', { ...knit, color: '#333435' });
    add(rbox(0.03, 0.02, 0.006, 0, 0, { p: [0.04, 1.72, -0.11] }), 'head', C.accent);
  }
  // Gehörschutz/Headset
  if (V.ears) {
    pair(cyl(0.04, 0.04, 0.036, q.cs, { p: [-0.112, 1.665, 0.004], r: [0, 0, Math.PI / 2] }), 'head', 'head', C.plastic);
    if (!helmet) add(torus(0.112, 0.01, 3, q.cs, { p: [0, 1.67, 0.01], s: [1, 1.16, 1] }, Math.PI), 'head', C.plastic);
    if (L01) add(cyl(0.004, 0.004, 0.08, 3, { p: [0.09, 1.62, -0.06], r: [0.2, 0.8, 1.2] }), 'head', C.plastic);
  }
  // Gesicht
  if (V.face === 'shades' || V.goggles) {
    if (V.goggles) {
      add(R(0.135, 0.048, 0.035, 0.016, { p: [0, 1.695, -0.1] }), 'head', C.lens);
      add(torus(0.118, 0.008, 3, q.cs, { p: [0, 1.695, 0.0], r: [Math.PI / 2, 0, 0], s: [1, 1.12, 1] }), 'head', C.strap);
    } else {
      add(rbox(0.118, 0.028, 0.014, 0, 0, { p: [0, 1.692, -0.107] }), 'head', C.lens);
      if (L01) pair(rbox(0.006, 0.008, 0.1, 0, 0, { p: [-0.098, 1.695, -0.055] }), 'head', 'head', C.plastic);
    }
  }
  if (V.face === 'gasmask') {
    add(R(0.115, 0.12, 0.08, 0.035, { p: [0, 1.635, -0.068] }, true), 'head', { color: '#202224', detail: 0.4, shine: 0.35 });
    pair(cyl(0.024, 0.024, 0.012, q.cs, { p: [-0.036, 1.688, -0.107], r: [Math.PI / 2, 0, 0] }), 'head', 'head', C.lens);
    add(cyl(0.036, 0.036, 0.05, q.cs, { p: [0.035, 1.585, -0.115], r: [1.1, 0.4, 0] }), 'head', { color: shade(S.gear2, 0.9), detail: 0.6 });
    add(ellipsoid(0.1, 0.11, 0.105, q.sw, q.sh, { p: [0, 1.69, 0.012] }, { thetaLength: Math.PI * 0.6 }), 'head', C.top);
  }

  /* ------------------------------------------------------------ Arme */
  // Oberarm mit Deltamuskel
  pair(ellipsoid(0.072, 0.07, 0.078, q.sw / 2 + 2, q.sh / 2 + 1, { p: [-0.2, 1.418, 0.0] }), 'upperArmL', 'upperArmR', C.top);
  pair(limb(1.16, 1.41, 0.05, 0.062, { seg: q.seg, rings: q.rings, capRings: q.cap, bulge: 0.05, bulgeAt: 0.6, x: -0.19, z: 0.0, sz: 1.05 }), 'upperArmL', 'upperArmR', C.top);
  pair(rbox(0.006, 0.05, 0.055, 0, 0, { p: [-0.26, 1.35, 0.0] }), 'upperArmL', 'upperArmR', C.accent);
  if (V.pauldrons) pair(ellipsoid(0.085, 0.06, 0.09, q.sw / 2 + 2, q.sh / 2, { p: [-0.215, 1.405, 0.0] }, { thetaLength: Math.PI * 0.5 }), 'upperArmL', 'upperArmR', C.gear);
  // Unterarm
  const rolled = V.sleeves === 'rolled';
  pair(limb(0.93, 1.17, 0.041, 0.05, { seg: q.seg, rings: q.rings, capRings: q.cap, bulge: 0.07, bulgeAt: 0.75, x: -0.19, z: 0.0, sx: 0.95, sz: 1.08 }), 'foreArmL', 'foreArmR', rolled ? C.skin : C.top);
  if (rolled) pair(torus(0.052, 0.014, 4, q.cs, { p: [-0.19, 1.12, 0.0], r: [Math.PI / 2, 0, 0] }), 'foreArmL', 'foreArmR', C.top);
  pair(cyl(0.046, 0.044, 0.05, q.cs, { p: [-0.19, 0.93, 0] }), 'foreArmL', 'foreArmR', C.glove);
  if (L0) add(rbox(0.016, 0.028, 0.036, 0, 0, { p: [-0.237, 0.965, 0] }), 'foreArmL', C.plastic);
  // Hände (Handschuhe): Handfläche, gekrümmte Finger, Daumen; Handfläche zeigt nach innen (+X links)
  pair(R(0.032, 0.085, 0.082, 0.014, { p: [-0.19, 0.86, 0.0] }), 'handL', 'handR', C.glove);
  pair(R(0.03, 0.065, 0.078, 0.012, { p: [-0.18, 0.8, 0.0], r: [0, 0, 0.55] }), 'handL', 'handR', C.glove);
  pair(R(0.024, 0.055, 0.024, 0.01, { p: [-0.178, 0.865, -0.05], r: [0.35, 0, 0.35] }), 'handL', 'handR', C.glove);
  if (L0) pair(rbox(0.008, 0.04, 0.07, 0, 0, { p: [-0.209, 0.87, 0.0] }), 'handL', 'handR', C.plastic);

  const geo = B.build();
  geo.userData.variant = V.id;
  geo.userData.scheme = S.id;
  geo.userData.lod = lod;
  return geo;
}

/** Farbe aufhellen/abdunkeln (sRGB-Hex). */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
}

export { shade, xf };
