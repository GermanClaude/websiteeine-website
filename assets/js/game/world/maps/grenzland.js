// NULLPUNKT — Großkarte „Grenzland“ (Eroberung, ≈ 500 × 500 m) (Owner: world).
// Hügeliges Grenzland am späten Vormittag: Fluss mit Brücke und Furt, Dorf mit Kapelle und Gasthaus, Gehöft mit
// Scheune, Kieswerk, Funkhügel mit Bunker, Mühlenruine; Felder, Hecken, Wälder, Randgebirge.
// Flaggen (Eroberung): A Gehöft · B Dorf · C Brücke · D Kieswerk · E Funkhügel; HQ A im Süden, HQ B im Norden.
// Geladen von world/terrain/bigworld.js (Ortschaften je eigener MapBuilder, Boden y = 0 bzw. Plateauhöhe).
import * as THREE from 'three';
import { building, wall, stairs, railing, catwalk, slab, pitchedRoof } from '../arch.js';
import { container, crateStack, barrelGroup, palletStack, sandbags, car, truck, fence, lampPost, floodMast, tires, bench, dumpster } from '../props.js';
import { gemueseStand, aufsteller, traktor, durchlass } from './grenzland-ausstattung.js';
import * as Innen from './grenzland-innen.js';
import { mgNest } from './grenzland-stellungen.js';
import { grenzanlage, grenzLinie } from './grenzland-grenze.js';

const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const PLASTER = ['#efe6d6', '#e8dcc4', '#f2ede2', '#e3d3b8', '#dfe0d6', '#eadbc8'];
const ROOF = ['#9a4a36', '#8a4232', '#a3553c', '#7e3d30', '#6f4a3c'];

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------
/** Fenster ringsum (Abstand 2,8 m) + Türen; Fensterbank 0,95 m, ohne Glas (beschießbar). */
function openings(w, d, floors, doors, o = {}) {
  const ops = [];
  for (const side of ['n', 's', 'e', 'w']) {
    const len = side === 'n' || side === 's' ? w : d;
    const n = Math.max(1, Math.floor((len - 1.4) / 2.8));
    for (let f = 0; f < floors; f++) for (let k = 0; k < n; k++) {
      const at = -((n - 1) * 2.8) / 2 + k * 2.8;
      if (f === 0 && doors.some(dd => dd.side === side && Math.abs(dd.at - at) < 1.7)) continue;
      if (f === 0 && o.skip?.includes(side)) continue;
      ops.push({ side, at, w: 1.0, h: 1.25, sill: 0.95, kind: 'window', floor: f, shutters: o.shutter || '#4f5b3a' });
    }
  }
  for (const dd of doors) ops.push({ side: dd.side, at: dd.at, w: dd.w ?? 1.15, h: dd.h ?? 2.15, kind: 'door', leaf: 'open', floor: 0 });
  return ops;
}

/**
 * Wohnhaus mit Satteldach (betretbar). o: { x, z, w, d, floors, fh, color, roofTint, doors:[{side, at}],
 * stairs: { x, z, dir } (unterste Stufenkante, Aufstiegsrichtung; nur bei 2 Geschossen), y }
 */
function haus(b, o) {
  const { x, z, w, d } = o;
  const floors = o.floors ?? 2, fh = o.fh ?? 3.0, y = o.y ?? 0;
  const color = o.color || b.pick(PLASTER);
  const holes = [];
  let st = null;
  if (floors > 1 && o.stairs) {
    const s = o.stairs, sw = 1.1, run = (fh - 0.12) / 0.62;
    const [dx, dz] = DIRV[s.dir], rx = -dz, rz = dx;
    const P = (f, r) => [s.x + dx * f + rx * r, s.z + dz * f + rz * r];
    const c0 = P(0.9, -sw / 2 - 0.08), c1 = P(run + 0.05, sw / 2 + 0.08);
    holes.push({ floor: 1, x0: Math.min(c0[0], c1[0]), x1: Math.max(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), z1: Math.max(c0[1], c1[1]) });
    st = { ...s, w: sw, run };
  }
  const B = building(b, {
    x, z, w, d, floors, fh, y, mat: o.mat || 'plaster_white', tint: color,
    openings: openings(w, d, floors, o.doors || [{ side: 's', at: 0 }], { shutter: o.shutter, skip: st ? [st.wall] : [] }), holes,
    roof: { edge: false, mat: 'concrete', tint: '#b9ab94' },
    floorMat: o.floorMat || 'wood_planks', upperFloorMat: 'wood_planks', floorTint: '#b89a78',
    frameMat: 'wood_dark', frameTint: '#5a4636', sillMat: 'stone_wall',
    plinth: { h: 0.55, mat: 'stone_wall', tint: '#c9c0b0', over: 0.03 },
    interiorFactor: 0.52,
  });
  pitchedRoof(b, { x, z, w: w + 0.02, d: d + 0.02, y: B.roofY - 0.02, ridge: o.ridge || (w >= d ? 'x' : 'z'), pitch: o.pitch ?? 0.78, over: 0.5, gableMat: o.mat || 'plaster_white', gableTint: color, tint: o.roofTint || b.pick(ROOF) });
  b.noNav(x - w / 2 - 0.6, z - d / 2 - 0.6, x + w / 2 + 0.6, z + d / 2 + 0.6, B.roofY - 0.6, y + 40);
  if (st) {
    // Handlauf auf der Raumseite (unten 1,4 m seitlich betretbar), Geländer um das Treppenloch oben (Ankunft offen)
    const room = st.wall === 'n' ? 's' : 'n';
    stairs(b, { x: st.x, z: st.z, dir: st.dir, y0: y + 0.12, y1: y + fh, w: st.w, run: st.run, style: 'solid', mat: 'wood_planks', tint: '#a07c58', rail: room === 's' ? 'right' : 'left', railFrom: 1.4, railTint: '#5a4636' });
    b.navPoint(st.x, y + 0.2, st.z);
    Innen.lochgelaender(b, holes[0], y + fh + 0.02, room, 'e');
  }
  const t = 0.3;
  return { ...B, x0: x - w / 2 + t, x1: x + w / 2 - t, z0: z - d / 2 + t, z1: z + d / 2 - t, yF: y + 0.12, yC: y + fh - 0.25, yF2: y + fh + 0.02, yC2: y + 2 * fh - 0.25, hole: holes[0] || null };
}

/** Innenmaß eines building() (Wandstärke t, Decke = Dachplatte bzw. nächste Geschossdecke). */
function innen(B, t = 0.3, y = 0) {
  return { x0: B.x0 + t, x1: B.x1 - t, z0: B.z0 + t, z1: B.z1 - t, yF: y + 0.12, yC: B.levels.length > 1 ? B.levels[1] - 0.25 : B.roofY - 0.25 };
}

/** Niedrige Bruchsteinmauer. */
function stoneWall(b, x0, z0, x1, z1, h = 1.0, y = 0) {
  wall(b, { x0, z0, x1, z1, y, h, t: 0.45, mat: 'stone_wall', tint: '#cbc2b2', minimap: 'wall' });
}

/** Holzzaun (Pfosten + 2 Latten, Kollision als niedrige Wand). */
function woodFence(b, x0, z0, x1, z1, y = 0) {
  const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0), n = Math.max(1, Math.round(L / 2.2));
  for (let i = 0; i <= n; i++) { const t = i / n; b.box(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.12, 1.15, 0.12, 'wood_dark', { tint: '#7a6248', collide: false, minimap: false }); }
  for (const h of [0.45, 0.9]) b.box((x0 + x1) / 2, y + h, (z0 + z1) / 2, L, 0.1, 0.04, 'wood_planks', { ry, tint: '#8f7656', collide: false, minimap: false, grad: false });
  b.box((x0 + x1) / 2, y, (z0 + z1) / 2, L, 1.05, 0.1, 'black', { ry, visual: false, minimap: 'cover', bullet: false });
}

/** Strohballen (Rolle), mit Kollision. */
function hayRoll(b, x, z, ry = 0, y = 0) {
  b.cyl(x, y + 0.75, z, 0.75, 1.2, 'sand', { axis: 'x', ry, tint: '#d9c27a', seg: 12, minimap: 'cover' });
}
/** Quaderballen. */
function hayBale(b, x, y, z, ry = 0) { b.box(x, y, z, 1.2, 0.6, 0.8, 'sand', { ry, tint: '#d6bd70', minimap: 'cover' }); }

/** Gartenzwerg (Geheimnis). */
function gnome(b, x, y, z, ry = 0) {
  b.cyl(x, y, z, 0.11, 0.24, 'plaster_white', { tint: '#3e5fa8', seg: 10, collide: false, minimap: false });
  b.cyl(x, y + 0.24, z, 0.08, 0.1, 'plaster_white', { tint: '#f0c8a8', seg: 10, collide: false, minimap: false });
  b.cyl(x, y + 0.2, z + 0.06, 0.07, 0.1, 'plaster_white', { r1: 0.02, tint: '#f4f1ea', seg: 8, collide: false, minimap: false, rx: 0.3, ry });
  b.cyl(x, y + 0.33, z, 0.09, 0.2, 'plaster_white', { r1: 0.005, tint: '#c8302a', seg: 10, collide: false, minimap: false });
}

