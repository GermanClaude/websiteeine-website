// NULLPUNKT — Karte „Schießstand“: Trainingsanlage mit 8 Bahnen, Klappzielen 10–100 m,
// Schießstand-Überdachung, Waffenkammer und Einschieß-Parcours. Klarer Morgen. (Owner: world)
import * as THREE from 'three';
import { getMaterial } from '../../engine/textures.js';
import { building, wall, stairs, railing } from '../arch.js';
import { crate, crateStack, barrel, sandbags, jersey, lockers, workbench, bench, floodMast, electricBox, pallet, cone, tree, rack } from '../props.js';

const LANES = 8, LANE_W = 5.5, FIRE_Z = 34;
const laneX = i => -((LANES - 1) / 2) * LANE_W + i * LANE_W;
const DIST = [10, 25, 50, 75, 100];
const OFFSET = { 10: -1.3, 25: 1.3, 50: -0.6, 75: 0.6, 100: 0 };

export default {
  id: 'range',
  seed: 4711,
  bounds: { minX: -30, maxX: 30, minZ: -77, maxZ: 62, minY: -2, maxY: 14 },
  visualBounds: { minX: -70, maxX: 70, minZ: -110, maxZ: 100 },
  chunkSize: 34,
  ambience: 'range',
  defaultSurface: 'dirt',
  navSpacing: 1.6,
  lighting: {
    sun: { elevation: 31, azimuth: 118, color: '#fff2dc', intensity: 3.7 },
    sky: { turbidity: 3.2, rayleigh: 1.25, mieCoefficient: 0.004, mieDirectionalG: 0.8, exposure: 0.62, clouds: { coverage: 0.22, density: 0.35, scale: 0.00022 }, hazeHigh: 0.14 },
    hemi: { sky: '#d3dbe2', ground: '#ab9775', intensity: 0.55 },
    env: { intensity: 0.6, ground: '#9a8d74', groundIntensity: 0.6, tint: '#f2ebe0' },
    fog: { color: '#cfdae3', near: 110, far: 620 },
    shadow: { size: 40 },
  },

  build(b) {
    const zones = [];
    // --- Boden -------------------------------------------------------------
    b.groundTiled(-30, 30, 30, 62, 'concrete', { cell: 1 });                // Vorplatz + Stand
    b.groundTiled(-30, -77, 30, 30, 'sand', { cell: 1.2 });                 // Bahnen (verdichteter Sand)
    for (let k = 0; k < LANES; k++) b.ground(laneX(k) - 1.2, 22, laneX(k) + 1.2, 30, 'gravel', { cell: 1.2, y: 0.005, collide: false });
    zones.push({ x0: -30, z0: 30, x1: 30, z1: 62, kind: 'plaza' }, { x0: -22, z0: -77, x1: 22, z1: 30, kind: 'lane' });
    // Hintergrund-Boden außerhalb
    b.groundTiled(-70, -110, -30, 100, 'grass', { cell: 4, collide: false, groundAO: false });
    b.groundTiled(30, -110, 70, 100, 'grass', { cell: 4, collide: false, groundAO: false });
    b.groundTiled(-30, 62, 30, 100, 'asphalt', { cell: 3, collide: false, groundAO: false });
    b.groundTiled(-30, -110, 30, -77, 'grass', { cell: 4, collide: false, groundAO: false });

    // Schilder
    b.defineSign('title', { style: 'logo', text: 'NULLPUNKT', sub: 'Trainingsanlage · Schießbahnen 1–8', bg: '#16191d', fg: '#f2f2f0', accent: '#ff5b1f' });
    b.defineSign('ear', { style: 'plate', text: 'GEHÖRSCHUTZ TRAGEN', sub: 'Schießbetrieb – nur mit Freigabe', bg: '#1f5f9a', fg: '#ffffff' });
    b.defineSign('danger', { style: 'warning', text: 'SCHIESSBETRIEB', sub: 'Bahnen nicht betreten' });
    b.defineSign('armory', { style: 'plate', text: 'WAFFENKAMMER', bg: '#2a2e33', fg: '#ff5b1f' });
    b.defineSign('parcours', { style: 'plate', text: 'PARCOURS', sub: 'Bewegung & Zielwechsel', bg: '#2a2e33', fg: '#f2c230' });
    b.defineSign('stand', { style: 'stencil', text: 'SCHIESSSTAND', fg: '#e9ecee' });
    for (let i = 0; i < LANES; i++) b.defineSign('lane' + (i + 1), { style: 'number', text: String(i + 1), sub: 'BAHN', bg: '#16191d', fg: '#f2f2f0' });
    for (const d of DIST) b.defineSign('d' + d, { style: 'number', text: d + ' m', bg: '#f2f0ea', fg: '#16191d' });
    for (const d of DIST) b.defineSign('dp' + d, { style: 'plate', text: String(d), bg: '#ff5b1f', fg: '#16191d', border: false });

    // --- Außenmauern -------------------------------------------------------
    for (const s of [-1, 1]) {
      wall(b, { x0: s * 30.25, z0: -77, x1: s * 30.25, z1: 62, h: 4.2, t: 0.5, mat: 'concrete_panel', cap: { mat: 'concrete', tint: '#cfcac0', h: 0.15, over: 0.08 }, minimap: 'wall' });
    }
    wall(b, { x0: -30.5, z0: 62.25, x1: 30.5, z1: 62.25, h: 4.2, t: 0.5, mat: 'concrete_panel', cap: { mat: 'concrete', tint: '#cfcac0', h: 0.15, over: 0.08 }, openings: [{ at: 30.5, w: 6, h: 3.6, kind: 'gap', frame: false }] });
    // Tor (geschlossen)
    b.box(0, 0, 62.3, 6, 3.2, 0.12, 'metal_grate', { minimap: 'wall', uvScale: 0.6, bullet: false });
    b.box(0, 0, 62.3, 6, 6, 0.4, 'black', { visual: false, minimap: false });
    b.sign(0, 4.25, 61.95, 7.5, 1.6, 'title', { ry: Math.PI, depth: 0.06 });
    // Kugelfang (Erdwall) im Norden
    b.wedge(0, 0, -81, 66, 9, 10, 'sand', { ry: Math.PI, minimap: 'wall', uv: 'world' });
    b.box(0, 0, -77.4, 60, 2.4, 0.6, 'wood_dark', { minimap: 'wall', tint: '#8d7a63' });     // Holzbohlen vor dem Wall
    b.box(0, 0, -78.5, 62, 12, 1, 'black', { visual: false, minimap: false });
    // Seitenwälle hinter den Mauern (Kulisse)
    for (const s of [-1, 1]) b.wedge(s * 34.5, 0, -10, 150, 4.5, 8, 'grass', { ry: s > 0 ? -Math.PI / 2 : Math.PI / 2, collide: false, minimap: false, uv: 'world' });
    for (let i = 0; i < 22; i++) {
      const z = -100 + i * 9 + b.rnd(-2, 2);
      tree(b, -40 - b.rnd(0, 18), z, { kind: 'tree', h: b.rnd(3.5, 5) });
      tree(b, 40 + b.rnd(0, 18), z + 4, { kind: 'tree', h: b.rnd(3.5, 5) });
    }

    // --- Überdachter Schießstand -------------------------------------------
    const z0 = FIRE_Z - 0.3, z1 = 42.6, roofY = 3.7;
    b.boxMM(-26, 0, z0, 26, 0.15, z1, 'epoxy_blue', { grad: false, minimap: 'floor' });
    // Stützen
    for (let k = 0; k <= LANES; k++) {
      const x = -22 + k * LANE_W;
      b.box(x, 0.15, z0 + 0.2, 0.3, roofY - 0.15, 0.3, 'metal_painted', { tint: '#2a2e33', minimap: 'pillar', aoFloor: 0.15 });
      b.box(x, 0.15, z1 - 0.3, 0.3, roofY - 0.15, 0.3, 'metal_painted', { tint: '#2a2e33', minimap: 'pillar', aoFloor: 0.15 });
    }
    for (const x of [-25.6, 25.6]) for (const z of [z0 + 0.2, z1 - 0.3]) b.box(x, 0.15, z, 0.3, roofY - 0.15, 0.3, 'metal_painted', { tint: '#2a2e33', minimap: 'pillar', aoFloor: 0.15 });
    // Dach mit Träger und Lichtbändern
    b.boxMM(-26.4, roofY, z0 - 0.4, 26.4, roofY + 0.32, z1 + 0.2, 'concrete', { grad: false, minimap: 'roof', tint: '#e8e4dc' });
    b.boxMM(-26.4, roofY - 0.45, z0 - 0.1, 26.4, roofY, z0 + 0.35, 'metal_painted', { grad: false, minimap: false, tint: '#ff5b1f', collide: false });
    b.sign(0, roofY - 0.42, z0 - 0.12, 10, 0.4, 'stand', { ry: 0, back: false, depth: 0 });
    for (let k = 0; k < LANES; k++) {
      const x = laneX(k);
      b.box(x, roofY - 0.05, 37.5, 3.6, 0.05, 0.25, 'lamp_cool', { collide: false, minimap: false, ao: false, cast: false });
      b.box(x, roofY - 0.05, 40.5, 3.6, 0.05, 0.25, 'lamp_cool', { collide: false, minimap: false, ao: false, cast: false });
      // Bahn-Nummer
      b.cyl(x - 0.5, roofY - 0.7, z0 + 0.45, 0.012, 0.7, 'metal_galvanized', { collide: false, seg: 4, ao: false });
      b.cyl(x + 0.5, roofY - 0.7, z0 + 0.45, 0.012, 0.7, 'metal_galvanized', { collide: false, seg: 4, ao: false });
      b.sign(x, roofY - 1.55, z0 + 0.45, 1.3, 0.9, 'lane' + (k + 1), { ry: 0, depth: 0.025 });
      // Ablage (Schießtisch)
      b.box(x, 0.15, z0 + 0.55, 3.0, 0.85, 0.65, 'wood_planks', { tint: '#9b8166', minimap: 'cover', aoFloor: 0.15 });
      b.box(x, 1.0, z0 + 0.55, 3.1, 0.05, 0.75, 'polymer', { tint: '#30353a', collide: false, minimap: false, grad: false });
      b.box(x + 1.1, 1.05, z0 + 0.6, 0.45, 0.22, 0.3, 'metal_painted', { tint: '#4f6b3a', collide: false, minimap: false, grad: false });   // Munitionskiste
      b.box(x - 0.9, 1.05, z0 + 0.5, 0.3, 0.06, 0.2, 'polymer', { collide: false, minimap: false, grad: false });
      // Gehörschutz-Ständer hinten
      b.box(x, 0.15, z1 - 0.9, 1.2, 1.2, 0.3, 'metal_painted', { tint: '#3a3f45', minimap: 'cover', aoFloor: 0.15 });
      // Bodenmarkierung Schützenposition
      b.decal(x, 0.16, z0 + 1.6, 2.4, 0.18, 'line', { ry: 0, tint: '#f2c230', kind: 'paint', opacity: 0.9 });
    }
    // Trennwände zwischen den Bahnen (Akustikpaneele)
    for (let k = 0; k <= LANES; k++) {
      const x = -22 + k * LANE_W;
      b.box(x, 0.15, z0 + 1.4, 0.14, 2.3, 2.6, 'panel_wall', { minimap: 'wall', aoFloor: 0.15, tint: '#dfe5e8' });
    }
    // Rückwand mit Durchgängen
    wall(b, { x0: -26, z0: z1 + 0.05, x1: 26, z1: z1 + 0.05, y: 0.15, h: roofY - 0.15, t: 0.25, mat: 'panel_wall', tint: '#cfd6da', openings: [
      { at: 5, w: 2.6, h: 2.8, kind: 'gap', frame: false }, { at: 26, w: 4, h: 2.9, kind: 'gap', frame: false }, { at: 47, w: 2.6, h: 2.8, kind: 'gap', frame: false }] });
    b.sign(-6, 2.2, z1 + 0.2, 4.2, 0.9, 'ear', { ry: 0, depth: 0.03 });
    b.sign(6, 2.2, z1 + 0.2, 3.6, 0.9, 'danger', { ry: 0, depth: 0.03 });
    b.interior(-26, z0 - 0.4, 26, z1 + 0.1, 0, roofY - 0.05, 0.78);

    // --- Bahnen: Markierungspfosten, Entfernungstafeln, Ziele ----------------
    for (let k = 0; k <= LANES; k++) {
      const x = -22 + k * LANE_W;
      for (let z = FIRE_Z - 2; z > -72; z -= 10) {
        b.box(x, 0, z, 0.12, 0.7, 0.12, 'white', { tint: '#f2f0ea', minimap: false, collide: false });
        b.box(x, 0.45, z, 0.13, 0.18, 0.13, 'white', { tint: '#ff5b1f', minimap: false, collide: false, ao: false, grad: false });
      }
      b.decal(x, 0.01, FIRE_Z - 2, 0.14, 4, 'line', { ry: 0, tint: '#f2f0ea', kind: 'paint' });
    }
    const targets = [];
    let tid = 0;
    for (const d of DIST) {
      const z = FIRE_Z - d;
      for (const s of [-1, 1]) {
        b.cyl(s * 27.6, 0, z, 0.08, 2.2, 'metal_galvanized', { seg: 6, minimap: false });
        b.sign(s * 27.6, 2.2, z + 0.05, 1.8, 0.9, 'd' + d, { ry: 0, depth: 0.04 });
      }
      for (let k = 0; k < LANES; k++) {
        const x = laneX(k) + OFFSET[d];
        b.box(x, 0, z, 1.8, 0.12, 1.2, 'concrete', { tint: '#d8d4ca', minimap: false, grad: false });
        // Schutzschild (Stahl, schräg)
        b.wedge(x, 0, z + 0.65, 1.7, 0.62, 0.55, 'metal_painted', { ry: Math.PI, tint: '#4b5560', minimap: 'cover', uv: 'world' });
        b.sign(x, 0.12, z + 0.95, 0.42, 0.24, 'dp' + d, { ry: 0, back: false, depth: 0.0 });
        targets.push({ id: tid++, lane: k + 1, distance: d, x, z: z - 0.15 });
      }
    }
    // Deckung entlang der Bahnen (für Bewegungstraining)
    jersey(b, -10, -6, { len: 3, ry: 0.1 });
    jersey(b, 12, -30, { len: 3, ry: -0.08 });
    jersey(b, -15, -52, { len: 3, ry: 0.05 });
    crateStack(b, 4, -18, { ry: 0.4 });
    sandbags(b, 15, -8, 19, -8.5, { rows: 5 });
    sandbags(b, -20, -36, -16, -35, { rows: 5 });
    barrel(b, -2, 0, -42, { color: '#2d5f94' }); barrel(b, -1.4, 0, -42.3, { color: '#b8392c' });
    // Flutlichtmasten
    for (const s of [-1, 1]) for (const z of [20, -20, -60]) floodMast(b, s * 28.5, z, { h: 10, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2, kind: 'cool' });

    // --- Vorplatz / Spawn ---------------------------------------------------
    for (const [x, z] of [[-4, 50], [4, 50], [-4, 55], [4, 55]]) bench(b, x, z, { ry: 0 });
    lockers(b, -9, 60.9, { n: 6, ry: Math.PI });
    lockers(b, 9, 60.9, { n: 6, ry: Math.PI });
    b.decal(0, 0.01, 52, 12, 10, 'hatch', { ry: 0, tint: '#ff5b1f', kind: 'paint', opacity: 0.5 });
    for (const x of [-12, 12]) for (const z of [47, 57]) b.plant('bush', x, 0, z, { s: 0.9 });
    electricBox(b, 0, 0, 43.2, { ry: 0, w: 1.2, h: 1.6 });

    // --- Waffenkammer (Ost) --------------------------------------------------
    const ar = building(b, {
      x: 20, z: 52, w: 15, d: 13, floors: 1, fh: 3.8, mat: 'concrete_panel', tint: '#d9d6cf', floorMat: 'epoxy', frameMat: 'metal_painted', frameTint: '#2a2e33',
      openings: [
        { side: 'w', at: 4, w: 1.8, h: 2.4, kind: 'door' },
        { side: 'n', at: -3, w: 2.2, h: 1.3, kind: 'window', sill: 1.1, glass: false },
        { side: 'n', at: 3, w: 2.2, h: 1.3, kind: 'window', sill: 1.1, glass: false },
        { side: 's', at: 4, w: 1.6, h: 1.2, kind: 'window', sill: 1.2, glass: true },
        { side: 'e', at: 2, w: 1.8, h: 2.4, kind: 'door' },
      ],
      roof: { parapet: 1.0, mat: 'concrete', tint: '#c9c5bc', gaps: { w: [{ at: 5.6, w: 1.3, h: 1.2, kind: 'gap', frame: false }] } },
      plinth: { h: 0.4, mat: 'concrete_dark' },
    });
    b.sign(ar.x0 - 0.02, 2.75, 56, 3.4, 0.7, 'armory', { ry: -Math.PI / 2, depth: 0.03 });
    rack(b, 20, 57.5, { bays: 3, levels: 2, levelH: 1.3, ry: 0 });
    workbench(b, 17, 48.5, { ry: 0 });
    workbench(b, 23, 48.5, { ry: 0 });
    crateStack(b, 25.5, 54, { ry: Math.PI / 2, pattern: [[0, 0, 0, 0.9], [0.95, 0, 0, 0.9], [0.45, 1, 0, 0.8]] });
    lockers(b, 14.5, 55, { n: 4, ry: Math.PI / 2 });
    // Außentreppe aufs Dach (Westseite, steigt nach Süden) + Podest vor der Brüstungslücke
    const st = stairs(b, { x: ar.x0 - 0.75, z: 45.9, y0: 0, y1: ar.roofY, w: 1.2, dir: 's', style: 'steel', rail: 'right' });
    const lz = 45.9 + st.run;
    b.boxMM(ar.x0 - 1.45, ar.roofY - 0.1, lz - 0.05, ar.x0, ar.roofY, lz + 1.4, 'metal_tread', { minimap: 'stairs', grad: false });
    railing(b, ar.x0 - 1.45, lz + 1.4, ar.x0 - 1.45, lz - 0.05, ar.roofY, { posts: 2 });
    railing(b, ar.x0, lz + 1.4, ar.x0 - 1.45, lz + 1.4, ar.roofY, { posts: 2 });
    for (const [sx, sz] of [[-1.4, lz + 1.35], [-0.05, lz + 1.35]]) b.box(ar.x0 + sx, 0, sz, 0.1, ar.roofY - 0.1, 0.1, 'metal_painted', { tint: '#3d4247', minimap: false });
    b.noNav(-27, 33, 27, 43.5, 3.4, 6);
    // Dachdetails
    for (const [x, z] of [[16, 49], [24, 55]]) b.box(x, ar.roofY, z, 1.6, 1.0, 1.2, 'metal_galvanized', { minimap: 'cover', aoFloor: ar.roofY });

    // --- Parcours (West) ----------------------------------------------------
    b.sign(-19, 3.2, 43.15, 3.6, 0.9, 'parcours', { ry: 0, depth: 0.03 });
    const ply = { mat: 'wood_planks', tint: '#c9b28a', h: 2.5, t: 0.15 };
    wall(b, { ...ply, x0: -27, z0: 45, x1: -12, z1: 45, openings: [{ at: 4, w: 1.6, h: 2.1, kind: 'gap', frame: false }, { at: 11, w: 1.4, h: 1.0, kind: 'window', sill: 1.0, frame: false }] });
    wall(b, { ...ply, x0: -27, z0: 51, x1: -16, z1: 51, openings: [{ at: 3, w: 1.6, h: 2.1, kind: 'gap', frame: false }, { at: 8.5, w: 1.6, h: 2.1, kind: 'gap', frame: false }] });
    wall(b, { ...ply, x0: -21.5, z0: 45, x1: -21.5, z1: 51, openings: [{ at: 3, w: 1.6, h: 2.1, kind: 'gap', frame: false }] });
    wall(b, { ...ply, x0: -12, z0: 45, x1: -12, z1: 56, openings: [{ at: 4.5, w: 1.6, h: 2.1, kind: 'gap', frame: false }, { at: 8.6, w: 1.4, h: 1.0, kind: 'window', sill: 1.0, frame: false }] });
    wall(b, { ...ply, x0: -27, z0: 56, x1: -18, z1: 56, openings: [{ at: 6.5, w: 1.6, h: 2.1, kind: 'gap', frame: false }] });
    // Turm mit Plattform
    const tx = -24, tz = 59, ty = 2.6;
    b.boxMM(tx - 2, ty - 0.2, tz - 1.6, tx + 2, ty, tz + 1.6, 'wood_planks', { tint: '#b89b74', minimap: 'catwalk', grad: false });
    for (const sx of [-1.9, 1.9]) for (const sz of [-1.5, 1.5]) b.box(tx + sx, 0, tz + sz, 0.16, ty - 0.2, 0.16, 'wood_dark', { minimap: 'pillar' });
    railing(b, tx - 2, tz + 1.55, tx + 2, tz + 1.55, ty, { tint: '#c9a227' });
    railing(b, tx - 1.95, tz - 1.6, tx - 1.95, tz + 1.55, ty, { tint: '#c9a227' });
    stairs(b, { x: tx + 3.0, z: tz - 1.6 + 0.6 + ty / 0.62, y0: 0, y1: ty, w: 1.1, dir: 'n', style: 'steel', rail: 'right' });
    b.boxMM(tx + 2, ty - 0.08, tz - 1.6, tx + 3.6, ty, tz - 0.8, 'metal_tread', { minimap: 'stairs', grad: false });
    sandbags(b, -18, 53.5, -15, 53.5, { rows: 4 });
    crate(b, -25, 0, 48, 1.0, { ry: 0.3 }); crate(b, -24.1, 0, 48.3, 0.8, { ry: -0.2 });
    barrel(b, -14, 0, 59.5); barrel(b, -13.4, 0, 59.8);
    pallet(b, -20, 0, 59.6, { load: 'boxes', ry: 0.1 });
    for (const [x, z] of [[-26.5, 53], [-17, 47.5]]) cone(b, x, z);

    // --- Startpunkte ----------------------------------------------------------
    const spawns = { A: [], B: [], ffa: [] };
    for (let i = 0; i < 10; i++) spawns.A.push({ x: -9 + (i % 5) * 4.5, z: 47.5 + Math.floor(i / 5) * 7, yaw: 0 });
    for (let i = 0; i < 10; i++) spawns.B.push({ x: -20 + i * 4.4, z: -70 + (i % 2) * 2, yaw: Math.PI });
    for (const [x, z] of [[-24, 20], [24, 18], [-10, 8], [10, -4], [-24, -14], [22, -24], [0, -32], [-12, -46], [14, -50], [-22, -64], [20, -62], [6, 12], [-6, -20], [-18, 50], [8, 47]]) spawns.ffa.push({ x, z });

    // --- Ziele (instanziert, animiert) --------------------------------------
    const T = createTargets(targets);
    b.object(T.group);
    return {
      spawns,
      objectives: { dom: [{ id: 'A', x: 0, z: 49, radius: 5 }, { id: 'B', x: 0, z: 2, radius: 6 }, { id: 'C', x: 0, z: -56, radius: 6 }] },
      zones,
      targets: T.targets,
      dispose: () => T.dispose(),
    };
  },
};

