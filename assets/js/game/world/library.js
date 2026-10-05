// NULLPUNKT — Fotoscan-Assets der Karten (Owner: world): ordnet die Materialnamen des MapBuilders
// (engine/textures.js) KTX2-PBR-Sätzen der Asset-Bibliothek zu, lädt Sätze, Requisiten (glb) und das HDRI der Karte
// parallel (assets/lib/loader.js) und baut die Umgebungsbeleuchtung (PMREM) aus dem HDRI – ohne Sonnen-Hotspot und
// auf den Sonnenazimut der Karte gedreht. Fällt KTX2/Transcoder aus oder dauert der Download zu lange, bleibt
// alles prozedural (gleiche Kollision, Navigation, Oberflächen).
//
// createWorldAssets(G, def, quality) → handle:
//   await handle.check()                 → bool (Bibliothek nutzbar: Manifest + Transcoder + Kompressionsformat)
//   handle.planMaterials()               → Plan für textures.planLibraryMaterials (vor def.build)
//   handle.load({ names, models }, onProgress) → Promise (alle geplanten Sätze/Modelle abgeschlossen oder Zeitlimit)
//   handle.hdri                          → Promise<{ envRT, background, rotation, … } | null>
//   handle.stats                         → { download, gpu, sets, models, hdri, ms, failed, tier }
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assets, tierFor, pickTier } from '../../../lib/loader.js';

