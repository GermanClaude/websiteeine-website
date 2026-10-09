// NULLPUNKT — Requisiten aus Primitiven: Container, Fahrzeuge, Kisten, Fässer, Paletten, Sandsäcke,
// Betonbarrieren, Lampen, Zäune, Bäume, Marktstände … (Owner: world)
import * as THREE from 'three';

/** Lokales Koordinatensystem (x, y, z, ry) für Unterteile eines Props. */
export function frame(b, x, y, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  return {
    P,
    box(lx, ly, lz, w, h, d, mat, o = {}) { const [wx, wz] = P(lx, lz); b.box(wx, y + ly, wz, w, h, d, mat, { ...o, ry: ry + (o.ry || 0), aoFloor: o.aoFloor ?? (o.grad === false ? undefined : y) }); },
    cyl(lx, ly, lz, r, h, mat, o = {}) { const [wx, wz] = P(lx, lz); b.cyl(wx, y + ly, wz, r, h, mat, { ...o, ry: ry + (o.ry || 0) }); },
    wedge(lx, ly, lz, w, h, d, mat, o = {}) { const [wx, wz] = P(lx, lz); b.wedge(wx, y + ly, wz, w, h, d, mat, { ...o, ry: ry + (o.ry || 0) }); },
    geom(g, lx, ly, lz, mat, o = {}) { const [wx, wz] = P(lx, lz); b.geom(g, wx, y + ly, wz, mat, { ...o, ry: ry + (o.ry || 0) }); },
    solid(lx, ly, lz, w, h, d, o = {}) { const [wx, wz] = P(lx, lz); b.box(wx, y + ly, wz, w, h, d, 'black', { ...o, ry: ry + (o.ry || 0), visual: false }); },
  };
}

const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

/** Positionsabhängiger Zufall 0..1 (Varianten/Drehungen der Bibliotheksmodelle, ohne den Kartenzufall zu verbrauchen). */
export function hash01(x, z, k = 0) {
  let n = Math.imul(Math.round(x * 97) | 0, 374761393) + Math.imul(Math.round(z * 89) | 0, 668265263) + Math.imul(k + 1, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const geoCache = new Map();
function cached(key, fn) { if (!geoCache.has(key)) geoCache.set(key, fn()); return geoCache.get(key); }

/**
 * Ausstattung aus der Asset-Bibliothek (Kleinteile, Möbel, Technik): Liste [id, x, y, z, ry?, opts?]
 * (Positionen = Unterkante-Mitte). Standard ohne Bewegungskollision (Kugeln treffen trotzdem); opts.collide für
 * Möbel/Geräte, die wie Deckung wirken. Ohne Bibliothek (KTX2/Transcoder fehlt) entfällt die Ausstattung – die
 * Karte ist ohne sie vollständig.
 */
export function dress(b, list) {
  if (!b.lib) return;
  for (const [id, x, y, z, ry, o] of list) {
    if (!b.lib.has(id)) continue;
    b.model(id, x, y, z, { ry: ry ?? hash01(x, z, 9) * Math.PI * 2, collide: false, ...(o || {}) });
  }
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------
export const CONTAINER_H = 2.59, CONTAINER_W = 2.44;
export const CONTAINER_COLORS = ['#b8392c', '#2d5f94', '#3e7a4c', '#d9762a', '#8d9399', '#c9a227', '#6b3f7a', '#1f6f6a', '#9a3328', '#e3e1da'];

/** ISO-Container. len 6.06 (20 ft) oder 12.19 (40 ft). (x,z) Mitte, y Unterkante. */
export function container(b, x, y, z, o = {}) {
  const len = o.len ?? 6.06, H = 2.59, W = 2.44, color = o.color || b.pick(CONTAINER_COLORS);
  const f = frame(b, x, y, z, o.ry || 0);
  const dark = shade(color, 0.72);
  const ground = Math.abs(y) < 0.05;
  f.box(0, 0, 0, len - 0.1, H - 0.06, W - 0.08, 'container', { tint: color, uv: 'local', collide: false, aoFloor: ground ? y : undefined, grad: ground });
  f.solid(0, 0, 0, len, H, W, { minimap: o.minimap ?? 'container' });
  // Eckpfosten
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (len / 2 - 0.09), 0, sz * (W / 2 - 0.09), 0.18, H, 0.18, 'container', { tint: dark, collide: false, minimap: false, grad: ground, uv: 'local' });
  // Ober-/Untergurte
  for (const sz of [-1, 1]) {
    f.box(0, H - 0.12, sz * (W / 2 - 0.06), len - 0.3, 0.12, 0.12, 'container', { tint: dark, collide: false, minimap: false, grad: false, uv: 'local' });
    f.box(0, 0, sz * (W / 2 - 0.06), len - 0.3, 0.16, 0.12, 'container', { tint: dark, collide: false, minimap: false, grad: false, uv: 'local' });
  }
  // Türseite (+x): Verriegelungsstangen
  const ex = len / 2 + 0.005;
  if (!o.openDoors) {
    f.box(ex, 0.1, 0, 0.02, H - 0.25, 0.03, 'metal_painted', { tint: '#202224', collide: false, minimap: false, grad: false, ao: false });
    for (const bz of [-0.85, -0.35, 0.35, 0.85]) {
      f.cyl(ex + 0.03, 0.12, bz, 0.022, H - 0.3, 'metal_galvanized', { collide: false, seg: 6, minimap: false, ao: false });
      f.box(ex + 0.05, 1.05, bz + 0.08, 0.04, 0.05, 0.2, 'metal_galvanized', { collide: false, minimap: false, grad: false, ao: false });
    }
  } else {
    // offene Türen (90° aufgeklappt) + dunkles Inneres
    f.box(ex - 0.02, 0.05, 0, 0.02, H - 0.2, W - 0.3, 'black', { collide: false, minimap: false, ao: false });
    for (const sz of [-1, 1]) f.box(ex + W / 4, 0.05, sz * (W / 2 + 0.02), W / 2 - 0.05, H - 0.18, 0.05, 'container', { tint: color, collide: true, minimap: false, uv: 'local', grad: ground });
  }
  if (o.logo) {
    for (const side of [1, -1]) {
      const [lx, lz] = f.P(0, side * (W / 2 + 0.005));
      b.sign(lx, y + H * 0.4, lz, Math.min(len * 0.55, 5.2), H * 0.3, o.logo, { ry: (o.ry || 0) + (side < 0 ? Math.PI : 0), back: false, depth: 0.0 });
    }
  }
  return { top: y + H };
}

// ---------------------------------------------------------------------------
// Kisten, Fässer, Paletten
// ---------------------------------------------------------------------------
export function crate(b, x, y, z, s = 1, o = {}) {
  const w = o.w ?? s, h = o.h ?? s, d = o.d ?? s;
  b.box(x, y, z, w, h, d, o.mat || 'wood_crate', { ry: o.ry || 0, uv: 'fit', tint: o.tint, minimap: o.minimap ?? 'cover', aoFloor: o.aoFloor, grad: o.grad });
}

/** Kistenstapel: Muster als Liste [lx, ly(Stufe), lz, size] relativ zur Mitte. */
export function crateStack(b, x, z, o = {}) {
  const ry = o.ry || 0, y0 = o.y ?? 0;
  const pat = o.pattern || [[0, 0, 0, 1.1], [1.15, 0, 0.05, 1.0], [0.5, 1, 0, 1.0]];
  const f = frame(b, x, y0, z, ry);
  const levelH = [];
  for (const [, lvl, , s] of pat) levelH[lvl] = Math.max(levelH[lvl] || 0, s);
  const yAt = lvl => { let h = 0; for (let i = 0; i < lvl; i++) h += levelH[i] || 0; return h; };
  for (const [lx, lvl, lz, s] of pat) {
    const [wx, wz] = f.P(lx, lz);
    crate(b, wx, y0 + yAt(lvl), wz, s, { ry: ry + (b.rand() - 0.5) * 0.12, tint: o.tint || (b.rand() < 0.3 ? '#d8c8a8' : undefined), aoFloor: y0 });
  }
}

export function barrel(b, x, y, z, o = {}) {
  const color = o.color || b.pick(['#2d5f94', '#b8392c', '#3e7a4c', '#c9a227', '#3a3d40']);
  // Mehrspieler: Kollision immer derselbe Zylinder – unabhängig von Bibliothek, Grafikstufe und geladenem Modell
  if (o.tipped) b.cyl(x, y + 0.3, z, 0.3, 0.88, 'black', { axis: 'x', ry: o.ry || 0, visual: false, minimap: 'cover' });
  else b.cyl(x, y, z, 0.3, 0.88, 'black', { visual: false, minimap: 'cover' });
  if (b.hasModel('barrel_01')) {
    // Fotoscan-Fässer: Rot (Stahl, Gefahrzeichen), Blau (Stahl), Blau (Kunststoff) – nach gewünschter Farbe/Ort
    const c = new THREE.Color(color), h = hash01(x, z, 3);
    const id = c.r > c.b * 1.4 ? 'barrel_01' : c.b > c.r * 1.3 ? (h < 0.6 ? 'barrel_03' : 'barrel_02') : (h < 0.5 ? 'barrel_01' : 'barrel_03');
    const fb = (bb) => barrelProc(bb, x, y, z, { ...o, color });
    if (o.tipped) b.model(id, x, y + 0.3, z, { pivot: 'center', rz: Math.PI / 2, ry: o.ry || 0, collide: false, fallback: fb });
    else b.model(id, x, y, z, { ry: hash01(x, z, 4) * Math.PI * 2, collide: false, fallback: fb });
    return;
  }
  barrelProc(b, x, y, z, { ...o, color });
}

/** Prozedurales Fass – nur Optik (Kollision setzt barrel()). */
function barrelProc(b, x, y, z, o) {
  const color = o.color;
  if (o.tipped) {
    b.cyl(x, y + 0.3, z, 0.3, 0.88, 'metal_painted', { axis: 'x', ry: o.ry || 0, tint: color, collide: false, minimap: false });
    return;
  }
  b.cyl(x, y, z, 0.3, 0.88, 'metal_painted', { tint: color, collide: false, minimap: false, seg: 14, aoFloor: y });
  for (const ry of [0.28, 0.58]) b.cyl(x, y + ry, z, 0.31, 0.03, 'metal_painted', { tint: shade(color, 0.8), collide: false, seg: 14, minimap: false, ao: false });
  b.cyl(x, y + 0.875, z, 0.285, 0.015, 'metal_painted', { tint: shade(color, 0.6), collide: false, seg: 14, minimap: false, ao: false });
  b.cyl(x + 0.14, y + 0.88, z + 0.05, 0.035, 0.02, 'metal_galvanized', { collide: false, seg: 6, minimap: false, ao: false });
}

export function barrelGroup(b, x, z, o = {}) {
  const n = o.n ?? 4, y = o.y ?? 0;
  const spots = [[0, 0], [0.64, 0.05], [0.3, 0.56], [-0.34, 0.55], [0.95, 0.6], [-0.6, -0.1]];
  const colors = o.colors;
  for (let i = 0; i < n; i++) {
    const [lx, lz] = spots[i % spots.length];
    const c = Math.cos(o.ry || 0), s = Math.sin(o.ry || 0);
    barrel(b, x + lx * c + lz * s, y, z - lx * s + lz * c, { color: colors ? colors[i % colors.length] : o.color });
  }
  if (o.tipped) barrel(b, x + 0.6, y, z - 0.9, { tipped: true, ry: 0.4, color: o.color });
}

/** Europalette 1,2 × 0,8 m (lokal x = 1,2). load: 'boxes'|'sacks'|'bricks'|'wrapped'|null */
export function pallet(b, x, y, z, o = {}) {
  const f = frame(b, x, y, z, o.ry || 0);
  const tint = o.tint || '#c9b48e', m = 'wood_planks';
  const grad = Math.abs(y) < 0.05;
  for (const lz of [-0.35, 0, 0.35]) f.box(0, 0, lz, 1.2, 0.022, 0.1, m, { tint, collide: false, minimap: false, grad });
  for (const lz of [-0.35, 0, 0.35]) f.box(0, 0.022, lz, 1.2, 0.078, 0.1, m, { tint: shade(tint, 0.85), collide: false, minimap: false, grad });
  for (let i = 0; i < 7; i++) f.box(-0.55 + i * (1.1 / 6), 0.1, 0, 0.1, 0.022, 0.8, m, { tint, collide: false, minimap: false, grad: false });
  let h = 0.122;
  const L = o.load;
  if (L === 'boxes') {
    const rows = o.rows ?? 2;
    for (let r = 0; r < rows; r++) for (const [lx, lz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
      if (r === rows - 1 && b.rand() < 0.25) continue;
      f.box(lx, h + r * 0.4, lz, 0.58, 0.39, 0.38, 'cardboard', { uv: 'fit', collide: false, minimap: false, grad: false, ry: (b.rand() - 0.5) * 0.05 });
    }
    h += rows * 0.4;
  } else if (L === 'sacks') {
    const sack = sandbagGeom();
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) f.geom(sack, -0.4 + k * 0.4, h + r * 0.15, (r % 2 ? 0.08 : -0.08), 'sandbag', { ry: Math.PI / 2, sx: 1.3, sz: 2.2, sy: 1.05, tint: '#e2d6b8', collide: false, minimap: false, grad: false });
    h += 0.45;
  } else if (L === 'wrapped') {
    f.box(0, h, 0, 1.18, 0.95, 0.78, 'tarp', { tint: o.wrapTint || '#cfd6d8', collide: false, minimap: false, grad: false });
    h += 0.95;
  } else if (L === 'bricks') {
    f.box(0, h, 0, 1.1, 0.7, 0.75, 'brick', { collide: false, minimap: false, grad: false });
    h += 0.7;
  }
  f.solid(0, 0, 0, 1.2, h, 0.8, { minimap: L ? 'cover' : 'prop' });
  return h;
}

export function palletStack(b, x, z, o = {}) {
  const n = o.n ?? 4, y = o.y ?? 0;
  for (let i = 0; i < n; i++) pallet(b, x + (b.rand() - 0.5) * 0.06, y + i * 0.144, z + (b.rand() - 0.5) * 0.06, { ry: (o.ry || 0) + (b.rand() - 0.5) * 0.06, tint: o.tint, load: i === n - 1 ? o.load : null });
}

// ---------------------------------------------------------------------------
// Sandsäcke
// ---------------------------------------------------------------------------
export function sandbagGeom(detail = false) {
  if (detail) return cached('sandbag-hd', sandbagGeomHD);
  return cached('sandbag', () => {
    // maps-expand: einfache Form (nur Stufe „niedrig“) mit 2×1×1 Segmenten (20 statt 64 Dreiecke je Sack, Kissenform bleibt)
    const g = new THREE.BoxGeometry(0.56, 0.16, 0.32, 2, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i) / 0.28, bb = p.getY(i) / 0.08, c = p.getZ(i) / 0.16;
      const pinch = 1 - 0.38 * a * a * a * a;
      p.setY(i, p.getY(i) * pinch * (1 - 0.15 * c * c));
      p.setZ(i, p.getZ(i) * (1 - 0.1 * a * a) * (1 - 0.12 * bb * bb));
      p.setX(i, p.getX(i) * (1 - 0.06 * bb * bb));
    }
    g.computeVertexNormals();
    const ng = g.toNonIndexed();
    ng.translate(0, 0.08, 0);
    // UVs weltskaliert (Meter)
    const uv = ng.attributes.uv, pp = ng.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) + pp.getZ(i) * 0.7, pp.getY(i) + pp.getZ(i) * 0.3);
    return ng;
  });
}

