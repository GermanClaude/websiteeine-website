// NULLPUNKT — Gelände-Material: Splat aus 5 Schichten (Gras, Erde, Kies, Fels, Acker/Schlamm) über eine
// RGBA-Kontrollkarte, Fotoscan-Sätze aus assets/lib (KTX2) mit prozeduralem Rückfall (engine/textures.js),
// Gegen-Kachelung (zwei Abtastungen mit Helligkeits-Überblendung + Makro-Rauschen + UV-Verzerrung), Wiesenfarbe
// (saftig ↔ trocken/strohig, feucht am Ufer), unregelmäßige Wegränder, Geröll an Hängen, Nässe am Ufer,
// Detailnormalen (low: nur nah) (Owner: world).
//
// gl-ground: Rauschen kommt aus EINER kleinen Textur (tNoise: RG = Detailnormale, BA = zwei kachelbare,
// histogrammentzerrte fBm-Felder) statt aus sin-Hash-Rauschen im Shader – gleiche Samplerzahl wie vorher (ersetzt
// die Detailkarte), weniger Rechenarbeit, weichere Formen. Dieselben Felder liest die CPU (terrainNoise /
// meadowTintAt) für die Grashalme (vegetation.js): Halme tragen die Wiesenfarbe des Bodens an ihrer Stelle, ferne
// Halme gehen nahtlos in den Boden über.
import * as THREE from 'three';
import { LIB_MATERIALS } from '../library.js';
import { getDetailNormalTexture } from '../../engine/textures.js';

/** Schichten: Bibliotheks-ID, prozeduraler Ersatz, Kachelgröße (m), Rauheit, Normalen-Rang (−1 = keine). */
export const TERRAIN_LAYERS = [
  { key: 'grass', lib: 'grass', proc: 'grass', size: 3.2, rough: 0.96, normal: 0 },
  { key: 'dirt', lib: 'dirt', proc: 'dirt', size: 3.5, rough: 0.93, normal: 1 },
  { key: 'gravel', lib: 'gravel', proc: 'gravel', size: 2.6, rough: 0.88, normal: -1 },
  { key: 'rock', lib: 'rubble', proc: 'concrete_dark', size: 4.5, rough: 0.86, normal: 2 },
  { key: 'mud', lib: 'mud', proc: 'dirt', size: 3.2, rough: 0.8, normal: -1 },
];

// ---------------------------------------------------------------------------
// Rauschtextur (geteilt, einmal je Sitzung erzeugt; ≈ 256 KB GPU)
// ---------------------------------------------------------------------------
const NS = 256;
let noiseData = null, noiseTex = null;

/** Kachelbare Wertrauschen-fBm (4 Oktaven: 4…32 Perioden je Kachel), anschließend histogrammentzerrt → 0..1 gleichverteilt. */
function fbmField(seed) {
  const S = NS;
  const hash = (i, j, s) => { let n = Math.imul(i & (S - 1), 374761393) + Math.imul(j & (S - 1), 668265263) + Math.imul(s, 2246822519); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y, f, s) => {
    const fx = x * f / S, fy = y * f / S, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (a, b) => hash(((a % f) + f) % f * (S / f), ((b % f) + f) % f * (S / f), s);
    return (g(i, j) * (1 - sx) + g(i + 1, j) * sx) * (1 - sy) + (g(i, j + 1) * (1 - sx) + g(i + 1, j + 1) * sx) * sy;
  };
  const v = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    v[y * S + x] = vnoise(x, y, 4, seed) * 0.5 + vnoise(x, y, 8, seed + 1) * 0.26 + vnoise(x, y, 16, seed + 2) * 0.15 + vnoise(x, y, 32, seed + 3) * 0.09;
  }
  // Rang → 0..1 (Schwellen im Shader werden so zu Flächenanteilen: smoothstep(0.7, …) ≈ 30 % der Fläche)
  const idx = new Uint32Array(S * S);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  idx.sort((a, b) => v[a] - v[b]);
  const out = new Float32Array(S * S), inv = 1 / (idx.length - 1);
  for (let r = 0; r < idx.length; r++) out[idx[r]] = r * inv;
  return out;
}

