// NULLPUNKT — prozedurale PBR-Materialien (Owner: world)
// Albedo + Normal + Roughness(/Metalness) werden aus kachelbarem Rauschen erzeugt
// (seeded PRNG, Value-Noise, Worley). Texturen sind über Matches hinweg gecacht.
//
// getMaterial(name, opts) → MeshStandardMaterial (gecacht, material.userData.surface gesetzt)
// boxUV(geometry, scale)  → weltskalierte UVs per Box-Projektion (1 UV-Einheit = scale Meter)
// preloadMaterials(names, onProgress) → erzeugt Texturen parallel (Worker-Pool) mit Fortschritt
// Generatoren: ../world/texgen.js (ohne three, auch im Worker lauffähig)
import * as THREE from 'three';
import { generateTexture } from '../world/texgen.js';
import { addShaderPatch, ensureWorldVaryings } from '../world/shading.js';

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------
let texSize = 512;
let anisotropy = 4;
const texCache = new Map();   // Texturgruppe → { map, normalMap, roughnessMap, hasMetal, hasAlpha, epoch }
const matCache = new Map();   // Material-Schlüssel → Material (userData.texGroup = Gruppenname)
export const textureStats = { generated: 0, ms: 0, released: 0 };

// Nutzungsepochen: loadWorld beginnt je Karte eine Epoche; nach dem Aufbau gibt releaseUnusedTextures()
// alle Gruppen frei, die die neue Karte nicht angefasst hat (sonst sammeln sich Texturen aller besuchten Karten).
let epoch = 0;
const touch = (grp) => { if (grp) grp.epoch = epoch; return grp; };

/** Neue Nutzungsepoche (vor dem Aufbau einer Karte). */
export function beginTextureEpoch() { return ++epoch; }

/** Gibt Texturgruppen (+ ihre Materialien) frei, die seit beginTextureEpoch() nicht benutzt wurden. → Anzahl */
export function releaseUnusedTextures() {
  let n = releaseLibrary();
  for (const [name, grp] of texCache) {
    if (grp.epoch === epoch) continue;
    for (const [key, m] of matCache) if (m.userData.texGroup === name) { disposeMaterial(m); matCache.delete(key); }
    disposeTexGroup(grp);
    texCache.delete(name);
    pendingGroups.delete(name);
    n++;
  }
  textureStats.released += n;
  return n;
}

/** Material + seine (geklonten, quellteilenden) Texturen freigeben. */
function disposeMaterial(m) {
  for (const k of ['map', 'normalMap', 'roughnessMap']) m[k]?.dispose();
  m.dispose();
}

/** Texturauflösung / Anisotropie festlegen (z. B. 256 auf Low/Mobile). Bereits erzeugte Texturen bleiben gültig. */
/** textures-2: anisotrope Filterung je Stufe (Boden/Wände unter flachem Blickwinkel scharf; KTX2 hat volle Mip-Ketten).
 * Gilt für alle Welt-/Gelände-/Requisiten-Texturen (prozedural, Bibliothek, Detail-/Makrokarten). */
export const ANISO_BY_QUALITY = Object.freeze({ low: 8, medium: 8, high: 16, ultra: 16 }); // low 8: Bibliothek lief dort schon mit 8 (Lader-Standard), prozedural vorher 2
export function textureAnisotropy(renderer, quality) {
  const max = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
  return Math.max(1, Math.min(ANISO_BY_QUALITY[quality] || 8, max));
}

// Anisotropie ist Teil des GPU-Cache-Schlüssels von three (Klone mit abweichendem Wert = eigener Upload):
// bei einem Wechsel alle Texturen einer Source gemeinsam umstellen und neu hochladen lassen
function setAniso(t, an) {
  if (!t || t.anisotropy === an) return;
  t.anisotropy = an;
  if (t.version > 0) t.needsUpdate = true;
}

/**
 * Texturgröße (prozedural) und Anisotropie setzen. { size, anisotropy } oder { size, quality, renderer }
 * (dann Anisotropie aus ANISO_BY_QUALITY, begrenzt auf das Gerät).
 */
export function configureTextures({ size, anisotropy: an0, quality, renderer } = {}) {
  if (size && size !== texSize) {
    texSize = size;
    disposeMaterials();
  }
  const an = quality ? textureAnisotropy(renderer, quality) : an0;
  if (an && an !== anisotropy) {
    anisotropy = an;
    for (const t of texCache.values()) for (const k of ['map', 'normalMap', 'roughnessMap']) setAniso(t[k], an);
    for (const m of matCache.values()) for (const k of ['map', 'normalMap', 'roughnessMap']) setAniso(m[k], an);
    for (const t of libClones.values()) setAniso(t, an);
    setAniso(detailTex, an);
  }
}

function disposeTexGroup(t) {
  for (const k of ['map', 'normalMap', 'roughnessMap']) t[k]?.dispose();
}

/** Alle Materialien und Texturen freigeben (z. B. bei Wechsel der Texturauflösung). */
export function disposeMaterials() {
  for (const m of matCache.values()) disposeMaterial(m);
  for (const t of texCache.values()) disposeTexGroup(t);
  matCache.clear();
  texCache.clear();
  pendingGroups.clear();
}

