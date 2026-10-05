// NULLPUNKT — Karte „Werk“: stillgelegtes Walzwerk 7 in der bleigrauen Abenddämmerung. (Owner: world)
// Drei Bahnen: Lkw-Hof mit Laderampe (West) · Walzhalle mit Laufstegen und Kranbahn (Mitte) ·
// Kesselhaus mit Rohrbrücke, Tanks und Schornstein (Ost). Team A startet im Süden (Werkstor),
// Team B im Norden (Gleisanschluss). Nord/Süd spiegelsymmetrisch (z → −z), Details unterschiedlich.
import * as THREE from 'three';
import { building, wall, stairs, railing, catwalk } from '../arch.js';
import {
  frame, container, crateStack, barrel, barrelGroup, palletStack, sandbags, jersey, cone,
  forklift, truck, van, car, lampPost, floodMast, fence, tires, cableReel, gasBottles, electricBox, pipe,
  workbench, lockers, dumpster, tank, roofVent,
} from '../props.js';

const HX = 22, HZ = 30;           // Halle: x −22..22, z −30..30
const CW = 5.2;                   // Laufsteg-Höhe in der Halle
const BRICK = '#a8705c', BRICK_D = '#8a5a4a', STEEL = '#4b5560', YEL = '#d9a72a', RAIL = '#d9a72a';

export default {
  id: 'werk',
  seed: 9077,
  bounds: { minX: -52, maxX: 52, minZ: -48, maxZ: 48, minY: -2, maxY: 20 },
  visualBounds: { minX: -170, maxX: 170, minZ: -170, maxZ: 170 },
  chunkSize: 36,
  ambience: 'industrial',
  defaultSurface: 'concrete',
  navSpacing: 1.5,
  groundNoise: 0.22,
  interiorTint: [1, 0.93, 0.84],
  lighting: {
    sun: { elevation: 8, azimuth: 252, color: '#ffae70', intensity: 2.6 },
    sky: { turbidity: 9, rayleigh: 2.2, mieCoefficient: 0.012, mieDirectionalG: 0.82, exposure: 0.42, tint: '#c8ccd8', clouds: { coverage: 0.82, density: 0.62, scale: 0.00016, elevation: 0.45, speed: 0.00002 }, hazeHigh: 0.2, hazeAmount: 0.95 },
    // Himmels-/Umgebungslicht trägt die Dämmerung (Env-Map ohne Mie-Hotspot, s. lighting.js) → kräftiger
    hemi: { sky: '#a6b2c6', ground: '#7d7064', intensity: 2.1 },
    env: { intensity: 2.2, ground: '#5c554c', groundIntensity: 0.6, tint: '#c4ccdc' },
    fog: { color: '#7c8596', near: 45, far: 280 },
    shadow: { size: 40, bias: -0.0005 },
    exposure: 1.55,
  },

  build(b, ctx) {
    const zones = [];
    defineSigns(b);

    // -----------------------------------------------------------------------
    // Boden
    // -----------------------------------------------------------------------
    b.groundTiled(-52, -48, -HX, 48, 'asphalt', { cell: 1, tint: '#e2ddd2' });
    b.groundTiled(-HX, -48, HX, -HZ, 'asphalt', { cell: 1, tint: '#e2ddd2' });
    b.groundTiled(-HX, HZ, HX, 48, 'asphalt', { cell: 1, tint: '#e2ddd2' });
    b.groundTiled(-HX, -HZ, HX, HZ, 'concrete', { cell: 1, tint: '#a8a49c' });
    b.groundTiled(HX, -48, 52, 48, 'concrete', { cell: 1, tint: '#b8b2a6' });
    // Kulisse
    b.groundTiled(-170, -170, 170, -48, 'gravel', { cell: 6, collide: false, groundAO: false, chunk: 900, tint: '#8a857c' });
    b.groundTiled(-170, 48, 170, 170, 'gravel', { cell: 6, collide: false, groundAO: false, chunk: 901, tint: '#8a857c' });
    b.groundTiled(-170, -48, -52, 48, 'gravel', { cell: 6, collide: false, groundAO: false, chunk: 902, tint: '#8a857c' });
    b.groundTiled(52, -48, 170, 48, 'gravel', { cell: 6, collide: false, groundAO: false, chunk: 903, tint: '#8a857c' });
    zones.push(
      { x0: -52, z0: -48, x1: -HX, z1: 48, kind: 'road' },
      { x0: -HX, z0: -HZ, x1: HX, z1: HZ, kind: 'hall' },
      { x0: HX, z0: -48, x1: 52, z1: 48, kind: 'dock' },
    );
    // Unsichtbare Grenze
    b.collider(-52.4, -2, 0, 0.8, 30, 98);
    b.collider(52.4, -2, 0, 0.8, 30, 98);
    b.collider(0, -2, -48.4, 106, 30, 0.8);
    b.collider(0, -2, 48.4, 106, 30, 0.8);

    // -----------------------------------------------------------------------
    // Mitte: Walzhalle
    // -----------------------------------------------------------------------
    hall(b);
    hallInterior(b);
    overheadCrane(b, -9.5);

    // -----------------------------------------------------------------------
    // Osten: Kesselhaus, Rohrbrücke, Schornstein
    // -----------------------------------------------------------------------
    boilerHouse(b);
    pipeBridge(b);
    chimney(b, 48.6, 0);

    // -----------------------------------------------------------------------
    // Hälften
    // -----------------------------------------------------------------------
    for (const s of [1, -1]) half(b, mirror(s), ctx);

    backdrop(b);

    // -----------------------------------------------------------------------
    // Startpunkte & Flaggen
    // -----------------------------------------------------------------------
    const spawns = { A: [], B: [], ffa: [] };
    const sA = [[-47, 43], [-39, 45.5], [-30, 41.5], [-24.5, 43.5], [-12, 41.5], [-2, 44], [8, 41], [17, 44.5], [26, 41.2], [32, 45], [47.5, 44], [41, 40.5]];
    const sB = [[-47, -43], [-39, -46], [-30, -39.5], [-19, -46.5], [-12, -40], [-1, -46.5], [8, -41], [17, -45], [21, -40], [40, -46.5], [47.5, -44], [33, -40]];
    for (const [x, z] of sA) spawns.A.push({ x, z, yaw: 0 });
    for (const [x, z] of sB) spawns.B.push({ x, z, yaw: Math.PI });
    for (const [x, z] of [
      [-46, 24], [-44, -12], [-31, 30], [-30, -33], [-24.5, 5], [-14, 17], [-12, -16], [-8, 5], [9, -6], [13, 15], [12, -24],
      [26, 18], [26, -14], [36, 16], [35, 0], [48, 12], [47.5, -30], [24, -38],
    ]) spawns.ffa.push({ x, z });
    return {
      spawns,
      objectives: { dom: [{ id: 'A', x: -36, z: 27, radius: 5 }, { id: 'B', x: 0, z: 0, radius: 5.5 }, { id: 'C', x: -36, z: -27, radius: 5 }] },
      zones,
    };
  },
};

function defineSigns(b) {
  b.defineSign('title', { style: 'logo', text: 'WALZWERK 7', sub: 'Hütte Nordstahl · seit 1923', bg: '#1f2a33', fg: '#e8e4dc', accent: '#ff8a2a' });
  b.defineSign('hall', { style: 'stencil', text: 'HALLE 2 · WARMWALZE', fg: '#e8e4dc' });
  b.defineSign('kessel', { style: 'stencil', text: 'KESSELHAUS', fg: '#e8e4dc' });
  b.defineSign('bay1', { style: 'number', text: '1', sub: 'RAMPE', bg: '#d9a72a', fg: '#16191d' });
  b.defineSign('bay2', { style: 'number', text: '2', sub: 'RAMPE', bg: '#d9a72a', fg: '#16191d' });
  b.defineSign('bay3', { style: 'number', text: '3', sub: 'RAMPE', bg: '#d9a72a', fg: '#16191d' });
  b.defineSign('gate_s', { style: 'plate', text: 'WERKSTOR SÜD', sub: 'Anmeldung beim Pförtner', bg: '#1f2a33', fg: '#e8e4dc' });
  b.defineSign('gate_n', { style: 'plate', text: 'GLEISANSCHLUSS NORD', sub: 'Rangierbetrieb', bg: '#1f2a33', fg: '#e8e4dc' });
  b.defineSign('closed', { style: 'warning', text: 'STILLGELEGT', sub: 'Betreten auf eigene Gefahr' });
  b.defineSign('helmet', { style: 'plate', text: 'HELMPFLICHT', bg: '#1f5f9a', fg: '#ffffff' });
  b.defineSign('gas', { style: 'warning', text: 'GASLEITUNG', sub: 'Kein offenes Feuer' });
  b.defineSign('crane', { style: 'stencil', text: '32 t', fg: '#16191d' });
  b.defineSign('tank1', { style: 'stencil', text: 'T1 · HEIZÖL', fg: '#2a2e33' });
  b.defineSign('tank2', { style: 'stencil', text: 'T2 · HEIZÖL', fg: '#2a2e33' });
  b.defineSign('waage', { style: 'plate', text: 'FAHRZEUGWAAGE', bg: '#e8e4dc', fg: '#1f2a33' });
  b.defineSign('trafo', { style: 'warning', text: 'HOCHSPANNUNG', sub: '10 kV · Lebensgefahr' });
  b.defineSign('graffiti1', { style: 'neon', text: 'SCHICHTENDE', bg: 'rgba(0,0,0,0)', fg: '#3ad0ff' });
  b.defineSign('graffiti2', { style: 'neon', text: 'NULLPUNKT', bg: 'rgba(0,0,0,0)', fg: '#ff5b1f' });
}

