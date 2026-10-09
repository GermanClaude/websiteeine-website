// NULLPUNKT — Leichen, die liegen bleiben (Nutzerwunsch 08.10., WUENSCHE.md „LEICHEN“).
//
// Kommt eine Ragdoll zur Ruhe (oder kurz bevor sie sich früher aufgelöst hätte), friert der Bot sie hier ein: die
// Endpose (Knochenmatrizen) wird kopiert, der Soldat selbst sofort wieder frei (Wiederverwendung beim Respawn).
// Eingefrorene Leichen kosten keine Animation und kein Skinning-Update je Bild:
//   • je Schema (Material) und 24-m-Zelle EIN SkinnedMesh („Paket“, höchstens 16 Leichen): Geometrie der Detailstufe
//     hintereinander kopiert (Bindepose bleibt → Tarnmuster/Shader unverändert), skinIndex je Leiche verschoben,
//   • ein gemeinsames Skelett je Paket mit festen Matrizen; skeleton.update() ist abgeschaltet → die Knochentextur
//     wird einmal hochgeladen, danach nie wieder (kein CPU-/GPU-Aufwand je Bild außer dem Zeichnen),
//   • Paket = 1 Draw Call mit Kugel für Frustum-Culling; Waffen am Boden als statische Kopien (nur die jüngsten).
// Grenzen: Einstellung „Leichen“ (bleiben | 10min | 2min) und eine Obergrenze je Grafikstufe – darüber verschwindet
// die älteste Leiche zuerst. Leichen sind reine Optik (keine Treffer, keine Kollision) und überall lokal (offline,
// Host, Clients). Prüfhilfe: G.bots.corpses.stats(), .debugFill(n).
import * as THREE from 'three';
import { BONE_COUNT } from './soldier/rig.js';
import { soldierMaterial, releaseSoldierMaterial } from './soldier/materials.js';

/** Obergrenze je Grafikstufe (gemessen: tools/out/corpses-*.json, siehe Changelog). */
export const CORPSE_CAP = Object.freeze({ low: 24, medium: 48, high: 96, ultra: 160 });
/** Waffen am Boden (statische Kopien, je 2–4 Draw Calls): nur für die jüngsten Leichen. */
export const GUN_CAP = Object.freeze({ low: 6, medium: 12, high: 24, ultra: 40 });
/** Einstellung „Leichen“ → Lebensdauer in Sekunden. */
export const CORPSE_LIFE = Object.freeze({ bleiben: Infinity, '10min': 600, '2min': 120 });

const CELL = 24; // m, Zellgröße der Pakete (Frustum-Culling)
const PACK_MAX = 16; // Leichen je Paket (Neubau ≈ 16 × Detailstufe – selten, nie mehrere je Bild)
const REBUILDS_PER_FRAME = 2;
const GRACE = 20; // s: abgelaufene Leichen im Blick verschwinden erst so viel später (kein Wegploppen vor den Augen)

const DUMMY_BONE = new THREE.Bone();
const IDENTITY = new THREE.Matrix4();
const NOOP = () => {};
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Sphere();

let serial = 0;

export class CorpseStore {
  constructor(mgr) {
    this.mgr = mgr;
    this.root = new THREE.Group();
    this.root.name = 'leichen';
    this.root.matrixAutoUpdate = false;
    this.packs = new Map(); // key → Paket
    this.order = []; // Leichen in Ablagereihenfolge (älteste zuerst)
    this.guns = []; // Leichen mit Waffenkopie (älteste zuerst)
    this._dirty = new Set();
    this._checkT = 0;
    this.counts = { added: 0, removedCap: 0, removedTime: 0, rebuilds: 0, gunsDropped: 0 };
  }

  get tier() { const t = this.mgr && this.mgr.tier; return CORPSE_CAP[t] ? t : 'high'; }
  get cap() { return CORPSE_CAP[this.tier]; }
  get gunCap() { return GUN_CAP[this.tier]; }

  /** Lebensdauer aus der Einstellung (s; Infinity = bleiben liegen). */
  life() {
    const G = this.mgr && this.mgr.G;
    const v = G && G.settings && typeof G.settings.get === 'function' ? G.settings.get('leichen') : 'bleiben';
    return CORPSE_LIFE[v] ?? Infinity;
  }