// ---------------------------------------------------------------------------
// Zuordnung Spielmaterial → Bibliothekssatz
// ---------------------------------------------------------------------------
// color: Kalibrierfaktor auf die (linearen) Fotoscan-Albedos. Viele Scans sind dunkler gemessen als reale
// Oberflächen (z. B. Betonboden Ø 0,09); die Faktoren bringen sie auf die Helligkeit, auf die Licht/Belichtung der
// Karten abgestimmt sind (gemessen gegen die prozeduralen Sätze, tools/out/world-materials/albedo.mjs), ohne den
// Fotocharakter (Flecken, Fugen, Rost) zu verlieren. Einfärbbare Sätze (container, metal_painted, canvas …):
// Farbe kommt aus Materialparameter bzw. Vertexfarbe. repeat: fester Wert für „fit“-UVs (0..1 je Fläche).
// macro: [Albedo groß, Albedo mittel, Rauheit] der Weltraum-Variation (false = aus).
export const LIB_MATERIALS = {
  concrete: { id: 'concrete_floor_worn', color: 1.7 },
  concrete_dark: { id: 'concrete_wall_dark', color: 1.35 },
  concrete_panel: { id: 'concrete_panels', color: 1.5 },
  concrete_dirty: { id: 'concrete_dirty', color: 1.0 },
  concrete_painted: { id: 'concrete_painted_peeling', color: 1.0 },
  asphalt: { id: 'asphalt_cracked', color: 0.85, macro: [0.18, 0.1, 0.14] },
  plaster_warm: { id: 'plaster_beige', color: 2.1 },
  plaster_white: { id: 'plaster_white', color: 1.7 },
  plaster_peeling: { id: 'plaster_white_peeling', color: 1.15 },
  plaster_blue: { id: 'plaster_blue_weathered', color: 1.05 },
  plaster_damaged: { id: 'plaster_damaged_brick', color: 1.1 },
  plaster_patched: { id: 'plaster_worn_patched', color: 1.3 },
  brick: { id: 'brick_factory', color: 1.55 },
  brick_dark: { id: 'brick_dark', color: 2.0 },
  stone_wall: { id: 'sandstone_blocks', color: 1.0 },
  cobble: { id: 'cobblestone', color: 0.85 },
  paving: { id: 'paving_flagstone', color: [1.45, 1.6, 1.75] }, // Weißabgleich Richtung Kalkstein
  roof_tiles: { id: 'roof_clay_tiles', color: 0.95 },
  wood_planks: { id: 'wood_planks', color: 1.35 },
  wood_dark: { id: 'wood_planks_dark', color: 0.8 },
  wood_crate: { id: 'wood_crate', color: 0.95, repeat: 1, macro: false },
  wood_weathered: { id: 'wood_planks_weathered', color: 1.2 },
  wood_peeling: { id: 'wood_peeling_paint', color: 1.2 },
  wood_floor: { id: 'wood_floor_old', color: 1.2 },
  osb: { id: 'osb', color: 0.9 },
  bark_palm: { id: 'bark_palm', color: 0.8, macro: false },
  cardboard: { id: 'cardboard', color: 0.75, repeat: 1, macro: false },
  metal_painted: { id: 'metal_painted', color: 1.35, macro: [0.1, 0.08, 0.1] },
  metal_rust: { id: 'metal_rust_painted', color: 0.75 },
  metal_corrugated: { id: 'metal_corrugated', color: 3.0 },
  metal_corrugated_rust: { id: 'metal_corrugated_rusty', color: 1.6 },
  metal_cladding: { id: 'metal_cladding_green', color: 1.0 },
  metal_shutter: { id: 'metal_shutter', color: 1.0 },
  metal_galvanized: { id: 'metal_galvanized', color: 1.1, macro: [0.08, 0.06, 0.1] },
  metal_tread: { id: 'metal_tread', color: 2.4 },
  metal_grate: { id: 'metal_grate', color: 2.4, macro: false },
  chainlink: { id: 'chainlink', color: 1.0, macro: false },
  hazard: { id: 'hazard_stripes', color: 1.3 },
  container: { id: 'container', color: 1.6, macro: [0.1, 0.06, 0.1] },
  container_red: { id: 'container', color: 1.6, macro: [0.1, 0.06, 0.1] },
  container_blue: { id: 'container', color: 1.6, macro: [0.1, 0.06, 0.1] },
  container_green: { id: 'container', color: 1.6, macro: [0.1, 0.06, 0.1] },
  container_orange: { id: 'container', color: 1.6, macro: [0.1, 0.06, 0.1] },
  container_gray: { id: 'container', color: 1.6, macro: [0.1, 0.06, 0.1] },
  sand: { id: 'sand', color: 1.6, macro: [0.2, 0.1, 0.1] },
  dirt: { id: 'dirt', color: 1.25, macro: [0.2, 0.1, 0.1] },
  mud: { id: 'mud', color: 1.2 },
  ground_dry: { id: 'ground_dry_cracked', color: 1.0 },
  gravel: { id: 'gravel', color: 0.6, macro: [0.18, 0.1, 0.12] },
  rubble: { id: 'rubble', color: 0.8 },
  grass: { id: 'grass', color: 1.1, macro: [0.22, 0.12, 0.1] },
  tiles: { id: 'tiles_worn', color: 3.0 },
  tiles_terracotta: { id: 'tiles_terracotta', color: 3.4 },
  tiles_pattern: { id: 'tiles_checker', color: 2.1 },
  tiles_white: { id: 'tiles_white_wall', color: 1.0, macro: [0.06, 0.04, 0.06] },
  linoleum: { id: 'linoleum', color: 1.0 },
  sandbag: { id: 'burlap', color: 1.35, metalness: 0, macro: false },
  tarp: { id: 'canvas', color: 1.0, macro: false },
  rubber: { id: 'rubber', color: 0.6, macro: false },
  rubber_floor: { id: 'rubber_floor', color: 1.6 },
  epoxy: { id: 'concrete_epoxy', color: [2.07, 2.52, 2.29], macro: [0.06, 0.04, 0.08] },
  epoxy_blue: { id: 'concrete_epoxy', color: [1.2, 1.78, 2.38], macro: [0.06, 0.04, 0.08] },
  panel_wall: { id: 'felt_panel', color: 1.15, macro: false },
};

/** Zeitlimit für Downloads je Stufe (s): danach prozedural weiter (langsames Netz). */
const LOAD_TIMEOUT = { low: 25, medium: 30, high: 35, ultra: 40 };

