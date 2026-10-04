// NULLPUNKT — Kollisions-Octree mit begrenzter Tiefe (Owner: world)
// three/addons Octree teilt mit festen Standardwerten (8 Dreiecke/Blatt, 16 Ebenen) – an Ecken, wo viele
// Dreiecke zusammentreffen, entstehen so Millionen winziger Blätter (Sekunden Ladezeit). Hier wird mit
// eigenen Grenzen auf allen Ebenen geteilt; das Ergebnis ist eine normale Octree-Instanz (gleiche Abfrage-API:
// capsuleIntersect, sphereIntersect, rayIntersect, getCapsuleTriangles, triangleCapsuleIntersect …).
import { Box3, Triangle, Vector3 } from 'three';
import { Octree } from 'three/addons/math/Octree.js';

const _half = new Vector3(), _v = new Vector3();

function split(node, level, perLeaf, maxLevel) {
  _half.copy(node.box.max).sub(node.box.min).multiplyScalar(0.5);
  const half = _half.clone();
  const subs = [];
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
    const box = new Box3();
    box.min.copy(node.box.min).add(_v.set(x, y, z).multiply(half));
    box.max.copy(box.min).add(half);
    const sub = new Octree(box);
    sub.trianglesPerLeaf = perLeaf; sub.maxLevel = maxLevel;
    subs.push(sub);
  }
  let tri;
  while ((tri = node.triangles.pop())) for (const s of subs) if (s.box.intersectsTriangle(tri)) s.triangles.push(tri);
  for (const s of subs) {
    const len = s.triangles.length;
    if (len > perLeaf && level < maxLevel) split(s, level + 1, perLeaf, maxLevel);
    if (len !== 0) node.subTrees.push(s);
  }
}

/**
 * Baut einen Octree aus einem Dreiecks-Array (je 9 Floats, Weltkoordinaten).
 * @param {Float32Array} pos
 * @param {{ perLeaf?: number, maxLevel?: number }} [o]
 * @returns {Octree}
 */
export function buildColliderOctree(pos, { perLeaf = 16, maxLevel = 7 } = {}) {
  const root = new Octree();
  root.trianglesPerLeaf = perLeaf; root.maxLevel = maxLevel;
  for (let i = 0; i + 8 < pos.length; i += 9) {
    root.addTriangle(new Triangle(new Vector3(pos[i], pos[i + 1], pos[i + 2]), new Vector3(pos[i + 3], pos[i + 4], pos[i + 5]), new Vector3(pos[i + 6], pos[i + 7], pos[i + 8])));
  }
  root.calcBox();
  if (root.triangles.length > perLeaf) split(root, 0, perLeaf, maxLevel);
  return root;
}
