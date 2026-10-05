// NULLPUNKT — Asset-Bibliothek zur Laufzeit (reines three.js, keine Spiel-Importe).
//
// Lädt die von tools/assets/ erzeugten Assets aus assets/lib/manifest.json:
//   loadTextureSet(id, tier)   → { map, normalMap, ormMap, … } (KTX2/Basis, transkodiert je nach GPU)
//   createMaterial(id, opts)   → MeshStandardMaterial (ORM: aoMap/roughnessMap/metalnessMap teilen eine Textur)
//   loadHDRI(id, renderer)     → { envMap (PMREM), background, sunDirection, … }
//   loadModel(id, tier, opts)  → Object3D (THREE.LOD bei LOD-Ketten; Klone teilen Geometrie/Materialien)
//   budget()                   → geladene Bytes + geschätzter GPU-Speicher
// Stufen: 512 (low/Handy), 1024 (medium/high), 2048 (ultra, nur Helden-Materialien/Waffen) — tierFor(quality).
//
// Seiten brauchen die Import-Map des Projekts ("three", "three/addons/"). Der Basis-Transcoder liegt unter
// assets/vendor/three/addons/libs/basis/ und wird relativ zu diesem Modul gefunden.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const LIB_URL = new URL('./', import.meta.url);
const TRANSCODER_URL = new URL('../vendor/three/addons/libs/basis/', import.meta.url).href;

/** Qualitätsstufe → Texturstufe. HDR-Beleuchtung: low 512, sonst 1024. */
export const QUALITY_TIER = { low: 512, medium: 1024, high: 1024, ultra: 2048 };
export const HDRI_TIER = { low: 512, medium: 1024, high: 1024, ultra: 1024 };

/** Stufe für eine Qualität ('auto' → high). kind: 'texture' | 'model' | 'hdri' */
export function tierFor(quality = 'high', kind = 'texture') {
  const q = QUALITY_TIER[quality] ? quality : 'high';
  return kind === 'hdri' ? HDRI_TIER[q] : QUALITY_TIER[q];
}

/** Beste vorhandene Stufe ≤ Wunsch (sonst die kleinste). */
export function pickTier(tiers, want) {
  const avail = Object.keys(tiers).map(Number).sort((a, b) => a - b);
  let best = avail[0];
  for (const t of avail) if (t <= want) best = t;
  return best;
}

const sumGpu = (a, b) => ({ desktop: a.desktop + b.desktop, mobile: a.mobile + b.mobile, rgba8: a.rgba8 + b.rgba8 });
const GPU0 = () => ({ desktop: 0, mobile: 0, rgba8: 0 });

function disposeObject(root) {
  const mats = new Set(), texs = new Set();
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material; if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) mats.add(mm);
  });
  for (const m of mats) { for (const v of Object.values(m)) if (v && v.isTexture) texs.add(v); m.dispose(); }
  for (const t of texs) t.dispose();
}

export class AssetLibrary {
  /**
   * @param {{ renderer?: THREE.WebGLRenderer, quality?: string, baseUrl?: string|URL, manifest?: object, anisotropy?: number }} [opts]
   */
  constructor({ renderer = null, quality = 'high', baseUrl = LIB_URL, manifest = null, anisotropy = null } = {}) {
    this.baseUrl = new URL(baseUrl, location.href);
    this.quality = quality;
    this.renderer = null;
    this.anisotropy = anisotropy;
    this._manifest = manifest;
    this._manifestPromise = null;
    this._ktx2 = null;
    this._gltf = null;
    this._hdr = new HDRLoader().setDataType(THREE.HalfFloatType);
    this._sets = new Map();      // `${id}@${tier}` → Promise<TextureSet>
    this._hdris = new Map();     // `${id}@${tier}` → Promise<HDRI>
    this._models = new Map();    // `${id}@${tier}` → Promise<{ template, meta }>
    this._loaded = new Map();    // Asset-Schlüssel → { type, id, tier, paths } (für budget())
    this._res = new Map();       // Ressource (Datei bzw. PMREM) → { bytes, gpu } — geteilte Dateien zählen einmal
    this.downloadedBytes = 0;    // kumuliert in dieser Sitzung
    if (renderer) this.setRenderer(renderer);
  }

