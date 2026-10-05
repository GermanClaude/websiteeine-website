// NULLPUNKT — Bloom/Glanz (medium+): physikalisch motivierter Mip-Bloom (13-Tap-Abwärts mit Karis-Mittel im
// ersten Schritt, 9-Tap-Zelt aufwärts, additiv) im *belichteten* Raum: die Schwelle gilt nach der automatischen
// Belichtung (Textur aus exposure.js, kein Zurücklesen). Weiches Knie auf dem größten Farbkanal, Ausgang je
// Quelle begrenzt (Sonne/Explosion fluten das Bild nicht). Linsenschmutz: prozedurale Maske (Canvas, 256×144),
// die im Grade-Pass mit dem Bloom multipliziert wird (Bodycam-Stil).

import * as THREE from 'three';
import { FULLSCREEN_VERT, GLSL_COMMON, hdrTarget } from './common.js';

const PREFILTER_FRAG = /* glsl */ `
  ${GLSL_COMMON}
  uniform sampler2D tSrc;
  uniform sampler2D tExposure;
  uniform vec2 uTexel;        // 1/Quellgröße
  uniform float uExposure;
  uniform float uAutoExp;
  uniform vec3 uThreshold;    // Schwelle, Knie, Obergrenze
  varying vec2 vUv;
  vec3 tapK(vec2 uv) { return texture2D(tSrc, uv).rgb; }
  float karis(vec3 c) { return 1.0 / (1.0 + npLuma(c)); }
  void main() {
    float E = uExposure;
    if (uAutoExp > 0.5) E *= texelFetch(tExposure, ivec2(0), 0).r;
    vec2 t = uTexel;
    // 13 Taps (Jimenez 2014): 4 innere + 9 äußere, in 5 Gruppen mit Karis-Gewicht gegen Glühwürmchen
    vec3 a = tapK(vUv + t * vec2(-2.0, 2.0)), b = tapK(vUv + t * vec2(0.0, 2.0)), c = tapK(vUv + t * vec2(2.0, 2.0));
    vec3 d = tapK(vUv + t * vec2(-2.0, 0.0)), e = tapK(vUv), f = tapK(vUv + t * vec2(2.0, 0.0));
    vec3 g = tapK(vUv + t * vec2(-2.0, -2.0)), h = tapK(vUv + t * vec2(0.0, -2.0)), i = tapK(vUv + t * vec2(2.0, -2.0));
    vec3 j = tapK(vUv + t * vec2(-1.0, 1.0)), k = tapK(vUv + t * vec2(1.0, 1.0));
    vec3 l = tapK(vUv + t * vec2(-1.0, -1.0)), m = tapK(vUv + t * vec2(1.0, -1.0));
    vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
    float w0 = karis(g0) * 0.5, w1 = karis(g1) * 0.125, w2 = karis(g2) * 0.125, w3 = karis(g3) * 0.125, w4 = karis(g4) * 0.125;
    vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    col = clamp(col * E, 0.0, 65000.0);
    float br = npMax3(col);
    float knee = uThreshold.y;
    float soft = clamp(br - uThreshold.x + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    vec3 o = col * (max(soft, br - uThreshold.x) / max(br, 1e-4));
    o *= min(1.0, uThreshold.z / max(npMax3(o), 1e-4));
    gl_FragColor = vec4(o, 1.0);
  }
`;

const DOWN_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 tp(vec2 o) { return texture2D(tSrc, vUv + uTexel * o).rgb; }
  void main() {
    vec3 e = tp(vec2(0.0));
    vec3 inner = tp(vec2(-1.0, 1.0)) + tp(vec2(1.0, 1.0)) + tp(vec2(-1.0, -1.0)) + tp(vec2(1.0, -1.0));
    vec3 cross = tp(vec2(0.0, 2.0)) + tp(vec2(-2.0, 0.0)) + tp(vec2(2.0, 0.0)) + tp(vec2(0.0, -2.0));
    vec3 corner = tp(vec2(-2.0, 2.0)) + tp(vec2(2.0, 2.0)) + tp(vec2(-2.0, -2.0)) + tp(vec2(2.0, -2.0));
    gl_FragColor = vec4(e * 0.125 + inner * 0.125 + cross * 0.0625 + corner * 0.03125, 1.0);
  }
`;

const UP_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uRadius;
  uniform float uWeight;
  varying vec2 vUv;
  vec3 tp(vec2 o) { return texture2D(tSrc, vUv + uTexel * o * uRadius).rgb; }
  void main() {
    vec3 s = tp(vec2(0.0)) * 4.0;
    s += (tp(vec2(0.0, 1.0)) + tp(vec2(-1.0, 0.0)) + tp(vec2(1.0, 0.0)) + tp(vec2(0.0, -1.0))) * 2.0;
    s += tp(vec2(-1.0, 1.0)) + tp(vec2(1.0, 1.0)) + tp(vec2(-1.0, -1.0)) + tp(vec2(1.0, -1.0));
    gl_FragColor = vec4(s * (uWeight / 16.0), 1.0);
  }
`;

