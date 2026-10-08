// NULLPUNKT — Grenzland: Ausstattung aus Primitiven (Owner: world). Bauernmarkt-Stände an der Kapelle, Traktor
// „Gertrud“ in der Scheune, Betonrohr-Durchlass der Erdbrücke (Stirn-/Flügelwände, Rohr, Rechen, Geländer).
// Alles statisch und deterministisch: Platzierungs-Zufall nur positionsabhängig (hash01), der Karten-Zufall
// (b.rand) bleibt unberührt – übrige Platzierung unverändert. Kollision unabhängig von der Grafikstufe; auf low
// entfallen nur kleine Auslagen ohne Kollision.
import * as THREE from 'three';
import { frame, hash01, awning, lowSphereGeom, sphereGeom } from '../props.js';
import { railing } from '../arch.js';

// ---------------------------------------------------------------------------
// Bauernmarkt (Gemüsestände)
// ---------------------------------------------------------------------------
/** Waren: Farbe(n), Radius, Form ('rund' Kugel, 'flach' gedrückt, 'lang' liegender Kegel), Stück je Kiste. */
const WAREN = {
  kohl: { col: ['#6f9a42', '#86ad55', '#5d8a3a'], r: 0.105, form: 'rund', n: 4, fein: true },
  salat: { col: ['#9cc45c', '#8ab84a'], r: 0.1, form: 'flach', n: 4, fein: true },
  kartoffeln: { col: ['#b89a68', '#a88a5a', '#c2a674'], r: 0.045, form: 'flach', n: 8 },
  moehren: { col: ['#e0782a', '#d8692a'], r: 0.026, form: 'lang', n: 8 },
  tomaten: { col: ['#c8342a', '#b82c24', '#d4402e'], r: 0.04, form: 'rund', n: 8 },
  aepfel: { col: ['#b8402a', '#c8582e', '#9ab83a'], r: 0.044, form: 'rund', n: 8 },
  zwiebeln: { col: ['#c89a52', '#b8843e', '#d8b070'], r: 0.04, form: 'rund', n: 8 },
  paprika: { col: ['#d43c2a', '#e6c53a', '#3a8a2a'], r: 0.045, form: 'flach', n: 8 },
  kuerbis: { col: ['#e0802a', '#d8702a', '#e89a3a'], r: 0.19, form: 'flach', n: 2, fein: true },
};

/** Auslage auf einer Kiste (Mitte lx, Oberkante ly, lz; Kiste kw × kd): Haufen aus Kugeln/Kegeln. */
function auslage(b, f, lx, ly, lz, kw, kd, art, low, seed) {
  const w = WAREN[art];
  if (!w) return;
  const n = low && !w.fein ? Math.ceil(w.n / 2) : w.n;
  const cols = Math.max(1, Math.round(Math.sqrt(n * kw / kd))), rows = Math.ceil(n / cols);
  for (let k = 0; k < n; k++) {
    const h = (q) => hash01(seed + k * 0.37, seed * 0.71 + k, q);
    const ci = k % cols, ri = Math.floor(k / cols);
    const px = lx - kw / 2 + (ci + 0.5) * (kw / cols) + (h(1) - 0.5) * 0.04;
    const pz = lz - kd / 2 + (ri + 0.5) * (kd / rows) + (h(2) - 0.5) * 0.04;
    const tint = w.col[Math.floor(h(3) * w.col.length) % w.col.length];
    const r = w.r * (0.85 + h(4) * 0.3);
    if (w.form === 'lang') {
      f.cyl(px, ly + r, pz, r, 0.17, 'white', { axis: 'x', r1: 0.004, seg: 6, ry: (h(5) - 0.5) * 0.8, tint, collide: false, minimap: false, ao: false, bullet: false, cast: false });
      continue;
    }
    const sy = w.form === 'flach' ? 0.72 : 0.92;
    const g = r > 0.08 ? sphereGeom() : lowSphereGeom();
    // gestapelt: hintere Reihe/zweite Lage etwas höher (Haufen statt Gitter)
    const lift = (ri % 2) * r * 0.35 + (k >= cols * 2 ? r * 0.6 : 0);
    f.geom(g, px, ly + r * sy + lift, pz, 'white', { sx: r, sy: r * sy, sz: r, ry: h(6) * 6.28, tint, collide: false, minimap: false, ao: false, bullet: false, cast: r > 0.08 });
  }
}

