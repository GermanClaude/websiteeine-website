// NULLPUNKT — Architektur-Bausteine: Wände mit Öffnungen + Rahmen, Gebäude mit Geschossen,
// Treppen (sichtbare Stufen, Rampen-Kollision), Geländer, Laufstege, Dächer (Owner: world)

const SIDE_DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/**
 * Wand von (x0,z0) nach (x1,z1). Öffnungen: [{ at (Mitte, m ab Start), w, h, sill=0, kind:'door'|'window'|'gap',
 * glass, frame=true, shutters:'#hex', leaf:'open'|'closed', bars }]
 */
export function wall(b, o) {
  const { x0, z0, x1, z1 } = o;
  const y = o.y ?? 0, h = o.h ?? 3, t = o.t ?? 0.3, mat = o.mat || 'plaster_white';
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 0.01) return;
  const ux = dx / L, uz = dz / L, ry = Math.atan2(-dz, dx);
  const common = { ry, tint: o.tint, interior: o.interior, aoFloor: o.aoFloor ?? y, grad: o.grad, minimap: o.minimap ?? 'wall', uv: o.uv };
  const seg = (s0, s1, yy, hh, extra = {}) => {
    if (s1 - s0 < 0.005 || hh < 0.005) return;
    const c = (s0 + s1) / 2;
    b.box(x0 + ux * c, yy, z0 + uz * c, s1 - s0, hh, t, mat, { ...common, ...extra });
  };
  const ops = (o.openings || []).slice().sort((a, c) => a.at - c.at);
  let s = 0;
  for (const op of ops) {
    const a = op.at - op.w / 2, e = op.at + op.w / 2;
    const sill = op.sill ?? (op.kind === 'window' ? 0.95 : 0);
    const top = Math.min(h, sill + op.h);
    seg(s, a, y, h);
    if (sill > 0) seg(a, e, y, sill);
    if (top < h - 0.005) seg(a, e, y + top, h - top, { grad: false, minimap: false });
    s = e;
    openingDetails(b, o, op, { x0, z0, ux, uz, ry, y, t, sill, top });
  }
  seg(s, L, y, h);
  // Gesims/Abschluss oben (unterbrochen an Öffnungen bis zur Oberkante, z. B. Brüstungslücken)
  if (o.cap) {
    const ch = o.cap.h ?? 0.12, ov = o.cap.over ?? 0.06;
    const cuts = ops.filter(op => (op.sill ?? (op.kind === 'window' ? 0.95 : 0)) + op.h >= h - 0.005).map(op => [op.at - op.w / 2, op.at + op.w / 2]);
    let c0 = -ov;
    const capSeg = (a, e) => {
      if (e - a < 0.02) return;
      b.box(x0 + ux * (a + e) / 2, y + h, z0 + uz * (a + e) / 2, e - a, ch, t + ov * 2, o.cap.mat || mat, { ry, tint: o.cap.tint ?? o.tint, grad: false, minimap: false, collide: o.cap.collide ?? true });
    };
    for (const [a, e] of cuts) { capSeg(c0, a); c0 = e; }
    capSeg(c0, L + ov);
  }
  // Sockel
  if (o.plinth) {
    const ph = o.plinth.h ?? 0.45, ov = o.plinth.over ?? 0.03;
    let s2 = 0;
    for (const op of ops) {
      const a = op.at - op.w / 2, e = op.at + op.w / 2;
      const sill = op.sill ?? (op.kind === 'window' ? 0.95 : 0);
      if (sill > 0.05) continue;
      if (a - s2 > 0.01) b.box(x0 + ux * (s2 + a) / 2, y, z0 + uz * (s2 + a) / 2, a - s2, ph, t + ov * 2, o.plinth.mat || 'concrete_dark', { ry, tint: o.plinth.tint, collide: false, minimap: false, aoFloor: y });
      s2 = e;
    }
    if (L - s2 > 0.01) b.box(x0 + ux * (s2 + L) / 2, y, z0 + uz * (s2 + L) / 2, L - s2, ph, t + ov * 2, o.plinth.mat || 'concrete_dark', { ry, tint: o.plinth.tint, collide: false, minimap: false, aoFloor: y });
  }
}

