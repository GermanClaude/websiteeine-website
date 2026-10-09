// NULLPUNKT — Vegetation für Großkarten (Owner: world): Fichten, Laubbäume, Büsche, Schilf, Felsen und ein Grasring
// um die Kamera. Je Art ein InstancedMesh für die Nähe (Karten mit Laub-Atlas, Wind) und eines für die Ferne
// (Einfachmodell bis zur Nebelkante); Instanzen werden nach Kamerabewegung kompakt umsortiert (wenige Draw Calls).
// Stämme und Felsen liefern Kollisions-/Kugel-Dreiecke; Laub blockiert keine Kugeln.
//
// Mehrspieler: Alles mit Kollision (Bäume = Stamm-Prismen, Felsen) wird auf JEDER Grafikstufe mit voller Dichte und
// denselben Zufallsströmen gesetzt – sonst stünden auf „niedrig“ andere Stämme als beim Gegner auf „hoch“ (unsichtbare
// bzw. fehlende Hindernisse, verschiedene Kugeldeckung). Nur Kollisionsloses (Büsche, Schilf, Grasring) dünnt die
// Stufe nachträglich per Positions-Hash aus (tier.density). Jeder kollidierende Baum wird auf jeder Stufe gezeichnet:
// nah mit Laubkarten, sonst als Fernmodell (Kegel/Ikosaeder + Stamm) bis treeFar.
import * as THREE from 'three';
import { createFoliage, foliageUniforms, WIND_VERTEX, setWindAttribute, setFoliageQuality } from '../atlas.js';
import { rng, hash2, createSimplex, smoothstep } from './noise.js';
import { terrainLook, terrainNoise, meadowTintAt } from './splat.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/** Fichte aus hängenden Zweigkarten in Etagen (Atlaszelle 0 = Laub), ≈ 90 Dreiecke, Höhe ≈ 11 m bei s = 1. */
function spruceGeometry() {
  const P = [], U = [], N = [];
  const u0 = 0.005, u1 = 0.495, v0 = 0.505, v1 = 0.995;
  const tiers = 8, H = 11, R0 = 2.5;
  const quad = (a, b, c, d, n) => {
    for (const [p, uv] of [[a, [u0, v0]], [b, [u1, v0]], [c, [u1, v1]], [a, [u0, v0]], [c, [u1, v1]], [d, [u0, v1]]]) { P.push(...p); U.push(...uv); N.push(...n); }
  };
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers, y = 1.4 + f * (H - 2.6), r = R0 * Math.pow(1 - f, 0.85) + 0.35;
    const cards = t < 5 ? 6 : 4;
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI * 2 + t * 0.9;
      const ca = Math.cos(a), sa = Math.sin(a), w = r * 0.62;
      const px = -sa * w / 2, pz = ca * w / 2;
      const inY = y + 0.55, outY = y - r * 0.32;
      const ix = ca * 0.12, iz = sa * 0.12, ox = ca * r, oz = sa * r;
      const n = [ca * 0.45, 0.85, sa * 0.45];
      quad([ix - px * 0.4, inY, iz - pz * 0.4], [ix + px * 0.4, inY, iz + pz * 0.4], [ox + px, outY, oz + pz], [ox - px, outY, oz - pz], n);
    }
  }
  // Spitze: zwei gekreuzte senkrechte Karten
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2, ca = Math.cos(a) * 0.6, sa = Math.sin(a) * 0.6;
    quad([-ca, H - 1.8, -sa], [ca, H - 1.8, sa], [ca * 0.1, H + 0.3, sa * 0.1], [-ca * 0.1, H + 0.3, -sa * 0.1], [sa, 0.5, -ca]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  // Wind: Stamm steif, Wipfel wiegt (≈ 0,3 m), Zweigspitzen (außen) federn leicht
  setWindAttribute(g, (x, y, z) => { const t = Math.min(1, y / (H + 0.3)), out = Math.min(1, Math.hypot(x, z) / R0); return [0.3 * t * t, 0.04 * out]; });
  g.computeBoundingSphere();
  return g;
}

/** Grasbüschel aus 7 schmalen Halmen (je 1 Dreieck), ohne Textur/Alpha-Test – Stufe „niedrig“.
 * blades > 0 (medium+): Horst aus gebogenen Halmen mit Knick (3 Dreiecke je Halm), siehe grassClumpGeometry.
 * gl-ground: Vertexfarben sind RELATIV (Fuß dunkel = Selbstschatten, Spitze hell/trocken); die eigentliche Farbe
 * (Wiesenfarbe des Bodens × Gras-Albedo) setzt der Shader (grassMaterial). aPetal = 0 (nur Blüten nutzen es). */
function grassGeometry(blades = 0) {
  if (blades > 0) return grassClumpGeometry(blades);
  const P = [], C = [], N = [], r = rng(5);
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.22, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 0.3 + r() * 0.38, w = 0.03 + r() * 0.02, lean = (r() - 0.5) * 0.35, ang = r() * Math.PI;
    const cx = Math.cos(ang) * w, cz = Math.sin(ang) * w, lx = Math.cos(a) * lean * h, lz = Math.sin(a) * lean * h;
    const dry = k === 2 || k === 5;
    P.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + lx, h, z + lz);
    C.push(0.5, 0.5, 0.46, 0.5, 0.5, 0.46, ...(dry ? [1.32, 1.18, 0.74] : [1.12, 1.12, 1.0]));
    N.push(Math.cos(a) * 0.3, 0.95, Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0.95, Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0.95, Math.sin(a) * 0.3);
  }
  return finishGrass(P, C, N);
}

/** Wind der Halme: Fuß fest, Spitze ≈ 0,14 m Biegung (quadratisch mit der Höhe) + leichtes Flattern. */
const GRASS_WIND = (x, y) => { const t = Math.min(1, Math.max(0, y / 0.65)); return [0.14 * t * t, 0.025 * t]; };

function finishGrass(P, C, N, petal = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  // aPetal immer explizit (fehlende Attribute lesen sonst einen zufälligen Restwert der Attribut-Stelle)
  g.setAttribute('aPetal', new THREE.Float32BufferAttribute(petal || new Float32Array(P.length / 3), 1));
  setWindAttribute(g, GRASS_WIND);
  g.computeBoundingSphere();
  return g;
}

/** Horst (medium+): n Halme, außen niedriger und stärker nach außen gebogen, wenige hohe Halme in der Mitte;
 * Breite 1,4–3 cm, Höhe 0,18–0,8 m; Farbe je Halm: frisch, trockene Spitze (≈ 25 %) oder abgestorben (≈ 6 %). */