/**
 * Gemüsestand (Holztheke mit Kistenauslage, Markise auf vier Pfosten, Kreidetafel). Lokal z = Front (Kunden),
 * (x, z) Mitte der Theke, ry Drehung. o: { w (2,4), d (1,0), design (Markise 0..3), waren: [Arten vorn…, hinten…],
 * boden: Art der Bodenkiste neben der Theke ('kuerbis'…) | null, sack (Kartoffelsack), schild: Schild-Schlüssel,
 * seite: -1|1 (Seite der Bodenkiste), low }
 * Kollision: nur die Theke (0,8 m – Hockdeckung, hält Kugeln) und die Bodenkiste (0,3 m, übersteigbar);
 * Markise, Pfosten und Waren ohne Kollision, Markise lässt Kugeln durch.
 */
export function gemueseStand(b, x, z, o = {}) {
  const ry = o.ry || 0, w = o.w ?? 2.4, d = o.d ?? 1.0, f = frame(b, x, 0, z, ry), low = !!o.low;
  const seed = x * 3.1 + z * 1.7;
  // Theke: Bretterkasten mit überstehender Platte
  f.box(0, 0, 0, w, 0.8, d, 'wood_planks', { tint: o.wood || '#9c7b55', minimap: 'cover' });
  f.box(0, 0.8, 0.04, w + 0.1, 0.05, d + 0.12, 'wood_dark', { tint: '#6a5038', collide: false, minimap: false, grad: false });
  // Stufe hinten (zweite Kistenreihe höher)
  f.box(0, 0.85, -d / 2 + 0.2, w - 0.1, 0.2, 0.36, 'wood_planks', { tint: '#8a6a48', collide: false, minimap: false, grad: false });
  const waren = o.waren || ['kohl', 'kartoffeln', 'moehren', 'tomaten', 'aepfel', 'salat'];
  const n = Math.max(2, Math.floor(w / 0.58));
  const kw = (w - 0.2) / n - 0.06, kd = 0.36;
  for (let row = 0; row < 2; row++) {
    const ly = row ? 1.05 : 0.85, lz = row ? -d / 2 + 0.2 : d / 2 - 0.24;
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + 0.1 + (i + 0.5) * ((w - 0.2) / n);
      f.box(lx, ly, lz, kw, 0.13, kd, 'wood_crate', { uv: 'fit', collide: false, minimap: false, grad: false });
      auslage(b, f, lx, ly + 0.1, lz, kw - 0.06, kd - 0.06, waren[(row * n + i) % waren.length], low, seed + row * 11 + i * 3);
    }
  }
  // Pfosten (innerhalb der Theke → kein Durchlaufen) + Markise (hinten hoch, vorn Volant)
  const ph = 2.45, drop = 0.32, depth = d + 0.65;
  const fh = ph - drop * ((d - 0.12) / depth) - 0.03; // vordere Pfosten enden unter dem schrägen Stoff
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 0.08, sz < 0 ? ph : fh, 0.08, 'wood_dark', { tint: '#5a4636', collide: false, minimap: false });
  const [bx, bz] = f.P(0, -d / 2 + 0.02);
  awning(b, bx, ph, bz, w + 0.25, depth, { ry, drop, design: o.design ?? 0 });
  // Kreidetafel an der Thekenfront
  if (o.schild) { const [sx, sz] = f.P(0, d / 2 + 0.01); b.sign(sx, 0.3, sz, Math.min(1.1, w * 0.45), 0.34, o.schild, { ry, back: false, depth: 0.012 }); }
  // Bodenkiste neben der Theke (Kürbisse o. Ä.) + Kartoffelsack
  if (o.boden !== null) {
    const s = o.seite ?? 1, gx = s * (w / 2 + 0.42), gz = d / 2 - 0.3;
    f.box(gx, 0, gz, 0.6, 0.3, 0.46, 'wood_crate', { uv: 'fit', minimap: false, ry: (hash01(x, z, 7) - 0.5) * 0.2 });
    auslage(b, f, gx, 0.28, gz, 0.5, 0.38, o.boden || 'kuerbis', low, seed + 5);
    if (o.sack !== false) {
      f.cyl(gx, 0, gz - 0.55, 0.21, 0.5, 'sandbag', { r1: 0.16, seg: 10, tint: '#b49c72', collide: false, minimap: false });
      f.cyl(gx, 0.5, gz - 0.55, 0.16, 0.08, 'sandbag', { r1: 0.05, seg: 10, tint: '#a8916a', collide: false, minimap: false, ao: false });
      auslage(b, f, gx, 0.52, gz - 0.55, 0.16, 0.16, 'kartoffeln', true, seed + 9);
    }
  }
}

