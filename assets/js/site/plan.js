// §03 Sichtlinien-Satz: reine Geometrie (Wände, Sichtpolygon) und der SVG-Plan aus Wörtern.
// Koordinaten in Metern; SVG-x = Karten-x, SVG-y = Karten-z (Norden = −z oben).

/** Arten, die gezeichnet werden, aber keine Sicht verdecken. */
const SOFT = ['water', 'lane', 'zone', 'spawn', 'road', 'plaza', 'flag', 'objective', 'marker', 'decal', 'catwalk'];
export const isSoft = (kind) => SOFT.some((k) => String(kind).toLowerCase().includes(k));

/** Art → Wort (+ Mehrzahl für die Textfassung). Reihenfolge = Priorität beim Teilstring-Vergleich. */
const WORDS = [
  ['container', 'CONTAINER', 'Container', 'Container'],
  ['crane', 'KRAN', 'Kran', 'Kräne'],
  ['warehouse', 'HALLE', 'Halle', 'Hallen'],
  ['hall', 'HALLE', 'Halle', 'Hallen'],
  ['house', 'HAUS', 'Haus', 'Häuser'],
  ['building', 'BAU', 'Gebäude', 'Gebäude'],
  ['wall', 'MAUER', 'Mauer', 'Mauern'],
  ['crate', 'KISTE', 'Kiste', 'Kisten'],
  ['box', 'KISTE', 'Kiste', 'Kisten'],
  ['pallet', 'PALETTE', 'Palette', 'Paletten'],
  ['truck', 'LKW', 'Lkw', 'Lkw'],
  ['forklift', 'STAPLER', 'Stapler', 'Stapler'],
  ['well', 'BRUNNEN', 'Brunnen', 'Brunnen'],
  ['market', 'MARKT', 'Marktstand', 'Marktstände'],
  ['stall', 'MARKT', 'Marktstand', 'Marktstände'],
  ['roof', 'DACH', 'Dach', 'Dächer'],
  ['machine', 'MASCHINE', 'Maschine', 'Maschinen'],
  ['pipe', 'ROHR', 'Rohr', 'Rohre'],
  ['catwalk', 'STEG', 'Steg', 'Stege'],
  ['stair', 'TREPPE', 'Treppe', 'Treppen'],
  ['tower', 'TURM', 'Turm', 'Türme'],
  ['sandbag', 'SANDSACK', 'Sandsack', 'Sandsäcke'],
  ['lane', 'BAHN', 'Bahn', 'Bahnen'],
  ['target', 'ZIEL', 'Ziel', 'Ziele'],
  ['water', 'WASSER', 'Wasserfläche', 'Wasserflächen'],
  ['vehicle', 'WAGEN', 'Wagen', 'Wagen'],
  ['car', 'WAGEN', 'Wagen', 'Wagen'],
  ['tank', 'TANK', 'Tank', 'Tanks'],
  ['cover', 'DECKUNG', 'Deckung', 'Deckungen'],
];
const FALLBACK = ['', 'DECKUNG', 'Deckung', 'Deckungen'];
/** { word, one, many } für eine Art. */
export function wordFor(kind) {
  const k = String(kind || '').toLowerCase();
  const hit = WORDS.find(([key]) => k.includes(key));
  if (hit) return { word: hit[1], one: hit[2], many: hit[3] };
  if (!k || k === 'cover') return { word: FALLBACK[1], one: FALLBACK[2], many: FALLBACK[3] };
  if (SOFT.some((s) => k.includes(s))) return { word: k.toLocaleUpperCase('de-DE'), one: k, many: k };
  const up = k.toLocaleUpperCase('de-DE');
  return { word: up, one: up.charAt(0) + up.slice(1).toLowerCase(), many: up.charAt(0) + up.slice(1).toLowerCase() };
}

/** Ecken eines (gedrehten) Blocks im Uhrzeigersinn. */
export function corners(b) {
  const c = Math.cos(b.rot || 0);
  const s = Math.sin(b.rot || 0);
  const hw = b.w / 2;
  const hd = b.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [b.x + x * c - z * s, b.z + x * s + z * c]);
}

/** Grenzen aller Blöcke + Rand. */
export function boundsOf(blocks, margin = 4) {
  let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
  for (const b of blocks) for (const [x, z] of corners(b)) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  if (!Number.isFinite(x0)) return { x0: -50, z0: -50, x1: 50, z1: 50, w: 100, h: 100 };
  x0 -= margin; z0 -= margin; x1 += margin; z1 += margin;
  return { x0, z0, x1, z1, w: x1 - x0, h: z1 - z0 };
}

