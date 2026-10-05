// NULLPUNKT — Soldaten-Materialien: prozedurale Tarnmuster (kachelbar, je Farbschema), gemeinsame
// Gewebe-Normalmap und ein MeshStandardMaterial mit kleinem Shader-Zusatz:
//   Attribut aNp = (Tarnmuster-Anteil, Gewebe-Detail, Leuchtanteil, Glanz/Metall 0..1)
//   uDissolve   = Auflösen der Leiche (Rasterrauschen, ohne Transparenz-Sortierung)
//   uRim/uRimPow/uRimColor/uRimTint = Randlicht-Saum (Gegner kräftiger, breiter, zur Teamfarbe getönt)
//   uLightFloor = Mindesthelligkeit als Anteil der Albedo (Gegner im tiefen Schatten noch erkennbar)
// Alle Schemata teilen ein Shaderprogramm; nur Tarntextur und Uniform-Werte unterscheiden sich.
// Gegnerschemata werden je Karte nach Helligkeit gewählt (schemeForTeam/ffaSchemes), damit sich
// Gegner von Wänden und Boden abheben (Ziel: Leuchtdichte-Kontrast ≥ 1,8 : 1).
import * as THREE from 'three';

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

function canvas2d(size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { const c = new OffscreenCanvas(size, size); const ctx = c.getContext('2d'); if (ctx) return { c, ctx }; } catch { /* Rückfall */ }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}

/* ------------------------------------------------------------------ Texturen */

const texCache = new Map();

