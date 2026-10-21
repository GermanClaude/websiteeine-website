// NULLPUNKT — Soldaten-Ausrüstung: 8 Ausrüstungsvarianten (Kopfbedeckung, Gesichtsschutz, Brille, Weste,
// Rucksack, Ärmel, Knieschoner, Holster …) × 3 Detailstufen → eine geteilte, gecachte Geometrie.
// Farben kommen über Palettenplätze aus dem Material (Farbschema) → dieselbe Geometrie für alle Schemata.
// Koordinaten: Modellraum der Bindepose (Füße im Ursprung, Blick −Z, rechts +X, Arme hängen).
// Körper (21.10.): ein durchgehendes, weich gehäutetes Netz aus tools/assets/soldier/build-body.mjs (body-mesh.js) –
// Muskeln, Uniform mit Falten/Taschen, Stiefel, Handschuhe, Kopf; Bereiche → Materialien je Ausführung.
// Ausrüstung aus abgerundeten Quadern; auf Stufe 2 nur noch die Silhouette tragenden Teile.
// Gesichter sind verdeckt (Realismus-Plan C1: Sturmhaube, Halstuch, Shemagh, Gasmaske + Schutzbrillen) – wie Bodycam,
// das Gesichter verpixelt; so entsteht kein „Uncanny Valley“ aus der Nähe.
import * as THREE from 'three';
import { SkinBuilder, limb, rbox, ellipsoid, cyl, torus, xf } from './builder.js';
import { SKIN_TONES } from './materials.js';
import { BONE, DIM } from './rig.js';
import { BODY_MESH } from './body-mesh.js';

export const VARIANTS = [
  // Nutzer 16.10.: Grundausführungen wie die Soldaten im Video – Helm mit Tarnbezug (ohne Nachtsicht), dunkle
  // Sturmhaube/Halstuch, Plattenträger, großer Rucksack; Abwechslung nur noch über Weste, Rucksack und Kleinteile
  { id: 'sturm', name: 'Sturm', shirt: 'combat', head: 'helmet', cover: true, ears: true, face: 'balaclava', eyes: null, vest: 'plate', back: 'assault', knees: true, holster: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'spaeher', name: 'Späher', head: 'boonie', veil: true, face: 'gaiter', eyes: null, vest: 'rig', back: 'assault', knees: false, holster: false, sleeves: 'long', skin: 2, hair: '#3b2a1c' },
  { id: 'funker', name: 'Funker', shirt: 'combat', head: 'helmet', cover: true, ears: true, face: 'balaclava', eyes: null, vest: 'plate', back: 'radio', knees: false, holster: true, sleeves: 'long', skin: 0, hair: '#5a4026' },
  { id: 'grenadier', name: 'Grenadier', shirt: 'combat', head: 'helmet', cover: true, face: 'balaclava', eyes: null, vest: 'plate', back: 'assault', knees: true, dump: true, sleeves: 'long', skin: 3, hair: '#18120d' },
  { id: 'schatten', name: 'Schatten', head: 'helmet', cover: true, face: 'balaclava', eyes: null, vest: 'light', back: 'assault', knees: false, holster: true, sleeves: 'long', skin: 4, hair: '#141110' },
  { id: 'bastion', name: 'Bastion', shirt: 'combat', head: 'helmet', cover: true, face: 'balaclava', eyes: null, vest: 'heavy', back: 'none', knees: true, pauldrons: true, dump: true, sleeves: 'long', skin: 1, hair: '#2a2119' },
  { id: 'kundschafter', name: 'Kundschafter', head: 'cap', capBack: true, ears: true, face: 'gaiter', eyes: null, vest: 'rig', back: 'assault', knees: true, sleeves: 'long', skin: 5, hair: '#4a3420' },
  { id: 'pionier', name: 'Pionier', shirt: 'combat', head: 'helmet', cover: true, ears: true, face: 'balaclava', eyes: null, vest: 'plate', back: 'assault', knees: true, holster: true, dump: true, sleeves: 'rolled', skin: 2, hair: '#2e2016' },
  // Klassen-Ausführungen (bots-scale): Sanitäter (leichte Weste, Armbinde mit rotem Kreuz, Sanitätstasche), Panzerpionier
  // (schwere Weste mit Schulterschutz, Werfer RW-90 auf dem Rücken), Scharfschütze (Tarnüberwurf/„Ghillie“ über Kopf und Schultern)
  { id: 'sanitaeter', name: 'Sanitäter', shirt: 'combat', head: 'helmet', cover: true, ears: true, face: 'gaiter', eyes: 'glasses', vest: 'light', back: 'medbag', armband: 'medic', knees: false, holster: true, sleeves: 'long', skin: 3, hair: '#2a2119' },
  { id: 'panzerpionier', name: 'Panzerpionier', shirt: 'combat', head: 'helmet', face: 'balaclava', eyes: 'goggles', vest: 'heavy', back: 'launcher', knees: true, pauldrons: true, dump: true, sleeves: 'long', skin: 0, hair: '#18120d' },
  { id: 'scharfschuetze', name: 'Scharfschütze', head: 'boonie', face: 'shemagh', eyes: null, shemagh: true, vest: 'rig', back: 'hydration', ghillie: true, knees: false, holster: false, sleeves: 'rolled', skin: 5, hair: '#3b2a1c' },
];
export const VARIANT_IDS = VARIANTS.map((v) => v.id);

// Auflösung der Ausrüstungsteile je Detailstufe (Körper selbst: body-mesh.js mit eigenen Stufen 7000/2600/700 Dreiecke):
// Profilsegmente, Ringe, Kappenringe, Rundquader, Kugel-Segmente, Zylinder
const Q = [
  { seg: 16, tseg: 14, rings: 3, cap: 3, rb: 2, sw: 16, sh: 10, cs: 12, smooth: 2 },
  { seg: 10, tseg: 10, rings: 2, cap: 2, rb: 1, sw: 11, sh: 7, cs: 8, smooth: 1 },
  { seg: 4, tseg: 6, rings: 1, cap: 1, rb: 0, sw: 6, sh: 3, cs: 4, smooth: 0 },
];

const cache = new Map();

