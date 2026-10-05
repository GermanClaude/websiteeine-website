// NULLPUNKT — Testgelände für dev/input.html und tools/out/core-input/sim.mjs: Kisten zum Überklettern
// (0,6 / 1,0 / 1,25 m), dünne Mauer zum Überspringen (0,95 m), zu hohe Wand (1,7 m), Lehnwand mit Pfeiler,
// Treppe (18-cm-Stufen), Rampe (20°). Liefert eine minimale World (collider, collisionBVH, raycast, lineOfSight,
// surfaceAt, bounds) und optional eine three.js-Gruppe zum Anzeigen.
import * as THREE from 'three';
import { buildColliderOctree } from '../../assets/js/game/world/collider.js';
import { TriangleBVH } from '../../assets/js/game/world/bvh.js';

/** Quader [cx, cy (Unterkante), cz, sx, sy, sz, farbe, name] */
export const BOXES = [
  [0, -0.5, 0, 70, 0.5, 70, 0x3a3f44, 'Boden'],
  [0, 0, -6, 2, 0.6, 1.0, 0x8a6f4a, 'Kiste 0,6 m'],
  [4, 0, -6, 2, 1.0, 1.2, 0x8a6f4a, 'Kiste 1,0 m'],
  [8, 0, -6, 2, 1.25, 1.5, 0x8a6f4a, 'Kiste 1,25 m'],
  [-4, 0, -6, 2, 0.95, 0.2, 0x9a9a92, 'Mauer 0,95 m (dünn)'],
  [-8, 0, -6, 2, 1.7, 1.0, 0x6d6d70, 'Wand 1,7 m'],
  [12.15, 0, 0, 0.3, 3, 6, 0x7c8590, 'Lehnwand'],
  [9.2, 0, 4, 0.6, 2.6, 0.6, 0x7c8590, 'Pfeiler'],
];
const STAIRS = { x: -14, z0: -2, steps: 8, rise: 0.18, run: 0.3, width: 2 };
const RAMP = { x: -20, z0: -2, len: 6, deg: 20, width: 2.5 };

function pushBox(tris, cx, y0, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + sy;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  for (const [a, b, c] of f) tris.push(...v[a], ...v[b], ...v[c]);
}

/** Alle Quader inkl. Treppe/Rampe (Rampe als geneigter Quader über Dreiecke). */
export function buildTriangles() {
  const tris = [];
  for (const [cx, y0, cz, sx, sy, sz] of BOXES) pushBox(tris, cx, y0, cz, sx, sy, sz);
  const s = STAIRS;
  for (let i = 0; i < s.steps; i++) pushBox(tris, s.x, 0, s.z0 - s.run * (i + 0.5), s.width, s.rise * (i + 1), s.run);
  pushBox(tris, s.x, 0, s.z0 - s.run * s.steps - 1.5, s.width, s.rise * s.steps, 3); // Podest
  // Rampe: Keil von z0 (Höhe 0) nach z0 − len (Höhe len·tan)
  const r = RAMP, h = r.len * Math.tan((r.deg * Math.PI) / 180), x0 = r.x - r.width / 2, x1 = r.x + r.width / 2, za = r.z0, zb = r.z0 - r.len;
  tris.push(x0, 0, za, x1, 0, za, x1, h, zb, x0, 0, za, x1, h, zb, x0, h, zb); // Schräge
  tris.push(x0, 0, zb, x0, h, zb, x1, h, zb, x0, 0, zb, x1, h, zb, x1, 0, zb); // Rückwand
  tris.push(x0, 0, za, x0, h, zb, x0, 0, zb, x1, 0, za, x1, 0, zb, x1, h, zb); // Seiten
  return new Float32Array(tris);
}

/** Minimale World für Player/CapsuleBody (Kollision + Strahlen wie world/index.js). */
export function createTestWorld({ withMeshes = false } = {}) {
  const tris = buildTriangles();
  const collider = buildColliderOctree(tris);
  const bvh = new TriangleBVH(tris);
  const hit = { t: 0, tri: -1, nx: 0, ny: 0, nz: 0, data: 0 };
  const world = {
    id: 'test', name: 'Testgelände', collider, collisionBVH: bvh,
    bounds: new THREE.Box3(new THREE.Vector3(-34, -3, -34), new THREE.Vector3(34, 30, 34)),
    raycast(o, d, max = 1000) {
      if (!bvh.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, hit)) return null;
      return { distance: hit.t, point: new THREE.Vector3(o.x + d.x * hit.t, o.y + d.y * hit.t, o.z + d.z * hit.t), normal: new THREE.Vector3(hit.nx, hit.ny, hit.nz), surface: 'concrete', object: null };
    },
    lineOfSight(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz);
      return l < 1e-4 || !bvh.occluded(a.x, a.y, a.z, dx / l, dy / l, dz / l, l - 0.02);
    },
    surfaceAt() { return 'concrete'; },
    update() {},
    group: null,
  };
  if (withMeshes) {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(tris, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.85, flatShading: true }));
    mesh.receiveShadow = mesh.castShadow = true;
    g.add(mesh);
    const grid = new THREE.GridHelper(70, 70, 0x555a60, 0x2f3338);
    grid.position.y = 0.002;
    g.add(grid);
    world.group = g;
  }
  return world;
}
