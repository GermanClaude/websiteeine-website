// NULLPUNKT — Laden einer Großkarte (MAPS[id].scale === 'gross') (Owner: world). Wird von world/index.js loadWorld()
// per import() nur für Großkarten geladen; liefert ein World-Objekt mit der Vertrags-API (§6) plus Großkarten-
// Ergänzungen (GROSSKAMPF_PLAN §12.2): heightAt, normalAt, inBounds, terrain, roads, vehicleSpawns,
// objectives.cq, spawns.hq, secrets, visibility, nav.findPathAsync.
//
// Ablauf: Gelände im Welt-Worker erzeugen ‖ Ortschaften mit MapBuilder bauen (je Ortschaft ein Builder, Boden bei
// y = 0 bzw. Plateauhöhe) → Gelände-Material/-Kacheln, Kulissenring, Wasser, Straßen, Vegetation → Worker: BVHs +
// Startpunkte + Navigation ‖ Licht/HDRI → Welt-Objekt.
import * as THREE from 'three';
import { MAPS } from '../../../shared/maps.data.js';
import { configureTextures, getMaterial, beginTextureEpoch, releaseUnusedTextures, deferTextureGeneration, planLibraryMaterials, resolveLibraryMaterials, libraryInUse, libraryStats } from '../../engine/textures.js';
import { createWorldAssets } from '../library.js';
import { MapBuilder, SURFACES } from '../builder.js';
import { createLighting } from '../lighting.js';
import { createWater } from '../water.js';
import { TriangleBVH } from '../bvh.js';
import { makeTests } from '../navbuild.js';
import { foliageUniforms } from '../atlas.js';
import { Heightfield } from './heightfield.js';
import { makeCoarse } from './generate.js';
import { CompositeBVH } from './composite.js';
import { TerrainCollider } from './collide.js';
import { TerrainChunks, createFarRing } from './chunks.js';
import { createTerrainMaterial } from './splat.js';
import { Vegetation } from './vegetation.js';
import { RoadNetwork } from './roads.js';
import { bigNavFromData } from './bignav.js';
import { createBigMinimap } from './bigminimap.js';
import { terrainJob, worldJob } from './bigjob.js';

const BIG_MAPS = {
  grenzland: () => import('../maps/grenzland.js'),
};
export const BIG_MAP_IDS = Object.keys(BIG_MAPS);

/** Budgets je Qualitätsstufe (GROSSKAMPF_PLAN §3.4; Handy = low). */
export const BIG_TIERS = {
  low: { view: 340, steps: [2, 4, 8, 16], dists: [56, 150, 260], treeNear: 55, treeFar: 330, grass: 12, grassStep: 1.7, grassCap: 220, treeShadow: false, density: 0.55, far: 700, mapPx: 512, siteCull: 300, shadow: 24 },
  medium: { view: 600, steps: [1, 2, 4, 8], dists: [48, 150, 330], treeNear: 90, treeFar: 580, grass: 25, grassStep: 1.4, grassCap: 1400, treeShadow: false, density: 0.8, far: 900, mapPx: 1024, siteCull: 520, shadow: 40 },
  high: { view: 850, steps: [1, 2, 4, 8], dists: [70, 200, 380], treeNear: 150, treeFar: 820, grass: 40, grassStep: 1.3, grassCap: 3200, treeShadow: true, density: 1, far: 1000, mapPx: 1024, siteCull: 760, shadow: 60 },
  ultra: { view: 850, steps: [1, 2, 4, 8], dists: [90, 240, 420], treeNear: 190, treeFar: 840, grass: 55, grassStep: 1.25, grassCap: 5600, treeShadow: true, density: 1, far: 1000, mapPx: 1024, siteCull: 800, shadow: 70 },
};

