// NULLPUNKT — GPU-Schichten der Effekte: instanzierte Billboards (alpha/additiv, optional entlang der
// Geschwindigkeit gestreckt, Sprite-Sheet-Animation), Leuchtspur-Bänder, Einschusslöcher (instanziert,
// polygonOffset, verblassend). Simulation auf der CPU in typisierten Arrays – keine Allokationen pro Frame.
import * as THREE from 'three';
import { ATLAS_GRID, DECAL_GRID } from './fxtex.js';

/* ======================================================================= Partikel */

const P_VERT = /* glsl */ `
attribute vec4 a0; // xyz Position, w Größe
attribute vec4 a1; // rgb Farbe, a Alpha
attribute vec4 a2; // xyz Streckvektor (Welt), w Drehung
attribute float a3; // Atlas-Zelle
uniform float uCells;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvCenter = modelViewMatrix * vec4(a0.xyz, 1.0);
  vec2 c = position.xy;
  float size = a0.w;
  vec3 mv;
  vec3 sv = (modelViewMatrix * vec4(a2.xyz, 0.0)).xyz;
  float dl = length(sv.xy);
  if (dot(a2.xyz, a2.xyz) > 1e-8 && dl > 1e-6) {
    vec2 ax = sv.xy / dl;
    vec2 ay = vec2(-ax.y, ax.x);
    vec3 mid = mvCenter.xyz - sv * 0.5;
    mv = mid + vec3(ax * c.x * (dl + size) + ay * c.y * size, 0.0);
  } else {
    float s = sin(a2.w), co = cos(a2.w);
    mv = mvCenter.xyz + vec3((co * c.x - s * c.y) * size, (s * c.x + co * c.y) * size, 0.0);
  }
  float col = mod(a3, uCells);
  float row = floor(a3 / uCells);
  vUv = vec2((col + c.x + 0.5) / uCells, 1.0 - (row + 0.5 - c.y) / uCells);
  vColor = a1;
  vec4 mvPosition = vec4(mv, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const P_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uLight;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  vec4 c = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  #ifdef LIT
  c.rgb *= uLight;
  #endif
  if (c.a < 0.003) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    #ifdef ADDITIVE
      gl_FragColor.a *= 1.0 - fogFactor;
    #else
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif
  #endif
}`;

/** Nur den benutzten Teil eines Instanz-Attributs hochladen. */
function upload(attr, count) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}

// Partikel-Flags
export const PF = { BOUNCE: 1, ANIM: 2, STRETCH: 4, SPIN_SLOW: 8 };

/**
 * Eine Partikelschicht (eine Draw-Call). additive = leuchtend (Funken, Feuer), sonst Alpha (Staub, Rauch,
 * Splitter, Blut). Spawn über spawn(...) → Index, Werte direkt in die Arrays.
 */