function mirror(s) {
  return {
    s,
    z: z => z * s,
    zz: (a, c) => (s > 0 ? [a, c] : [-c, -a]),
    side: d => (s > 0 || (d !== 'n' && d !== 's') ? d : d === 'n' ? 's' : 'n'),
    ry: ry => (s > 0 ? ry : Math.PI - ry),
  };
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------
/** Stahlcoil (liegend, Achse lokal x), (x,z) Mitte, y Unterkante. */
function coil(b, x, y, z, ry = 0, o = {}) {
  const r = o.r ?? 0.85, w = o.w ?? 1.3, f = frame(b, x, y, z, ry);
  f.cyl(0, r, 0, r, w, 'metal_galvanized', { axis: 'x', tint: o.tint || '#9aa0a4', collide: false, minimap: false, seg: 18 });
  for (const sx of [-1, 1]) f.cyl(sx * (w / 2 + 0.003), r, 0, r * 0.42, 0.01, 'black', { axis: 'x', collide: false, minimap: false, seg: 14, ao: false });
  f.box(0, r * 0.55, 0, w * 0.9, 0.06, r * 1.9, 'metal_painted', { tint: '#3d4247', collide: false, minimap: false, grad: false, rx: 0, ao: false });
  f.solid(0, 0, 0, w, r * 2, r * 2, { minimap: 'cover' });
}

/** Coil-Reihe auf Holzbalken. */
function coilRow(b, x, z, ry, n = 3, o = {}) {
  const f = frame(b, x, 0, z, ry);
  for (const lz of [-0.6, 0.6]) f.box(0, 0, lz, n * 1.5 + 0.2, 0.18, 0.25, 'wood_planks', { tint: '#6a5440', collide: false, minimap: false });
  for (let i = 0; i < n; i++) { const [px, pz] = f.P(-(n - 1) * 0.75 + i * 1.5, 0); coil(b, px, 0.18, pz, ry, { tint: b.pick(['#9aa0a4', '#8a8f94', '#a69a8a']) }); }
  if (o.top) { const [px, pz] = f.P(0, 0); coil(b, px, 1.75, pz, ry, { r: 0.8 }); }
}

/** Stapel Brammen (Stahlplatten). */
function slabStack(b, x, z, ry = 0, n = 4, o = {}) {
  const f = frame(b, x, 0, z, ry), w = o.w ?? 2.4, d = o.d ?? 1.1;
  let y = 0;
  for (let i = 0; i < n; i++) {
    f.box((b.rand() - 0.5) * 0.12, y, (b.rand() - 0.5) * 0.12, w, 0.24, d, 'metal_rust', { tint: b.pick(['#8a6a5a', '#7a5a4a', '#94705c']), collide: false, minimap: false, grad: i === 0, ry: (b.rand() - 0.5) * 0.06 });
    y += 0.24;
    if (i % 2 === 1 && i < n - 1) { for (const lx of [-0.8, 0.8]) f.box(lx, y, 0, 0.12, 0.1, d, 'wood_planks', { tint: '#5a4634', collide: false, minimap: false, grad: false }); y += 0.1; }
  }
  f.solid(0, 0, 0, w, y, d, { minimap: 'cover' });
}

/** Ölfass mit Feuer (Glut + kleine Flamme), optional echtes Licht. */
function fireBarrel(b, x, z, o = {}) {
  barrel(b, x, 0, z, { color: '#5a3a2a' });
  b.cyl(x, 0.86, z, 0.26, 0.04, 'lamp_sodium', { seg: 10, collide: false, minimap: false, ao: false, cast: false });
  for (let i = 0; i < 4; i++) b.box(x + (b.rand() - 0.5) * 0.25, 0.86, z + (b.rand() - 0.5) * 0.25, 0.06, 0.16, 0.5, 'wood_dark', { tint: '#2a1a12', collide: false, minimap: false, ao: false, rx: 0.4, ry: b.rand() * 3 });
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ffb050', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  mat.userData.disposable = true;
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.03, 0.55 + i * 0.12, 6, 1, true), mat);
    m.position.set(x + (i - 1) * 0.07, 1.12 + i * 0.04, z + ((i % 2) - 0.5) * 0.08);
    m.renderOrder = 3;
    g.add(m); flames.push(m);
  }
  // Animation hängt am Objekt (world.update ruft sie) – kein Modulzustand, der eine alte Welt festhält
  let t = b.rand() * 10;
  b.object(g, {
    update: dt => {
      t += dt;
      flames.forEach((m, i) => { const k = 0.8 + Math.sin(t * (9 + i * 3.1) + i) * 0.15 + Math.sin(t * 17 + i * 2) * 0.08; m.scale.set(1, k, 1); m.position.y = 0.88 + (0.55 + i * 0.12) * k / 2; });
      mat.opacity = 0.7 + Math.sin(t * 11) * 0.12;
    },
  });
  if (o.light !== false) b.light('point', x, 1.6, z, { color: '#ff9a40', intensity: o.intensity ?? 9, distance: o.distance ?? 9, priority: 2 });
  b.glow(x, 1.25, z, { color: '#ff8a30', size: 2.6, intensity: 0.9 });
}

/** Rollgang (Rollentisch) entlang z von z0 bis z1 bei x. */
function rollerTable(b, x, z0, z1) {
  const L = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
  b.box(x, 0, zc, 2.8, 0.55, L, 'metal_painted', { tint: '#3d4a44', minimap: false });
  for (const sx of [-1.35, 1.35]) b.box(x + sx, 0.55, zc, 0.12, 0.32, L, 'metal_painted', { tint: '#2f3a36', collide: false, minimap: false, grad: false });
  const n = Math.floor(L / 0.6);
  for (let i = 0; i < n; i++) b.cyl(x, 0.72, Math.min(z0, z1) + 0.3 + i * 0.6, 0.15, 2.6, 'metal_galvanized', { axis: 'x', tint: '#8a8f94', collide: false, minimap: false, seg: 8, ao: false });
  b.box(x, 0, zc, 2.8, 0.9, L, 'black', { visual: false, minimap: 'cover' });
  // Antriebsmotoren seitlich
  for (let z = Math.min(z0, z1) + 2; z < Math.max(z0, z1) - 1; z += 4.5) {
    b.box(x - 2.0, 0, z, 0.9, 0.7, 0.8, 'metal_painted', { tint: '#4a6a5a', minimap: 'prop' });
    b.cyl(x - 1.55, 0.35, z, 0.08, 0.3, 'metal_galvanized', { axis: 'x', collide: false, minimap: false, seg: 6, ao: false });
  }
}

/** Walzgerüst (zwei Ständer, Walzen, Antrieb) über dem Rollgang bei (x, z). */
function millStand(b, x, z, s) {
  const H = 5.6;
  for (const sx of [-1, 1]) {
    b.box(x + sx * 2.3, 0, z, 1.2, H, 2.6, 'metal_painted', { tint: '#3d5a52', minimap: 'cover' });
    b.box(x + sx * 2.3, H - 0.1, z, 1.4, 0.3, 2.8, 'metal_painted', { tint: '#2f4a44', collide: false, minimap: false, grad: false });
    for (const yy of [1.2, 2.4, 3.6]) b.box(x + sx * 2.92, yy, z, 0.06, 0.12, 2.2, 'metal_painted', { tint: YEL, collide: false, minimap: false, grad: false, ao: false });
  }
  b.box(x, H, z, 5.8, 0.9, 2.6, 'metal_painted', { tint: '#3d5a52', minimap: false, collide: true });
  for (const yy of [1.15, 2.55]) b.cyl(x, yy, z, 0.6, 3.4, 'metal_galvanized', { axis: 'x', tint: '#7a8086', collide: false, minimap: false, seg: 16 });
  b.cyl(x, 4.2, z, 0.85, 3.4, 'metal_painted', { axis: 'x', tint: '#2f4a44', collide: false, minimap: false, seg: 16 });
  // Antrieb (Getriebe + Motor) auf der Ostseite
  b.box(x + 5.4, 0, z, 2.6, 2.2, 2.4, 'metal_painted', { tint: '#4a5a62', minimap: 'cover' });
  b.box(x + 8.1, 0, z, 2.4, 1.8, 1.8, 'metal_painted', { tint: '#5a6a5a', minimap: 'cover' });
  b.cyl(x + 3.2, 1.6, z, 0.28, 1.4, 'metal_galvanized', { axis: 'x', collide: false, minimap: false, seg: 10 });
  b.cyl(x + 6.9, 0.9, z, 0.22, 0.5, 'metal_galvanized', { axis: 'x', collide: false, minimap: false, seg: 10 });
  b.sign(x + 5.4, 1.5, z + s * 1.21, 0.9, 0.7, 'closed', { ry: s > 0 ? 0 : Math.PI, depth: 0.01, back: false });
  // Kühlwasser-Rohr
  pipe(b, [[x - 2.9, 0.4, z - 1.0], [x - 2.9, 4.8, z - 1.0], [x - 1.8, 4.8, z - 1.0]], { r: 0.08, tint: '#3a6a8a', flanges: false });
}

/** Wärmeofen (kalt, Mauerwerk mit dunkler Ofenöffnung). */
function furnace(b, x0, z0, x1, z1, s) {
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  b.box(x, 0, z, w, 4.6, d, 'brick_dark', { tint: '#9a7a6a', minimap: 'building' });
  b.box(x, 4.6, z, w + 0.3, 0.3, d + 0.3, 'metal_painted', { tint: STEEL, collide: false, minimap: false, grad: false });
  // Ofenöffnungen zur Hallenmitte
  const face = s > 0 ? z0 - 0.01 : z1 + 0.01;
  for (const ox of [-w / 4, w / 4]) {
    b.box(x + ox, 0.6, face, 2.2, 1.6, 0.04, 'black', { collide: false, minimap: false, ao: false });
    b.box(x + ox, 0.62, face - s * 0.005, 2.0, 0.25, 0.04, 'lamp_sodium', { collide: false, minimap: false, ao: false, cast: false, matOpts: { emissive: '#ff5a1a', emissiveIntensity: 1.6 } });
    b.glow(x + ox, 0.8, face - s * 0.3, { color: '#ff6a20', size: 2.2, intensity: 0.7 });
    b.box(x + ox, 2.3, face - s * 0.08, 2.6, 0.18, 0.16, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
  }
  // Abzugshaube + Rohr zum Dach
  b.box(x, 4.9, z, w * 0.5, 1.2, d * 0.6, 'metal_rust', { collide: false, minimap: false, grad: false });
  b.cyl(x, 6.1, z, 0.7, 6.0, 'metal_rust', { collide: false, minimap: false, seg: 12 });
  b.noNav(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, 3, 30);
}

/** Warmer Lichtkegel einer Natriumlampe auf dem Boden (additives Decal, auf allen Stufen, ohne Lichtkosten). */
function lampPool(b, x, z, size) {
  // feste Drehung: der Karten-Zufall (Requisiten danach) bleibt unverändert
  b.decal(x, 0.016, z, size, size * 0.92, 'puddle', { kind: 'light', tint: '#ff9a3c', opacity: 0.3, ry: x * 0.7 });
  b.decal(x, 0.017, z, size * 0.45, size * 0.42, 'puddle', { kind: 'light', tint: '#ffb060', opacity: 0.22, ry: z * 0.9 });
}

/** Wandleuchte (Natriumdampf) mit Lichthof; ry = Blickrichtung nach außen. */
function wallLight(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0.12, 0.18, 0.06, 0.06, 0.36, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false, ao: false });
  f.box(0, -0.05, 0.4, 0.42, 0.16, 0.3, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false, ao: false });
  f.box(0, -0.07, 0.4, 0.36, 0.03, 0.24, o.cool ? 'lamp_cool' : 'lamp_sodium', { collide: false, minimap: false, ao: false, cast: false });
  const [gx, gz] = f.P(0, 0.42);
  b.glow(gx, y - 0.15, gz, { color: o.cool ? '#d8e6ff' : '#ffa850', size: o.size ?? 2.2 });
}

/** Hallentor-Rolltor halb offen (Unterkante y0). */
function rollDoor(b, cx, cz, w, h, y0, ry, tint = '#8a9096') {
  const f = frame(b, cx, 0, cz, ry);
  f.box(0, y0, 0, w, h - y0, 0.1, 'metal_corrugated', { tint, minimap: false, grad: false, uv: 'local' });
  f.box(0, h, 0, w + 0.6, 0.7, 0.7, 'metal_painted', { tint: STEEL, collide: false, minimap: false, grad: false });
  f.box(0, y0 - 0.08, 0, w, 0.08, 0.14, 'hazard', { collide: false, minimap: false, grad: false, uv: 'fit' });
}