/** Tarnmuster-Textur eines Schemas (256², sRGB, kachelbar, mit Gewebestruktur). */
export function camoTexture(schemeId) {
  const key = 'camo:' + schemeId;
  if (texCache.has(key)) return texCache.get(key);
  const sc = SCHEMES[schemeId] || SCHEMES.A;
  const N = 256;
  const { c, ctx } = canvas2d(N);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const seed = [...schemeId].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
  const L1 = [makeNoise(5, seed + 1), makeNoise(10, seed + 2), makeNoise(20, seed + 3), makeNoise(40, seed + 4)];
  const L2 = [makeNoise(6, seed + 11), makeNoise(12, seed + 12), makeNoise(24, seed + 13), makeNoise(48, seed + 14)];
  const L3 = [makeNoise(7, seed + 21), makeNoise(14, seed + 22), makeNoise(28, seed + 23), makeNoise(56, seed + 24)];
  const grain = makeNoise(128, seed + 31);
  const cols = sc.camo.map(srgbBytes);
  const pattern = sc.pattern;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let u = x / N, v = y / N;
      let k = 0;
      if (pattern === 'digital') {
        // Pixelmuster: quantisierte Koordinaten
        const q = 1 / 48;
        u = Math.floor(u / q) * q; v = Math.floor(v / q) * q;
      }
      const a = fbm(L1, u, v);
      const b = fbm(L2, u + 0.375, v + 0.125);
      const e = fbm(L3, u + 0.75, v + 0.5);
      if (pattern === 'woodland') {
        if (a > 0.56) k = 1;
        if (b > 0.6) k = 2;
        if (e > 0.64) k = 3;
      } else if (pattern === 'digital') {
        if (a > 0.54) k = 1;
        if (b > 0.58) k = 2;
        if (e > 0.66) k = 3;
      } else {
        // multi: weiche Übergänge, kleine Flecken
        if (a > 0.55) k = 1;
        if (b > 0.62) k = 2;
        if (e > 0.6 && a < 0.5) k = 3;
      }
      const col = cols[k];
      // Gewebe: feines Köpergrat-Muster + Körnung
      const weave = ((x + y) & 3) < 2 ? 1.035 : 0.965;
      const gr = 0.92 + grain(x * 0.5, y * 0.5) * 0.16;
      const f = weave * gr;
      const i = (y * N + x) * 4;
      d[i] = Math.min(255, col[0] * f);
      d[i + 1] = Math.min(255, col[1] * f);
      d[i + 2] = Math.min(255, col[2] * f);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/** Gewebe-Normalmap (Cordura/Ripstop) – gemeinsam für alle Schemata. */
export function weaveNormal() {
  const key = 'weave';
  if (texCache.has(key)) return texCache.get(key);
  const N = 128;
  const { c, ctx } = canvas2d(N);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const n1 = makeNoise(16, 91), n2 = makeNoise(64, 92);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Ripstop-Gitter + Köper + Knitter
    const grid = (x % 16 === 0 || y % 16 === 0) ? 0.22 : 0;
    const twill = ((x + y) % 4 < 2) ? 0.18 : 0;
    h[y * N + x] = grid + twill + n1(x / N * 16, y / N * 16) * 0.9 + n2(x / N * 64, y / N * 64) * 0.25;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = h[y * N + ((x - 1 + N) % N)], r = h[y * N + ((x + 1) % N)];
    const t = h[((y - 1 + N) % N) * N + x], b = h[((y + 1) % N) * N + x];
    let nx = (l - r) * 1.2, ny = (t - b) * 1.2, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    const i = (y * N + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255;
    d[i + 1] = (ny * 0.5 + 0.5) * 255;
    d[i + 2] = (nz * 0.5 + 0.5) * 255;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/* ------------------------------------------------------------------ Material */

const VERT_HEAD = /* glsl */`
attribute vec4 aNp;
varying vec4 vNp;
varying vec3 vNpPos;
`;
const FRAG_HEAD = /* glsl */`
varying vec4 vNp;
varying vec3 vNpPos;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uRim;
uniform float uRimPow;
uniform float uRimTint;
uniform vec3 uRimColor;
uniform float uLightFloor;
`;

const materialCache = new Map();

/**
 * Gemeinsames Soldatenmaterial eines Schemas.
 * opts.dissolve: eigenes Material (für eine sich auflösende Leiche), sonst gecacht.
 */
export function soldierMaterial(schemeId, { dissolve = false, quality = 'high' } = {}) {
  const key = schemeId + ':' + (quality === 'low' ? 'lo' : 'hi');
  if (!dissolve && materialCache.has(key)) return materialCache.get(key);
  const low = quality === 'low';
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: camoTexture(schemeId),
    normalMap: low ? null : weaveNormal(),
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.75,
  });
  m.name = 'soldier:' + schemeId + (dissolve ? ':dissolve' : '');
  const sc = SCHEMES[schemeId] || SCHEMES.A;
  m.userData.uDissolve = { value: 0 };
  m.userData.uDissolveColor = { value: new THREE.Color(0x0b0b0b) };
  // Randlicht: Verbündete dezent, Gegner kräftiger und zur Teamfarbe getönt (Silhouette auch im Schatten)
  m.userData.uRim = { value: sc.hostile ? 0.95 : 0.45 };
  m.userData.uRimPow = { value: sc.hostile ? 2.2 : 3 }; // breiterer Saum bei Gegnern (Umriss auch im Schatten)
  m.userData.uRimTint = { value: sc.hostile ? 0.35 : 0 };
  // Mindesthelligkeit (Anteil der Albedo): Gegner „versinken“ nicht im tiefen Schatten; im Licht ohne Wirkung
  m.userData.uLightFloor = { value: sc.hostile ? 0.55 : 0 };
  m.userData.uRimColor = { value: new THREE.Color(sc.accent) };
  m.userData.soldier = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = m.userData.uDissolve;
    shader.uniforms.uDissolveColor = m.userData.uDissolveColor;
    shader.uniforms.uRim = m.userData.uRim;
    shader.uniforms.uRimPow = m.userData.uRimPow;
    shader.uniforms.uRimTint = m.userData.uRimTint;
    shader.uniforms.uRimColor = m.userData.uRimColor;
    shader.uniforms.uLightFloor = m.userData.uLightFloor;
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvNp = aNp;\n\tvNpPos = position;');
    let fs = FRAG_HEAD + shader.fragmentShader;
    fs = fs.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
	float npDis = 0.0;
	if (uDissolve > 0.0) {
		vec3 q = floor(vNpPos * 34.0);
		npDis = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 0.85 + fract(vNpPos.y * 1.7) * 0.15;
		if (npDis < uDissolve) discard;
	}`);
    fs = fs.replace('#include <map_fragment>', `
	#ifdef USE_MAP
		vec3 npCamo = texture2D( map, vMapUv ).rgb;
		diffuseColor.rgb *= mix( vec3( 1.0 ), npCamo, vNp.x );
	#endif`);
    fs = fs.replace('#include <roughnessmap_fragment>', `
	float npShine = vNp.w;
	float roughnessFactor = mix( roughness, 0.32, npShine );`);
    fs = fs.replace('#include <metalnessmap_fragment>', `
	float metalnessFactor = metalness + smoothstep( 0.72, 1.0, npShine ) * 0.75;`);
    fs = fs.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vNp.y;');
    fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	totalEmissiveRadiance += diffuseColor.rgb * vNp.z * 2.2;
	// Randlicht-Saum (Silhouette lesbar vor dunklem/unruhigem Hintergrund; Gegner zur Teamfarbe getönt)
	float npRim = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
	vec3 npRimCol = mix( diffuseColor.rgb * 0.6 + vec3( 0.05, 0.055, 0.06 ), uRimColor * 0.5, uRimTint );
	totalEmissiveRadiance += npRimCol * pow( npRim, uRimPow ) * uRim;
	if (uDissolve > 0.0 && npDis < uDissolve + 0.035) totalEmissiveRadiance += vec3(1.0, 0.36, 0.08) * 0.6;`);
    fs = fs.replace('#include <opaque_fragment>', `outgoingLight = max( outgoingLight, diffuseColor.rgb * uLightFloor );
	#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'np-soldier-4' + (low ? 'l' : 'h');
  if (!dissolve) materialCache.set(key, m);
  return m;
}

/** Gemeinsames Material für Namensschild-Sprites etc. wird separat erzeugt; hier nur Aufräumen. */
export function disposeSoldierMaterials() {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
}