// name → { tex, tile, surface, params }
const MATS = {
  concrete:          { tex: 'concrete', tile: 3, surface: 'concrete' },
  concrete_dark:     { tex: 'concrete_dark', tile: 3, surface: 'concrete' },
  concrete_panel:    { tex: 'concrete_panel', tile: 4, surface: 'concrete' },
  asphalt:           { tex: 'asphalt', tile: 5, surface: 'concrete' },
  plaster_warm:      { tex: 'plaster_warm', tile: 4, surface: 'concrete' },
  plaster_white:     { tex: 'plaster_white', tile: 4, surface: 'concrete' },
  brick:             { tex: 'brick', tile: 2, surface: 'concrete' },
  brick_dark:        { tex: 'brick_dark', tile: 2, surface: 'concrete' },
  stone_wall:        { tex: 'stone_wall', tile: 2.5, surface: 'concrete' },
  cobble:            { tex: 'cobble', tile: 1.5, surface: 'concrete' },
  paving:            { tex: 'paving', tile: 2.4, surface: 'concrete' },
  roof_tiles:        { tex: 'roof_tiles', tile: 1.6, surface: 'tile' },
  wood_planks:       { tex: 'wood_planks', tile: 2, surface: 'wood' },
  wood_dark:         { tex: 'wood_dark', tile: 2, surface: 'wood' },
  wood_painted:      { tex: 'wood_paint', tile: 2, surface: 'wood' }, // Fensterläden/Türen mit Tönung (immer prozedural)
  wood_crate:        { tex: 'wood_crate', tile: 1, surface: 'wood' },
  wood_stock:        { tex: 'wood_stock', tile: 0.4, surface: 'wood', params: { roughness: 1 } },
  bark:              { tex: 'bark', tile: 1.2, surface: 'wood' },
  bark_palm:         { tex: 'bark_palm', tile: 1.2, surface: 'wood' },
  cardboard:         { tex: 'cardboard', tile: 1, surface: 'wood' },
  metal_painted:     { tex: 'metal_painted', tile: 2, surface: 'metal', params: { metalness: 1 } },
  metal_rust:        { tex: 'metal_rust', tile: 2, surface: 'metal', params: { metalness: 0.35 } },
  metal_corrugated:  { tex: 'metal_corrugated', tile: 2, surface: 'metal', params: { metalness: 1 } },
  metal_galvanized:  { tex: 'metal_galvanized', tile: 1.5, surface: 'metal', params: { metalness: 0.85, envMapIntensity: 0.8 } },
  metal_tread:       { tex: 'metal_tread', tile: 1, surface: 'metal', params: { metalness: 0.75, envMapIntensity: 0.7 } },
  metal_grate:       { tex: 'metal_grate', tile: 1, surface: 'metal', params: { metalness: 1, alphaTest: 0.5, side: 'double' } },
  hazard:            { tex: 'hazard', tile: 1, surface: 'metal', params: { metalness: 1 } },
  container:         { tex: 'container', tile: 2, surface: 'metal', params: { metalness: 1 } },
  container_red:     { tex: 'container', tile: 2, surface: 'metal', params: { metalness: 1, color: '#b8392c' } },
  container_blue:    { tex: 'container', tile: 2, surface: 'metal', params: { metalness: 1, color: '#2d5f94' } },
  container_green:   { tex: 'container', tile: 2, surface: 'metal', params: { metalness: 1, color: '#3e7a4c' } },
  container_orange:  { tex: 'container', tile: 2, surface: 'metal', params: { metalness: 1, color: '#d9762a' } },
  container_gray:    { tex: 'container', tile: 2, surface: 'metal', params: { metalness: 1, color: '#8d9399' } },
  sand:              { tex: 'sand', tile: 4, surface: 'sand' },
  dirt:              { tex: 'dirt', tile: 3, surface: 'dirt' },
  gravel:            { tex: 'gravel', tile: 2, surface: 'dirt' },
  grass:             { tex: 'grass', tile: 3, surface: 'grass' },
  tiles:             { tex: 'tiles', tile: 2, surface: 'tile' },
  tiles_terracotta:  { tex: 'tiles_terracotta', tile: 2, surface: 'tile' },
  tiles_pattern:     { tex: 'tiles_pattern', tile: 2, surface: 'tile' },
  glass:             { tex: 'glass', tile: 2, surface: 'glass', params: { metalness: 0.1, envMapIntensity: 1.6 } },
  sandbag:           { tex: 'sandbag', tile: 0.6, surface: 'sand' },
  tarp:              { tex: 'tarp', tile: 2, surface: 'fabric' },
  awning:            { tex: 'awning', tile: 1, surface: 'fabric', params: { side: 'double' } },
  rubber:            { tex: 'rubber', tile: 1, surface: 'fabric' },
  rubber_floor:      { tex: 'rubber_floor', tile: 1.5, surface: 'fabric' },
  gunmetal:          { tex: 'gunmetal', tile: 0.3, surface: 'metal', params: { metalness: 1 } },
  polymer:           { tex: 'polymer', tile: 0.3, surface: 'metal' },
  fabric_camo_a:     { tex: 'fabric_camo_a', tile: 0.6, surface: 'fabric' },
  fabric_camo_b:     { tex: 'fabric_camo_b', tile: 0.6, surface: 'fabric' },
  skin:              { tex: 'skin', tile: 0.4, surface: 'flesh' },
  epoxy:             { tex: 'epoxy', tile: 3, surface: 'concrete' },
  epoxy_blue:        { tex: 'epoxy_blue', tile: 3, surface: 'concrete' },
  panel_wall:        { tex: 'panel_wall', tile: 2.4, surface: 'fabric' },
  white:             { tex: 'white', tile: 2, surface: 'concrete' },
  // Leuchtmittel ohne Textur
  lamp_sodium:       { tex: null, surface: 'glass', params: { color: '#2a2018', emissive: '#ffae4a', emissiveIntensity: 5, roughness: 0.3 } },
  lamp_warm:         { tex: null, surface: 'glass', params: { color: '#2a241c', emissive: '#ffd59a', emissiveIntensity: 4, roughness: 0.3 } },
  lamp_cool:         { tex: null, surface: 'glass', params: { color: '#20262a', emissive: '#e6f0ff', emissiveIntensity: 5, roughness: 0.3 } },
  lamp_red:          { tex: null, surface: 'glass', params: { color: '#200808', emissive: '#ff2a1a', emissiveIntensity: 5, roughness: 0.3 } },
  lamp_green:        { tex: null, surface: 'glass', params: { color: '#082008', emissive: '#3aff6a', emissiveIntensity: 4, roughness: 0.3 } },
  window_lit:        { tex: null, surface: 'glass', params: { color: '#3a3020', emissive: '#ffc070', emissiveIntensity: 1.6, roughness: 0.2 } },
  black:             { tex: null, surface: 'concrete', params: { color: '#0b0b0c', roughness: 0.95 } },
};

