// NULLPUNKT — Karte „Bibliothek“: alte Zauberbibliothek im Stil einer Schloss-Internatsbibliothek (x −38..38, z −27..27,
// 13 m hoch). Mittelgang mit langen Lesetischen und einer Rotunde (schwebender Himmelsglobus); links und rechts hohe,
// dunkle Regale: Reihen quer zum Gang bilden halb geschlossene Lesenischen, außen schräge Fischgrät-Gassen und
// Querriegel – verwinkelt, kurze Sichtlinien, Leitern an den Regalen. Galerien an den Längswänden (4,4 m) mit Treppen in
// allen vier Ecken, zwei Holzbrücken quer über die Halle. Norden: Eingangshalle mit Ausleihtheken (Team A), Süden:
// Verbotene Abteilung hinter Eisengittern mit drei Durchgängen (Team B). Beide Hälften punktsymmetrisch (fair).
// Magie: fliegende Bücher, schwebende Kerzen, Globus mit Ringen (ohne Kollision, über Kopfhöhe). (Owner: world)
import * as THREE from 'three';
import { wall, slab, stairs, railing } from '../arch.js';
import { chair, hash01 } from '../props.js';

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

/** Fliegende Bücher, schwebende Kerzen und der Himmelsglobus (animierte Einzelobjekte). */
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
  // Himmelsglobus mit Ringen (Rotunde)
  const globe = new THREE.Group();
  globe.position.set(0, 3.2, 0);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 28, 18), new THREE.MeshStandardMaterial({ color: '#2a3d6a', emissive: '#1a2a5a', emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3 }));
  const ringMat = new THREE.MeshStandardMaterial({ color: '#c8a050', roughness: 0.35, metalness: 0.9, emissive: '#3a2a10', emissiveIntensity: 0.4 });
  const rings = [0, 1, 2].map((k2) => { const m = new THREE.Mesh(new THREE.TorusGeometry(1.5 + k2 * 0.28, 0.035, 8, 48), ringMat); m.rotation.x = 0.5 + k2 * 0.7; return m; });
  globe.add(sphere, ...rings);
  g.add(globe);
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
      globe.rotation.y = t * 0.15;
      sphere.rotation.y = t * 0.35;
      rings.forEach((m, k2) => { m.rotation.z = t * (0.2 + k2 * 0.12) * (k2 % 2 ? -1 : 1); });
      globe.position.y = 3.2 + Math.sin(t * 0.6) * 0.15;
    },
  });
}