/** env-look (medium+): Sandsack als gefülltes Kissen – flach gedrückte Lauffläche, gewölbte Flanken, abgebundene,
 * eingeschnürte Enden („Ohren“), unten breiter gesackt (Last der oberen Lage), leichte Längsnaht. 144 Dreiecke. */
function sandbagGeomHD() {
  const L = 0.56, H = 0.16, D = 0.32;
  const g = new THREE.BoxGeometry(L, H, D, 6, 2, 3); // 144 Dreiecke (Speicher: Grenzland hat ≈ 1000 Säcke)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / (L / 2), bb = p.getY(i) / (H / 2), c = p.getZ(i) / (D / 2);
    const ea = Math.abs(a);
    // Enden: abgebunden (Querschnitt schnürt sich zusammen), Ecken gerundet
    const tie = ea > 0.6 ? 1 - Math.pow((ea - 0.6) / 0.4, 1.6) * 0.62 : 1;
    const round = Math.pow(Math.max(0, 1 - Math.pow(ea, 6)), 0.32);
    let y = bb * (H / 2) * round * tie * (1 - 0.22 * c * c * c * c);
    if (bb < 0) y *= 0.82;                         // Unterseite flach aufliegend
    y += (bb > 0.5 && Math.abs(c) < 0.3 ? -0.004 : 0) * (1 - ea); // Längsnaht
    let z = c * (D / 2) * (1 - 0.14 * a * a * a * a) * (1 - 0.1 * bb * bb) * tie * (1 + 0.07 * Math.max(0, -bb));
    const x = a * (L / 2) * (1 - 0.05 * bb * bb) * (ea > 0.95 ? 0.98 : 1);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  ng.translate(0, 0.075, 0);
  const uv = ng.attributes.uv, pp = ng.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) + pp.getZ(i) * 0.7, pp.getY(i) + pp.getZ(i) * 0.3);
  return ng;
}