// Zusätzliche Namen für Fotoscan-Sätze der Asset-Bibliothek (world/library.js ordnet sie zu). Ohne Bibliothek
// (KTX2/Transcoder nicht verfügbar, Download zu langsam) zeichnen sie mit dem nächstliegenden prozeduralen Satz.
Object.assign(MATS, {
  concrete_dirty:    { tex: 'concrete', tile: 3, surface: 'concrete', params: { color: '#e4ded2' } },
  concrete_painted:  { tex: 'concrete', tile: 3, surface: 'concrete', params: { color: '#a9c2a8' } },
  plaster_peeling:   { tex: 'plaster_white', tile: 4, surface: 'concrete' },
  plaster_blue:      { tex: 'plaster_white', tile: 4, surface: 'concrete', params: { color: '#b9d2cf' } },
  plaster_damaged:   { tex: 'plaster_warm', tile: 4, surface: 'concrete' },
  plaster_patched:   { tex: 'plaster_warm', tile: 4, surface: 'concrete', params: { color: '#d8d0c0' } },
  metal_corrugated_rust: { tex: 'metal_corrugated', tile: 2, surface: 'metal', params: { metalness: 0.4, color: '#a4704e' } },
  metal_cladding:    { tex: 'metal_corrugated', tile: 2, surface: 'metal', params: { metalness: 0.6, color: '#8fa278' } },
  metal_shutter:     { tex: 'metal_corrugated', tile: 2, surface: 'metal', params: { metalness: 0.8 } },
  chainlink:         { tex: 'metal_grate', tile: 1, surface: 'metal', params: { metalness: 1, alphaTest: 0.5, side: 'double' } },
  rubble:            { tex: 'gravel', tile: 2, surface: 'dirt', params: { color: '#e6dfd6' } },
  mud:               { tex: 'dirt', tile: 3, surface: 'dirt', params: { color: '#a59a88' } },
  ground_dry:        { tex: 'dirt', tile: 3, surface: 'dirt', params: { color: '#e6d6bc' } },
  wood_weathered:    { tex: 'wood_planks', tile: 2, surface: 'wood', params: { color: '#a59a90' } },
  wood_peeling:      { tex: 'wood_dark', tile: 2, surface: 'wood' },
  osb:               { tex: 'wood_planks', tile: 2, surface: 'wood', params: { color: '#e8d2b0' } },
  tiles_white:       { tex: 'tiles', tile: 2, surface: 'tile', params: { color: '#f2eee6' } },
  linoleum:          { tex: 'epoxy', tile: 3, surface: 'fabric', params: { color: '#d8b48c' } },
  wood_floor:        { tex: 'wood_planks', tile: 2, surface: 'wood', params: { color: '#a0907c' } },
});

export const MATERIAL_NAMES = Object.keys(MATS);

/** Oberflächentyp eines Materialnamens. */
export function surfaceOf(name) { return MATS[name]?.surface || 'concrete'; }

/** Ist der Name ein bekanntes Material? */
export function hasMaterial(name) { return !!MATS[name]; }

function sizeFor(texName) {
  return texName === 'water' ? Math.max(256, Math.min(512, texSize)) : texSize;
}

function makeTexGroup(texName, data) {
  const { S } = data;
  const prep = (arr, name, srgb) => {
    const tex = new THREE.DataTexture(arr, S, S, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = anisotropy; tex.name = texName + ':' + name;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };
  // Platzhalter vorhanden (aufgeschobene Erzeugung): Daten in die bestehenden Texturen füllen – Klone teilen die Source
  const ph = texCache.get(texName);
  if (ph && ph.pending) {
    for (const [k, arr] of [['map', data.albedo], ['normalMap', data.normal], ['roughnessMap', data.rm]]) {
      ph[k].image = { data: arr, width: S, height: S };
      ph[k].needsUpdate = true;
    }
    ph.pending = false;
    ph.avg = averageAlbedo(data.albedo);
    pendingGroups.delete(texName);
    textureStats.generated++;
    return ph;
  }
  const grp = {
    map: prep(data.albedo, 'albedo', true), normalMap: prep(data.normal, 'normal'), roughnessMap: prep(data.rm, 'rm'),
    hasMetal: data.hasMetal, hasAlpha: data.hasAlpha, epoch, pending: false, avg: averageAlbedo(data.albedo),
  };
  textureStats.generated++;
  texCache.set(texName, grp);
  return grp;
}

// --- Aufgeschobene Erzeugung (während loadWorld): getMaterial/getWaterNormalMap liefern sofort Materialien mit
// Platzhalter-Texturen (1×1); preloadMaterials erzeugt die Daten danach gesammelt im Worker-Pool und füllt sie ein.
// So rechnen Requisiten, die getMaterial direkt aufrufen (Kran, Wasser …), nicht im Hauptthread.
let deferring = false;
const pendingGroups = new Set();

/** Aufschieben an/aus (loadWorld). Beim Ausschalten werden noch offene Gruppen synchron erzeugt. */
export function deferTextureGeneration(on) {
  deferring = !!on;
  if (!deferring) for (const name of [...pendingGroups]) buildTexGroupNow(name);
}

function placeholderGroup(texName) {
  const flags = generateTexture(texName, 8); // winzige Probe: nur Metall-/Alpha-Kanal des Generators
  const tex = (name, srgb) => {
    const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = anisotropy; t.name = texName + ':' + name;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const grp = { map: tex('albedo', true), normalMap: tex('normal'), roughnessMap: tex('rm'), hasMetal: flags.hasMetal, hasAlpha: flags.hasAlpha, epoch, pending: true };
  texCache.set(texName, grp);
  pendingGroups.add(texName);
  return grp;
}

function buildTexGroup(texName) {
  if (deferring && !texCache.has(texName)) return placeholderGroup(texName);
  return buildTexGroupNow(texName);
}

function buildTexGroupNow(texName) {
  const t0 = performance.now();
  const data = generateTexture(texName, sizeFor(texName));
  textureStats.ms += performance.now() - t0;
  return makeTexGroup(texName, data);
}

// --- Worker-Pool: Texturen parallel erzeugen (Fallback: Hauptthread) -------------------
// Nach dem Laden wird der Pool nach kurzer Leerlaufzeit beendet (Speicher der Worker-Heaps); die nächste
// Karte startet ihn neu (Modul-Worker, ≈ 50 ms).
const POOL_IDLE_MS = 8000;
let pool = null, poolFailed = false, poolIdleTimer = 0;
function terminatePool() {
  clearTimeout(poolIdleTimer); poolIdleTimer = 0;
  if (pool) for (const w of pool) w.terminate();
  pool = null;
}
function getPool() {
  clearTimeout(poolIdleTimer); poolIdleTimer = 0;
  if (pool || poolFailed) return pool;
  try {
    if (typeof Worker === 'undefined') throw new Error('no workers');
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const url = new URL('../world/texgen.worker.js', import.meta.url);
    pool = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(url, { type: 'module' });
      w.busy = false;
      pool.push(w);
    }
  } catch (e) {
    poolFailed = true; pool = null;
  }
  return pool;
}

function runInWorker(w, texName, S) {
  return new Promise((resolve, reject) => {
    const onMsg = e => {
      if (e.data?.texName !== texName) return;
      w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr);
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result);
    };
    const onErr = e => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); e.preventDefault?.(); reject(e); };
    w.addEventListener('message', onMsg); w.addEventListener('error', onErr);
    w.postMessage({ texName, S });
  });
}

