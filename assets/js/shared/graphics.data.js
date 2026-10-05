// NULLPUNKT — Erweiterte Grafikoptionen als reine Daten (Realismus-Plan S9, §4.4 Nr. 8; ohne three.js).
//
// Jede Option ist eine Einstellung in shared/settings.js (Gruppe 'erweitert'); 'auto' = Wert der Qualitätsstufe.
// applyGraphics(stufe, einstellungen) mischt die Abweichungen in die Vorgabe der Stufe (engine/renderer.js
// QUALITY_PRESETS) – der Renderer nutzt das Ergebnis als `R.preset`, alle Abnehmer (Welt-Schatten, Effekte,
// Kette) folgen ihm wie bisher über onQualityChange. Die Oberfläche (ui/settings/graphics-page.js) liest hier
// Beschriftungen, Kostenmodell (GPU-Speicher je Option) und Budgets je Stufe.

/** Schlüssel der Optionen, die die Stufenvorgabe überschreiben (Renderer hört auf diese). */
export const GFX_KEYS = Object.freeze(['gfxPost', 'gfxShadows', 'gfxAA', 'gfxAO', 'gfxBloom', 'gfxEffects', 'gfxPixelRatio']);

/** Wirkung je Wert (Felder der Stufenvorgabe). */
export const GFX_APPLY = Object.freeze({
  gfxPost: {
    einfach: { post: false, grade: false },
    voll: { post: true, grade: true },
  },
  gfxShadows: {
    aus: { shadows: false, maxBotsVisibleShadows: 0 },
    niedrig: { shadows: true, shadowMapSize: 1024, shadowExtent: 24, shadowInterval: 4, maxBotsVisibleShadows: 0 },
    mittel: { shadows: true, shadowMapSize: 2048, shadowExtent: null, shadowInterval: 1, maxBotsVisibleShadows: 4 },
    hoch: { shadows: true, shadowMapSize: 2048, shadowExtent: null, shadowInterval: 1, maxBotsVisibleShadows: 8 },
    ultra: { shadows: true, shadowMapSize: 4096, shadowExtent: null, shadowInterval: 1, maxBotsVisibleShadows: 16 },
  },
  gfxAA: {
    aus: { smaa: false, fxaa: false },
    fxaa: { smaa: false, fxaa: true },
    smaa: { smaa: true, fxaa: false },
  },
  gfxAO: { aus: { ssao: false }, an: { ssao: true } },
  gfxBloom: { aus: { bloom: false }, an: { bloom: true } },
  gfxEffects: {
    niedrig: { particleScale: 0.45, decals: 40 },
    mittel: { particleScale: 0.7, decals: 80 },
    hoch: { particleScale: 1, decals: 120 },
    ultra: { particleScale: 1.25, decals: 160 },
  },
  gfxPixelRatio: {
    1: { pixelRatio: 1 }, 1.25: { pixelRatio: 1.25 }, 1.5: { pixelRatio: 1.5 }, 2: { pixelRatio: 2 }, 3: { pixelRatio: 3 },
  },
});

/** GPU-Speicherbudget je Stufe (MB, Plan §4.1 – hart). */
export const GPU_BUDGET_MB = Object.freeze({ low: 160, medium: 320, high: 600, ultra: 1000 });

/**
 * Inhalt einer Karte ohne Bildpuffer und Schatten (MB) je Stufe, Plan §4.2 (Texturen, Requisiten, Viewmodel,
 * Figuren, Geometrie, Umgebung, Sonden, Effekte) – nur als Vorhersage in der Lobby, solange nichts gemessen ist.
 */
export const CONTENT_MODEL_MB = Object.freeze({ low: 59, medium: 126, high: 248, ultra: 372 });

/** Wert einer Option lesen (Einstellungsspeicher mit get() oder einfaches Objekt). */
function reader(src) {
  if (src && typeof src.get === 'function') return (k) => src.get(k);
  return (k) => (src && typeof src === 'object' ? src[k] : undefined);
}