/** Funkmast (Gittermast, Beine mit Kollision). */
function mast(b, x, y, z, h = 26) {
  const r = 1.1;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.cyl(x + sx * r, y, z + sz * r, 0.09, h, 'metal_galvanized', { r1: 0.06, seg: 6, minimap: sx < 0 && sz < 0 ? 'pillar' : false, rx: -sz * 0.035, rz: sx * 0.035 });
  for (let k = 1; k * 3 < h; k++) {
    const yy = y + k * 3, rr = r * (1 - (k * 3) / h * 0.6);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      const L = Math.hypot(bx - ax, bz - az) * rr;
      b.box(x + (ax + bx) / 2 * rr, yy, z + (az + bz) / 2 * rr, L, 0.06, 0.06, 'metal_galvanized', { ry: Math.atan2(-(bz - az), bx - ax), collide: false, minimap: false, grad: false });
    }
  }
  b.cyl(x, y + h, z, 0.05, 6, 'metal_painted', { tint: '#c23a2e', seg: 6, collide: false, minimap: false });
  b.light('point', x, y + h + 5.6, z, { color: '#ff3020', intensity: 0.6, distance: 6 });
  b.glow(x, y + h + 5.9, z, { size: 1.6, color: '#ff3a20', intensity: 1.2 });
}

/** Zelt (Plane). */
function tent(b, x, z, ry = 0, tint = '#5b6142') {
  b.box(x, 0, z, 4.2, 1.6, 5.2, 'tarp', { ry, tint, minimap: 'cover' });
  b.wedge(x, 1.6, z, 4.2, 1.2, 5.2, 'tarp', { ry, tint, minimap: false });
}

/** Hauptquartier: Betonplatte, Fahrzeugstellplätze, Zelte, Container, Sandsäcke, Fahnenmast. */
function hq(b, o) {
  const { x, z, side } = o, s = side === 'A' ? 1 : -1, col = side === 'A' ? '#2f6db5' : '#c0392b';
  b.defineSign(side === 'A' ? 'hq_a' : 'hq_b', { style: 'stencil', text: side === 'A' ? 'HQ SÜD' : 'HQ NORD', sub: 'Fahrzeugpark', bg: '#3a3f33', fg: '#e8e2cf' });
  b.groundTiled(x - 34, z - 22, x + 34, z + 22, 'concrete', { cell: 2 });
  for (const p of o.pads) b.box(p[0], 0, p[1], p[2] === 'tank' ? 5.2 : 3.6, 0.06, p[2] === 'tank' ? 9.5 : 6.5, 'concrete_panel', { ry: p[3] || 0, tint: '#a9a59c', collide: false, grad: false, minimap: false });
  for (const p of o.pads) b.decal(p[0], 0.07, p[1], p[2] === 'tank' ? 4.6 : 3.2, 0.5, 'line', { ry: (p[3] || 0) + Math.PI / 2, tint: '#e8c22c', kind: 'paint', opacity: 0.8 });
  tent(b, x + 24 * s, z + 16 * s, 0); tent(b, x + 17 * s, z + 16 * s, 0, '#6a6a4c');
  container(b, x - 26 * s, 0, z + 15 * s, { ry: Math.PI / 2, color: '#56603f' });
  container(b, x - 26 * s, 0, z + 8 * s, { ry: Math.PI / 2, color: '#4a5338' });
  crateStack(b, x - 20 * s, z + 17 * s, { ry: 0.2 });
  barrelGroup(b, x + 28 * s, z + 4 * s, { n: 5 });
  sandbags(b, x - 10, z - 20 * s, x + 10, z - 20 * s, { rows: 3 });
  sandbags(b, x - 30, z - 18 * s, x - 18, z - 20 * s, { rows: 3 });
  sandbags(b, x + 18, z - 20 * s, x + 30, z - 18 * s, { rows: 3 });
  b.cyl(x, 0, z + 19 * s, 0.08, 9, 'metal_galvanized', { seg: 8, minimap: 'prop' });
  b.box(x + 0.9, 7.6, z + 19 * s, 1.8, 1.1, 0.04, 'fabric_camo_a', { tint: col, collide: false, minimap: false, grad: false });
  floodMast(b, x + 31 * s, z - 14 * s, { h: 9 });
  floodMast(b, x - 31 * s, z - 14 * s, { h: 9 });
  // Schild an der Längsseite des Containers zum Platz hin (stand vorher 0,8 m im Container und war unsichtbar)
  b.sign(x - 26 * s + 1.25 * s, 1.35, z + 8 * s, 3.2, 0.8, side === 'A' ? 'hq_a' : 'hq_b', { ry: s * Math.PI / 2 });
}

