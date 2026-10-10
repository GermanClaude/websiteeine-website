// NULLPUNKT — Karte „Hafen“: Containerterminal Nordkai zur goldenen Stunde. (Owner: world)
// Drei Bahnen: Kaikante mit Portalkran (West) · Containerlabyrinth mit Kranplatz (Mitte) · Lagerhalle 3 (Ost).
// Team A startet im Süden (Torbereich), Team B im Norden (Bereitstellungsfläche).
import * as THREE from 'three';
import { building, wall, stairs, railing, catwalk, slab } from '../arch.js';
import {
  container, CONTAINER_H, crateStack, barrelGroup, pallet, palletStack, sandbags, jersey, bollard, cone,
  lampPost, floodMast, fence, tires, cableReel, gasBottles, electricBox, acUnit, pipe, cable,
  rack, workbench, dumpster, frame, roofVent, dress,
} from '../props.js';
import { craneClock, createTrack, partBuilder, partGroup, place, inView } from '../crane-anim.js';
// Kartenrunde 2: Fahrzeuge mit richtig gedrehten Rädern, Innenausstattung, begehbare Container, Kartengrenzen
import { stapler as forklift, lkw as truck, transporter as van, pkw as car } from './hafen-fahrzeuge.js';
import {
  schreibtisch, stuhl, aktenschrank, regal, tisch, besprechung, kaffeeEcke, kuechenzeile, kuehlschrank, minikuehlschrank,
  wasserspender, pinnwand, spinde, deckenleuchte, offenerContainer, kaiAbsperrung, schiebetor, steigleiter,
  festesModell,
} from './hafen-ausstattung.js';

const H = CONTAINER_H;
const QUAY_X = -44;