function texGroup(texName) { return touch(texCache.get(texName)) || buildTexGroup(texName); }

/** Wurde die Texturgruppe dieses Materials schon erzeugt? */
export function isMaterialReady(name) {
  if (libPlan.has(name) && libResolved && libSets.get(name)) return true;
  const d = MATS[name]; return !d || !d.tex || (texCache.has(d.tex) && !texCache.get(d.tex).pending);
}

/** Anzahl gecachter Texturgruppen/Materialien (Prüfseiten, Lecktests). */
export function textureCacheInfo() { return { groups: texCache.size, materials: matCache.size, workers: pool ? pool.length : 0, libMaterials: libCache.size, libTextures: libClones.size }; }

function withRepeat(tex, rx, ry) {
  if (tex.repeat.x === rx && tex.repeat.y === ry) return tex;
  const c = tex.clone(); // teilt die Source → nur ein GPU-Upload
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

/**
 * Liefert ein gecachtes MeshStandardMaterial.
 * opts: { color, repeat (Zahl|[x,y] Texturwiederholungen je UV-Einheit; Standard = 1/tile für Meter-UVs),
 *         vertexColors, side ('front'|'double'|THREE.Side), roughness, metalness, envMapIntensity,
 *         emissive, emissiveIntensity, transparent, opacity, alphaTest, polygonOffset, name }
 */
export function getMaterial(name, opts = {}) {
  let def = MATS[name];
  if (!def) {
    console.warn(`[textures] Unbekanntes Material „${name}“ – verwende concrete.`);
    name = 'concrete'; def = MATS.concrete;
  }
  if (libPlan.has(name)) return libMaterial(name, def, opts);
  return proceduralMaterial(name, def, opts);
}

function proceduralMaterial(name, def, opts) {
  const key = name + '|' + JSON.stringify(opts, Object.keys(opts).sort());
  const cached = matCache.get(key);
  if (cached) { if (def.tex) touch(texCache.get(def.tex)); return cached; }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  applyProcedural(mat, name, def, opts);
  matCache.set(key, mat);
  return mat;
}

/** Prozedurale Texturen + Parameter in ein (neues oder wartendes Bibliotheks-)Material schreiben. */
function applyProcedural(mat, name, def, opts) {
  const p = { ...(def.params || {}), ...opts };
  mat.name = name;
  if (def.tex) {
    const grp = texGroup(def.tex);
    let rx = 1 / def.tile, ry = 1 / def.tile;
    if (opts.repeat !== undefined) { if (Array.isArray(opts.repeat)) [rx, ry] = opts.repeat; else rx = ry = opts.repeat; }
    mat.map = withRepeat(grp.map, rx, ry);
    mat.normalMap = withRepeat(grp.normalMap, rx, ry);
    mat.roughnessMap = withRepeat(grp.roughnessMap, rx, ry);
    mat.roughness = 1;
    if (grp.hasMetal) { mat.metalnessMap = mat.roughnessMap; mat.metalness = p.metalness ?? 1; } else mat.metalness = p.metalness ?? 0;
    if (grp.hasAlpha) mat.alphaTest = p.alphaTest ?? 0.5;
  } else {
    mat.roughness = p.roughness ?? 0.8;
    mat.metalness = p.metalness ?? 0;
  }
  if (def.tex && opts.roughness !== undefined) mat.roughness = opts.roughness;
  if (p.color !== undefined) mat.color.set(p.color);
  if (p.emissive !== undefined) { mat.emissive.set(p.emissive); mat.emissiveIntensity = p.emissiveIntensity ?? 1; }
  if (p.envMapIntensity !== undefined) mat.envMapIntensity = p.envMapIntensity;
  if (p.vertexColors) mat.vertexColors = true;
  const side = p.side === 'double' ? THREE.DoubleSide : p.side === 'back' ? THREE.BackSide : typeof p.side === 'number' ? p.side : THREE.FrontSide;
  mat.side = side;
  if (p.transparent) { mat.transparent = true; mat.opacity = p.opacity ?? 1; mat.depthWrite = p.depthWrite ?? false; }
  if (p.alphaTest !== undefined) mat.alphaTest = p.alphaTest;
  if (p.polygonOffset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2; }
  mat.userData.surface = def.surface;
  mat.userData.materialName = name;
  mat.userData.texGroup = def.tex || null;
  return mat;
}

// ---------------------------------------------------------------------------
// Fotoscan-Materialien aus der Asset-Bibliothek (assets/lib, KTX2/Basis; world/library.js plant und lädt)
// ---------------------------------------------------------------------------
// planLibraryMaterials(plan): Map spielName → spec { id, tier, key, color (Faktor|Hex|[r,g,b] linear), tint (Hex,
//   einfärbbare Sätze), roughness, metalness, normalScale, aoMapIntensity, envMapIntensity, repeat (fester Wert
//   für „fit“-UVs), macro ([Albedo groß, Albedo mittel, Rauheit] Weltraum-Variation gegen Kachelwiederholung) }.
// Ab dann liefert getMaterial() für diese Namen Bibliotheks-Materialien: sofort als Objekt, die Texturen kommen mit
// resolveLibraryMaterials(sets) (Satz geladen → Fotoscan, fehlgeschlagen → prozeduraler Satz, gleiche Instanz).
// Oberfläche (userData.surface) bleibt die des Spielnamens (Kugeln, Schritte, Einschläge unverändert).
const libPlan = new Map();      // spielName → spec (aktuelle Karte)
const libSets = new Map();      // spielName → TextureSet (geladen) | null (fehlgeschlagen)
const libCache = new Map();     // Schlüssel → Material
const libWaiting = new Set();   // Materialien ohne Texturen (Satz lädt noch)
const libClones = new Map();    // `${setKey}|${slot}|${rx}|${ry}` → Textur-Klon (teilt die GPU-Daten)
let libResolved = false;
export const libraryStats = { materials: 0, fallback: 0 };

/** Bibliotheks-Zuordnung für die nächste Karte setzen (null/leer = nur prozedural). */
export function planLibraryMaterials(plan) {
  libPlan.clear(); libSets.clear(); libResolved = false;
  libraryStats.materials = 0; libraryStats.fallback = 0;
  if (plan) for (const [name, spec] of plan) if (MATS[name]) libPlan.set(name, spec);
  for (const m of libWaiting) applyProcedural(m, m.userData.materialName, MATS[m.userData.materialName], m.userData.libOpts || {});
  libWaiting.clear();
}

/** Ist der Spielname dieser Karte einem Bibliothekssatz zugeordnet? (prozedurale Erzeugung entfällt dann) */
export function isLibraryMaterial(name) { return libPlan.has(name) && libSets.get(name) !== null; }

/** Spielnamen, für die schon Bibliotheks-Materialien angefordert wurden (direkte getMaterial-Aufrufe der Karte). */
export function libraryPendingNames() { return [...new Set([...libWaiting].map(m => m.userData.materialName))]; }

/** Namen, deren Texturen prozedural erzeugt werden müssen (nicht oder erfolglos zugeordnet). */
export function proceduralNames(names) { return names.filter(n => !libPlan.has(n) || libSets.get(n) === null); }

/**
 * Geladene Sätze eintragen. sets: Map spielName → TextureSet | null (null = fehlgeschlagen → prozedural).
 * Wartende Materialien werden in place gefüllt (vor dem ersten Bild; danach mit needsUpdate).
 */
export function resolveLibraryMaterials(sets) {
  for (const [name, set] of sets) if (libPlan.has(name)) libSets.set(name, set || null);
  for (const name of libPlan.keys()) if (!libSets.has(name)) libSets.set(name, null);
  libResolved = true;
  for (const m of [...libWaiting]) fillLibMaterial(m);
  libWaiting.clear();
}

function libKey(name, opts) { const s = libPlan.get(name); return name + '|' + (s.key || s.id) + '|' + JSON.stringify(opts, Object.keys(opts).sort()); }

function libMaterial(name, def, opts) {
  const key = libKey(name, opts);
  const cached = libCache.get(key);
  if (cached) { cached.userData.epoch = epoch; return cached; }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = name;
  mat.userData = { surface: def.surface, materialName: name, texGroup: null, libKey: key, libOpts: { ...opts }, epoch };
  libCache.set(key, mat);
  if (libResolved) fillLibMaterial(mat); else libWaiting.add(mat);
  return mat;
}

function libTexture(set, slot, rx, ry) {
  const k = `${set.id}@${set.tier}|${slot}|${rx}|${ry}`;
  let t = libClones.get(k);
  if (!t) {
    t = set[slot].clone(); // gleiche Source → ein GPU-Upload
    t.anisotropy = anisotropy; // textures-2: Stufenwert (alle Klone gleich → ein Upload je Source)
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    t.userData = { ...(t.userData || {}), libSet: `${set.id}@${set.tier}` };
    libClones.set(k, t);
  }
  return t;
}

const _lc = new THREE.Color();
function fillLibMaterial(mat) {
  const name = mat.userData.materialName, def = MATS[name], opts = mat.userData.libOpts || {};
  const set = libSets.get(name), spec = libPlan.get(name);
  if (!set || !spec) { applyProcedural(mat, name, def, opts); mat.userData.libKey = null; libraryStats.fallback++; mat.needsUpdate = true; return; }
  const p = { ...(def.params || {}), ...opts };
  const meta = set.meta || {};
  const size = spec.sizeM || set.sizeM?.[0] || 2;
  // Wiederholung: Meter-UVs → 1/Kachelgröße; ausdrückliche Wiederholungen (z. B. BoxGeometry-UVs) im
  // physikalischen Maßstab des prozeduralen Satzes umrechnen; „fit“-Sätze (Kisten) mit festem Wert
  let rx, ry;
  if (spec.repeat != null) { rx = ry = spec.repeat; }
  else if (opts.repeat !== undefined) {
    const k = (def.tile || 2) / size;
    if (Array.isArray(opts.repeat)) { rx = opts.repeat[0] * k; ry = opts.repeat[1] * k; } else rx = ry = opts.repeat * k;
  } else rx = ry = 1 / size;
  rx = +rx.toFixed(5); ry = +ry.toFixed(5);
  mat.map = libTexture(set, 'map', rx, ry);
  mat.normalMap = libTexture(set, 'normalMap', rx, ry);
  const orm = libTexture(set, 'ormMap', rx, ry);
  mat.aoMap = orm; mat.roughnessMap = orm; mat.metalnessMap = orm;
  mat.aoMapIntensity = spec.aoMapIntensity ?? 1;
  mat.roughness = (spec.roughness ?? meta.roughnessScale ?? 1) * (opts.roughness !== undefined ? opts.roughness : 1);
  mat.metalness = spec.metalness ?? meta.metalnessScale ?? 1;
  if (spec.normalScale != null) mat.normalScale.setScalar(spec.normalScale);
  // Farbe: Kalibrierfaktor des Satzes × Tönung (Materialparameter, z. B. container_red) – Vertexfarben tönen zusätzlich
  const c = spec.color;
  if (Array.isArray(c)) mat.color.setRGB(c[0], c[1], c[2]);
  else if (typeof c === 'string') mat.color.set(c);
  else mat.color.setScalar(c ?? 1);
  if (p.color !== undefined && (meta.tintable || spec.tintParams)) mat.color.multiply(_lc.set(p.color).multiplyScalar(spec.tintGain ?? 1));
  if (p.emissive !== undefined) { mat.emissive.set(p.emissive); mat.emissiveIntensity = p.emissiveIntensity ?? 1; }
  mat.envMapIntensity = spec.envMapIntensity ?? p.envMapIntensity ?? 1;
  if (p.vertexColors) mat.vertexColors = true;
  mat.side = p.side === 'double' ? THREE.DoubleSide : p.side === 'back' ? THREE.BackSide : typeof p.side === 'number' ? p.side : (meta.alpha ? THREE.DoubleSide : THREE.FrontSide);
  if (meta.alpha) {
    // dichte Gitter alphaTest; dünner Maschendraht geblendet (mit alphaTest verschwände er in kleinen Mip-Stufen)
    const thin = (meta.stats?.coverage ?? 1) < 0.45;
    if (thin) { mat.transparent = true; mat.depthWrite = false; mat.alphaTest = 0.02; } else mat.alphaTest = p.alphaTest ?? 0.5;
  } else if (p.alphaTest !== undefined) mat.alphaTest = p.alphaTest;
  if (p.transparent) { mat.transparent = true; mat.opacity = p.opacity ?? 1; mat.depthWrite = p.depthWrite ?? false; }
  if (p.polygonOffset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2; }
  mat.userData.libSet = `${set.id}@${set.tier}`;
  if (spec.macro !== false) applyMacroVariation(mat, spec.macro || [0.16, 0.08, 0.12]);
  // env-look (medium+): Detailnormalen, Gegen-Kachelung der Albedo, Parallaxe (ultra) – nach dem Makro-Haken
  if (spec.look) applyLook(mat, spec.look, rx, ry);
  libraryStats.materials++;
  mat.needsUpdate = true;
}

/** Bibliotheks-Materialien/-Klone früherer Karten freigeben (vor releaseUnusedTextures). → Anzahl */
function releaseLibrary() {
  let n = 0;
  const keep = new Set();
  for (const [key, m] of libCache) {
    if (m.userData.epoch === epoch) { if (m.userData.libSet) keep.add(m.userData.libSet); continue; }
    m.dispose(); libCache.delete(key); n++;
  }
  for (const [k, t] of libClones) if (!keep.has(t.userData.libSet)) { t.dispose(); libClones.delete(k); }
  return n;
}

/** Sätze ('id@stufe'), die die aktuelle Karte benutzt (world/library.js gibt die übrigen frei). */
export function libraryInUse() {
  const out = new Set();
  for (const m of libCache.values()) if (m.userData.epoch === epoch && m.userData.libSet) out.add(m.userData.libSet);
  return out;
}

// --- Weltraum-Variation (Kachelwiederholung kaschieren): eine kleine kachelbare Rauschtextur, zweimal in
// Weltkoordinaten abgetastet (≈ 23 m und ≈ 5 m), Projektion nach der Flächennormale; moduliert Albedo und Rauheit.
let macroTex = null;
function macroTexture() {
  if (macroTex) return macroTex;
  const S = 128, data = new Uint8Array(S * S * 4);
  const hash = (i, j, s) => { let n = Math.imul(i & (S - 1), 374761393) + Math.imul(j & (S - 1), 668265263) + Math.imul(s, 2246822519); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y, f, s) => {
    const fx = x * f / S, fy = y * f / S, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (a, b) => hash(((a % f) + f) % f * (S / f), ((b % f) + f) % f * (S / f), s);
    return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4;
    const fbm = (s) => vnoise(x, y, 4, s) * 0.5 + vnoise(x, y, 8, s + 1) * 0.3 + vnoise(x, y, 16, s + 2) * 0.2;
    data[o] = fbm(1) * 255; data[o + 1] = fbm(7) * 255; data[o + 2] = (vnoise(x, y, 32, 13) * 0.6 + vnoise(x, y, 16, 17) * 0.4) * 255; data[o + 3] = 255;
  }
  macroTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  macroTex.wrapS = macroTex.wrapT = THREE.RepeatWrapping;
  macroTex.magFilter = THREE.LinearFilter; macroTex.minFilter = THREE.LinearMipmapLinearFilter; macroTex.generateMipmaps = true;
  macroTex.name = 'np:macro';
  macroTex.needsUpdate = true;
  return macroTex;
}

function applyMacroVariation(mat, amp) {
  const u = { npMacroTex: { value: macroTexture() }, npMacro: { value: new THREE.Vector3(amp[0], amp[1], amp[2]) } };
  mat.userData.npMacro = u.npMacro.value;
  // über den Haken-Verteiler (world/shading.js): verträgt sich mit dem Welt-Shading und wird bei erneutem Füllen
  // nur ausgetauscht, nicht doppelt angehängt
  addShaderPatch(mat, 'macro', macroPatch(u));
}

const _macroPatches = new WeakMap();
function macroPatch(u) {
  // je Uniform-Satz eine Funktion (gleiche Funktion = kein erneutes Kompilieren)
  let fn = _macroPatches.get(u);
  if (fn) return fn;
  fn = (shader) => {
    Object.assign(shader.uniforms, u);
    ensureWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D npMacroTex;\nuniform vec3 npMacro;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 npN = abs( normalize( vNpNormal ) );
        vec2 npP = npN.y > 0.6 ? vNpWorld.xz : ( npN.x > npN.z ? vNpWorld.zy : vNpWorld.xy );
        vec4 npA = texture2D( npMacroTex, npP * 0.043 );
        vec4 npB = texture2D( npMacroTex, npP * 0.19 + 0.37 );
        diffuseColor.rgb *= clamp( 1.0 + ( npA.r - 0.5 ) * 2.0 * npMacro.x + ( npB.g - 0.5 ) * 2.0 * npMacro.y, 0.55, 1.45 );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp( roughnessFactor + ( npB.b - 0.5 ) * 2.0 * npMacro.z, 0.04, 1.0 );`);
  };
  _macroPatches.set(u, fn);
  return fn;
}

// --- env-look: Detailnormalen (nah, nach Entfernung ausgeblendet), Gegen-Kachelung (zweite, gedrehte Albedo-
// Abtastung, über Weltraum-Rauschen eingeblendet) und günstige Parallaxe (ultra; Höhe = AO-Kanal der ORM-Karte,
// Fugen/Mörtel liegen tiefer). spec.look = { detail: Stärke, ds: Detailmaßstab (1/m), anti: 0..1, pom: Tiefe (m),
// fade: [m0, m1] } – library.js setzt es je Stufe (low: nie). Eine geteilte 256²-Detailkarte (≈ 0,35 MB GPU).
let detailTex = null;
function detailTexture() {
  if (detailTex) return detailTex;
  const S = 256, H = new Float32Array(S * S), data = new Uint8Array(S * S * 4);
  const hash = (i, j, s) => { let n = Math.imul(i & (S - 1), 374761393) + Math.imul(j & (S - 1), 668265263) + Math.imul(s, 2246822519); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y, f, s) => {
    const fx = x * f / S, fy = y * f / S, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (a, b) => hash(((a % f) + f) % f * (S / f), ((b % f) + f) % f * (S / f), s);
    return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy;
  };
  // Körnung (feine Oktaven) + vereinzelte Poren/Kerben
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let h = vnoise(x, y, 16, 3) * 0.35 + vnoise(x, y, 32, 5) * 0.3 + vnoise(x, y, 64, 9) * 0.22 + vnoise(x, y, 128, 11) * 0.13;
    if (hash(x, y, 21) > 0.985) h -= 0.35;
    H[y * S + x] = h;
  }
  const at = (x, y) => H[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), o = (y * S + x) * 4;
    data[o] = (-dx / l * 0.5 + 0.5) * 255; data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; data[o + 2] = (1 / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  detailTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.magFilter = THREE.LinearFilter; detailTex.minFilter = THREE.LinearMipmapLinearFilter; detailTex.generateMipmaps = true;
  detailTex.anisotropy = anisotropy;
  detailTex.name = 'np:detail';
  detailTex.needsUpdate = true;
  return detailTex;
}

/** Geteilte Detailnormalen-Karte (Gelände-Splat nutzt sie ebenfalls; nur medium+ anfordern). */
export function getDetailNormalTexture() { return detailTexture(); }

function applyLook(mat, look, rx, ry) {
  const pom = look.pom ? look.pom * Math.max(rx, ry) : 0; // Tiefe in Textur-Einheiten
  const u = {
    npDetailTex: { value: detailTexture() }, npLookNoise: { value: macroTexture() },
    npLook: { value: new THREE.Vector4(look.detail ?? 0, look.ds ?? 1.5, look.anti ?? 0, pom) },
    npLookFade: { value: new THREE.Vector3(look.fade?.[0] ?? 6, look.fade?.[1] ?? 28, look.pomFade ?? 14) },
  };
  mat.userData.npLook = u.npLook.value;
  // eigener Schlüssel für die Parallaxe-Variante (anderer Shader-Text → anderer Programm-Schlüssel)
  addShaderPatch(mat, pom ? 'look-pom' : 'look', lookPatch(u, !!pom));
}

const _lookPatches = new Map();
function lookPatch(u, pom) {
  // je Uniform-Satz eine Funktion (gleiche Funktion = kein erneutes Kompilieren)
  const key = u;
  let fn = _lookPatches.get(key);
  if (fn) return fn;
  fn = (shader) => {
    Object.assign(shader.uniforms, u);
    ensureWorldVaryings(shader);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D npDetailTex;\nuniform sampler2D npLookNoise;\nuniform vec4 npLook;\nuniform vec3 npLookFade;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        if ( npLook.z > 0.0 ) {
          vec2 npRuv = mat2( 0.8139, -0.5810, 0.5810, 0.8139 ) * vMapUv * 0.87 + vec2( 0.37, 0.61 );
          float npAb = smoothstep( 0.38, 0.62, texture2D( npLookNoise, vNpWorld.xz * 0.061 + vNpWorld.y * 0.031 ).g ) * npLook.z;
          vec3 npS1 = texture2D( map, vMapUv ).rgb, npS2 = texture2D( map, npRuv ).rgb;
          diffuseColor.rgb *= mix( vec3( 1.0 ), ( npS2 + 0.03 ) / ( npS1 + 0.03 ), npAb );
        }
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float npDd = length( vViewPosition );
          float npDf = npLook.x * ( 1.0 - smoothstep( npLookFade.x, npLookFade.y, npDd ) );
          if ( npDf > 0.003 ) {
            vec3 npAn = abs( normalize( vNpNormal ) );
            vec3 npT = vec3( 1.0, 0.0, 0.0 ), npB = vec3( 0.0, 0.0, 1.0 ); vec2 npDp = vNpWorld.xz;
            if ( npAn.y <= 0.6 ) { if ( npAn.x > npAn.z ) { npDp = vNpWorld.zy; npT = vec3( 0.0, 0.0, 1.0 ); } else { npDp = vNpWorld.xy; } npB = vec3( 0.0, 1.0, 0.0 ); }
            vec3 npDn = texture2D( npDetailTex, npDp * npLook.y ).xyz * 2.0 - 1.0;
            vec3 npVT = normalize( ( viewMatrix * vec4( npT, 0.0 ) ).xyz ), npVB = normalize( ( viewMatrix * vec4( npB, 0.0 ) ).xyz );
            normal = normalize( normal + ( npVT * npDn.x + npVB * npDn.y ) * npDf );
          }
        }`);
    if (pom) {
      // Parallaxe: alle Karten-UVs (Albedo, Normalen, ORM) über eine globale, vor main() verschobene Koordinate
      fs = fs.replace('void main() {', `
        #if defined( USE_MAP ) && defined( USE_AOMAP ) && defined( USE_NORMALMAP )
        vec2 npRawUv() { return vMapUv; }
        vec2 npPom( vec2 uv ) {
          float dist = length( vViewPosition );
          if ( dist > npLookFade.z || npLook.w <= 0.0 ) return uv;
          vec3 q0 = dFdx( -vViewPosition ), q1 = dFdy( -vViewPosition );
          vec2 st0 = dFdx( uv ), st1 = dFdy( uv );
          vec3 N = normalize( vNormal ) * ( gl_FrontFacing ? 1.0 : -1.0 );
          vec3 q1p = cross( q1, N ), q0p = cross( N, q0 );
          vec3 T = q1p * st0.x + q0p * st1.x, B = q1p * st0.y + q0p * st1.y;
          if ( max( dot( T, T ), dot( B, B ) ) <= 0.0 ) return uv;
          vec3 V = normalize( vViewPosition );
          vec3 Vt = vec3( dot( V, normalize( T ) ), dot( V, normalize( B ) ), dot( V, N ) );
          float n = mix( 12.0, 5.0, clamp( Vt.z, 0.0, 1.0 ) );
          vec2 dUv = -Vt.xy / max( Vt.z, 0.25 ) * npLook.w / n;
          float dl = 1.0 / n, layer = 0.0;
          vec2 cuv = uv;
          float d = 1.0 - textureGrad( aoMap, cuv, st0, st1 ).r;
          for ( int i = 0; i < 12; i++ ) {
            if ( layer >= d || float( i ) >= n ) break;
            cuv += dUv; layer += dl;
            d = 1.0 - textureGrad( aoMap, cuv, st0, st1 ).r;
          }
          vec2 puv = cuv - dUv;
          float after = d - layer, before = ( 1.0 - textureGrad( aoMap, puv, st0, st1 ).r ) - ( layer - dl );
          vec2 res = mix( cuv, puv, clamp( after / ( after - before + 1e-5 ), 0.0, 1.0 ) );
          return mix( res, uv, smoothstep( npLookFade.z * 0.6, npLookFade.z, dist ) );
        }
        vec2 npUvP;
        #define vMapUv npUvP
        #define vNormalMapUv npUvP
        #define vRoughnessMapUv npUvP
        #define vMetalnessMapUv npUvP
        #define vAoMapUv npUvP
        #define NP_POM 1
        #endif
        void main() {
        #ifdef NP_POM
          npUvP = npPom( npRawUv() );
        #endif`);
    }
    shader.fragmentShader = fs;
  };
  _lookPatches.set(key, fn);
  return fn;
}

