// NULLPUNKT — Lichtstrahlen (R7, medium+): Bildschirmraum-Strahlen aus der Sonnenrichtung.
// Himmelsmaske (Tiefe = Fernebene) in ¼-Auflösung, nur in der Nähe der Sonne, dann zwei radiale
// Unschärfe-Durchgänge zur Sonne hin (je 16 Taps, abklingend). Ergebnis (belichtete Werte) addiert der Grade-Pass.
// Die Maske liest die Tiefe der Welt, bevor das Viewmodel sie löscht.

import * as THREE from 'three';
import { FULLSCREEN_VERT, GLSL_COMMON, hdrTarget } from './common.js';

const MASK_FRAG = /* glsl */ `
  ${GLSL_COMMON}
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tExposure;
  uniform float uExposure;
  uniform float uAutoExp;
  uniform vec2 uSun;
  uniform float uAspect;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    float E = uExposure;
    if (uAutoExp > 0.5) E *= texelFetch(tExposure, ivec2(0), 0).r;
    // 4 Tiefenproben je Viertelpixel: Kanten von Kranen/Masten bleiben scharf genug
    vec2 o = uTexel * 0.25;
    float sky = 0.0;
    sky += step(0.99995, texture2D(tDepth, vUv + vec2(-o.x, -o.y)).r);
    sky += step(0.99995, texture2D(tDepth, vUv + vec2( o.x, -o.y)).r);
    sky += step(0.99995, texture2D(tDepth, vUv + vec2(-o.x,  o.y)).r);
    sky += step(0.99995, texture2D(tDepth, vUv + vec2( o.x,  o.y)).r);
    sky *= 0.25;
    // nur der helle Hof um die Sonne erzeugt Strahlen (der übrige Himmel würde als Schleier über allem liegen)
    vec3 c = min(max(texture2D(tScene, vUv).rgb * E - 1.0, 0.0), vec3(6.0));
    float d = length((vUv - uSun) * vec2(uAspect, 1.0));
    float w = sky * smoothstep(0.32, 0.0, d);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform sampler2D tDepth;
  uniform vec2 uSun;
  uniform float uSpan;
  uniform float uDecay;
  uniform vec3 uScatter;    // near, far, Streulänge (m); z = 0 → ohne Tiefengewicht
  varying vec2 vUv;
  void main() {
    vec2 delta = (vUv - uSun) * (uSpan / 16.0);
    vec2 uv = vUv;
    vec3 acc = vec3(0.0);
    float w = 1.0;
    for (int i = 0; i < 16; i++) {
      acc += texture2D(tSrc, uv).rgb * w;
      w *= uDecay;
      uv -= delta;
    }
    acc *= 1.0 / 10.0;
    // In-Streuung wächst mit der Strecke bis zum Hindernis: nahe Wände bekommen kaum Strahlen
    if (uScatter.z > 0.0) {
      float d = texture2D(tDepth, vUv).r;
      float viewZ = (uScatter.x * uScatter.y) / ((uScatter.y - uScatter.x) * d - uScatter.y);
      acc *= d > 0.99995 ? 1.0 : 1.0 - exp(viewZ / uScatter.z);
    }
    gl_FragColor = vec4(acc, 1.0);
  }
`;

const _p = new THREE.Vector3();
const _f = new THREE.Vector3();

export class LightShafts {
  constructor() {
    this.a = null;
    this.b = null;
    this.width = 0;
    this.height = 0;
    this.sunUv = new THREE.Vector2(0.5, 0.5);
    this.visible = 0;
    const common = { vertexShader: FULLSCREEN_VERT, depthTest: false, depthWrite: false, toneMapped: false };
    this.mask = new THREE.ShaderMaterial({
      name: 'NullpunktShaftsMask', ...common, fragmentShader: MASK_FRAG,
      uniforms: {
        tScene: { value: null }, tDepth: { value: null }, tExposure: { value: null }, uExposure: { value: 1 }, uAutoExp: { value: 0 },
        uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uTexel: { value: new THREE.Vector2() },
      },
    });
    this.blur = new THREE.ShaderMaterial({
      name: 'NullpunktShaftsBlur', ...common, fragmentShader: BLUR_FRAG,
      uniforms: {
        tSrc: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uSpan: { value: 1 }, uDecay: { value: 0.93 },
        uScatter: { value: new THREE.Vector3(0.05, 600, 0) },
      },
    });
  }

  get texture() { return this.a ? this.a.texture : null; }

  setSize(renderer, w, h) {
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    if (qw === this.width && qh === this.height && this.a) return;
    this.width = qw;
    this.height = qh;
    if (!this.a) { this.a = hdrTarget(renderer, qw, qh); this.b = hdrTarget(renderer, qw, qh); }
    else { this.a.setSize(qw, qh); this.b.setSize(qw, qh); }
  }

  /**
   * Sonnenposition im (überscannten) Kamerabild bestimmen → Sichtbarkeit 0..1. Muss mit der Projektion laufen,
   * mit der die Szene gerendert wurde.
   */
  locate(camera, sunDir) {
    if (!sunDir) { this.visible = 0; return 0; }
    camera.getWorldDirection(_f);
    const facing = _f.dot(sunDir);
    if (facing <= 0.05) { this.visible = 0; return 0; }
    _p.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
    this.sunUv.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
    const edge = Math.max(Math.abs(_p.x), Math.abs(_p.y));
    this.visible = Math.min(1, (facing - 0.05) * 4) * (1 - Math.min(1, Math.max(0, (edge - 1.0) / 0.6)));
    return this.visible;
  }

  /** Maske + 2 radiale Durchgänge. g = { exposure, auto, exposureTex }. Ergebnis in this.texture. */
  render(renderer, fs, sceneTex, depthTex, aspect, g, camera) {
    const m = this.mask.uniforms;
    m.tScene.value = sceneTex;
    m.tDepth.value = depthTex;
    m.tExposure.value = g.exposureTex;
    m.uExposure.value = g.exposure;
    m.uAutoExp.value = g.auto && g.exposureTex ? 1 : 0;
    m.uSun.value.copy(this.sunUv);
    m.uAspect.value = aspect;
    m.uTexel.value.set(1 / this.width, 1 / this.height);
    fs.draw(renderer, this.mask, this.a);
    const b = this.blur.uniforms;
    b.uSun.value.copy(this.sunUv);
    b.tDepth.value = depthTex;
    b.tSrc.value = this.a.texture; b.uSpan.value = 0.9; b.uDecay.value = 0.94; b.uScatter.value.z = 0;
    fs.draw(renderer, this.blur, this.b);
    b.tSrc.value = this.b.texture; b.uSpan.value = 0.22; b.uDecay.value = 0.97;
    b.uScatter.value.set(camera ? camera.near : 0.05, camera ? camera.far : 600, 45);
    fs.draw(renderer, this.blur, this.a);
  }

  materials() { return [this.mask, this.blur]; }

  bytes() { return this.a ? this.width * this.height * (this.a.npBpp || 8) * 2 : 0; }

  dispose() {
    if (this.a) { this.a.dispose(); this.b.dispose(); }
    this.a = this.b = null;
    this.width = this.height = 0;
    for (const m of this.materials()) m.dispose();
  }
}
