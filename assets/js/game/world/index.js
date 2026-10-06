// NULLPUNKT — Welt laden (Owner: world)
// loadWorld(G, mapId, { onProgress }) → World (siehe docs/ARCHITECTURE.md §6)
import * as THREE from 'three';
import { buildColliderOctreeAsync } from './collider.js';
import { TriangleBVH } from './bvh.js';
import { MAPS } from '../../shared/maps.data.js';
import { configureTextures, getMaterial, beginTextureEpoch, releaseUnusedTextures, deferTextureGeneration, planLibraryMaterials, resolveLibraryMaterials, libraryInUse, libraryStats } from '../engine/textures.js';
import { createWorldAssets } from './library.js';
import { MapBuilder, SURFACES } from './builder.js';
import { createLighting, sunVector } from './lighting.js';
import { applyWorldShading, initShading, resetShading, setShadingMode, shadingMode, bindShadingScene, watchScene, WS } from './shading.js';
import { createProbeQuery, PROBE_TIERS, PROBE_BOUNCE_SCALE } from './probes.js';
import { createAtmosphere } from './atmos.js';
import { resolveConditions, applyConditions } from './weather.js';
import { createWater } from './water.js';
import { navFromData, validateNavGraph } from './navgraph.js';
import { createMinimap } from './minimap.js';
import { foliageUniforms } from './atlas.js';

const MAP_MODULES = {
  hafen: () => import('./maps/hafen.js'),
  altstadt: () => import('./maps/altstadt.js'),
  werk: () => import('./maps/werk.js'),
  range: () => import('./maps/range.js'),
};

/** Großkarten (MAPS[id].scale === 'gross'): eigener Lader, nur per import() (GROSSKAMPF_PLAN §12.5). */
const BIG_MAPS = new Set(['grenzland']);

export const MAP_IDS = [...Object.keys(MAP_MODULES), ...BIG_MAPS];

/**
 * Blickrichtung eines Startpunkts: bevorzugt `preferred` (Kartenvorgabe bzw. Richtung Kartenmitte), weicht aber
 * aus, wenn dort auf Augenhöhe nach wenigen Metern eine Wand steht. 16 Richtungen, je drei Strahlen (±4°) bis 30 m;
 * Wertung = freie Sicht (bis 15 m voll) ×2 + Nähe zur bevorzugten Richtung. Yaw 0 = −Z.
 */
const SPAWN_DIRS = 16, SPAWN_FAN = 0.07, SPAWN_RANGE = 30, SPAWN_EYE = 1.6;
function openYaw(bvh, pos, preferred, hit) {
  const clear = (yaw) => {
    let d = SPAWN_RANGE;
    for (const off of [-SPAWN_FAN, 0, SPAWN_FAN]) {
      const a = yaw + off, dx = -Math.sin(a), dz = -Math.cos(a);
      if (bvh.raycast(pos.x, pos.y + SPAWN_EYE, pos.z, dx, 0, dz, SPAWN_RANGE, hit)) d = Math.min(d, hit.t);
    }
    return d;
  };
  const score = (yaw, d) => Math.min(1, d / 15) * 2 + (1 + Math.cos(yaw - preferred)) / 2;
  let best = preferred, bestScore = score(preferred, clear(preferred));
  if (bestScore >= 3 - 1e-6) return preferred; // Vorgabe hat ≥ 15 m freie Sicht
  for (let i = 0; i < SPAWN_DIRS; i++) {
    const yaw = preferred + (i / SPAWN_DIRS) * Math.PI * 2;
    const s = score(yaw, clear(yaw));
    if (s > bestScore + 1e-6) { bestScore = s; best = yaw; }
  }
  return Math.atan2(Math.sin(best), Math.cos(best));
}

/**
 * Rechenintensiven Teil (BVHs, Startpunkte einrasten, Navigationsgraph) im Welt-Worker ausführen; ohne Worker
 * (file://, CSP, sehr alte Browser) im Hauptthread. onStage(label) meldet den Abschnitt.
 */
let jobSeq = 0;
function runWorldJob(job, onStage) {
  return new Promise((resolve, reject) => {
    let worker = null, settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; worker?.terminate(); fn(v); };
    const fallback = () => {
      if (settled) return;
      worker?.terminate(); worker = null;
      import('./worldgen.js').then(({ buildWorldData }) => new Promise(r => setTimeout(r, 0)).then(() => {
        try { done(resolve, buildWorldData(job, onStage)); } catch (err) { done(reject, err); }
      }), err => done(reject, err));
    };
    try {
      if (typeof Worker === 'undefined') throw new Error('keine Worker');
      worker = new Worker(new URL('./worldgen.worker.js', import.meta.url), { type: 'module' });
    } catch { worker = null; fallback(); return; }
    const id = ++jobSeq;
    worker.onmessage = (e) => {
      const d = e.data || {};
      if (d.id !== id) return;
      if (d.stage) { try { onStage?.(d.stage); } catch { /* UI */ } return; }
      if (d.error) done(reject, new Error(d.error)); else done(resolve, d.result);
    };
    worker.onerror = (e) => { e.preventDefault?.(); fallback(); };
    // Kopie senden (strukturierter Klon): die Originale bleiben für den Rückfall/Octree im Hauptthread
    worker.postMessage({ ...job, id });
  });
}