// ---------------------------------------------------------------------------
// Albedo-Schätzung je Material (Sonden-Gitter: Farbe des Sonnen-Rückpralls)
// ---------------------------------------------------------------------------
const _albCache = new WeakMap();
const _ac = new THREE.Color();
/** Mittlere lineare Grundfarbe [r, g, b] eines Materials (Farbe × mittlere Textur); gecacht je Material + Satz. */
export function materialAlbedo(mat) {
  if (!mat) return [0.4, 0.4, 0.4];
  const key = (mat.userData?.libSet || mat.userData?.texGroup || '') + '|' + mat.color?.getHexString?.();
  const hit = _albCache.get(mat);
  if (hit && hit.key === key) return hit.v;
  let t = [0.5, 0.5, 0.5];
  const name = mat.userData?.materialName;
  const set = name ? libSets.get(name) : null;
  if (set && set.meta?.stats?.avgColor) { _ac.set(set.meta.stats.avgColor); t = [_ac.r, _ac.g, _ac.b]; }
  else if (mat.userData?.texGroup) { const g = texCache.get(mat.userData.texGroup); if (g?.avg) t = g.avg; }
  else if (!mat.map) t = [1, 1, 1];
  const c = mat.color || _ac.setRGB(1, 1, 1);
  const v = [Math.min(1, c.r * t[0]), Math.min(1, c.g * t[1]), Math.min(1, c.b * t[2])];
  _albCache.set(mat, { key, v });
  return v;
}

