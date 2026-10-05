// NULLPUNKT — Farbstufe (R3): Belichtung × → Tonemapping (AgX bzw. ACES für „Klassisch“) → LUT 32³ je
// Kartenstimmung. Die LUTs entstehen beim ersten Gebrauch aus wenigen Parametern (kein Download, 128 KB je
// Stimmung im Grafikspeicher) und arbeiten im Bildraum (sRGB nach dem Tonemapping).
//
// Stimmungen (`MOODS`) bündeln je Karte: LUT-Parameter, Grenzen und Tempo der automatischen Belichtung (R4)
// und Bloom-Vorgaben. Die Welt kann eine Stimmung über `renderer.setMood(id | { mood, lut, exposure, bloom })`
// wählen bzw. überschreiben; main setzt standardmäßig die Karten-ID.

import * as THREE from 'three';
import { FULLSCREEN_VERT, GLSL_COMMON } from './common.js';

/* ------------------------------------------------------------ Stimmungen */

// lut: Bildraum-Parameter (siehe applyMood) · exposure: ref = mittlere Szenenleuchtdichte (vor Belichtung), bei
// der die Automatik nichts ändert (an typischen Außenansichten der Karte gemessen), strength = Anteil der vollen
// Anpassung (0..1), evMin/evMax = Grenzen in Blendenstufen relativ zur Kartenbelichtung, up/down = Tempo (1/s)
// heller (in dunkle Bereiche) bzw. dunkler (ins Helle: kurzes Ausbrennen wie bei Körperkameras).
// Gemessene Referenzen (Mittel aus Spawn A, Spawn B, Flaggenblick; tools/out/core-render/measure.mjs):
// Hafen 0,121 · Altstadt 0,100 · Werk 0,130 · Schießstand 0,184.
// bloom: threshold (größter Kanal nach Belichtung), strength, dirt (Linsenschmutz im Bodycam-Stil).
const BASE_EXPOSURE = Object.freeze({ ref: 0.13, strength: 0.72, dead: 0.5, evMin: -1.6, evMax: 1.8, up: 2.6, down: 1.25 });