/** Gelände-/Welt-Aufträge im Worker (Rückfall: Hauptthread). */
function createRunner() {
  let worker = null, seq = 0;
  const pending = new Map();
  let broken = false;
  try {
    if (typeof Worker === 'undefined') throw new Error('keine Worker');
    worker = new Worker(new URL('./bigjob.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const d = e.data || {}, p = pending.get(d.id);
      if (!p) return;
      if (d.stage) { try { p.onStage?.(d.stage); } catch { /* UI */ } return; }
      pending.delete(d.id);
      if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result);
    };
    worker.onerror = (e) => { e.preventDefault?.(); broken = true; for (const p of pending.values()) p.reject(Object.assign(new Error('Worker'), { fallback: true })); pending.clear(); };
  } catch { worker = null; }
  let localHf = null;
  const local = async (type, payload, onStage, hfMain) => {
    await new Promise(r => setTimeout(r, 0));
    if (type === 'terrain') { const r = await terrainJob(payload.spec, onStage); localHf = r.hf; return { data: r.data, roads: r.roads, river: r.river }; }
    return worldJob(payload.job, localHf || hfMain, onStage);
  };
  return {
    get usesWorker() { return !!worker && !broken; },
    async run(type, payload, onStage, hfMain) {
      if (worker && !broken) {
        try {
          return await new Promise((resolve, reject) => {
            const id = ++seq;
            pending.set(id, { resolve, reject, onStage });
            worker.postMessage({ id, type, ...payload });
          });
        } catch (err) { if (!err?.fallback) throw err; }
      }
      return local(type, payload, onStage, hfMain);
    },
    dispose() { worker?.terminate(); worker = null; },
  };
}

async function uploadTextures(renderer, root) {
  if (!renderer || typeof renderer.initTexture !== 'function') return 0;
  const t0 = performance.now(), seen = new Set();
  root.traverse(o => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) if (m[k]?.isTexture) seen.add(m[k]);
    }
  });
  let slice = performance.now();
  for (const tex of seen) {
    try { renderer.initTexture(tex); } catch { /* beim ersten Bild */ }
    if (performance.now() - slice > 10) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
  }
  return Math.round(performance.now() - t0);
}

/** Dreiecks-Puffer zusammenfügen. */
function concatF32(list) {
  let n = 0; for (const a of list) n += a.length;
  const out = new Float32Array(n);
  let o = 0; for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}

/** Unsichtbare Randwände (Kollision) um ein Rechteck. */
function boundaryWalls(r, yMin, yMax) {
  const out = [];
  const quad = (ax, az, bx, bz) => out.push(ax, yMin, az, bx, yMin, bz, bx, yMax, bz, ax, yMin, az, bx, yMax, bz, ax, yMax, az);
  quad(r.minX, r.minZ, r.maxX, r.minZ); quad(r.maxX, r.minZ, r.maxX, r.maxZ); quad(r.maxX, r.maxZ, r.minX, r.maxZ); quad(r.minX, r.maxZ, r.minX, r.minZ);
  return new Float32Array(out);
}

/**
 * @param {object} G Spielkontext
 * @param {string} mapId Großkarten-ID (BIG_MAP_IDS)
 * @param {{ onProgress?: (p:number, label:string)=>void }} [opts]
 */