/** Mittelwert einer sRGB-RGBA-Albedo (Stichprobe) → linear. */
function averageAlbedo(arr) {
  const toLin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(4, Math.floor(arr.length / 4 / 4096) * 4);
  for (let i = 0; i + 3 < arr.length; i += step) { r += toLin(arr[i]); g += toLin(arr[i + 1]); b += toLin(arr[i + 2]); n++; }
  return n ? [r / n, g / n, b / n] : [0.5, 0.5, 0.5];
}

/**
 * Erzeugt die Texturen der genannten Materialien vorab – parallel in Web Workern, wenn möglich,
 * sonst im Hauptthread mit kurzen Pausen. onProgress(anteil 0..1, gruppenname).
 */
export async function preloadMaterials(names, onProgress) {
  const all = [...new Set([...names.map(n => MATS[n]?.tex).filter(Boolean), ...pendingGroups])];
  for (const t of all) touch(texCache.get(t));
  const groups = all.filter(t => !texCache.has(t) || texCache.get(t).pending);
  if (!groups.length) { onProgress?.(1, ''); return; }
  const t0 = performance.now();
  let done = 0;
  const workers = getPool();
  if (workers) {
    const queue = groups.slice();
    try {
      await Promise.all(workers.map(async w => {
        while (queue.length) {
          const name = queue.shift();
          const ready = () => texCache.has(name) && !texCache.get(name).pending;
          if (ready()) { done++; continue; }
          const data = await runInWorker(w, name, sizeFor(name));
          if (!ready()) makeTexGroup(name, data);
          done++;
          onProgress?.(done / groups.length, name);
        }
      }));
      textureStats.ms += performance.now() - t0;
      onProgress?.(1, '');
      clearTimeout(poolIdleTimer);
      poolIdleTimer = setTimeout(terminatePool, POOL_IDLE_MS);
      return;
    } catch (e) {
      // Worker nicht nutzbar (z. B. file://, CSP) → Hauptthread
      poolFailed = true;
      terminatePool();
    }
  }
  for (const name of groups) {
    if (!texCache.has(name) || texCache.get(name).pending) buildTexGroupNow(name);
    done++;
    onProgress?.(done / groups.length, name);
    await new Promise(r => setTimeout(r, 0));
  }
  onProgress?.(1, '');
}

/** Normalmap des Wassers (für die animierte Wasserfläche). */
export function getWaterNormalMap() {
  const g = texGroup('water');
  return g.normalMap;
}

// ---------------------------------------------------------------------------
// UV-Helfer
// ---------------------------------------------------------------------------
/**
 * Weltskalierte Box-Projektion: 1 UV-Einheit = scale Meter. Projiziert jede Ecke nach der
 * dominanten Normalenachse (x → zy, y → xz, z → xy). Arbeitet auf den aktuellen Positionen
 * (vorher in Weltkoordinaten transformieren, wenn Kacheln über Objekte hinweg fortlaufen sollen).
 */
export function boxUV(geometry, scale = 1, offset = null) {
  const pos = geometry.attributes.position;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const nor = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2), inv = 1 / scale;
  const ox = offset?.x || 0, oy = offset?.y || 0, oz = offset?.z || 0;
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
    let u, v;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }
    else if (ay >= az) { u = x; v = ny > 0 ? -z : z; }
    else { u = nz > 0 ? x : -x; v = y; }
    uv[i * 2] = u * inv; uv[i * 2 + 1] = v * inv;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