/** Sandsackwall entlang einer Linie. rows: Lagen (3 ≈ 0,45 m, 6 ≈ 0,9 m). */
export function sandbags(b, x0, z0, x1, z1, o = {}) {
  const hd = o.detail ?? (b.lookQuality ? b.lookQuality !== 'low' : false);
  const rows = o.rows ?? 4, y = o.y ?? 0, g = sandbagGeom(hd);
  const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
  const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
  const depth = o.double ? 2 : 1;
  const tints = ['#b8a87f', '#a99a72', '#c2b28a', '#9e9070'];
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0.27 : 0;
    const n = Math.floor((L - off) / 0.54);
    for (let i = 0; i < n; i++) {
      const s = off + 0.27 + i * 0.54;
      for (let k = 0; k < depth; k++) {
        const lz = (k - (depth - 1) / 2) * 0.33 - uz * 0;
        const nx = -uz * lz, nz = ux * lz;
        const jx = (b.rand() - 0.5) * 0.03, jz = (b.rand() - 0.5) * 0.03, jr = (b.rand() - 0.5) * 0.12, tint = b.pick(tints);
        const px = x0 + ux * s + nx + jx, pz = z0 + uz * s + nz + jz;
        // env-look: leichte Neigung je Sack (liegen nie exakt eben), nur mit der Detailform. Mehrspieler: aus der
        // Position (hash01), NICHT aus dem Kartenzufall – sonst verschöbe „ab mittel“ alle späteren Platzierungen
        const hk = 40 + r * 8 + k * 3;
        const tilt = hd ? { rx: (hash01(px, pz, hk) - 0.5) * 0.06, rz: (hash01(px, pz, hk + 1) - 0.5) * 0.08, sy: 0.92 + hash01(px, pz, hk + 2) * 0.16 } : {};
        b.geom(g, px, y + r * 0.145, pz, 'sandbag', { ry: ry + jr, ...tilt, tint, collide: false, minimap: false, uv: 'keep', grad: false, aoFloor: y });
      }
    }
  }
  b.box((x0 + x1) / 2, y, (z0 + z1) / 2, L, rows * 0.145 + 0.03, 0.34 * depth, 'black', { ry, visual: false, minimap: 'cover' });
}

// ---------------------------------------------------------------------------
// Betonbarriere, Poller, Kegel
// ---------------------------------------------------------------------------
function jerseyGeom(len) {
  return cached('jersey' + len, () => {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.2, 0.25); s.lineTo(0.09, 0.81); s.lineTo(-0.09, 0.81); s.lineTo(-0.2, 0.25); s.lineTo(-0.3, 0.08); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    g.rotateY(Math.PI / 2); // Länge entlang x
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    return ng;
  });
}

export function jersey(b, x, z, o = {}) {
  const len = o.len ?? 3, ry = o.ry || 0;
  if (b.hasModel('concrete_road_barrier')) {
    // Fotoscan-Leitwand (1,54 m je Element), Elemente aneinandergereiht; Kollision unten wie bisher
    const n = Math.max(1, Math.round(len / 1.54)), seg = len / n, c = Math.cos(ry), sn = Math.sin(ry);
    for (let i = 0; i < n; i++) {
      const lx = -len / 2 + seg * (i + 0.5);
      b.model('concrete_road_barrier', x + lx * c, o.y ?? 0, z - lx * sn, { ry: ry + (hash01(x, z, i) - 0.5) * 0.04 + (hash01(z, x, i) < 0.5 ? Math.PI : 0), sx: seg / 1.54, collide: false,
        fallback: (bb) => bb.geom(jerseyGeom(seg), x + lx * c, o.y ?? 0, z - lx * sn, 'concrete', { ry, tint: o.tint || '#d6d2c8', uv: 'local', collide: false, aoFloor: o.y ?? 0 }) });
    }
    b.box(x, o.y ?? 0, z, len, 0.81, 0.6, 'black', { ry, visual: false, minimap: 'cover' });
    return;
  }
  b.geom(jerseyGeom(len), x, o.y ?? 0, z, 'concrete', { ry, tint: o.tint || '#d6d2c8', uv: 'local', collide: false, aoFloor: o.y ?? 0 });
  b.box(x, o.y ?? 0, z, len, 0.81, 0.6, 'black', { ry, visual: false, minimap: 'cover' });
  if (o.stripes) {
    const f = frame(b, x, o.y ?? 0, z, ry);
    for (let i = 0; i < Math.floor(len / 0.6); i++) f.box(-len / 2 + 0.3 + i * 0.6, 0.45, 0, 0.3, 0.2, 0.34, 'white', { tint: i % 2 ? '#c8302a' : '#f2f0ea', collide: false, minimap: false, grad: false, ao: false, rz: 0 });
  }
}

export function bollard(b, x, z, o = {}) {
  const y = o.y ?? 0;
  if (o.mooring) {
    b.cyl(x, y, z, 0.24, 0.55, 'metal_painted', { tint: o.tint || '#2a2c2e', seg: 12, minimap: 'cover' });
    b.cyl(x, y + 0.55, z, 0.34, 0.1, 'metal_painted', { tint: o.tint || '#2a2c2e', seg: 12, collide: false, minimap: false, ao: false });
    return;
  }
  b.cyl(x, y, z, 0.11, 0.95, 'metal_painted', { tint: o.tint || '#d9a72a', seg: 10, minimap: 'prop' });
  b.cyl(x, y + 0.7, z, 0.115, 0.12, 'metal_painted', { tint: '#1d1d1f', seg: 10, collide: false, minimap: false, ao: false });
}

export function cone(b, x, z, o = {}) {
  const y = o.y ?? 0;
  b.box(x, y, z, 0.38, 0.03, 0.38, 'rubber', { collide: false, minimap: false });
  b.cyl(x, y + 0.03, z, 0.15, 0.6, 'polymer', { r1: 0.025, tint: '#ff6a1a', seg: 10, collide: false, minimap: false });
  b.cyl(x, y + 0.3, z, 0.098, 0.1, 'white', { r1: 0.075, seg: 10, collide: false, minimap: false, ao: false });
}

// ---------------------------------------------------------------------------
// Fahrzeuge
// ---------------------------------------------------------------------------
function wheel(f, lx, ly, lz, r, w) {
  f.cyl(lx, ly, lz, r, w, 'rubber', { axis: 'x', ry: Math.PI / 2, collide: false, minimap: false, seg: 14 });
  f.cyl(lx + 0, ly, lz, r * 0.55, w + 0.02, 'metal_galvanized', { axis: 'x', ry: Math.PI / 2, collide: false, minimap: false, seg: 10 });
}