function openingDetails(b, o, op, g) {
  const { x0, z0, ux, uz, ry, y, t, sill, top } = g;
  const at = (s, yy, w, hh, d, mat, extra = {}) => b.box(x0 + ux * s, yy, z0 + uz * s, w, hh, d, mat, { ry, grad: false, minimap: false, ...extra });
  const fmat = op.frameMat || o.frameMat || 'wood_dark', ftint = op.frameTint ?? o.frameTint;
  const fw = op.fw ?? 0.09, fd = t + 0.06;
  const a = op.at - op.w / 2, e = op.at + op.w / 2;
  const kind = op.kind || 'door';
  if (op.frame !== false && kind !== 'gap') {
    // Laibungsrahmen
    at(a + fw / 2, y + sill, fw, top - sill, fd, fmat, { tint: ftint, collide: false });
    at(e - fw / 2, y + sill, fw, top - sill, fd, fmat, { tint: ftint, collide: false });
    at(op.at, y + top - fw, op.w, fw, fd, fmat, { tint: ftint, collide: false });
    if (kind === 'window') {
      // Fensterbank außen + innen
      at(op.at, y + sill - 0.05, op.w + 0.16, 0.06, t + 0.2, o.sillMat || 'concrete', { tint: o.sillTint, collide: false });
    }
  }
  if (op.glass) {
    // Scheibe mit Sprossen
    at(op.at, y + sill + 0.02, op.w - fw * 2, top - sill - fw - 0.02, 0.04, 'glass', { collide: true, interior: false });
    if (op.mullion !== false) {
      at(op.at, y + sill, 0.05, top - sill - fw, 0.08, fmat, { tint: ftint, collide: false });
      if (top - sill > 1.3) at(op.at, y + sill + (top - sill) * 0.55, op.w - fw * 2, 0.05, 0.08, fmat, { tint: ftint, collide: false });
    }
  }
  if (op.closed) {
    // geschlossene Fensterläden (massiv)
    at(op.at, y + sill + 0.01, op.w - fw * 2 + 0.02, top - sill - fw - 0.01, Math.min(0.08, t * 0.5), 'wood_planks', { tint: op.closed === true ? (o.shutterTint || '#2f6f9a') : op.closed, collide: true });
  }
  if (op.bars) {
    const n = Math.max(2, Math.round(op.w / 0.14));
    for (let i = 1; i < n; i++) b.cyl(x0 + ux * (a + (op.w * i) / n), y + sill, z0 + uz * (a + (op.w * i) / n), 0.012, top - sill - fw, 'metal_painted', { tint: '#2c2f33', collide: false, seg: 5, ao: false });
    at(op.at, y + sill, op.w, top - sill, 0.05, 'black', { visual: false, collide: true });
  }
  if (op.shutters) {
    // offene Fensterläden links/rechts an der Außenseite
    const sw = op.w / 2, sg = o.outside === 'right' ? -1 : 1;
    const ox = uz * sg, oz = -ux * sg; // Außennormale (links der Laufrichtung)
    const off = t / 2 + 0.04;
    for (const sx of [a - sw / 2 - 0.02, e + sw / 2 + 0.02]) {
      b.box(x0 + ux * sx + ox * off, y + sill, z0 + uz * sx + oz * off, sw, top - sill, 0.04, 'wood_planks', { ry, tint: op.shutters, collide: false, minimap: false, grad: false });
    }
  }
  if (kind === 'door' && op.leaf) {
    const sg = o.outside === 'right' ? -1 : 1;
    const ox = uz * sg, oz = -ux * sg;
    const lw = op.w - fw * 2;
    if (op.leaf === 'closed') {
      at(op.at, y + 0.01, lw, top - fw - 0.01, 0.06, op.leafMat || 'wood_planks', { tint: op.leafTint, collide: true });
    } else {
      // offen: Türblatt steht ~90° nach innen an der Laibung
      const hs = op.leafSide === 'right' ? e - fw : a + fw;
      const hx = x0 + ux * hs - ox * (t / 2), hz = z0 + uz * hs - oz * (t / 2);
      const toward = op.leafSide === 'right' ? -1 : 1;
      b.box(hx - ox * lw / 2 + ux * toward * 0.03, y + 0.01, hz - oz * lw / 2 + uz * toward * 0.03, 0.05, top - fw - 0.02, lw, op.leafMat || 'wood_planks', { ry, tint: op.leafTint, collide: true, minimap: false, grad: false });
    }
  }
  if (kind === 'door' || kind === 'gap') {
    // Navigationspunkte vor/hinter der Tür
    const nx = -uz, nz = ux;
    const cx = x0 + ux * op.at, cz = z0 + uz * op.at;
    b.navPoint(cx, y + sill + 0.2, cz);
    b.navPoint(cx + nx * 1.0, y + sill + 0.2, cz + nz * 1.0);
    b.navPoint(cx - nx * 1.0, y + sill + 0.2, cz - nz * 1.0);
  }
}