export default {
  id: 'hafen',
  seed: 20251,
  // maps-expand: Osthof (x 50..74) – Spielfläche 96 × 104 → 120 × 104 m (+25 %)
  bounds: { minX: -46, maxX: 74, minZ: -52, maxZ: 52, minY: -3, maxY: 16 },
  visualBounds: { minX: -140, maxX: 140, minZ: -200, maxZ: 130 },
  chunkSize: 32,
  ambience: 'harbor',
  // Fotoscan-Bibliothek (assets/lib): HDRI für Umgebungslicht + Himmel, Materialzuordnung siehe world/library.js
  // Büro-/Pförtnerwände: glatt gestrichener Putz statt Außenputz
  assets: { hdri: 'freight_station', materials: { plaster_white: { id: 'plaster_painted', color: 1.6 } } },
  defaultSurface: 'concrete',
  lighting: {
    sun: { elevation: 15, azimuth: 247, color: '#ffbf80', intensity: 3.5 },
    // hdri*: Werte mit HDRI-Umgebung (freight_station, Sonne gedeckelt) – das Foto-Umgebungslicht ist voller als der
    // prozedurale Himmel, deshalb weniger Füllicht (die Sonne zeichnet harte Schatten wie in Fotos)
    sky: { turbidity: 7, rayleigh: 2.4, mieCoefficient: 0.009, mieDirectionalG: 0.86, exposure: 0.5, clouds: { coverage: 0.38, density: 0.42, scale: 0.00018, elevation: 0.55 }, hazeHigh: 0.13, hazeAmount: 0.9, hdriIntensity: 0.5 },
    // Umgebung ohne Mie-Hotspot (lighting.js begrenzt die Env-Map) → Füllicht etwas angehoben
    hemi: { sky: '#d6c2ad', ground: '#6e5a45', intensity: 0.75, hdriIntensity: 0.35 },
    env: { intensity: 1.15, ground: '#7a6650', groundIntensity: 0.55, tint: '#ffe6cc', hdriIntensity: 0.55 },
    // Höhennebel: warmer Hafendunst über dem Wasser, dichter am Boden (Skalenhöhe ≈ 30 m), Gegenlicht der tiefen Sonne
    fog: { color: '#dcb28a', near: 70, far: 420, density: 0.0045, falloff: 0.033, start: 25, sun: 0.6, sunExp: 4 },
    shadow: { size: 42 },
    // Sonden-Gitter (Innenräume, Rückprall), Atmosphäre (Strahlen durch die Hallentore, Staub)
    probes: { bounce: 1.1 },
    // atmosphere-weather: Lichtschein – Strahlen durch die Hallentore (kräftiger), tiefe Abendsonne in Schlitzen
    // zwischen den Containerstapeln (slots) und durch Öffnungen ins Freie (outdoor)
    atmos: { beams: 0.032, beamG: 0.45, dust: 1.15, slots: 0.75, outdoor: 0.6 },
  },
  // Belichtung (core-render, post/exposure): mit Sonden gemessenes L̄ draußen 0,104 (vorher 0,118) → Referenz neu,
  // etwas kräftigere Anpassung, damit Halle/Büros (L̄ ≈ 0,032) wie bisher ≈ 1 Blende aufgehellt werden
  grade: { exposure: { ref: 0.105, strength: 0.78 } },

  build(b, ctx) {
    const zones = [];
    signs(b);
    // -----------------------------------------------------------------------
    // Boden & Wasser
    // -----------------------------------------------------------------------
    b.groundTiled(QUAY_X, -52, -27, 52, 'concrete', { cell: 1 });        // Kaiplatte
    b.groundTiled(-27, -52, 50, 52, 'asphalt', { cell: 1 });             // Terminal
    zones.push({ x0: QUAY_X, z0: -52, x1: -27, z1: 52, kind: 'dock' });
    zones.push({ x0: -140, z0: -200, x1: QUAY_X, z1: 130, kind: 'water' });
    // Kulissenboden
    b.groundTiled(50, -52, 74, 52, 'asphalt', { cell: 2, tint: '#d9d4cb' });   // Osthof (maps-expand)
    b.groundTiled(QUAY_X, -200, 140, -52, 'asphalt', { cell: 4, collide: false, groundAO: false });
    b.groundTiled(QUAY_X, 52, 140, 130, 'asphalt', { cell: 4, collide: false, groundAO: false });
    b.groundTiled(74, -52, 140, 52, 'asphalt', { cell: 4, collide: false, groundAO: false });
    // Kaimauer zum Wasser + Kante + Fender
    b.box(QUAY_X - 0.3, -3.5, -40, 0.6, 3.5, 320, 'concrete_dark', { collide: false, minimap: false, grad: false });
    b.box(QUAY_X + 0.25, 0, 0, 0.5, 0.22, 104, 'concrete', { tint: '#c9c4b8', minimap: false, grad: false });
    b.decal(QUAY_X + 0.9, 0.01, 0, 0.4, 104, 'line', { ry: 0, tint: '#e8c22c', kind: 'paint', opacity: 0.85 });
    for (let z = -100; z <= 50; z += 6) b.cyl(QUAY_X - 0.75, -2.6, z, 0.32, 2.4, 'rubber', { seg: 10, collide: false, minimap: false, grad: false });
    for (let z = -46; z <= 48; z += 11.5) bollard(b, QUAY_X + 0.9, z, { mooring: true });
    // Kaikante (kein Sturz ins Wasser): Kollision an der Mauer, sichtbar gemacht durch Pfosten mit Kette auf der Kante
    b.collider(QUAY_X - 0.2, -3, 0, 0.4, 12, 112);
    kaiAbsperrung(b, QUAY_X + 0.28, -51.6, 51.6);
    const water = ctx.water({ x0: -700, z0: -700, x1: QUAY_X - 0.6, z1: 700, y: -1.7, color: '#24505c', scale: 10 });
    void water;
    // Kranschienen (nach Norden bis hinter den zweiten Kulissenkran, z −176..52: dessen Fahrbereich)
    for (const x of [-42.2, -30.8]) b.box(x, 0, -62, 0.16, 0.02, 228, 'metal_galvanized', { collide: false, minimap: false, grad: false, ao: false });
    // Fahrbahnmarkierungen
    for (const z of [-30, 30]) b.decal(-12, 0.01, z, 26, 0.15, 'line', { ry: 0, tint: '#f2f0ea', kind: 'paint', opacity: 0.8 });
    for (let z = -46; z <= 46; z += 4) b.decal(-20.6, 0.01, z, 0.15, 2.2, 'line', { ry: 0, tint: '#e8c22c', kind: 'paint', opacity: 0.8 });
    for (let z = -46; z <= 46; z += 4) b.decal(10.8, 0.01, z, 0.15, 2.2, 'line', { ry: 0, tint: '#f2f0ea', kind: 'paint', opacity: 0.8 });
    b.decal(10.8, 0.012, 38, 2.2, 3.2, 'arrow', { ry: Math.PI, tint: '#f2f0ea' });
    b.decal(10.8, 0.012, -38, 2.2, 3.2, 'arrow', { ry: 0, tint: '#f2f0ea' });
    // Stellplatz-Raster (Container-Slots)
    for (const z of [-41, -21, 19, 39]) for (const x of [-15.6, 4.8]) b.decal(x, 0.011, z, 5.6, 0.12, 'line', { ry: 0, tint: '#e8c22c', kind: 'paint', opacity: 0.6 });
    // Schmutz, Pfützen, Ölflecken
    for (let i = 0; i < 46; i++) {
      const x = b.rnd(-42, 72), z = b.rnd(-50, 50);
      const k = b.rand();
      if (k < 0.35) b.decal(x, 0.012, z, b.rnd(1.2, 3), b.rnd(1.2, 3), 'oil', { opacity: 0.55 });
      else if (k < 0.55) b.decal(x, 0.013, z, b.rnd(2, 5), b.rnd(1.5, 3.5), 'puddle', { opacity: 0.9 });
      else if (k < 0.75) b.decal(x, 0.012, z, b.rnd(2, 4), b.rnd(2, 4), 'stain', { opacity: 0.7 });
      else if (k < 0.85) b.decal(x, 0.012, z, 2.2, 5, 'tire', { opacity: 0.5 });
      else b.decal(x, 0.012, z, b.rnd(1.5, 3), b.rnd(1.5, 3), 'cracks', { opacity: 0.8 });
    }
    for (const [x, z] of [[-6, 9], [-20, -48], [24, 30], [28, -30], [-36, 8]]) b.decal(x, 0.012, z, 1.1, 1.1, 'manhole', { opacity: 1 });
    for (const [x, z] of [[-27.2, -6], [-27.2, 6], [12.6, 20], [12.6, -20]]) b.decal(x, 0.012, z, 1.2, 1.2, 'drain', { ry: Math.PI / 2 });

    // -----------------------------------------------------------------------
    // Westbahn: Kaikante mit Portalkran
    // -----------------------------------------------------------------------
    // Kräne fahren nach der gemeinsamen Uhr (online Host-Zeit) → alle Spieler sehen dieselbe Stellung; attach() verdrahtet sie
    const clock = craneClock();
    gantryCrane(b, 0, { label: 'crane_grete', clock });
    // Deckung entlang der Kaikante (Süd → Nord, nahezu punktsymmetrisch)
    stackAt(b, -37.2, 39, 6.06, 'z', ['#2d5f94', '#c8402f']);
    stackAt(b, -37.2, -39, 6.06, 'z', ['#3e7a4c', '#d9762a']);
    forklift(b, -38.5, 26, { ry: Math.PI * 0.85, load: 'sacks' });
    forklift(b, -36.5, -26.5, { ry: -0.25, color: '#d0502a' });
    palletStack(b, -33.5, 27.5, { n: 5, ry: 0.1, load: 'wrapped' });
    palletStack(b, -35, -29.5, { n: 3, ry: 0.4 });
    pallet(b, -40.5, 0, 30, { ry: 0.3, load: 'sacks' });
    pallet(b, -32.4, 0, -24, { ry: -0.2, load: 'boxes' });
    crateStack(b, -34.2, 15.5, { ry: 0.3 });
    crateStack(b, -36.4, -14.8, { ry: -0.5, pattern: [[0, 0, 0, 1.2], [1.25, 0, 0.1, 1.0], [0.6, 1, 0.05, 1.0], [-0.1, 0, 1.25, 1.0]] });
    cableReel(b, -40.6, 16.2, { ry: 0.2 }); cableReel(b, -39.2, 17.6, { ry: 1.2, r: 0.5 });
    barrelGroup(b, -40.8, -16.5, { n: 4, colors: ['#2d5f94', '#2d5f94', '#c8402f'] });
    jersey(b, -35.5, 6.5, { len: 3, ry: 0.15 });
    jersey(b, -36.8, -6.5, { len: 3, ry: -0.2 });
    tires(b, -29.4, 11.2, { n: 3 }); tires(b, -30.0, 11.95, { n: 2 });
    // Kaibüros (begehbar)
    kiosk(b, -31.5, 21.5, Math.PI);
    kiosk(b, -31.5, -21.5, 0);
    floodMast(b, -29, 34, { h: 14, ry: -Math.PI / 2, kind: 'sodium' });
    floodMast(b, -29, -34, { h: 14, ry: -Math.PI / 2, kind: 'sodium' });
    for (const z of [-48, -12, 12, 48]) lampPost(b, -28.3, z, { h: 7, arm: 1.4, ry: Math.PI, kind: 'sodium' });
    // Rettungsring-Ständer
    for (const z of [-33, 14, 44]) lifebuoy(b, QUAY_X + 1.6, z);

    // -----------------------------------------------------------------------
    // Mittelbahn: Containerlabyrinth + Kranplatz
    // -----------------------------------------------------------------------
    // Westlicher Rand (x ≈ −24.4)
    stackAt(b, -24.4, -40, 12.19, 'z', ['#2d5f94', '#8d9399']);
    offenerContainer(b, -24.4, -27, { len: 6.06, ry: -Math.PI / 2, color: '#c8402f' });
    stackAt(b, -24.4, -14, 6.06, 'z', ['#3e7a4c', '#c9a227']);
    stackAt(b, -24.4, 40, 12.19, 'z', ['#c8402f', '#2d5f94']);
    offenerContainer(b, -24.4, 27, { len: 6.06, ry: Math.PI / 2, color: '#d9762a' });
    stackAt(b, -24.4, 14, 6.06, 'z', ['#6b3f7a', '#3e7a4c']);
    container(b, -25.6, 0, 1.5, { len: 6.06, ry: Math.PI / 2 + 0.28, color: '#1f6f6a' });
    // Reihe 2 (doppelt, x ≈ −15.6)
    stackAt(b, -16.82, -40, 12.19, 'z', ['#8d9399']);
    stackAt(b, -14.38, -40, 12.19, 'z', ['#2d5f94', '#c8402f']);
    stackAt(b, -16.82, -21.5, 6.06, 'z', ['#c9a227', '#3e7a4c']);
    stackAt(b, -14.38, -21.5, 6.06, 'z', ['#b8392c', '#e3e1da']);
    stackAt(b, -16.82, -12.5, 6.06, 'z', ['#2d5f94']);
    stackAt(b, -14.38, -12.5, 6.06, 'z', ['#9a3328']);
    stackAt(b, -16.82, 40, 12.19, 'z', ['#d9762a']);
    stackAt(b, -14.38, 40, 12.19, 'z', ['#3e7a4c', '#8d9399']);
    stackAt(b, -16.82, 21.5, 6.06, 'z', ['#2d5f94', '#d9762a']);
    stackAt(b, -14.38, 21.5, 6.06, 'z', ['#e3e1da', '#c8402f']);
    stackAt(b, -16.82, 12.5, 6.06, 'z', ['#6b3f7a']);
    stackAt(b, -14.38, 12.5, 6.06, 'z', ['#c9a227']);
    // Reihe 3 (x ≈ −4.8): erhöhte Route
    stackAt(b, -4.8, -43.5, 6.06, 'z', ['#3e7a4c']);
    stackAt(b, -4.8, -36, 6.06, 'z', ['#c8402f', '#2d5f94']);
    stackAt(b, -4.8, -19.5, 12.19, 'z', ['#d9762a'], { logo: 'logo_nordstern' });
    stackAt(b, -4.8, 43.5, 6.06, 'z', ['#8d9399']);
    stackAt(b, -4.8, 36, 6.06, 'z', ['#2d5f94', '#3e7a4c']);
    stackAt(b, -4.8, 19.5, 12.19, 'z', ['#2d5f94'], { logo: 'logo_kairos' });
    // Treppen auf die Reihe-3-Container (Machtposition über dem Kranplatz)
    containerStairs(b, -6.85, -24.3, 's', -6.02);
    containerStairs(b, -2.75, 24.3, 'n', -3.58);
    plankBridge(b, -6.0, -14.2, -13.2, -14.2);
    plankBridge(b, -6.0, 14.2, -13.2, 14.2);
    // Reihe 4 (doppelt, x ≈ 4.8)
    stackAt(b, 3.58, -40, 12.19, 'z', ['#c8402f', '#8d9399']);
    stackAt(b, 6.02, -40, 12.19, 'z', ['#2d5f94', '#2d5f94']);
    stackAt(b, 3.58, -22.5, 6.06, 'z', ['#3e7a4c']);
    stackAt(b, 6.02, -22.5, 6.06, 'z', ['#e3e1da', '#c9a227']);
    stackAt(b, 3.58, 40, 12.19, 'z', ['#3e7a4c', '#c9a227']);
    stackAt(b, 6.02, 40, 12.19, 'z', ['#d9762a', '#2d5f94']);
    stackAt(b, 3.58, 22.5, 6.06, 'z', ['#c8402f', '#9a3328']);
    stackAt(b, 6.02, 22.5, 6.06, 'z', ['#2d5f94']);
    stackAt(b, 4.8, -11, 6.06, 'x', ['#8d9399']);
    stackAt(b, 4.8, 11, 6.06, 'x', ['#c8402f']);
    // Kranplatz (B): Reachstacker, Kisten, Deckung
    reachStacker(b, -9.8, 3.2, Math.PI * 0.08);
    crateStack(b, -13.2, -5.4, { ry: 0.25 });
    crateStack(b, -2.9, 5.8, { ry: -0.6 });
    jersey(b, -8.2, -6.2, { len: 3, ry: 0.05 });
    sandbags(b, -13.2, 6.0, -11.2, 6.9, { rows: 5 });
    barrelGroup(b, -1.6, -4.8, { n: 3 });
    palletStack(b, -19.4, -3.5, { n: 6, ry: 0.15 });
    palletStack(b, -19.6, 4.2, { n: 3, ry: -0.3, load: 'boxes' });
    cone(b, -7.1, 7.3); cone(b, -6.2, 7.5); cone(b, -11.9, -7.6);
    floodMast(b, -9.4, -30.2, { h: 18, ry: Math.PI / 2, kind: 'sodium' });
    floodMast(b, -9.4, 30.2, { h: 18, ry: -Math.PI / 2, kind: 'sodium' });
    for (const s of [-1, 1]) b.box(-9.24, 9.3, s * 30.2, 0.14, 0.3, 0.16, 'metal_painted', { tint: '#3a3d40', collide: false, minimap: false, grad: false }); // Kabelschelle
    // Querschläge
    crateStack(b, -10, -32, { ry: 1.2, pattern: [[0, 0, 0, 1.1], [1.15, 0, 0, 1.1]] });
    crateStack(b, -9, 32.5, { ry: -1.0, pattern: [[0, 0, 0, 1.1], [0, 0, 1.15, 1.0], [0, 1, 0.55, 1.0]] });
    gasBottles(b, -20.8, -31.5, { n: 5 });
    dumpster(b, -20.6, 31.6, { ry: Math.PI / 2 });
    electricBox(b, 0.6, 0, -30.8, { ry: 0, w: 1.6, h: 1.8, d: 0.6, tint: '#8f9a90' });
    electricBox(b, 0.6, 0, 30.8, { ry: Math.PI, w: 1.6, h: 1.8, d: 0.6, tint: '#8f9a90' });

    // -----------------------------------------------------------------------
    // Ostbahn: Laderampe + Lagerhalle 3
    // -----------------------------------------------------------------------
    warehouse(b);
    van(b, 9.8, -16.5, { ry: 0.05, color: '#e8e6e0', logo: 'logo_kurier' });
    van(b, 10.2, 16, { ry: Math.PI - 0.08, color: '#cfd4d8' });
    forklift(b, 11.6, 4.8, { ry: Math.PI / 2 + 0.3, load: 'boxes', color: '#e0a02a' });
    palletStack(b, 12.2, -5.2, { n: 4, ry: 0.05, load: 'boxes' });
    pallet(b, 9.8, 0, -1.5, { ry: 1.4, load: 'wrapped' });
    // Straße hinter der Halle
    truck(b, 46.4, -27, { ry: Math.PI, trailer: 'box', color: '#2d5f94', boxColor: '#e2e2dc', logo: 'logo_nordstern' });
    truck(b, 46.6, 30, { ry: 0, trailer: 'container', color: '#c8402f', containerColor: '#3e7a4c' });
    car(b, 45.6, 3.5, { ry: 0.05, color: '#b98b3a' });
    jersey(b, 45.8, -6, { len: 3, ry: Math.PI / 2, stripes: true });
    for (const z of [-40, -14, 14, 40]) lampPost(b, 49.6, z, { h: 7, arm: 1.5, ry: Math.PI, kind: 'sodium' });
    // Osthof: Leercontainerdepot mit Schuppen 4 und Kranfundamenten (maps-expand)
    eastYard(b);
    // Zusatzdeckung an dünnen Stellen (Straße hinter der Halle, Hallenvorfeld, Kaikante) – maps-expand
    crateStack(b, 47.6, 14.2, { ry: 0.3 });
    crateStack(b, 47.9, -13.0, { ry: -0.15, pattern: [[0, 0, 0, 1.2], [1.25, 0, 0.05, 1.1], [0.55, 1, 0.02, 1.0]] });
    cableReel(b, 44.4, 22.6, { ry: 0.5 });
    sandbags(b, 44.2, -40.6, 46.8, -40.2, { rows: 5 });
    jersey(b, 10.4, 27.0, { len: 3, ry: Math.PI / 2 + 0.06, stripes: true });
    jersey(b, 10.6, -27.4, { len: 3, ry: Math.PI / 2 - 0.08, stripes: true });
    crateStack(b, -39.6, 2.6, { ry: 0.5, pattern: [[0, 0, 0, 1.1], [1.15, 0, 0.05, 1.0]] });
    barrelGroup(b, -33.4, -2.8, { n: 3, colors: ['#c8402f', '#c9a227', '#c8402f'] }); // nur barrel_01 (Modellbudget „niedrig“)

    // -----------------------------------------------------------------------
    // Süd (Team A): Torbereich
    // -----------------------------------------------------------------------
    gatehouse(b, 26, 45.5);
    fence(b, QUAY_X + 1, 52.4, 20.5, 52.4, { h: 2.6, style: 'chain', barbed: true });
    fence(b, 31.5, 52.4, 74.4, 52.4, { h: 2.6, style: 'chain', barbed: true });
    b.collider(26, 0, 52.6, 11, 6, 0.4, {});
    for (const x of [21.5, 30.5]) { b.box(x, 0, 52.2, 0.5, 1.1, 0.5, 'concrete', { tint: '#e8e2d4', minimap: 'cover' }); }
    schiebetor(b, 20.6, 31.4, 52.62, { sign: 'gate_closed' });
    barrier(b, 26, 49.4);
    // Tempo 10 an der Torausfahrt (rechts in Fahrtrichtung Süd, Blick zum Terminal)
    b.cyl(20.7, 0, 50.4, 0.04, 2.2, 'metal_galvanized', { seg: 6, minimap: 'prop' });
    b.sign(20.7, 1.7, 50.35, 0.6, 0.6, 'speed', { ry: Math.PI, depth: 0.02 });
    truck(b, 38.2, 44, { ry: Math.PI / 2, trailer: 'container', color: '#e0e0da', containerColor: '#2d5f94', logo: 'logo_kairos' });
    stackAt(b, -30.4, 46.3, 6.06, 'x', ['#c9a227']);
    jersey(b, -10.2, 44.8, { len: 3, ry: 0.3, stripes: true });
    jersey(b, 9.5, 44.6, { len: 3, ry: -0.2, stripes: true });
    cone(b, 18, 47); cone(b, 19.2, 47.8); cone(b, 20.3, 48.4);

    // -----------------------------------------------------------------------
    // Nord (Team B): Bereitstellung
    // -----------------------------------------------------------------------
    officeNorth(b, 27, -45);
    stackAt(b, -30.4, -46.3, 6.06, 'x', ['#2d5f94']);
    jersey(b, -10.2, -44.8, { len: 3, ry: -0.3, stripes: true });
    jersey(b, 9.5, -44.6, { len: 3, ry: 0.2, stripes: true });
    car(b, 9, -49.6, { ry: Math.PI / 2, color: '#c7c7c2' });
    car(b, 13.8, -49.6, { ry: Math.PI / 2 + 0.05, color: '#2f4f6e' });
    // Nordgrenze: Containerwand (3 hoch) + Kulisse
    for (let x = -42; x <= 15; x += 12.4) stackAt(b, x + 6, -54.6, 12.19, 'x', [b.pick(['#8d9399', '#2d5f94', '#c8402f']), b.pick(['#3e7a4c', '#d9762a', '#e3e1da']), b.pick(['#2d5f94', '#9a3328'])]);
    fence(b, QUAY_X + 1, -52.6, -42, -52.6, { h: 2.6 });
    fence(b, 19.5, -52.6, 74.4, -52.6, { h: 2.6, style: 'chain', barbed: true });

    // -----------------------------------------------------------------------
    // Kulisse außerhalb (ohne Kollision)
    // -----------------------------------------------------------------------
    backdrop(b);
    // Kulissenkräne fahren auf den Schienen (Bereiche überlappen nicht, Abstand der Fahrwerke ≥ 4,8 m)
    gantryCrane(b, -95, { backdrop: true, clock, seed: 951, period: 205, range: [-106, -76] });
    gantryCrane(b, -150, { backdrop: true, clock, seed: 1502, period: 233, range: [-160, -132] });
    ship(b);
    dressing(b);

    // -----------------------------------------------------------------------
    // Startpunkte & Flaggen
    // -----------------------------------------------------------------------
    const spawns = { A: [], B: [], ffa: [] };
    const sA = [[-38, 47], [-31, 43], [-19, 47.5], [-9, 48], [0, 47], [10.5, 47.5], [16, 43], [34, 49.5], [-21, 41.5], [1.5, 41.5], [55.5, 48.5], [64, 49.5], [72.5, 49.5]];
    for (const [x, z] of sA) { spawns.A.push({ x, z, yaw: 0 }); spawns.B.push({ x, z: -z, yaw: Math.PI }); }
    for (const [x, z] of [[-40, 20], [-38, -8], [-34, -40], [-20, -26], [-20, 26], [-10, 18], [-11, -18], [0, -1], [9, -30], [9, 30], [20, -10], [38.5, 8], [24, 14], [38, -14], [30, -40], [-26, -48], [61, -15], [61, 15], [71.5, 0], [52.5, -32], [52.5, 32], [64.5, -44], [64.5, 44]]) spawns.ffa.push({ x, z });
    return {
      spawns,
      objectives: { dom: [{ id: 'A', x: -5, z: 30.6, radius: 5 }, { id: 'B', x: -14.2, z: -0.8, radius: 6 }, { id: 'C', x: -13.6, z: -30.6, radius: 5 }] },
      zones,
      attach(world, G) { clock.attach(G); },
    };
  },
};

