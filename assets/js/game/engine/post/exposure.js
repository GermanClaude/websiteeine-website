// NULLPUNKT — Automatische Belichtung (R4), vollständig auf der GPU (kein readPixels im Spielbild):
//   HDR-Szene → N×N log-Leuchtdichte (mittenbetont, Waffe unten rechts schwach gewichtet, je Zelle 4 Proben)
//   → 8×8 (Summen) → 1×1-Anpassung (Ping-Pong) mit getrenntem Tempo heller/dunkler.
// Ergebnis: 1×1-Textur, R = Belichtungsfaktor relativ zur Kartenbelichtung, G = log2 davon (für die
// Anpassung), B = gemessene mittlere log2-Leuchtdichte (Diagnose). Grade/Bloom lesen R direkt.
//
// Faktor-Ziel: log2 A = strength · (log2 ref − log2 L̄), begrenzt auf [evMin, evMax]. ref ist die mittlere
// Leuchtdichte typischer Ansichten der Karte (dort bleibt der abgestimmte Look unverändert); dunkle Innenräume
// werden heller, Blicke in den Himmel dunkler. Heller wird schnell (up), dunkler langsam (down) → beim Schritt
// aus dem dunklen Flur ins Freie brennt das Bild kurz aus (Bodycam-Moment, plan §5.4).

import * as THREE from 'three';
import { FULLSCREEN_VERT, GLSL_COMMON, smallFloatTarget } from './common.js';

const LUM_FRAG = /* glsl */ `
  ${GLSL_COMMON}
  uniform sampler2D tScene;
  uniform vec2 uCell;      // 1/N
  varying vec2 vUv;
  float weightAt(vec2 uv) {
    // mittenbetont (leicht über der Mitte – dort ist der Blick), Ränder zählen weniger
    vec2 d = (uv - vec2(0.5, 0.54)) / vec2(0.36, 0.3);
    float w = exp(-0.5 * dot(d, d)) + 0.08;
    // Waffe/Arme unten rechts (bzw. unten mittig) kaum werten
    w *= 1.0 - 0.75 * smoothstep(0.42, 0.62, uv.x) * (1.0 - smoothstep(0.18, 0.42, uv.y));
    w *= 1.0 - 0.4 * (1.0 - smoothstep(0.08, 0.22, uv.y));
    return w;
  }
  void main() {
    vec2 o = uCell * 0.25;
    float s = 0.0;
    float L;
    L = npLuma(texture2D(tScene, vUv + vec2(-o.x, -o.y)).rgb); s += log2(clamp(L, 1e-4, 1e4));
    L = npLuma(texture2D(tScene, vUv + vec2( o.x, -o.y)).rgb); s += log2(clamp(L, 1e-4, 1e4));
    L = npLuma(texture2D(tScene, vUv + vec2(-o.x,  o.y)).rgb); s += log2(clamp(L, 1e-4, 1e4));
    L = npLuma(texture2D(tScene, vUv + vec2( o.x,  o.y)).rgb); s += log2(clamp(L, 1e-4, 1e4));
    float w = weightAt(vUv);
    gl_FragColor = vec4(s * 0.25 * w, w, 0.0, 1.0);
  }
`;

const REDUCE_FRAG = /* glsl */ `
  uniform sampler2D tLum;
  uniform int uBlock;       // Zellen je Ausgabepixel und Achse
  void main() {
    ivec2 base = ivec2(gl_FragCoord.xy) * uBlock;
    vec2 acc = vec2(0.0);
    for (int y = 0; y < 8; y++) {
      if (y >= uBlock) break;
      for (int x = 0; x < 8; x++) {
        if (x >= uBlock) break;
        acc += texelFetch(tLum, base + ivec2(x, y), 0).rg;
      }
    }
    gl_FragColor = vec4(acc, 0.0, 1.0);
  }
`;

const ADAPT_FRAG = /* glsl */ `
  uniform sampler2D tSum;   // 8×8 (bzw. kleiner) Teilsummen
  uniform sampler2D tPrev;  // vorige 1×1-Anpassung
  uniform int uSize;
  uniform float uDt;
  uniform float uReset;
  uniform float uRef;       // log2 Referenzleuchtdichte
  uniform float uStrength;
  uniform vec2 uRange;      // evMin, evMax
  uniform vec2 uSpeed;      // heller, dunkler (1/s)
  uniform float uBias;      // zusätzliche Blendenstufen (z. B. Blendung)
  void main() {
    vec2 acc = vec2(0.0);
    for (int y = 0; y < 8; y++) {
      if (y >= uSize) break;
      for (int x = 0; x < 8; x++) {
        if (x >= uSize) break;
        acc += texelFetch(tSum, ivec2(x, y), 0).rg;
      }
    }
    float avgLog = acc.x / max(acc.y, 1e-4);
    float target = clamp(uStrength * (uRef - avgLog), uRange.x, uRange.y) + uBias;
    vec4 prev = texelFetch(tPrev, ivec2(0), 0);
    float ev = prev.g;
    if (uReset > 0.5 || prev.a < 0.5 || !(ev == ev)) ev = target; // erstes Bild / Sprung / NaN-Schutz
    else {
      float k = target > ev ? uSpeed.x : uSpeed.y;
      ev += (target - ev) * (1.0 - exp(-uDt * k));
    }
    gl_FragColor = vec4(exp2(ev), ev, avgLog, 1.0);
  }
`;

