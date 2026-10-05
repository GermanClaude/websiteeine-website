// NULLPUNKT — Kollisions-Octree mit begrenzter Tiefe (Owner: world)
// three/addons Octree teilt mit festen Standardwerten (8 Dreiecke/Blatt, 16 Ebenen) – an Ecken, wo viele
// Dreiecke zusammentreffen, entstehen so Millionen winziger Blätter (Sekunden Ladezeit). Hier wird mit
// eigenen Grenzen auf allen Ebenen geteilt; das Ergebnis ist eine normale Octree-Instanz (gleiche Abfrage-API:
// capsuleIntersect, sphereIntersect, rayIntersect, getCapsuleTriangles, triangleCapsuleIntersect …).
// Aufbau: Dreiecks-AABB verwirft die meisten der 8 Unterboxen, bevor der teure SAT-Test (Box3.intersectsTriangle)
// läuft (gleiches Ergebnis: ohne AABB-Überlappung kein Schnitt); die asynchrone Variante gibt den Hauptthread
// in Zeitscheiben frei (Ladebalken bleibt flüssig).
import { Box3, Triangle, Vector3 } from 'three';
import { Octree } from 'three/addons/math/Octree.js';

const _half = new Vector3(), _v = new Vector3();

/** Teilt einen Knoten einmal in 8 Unterboxen; liefert die weiter zu teilenden Kinder. */
function splitOnce(node, level, perLeaf, maxLevel, out) {
  _half.copy(node.box.max).sub(node.box.min).multiplyScalar(0.5);
  const subs = [];
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
    const box = new Box3();
    box.min.copy(node.box.min).add(_v.set(x, y, z).multiply(_half));
    box.max.copy(box.min).add(_half);
    const sub = new Octree(box);
    sub.trianglesPerLeaf = perLeaf; sub.maxLevel = maxLevel;
    subs.push(sub);
  }
  let tri;
  while ((tri = node.triangles.pop())) {
    const { a, b, c } = tri;
    const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x);
    const y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y);
    const z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
    for (const s of subs) {
      const mn = s.box.min, mx = s.box.max;
      if (x1 < mn.x || x0 > mx.x || y1 < mn.y || y0 > mx.y || z1 < mn.z || z0 > mx.z) continue;
      if (s.box.intersectsTriangle(tri)) s.triangles.push(tri);
    }
  }
  for (const s of subs) {
    const len = s.triangles.length;
    if (len > perLeaf && level < maxLevel) out.push(s, level + 1);
    if (len !== 0) node.subTrees.push(s);
  }
}

function makeRoot(pos, perLeaf, maxLevel) {
  const root = new Octree();
  root.trianglesPerLeaf = perLeaf; root.maxLevel = maxLevel;
  for (let i = 0; i + 8 < pos.length; i += 9) {
    root.addTriangle(new Triangle(new Vector3(pos[i], pos[i + 1], pos[i + 2]), new Vector3(pos[i + 3], pos[i + 4], pos[i + 5]), new Vector3(pos[i + 6], pos[i + 7], pos[i + 8])));
  }
  root.calcBox();
  return root;
}

/**
 * Baut einen Octree aus einem Dreiecks-Array (je 9 Floats, Weltkoordinaten) – synchron.
 * @param {Float32Array} pos
 * @param {{ perLeaf?: number, maxLevel?: number }} [o]
 * @returns {Octree}
 */
export function buildColliderOctree(pos, { perLeaf = 16, maxLevel = 7 } = {}) {
  const root = makeRoot(pos, perLeaf, maxLevel);
  if (root.triangles.length <= perLeaf) return root;
  const work = [root, 0];
  while (work.length) { const level = work.pop(), node = work.pop(); splitOnce(node, level, perLeaf, maxLevel, work); }
  return root;
}

/**
 * Wie buildColliderOctree, gibt aber alle ~budgetMs den Hauptthread frei (gleicher Baum).
 * @returns {Promise<Octree>}
 */
export async function buildColliderOctreeAsync(pos, { perLeaf = 16, maxLevel = 7, budgetMs = 12 } = {}) {
  const pause = () => new Promise(r => setTimeout(r, 0));
  const root = makeRoot(pos, perLeaf, maxLevel);
  if (root.triangles.length <= perLeaf) return root;
  const work = [root, 0];
  let t0 = performance.now();
  while (work.length) {
    const level = work.pop(), node = work.pop();
    splitOnce(node, level, perLeaf, maxLevel, work);
    if (performance.now() - t0 > budgetMs) { await pause(); t0 = performance.now(); }
  }
  return root;
}