export const MOODS = Object.freeze({
  neutral: {
    label: 'Neutral',
    lut: { contrast: 1.08, saturation: 1.0, blackLevel: 0.012 },
    exposure: { ...BASE_EXPOSURE },
    bloom: { threshold: 2.4, strength: 0.3, dirt: 0.55 },
    shafts: 0.3,
  },
  hafen: { // Goldene Stunde: warme Lichter, leicht petrolfarbene Schatten
    label: 'Hafen – Abendsonne',
    lut: { temperature: 0.12, contrast: 1.12, pivot: 0.4, saturation: 0.98, shadowSat: 0.9, highSat: 0.92,
      shadowTint: [0.965, 1.0, 1.045], highTint: [1.045, 1.0, 0.94], greenShift: 0.25, blackLevel: 0.014, whiteLevel: 0.985 },
    exposure: { ...BASE_EXPOSURE, ref: 0.12 },
    bloom: { threshold: 2.2, strength: 0.32, dirt: 0.6 },
    shafts: 0.55,
  },
  altstadt: { // Mittag in der Wüstenstadt: harter Kontrast, leicht ausgebleicht
    label: 'Altstadt – Mittag',
    lut: { temperature: 0.06, contrast: 1.17, pivot: 0.43, saturation: 0.88, shadowSat: 0.85, highSat: 0.8,
      shadowTint: [0.98, 1.0, 1.03], highTint: [1.03, 1.0, 0.96], greenShift: 0.35, blackLevel: 0.01, whiteLevel: 0.98 },
    exposure: { ...BASE_EXPOSURE, ref: 0.1 },
    bloom: { threshold: 2.6, strength: 0.28, dirt: 0.5 },
    shafts: 0.22,
  },
  werk: { // Bedeckte Dämmerung im Industriegebiet: kühl, entsättigt, Natriumlicht bleibt warm
    label: 'Werk – Dämmerung',
    lut: { temperature: -0.12, tint: -0.05, contrast: 1.1, pivot: 0.38, saturation: 0.84, shadowSat: 0.8, highSat: 0.95,
      keepWarm: 0.7, shadowTint: [0.95, 1.01, 1.04], highTint: [1.03, 1.0, 0.97], greenShift: 0.4, blackLevel: 0.018, whiteLevel: 0.985 },
    exposure: { ...BASE_EXPOSURE, ref: 0.13, evMax: 2.0 },
    bloom: { threshold: 1.9, strength: 0.36, dirt: 0.7 },
    shafts: 0.45,
  },
  range: { // Schießstand bei Tageslicht: neutral, sauber
    label: 'Schießstand – Tag',
    lut: { temperature: 0.03, contrast: 1.1, pivot: 0.42, saturation: 0.96, shadowSat: 0.92, highSat: 0.92,
      greenShift: 0.25, blackLevel: 0.012, whiteLevel: 0.985 },
    exposure: { ...BASE_EXPOSURE, ref: 0.18 },
    bloom: { threshold: 2.5, strength: 0.28, dirt: 0.5 },
    shafts: 0.3,
  },
  grenzland: { // Flusstal am späten Vormittag: leichter Dunst, Grün Richtung Oliv (wie Videokameras), weiche Wärme
    label: 'Grenzland – Vormittag',
    lut: { temperature: 0.05, contrast: 1.12, pivot: 0.42, saturation: 0.92, shadowSat: 0.88, highSat: 0.86,
      shadowTint: [0.97, 1.0, 1.035], highTint: [1.03, 1.0, 0.95], greenShift: 0.45, blackLevel: 0.012, whiteLevel: 0.985 },
    exposure: { ...BASE_EXPOSURE, ref: 0.14 },
    bloom: { threshold: 2.5, strength: 0.28, dirt: 0.5 },
    shafts: 0.35,
  },
  nacht: { // Nacht/Innenräume mit Leuchtstoffröhren: grünstichig, angehobene Videoschwärzen
    label: 'Nacht – Leuchtstoff',
    lut: { temperature: -0.08, tint: -0.14, contrast: 1.16, pivot: 0.33, saturation: 0.74, shadowSat: 0.6, highSat: 0.9,
      keepWarm: 0.5, shadowTint: [0.95, 1.02, 1.03], highTint: [1.0, 1.02, 0.97], greenShift: 0.2, blackLevel: 0.026, whiteLevel: 0.98 },
    exposure: { ...BASE_EXPOSURE, ref: 0.03, evMin: -1.2, evMax: 2.6, up: 2.2, down: 1.0 },
    bloom: { threshold: 1.5, strength: 0.42, dirt: 0.85 },
    shafts: 0,
  },
});

/** Karten-ID → Stimmung (Karten ohne eigenen Eintrag nehmen `neutral`; „nachtschicht“/„innenraum“ → `nacht`). */
export const MOOD_FOR_MAP = Object.freeze({ hafen: 'hafen', altstadt: 'altstadt', werk: 'werk', range: 'range', grenzland: 'grenzland', nachtschicht: 'nacht', innenraum: 'nacht' });

/** Stimmung auflösen: id | { mood, lut, exposure, bloom } → vollständiges Objekt (Kopie). */
export function resolveMood(spec) {
  let base = MOODS.neutral;
  let over = null;
  if (typeof spec === 'string') base = MOODS[spec] || MOODS[MOOD_FOR_MAP[spec]] || MOODS.neutral;
  else if (spec && typeof spec === 'object') {
    base = MOODS[spec.mood] || MOODS[MOOD_FOR_MAP[spec.mood]] || MOODS[MOOD_FOR_MAP[spec.id]] || MOODS.neutral;
    over = spec;
  }
  const id = typeof spec === 'string' ? (MOODS[spec] ? spec : MOOD_FOR_MAP[spec] || 'neutral') : (over && (over.mood || MOOD_FOR_MAP[over.id])) || 'neutral';
  return {
    id: over && over.lut instanceof THREE.Data3DTexture ? `${id}+lut` : id + (over && (over.lut || over.exposure || over.bloom) ? '*' : ''),
    lut: over && over.lut && !(over.lut instanceof THREE.Data3DTexture) ? { ...base.lut, ...over.lut } : { ...base.lut },
    lutTexture: over && over.lut instanceof THREE.Data3DTexture ? over.lut : null,
    exposure: { ...base.exposure, ...(over && over.exposure) },
    bloom: { ...base.bloom, ...(over && over.bloom) },
    shafts: over && Number.isFinite(over.shafts) ? over.shafts : base.shafts ?? 0,
  };
}

/* ------------------------------------------------------------ LUT */