  /** Ist die Leiche bereit zum Einfrieren? Ragdoll ruht und Waffe liegt – spätestens vor dem früheren Auflösen (4,5 s). */
  ready(s, dt = 0) {
    if (!s || s.state !== 'dead') return false;
    const drop = s._drop;
    const gunDone = !drop || drop.rest || drop.t > 2.5;
    return (s.ragdoll && s.ragdoll.asleep && gunDone && s.deadT > 0.4) || s.deadT + dt >= 4.35;
  }

  /**
   * Leiche eines Soldaten übernehmen (aktuelle Pose; danach darf der Soldat versteckt/wiederverwendet werden).
   * offset: optionale Weltmatrix davor (Prüfhilfe debugFill). → Datensatz oder null
   */
  add(s, offset = null) {
    if (!s || !s.skeleton || !s.meshes) return null;
    const G = this.mgr.G;
    const scene = this.mgr.scene || (G && G.scene);
    if (!scene) return null;
    if (!this.root.parent) scene.add(this.root);
    // Detailstufe: Telefone die ferne Stufe (≈ ⅓ der Dreiecke), sonst die mittlere
    const lod = this.tier === 'low' ? 2 : 1;
    const geo = (s.meshes[lod] || s.meshes[1] || s.meshes[0]).geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return null;
    s.root.updateMatrixWorld(true);
    const mats = new Float32Array(BONE_COUNT * 16);
    const inv = s.skeleton.boneInverses;
    for (let i = 0; i < BONE_COUNT; i++) {
      _m.multiplyMatrices(s.bones[i].matrixWorld, inv[i] || IDENTITY);
      if (offset) _m.premultiply(offset);
      _m.toArray(mats, i * 16);
    }
    // Lage (Becken) für Zelle und Culling
    const hip = s.bones[0];
    const pos = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
    if (offset) pos.applyMatrix4(offset);
    const rec = { id: ++serial, geo, mats, pos, t: this._now(), pack: null, gun: null, scheme: s.scheme, quality: s.quality };
    // Waffe am Boden: statische Kopie (geteilte Geometrie/Materialien)
    const drop = s._drop;
    if (drop && drop.gun && drop.gun.visible !== false) rec.gun = this._gunCopy(drop.gun, offset);
    this._place(rec);
    this.order.push(rec);
    if (rec.gun) { this.guns.push(rec); this._trimGuns(); }
    this.counts.added++;
    // Obergrenze: älteste zuerst
    while (this.order.length > this.cap) { this._remove(this.order[0]); this.counts.removedCap++; }
    return rec;
  }

  _now() { const G = this.mgr && this.mgr.G; return (G && G.time && G.time.elapsed) || 0; }