  /** Renderer setzen (nötig für KTX2-Formaterkennung und PMREM). */
  setRenderer(renderer) {
    if (this.renderer === renderer) return this;
    this.renderer = renderer;
    if (this._ktx2) { this._ktx2.dispose(); this._ktx2 = null; this._gltf = null; }
    if (this.anisotropy == null) this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
    return this;
  }

  setQuality(q) { this.quality = q; return this; }

  /** Manifest laden (einmalig). */
  async ready() {
    if (this._manifest) return this._manifest;
    if (!this._manifestPromise) {
      this._manifestPromise = fetch(new URL('manifest.json', this.baseUrl)).then((r) => {
        if (!r.ok) throw new Error(`Asset-Manifest nicht ladbar (${r.status})`);
        return r.json();
      }).then((m) => (this._manifest = m));
    }
    return this._manifestPromise;
  }
  get manifest() { return this._manifest; }

  tierFor(kind = 'texture', quality = this.quality) { return tierFor(quality, kind); }

  /**
   * Bibliothekssatz für einen getMaterial()-Namen des Spiels (engine/textures.js), z. B. 'concrete' → 'concrete_floor_worn',
   * 'container_red' → 'container' (einfärbbar: Farbe gibt der Aufrufer über createMaterial(id, { color }) vor). → id | null
   */
  replacementFor(gameMaterialName) {
    const m = this._manifest;
    if (!m) return null;
    for (const [id, e] of Object.entries(m.textures)) if (e.replaces?.includes(gameMaterialName)) return id;
    return null;
  }

  _url(p) { return new URL(p, this.baseUrl).href; }

