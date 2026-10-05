// Ego-Effekte: Mündungsfeuer (Stern + seitliche Flammen + Punktlicht, additiv & bloom-freundlich),
// Rauchfahne und gepoolte Hülsen mit einfacher Physik (InstancedMesh, ein Draw Call je Hülsenart).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flashMap, smokeMap } from './textures.js';
import { takeMaterials, parkMaterials } from './materials.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

// Materialien der Ego-Effekte überdauern das Match (Vorrat in materials.js): kein Neu-Linken der Shader je Match
function makeFlashMaterials() {
  const add = (map, color, name) => Object.assign(new THREE.MeshBasicMaterial({
    map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    toneMapped: false, side: THREE.DoubleSide, fog: false,
  }), { name });
  return { star: add(flashMap('star'), new THREE.Color(2.6, 1.7, 0.9), 'vm:flashStar'), side: add(flashMap('side'), new THREE.Color(2.2, 1.35, 0.7), 'vm:flashSide') };
}
const makeSmokeMaterial = () => new THREE.SpriteMaterial({ name: 'vm:smoke', map: smokeMap(), color: 0xb9b3a8, transparent: true, opacity: 0, depthWrite: false, fog: false });
const makeShellMaterials = () => ({
  brass: new THREE.MeshStandardMaterial({ name: 'vm:shell', vertexColors: true, metalness: 0.9, roughness: 0.32 }),
  shot: new THREE.MeshStandardMaterial({ name: 'vm:shellShot', vertexColors: true, metalness: 0.35, roughness: 0.45 }),
});

export class MuzzleFlash {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'muendungsfeuer';
    this._mats = takeMaterials('muzzle', makeFlashMaterials);
    this.starMat = this._mats.star;
    this.sideMat = this._mats.side;
    this.starMat.opacity = this.sideMat.opacity = 1;
    // Frontaler Stern (Normale zur Kamera)
    this.star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.starMat);
    this.star.renderOrder = 10;
    // Zwei gekreuzte Flammenzungen entlang der Laufachse (−Z)
    const sideGeo = new THREE.PlaneGeometry(1, 0.42);
    sideGeo.translate(0.5, 0, 0);
    sideGeo.rotateY(Math.PI / 2);
    const s2 = sideGeo.clone();
    s2.rotateZ(Math.PI / 2);
    this.sides = new THREE.Mesh(mergeGeometries([sideGeo, s2]), this.sideMat);
    this.sides.renderOrder = 10;
    sideGeo.dispose(); s2.dispose();
    this.group.add(this.star, this.sides);
    this.group.visible = false;
    this.light = new THREE.PointLight(0xffa24a, 0, 3.2, 2);
    this.light.name = 'muendungslicht';
    this.t = 1; this.dur = 0.05; this.peak = 0;
  }

  /**
   * Mündungsfeuer: jedes Mal anders (Größe, Seitenverhältnis, Drehung, Flammenzungen nicht immer), sehr kurz
   * (1–2 Bilder wie auf einer Kameraaufnahme). opts.suppressed: kaum Feuer, schwaches Licht (Schalldämpfer).
   */
  fire(size = 1, length = 1, opts = {}) {
    if (size <= 0) return;
    const sup = !!opts.suppressed;
    this.t = 0;
    this.dur = (sup ? 0.022 : 0.026) + 0.018 * Math.random();
    const s = (0.1 + Math.random() * 0.065) * size * (sup ? 0.32 : 1);
    const asp = 0.8 + Math.random() * 0.4;
    this.star.scale.set(s * asp, s / asp, 1);
    this.star.rotation.z = Math.random() * Math.PI * 2;
    const l = (0.08 + Math.random() * 0.1) * length * Math.sqrt(size);
    this.sides.scale.setScalar(l);
    this.sides.scale.x *= 0.7 + Math.random() * 0.6;
    this.sides.rotation.z = Math.random() * Math.PI;
    this.sides.visible = !sup && Math.random() < 0.8;
    this.group.visible = true;
    this.peak = 7 * size * (sup ? 0.15 : 0.8 + Math.random() * 0.4);
    this.light.intensity = this.peak;
  }

  update(dt) {
    if (this.t >= this.dur) { this.group.visible = false; this.light.intensity = 0; return; }
    this.t += dt;
    const k = Math.max(0, 1 - this.t / this.dur);
    this.starMat.opacity = this.sideMat.opacity = Math.min(1, k * 1.6);
    this.light.intensity = this.peak * k * k;
    if (this.t >= this.dur) { this.group.visible = false; this.light.intensity = 0; }
  }

  hide() { this.t = this.dur; this.group.visible = false; this.light.intensity = 0; }

  dispose() {
    this.star.geometry.dispose(); this.sides.geometry.dispose();
    parkMaterials('muzzle', this._mats);
    this.light.dispose();
  }
}