  _gunCopy(gun, offset) {
    gun.updateMatrixWorld(true);
    const g = new THREE.Group();
    g.name = 'leiche-waffe';
    g.matrixAutoUpdate = false;
    gun.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.material) return;
      for (let p = o; p && p !== gun.parent; p = p.parent) if (p.visible === false) return;
      const m = new THREE.Mesh(o.geometry, o.material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(o.matrixWorld);
      if (offset) m.matrix.premultiply(offset);
      m.castShadow = false;
      m.receiveShadow = false;
      m.raycast = NOOP;
      g.add(m);
    });
    if (!g.children.length) return null;
    this.root.add(g);
    g.updateMatrixWorld(true);
    return g;
  }

  _trimGuns() {
    while (this.guns.length > this.gunCap) {
      const r = this.guns.shift();
      if (r.gun) { r.gun.removeFromParent(); r.gun = null; this.counts.gunsDropped++; }
    }
  }

  _place(rec) {
    const cx = Math.floor(rec.pos.x / CELL), cz = Math.floor(rec.pos.z / CELL);
    const base = `${rec.scheme}:${rec.quality}|${cx},${cz}`;
    let pack = null;
    for (let n = 0; n < 64; n++) {
      const key = n ? `${base}#${n}` : base;
      const p = this.packs.get(key);
      if (!p) { pack = { key, scheme: rec.scheme, quality: rec.quality, corpses: [], mesh: null, skeleton: null, material: null }; this.packs.set(key, pack); break; }
      if (p.corpses.length < PACK_MAX) { pack = p; break; }
    }
    if (!pack) return;
    rec.pack = pack;
    pack.corpses.push(rec);
    this._dirty.add(pack);
  }

  _remove(rec) {
    const i = this.order.indexOf(rec);
    if (i >= 0) this.order.splice(i, 1);
    const gi = this.guns.indexOf(rec);
    if (gi >= 0) this.guns.splice(gi, 1);
    if (rec.gun) { rec.gun.removeFromParent(); rec.gun = null; }
    const p = rec.pack;
    if (p) {
      const k = p.corpses.indexOf(rec);
      if (k >= 0) p.corpses.splice(k, 1);
      this._dirty.add(p);
    }
    rec.pack = null;
  }

  /** Paket neu bauen: Geometrie zusammenkopieren, festes Skelett, Kugel fürs Culling. */
  _build(pack) {
    const list = pack.corpses;
    this._disposeMesh(pack);
    if (!list.length) {
      if (pack.material) { this._releaseMaterial(pack.material); pack.material = null; }
      this.packs.delete(pack.key);
      return;
    }
    this.counts.rebuilds++;
    let nV = 0, nI = 0;
    for (const c of list) { const n = c.geo.attributes.position.count; nV += n; nI += c.geo.index ? c.geo.index.count : n; }
    const geo = new THREE.BufferGeometry();
    const g0 = list[0].geo;
    for (const name of Object.keys(g0.attributes)) {
      const a0 = g0.attributes[name];
      const size = a0.itemSize;
      const skin = name === 'skinIndex';
      const Arr = skin ? Uint16Array : a0.array.constructor;
      const arr = new Arr(nV * size);
      let o = 0;
      for (let k = 0; k < list.length; k++) {
        const a = list[k].geo.attributes[name];
        const cnt = list[k].geo.attributes.position.count;
        if (a && a.itemSize === size && !a.isInterleavedBufferAttribute) {
          const src = a.array.length === cnt * size ? a.array : a.array.subarray(0, cnt * size);
          if (skin) { const b = k * BONE_COUNT; for (let i = 0; i < src.length; i++) arr[o + i] = src[i] + b; }
          else arr.set(src, o);
        }
        o += cnt * size;
      }
      geo.setAttribute(name, new THREE.BufferAttribute(arr, size, a0.normalized));
    }
    const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
    let io = 0, vo = 0;
    for (const c of list) {
      const n = c.geo.attributes.position.count;
      if (c.geo.index) { const src = c.geo.index.array; for (let i = 0; i < c.geo.index.count; i++) idx[io++] = src[i] + vo; }
      else for (let i = 0; i < n; i++) idx[io++] = vo + i;
      vo += n;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // festes Skelett: Matrizen der Leichen hintereinander, kein Update je Bild
    const nb = list.length * BONE_COUNT;
    const skeleton = new THREE.Skeleton(new Array(nb).fill(DUMMY_BONE), new Array(nb).fill(IDENTITY));
    for (let k = 0; k < list.length; k++) skeleton.boneMatrices.set(list[k].mats, k * BONE_COUNT * 16);
    skeleton.update = NOOP;
    if (!pack.material) pack.material = this._material(pack.scheme, pack.quality);
    const mesh = new THREE.SkinnedMesh(geo, pack.material);
    mesh.name = `leichen:${pack.key}`;
    mesh.bind(skeleton, IDENTITY);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = NOOP;
    // Kugel über alle Becken (+ Körperlänge)
    const c = _v.set(0, 0, 0);
    for (const r of list) c.add(r.pos);
    c.multiplyScalar(1 / list.length);
    let rad = 0;
    for (const r of list) rad = Math.max(rad, r.pos.distanceTo(c));
    mesh.boundingSphere = new THREE.Sphere(c.clone(), rad + 1.8);
    this.root.add(mesh);
    mesh.updateMatrixWorld(true);
    pack.mesh = mesh;
    pack.skeleton = skeleton;
  }

  /** Eigenes Material (Pool) je Paket: Randlicht/Mindesthelligkeit der Lebenden gedämpft (Tote leuchten nicht nach). */
  _material(scheme, quality) {
    const m = soldierMaterial(scheme, { quality });
    const u = m.userData.npU;
    if (u) {
      m.userData.corpseRestore = { rim: u.uRim.value, floor: u.uLightFloor.value };
      u.uRim.value *= 0.35;
      u.uLightFloor.value *= 0.4;
    }
    return m;
  }

  _releaseMaterial(m) {
    const u = m.userData.npU, r = m.userData.corpseRestore;
    if (u && r) { u.uRim.value = r.rim; u.uLightFloor.value = r.floor; }
    delete m.userData.corpseRestore;
    releaseSoldierMaterial(m);
  }

  _disposeMesh(pack) {
    if (pack.mesh) {
      pack.mesh.removeFromParent();
      pack.mesh.geometry.dispose();
      pack.mesh = null;
    }
    if (pack.skeleton) { pack.skeleton.dispose(); pack.skeleton = null; }
  }

  /** Je Bild (BotManager.update): Pakete nachbauen (höchstens 2), Lebensdauer prüfen (1×/s). frustum: Kamera oder null. */
  update(dt, frustum = null) {
    if (this._dirty.size) {
      let n = 0;
      for (const p of this._dirty) {
        this._dirty.delete(p);
        this._build(p);
        if (++n >= REBUILDS_PER_FRAME) break;
      }
    }
    this._checkT -= dt;
    if (this._checkT > 0 || !this.order.length) return;
    this._checkT = 1;
    const life = this.life();
    if (life === Infinity) return;
    const now = this._now();
    for (let i = 0; i < this.order.length; i++) {
      const r = this.order[i];
      const age = now - r.t;
      if (age < life) break; // Reihenfolge = Alter
      if (age < life + GRACE && frustum) { _s.center.copy(r.pos); _s.radius = 1.5; if (frustum.intersectsSphere(_s)) continue; }
      this._remove(r);
      this.counts.removedTime++;
      i--;
    }
  }

  /** Alles entfernen (Matchende, Kartenwechsel). */
  clear() {
    for (const r of this.order) if (r.gun) r.gun.removeFromParent();
    this.order.length = 0;
    this.guns.length = 0;
    this._dirty.clear();
    for (const p of this.packs.values()) {
      this._disposeMesh(p);
      if (p.material) { this._releaseMaterial(p.material); p.material = null; }
    }
    this.packs.clear();
    this.root.removeFromParent();
  }

  /** Kennzahlen (Prüfstand): Leichen, Pakete/Draw Calls, Dreiecke, Speicher der Pakete. */
  stats() {
    let tris = 0, bytes = 0, packs = 0, gunMeshes = 0;
    for (const p of this.packs.values()) {
      if (!p.mesh) continue;
      packs++;
      const g = p.mesh.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const a of Object.values(g.attributes)) bytes += a.array.byteLength;
      if (g.index) bytes += g.index.array.byteLength;
    }
    for (const r of this.guns) if (r.gun) gunMeshes += r.gun.children.length;
    return { corpses: this.order.length, cap: this.cap, tier: this.tier, life: this.life(), packs, guns: this.guns.filter((r) => r.gun).length, gunMeshes, triangles: Math.round(tris), kb: Math.round(bytes / 1024), pending: this._dirty.size, ...this.counts };
  }

  /**
   * Prüfhilfe: n Leichen aus den Posen vorhandener Soldaten an zufälligen Navigationspunkten ablegen (keine Bots
   * werden getötet). → stats()
   */
  debugFill(n = 50) {
    const G = this.mgr.G;
    const src = this.mgr.bots.map((b) => b.soldier).filter((s) => s && s.state === 'alive');
    const nodes = (G.world && G.world.nav && G.world.nav.nodes) || [];
    if (!src.length) return this.stats();
    for (let i = 0; i < n; i++) {
      const s = src[i % src.length];
      const node = nodes.length ? nodes[(Math.random() * nodes.length) | 0] : null;
      const p = node ? node.position : _v.set((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60);
      s.root.updateMatrixWorld(true);
      // liegend: um die Füße auf den Rücken kippen (Modell-z wird oben), an den Zielpunkt schieben
      const off = new THREE.Matrix4().makeTranslation(p.x, p.y + 0.14, p.z)
        .multiply(new THREE.Matrix4().makeRotationY(Math.random() * 6.28))
        .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
        .multiply(new THREE.Matrix4().copy(s.root.matrixWorld).invert());
      this.add(s, off);
    }
    return this.stats();
  }
}