function grassClumpGeometry(n) {
  const P = [], C = [], N = [], r = rng(11);
  const push = (v, c, nn) => { P.push(v[0], v[1], v[2]); C.push(c[0], c[1], c[2]); N.push(nn[0], nn[1], nn[2]); };
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 0.2, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const tall = r() < 0.18;
    const h = tall ? 0.6 + r() * 0.22 : (0.18 + r() * 0.42) * (1 - d * 1.6), w = (tall ? 0.011 : 0.014) + r() * 0.016;
    const lean = (tall ? 0.06 : 0.14) + r() * 0.32 * (0.5 + d * 3), la = a + (r() - 0.5) * 1.2; // nach außen gebogen
    const ang = la + Math.PI / 2, cx = Math.cos(ang) * w, cz = Math.sin(ang) * w;
    const ox = Math.cos(la), oz = Math.sin(la);
    const mh = h * (0.5 + r() * 0.1), ml = lean * 0.3 * h, tl = lean * h;
    const bL = [x - cx, 0, z - cz], bR = [x + cx, 0, z + cz];
    const mL = [x - cx * 0.75 + ox * ml, mh, z - cz * 0.75 + oz * ml], mR = [x + cx * 0.75 + ox * ml, mh, z + cz * 0.75 + oz * ml];
    const tip = [x + ox * tl, h * (1 - lean * 0.25), z + oz * tl];
    // relative Farben: Fuß dunkel (innen dunkler – Selbstschatten im Horst), Mitte, Spitze; trocken/abgestorben
    const q = r(), kind = q < 0.06 ? 2 : q < 0.31 ? 1 : 0, br = 0.9 + r() * 0.2, ao = 0.36 + d * 0.7;
    const cB = kind === 2 ? [0.62, 0.52, 0.36] : [ao, ao * 1.02, ao * 0.92];
    const cM = kind === 2 ? [1.15, 0.98, 0.66] : kind === 1 ? [1.02, 1.0, 0.82] : [0.88, 0.92, 0.84];
    const cT = kind === 2 ? [1.45, 1.22, 0.82] : kind === 1 ? [1.5, 1.28, 0.7] : [1.12, 1.1, 0.92];
    const sc = (c) => c.map(v => v * br);
    // Normale: Blattfläche zeigt in Biegerichtung, nach oben geneigt (weiches Licht); Spitze fast senkrecht nach oben
    const fn = [ox * 0.5, 0.86, oz * 0.5], nT = [ox * 0.25, 0.97, oz * 0.25];
    push(bL, sc(cB), fn); push(bR, sc(cB), fn); push(mR, sc(cM), fn);
    push(bL, sc(cB), fn); push(mR, sc(cM), fn); push(mL, sc(cM), fn);
    push(mL, sc(cM), fn); push(mR, sc(cM), fn); push(tip, sc(cT), nT);
  }
  return finishGrass(P, C, N);
}

/** Wiesenblumen-Gruppe (medium+, eigenes InstancedMesh, spärlich): zwei Margeriten, ein Hahnenfuß (Blütenblätter
 * aPetal = 1 → Farbe je Instanz aus einer Palette im Shader, Mitte aPetal = 2 → feste Vertexfarbe), eine Kleerosette am Boden und ein
 * Rispenhalm mit Samenstand. ≈ 36 Dreiecke. */
function flowerGeometry() {
  const P = [], C = [], N = [], A = [], r = rng(23);
  const tri = (a, b, c, ca, cb, cc, n, pa = 0, pb = 0, pc = 0) => {
    for (const [v, col, pp] of [[a, ca, pa], [b, cb, pb], [c, cc, pc]]) { P.push(v[0], v[1], v[2]); C.push(col[0], col[1], col[2]); N.push(n[0], n[1], n[2]); A.push(pp); }
  };
  const STEM = [0.55, 0.62, 0.42], STEM_T = [0.9, 1.0, 0.72], UP = [0, 1, 0];
  const stem = (x, z, h, w, bend) => {
    const tx = x + bend[0], tz = z + bend[1];
    tri([x - w, 0, z], [x + w, 0, z], [tx, h, tz], STEM, STEM, STEM_T, [0, 0.4, 1]);
    tri([x, 0, z - w], [x, 0, z + w], [tx, h, tz], STEM, STEM, STEM_T, [1, 0.4, 0]);
    return [tx, h, tz];
  };
  const head = (c, rad, petals, tilt, center) => {
    const tn = [Math.sin(tilt) * 0.4, 1, 0];
    for (let k = 0; k < petals; k++) {
      const a0 = (k / petals) * Math.PI * 2, a1 = ((k + 1) / petals) * Math.PI * 2;
      const p0 = [c[0] + Math.cos(a0) * rad, c[1] + Math.sin(tilt) * Math.cos(a0) * rad * 0.5, c[2] + Math.sin(a0) * rad];
      const p1 = [c[0] + Math.cos(a1) * rad, c[1] + Math.sin(tilt) * Math.cos(a1) * rad * 0.5, c[2] + Math.sin(a1) * rad];
      tri([c[0], c[1] + 0.006, c[2]], p0, p1, center, [1, 1, 1], [1, 1, 1], tn, 2, 1, 1);
    }
  };
  // Margeriten (gelbe Mitte), Hahnenfuß (Mitte in Blütenfarbe, kleiner)
  for (const [x, z, h, rad] of [[0.06, -0.04, 0.36, 0.034], [-0.09, 0.05, 0.28, 0.03]]) head(stem(x, z, h, 0.006, [(r() - 0.5) * 0.06, (r() - 0.5) * 0.06]), rad, 7, 0.3, [1.0, 0.78, 0.12]);
  head(stem(0.02, 0.11, 0.22, 0.005, [0.03, -0.02]), 0.02, 5, 0.2, [0.95, 0.9, 0.6]);
  // Kleerosette: vier flache Blätter knapp über dem Boden (dunkles, sattes Grün)
  const CL = [0.62, 0.78, 0.5], CLd = [0.42, 0.52, 0.34];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + 0.4, ca = Math.cos(a), sa = Math.sin(a), cx = -0.1, cz = -0.1;
    const base = [cx, 0.02, cz], tip = [cx + ca * 0.09, 0.07, cz + sa * 0.09];
    const l = [cx + ca * 0.05 - sa * 0.035, 0.055, cz + sa * 0.05 + ca * 0.035], rr = [cx + ca * 0.05 + sa * 0.035, 0.055, cz + sa * 0.05 - ca * 0.035];
    tri(base, l, tip, CLd, CL, CL, UP); tri(base, tip, rr, CLd, CL, CL, UP);
  }
  // Rispenhalm: dünner hoher Halm, oben ein gestreckter Samenstand (strohfarben)
  const top = stem(0.12, 0.08, 0.62, 0.004, [0.05, 0.02]);
  const SEED = [1.35, 1.12, 0.7];
  tri([top[0] - 0.012, top[1] - 0.1, top[2]], [top[0] + 0.012, top[1] - 0.1, top[2]], [top[0] + 0.01, top[1] + 0.06, top[2] + 0.005], SEED, SEED, SEED, [0, 0.4, 1]);
  tri([top[0], top[1] - 0.1, top[2] - 0.012], [top[0], top[1] - 0.1, top[2] + 0.012], [top[0] + 0.01, top[1] + 0.06, top[2] + 0.005], SEED, SEED, SEED, [1, 0.4, 0]);
  return finishGrass(P, C, N, A);
}