/** Platte mit rechteckigen Aussparungen (Treppenlöcher). holes: [{x0,z0,x1,z1}] */
export function slab(b, x0, z0, x1, z1, y, th, mat, holes = [], o = {}) {
  const xs = [x0, x1], zs = [z0, z1];
  for (const hl of holes) { xs.push(Math.max(x0, Math.min(x1, hl.x0)), Math.max(x0, Math.min(x1, hl.x1))); zs.push(Math.max(z0, Math.min(z1, hl.z0)), Math.max(z0, Math.min(z1, hl.z1))); }
  const ux = [...new Set(xs.map(v => +v.toFixed(3)))].sort((a, c) => a - c), uz = [...new Set(zs.map(v => +v.toFixed(3)))].sort((a, c) => a - c);
  const inHole = (x, z) => holes.some(hl => x > hl.x0 && x < hl.x1 && z > hl.z0 && z < hl.z1);
  for (let j = 0; j < uz.length - 1; j++) {
    let start = null;
    for (let i = 0; i <= ux.length - 1; i++) {
      const filled = i < ux.length - 1 && !inHole((ux[i] + ux[i + 1]) / 2, (uz[j] + uz[j + 1]) / 2);
      if (filled && start === null) start = i;
      if (!filled && start !== null) {
        b.boxMM(ux[start], y, uz[j], ux[i], y + th, uz[j + 1], mat, { grad: false, minimap: o.minimap ?? false, tint: o.tint, interior: o.interior, uv: 'world' });
        start = null;
      }
    }
  }
}

/**
 * Treppe. Aufstieg in Richtung dir ('n'|'s'|'e'|'w') ab (x,z) = Mitte der untersten Stufenkante.
 * o: { y0, y1, w=1.4, run (Länge), style: 'solid'|'steel', mat, tint, rail: true|'left'|'right'|false, railFrom (m ab unten) }
 * Kollision als glatte Rampe; Navigationspunkte unten/oben.
 */
