// NULLPUNKT — Großkarte „Niemandsland“ (Stellungskrieg, Wunschliste 10.10.; ≈ 600 × 600 m, größer als Grenzland).
// Zerwühltes Ödland unter grauem Himmel: Jede Seite hält eine gezackte Frontlinie (Grabensohle 2 m, Bretterwände,
// Lattenroste, Sandsack-Brustwehr, Ausstiegsrampen) und dahinter eine Unterstützungslinie, verbunden durch Laufgräben.
// Dazwischen das Niemandsland: Hunderte Granattrichter (die tiefsten voll Wasser), Stacheldrahtgürtel vor beiden
// Fronten, zersplitterte Baumstümpfe, eine Dorfruine (West) und eine Kapellenruine (Ost) mit zerstörbaren Mauern, in
// der Mitte ein liegengebliebener Panzer. Team A im Süden (+z), Team B im Norden (−z). (Owner: world)
import { wall } from '../arch.js';
import { sandbags, crateStack, barrelGroup } from '../props.js';
import { sampleSpline } from '../terrain/generate.js';

const FRONT = 118, SUPPORT = 162, HQZ = 238; // |z| der Linien je Seite
const XL = 268;                               // Ausdehnung der Gräben in x

/** Gezackte Linie (Feuerbuchten): Zacken alle `step` m, Ausschlag ±amp. */
function zig(z, x0, x1, step = 13, amp = 3.2) {
  const pts = [];
  let k = 0;
  for (let x = x0; x <= x1 + 0.01; x += step) pts.push([x, z + (k++ % 2 ? amp : -amp)]);
  return pts;
}

/** Grabensystem einer Seite (s = +1 Süd/Team A, −1 Nord/Team B). */
function trenchesOf(s) {
  const front = zig(s * FRONT, -XL, XL);
  const support = zig(s * SUPPORT, -XL + 20, XL - 20, 17, 2.4);
  const out = [
    { pts: front, width: 2.2, depth: 2.0, ramps: front.filter((_, i) => i % 4 === 2).map(([x, z]) => [x, z - s * 0.2]) },
    { pts: support, width: 2.2, depth: 2.0, ramps: support.filter((_, i) => i % 6 === 3) },
  ];
  // Laufgräben Front ↔ Unterstützung (mit Knick) und zur Basis
  for (const x of [-200, -90, 30, 150]) {
    out.push({ pts: [[x, s * (FRONT + 1)], [x + 6, s * (FRONT + 18)], [x - 4, s * (FRONT + 32)], [x + 2, s * (SUPPORT - 1)]], width: 1.8, depth: 1.9 });
  }
  out.push({ pts: [[-20, s * (SUPPORT + 1)], [-14, s * (SUPPORT + 25)], [-24, s * (SUPPORT + 48)], [-18, s * (HQZ - 22)]], width: 1.8, depth: 1.9, ramps: [[-18, s * (HQZ - 22)]] });
  return out;
}
export const TRENCHES = [...trenchesOf(1), ...trenchesOf(-1)];

/** z der (geraden) Grabenlinie bei x – Startpunkte liegen auf der Sohle. */
function lineZ(pts, x) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    if (x >= ax && x <= bx) return az + ((bz - az) * (x - ax)) / (bx - ax || 1);
  }
  return pts[pts.length - 1][1];
}
// Grabenkurve wie im Gelände (terrain/generate.js: Spline, 1,5 m) – Startpunkte genau auf der Sohle
const SUP_A = sampleSpline(zig(SUPPORT, -XL + 20, XL - 20, 17, 2.4), 1.5), SUP_B = sampleSpline(zig(-SUPPORT, -XL + 20, XL - 20, 17, 2.4), 1.5);

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------
const WOOD = '#6b5a44', WOOD_D = '#4a3e30', STONE = '#9a9286';

