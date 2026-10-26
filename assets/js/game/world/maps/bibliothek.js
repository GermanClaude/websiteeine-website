// NULLPUNKT — Karte „Bibliothek“: alte Zauberbibliothek im Stil einer Schloss-Internatsbibliothek (x −38..38, z −27..27,
// 13 m hoch). Mittelgang mit langen Lesetischen und einer Rotunde (schwebender Himmelsglobus); links und rechts hohe,
// dunkle Regale: Reihen quer zum Gang bilden halb geschlossene Lesenischen, außen schräge Fischgrät-Gassen und
// Querriegel – verwinkelt, kurze Sichtlinien, Leitern an den Regalen. Galerien an den Längswänden (4,4 m) mit Treppen in
// allen vier Ecken, zwei Holzbrücken quer über die Halle. Norden: Eingangshalle mit Ausleihtheken (Team A), Süden:
// Verbotene Abteilung hinter Eisengittern mit drei Durchgängen (Team B). Beide Hälften punktsymmetrisch (fair).
// Magie: fliegende Bücher, schwebende Kerzen, schwebende Armillarsphäre (ohne Kollision, über Kopfhöhe). (Owner: world)
import * as THREE from 'three';
import { wall, slab, stairs, railing } from '../arch.js';
import { chair, hash01 } from '../props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { atlasTexture, atlasScale } from '../atlas.js';

const X = 38, Z = 27, H = 13, GY = 4.4; // Halle, Höhe, Galerie-/Brückenhöhe
const GAL = X - 4.5, GZ = 22.5; // Innenkante und Länge (±) der Galerien
const SZ = 21.2, SW = 1.15, SRUN = 7; // Treppen: z-Mitte (±), halbe Breite, Lauflänge
const BRIDGES = [-11, 11], BW = 1.3; // Brücken (z-Mitte, halbe Breite)
const STONE = '#9a8f7d', STONE_D = '#7d7262', WOOD = '#4a3020', WOOD_L = '#7a5233', WOOD_D = '#3a2418';
const BOOK = ['#7a1f1f', '#1f3f6a', '#2f5a2a', '#6a4a1f', '#4a2a5a', '#8a6a2a', '#2a2a2a', '#5a1f3a'];
const Q = Math.PI / 2;

// Regale des Ostflügels (x > 0): { x, z, len, ry, h }. Der Westflügel ist dieselbe Anordnung um 180° gedreht.
const ROWS = [ // quer zum Mittelgang, leicht schräg: Lesenischen zum Gang hin
  [15.5, 0.1], [10, -0.1], [4.5, 0.1], [-4.5, -0.1], [-10, 0.1], [-15.5, -0.1],
].map(([z, ry]) => ({ x: 10.5, z, len: 9.4, ry, h: 5.4 }));
const WING = [
  ...ROWS,
  // Rückwände: Nischen halb geschlossen (am äußeren Ende einer Reihe angesetzt)
  back(ROWS[2], 1, 2.4), back(ROWS[4], -1, 2.4),
  // Fischgrät außen: schräge Gassen
  { x: 25.5, z: 15.5, len: 8.6, ry: 0.45, h: 6.2 },
  { x: 25.5, z: 8, len: 8.6, ry: -0.45, h: 6.2 },
  { x: 25.5, z: 0.5, len: 8.6, ry: 0.45, h: 6.2 },
  { x: 25.5, z: -7, len: 8.6, ry: -0.45, h: 6.2 },
  { x: 25.5, z: -15.2, len: 8.6, ry: 0.45, h: 6.2 },
  // Querriegel im Zwischengang (Zickzack statt gerader Gasse)
  { x: 18.6, z: 12.6, len: 3.6, ry: Q, h: 4.6 },
  { x: 18.6, z: -3, len: 3.6, ry: Q, h: 4.6 },
];

/** Rückwand am äußeren Ende einer Reihe, dir = ±z. */
function back(r, dir, len) {
  const ex = r.x + (r.len / 2) * Math.cos(r.ry), ez = r.z - (r.len / 2) * Math.sin(r.ry);
  return { x: ex + 0.35, z: ez + dir * (len / 2 - 0.05), len, ry: Q, h: r.h };
}
/** z-Ausdehnung eines Regals (für Brücken-Freiraum). */
function zSpan(o) {
  const dz = Math.abs(Math.sin(o.ry)) * o.len / 2 + Math.abs(Math.cos(o.ry)) * 0.35;
  return [o.z - dz, o.z + dz];
}
const rot = (o) => ({ ...o, x: -o.x, z: -o.z }); // 180° um die Hochachse (Ausrichtung bleibt)
const both = (list) => [...list, ...list.map(rot)];