export function stairs(b, o) {
  const y0 = o.y0 ?? 0, y1 = o.y1, rise = y1 - y0;
  const w = o.w ?? 1.4, run = o.run ?? Math.max(1.2, rise / 0.62);
  const [dx, dz] = SIDE_DIR[o.dir || 'n'];
  const ry = Math.atan2(dx, dz); // lokale +z = Aufstiegsrichtung
  // lokale Achsen: forward (dx,dz), right
  const rx = -dz, rz = dx;
  const n = Math.max(2, Math.round(rise / 0.19)), sr = rise / n, sd = run / n;
  const steel = o.style === 'steel';
  const mat = o.mat || (steel ? 'metal_tread' : 'concrete');
  const P = (f, r) => [o.x + dx * f + rx * r, o.z + dz * f + rz * r];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) * sd;
    const [cx, cz] = P(f, 0);
    if (steel) b.box(cx, y0 + (i + 1) * sr - 0.05, cz, w, 0.05, sd + 0.04, mat, { ry, collide: false, minimap: false, grad: false, tint: o.tint, ao: false });
    else b.box(cx, y0, cz, w, (i + 1) * sr, sd, mat, { ry, collide: false, minimap: false, tint: o.tint, aoFloor: y0, interior: o.interior });
  }
  if (steel) {
    // Wangen
    const ang = Math.atan2(rise, run), len = Math.hypot(rise, run);
    for (const side of [-1, 1]) {
      const [cx, cz] = P(run / 2, side * (w / 2 + 0.04));
      b.box(cx, y0 + rise / 2 - 0.14, cz, 0.06, 0.28, len, 'metal_painted', { ry, rx: -ang, tint: o.stringerTint || '#3d4247', collide: false, minimap: false, grad: false, uv: 'local' });
    }
  }
  // Kollision: Rampe
  const [mx, mz] = P(run / 2, 0);
  b.wedge(mx, y0, mz, w, rise, run, mat, { ry, visual: false, minimap: 'stairs' });
  // Geländer
  if (o.rail) {
    const sides = o.rail === 'left' ? [-1] : o.rail === 'right' ? [1] : [-1, 1];
    for (const side of sides) {
      // railFrom: Geländer erst ab dieser Lauflänge (unten seitlich betretbar)
      const f0 = Math.min(run * 0.5, o.railFrom ?? 0), ya = y0 + (rise * f0) / run;
      const [ax, az] = P(f0, side * (w / 2 + 0.02)), [bx, bz] = P(run, side * (w / 2 + 0.02));
      railing(b, ax, az, bx, bz, ya, { y1, h: 1.0, posts: Math.max(2, Math.round((run - f0) / 1.2) + 1), tint: o.railTint, collider: o.railCollider ?? true });
    }
  }
  const [bx0, bz0] = P(-0.7, 0), [tx, tz] = P(run + 0.7, 0);
  b.navPoint(bx0, y0 + 0.2, bz0);
  const [sx0, sz0] = P(0.3, 0), [sx1, sz1] = P(run - 0.2, 0);
  b.navLine(sx0, y0 + (rise * 0.3) / run + 0.25, sz0, sx1, y1 - (rise * 0.2) / run + 0.25, sz1, 1.1);
  b.navPoint(tx, y1 + 0.2, tz);
  return { top: P(run, 0), run };
}

/** Geländer von A nach B (optional steigend y0→y1), Höhe h, mit Kollisionswand. */
export function railing(b, xa, za, xb, zb, y0, o = {}) {
  const y1 = o.y1 ?? y0, h = o.h ?? 1.05;
  const L = Math.hypot(xb - xa, zb - za), dy = y1 - y0;
  const ry = Math.atan2(-(zb - za), xb - xa);
  const posts = o.posts ?? Math.max(2, Math.round(L / 1.5) + 1);
  const mat = o.mat || 'metal_painted', tint = o.tint || '#c9a227';
  for (let i = 0; i < posts; i++) {
    const t = i / (posts - 1);
    b.cyl(xa + (xb - xa) * t, y0 + dy * t, za + (zb - za) * t, 0.025, h, mat, { tint, collide: false, seg: 6, minimap: false, ao: false });
  }
  const ang = Math.atan2(dy, L), len = Math.hypot(L, dy);
  for (const yy of [h, h * 0.5]) {
    b.cyl((xa + xb) / 2, y0 + dy / 2 + yy, (za + zb) / 2, 0.022, len, mat, { axis: 'x', ry, rz: ang, tint, collide: false, seg: 6, minimap: false, ao: false });
  }
  if (o.collider !== false) {
    // unsichtbare Wand bis Kopfhöhe (kein Herunterfallen)
    b.box((xa + xb) / 2, Math.min(y0, y1), (za + zb) / 2, L, Math.abs(dy) + h + 0.1, 0.08, 'black', { ry, visual: false, minimap: false, bullet: false });
  }
}