/** PKW (lokal z = Länge). style: 'sedan'|'hatch'|'wreck' */
export function car(b, x, z, o = {}) {
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0), col = o.color || b.pick(['#8c2b24', '#2f4f6e', '#c7c7c2', '#3b3d40', '#6b7a52', '#b98b3a']);
  if (b.hasModel('covered_car') && o.model !== false) {
    // abgedecktes Auto (Fotoscan, Plane über der Karosserie) – Maße wie das prozedurale (1,8 × 1,42 × 4,3 m)
    b.model('covered_car', x, o.y ?? 0, z, { ry: o.ry || 0, collide: false, fallback: (bb) => car(bb, x, z, { ...o, color: col, model: false }) });
    f.solid(0, 0, 0, 1.8, 1.42, 4.3, { minimap: 'vehicle' });
    b.decal(x, (o.y ?? 0) + 0.01, z, 2.6, 4.6, 'oil', { ry: o.ry || 0, opacity: 0.5 });
    return;
  }
  const L = 4.3, W = 1.8, hatch = o.style === 'hatch';
  const wreck = o.style === 'wreck';
  const pm = 'metal_painted';
  f.box(0, 0.32, 0, W, 0.52, L, pm, { tint: col, collide: false, minimap: false, grad: false });
  f.box(0, 0.24, 0, W - 0.1, 0.1, L - 0.4, 'rubber', { collide: false, minimap: false, grad: false });
  // Motorhaube/Heck leicht geneigt
  f.wedge(0, 0.84, L / 2 - 0.65, W - 0.04, 0.08, 1.2, pm, { ry: Math.PI, tint: col, collide: false, minimap: false });
  // Kabine
  const cz = hatch ? -0.35 : -0.15, cl = hatch ? 2.4 : 2.1;
  f.box(0, 0.84, cz, W - 0.16, 0.5, cl, 'glass', { collide: false, minimap: false, grad: false });
  f.box(0, 1.32, cz, W - 0.2, 0.06, cl - 0.25, pm, { tint: col, collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (W / 2 - 0.1), 0.84, cz + sz * (cl / 2 - 0.08), 0.07, 0.5, 0.12, pm, { tint: col, collide: false, minimap: false, grad: false });
  f.box(0, 0.84, cz, 0.06, 0.5, 0.08, pm, { tint: col, collide: false, minimap: false, grad: false, ry: 0 });
  // Stoßstangen, Lichter
  f.box(0, 0.3, L / 2 + 0.03, W - 0.05, 0.18, 0.1, 'polymer', { collide: false, minimap: false, grad: false });
  f.box(0, 0.3, -L / 2 - 0.03, W - 0.05, 0.18, 0.1, 'polymer', { collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) {
    f.box(sx * 0.62, 0.62, L / 2 + 0.005, 0.32, 0.1, 0.04, wreck ? 'glass' : 'lamp_warm', { collide: false, minimap: false, ao: false });
    f.box(sx * 0.66, 0.66, -L / 2 - 0.005, 0.26, 0.1, 0.04, wreck ? 'glass' : 'lamp_red', { collide: false, minimap: false, ao: false });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(f, sx * (W / 2 - 0.12), wreck && sz > 0 ? 0.22 : 0.33, sz * 1.35, wreck && sz > 0 ? 0.24 : 0.33, 0.24);
  f.solid(0, 0, 0, W, 1.42, L, { minimap: 'vehicle' });
  b.decal(x, (o.y ?? 0) + 0.01, z, 2.6, 4.6, 'oil', { ry: o.ry || 0, opacity: 0.6 });
}

/** Lieferwagen / Transporter (lokal z = Länge) */
export function van(b, x, z, o = {}) {
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0), col = o.color || '#e8e6e0';
  const L = 5.2, W = 2.0;
  f.box(0, 0.38, -0.35, W, 2.0, L - 0.8, 'metal_painted', { tint: col, collide: false, minimap: false, grad: false });
  f.box(0, 0.38, L / 2 - 0.6, W - 0.02, 1.05, 1.2, 'metal_painted', { tint: col, collide: false, minimap: false, grad: false });
  f.wedge(0, 1.43, L / 2 - 0.85, W - 0.04, 0.8, 0.72, 'glass', { ry: Math.PI, collide: false, minimap: false });
  for (const sx of [-1, 1]) f.box(sx * (W / 2 + 0.005), 1.45, L / 2 - 1.55, 0.02, 0.6, 0.8, 'glass', { collide: false, minimap: false, ao: false });
  f.box(0, 0.25, 0, W - 0.1, 0.15, L - 0.4, 'rubber', { collide: false, minimap: false, grad: false });
  f.box(0, 0.32, L / 2 + 0.03, W, 0.2, 0.1, 'polymer', { collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(f, sx * (W / 2 - 0.12), 0.36, sz * 1.7, 0.36, 0.26);
  if (o.logo) { const [lx, lz] = f.P(W / 2 + 0.01, -0.6); b.sign(lx, (o.y ?? 0) + 1.0, lz, 2.4, 0.8, o.logo, { ry: (o.ry || 0) + Math.PI / 2, back: false, depth: 0 }); }
  f.solid(0, 0, 0, W, 2.4, L, { minimap: 'vehicle' });
}

/** Sattelzug / Lkw. trailer: 'container'|'box'|'flatbed'|'tank'|null. Lokal z = Länge, Kabine bei +z. */
export function truck(b, x, z, o = {}) {
  const y = o.y ?? 0, f = frame(b, x, y, z, o.ry || 0), col = o.color || '#c8402f';
  const cabZ = o.trailer === null ? 2.2 : 5.6;
  // Kabine
  f.box(0, 0.9, cabZ, 2.45, 2.1, 2.2, 'metal_painted', { tint: col, collide: false, minimap: false, grad: false });
  f.box(0, 1.85, cabZ + 1.11, 2.2, 0.85, 0.02, 'glass', { collide: false, minimap: false, ao: false });
  for (const sx of [-1, 1]) f.box(sx * 1.235, 1.9, cabZ + 0.55, 0.02, 0.75, 0.9, 'glass', { collide: false, minimap: false, ao: false });
  f.box(0, 0.55, cabZ + 1.15, 2.45, 0.35, 0.15, 'polymer', { collide: false, minimap: false, grad: false });
  f.box(0, 1.0, cabZ + 1.13, 1.4, 0.55, 0.04, 'metal_galvanized', { collide: false, minimap: false, ao: false });
  f.box(0, 3.0, cabZ - 0.2, 2.3, 0.4, 1.6, 'metal_painted', { tint: shade(col, 0.9), collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) f.box(sx * 0.95, 0.75, cabZ + 1.16, 0.32, 0.14, 0.04, 'lamp_warm', { collide: false, minimap: false, ao: false });
  // Fahrgestell
  f.box(0, 0.55, cabZ - 2.6, 1.0, 0.35, 5.2, 'metal_painted', { tint: '#26282b', collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) f.cyl(sx * 1.0, 0.65, cabZ - 1.5, 0.28, 1.2, 'metal_galvanized', { axis: 'z', collide: false, minimap: false });
  for (const sx of [-1, 1]) { wheel(f, sx * 1.05, 0.52, cabZ + 0.2, 0.52, 0.35); wheel(f, sx * 1.05, 0.52, cabZ - 2.6, 0.52, 0.4); }
  f.solid(0, 0, cabZ, 2.5, 3.4, 2.4, { minimap: 'vehicle' });
  if (o.trailer === null) return;
  // Auflieger
  const tl = 12.2, tz = cabZ - 1.7 - tl / 2 + 1.2;
  const tt = o.trailer || 'box';
  f.box(0, 1.05, tz, 2.5, 0.25, tl, 'metal_painted', { tint: '#3a3d40', collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) for (const k of [0, 1, 2]) wheel(f, sx * 1.05, 0.52, tz - tl / 2 + 1.2 + k * 1.3, 0.52, 0.4);
  f.box(0, 0.2, tz + tl / 2 - 2.5, 0.12, 0.85, 0.12, 'metal_painted', { tint: '#26282b', collide: false, minimap: false });
  if (tt === 'container') { const [cx, cz] = f.P(0, tz); container(b, cx, y + 1.3, cz, { len: 12.19, ry: (o.ry || 0) + Math.PI / 2, color: o.containerColor, logo: o.logo, minimap: 'vehicle' }); }
  else if (tt === 'box') {
    f.box(0, 1.3, tz, 2.5, 2.7, tl, 'metal_corrugated', { tint: o.boxColor || '#d8d8d2', minimap: 'vehicle', grad: false, uv: 'local' });
    if (o.logo) { const [lx, lz] = f.P(1.26, tz); b.sign(lx, y + 2.0, lz, 7, 1.4, o.logo, { ry: (o.ry || 0) + Math.PI / 2, back: false, depth: 0 }); }
  } else if (tt === 'tank') {
    f.cyl(0, 2.45, tz, 1.15, tl - 0.4, 'metal_galvanized', { axis: 'z', minimap: 'vehicle' });
  } else if (tt === 'flatbed') {
    const [cx, cz] = f.P(0, tz - 2), [px, pz] = f.P(0.3, tz + 2.5);
    crateStack(b, cx, cz, { ry: o.ry, y: y + 1.3 });
    pallet(b, px, y + 1.3, pz, { ry: o.ry, load: 'wrapped' });
  }
  f.solid(0, 0, tz, 2.5, 1.3, tl, { minimap: false });
}

/** Gabelstapler (lokal z = Fahrtrichtung, Gabel bei +z) */
export function forklift(b, x, z, o = {}) {
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0), col = o.color || '#e0a02a';
  f.box(0, 0.3, -0.2, 1.15, 0.8, 1.7, 'metal_painted', { tint: col, collide: false, minimap: false, grad: false });
  f.cyl(0, 0.3, -1.05, 0.58, 0.85, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, arc: Math.PI, ry: Math.PI / 2, caps: true });
  f.box(0, 1.1, -0.45, 0.5, 0.45, 0.5, 'polymer', { collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * 0.52, 1.1, -0.3 + sz * 0.6, 0.06, 1.15, 0.06, 'metal_painted', { tint: '#26282b', collide: false, minimap: false, grad: false });
  f.box(0, 2.25, -0.3, 1.15, 0.05, 1.3, 'metal_grate', { collide: false, minimap: false, grad: false });
  // Hubmast + Gabel
  for (const sx of [-1, 1]) f.box(sx * 0.32, 0.15, 0.82, 0.1, 2.45, 0.12, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
  const fy = o.forkY ?? 0.08;
  f.box(0, fy + 0.1, 0.92, 0.8, 0.45, 0.06, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) f.box(sx * 0.25, fy, 1.5, 0.12, 0.05, 1.1, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false, grad: false });
  for (const sx of [-1, 1]) { wheel(f, sx * 0.5, 0.33, 0.45, 0.33, 0.25); wheel(f, sx * 0.5, 0.26, -0.85, 0.26, 0.2); }
  f.box(0, 2.27, -0.95, 0.2, 0.08, 0.2, 'lamp_warm', { collide: false, minimap: false, ao: false });
  f.solid(0, 0, -0.2, 1.2, 2.3, 2.1, { minimap: 'vehicle' });
  if (o.load) { const [px, pz] = f.P(0, 1.55); pallet(b, px, (o.y ?? 0) + fy + 0.05, pz, { ry: (o.ry || 0) + Math.PI / 2, load: o.load }); }
}

// ---------------------------------------------------------------------------
// Technik
// ---------------------------------------------------------------------------
/** Klimagerät an Wand (Normale ry zeigt nach außen) oder auf Dach. */
export function acUnit(b, x, y, z, o = {}) {
  if (b.hasModel('exterior_aircon_unit') && o.model !== false) {
    // Fotoscan-Klimagerät (zwei Varianten: neu/verrostet); Halterung und Kondensatleitung sind im Modell
    const part = hash01(x, z, 7) < 0.55 ? 'exterior_aircon_unit_rusted' : 'exterior_aircon_unit';
    b.model('exterior_aircon_unit', x, y - (o.bracket === false ? 0 : 0.1), z, { part, ry: o.ry || 0, s: o.s ?? 0.95, collide: o.collide ?? false, minimap: false, fallback: (bb) => acUnit(bb, x, y, z, { ...o, model: false }) });
    return;
  }
  const f = frame(b, x, y, z, o.ry || 0);
  f.box(0, 0, 0, 0.95, 0.65, 0.38, 'metal_painted', { tint: o.tint || '#d8d9d4', collide: o.collide ?? false, minimap: false, grad: false });
  f.cyl(0.18, 0.33, 0.2, 0.22, 0.02, 'black', { axis: 'z', collide: false, minimap: false, seg: 14 });
  for (let i = 0; i < 5; i++) f.box(0.18, 0.13 + i * 0.09, 0.205, 0.44, 0.012, 0.012, 'metal_galvanized', { collide: false, minimap: false, ao: false });
  f.box(-0.3, 0.1, 0.2, 0.22, 0.45, 0.01, 'metal_galvanized', { collide: false, minimap: false, ao: false });
  if (o.bracket !== false) for (const sx of [-0.35, 0.35]) f.box(sx, -0.08, -0.05, 0.04, 0.08, 0.5, 'metal_galvanized', { collide: false, minimap: false, ao: false });
  if (o.pipe) f.cyl(-0.42, -o.pipe, -0.12, 0.02, o.pipe, 'metal_galvanized', { collide: false, seg: 5, ao: false });
}

/** Dach-Lüftungsanlage */
export function roofVent(b, x, y, z, o = {}) {
  const f = frame(b, x, y, z, o.ry || 0);
  f.box(0, 0, 0, 1.6, 1.0, 1.2, 'metal_galvanized', { minimap: 'cover', aoFloor: y });
  f.cyl(0.3, 1.0, 0, 0.35, 0.25, 'metal_galvanized', { collide: false, minimap: false });
  f.cyl(0.3, 1.25, 0, 0.42, 0.04, 'black', { collide: false, minimap: false, ao: false });
  f.box(-0.5, 0.2, 0.61, 0.5, 0.5, 0.02, 'metal_grate', { collide: false, minimap: false, ao: false });
}

/** Rohrleitung durch Punkte [[x,y,z],...]. */
export function pipe(b, pts, o = {}) {
  const r = o.r ?? 0.12, mat = o.mat || 'metal_painted', tint = o.tint || '#7c8a92';
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 0.01) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    if (Math.abs(dy) > 0.95 * L) b.cyl(ax, Math.min(ay, by), az, r, L, mat, { tint, collide: o.collide ?? false, minimap: false, seg: 10, grad: false, ao: false });
    else {
      const ry = Math.atan2(-dz, dx), ang = Math.atan2(dy, Math.hypot(dx, dz));
      b.cyl(mx, my, mz, r, L, mat, { axis: 'x', ry, rz: ang, tint, collide: o.collide ?? false, minimap: false, seg: 10 });
    }
    // Flansch
    if (o.flanges !== false && L > 2) b.cyl(...flangePos(ax, ay, az, dx, dy, dz, L), r * 1.35, 0.06, mat, { ...flangeRot(dx, dy, dz), tint, collide: false, minimap: false, seg: 10 });
  }
  for (let i = 1; i < pts.length - 1; i++) b.geom(sphereGeom(), pts[i][0], pts[i][1], pts[i][2], mat, { sx: r * 1.05, sy: r * 1.05, sz: r * 1.05, tint, collide: false, minimap: false, ao: false });
}
function flangePos(ax, ay, az, dx, dy, dz, L) { const t = 0.5 / L; return [ax + dx * t, ay + dy * t, az + dz * t]; }
function flangeRot(dx, dy, dz) {
  if (Math.abs(dy) > 0.95 * Math.hypot(dx, dy, dz)) return {};
  return { axis: 'x', ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, Math.hypot(dx, dz)) };
}
function sphereGeom() { return cached('sphere', () => new THREE.SphereGeometry(1, 10, 7).toNonIndexed()); }
/** Grobe Kugel (Waren, Obst, Kleinteile – spart Dreiecke). */
function lowSphereGeom() { return cached('sphereLow', () => new THREE.SphereGeometry(1, 6, 4).toNonIndexed()); }
export { sphereGeom, lowSphereGeom };

/** Kabel als Kettenlinie zwischen zwei Punkten. */
export function cable(b, a, c, o = {}) {
  const sag = o.sag ?? 0.6, n = o.segments ?? 8, r = o.r ?? 0.018;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - Math.sin(Math.PI * t) * sag, a[2] + (c[2] - a[2]) * t]);
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    b.cyl((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, r, L, 'rubber', { axis: 'x', ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, Math.hypot(dx, dz)), collide: false, minimap: false, seg: 4, caps: false, ao: false, bullet: false, cast: o.cast ?? false });
  }
}

