// NULLPUNKT — Soldaten-Materialien (Realismus-Plan C1/M6): Fotoscan-Stoff (CC0, assets/lib: fabric_uniform –
// Albedo-Kavität/Normalen/Rauheit) über einem prozeduralen Tarnmuster in den Farben des Teams, Schmutz und Abnutzung,
// Randlicht relativ zum Umgebungslicht. Ein MeshStandardMaterial je Soldat (Pool, gleiches Shaderprogramm für alle
// Schemata einer Qualitätsstufe; nur Uniforms und Tarnmaske unterscheiden sich).
//
// Geometrie-Attribute (soldier/builder.js): aNp = (Tarnanteil, Detail, Leuchtanteil, Glanz), aNq = (Palettenplatz,
// Materialklasse, Abnutzung, Teil-Zufall), uv in Metern, color = Farbe bzw. Helligkeitsfaktor (Palette).
// Uniforms: uPal[9] Schemafarben je Palettenplatz · uCamo[4] Tarnfarben (Grund, dunkel, hell, Fleck) · uCls[6] je
// Materialklasse (Detail-Maßstab 1/m, Normalenstärke, Kavität, Rauheit aus dem Scan) · uNpOrm (ORM des Stoffs) ·
// uNpMacro (Falten-Normalen + Rauschen, nur ab medium) · uDissolve (Auflösen der Leiche) · Randlicht/Lichtboden
// (Gegner im Schatten lesbar, F37) – beide skalieren mit dem örtlichen Umgebungslicht (Belichtungsautomatik R4 und
// Sonden-Gitter R5 lassen Gegner in dunklen Räumen sonst glühen).
// Texturen: Fotoscan-Satz (KTX2, 512 auf low, sonst 1024) wird im Hintergrund geladen (upgradeSoldierMaterials);
// bis dahin bzw. ohne Transcoder prozedurale Ersatztexturen – gleiches Programm, kein Neukompilieren beim Tausch.
import * as THREE from 'three';
import { assets, tierFor } from '../../../../lib/loader.js';

/* ------------------------------------------------------------------ Farbschemata */

