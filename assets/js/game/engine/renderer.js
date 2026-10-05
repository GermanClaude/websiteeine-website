// NULLPUNKT — Renderer: Qualitätsstufen, Nachbearbeitung („Bodycam“-Objektiv, AgX/LUT, automatische Belichtung,
// FSR 1.0), Viewmodel-Pass (§5, plan §5).
//
// Die Kette selbst steckt in engine/post/pipeline.js (Aufbau je Stufe dort beschrieben):
//   low     „lite“: Welt + Viewmodel → HDR → EIN Pass (Objektiv, FXAA-Konsole, Belichtung, AgX, LUT, Körnung …)
//   medium+ Welt → HDR [+ GTAO ultra] → Viewmodel → Belichtung → Bloom → Grade (8 Bit) → [FXAA | SMAA]
//           → Objektiv (Verzeichnung, Farbsaum, RCAS bzw. FSR-EASU, Körnung, Kompression, Gehäuse) → Bild
//   direct  low im Stil „Klassisch“ mit MSAA-Kontext: bisheriges direktes Rendern (ACES im Material,
//           Vignette per CSS über body.np-css-vignette – main fragt `cssVignette`).
// Bildstile (Einstellung lensStyle): „bodycam“ (Standard), „klassisch“ (bisheriger Look: ACES, kräftiger
// Farblook, feste Belichtung), „aus“ (klares Bild, aber AgX/LUT/automatische Belichtung).
//
// Objektiv-Abbildung für HUD/Namensschilder: `R.lens.toScreen(ndc)` / `fromScreen(ndc)` / `project(world)`
// (siehe post/lens.js). Ohne aktives Objektiv sind das Identitäten.

import * as THREE from 'three';
import { PostPipeline, LENS_DEFAULTS, LENS_STYLES } from './post/pipeline.js';
import { estimateMemory } from './post/memory.js';
import { MOODS, MOOD_FOR_MAP } from './post/grade.js';
import { resetFormatCache } from './post/common.js';

export { LENS_DEFAULTS, LENS_STYLES, MOODS, MOOD_FOR_MAP };

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

// shadowExtent: Obergrenze der halben Kantenlänge der Sonnen-Schattenkaskade (m, null = Kartenwert);
// shadowInterval: Schattenkarte höchstens jedes n-te Bild neu (1 = jedes Bild; Welt meldet Kamerasprünge
// über invalidateShadows()). Telefone (auto → low) bekommen so Sonnenschatten bei ~⅓ der Kosten.
// post: volle Nachbearbeitungskette (false = low: ein kombinierter Pass bzw. direktes Rendern).
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low', pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, shadowExtent: 24, shadowInterval: 4,
    bloom: false, smaa: false, fxaa: false,
    ssao: false, grade: false, post: false, maxBotsVisibleShadows: 0, particleScale: 0.45, decals: 40, anisotropy: 2,
  }),
  medium: Object.freeze({
    id: 'medium', pixelRatio: 1.25, shadows: true, shadowMapSize: 2048, shadowExtent: null, shadowInterval: 1,
    bloom: true, smaa: false, fxaa: true,
    ssao: false, grade: true, post: true, maxBotsVisibleShadows: 4, particleScale: 0.7, decals: 80, anisotropy: 4,
  }),
  high: Object.freeze({
    id: 'high', pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, shadowExtent: null, shadowInterval: 1,
    bloom: true, smaa: true, fxaa: false,
    ssao: false, grade: true, post: true, maxBotsVisibleShadows: 8, particleScale: 1, decals: 120, anisotropy: 8,
  }),
  ultra: Object.freeze({
    id: 'ultra', pixelRatio: 2, shadows: true, shadowMapSize: 4096, shadowExtent: null, shadowInterval: 1,
    bloom: true, smaa: true, fxaa: false,
    ssao: true, grade: true, post: true, maxBotsVisibleShadows: 16, particleScale: 1.25, decals: 120, anisotropy: 16,
  }),
});

/** Standardwerte des Bloom (Schwelle in Bildwerten nach Belichtung, d. h. vor dem Tonemapping). */
export const BLOOM_DEFAULTS = Object.freeze({ threshold: 3.0, strength: 0.24, radius: 0.4, maxBright: 8 });