/** Laufsteg (Gitterrost) von (x0,z0) bis (x1,z1) auf Höhe y, Breite w, mit Geländern und Stützen. */
export function catwalk(b, x0, z0, x1, z1, y, o = {}) {
  const w = o.w ?? 1.6, L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
  const ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz, nz = ux;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.box(cx, y - 0.06, cz, L, 0.06, w, 'metal_grate', { ry, minimap: 'catwalk', grad: false, ao: false, interior: o.interior });
  // Randträger
  for (const s of [-1, 1]) b.box(cx + nx * s * (w / 2 - 0.05), y - 0.26, cz + nz * s * (w / 2 - 0.05), L, 0.2, 0.1, 'metal_painted', { ry, tint: o.tint || '#4a5058', collide: false, minimap: false, grad: false, interior: o.interior });
  // Querträger
  const nCross = Math.max(2, Math.round(L / 2));
  for (let i = 0; i <= nCross; i++) {
    const s = -L / 2 + (L * i) / nCross;
    b.box(cx + ux * s, y - 0.22, cz + uz * s, 0.08, 0.16, w, 'metal_painted', { ry, tint: o.tint || '#4a5058', collide: false, minimap: false, grad: false, interior: o.interior });
  }
  // Stützen
  if (o.supports !== false) {
    const nSup = Math.max(2, Math.round(L / (o.supportSpacing ?? 6)) + 1);
    for (let i = 0; i < nSup; i++) {
      const s = -L / 2 + 0.3 + ((L - 0.6) * i) / (nSup - 1);
      for (const side of (o.supportBoth ? [-1, 1] : [0])) {
        b.box(cx + ux * s + nx * side * (w / 2 - 0.1), o.groundY ?? 0, cz + uz * s + nz * side * (w / 2 - 0.1), 0.16, y - 0.26 - (o.groundY ?? 0), 0.16, 'metal_painted', { ry, tint: o.supportTint || '#3d4247', minimap: 'pillar', interior: o.interior });
      }
    }
  }
  b.navLine(x0 + ux * 0.4, y + 0.2, z0 + uz * 0.4, x1 - ux * 0.4, y + 0.2, z1 - uz * 0.4, 1.3);
  const rails = o.rails ?? ['l', 'r'];
  for (const side of rails) {
    const s = side === 'l' ? 1 : -1;
    const off = w / 2 - 0.03;
    const cut = o.railCut?.[side];
    const parts = cut ? cut : [[0, L]];
    for (const [a, e] of parts) {
      railing(b, x0 + ux * a + nx * s * off, z0 + uz * a + nz * s * off, x0 + ux * e + nx * s * off, z0 + uz * e + nz * s * off, y, { tint: o.railTint || '#c9a227', posts: Math.max(2, Math.round((e - a) / 1.6) + 1) });
    }
  }
}

/**
 * Gebäude (achsenparallel). (x,z) Mitte, w (x), d (z). floors: Anzahl, fh Geschosshöhe.
 * openings: [{ side:'n'|'s'|'e'|'w', at (Versatz von Seitenmitte), w, h, kind, floor, glass, ... }]
 * holes: [{ floor (Decke über Geschoss floor), x0,z0,x1,z1 }] Weltkoordinaten
 * roof: { parapet: 0.9, mat, tint, cap } | false
 * Liefert { x0,x1,z0,z1, levels:[y...], roofY }
 */