/**
 * Material der Grashalme und Blumen: Wind wie das Laub (atlas.js WIND_VERTEX). Farbe im Vertex-Shader:
 *   Boden = Gras-Albedo des Geländes (Mittelwert, textureLod) × Wiesenfarbe an der Instanz (instanceColor, CPU aus
 *   splat.js meadowTintAt – dieselben Rauschfelder wie der Gelände-Shader);
 *   nah = Boden × relative Halmfarbe (Vertexfarbe) × Streuung je Horst; Blütenblätter (aPetal) aus einer Palette;
 *   fern = Boden (Halme gehen farblich in den Boden über, Normale → oben wie das Gelände) und schrumpfen weich
 *   (uGrassFade, Rand je Horst unregelmäßig) – kein harter Ring.
 * Beide Blattseiten werden gleich beleuchtet (dünne, durchscheinende Halme statt dunkler Rückseiten).
 */
function grassMaterial(fade) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  m.name = 'vegetation-gras'; m.userData.disposable = true; m.userData.surface = 'grass';
  const look = terrainLook.ready && !!terrainLook.grassMap?.value;
  const u = {
    uGrassFade: { value: new THREE.Vector4(fade[0], fade[1], fade[2], fade[3]) },
    uGrassK: { value: new THREE.Vector2(GRASS_K.blade, GRASS_K.far) },
    tGrassMap: terrainLook.grassMap, tGrassCal: terrainLook.grassCal,
  };
  m.userData.grassFade = u.uGrassFade.value;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = foliageUniforms.uTime;
    sh.uniforms.uWind = foliageUniforms.uWind;
    Object.assign(sh.uniforms, look ? u : { uGrassFade: u.uGrassFade, uGrassK: u.uGrassK });
    sh.vertexShader = `uniform float uTime;
uniform vec4 uWind;
attribute vec2 aWind;
attribute float aPetal;
uniform vec4 uGrassFade;
uniform vec2 uGrassK;
${look ? 'uniform sampler2D tGrassMap;\nuniform float tGrassCal;' : ''}
` + sh.vertexShader
      .replace('#include <color_vertex>', `
        vec3 npTint = vec3(1.0);
        float npGd = 0.0, npH1 = 0.5;
        #ifdef USE_INSTANCING_COLOR
          npTint = instanceColor.xyz;
        #endif
        #ifdef USE_INSTANCING
          vec3 npIp = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
          npH1 = fract(sin(dot(npIp.xz, vec2(41.3, 289.1))) * 43758.5453);
          npGd = length(npIp.xz - cameraPosition.xz) * (0.9 + 0.2 * npH1);
        #endif
        float npH2 = fract(npH1 * 7.31 + 0.13), npH3 = fract(npH1 * 13.7 + 0.41);
        float npCf = smoothstep(uGrassFade.x, uGrassFade.y, npGd);       // Farbe → Boden
        float npSf = 1.0 - smoothstep(uGrassFade.z, uGrassFade.w, npGd); // Höhe → 0
        vec3 npGround = ${look ? 'textureLod(tGrassMap, vec2(0.5), 12.0).rgb * tGrassCal' : `vec3(${GRASS_FALLBACK.join(', ')})`} * npTint;
        // Streuung je Horst: Helligkeit, jeder fünfte gelblicher
        vec3 npVar = (0.86 + 0.28 * npH2) * mix(vec3(1.0), vec3(1.1, 1.04, 0.8), step(0.8, npH3));
        // aPetal: 0 = Halm/Blatt (Bodenfarbe × relative Farbe), 1 = Blütenblatt (Palette je Instanz), 2 = feste Farbe
        vec3 npPetal = npH3 < 0.45 ? vec3(0.8, 0.8, 0.74) : npH3 < 0.75 ? vec3(0.95, 0.72, 0.1) : npH3 < 0.9 ? vec3(0.34, 0.2, 0.72) : vec3(0.9, 0.6, 0.74);
        vec3 npNear = aPetal < 0.5 ? color.rgb * npVar * uGrassK.x * npGround : aPetal < 1.5 ? npPetal * (0.85 + 0.25 * npH2) : color.rgb;
        vColor = mix(npNear, npGround * uGrassK.y, npCf);
      `)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), max(npCf, 0.2)));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      ${WIND_VERTEX}
        transformed.y *= npSf; transformed.xz *= mix(0.45, 1.0, npSf);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection; // Rückseite wie Vorderseite (dünne Halme, keine schwarzen Rückseiten)
      #endif`);
  };
  m.customProgramCacheKey = () => `np-gras-v3-${look ? 1 : 0}`;
  return m;
}
/** Halm-Helligkeit (× relative Vertexfarbe) und Fern-Helligkeit (Halme = Boden). */
const GRASS_K = { blade: 1.3, far: 0.95 };
/** Grundfarbe ohne Gelände-Material (linear, ≈ Mittel der Gras-Fotoscan-Albedo). */
const GRASS_FALLBACK = [0.16, 0.2, 0.07];
/** Sichtbare Grasdetails je Stufe (nur Optik): Blumen-Anteil je Zelle, Trabanten-Horste nah an der Kamera. */
const GRASS_LOOK = {
  low: { flowers: 0, near: 0 },
  medium: { flowers: 0.05, near: 1 },
  high: { flowers: 0.07, near: 3 },
  ultra: { flowers: 0.08, near: 3 },
};

function merge(geoms) {
  const parts = geoms.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.computeBoundingSphere();
  for (const g of [...geoms, ...parts]) g.dispose();
  return out;
}

/** Ferne Fichte: Kegel + Stammstumpf. lite (Stufe „niedrig“, zeigt seit dem Mehrspieler-Abgleich alle Bäume statt
 *  55 %): 5 statt 7 Kegelsegmente, dreiseitiger Stamm – 16 statt 22 Dreiecke je Baum. */