const LUT_SIZE = 32;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const toLin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const toSrgb = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function sCurve(x, c, pv) {
  x = clamp01(x);
  if (c === 1) return x;
  return x < pv ? pv * Math.pow(x / pv, c) : 1 - (1 - pv) * Math.pow((1 - x) / (1 - pv), c);
}

/**
 * Bildraum-Farbstufe eines sRGB-Werts (0..1) → sRGB. Parameter (alle optional):
 * temperature (−1 kühl … +1 warm), tint (−1 grün … +1 magenta), contrast (S-Kurve um pivot), saturation,
 * shadowSat/highSat (Sättigung nach Helligkeit), keepWarm (Rot-/Orangetöne von der Entsättigung ausnehmen),
 * greenShift (Grün entsättigen und Richtung Oliv drehen – wie Videokameras), shadowTint/highTint (Teiltönung),
 * blackLevel/whiteLevel (Videopegel: angehobenes Schwarz, abgerundetes Weiß).
 */
export function applyMood(r, g, b, p) {
  const k = channelCurves(p);
  return applyMoodRest(k[0](r), k[1](g), k[2](b), p);
}

/** Kanalweise Schritte (Weißabgleich im linearen Licht, S-Kurve) als drei Funktionen. */
function channelCurves(p) {
  const t = p.temperature || 0, m = p.tint || 0;
  // Weißabgleich im linearen Licht, Helligkeit erhalten
  let wr = 1 + 0.1 * t + 0.03 * m, wg = 1 - 0.06 * m, wb = 1 - 0.12 * t + 0.03 * m;
  const wl = 0.2126 * wr + 0.7152 * wg + 0.0722 * wb;
  wr /= wl; wg /= wl; wb /= wl;
  // Kontrast (je Kanal: wie Film, hebt die Sättigung in den Mitten leicht)
  const c = p.contrast ?? 1, pv = p.pivot ?? 0.42;
  return [wr, wg, wb].map((w) => (x) => sCurve(toSrgb(clamp01(toLin(x) * w)), c, pv));
}

function applyMoodRest(r, g, b, p) {
  // Sättigung nach Helligkeitszone + Farbton-Ausnahmen
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let sat = (p.saturation ?? 1) * ((p.shadowSat ?? 1) + ((p.highSat ?? 1) - (p.shadowSat ?? 1)) * smooth(0.12, 0.8, l));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const chroma = mx - mn;
  if (chroma > 1e-4) {
    // warme Töne (Rot→Orange→Gelb): r höchster Kanal, b niedrigster
    const warm = r >= g && g >= b ? 1 - Math.abs(((g - b) / chroma) - 0.45) * 1.4 : 0;
    if (p.keepWarm && sat < 1) sat += (1 - sat) * p.keepWarm * clamp01(warm);
    // Grün: g höchster Kanal → entsättigen und Richtung Gelb/Oliv schieben
    const green = g >= r && g >= b ? clamp01((g - Math.max(r, b)) / chroma) : 0;
    if (p.greenShift && green > 0) {
      const k = p.greenShift * green;
      r += (g - r) * 0.25 * k;
      sat *= 1 - 0.3 * k;
    }
  }
  r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
  // Teiltönung
  if (p.shadowTint || p.highTint) {
    const st = p.shadowTint || [1, 1, 1], ht = p.highTint || [1, 1, 1];
    const k = smooth(0.05, 0.85, l);
    r *= st[0] + (ht[0] - st[0]) * k; g *= st[1] + (ht[1] - st[1]) * k; b *= st[2] + (ht[2] - st[2]) * k;
  }
  // Videopegel
  const bl = p.blackLevel || 0, wl2 = p.whiteLevel ?? 1;
  r = bl + clamp01(r) * (wl2 - bl); g = bl + clamp01(g) * (wl2 - bl); b = bl + clamp01(b) * (wl2 - bl);
  return [r, g, b];
}

const _lutCache = new Map();

