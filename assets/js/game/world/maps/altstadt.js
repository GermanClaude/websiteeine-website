// NULLPUNKT — Karte „Altstadt“: Brunnenplatz von Sant Aurel in der Mittagssonne. (Owner: world)
// Drei Bahnen: Marktgasse mit Sonnensegeln (West) · Brunnenplatz mit Kirche und Glockenturm (Mitte) ·
// Gassen und Dachterrassen (Ost). Team A startet im Süden (Südtor), Team B im Norden (Nordtor).
// Nord- und Südhälfte sind spiegelsymmetrisch (z → −z), unterscheiden sich aber in Farben und Details.
import * as THREE from 'three';
import { building, wall, stairs, railing, pitchedRoof } from '../arch.js';
import {
  frame, crate, crateStack, barrel, barrelGroup, pallet, sandbags, car, van, lampPost, acUnit, cable,
  bench, cafeTable, parasol, awning, marketStall, palm, tree, pot, laundry, electricBox, pipe, sphereGeom, lowSphereGeom, dumpster, chair, dress,
} from '../props.js';

const FH = 3.2;                       // Geschosshöhe
const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const PLASTER = ['#f7efe2', '#f2dfbb', '#ecc98f', '#f0cfae', '#eab796', '#f5e7c6', '#e3e6dc', '#f0d9a6', '#e8c2a2', '#f6ecd8', '#e9d0b0'];
const SHUTTERS = ['#2f6f9a', '#3c7a5a', '#2a5d7c', '#6f8f3a', '#9a4b2a', '#35626e', '#1f5f8a', '#4f7f6a'];
const IRON = '#2b2d30';
const STONE = '#e3d6bd';

export default {
  id: 'altstadt',
  seed: 7311,
  bounds: { minX: -46, maxX: 46, minZ: -52, maxZ: 52, minY: -2, maxY: 22 },
  visualBounds: { minX: -180, maxX: 180, minZ: -190, maxZ: 190 },
  chunkSize: 32,
  ambience: 'desert',
  // Fotoscan-Bibliothek (assets/lib): HDRI für Umgebungslicht + Himmel, Materialzuordnung siehe world/library.js
  assets: { hdri: 'old_outdoor_theater' },
  defaultSurface: 'concrete',
  navSpacing: 1.5,
  groundNoise: 0.18,
  lighting: {
    sun: { elevation: 61, azimuth: 212, color: '#ffeccc', intensity: 4.9 },
    // HDRI old_outdoor_theater: Umgebungslicht + Foto-Wolken ab ≈ 25° Höhe (darunter Bäume/Mauer des Fotos, die über
    // der Stadt riesig wirkten) – unten bleibt der Preetham-Himmel mit Dunst
    sky: { turbidity: 2.6, rayleigh: 1.05, mieCoefficient: 0.0035, mieDirectionalG: 0.8, exposure: 0.6, clouds: { coverage: 0.1, density: 0.28, scale: 0.00024, elevation: 0.62 }, hazeHigh: 0.11, hazeAmount: 0.75, hdriBlend: [0.42, 0.75] },
    hemi: { sky: '#d6e0ea', ground: '#e0bd8c', intensity: 0.6, hdriIntensity: 0.45 },
    env: { intensity: 0.58, ground: '#e0c090', groundIntensity: 0.9, tint: '#fff0dc' },
    fog: { color: '#d9e4ec', near: 90, far: 520, density: 0.0026, falloff: 0.03, start: 35, sun: 0.25, sunExp: 6 },
    shadow: { size: 40 },
    exposure: 0.94,
    // Gassen: heller Putz und Sand werfen viel Licht zurück (warme Schattenseiten), staubige Luft
    probes: { bounce: 1.25 },
    atmos: { beams: 0.016, beamG: 0.45, dust: 1.3 },
  },

  build(b, ctx) {
    const zones = [];
    defineSigns(b);

    // -----------------------------------------------------------------------
    // Boden: Kopfsteinpflaster in den Gassen, Steinplatten auf dem Brunnenplatz
    // -----------------------------------------------------------------------
    const PX0 = -16, PX1 = 15, PZ = 13;
    const cob = { cell: 1, tint: '#e9d6b4' };
    b.groundTiled(PX0, -PZ, PX1, PZ, 'paving', { cell: 1, tint: '#f0e0c4' });
    b.groundTiled(-46, -52, 46, -PZ, 'cobble', cob);
    b.groundTiled(-46, PZ, 46, 52, 'cobble', cob);
    b.groundTiled(-46, -PZ, PX0, PZ, 'cobble', cob);
    b.groundTiled(PX1, -PZ, 46, PZ, 'cobble', cob);
    // Kulissenboden
    b.groundTiled(-180, -190, 180, -52, 'sand', { cell: 6, collide: false, groundAO: false, chunk: 900 });
    b.groundTiled(-180, 52, 180, 190, 'sand', { cell: 6, collide: false, groundAO: false, chunk: 901 });
    b.groundTiled(-180, -52, -46, 52, 'sand', { cell: 6, collide: false, groundAO: false, chunk: 902 });
    b.groundTiled(46, -52, 180, 52, 'sand', { cell: 6, collide: false, groundAO: false, chunk: 903 });
    zones.push(
      { x0: PX0, z0: -PZ, x1: PX1, z1: PZ, kind: 'plaza' },
      { x0: -38, z0: -51, x1: -27, z1: 51, kind: 'road' },
      { x0: -6, z0: -51, x1: 6, z1: 51, kind: 'road' },
      { x0: 31, z0: -51, x1: 35, z1: 51, kind: 'road' },
      { x0: -44, z0: 42, x1: 44, z1: 51, kind: 'sand' },
      { x0: -44, z0: -51, x1: 44, z1: -42, kind: 'sand' },
    );

    // Unsichtbare Kartengrenze (hoch genug gegen Dachsprünge)
    b.collider(-46.4, -2, 0, 0.8, 34, 106);
    b.collider(46.4, -2, 0, 0.8, 34, 106);
    b.collider(0, -2, -52.4, 94, 34, 0.8);
    b.collider(0, -2, 52.4, 94, 34, 0.8);

    // -----------------------------------------------------------------------
    // Mitte: Brunnenplatz, Kirche Sant Aurel, Torhaus, Werkstatt
    // -----------------------------------------------------------------------
    plaza(b, ctx);
    church(b);
    bellTower(b, 15, -13, 20, -8);
    loggia(b, 15, 8, 20, 13);
    torhaus(b);
    workshop(b);

    // -----------------------------------------------------------------------
    // Beide Hälften (Süd = Team A, Nord = Team B)
    // -----------------------------------------------------------------------
    for (const s of [1, -1]) half(b, mirror(s));

    // -----------------------------------------------------------------------
    // Kulisse außerhalb
    // -----------------------------------------------------------------------
    backdrop(b);
    dressing(b);

    // -----------------------------------------------------------------------
    // Startpunkte & Flaggen
    // -----------------------------------------------------------------------
    const spawns = { A: [], B: [], ffa: [] };
    const sA = [[-41, 47], [-33, 48.5], [-23.5, 47], [-14, 48.5], [-4, 47.5], [4.5, 48.5], [13.5, 47], [22.5, 48.5], [31.5, 47.5], [40.5, 48.5], [-30, 44.5], [26, 44.5]];
    for (const [x, z] of sA) { spawns.A.push({ x, z, yaw: 0 }); spawns.B.push({ x, z: -z, yaw: Math.PI }); }
    for (const [x, z] of [
      [-33, 30], [-31.5, -16], [-21, 26.5], [-21.5, -36.5], [-10, -6], [10.5, 7], [-1, 21], [3, -31], [17, 18], [17, -20],
      [25, 24.5], [26.5, -36], [33, 12], [33, -27], [40, 5], [-12.6, 17.6], [-34, -38], [33.5, 38],
    ]) spawns.ffa.push({ x, z });
    return {
      spawns,
      objectives: { dom: [{ id: 'A', x: -5, z: 29, radius: 5 }, { id: 'B', x: -7.5, z: 0, radius: 5.5 }, { id: 'C', x: -5, z: -29, radius: 5 }] },
      zones,
    };
  },
};

// ---------------------------------------------------------------------------
// Ausstattung aus der Asset-Bibliothek (Fotoscan-Kleinteile; ohne Bibliothek entfällt sie)
// ---------------------------------------------------------------------------
function dressing(b) {
  const list = [];
  for (const s of [1, -1]) {
    const R = s > 0 ? 0 : Math.PI;
    // Marktgasse (West): Müll, Kartons, Zementsäcke an den Hauswänden (x −37,4)
    list.push(['trashbag', -36.9, 0, s * 24.4], ['trashbag', -36.95, 0, s * 25.0], ['cardboard_box_01', -36.9, 0, s * 9.0, 0.3]);
    list.push(['cement_bag', -36.85, 0, s * 14.4, 0.1 + R], ['cement_bag', -36.9, 0.18, s * 14.5, 1.5]);
    list.push(['metal_jerrycan_green', -36.95, 0, s * 7.6, 0.6]);
    // Ostgasse (x 31,4 … 35,0)
    list.push(['trashbag', 34.6, 0, s * 21.2], ['cardboard_box_01', 31.8, 0, s * 18.6, 0.8]);
    // Torvorplatz (Sand): ausgedientes Sofa + Fernseher an der Stadtmauer, Kisten, Müll
    list.push(['sofa_01', -30.0, 0, s * 50.45, R, { collide: true }], ['television_01', -28.55, 0, s * 50.55, R + 0.3]);
    list.push(['trashbag', -27.9, 0, s * 50.7], ['cardboard_box_01', 18.6, 0, s * 50.6, 0.4], ['cardboard_box_01', 19.2, 0, s * 50.75, 1.3]);
    list.push(['wooden_military_crate', 36.2, 0, s * 50.6, R + 0.05, { collide: true }]);
    list.push(['metal_jerrycan_green', 9.4, 0, s * 50.8, 2.0], ['cement_bag', -9.6, 0, s * 50.7, 0.3]);
  }
  dress(b, list);
}

// ---------------------------------------------------------------------------
// Schilder
// ---------------------------------------------------------------------------
function defineSigns(b) {
  b.defineSign('cafe', { style: 'plate', text: 'CAFÉ AUREL', sub: 'Espresso · Granita · seit 1911', bg: '#1f5f8a', fg: '#f4efe2' });
  b.defineSign('bakery', { style: 'plate', text: 'BÄCKEREI SOLE', sub: 'Brot · Gebäck', bg: '#f4ead2', fg: '#8a3a22' });
  b.defineSign('pharmacy', { style: 'plate', text: 'APOTHEKE', bg: '#1f7a46', fg: '#ffffff' });
  b.defineSign('pension', { style: 'plate', text: 'PENSION MIRAMAR', sub: 'Zimmer frei', bg: '#f2ece0', fg: '#1f4f6e' });
  b.defineSign('tabak', { style: 'plate', text: 'TABAK · ZEITUNGEN', bg: '#16191d', fg: '#f2c230' });
  b.defineSign('market', { style: 'arrow', text: 'MARKT', bg: '#b8392c', fg: '#f4efe2', dir: 'left' });
  b.defineSign('st_markt', { style: 'plate', text: 'MARKTGASSE', bg: '#f4f1ea', fg: '#22272c', borderColor: '#22272c' });
  b.defineSign('st_platz', { style: 'plate', text: 'BRUNNENPLATZ', bg: '#f4f1ea', fg: '#22272c', borderColor: '#22272c' });
  b.defineSign('st_kirche', { style: 'plate', text: 'KIRCHGASSE', bg: '#f4f1ea', fg: '#22272c', borderColor: '#22272c' });
  b.defineSign('st_dach', { style: 'plate', text: 'GASSE DER DÄCHER', bg: '#f4f1ea', fg: '#22272c', borderColor: '#22272c' });
  b.defineSign('gate_s', { style: 'stencil', text: 'SÜDTOR', sub: 'PORTA SUD · MDCCXII', fg: '#5b4a36' });
  b.defineSign('gate_n', { style: 'stencil', text: 'NORDTOR', sub: 'PORTA NORD · MDCCXII', fg: '#5b4a36' });
  b.defineSign('church', { style: 'stencil', text: 'SANT AUREL', fg: '#6a5a44' });
  b.defineSign('shop_fruit', { style: 'plate', text: 'OBST & GEMÜSE', bg: '#3c7a5a', fg: '#f4efe2' });
  b.defineSign('shop_spice', { style: 'plate', text: 'GEWÜRZE · TEE', bg: '#9a4b2a', fg: '#f4efe2' });
  b.defineSign('shop_tex', { style: 'plate', text: 'STOFFE', sub: 'Teppiche · Leinen', bg: '#2a5d7c', fg: '#f4efe2' });
  b.defineSign('werkstatt', { style: 'plate', text: 'WERKSTATT RUGGERI', sub: 'Mopeds · Fahrräder', bg: '#c9a227', fg: '#16191d' });
  b.defineSign('menu', { style: 'plate', text: 'HEUTE: FISCH', sub: 'Mittagstisch ab 12 Uhr', bg: '#1d2a22', fg: '#f4efe2', border: false });
}

// ---------------------------------------------------------------------------
// Spiegelung & Bausteine
// ---------------------------------------------------------------------------
/** Spiegel-Helfer: Südhälfte (s = 1, Team A) ↔ Nordhälfte (s = −1, Team B). */
function mirror(s) {
  return {
    s,
    z: z => z * s,
    zz: (a, c) => (s > 0 ? [a, c] : [-c, -a]),
    side: d => (s > 0 || (d !== 'n' && d !== 's') ? d : d === 'n' ? 's' : 'n'),
    ry: ry => (s > 0 ? ry : Math.PI - ry),
    lr: lr => (s > 0 ? lr : lr === 'left' ? 'right' : 'left'),
  };
}
/** Blickrichtung (ry) nach außen für eine Hausseite. */
const SIDE_RY = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 };

/** Treppengeometrie in Weltkoordinaten (Eingaben in Südkoordinaten). */
function stairGeom(M, si, fh = FH) {
  const x = si.x, z = M.z(si.z), dir = M.side(si.dir), w = si.w ?? 1.1;
  const y0 = si.y0 ?? 0.12, y1 = si.y1 ?? fh;
  const run = si.run ?? (y1 - y0) / (si.slope ?? 0.62);
  const [dx, dz] = DIRV[dir], rx = -dz, rz = dx;
  const P = (f, r) => [x + dx * f + rx * r, z + dz * f + rz * r];
  const open = M.lr(si.open || 'left');
  const os = open === 'left' ? -1 : 1;
  const c0 = P(1.0, -w / 2 - 0.06), c1 = P(run + 0.02, w / 2 + 0.06);
  const hole = { x0: Math.min(c0[0], c1[0]), x1: Math.max(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), z1: Math.max(c0[1], c1[1]) };
  return { x, z, dir, w, y0, y1, run, P, os, open, hole };
}

function mapOpening(M, op, shutter) {
  const side = M.side(op.side);
  const at = side === 'e' || side === 'w' ? op.at * M.s : op.at;
  const r = { ...op, side, at };
  if (op.shutters === true) r.shutters = shutter;
  if (op.closed === true) r.closed = shutter;
  if (op.leaf && !op.leafTint) r.leafTint = shutter;
  return r;
}

/**
 * Mediterranes Haus (Südkoordinaten, über M gespiegelt).
 * o: { x0, x1, z0, z1, floors, fh, color, shutter, mat, open:[Öffnungen wie building()], roof: 'terrace'|'pitched'|'flat',
 *      ridge, gaps:[{ side, a, b }] (Weltintervalle in Südkoordinaten), stairsIn:{ x, z, dir, w, open }, closed (nicht begehbar),
 *      upperClosed (OG nicht erreichbar), balconies:[{ side, at, floor, w }], ac:[{ side, at, y }], vines:[{ side, at }] }
 * Liefert { B, x0, x1, z0, z1, roofY, color, shutter }.
 */