  _ktx() {
    if (!this.renderer) throw new Error('AssetLibrary: zuerst setRenderer(renderer) aufrufen (KTX2-Formaterkennung)');
    if (!this._ktx2) {
      const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
      this._ktx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_URL).setWorkerLimit(Math.max(1, Math.min(4, hc - 1))).detectSupport(this.renderer);
    }
    return this._ktx2;
  }

  _gltfLoader() {
    if (!this._gltf) this._gltf = new GLTFLoader().setKTX2Loader(this._ktx()).setMeshoptDecoder(MeshoptDecoder);
    return this._gltf;
  }

  /** Ressource verbuchen (einmal je Pfad). gpu: { desktop, mobile, rgba8 } */
  _track(path, bytes = 0, gpu = GPU0()) {
    if (this._res.has(path)) return;
    this._res.set(path, { bytes, gpu });
    this.downloadedBytes += bytes;
  }
  _untrack(paths) {
    // nur freigeben, wenn kein anderes geladenes Asset die Ressource noch nutzt
    const still = new Set();
    for (const a of this._loaded.values()) for (const p of a.paths) still.add(p);
    for (const p of paths) if (!still.has(p)) this._res.delete(p);
  }

  async _entry(kind, id) {
    const m = await this.ready();
    const e = m[kind]?.[id];
    if (!e) throw new Error(`Asset unbekannt: ${kind}/${id}`);
    return e;
  }

  // -------------------------------------------------------------------------------------------
  // Texturen
  // -------------------------------------------------------------------------------------------
  /**
   * PBR-Satz laden. tier: 512 | 1024 | 2048 (Standard: aus der Qualität; nimmt die beste vorhandene ≤ Wunsch).
   * → { id, tier, map, normalMap, ormMap, meta, sizeM, detailRepeat }
   */
  async loadTextureSet(id, tier) {
    const e = await this._entry('textures', id);
    const t = pickTier(e.tiers, tier || this.tierFor('texture'));
    const key = `${id}@${t}`;
    if (!this._sets.has(key)) {
      const files = e.tiers[t];
      const p = (async () => {
        const ktx = this._ktx();
        const load = async (path, kind) => {
          const tex = await ktx.loadAsync(this._url(path));
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = this.anisotropy || 1;
          tex.name = `${id}:${kind}`;
          return tex;
        };
        let map, normalMap, ormMap;
        if (files.shared) {
          // Tarnmuster: Normal/ORM vom Basis-Satz (Klone teilen die GPU-Textur), eigene feinere Wiederholung
          const base = await this.loadTextureSet(files.shared.normal, t);
          map = await load(files.albedo, 'albedo');
          normalMap = base.normalMap.clone(); ormMap = base.ormMap.clone();
          base.dependents = (base.dependents || 0) + 1;
        } else {
          [map, normalMap, ormMap] = await Promise.all([load(files.albedo, 'albedo'), load(files.normal, 'normal'), load(files.orm, 'orm')]);
        }
        if (e.detailRepeat) for (const tex of [normalMap, ormMap]) tex.repeat.set(e.detailRepeat, e.detailRepeat);
        const paths = ['albedo', 'normal', 'orm'].map((k) => files[k]);
        for (const k of ['albedo', 'normal', 'orm']) this._track(files[k], files.sizes?.[k], files.gpuFiles?.[k]);
        this._loaded.set(`tex:${key}`, { type: 'texture', id, tier: t, paths });
        return { id, tier: t, map, normalMap, ormMap, meta: e, sizeM: e.sizeM, detailRepeat: e.detailRepeat || 1, materials: new Set() };
      })();
      p.catch(() => this._sets.delete(key));
      this._sets.set(key, p);
    }
    return this._sets.get(key);
  }

  /**
   * Material aus einem Satz. opts: tier, color (Tönung; sinnvoll bei tintable), roughness/metalness (Multiplikatoren,
   * Standard 1 bzw. 1 — die ORM-Karte bestimmt die Werte), envMapIntensity, normalScale, aoMapIntensity, side,
   * alphaTest (Standard 0.5 bei alpha-Sätzen), transparent.
   * Setzt material.userData = { assetId, surface, sizeM } (surface wie getMaterial() im Spiel).
   */
  async createMaterial(id, opts = {}) {
    const set = typeof id === 'object' ? id : await this.loadTextureSet(id, opts.tier);
    const e = set.meta;
    const m = new THREE.MeshStandardMaterial({
      name: `lib:${set.id}`,
      map: set.map, normalMap: set.normalMap,
      aoMap: set.ormMap, roughnessMap: set.ormMap, metalnessMap: set.ormMap,
      roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 1,
      color: opts.color != null ? new THREE.Color(opts.color) : 0xffffff,
      envMapIntensity: opts.envMapIntensity ?? 1,
      aoMapIntensity: opts.aoMapIntensity ?? 1,
      side: opts.side ?? (e.alpha ? THREE.DoubleSide : THREE.FrontSide),
      alphaTest: opts.alphaTest ?? (e.alpha ? 0.5 : 0),
      transparent: !!opts.transparent,
    });
    if (opts.normalScale != null) m.normalScale.setScalar(opts.normalScale);
    m.userData = { assetId: set.id, surface: e.surface, sizeM: e.sizeM, tier: set.tier };
    set.materials.add(m);
    return m;
  }

  // -------------------------------------------------------------------------------------------
  // HDRIs
  // -------------------------------------------------------------------------------------------
  /**
   * Umgebung laden: PMREM für envMap (Beleuchtung/Reflexion) + vorab getonemappter Himmel (sRGB, KTX2).
   * opts: tier (512|1024), background (true), pmrem (true).
   * → { id, tier, envMap, background, sunDirection: Vector3, sun, backgroundExposure, meta, createSky(opts), dispose() }
   * Sichtbarer Himmel: createSky() (Kuppel mit der komprimierten Textur, ~2,7 MB GPU bei 2048×1024) statt
   * scene.background = background (three rechnet dann in eine unkomprimierte Würfelkarte um: 6×1024²×4 B ≈ 25 MB).
   */
  async loadHDRI(id, renderer = this.renderer, opts = {}) {
    if (renderer && renderer !== this.renderer) this.setRenderer(renderer);
    if (!this.renderer) throw new Error('loadHDRI: Renderer fehlt');
    const e = await this._entry('hdris', id);
    const t = pickTier(e.tiers, opts.tier || this.tierFor('hdri'));
    const key = `${id}@${t}:${opts.background !== false ? 'bg' : ''}${opts.pmrem !== false ? 'env' : ''}`;
    if (!this._hdris.has(key)) {
      const files = e.tiers[t];
      const p = (async () => {
        let envMap = null, background = null;
        if (opts.pmrem !== false) {
          const eq = await this._hdr.loadAsync(this._url(files.hdr));
          eq.mapping = THREE.EquirectangularReflectionMapping;
          const pm = new THREE.PMREMGenerator(this.renderer);
          const rt = pm.fromEquirectangular(eq);
          envMap = rt.texture;
          envMap.name = `${id}:env`;
          eq.dispose(); pm.dispose();
          this._track(files.hdr, files.sizes?.hdr, files.gpuParts?.pmrem);
        }
        if (opts.background !== false) {
          background = await this._ktx().loadAsync(this._url(files.background));
          background.mapping = THREE.EquirectangularReflectionMapping;
          background.name = `${id}:background`;
          background.colorSpace = THREE.SRGBColorSpace;
          background.minFilter = THREE.LinearFilter; // Datei ohne Mipmaps (sonst unvollständige Würfelkarte bei scene.background)
          background.generateMipmaps = false;
          this._track(files.background, files.sizes?.background, files.gpuParts?.background);
        }
        const s = e.sun.dir;
        const rec = { id, tier: t, envMap, background, sunDirection: new THREE.Vector3(s[0], s[1], s[2]).normalize(), sun: e.sun, backgroundExposure: e.backgroundExposure, luminance: e.luminance, meta: e };
        const paths = [envMap && files.hdr, background && files.background].filter(Boolean);
        this._loaded.set(`hdri:${key}`, { type: 'hdri', id, tier: t, paths });
        rec.createSky = (o) => createSky(rec, o);
        rec.dispose = () => { envMap?.dispose(); background?.dispose(); this._hdris.delete(key); this._loaded.delete(`hdri:${key}`); this._untrack(paths); };
        return rec;
      })();
      p.catch(() => this._hdris.delete(key));
      this._hdris.set(key, p);
    }
    return this._hdris.get(key);
  }

  // -------------------------------------------------------------------------------------------
  // Modelle
  // -------------------------------------------------------------------------------------------
  /**
   * Modell laden → neuer Klon (Geometrie/Materialien geteilt). tier wie oben.
   * opts: lod (true: THREE.LOD aus LOD0/LOD1/LOD2; false: nur LOD0), part (Name eines Teils eines Baukastens/
   * Modells → nur dieses Teil), castShadow (true), receiveShadow (true).
   * userData: { assetId, tier, size, radius, parts }
   */
  async loadModel(id, tier, opts = {}) {
    const e = await this._entry('models', id);
    const t = pickTier(e.tiers, tier || this.tierFor('model'));
    const key = `${id}@${t}`;
    if (!this._models.has(key)) {
      const files = e.tiers[t];
      const p = (async () => {
        const gltf = await this._gltfLoader().loadAsync(this._url(files.glb));
        const scene = gltf.scene;
        scene.traverse((o) => {
          if (o.isMesh) {
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = this.anisotropy || 1;
              m.userData.assetId = id;
            }
          }
        });
        this._track(files.glb, files.bytes, files.gpu);
        this._loaded.set(`model:${key}`, { type: 'model', id, tier: t, paths: [files.glb] });
        return { scene, meta: e, tierMeta: files };
      })();
      p.catch(() => this._models.delete(key));
      this._models.set(key, p);
    }
    const { scene, meta, tierMeta } = await this._models.get(key);
    let out;
    const lodNodes = ['LOD0', 'LOD1', 'LOD2'].map((n) => scene.getObjectByName(n)).filter(Boolean);
    if (opts.part) {
      // Teile heißen wie im Original; in verschobenen Handy-Stufen tragen sie das Suffix _LOD1
      const src = scene.getObjectByName(opts.part) || scene.getObjectByName(`${opts.part}_LOD1`);
      if (!src) throw new Error(`${id}: Teil „${opts.part}“ fehlt (vorhanden: ${meta.parts.join(', ')})`);
      out = src.clone(true);
      out.position.set(0, 0, 0);
    } else if (lodNodes.length > 1 && opts.lod !== false) {
      out = new THREE.LOD();
      // Handy-Stufe ohne volle Geometrie (lodShift): eigene Abstände je Stufe
      const d = tierMeta.lodDistances || meta.lodDistances || [0, 10, 30];
      lodNodes.forEach((n, i) => out.addLevel(n.clone(true), d[i] ?? d[d.length - 1] * (i + 1), 0.05));
    } else {
      out = new THREE.Group();
      const src = lodNodes[0] || scene;
      for (const c of src.children) out.add(c.clone(true));
    }
    out.name = id;
    const cast = opts.castShadow ?? true, recv = opts.receiveShadow ?? true;
    out.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = recv; } });
    out.userData = { assetId: id, tier: t, size: meta.size, radius: meta.radius, parts: meta.parts };
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Aufräumen + Budget
  // -------------------------------------------------------------------------------------------
  /** Ein Asset (alle Stufen) freigeben. Bereits erzeugte Klone/Materialien werden mit entsorgt. */
  async dispose(id) {
    for (const [key, p] of [...this._sets]) if (key.startsWith(id + '@')) {
      const s = await p.catch(() => null);
      if (s) { for (const m of s.materials) m.dispose(); s.map.dispose(); s.normalMap.dispose(); s.ormMap.dispose(); }
      const paths = this._loaded.get(`tex:${key}`)?.paths || [];
      this._sets.delete(key); this._loaded.delete(`tex:${key}`); this._untrack(paths);
    }
    for (const [key, p] of [...this._models]) if (key.startsWith(id + '@')) {
      const m = await p.catch(() => null);
      if (m) disposeObject(m.scene);
      const paths = this._loaded.get(`model:${key}`)?.paths || [];
      this._models.delete(key); this._loaded.delete(`model:${key}`); this._untrack(paths);
    }
    for (const [key, p] of [...this._hdris]) if (key.startsWith(id + '@')) {
      const h = await p.catch(() => null);
      h?.dispose();
    }
  }

  /** Alles freigeben (z. B. Kartenwechsel); KTX2-Worker bleiben, außer full = true. */
  async disposeAll({ full = false } = {}) {
    const ids = new Set([...this._sets.keys(), ...this._models.keys(), ...this._hdris.keys()].map((k) => k.split('@')[0]));
    for (const id of ids) await this.dispose(id);
    if (full && this._ktx2) { this._ktx2.dispose(); this._ktx2 = null; this._gltf = null; }
  }

  /**
   * Budget-Bericht: { downloadedBytes, gpu: {desktop, mobile, rgba8}, count, assets: [...], renderer: {textures, geometries} }
   * GPU-Werte sind Schätzungen aus dem Manifest (inkl. Mipmaps; HDRI = PMREM + Himmel).
   */
  budget() {
    let gpu = GPU0(), bytes = 0;
    for (const r of this._res.values()) { gpu = sumGpu(gpu, r.gpu || GPU0()); bytes += r.bytes || 0; }
    const assets = [...this._loaded.values()].map(({ type, id, tier }) => ({ type, id, tier }));
    return { downloadedBytes: this.downloadedBytes, residentBytes: bytes, gpu, count: assets.length, assets, renderer: this.renderer ? { ...this.renderer.info.memory } : null };
  }

  /** Budget im Voraus schätzen (ohne zu laden): { textures, models, hdri } + Qualität → { bytes, gpu }; geteilte Dateien einmal. */
  async estimate({ textures = [], models = [], hdri = null } = {}, quality = this.quality) {
    const m = await this.ready();
    const seen = new Set();
    let bytes = 0, gpu = GPU0();
    const add = (path, b, g) => { if (!path || seen.has(path)) return; seen.add(path); bytes += b || 0; gpu = sumGpu(gpu, g || GPU0()); };
    for (const id of textures) {
      const e = m.textures[id]; if (!e) continue;
      const f = e.tiers[pickTier(e.tiers, tierFor(quality, 'texture'))];
      for (const k of ['albedo', 'normal', 'orm']) add(f[k], f.sizes?.[k], f.gpuFiles?.[k]);
    }
    for (const id of models) { const e = m.models[id]; if (!e) continue; const f = e.tiers[pickTier(e.tiers, tierFor(quality, 'model'))]; add(f.glb, f.bytes, f.gpu); }
    if (hdri && m.hdris[hdri]) {
      const f = m.hdris[hdri].tiers[pickTier(m.hdris[hdri].tiers, tierFor(quality, 'hdri'))];
      add(f.hdr, f.sizes?.hdr, f.gpuParts?.pmrem); add(f.background, f.sizes?.background, f.gpuParts?.background);
    }
    return { bytes, gpu };
  }
}

