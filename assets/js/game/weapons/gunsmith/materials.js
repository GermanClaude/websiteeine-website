// Gemeinsame PBR-Materialien der Waffen (geteilt zwischen allen Modellen, LODs und Klonen).
import * as THREE from 'three';
import { wearMap, brushedMap, grainNormal, stippleNormal, knurlNormal, woodMap, reticleMap, polymerMap } from './textures.js';

const mats = new Map();

// UV-Maßstab: 1 UV-Einheit = UV_SCALE Meter (siehe builder.js boxUV)
export const UV_SCALE = 0.2;

function std(o) {
  const m = new THREE.MeshStandardMaterial(o);
  return m;
}

const DEFS = {
  // Parkerisierter Stahl / Gunmetal
  steel: () => std({ color: 0x3f4146, metalness: 0.82, roughness: 0.5, roughnessMap: wearMap(), metalnessMap: wearMap() }),
  // Brünierter Lauf
  steelDark: () => std({ color: 0x2b2c30, metalness: 0.9, roughness: 0.4, roughnessMap: wearMap() }),
  // Blankes Metall (Verschluss, Laufmündung innen sichtbar)
  steelBright: () => std({ color: 0x8d9095, metalness: 1, roughness: 0.3, roughnessMap: wearMap() }),
  // Schwarz eloxiertes Aluminium
  alu: () => std({ color: 0x2a2b2f, metalness: 0.6, roughness: 0.46, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.08, 0.08) }),
  // Cerakote Flat Dark Earth
  aluTan: () => std({ color: 0x8f7a58, metalness: 0.25, roughness: 0.62, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.3, 0.3) }),
  // Cerakote Oliv (Scharfschützengewehr-Schaft)
  aluOD: () => std({ color: 0x3f4630, metalness: 0.2, roughness: 0.66, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.35, 0.35) }),
  polymer: () => std({ color: 0x1f2023, metalness: 0.0, roughness: 0.78, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.12, 0.12) }),
  // FDE-Kunststoff (Schaft, Magazin): Grundton × Albedo-Fleckung ≈ #66553c im Mittel (sonnenbeschienen nicht grell)
  polymerTan: () => std({ color: 0x7f6b4d, map: polymerMap(), metalness: 0.0, roughness: 0.8, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.16, 0.16) }),
  polymerOD: () => std({ color: 0x3f4630, metalness: 0.0, roughness: 0.8, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.12, 0.12) }),
  polymerGrey: () => std({ color: 0x35383b, metalness: 0.0, roughness: 0.74, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.12, 0.12) }),
  // Griffflächen mit Stippling
  grip: () => std({ color: 0x1c1d20, metalness: 0.0, roughness: 0.88, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.45, 0.45) }),
  gripTan: () => std({ color: 0x75644a, metalness: 0.0, roughness: 0.9, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.45, 0.45) }),
  rubber: () => std({ color: 0x18181a, metalness: 0.0, roughness: 0.9, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.22, 0.22) }),
  woodWarm: () => std({ color: 0xffffff, map: woodMap('warm'), metalness: 0.0, roughness: 0.58, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.2, 0.2) }),
  woodWalnut: () => std({ color: 0xffffff, map: woodMap('walnut'), metalness: 0.0, roughness: 0.42, roughnessMap: wearMap() }),
  stainless: () => std({ color: 0x9da1a6, metalness: 1.0, roughness: 0.36, roughnessMap: brushedMap() }),
  brass: () => std({ color: 0xc09a45, metalness: 1.0, roughness: 0.3, roughnessMap: wearMap() }),
  copper: () => std({ color: 0xb8703f, metalness: 1.0, roughness: 0.32 }),
  shellRed: () => std({ color: 0x8f1f17, metalness: 0.0, roughness: 0.5, roughnessMap: wearMap() }),
  knurl: () => std({ color: 0x2c2d31, metalness: 0.7, roughness: 0.5, normalMap: knurlNormal(), normalScale: new THREE.Vector2(1, 1) }),
  // Optik-Linse: dunkel, stark spiegelnd, bläulich vergütet
  lens: () => std({ color: 0x0c1b22, metalness: 1.0, roughness: 0.04, envMapIntensity: 1.6, emissive: 0x06141c, emissiveIntensity: 1 }),
  // Durchsichtige Optiklinse (Rotpunkt/ACOG): leicht bläulich vergütet, spiegelt die Umgebung
  lensClear: () => std({ color: 0x8fb8d8, metalness: 0.6, roughness: 0.04, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.8 }),
  // Holo-Fenster: leicht getöntes Glas
  glass: () => std({ color: 0x9fd8d0, metalness: 0.4, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.4 }),
  // Transluzentes Magazin (QX-90)
  smoke: () => std({ color: 0x3c4a50, metalness: 0.1, roughness: 0.18, transparent: true, opacity: 0.62, envMapIntensity: 1.2 }),
  paintWhite: () => std({ color: 0xdedbd2, metalness: 0.0, roughness: 0.6 }),
  paintOlive: () => std({ color: 0x505733, metalness: 0.25, roughness: 0.62, roughnessMap: wearMap(), normalMap: grainNormal(), normalScale: new THREE.Vector2(0.35, 0.35) }),
  paintYellow: () => std({ color: 0xc9a52b, metalness: 0.1, roughness: 0.55 }),
  paintSignal: () => std({ color: 0xff5b1f, metalness: 0.0, roughness: 0.5 }),
  putty: () => std({ color: 0x6f6448, metalness: 0.0, roughness: 0.95, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.6, 0.6) }),
  blade: () => std({ color: 0x9a9ea3, metalness: 1.0, roughness: 0.22, roughnessMap: brushedMap() }),
  bladeCoat: () => std({ color: 0x2a2b2d, metalness: 0.55, roughness: 0.5, roughnessMap: wearMap() }),
  // Stoffhülle (Schutzplatte, Taschen): Oliv, grob
  canvasOD: () => std({ color: 0x4a4f36, metalness: 0.0, roughness: 0.95, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.5, 0.5) }),
  cord: () => std({ color: 0x3b3f2e, metalness: 0.0, roughness: 0.95, normalMap: knurlNormal(), normalScale: new THREE.Vector2(0.8, 0.8) }),
  // Leere/Innenraum (Auswurföffnung, Laufbohrung)
  cavity: () => new THREE.MeshBasicMaterial({ color: 0x050505 }),
  // Selbstleuchtend (bloom-freundlich, kein Tonemapping)
  glowRed: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.35, 0.15), toneMapped: false }),
  glowGreen: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 0.5), toneMapped: false }),
  glowAmber: () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 1.4, 0.3), toneMapped: false }),
  // Absehen
  reticleHolo: () => new THREE.MeshBasicMaterial({ map: reticleMap('holo'), color: new THREE.Color(3.2, 0.55, 0.25), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  reticleDot: () => new THREE.MeshBasicMaterial({ map: reticleMap('dot'), color: new THREE.Color(3.5, 0.3, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  reticleChevron: () => new THREE.MeshBasicMaterial({ map: reticleMap('chevron'), color: new THREE.Color(3.4, 0.7, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  // Bot-Detailstufe: zwei Sammelmaterialien mit Vertex-Farben (ein Draw Call je Gruppe)
  lodMetal: () => std({ color: 0xffffff, vertexColors: true, metalness: 0.75, roughness: 0.45, roughnessMap: wearMap() }),
  lodMatte: () => std({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.72, roughnessMap: wearMap() }),
};

// Ersatzfarben (sRGB) für texturierte Materialien in der Bot-Detailstufe
const LOD_COLORS = { woodWarm: 0x6a3a22, woodWalnut: 0x4a2d1c, polymerTan: 0x66553c };
const _lodCol = new Map();
/** Farbe (linear) + Metall-Gruppe eines Materials für die zusammengeführte Bot-Detailstufe. */
export function lodInfo(key) {
  let r = _lodCol.get(key);
  if (!r) {
    const m = getMat(key);
    const color = LOD_COLORS[key] !== undefined ? new THREE.Color(LOD_COLORS[key]) : (m.color ? m.color.clone() : new THREE.Color(0x333333));
    r = { color, metal: (m.metalness ?? 0) >= 0.5 };
    _lodCol.set(key, r);
  }
  return r;
}

// Materialien, die in der Bot-Detailstufe entfallen (Durchsicht, Leuchten, Hohlräume)
export const LOD_SKIP = new Set(['cavity', 'glass', 'lens', 'lensClear', 'smoke', 'reticleHolo', 'reticleDot', 'reticleChevron', 'glowRed', 'glowGreen', 'glowAmber']);

export function getMat(key) {
  let m = mats.get(key);
  if (!m) {
    const make = DEFS[key];
    if (!make) throw new Error(`Unbekanntes Waffenmaterial: ${key}`);
    m = make();
    m.name = 'gs:' + key;
    mats.set(key, m);
  }
  return m;
}

export function materialKeys() { return Object.keys(DEFS); }

// Vorrat für Instanz-Materialien des Viewmodels (Arme, Mündungsfeuer, Rauch, Hülsen). Beim Matchende werden sie
// hier geparkt statt entsorgt: dispose() gäbe ihre Shaderprogramme frei, und das nächste Match müsste jedes neu
// kompilieren und linken (auf Telefonen Hunderte ms). Ein Eintrag ist ein Material oder ein Objekt aus Materialien;
// Instanzzustand (Deckkraft, Textur) setzt der neue Besitzer beim Holen selbst.
const spare = new Map();

/** Material(-satz) unter `key` aus dem Vorrat holen, sonst mit make() neu anlegen. */
export function takeMaterials(key, make) {
  const list = spare.get(key);
  return list && list.length ? list.pop() : make();
}

/** Material(-satz) zurück in den Vorrat legen (ersetzt dispose(); endgültig frei erst mit disposeMaterials()). */
export function parkMaterials(key, set) {
  if (!set) return;
  let list = spare.get(key);
  if (!list) spare.set(key, (list = []));
  if (!list.includes(set)) list.push(set);
}

function disposeSet(set) {
  if (set.isMaterial) set.dispose();
  else for (const m of Object.values(set)) if (m && m.isMaterial) m.dispose();
}

export function disposeMaterials() {
  for (const m of mats.values()) m.dispose();
  mats.clear();
  for (const list of spare.values()) list.forEach(disposeSet);
  spare.clear();
}