// ---------------------------------------------------------------------------
// Ortschaften
// ---------------------------------------------------------------------------
function dorf(b) {
  b.defineSign('gasthaus', { style: 'plate', text: 'GASTHAUS ZUM GRENZSTEIN', bg: '#2d4a3a', fg: '#f1e6c8' });
  b.defineSign('ortsschild', { style: 'plate', text: 'GRENZDORF', sub: 'Landkreis Nullpunkt', bg: '#f2c230', fg: '#1c1c1c' });
  // Platz um die Kreuzung (Kopfsteinpflaster) + Brunnen
  b.groundTiled(-20, 60, 8, 86, 'cobble', { cell: 1 });
  b.cyl(-14, 0, 81, 0.95, 0.85, 'stone_wall', { tint: '#c8beac', seg: 14, minimap: 'cover' });
  b.cyl(-14, 0.85, 81, 0.75, 0.05, 'metal_painted', { tint: '#3a5560', seg: 14, collide: false, minimap: false });
  // Gasthaus „Zum Grenzstein“
  const gasthaus = haus(b, { x: -26, z: 58, w: 13, d: 9, floors: 2, color: '#efe2c4', roofTint: '#8a4232', doors: [{ side: 's', at: 2 }, { side: 'e', at: 0 }], stairs: { x: -31.6, z: 54.4, dir: 'e', wall: 'n' } });
  b.sign(-26, 3.2, 62.6, 4.2, 0.7, 'gasthaus', { ry: 0 });
  bench(b, -21, 64.2, { ry: 0 }); bench(b, -31, 64.2, { ry: 0 });
  // Wohnhäuser
  const h18 = haus(b, { x: 18, z: 64, w: 9, d: 8, floors: 2, doors: [{ side: 'w', at: 0 }], stairs: { x: 14.2, z: 61.0, dir: 'e', wall: 'n' } });
  const h30 = haus(b, { x: -30, z: 95, w: 9, d: 8, floors: 1, doors: [{ side: 'n', at: 0 }, { side: 's', at: 1.5 }] });
  const h24 = haus(b, { x: 24, z: 96, w: 10, d: 7, floors: 2, doors: [{ side: 'w', at: 0 }, { side: 'n', at: -2 }], stairs: { x: 19.7, z: 98.6, dir: 'e', wall: 's' } });
  const h8 = haus(b, { x: -8, z: 40, w: 9, d: 8, floors: 2, doors: [{ side: 'e', at: 0 }], stairs: { x: -11.8, z: 37.0, dir: 'e', wall: 'n' } });
  const h35 = haus(b, { x: 35, z: 40, w: 8, d: 8, floors: 1, doors: [{ side: 'w', at: 0 }, { side: 'e', at: 0 }] });
  // Schuppen (Holz; Bretter heller getönt – die Schattenseite war mit #8a6a4a fast schwarz)
  const schuppen = building(b, { x: -48, z: 72, w: 7, d: 9, floors: 1, fh: 3.2, mat: 'wood_planks', tint: '#a8845e', openings: [{ side: 'e', at: 0, w: 2.6, h: 2.6, kind: 'gap', frame: false }, { side: 'w', at: 1, w: 1, h: 1, sill: 1.2, kind: 'window' }], roof: { edge: false, mat: 'wood_planks', tint: '#6a5038' }, floorMat: 'wood_planks' });
  pitchedRoof(b, { x: -48, z: 72, w: 7.02, d: 9.02, y: 3.18, ridge: 'z', pitch: 0.55, over: 0.4, gableMat: 'wood_planks', gableTint: '#a8845e', tint: '#5d5a52' });
  b.noNav(-52, 67, -44, 77, 2.6, 40);
  palletStack(b, -46, 70, { n: 5 }); crateStack(b, -49.5, 75.5, { ry: 0.3 });
  // Traktor im Schuppen (rot, Blick zum Tor im Osten; auf dem Hallenboden y 0,12; ohne b.rand → Dorf-Zufall unverändert)
  traktor(b, -48.6, 72.2, { ry: Math.PI / 2, y: 0.12, color: '#a8322a', rim: '#d8d4c8' });
  // Kapelle mit Turm (Wahrzeichen)
  const kapelle = building(b, { x: -8, z: 100, w: 7, d: 13, floors: 1, fh: 5.2, mat: 'plaster_white', tint: '#f3eee4', openings: [{ side: 's', at: 0, w: 1.6, h: 2.8, kind: 'door', leaf: 'open' }, { side: 'e', at: -3, w: 0.9, h: 2.2, sill: 1.8, kind: 'window', glass: true }, { side: 'e', at: 2, w: 0.9, h: 2.2, sill: 1.8, kind: 'window', glass: true }, { side: 'w', at: -3, w: 0.9, h: 2.2, sill: 1.8, kind: 'window', glass: true }, { side: 'w', at: 2, w: 0.9, h: 2.2, sill: 1.8, kind: 'window', glass: true }], roof: { edge: false, mat: 'concrete', tint: '#b9ab94' }, floorMat: 'paving', interiorFactor: 0.5 });
  pitchedRoof(b, { x: -8, z: 100, w: 7.02, d: 13.02, y: 5.18, ridge: 'z', pitch: 1.0, over: 0.45, gableMat: 'plaster_white', gableTint: '#f3eee4', tint: '#5f5e5a' });
  b.box(-8, 0, 91.6, 4.2, 15, 4.2, 'plaster_white', { tint: '#f3eee4', minimap: 'building' });
  b.box(-8, 15, 91.6, 4.4, 0.25, 4.4, 'stone_wall', { tint: '#cfc6b6', collide: false, minimap: false });
  pitchedRoof(b, { x: -8, z: 91.6, w: 4.4, d: 4.4, y: 15.2, ridge: 'x', pitch: 2.2, over: 0.15, gableMat: 'plaster_white', gableTint: '#f3eee4', tint: '#4a5048' });
  for (const [ox, oz] of [[0, -2.12], [2.12, 0], [-2.12, 0]]) b.box(-8 + ox, 11.2, 91.6 + oz, ox ? 0.06 : 1.2, 2.0, ox ? 1.2 : 0.06, 'black', { tint: '#151515', collide: false, minimap: false, grad: false });
  b.noNav(-12, 84, -4, 108, 4.5, 60);
  // (Parkbänke in der Kapelle → Kirchenbänke mit Mittelgang, Altar: Innen.kapelleInnen)
  // Gärten: Bruchsteinmauern, Zäune, Hecken
  stoneWall(b, -38, 102, -22, 102); stoneWall(b, -38, 102, -38, 88);
  stoneWall(b, 14, 104, 32, 104); stoneWall(b, 32, 104, 32, 90);
  woodFence(b, -16, 30, -16, 46); woodFence(b, -16, 30, -2, 30);
  woodFence(b, 30, 30, 42, 30); woodFence(b, 42, 30, 42, 48);
  for (const [x, z] of [[-36, 92], [-24, 104], [28, 104], [-14, 32], [40, 46], [-42, 60], [12, 72]]) b.plant('bush', x, 0, z, { s: 1.1 });
  // Straßenraum: Autos, Laternen, Sandsäcke (Flaggenkampf)
  car(b, 8, 79, { ry: 1.25, color: '#6b7a52' }); car(b, -21, 67, { ry: 0.25 }); car(b, 28, 54, { ry: -0.3, color: '#c7c7c2' });
  lampPost(b, 5, 86); lampPost(b, -15, 62); lampPost(b, 12, 50);
  sandbags(b, -2, 86, 5, 88, { rows: 3 }); sandbags(b, -20, 84, -14, 87, { rows: 3 });
  sandbags(b, 2, 58, 8, 60, { rows: 3 });
  barrelGroup(b, -36, 66, { n: 3 }); dumpster(b, 30, 60, { ry: 1.57 });
  crateStack(b, 10, 92, { ry: 0.6 });
  b.sign(-5, 2.4, 116, 2.8, 0.7, 'ortsschild', { ry: Math.PI * 0.9 });
  // Pfosten unter dem Ortsschild (stand vorher frei in der Luft)
  for (const lx of [-1.1, 1.1]) { const c = Math.cos(Math.PI * 0.9), s = Math.sin(Math.PI * 0.9); b.cyl(-5 + lx * c - 0.07 * s, -0.15, 116 - lx * s - 0.07 * c, 0.045, 3.27, 'metal_galvanized', { seg: 8, minimap: false }); }
  bauernmarkt(b);
  // Inneneinrichtung + Innenbeleuchtung (am Ende, ohne b.rand → übrige Dorf-Platzierung unverändert)
  Innen.gasthausInnen(b, gasthaus); Innen.haus18Innen(b, h18); Innen.haus30Innen(b, h30); Innen.haus24Innen(b, h24);
  Innen.haus8Innen(b, h8); Innen.haus35Innen(b, h35);
  Innen.kapelleInnen(b, innen(kapelle)); Innen.schuppenInnen(b, innen(schuppen));
  // MG-Stellung am nördlichen Ortsrand: deckt die Landstraße dort, wo sie die Hecke Richtung Brücke durchquert
  mgNest(b, 8.0, 30.0, { ry: Math.atan2(20 - 8, 18 - 30) });
  return {};
}

/**
 * Bauernmarkt an der Kapelle (Wunsch Nathanael): drei Gemüsestände in einer Reihe westlich der Kapelle (Front zur
 * Kapellenwand, 4,5 m Gang davor), zwei Stände beidseits des Wegs zum Kapellenportal (Weg 6,8 m frei), Tafel zum
 * Dorfplatz. Theken = Hockdeckung mit Kollision, Markisen kugeldurchlässig; Lücken ≥ 2,4 m für Wege/Navigation.
 * Am Ende von dorf() gebaut und ohne b.rand → übrige Dorf-Platzierung unverändert.
 */
function bauernmarkt(b) {
  const low = b.lookQuality === 'low';
  const tafel = { style: 'plate', bg: '#26302a', fg: '#efeadc', borderColor: '#b9a77e' };
  b.defineSign('markt_tafel', { ...tafel, text: 'BAUERNMARKT', sub: 'frisch vom Feld · an der Kapelle' });
  b.defineSign('tafel_gemuese', { ...tafel, text: 'GEMÜSE' });
  b.defineSign('tafel_obst', { ...tafel, text: 'OBST & TOMATEN' });
  b.defineSign('tafel_kartoffeln', { ...tafel, text: 'KARTOFFELN' });
  b.defineSign('tafel_hof', { ...tafel, text: 'FRISCH VOM HOF' });
  b.defineSign('tafel_kuerbis', { ...tafel, text: 'KÜRBISSE' });
  const E = Math.PI / 2, W = -Math.PI / 2;
  // Reihe westlich der Kapelle (Kapellenwand x −11,5; Haus x −25,5)
  gemueseStand(b, -17.2, 91.8, { ry: E, design: 0, waren: ['kohl', 'salat', 'moehren', 'kartoffeln', 'salat', 'kohl', 'kartoffeln', 'moehren'], boden: 'kuerbis', seite: 1, schild: 'tafel_gemuese', low });
  gemueseStand(b, -17.2, 96.6, { ry: E, design: 2, waren: ['aepfel', 'tomaten', 'paprika', 'aepfel', 'tomaten', 'aepfel', 'zwiebeln', 'paprika'], boden: null, schild: 'tafel_obst', low });
  gemueseStand(b, -17.2, 101.4, { ry: E, design: 3, waren: ['kartoffeln', 'zwiebeln', 'moehren', 'kohl', 'zwiebeln', 'kartoffeln', 'kohl', 'moehren'], boden: 'kuerbis', seite: -1, schild: 'tafel_kartoffeln', low });
  // vor dem Portal (Tür x −8, z 106,5): links und rechts des Wegs
  gemueseStand(b, -12.6, 111.0, { ry: E, design: 1, waren: ['salat', 'kohl', 'tomaten', 'paprika', 'kohl', 'salat', 'paprika', 'tomaten'], boden: 'kuerbis', seite: -1, schild: 'tafel_hof', low });
  gemueseStand(b, -3.4, 111.0, { ry: W, design: 0, waren: ['aepfel', 'zwiebeln', 'kartoffeln', 'moehren', 'aepfel', 'kartoffeln', 'zwiebeln', 'aepfel'], boden: 'kuerbis', seite: 1, schild: 'tafel_kuerbis', low });
  aufsteller(b, -14.8, 88.4, 'markt_tafel', Math.PI);
}