export function building(b, o) {
  const w = o.w, d = o.d, x = o.x, z = o.z;
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const floors = o.floors ?? 1, fh = o.fh ?? 3.2, t = o.t ?? 0.3, y0 = o.y ?? 0;
  const slabT = o.slabT ?? 0.25;
  const mat = o.mat || 'plaster_white', tint = o.tint;
  const levels = [];
  const fy = i => y0 + i * fh;
  for (let i = 0; i < floors; i++) levels.push(fy(i) + (i === 0 ? (o.floorT ?? 0.12) : 0));
  const roofY = fy(floors);
  // Innenraum abdunkeln
  if (o.interior !== false) b.interior(x0 + 0.02, z0 + 0.02, x1 - 0.02, z1 - 0.02, y0 - 0.1, roofY - 0.02, o.interiorFactor ?? 0.6);
  // Böden
  const floorMat = o.floorMat || 'tiles';
  b.boxMM(x0 + t, y0, z0 + t, x1 - t, y0 + (o.floorT ?? 0.12), z1 - t, floorMat, { grad: false, minimap: false, tint: o.floorTint });
  // Zwischendecken liegen zwischen den Wänden (Innenmaß): Die Außenwand des Geschosses reicht über die Deckenstirn.
  // Eine Decke über den vollen Grundriss läge mit ihrer Stirn in der Fassadenebene (Z-Fighting-Streifen unter jedem
  // Geschossband) und mit ihrer Oberseite in der Wandkrone (Flimmern in Türschwellen des Obergeschosses).
  // Die Dachdecke bleibt voll – über ihr endet die Wand, ihre Stirn ist dort die Fassade.
  const inset = (sid) => (o.skipWalls?.includes(sid) ? 0 : t);
  for (let i = 1; i <= floors; i++) {
    const y = fy(i) - slabT;
    const holes = (o.holes || []).filter(hl => (hl.floor ?? 1) === i);
    const isRoof = i === floors;
    if (isRoof && o.roof === false) continue;
    const [sx0, sz0, sx1, sz1] = isRoof ? [x0, z0, x1, z1] : [x0 + inset('w'), z0 + inset('n'), x1 - inset('e'), z1 - inset('s')];
    slab(b, sx0, sz0, sx1, sz1, y, slabT, isRoof ? (o.roof?.mat || 'concrete') : (o.slabMat || 'concrete'), holes, { tint: isRoof ? o.roof?.tint : o.slabTint, minimap: isRoof ? 'roof' : false });
    // Bodenbelag oben auf Zwischendecken
    if (!isRoof && o.upperFloorMat) slab(b, x0 + t, z0 + t, x1 - t, z1 - t, fy(i), 0.02, o.upperFloorMat, holes, { tint: o.floorTint });
  }
  // Wände je Geschoss
  const sides = {
    n: { x0: x0, z0: z0 + t / 2, x1: x1, z1: z0 + t / 2, len: w, outside: 'left' },
    s: { x0: x1, z0: z1 - t / 2, x1: x0, z1: z1 - t / 2, len: w, outside: 'left' },
    e: { x0: x1 - t / 2, z0: z0, x1: x1 - t / 2, z1: z1, len: d, outside: 'left' },
    w: { x0: x0 + t / 2, z0: z1, x1: x0 + t / 2, z1: z0, len: d, outside: 'left' },
  };
  // Hinweis: Lauf entlang der Wand so gewählt, dass „links“ außen liegt.
  for (let i = 0; i < floors; i++) {
    for (const [sid, sd] of Object.entries(sides)) {
      if (o.skipWalls?.includes(sid)) continue;
      const ops = (o.openings || []).filter(op => op.side === sid && (op.floor ?? 0) === i).map(op => ({ ...op, at: sd.len / 2 + (sid === 'n' || sid === 'e' ? op.at : -op.at) }));
      wall(b, {
        x0: sd.x0, z0: sd.z0, x1: sd.x1, z1: sd.z1, y: fy(i), h: fh - (i === floors - 1 && o.roof !== false ? slabT : 0) + (i < floors - 1 ? 0 : 0),
        t, mat, tint, openings: ops, frameMat: o.frameMat, frameTint: o.frameTint, sillMat: o.sillMat, interior: undefined,
        aoFloor: fy(i), outside: sd.outside, plinth: i === 0 ? o.plinth : null,
      });
    }
    // Geschossband (Gesims) außen
    if (o.band && i > 0) {
      const bh = 0.16;
      b.box(x, fy(i) - 0.06, z0 - 0.04, w + 0.12, bh, 0.1, o.band.mat || 'concrete', { tint: o.band.tint, grad: false, minimap: false, collide: false });
      b.box(x, fy(i) - 0.06, z1 + 0.04, w + 0.12, bh, 0.1, o.band.mat || 'concrete', { tint: o.band.tint, grad: false, minimap: false, collide: false });
      b.box(x0 - 0.04, fy(i) - 0.06, z, 0.1, bh, d + 0.12, o.band.mat || 'concrete', { tint: o.band.tint, grad: false, minimap: false, collide: false });
      b.box(x1 + 0.04, fy(i) - 0.06, z, 0.1, bh, d + 0.12, o.band.mat || 'concrete', { tint: o.band.tint, grad: false, minimap: false, collide: false });
    }
  }
  // Brüstung auf dem Dach
  if (o.roof && o.roof.parapet) {
    const ph = o.roof.parapet, pt = o.roof.parapetT ?? 0.22;
    const cap = { mat: o.roof.capMat || 'concrete', tint: o.roof.capTint ?? '#d8d2c4', h: 0.08, over: 0.05 };
    const gaps = o.roof.gaps || {};
    const pw = (sid, ax, az, bx, bz) => wall(b, { x0: ax, z0: az, x1: bx, z1: bz, y: roofY, h: ph, t: pt, mat, tint, cap, aoFloor: roofY, openings: gaps[sid] || [], minimap: false });
    pw('n', x0, z0 + pt / 2, x1, z0 + pt / 2);
    pw('s', x1, z1 - pt / 2, x0, z1 - pt / 2);
    pw('e', x1 - pt / 2, z0 + pt, x1 - pt / 2, z1 - pt);
    pw('w', x0 + pt / 2, z1 - pt, x0 + pt / 2, z0 + pt);
  } else if (o.roof && o.roof.edge !== false) {
    // Dachkante (Attika-Blech)
    const e = o.roof.edgeMat || 'metal_painted', et = o.roof.edgeTint || '#5a5f66';
    b.box(x, roofY, z0 + 0.06, w + 0.1, 0.2, 0.14, e, { tint: et, grad: false, minimap: false });
    b.box(x, roofY, z1 - 0.06, w + 0.1, 0.2, 0.14, e, { tint: et, grad: false, minimap: false });
    b.box(x0 + 0.06, roofY, z, 0.14, 0.2, d - 0.1, e, { tint: et, grad: false, minimap: false });
    b.box(x1 - 0.06, roofY, z, 0.14, 0.2, d - 0.1, e, { tint: et, grad: false, minimap: false });
  }
  // Footprint für die Minikarte (Gebäude als Block)
  b.footprints.push({ x, z, hw: w / 2, hd: d / 2, ry: 0, y0, y1: roofY, kind: 'building' });
  return { x0, x1, z0, z1, levels, roofY, fh, t };
}