/** Straßenlaterne / Mastleuchte. kind: 'sodium'|'cool'|'warm'. light: echtes Punktlicht */
export function lampPost(b, x, z, o = {}) {
  const y = o.y ?? 0, h = o.h ?? 6, ry = o.ry || 0, f = frame(b, x, y, z, ry);
  const tint = o.tint || '#3a3e43';
  b.cyl(x, y, z, 0.14, 0.35, 'concrete', { seg: 10, minimap: 'prop', tint: '#bdb8ad' });
  b.cyl(x, y + 0.35, z, 0.07, h - 0.35, 'metal_painted', { r1: 0.05, tint, seg: 8, collide: true, minimap: false });
  const arm = o.arm ?? 1.3;
  f.box(arm / 2, h - 0.08, 0, arm, 0.08, 0.08, 'metal_painted', { tint, collide: false, minimap: false, grad: false });
  f.box(arm, h - 0.2, 0, 0.6, 0.16, 0.3, 'metal_painted', { tint, collide: false, minimap: false, grad: false });
  const lampMat = o.kind === 'cool' ? 'lamp_cool' : o.kind === 'warm' ? 'lamp_warm' : 'lamp_sodium';
  f.box(arm, h - 0.23, 0, 0.5, 0.03, 0.24, lampMat, { collide: false, minimap: false, ao: false, cast: false });
  const [lx, lz] = f.P(arm, 0);
  if (o.light) b.light('point', lx, y + h - 0.45, lz, { color: o.kind === 'cool' ? '#dfe9ff' : o.kind === 'warm' ? '#ffd59a' : '#ffad55', intensity: o.intensity ?? 18, distance: o.distance ?? 16, priority: o.priority ?? 1 });
  if (o.glow) b.glow(lx, y + h - 0.3, lz, { color: o.kind === 'cool' ? '#cfe0ff' : o.kind === 'warm' ? '#ffd090' : '#ffa040', size: o.glowSize ?? 2.4, intensity: o.glow === true ? 1 : o.glow });
  return [lx, lz];
}

/** Flutlicht-Mast (mehrere Strahler). */
export function floodMast(b, x, z, o = {}) {
  const y = o.y ?? 0, h = o.h ?? 10, ry = o.ry || 0, f = frame(b, x, y, z, ry);
  b.cyl(x, y, z, 0.22, 0.6, 'concrete', { seg: 10, minimap: 'pillar' });
  b.cyl(x, y + 0.6, z, 0.12, h - 0.6, 'metal_galvanized', { r1: 0.08, seg: 8, minimap: false });
  f.box(0, h, 0, 2.0, 0.1, 0.1, 'metal_galvanized', { collide: false, minimap: false, grad: false });
  for (const sx of [-0.7, 0, 0.7]) {
    f.box(sx, h + 0.1, 0.05, 0.5, 0.4, 0.25, 'metal_painted', { tint: '#2f3236', collide: false, minimap: false, grad: false, rx: -0.4 });
    f.box(sx, h + 0.16, 0.19, 0.42, 0.3, 0.02, o.kind === 'sodium' ? 'lamp_sodium' : 'lamp_cool', { collide: false, minimap: false, ao: false, rx: -0.4, cast: false });
    if (o.glow) { const [gx, gz] = f.P(sx, 0.35); b.glow(gx, y + h + 0.3, gz, { color: o.kind === 'sodium' ? '#ffa040' : '#d8e6ff', size: o.glowSize ?? 2.6 }); }
  }
}