// ---------------------------------------------------------------------------
// Walzhalle (x −22..22, z −30..30): Ziegel, Fensterbänder, Satteldach mit Löchern
// ---------------------------------------------------------------------------
function hall(b) {
  const t = 0.5, H = 12.5, ridge = 3.8;
  b.interior(-HX + 0.1, -HZ + 0.1, HX - 0.1, HZ - 0.1, -0.1, H + ridge, 0.5);
  const lower = { h: CW, t, mat: 'brick', tint: BRICK, frameMat: 'metal_painted', frameTint: '#2f3438', minimap: 'wall', plinth: { h: 0.9, mat: 'concrete', tint: '#8a8680', over: 0.04 } };
  const upper = { y: CW, h: H - CW, t, mat: 'brick', tint: BRICK_D, frameMat: 'metal_painted', frameTint: '#2f3438', minimap: false };
  const winsLong = (skip = []) => { const o = []; for (let i = 0; i < 10; i++) { const at = 3 + i * 6; if (!skip.includes(i)) o.push({ at, w: 3.4, h: 3.5, kind: 'window', sill: 0.95, glass: false, mullion: true }); } return o; };
  const winsShort = () => [-15, -9, 9, 15].map(xx => ({ at: xx + HX, w: 3.4, h: 3.5, kind: 'window', sill: 0.95, glass: false, mullion: true }));
  // West (Laderampe): drei Ladetore auf Rampenhöhe
  wall(b, { ...lower, x0: -HX + t / 2, z0: HZ, x1: -HX + t / 2, z1: -HZ, openings: [18, 30, 42].map(at => ({ at, w: 4, h: 3.6, sill: 1.2, kind: 'gap', frame: true })).concat([{ at: 24, w: 1.4, h: 1.2, kind: 'window', sill: 2.6 }, { at: 36, w: 1.4, h: 1.2, kind: 'window', sill: 2.6 }]) });
  wall(b, { ...upper, x0: -HX + t / 2, z0: HZ, x1: -HX + t / 2, z1: -HZ, openings: winsLong() });
  // Ost: zwei Türen + Durchgang, oben Tür zur Rohrbrücke
  wall(b, { ...lower, x0: HX - t / 2, z0: -HZ, x1: HX - t / 2, z1: HZ, openings: [{ at: 18, w: 1.4, h: 2.4, kind: 'door' }, { at: 42, w: 1.4, h: 2.4, kind: 'door' }, { at: 30, w: 4.6, h: 4.2, kind: 'gap' }] });
  wall(b, { ...upper, x0: HX - t / 2, z0: -HZ, x1: HX - t / 2, z1: HZ, openings: [...winsLong([4, 5]), { at: 30, w: 1.5, h: 2.4, kind: 'door', sill: 0 }, { at: 25.4, w: 2.4, h: 3.5, kind: 'window', sill: 0.95, glass: false }, { at: 34.6, w: 2.4, h: 3.5, kind: 'window', sill: 0.95, glass: false }] });
  // Süd + Nord: Haupttor + Personentüren
  for (const s of [1, -1]) {
    const zw = s * (HZ - t / 2), xa = s > 0 ? HX : -HX, xb = -xa;
    const at = x => (s > 0 ? HX - x : x + HX);
    wall(b, { ...lower, x0: xa, z0: zw, x1: xb, z1: zw, openings: [{ at: at(0), w: 8, h: 5.0, kind: 'gap', frame: true }, { at: at(14), w: 1.3, h: 2.3, kind: 'door' }, { at: at(-14), w: 1.3, h: 2.3, kind: 'door' }] });
    wall(b, { ...upper, x0: xa, z0: zw, x1: xb, z1: zw, openings: winsShort() });
    rollDoor(b, 0, s * (HZ - 0.05), 8.2, 5.1, 3.3, 0);
    // Giebel (Ziegel) über der Traufe
    b.wedge(-HX / 2, H, s * (HZ - t / 2), t, ridge, HX, 'brick', { ry: Math.PI / 2, tint: BRICK_D, uv: 'world', minimap: false });
    b.wedge(HX / 2, H, s * (HZ - t / 2), t, ridge, HX, 'brick', { ry: -Math.PI / 2, tint: BRICK_D, uv: 'world', minimap: false });
    b.sign(0, H - 2.5, s * (HZ + 0.01), 12, 1.6, 'title', { ry: s > 0 ? 0 : Math.PI, depth: 0.04 });
    b.sign(0, 5.7, s * (HZ + 0.01), 6.5, 0.9, 'hall', { ry: s > 0 ? 0 : Math.PI, back: false, depth: 0 });
  }
  // Traufgesims
  for (const s of [-1, 1]) b.box(s * (HX + 0.05), H, 0, 0.7, 0.35, 2 * HZ + 0.7, 'concrete', { tint: '#8a8680', collide: false, minimap: false, grad: false });
  // Dach: Wellblech in Feldern, einige eingestürzt (Lichtschächte), Oberlichter. Sicken laufen in Gefällerichtung
  // (u/v getauscht) mit Bauhallen-Teilung ≈ 0,31 m statt 0,125 m – die feine Teilung flimmerte unter flachem Blickwinkel
  // als Moiré-Ringe über die ganze Dachunterseite.
  const ROOF_UV = { uv: 'local', uvSwap: true, uvScale: 2.5 };
  const half = HX + 0.4, ang = Math.atan2(ridge, HX), slope = Math.hypot(half, ridge * half / HX);
  const broken = new Set(['w3', 'e6', 'e2', 'w7']);
  for (let i = 0; i < 10; i++) {
    const zc = -HZ + 3 + i * 6;
    for (const s of [-1, 1]) {
      const key = (s < 0 ? 'w' : 'e') + i;
      const cx = s * half / 2, yy = H + ridge / 2 - 0.12;
      if (broken.has(key)) {
        // Loch: nur Reststreifen + verbogene Bleche
        b.box(cx + s * half * 0.32, yy - s * 0 - ridge * 0.32, zc - 2.2, slope * 0.36, 0.08, 1.6, 'metal_corrugated', { rz: -ang * s, tint: '#7d868c', collide: false, minimap: false, grad: false, ...ROOF_UV });
        b.box(cx - s * half * 0.3, yy + ridge * 0.3, zc + 2.3, slope * 0.4, 0.08, 1.4, 'metal_corrugated', { rz: -ang * s + s * 0.25, tint: '#7d868c', collide: false, minimap: false, grad: false, ...ROOF_UV });
        continue;
      }
      b.box(cx, yy, zc, slope, 0.12, 6.02, 'metal_corrugated', { rz: -ang * s, tint: '#7d868c', collide: false, minimap: false, grad: false, ...ROOF_UV });
      if (i % 3 === 1) b.box(cx, yy + 0.07, zc, slope * 0.5, 0.06, 2.0, 'glass', { rz: -ang * s, tint: '#b8c8d0', collide: false, minimap: false, grad: false, ao: false });
    }
  }
  b.box(0, H + ridge - 0.2, 0, 1.0, 0.4, 2 * HZ + 0.6, 'metal_painted', { tint: '#5a646c', collide: false, minimap: false, grad: false });
  b.noNav(-HX - 1, -HZ - 1, HX + 1, HZ + 1, H - 1, 40);
  // Fachwerkbinder + Stützen + Kranbahn
  for (let i = 0; i <= 10; i++) {
    const zz = -HZ + i * 6;
    if (i > 0 && i < 10) {
      b.box(0, H - 0.3, zz, 2 * HX - 1, 0.3, 0.25, 'metal_painted', { tint: STEEL, collide: false, minimap: false, grad: false });
      for (const s of [-1, 1]) {
        b.box(s * HX / 2, H + ridge / 2 - 0.45, zz, Math.hypot(HX, ridge), 0.25, 0.25, 'metal_painted', { rz: -ang * s, tint: STEEL, collide: false, minimap: false, grad: false, uv: 'local' });
        for (const k of [0.25, 0.5, 0.75]) b.box(s * HX * k, H - 0.05, zz, 0.12, ridge * (1 - k) + 0.1, 0.12, 'metal_painted', { tint: STEEL, collide: false, minimap: false, grad: false });
      }
    }
    if (i === 10) continue;
    for (const s of [-1, 1]) {
      const zc = zz + 3;
      b.box(s * (HX - 0.65), 0, zc, 0.5, H, 0.5, 'metal_painted', { tint: STEEL, minimap: 'pillar', aoFloor: 0 });
      b.box(s * (HX - 1.0), 10.0, zc, 1.0, 0.5, 0.6, 'metal_painted', { tint: STEEL, collide: false, minimap: false, grad: false });
    }
  }
  for (const s of [-1, 1]) {
    b.box(s * (HX - 1.1), 10.5, 0, 0.5, 0.6, 2 * HZ - 1, 'metal_painted', { tint: '#5a646c', collide: false, minimap: false, grad: false });
    b.box(s * (HX - 1.1), 11.1, 0, 0.12, 0.1, 2 * HZ - 1, 'metal_galvanized', { collide: false, minimap: false, grad: false, ao: false });
  }
  // Hallenleuchten (Natriumdampf) + echte Lichter (wenige)
  for (const zz of [-21, -7, 7, 21]) for (const xx of [-9, 9]) {
    b.cyl(xx, H - 1.6, zz, 0.02, 1.3, 'metal_galvanized', { collide: false, seg: 4, ao: false, minimap: false });
    b.cyl(xx, H - 2.1, zz, 0.6, 0.5, 'metal_painted', { r1: 0.18, tint: '#2b2d30', collide: false, seg: 12, ao: false, minimap: false });
    b.cyl(xx, H - 2.12, zz, 0.55, 0.02, 'lamp_sodium', { collide: false, seg: 12, ao: false, cast: false, minimap: false });
    b.glow(xx, H - 2.35, zz, { color: '#ffa850', size: 3.2, intensity: 0.9 });
  }
  b.light('point', -9, 8.6, 7, { color: '#ffae5a', intensity: 40, distance: 24, priority: 1 });
  b.light('point', 9, 8.6, -7, { color: '#ffae5a', intensity: 40, distance: 24, priority: 1 });
  // Kaltes Abendlicht durch die Dachlöcher (Lichtkegel als Staubschleier)
  for (const [x, z] of [[-11, -9], [11, 9], [11, -15], [-11, 15]]) dustShaft(b, x, z);
  // Beschriftung außen
  for (const [k, z] of [[1, 12], [2, 0], [3, -12]]) b.sign(-HX - 0.03, 5.4, z, 1.0, 1.0, 'bay' + k, { ry: -Math.PI / 2, depth: 0.02 });
  // Wandleuchten über Ladetoren, Türen und Toren
  for (const z of [-12, 0, 12]) wallLight(b, -HX, 5.05, z + 2.6, -Math.PI / 2);
  for (const z of [-12, 12]) wallLight(b, HX, 2.9, z + 1.2, Math.PI / 2);
  wallLight(b, HX, 4.75, 3.0, Math.PI / 2);
  for (const s of [-1, 1]) { wallLight(b, -5.2, 5.0, s * HZ, s > 0 ? 0 : Math.PI); wallLight(b, 5.2, 5.0, s * HZ, s > 0 ? 0 : Math.PI); }
  b.sign(HX + 0.03, 3.2, -14.6, 1.6, 1.0, 'helmet', { ry: Math.PI / 2, depth: 0.02 });
  b.sign(HX + 0.03, 3.2, 14.6, 1.8, 0.9, 'closed', { ry: Math.PI / 2, depth: 0.02 });
  b.sign(-HX - 0.03, 3.0, 22, 4.6, 1.2, 'graffiti2', { ry: -Math.PI / 2, back: false, depth: 0 });
  b.sign(HX + 0.03, 2.4, -22, 4.2, 1.1, 'graffiti1', { ry: Math.PI / 2, back: false, depth: 0 });
}

