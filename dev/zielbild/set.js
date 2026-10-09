// Zielbild – Kulisse: Hafenhof mit Containern, Containerbrücke, Asphalt, Wasser, Ferne, Himmel.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintedSteel, asphaltTile, yardMap, waterNormal, rng, fbm, vn } from './tex.js';

/* ------------------------------------------------------------------ Geometrie-Helfer */
/** Quader mit Meter-UVs (jede Seite 1 UV = 1 m). */
export function mbox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  return g;
}
/** Träger zwischen zwei Punkten (Querschnitt w × h). */
export function beamGeo(a, b, w, h) {
  const len = a.distanceTo(b);
  const g = mbox(w, h, len);
  const m = new THREE.Matrix4();
  const dir = b.clone().sub(a).normalize();
  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  m.lookAt(new THREE.Vector3(), dir, up);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  // lookAt richtet +Z auf -dir aus → Länge liegt entlang Z: passt
  g.applyMatrix4(m);
  return g;
}
/**
 * Trapez-Wellblech in der XY-Ebene (x 0…len, y 0…hgt), Wellen nach +Z (Tiefe dep), Teilung pitch.
 * UV: u = (x + u0) / uW, v = y / uH.
 */
export function corrPanel(len, hgt, pitch, dep, uW, uH, u0 = 0, seg = 14) {
  const n = Math.max(2, Math.ceil(len / pitch * seg));
  const pos = [], nor = [], uv = [], idx = [];
  const prof = (x) => {
    const t = x / pitch * Math.PI * 2;
    const c = Math.cos(t) * 1.6;
    const s = Math.max(-1, Math.min(1, c));
    const dz = Math.abs(c) < 1 ? -1.6 * Math.sin(t) * (Math.PI * 2 / pitch) * dep * 0.5 : 0;
    return [dep * (s * 0.5 + 0.5), dz];
  };
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * len;
    const [z, dz] = prof(x);
    const nl = Math.hypot(dz, 1);
    for (let j = 0; j < 2; j++) {
      pos.push(x, j * hgt, z); nor.push(-dz / nl, 0, 1 / nl); uv.push((x + u0) / uW, (j * hgt) / uH);
    }
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ------------------------------------------------------------------ Materialien */
export function steelMat(set, { repeat = null, color = 0xffffff } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color, map: set.map, normalMap: set.normal, roughnessMap: set.orm, metalnessMap: set.orm, aoMap: set.orm,
    roughness: 1, metalness: 1, aoMapIntensity: 1, normalScale: new THREE.Vector2(1, 1),
  });
  if (repeat) for (const t of [set.map, set.normal, set.orm]) t.repeat.set(repeat, repeat);
  return m;
}

/* ------------------------------------------------------------------ Container */
const CW = 2.438, CH = 2.591;
const skinCache = new Map();
function containerSkins(color, seed, L, ppm, age) {
  const key = `${color}:${seed}:${L}:${ppm}:${age}`;
  if (skinCache.has(key)) return skinCache.get(key);
  const code = ['NLPU', 'KRGU', 'HAFU', 'TGHU', 'MSBU'][seed % 5] + ' ' + String(100000 + ((seed * 7919) % 899999)) + ' ' + (seed % 10);
  const side = paintedSteel({ W: L, H: CH, ppm, color, seed, kind: 'side', pitch: 0.278, age, code, iso: L > 7 ? '45G1' : '22G1' });
  const end = paintedSteel({ W: CW, H: CH, ppm: Math.min(320, ppm * 1.5), color, seed: seed + 11, kind: 'end', pitch: 0.46, age, code, iso: L > 7 ? '45G1' : '22G1' });
  const frame = paintedSteel({ W: 1.5, H: 1.5, ppm: Math.min(240, ppm), color, seed: seed + 5, kind: 'frame', age: age + 0.15, tile: true });
  const s = { side: steelMat(side), end: steelMat(end), frame: steelMat(frame, { repeat: 1 / 1.5 }) };
  skinCache.set(key, s);
  return s;
}

