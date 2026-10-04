// NULLPUNKT — Renderer: Qualitätsstufen, Post-Processing, Viewmodel-Pass (§5).
//
// Kette (medium+): RenderPass(Welt) → [GTAO (ultra)] → RenderPass(Viewmodel, nur Tiefe löschen)
//                  → UnrealBloom → SMAA/FXAA → Farblook + Vignette → OutputPass (ACES + sRGB)
// low: direktes Rendern ohne Composer (Tonemapping im Material-Shader), Vignette per CSS
//      (main setzt dafür body.np-css-vignette, wenn preset.grade false ist).
//
// Der Farblook ist der „Mobile-Shooter“-Look: kräftig, kontrastreich, leicht warm, kühle Schatten.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low', pixelRatio: 1, shadows: false, shadowMapSize: 1024, bloom: false, smaa: false, fxaa: false,
    ssao: false, grade: false, post: false, maxBotsVisibleShadows: 0, particleScale: 0.45, decals: 40, anisotropy: 1,
  }),
  medium: Object.freeze({
    id: 'medium', pixelRatio: 1.25, shadows: true, shadowMapSize: 2048, bloom: true, smaa: false, fxaa: true,
    ssao: false, grade: true, post: true, maxBotsVisibleShadows: 4, particleScale: 0.7, decals: 80, anisotropy: 4,
  }),
  high: Object.freeze({
    id: 'high', pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, bloom: true, smaa: true, fxaa: false,
    ssao: false, grade: true, post: true, maxBotsVisibleShadows: 8, particleScale: 1, decals: 120, anisotropy: 8,
  }),
  ultra: Object.freeze({
    id: 'ultra', pixelRatio: 2, shadows: true, shadowMapSize: 4096, bloom: true, smaa: true, fxaa: false,
    ssao: true, grade: true, post: true, maxBotsVisibleShadows: 16, particleScale: 1.25, decals: 120, anisotropy: 16,
  }),
});

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

/* ------------------------------------------------------------ Farblook */

