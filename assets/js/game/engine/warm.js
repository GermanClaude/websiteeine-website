// NULLPUNKT — Vorarbeiten für die GPU (21.10., Leistung): Texturen eines Teilbaums vorab hochladen.
//
// three.js lädt eine Textur erst hoch, wenn ein Objekt mit ihr zum ersten Mal gezeichnet wird. Für Objekte, die im
// Vorwärm-Bild des Ladebildschirms nicht zu sehen sind (zweite Waffe, Requisiten in der Hand, Teile der Welt hinter
// der Kamera), fiel das mitten ins Match: erster Waffenwechsel = 7 Texturen ≈ 1,7 s texSubImage2D in SwiftShader,
// auf Telefonen spürbare Ruckler. uploadTextures() erledigt das während des Ladens (renderer.initTexture).

const KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap',
  'lightMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap',
  'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap', 'specularIntensityMap', 'specularColorMap', 'matcap', 'gradientMap'];

/** Bilddaten vorhanden (sonst warnt three.js beim Hochladen bzw. lädt einen Platzhalter)? */
function ready(t) {
  if (!t || !t.isTexture || t.isRenderTargetTexture || t.isVideoTexture || t.isCubeTexture || t.isData3DTexture) return false;
  if (!(t.version > 0)) return false;
  if (t.isCompressedTexture) return Array.isArray(t.mipmaps) && t.mipmaps.length > 0;
  const img = t.image;
  if (!img) return false;
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return img.complete && img.naturalWidth > 0;
  return !!(img.width || img.data || img.length);
}

/** Texturen eines Materials (Standard-Slots und Uniforms von Shader-Materialien). */
export function materialTextures(m, out = new Set()) {
  if (!m) return out;
  for (const k of KEYS) { const t = m[k]; if (t && t.isTexture) out.add(t); }
  const u = m.uniforms;
  if (u) for (const k in u) { const v = u[k] && u[k].value; if (v && v.isTexture) out.add(v); }
  return out;
}

/**
 * Noch nicht hochgeladene Texturen aller (sichtbaren und unsichtbaren) Netze unter root hochladen.
 * opts.budgetMs: höchstens so lange (Rest beim Zeichnen wie bisher). → Anzahl hochgeladener Texturen
 */
export function uploadTextures(renderer, root, { budgetMs = Infinity } = {}) {
  if (!renderer || typeof renderer.initTexture !== 'function' || !root) return 0;
  const set = new Set();
  root.traverse((o) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) for (const m of o.material) materialTextures(m, set);
    else materialTextures(o.material, set);
  });
  const t0 = performance.now();
  let n = 0;
  for (const t of set) {
    if (performance.now() - t0 > budgetMs) break;
    const p = renderer.properties.get(t);
    if (p.__webglTexture !== undefined && p.__version === t.version) continue; // schon oben
    if (!ready(t)) continue;
    try { renderer.initTexture(t); n++; } catch { /* beim Zeichnen nachholen */ }
  }
  return n;
}