export default {
  id: 'bibliothek',
  seed: 7349,
  bounds: { minX: -X, maxX: X, minZ: -Z, maxZ: Z, minY: -2, maxY: H + 2 },
  visualBounds: { minX: -X - 8, maxX: X + 8, minZ: -Z - 8, maxZ: Z + 8 },
  chunkSize: 24,
  ambience: 'industrial',
  defaultSurface: 'wood',
  navSpacing: 1.2,
  groundNoise: 0.08,
  interiorTint: [1, 0.9, 0.78],
  lighting: {
    sun: { elevation: 24, azimuth: 210, color: '#cdd8ff', intensity: 0.4 },
    sky: { turbidity: 6, rayleigh: 2.4, mieCoefficient: 0.01, mieDirectionalG: 0.8, exposure: 0.3, tint: '#5a6080', clouds: { coverage: 0.7, density: 0.5, scale: 0.0002 }, hazeHigh: 0.2, hdri: false },
    hemi: { sky: '#8a7a68', ground: '#3a2a1c', intensity: 1.1 },
    env: { intensity: 1.1, ground: '#3a2c20', groundIntensity: 0.5, tint: '#d8b890' },
    fog: { color: '#3a2c22', near: 22, far: 120, density: 0.011, falloff: 0.06, start: 6, sun: 0.2, sunExp: 4 },
    shadow: { size: 30, bias: -0.0005 },
    exposure: 1.7,
    probes: { bounce: 1.25, flicker: [{ group: 3, amount: 0.25, speed: 7 }] },
    atmos: { beams: 0.02, beamG: 0.5, dust: 2.4, slots: 0.4, outdoor: 0.1 },
  },

  build(b) {
    const zones = [];
    // ------------------------------------------------------------------ Hülle
    b.groundTiled(-X, -Z, X, Z, 'wood_planks', { cell: 1.2, tint: '#6b4a30' });
    b.ground(-4.2, -20, 4.2, 20, 'tiles_pattern', { cell: 1, y: 0.01, collide: false, tint: '#a89a84' });
    b.interior(-X, -Z, X, Z, -0.1, H, 0.55);
    const wl = { h: H, t: 0.8, mat: 'stone_wall', tint: STONE, minimap: 'wall' };
    wall(b, { ...wl, x0: -X, z0: -Z, x1: X, z1: -Z });
    wall(b, { ...wl, x0: X, z0: Z, x1: -X, z1: Z });
    wall(b, { ...wl, x0: -X, z0: Z, x1: -X, z1: -Z });
    wall(b, { ...wl, x0: X, z0: -Z, x1: X, z1: Z });
    // Dach: nicht auf die Minikarte (würde die ganze Halle überdecken)
    b.boxMM(-X - 0.5, H, -Z - 0.5, X + 0.5, H + 0.6, Z + 0.5, 'stone_wall', { tint: STONE_D, minimap: false, grad: false });
    // Gurtbögen + hohe Fensterbänder (kühles Mondlicht) über den Galerien
    for (let z = -24; z <= 24; z += 8) b.box(0, H - 1, z, 2 * X, 1, 0.7, 'stone_wall', { tint: STONE_D, collide: false, minimap: false, grad: false });
    for (let z = -16; z <= 16; z += 8) for (const s of [-1, 1]) {
      b.box(s * (X - 0.42), 9, z + 4, 0.05, 3.2, 2, 'lamp_cool', { tint: '#7f96c8', collide: false, minimap: false, ao: false, cast: false });
      b.light('point', s * (X - 2), 9.5, z + 4, { color: '#8fa6e0', intensity: 12, distance: 15, realtime: false });
    }
    // ------------------------------------------------------------------ Regale (beide Flügel) + Säulen als Reihenköpfe
    const shelves = both(WING);
    shelves.forEach((o, k) => {
      const [z0, z1] = zSpan(o);
      const underBridge = BRIDGES.some((zc) => z1 > zc - BW - 0.5 && z0 < zc + BW + 0.5);
      shelf(b, o.x, o.z, o.len, underBridge ? 3.4 : o.h, 40 + k * 17, { ry: o.ry, ladder: !underBridge && o.len > 8 && k % 3 === 0 });
    });
    for (const r of both(ROWS)) {
      const sx = Math.sign(r.x), c = Math.cos(r.ry), sn = Math.sin(r.ry);
      const lx = -sx * (r.len / 2 + 0.45); // Reihenanfang am Mittelgang
      b.cyl(r.x + lx * c, 0, r.z - lx * sn, 0.5, H - 1, 'stone_wall', { tint: STONE, seg: 12, minimap: 'pillar' });
      b.box(r.x + lx * c, 0, r.z - lx * sn, 1.3, 0.45, 1.3, 'stone_wall', { tint: STONE_D, minimap: false });
    }
    // ------------------------------------------------------------------ Galerien (Längswände) + Brücken + Treppen
    for (const s of [-1, 1]) {
      const x0 = s * GAL, x1 = s * (X - 0.4);
      slab(b, Math.min(x0, x1), -GZ, Math.max(x0, x1), GZ, GY - 0.25, 0.25, 'wood_planks', [], { tint: WOOD_L, minimap: 'catwalk' });
      // Geländer zur Halle: offen zu Brücken und Treppen; Stirnseiten geschlossen
      const open = BRIDGES.map((zc) => [zc - BW, zc + BW]);
      for (const [za, zb] of [[-SZ + SW + 0.2, open[0][0]], [open[0][1], open[1][0]], [open[1][1], SZ - SW - 0.2]]) railing(b, x0, za, x0, zb, GY, { h: 1.05, mat: 'wood_dark', tint: WOOD });
      for (const zz of [-GZ, GZ]) railing(b, x0, zz, x1, zz, GY, { h: 1.05, mat: 'wood_dark', tint: WOOD });
      for (let z = -18; z <= 18; z += 6) if (BRIDGES.every((zc) => Math.abs(z - zc) > 2)) b.cyl(x0, 0, z, 0.22, GY - 0.25, 'wood_dark', { tint: WOOD, seg: 8, minimap: false });
      // Wandregale auf der Galerie (Bücher zur Halle)
      for (let z = -13.5; z <= 13.6; z += 5.4) shelf(b, s * (X - 1.2), z, 4.8, 4, 900 + z * 3 + s, { y: GY, ry: Q, face: -s, tint: WOOD });
      // Treppen in allen vier Ecken: vom Hallenboden quer zur Wand hinauf an die Innenkante der Galerie (unten frei
      // zugänglich, oben bündig mit dem Galerieboden)
      for (const zz of [-SZ, SZ]) stairs(b, { x: s * (GAL - SRUN), z: zz, dir: s > 0 ? 'e' : 'w', y0: 0, y1: GY, w: SW * 2, run: SRUN, mat: 'wood_planks', tint: WOOD_L, rail: true, railTint: WOOD });
      b.navLine(s * (GAL + 2), GY + 0.2, -GZ + 0.6, s * (GAL + 2), GY + 0.2, GZ - 0.6, 1.4);
    }
    for (const zc of BRIDGES) {
      slab(b, -GAL, zc - BW, GAL, zc + BW, GY - 0.25, 0.25, 'wood_planks', [], { tint: WOOD_L, minimap: 'catwalk' });
      railing(b, -GAL, zc - BW, GAL, zc - BW, GY, { h: 1.05, mat: 'wood_dark', tint: WOOD });
      railing(b, -GAL, zc + BW, GAL, zc + BW, GY, { h: 1.05, mat: 'wood_dark', tint: WOOD });
      b.navLine(-GAL + 0.5, GY + 0.2, zc, GAL - 0.5, GY + 0.2, zc, 1.4);
    }
    // ------------------------------------------------------------------ Rotunde (Mitte)
    b.cyl(0, 0, 0, 4.5, 0.18, 'stone_wall', { tint: '#b5a88f', seg: 32, minimap: false });
    b.cyl(0, 0.18, 0, 1.5, 1.0, 'stone_wall', { tint: STONE_D, seg: 20, minimap: 'cover' }); // Sockel des Globus
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2 + Math.PI / 6;
      readingDesk(b, Math.sin(ang) * 3.2, Math.cos(ang) * 3.2, ang, a);
    }
    // ------------------------------------------------------------------ Mittelgang, Nischen, Gassen
    for (const z of [-13.5, 13.5]) table(b, 0, z, Q);
    const deco = both([
      { t: 'table', x: 10.6, z: 7.2, ry: 0 }, { t: 'table', x: 10.6, z: -7.2, ry: 0 }, { t: 'table', x: 31.5, z: -2, ry: Q },
      { t: 'desk', x: 9, z: 12.75, ry: 0 }, { t: 'desk', x: 12, z: -12.75, ry: Math.PI }, { t: 'desk', x: 13, z: 0, ry: Q },
      { t: 'pile', x: 2.6, z: 8 }, { t: 'pile', x: 12.5, z: 12.9 }, { t: 'pile', x: 8.5, z: -12.8 }, { t: 'pile', x: 12, z: 18 },
      { t: 'pile', x: 20, z: 6 }, { t: 'pile', x: 20.5, z: -9.5 }, { t: 'pile', x: 31.5, z: 9 }, { t: 'pile', x: 31.5, z: -14 },
    ]);
    deco.forEach((d, i) => {
      if (d.t === 'table') table(b, d.x, d.z, d.ry);
      else if (d.t === 'desk') readingDesk(b, d.x, d.z, d.ry, i);
      else bookPile(b, d.x, d.z, Math.round(d.x * 7 + d.z * 3 + 50));
    });
    // ------------------------------------------------------------------ Eingangshalle (Norden, Team A)
    for (const s of [-1, 1]) {
      b.cyl(s * 14, 0, 22, 0.6, H - 1, 'stone_wall', { tint: STONE, seg: 14, minimap: 'pillar' });
      b.box(s * 9, 0, 23.6, 5, 1.15, 0.8, 'wood_dark', { tint: WOOD_L, minimap: 'cover' }); // Ausleihtheke
      b.box(s * 9, 1.15, 23.6, 5.1, 0.06, 0.9, 'wood_dark', { tint: WOOD, collide: false, minimap: false });
      bookPile(b, s * 7.5, 23.6, 300 + s, 1.15);
    }
    b.box(0, 0, Z - 0.5, 6, 6, 0.4, 'wood_dark', { tint: '#4a2e1a', minimap: false }); // Portal (geschlossen)
    zones.push({ x0: -GAL, z0: 20, x1: GAL, z1: Z, kind: 'plaza' });
    // ------------------------------------------------------------------ Verbotene Abteilung (Süden, Team B)
    for (const [xa, xb] of [[-X + 0.4, -19], [-14, -4], [4, 14], [19, X - 0.4]]) bars(b, xa, -20, xb, -20, 3.4);
    for (let x = -30; x <= 30; x += 7.5) shelf(b, x, -Z + 0.85, 6.5, 4.6, 500 + x, { ry: 0, face: 1, tint: WOOD_D });
    for (const s of [-1, 1]) shelf(b, s * 9, -23.6, 5, 2.2, 700 + s, { ry: 0, tint: WOOD_D });
    for (const x of [-22, 0, 22]) b.light('point', x, 2.4, -24, { color: '#86c08a', intensity: 6, distance: 9, realtime: false, group: 3 });
    zones.push({ x0: -GAL, z0: -Z, x1: GAL, z1: -20, kind: 'restricted' });
    // ------------------------------------------------------------------ Licht: Kronleuchter + Kerzen
    for (const z of [-14, 0, 14]) {
      chandelier(b, 0, z);
      b.light('point', 0, 8.6, z, { color: '#ffc27a', intensity: 30, distance: 22, group: 3 });
    }
    for (const d of deco) if (d.t === 'table') b.light('point', d.x, 2.4, d.z, { color: '#ffb060', intensity: 7, distance: 8, realtime: false, group: 3 });
    for (const x of [-26, 26]) b.light('point', x, 3, 0, { color: '#ffb060', intensity: 6, distance: 10, realtime: false, group: 3 });

    // ------------------------------------------------------------------ Startpunkte & Flaggen
    const spawns = { A: [], B: [], ffa: [] };
    for (const x of [-28, -21, -17, -11, -4, 0, 4, 11, 17, 21, 28]) {
      spawns.A.push({ x, z: 24.8, yaw: 0 });
      spawns.B.push({ x: -x, z: -24.8, yaw: Math.PI });
    }
    for (const { x, z } of both([[0, 17.5], [13.5, 7.2], [20, 3], [31.5, 5], [31.5, -9], [27, 4.25], [27, -3.25], [0, 7]].map(([x, z]) => ({ x, z })))) spawns.ffa.push({ x, z });
    b.navPoint(0, 0.4, 0);
    magic(b);
    return {
      spawns,
      objectives: { dom: [{ id: 'A', x: -18, z: 6, radius: 4.5 }, { id: 'B', x: 0, z: 0, radius: 5 }, { id: 'C', x: 18, z: -6, radius: 4.5 }] },
      zones,
    };
  },
};