const GradeShader = {
  name: 'NullpunktGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uContrast: { value: 1.12 },
    uSaturation: { value: 1.16 },
    uTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) },
    uShadowTint: { value: new THREE.Vector3(0.93, 0.99, 1.07) },
    uHighTint: { value: new THREE.Vector3(1.05, 1.0, 0.93) },
    uVignette: { value: 0.32 },
    uAspect: { value: 16 / 9 },
    uDamage: { value: 0 },
    uDesaturate: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure, uContrast, uSaturation, uVignette, uAspect, uDamage, uDesaturate;
    uniform vec3 uTint, uShadowTint, uHighTint;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = max(src.rgb, vec3(0.0)) * uExposure * uTint;
      // Kontrast im Log-Raum um Mittelgrau (linear, HDR-tauglich)
      vec3 lc = log2(max(col, vec3(1e-5)) / 0.18) * uContrast;
      col = exp2(lc) * 0.18;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDesaturate));
      // Split-Toning: kühle Schatten, warme Lichter
      float t = clamp(l / (l + 0.35), 0.0, 1.0);
      col *= mix(uShadowTint, uHighTint, t);
      // Vignette (+ rote Ränder bei Schaden)
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(p) / length(vec2(uAspect, 1.0) * 0.5);
      float vig = 1.0 - uVignette * smoothstep(0.35, 1.05, r);
      col *= vig;
      float edge = smoothstep(0.45, 1.0, r) * uDamage;
      col = mix(col, vec3(0.55, 0.02, 0.0) * (0.4 + l), edge * 0.75);
      gl_FragColor = vec4(col, src.a);
    }
  `,
};

/* ------------------------------------------------------------ Renderer */

/**
 * createRenderer(canvas, { quality }) → {
 *   renderer, quality, preset, composer|null,
 *   setQuality(q), resize(), render(scene, camera, vmScene, vmCamera), info(), dispose(),
 *   setPost({ exposure, contrast, saturation, vignette, damage, desaturate }), onQualityChange(fn), onContextChange(fn)
 * }
 */
export function createRenderer(canvas, { quality = 'auto' } = {}) {
  const initial = resolveQuality(quality);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: initial === 'low', // MSAA nur ohne Composer (low), sonst SMAA/FXAA
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

  const qualityListeners = new Set();
  const contextListeners = new Set();
  const postState = { exposure: 1, contrast: 1.12, saturation: 1.16, vignette: 0.32, damage: 0, desaturate: 0 };

  const R = {
    renderer,
    quality: initial,
    requested: quality,
    preset: QUALITY_PRESETS[initial],
    composer: null,
    lost: false,
    width: 1,
    height: 1,
    pixelRatio: 1,
    /** Dynamische Auflösung: Faktor auf das Pixelverhältnis der Stufe (0,5…1). */
    resolutionScale: 1,
    _passes: null,
    _frames: [],
    _last: 0,
    _fps: 0,
    _frameMs: 0,
    _lastScene: null,

    setQuality(q) {
      const next = resolveQuality(q);
      this.requested = q;
      if (next === this.quality && this.composer !== undefined && this._built) return;
      const prevShadows = this.preset.shadows;
      this.quality = next;
      this.preset = QUALITY_PRESETS[next];
      renderer.shadowMap.enabled = this.preset.shadows;
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
      if (this.composer) disposeComposer(this.composer);
      this.composer = null;
      this._passes = null;
      const p = this.preset;
      if (!p.post) return;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const composer = new EffectComposer(renderer);
      const world = new RenderPass(null, null);
      composer.addPass(world);
      let gtao = null;
      if (p.ssao) {
        gtao = new GTAOPass(null, new THREE.PerspectiveCamera(70, 1, 0.05, 600), Math.max(1, size.x), Math.max(1, size.y));
        gtao.blendIntensity = 0.85;
        gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12 });
        composer.addPass(gtao);
      }
      const vm = new RenderPass(null, null);
      vm.clear = false;
      vm.clearDepth = true;
      composer.addPass(vm);
      let bloom = null;
      if (p.bloom) {
        bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1)), 0.32, 0.45, 0.92);
        composer.addPass(bloom);
      }
      let aa = null;
      if (p.smaa) { aa = new SMAAPass(); composer.addPass(aa); } else if (p.fxaa) { aa = new FXAAPass(); composer.addPass(aa); }
      let grade = null;
      if (p.grade) {
        grade = new ShaderPass(GradeShader);
        composer.addPass(grade);
      }
      composer.addPass(new OutputPass());
      this.composer = composer;
      this._passes = { world, gtao, vm, bloom, aa, grade };
      applyPost(this);
    },

    resize(force = false) {
      const w = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth));
      const h = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight));
      const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.resolutionScale);
      if (!force && w === this.width && h === this.height && pr === this.pixelRatio) return;
      this.width = w;
      this.height = h;
      this.pixelRatio = pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      if (this.composer) {
        this.composer.setPixelRatio(pr);
        this.composer.setSize(w, h);
        const ps = this._passes;
        if (ps.grade) ps.grade.uniforms.uAspect.value = w / h;
      }
    },

    /** Rendert Welt + Viewmodel (Viewmodel mit gelöschter Tiefe, nie in Wänden). */
    render(scene, camera, vmScene, vmCamera) {
      const now = performance.now();
      if (this._last) {
        const ms = now - this._last;
        this._frameMs += (ms - this._frameMs) * 0.1;
        this._frames.push(now);
      }
      this._last = now;
      while (this._frames.length && now - this._frames[0] > 1000) this._frames.shift();
      this._fps = this._frames.length;

      if (this.lost || !scene || !camera) return;
      this.resize();
      this._lastScene = scene;
      const aspect = this.width / this.height;
      fitCamera(camera, aspect);
      if (vmCamera) fitCamera(vmCamera, aspect);
      renderer.info.reset();

      if (this.composer) {
        const ps = this._passes;
        ps.world.scene = scene;
        ps.world.camera = camera;
        if (ps.gtao) { ps.gtao.scene = scene; ps.gtao.camera = camera; }
        const hasVm = !!(vmScene && vmCamera && vmScene.visible !== false);
        ps.vm.enabled = hasVm;
        if (hasVm) { ps.vm.scene = vmScene; ps.vm.camera = vmCamera; }
        this.composer.render();
      } else {
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
        width: this.width, height: this.height,
      };
    },

    /** Farblook/Vignette/Schadensrand anpassen (HUD/Welt dürfen das nutzen). */
    setPost(values = {}) {
      for (const k of Object.keys(postState)) if (Number.isFinite(values[k])) postState[k] = values[k];
      applyPost(this);
    },
    get post() { return { ...postState }; },

    onQualityChange(fn) { qualityListeners.add(fn); return () => qualityListeners.delete(fn); },
    /** fn('lost' | 'restored') bei WebGL-Kontextverlust/-wiederherstellung. */
    onContextChange(fn) { contextListeners.add(fn); return () => contextListeners.delete(fn); },

    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (this.composer) disposeComposer(this.composer);
      this.composer = null;
      renderer.dispose();
    },
  };

  function applyPost(r) {
    const g = r._passes && r._passes.grade;
    if (g) {
      const u = g.uniforms;
      u.uExposure.value = postState.exposure;
      u.uContrast.value = postState.contrast;
      u.uSaturation.value = postState.saturation;
      u.uVignette.value = postState.vignette;
      u.uDamage.value = postState.damage;
      u.uDesaturate.value = postState.desaturate;
    }
    // Ohne Grade-Pass (low) wirkt nur die Belichtung.
    renderer.toneMappingExposure = r.preset.grade ? 1.0 : postState.exposure * 1.05;
  }

  function onLost(e) {
    e.preventDefault();
    R.lost = true;
    for (const fn of [...contextListeners]) { try { fn('lost'); } catch (err) { console.error(err); } }
  }
  function onRestored() {
    R.lost = false;
    // three.js stellt seinen Zustand selbst wieder her; Composer-Ziele neu aufbauen.
    R._build();
    R.resize(true);
    if (R._lastScene) refreshScene(R._lastScene, R.preset, true);
    for (const fn of [...contextListeners]) { try { fn('restored'); } catch (err) { console.error(err); } }
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  renderer.shadowMap.enabled = R.preset.shadows;
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

function disposeComposer(composer) {
  for (const pass of composer.passes) if (typeof pass.dispose === 'function') pass.dispose();
  composer.renderTarget1.dispose();
  composer.renderTarget2.dispose();
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