function ensureNoise() {
  if (noiseData) return noiseData;
  const S = NS, data = new Uint8Array(S * S * 4);
  const b = fbmField(31), a = fbmField(57);
  const det = getDetailNormalTexture(), dd = det?.image?.data, dw = det?.image?.width || 0, dh = det?.image?.height || 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4;
    if (dd && dw && dh) { const s = ((y * dh / S | 0) * dw + (x * dw / S | 0)) * 4; data[o] = dd[s]; data[o + 1] = dd[s + 1]; }
    else { data[o] = 128; data[o + 1] = 128; }
    data[o + 2] = Math.round(b[y * S + x] * 255); data[o + 3] = Math.round(a[y * S + x] * 255);
  }
  noiseData = data;
  return data;
}

/** aniso: anisotrope Filterung (low 1 – jede Zusatzabtastung kostet auf schwachen GPUs/Software-Renderern). */
function noiseTexture(aniso = 4) {
  if (noiseTex) {
    if (noiseTex.anisotropy !== aniso) { noiseTex.anisotropy = aniso; noiseTex.needsUpdate = true; }
    return noiseTex;
  }
  const t = new THREE.DataTexture(ensureNoise(), NS, NS, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.name = 'terrain:noise';
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

/** Bilineare Abtastung eines Kanals (2 = B, 3 = A) wie texture() mit Wiederholung (u, v in Kacheln). */
function sampleNoise(ch, u, v) {
  const d = noiseData || ensureNoise(), S = NS;
  const fx = u * S - 0.5, fy = v * S - 0.5, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const i0 = ((i % S) + S) % S, j0 = ((j % S) + S) % S, i1 = (i0 + 1) % S, j1 = (j0 + 1) % S;
  const g = (a, b2) => d[(b2 * S + a) * 4 + ch];
  return ((g(i0, j0) * (1 - tx) + g(i1, j0) * tx) * (1 - ty) + (g(i0, j1) * (1 - tx) + g(i1, j1) * tx) * ty) / 255;
}

// Drei Maßstäbe, gegeneinander gedreht/versetzt (GLSL terrN1–3 rechnet exakt dasselbe):
//   1: Makro (Kachel 173 m → Formen 43…5 m), 2: Mitte (37 m → 9…1 m), 3: Flecken (6,1 m → 1,5…0,2 m)
/**
 * Gelände-Rauschen an (x, z) für Maßstab k (1–3) → [B, A] (je 0..1, gleichverteilt). out wird zurückgegeben.
 * @param {number} x @param {number} z @param {1|2|3} k @param {number[]} [out]
 */
export function terrainNoise(x, z, k, out = [0, 0]) {
  let u, v;
  if (k === 1) { u = (0.8 * x - 0.6 * z) / 173; v = (0.6 * x + 0.8 * z) / 173; }
  else if (k === 2) { u = (0.28 * x + 0.96 * z) / 37 + 0.37; v = (-0.96 * x + 0.28 * z) / 37 + 0.11; }
  else { u = x / 6.1 + 0.71; v = z / 6.1 + 0.53; }
  out[0] = sampleNoise(2, u, v); out[1] = sampleNoise(3, u, v);
  return out;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _n1 = [0, 0], _n2 = [0, 0];

/**
 * Wiesenfarbe (Faktor auf die Gras-Albedo) wie im Gelände-Shader (terrMeadowTint + Uferfeuchte): großräumig saftig ↔
 * trocken/strohig, feucht-dunkelgrün und dunkler am Ufer, Helligkeit großräumig. y = Bodenhöhe, dryBias: zusätzliche Trockenheit
 * (Hangneigung), n2: schon abgetastetes terrainNoise(x, z, 2) (spart zwei Abfragen). → out [r, g, b]
 */
export function meadowTintAt(x, z, y, dryBias = 0, out = [1, 1, 1], n2 = null) {
  terrainNoise(x, z, 1, _n1);
  if (n2) { _n2[0] = n2[0]; _n2[1] = n2[1]; } else terrainNoise(x, z, 2, _n2);
  const hw = y - terrainLook.waterY;
  const moist = 1 - sstep(0.5, 3.4, hw + (_n2[0] - 0.5) * 1.8);
  const dry = sstep(0.5, 0.82, _n1[0] * 0.6 + _n2[0] * 0.4 + dryBias) * (1 - moist);
  // Helligkeit großräumig × feuchter Uferstreifen (Gelände-Shader: alb *= mix(1, 0.84, damp) nach der Wiesenfarbe)
  const damp = 1 - sstep(0.5, 2.6, hw + (_n2[1] - 0.5) * 0.8);
  const br = (0.86 + 0.28 * _n1[1]) * (1 - 0.16 * damp);
  for (let c = 0; c < 3; c++) {
    let t = MEADOW_LUSH[c] + (MEADOW_DRY[c] - MEADOW_LUSH[c]) * dry;
    t += (MEADOW_WET[c] - t) * moist * 0.75;
    out[c] = t * br;
  }
  return out;
}
const MEADOW_LUSH = [0.93, 1.0, 0.86], MEADOW_DRY = [1.2, 1.06, 0.66], MEADOW_WET = [0.8, 0.93, 0.74];
const v3 = (a) => `vec3(${a.map(n => n.toFixed(3)).join(', ')})`;

/** GLSL: Rauschabtastung + Wiesenfarbe (braucht uniform sampler2D tNoise). Gleiche Formeln wie terrainNoise/meadowTintAt. */
export const TERRAIN_NOISE_GLSL = `
  vec2 terrN1(vec2 p) { return texture2D(tNoise, vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * (1.0 / 173.0)).ba; }
  vec2 terrN2(vec2 p) { return texture2D(tNoise, vec2(0.28 * p.x + 0.96 * p.y, -0.96 * p.x + 0.28 * p.y) * (1.0 / 37.0) + vec2(0.37, 0.11)).ba; }
  vec2 terrN3(vec2 p) { return texture2D(tNoise, p * (1.0 / 6.1) + vec2(0.71, 0.53)).ba; }
  vec3 terrMeadowTint(vec2 n1, vec2 n2, float hw, float dryBias) {
    float moist = 1.0 - smoothstep(0.5, 3.4, hw + (n2.x - 0.5) * 1.8);
    float dry = smoothstep(0.5, 0.82, n1.x * 0.6 + n2.x * 0.4 + dryBias) * (1.0 - moist);
    vec3 t = mix(${v3(MEADOW_LUSH)}, ${v3(MEADOW_DRY)}, dry);
    t = mix(t, ${v3(MEADOW_WET)}, moist * 0.75);
    return t * (0.86 + 0.28 * n1.y);
  }
`;

/**
 * Geteilter Zustand für die Grashalme (vegetation.js): Gras-Albedo (Uniform-Objekt, Mittelwert per textureLod),
 * Kalibrierung, Wasserhöhe. ready = false ohne Gelände-Material (dann feste Grundfarbe).
 */
export const terrainLook = { ready: false, waterY: 0, grassMap: { value: null }, grassCal: { value: 1 } };

function ctrlTexture(hf) {
  const t = new THREE.DataTexture(hf.splat, hf.n, hf.n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  t.needsUpdate = true;
  t.name = 'terrain:ctrl';
  return t;
}

/**
 * @param {{ hf, quality: string, lib?: { load: Function }|null, libOk: boolean, getMaterial: Function, tier?: number }} o
 * @returns {Promise<{ material: THREE.MeshStandardMaterial, uniforms: object, libIds: string[], source: string, dispose(): void }>}
 */
export async function createTerrainMaterial(o) {
  const { hf, quality } = o;
  const low = quality === 'low';
  const useNormals = !low;
  // Texturen: Bibliothek (KTX2) oder prozedural
  const maps = new Array(TERRAIN_LAYERS.length).fill(null), normals = new Array(TERRAIN_LAYERS.length).fill(null);
  const sizes = TERRAIN_LAYERS.map(l => l.size);
  // env-look: Kalibrierung der Fotoscan-Albedos wie bei den Karten-Materialien (LIB_MATERIALS.color; Kies war ×1 → weiß)
  const cal = TERRAIN_LAYERS.map(() => 1);
  let source = 'prozedural';
  const libIds = [];
  if (o.libOk && o.lib) {
    const plan = new Map(TERRAIN_LAYERS.map(l => ['gelaende:' + l.key, { id: l.lib, tier: o.tier || 1024 }]));
    try {
      const r = await o.lib.load({ names: [...plan.keys()], plan, models: [] });
      TERRAIN_LAYERS.forEach((l, k) => {
        const set = r.sets.get('gelaende:' + l.key);
        if (!set) return;
        maps[k] = set.map; normals[k] = set.normalMap;
        const c = LIB_MATERIALS[l.key]?.color ?? LIB_MATERIALS[l.lib]?.color;
        if (typeof c === 'number') cal[k] = c;
        // sizeM ist [Breite, Höhe] in m; Gelände etwas gröber kacheln (weniger Wiederholung aus Augenhöhe)
        const sm = Array.isArray(set.sizeM) ? set.sizeM[0] : set.sizeM;
        if (Number.isFinite(sm) && sm > 0) sizes[k] = Math.max(2.2, Math.min(6, sm * 1.6));
        libIds.push(`${set.id}@${set.tier}`);
      });
      if (libIds.length) source = libIds.length === TERRAIN_LAYERS.length ? 'bibliothek' : 'gemischt';
    } catch { /* prozedural */ }
  }
  TERRAIN_LAYERS.forEach((l, k) => {
    if (maps[k]) return;
    const m = o.getMaterial(l.proc);
    maps[k] = m.map || null; normals[k] = m.normalMap || null;
  });
  for (const t of [...maps, ...normals]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }

  const ctrl = ctrlTexture(hf);
  const uniforms = {
    tCtrl: { value: ctrl },
    tOrigin: { value: new THREE.Vector2(hf.minX - hf.res * 0.5, hf.minZ - hf.res * 0.5) },
    tSize: { value: hf.size + hf.res },
    tWaterY: { value: hf.waterY },
    tScale: { value: sizes.map(s => 1 / s) },
    tRough: { value: TERRAIN_LAYERS.map(l => l.rough) },
    tCal: { value: cal },
    // RG: feine Detailnormalen nah an der Kamera (Kopie der geteilten Karte aus engine/textures.js), BA: Gelände-Rauschen
    tNoise: { value: noiseTexture(low ? 1 : 4) },
  };
  TERRAIN_LAYERS.forEach((l, k) => { uniforms['tMap' + k] = { value: maps[k] }; });
  const nList = TERRAIN_LAYERS.filter(l => l.normal >= 0);
  nList.forEach((l) => { const k = TERRAIN_LAYERS.indexOf(l); uniforms['tNor' + l.normal] = { value: normals[k] }; });
  const haveNormals = useNormals && nList.every(l => normals[TERRAIN_LAYERS.indexOf(l)]);
  // Gras (vegetation.js): Wiesenfarbe und Gras-Albedo des Bodens
  terrainLook.ready = !!maps[0];
  terrainLook.waterY = Number.isFinite(hf.waterY) ? hf.waterY : -1e3;
  terrainLook.grassMap = uniforms.tMap0;
  terrainLook.grassCal = { value: cal[0] };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'terrain';
  mat.userData.surface = 'grass';
  mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2; // Straßen/Plätze liegen knapp darüber
  mat.defines = { TERR_NORMALS: haveNormals ? 1 : 0, TERR_ANTITILE: low ? 0 : 1, TERR_DETAIL: 1 };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vTW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    const decl = `
      varying vec3 vTW;
      uniform sampler2D tCtrl, tMap0, tMap1, tMap2, tMap3, tMap4;
      #if TERR_NORMALS
      uniform sampler2D tNor0, tNor1, tNor2;
      #endif
      uniform vec2 tOrigin; uniform float tSize; uniform float tWaterY; uniform float tScale[5]; uniform float tRough[5]; uniform float tCal[5];
      uniform sampler2D tNoise;
      vec3 gTerrN; float gTerrRough;
      ${TERRAIN_NOISE_GLSL}
      // Gegen-Kachelung: zweite, gedrehte und gröbere Abtastung; Überblendung nach Helligkeit (Höhen-Überblendung:
      // der hellere/„höhere“ Texel setzt sich durch) statt linear – kein Kontrastverlust in der Mischzone
      // far (> 135 m, räumlich zusammenhängend → kein Divergenz-Problem): nur die gröbere Abtastung (k ist dort 1)
      vec3 tSample(sampler2D t, vec2 uv, float k, bool far) {
        #if TERR_ANTITILE
        vec2 uvB = vec2(0.8 * uv.x - 0.6 * uv.y, 0.6 * uv.x + 0.8 * uv.y) * 0.53 + vec2(0.31, 0.17);
        if (far) return texture2D(t, uvB).rgb;
        vec3 a = texture2D(t, uv).rgb, b = texture2D(t, uvB).rgb;
        float s = clamp((k - 0.5) * 3.0 + (dot(b, vec3(0.3, 0.59, 0.11)) - dot(a, vec3(0.3, 0.59, 0.11))) * 2.5 + 0.5, 0.0, 1.0);
        return mix(a, b, s);
        #else
        return texture2D(t, uv).rgb;
        #endif
      }
    `;
    sh.fragmentShader = decl + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec2 cuv = (vTW.xz - tOrigin) / tSize;
        vec4 c = texture2D(tCtrl, cuv);
        // glatte Weltnormale (interpoliert, nicht dreieckig wie dFdx/dFdy) für Hangneigung
        vec3 wN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
        float steepS = clamp(1.0 - wN.y, 0.0, 1.0);
        // außerhalb des Höhenfelds (Kulissenring): Fels nach Steilheit, sonst Gras
        float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
        c = mix(vec4(0.12, 0.0, smoothstep(0.14, 0.32, steepS), 0.0), c, inside);
        float camD = length(vTW - cameraPosition);
        float hw = vTW.y - tWaterY;
        vec2 n1 = terrN1(vTW.xz);
        // Mitte (1–9 m): ab 150 m ausgeblendet, ab 220 m (Nebel) gar nicht mehr abgefragt; Flecken (0,2–1,5 m): ab 45 m
        // ausgeblendet (dort mittelt die Mipmap ohnehin auf 0,5), ab 70 m nicht mehr abgefragt – Entfernung ist räumlich
        // zusammenhängend, die Verzweigung kostet nichts und spart in der Ferne Abfragen
        float n2f = 1.0 - smoothstep(150.0, 220.0, camD);
        vec2 n2 = vec2(0.5);
        if (n2f > 0.0) n2 = mix(vec2(0.5), terrN2(vTW.xz), n2f);
        #if TERR_ANTITILE
        float n3f = 1.0 - smoothstep(45.0, 70.0, camD);
        vec2 n3 = vec2(0.5);
        if (n3f > 0.0) n3 = mix(vec2(0.5), terrN3(vTW.xz), n3f);
        float eN = n3.y - 0.5;
        #else
        vec2 n3 = vec2(0.5);
        float eN = n2.y - 0.5;
        #endif
        // Übergänge (Wegränder, Erdflecken, Geröll): schärfer und unregelmäßig statt bilinear verwaschen (1-m-Karte)
        vec4 tr = c * (1.0 - c) * 4.0;
        vec4 wv = clamp((c - 0.5) * 1.6 + 0.5 + eN * tr * 0.75, 0.0, 1.0);
        // Geröll/Kies in Flecken an steileren Hängen (feiner als die Kontrollkarte)
        float scree = smoothstep(0.1, 0.24, steepS + (n2.x - 0.5) * 0.08) * smoothstep(0.35, 0.7, n2.y) * (1.0 - wv.z) * 0.6 * inside;
        wv.y = max(wv.y, scree);
        float wG = clamp(1.0 - wv.x - wv.y - wv.z - wv.w, 0.0, 1.0);
        // Gegen-Kachelung: Flecken ≈ 1–9 m; fern ganz die gröbere Abtastung (Wiederholung fällt aus der Distanz auf)
        float kA = max(smoothstep(0.42, 0.58, n2.y), smoothstep(45.0, 130.0, camD));
        bool tFar = camD > 135.0;
        vec2 tW = (n2 - 0.5) * 0.9; // weiche UV-Verzerrung
        vec3 aG = tSample(tMap0, vTW.xz * tScale[0] + tW, kA, tFar) * tCal[0];
        // Wiesenfarbe: saftig ↔ trocken (großräumig, trockener an Hängen), feucht am Ufer
        aG *= terrMeadowTint(n1, n2, hw, steepS * 1.4);
        #if TERR_ANTITILE
        // Horste/Flecken (0,2–1,5 m): dunklere Büschel, einzelne helle trockene Stellen
        aG *= mix(0.82, 1.07, n3.x) * mix(vec3(1.0), vec3(1.1, 1.03, 0.8), smoothstep(0.86, 0.97, n3.y));
        #endif
        // zertretenes Gras an Wegrändern und um Erdflecken: heller, bräunlich
        float worn = smoothstep(0.03, 0.2, c.r) * (1.0 - smoothstep(0.3, 0.7, c.r));
        aG = mix(aG, aG * vec3(1.08, 0.97, 0.74), worn * 0.8);
        vec3 aD = tSample(tMap1, vTW.xz * tScale[1] + tW, kA, tFar) * tCal[1] * mix(vec3(0.9, 0.9, 0.94), vec3(1.08, 1.03, 0.92), n1.y);
        vec3 aK = tSample(tMap2, vTW.xz * tScale[2] + tW, kA, tFar) * tCal[2];
        vec3 aF = tSample(tMap3, vTW.xz * tScale[3] + tW, kA, tFar) * vec3(0.62, 0.6, 0.56) * tCal[3]; // Fels/Geröll dunkler (kein Schnee-Eindruck)
        vec3 aM = texture2D(tMap4, vTW.xz * tScale[4] + tW).rgb * tCal[4];
        float sum = wG + wv.x + wv.y + wv.z + wv.w + 1e-4;
        vec3 alb = (aG * wG + aD * wv.x + aK * wv.y + aF * wv.z + aM * wv.w) / sum;
        gTerrRough = (tRough[0] * wG + tRough[1] * wv.x + tRough[2] * wv.y + tRough[3] * wv.z + tRough[4] * wv.w) / sum;
        // Feuchte: nasser Saum an der Wasserlinie (dunkel, glatt), darüber feuchter, dunklerer Uferstreifen
        float wet = 1.0 - smoothstep(0.05, 0.7 + n2.x * 0.6, hw);
        float damp = 1.0 - smoothstep(0.5, 2.6, hw + (n2.y - 0.5) * 0.8);
        alb *= mix(1.0, 0.84, damp) * mix(1.0, 0.6, wet);
        gTerrRough = mix(gTerrRough, 0.35, wet);
        diffuseColor.rgb *= alb;
        #if TERR_NORMALS
        float fade = 1.0 - smoothstep(40.0, 140.0, camD);
        gTerrN = vec3(0.0, 0.0, 1.0);
        // ab 140 m flach (wie vorher) – dort die drei Normalen-Abfragen ganz sparen (Entfernung: räumlich zusammenhängend)
        if (fade > 0.0) {
          vec2 uG = vTW.xz * tScale[0] + tW, uD = vTW.xz * tScale[1] + tW, uF = vTW.xz * tScale[3] + tW;
          vec3 nG = texture2D(tNor0, uG).xyz * 2.0 - 1.0, nD = texture2D(tNor1, uD).xyz * 2.0 - 1.0, nF = texture2D(tNor2, uF).xyz * 2.0 - 1.0;
          // Stärke je Schicht: Gras flach (Fotoscan-Relief wirkt sonst wie Plastik), Erde mittel, Fels kräftig
          nG.xy *= 0.6; nF.xy *= 1.15;
          vec3 nB = normalize(nG * wG + nD * (wv.x + wv.y + wv.w) + nF * wv.z + vec3(0.0, 0.0, 0.05));
          gTerrN = normalize(mix(vec3(0.0, 0.0, 1.0), nB, 0.9 * fade * (1.0 - wet * 0.6)));
        }
        float dFade = 1.0 - smoothstep(4.0, 26.0, camD);
        if (dFade > 0.01) {
          vec2 dn = texture2D(tNoise, vTW.xz * 1.15).xy * 2.0 - 1.0;
          gTerrN = normalize(gTerrN + vec3(dn * 0.45 * dFade, 0.0));
        }
        // textures-2: zweite, feinere Detailstufe direkt vor den Füßen (≈ 30 cm Periode, bis 9 m)
        float dFade2 = 1.0 - smoothstep(2.0, 9.0, camD);
        if (dFade2 > 0.01) {
          vec2 dn2 = texture2D(tNoise, vTW.xz * 3.4 + 0.5).xy * 2.0 - 1.0;
          gTerrN = normalize(gTerrN + vec3(dn2 * 0.3 * dFade2, 0.0));
        }
        #else
        gTerrN = vec3(0.0, 0.0, 1.0);
        #if TERR_DETAIL
        // textures-2 (low): nur die Detailnormalen nah an der Kamera – Bodenrelief statt glatter Fläche
        {
          float dFl = 1.0 - smoothstep(3.0, 16.0, camD);
          if (dFl > 0.01) {
            vec2 dnl = texture2D(tNoise, vTW.xz * 1.15).xy * 2.0 - 1.0;
            gTerrN = normalize(vec3(dnl * 0.5 * dFl, 1.0));
          }
        }
        #endif
        #endif
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gTerrRough;')
      .replace('#include <normal_fragment_maps>', `
        #if TERR_NORMALS || TERR_DETAIL
        vec3 tT = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        tT = normalize(tT - normal * dot(normal, tT));
        vec3 tB = cross(tT, normal);
        normal = normalize(mat3(tT, tB, normal) * gTerrN);
        #endif
      `);
  };
  mat.customProgramCacheKey = () => `terrain-v6-${haveNormals ? 1 : 0}-${low ? 0 : 1}`;
  return {
    material: mat, uniforms, libIds, source,
    dispose() { ctrl.dispose(); mat.dispose(); noiseTex?.dispose(); },
  };
}
