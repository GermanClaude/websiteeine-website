// NULLPUNKT — Stub für world/index.js (§6): Testgelände mit Boden, Kisten, Containern, Rampe,
// Treppe, Plattform, begehbarem Gebäude, Mauern; Octree-Kollision mit Oberflächen je Dreieck,
// Spawns (A/B/FFA), Herrschafts-Flaggen, NavGraph (Raster + A*), Minikarte, Licht/Himmel.
// Gleiche API wie die echte Welt – austauschbar.

import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as stubTextures from './textures.js';

const HALF_X = 32;
const HALF_Z = 36;
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------ Layout */
// [x, yBottom, z, w, h, d, material, rotY?]
function layout() {
  const B = [];
  const box = (x, y, z, w, h, d, mat, rot = 0) => B.push({ x, y, z, w, h, d, mat, rot });
  // Außenmauern
  box(0, 0, -HALF_Z - 0.5, HALF_X * 2 + 2, 4.5, 1, 'concrete_dark');
  box(0, 0, HALF_Z + 0.5, HALF_X * 2 + 2, 4.5, 1, 'concrete_dark');
  box(-HALF_X - 0.5, 0, 0, 1, 4.5, HALF_Z * 2, 'concrete_dark');
  box(HALF_X + 0.5, 0, 0, 1, 4.5, HALF_Z * 2, 'concrete_dark');
  // Zentrale Plattform (2 m) mit Treppe (+X) und Brüstung
  box(0, 0, 0, 8, 2, 8, 'concrete');
  for (let i = 0; i < 8; i++) box(4 + (7 - i) * 0.5 + 0.25, 0, 0, 0.5, (i + 1) * 0.25, 3, 'concrete');
  box(-1.5, 2, -3.85, 5, 0.9, 0.3, 'metal_painted');
  box(1.5, 2, 3.85, 5, 0.9, 0.3, 'metal_painted');
  // Container
  box(-20, 0, 12, 2.6, 2.6, 6, 'container_blue');
  box(-20, 2.6, 12, 2.6, 2.6, 6, 'container_red');
  box(-23, 0, 12.5, 2.6, 2.6, 6, 'container_green');
  box(20, 0, -12, 2.6, 2.6, 6, 'container_orange');
  box(17, 0, -12.5, 2.6, 2.6, 6, 'container_gray');
  box(22, 0, 18, 6, 2.6, 2.6, 'container_red');
  box(-22, 0, -18, 6, 2.6, 2.6, 'container_blue');
  box(-22, 2.6, -18, 6, 2.6, 2.6, 'container_orange');
  // Gebäude (Innenraum) x 12..22, z -4..6, Türen auf beiden Längsseiten
  const bx0 = 12, bx1 = 22, bz0 = -4, bz1 = 6, wh = 3.2, t = 0.3;
  box(bx0 + 2, 0, bz0, 4, wh, t, 'plaster_warm');
  box(bx1 - 2.6, 0, bz0, 5.2, wh, t, 'plaster_warm');
  box(bx0 + 2.6, 0, bz1, 5.2, wh, t, 'plaster_warm');
  box(bx1 - 2, 0, bz1, 4, wh, t, 'plaster_warm');
  box(bx0, 0, (bz0 + bz1) / 2, t, wh, bz1 - bz0, 'plaster_warm');
  box(bx1, 0, bz0 + 2, t, wh, 4, 'plaster_warm');
  box(bx1, 0, bz1 - 2, t, wh, 4, 'plaster_warm');
  box((bx0 + bx1) / 2, wh, (bz0 + bz1) / 2, bx1 - bx0 + t, 0.3, bz1 - bz0 + t, 'concrete_dark');
  box(17, 0, 1, 1.2, 1.0, 2.4, 'wood_planks'); // Tisch/Deckung innen
  // Fahrspuren-Mauern
  box(-10, 0, -18, 0.6, 3, 16, 'brick');
  box(10, 0, 18, 0.6, 3, 16, 'brick');
  box(-26, 0, 0, 8, 3, 0.6, 'brick');
  // Niedrige Deckungen (Sandsäcke, 0,9 m)
  box(0, 0, 16, 6, 0.9, 0.8, 'sandbag');
  box(0, 0, -16, 6, 0.9, 0.8, 'sandbag');
  box(-14, 0, 3, 0.8, 0.9, 4, 'sandbag');
  box(26, 0, 4, 0.8, 0.9, 4, 'sandbag');
  box(-6, 0, -28, 4, 0.9, 0.8, 'sandbag');
  box(6, 0, 28, 4, 0.9, 0.8, 'sandbag');
  // Holzwand (durchschlagbar)
  box(8, 0, -6, 0.12, 2.4, 4, 'wood_planks');
  box(-8, 0, 8, 4, 2.4, 0.12, 'wood_planks');
  // Kisten
  const crate = (x, z, s = 1.2, y = 0, rot = 0) => box(x, y, z, s, s, s, 'wood_crate', rot);
  crate(-6, 22); crate(-4.7, 22.3, 1.2, 0, 0.3); crate(-5.4, 22.1, 1.1, 1.2, 0.5);
  crate(6, -22); crate(7.3, -21.6, 1.2, 0, 0.4); crate(6.5, -22, 1.1, 1.2, 0.2);
  crate(-16, -6); crate(-16.2, -7.3, 1.0); crate(15, 12); crate(15.4, 13.3, 1.0, 0, 0.6);
  crate(26, -24); crate(-26, 24); crate(-3, -10, 1.0); crate(3, 10, 1.0); crate(24, 28, 1.4); crate(-24, -28, 1.4);
  // Säulen
  for (const [x, z] of [[-16, 26], [16, 26], [-16, -26], [16, -26]]) box(x, 0, z, 1, 3.4, 1, 'concrete');
  return B;
}

