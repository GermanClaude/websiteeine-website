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
  let n = 0;
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
export function configureTextures({ size, anisotropy: an } = {}) {
  if (size && size !== texSize) {
    texSize = size;
    disposeMaterials();
  }
  if (an) {
    anisotropy = an;
    for (const t of texCache.values()) for (const k of ['map', 'normalMap', 'roughnessMap']) if (t[k]) t[k].anisotropy = an;
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
  wood_crate:        { tex: 'wood_crate', tile: 1, surface: 'wood' },
  wood_stock:        { tex: 'wood_stock', tile: 0.4, surface: 'wood', params: { roughness: 1 } },
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
    pendingGroups.delete(texName);
    textureStats.generated++;
    return ph;
  }
  const grp = {
    map: prep(data.albedo, 'albedo', true), normalMap: prep(data.normal, 'normal'), roughnessMap: prep(data.rm, 'rm'),
    hasMetal: data.hasMetal, hasAlpha: data.hasAlpha, epoch, pending: false,
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
export function isMaterialReady(name) { const d = MATS[name]; return !d || !d.tex || (texCache.has(d.tex) && !texCache.get(d.tex).pending); }

/** Anzahl gecachter Texturgruppen/Materialien (Prüfseiten, Lecktests). */
export function textureCacheInfo() { return { groups: texCache.size, materials: matCache.size, workers: pool ? pool.length : 0 }; }

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
  const key = name + '|' + JSON.stringify(opts, Object.keys(opts).sort());
  const cached = matCache.get(key);
  if (cached) { if (def.tex) touch(texCache.get(def.tex)); return cached; }

  const p = { ...(def.params || {}), ...opts };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
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
  matCache.set(key, mat);
  return mat;
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