// ---------------------------------------------------------------------------
// Ausstattung aus der Asset-Bibliothek (Fotoscan-Kleinteile; ohne Bibliothek entfällt sie)
// ---------------------------------------------------------------------------
function dressing(b) {
  const Q = Math.PI / 2, wf = 0.12; // Hallenboden
  dress(b, [
    // Kaikante: Kanister, Kunststoffkisten, Zementsäcke, Gasflaschen, Hydranten
    ['industrial_pastic_container', -40.5, 0, 13.3, 0.3], ['industrial_pastic_container', -39.8, 0, 12.6, 1.25],
    ['metal_jerrycan', -36.6, 0, 25.4, 0.4], ['metal_jerrycan', -37.0, 0, 24.85, 1.9], // nicht auf der Staplerpalette ['metal_jerrycan', -34.3, 0, -28.3, 2.6],
    ['cement_bag', -33.1, 0, 30.7, 0.1], ['cement_bag', -32.7, 0, 31.4, 0.2], ['cement_bag', -32.9, 0.18, 31.0, 1.6],
    ['propane_tank', -21.9, 0, -30.3], ['propane_tank', -22.4, 0, -31.0],
    // Containergassen: Kartons, Müllsäcke
    ['cardboard_box_01', -22.6, 0, -6.8, 0.2], ['cardboard_box_01', -22.25, 0, -7.45, 0.9], ['cardboard_box_01', -22.45, 0.34, -7.1, 0.35],
    ['trashbag', -20.3, 0, 33.4], ['trashbag', -19.7, 0, 33.0], ['trashbag', -21.0, 0, 33.6],
    ['metal_trash_can', 1.9, 0, 33.4, 0.3, { part: 'metal_trash_can_rust' }],
    // Lagerhalle 3: Werkzeug, Generator, Kartons, Warnschild
    ['hand_truck', 34.3, wf, 15.4, 2.6],
    ['cardboard_box_01', 16.9, wf, -18.4, 0.1], ['cardboard_box_01', 17.45, wf, -18.65, 1.4], ['cardboard_box_01', 17.1, wf + 0.34, -18.5, 0.3],
    ['industrial_pastic_container', 23.4, wf, -15.6, 0.2],
    ['wetfloorsign_01', 31.2, wf, 2.3, 0.6],
    ['metal_trash_can', 31.3, wf, -10.5, 0, { part: 'metal_trash_can_handle_left' }],
    // Terminalbüro und Pforte
    ['metal_trash_can', 18.3, 0, -40.6, 0.5, { part: 'metal_trash_can_rust' }], ['trashbag', 18.9, 0, -40.1],
    ['metal_trash_can', 29.55, 0, 46.7, 1.2, { part: 'metal_trash_can_handle_left' }],
  ]);
  // Teile mit Kollision: fester Quader in Modellmaßen + Ersatzquader (vorher Kollision nur mit geladener Bibliothek –
  // im Mehrspieler auf jedem Rechner gleich nötig)
  festesModell(b, 'fire_hydrant', -28.6, 0, -16.4, Q, [0.4, 0.8, 0.32], { part: 'fire_hydrant', tint: '#b8392c' });
  festesModell(b, 'fire_hydrant', 48.5, 0, 21.0, -Q, [0.4, 0.8, 0.32], { part: 'fire_hydrant_aged', tint: '#9a3328' });
  festesModell(b, 'metal_tool_chest', 41.35, wf, -1.7, -Q, [0.684, 0.652, 0.407], { tint: '#b8392c' });
  festesModell(b, 'tool_cart', 40.95, wf, 4.55, Q, [1.272, 0.962, 0.747], { tint: '#3a5f8a' });
  festesModell(b, 'portable_generator', 39.5, wf, 13.4, 1.1, [0.817, 0.575, 0.562], { tint: '#c9a227' });
  festesModell(b, 'utility_box_01', 18.65, 0, -46.3, -Q, [0.52, 1.12, 0.432], { tint: '#8f9a90' });
}