/* ------------------------------------------------------------ Welt */

export async function loadWorld(G, mapId, { onProgress } = {}) {
  const progress = (p) => { try { if (onProgress) onProgress(p); } catch { /* ignore */ } };
  const tex = (G.modules && G.modules.textures && G.modules.textures.getMaterial) ? G.modules.textures : stubTextures;
  const preset = G.renderer && G.renderer.preset ? G.renderer.preset : { shadows: true, shadowMapSize: 2048 };
  const meta = (G.data && G.data.MAPS && G.data.MAPS[mapId]) || { id: mapId, name: 'Testgelände', modes: ['tdm', 'ffa', 'dom', 'gun', 'training'] };
  progress(0.05);

  const group = new THREE.Group();
  group.name = `world:${mapId}`;
  const disposables = [];
  const boxes = layout();
  const scene = G.scene;
  const prev = { background: scene.background, fog: scene.fog, environment: scene.environment };

  // --- Statische Geometrie (pro Material zusammengeführt)
  const byMat = new Map();
  const addGeo = (geo, matName) => {
    if (!byMat.has(matName)) byMat.set(matName, []);
    byMat.get(matName).push(geo);
  };
  const m4 = new THREE.Matrix4();
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    const tile = b.mat.startsWith('container') ? 2.6 : b.mat === 'wood_crate' ? b.w : 2;
    tex.boxUV(g, tile);
    m4.makeRotationY(b.rot || 0).setPosition(b.x, b.y + b.h / 2, b.z);
    g.applyMatrix4(m4);
    addGeo(g, b.mat);
  }
  // Rampe (-X): von (-12, 0) auf (-4, 2)
  {
    const L = Math.hypot(8, 2);
    const th = Math.atan2(2, 8);
    const g = new THREE.BoxGeometry(L, 0.4, 3);
    tex.boxUV(g, 2);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), th);
    m4.compose(new THREE.Vector3(-8 + 0.2 * Math.sin(th), 1 - 0.2 * Math.cos(th), 0), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m4);
    addGeo(g, 'metal_painted');
  }
  // Boden (unterteilt, damit Octree-Zellen klein bleiben)
  {
    const g = new THREE.PlaneGeometry(HALF_X * 2 + 4, HALF_Z * 2 + 4, 12, 13);
    g.rotateX(-Math.PI / 2);
    tex.boxUV(g, 4);
    addGeo(g, 'asphalt');
    const s = new THREE.PlaneGeometry(HALF_X * 2, 8, 6, 1);
    s.rotateX(-Math.PI / 2);
    s.translate(0, 0.004, HALF_Z - 4);
    tex.boxUV(s, 3);
    addGeo(s, 'sand');
    const s2 = s.clone();
    s2.translate(0, 0, -(HALF_Z * 2 - 8));
    addGeo(s2, 'sand');
  }
  progress(0.25);
  await tick();

  const collider = new Octree();
  const tri = (a, b, c, surface) => {
    const t = new THREE.Triangle(a.clone(), b.clone(), c.clone());
    t.surface = surface;
    collider.addTriangle(t);
  };
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  for (const [matName, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const mat = tex.getMaterial(matName);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `static:${matName}`;
    mesh.castShadow = matName !== 'asphalt' && matName !== 'sand';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    disposables.push(merged);
    if (matName === 'sand') continue; // liegt flach auf dem Asphalt
    const surface = (mat.userData && mat.userData.surface) || 'concrete';
    const pos = merged.attributes.position;
    const idx = merged.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, ia); vb.fromBufferAttribute(pos, ib); vc.fromBufferAttribute(pos, ic);
      tri(va, vb, vc, surface);
    }
  }
  collider.build();
  progress(0.45);
  await tick();

  // --- Licht + Himmel
  const sunDirection = new THREE.Vector3(-0.45, 0.78, 0.38).normalize();
  const lighting = {
    sunDirection, sunColor: new THREE.Color(0xfff0d8), sunIntensity: 2.7,
    hemiSky: new THREE.Color(0xbcd4f2), hemiGround: new THREE.Color(0x6b5a48), hemiIntensity: 0.85,
    envMap: null, fogColor: new THREE.Color(0xc9d6e2),
  };
  const hemi = new THREE.HemisphereLight(lighting.hemiSky, lighting.hemiGround, lighting.hemiIntensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(lighting.sunColor, lighting.sunIntensity);
  sun.position.copy(sunDirection).multiplyScalar(60);
  sun.castShadow = !!preset.shadows;
  sun.shadow.mapSize.set(preset.shadowMapSize || 2048, preset.shadowMapSize || 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun);
  group.add(sun.target);

  // Himmelskuppel (Verlauf)
  const skyGeo = new THREE.SphereGeometry(420, 24, 12);
  const colors = [];
  const top = new THREE.Color(0x5d8fc9), mid = new THREE.Color(0xc9d6e2), low = new THREE.Color(0xe8d9c0);
  const pa = skyGeo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pa.count; i++) {
    const h = pa.getY(i) / 420;
    if (h > 0) c.copy(mid).lerp(top, Math.pow(h, 0.6)); else c.copy(mid).lerp(low, Math.min(1, -h * 3));
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);
  disposables.push(skyGeo, skyMat);

  let envTex = null;
  if (G.renderer && G.renderer.renderer) {
    const pmrem = new THREE.PMREMGenerator(G.renderer.renderer);
    const room = new RoomEnvironment();
    const envTarget = pmrem.fromScene(room, 0.04);
    envTex = envTarget.texture;
    room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pmrem.dispose();
    lighting.envMap = envTex;
    disposables.push(envTarget);
  }
  scene.environment = envTex;
  scene.environmentIntensity = 0.35;
  scene.background = lighting.fogColor.clone();
  scene.fog = new THREE.Fog(lighting.fogColor, 70, 260);
  scene.add(group);
  progress(0.6);
  await tick();

  // --- Raycast-Helfer
  const ray = new THREE.Ray();
  const nrm = new THREE.Vector3();
  function raycast(origin, dir, maxDist = 1000) {
    ray.origin.copy(origin);
    ray.direction.copy(dir);
    const hit = collider.rayIntersect(ray);
    if (!hit || hit.distance > maxDist) return null;
    hit.triangle.getNormal(nrm);
    if (nrm.dot(dir) > 0) nrm.negate();
    return { distance: hit.distance, point: hit.position, normal: nrm.clone(), surface: hit.triangle.surface || 'concrete', object: null };
  }
  const losDir = new THREE.Vector3();
  function lineOfSight(a, b) {
    losDir.subVectors(b, a);
    const d = losDir.length();
    if (d < 1e-4) return true;
    losDir.divideScalar(d);
    return !raycast(a, losDir, d - 0.05);
  }
  const down = new THREE.Vector3(0, -1, 0);
  const tmp = new THREE.Vector3();
  function surfaceAt(point) {
    tmp.copy(point);
    tmp.y += 0.3;
    const h = raycast(tmp, down, 1.2);
    return h ? h.surface : 'concrete';
  }
  function floorAt(x, z, fromY = 2.4, depth = 4) {
    tmp.set(x, fromY, z);
    const h = raycast(tmp, down, depth);
    return h ? h.point.y : null;
  }

  // --- Spawns
  const spawns = { A: [], B: [], ffa: [] };
  for (let i = 0; i < 9; i++) {
    const x = -24 + i * 6;
    spawns.A.push({ position: new THREE.Vector3(x, 0, 31 + (i % 2) * 1.5), yaw: 0 });
    spawns.B.push({ position: new THREE.Vector3(x, 0, -31 - (i % 2) * 1.5), yaw: Math.PI });
  }
  const ffaPts = [[-27, -8], [27, 8], [-12, 28], [12, -28], [-28, 30], [28, -30], [0, -30], [0, 30], [-18, -2], [26, -6], [-6, 12], [6, -12], [14.5, 3], [-28, -30], [28, 30]];
  for (const [x, z] of ffaPts) spawns.ffa.push({ position: new THREE.Vector3(x, 0, z), yaw: Math.atan2(x, z) });
  const probe = new Capsule(new THREE.Vector3(), new THREE.Vector3(), 0.35);
  const blocked = (p) => {
    probe.start.set(p.x, p.y + 0.4, p.z);
    probe.end.set(p.x, p.y + 1.45, p.z);
    const hit = collider.capsuleIntersect(probe);
    return hit && hit.depth > 0.01;
  };
  for (const list of Object.values(spawns)) {
    for (const s of list) {
      const y = floorAt(s.position.x, s.position.z, 0.6, 2);
      s.position.y = y == null ? 0 : y;
    }
  }

  const objectives = {
    dom: [
      { id: 'A', position: new THREE.Vector3(0, 0, 22), radius: 4 },
      { id: 'B', position: new THREE.Vector3(0, 2, 0), radius: 3.5 },
      { id: 'C', position: new THREE.Vector3(0, 0, -22), radius: 4 },
    ],
  };

  // --- NavGraph
  progress(0.7);
  const nav = buildNav({ raycast, lineOfSight, floorAt, blocked });
  progress(0.85);
  await tick();

  // --- Minikarte
  const minimap = buildMinimap(boxes);
  progress(0.95);

  const bounds = new THREE.Box3(new THREE.Vector3(-HALF_X, -5, -HALF_Z), new THREE.Vector3(HALF_X, 30, HALF_Z));
  const snap = new THREE.Vector3();

  const world = {
    id: mapId,
    name: meta.name ? `${meta.name} · Testgelände` : 'Testgelände',
    meta,
    group,
    collider,
    bounds,
    raycast,
    lineOfSight,
    spawns,
    objectives,
    nav,
    lighting,
    minimap,
    ambience: 'range',
    surfaceAt,
    isStub: true,
    update(dt, camera) {
      if (!camera) return;
      // Schattenkamera folgt der Kamera (auf Texel-Raster gerastet gegen Flimmern)
      const step = 90 / sun.shadow.mapSize.x;
      snap.set(Math.round(camera.position.x / step) * step, 0, Math.round(camera.position.z / step) * step);
      sun.target.position.copy(snap);
      sun.position.copy(snap).addScaledVector(sunDirection, 60);
      sky.position.copy(camera.position);
    },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
      if (sun.shadow.map) sun.shadow.map.dispose();
      scene.background = prev.background;
      scene.fog = prev.fog;
      scene.environment = prev.environment;
      collider.clear();
      if (minimap.canvas) { minimap.canvas.width = 1; minimap.canvas.height = 1; }
    },
  };
  progress(1);
  return world;
}

