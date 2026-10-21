// NULLPUNKT — Großkarte „Brandwald“ (21.10., eigene Karte; Detailgrad nach den Vorlagebildern des Nutzers, alles
// eigene Geometrie/Texturen). Ein abgebrannter Nadelwald an einer Stellungslinie: Tausende verkohlte Baumleichen
// (Spieße, abgebrochene Stämme mit Splitterkronen, Stümpfe, graue entrindete Stämme), umgestürzte Stämme mit
// Wurzeltellern, Brandboden mit Asche, Streu und Pfützen. Jede Seite hält eine gezackte Frontlinie mit Sandsack- und
// Bretterwänden und eine Unterstützungslinie, verbunden durch Laufgräben; dazwischen Trichter, eine Stromtrasse mit
// Gittermasten (einer umgestürzt), die Gerippe einer Gewächshausanlage (West) und ein abgebrannter Holzplatz (Ost).
// Team A im Süden (+z), Team B im Norden (−z). (Owner: world)
import { sampleSpline } from '../terrain/generate.js';
import { trenchWorks, pylonLine, greenhouseRuin, timberYard, fieldPost, groundDetails } from './brandwald-bau.js';

const FRONT = 92, SUPPORT = 128, HQZ = 158; // |z| der Linien je Seite
const XL = 168;                               // Ausdehnung der Gräben in x

/** Gezackte Linie (Feuerbuchten) mit unregelmäßigem Takt und Ausschlag (deterministisch). */
function zig(z, x0, x1, seed, step = 11, amp = 3) {
  const pts = [];
  let k = 0, s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let x = x0; x <= x1 + 0.01; x += step * (0.75 + r() * 0.5)) pts.push([x, z + (k++ % 2 ? amp : -amp) * (0.7 + r() * 0.6) + Math.sin(x / 47) * 4]);
  return pts;
}