// Körpernetz je Detailstufe dekodieren (einmalig, geteilt von allen Ausführungen)
const bodyCache = [];
function b64(str, T) {
  const bin = atob(str), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new T(u.buffer);
}
function bodyMesh(lod) {
  if (bodyCache[lod]) return bodyCache[lod];
  const E = BODY_MESH.lods[lod];
  const P = b64(E.pos, Uint16Array), N = b64(E.nrm, Int8Array), U = b64(E.uv, Int16Array);
  const pos = new Float32Array(E.n * 3), nrm = new Float32Array(E.n * 3), uv = new Float32Array(E.n * 2);
  for (let v = 0; v < E.n; v++) {
    for (let k = 0; k < 3; k++) { pos[v * 3 + k] = E.lo[k] + P[v * 3 + k] * E.sc[k]; nrm[v * 3 + k] = N[v * 3 + k] / 127; }
    uv[v * 2] = U[v * 2] / 16000; uv[v * 2 + 1] = U[v * 2 + 1] / 16000;
  }
  const D0 = { n: E.n, pos, nrm, uv, idx: b64(E.idx, Uint16Array), ski: b64(E.ski, Uint8Array), skw: b64(E.skw, Uint8Array), reg: b64(E.reg, Uint8Array), ao: b64(E.ao, Uint8Array) };
  bodyCache[lod] = D0;
  return D0;
}

// Helm nach hinten gekippt (≈ 17°): Vorderkante über den Augenbrauen, Nackenschutz hinten tiefer – wie ein echter Helm
const HELMET_TILT = new THREE.Matrix4().makeTranslation(0, 1.712, 0.006)
  .multiply(new THREE.Matrix4().makeRotationX(0.3))
  .multiply(new THREE.Matrix4().makeTranslation(0, -1.712, -0.006));
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

/**
 * Statur (Nutzer 16.10.: „viel zu dünn – schau dir die Breite an“): die Video-Soldaten sind wuchtig – breiter Rumpf mit
 * dicker Uniform, Weste und Rucksack, kräftige Arme und Beine. Die Maße unten sind für die schlanke Grundfigur
 * (Schulter bei x = ±0,19) geschrieben; je Knochen wird quer um die Gliedachse skaliert und die Arme auf die neue
 * Schulterbreite (DIM.shoulderX) geschoben. Kopf/Helm bleiben gleich groß.
 */
function bulkTable() {
  // 21.10.: Der Körper (body-mesh.js) hat seine Endmaße; skaliert werden nur noch die auf die alte Grundfigur
  // geschriebenen Ausrüstungsteile am Rumpf (Weste, Gürtel, Taschen, Rucksack sitzen so auf dem kräftigeren Rumpf).
  const T = {};
  const set = (name, o) => { T[BONE[name]] = { cx: 0, cz: 0, sx: 1, sz: 1, tx: 0, ...o }; };
  for (const n of ['hips', 'spine', 'chest']) set(n, { cz: 0.006, sx: 1.17, sz: 1.22 });
  set('neck', { cz: 0.012, sx: 1.22, sz: 1.22 });
  return T;
}
const BULK = bulkTable();

// Gurtverläufe über die Schulter als (y, z)-Punkte vor der BULK-Skalierung, aus dem Körperumriss (body-mesh.js) bei
// x ≈ 0,117 bzw. 0,146 abgegriffen und ~1 cm nach außen versetzt: Westenträger von der Front- zur Rückenplatte,
// Rucksackträger vom Rucksack über die Schulter nach vorn (Ende je Westenart).
const VEST_STRAP = [[1.432, -0.118], [1.452, -0.069], [1.49, -0.058], [1.525, -0.047], [1.55, -0.025], [1.558, 0.005], [1.548, 0.038], [1.525, 0.077], [1.49, 0.098], [1.455, 0.116], [1.44, 0.136]];
const PACK_STRAP = [[1.44, 0.165], [1.47, 0.112], [1.505, 0.093], [1.535, 0.071], [1.556, 0.038], [1.562, 0.001], [1.553, -0.032], [1.528, -0.055], [1.49, -0.067], [1.455, -0.079]];

