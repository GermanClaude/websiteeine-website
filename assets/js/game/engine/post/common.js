// NULLPUNKT — Gemeinsame Bausteine der Nachbearbeitung (engine/post/*): Vollbild-Dreieck, Ziel-Formate,
// GLSL-Hilfen. Nur von engine/post/* und engine/renderer.js benutzt.

import * as THREE from 'three';

/* ------------------------------------------------------------ Vollbild-Dreieck */

const _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let _geometry = null;
function triangle() {
  if (!_geometry) {
    _geometry = new THREE.BufferGeometry();
    _geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    _geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  }
  return _geometry;
}

/** Ein Vollbild-Dreieck je Pass (eigene Geometrie – FullScreenQuad.dispose() der Addons gibt die geteilte frei). */
export class Fullscreen {
  constructor(material = null) {
    this.mesh = new THREE.Mesh(triangle(), material);
    this.mesh.frustumCulled = false;
  }
  get material() { return this.mesh.material; }
  set material(m) { this.mesh.material = m; }
  /** Zeichnet in `target` (null = Bildschirm). Löscht nicht. */
  draw(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, _camera);
  }
  /** Material vorab kompilieren (kein Linken im ersten Bild, in dem der Pass läuft). */
  compile(renderer, material) {
    this.mesh.material = material;
    try { renderer.compile(this.mesh, _camera); } catch { /* beim Zeichnen nachholen */ }
  }
}

export const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/* ------------------------------------------------------------ Formate */

const _hdrCache = new WeakMap();

/**
 * Bestes HDR-Zielformat des Kontexts: R11G11B10F (4 B/px, braucht EXT_color_buffer_float), sonst RGBA16F
 * (8 B/px, EXT_color_buffer_half_float oder _float), sonst null (kein HDR-Ziel möglich).
 * Ob R11G11B10F tatsächlich als Ziel taugt, prüft ein kleiner Framebuffer-Test (einmal je Kontext).
 */
export function hdrFormat(renderer) {
  const cached = _hdrCache.get(renderer);
  if (cached !== undefined) return cached;
  const ext = renderer.extensions;
  const cbf = ext.has('EXT_color_buffer_float');
  const cbhf = ext.has('EXT_color_buffer_half_float');
  let out = null;
  if (cbf && probeTarget(renderer, THREE.RGBFormat, THREE.UnsignedInt101111Type)) {
    out = { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type, bpp: 4, name: 'R11G11B10F' };
  } else if ((cbf || cbhf) && probeTarget(renderer, THREE.RGBAFormat, THREE.HalfFloatType)) {
    out = { format: THREE.RGBAFormat, type: THREE.HalfFloatType, bpp: 8, name: 'RGBA16F' };
  }
  _hdrCache.set(renderer, out);
  return out;
}

/** Formatwahl nach Kontextverlust neu prüfen. */
export function resetFormatCache(renderer) { _hdrCache.delete(renderer); }

function probeTarget(renderer, format, type) {
  const gl = renderer.getContext();
  const rt = new THREE.WebGLRenderTarget(4, 4, { format, type, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  const prev = renderer.getRenderTarget();
  let ok = false;
  try {
    renderer.setRenderTarget(rt);
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (ok) {
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, false, false);
      ok = gl.getError() === gl.NO_ERROR;
    }
  } catch { ok = false; }
  renderer.setRenderTarget(prev);
  rt.dispose();
  return ok;
}

/** Ziel im HDR-Format (bilinear, ohne Mipmaps). */
export function hdrTarget(renderer, w, h, { depth = false, fmt = null } = {}) {
  const f = fmt || hdrFormat(renderer);
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    format: f.format, type: f.type, depthBuffer: depth, stencilBuffer: false,
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  rt.texture.name = 'np:hdr';
  rt.userData.bpp = f.bpp + (depth ? 4 : 0);
  return rt;
}

/** 8-Bit-Ziel für Bildwerte nach dem Tonemapping (sRGB-codiert gespeichert, linear gelesen). */
export function ldrTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  rt.texture.name = 'np:ldr';
  rt.userData.bpp = 4;
  return rt;
}

/** Kleines Float-Ziel (Belichtungsmessung): RGBA16F, nächster Nachbar. */
export function smallFloatTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false,
  });
  rt.texture.name = 'np:lum';
  rt.userData.bpp = 8;
  return rt;
}

/* ------------------------------------------------------------ GLSL */

export const GLSL_COMMON = /* glsl */ `
  const vec3 NP_LUMA = vec3(0.2126, 0.7152, 0.0722);
  float npLuma(vec3 c) { return dot(c, NP_LUMA); }
  float npMax3(vec3 c) { return max(c.r, max(c.g, c.b)); }
  vec3 npSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
  }
  // Ganzzahl-Hash (gleichmäßig, ohne sin) → [0,1); p ≥ 0 (Pixelkoordinaten + Startwert)
  float npHash(vec2 p) {
    uvec2 q = uvec2(p);
    uint h = (q.x * 73856093u) ^ (q.y * 19349663u);
    h = (h ^ (h >> 16u)) * 0x45d9f3bu;
    h = (h ^ (h >> 16u)) * 0x45d9f3bu;
    h ^= h >> 16u;
    return float(h) * (1.0 / 4294967296.0);
  }
`;