/** Lichtschacht: weicher, additiver Lichtkegel von einem Dachloch (Ränder blenden aus). */
const shaftMats = new WeakMap(); // ein Material je Kartenaufbau (Schlüssel: MapBuilder), ohne Modulzustand
function dustShaft(b, x, z) {
  const geo = new THREE.CylinderGeometry(1.7, 2.8, 13.5, 16, 1, true);
  geo.translate(0, 6.75, 0);
  let shaftMat = shaftMats.get(b);
  if (!shaftMat) {
    shaftMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#a9bcd2') }, uOpacity: { value: 0.11 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; vY = position.y / 13.5; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying float vY;
        void main() { float f = abs(dot(normalize(vN), normalize(vV))); float a = uOpacity * pow(f, 2.5) * smoothstep(0.0, 0.3, vY) * (1.0 - 0.55 * vY); gl_FragColor = vec4(uColor * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    shaftMat.userData.disposable = true;
    shaftMats.set(b, shaftMat);
  }
  const m = new THREE.Mesh(geo, shaftMat);
  m.position.set(x, 0, z); m.rotation.z = 0.32; m.rotation.y = 0.4;
  m.renderOrder = 4;
  b.object(m);
  b.decal(x - 1.8, 0.012, z, 3.6, 3.0, 'puddle', { opacity: 0.85 });
}

// ---------------------------------------------------------------------------
// Halleninneres: Rollgang, Walzgerüste, Laufstege, Öfen, Deckung
// ---------------------------------------------------------------------------
function hallInterior(b) {
  // Laufstege entlang der Längswände + Querbrücke über der Hallenmitte
  const cwx = HX - 1.45; // Mittellinie Laufsteg (Breite 1,8)
  for (const s of [-1, 1]) {
    const x = s * cwx;
    // Geländer innen mit Lücken an Brücke und Treppenpodesten
    catwalk(b, x, -27, x, 27, CW, {
      w: 1.8, supports: true, supportSpacing: 6, supportBoth: false, interior: true, railTint: RAIL,
      // innen offen an den Treppenaustritten (z ±21) und an der Querbrücke
      rails: [s < 0 ? 'r' : 'l'], railCut: s < 0 ? { r: [[0, 5.3], [6.7, 25.9], [28.1, 47.3], [48.7, 54]] } : { l: [[0, 5.3], [6.7, 25.9], [28.1, 47.3], [48.7, 54]] },
    });
    for (const zz of [-27, 27]) railing(b, x - 0.9, zz, x + 0.9, zz, CW, { tint: RAIL, posts: 2 });
  }
  catwalk(b, -cwx + 0.9, 0, cwx - 0.9, 0, CW, { w: 2.2, supports: false, interior: true, railTint: RAIL });
  // Hänger der Querbrücke
  for (const xx of [-13, -6.5, 6.5, 13]) for (const zz of [-1.05, 1.05]) b.cyl(xx, CW, zz, 0.025, 12.2 - CW, 'metal_galvanized', { seg: 4, collide: false, minimap: false, ao: false });
  // Treppen in allen vier Ecken: quer zur Wand, münden frontal auf den Laufsteg (z ±21)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const run = CW / 0.62, xTop = sx * (cwx - 0.9);   // Innenkante des Laufstegs
    stairs(b, { x: xTop - sx * run, z: sz * 21, y0: 0, y1: CW, w: 1.3, dir: sx < 0 ? 'w' : 'e', run, style: 'steel', rail: true, railTint: RAIL, railFrom: 1.0 });
    b.box(xTop - sx * (run - 1.0), 0, sz * 21, 0.12, CW * (1 - 1.0 / run) - 0.3, 0.12, 'metal_painted', { tint: STEEL, minimap: false, collide: false });
  }
  // Wegpunkte im schmalen Gang zwischen Ofen und Stirnwand (liegt zwischen den Rasterpunkten)
  for (const s of [-1, 1]) b.navLine(-20.6, 0.2, s * 28.5, -8.6, 0.2, s * 28.5, 1.2);
  // Rollgang in der Hallenachse mit Lücke in der Mitte, Walzgerüste
  for (const s of [-1, 1]) {
    rollerTable(b, 0, s * 6.5, s * 26.5);
    millStand(b, 0, s * 15.5, s);
  }
  // Öfen an den Stirnseiten (Westteil), Leitstand (Ostteil)
  for (const s of [-1, 1]) {
    furnace(b, -17.5, s > 0 ? 22.5 : -27.5, -9.5, s > 0 ? 27.5 : -22.5, s);
    controlBooth(b, 13.0, s * 24.5, s);
  }
  // Deckung rund um die Hallenmitte (Flagge B)
  for (const s of [-1, 1]) {
    slabStack(b, -7.5, s * 3.6, 0.1 * s, 4);
    coilRow(b, 7.4, s * 3.8, Math.PI / 2, 2);
    crateStack(b, -12.5, s * 9.5, { ry: 0.3 * s, pattern: [[0, 0, 0, 1.1], [1.15, 0, 0.05, 1.0], [0.5, 1, 0, 1.0]] });
    coilRow(b, 13.5, s * 10.5, 0, 3, { top: s > 0 });
    slabStack(b, -14.5, s * 16.5, Math.PI / 2, 6);
    palletStack(b, 15.8, s * 17.5, { n: 4, load: 'wrapped', ry: 0.2 });
    fireBarrel(b, -6.0, s * 21.0, { light: s > 0, intensity: 10 });
    barrelGroup(b, -18.2, s * 9.0, { n: 3, colors: ['#3a4a5a', '#5a3a2a', '#3a4a5a'] });
    gasBottles(b, 18.6, s * 3.5, { n: 4 });
    workbench(b, 19.0, s * 12.0, { ry: -Math.PI / 2 });
    lockers(b, -19.9, s * 16.4, { n: 4, ry: Math.PI / 2 });
    tires(b, 4.6, s * 9.2, { n: 3 });
  }
  // heruntergestürzte Dachbleche unter den Dachlöchern (niedrige Deckung)
  for (const [x, z, ry] of [[-9.5, -11.5, 0.4], [9.8, 7.2, -0.7], [12.0, -13.2, 1.2], [-10.0, 14.0, -0.2]]) fallenSheets(b, x, z, ry);
  // Pfützen, Ölflecken, Schmutz, Schrott in der Halle
  for (let i = 0; i < 34; i++) {
    const x = b.rnd(-20, 20), z = b.rnd(-28, 28), k = b.rand();
    if (k < 0.35) b.decal(x, 0.012, z, b.rnd(1.2, 3), b.rnd(1.2, 3), 'oil', { opacity: 0.6 });
    else if (k < 0.55) b.decal(x, 0.013, z, b.rnd(2, 4), b.rnd(1.5, 3), 'puddle', { opacity: 0.85 });
    else if (k < 0.75) b.decal(x, 0.012, z, b.rnd(2, 4), b.rnd(2, 4), 'stain', { opacity: 0.7 });
    else if (k < 0.88) b.decal(x, 0.012, z, b.rnd(1.5, 3), b.rnd(1.5, 3), 'cracks', { opacity: 0.8 });
    else b.decal(x, 0.012, z, b.rnd(1, 2), b.rnd(1, 2), 'soot', { opacity: 0.7 });
  }
  for (const xx of [-4.2, 4.2]) b.decal(xx, 0.013, 0, 0.18, 52, 'line', { ry: 0, tint: '#d9a72a', kind: 'paint', opacity: 0.8 });
  b.decal(0, 0.014, 0, 5.5, 5.5, 'hatch', { ry: 0, tint: '#d9a72a', opacity: 0.55 });
}

/** Haufen heruntergefallener Wellblechtafeln mit Schutt. */
function fallenSheets(b, x, z, ry) {
  const f = frame(b, x, 0, z, ry);
  f.box(0.2, 0, 0.1, 1.6, 0.35, 1.1, 'concrete', { tint: '#7a7670', collide: false, minimap: false });
  f.box(0, 0.32, 0, 2.6, 0.05, 1.8, 'metal_corrugated', { rx: 0.22, rz: 0.06, tint: '#7d868c', collide: false, minimap: false, grad: false, uv: 'local' });
  f.box(-0.3, 0.05, 0.4, 2.4, 0.05, 1.7, 'metal_corrugated', { rx: -0.08, rz: 0.3, ry: 0.5, tint: '#6d767c', collide: false, minimap: false, grad: false, uv: 'local' });
  for (let i = 0; i < 6; i++) { const [px, pz] = f.P((b.rand() - 0.5) * 2.6, (b.rand() - 0.5) * 2.2); b.box(px, 0, pz, 0.2 + b.rand() * 0.25, 0.1 + b.rand() * 0.15, 0.2 + b.rand() * 0.2, 'concrete', { ry: b.rand() * 3, tint: '#8a8680', collide: false, minimap: false, ao: false }); }
  f.solid(0, 0, 0.05, 2.4, 0.62, 1.6, { minimap: 'cover' });
  b.decal(x, 0.013, z, 3.6, 3.2, 'soot', { opacity: 0.5 });
}

/** Leitstand: kleine Kabine mit Fensterband (begehbar, Deckung). */
function controlBooth(b, x, z, s) {
  const w = 5.6, d = 3.6, h = 2.7;
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  b.boxMM(x0, 0, z0, x1, 0.12, z1, 'rubber_floor', { minimap: false, grad: false });
  const wl = { h, t: 0.15, mat: 'metal_painted', tint: '#6a7a72', frameMat: 'metal_painted', frameTint: '#2b2d30', minimap: 'wall' };
  const inner = s > 0 ? z0 : z1; // Seite zur Hallenmitte
  wall(b, { ...wl, x0, z0: inner, x1, z1: inner, openings: [{ at: 1.4, w: 2.0, h: 1.0, kind: 'window', sill: 1.0, glass: false }, { at: 4.2, w: 2.0, h: 1.0, kind: 'window', sill: 1.0, glass: false }] });
  const outer = s > 0 ? z1 : z0;
  wall(b, { ...wl, x0, z0: outer, x1, z1: outer, openings: [] });
  wall(b, { ...wl, x0, z0, x1: x0, z1, openings: [{ at: d / 2, w: 1.1, h: 2.1, kind: 'door' }] });
  wall(b, { ...wl, x0: x1, z0, x1, z1, openings: [{ at: d / 2, w: 1.4, h: 0.9, kind: 'window', sill: 1.1, glass: false }] });
  b.boxMM(x0 - 0.1, h, z0 - 0.1, x1 + 0.1, h + 0.12, z1 + 0.1, 'metal_painted', { tint: '#3d4247', minimap: 'roof', grad: false });
  b.interior(x0, z0, x1, z1, -0.1, h, 0.6);
  // Pult mit Schaltern, Bildschirmen
  const pz = s > 0 ? z0 + 0.6 : z1 - 0.6;
  b.box(x + 0.3, 0.12, pz, 4.2, 0.85, 0.7, 'metal_painted', { tint: '#4a5058', minimap: 'cover' });
  for (let i = 0; i < 6; i++) b.box(x - 1.4 + i * 0.68, 0.97, pz, 0.5, 0.04, 0.4, i % 2 ? 'lamp_green' : 'lamp_red', { collide: false, minimap: false, ao: false, cast: false, tint: '#606060' });
  for (const ox of [-1, 1]) b.box(x + ox * 1.1, 1.0, pz + s * 0.25, 0.7, 0.45, 0.05, 'glass', { tint: '#20303a', collide: false, minimap: false, ao: false });
  b.noNav(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, 2, 30);
}

/** Brückenkran über der Halle (statisch) mit pendelndem Haken. */
function overheadCrane(b, z) {
  const y = 10.9;
  for (const dz of [-0.9, 0.9]) b.box(0, y, z + dz, 2 * HX - 2.4, 1.0, 0.5, 'metal_painted', { tint: YEL, collide: false, minimap: false, grad: false });
  for (const s of [-1, 1]) b.box(s * (HX - 1.6), y - 0.2, z, 1.2, 1.2, 3.6, 'metal_painted', { tint: '#c89a2a', collide: false, minimap: false, grad: false });
  // Laufkatze + Kabine
  b.box(-3, y + 1.0, z, 2.4, 0.9, 2.6, 'metal_painted', { tint: '#c89a2a', collide: false, minimap: false, grad: false });
  b.box(-7.5, y - 2.0, z + 1.2, 1.8, 1.8, 1.6, 'metal_painted', { tint: '#3d4247', collide: false, minimap: false, grad: false });
  b.box(-7.5, y - 1.6, z + 1.2 + 0.82, 1.6, 1.0, 0.04, 'glass', { tint: '#a0b0b8', collide: false, minimap: false, ao: false });
  b.sign(0, y + 0.1, z + 1.16, 2.4, 0.8, 'crane', { ry: 0, back: false, depth: 0 });
  b.sign(0, y + 0.1, z - 1.16, 2.4, 0.8, 'crane', { ry: Math.PI, back: false, depth: 0 });
  // Haken + Seile (animiert, leichtes Pendeln)
  const g = new THREE.Group();
  g.position.set(-3, y + 0.9, z);
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.6, metalness: 0.8 });
  const yel = new THREE.MeshStandardMaterial({ color: '#d9a72a', roughness: 0.5, metalness: 0.6 });
  dark.userData.disposable = true; yel.userData.disposable = true;
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.2, 5), dark);
  rope.position.y = -2.1; g.add(rope);
  const rope2 = rope.clone(); rope2.position.x = 0.3; g.add(rope2);
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.5), yel);
  block.position.y = -4.5; g.add(block);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 6, 12, Math.PI * 1.4), dark);
  hook.position.set(0, -5.25, 0); hook.rotation.z = Math.PI * 0.8; g.add(hook);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let t = 0;
  b.object(g, { update: dt => { t += dt; g.rotation.z = Math.sin(t * 0.7) * 0.025; g.rotation.x = Math.sin(t * 0.53 + 1) * 0.02; } });
}

