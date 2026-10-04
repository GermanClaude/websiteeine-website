// NULLPUNKT — Welt laden (Owner: world)
// loadWorld(G, mapId, { onProgress }) → World (siehe docs/ARCHITECTURE.md §6)
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { MAPS } from '../../shared/maps.data.js';
import { configureTextures, getMaterial } from '../engine/textures.js';
import { MapBuilder, SURFACES } from './builder.js';
import { createLighting } from './lighting.js';
import { createWater } from './water.js';
import { buildNavGraph, validateNavGraph } from './navgraph.js';
import { createMinimap } from './minimap.js';
import { foliageUniforms } from './atlas.js';

const MAP_MODULES = {
  hafen: () => import('./maps/hafen.js'),
  altstadt: () => import('./maps/altstadt.js'),
  werk: () => import('./maps/werk.js'),
  range: () => import('./maps/range.js'),
};

export const MAP_IDS = Object.keys(MAP_MODULES);

async function fontsReady() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const t = new Promise(r => setTimeout(r, 1200));
  try { await Promise.race([Promise.all([document.fonts.load('800 64px "Archivo NP"'), document.fonts.load('700 32px "JetBrains Mono NP"')]), t]); } catch { /* egal */ }
}

/**
 * Lädt eine Karte, fügt world.group zu G.scene hinzu und liefert das World-Objekt.
 * @param {object} G Spielkontext (benötigt scene, renderer; camera optional)
 * @param {string} mapId 'hafen' | 'altstadt' | 'werk' | 'range'
 * @param {{ onProgress?: (p:number, label:string)=>void }} [opts]
 */
