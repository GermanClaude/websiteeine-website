// NULLPUNKT — Schätzung des Grafikspeichers (§4.4 Nr. 8): Texturen, Geometrien, Render-Ziele, Schattenkarten,
// Bildpuffer. Läuft nur auf Abruf (z. B. Erweitert-Grafikseite, tools/budget.mjs), nie je Bild.
// Werte sind Schätzungen ohne Treiber-Overhead: Mipmaps +⅓, komprimierte Formate nach Blockgröße.

import * as THREE from 'three';

// Bytes je Pixel komprimierter Formate (Blockformate auf 1 Pixel umgerechnet)
const COMPRESSED_BPP = new Map([
  [THREE.RGB_S3TC_DXT1_Format, 0.5], [THREE.RGBA_S3TC_DXT1_Format, 0.5],
  [THREE.RGBA_S3TC_DXT3_Format, 1], [THREE.RGBA_S3TC_DXT5_Format, 1],
  [THREE.RGB_ETC1_Format, 0.5], [THREE.RGB_ETC2_Format, 0.5], [THREE.RGBA_ETC2_EAC_Format, 1],
  [THREE.RGB_PVRTC_4BPPV1_Format, 0.5], [THREE.RGBA_PVRTC_4BPPV1_Format, 0.5],
  [THREE.RGB_PVRTC_2BPPV1_Format, 0.25], [THREE.RGBA_PVRTC_2BPPV1_Format, 0.25],
  [THREE.RGBA_ASTC_4x4_Format, 1], [THREE.RGBA_ASTC_6x6_Format, 0.45], [THREE.RGBA_ASTC_8x8_Format, 0.25],
  [THREE.RGBA_BPTC_Format, 1], [THREE.RGB_BPTC_SIGNED_Format, 1], [THREE.RGB_BPTC_UNSIGNED_Format, 1],
  [THREE.RED_RGTC1_Format, 0.5], [THREE.SIGNED_RED_RGTC1_Format, 0.5], [THREE.RED_GREEN_RGTC2_Format, 1], [THREE.SIGNED_RED_GREEN_RGTC2_Format, 1],
].filter(([k]) => k !== undefined));

function channels(format) {
  switch (format) {
    case THREE.AlphaFormat: case THREE.RedFormat: case THREE.RedIntegerFormat: case THREE.DepthFormat: return 1;
    case THREE.RGFormat: case THREE.RGIntegerFormat: case THREE.DepthStencilFormat: return 2;
    case THREE.RGBFormat: return 3;
    default: return 4;
  }
}

function bytesPerPixel(format, type) {
  if (COMPRESSED_BPP.has(format)) return COMPRESSED_BPP.get(format);
  if (type === THREE.UnsignedInt101111Type || type === THREE.UnsignedInt5999Type) return 4;
  if (type === THREE.UnsignedInt248Type) return 4;
  if (type === THREE.UnsignedShort4444Type || type === THREE.UnsignedShort5551Type) return 2;
  const ch = channels(format);
  const per = type === THREE.FloatType || type === THREE.IntType || type === THREE.UnsignedIntType ? 4
    : type === THREE.HalfFloatType || type === THREE.ShortType || type === THREE.UnsignedShortType ? 2 : 1;
  // RGB8 wird in der Regel als RGBA gespeichert
  return (ch === 3 && per === 1 ? 4 : ch) * per;
}

function imageSize(img) {
  if (!img) return [0, 0, 1];
  const w = img.width || img.videoWidth || img.naturalWidth || 0;
  const h = img.height || img.videoHeight || img.naturalHeight || 0;
  return [w, h, img.depth || 1];
}

/** Bytes einer Textur auf der GPU (Schätzung). */
export function textureBytes(tex) {
  if (!tex || tex.isRenderTargetTexture) return 0;
  const bpp = bytesPerPixel(tex.format, tex.type);
  const faces = tex.isCubeTexture ? 6 : 1;
  // Komprimiert mit vorhandenen Mip-Daten: exakte Summe
  if (tex.isCompressedTexture && Array.isArray(tex.mipmaps) && tex.mipmaps.length && tex.mipmaps[0] && tex.mipmaps[0].data && tex.mipmaps[0].data.byteLength) {
    let b = 0;
    for (const m of tex.mipmaps) b += m && m.data ? m.data.byteLength : 0;
    return b * faces;
  }
  let w, h, d;
  if (tex.isCubeTexture && Array.isArray(tex.image)) [w, h, d] = imageSize(tex.image[0]);
  else if (tex.isCompressedTexture && Array.isArray(tex.mipmaps) && tex.mipmaps[0]) [w, h, d] = [tex.mipmaps[0].width || 0, tex.mipmaps[0].height || 0, 1];
  else [w, h, d] = imageSize(tex.image);
  if (!w && tex.source && tex.source.getSize) { // AtlasSource o. ä.
    try { const s = tex.source.getSize(new THREE.Vector3()); w = s.x; h = s.y; } catch { /* ignorieren */ }
  }
  const mips = tex.generateMipmaps !== false && tex.minFilter !== THREE.LinearFilter && tex.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
  return w * h * d * bpp * mips * faces;
}