/* ------------------------------------------------------------ NavGraph */

function buildNav({ raycast, lineOfSight, floorAt, blocked }) {
  const SP = 3.5;
  const nodes = [];
  const grid = new Map();
  for (let x = -HALF_X + 2; x <= HALF_X - 2; x += SP) {
    for (let z = -HALF_Z + 2; z <= HALF_Z - 2; z += SP) {
      const y = floorAt(x, z, 2.4, 4);
      if (y == null) continue;
      const p = new THREE.Vector3(x, y, z);
      if (blocked(p)) continue;
      const node = { id: nodes.length, position: p, links: [], cover: false, coverDir: null, gx: Math.round((x + HALF_X) / SP), gz: Math.round((z + HALF_Z) / SP) };
      nodes.push(node);
      grid.set(`${node.gx},${node.gz}`, node);
    }
  }
  // Verbindungen (8er-Nachbarschaft) mit Bodenkontinuität + Sichtlinie in Hüfthöhe
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const walkable = (n1, n2) => {
    const steps = Math.ceil(n1.position.distanceTo(n2.position) / 0.6);
    let prevY = n1.position.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = n1.position.x + (n2.position.x - n1.position.x) * t;
      const z = n1.position.z + (n2.position.z - n1.position.z) * t;
      const y = floorAt(x, z, Math.max(n1.position.y, n2.position.y) + 0.6, 2.5);
      if (y == null || Math.abs(y - prevY) > 0.45) return false;
      prevY = y;
    }
    a.copy(n1.position); a.y += 0.75;
    b.copy(n2.position); b.y += 0.75;
    if (!lineOfSight(a, b)) return false;
    a.y += 0.7; b.y += 0.7;
    return lineOfSight(a, b);
  };
  for (const n of nodes) {
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const m = grid.get(`${n.gx + dx},${n.gz + dz}`);
      if (!m) continue;
      if (walkable(n, m)) { n.links.push(m.id); m.links.push(n.id); }
    }
  }
  // Nur die größte zusammenhängende Komponente behalten
  const comp = new Array(nodes.length).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  for (const n of nodes) {
    if (comp[n.id] >= 0) continue;
    const stack = [n.id];
    comp[n.id] = n.id;
    let size = 0;
    while (stack.length) {
      const id = stack.pop();
      size++;
      for (const l of nodes[id].links) if (comp[l] < 0) { comp[l] = n.id; stack.push(l); }
    }
    if (size > bestSize) { bestSize = size; bestComp = n.id; }
  }
  const keep = nodes.filter((n) => comp[n.id] === bestComp);
  const remap = new Map(keep.map((n, i) => [n.id, i]));
  for (const n of keep) {
    n.links = n.links.filter((l) => remap.has(l)).map((l) => remap.get(l));
    n.id = remap.get(n.id);
    delete n.gx; delete n.gz;
  }
  // Deckung: Hindernis in Brusthöhe innerhalb 1,6 m
  const dir = new THREE.Vector3();
  const o = new THREE.Vector3();
  for (const n of keep) {
    let nearest = Infinity;
    o.copy(n.position); o.y += 1.0;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      dir.set(Math.sin(ang), 0, Math.cos(ang));
      const h = raycast(o, dir, 1.9);
      if (h && h.distance < nearest) { nearest = h.distance; n.coverDir = dir.clone(); }
    }
    n.cover = nearest < 1.9;
  }
  return new NavGraph(keep, lineOfSight);
}