/** Container (Länge entlang +X, Türen am +X-Ende), Boden y = 0. */
export function container({ L = 12.192, color = '#a33a22', seed = 1, ppm = 200, age = 0.5, doors = true, simple = false }) {
  const g = new THREE.Group();
  const S = containerSkins(color, seed, L, ppm, age);
  const dep = 0.036, inset = 0.0;
  const hw = CW / 2;
  // Seitenwände (Wellblech)
  const sideGeo = corrPanel(L - 0.24, CH - 0.26, 0.278, dep, L, CH, 0.12, simple ? 6 : 14);
  sideGeo.translate(-L / 2 + 0.12, 0.13, 0);
  // UV-v auf Gesamthöhe beziehen
  { const uv = sideGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * ((CH - 0.26) / CH) + 0.13 / CH); }
  const s1 = new THREE.Mesh(sideGeo, S.side); s1.position.z = hw - dep - inset; g.add(s1);
  const s2 = new THREE.Mesh(sideGeo, S.side); s2.rotation.y = Math.PI; s2.position.z = -hw + dep + inset; g.add(s2);
  // Stirnwand / Türen
  const endGeo = corrPanel(CW - 0.2, CH - 0.36, 0.46, 0.03, CW, CH, 0.1, simple ? 6 : 12);
  endGeo.translate(-hw + 0.1, 0.18, 0);
  { const uv = endGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * ((CH - 0.36) / CH) + 0.18 / CH); }
  const e1 = new THREE.Mesh(endGeo, S.end); e1.rotation.y = Math.PI / 2; e1.position.x = L / 2 - 0.05; g.add(e1);
  const e2 = new THREE.Mesh(endGeo, S.end); e2.rotation.y = -Math.PI / 2; e2.position.x = -L / 2 + 0.05; g.add(e2);
  // Rahmen
  const fr = [];
  const add = (geo, x, y, z) => { geo.translate(x, y, z); fr.push(geo); };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(mbox(0.16, CH, 0.16), sx * (L / 2 - 0.08), CH / 2, sz * (hw - 0.08)); // Eckpfosten
    for (const y of [0.06, CH - 0.06]) add(mbox(0.18, 0.12, 0.17), sx * (L / 2 - 0.09), y, sz * (hw - 0.085)); // Eckbeschläge
  }
  for (const sz of [-1, 1]) {
    add(mbox(L - 0.3, 0.13, 0.1), 0, CH - 0.065, sz * (hw - 0.05));
    add(mbox(L - 0.3, 0.17, 0.12), 0, 0.085, sz * (hw - 0.06));
  }
  for (const sx of [-1, 1]) { add(mbox(0.12, 0.2, CW - 0.3), sx * (L / 2 - 0.06), CH - 0.1, 0); add(mbox(0.12, 0.22, CW - 0.3), sx * (L / 2 - 0.06), 0.11, 0); }
  add(mbox(L - 0.2, 0.03, CW - 0.12), 0, CH - 0.03, 0); // Dach
  if (doors && !simple) {
    const x = L / 2 + 0.005;
    for (const z of [-0.95, -0.42, 0.42, 0.95]) {
      const rod = new THREE.CylinderGeometry(0.016, 0.016, CH - 0.25, 10); add(rod, x + 0.03, CH / 2, z);
      for (const y of [0.2, CH - 0.2]) add(mbox(0.05, 0.08, 0.07), x + 0.02, y, z); // Nockenhalter
      const h = mbox(0.03, 0.03, 0.34); h.rotateY(0.0); add(h, x + 0.05, 1.05 + (z > 0 ? 0.08 : 0), z + (z > 0 ? -0.17 : 0.17)); // Griff
      for (const y of [0.5, 1.0, 1.6, 2.1]) add(mbox(0.03, 0.04, 0.05), x + 0.025, y, z); // Führungen
    }
    for (const sz of [-1, 1]) for (const y of [0.45, 1.05, 1.6, 2.2]) add(mbox(0.07, 0.12, 0.1), x + 0.02, y, sz * (hw - 0.14)); // Scharniere
    add(mbox(0.02, CH - 0.36, 0.012), x + 0.01, CH / 2, 0); // Türspalt-Leiste
  }
  const frame = new THREE.Mesh(mergeGeometries(fr), S.frame);
  g.add(frame);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* ------------------------------------------------------------------ Boden */
