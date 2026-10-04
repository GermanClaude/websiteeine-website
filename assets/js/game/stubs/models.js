// NULLPUNKT — Stub für weapons/models.js (§7): einfache Kastenwaffen mit den vertraglich
// geforderten Ankerpunkten. Modell zeigt entlang −Z (Mündung vorn), Griff am Ursprung.

import * as THREE from 'three';

// Maße je Modellschlüssel: [Gesamtlänge, Laufläge, Magazinlänge, Schaft?]
const SHAPES = {
  kv47: { len: 0.78, barrel: 0.3, mag: 0.2, stock: true, color: 0x6b4128 },
  m17: { len: 0.74, barrel: 0.28, mag: 0.17, stock: true, color: 0x2a2c2f },
  vp9: { len: 0.55, barrel: 0.16, mag: 0.18, stock: true, color: 0x26282b },
  qx90: { len: 0.5, barrel: 0.1, mag: 0.0, stock: false, color: 0x3a3d33 },
  hm60: { len: 0.95, barrel: 0.4, mag: 0.14, stock: true, color: 0x33362f },
  sk14: { len: 0.95, barrel: 0.42, mag: 0.12, stock: true, color: 0x40433a },
  brecher: { len: 1.1, barrel: 0.5, mag: 0.08, stock: true, color: 0x2f3a2c },
  bulldog: { len: 0.9, barrel: 0.45, mag: 0.0, stock: true, color: 0x4a3626 },
  p9: { len: 0.2, barrel: 0.0, mag: 0.1, stock: false, color: 0x1f2124, pistol: true },
  adler: { len: 0.26, barrel: 0.0, mag: 0.11, stock: false, color: 0x8a8d90, pistol: true },
  knife: { len: 0.3, knife: true, color: 0x2a2b2d },
  frag: { grenade: true, color: 0x4a5236 },
  semtex: { grenade: true, color: 0x3c3f44 },
};

const matCache = new Map();
function mat(color, rough = 0.55, metal = 0.6) {
  const key = `${color}|${rough}|${metal}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(key);
}

function part(group, w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

function anchor(group, name, x, y, z) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  group.add(o);
  return o;
}

export function createWeaponModel(modelKey, { lod = 'first' } = {}) {
  const s = SHAPES[modelKey] || SHAPES.m17;
  const g = new THREE.Group();
  g.name = `weapon:${modelKey}:${lod}`;
  const body = mat(0x2a2c2f);
  const accent = mat(s.color, 0.6, 0.3);
  const ud = {};

  if (s.grenade) {
    part(g, 0.07, 0.09, 0.07, 0, 0, 0, accent);
    part(g, 0.03, 0.03, 0.03, 0, 0.06, 0, body);
    ud.muzzle = anchor(g, 'muzzle', 0, 0.06, 0);
  } else if (s.knife) {
    part(g, 0.03, 0.035, 0.12, 0, 0, 0.03, accent);
    part(g, 0.006, 0.03, 0.18, 0, 0.005, -0.12, mat(0xb8bcc0, 0.25, 0.9));
    ud.muzzle = anchor(g, 'muzzle', 0, 0.005, -0.21);
  } else if (s.pistol) {
    part(g, 0.032, 0.035, s.len, 0, 0.045, -s.len / 2 + 0.05, accent);
    part(g, 0.03, 0.1, 0.045, 0, -0.02, 0.01, body);
    ud.muzzle = anchor(g, 'muzzle', 0, 0.045, -s.len + 0.04);
    ud.sight = anchor(g, 'sight', 0, 0.068, -0.02);
    ud.magazine = anchor(g, 'magazine', 0, -0.06, 0.01);
  } else {
    const L = s.len;
    // Gehäuse, Lauf, Griff, Magazin, Schaft, Visier
    part(g, 0.05, 0.075, L * 0.5, 0, 0.03, -L * 0.25 + 0.05, body);
    part(g, 0.055, 0.06, L * 0.22, 0, 0.025, -L * 0.5 - 0.02, accent);
    if (s.barrel) part(g, 0.022, 0.022, s.barrel, 0, 0.04, -L * 0.5 - s.barrel * 0.5 - 0.1, mat(0x18191b, 0.4, 0.9));
    part(g, 0.035, 0.09, 0.04, 0, -0.035, 0.02, body);
    if (s.mag) part(g, 0.03, s.mag, 0.06, 0, -0.04 - s.mag * 0.3, -0.12, accent);
    if (s.stock) part(g, 0.04, 0.07, 0.24, 0, 0.015, 0.17, accent);
    part(g, 0.02, 0.03, 0.03, 0, 0.083, -0.05, mat(0x111111, 0.5, 0.5));
    const tip = -L * 0.5 - (s.barrel || 0) - 0.11;
    ud.muzzle = anchor(g, 'muzzle', 0, 0.04, tip);
    ud.sight = anchor(g, 'sight', 0, 0.098, -0.05);
    ud.magazine = anchor(g, 'magazine', 0, -0.06, -0.12);
    ud.leftHandGrip = anchor(g, 'leftHandGrip', 0, 0.0, -L * 0.5);
  }
  ud.ejection = anchor(g, 'ejection', 0.03, 0.05, -0.05);
  if (!ud.sight) ud.sight = anchor(g, 'sight', 0, 0.06, 0);
  if (!ud.magazine) ud.magazine = anchor(g, 'magazine', 0, 0, 0);
  if (!ud.leftHandGrip) ud.leftHandGrip = anchor(g, 'leftHandGrip', 0, 0, -0.1);
  // Versatz, damit das Visier im Anschlag auf der Kameraachse liegt
  ud.adsOffset = new THREE.Vector3(0, -ud.sight.position.y, 0);
  g.userData = ud;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = lod !== 'first'; o.receiveShadow = false; } });
  return g;
}