/** Ruine eines Hauses: Mauern unterschiedlich hoch abgebrochen (zerstörbar), Schutt davor. */
function ruin(b, x, z, w, d, seed, o = {}) {
  const r = (k) => { const v = Math.sin((seed + k) * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, t = 0.45;
  const mat = o.mat || 'stone_wall', tint = o.tint || STONE;
  const sides = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  sides.forEach(([ax, az, bx, bz], k) => {
    if (r(k) < 0.18) return; // ganz eingestürzt
    const h = 1.2 + r(k + 7) * (o.h || 4.5);
    const L = Math.hypot(bx - ax, bz - az);
    wall(b, { x0: ax, z0: az, x1: bx, z1: bz, h, t, mat, tint, destructible: true, minimap: 'wall',
      openings: [{ at: L * (0.3 + r(k + 3) * 0.4), w: 1.4, h: Math.min(h, 2.3), kind: 'gap' }] });
  });
  // Schutthaufen
  for (let i = 0; i < 6; i++) {
    const a = r(i + 20) * Math.PI * 2, dd = r(i + 30) * w * 0.6;
    b.box(x + Math.cos(a) * dd, 0, z + Math.sin(a) * dd, 1 + r(i + 40) * 1.8, 0.3 + r(i + 50) * 0.6, 1 + r(i + 60) * 1.4, mat, { tint: '#8a8276', ry: r(i + 70) * 3, minimap: 'cover' });
  }
}

/** Liegengebliebener Panzer (Rhombus-Form wie 1916): Rumpf, Kettenschürzen, Erkertürme, abgerissene Kette. */
function tankWreck(b, x, z, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const steel = 'metal_painted', tint = '#4b4a3c';
  b.box(x, 0.2, z, 3.6, 2.1, 8.0, steel, { ry, tint, minimap: 'vehicle' });
  for (const sx of [-1, 1]) {
    const [px, pz] = P(sx * 2.0, 0);
    b.box(px, 0, pz, 0.6, 2.5, 9.2, steel, { ry, tint: '#3a392f', minimap: false });
    const [ex, ez] = P(sx * 2.45, 0.5);
    b.box(ex, 0.9, ez, 0.9, 1.1, 2.4, steel, { ry, tint, minimap: false }); // Erker
  }
  const [tx, tz] = P(0, -1);
  b.box(tx, 2.3, tz, 1.4, 0.8, 1.6, steel, { ry, tint, minimap: false });
  // abgerissene Kettenglieder im Schlamm
  for (let i = 0; i < 6; i++) { const [kx, kz] = P(-2.8 - i * 0.05, 4.8 + i * 0.6); b.box(kx, 0.02, kz, 0.6, 0.08, 0.32, 'metal_rust', { ry: ry + i * 0.12, collide: false, minimap: false }); }
}

/** Unterstand/Gefechtsstand an der Basis: Balkendecke auf Sandsäcken, Kisten, Fässer. */
function dugout(b, x, z, s) {
  sandbags(b, x - 4, z + s * 3, x + 4, z + s * 3, { rows: 5 });
  sandbags(b, x - 4, z - s * 3, x - 4, z + s * 3, { rows: 5 });
  sandbags(b, x + 4, z - s * 3, x + 4, z + s * 3, { rows: 5 });
  b.box(x, 1.75, z, 8.6, 0.3, 6.6, 'wood_planks', { tint: WOOD, minimap: 'roof' });
  for (let k = -3; k <= 3; k++) b.box(x + k * 1.25, 2.05, z, 0.25, 0.25, 6.8, 'wood_dark', { tint: WOOD_D, collide: false, minimap: false });
  crateStack(b, x - 2.6, z, { n: 3 });
  barrelGroup(b, x + 2.4, z - s * 1.4, { n: 3 });
}

// ---------------------------------------------------------------------------
// Gräben, Draht, Bäume (nach dem Gelände: braucht Geländehöhen)
// ---------------------------------------------------------------------------
function frontWorks(b, ctx) {
  const hf = ctx.hf;
  const H = (x, z) => hf.heightAt(x, z);
  const clearLines = [];
  // Grabenauskleidung: Bretterwände beidseits, Lattenrost auf der Sohle, Sandsäcke auf der Feindseite
  for (const tr of TRENCHES) {
    const hw = tr.width / 2;
    clearLines.push({ pts: tr.pts, r: hw + 2 });
    // Abtastung entlang der Linie (≈ 3 m)
    const pts = [];
    for (let k = 0; k < tr.pts.length - 1; k++) {
      const [ax, az] = tr.pts[k], [bx, bz] = tr.pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 3));
      for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
    }
    pts.push(tr.pts[tr.pts.length - 1]);
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.3) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, ry = Math.atan2(-uz, ux);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const floor = H(mx, mz);
      const edge = Math.min(H(mx + nx * (hw + 0.7), mz + nz * (hw + 0.7)), H(mx - nx * (hw + 0.7), mz - nz * (hw + 0.7)));
      if (edge - floor < 1.2) continue; // Rampe / flach: keine Auskleidung
      b.box(mx, floor + 0.02, mz, L + 0.05, 0.07, 0.9, 'wood_planks', { ry, tint: WOOD, minimap: false, grad: false });
      for (const side of [-1, 1]) {
        const wx = mx + nx * side * (hw - 0.05), wz = mz + nz * side * (hw - 0.05);
        b.box(wx, floor, wz, L + 0.04, Math.max(0.6, edge - floor - 0.1), 0.08, 'wood_planks', { ry, tint: side > 0 ? WOOD : WOOD_D, minimap: false, uv: 'local' });
        if (k % 2 === 0) b.cyl(wx, floor, wz, 0.07, edge - floor + 0.25, 'wood_dark', { tint: WOOD_D, collide: false, minimap: false, seg: 6 });
      }
    }
  }
  // Stacheldrahtgürtel vor beiden Fronten (Lücken alle ~60 m): Pfähle + drei Drähte + Kreuzdrähte (nur Optik)
  for (const s of [1, -1]) {
    const z = s * (FRONT - 14);
    for (let x = -XL + 8; x < XL - 8; x += 3) {
      if (((x + XL) % 60) > 50) continue;
      const zz = z + Math.sin(x * 0.37) * 1.2, y0 = H(x, zz), y1 = H(x + 3, zz);
      b.cyl(x, y0 - 0.1, zz, 0.035, 1.35, 'wood_dark', { tint: '#3d3328', collide: false, minimap: false, seg: 5, rz: Math.sin(x) * 0.12 });
      for (const hy of [0.35, 0.75, 1.15]) {
        const L = Math.hypot(3, y1 - y0);
        b.cyl(x + 1.5, (y0 + y1) / 2 + hy, zz, 0.006, L, 'metal_rust', { axis: 'x', rz: Math.atan2(y1 - y0, 3), collide: false, minimap: false, seg: 3, ao: false });
      }
      b.cyl(x + 1.5, y0 + 0.7, zz, 0.006, 3.4, 'metal_rust', { axis: 'x', rz: 0.42, ry: 0.25, collide: false, minimap: false, seg: 3, ao: false });
    }
  }
  // Zersplitterte Bäume (Kollision am Stamm), vor allem im Niemandsland
  let sd = 2718;
  const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 150; i++) {
    const x = -XL + rnd() * XL * 2, z = (rnd() - 0.5) * 2 * (SUPPORT + 30);
    if (TRENCHES.some((tr) => tr.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 6))) continue;
    const y = H(x, z), h = 1.6 + Math.pow(rnd(), 1.5) * 7, r = 0.16 + rnd() * 0.2;
    const tilt = (rnd() - 0.5) * 0.25;
    b.cyl(x, y - 0.3, z, r, h, 'wood_dark', { tint: '#4e463c', seg: 7, rz: tilt, r1: r * 0.55, minimap: 'cover' });
    if (rnd() < 0.6) b.cyl(x + 0.2, y + h * 0.6, z, 0.07, 1.4 + rnd(), 'wood_dark', { tint: '#4e463c', seg: 5, rz: 0.9 + rnd() * 0.5, ry: rnd() * 6, collide: false, minimap: false });
  }
  // Sandsack-Stellungen hinter der Front (MG-Nester der Verteidiger)
  for (const s of [1, -1]) for (const x of [-210, -120, -40, 50, 130, 215]) {
    const z = s * (FRONT + 7), y = H(x, z);
    sandbags(b, x - 2.4, z, x + 2.4, z, { rows: 3, y });
  }
  return { clearLines };
}

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------
export default {
  id: 'niemandsland',
  name: 'Niemandsland',
  scale: 'gross',
  seed: 1916,
  bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300, minY: -10, maxY: 80 },
  ambience: 'range',
  defaultSurface: 'dirt',
  wallMargin: 40,
  lighting: {
    // bedeckt: Sonne hoch und schwach, kein Hof um die Sonne (blendete tief im Gegenlicht – Nutzer 11.10.)
    sun: { elevation: 42, azimuth: 200, color: '#ddd6ca', intensity: 1.25 },
    sky: { turbidity: 6, rayleigh: 1.2, mieCoefficient: 0.004, mieDirectionalG: 0.55, exposure: 0.36, tint: '#bdbab2', clouds: { coverage: 0.92, density: 0.72, scale: 0.00018, elevation: 0.5 }, hazeHigh: 0.25, hazeAmount: 1.1, hdri: false },
    hemi: { sky: '#a6a59c', ground: '#4a4034', intensity: 0.85 },
    env: { intensity: 0.9, ground: '#4a4034', groundIntensity: 0.5, tint: '#e2ddd2' },
    fog: { color: '#8f8a80', nearFactor: 0.12, density: 0.006, falloff: 0.03, start: 18, max: 0.92, sun: 0.06, sunExp: 10 },
    shadow: { size: 60, bias: -0.0004, normalBias: 0.04, near: 40, farMaxY: 40 },
    exposure: 1.0,
    atmos: { beams: 0, beamG: 0.4, dust: 1.2, dustSize: 0.018 },
  },
  water: { color: '#3b3a30' },

  terrain: {
    size: 760, res: 1, seed: 1916,
    base: { amp: 2.6, scale: 210, octaves: 5, offset: 0.6 },
    detail: { amp: 0.42, scale: 8 },
    hills: [{ x: -150, z: 0, r: 70, h: 3 }, { x: 160, z: 20, r: 60, h: 4 }, { x: 0, z: 250, r: 80, h: 3 }, { x: 0, z: -250, r: 80, h: 3 }],
    edge: { start: 318, end: 380, height: 26 },
    waterY: -2.4,
    pads: [
      { x: -120, z: 0, w: 56, d: 46, y: 0.4, blend: 14 },  // Dorfruine
      { x: 125, z: -6, w: 34, d: 30, y: 0.6, blend: 12 },  // Kapellenruine
      { x: 0, z: HQZ, w: 80, d: 36, y: 0.5, blend: 16 },    // Basis A
      { x: 0, z: -HQZ, w: 80, d: 36, y: 0.5, blend: 16 },   // Basis B
    ],
    trenches: TRENCHES,
    craters: {
      seed: 1918, count: 950, area: { minX: -290, maxX: 290, minZ: -150, maxZ: 150 }, r: [1.4, 6.5], depth: [0.5, 1.9],
      avoid: [[FRONT, 6], [-FRONT, 6], [SUPPORT, 5], [-SUPPORT, 5]],
      list: [[0, 0, 9, 3.2], [-40, 30, 7, 2.6], [55, -35, 7.5, 2.8], [-200, 60, 6, 2.4], [210, -55, 6.5, 2.5], [-70, -70, 5.5, 2.2], [90, 70, 6, 2.3]],
    },
    wasteland: { dirt: 0.96, mud: 0.6 },
  },

  vegetation: {
    seed: 19, forests: [], scatter: { count: 0 }, hedges: [],
    rocks: { count: 30, clusters: [] },
  },
  clearings: [[0, 0, 40]],

  sites: [
    { id: 'dorfruine', name: 'Dorfruine', y: 0.4, bounds: { minX: -150, maxX: -90, minZ: -26, maxZ: 26 }, build: (b) => {
      ruin(b, -132, -12, 10, 8, 3); ruin(b, -112, -14, 9, 9, 7); ruin(b, -136, 10, 8, 10, 11);
      ruin(b, -110, 12, 12, 8, 17, { h: 5.5 }); ruin(b, -96, -2, 7, 7, 23, { h: 3 });
      for (let i = 0; i < 5; i++) sandbags(b, -125 + i * 4, -22, -122 + i * 4, -22, { rows: 2 });
    }, seeds: [[-120, 0, 0.4]], height: 8 },
    { id: 'kapelle', name: 'Kapellenruine', y: 0.6, bounds: { minX: 106, maxX: 144, minZ: -24, maxZ: 12 }, build: (b) => {
      ruin(b, 125, -6, 12, 20, 31, { h: 6.5, tint: '#a8a092' });
      b.box(125, 0, -18, 2.2, 7.5, 2.2, 'stone_wall', { tint: '#a8a092', minimap: 'pillar' }); // Rest des Turms
      crateStack(b, 118, 6, { n: 2 });
    }, seeds: [[125, -6, 0.6]], height: 10 },
    { id: 'mitte', name: 'Panzerwrack', bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, build: (b) => tankWreck(b, 8, 12, 0.6), seeds: [[0, 18]], height: 6 },
    { id: 'basis_a', name: 'Basis A', y: 0.5, bounds: { minX: -40, maxX: 40, minZ: HQZ - 18, maxZ: HQZ + 18 }, build: (b) => { dugout(b, -18, HQZ, 1); dugout(b, 18, HQZ + 2, 1); }, seeds: [[0, HQZ, 0.5]], nav: true },
    { id: 'basis_b', name: 'Basis B', y: 0.5, bounds: { minX: -40, maxX: 40, minZ: -HQZ - 18, maxZ: -HQZ + 18 }, build: (b) => { dugout(b, -18, -HQZ, -1); dugout(b, 18, -HQZ - 2, -1); }, seeds: [[0, -HQZ, 0.5]], nav: true },
  ],
  lateSites: [
    { id: 'front', name: 'Gräben und Draht', bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, chunkSize: 80, build: (b, ctx) => frontWorks(b, ctx) },
  ],

  flags: {
    cq: [
      { id: 'A', name: 'Stellung Süd', x: -150, z: FRONT + 1, radius: 20, heightBand: [-4, 6] },
      { id: 'B', name: 'Dorfruine', x: -120, z: 0, y: 0.4, radius: 24, heightBand: [-4, 8] },
      { id: 'C', name: 'Trichterfeld', x: 0, z: 0, radius: 22, heightBand: [-5, 6] },
      { id: 'D', name: 'Kapellenruine', x: 125, z: -6, y: 0.6, radius: 20, heightBand: [-4, 8] },
      { id: 'E', name: 'Stellung Nord', x: 150, z: -FRONT - 1, radius: 20, heightBand: [-4, 6] },
    ],
    dom: [
      { id: 'A', name: 'Dorfruine', x: -120, z: 0, y: 0.4, radius: 9 },
      { id: 'B', name: 'Trichterfeld', x: 0, z: 0, radius: 9 },
      { id: 'C', name: 'Kapellenruine', x: 125, z: -6, y: 0.6, radius: 9 },
    ],
  },
  // Startpunkte [x, z, yaw]: Teamkampf in der Unterstützungslinie (in den Gräben), Eroberung an der Basis
  spawns: {
    A: [-150, -100, -50, 0, 50, 100, 150, 200].map((x) => [x, lineZ(SUP_A, x), 0]),
    B: [-150, -100, -50, 0, 50, 100, 150, 200].map((x) => [-x, lineZ(SUP_B, -x), Math.PI]),
    ffa: [[-120, 0], [125, -6], [0, 30], [-60, -40], [60, 40], [-200, 20], [200, -20], [0, -60], [-30, 70], [40, -80]],
    hq: {
      A: [[-30, HQZ - 6, 0], [-20, HQZ - 8, 0], [-8, HQZ - 6, 0], [4, HQZ - 8, 0], [12, HQZ - 6, 0], [26, HQZ - 8, 0], [34, HQZ - 6, 0], [0, HQZ + 8, 0]],
      B: [[30, -HQZ + 6, Math.PI], [20, -HQZ + 8, Math.PI], [8, -HQZ + 6, Math.PI], [-4, -HQZ + 8, Math.PI], [-12, -HQZ + 6, Math.PI], [-26, -HQZ + 8, Math.PI], [-34, -HQZ + 6, Math.PI], [0, -HQZ - 8, Math.PI]],
    },
  },
  // Panzer je Team am Hauptquartier (Nutzer 11.10.); Art/Generation über die Lobby (vehicles/data.js)
  vehicles: [
    { id: 'A-panzer-1', team: 'A', kind: 'tank', x: 70, z: HQZ - 4, yaw: 0 }, { id: 'A-panzer-2', team: 'A', kind: 'tank', x: -70, z: HQZ - 4, yaw: 0 },
    { id: 'B-panzer-1', team: 'B', kind: 'tank', x: -70, z: -HQZ + 4, yaw: Math.PI }, { id: 'B-panzer-2', team: 'B', kind: 'tank', x: 70, z: -HQZ + 4, yaw: Math.PI },
  ],
  secrets: [],
};
