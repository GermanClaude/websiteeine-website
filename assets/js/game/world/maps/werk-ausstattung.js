// NULLPUNKT — Werk: Bauteile und Ausstattung aus Primitiven (Owner: world). Offene Stahltreppen mit passender
// Kollision, Coil-Lager auf Kanthölzern (Pyramide, verkeilt), Decken- und Pendelleuchten mit Aufhängung,
// Flutlichtmast mit Zielrichtung, Waggon-Schiebetüren mit Griff, MG-Nest, Büro-/Pausen-Einrichtung.
// Alles statisch und deterministisch: kein Math.random, Varianten nur positionsabhängig (hash01). Kollision hängt
// weder von der Grafikstufe noch von der Bibliothek ab: Bibliotheksmodelle bekommen keine eigene Kollision, sondern
// Quader aus festen Maßen (die Modelle selbst bzw. ihr prozeduraler Ersatz sind auf jeder Stufe sichtbar).
import * as THREE from 'three';
import { frame, hash01, chair, sandbags } from '../props.js';
import { railing } from '../arch.js';

const DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const KEIN = { collide: false, minimap: false };

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------
/**
 * Konvexer Kollisionskörper (nur Kollision, unsichtbar) aus 4 unteren und 4 oberen Ecken [x, y, z]; die oberen
 * liegen jeweils über den unteren (gleiche Reihenfolge). Dreiecke werden nach außen gewendet.
 */
export function koerper(b, unten, oben) {
  const v = [...unten, ...oben];
  const c = [0, 1, 2].map(k => v.reduce((s, p) => s + p[k], 0) / 8);
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const pos = [];
  for (const q of quads) for (const [i, j, k] of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
    const A = v[i]; let B = v[j], C = v[k];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.hypot(n[0], n[1], n[2]) < 1e-7) continue; // entartet (Keilspitze)
    const m = [(A[0] + B[0] + C[0]) / 3 - c[0], (A[1] + B[1] + C[1]) / 3 - c[1], (A[2] + B[2] + C[2]) / 3 - c[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) [B, C] = [C, B];
    pos.push(...A, ...B, ...C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  b.geom(g, 0, 0, 0, 'black', { visual: false, collide: 'mesh' });
  g.dispose();
}

/** Stab (Zylinder) von A nach B. */
export function stab(b, A, B, r, mat, o = {}) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.hypot(dx, dy, dz);
  if (L < 0.005) return;
  if (Math.abs(dy) > 0.98 * L) { b.cyl(A[0], Math.min(A[1], B[1]), A[2], r, L, mat, { seg: o.seg ?? 6, collide: false, minimap: false, ao: false, ...o }); return; }
  b.cyl((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, r, L, mat, { axis: 'x', ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, Math.hypot(dx, dz)), seg: o.seg ?? 6, collide: false, minimap: false, ao: false, ...o });
}

/** Gedrehter Kollisionsquader (Unterkante-Mitte x, y, z) in festen Maßen – für Bibliotheksmodelle und Möbel. */
function block(b, x, y, z, w, h, d, ry, minimap = 'prop') {
  b.box(x, y, z, w, h, d, 'black', { ry, visual: false, minimap });
}

const zylCache = new Map();
/**
 * Achteckiger Zylinder-Kollisionskörper (liegende Achse lokal x bei Drehung ry), Mitte (x, yc, z). Eckradius 4 %
 * über r: Flächen liegen knapp innen, Ecken knapp außen (±4 % statt eines Quaders, der an den Rundungen bis 41 %
 * übersteht).
 */
export function zylKoerper(b, x, yc, z, r, len, ry = 0) {
  const k = r + ',' + len;
  let g = zylCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(r * 1.04, r * 1.04, len, 8, 1).toNonIndexed(); g.deleteAttribute('uv'); zylCache.set(k, g); }
  b.geom(g, x, yc, z, 'black', { visual: false, collide: 'mesh', rz: Math.PI / 2, ry });
}

// ---------------------------------------------------------------------------
// Stahltreppe mit offener Unterseite
// ---------------------------------------------------------------------------
/**
 * Stahltreppe (Stufen, Wangen, Geländer wie arch.stairs), aber mit passender Kollision: Lauffläche als dünne
 * Schrägplatte, unter der man ab Kopfhöhe hindurchgehen kann; der niedrige Teil ist als geschlossener Keil hinter
 * Lochblech-Verkleidung ausgeführt (sichtbar = fest, kein Einklemmen im spitzen Winkel), mit Stützenpaar am Ende.
 * Geländer-Kollision folgt dem Handlauf (kein unsichtbarer Riegel bis 6 m Höhe).
 * o: { x, z (Mitte unterste Stufenkante), y0, y1, w, run, dir: 'n'|'s'|'e'|'w', rail: true|'left'|'right', railFrom,
 *      railTint, closeH (Höhe des geschlossenen Teils, 2,1 m), tint }
 */