/** Wandsegmente (Float64Array, je 4 Werte) aller sichtverdeckenden Blöcke. */
export function segmentsFrom(blocks) {
  const solid = blocks.filter((b) => !isSoft(b.kind));
  const segs = new Float64Array(solid.length * 16);
  const pts = [];
  let o = 0;
  for (const b of solid) {
    const c = corners(b);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = c[i];
      const [bx, bz] = c[(i + 1) % 4];
      segs[o++] = ax; segs[o++] = az; segs[o++] = bx; segs[o++] = bz;
      pts.push(ax, az);
    }
  }
  return { segs, pts: new Float64Array(pts), solid };
}

/** Liegt der Punkt in einem sichtverdeckenden Block? */
export function blocked(solid, x, z, pad = 0) {
  for (const b of solid) {
    const dx = x - b.x;
    const dz = z - b.z;
    // schneller Ausschluss über den Umkreis, Drehung nur einmal je Block berechnen
    const rr = b._r ?? (b._r = Math.hypot(b.w, b.d) / 2);
    if (dx * dx + dz * dz > (rr + pad) * (rr + pad)) continue;
    const c = b._c ?? (b._c = Math.cos(-(b.rot || 0)));
    const s = b._s ?? (b._s = Math.sin(-(b.rot || 0)));
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(lz) <= b.d / 2 + pad) return true;
  }
  return false;
}

const TAU = Math.PI * 2;
const BINS = 360;

/**
 * Sichtpolygon vom Punkt o aus. 360 Strahlen (1°) plus je zwei Strahlen (±0,0005 rad) zu jedem Eckpunkt.
 * Segmente werden in Winkelfächer einsortiert, damit jeder Strahl nur seine Kandidaten prüft.
 * → { poly: [[x, z], …], maxDist, medianDist, dists, seen: Set(Index in geo.solid) } – seen = Blöcke mit sichtbarer Kante,
 *   dists = freie Sichtweite der 360 gleichmäßig verteilten Strahlen, aufsteigend sortiert (m)
 */
export function castVisibility(geo, o, bounds) {
  const { segs, pts } = geo;
  const { x0, z0, x1, z1 } = bounds;
  const ox = o.x;
  const oz = o.z;
  // Randsegmente
  const edge = [x0, z0, x1, z0, x1, z0, x1, z1, x1, z1, x0, z1, x0, z1, x0, z0];
  const nSeg = segs.length / 4;
  const bins = Array.from({ length: BINS }, () => []);
  const angOf = (x, z) => { let a = Math.atan2(z - oz, x - ox); if (a < 0) a += TAU; return a; };
  for (let i = 0; i < nSeg; i++) {
    const ax = segs[i * 4]; const az = segs[i * 4 + 1]; const bx = segs[i * 4 + 2]; const bz = segs[i * 4 + 3];
    let a0 = angOf(ax, az);
    let a1 = angOf(bx, bz);
    let lo = Math.min(a0, a1);
    let hi = Math.max(a0, a1);
    // Segment überspannt die 0-Grenze?
    if (hi - lo > Math.PI) { const t = lo; lo = hi; hi = t + TAU; }
    const b0 = Math.floor((lo / TAU) * BINS) - 1;
    const b1 = Math.floor((hi / TAU) * BINS) + 1;
    for (let b = b0; b <= b1; b++) bins[((b % BINS) + BINS) % BINS].push(i);
  }
  const seen = new Set();
  let bestSeg = -1;
  const hit = (a) => {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let best = Infinity;
    bestSeg = -1;
    let cur = -1;
    const test = (ax, az, bx, bz) => {
      const ex = bx - ax;
      const ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) return;
      const fx = ax - ox;
      const fz = az - oz;
      const t = (fx * ez - fz * ex) / den;
      const u = (fx * dz - fz * dx) / den;
      if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) { best = t; bestSeg = cur; }
    };
    let bi = Math.floor(((a % TAU + TAU) % TAU / TAU) * BINS);
    if (bi >= BINS) bi = 0;
    for (const i of bins[bi]) { cur = i; test(segs[i * 4], segs[i * 4 + 1], segs[i * 4 + 2], segs[i * 4 + 3]); }
    cur = -1;
    for (let e = 0; e < 16; e += 4) test(edge[e], edge[e + 1], edge[e + 2], edge[e + 3]);
    if (!Number.isFinite(best)) best = 0;
    if (bestSeg >= 0) seen.add(bestSeg >> 2);
    return best;
  };

  const rays = [];
  const uniform = new Float64Array(360);
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * TAU;
    const d = hit(a);
    uniform[i] = d;
    rays.push([a, d]);
  }
  const corner = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const extra = [];
  for (let i = 0; i < pts.length; i += 2) extra.push([pts[i], pts[i + 1]]);
  for (const [px, pz] of [...extra, ...corner]) {
    const a = Math.atan2(pz - oz, px - ox);
    for (const da of [-0.0005, 0.0005]) {
      const aa = ((a + da) % TAU + TAU) % TAU;
      rays.push([aa, hit(aa)]);
    }
  }
  rays.sort((p, q) => p[0] - q[0]);
  const poly = rays.map(([a, d]) => [ox + Math.cos(a) * d, oz + Math.sin(a) * d]);
  const sorted = uniform.sort();
  const medianDist = (sorted[179] + sorted[180]) / 2;
  const maxDist = sorted[359];
  return { poly, maxDist, medianDist, dists: sorted, seen };
}