/** Zaun von A nach B. style: 'chain' (Maschendraht, durchschießbar) | 'palisade' | 'mesh' */
export function fence(b, x0, z0, x1, z1, o = {}) {
  const h = o.h ?? 2.4, y = o.y ?? 0, L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
  const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
  const n = Math.max(1, Math.round(L / (o.spacing ?? 2.6)));
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    b.cyl(x0 + ux * s, y, z0 + uz * s, 0.045, h + 0.05, 'metal_galvanized', { seg: 6, collide: false, minimap: false, ao: o.ao });
  }
  b.cyl((x0 + x1) / 2, y + h, (z0 + z1) / 2, 0.03, L, 'metal_galvanized', { axis: 'x', ry, seg: 6, collide: false, minimap: false, ao: false });
  const style = o.style || 'chain';
  if (style === 'chain' || style === 'mesh') {
    // Maschendraht: Fotoscan-Satz „chainlink“ (dünn → geblendet, bleibt auch in kleinen Mip-Stufen durchsichtig);
    // Gitterzaun („mesh“): dichtes Gitter mit Alphatest
    const chain = style === 'chain';
    b.box((x0 + x1) / 2, y + 0.05, (z0 + z1) / 2, L, h - 0.08, 0.02, chain ? 'chainlink' : 'metal_grate', { ry, collide: false, minimap: false, bullet: false, grad: false, uvScale: chain ? 1 : 0.8, ao: false, matOpts: null, cast: !chain });
    if (o.barbed) b.cyl((x0 + x1) / 2, y + h + 0.25, (z0 + z1) / 2, 0.012, L, 'metal_galvanized', { axis: 'x', ry, seg: 4, collide: false, minimap: false, ao: false });
  } else {
    const m = Math.round(L / 0.12);
    for (let i = 0; i < m; i++) {
      const s = (i + 0.5) * (L / m);
      b.box(x0 + ux * s, y, z0 + uz * s, 0.05, h - 0.05 + (i % 2) * 0.12, 0.03, 'metal_painted', { ry, tint: o.tint || '#2f4a3a', collide: false, minimap: false, grad: false });
    }
  }
  b.box((x0 + x1) / 2, y, (z0 + z1) / 2, L, Math.max(h, o.colliderH ?? 4), 0.12, 'black', { ry, visual: false, minimap: o.minimap ?? 'wall', bullet: style !== 'chain' && style !== 'mesh' });
}

/** Müllcontainer */
export function dumpster(b, x, z, o = {}) {
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0), col = o.color || '#2f5e3e';
  f.box(0, 0.12, 0, 1.9, 1.05, 1.1, 'metal_painted', { tint: col, collide: false, minimap: false, grad: false });
  f.box(0, 1.17, 0, 1.95, 0.06, 1.15, 'polymer', { collide: false, minimap: false, grad: false, rx: o.open ? -0.5 : 0.05 });
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.42, 0.42]) f.cyl(sx, 0, sz, 0.07, 0.12, 'rubber', { collide: false, minimap: false, seg: 8 });
  f.solid(0, 0, 0, 1.95, 1.25, 1.15, { minimap: 'cover' });
}

/** Reifenstapel */
export function tires(b, x, z, o = {}) {
  const n = o.n ?? 4, y = o.y ?? 0;
  if (b.hasModel('old_tyre')) {
    // gestapelte Altreifen (liegend), Kollision als ein Zylinder wie bisher
    for (let i = 0; i < n; i++) {
      const ox = (b.rand() - 0.5) * 0.08, oz = (b.rand() - 0.5) * 0.08;
      b.model('old_tyre', x + ox, y + i * 0.2 + 0.1, z + oz, { pivot: 'center', rx: Math.PI / 2, ry: hash01(x, z, i) * 6.28, s: 1.18, collide: false,
        fallback: (bb) => { bb.cyl(x + ox, y + i * 0.24, z + oz, 0.36, 0.24, 'rubber', { seg: 14, collide: false, minimap: false, grad: i === 0 }); } });
    }
    b.cyl(x, y, z, 0.37, n * 0.2, 'black', { visual: false, minimap: 'cover' });
    return;
  }
  for (let i = 0; i < n; i++) {
    const ox = (b.rand() - 0.5) * 0.08, oz = (b.rand() - 0.5) * 0.08;
    b.cyl(x + ox, y + i * 0.24, z + oz, 0.36, 0.24, 'rubber', { seg: 14, collide: false, minimap: false, grad: i === 0 });
    b.cyl(x + ox, y + i * 0.24 + 0.005, z + oz, 0.2, 0.235, 'black', { seg: 10, collide: false, minimap: false, ao: false });
  }
  b.cyl(x, y, z, 0.37, n * 0.24, 'black', { visual: false, minimap: 'cover' });
}

/** Kabeltrommel */
export function cableReel(b, x, z, o = {}) {
  const r = o.r ?? 0.65, y = o.y ?? 0, ry = o.ry || 0;
  const f = frame(b, x, y, z, ry);
  for (const s of [-1, 1]) f.cyl(s * 0.38, r, 0, r, 0.06, 'wood_planks', { axis: 'x', tint: '#b89a6c', collide: false, minimap: false });
  f.cyl(0, r, 0, r * 0.55, 0.7, 'rubber', { axis: 'x', tint: '#3d6b45', collide: false, minimap: false });
  f.solid(0, 0, 0, 0.85, r * 2, r * 2, { minimap: 'cover' });
}

/** Gasflaschen-Gruppe */
export function gasBottles(b, x, z, o = {}) {
  const n = o.n ?? 5, y = o.y ?? 0, colors = ['#3a6fb0', '#c8402f', '#5c6b3a', '#d9d9d2', '#c9a227'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = n > 3 ? 0.28 : 0.15;
    const bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr;
    b.cyl(bx, y, bz, 0.11, 1.25, 'metal_painted', { tint: colors[i % colors.length], seg: 10, collide: false, minimap: false });
    b.cyl(bx, y + 1.25, bz, 0.11, 0.12, 'metal_painted', { r1: 0.04, tint: colors[i % colors.length], seg: 10, collide: false, minimap: false, ao: false });
    b.cyl(bx, y + 1.37, bz, 0.03, 0.08, 'metal_galvanized', { seg: 6, collide: false, minimap: false, ao: false });
  }
  b.cyl(x, y, z, 0.42, 1.45, 'black', { visual: false, minimap: 'cover' });
}

/** Elektro-/Schaltkasten */
export function electricBox(b, x, y, z, o = {}) {
  const f = frame(b, x, y, z, o.ry || 0), w = o.w ?? 0.8, h = o.h ?? 1.2, d = o.d ?? 0.35;
  f.box(0, 0, 0, w, h, d, 'metal_painted', { tint: o.tint || '#9aa39a', minimap: o.minimap ?? 'cover', collide: o.collide ?? true, aoFloor: o.aoFloor });
  f.box(0, 0.08, d / 2 + 0.005, 0.01, h - 0.16, 0.01, 'black', { collide: false, minimap: false, ao: false });
  f.box(w / 4, h * 0.55, d / 2 + 0.02, 0.06, 0.12, 0.03, 'metal_galvanized', { collide: false, minimap: false, ao: false });
  if (o.warn !== false) b.sign(...f.P(-w / 4, d / 2 + 0.01), y + h * 0.62, 0.22, 0.2, 'warn_volt', { ry: o.ry || 0, back: false, depth: 0 });
}

// ---------------------------------------------------------------------------
// Stadtmöbel
// ---------------------------------------------------------------------------
export function bench(b, x, z, o = {}) {
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0);
  for (const sx of [-0.7, 0.7]) f.box(sx, 0, 0, 0.08, 0.42, 0.45, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false });
  for (let i = 0; i < 3; i++) f.box(0, 0.42, -0.15 + i * 0.15, 1.7, 0.04, 0.12, 'wood_planks', { tint: '#b58a5a', collide: false, minimap: false, grad: false });
  if (o.back !== false) for (let i = 0; i < 2; i++) f.box(0, 0.6 + i * 0.16, -0.24, 1.7, 0.1, 0.04, 'wood_planks', { tint: '#b58a5a', collide: false, minimap: false, grad: false });
  f.solid(0, 0, 0, 1.75, 0.5, 0.5, { minimap: 'prop' });
}

export function cafeTable(b, x, z, o = {}) {
  const y = o.y ?? 0;
  b.cyl(x, y, z, 0.25, 0.03, 'metal_painted', { tint: '#2b2d30', seg: 10, collide: false, minimap: false });
  b.cyl(x, y, z, 0.03, 0.72, 'metal_painted', { tint: '#2b2d30', seg: 6, collide: false, minimap: false });
  b.cyl(x, y + 0.72, z, 0.38, 0.03, o.top || 'white', { tint: o.topTint || '#ece6da', seg: 14, collide: false, minimap: false, ao: false });
  b.cyl(x, y, z, 0.38, 0.76, 'black', { visual: false, minimap: 'prop' });
  const n = o.chairs ?? 2;
  for (let i = 0; i < n; i++) {
    const a = (o.ry || 0) + (i / n) * Math.PI * 2 + 0.3;
    chair(b, x + Math.cos(a) * 0.7, z + Math.sin(a) * 0.7, { ry: -a - Math.PI / 2, y, tint: o.chairTint, model: o.chairModel });
  }
}