// ---------------------------------------------------------------------------
// Schilder
// ---------------------------------------------------------------------------
function signs(b) {
  b.defineSign('title', { style: 'logo', text: 'NORDKAI', sub: 'Containerterminal · Tor 2', bg: '#14304a', fg: '#f2f0ea', accent: '#ff8a2a' });
  b.defineSign('hall3', { style: 'stencil', text: 'HALLE 3', fg: '#f2f0ea' });
  b.defineSign('dock1', { style: 'number', text: 'D1', bg: '#e8c22c', fg: '#16191d' });
  b.defineSign('dock2', { style: 'number', text: 'D2', bg: '#e8c22c', fg: '#16191d' });
  b.defineSign('dock3', { style: 'number', text: 'D3', bg: '#e8c22c', fg: '#16191d' });
  b.defineSign('logo_nordstern', { style: 'logo', text: 'NORDSTERN', sub: 'Linienreederei', bg: 'rgba(0,0,0,0)', fg: '#f2f0ea', accent: '#f2f0ea' });
  b.defineSign('logo_kairos', { style: 'logo', text: 'KAIROS LINES', bg: 'rgba(0,0,0,0)', fg: '#f2f0ea', accent: '#ff8a2a' });
  b.defineSign('logo_kurier', { style: 'logo', text: 'BLITZKURIER', sub: 'Heute bestellt – morgen da', bg: '#e8e6e0', fg: '#1f3d5c', accent: '#c8402f' });
  b.defineSign('crane_grete', { style: 'stencil', text: 'GRETE', sub: 'STS 04 · 65 t', fg: '#f2f0ea' });
  b.defineSign('crane_k5', { style: 'stencil', text: 'K5', fg: '#f2f0ea' });
  b.defineSign('kiosk', { style: 'plate', text: 'KAIAUFSICHT', bg: '#14304a', fg: '#f2f0ea' });
  b.defineSign('gate', { style: 'plate', text: 'TOR 2 · ANMELDUNG', sub: 'Fahrer bitte aussteigen', bg: '#f2f0ea', fg: '#14304a' });
  b.defineSign('office', { style: 'plate', text: 'TERMINALBÜRO', sub: 'Disposition · Zoll', bg: '#14304a', fg: '#f2f0ea' });
  b.defineSign('speed', { style: 'number', text: '10', sub: 'km/h', bg: '#ffffff', fg: '#c8302a' });
  b.defineSign('yard_a', { style: 'plate', text: 'BLOCK A', bg: '#e8c22c', fg: '#16191d', border: false });
  b.defineSign('yard_b', { style: 'plate', text: 'BLOCK B', bg: '#e8c22c', fg: '#16191d', border: false });
  b.defineSign('gate_closed', { style: 'plate', text: 'TOR 2 · GESCHLOSSEN', sub: 'Ausfahrt über Tor 1', bg: '#f2f0ea', fg: '#c8302a' });
  b.defineSign('shed4', { style: 'stencil', text: 'SCHUPPEN 4', fg: '#f2f0ea' });
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------
/** Containerstapel. along: 'z'|'x'. colors: Farbe je Lage. */
function stackAt(b, x, z, len, along, colors, o = {}) {
  const ry = along === 'z' ? Math.PI / 2 : 0;
  const hx = (along === 'z' ? 2.44 : len) / 2 + 0.2, hz = (along === 'z' ? len : 2.44) / 2 + 0.2;
  if (!o.reachable) b.noNav(x - hx, z - hz, x + hx, z + hz, (colors.length - 1) * H + 1, 30);
  // obere Lagen leicht versetzt – nur entlang der Längsachse und kaum verdreht: Doppelstapel stehen Wand an Wand
  // (vorher bis 4 cm quer → Eckpfosten der Nachbarn steckten ineinander). Gleich viele Zufallszahlen wie zuvor.
  colors.forEach((c, i) => {
    const ox = i ? (b.rand() - 0.5) * 0.08 : 0, oz = i ? (b.rand() - 0.5) * 0.08 : 0, r = i ? (b.rand() - 0.5) * 0.003 : 0;
    container(b, x + (along === 'x' ? ox : 0), i * H, z + (along === 'z' ? oz : 0), { len, ry: ry + r, color: c, logo: i === 0 ? o.logo : undefined });
  });
}

/** Stahltreppe an einem Container hoch (parallel zur Längsseite), Podest bis zur Containerkante faceX. */
function containerStairs(b, x, zTop, dir, faceX) {
  const run = H / 0.62;
  const z0 = dir === 's' ? zTop - run : zTop + run;
  stairs(b, { x, z: z0, y0: 0, y1: H, w: 1.05, dir, style: 'steel', rail: 'right', railTint: '#e8c22c' });
  const lz = dir === 's' ? zTop : zTop - 1.3;
  const outer = faceX > x ? x - 0.55 : x + 0.55;
  b.boxMM(Math.min(outer, faceX), H - 0.08, lz, Math.max(outer, faceX), H, lz + 1.3, 'metal_tread', { minimap: 'stairs', grad: false });
  b.box(outer + (faceX > x ? 0.06 : -0.06), 0, lz + 0.65, 0.1, H - 0.08, 0.1, 'metal_painted', { tint: '#3d4247', minimap: false });
  railing(b, outer, dir === 's' ? lz + 1.3 : lz, faceX, dir === 's' ? lz + 1.3 : lz, H, { posts: 2, tint: '#e8c22c' });
}

/** Bohlenbrücke zwischen zwei Containerdächern. */
function plankBridge(b, x0, z0, x1, z1) {
  const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
  b.box((x0 + x1) / 2, H - 0.02, (z0 + z1) / 2, L + 0.6, 0.06, 1.0, 'wood_planks', { ry, tint: '#a68b66', minimap: 'catwalk', grad: false });
  b.navLine(x0, H + 0.2, z0, x1, H + 0.2, z1, 1.2);
}

const CRANE_RED = '#c8402f', CRANE_WHITE = '#e8e4dc', CRANE_DARK = '#3a3d40', ROPE_DARK = '#26282b';
const ROPE_TOP = 22.55;   // Seilaustritt unter der Laufkatze (y)
const LOAD_DROP = 3.56;   // Seilende → Containerunterkante (Kopfblock 0,5 + Spreader 0,45 + Container 2,59 + Luft)
const PARK_X = -60;       // Kulissenkräne: geparkte Katze über dem Schiff

/**
 * Portalkran (STS) bei z. Spielkran (GRETE): Stahlbau statisch in der Karte (Beine mit Kollision); Laufkatze mit Kabine,
 * Spreader und Container fährt ab und zu den Ausleger entlang (eigene Teile ohne Kollision, gemeinsame Uhr).
 * backdrop: ganzer Kran ohne Kollision als eigene Teile-Gruppe, fährt ab und zu auf den Schienen entlang der Kaikante.
 */
function gantryCrane(b, zc, o = {}) {
  if (o.backdrop) return travellingCrane(b, zc, o);
  craneSteel(b, zc, { collide: true });
  b.sign(-23, 27, zc + 3.22, 5.2, 1.6, o.label || 'crane_grete', { ry: 0, back: false, depth: 0 });
  b.sign(-23, 27, zc - 3.22, 5.2, 1.6, o.label || 'crane_grete', { ry: Math.PI, back: false, depth: 0 });
  // Steigleiter mit Rückenschutz am landseitigen Bein (bis über den oberen Riegel, Oberkante 24,1)
  steigleiter(b, -30.0, zc + 8, 0, 25.0, -30.25);
  craneTrolley(b, zc, o.clock);
}

/**
 * Stahlbau eines Portalkrans in Baukasten t (Karte oder partBuilder) bei z = zc. Der wasserseitige obere Riegel
 * liegt ÜBER dem Ausleger (Beine verlängert): unter dem Ausleger bleibt die Durchfahrt für Katze, Kabine und Seile
 * frei; der untere Riegel (y 12..13,4) wird mit hochgezogener Last (Unterkante ≥ 13,9) überfahren.
 */
function craneSteel(t, zc, o = {}) {
  const legX = [-42.2, -30.8], legZ = [-8, 8], col = !!o.collide, P = { collide: false, minimap: false, grad: false };
  for (const x of legX) for (const dz of legZ) {
    const z = zc + dz;
    t.box(x, 0, z, 1.4, 1.5, 5.2, 'metal_painted', { tint: CRANE_DARK, collide: col, minimap: col ? 'cover' : false });
    for (const k of [-1.6, 0, 1.6]) t.cyl(x, 0.45, z + k, 0.45, 0.9, 'metal_painted', { axis: 'x', tint: ROPE_DARK, collide: false, minimap: false });
    t.box(x, 1.5, z, 1.1, 22.5, 1.1, 'metal_painted', { tint: CRANE_RED, collide: col, minimap: col ? 'pillar' : false, grad: false });
  }
  // Portalriegel unten + Längsriegel; oben landseitig unter, wasserseitig über dem Ausleger
  for (const x of legX) t.box(x, 12, zc, 1.0, 1.4, 17, 'metal_painted', { tint: CRANE_RED, ...P });
  t.box(legX[1], 22.5, zc, 1.2, 1.6, 17.2, 'metal_painted', { tint: CRANE_RED, ...P });
  for (const dz of legZ) t.box(legX[0], 24.0, zc + dz, 1.1, 1.9, 1.1, 'metal_painted', { tint: CRANE_RED, ...P });
  t.box(legX[0], 25.9, zc, 1.2, 1.6, 17.2, 'metal_painted', { tint: CRANE_RED, ...P });
  for (const dz of legZ) t.box(-36.5, 22.5, zc + dz, 12.6, 1.6, 1.2, 'metal_painted', { tint: CRANE_RED, ...P });
  // Ausleger (zwei Träger) + Querverbände (Unterkante 24,1: die Katze hängt darunter)
  for (const dz of [-2.4, 2.4]) {
    t.box(-55, 24.1, zc + dz, 74, 1.8, 1.1, 'metal_painted', { tint: CRANE_WHITE, ...P });
    t.box(-55, 25.9, zc + dz, 74, 0.25, 0.4, 'metal_painted', { tint: CRANE_RED, ...P });
  }
  for (let x = -90; x <= -20; x += 6) t.box(x, 24.1, zc, 0.3, 0.3, 4.8, 'metal_painted', { tint: CRANE_WHITE, ...P });
  // A-Bock + Abspannungen
  for (const dz of [-2.4, 2.4]) {
    t.box(-40.5, 25.9, zc + dz, 0.8, 13, 0.8, 'metal_painted', { tint: CRANE_RED, ...P, rz: 0.12 });
    t.box(-32.5, 25.9, zc + dz, 0.8, 12, 0.8, 'metal_painted', { tint: CRANE_RED, ...P, rz: -0.25 });
    cableLine(t, [-38.8, 38.6, zc + dz], [-90, 26.2, zc + dz], o.cableMat);
    cableLine(t, [-38.8, 38.6, zc + dz], [-20, 26.2, zc + dz], o.cableMat);
  }
  t.box(-38, 38.2, zc, 2.4, 1.0, 6, 'metal_painted', { tint: CRANE_RED, ...P });
  // Maschinenhaus
  t.box(-23, 25.9, zc, 7, 3.6, 6.4, 'metal_corrugated', { tint: CRANE_WHITE, ...P });
  t.box(-23, 29.5, zc, 7.4, 0.2, 6.8, 'metal_painted', { tint: CRANE_DARK, ...P });
}

function cableLine(b, a, c, mat = 'metal_galvanized') {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], L = Math.hypot(dx, dy, dz);
  b.cyl((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, 0.08, L, mat, { axis: 'x', ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, Math.hypot(dx, dz)), collide: false, minimap: false, seg: 6, ao: false, tint: mat === 'metal_galvanized' ? undefined : '#8a9096' });
}

/** Laufkatze (hängt unter dem Ausleger, Oberkante 24,0) mit Kabine; Mitte bei (x, zc). */
function trolleyBody(t, x, zc, o = {}) {
  const P = { collide: false, minimap: false, grad: false };
  t.box(x, 22.8, zc, 3.4, 1.2, 6.4, 'metal_painted', { tint: CRANE_RED, ...P });
  for (const dz of [-2.4, 2.4]) for (const dx of [-1.1, 1.1]) t.box(x + dx, 24.0, zc + dz, 0.6, 0.1, 0.5, 'metal_painted', { tint: ROPE_DARK, ...P }); // Laufrollen
  t.box(x, 22.45, zc, 1.9, 0.35, 2.8, 'metal_painted', { tint: CRANE_DARK, ...P }); // Seilrollen
  // Kabine wasserseitig vorn, Fenster zur Last und zum Wasser
  t.box(x + 0.4, 20.1, zc - 3.3, 2.6, 2.4, 2.4, 'metal_painted', { tint: CRANE_DARK, ...P });
  t.box(x + 0.4, 22.5, zc - 3.3, 1.2, 0.3, 0.6, 'metal_painted', { tint: CRANE_DARK, ...P });
  const win = o.glass === false ? ['metal_painted', { tint: '#1c2125', ...P, ao: false }] : ['glass', { ...P, ao: false }];
  t.box(x + 0.4, 20.7, zc - 2.08, 2.3, 1.3, 0.04, win[0], win[1]);
  t.box(x - 0.92, 20.7, zc - 3.3, 0.04, 1.3, 2.1, win[0], win[1]);
}

/** Seile (Einheitslänge 0..−1, werden in y skaliert) für 4 Aufhängepunkte. */
function ropeSet(t, len = 1) {
  for (const dx of [-0.8, 0.8]) for (const dz of [-1.1, 1.1]) t.cyl(dx, -len, dz, 0.035, len, 'metal_painted', { tint: ROPE_DARK, seg: 5, collide: false, minimap: false, ao: false });
}

/** Kopfblock + Spreader unterhalb y0 (Oberkante). */
function spreader(t, y0) {
  const P = { collide: false, minimap: false, grad: false };
  t.box(0, y0 - 0.5, 0, 1.8, 0.5, 2.6, 'metal_painted', { tint: CRANE_DARK, ...P });
  t.box(0, y0 - 0.95, 0, 2.6, 0.45, 6.2, 'metal_painted', { tint: '#d9a72a', ...P });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.box(sx * 1.05, y0 - 1.0, sz * 2.9, 0.4, 0.06, 0.35, 'metal_painted', { tint: ROPE_DARK, ...P, ao: false });
}

/** Kulissenkran: fährt als Ganzes entlang der Kaikante (z), Spreader der geparkten Katze pendelt beim Anfahren/Bremsen. */
function travellingCrane(b, zc, o) {
  const pb = partBuilder(b);
  craneSteel(pb, 0, { cableMat: 'metal_painted' });
  trolleyBody(pb, PARK_X, 0, { glass: false });
  const steel = partGroup(b, pb, { name: 'kran-kulisse-stahl' });
  // Spreader 3 m unter der Katze (Unterkante 18,6 – über der Schiffsladung, Oberkante 17,3)
  const hp = partBuilder(b);
  ropeSet(hp, 3);
  spreader(hp, -3);
  const hang = partGroup(b, hp, { name: 'kran-kulisse-spreader' });
  const root = new THREE.Group();
  root.name = 'kran-kulisse';
  root.matrixAutoUpdate = false;
  root.add(steel, hang);
  const track = createTrack({ seed: o.seed, period: o.period, home: zc, range: o.range, speed: 0.45, ramp: 3, idle: [8, 70], stops: [1, 2], dwell: [15, 45], minMove: 5, skip: 0.2 });
  const st = {}, zMid = (o.range[0] + o.range[1]) / 2, zHalf = (o.range[1] - o.range[0]) / 2;
  let was = null;
  const update = (dt, camera) => {
    const t = o.clock.now();
    track.at(t, st);
    // Fahrwarnung: leises Scheppern beim Anfahren (Atmo-Lautstärke)
    if (was === false && st.moving) o.clock.sound('amb_clank', -36.5, 4, st.x, 0.35, 140);
    was = st.moving;
    // Sichtprüfung über den ganzen Fahrbereich (sonst bliebe eine veraltete Stellung sichtbar stehen)
    if (!inView(camera, -55, 18, zMid, 46 + zHalf)) return;
    place(root, 0, 0, st.x);
    place(hang, PARK_X, ROPE_TOP, 0, -track.sway(t, 3.6, 0.12, 1));
  };
  update(0, null);
  b.object(root, { update });
}

/** Laufkatze des Spielkrans: Fahrplan entlang des Auslegers (x), Senken nur im Stand, Last pendelt beim Anfahren/Bremsen. */
function craneTrolley(b, zc, clock) {
  const pb = partBuilder(b);
  trolleyBody(pb, 0, 0);
  const body = partGroup(b, pb, { name: 'kran-katze' });
  const rp = partBuilder(b);
  ropeSet(rp);
  const ropes = partGroup(b, rp, { name: 'kran-seile' });
  const lp = partBuilder(b);
  spreader(lp, 0);
  container(lp, 0, -LOAD_DROP, 0, { len: 6.06, ry: Math.PI / 2, color: '#2d5f94', minimap: false });
  const load = partGroup(b, lp, { name: 'kran-last' });
  const hang = new THREE.Group();
  hang.matrixAutoUpdate = false;
  hang.add(ropes, load);
  const g = new THREE.Group();
  g.name = 'crane-trolley';
  g.matrixAutoUpdate = false;
  g.add(body, hang);
  // Haltepunkte: Kaikante zwischen den Beinen (Container bis 6,3 m absenken), über dem Wasser (Luke), Auslegerspitze.
  // Gefahren wird immer mit hochgezogener Last (Unterkante 13,9 > Oberkante unterer Riegel 13,4); Ruhe bei x −48.
  const UP = 13.9;
  const track = createTrack({
    seed: 9, period: 160, home: -48, speed: 1.5, ramp: 3.5, idle: [12, 55], stops: [1, 3], dwell: [4, 10], minMove: 6, skip: 0.1,
    spots: [{ x: -38, down: [6.3, 7.2] }, { x: -35.5, down: [6.6, 7.4] }, { x: -56, down: [10, 12] }, { x: -66, down: [9.5, 11.5] }, { x: -74 }],
    hoist: { up: UP, speed: 0.7 },
  });
  const LT = ROPE_TOP - (UP + LOAD_DROP) + 2.3; // Pendellänge bei Fahrt (bis Lastmitte)
  const st = {};
  let was = null;
  const update = (dt, camera) => {
    const t = clock.now();
    track.at(t, st);
    if (was !== null && was !== st.moving) clock.sound(st.moving ? 'amb_clank' : 'amb_creak', st.x, 23, zc, st.moving ? 0.4 : 0.3);
    was = st.moving;
    if (!inView(camera, -55, 16, zc, 34)) return; // ganzer Fahrbereich x −76..−34
    const L = ROPE_TOP - (st.h + LOAD_DROP);
    const wind = 0.004 * Math.sin(0.31 * t + 1.3) + 0.003 * Math.sin(0.77 * t);
    place(g, st.x, 0, zc);
    place(hang, 0, ROPE_TOP, 0, wind, track.sway(t, LT, 0.12, 0.45));
    place(ropes, 0, 0, 0, 0, 0, L);
    place(load, 0, -L, 0);
  };
  update(0, null);
  b.object(g, { update });
}