// ---------------------------------------------------------------------------
// Klappziele
// ---------------------------------------------------------------------------
function targetTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 448;
  const g = c.getContext('2d');
  g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 256, 448);
  // Zonen (IPSC-ähnlich, abstrahiert)
  g.strokeStyle = '#1b1d20'; g.lineWidth = 3;
  g.fillStyle = '#ff5b1f'; g.beginPath(); g.ellipse(128, 250, 62, 92, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#f2efe6'; g.beginPath(); g.ellipse(128, 250, 30, 46, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#ff5b1f'; g.beginPath(); g.arc(128, 66, 30, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#1b1d20'; g.font = '700 26px "JetBrains Mono NP", monospace'; g.textAlign = 'center'; g.fillText('NP', 128, 420);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function silhouetteGeom() {
  // Umriss in Metern (Pivot = Fuß des Pfostens)
  const s = new THREE.Shape();
  const P = [[-0.05, 0.0], [0.05, 0.0], [0.05, 0.52], [0.24, 0.55], [0.27, 0.7], [0.27, 1.12], [0.2, 1.22], [0.08, 1.25], [0.06, 1.28]];
  s.moveTo(P[0][0], P[0][1]);
  for (const [x, y] of P.slice(1)) s.lineTo(x, y);
  s.absarc(0, 1.4, 0.135, -Math.PI / 2 + 0.45, Math.PI * 1.5 - 0.45, false);
  for (const [x, y] of P.slice().reverse()) s.lineTo(-x, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -0.01);
  // UV: Vorderseite auf Textur (x −0.28..0.28, y 0.5..1.56)
  const uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + 0.28) / 0.56, (p.getY(i) - 0.5) / 1.06);
  return g;
}