/** Erkennt Touch-/Schwachgeräte für 'auto'. */
export function isLowEndDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const touch = coarse || (navigator.maxTouchPoints > 0 && !fine);
  const lowMem = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4;
  const fewCores = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 2;
  return touch || lowMem || fewCores;
}

/**
 * 'auto' | Stufe → konkrete Stufe. auto: Telefone/Tablets low (Spitzengeräte mit ≥ 8 GB/8 Kernen medium),
 * schwache Desktops medium, sonst high. Die dynamische Auflösung in main.js regelt danach nach unten.
 */
export function resolveQuality(q) {
  if (QUALITY_LEVELS.includes(q)) return q;
  if (typeof window === 'undefined') return 'high';
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 0;
  const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  if (coarse || (navigator.maxTouchPoints > 0 && !fine)) return mem >= 8 && cores >= 8 ? 'medium' : 'low';
  if ((mem && mem <= 4) || (cores && cores <= 2)) return 'medium';
  return 'high';
}

// Einstellungsschlüssel (shared/settings.js) → Objektiv-Konfiguration
const SETTING_KEYS = {
  lensStyle: 'style', lensStrength: 'strength', grain: 'grain', lensArtifacts: 'artifacts', lensBorder: 'border',
  autoExposure: 'autoExposure', upscaler: 'upscaler', sharpness: 'sharpness', reducedMotion: 'reducedMotion',
};

function lensConfigFrom(settings, prefersReduced) {
  const cfg = { ...LENS_DEFAULTS };
  if (settings && typeof settings.get === 'function') {
    for (const [k, f] of Object.entries(SETTING_KEYS)) {
      const v = settings.get(k);
      if (v !== undefined && v !== null) cfg[f] = v;
    }
  }
  if (!LENS_STYLES.includes(cfg.style)) cfg.style = LENS_DEFAULTS.style;
  cfg.reducedMotion = !!cfg.reducedMotion || !!prefersReduced;
  return cfg;
}

const _db = new THREE.Vector2();

/**
 * createRenderer(canvas, { quality, settings }) → {
 *   renderer, quality, preset, msaa, lens, pipeline,
 *   setQuality(q), resize(), render(scene, camera, vmScene, vmCamera), info(), dispose(),
 *   setPost({ exposure, contrast, saturation, vignette, damage, desaturate, bloomThreshold, bloomStrength, suppression, flash }),
 *   setLens(cfg), setMood(id | obj), setSun(lighting), suppress(amount), flash(amount), exposure { reset(), value, track },
 *   memoryEstimate(), compilePost(), onQualityChange(fn), onContextChange(fn), onStyleChange(fn), invalidateShadows()
 * }
 * settings (optional): Einstellungsspeicher (shared/settings.js); der Renderer liest die Objektiv-Schlüssel
 * selbst und folgt Änderungen. Ohne settings gelten LENS_DEFAULTS (Prüfseiten setzen per setLens()).
 */