/** Tafel-Aufsteller (Kreidetafel auf zwei Beinen, beidseitig beschriftet). (x, z) Mitte, ry: Vorderseite lokal +z. */
export function aufsteller(b, x, z, key, ry = 0) {
  const f = frame(b, x, 0, z, ry);
  for (const s of [-1, 1]) f.box(s * 0.33, 0, 0, 0.06, 1.25, 0.08, 'wood_dark', { tint: '#4a3a2c', collide: false, minimap: false });
  f.box(0, 0.32, 0, 0.62, 0.86, 0.04, 'wood_dark', { tint: '#4a3a2c', collide: false, minimap: false });
  for (const s of [-1, 1]) { const [px, pz] = f.P(0, s * 0.02); b.sign(px, 0.37, pz, 0.54, 0.76, key, { ry: ry + (s > 0 ? 0 : Math.PI), back: false, depth: 0.004 }); }
}

// ---------------------------------------------------------------------------
// Traktor (statisch; Kollision als ein Quader)
// ---------------------------------------------------------------------------
/** Halber offener Zylindermantel (Kotflügel) um die lokale x-Achse, Bogen von vorn über oben nach hinten. */
function fenderGeom(r, w) {
  const key = `fender${r}_${w}`;
  if (!fenderGeom.cache) fenderGeom.cache = new Map();
  if (!fenderGeom.cache.has(key)) {
    const g = new THREE.CylinderGeometry(r, r, w, 14, 1, true, 0.35, 2.35);
    g.rotateZ(Math.PI / 2);
    // beidseitig (Unterseite sichtbar beim Blick von unten/hinten)
    const a = g.toNonIndexed(), back = a.clone();
    const p = back.attributes.position.array, nn = back.attributes.normal.array;
    const uv = back.attributes.uv.array;
    for (const [arr, st] of [[p, 3], [nn, 3], [uv, 2]]) for (let i = 0; i < arr.length; i += st * 3) for (let k = 0; k < st; k++) { const t = arr[i + st + k]; arr[i + st + k] = arr[i + 2 * st + k]; arr[i + 2 * st + k] = t; }
    for (let i = 0; i < nn.length; i++) nn[i] = -nn[i];
    const out = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) {
      const A = a.attributes[k].array, B = back.attributes[k].array, arr = new Float32Array(A.length + B.length);
      arr.set(A); arr.set(B, A.length);
      out.setAttribute(k, new THREE.BufferAttribute(arr, a.attributes[k].itemSize));
    }
    fenderGeom.cache.set(key, out);
  }
  return fenderGeom.cache.get(key);
}

/** Rad mit Stollenreifen (Achse lokal x): Reifen, Felge, Nabe, Stollen versetzt (Profil sichtbar). */
function tractorWheel(f, lx, ly, lz, r, w, rim, lugs) {
  f.cyl(lx, ly, lz, r - 0.035, w, 'rubber', { axis: 'x', ry: 0, collide: false, minimap: false, seg: 18 });
  // Felge/Nabe etwas breiter als der Reifen (die Reifen-Deckflächen sind geschlossen)
  f.cyl(lx, ly, lz, r * 0.62, w + 0.02, 'metal_painted', { axis: 'x', tint: rim, collide: false, minimap: false, seg: 14 });
  f.cyl(lx, ly, lz, r * 0.2, w + 0.07, 'metal_painted', { axis: 'x', tint: '#2b2d30', collide: false, minimap: false, seg: 8 });
  for (let k = 0; k < lugs; k++) {
    const a = (k / lugs) * Math.PI * 2, off = (k % 2 ? 1 : -1) * w * 0.22;
    const ri = r - 0.05;
    f.box(lx + off, ly + Math.cos(a) * ri, lz + Math.sin(a) * ri, w * 0.5, 0.07, r * 0.13, 'rubber', { rx: a, collide: false, minimap: false, grad: false, ao: false });
  }
}