function gehoeft(b) {
  b.defineSign('geheim', { style: 'plate', text: 'PSST!', bg: '#efe2c0', fg: '#7a2a20' });
  b.defineSign('gertrud', { style: 'stencil', text: 'GERTRUD', bg: '#6a5038', fg: '#f0e6d0' });
  b.groundTiled(-160, 100, -124, 112, 'gravel', { cell: 2 });
  // Bauernhaus
  const bauernhaus = haus(b, { x: -162, z: 96, w: 11, d: 8, floors: 2, color: '#e8dcc4', roofTint: '#7e3d30', doors: [{ side: 's', at: 2 }, { side: 'e', at: 0 }], stairs: { x: -166.9, z: 93.0, dir: 'e', wall: 'n' } });
  // Scheune mit Heuboden und Geheimkammer
  const sx = -136, sz = 118, w = 16, d = 11, x0 = sx - w / 2, x1 = sx + w / 2, z0 = sz - d / 2, z1 = sz + d / 2;
  const scheune = building(b, { x: sx, z: sz, w, d, floors: 1, fh: 5.6, mat: 'wood_planks', tint: '#a8845e', openings: [{ side: 's', at: 1.5, w: 4.8, h: 4.2, kind: 'gap', frame: false }, { side: 'n', at: -5, w: 1.2, h: 2.1, kind: 'door', leaf: 'open' }, { side: 'e', at: 2.5, w: 1.0, h: 0.9, sill: 1.6, kind: 'window' }, { side: 'w', at: 0, w: 1.0, h: 0.9, sill: 1.6, kind: 'window' }], roof: { edge: false, mat: 'wood_planks', tint: '#6a5038' }, floorMat: 'wood_planks', floorTint: '#9a8064', interiorFactor: 0.5 });
  pitchedRoof(b, { x: sx, z: sz, w: w + 0.02, d: d + 0.02, y: 5.58, ridge: 'x', pitch: 0.7, over: 0.5, gableMat: 'wood_planks', gableTint: '#a8845e', tint: '#6c4a3a' });
  b.noNav(x0 - 0.6, z0 - 0.6, x1 + 0.6, z1 + 0.6, 5.0, 40);
  // Heuboden (hintere Hälfte, y 3,2) + Treppe
  slab(b, x0 + 0.3, z0 + 0.3, x1 - 0.3, z0 + 4.8, 3.0, 0.2, 'wood_planks', [], { tint: '#9a8064' });
  stairs(b, { x: x0 + 1.1, z: z0 + 9.9, dir: 'n', y0: 0.12, y1: 3.2, w: 1.1, run: 5.0, style: 'steel', mat: 'wood_planks', tint: '#8a6a4a', rail: 'right' });
  railing(b, x0 + 1.8, z0 + 4.8, x1 - 0.4, z0 + 4.8, 3.2, { tint: '#6a5038', mat: 'wood_dark' });
  b.navLine(x0 + 1.1, 0.2, z0 + 9.9, x0 + 1.1, 3.25, z0 + 4.4, 1.0);
  // Geheimkammer im Heuboden (Ostecke): Bretterwände, niedriger Durchschlupf (nur geduckt) hinter Ballen
  const kx = x1 - 3.8;
  wall(b, { x0: kx, z0: z0 + 3.9, x1: kx, z1: z0 + 0.3, y: 3.2, h: 2.4, t: 0.12, mat: 'wood_planks', tint: '#7a5c40', openings: [{ at: 1.6, w: 0.9, h: 1.35, kind: 'gap', frame: false }], minimap: false });
  wall(b, { x0: x1 - 0.3, z0: z0 + 3.9, x1: kx, z1: z0 + 3.9, y: 3.2, h: 2.4, t: 0.12, mat: 'wood_planks', tint: '#7a5c40', minimap: false });
  hayBale(b, kx - 1.55, 3.2, z0 + 2.4, 0.1); hayBale(b, kx - 1.55, 3.8, z0 + 2.3, -0.05); hayBale(b, kx - 2.7, 3.2, z0 + 3.1, 0.4);
  for (let i = 0; i < 4; i++) hayBale(b, x0 + 2.5 + i * 1.3, 3.2, z0 + 1.2, 0.05 * i);
  gnome(b, x1 - 1.4, 3.2, z0 + 1.6, -0.6);
  b.box(x1 - 0.5, 3.6, z0 + 2.2, 0.04, 0.5, 0.8, 'wood_planks', { tint: '#c9b48a', collide: false, minimap: false });
  b.sign(x1 - 0.48, 4.15, z0 + 2.2, 0.75, 0.22, 'geheim', { ry: -Math.PI / 2 });
  b.light('point', x1 - 1.6, 4.6, z0 + 1.8, { color: '#ffb46a', intensity: 0.5, distance: 4 });
  // Gertruds Stellplatz (Traktor – Fahrzeug-Agent) + Werkzeugecke
  b.decal(sx + 1.5, 0.14, sz + 1.5, 2.4, 3.4, 'stain', { ry: 0.1, kind: 'grime', opacity: 0.7 });
  b.sign(sx + 1.5, 3.2, z0 + 0.34, 2.0, 0.5, 'gertrud', { ry: 0 });
  crateStack(b, x0 + 3.5, z1 - 1.4, { ry: 0.1 }); tires(b, x1 - 1.4, z1 - 1.6, { n: 3 });
  // Stall, Silo, Strohrollen, Zäune
  const stall = building(b, { x: -178, z: 92, w: 6, d: 12, floors: 1, fh: 3.0, mat: 'brick', tint: '#c2a08a', openings: [{ side: 'e', at: -2.5, w: 1.3, h: 2.1, kind: 'door', leaf: 'open' }, { side: 'e', at: 2.5, w: 1.3, h: 2.1, kind: 'door', leaf: 'open' }, { side: 'w', at: 0, w: 1.0, h: 0.8, sill: 1.5, kind: 'window' }], roof: { edge: false, mat: 'concrete', tint: '#9a8c78' }, floorMat: 'concrete' });
  pitchedRoof(b, { x: -178, z: 92, w: 6.02, d: 12.02, y: 2.98, ridge: 'z', pitch: 0.6, over: 0.4, gableMat: 'brick', gableTint: '#c2a08a', tint: '#6f6a5e' });
  b.noNav(-182, 85, -174, 99, 2.4, 40);
  b.cyl(-124, 0, 90, 2.3, 9.5, 'metal_galvanized', { seg: 18, minimap: 'pillar' });
  b.cyl(-124, 9.5, 90, 2.4, 1.6, 'metal_galvanized', { r1: 0.3, seg: 18, collide: false, minimap: false });
  for (const [x, z, r] of [[-152, 126, 0.2], [-149.8, 126.4, 0.3], [-151, 128.6, 1.4], [-120, 110, 0.9], [-121.5, 112, 0.6], [-168, 108, 1.5]]) hayRoll(b, x, z, r);
  woodFence(b, -186, 80, -186, 136); woodFence(b, -186, 80, -150, 80); woodFence(b, -186, 136, -158, 136);
  woodFence(b, -116, 98, -116, 132);
  car(b, -152, 92, { ry: 0.4, color: '#3b3d40' });
  barrelGroup(b, -170, 104, { n: 3 }); palletStack(b, -128, 104, { n: 4 });
  // Sandsackreihe nordwestlich der Scheune (lag vorher quer vor der Nordtür (−141/112,5) → Bots blieben hängen);
  // Türvorplatz x −143,5…−138,5 bleibt frei
  sandbags(b, -150.5, 110.6, -145.5, 109.8, { rows: 3 }); sandbags(b, -156, 99, -152, 101, { rows: 3 });
  // maps-expand: Rundballen und Quaderballen rund um die Flagge (Hock-/Brustdeckung), ausgebranntes Auto
  for (const [x, z, r] of [[-131, 104, 0.3], [-129.4, 105.6, 1.2], [-158, 112, 0.9], [-156.4, 113.6, 0.2], [-140, 96, 1.5], [-166, 118, 0.6]]) hayRoll(b, x, z, r);
  for (const [x, y, z, r] of [[-143, 0, 101, 0.1], [-143, 0, 102, 0.05], [-143, 0.6, 101.5, 0.15]]) hayBale(b, x, y, z, r);
  car(b, -170, 111, { ry: 0.9, color: '#5a4a3a', style: 'wreck', model: false });
  // Traktor „Gertrud“ auf ihrem Stellplatz (Ölfleck, Schild) – statisch, Blick zum Scheunentor (Süden)
  traktor(b, -134.5, 119.5, { ry: 0, y: 0.12 });
  // Inneneinrichtung (Bauernstube, Scheune, Stall) + MG-Stellung an der Zufahrt von der Furt (Norden)
  Innen.bauernhausInnen(b, bauernhaus); Innen.scheuneInnen(b, innen(scheune)); Innen.stallInnen(b, innen(stall));
  mgNest(b, -144.0, 84.5, { ry: Math.atan2(-162 + 144, 40 - 84.5) });
  return {};
}

