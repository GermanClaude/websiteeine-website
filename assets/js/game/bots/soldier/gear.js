// NULLPUNKT — Soldaten-Ausrüstung: 8 Ausrüstungsvarianten (Kopfbedeckung, Gesicht, Weste, Rucksack,
// Ärmel, Knieschoner, Holster …) × Farbschema × 3 Detailstufen → eine geteilte, gecachte Geometrie.
// Koordinaten: Modellraum der Bindepose (Füße im Ursprung, Blick −Z, rechts +X, Arme hängen).
// Körper aus gedrehten Profilen mit elliptischem Querschnitt (weiche Silhouette), Ausrüstung aus
// abgerundeten Quadern; auf Stufe 2 nur noch die Silhouette tragenden Teile.
import { SkinBuilder, limb, lathe as latheBase, rbox, ellipsoid, cyl, torus, xf } from './builder.js';
import { SCHEMES, SKIN_TONES } from './materials.js';

export const VARIANTS = [
  { id: 'sturm', name: 'Sturm', head: 'helmet', nvg: true, ears: true, face: 'shades', vest: 'plate', back: 'assault', knees: true, holster: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'spaeher', name: 'Späher', head: 'boonie', face: 'shades', beard: true, shemagh: true, vest: 'rig', back: 'hydration', knees: false, holster: false, sleeves: 'rolled', skin: 2, hair: '#3b2a1c' },
  { id: 'funker', name: 'Funker', head: 'cap', ears: true, face: 'none', vest: 'plate', back: 'radio', knees: false, holster: true, sleeves: 'long', skin: 0, hair: '#5a4026' },
  { id: 'grenadier', name: 'Grenadier', head: 'helmet', face: 'balaclava', goggles: true, vest: 'plate', back: 'none', knees: true, dump: true, sleeves: 'long', skin: 3, hair: '#18120d' },
  { id: 'schatten', name: 'Schatten', head: 'beanie', face: 'balaclava', vest: 'light', back: 'none', knees: false, holster: true, sleeves: 'long', skin: 4, hair: '#141110' },
  { id: 'bastion', name: 'Bastion', head: 'helmet', face: 'gasmask', vest: 'heavy', back: 'none', knees: true, pauldrons: true, dump: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'kundschafter', name: 'Kundschafter', head: 'bare', ears: true, face: 'none', beard: true, vest: 'rig', back: 'assault', knees: true, sleeves: 'rolled', skin: 5, hair: '#4a3420' },
  { id: 'pionier', name: 'Pionier', head: 'cap', capBack: true, ears: true, face: 'shades', vest: 'plate', back: 'none', knees: true, holster: true, dump: true, sleeves: 'long', skin: 2, hair: '#2e2016' },
];
export const VARIANT_IDS = VARIANTS.map((v) => v.id);