export async function loadBigWorld(G, mapId, { onProgress } = {}) {
  const t0 = performance.now();
  const id = BIG_MAPS[mapId] ? mapId : BIG_MAP_IDS[0];
  const meta = MAPS[id] || { name: id };
  const progress = (p, label) => { try { onProgress?.(Math.min(1, Math.max(0, p)), label || ''); } catch { /* UI */ } };
  progress(0, 'Karte wird vorbereitet');
  const renderer = G.renderer?.renderer || G.renderer;
  const quality = ['low', 'medium', 'high', 'ultra'].includes(G.renderer?.quality) ? G.renderer.quality : (['low', 'medium', 'high', 'ultra'].includes(G.settings?.get?.('quality')) ? G.settings.get('quality') : 'high');
  const tier = BIG_TIERS[quality];
  const debug = !!(G.debug || G.params?.get?.('debug') === '1');
  const lowTex = quality === 'low';
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
  configureTextures({ size: lowTex ? 256 : 512, anisotropy: Math.min(lowTex ? 2 : 8, maxAniso) });
  beginTextureEpoch();

  const { default: def } = await BIG_MAPS[id]();
  const runner = createRunner();
  const ms = {};
  // 1) Gelände im Worker (parallel zu den Ortschaften)
  let tT = performance.now();
  const terrainP = runner.run('terrain', { spec: def.terrain }, (s) => progress(0.04, s)).then((r) => { ms.terrain = Math.round(performance.now() - tT); return r; });
  terrainP.catch(() => { /* unten behandelt */ });

  // 2) Bibliothek + Ortschaften
  const lib = createWorldAssets(G, def, quality);
  const libOk = await lib.check();
  const hdriPromise = lib.loadHdri(def.lighting?.sun);
  const libPlan = libOk ? lib.planMaterials() : null;
  planLibraryMaterials(libPlan);
  const tB = performance.now();
  const sites = [];
  const ctx = { THREE, quality, debug, getMaterial, lib: libOk, tier };
  deferTextureGeneration(true);
  try {
    for (let k = 0; k < def.sites.length; k++) {
      const s = def.sites[k];
      const vb = { minX: s.bounds.minX - 12, maxX: s.bounds.maxX + 12, minZ: s.bounds.minZ - 12, maxZ: s.bounds.maxZ + 12 };
      const b = new MapBuilder({ bounds: vb, seed: (def.seed || 1) + k * 101, chunkSize: s.chunkSize || 32, groundNoise: s.groundNoise ?? 0.12, interiorTint: s.interiorTint });
      if (libOk) {
        b.lib = lib.modelIds();
        b.library = async (req, onProg) => { const r = await lib.load({ ...req, plan: libPlan }, onProg); resolveLibraryMaterials(r.sets); return r; };
      }
      const res = s.build(b, ctx) || {};
      const p0 = 0.06 + (k / def.sites.length) * 0.44, p1 = 0.06 + ((k + 1) / def.sites.length) * 0.44;
      const built = await b.build({ quality, anisotropy: Math.min(G.renderer?.preset?.anisotropy || 4, maxAniso), onProgress: (p, l) => progress(p0 + (p1 - p0) * p, `${s.name}: ${l}`) });
      sites.push({ def: s, b, res, built });
    }
  } finally {
    if (!libOk) resolveLibraryMaterials(new Map());
    deferTextureGeneration(false);
  }
  ms.sites = Math.round(performance.now() - tB);

  // 3) Gelände übernehmen
  progress(0.52, 'Gelände');
  const terr = await terrainP;
  const hf = Heightfield.fromData(terr.data);
  hf.riverLine = terr.river;
  const pb = def.bounds;
  const group = new THREE.Group();
  group.name = 'world:' + id;
  const tM = performance.now();
  const tLib = performance.now();
  const tmat = await createTerrainMaterial({ hf, quality, lib, libOk, getMaterial, tier: lib.stats?.tier?.texture });
  ms.terrainLib = Math.round(performance.now() - tLib);
  const chunks = new TerrainChunks(hf, tmat.material, { steps: tier.steps, dists: tier.dists, chunk: 128 });
  await chunks.build((p) => progress(0.55 + p * 0.05, 'Gelände-Kacheln'));
  const firstSpawn = def.spawns?.A?.[0] || [0, 0];
  chunks.prewarm(firstSpawn[0], firstSpawn[1], 200);
  group.add(chunks.group);
  const farRing = createFarRing(hf, makeCoarse(def.terrain), tmat.material, { radius: tier.far, step: quality === 'low' ? 32 : 20 });
  group.add(farRing);
  const water = createWater({ x0: hf.minX, z0: hf.minZ, x1: hf.maxX, z1: hf.maxZ, y: hf.waterY, color: def.water?.color || '#2c4a3e', scale: 12, roughness: 0.09 });
  water.mesh.name = 'fluss';
  group.add(water.mesh);
  ms.terrainMesh = Math.round(performance.now() - tM);

  // 4) Straßen, Vegetation
  progress(0.62, 'Straßen und Vegetation');
  const tV = performance.now();
  const footprints = sites.flatMap(s => s.b.footprints);
  const blockers = footprints.filter(f => f.kind === 'building').map(f => ({ minX: f.x - f.hw, maxX: f.x + f.hw, minZ: f.z - f.hd, maxZ: f.z + f.hd }));
  const roads = new RoadNetwork(terr.roads, hf, { blockers });
  group.add(roads.buildMeshes(getMaterial));
  // Sperrraster (2 m): Ortschaften, Straßen, Flaggen, Startpunkte → keine Bäume/Gras
  const BR = 2, bn = Math.ceil(hf.size / BR) + 1;
  const block = new Uint8Array(bn * bn);
  const mark = (x, z, r) => {
    const i0 = Math.max(0, Math.floor((x - r - hf.minX) / BR)), i1 = Math.min(bn - 1, Math.ceil((x + r - hf.minX) / BR));
    const j0 = Math.max(0, Math.floor((z - r - hf.minZ) / BR)), j1 = Math.min(bn - 1, Math.ceil((z + r - hf.minZ) / BR));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(hf.minX + i * BR - x, hf.minZ + j * BR - z) <= r) block[j * bn + i] = 1;
  };
  for (const s of def.sites) {
    const r = s.clear || s.bounds;
    for (let z = r.minZ; z <= r.maxZ; z += BR) for (let x = r.minX; x <= r.maxX; x += BR) mark(x, z, 1.5);
  }
  for (const r of roads.roads) for (let k = 0; k < r.points.length; k++) mark(r.points[k].x, r.points[k].z, r.width / 2 + 2.2);
  for (const f of [...(def.flags?.cq || []), ...(def.flags?.dom || [])]) mark(f.x, f.z, 5);
  for (const v of def.vehicles || []) mark(v.x, v.z, 7);
  for (const c of def.clearings || []) mark(c[0], c[1], c[2]);
  const blocked = (x, z) => {
    const i = Math.round((x - hf.minX) / BR), j = Math.round((z - hf.minZ) / BR);
    return i < 0 || j < 0 || i >= bn || j >= bn ? false : block[j * bn + i] === 1;
  };
  const veg = new Vegetation({ hf, spec: def.vegetation, quality, tier, blocked, bounds: pb });
  const vegCol = veg.colliders();
  group.add(veg.build(getMaterial));
  ms.vegetation = Math.round(performance.now() - tV);

  // 5) Kollision/Kugeln/Navigation im Worker
  const objects = [chunks.group];
  const colList = [], bulList = [], datList = [];
  for (const s of sites) {
    const off = objects.length;
    for (const o of s.built.objects) objects.push(o);
    colList.push(s.built.colTris);
    bulList.push(s.built.bulletTris);
    const d = new Uint32Array(s.built.bulletData.length);
    for (let i = 0; i < d.length; i++) { const v = s.built.bulletData[i]; d[i] = (v & 255) | (((v >>> 8) + off) << 8); }
    datList.push(d);
  }
  const vegObj = objects.push(veg.group) - 1;
  colList.push(vegCol.col);
  bulList.push(vegCol.bullet);
  const vd = new Uint32Array(vegCol.bullet.length / 9).fill(2 | (vegObj << 8)); // Holz/Fels: 'wood'
  datList.push(vd);
  const wallRect = { minX: pb.minX - (def.wallMargin ?? 45), maxX: pb.maxX + (def.wallMargin ?? 45), minZ: pb.minZ - (def.wallMargin ?? 45), maxZ: pb.maxZ + (def.wallMargin ?? 45) };
  colList.push(boundaryWalls(wallRect, -20, 140));
  const colTris = concatF32(colList), bulletTris = concatF32(bulList);
  const bulletData = new Uint32Array(bulletTris.length / 9);
  { let o = 0; for (const d of datList) { bulletData.set(d, o); o += d.length; } }

  // Punkte (Startpunkte, Flaggen, Fahrzeuge, Geheimnisse) auf den Boden setzen
  const pts = [];
  const addPt = (x, z, y) => { pts.push({ x, z, y: y ?? hf.heightAt(x, z) + 0.1 }); return pts.length - 1; };
  const sp = def.spawns || {};
  const spawnSrc = [];
  for (const team of ['A', 'B', 'ffa']) for (const s of sp[team] || []) spawnSrc.push({ team, s, i: addPt(s[0], s[1], s[3]) });
  const hqSrc = [];
  for (const team of ['A', 'B']) for (const s of sp.hq?.[team] || []) hqSrc.push({ team, s, i: addPt(s[0], s[1], s[3]) });
  const cqSrc = (def.flags?.cq || []).map(f => ({ f, i: addPt(f.x, f.z, f.y), sp: (f.spawns || []).map(s => addPt(s[0], s[1], s[3])) }));
  const domSrc = (def.flags?.dom || []).map(f => ({ f, i: addPt(f.x, f.z, f.y) }));
  const vehSrc = (def.vehicles || []).map(v => ({ v, i: addPt(v.x, v.z, v.y) }));
  const secSrc = (def.secrets || []).map(s => ({ s, i: addPt(s.x, s.z, s.y) }));
  const navSites = sites.filter(s => s.def.nav !== false).map(s => {
    const nb = s.def.navBounds || s.def.bounds, m = 4;
    return {
      id: s.def.id,
      bounds: { minX: nb.minX - m, maxX: nb.maxX + m, minZ: nb.minZ - m, maxZ: nb.maxZ + m, minY: (s.def.y ?? 0) - 4, maxY: (s.def.y ?? 0) + (s.def.height ?? 16) },
      points: s.b.navPoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
      exclude: [...s.b.navExclude, { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5, minY: -1e5, maxY: hf.waterY - 0.7 }],
      seeds: (s.def.seeds || [[(nb.minX + nb.maxX) / 2, (nb.minZ + nb.maxZ) / 2]]).map(q => ({ x: q[0], y: q[2] ?? (s.def.y ?? 0), z: q[1] })),
      spacing: s.def.spacing || 1.5,
    };
  });
  const seeds = [...spawnSrc, ...hqSrc].map(e => ({ x: e.s[0], z: e.s[1] })).concat(cqSrc.map(e => ({ x: e.f.x, z: e.f.z })));
  progress(0.7, 'Kollision');
  const tJ = performance.now();
  const jobP = runner.run('world', {
    job: {
      colTris, bulletTris, bulletData, terrainObject: 0, points: pts, sites: navSites, seeds,
      grid: { bounds: { minX: pb.minX - 8, maxX: pb.maxX + 8, minZ: pb.minZ - 8, maxZ: pb.maxZ + 8 }, spacing: def.navGrid || 4, exclude: navSites.map(s => ({ minX: s.bounds.minX + 3, maxX: s.bounds.maxX - 3, minZ: s.bounds.minZ + 3, maxZ: s.bounds.maxZ - 3 })) },
    },
  }, (stage) => progress({ Kollision: 0.74, 'Kugel-BVH': 0.77, Navigation: 0.8 }[stage] ?? 0.75, stage), hf);

  // Licht & Himmel parallel; Nebel nach Sichtweite der Stufe
  const tL = performance.now();
  const hdri = await hdriPromise;
  const lightDef = { ...def.lighting, fog: { ...def.lighting.fog, near: tier.view * (def.lighting.fog?.nearFactor ?? 0.16), far: tier.view }, shadow: { ...(def.lighting.shadow || {}), size: tier.shadow } };
  const light = createLighting(G, lightDef, group, { hdri });
  ms.light = Math.round(performance.now() - tL);
  for (const s of sites) group.add(s.built.group);
  G.scene.add(group);
  const postKeys = { exposure: def.lighting.exposure, bloomThreshold: def.lighting.bloom?.threshold, bloomStrength: def.lighting.bloom?.strength };
  const postSet = Object.fromEntries(Object.entries(postKeys).filter(([, v]) => Number.isFinite(v)));
  const prevPost = G.renderer?.post || {};
  const postRestore = Object.fromEntries(Object.keys(postSet).map(k => [k, prevPost[k]]).filter(([, v]) => Number.isFinite(v)));
  if (typeof G.renderer?.setPost === 'function') G.renderer.setPost(postSet);

  const job = await jobP;
  ms.job = Math.round(performance.now() - tJ);
  const usesWorker = runner.usesWorker;
  runner.dispose();
  const colBVH = TriangleBVH.fromData(job.col), bulBVH = TriangleBVH.fromData(job.bullet);
  const compCol = new CompositeBVH(hf, colBVH, { terrainObject: 0 });
  const compBul = new CompositeBVH(hf, bulBVH, { terrainObject: 0 });
  const collider = new TerrainCollider(hf, colBVH, compCol);
  progress(0.9, 'Navigation');
  const nav = bigNavFromData(job.nav, makeTests(compCol), { hf, col: colBVH });

  const V = (i, yOff = 0) => new THREE.Vector3(pts[i].x, job.snapped[i] + yOff, pts[i].z);
  const cx = (pb.minX + pb.maxX) / 2, cz = (pb.minZ + pb.maxZ) / 2;
  const yawTo = (x, z, tx = cx, tz = cz) => Math.atan2(-(tx - x), -(tz - z));
  // Startpunkte auf begehbare Fläche: liegt kein Nav-Knoten in 2,5 m, auf den nächsten Knoten setzen
  const onNav = (v) => {
    const n = nav.nearest(v);
    if (n && n.position.distanceTo(v) > 2.5) v.copy(n.position);
    return v;
  };
  /** count Startpunkte um pos (rMin…rMax) aus Nav-Knoten, möglichst weit verteilt, Blick zur Mitte. */
  const pickSpawns = (pos, count, rMin, rMax) => {
    const cand = nav.nodesInRadius(pos, rMax).filter(n => n.position.distanceTo(pos) >= rMin && Math.abs(n.position.y - pos.y) < 5 && n.links.length >= 3);
    const out = [];
    if (!cand.length) return out;
    out.push(cand[(cand.length * 0.5) | 0]);
    while (out.length < count && out.length < cand.length) {
      let best = null, bd = -1;
      for (const c of cand) { let d = Infinity; for (const o of out) d = Math.min(d, c.position.distanceToSquared(o.position)); if (d > bd) { bd = d; best = c; } }
      out.push(best);
    }
    return out.map(n => ({ position: n.position.clone(), yaw: yawTo(n.position.x, n.position.z, pos.x, pos.z) }));
  };
  const spawns = { A: [], B: [], ffa: [], hq: { A: [], B: [] } };
  for (const e of spawnSrc) spawns[e.team].push({ position: onNav(V(e.i)), yaw: e.s[2] ?? yawTo(e.s[0], e.s[1]) });
  for (const e of hqSrc) spawns.hq[e.team].push({ position: onNav(V(e.i)), yaw: e.s[2] ?? yawTo(e.s[0], e.s[1]) });
  const objectives = {
    dom: domSrc.map(e => ({ id: e.f.id, name: e.f.name, position: V(e.i), radius: e.f.radius ?? 9 })),
    cq: cqSrc.map(e => ({
      id: e.f.id, name: e.f.name, position: V(e.i), radius: e.f.radius ?? 22, heightBand: e.f.heightBand || [-3, 14],
      spawns: e.sp.length ? e.sp.map((i, k) => ({ position: onNav(V(i)), yaw: e.f.spawns[k][2] ?? yawTo(pts[i].x, pts[i].z) })) : pickSpawns(V(e.i), 8, 12, e.f.radius ? e.f.radius + 14 : 34),
    })),
  };
  // Fahrzeug-Stellplätze: `type` = VEHICLES-Schlüssel des Fahrzeug-Agenten (tank → mbt); geheime Plätze (Traktor
  // „Gertrud“) nur in vehicleSpots, damit kein unbekannter Typ automatisch erscheint
  const VTYPE = { tank: 'mbt', jeep: 'jeep' };
  const vehicleSpots = vehSrc.map(e => ({ id: e.v.id, team: e.v.team ?? null, kind: e.v.kind, type: e.v.type || VTYPE[e.v.kind] || e.v.kind, name: e.v.name || null, position: V(e.i), yaw: e.v.yaw ?? 0, secret: !!e.v.secret }));
  const vehicleSpawns = vehicleSpots.filter(v => !v.secret);
  const secrets = secSrc.map(e => ({ id: e.s.id, name: e.s.name, hint: e.s.hint || '', position: V(e.i), trigger: e.s.trigger || { type: 'proximity', radius: 2 } }));

  progress(0.93, 'Minikarte');
  const tMM = performance.now();
  const minimap = createBigMinimap({ hf, bounds: pb, size: tier.mapPx, roads: roads.roads, footprints });
  ms.minimap = Math.round(performance.now() - tMM);
  const bounds = new THREE.Box3(new THREE.Vector3(pb.minX, pb.minY ?? -8, pb.minZ), new THREE.Vector3(pb.maxX, pb.maxY ?? 90, pb.maxZ));
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
  const sitesVis = sites.map(s => {
    const r = s.def.bounds;
    return { group: s.built.group, x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2, rad: Math.hypot(r.maxX - r.minX, r.maxZ - r.minZ) / 2 + 20, props: s.built.props, objects: s.b.objects, res: s.res };
  });
  const found = new Set();
  const nOut = { x: 0, y: 1, z: 0 };
  const prevFar = G.camera?.far;

  const world = {
    id, name: meta.name || def.name, meta, scale: 'gross',
    group, collider, collisionBVH: compCol, bounds, spawns, objectives, nav, minimap,
    lighting: light.lighting,
    ambience: def.ambience || meta.ambience || 'range',
    targets: [],
    terrain: { heightfield: hf, chunks, size: hf.size, waterY: hf.waterY, material: tmat.material, source: tmat.source },
    roads, vehicleSpawns, vehicleSpots, secrets, secretsAuto: true,
    viewDistance: tier.view,
    mapImage: minimap.canvas,
    stats: {
      totalMs: 0, ms, worker: job.ms, usesWorker, quality,
      nav: nav.stats, roads: roads.stats, vegetation: veg.stats, terrain: chunks.stats, terrainSource: tmat.source,
      colliderTris: colTris.length / 9, bulletTris: bulletTris.length / 9,
      meshes: sites.reduce((n, s) => n + s.built.stats.meshes, 0), triangles: sites.reduce((n, s) => n + s.built.stats.triangles, 0),
      sites: sites.map(s => ({ id: s.def.id, meshes: s.built.stats.meshes, triangles: s.built.stats.triangles })),
      assets: lib.stats,
    },
    debugData: { colliderBVH: colBVH, bulletBVH: bulBVH, compositeCollider: compCol, compositeBullet: compBul, heightfield: hf, footprints, navPoints: sites.flatMap(s => s.b.navPoints), zones: [] },

    heightAt: (x, z) => hf.heightAt(x, z),
    normalAt: (x, z, out = new THREE.Vector3()) => { hf.normalAt(x, z, nOut); return out.set(nOut.x, nOut.y, nOut.z); },
    /** 'in' | 'warn' (bis 25 m außerhalb) | 'out' */
    inBounds(pos) {
      const d = Math.max(pb.minX - pos.x, pos.x - pb.maxX, pb.minZ - pos.z, pos.z - pb.maxZ);
      return d <= 0 ? 'in' : d <= 25 ? 'warn' : 'out';
    },

    raycast(origin, dir, maxDist = 1000) {
      let best = null;
      if (compBul.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, hit)) {
        best = {
          distance: hit.t,
          point: new THREE.Vector3(origin.x + dir.x * hit.t, origin.y + dir.y * hit.t, origin.z + dir.z * hit.t),
          normal: new THREE.Vector3(hit.nx, hit.ny, hit.nz),
          surface: SURFACES[hit.data & 255] || 'grass',
          object: objects[hit.data >>> 8] || null,
        };
      }
      // Wasseroberfläche (Fluss): Kugeln enden mit Spritzer
      if (dir.y < -1e-4 && origin.y > hf.waterY) {
        const t = (hf.waterY - origin.y) / dir.y;
        if (t < (best ? best.distance : maxDist)) {
          const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
          if (hf.contains(x, z) && hf.heightAt(x, z) < hf.waterY - 0.02) {
            best = { distance: t, point: new THREE.Vector3(x, hf.waterY, z), normal: new THREE.Vector3(0, 1, 0), surface: 'water', object: water.mesh };
          }
        }
      }
      return best;
    },
    lineOfSight(a, b2) {
      const dx = b2.x - a.x, dy = b2.y - a.y, dz = b2.z - a.z, l = Math.hypot(dx, dy, dz);
      if (l < 1e-4) return true;
      return !compBul.occluded(a.x, a.y, a.z, dx / l, dy / l, dz / l, l - 0.02);
    },
    /**
     * Sicht für die Bot-Wahrnehmung (0..1): 0 bei fester Verdeckung, sonst gedämpft durch Wald zwischen a und b
     * (Laub hält keine Kugeln auf, verdeckt aber Sicht; je ~35 m Waldstrecke → 0).
     */
    visibility(a, b2) {
      if (!world.lineOfSight(a, b2)) return 0;
      let through = 0;
      for (const f of def.vegetation?.forests || []) {
        const ex = b2.x - a.x, ez = b2.z - a.z, L2 = ex * ex + ez * ez;
        if (L2 < 1e-6) break;
        const fx = a.x - f.x, fz = a.z - f.z, R = f.r * 0.85;
        const B = fx * ex + fz * ez, C = fx * fx + fz * fz - R * R, disc = B * B - L2 * C;
        if (disc <= 0) continue;
        const s = Math.sqrt(disc), t0 = Math.max(0, (-B - s) / L2), t1 = Math.min(1, (-B + s) / L2);
        if (t1 > t0) through += (t1 - t0) * Math.sqrt(L2) * (f.density ?? 0.7);
      }
      return Math.max(0, 1 - through / 35);
    },
    surfaceAt(p) {
      if (compBul.raycast(p.x, p.y + 0.3, p.z, 0, -1, 0, 2.5, hit)) return SURFACES[hit.data & 255] || 'grass';
      return SURFACES[hf.surfaceIndexAt(p.x, p.z)] || 'grass';
    },
    collisionRaycast(origin, dir, maxDist = 100) {
      if (!compCol.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, hit)) return null;
      return { distance: hit.t, normal: new THREE.Vector3(hit.nx, hit.ny, hit.nz) };
    },
    groundHeight(x, z, yFrom = 30) {
      if (compCol.raycast(x, yFrom, z, 0, -1, 0, yFrom + 60, hit)) return yFrom - hit.t;
      const h = hf.contains(x, z) ? hf.heightAt(x, z) : null;
      return h !== null && h <= yFrom ? h : null;
    },

    update(dt, camera) {
      light.update(dt, camera);
      foliageUniforms.uTime.value += dt;
      water.update(dt);
      if (!camera) return;
      if (camera.isPerspectiveCamera && camera.far < tier.view + 60) { camera.far = tier.view + 60; camera.updateProjectionMatrix(); }
      chunks.update(camera);
      veg.update(camera);
      for (const s of sitesVis) {
        const vis = Math.hypot(camera.position.x - s.x, camera.position.z - s.z) - s.rad < tier.siteCull;
        if (s.group.visible !== vis) s.group.visible = vis;
        if (!vis) continue;
        s.props?.update(camera);
        for (const ob of s.objects) ob.update?.(dt, camera);
        s.res.update?.(dt, camera);
      }
      // Geheimnisse (Nähe) – solange kein Modus sie selbst prüft (secretsAuto)
      const pl = G.player;
      if (world.secretsAuto && pl?.alive !== false && pl?.position) {
        for (const s of secrets) {
          if (found.has(s.id) || s.trigger.type !== 'proximity') continue;
          if (pl.position.distanceTo(s.position) <= (s.trigger.radius ?? 2)) { found.add(s.id); G.events?.emit?.('secret:found', { id: s.id, name: s.name, actor: pl, map: id }); }
        }
      }
    },
    setQuality(preset = {}) { light.setShadowQuality({ preset: { ...preset, shadowExtent: Math.min(preset.shadowExtent || Infinity, tier.shadow) } }); },
    dispose() {
      G.scene.remove(group);
      if (G.camera && Number.isFinite(prevFar) && G.camera.far !== prevFar) { G.camera.far = prevFar; G.camera.updateProjectionMatrix(); }
      for (const s of sites) {
        s.built.props?.dispose();
        s.built.group.traverse(o => {
          if (o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine) {
            if (o.userData.shared) return;
            o.geometry?.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) if (m && m.userData?.disposable) m.dispose();
          }
        });
        const sm = s.built.signMesh?.material; if (sm) { sm.map?.dispose(); sm.dispose(); }
        s.built.group.traverse(o => { if (o.isMesh && o.name === 'signs-lit') o.material.dispose(); });
        for (const L of s.built.lights) L.dispose?.();
        s.res.dispose?.();
      }
      chunks.dispose(); farRing.geometry.dispose(); tmat.dispose();
      veg.dispose(); water.dispose();
      group.traverse(o => { if (o.name === 'roads-asphalt') { o.geometry.dispose(); o.material.dispose(); } });
      light.dispose(); hdri?.dispose();
      offQuality?.();
      if (typeof G.renderer?.setPost === 'function') G.renderer.setPost(postRestore);
      collider.clear();
    },
  };
  const offQuality = typeof G.renderer?.onQualityChange === 'function' ? G.renderer.onQualityChange((q, preset) => world.setQuality(preset)) : null;
  for (const s of sites) s.res.attach?.(world, G);
  world.stats.texturesReleased = releaseUnusedTextures();
  world.stats.assets.released = await lib.releaseOthers(new Set([...libraryInUse(), ...tmat.libIds]), new Set(sites.flatMap(s => s.b.modelIdsUsed || [])));
  world.stats.assets.libMaterials = libraryStats.materials;
  world.stats.assets.fallbackMaterials = libraryStats.fallback;
  for (const s of sites) s.built.props?.showAll();
  // erste Kamera-Stellung: Gelände-LOD + Vegetation am ersten Startpunkt vorbereiten
  const cam0 = new THREE.PerspectiveCamera(70, 1.7, 0.1, 900);
  const s0 = spawns.A[0] || spawns.ffa[0];
  if (s0) { cam0.position.copy(s0.position).add(new THREE.Vector3(0, 1.7, 0)); chunks.update(cam0, 64); veg.update(cam0, true); }
  progress(0.97, 'Texturen hochladen');
  world.stats.uploadMs = await uploadTextures(renderer, group);
  world.stats.totalMs = Math.round(performance.now() - t0);
  if (debug) console.info(`[world] ${id}: Großkarte in ${world.stats.totalMs} ms (Gelände ${ms.terrain} ms, Ortschaften ${ms.sites} ms, Worker ${ms.job} ms), Nav ${nav.stats.nodes} Knoten (${nav.stats.fine} fein/${nav.stats.coarse} Gelände), ${veg.stats.trees} Bäume, Kollision ${world.stats.colliderTris} Dreiecke`);
  progress(1, 'Bereit');
  return world;
}