export function chair(b, x, z, o = {}) {
  if (o.model === true && b.hasModel('plastic_monobloc_chair_01')) {
    // Monobloc-Gartenstuhl (Fotoscan) – auf Wunsch (Terrassen, Dächer); sonst bleibt der prozedurale Stuhl
    b.model('plastic_monobloc_chair_01', x, o.y ?? 0, z, { ry: (o.ry || 0) + Math.PI, s: 0.95, collide: false, fallback: (bb) => chair(bb, x, z, { ...o, model: false }) });
    return;
  }
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0), t = o.tint || '#2f6f9a';
  for (const sx of [-0.18, 0.18]) for (const sz of [-0.18, 0.18]) f.box(sx, 0, sz, 0.035, 0.45, 0.035, 'metal_painted', { tint: '#2b2d30', collide: false, minimap: false });
  f.box(0, 0.45, 0, 0.42, 0.04, 0.42, 'wood_planks', { tint: t, collide: false, minimap: false, grad: false });
  f.box(0, 0.49, -0.2, 0.42, 0.42, 0.04, 'wood_planks', { tint: t, collide: false, minimap: false, grad: false });
}

/** Sonnenschirm */
export function parasol(b, x, z, o = {}) {
  const y = o.y ?? 0, h = o.h ?? 2.4, r = o.r ?? 1.4;
  b.cyl(x, y, z, 0.03, h, 'metal_galvanized', { seg: 6, collide: false, minimap: false });
  b.cyl(x, y + h - 0.45, z, r, 0.45, 'awning', { r1: 0.05, seg: 8, caps: false, collide: false, minimap: false, uv: 'keep', uvScale: 1, matOpts: null, tint: o.tint });
  b.cyl(x, y, z, 0.22, 0.12, 'concrete', { seg: 8, minimap: false, collide: false });
}

/** Markise an einer Wand: (x,z) Wandpunkt Mitte, ry: Außennormale-Richtung (lokal +z nach außen). */
export function awning(b, x, y, z, w, depth, o = {}) {
  const f = frame(b, x, y, z, o.ry || 0);
  const drop = o.drop ?? 0.55, ang = Math.atan2(drop, depth), len = Math.hypot(depth, drop);
  const band = o.design ?? 0;
  // Stoff: lokale UVs → Atlasband
  const g = awningGeom(w, len, band);
  f.geom(g, 0, -drop / 2, depth / 2, 'awning', { rx: ang, collide: false, minimap: false, uv: 'keep', cast: true, ao: false, bullet: false });
  // Volant
  const g2 = awningGeom(w, 0.25, band);
  f.geom(g2, 0, -drop - 0.125, depth, 'awning', { rx: Math.PI / 2, collide: false, minimap: false, uv: 'keep', ao: false, bullet: false });
  // Arme
  for (const sx of [-w / 2 + 0.05, w / 2 - 0.05]) f.box(sx, -drop - 0.02, depth / 2, 0.03, 0.03, len, 'metal_painted', { tint: '#2b2d30', rx: ang, collide: false, minimap: false, grad: false, ao: false });
  if (o.posts) for (const sx of [-w / 2 + 0.05, w / 2 - 0.05]) f.cyl(sx, -y + (o.groundY ?? 0), depth - 0.05, 0.035, y - drop - (o.groundY ?? 0), 'metal_painted', { tint: '#2b2d30', seg: 6, collide: true, minimap: false });
}

function awningGeom(w, len, band) {
  return cached(`awn${w.toFixed(2)}_${len.toFixed(2)}_${band}`, () => {
    const g = new THREE.PlaneGeometry(w, len, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    const v0 = 1 - (band + 1) / 4, v1 = 1 - band / 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 1.2), v0 + 0.01 + uv.getY(i) * (v1 - v0 - 0.02));
    // beidseitig
    const back = g.clone(); back.scale(1, -1, 1); back.rotateZ(0);
    const idx = back.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t; }
    back.computeVertexNormals();
    const a = g.toNonIndexed(), c = back.toNonIndexed();
    const out = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) {
      const arr = new Float32Array(a.attributes[k].array.length * 2);
      arr.set(a.attributes[k].array); arr.set(c.attributes[k].array, a.attributes[k].array.length);
      out.setAttribute(k, new THREE.BufferAttribute(arr, a.attributes[k].itemSize));
    }
    return out;
  });
}

/** Marktstand mit Auslage und Sonnendach. lokal z = Front. */
export function marketStall(b, x, z, o = {}) {
  const y = o.y ?? 0, f = frame(b, x, y, z, o.ry || 0), w = o.w ?? 2.6, d = o.d ?? 1.4;
  // Tisch
  f.box(0, 0, 0, w, 0.85, d, 'wood_planks', { tint: o.wood || '#a07a52', minimap: 'cover' });
  f.box(0, 0.85, 0.05, w + 0.1, 0.05, d + 0.15, 'wood_dark', { collide: false, minimap: false, grad: false });
  // Kisten mit Waren
  const goods = o.goods || ['#e8862a', '#d43c2a', '#e6c53a', '#6aa53a', '#8a3a7a'];
  const n = Math.max(2, Math.floor(w / 0.6));
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + 0.35 + i * ((w - 0.7) / (n - 1));
    f.box(lx, 0.9, 0.25, 0.5, 0.18, 0.4, 'wood_crate', { uv: 'fit', collide: false, minimap: false, grad: false, rx: -0.15 });
    const col = goods[i % goods.length];
    for (let k = 0; k < 6; k++) f.geom(lowSphereGeom(), lx - 0.15 + (k % 3) * 0.15, 1.08 + Math.floor(k / 3) * 0.04, 0.15 + Math.floor(k / 3) * 0.18, 'white', { sx: 0.075, sy: 0.07, sz: 0.075, tint: col, collide: false, minimap: false, ao: false, bullet: false, cast: false });
  }
  // Pfosten + Dach
  const ph = 2.3;
  for (const sx of [-w / 2 + 0.05, w / 2 - 0.05]) for (const sz of [-d / 2, d / 2 + 0.3]) f.box(sx, 0, sz, 0.07, ph + (sz < 0 ? 0.25 : 0), 0.07, 'wood_dark', { collide: false, minimap: false });
  const g = awningGeom(w + 0.4, d + 0.9, o.design ?? 0);
  f.geom(g, 0, ph + 0.12, 0.15, 'awning', { rx: -0.18, collide: false, minimap: false, uv: 'keep', ao: false, bullet: false });
}

// ---------------------------------------------------------------------------
// Pflanzen
// ---------------------------------------------------------------------------
export function palm(b, x, z, o = {}) {
  const y = o.y ?? 0, h = o.h ?? 7, segs = 6, lean = o.lean ?? (b.rand() - 0.5) * 0.25, dir = o.dir ?? b.rand() * Math.PI * 2;
  // leichte Tonvariation aus der Position (verbraucht keinen Kartenzufall → übrige Platzierung unverändert)
  const tint = o.tint || ['#f2ece2', '#e6dfd2', '#ece8de'][Math.abs(Math.round(x * 7 + z * 13)) % 3];
  let px = x, pz = z, py = y;
  for (let i = 0; i < segs; i++) {
    const sh = h / segs, r0 = 0.24 - i * 0.018;
    const t = (i + 1) / segs;
    const nx = x + Math.cos(dir) * lean * h * t * t, nz = z + Math.sin(dir) * lean * h * t * t;
    const dx = nx - px, dz = nz - pz;
    // Rinde mit Blattnarben-Ringen; v läuft über alle Segmente durch (uvOffset = bisherige Höhe), sonst Sprung an jeder Fuge
    b.cyl(px, py, pz, r0, Math.hypot(sh, dx, dz), 'bark_palm', { r1: r0 - 0.015, tint, seg: 8, collide: i < 2, minimap: i === 0 ? 'prop' : false, rx: Math.atan2(dz, sh), rz: -Math.atan2(dx, sh), uvOffset: [0, py - y], grad: i === 0 });
    px = nx; pz = nz; py += sh;
  }
  b.plant('palm', px, py - 0.1, pz, { s: o.s ?? (0.9 + b.rand() * 0.3) });
}

export function tree(b, x, z, o = {}) {
  const y = o.y ?? 0, kind = o.kind || 'olive', h = o.h ?? (kind === 'olive' ? 2.6 : 3.4);
  const tw = kind === 'olive' ? 0.2 : 0.18;
  // Borke (Olive grauer, Laubbaum brauner) – Albedo aus der Textur, die Tönung variiert nur leicht
  const tint = o.tint || (kind === 'olive' ? '#e2e0da' : '#e8dccb');
  b.cyl(x, y, z, tw, h * 0.55, 'bark', { r1: tw * 0.8, tint, seg: 8, minimap: 'prop', rz: (b.rand() - 0.5) * 0.2 });
  b.cyl(x + 0.1, y + h * 0.5, z, tw * 0.7, h * 0.5, 'bark', { r1: tw * 0.4, tint, seg: 7, collide: false, minimap: false, rz: -0.35, grad: false, uvOffset: [0.3, h * 0.5] });
  b.cyl(x - 0.1, y + h * 0.5, z + 0.05, tw * 0.6, h * 0.45, 'bark', { r1: tw * 0.35, tint, seg: 7, collide: false, minimap: false, rz: 0.4, rx: 0.2, grad: false, uvOffset: [0.6, h * 0.5] });
  b.plant(kind === 'olive' ? 'olive' : 'tree', x, y, z, { s: o.s ?? (0.85 + b.rand() * 0.3) });
}