/** Kleines Kaibüro (begehbar, 4 × 3,2 m). ry: Tür zeigt nach … */
function kiosk(b, x, z, ry) {
  const f = frame(b, x, 0, z, ry);
  const w = 4.2, d = 3.4, h = 2.8, t = 0.18;
  const [cx, cz] = f.P(0, 0);
  b.interior(cx - 2.2, cz - 1.8, cx + 2.2, cz + 1.8, -0.1, 2.75, 0.6);
  f.box(0, 0, 0, w, 0.12, d, 'epoxy', { grad: false, minimap: false });
  // Wände: lokale +z ist Front (Tür + Fenster), -z Rückseite (Fenster)
  const side = (lx0, lz0, lx1, lz1, ops) => { const [ax, az] = f.P(lx0, lz0), [bx, bz] = f.P(lx1, lz1); wall(b, { x0: ax, z0: az, x1: bx, z1: bz, h, t, mat: 'metal_corrugated', tint: '#d9dcd6', openings: ops, frameMat: 'metal_painted', frameTint: '#2a2e33', minimap: 'wall' }); };
  side(-w / 2, d / 2 - t / 2, w / 2, d / 2 - t / 2, [{ at: 1.1, w: 1.0, h: 2.1, kind: 'door' }, { at: 3.0, w: 1.4, h: 1.0, kind: 'window', sill: 1.0, glass: false }]);
  side(w / 2, -d / 2 + t / 2, -w / 2, -d / 2 + t / 2, [{ at: 2.1, w: 2.2, h: 1.0, kind: 'window', sill: 1.0, glass: false }]);
  side(-w / 2 + t / 2, -d / 2 + t, -w / 2 + t / 2, d / 2 - t, []);
  side(w / 2 - t / 2, d / 2 - t, w / 2 - t / 2, -d / 2 + t, [{ at: 1.5, w: 1.2, h: 0.9, kind: 'window', sill: 1.1, glass: false }]);
  f.box(0, h, 0, w + 0.3, 0.16, d + 0.3, 'metal_painted', { tint: '#5a5f66', minimap: 'roof', grad: false });
  // Einrichtung (Innenmaß lokal x ±1,92, z ±1,52; Tür lokal x −1,5..−0,5 an der Front): Schreibtisch unter dem
  // Rückfenster mit Stuhl, Spind in der Ecke, Regal an der fensterlosen Seitenwand, Kühlschrank mit Kaffee unter dem
  // Seitenfenster, Pinnwand, Langfeldleuchte an der Decke (gebacken)
  const at = (lx, y, lz) => { const [wx, wz] = f.P(lx, lz); return [wx, y, wz]; }; // lokal → Welt (x, y, z)
  schreibtisch(b, ...at(0.05, 0.12, -1.04), ry);
  stuhl(b, ...at(0.25, 0.12, -0.3), ry + Math.PI + 0.25);
  f.box(1.42, 0.12, -1.28, 0.55, 1.8, 0.45, 'metal_painted', { tint: '#6f7f8a', minimap: false });
  regal(b, ...at(-1.66, 0.12, 0.12), ry + Math.PI / 2);
  minikuehlschrank(b, ...at(1.62, 0.12, 0.3), ry - Math.PI / 2);
  pinnwand(b, ...at(-1.5, 1.3, -1.5), ry, 0.6, 0.5);
  deckenleuchte(b, ...at(0, h, 0.05), ry, 1.25, { intensity: 6, distance: 6 });
  const [sx, sz] = f.P(0, d / 2 + 0.01);
  b.sign(sx, 2.25, sz, 2.6, 0.45, 'kiosk', { ry, back: false, depth: 0.02 });
  // Klimagerät an der fensterlosen Seitenwand (vorher vor dem Rückfenster)
  const [ax, az] = f.P(-w / 2 - 0.2, -0.2);
  acUnit(b, ax, 1.8, az, { ry: ry - Math.PI / 2 });
  b.noNav(cx - 2.4, cz - 2.0, cx + 2.4, cz + 2.0, 2.5, 4);
}

function lifebuoy(b, x, z) {
  b.cyl(x, 0, z, 0.05, 1.5, 'metal_painted', { tint: '#c8402f', seg: 6, minimap: 'prop' });
  const g = new THREE.TorusGeometry(0.32, 0.07, 8, 16);
  g.rotateY(Math.PI / 2);
  b.geom(g, x + 0.08, 1.15, z, 'white', { tint: '#e8562a', collide: false, minimap: false });
}

