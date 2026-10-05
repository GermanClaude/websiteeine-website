// NULLPUNKT — Gelände-Material: Splat aus 5 Schichten (Gras, Erde, Kies, Fels, Acker/Schlamm) über eine
// RGBA-Kontrollkarte, Fotoscan-Sätze aus assets/lib (KTX2) mit prozeduralem Rückfall (engine/textures.js),
// Gegen-Kachelung (zwei Maßstäbe + Makro-Rauschen), Nässe am Ufer, Detailnormalen ab medium (Owner: world).
import * as THREE from 'three';

/** Schichten: Bibliotheks-ID, prozeduraler Ersatz, Kachelgröße (m), Rauheit, Normalen-Rang (−1 = keine). */
export const TERRAIN_LAYERS = [
  { key: 'grass', lib: 'grass', proc: 'grass', size: 3.2, rough: 0.96, normal: 0 },
  { key: 'dirt', lib: 'dirt', proc: 'dirt', size: 3.5, rough: 0.93, normal: 1 },
  { key: 'gravel', lib: 'gravel', proc: 'gravel', size: 2.6, rough: 0.88, normal: -1 },
  { key: 'rock', lib: 'rubble', proc: 'concrete_dark', size: 4.5, rough: 0.86, normal: 2 },
  { key: 'mud', lib: 'mud', proc: 'dirt', size: 3.2, rough: 0.8, normal: -1 },
];

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
        if (set.sizeM) sizes[k] = Math.max(1.5, Math.min(6, set.sizeM));
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
  };
  TERRAIN_LAYERS.forEach((l, k) => { uniforms['tMap' + k] = { value: maps[k] }; });
  const nList = TERRAIN_LAYERS.filter(l => l.normal >= 0);
  nList.forEach((l) => { const k = TERRAIN_LAYERS.indexOf(l); uniforms['tNor' + l.normal] = { value: normals[k] }; });
  const haveNormals = useNormals && nList.every(l => normals[TERRAIN_LAYERS.indexOf(l)]);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'terrain';
  mat.userData.surface = 'grass';
  mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2; // Straßen/Plätze liegen knapp darüber
  mat.defines = { TERR_NORMALS: haveNormals ? 1 : 0, TERR_ANTITILE: low ? 0 : 1 };
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
      uniform vec2 tOrigin; uniform float tSize; uniform float tWaterY; uniform float tScale[5]; uniform float tRough[5];
      vec3 gTerrN; float gTerrRough;
      float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y); }
      vec3 tSample(sampler2D t, vec2 uv, float anti) {
        vec3 a = texture2D(t, uv).rgb;
        #if TERR_ANTITILE
        vec3 b = texture2D(t, uv * 0.43 + vec2(0.31, 0.17)).rgb;
        a = mix(a, b, anti);
        #endif
        return a;
      }
    `;
    sh.fragmentShader = decl + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec2 cuv = (vTW.xz - tOrigin) / tSize;
        vec4 c = texture2D(tCtrl, cuv);
        // außerhalb des Höhenfelds (Kulissenring): Fels nach Steilheit, sonst Gras
        float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
        vec3 gN = normalize(cross(dFdx(vTW), dFdy(vTW)));
        float steepF = 1.0 - abs(gN.y);
        c = mix(vec4(0.12, 0.0, smoothstep(0.14, 0.32, steepF), 0.0), c, inside);
        float macro = tNoise(vTW.xz / 47.0) * 0.6 + tNoise(vTW.xz / 13.0) * 0.4;
        float anti = smoothstep(0.25, 0.75, tNoise(vTW.xz / 21.0 + 3.7));
        float wG = clamp(1.0 - c.r - c.g - c.b - c.a, 0.0, 1.0);
        // Übergänge schärfer + leicht verrauscht (wirkt nicht wie Überblendung)
        vec4 wv = vec4(c.r, c.g, c.b, c.a) * (0.85 + 0.3 * macro);
        vec3 aG = tSample(tMap0, vTW.xz * tScale[0], anti);
        aG *= mix(vec3(1.06, 1.02, 0.86), vec3(0.86, 0.98, 0.9), macro); // grün ↔ gelblich
        vec3 aD = tSample(tMap1, vTW.xz * tScale[1], anti);
        vec3 aK = texture2D(tMap2, vTW.xz * tScale[2]).rgb;
        vec3 aF = tSample(tMap3, vTW.xz * tScale[3], anti) * vec3(0.62, 0.6, 0.56); // Fels/Geröll dunkler (kein Schnee-Eindruck)
        vec3 aM = texture2D(tMap4, vTW.xz * tScale[4]).rgb;
        float sum = wG + wv.x + wv.y + wv.z + wv.w + 1e-4;
        vec3 alb = (aG * wG + aD * wv.x + aK * wv.y + aF * wv.z + aM * wv.w) / sum;
        gTerrRough = (tRough[0] * wG + tRough[1] * wv.x + tRough[2] * wv.y + tRough[3] * wv.z + tRough[4] * wv.w) / sum;
        // Nässe am Ufer: dunkler, glatter
        float wet = 1.0 - smoothstep(tWaterY + 0.15, tWaterY + 1.1, vTW.y);
        alb *= mix(1.0, 0.62, wet);
        gTerrRough = mix(gTerrRough, 0.42, wet);
        alb *= 0.9 + 0.2 * macro;
        diffuseColor.rgb *= alb;
        #if TERR_NORMALS
        vec2 uG = vTW.xz * tScale[0], uD = vTW.xz * tScale[1], uF = vTW.xz * tScale[3];
        vec3 nG = texture2D(tNor0, uG).xyz * 2.0 - 1.0, nD = texture2D(tNor1, uD).xyz * 2.0 - 1.0, nF = texture2D(tNor2, uF).xyz * 2.0 - 1.0;
        gTerrN = normalize(nG * (wG + wv.y) + nD * (wv.x + wv.w) + nF * wv.z + vec3(0.0, 0.0, 0.05));
        float fade = 1.0 - smoothstep(40.0, 140.0, length(vTW - cameraPosition));
        gTerrN = normalize(mix(vec3(0.0, 0.0, 1.0), gTerrN, 0.85 * fade));
        #else
        gTerrN = vec3(0.0, 0.0, 1.0);
        #endif
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gTerrRough;')
      .replace('#include <normal_fragment_maps>', `
        #if TERR_NORMALS
        vec3 tT = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        tT = normalize(tT - normal * dot(normal, tT));
        vec3 tB = cross(tT, normal);
        normal = normalize(mat3(tT, tB, normal) * gTerrN);
        #endif
      `);
  };
  mat.customProgramCacheKey = () => `terrain-v1-${haveNormals ? 1 : 0}-${low ? 0 : 1}`;
  return {
    material: mat, uniforms, libIds, source,
    dispose() { ctrl.dispose(); mat.dispose(); },
  };
}