export function stahlTreppe(b, o) {
  const y0 = o.y0 ?? 0, y1 = o.y1, rise = y1 - y0, w = o.w ?? 1.3;
  const run = o.run ?? Math.max(1.2, rise / 0.62);
  const [dx, dz] = DIR[o.dir || 'n'];
  const ry = Math.atan2(dx, dz), rx = -dz, rz = dx;
  const P = (f, r) => [o.x + dx * f + rx * r, o.z + dz * f + rz * r];
  const W = (f, r, y) => { const [x, z] = P(f, r); return [x, y, z]; };
  const n = Math.max(2, Math.round(rise / 0.19)), sr = rise / n, sd = run / n;
  const ang = Math.atan2(rise, run), len = Math.hypot(rise, run), tan = rise / run;
  const line = f => y0 + tan * f; // Lauflinie (Stufenvorderkanten)
  // Stufen (Riffelblech) + Wangen
  for (let i = 0; i < n; i++) {
    const [cx, cz] = P((i + 0.5) * sd, 0);
    b.box(cx, y0 + (i + 1) * sr - 0.05, cz, w, 0.05, sd + 0.04, 'metal_tread', { ry, ...KEIN, grad: false, tint: o.tint, ao: false });
  }
  for (const side of [-1, 1]) {
    const [cx, cz] = P(run / 2, side * (w / 2 + 0.04));
    b.box(cx, y0 + rise / 2 - 0.14, cz, 0.06, 0.28, len, 'metal_painted', { ry, rx: -ang, tint: '#3d4247', ...KEIN, grad: false, uv: 'local' });
  }
  // Kollision 1: geschlossener Keil bis closeH (darunter passt niemand aufrecht hindurch)
  const hC = Math.min(rise, o.closeH ?? 2.1), fC = hC / tan;
  { const [cx, cz] = P(fC / 2, 0); b.wedge(cx, y0, cz, w, hC, fC, 'black', { ry, visual: false, minimap: 'stairs' }); }
  // Verkleidung des geschlossenen Teils: Lochblech-Dreiecke unter den Wangen + Rückwand, Stützen am Übergang
  const fA = 0.12 / tan; // ab hier liegt die Wangen-Unterkante über dem Boden
  if (fC - fA > 0.3) {
    for (const side of [-1, 1]) {
      const [cx, cz] = P((fA + fC) / 2, side * (w / 2 + 0.045));
      b.wedge(cx, y0, cz, 0.02, hC - 0.12, fC - fA, 'metal_grate', { ry, tint: '#6a737a', minimap: false, collide: false });
      const [sx, sz] = P(fC, side * (w / 2 + 0.04));
      b.box(sx, y0, sz, 0.09, hC - 0.13, 0.09, 'metal_painted', { ry, tint: '#3d4247', ...KEIN });
    }
    const [bx, bz] = P(fC + 0.03, 0);
    b.box(bx, y0, bz, w + 0.08, hC - 0.16, 0.02, 'metal_grate', { ry, tint: '#6a737a', ...KEIN });
    const [qx, qz] = P(fC, 0);
    b.box(qx, y0 + hC - 0.2, qz, w + 0.1, 0.08, 0.08, 'metal_painted', { ry, tint: '#3d4247', ...KEIN, grad: false });
  }
  // Kollision 2: Laufplatte (0,2 m) von fC bis zum Austritt – darunter frei
  if (run - fC > 0.05) {
    const fa = Math.max(0, fC - 0.05), T = 0.2, hw = w / 2;
    koerper(b,
      [W(fa, -hw, line(fa) - T), W(fa, hw, line(fa) - T), W(run, hw, line(run) - T), W(run, -hw, line(run) - T)],
      [W(fa, -hw, line(fa)), W(fa, hw, line(fa)), W(run, hw, line(run)), W(run, -hw, line(run))]);
    const [mx, mz] = P((fC + run) / 2, 0);
    b.footprints.push({ x: mx, z: mz, hw, hd: (run - fC) / 2, ry, y0: y0 + hC, y1, kind: 'stairs' });
  }
  // Geländer: sichtbar wie arch.railing, Kollision als schräges Band entlang des Handlaufs (Lauflinie −0,25 … +1,15 m)
  if (o.rail) {
    const sides = o.rail === 'left' ? [-1] : o.rail === 'right' ? [1] : [-1, 1];
    const f0 = Math.min(run * 0.5, o.railFrom ?? 0);
    for (const side of sides) {
      const r = side * (w / 2 + 0.02);
      const [ax, az] = P(f0, r), [bx, bz] = P(run, r);
      railing(b, ax, az, bx, bz, line(f0), { y1, h: 1.0, posts: Math.max(2, Math.round((run - f0) / 1.2) + 1), tint: o.railTint, collider: false });
      const r0 = r - 0.04, r1 = r + 0.04;
      koerper(b,
        [W(f0, r0, line(f0) - 0.25), W(f0, r1, line(f0) - 0.25), W(run, r1, line(run) - 0.25), W(run, r0, line(run) - 0.25)],
        [W(f0, r0, line(f0) + 1.15), W(f0, r1, line(f0) + 1.15), W(run, r1, line(run) + 1.15), W(run, r0, line(run) + 1.15)]);
    }
  }
  // Wegpunkte unten/oben + entlang des Laufs (wie arch.stairs)
  const [bx0, bz0] = P(-0.7, 0), [tx, tz] = P(run + 0.7, 0);
  b.navPoint(bx0, y0 + 0.2, bz0);
  const [sx0, sz0] = P(0.3, 0), [sx1, sz1] = P(run - 0.2, 0);
  b.navLine(sx0, line(0.3) + 0.25, sz0, sx1, line(run - 0.2) + 0.25, sz1, 1.1);
  b.navPoint(tx, y1 + 0.2, tz);
  return { top: P(run, 0), run };
}