// Leichter Rauch nach Schüssen (wenige Sprites, normal geblendet)
export class SmokeWisps {
  constructor(max = 10) {
    this.group = new THREE.Group();
    this.items = [];
    for (let i = 0; i < max; i++) {
      const mat = takeMaterials('smoke', makeSmokeMaterial);
      mat.opacity = 0;
      const m = new THREE.Sprite(mat);
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, life: 0, max: 1, vel: new THREE.Vector3() });
    }
    this.i = 0;
  }
  puff(pos, dir, amount = 1) {
    const it = this.items[this.i = (this.i + 1) % this.items.length];
    it.m.position.copy(pos);
    it.vel.copy(dir).multiplyScalar(0.05 + Math.random() * 0.05).add(_p.set((Math.random() - 0.5) * 0.02, 0.05 + Math.random() * 0.03, 0));
    it.life = 0; it.max = 0.7 + Math.random() * 0.5; it.amount = amount;
    it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.life += dt;
      const k = it.life / it.max;
      if (k >= 1) { it.m.visible = false; continue; }
      it.m.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.exp(-1.5 * dt));
      const s = (0.03 + k * 0.08) * it.amount;
      it.m.scale.set(s, s, s);
      it.m.material.opacity = 0.16 * (1 - k) * Math.min(1, k * 6) * it.amount;
    }
  }
  clear() { for (const it of this.items) it.m.visible = false; }
  dispose() { for (const it of this.items) parkMaterials('smoke', it.m.material); }
}

/** Hülsen-Geometrie je Art (rifle | pistol | big | shotgun), Achse = lokales Y, Vertex-Farben (Messing/Hülle). */
export function casingGeometry(type) {
  if (type === 'shotgun') {
    const hull = new THREE.CylinderGeometry(0.0103, 0.0103, 0.05, 10, 1);
    hull.translate(0, 0.006, 0);
    const base = new THREE.CylinderGeometry(0.0108, 0.0108, 0.013, 10, 1);
    base.translate(0, -0.0245, 0);
    const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const g = mergeGeometries([col(hull, new THREE.Color(0x8f1f17)), col(base, new THREE.Color(0xc09a45))]);
    hull.dispose(); base.dispose();
    return g;
  }
  const dims = { rifle: [0.0046, 0.0057, 0.03, 0.0035], pistol: [0.0047, 0.0049, 0.019, 0.0], big: [0.006, 0.0074, 0.05, 0.0045] }[type] || [0.0046, 0.0057, 0.03, 0.0035];
  const [rNeck, rBody, len, neck] = dims;
  const pts = [[0, -len / 2], [rBody * 1.02, -len / 2], [rBody * 1.02, -len / 2 + 0.0015], [rBody * 0.9, -len / 2 + 0.002], [rBody, -len / 2 + 0.003], [rBody, len / 2 - neck - 0.003]];
  if (neck > 0) pts.push([rNeck, len / 2 - neck], [rNeck, len / 2]);
  else pts.push([rBody, len / 2]);
  pts.push([rNeck * 0.7, len / 2]);
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 8);
  const n = g.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color(0xc09a45);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Hülsen-Pool: spawn(type, position, velocity, orient?, handover?) im Elternraum; Schwerkraft über setGravity().
 *  prepare(types) legt die Pools vorab an (ViewModel.warmup → Shader beim Laden statt beim ersten Schuss);
 *  ein Pool ohne fliegende Hülse ist unsichtbar (kein Draw Call). Mit `onHandover(type, pos, vel, quat)` wird eine
 *  Hülse nach `handover` Sekunden an die Welt übergeben (Physik-lite, liegt dann auf dem Boden) und hier entfernt. */
export class ShellPool {
  constructor(perType = 14) {
    this.group = new THREE.Group();
    this.group.name = 'huelsen';
    this._mats = takeMaterials('shells', makeShellMaterials);
    this.mat = this._mats.brass;
    this.matShot = this._mats.shot;
    this.pools = {};
    this.perType = perType;
    this.limit = perType;            // aktiv genutzte Plätze (≤ perType), z. B. kleiner auf 'low'
    this.gravity = new THREE.Vector3(0, -7.5, 0);
  }