function bruecke(b) {
  // Deck (Achse A (36,−14) → B (44,−46)), Oberkante 0,6 m
  const ax = 36, az = -14, bx = 44, bz = -46;
  const L = Math.hypot(bx - ax, bz - az) + 4, ux = (bx - ax) / (L - 4), uz = (bz - az) / (L - 4), ry = Math.atan2(ux, uz);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  const box = (along, side, y, w, h, d, mat, o = {}) => b.box(cx + ux * along + uz * side, y, cz + uz * along - ux * side, w, h, d, mat, { ry, ...o });
  b.box(cx, 0, cz, 8.2, 0.6, L, 'concrete', { ry, tint: '#b8b2a6', minimap: 'building' });
  box(0, 0, 0.6, 7.0, 0.02, L - 0.4, 'asphalt', { collide: false, minimap: false, grad: false });
  for (const s of [-1, 1]) {
    box(0, s * 3.85, 0.6, 0.5, 0.25, L, 'concrete', { tint: '#c8c2b6', minimap: false });
    railing(b, cx - ux * L / 2 + uz * s * 3.85, cz - uz * L / 2 - ux * s * 3.85, cx + ux * L / 2 + uz * s * 3.85, cz + uz * L / 2 - ux * s * 3.85, 0.85, { tint: '#5a6068', mat: 'metal_painted' });
  }
  // Pfeiler im Fluss + Widerlager
  for (const t of [-0.22, 0.22]) b.box(cx + ux * L * t, -4.5, cz + uz * L * t, 7.0, 4.5, 1.6, 'concrete', { ry, tint: '#a8a296', minimap: false });
  for (const t of [-0.5, 0.5]) b.box(cx + ux * L * t, -3, cz + uz * L * t, 9, 3.0, 2.5, 'concrete', { ry, tint: '#a8a296', minimap: false });
  // Brückenköpfe: Sandsäcke, Wrack, Kisten
  const Y = 0.6; // Brückenköpfe sind auf Deckhöhe eingeebnet (Plateaus in terrain.pads)
  sandbags(b, 28, -4, 33, -6, { rows: 4, y: Y }); sandbags(b, 41, -5, 45, -2, { rows: 4, y: Y });
  sandbags(b, 39, -54, 43, -56, { rows: 4, y: Y }); sandbags(b, 51, -52, 55, -49, { rows: 4, y: Y });
  car(b, 41.5, -24, { ry: ry + 0.35, color: '#5a5f63', y: Y, model: false });
  crateStack(b, 26, 1, { ry: 0.5, y: Y });
  // MG-Stellungen an beiden Brückenköpfen, Blick über die Brücke (Engstelle)
  mgNest(b, 55.5, -55.5, { y: Y, ry: Math.atan2(40 - 55.5, -30 + 55.5) });
  mgNest(b, 24.5, -3.2, { y: Y, ry: Math.atan2(40 - 24.5, -30 + 3.2) });
  b.noNav(-1e4, -1e4, 1e4, 1e4, -20, -1.85);
  return {};
}

function kieswerk(b) {
  b.groundTiled(118, -146, 186, -78, 'gravel', { cell: 2 });
  // Halle mit Laufsteg
  const hx = 168, hz = -118, w = 15, d = 26;
  const halle = building(b, { x: hx, z: hz, w, d, floors: 1, fh: 7.5, mat: 'metal_corrugated', tint: '#8c9488', openings: [{ side: 'n', at: 0, w: 5, h: 5, kind: 'gap', frame: false }, { side: 's', at: 0, w: 5, h: 5, kind: 'gap', frame: false }, { side: 'w', at: -6, w: 1.2, h: 2.2, kind: 'door', leaf: 'open' }, { side: 'w', at: 6, w: 1.2, h: 2.2, kind: 'door', leaf: 'open' }, { side: 'e', at: 0, w: 1.2, h: 2.2, kind: 'door', leaf: 'open' }, { side: 'w', at: 0, w: 6, h: 1.2, sill: 5.2, kind: 'window', glass: true }, { side: 'e', at: -7, w: 6, h: 1.2, sill: 5.2, kind: 'window', glass: true }], roof: { edge: true, mat: 'metal_corrugated', tint: '#7a8076' }, floorMat: 'concrete', interiorFactor: 0.58 });
  catwalk(b, hx + 5.6, hz - 10, hx + 5.6, hz + 4, 3.6, { w: 1.6 });
  stairs(b, { x: hx + 5.6, z: hz + 9.8, dir: 'n', y0: 0.12, y1: 3.6, w: 1.1, run: 5.6, style: 'steel', mat: 'metal_tread', rail: true });
  b.navLine(hx + 5.6, 3.65, hz - 9.5, hx + 5.6, 3.65, hz + 3.5, 1.2);
  for (const [x, z, sw, sh, sd] of [[hx - 3, hz - 6, 3, 2.2, 5], [hx - 3, hz + 5, 3.4, 1.6, 4], [hx + 1, hz, 1.6, 1.2, 1.6]]) b.box(x, 0, z, sw, sh, sd, 'metal_painted', { tint: '#b8862e', minimap: 'cover' });
  palletStack(b, hx - 5, hz + 11, { n: 5 }); barrelGroup(b, hx + 3, hz - 11, { n: 4 });
  // Kieshaufen (Kegel), Förderband, Silo
  for (const [x, z, r, h] of [[132, -96, 7, 4.6], [128, -128, 6, 3.8], [142, -82, 4.5, 2.8]]) {
    b.cyl(x, 0, z, r, h, 'gravel', { r1: 0.6, seg: 16, minimap: 'cover', tint: '#c8beb0' });
  }
  b.cyl(178, 0, -90, 2.8, 12, 'metal_galvanized', { seg: 16, minimap: 'pillar' });
  b.cyl(178, 12, -90, 2.9, 1.8, 'metal_galvanized', { r1: 0.4, seg: 16, collide: false, minimap: false });
  // Förderband vom Aufgabetrichter hinauf über die Spitze des großen Kieshaufens (vorher: Band stieg nach Westen ins
  // Leere, eine Stütze ragte durch das Band, die andere erreichte es nicht)
  foerderband(b, [157, 0.9, -95.4], [135.2, 5.7, -96.0]);
  // Container, Lkw, Zäune, Licht
  container(b, 138, 0, -142, { ry: 0.05, color: '#b8862e' }); container(b, 138, 0, -134, { ry: -0.05, color: '#4a5a66' });
  container(b, 186, 0, -142, { ry: Math.PI / 2, color: '#6e2c22' });
  truck(b, 148, -132, { ry: 0.4, color: '#c8a030' });
  fence(b, 116, -150, 186, -150, { h: 2.2 }); fence(b, 190, -150, 190, -100, { h: 2.2 });
  fence(b, 116, -150, 116, -118, { h: 2.2 });
  floodMast(b, 120, -112, { h: 10 }); floodMast(b, 184, -76, { h: 10 });
  sandbags(b, 146, -104, 152, -102, { rows: 4 }); sandbags(b, 156, -120, 160, -116, { rows: 4 });
  tires(b, 130, -110, { n: 4 }); crateStack(b, 160, -84, { ry: 0.3 });
  // maps-expand: Schützenloch (Sandsack-U) + Wrack bei Flagge D
  sandbags(b, 145, -124, 149, -126, { rows: 4 }); sandbags(b, 145, -124, 144, -120, { rows: 4 }); sandbags(b, 149, -126, 150, -122, { rows: 4 });
  car(b, 140, -114, { ry: 0.8, color: '#4a4f52', style: 'wreck', model: false });
  // Hallen-Ausstattung + MG-Stellung an der Einfahrt (Blick auf die Landstraße von der Brücke)
  Innen.kieswerkInnen(b, innen(halle));
  mgNest(b, 122.5, -117.0, { ry: Math.atan2(100 - 122.5, -96 + 117) });
  return {};
}

/** Förderband von A (unten, Trichter) nach B (oben, Abwurf) mit Bandrahmen, Gurt, Stützböcken, Trichter, Kollision. */
function foerderband(b, A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], Lh = Math.hypot(dx, dz), L = Math.hypot(Lh, dy);
  const ry = Math.atan2(-dz, dx), rz = Math.atan2(dy, Lh), nx = -dz / Lh, nz = dx / Lh;
  const at = (t) => [A[0] + dx * t, A[1] + dy * t, A[2] + dz * t];
  const [mx, my, mz] = at(0.5);
  b.box(mx, my - 0.15, mz, L, 0.22, 0.9, 'metal_painted', { ry, rz, tint: '#3d4247', minimap: false, grad: false });
  b.box(mx, my + 0.07, mz, L, 0.03, 0.7, 'rubber', { ry, rz, collide: false, minimap: false, grad: false, ao: false });
  for (const t of [0.22, 0.52, 0.8]) {
    const [px, py, pz] = at(t);
    for (const sd of [-0.42, 0.42]) b.box(px + nx * sd, 0, pz + nz * sd, 0.12, py - 0.15, 0.12, 'metal_painted', { tint: '#3d4247', minimap: sd < 0 ? 'pillar' : false });
    b.box(px, py - 0.35, pz, 0.1, 0.1, 0.95, 'metal_painted', { ry, tint: '#3d4247', collide: false, minimap: false, grad: false });
  }
  // Aufgabetrichter am unteren Ende
  b.box(A[0] + 0.4, 0, A[2], 1.4, 0.75, 1.4, 'metal_painted', { tint: '#b8862e', minimap: 'cover' });
  b.cyl(A[0] + 0.4, 0.75, A[2], 0.75, 0.6, 'metal_painted', { r1: 1.05, seg: 4, ry: Math.PI / 4, tint: '#b8862e', collide: false, minimap: false });
}