class NavGraph {
  constructor(nodes, lineOfSight) {
    this.nodes = nodes;
    this._los = lineOfSight;
  }

  nearest(pos, visible = false) {
    let best = null;
    let bd = Infinity;
    const cand = visible ? [] : null;
    for (const n of this.nodes) {
      const dx = n.position.x - pos.x, dz = n.position.z - pos.z, dy = (n.position.y - pos.y) * 2.5;
      const d = dx * dx + dz * dz + dy * dy;
      if (cand) cand.push([d, n]);
      if (d < bd) { bd = d; best = n; }
    }
    if (!visible || !best) return best;
    // Nächster Knoten mit freier Sicht in Kniehöhe (nicht hinter einer Wand)
    cand.sort((a, b) => a[0] - b[0]);
    const a = new THREE.Vector3(pos.x, pos.y + 0.6, pos.z);
    const b = new THREE.Vector3();
    for (let i = 0; i < Math.min(6, cand.length); i++) {
      const n = cand[i][1];
      b.copy(n.position); b.y += 0.6;
      if (this._los(a, b)) return n;
    }
    return best;
  }

  findPath(from, to) {
    const start = this.nearest(from, true);
    const goal = this.nearest(to, true);
    if (!start || !goal) return [to.clone()];
    if (start === goal) return [goal.position.clone(), to.clone()];
    const N = this.nodes;
    const g = new Map([[start.id, 0]]);
    const came = new Map();
    const open = new MinHeap();
    const h = (n) => n.position.distanceTo(goal.position);
    open.push(start.id, h(start));
    const closed = new Set();
    while (open.size) {
      const id = open.pop();
      if (id === goal.id) break;
      if (closed.has(id)) continue;
      closed.add(id);
      const n = N[id];
      for (const l of n.links) {
        if (closed.has(l)) continue;
        const m = N[l];
        const cost = g.get(id) + n.position.distanceTo(m.position) * (m.cover ? 0.95 : 1);
        if (cost < (g.has(l) ? g.get(l) : Infinity)) {
          g.set(l, cost);
          came.set(l, id);
          open.push(l, cost + h(m));
        }
      }
    }
    if (!came.has(goal.id)) return [to.clone()];
    const path = [];
    let cur = goal.id;
    while (cur !== undefined && cur !== start.id) { path.push(N[cur].position.clone()); cur = came.get(cur); }
    if (start.position.distanceTo(from) > 1.2) path.push(start.position.clone());
    path.reverse();
    path.push(to.clone());
    return path;
  }