function house(b, M, o) {
  const [z0, z1] = M.zz(o.z0, o.z1);
  const x0 = o.x0, x1 = o.x1, x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const floors = o.floors ?? 2, fh = o.fh ?? FH;
  const color = o.color || b.pick(PLASTER), shutter = o.shutter || b.pick(SHUTTERS);
  const mat = o.mat || 'plaster_white';
  const openings = (o.open || []).map(op => mapOpening(M, op, shutter));
  const holes = [];
  let st = null;
  if (o.stairsIn) { st = stairGeom(M, o.stairsIn, fh); holes.push({ floor: 1, ...st.hole }); }
  const roofKind = o.roof || 'pitched';
  const pt = 0.22;
  const gaps = {};
  for (const g of o.gaps || []) {
    const side = M.side(g.side);
    let a = g.a, c = g.b;
    if (side === 'e' || side === 'w') [a, c] = M.zz(g.a, g.b);
    const mid = (a + c) / 2, gw = Math.abs(c - a);
    const at = side === 'n' ? mid - x0 : side === 's' ? x1 - mid : side === 'e' ? mid - (z0 + pt) : (z1 - pt) - mid;
    (gaps[side] ||= []).push({ at, w: gw, h: 2, kind: 'gap', frame: false });
  }
  const roof = roofKind === 'terrace' ? { parapet: o.parapet ?? 1.0, mat: 'concrete', tint: '#cfc4ae', gaps, capMat: 'plaster_white', capTint: '#f4efe4' }
    : roofKind === 'flat' ? { parapet: 0.5, mat: 'concrete', tint: '#cfc4ae', capMat: 'plaster_white', capTint: '#f4efe4' }
      : { edge: false, mat: 'concrete', tint: '#b9ab94' };
  const B = building(b, {
    x, z, w, d, floors, fh, mat, tint: color, openings, holes, roof,
    floorMat: o.floorMat || 'tiles_terracotta', upperFloorMat: o.upperFloorMat || (o.upperClosed || o.closed ? null : 'tiles_pattern'),
    frameMat: 'wood_dark', frameTint: o.frameTint || '#6a5440', sillMat: 'plaster_white',
    plinth: o.plinth === false ? null : { h: 0.55, mat: 'stone_wall', tint: o.plinthTint || '#d9cbb0', over: 0.03 },
    band: floors > 1 && o.band !== false ? { mat: 'plaster_white', tint: '#f6f1e6' } : null,
    interiorFactor: o.dark ?? 0.56,
  });
  const roofY = B.roofY;
  if (roofKind === 'pitched') {
    pitchedRoof(b, { x, z, w: w + 0.02, d: d + 0.02, y: roofY - 0.02, ridge: o.ridge || (w >= d ? 'x' : 'z'), pitch: o.pitch ?? 0.42, over: 0.45, gableMat: mat, gableTint: color, tint: o.roofTint || b.pick(['#c9785a', '#bf6e4e', '#d08462', '#b8694c']) });
    b.noNav(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, roofY - 0.6, 40);
  } else if (roofKind === 'terrace') {
    b.boxMM(x0 + pt, roofY, z0 + pt, x1 - pt, roofY + 0.025, z1 - pt, 'tiles_terracotta', { grad: false, minimap: false, collide: false, tint: '#e2b9a0' });
  } else {
    b.noNav(x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, roofY - 0.6, 40);
  }
  if (o.closed) b.noNav(x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, -1, roofKind === 'terrace' ? roofY - 0.6 : 40);
  else if (o.upperClosed && floors > 1) b.noNav(x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, fh - 0.6, roofY - 0.6);
  // Innentreppe ins Obergeschoss
  if (st) {
    stairs(b, { x: st.x, z: st.z, y0: st.y0, y1: st.y1, w: st.w, dir: st.dir, run: st.run, style: 'solid', mat: 'tiles_terracotta', tint: '#d9b49a', rail: st.open, railTint: IRON, railFrom: 1.2, interior: true });
    const [ax, az] = st.P(1.0, st.os * (st.w / 2 + 0.06)), [bx, bz] = st.P(st.run + 0.02, st.os * (st.w / 2 + 0.06));
    railing(b, ax, az, bx, bz, st.y1, { tint: IRON, posts: 3 });
    const [cx, cz] = st.P(1.0, -st.w / 2 - 0.06), [ex, ez] = st.P(1.0, st.w / 2 + 0.06);
    railing(b, cx, cz, ex, ez, st.y1, { tint: IRON, posts: 2 });
  }
  const res = { B, x0, x1, z0, z1, x, z, w, d, roofY, color, shutter, fh };
  if (o.dress !== false) dressFacade(b, M, res, o);
  // Balkone, Klimageräte, Kletterpflanzen
  for (const bl of o.balconies || []) balcony(b, M, res, bl);
  for (const a of o.ac || []) {
    const [px, pz, ry] = onWall(M, res, a.side, a.at, 0.21);
    acUnit(b, px, a.y ?? fh + 1.0, pz, { ry, pipe: a.pipe });
  }
  for (const v of o.vines || []) {
    const [px, pz] = onWall(M, res, v.side, v.at, 0.25);
    for (let k = 0; k < (v.n ?? 4); k++) b.plant('vine', px + (b.rand() - 0.5) * 0.6, k * 0.85 + 0.2, pz + (b.rand() - 0.5) * 0.6, { s: 0.9 + b.rand() * 0.4, tint: b.pick(['#d0408a', '#c63a7c', '#e05a9a', '#b8306e']) });
    pot(b, px, 0, pz, { r: 0.3, h: 0.45 });
  }
  return res;
}

/** Fassadendetails: Blumenkästen, Türlampen, Fallrohr, Hausnummern, Kabel. */
function dressFacade(b, M, h, o) {
  const flowers = ['#e0405a', '#f2f0ea', '#d0408a', '#f2b22a', '#c8302a'];
  for (const op of o.open || []) {
    const fl = op.floor ?? 0;
    if (op.kind === 'window' && fl >= 1 && !op.closed && b.rand() < 0.45) {
      const [px, pz, ry] = onWall(M, h, op.side, op.at, 0.14);
      const y = fl * h.fh + (op.sill ?? 0.95) - 0.3;
      const f = frame(b, px, y, pz, ry);
      f.box(0, 0, 0, op.w + 0.1, 0.22, 0.24, 'tiles_terracotta', { tint: '#c47a52', collide: false, minimap: false, grad: false, ao: false });
      const n = Math.max(2, Math.round(op.w / 0.32));
      for (let i = 0; i < n; i++) { const [qx, qz] = f.P(-op.w / 2 + 0.1 + (i * (op.w - 0.2)) / (n - 1), 0); b.plant(b.rand() < 0.6 ? 'flowers' : 'bush', qx, y + 0.18, qz, { s: 0.32 + b.rand() * 0.12, tint: b.rand() < 0.6 ? b.pick(flowers) : undefined }); }
    } else if (op.kind === 'door' && fl === 0 && !op.leaf && b.rand() < 0.55) {
      const [px, pz, ry] = onWall(M, h, op.side, op.at + op.w / 2 + 0.35, 0.0);
      wallLamp(b, px, 2.55, pz, ry);
    }
  }
  // Fallrohr an einer Ecke (vom Dach bis zum Boden)
  if (o.roof !== 'flat' && b.rand() < 0.8) {
    const cx = b.rand() < 0.5 ? h.x0 + 0.12 : h.x1 - 0.12, cz = b.rand() < 0.5 ? h.z0 - 0.1 : h.z1 + 0.1;
    const col = b.pick(['#8a8f94', '#b8694c', '#6f7a72']);
    b.cyl(cx, 0, cz, 0.055, h.roofY - 0.1, 'metal_painted', { tint: col, seg: 6, collide: false, minimap: false, ao: false });
    b.cyl(cx, h.roofY - 0.25, cz, 0.08, 0.25, 'metal_painted', { tint: col, seg: 6, collide: false, minimap: false, ao: false });
  }
}

/** Punkt vor einer Hauswand (Südkoordinaten-Seite + Versatz) → [x, z, ry nach außen]. */
function onWall(M, h, side, at, off = 0.2) {
  const sd = M.side(side);
  const ry = SIDE_RY[sd];
  if (sd === 'n') return [h.x + at, h.z0 - off, ry];
  if (sd === 's') return [h.x + at, h.z1 + off, ry];
  const zz = h.z + at * M.s;
  return sd === 'e' ? [h.x1 + off, zz, ry] : [h.x0 - off, zz, ry];
}

/** Balkon vor einer Fenstertür im Obergeschoss. */
function balcony(b, M, h, o) {
  const fy = (o.floor ?? 1) * h.fh, w = o.w ?? 2.2, dep = o.d ?? 0.85;
  const [px, pz, ry] = onWall(M, h, o.side, o.at, 0);
  const f = frame(b, px, fy, pz, ry);
  f.box(0, -0.16, dep / 2, w, 0.16, dep, 'stone_wall', { tint: STONE, collide: true, minimap: false, grad: false });
  for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) f.box(sx, -0.42, 0.2, 0.12, 0.26, 0.4, 'stone_wall', { tint: STONE, collide: false, minimap: false, grad: false });
  // schmiedeeisernes Geländer
  const n = Math.round(w / 0.12);
  for (let i = 0; i <= n; i++) f.box(-w / 2 + 0.04 + (i * (w - 0.08)) / n, 0, dep - 0.05, 0.018, 0.95, 0.018, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
  for (let i = 1; i < Math.round(dep / 0.12); i++) for (const sx of [-w / 2 + 0.04, w / 2 - 0.04]) f.box(sx, 0, i * 0.12, 0.018, 0.95, 0.018, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
  f.box(0, 0.95, dep - 0.05, w, 0.04, 0.05, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
  for (const sx of [-w / 2 + 0.04, w / 2 - 0.04]) f.box(sx, 0.95, dep / 2, 0.05, 0.04, dep, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
  f.solid(0, 0, dep - 0.05, w, 1.0, 0.06, { minimap: false, bullet: false });
  if (o.pots !== false) for (const sx of [-w / 2 + 0.35, w / 2 - 0.35]) { const [qx, qz] = f.P(sx, dep - 0.3); pot(b, qx, fy, qz, { r: 0.2, h: 0.32, collide: false, plant: b.rand() < 0.5 ? 'flowers' : 'bush', s: 0.45 }); }
}

/** Außentreppe (gemauert) mit Podest bis Dach-/Geschosshöhe. */
function extStairs(b, M, o) {
  const st = stairGeom(M, { ...o, y0: o.y0 ?? 0, slope: o.slope ?? 0.7 });
  const tint = o.tint || '#efe6d4';
  stairs(b, { x: st.x, z: st.z, y0: st.y0, y1: st.y1, w: st.w, dir: st.dir, run: st.run, style: 'solid', mat: 'plaster_white', tint, rail: st.open, railTint: IRON, railFrom: 1.2 });
  // Podest (massiv bis zum Boden)
  const L = o.landing ?? 1.3, wg = o.wallGap ?? 0;
  const c0 = st.P(st.run - 0.02, st.os * (st.w / 2)), c1 = st.P(st.run + L, -st.os * (st.w / 2 + wg));
  b.boxMM(Math.min(c0[0], c1[0]), st.y0, Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), st.y1, Math.max(c0[1], c1[1]), 'plaster_white', { tint, minimap: 'stairs', aoFloor: st.y0 });
  b.boxMM(Math.min(c0[0], c1[0]) - 0.04, st.y1 - 0.02, Math.min(c0[1], c1[1]) - 0.04, Math.max(c0[0], c1[0]) + 0.04, st.y1 + 0.03, Math.max(c0[1], c1[1]) + 0.04, 'stone_wall', { tint: STONE, collide: false, minimap: false, grad: false });
  // Geländer am Podest: offene Seite + Stirnseite
  const [ax, az] = st.P(st.run, st.os * (st.w / 2 - 0.03)), [bx, bz] = st.P(st.run + L - 0.03, st.os * (st.w / 2 - 0.03));
  railing(b, ax, az, bx, bz, st.y1, { tint: IRON, posts: 2 });
  const [cx, cz] = st.P(st.run + L - 0.03, -st.w / 2), [ex, ez] = st.P(st.run + L - 0.03, st.w / 2);
  railing(b, cx, cz, ex, ez, st.y1, { tint: IRON, posts: 2 });
  const [nx, nz] = st.P(st.run + L / 2, 0);
  b.navPoint(nx, st.y1 + 0.2, nz);
  return st;
}

// --- Bögen ------------------------------------------------------------------
const archCache = new Map();
/** Bogenzwickel: Rechteck span × H mit Kreisbogen-Unterseite (Stichhöhe rise), Tiefe depth (lokal z). */
function archGeom(span, rise, H, depth) {
  const key = [span, rise, H, depth].map(v => v.toFixed(2)).join('_');
  if (archCache.has(key)) return archCache.get(key);
  const R = (span * span / 4 + rise * rise) / (2 * rise), cy = rise - R;
  const a0 = Math.atan2(-cy, span / 2);
  const s = new THREE.Shape();
  s.moveTo(-span / 2, 0); s.lineTo(-span / 2, H); s.lineTo(span / 2, H); s.lineTo(span / 2, 0);
  s.absarc(0, cy, R, a0, Math.PI - a0, false);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  archCache.set(key, ng);
  return ng;
}
/** Bogen in einer Öffnung: (x, z) Mitte, y = Kämpferhöhe, span entlang lokal x (ry). */
function arch(b, x, y, z, span, rise, H, depth, mat, o = {}) {
  b.geom(archGeom(span, rise, H, depth), x, y, z, mat, { ry: o.ry || 0, tint: o.tint, uv: 'world', collide: o.collide ?? 'mesh', minimap: false, grad: false, ao: false });
}

// --- Sonnensegel -------------------------------------------------------------
const sailCache = new Map();
function sailGeom(w, d, sag, design) {
  const key = `${w.toFixed(2)}_${d.toFixed(2)}_${sag.toFixed(2)}_${design}`;
  if (sailCache.has(key)) return sailCache.get(key);
  const g = new THREE.PlaneGeometry(w, d, 8, 6);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  const v0 = 1 - (design + 1) / 4, v1 = 1 - design / 4;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / (w / 2), c = p.getZ(i) / (d / 2);
    p.setY(i, -sag * (1 - a * a) * (1 - c * c) - sag * 0.25 * (1 - a * a));
    uv.setXY(i, (p.getX(i) + w / 2) / 1.2, v0 + 0.012 + ((p.getZ(i) + d / 2) / d) * (v1 - v0 - 0.024));
  }
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  sailCache.set(key, ng);
  return ng;
}
/** Sonnensegel quer über eine Gasse (w lokal x, d lokal z), Ecken auf Höhe y, mit Halteseilen. */
function sail(b, x, y, z, w, d, design, o = {}) {
  b.geom(sailGeom(w, d, o.sag ?? 0.45, design), x, y, z, 'awning', { ry: o.ry || 0, collide: false, minimap: false, uv: 'keep', ao: false, bullet: false, cast: true, tint: o.tint });
  const f = frame(b, x, y, z, o.ry || 0);
  if (o.ropes !== false) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [ax, az] = f.P(sx * w / 2, sz * d / 2), [cx, cz] = f.P(sx * (w / 2 + 0.6), sz * (d / 2 + 0.2));
    cable(b, [ax, y, az], [cx, y + 0.35, cz], { sag: 0.05, segments: 2, r: 0.012 });
  }
}

// --- Kleinteile ------------------------------------------------------------------
function lowWall(b, x0, z0, x1, z1, o = {}) {
  const h = o.h ?? 1.0, t = o.t ?? 0.35;
  wall(b, { x0, z0, x1, z1, h, t, mat: 'stone_wall', tint: o.tint || '#dccdb2', cap: { mat: 'plaster_white', tint: '#f2ece0', h: 0.08, over: 0.05 }, minimap: 'cover', openings: o.openings || [] });
}

function planter(b, x, z, w, d, o = {}) {
  const h = o.h ?? 0.75;
  b.box(x, 0, z, w, h, d, 'stone_wall', { tint: o.tint || '#e0d2b8', minimap: 'cover', ry: o.ry || 0 });
  b.box(x, h, z, w + 0.1, 0.06, d + 0.1, 'plaster_white', { tint: '#f2ece0', collide: false, minimap: false, grad: false, ry: o.ry || 0 });
  b.box(x, h - 0.08, z, w - 0.3, 0.1, d - 0.3, 'dirt', { collide: false, minimap: false, grad: false, ao: false, ry: o.ry || 0 });
  const n = Math.max(1, Math.round((w * d) / 1.6));
  const f = frame(b, x, h - 0.1, z, o.ry || 0);
  for (let i = 0; i < n; i++) { const [px, pz] = f.P((b.rand() - 0.5) * (w - 0.6), (b.rand() - 0.5) * (d - 0.6)); b.plant(o.plant || (b.rand() < 0.35 ? 'flowers' : 'bush'), px, h - 0.1, pz, { s: 0.6 + b.rand() * 0.4 }); }
  if (o.tree) tree(b, x, z, { y: h - 0.1, kind: o.tree, h: 2.4 });
}