function muehle(b) {
  // Ruine einer Wassermühle: Bruchsteinmauern mit Lücken, ohne Dach, Mühlrad am Ufer
  const x = -62, z = 14, w = 12, d = 9, x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const sw = (ax, az, bx, bz, h, ops) => wall(b, { x0: ax, z0: az, x1: bx, z1: bz, h, t: 0.55, mat: 'stone_wall', tint: '#bcb3a2', openings: ops, minimap: 'wall' });
  sw(x0, z0, x1, z0, 3.6, [{ at: 3, w: 1.1, h: 2.1, kind: 'door', frame: false }, { at: 8.5, w: 2.4, h: 2.6, kind: 'gap', frame: false }]);
  sw(x1, z0, x1, z1, 2.2, [{ at: 4, w: 1.0, h: 1.0, sill: 0.95, kind: 'window', frame: false }]);
  sw(x1, z1, x0, z1, 4.4, [{ at: 2.5, w: 1.0, h: 1.2, sill: 1.0, kind: 'window', frame: false }, { at: 7.6, w: 1.6, h: 2.2, kind: 'gap', frame: false }]);
  sw(x0, z1, x0, z0, 1.6, [{ at: 4.5, w: 1.6, h: 1.6, kind: 'gap', frame: false }]);
  b.groundTiled(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, 'paving', { cell: 1 });
  for (const [px, pz, r] of [[x - 2, z + 1, 0.4], [x + 3, z - 2, 1.1], [x0 + 1.5, z1 + 2, 0.2]]) b.box(px, 0, pz, 1.4, 0.7, 0.9, 'stone_wall', { ry: r, tint: '#b0a796', minimap: 'cover' });
  muehlrad(b, x - 3, 2.6, z0 - 1.2);
  sandbags(b, x - 9, z + 9, x - 4, z + 10, { rows: 3 }); sandbags(b, x + 5, z + 8, x + 9, z + 6, { rows: 3 });
  crateStack(b, x + 9, z - 3, { ry: 0.7 });
  return {};
}

/**
 * Mühlrad (Achse entlang z, an der Nordwand): zwei Felgenkränze, je 8 Speichen, 16 Schaufeln, Nabe und Welle in die
 * Mauer – vorher eine geschlossene, fast schwarze Scheibe. Kollision: Achteck aus zwei gedrehten Quadern (Laufen),
 * Kugeln treffen nur die sichtbaren Hölzer.
 */
function muehlrad(b, cx, cy, cz, R = 2.5) {
  const wood = { tint: '#6e5c48', collide: false, minimap: false, grad: false };
  for (const zz of [cz - 0.26, cz + 0.26]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      b.box(cx + Math.cos(a) * R, cy + Math.sin(a) * R - 0.07, zz, 2 * Math.PI * R / 16 + 0.04, 0.14, 0.1, 'wood_planks', { ...wood, rz: a + Math.PI / 2 });
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      b.box(cx + Math.cos(a) * R / 2, cy + Math.sin(a) * R / 2 - 0.05, zz, R - 0.25, 0.1, 0.09, 'wood_planks', { ...wood, rz: a });
    }
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + 0.1;
    b.box(cx + Math.cos(a) * (R - 0.22), cy + Math.sin(a) * (R - 0.22) - 0.02, cz, 0.42, 0.04, 0.5, 'wood_planks', { ...wood, rz: a, tint: '#5e4e3c' });
  }
  b.cyl(cx, cy, cz, 0.32, 0.7, 'wood_dark', { axis: 'z', tint: '#4a3a2c', seg: 10, collide: false, minimap: false });
  b.cyl(cx, cy, cz + 0.9, 0.09, 1.6, 'metal_rust', { axis: 'z', seg: 8, collide: false, minimap: false });
  const box = new THREE.BoxGeometry(R * 1.85, R * 1.85, 0.66);
  for (const rz of [0, Math.PI / 4]) b.geom(box, cx, cy, cz, 'black', { rz, visual: false, collide: 'mesh' });
}

function funkhuegel(b, Y) {
  b.groundTiled(-132, -152, -108, -128, 'gravel', { cell: 2, y: Y });
  // Bunker (betretbar, Dach mit Brüstung, Außentreppe)
  const bunker = building(b, { x: -117, z: -135, w: 7, d: 5.5, floors: 1, fh: 2.7, y: Y, mat: 'concrete', tint: '#a8a49a', openings: [{ side: 's', at: -1.5, w: 1.1, h: 2.1, kind: 'door', leaf: 'open' }, { side: 'n', at: 0, w: 2.0, h: 0.4, sill: 1.35, kind: 'window' }, { side: 'w', at: 0, w: 1.4, h: 0.4, sill: 1.35, kind: 'window' }, { side: 'e', at: -0.8, w: 1.4, h: 0.4, sill: 1.35, kind: 'window' }], roof: { parapet: 0.9, mat: 'concrete', tint: '#9c988e' }, floorMat: 'concrete', interiorFactor: 0.45 });
  b.noNav(-121, -138.5, -113, -131.5, Y + 2.2, Y + 20);
  mast(b, -128, Y, -146, 26);
  b.box(-126, Y, -141, 1.4, 1.8, 0.9, 'metal_painted', { tint: '#4b5a46', minimap: 'cover' });
  sandbags(b, -131, -132, -125, -129, { rows: 4, y: Y }); sandbags(b, -112, -148, -106, -146, { rows: 4, y: Y });
  sandbags(b, -133, -150, -131, -144, { rows: 4, y: Y });
  // maps-expand: zweites Schützenloch (Sandsack-U) südöstlich der Flagge E
  sandbags(b, -122, -152, -117, -153, { rows: 4, y: Y }); sandbags(b, -122, -152, -123, -148, { rows: 4, y: Y });
  crateStack(b, -110, -141, { ry: 0.4, y: Y });
  // Bunker-Einrichtung + MG-Stellung am Aufgang (Furtweg von Süden)
  Innen.bunkerInnen(b, innen(bunker, 0.3, Y));
  mgNest(b, -117.0, -126.5, { y: Y, ry: Math.atan2(-138 + 117, -86 + 126.5) });
  return {};
}

/**
 * Erdbrücke links der Landstraße (vom Startbereich A aus gesehen, 55 m westlich der Brücke): Damm und Feldweg sind
 * Gelände (terrain.dams/roads), hier nur der Betondurchlass in Flussmitte – Werte passend zu terrain.dams.
 */
function damm(b) {
  durchlass(b, { ax: -18, zc: -18, c: 3, hz: 3, top: 0.75, pipeY: -1.15 });
  return {};
}

const H_Y = 15; // Plateauhöhe Funkhügel