// ---------------------------------------------------------------------------
// Stahlcoils
// ---------------------------------------------------------------------------
/** Stahlcoil liegend: Achse = lokal x bei Drehung ry, (x, z) Mitte, y Unterkante. Umreifung, Augenband, Kollision achteckig. */
export function coil(b, x, y, z, ry = 0, o = {}) {
  const r = o.r ?? 0.85, w = o.w ?? 1.3, f = frame(b, x, y, z, ry);
  f.cyl(0, r, 0, r, w, 'metal_galvanized', { axis: 'x', tint: o.tint || '#9aa0a4', ...KEIN, seg: 18 });
  for (const sx of [-1, 1]) f.cyl(sx * (w / 2 + 0.003), r, 0, r * 0.42, 0.01, 'black', { axis: 'x', ...KEIN, seg: 14, ao: false });
  // Umreifung (zwei Ringbänder) + Augenband über den Scheitel durch das Auge
  for (const sx of [-0.28, 0.28]) f.cyl(sx * w, r, 0, r + 0.006, 0.035, 'metal_painted', { axis: 'x', tint: '#2f4a6a', ...KEIN, seg: 18, ao: false });
  f.box(0, 2 * r - 0.002, 0, w + 0.02, 0.008, 0.035, 'metal_painted', { tint: '#2f4a6a', ...KEIN, grad: false, ao: false });
  for (const sx of [-1, 1]) f.box(sx * (w / 2 + 0.008), r * 1.42, 0, 0.008, r * 0.58, 0.035, 'metal_painted', { tint: '#2f4a6a', ...KEIN, grad: false, ao: false });
  zylKoerper(b, x, y + r, z, r, w, ry);
  b.footprints.push({ x, z, hw: w / 2, hd: r, ry, y0: y, y1: y + 2 * r, kind: 'cover' });
}

/**
 * Coil-Lager: n Coils nebeneinander (Achsen parallel, quer zur Reihe = lokal z), jedes auf zwei Lagerhölzern mit
 * vier Keilklötzen; o.top legt ein Coil in die Mulde zwischen den ersten beiden (Pyramide). Reihe entlang lokal x.
 * Verbraucht genau n Zufallszahlen (Farbtöne) – wie die frühere Reihe.
 */
export function coilLager(b, x, z, ry, n = 3, o = {}) {
  const r = 0.85, w = 1.3, d = 2 * r + 0.12, L = n * d;
  const f = frame(b, x, 0, z, ry);
  const axisRy = ry - Math.PI / 2; // Coil-Achse = lokal z der Reihe
  const bz = 0.36, hb = 0.12, hk = 0.16, ai = 0.42; // Lagerholz-Abstand, Höhen, Keil-Innenkante
  const yc = hb + hk + Math.sqrt(r * r - ai * ai); // Coil-Mitte auf den Keilkanten
  for (const lz of [-bz, bz]) f.box(0, 0, lz, L + 0.3, hb, 0.22, 'wood_planks', { tint: '#6a5440', ...KEIN });
  const xs = [];
  for (let i = 0; i < n; i++) {
    const lx = -L / 2 + d / 2 + i * d;
    xs.push(lx);
    const tint = b.pick(['#9aa0a4', '#8a8f94', '#a69a8a']);
    for (const sx of [-1, 1]) for (const lz of [-bz, bz]) f.box(lx + sx * (ai + 0.12), hb, lz, 0.24, hk, 0.26, 'wood_dark', { tint: '#5a4634', ...KEIN, grad: false });
    const [px, pz] = f.P(lx, 0);
    coil(b, px, yc - r, pz, axisRy, { r, w, tint });
  }
  if (o.top && n >= 2) {
    const lx = (xs[0] + xs[1]) / 2, yTop = yc + Math.sqrt(4 * r * r - (d / 2) * (d / 2));
    const [px, pz] = f.P(lx, 0);
    coil(b, px, yTop - r, pz, axisRy, { r, w, tint: '#a0a6aa' });
  }
}