// ---------------------------------------------------------------------------
// Kesselhaus (x 30..44, z −12..12): zwei Ebenen, Galerie um die Kessel
// ---------------------------------------------------------------------------
function boilerHouse(b) {
  const x0 = 30, x1 = 44, z0 = -12, z1 = 12, fh = 5.0;
  const hole = { floor: 1, x0: 32.4, z0: -9.6, x1: 41.6, z1: 9.6 };
  const B = building(b, {
    x: (x0 + x1) / 2, z: 0, w: x1 - x0, d: z1 - z0, floors: 2, fh, mat: 'brick', tint: '#9a6250', t: 0.4,
    floorMat: 'concrete', slabMat: 'concrete', upperFloorMat: 'metal_tread', floorTint: '#8a8680', frameMat: 'metal_painted', frameTint: '#2f3438',
    plinth: { h: 0.8, mat: 'concrete', tint: '#8a8680' }, band: { mat: 'concrete', tint: '#8a8680' }, interiorFactor: 0.5,
    holes: [hole],
    roof: { parapet: 0.8, mat: 'concrete', tint: '#7a7670', capMat: 'concrete', capTint: '#8a8680' },
    openings: [
      { side: 'w', at: -6, w: 1.5, h: 2.6, kind: 'door' },
      { side: 'w', at: 6, w: 1.5, h: 2.6, kind: 'door' },
      { side: 'w', at: 0, w: 2.4, h: 2.0, kind: 'window', sill: 1.2, glass: false },
      { side: 'n', at: 0, w: 2.4, h: 3.0, kind: 'door' },
      { side: 's', at: 0, w: 2.4, h: 3.0, kind: 'door' },
      { side: 'e', at: 0, w: 1.4, h: 2.4, kind: 'door' },
      { side: 'e', at: -7, w: 2.0, h: 2.0, kind: 'window', sill: 1.2, glass: false },
      { side: 'e', at: 7, w: 2.0, h: 2.0, kind: 'window', sill: 1.2, glass: false },
      // Obergeschoss (Galerie)
      { side: 'w', at: 0, w: 1.5, h: 2.4, kind: 'door', floor: 1 },
      ...[-8, -4, 4, 8].map(at => ({ side: 'w', at, w: 2.0, h: 2.2, kind: 'window', sill: 1.0, glass: false, floor: 1 })),
      ...[-8, -3, 3, 8].map(at => ({ side: 'e', at, w: 2.0, h: 2.2, kind: 'window', sill: 1.0, glass: false, floor: 1 })),
      ...[-4, 4].map(at => ({ side: 'n', at, w: 2.2, h: 2.2, kind: 'window', sill: 1.0, glass: false, floor: 1 })),
      ...[-4, 4].map(at => ({ side: 's', at, w: 2.2, h: 2.2, kind: 'window', sill: 1.0, glass: false, floor: 1 })),
    ],
  });
  // Galerie-Geländer am Lichthof
  railing(b, hole.x0, hole.z0, hole.x1, hole.z0, fh, { tint: RAIL, posts: 7 });
  railing(b, hole.x0, hole.z1, hole.x1, hole.z1, fh, { tint: RAIL, posts: 7 });
  railing(b, hole.x0, hole.z0, hole.x0, hole.z1, fh, { tint: RAIL, posts: 10 });
  // Ostseite: Treppenaufgänge (beide Hälften) → Geländer dort ausgespart
  for (const s of [-1, 1]) {
    const zr = s * 8.9;
    stairs(b, { x: 33.6, z: zr, y0: 0.12, y1: fh, w: 1.2, dir: 'e', run: 8.0, style: 'steel', rail: true, railTint: RAIL, railFrom: 1.0 });
  }
  railing(b, hole.x1, -8.2, hole.x1, 8.2, fh, { tint: RAIL, posts: 9 });
  // Galerie-Wegpunkte (2 m breite Gänge liegen zwischen den Rasterpunkten)
  for (const s of [-1, 1]) b.navLine(31.4, fh + 0.2, s * 10.6, 42.6, fh + 0.2, s * 10.6, 1.2);
  b.navLine(42.6, fh + 0.2, -10.6, 42.6, fh + 0.2, 10.6, 1.2);
  b.navLine(31.4, fh + 0.2, -10.6, 31.4, fh + 0.2, 10.6, 1.2);
  // Kessel (liegend) auf Sockeln
  for (const s of [-1, 1]) {
    const zc = s * 4.2;
    b.box(37, 0.12, zc, 8.4, 0.6, 2.6, 'brick', { tint: '#8a5a4a', minimap: false });
    b.cyl(37, 2.5, zc, 1.75, 8.6, 'metal_painted', { axis: 'x', tint: '#7d8f98', minimap: 'cover', seg: 20 });
    for (const sx of [-1, 1]) b.cyl(37 + sx * 4.3, 2.5, zc, 1.82, 0.12, 'metal_painted', { axis: 'x', tint: '#3d4247', collide: false, minimap: false, seg: 20 });
    for (const k of [-2, 0, 2]) b.cyl(37 + k, 2.5, zc, 1.79, 0.1, 'metal_painted', { axis: 'x', tint: '#4a5058', collide: false, minimap: false, seg: 20, ao: false });
    b.box(32.6, 1.4, zc, 0.2, 1.4, 1.2, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
    b.cyl(32.5, 2.1, zc, 0.12, 0.1, 'lamp_sodium', { axis: 'x', collide: false, minimap: false, ao: false, cast: false });
    // Dampfleitungen nach oben
    pipe(b, [[39.5, 4.2, zc], [39.5, 8.3, zc], [39.5, 8.3, s * 10.6], [39.5, 11.5, s * 10.6]], { r: 0.18, tint: '#8a8f94' });
    b.cyl(37, 0.7, zc, 1.5, 0.2, 'black', { visual: false, minimap: false });
  }
  // Manometer / Ventilräder am Westgang
  for (const s of [-1, 1]) for (const k of [0, 1]) {
    const zz = s * (2.0 + k * 1.4);
    b.cyl(30.55, 1.6, zz, 0.18, 0.05, 'metal_painted', { axis: 'x', tint: '#c8402f', collide: false, minimap: false, seg: 10, ao: false });
  }
  b.light('point', 37, 4.2, 0, { color: '#ffb468', intensity: 16, distance: 14 });
  b.box(37, fh - 0.3, 0, 3, 0.05, 0.3, 'lamp_sodium', { collide: false, minimap: false, ao: false, cast: false });
  b.sign(x0 - 0.03, 8.6, 0, 6.0, 1.2, 'kessel', { ry: -Math.PI / 2, back: false, depth: 0 });
  for (const zz of [-6, 6]) wallLight(b, x0, 3.0, zz + 1.3, -Math.PI / 2);
  for (const s of [-1, 1]) wallLight(b, 38.6, 3.4, s * 12, s > 0 ? 0 : Math.PI);
  b.sign(x0 - 0.03, 2.6, -8.6, 1.6, 0.9, 'gas', { ry: -Math.PI / 2, depth: 0.02 });
  for (const xx of [33, 41]) roofVent(b, xx, B.roofY, -6, {});
  b.noNav(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, B.roofY - 0.5, 40);
  // Kessel-Oberseiten nicht als Lauffläche
  b.noNav(32.6, -6.5, 41.4, 6.5, 3.0, 4.6);
}

/** Rohrbrücke zwischen Halle (Laufsteg) und Kesselhaus-Galerie mit Rohrtrasse entlang der Gasse. */
function pipeBridge(b) {
  // Laufsteg-Brücke auf Höhe 5,0..5,2
  catwalk(b, HX, 0, 30, 0, CW - 0.1, { w: 1.6, supports: true, supportSpacing: 8, railTint: RAIL });
  b.navLine(HX - 1.8, CW + 0.2, 0, 31.6, 5.2, 0, 1.0);
  // Rohrtrasse (Portale + Rohre) längs der Gasse x 23..29
  for (let z = -40; z <= 40; z += 8) {
    if (Math.abs(z) < 2 || Math.abs(z) === 24) continue;
    for (const xx of [23.2, 28.8]) b.box(xx, 0, z, 0.35, 8.7, 0.35, 'metal_painted', { tint: '#5a646c', minimap: 'pillar' });
    b.box(26, 7.9, z, 6.0, 0.35, 0.4, 'metal_painted', { tint: '#5a646c', collide: false, minimap: false, grad: false });
    b.box(26, 8.7, z, 6.0, 0.25, 0.3, 'metal_painted', { tint: '#5a646c', collide: false, minimap: false, grad: false });
  }
  const runs = [[24.0, 8.3, 0.32, '#8a8f94'], [25.0, 8.35, 0.26, '#b05a3a'], [26.0, 8.3, 0.36, '#5a7a5a'], [27.2, 8.4, 0.22, '#c9a227'], [28.0, 8.3, 0.2, '#8a8f94'], [25.5, 9.15, 0.18, '#3a6a8a']];
  for (const [x, y, r, tint] of runs) {
    b.cyl(x, y + r, -24, r, 32, 'metal_painted', { axis: 'z', tint, collide: false, minimap: false, seg: 10 });
    b.cyl(x, y + r, 24, r, 32, 'metal_painted', { axis: 'z', tint, collide: false, minimap: false, seg: 10 });
    b.cyl(x, y + r, 0, r, 16, 'metal_painted', { axis: 'z', tint, collide: false, minimap: false, seg: 10 });
  }
  // Rohrbogen hinunter ins Kesselhaus und zur Halle
  pipe(b, [[26, 8.66, -6], [29.8, 8.66, -6]], { r: 0.36, tint: '#5a7a5a', flanges: false });
  pipe(b, [[24, 8.62, 6], [22.3, 8.62, 6]], { r: 0.32, tint: '#8a8f94', flanges: false });
}

/** Ziegelschornstein mit Sockel, Bändern und Steigleiter. */
function chimney(b, x, z) {
  b.box(x, 0, z, 6.0, 3.0, 6.0, 'concrete', { tint: '#8a8680', minimap: 'building' });
  b.cyl(x, 3.0, z, 2.7, 39, 'brick', { r1: 1.7, tint: '#9a5a48', seg: 18, minimap: false, collide: false, uv: 'keep' });
  b.solid(x, 2.5, z, 3.6, 40, 3.6, { minimap: false });
  for (const y of [9, 17, 25, 33, 41]) {
    const r = 2.7 - (y - 3) / 39 * 1.0 + 0.06;
    b.cyl(x, y, z, r, 0.4, 'metal_painted', { tint: '#3d4247', seg: 18, collide: false, minimap: false, ao: false });
  }
  b.cyl(x, 41.6, z, 1.9, 0.6, 'brick', { tint: '#7a4a3a', seg: 18, collide: false, minimap: false });
  for (let y = 3.5; y < 41; y += 0.6) b.box(x - 2.75 + (y - 3) / 39 * 1.0, y, z, 0.3, 0.04, 0.5, 'metal_galvanized', { collide: false, minimap: false, ao: false });
  // rote Flugwarnlichter
  for (const a of [0, 2.1, 4.2]) {
    b.box(x + Math.cos(a) * 1.85, 40.6, z + Math.sin(a) * 1.85, 0.25, 0.25, 0.25, 'lamp_red', { collide: false, minimap: false, ao: false, cast: false });
    b.glow(x + Math.cos(a) * 2.0, 40.75, z + Math.sin(a) * 2.0, { color: '#ff2a1a', size: 3.0 });
  }
  b.noNav(x - 3.2, z - 3.2, x + 3.2, z + 3.2, 2, 60);
}

// ---------------------------------------------------------------------------
// Eine Hälfte
// ---------------------------------------------------------------------------
function half(b, M, ctx) {
  const s = M.s, south = s > 0, Z = M.z;

  // ===== Lkw-Hof (West) ==================================================
  // Laderampe (1,2 m) entlang der Hallenwestwand mit Rampe am Ende
  b.boxMM(-27.5, 0, Math.min(0, Z(17.5)), -HX, 1.2, Math.max(0, Z(17.5)), 'concrete', { tint: '#8f8b84', minimap: 'cover' });
  b.boxMM(-27.6, 1.2, Math.min(0, Z(17.5)), -HX, 1.26, Math.max(0, Z(17.5)), 'metal_tread', { minimap: false, grad: false, collide: false, tint: '#8a8f94' });
  b.wedge(-24.75, 0, Z(17.5 + 3.5), 5.5, 1.2, 7.0, 'concrete', { ry: M.ry(Math.PI), tint: '#8f8b84', uv: 'world', minimap: 'stairs' });
  b.decal(-24.75, 0.02, Z(21.0), 5.2, 6.6, 'hatch', { ry: 0, tint: '#d9a72a', opacity: 0.5 });
  // Rammschutz + Dock-Puffer
  for (const zz of [2.6, 10.2, 13.8]) b.box(-27.62, 0.25, Z(zz), 0.25, 0.7, 0.45, 'rubber', { collide: false, minimap: false, grad: false });
  for (const zz of [1.6, 9.0, 16.6]) b.cyl(-27.9, 0, Z(zz), 0.12, 1.2, 'metal_painted', { tint: YEL, seg: 8, minimap: 'prop' });
  // Mitteltreppe auf die Rampe
  stairs(b, { x: -29.6, z: Z(6.0), y0: 0, y1: 1.2, w: 2.6, dir: 'e', run: 2.0, style: 'steel', rail: false });
  // Rampen im Inneren (Ladetor 1,2 m → Hallenboden)
  b.wedge(-HX + 0.5 + 2.0, 0, Z(12), 4.0, 1.2, 4.0, 'concrete', { ry: -Math.PI / 2, tint: '#7f7b74', uv: 'world', minimap: 'stairs' });
  b.navLine(-HX - 2.5, 1.4, Z(12), -HX + 4.6, 0.2, Z(12), 1.0);
  if (south) { b.wedge(-HX + 0.5 + 2.0, 0, 0, 4.0, 1.2, 4.0, 'concrete', { ry: -Math.PI / 2, tint: '#7f7b74', uv: 'world', minimap: 'stairs' }); b.navLine(-HX - 2.5, 1.4, 0, -HX + 4.6, 0.2, 0, 1.0); }
  // Angedockter Sattelzug + Container
  truck(b, -34.3, Z(12), { ry: -Math.PI / 2, trailer: south ? 'box' : 'container', color: south ? '#2d5f94' : '#c8402f', boxColor: '#d8d8d2', containerColor: '#3e7a4c', logo: south ? 'title' : undefined });
  container(b, -45.5, 0, Z(19.5), { len: 12.19, ry: Math.PI / 2, color: south ? '#8d9399' : '#2d5f94' });
  container(b, -45.5, 2.59, Z(19.5), { len: 6.06, ry: Math.PI / 2 + 0.03, color: south ? '#c8402f' : '#d9762a' });
  b.noNav(-47, Z(13), -44, Z(26), 2, 30);
  container(b, -38.5, 0, Z(33.0), { len: 6.06, ry: 0.15 * s, color: '#3e7a4c', openDoors: south });
  // Bunker (Erzbunker) auf Stützen nahe der Hofmitte (nur Süd) / Waage (Nord)
  if (south) hopper(b, -44.5, 3.0); else weighbridge(b, -42, -4.5);
  forklift(b, -32.4, Z(1.0), { ry: M.ry(-Math.PI / 2 + 0.3), load: 'boxes' });
  palletStack(b, -33.6, Z(15.8), { n: 4, load: 'boxes', ry: 0.2 });
  palletStack(b, -39.0, Z(25.6), { n: 3, ry: -0.3 });
  barrelGroup(b, -49.6, Z(8.5), { n: 4, colors: ['#3a4a5a', '#5a3a2a', '#c9a227'] });
  tires(b, -31.6, Z(24.6), { n: 4 }); tires(b, -30.8, Z(25.3), { n: 2 });
  cableReel(b, -49.5, Z(29.6), { ry: 0.3 });
  jersey(b, -34.5, Z(28.6), { len: 3, ry: 0.15 * s });
  jersey(b, -42.0, Z(31.0), { len: 3, ry: Math.PI / 2 - 0.1 * s });
  sandbags(b, -38.0, Z(23.6), -35.6, Z(23.2), { rows: 5 });
  lampPost(b, -28.6, Z(26.5), { h: 7, arm: 1.5, ry: Math.PI, kind: 'sodium', light: south, intensity: 22, distance: 18, glow: true });
  lampPost(b, -51.0, Z(14.0), { h: 7, arm: 1.5, ry: 0, kind: 'sodium', light: !south, intensity: 22, distance: 18, glow: true });
  // Weitere Natriumlampe am Hofende: Lichtkegel als additives Boden-Decal (kein zusätzliches Punktlicht)
  lampPost(b, -51.0, Z(37.0), { h: 7, arm: 1.5, ry: 0, kind: 'sodium', glow: true });
  lampPool(b, -49.5, Z(37.0), 7.5);
  // Westgrenze: Ziegelmauer mit Stacheldraht
  b.boxMM(-52.6, 0, Math.min(0, Z(48)), -52.0, 3.6, Math.max(0, Z(48)), 'brick', { tint: '#8a5a4a', minimap: 'wall' });
  b.boxMM(-52.7, 3.6, Math.min(0, Z(48)), -51.9, 3.75, Math.max(0, Z(48)), 'concrete', { tint: '#8a8680', collide: false, minimap: false, grad: false });
  for (let i = 0; i < 10; i++) {
    const x = b.rnd(-50, -29), z = Z(b.rnd(2, 45)), k = b.rand();
    b.decal(x, 0.012, z, b.rnd(1.5, 3.5), b.rnd(1.5, 3.5), k < 0.4 ? 'oil' : k < 0.7 ? 'puddle' : k < 0.85 ? 'tire' : 'cracks', { opacity: 0.7 });
  }
  for (let z = 4; z < 44; z += 5) b.decal(-29.0, 0.012, Z(z), 0.15, 2.4, 'line', { ry: 0, tint: '#e8e2d4', kind: 'paint', opacity: 0.6 });

  // ===== Vorplatz Halle (z 30..48) ========================================
  slabStack(b, -8.5, Z(34.5), 0.2, 4);
  coilRow(b, 9.0, Z(35.0), 0.2 * s, 3);
  crateStack(b, -15.5, Z(36.0), { ry: 0.4 * s });
  jersey(b, 3.0, Z(37.5), { len: 3, ry: 0.1 * s, stripes: true });
  for (const xx of [-6, 6]) b.cyl(xx, 0, Z(31.0), 0.13, 1.0, 'metal_painted', { tint: YEL, seg: 8, minimap: 'prop' });
  cone(b, -2.4, Z(32.6)); cone(b, -1.6, Z(33.1));
  floodMast(b, 18.0, Z(33.5), { h: 12, ry: M.ry(Math.PI), kind: 'sodium', glow: true });

  // ===== Ostgasse + Kesselhof ===============================================
  // Tanks mit Auffangwanne
  tankBund(b, 40.0, Z(29.0), south ? 'tank1' : 'tank2', s);
  // Umspannanlage
  substation(b, 26.5, Z(26.0), s);
  // Rohrtrasse: Deckung darunter
  crateStack(b, 25.6, Z(13.5), { ry: 0.2, pattern: [[0, 0, 0, 1.0], [1.05, 0, 0, 1.0], [0.5, 1, 0, 0.9]] });
  barrelGroup(b, 27.8, Z(6.0), { n: 3, colors: ['#3a4a5a', '#3a4a5a', '#c8402f'] });
  valveStation(b, 25.2, Z(19.5), s);
  electricBox(b, 29.6, 0, Z(15.6), { ry: -Math.PI / 2, w: 1.2, h: 1.8, d: 0.6, tint: '#7a8a80' });
  // Hinterhof hinter dem Kesselhaus (x 44..52)
  palletStack(b, 47.5, Z(9.5), { n: 3, ry: 0.4 });
  barrelGroup(b, 50.5, Z(17.5), { n: 3 });
  dumpster(b, 48.8, Z(23.0), { ry: Math.PI / 2, color: '#4a5a4a' });
  gasBottles(b, 45.0, Z(4.5), { n: 3 });
  pipe(b, [[44.3, 0.6, Z(6)], [44.3, 0.6, Z(20)], [44.3, 3.5, Z(20)]], { r: 0.14, tint: '#8a8f94', collide: true });
  // Ostgrenze
  b.boxMM(52.0, 0, Math.min(0, Z(48)), 52.6, 3.6, Math.max(0, Z(48)), 'brick', { tint: '#8a5a4a', minimap: 'wall' });
  lampPost(b, 51.2, Z(32.0), { h: 6.5, arm: 1.3, ry: Math.PI, kind: 'sodium', glow: true });
  lampPool(b, 49.9, Z(32.0), 6.5);
  for (let i = 0; i < 8; i++) {
    const x = b.rnd(23, 51), z = Z(b.rnd(2, 45)), k = b.rand();
    b.decal(x, 0.012, z, b.rnd(1.5, 3), b.rnd(1.5, 3), k < 0.4 ? 'oil' : k < 0.75 ? 'puddle' : 'stain', { opacity: 0.7 });
  }

  // ===== Startbereich (z 38..48) ===========================================
  if (south) {
    // Werkstor mit Pförtnerhaus, Parkplatz
    gateWall(b, M, 'gate_s');
    gatehouse(b, 24.0, 44.6);
    car(b, -20.5, 45.6, { ry: Math.PI / 2, color: '#3b3d40' });
    car(b, -12.4, 45.8, { ry: Math.PI / 2 + 0.06, color: '#6b7a52', style: 'hatch' });
    van(b, 3.6, 45.4, { ry: Math.PI / 2 - 0.04, color: '#d8d6d0' });
    car(b, 38.5, 46.0, { ry: -Math.PI / 2, color: '#8c2b24', style: 'wreck' });
    for (const x of [-26, -16, -8, 0, 8]) b.decal(x, 0.012, 45.5, 0.12, 4.4, 'line', { ry: 0, tint: '#e8e2d4', kind: 'paint', opacity: 0.7 });
  } else {
    // Gleisanschluss mit Waggons
    gateWall(b, M, 'gate_n');
    railTrack(b, Z(43.5), -52, 52);
    wagon(b, -28.0, Z(43.5), 'box', '#7a3a2a');
    wagon(b, -10.0, Z(43.5), 'ore', '#3d4247');
    wagon(b, 30.0, Z(43.5), 'box', '#5a4a3a');
    b.box(14.0, 0, Z(46.2), 3.0, 2.4, 2.0, 'metal_painted', { tint: '#5a6a62', minimap: 'cover' });
  }
  sandbags(b, -14.8, Z(39.0), -12.0, Z(39.0), { rows: 5 });
  sandbags(b, 11.6, Z(40.0), 14.4, Z(40.0), { rows: 5 });
  for (let i = 0; i < 8; i++) b.decal(b.rnd(-48, 48), 0.012, Z(b.rnd(38, 47)), b.rnd(2, 4), b.rnd(1.5, 3), b.pick(['stain', 'oil', 'cracks']), { opacity: 0.6 });
  void ctx;
}

/** Tank in Auffangwanne (Betonwand 1,1 m mit Öffnungen). */
function tankBund(b, x, z, label, s) {
  const hw = 6, hd = 5.6, h = 1.1;
  const zs = [z - hd, z + hd];
  for (const zz of zs) wall(b, { x0: x - hw, z0: zz, x1: x + hw, z1: zz, h, t: 0.35, mat: 'concrete', tint: '#9a968e', minimap: 'cover', openings: [{ at: 3.0, w: 2.0, h: 2, kind: 'gap', frame: false }, { at: 9.0, w: 2.0, h: 2, kind: 'gap', frame: false }] });
  for (const xx of [x - hw, x + hw]) wall(b, { x0: xx, z0: z - hd, x1: xx, z1: z + hd, h, t: 0.35, mat: 'concrete', tint: '#9a968e', minimap: 'cover', openings: [{ at: hd, w: 2.2, h: 2, kind: 'gap', frame: false }] });
  tank(b, x, z, { r: 3.6, h: 8.5, legs: 0.4, tint: '#c8c4bc' });
  b.sign(x, 4.6, z + s * 3.62, 3.2, 1.1, label, { ry: s > 0 ? 0 : Math.PI, back: false, depth: 0 });
  // Leiter + Geländer oben
  for (let y = 0.6; y < 9; y += 0.45) b.box(x - 3.66, y, z, 0.06, 0.04, 0.5, 'metal_galvanized', { collide: false, minimap: false, ao: false });
  pipe(b, [[x + 3.6, 0.8, z], [x + 5.5, 0.8, z], [x + 5.5, 0.8, z - s * 5]], { r: 0.16, tint: '#8a8f94' });
  b.noNav(x - 3.8, z - 3.8, x + 3.8, z + 3.8, 0.8, 40);
}

/** Umspannanlage mit Transformatoren hinter Maschendraht. */
function substation(b, x, z, s) {
  for (const ox of [-1.8, 1.8]) {
    b.box(x + ox, 0, z, 2.2, 2.4, 1.6, 'metal_painted', { tint: '#6a7a6a', minimap: 'cover' });
    for (let i = 0; i < 6; i++) b.box(x + ox - 0.9 + i * 0.36, 0.3, z + 0.85, 0.06, 1.8, 0.2, 'metal_painted', { tint: '#5a6a5a', collide: false, minimap: false, ao: false });
    for (const k of [-0.6, 0, 0.6]) {
      b.cyl(x + ox + k, 2.4, z, 0.1, 0.9, 'white', { tint: '#c8a080', seg: 8, collide: false, minimap: false });
      b.cyl(x + ox + k, 3.3, z, 0.02, 1.4, 'metal_galvanized', { seg: 4, collide: false, minimap: false, ao: false });
    }
  }
  const x0 = x - 4, x1 = x + 4, z0 = z - 2.8, z1 = z + 2.8;
  fence(b, x0, z0, x1, z0, { h: 2.2, style: 'mesh' });
  fence(b, x0, z1, x1, z1, { h: 2.2, style: 'mesh' });
  fence(b, x0, z0, x0, z1, { h: 2.2, style: 'mesh' });
  fence(b, x1, z0, x1, z1, { h: 2.2, style: 'mesh' });
  b.sign(x, 1.4, s > 0 ? z0 - 0.03 : z1 + 0.03, 1.4, 0.8, 'trafo', { ry: s > 0 ? Math.PI : 0, depth: 0.01 });
  b.noNav(x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, -1, 30);
}

/** Ventilstation (Rohrknoten mit Handrädern) – halbhohe Deckung. */
function valveStation(b, x, z, s) {
  b.box(x, 0, z, 2.6, 0.3, 1.4, 'concrete', { tint: '#8a8680', minimap: false });
  for (const ox of [-0.8, 0.8]) {
    b.cyl(x + ox, 0.3, z, 0.22, 1.3, 'metal_painted', { tint: '#b05a3a', seg: 10, minimap: false });
    b.cyl(x + ox, 1.6, z, 0.3, 0.06, 'metal_painted', { tint: '#c8402f', seg: 12, collide: false, minimap: false, ao: false });
  }
  b.cyl(x, 1.0, z, 0.2, 2.2, 'metal_painted', { axis: 'x', tint: '#b05a3a', collide: false, minimap: false, seg: 10 });
  b.box(x, 0, z, 2.6, 1.2, 1.0, 'black', { visual: false, minimap: 'cover' });
  void s;
}

/** Erzbunker auf vier Stützen mit Schütte (Wahrzeichen im Lkw-Hof, darunter begehbar). */
function hopper(b, x, z) {
  const y0 = 5.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(x + sx * 2.6, 0, z + sz * 2.6, 0.45, y0, 0.45, 'metal_painted', { tint: '#6a5a4a', minimap: 'pillar' });
  }
  for (const sx of [-1, 1]) b.box(x + sx * 2.6, 2.6, z, 0.2, 0.2, 5.6, 'metal_painted', { tint: '#6a5a4a', collide: false, minimap: false, grad: false });
  b.box(x, y0, z, 6.2, 4.0, 6.2, 'metal_rust', { tint: '#9a7a6a', collide: false, minimap: false, grad: false });
  b.cyl(x, y0 - 1.6, z, 1.0, 1.6, 'metal_rust', { r1: 2.8, seg: 4, ry: Math.PI / 4, collide: false, minimap: false });
  b.box(x, y0 + 4.0, z, 6.6, 0.25, 6.6, 'metal_painted', { tint: '#3d4247', collide: false, minimap: false, grad: false });
  // Förderband schräg hoch zur Halle
  const ax = x + 3, ay = y0 + 3.5, bx = -HX - 0.5, by = 12.0, L = Math.hypot(bx - ax, by - ay);
  b.box((ax + bx) / 2, (ay + by) / 2 - 0.5, z, L, 1.0, 1.6, 'metal_corrugated', { rz: Math.atan2(by - ay, bx - ax), tint: '#8a8f94', collide: false, minimap: false, grad: false, uv: 'local' });
  for (let k = 1; k < 3; k++) { const t = k / 3; b.box(ax + (bx - ax) * t, 0, z, 0.3, ay + (by - ay) * t - 0.9, 0.3, 'metal_painted', { tint: '#5a646c', minimap: 'pillar' }); }
  b.box(x, 0, z, 2.2, 0.6, 2.2, 'metal_rust', { tint: '#6a5a4a', minimap: 'cover' });
  b.decal(x, 0.012, z, 5, 5, 'soot', { opacity: 0.8 });
  b.noNav(x - 3.4, z - 3.4, x + 3.4, z + 3.4, 3, 30);
}