export class AutoExposure {
  /** @param {{ size?: number }} opts  size = Messgitter (64 Desktop, 32 Telefon) */
  constructor({ size = 64 } = {}) {
    this.size = size;
    this.block = 8;
    this.sumSize = Math.max(1, Math.ceil(size / this.block));
    this.lumRT = smallFloatTarget(size, size);
    this.sumRT = smallFloatTarget(this.sumSize, this.sumSize);
    this.adapt = [smallFloatTarget(1, 1), smallFloatTarget(1, 1)];
    this.idx = 0;
    this.resetPending = true;
    this.params = { ref: 0.13, strength: 0.72, evMin: -1.6, evMax: 1.8, up: 2.6, down: 1.25 };
    this.bias = 0;
    /** Letzter zurückgelesener Wert (nur wenn `track`): { factor, ev, avgLog, at } */
    this.last = null;
    this.track = false;
    this._reading = false;
    this._readAt = 0;
    this._readBuf = new Uint16Array(4);

    this.lumMat = new THREE.ShaderMaterial({
      name: 'NullpunktExposureLum',
      uniforms: { tScene: { value: null }, uCell: { value: new THREE.Vector2(1 / size, 1 / size) } },
      vertexShader: FULLSCREEN_VERT, fragmentShader: LUM_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.reduceMat = new THREE.ShaderMaterial({
      name: 'NullpunktExposureReduce',
      uniforms: { tLum: { value: this.lumRT.texture }, uBlock: { value: this.block } },
      vertexShader: FULLSCREEN_VERT, fragmentShader: REDUCE_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      name: 'NullpunktExposureAdapt',
      uniforms: {
        tSum: { value: this.sumRT.texture }, tPrev: { value: null }, uSize: { value: this.sumSize },
        uDt: { value: 0 }, uReset: { value: 1 }, uRef: { value: Math.log2(0.13) }, uStrength: { value: 0.72 },
        uRange: { value: new THREE.Vector2(-1.6, 1.8) }, uSpeed: { value: new THREE.Vector2(2.6, 1.25) }, uBias: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT, fragmentShader: ADAPT_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    });
  }

  /** 1×1-Ergebnis (R = Faktor). */
  get texture() { return this.adapt[this.idx].texture; }

  /** Parameter der Stimmung übernehmen ({ ref, strength, evMin, evMax, up, down }). */
  setParams(p = {}) {
    Object.assign(this.params, p);
    const u = this.adaptMat.uniforms;
    u.uRef.value = Math.log2(Math.max(1e-4, this.params.ref));
    u.uStrength.value = Math.max(0, Math.min(1, this.params.strength));
    u.uRange.value.set(this.params.evMin, this.params.evMax);
    u.uSpeed.value.set(this.params.up, this.params.down);
  }

  /** Nächste Messung springt direkt auf den Zielwert (Kartenwechsel, Respawn, Teleport). */
  reset() { this.resetPending = true; }

  /** Messen + anpassen. fs = Fullscreen-Helfer, dt = Echtzeit seit der letzten Anpassung (s). */
  update(renderer, fs, sceneTexture, dt) {
    this.lumMat.uniforms.tScene.value = sceneTexture;
    fs.draw(renderer, this.lumMat, this.lumRT);
    fs.draw(renderer, this.reduceMat, this.sumRT);
    const prev = this.adapt[this.idx];
    this.idx ^= 1;
    const u = this.adaptMat.uniforms;
    u.tPrev.value = prev.texture;
    u.uDt.value = Math.min(0.5, Math.max(0, dt));
    u.uReset.value = this.resetPending ? 1 : 0;
    u.uBias.value = this.bias;
    this.resetPending = false;
    fs.draw(renderer, this.adaptMat, this.adapt[this.idx]);
    if (this.track) this._maybeRead(renderer);
  }

  /** Nicht blockierendes Zurücklesen (höchstens 4×/s) für Diagnose/Prüfseite. */
  _maybeRead(renderer) {
    const now = performance.now();
    if (this._reading || now - this._readAt < 250 || typeof renderer.readRenderTargetPixelsAsync !== 'function') return;
    this._reading = true;
    this._readAt = now;
    const rt = this.adapt[this.idx];
    renderer.readRenderTargetPixelsAsync(rt, 0, 0, 1, 1, this._readBuf)
      .then((buf) => {
        const f = THREE.DataUtils.fromHalfFloat;
        this.last = { factor: f(buf[0]), ev: f(buf[1]), avgLog: f(buf[2]), at: performance.now() };
      })
      .catch(() => {})
      .finally(() => { this._reading = false; });
  }

  /** Blockierendes Zurücklesen (nur Prüfseiten/Tests – hält die GPU an). */
  readNow(renderer) {
    try {
      renderer.readRenderTargetPixels(this.adapt[this.idx], 0, 0, 1, 1, this._readBuf);
      const f = THREE.DataUtils.fromHalfFloat, b = this._readBuf;
      this.last = { factor: f(b[0]), ev: f(b[1]), avgLog: f(b[2]), at: performance.now() };
    } catch { /* ignorieren */ }
    return this.last;
  }

  materials() { return [this.lumMat, this.reduceMat, this.adaptMat]; }

  /** Speicher der Ziele in Bytes. */
  bytes() { return (this.size * this.size + this.sumSize * this.sumSize + 2) * 8; }

  dispose() {
    this.lumRT.dispose();
    this.sumRT.dispose();
    for (const rt of this.adapt) rt.dispose();
    for (const m of this.materials()) m.dispose();
  }
}