// ---------------------------------------------------------------------------
// Leuchten (mit Aufhängung) – Licht nur gebacken bzw. ein echtes Licht ab „hoch“
// ---------------------------------------------------------------------------
const LAMPE = { sodium: ['lamp_sodium', '#ffa850', '#ffae5a'], warm: ['lamp_warm', '#ffd090', '#ffd59a'], cool: ['lamp_cool', '#d8e6ff', '#e6f0ff'] };
const hochStufe = b => b.lookQuality === 'high' || b.lookQuality === 'ultra';

/**
 * Pendelleuchte: Deckenrosette an yTop, Pendelrohr bis zum Schirm (Oberkante yLamp + 0,5), Reflektorschirm, Leuchtmittel.
 * o: { kind, r (Schirm), light: { intensity, distance } | false, real (echtes Licht ab hoch) }
 */
export function pendel(b, x, z, yTop, yLamp, o = {}) {
  const [mat, glow, col] = LAMPE[o.kind || 'sodium'], r = o.r ?? 0.45;
  b.cyl(x, yTop - 0.04, z, 0.09, 0.04, 'metal_painted', { tint: '#2b2d30', ...KEIN, seg: 8, ao: false, grad: false });
  b.cyl(x, yLamp + 0.42, z, 0.018, yTop - 0.04 - (yLamp + 0.42), 'metal_galvanized', { ...KEIN, seg: 5, ao: false, grad: false });
  b.cyl(x, yLamp + 0.36, z, 0.07, 0.08, 'metal_painted', { tint: '#2b2d30', ...KEIN, seg: 8, ao: false, grad: false });
  b.cyl(x, yLamp, z, r, 0.38, 'metal_painted', { r1: r * 0.3, tint: '#2b2d30', ...KEIN, seg: 12, ao: false, grad: false });
  b.cyl(x, yLamp - 0.02, z, r * 0.9, 0.02, mat, { ...KEIN, seg: 12, ao: false, cast: false, grad: false });
  b.glow(x, yLamp - 0.2, z, { color: glow, size: o.glowSize ?? r * 5, intensity: o.glowI ?? 0.85 });
  if (o.light !== false) {
    const L = o.light || {};
    b.light('point', x, yLamp - 0.4, z, { color: col, intensity: L.intensity ?? 14, distance: L.distance ?? 12, realtime: !!(o.real && hochStufe(b)), priority: 2 });
  }
}

/** Leuchtstoff-Langfeldleuchte an der Decke (Unterseite yDecke), Länge len entlang ry. */
export function leuchtband(b, x, yDecke, z, ry, len = 1.25, o = {}) {
  const [mat, glow, col] = LAMPE[o.kind || 'cool'];
  b.box(x, yDecke - 0.07, z, len, 0.07, 0.2, 'metal_painted', { ry, tint: '#d8d8d2', ...KEIN, grad: false, ao: false });
  b.box(x, yDecke - 0.09, z, len - 0.06, 0.02, 0.14, mat, { ry, ...KEIN, grad: false, ao: false, cast: false });
  b.glow(x, yDecke - 0.16, z, { color: glow, size: o.glowSize ?? 1.1, intensity: o.glowI ?? 0.5 });
  if (o.light !== false) {
    const L = o.light || {};
    b.light('point', x, yDecke - 0.45, z, { color: col, intensity: L.intensity ?? 6, distance: L.distance ?? 7, realtime: !!(o.real && hochStufe(b)), priority: 2 });
  }
}

// ---------------------------------------------------------------------------
// Flutlichtmast mit Zielpunkt
// ---------------------------------------------------------------------------
/**
 * Flutlichtmast (h m), drei Strahler auf einem Querträger, alle auf den Zielpunkt (tx, tz) am Boden geneigt.
 * Lichtkegel als additives Boden-Decal (alle Stufen), ab „hoch“ zusätzlich ein echtes Spotlicht (o.spot).
 */