// Detailstufen: Profilsegmente (Gliedmaßen/Rumpf), Ringe, Kappenringe, Rundquader, Kugel-Segmente, Zylinder
const Q = [
  { seg: 10, tseg: 12, rings: 3, cap: 2, rb: 1, sw: 12, sh: 8, cs: 10 },
  { seg: 7, tseg: 9, rings: 2, cap: 1, rb: 0, sw: 9, sh: 6, cs: 7 },
  { seg: 4, tseg: 6, rings: 1, cap: 1, rb: 0, sw: 6, sh: 3, cs: 4 },
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
  const B = new SkinBuilder({ uvScale: 3 });
  const L0 = lod === 0, L01 = lod <= 1, FAR = lod === 2;
  const skin = SKIN_TONES[V.skin % SKIN_TONES.length];

  const C = {
    top: { color: '#dadada', camo: 1, detail: 1 },
    pants: { color: '#c6c6c6', camo: 1, detail: 1 },
    gear: { color: S.gear, detail: 1, shine: 0.04 },
    gear2: { color: S.gear2, detail: 1, shine: 0.04 },
    strap: { color: S.strap, detail: 0.8 },
    helmet: { color: S.helmet, detail: 0.5, shine: 0.16 },
    skin: { color: skin, detail: 0, shine: 0.28 },
    skinDark: { color: shade(skin, 0.86), detail: 0, shine: 0.22 },
    hair: { color: V.hair, detail: 0.8, shine: 0.08 },
    glove: { color: S.glove, detail: 0.7, shine: 0.16 },
    boot: { color: S.boot, detail: 0.35, shine: 0.36 },
    sole: { color: '#17181a', detail: 0.2, shine: 0.08 },
    metal: { color: S.metal, detail: 0, shine: 0.88 },
    plastic: { color: '#1e2022', detail: 0.25, shine: 0.42 },
    lens: { color: '#0e1419', detail: 0, shine: 1 },
    accent: { color: S.accent, detail: 0, emis: 0.55, shine: 0.3 },
    mag: { color: '#2a2b2c', detail: 0.2, shine: 0.55 },
    knee: { color: shade(S.gear2, 0.85), detail: 0.6, shine: 0.2 },
    eye: { color: '#17120e', detail: 0, shine: 0.9 },
    eyeWhite: { color: '#c9c0b4', detail: 0, shine: 0.6 },
    lip: { color: shade(skin, 0.78), detail: 0, shine: 0.25 },
  };
  const knit = { color: '#2a2b2c', detail: 1, shine: 0 };
  const covered = V.face === 'balaclava';
  const faceFab = { color: shade(S.gear2, 0.72), detail: 1 };
  const add = (geo, bone, mat) => B.add(geo, { bone, ...mat });
  const pair = (geo, boneL, boneR, mat) => B.add(geo, { bone: boneL, mirrorBone: boneR, ...mat });
  const R = (w, h, d, r, opts) => rbox(w, h, d, r, q.rb, opts);
  const E = (rx, ry, rz, opts, cut, ws = q.sw, hs = q.sh) => ellipsoid(rx, ry, rz, FAR ? Math.min(ws, 6) : ws, FAR ? Math.min(hs, 3) : hs, opts, cut);
  // Drehprofile auf Stufe 2 ausdünnen (jeder zweite Punkt, Enden bleiben)
  const lathe = (profile, seg, opts) => latheBase(FAR ? profile.filter((_, i) => i === 0 || i === profile.length - 1 || i % 2 === 0) : profile, seg, opts);

  /* ------------------------------------------------------------ Beine */
  pair(lathe([[0.058, 0.44], [0.064, 0.5], [0.075, 0.6], [0.086, 0.72], [0.092, 0.83], [0.094, 0.9], [0.08, 0.96]], q.seg, { p: [-0.098, 0, 0.004], s: [1, 1, 1.06] }), 'thighL', 'thighR', C.pants);
  if (!FAR) {
    pair(R(0.045, 0.14, 0.12, 0.02, { p: [-0.178, 0.7, 0.008], r: [0, 0, 0.06] }), 'thighL', 'thighR', { ...C.pants, color: '#c8c8c8' });
    if (L0) pair(rbox(0.048, 0.022, 0.125, 0.006, 1, { p: [-0.181, 0.775, 0.008], r: [0, 0, 0.06] }), 'thighL', 'thighR', { ...C.pants, color: '#bcbcbc' });
  }
  if (V.holster && !FAR) {
    add(R(0.06, 0.17, 0.1, 0.022, { p: [0.193, 0.74, 0.022], r: [0.08, 0, -0.06] }), 'thighR', C.gear2);
    add(R(0.03, 0.075, 0.04, 0.008, { p: [0.195, 0.845, 0.055], r: [0.25, 0, -0.06] }), 'thighR', C.plastic);
    if (L01) add(torus(0.088, 0.008, 3, q.cs + 2, { p: [0.098, 0.66, 0.006], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] }), 'thighR', C.strap);
  }
  // Knie (Gelenkfüller) + Unterschenkel mit Wade
  if (L01) pair(E(0.06, 0.06, 0.062, { p: [-0.1, 0.49, 0.0] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'shinL', 'shinR', C.pants);
  pair(lathe([[0.047, 0.17], [0.05, 0.22], [0.061, 0.3], [0.067, 0.37], [0.064, 0.44], [0.06, 0.5]], q.seg, { p: [-0.1, 0, 0.006], s: [1, 1, 1.1] }), 'shinL', 'shinR', C.pants);
  if (V.knees) {
    pair(R(0.1, 0.12, 0.045, 0.02, { p: [-0.1, 0.5, -0.066], r: [-0.1, 0, 0] }), 'shinL', 'shinR', C.knee);
    if (L0) pair(torus(0.064, 0.007, 3, q.cs, { p: [-0.1, 0.45, 0.006], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'shinL', 'shinR', C.strap);
  }
  // Stiefel: Schaft, Hosenaufschlag, Fuß mit Sohle und Zehenkappe
  pair(cyl(0.058, 0.061, 0.15, q.cs, { p: [-0.1, 0.13, -0.002], s: [1, 1, 1.08] }, FAR), 'shinL', 'shinR', C.boot);
  if (L01) pair(torus(0.058, 0.013, 4, q.cs, { p: [-0.1, 0.21, 0.004], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'shinL', 'shinR', C.pants);
  if (L0) for (let i = 0; i < 3; i++) pair(rbox(0.045, 0.007, 0.01, 0, 0, { p: [-0.1, 0.1 + i * 0.033, -0.063] }), 'shinL', 'shinR', C.plastic);
  pair(R(0.096, 0.07, 0.235, 0.032, { p: [-0.1, 0.058, -0.048] }), 'footL', 'footR', C.boot);
  if (L01) pair(E(0.048, 0.034, 0.05, { p: [-0.1, 0.048, -0.135] }, undefined, q.sw / 2 + 1, q.sh / 2), 'footL', 'footR', C.boot);
  pair(rbox(0.1, 0.022, 0.242, 0.008, L0 ? 1 : 0, { p: [-0.1, 0.011, -0.049] }), 'footL', 'footR', C.sole);

  /* ------------------------------------------------------------ Becken + Rumpf (elliptische Profile) */
  add(lathe([[0.05, 0.79], [0.115, 0.82], [0.15, 0.87], [0.162, 0.93], [0.158, 0.98], [0.146, 1.03]], q.tseg, { s: [1, 1, 0.7], p: [0, 0, 0.006] }), 'hips', C.pants);
  if (!FAR) pair(E(0.07, 0.085, 0.06, { p: [-0.065, 0.9, 0.05] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'hips', 'hips', C.pants);
  add(lathe([[0.143, 0.99], [0.14, 1.06], [0.146, 1.13], [0.156, 1.2], [0.16, 1.23]], q.tseg, { s: [1.04, 1, 0.72], p: [0, 0, 0.006] }), 'spine', C.top);
  add(lathe([[0.156, 1.18], [0.172, 1.26], [0.182, 1.33], [0.18, 1.39], [0.162, 1.44], [0.118, 1.475], [0.07, 1.495]], q.tseg, { s: [1.08, 1, 0.68], p: [0, 0, 0.006] }), 'chest', C.top);
  // Trapez + Schultern
  if (!FAR) pair(E(0.085, 0.048, 0.07, { p: [-0.115, 1.452, 0.014] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'chest', 'chest', C.top);
  // Kragen
  if (!FAR) add(cyl(0.064, 0.078, 0.06, q.cs, { p: [0, 1.495, 0.014], s: [1, 1, 0.92] }, true), 'chest', V.shemagh ? { color: '#b6a27f', detail: 1 } : C.top);
  // Gefechtsgürtel (Ring um das Becken)
  add(cyl(0.165, 0.165, 0.058, q.tseg, { p: [0, 0.995, 0.006], s: [1.03, 1, 0.74] }), 'hips', C.gear);
  if (!FAR) {
    add(R(0.06, 0.04, 0.012, 0.004, { p: [0, 0.995, -0.124] }), 'hips', C.metal);
    pair(R(0.058, 0.085, 0.07, 0.018, { p: [-0.168, 0.968, 0.04] }), 'hips', 'hips', C.gear2);
    add(R(0.1, 0.075, 0.055, 0.018, { p: [0.055, 0.97, 0.132] }), 'hips', C.gear2);
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
    // Kummerbund (Ring um den Bauch)
    add(cyl(0.178, 0.172, 0.13, q.tseg, { p: [0, 1.18, 0.006], s: [1.06, 1, 0.82] }), 'chest', C.gear);
    // Schulterträger
    pair(R(0.065, 0.028, 0.27, 0.012, { p: [-0.1, 1.462, 0.006], r: [0, 0, 0.18] }), 'chest', 'chest', C.gear);
    if (vest !== 'light') {
      for (const x of [-0.088, 0, 0.088]) {
        add(R(0.076, 0.115, 0.045, 0.014, { p: [x, 1.19, -0.19] }), 'chest', C.gear2);
        if (L0) add(R(0.058, 0.03, 0.026, 0.006, { p: [x, 1.257, -0.185] }), 'chest', C.mag);
      }
      if (!FAR) add(R(0.17, 0.075, 0.03, 0.01, { p: [0, 1.358, -0.183] }), 'chest', C.gear2);
      if (!FAR) add(R(0.058, 0.13, 0.055, 0.014, { p: [-0.205, 1.22, 0.04] }), 'chest', C.gear2);
      if (L01) add(cyl(0.006, 0.008, 0.22, 4, { p: [-0.21, 1.39, 0.055] }), 'chest', C.plastic);
    } else if (!FAR) {
      add(R(0.15, 0.08, 0.03, 0.01, { p: [0, 1.22, -0.168] }), 'chest', C.gear2);
    }
    // Teamabzeichen + Namensband
    const fz = vest === 'light' ? -0.158 : -0.172;
    add(rbox(0.07, 0.045, 0.006, 0, 0, { p: [0.078, 1.39, fz - 0.003] }), 'chest', C.accent);
    if (L0) add(rbox(0.11, 0.024, 0.005, 0, 0, { p: [-0.066, 1.39, fz - 0.002] }), 'chest', { color: shade(S.gear, 0.72), detail: 1 });
    if (L0) for (let i = 0; i < 3; i++) add(rbox(0.26, 0.012, 0.006, 0, 0, { p: [0, 1.2 + i * 0.06, 0.155 + t] }), 'chest', C.strap);
    if (heavy) {
      add(torus(0.098, 0.03, 4, q.cs + 2, { p: [0, 1.478, 0.008], r: [Math.PI / 2, 0, 0], s: [1.06, 0.92, 1] }), 'chest', C.gear);
      pair(R(0.035, 0.16, 0.13, 0.014, { p: [-0.205, 1.23, 0.0] }), 'chest', 'chest', C.gear2);
    }
  } else if (vest === 'rig') {
    add(R(0.31, 0.14, 0.07, 0.022, { p: [0, 1.18, -0.142] }), 'chest', C.gear);
    for (const x of [-0.105, -0.035, 0.035, 0.105]) {
      add(R(0.062, 0.1, 0.03, 0.01, { p: [x, 1.205, -0.19] }), 'chest', C.gear2);
      if (L0) add(R(0.05, 0.025, 0.022, 0.005, { p: [x, 1.265, -0.186] }), 'chest', C.mag);
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
      add(cyl(0.048, 0.048, 0.3, q.cs, { p: [0, 1.49, 0.26], r: [0, 0, Math.PI / 2] }), 'chest', { color: shade(S.gear, 0.85), detail: 1 });
    }
  } else if (V.back === 'radio') {
    add(R(0.21, 0.27, 0.11, 0.028, { p: [0, 1.27, 0.235] }), 'chest', C.plastic);
    if (!FAR) add(R(0.23, 0.29, 0.03, 0.01, { p: [0, 1.27, 0.175] }), 'chest', C.gear);
    add(cyl(0.006, 0.01, 0.55, 4, { p: [0.075, 1.61, 0.26], r: [-0.12, 0, -0.06] }), 'chest', C.plastic);
    if (L01) add(cyl(0.022, 0.022, 0.04, q.cs, { p: [-0.06, 1.42, 0.255] }), 'chest', C.metal);
  } else if (V.back === 'hydration') {
    add(R(0.2, 0.31, 0.065, 0.028, { p: [0, 1.28, 0.205] }), 'chest', C.gear2);
    if (L01) add(cyl(0.008, 0.008, 0.3, 4, { p: [-0.13, 1.34, -0.03], r: [0.4, 0, 0.3] }), 'chest', C.plastic);
  }

  /* ------------------------------------------------------------ Hals + Kopf */
  const neckMat = covered ? faceFab : V.shemagh ? { color: '#b6a27f', detail: 1 } : C.skin;
  add(cyl(0.052, 0.06, 0.13, q.cs, { p: [0, 1.53, 0.014], s: [1, 1, 1.05] }), 'neck', neckMat);
  if (V.shemagh) add(torus(0.072, 0.034, 5, q.cs, { p: [0, 1.5, 0.01], r: [Math.PI / 2, 0, 0] }), 'neck', { color: '#b6a27f', detail: 1 });

  const faceMat = covered ? faceFab : C.skin;
  // Schädel, Gesichtsmaske (Wangen/Kiefer), Kinn
  add(E(0.093, 0.106, 0.104, { p: [0, 1.697, 0.014] }), 'head', faceMat);
  add(E(0.08, 0.094, 0.072, { p: [0, 1.652, -0.034] }), 'head', faceMat);
  if (!FAR) add(E(0.056, 0.036, 0.048, { p: [0, 1.592, -0.052] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'head', faceMat);
  if (covered && !FAR) add(R(0.112, 0.036, 0.03, 0.013, { p: [0, 1.69, -0.088] }), 'head', C.skin);
  if (L01 && V.face !== 'gasmask') {
    if (!covered) {
      add(E(0.05, 0.012, 0.02, { p: [0, 1.71, -0.084] }, undefined, q.sw / 2 + 2, q.sh / 2), 'head', C.skin);
      add(E(0.012, 0.026, 0.018, { p: [0, 1.668, -0.103], r: [-0.3, 0, 0] }, undefined, 6, 5), 'head', C.skin);
    }
    if (L0) {
      pair(E(0.012, 0.0055, 0.005, { p: [-0.032, 1.693, -0.091] }, undefined, 6, 4), 'head', 'head', C.eyeWhite);
      pair(E(0.0048, 0.0048, 0.003, { p: [-0.032, 1.693, -0.0955] }, undefined, 5, 4), 'head', 'head', C.eye);
      if (!covered) {
        pair(rbox(0.032, 0.008, 0.012, 0, 0, { p: [-0.034, 1.712, -0.095], r: [0, 0, -0.1] }), 'head', 'head', C.hair);
        add(rbox(0.036, 0.007, 0.01, 0, 0, { p: [0, 1.616, -0.098] }), 'head', C.lip);
      }
    } else {
      add(rbox(0.078, 0.012, 0.01, 0, 0, { p: [0, 1.692, -0.094] }), 'head', C.eye);
    }
    if (!covered && V.head !== 'helmet' && !V.ears) pair(E(0.012, 0.028, 0.02, { p: [-0.094, 1.67, 0.01] }, undefined, 5, 4), 'head', 'head', C.skin);
  }
  if (V.beard && !covered) add(E(0.074, 0.06, 0.062, { p: [0, 1.6, -0.045] }, { thetaStart: Math.PI * 0.35, thetaLength: Math.PI * 0.65 }), 'head', C.hair);

  // Haare
  if (V.head === 'bare' || V.head === 'cap' || V.head === 'boonie') {
    add(E(0.098, 0.1, 0.11, { p: [0, 1.705, 0.016] }, { thetaLength: Math.PI * 0.5 }), 'head', C.hair);
    if (!FAR) add(E(0.094, 0.07, 0.09, { p: [0, 1.67, 0.04] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'head', C.hair);
  }

  // Kopfbedeckungen
  const helmet = V.head === 'helmet';
  if (helmet) {
    add(E(0.122, 0.12, 0.134, { p: [0, 1.692, 0.008] }, { thetaLength: Math.PI * 0.55 }), 'head', C.helmet);
    if (!FAR) {
      add(torus(0.121, 0.008, 3, q.cs + 4, { p: [0, 1.674, 0.008], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'head', { ...C.helmet, color: shade(S.helmet, 0.78) });
      pair(R(0.014, 0.03, 0.13, 0.004, { p: [-0.122, 1.712, 0.008] }), 'head', 'head', C.plastic);
      add(R(0.05, 0.034, 0.026, 0.008, { p: [0, 1.757, -0.126], r: [-0.45, 0, 0] }), 'head', C.metal);
      add(R(0.08, 0.06, 0.04, 0.016, { p: [0, 1.73, 0.138], r: [0.3, 0, 0] }), 'head', C.gear2);
    }
    if (V.nvg && !FAR) {
      // hochgeklapptes Nachtsichtgerät: Halterung + Doppelokular quer vor der Helmstirn
      add(R(0.03, 0.035, 0.025, 0.008, { p: [0, 1.768, -0.14], r: [-0.6, 0, 0] }), 'head', C.plastic);
      add(R(0.085, 0.032, 0.046, 0.012, { p: [0, 1.795, -0.152], r: [-0.95, 0, 0] }), 'head', C.plastic);
      if (L01) pair(cyl(0.013, 0.013, 0.006, q.cs, { p: [-0.024, 1.812, -0.168], r: [-0.95 + Math.PI / 2, 0, 0] }), 'head', 'head', C.lens);
    }
    add(R(0.026, 0.02, 0.03, 0.006, { p: [0, 1.805, 0.065], r: [0.55, 0, 0] }), 'head', C.accent);
  } else if (V.head === 'cap') {
    const back = V.capBack ? -1 : 1;
    add(E(0.104, 0.08, 0.115, { p: [0, 1.718, 0.012] }, { thetaLength: Math.PI * 0.5 }), 'head', { color: shade(S.gear, 1.08), detail: 1 });
    add(R(0.145, 0.012, 0.1, 0.005, { p: [0, 1.726, -0.128 * back + 0.006], r: [-0.14 * back, 0, 0] }), 'head', { color: shade(S.gear, 0.92), detail: 1 });
    add(rbox(0.04, 0.03, 0.006, 0, 0, { p: [0, 1.76, back > 0 ? -0.102 : 0.116], r: [back > 0 ? -0.45 : 0.45, 0, 0] }), 'head', C.accent);
  } else if (V.head === 'boonie') {
    add(cyl(0.098, 0.11, 0.08, q.cs, { p: [0, 1.772, 0.012], s: [1, 1, 1.08] }), 'head', C.top);
    add(E(0.098, 0.022, 0.106, { p: [0, 1.812, 0.012] }, { thetaLength: Math.PI * 0.5 }), 'head', C.top);
    add(cyl(0.185, 0.195, 0.014, q.cs + 3, { p: [0, 1.735, 0.012], r: [0.04, 0, 0], s: [1, 1, 1.05] }), 'head', C.top);
    add(cyl(0.112, 0.112, 0.022, q.cs, { p: [0, 1.752, 0.012], s: [1, 1, 1.08] }), 'head', C.strap);
    add(rbox(0.035, 0.022, 0.006, 0, 0, { p: [0.0, 1.752, -0.11] }), 'head', C.accent);
  } else if (V.head === 'beanie') {
    add(E(0.103, 0.104, 0.114, { p: [0, 1.703, 0.012] }, { thetaLength: Math.PI * 0.55 }), 'head', knit);
    add(cyl(0.106, 0.108, 0.04, q.cs + 2, { p: [0, 1.718, 0.012], s: [1, 1, 1.07] }), 'head', { ...knit, color: '#323334' });
    add(rbox(0.03, 0.02, 0.006, 0, 0, { p: [0.045, 1.72, -0.106] }), 'head', C.accent);
  }
  // Headset
  if (V.ears) {
    pair(cyl(0.033, 0.033, 0.03, q.cs, { p: [-0.1, 1.668, 0.01], r: [0, 0, Math.PI / 2] }), 'head', 'head', C.plastic);
    if (!helmet && !FAR) add(torus(0.106, 0.009, 3, q.cs, { p: [0, 1.67, 0.012], s: [1, 1.12, 1] }, Math.PI), 'head', C.plastic);
    if (L0) add(cyl(0.004, 0.004, 0.08, 3, { p: [0.088, 1.625, -0.058], r: [0.2, 0.8, 1.2] }), 'head', C.plastic);
  }
  // Brillen / Maske
  if (V.goggles) {
    add(R(0.13, 0.046, 0.034, 0.016, { p: [0, 1.697, -0.093] }), 'head', C.lens);
    if (!FAR) add(torus(0.112, 0.008, 3, q.cs, { p: [0, 1.697, 0.012], r: [Math.PI / 2, 0, 0], s: [1, 1.13, 1] }), 'head', C.strap);
  } else if (V.face === 'shades') {
    add(rbox(0.112, 0.027, 0.014, 0.005, L0 ? 1 : 0, { p: [0, 1.692, -0.099] }), 'head', C.lens);
    if (L01) pair(rbox(0.006, 0.008, 0.1, 0, 0, { p: [-0.092, 1.695, -0.05] }), 'head', 'head', C.plastic);
  }
  if (V.face === 'gasmask') {
    add(E(0.07, 0.074, 0.06, { p: [0, 1.64, -0.065] }), 'head', { color: '#1f2123', detail: 0.4, shine: 0.32 });
    pair(cyl(0.024, 0.024, 0.012, q.cs, { p: [-0.035, 1.69, -0.102], r: [Math.PI / 2 - 0.15, 0, 0] }), 'head', 'head', C.lens);
    add(cyl(0.034, 0.034, 0.05, q.cs, { p: [0.035, 1.59, -0.115], r: [1.1, 0.4, 0] }), 'head', { color: shade(S.gear2, 0.9), detail: 0.6 });
    add(E(0.1, 0.11, 0.106, { p: [0, 1.692, 0.018] }, { thetaLength: Math.PI * 0.62 }), 'head', C.top);
  }

  /* ------------------------------------------------------------ Arme */
  pair(E(0.068, 0.072, 0.07, { p: [-0.198, 1.418, 0.0] }, undefined, q.sw / 2 + 2, q.sh / 2 + 1), 'upperArmL', 'upperArmR', C.top);
  pair(lathe([[0.046, 1.13], [0.05, 1.18], [0.057, 1.26], [0.06, 1.33], [0.062, 1.4]], q.seg, { p: [-0.19, 0, 0.0], s: [0.96, 1, 1.04] }), 'upperArmL', 'upperArmR', C.top);
  pair(rbox(0.006, 0.05, 0.055, 0, 0, { p: [-0.252, 1.355, 0.0] }), 'upperArmL', 'upperArmR', C.accent);
  if (V.pauldrons) pair(E(0.08, 0.06, 0.086, { p: [-0.21, 1.41, 0.0] }, { thetaLength: Math.PI * 0.5 }), 'upperArmL', 'upperArmR', C.gear);
  const rolled = V.sleeves === 'rolled';
  if (L01) pair(E(0.047, 0.045, 0.048, { p: [-0.19, 1.155, 0.004] }, undefined, q.sw / 2 + 1, q.sh / 2), 'foreArmL', 'foreArmR', rolled ? C.skin : C.top);
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

export { shade, xf, limb };