/**
 * Kleiner Hof-Traktor (Schlepper): große Hinterräder mit Stollen, kleine Vorderräder, Motorhaube mit Kühlergrill,
 * Auspuff, Kabine mit Scheiben und Rundumleuchte, Kotflügel, Dreipunkt-Hydraulik. Lokal z = Fahrtrichtung (vorn),
 * (x, z) = Mitte zwischen den Achsen am Boden. o: { ry, y, color, rim }
 */
export function traktor(b, x, z, o = {}) {
  const y = o.y ?? 0, ry = o.ry || 0, f = frame(b, x, y, z, ry);
  const col = o.color || '#4f7a3a', rim = o.rim || '#b33a2a', dark = '#2f3230', roof = '#e6e1d2';
  const P = { collide: false, minimap: false };
  const R = 0.8, Rf = 0.44, zr = -0.75, zf = 1.32;
  // Räder
  for (const s of [-1, 1]) {
    tractorWheel(f, s * 0.8, R, zr, R, 0.42, rim, 18);
    tractorWheel(f, s * 0.66, Rf, zf, Rf, 0.24, rim, 12);
  }
  // Achsen, Rahmen, Motorblock (dunkel)
  f.box(0, Rf - 0.07, zf, 1.12, 0.14, 0.16, 'metal_painted', { ...P, tint: dark, grad: false });
  f.cyl(0, R, zr, 0.1, 1.42, 'metal_painted', { ...P, axis: 'x', tint: dark, seg: 8 });
  f.box(0, 0.42, 0.55, 0.56, 0.62, 2.5, 'metal_painted', { ...P, tint: dark, grad: false });
  // Getriebegehäuse unter der Kabine
  f.box(0, 0.5, -0.75, 0.82, 0.62, 1.0, 'metal_painted', { ...P, tint: col, grad: false });
  // Motorhaube + Kühlergrill + Frontgewicht
  f.box(0, 1.0, 1.18, 0.76, 0.5, 1.72, 'metal_painted', { ...P, tint: col, grad: false });
  f.box(0, 1.5, 1.18, 0.6, 0.05, 1.68, 'metal_painted', { ...P, tint: col, grad: false });
  f.box(0, 1.02, 2.045, 0.64, 0.44, 0.04, 'metal_grate', { ...P, tint: '#3a3c3a', grad: false });
  for (const s of [-1, 1]) f.box(s * 0.22, 1.36, 2.07, 0.13, 0.09, 0.03, 'lamp_warm', { ...P, ao: false });
  f.box(0, 0.4, 2.2, 0.82, 0.34, 0.28, 'metal_painted', { ...P, tint: dark, grad: false });
  // seitliche Lüftungsschlitze (dunkle Streifen)
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) f.box(s * 0.385, 1.12 + k * 0.08, 1.55, 0.01, 0.035, 0.42, 'black', { ...P, ao: false, grad: false });
  // Auspuff (senkrecht) + Luftansaugung
  f.cyl(0.22, 1.5, 1.6, 0.045, 0.95, 'metal_galvanized', { ...P, tint: '#3c3a36', seg: 8 });
  f.cyl(0.22, 2.45, 1.6, 0.055, 0.05, 'metal_painted', { ...P, tint: '#1e1e1e', seg: 8 });
  f.cyl(-0.22, 1.5, 1.7, 0.06, 0.32, 'metal_painted', { ...P, tint: dark, seg: 8 });
  // Tank zwischen Haube und Kabine
  f.box(0, 1.05, 0.2, 0.62, 0.42, 0.3, 'metal_painted', { ...P, tint: col, grad: false });
  // Kabine: Boden, Pfosten, Dach, Scheiben
  const cz0 = -1.32, cz1 = 0.32, cw = 1.22, cy0 = 1.12, cy1 = 2.42;
  f.box(0, cy0 - 0.08, (cz0 + cz1) / 2, cw + 0.1, 0.08, cz1 - cz0, 'metal_tread', { ...P, grad: false });
  for (const sx of [-1, 1]) for (const zz of [cz0, cz1]) f.box(sx * cw / 2, cy0, zz, 0.06, cy1 - cy0, 0.06, 'metal_painted', { ...P, tint: dark, grad: false });
  f.box(0, cy1, (cz0 + cz1) / 2, cw + 0.22, 0.09, cz1 - cz0 + 0.24, 'metal_painted', { ...P, tint: roof, grad: false });
  f.box(0, cy1 + 0.09, (cz0 + cz1) / 2, cw - 0.1, 0.05, cz1 - cz0 - 0.1, 'metal_painted', { ...P, tint: roof, grad: false });
  f.box(0, cy0 + 0.35, cz1, cw - 0.06, cy1 - cy0 - 0.4, 0.02, 'glass', { ...P, ao: false });
  f.box(0, cy0 + 0.55, cz0, cw - 0.06, cy1 - cy0 - 0.6, 0.02, 'glass', { ...P, ao: false });
  for (const sx of [-1, 1]) f.box(sx * cw / 2, cy0 + 0.5, (cz0 + cz1) / 2, 0.02, cy1 - cy0 - 0.55, cz1 - cz0 - 0.08, 'glass', { ...P, ao: false });
  // Rundumleuchte (orange) + Spiegel
  f.cyl(cw / 2 - 0.12, cy1 + 0.09, cz1 - 0.1, 0.07, 0.13, 'polymer', { ...P, tint: '#e8861a', seg: 8 });
  for (const s of [-1, 1]) {
    f.box(s * (cw / 2 + 0.2), cy1 - 0.45, cz1 - 0.02, 0.04, 0.22, 0.14, 'metal_painted', { ...P, tint: '#1e1e1e', grad: false });
    f.box(s * (cw / 2 + 0.1), cy1 - 0.3, cz1 - 0.02, 0.22, 0.025, 0.025, 'metal_painted', { ...P, tint: '#1e1e1e', grad: false });
  }
  // Sitz + Lenkrad
  f.box(0, cy0 + 0.25, -0.75, 0.46, 0.1, 0.44, 'polymer', { ...P, tint: '#2a2a2a', grad: false });
  f.box(0, cy0 + 0.35, -0.98, 0.46, 0.5, 0.08, 'polymer', { ...P, tint: '#2a2a2a', grad: false, rx: -0.15 });
  f.cyl(0, cy0, 0.05, 0.035, 0.75, 'metal_painted', { ...P, tint: '#1e1e1e', seg: 6, rx: -0.45 });
  f.cyl(0, cy0 + 0.66, -0.25, 0.19, 0.035, 'polymer', { ...P, tint: '#1e1e1e', seg: 12, rx: -0.75 });
  // Kotflügel hinten (offen, beidseitig) + Trittstufe
  const fg = fenderGeom(R + 0.1, 0.5);
  for (const s of [-1, 1]) {
    f.geom(fg, s * 0.8, R, zr, 'metal_painted', { ...P, tint: col, uv: 'keep', ao: false });
    f.box(s * 0.56, cy0 - 0.08, zr, 0.04, 0.55, 1.5, 'metal_painted', { ...P, tint: col, grad: false });
    f.box(s * 0.68, 0.55, 0.0, 0.26, 0.04, 0.3, 'metal_tread', { ...P, grad: false });
  }
  // Dreipunkt-Hydraulik + Zapfwelle hinten
  for (const s of [-1, 1]) f.box(s * 0.32, 0.45, -1.6, 0.07, 0.07, 0.75, 'metal_painted', { ...P, tint: rim, grad: false, rx: 0.25 });
  f.box(0, 0.95, -1.5, 0.08, 0.08, 0.6, 'metal_painted', { ...P, tint: rim, grad: false, rx: -0.1 });
  f.cyl(0, 0.62, -1.35, 0.04, 0.22, 'metal_galvanized', { ...P, axis: 'z', seg: 6 });
  for (const s of [-1, 1]) f.box(s * 0.62, 1.05, -1.42, 0.12, 0.1, 0.03, 'lamp_red', { ...P, ao: false });
  // Kollision: ein Quader um Räder und Kabine (Kugeln treffen die sichtbaren Teile)
  f.solid(0, 0, 0.27, 2.04, 2.5, 3.95, { minimap: 'vehicle' });
}