/** Reachstacker (Containerstapler) mit knapp über dem Boden gehaltenem Container. */
function reachStacker(b, x, z, ry) {
  const f = frame(b, x, 0, z, ry);
  const yel = '#e0a02a';
  f.box(0, 0.6, 0, 3.2, 1.5, 7.2, 'metal_painted', { tint: yel, collide: false, minimap: false, grad: false });
  f.box(0, 0.6, -3.5, 3.0, 2.0, 1.4, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
  f.box(1.0, 2.1, -0.6, 1.4, 1.9, 1.8, 'metal_painted', { tint: yel, collide: false, minimap: false, grad: false });
  f.box(1.0, 2.5, 0.31, 1.3, 1.1, 0.04, 'glass', { collide: false, minimap: false, ao: false });
  f.box(1.0, 4.0, -0.6, 1.5, 0.08, 1.9, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
  for (const sx of [-1.35, 1.35]) for (const sz of [-2.3, 2.4]) f.cyl(sx, 0.8, sz, 0.8, 0.85, 'rubber', { axis: 'x', collide: false, minimap: false, seg: 14 });
  // Ausleger schräg nach vorn-unten
  f.box(-0.3, 2.3, 1.2, 0.9, 0.9, 7.2, 'metal_painted', { tint: yel, collide: false, minimap: false, rx: 0.18, grad: false });
  const [cx, cz] = f.P(-0.3, 6.6);
  b.box(cx, 2.75, cz, 2.6, 0.4, 6.2, 'metal_painted', { ry, tint: '#d9a72a', collide: false, minimap: false, grad: false });
  container(b, cx, 0.12, cz, { len: 6.06, ry: ry + Math.PI / 2, color: '#c8402f', minimap: 'container' });
  f.solid(0, 0, -0.5, 3.4, 4.1, 7.6, { minimap: 'vehicle' });
}

/** Schranke am Tor */
function barrier(b, x, z) {
  b.box(x - 4.8, 0, z, 0.5, 1.1, 0.5, 'metal_painted', { tint: '#e8e2d4', minimap: 'prop' });
  b.box(x - 1.2, 0.95, z, 7.2, 0.1, 0.1, 'white', { tint: '#e8e2d4', collide: false, minimap: false, grad: false });
  for (let i = 0; i < 6; i++) b.box(x - 4.2 + i * 1.2, 0.944, z, 0.6, 0.112, 0.112, 'white', { tint: '#c8302a', collide: false, minimap: false, grad: false, ao: false });
}

/** Pförtnerhaus am Tor (begehbar). */
function gatehouse(b, x, z) {
  const B = building(b, {
    x, z, w: 6, d: 4.4, floors: 1, fh: 3.0, mat: 'plaster_white', tint: '#e2ddd2', floorMat: 'tiles', frameMat: 'metal_painted', frameTint: '#2a2e33',
    openings: [
      { side: 'w', at: 0.8, w: 1.0, h: 2.1, kind: 'door' },
      { side: 'n', at: 0, w: 3.6, h: 1.3, kind: 'window', sill: 1.0, glass: false },
      { side: 's', at: 0.6, w: 2.4, h: 1.2, kind: 'window', sill: 1.0, glass: true },
      { side: 'e', at: 0, w: 1.6, h: 1.2, kind: 'window', sill: 1.0, glass: false },
    ],
    roof: { edge: true, mat: 'concrete' },
    plinth: { h: 0.35, mat: 'concrete_dark' },
  });
  b.box(x, B.roofY, z, 7.6, 0.18, 6, 'metal_painted', { tint: '#14304a', grad: false, minimap: false, collide: false });
  b.sign(x, B.roofY + 0.25, z + 2.95, 5.2, 0.9, 'title', { ry: 0, depth: 0.04 });
  b.sign(x - 3.02, 1.9, z - 1.0, 2.0, 0.55, 'gate', { ry: -Math.PI / 2, depth: 0.02 });
  // Einrichtung (Innenmaß x ±2,7, z ±1,9; Tür West bei z +0,8): Theke unter dem Südfenster mit zwei Bildschirmen und
  // Stuhl, Spinde in der Nordwestecke, Tisch mit Kaffee in der Nordostecke, Schlüsselkasten, Pinnwand, Deckenleuchte
  const y0 = B.levels[0];
  b.box(x + 0.6, 0.12, z + 1.4, 2.4, 0.8, 0.6, 'wood_planks', { tint: '#8a6a4a', minimap: false, grad: false });
  for (const dx of [0.05, 0.85]) {
    b.box(x + dx, 0.92, z + 1.52, 0.18, 0.015, 0.14, 'polymer', { tint: '#1e2023', collide: false, minimap: false, grad: false, ao: false });
    b.box(x + dx, 1.03, z + 1.55, 0.5, 0.3, 0.03, 'polymer', { tint: '#1e2023', collide: false, minimap: false, grad: false, ry: dx > 0.5 ? -0.25 : 0.2 });
  }
  b.box(x + 0.45, 0.92, z + 1.25, 0.44, 0.02, 0.15, 'polymer', { tint: '#2b2d30', collide: false, minimap: false, grad: false, ao: false });
  b.box(x + 1.5, 0.92, z + 1.3, 0.2, 0.07, 0.22, 'polymer', { tint: '#2b2d30', collide: false, minimap: false, grad: false, ao: false });
  stuhl(b, x + 0.5, y0, z + 0.65, 0.15);
  spinde(b, x - 2.45, y0, z - 1.4, Math.PI / 2, 2);
  tisch(b, x + 2.3, y0, z - 1.45, 0, 0.7, 0.6);
  kaffeeEcke(b, x + 2.3, y0 + 0.755, z - 1.5, Math.PI);
  b.box(x + 2.66, 1.4, z + 1.55, 0.06, 0.45, 0.35, 'metal_painted', { tint: '#5a5f66', collide: false, minimap: false, grad: false }); // Schlüsselkasten
  pinnwand(b, x - 2.68, 1.25, z - 0.2, Math.PI / 2, 0.8, 0.55);
  deckenleuchte(b, x, B.roofY - 0.25, z, 0, 1.25, { intensity: 7, distance: 7, real: true });
  // Klimagerät auf dem Dach (vorher an der Ostwand vor dem Fenster)
  acUnit(b, x - 1.8, B.roofY + 0.18, z - 1.6, { ry: Math.PI, bracket: false });
  b.noNav(x - 4, z - 3.2, x + 4, z + 3.2, 2.5, 5);
}

/** Terminalbüro im Norden (zweigeschossig, Erdgeschoss begehbar). */
function officeNorth(b, x, z) {
  const B = building(b, {
    x, z, w: 16, d: 8, floors: 2, fh: 3.4, mat: 'concrete_panel', tint: '#d8d4cb', floorMat: 'tiles', frameMat: 'metal_painted', frameTint: '#2a2e33',
    band: { mat: 'metal_painted', tint: '#14304a' },
    openings: [
      { side: 's', at: -4.5, w: 1.6, h: 2.3, kind: 'door' },
      { side: 's', at: 1.5, w: 2.6, h: 1.4, kind: 'window', sill: 0.95, glass: false },
      { side: 's', at: 5.5, w: 2.6, h: 1.4, kind: 'window', sill: 0.95, glass: true },
      { side: 'w', at: 1.2, w: 1.4, h: 2.3, kind: 'door' },
      { side: 's', at: -4.5, w: 2.6, h: 1.4, kind: 'window', sill: 0.95, glass: true, floor: 1 },
      { side: 's', at: 0.5, w: 2.6, h: 1.4, kind: 'window', sill: 0.95, glass: true, floor: 1 },
      { side: 's', at: 5.5, w: 2.6, h: 1.4, kind: 'window', sill: 0.95, glass: true, floor: 1 },
      { side: 'w', at: 0, w: 1.6, h: 1.4, kind: 'window', sill: 0.95, glass: true, floor: 1 },
      { side: 'e', at: 0, w: 1.6, h: 1.4, kind: 'window', sill: 0.95, glass: true, floor: 1 },
      { side: 'e', at: 1, w: 1.6, h: 1.4, kind: 'window', sill: 0.95, glass: true },
    ],
    roof: { parapet: 0.6, mat: 'concrete' },
    plinth: { h: 0.4, mat: 'concrete_dark' },
  });
  // Innen: Trennwand (x − 1) zwischen Disposition (West) und Zoll (Ost), Flur im Süden (z + 1,2 … + 3,7)
  wall(b, { x0: x - 1, z0: z - 3.7, x1: x - 1, z1: z + 1.2, y: 0.12, h: 3.15, t: 0.12, mat: 'plaster_white', tint: '#e6e2da' });
  const y0 = B.levels[0], yD = B.levels[0] + B.fh - 0.25 - 0.12; // Fußboden, Deckenunterseite (3,15)
  // Disposition: zwei Arbeitsplätze an der Nordwand, Pinnwand darüber, Regal an der Westwand, Spinde an der Trennwand
  // (vorher standen die Spinde direkt hinter der Westtür)
  for (const dx of [-6.0, -3.1]) { schreibtisch(b, x + dx, y0, z - 3.22, 0); stuhl(b, x + dx + 0.15, y0, z - 2.35, Math.PI + 0.2); }
  pinnwand(b, x - 4.55, 1.35, z - 3.69, 0, 1.0, 0.7);
  regal(b, x - 7.45, y0, z - 1.45, Math.PI / 2);
  spinde(b, x - 1.31, y0, z - 0.4, -Math.PI / 2, 3);
  // Zoll: Schreibtisch, zwei Aktenschränke, Besprechungstisch, Küchenzeile mit Kühlschrank an der Trennwand
  schreibtisch(b, x + 4.2, y0, z - 3.22, 0);
  stuhl(b, x + 4.3, y0, z - 2.35, Math.PI - 0.15);
  for (const dz of [-2.9, -2.38]) aktenschrank(b, x + 7.39, y0, z + dz, -Math.PI / 2);
  besprechung(b, x + 3.0, y0, z - 0.6, 0, 1.6, 0.9, 2);
  kuechenzeile(b, x - 0.64, y0, z - 2.7, Math.PI / 2, 1.8);
  kuehlschrank(b, x - 0.63, y0, z - 1.42, Math.PI / 2);
  // Flur: Wasserspender
  wasserspender(b, x - 1.5, y0, z + 3.5, Math.PI);
  // Deckenleuchten (gebacken; eine echte ab „hoch“)
  for (const [lx, lz, real] of [[-5.2, -1.6, false], [-2.2, -1.6, false], [2.2, -1.6, true], [5.4, -1.6, false], [-4.5, 2.45, false], [3.5, 2.45, false]]) {
    deckenleuchte(b, x + lx, yD, z + lz, 0, 1.25, { intensity: real ? 9 : 7, distance: 8, real, light: lz < 0 || lx < 0 });
  }
  // Schild über dem Eingang (vorher mitten im Geschossband)
  b.sign(x - 4.5, 2.5, z + 4.02, 3.4, 0.6, 'office', { ry: 0, depth: 0.03 });
  for (const ax of [-5, 0, 5]) acUnit(b, x + ax, B.roofY, z - 1, { ry: 0, bracket: false });
  b.noNav(x - 8.5, z - 4.5, x + 8.5, z + 4.5, 3.2, 9);
}

/** Lagerhalle 3: x 14..42, z −20..20, Höhe 8 m, Büros + Empore im Norden. */
function warehouse(b) {
  const x0 = 14, x1 = 42, z0 = -20, z1 = 20, H8 = 8.2, t = 0.3;
  b.interior(x0, z0, x1, z1, -0.1, H8 - 0.05, 0.6);
  b.boxMM(x0 + t, 0, z0 + t, x1 - t, 0.12, z1 - t, 'epoxy', { grad: false, minimap: false });
  const wmat = { mat: 'metal_corrugated', tint: '#b9c3c9', h: H8, t, frameMat: 'metal_painted', frameTint: '#2a2e33', minimap: 'wall', plinth: { h: 1.2, mat: 'concrete', tint: '#c9c4b8', over: 0.04 } };
  // West (Rampenseite) mit drei Toren
  wall(b, { ...wmat, x0: x0 + t / 2, z0: z1, x1: x0 + t / 2, z1: z0, openings: [
    { at: 10, w: 4.2, h: 4.6, kind: 'gap', frameMat: 'hazard' }, { at: 20, w: 4.2, h: 4.6, kind: 'gap' }, { at: 30, w: 4.2, h: 4.6, kind: 'gap' }] });
  // Süd: großes Tor + Tür
  wall(b, { ...wmat, x0: x1, z0: z1 - t / 2, x1: x0, z1: z1 - t / 2, openings: [
    { at: 7.6, w: 5, h: 5, kind: 'gap' }, { at: 20, w: 1.2, h: 2.2, kind: 'door' }] });
  // Nord: Tür (Büro) + Fenster der Empore
  wall(b, { ...wmat, x0: x0, z0: z0 + t / 2, x1: x1, z1: z0 + t / 2, openings: [
    { at: 8, w: 1.2, h: 2.2, kind: 'door' }, { at: 22, w: 1.2, h: 2.2, kind: 'door' },
    { at: 5.1, w: 2.0, h: 1.2, kind: 'window', sill: 4.6, glass: false }, { at: 12, w: 2.4, h: 1.2, kind: 'window', sill: 4.6, glass: false }, { at: 22, w: 3, h: 1.3, kind: 'window', sill: 4.6, glass: true }] });
  // Ost: zwei Türen
  wall(b, { ...wmat, x0: x1 - t / 2, z0: z0, x1: x1 - t / 2, z1: z1, openings: [
    { at: 12, w: 1.3, h: 2.3, kind: 'door' }, { at: 30, w: 3.6, h: 4.2, kind: 'gap' }] });
  // Rolltore (halb offen) über den Toröffnungen
  // beweglich (game/doors.js): Schaltpult innen und außen neben jedem Tor (F), Tor fährt hoch/runter
  for (const zz of [10, 0, -10]) {
    const open = zz === 0 ? 2.35 : 3.3;
    (b.gates || (b.gates = [])).push({ x: x0 + 0.05, z: zz, axis: 'z', w: 4.2, h: 4.6, t: 0.12, y: 0, bottom: open, tint: '#d0d4d0',
      panels: [[x0 + 0.65, zz + 2.7, Math.PI / 2], [x0 - 0.65, zz - 2.7, -Math.PI / 2]] });
    b.box(x0 - 0.15, 4.6, zz, 0.6, 0.6, 4.6, 'metal_painted', { tint: '#5a5f66', minimap: false, grad: false, collide: false });
  }
  // Dach (leicht geneigt angedeutet) + Oberlichter
  b.boxMM(x0 - 0.3, H8, z0 - 0.3, x1 + 0.3, H8 + 0.35, z1 + 0.3, 'metal_corrugated', { tint: '#8d969c', minimap: 'roof', grad: false, uv: 'world' });
  for (const zz of [-12, 0, 12]) b.box(28, H8 - 0.02, zz, 20, 0.04, 1.4, 'lamp_cool', { collide: false, minimap: false, ao: false, cast: false });
  // Lichtbänder: nur in die Sonden gebacken (indirektes Hallenlicht, kein Echtzeitlicht)
  for (const zz of [-12, 0, 12]) for (const xx of [20.5, 28, 35.5]) b.light('point', xx, H8 - 0.5, zz, { color: '#e6f0ff', intensity: 26, distance: 22, realtime: false });
  b.box(28, H8 + 0.35, -20.31, 28.6, 0.6, 0.1, 'metal_painted', { tint: '#14304a', collide: false, minimap: false, grad: false });
  b.noNav(x0 - 1, z0 - 1, x1 + 1, z1 + 1, H8 - 0.5, 20);
  // Binder (Stahlträger unter dem Dach)
  for (let xx = x0 + 3.5; xx < x1; xx += 7) {
    b.box(xx, H8 - 0.8, 0, 0.35, 0.8, 39.4, 'metal_painted', { tint: '#4b5560', collide: false, minimap: false, grad: false });
    for (const zz of [z0 + 0.4, z1 - 0.4]) b.box(xx, 0.12, zz, 0.4, H8 - 0.92, 0.4, 'metal_painted', { tint: '#4b5560', minimap: 'pillar', aoFloor: 0.12 });
  }
  // Hallenlampen + Lichter
  for (const [lx, lz] of [[21, -2], [35, 6], [28, 14]]) {
    b.cyl(lx, H8 - 2.2, lz, 0.02, 2.2, 'metal_galvanized', { collide: false, seg: 4, ao: false });
    b.cyl(lx, H8 - 0.05, lz, 0.1, 0.05, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, seg: 8, ao: false });
    b.cyl(lx, H8 - 2.6, lz, 0.55, 0.4, 'metal_painted', { r1: 0.15, tint: '#2b2d30', collide: false, seg: 12, ao: false });
    b.cyl(lx, H8 - 2.62, lz, 0.5, 0.02, 'lamp_warm', { collide: false, seg: 12, ao: false, cast: false });
    b.light('point', lx, H8 - 3.0, lz, { color: '#ffd29a', intensity: 30, distance: 18 });
  }
  // Büroblock im Nordosten (2 Ebenen) + Empore entlang der Nordwand
  const ox0 = 30, ox1 = x1 - t, oz0 = z0 + t, oz1 = -11, fy = 3.6;
  wall(b, { x0: ox0, z0: oz1, x1: ox1, z1: oz1, h: fy, t: 0.2, mat: 'plaster_white', tint: '#dcd8cf', frameMat: 'metal_painted', frameTint: '#2a2e33', openings: [{ at: 3, w: 1.1, h: 2.2, kind: 'door' }, { at: 7.5, w: 3, h: 1.2, kind: 'window', sill: 1.0, glass: false }] });
  wall(b, { x0: ox0, z0: oz0, x1: ox0, z1: oz1, h: fy, t: 0.2, mat: 'plaster_white', tint: '#dcd8cf', openings: [{ at: 3.5, w: 2.2, h: 1.1, kind: 'window', sill: 1.0, glass: false }] });
  // Obergeschoss-Wände (Glasfront zur Halle)
  wall(b, { x0: ox0, z0: oz1, x1: ox1, z1: oz1, y: fy, h: 3.0, t: 0.2, mat: 'plaster_white', tint: '#dcd8cf', frameMat: 'metal_painted', frameTint: '#2a2e33', openings: [{ at: 2.2, w: 1.0, h: 2.1, kind: 'door' }, { at: 6.8, w: 4.4, h: 1.4, kind: 'window', sill: 0.9, glass: false }] });
  slab(b, x0 + t, oz0, ox1, oz1, fy - 0.2, 0.2, 'concrete', [], {});
  // Deckenleuchten im Erdgeschoss-Büro (gebacken)
  for (const xx of [33.5, 38.5]) {
    b.box(xx, fy - 0.235, -15.4, 1.2, 0.03, 0.6, 'lamp_cool', { collide: false, minimap: false, ao: false, cast: false });
    b.light('point', xx, fy - 0.5, -15.4, { color: '#eef3ff', intensity: 12, distance: 9, realtime: false });
  }
  b.boxMM(x0 + t, fy, oz0, ox1, fy + 0.02, oz1, 'metal_tread', { grad: false, minimap: 'catwalk', collide: false });
  b.footprints.push({ x: (ox0 + ox1) / 2, z: (oz0 + oz1) / 2, hw: (ox1 - ox0) / 2, hd: (oz1 - oz0) / 2, ry: 0, y0: 0, y1: 6.6, kind: 'building' });
  // Empore (Westteil, offen zur Halle) mit Geländer
  railing(b, x0 + t, oz1, 28.2, oz1, fy, { tint: '#e8c22c' });
  for (const xx of [18, 24]) b.box(xx, 0.12, oz1 - 0.2, 0.25, fy - 0.32, 0.25, 'metal_painted', { tint: '#4b5560', minimap: 'pillar', aoFloor: 0.12 });
  // Treppe zur Empore (an der Bürowand, steigt nach Norden)
  stairs(b, { x: ox0 - 0.95, z: oz1 + (fy - 0.12) / 0.62, y0: 0.12, y1: fy, w: 1.3, dir: 'n', style: 'steel', rail: 'left', railTint: '#e8c22c' });
  // Büroeinrichtung Erdgeschoss (Innenmaß x 30,1…41,7, z −19,7…−11,1; Türen Süd x 33 und Nord x 36 frei):
  // Schreibtisch unter dem Hallenfenster (Westwand), zweiter an der Südwand unter dem Fenster, Regale an der Nordwand
  // neben der Tür, Spinde und Aktenschrank an der Ostwand (vorher stand ein Tisch direkt hinter der Nordtür)
  schreibtisch(b, 30.6, 0.12, -16.2, Math.PI / 2); stuhl(b, 31.45, 0.12, -16.0, -Math.PI / 2 + 0.2);
  schreibtisch(b, 37.5, 0.12, -11.6, Math.PI); stuhl(b, 37.4, 0.12, -12.45, 0.15);
  regal(b, 32.4, 0.12, -19.43, 0); regal(b, 39.6, 0.12, -19.43, 0);
  spinde(b, 41.44, 0.12, -16.0, -Math.PI / 2, 4);
  aktenschrank(b, 41.38, 0.12, -18.85, -Math.PI / 2);
  pinnwand(b, 34.0, 1.3, -19.68, 0, 1.0, 0.7);
  // Obergeschoss (offen zur Empore): Schreibtisch mit Stuhl, Schrank, Regal
  schreibtisch(b, 35, fy, -17.6, 0); stuhl(b, 35.2, fy, -16.75, Math.PI + 0.3);
  b.box(39.6, fy, -14, 1.0, 1.6, 2.2, 'metal_painted', { tint: '#6f7f8a', minimap: 'cover', aoFloor: fy });
  regal(b, 33.0, fy, -19.43, 0);
  crateStack(b, 20, -16.6, { y: fy, ry: 0.2, pattern: [[0, 0, 0, 1.0], [1.05, 0, 0, 0.9]] });
  // Regale in der Halle
  // (Hallenboden = Epoxidplatte 0,12 m: alles steht auf yf statt 12 cm im Boden)
  const yf = 0.12;
  rack(b, 21, 6, { y: yf, bays: 3, levels: 2, levelH: 1.7, ry: Math.PI / 2 });
  rack(b, 27, 6, { y: yf, bays: 3, levels: 2, levelH: 1.7, ry: Math.PI / 2 });
  rack(b, 35.5, 9, { y: yf, bays: 3, levels: 2, levelH: 1.7, ry: Math.PI / 2 });
  rack(b, 21, -5.5, { y: yf, bays: 1, levels: 2, levelH: 1.7, ry: Math.PI / 2 });
  // Hallenboden-Deckung
  palletStack(b, 31.5, -4, { y: yf, n: 3, load: 'wrapped', ry: 0.2 });
  crateStack(b, 26, -7.5, { y: yf, ry: 0.6 });
  pallet(b, 33.5, yf, 16.5, { load: 'boxes', ry: 0.3 });
  pallet(b, 17.5, yf, 17.6, { load: 'sacks', ry: -0.1 });
  forklift(b, 37.5, -6, { y: yf, ry: -2.1, color: '#e0a02a' });
  workbench(b, 40.4, 2, { y: yf, ry: -Math.PI / 2 });
  gasBottles(b, 40.6, 16.8, { y: yf, n: 4 });
  // Bodenmarkierungen innen
  for (const xx of [18.2, 24.2, 30.2]) b.decal(xx, 0.13, 0, 0.12, 30, 'line', { ry: 0, tint: '#e8c22c', kind: 'paint', opacity: 0.85 });
  b.decal(28, 0.13, 17.2, 26, 0.12, 'line', { ry: 0, tint: '#e8c22c', kind: 'paint', opacity: 0.85 });
  // Außen: Beschriftung, Rampe, Technik
  b.sign(x0 - 0.02, 6.0, 0, 7.5, 2.0, 'hall3', { ry: -Math.PI / 2, back: false, depth: 0 });
  for (const [k, zz] of [[1, -10], [2, 0], [3, 10]]) b.sign(x0 - 0.05, 5.26, zz, 0.68, 0.68, 'dock' + k, { ry: -Math.PI / 2, depth: 0.03 });
  b.sign(x1 + 0.02, 5.6, 0, 7.5, 2.0, 'hall3', { ry: Math.PI / 2, back: false, depth: 0 });
  b.sign(28, 5.4, z1 + 0.02, 8, 2.0, 'logo_nordstern', { ry: 0, back: false, depth: 0 });
  for (const zz of [-6, 6]) b.sign(x0 - 0.02, 2.2, zz, 1.6, 0.9, 'warn_forklift', { ry: -Math.PI / 2, depth: 0.02 });
  pipe(b, [[x1 + 0.3, -0.2, -18], [x1 + 0.3, 6.5, -18], [x1 + 0.3, 6.5, -4.8], [x1 - 0.1, 6.5, -4.8]], { r: 0.14, tint: '#8a9aa2' });
  b.box(x1 + 0.3, 0, -18, 0.5, 0.06, 0.5, 'concrete', { tint: '#b9b4a8', collide: false, minimap: false, grad: false }); // Fundamentplatte
  for (const zz of [-15, -11, -7.5]) b.box(x1 + 0.15, 6.32, zz, 0.3, 0.06, 0.08, 'metal_painted', { tint: '#3a3d40', collide: false, minimap: false, grad: false, ao: false });
  for (const yy of [2.2, 4.4]) b.box(x1 + 0.15, yy, -18, 0.3, 0.06, 0.08, 'metal_painted', { tint: '#3a3d40', collide: false, minimap: false, grad: false, ao: false });
  for (const zz of [-14, -6, 6, 14]) acUnit(b, x1 + 0.25, 2.6, zz, { ry: Math.PI / 2, pipe: 2.2 });
  for (const xx of [20, 36]) roofVent(b, xx, H8 + 0.35, 8, {});
  // Einspeisung der Flutlichtmasten am Kranplatz (vorher endeten die Kabel bei x −2 in der Luft): Schelle am Mast
  cable(b, [x0 - 0.2, 7.4, -19.5], [-9.17, 9.45, -30.2], { sag: 1.2 });
  cable(b, [x0 - 0.2, 7.2, 19.5], [-9.17, 9.45, 30.2], { sag: 1.4 });
  for (const zz of [-19.5, 19.5]) b.box(x0 - 0.1, 7.1, zz, 0.2, 0.4, 0.2, 'metal_painted', { tint: '#5a5f66', collide: false, minimap: false, grad: false }); // Wanddurchführung
  electricBox(b, x0 - 0.35, 0, -14, { ry: -Math.PI / 2, w: 1.0, h: 1.6, d: 0.5 });
}

// ---------------------------------------------------------------------------
// maps-expand: Osthof (x 50..74) – Leercontainerdepot, Schuppen 4, Kranfundamente, viel Deckung.
// Nord/Süd nahezu spiegelgleich; drei Längsgassen (x ≈ 52, 63, 72) mit Querwegen alle 8–12 m.
// ---------------------------------------------------------------------------
function eastYard(b) {
  // Grenzzaun (ersetzt den alten Zaun bei x 50,4) + Laternen an der Ostkante
  fence(b, 74.4, -52.6, 74.4, 52.4, { h: 2.6, style: 'chain', barbed: true });
  for (const z of [-44, -20, 20, 44]) lampPost(b, 73.7, z, { h: 7, arm: 1.5, ry: Math.PI, kind: 'sodium', glow: true });
  // Fahrspur-Markierungen
  for (let z = -46; z <= 46; z += 4) b.decal(57.6, 0.01, z, 0.15, 2.2, 'line', { ry: 0, tint: '#e8c22c', kind: 'paint', opacity: 0.7 });
  for (const z of [-41, -21, 21, 41]) b.decal(69.4, 0.011, z, 5.6, 0.12, 'line', { ry: 0, tint: '#e8c22c', kind: 'paint', opacity: 0.55 });
  schuppen4(b);
  for (const s of [1, -1]) {
    const Z = z => z * s, south = s > 0;
    // Containerreihen (Ostkante x ≈ 69,5: hoch – bricht die Sicht entlang des Zauns; Westreihe x ≈ 60: 1–2 hoch)
    stackAt(b, 69.5, Z(14.5), 6.06, 'z', south ? ['#2d5f94', '#c8402f'] : ['#3e7a4c', '#8d9399']);
    stackAt(b, 69.5, Z(30), 12.19, 'z', south ? ['#d9762a'] : ['#c9a227']);
    stackAt(b, 60.2, Z(22), 6.06, 'z', south ? ['#8d9399', '#3e7a4c'] : ['#c8402f', '#2d5f94']);
    offenerContainer(b, 62.6, Z(39.5), { len: 6.06, ry: Math.PI, color: south ? '#9a3328' : '#1f6f6a' });
    container(b, 68.8, 0, Z(44.0), { len: 6.06, ry: Math.PI / 2 + 0.12 * s, color: south ? '#e3e1da' : '#6b3f7a' });
    // Kranfundament (Brusthöhe) mit Turmstumpf (über Kopfhöhe) – bricht die Längssicht in der Hofmitte
    craneBase(b, 64.5, Z(29.5), s);
    // Deckung: Leitwände, Kisten, Paletten, Reifen, Kabeltrommeln, Sandsäcke, Müllcontainer
    jersey(b, 53.0, Z(11.5), { len: 3, ry: 0.1 * s, stripes: true });
    jersey(b, 66.0, Z(10.5), { len: 3, ry: -0.12 * s });
    crateStack(b, 55.0, Z(18.5), { ry: 0.35 * s });
    crateStack(b, 52.6, Z(27.5), { ry: 0.15 * s, pattern: [[0, 0, 0, 1.2], [1.25, 0, 0.05, 1.1], [0.55, 1, 0.02, 1.0]] });
    sandbags(b, 57.0, Z(33.6), 59.6, Z(34.4), { rows: 5 });
    b.box(66.6, 0, Z(20.4), 2.2, 1.05, 1.0, 'concrete', { tint: '#b9b4a8', minimap: 'cover', ry: 0.1 * s }); // Ballastblock
    cableReel(b, 72.2, Z(22.6), { ry: 0.4 * s });
    dumpster(b, 72.3, Z(38.2), { ry: Math.PI / 2, color: south ? '#2f5e3e' : '#2d4a6e' });
    crateStack(b, 54.4, Z(41.0), { ry: -0.25 * s, pattern: [[0, 0, 0, 1.2], [1.25, 0, 0.1, 1.1], [0.6, 1, 0.05, 1.0]] });
    barrelGroup(b, 65.9, Z(46.9), { n: 3, colors: ['#c8402f', '#c9a227', '#c8402f'] });
    jersey(b, 58.5, Z(47.5), { len: 3, ry: 0.2 * s, stripes: true });
    gasBottles(b, 72.6, Z(8.6), { n: 4 });
    car(b, 52.4, Z(36.0), { ry: 0.06 * s, color: south ? '#6b7a52' : '#3b3d40' });
    floodMast(b, 61.0, Z(46.0), { h: 12, ry: south ? Math.PI : 0, kind: 'sodium', glow: true });
    // Schmutz/Ölflecken im Osthof
    for (let i = 0; i < 6; i++) b.decal(b.rnd(51, 73), 0.012, Z(b.rnd(4, 50)), b.rnd(1.4, 3.2), b.rnd(1.4, 3.2), b.pick(['oil', 'puddle', 'stain', 'tire']), { opacity: 0.6 });
  }
  b.decal(63, 0.012, 21.5, 1.1, 1.1, 'manhole', { opacity: 1 });
}

/** Schuppen 4 (12 × 14 m, begehbar): Tor nach Westen, Türen Nord/Süd/Ost; innen Regale und Paletten. */
function schuppen4(b) {
  const x = 63, z = 0, w = 12, d = 14, H5 = 5.2;
  building(b, {
    x, z, w, d, floors: 1, fh: H5, mat: 'metal_corrugated', tint: '#a8b0a4', floorMat: 'epoxy', frameMat: 'metal_painted', frameTint: '#2a2e33',
    plinth: { h: 1.0, mat: 'concrete', tint: '#c9c4b8', over: 0.04 },
    roof: { mat: 'metal_corrugated', tint: '#7d878c', edge: true },
    openings: [
      { side: 'w', at: 0, w: 4.2, h: 4.2, kind: 'gap' },
      { side: 'e', at: -1.0, w: 1.4, h: 2.3, kind: 'door' },
      { side: 'e', at: -4.6, w: 1.6, h: 1.0, sill: 1.5, kind: 'window' },
      { side: 'n', at: -2.5, w: 1.6, h: 2.3, kind: 'door' },
      { side: 's', at: 2.5, w: 1.6, h: 2.3, kind: 'door' },
      { side: 'n', at: 3.0, w: 2.0, h: 1.0, sill: 1.6, kind: 'window' },
      { side: 's', at: -3.0, w: 2.0, h: 1.0, sill: 1.6, kind: 'window' },
    ],
  });
  // Name über dem Tor (vorher „D3“ wie Tor 3 der Halle, halb über der Dachkante)
  b.sign(x - w / 2 - 0.02, 4.38, 0, 3.4, 0.62, 'shed4', { ry: -Math.PI / 2, back: false, depth: 0 });
  // Innen: Regalreihe (Deckung + Sichtschutz), Paletten, Gabelstapler
  rack(b, 61.0, -3.8, { y: 0.12, ry: 0, bays: 2, levels: 2 });
  crateStack(b, 65.4, 3.9, { y: 0.12, ry: 0.1, pattern: [[0, 0, 0, 1.2], [1.25, 0, 0, 1.2], [-1.25, 0, 0.05, 1.1], [0.6, 1, 0, 1.1]] });
  crateStack(b, 59.0, 4.4, { y: 0.12, ry: 0.1 });
  crateStack(b, 67.4, -4.2, { y: 0.12, ry: -0.2, pattern: [[0, 0, 0, 1.1], [0, 0, 1.15, 1.0]] });
  forklift(b, 60.4, 0.4, { y: 0.12, ry: Math.PI / 2 + 0.2, color: '#e0a02a' });
  // Langfeldleuchten bündig unter der Dachplatte (Unterseite 4,95; vorher 11 cm darunter schwebend)
  for (const lz of [-3.5, 3.5]) deckenleuchte(b, 63, H5 - 0.25, lz, 0, 3.2, { light: false, glowI: 0.35 });
  for (const lz of [-3.5, 3.5]) b.light('point', 63, H5 - 0.9, lz, { color: '#e6f0ff', intensity: 16, distance: 13 });
  // Werkbank und Werkzeugregal an der Ostwand (Tür Ost bei z −1 bleibt frei)
  workbench(b, 68.25, 3.6, { y: 0.12, ry: -Math.PI / 2 });
  regal(b, 68.44, 0.12, -3.1, -Math.PI / 2);
  b.noNav(x - w / 2 - 0.5, z - d / 2 - 0.5, x + w / 2 + 0.5, z + d / 2 + 0.5, H5 - 0.4, 20);
  // Außen: Rampe/Leitwand vor dem Tor, Technik an der Ostwand
  jersey(b, 54.6, -1.5, { len: 3, ry: Math.PI / 2 + 0.08 });
  electricBox(b, 69.35, 0, 1.2, { ry: Math.PI / 2, w: 1.0, h: 1.6, d: 0.5 });
  acUnit(b, 69.3, 2.4, 4.2, { ry: Math.PI / 2, pipe: 2.0 });
}

/** Kranfundament: Betonsockel (1,25 m, Brusthöhe) + Stahlturmstumpf mit Leiter; s = Seite (±1). */
function craneBase(b, x, z, s) {
  b.box(x, 0, z, 4.4, 1.25, 4.4, 'concrete', { tint: '#b9b4a8', minimap: 'cover' });
  b.box(x, 1.25, z, 4.5, 0.08, 4.5, 'hazard', { collide: false, minimap: false, grad: false });
  // Turmstumpf (2,2 × 2,2 m, bis 6,5 m) – gelb lackiert, mit Drehkranz
  b.box(x, 1.25, z, 2.2, 5.25, 2.2, 'metal_painted', { tint: '#d9a72a', minimap: 'pillar' });
  b.cyl(x, 6.5, z, 1.5, 0.35, 'metal_painted', { tint: '#4b5560', seg: 14, collide: false, minimap: false });
  for (let k = 0; k < 6; k++) b.box(x + 1.13, 1.6 + k * 0.8, z, 0.05, 0.05, 0.5, 'metal_galvanized', { collide: false, minimap: false, grad: false, ao: false });
  // Ankerbolzen + abgelegte Auslegerspitze (Gitterträger, kniehoch) als Deckung daneben
  for (const [dx, dz] of [[-2.0, -2.0], [2.0, -2.0], [-2.0, 2.0], [2.0, 2.0]]) b.cyl(x + dx, 1.25, z + dz, 0.08, 0.18, 'metal_galvanized', { seg: 6, collide: false, minimap: false });
  const bx = x - 1.0, bz = z + 6.0 * s;
  b.box(bx, 0, bz, 6.5, 0.9, 0.9, 'metal_painted', { tint: '#c99a2a', minimap: 'cover', ry: 0.04 * s });
  for (let k = -3; k <= 3; k++) b.box(bx + k * 0.95, 0.9, bz, 0.06, 0.06, 0.95, 'metal_painted', { tint: '#8a6a1a', collide: false, minimap: false, grad: false, ry: 0.04 * s });
}

/** Kulisse: Containerfelder, Hallen, Kräne, Hügel (ohne Kollision). */
function backdrop(b) {
  const colors = ['#8d9399', '#2d5f94', '#c8402f', '#3e7a4c', '#d9762a', '#e3e1da', '#9a3328', '#1f6f6a'];
  // Nordfelder (ab x −29: die Kaikante x −44..−29 ist Fahrgasse der Kulissenkräne)
  for (let r = 0; r < 4; r++) for (let c = 1; c < 6; c++) {
    const x = -36.5 + c * 13.4 + (r % 2) * 3, z = -64 - r * 9;
    const n = 2 + ((r * 7 + c * 3) % 3);
    // maps-expand: auf „niedrig“ (Handy) nur Quader je Lage statt Detail-Container (Kulisse, ≈ 250 → 12 Dreiecke)
    for (let k = 0; k < n; k++) {
      const color = colors[(r * 5 + c * 3 + k) % colors.length];
      // Kollision wie container() auf den höheren Stufen (Mehrspieler: Kollision unabhängig von der Grafikstufe)
      if (b.lookQuality === 'low') { b.box(x, k * H, z, 12.19, H - 0.02, 2.44, 'container', { tint: color, uv: 'local', collide: false, minimap: false, grad: false }); b.solid(x, k * H, z, 12.19, H, 2.44, { minimap: false }); }
      else container(b, x, k * H, z, { len: 12.19, ry: 0, color, minimap: false });
    }
    b.box(x, 0, z, 12.2, n * H, 2.44, 'black', { visual: false, collide: false, minimap: false });
  }
  // Osthallen
  for (const [x, z, w, d, h] of [[100, -30, 30, 40, 12], [100, 25, 30, 34, 10], [60, 80, 40, 24, 9], [10, 95, 50, 26, 11], [-25, 92, 26, 22, 8]]) {
    b.box(x, 0, z, w, h, d, 'metal_corrugated', { tint: b.pick(['#a9b3b8', '#c4c0b4', '#8f9ba3']), collide: false, minimap: false, grad: false, uv: 'world' });
    b.box(x, h, z, w + 0.6, 0.4, d + 0.6, 'metal_painted', { tint: '#4b5560', collide: false, minimap: false, grad: false });
  }
  // Südliche Straße mit Laternen
  for (let x = -40; x <= 76; x += 16) lampPost(b, x, 58, { h: 8, arm: 1.6, ry: Math.PI / 2, kind: 'sodium' });
  // Silos
  for (const [x, z] of [[105, -80], [114, -80], [105, -71]]) b.cyl(x, 0, z, 4, 24, 'concrete', { seg: 18, collide: false, minimap: false, tint: '#cfc8bb' });
}

/** Frachtschiff am Nordkai (Kulisse). */
function ship(b) {
  const x0 = -63, x1 = -49, z0 = -190, z1 = -64, y0 = -4;
  const hull = '#2d4f6e', red = '#8f2a22';
  b.defineSign('shipname', { style: 'stencil', text: 'NORDLICHT', sub: 'HAMBORG', fg: '#f2f0ea' });
  b.boxMM(x0, y0, z0, x1, 6.5, z1, 'metal_painted', { tint: hull, collide: false, minimap: false, grad: false, uv: 'world' });
  b.boxMM(x0 - 0.05, y0, z0, x1 + 0.05, -1.0, z1, 'metal_painted', { tint: red, collide: false, minimap: false, grad: false });
  b.boxMM(x1 + 0.02, 5.6, z0, x1 + 0.08, 6.0, z1, 'white', { tint: '#e8e4dc', collide: false, minimap: false, grad: false, ao: false });
  for (let z = z0 + 6; z < z1 - 4; z += 7) b.box(x1 + 0.06, 1.2, z, 0.04, 2.4, 0.08, 'metal_painted', { tint: '#1f364c', collide: false, minimap: false, ao: false });
  // Bug (Keil + Spitze)
  b.wedge((x0 + x1) / 2, y0, z1 + 5, 14, 10.5, 10, 'metal_painted', { ry: Math.PI, tint: hull, collide: false, minimap: false });
  b.sign(x1 + 0.08, 3.4, z1 - 10, 9, 1.8, 'shipname', { ry: Math.PI / 2, back: false, depth: 0 });
  b.boxMM(x0 + 0.5, 6.5, z0, x1 - 0.5, 6.9, z1, 'metal_painted', { tint: '#7a7f86', collide: false, minimap: false, grad: false });
  // Ladung
  for (let r = 0; r < 9; r++) for (let c = 0; c < 4; c++) {
    const n = 2 + ((r + c * 2) % 3);
    for (let k = 0; k < n; k++) container(b, x0 + 2.2 + c * 2.5, 6.9 + k * H, z0 + 18 + r * 12.4, { len: 12.19, ry: Math.PI / 2, color: ['#c8402f', '#2d5f94', '#3e7a4c', '#d9762a', '#e3e1da', '#8d9399'][(r + c + k) % 6], minimap: false });
  }
  // Brückenhaus mit Fensterbändern
  b.boxMM(x0 + 1, 6.9, z0 + 2, x1 - 1, 20, z0 + 14, 'plaster_white', { tint: '#e8e4dc', collide: false, minimap: false, grad: false });
  for (let k = 0; k < 4; k++) b.boxMM(x0 + 0.95, 9 + k * 2.6, z0 + 1.95, x1 - 0.95, 10.2 + k * 2.6, z0 + 14.05, 'glass', { collide: false, minimap: false, grad: false });
  b.boxMM(x0 - 1.5, 18.6, z0 + 11, x1 + 1.5, 19.2, z0 + 14.5, 'plaster_white', { tint: '#e8e4dc', collide: false, minimap: false, grad: false });
  b.boxMM(x0 + 4, 20, z0 + 6, x1 - 4, 25, z0 + 9, 'metal_painted', { tint: '#c8402f', collide: false, minimap: false, grad: false });
  b.boxMM(x0 + 4, 24.2, z0 + 5.9, x1 - 4, 25.05, z0 + 9.1, 'metal_painted', { tint: '#1d1f22', collide: false, minimap: false, grad: false });
  // Ferne Silhouetten
  b.boxMM(-330, -1.7, -260, -300, 5, -140, 'metal_painted', { tint: '#5b6773', collide: false, minimap: false, grad: false, ao: false });
  for (const [x, z, w, h] of [[-420, 60, 180, 14], [-460, -120, 200, 22], [-380, 220, 160, 10]]) b.box(x, -2, z, 40, h, w, 'grass', { tint: '#6a7356', collide: false, minimap: false, grad: false, ao: false, cast: false });
}