  randomNode(filter) {
    const list = filter ? this.nodes.filter(filter) : this.nodes;
    return list.length ? list[(Math.random() * list.length) | 0] : null;
  }

  coverNear(pos, threatPos, radius = 10) {
    const eye = new THREE.Vector3(threatPos.x, threatPos.y + 1.5, threatPos.z);
    const p = new THREE.Vector3();
    let best = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      if (!n.cover) continue;
      const d = n.position.distanceTo(pos);
      if (d > radius || d >= bd) continue;
      p.copy(n.position); p.y += 1.0;
      if (this._los(eye, p)) continue;
      best = n;
      bd = d;
    }
    return best;
  }

  nodesInRadius(pos, r) {
    const r2 = r * r;
    return this.nodes.filter((n) => n.position.distanceToSquared(pos) <= r2);
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= p[i]) break;
      [k[i], k[j]] = [k[j], k[i]]; [p[i], p[j]] = [p[j], p[i]];
      i = j;
    }
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[i], k[m]] = [k[m], k[i]]; [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}

/* ------------------------------------------------------------ Minikarte */

function buildMinimap(boxes) {
  const sizeX = HALF_X * 2;
  const sizeZ = HALF_Z * 2;
  const res = 256;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(res * (sizeX / sizeZ));
  canvas.height = res;
  const g = canvas.getContext('2d');
  const sx = canvas.width / sizeX;
  const sz = canvas.height / sizeZ;
  g.fillStyle = '#1b1d20';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = 'rgba(205,182,138,0.18)';
  g.fillRect(0, 0, canvas.width, 8 * sz);
  g.fillRect(0, canvas.height - 8 * sz, canvas.width, 8 * sz);
  const sorted = [...boxes].sort((a, b) => a.y + a.h - (b.y + b.h));
  for (const b of sorted) {
    const top = b.y + b.h;
    const l = Math.min(1, 0.35 + top / 6);
    g.save();
    g.translate((b.x + HALF_X) * sx, (b.z + HALF_Z) * sz);
    g.rotate(-(b.rot || 0));
    g.fillStyle = `rgba(${Math.round(120 + 110 * l)},${Math.round(118 + 108 * l)},${Math.round(112 + 100 * l)},${0.55 + 0.4 * l})`;
    g.fillRect((-b.w / 2) * sx, (-b.d / 2) * sz, b.w * sx, b.d * sz);
    g.restore();
  }
  // Rampe
  g.fillStyle = 'rgba(160,170,178,0.6)';
  g.fillRect((-12 + HALF_X) * sx, (-1.5 + HALF_Z) * sz, 8 * sx, 3 * sz);
  return {
    canvas,
    size: { x: sizeX, z: sizeZ },
    center: { x: 0, z: 0 },
    worldToMap(x, z) { return { u: (x + HALF_X) / sizeX, v: (z + HALF_Z) / sizeZ }; },
  };
}