// ---------------------------------------------------------------------------
// Durchlass (Betonrohr durch den Erddamm)
// ---------------------------------------------------------------------------
/** Rohr (hohl) entlang lokal x, Mitte im Ursprung: Außen-/Innenmantel + Stirnringe. part: 'aussen' | 'innen'. */
function rohrGeom(ro, ri, len, seg, part, x0 = -len / 2, x1 = len / 2) {
  const P = [], N = [], U = [];
  const ring = (r, inward, xa, xb) => {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const q = [[xa, c0, s0, a0], [xb, c0, s0, a0], [xb, c1, s1, a1], [xa, c1, s1, a1]];
      const order = inward ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) {
        const [xx, c, s, a] = q[k];
        P.push(xx, c * r, s * r); N.push(0, inward ? -c : c, inward ? -s : s); U.push(xx, a * r);
      }
    }
  };
  const cap = (xx, dir) => {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const v = [[Math.cos(a0) * ri, Math.sin(a0) * ri], [Math.cos(a0) * ro, Math.sin(a0) * ro], [Math.cos(a1) * ro, Math.sin(a1) * ro], [Math.cos(a1) * ri, Math.sin(a1) * ri]];
      const order = dir > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) { P.push(xx, v[k][0], v[k][1]); N.push(dir, 0, 0); U.push(v[k][1], v[k][0]); }
    }
  };
  if (part === 'aussen') { ring(ro, false, x0, x1); cap(x0, -1); cap(x1, 1); } else ring(ri, true, x0, x1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}