/** LUT 32³ (RGBA8, trilinear) zu Bildraum-Parametern; gecacht über den Parametersatz. */
export function buildLut(params, size = LUT_SIZE) {
  const key = `${size}:${JSON.stringify(params)}`;
  const hit = _lutCache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(size * size * size * 4);
  const s = 1 / (size - 1);
  // kanalweise Schritte einmal je Gitterwert (statt je LUT-Eintrag): ≈ 10× schneller
  const fn = channelCurves(params);
  const tab = fn.map((f) => Float32Array.from({ length: size }, (_, i) => f(i * s)));
  let i = 0;
  for (let bz = 0; bz < size; bz++) {
    for (let gy = 0; gy < size; gy++) {
      for (let rx = 0; rx < size; rx++) {
        const o = applyMoodRest(tab[0][rx], tab[1][gy], tab[2][bz], params);
        data[i++] = Math.round(clamp01(o[0]) * 255);
        data[i++] = Math.round(clamp01(o[1]) * 255);
        data[i++] = Math.round(clamp01(o[2]) * 255);
        data[i++] = 255;
      }
    }
  }
  const tex = makeLutTexture(data, size);
  tex.name = `np:lut:${key.length > 40 ? key.slice(0, 40) : key}`;
  if (_lutCache.size > 8) { // alte Stimmungen freigeben
    const [k0, t0] = _lutCache.entries().next().value;
    _lutCache.delete(k0);
    t0.dispose();
  }
  _lutCache.set(key, tex);
  return tex;
}

function makeLutTexture(data, size) {
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let _identity = null;
/** 2³-Identität (trilinear exakt) – Platzhalter, solange keine Stimmung gesetzt ist bzw. für „Klassisch“. */
export function identityLut() {
  if (!_identity) {
    const d = new Uint8Array(8 * 4);
    let i = 0;
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) { d[i++] = r * 255; d[i++] = g * 255; d[i++] = b * 255; d[i++] = 255; }
    _identity = makeLutTexture(d, 2);
    _identity.name = 'np:lut:identity';
  }
  return _identity;
}

/* ------------------------------------------------------------ GLSL */

/**
 * Farbstufe als GLSL-Baustein (Grade-Pass medium+ und kombinierter low-Pass). npGrade(c) erwartet die belichtete
 * Szenenfarbe (HDR × Belichtung) und liefert sRGB-Bildwerte 0..1. CLASSIC (define) = bisheriger Look (ACES +
 * Kontrast/Sättigung/Teiltönung des alten Farblooks).
 */
export const GRADE_GLSL = /* glsl */ `
  uniform sampler2D tExposure;
  uniform float uExposure;
  uniform float uAutoExp;
  uniform highp sampler3D tLUT;
  uniform float uLutSize;
  uniform float uLutMix;
  uniform float uSat;
  uniform float uDesat;
  uniform float uContrast;
  uniform float uFlash;
  uniform vec3 uTint;
  uniform vec3 uShadowTint;
  uniform vec3 uHighTint;

  float npExposure() {
    float e = uExposure;
    if (uAutoExp > 0.5) e *= texelFetch(tExposure, ivec2(0), 0).r;
    return e;
  }

  vec3 npAces(vec3 color) {
    const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color *= 1.0 / 0.6;
    color = ACESInputMat * color;
    vec3 a = color * (color + 0.0245786) - 0.000090537;
    vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
    color = ACESOutputMat * (a / b);
    return clamp(color, 0.0, 1.0);
  }

  // AgX (Filament/Blender, wie three.js r186) mit leichtem „Punch“-Look (Steigung der Sigmoide, Sättigung)
  vec3 npAgxContrast(vec3 x) {
    vec3 x2 = x * x; vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 npAgx(vec3 color) {
    const mat3 SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    const mat3 B2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    const mat3 Inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const mat3 Outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    const float MinEv = -12.47393;
    const float MaxEv = 4.026069;
    color = Inset * (SRGB_TO_2020 * color);
    color = clamp((log2(max(color, 1e-10)) - MinEv) / (MaxEv - MinEv), 0.0, 1.0);
    color = npAgxContrast(color);
    // Look: etwas mehr Biss und Sättigung als AgX „Base“ (Körperkameras liefern harte Mitten)
    float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = l + 1.1 * (color - l);
    color = Outset * color;
    color = pow(max(vec3(0.0), color), vec3(2.2));
    color = B2020_TO_SRGB * color;
    return clamp(color, 0.0, 1.0);
  }

  vec3 npGrade(vec3 c) {
    c = clamp(c, 0.0, 64.0);
    c += uFlash * (c * 5.0 + 1.6); // Blendung (Blendgranate, nahe Explosion): Weiß ausbrennen
  #ifdef CLASSIC
    c *= uTint;
    vec3 lc = min(log2(max(c, vec3(1e-5)) / 0.18) * uContrast, vec3(9.0));
    c = exp2(lc) * 0.18;
    float l = npLuma(c);
    c = mix(vec3(l), c, uSat * (1.0 - uDesat));
    c = mix(c, vec3(l), smoothstep(1.5, 4.0, l) * 0.3);
    float t = clamp(l / (l + 0.35), 0.0, 1.0);
    c *= mix(uShadowTint, uHighTint, t);
    return npSrgb(npAces(min(c, vec3(256.0))));
  #else
    vec3 lc = log2(max(c, vec3(1e-6)) / 0.18) * uContrast;
    c = exp2(min(lc, vec3(9.0))) * 0.18;
    float l = npLuma(c);
    c = max(mix(vec3(l), c, uSat * (1.0 - uDesat)), 0.0);
    c = npSrgb(npAgx(c));
    vec3 uvw = c * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    return mix(c, texture(tLUT, uvw).rgb, uLutMix);
  #endif
  }
`;

