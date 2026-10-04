// NULLPUNKT – prozedurale Waffenmodelle (Ego-Ansicht, Bots, Arsenal-Vitrine der Website).
// Eigenständig nutzbar mit reinem three.js (keine Abhängigkeit von G oder der Spiel-Laufzeit).
//
// createWeaponModel(key, { lod: 'first' | 'third' | 'showcase' }) → THREE.Group
//   Koordinaten: Meter, +Y oben, Lauf zeigt nach −Z, Ursprung = Mitte des Pistolengriffs (rechte Hand).
//   'showcase': zentriert im Ursprung, längste Kante = 1 Einheit (für Drehteller).
//   group.userData = {
//     key, lod, muzzle, ejection, magazine, sight, leftHandGrip, rightHandGrip, adsOffset (Vector3),
//     parts: { mag, bolt, charge, pump, slide, boltHandle, hammer, cover, belt, pin, spoon, … } (nur vorhandene),
//     anchors: { chargeGrab, magGrab, magWell, trigger, … }, info: { sight, kind, triangles, meshes, size, axis }
//   }
//   adsOffset = Position der Gruppe im Kameraraum (Kamera im Ursprung, Blick −Z), bei der das Visier exakt
//   auf der optischen Achse liegt (inkl. Augenabstand der Visierung).
import * as THREE from 'three';
import { Builder } from './gunsmith/builder.js';
import { m17, kv47, sk14 } from './gunsmith/guns-ar.js';
import { vp9, qx90, hm60 } from './gunsmith/guns-auto.js';
import { brecher, bulldog } from './gunsmith/guns-long.js';
import { p9, adler } from './gunsmith/guns-pistol.js';
import { knife, frag, semtex } from './gunsmith/gear.js';
import { disposeMaterials } from './gunsmith/materials.js';
import { disposeTextures } from './gunsmith/textures.js';

const BUILDERS = { kv47, m17, vp9, qx90, hm60, sk14, brecher, bulldog, p9, adler, knife, frag, semtex };

export const MODEL_KEYS = Object.keys(BUILDERS);
export const GUN_KEYS = ['kv47', 'm17', 'vp9', 'qx90', 'hm60', 'sk14', 'brecher', 'bulldog', 'p9', 'adler'];

const REF_NAMES = ['muzzle', 'ejection', 'sight', 'leftHandGrip', 'rightHandGrip'];
const ANCHOR_NAMES = ['chargeGrab', 'magGrab', 'magWell', 'trigger', 'pumpGrab', 'boltGrab', 'pinGrab', 'shellPort', 'slideGrab', 'boltCatch'];
const PART_NAMES = ['mag', 'bolt', 'charge', 'pump', 'slide', 'boltHandle', 'hammer', 'cover', 'belt', 'pin', 'spoon', 'blade', 'shell', 'led'];

const cache = new Map();

function buildTemplate(key, lod) {
  const make = BUILDERS[key];
  if (!make) throw new Error(`Unbekanntes Waffenmodell: ${key}`);
  const b = new Builder(lod === 'third' ? 'third' : 'first');
  make(b);
  const root = b.build(key);
  // Fehlende Pflicht-Anker im Ursprung ergänzen (Messer/Granaten haben z. B. keine Mündung)
  for (const n of REF_NAMES) if (!root.getObjectByName(n)) { const o = new THREE.Object3D(); o.name = n; root.add(o); }
  for (const n of b.meta.hidden || []) { const o = root.getObjectByName(n); if (o) o.visible = false; }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const sight = root.getObjectByName('sight');
  const sp = sight.getWorldPosition(new THREE.Vector3());
  const eye = sight.userData.eyeRelief ?? 0.2;
  const meta = {
    key, lod,
    parts: PART_NAMES.filter(n => root.getObjectByName(n)),
    anchors: ANCHOR_NAMES.filter(n => root.getObjectByName(n)),
    adsOffset: [-sp.x, -sp.y, -eye - sp.z],
    info: {
      sight: b.meta.sight || 'none', kind: b.meta.kind || 'gear', axis: b.meta.axis ?? 0,
      triangles: root.userData.stats.triangles, meshes: root.userData.stats.meshes,
      size: size.toArray(), center: box.getCenter(new THREE.Vector3()).toArray(), min: box.min.toArray(), max: box.max.toArray(),
    },
  };
  root.userData = { __meta: meta };
  return root;
}

function bindUserData(obj, meta, lookupRoot = obj) {
  const find = n => lookupRoot.getObjectByName(n);
  const ud = { key: meta.key, lod: meta.lod };
  for (const n of REF_NAMES) ud[n] = find(n);
  ud.magazine = find('mag') || find('shell') || find('blade') || lookupRoot;
  ud.adsOffset = new THREE.Vector3().fromArray(meta.adsOffset);
  ud.parts = {};
  for (const n of meta.parts) ud.parts[n] = find(n);
  ud.anchors = {};
  for (const n of meta.anchors) ud.anchors[n] = find(n);
  ud.info = { ...meta.info };
  obj.userData = ud;
  return obj;
}

function cloneTemplate(tpl) {
  const meta = tpl.userData.__meta;
  tpl.userData = {};
  const c = tpl.clone(true);
  tpl.userData = { __meta: meta };
  return bindUserData(c, meta);
}

function getTemplate(key, lod) {
  const k = key + ':' + lod;
  let t = cache.get(k);
  if (!t) { t = buildTemplate(key, lod); cache.set(k, t); }
  return t;
}

/**
 * Erzeugt ein Waffenmodell. Gebaute Modelle werden pro Schlüssel + LOD gecacht;
 * Rückgabe ist ein günstiger Klon (geteilte Geometrien und Materialien).
 */
export function createWeaponModel(key, { lod = 'first' } = {}) {
  if (lod === 'showcase') {
    const inner = cloneTemplate(getTemplate(key, 'first'));
    const info = inner.userData.info;
    const holder = new THREE.Group();
    holder.name = `vitrine:${key}`;
    const s = 1 / Math.max(...info.size);
    inner.scale.setScalar(s);
    inner.position.set(-info.center[0] * s, -info.center[1] * s, -info.center[2] * s);
    holder.add(inner);
    bindUserData(holder, { ...getTemplate(key, 'first').userData.__meta, lod: 'showcase' }, inner);
    holder.userData.model = inner;
    holder.userData.scale = s;
    return holder;
  }
  return cloneTemplate(getTemplate(key, lod === 'third' ? 'third' : 'first'));
}

/** Metadaten ohne Instanz (Dreiecke, Größe, Visier, Art). */
export function getWeaponModelInfo(key, lod = 'first') {
  return { ...getTemplate(key, lod === 'third' ? 'third' : 'first').userData.__meta.info };
}

/** Baut alle Modelle vorab (z. B. während des Ladebildschirms), damit später keine Ruckler entstehen. */
export function preloadWeaponModels(keys = MODEL_KEYS, lods = ['first', 'third']) {
  for (const k of keys) for (const l of lods) getTemplate(k, l);
}

/** Gibt alle gecachten Geometrien, Materialien und Texturen frei. */
export function disposeWeaponModels() {
  for (const t of cache.values()) t.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  cache.clear();
  disposeMaterials();
  disposeTextures();
}