const SKY_TIER = { low: 512, medium: 1024, high: 1024, ultra: 1024 };

let hdrLoader = null;
/** Von der Welt geladene Bibliotheks-IDs (Sätze, Modelle, HDRIs) – nur diese gibt releaseOthers() frei (andere
 * Module wie Waffen oder Figuren dürfen denselben Loader nutzen). */
const worldOwned = new Set();
const hdr = () => (hdrLoader ||= new HDRLoader().setDataType(THREE.HalfFloatType));

/** Bytes einer Datei aus dem Manifest (Download-Statistik). */
const fileBytes = (f, k) => f?.sizes?.[k] || 0;

/**
 * Asset-Verwaltung einer Karte (eine Instanz je loadWorld).
 * @param {object} G Spielkontext (renderer)
 * @param {object} def Kartendefinition (def.assets: { hdri, materials: {name: id|spec|false}, exclude: [], models: [] })
 * @param {string} quality low|medium|high|ultra
 */
export function createWorldAssets(G, def, quality) {
  const renderer = G.renderer?.renderer || G.renderer;
  const cfg = def.assets || {};
  const q = ['low', 'medium', 'high', 'ultra'].includes(quality) ? quality : 'high';
  const t0 = performance.now();
  const stats = {
    tier: { texture: tierFor(q, 'texture'), model: tierFor(q, 'model'), hdri: tierFor(q, 'hdri') },
    download: 0, gpu: { desktop: 0, mobile: 0 }, sets: 0, models: 0, hdri: null, ms: 0, failed: [], formats: [],
    available: false, reason: '',
  };
  const sets = new Map();     // libId → Promise<TextureSet|null>
  const models = new Map();   // modelId → Promise<template|null>
  let available = null;

  /** Bibliothek nutzbar? (Manifest, WebAssembly, Renderer; low ohne Kompressionsformat → prozedural, Speicher) */
  async function check() {
    if (available !== null) return available;
    available = false;
    try {
      if (cfg.disabled || G.params?.get?.('lib') === '0') { stats.reason = 'abgeschaltet'; return false; }
      if (!renderer?.isWebGLRenderer || typeof WebAssembly !== 'object') { stats.reason = 'kein WebGL2/WebAssembly'; return false; }
      assets.setRenderer(renderer);
      await assets.ready();
      stats.formats = assets.compressionSupport();
      const compressed = stats.formats.some(f => ['etc2', 'etc1', 'astc', 'dxt', 'bptc', 'pvrtc', 's3tc'].includes(f));
      if (!compressed && q === 'low') { stats.reason = 'keine komprimierten Texturen (Speicher)'; return false; }
      available = true;
    } catch (err) {
      stats.reason = String(err?.message || err);
      available = false;
    }
    stats.available = available;
    return available;
  }

  /** Plan Spielname → spec (mit Stufe), Kartenzuordnung überschreibt die Standardtabelle. */
  function planMaterials() {
    const plan = new Map();
    if (!available) return plan;
    const man = assets.manifest;
    const over = cfg.materials || {};
    const names = new Set([...Object.keys(LIB_MATERIALS), ...Object.keys(over)]);
    for (const name of names) {
      if (cfg.exclude?.includes(name)) continue;
      let spec = over[name] !== undefined ? over[name] : LIB_MATERIALS[name];
      if (spec === false || spec == null) continue;
      if (typeof spec === 'string') spec = { ...(LIB_MATERIALS[name] || {}), id: spec };
      else if (over[name]) spec = { ...(LIB_MATERIALS[name] || {}), ...over[name] };
      const e = man?.textures?.[spec.id];
      if (!e) continue;
      const tier = pickTier(e.tiers, stats.tier.texture);
      const calib = JSON.stringify([spec.color, spec.roughness, spec.metalness, spec.normalScale, spec.repeat, spec.macro, spec.aoMapIntensity, spec.envMapIntensity]);
      // low (Handy): keine Weltraum-Variation im Shader (2 Texturabfragen je Pixel gespart)
      if (q === 'low') spec = { ...spec, macro: false };
      plan.set(name, { ...spec, tier, sizeM: e.sizeM?.[0], key: `${spec.id}@${tier}:${calib}${q === 'low' ? ':lo' : ''}` });
    }
    return plan;
  }

  function loadSet(id, tier) {
    const k = `${id}@${tier}`;
    if (!sets.has(k)) {
      const e = assets.manifest.textures[id], f = e.tiers[pickTier(e.tiers, tier)];
      worldOwned.add(id);
      sets.set(k, assets.loadTextureSet(id, tier).then((s) => {
        stats.sets++;
        for (const kk of ['albedo', 'normal', 'orm']) { stats.download += fileBytes(f, kk); stats.gpu.desktop += f.gpuFiles?.[kk]?.desktop || 0; stats.gpu.mobile += f.gpuFiles?.[kk]?.mobile || 0; }
        return s;
      }, (err) => { stats.failed.push(`tex:${id}: ${err?.message || err}`); return null; }));
    }
    return sets.get(k);
  }

  function loadModel(id) {
    if (!models.has(id)) {
      const e = assets.manifest.models[id];
      if (!e) { models.set(id, Promise.resolve(null)); return models.get(id); }
      const tier = pickTier(e.tiers, stats.tier.model), f = e.tiers[tier];
      worldOwned.add(id);
      models.set(id, loadModelTemplate(id, tier, f).then((t) => {
        stats.models++; stats.download += f.bytes || 0; stats.gpu.desktop += f.gpu?.desktop || 0; stats.gpu.mobile += f.gpu?.mobile || 0;
        return t;
      }, (err) => { stats.failed.push(`model:${id}: ${err?.message || err}`); return null; }));
    }
    return models.get(id);
  }

  /**
   * Sätze (für die genutzten Spielnamen) und Modelle laden. Fortschritt onProgress(0..1, label).
   * → { sets: Map spielName → TextureSet|null, models: Map id → template|null, timedOut }
   */
  async function load({ names = [], plan = new Map(), models: modelIds = [] } = {}, onProgress) {
    const out = { sets: new Map(), models: new Map(), timedOut: false };
    if (!available) { for (const n of names) out.sets.set(n, null); for (const id of modelIds) out.models.set(id, null); return out; }
    stats.libNames = names.filter(n => plan.has(n));
    stats.procNames = names.filter(n => !plan.has(n));
    stats.modelIds = [...modelIds];
    const jobs = [];
    const got = new Map(); // abgeschlossene Aufträge: 'tex:<name>' | 'model:<id>' → Ergebnis
    for (const n of names) {
      const spec = plan.get(n);
      if (!spec) continue;
      jobs.push(loadSet(spec.id, spec.tier).then(v => { got.set('tex:' + n, v); }));
    }
    for (const id of modelIds) jobs.push(loadModel(id).then(v => { got.set('model:' + id, v); }));
    let done = 0;
    const total = jobs.length || 1;
    for (const p of jobs) p.then(() => { done++; try { onProgress?.(done / total, `Fotoscans ${done}/${total}`); } catch { /* UI */ } });
    const limit = (LOAD_TIMEOUT[q] || 30) * 1000;
    let timer = 0;
    const timeout = new Promise(r => { timer = setTimeout(() => { out.timedOut = true; r(); }, limit); });
    await Promise.race([Promise.all(jobs), timeout]);
    clearTimeout(timer);
    // Was bis zum Zeitlimit nicht da ist, bleibt prozedural (der Download läuft im Hintergrund weiter und landet
    // im Cache des Loaders – die nächste Karte/Revanche nutzt ihn)
    for (const n of names) out.sets.set(n, got.get('tex:' + n) || null);
    for (const id of modelIds) out.models.set(id, got.get('model:' + id) || null);
    if (out.timedOut) stats.failed.push('Zeitlimit');
    stats.ms = Math.round(performance.now() - t0);
    return out;
  }

  // HDRI: sofort starten (unabhängig von der Kartengeometrie)
  let hdriPromise = null;
  function loadHdri(sun) {
    if (hdriPromise) return hdriPromise;
    hdriPromise = (async () => {
      if (!(await check()) || !cfg.hdri) return null;
      const e = assets.manifest.hdris[cfg.hdri];
      if (!e) return null;
      worldOwned.add(cfg.hdri);
      try {
        const tier = pickTier(e.tiers, stats.tier.hdri);
        // Drehung: Sonnenazimut des HDRIs auf den der Karte (Schattenrichtung) legen
        const rotation = THREE.MathUtils.degToRad((e.sun?.azimuthDeg ?? 0) - (sun?.azimuth ?? e.sun?.azimuthDeg ?? 0));
        const skyTier = pickTier(e.tiers, SKY_TIER[q] || 1024);
        const wantSky = def.lighting?.sky?.hdri !== false;
        const [envRT, bg] = await Promise.all([
          buildEnvironment(renderer, e, tier, rotation, def.lighting?.env?.hdriMax, def.lighting?.env?.hdriTint),
          wantSky ? assets.loadHDRI(cfg.hdri, renderer, { pmrem: false, tier: skyTier, skyTier }) : Promise.resolve(null),
        ]);
        const f = e.tiers[tier], fb = e.tiers[skyTier];
        stats.download += fileBytes(f, 'hdr') + (bg ? fileBytes(fb, 'background') : 0);
        const envBytes = envRT.width * envRT.height * 8; // RGBA16F
        stats.gpu.desktop += envBytes + (bg ? fb.gpuParts?.background?.desktop || 0 : 0);
        stats.gpu.mobile += envBytes + (bg ? fb.gpuParts?.background?.mobile || 0 : 0);
        stats.hdri = { id: cfg.hdri, tier, skyTier: bg ? skyTier : null, rotationDeg: +THREE.MathUtils.radToDeg(rotation).toFixed(1) };
        return {
          id: cfg.hdri, meta: e, envRT, background: bg?.background || null, backgroundExposure: e.backgroundExposure || 1, rotation,
          /** Nach Kontextverlust neu aufbauen (Datei kommt aus dem HTTP-Cache). */
          rebuildEnv: () => buildEnvironment(renderer, e, tier, rotation, def.lighting?.env?.hdriMax, def.lighting?.env?.hdriTint),
          dispose() { envRT.dispose(); bg?.dispose?.(); },
        };
      } catch (err) {
        stats.failed.push(`hdri:${cfg.hdri}: ${err?.message || err}`);
        return null;
      }
    })();
    return hdriPromise;
  }

  /** Nach dem Aufbau: Bibliotheks-Assets früherer Karten freigeben, die diese Karte nicht nutzt. */
  async function releaseOthers(usedSets, usedModels) {
    if (!available) return 0;
    const keep = new Set([...usedSets].map(k => k.split('@')[0]));
    for (const id of usedModels) keep.add(id);
    if (cfg.hdri) keep.add(cfg.hdri);
    let n = 0;
    for (const id of [...worldOwned]) {
      if (keep.has(id)) continue;
      await assets.dispose(id); worldOwned.delete(id); n++;
    }
    for (const k of [...modelTemplates.keys()]) if (!keep.has(k.split('@')[0])) modelTemplates.delete(k);
    return n;
  }

  /** IDs aller Modelle im Manifest (für MapBuilder.hasModel). */
  function modelIds() { return new Set(Object.keys(assets.manifest?.models || {})); }

  return { check, planMaterials, load, loadHdri, releaseOthers, modelIds, stats, get available() { return available; } };
}