/** Satteldach mit Ziegeln (über achsenparallelem Rechteck), First entlang 'x' oder 'z'. */
export function pitchedRoof(b, o) {
  const { x, z, w, d, y } = o;
  const along = o.ridge || 'x', pitch = o.pitch ?? 0.5, ov = o.over ?? 0.35;
  const span = along === 'x' ? d : w, len = (along === 'x' ? w : d) + ov * 2;
  const half = span / 2 + ov, rise = (span / 2) * pitch;
  const slope = Math.hypot(half, rise * (half / (span / 2))), ang = Math.atan2(rise, span / 2);
  const mat = o.mat || 'roof_tiles';
  for (const s of [-1, 1]) {
    const off = (half / 2) * s;
    const cx = along === 'x' ? x : x + off, cz = along === 'x' ? z + off : z;
    const yy = y + rise / 2 - ov * Math.tan(ang) / 2 - 0.08;
    if (along === 'x') b.box(cx, yy, cz, len, 0.12, slope, mat, { rx: ang * s, tint: o.tint, grad: false, minimap: 'roof', uv: 'local' });
    else b.box(cx, yy, cz, slope, 0.12, len, mat, { rz: -ang * s, tint: o.tint, grad: false, minimap: 'roof', uv: 'local' });
  }
  // Giebel: je Seite zwei gegenläufige Keile (gleichschenkliges Dreieck)
  const gmat = o.gableMat || 'plaster_white';
  const gt = 0.25;
  for (const s of [-1, 1]) {
    if (along === 'x') {
      const gx = x + s * (w / 2 - gt / 2);
      b.wedge(gx, y, z - span / 4, gt, rise, span / 2, gmat, { tint: o.gableTint, uv: 'world', minimap: false });
      b.wedge(gx, y, z + span / 4, gt, rise, span / 2, gmat, { ry: Math.PI, tint: o.gableTint, uv: 'world', minimap: false });
    } else {
      const gz = z + s * (d / 2 - gt / 2);
      b.wedge(x - span / 4, y, gz, gt, rise, span / 2, gmat, { ry: Math.PI / 2, tint: o.gableTint, uv: 'world', minimap: false });
      b.wedge(x + span / 4, y, gz, gt, rise, span / 2, gmat, { ry: -Math.PI / 2, tint: o.gableTint, uv: 'world', minimap: false });
    }
  }
  // First
  if (along === 'x') b.cyl(x, y + rise + 0.02, z, 0.11, len, mat, { axis: 'x', tint: o.tint, collide: false, minimap: false });
  else b.cyl(x, y + rise + 0.02, z, 0.11, len, mat, { axis: 'z', tint: o.tint, collide: false, minimap: false });
}