function handcart(b, x, z, ry, o = {}) {
  const f = frame(b, x, 0, z, ry);
  f.box(0, 0.55, 0, 1.0, 0.1, 1.6, 'wood_planks', { tint: '#a07a52', collide: false, minimap: false, grad: false });
  for (const sx of [-0.48, 0.48]) f.box(sx, 0.65, 0, 0.05, 0.3, 1.6, 'wood_planks', { tint: '#8a6a4a', collide: false, minimap: false, grad: false });
  for (const sx of [-0.56, 0.56]) f.cyl(sx, 0.42, 0.2, 0.42, 0.06, 'wood_dark', { axis: 'x', collide: false, minimap: false, seg: 12 });
  for (const sx of [-0.35, 0.35]) f.box(sx, 0.5, -1.25, 0.05, 0.05, 1.1, 'wood_dark', { collide: false, minimap: false, grad: false, rx: -0.25 });
  const goods = o.goods || b.pick([['#e8862a', '#d43c2a'], ['#6aa53a', '#e6c53a'], ['#c8402f', '#8a3a7a']]);
  for (let k = 0; k < 10; k++) f.geom(lowSphereGeom(), (b.rand() - 0.5) * 0.7, 0.72 + b.rand() * 0.12, (b.rand() - 0.5) * 1.2, 'white', { sx: 0.1, sy: 0.09, sz: 0.1, tint: goods[k % goods.length], collide: false, minimap: false, ao: false, bullet: false, cast: false });
  f.solid(0, 0, 0, 1.1, 0.95, 1.7, { minimap: 'cover' });
}

function basketRow(b, x, z, ry, n = 3) {
  const f = frame(b, x, 0, z, ry);
  const cols = ['#c9783a', '#a33a2a', '#d9b04a', '#6a8a3a', '#7a4a2a'];
  for (let i = 0; i < n; i++) {
    const [px, pz] = f.P((i - (n - 1) / 2) * 0.62, 0);
    b.cyl(px, 0, pz, 0.26, 0.42, 'wood_crate', { r1: 0.3, tint: '#c8a878', seg: 10, collide: false, minimap: false, uv: 'keep' });
    b.cyl(px, 0.38, pz, 0.27, 0.06, 'sand', { tint: b.pick(cols), seg: 10, collide: false, minimap: false, ao: false });
  }
  f.solid(0, 0, 0, n * 0.62, 0.5, 0.62, { minimap: 'prop' });
}

/** Dreirad-Lieferwagen (Kleintransporter auf drei Rädern). */
function trike(b, x, z, ry, color = '#3a7aa8') {
  const f = frame(b, x, 0, z, ry);
  f.box(0, 0.35, 0.9, 1.25, 1.1, 1.1, 'metal_painted', { tint: color, collide: false, minimap: false, grad: false });
  f.box(0, 1.0, 1.42, 1.1, 0.42, 0.04, 'glass', { collide: false, minimap: false, ao: false, rx: 0.15 });
  f.box(0, 1.45, 0.9, 1.25, 0.06, 1.15, 'metal_painted', { tint: '#f2efe8', collide: false, minimap: false, grad: false });
  f.box(0, 0.45, -0.75, 1.35, 0.08, 2.1, 'wood_planks', { tint: '#9a7a52', collide: false, minimap: false, grad: false });
  for (const sx of [-0.66, 0.66]) f.box(sx, 0.53, -0.75, 0.04, 0.4, 2.1, 'wood_planks', { tint: '#8a6a4a', collide: false, minimap: false, grad: false });
  f.box(0, 0.53, -1.78, 1.35, 0.4, 0.04, 'wood_planks', { tint: '#8a6a4a', collide: false, minimap: false, grad: false });
  f.cyl(0, 0.24, 1.15, 0.24, 0.16, 'rubber', { axis: 'x', collide: false, minimap: false, seg: 12 });
  for (const sx of [-0.62, 0.62]) f.cyl(sx, 0.24, -1.2, 0.24, 0.16, 'rubber', { axis: 'x', collide: false, minimap: false, seg: 12 });
  f.box(-0.4, 0.7, 1.46, 0.18, 0.1, 0.03, 'lamp_warm', { collide: false, minimap: false, ao: false });
  crate(b, ...f.P(-0.3, -0.6), 0.53, 0.5, { ry: ry + 0.1, minimap: false });
  crate(b, ...f.P(0.3, -1.2), 0.53, 0.45, { ry: ry - 0.2, minimap: false });
  f.solid(0, 0, -0.2, 1.4, 1.5, 3.2, { minimap: 'vehicle' });
}

function wallLamp(b, x, y, z, ry) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0.25, 0.25, 0.04, 0.04, 0.5, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
  f.box(0, -0.15, 0.48, 0.22, 0.32, 0.22, 'white', { collide: false, minimap: false, ao: false, tint: '#f3e8cf' });
  f.box(0, 0.17, 0.48, 0.28, 0.06, 0.28, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
}

function streetSign(b, x, y, z, ry, key) { b.sign(x, y, z, 1.5, 0.42, key, { ry, depth: 0.02 }); }

// ---------------------------------------------------------------------------
// Mitte: Brunnenplatz
// ---------------------------------------------------------------------------
function plaza(b, ctx) {
  // Pflasterring um den Brunnen + Rinnen
  b.cyl(0, 0, 0, 5.2, 0.03, 'cobble', { seg: 24, collide: false, minimap: false, tint: '#d8cdb8', ao: false });
  b.cyl(0, 0, 0, 5.45, 0.025, 'stone_wall', { seg: 24, collide: false, minimap: false, tint: '#cbbd9f', ao: false });
  well(b, 0, 0, ctx);
  // Platzrand: Poller + Laternen
  for (const [x, z] of [[-14.6, -4], [-14.6, 4], [13.6, -9], [13.6, 9]]) b.cyl(x, 0, z, 0.16, 0.7, 'stone_wall', { r1: 0.12, tint: STONE, seg: 8, minimap: 'prop' });
  for (const [x, z] of [[-9.5, -9.5], [9.5, 9.5], [9.5, -9.5], [-9.5, 9.5]]) ornateLamp(b, x, z);
  // Olivenbäume in Pflanzkübeln (Deckung)
  planter(b, 7.5, -4.5, 2.2, 2.2, { tree: 'olive', plant: 'flowers' });
  planter(b, 7.5, 4.5, 2.2, 2.2, { tree: 'olive' });
  // Bänke
  bench(b, 4.6, -7.6, { ry: Math.PI });
  bench(b, 4.6, 7.6, { ry: 0 });
  bench(b, -3.5, -8.2, { ry: Math.PI });
  // Ziehwagen & Kisten als Deckung
  handcart(b, -11.2, -5.8, 0.4);
  crateStack(b, 11.6, 0.6, { ry: 0.3, pattern: [[0, 0, 0, 1.1], [0, 0, 1.15, 1.0], [0.05, 1, 0.55, 0.9]] });
  barrelGroup(b, -12.6, 6.0, { n: 3, colors: ['#3a6f8a', '#8a3a2a', '#3a6f8a'] });
  sandbags(b, -3.4, -11.6, 1.6, -11.4, { rows: 5 });
  sandbags(b, -1.6, 11.4, 3.4, 11.6, { rows: 5 });
  // Pfützen & Abnutzung
  for (let i = 0; i < 18; i++) {
    const x = b.rnd(-15, 14), z = b.rnd(-12, 12);
    if (Math.hypot(x, z) < 3.2) continue;
    const k = b.rand();
    if (k < 0.45) b.decal(x, 0.012, z, b.rnd(2, 4), b.rnd(2, 4), 'stain', { opacity: 0.5 });
    else if (k < 0.65) b.decal(x, 0.012, z, b.rnd(1.5, 3), b.rnd(1.5, 3), 'cracks', { opacity: 0.6 });
    else if (k < 0.8) b.decal(x, 0.012, z, b.rnd(1.2, 2), b.rnd(1.2, 2), 'leaves', { opacity: 0.9 });
    else b.decal(x, 0.012, z, b.rnd(0.6, 1.2), b.rnd(0.6, 1.2), 'paper', { opacity: 0.9 });
  }
  b.decal(0, 0.03, 3.6, 2.4, 1.6, 'puddle', { opacity: 0.8, ry: 0.3 });
  b.decal(-2.8, 0.03, -2.4, 1.8, 1.4, 'puddle', { opacity: 0.7 });
  b.sign(-15.97, 2.9, 10.6, 1.5, 0.42, 'st_platz', { ry: Math.PI / 2, depth: 0.02 });
}

function ornateLamp(b, x, z) {
  b.cyl(x, 0, z, 0.2, 0.5, 'metal_painted', { r1: 0.12, tint: IRON, seg: 8, minimap: 'prop' });
  b.cyl(x, 0.5, z, 0.06, 3.2, 'metal_painted', { r1: 0.045, tint: IRON, seg: 8, collide: true, minimap: false });
  for (const a of [0, Math.PI]) {
    const f = frame(b, x, 3.5, z, a);
    f.box(0.35, 0, 0, 0.7, 0.04, 0.04, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
    f.box(0.68, -0.42, 0, 0.24, 0.34, 0.24, 'white', { tint: '#f3e8cf', collide: false, minimap: false, ao: false });
    f.box(0.68, -0.1, 0, 0.3, 0.06, 0.3, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false, ao: false });
  }
  b.geom(sphereGeom(), x, 3.6, z, 'metal_painted', { sx: 0.09, sy: 0.09, sz: 0.09, tint: IRON, collide: false, minimap: false, ao: false });
}

/** Achteckiger Brunnen mit Säule, oberer Schale und Wasser. */
function well(b, x, z, ctx) {
  const R = 2.25, t = 0.38, h = 0.78;
  b.cyl(x, 0, z, R + 0.35, 0.16, 'stone_wall', { seg: 8, tint: '#d9ccb2', minimap: false, collide: true, ry: Math.PI / 8 });
  const side = 2 * R * Math.tan(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const ry = Math.atan2(-Math.cos(a), -Math.sin(a));
    const cx = x + Math.cos(a) * (R - t / 2), cz = z + Math.sin(a) * (R - t / 2);
    b.box(cx, 0.16, cz, side + 0.02, h - 0.16, t, 'stone_wall', { ry, tint: '#e6dcc8', minimap: 'cover', uv: 'local' });
    b.box(x + Math.cos(a) * (R - t / 2 + 0.02), h, z + Math.sin(a) * (R - t / 2 + 0.02), side + 0.1, 0.08, t + 0.12, 'plaster_white', { ry, tint: '#efe9dc', collide: false, minimap: false, grad: false });
  }
  b.cyl(x, 0.16, z, R - t + 0.02, 0.2, 'stone_wall', { seg: 8, tint: '#6f7a72', collide: false, minimap: false, ry: Math.PI / 8 });
  // Wasser (achteckig)
  const w = ctx.water({ x0: x - 1, z0: z - 1, x1: x + 1, z1: z + 1, y: h - 0.12, color: '#2f6a6e', scale: 2.5 });
  const g = new THREE.CircleGeometry((R - t + 0.04) / Math.cos(Math.PI / 8), 8);
  g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 8); g.translate(x, h - 0.12, z);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2.5, -p.getZ(i) / 2.5);
  w.mesh.geometry.dispose(); w.mesh.geometry = g;
  // Säule, obere Schale, Aufsatz
  b.cyl(x, 0.3, z, 0.42, 0.5, 'stone_wall', { seg: 8, tint: '#d9ccb2', minimap: false });
  b.cyl(x, 0.8, z, 0.26, 1.0, 'stone_wall', { seg: 10, r1: 0.2, tint: '#e6dcc8', minimap: false });
  b.cyl(x, 1.8, z, 0.25, 0.22, 'stone_wall', { seg: 12, r1: 1.0, tint: '#e6dcc8', collide: false, minimap: false });
  b.cyl(x, 2.02, z, 1.02, 0.1, 'stone_wall', { seg: 12, tint: '#d9ccb2', collide: false, minimap: false });
  b.cyl(x, 2.12, z, 0.92, 0.02, 'glass', { seg: 12, tint: '#5a8a8a', collide: false, minimap: false, ao: false });
  b.cyl(x, 2.1, z, 0.12, 0.7, 'stone_wall', { seg: 8, tint: '#e6dcc8', collide: false, minimap: false });
  b.geom(sphereGeom(), x, 2.95, z, 'stone_wall', { sx: 0.22, sy: 0.26, sz: 0.22, tint: '#e6dcc8', collide: false, minimap: false, ao: false });
  // Wasserspeier
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    b.cyl(x + Math.cos(a) * 0.75, 1.15, z + Math.sin(a) * 0.75, 0.025, 0.9, 'glass', { seg: 5, collide: false, minimap: false, ao: false, tint: '#b8d8d8', bullet: false, cast: false });
  }
  b.navPoint(x + 3.2, 0.2, z); b.navPoint(x - 3.2, 0.2, z); b.navPoint(x, 0.2, z + 3.2); b.navPoint(x, 0.2, z - 3.2);
}