/**
 * Bücherregal: Korpus (Kollision) + Bücherreihen (farbige Rücken). Länge entlang der lokalen x-Achse, gedreht um ry.
 * face: nur eine Seite mit Büchern (lokal ±z, z. B. an der Wand), sonst beide. ladder: Rollleiter (nur Optik).
 */
function shelf(b, x, z, len, h, seed, o = {}) {
  const y = o.y ?? 0, ry = o.ry || 0, c = Math.cos(ry), sn = Math.sin(ry);
  const w = 0.7;
  const at = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
  b.box(x, y, z, len, h, w, 'wood_dark', { ry, tint: o.tint || WOOD, minimap: y > 0 ? false : 'wall' });
  // Kranzgesims oben
  b.box(x, y + h, z, len + 0.12, 0.12, w + 0.12, 'wood_dark', { ry, tint: WOOD_D, collide: false, minimap: false, grad: false });
  const levels = Math.max(2, Math.floor(h / 0.85));
  const sides = o.face ? [o.face] : [-1, 1];
  const n = Math.max(2, Math.round(len / 1.1)), seg = len / n;
  for (const side of sides) {
    for (let l = 0; l < levels; l++) {
      const ly = y + 0.12 + l * (h - 0.2) / levels;
      for (let i = 0; i < n; i++) {
        const col = BOOK[Math.floor(hash01(seed + i, l * 3 + side, 5) * BOOK.length)];
        const bh = 0.55 + hash01(seed, i + l * 7, 9) * 0.22;
        const [px, pz] = at(-len / 2 + seg * (i + 0.5), side * (w / 2 + 0.005));
        b.box(px, ly, pz, seg - 0.06, bh, 0.06, 'wood_painted', { ry, tint: col, collide: false, minimap: false, grad: false, ao: false });
      }
    }
  }
  if (o.ladder) {
    const side = hash01(seed, 2, 3) < 0.5 ? -1 : 1, lx = (hash01(seed, 4, 5) - 0.5) * len * 0.6;
    const lean = 0.18, top = Math.min(h, 4.8);
    for (const dx of [-0.24, 0.24]) {
      const [px, pz] = at(lx + dx, side * (w / 2 + 0.06 + lean * top / 2));
      b.box(px, y, pz, 0.05, top, 0.05, 'wood_dark', { ry, rx: -side * lean, tint: WOOD_L, collide: false, minimap: false, grad: false });
    }
    for (let k = 0.35; k < top; k += 0.35) {
      const [px, pz] = at(lx, side * (w / 2 + 0.06 + lean * (top - k)));
      b.box(px, y + k, pz, 0.48, 0.03, 0.04, 'wood_dark', { ry, tint: WOOD_L, collide: false, minimap: false, grad: false, ao: false });
    }
  }
}