/** Grabensystem einer Seite (s = +1 Süd/Team A, −1 Nord/Team B). */
function trenchesOf(s) {
  const front = zig(s * FRONT, -XL, XL, s > 0 ? 11 : 23);
  const support = zig(s * SUPPORT, -XL + 18, XL - 18, s > 0 ? 31 : 47, 14, 2.2);
  const out = [
    { id: (s > 0 ? 'A' : 'B') + '-front', pts: front, width: 1.9, depth: 2.0, revet: 1.1, ramps: front.filter((_, i) => i % 5 === 3).map(([x, z]) => [x, z - s * 0.2]), sandbags: 0.45 },
    { id: (s > 0 ? 'A' : 'B') + '-support', pts: support, width: 1.9, depth: 1.9, revet: 1.1, ramps: support.filter((_, i) => i % 6 === 2), sandbags: 0.2 },
  ];
  // Laufgräben Front ↔ Unterstützung (geknickt) und zur Basis
  for (const x of [-120, -45, 35, 115]) {
    out.push({ id: 'lauf' + s + x, pts: [[x, s * (FRONT + 1)], [x + 5, s * (FRONT + 12)], [x - 4, s * (FRONT + 24)], [x + 3, s * (SUPPORT - 1)]], width: 1.5, depth: 1.8, revet: 1.1, sandbags: 0.1 });
  }
  out.push({ id: 'basis' + s, pts: [[-10, s * (SUPPORT + 1)], [-4, s * (SUPPORT + 12)], [-12, s * (SUPPORT + 22)], [-8, s * (HQZ - 10)]], width: 1.5, depth: 1.8, revet: 1.1, ramps: [[-8, s * (HQZ - 10)]], sandbags: 0.1 });
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
const SUP_A = sampleSpline(TRENCHES[1].pts, 1.5), SUP_B = sampleSpline(TRENCHES[TRENCHES.length / 2 + 1].pts, 1.5);

// Stromtrasse (Masten alle ≈ 70 m, quer durch das Niemandsland)
export const POWER_LINE = [[-300, -70], [-215, -48], [-140, -28], [-70, -8], [0, 10], [72, 30], [145, 50], [220, 70], [300, 92]];

export default {
  id: 'brandwald',
  name: 'Brandwald',
  scale: 'gross',
  seed: 2110,
  bounds: { minX: -180, maxX: 180, minZ: -180, maxZ: 180, minY: -10, maxY: 60 },
  ambience: 'range',
  defaultSurface: 'dirt',
  wallMargin: 35,
  assets: { hdri: 'np_sky_vormittag_bewoelkt' },
  lighting: {
    // heller, gleichmäßig bedeckter Himmel (fast weiß), Sonne nur angedeutet; Dunst lässt die fernen Stämme verblassen
    sun: { elevation: 48, azimuth: 205, color: '#e4e0d8', intensity: 0.9 },
    sky: { turbidity: 7, rayleigh: 1.0, mieCoefficient: 0.005, mieDirectionalG: 0.5, exposure: 0.42, tint: '#d4d6d6', clouds: { coverage: 0.97, density: 0.6, scale: 0.00016, elevation: 0.5 }, hazeHigh: 0.4, hazeAmount: 1.4, hdriIntensity: 1.05, hdriTint: '#e6e6e2' },
    hemi: { sky: '#c4c6c4', ground: '#2e2a25', intensity: 1.0, hdriIntensity: 0.9 },
    env: { intensity: 1.0, ground: '#2e2a25', groundIntensity: 0.45, tint: '#ecebe6', hdriIntensity: 0.95, hdriTint: '#ecebe6' },
    fog: { color: '#c7c9c8', nearFactor: 0.08, density: 0.011, falloff: 0.025, start: 12, max: 0.95, sun: 0.04, sunExp: 10 },
    shadow: { size: 60, bias: -0.0004, normalBias: 0.04, near: 40, farMaxY: 40 },
    exposure: 1.05,
    atmos: { beams: 0, beamG: 0.4, dust: 1.6, dustSize: 0.02 },
  },
  water: { color: '#2a2a26' },
  // Boden: eigene Brandwald-Sätze statt Wiese/Fotoscans (splat.js), keine Wiesenfarbe
  terrainLook: {
    layers: { grass: 'brandboden', dirt: 'grabenlehm', gravel: 'asche', rock: 'brandboden_hell', mud: 'schlamm' },
    sizes: { grass: 3.4, dirt: 2.8, gravel: 2.6, rock: 3.6, mud: 2.6 },
    meadow: false, rockTint: [1, 1, 1],
  },

  terrain: {
    size: 640, res: 1, seed: 2110,
    base: { amp: 2.2, scale: 190, octaves: 5, offset: 0.4 },
    detail: { amp: 0.32, scale: 7 },
    hills: [{ x: -120, z: -20, r: 60, h: 2.5 }, { x: 130, z: 30, r: 55, h: 3 }, { x: 0, z: 220, r: 80, h: 4 }, { x: 0, z: -220, r: 80, h: 4 }],
    edge: { start: 250, end: 315, height: 18 },
    waterY: -1.9, // Grabensohlen bleiben trocken (tiefste ≈ −1,7), tiefe Trichter füllen sich
    pads: [
      { x: -100, z: 14, w: 46, d: 40, y: 0.3, blend: 12, worn: false },  // Gewächshäuser
      { x: 106, z: -22, w: 40, d: 32, y: 0.5, blend: 12, worn: false },  // Holzplatz
      { x: 0, z: HQZ + 6, w: 70, d: 26, y: 0.4, blend: 14, worn: false }, // Basis A
      { x: 0, z: -HQZ - 6, w: 70, d: 26, y: 0.4, blend: 14, worn: false }, // Basis B
    ],
    trenches: TRENCHES,
    craters: {
      seed: 2111, count: 420, area: { minX: -175, maxX: 175, minZ: -84, maxZ: 84 }, r: [1.2, 5.5], depth: [0.4, 1.6],
      avoid: [[FRONT, 6], [-FRONT, 6]],
      list: [[8, 6, 8, 3.4], [-40, 40, 5.5, 2.4], [52, -38, 6, 2.6], [-150, 52, 5, 2.2], [150, -58, 5.5, 2.3], [-62, -56, 4.5, 2.0], [78, 58, 5, 2.1]],
    },
    burnt: { ash: 0.75, light: 0.6, dirt: 0.12, mud: 0.3 },
  },

  vegetation: { seed: 21, forests: [], scatter: { count: 0 }, hedges: [], rocks: { count: 20, clusters: [] }, grass: false },
  deadwood: {
    seed: 2112, density: 2.4, step: 3.1, clearNoise: 0.5, logs: 0.4,
    mix: { hoch: 0.3, gebrochen: 0.36, stumpf: 0.16, grau: 0.18 },
    // dichtere Haine hinter den Linien, Lichtungen an Flaggen/Bauten
    groves: [[-150, 120, 40, 4], [150, -120, 40, 4], [-40, -130, 30, 3.6], [60, 130, 30, 3.6]],
    clearings: [[8, 6, 12], [-100, 14, 26], [106, -22, 22]],
  },
  // Bodenstreu (je m², Ring um die Kamera): verkohlte Zweige, graue Stöcke, Äste, Rindenstücke, Holzkohle, Steine
  litter: { seed: 2114, twigs: 0.55, sticks: 0.12, branches: 0.035, bark: 0.18, coals: 0.22, stones: 0.14 },
  clearings: [[8, 6, 12]],
  // Wegketten für Bots entlang der Grabensohlen (das 4-m-Navigationsgitter trifft die 1,9 m breiten Gräben kaum)
  navLines: TRENCHES.map((t) => sampleSpline(t.pts, 2.2)),
  navHeadroom: 5,

  sites: [
    { id: 'gewaechshaus', name: 'Gewächshäuser', y: 0.3, bounds: { minX: -124, maxX: -76, minZ: -8, maxZ: 36 }, build: (b) => greenhouseRuin(b, -100, 14, 0.3), seeds: [[-100, 14, 0.3]], height: 7 },
    { id: 'holzplatz', name: 'Holzplatz', y: 0.5, bounds: { minX: 86, maxX: 126, minZ: -38, maxZ: -6 }, build: (b) => timberYard(b, 106, -22, 0.5), seeds: [[106, -22, 0.5]], height: 6 },
    { id: 'basis_a', name: 'Basis A', y: 0.4, bounds: { minX: -35, maxX: 35, minZ: HQZ - 7, maxZ: HQZ + 19 }, build: (b) => fieldPost(b, 0, HQZ + 6, 1, 0.4), seeds: [[0, HQZ + 6, 0.4]], nav: true },
    { id: 'basis_b', name: 'Basis B', y: 0.4, bounds: { minX: -35, maxX: 35, minZ: -HQZ - 19, maxZ: -HQZ + 7 }, build: (b) => fieldPost(b, 0, -HQZ - 6, -1, 0.4), seeds: [[0, -HQZ - 6, 0.4]], nav: true },
  ],
  lateSites: [
    { id: 'front', name: 'Gräben', bounds: { minX: -180, maxX: 180, minZ: -180, maxZ: 180 }, chunkSize: 60, build: (b, ctx) => trenchWorks(b, ctx, TRENCHES, { front: FRONT }) },
    { id: 'boden', name: 'Pfützen und Draht', bounds: { minX: -180, maxX: 180, minZ: -180, maxZ: 180 }, chunkSize: 60, build: (b, ctx) => groundDetails(b, ctx, { area: { minX: -176, maxX: 176, minZ: -176, maxZ: 176 }, avoid: TRENCHES.map((t) => [t.pts, (t.width ?? 2) / 2 + (t.revet || 0) + 3]), wire: [{ z: FRONT - 13, x0: -165, x1: 165 }, { z: -FRONT + 13, x0: -165, x1: 165 }] }) },
    { id: 'leitung', name: 'Stromtrasse', bounds: { minX: -320, maxX: 320, minZ: -200, maxZ: 200 }, chunkSize: 80, build: (b, ctx) => pylonLine(b, ctx, POWER_LINE, { fallen: 4 }) },
  ],

  flags: {
    cq: [
      { id: 'A', name: 'Südstellung', x: -135, z: FRONT + 1, radius: 18, heightBand: [-4, 6] },
      { id: 'B', name: 'Gewächshäuser', x: -100, z: 14, y: 0.3, radius: 22, heightBand: [-4, 8] },
      { id: 'C', name: 'Trichter', x: 8, z: 6, radius: 20, heightBand: [-5, 6] },
      { id: 'D', name: 'Holzplatz', x: 106, z: -22, y: 0.5, radius: 20, heightBand: [-4, 8] },
      { id: 'E', name: 'Nordstellung', x: 135, z: -FRONT - 1, radius: 18, heightBand: [-4, 6] },
    ],
    dom: [
      { id: 'A', name: 'Gewächshäuser', x: -100, z: 14, y: 0.3, radius: 9 },
      { id: 'B', name: 'Trichter', x: 8, z: 6, radius: 9 },
      { id: 'C', name: 'Holzplatz', x: 106, z: -22, y: 0.5, radius: 9 },
    ],
  },
  // Startpunkte [x, z, yaw]: Teamkampf in der Unterstützungslinie (Grabensohle), Eroberung an der Basis
  spawns: {
    A: [-120, -80, -40, 0, 40, 80, 120, 140].map((x) => [x, lineZ(SUP_A, x), 0]),
    B: [-120, -80, -40, 0, 40, 80, 120, 140].map((x) => [-x, lineZ(SUP_B, -x), Math.PI]),
    ffa: [[-100, 14], [106, -22], [8, 30], [-60, -30], [60, 35], [-150, 20], [150, -10], [0, -50], [-30, 60], [40, -70]],
    hq: {
      A: [[-24, HQZ + 4, 0], [-14, HQZ + 2, 0], [-4, HQZ + 4, 0], [6, HQZ + 2, 0], [16, HQZ + 4, 0], [26, HQZ + 2, 0], [-8, HQZ + 12, 0], [8, HQZ + 12, 0]],
      B: [[24, -HQZ - 4, Math.PI], [14, -HQZ - 2, Math.PI], [4, -HQZ - 4, Math.PI], [-6, -HQZ - 2, Math.PI], [-16, -HQZ - 4, Math.PI], [-26, -HQZ - 2, Math.PI], [8, -HQZ - 12, Math.PI], [-8, -HQZ - 12, Math.PI]],
    },
  },
  vehicles: [
    { id: 'A-panzer-1', team: 'A', kind: 'tank', x: 50, z: HQZ + 8, yaw: 0 },
    { id: 'B-panzer-1', team: 'B', kind: 'tank', x: -50, z: -HQZ - 8, yaw: Math.PI },
  ],
  secrets: [],
};