function farSpruce(lite = false) {
  const cone = new THREE.ConeGeometry(2.6, 9.4, lite ? 5 : 7, 1, true); cone.translate(0, 1.5 + 4.7, 0);
  const trunk = new THREE.CylinderGeometry(0.2, 0.25, 1.6, lite ? 3 : 4, 1, true); trunk.translate(0, 0.8, 0);
  return merge([cone, trunk]);
}
/** Ferner Laubbaum: abgeflachter Ikosaeder + Stamm (lite: dreiseitig). */
function farBroadleaf(lite = false) {
  const crown = new THREE.IcosahedronGeometry(2.9, 0); crown.scale(1, 0.82, 1); crown.translate(0, 5.0, 0);
  const trunk = new THREE.CylinderGeometry(0.2, 0.28, 3.2, lite ? 3 : 4, 1, true); trunk.translate(0, 1.6, 0);
  return merge([crown, trunk]);
}
/** Fels: verformter Ikosaeder. */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, r = rng(seed);
  const offs = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offs.has(key)) offs.set(key, 0.75 + r() * 0.45);
    const k = offs.get(key);
    p.setXYZ(i, p.getX(i) * k * 1.15, Math.max(-0.35, p.getY(i) * k * 0.62), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * @param {object} o { hf, spec (def.vegetation), quality, tier (TIERS-Eintrag), blocked(x, z) → bool, bounds (Spielfläche) }
 */
export class Vegetation {
  constructor(o) {
    this.hf = o.hf; this.spec = o.spec || {}; this.quality = o.quality; this.tier = o.tier;
    this.blocked = o.blocked || (() => false);
    this.bounds = o.bounds;
    this.fields = o.fields || [];
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.species = {};
    this.rocks = [];
    this.stats = { trees: 0, bushes: 0, rocks: 0, reeds: 0, grass: 0, flowers: 0, near: 0, far: 0 };
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this._lastGrass = new THREE.Vector3(1e9, 0, 1e9);
    this._place();
  }

  _add(kind, x, z, s, ry) {
    const sp = this.species[kind] || (this.species[kind] = { list: [] });
    sp.list.push(x, this.hf.heightAt(x, z) - 0.05, z, s, ry);
  }

  /** Deterministische Verteilung (Wälder, Randwald, Einzelbäume, Hecken, Büsche, Schilf, Felsen). */
  _place() {
    // dens: Platzierungsdichte – fest 1 (Kollision gleich auf allen Stufen); thin: Anteil der kollisionslosen
    // Büsche/Schilf, die die Stufe zeigt (wird erst nach der Platzierung angewandt, verbraucht keinen Zufall)
    const hf = this.hf, spec = this.spec, dens = 1, thin = this.tier.density ?? 1;
    const seed = spec.seed || 99;
    // je Abschnitt ein eigener Zufallsstrom: Änderungen an einem Abschnitt verschieben die übrigen nicht
    const r = rng(seed), noise = createSimplex(seed + 5);
    const n3 = { x: 0, y: 1, z: 0 };
    // Lesesteinmauern/Felsgruppen (werden erst unten gesetzt) freihalten: kein Baum in oder auf einer Mauer
    const rk0 = spec.rocks || {};
    const wallSegs = [];
    for (const w of rk0.walls || []) for (let k = 0; k + 1 < w.length; k++) wallSegs.push([w[k][0], w[k][1], w[k + 1][0], w[k + 1][1]]);
    const nearRocks = (x, z) => {
      for (const [ax, az, bx, bz] of wallSegs) {
        const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
        if (Math.hypot(x - ax - ex * t, z - az - ez * t) < 2.2) return true;
      }
      for (const [cx, cz, , rad] of rk0.clusters || []) if (Math.hypot(x - cx, z - cz) < rad + 2) return true;
      return false;
    };
    // Äcker/Stoppelfelder (gedrehte Rechtecke + 2 m Rand): keine Einzelbäume mitten im Feld
    const inField = (x, z) => this.fields.some(f => {
      const c = Math.cos(f.ry || 0), sn = Math.sin(f.ry || 0), dx = x - f.x, dz = z - f.z;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      return Math.abs(lx) < f.w / 2 + 2 && Math.abs(lz) < f.d / 2 + 2;
    });
    const okTree = (x, z) => {
      if (!hf.contains(x, z) || this.blocked(x, z) || nearRocks(x, z)) return false;
      const y = hf.heightAt(x, z);
      if (y < hf.waterY + 0.5) return false;
      return hf.normalAt(x, z, n3).y > 0.8;
    };
    const tree = (x, z, spruceShare, rr = r) => {
      if (!okTree(x, z)) return false;
      const kind = rr() < spruceShare ? 'fichte' : 'laub';
      this._add(kind, x, z, (kind === 'fichte' ? 0.75 : 0.85) + rr() * 0.55, rr() * Math.PI * 2);
      return true;
    };
    // Wälder (Kreise mit verrauschtem Rand)
    for (const f of spec.forests || []) {
      const step = f.step ?? 5.2;
      for (let z = f.z - f.r; z <= f.z + f.r; z += step) for (let x = f.x - f.r; x <= f.x + f.r; x += step) {
        const jx = x + (r() - 0.5) * step * 0.9, jz = z + (r() - 0.5) * step * 0.9;
        const d = Math.hypot(jx - f.x, jz - f.z) / f.r + noise(jx / 30, jz / 30) * 0.22;
        if (d > 1) continue;
        const p = (f.density ?? 0.7) * dens * (1 - smoothstep(0.75, 1, d) * 0.6);
        if (r() > p) { if (d > 0.7 && r() < 0.35 * dens && okTree(jx, jz)) this._add('busch', jx, jz, 0.8 + r() * 0.6, r() * 6.28); continue; }
        tree(jx, jz, f.spruce ?? 0.6);
      }
    }
    // Randwald hinter der Spielfläche (Rahmen, verdeckt den Horizont)
    const ring = spec.ring;
    if (ring) {
      const rr = rng(seed * 3 + 1), b = this.bounds, step = ring.step ?? 6.5;
      for (let z = hf.minZ + 4; z < hf.maxZ - 4; z += step) for (let x = hf.minX + 4; x < hf.maxX - 4; x += step) {
        const out = Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
        if (out < (ring.inset ?? -6)) continue;
        const jx = x + (rr() - 0.5) * step, jz = z + (rr() - 0.5) * step;
        const p = (ring.density ?? 0.6) * dens * (0.55 + 0.45 * smoothstep(-0.3, 0.4, noise(jx / 55, jz / 55)));
        if (rr() < p) tree(jx, jz, ring.spruce ?? 0.75, rr);
      }
    }
    // Wiesenbäume: natürliche Feldgehölze (3–7 Bäume eng beieinander, Büsche am Rand) und wenige Solitärbäume statt
    // gleichmäßiger Streuung – ähnliche Baumzahl, aber offene Sichtachsen zwischen dichten Deckungsinseln; nie auf
    // Äckern, Straßen, Mauern, Spawns
    const sc = spec.scatter;
    if (sc) {
      const rs = rng(seed * 7 + 13), b = this.bounds, count = (sc.count ?? 120) * dens;
      const groups = Math.round(sc.groups ?? count / 10), solo = Math.round(sc.solo ?? count * 0.12);
      const okWiese = (x, z) => !inField(x, z) && okTree(x, z);
      for (let g = 0, tries = 0; g < groups && tries < groups * 25; tries++) {
        const cx = b.minX + 25 + rs() * (b.maxX - b.minX - 50), cz = b.minZ + 25 + rs() * (b.maxZ - b.minZ - 50);
        if (noise(cx / 70, cz / 70) < 0.05 || !okWiese(cx, cz)) continue;
        g++;
        const n = 3 + Math.floor(rs() * 5), rad = 3.5 + rs() * 4.5, share = rs() < 0.3 ? 0.55 : 0.15;
        for (let k = 0; k < n; k++) {
          const a = rs() * 6.283, d = Math.sqrt(rs()) * rad, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
          if (okWiese(x, z)) tree(x, z, share, rs);
        }
        for (let k = 0; k < 4; k++) {
          const a = rs() * 6.283, d = rad + 0.5 + rs() * 2.5, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, sz = 0.8 + rs() * 0.6, ry = rs() * 6.28;
          if (okWiese(x, z)) this._add('busch', x, z, sz, ry);
        }
      }
      for (let k = 0, made = 0; k < solo * 20 && made < solo; k++) {
        const x = b.minX + rs() * (b.maxX - b.minX), z = b.minZ + rs() * (b.maxZ - b.minZ);
        if (noise(x / 70, z / 70) < 0.1 || !okWiese(x, z)) continue;
        if (tree(x, z, 0.2, rs)) made++;
      }
    }
    // Hecken/Baumreihen entlang Linien
    const rh = rng(seed * 11 + 3);
    for (const h of spec.hedges || []) {
      const pts = h.pts;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d < L; d += h.step ?? 3) {
          const t = d / L, x = ax + (bx - ax) * t + (rh() - 0.5) * 1.2, z = az + (bz - az) * t + (rh() - 0.5) * 1.2;
          if (!okTree(x, z)) continue;
          if (h.trees && rh() < h.trees) this._add(rh() < 0.3 ? 'fichte' : 'laub', x, z, 0.75 + rh() * 0.4, rh() * 6.28);
          else this._add('busch', x, z, 0.9 + rh() * 0.7, rh() * 6.28);
        }
      }
    }
    // Schilf am Ufer
    if (spec.reeds && hf.riverLine) {
      const rq = rng(seed * 13 + 5);
      const line = hf.riverLine;
      for (let k = 0; k < line.length - 1; k++) {
        const [ax, az] = line[k], [bx, bz] = line[k + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
        for (let m = 0; m < 3 * dens; m++) {
          const t = rq(), side = rq() < 0.5 ? -1 : 1, off = (spec.reeds.offset ?? 8.5) + (rq() - 0.5) * 4;
          const x = ax + (bx - ax) * t + nx * off * side, z = az + (bz - az) * t + nz * off * side;
          if (!hf.contains(x, z) || this.blocked(x, z)) continue;
          const y = hf.heightAt(x, z);
          if (y < hf.waterY - 0.25 || y > hf.waterY + 0.9) continue;
          this._add('schilf', x, z, 0.8 + rq() * 0.6, rq() * 6.28);
        }
      }
    }
    // Felsen (steile Hänge, Kuppen) – Kollision + Deckung
    const rk = spec.rocks;
    if (rk) {
      const rr = rng(seed * 17 + 7);
      const b = this.bounds;
      for (let k = 0, made = 0; k < (rk.count ?? 100) * 12 && made < (rk.count ?? 100); k++) {
        const x = b.minX - 30 + rr() * (b.maxX - b.minX + 60), z = b.minZ - 30 + rr() * (b.maxZ - b.minZ + 60);
        if (!hf.contains(x, z) || this.blocked(x, z)) continue;
        const ny = hf.normalAt(x, z, n3).y;
        if (ny > 0.95 && rr() > 0.12) continue;
        if (hf.heightAt(x, z) < hf.waterY + 0.3) continue;
        this.rocks.push({ x, y: hf.heightAt(x, z) - 0.25, z, s: 0.6 + rr() * rr() * 2.2, ry: rr() * 6.28, v: k % 3 });
        made++;
      }
      for (const p of rk.extra || []) this.rocks.push({ x: p[0], y: hf.heightAt(p[0], p[1]) - 0.3, z: p[1], s: p[2] ?? 1.5, ry: rr() * 6.28, v: 0 });
      // maps-expand: Deckung im offenen Gelände – Lesesteinmauern (flache, gestreckte Felsen entlang Linien, ≈ 0,6–0,95 m
      // hoch = Hockdeckung) und Felsgruppen; nur auf trockenem, flachem, freiem Boden (nicht in Orten/Straßen/Flaggen)
      const okRock = (x, z) => hf.contains(x, z) && !this.blocked(x, z) && hf.heightAt(x, z) > hf.waterY + 0.3 && hf.normalAt(x, z, n3).y > 0.85;
      for (const w of rk.walls || []) {
        for (let k = 0; k < w.length - 1; k++) {
          const [ax, az] = w[k], [bx, bz] = w[k + 1], L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
          for (let d = 0.9; d < L; d += 1.9) {
            const t = d / L, x = ax + (bx - ax) * t + (rr() - 0.5) * 0.3, z = az + (bz - az) * t + (rr() - 0.5) * 0.3;
            const sx = 0.95 + rr() * 0.25, sy = 1.45 + rr() * 0.35, sz = 0.5 + rr() * 0.12, ry = yaw + (rr() - 0.5) * 0.25, v = (k + Math.round(d)) % 3;
            if (!okRock(x, z)) continue;
            this.rocks.push({ x, y: hf.heightAt(x, z) - 0.2, z, s: 1, sx, sy, sz, ry, v });
          }
        }
      }
      for (const [cx, cz, n, rad] of rk.clusters || []) {
        for (let k = 0; k < n; k++) {
          const a = rr() * 6.28, d = rr() * rad, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, s = 0.85 + rr() * 0.8, ry = rr() * 6.28;
          if (!okRock(x, z)) continue;
          this.rocks.push({ x, y: hf.heightAt(x, z) - 0.25, z, s, ry, v: k % 3 });
        }
      }
    }
    // Kollisionslose Arten je Stufe ausdünnen (Positions-Hash: dieselben Büsche fallen auf jedem Rechner weg)
    if (thin < 1) {
      for (const kind of ['busch', 'schilf']) {
        const sp = this.species[kind];
        if (!sp) continue;
        const L = sp.list, keep = [];
        for (let i = 0; i < L.length; i += 5) {
          if (hash2(Math.round(L[i] * 10), Math.round(L[i + 2] * 10), 29) < thin) keep.push(L[i], L[i + 1], L[i + 2], L[i + 3], L[i + 4]);
        }
        sp.list = keep;
      }
    }
    // Matrizen vorberechnen
    for (const [kind, sp] of Object.entries(this.species)) {
      const L = sp.list, n = L.length / 5;
      sp.count = n;
      sp.mats = new Float32Array(n * 16);
      sp.cols = new Float32Array(n * 3);
      const tints = TINTS[kind];
      for (let i = 0; i < n; i++) {
        _q.setFromAxisAngle(_up, L[i * 5 + 4]); _s.setScalar(L[i * 5 + 3]); _p.set(L[i * 5], L[i * 5 + 1], L[i * 5 + 2]);
        _m.compose(_p, _q, _s); _m.toArray(sp.mats, i * 16);
        _c.set(tints[(hash2(i, n, 3) * tints.length) | 0]).multiplyScalar(0.92 + hash2(i, 7) * 0.16).toArray(sp.cols, i * 3);
      }
    }
    this.stats.trees = (this.species.fichte?.count || 0) + (this.species.laub?.count || 0);
    this.stats.bushes = this.species.busch?.count || 0;
    this.stats.reeds = this.species.schilf?.count || 0;
    this.stats.rocks = this.rocks.length;
  }

  /**
   * Kollisions-/Kugel-Dreiecke: Stämme (Sechskant-Prismen) innerhalb der Spielfläche + 30 m und alle Felsen.
   * → { col: Float32Array, bullet: Float32Array }
   */
  colliders() {
    const out = [];
    const b = this.bounds;
    const prism = (x, y, z, r, h) => {
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
        out.push(x0, y, z0, x1, y, z1, x1, y + h, z1, x0, y, z0, x1, y + h, z1, x0, y + h, z0);
      }
    };
    for (const kind of ['fichte', 'laub']) {
      const sp = this.species[kind];
      if (!sp) continue;
      for (let i = 0; i < sp.count; i++) {
        const x = sp.list[i * 5], y = sp.list[i * 5 + 1], z = sp.list[i * 5 + 2], s = sp.list[i * 5 + 3];
        if (x < b.minX - 30 || x > b.maxX + 30 || z < b.minZ - 30 || z > b.maxZ + 30) continue;
        prism(x, y - 0.3, z, (kind === 'fichte' ? 0.2 : 0.24) * s, 3.4 * s);
      }
    }
    for (const rk of this.rocks) {
      const g = this._rockGeoms ? this._rockGeoms[rk.v] : (this._rockGeoms = [rockGeometry(11), rockGeometry(23), rockGeometry(37)])[rk.v];
      const p = g.index ? g.toNonIndexed().attributes.position : g.attributes.position;
      _q.setFromAxisAngle(_up, rk.ry); _s.set(rk.sx ?? rk.s, rk.sy ?? rk.s, rk.sz ?? rk.s); _p.set(rk.x, rk.y, rk.z); _m.compose(_p, _q, _s);
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(_m); out.push(v.x, v.y, v.z); }
    }
    const arr = new Float32Array(out);
    return { col: arr, bullet: arr };
  }

  /** Meshes anlegen (Laub-Material aus atlas.js, Stämme/Felsen aus engine/textures.js). */
  build(getMaterial) {
    const q = this.quality, t = this.tier;
    setFoliageQuality(q);
    const proto = (kind) => createFoliage([{ kind, x: 0, y: 0, z: 0, s: 1, ry: 0 }], q).meshes[0];
    const make = (geom, mat, n, name, cast) => {
      const m = new THREE.InstancedMesh(geom, mat, Math.max(1, n));
      m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const tp = proto('tree'), bp = proto('bush'), rp = proto('reeds'), gp = proto('grass');
    this._protos = [tp, bp, rp, gp];
    const foliageMat = tp.material, foliageMatN = gp.material;
    const farMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    farMat.name = 'vegetation-far'; farMat.userData.disposable = true; farMat.userData.surface = 'wood';
    farMat.color.setRGB(0.46, 0.5, 0.44); // Instanzfarben sind für das Laub-Atlas gedacht → einfarbige Ferne dunkler
    const bark = getMaterial('bark');
    this._own = [farMat];
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3.4, 7, 1, true); trunkGeo.translate(0, 1.7, 0);
    const spruceGeo = spruceGeometry();
    this._geoms = [trunkGeo, spruceGeo];
    const sp = this.species;
    const nearCap = (kind) => Math.min(sp[kind]?.count || 0, kind === 'busch' ? 3000 : 2400);
    if (sp.fichte) {
      sp.fichte.near = make(spruceGeo, foliageMat, nearCap('fichte'), 'veg-fichte', t.treeShadow);
      const fg = farSpruce(q === 'low'); this._geoms.push(fg);
      sp.fichte.far = make(fg, farMat, sp.fichte.count, 'veg-fichte-fern', false);
    }
    if (sp.laub) {
      sp.laub.near = make(tp.geometry, foliageMat, nearCap('laub'), 'veg-laub', t.treeShadow);
      const fg = farBroadleaf(q === 'low'); this._geoms.push(fg);
      sp.laub.far = make(fg, farMat, sp.laub.count, 'veg-laub-fern', false);
    }
    const trunkCap = nearCap('fichte') + nearCap('laub');
    this.trunks = trunkCap ? make(trunkGeo, bark, trunkCap, 'veg-staemme', t.treeShadow) : null;
    if (sp.busch) sp.busch.near = make(bp.geometry, foliageMat, nearCap('busch'), 'veg-busch', false);
    if (sp.schilf) sp.schilf.near = make(rp.geometry, foliageMatN, sp.schilf.count, 'veg-schilf', false);
    // Felsen: statisch, ein InstancedMesh je Variante
    if (this.rocks.length) {
      const rockMat = getMaterial('concrete_dark');
      this._rockGeoms = this._rockGeoms || [rockGeometry(11), rockGeometry(23), rockGeometry(37)];
      for (let v = 0; v < 3; v++) {
        const list = this.rocks.filter(r => r.v === v);
        if (!list.length) continue;
        const m = new THREE.InstancedMesh(this._rockGeoms[v], rockMat, list.length);
        list.forEach((rk, i) => {
          _q.setFromAxisAngle(_up, rk.ry); _s.set(rk.sx ?? rk.s, rk.sy ?? rk.s, rk.sz ?? rk.s); _p.set(rk.x, rk.y, rk.z); _m.compose(_p, _q, _s); m.setMatrixAt(i, _m);
          m.setColorAt(i, _c.set('#a39a8c').multiplyScalar(0.8 + hash2(i, v) * 0.3));
        });
        m.name = 'veg-felsen'; m.castShadow = q !== 'low'; m.receiveShadow = true;
        m.computeBoundingSphere();
        this.group.add(m);
      }
    }
    // Grasring (eigene Halme statt Laub-Atlas: liest sich auf Wiesen besser und braucht keinen Alpha-Test)
    if (t.grass > 0) {
      const R = t.grass, look = GRASS_LOOK[q] || GRASS_LOOK.high;
      // gl-ground: Farbe ab 40 % des Radius zum Boden, Höhe ab 62 % weich auf 0 (Rand je Horst ±10 % versetzt)
      const gm = grassMaterial([R * 0.4, R * 0.82, R * 0.62, R * 0.95]);
      const gg = grassGeometry(t.grassBlades || 0);
      this._geoms.push(gg); this._own.push(gm);
      this.grass = make(gg, gm, t.grassCap, 'veg-gras', false);
      // Wiesenblumen/Klee/Rispen (medium+): eigenes InstancedMesh mit demselben Material (+1 Draw Call)
      if (look.flowers > 0) {
        const fg = flowerGeometry(); this._geoms.push(fg);
        this.flowers = make(fg, gm, Math.ceil(t.grassCap * look.flowers * 2), 'veg-blumen', false);
      }
    }
    return this.group;
  }

  /** Nah/Fern-Zuordnung neu schreiben, wenn sich die Kamera ≥ 4 m bewegt hat; Grasring ab 1,5 m. */
  update(camera, force = false) {
    const p = camera.position, t = this.tier;
    if (force || this._last.distanceToSquared(p) > 16) {
      this._last.copy(p);
      const near2 = t.treeNear * t.treeNear, far2 = t.treeFar * t.treeFar, bush2 = (t.treeNear * 0.6) ** 2, reed2 = (t.treeNear * 0.5) ** 2;
      let trunkN = 0, nearAll = 0, farAll = 0;
      for (const [kind, sp] of Object.entries(this.species)) {
        if (!sp.near && !sp.far) continue;
        let nn = 0, nf = 0;
        const L = sp.list, nearCap = sp.near ? sp.near.instanceMatrix.count : 0;
        const lim2 = kind === 'busch' ? bush2 : kind === 'schilf' ? reed2 : near2;
        for (let i = 0; i < sp.count; i++) {
          const dx = L[i * 5] - p.x, dz = L[i * 5 + 2] - p.z, d2 = dx * dx + dz * dz;
          if (d2 < lim2 && nn < nearCap) {
            sp.near.instanceMatrix.array.set(sp.mats.subarray(i * 16, i * 16 + 16), nn * 16);
            sp.near.instanceColor.array.set(sp.cols.subarray(i * 3, i * 3 + 3), nn * 3);
            nn++;
            if (this.trunks && (kind === 'fichte' || kind === 'laub') && trunkN < this.trunks.instanceMatrix.count) {
              this.trunks.instanceMatrix.array.set(sp.mats.subarray(i * 16, i * 16 + 16), trunkN * 16);
              this.trunks.instanceColor.array.set(TRUNK_COL[kind], trunkN * 3);
              trunkN++;
            }
          } else if (sp.far && d2 < far2) {
            sp.far.instanceMatrix.array.set(sp.mats.subarray(i * 16, i * 16 + 16), nf * 16);
            sp.far.instanceColor.array.set(sp.cols.subarray(i * 3, i * 3 + 3), nf * 3);
            nf++;
          }
        }
        for (const [mesh, c] of [[sp.near, nn], [sp.far, nf]]) {
          if (!mesh) continue;
          mesh.count = c; mesh.visible = c > 0;
          if (c) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, c * 16); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, c * 3); mesh.instanceColor.needsUpdate = true; }
        }
        nearAll += nn; farAll += nf;
      }
      if (this.trunks) {
        const tm = this.trunks; tm.count = trunkN; tm.visible = trunkN > 0;
        if (trunkN) { tm.instanceMatrix.clearUpdateRanges(); tm.instanceMatrix.addUpdateRange(0, trunkN * 16); tm.instanceMatrix.needsUpdate = true; tm.instanceColor.clearUpdateRanges(); tm.instanceColor.addUpdateRange(0, trunkN * 3); tm.instanceColor.needsUpdate = true; }
      }
      this.stats.near = nearAll; this.stats.far = farAll;
    }
    if (this.grass && (force || this._lastGrass.distanceToSquared(p) > 2.25)) {
      this._lastGrass.copy(p);
      const t0 = performance.now();
      this._updateGrass(p);
      this.stats.grassMs = Math.round((performance.now() - t0) * 100) / 100; // Diagnose: CPU je Neuaufbau
    }
  }

  /** Felsen-Raster (4 m) für das Gras: kein Halm in einem Felsen (nur lesend – Felsen/Kollision unverändert). */
  _underRock(x, z) {
    let G = this._rockGrid;
    if (!G) {
      G = this._rockGrid = new Map();
      for (const rk of this.rocks) {
        // Ikosaeder-Radius ≤ 1,2 · 1,15 (x) bzw. 1,2 (z) × Maßstab, um ry gedreht → Kreis
        const r = 1.2 * Math.max((rk.sx ?? rk.s) * 1.15, rk.sz ?? rk.s);
        for (let j = Math.floor((rk.z - r) / 4); j <= Math.floor((rk.z + r) / 4); j++) for (let i = Math.floor((rk.x - r) / 4); i <= Math.floor((rk.x + r) / 4); i++) {
          const key = (i + 2048) * 4096 + (j + 2048);
          let L = G.get(key);
          if (!L) G.set(key, L = []);
          L.push(rk.x, rk.z, r * r);
        }
      }
    }
    const L = G.get((Math.floor(x / 4) + 2048) * 4096 + (Math.floor(z / 4) + 2048));
    if (!L) return false;
    for (let k = 0; k < L.length; k += 3) { const dx = x - L[k], dz = z - L[k + 1]; if (dx * dx + dz * dz < L[k + 2]) return true; }
    return false;
  }

  /**
   * Grasring um die Kamera (gl-ground): Horste auf einem gejitterten Zellraster, ausgedünnt nach einem Dichtefeld
   * (Wiesenflecken dicht und hoch, dazwischen lückig und kurz), nach Grasanteil der Splat-Karte (dünner und kürzer zu
   * Wegen hin), Hangneigung (kürzer) und Felsen (frei). Farbe je Horst = Wiesenfarbe des Bodens (splat.js
   * meadowTintAt); Ausblenden übernimmt der Shader (uGrassFade). Nah an der Kamera Trabanten-Horste (Gruppen), dazu
   * spärliche Blumen in Flecken. Alles aus Positions-Hashes – kein Zufallsstrom, nichts mit Kollision.
   */
  _updateGrass(p) {
    const hf = this.hf, t = this.tier, R = t.grass, st = t.grassStep, g = this.grass, cap = g.instanceMatrix.count;
    const look = GRASS_LOOK[this.quality] || GRASS_LOOK.high;
    const fl = this.flowers || null, fcap = fl ? fl.instanceMatrix.count : 0;
    const y0 = hf.heightAt(p.x, p.z);
    if (p.y - y0 > R * 1.5) {
      g.count = 0; g.visible = false; this.stats.grass = 0;
      if (fl) { fl.count = 0; fl.visible = false; this.stats.flowers = 0; }
      return;
    }
    const i0 = Math.floor((p.x - R) / st), i1 = Math.floor((p.x + R) / st), j0 = Math.floor((p.z - R) / st), j1 = Math.floor((p.z + R) / st);
    const L = [0, 0, 0, 0, 0], N2 = [0, 0], N3 = [0, 0], T = [1, 1, 1], nrm = { x: 0, y: 1, z: 0 };
    const R2 = R * R, nearR = t.grassNear || R * 0.35, nearR2 = nearR * nearR, flR2 = (R * 0.8) ** 2, wy = hf.waterY + 0.1;
    let k = 0, f = 0;
    const arr = g.instanceMatrix.array, col = g.instanceColor.array;
    const put = (A, Cc, n, x, y, z, s, h, ry) => {
      _q.setFromAxisAngle(_up, ry); _s.set(s, h, s); _p.set(x, y, z);
      _m.compose(_p, _q, _s); _m.toArray(A, n * 16);
      Cc[n * 3] = T[0]; Cc[n * 3 + 1] = T[1]; Cc[n * 3 + 2] = T[2];
    };
    for (let j = j0; j <= j1 && k < cap; j++) for (let i = i0; i <= i1 && k < cap; i++) {
      const x = (i + hash2(i, j, 1)) * st, z = (j + hash2(i, j, 2)) * st;
      const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      if (!hf.contains(x, z) || this.blocked(x, z) || hf.maskAt(x, z)) continue;
      hf.layersAt(x, z, L);
      const g0 = L[0];
      if (g0 < 0.3) continue;
      const y = hf.heightAt(x, z);
      if (y < wy) continue;
      // Dichtefeld (≈ 1–9 m und 0,2–1,5 m): dichte, hohe Flecken und lückige, kurze Stellen
      terrainNoise(x, z, 2, N2); terrainNoise(x, z, 3, N3);
      const dens = N2[0] * 0.65 + N3[0] * 0.35, gw = smoothstep(0.3, 0.8, g0);
      if (hash2(i, j, 7) > gw * (0.25 + 0.95 * dens)) continue;
      if (this._underRock(x, z)) continue;
      const slope = 1 - hf.normalAt(x, z, nrm).y;
      const hgt = (0.55 + 0.75 * dens) * (0.75 + 0.5 * hash2(i, j, 5)) * Math.max(0.45, 1 - slope * 2) * (0.55 + 0.45 * gw);
      const s = (0.8 + 0.4 * hash2(i, j, 3)) * (0.75 + 0.25 * gw);
      meadowTintAt(x, z, y, slope * 1.4, T);
      put(arr, col, k++, x, y - 0.03, z, s, s * hgt, hash2(i, j, 4) * 6.283);
      // Trabanten nah an der Kamera: einer dicht daneben (Horstgruppe), weitere über die Zelle – nur im dichten Teil
      if (look.near && d2 < nearR2) {
        for (let e = 0; e < look.near && k < cap; e++) {
          if (hash2(i, j, 11 + e) > 0.3 + dens * 0.8) continue;
          const sp = e === 0 ? 0.55 : 1.3;
          const ex = x + (hash2(i, j, 21 + e) - 0.5) * st * sp, ez = z + (hash2(i, j, 41 + e) - 0.5) * st * sp;
          if (this.blocked(ex, ez) || hf.maskAt(ex, ez) || this._underRock(ex, ez)) continue;
          const es = s * (0.55 + 0.4 * hash2(i, j, 31 + e));
          put(arr, col, k++, ex, hf.heightAt(ex, ez) - 0.03, ez, es, es * hgt * (0.7 + 0.5 * hash2(i, j, 51 + e)), hash2(i, j, 61 + e) * 6.283);
        }
      }
      // Wiesenblumen: spärlich, in Flecken, nur auf vollem Gras
      if (fl && f < fcap && g0 > 0.7 && d2 < flR2 && hash2(i, j, 9) < look.flowers * 2.2 * smoothstep(0.55, 0.85, N2[1])) {
        const fx = x + (hash2(i, j, 13) - 0.5) * st * 0.8, fz = z + (hash2(i, j, 14) - 0.5) * st * 0.8;
        if (!this.blocked(fx, fz) && !this._underRock(fx, fz)) {
          const fs = 0.8 + 0.45 * hash2(i, j, 15);
          put(fl.instanceMatrix.array, fl.instanceColor.array, f++, fx, hf.heightAt(fx, fz) - 0.02, fz, fs, fs * (0.8 + 0.4 * dens), hash2(i, j, 16) * 6.283);
        }
      }
    }
    for (const [mesh, n] of [[g, k], [fl, f]]) {
      if (!mesh) continue;
      mesh.count = n; mesh.visible = n > 0;
      if (n) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, n * 3); mesh.instanceColor.needsUpdate = true; }
    }
    this.stats.grass = k;
    this.stats.flowers = f;
  }

  dispose() {
    for (const g of this._geoms || []) g.dispose();
    for (const g of this._rockGeoms || []) g.dispose();
    for (const m of this._own || []) m.dispose();
    for (const p of this._protos || []) p.geometry.dispose();
    this.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
}

const TINTS = {
  fichte: ['#56705a', '#4d6a55', '#5e7a5c', '#4a6350'],
  laub: ['#8ea866', '#7f9c5c', '#a0b070', '#93a35e'],
  busch: ['#87a06a', '#9fb27a', '#7c955f'],
  schilf: ['#c2bc88', '#aab07a', '#b8b880'],
};
const TRUNK_COL = { fichte: new Float32Array([0.62, 0.55, 0.5]), laub: new Float32Array([0.85, 0.8, 0.72]) };