  _pool(type) {
    let p = this.pools[type];
    if (p) return p;
    const geo = casingGeometry(type);
    const mesh = new THREE.InstancedMesh(geo, type === 'shotgun' ? this.matShot : this.mat, this.perType);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = this.perType;
    mesh.visible = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.perType; i++) mesh.setMatrixAt(i, _m);
    this.group.add(mesh);
    p = this.pools[type] = { mesh, items: Array.from({ length: this.perType }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 0, handover: Infinity })), next: 0 };
    return p;
  }

  /** Pools für diese Hülsenarten anlegen (unsichtbar; renderer.compile übersetzt ihre Shader trotzdem). */
  prepare(types) {
    for (const t of types) if (t && t !== 'none') this._pool(t);
  }

  setGravity(v) { this.gravity.copy(v); }

  spawn(type, pos, vel, orient, handover = Infinity) {
    if (!type || type === 'none') return;
    const p = this._pool(type);
    const it = p.items[p.next = (p.next + 1) % Math.max(1, Math.min(this.limit, p.items.length))];
    if (it.alive && this.onHandover && Number.isFinite(it.handover)) this.onHandover(type, it.pos, it.vel, it.q);
    it.alive = true;
    it.life = 0;
    it.handover = handover;
    it.pos.copy(pos);
    it.vel.copy(vel);
    if (orient) it.q.copy(orient); else it.q.identity();
    // Hülse liegt quer zur Laufachse: lokal Y entlang Waffen-X
    it.q.multiply(_q.setFromEuler(_e.set(0, 0, Math.PI / 2)));
    it.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 12, 18 + Math.random() * 16);
    p.mesh.visible = true;
  }

  update(dt) {
    for (const type in this.pools) {
      const p = this.pools[type];
      if (!p.mesh.visible) continue;
      let dirty = false, alive = 0;
      for (let i = 0; i < p.items.length; i++) {
        const it = p.items[i];
        if (!it.alive) continue;
        dirty = true;
        it.life += dt;
        if (it.life >= it.handover && this.onHandover) {
          this.onHandover(type, it.pos, it.vel, it.q);
          it.alive = false; _m.makeScale(0, 0, 0); p.mesh.setMatrixAt(i, _m); continue;
        }
        if (it.life > 1.1) { it.alive = false; _m.makeScale(0, 0, 0); p.mesh.setMatrixAt(i, _m); continue; }
        alive++;
        it.vel.addScaledVector(this.gravity, dt);
        it.vel.multiplyScalar(Math.exp(-0.6 * dt));
        it.pos.addScaledVector(it.vel, dt);
        _e.set(it.w.x * dt, it.w.y * dt, it.w.z * dt);
        it.q.multiply(_q.setFromEuler(_e));
        _s.setScalar(1);
        _m.compose(it.pos, it.q, _s);
        p.mesh.setMatrixAt(i, _m);
      }
      if (dirty) p.mesh.instanceMatrix.needsUpdate = true;
      if (!alive) p.mesh.visible = false;
    }
  }

  clear() {
    for (const type in this.pools) {
      const p = this.pools[type];
      _m.makeScale(0, 0, 0);
      p.items.forEach((it, i) => { it.alive = false; p.mesh.setMatrixAt(i, _m); });
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.visible = false;
    }
  }

  dispose() {
    for (const type in this.pools) { this.pools[type].mesh.geometry.dispose(); this.pools[type].mesh.dispose(); }
    parkMaterials('shells', this._mats);
  }
}

/* ------------------------------------------------------------ Hitzeflimmern */

const HAZE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HAZE_FRAG = /* glsl */ `
uniform sampler2D tCopy;
uniform vec4 uRect;      // kopierter Bereich: x, y, Breite, Höhe (Pixel des Ziels)
uniform vec2 uTexSize;   // Größe der Kopie-Textur
uniform float uTime;
uniform float uStrength; // Pixel-Auslenkung
varying vec2 vUv;
void main() {
  // weiche Maske: über dem Lauf am stärksten, nach oben auslaufend
  float m = smoothstep(0.5, 0.12, abs(vUv.x - 0.5)) * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.4, vUv.y);
  float t = uTime;
  float n1 = sin(vUv.y * 26.0 - t * 9.0 + sin(vUv.x * 11.0 + t * 1.7) * 1.6);
  float n2 = sin(vUv.y * 43.0 - t * 14.0 + vUv.x * 7.0 + 1.3);
  vec2 off = vec2(n1 * 0.65 + n2 * 0.35, (n2 - n1) * 0.3) * uStrength * m;
  vec2 uv = (gl_FragCoord.xy - uRect.xy + off) / uTexSize;
  vec2 lim = uRect.zw / uTexSize;
  vec3 col = texture2D(tCopy, clamp(uv, vec2(0.5) / uTexSize, lim - vec2(0.5) / uTexSize)).rgb;
  gl_FragColor = vec4(col, m);
}`;

