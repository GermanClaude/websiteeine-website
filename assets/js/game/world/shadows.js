// NULLPUNKT — Kaskadenschatten mit Zwischenspeicher (Realismus-Plan R8/A-7, Owner: world).
//
// Nahkaskade = die bisherige Sonne (DirectionalLight, kamerafolgend, texelstabil; jedes Bild bzw. auf low jedes
// 4. Bild) mit kleinerem Ausschnitt ab medium → schärfere Schatten in der Nähe. Fernkaskade = eine einmal beim
// Laden (bzw. nach Qualitätswechsel/Kontextverlust) gerenderte Schattenkarte der ganzen Karte aus statischer
// Geometrie: three.js' eigener Schattenpass (Alpha-Test, Instanzen) über renderer.shadowMap.render([fernLicht]) –
// das Fernlicht selbst bleibt unsichtbar (kein zusätzliches Licht in den Shadern, keine Kosten für andere Module).
// Die Welt-Materialien (world/shading.js) blenden am Rand der Nahkaskade auf die Fernkarte über.
// low: keine Fernkarte – dort übernimmt die Sonnensicht des Sonden-Gitters (world/probes.js) die Ferne.
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

/**
 * Fernkaskade anlegen. opts: { sunDir (zur Sonne), bounds {minX,maxX,minY,maxY,minZ,maxZ} (Empfänger), group (Elterngruppe
 * für das unsichtbare Fernlicht – damit memoryEstimate die Karte zählt), exclude (() => Object3D[]: bewegte Objekte,
 * die nicht in die statische Karte gehören) }.
 */
export function createFarShadow(G, { sunDir, bounds, group, exclude = () => [] }) {
  const R = G.renderer;
  const renderer = R?.renderer;
  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.name = 'sun-far';
  light.visible = false;
  light.castShadow = true;
  light.userData.npFarShadow = true;
  light.shadow.autoUpdate = false;
  group.add(light); group.add(light.target);

  const dir = sunDir.clone().normalize();
  const b = bounds;
  const center = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  const reach = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2;
  light.position.copy(center).addScaledVector(dir, reach + 80);
  light.target.position.copy(center);
  light.updateMatrixWorld(); light.target.updateMatrixWorld();
  // Ausschnitt in Lichtraum-Koordinaten aus den Ecken des Empfangsbereichs
  const cam = light.shadow.camera;
  cam.position.copy(light.position); cam.up.copy(_up); cam.lookAt(center); cam.updateMatrixWorld();
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

  let size = [0, 0], texel = 0.1, baked = false, disposed = false;
  const stats = { bakes: 0, ms: 0, size, texel: 0, bytes: 0 };

  function configure(preset) {
    const budget = farShadowBudget(preset);
    if (!budget) { size = [0, 0]; return false; }
    // gleiche Texeldichte in beiden Achsen, Fläche ≈ budget²
    const aspect = spanX / spanY;
    let w = Math.round(budget * Math.sqrt(aspect) / 16) * 16, h = Math.round(budget / Math.sqrt(aspect) / 16) * 16;
    const maxT = renderer?.capabilities?.maxTextureSize || 4096;
    w = Math.max(256, Math.min(maxT, 4096, w)); h = Math.max(256, Math.min(maxT, 4096, h));
    size = [w, h];
    texel = Math.max(spanX / w, spanY / h);
    if (light.shadow.mapSize.x !== w || light.shadow.mapSize.y !== h) {
      light.shadow.mapSize.set(w, h);
      if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
    }
    return true;
  }

  /** Fernkarte (neu) rendern. → true, wenn die Welt-Materialien sie jetzt nutzen. */
  function bake(preset = R?.preset) {
    if (disposed || !renderer || R.lost) return false;
    initShading(renderer);
    const sm = renderer.shadowMap;
    if (!configure(preset) || !sm.enabled) { WS.npFar.value.x = WS.npFar.value.x === 1 ? 0 : WS.npFar.value.x; baked = false; return false; }
    const t0 = performance.now();
    const hidden = [];
    for (const root of exclude()) root?.traverse?.((o) => { if (o.castShadow) { o.castShadow = false; hidden.push(o); } });
    const pa = sm.autoUpdate, pn = sm.needsUpdate;
    sm.needsUpdate = true;
    light.shadow.needsUpdate = true;
    try {
      sm.render([light], G.scene, G.camera || cam);
    } finally {
      sm.autoUpdate = pa; sm.needsUpdate = pn;
      for (const o of hidden) o.castShadow = true;
    }
    if (!light.shadow.map?.depthTexture) { baked = false; return false; }
    const depthRange = cam.far - cam.near;
    // Tiefen-Bias ≈ 1,5 Texel Gefälle, Normalenversatz ≈ 1,2 Texel
    WS.npFarMap.value = light.shadow.map.depthTexture;
    WS.npFarMatrix.value.copy(light.shadow.matrix);
    WS.npFarParams.value.set(-(texel * 1.5) / depthRange, 1.4, 1 / size[0], 1 / size[1]);
    WS.npFar.value.x = 1;
    WS.npFar.value.w = texel * 1.2;
    baked = true;
    stats.bakes++;
    stats.ms = Math.round(performance.now() - t0);
    stats.size = size.slice();
    stats.texel = +texel.toFixed(3);
    stats.bytes = size[0] * size[1] * 4;
    return true;
  }

  const offCtx = typeof R?.onContextChange === 'function' ? R.onContextChange((state) => {
    if (state === 'lost') { baked = false; WS.npFar.value.x = WS.npFar.value.x === 1 ? 0 : WS.npFar.value.x; dropShadingContext(); }
    else if (state === 'restored') { initShading(renderer); bake(); }
  }) : null;

  return {
    light,
    stats,
    get active() { return baked; },
    get texel() { return texel; },
    bake,
    dispose() {
      disposed = true;
      offCtx?.();
      if (baked || WS.npFar.value.x === 1) resetFarMap();
      light.shadow.dispose?.();
      light.shadow.map = null;
      group.remove(light); group.remove(light.target);
    },
  };
}