function table(b, x, z, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  b.box(x, 0, z, 3.2, 0.78, 1.1, 'wood_dark', { ry, tint: WOOD_L, minimap: 'cover' });
  for (const t of [-1.0, 0, 1.0]) for (const side of [-1, 1]) chair(b, x + t * c + side * 0.85 * s, z - t * s + side * 0.85 * c, { ry: ry + (side > 0 ? 0 : Math.PI), tint: '#4a2e1a' });
  b.cyl(x, 0.78, z, 0.06, 0.25, 'white', { collide: false, minimap: false, seg: 8 }); // Kerze
  b.glow(x, 1.1, z, { size: 0.8, color: '#ffb060', intensity: 0.8 });
}

function readingDesk(b, x, z, ry, k) {
  b.box(x, 0.3, z, 1.4, 0.9, 0.7, 'wood_dark', { ry, tint: WOOD, minimap: 'cover' });
  b.box(x, 0, z, 1.2, 0.3, 0.5, 'wood_dark', { ry, tint: WOOD_D, minimap: false });
  b.box(x, 1.2, z, 0.5, 0.06, 0.4, 'wood_painted', { ry: ry + 0.3, tint: BOOK[k % BOOK.length], collide: false, minimap: false }); // offenes Buch
}

function bookPile(b, x, z, seed, y0 = 0) {
  for (let i = 0; i < 6; i++) {
    const c = BOOK[Math.floor(hash01(seed, i, 3) * BOOK.length)];
    b.box(x + (hash01(seed, i, 4) - 0.5) * 0.2, y0 + i * 0.16, z + (hash01(seed, i, 6) - 0.5) * 0.2, 0.9, 0.16, 0.6, 'wood_painted', { tint: c, ry: hash01(seed, i, 7) * 0.6, collide: y0 === 0 && i === 0, minimap: y0 === 0 && i === 0 ? 'cover' : false, grad: false });
  }
  if (y0 === 0) b.box(x, 0, z, 0.9, 0.95, 0.6, 'black', { visual: false, minimap: false });
}