/** Fahrzeugwaage mit Wiegehäuschen. */
function weighbridge(b, x, z) {
  b.box(x, 0, z, 3.4, 0.12, 12, 'metal_tread', { minimap: false, grad: false, tint: '#8a8f94' });
  b.box(x - 3.6, 0, z, 2.4, 2.6, 2.6, 'metal_painted', { tint: '#c8c4bc', minimap: 'cover' });
  b.box(x - 3.6, 1.2, z + 1.31, 1.8, 0.9, 0.04, 'glass', { collide: false, minimap: false, ao: false, tint: '#90a0a8' });
  b.box(x - 3.6, 2.6, z, 2.8, 0.12, 3.0, 'metal_painted', { tint: '#3d4247', collide: false, minimap: false, grad: false });
  b.sign(x - 3.6, 2.0, z - 1.33, 1.8, 0.45, 'waage', { ry: Math.PI, depth: 0.02 });
  for (const sz of [-6.2, 6.2]) jersey(b, x, z + sz, { len: 2.2, ry: 0, stripes: true });
}

/** Mauer am Startbereich mit geschlossenem Tor. */
function gateWall(b, M, key) {
  const s = M.s, zc = M.z(48.2), zi = zc - s * 0.3;
  b.boxMM(-52, 0, Math.min(zc - 0.3, zc + 0.3), -6, 4.2, Math.max(zc - 0.3, zc + 0.3), 'brick', { tint: '#8a5a4a', minimap: 'wall' });
  b.boxMM(6, 0, Math.min(zc - 0.3, zc + 0.3), 52, 4.2, Math.max(zc - 0.3, zc + 0.3), 'brick', { tint: '#8a5a4a', minimap: 'wall' });
  b.boxMM(-52, 4.2, Math.min(zc - 0.35, zc + 0.35), 52, 4.35, Math.max(zc - 0.35, zc + 0.35), 'concrete', { tint: '#8a8680', collide: false, minimap: false, grad: false });
  // Torflügel (Stahlgitter, geschlossen)
  for (let i = 0; i < 24; i++) b.box(-5.75 + i * 0.5, 0, zc, 0.06, 3.4, 0.06, 'metal_painted', { tint: '#2b3a3a', collide: false, minimap: false, grad: false });
  for (const y of [0.3, 1.7, 3.2]) b.box(0, y, zc, 12, 0.1, 0.08, 'metal_painted', { tint: '#2b3a3a', collide: false, minimap: false, grad: false });
  b.box(0, 0, zc, 12, 4.0, 0.12, 'black', { visual: false, minimap: 'wall', bullet: false });
  for (const x of [-6.3, 6.3]) b.box(x, 0, zc, 0.7, 4.6, 0.7, 'brick', { tint: '#7a4a3a', minimap: 'pillar' });
  b.sign(-9.5, 2.2, zi - s * 0.02, 4.0, 1.0, key, { ry: M.ry(Math.PI), depth: 0.02 });
}