function createTargets(list) {
  const group = new THREE.Group(); group.name = 'targets';
  const geo = silhouetteGeom();
  const tex = targetTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.2 });
  mat.userData.surface = 'metal'; mat.userData.disposable = true;
  const inst = new THREE.InstancedMesh(geo, mat, list.length);
  inst.castShadow = true; inst.receiveShadow = true; inst.name = 'target-plates';
  inst.frustumCulled = false;
  group.add(inst);
  const hinge = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8).rotateZ(Math.PI / 2), getMaterial('metal_painted'), list.length);
  hinge.name = 'target-hinges'; hinge.castShadow = true;
  group.add(hinge);
  const white = new THREE.Color(1, 1, 1), flash = new THREE.Color(1.6, 0.5, 0.35);
  const m = new THREE.Matrix4();
  const targets = list.map((t, i) => {
    const pivot = new THREE.Object3D();
    pivot.position.set(t.x, 0.12, t.z);
    pivot.userData.targetId = t.id;
    pivot.name = 'target-' + t.id;
    group.add(pivot);
    m.makeTranslation(t.x, 0.17, t.z); hinge.setMatrixAt(i, m);
    inst.setColorAt(i, white);
    const st = { angle: 0, goal: 0, hitT: 0, wobble: 0 };
    const target = {
      id: t.id, lane: t.lane, distance: t.distance, position: pivot.position.clone(), object: pivot, surface: 'metal',
      get isUp() { return st.goal === 0 && st.angle > -0.05; },
      raise() { st.goal = 0; },
      drop() { st.goal = -Math.PI / 2; },
      /** Treffer-Reaktion (kurzes Aufblitzen + Wackeln). */
      hit() { st.hitT = 0.18; st.wobble = 0.22; },
      hittable() { return st.angle > -1.0; },
      hitboxes: [
        { object: pivot, min: new THREE.Vector3(-0.28, 0.5, -0.04), max: new THREE.Vector3(0.28, 1.25, 0.04), zone: 'body' },
        { object: pivot, min: new THREE.Vector3(-0.14, 1.25, -0.04), max: new THREE.Vector3(0.14, 1.55, 0.04), zone: 'head' },
      ],
      update(dt) {
        const prev = st.angle;
        const sp = 7.5 * dt;
        st.angle += Math.max(-sp, Math.min(sp, st.goal - st.angle));
        st.wobble = Math.max(0, st.wobble - dt * 1.4);
        const wob = Math.sin(performance.now() * 0.03) * st.wobble * 0.5;
        pivot.rotation.x = st.angle + wob;
        if (prev !== st.angle || st.wobble > 0 || st.hitT > 0) {
          pivot.updateMatrix(); pivot.updateMatrixWorld();
          inst.setMatrixAt(i, pivot.matrixWorld); inst.instanceMatrix.needsUpdate = true;
        }
        if (st.hitT > 0) { st.hitT -= dt; inst.setColorAt(i, st.hitT > 0 ? flash : white); inst.instanceColor.needsUpdate = true; }
      },
    };
    pivot.rotation.x = st.angle; pivot.updateMatrix(); pivot.updateMatrixWorld();
    inst.setMatrixAt(i, pivot.matrixWorld);
    return target;
  });
  inst.instanceMatrix.needsUpdate = true; hinge.instanceMatrix.needsUpdate = true;
  return {
    group, targets,
    update(dt) { for (const t of targets) t.update(dt); },
    dispose() { geo.dispose(); tex.dispose(); mat.dispose(); hinge.geometry.dispose(); },
  };
}
