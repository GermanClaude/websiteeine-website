// NULLPUNKT — Stub für engine/textures.js (§6): getMaterial(name, opts) + boxUV(geometry, scale).
// Einfache, gecachte MeshStandardMaterials mit einer gemeinsamen prozeduralen Rauschtextur.

import * as THREE from 'three';

const PALETTE = {
  concrete: [0x8a8780, 0.92, 0, 'concrete'], concrete_dark: [0x55534f, 0.95, 0, 'concrete'],
  plaster_warm: [0xd8c4a0, 0.9, 0, 'concrete'], plaster_white: [0xe6e1d6, 0.9, 0, 'concrete'],
  brick: [0x8c4a36, 0.9, 0, 'concrete'], metal_painted: [0x5d6b74, 0.55, 0.6, 'metal'],
  metal_rust: [0x7a4a2c, 0.8, 0.5, 'metal'], metal_corrugated: [0x7d868c, 0.6, 0.7, 'metal'],
  container_red: [0xa8402e, 0.6, 0.45, 'metal'], container_blue: [0x2f5d86, 0.6, 0.45, 'metal'],
  container_green: [0x3f6b48, 0.6, 0.45, 'metal'], container_orange: [0xd27a2c, 0.6, 0.45, 'metal'],
  container_gray: [0x6c7177, 0.6, 0.45, 'metal'], wood_crate: [0x9a7448, 0.85, 0, 'wood'],
  wood_planks: [0x7d5a3a, 0.85, 0, 'wood'], asphalt: [0x3b3c3e, 0.95, 0, 'concrete'],
  sand: [0xcdb68a, 1, 0, 'sand'], dirt: [0x6e5a43, 1, 0, 'dirt'], grass: [0x55703a, 1, 0, 'grass'],
  tiles: [0xb7b1a3, 0.5, 0, 'tile'], glass: [0x9fc3d6, 0.08, 0.1, 'glass'], sandbag: [0xa8956b, 1, 0, 'fabric'],
  tarp: [0x3e5a4a, 0.9, 0, 'fabric'], rubber: [0x1d1e20, 0.9, 0, 'fabric'], gunmetal: [0x2c2f33, 0.45, 0.85, 'metal'],
  polymer: [0x26282b, 0.7, 0.05, 'metal'], wood_stock: [0x6b4128, 0.6, 0, 'wood'],
  fabric_camo_a: [0x5b6347, 0.95, 0, 'fabric'], fabric_camo_b: [0x6d5f4b, 0.95, 0, 'fabric'], skin: [0xc99a7a, 0.7, 0, 'flesh'],
};

let noiseTex = null;
const cache = new Map();

function noise() {
  if (noiseTex) return noiseTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 200 + rnd() * 55;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // grobe Flecken
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`;
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 4 + rnd() * 18, 0, Math.PI * 2);
    g.fill();
  }
  noiseTex = new THREE.CanvasTexture(c);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.colorSpace = THREE.SRGBColorSpace;
  noiseTex.anisotropy = 4;
  return noiseTex;
}

export function getMaterial(name, opts = {}) {
  const key = `${name}|${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);
  const [color, roughness, metalness, surface] = PALETTE[name] || [0x888888, 0.9, 0, 'concrete'];
  const m = new THREE.MeshStandardMaterial({
    color: opts.color !== undefined ? opts.color : color,
    roughness, metalness,
    map: name === 'glass' ? null : noise(),
    transparent: name === 'glass',
    opacity: name === 'glass' ? 0.35 : 1,
  });
  m.name = name;
  m.userData.surface = surface;
  cache.set(key, m);
  return m;
}

/** Weltskalierte Box-Projektion der UVs (1 Kachel pro `scale` Meter). */
export function boxUV(geometry, scale = 1) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (ny >= nx && ny >= nz) { u = pos.getX(i); v = pos.getZ(i); } else if (nx >= nz) { u = pos.getZ(i); v = pos.getY(i); } else { u = pos.getX(i); v = pos.getY(i); }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

export function disposeMaterials() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