/** Pförtnerhaus am Südtor (begehbar). */
function gatehouse(b, x, z) {
  building(b, {
    x, z, w: 5.2, d: 4.0, floors: 1, fh: 3.0, mat: 'brick', tint: '#9a6250', floorMat: 'tiles', frameMat: 'metal_painted', frameTint: '#2a2e33', t: 0.25,
    openings: [
      { side: 'n', at: 1.4, w: 1.0, h: 2.1, kind: 'door' },
      { side: 'w', at: 0, w: 2.6, h: 1.2, kind: 'window', sill: 1.0, glass: false },
      { side: 'n', at: -1.2, w: 1.6, h: 1.1, kind: 'window', sill: 1.0, glass: false },
    ],
    roof: { edge: true, mat: 'concrete' },
  });
  b.box(x - 1.2, 0.12, z + 1.2, 2.0, 0.8, 0.6, 'wood_planks', { tint: '#6a5440', minimap: false });
  b.noNav(x - 3, z - 2.5, x + 3, z + 2.5, 2.5, 6);
}

/** Gleis von x0 bis x1 bei z. */
function railTrack(b, z, x0, x1) {
  b.box((x0 + x1) / 2, 0, z, x1 - x0, 0.08, 3.2, 'gravel', { minimap: false, grad: false, collide: false, tint: '#8a857c' });
  for (let x = x0 + 0.3; x < x1; x += 0.65) b.box(x, 0.06, z, 0.24, 0.1, 2.5, 'wood_planks', { tint: '#5a4a3a', collide: false, minimap: false, grad: false, ao: false });
  for (const dz of [-0.72, 0.72]) b.box((x0 + x1) / 2, 0.14, z + dz, x1 - x0, 0.12, 0.08, 'metal_galvanized', { tint: '#8a8078', collide: false, minimap: false, grad: false, ao: false });
}