// ---------------------------------------------------------------------------
// HDRI → PMREM (Sonne gedeckelt, auf den Kartenazimut gedreht)
// ---------------------------------------------------------------------------
/**
 * Lädt das .hdr der Stufe, begrenzt die Leuchtdichte (die Sonne beleuchtet als gerichtetes Licht mit Schatten –
 * im Umgebungslicht wäre sie doppelt und ein Hotspot auf Metallen) und verschiebt die Spalten um die Drehung.
 * → WebGLRenderTarget (PMREM, cubeUV)
 */
async function buildEnvironment(renderer, entry, tier, rotation, maxLum, tintHex) {
  const tint = new THREE.Color(tintHex || '#ffffff');
  const f = entry.tiers[tier];
  const url = new URL(f.hdr, assets.baseUrl).href;
  const tex = await hdr().loadAsync(url);
  const img = tex.image, W = img.width, H = img.height, src = img.data;
  const cap = maxLum ?? Math.max(2.5, (entry.luminance?.sky || 1) * 6);
  const shift = ((Math.round((rotation / (Math.PI * 2)) * W) % W) + W) % W;
  const out = new Uint16Array(src.length);
  const fh = THREE.DataUtils.fromHalfFloat, th = THREE.DataUtils.toHalfFloat;
  let slice = performance.now();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r = fh(src[i]), g = fh(src[i + 1]), b = fh(src[i + 2]);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > cap) { const k = cap / l; r *= k; g *= k; b *= k; }
      r *= tint.r; g *= tint.g; b *= tint.b;
      // Spalte x' = x − shift: Drehung um +rotation um die y-Achse (Azimut nimmt um rotation ab)
      const o = (y * W + ((x - shift + W) % W)) * 4;
      out[o] = th(r); out[o + 1] = th(g); out[o + 2] = th(b); out[o + 3] = 15360; // 1.0
    }
    if (performance.now() - slice > 12) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
  }
  img.data = out;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(tex);
  rt.texture.name = `${entry.name || 'hdri'}:env`;
  pm.dispose();
  tex.dispose();
  return rt;
}

