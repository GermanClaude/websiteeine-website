// NULLPUNKT — Nachbearbeitungskette (plan §5.1) je Qualitätsstufe:
//
//  low  („lite“, Telefone): Welt + Viewmodel → HDR-Ziel (R11G11B10F, interne Auflösung) → [Belichtungsmessung
//       32², jedes 2. Bild] → EIN Pass aufs Bild: Objektiv (Verzeichnung, ohne Farbsaum), FXAA-Konsole +
//       Schärfen, Belichtung, AgX, LUT, Vignette, Körnung, Kompression, Gehäuse, Dither.
//  medium+: Welt → HDR (+ GTAO ultra) → Viewmodel (Tiefe gelöscht) → Belichtung 64² → Bloom (Mip-Kette, belichtet)
//       → Grade (Belichtung, Bloom + Linsenschmutz, AgX, LUT) → 8-Bit → [FXAA medium | SMAA high/ultra]
//       → Objektiv aufs Bild (Verzeichnung, Farbsaum, RCAS bzw. EASU bei Skala < 1, Körnung, Kompression,
//       Gehäuse, Vignette, Schaden/Unterdrückung, Dither).
//  direct: low im Stil „Klassisch“ mit MSAA-Kontext (bisheriger Weg ohne Nachbearbeitung) bzw. Geräte ohne
//       HDR-Renderziele.
//
// Dynamische Auflösung: Mit Kette rendert nur die Szene in der verkleinerten internen Auflösung; die Leinwand
// bleibt bei der vollen Stufenauflösung und der Objektiv-Pass skaliert hoch (FSR 1.0 EASU auf medium+, „lite“
// auf low) – schärfer als das bilineare Hochziehen des Browsers.

import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Fullscreen, hdrFormat, hdrTarget, ldrTarget } from './common.js';
import { LensModel, LensPass } from './lens.js';
import { GradePass, setGradeUniforms, resolveMood, buildLut } from './grade.js';
import { AutoExposure } from './exposure.js';
import { Bloom, lensDirtTexture } from './bloom.js';
import { LightShafts } from './shafts.js';

export const LENS_STYLES = Object.freeze(['bodycam', 'klassisch', 'aus']);

/** Vorgaben der Objektiv-/Bildeinstellungen (Schlüssel wie in shared/settings.js). */
export const LENS_DEFAULTS = Object.freeze({
  style: 'bodycam', strength: 0.7, grain: 0.6, artifacts: 0.35, border: false, autoExposure: true,
  upscaler: 'fsr', sharpness: 0.5, reducedMotion: false,
});

// Werte je Stil; Regler (strength, grain, artifacts, sharpness) skalieren sie.
const STYLE = {
  bodycam: { distortion: 0.75, ca: 0.003, vignette: 0.5, vigClassic: 0, grain: 1, artifacts: 1, sharpen: 1, classic: false, bloomDirt: true },
  aus: { distortion: 0, ca: 0, vignette: 0, vigClassic: 0.12, grain: 0, artifacts: 0, sharpen: 0.5, classic: false, bloomDirt: false },
  klassisch: { distortion: 0, ca: 0, vignette: 0, vigClassic: 1, grain: 0, artifacts: 0, sharpen: 0, classic: true, bloomDirt: false },
};

const AGX_CONTRAST = 1.26;
const AGX_SAT = 1.1;
const CLASSIC_BLOOM = { threshold: 3.0, strength: 0.24, radius: 0.55 };

function widen(cam, F) {
  cam.fov = (2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * F) * 180) / Math.PI;
  cam.updateProjectionMatrix();
}