/** Güterwagen: 'box' (gedeckt) oder 'ore' (offener Erzwagen). */
function wagon(b, x, z, kind, color) {
  const L = 13, W = 2.9;
  b.box(x, 0.85, z, L, 0.3, W, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
  for (const dx of [-4.5, 4.5]) for (const k of [-0.9, 0.9]) for (const dz of [-0.72, 0.72]) b.cyl(x + dx + k, 0.45, z + dz, 0.45, 0.12, 'metal_painted', { axis: 'z', tint: '#2b2d30', collide: false, minimap: false, seg: 12 });
  if (kind === 'box') {
    b.box(x, 1.15, z, L, 2.9, W, 'metal_corrugated', { tint: color, collide: false, minimap: false, grad: false, uv: 'local' });
    b.cyl(x, 4.05, z, W / 2, L, 'metal_painted', { axis: 'x', arc: Math.PI, tint: color, collide: false, minimap: false, seg: 12, rx: Math.PI / 2 });
    b.box(x, 1.4, z + W / 2 + 0.03, 3.0, 2.4, 0.06, 'metal_painted', { tint: color, collide: false, minimap: false, grad: false });
  } else {
    b.box(x, 1.15, z, L, 1.6, W, 'metal_rust', { tint: color, collide: false, minimap: false, grad: false });
    b.box(x, 2.6, z, L - 0.3, 0.12, W - 0.3, 'gravel', { tint: '#4a3a32', collide: false, minimap: false, grad: false, ao: false });
  }
  b.box(x, 0, z, L, kind === 'box' ? 4.2 : 2.75, W, 'black', { visual: false, minimap: 'vehicle' });
}

// ---------------------------------------------------------------------------
// Kulisse: Hochöfen, Kühltürme, Hallen, Strommasten (ohne Kollision)
// ---------------------------------------------------------------------------
function backdrop(b) {
  const q = 1000;
  const o = (chunk, tint) => ({ tint, collide: false, minimap: false, grad: false, ao: false, chunk, cast: false });
  // Hallenreihen
  for (const [x, z, w, d, h, t] of [[-92, -20, 30, 70, 16, '#8a5a4a'], [-90, 60, 36, 30, 12, '#7a6a5a'], [92, -40, 28, 50, 14, '#6a6a68'], [96, 40, 34, 40, 18, '#8a5a4a'], [10, 90, 70, 24, 13, '#7a6a5a'], [-30, -92, 60, 26, 15, '#6a6a68'], [40, -95, 40, 30, 11, '#8a5a4a']]) {
    b.box(x, 0, z, w, h, d, 'brick', o(q + (x < 0 ? 0 : 1), t));
    b.box(x, h, z, w + 0.6, 0.6, d + 0.6, 'metal_painted', o(q + (x < 0 ? 0 : 1), '#3d4247'));
    for (let k = 0; k < 3; k++) b.box(x + (k - 1) * w / 3.2, h + 0.6, z, w / 4, 1.8, d * 0.9, 'metal_corrugated', o(q + (x < 0 ? 0 : 1), '#5a646c'));
  }
  // Hochofen-Silhouette im Nordwesten
  b.cyl(-75, 0, -75, 7, 34, 'metal_rust', { ...o(q + 2, '#6a4a3a'), seg: 14, r1: 5 });
  b.cyl(-75, 34, -75, 4, 10, 'metal_rust', { ...o(q + 2, '#5a4038'), seg: 12, r1: 3 });
  for (const [x, z] of [[-62, -80], [-88, -64]]) b.cyl(x, 0, z, 4.2, 28, 'metal_painted', { ...o(q + 2, '#7a7670'), seg: 12 });
  b.box(-68, 22, -77, 16, 1.4, 1.4, 'metal_rust', o(q + 2, '#5a4038'));
  // Kühltürme im Nordosten
  for (const [x, z] of [[85, -95], [118, -70]]) b.cyl(x, 0, z, 16, 34, 'concrete', { ...o(q + 3, '#9a968e'), seg: 22, r1: 11 });
  // Strommasten
  for (let i = 0; i < 6; i++) {
    const x = -140 + i * 56, z = 120;
    b.box(x, 0, z, 1.2, 30, 1.2, 'metal_galvanized', o(q + 4, '#8a8f94'));
    b.box(x, 26, z, 12, 0.4, 0.4, 'metal_galvanized', o(q + 4, '#8a8f94'));
    b.box(x, 21, z, 9, 0.4, 0.4, 'metal_galvanized', o(q + 4, '#8a8f94'));
  }
  // weitere Schornsteine
  for (const [x, z, h] of [[-110, 30, 46], [70, 110, 38], [130, 10, 52]]) b.cyl(x, 0, z, 2.6, h, 'brick', { ...o(q + 5, '#8a5a48'), seg: 12, r1: 1.6 });
  // Halden + Böschungen am Horizont
  b.geom(moundsGeom(), 0, 0, 0, 'gravel', { ...o(q + 6, '#6f6a62'), uv: 'world', bullet: false });
}

/** Schlackehalden-Ring am Horizont (Radius 140–420 m). */
function moundsGeom() {
  const segA = 80, rings = [138, 155, 180, 215, 260, 320, 420];
  const pos = [], idx = [];
  const n1 = (a, k) => Math.sin(a * 4 + k) * 0.5 + Math.sin(a * 9 + k * 1.7) * 0.3 + Math.sin(a * 23 + k) * 0.2;
  for (const r of rings) for (let i = 0; i <= segA; i++) {
    const a = (i / segA) * Math.PI * 2, t = Math.min(1, Math.max(0, (r - 145) / 150));
    const h = -0.8 + t * t * (10 + 18 * (0.5 + 0.5 * n1(a, r * 0.017)));
    pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segA; i++) { const a = j * (segA + 1) + i, c = a + segA + 1; idx.push(a, a + 1, c, a + 1, c + 1, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(segA + 3) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}
