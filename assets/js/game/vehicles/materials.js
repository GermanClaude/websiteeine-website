// NULLPUNKT — Fahrzeugmaterialien (geteilt, überdauern Matches wie die Viewmodel-Materialien).
//
// Sofort verfügbar: prozedurale Materialien aus engine/textures.js (geklont, eigene Tönung). Danach im Hintergrund
// Aufwertung auf die CC0-Fotoscan-Sätze der Bibliothek (assets/lib/loader.js: metal_painted, gunmetal_worn,
// rubber, canvas, metal_rust_painted) – die Material-Objekte bleiben dieselben, nur die Texturen werden getauscht
// (kein Neuzuweisen an Meshes, keine Shader-Varianten-Explosion: map/normalMap/ORM gibt es in beiden Fällen).
import * as THREE from 'three';
import { getMaterial } from '../engine/textures.js';
import { assets, tierFor } from '../../../lib/loader.js';

let SET = null;
let upgrading = null;

/** Teamfarben der Lackierung (A = Oliv, B = Sand-Grau) und Kennung (A blau, B rot – wie Killfeed/Minikarte). */
export const TEAM_TINT = { A: 0x55613f, B: 0x8c7d5c, null: 0x5f6458 };
export const TEAM_MARK = { A: 0x3d7fe0, B: 0xd8432c, null: 0xd8d2c0 };

function fromBase(name, params) {
  let base = null;
  try { base = getMaterial(name); } catch { base = null; }
  const m = base ? base.clone() : new THREE.MeshStandardMaterial();
  m.name = `veh:${name}`;
  Object.assign(m, params);
  if (params.color != null) m.color = new THREE.Color(params.color);
  return m;
}

/** Kettenglieder (Kanvas, 64×256): Platten mit Stegen, dunkler Stahl. */
function trackTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#26241f'; g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 4; i++) {
    const x = i * 32;
    g.fillStyle = '#3b3833'; g.fillRect(x + 2, 4, 26, 56);
    g.fillStyle = '#4c4842'; g.fillRect(x + 6, 6, 4, 52); g.fillRect(x + 18, 6, 4, 52);
    g.fillStyle = '#17150f'; g.fillRect(x + 29, 0, 3, 64);
    g.fillStyle = '#5a554c'; g.fillRect(x + 12, 28, 6, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Geteilter Materialsatz. Wird einmal erzeugt; `upgrade(renderer, quality)` tauscht im Hintergrund auf
 * Fotoscan-Texturen (sicher mehrfach aufrufbar).
 */
export function vehicleMaterials() {
  if (SET) return SET;
  const paint = (team) => fromBase('metal_painted', { color: TEAM_TINT[team], metalness: 0.25, roughness: 0.72, envMapIntensity: 0.8 });
  SET = {
    paint: { A: paint('A'), B: paint('B'), null: paint(null) },
    dark: fromBase('gunmetal', { color: 0x3a3a38, metalness: 0.6, roughness: 0.55 }),
    rubber: fromBase('rubber', { color: 0x1d1d1d, metalness: 0, roughness: 0.92 }),
    canvas: fromBase('tarp', { color: 0x6b6345, metalness: 0, roughness: 0.95 }),
    interior: new THREE.MeshStandardMaterial({ name: 'veh:interior', color: 0x2c2d28, roughness: 0.9, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ name: 'veh:glass', color: 0x1c2428, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.6 }),
    lensOn: new THREE.MeshStandardMaterial({ name: 'veh:lensOn', color: 0xfff6e0, emissive: 0xffe9c0, emissiveIntensity: 6, roughness: 0.2 }),
    lensOff: new THREE.MeshStandardMaterial({ name: 'veh:lensOff', color: 0xb9b6ad, emissive: 0x332f26, emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.3 }),
    rearLamp: new THREE.MeshStandardMaterial({ name: 'veh:rear', color: 0x5a0d08, emissive: 0x6a0904, emissiveIntensity: 1.2, roughness: 0.3 }),
    mark: {
      A: new THREE.MeshStandardMaterial({ name: 'veh:markA', color: TEAM_MARK.A, emissive: TEAM_MARK.A, emissiveIntensity: 0.35, roughness: 0.6 }),
      B: new THREE.MeshStandardMaterial({ name: 'veh:markB', color: TEAM_MARK.B, emissive: TEAM_MARK.B, emissiveIntensity: 0.35, roughness: 0.6 }),
      null: new THREE.MeshStandardMaterial({ name: 'veh:mark', color: TEAM_MARK.null, roughness: 0.6 }),
    },
    wreck: fromBase('metal_rust', { color: 0x2a2420, metalness: 0.2, roughness: 0.95 }),
    trackTex: trackTexture(),
    cone: new THREE.MeshBasicMaterial({ name: 'veh:cone', color: 0xffe2b0, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }),
    flash: new THREE.MeshBasicMaterial({ name: 'veh:flash', color: 0xffc070, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  SET.trackMats = [];
  return SET;
}

/** Kettenmaterial je Fahrzeugseite (eigene Texturkopie → eigener Versatz für den Kettenlauf). */
export function trackMaterial() {
  const S = vehicleMaterials();
  const tex = S.trackTex.clone();
  tex.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ name: 'veh:track', map: tex, color: 0xffffff, roughness: 0.85, metalness: 0.45 });
  return m;
}

function applySet(m, set, { metalness, roughness } = {}) {
  if (!set) return;
  m.map = set.map || m.map;
  m.normalMap = set.normalMap || m.normalMap;
  if (set.ormMap) { m.aoMap = set.ormMap; m.roughnessMap = set.ormMap; m.metalnessMap = set.ormMap; }
  if (metalness != null) m.metalness = metalness;
  if (roughness != null) m.roughness = roughness;
  m.needsUpdate = true;
}

/**
 * Fotoscan-Aufwertung (Hintergrund, Fehler werden still verschluckt → prozedurale Materialien bleiben).
 * Stufe: low 512, sonst 1024 (Fahrzeuge sind keine Helden-Sätze).
 */
export function upgradeVehicleMaterials(renderer, quality = 'high') {
  if (upgrading) return upgrading;
  const S = vehicleMaterials();
  upgrading = (async () => {
    try {
      if (!assets.renderer && renderer) assets.setRenderer(renderer);
      if (!assets.renderer) return false;
      await assets.ready();
      const tier = Math.min(1024, tierFor(quality, 'texture'));
      const load = (id) => assets.loadTextureSet(id, tier).catch(() => null);
      const [paint, dark, rubber, canvas, rust] = await Promise.all([
        load('metal_painted'), load('gunmetal_worn'), load('rubber'), load('canvas'), load('metal_rust_painted'),
      ]);
      // Lack: einfärbbarer Satz – Farbe bleibt die Teamtönung, Rauheit/Metall aus der ORM-Karte
      for (const k of ['A', 'B', 'null']) applySet(S.paint[k], paint, { metalness: 0.9, roughness: 1 });
      applySet(S.dark, dark, { metalness: 1, roughness: 1 });
      applySet(S.rubber, rubber, { metalness: 1, roughness: 1 });
      applySet(S.canvas, canvas, { metalness: 1, roughness: 1 });
      applySet(S.wreck, rust, { metalness: 0.6, roughness: 1 });
      return true;
    } catch (err) {
      if (typeof console !== 'undefined') console.info('[vehicles] Fotoscan-Materialien nicht verfügbar – prozedural.', err && err.message);
      return false;
    }
  })();
  return upgrading;
}