/** Bytes eines Render-Ziels (Farbe + Tiefe, MSAA-Puffer). */
export function targetBytes(rt) {
  if (!rt) return 0;
  const w = rt.width || 0, h = rt.height || 0, d = rt.depth || 1;
  const textures = rt.textures || [rt.texture];
  let b = 0;
  for (const t of textures) {
    const bpp = bytesPerPixel(t.format, t.type);
    const mips = t.generateMipmaps ? 4 / 3 : 1;
    b += w * h * d * bpp * mips;
  }
  if (rt.isWebGLCubeRenderTarget) b *= 6;
  if (rt.depthBuffer) b += w * h * 4 * (rt.isWebGLCubeRenderTarget ? 6 : 1);
  const samples = rt.samples || 0;
  if (samples > 0) b += w * h * samples * (bytesPerPixel(rt.texture.format, rt.texture.type) + (rt.depthBuffer ? 4 : 0));
  return b;
}

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'lightMap',
  'bumpMap', 'displacementMap', 'specularMap', 'envMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap', 'gradientMap',
  'matcap', 'specularIntensityMap', 'specularColorMap'];

function geometryBytes(geo) {
  let b = 0;
  const seen = new Set();
  const add = (attr) => {
    if (!attr) return;
    const arr = attr.isInterleavedBufferAttribute ? attr.data.array : attr.array;
    if (!arr || seen.has(arr)) return;
    seen.add(arr);
    b += arr.byteLength;
  };
  for (const k of Object.keys(geo.attributes)) add(geo.attributes[k]);
  for (const k of Object.keys(geo.morphAttributes || {})) for (const a of geo.morphAttributes[k]) add(a);
  add(geo.index);
  return b;
}

/**
 * Schätzung über Szenen + Zusatzposten.
 * opts = { scenes: [Scene…], targets: [{ name, bytes }], backbuffer: bytes, renderer }
 * → { total, textures, geometry, targets, shadows, environment, backbuffer, counts, mb, top: [{name, bytes}] }
 */
export function estimateMemory({ scenes = [], targets = [], backbuffer = 0 } = {}) {
  const texSeen = new Set();
  const geoSeen = new Set();
  const rtSeen = new Set();
  let textures = 0, geometry = 0, shadows = 0, environment = 0, instanced = 0;
  const top = [];
  const addTex = (t, owner) => {
    if (!t || texSeen.has(t)) return;
    texSeen.add(t);
    if (t.isRenderTargetTexture) return; // über ihr Ziel gezählt
    const b = textureBytes(t);
    textures += b;
    if (b > 2 * 1024 * 1024) top.push({ name: t.name || owner || 'Textur', bytes: b });
  };
  const addMaterial = (m) => {
    if (!m) return;
    for (const k of TEX_KEYS) if (m[k] && m[k].isTexture) addTex(m[k], m.name);
    if (m.uniforms) for (const u of Object.values(m.uniforms)) {
      const v = u && u.value;
      if (v && v.isTexture) addTex(v, m.name);
      else if (Array.isArray(v)) for (const x of v) if (x && x.isTexture) addTex(x, m.name);
    }
  };
  for (const scene of scenes) {
    if (!scene) continue;
    if (scene.environment && scene.environment.isTexture) {
      const env = scene.environment;
      if (!texSeen.has(env)) {
        texSeen.add(env);
        // PMREM: CubeUV-Render-Ziel (Halbfloat, ≈ 3·Größe × 4·Größe)
        const img = env.image || {};
        environment += (img.width || 0) * (img.height || 0) * bytesPerPixel(env.format, env.type) || textureBytes(env);
      }
    }
    if (scene.background && scene.background.isTexture) addTex(scene.background, 'Hintergrund');
    scene.traverse((o) => {
      if (o.geometry && !geoSeen.has(o.geometry)) {
        geoSeen.add(o.geometry);
        geometry += geometryBytes(o.geometry);
      }
      if (o.isInstancedMesh) {
        instanced += o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0);
      }
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture) addTex(o.skeleton.boneTexture, 'Skelett');
      if (o.material) {
        if (Array.isArray(o.material)) for (const m of o.material) addMaterial(m);
        else addMaterial(o.material);
      }
      if (o.isLight && o.shadow && o.shadow.map && !rtSeen.has(o.shadow.map)) {
        rtSeen.add(o.shadow.map);
        shadows += targetBytes(o.shadow.map);
      }
    });
  }
  let targetSum = 0;
  for (const t of targets) targetSum += t.bytes || 0;
  const total = textures + geometry + instanced + shadows + environment + targetSum + backbuffer;
  top.sort((a, b) => b.bytes - a.bytes);
  const mb = (b) => Math.round((b / (1024 * 1024)) * 10) / 10;
  return {
    total, textures, geometry: geometry + instanced, targets: targetSum, shadows, environment, backbuffer,
    counts: { textures: texSeen.size, geometries: geoSeen.size },
    mb: {
      total: mb(total), textures: mb(textures), geometry: mb(geometry + instanced), targets: mb(targetSum),
      shadows: mb(shadows), environment: mb(environment), backbuffer: mb(backbuffer),
    },
    breakdown: targets.map((t) => ({ name: t.name, mb: mb(t.bytes || 0) })),
    top: top.slice(0, 12).map((t) => ({ name: t.name, mb: mb(t.bytes) })),
  };
}