/** Eisengitter (Stäbe, Kollision als dünne Wand ohne Kugelschutz). */
function bars(b, xa, za, xb, zb, h) {
  const L = Math.hypot(xb - xa, zb - za), n = Math.round(L / 0.18);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.cyl(xa + (xb - xa) * t, 0, za + (zb - za) * t, 0.022, h, 'metal_painted', { tint: '#1e1e22', collide: false, seg: 5, minimap: false, ao: false });
  }
  b.box((xa + xb) / 2, h - 0.08, (za + zb) / 2, Math.abs(xb - xa) || 0.1, 0.08, Math.abs(zb - za) || 0.1, 'metal_painted', { tint: '#1e1e22', collide: false, minimap: false });
  b.box((xa + xb) / 2, 0, (za + zb) / 2, Math.abs(xb - xa) || 0.1, h, Math.abs(zb - za) || 0.1, 'black', { visual: false, bullet: false, minimap: 'wall' });
}

function chandelier(b, x, z) {
  b.cyl(x, 9.2, z, 0.04, H - 9.2, 'metal_painted', { tint: '#3a2c1c', collide: false, seg: 6, minimap: false });
  b.cyl(x, 8.8, z, 1.6, 0.12, 'metal_painted', { tint: '#6a5230', collide: false, seg: 18, minimap: false });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.cyl(x + Math.sin(a) * 1.5, 8.92, z + Math.cos(a) * 1.5, 0.05, 0.28, 'white', { collide: false, seg: 6, minimap: false });
    b.glow(x + Math.sin(a) * 1.5, 9.3, z + Math.cos(a) * 1.5, { size: 0.7, color: '#ffbe70', intensity: 1 });
  }
}

// ---------------------------------------------------------------------------
// Armillarsphäre (26.10., Etappe K0 L4)
// ---------------------------------------------------------------------------
const ARM_Y = 3.2;              // Mitte der schwebenden Sphäre
const OBLIQ = 0.4091;           // Schiefe der Ekliptik (23,44°)
const TILT = 0.7;               // Polachse gegen die Senkrechte (≈ 40° – Polhöhe 50°)

/**
 * Teilungs-Atlas (Messing, 1024 × 128, eigene Zeichnung): Zeilen 0–47 Gradteilung (1°/5°/10°, Rauten alle 30°),
 * 48–63 blankes Messing (Kanten), 64–127 Tierkreisband mit zwölf Feldern und schlichten, selbst gezeichneten
 * Zeichen (Bögen, Wellen, Striche – keine Schrift).
 */