export class ParticleLayer {
  constructor({ capacity, additive, texture, name, lit = true }) {
    this.cap = capacity;
    this.n = 0;
    this.additive = !!additive;
    this._cursor = 0;
    const N = capacity;
    // Simulation
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.life = new Float32Array(N); this.max = new Float32Array(N); this.delay = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N);
    this.r = new Float32Array(N); this.g = new Float32Array(N); this.b = new Float32Array(N); this.a = new Float32Array(N);
    this.rot = new Float32Array(N); this.rv = new Float32Array(N);
    this.drag = new Float32Array(N); this.grav = new Float32Array(N);
    this.cell = new Float32Array(N); this.frames = new Float32Array(N);
    this.stretch = new Float32Array(N); this.fadeIn = new Float32Array(N); this.fadePow = new Float32Array(N);
    this.floorY = new Float32Array(N); this.flags = new Uint8Array(N);
    // GPU
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.b0 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.b1 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.b2 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.b3 = new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('a0', this.b0);
    geo.setAttribute('a1', this.b1);
    geo.setAttribute('a2', this.b2);
    geo.setAttribute('a3', this.b3);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      name: name || (additive ? 'fx-add' : 'fx-alpha'),
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture }, uCells: { value: ATLAS_GRID }, uLight: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
      defines: additive ? { ADDITIVE: '' } : lit ? { LIT: '' } : {},
    });
    this.material.uniforms.map.value = texture;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 10;
    this.mesh.name = this.material.name;
  }

  get light() { return this.material.uniforms.uLight.value; }

  /** Neuer Partikel → Index (bei vollem Pool wird ein bestehender überschrieben). */
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, cell) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = this._cursor; this._cursor = (this._cursor + 1) % this.cap; }
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.delay[i] = 0;
    this.s0[i] = s0; this.s1[i] = s1;
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a[i] = a;
    this.rot[i] = Math.random() * 6.283; this.rv[i] = 0;
    this.drag[i] = 0; this.grav[i] = 0;
    this.cell[i] = cell; this.frames[i] = 0;
    this.stretch[i] = 0; this.fadeIn[i] = 0; this.fadePow[i] = 1;
    this.floorY[i] = -1e9; this.flags[i] = 0;
    return i;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.delay[i] = this.delay[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.r[i] = this.r[j]; this.g[i] = this.g[j]; this.b[i] = this.b[j]; this.a[i] = this.a[j];
    this.rot[i] = this.rot[j]; this.rv[i] = this.rv[j];
    this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
    this.cell[i] = this.cell[j]; this.frames[i] = this.frames[j];
    this.stretch[i] = this.stretch[j]; this.fadeIn[i] = this.fadeIn[j]; this.fadePow[i] = this.fadePow[j];
    this.floorY[i] = this.floorY[j]; this.flags[i] = this.flags[j];
  }

  clear() { this.n = 0; this._cursor = 0; this.geometry.instanceCount = 0; this.mesh.visible = false; }

  update(dt) {
    const d0 = this.b0.array, d1 = this.b1.array, d2 = this.b2.array, d3 = this.b3.array;
    let i = 0;
    let w = 0;
    while (i < this.n) {
      if (this.delay[i] > 0) { this.delay[i] -= dt; i++; continue; }
      const life = (this.life[i] -= dt);
      if (life <= 0) { this._kill(i); continue; }
      // Bewegung
      const dr = this.drag[i];
      if (dr > 0) {
        const k = Math.exp(-dr * dt);
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if ((this.flags[i] & PF.BOUNCE) && this.py[i] < this.floorY[i]) {
        this.py[i] = this.floorY[i];
        if (this.vy[i] < 0) this.vy[i] *= -0.32;
        this.vx[i] *= 0.6; this.vz[i] *= 0.6; this.rv[i] *= 0.5;
      }
      this.rot[i] += this.rv[i] * dt;
      i++;
    }
    // Schreiben (nur aktive, nicht verzögerte)
    for (let k = 0; k < this.n; k++) {
      if (this.delay[k] > 0) continue;
      const t = 1 - this.life[k] / this.max[k]; // Alter 0..1
      const grow = 1 - (1 - t) * (1 - t);
      const size = this.s0[k] + (this.s1[k] - this.s0[k]) * grow;
      let alpha = this.a[k] * Math.pow(1 - t, this.fadePow[k]);
      const fi = this.fadeIn[k];
      if (fi > 0 && t < fi) alpha *= t / fi;
      const o4 = w * 4;
      d0[o4] = this.px[k]; d0[o4 + 1] = this.py[k]; d0[o4 + 2] = this.pz[k]; d0[o4 + 3] = size;
      d1[o4] = this.r[k]; d1[o4 + 1] = this.g[k]; d1[o4 + 2] = this.b[k]; d1[o4 + 3] = alpha;
      const st = this.stretch[k];
      d2[o4] = this.vx[k] * st; d2[o4 + 1] = this.vy[k] * st; d2[o4 + 2] = this.vz[k] * st; d2[o4 + 3] = this.rot[k];
      d3[w] = (this.flags[k] & PF.ANIM) ? this.cell[k] + Math.min(this.frames[k] - 1, Math.floor(t * this.frames[k])) : this.cell[k];
      w++;
    }
    this.geometry.instanceCount = w;
    this.mesh.visible = w > 0;
    if (w > 0) {
      upload(this.b0, w * 4);
      upload(this.b1, w * 4);
      upload(this.b2, w * 4);
      upload(this.b3, w);
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ======================================================================= Leuchtspuren */

const T_VERT = /* glsl */ `
attribute vec4 tA; // Startpunkt (Schweif) xyz, Breite
attribute vec4 tB; // Endpunkt (Kopf) xyz, Intensität
uniform float uPx;
varying vec2 vUv;
varying float vI;
#include <fog_pars_vertex>
void main() {
  vec3 wp = mix(tA.xyz, tB.xyz, position.x);
  vec4 mvPosition = modelViewMatrix * vec4(wp, 1.0);
  vec3 sA = (modelViewMatrix * vec4(tA.xyz, 1.0)).xyz;
  vec3 sB = (modelViewMatrix * vec4(tB.xyz, 1.0)).xyz;
  vec3 d = sB - sA;
  vec3 side = cross(d, mvPosition.xyz);
  float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = max(tA.w, -mvPosition.z * uPx);
  mvPosition.xyz += side * position.y * w;
  vUv = position.xy;
  vI = tB.w * clamp(tA.w / w, 0.35, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const T_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vI;
#include <fog_pars_fragment>
void main() {
  float across = 1.0 - abs(vUv.y);
  float core = across * across;
  float along = smoothstep(0.0, 0.75, vUv.x);
  float a = core * along * vI;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.0 + 2.5 * pow(across, 6.0)), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor.a *= 1.0 - fogFactor;
  #endif
}`;

export class TracerLayer {
  constructor(capacity = 48) {
    this.cap = capacity;
    this.n = 0;
    const N = capacity;
    this.fx = new Float32Array(N); this.fy = new Float32Array(N); this.fz = new Float32Array(N);
    this.dx = new Float32Array(N); this.dy = new Float32Array(N); this.dz = new Float32Array(N);
    this.len = new Float32Array(N); this.t = new Float32Array(N); this.speed = new Float32Array(N);
    this.seg = new Float32Array(N); this.width = new Float32Array(N); this.inten = new Float32Array(N);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.bA = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.bB = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('tA', this.bA);
    geo.setAttribute('tB', this.bB);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      name: 'fx-tracer',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPx: { value: 0.002 }, uColor: { value: new THREE.Color(1.0, 0.62, 0.3) } }]),
      vertexShader: T_VERT,
      fragmentShader: T_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.name = 'fx-tracer';
  }

  /** Leuchtspur von (fx,fy,fz) nach (tx,ty,tz). skip = Meter, die am Anfang ausgelassen werden. */
  add(fx, fy, fz, tx, ty, tz, { speed = 420, seg = 7, width = 0.02, intensity = 1, skip = 0 } = {}) {
    let dx = tx - fx, dy = ty - fy, dz = tz - fz;
    const L = Math.hypot(dx, dy, dz);
    if (L - skip < 0.5) return;
    dx /= L; dy /= L; dz /= L;
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = (Math.random() * this.cap) | 0;
    this.fx[i] = fx + dx * skip; this.fy[i] = fy + dy * skip; this.fz[i] = fz + dz * skip;
    this.dx[i] = dx; this.dy[i] = dy; this.dz[i] = dz;
    this.len[i] = L - skip; this.t[i] = 0; this.speed[i] = speed;
    this.seg[i] = Math.min(seg, Math.max(1.5, (L - skip) * 0.6)); this.width[i] = width; this.inten[i] = intensity;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.fx[i] = this.fx[j]; this.fy[i] = this.fy[j]; this.fz[i] = this.fz[j];
    this.dx[i] = this.dx[j]; this.dy[i] = this.dy[j]; this.dz[i] = this.dz[j];
    this.len[i] = this.len[j]; this.t[i] = this.t[j]; this.speed[i] = this.speed[j];
    this.seg[i] = this.seg[j]; this.width[i] = this.width[j]; this.inten[i] = this.inten[j];
  }

  clear() { this.n = 0; this.geometry.instanceCount = 0; this.mesh.visible = false; }

  update(dt, pxScale) {
    this.material.uniforms.uPx.value = pxScale;
    const A = this.bA.array, B = this.bB.array;
    let i = 0;
    while (i < this.n) {
      this.t[i] += dt;
      const tail = this.t[i] * this.speed[i] - this.seg[i];
      if (tail >= this.len[i]) { this._kill(i); continue; }
      i++;
    }
    for (let k = 0; k < this.n; k++) {
      const head = Math.min(this.len[k], this.t[k] * this.speed[k]);
      const tail = Math.max(0, this.t[k] * this.speed[k] - this.seg[k]);
      const o = k * 4;
      A[o] = this.fx[k] + this.dx[k] * tail; A[o + 1] = this.fy[k] + this.dy[k] * tail; A[o + 2] = this.fz[k] + this.dz[k] * tail; A[o + 3] = this.width[k];
      B[o] = this.fx[k] + this.dx[k] * head; B[o + 1] = this.fy[k] + this.dy[k] * head; B[o + 2] = this.fz[k] + this.dz[k] * head; B[o + 3] = this.inten[k];
    }
    this.geometry.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n) { upload(this.bA, this.n * 4); upload(this.bB, this.n * 4); }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ======================================================================= Einschusslöcher */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class DecalLayer {
  /** opts.normalMap: Normalen-Atlas oder Funktion, die ihn erst bei Bedarf baut (Decals 2.0) – mit setDetail(true)
   *  beleuchtetes PBR-Material statt Lambert. */
  constructor(texture, capacity = 120, opts = {}) {
    this.cap = capacity;
    this.limit = capacity;
    this.cursor = 0;
    this.used = 0;
    this.born = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDecal', this.attr);
    const mat = new THREE.MeshLambertMaterial({
      map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    mat.name = 'fx-decal';
    const [GX, GY] = DECAL_GRID;
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aDecal;\nvarying float vDecalA;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * vec2(${(1 / GX).toFixed(6)}, ${(1 / GY).toFixed(6)}) + aDecal.xy;\n#endif\nvDecalA = aDecal.z;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDecalA;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vDecalA;\nif (diffuseColor.a < 0.01) discard;');
    };
    mat.customProgramCacheKey = () => 'fx-decal-v1';
    this.material = mat;
    this._lambert = mat;
    this._normalMap = opts.normalMap || null;
    this._pbr = null;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'fx-decals';
    this.geometry = geo;
    this._acc = 0;
  }

  setLimit(n) { this.limit = Math.max(8, Math.min(this.cap, n | 0)); if (this.cursor >= this.limit) this.cursor = 0; }

  /**
   * Detailstufe: true = MeshStandardMaterial mit Normalen-Atlas (Kraterränder fangen Licht, Umgebungslicht),
   * false = Lambert (low). Nur zwischen Matches umschalten (neues Shaderprogramm).
   */
  setDetail(on) {
    if (on && this._normalMap && !this._pbr) {
      const [GX, GY] = DECAL_GRID;
      const m = new THREE.MeshStandardMaterial({
        map: this._lambert.map, normalMap: typeof this._normalMap === 'function' ? this._normalMap() : this._normalMap, normalScale: new THREE.Vector2(1.15, 1.15), roughness: 0.93, metalness: 0,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      });
      m.name = 'fx-decal-pbr';
      const sx = (1 / GX).toFixed(6), sy = (1 / GY).toFixed(6);
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 aDecal;\nvarying float vDecalA;')
          .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * vec2(${sx}, ${sy}) + aDecal.xy;\n#endif\n#ifdef USE_NORMALMAP\nvNormalMapUv = vNormalMapUv * vec2(${sx}, ${sy}) + aDecal.xy;\n#endif\nvDecalA = aDecal.z;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vDecalA;')
          .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vDecalA;\nif (diffuseColor.a < 0.01) discard;');
      };
      m.customProgramCacheKey = () => 'fx-decal-pbr-v1';
      this._pbr = m;
    }
    const want = on && this._pbr ? this._pbr : this._lambert;
    if (this.mesh.material !== want) { this.mesh.material = want; this.material = want; }
  }

  /** Einschuss: Zelle (0..7), Punkt, Normale, Größe (m), Lebensdauer (s). */
  add(cell, point, normal, size, life, now, alpha = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    if (this.used < this.limit) this.used = Math.max(this.used, i + 1);
    _n.copy(normal).normalize();
    _p.copy(point).addScaledVector(_n, 0.004 + Math.random() * 0.002);
    _q.setFromUnitVectors(Z, _n);
    _q2.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
    _q.multiply(_q2);
    _s.set(size, size, size);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    const [GX, GY] = DECAL_GRID;
    const a = this.attr.array;
    a[i * 4] = (cell % GX) / GX;
    a[i * 4 + 1] = 1 - (Math.floor(cell / GX) + 1) / GY;
    a[i * 4 + 2] = alpha;
    a[i * 4 + 3] = 0;
    this.born[i] = now;
    this.life[i] = life;
    this.alpha0[i] = alpha;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }

  /** Verblassen (4×/s genügt). */
  update(dt, now) {
    this._acc += dt;
    if (this._acc < 0.25) return;
    this._acc = 0;
    const a = this.attr.array;
    let dirty = false;
    for (let i = 0; i < this.used; i++) {
      const left = this.born[i] + this.life[i] - now;
      const target = left <= 0 ? 0 : left < 4 ? this.alpha0[i] * (left / 4) : this.alpha0[i];
      if (Math.abs(a[i * 4 + 2] - target) > 0.004) { a[i * 4 + 2] = target; dirty = true; }
    }
    if (dirty) this.attr.needsUpdate = true;
  }

  clear() {
    this.attr.array.fill(0);
    this.attr.needsUpdate = true;
    this.used = 0;
    this.cursor = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.geometry.dispose();
    this._lambert.dispose();
    if (this._pbr) this._pbr.dispose();
    this.mesh.dispose();
  }
}