export class Bloom {
  /** levels: Anzahl Mip-Stufen (Start halbe Auflösung). */
  constructor({ levels = 5 } = {}) {
    this.levels = levels;
    this.targets = [];
    this.width = 0;
    this.height = 0;
    this.radius = 0.85;
    this.threshold = 2.4;
    this.knee = 1.2;
    this.maxBright = 10;
    const common = { vertexShader: FULLSCREEN_VERT, depthTest: false, depthWrite: false, toneMapped: false };
    this.prefilter = new THREE.ShaderMaterial({
      name: 'NullpunktBloomPrefilter', ...common, fragmentShader: PREFILTER_FRAG,
      uniforms: {
        tSrc: { value: null }, tExposure: { value: null }, uTexel: { value: new THREE.Vector2() },
        uExposure: { value: 1 }, uAutoExp: { value: 0 }, uThreshold: { value: new THREE.Vector3(2.4, 1.2, 10) },
      },
    });
    this.down = new THREE.ShaderMaterial({
      name: 'NullpunktBloomDown', ...common, fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    });
    this.up = new THREE.ShaderMaterial({
      name: 'NullpunktBloomUp', ...common, fragmentShader: UP_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uWeight: { value: 1 } },
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      transparent: true,
    });
  }

  get texture() { return this.targets.length ? this.targets[0].texture : null; }

  setSize(renderer, w, h) {
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    if (bw === this.width && bh === this.height && this.targets.length) return;
    this.width = bw;
    this.height = bh;
    let lw = bw, lh = bh;
    for (let i = 0; i < this.levels; i++) {
      if (!this.targets[i]) this.targets[i] = hdrTarget(renderer, lw, lh);
      else this.targets[i].setSize(lw, lh);
      lw = Math.max(1, lw >> 1);
      lh = Math.max(1, lh >> 1);
    }
  }

  /**
   * src = HDR-Szene (volle interne Auflösung). g = { exposure, auto, exposureTex }.
   * Ergebnis in this.texture (halbe Auflösung, belichtete Werte).
   */
  render(renderer, fs, src, srcW, srcH, g) {
    const t = this.targets;
    const p = this.prefilter.uniforms;
    p.tSrc.value = src;
    p.uTexel.value.set(1 / srcW, 1 / srcH);
    p.uExposure.value = g.exposure;
    p.uAutoExp.value = g.auto && g.exposureTex ? 1 : 0;
    p.tExposure.value = g.exposureTex;
    p.uThreshold.value.set(this.threshold, Math.max(0.05, this.knee), this.maxBright);
    fs.draw(renderer, this.prefilter, t[0]);
    const d = this.down.uniforms;
    for (let i = 1; i < t.length; i++) {
      d.tSrc.value = t[i - 1].texture;
      d.uTexel.value.set(1 / t[i - 1].width, 1 / t[i - 1].height);
      fs.draw(renderer, this.down, t[i]);
    }
    // aufwärts: jede Stufe bekommt die (bereits aufaddierte) kleinere Stufe dazu (additive Mischung)
    const u = this.up.uniforms;
    renderer.autoClear = false;
    for (let i = t.length - 2; i >= 0; i--) {
      u.tSrc.value = t[i + 1].texture;
      u.uTexel.value.set(1 / t[i + 1].width, 1 / t[i + 1].height);
      u.uRadius.value = this.radius;
      u.uWeight.value = 0.9; // größere Stufen tragen etwas weniger (weiter Schleier bleibt dezent)
      fs.draw(renderer, this.up, t[i]);
    }
  }

  materials() { return [this.prefilter, this.down, this.up]; }

  bytes() {
    let b = 0;
    for (const rt of this.targets) b += rt.width * rt.height * (rt.userData.bpp || 8);
    return b;
  }

  dispose() {
    for (const rt of this.targets) rt.dispose();
    this.targets.length = 0;
    this.width = this.height = 0;
    for (const m of this.materials()) m.dispose();
  }
}

/* ------------------------------------------------------------ Linsenschmutz */

let _dirt = null;
/** Prozedurale Schmutzmaske (Fett, Wasserflecken, Staub) – einmal je Seite, 256×144, linear. */
export function lensDirtTexture() {
  if (_dirt) return _dirt;
  const W = 256, H = 144;
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cv) return null;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgb(18,18,20)';
  ctx.fillRect(0, 0, W, H);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.globalCompositeOperation = 'lighter';
  // große, weiche Fettschlieren (eher am Rand)
  for (let i = 0; i < 22; i++) {
    const edge = rnd() < 0.7;
    const x = edge ? (rnd() < 0.5 ? rnd() * W * 0.3 : W - rnd() * W * 0.3) : rnd() * W;
    const y = rnd() * H;
    const r = 14 + rnd() * 46;
    const a = 0.05 + rnd() * 0.1;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${200 + rnd() * 40 | 0},${190 + rnd() * 40 | 0},${170 + rnd() * 40 | 0},${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  // Wasserflecken (Ringe)
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W, y = rnd() * H, r = 3 + rnd() * 9;
    ctx.strokeStyle = `rgba(255,250,240,${0.12 + rnd() * 0.15})`;
    ctx.lineWidth = 0.6 + rnd() * 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(255,250,240,${0.04 + rnd() * 0.05})`;
    ctx.fill();
  }
  // Staubkörner
  for (let i = 0; i < 160; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.4 + rnd() * 1.3;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.35})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // ein Wischer quer über das Glas
  ctx.strokeStyle = 'rgba(230,225,215,0.07)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(-10, H * 0.82); ctx.bezierCurveTo(W * 0.3, H * 0.55, W * 0.6, H * 0.95, W + 10, H * 0.7); ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.name = 'np:lensdirt';
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  _dirt = tex;
  return tex;
}