function drawScaleAtlas(ctx, W, H) {
  ctx.scale(W / 1024, H / 128);
  const brass = (y0, y1, a = 0) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#8a6a36'); g.addColorStop(0.5, a ? '#c79f5e' : '#d2ab6a'); g.addColorStop(1, '#8a6a36');
    ctx.fillStyle = g; ctx.fillRect(0, y0, 1024, y1 - y0);
  };
  brass(0, 48); brass(48, 64, 1); brass(64, 128);
  const ink = 'rgba(40,26,10,0.9)';
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  // Gradteilung: 360 Striche auf 1024 px (eine Umdrehung = Wiederholung 1)
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(1024, 4); ctx.moveTo(0, 44); ctx.lineTo(1024, 44); ctx.stroke();
  for (let d = 0; d < 360; d++) {
    const x = (d / 360) * 1024, L = d % 10 === 0 ? 30 : d % 5 === 0 ? 20 : 11;
    ctx.lineWidth = d % 10 === 0 ? 1.6 : 0.9;
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, 4 + L); ctx.stroke();
    if (d % 30 === 0) { ctx.beginPath(); ctx.moveTo(x, 36); ctx.lineTo(x + 3, 40); ctx.lineTo(x, 44); ctx.lineTo(x - 3, 40); ctx.closePath(); ctx.fill(); }
  }
  // Tierkreisband: Randlinien, zwölf Felder, je ein Zeichen aus einfachen Strichen
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, 68); ctx.lineTo(1024, 68); ctx.moveTo(0, 124); ctx.lineTo(1024, 124); ctx.stroke();
  for (let k = 0; k < 12; k++) {
    const x0 = (k / 12) * 1024, cx = x0 + 1024 / 24, cy = 96;
    ctx.beginPath(); ctx.moveTo(x0, 68); ctx.lineTo(x0, 124); ctx.stroke();
    for (let m = 1; m < 6; m++) { const x = x0 + (m / 6) * (1024 / 12); ctx.beginPath(); ctx.moveTo(x, 68); ctx.lineTo(x, 74); ctx.stroke(); }
    ctx.lineWidth = 2.2; ctx.beginPath();
    switch (k % 6) {
      case 0: ctx.arc(cx - 7, cy - 4, 8, Math.PI, 0); ctx.moveTo(cx + 1, cy - 4); ctx.arc(cx + 9, cy - 4, 8, Math.PI, 0); ctx.moveTo(cx + 1, cy - 4); ctx.lineTo(cx + 1, cy + 14); break;
      case 1: ctx.arc(cx, cy + 4, 10, 0, Math.PI * 2); ctx.moveTo(cx - 12, cy - 14); ctx.quadraticCurveTo(cx, cy - 2, cx + 12, cy - 14); break;
      case 2: ctx.moveTo(cx - 10, cy - 12); ctx.lineTo(cx + 10, cy - 12); ctx.moveTo(cx - 10, cy + 12); ctx.lineTo(cx + 10, cy + 12); ctx.moveTo(cx - 5, cy - 12); ctx.lineTo(cx - 5, cy + 12); ctx.moveTo(cx + 5, cy - 12); ctx.lineTo(cx + 5, cy + 12); break;
      case 3: for (const sy of [-6, 6]) { ctx.moveTo(cx - 13, cy + sy); for (let i = 0; i <= 4; i++) ctx.lineTo(cx - 13 + i * 6.5, cy + sy + (i % 2 ? -5 : 5)); } break;
      case 4: ctx.arc(cx, cy, 11, 0.4, Math.PI * 2 - 0.4); ctx.moveTo(cx + 11, cy - 4); ctx.lineTo(cx + 16, cy - 10); break;
      default: ctx.moveTo(cx - 12, cy + 12); ctx.lineTo(cx + 12, cy - 12); ctx.moveTo(cx + 2, cy - 12); ctx.lineTo(cx + 12, cy - 12); ctx.lineTo(cx + 12, cy - 2); ctx.moveTo(cx - 8, cy - 2); ctx.lineTo(cx + 2, cy + 8);
    }
    ctx.stroke(); ctx.lineWidth = 1.6;
  }
}
let scaleTex = null, scaleSize = 0;
function scaleAtlas(quality) {
  const W = Math.round(1024 * atlasScale(quality));
  if (!scaleTex || scaleSize !== W) {
    scaleTex = atlasTexture(W, W / 8, (ctx, w, h) => drawScaleAtlas(ctx, w, h), { anisotropy: 8, name: 'armillar' });
    scaleTex.wrapS = THREE.RepeatWrapping; scaleSize = W;
  }
  return scaleTex;
}
// v-Bereiche der Atlas-Zeilen (Canvas oben = v 1)
const V_SCALE = [1 - 48 / 128, 1 - 2 / 128], V_PLAIN = [1 - 62 / 128, 1 - 50 / 128], V_ZODIAC = [2 / 128, 62 / 128];