/** Pfad-String eines Polygons. */
export function polyPath(poly) {
  let d = '';
  for (let i = 0; i < poly.length; i++) d += `${i ? 'L' : 'M'}${poly[i][0].toFixed(2)} ${poly[i][1].toFixed(2)}`;
  return `${d}Z`;
}

/** Freier Punkt nahe dem Schwerpunkt (2-m-Raster). */
export function defaultPoint(blocks, solid, bounds) {
  let cx = 0; let cz = 0; let n = 0;
  for (const b of blocks) { cx += b.x; cz += b.z; n++; }
  if (n) { cx /= n; cz /= n; } else { cx = (bounds.x0 + bounds.x1) / 2; cz = (bounds.z0 + bounds.z1) / 2; }
  let best = null;
  let bestD = Infinity;
  for (let x = Math.ceil(bounds.x0 / 2) * 2; x <= bounds.x1; x += 2) {
    for (let z = Math.ceil(bounds.z0 / 2) * 2; z <= bounds.z1; z += 2) {
      if (blocked(solid, x, z, 0.6)) continue;
      const d = (x - cx) ** 2 + (z - cz) ** 2;
      if (d < bestD) { bestD = d; best = { x, z }; }
    }
  }
  return best || { x: cx, z: cz };
}

/** Text-Alternative: „Hafen, 108 × 92 m. 34 Deckungen: 18 Container, 1 Kran, …“ */
export function planText(name, blocks, bounds, fmtInt) {
  const solid = blocks.filter((b) => !isSoft(b.kind));
  const counts = new Map();
  for (const b of blocks) {
    const w = wordFor(b.kind);
    const key = w.one;
    const c = counts.get(key) || { n: 0, w };
    c.n++;
    counts.set(key, c);
  }
  const list = [...counts.values()].sort((a, b) => b.n - a.n || a.w.one.localeCompare(b.w.one, 'de'))
    .map((c) => `${c.n} ${c.n === 1 ? c.w.one : c.w.many}`);
  const size = `${fmtInt(Math.round(bounds.w - 8))} × ${fmtInt(Math.round(bounds.h - 8))} m`;
  const deck = `${solid.length} ${solid.length === 1 ? 'Deckung' : 'Deckungen'}`;
  return `${name}, ${size}. ${deck}${list.length ? `: ${list.join(', ')}` : ''}.`;
}

/** Achsparalleles Rechteck um einen (gedrehten) Block. */
export function aabb(b) {
  const c = corners(b);
  const xs = c.map((p) => p[0]);
  const zs = c.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));

/**
 * Welche Blöcke bekommen ein Wort? Pro Gruppe gleichartiger, sich berührender Blöcke nur der größte,
 * und kein Wort auf einem Block, der zu mehr als der Hälfte unter einem schon beschrifteten liegt.
 */
export function labelBlocks(blocks, minShort = 1.2) {
  const cand = blocks.filter((b) => Math.min(b.w, b.d) >= minShort);
  const box = new Map(cand.map((b) => [b, aabb(b)]));
  const word = (b) => wordFor(b.kind).word;
  const parent = new Map(cand.map((b) => [b, b]));
  const find = (b) => { while (parent.get(b) !== b) { parent.set(b, parent.get(parent.get(b))); b = parent.get(b); } return b; };
  const near = (a, b, pad = 0.6) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.z0 - pad <= b.z1 && b.z0 - pad <= a.z1;
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      if (word(cand[i]) !== word(cand[j]) || !near(box.get(cand[i]), box.get(cand[j]))) continue;
      parent.set(find(cand[i]), find(cand[j]));
    }
  }
  const area = (b) => b.w * b.d;
  const best = new Map();
  for (const b of cand) { const r = find(b); if (!best.has(r) || area(b) > area(best.get(r))) best.set(r, b); }
  const kept = [];
  for (const b of [...best.values()].sort((p, q) => area(q) - area(p))) {
    const a = box.get(b);
    const aa = (a.x1 - a.x0) * (a.z1 - a.z0);
    if (kept.some((k) => { const kb = box.get(k); return overlap(a, kb) > 0.5 * Math.min(aa, (kb.x1 - kb.x0) * (kb.z1 - kb.z0)); })) continue;
    kept.push(b);
  }
  return new Set(kept);
}