/** Alle Texturen der Weltmaterialien vorab auf die GPU laden (renderer.initTexture), mit Pausen alle ~10 ms. */
async function uploadTextures(renderer, root) {
  if (!renderer || typeof renderer.initTexture !== 'function') return 0;
  const t0 = performance.now();
  const seen = new Set();
  root.traverse(o => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) if (m[k]?.isTexture) seen.add(m[k]);
  });
  let slice = performance.now();
  for (const tex of seen) {
    try { renderer.initTexture(tex); } catch { /* wird beim ersten Bild nachgeholt */ }
    if (performance.now() - slice > 10) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
  }
  return Math.round(performance.now() - t0);
}

async function fontsReady() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const t = new Promise(r => setTimeout(r, 1200));
  try { await Promise.race([Promise.all([document.fonts.load('800 64px "Archivo NP"'), document.fonts.load('700 32px "JetBrains Mono NP"')]), t]); } catch { /* egal */ }
}

/**
 * Welt-Shading einschalten (nach dem Aufbau, vor dem ersten Bild): Haken an alle Materialien der Weltgruppe, Sonden-
 * Texturen + Gewichte, Fernkaskade rendern (statische Geometrie, alle Requisiten sichtbar). → Statistik
 */
function activateLighting(G, def, world, group, light, probes, quality, debug) {
  const t0 = performance.now();
  const L = def.lighting, pc = L.probes || {};
  const materials = applyWorldShading(group);
  // nur während die Weltszene rendert aktiv (Viewmodel-Szene bleibt neutral); weitere Objekte der Szene (Figuren,
  // Fahrzeuge …) bekommen den Haken beim Hinzufügen
  world._unbindShading = bindShadingScene(G.scene);
  world._sceneWatch = watchScene(G.scene);
  const out = { materials, probes: null, far: null, ms: 0 };
  if (probes) {
    const P = probes.data, s = P.spacing;
    WS.npProbeA.value = probes.texA; WS.npProbeB.value = probes.texB;
    WS.npProbeMin.value.set(P.min[0], P.min[1], P.min[2]);
    WS.npProbeSize.value.set(P.dims[0] * s, P.dims[1] * s, P.dims[2] * s);
    WS.npProbeRes.value.set(P.dims[0], P.dims[1], P.dims[2]);
    WS.npProbeCell.value = s;
    // Rückprall: Sonnenbestrahlung × Verstärkung × Codierfaktor (Shader quadriert den gespeicherten Wert)
    const sun = new THREE.Color(L.sun.color).multiplyScalar(L.sun.intensity * (pc.bounce ?? 1) * PROBE_BOUNCE_SCALE);
    WS.npBounce.value.copy(sun);
    // Lichtgruppen (Gewichte je Lampe stecken schon im Gitter: gebacken bzw. nur Rückprall)
    const gGain = pc.groupGain ?? 1;
    let anyGroup = false;
    P.groups.forEach((g, i) => {
      WS.npGroups.value[i].set(g.color[0], g.color[1], g.color[2]).multiplyScalar(g.max * gGain);
      if (g.max > 0) anyGroup = true;
    });
    WS.npProbe.value.set(WS.npProbe.value.x, pc.skyMin ?? 0.035, pc.specOcc ?? 0.9, anyGroup && gGain > 0 ? 1 : 0);
    setShadingMode({ probe: 1 });
    light.setProbeSun(true);
    out.probes = { dims: P.dims, spacing: s, bytes: probes.bytes, ...P.stats };
  } else {
    setShadingMode({ probe: 0 });
    light.setProbeSun(false);
  }
  setShadingMode({ specAA: L.specAA ?? 1 });
  // Flackernde Lichtgruppen (Feuer, defekte Röhren): Grundwerte merken, world.update moduliert
  world._flicker = probes ? (pc.flicker || []).filter(f => f.group >= 0 && f.group < 3).map(f => ({ ...f, base: WS.npGroups.value[f.group].clone(), t: Math.random() * 10 })) : [];
  const farOk = light.bakeFar();
  if (light.farShadow) out.far = { active: farOk, ...light.farShadow.stats };
  out.ms = Math.round(performance.now() - t0);
  if (debug) console.info(`[world] ${world.id}: Welt-Shading ${materials} Materialien, Fernkaskade ${farOk ? light.farShadow.stats.size.join('×') + ' (' + light.farShadow.stats.ms + ' ms)' : 'aus'}`);
  return out;
}