/** Offenes Band (Zylindermantel) um die y-Achse: Radius r, Höhe h, UV u = Umlauf × rep, v über die Höhe. */
function bandGeom(r, h, v, rep = 1, segs = 96) {
  const P = [], U = [], N = [], I = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const k of [0, 1]) { P.push(r * c, (k - 0.5) * h, r * s); N.push(c, 0, s); U.push((i / segs) * rep, v[k]); }
    if (i < segs) { const o = i * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  return g;
}
/** Kreisring (Scheibe mit Loch) in der xz-Ebene, Teilung radial: v von innen (r0) nach außen (r1). */
function annulusGeom(r0, r1, v, rep = 1, segs = 96) {
  const P = [], U = [], N = [], I = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    P.push(r0 * c, 0, r0 * s, r1 * c, 0, r1 * s); N.push(0, 1, 0, 0, 1, 0); U.push((i / segs) * rep, v[0], (i / segs) * rep, v[1]);
    if (i < segs) { const o = i * 2; I.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  return g;
}
/** Flacher Messingring mit Stärke: Vorder-/Rückseite geteilt (Annulus), Innen-/Außenkante blank. */
function flatRing(r0, r1, th) {
  const top = annulusGeom(r0, r1, V_SCALE); top.translate(0, th / 2, 0);
  const bot = annulusGeom(r0, r1, V_SCALE); bot.rotateX(Math.PI); bot.translate(0, -th / 2, 0);
  return mergeGeometries([top, bot, bandGeom(r1, th, V_PLAIN, 6), bandGeom(r0, th, V_PLAIN, 6)]);
}
const stripUv = (g) => { g.deleteAttribute('uv'); return g; };

/**
 * Armillarsphäre: fester Meridian- und Horizontring (geteilt), drehendes Gestell (Äquator- und Tierkreisband, Wende-
 * und Polarkreise, zwei Koluren, Polachse mit Knäufen), innen eine leuchtende Glaskugel; Ständer mit Baluster und drei
 * geschwungenen Beinen auf Löwentatzen auf dem Steinsockel (Oberkante 1,18 m). Ohne Kollision (über Kopfhöhe bzw.
 * auf dem Sockel). → { stand, globe, rete, glass }
 */
function armillarySphere(b) {
  const tex = scaleAtlas(b.quality || 'high');
  const brass = new THREE.MeshStandardMaterial({ color: '#b48d52', metalness: 1, roughness: 0.34, emissive: '#2a1c0a', emissiveIntensity: 0.35, name: 'messing' });
  const scale = new THREE.MeshStandardMaterial({ map: tex, color: '#ffffff', metalness: 1, roughness: 0.38, emissive: '#2a1c0a', emissiveIntensity: 0.3, side: THREE.DoubleSide, name: 'messing-teilung' });
  const glass = new THREE.MeshStandardMaterial({ color: '#1c3048', emissive: '#4c84c8', emissiveIntensity: 0.9, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false, name: 'glaskugel' });
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.8, 2.3), name: 'glaskern' });
  // Ständer (statisch, eine Geometrie): Baluster auf Fußplatte, drei S-Beine mit Tatzen, Schale unter dem Meridian
  const top = 1.18;
  const prof = [[0.001, 0], [0.2, 0], [0.2, 0.03], [0.15, 0.05], [0.09, 0.1], [0.075, 0.18], [0.11, 0.24], [0.06, 0.3], [0.05, 0.36], [0.085, 0.4], [0.13, 0.44], [0.001, 0.44]];
  const parts = [new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, top + y)), 24)];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5, c = Math.cos(a), s = Math.sin(a);
    const P = (r, y) => new THREE.Vector3(c * r, top + y, s * r);
    const curve = new THREE.CatmullRomCurve3([P(0.1, 0.2), P(0.26, 0.24), P(0.42, 0.15), P(0.52, 0.06), P(0.6, 0.035)]);
    parts.push(new THREE.TubeGeometry(curve, 16, 0.026, 6, false));
    const paw = new THREE.SphereGeometry(1, 10, 6); paw.scale(0.075, 0.045, 0.06); paw.rotateY(-a); paw.translate(c * 0.64, top + 0.04, s * 0.64);
    parts.push(paw);
    for (const d of [-0.035, 0, 0.035]) { const toe = new THREE.SphereGeometry(0.022, 6, 4); toe.translate(c * 0.7 - s * d, top + 0.02, s * 0.7 + c * d); parts.push(toe); }
  }
  const cup = new THREE.TorusGeometry(0.16, 0.018, 6, 24); cup.rotateX(Math.PI / 2); cup.translate(0, top + 0.44, 0);
  parts.push(cup);
  const stand = new THREE.Mesh(mergeGeometries(parts.map((p) => stripUv(p.index ? p.toNonIndexed() : p))), brass);
  stand.name = 'armillar-staender';
  // schwebende Sphäre
  const globe = new THREE.Group();
  globe.name = 'armillarsphaere';
  globe.position.set(0, ARM_Y, 0);
  // fest: Meridian (senkrecht, enthält die Polachse) + Horizont (waagrecht)
  const mer = flatRing(1.31, 1.42, 0.02); mer.rotateX(Math.PI / 2);
  const hor = flatRing(1.5, 1.63, 0.02);
  const fixed = new THREE.Mesh(mergeGeometries([mer, hor]), scale);
  fixed.name = 'armillar-meridian';
  // Gestell um die Polachse (gekippt in der Meridianebene); innen dreht sich die Sphäre um die Achse
  const tilt = new THREE.Group(); tilt.rotation.z = TILT;
  const rete = new THREE.Group();
  const R = 1.18;
  const eq = bandGeom(R, 0.055, V_SCALE, 1);
  const ecl = bandGeom(R - 0.004, 0.12, V_ZODIAC, 1); ecl.rotateX(OBLIQ);
  const bands = new THREE.Mesh(mergeGeometries([eq, ecl]), scale);
  const thin = [];
  for (const lat of [OBLIQ, -OBLIQ, Math.PI / 2 - OBLIQ, -(Math.PI / 2 - OBLIQ)]) {
    const t2 = new THREE.TorusGeometry(R * Math.cos(lat), 0.011, 5, 64); t2.rotateX(Math.PI / 2); t2.translate(0, R * Math.sin(lat), 0); thin.push(t2);
  }
  for (const ry of [0, Math.PI / 2]) { const t2 = new THREE.TorusGeometry(R, 0.014, 5, 72); t2.rotateY(ry); thin.push(t2); }
  const axis = new THREE.CylinderGeometry(0.016, 0.016, 3.0, 8); thin.push(axis);
  for (const sy of [-1, 1]) { const kn = new THREE.SphereGeometry(0.045, 10, 6); kn.translate(0, sy * 1.52, 0); thin.push(kn); }
  const frame = new THREE.Mesh(mergeGeometries(thin.map((p) => stripUv(p.index ? p.toNonIndexed() : p))), brass);
  const glassM = new THREE.Mesh(new THREE.SphereGeometry(0.3, 28, 16), glass);
  const coreM = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 8), core);
  glassM.renderOrder = 2;
  rete.add(bands, frame, glassM, coreM);
  tilt.add(rete);
  globe.add(fixed, tilt);
  for (const m of [brass, scale, glass, core]) m.userData.disposable = true;
  b.glow(0, ARM_Y, 0, { size: 1.5, color: '#9cc4ff', intensity: 0.55 });
  return { stand, globe, rete, glass: glassM };
}