function buildSoldier(V, lod) {
  const q = Q[lod];
  const B = new SkinBuilder({ ao: globalThis.__npNoAO ? null : AO[lod], bulk: BULK });
  const L0 = lod === 0, L01 = lod <= 1, FAR = lod === 2;
  const skin = SKIN_TONES[V.skin % SKIN_TONES.length];

  // Materialien: color = feste Farbe (sRGB-Hex), pal = Schemafarbe (+ shade = sRGB-Faktor); cls = Materialklasse
  const C = {
    top: { color: '#dadada', camo: 1, detail: 1, cls: 'cloth' },
    // Kampfhemd (unter der Weste): einfarbiger Rumpf aus Funktionsstoff, Ärmel im Tarnmuster
    shirt: { pal: 'gear', shade: 0.9, detail: 1, cls: 'cloth' },
    pants: { color: '#c6c6c6', camo: 1, detail: 1, cls: 'cloth', wear: 0.3 },
    cover: { color: '#d2d2d2', camo: 1, detail: 1, cls: 'cloth' }, // Helmbezug im Tarnmuster
    // Weste, Taschen, Rucksack im Uniform-Tarn wie im Video (etwas dunkler als der Stoff, damit sich die Teile absetzen)
    gear: { color: '#c4c4c4', camo: 1, detail: 1, shine: 0.04, cls: 'gear' },
    gear2: { color: '#b2b2b2', camo: 1, detail: 1, shine: 0.04, cls: 'gear' },
    flap: { color: '#a8a8a8', camo: 1, detail: 1, shine: 0.04, cls: 'gear' },
    web: { color: '#8a8a8a', camo: 1, detail: 1, shine: 0.03, cls: 'gear' }, // MOLLE-Gurtband (Tarnstoff, dunkler)
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
    accent: { pal: 'accent', shade: 0.6, detail: 0, emis: 0, shine: 0.3, cls: 'hard' },
    // Teamfarben-Band am Oberarm: gedeckt, ohne Leuchten (16.10.: im Video gibt es keine leuchtenden Bänder;
    // Teams erkennt man über Namensschild, Randlicht der Gegner und dieses Band)
    band: { pal: 'accent', shade: 0.46, detail: 0.6, emis: 0, shine: 0.1, cls: 'gear' },
    // Schutzbrille/Maskengläser: hellgrau spiegelnd mit kleinem Glanzlicht → Blickrichtung lesbar
    visor: { color: '#8ea4b0', detail: 0, shine: 1, emis: 0.1, cls: 'glass' },
    mag: { color: '#2a2b2c', detail: 0.4, shine: 0.55, cls: 'hard' },
    knee: { pal: 'gear2', shade: 0.85, detail: 0.7, shine: 0.2, cls: 'hard', wear: 0.8 },
    eye: { color: '#17120e', detail: 0, shine: 0.9, cls: 'glass' },
    eyeWhite: { color: '#a89d90', detail: 0, shine: 0.6, cls: 'glass' },
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
    jute3: { color: '#4a4f33', camo: 0.35, detail: 1, shine: 0, cls: 'cloth' }, // grünlicher Bast
    jute4: { color: '#7a6f4a', detail: 1, shine: 0, cls: 'cloth' }, // trockenes Gras
  };
  const covered = V.face === 'balaclava';
  const lowerCovered = covered || V.face === 'gaiter' || V.face === 'shemagh' || V.face === 'gasmask';
  // Sturmhaube: dunkler Stoff in Ausrüstungsfarbe; Halstuch im Tarnmuster der Uniform; Shemagh oliv-braun
  const faceFab = V.face === 'shemagh' ? C.sand : V.face === 'gaiter' ? { color: '#bdbdbd', camo: 1, detail: 1, cls: 'cloth' } : { pal: 'gear2', shade: 0.72, detail: 1, cls: 'cloth' };
  const add = (geo, bone, mat) => B.add(geo, { bone, ...mat });
  const pair = (geo, boneL, boneR, mat) => B.add(geo, { bone: boneL, mirrorBone: boneR, ...mat });
  const R = (w, h, d, r, opts) => rbox(w, h, d, r, q.rb, opts);
  const E = (rx, ry, rz, opts, cut, ws = q.sw, hs = q.sh) => ellipsoid(rx, ry, rz, FAR ? Math.min(ws, 6) : ws, FAR ? Math.min(hs, 3) : hs, opts, cut);
  // Tasche mit Deckel (Deckel oben, rundum etwas größer → liest sich als überstehende Klappe)
  const pouch = (w, h, d, x, y, z, bone = 'chest', mat = C.gear2) => {
    add(R(w, h, d, Math.min(0.014, d * 0.3), { p: [x, y, z] }), bone, mat);
    if (L0) {
      add(rbox(w + 0.006, h * 0.3, d + 0.006, 0.004, 1, { p: [x, y + h * 0.36, z] }), bone, C.flap);
      // Klettlasche unter dem Deckel + senkrechte Gurtschlaufe (MOLLE-Befestigung) vorn
      add(rbox(Math.min(0.026, w * 0.4), 0.018, 0.004, 0, 0, { p: [x, y + h * 0.17, z - d / 2 - 0.004] }), bone, C.strap);
      add(rbox(0.012, h * 0.5, 0.004, 0, 0, { p: [x, y - h * 0.12, z - d / 2 - 0.002] }), bone, C.web);
    }
  };
  // MOLLE-Feld: Reihen aus kurzen Gurtschlaufen mit Lücken (liest sich als Gurtband statt als Streifen)
  const molle = (x0, x1, y0, rows, z, bone = 'chest', dz = -1) => {
    const n = Math.max(1, Math.round((x1 - x0) / 0.038));
    const step = (x1 - x0) / n;
    for (let i = 0; i < rows; i++) for (let k = 0; k < n; k++) {
      add(rbox(step - 0.007, 0.0095, 0.005, 0, 0, { p: [x0 + (k + 0.5) * step, y0 + i * 0.026, z + dz * 0.0025] }), bone, C.web);
    }
  };
  const PLAST = { ...C.plastic, shine: 0.3 };
  // Gurt entlang eines (y, z)-Pfads, gespiegelt links/rechts bei ±x (step > 1 dünnt den Pfad für ferne LODs aus)
  const strapPath = (pts, x, w, th, mat, step = 1) => {
    const P = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    for (let i = 0; i + 1 < P.length; i++) {
      const [y0, z0] = P[i], [y1, z1] = P[i + 1];
      const len = Math.hypot(y1 - y0, z1 - z0);
      pair(rbox(w, len + th * 0.8, th, 0, 0, { p: [-x, (y0 + y1) / 2, (z0 + z1) / 2], r: [Math.atan2(z1 - z0, y1 - y0), 0, 0] }), 'chest', 'chest', mat);
    }
  };

  /* ------------------------------------------------------------ Körper (ein Guss, body-mesh.js) */
  // 21.10. (Nutzer: „wie B1-Kampfdroiden“): durchgehender Körper mit Muskeln, Uniformfalten, Taschen, Stiefeln und
  // Handschuhen, weich gehäutet (Schultern/Ellbogen/Knie verformen sich statt starrer Röhren). Bereiche → Materialien
  // je Ausführung (Kampfhemd mit einfarbigem Rumpf unter der Weste, hochgekrempelte Ärmel, Sturmhaube …).
  const RG = BODY_MESH.regions;
  const rolled = V.sleeves === 'rolled';
  const bodyMat = (r) => {
    switch (r) {
      case RG.SHIRT: return V.shirt === 'combat' ? C.shirt : C.top;
      case RG.COLLAR: return V.shirt === 'combat' ? C.shirt : C.top;
      case RG.SLEEVE: return C.top;
      case RG.FOREARM: return rolled ? C.skin : C.top;
      case RG.GLOVE: return C.glove;
      case RG.PANTS: return C.pants;
      case RG.POCKET: return { ...C.pants, color: '#cfcfcf', wear: 0.45 };
      case RG.PAD: return { color: '#a9a9a9', camo: 1, detail: 1, cls: 'gear', wear: 0.6 }; // Polstertaschen (Cordura, dunkler)
      case RG.BOOT: return C.boot;
      case RG.SOLE: return C.sole;
      case RG.NECK: return covered || V.face === 'gaiter' ? faceFab : V.shemagh ? C.sand : C.skin;
      case RG.SKULL: return covered ? faceFab : V.shemagh ? C.sand : V.head === 'wrap' ? { pal: 'gear2', shade: 1.05, detail: 1, cls: 'cloth' } : C.hair;
      case RG.EARS: return covered ? faceFab : C.skin;
      case RG.EYES: return covered ? C.socket : C.skin;
      case RG.FACE: return lowerCovered && V.face !== 'gasmask' ? faceFab : C.skin;
      default: return C.top;
    }
  };
  B.addMesh(bodyMesh(lod), bodyMat);
  if (V.holster && !FAR) {
    add(R(0.06, 0.17, 0.1, 0.022, { p: [0.238, 0.72, 0.022], r: [0.08, 0, -0.03] }), 'thighR', C.gear2);
    add(R(0.03, 0.075, 0.04, 0.008, { p: [0.24, 0.825, 0.055], r: [0.25, 0, -0.03] }), 'thighR', C.plastic);
    if (L01) add(torus(0.11, 0.008, 3, q.cs + 2, { p: [0.1, 0.62, 0.006], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] }), 'thighR', C.strap);
  }
  if (V.knees) {
    pair(R(0.13, 0.13, 0.048, 0.022, { p: [-0.1, 0.5, -0.082], r: [-0.1, 0, 0] }), 'shinL', 'shinR', C.knee);
    if (L0) pair(torus(0.077, 0.007, 3, q.cs, { p: [-0.1, 0.45, 0.004], r: [Math.PI / 2, 0, 0], s: [1, 1.1, 1] }), 'shinL', 'shinR', C.strap);
  }
  // Schnürung vorn am Stiefelschaft
  if (L0) for (let i = 0; i < 4; i++) pair(rbox(0.042, 0.006, 0.01, 0, 0, { p: [-0.1, 0.095 + i * 0.028, -0.066] }), 'shinL', 'shinR', C.plastic);

  // Gefechtsgürtel (Ring um das Becken) mit Schnalle, Taschen, Erste-Hilfe-Tasche hinten
  add(cyl(0.165, 0.165, 0.058, q.tseg, { p: [0, 0.995, 0.006], s: [1.03, 1, 0.74] }), 'hips', C.gear);
  if (!FAR) {
    add(R(0.06, 0.04, 0.012, 0.004, { p: [0, 0.995, -0.124] }), 'hips', C.metal);
    pair(R(0.058, 0.085, 0.07, 0.018, { p: [-0.168, 0.968, 0.04] }), 'hips', 'hips', C.gear2);
    add(R(0.1, 0.075, 0.055, 0.018, { p: [0.055, 0.97, 0.132] }), 'hips', C.gear2);
    if (L0) add(rbox(0.026, 0.026, 0.008, 0, 0, { p: [0.055, 0.975, 0.162] }), 'hips', C.accent); // Sanitätskreuz-Patch
    // Innen-/Außengürtel: dunkle Kanten oben und unten, Kobra-Schnalle (Metallbügel + Mittelsteg)
    if (L01) for (const y of [1.021, 0.969]) add(cyl(0.167, 0.167, 0.008, q.tseg, { p: [0, y, 0.006], s: [1.03, 1, 0.74] }, true), 'hips', C.strap);
    if (L0) {
      pair(rbox(0.012, 0.046, 0.016, 0, 0, { p: [-0.033, 0.995, -0.126] }), 'hips', 'hips', C.metal);
      add(rbox(0.016, 0.03, 0.006, 0, 0, { p: [0, 0.995, -0.132] }), 'hips', PLAST);
      // auf der Gürtelellipse sitzen (Halbachsen 0,17 / 0,122 um z = 0,006), Außenseite tangential ausgerichtet
      const onBelt = (th, d) => {
        const a = 0.17, b = 0.122, nx = b * Math.sin(th), nz = -a * Math.cos(th), nl = Math.hypot(nx, nz);
        return { p: [a * Math.sin(th) + (nx / nl) * (d / 2 + 0.002), 0, 0.006 - b * Math.cos(th) + (nz / nl) * (d / 2 + 0.002)], ry: -Math.atan2(b * Math.sin(th), a * Math.cos(th)) };
      };
      // zwei Pistolenmagazin-Taschen vorn links, Aderpresse (Tourniquet) quer vorn rechts
      for (const th of [-0.5, -0.7]) {
        const o = onBelt(th, 0.026);
        add(R(0.03, 0.07, 0.026, 0.006, { p: [o.p[0], 0.985, o.p[2]], r: [0, o.ry, 0] }), 'hips', C.gear2);
        add(rbox(0.033, 0.016, 0.029, 0, 0, { p: [o.p[0], 1.018, o.p[2]], r: [0, o.ry, 0] }), 'hips', C.flap);
      }
      const tq = onBelt(0.5, 0.032);
      add(cyl(0.016, 0.016, 0.075, 6, { p: [tq.p[0], 0.995, tq.p[2]], r: [0, tq.ry, Math.PI / 2] }), 'hips', PLAST);
      const tg = onBelt(0.78, 0.01);
      add(rbox(0.012, 0.024, 0.008, 0, 0, { p: [tg.p[0], 0.99, tg.p[2]], r: [0, tg.ry, 0] }), 'hips', C.medRed);
    }
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
    // Schulterträger (gepolstert) über die Schulter von Platte zu Platte
    strapPath(VEST_STRAP, 0.1, 0.062, 0.016, C.gear, FAR ? 5 : L0 ? 1 : 2);
    const fzP = -0.118 - t, bzP = 0.128 + t; // Vorder-/Rückfläche der Platten
    // MOLLE-Reihen auf der Front (einzelne Schlaufen); auf LOD1 als durchgehende Bänder
    if (L0) molle(-0.13, 0.13, 1.284, 4, fzP);
    else if (L01) for (let i = 0; i < 2; i++) add(rbox(0.26, 0.012, 0.005, 0, 0, { p: [0, 1.29 + i * 0.05, fzP - 0.0025] }), 'chest', C.web);
    if (L0) {
      // Kantenband rund um beide Platten (dunkle Einfassung → Plattenträger liest sich als genähtes Teil)
      for (const [z, w, h, yc] of [[fzP - 0.001, 0.29, 0.3, 1.285], [bzP + 0.001, 0.3, 0.32, 1.29]]) {
        add(rbox(w - 0.02, 0.012, 0.006, 0, 0, { p: [0, yc + h / 2 - 0.008, z] }), 'chest', C.strap);
        add(rbox(w - 0.02, 0.012, 0.006, 0, 0, { p: [0, yc - h / 2 + 0.008, z] }), 'chest', C.strap);
        pair(rbox(0.012, h - 0.03, 0.006, 0, 0, { p: [-(w / 2 - 0.008), yc, z] }), 'chest', 'chest', C.strap);
      }
      // Steckschnallen, an denen die Schulterträger in die Frontplatte greifen
      pair(rbox(0.036, 0.024, 0.012, 0, 0, { p: [-0.098, 1.43, fzP - 0.006] }), 'chest', 'chest', PLAST);
      pair(rbox(0.04, 0.034, 0.006, 0, 0, { p: [-0.098, 1.405, fzP - 0.003] }), 'chest', 'chest', C.strap);
      // Kummerbund: MOLLE an den Seiten + Klettzunge vorn
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
        add(rbox(0.006, 0.0095, 0.06, 0, 0, { p: [sx * 0.19, 1.14 + i * 0.026, 0.006] }), 'chest', C.web);
      }
    }
    // Granattaschen hinten am Kummerbund
    if (L01 && vest !== 'light') for (const sx of [-1, 1]) {
      add(cyl(0.026, 0.026, 0.072, q.cs, { p: [sx * 0.19, 1.165, 0.088] }), 'chest', C.gear2);
      if (L0) add(cyl(0.029, 0.029, 0.016, q.cs, { p: [sx * 0.19, 1.205, 0.088] }), 'chest', C.flap);
    }
    if (vest !== 'light') {
      for (const x of [-0.088, 0, 0.088]) {
        pouch(0.076, 0.115, 0.045, x, 1.19, -0.19);
        if (L0) {
          add(R(0.058, 0.03, 0.026, 0.006, { p: [x, 1.262, -0.183] }), 'chest', C.mag);
          // Gummizug über den Magazinen mit Zuglasche
          add(rbox(0.064, 0.007, 0.03, 0, 0, { p: [x, 1.262, -0.183] }), 'chest', C.strap);
          add(rbox(0.016, 0.022, 0.005, 0, 0, { p: [x, 1.272, -0.1985] }), 'chest', PLAST);
        }
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
    // Rückenplatte: MOLLE nur, wenn kein großer Rucksack sie verdeckt
    if (L0 && V.back !== 'assault' && V.back !== 'radio') molle(-0.13, 0.13, 1.17, 6, bzP, 'chest', 1);
    if (L0) add(torus(0.035, 0.008, 3, 8, { p: [0, 1.44, bzP + 0.007], r: [0, 0, 0] }, Math.PI), 'chest', C.strap);
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
    strapPath(VEST_STRAP, 0.1, 0.045, 0.01, C.strap, FAR ? 5 : L0 ? 1 : 2);
    pair(rbox(0.04, 0.33, 0.012, 0, 0, { p: [-0.055, 1.3, 0.13], r: [0, 0, -0.55] }), 'chest', 'chest', C.strap);
    pair(rbox(0.04, 0.22, 0.012, 0, 0, { p: [-0.105, 1.33, -0.122], r: [0.08, 0, 0.12] }), 'chest', 'chest', C.strap);
    add(rbox(0.06, 0.04, 0.006, 0, 0, { p: [0.09, 1.38, -0.128] }), 'chest', C.accent);
  }

  /* ------------------------------------------------------------ Rucksäcke */
  if (V.back === 'assault') {
    // Video: großer Rucksack im Tarnmuster vom Nacken bis unter die Taille, mit Seitentaschen und Deckel
    add(R(0.3, 0.44, 0.16, 0.07, { p: [0, 1.22, 0.252] }), 'chest', C.gear2);
    add(R(0.28, 0.1, 0.175, 0.05, { p: [0, 1.415, 0.256] }), 'chest', C.flap);
    if (!FAR) {
      pair(R(0.045, 0.2, 0.1, 0.02, { p: [-0.145, 1.16, 0.252] }), 'chest', 'chest', C.gear);
      add(R(0.2, 0.18, 0.045, 0.02, { p: [0, 1.14, 0.335] }), 'chest', C.gear);
      if (L0) {
        molle(-0.085, 0.085, 1.075, 4, 0.3575, 'chest', 1);
        // Tragegriff oben, Kompressionsriemen mit Schnallen an den Seitentaschen
        add(torus(0.03, 0.007, 3, 8, { p: [0, 1.468, 0.255], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.6] }, Math.PI), 'chest', C.strap);
        for (const y of [1.1, 1.22]) {
          pair(rbox(0.005, 0.016, 0.1, 0, 0, { p: [-0.17, y, 0.252] }), 'chest', 'chest', C.web);
          pair(rbox(0.007, 0.02, 0.018, 0, 0, { p: [-0.171, y, 0.226] }), 'chest', 'chest', PLAST);
        }
      }
    }
  } else if (V.back === 'radio') {
    // Funkgerät in einem Rucksack im Tarnmuster (Video: keine schwarzen Kästen auf dem Rücken), Antenne bleibt sichtbar
    add(R(0.28, 0.4, 0.16, 0.045, { p: [0, 1.22, 0.255] }), 'chest', C.gear2);
    if (!FAR) add(R(0.25, 0.11, 0.175, 0.035, { p: [0, 1.41, 0.26] }), 'chest', C.flap);
    add(cyl(0.006, 0.01, 0.55, 4, { p: [0.085, 1.66, 0.27], r: [-0.12, 0, -0.06] }), 'chest', C.plastic);
    if (L01) add(cyl(0.022, 0.022, 0.04, q.cs, { p: [-0.07, 1.47, 0.27] }), 'chest', C.metal);
    if (L0) {
      molle(-0.11, 0.11, 1.06, 6, 0.335, 'chest', 1);
    }
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
  // Rucksack-Tragegurte über die Schultern bis vorn auf Platte bzw. Brust, mit Brustgurt (Rucksack sitzt sichtbar am Körper)
  if (L01 && (V.back === 'assault' || V.back === 'radio' || V.back === 'medbag')) {
    const plateFront = -0.118 - (vest === 'light' ? 0.038 : 0.052) - 0.007;
    const front = vest === 'rig' ? [[1.42, -0.106], [1.36, -0.116], [1.26, -0.118]] : [[1.448, -0.106], [1.446, plateFront], [1.29, plateFront]];
    const start = V.back === 'medbag' ? [[1.35, 0.172]] : [];
    strapPath([...start, ...PACK_STRAP, ...front], 0.125, 0.042, 0.012, { ...C.gear2, color: '#9e9e9e' }, L0 ? 1 : 2);
    if (L0) {
      const zs = vest === 'rig' ? -0.124 : vest === 'light' ? plateFront - 0.004 : -0.204;
      add(rbox(0.25, 0.016, 0.006, 0, 0, { p: [0, 1.365, zs] }), 'chest', C.strap);
      add(rbox(0.034, 0.026, 0.01, 0, 0, { p: [0, 1.365, zs - 0.004] }), 'chest', PLAST);
      // Gurtversteller (Leiterschnallen) vorn
      pair(rbox(0.046, 0.016, 0.01, 0, 0, { p: [-0.125, 1.31, (vest === 'rig' ? -0.118 : plateFront) - 0.008] }), 'chest', 'chest', PLAST);
    }
  }

  /* ------------------------------------------------------------ Hals + Kopf (Kopf/Hals selbst: body-mesh.js) */
  if (V.shemagh) add(torus(0.082, 0.034, 5, q.cs, { p: [0, 1.5, 0.01], r: [Math.PI / 2, 0, 0] }), 'neck', C.sand);
  if (V.face === 'gaiter' && !FAR) add(torus(0.078, 0.016, 4, q.cs, { p: [0, 1.492, 0.012], r: [Math.PI / 2, 0, 0], s: [1, 1.08, 1] }), 'neck', faceFab);
  const wrapHead = V.head === 'wrap';
  if (L01 && V.face !== 'gasmask') {
    const F = BODY_MESH.face;
    const eyesHidden = V.eyes === 'shades' || V.eyes === 'glasses' || V.eyes === 'goggles';
    if (L0 && !eyesHidden) {
      pair(E(0.012, 0.0052, 0.005, { p: [-0.033, 1.692, F.eyeZ + 0.001] }, undefined, 6, 4), 'head', 'head', C.eyeWhite);
      pair(E(0.0055, 0.0052, 0.003, { p: [-0.033, 1.692, F.eyeZ - 0.0032] }, undefined, 5, 4), 'head', 'head', C.eye);
      if (!covered) pair(rbox(0.032, 0.005, 0.008, 0, 0, { p: [-0.035, 1.712, F.browZ + 0.006], r: [0, 0, -0.08] }), 'head', 'head', C.brow);
    } else if (!eyesHidden) {
      add(rbox(0.074, 0.011, 0.01, 0, 0, { p: [0, 1.692, F.eyeZ - 0.002] }), 'head', C.eye);
    }
  }

  // Kopfbedeckungen
  const helmet = V.head === 'helmet';
  if (helmet) {
    // 21.10. (Nutzer: „Helme viel zu groß, die Soldaten können nicht drüber schauen“): Maße eines echten Gefechtshelms
    // (außen ≈ 22 × 25 cm, 2–3 cm Luft zum Kopf), Vorderkante knapp über den Brauen, Nacken tiefer; Tarnbezug mit
    // Gummiband, Seitenschienen, Nachtsicht-Halterung, Akkutasche, Klettfelder, Kinnriemen
    const shellMat = V.cover ? C.cover : C.helmet;
    add(tiltHelmet(E(0.112, 0.108, 0.124, { p: [0, 1.712, 0.006] }, { thetaLength: Math.PI * 0.58 })), 'head', shellMat);
    if (!FAR) {
      add(tiltHelmet(torus(0.108, 0.007, 3, q.cs + 4, { p: [0, 1.679, 0.006], r: [Math.PI / 2, 0, 0], s: [1, 1.11, 1] })), 'head', V.cover ? { ...C.cover, color: '#b8b8b8' } : C.helmetDark);
      // Seitenschienen (ARC) – auch über dem Bezug sichtbar
      pair(tiltHelmet(R(0.01, 0.022, 0.1, 0.004, { p: [-0.111, 1.71, 0.006] })), 'head', 'head', C.plastic);
      // Gummiband um den Bezug
      if (L01 && V.cover) add(tiltHelmet(torus(0.1095, 0.005, 3, q.cs + 4, { p: [0, 1.738, 0.006], r: [Math.PI / 2, 0, 0], s: [1, 1.11, 1] })), 'head', C.strap);
      // Nachtsicht-Halterung (Platte vorn), Akkutasche hinten, Klettfelder
      add(tiltHelmet(R(0.036, 0.03, 0.012, 0.005, { p: [0, 1.76, -0.118], r: [-0.42, 0, 0] })), 'head', V.nvg ? C.metal : C.plastic);
      add(tiltHelmet(R(0.068, 0.046, 0.032, 0.012, { p: [0, 1.728, 0.124], r: [0.32, 0, 0] })), 'head', C.flap);
      if (L01) pair(tiltHelmet(rbox(0.009, 0.085, 0.006, 0, 0, { p: [-0.088, 1.63, -0.018], r: [0.15, 0, -0.06] })), 'head', 'head', C.strap); // Kinnriemen
      if (L0) {
        add(tiltHelmet(rbox(0.044, 0.026, 0.004, 0, 0, { p: [0, 1.792, 0.076], r: [0.95, 0, 0] })), 'head', C.patch); // Klettfeld hinten
        pair(tiltHelmet(rbox(0.004, 0.026, 0.05, 0, 0, { p: [-0.106, 1.742, 0.0], r: [0, 0, -0.35] })), 'head', 'head', C.patch); // Klett seitlich
        add(tiltHelmet(rbox(0.022, 0.014, 0.008, 0, 0, { p: [0, 1.805, 0.04], r: [0.4, 0, 0] })), 'head', C.plastic); // IR-Markierung
      }
    }
    if (V.nvg && !FAR) {
      // hochgeklapptes Nachtsichtgerät: Halterung + Doppelokular quer vor der Helmstirn
      add(tiltHelmet(R(0.028, 0.032, 0.024, 0.008, { p: [0, 1.775, -0.122], r: [-0.6, 0, 0] })), 'head', C.plastic);
      add(tiltHelmet(R(0.078, 0.03, 0.042, 0.011, { p: [0, 1.8, -0.132], r: [-0.95, 0, 0] })), 'head', C.plastic);
      if (L01) pair(tiltHelmet(cyl(0.012, 0.012, 0.006, q.cs, { p: [-0.022, 1.815, -0.148], r: [-0.95 + Math.PI / 2, 0, 0] })), 'head', 'head', C.lens);
    }
    // kein Teamband um den Helm (Video); nur ein kleines Abzeichen hinten oben
    add(tiltHelmet(R(0.022, 0.017, 0.026, 0.005, { p: [0, 1.806, 0.058], r: [0.55, 0, 0] })), 'head', C.accent);
  } else if (V.head === 'cap') {
    const back = V.capBack ? -1 : 1;
    const capMat = { pal: 'gear', shade: 1.08, detail: 1, cls: 'cloth' };
    add(E(0.087, 0.084, 0.106, { p: [0, 1.716, 0.008] }, { thetaLength: Math.PI * 0.5 }), 'head', capMat);
    add(R(0.13, 0.01, 0.085, 0.005, { p: [0, 1.722, -0.128 * back + 0.008], r: [-0.14 * back, 0, 0] }), 'head', { pal: 'gear', shade: 0.92, detail: 1, cls: 'cloth' });
    add(rbox(0.036, 0.026, 0.006, 0, 0, { p: [0, 1.756, back > 0 ? -0.096 : 0.108], r: [back > 0 ? -0.45 : 0.45, 0, 0] }), 'head', C.accent);
    add(torus(0.087, 0.007, 3, q.cs + 2, { p: [0, 1.722, 0.008], r: [Math.PI / 2, 0, 0], s: [1, 1.2, 1] }), 'head', C.band);
    if (L0) add(E(0.011, 0.006, 0.011, { p: [0, 1.8, 0.008] }, undefined, 6, 3), 'head', capMat); // Knopf
  } else if (V.head === 'boonie') {
    add(cyl(0.098, 0.11, 0.08, q.cs, { p: [0, 1.772, 0.012], s: [1, 1, 1.08] }), 'head', C.top);
    add(E(0.098, 0.022, 0.106, { p: [0, 1.812, 0.012] }, { thetaLength: Math.PI * 0.5 }), 'head', C.top);
    add(cyl(0.185, 0.195, 0.014, q.cs + 3, { p: [0, 1.735, 0.012], r: [0.04, 0, 0], s: [1, 1, 1.05] }), 'head', C.top);
    add(cyl(0.112, 0.112, 0.022, q.cs, { p: [0, 1.752, 0.012], s: [1, 1, 1.08] }), 'head', C.band); // Hutband in Teamfarbe
    add(rbox(0.035, 0.022, 0.006, 0, 0, { p: [0.0, 1.752, -0.11] }), 'head', C.accent);
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
    pair(cyl(0.032, 0.032, 0.03, q.cs, { p: [-0.098, 1.67, 0.008], r: [0, 0, Math.PI / 2] }), 'head', 'head', C.plastic);
    if (L0) pair(cyl(0.023, 0.023, 0.008, q.cs, { p: [-0.115, 1.67, 0.008], r: [0, 0, Math.PI / 2] }), 'head', 'head', { ...C.plastic, color: '#2a2d30' });
    if (!helmet && !FAR) add(torus(0.095, 0.008, 3, q.cs, { p: [0, 1.67, 0.01], s: [1, 1.18, 1] }, Math.PI), 'head', C.plastic);
    if (L0) add(cyl(0.004, 0.004, 0.08, 3, { p: [0.086, 1.625, -0.056], r: [0.2, 0.8, 1.2] }), 'head', C.plastic);
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

  /* ------------------------------------------------------------ Ghillie-Anzug / Tarnschleier */
  // 21.10. (Nutzer: „Scharfschützen … diese Ghillie-Suits“): Jute- und Bastbüschel über Kopf, Schultern, Rücken,
  // Arme und Beine; Brust und Gesicht bleiben frei (Waffe/Zielen). Tarnschleier (Späher): nur Kopf und Schultern.
  if (V.ghillie || V.veil) {
    let seed = 7 + VARIANTS.indexOf(V) * 101;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const full = !!V.ghillie;
    // Fransen in Lagen (wie ein echter Ghillie: dicht geschuppte Jutestreifen); ferne Stufen: weniger, breitere Fransen
    const dens = FAR ? 0.32 : L01 ? 0.6 : 1, wMul = 1 / dens;
    const juteM = [C.jute, C.jute2, C.jute3, C.jute4];
    const buckets = new Map();
    // zweiseitiges Viereck: oben am Punkt P (Breite w entlang t), hängt entlang d (Länge len), unten verjüngt
    const strip = (bone, P, t, d, len, w) => {
      const mi = (rnd() * juteM.length) | 0, key = bone + '|' + mi;
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      const hw = w / 2, bw = hw * (0.55 + rnd() * 0.3);
      const a = [P[0] - t[0] * hw, P[1] - t[1] * hw, P[2] - t[2] * hw], b = [P[0] + t[0] * hw, P[1] + t[1] * hw, P[2] + t[2] * hw];
      const E2 = [P[0] + d[0] * len, P[1] + d[1] * len, P[2] + d[2] * len];
      const c = [E2[0] + t[0] * bw, E2[1] + t[1] * bw, E2[2] + t[2] * bw], e = [E2[0] - t[0] * bw, E2[1] - t[1] * bw, E2[2] - t[2] * bw];
      arr.push(...a, ...b, ...c, ...a, ...c, ...e, ...a, ...c, ...b, ...a, ...e, ...c);
    };
    // Ring von Fransen um eine senkrechte Achse (cx, cz) mit Halbachsen (ra, rb) in Höhe y, Winkel φ (0 = +x·sx, π/2 = hinten)
    const ring = (bone, cx, cz, ra, rb, y, sx, phi0, phi1, len0, len1, tilt0, tilt1) => {
      const arc = Math.abs(phi1 - phi0) * (ra + rb) / 2, w0 = 0.026 * wMul;
      const n = Math.max(2, Math.round(arc / (w0 * 0.85)));
      for (let i = 0; i < n; i++) {
        const ph = phi0 + (phi1 - phi0) * (i + 0.3 + rnd() * 0.4) / n;
        const ox = Math.cos(ph) * sx, oz = Math.sin(ph);
        const P = [cx + ox * ra, y + (rnd() - 0.5) * 0.02, cz + oz * rb];
        const nl = Math.hypot(ox / ra, oz / rb) || 1, nx = ox / ra / nl, nz = oz / rb / nl;
        const tilt = tilt0 + rnd() * (tilt1 - tilt0), st = Math.sin(tilt), ct = Math.cos(tilt);
        strip(bone, P, [-nz, 0, nx], [nx * st, -ct, nz * st], len0 + rnd() * (len1 - len0), w0 * (0.8 + rnd() * 0.5));
      }
    };
    const hy = V.head === 'boonie' ? 1.79 : 1.8;
    // Kapuze: Netz + drei Fransenlagen (Gesicht frei)
    add(E(0.16, 0.085, 0.17, { p: [0, hy - 0.045, 0.015] }, { thetaLength: Math.PI * 0.55 }, q.sw, Math.max(3, q.sh / 2)), 'head', C.jute3);
    for (const [dy, r] of [[0.0, 0.12], [-0.035, 0.16], [-0.07, 0.19]]) ring('head', 0, 0.015, r, r, hy + dy, 1, -0.55, Math.PI + 0.55, 0.07, 0.15, 0.35, 0.8);
    // Schultern (von oben über die Schulterkuppen) und Rücken/Seiten in Lagen bis zur Hüfte
    add(E(0.24, 0.16, 0.2, { p: [0, 1.4, 0.05] }, { thetaLength: Math.PI * 0.5 }), 'chest', C.jute3);
    ring('chest', 0, 0.02, 0.13, 0.11, 1.52, 1, -0.75, Math.PI + 0.75, 0.12, 0.2, 0.9, 1.25);
    const torsoLayers = full ? [1.47, 1.4, 1.33, 1.26, 1.19, 1.12, 1.05] : [1.47, 1.4, 1.33];
    for (const y of torsoLayers) ring('chest', 0, 0.035, 0.26, 0.27, y, 1, -0.35, Math.PI + 0.35, 0.09, 0.17, 0.12, 0.4);
    if (full) {
      for (const y of [0.99, 0.92]) ring('hips', 0, 0.03, 0.24, 0.22, y, 1, -0.25, Math.PI + 0.25, 0.09, 0.16, 0.1, 0.35);
      // Ärmel (außen/oben/hinten) und Hose (außen/hinten)
      for (const [ub, fb, sx] of [['upperArmL', 'foreArmL', -1], ['upperArmR', 'foreArmR', 1]]) {
        for (const y of [1.4, 1.32, 1.24, 1.16]) ring(ub, sx * DIM.shoulderX, 0, 0.082, 0.082, y, sx, -0.4, 2.1, 0.07, 0.13, 0.15, 0.45);
        for (const y of [1.06, 0.98]) ring(fb, sx * DIM.shoulderX, 0, 0.07, 0.07, y, sx, -0.3, 2.0, 0.05, 0.1, 0.15, 0.4);
      }
      for (const [tb, sb, sx] of [['thighL', 'shinL', -1], ['thighR', 'shinR', 1]]) {
        for (const y of [0.86, 0.78, 0.7, 0.62]) ring(tb, sx * 0.1, 0, 0.125, 0.125, y, sx, -0.5, 2.7, 0.08, 0.15, 0.1, 0.35);
        for (const y of [0.44, 0.36, 0.28]) ring(sb, sx * 0.1, 0.005, 0.088, 0.088, y, sx, -0.5, 2.7, 0.06, 0.12, 0.08, 0.3);
      }
    }
    for (const [key, arr] of buckets) {
      const [bone, mi] = key.split('|');
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      add(g, bone, juteM[+mi]);
    }
  }

  /* ------------------------------------------------------------ Arme (Arme/Hände selbst: body-mesh.js) */
  const AX = -DIM.shoulderX; // Armachse links (rechts gespiegelt)
  // Armbinde in Teamfarbe rund um den Oberarm (auch aus der Ferne und von hinten sichtbar)
  pair(cyl(0.081, 0.078, 0.055, q.cs, { p: [AX, 1.25, 0.0], s: [0.88, 1, 1.02] }, true), 'upperArmL', 'upperArmR', C.band);
  if (L0) pair(rbox(0.006, 0.044, 0.05, 0, 0, { p: [AX - 0.084, 1.35, -0.002] }), 'upperArmL', 'upperArmR', C.patch); // Klett auf der Ärmeltasche
  if (V.armband === 'medic') {
    // Armbinde Sanitäter (weiß, rotes Kreuz außen) unter dem Teamband
    pair(cyl(0.077, 0.074, 0.065, q.cs, { p: [AX, 1.19, 0.0], s: [0.88, 1, 1.0] }, true), 'upperArmL', 'upperArmR', C.medWhite);
    pair(rbox(0.006, 0.044, 0.014, 0, 0, { p: [AX - 0.069, 1.19, 0.0] }), 'upperArmL', 'upperArmR', C.medRed);
    pair(rbox(0.006, 0.014, 0.044, 0, 0, { p: [AX - 0.069, 1.19, 0.0] }), 'upperArmL', 'upperArmR', C.medRed);
  }
  if (V.pauldrons) pair(E(0.102, 0.078, 0.108, { p: [AX - 0.018, 1.44, 0.0] }, { thetaLength: Math.PI * 0.5 }), 'upperArmL', 'upperArmR', C.gear);
  // hochgekrempelte Ärmel: Wulst unter dem Ellbogen
  if (rolled) pair(torus(0.063, 0.016, 4, q.cs, { p: [AX, 1.1, 0.0], r: [Math.PI / 2, 0, 0], s: [0.9, 1.04, 1] }), 'foreArmL', 'foreArmR', C.top);
  if (L0) add(R(0.014, 0.024, 0.032, 0.004, { p: [AX - 0.046, 0.965, 0] }), 'foreArmL', C.plastic); // Uhr

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