/**
 * Hitzeflimmern über dem heißen Lauf (nur high/ultra): Ein kleines Billboard im Viewmodel kopiert vor dem Zeichnen
 * den bereits gerenderten Bildausschnitt (copyFramebufferToTexture, gleiches Format wie das HDR-Ziel der
 * Nachbearbeitung) und zeichnet ihn wellig versetzt wieder hin – echte Brechung ohne zusätzlichen Szenenpass.
 * Nur auf nicht-multisample Render-Zielen; schlägt die erste Kopie fehl (GL-Fehler), schaltet es sich ab.
 */
export class HeatHaze {
  constructor() {
    this.enabled = true;       // Qualitätsstufe (high/ultra)
    this.failed = false;       // Kopie auf diesem Gerät nicht möglich → dauerhaft aus
    this.strength = 0;
    this._tex = new Map();     // Texturtyp → FramebufferTexture
    this._checked = false;
    this.uniforms = {
      tCopy: { value: null }, uRect: { value: new THREE.Vector4() }, uTexSize: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 }, uStrength: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'vm:haze', uniforms: this.uniforms, vertexShader: HAZE_VERT, fragmentShader: HAZE_FRAG,
      transparent: true, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'hitzeflimmern';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this._corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.mesh.onBeforeRender = (renderer, scene, camera) => this._grab(renderer, camera);
  }

  /** pos (Elternraum), Breite/Höhe (m), Stärke 0..1; Billboard zur Kamera (Elternraum = Kameraraum). */
  update(dt, pos, width, height, strength) {
    this.uniforms.uTime.value += dt;
    this.strength = strength;
    const on = this.enabled && !this.failed && strength > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    this.mesh.position.copy(pos);
    this.mesh.scale.set(width, height, 1);
    this.mesh.quaternion.identity();
  }

  _grab(renderer, camera) {
    const u = this.uniforms;
    const rt = renderer.getRenderTarget();
    // Nur in ein einfaches (nicht multisample) Ziel – direkt auf den Bildschirm geht es nicht
    if (!rt || rt.samples > 0 || !rt.texture || rt.isWebGLCubeRenderTarget) { u.uStrength.value = 0; u.tCopy.value = null; this.mesh.material.visible = false; return; }
    this.mesh.material.visible = true;
    const W = rt.width, H = rt.height;
    // Bildschirmrechteck des Billboards
    this.mesh.updateMatrixWorld();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const c = this._corners;
    c[0].set(-0.5, -0.5, 0); c[1].set(0.5, -0.5, 0); c[2].set(0.5, 0.5, 0); c[3].set(-0.5, 0.5, 0);
    for (const p of c) {
      p.applyMatrix4(this.mesh.matrixWorld).project(camera);
      const px = (p.x * 0.5 + 0.5) * W, py = (p.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const S = 256;
    if (W < S || H < S || x1 - x0 < 4 || y1 - y0 < 4) { u.uStrength.value = 0; return; }
    // Kopierfenster S × S um die Mitte des Billboards, ganz im Ziel
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = Math.max(0, Math.min(W - S, Math.round(cx - S / 2))), ry = Math.max(0, Math.min(H - S, Math.round(cy - S / 2)));
    const key = rt.texture.type + ':' + rt.texture.format;
    let tex = this._tex.get(key);
    if (!tex) {
      tex = new THREE.FramebufferTexture(S, S);
      tex.type = rt.texture.type;
      tex.format = rt.texture.format;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      this._tex.set(key, tex);
    }
    this._pos = this._pos || new THREE.Vector2();
    this._pos.set(rx, ry);
    const gl = renderer.getContext();
    if (!this._checked) gl.getError();   // alten Fehlerstand verwerfen
    // Nur den belegten Teil kopieren: Bildgröße der Kopie-Textur ist fest, copyTexSubImage2D nimmt w × h
    try { renderer.copyFramebufferToTexture(tex, this._pos); } catch { this.failed = true; }
    if (!this._checked) {
      this._checked = true;
      if (gl.getError() !== gl.NO_ERROR) this.failed = true;
    }
    if (this.failed) { this.mesh.visible = false; this.mesh.material.visible = false; u.uStrength.value = 0; return; }
    u.tCopy.value = tex;
    u.uRect.value.set(rx, ry, S, S);
    u.uTexSize.value.set(S, S);
    u.uStrength.value = this.strength * 3.2 * (H / 1080 + 0.35);
  }

  dispose() {
    for (const t of this._tex.values()) t.dispose();
    this._tex.clear();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