export function ground(env) {
  const A = asphaltTile(1024, 4);
  const rect = [-34, -104, 34, 8];
  const yard = yardMap(rect, 2048, {
    puddles: [{ x: 0.2, z: -8.6, rx: 2.4, rz: 1.25 }, { x: -2.6, z: -19.5, rx: 1.6, rz: 0.75 }, { x: 4.2, z: -31, rx: 2.2, rz: 0.9 }, { x: -9, z: -26, rx: 1.4, rz: 0.6 }],
    lines: [
      { ax: -3.0, az: -1, bx: -3.0, bz: -100, wd: 0.075, yellow: true },
      { ax: -2.8, az: -1, bx: -2.8, bz: -100, wd: 0.075, yellow: true },
      { ax: 1.7, az: 6, bx: 1.7, bz: -100, wd: 0.07, dash: 2.0 },
      { ax: -3.2, az: -20.5, bx: 2.3, bz: -20.5, wd: 0.15 },
      { ax: 8.6, az: -20, bx: 8.6, bz: -100, wd: 0.07 },
      { ax: -18, az: -24, bx: -6, bz: -24, wd: 0.07 },
    ],
  });
  const mat = new THREE.MeshStandardMaterial({ map: A.map, normalMap: A.normal, roughnessMap: A.orm, aoMap: A.orm, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.2, 1.2) });
  const U = { tYard: { value: yard }, uRect: { value: new THREE.Vector4(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]) }, tRefl: env.refl, uRes: env.res };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWP; uniform sampler2D tYard; uniform vec4 uRect; uniform sampler2D tRefl; uniform vec2 uRes;
vec4 Y; float wetE;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      Y = texture2D(tYard, (vWP.xz - uRect.xy) / uRect.zw);
      { float macro = texture2D(map, vWP.xz * 0.0137).g * 2.2 + texture2D(map, vWP.xz * 0.0031 + 0.3).r * 1.6;
        diffuseColor.rgb *= 0.62 + 0.55 * clamp(macro, 0.0, 1.2);
        vec3 pc = mix(vec3(0.62, 0.61, 0.58), vec3(0.62, 0.42, 0.06), Y.a);
        diffuseColor.rgb = mix(diffuseColor.rgb, pc * (0.8 + 0.3 * texture2D(map, vWP.xz * 0.9).r * 3.0), Y.b);
        diffuseColor.rgb *= mix(1.0, 0.32, Y.g);
        wetE = smoothstep(0.0, 0.5, Y.r);
        diffuseColor.rgb *= mix(1.0, 0.5, wetE); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.42, Y.g * 0.8);
      roughnessFactor = mix(roughnessFactor, 0.62, Y.b);
      roughnessFactor = mix(roughnessFactor, 0.25, wetE);
      roughnessFactor = mix(roughnessFactor, 0.02, smoothstep(0.55, 0.9, Y.r));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize(mix(normal, nonPerturbedNormal, smoothstep(0.4, 0.85, Y.r)));`)
      .replace('#include <opaque_fragment>', `{
        float pd = smoothstep(0.55, 0.9, Y.r);
        if (pd > 0.001) {
          vec3 V = normalize(vViewPosition);
          float cosT = clamp(dot(nonPerturbedNormal, V), 0.0, 1.0);
          float fr = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          vec2 suv = gl_FragCoord.xy / uRes + (normal.xy - nonPerturbedNormal.xy) * 0.03;
          vec3 rc = texture2D(tRefl, suv).rgb;
          vec3 diff = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
          outgoingLight = mix(outgoingLight, diff * 0.6 + rc * fr, pd);
        }
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'zb-ground';
  const geo = new THREE.PlaneGeometry(260, 134, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -37);
  // UV = Weltmeter / 4 (Kachel 4 m)
  { const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 4, -p.getZ(i) / 4); }
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'boden';
  return m;
}