/**
 * Lädt eine Karte, fügt world.group zu G.scene hinzu und liefert das World-Objekt.
 * @param {object} G Spielkontext (benötigt scene, renderer; camera optional)
 * @param {string} mapId 'hafen' | 'altstadt' | 'werk' | 'range'
 * @param {{ onProgress?: (p:number, label:string)=>void }} [opts]
 */
export async function loadWorld(G, mapId, opts = {}) {
  const { onProgress } = opts;
  // atmosphere-weather: Wetter/Tageszeit (opts.weather/opts.time; sonst URL weather=/tod= – Prüfseiten)
  const condReq = { weather: 'weather' in opts ? opts.weather : G.params?.get?.('weather'), time: 'time' in opts ? opts.time : G.params?.get?.('tod') };
  if (BIG_MAPS.has(mapId) && MAPS[mapId]?.scale === 'gross') return (await import('./terrain/bigworld.js')).loadBigWorld(G, mapId, { onProgress, ...condReq });
  const t0 = performance.now();
  const id = MAP_MODULES[mapId] ? mapId : 'hafen';
  const meta = MAPS[id];
  const progress = (p, label) => { try { onProgress?.(Math.min(1, Math.max(0, p)), label || ''); } catch { /* UI-Fehler ignorieren */ } };
  progress(0, 'Karte wird vorbereitet');

  const renderer = G.renderer?.renderer || G.renderer;
  const quality = G.renderer?.quality || G.settings?.get?.('quality') || 'high';
  const debug = !!(G.debug || G.params?.get?.('debug') === '1');
  const lowTex = quality === 'low';
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
  configureTextures({ size: lowTex ? 256 : 512, anisotropy: Math.min(lowTex ? 2 : 8, maxAniso) });
  beginTextureEpoch(); // Texturen, die diese Karte nicht nutzt, werden am Ende freigegeben

  const [{ default: def0 }] = await Promise.all([MAP_MODULES[id](), fontsReady()]);
  const conditions = resolveConditions(meta, condReq);
  const def = applyConditions(def0, conditions, id); // Standard = def0 unverändert
  // Fotoscan-Bibliothek (assets/lib): Verfügbarkeit prüfen (Manifest, Transcoder, Kompressionsformat), HDRI sofort
  // laden; Texturensätze und Requisiten lädt MapBuilder.build() parallel zur prozeduralen Arbeit (b.library)
  const lib = createWorldAssets(G, def, quality);
  const libOk = await lib.check();
  const hdriPromise = lib.loadHdri(def.lighting?.sun);
  const libPlan = libOk ? lib.planMaterials() : null;
  planLibraryMaterials(libPlan);
  const tBuild0 = performance.now();
  const pb = def.bounds;
  const cb = def.visualBounds || { minX: pb.minX - 30, maxX: pb.maxX + 30, minZ: pb.minZ - 30, maxZ: pb.maxZ + 30 };
  const b = new MapBuilder({ bounds: cb, seed: def.seed || 1, chunkSize: def.chunkSize || 32, groundNoise: def.groundNoise ?? 0.14, interiorTint: def.interiorTint });
  // Sonden-Gitter (R5): Innenräume werden über das gebackene Himmels-/Rückprall-Licht dunkel – das alte gebackene
  // Innenraumlicht (Vertexfarbe, dunkelt auch das Sonnenlicht durch Fenster) bleibt nur noch als leichte Tönung
  const probeCfg = def.lighting?.probes || {};
  const probesOn = G.params?.get?.('probes') !== '0' && probeCfg.enabled !== false;
  if (probesOn) b.interiorScale = probeCfg.interior ?? 0.3;
  if (libOk) {
    b.lib = lib.modelIds();
    b.library = async (req, onProg) => {
      const r = await lib.load({ ...req, plan: libPlan }, onProg);
      resolveLibraryMaterials(r.sets);
      return r;
    };
  }
  const waters = [];
  const ctx = {
    THREE, quality, debug, getMaterial, lib: libOk,
    water: o => { const w = createWater(o); waters.push(w); return w; },
  };
  b.lookQuality = quality; // env-look: Detailformen (Sandsäcke) ab medium
  // Texturen, die Requisiten direkt anfordern (Kran, Wasser …), nicht sofort im Hauptthread erzeugen:
  // Platzhalter jetzt, Daten gesammelt im Worker-Pool während b.build() (preloadMaterials)
  deferTextureGeneration(true);
  let res, built;
  try {
    res = def.build(b, ctx) || {};
    progress(0.05, 'Geometrie');
    built = await b.build({ quality, anisotropy: Math.min(G.renderer?.preset?.anisotropy || 4, maxAniso), onProgress: (p, l) => progress(p * 0.8, l) });
  } finally {
    if (!b.library) resolveLibraryMaterials(new Map());
    deferTextureGeneration(false);
  }
  const tBuild = performance.now() - tBuild0;

  const group = new THREE.Group();
  group.name = 'world:' + id;
  group.add(built.group);
  for (const w of waters) group.add(w.mesh);

  // Rechenintensives (Kollisions-/Kugel-BVH, Startpunkte, Navigationsgraph) im Welt-Worker; parallel dazu im
  // Hauptthread: Kapsel-Octree (in Zeitscheiben) und Licht/Himmel (PMREM auf der GPU)
  const center = new THREE.Vector3((pb.minX + pb.maxX) / 2, 0, (pb.minZ + pb.maxZ) / 2);
  const spawnSrc = [];
  for (const team of ['A', 'B', 'ffa']) for (const s of res.spawns?.[team] || []) spawnSrc.push({ team, s });
  const domSrc = res.objectives?.dom || [];
  const pt = (p, yHint) => ({ x: p.x ?? p[0], z: p.z ?? p[2] ?? p[1], y: p.y ?? yHint, fallbackY: p.y ?? 0 });
  const points = [...spawnSrc.map(({ s }) => pt(s, 0.4)), ...domSrc.map(o => pt(o, 0.4))];
  const tJob0 = performance.now();
  const stageP = { Kollision: 0.86, 'Kugel-BVH': 0.88, Navigation: 0.9, Licht: 0.92 };
  // Zwei Worker parallel: Kollision → Startpunkte → Navigation | Kugel-BVH → Sonden-Gitter (Licht + Akustik)
  const sunDir = sunVector(def.lighting.sun.elevation, def.lighting.sun.azimuth);
  const probeTier = PROBE_TIERS[quality] ? quality : 'high';
  const probeBounds = {
    minX: pb.minX - (probeCfg.margin ?? 8), maxX: pb.maxX + (probeCfg.margin ?? 8),
    minZ: pb.minZ - (probeCfg.margin ?? 8), maxZ: pb.maxZ + (probeCfg.margin ?? 8),
    minY: Math.max(pb.minY ?? -3, -3), maxY: (pb.maxY ?? 24) + 2,
  };
  const linColor = (c) => { const k = new THREE.Color(c || '#ffd7a0'); return [k.r, k.g, k.b]; };
  // Lichtgruppen: 0 warm (Glühlampe/Natrium), 1 kalt (Leuchtstoff), 2 farbig (Notlicht, Feuer) – oder L.group
  const groupOf = (L) => {
    if (Number.isInteger(L.group)) return Math.max(0, Math.min(2, L.group));
    const hsl = new THREE.Color(L.color || '#ffd7a0').getHSL({ h: 0, s: 0, l: 0 });
    const hue = hsl.h * 360;
    if (hsl.s > 0.35 && (hue < 14 || hue > 300)) return 2;   // Rot (Notlicht) / Magenta
    if (hsl.s < 0.2 || (hue > 150 && hue < 260)) return 1;   // kaltweiß / bläulich (Leuchtstoff)
    return 0;                                                 // warm (Glühlampe, Natrium)
  };
  const jobCol = runWorldJob({
    parts: ['col'], colTris: built.colTris, points,
    nav: {
      bounds: { ...pb, minY: pb.minY ?? -3, maxY: pb.maxY ?? 30 },
      points: b.navPoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
      exclude: b.navExclude,
      spacing: def.navSpacing || 1.5,
      seeds: spawnSrc.map((e, i) => (e.team === 'ffa' ? -1 : i)).filter(i => i >= 0),
    },
  }, stage => progress(stageP[stage] ?? 0.86, stage));
  const jobBullet = runWorldJob({
    parts: ['bullet'], bulletTris: built.bulletTris, bulletData: built.bulletData,
    probes: probesOn ? {
      bounds: probeBounds, tier: probeTier, spacing: probeCfg.spacing?.[probeTier], scatter: probeCfg.scatter,
      sunDir: [sunDir.x, sunDir.y, sunDir.z], albedo: built.bulletAlbedo,
      // Gewicht: ohne Echtzeit-Licht (low bzw. realtime: false) trägt das Gitter das Lampenlicht (gerichtet gemittelt),
      // mit Echtzeit-Licht nur die weiche Aufhellung durch Rückprall
      lights: (built.lightDefs || []).filter(L => L.bake !== false).map(L => ({
        x: L.x, y: L.y, z: L.z, color: linColor(L.color), intensity: L.intensity ?? 10, distance: L.distance ?? 12, group: groupOf(L),
        w: quality === 'low' || L.realtime === false ? (probeCfg.groupsBaked ?? 0.55) : (probeCfg.groupsBounce ?? 0.2),
      })),
    } : null,
  }, stage => progress(stageP[stage] ?? 0.88, stage));
  const jobPromise = Promise.all([jobCol, jobBullet]).then(([a, c]) => ({ ...a, ...c, ms: { ...a.ms, ...c.ms } }));
  progress(0.82, 'Kollision');

  // Kollision (Octree für Kapseln) – begrenzte Tiefe, Zeitscheiben
  const tCol0 = performance.now();
  const collider = await buildColliderOctreeAsync(built.colTris);
  const tCol = performance.now() - tCol0;

  // Licht & Himmel (HDRI der Karte, falls geladen – sonst prozeduraler Himmel)
  const hdri = await hdriPromise;
  const tLight0 = performance.now();
  initShading(renderer);
  const light = createLighting(G, def.lighting, group, {
    hdri, heightFog: true,
    // Fernkaskade über Spielfeld + Rand; bewegte Objekte (Kran, Ziele …) bleiben draußen
    far: {
      bounds: { ...probeBounds, minY: Math.min(probeBounds.minY, -1) },
      exclude: () => [...b.objects.filter(o => o.update).map(o => o.object), ...(res.dynamic || [])],
      prepare: () => built.props?.showAll(),
    },
  });
  const tLight = performance.now() - tLight0;
  G.scene.add(group);
  // Kartenbelichtung (z. B. Dämmerung etwas heller) + Bloom-Schwelle/-Stärke – nur wenn der Renderer das anbietet
  const postKeys = { exposure: def.lighting.exposure, bloomThreshold: def.lighting.bloom?.threshold, bloomStrength: def.lighting.bloom?.strength };
  const postSet = Object.fromEntries(Object.entries(postKeys).filter(([, v]) => Number.isFinite(v)));
  const prevPost = G.renderer?.post || {};
  const postRestore = Object.fromEntries(Object.keys(postSet).map(k => [k, prevPost[k]]).filter(([, v]) => Number.isFinite(v)));
  if (typeof G.renderer?.setPost === 'function') G.renderer.setPost(postSet);

  // Ergebnis des Welt-Workers: BVHs übernehmen (ohne Neuaufbau), Startpunkte am Boden, Navigationsgraph
  const job = await jobPromise;
  const tJob = performance.now() - tJob0;
  const bvh = TriangleBVH.fromData(job.bullet), cbvh = TriangleBVH.fromData(job.col);
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
  const spawns = { A: [], B: [], ffa: [] };
  spawnSrc.forEach(({ team, s }, i) => {
    const position = new THREE.Vector3(points[i].x, job.snapped[i], points[i].z);
    const toCenter = Math.atan2(-(center.x - position.x), -(center.z - position.z));
    spawns[team].push({ position, yaw: openYaw(bvh, position, s.yaw ?? toCenter, hit) });
  });
  const objectives = {
    dom: domSrc.map((o, k) => {
      const i = spawnSrc.length + k;
      return { id: o.id, position: new THREE.Vector3(points[i].x, job.snapped[i], points[i].z), radius: o.radius ?? 5 };
    }),
  };
  progress(0.95, 'Navigation');
  const nav = navFromData(job.nav, cbvh);
  // Bau-Zwischendaten lösen: Die Methoden von `world` (unten) sind Closures dieser Funktion und halten deren
  // Variablen (b, built, job …) so lange wie die Welt. Dreieckslisten für Worker/Octree und die rohen Nav-Daten
  // werden nicht mehr gebraucht (die BVHs haben eigene, umsortierte Kopien); MapBuilder.build() räumt selbst auf.
  built.bulletTris = built.bulletData = built.colTris = built.bulletAlbedo = null;
  job.nav = null;

  // Sonden-Gitter → 3D-Texturen (RGBA8) für die Welt-Materialien + Abfragen (Akustik für audio, Licht für CPU-Nutzer)
  let probes = null;
  if (job.probes) {
    const P = job.probes;
    const mk = (data) => {
      const t = new THREE.Data3DTexture(data, P.dims[0], P.dims[1], P.dims[2]);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1; t.generateMipmaps = false; t.needsUpdate = true;
      return t;
    };
    const texA = mk(P.a), texB = mk(P.b);
    texA.name = 'np:sonden-licht'; texB.name = 'np:sonden-sonne';
    const query = createProbeQuery(P);
    probes = { data: P, texA, texB, query, stats: P.stats, bytes: P.a.length + P.b.length };
    if (debug) console.info(`[world] ${id}: Sonden-Gitter ${P.dims.join('×')} (${P.spacing} m), ${P.stats.traced} Zellen verfolgt, ${P.stats.rays} Strahlen, ${P.stats.invalid} in Geometrie, ${job.ms.probes} ms`, P.stats.ms);
  } else if (job.probesError) console.warn('[world] Sonden-Gitter: ' + job.probesError);
  if (debug) {
    const rep = validateNavGraph(nav, { spawns, objectives }, nav.removed);
    nav.report = rep;
    const s = nav.stats;
    console.info(`[world] ${id}: Navigationsgraph ${s.nodes} Knoten, ${s.links} Verbindungen (${s.drops} Absprünge), ${s.cover} Deckungspunkte, ${s.removed} unerreichbare Punkte entfernt, ${s.ms} ms`);
    for (const p of rep.problems) console.warn('[world] Navigation: ' + p);
    // Startpunkte/Flaggen frei? (Kapsel 0,35 m: waagerechte Strahlen in 0,6 und 1,4 m Höhe gegen die Kollision)
    const blocked = [];
    const probe = (p, label) => {
      for (const hy of [0.6, 1.4]) for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (cbvh.raycast(p.x, p.y + hy, p.z, Math.cos(a), 0, Math.sin(a), 0.33, hit)) { blocked.push(`${label} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`); return; }
      }
    };
    for (const t of ['A', 'B', 'ffa']) spawns[t].forEach((s, i) => probe(s.position, `Start ${t}${i}`));
    for (const o of objectives.dom) probe(o.position, `Flagge ${o.id}`);
    for (const p of blocked) console.warn('[world] blockiert: ' + p);
  }

  // Atmosphäre: Sonnenstrahlen durch Öffnungen in dunkle Innenräume + schwebender Staub (je Kartenstimmung)
  let atmos = null;
  try {
    atmos = createAtmosphere(G, { quality, def: def.lighting, sunDir, openings: b.openings, bvh, probes: probes?.query || null, sun: light.lighting.sun, bounds: pb });
    group.add(atmos.group);
  } catch (err) { console.warn('[world] Atmosphäre:', err); }
  b.openings = [];

  // Minikarte
  progress(0.95, 'Minikarte');
  const minimap = createMinimap({ footprints: b.footprints, zones: res.zones || [], bounds: pb, size: 512 });

  // Ziele (Schießstand) – dynamische Trefferboxen
  const targets = res.targets || [];
  const tmpM = new THREE.Matrix4(), tmpO = new THREE.Vector3(), tmpD = new THREE.Vector3(), box = new THREE.Box3(), ray = new THREE.Ray(), hitP = new THREE.Vector3();

  const bounds = new THREE.Box3(new THREE.Vector3(pb.minX, pb.minY ?? -3, pb.minZ), new THREE.Vector3(pb.maxX, pb.maxY ?? 30, pb.maxZ));
  const objects = built.objects;
  const props = built.props;

  let sweepT = 0;
  const camPos = new THREE.Vector3(), camLast = new THREE.Vector3(1e9, 0, 0), camLight = { sky: 1, sun: 1, bounce: [0, 0, 0] };
  const world = {
    id, name: meta.name, meta,
    group,
    collider,
    bounds,
    spawns,
    objectives,
    nav,
    lighting: light.lighting,
    /** Farbstimmung/Belichtung für core-render (`renderer.setMood(world.grade || mapId)`): Karten-`grade` über der Stimmung der Karte. */
    grade: def.grade ? { mood: id, ...def.grade } : undefined,
    /** Wetter/Tageszeit (world/weather.js): { weather, time (null = Kartenzeit), key, isDefault } */
    weather: conditions,
    minimap,
    ambience: def.ambience || meta.ambience,
    targets,
    stats: { ...built.stats, buildMs: Math.round(tBuild), colliderMs: Math.round(tCol), lightMs: Math.round(tLight), jobMs: Math.round(tJob), worker: job.ms, totalMs: 0, nav: nav.stats, assets: lib.stats, lighting: null },
    /** Sonden-Gitter (R5): { dims, spacing, min, light(x, y, z) → { sky, sun, bounce[3] }, sample(…) } oder null. */
    probes: probes ? probes.query : null,
    /**
     * Akustik je Ort (A2, für audio): sample(x, y, z, out?) → { indoor 0..1, ceiling m|Infinity, meanFree m,
     * openness 0..1, walls number[8] (m; 0 = +X, gegen den Uhrzeigersinn um +Y in 45°-Schritten; Infinity = frei),
     * absorb 0..1 }. null ohne Gitter (dann misst audio selbst per world.raycast).
     */
    acoustics: probes ? { sample: probes.query.sample, dims: probes.query.dims, spacing: probes.query.spacing } : null,
    /** Welt-Shading (Sonden, Fernschatten, Höhennebel, spekulares AA) auf weitere Materialien anwenden (bots, effects …). */
    shading: { apply: applyWorldShading, uniforms: WS },
    /**
     * Licht-Bausteine einzeln schalten (Prüfseiten, Kostenmessung): set({ probes, far, fog, specAA, beams, dust } als
     * bool) → state(). Aus = Verhalten wie ohne diese Arbeit (z. B. far: aus → außerhalb der Nahkaskade besonnt).
     */
    lightfx: {
      _on: null,
      set(o = {}) {
        const on = this._on || (this._on = { probe: shadingMode('probe'), far: shadingMode('far'), fog: shadingMode('fog'), specAA: shadingMode('specAA') });
        const m = {};
        if (o.probes !== undefined) m.probe = o.probes ? on.probe : 0;
        if (o.far !== undefined) m.far = o.far ? on.far : 0;
        if (o.fog !== undefined) m.fog = o.fog ? on.fog : 0;
        if (o.specAA !== undefined) m.specAA = o.specAA ? on.specAA : 0;
        setShadingMode(m);
        if (atmos) for (const c of atmos.group.children) {
          if (c.name === 'sonnenstrahlen' && o.beams !== undefined) c.visible = !!o.beams;
          if (c.name === 'staub' && o.dust !== undefined) c.visible = !!o.dust;
        }
        return this.state();
      },
      state() {
        const beams = atmos?.group.children.find(c => c.name === 'sonnenstrahlen'), dust = atmos?.group.children.find(c => c.name === 'staub');
        return { probes: shadingMode('probe') > 0, far: shadingMode('far'), fog: shadingMode('fog') > 0, specAA: shadingMode('specAA') > 0, beams: !!beams?.visible, dust: !!dust?.visible };
      },
    },
    debugData: { colliderBVH: cbvh, bulletBVH: bvh, footprints: b.footprints, navPoints: b.navPoints, zones: res.zones || [] },

    /**
     * Kugel-Raycast gegen sichtbare Geometrie (+ Ziele). dir muss normiert sein.
     * @returns {{distance, point, normal, surface, object, targetId?, zone?} | null}
     */
    raycast(origin, dir, maxDist = 1000) {
      let best = null;
      if (bvh.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, hit)) {
        best = {
          distance: hit.t,
          point: new THREE.Vector3(origin.x + dir.x * hit.t, origin.y + dir.y * hit.t, origin.z + dir.z * hit.t),
          normal: new THREE.Vector3(hit.nx, hit.ny, hit.nz),
          surface: SURFACES[hit.data & 255] || 'concrete',
          object: objects[hit.data >>> 8] || null,
        };
      }
      for (const t of targets) {
        if (!t.hittable()) continue;
        for (const hb of t.hitboxes) {
          // Strahl in lokales System der Trefferbox
          tmpM.copy(hb.object.matrixWorld).invert();
          tmpO.copy(origin).applyMatrix4(tmpM);
          tmpD.copy(dir).transformDirection(tmpM);
          ray.set(tmpO, tmpD);
          box.set(hb.min, hb.max);
          if (!ray.intersectBox(box, hitP)) continue;
          hitP.applyMatrix4(hb.object.matrixWorld);
          const d = hitP.distanceTo(origin);
          if (d > maxDist || (best && d >= best.distance)) continue;
          best = {
            distance: d, point: hitP.clone(), normal: dir.clone().negate(), surface: t.surface || 'metal',
            object: hb.object, targetId: t.id, zone: hb.zone,
          };
        }
      }
      return best;
    },

    /** Freie Sicht zwischen zwei Punkten (Kugel-Geometrie). */
    lineOfSight(a, b2) {
      const dx = b2.x - a.x, dy = b2.y - a.y, dz = b2.z - a.z, l = Math.hypot(dx, dy, dz);
      if (l < 1e-4) return true;
      return !bvh.occluded(a.x, a.y, a.z, dx / l, dy / l, dz / l, l - 0.02);
    },

    /** Oberfläche unter einem Punkt (Schrittgeräusche). */
    surfaceAt(p) {
      if (bvh.raycast(p.x, p.y + 0.3, p.z, 0, -1, 0, 2.5, hit)) return SURFACES[hit.data & 255] || 'concrete';
      return def.defaultSurface || 'concrete';
    },

    /** Strahl gegen die Kollisionsgeometrie (Kapseln): { distance, normal } | null (physics.collisionRay, Überklettern). */
    collisionRaycast(origin, dir, maxDist = 100) {
      if (!cbvh.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, hit)) return null;
      return { distance: hit.t, normal: new THREE.Vector3(hit.nx, hit.ny, hit.nz) };
    },
    collisionBVH: cbvh,

    /** Bodenhöhe unter (x, z) ab yFrom abwärts (Kollisionsgeometrie) oder null. */
    groundHeight(x, z, yFrom = 30) {
      return cbvh.raycast(x, yFrom, z, 0, -1, 0, yFrom + 20, hit) ? yFrom - hit.t : null;
    },

    update(dt, camera) {
      light.update(dt, camera);
      atmos?.update(dt, camera);
      // Höhennebel: Streulicht an der Kamera nach Himmelssicht der Sonden (drinnen kein heller Außendunst)
      if (probes && camera) {
        const c = camera.getWorldPosition ? camera.getWorldPosition(camPos) : camera.position;
        const sky = Math.min(1, probes.query.light(c.x, c.y, c.z, camLight).sky * 1.6);
        // Sprung (Teleport, Respawn) sofort übernehmen, sonst weich nachführen
        const jump = camLast.distanceToSquared(c) > 4;
        camLast.copy(c);
        WS.npFogCam.value = jump ? sky : WS.npFogCam.value + (sky - WS.npFogCam.value) * Math.min(1, dt * 2.5);
      }
      for (const f of world._flicker || []) {
        f.t += dt * (f.speed || 8);
        const n = 0.55 * Math.sin(f.t) + 0.3 * Math.sin(f.t * 2.31 + 1.7) + 0.15 * Math.sin(f.t * 5.17 + 0.4);
        WS.npGroups.value[f.group].copy(f.base).multiplyScalar(Math.max(0, 1 - (f.amount ?? 0.3) * (0.5 + 0.5 * n)));
      }
      // Sicherheitsnetz für tief eingehängte neue Materialien (z. B. Waffenwechsel an der Hand einer Figur)
      if ((sweepT += dt) > 2) { sweepT = 0; world._sceneWatch?.sweep(); }
      foliageUniforms.uTime.value += dt;
      for (const w of waters) w.update(dt);
      props?.update(camera);
      for (const ob of b.objects) ob.update?.(dt, camera);
      for (const t of targets) t.update?.(dt);
      res.update?.(dt, camera);
    },

    /** Schattenqualität an ein Renderer-Preset anpassen (folgt Qualitätswechseln automatisch). */
    setQuality(preset = {}) { light.setShadowQuality({ preset }); },

    dispose() {
      G.scene.remove(group);
      props?.dispose();
      group.traverse(o => {
        if (o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine) {
          if (o.userData.shared) return; // Bibliotheks-Requisiten: Geometrie/Material gehören dem Loader-Cache
          o.geometry?.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if (m && m.userData?.disposable) m.dispose();
        }
      });
      // Schilder-Atlas gehört zur Karte
      for (const m of [built.signMesh?.material]) if (m) { m.map?.dispose(); m.dispose(); }
      group.traverse(o => { if (o.isMesh && o.name === 'signs-lit') o.material.dispose(); });
      for (const w of waters) w.dispose();
      for (const L of built.lights) L.dispose?.();
      light.dispose();
      hdri?.dispose();
      world._sceneWatch?.stop();
      world._unbindShading?.();
      resetShading();
      atmos?.dispose();
      probes?.texA.dispose(); probes?.texB.dispose();
      offQuality?.();
      if (typeof G.renderer?.setPost === 'function') G.renderer.setPost(postRestore);
      res.dispose?.();
      collider.clear?.();
    },
  };
  // Qualitätswechsel zur Laufzeit: Schattenkarte/-kaskade mitziehen
  const offQuality = typeof G.renderer?.onQualityChange === 'function' ? G.renderer.onQualityChange((q, preset) => world.setQuality(preset)) : null;
  // Kartenspezifische Aktionen (z. B. Ziele) mit Weltzugriff verdrahten
  res.attach?.(world, G);
  // Texturen vorheriger Karten, die hier nicht vorkommen, freigeben (GPU + Daten); danach Bibliotheks-Assets
  // (Sätze, Modelle, HDRIs) anderer Karten
  world.stats.texturesReleased = releaseUnusedTextures();
  world.stats.assets.released = await lib.releaseOthers(libraryInUse(), new Set(b.modelIdsUsed || []));
  world.stats.assets.libMaterials = libraryStats.materials;
  world.stats.assets.fallbackMaterials = libraryStats.fallback;
  // Requisiten einmal vollständig sichtbar (Shader-Vorwärmen im Ladebildschirm), ab dem ersten update() je Abstand
  props?.showAll();
  // Welt-Shading: alle Weltmaterialien bekommen den gemeinsamen Haken; Sonden + Fernkaskade aktivieren
  world.stats.lighting = activateLighting(G, def, world, group, light, probes, quality, debug);
  if (atmos) world.stats.lighting.atmos = atmos.stats;
  // Prüfparameter ?lightfx=0: alle Licht-Bausteine aus (Vergleichsmessungen; zusammen mit probes=0 ≈ bisheriger Look)
  if (G.params?.get?.('lightfx') === '0') world.lightfx.set({ probes: false, far: false, fog: false, beams: false, dust: false, specAA: false });
  // Texturen schon jetzt in Zeitscheiben hochladen – sonst landet alles (inkl. Mipmaps) im ersten Bild
  progress(0.97, 'Texturen hochladen');
  world.stats.uploadMs = await uploadTextures(renderer, group);
  world.stats.totalMs = Math.round(performance.now() - t0);
  if (debug) console.info(`[world] ${id}: geladen in ${world.stats.totalMs} ms (Aufbau ${world.stats.buildMs} ms), ${built.stats.meshes} Meshes, ${built.stats.triangles} Dreiecke, Kugel-BVH ${built.stats.bulletTris}, Kollision ${built.stats.colliderTris}`);
  progress(1, 'Bereit');
  return world;
}