// camo: [Grund, dunkel, hell, Akzentfleck]; gear/gear2: Weste/Taschen; accent: Teamfarbe (leuchtet dezent)
// hostile: aus Spielersicht Gegner (A = eigenes Team) → kräftigerer, getönter Randlicht-Saum
export const SCHEMES = {
  A: {
    id: 'A', name: 'Nordwind', camo: ['#5d6a62', '#434e48', '#77836f', '#4e5a5f'], pattern: 'multi',
    gear: '#4a5447', gear2: '#3d4439', strap: '#30362f', helmet: '#525c55', glove: '#262928', boot: '#2b2926',
    pants: '#5d6a62', accent: '#38b6ff', metal: '#3a3d40', hostile: false,
  },
  B: {
    id: 'B', name: 'Wüstenfuchs', camo: ['#a28d69', '#806a4b', '#bba882', '#8b5d43'], pattern: 'multi',
    gear: '#8c7451', gear2: '#6d5a3f', strap: '#5a4a35', helmet: '#9b8762', glove: '#4e4232', boot: '#4a3b2c',
    pants: '#9a8664', accent: '#ff3b3b', metal: '#3d3a36', hostile: true,
  },
  // Wüstenfuchs für helle Karten (Mittagssonne, heller Stein): gleiche Farbfamilie, deutlich dunkler
  Bd: {
    id: 'Bd', name: 'Wüstenfuchs', camo: ['#6f5b40', '#4d3d2a', '#86704f', '#7a3c2a'], pattern: 'multi',
    gear: '#5a4a35', gear2: '#46392a', strap: '#382d21', helmet: '#6b5a40', glove: '#2f281f', boot: '#2e251c',
    pants: '#6e5a44', accent: '#ff3b3b', metal: '#34312d', hostile: true,
  },
  urban: {
    id: 'urban', name: 'Beton', camo: ['#7a7f84', '#4a4f55', '#a3a8ad', '#2f3338'], pattern: 'digital',
    gear: '#3b3f44', gear2: '#2c2f33', strap: '#24272a', helmet: '#4c5157', glove: '#1e2022', boot: '#1f2022',
    pants: '#6b7075', accent: '#ff5b1f', metal: '#34373a', hostile: true,
  },
  wald: {
    id: 'wald', name: 'Forst', camo: ['#5b6142', '#3a3d27', '#7d7b52', '#5a4430'], pattern: 'woodland',
    gear: '#4f5236', gear2: '#3d3f2a', strap: '#33352a', helmet: '#555a3c', glove: '#2e2b22', boot: '#33291f',
    pants: '#5f6446', accent: '#ffb020', metal: '#36382f', hostile: true,
  },
  nacht: {
    id: 'nacht', name: 'Nachtschicht', camo: ['#30333a', '#1d1f24', '#454952', '#2a2f3d'], pattern: 'multi',
    gear: '#25272b', gear2: '#1b1c1f', strap: '#18191b', helmet: '#2b2d31', glove: '#141516', boot: '#161618',
    pants: '#34373e', accent: '#c46bff', metal: '#2a2c2f', hostile: true,
  },
  schnee: {
    id: 'schnee', name: 'Firn', camo: ['#c9ced2', '#9aa2a8', '#e4e7e9', '#7d878f'], pattern: 'digital',
    gear: '#8e969c', gear2: '#6f777d', strap: '#5c6368', helmet: '#b9c0c5', glove: '#3a3e41', boot: '#3f4245',
    pants: '#bcc2c6', accent: '#2ee6c4', metal: '#4a4e52', hostile: true,
  },
  sand: {
    id: 'sand', name: 'Düne', camo: ['#b59a6c', '#8d7350', '#d2bb8e', '#6d5a40'], pattern: 'woodland',
    gear: '#7a6a4c', gear2: '#5e5139', strap: '#4b412f', helmet: '#a88f63', glove: '#5b4c36', boot: '#55442f',
    pants: '#b09766', accent: '#ff7a3d', metal: '#3c3933', hostile: true,
  },
};
export const FFA_SCHEMES = ['urban', 'wald', 'nacht', 'schnee', 'sand'];
// FFA auf hellen Karten: nur Schemata, die sich von hellem Stein/Sand abheben
const FFA_SCHEMES_BRIGHT = ['urban', 'wald', 'nacht', 'Bd'];

// Hauttöne (leicht entsättigt, damit das Gesicht unter warmem Licht nicht orange wirkt)
export const SKIN_TONES = ['#bf9a80', '#a37d63', '#86614a', '#694a39', '#4d3528', '#caa58f'];

/** Palettenplätze in der Reihenfolge von builder.PALETTE (0 = keine Palette). */
const PAL_KEYS = ['', 'gear', 'gear2', 'strap', 'helmet', 'glove', 'boot', 'metal', 'accent'];

/**
 * Materialklassen (Reihenfolge wie builder.CLASSES): [Detail-Maßstab 1/m, Normalenstärke, Kavität, Rauheit aus Scan].
 * Stoff 10 cm je Kachel (fabric_uniform sizeM 0,1), Cordura gröber, Haut/Hartteile nur ein Hauch Struktur.
 */
export const CLASS_PARAMS = [
  [10, 0.95, 0.85, 0.9], // cloth (Uniform)
  [6.5, 1.1, 1.0, 0.85], // gear (Cordura: Weste, Taschen, Gurte)
  [3.5, 0.12, 0.2, 0.15], // skin
  [2.6, 0.16, 0.35, 0.2], // hard (Helm, Kunststoff, Metall)
  [4.5, 0.4, 0.55, 0.45], // leather (Stiefel, Handschuhe, Maske)
  [0, 0, 0, 0], // glass
];

/** Helle Karte? (Nebelfarbe als Maß der Umgebungshelligkeit: Mittagssonne/heller Stein) */
export function isBrightWorld(world) {
  const fog = world && world.lighting && world.lighting.fogColor;
  if (!fog) return false;
  const c = fog.isColor ? fog : new THREE.Color(fog);
  // c ist linear (three.js-Farbverwaltung) → relative Leuchtdichte
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.55;
}

/** Farbschema eines Teams auf dieser Karte ('A' | 'B' | 'Bd'); FFA → null (siehe ffaSchemes). */
export function schemeForTeam(team, world) {
  if (team === 'A') return 'A';
  if (team === 'B') return isBrightWorld(world) ? 'Bd' : 'B';
  return null;
}