/**
 * Vorgabe der Stufe + Abweichungen → neue, eingefrorene Vorgabe. Zusatzfelder: `base` (Stufen-ID), `overrides`
 * (Liste der wirksamen Schlüssel). `id` bleibt die Stufe (Abnehmer wählen daran Detailstufen).
 */
export function applyGraphics(base, src) {
  const get = reader(src);
  const out = { ...base, base: base && base.id };
  const overrides = [];
  for (const key of GFX_KEYS) {
    const v = get(key);
    if (v == null || v === 'auto') continue;
    const patch = GFX_APPLY[key][v];
    if (!patch) continue;
    Object.assign(out, patch);
    overrides.push(key);
  }
  out.overrides = Object.freeze(overrides);
  return Object.freeze(out);
}

const COMPARE = ['post', 'grade', 'shadows', 'shadowMapSize', 'shadowExtent', 'shadowInterval', 'maxBotsVisibleShadows', 'smaa', 'fxaa',
  'ssao', 'bloom', 'particleScale', 'decals', 'pixelRatio', 'id'];
/** Gleiche wirksame Vorgabe? (Renderer: Neuaufbau nur bei echter Änderung) */
export function samePreset(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return COMPARE.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** Wert einer Option, den die Stufe ohne Abweichung hätte (für „Automatisch (…)“). */
export function presetValue(key, preset) {
  const p = preset || {};
  switch (key) {
    case 'gfxPost': return p.post ? 'voll' : 'einfach';
    case 'gfxShadows':
      if (!p.shadows) return 'aus';
      if ((p.shadowMapSize || 0) >= 4096) return 'ultra';
      if ((p.shadowMapSize || 0) <= 1024) return 'niedrig';
      return (p.maxBotsVisibleShadows || 0) >= 8 ? 'hoch' : 'mittel';
    case 'gfxAA': return p.smaa ? 'smaa' : p.fxaa ? 'fxaa' : 'aus';
    case 'gfxAO': return p.ssao ? 'an' : 'aus';
    case 'gfxBloom': return p.bloom ? 'an' : 'aus';
    case 'gfxEffects': {
      const s = p.particleScale ?? 1;
      return s >= 1.2 ? 'ultra' : s >= 0.95 ? 'hoch' : s >= 0.6 ? 'mittel' : 'niedrig';
    }
    case 'gfxPixelRatio': return String(p.pixelRatio ?? 1.5);
    default: return null;
  }
}

/** Anteil der internen Pixel bei Auflösungsskala s (Einstellung renderScale: 'auto' | '100' …). */
export function renderScaleValue(v) {
  if (v == null || v === 'auto') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 30 && n <= 100 ? n / 100 : 0;
}

/** Bildratenbegrenzung in FPS (0 = frei). */
export function fpsLimitValue(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 15 ? n : 0;
}

/**
 * Kostenmodell (Bytes) für die Anzeige je Option – Formeln wie engine/post/memory.js bzw. pipeline.targetInfo():
 * w/h = interne Auflösung (Gerätepixel), ow/oh = Ausgabe, hdrBpp = 4 (R11G11B10F) oder 8 (RGBA16F).
 */
export function modelCost(key, preset, { w = 1280, h = 720, ow = w, oh = h, hdrBpp = 4 } = {}) {
  const p = preset || {};
  const px = w * h;
  switch (key) {
    case 'gfxShadows': {
      if (!p.shadows) return 0;
      const s = p.shadowMapSize || 2048;
      return s * s * 8; // Tiefe + Farbe (PCF)
    }
    case 'gfxAO': return p.post && p.ssao ? px * 20 : 0;
    case 'gfxAA': return !p.post ? 0 : p.smaa ? px * 8 + px * 4 + 160 * 560 + 64 * 16 : p.fxaa ? px * 4 : 0;
    case 'gfxBloom': return p.post && p.bloom ? Math.round((px / 4) * 8 * 1.33 * 2) : 0;
    case 'gfxPost': return p.post ? px * (hdrBpp + 4) + px * 4 : px * (hdrBpp + 4);
    case 'renderScale': return px * (hdrBpp + 4) + ow * oh * 8;
    case 'gfxPixelRatio': return ow * oh * 8;
    default: return 0;
  }
}