/** Blumentopf (Terrakotta) mit Busch. */
export function pot(b, x, y, z, o = {}) {
  const r = o.r ?? 0.28, h = o.h ?? 0.45;
  if (b.hasModel('planter_pot_clay') && o.model !== false) {
    // Fotoscan-Terrakottatopf (0,27 × 0,22 m) auf Topfmaß skaliert; Erde + Pflanze wie bisher. Kollision (Mehrspieler):
    // derselbe Kegelstumpf wie beim prozeduralen Topf, unabhängig davon, ob das Modell lädt
    const k = (2 * r) / 0.27;
    if (o.collide ?? true) b.cyl(x, y, z, r * 0.8, h, 'black', { r1: r, seg: 12, visual: false, minimap: 'prop' });
    b.model('planter_pot_clay', x, y, z, { sx: k, sz: k, sy: h / 0.22, ry: hash01(x, z, 5) * 6.28, collide: false,
      fallback: (bb) => bb.cyl(x, y, z, r * 0.8, h, 'tiles_terracotta', { r1: r, seg: 12, tint: '#c47a52', minimap: false, collide: false, uv: 'keep' }) });
    b.cyl(x, y + h - 0.07, z, r * 0.86, 0.04, 'dirt', { seg: 12, collide: false, minimap: false, ao: false });
    b.plant(o.plant || 'bush', x, y + h - 0.15, z, { s: o.s ?? (r * 1.4) });
    return;
  }
  b.cyl(x, y, z, r * 0.8, h, 'tiles_terracotta', { r1: r, seg: 12, tint: '#c47a52', minimap: 'prop', collide: o.collide ?? true, uv: 'keep' });
  b.cyl(x, y + h - 0.05, z, r * 0.92, 0.04, 'dirt', { seg: 12, collide: false, minimap: false, ao: false });
  b.plant(o.plant || 'bush', x, y + h - 0.15, z, { s: o.s ?? (r * 1.4) });
}

/** Wäscheleine mit Stücken */
export function laundry(b, ax, ay, az, bx, by, bz, o = {}) {
  cable(b, [ax, ay, az], [bx, by, bz], { sag: 0.25, r: 0.008, segments: 6 });
  const n = o.n ?? 5, L = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax);
  const cols = ['#e8e4dc', '#2f6f9a', '#c8402f', '#e0a32c', '#7aa0c8', '#f2f0ea', '#5c8a5a'];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.7) / (n + 0.4);
    const w = 0.35 + b.rand() * 0.4, hh = 0.4 + b.rand() * 0.45;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t - Math.sin(Math.PI * t) * 0.25;
    b.box(x, y - hh, z, w, hh, 0.012, 'tarp', { ry, tint: b.pick(cols), collide: false, minimap: false, ao: false, bullet: false, grad: false });
  }
  void L;
}

// ---------------------------------------------------------------------------
// Industrie
// ---------------------------------------------------------------------------
/** Schwerlastregal (Palettenregal) entlang lokal x, Fächer à 2,8 m. */
export function rack(b, x, z, o = {}) {
  const y = o.y ?? 0, f = frame(b, x, y, z, o.ry || 0), bays = o.bays ?? 3, levels = o.levels ?? 3, lh = o.levelH ?? 1.6, d = 1.1;
  const W = bays * 2.8;
  for (let i = 0; i <= bays; i++) {
    const lx = -W / 2 + i * 2.8;
    for (const sz of [-d / 2, d / 2]) f.box(lx, 0, sz, 0.09, levels * lh + 0.2, 0.09, 'metal_painted', { tint: '#2f5f94', collide: false, minimap: false });
    for (let k = 0; k < 4; k++) f.box(lx, 0.3 + k * levels * lh / 4, 0, 0.04, 0.04, d, 'metal_painted', { tint: '#2f5f94', collide: false, minimap: false, grad: false, rx: k % 2 ? 0.6 : -0.6 });
  }
  for (let l = 1; l <= levels; l++) for (const sz of [-d / 2, d / 2]) f.box(0, l * lh - 0.12, sz, W, 0.12, 0.07, 'metal_painted', { tint: '#e0702a', collide: false, minimap: false, grad: false });
  const loads = ['boxes', 'wrapped', 'sacks', 'boxes', null, 'wrapped'];
  for (let l = 0; l <= levels; l++) for (let i = 0; i < bays; i++) for (const k of [-0.65, 0.65]) {
    const ld = loads[Math.floor(b.rand() * loads.length)];
    if (!ld && l > 0) continue;
    const [px, pz] = f.P(-W / 2 + 1.4 + i * 2.8 + k, 0);
    pallet(b, px, y + (l === 0 ? 0 : l * lh), pz, { ry: (o.ry || 0) + Math.PI / 2, load: ld || 'boxes', rows: l === 0 ? 2 : 2, wrapTint: b.pick(['#cfd6d8', '#d9d2b8', '#bfc8cf']) });
  }
  // Kollision: unten massiv bis 1,4 m (Deckung), darüber offen für Sicht? → ganz zu (Wand)
  f.solid(0, 0, 0, W, levels * lh + 0.3, d, { minimap: 'cover' });
}

/** Werkbank */
export function workbench(b, x, z, o = {}) {
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0), w = o.w ?? 2.0;
  f.box(0, 0.86, 0, w, 0.06, 0.8, 'wood_planks', { tint: '#9a7a52', collide: false, minimap: false, grad: false });
  for (const sx of [-w / 2 + 0.08, w / 2 - 0.08]) for (const sz of [-0.33, 0.33]) f.box(sx, 0, sz, 0.06, 0.86, 0.06, 'metal_painted', { tint: '#3d4247', collide: false, minimap: false });
  f.box(0, 0.25, 0, w - 0.2, 0.04, 0.7, 'metal_painted', { tint: '#3d4247', collide: false, minimap: false, grad: false });
  f.box(-w / 4, 0.92, 0, 0.45, 0.22, 0.25, 'metal_painted', { tint: '#c8402f', collide: false, minimap: false, grad: false });
  f.box(w / 4, 0.92, 0.1, 0.3, 0.12, 0.2, 'metal_painted', { tint: '#3a6fb0', collide: false, minimap: false, grad: false });
  f.box(0, 0.92, -0.3, w - 0.1, 0.9, 0.03, 'metal_grate', { collide: false, minimap: false, grad: false, uvScale: 0.5 });
  f.solid(0, 0, 0, w, 0.95, 0.85, { minimap: 'cover' });
}

/** Spinde-Reihe */
export function lockers(b, x, z, o = {}) {
  const f = frame(b, x, o.y ?? 0, z, o.ry || 0), n = o.n ?? 4;
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * 0.42;
    f.box(lx, 0, 0, 0.4, 1.85, 0.5, 'metal_painted', { tint: o.tint || '#6f7f8a', collide: false, minimap: false });
    for (let k = 0; k < 3; k++) f.box(lx, 1.45 + k * 0.06, 0.255, 0.25, 0.015, 0.01, 'black', { collide: false, minimap: false, ao: false });
  }
  f.solid(0, 0, 0, n * 0.42, 1.85, 0.5, { minimap: 'cover' });
}

/** Stehender Tank (Silo) mit Standbeinen und Leiterattrappe */
export function tank(b, x, z, o = {}) {
  const y = o.y ?? 0, r = o.r ?? 2, h = o.h ?? 6, legs = o.legs ?? 1.2;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.785; b.box(x + Math.cos(a) * r * 0.75, y, z + Math.sin(a) * r * 0.75, 0.2, legs + 0.3, 0.2, 'metal_painted', { tint: '#3d4247', minimap: false }); }
  b.cyl(x, y + legs, z, r, h, o.mat || 'metal_galvanized', { tint: o.tint, seg: 20, minimap: 'building', grad: false });
  b.cyl(x, y + legs + h, z, r, r * 0.35, o.mat || 'metal_galvanized', { r1: 0.3, tint: o.tint, seg: 20, collide: false, minimap: false });
  if (legs > 0.5) b.cyl(x, y + legs - 0.6, z, r * 0.3, 0.6, 'metal_galvanized', { r1: r * 0.9, seg: 12, collide: false, minimap: false });
  // Ringe
  for (let k = 1; k < 4; k++) b.cyl(x, y + legs + (h * k) / 4, z, r + 0.03, 0.08, 'metal_painted', { tint: '#4a5058', seg: 20, collide: false, minimap: false, ao: false });
  b.cyl(x, y, z, r, legs, 'black', { visual: false, minimap: false });
}