export function flutMast(b, x, z, o) {
  const h = o.h ?? 12, aim = Math.atan2(o.tx - x, o.tz - z), dist = Math.hypot(o.tx - x, o.tz - z);
  const tilt = Math.atan2(h, dist);
  const f = frame(b, x, 0, z, aim);
  const sodium = o.kind === 'sodium', mat = sodium ? 'lamp_sodium' : 'lamp_cool', gcol = sodium ? '#ffa040' : '#d8e6ff';
  b.cyl(x, 0, z, 0.22, 0.6, 'concrete', { seg: 10, minimap: 'pillar', tint: '#bdb8ad' });
  b.cyl(x, 0.6, z, 0.12, h - 0.6, 'metal_galvanized', { r1: 0.08, seg: 8, minimap: false });
  // Steigleiter + Querträger
  for (let y = 1.2; y < h - 0.3; y += 0.45) f.box(0, y, -0.16, 0.3, 0.03, 0.03, 'metal_galvanized', { ...KEIN, grad: false, ao: false });
  f.box(0, h - 0.05, 0, 2.3, 0.1, 0.1, 'metal_galvanized', { ...KEIN, grad: false });
  const c = Math.cos(tilt), s = Math.sin(tilt);
  for (const sx of [-0.78, 0, 0.78]) {
    // Gabelbügel + geneigtes Gehäuse (Front lokal +z zeigt um tilt nach unten) + Streuscheibe
    for (const k of [-1, 1]) f.box(sx + k * 0.27, h, 0, 0.03, 0.3, 0.04, 'metal_painted', { tint: '#2f3236', ...KEIN, grad: false, ao: false });
    f.box(sx, h + 0.08, -0.08, 0.5, 0.42, 0.24, 'metal_painted', { tint: '#2f3236', rx: tilt, ...KEIN, grad: false });
    const ly = 0.04 * c - 0.17 * s, lz = 0.04 * s + 0.17 * c - 0.08;
    f.box(sx, h + 0.08 + ly, lz, 0.44, 0.34, 0.02, mat, { rx: tilt, ...KEIN, ao: false, cast: false, grad: false });
    if (o.glow !== false) {
      const gy = 0.21 * c - 0.2 * s, gz = 0.21 * s + 0.2 * c - 0.08;
      const [gx, gzz] = f.P(sx, gz);
      b.glow(gx, h + 0.08 + gy, gzz, { color: gcol, size: o.glowSize ?? 2.2 });
    }
  }
  // Lichtkegel auf dem Boden (gestreckt in Strahlrichtung)
  const pool = o.pool ?? 9;
  b.decal(o.tx, 0.016, o.tz, pool * 0.8, pool * 1.25, 'puddle', { kind: 'light', tint: sodium ? '#ff9a3c' : '#cfe0ff', opacity: 0.26, ry: aim });
  b.decal(o.tx, 0.017, o.tz, pool * 0.4, pool * 0.6, 'puddle', { kind: 'light', tint: sodium ? '#ffb060' : '#e6f0ff', opacity: 0.2, ry: aim + 0.3 });
  if (o.spot && hochStufe(b)) {
    const [lx, lz] = f.P(0, 0.2);
    b.light('spot', lx, h, lz, { tx: o.tx, ty: 0, tz: o.tz, color: sodium ? '#ffb468' : '#e6f0ff', intensity: o.intensity ?? 180, distance: o.distance ?? dist * 1.9, angle: 0.5, penumbra: 0.75, priority: 2, bake: false });
  }
}

// ---------------------------------------------------------------------------
// Güterwagen: Schiebetür mit Laufschiene, Griff und Riegel
// ---------------------------------------------------------------------------
/** Schiebetür an der Wagenseite (Außenfläche bei zFace, Normale nz = ±1), Mitte x, Unterkante y, Breite w, Höhe h. */
export function schiebetuer(b, x, y, zFace, nz, w, h, tint) {
  const zf = zFace + nz * 0.03;
  b.box(x, y, zf, w, h, 0.06, 'metal_painted', { tint, ...KEIN, grad: false });
  // Sicken (senkrechte Versteifungen)
  for (let k = 1; k < 4; k++) b.box(x - w / 2 + (w * k) / 4, y + 0.05, zf + nz * 0.035, 0.05, h - 0.1, 0.02, 'metal_painted', { tint, ...KEIN, grad: false, ao: false });
  // Laufschiene oben + Führung unten (über doppelte Türbreite: Tür lässt sich zur Seite schieben)
  b.box(x + w / 2, y + h + 0.02, zFace + nz * 0.07, w * 2 + 0.3, 0.08, 0.06, 'metal_galvanized', { ...KEIN, grad: false, ao: false });
  b.box(x + w / 2, y - 0.04, zFace + nz * 0.07, w * 2 + 0.3, 0.05, 0.05, 'metal_galvanized', { ...KEIN, grad: false, ao: false });
  for (const sx of [-0.35, 0.35]) b.box(x + sx * w, y + h - 0.08, zf + nz * 0.05, 0.12, 0.14, 0.04, 'metal_painted', { tint: '#2b2d30', ...KEIN, grad: false, ao: false });
  // Griff (senkrechter Bügel) an der Vorderkante + Riegelhebel
  const gx = x - w / 2 + 0.14;
  stab(b, [gx, y + 0.85, zf + nz * 0.1], [gx, y + 1.55, zf + nz * 0.1], 0.018, 'metal_galvanized');
  for (const yy of [0.85, 1.55]) stab(b, [gx, y + yy, zf + nz * 0.03], [gx, y + yy, zf + nz * 0.1], 0.014, 'metal_galvanized');
  b.box(gx - 0.09, y + 1.0, zf + nz * 0.045, 0.06, 0.32, 0.03, 'metal_painted', { tint: '#c8402f', ...KEIN, grad: false, ao: false });
}

