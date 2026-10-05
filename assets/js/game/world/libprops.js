// NULLPUNKT — Requisiten aus der Asset-Bibliothek (glb mit LOD-Kette) als InstancedMesh (Owner: world).
// Je Modell, Teil-Auswahl, LOD-Stufe und Teilmesh ein InstancedMesh; jedes Bild werden die sichtbaren Instanzen
// (Sichtkegel + Abstand, nahe immer – ihre Schatten fallen ins Bild) nach Abstand auf die LOD-Stufen verteilt und
// kompakt in die Instanzpuffer geschrieben (CPU-Culling, ein Draw Call je Mesh und Stufe, leere Stufen unsichtbar).
// Kollision (Quader aus dem Hüllquader), Kugeltreffer (Dreiecke der gröbsten Stufe), Minikarte/Bodenschatten
// (Footprint) und das gebackene Innenraumlicht (Instanzfarbe) übernimmt der MapBuilder (builder.js: model()).
import * as THREE from 'three';

/** Oberfläche je Modell (Kugeleinschläge, Schritte); Standard 'metal'. */
export const MODEL_SURFACE = {
  wooden_military_crate: 'wood', old_military_crate: 'wood', cardboard_box_01: 'wood', cement_bag: 'sand',
  trashbag: 'fabric', old_tyre: 'fabric', concrete_road_barrier: 'concrete', covered_car: 'fabric',
  industrial_pastic_container: 'fabric', wetfloorsign_01: 'fabric', sofa_01: 'fabric', old_bed_frame: 'metal',
  wooden_bookshelf_worn: 'wood', steel_frame_shelves_01: 'metal', plastic_monobloc_chair_01: 'fabric',
  schoolchair_01: 'metal', television_01: 'glass', dead_tree_trunk_02: 'wood', rock_07: 'concrete',
  planter_pot_clay: 'tile', potted_plant_02: 'tile', shrub_04: 'grass', weed_plant_02: 'grass', water_manhole_cover: 'metal',
};

/** LOD-Abstände je Qualität skalieren (Desktop hält die feinen Stufen länger). */
const LOD_SCALE = { low: 0.8, medium: 1, high: 1.25, ultra: 1.6 };
/** Instanzen innerhalb dieses Abstands werden auch außerhalb des Sichtkegels gezeichnet (Schattenwurf ins Bild). */
const NEAR_ALWAYS = 14;

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _sphere = new THREE.Sphere();

/** Platzierungsmatrix: Position (x,y,z) = Unterkante-Mitte (pivot 'bottom') bzw. Mitte (pivot 'center') des Hüllquaders. */
export function placementMatrix(box, x, y, z, o, out = new THREE.Matrix4()) {
  const s = o.s ?? 1;
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
  _q.setFromEuler(_e);
  _s.set((o.sx ?? 1) * s, (o.sy ?? 1) * s, (o.sz ?? 1) * s);
  out.compose(_p.set(x, y, z), _q, _s);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const py = o.pivot === 'center' ? (box.min.y + box.max.y) / 2 : box.min.y;
  return out.multiply(_m2.makeTranslation(-cx, -py, -cz));
}

/**
 * Gruppen instanzierter Requisiten einer Karte. add() je aufgelöster Platzierung, build() erzeugt die Meshes,
 * update(camera) verteilt jedes Bild die Instanzen auf die Stufen.
 */
export class PropInstances {
  constructor({ quality = 'high' } = {}) {
    this.quality = quality;
    this.lodScale = LOD_SCALE[quality] ?? 1;
    this.groups = new Map(); // `${id}|${part}` → { tpl, parts, inst: [{ matrix, center, radius, color }], meshes: [[...] je Stufe], dists }
    this.meshes = [];
    this.root = new THREE.Group();
    this.root.name = 'lib-props';
    this._last = new THREE.Matrix4();
    this._lastCount = -1;
    this.stats = { instances: 0, groups: 0, meshes: 0, drawn: 0 };
  }

  /** Teil-Auswahl eines Modells: alle Teile oder ein benanntes (Varianten wie „…_rusted“). */
  static selectParts(tpl, part) {
    if (!part) return [...tpl.lods[0].parts.keys()];
    if (tpl.lods[0].parts.has(part)) return [part];
    const hit = [...tpl.lods[0].parts.keys()].find(k => k.startsWith(part));
    return hit ? [hit] : [...tpl.lods[0].parts.keys()];
  }

  /** Hüllquader der Auswahl (LOD0, Modellraum). */
  static boxOf(tpl, parts) {
    if (parts.length === tpl.lods[0].parts.size) return tpl.box;
    const b = new THREE.Box3();
    for (const p of parts) b.union(tpl.partBox.get(p));
    return b;
  }