export class PostPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.fs = new Fullscreen();
    this.lens = new LensModel();
    this.lensPass = new LensPass();
    this.gradePass = new GradePass();
    this.mode = 'direct';
    this.preset = null;
    this.cfg = { ...LENS_DEFAULTS };
    this.fmt = null;
    this.hdr = null;
    this.ldr = [null, null];
    this.exposure = null;
    this.bloom = null;
    this.aa = null; // FXAAPass | SMAAPass
    this.gtao = null;
    this.shafts = null;
    /** Sonne für Lichtstrahlen: Richtung zur Sonne (Welt) – setSun(). */
    this.sunDir = null;
    this.moodSpec = 'neutral';
    this.mood = resolveMood('neutral');
    this.lut = null;
    this.out = { w: 1, h: 1 };
    this.inner = { w: 1, h: 1 };
    this.scale = 1;
    this.frame = 0;
    this._expDt = 0;
    this._last = 0;
    this._motion = 0;
    this._angVel = 0;
    this._prevQ = new THREE.Quaternion();
    this._prevPos = new THREE.Vector3();
    this._hasPrev = false;
    this._shift = new THREE.Vector2();
    this._yawRate = 0;
    this._pitchRate = 0;
    this._grainT = 0;
    this._seed = new THREE.Vector2(17, 29);
    this.stats = { passes: 0, sceneRenders: 0 };
    this._origDraw = this.fs.draw.bind(this.fs);
    this.fs.draw = (r, m, t) => { this.stats.passes++; this._origDraw(r, m, t); };
  }

  get active() { return this.mode !== 'direct'; }
  get style() { return STYLE[this.cfg.style] ? this.cfg.style : 'bodycam'; }

  /**
   * Kette für Stufe + Einstellungen aufbauen. msaa = Standard-Framebuffer hat MSAA.
   * Gibt true zurück, wenn sich der Modus geändert hat.
   */
  build(preset, cfg, { msaa = false } = {}) {
    this.cfg = { ...this.cfg, ...cfg };
    this.preset = preset;
    const prevMode = this.mode;
    this.fmt = hdrFormat(this.renderer);
    const style = this.style;
    let mode;
    if (!this.fmt) mode = 'direct';
    else if (!preset.post) mode = style === 'klassisch' && msaa ? 'direct' : 'lite';
    else mode = 'full';
    this._disposeTargets();
    this.mode = mode;
    if (mode === 'direct') return prevMode !== mode;
    const r = this.renderer;
    // medium+: lesbare Tiefe für Lichtstrahlen; low: Tiefenpuffer (nicht lesbar, billiger auf Kachel-GPUs)
    this.hdr = hdrTarget(r, this.inner.w, this.inner.h, { depth: true, depthTexture: mode === 'full', fmt: this.fmt });
    this.hdr.texture.name = 'np:szene';
    this.exposure = new AutoExposure({ size: mode === 'lite' ? 32 : 64 });
    this.exposure.setParams(this.mood.exposure);
    if (mode === 'full') {
      this.ldr = [ldrTarget(this.inner.w, this.inner.h), null];
      this.shafts = new LightShafts();
      if (preset.bloom) this.bloom = new Bloom({ levels: preset.id === 'medium' ? 4 : preset.id === 'ultra' ? 6 : 5 });
      if (preset.smaa) { this.aa = new SMAAPass(); this.ldr[1] = ldrTarget(this.inner.w, this.inner.h); }
      else if (preset.fxaa) { this.aa = new FXAAPass(); this.ldr[1] = ldrTarget(this.inner.w, this.inner.h); }
      if (preset.ssao) {
        this.gtao = new GTAOPass(null, new THREE.PerspectiveCamera(70, 1, 0.05, 600), Math.max(1, this.inner.w), Math.max(1, this.inner.h));
        this.gtao.output = GTAOPass.OUTPUT.Off;
        this.gtao.blendIntensity = 0.85;
        this.gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12 });
        // Normal-/Tiefen-Vorpass nur für deckende Geometrie: durchsichtige Effekte ohne Tiefenschreiben
        // (Sonnenstrahlen-Quader, Rauch, Decals, Mündungsfeuer, Sprites) sonst als riesige Verdecker → dunkle Keile
        const gtao = this.gtao;
        gtao._overrideVisibility = function overrideVisibility() {
          const cache = this._visibilityCache;
          this.scene.traverse((o) => {
            if (!o.visible) return;
            const m = o.material;
            const see = !Array.isArray(m) && m && m.transparent && !m.depthWrite;
            if (o.isPoints || o.isLine || o.isLine2 || o.isSprite || see || (o.userData && o.userData.noAO)) { o.visible = false; cache.push(o); }
          });
        };
      }
    }
    this._resizeTargets();
    this.exposure.reset();
    return prevMode !== mode;
  }

  /** Nur Einstellungen ändern (ohne Neuaufbau, falls Modus gleich bleibt). Gibt true zurück, wenn Neuaufbau nötig. */
  configure(cfg, { msaa = false } = {}) {
    const next = { ...this.cfg, ...cfg };
    const fmt = this.fmt || hdrFormat(this.renderer);
    const style = STYLE[next.style] ? next.style : 'bodycam';
    const wantMode = !fmt ? 'direct' : !this.preset || !this.preset.post ? (style === 'klassisch' && msaa ? 'direct' : 'lite') : 'full';
    const rebuild = wantMode !== this.mode;
    this.cfg = next;
    return rebuild;
  }

  /** Stimmung (Karten-ID oder Objekt) setzen: LUT, Belichtungsgrenzen, Bloom. */
  setMood(spec) {
    this.moodSpec = spec == null ? 'neutral' : spec;
    this.mood = resolveMood(this.moodSpec);
    this.lut = this.mood.lutTexture || buildLut(this.mood.lut);
    if (this.exposure) { this.exposure.setParams(this.mood.exposure); this.exposure.reset(); }
  }

  /** Sonne für Lichtstrahlen: { sunDirection } (world.lighting) oder Vector3 (Richtung zur Sonne); null = keine. */
  setSun(sun) {
    const d = sun && (sun.isVector3 ? sun : sun.sunDirection);
    this.sunDir = d && d.isVector3 ? d.clone().normalize() : null;
  }

  /** Größen: Ausgabe (Zeichenpuffer), interne Skala (dynamische Auflösung), CSS-Größe (Lens-API in px). */
  setSize(outW, outH, scale, cssW = outW, cssH = outH) {
    this.out.w = Math.max(1, outW | 0);
    this.out.h = Math.max(1, outH | 0);
    this.lens.width = Math.max(1, cssW);
    this.lens.height = Math.max(1, cssH);
    this.cssH = Math.max(1, cssH);
    this.scale = this.active ? Math.max(0.3, Math.min(1, scale)) : 1;
    const iw = Math.max(1, Math.round(this.out.w * this.scale));
    const ih = Math.max(1, Math.round(this.out.h * this.scale));
    if (iw === this.inner.w && ih === this.inner.h) return;
    this.inner.w = iw;
    this.inner.h = ih;
    this._resizeTargets();
  }

  _resizeTargets() {
    const { w, h } = this.inner;
    if (this.hdr) this.hdr.setSize(w, h);
    for (const t of this.ldr) if (t) t.setSize(w, h);
    if (this.bloom) this.bloom.setSize(this.renderer, w, h);
    if (this.aa) this.aa.setSize(w, h);
    if (this.gtao) this.gtao.setSize(w, h);
    if (this.shafts) this.shafts.setSize(this.renderer, w, h);
  }

  /** Kamera-Drehgeschwindigkeit → Bewegung (Kompression) und Gehäuse-Wackeln; Sprünge → Belichtung zurücksetzen. */
  _trackCamera(camera, dt) {
    const q = camera.quaternion, p = camera.position;
    if (!this._hasPrev) {
      this._prevQ.copy(q); this._prevPos.copy(p); this._hasPrev = true;
      return;
    }
    if (dt > 0) {
      const d = Math.min(1, Math.abs(q.dot(this._prevQ)));
      const ang = 2 * Math.acos(d);
      const w = ang / dt;
      this._angVel += (w - this._angVel) * Math.min(1, dt * 12);
      // Gier/Neigung (für das Gehäuse): Differenz der Blickrichtung
      _f1.set(0, 0, -1).applyQuaternion(q);
      _f0.set(0, 0, -1).applyQuaternion(this._prevQ);
      const yawRate = (Math.atan2(-_f1.x, -_f1.z) - Math.atan2(-_f0.x, -_f0.z));
      const yr = Math.atan2(Math.sin(yawRate), Math.cos(yawRate)) / dt;
      const pr = (Math.asin(Math.max(-1, Math.min(1, _f1.y))) - Math.asin(Math.max(-1, Math.min(1, _f0.y)))) / dt;
      // Hochpass: nur das Zittern bewegt das Gehäuse (Federmasse), nicht das gleichmäßige Drehen
      const k = Math.min(1, dt * 6);
      this._yawRate += (yr - this._yawRate) * k;
      this._pitchRate += (pr - this._pitchRate) * k;
      const s = this.cfg.reducedMotion ? 0 : 0.0016;
      const tx = Math.max(-0.006, Math.min(0.006, -(yr - this._yawRate) * s));
      const ty = Math.max(-0.006, Math.min(0.006, (pr - this._pitchRate) * s));
      this._shift.x += (tx - this._shift.x) * Math.min(1, dt * 10);
      this._shift.y += (ty - this._shift.y) * Math.min(1, dt * 10);
    }
    const target = Math.max(0, Math.min(1, (this._angVel - 0.8) / 3.5));
    this._motion += (target - this._motion) * Math.min(1, dt * (target > this._motion ? 8 : 2.5));
    if (this.exposure && p.distanceToSquared(this._prevPos) > 36) this.exposure.reset(); // Respawn/Teleport
    this._prevQ.copy(q);
    this._prevPos.copy(p);
  }

  /** Effektive Bildwerte aus postState (renderer.post) + Stil. */
  _gradeState(post, classic) {
    const autoOn = !classic && this.cfg.autoExposure !== false && !!this.exposure;
    return {
      exposure: post.exposure,
      auto: autoOn,
      exposureTex: autoOn ? this.exposure.texture : null,
      lut: classic ? null : this.lut,
      lutMix: 1,
      // AgX hat eine weiche Schulter/Fußzone; Kontrast (log, um Mittelgrau) und Sättigung davor geben den harten
      // Videolook. postState-Werte wirken relativ zu ihren klassischen Standardwerten (1,12 / 1,16).
      saturation: classic ? post.saturation : (post.saturation / 1.16) * AGX_SAT,
      desaturate: post.desaturate,
      contrast: classic ? post.contrast : (post.contrast / 1.12) * AGX_CONTRAST,
      flash: post.flash || 0,
      classic,
    };
  }

  /**
   * Ein Bild. post = Werte aus renderer.post (+ suppression/flash wirksam). Gibt false zurück, wenn der Aufrufer
   * direkt rendern soll (Modus 'direct').
   */
  render(scene, camera, vmScene, vmCamera, post) {
    if (!this.active) return false;
    const r = this.renderer;
    const now = performance.now();
    const dt = this._last ? Math.min(0.25, (now - this._last) / 1000) : 0;
    this._last = now;
    this.frame++;
    this.stats.passes = 0;
    this.stats.sceneRenders = 0;
    const style = STYLE[this.style];
    const cfg = this.cfg;
    const L = this.lens;
    L.camera = camera;
    L.configure({ amount: style.distortion * (cfg.strength ?? 0.7) * (cfg.reducedMotion ? 0.5 : 1) });
    L.update(camera.fov, camera.aspect);
    this._trackCamera(camera, dt);

    // Überscan: Szene und Viewmodel mit größerem Sichtfeld rendern (Bildmitte behält den Maßstab)
    const F = L.active ? L.F : 1;
    const fov0 = camera.fov, vfov0 = vmCamera ? vmCamera.fov : 0;
    const hasVm = !!(vmScene && vmCamera && vmScene.visible !== false);
    const autoClear0 = r.autoClear;
    let shaftsOn = false;
    try {
      if (F > 1.0001) { widen(camera, F); if (hasVm) widen(vmCamera, F); }
      r.setRenderTarget(this.hdr);
      r.autoClear = true;
      r.render(scene, camera);
      this.stats.sceneRenders++;
      if (this.gtao) {
        this.gtao.scene = scene;
        this.gtao.camera = camera;
        this.gtao.render(r, null, null);
        const bm = this.gtao.blendMaterial;
        bm.uniforms.intensity.value = this.gtao.blendIntensity;
        bm.uniforms.tDiffuse.value = this.gtao.pdRenderTarget.texture;
        r.autoClear = false;
        this.fs.draw(r, bm, this.hdr);
        this.stats.sceneRenders++;
      }
      // Lichtstrahlen: Himmelsmaske braucht die Tiefe der Welt (vor dem Viewmodel), Sonne im überscannten Bild
      shaftsOn = false;
      const sStrength = style.classic ? 0 : this.mood.shafts || 0;
      if (this.shafts && sStrength > 0 && this.shafts.locate(camera, this.sunDir) > 0.01) {
        const gs = this._gradeState(post, false);
        if (gs.auto) gs.exposureTex = this.exposure.texture;
        r.autoClear = false;
        this.shafts.render(r, this.fs, this.hdr.texture, this.hdr.depthTexture, this.inner.w / this.inner.h, gs, camera);
        shaftsOn = true;
      }
      if (hasVm) {
        r.setRenderTarget(this.hdr);
        r.autoClear = false;
        r.clearDepth();
        r.render(vmScene, vmCamera);
        this.stats.sceneRenders++;
      }
    } finally {
      if (F > 1.0001) {
        camera.fov = fov0; camera.updateProjectionMatrix();
        if (hasVm) { vmCamera.fov = vfov0; vmCamera.updateProjectionMatrix(); }
      }
    }
    r.autoClear = false;

    const classic = style.classic;
    const g = this._gradeState(post, classic);
    // Belichtung (low: jedes 2. Bild)
    this._expDt += dt;
    if (g.auto && (this.mode === 'full' || (this.frame & 1) === 0 || this.exposure.resetPending)) {
      this.exposure.update(r, this.fs, this.hdr.texture, this._expDt);
      this._expDt = 0;
      g.exposureTex = this.exposure.texture;
    }

    // Körnung: neues Muster ~24×/s (reduzierte Bewegung: 8×/s)
    this._grainT += dt;
    const grainHz = cfg.reducedMotion ? 8 : 24;
    if (this._grainT >= 1 / grainHz) {
      this._grainT %= 1 / grainHz;
      this._seed.set(17 + Math.floor(Math.random() * 4093), 29 + Math.floor(Math.random() * 4093));
    }

    let src = this.hdr;
    if (this.mode === 'full') {
      // Bloom
      let bloomOn = false;
      if (this.bloom) {
        const mb = classic ? CLASSIC_BLOOM : this.mood.bloom;
        const customT = post.bloomThreshold !== CLASSIC_BLOOM.threshold;
        const customS = post.bloomStrength !== CLASSIC_BLOOM.strength;
        this.bloom.threshold = customT || classic ? post.bloomThreshold : mb.threshold;
        this.bloom.knee = this.bloom.threshold * 0.5;
        this.bloom.radius = classic ? CLASSIC_BLOOM.radius : 0.85;
        this.bloom.render(r, this.fs, this.hdr.texture, this.inner.w, this.inner.h, g);
        this._bloomStrength = customS || classic ? post.bloomStrength : mb.strength;
        this._bloomDirt = style.bloomDirt ? (mb.dirt ?? 0.5) : 0;
        bloomOn = this._bloomStrength > 0;
      }
      // Grade → 8 Bit
      const gm = this.gradePass.material(classic);
      setGradeUniforms(gm.uniforms, g);
      gm.uniforms.tScene.value = this.hdr.texture;
      gm.uniforms.tBloom.value = bloomOn ? this.bloom.texture : null;
      // Stärke wie beim früheren UnrealBloom (Summe der Stufengewichte ≈ 3), über die Stufenzahl normiert
      const gain = bloomOn ? (this._bloomStrength * 3) / this.bloom.levelSum : 0;
      gm.uniforms.uBloom.value = gain;
      const dirt = bloomOn && this._bloomDirt > 0 ? lensDirtTexture() : null;
      gm.uniforms.tDirt.value = dirt;
      gm.uniforms.uDirt.value = dirt ? gain * this._bloomDirt * 2.5 : 0;
      gm.uniforms.tShafts.value = shaftsOn ? this.shafts.texture : null;
      gm.uniforms.tDepth.value = shaftsOn ? this.hdr.depthTexture : null;
      gm.uniforms.uShafts.value = shaftsOn ? (this.mood.shafts || 0) * this.shafts.visible : 0;
      this.fs.draw(r, gm, this.ldr[0]);
      src = this.ldr[0];
      // Kantenglättung im Bildraum
      if (this.aa) {
        this.aa.renderToScreen = false;
        // SMAA verwirft Pixel ohne Kante → Zwischenziele müssen gelöscht werden (wie im EffectComposer)
        r.getClearColor(_clear);
        const ca = r.getClearAlpha();
        r.setClearColor(0x000000, 0);
        r.autoClear = true;
        this.aa.render(r, this.ldr[1], this.ldr[0]);
        r.autoClear = false;
        r.setClearColor(_clear, ca);
        this.stats.passes += this.aa instanceof SMAAPass ? 3 : 1;
        src = this.ldr[1];
      }
    }

    // Objektiv → Bildschirm
    const upscale = this.inner.w < this.out.w - 1;
    const resample = this.mode === 'lite' ? 0 : upscale && cfg.upscaler !== 'bilinear' ? 2 : 1;
    const lm = this.lensPass.material({ inline: this.mode === 'lite', classic: classic && this.mode === 'lite', resample });
    const u = lm.uniforms;
    if (this.mode === 'lite') setGradeUniforms(u, g);
    u.tColor.value = src.texture;
    u.uSrc.value.set(src.width, src.height, 1 / src.width, 1 / src.height);
    u.uOut.value.set(this.out.w, this.out.h, 1 / this.out.w, 1 / this.out.h);
    L.uniform(u.uLens.value);
    u.uLens.value.z = this.out.w / this.out.h;
    u.uLensOn.value = L.active ? 1 : 0;
    u.uCA.value = this.mode === 'lite' ? 0 : style.ca * (cfg.strength ?? 0.7);
    u.uVig.value = style.vignette * (0.4 + 0.6 * (cfg.strength ?? 0.7));
    u.uVigC.value = classic ? post.vignette : style.vigClassic;
    u.uDamage.value = post.damage;
    u.uSupp.value = Math.max(0, Math.min(1, post.suppression || 0));
    u.uGrain.value = style.grain * (cfg.grain ?? 0.6);
    u.uGrainSeed.value.copy(this._seed);
    const dpr = this.out.h / Math.max(1, this.cssH || this.out.h);
    u.uGrainScale.value = Math.max(1, Math.round(dpr * 0.9));
    u.uArt.value = style.artifacts * (cfg.artifacts ?? 0.35);
    u.uMotion.value = cfg.reducedMotion ? this._motion * 0.5 : this._motion;
    u.uBlock.value = Math.max(8, Math.round(8 * dpr));
    u.uBorder.value = cfg.border && this.style === 'bodycam' ? 1 : 0;
    u.uBorderShift.value.copy(this._shift);
    // Schärfe: low/medium etwas kräftiger (FXAA/bilineares Hochziehen weicht auf), Hochskalierung zusätzlich
    const sharpBase = style.sharpen * (cfg.sharpness ?? 0.5);
    u.uSharp.value = Math.min(1, sharpBase * (resample === 1 ? 1.1 : 0.9) + (upscale && sharpBase > 0 ? 0.12 : 0));
    this.fs.draw(r, lm, null);
    r.autoClear = autoClear0;
    return true;
  }

  /** Alle Varianten vorab kompilieren (Ladebildschirm). */
  compile() {
    if (!this.active) return;
    const r = this.renderer;
    const classic = STYLE[this.style].classic;
    if (this.mode === 'lite') {
      this.fs.compile(r, this.lensPass.material({ inline: true, classic, resample: 0 }));
    } else {
      this.fs.compile(r, this.gradePass.material(classic));
      this.fs.compile(r, this.lensPass.material({ resample: 1 }));
      this.fs.compile(r, this.lensPass.material({ resample: 2 }));
      if (this.bloom) for (const m of this.bloom.materials()) this.fs.compile(r, m);
      if (this.shafts) for (const m of this.shafts.materials()) this.fs.compile(r, m);
    }
    if (this.exposure) for (const m of this.exposure.materials()) this.fs.compile(r, m);
  }

  /** Render-Ziele der Kette (für memoryEstimate). */
  targetInfo() {
    const out = [];
    const bytes = (rt) => (rt ? rt.width * rt.height * (rt.npBpp || 4) : 0);
    if (this.hdr) out.push({ name: `Szene ${this.fmt ? this.fmt.name : ''} + Tiefe`, bytes: bytes(this.hdr) });
    const ldr = this.ldr.reduce((s, t) => s + bytes(t), 0);
    if (ldr) out.push({ name: 'Bildpuffer 8 Bit', bytes: ldr });
    if (this.bloom) out.push({ name: 'Bloom', bytes: this.bloom.bytes() });
    if (this.shafts) out.push({ name: 'Lichtstrahlen', bytes: this.shafts.bytes() });
    if (this.aa instanceof SMAAPass) out.push({ name: 'SMAA', bytes: this.inner.w * this.inner.h * 8 + 160 * 560 + 64 * 16 });
    if (this.gtao) out.push({ name: 'GTAO', bytes: this.inner.w * this.inner.h * (8 + 4 + 4 + 4) });
    if (this.exposure) out.push({ name: 'Belichtung', bytes: this.exposure.bytes() });
    if (this.lut) out.push({ name: 'LUT', bytes: this.lut.image.width ** 3 * 4 });
    return out;
  }

  describe() {
    return {
      mode: this.mode, style: this.style, hdr: this.fmt ? this.fmt.name : null,
      internal: `${this.inner.w}×${this.inner.h}`, output: `${this.out.w}×${this.out.h}`,
      passes: this.stats.passes, sceneRenders: this.stats.sceneRenders,
      lens: this.lens.active ? { kappa: Math.round(this.lens.kappa * 1000) / 1000, overscan: Math.round(this.lens.F * 1000) / 1000 } : null,
      mood: this.mood.id, exposure: this.exposure && this.exposure.last ? Math.round(this.exposure.last.factor * 100) / 100 : null,
      upscaler: this.inner.w < this.out.w - 1 ? (this.mode === 'lite' ? 'lite' : this.cfg.upscaler === 'bilinear' ? 'bilinear' : 'fsr1') : 'nativ',
    };
  }

  _disposeTargets() {
    if (this.hdr) this.hdr.dispose();
    this.hdr = null;
    for (const t of this.ldr) if (t) t.dispose();
    this.ldr = [null, null];
    if (this.exposure) this.exposure.dispose();
    this.exposure = null;
    if (this.bloom) this.bloom.dispose();
    this.bloom = null;
    if (this.aa) this.aa.dispose();
    this.aa = null;
    if (this.gtao) this.gtao.dispose();
    this.gtao = null;
    if (this.shafts) this.shafts.dispose();
    this.shafts = null;
  }

  dispose() {
    this._disposeTargets();
    this.lensPass.dispose();
    this.gradePass.dispose();
    this.mode = 'direct';
  }
}

const _clear = new THREE.Color();
const _f0 = new THREE.Vector3();
const _f1 = new THREE.Vector3();