// ---------------------------------------------------------------------------
// MG-Nest: Sandsackring (hinten offen) mit schwerem MG auf Dreibein (statisch)
// ---------------------------------------------------------------------------
/** MG-Nest bei (x, z), Schussrichtung lokal +z (Drehung ry). Ring R ≈ 1,7 m, 0,9 m hoch, Öffnung hinten. */
export function mgNest(b, x, z, ry, o = {}) {
  const R = o.R ?? 1.7, f = frame(b, x, 0, z, ry), rows = o.rows ?? 6;
  const segs = 6, a0 = -2.15, a1 = 2.15;
  for (let i = 0; i < segs; i++) {
    const ta = a0 + ((a1 - a0) * i) / segs, tb = a0 + ((a1 - a0) * (i + 1)) / segs, ext = 0.1;
    // Sehne leicht verlängert (Ecken überlappen innen)
    const ax = R * Math.sin(ta), az = R * Math.cos(ta), bx = R * Math.sin(tb), bz = R * Math.cos(tb);
    const ux = (bx - ax), uz = (bz - az), ul = Math.hypot(ux, uz);
    const [wa, za] = f.P(ax - (ux / ul) * ext, az - (uz / ul) * ext), [wb, zb] = f.P(bx + (ux / ul) * ext, bz + (uz / ul) * ext);
    sandbags(b, wa, za, wb, zb, { rows });
  }
  // Dreibein (Lafette) hinter der Brüstung, Waffe über den Säcken
  const hz = R - 0.62, hy = 0.82;
  const head = [0, hy, hz];
  const W = (lx, ly, lz) => { const [wx, wz] = f.P(lx, lz); return [wx, ly, wz]; };
  for (const [lx, lz] of [[0, hz + 0.55], [-0.45, hz - 0.42], [0.45, hz - 0.42]]) stab(b, W(...head), W(lx, 0.02, lz), 0.018, 'metal_painted', { tint: '#3a3f2e' });
  stab(b, W(0, hy - 0.02, hz), W(0, hy + 0.1, hz), 0.035, 'metal_painted', { tint: '#3a3f2e' });
  // Waffe: Gehäuse, Kühlmantel mit Löchern, Lauf, Mündungsfeuerdämpfer, Kolben, Griff, Tragegriff, Zweibein eingeklappt
  const gy = hy + 0.12;
  f.box(0, gy, hz - 0.05, 0.1, 0.12, 0.5, 'gunmetal', { tint: '#2b2d30', ...KEIN, grad: false });
  f.box(0, gy + 0.12, hz - 0.08, 0.09, 0.03, 0.3, 'gunmetal', { tint: '#24262a', ...KEIN, grad: false, ao: false });
  const [jx, jz] = f.P(0, hz + 0.47);
  b.cyl(jx, gy + 0.06, jz, 0.034, 0.46, 'gunmetal', { axis: 'z', ry, tint: '#3a3d40', ...KEIN, seg: 10, ao: false });
  for (let k = 0; k < 4; k++) { const [px, pz] = f.P(0.035, hz + 0.3 + k * 0.1); b.box(px, gy + 0.045, pz, 0.006, 0.03, 0.05, 'black', { ry, ...KEIN, grad: false, ao: false }); }
  const [mx, mz] = f.P(0, hz + 0.8);
  b.cyl(mx, gy + 0.06, mz, 0.016, 0.2, 'gunmetal', { axis: 'z', ry, tint: '#1d1f22', ...KEIN, seg: 8, ao: false });
  const [fx, fz] = f.P(0, hz + 0.93);
  b.cyl(fx, gy + 0.06, fz, 0.026, 0.07, 'gunmetal', { axis: 'z', ry, tint: '#1d1f22', ...KEIN, seg: 8, ao: false });
  f.box(0, gy - 0.02, hz - 0.45, 0.06, 0.13, 0.3, 'wood_stock', { tint: '#4a3a2c', ...KEIN, grad: false });
  f.box(0, gy - 0.13, hz - 0.22, 0.04, 0.14, 0.05, 'polymer', { tint: '#24262a', ...KEIN, grad: false, ao: false, rx: -0.25 });
  f.box(0, gy + 0.16, hz + 0.02, 0.03, 0.05, 0.16, 'gunmetal', { tint: '#24262a', ...KEIN, grad: false, ao: false });
  // Munitionskasten links an der Lafette + Gurt zum Zuführer
  f.box(-0.26, 0.02, hz - 0.1, 0.12, 0.2, 0.3, 'metal_painted', { tint: '#4a5236', ...KEIN, grad: false });
  for (let k = 0; k < 5; k++) f.box(-0.2 + k * 0.035, gy + 0.03 - Math.abs(k - 2) * 0.012 - (k < 2 ? 0.25 - k * 0.12 : 0), hz - 0.08, 0.025, 0.04, 0.012, 'metal_galvanized', { tint: '#c8a050', ...KEIN, grad: false, ao: false });
  // zweiter Kasten + Hülsen am Boden
  f.box(0.55, 0, hz - 0.75, 0.3, 0.2, 0.14, 'metal_painted', { tint: '#4a5236', ...KEIN, ry: 0.4, grad: false });
  for (let k = 0; k < 9; k++) {
    const lx = 0.2 + (hash01(x + k, z, 31) - 0.5) * 0.6, lz = hz - 0.2 + (hash01(z, x + k, 32) - 0.5) * 0.5;
    f.cyl(lx, 0.012, lz, 0.007, 0.05, 'metal_galvanized', { axis: 'x', ry: hash01(x, z + k, 33) * 3, tint: '#c8a050', ...KEIN, seg: 5, ao: false, cast: false });
  }
}