  /** Instanz hinzufügen. matrix = Platzierungsmatrix (placementMatrix), color = Instanzfarbe (Innenraumlicht/Tönung). */
  add(tpl, parts, matrix, color, o = {}) {
    const key = `${tpl.id}@${tpl.tier}|${parts.join(',')}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { tpl, parts, inst: [], meshes: [], key };
      this.groups.set(key, g);
    }
    const box = PropInstances.boxOf(tpl, parts);
    const center = box.getCenter(new THREE.Vector3()).applyMatrix4(matrix);
    const radius = box.getSize(new THREE.Vector3()).length() / 2 * matrix.getMaxScaleOnAxis();
    const maxDist = o.maxDist ?? (radius < 0.35 ? 32 : radius < 0.8 ? 60 : radius < 1.6 ? 110 : Infinity);
    g.inst.push({ matrix: matrix.clone(), center, radius, color: color ? color.clone() : null, maxDist, cast: o.castShadow !== false });
    this.stats.instances++;
    return g;
  }

  /** InstancedMeshes je Stufe/Teilmesh anlegen (nach allen add()). */
  build() {
    for (const g of this.groups.values()) {
      const n = g.inst.length;
      const lods = g.tpl.lods;
      // Abstände: Manifest (je Stufe), skaliert; Stufe k gilt ab dists[k]
      const d = g.tpl.lodDistances || [0];
      g.dists = lods.map((_, k) => (k === 0 ? 0 : (d[k] ?? d[d.length - 1] * (k + 1)) * this.lodScale));
      const anyColor = g.inst.some(i => i.color);
      for (let k = 0; k < lods.length; k++) {
        const list = [];
        for (const part of g.parts) for (const entry of (lods[k].parts.get(part) || lods[k].parts.get([...lods[k].parts.keys()][0]) || [])) {
          const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, n);
          mesh.name = `prop:${g.tpl.id}:L${k}`;
          mesh.frustumCulled = false; // eigenes Culling je Instanz
          mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.count = 0; mesh.visible = false;
          mesh.userData.shared = true; // Geometrie/Material gehören dem Bibliotheks-Cache
          mesh.userData.surface = MODEL_SURFACE[g.tpl.id] || 'metal';
          // Endmatrizen je Instanz vorab (Platzierung × Teilmatrix)
          const all = new Float32Array(n * 16);
          for (let i = 0; i < n; i++) _m.multiplyMatrices(g.inst[i].matrix, entry.matrix).toArray(all, i * 16);
          mesh.userData.all = all;
          if (anyColor) {
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
            const cols = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) { const c = g.inst[i].color; cols[i * 3] = c ? c.r : 1; cols[i * 3 + 1] = c ? c.g : 1; cols[i * 3 + 2] = c ? c.b : 1; }
            mesh.userData.cols = cols;
          }
          this.root.add(mesh);
          this.meshes.push(mesh);
          list.push(mesh);
        }
        g.meshes.push(list);
      }
      g.level = new Int8Array(n).fill(-1);
      this.stats.groups++;
    }
    this.stats.meshes = this.meshes.length;
    return this.root;
  }

  /** Erste (gröbste-Stufe-)Meshes je Gruppe – Objekte für Kugeltreffer. */
  hitObject(g) { return g.meshes[0]?.[0] || null; }

  /** Sichtbare Instanzen je Stufe kompakt schreiben. */
  update(camera, force = false) {
    if (!camera || !this.meshes.length) return;
    camera.updateMatrixWorld();
    if (!force && this._last.equals(camera.matrixWorld) && this._lastProj === camera.projectionMatrix.elements[0]) return;
    this._last.copy(camera.matrixWorld); this._lastProj = camera.projectionMatrix.elements[0];
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cp = camera.position;
    let drawn = 0;
    for (const g of this.groups.values()) {
      const L = g.meshes.length, counts = new Int32Array(L);
      for (let i = 0; i < g.inst.length; i++) {
        const it = g.inst[i];
        const dist = Math.max(0, cp.distanceTo(it.center) - it.radius * 0.5);
        if (dist > it.maxDist) continue;
        if (dist > NEAR_ALWAYS) { _sphere.set(it.center, it.radius + 1); if (!_frustum.intersectsSphere(_sphere)) continue; }
        // Stufe mit kleiner Hysterese (kein Flackern an der Grenze)
        let lv = 0;
        for (let k = L - 1; k > 0; k--) if (dist >= g.dists[k] * (g.level[i] >= k ? 0.92 : 1)) { lv = k; break; }
        g.level[i] = lv;
        const slot = counts[lv]++;
        for (const mesh of g.meshes[lv]) {
          mesh.instanceMatrix.array.set(mesh.userData.all.subarray(i * 16, i * 16 + 16), slot * 16);
          if (mesh.userData.cols) mesh.instanceColor.array.set(mesh.userData.cols.subarray(i * 3, i * 3 + 3), slot * 3);
        }
      }
      for (let k = 0; k < L; k++) for (const mesh of g.meshes[k]) {
        const c = counts[k];
        mesh.count = c; mesh.visible = c > 0;
        if (c > 0) {
          mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, c * 16); mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, c * 3); mesh.instanceColor.needsUpdate = true; }
          drawn++;
        }
      }
    }
    this.stats.drawn = drawn;
  }

  /** Alle Instanzen in Stufe 0 sichtbar schalten (Shader-Vorwärmen, Prüfseiten). */
  showAll() {
    for (const g of this.groups.values()) for (let k = 0; k < g.meshes.length; k++) for (const mesh of g.meshes[k]) {
      const n = g.inst.length;
      mesh.instanceMatrix.array.set(mesh.userData.all);
      if (mesh.userData.cols) mesh.instanceColor.array.set(mesh.userData.cols);
      mesh.count = n; mesh.visible = n > 0;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.needsUpdate = true; }
    }
    this._lastProj = null;
  }

  dispose() {
    for (const m of this.meshes) { m.removeFromParent(); m.dispose(); }
    this.meshes.length = 0;
    this.groups.clear();
  }
}

/**
 * Kugeltreffer-Dreiecke einer Platzierung aus der gröbsten Stufe (Weltkoordinaten) anhängen.
 * push(x0,y0,z0, x1,y1,z1, x2,y2,z2) je Dreieck.
 */
export function forEachBulletTri(tpl, parts, matrix, push) {
  const lv = tpl.lods[tpl.lods.length - 1];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const part of parts) for (const entry of (lv.parts.get(part) || [])) {
    const g = entry.geometry, pos = g.attributes.position, idx = g.index;
    _m.multiplyMatrices(matrix, entry.matrix);
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t + k) : t + k;
        v[k].fromBufferAttribute(pos, i).applyMatrix4(_m);
      }
      push(v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z);
    }
  }
}