/** Fliegende Bücher, schwebende Kerzen und die Armillarsphäre (animierte Einzelobjekte). */
function magic(b) {
  const g = new THREE.Group();
  g.name = 'magie';
  const bookGeo = new THREE.BoxGeometry(0.42, 0.08, 0.3);
  const pageGeo = new THREE.BoxGeometry(0.38, 0.06, 0.27);
  const pageMat = new THREE.MeshStandardMaterial({ color: '#efe4c8', roughness: 0.9 });
  const mats = BOOK.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const books = [];
  for (let i = 0; i < 46; i++) {
    const bk = new THREE.Group();
    const cover = new THREE.Mesh(bookGeo, mats[i % mats.length]);
    const pages = new THREE.Mesh(pageGeo, pageMat);
    pages.position.set(0.015, 0, 0);
    bk.add(cover, pages);
    const ring = i < 16;
    books.push({
      o: bk, ring,
      cx: ring ? 0 : (hash01(i, 1, 2) - 0.5) * 60, cz: ring ? 0 : (hash01(i, 3, 4) - 0.5) * 38,
      r: ring ? 3.4 + hash01(i, 5, 6) * 1.8 : 1 + hash01(i, 7, 8) * 2.5,
      y: ring ? 4.6 + hash01(i, 9, 10) * 2.2 : 7 + hash01(i, 11, 12) * 3.2,
      sp: (0.15 + hash01(i, 13, 14) * 0.25) * (i % 2 ? 1 : -1), ph: hash01(i, 15, 16) * 6.28,
    });
    g.add(bk);
  }
  // schwebende Kerzen über dem Mittelgang
  const candleGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8);
  const candleMat = new THREE.MeshStandardMaterial({ color: '#f2ead8', roughness: 0.6 });
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffcf80' });
  const flameGeo = new THREE.SphereGeometry(0.035, 6, 5);
  const candles = [];
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Group();
    const body = new THREE.Mesh(candleGeo, candleMat);
    const fl = new THREE.Mesh(flameGeo, flameMat);
    fl.position.y = 0.19;
    c.add(body, fl);
    const x = (hash01(i, 21, 22) - 0.5) * 7, z = -19 + (i / 40) * 38, y = 6.6 + hash01(i, 23, 24) * 2;
    c.position.set(x, y, z);
    candles.push({ o: c, y, ph: hash01(i, 25, 26) * 6.28 });
    g.add(c);
  }
  // Armillarsphäre über der Rotunde (26.10., K0 „Sofort-Fehler“ L4; vorher glatte blaue Kugel mit drei Ringen –
  // Spielzeug statt Messing): Ständer mit Löwentatzen auf dem Steinsockel, darüber die schwebende Sphäre
  const arm = armillarySphere(b);
  g.add(arm.stand, arm.globe);
  const globe = arm.globe;
  let t = 0;
  b.object(g, {
    update(dt) {
      t += dt || 0.016;
      for (const bk of books) {
        const a = bk.ph + t * bk.sp;
        bk.o.position.set(bk.cx + Math.cos(a) * bk.r, bk.y + Math.sin(t * 0.8 + bk.ph) * 0.35, bk.cz + Math.sin(a) * bk.r);
        bk.o.rotation.set(Math.sin(t + bk.ph) * 0.3, -a, Math.sin(t * 1.3 + bk.ph) * 0.25);
      }
      for (const c of candles) c.o.position.y = c.y + Math.sin(t * 0.9 + c.ph) * 0.12;
      globe.rotation.y = t * 0.06;
      arm.rete.rotation.y = t * 0.22;
      arm.glass.rotation.y = -t * 0.3;
      globe.position.y = ARM_Y + Math.sin(t * 0.6) * 0.05;
    },
  });
}