export async function loadWorld(G, mapId, { onProgress } = {}) {
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

  const [{ default: def }] = await Promise.all([MAP_MODULES[id](), fontsReady()]);
  const tBuild0 = performance.now();
  const pb = def.bounds;
  const cb = def.visualBounds || { minX: pb.minX - 30, maxX: pb.maxX + 30, minZ: pb.minZ - 30, maxZ: pb.maxZ + 30 };
  const b = new MapBuilder({ bounds: cb, seed: def.seed || 1, chunkSize: def.chunkSize || 32, groundNoise: def.groundNoise ?? 0.14, interiorTint: def.interiorTint });
  const waters = [];
  const ctx = {
    THREE, quality, debug, getMaterial,
    water: o => { const w = createWater(o); waters.push(w); return w; },
  };
  const res = def.build(b, ctx) || {};
  progress(0.05, 'Geometrie');
  const built = await b.build({ quality, onProgress: (p, l) => progress(p * 0.82, l) });
  const tBuild = performance.now() - tBuild0;

  const group = new THREE.Group();
  group.name = 'world:' + id;
  group.add(built.group);
  for (const w of waters) group.add(w.mesh);

  // Kollision (Octree für Kapseln)
  progress(0.84, 'Kollision');
  const collider = new Octree().fromGraphNode(built.colliderMesh);
  built.colliderMesh.geometry.dispose();

  // Licht & Himmel
  progress(0.86, 'Licht');
  const light = createLighting(G, def.lighting, group);
  G.scene.add(group);
  // Kartenbelichtung (z. B. Dämmerung etwas heller) – nur wenn der Renderer das anbietet
  const prevExposure = G.renderer?.post?.exposure;
  if (def.lighting.exposure && typeof G.renderer?.setPost === 'function') G.renderer.setPost({ exposure: def.lighting.exposure });

  // Startpunkte am Boden einrasten
  const bvh = built.bulletBVH, cbvh = built.colliderBVH;
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
  const center = new THREE.Vector3((pb.minX + pb.maxX) / 2, 0, (pb.minZ + pb.maxZ) / 2);
  // Standard-Suchhöhe knapp über Kopfhöhe (unter jeder Zimmerdecke); Dachpunkte geben y an
  const snap = (p, yHint = 0.4) => {
    const v = new THREE.Vector3(p.x ?? p[0], 0, p.z ?? p[2] ?? p[1]);
    const y0 = (p.y ?? yHint) + 1.2;
    v.y = cbvh.raycast(v.x, y0, v.z, 0, -1, 0, y0 + 10, hit) ? y0 - hit.t : (p.y ?? 0);
    return v;
  };
  const spawns = { A: [], B: [], ffa: [] };
  for (const team of ['A', 'B', 'ffa']) {
    for (const s of res.spawns?.[team] || []) {
      const position = snap(s, s.y ?? 0.4);
      const yaw = s.yaw ?? Math.atan2(-(center.x - position.x), -(center.z - position.z));
      spawns[team].push({ position, yaw });
    }
  }
  const objectives = { dom: (res.objectives?.dom || []).map(o => ({ id: o.id, position: snap(o, o.y ?? 0.4), radius: o.radius ?? 5 })) };

  // Navigation
  progress(0.88, 'Navigation');
  await new Promise(r => setTimeout(r, 0));
  const nav = buildNavGraph({
    colliderBVH: cbvh,
    bounds: { ...pb, minY: pb.minY ?? -3, maxY: pb.maxY ?? 30 },
    navPoints: b.navPoints,
    exclude: b.navExclude,
    seeds: [...spawns.A, ...spawns.B].map(s => s.position),
  }, { spacing: def.navSpacing || 1.5 });
  if (debug) {
    const rep = validateNavGraph(nav, { spawns, objectives }, nav.removed);
    nav.report = rep;
    const s = nav.stats;
    console.info(`[world] ${id}: Navigationsgraph ${s.nodes} Knoten, ${s.links} Verbindungen (${s.drops} Absprünge), ${s.cover} Deckungspunkte, ${s.removed} unerreichbare Punkte entfernt, ${s.ms} ms`);
    for (const p of rep.problems) console.warn('[world] Navigation: ' + p);
  }

  // Minikarte
  progress(0.95, 'Minikarte');
  const minimap = createMinimap({ footprints: b.footprints, zones: res.zones || [], bounds: pb, size: 512 });

  // Ziele (Schießstand) – dynamische Trefferboxen
  const targets = res.targets || [];
  const tmpM = new THREE.Matrix4(), tmpO = new THREE.Vector3(), tmpD = new THREE.Vector3(), box = new THREE.Box3(), ray = new THREE.Ray(), hitP = new THREE.Vector3();

  const bounds = new THREE.Box3(new THREE.Vector3(pb.minX, pb.minY ?? -3, pb.minZ), new THREE.Vector3(pb.maxX, pb.maxY ?? 30, pb.maxZ));
  const objects = built.objects;

  const world = {
    id, name: meta.name, meta,
    group,
    collider,
    bounds,
    spawns,
    objectives,
    nav,
    lighting: light.lighting,
    minimap,
    ambience: def.ambience || meta.ambience,
    targets,
    stats: { ...built.stats, buildMs: Math.round(tBuild), totalMs: 0, nav: nav.stats },
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

    /** Bodenhöhe unter (x, z) ab yFrom abwärts (Kollisionsgeometrie) oder null. */
    groundHeight(x, z, yFrom = 30) {
      return cbvh.raycast(x, yFrom, z, 0, -1, 0, yFrom + 20, hit) ? yFrom - hit.t : null;
    },

    update(dt, camera) {
      light.update(dt, camera);
      foliageUniforms.uTime.value += dt;
      for (const w of waters) w.update(dt);
      for (const ob of b.objects) ob.update?.(dt, camera);
      for (const t of targets) t.update?.(dt);
      res.update?.(dt, camera);
    },

    /** Schattenqualität anpassen (z. B. nach Qualitätswechsel). */
    setQuality(preset = {}) { light.setShadowQuality({ shadows: preset.shadows, mapSize: preset.shadowMapSize }); },

    dispose() {
      G.scene.remove(group);
      group.traverse(o => {
        if (o.isMesh || o.isInstancedMesh) {
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
      if (def.lighting.exposure && typeof G.renderer?.setPost === 'function') G.renderer.setPost({ exposure: prevExposure ?? 1 });
      res.dispose?.();
      collider.clear?.();
    },
  };
  // Kartenspezifische Aktionen (z. B. Ziele) mit Weltzugriff verdrahten
  res.attach?.(world, G);
  world.stats.totalMs = Math.round(performance.now() - t0);
  if (debug) console.info(`[world] ${id}: geladen in ${world.stats.totalMs} ms (Aufbau ${world.stats.buildMs} ms), ${built.stats.meshes} Meshes, ${built.stats.triangles} Dreiecke, Kugel-BVH ${built.stats.bulletTris}, Kollision ${built.stats.colliderTris}`);
  progress(1, 'Bereit');
  return world;
}