// ---------------------------------------------------------------------------
// Büro/Pausenraum
// ---------------------------------------------------------------------------
/**
 * Bibliotheksmodell mit festem Kollisionsquader (Maße aus dem Manifest, unabhängig davon, ob das Modell lädt) und
 * prozeduralem Ersatz. size: [w, h, d] des Modells (lokal), kollidieren nur bei o.solid.
 */
export function modell(b, id, x, y, z, ry, size, ersatz, o = {}) {
  b.model(id, x, y, z, { ry, collide: false, ...(o.model || {}), fallback: bb => ersatz(bb) });
  if (o.solid) block(b, x, y, z, size[0] * (o.k ?? 1), size[1], size[2] * (o.k ?? 1), ry, o.minimap ?? (size[1] > 1 ? 'cover' : 'prop'));
}

/** Einfacher Ersatz für ein Bibliotheksmodell: Quader in Modellmaßen (Unterkante-Mitte, gedreht). */
export function ersatzQuader(x, y, z, ry, size, mat, tint) {
  return (bb) => bb.box(x, y, z, size[0], size[1], size[2], mat, { ry, tint, collide: false, minimap: false });
}

/** Schreibtisch (Stahl, 2,0 × 0,95 m) mit Monitor, Telefon, Ablage. Lokal z = Sitzseite (Stuhl davor). */
export function schreibtisch(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry);
  modell(b, 'metal_office_desk', x, y, z, ry, [2.0, 0.787, 0.947], (bb) => {
    const g = frame(bb, x, y, z, ry);
    g.box(0, 0.74, 0, 2.0, 0.045, 0.94, 'wood_planks', { tint: '#8a7a62', ...KEIN, grad: false });
    g.box(-0.72, 0, 0, 0.5, 0.74, 0.9, 'metal_painted', { tint: '#6f7a80', ...KEIN });
    for (let k = 0; k < 3; k++) g.box(-0.72, 0.1 + k * 0.22, 0.455, 0.42, 0.18, 0.01, 'metal_painted', { tint: '#5f6a70', ...KEIN, grad: false, ao: false });
    for (const sx of [0.94]) for (const sz of [-0.42, 0.42]) g.box(sx, 0, sz, 0.05, 0.74, 0.05, 'metal_painted', { tint: '#4a5058', ...KEIN });
    g.box(0.94, 0.05, 0, 0.04, 0.04, 0.84, 'metal_painted', { tint: '#4a5058', ...KEIN, grad: false, ao: false });
  }, { solid: true });
  if (o.leer) return;
  const top = 0.787;
  // Monitor (Röhre), Tastatur, Telefon, Papierstapel, Tasse
  f.box(0.25, top, -0.2, 0.42, 0.36, 0.38, 'polymer', { tint: '#d8d2c0', ...KEIN, grad: false });
  f.box(0.25, top + 0.05, -0.008, 0.34, 0.26, 0.012, 'glass', { tint: '#1a2a30', ...KEIN, grad: false, ao: false });
  f.box(0.25, top, 0.18, 0.44, 0.025, 0.15, 'polymer', { tint: '#c8c2b0', ...KEIN, grad: false, ao: false });
  f.box(-0.45, top, 0.05, 0.2, 0.07, 0.22, 'polymer', { tint: '#2b2d30', ...KEIN, grad: false, ao: false });
  f.box(-0.75, top, -0.15, 0.24, 0.08, 0.32, 'white', { tint: '#ece8dc', ...KEIN, grad: false, ao: false, ry: 0.12 });
  f.cyl(0.72, top, 0.12, 0.04, 0.1, 'white', { tint: '#e8e2d6', ...KEIN, seg: 8, ao: false });
}

