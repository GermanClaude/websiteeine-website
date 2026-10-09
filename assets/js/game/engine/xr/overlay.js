// NULLPUNKT — VR-Overlay (engine/xr): Komfort-Vignette, Trefferrand und Abblende in EINEM billigen Pass.
//
// Eine kleine Kugel (r = 0,25 m, 16 × 10 Segmente) hängt an der XR-Kamera, wird von innen ohne Tiefentest als
// Letztes gezeichnet. Die Deckkraft hängt vom Winkel zwischen Sichtstrahl (je Auge: cameraPosition) und der
// Vorwärtsrichtung des Kopfes ab – nicht von der Bildposition. Damit liegt der Rand optisch „im Unendlichen“: beide
// Augen sehen dieselbe Vignette, kein Stereo-Widerspruch wie bei einer Scheibe dicht vor den Augen.
// Anteile: uVig (0..1, Bewegen/Drehen, innerer Winkel uInner), uHurt (roter Rand nach Treffern, zur Quelle hin
// stärker: uHurtDir = Richtung zur Quelle in Weltkoordinaten), uFade (schwarz, Tod/Wiedereinstieg/VR-Start).
// Unsichtbar (kein Draw Call), solange alle Anteile ≈ 0 sind.

import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vFwd;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vFwd = normalize(-modelMatrix[2].xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uVig;
uniform float uInner;
uniform float uHurt;
uniform vec3 uHurtDir;
uniform float uFade;
varying vec3 vWorld;
varying vec3 vFwd;
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float ang = acos(clamp(dot(d, normalize(vFwd)), -1.0, 1.0));
  float vig = smoothstep(uInner, uInner + 0.38, ang) * uVig;
  float side = 0.55 + 0.45 * max(0.0, dot(d, uHurtDir));
  float hurt = uHurt * smoothstep(0.35, 1.15, ang) * side * 0.8;
  float a = max(max(vig, uFade), hurt);
  float red = a > 1e-4 ? clamp(hurt / a, 0.0, 1.0) * (1.0 - uFade) : 0.0;
  gl_FragColor = vec4(vec3(0.42, 0.0, 0.0) * red, a);
}`;

export class VrOverlay {
  constructor() {
    this.uniforms = {
      uVig: { value: 0 }, uInner: { value: 0.75 }, uHurt: { value: 0 },
      uHurtDir: { value: new THREE.Vector3(0, 0, -1) }, uFade: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false,
    });
    mat.toneMapped = false;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 10), mat);
    this.mesh.name = 'xr-overlay';
    this.mesh.renderOrder = 1e6;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    /** Zielwerte (geglättet in update). vignette: 0..1 × Stärke; fade: 0..1 (sofort setzbar über fadeTo). */
    this.vignette = 0;
    this._vig = 0;
    this.hurt = 0;
    this.fade = 0;
    this._fadeTarget = 0;
    this._fadeRate = 2;
  }

  /** Schwarz ein-/ausblenden: target 0..1 in `seconds`. instant = sofort auf `from` springen. */
  fadeTo(target, seconds = 0.4, from = null) {
    if (from != null) this.fade = from;
    this._fadeTarget = Math.min(1, Math.max(0, target));
    this._fadeRate = 1 / Math.max(0.05, seconds);
  }

  /** Treffer: amount 0..1, dir = Richtung zur Quelle (Welt, normiert) oder null (rundum). */
  hit(amount, dir = null) {
    this.hurt = Math.min(1, Math.max(this.hurt, amount));
    if (dir) this.uniforms.uHurtDir.value.copy(dir);
    else this.uniforms.uHurtDir.value.set(0, 0, 0);
  }

  update(dt, { strength = 0.6, inner = 0.75 } = {}) {
    // Vignette: schnell an, langsamer aus (kein Flackern bei kurzen Stick-Pausen)
    const v = Math.min(1, Math.max(0, this.vignette)) * strength;
    this._vig += (v - this._vig) * (1 - Math.exp(-(v > this._vig ? 14 : 5) * dt));
    this.hurt = Math.max(0, this.hurt - dt * 1.4);
    const f = this._fadeTarget;
    if (this.fade < f) this.fade = Math.min(f, this.fade + dt * this._fadeRate);
    else if (this.fade > f) this.fade = Math.max(f, this.fade - dt * this._fadeRate);
    const u = this.uniforms;
    u.uVig.value = this._vig;
    u.uInner.value = inner;
    u.uHurt.value = this.hurt;
    u.uFade.value = this.fade;
    this.mesh.visible = this._vig > 0.003 || this.hurt > 0.003 || this.fade > 0.003;
  }

  reset() {
    this.vignette = this._vig = this.hurt = this.fade = this._fadeTarget = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