// ---------------------------------------------------------------------------
// Kirche Sant Aurel (x 19..31, z −8..8), begehbar, Boden auf 0,36 m
// ---------------------------------------------------------------------------
function church(b) {
  const x0 = 19, x1 = 31, z0 = -8, z1 = 8, t = 0.6, H = 9.4, fy = 0.36;
  const mat = 'stone_wall', tint = '#eadfc8';
  b.interior(x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05, -0.1, H, 0.62, [1, 0.92, 0.8]);
  // Boden (Schachbrett-Fliesen) + Sockel
  b.boxMM(x0 + t, 0, z0 + t, x1 - t, fy, z1 - t, 'tiles_pattern', { grad: false, minimap: false, tint: '#efe8da' });
  const wl = { h: H, t, mat, tint, frameMat: 'stone_wall', frameTint: '#d8c9ab', sillMat: 'stone_wall', minimap: 'wall', plinth: { h: 0.9, mat: 'stone_wall', tint: '#cdbf9f', over: 0.05 } };
  const tallWin = at => ({ at, w: 1.15, h: 3.4, kind: 'window', sill: 3.2, glass: true, frame: true, mullion: true });
  // Westfassade (zum Platz): Hauptportal
  wall(b, { ...wl, x0: x0 + t / 2, z0: z1, x1: x0 + t / 2, z1: z0, openings: [{ at: 8, w: 2.6, h: 4.6, kind: 'door', sill: 0, frame: false }] });
  // Nord + Süd: Seitentür und hohe Fenster
  wall(b, { ...wl, x0, z0: z0 + t / 2, x1, z1: z0 + t / 2, openings: [tallWin(3.4), tallWin(6.4), { at: 9.2, w: 1.4, h: 2.7, kind: 'door', sill: 0, frame: true }] });
  wall(b, { ...wl, x0: x1, z0: z1 - t / 2, x1: x0, z1: z1 - t / 2, openings: [tallWin(8.6), tallWin(5.6), { at: 2.8, w: 1.4, h: 2.7, kind: 'door', sill: 0, frame: true }] });
  // Ostwand: Tür zur Gasse
  wall(b, { ...wl, x0: x1 - t / 2, z0, x1: x1 - t / 2, z1, openings: [{ at: 8, w: 1.5, h: 2.8, kind: 'door', sill: 0, frame: true }, { at: 8, w: 1.2, h: 1.6, kind: 'window', sill: 5.6, glass: true }] });
  // Bögen über Portal + Seitentüren
  arch(b, x0 + t / 2, 3.4, 0, 2.6, 1.2, 1.2, t + 0.04, mat, { ry: Math.PI / 2, tint: '#d8c9ab' });
  // Portalgewände
  for (const s of [-1, 1]) {
    b.box(x0 - 0.12, 0, s * 1.65, 0.36, 4.7, 0.5, 'stone_wall', { tint: '#d0c09e', minimap: false, grad: false });
    b.cyl(x0 - 0.18, 0, s * 1.65, 0.16, 4.4, 'stone_wall', { tint: '#e6dcc8', seg: 10, collide: false, minimap: false });
  }
  b.box(x0 - 0.16, 4.7, 0, 0.44, 0.35, 3.9, 'stone_wall', { tint: '#d0c09e', collide: false, minimap: false, grad: false });
  // Portaltüren (offen nach innen)
  for (const s of [-1, 1]) b.box(x0 + t + 0.6, fy, s * 1.22, 1.2, 4.2, 0.08, 'wood_dark', { tint: '#5a3a24', minimap: false, grad: false, ry: s * 0.25 });
  // Freitreppe zum Platz
  for (let i = 0; i < 3; i++) b.boxMM(x0 - 2.4 + i * 0.8, 0, -3.6, x0, (i + 1) * 0.12, 3.6, 'stone_wall', { tint: '#e2d6bd', minimap: i === 0 ? 'stairs' : false, grad: false });
  // Stufen + Schwellen an Seiten- und Osttür, Schwelle am Portal
  for (const s of [-1, 1]) {
    b.boxMM(27.3, 0, s > 0 ? z1 : z0 - 0.9, 29.1, 0.18, s > 0 ? z1 + 0.9 : z0, 'stone_wall', { tint: '#e2d6bd', minimap: false, grad: false });
    b.boxMM(27.3, 0, s > 0 ? z1 : z0 - 0.45, 29.1, 0.36, s > 0 ? z1 + 0.45 : z0, 'stone_wall', { tint: '#e2d6bd', minimap: false, grad: false });
    b.boxMM(27.45, 0, s > 0 ? z1 - t : z0, 28.95, fy, s > 0 ? z1 : z0 + t, 'stone_wall', { tint: '#e2d6bd', minimap: false, grad: false });
  }
  b.boxMM(x0, 0, -1.3, x0 + t, fy, 1.3, 'stone_wall', { tint: '#e2d6bd', minimap: false, grad: false });
  b.boxMM(x1 - t, 0, -0.75, x1, fy, 0.75, 'stone_wall', { tint: '#e2d6bd', minimap: false, grad: false });
  b.boxMM(x1, 0, -1.2, x1 + 0.9, 0.18, 1.2, 'stone_wall', { tint: '#e2d6bd', minimap: false, grad: false });
  b.boxMM(x1, 0, -1.2, x1 + 0.45, 0.36, 1.2, 'stone_wall', { tint: '#e2d6bd', minimap: false, grad: false });
  // Fassade: Giebel mit Rosette + Gesims
  const rise = 3.4;
  b.wedge(x0 + t / 2, H, z0 + 4, t, rise, 8, mat, { tint, uv: 'world', minimap: false });
  b.wedge(x0 + t / 2, H, z1 - 4, t, rise, 8, mat, { ry: Math.PI, tint, uv: 'world', minimap: false });
  b.wedge(x1 - t / 2, H, z0 + 4, t, rise, 8, mat, { tint, uv: 'world', minimap: false });
  b.wedge(x1 - t / 2, H, z1 - 4, t, rise, 8, mat, { ry: Math.PI, tint, uv: 'world', minimap: false });
  b.box(x0 - 0.05, H - 0.05, 0, 0.7, 0.3, 16.6, 'stone_wall', { tint: '#d0c09e', collide: false, minimap: false, grad: false });
  b.cyl(x0 - 0.02, 7.0, 0, 1.45, 0.3, 'stone_wall', { axis: 'x', tint: '#d0c09e', collide: false, minimap: false, seg: 20 });
  b.cyl(x0 - 0.06, 7.0, 0, 1.2, 0.3, 'glass', { axis: 'x', tint: '#7a8fb0', collide: false, minimap: false, seg: 20 });
  for (let i = 0; i < 8; i++) b.box(x0 - 0.2, 7.0, 0, 0.05, 0.06, 2.4, 'stone_wall', { rx: (i * Math.PI) / 8, tint: '#d0c09e', collide: false, minimap: false, grad: false, uv: 'local', ao: false });
  b.sign(x0 - 0.03, 5.25, 0, 3.4, 0.7, 'church', { ry: -Math.PI / 2, back: false, depth: 0 });
  // Lisenen (Wandpfeiler) außen
  for (const xx of [23.9, 26.7, x1 - 0.3]) for (const zz of [z0 - 0.2, z1 + 0.2]) b.box(xx, 0, zz, 0.6, H, 0.4, 'stone_wall', { tint: '#ddd0b4', minimap: false, grad: false });
  // Dach
  pitchedRoof(b, { x: (x0 + x1) / 2, z: 0, w: x1 - x0, d: z1 - z0, y: H, ridge: 'x', pitch: rise / 8, over: 0.5, gableMat: mat, gableTint: tint, tint: '#c27154' });
  b.noNav(x0 - 1, z0 - 1, x1 + 1, z1 + 1, H - 1, 40);
  b.footprints.push({ x: (x0 + x1) / 2, z: 0, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, ry: 0, y0: 0, y1: H, kind: 'building' });
  // Innen: Holzdecke mit Balken
  b.boxMM(x0 + t, H - 0.25, z0 + t, x1 - t, H, z1 - t, 'wood_dark', { tint: '#7a5a40', collide: false, minimap: false, grad: false });
  for (let xx = x0 + 1.6; xx < x1 - 0.5; xx += 2.2) b.box(xx, H - 0.55, 0, 0.3, 0.3, z1 - z0 - t * 2, 'wood_dark', { tint: '#5a4030', collide: false, minimap: false, grad: false });
  // Säulen
  for (const xx of [22.4, 26.4]) for (const zz of [-4.2, 4.2]) {
    b.box(xx, fy, zz, 0.75, 0.3, 0.75, 'stone_wall', { tint: '#d8c9ab', minimap: false, grad: false });
    b.cyl(xx, fy + 0.3, zz, 0.3, H - fy - 0.9, 'stone_wall', { tint: '#e6dcc8', seg: 12, minimap: 'pillar' });
    b.box(xx, H - 0.6, zz, 0.75, 0.35, 0.75, 'stone_wall', { tint: '#d8c9ab', collide: false, minimap: false, grad: false });
  }
  // Bänke (Deckung)
  for (let xx = 21.0; xx <= 27.8; xx += 1.35) for (const zz of [-2.35, 2.35]) pew(b, xx, zz, fy);
  // Altarraum
  b.boxMM(28.6, fy, -4.6, x1 - t, fy + 0.3, 4.6, 'stone_wall', { tint: '#e6dcc8', minimap: 'cover', grad: false });
  b.boxMM(28.3, fy, -4.6, 28.6, fy + 0.15, 4.6, 'stone_wall', { tint: '#e6dcc8', minimap: false, grad: false });
  b.box(29.6, fy + 0.3, 0, 1.0, 0.95, 2.4, 'stone_wall', { tint: '#efe8da', minimap: 'cover' });
  b.box(29.6, fy + 1.25, 0, 1.15, 0.04, 2.6, 'tarp', { tint: '#f4f0e6', collide: false, minimap: false, grad: false });
  b.box(29.62, fy + 0.6, 0, 1.05, 0.5, 2.0, 'tarp', { tint: '#9a2a2a', collide: false, minimap: false, grad: false, ao: false });
  for (const zz of [-0.9, 0.9]) { b.cyl(29.6, fy + 1.29, zz, 0.05, 0.4, 'white', { seg: 6, collide: false, minimap: false, ao: false }); b.cyl(29.6, fy + 1.69, zz, 0.03, 0.06, 'lamp_warm', { seg: 5, collide: false, minimap: false, ao: false, cast: false }); }
  // Altarbild (Rahmen + Fläche)
  b.box(x1 - t - 0.05, 2.0, 0, 0.1, 4.2, 4.4, 'metal_painted', { tint: '#b08a3a', collide: false, minimap: false, grad: false });
  for (const [zz, w, h] of [[0, 1.8, 3.5], [-1.55, 1.1, 2.8], [1.55, 1.1, 2.8]]) b.box(x1 - t - 0.11, 2.3, zz, 0.04, h, w, 'tarp', { tint: zz ? '#7a3a2a' : '#2f4f7a', collide: false, minimap: false, grad: false, ao: false });
  // Kerzenständer
  for (const zz of [-3.4, 3.4]) {
    b.cyl(28.0, fy, zz, 0.18, 0.06, 'metal_painted', { tint: '#8a6a2a', seg: 8, collide: false, minimap: false });
    b.cyl(28.0, fy, zz, 0.04, 1.2, 'metal_painted', { tint: '#8a6a2a', seg: 6, collide: false, minimap: false });
    b.cyl(28.0, fy + 1.2, zz, 0.3, 0.05, 'metal_painted', { tint: '#8a6a2a', seg: 10, collide: false, minimap: false });
    for (let k = 0; k < 5; k++) b.cyl(28.0 + Math.cos(k * 1.256) * 0.2, fy + 1.25, zz + Math.sin(k * 1.256) * 0.2, 0.025, 0.12, 'lamp_warm', { seg: 5, collide: false, minimap: false, ao: false, cast: false });
  }
  // Kronleuchter + Licht
  for (const xx of [22.4, 26.4]) {
    b.cyl(xx, 6.2, 0, 0.015, H - 6.6, 'metal_galvanized', { seg: 4, collide: false, minimap: false, ao: false });
    b.cyl(xx, 6.0, 0, 0.7, 0.08, 'metal_painted', { tint: '#6a5020', seg: 12, collide: false, minimap: false, ao: false });
    for (let k = 0; k < 8; k++) b.cyl(xx + Math.cos(k * 0.785) * 0.65, 6.08, Math.sin(k * 0.785) * 0.65, 0.03, 0.14, 'lamp_warm', { seg: 5, collide: false, minimap: false, ao: false, cast: false });
  }
  b.light('point', 24.5, 5.5, 0, { color: '#ffcf8a', intensity: 34, distance: 17, priority: 2 });
  // Weihwasserbecken, Opferkerzen
  for (const s of [-1, 1]) b.cyl(x0 + t + 0.4, fy, s * 2.0, 0.25, 0.95, 'stone_wall', { r1: 0.32, tint: '#efe8da', seg: 10, minimap: 'prop' });
  b.box(21.0, fy, -6.9, 1.6, 0.9, 0.5, 'metal_painted', { tint: '#3a3428', minimap: 'cover' });
  for (let k = 0; k < 12; k++) b.cyl(20.4 + (k % 6) * 0.22, fy + 0.92, -6.8 + Math.floor(k / 6) * 0.2, 0.025, 0.08, 'lamp_warm', { seg: 5, collide: false, minimap: false, ao: false, cast: false });
  b.navPoint(x0 - 1.2, 0.3, 0); b.navPoint(x0 + 1.5, fy + 0.2, 0);
}

function pew(b, x, z, y) {
  const f = frame(b, x, y, z, 0);
  f.box(0, 0.42, 0, 0.42, 0.05, 3.3, 'wood_planks', { tint: '#b08058', collide: false, minimap: false, grad: false });
  f.box(0.22, 0.42, 0, 0.06, 0.55, 3.3, 'wood_planks', { tint: '#a07050', collide: false, minimap: false, grad: false });
  for (const zz of [-1.6, 1.6]) f.box(0.05, 0, zz, 0.5, 0.95, 0.06, 'wood_planks', { tint: '#946848', collide: false, minimap: false });
  f.solid(0.05, 0, 0, 0.5, 0.95, 3.3, { minimap: 'cover' });
}

// ---------------------------------------------------------------------------
// Glockenturm (Nordostecke des Platzes) mit Durchgang im Erdgeschoss
// ---------------------------------------------------------------------------
function bellTower(b, x0, z0, x1, z1) {
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const H = 16, BH = 3.6, mat = 'stone_wall', tint = '#e4d7bc', dark = '#cdbd9c';
  const pw = 1.25; // halbe Durchgangsbreite
  b.boxMM(x0, 0, z0, x1, 3.6, z - pw, mat, { tint, minimap: 'building' });
  b.boxMM(x0, 0, z + pw, x1, 3.6, z1, mat, { tint, minimap: 'building' });
  b.boxMM(x0, 3.6, z0, x1, H, z1, mat, { tint, minimap: 'building', grad: false });
  for (const xx of [x0 + 0.2, x1 - 0.2]) arch(b, xx, 2.6, z, pw * 2, 1.0, 1.0, 0.4, mat, { ry: Math.PI / 2, tint: dark });
  b.boxMM(x0 + 0.05, 3.55, z - pw, x1 - 0.05, 3.6, z + pw, 'wood_dark', { tint: '#5a4030', collide: false, minimap: false, grad: false });
  b.interior(x0, z - pw, x1, z + pw, -0.1, 3.6, 0.55);
  // Gesimse
  for (const yy of [3.6, 8.6, 12.4]) b.boxMM(x0 - 0.12, yy, z0 - 0.12, x1 + 0.12, yy + 0.22, z1 + 0.12, mat, { tint: dark, collide: false, minimap: false, grad: false });
  // Ecklisenen
  for (const sx of [x0, x1]) for (const sz of [z0, z1]) b.box(sx, 0, sz, 0.5, H, 0.5, mat, { tint: dark, collide: false, minimap: false, grad: false });
  // kleine Schießscharten-Fenster
  for (const yy of [6, 10.2]) {
    b.box(x0 - 0.01, yy, z, 0.04, 1.0, 0.35, 'black', { collide: false, minimap: false, ao: false });
    b.box(x, yy, z1 + 0.01, 0.35, 1.0, 0.04, 'black', { collide: false, minimap: false, ao: false });
  }
  // Uhr (West- und Südseite)
  clockFace(b, x0 - 0.06, 13.9, z, -Math.PI / 2);
  clockFace(b, x, 13.9, z1 + 0.06, 0);
  b.boxMM(x0 - 0.15, H, z0 - 0.15, x1 + 0.15, H + 0.3, z1 + 0.15, mat, { tint: dark, collide: false, minimap: false, grad: false });
  // Glockenstube: Eckpfeiler + Bögen
  const y = H + 0.3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(x + sx * (w / 2 - 0.45), y, z + sz * (d / 2 - 0.45), 0.9, BH, 0.9, mat, { tint, collide: false, minimap: false, grad: false });
  for (const [ax, az, ry, span] of [[x0 + 0.3, z, Math.PI / 2, d - 1.8], [x1 - 0.3, z, Math.PI / 2, d - 1.8], [x, z0 + 0.3, 0, w - 1.8], [x, z1 - 0.3, 0, w - 1.8]]) {
    arch(b, ax, y + BH - 1.5, az, span, 1.0, 1.5, 0.6, mat, { ry, tint, collide: false });
    b.box(ax, y, az, ry ? 0.6 : span, 0.9, ry ? span : 0.6, mat, { tint: dark, collide: false, minimap: false, grad: false });
  }
  b.boxMM(x0 + 0.3, y, z0 + 0.3, x1 - 0.3, y + 0.1, z1 - 0.3, 'wood_dark', { tint: '#5a4030', collide: false, minimap: false, grad: false });
  // Glocke
  b.box(x, y + BH - 0.5, z, 3.0, 0.22, 0.22, 'wood_dark', { tint: '#4a3426', collide: false, minimap: false, grad: false });
  b.cyl(x, y + 1.35, z, 0.75, 1.5, 'metal_painted', { r1: 0.4, tint: '#9a7a3a', seg: 16, collide: false, minimap: false });
  b.cyl(x, y + 1.25, z, 0.82, 0.14, 'metal_painted', { tint: '#8a6a2a', seg: 16, collide: false, minimap: false });
  // Dach: Pyramide + Kreuzblume
  b.boxMM(x0 - 0.25, y + BH, z0 - 0.25, x1 + 0.25, y + BH + 0.35, z1 + 0.25, mat, { tint: dark, collide: false, minimap: false, grad: false });
  b.cyl(x, y + BH + 0.35, z, (w / 2 + 0.2) * Math.SQRT2, 4.2, 'roof_tiles', { r1: 0.05, seg: 4, ry: Math.PI / 4, tint: '#c27154', collide: false, minimap: false, uv: 'keep' });
  b.geom(sphereGeom(), x, y + BH + 4.6, z, 'metal_painted', { sx: 0.18, sy: 0.18, sz: 0.18, tint: '#b08a3a', collide: false, minimap: false, ao: false });
  b.cyl(x, y + BH + 4.6, z, 0.03, 1.1, 'metal_painted', { tint: '#b08a3a', seg: 5, collide: false, minimap: false, ao: false });
  b.noNav(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, 3.0, 40);
  b.navPoint(x0 - 1.0, 0.2, z); b.navPoint(x, 0.2, z); b.navPoint(x1 + 1.0, 0.2, z);
}