/** Bürostuhl/Schulstuhl (Bibliothek) bzw. prozeduraler Stuhl; ohne Kollision (Kleinteil). Lehne lokal −z. */
export function stuhl(b, x, y, z, ry) {
  b.model('schoolchair_01', x, y, z, { ry: ry + Math.PI, collide: false, fallback: bb => chair(bb, x, z, { y, ry, tint: '#5a6a72' }) });
}

/** Aktenschrank (4 Schübe) 0,47 × 1,32 × 0,62 m, Front lokal +z. */
export function aktenschrank(b, x, y, z, ry, tint = '#7a8288') {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.47, 1.32, 0.62, 'metal_painted', { tint, ...KEIN });
  for (let k = 0; k < 4; k++) {
    f.box(0, 0.06 + k * 0.315, 0.312, 0.43, 0.29, 0.008, 'metal_painted', { tint, ...KEIN, grad: false, ao: false });
    f.box(0, 0.24 + k * 0.315, 0.322, 0.14, 0.025, 0.02, 'metal_galvanized', { ...KEIN, grad: false, ao: false });
  }
  block(b, x, y, z, 0.47, 1.32, 0.62, ry, 'cover');
}

/** Stahlregal (Bibliothek: steel_frame_shelves_01) mit Ordnern/Kartons; Front lokal +z, feste Kollision. */
export function regal(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry);
  modell(b, 'steel_frame_shelves_01', x, y, z, ry, [1.098, 2.14, 0.502], (bb) => {
    const g = frame(bb, x, y, z, ry);
    for (const sx of [-0.52, 0.52]) for (const sz of [-0.22, 0.22]) g.box(sx, 0, sz, 0.04, 2.14, 0.04, 'metal_painted', { tint: '#8a9096', ...KEIN });
    for (let k = 0; k < 5; k++) g.box(0, 0.08 + k * 0.5, 0, 1.08, 0.025, 0.48, 'metal_painted', { tint: '#9aa0a4', ...KEIN, grad: false, ao: false });
  }, { solid: true });
  if (o.leer) return;
  // Ordnerreihen + Kartons (Kleinteile, ohne Kollision)
  const cols = ['#2f5f94', '#c8402f', '#3e7a4c', '#d9a72a', '#5a5f66'];
  for (let k = 0; k < 3; k++) {
    const yy = 0.6 + k * 0.5, nOrd = 4 + Math.floor(hash01(x + k, z, 41) * 5);
    for (let i = 0; i < nOrd; i++) f.box(-0.44 + i * 0.075, yy, 0.02, 0.065, 0.3, 0.28, 'cardboard', { tint: cols[(i + k) % cols.length], ...KEIN, grad: false, ao: false, uv: 'fit' });
    if (hash01(x, z + k, 42) < 0.7) f.box(0.25, yy, 0, 0.36, 0.26, 0.34, 'cardboard', { ...KEIN, grad: false, ao: false, uv: 'fit', ry: 0.05 });
  }
}

/** Tisch (Platte w × d, 0,75 m) mit fester Kollision bis Plattenoberkante. */
export function tisch(b, x, y, z, ry, w = 1.2, d = 0.7, o = {}) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0.72, 0, w, 0.035, d, o.top || 'wood_planks', { tint: o.topTint || '#b8a88a', ...KEIN, grad: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 0.04, 0.72, 0.04, 'metal_painted', { tint: '#4a5058', ...KEIN });
  block(b, x, y, z, w, 0.755, d, ry, 'prop');
}

/** Kaffeeecke: Kaffeemaschine, Wasserkocher, Tassen auf einer Fläche (Oberkante yTop), Kleinteile. */
export function kaffeeEcke(b, x, yTop, z, ry) {
  const f = frame(b, x, yTop, z, ry);
  f.box(-0.15, 0, 0, 0.22, 0.34, 0.26, 'polymer', { tint: '#2b2d30', ...KEIN, grad: false });
  f.cyl(-0.15, 0.02, 0.08, 0.06, 0.12, 'glass', { tint: '#3a2a20', ...KEIN, seg: 8, ao: false });
  f.cyl(0.15, 0, 0, 0.07, 0.2, 'white', { tint: '#d8d8d2', ...KEIN, seg: 10, ao: false });
  for (const [lx, lz] of [[0.32, 0.08], [0.38, -0.06]]) f.cyl(lx, 0, lz, 0.04, 0.09, 'white', { tint: '#ece6da', ...KEIN, seg: 8, ao: false });
}
