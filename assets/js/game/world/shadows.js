// NULLPUNKT — Kaskadenschatten mit Zwischenspeicher (Realismus-Plan R8/A-7, Owner: world).
//
// Nahkaskade = die bisherige Sonne (DirectionalLight, kamerafolgend, texelstabil; jedes Bild bzw. auf low jedes
// 4. Bild) mit kleinerem Ausschnitt ab medium → schärfere Schatten in der Nähe. Fernkaskade = eine einmal beim
// Laden (bzw. nach Qualitätswechsel/Kontextverlust) gerenderte Tiefenkarte der ganzen Karte aus statischer
// Geometrie (eigener Tiefenpass wie three.js' Schattenpass: Rückseiten, Alpha-Test, Instanzen; ohne Licht in der
// Szene → keine Shader-Varianten, keine Kosten für andere Module). Die Welt-Materialien (world/shading.js) blenden
// am Rand der Nahkaskade auf die Fernkarte über. low: keine Fernkarte – dort übernimmt die Sonnensicht des
// Sonden-Gitters (world/probes.js) die Ferne.
import * as THREE from 'three';
import { WS, initShading, dropShadingContext, resetFarMap } from './shading.js';

/** Halbe Kantenlänge der Nahkaskade (m), wenn eine Fernkarte die Ferne übernimmt. */
export const NEAR_CAP = Object.freeze({ medium: 22, high: 18, ultra: 16 });

/** Texel-Budget der Fernkarte (Kantenlänge eines gleich großen Quadrats) je Vorgabe; 0 = keine Fernkarte. */
export function farShadowBudget(preset) {
  if (!preset || preset.shadows === false || (preset.shadowInterval || 1) > 1) return 0;
  if (preset.id === 'medium') return 1024;
  return Math.min(2048, Math.max(1024, preset.shadowMapSize || 2048));
}

const _up = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

/**
 * Fernkaskade anlegen. opts: { sunDir (zur Sonne), bounds {minX,maxX,minY,maxY,minZ,maxZ} (Empfänger), group (Weltgruppe:
 * Schattenwerfer + Halter der Karte für memoryEstimate), exclude (() => Object3D[]: bewegte Objekte, die nicht in die
 * statische Karte gehören) }.
 */