// ---------------------------------------------------------------------------
// Kartenbeschreibung
// ---------------------------------------------------------------------------
export default {
  id: 'grenzland',
  name: 'Grenzland',
  scale: 'gross',
  seed: 4711,
  bounds: { minX: -250, maxX: 250, minZ: -250, maxZ: 250, minY: -8, maxY: 90 },
  ambience: 'range',
  assets: { hdri: 'zwartkops_straight_morning' },
  defaultSurface: 'grass',
  wallMargin: 48,
  lighting: {
    sun: { elevation: 36, azimuth: 152, color: '#fff1dc', intensity: 3.6 },
    sky: { turbidity: 4.2, rayleigh: 1.5, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.48, clouds: { coverage: 0.42, density: 0.45, scale: 0.00016, elevation: 0.5 }, hazeHigh: 0.1, hazeAmount: 0.8, hdriIntensity: 0.55 },
    hemi: { sky: '#cbd9e8', ground: '#5d6046', intensity: 0.7, hdriIntensity: 0.35 },
    env: { intensity: 1.0, ground: '#6a6c52', groundIntensity: 0.5, tint: '#eef3ff', hdriIntensity: 0.6 },
    // atmosphere-weather: Höhennebel über dem Tal (baseY = Wasserspiegel, Skalenhöhe ≈ 45 m), Gegenlicht-Einstreuung;
    // lineare Nebelweite bleibt für Materialien ohne Welt-Shading
    fog: { color: '#b9c7d2', nearFactor: 0.18, density: 0.003, falloff: 0.022, start: 25, max: 0.9, sun: 0.7, sunExp: 4 },
    // Fernkaskade über die ganze Karte (eine Karte, ≈ 0,3 m/Texel), Nahkaskade 40 m (Bäume scharf)
    shadow: { size: 60, bias: -0.0004, normalBias: 0.04, near: 40, farMaxY: 60 },
    exposure: 1.0,
    // Staub/Pollen im Sonnenlicht (Waldränder, Scheune), Strahlen durch Scheunen-/Hallenöffnungen
    atmos: { beams: 0.022, beamG: 0.45, dust: 0.8, dustSize: 0.014 },
  },
  water: { color: '#2b4a40' },

  // Gelände (terrain/generate.js)
  terrain: {
    size: 640, res: 1, seed: 4711,
    base: { amp: 4.2, scale: 170, octaves: 5, offset: 2.4 },
    detail: { amp: 0.32, scale: 10 },
    hills: [
      { x: -120, z: -140, r: 72, h: 14 }, { x: -205, z: -110, r: 75, h: 9 }, { x: 205, z: 125, r: 85, h: 11 },
      { x: -85, z: 175, r: 65, h: 7 }, { x: 105, z: 40, r: 55, h: 5 }, { x: 80, z: -175, r: 60, h: 8 }, { x: 215, z: -150, r: 60, h: 10 },
    ],
    edge: { start: 262, end: 330, height: 42 },
    waterY: -1.1,
    river: {
      pts: [[-340, -32], [-250, -40], [-200, -46], [-150, -28], [-100, -14], [-62, -14], [0, -21], [36, -28], [40, -30], [70, -44], [110, -56], [170, -46], [240, -22], [340, -34]],
      width: 15, depth: 2.2, bank: 12,
      fords: [{ x: -150, z: -28, r: 9, depth: 0.35 }, { x: 196, z: -38, r: 8, depth: 0.4 }],
    },
    pads: [
      { x: -3, z: 72, w: 118, d: 86, y: 0, blend: 18 },           // Dorf
      { x: -150, z: 109, w: 76, d: 62, y: 0, blend: 16 },         // Gehöft
      { x: 152, z: -112, w: 78, d: 80, y: 0, blend: 16 },         // Kieswerk
      { x: -62, z: 15, w: 30, d: 22, y: 0, blend: 8 },            // Mühle
      { x: 34, z: -1, w: 24, d: 10, y: 0.6, blend: 8 },          // Brückenkopf Süd
      { x: 48, z: -53, w: 24, d: 10, y: 0.6, blend: 8 },         // Brückenkopf Nord
      { x: -120, z: -140, w: 34, d: 34, y: H_Y, blend: 10 },      // Funkhügel
      { x: 60, z: 219, w: 72, d: 46, y: 0, blend: 16 },           // HQ A
      { x: -20, z: -222, w: 72, d: 48, y: 0, blend: 16 },         // HQ B
    ],
    roads: [
      { id: 'hauptstrasse', name: 'Landstraße', kind: 'asphalt', width: 7, pts: [[40, 335], [52, 260], [55, 218], [36, 170], [20, 140], [-5, 72], [14, 36], [25, 12], [36, -14], [44, -46], [58, -76], [100, -96], [150, -110], [132, -160], [80, -205], [-20, -222], [-34, -280], [-30, -335]], bridge: { a: [36, -14], b: [44, -46], y: 0.6 } },
      { id: 'dorfweg', name: 'Dorfweg', kind: 'gravel', width: 4.5, pts: [[-5, 72], [-70, 88], [-150, 105], [-200, 138], [-262, 160]] },
      { id: 'furtweg', name: 'Furtweg', kind: 'dirt', width: 3.6, pts: [[-150, 105], [-162, 40], [-150, -28], [-138, -86], [-121, -136], [-70, -178], [-20, -222]] },
      { id: 'werkstrasse', name: 'Werkstraße', kind: 'gravel', width: 5, pts: [[150, -110], [186, -60], [196, -38], [176, 30], [120, 92], [55, 218]] },
      { id: 'muehlweg', name: 'Mühlweg', kind: 'dirt', width: 3.2, pts: [[-5, 72], [-40, 40], [-62, 16]] },
      // Feldweg links der Landstraße (Blick von Start A nach Norden) zur Erdbrücke über den Fluss
      { id: 'dammweg', name: 'Dammweg', kind: 'dirt', width: 3.6, pts: [[16, 31], [6, 22], [-6, 10], [-15, -1], [-18, -10], [-18, -27], [-17, -38], [-11, -50]] },
    ],
    // Erdbrücke: Damm quer über den Fluss (Krone 6 m auf y 0,5, Böschung 1 : 1,5) mit Betonrohr-Durchlass in Flussmitte;
    // Stirn-/Flügelwände und Rohr baut die Ortschaft „damm“ (Achse x = −18, Durchlass z = −18 → Aussparung z −21…−15)
    dams: [{ a: [-18, -4], b: [-18, -31], y: 0.5, crown: 6, slope: 1.5, culverts: [{ at: [-18, -18], half: 3, out: 3 }] }],
    fields: [
      { x: -150, z: 45, w: 60, d: 34, ry: 0.15, kind: 'acker' }, { x: -215, z: 92, w: 40, d: 60, ry: -0.1, kind: 'acker' },
      { x: -95, z: 140, w: 46, d: 38, ry: 0.35, kind: 'acker' }, { x: 45, z: 140, w: 56, d: 36, ry: -0.3, kind: 'acker' },
      { x: -70, z: 50, w: 36, d: 26, ry: 0.2, kind: 'stoppel' }, { x: 95, z: -20, w: 40, d: 30, ry: 0.5, kind: 'stoppel' },
      { x: 150, z: 170, w: 50, d: 40, ry: 0.1, kind: 'acker' },
    ],
    forests: [
      { x: -200, z: -160, r: 58 }, { x: -60, z: -118, r: 42 }, { x: 118, z: 28, r: 46 }, { x: -232, z: 25, r: 44 },
      { x: 205, z: 175, r: 46 }, { x: -92, z: 192, r: 36 }, { x: 70, z: -182, r: 40 }, { x: 222, z: -118, r: 36 }, { x: 10, z: -110, r: 30 },
    ],
  },

  // Vegetation (terrain/vegetation.js)
  vegetation: {
    seed: 77,
    forests: [
      { x: -200, z: -160, r: 58, density: 0.72, spruce: 0.85 }, { x: -60, z: -118, r: 42, density: 0.62, spruce: 0.5 },
      { x: 118, z: 28, r: 46, density: 0.6, spruce: 0.35 }, { x: -232, z: 25, r: 44, density: 0.68, spruce: 0.7 },
      { x: 205, z: 175, r: 46, density: 0.7, spruce: 0.75 }, { x: -92, z: 192, r: 36, density: 0.55, spruce: 0.4 },
      { x: 70, z: -182, r: 40, density: 0.7, spruce: 0.9 }, { x: 222, z: -118, r: 36, density: 0.65, spruce: 0.6 },
      { x: 10, z: -110, r: 30, density: 0.5, spruce: 0.3 },
    ],
    ring: { density: 0.6, spruce: 0.8, inset: -8, step: 6.5 },
    scatter: { count: 70 },
    hedges: [
      { pts: [[-190, 74], [-112, 70]], trees: 0.2 }, { pts: [[-112, 70], [-110, 144]], trees: 0.15 },
      { pts: [[16, 116], [74, 110]], trees: 0.3 }, { pts: [[-118, 26], [-40, 30]], trees: 0.25 },
      { pts: [[70, -5], [120, -35]], trees: 0.2 }, { pts: [[-60, 120], [-20, 150], [10, 160]], trees: 0.35 },
      // maps-expand: Heckenreihen neben den neuen Lesesteinmauern (Sichtschutz, keine Kugeldeckung)
      { pts: [[-10, 22], [25, 16]], trees: 0.1 }, { pts: [[72, -57.5], [100, -68]], trees: 0.15 },
      { pts: [[-95, -98], [-70, -83]], trees: 0.1 }, { pts: [[10, 168], [45, 175]], trees: 0.2 },
    ],
    reeds: { offset: 8.6 },
    rocks: {
      count: 85, extra: [[-104, -128, 2.2], [-136, -156, 1.8], [40, -60, 1.6], [-70, -40, 2.0]],
      // maps-expand: Lesesteinmauern entlang der Feldgrenzen in den offenen Abschnitten zwischen den Flaggen/HQs
      walls: [
        [[-10, 19], [25, 13]], [[30, 6], [62, 0]], [[-32, -4], [0, -12]],            // Dorf ↔ Brücke
        [[-96, 92], [-70, 100]], [[-100, 55], [-74, 47]],                             // Dorf ↔ Gehöft
        [[70, -55], [100, -66]], [[106, -40], [130, -58]],                            // Brücke ↔ Kieswerk
        [[-95, -95], [-70, -80]], [[-60, -60], [-30, -70]],                           // Funkhügel ↔ Mühle/Brücke
        [[10, 165], [45, 172]], [[52, 150], [80, 140]],                               // HQ A ↔ Dorf
        [[-30, -160], [5, -150]], [[15, -122], [40, -106]],                           // HQ B ↔ Brücke/Funkhügel
      ],
      // Felsgruppen [x, z, Anzahl, Radius] mitten in großen Freiflächen
      clusters: [[20, 40, 4, 4], [-38, 30, 4, 4], [78, 22, 4, 5], [96, -96, 4, 4], [-86, -66, 4, 4], [-128, 58, 3, 4],
        [32, 146, 4, 5], [-6, -136, 4, 4], [120, -30, 3, 4], [-88, 124, 3, 4], [64, -118, 4, 4], [-40, -98, 4, 4]],
    },
  },
  clearings: [[-62, 14, 18], [40, -30, 26]],

  // Ortschaften (je ein MapBuilder; Boden y = 0 bzw. Plateau)
  sites: [
    { id: 'dorf', name: 'Dorf', bounds: { minX: -62, maxX: 52, minZ: 28, maxZ: 116 }, build: (b) => dorf(b), seeds: [[-6, 74], [-26, 58]], height: 20 },
    { id: 'gehoeft', name: 'Gehöft', bounds: { minX: -188, maxX: -112, minZ: 78, maxZ: 140 }, build: (b) => gehoeft(b), seeds: [[-148, 106]] },
    { id: 'bruecke', name: 'Brücke', bounds: { minX: 22, maxX: 58, minZ: -58, maxZ: -4 }, clear: { minX: 26, maxX: 54, minZ: -54, maxZ: -6 }, build: (b) => bruecke(b), seeds: [[40, -30, 0.6]], height: 10, spacing: 1.8 },
    { id: 'kieswerk', name: 'Kieswerk', bounds: { minX: 114, maxX: 192, minZ: -152, maxZ: -74 }, build: (b) => kieswerk(b), seeds: [[152, -112]], height: 18, spacing: 1.7 },
    { id: 'muehle', name: 'Mühle', bounds: { minX: -76, maxX: -48, minZ: 4, maxZ: 26 }, build: (b) => muehle(b), seeds: [[-62, 14]], spacing: 1.6 },
    { id: 'funkhuegel', name: 'Funkhügel', y: H_Y, bounds: { minX: -136, maxX: -104, minZ: -156, maxZ: -124 }, build: (b) => funkhuegel(b, H_Y), seeds: [[-121, -142, H_Y]], height: 12, spacing: 1.7 },
    { id: 'hq_a', name: 'Hauptquartier A', bounds: { minX: 24, maxX: 96, minZ: 196, maxZ: 242 }, nav: true, build: (b) => hq(b, { x: 60, z: 219, side: 'A', pads: [[78, 228, 'tank'], [78, 212, 'tank'], [40, 230, 'jeep'], [40, 220, 'jeep'], [40, 210, 'jeep']] }), seeds: [[60, 212]], spacing: 2.2 },
    { id: 'hq_b', name: 'Hauptquartier B', bounds: { minX: -56, maxX: 16, minZ: -246, maxZ: -198 }, nav: true, build: (b) => hq(b, { x: -20, z: -222, side: 'B', pads: [[-38, -213, 'tank'], [-38, -229, 'tank'], [2, -212, 'jeep'], [2, -222, 'jeep'], [2, -232, 'jeep']] }), seeds: [[-20, -215]], spacing: 2.2 },
    // zuletzt angehängt: Builder-Zufall der übrigen Ortschaften bleibt gleich (seed + k·101)
    { id: 'damm', name: 'Erdbrücke', bounds: { minX: -30, maxX: -6, minZ: -34, maxZ: -2 }, clear: { minX: -28, maxX: -8, minZ: -31, maxZ: -12.5 }, build: (b) => damm(b), seeds: [[-18, -9, 0.8], [-18, -27, 1.2]], height: 8, spacing: 1.5 },
  ],
  // Nach dem Gelände gebaut (brauchen Geländehöhen): Grenzanlage als sichtbare, begehbare Kartengrenze 18 m hinter der
  // Spielfläche (statt unsichtbarer Wand; die alte Wand bei wallMargin bleibt als Sicherheitsnetz dahinter)
  lateSites: [
    { id: 'grenze', name: 'Grenzanlage', bounds: { minX: -280, maxX: 280, minZ: -280, maxZ: 280 }, chunkSize: 80, build: (b, ctx) => grenzanlage(b, { hf: ctx.hf, roads: ctx.roads, line: grenzLinie(268, 24) }) },
  ],

  // Flaggen: Eroberung A–E, Herrschaft A–C (Dorf, Mühle, Brücke)
  flags: {
    cq: [
      { id: 'A', name: 'Gehöft', x: -148, z: 106, radius: 24, heightBand: [-3, 9] },
      { id: 'B', name: 'Dorf', x: -6, z: 74, radius: 26, heightBand: [-3, 9] },
      { id: 'C', name: 'Brücke', x: 40, z: -30, y: 0.6, radius: 24, heightBand: [-6, 8] },
      { id: 'D', name: 'Kieswerk', x: 152, z: -112, radius: 26, heightBand: [-3, 10] },
      { id: 'E', name: 'Funkhügel', x: -121, z: -142, y: H_Y, radius: 20, heightBand: [-4, 8] },
    ],
    dom: [
      { id: 'A', name: 'Dorf', x: -6, z: 74, radius: 9 },
      { id: 'B', name: 'Mühle', x: -62, z: 14, radius: 8 },
      { id: 'C', name: 'Brücke', x: 40, z: -30, y: 0.6, radius: 9 },
    ],
  },
  // Startpunkte [x, z, yaw?, y?]: Teamkampf im Mittelteil (Dorf ↔ Nordufer), HQ für Eroberung
  spawns: {
    A: [[-25, 122, 0], [-12, 126, 0], [0, 120, 0], [12, 124, 0], [28, 120, 0], [40, 116, 0], [-38, 116, 0], [-5, 132, 0]],
    B: [[25, -62, Math.PI], [10, -60, Math.PI], [56, -70, Math.PI], [70, -74, Math.PI], [86, -68, Math.PI], [40, -78, Math.PI], [62, -86, Math.PI], [-6, -58, Math.PI]],
    ffa: [[-30, 104], [26, 30], [-46, 46], [56, 72], [-62, 30], [70, -74], [18, -64], [-20, 128], [46, 110], [-78, 72]],
    hq: {
      A: [[52, 206, 0], [58, 204, 0], [64, 206, 0], [70, 204, 0], [52, 200, 0], [60, 198, 0], [68, 200, 0], [46, 204, 0]],
      B: [[-28, -236, Math.PI], [-20, -238, Math.PI], [-12, -236, Math.PI], [-4, -238, Math.PI], [-28, -242, Math.PI], [-18, -242, Math.PI], [-8, -242, Math.PI], [-34, -238, Math.PI]],
    },
  },
  // Fahrzeug-Stellplätze (Fahrzeug-Agent): Panzer/Geländewagen je HQ; Traktor „Gertrud“ in der Scheune (Geheimnis)
  vehicles: [
    { id: 'A-panzer-1', team: 'A', kind: 'tank', x: 78, z: 228, yaw: 0 }, { id: 'A-panzer-2', team: 'A', kind: 'tank', x: 78, z: 212, yaw: 0 },
    { id: 'A-jeep-1', team: 'A', kind: 'jeep', x: 40, z: 230, yaw: 0 }, { id: 'A-jeep-2', team: 'A', kind: 'jeep', x: 40, z: 220, yaw: 0 }, { id: 'A-jeep-3', team: 'A', kind: 'jeep', x: 40, z: 210, yaw: 0 },
    { id: 'B-panzer-1', team: 'B', kind: 'tank', x: -38, z: -213, yaw: Math.PI }, { id: 'B-panzer-2', team: 'B', kind: 'tank', x: -38, z: -229, yaw: Math.PI },
    { id: 'B-jeep-1', team: 'B', kind: 'jeep', x: 2, z: -212, yaw: Math.PI }, { id: 'B-jeep-2', team: 'B', kind: 'jeep', x: 2, z: -222, yaw: Math.PI }, { id: 'B-jeep-3', team: 'B', kind: 'jeep', x: 2, z: -232, yaw: Math.PI },
    { id: 'gertrud', team: null, kind: 'tractor', name: 'Gertrud', secret: true, x: -134.5, z: 119.5, yaw: Math.PI },
  ],
  secrets: [
    { id: 'grenzland-zwerg', name: 'Der Heuboden-Zwerg', hint: 'Wer sich duckt, findet mehr als Stroh.', x: -129.4, y: 3.2, z: 114.1, trigger: { type: 'proximity', radius: 1.6 } },
    { id: 'grenzland-gertrud', name: 'Gertrud', hint: 'Die Scheune hat einen Stammgast.', x: -134.5, y: 0.2, z: 119.5, trigger: { type: 'proximity', radius: 3.2 } },
  ],
};