/* ------------------------------------------------------------------ Wasser + Kaikante */
export function water(env) {
  const nt = waterNormal(512);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b1a1c, roughness: 0.06, metalness: 0, normalMap: nt, normalScale: new THREE.Vector2(0.35, 0.35) });
  nt.repeat.set(60, 60);
  const U = { tRefl: env.refl, uRes: env.res };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tRefl; uniform vec2 uRes;')
      .replace('#include <opaque_fragment>', `{
        vec3 V = normalize(vViewPosition);
        float cosT = clamp(dot(nonPerturbedNormal, V), 0.0, 1.0);
        float fr = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec2 suv = gl_FragCoord.xy / uRes + (normal.xy - nonPerturbedNormal.xy) * vec2(0.04, 0.1);
        vec3 rc = texture2D(tRefl, suv).rgb;
        outgoingLight = reflectedLight.indirectDiffuse + reflectedLight.directDiffuse + reflectedLight.directSpecular * 0.6 + rc * fr * 0.9;
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'zb-water';
  const geo = new THREE.PlaneGeometry(6000, 3000, 1, 1); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat); m.position.set(0, -1.6, -1500 - 104); m.name = 'wasser';
  return m;
}

/* ------------------------------------------------------------------ Containerbrücke (STS) */
export function crane({ x0, z0 }) {
  const paint = paintedSteel({ W: 3, H: 3, ppm: 150, color: '#a2391f', seed: 77, kind: 'crane', age: 0.55, tile: true });
  const mat = steelMat(paint, { repeat: 1 / 3 });
  const grey = paintedSteel({ W: 3, H: 3, ppm: 120, color: '#b9b2a4', seed: 78, kind: 'crane', age: 0.45, tile: true });
  const matG = steelMat(grey, { repeat: 1 / 3 });
  const G = new THREE.Group();
  const red = [], gry = [], dark = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const B = (arr, a, b, w, h) => arr.push(beamGeo(a, b, w, h));
  const hx = 8, hz = 12, top = 31;
  // Beine
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B(red, V(sx * hx, 1.6, sz * hz), V(sx * hx, top, sz * hz), 1.3, 1.3);
    // Fahrwerk
    const bog = mbox(2.2, 1.2, 4.2); bog.translate(sx * hx, 0.9, sz * hz); red.push(bog);
    for (const k of [-1.4, 0, 1.4]) { const wh = new THREE.CylinderGeometry(0.4, 0.4, 0.5, 16); wh.rotateZ(Math.PI / 2); wh.translate(sx * hx, 0.4, sz * hz + k); dark.push(wh); }
  }
  // Längsriegel (Schwelle) + Diagonalen in den Seitenrahmen
  for (const sx of [-1, 1]) {
    B(red, V(sx * hx, 11, -hz), V(sx * hx, 11, hz), 1.1, 1.6);
    B(red, V(sx * hx, top - 0.5, -hz), V(sx * hx, top - 0.5, hz), 1.2, 2.2);
    B(red, V(sx * hx, 11.6, -hz + 0.6), V(sx * hx, top - 1.5, 0), 0.6, 0.6);
    B(red, V(sx * hx, 11.6, hz - 0.6), V(sx * hx, top - 1.5, 0), 0.6, 0.6);
    B(red, V(sx * hx, 2.4, -hz + 0.6), V(sx * hx, 10.4, -hz + 6), 0.45, 0.45);
    B(red, V(sx * hx, 2.4, hz - 0.6), V(sx * hx, 10.4, hz - 6), 0.45, 0.45);
  }
  // Portalträger quer
  for (const sz of [-1, 1]) { B(red, V(-hx, top, sz * hz), V(hx, top, sz * hz), 1.6, 2.4); B(red, V(-hx, 24, sz * hz), V(hx, 24, sz * hz), 0.8, 1.0); }
  // Ausleger (zwei Hauptträger + Fachwerk)
  const by = top + 2.4, zb0 = 26, zb1 = -62;
  for (const sx of [-1.5, 1.5]) {
    B(gry, V(sx, by, zb0), V(sx, by, zb1), 0.8, 2.6);
    B(gry, V(sx, by + 3.4, zb0 - 4), V(sx, by + 3.4, zb1 + 6), 0.5, 0.6);
    for (let z = zb0 - 4; z > zb1 + 6; z -= 3.6) {
      B(gry, V(sx, by + 1.2, z), V(sx, by + 3.4, z - 3.6), 0.22, 0.22);
      B(gry, V(sx, by + 1.2, z), V(sx, by + 3.4, z), 0.2, 0.2);
    }
  }
  for (let z = zb0 - 1; z > zb1 + 1; z -= 3.6) { B(gry, V(-1.5, by - 1.0, z), V(1.5, by - 1.0, z), 0.25, 0.3); B(gry, V(-1.5, by - 1.0, z), V(1.5, by - 1.0, z - 3.6), 0.15, 0.15); }
  // Querverband Ausleger ↔ Portal
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(red, V(sx * hx, top + 0.6, sz * hz), V(sx * 1.6, by - 0.4, sz * (hz - 3)), 0.7, 0.7);
  // A-Bock (Spitze) + Abspannungen
  const apex = V(0, 52, 6);
  for (const sx of [-1, 1]) { B(red, V(sx * hx, top + 1, hz), apex.clone().setX(sx * 1.2), 1.0, 1.0); B(red, V(sx * hx, top + 1, -hz), apex.clone().setX(sx * 1.2), 0.9, 0.9); }
  B(red, V(-1.2, apex.y, apex.z), V(1.2, apex.y, apex.z), 1.0, 1.4);
  // Maschinenhaus + Laufkatze + Führerhaus
  const mh = mbox(9, 4.5, 10); mh.translate(0, by + 3.6, zb0 - 6); gry.push(mh);
  const tr = mbox(4.4, 2.2, 6); tr.translate(0, by - 2.2, -6); gry.push(tr);
  const cab = mbox(2.6, 2.4, 2.6); cab.translate(-0.4, by - 4.6, -7.6); gry.push(cab);
  // Treppe am Bein (schräge Läufe)
  for (let k = 0; k < 7; k++) { const y0 = 2 + k * 4; B(gry, V(hx + 1.1, y0, hz - 1.2), V(hx + 1.1, y0 + 4, hz - 4.6 + (k % 2) * 3.4 * 0 ), 0.6, 0.12); }
  const mRed = new THREE.Mesh(mergeGeometries(red), mat), mGry = new THREE.Mesh(mergeGeometries(gry), matG);
  const mDark = new THREE.Mesh(mergeGeometries(dark), new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.6, metalness: 0.4 }));
  G.add(mRed, mGry, mDark);
  // Seile (Durchhang): Abspannungen + Hubseile
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 0.45, metalness: 0.7 });
  const cable = (a, b, sag, r = 0.06) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; const p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 6), cableMat);
    G.add(m);
  };
  for (const sx of [-1.2, 1.2]) {
    cable(V(sx, apex.y, apex.z), V(sx * 1.2, by + 3.5, -24), 0.9, 0.09);
    cable(V(sx, apex.y, apex.z), V(sx * 1.2, by + 3.5, -52), 1.6, 0.09);
    cable(V(sx, apex.y, apex.z), V(sx * 1.2, by + 3.5, zb0 - 2), 0.5, 0.09);
  }
  // Hubseile zum Spreader mit hängendem Container
  const sy = 13.2;
  for (const sx of [-0.9, 0.9]) for (const sz of [-1.6, 1.6]) cable(V(sx, by - 3.3, -6 + sz * 0.6), V(sx * 1.05, sy + 0.6, -6 + sz * 1.9), 0.0, 0.035);
  const spreader = new THREE.Mesh(mbox(2.6, 0.5, 12.4), matG); spreader.position.set(0, sy + 0.3, -6); G.add(spreader);
  const hang = container({ L: 12.192, color: '#1f3f6e', seed: 41, ppm: 50, age: 0.6, simple: true });
  hang.rotation.y = Math.PI / 2; hang.position.set(0, sy - CH, -6); G.add(hang);
  G.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  G.position.set(x0, 0, z0);
  return G;
}

/* ------------------------------------------------------------------ Ferne: Kräne, Silhouetten, Masten */
export function farStuff() {
  const G = new THREE.Group();
  const R = rng(5);
  const hazeMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.1 });
  // gegenüberliegendes Ufer: Industrie-Silhouetten
  const sil = [];
  for (let i = 0; i < 70; i++) {
    const w = 15 + R() * 50, h = 6 + Math.pow(R(), 2) * 45, d = 20 + R() * 40;
    const g = mbox(w, h, d); g.translate(-900 + i * 26 + R() * 10, h / 2 - 1.6, -760 - R() * 160); sil.push(g);
    if (R() < 0.25) { const c = new THREE.CylinderGeometry(1.5, 2, h + 30 + R() * 30, 8); c.translate(-900 + i * 26, (h + 30) / 2, -770 - R() * 100); sil.push(c); }
  }
  const s = new THREE.Mesh(mergeGeometries(sil), hazeMat(0x4c4a48)); G.add(s);
  // Pier rechts (für die fernen Brücken)
  { const pg = new THREE.PlaneGeometry(380, 120); pg.rotateX(-Math.PI / 2); const pm = new THREE.Mesh(pg, hazeMat(0x5a5650)); pm.position.set(230, 0.02, -165); pm.receiveShadow = true; G.add(pm);
    const pw = new THREE.Mesh(mbox(380, 1.8, 1), hazeMat(0x6d6a64)); pw.position.set(230, -0.9, -105.5); G.add(pw); }
  // ferne Containerbrücken (vereinfacht)
  const far = [];
  for (const [x, z, rot] of [[62, -140, 0], [112, -150, 0], [168, -160, 0], [-420, -700, 0.3], [260, -720, -0.2]]) {
    const parts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(beamGeo(new THREE.Vector3(sx * 8, 0, sz * 12), new THREE.Vector3(sx * 8, 31, sz * 12), 1.3, 1.3));
    for (const sz of [-1, 1]) parts.push(beamGeo(new THREE.Vector3(-8, 31, sz * 12), new THREE.Vector3(8, 31, sz * 12), 1.6, 2.4));
    for (const sx of [-1, 1]) parts.push(beamGeo(new THREE.Vector3(sx * 8, 11, -12), new THREE.Vector3(sx * 8, 11, 12), 1.0, 1.4));
    parts.push(beamGeo(new THREE.Vector3(0, 34, 28), new THREE.Vector3(0, 34 + (x % 3 === 0 ? 30 : 0), -62), 3.2, 2.6));
    for (const sx of [-1, 1]) parts.push(beamGeo(new THREE.Vector3(sx * 8, 32, 12), new THREE.Vector3(0, 52, 6), 1, 1));
    const g = mergeGeometries(parts); g.rotateY(rot); g.translate(x, 0, z); far.push(g);
  }
  const fm = new THREE.Mesh(mergeGeometries(far), hazeMat(0x7a3b26)); fm.castShadow = true; G.add(fm);
  // Lichtmasten
  const mast = [];
  for (const [x, z] of [[9.8, -40], [-22, -92], [30, -88]]) {
    mast.push(beamGeo(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 30, z), 0.5, 0.5));
    const hd = mbox(3.2, 1.0, 0.6); hd.translate(x, 30.4, z); mast.push(hd);
  }
  const mm = new THREE.Mesh(mergeGeometries(mast), new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.5, metalness: 0.8 }));
  mm.castShadow = true; G.add(mm);
  G.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return G;
}

/** Containerblöcke im Mittelgrund. */
export function stacks(list) {
  const G = new THREE.Group();
  const colors = ['#8e2f1e', '#1f4a7a', '#6d6d69', '#b1702a', '#2f5e3f', '#a8a296', '#7a2a2a', '#c09a2e', '#355a7a', '#5a3a2a'];
  const R = rng(17);
  for (const b of list) {
    for (let i = 0; i < b.nx; i++) for (let j = 0; j < b.nz; j++) {
      const hgt = b.h0 + Math.floor(R() * (b.h1 - b.h0 + 1));
      for (let k = 0; k < hgt; k++) {
        const col = colors[Math.floor(R() * colors.length)];
        const seed = 100 + Math.floor(R() * 6);
        const c = container({ L: b.L || 12.192, color: col, seed, ppm: b.ppm || 48, age: 0.4 + R() * 0.3, simple: true });
        c.rotation.y = b.rot || 0;
        const off = new THREE.Vector3(i * (CW + 0.25), k * CH, j * ((b.L || 12.192) + 0.6));
        if (b.rot) off.set(j * ((b.L || 12.192) + 0.6), k * CH, i * (CW + 0.25));
        c.position.set(b.x + off.x, off.y, b.z - off.z);
        if (!b.rot) c.rotation.y = Math.PI / 2;
        G.add(c);
      }
    }
  }
  return G;
}

/* ------------------------------------------------------------------ Himmel (Preetham + Wolken) */
export function sky(sunDir) {
  const s = new Sky();
  // Richtung aus Objektraum → spiegelbar (Spiegelung der Weltwurzel spiegelt auch den Himmel)
  s.material.vertexShader = s.material.vertexShader.replace('vWorldPosition = worldPosition.xyz;', 'vWorldPosition = cameraPosition + normalize(position) * 1000.0;');
  s.scale.setScalar(3000);
  const u = s.material.uniforms;
  u.turbidity.value = 7.5; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.86;
  u.sunPosition.value.copy(sunDir);
  u.cloudCoverage.value = 0.42; u.cloudDensity.value = 0.55; u.cloudElevation.value = 0.55; u.cloudScale.value = 0.00022;
  u.time.value = 37;
  s.frustumCulled = false;
  s.name = 'himmel';
  return s;
}

/** Paletten-/Kisten-Kleinkram (schnell, eigene Holz-/Plane-Anmutung über Farbe/Rauheit). */
export function clutter() {
  const G = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.92 });
  const tarp = new THREE.MeshStandardMaterial({ color: 0x2d3a30, roughness: 0.8 });
  const pallet = (x, z, n, rot = 0) => {
    const parts = [];
    for (let k = 0; k < n; k++) {
      const y = k * 0.144;
      for (let i = 0; i < 7; i++) { const b = mbox(1.2, 0.022, 0.1); b.translate(0, y + 0.133, -0.4 + i * 0.133); parts.push(b); }
      for (const zz of [-0.4, 0, 0.4]) { const b = mbox(1.2, 0.1, 0.1); b.translate(0, y + 0.072, zz); parts.push(b); }
      for (let i = 0; i < 5; i++) { const b = mbox(0.1, 0.022, 0.9); b.translate(-0.55 + i * 0.275, y + 0.011, 0); parts.push(b); }
    }
    const m = new THREE.Mesh(mergeGeometries(parts), wood); m.position.set(x, 0, z); m.rotation.y = rot; m.castShadow = m.receiveShadow = true; G.add(m);
  };
  pallet(-5.2, -10.5, 6, 0.1); pallet(-6.6, -10.2, 4, -0.05); pallet(-13, -33, 8, 0.4); pallet(8.9, -28.5, 5, 0.2);
  // Plane über Kisten
  const crate = mbox(1.6, 1.3, 1.2); crate.translate(0, 0.65, 0);
  const c = new THREE.Mesh(crate, tarp); c.position.set(-7.5, 0, -30); c.rotation.y = 0.3; c.castShadow = c.receiveShadow = true; G.add(c);
  // Betonblöcke (Legosteine)
  const conc = new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.95 });
  for (const [x, z] of [[-1.6, -48], [-0.2, -48], [1.2, -48]]) { const b = new THREE.Mesh(mbox(1.6, 0.8, 0.8), conc); b.position.set(x, 0.4, z); b.castShadow = b.receiveShadow = true; G.add(b); }
  return G;
}