/**
 * Himmelskuppel aus einem geladenen HDRI (folgt der Kamera, kein Tiefenschreiben, nicht getonemappt — die Textur ist
 * bereits mit ACES vorbelichtet). Radius passt sich je Bild an camera.far an (90 %). opts: intensity (1, Multiplikator
 * auf die Farbe), segments (48).
 */
export function createSky(hdri, { intensity = 1, segments = 48 } = {}) {
  const geo = new THREE.SphereGeometry(1, segments, Math.round(segments / 2));
  // SphereGeometry: u läuft entgegen equirectUv (u' = 1 − u)
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const mat = new THREE.MeshBasicMaterial({ map: hdri.background, side: THREE.BackSide, depthWrite: false, depthTest: true, toneMapped: false, fog: false });
  mat.color.setScalar(intensity);
  const sky = new THREE.Mesh(geo, mat);
  sky.name = `sky:${hdri.id}`;
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.onBeforeRender = (renderer, scene, camera) => {
    sky.position.copy(camera.position);
    sky.scale.setScalar((camera.far || 1000) * 0.9);
    sky.updateMatrixWorld();
  };
  sky.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return sky;
}

// Standard-Instanz + Funktions-API ---------------------------------------------------------------
export const assets = new AssetLibrary();
export const setRenderer = (r) => assets.setRenderer(r);
export const setQuality = (q) => assets.setQuality(q);
export const loadTextureSet = (id, tier) => assets.loadTextureSet(id, tier);
export const createMaterial = (id, opts) => assets.createMaterial(id, opts);
export const loadHDRI = (id, renderer, opts) => assets.loadHDRI(id, renderer, opts);
export const loadModel = (id, tier, opts) => assets.loadModel(id, tier, opts);
export const disposeAsset = (id) => assets.dispose(id);
export const disposeAll = (o) => assets.disposeAll(o);
export const budget = () => assets.budget();
export const replacementFor = (name) => assets.replacementFor(name);