/** Prisma aus einem Umriss in der lokalen x/y-Ebene (optional mit Kreisloch), Dicke depth entlang +z. */
function mauerGeom(pts, depth, hole = null) {
  const sh = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  if (hole) { const h = new THREE.Path(); h.absarc(hole[0], hole[1], hole[2], 0, Math.PI * 2, true); sh.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 20 });
  return g.index ? g.toNonIndexed() : g;
}

/**
 * Durchlass eines Erddamms mit Achse entlang z (Dammachse x = ax), Rohr quer (entlang x) bei z = zc.
 * Passend zu terrain.dams (crown/2 = c, culvert half = hz, out = c): Stirnwände (1 m dick, Rückseite auf der
 * Rasterlinie |s| = c) mit Rohrloch, Flügelwände (1 m dick, Rückseite auf |z − zc| = hz) mit Böschungsneigung,
 * Betonrohr DN 1400 (halb gefüllt, Wasserspiegel der Karte), Rechen am Einlauf, Geländer auf den Stirnwänden.
 * o: { ax, zc, c (3), hz (3), top (0,75), bottom (−4,2), pipeY (−1,15), slope (1,5), wing (5,5), low }
 */
export function durchlass(b, o) {
  const ax = o.ax, zc = o.zc, c = o.c ?? 3, hz = o.hz ?? 3, T = 1.0;
  const top = o.top ?? 0.75, bot = o.bottom ?? -4.2, py = o.pipeY ?? -1.15, sl = o.slope ?? 1.5, wing = o.wing ?? 5.5;
  const ro = 0.85, ri = 0.7, len = 2 * (c + T) + 0.6;
  // grad: false – kein Boden-AO-Verlauf ab y = 0 (die Wände reichen bis ins Flussbett und wären sonst halb so hell)
  const conc = { tint: '#b4aea1', minimap: false, grad: false };
  // Stirnwände (Loch für das Rohr), Abdeckkappe, Geländer
  const stirn = mauerGeom([[-hz, bot], [hz, bot], [hz, top], [-hz, top]], T, [0, py, ro + 0.01]);
  for (const s of [-1, 1]) {
    // lokal z (Dicke) → Welt ±x: ry = s·π/2; Rückseite bei |s| = c
    const xb = ax + s * c;
    b.geom(stirn, xb, 0, zc, 'concrete', { ...conc, ry: s * Math.PI / 2, collide: true, minimap: 'wall' });
    b.box(ax + s * (c + T / 2), top, zc, T + 0.12, 0.12, 2 * hz + 0.12, 'concrete', { tint: '#b9b3a6', collide: false, minimap: false, grad: false });
    railing(b, ax + s * (c + 0.55), zc - hz + 0.15, ax + s * (c + 0.55), zc + hz - 0.15, top + 0.12, { mat: 'metal_galvanized', tint: '#b4b8ba', h: 1.0 });
  }
  // Flügelwände: Oberkante fällt mit der Böschung (1 : sl) von top auf ≈ Flussbett
  const yEnd = Math.max(bot + 0.6, top - wing / sl);
  const fl = mauerGeom([[0, bot], [wing, bot], [wing, yEnd], [0, top]], T);
  for (const s of [-1, 1]) for (const e of [-1, 1]) {
    // s: Dammseite (±x), e: Rand der Aussparung (±z); Rückseite auf |z − zc| = hz, Vorderseite zur Aussparung
    const x0 = ax + s * (c + T);
    if (s > 0) b.geom(fl, x0, 0, e > 0 ? zc + hz - T : zc - hz, 'concrete', { ...conc, collide: 'mesh' });
    else b.geom(fl, x0, 0, e > 0 ? zc + hz : zc - hz + T, 'concrete', { ...conc, ry: Math.PI, collide: 'mesh' });
  }
  // Rohr: außen Beton, innen dunkler (kaum Licht im Rohr); Mündungen ragen 0,3 m vor die Stirnwand
  b.geom(rohrGeom(ro, ri, len, 20, 'aussen'), ax, py, zc, 'concrete', { tint: '#b3ad9f', collide: false, minimap: false, uv: 'keep', ao: false, cast: false });
  b.geom(rohrGeom(ro, ri, len, 20, 'innen', -len / 2, -len / 2 + 0.7), ax, py, zc, 'concrete', { tint: '#6c685f', collide: false, minimap: false, uv: 'keep', ao: false, cast: false });
  b.geom(rohrGeom(ro, ri, len, 20, 'innen', len / 2 - 0.7, len / 2), ax, py, zc, 'concrete', { tint: '#6c685f', collide: false, minimap: false, uv: 'keep', ao: false, cast: false });
  b.geom(rohrGeom(ro, ri, len, 20, 'innen', -len / 2 + 0.7, len / 2 - 0.7), ax, py, zc, 'concrete', { tint: '#2e2c28', collide: false, minimap: false, uv: 'keep', ao: false, cast: false });
  // Rechen (Treibgut-Gitter) am Einlauf (Westseite)
  const gx = ax - len / 2 - 0.06;
  for (let k = -3; k <= 3; k++) { const hh = Math.sqrt(ro * ro - (k * 0.2) ** 2) - 0.04; b.box(gx, py - hh, zc + k * 0.2, 0.04, 2 * hh, 0.04, 'metal_painted', { tint: '#3a3d3a', collide: false, minimap: false, grad: false, ao: false }); }
  for (const yy of [py - 0.35, py + 0.35]) b.box(gx - 0.03, yy, zc, 0.05, 0.05, 1.5, 'metal_painted', { tint: '#3a3d3a', collide: false, minimap: false, grad: false, ao: false });
  // Treibgut am Rechen (Äste) – nicht auf low
  if (!o.low) for (const [dz, dy, r, len2] of [[-0.35, 0.02, 0.05, 1.3], [0.25, -0.05, 0.04, 1.0]]) b.cyl(gx - 0.12, py + dy - 0.02, zc + dz, r, len2, 'bark', { axis: 'z', ry: dz, tint: '#6a5a46', seg: 6, collide: false, minimap: false, cast: false });
}