/** FFA-Schemata für diese Karte. */
export function ffaSchemes(world) {
  return isBrightWorld(world) ? FFA_SCHEMES_BRIGHT : FFA_SCHEMES;
}

/* ------------------------------------------------------------------ Rauschen */

function makeNoise(period, seed) {
  // periodisches Wertrauschen (kachelbar)
  const g = new Float32Array(period * period);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
  const fn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  fn.period = period;
  return fn;
}

/** Kachelbares fBm im Bereich [0,1) × [0,1): jede Oktave wird über genau ihre Periode abgetastet. */
function fbm(noises, u, v) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < noises.length; o++) {
    const n = noises[o];
    sum += n(u * n.period, v * n.period) * amp;
    norm += amp;
    amp *= 0.55;
  }
  return sum / norm;
}

function srgbBytes(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function canvas2d(size, h = size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { const c = new OffscreenCanvas(size, h); const ctx = c.getContext('2d'); if (ctx) return { c, ctx }; } catch { /* Rückfall */ }
  }
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  return { c, ctx: c.getContext('2d') };
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ Texturen */

const texCache = new Map();

/**
 * Tarnmaske eines Musterstils (256², linear, kachelbar): R = dunkle Flecken, G = helle Flecken, B = Akzent (Zweige/
 * Pixel). Weiche Kanten (Mip-Stufen bleiben ruhig); Farben setzt der Shader aus dem Schema (uCamo). Ein Muster für
 * alle Schemata desselben Stils → wenig Speicher auch im FFA.
 */
export function camoMaskTexture(pattern = 'multi') {
  const key = 'mask:' + pattern;
  if (texCache.has(key)) return texCache.get(key);
  const N = 256;
  const { c, ctx } = canvas2d(N);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const seed = [...pattern].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const L1 = [makeNoise(4, seed + 1), makeNoise(8, seed + 2), makeNoise(16, seed + 3), makeNoise(32, seed + 4)];
  const L2 = [makeNoise(5, seed + 11), makeNoise(10, seed + 12), makeNoise(20, seed + 13), makeNoise(40, seed + 14)];
  const L3 = [makeNoise(8, seed + 21), makeNoise(16, seed + 22), makeNoise(32, seed + 23)];
  const W = [makeNoise(4, seed + 31), makeNoise(8, seed + 32)];
  const W2 = [makeNoise(4, seed + 41), makeNoise(8, seed + 42)];
  const twig = makeNoise(64, seed + 51), twig2 = makeNoise(8, seed + 52);
  const soft = pattern === 'digital' ? 0.002 : pattern === 'woodland' ? 0.012 : 0.02;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let u = x / N, v = y / N;
      if (pattern === 'digital') {
        // Pixelmuster: quantisierte Koordinaten
        const q = 1 / 48;
        u = (Math.floor(u / q) + 0.5) * q; v = (Math.floor(v / q) + 0.5) * q;
      } else {
        // organische Ränder: Domänenverzerrung
        const wu = fbm(W, u, v) - 0.5, wv = fbm(W2, u, v) - 0.5;
        const k = pattern === 'woodland' ? 0.09 : 0.06;
        u = (u + wu * k + 1) % 1; v = (v + wv * k + 1) % 1;
      }
      const a = fbm(L1, u, v);
      const b = fbm(L2, (u + 0.375) % 1, (v + 0.125) % 1);
      const e = fbm(L3, (u + 0.75) % 1, (v + 0.5) % 1);
      let r = 0, g = 0, bl = 0;
      if (pattern === 'woodland') {
        r = sstep(0.54 - soft, 0.54 + soft, a);
        g = sstep(0.6 - soft, 0.6 + soft, b);
        bl = sstep(0.64 - soft, 0.64 + soft, e);
      } else if (pattern === 'digital') {
        r = a > 0.54 ? 1 : 0;
        g = b > 0.58 ? 1 : 0;
        bl = e > 0.65 ? 1 : 0;
      } else {
        // multi: große weiche Flächen, kleinere helle Flecken, feine senkrechte „Zweige“ als Akzent
        r = sstep(0.53 - soft, 0.53 + soft, a);
        g = sstep(0.6 - soft, 0.6 + soft, b) * (1 - r * 0.6);
        const tw = twig(u * 64, v * 16) * 0.6 + twig2(u * 8, v * 8) * 0.4;
        bl = sstep(0.62, 0.66, tw) * sstep(0.45, 0.55, e);
      }
      const i = (y * N + x) * 4;
      d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = bl * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.name = 'soldat:tarnmaske:' + pattern;
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/** Tarnmuster-Textur eines Schemas (sRGB, für Vorschauen; das Spiel nutzt Maske + Uniforms). */
export function camoTexture(schemeId) {
  const key = 'camo:' + schemeId;
  if (texCache.has(key)) return texCache.get(key);
  const sc = SCHEMES[schemeId] || SCHEMES.A;
  const mask = camoMaskTexture(sc.pattern).image;
  const N = mask.width;
  const { c, ctx } = canvas2d(N);
  ctx.drawImage(mask, 0, 0);
  const img = ctx.getImageData(0, 0, N, N);
  const d = img.data;
  const cols = sc.camo.map(srgbBytes);
  for (let i = 0; i < d.length; i += 4) {
    const m = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    let col = cols[0];
    for (let k = 0; k < 3; k++) col = col.map((v, j) => v + (cols[k + 1][j] - v) * m[k]);
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/** Gewebe-Höhenfeld (Ripstop-Gitter, Köper, Knitter) 128², 0..1 – Grundlage der Ersatz-Normalen/-ORM. */
function weaveHeight() {
  const key = 'weaveH';
  if (texCache.has(key)) return texCache.get(key);
  const N = 128;
  const n1 = makeNoise(16, 91), n2 = makeNoise(64, 92);
  const h = new Float32Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const grid = (x % 16 === 0 || y % 16 === 0) ? 0.22 : 0;
    const twill = ((x + y) % 4 < 2) ? 0.18 : 0;
    const v = grid + twill + n1(x / N * 16, y / N * 16) * 0.9 + n2(x / N * 64, y / N * 64) * 0.25;
    h[y * N + x] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo || 1);
  const out = { N, h };
  texCache.set(key, out);
  return out;
}

/** Ersatz-Normalmap des Gewebes (bis der Fotoscan geladen ist bzw. ohne KTX2). */
export function weaveNormal() {
  const key = 'weave';
  if (texCache.has(key)) return texCache.get(key);
  const { N, h } = weaveHeight();
  const { c, ctx } = canvas2d(N);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = h[y * N + ((x - 1 + N) % N)], r = h[y * N + ((x + 1) % N)];
    const t = h[((y - 1 + N) % N) * N + x], b = h[((y + 1) % N) * N + x];
    let nx = (l - r) * 1.6, ny = (t - b) * 1.6, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    const i = (y * N + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.name = 'soldat:gewebe-normal';
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/** Ersatz-ORM des Gewebes: R = Kavität aus dem Höhenfeld, G = Rauheit (≈ 0,8 mit Streuung), B = 0. */
function weaveOrm() {
  const key = 'weaveOrm';
  if (texCache.has(key)) return texCache.get(key);
  const { N, h } = weaveHeight();
  const { c, ctx } = canvas2d(N);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < N * N; i++) {
    const ao = 0.62 + 0.38 * h[i];
    sum += ao;
    d[i * 4] = ao * 255; d[i * 4 + 1] = (0.74 + 0.16 * (1 - h[i])) * 255; d[i * 4 + 2] = 0; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.name = 'soldat:gewebe-orm';
  tex.userData.aoMean = sum / (N * N);
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/**
 * Faltenkarte (128², kachelbar): RG = Normalen-Neigung grober Stofffalten (überwiegend quer zum Glied, wie
 * Stauchfalten an Knie/Ellbogen/Bauch), B = weiches Rauschen für Schmutz/Abnutzung.
 */
function wrinkleTexture() {
  const key = 'wrinkle';
  if (texCache.has(key)) return texCache.get(key);
  const N = 128;
  const warp = makeNoise(4, 301), fold = makeNoise(8, 302), amp = makeNoise(4, 303);
  const dirt = [makeNoise(4, 311), makeNoise(8, 312), makeNoise(16, 313), makeNoise(32, 314)];
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    // Falten: Sinus entlang v (quer zum Glied), Phase durch Rauschen verbogen, Stärke fleckig
    const ph = v * 6 * Math.PI * 2 + warp(u * 4, v * 4) * 9 + fold(u * 8, v * 8) * 3;
    const a = Math.pow(amp(u * 4, v * 4), 1.6);
    H[y * N + x] = Math.sin(ph) * a;
  }
  const { c, ctx } = canvas2d(N);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = H[y * N + ((x - 1 + N) % N)], r = H[y * N + ((x + 1) % N)];
    const t = H[((y - 1 + N) % N) * N + x], b = H[((y + 1) % N) * N + x];
    const nx = Math.max(-1, Math.min(1, (l - r) * 2.2)), ny = Math.max(-1, Math.min(1, (t - b) * 2.2));
    const i = (y * N + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255;
    d[i + 2] = fbm(dirt, x / N, y / N) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.name = 'soldat:falten';
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/* ------------------------------------------------------------------ Detail-Satz (Fotoscan oder Ersatz) */

/** Aktueller Stoff-Detailsatz für alle Soldatenmaterialien. kind: 'prozedural' | 'fotoscan'. */
const DETAIL = { normal: null, orm: null, aoMean: 0.8, kind: 'prozedural', tier: 0, id: null };
function detail() {
  if (!DETAIL.normal) {
    DETAIL.normal = weaveNormal();
    DETAIL.orm = weaveOrm();
    DETAIL.aoMean = DETAIL.orm.userData.aoMean || 0.8;
  }
  return DETAIL;
}

/** Zustand des Stoff-Detailsatzes (Prüfseiten/Diagnose). */
export function soldierDetailInfo() {
  const D = detail();
  return { kind: D.kind, tier: D.tier, id: D.id, aoMean: +D.aoMean.toFixed(3), loading: !!upgrading && D.kind !== 'fotoscan' };
}

/* ------------------------------------------------------------------ Material */

const VERT_HEAD = /* glsl */`
attribute vec4 aNp;
attribute vec4 aNq;
attribute float aNo;
varying vec4 vNp;
flat varying vec4 vNq;
varying vec3 vNpPos;
varying vec2 vNpUv;
varying float vNpAo;
`;
const FRAG_HEAD = /* glsl */`
varying vec4 vNp;
flat varying vec4 vNq;
varying vec3 vNpPos;
varying vec2 vNpUv;
varying float vNpAo;
uniform vec3 uPal[ 9 ];
uniform vec3 uCamo[ 4 ];
uniform vec4 uCls[ 6 ];
uniform float uCamoScale;
uniform sampler2D uNpOrm;
uniform vec3 uNpDetail;
#ifndef NP_LOW
uniform sampler2D uNpMacro;
uniform float uNpMacroStr;
uniform vec3 uDust;
uniform float uDustAmt;
#endif
uniform float uDissolve;
uniform float uRim;
uniform float uRimPow;
uniform float uRimTint;
uniform vec3 uRimColor;
uniform float uLightFloor;
uniform float uAmbRef;
`;

// Albedo: Palette/Vertexfarbe × Tarnmuster × Stoff-Kavität × Teil-Streuung, dann Staub (untere Beine) + Abnutzung
const ALBEDO = /* glsl */`
	int sdPal = int( vNq.x + 0.5 );
	int sdCls = int( vNq.y + 0.5 );
	vec4 sdC = uCls[ sdCls ];
	vec2 sdUvD = vNpUv * sdC.x;
	vec3 sdAlb = vColor.rgb;
	if ( sdPal > 0 ) sdAlb = uPal[ sdPal ] * vColor.rgb * 2.0;
	if ( vNp.x > 0.004 ) {
		vec3 sdM = texture2D( map, vNpUv * uCamoScale ).rgb;
		vec3 sdCam = mix( uCamo[ 0 ], uCamo[ 1 ], sdM.r );
		sdCam = mix( sdCam, uCamo[ 2 ], sdM.g );
		sdCam = mix( sdCam, uCamo[ 3 ], sdM.b );
		sdAlb *= mix( vec3( 1.0 ), sdCam, vNp.x );
	}
	vec3 sdOrm = texture2D( uNpOrm, sdUvD ).rgb;
	float sdDet = sdC.z * vNp.y;
	sdAlb *= mix( 1.0, clamp( sdOrm.r * uNpDetail.x, 0.5, 1.3 ), sdDet );
	sdAlb *= 0.95 + vNq.w * ( 0.1 / 255.0 );
	sdAlb *= mix( 1.0, vNpAo, 0.3 ); // Kontaktschatten auch im direkten Licht (Schattenkarten lösen Falten/Taschen nicht auf)
	float sdDust = 0.0;
	#ifndef NP_LOW
		vec3 sdMac = texture2D( uNpMacro, vNpUv * vec2( 1.7, 2.3 ) ).rgb;
		float sdN = sdMac.b;
		sdDust = ( 1.0 - smoothstep( 0.03, 0.6, vNpPos.y ) ) * uDustAmt * ( 0.4 + 1.2 * sdN );
		sdDust += vNq.z * ( 1.0 / 255.0 ) * smoothstep( 0.35, 0.75, sdN ) * 0.45;
		sdDust = clamp( sdDust, 0.0, 0.65 ) * step( 0.5, sdC.y + sdC.z );
		sdAlb = mix( sdAlb, sdAlb * 0.6 + uDust * 0.4, sdDust );
	#endif
	diffuseColor.rgb *= sdAlb;
`;

const ROUGH = /* glsl */`
	float sdShine = vNp.w;
	float roughnessFactor = mix( mix( roughness, 0.32, sdShine ), sdOrm.g * uNpDetail.z, sdC.w * vNp.y );
	roughnessFactor = min( 1.0, roughnessFactor + sdDust * 0.2 );
`;

const NORMAL = /* glsl */`
#ifdef USE_NORMALMAP_TANGENTSPACE
	vec3 mapN = texture2D( normalMap, sdUvD ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale * ( sdC.y * vNp.y * uNpDetail.y );
	#ifndef NP_LOW
		// grobe Stofffalten nur auf der Uniform (Tarnanteil)
		vec2 sdW = ( sdMac.rg * 2.0 - 1.0 ) * uNpMacroStr * vNp.x * step( float( sdCls ), 0.5 );
		mapN.xy += sdW;
	#endif
	normal = normalize( tbn * mapN );
#endif
`;

// Randlicht + Lichtboden relativ zum örtlichen Umgebungslicht (Innenräume/Belichtungsautomatik)
const RIM = /* glsl */`
	float sdLum = max( dot( diffuseColor.rgb * ( 1.0 - metalnessFactor ), vec3( 0.2126, 0.7152, 0.0722 ) ), 0.02 );
	float sdAmb = clamp( dot( reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) / sdLum * uAmbRef, 0.06, 1.25 );
	float sdRim = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
	vec3 sdRimCol = mix( diffuseColor.rgb * 0.6 + vec3( 0.05, 0.055, 0.06 ), uRimColor * 0.5, uRimTint );
	outgoingLight += sdRimCol * pow( sdRim, uRimPow ) * uRim * sdAmb;
	outgoingLight = max( outgoingLight, diffuseColor.rgb * uLightFloor * min( sdAmb, 1.0 ) );
`;

/** Soldatenmaterialien je Schema × Qualität: freie Exemplare (Pool) + alle lebenden (für den Texturtausch). */
const pools = new Map();
const live = new Set();
const POOL_MAX = 48;

function linColor(hex) { return new THREE.Color(hex); } // three.Color.set(hex) wandelt sRGB → linear

function schemeUniforms(sc) {
  const pal = PAL_KEYS.map((k) => (k ? linColor(sc[k]) : new THREE.Color(1, 1, 1)));
  const camo = sc.camo.map(linColor);
  return { pal, camo };
}

function newMaterial(schemeId, low) {
  const sc = SCHEMES[schemeId] || SCHEMES.A;
  const D = detail();
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: camoMaskTexture(sc.pattern),
    normalMap: D.normal,
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.75,
  });
  m.name = 'soldier:' + schemeId;
  const { pal, camo } = schemeUniforms(sc);
  const U = (m.userData.npU = {
    uPal: { value: pal },
    uCamo: { value: camo },
    uCls: { value: CLASS_PARAMS.map((p) => new THREE.Vector4(p[0], p[1], p[2], p[3])) },
    uCamoScale: { value: 2.3 }, // Tarnmuster-Kachel ≈ 43 cm
    uNpOrm: { value: D.orm },
    uNpDetail: { value: new THREE.Vector3(1 / D.aoMean, 1, D.kind === 'fotoscan' ? 1.0 : 1.0) },
    uNpMacro: { value: wrinkleTexture() },
    uNpMacroStr: { value: 0.55 },
    uDust: { value: new THREE.Color(0.36, 0.32, 0.26) },
    uDustAmt: { value: 0.45 },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(0x0b0b0b) },
    // Randlicht: Verbündete dezent, Gegner kräftiger und zur Teamfarbe getönt (Silhouette auch im Schatten)
    uRim: { value: sc.hostile ? 0.95 : 0.45 },
    uRimPow: { value: sc.hostile ? 2.2 : 3 },
    uRimTint: { value: sc.hostile ? 0.35 : 0 },
    uRimColor: { value: linColor(sc.accent) },
    // Mindesthelligkeit (Anteil der Albedo): Gegner „versinken“ nicht im tiefen Schatten; im Licht ohne Wirkung
    uLightFloor: { value: sc.hostile ? 0.55 : 0 },
    // Bezug des Umgebungslichts: Umgebungsleuchtdichte/Albedo ≈ 1/uAmbRef gilt als „volles“ Außenlicht
    uAmbRef: { value: 2.4 },
  });
  // Rückwärtskompatibel (Prüfstand/Altcode): userData.uDissolve etc.
  m.userData.uDissolve = U.uDissolve;
  m.userData.uRim = U.uRim;
  m.userData.uLightFloor = U.uLightFloor;
  m.userData.soldier = true;
  m.userData.scheme = schemeId;
  m.userData.low = low;
  if (low) m.defines = { NP_LOW: '' };
  m.onBeforeCompile = (shader) => {
    for (const k of Object.keys(U)) shader.uniforms[k] = U[k];
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvNp = aNp;\n\tvNq = aNq;\n\tvNpPos = position;\n\tvNpUv = uv;\n\tvNpAo = aNo;');
    let fs = FRAG_HEAD + shader.fragmentShader;
    fs = fs.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	float sdDis = 0.0;
	if ( uDissolve > 0.0 ) {
		vec3 q = floor( vNpPos * 34.0 );
		sdDis = fract( sin( dot( q, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) * 0.85 + fract( vNpPos.y * 1.7 ) * 0.15;
		if ( sdDis < uDissolve ) discard;
	}`);
    fs = fs.replace('#include <map_fragment>', ALBEDO);
    fs = fs.replace('#include <color_fragment>', '');
    fs = fs.replace('#include <roughnessmap_fragment>', ROUGH);
    fs = fs.replace('#include <metalnessmap_fragment>', `
	float metalnessFactor = metalness + smoothstep( 0.72, 1.0, sdShine ) * 0.75;`);
    fs = fs.replace('#include <normal_fragment_maps>', NORMAL);
    fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	totalEmissiveRadiance += diffuseColor.rgb * vNp.z * 2.2;
	if ( uDissolve > 0.0 && sdDis < uDissolve + 0.035 ) totalEmissiveRadiance += vec3( 1.0, 0.36, 0.08 ) * 0.6;`);
    // gebackene Umgebungsverdeckung (Vertex) auf Umgebungslicht und -spiegelung
    fs = fs.replace('#include <aomap_fragment>', `#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= vNpAo;
	reflectedLight.indirectSpecular *= mix( 1.0, vNpAo, 0.75 );`);
    fs = fs.replace('#include <opaque_fragment>', `${RIM}
	#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'np-soldier-6' + (low ? 'l' : 'h');
  return m;
}

/**
 * Soldatenmaterial (eigenes Exemplar je Soldat, aus dem Pool): gleiche Shaderprogramme für alle, je Exemplar eigene
 * Uniforms (Auflösen der Leiche ohne Materialwechsel). Freigeben mit releaseSoldierMaterial().
 * opts.quality: 'low' → Telefonvariante (ohne Falten/Staub-Textur), sonst volle Variante.
 * opts.dissolve: veraltet (Auflösen läuft über material.userData.uDissolve desselben Materials).
 */
export function soldierMaterial(schemeId, { quality = 'high' } = {}) {
  const low = quality === 'low';
  const key = (SCHEMES[schemeId] ? schemeId : 'A') + ':' + (low ? 'l' : 'h');
  const pool = pools.get(key);
  let m = pool && pool.length ? pool.pop() : null;
  if (!m) { m = newMaterial(SCHEMES[schemeId] ? schemeId : 'A', low); m.userData.poolKey = key; }
  m.userData.npU.uDissolve.value = 0;
  syncDetail(m);
  live.add(m);
  return m;
}

/** Material zurück in den Pool (GPU-Programm bleibt gebunden → eine Revanche kompiliert nichts neu). */
export function releaseSoldierMaterial(m) {
  if (!m || !m.userData || !m.userData.poolKey) return;
  live.delete(m);
  m.userData.npU.uDissolve.value = 0;
  let pool = pools.get(m.userData.poolKey);
  if (!pool) { pool = []; pools.set(m.userData.poolKey, pool); }
  if (pool.length < POOL_MAX && !pool.includes(m)) pool.push(m);
  else m.dispose();
}

/** Material auf den aktuellen Detailsatz bringen (Normalmap/ORM des Stoffs). */
function syncDetail(m) {
  const D = detail();
  const U = m.userData.npU;
  if (U.uNpOrm.value !== D.orm) U.uNpOrm.value = D.orm;
  U.uNpDetail.value.x = 1 / D.aoMean;
  if (m.normalMap !== D.normal) { m.normalMap = D.normal; m.needsUpdate = true; }
}

let upgrading = null;

/**
 * Fotoscan-Aufwertung (Hintergrund; Fehler still → prozedurale Ersatztexturen bleiben): lädt `fabric_uniform`
 * (Normalen + ORM; 512 auf low, sonst 1024) aus der CC0-Bibliothek und tauscht die Texturen aller Soldatenmaterialien.
 * Kosten: low ≈ 0,09 MB Download / 0,35 MB GPU, sonst ≈ 0,33 MB / 1,4 MB. → Promise<bool>
 */
export function upgradeSoldierMaterials(renderer, quality = 'high') {
  if (upgrading) return upgrading;
  upgrading = (async () => {
    try {
      if (!assets.renderer && renderer) assets.setRenderer(renderer);
      if (!assets.renderer) return false;
      await assets.ready();
      if (!(await assets.transcoderReady())) return false;
      const tier = Math.min(1024, tierFor(quality, 'texture'));
      const set = await assets.loadTextureSet('fabric_uniform', tier);
      // eigene Klone (teilen die GPU-Daten), Wiederholung 1 – der Shader skaliert selbst je Materialklasse
      const normal = set.normalMap.clone();
      const orm = set.ormMap.clone();
      for (const t of [normal, orm]) { t.repeat.set(1, 1); t.offset.set(0, 0); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
      DETAIL.normal = normal;
      DETAIL.orm = orm;
      DETAIL.aoMean = (set.meta && set.meta.stats && set.meta.stats.avgAO) || 0.7;
      DETAIL.kind = 'fotoscan';
      DETAIL.tier = set.tier;
      DETAIL.id = 'fabric_uniform';
      for (const m of live) syncDetail(m);
      for (const pool of pools.values()) for (const m of pool) syncDetail(m);
      return true;
    } catch (err) {
      if (typeof console !== 'undefined') console.info('[bots] Fotoscan-Stoff nicht verfügbar – prozedural.', err && err.message);
      return false;
    }
  })();
  return upgrading;
}

/** Alles freigeben (Verlassen des Spiels). */
export function disposeSoldierMaterials() {
  for (const pool of pools.values()) for (const m of pool) m.dispose();
  pools.clear();
  for (const m of live) m.dispose();
  live.clear();
  for (const t of texCache.values()) if (t && t.isTexture) t.dispose();
  texCache.clear();
  DETAIL.normal = DETAIL.orm = null;
  DETAIL.kind = 'prozedural';
  upgrading = null;
}