// ---------------------------------------------------------------------------
// Modelle: Vorlagen je LOD-Stufe und Teil (für InstancedMesh, world/libprops.js)
// ---------------------------------------------------------------------------
const modelTemplates = new Map(); // `${id}@${tier}` → Promise<template>
const LOD_SUFFIX = /_LOD\d+$/;

/**
 * → { id, tier, lods: [{ parts: Map(teil → [{ geometry, material, matrix }]) }], partBox: Map(teil → Box3), box (gesamt),
 *     lodDistances: [..], meta }
 */
function loadModelTemplate(id, tier, f) {
  const key = `${id}@${tier}`;
  if (!modelTemplates.has(key)) {
    const p = (async () => {
      const n = (f.tris?.length) || 1;
      const lods = [];
      for (let lv = 0; lv < n; lv++) {
        const grp = await assets.loadModel(id, tier, { lod: lv, castShadow: true, receiveShadow: true });
        grp.updateMatrixWorld(true);
        const parts = new Map();
        for (const child of grp.children) {
          const name = child.name.replace(LOD_SUFFIX, '');
          const list = [];
          child.traverse((o) => {
            if (!o.isMesh) return;
            list.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
          });
          if (list.length) parts.set(name, (parts.get(name) || []).concat(list));
        }
        lods.push({ parts });
      }
      // Hüllquader je Teil aus LOD0 (Kollision, Platzierung „unten Mitte“)
      const partBox = new Map(), box = new THREE.Box3(), tmp = new THREE.Box3();
      for (const [name, list] of lods[0].parts) {
        const b = new THREE.Box3();
        for (const m of list) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrix);
          b.union(tmp);
        }
        partBox.set(name, b);
        box.union(b);
      }
      const meta = assets.manifest.models[id];
      return { id, tier, lods, partBox, box, lodDistances: f.lodDistances || meta.lodDistances || [0, 12, 30], meta };
    })();
    p.catch(() => modelTemplates.delete(key));
    modelTemplates.set(key, p);
  }
  return modelTemplates.get(key);
}