export function createRenderer(canvas, { quality = 'auto', settings = null } = {}) {
  const initial = resolveQuality(quality);
  const reduceMQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let lensCfg = lensConfigFrom(settings, reduceMQ && reduceMQ.matches);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // MSAA nur für das direkte Rendern (low im Stil „Klassisch“); die Kette rendert in eigene Ziele
    antialias: initial === 'low' && lensCfg.style === 'klassisch',
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
    alpha: false,
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x0a0b0d, 1);
  // Max. Anisotropie jetzt abfragen (three.js merkt sie sich): gl.getParameter wartet, bis die GPU alle
  // anstehenden Befehle abgearbeitet hat – beim ersten Kartenladen kostete das einen langen Hänger.
  renderer.capabilities.getMaxAnisotropy();

  const qualityListeners = new Set();
  const contextListeners = new Set();
  const styleListeners = new Set();
  const postState = {
    exposure: 1, contrast: 1.12, saturation: 1.16, vignette: 0.32, damage: 0, desaturate: 0,
    bloomThreshold: BLOOM_DEFAULTS.threshold, bloomStrength: BLOOM_DEFAULTS.strength,
    suppression: 0, flash: 0,
  };
  const effPost = { ...postState };
  const impulse = { supp: 0, flash: 0 };
  const pipeline = new PostPipeline(renderer);

  // CSS-Größe der Leinwand per ResizeObserver zwischenspeichern: resize() läuft jedes Bild und würde mit
  // clientWidth/clientHeight sonst nach den DOM-Schreibzugriffen des HUD eine synchrone Layoutberechnung erzwingen.
  // R.width/R.height (CSS-Pixel) dürfen andere Module statt des DOM lesen.
  const css = { w: 0, h: 0, valid: false };
  const measure = () => { css.w = canvas.clientWidth || window.innerWidth; css.h = canvas.clientHeight || window.innerHeight; };
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    const r = entries[entries.length - 1].contentRect;
    css.valid = r.width > 0 && r.height > 0;
    if (css.valid) { css.w = r.width; css.h = r.height; }
  }) : null;
  if (sizeObserver) sizeObserver.observe(canvas);

  const R = {
    renderer,
    quality: initial,
    requested: quality,
    preset: QUALITY_PRESETS[initial],
    /** Entfällt seit der eigenen Kette (bleibt null; Kompatibilität). */
    composer: null,
    /** Nachbearbeitungskette (engine/post/pipeline.js). */
    pipeline,
    /** Objektiv-Abbildung (toScreen/fromScreen/project/scaleAt, active, version). */
    lens: pipeline.lens,
    /** Hat der Standard-Framebuffer MSAA? (nur low im Stil „Klassisch“ beim Start) */
    msaa: !!renderer.getContextAttributes()?.antialias,
    lost: false,
    width: 1,
    height: 1,
    /** Pixelverhältnis der Szene (inkl. dynamischer Auflösung). */
    pixelRatio: 1,
    /** Pixelverhältnis der Leinwand (mit Kette: ohne dynamische Auflösung – der Objektiv-Pass skaliert hoch). */
    outputPixelRatio: 1,
    /** Dynamische Auflösung: Faktor auf das Pixelverhältnis der Stufe (0,5…1). */
    resolutionScale: 1,
    _frames: [],
    _last: 0,
    _fps: 0,
    _frameMs: 0,
    _lastScene: null,
    _lastVmScene: null,
    _shadowDirty: true,
    _shadowFrame: 0,
    _cssVignette: null,

    /** Bild wird ohne Shader-Vignette gezeichnet → main blendet die CSS-Vignette ein. */
    get cssVignette() { return !pipeline.active; },
    /** Läuft ein Farbstufen-Shader (setPost desaturate/contrast/saturation wirken)? */
    get graded() { return pipeline.active || !!this.preset.grade; },
    /** Aktuelle Objektiv-/Bildeinstellungen. */
    get lensSettings() { return { ...lensCfg }; },
    /** ID der aktiven Stimmung (LUT/Belichtung/Bloom). */
    get mood() { return pipeline.mood.id; },

    setQuality(q) {
      const next = resolveQuality(q);
      this.requested = q;
      if (next === this.quality && this._built) return;
      const prevShadows = this.preset.shadows;
      this.quality = next;
      this.preset = QUALITY_PRESETS[next];
      renderer.shadowMap.enabled = this.preset.shadows;
      this._shadowDirty = true;
      this._build();
      this.resize(true);
      // Schatten an/aus und Kartengröße erfordern Shader-Neukompilierung bzw. neue Shadow-Maps.
      if (this._lastScene) refreshScene(this._lastScene, this.preset, prevShadows !== this.preset.shadows);
      for (const fn of [...qualityListeners]) {
        try { fn(this.quality, this.preset); } catch (err) { console.error(err); }
      }
    },

    _build() {
      this._built = true;
      pipeline.build(this.preset, lensCfg, { msaa: this.msaa });
      applyPost(this);
      this._notifyStyle();
    },

    _notifyStyle() {
      const v = this.cssVignette;
      if (v === this._cssVignette) return;
      this._cssVignette = v;
      for (const fn of [...styleListeners]) { try { fn(this); } catch (err) { console.error(err); } }
    },

    /**
     * Objektiv-/Bildeinstellungen ändern ({ style, strength, grain, artifacts, border, autoExposure, upscaler,
     * sharpness, reducedMotion }). Ein Stilwechsel kann die Kette neu aufbauen (Shader beim nächsten Bild).
     */
    setLens(cfg = {}) {
      const next = { ...lensCfg, ...cfg };
      if (!LENS_STYLES.includes(next.style)) next.style = LENS_DEFAULTS.style;
      if (reduceMQ && reduceMQ.matches) next.reducedMotion = true;
      lensCfg = next;
      if (pipeline.configure(next, { msaa: this.msaa })) {
        this._build();
        this.resize(true);
      }
      applyPost(this);
      this._notifyStyle();
      return { ...lensCfg };
    },

    /** Stimmung je Karte (LUT, Belichtungsgrenzen, Bloom): Karten-ID, Stimmungs-ID oder { mood, lut, exposure, bloom }. */
    setMood(spec) {
      pipeline.setMood(spec);
      return pipeline.mood.id;
    },

    /** Sonne für Lichtstrahlen (R7): world.lighting ({ sunDirection }) oder Richtung zur Sonne; null = keine. */
    setSun(sun) { pipeline.setSun(sun); },

    /** Unterdrückung (Beschuss, R18) anstoßen: addiert, klingt von selbst ab (≈ 1 s). */
    suppress(amount = 0.35) {
      impulse.supp = Math.min(1, impulse.supp + Math.max(0, Number(amount) || 0));
    },

    /** Blendung (Blendgranate, nahe Explosion): 0..1, klingt über ≈ 2–3 s ab. */
    flash(amount = 1) {
      impulse.flash = Math.min(1.5, Math.max(impulse.flash, Number(amount) || 0));
    },

    /** Automatische Belichtung: reset() springt sofort auf das Ziel; value = zuletzt gelesener Faktor (nur mit track). */
    exposure: {
      reset() { if (pipeline.exposure) pipeline.exposure.reset(); },
      get value() { return pipeline.exposure && pipeline.exposure.last ? pipeline.exposure.last.factor : null; },
      /** Sofort zurücklesen (blockiert die GPU – nur Prüfseiten/Tests). → { factor, ev, avgLog } | null */
      readNow() { return pipeline.exposure ? pipeline.exposure.readNow(renderer) : null; },
      get measured() { return pipeline.exposure && pipeline.exposure.last ? Math.pow(2, pipeline.exposure.last.avgLog) : null; },
      get track() { return !!(pipeline.exposure && pipeline.exposure.track); },
      set track(v) { R._trackExposure = !!v; if (pipeline.exposure) pipeline.exposure.track = !!v; },
    },

    /** Shader der Kette vorab kompilieren (Ladebildschirm; auch die EASU-Variante für spätere Skalen < 1). */
    compilePost() { try { pipeline.compile(); } catch (err) { console.warn('[NULLPUNKT] Nachbearbeitung vorkompilieren:', err); } },

    /** Schattenkarte beim nächsten Bild neu zeichnen (z. B. nach Verschieben der Schattenkaskade). */
    invalidateShadows() { this._shadowDirty = true; },

    resize(force = false) {
      if (force || !css.valid) measure(); // ohne ResizeObserver bzw. vor der ersten Meldung wie bisher
      const w = Math.max(1, Math.floor(css.w));
      const h = Math.max(1, Math.floor(css.h));
      const base = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio);
      // Mit Kette bleibt die Leinwand bei voller Stufenauflösung; nur die Szene wird verkleinert gerendert
      const pr = Math.max(0.5, pipeline.active ? base : base * this.resolutionScale);
      if (!force && w === this.width && h === this.height && pr === this.outputPixelRatio && pipeline.scale === (pipeline.active ? this.resolutionScale : 1)) return;
      this.width = w;
      this.height = h;
      this.outputPixelRatio = pr;
      this.pixelRatio = pipeline.active ? Math.max(0.3, base * this.resolutionScale) : pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(_db);
      pipeline.setSize(_db.x, _db.y, this.resolutionScale, w, h);
    },

    /** Rendert Welt + Viewmodel (Viewmodel mit gelöschter Tiefe, nie in Wänden) samt Nachbearbeitung. */
    render(scene, camera, vmScene, vmCamera) {
      const now = performance.now();
      let dt = 0;
      if (this._last) {
        const ms = now - this._last;
        dt = Math.min(0.25, ms / 1000);
        this._frameMs += (ms - this._frameMs) * 0.1;
        this._frames.push(now);
      }
      this._last = now;
      while (this._frames.length && now - this._frames[0] > 1000) this._frames.shift();
      this._fps = this._frames.length;

      if (this.lost || !scene || !camera) return;
      this.resize();
      this._lastScene = scene;
      this._lastVmScene = vmScene || null;
      const aspect = this.width / this.height;
      fitCamera(camera, aspect);
      if (vmCamera) fitCamera(vmCamera, aspect);
      renderer.info.reset();
      // Gedrosselte Schatten (low): statische Welt + gleiche Kaskade → Karte nur jedes n-te Bild oder nach invalidateShadows()
      const sm = renderer.shadowMap, every = this.preset.shadowInterval || 1;
      if (sm.enabled && every > 1) {
        sm.autoUpdate = false;
        if (this._shadowDirty || ++this._shadowFrame >= every) { sm.needsUpdate = true; this._shadowDirty = false; this._shadowFrame = 0; }
      } else sm.autoUpdate = true;

      // Abklingende Anstöße (Unterdrückung ≈ 1 s, Blendung ≈ 2,5 s)
      impulse.supp = Math.max(0, impulse.supp - dt * 1.1);
      impulse.flash = Math.max(0, impulse.flash * Math.exp(-dt * 1.6) - dt * 0.05);

      if (pipeline.active) {
        Object.assign(effPost, postState);
        effPost.suppression = Math.min(1, postState.suppression + impulse.supp);
        effPost.flash = Math.min(1.5, postState.flash + impulse.flash);
        pipeline.lens.width = this.width;
        pipeline.lens.height = this.height;
        if (this._trackExposure && pipeline.exposure && !pipeline.exposure.track) pipeline.exposure.track = true;
        pipeline.render(scene, camera, vmScene && vmCamera && vmScene.visible !== false ? vmScene : null, vmCamera, effPost);
      } else {
        pipeline.lens.camera = camera;
        renderer.setRenderTarget(null);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        if (vmScene && vmCamera && vmScene.visible !== false) {
          renderer.autoClear = false;
          renderer.clearDepth();
          renderer.render(vmScene, vmCamera);
          renderer.autoClear = true;
        }
      }
    },

    /** Dynamische Auflösung setzen (0,5…1); wirkt sofort. */
    setResolutionScale(scale) {
      const v = Math.min(1, Math.max(0.5, Number(scale) || 1));
      if (Math.abs(v - this.resolutionScale) < 1e-3) return this.resolutionScale;
      this.resolutionScale = v;
      this.resize(true);
      return v;
    },

    /** Werte für das FPS-/Debug-Overlay. */
    info() {
      const i = renderer.info;
      return {
        fps: this._fps, frameMs: Math.round(this._frameMs * 10) / 10,
        drawCalls: i.render.calls, triangles: i.render.triangles,
        geometries: i.memory.geometries, textures: i.memory.textures,
        programs: i.programs ? i.programs.length : 0,
        quality: this.quality, pixelRatio: Math.round(this.pixelRatio * 100) / 100, resolutionScale: this.resolutionScale,
        outputPixelRatio: Math.round(this.outputPixelRatio * 100) / 100,
        width: this.width, height: this.height,
        post: pipeline.active ? pipeline.describe() : { mode: 'direct', style: lensCfg.style },
      };
    },

    /**
     * Grafikspeicher schätzen (Texturen, Geometrien, Render-Ziele, Schatten, Bildpuffer) – auf Abruf, nicht je Bild.
     * extraScenes: weitere Szenen (z. B. Vorschau). → { total, mb: {…}, breakdown, top, … } (Bytes bzw. MB)
     */
    memoryEstimate(extraScenes = []) {
      renderer.getDrawingBufferSize(_db);
      const samples = this.msaa ? 4 : 0;
      const backbuffer = _db.x * _db.y * (4 + 4) * (samples ? samples + 1 : 1);
      return estimateMemory({
        scenes: [this._lastScene, this._lastVmScene, ...extraScenes].filter(Boolean),
        targets: pipeline.targetInfo(),
        backbuffer,
      });
    },

    /**
     * Farblook/Vignette/Schadensrand/Bloom/Unterdrückung/Blendung anpassen (HUD/Welt dürfen das nutzen).
     * exposure = Kartenbelichtung (Belichtungskorrektur; die Automatik wirkt relativ dazu), bloomThreshold gilt
     * nach der Belichtung (größter Farbkanal), bloomStrength 0..1, suppression/flash 0..1 (Aufrufer steuert;
     * für kurze Anstöße suppress()/flash()).
     */
    setPost(values = {}) {
      for (const k of Object.keys(postState)) if (Number.isFinite(values[k])) postState[k] = values[k];
      applyPost(this);
    },
    get post() { return { ...postState }; },

    onQualityChange(fn) { qualityListeners.add(fn); return () => qualityListeners.delete(fn); },
    /** fn('lost' | 'restored') bei WebGL-Kontextverlust/-wiederherstellung. */
    onContextChange(fn) { contextListeners.add(fn); return () => contextListeners.delete(fn); },
    /** fn(R), wenn sich die Art der Darstellung ändert (z. B. cssVignette nach Stil-/Stufenwechsel). */
    onStyleChange(fn) { styleListeners.add(fn); return () => styleListeners.delete(fn); },

    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (sizeObserver) sizeObserver.disconnect();
      if (offSettings) offSettings();
      if (reduceMQ && reduceMQ.removeEventListener) reduceMQ.removeEventListener('change', onReduceMQ);
      pipeline.dispose();
      renderer.dispose();
    },
  };

  function applyPost(r) {
    // Ohne Kette (direktes Rendern) wirkt nur die Belichtung im Material-Tonemapping.
    renderer.toneMappingExposure = pipeline.active ? 1.0 : postState.exposure * 1.05;
  }

  // Einstellungen folgen (nur Objektiv-Schlüssel)
  const offSettings = settings && typeof settings.onChange === 'function'
    ? settings.onChange((key) => { if (key in SETTING_KEYS) R.setLens(lensConfigFrom(settings, reduceMQ && reduceMQ.matches)); })
    : null;
  const onReduceMQ = () => R.setLens({ reducedMotion: lensConfigFrom(settings, reduceMQ.matches).reducedMotion });
  if (reduceMQ && reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduceMQ);

  function onLost(e) {
    e.preventDefault();
    R.lost = true;
    for (const fn of [...contextListeners]) { try { fn('lost'); } catch (err) { console.error(err); } }
  }
  function onRestored() {
    R.lost = false;
    R._shadowDirty = true;
    // three.js stellt seinen Zustand selbst wieder her (neue capabilities); Ketten-Ziele neu aufbauen.
    renderer.capabilities.getMaxAnisotropy();
    resetFormatCache(renderer);
    R._build();
    R.resize(true);
    if (R._lastScene) refreshScene(R._lastScene, R.preset, true);
    for (const fn of [...contextListeners]) { try { fn('restored'); } catch (err) { console.error(err); } }
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  renderer.shadowMap.enabled = R.preset.shadows;
  pipeline.setMood('neutral');
  R._build();
  R.resize(true);
  return R;
}

function fitCamera(cam, aspect) {
  if (cam.isPerspectiveCamera && Math.abs(cam.aspect - aspect) > 1e-4) {
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }
}

/** Nach Qualitätswechsel: Shadow-Maps an neue Größe anpassen, Materialien neu kompilieren. */
function refreshScene(scene, preset, recompile) {
  scene.traverse((obj) => {
    if (obj.isLight && obj.shadow && obj.castShadow !== undefined) {
      if (obj.isDirectionalLight || obj.isSpotLight) {
        const size = preset.shadowMapSize;
        if (obj.shadow.mapSize.x !== size) {
          obj.shadow.mapSize.set(size, size);
          if (obj.shadow.map) { obj.shadow.map.dispose(); obj.shadow.map = null; }
        }
      }
    }
    if (recompile && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.needsUpdate = true;
    }
  });
}