function clockFace(b, x, y, z, ry) {
  const f = frame(b, x, y, z, ry);
  f.cyl(0, 0, 0.02, 1.0, 0.08, 'stone_wall', { axis: 'z', tint: '#c9b893', collide: false, minimap: false, seg: 24 });
  f.cyl(0, 0, 0.07, 0.85, 0.04, 'white', { axis: 'z', tint: '#f4efe2', collide: false, minimap: false, seg: 24 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    f.box(Math.sin(a) * 0.7, Math.cos(a) * 0.7 - 0.06, 0.1, 0.05, 0.12, 0.01, 'black', { rz: -a, collide: false, minimap: false, ao: false, grad: false });
  }
  // Zeiger: 12:10 Uhr (Mittag)
  f.box(0.05, -0.02, 0.11, 0.06, 0.6, 0.015, 'black', { rz: -0.1, collide: false, minimap: false, ao: false, grad: false });
  f.box(0.1, -0.02, 0.12, 0.05, 0.45, 0.015, 'black', { rz: -1.05, collide: false, minimap: false, ao: false, grad: false });
}

// ---------------------------------------------------------------------------
// Loggia (Südostecke des Platzes): offene Bogenhalle, durchgängig begehbar
// ---------------------------------------------------------------------------
function loggia(b, x0, z0, x1, z1) {
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2, H = 3.9, mat = 'stone_wall', tint = '#e6dac2';
  b.boxMM(x0 + 0.1, 0, z0 + 0.1, x1 - 0.1, 0.1, z1 - 0.1, 'paving', { tint: '#e2d8c4', minimap: false, grad: false });
  const cols = [[x0 + 0.35, z0 + 0.35], [x1 - 0.35, z0 + 0.35], [x0 + 0.35, z1 - 0.35], [x1 - 0.35, z1 - 0.35]];
  for (const [cx, cz] of cols) {
    b.box(cx, 0, cz, 0.6, 0.35, 0.6, mat, { tint: '#d6c8aa', minimap: 'pillar' });
    b.cyl(cx, 0.35, cz, 0.24, H - 0.75, mat, { tint, seg: 12, minimap: false });
    b.box(cx, H - 0.4, cz, 0.62, 0.4, 0.62, mat, { tint: '#d6c8aa', collide: false, minimap: false, grad: false });
  }
  const spanX = x1 - x0 - 0.7, spanZ = z1 - z0 - 0.7;
  for (const zz of [z0 + 0.35, z1 - 0.35]) arch(b, x, H - 1.1, zz, spanX - 0.6, 0.9, 1.1, 0.5, mat, { tint });
  for (const xx of [x0 + 0.35, x1 - 0.35]) arch(b, xx, H - 1.1, z, spanZ - 0.6, 0.9, 1.1, 0.5, mat, { ry: Math.PI / 2, tint });
  b.boxMM(x0, H, z0, x1, H + 0.6, z1, mat, { tint, minimap: 'roof', grad: false });
  b.boxMM(x0 - 0.12, H + 0.6, z0 - 0.12, x1 + 0.12, H + 0.8, z1 + 0.12, mat, { tint: '#d6c8aa', collide: false, minimap: false, grad: false });
  pitchedRoof(b, { x, z, w: x1 - x0, d: z1 - z0, y: H + 0.8, ridge: 'z', pitch: 0.35, over: 0.3, gableMat: mat, gableTint: tint, tint: '#c47a5a' });
  b.interior(x0, z0, x1, z1, -0.1, H, 0.8);
  b.noNav(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, 2.5, 40);
  bench(b, x, z + 1.4, { ry: Math.PI, back: true });
  b.decal(x, 0.11, z - 0.8, 1.6, 1.6, 'leaves', { opacity: 0.9 });
}

// ---------------------------------------------------------------------------
// Torhaus (Westmitte): Durchgang Markt ↔ Platz
// ---------------------------------------------------------------------------
function torhaus(b) {
  const x0 = -27, x1 = -16, z0 = -7, z1 = 7;
  const M = mirror(1);
  const color = '#e9cfa6', shutter = '#2f6f9a';
  const h = house(b, M, {
    x0, x1, z0, z1, floors: 2, fh: 3.5, color, shutter, mat: 'plaster_warm', roof: 'pitched', ridge: 'z', closed: true, upperFloorMat: null,
    open: [
      { side: 'w', at: 0, w: 4, h: 3.3, kind: 'gap', frame: false },
      { side: 'e', at: 0, w: 4, h: 3.3, kind: 'gap', frame: false },
      { side: 'w', at: -4.6, w: 1.1, h: 1.3, kind: 'window', sill: 1.2, closed: true },
      { side: 'w', at: 4.6, w: 1.1, h: 1.3, kind: 'window', sill: 1.2, bars: true },
      { side: 'e', at: -4.6, w: 1.1, h: 1.3, kind: 'window', sill: 1.2, bars: true },
      { side: 'e', at: 4.6, w: 1.1, h: 1.3, kind: 'window', sill: 1.2, closed: true },
      { side: 'w', at: -3.8, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'w', at: 0, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
      { side: 'w', at: 3.8, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'e', at: -3.8, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'e', at: 0, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'e', at: 3.8, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
      { side: 'n', at: 0, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
      { side: 's', at: 0, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
    ],
  });
  // Durchgangswände + Gewölbe
  for (const zz of [-2.08, 2.08]) wall(b, { x0: x0 + 0.3, z0: zz, x1: x1 - 0.3, z1: zz, y: 0.12, h: 3.13, t: 0.16, mat: 'plaster_warm', tint: '#dcc6a0', minimap: false });
  b.boxMM(x0 + 0.3, 3.0, -2.0, x1 - 0.3, 3.25, 2.0, 'wood_dark', { tint: '#6a4a32', collide: false, minimap: false, grad: false });
  for (const xx of [x0 + 0.15, x1 - 0.15]) arch(b, xx, 2.25, 0, 4, 1.0, 1.0, 0.32, 'stone_wall', { ry: Math.PI / 2, tint: '#d8c9ab' });
  b.interior(x0 + 0.3, -2.0, x1 - 0.3, 2.0, -0.1, 3.3, 0.62);
  // nicht begehbare Räume ausschließen, Durchgang erlauben
  b.navExclude.pop();
  b.noNav(x0 + 0.1, z0 + 0.1, x1 - 0.1, -2.2, -1, 40);
  b.noNav(x0 + 0.1, 2.2, x1 - 0.1, z1 - 0.1, -1, 40);
  b.noNav(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, 3.0, 40);
  b.navLine(x0 - 1, 0.2, 0, x1 + 1, 0.2, 0, 1.2);
  // Laterne + Wappenschild im Durchgang
  wallLamp(b, x0 - 0.02, 3.2, -2.8, -Math.PI / 2);
  wallLamp(b, x1 + 0.02, 3.2, 2.8, Math.PI / 2);
  b.sign(x0 - 0.03, 2.85, 4.6, 1.5, 0.42, 'st_markt', { ry: -Math.PI / 2, depth: 0.02 });
  void h;
}

// ---------------------------------------------------------------------------
// Werkstatt (Ostrand, Mitte): eingeschossig, Flachdach (Absprung von den Dachterrassen)
// ---------------------------------------------------------------------------
function workshop(b) {
  const M = mirror(1);
  const h = house(b, M, {
    x0: 35, x1: 46, z0: -9, z1: 9, floors: 1, fh: 3.4, color: '#e8dccb', shutter: '#4f6f7a', mat: 'plaster_white', roof: 'terrace', parapet: 0.6,
    gaps: [{ side: 'w', a: -1.0, b: 1.0 }],
    floorMat: 'concrete', band: false,
    open: [
      { side: 'w', at: -4.5, w: 1.3, h: 2.4, kind: 'door' },
      { side: 'w', at: 4.5, w: 1.3, h: 2.4, kind: 'door' },
      { side: 'w', at: 0, w: 3.2, h: 1.2, kind: 'window', sill: 1.1, bars: true },
    ],
  });
  // Einrichtung: Werkbänke, Mopeds, Reifen
  for (const [zz, ry] of [[-6.6, 0], [6.6, Math.PI]]) {
    b.box(43.5, 0.12, zz, 3.4, 0.9, 0.9, 'wood_planks', { tint: '#8a6a4a', minimap: 'cover', ry });
    b.box(43.5, 1.02, zz, 3.2, 0.5, 0.4, 'metal_painted', { tint: '#c8402f', collide: false, minimap: false, grad: false });
  }
  for (const [xx, zz, ry, c] of [[39.5, -2.6, 0.4, '#c8402f'], [41.2, 2.2, -0.3, '#2f6f9a']]) scooter(b, xx, zz, ry, c);
  crateStack(b, 44.6, -1.2, { ry: 0.1, y: 0.12, pattern: [[0, 0, 0, 1.0], [0, 0, 1.05, 0.9], [0, 1, 0.5, 0.8]] });
  barrelGroup(b, 37.2, 6.9, { n: 3, y: 0.12, colors: ['#c8402f', '#3a6f8a'] });
  b.sign(34.97, 2.75, 0, 3.2, 0.7, 'werkstatt', { ry: -Math.PI / 2, depth: 0.03 });
  b.light('point', 41, 2.7, 0, { color: '#ffe2b0', intensity: 10, distance: 10 });
  b.box(41, 3.08, 0, 1.4, 0.06, 0.25, 'lamp_warm', { collide: false, minimap: false, ao: false, cast: false });
  // Dach: Solarwarmwasser, Wassertank
  waterTank(b, 43.5, 3.425, -5);
  waterTank(b, 43.5, 3.425, 5);
  void h;
}

function scooter(b, x, z, ry, color) {
  const f = frame(b, x, 0.12, z, ry);
  f.cyl(0, 0.24, 0.62, 0.22, 0.1, 'rubber', { axis: 'x', collide: false, minimap: false, seg: 12 });
  f.cyl(0, 0.24, -0.6, 0.22, 0.1, 'rubber', { axis: 'x', collide: false, minimap: false, seg: 12 });
  f.box(0, 0.3, -0.25, 0.38, 0.45, 0.8, 'metal_painted', { tint: color, collide: false, minimap: false, grad: false });
  f.box(0, 0.75, -0.3, 0.32, 0.12, 0.6, 'rubber', { collide: false, minimap: false, grad: false });
  f.box(0, 0.25, 0.45, 0.3, 0.9, 0.12, 'metal_painted', { tint: color, collide: false, minimap: false, grad: false, rx: 0.25 });
  f.box(0, 1.1, 0.55, 0.62, 0.04, 0.04, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false });
  f.solid(0, 0, 0, 0.6, 1.0, 1.6, { minimap: 'prop' });
}

function waterTank(b, x, y, z) {
  for (const sx of [-0.5, 0.5]) b.box(x + sx, y, z, 0.12, 0.6, 1.4, 'metal_painted', { tint: IRON, collide: false, minimap: false });
  b.cyl(x, y + 1.15, z, 0.55, 1.8, 'white', { axis: 'x', tint: '#e8e2d4', minimap: false });
  b.box(x - 0.5, y + 0.4, z + 1.0, 1.6, 0.04, 1.0, 'glass', { rx: -0.6, tint: '#2a3a5a', collide: false, minimap: false, ao: false });
}

// ---------------------------------------------------------------------------
// Eine Hälfte (Süd: s = 1 / Nord: s = −1)
// ---------------------------------------------------------------------------
function half(b, M) {
  const s = M.s, south = s > 0;
  const Z = M.z;

  // ===== Westrand (x −46..−38): Häuserzeile zur Marktgasse ===================
  const pw1 = house(b, M, {
    x0: -46, x1: -38, z0: 7, z1: 16, floors: 3, closed: true, roof: south ? 'pitched' : 'flat', ridge: 'z',
    open: [
      { side: 'e', at: -2, w: 2.4, h: 2.4, kind: 'window', sill: 0.3, closed: '#8a8f94' },
      { side: 'e', at: 2.4, w: 1.1, h: 2.3, kind: 'door', leaf: 'closed' },
      ...[-2.4, 2.4].flatMap(at => [1, 2].map(fl => ({ side: 'e', at, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: fl, shutters: b.rand() < 0.6 || undefined, closed: b.rand() < 0.4 || undefined, glass: true }))),
    ],
    balconies: [{ side: 'e', at: 0, floor: 1, w: 2.4 }],
  });
  if (south) b.sign(-37.97, 2.7, Z(9.5), 2.6, 0.6, 'tabak', { ry: Math.PI / 2, depth: 0.02 });
  house(b, M, {
    x0: -46, x1: -38, z0: 0.0, z1: 7, floors: 3, closed: true, roof: 'pitched', ridge: 'z', fh: 3.3,
    open: [
      { side: 'e', at: 0, w: 1.2, h: 2.3, kind: 'door', leaf: 'closed' },
      ...[1, 2].map(fl => ({ side: 'e', at: 0, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: fl, shutters: true, glass: true })),
    ],
  });
  // Laden (begehbar) mit Hinterzimmer
  const shop = house(b, M, {
    x0: -46, x1: -38, z0: 16, z1: 28, floors: 2, roof: 'pitched', ridge: 'z', upperClosed: true,
    open: [
      { side: 'e', at: 1.5, w: 2.6, h: 2.5, kind: 'door', frame: true },
      { side: 'e', at: -3.0, w: 2.0, h: 1.5, kind: 'window', sill: 0.9 },
      { side: 'e', at: -2.5, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'e', at: 2.6, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
    ],
    ac: [{ side: 'e', at: 0.2, y: 4.6 }],
  });
  wall(b, { x0: -42.4, z0: Z(16.3), x1: -42.4, z1: Z(27.7), y: 0.12, h: 2.85, t: 0.14, mat: 'plaster_white', tint: shop.color, minimap: false, openings: [{ at: 5.7, w: 1.0, h: 2.1, kind: 'door' }] });
  shopInterior(b, M, south ? 'spice' : 'tex');
  awning(b, -37.97, 3.0, Z(23.5), 4.0, 1.6, { ry: Math.PI / 2, design: south ? 0 : 2 });
  b.sign(-37.97, 3.35, Z(23.5), 2.8, 0.55, south ? 'shop_spice' : 'shop_tex', { ry: Math.PI / 2, depth: 0.02 });
  house(b, M, {
    x0: -46, x1: -38, z0: 28, z1: 42, floors: 3, closed: true, roof: south ? 'flat' : 'pitched', ridge: 'z', fh: 3.1,
    open: [
      { side: 'e', at: -3.5, w: 1.2, h: 2.3, kind: 'door', leaf: 'closed' },
      { side: 'e', at: 2.5, w: 2.6, h: 2.4, kind: 'window', sill: 0.3, closed: '#7a5a3a' },
      ...[-4, 0, 4].flatMap(at => [1, 2].map(fl => ({ side: 'e', at, w: 1.0, h: 1.5, kind: 'window', sill: 0.95, floor: fl, shutters: b.rand() < 0.7 || undefined, glass: true, closed: b.rand() < 0.3 || undefined }))),
    ],
    balconies: [{ side: 'e', at: 4, floor: 2, w: 1.8 }],
    vines: [{ side: 'e', at: -5.6, n: 4 }],
  });
  laundry(b, -38.1, 6.6, Z(33), -27.2, 6.4, Z(31.5), { n: 6 });

  // ===== Marktgasse (x −38..−27) ==========================================
  const goodsA = [['#e8862a', '#d43c2a', '#e6c53a'], ['#6aa53a', '#3a7a2a', '#d4e05a'], ['#8a3a7a', '#c8402f', '#e8862a'], ['#e6c53a', '#c9783a', '#a33a2a']];
  const stallsW = south ? [[5.5, 0], [19.0, 1], [33.5, 2]] : [[6.0, 3], [18.0, 0], [34.0, 1]];
  const stallsE = south ? [[9.6, 2], [27.0, 3], [37.8, 0]] : [[10.0, 1], [26.5, 2], [38.0, 3]];
  for (const [z, d] of stallsW) marketStall(b, -36.2, Z(z), { ry: Math.PI / 2, design: d, goods: goodsA[d], w: 2.6, d: 1.3 });
  for (const [z, d] of stallsE) marketStall(b, -29.0, Z(z), { ry: -Math.PI / 2, design: (d + 1) % 4, goods: goodsA[(d + 2) % 4], w: 2.6, d: 1.3 });
  // Sonnensegel quer über die Gasse
  const sails = south ? [[3.5, 0], [12.0, 1], [20.5, 3], [29.0, 2], [37.0, 1]] : [[3.5, 2], [12.0, 3], [20.5, 1], [29.0, 0], [37.0, 3]];
  for (const [z, d] of sails) sail(b, -32.5, 5.2 + (b.rand() - 0.5) * 0.3, Z(z), 10.2, 5.4, d, { sag: 0.55, ry: (b.rand() - 0.5) * 0.06 });
  handcart(b, -31.6, Z(15.6), south ? 0.25 : 2.9);
  basketRow(b, -30.0, Z(31.2), Math.PI / 2, 3);
  basketRow(b, -36.6, Z(12.6), Math.PI / 2, 2);
  crateStack(b, -34.6, Z(25.2), { ry: 0.2, pattern: [[0, 0, 0, 0.9], [0.95, 0, 0, 0.9], [0.45, 1, 0, 0.8]] });
  crateStack(b, -28.4, Z(16.4), { ry: -0.15, pattern: [[0, 0, 0, 0.8], [0, 1, 0, 0.7]] });
  if (south) trike(b, -33.2, Z(40.0), Math.PI * 0.95, '#3a7aa8');
  else trike(b, -31.4, Z(40.5), 0.15, '#c8402f');
  barrel(b, -37.2, 0, Z(24.6), { color: '#3a6f8a' }); barrel(b, -37.4, 0, Z(25.4), { color: '#8a3a2a' });
  for (let i = 0; i < 10; i++) {
    const x = b.rnd(-37, -28), z = Z(b.rnd(1, 41)), k = b.rand();
    b.decal(x, 0.012, z, b.rnd(0.6, 1.6), b.rnd(0.6, 1.6), k < 0.5 ? 'leaves' : k < 0.8 ? 'paper' : 'stain', { opacity: 0.85 });
  }
  b.decal(-32.4, 0.013, Z(23.5), 2.8, 1.8, 'puddle', { opacity: 0.8 });
  b.sign(-37.97, 2.6, Z(30.5), 1.5, 0.42, 'st_markt', { ry: Math.PI / 2, depth: 0.02 });

  // ===== Westmitte (x −27..−16) ==========================================
  // Haus WM1: begehbar, Türen zum Markt und zur Mitte, Innentreppe ins OG (Blick auf Markt + Platz)
  const wm1 = house(b, M, {
    x0: -27, x1: -16, z0: 7, z1: 19, floors: 2, roof: 'pitched', ridge: 'z', color: south ? '#f0dcc2' : '#e2e6df',
    open: [
      { side: 'w', at: -0.5, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'e', at: -2.2, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'w', at: 3.6, w: 1.2, h: 1.4, kind: 'window', sill: 1.0, bars: true },
      { side: 'n', at: -2.0, w: 1.2, h: 1.4, kind: 'window', sill: 1.0, shutters: true },
      { side: 'w', at: -3.6, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'w', at: 1.4, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'e', at: -3.6, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'e', at: 1.0, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1 },
      { side: 'n', at: 1.6, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 's', at: -3.0, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1 },
    ],
    stairsIn: { x: -17.6, z: 18.1, dir: 'w', w: 1.1, open: 'right' },
    balconies: [{ side: 'e', at: 1.0, floor: 1, w: 2.0 }],
    ac: [{ side: 's', at: 2.2, y: 4.2 }],
  });
  // Möblierung WM1 (Wohnküche)
  {
    const [tx, tz] = [-22.5, Z(11.5)];
    b.box(tx, 0.12, tz, 1.8, 0.76, 0.95, 'wood_planks', { tint: '#9a7a52', minimap: 'cover' });
    for (const [cx, cz] of [[-0.6, -0.8], [0.6, -0.8], [-0.6, 0.8], [0.6, 0.8]]) chair(b, tx + cx, tz + cz * s, { y: 0.12, ry: cz * s > 0 ? Math.PI : 0, tint: '#7a5a3a' });
    b.box(-26.1, 0.12, Z(14.6), 1.1, 0.9, 2.6, 'wood_dark', { tint: '#7a5a40', minimap: 'cover' });
    b.box(-26.4, 1.5, Z(14.6), 0.5, 0.8, 2.4, 'wood_dark', { tint: '#7a5a40', minimap: false });
    b.box(-21, 3.2, Z(9.0), 2.0, 0.55, 0.9, 'tarp', { tint: '#c8b89a', minimap: 'cover' });
    b.box(-24.9, 3.2, Z(12.2), 1.0, 1.9, 0.5, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
    crateStack(b, -18.0, Z(9.2), { y: 3.2, ry: 0.3, pattern: [[0, 0, 0, 0.8], [0.85, 0, 0, 0.7]] });
  }
  // Gasse zwischen WM1 und WM2 (z 19..22.5): Wäsche, Kabel
  laundry(b, -26.8, 5.4, Z(19.1), -16.2, 5.6, Z(22.4), { n: 5 });
  cable(b, [-26.9, 6.0, Z(18.9)], [-16.1, 6.1, Z(22.6)], { sag: 0.4 });
  // Haus WM2: Dachterrasse über Außentreppe vom Hof
  const wm2 = house(b, M, {
    x0: -27, x1: -16, z0: 22.5, z1: 34, floors: 2, roof: 'terrace', color: south ? '#e7cba4' : '#f2e9d8', upperClosed: true,
    open: [
      { side: 'n', at: 1.5, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'e', at: -1.0, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'w', at: 2.0, w: 1.1, h: 1.4, kind: 'window', sill: 1.0, shutters: true, glass: true },
      { side: 'w', at: -3.0, w: 1.1, h: 2.3, kind: 'door', leaf: 'closed' },
      { side: 'w', at: -2.6, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'w', at: 2.4, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
      { side: 'e', at: 2.6, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'n', at: -2.5, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
    ],
    gaps: [{ side: 's', a: -26.95, b: -25.7 }],
    vines: [{ side: 'w', at: 4.6, n: 3 }],
  });
  // Erdgeschoss WM2: Lagerraum mit Kisten (Deckung)
  crateStack(b, -24.6, Z(26.0), { y: 0.12, ry: 0.15 });
  palletStackSmall(b, -18.4, Z(31.6));
  b.box(-25.8, 0.12, Z(31.8), 1.4, 1.2, 0.8, 'wood_planks', { tint: '#8a6a4a', minimap: 'cover' });
  extStairs(b, M, { x: -17.5, z: 34.75, dir: 'w', y1: wm2.roofY, w: 1.2, open: 'left', run: 8.2, wallGap: 0.15 });
  terraceDeco(b, M, wm2, { pots: [[-17.2, 23.4], [-26.2, 24.0]], laundry: [[-25.5, 26.5, -25.5, 31.5]], tank: [-17.8, 28.5], chairs: [[-20.5, 31.8]] });
  // Hof südlich von WM2 (x −27..−16, z 34..42): Mauer, Olivenbaum, Brunnentrog
  lowWall(b, -27, Z(37.5), -27, Z(42), { h: 1.1 });
  tree(b, -22.5, Z(39.4), { kind: 'olive', h: 2.8 });
  b.box(-19.2, 0, Z(40.2), 2.2, 0.7, 0.9, 'stone_wall', { tint: '#d8ccb2', minimap: 'cover' });
  b.box(-19.2, 0.62, Z(40.2), 1.9, 0.04, 0.6, 'glass', { tint: '#3a6a6a', collide: false, minimap: false, ao: false });
  pot(b, -26.3, 0, Z(36.6), { r: 0.32 }); pot(b, -24.2, 0, Z(41.3), { r: 0.28, plant: 'flowers' });

  // ===== Mitte Süd/Nord (x −16..15) ======================================
  // Café (Süd) / Pension (Nord) an der Platzkante
  const cw = house(b, M, {
    x0: -16, x1: -6, z0: 13, z1: 24, floors: 2, roof: 'pitched', ridge: 'x', color: south ? '#f4ede4' : '#ecd3c4', upperClosed: true,
    open: [
      { side: 'n', at: -2.6, w: 2.4, h: 2.5, kind: 'door', frame: true },
      { side: 'n', at: 2.2, w: 2.4, h: 1.6, kind: 'window', sill: 0.85 },
      { side: 'e', at: 2.6, w: 1.4, h: 2.4, kind: 'door' },
      { side: 's', at: -2.8, w: 1.2, h: 2.3, kind: 'door' },
      ...[-3.2, 0, 3.2].map(at => ({ side: 'n', at, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true })),
      { side: 'e', at: -2.5, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
      { side: 's', at: 2.0, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
    ],
    balconies: [{ side: 'n', at: 0, floor: 1, w: 2.0 }],
  });
  if (south) cafe(b, M, cw); else pension(b, M, cw);
  // Bäckerei (Süd) / Apotheke (Nord)
  const ce = house(b, M, {
    x0: 6, x1: 15, z0: 13, z1: 24, floors: 2, roof: 'pitched', ridge: 'z', color: south ? '#efe2c8' : '#e9c896', upperClosed: true,
    open: [
      { side: 'n', at: -1.8, w: 1.3, h: 2.4, kind: 'door' },
      { side: 'n', at: 2.0, w: 1.8, h: 1.5, kind: 'window', sill: 0.9 },
      { side: 'w', at: 3.6, w: 1.3, h: 2.4, kind: 'door' },
      { side: 'e', at: -1.0, w: 1.1, h: 1.3, kind: 'window', sill: 1.1, bars: true },
      ...[-2, 2].map(at => ({ side: 'n', at, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true })),
      { side: 'w', at: -2.6, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
      { side: 'e', at: 2.4, w: 1.1, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
    ],
    ac: [{ side: 'e', at: -3.5, y: 4.4, pipe: 2 }],
  });
  bakery(b, M, ce, south);
  // Häuser zwischen Platz A/C und Startbereich
  house(b, M, {
    x0: -16, x1: -6, z0: 34, z1: 42, floors: 2, closed: true, roof: 'pitched', ridge: 'x', fh: 3.0,
    open: [
      { side: 'n', at: -1.5, w: 1.2, h: 2.2, kind: 'door', leaf: 'closed' },
      { side: 'n', at: 2.5, w: 1.1, h: 1.3, kind: 'window', sill: 1.0, bars: true },
      { side: 's', at: 0, w: 1.1, h: 1.3, kind: 'window', sill: 1.0, closed: true },
      ...[-2.5, 2.5].map(at => ({ side: 'n', at, w: 1.0, h: 1.5, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true })),
      ...[-2.5, 2.5].map(at => ({ side: 's', at, w: 1.0, h: 1.5, kind: 'window', sill: 0.9, floor: 1, closed: true })),
    ],
    vines: [{ side: 'n', at: 4.2, n: 3 }],
  });
  house(b, M, {
    x0: 6, x1: 15, z0: 34, z1: 42, floors: 2, closed: true, roof: 'flat', fh: 3.0,
    open: [
      { side: 'n', at: 1.5, w: 1.2, h: 2.2, kind: 'door', leaf: 'closed' },
      { side: 'w', at: 0, w: 2.4, h: 2.3, kind: 'window', sill: 0.3, closed: '#6f7a80' },
      ...[-2.2, 2.2].map(at => ({ side: 'n', at, w: 1.0, h: 1.5, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true })),
      { side: 'w', at: 0, w: 1.0, h: 1.5, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
    ],
    ac: [{ side: 'w', at: 2.6, y: 3.9 }],
  });
  // Platz A / C (x −16..15, z 24..34): Deckung rund um die Flagge
  squareCover(b, M, south);
  // Mittelstraße zwischen Café und Bäckerei bzw. zum Startbereich
  for (const x of [-5.4, 5.4]) b.cyl(x, 0, Z(13.6), 0.16, 0.7, 'stone_wall', { r1: 0.12, tint: STONE, seg: 8, minimap: 'prop' });
  if (south) { scooter(b, 4.4, Z(17.5), 0.3, '#2f6f9a'); handcart(b, -3.6, Z(38.6), 0.15, { goods: ['#e6c53a', '#e8862a'] }); barrelGroup(b, 4.6, Z(36.4), { n: 3, colors: ['#3a6f8a', '#3a6f8a', '#8a3a2a'] }); }
  else { trike(b, 3.4, Z(19.0), Math.PI + 0.12, '#e8e4dc'); crateStack(b, -4.2, Z(37.6), { ry: 0.5 }); planter(b, 4.2, Z(38.2), 1.0, 2.4, { h: 0.75 }); }
  pot(b, -5.6, 0, Z(21.0), { r: 0.32 }); pot(b, 5.6, 0, Z(15.4), { r: 0.28, plant: 'flowers' });
  // Laternen + Straßenschilder
  lampPost(b, -6.4, Z(33.2), { h: 4.6, arm: 0.9, ry: s > 0 ? -Math.PI / 2 : -Math.PI / 2, kind: 'warm', tint: IRON });
  lampPost(b, 14.4, Z(25.0), { h: 4.6, arm: 0.9, ry: Math.PI, kind: 'warm', tint: IRON });

  // ===== Ostmitte (x 15..31) =============================================
  // EM1: begehbar mit Obergeschoss (Fenster zur Kirchgasse und Gasse)
  const em1 = house(b, M, {
    x0: 19, x1: 31, z0: 13, z1: 23, floors: 2, roof: 'pitched', ridge: 'x', color: south ? '#f1e4d0' : '#dfc7a6',
    open: [
      { side: 'w', at: -1.6, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'n', at: 3.0, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'e', at: 1.8, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'n', at: -2.4, w: 1.2, h: 1.4, kind: 'window', sill: 1.0, shutters: true },
      { side: 's', at: 0, w: 1.2, h: 1.4, kind: 'window', sill: 1.0, bars: true },
      { side: 'n', at: -3.6, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'n', at: 0.4, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1 },
      { side: 'n', at: 4.0, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'w', at: 0.6, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'e', at: -2.0, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 's', at: 3.5, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1 },
    ],
    stairsIn: { x: 29.4, z: 22.1, dir: 'w', w: 1.1, open: 'right' },
    vines: [{ side: 'w', at: 3.6, n: 3 }],
  });
  {
    b.box(23.0, 0.12, Z(16.4), 2.2, 0.76, 1.0, 'wood_planks', { tint: '#9a7a52', minimap: 'cover' });
    b.box(20.0, 0.12, Z(21.8), 1.1, 0.9, 1.9, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
    b.box(26.5, 3.2, Z(14.3), 2.4, 0.5, 1.0, 'tarp', { tint: '#b8a888', minimap: 'cover' });
    b.box(20.6, 3.2, Z(17.6), 0.6, 1.8, 1.4, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
    crateStack(b, 24.4, Z(20.4), { y: 3.2, ry: -0.2, pattern: [[0, 0, 0, 0.8], [0.85, 0, 0.05, 0.8]] });
  }
  // Gasse EM1/EM2 (z 23..26)
  laundry(b, 19.2, 5.2, Z(22.9), 30.8, 5.5, Z(26.1), { n: 6 });
  // EM2: Dachterrasse (Zugang über Bogenbrücke von EP2)
  const em2 = house(b, M, {
    x0: 19, x1: 31, z0: 26, z1: 38, floors: 2, roof: 'terrace', color: south ? '#ead3b0' : '#f0dcc2', upperClosed: true,
    open: [
      { side: 'n', at: -3.0, w: 1.2, h: 2.3, kind: 'door' },
      { side: 's', at: 2.6, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'w', at: 0, w: 1.2, h: 1.4, kind: 'window', sill: 1.0, shutters: true, glass: true },
      { side: 'e', at: -3.0, w: 1.1, h: 1.3, kind: 'window', sill: 1.1, bars: true },
      ...[-3.6, 0, 3.6].map(at => ({ side: 'w', at, w: 1.0, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true })),
      { side: 'n', at: 2.0, w: 1.0, h: 1.6, kind: 'window', sill: 0.9, floor: 1, closed: true },
      { side: 's', at: -2.0, w: 1.0, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true },
    ],
    gaps: [{ side: 'e', a: 29.3, b: 30.9 }],
  });
  b.box(24.0, 0.12, Z(31.5), 2.6, 0.8, 1.0, 'wood_planks', { tint: '#8a6a4a', minimap: 'cover' });
  b.box(29.6, 0.12, Z(28.0), 1.0, 1.6, 2.0, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
  terraceDeco(b, M, em2, { pots: [[19.9, 26.9], [30.1, 37.1], [19.9, 37.1]], parasol: [24.5, 33.5], chairs: [[23.4, 34.5], [25.6, 34.3]], laundry: [[21.0, 28.0, 21.0, 35.0]] });
  // Hof südlich EM2 (x 15..31, z 38..42)
  tree(b, 17.0, Z(40.0), { kind: 'olive', h: 2.6 });
  lowWall(b, 19.0, Z(39.6), 23.5, Z(39.6), { h: 0.95 });
  dumpster(b, 29.6, Z(40.3), { ry: Math.PI / 2, color: '#3a6a4a' });
  // Kirchgasse (z 8..13): Stufen, Bank, Wäsche
  wallLamp(b, 24.6, 3.0, Z(13) - 0.02 * M.s, M.ry(Math.PI));
  wallLamp(b, 20.6, 3.0, Z(8) + 0.02 * M.s, M.ry(0));
  b.sign(29.6, 2.6, Z(13) - 0.03 * M.s, 1.5, 0.42, 'st_kirche', { ry: M.ry(Math.PI), depth: 0.02 });
  crateStack(b, 22.0, Z(10.6), { ry: 0.4, pattern: [[0, 0, 0, 0.9], [0.95, 0, 0.1, 0.8]] });
  sandbags(b, 26.0, Z(10.2), 28.4, Z(10.6), { rows: 5 });

  // ===== Ostgasse (x 31..35) =============================================
  for (const z of [16, 28]) cable(b, [31.05, 5.6, Z(z)], [34.95, 5.8, Z(z + 1.5)], { sag: 0.3 });
  laundry(b, 31.1, 4.8, Z(35), 34.9, 4.9, Z(36.5), { n: 3 });
  b.box(33.9, 0, Z(18.8), 1.4, 1.1, 0.9, 'wood_crate', { uv: 'fit', minimap: 'cover' });
  barrelGroup(b, 32.2, Z(31.0), { n: 2, colors: ['#3a6f8a', '#8a3a2a'] });
  electricBox(b, 34.75, 0, Z(24.6), { ry: -Math.PI / 2, w: 0.8, h: 1.3, d: 0.4 });
  b.sign(34.97, 2.6, Z(38.6), 1.5, 0.42, 'st_dach', { ry: -Math.PI / 2, depth: 0.02 });
  for (const z of [11, 23, 35]) wallLamp(b, 34.98, 3.2, Z(z), -Math.PI / 2);
  for (let i = 0; i < 6; i++) b.decal(b.rnd(31.5, 34.5), 0.012, Z(b.rnd(10, 41)), b.rnd(0.8, 1.6), b.rnd(0.8, 1.6), b.pick(['leaves', 'stain', 'paper']), { opacity: 0.8 });

  // ===== Ostrand (x 35..46): Häuser mit verbundenen Dachterrassen =============
  const ep1 = house(b, M, {
    x0: 35, x1: 46, z0: 9, z1: 21, floors: 2, roof: 'terrace', color: south ? '#f2e9d8' : '#e7cba4',
    open: [
      { side: 'w', at: 1.5, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'w', at: -3.4, w: 1.2, h: 1.4, kind: 'window', sill: 1.0, shutters: true, glass: true },
      { side: 'w', at: -3.0, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'w', at: 2.6, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
      { side: 'n', at: -1.5, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1 },
      { side: 'n', at: 3.0, w: 1.1, h: 1.7, kind: 'window', sill: 0.85, floor: 1, shutters: true },
    ],
    stairsIn: { x: 44.4, z: 20.1, dir: 'w', w: 1.1, open: 'right' },
    gaps: [{ side: 's', a: 35.6, b: 45.4 }, { side: 'n', a: 40.0, b: 41.6 }],
  });
  {
    b.box(38.0, 0.12, Z(12.0), 1.0, 0.95, 2.2, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
    b.box(42.5, 0.12, Z(14.0), 1.8, 0.76, 1.0, 'wood_planks', { tint: '#9a7a52', minimap: 'cover' });
    b.box(39.5, 3.2, Z(12.4), 2.0, 0.55, 0.9, 'tarp', { tint: '#b8a888', minimap: 'cover' });
    b.box(44.6, 3.2, Z(11.0), 1.4, 1.8, 0.5, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
  }
  // Absprung-Kante zum Werkstattdach
  b.navPoint(40.8, 3.8, Z(7.6));
  const ep2 = house(b, M, {
    x0: 35, x1: 46, z0: 21, z1: 33, floors: 2, roof: 'terrace', color: south ? '#e2e6df' : '#efe2c8', upperClosed: true,
    open: [
      { side: 'w', at: -1.5, w: 1.2, h: 2.3, kind: 'door' },
      { side: 'w', at: 3.4, w: 1.2, h: 1.4, kind: 'window', sill: 1.0, bars: true },
      ...[-3.4, 1.6].map(at => ({ side: 'w', at, w: 1.0, h: 1.6, kind: 'window', sill: 0.9, floor: 1, shutters: true, glass: true })),
    ],
    gaps: [{ side: 'n', a: 35.6, b: 45.4 }, { side: 'w', a: 29.3, b: 30.9 }, { side: 's', a: 39.05, b: 40.35 }],
    ac: [{ side: 'w', at: 4.6, y: 5.2 }],
  });
  b.box(41.0, 0.12, Z(24.5), 2.6, 0.9, 1.0, 'wood_planks', { tint: '#8a6a4a', minimap: 'cover' });
  crateStack(b, 43.8, Z(30.6), { y: 0.12, ry: 0.2 });
  // EP3: eingeschossig, Dachterrasse per Außentreppe vom Startbereich
  const ep3 = house(b, M, {
    x0: 35, x1: 46, z0: 33, z1: 42, floors: 1, fh: 3.4, roof: 'terrace', color: south ? '#f0dcc2' : '#ecd3c4', closed: true,
    open: [
      { side: 'w', at: 0, w: 1.2, h: 2.3, kind: 'door', leaf: 'closed' },
      { side: 'w', at: 2.8, w: 1.1, h: 1.3, kind: 'window', sill: 1.0, closed: true },
      { side: 's', at: -3.6, w: 1.1, h: 1.3, kind: 'window', sill: 1.0, closed: true },
    ],
    gaps: [{ side: 's', a: 38.45, b: 39.75 }],
  });
  extStairs(b, M, { x: 44.6, z: 42.75, dir: 'w', y1: ep3.roofY, w: 1.2, open: 'left', run: 4.85, wallGap: 0.15 });
  // Treppe vom EP3-Dach aufs EP2-Dach (entlang der EP2-Südwand)
  extStairs(b, M, { x: 44.8, y0: ep3.roofY, z: 33.85, dir: 'w', y1: ep2.roofY, w: 1.2, open: 'left', run: 4.45, wallGap: 0.25 });
  // Bogenbrücke EM2 ↔ EP2
  roofBridge(b, M, 31.0, 35.0, 30.1, ep2.roofY);
  terraceDeco(b, M, ep1, { pots: [[45.2, 9.9]], tank: [44.4, 13.0], chairs: [[37.0, 15.0]], laundry: [[38.0, 18.0, 44.0, 18.0]] });
  terraceDeco(b, M, ep2, { pots: [[35.8, 32.2], [45.2, 22.0]], parasol: [42.0, 27.0], chairs: [[41.0, 28.0], [43.0, 26.2]] });
  terraceDeco(b, M, ep3, { pots: [[35.8, 41.2], [45.3, 37.0]], tank: [37.4, 37.2] });
  // Sandsack-Stellung auf EP1 (Deckung gegen das gegnerische Dach)
  sandbags(b, 36.4, Z(10.2), 39.2, Z(10.2), { rows: 4, y: ep1.roofY });

  // ===== Startbereich + Stadtmauer ===========================================
  cityWall(b, M);
  spawnDeco(b, M);
}

/** Kleiner Palettenstapel mit Säcken (für Innenräume). */
function palletStackSmall(b, x, z) {
  pallet(b, x, 0.12, z, { load: 'sacks', ry: 0.1 });
}

/** Dekoration einer Dachterrasse (Südkoordinaten). */
function terraceDeco(b, M, h, o) {
  const y = h.roofY + 0.025;
  for (const [x, z] of o.pots || []) pot(b, x, y, M.z(z), { r: 0.3, h: 0.5, plant: b.rand() < 0.4 ? 'flowers' : 'bush' });
  if (o.tank) waterTank(b, o.tank[0], y, M.z(o.tank[1]));
  if (o.parasol) parasol(b, o.parasol[0], M.z(o.parasol[1]), { y, r: 1.3, tint: b.pick(['#ffffff', '#f2e6d0']) });
  for (const [x, z] of o.chairs || []) chair(b, x, M.z(z), { y, ry: b.rand() * Math.PI * 2, tint: b.pick(['#2f6f9a', '#3c7a5a', '#c8402f']), model: true });
  for (const [ax, az, bx, bz] of o.laundry || []) {
    b.cyl(ax, y, M.z(az), 0.03, 1.9, 'metal_galvanized', { seg: 5, collide: false, minimap: false, ao: false });
    b.cyl(bx, y, M.z(bz), 0.03, 1.9, 'metal_galvanized', { seg: 5, collide: false, minimap: false, ao: false });
    laundry(b, ax, y + 1.85, M.z(az), bx, y + 1.85, M.z(bz), { n: 4 });
  }
  // Antennen + Satellitenschüssel
  const ax = h.x0 + 0.8, az = h.z0 + 0.8;
  b.cyl(ax, y, az, 0.025, 2.2, 'metal_galvanized', { seg: 5, collide: false, minimap: false, ao: false });
  b.box(ax, y + 1.9, az, 1.0, 0.03, 0.03, 'metal_galvanized', { collide: false, minimap: false, ao: false, ry: 0.4 });
}

/** Gemauerte Bogenbrücke zwischen zwei Dachterrassen über die Ostgasse. */
function roofBridge(b, M, x0, x1, zc, y) {
  const z = M.z(zc), w = 1.6;
  b.boxMM(x0 - 0.05, y - 0.5, z - w / 2, x1 + 0.05, y, z + w / 2, 'stone_wall', { tint: '#e2d6bd', minimap: 'catwalk', grad: false });
  b.boxMM(x0, y, z - w / 2 + 0.03, x1, y + 0.025, z + w / 2 - 0.03, 'tiles_terracotta', { tint: '#e2b9a0', collide: false, minimap: false, grad: false });
  arch(b, (x0 + x1) / 2, y - 1.6, z, x1 - x0, 1.0, 1.1, w, 'stone_wall', { tint: '#ddd0b4' });
  for (const sd of [-1, 1]) {
    b.boxMM(x0, y, z + sd * (w / 2) - (sd > 0 ? 0.2 : 0), x1, y + 0.95, z + sd * (w / 2) + (sd > 0 ? 0 : 0.2), 'plaster_white', { tint: '#efe6d4', minimap: false, grad: false });
    b.boxMM(x0 - 0.02, y + 0.95, z + sd * (w / 2) - (sd > 0 ? 0.24 : -0.04), x1 + 0.02, y + 1.02, z + sd * (w / 2) + (sd > 0 ? 0.04 : 0.24), 'plaster_white', { tint: '#f6f1e6', collide: false, minimap: false, grad: false });
  }
  b.navLine(x0 - 1.0, y + 0.2, z, x1 + 1.0, y + 0.2, z, 1.0);
  pot(b, x0 + 0.5, y, z + (w / 2 - 0.4), { r: 0.18, h: 0.3, collide: false, plant: 'flowers', s: 0.4 });
}

// --- Innenräume ----------------------------------------------------------------
function shopInterior(b, M, kind) {
  const Z = M.z;
  // Theke (vor der Trennwand) + Ware
  b.box(-41.0, 0.12, Z(18.9), 0.8, 0.95, 3.0, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
  b.box(-41.0, 1.07, Z(18.9), 0.85, 0.05, 3.1, 'stone_wall', { tint: '#e6dcc8', collide: false, minimap: false, grad: false });
  b.box(-41.0, 1.12, Z(18.2), 0.4, 0.25, 0.3, 'metal_galvanized', { collide: false, minimap: false, grad: false });
  // Regale an den Stirnwänden
  for (const zz of [16.65, 27.35]) {
    b.box(-40.4, 0.12, Z(zz), 3.0, 2.2, 0.5, 'wood_dark', { tint: '#7a5a40', minimap: 'cover' });
    for (let k = 0; k < 4; k++) for (let i = 0; i < 7; i++) b.box(-41.6 + i * 0.4, 0.5 + k * 0.48, Z(zz + (zz < 20 ? 0.3 : -0.3)), 0.28, 0.3, 0.18, kind === 'spice' ? 'cardboard' : 'tarp', { tint: b.pick(kind === 'spice' ? ['#c9783a', '#a33a2a', '#d9b04a', '#e6dcc8'] : ['#2f6f9a', '#c8402f', '#e0a32c', '#3c7a5a', '#efe6d4']), collide: false, minimap: false, grad: false, ao: false });
  }
  if (kind === 'spice') basketRow(b, -40.4, Z(25.6), 0, 3);
  else for (let i = 0; i < 3; i++) b.box(-40.4, 0.12 + i * 0.12, Z(25.6), 2.2, 0.12, 1.4, 'tarp', { tint: b.pick(['#9a2a2a', '#2a4a7a', '#c9a227']), minimap: i === 0 ? 'cover' : false, grad: false });
  // Hinterzimmer
  crateStack(b, -44.6, Z(19.0), { y: 0.12, ry: 0.1, pattern: [[0, 0, 0, 0.9], [0, 0, 1.0, 0.9], [0, 1, 0.5, 0.8]] });
  b.box(-44.8, 0.12, Z(25.6), 1.2, 0.9, 1.6, 'wood_planks', { tint: '#8a6a4a', minimap: 'cover' });
}

function cafe(b, M, h) {
  const Z = M.z;
  // Theke (L-Form) + Regal mit Flaschen
  b.box(-14.6, 0.12, Z(18.5), 1.0, 1.05, 5.2, 'wood_dark', { tint: '#5a3a24', minimap: 'cover' });
  b.box(-14.6, 1.17, Z(18.5), 1.1, 0.05, 5.3, 'stone_wall', { tint: '#efe8da', collide: false, minimap: false, grad: false });
  b.box(-12.6, 0.12, Z(21.4), 3.0, 1.05, 0.8, 'wood_dark', { tint: '#5a3a24', minimap: 'cover' });
  b.box(-15.55, 1.4, Z(18.5), 0.3, 1.4, 4.0, 'wood_dark', { tint: '#6a4a32', collide: false, minimap: false, grad: false });
  for (let i = 0; i < 18; i++) b.cyl(-15.5, 1.42 + Math.floor(i / 6) * 0.45, Z(16.8 + (i % 6) * 0.65), 0.05, 0.3, 'glass', { seg: 6, tint: b.pick(['#3a6a3a', '#7a3a2a', '#c9b48e', '#2a4a6a']), collide: false, minimap: false, ao: false });
  b.box(-14.6, 1.22, Z(17.2), 0.5, 0.4, 0.4, 'metal_galvanized', { collide: false, minimap: false, grad: false });
  // Tische drinnen
  for (const [x, z] of [[-10.6, 16.0], [-8.2, 19.6], [-11.2, 20.6]]) cafeTable(b, x, Z(z), { y: 0.12, chairs: 2, chairTint: '#2f2f2f' });
  b.sign(-11.0, 2.7, Z(13) - 0.03 * M.s, 3.6, 0.6, 'cafe', { ry: M.ry(Math.PI), depth: 0.03 });
  b.sign(-6.0 + 0.03, 1.2, Z(19.5), 0.9, 1.1, 'menu', { ry: Math.PI / 2, depth: 0.02 });
  b.light('point', -11.0, 2.6, Z(18.5), { color: '#ffd6a0', intensity: 9, distance: 9 });
  // Terrasse auf dem Platz mit Sonnenschirmen + Pflanzkübeln (Deckung)
  awning(b, -11.0, 3.0, Z(13.0) - 0.1 * M.s, 9.0, 2.6, { ry: M.ry(Math.PI), design: 1, drop: 0.6 });
  for (const [x, z] of [[-13.6, 10.6], [-10.2, 10.2], [-6.8, 10.8]]) cafeTable(b, x, Z(z), { chairs: 3, chairTint: '#2f6f9a', chairModel: true });
  parasol(b, -12.0, Z(8.6), { r: 1.5, tint: '#f2efe6' });
  planter(b, -15.0, Z(8.0), 0.9, 2.4, { h: 0.7 });
  planter(b, -8.4, Z(7.8), 2.6, 0.8, { h: 0.7 });
}

function pension(b, M, h) {
  const Z = M.z;
  b.box(-14.8, 0.12, Z(17.0), 0.9, 1.05, 3.0, 'wood_dark', { tint: '#4a3426', minimap: 'cover' });
  b.box(-15.6, 1.2, Z(17.0), 0.1, 1.2, 1.6, 'wood_dark', { tint: '#6a4a32', collide: false, minimap: false, grad: false });
  for (let i = 0; i < 8; i++) b.box(-15.54, 1.3 + Math.floor(i / 4) * 0.5, Z(16.4 + (i % 4) * 0.4), 0.02, 0.08, 0.05, 'metal_painted', { tint: '#b08a3a', collide: false, minimap: false, ao: false });
  b.box(-9.0, 0.12, Z(21.8), 2.6, 0.85, 0.9, 'tarp', { tint: '#8a4a3a', minimap: 'cover' });
  b.box(-11.2, 0.12, Z(16.5), 1.2, 0.5, 1.2, 'wood_planks', { tint: '#9a7a52', minimap: 'cover' });
  pot(b, -7.0, 0.12, Z(14.0), { r: 0.35, h: 0.6 });
  b.sign(-11.0, 2.7, Z(13) - 0.03 * M.s, 3.6, 0.6, 'pension', { ry: M.ry(Math.PI), depth: 0.03 });
  awning(b, -13.6, 2.9, Z(13.0) - 0.1 * M.s, 3.2, 1.4, { ry: M.ry(Math.PI), design: 2 });
  // Vorplatz: Zeitungskiosk + Moped + Kübel
  b.box(-12.4, 0, Z(9.4), 1.6, 2.2, 1.4, 'metal_painted', { tint: '#2f5f4a', minimap: 'cover' });
  b.box(-12.4, 2.2, Z(9.4), 2.0, 0.1, 1.8, 'metal_painted', { tint: '#1f3f30', collide: false, minimap: false, grad: false });
  b.sign(-12.4, 1.75, Z(9.4) + 0.71 * -M.s, 1.4, 0.35, 'tabak', { ry: M.ry(Math.PI), depth: 0.02 });
  scooter(b, -8.6, Z(10.4), 1.2, '#c8b23a');
  planter(b, -15.0, Z(8.0), 0.9, 2.4, { h: 0.7 });
  planter(b, -8.4, Z(7.4), 2.6, 0.8, { h: 0.7 });
}

function bakery(b, M, h, south) {
  const Z = M.z;
  b.box(10.0, 0.12, Z(16.6), 3.4, 1.0, 0.8, 'wood_dark', { tint: '#6a4a32', minimap: 'cover' });
  b.box(10.0, 1.12, Z(16.6), 3.5, 0.05, 0.9, 'stone_wall', { tint: '#efe8da', collide: false, minimap: false, grad: false });
  // Regal + Brote / Medizinschrank
  b.box(10.4, 0.12, Z(22.4), 4.2, 2.1, 0.6, 'wood_dark', { tint: '#7a5a40', minimap: 'cover' });
  for (let i = 0; i < 16; i++) b.geom(lowSphereGeom(), 8.6 + (i % 8) * 0.5, 0.75 + Math.floor(i / 8) * 0.6, Z(22.2), 'wood_crate', { sx: 0.2, sy: 0.12, sz: 0.14, tint: south ? '#c98a4a' : '#e8e4dc', collide: false, minimap: false, ao: false, bullet: false });
  if (south) {
    // Ofen
    b.box(13.8, 0.12, Z(19.0), 1.6, 1.8, 2.2, 'brick', { tint: '#c8a080', minimap: 'cover' });
    b.box(13.0, 0.7, Z(19.0), 0.05, 0.5, 0.9, 'black', { collide: false, minimap: false, ao: false });
    b.box(13.0, 0.75, Z(19.0), 0.06, 0.4, 0.8, 'lamp_sodium', { collide: false, minimap: false, ao: false, cast: false });
  } else b.box(13.6, 0.12, Z(19.0), 1.4, 1.0, 2.2, 'metal_painted', { tint: '#e8e8e2', minimap: 'cover' });
  b.sign(10.5, 2.7, Z(13) - 0.03 * M.s, 3.4, 0.6, south ? 'bakery' : 'pharmacy', { ry: M.ry(Math.PI), depth: 0.03 });
  awning(b, 8.6, 2.95, Z(13.0) - 0.1 * M.s, 3.2, 1.3, { ry: M.ry(Math.PI), design: south ? 3 : 1 });
  // Brotkörbe / Bank vor dem Laden
  if (south) basketRow(b, 13.6, Z(11.6), 0, 2);
  else bench(b, 12.6, Z(11.8), { ry: M.ry(Math.PI) });
  // N-S-Gasse x 15..19 (zwischen Laden und EM1)
  crateStack(b, 16.2, Z(19.5), { ry: 0.2, pattern: [[0, 0, 0, 0.9], [0, 1, 0, 0.8]] });
  pot(b, 18.4, 0, Z(14.6), { r: 0.3 });
}

/** Deckung auf Platz A (Süd) bzw. C (Nord). */
function squareCover(b, M, south) {
  const Z = M.z;
  // Ein ausgetrockneter Trog mit Statue, ein Auto, Sandsäcke, Kisten
  b.box(-11.6, 0, Z(28.4), 3.2, 0.85, 1.6, 'stone_wall', { tint: '#ddd0b4', minimap: 'cover' });
  b.box(-11.6, 0.85, Z(28.4), 3.4, 0.08, 1.8, 'plaster_white', { tint: '#f2ece0', collide: false, minimap: false, grad: false });
  b.box(-11.6, 0.93, Z(28.4), 0.7, 1.4, 0.7, 'stone_wall', { tint: '#e6dcc8', minimap: false });
  b.geom(sphereGeom(), -11.6, 2.55, Z(28.4), 'stone_wall', { sx: 0.32, sy: 0.32, sz: 0.32, tint: '#e6dcc8', collide: false, minimap: false, ao: false });
  if (south) car(b, 6.0, Z(29.6), { style: 'hatch', ry: Math.PI / 2 + 0.25, color: '#c9b48e' });
  else car(b, 7.0, Z(29.0), { style: 'wreck', ry: Math.PI / 2 - 0.4, color: '#8c2b24' });
  crateStack(b, 1.6, Z(25.4), { ry: south ? 0.3 : -0.4, pattern: [[0, 0, 0, 1.0], [1.05, 0, 0, 0.9]] });
  sandbags(b, -4.0, Z(33.0), -1.0, Z(33.0), { rows: 5 });
  sandbags(b, -15.6, Z(23.0), -15.6, Z(25.7), { rows: 4 });
  barrelGroup(b, 12.8, Z(32.4), { n: 3, colors: ['#8a3a2a', '#3a6f8a'] });
  planter(b, 3.4, Z(32.6), 2.4, 1.0, { h: 0.8 });
  palm(b, -14.6, Z(32.6), { h: 6.5 });
  for (let i = 0; i < 6; i++) b.decal(b.rnd(-15, 14), 0.012, Z(b.rnd(24.5, 33.5)), b.rnd(1, 2.5), b.rnd(1, 2.5), b.pick(['stain', 'leaves', 'cracks']), { opacity: 0.7 });
  b.decal(-5, 0.013, Z(29), 3.0, 2.0, 'sanddrift', { opacity: 0.6 });
}

// --- Stadtmauer + Startbereich -------------------------------------------------
function cityWall(b, M) {
  const s = M.s, Z = M.z, south = s > 0;
  const zc = Z(52.0), H = 7.2, t = 1.6, mat = 'stone_wall', tint = '#d9c9a8';
  const zi = zc - s * t / 2; // Innenkante
  // Mauer mit Tor (Mitte)
  const gw = 5.2;
  b.boxMM(-46, 0, Math.min(zc - t / 2, zc + t / 2), -gw / 2, H, Math.max(zc - t / 2, zc + t / 2), mat, { tint, minimap: 'wall' });
  b.boxMM(gw / 2, 0, Math.min(zc - t / 2, zc + t / 2), 46, H, Math.max(zc - t / 2, zc + t / 2), mat, { tint, minimap: 'wall' });
  b.boxMM(-gw / 2, 4.6, Math.min(zc - t / 2, zc + t / 2), gw / 2, H, Math.max(zc - t / 2, zc + t / 2), mat, { tint, minimap: 'wall' });
  arch(b, 0, 3.0, zi + s * 0.2, gw, 1.6, 1.6, 0.4, mat, { tint: '#cdbd9c' });
  // Torflügel (geschlossen) + Kollisionsriegel
  b.boxMM(-gw / 2, 0, zc - 0.1, gw / 2, 4.5, zc + 0.1, 'wood_dark', { tint: '#5a3a24', minimap: 'wall' });
  for (let i = 0; i < 6; i++) b.box(-gw / 2 + 0.45 + i * (gw - 0.9) / 5, 0.4, zc - s * 0.12, 0.08, 3.8, 0.04, 'metal_painted', { tint: IRON, collide: false, minimap: false, grad: false });
  // Zinnen + Wehrgang-Kante
  b.boxMM(-46, H, Math.min(zi, zi - s * 0.3), 46, H + 0.18, Math.max(zi, zi - s * 0.3), mat, { tint: '#cdbd9c', collide: false, minimap: false, grad: false });
  for (let x = -45; x <= 45; x += 1.8) b.box(x, H, zi + s * 0.15, 0.9, 0.9, 0.5, mat, { tint, collide: false, minimap: false, grad: false });
  // Seitenmauern am Startbereich
  for (const sx of [-1, 1]) b.boxMM(sx < 0 ? -46.6 : 45.4, 0, Math.min(Z(42), zc), sx < 0 ? -45.4 : 46.6, H, Math.max(Z(42), zc), mat, { tint, minimap: 'wall' });
  b.sign(0, 5.0, zi + s * 0.02, 4.4, 1.0, south ? 'gate_s' : 'gate_n', { ry: M.ry(Math.PI), back: false, depth: 0 });
  // Strebepfeiler + Wappen
  for (const x of [-30, -14, 14, 30]) b.box(x, 0, zi - s * 0.35, 1.2, 5.2, 0.7, mat, { tint: '#cdbd9c', minimap: 'cover' });
  // Kulisse jenseits der Mauer (Türme)
  for (const x of [-38, 38]) {
    b.cyl(x, 0, Z(55.5), 3.2, 11.5, mat, { tint, seg: 14, collide: false, minimap: false });
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; b.box(x + Math.cos(a) * 2.9, 11.5, Z(55.5) + Math.sin(a) * 2.9, 0.9, 0.9, 0.7, mat, { tint, collide: false, minimap: false, grad: false, ry: -a }); }
  }
}

function spawnDeco(b, M) {
  const Z = M.z, south = M.s > 0;
  if (south) {
    for (const x of [-34, -10, 10, 22]) palm(b, x, Z(50.4), { h: 6.5 + b.rand() * 1.5 });
    car(b, -20.5, Z(45.6), { style: 'sedan', ry: Math.PI / 2 + 0.05, color: '#2f4f6e' });
    jerseyLike(b, 8.4, Z(44.6), 0.2);
    crateStack(b, 33.5, Z(45.2), { ry: 0.4 });
    bench(b, -4.0, Z(50.4), { ry: M.ry(Math.PI) });
  } else {
    for (const x of [-26, -8, 8, 30]) tree(b, x, Z(50.4), { kind: 'olive', h: 2.8 });
    van(b, 20.5, Z(46.0), { ry: Math.PI / 2 - 0.05, color: '#e8e4dc' });
    jerseyLike(b, -9.0, Z(44.6), -0.2);
    crateStack(b, -33.5, Z(45.2), { ry: -0.4 });
    b.box(4.0, 0, Z(50.2), 2.4, 0.7, 0.9, 'stone_wall', { tint: '#d8ccb2', minimap: 'cover' });
  }
  for (let i = 0; i < 10; i++) b.decal(b.rnd(-42, 42), 0.012, Z(b.rnd(43, 50.5)), b.rnd(2, 4), b.rnd(1.5, 3), b.pick(['sanddrift', 'stain']), { opacity: 0.6 });
  // Sandsack-Deckungen an den Ausgängen (gegen Spawn-Beschuss)
  sandbags(b, -36.4, Z(43.4), -33.6, Z(43.4), { rows: 5 });
  sandbags(b, 31.6, Z(44.2), 34.2, Z(44.2), { rows: 5 });
}

function jerseyLike(b, x, z, ry) {
  // Steinbank / Pflanztrog als Deckung im Startbereich
  b.box(x, 0, z, 3.0, 0.8, 0.8, 'stone_wall', { ry, tint: '#ddd0b4', minimap: 'cover' });
  b.box(x, 0.8, z, 3.1, 0.06, 0.9, 'plaster_white', { ry, tint: '#f2ece0', collide: false, minimap: false, grad: false });
  const f = frame(b, x, 0.75, z, ry);
  for (const lx of [-1, 0, 1]) { const [px, pz] = f.P(lx, 0); b.plant('bush', px, 0.75, pz, { s: 0.7 }); }
}

// ---------------------------------------------------------------------------
// Kulisse: umgebende Altstadt, Kuppel, Hügel (ohne Kollision, wenige Draw Calls)
// ---------------------------------------------------------------------------
function backdrop(b) {
  const roofTints = ['#c9785a', '#bf6e4e', '#d08462', '#b8694c'];
  const ring = [];
  // Häuserblöcke rund um die Spielfläche
  for (let x = -100; x <= 100; x += 9.5) for (const zr of [[-64, -56], [56, 64]]) ring.push([x + b.rnd(-1.5, 1.5), b.rnd(zr[0], zr[1]) + (zr[0] < 0 ? -b.rnd(0, 14) : b.rnd(0, 14))]);
  for (let z = -50; z <= 50; z += 9.5) for (const xr of [[-62, -54], [54, 62]]) ring.push([b.rnd(xr[0], xr[1]) + (xr[0] < 0 ? -b.rnd(0, 14) : b.rnd(0, 14)), z + b.rnd(-1.5, 1.5)]);
  for (const [x, z] of ring) {
    const w = b.rnd(7, 11), d = b.rnd(7, 11), h = b.rnd(6.5, 13), q = 1000 + (x < 0 ? 0 : 1) + (z < 0 ? 0 : 2);
    b.box(x, 0, z, w, h, d, 'plaster_white', { tint: b.pick(PLASTER), collide: false, minimap: false, grad: false, ao: false, chunk: q, cast: false });
    if (b.rand() < 0.6) {
      // Satteldach als Prisma aus zwei Keilen
      const ridgeX = w > d, span = ridgeX ? d : w, len = (ridgeX ? w : d) + 0.6, rise = span * 0.21, tint = b.pick(roofTints);
      const o = { tint, collide: false, minimap: false, ao: false, chunk: q, uv: 'local', cast: false };
      if (ridgeX) {
        b.wedge(x, h, z - span / 4 - 0.15, len, rise, span / 2 + 0.3, 'roof_tiles', o);
        b.wedge(x, h, z + span / 4 + 0.15, len, rise, span / 2 + 0.3, 'roof_tiles', { ...o, ry: Math.PI });
      } else {
        b.wedge(x - span / 4 - 0.15, h, z, len, rise, span / 2 + 0.3, 'roof_tiles', { ...o, ry: Math.PI / 2 });
        b.wedge(x + span / 4 + 0.15, h, z, len, rise, span / 2 + 0.3, 'roof_tiles', { ...o, ry: -Math.PI / 2 });
      }
    } else {
      b.box(x, h, z, w + 0.1, 0.5, d + 0.1, 'plaster_white', { tint: '#f2ece0', collide: false, minimap: false, grad: false, ao: false, chunk: q, cast: false });
      if (b.rand() < 0.5) b.box(x + b.rnd(-2, 2), h + 0.5, z + b.rnd(-2, 2), 1.4, 1.1, 1.4, 'white', { tint: '#e8e2d4', collide: false, minimap: false, ao: false, chunk: q, cast: false });
    }
  }
  // Kuppelkirche im Nordwesten + Minarett-artiger Turm im Südosten
  b.cyl(-78, 0, -92, 9, 14, 'stone_wall', { seg: 16, tint: '#e4d7bc', collide: false, minimap: false, chunk: 1000, cast: false });
  b.geom(new THREE.SphereGeometry(8.6, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), -78, 14, -92, 'metal_painted', { tint: '#4a8a8a', collide: false, minimap: false, chunk: 1000, cast: false });
  b.cyl(-78, 22.4, -92, 0.6, 3, 'metal_painted', { tint: '#b08a3a', seg: 8, collide: false, minimap: false, chunk: 1000, cast: false });
  b.cyl(86, 0, 96, 2.2, 26, 'plaster_white', { seg: 10, tint: '#f2ece0', collide: false, minimap: false, chunk: 1003, cast: false });
  b.cyl(86, 26, 96, 2.6, 0.6, 'plaster_white', { seg: 10, tint: '#e2d6bd', collide: false, minimap: false, chunk: 1003, cast: false });
  b.cyl(86, 26.6, 96, 2.0, 3.5, 'roof_tiles', { r1: 0.1, seg: 10, tint: '#c27154', collide: false, minimap: false, chunk: 1003, cast: false });
  // Hügelring am Horizont (trockene Hänge)
  b.geom(hillsGeom(), 0, 0, 0, 'sand', { tint: '#d4b27f', collide: false, minimap: false, grad: false, ao: false, chunk: 1010, cast: false, uv: 'world', bullet: false });
  // Zypressen
  for (let i = 0; i < 34; i++) {
    const a = b.rand() * Math.PI * 2, r = b.rnd(72, 125), x = Math.cos(a) * r, z = Math.sin(a) * r, h = b.rnd(7, 11);
    b.cyl(x, 0, z, b.rnd(0.8, 1.1), h, 'grass', { r1: 0.12, seg: 7, tint: '#4a5e3a', collide: false, minimap: false, grad: false, ao: false, chunk: 1011, cast: false });
  }
}

/** Ringförmige Hügellandschaft um die Stadt (Radius 130–430 m). */
function hillsGeom() {
  const segA = 96, rings = [128, 142, 160, 182, 210, 245, 290, 345, 430];
  const pos = [], idx = [];
  const n1 = (a, k) => Math.sin(a * 3 + k) * 0.45 + Math.sin(a * 7 + k * 2.3) * 0.3 + Math.sin(a * 17 + k * 0.7) * 0.15 + Math.sin(a * 31 + k * 1.9) * 0.1;
  for (const r of rings) for (let i = 0; i <= segA; i++) {
    const a = (i / segA) * Math.PI * 2;
    const t = Math.min(1, Math.max(0, (r - 140) / 170));
    const h = -0.8 + t * t * (14 + 26 * (0.5 + 0.5 * n1(a, r * 0.013))) + Math.max(0, r - 300) * 0.05;
    pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segA; i++) {
    const a = j * (segA + 1) + i, c = a + segA + 1;
    idx.push(a, a + 1, c, a + 1, c + 1, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(segA + 3) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}