export function createFarShadow(G, { sunDir, bounds, group, exclude = () => [], prepare = null }) {
  const R = G.renderer;
  const renderer = R?.renderer;
  // Unsichtbarer Halter: memoryEstimate zählt Schattenkarten über Lichter in der Szene
  const holder = new THREE.DirectionalLight(0xffffff, 0);
  holder.name = 'sun-far';
  holder.visible = false;
  holder.castShadow = false;
  holder.userData.npFarShadow = true;
  group.add(holder);

  const dir = sunDir.clone().normalize();
  const b = bounds;
  const center = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  const reach = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10);
  cam.position.copy(center).addScaledVector(dir, reach + 80);
  cam.up.copy(_up);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
  for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
    _v.set(x, y, z).applyMatrix4(inv);
    x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); z0 = Math.min(z0, _v.z);
  }
  cam.left = x0 - 1; cam.right = x1 + 1; cam.bottom = y0 - 1; cam.top = y1 + 1;
  cam.near = 1; cam.far = -z0 + 20; // alles zwischen Sonne und Empfängern wirft Schatten
  cam.updateProjectionMatrix();
  const spanX = cam.right - cam.left, spanY = cam.top - cam.bottom;
  const matrix = new THREE.Matrix4().multiplyMatrices(BIAS, cam.projectionMatrix).multiply(cam.matrixWorldInverse);

  let rt = null, size = [0, 0], texel = 0.1, baked = false, disposed = false;
  const stats = { bakes: 0, ms: 0, size: [0, 0], texel: 0, bytes: 0, casters: 0 };
  const depthBase = new THREE.MeshDepthMaterial();
  depthBase.colorWrite = false;
  depthBase.name = 'np:far-depth';
  const variants = new Map(); // Material → Tiefenmaterial (Alpha-Test/Seiten)

  function depthFor(m) {
    const alpha = (m.map || m.alphaMap) && m.alphaTest > 0;
    const side = m.shadowSide ?? SHADOW_SIDE[m.side] ?? THREE.BackSide;
    const key = alpha ? m : side;
    let d = variants.get(key);
    if (!d) {
      d = depthBase.clone();
      d.colorWrite = false;
      d.side = side;
      if (alpha) { d.map = m.map; d.alphaMap = m.alphaMap; d.alphaTest = m.alphaTest; }
      variants.set(key, d);
    }
    return d;
  }

  function configure(preset) {
    const budget = farShadowBudget(preset);
    if (!budget) return false;
    // gleiche Texeldichte in beiden Achsen, Fläche ≈ budget²
    const aspect = spanX / spanY;
    const maxT = Math.min(4096, renderer?.capabilities?.maxTextureSize || 4096);
    let w = Math.round(budget * Math.sqrt(aspect) / 16) * 16, h = Math.round(budget / Math.sqrt(aspect) / 16) * 16;
    w = Math.max(256, Math.min(maxT, w)); h = Math.max(256, Math.min(maxT, h));
    texel = Math.max(spanX / w, spanY / h);
    if (!rt || rt.width !== w || rt.height !== h || holder.shadow.map !== rt) {
      rt?.dispose();
      const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      dt.format = THREE.DepthFormat;
      dt.compareFunction = THREE.LessEqualCompare;
      dt.minFilter = dt.magFilter = THREE.LinearFilter;
      dt.name = 'np:fernschatten';
      // Farbanhang ist Pflicht (three.js), aber ungenutzt → 1 Byte je Texel
      rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture: dt, generateMipmaps: false, format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      rt.texture.name = 'np:fernschatten-farbe';
      size = [w, h];
      holder.shadow.mapSize.set(w, h);
      holder.shadow.map = rt;
    }
    return true;
  }

  /** Fernkarte (neu) rendern. → true, wenn die Welt-Materialien sie jetzt nutzen. */
  function bake(preset = R?.preset) {
    if (disposed || !renderer || R.lost) return false;
    initShading(renderer);
    if (!configure(preset)) { baked = false; return false; }
    const t0 = performance.now();
    prepare?.(); // z. B. alle Requisiten-Instanzen sichtbar (CPU-Culling)
    const skip = new Set();
    for (const root of exclude()) root?.traverse?.((o) => skip.add(o));
    const swaps = [], hidden = [];
    let casters = 0;
    group.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const mat = o.material;
      const cast = o.isMesh && o.castShadow && o.visible && !skip.has(o) && !Array.isArray(mat) && mat?.visible !== false && !mat?.transparent;
      if (cast) { swaps.push([o, mat]); o.material = depthFor(mat); casters++; }
      else if (o.visible) { o.visible = false; hidden.push(o); }
    });
    const sm = renderer.shadowMap;
    const pa = sm.autoUpdate, pn = sm.needsUpdate, prevRT = renderer.getRenderTarget(), prevClear = renderer.autoClear;
    try {
      // Schattenpass der Szene hier nicht auslösen (die Nahkaskade bleibt, wie sie ist)
      sm.autoUpdate = false; sm.needsUpdate = false;
      renderer.setRenderTarget(rt);
      renderer.autoClear = true;
      renderer.clear(true, true, false);
      renderer.render(group, cam);
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevClear;
      sm.autoUpdate = pa; sm.needsUpdate = pn;
      for (const [o, m] of swaps) o.material = m;
      for (const o of hidden) o.visible = true;
    }
    const depthRange = cam.far - cam.near;
    WS.npFarMap.value = rt.depthTexture;
    WS.npFarMatrix.value.copy(matrix);
    // Tiefen-Bias ≈ 1,5 Texel Gefälle, Normalenversatz ≈ 1,2 Texel, PCF-Radius 1,4 Texel
    WS.npFarParams.value.set(-(texel * 1.5) / depthRange, 1.4, 1 / size[0], 1 / size[1]);
    WS.npFar.value.w = texel * 1.2;
    baked = true;
    stats.bakes++;
    stats.ms = Math.round(performance.now() - t0);
    stats.size = size.slice();
    stats.texel = +texel.toFixed(3);
    stats.bytes = size[0] * size[1] * 5; // Tiefe 4 B + (ungenutzter) Farbanhang 1 B
    stats.casters = casters;
    return true;
  }

  const offCtx = typeof R?.onContextChange === 'function' ? R.onContextChange((state) => {
    if (state === 'lost') { baked = false; rt = null; holder.shadow.map = null; dropShadingContext(); }
    else if (state === 'restored') { initShading(renderer); bake(); }
  }) : null;

  return {
    stats,
    camera: cam,
    get active() { return baked; },
    get texel() { return texel; },
    bake,
    dispose() {
      disposed = true;
      offCtx?.();
      resetFarMap();
      rt?.dispose(); rt = null;
      holder.shadow.map = null;
      group.remove(holder);
      for (const d of variants.values()) d.dispose();
      variants.clear();
      depthBase.dispose();
    },
  };
}