/** Uniform-Satz zu GRADE_GLSL (Werte setzt `setGradeUniforms`). */
export function gradeUniforms() {
  return {
    tExposure: { value: null },
    uExposure: { value: 1 },
    uAutoExp: { value: 0 },
    tLUT: { value: identityLut() },
    uLutSize: { value: 2 },
    uLutMix: { value: 0 },
    uSat: { value: 1 },
    uDesat: { value: 0 },
    uContrast: { value: 1 },
    uFlash: { value: 0 },
    uTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) },
    uShadowTint: { value: new THREE.Vector3(0.93, 0.99, 1.07) },
    uHighTint: { value: new THREE.Vector3(1.05, 1.0, 0.93) },
  };
}

/**
 * Gemeinsame Werte schreiben. g = { exposure, auto (bool), exposureTex, lut (Data3DTexture|null), lutMix,
 * saturation, desaturate, contrast, flash, classic }.
 */
export function setGradeUniforms(u, g) {
  u.uExposure.value = g.exposure;
  u.uAutoExp.value = g.auto && g.exposureTex ? 1 : 0;
  u.tExposure.value = g.exposureTex || null;
  const lut = g.lut || identityLut();
  u.tLUT.value = lut;
  u.uLutSize.value = lut.image.width;
  u.uLutMix.value = g.lut ? g.lutMix : 0;
  u.uSat.value = g.saturation;
  u.uDesat.value = g.desaturate;
  u.uContrast.value = g.contrast;
  u.uFlash.value = g.flash;
}

/* ------------------------------------------------------------ Grade-Pass (medium+) */

/** HDR-Szene (+ Bloom, Linsenschmutz) → belichtet, getont, LUT → 8-Bit-Bildwerte. */
export class GradePass {
  constructor() {
    this.materials = new Map();
  }

  material(classic) {
    const key = classic ? 'classic' : 'agx';
    let m = this.materials.get(key);
    if (m) return m;
    m = new THREE.ShaderMaterial({
      name: `NullpunktGrade_${key}`,
      defines: classic ? { CLASSIC: 1 } : {},
      uniforms: {
        ...gradeUniforms(),
        tScene: { value: null },
        tBloom: { value: null },
        tDirt: { value: null },
        tShafts: { value: null },
        tDepth: { value: null },
        uBloom: { value: 0 },
        uDirt: { value: 0 },
        uShafts: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        ${GRADE_GLSL}
        uniform sampler2D tScene;
        uniform sampler2D tBloom;
        uniform sampler2D tDirt;
        uniform sampler2D tShafts;
        uniform sampler2D tDepth;
        uniform float uBloom;
        uniform float uDirt;
        uniform float uShafts;
        varying vec2 vUv;
        void main() {
          float E = npExposure();
          vec3 c = texture2D(tScene, vUv).rgb * E;
          if (uBloom > 0.0) {
            vec3 bl = texture2D(tBloom, vUv).rgb;
            c += bl * uBloom;
            if (uDirt > 0.0) c += bl * texture2D(tDirt, vUv).rgb * uDirt;
          }
          // Strahlen nicht über dem Viewmodel (nach dessen Pass steht dort Tiefe < 1, sonst gelöscht = 1)
          if (uShafts > 0.0) c += texture2D(tShafts, vUv).rgb * uShafts * step(0.99995, texture2D(tDepth, vUv).r);
          gl_FragColor = vec4(npGrade(c), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.set(key, m);
    return m;
  }

  dispose() {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
