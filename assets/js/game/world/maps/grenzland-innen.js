// NULLPUNKT — Grenzland: Inneneinrichtung und Innenbeleuchtung (Owner: world). Möbel aus Primitiven für Gasthaus,
// Wohnhäuser, Kapelle, Bauernhaus, Scheune, Stall, Schuppen, Bunker und Kieswerkhalle; Deckenlampen mit leuchtendem
// Schirm, Lichthof und Lichtkegel am Boden (auch auf „niedrig“), echte Punktlichter nur auf hoch/ultra und nur für
// wenige Räume (Vorwärts-Renderer: jedes Licht kostet auf allen Flächen).
// Regeln: Platzierung nur aus festen Koordinaten bzw. hash01 (kein b.rand → übrige Karten-Platzierung unverändert);
// Kollision unabhängig von der Grafikstufe; große Möbel mit Kollision (Kugeln treffen sie), Kleinkram ohne; Türen
// und Wege bleiben frei (Durchgänge ≥ 0,9 m, Türbereiche ≥ 1,5 m). Möbel ohne Minikarten-Eintrag.
import { frame, hash01 } from '../props.js';
import { railing } from '../arch.js';

const NOMAP = { minimap: false };
const DECO = { collide: false, minimap: false };
const WOOD = '#8a6a4a', WOOD_D = '#5e4634', WOOD_L = '#a88a62';

/** Echte Lichter nur auf hoch/ultra (Lampen leuchten sonst über Schirm, Lichthof und Lichtkegel). */
const realLights = (b) => b.lookQuality === 'high' || b.lookQuality === 'ultra';

// ---------------------------------------------------------------------------
// Licht
// ---------------------------------------------------------------------------
/**
 * Pendelleuchte an der Decke (Emaille-Schirm). (x, z), yC = Deckenunterkante, yF = Fußboden darunter.
 * o: { drop (Pendellänge 0,75), r (Schirmradius 0,22), shade (Farbe), pool (Lichtkegel-Durchmesser), real (echtes
 *      Punktlicht auf hoch/ultra), intensity, distance, warm (true) }
 */
export function deckenlampe(b, x, yC, z, yF, o = {}) {
  const drop = o.drop ?? 0.75, r = o.r ?? 0.22, yL = yC - drop;
  b.cyl(x, yC - 0.05, z, 0.06, 0.05, 'metal_painted', { tint: '#2b2d30', seg: 8, ...DECO, ao: false });
  b.cyl(x, yL + 0.16, z, 0.007, drop - 0.2, 'black', { seg: 4, ...DECO, ao: false, cast: false });
  // Schirm (oben schmal), darunter leuchtende Abdeckscheibe + Birne
  b.cyl(x, yL, z, r, 0.17, 'metal_painted', { r1: 0.045, tint: o.shade || '#3a5a46', seg: 12, ...DECO, ao: false });
  b.cyl(x, yL - 0.012, z, r * 0.86, 0.012, o.cool ? 'lamp_cool' : 'lamp_warm', { seg: 12, ...DECO, ao: false, cast: false });
  b.glow(x, yL - 0.05, z, { size: o.glow ?? 1.0, color: o.cool ? '#dfe9ff' : '#ffc884', intensity: 0.6 });
  const pool = o.pool ?? 3.4, tint = o.cool ? '#d8e6ff' : '#ffbe78', ry = hash01(x, z, 3) * 6.28;
  b.decal(x, yF + 0.016, z, pool, pool * 0.94, 'puddle', { kind: 'light', tint, opacity: o.poolI ?? 0.32, ry });
  b.decal(x, yF + 0.018, z, pool * 0.5, pool * 0.48, 'puddle', { kind: 'light', tint, opacity: (o.poolI ?? 0.32) * 0.8, ry: ry + 1.1 });
  if (o.real && realLights(b)) b.light('point', x, yL - 0.15, z, { color: o.cool ? '#e2ecff' : '#ffd29a', intensity: o.intensity ?? 5, distance: o.distance ?? 7, priority: 2 });
}

/** Nackte Glühbirne mit Schutzkorb (Stall, Bunker, Schuppen). */
export function kafiglampe(b, x, yC, z, yF, o = {}) {
  const drop = o.drop ?? 0.35, yL = yC - drop;
  b.cyl(x, yL + 0.1, z, 0.007, drop - 0.1, 'black', { seg: 4, ...DECO, ao: false, cast: false });
  b.cyl(x, yL, z, 0.07, 0.12, 'metal_galvanized', { r1: 0.05, seg: 8, ...DECO, ao: false });
  b.cyl(x, yL - 0.09, z, 0.045, 0.09, o.cool ? 'lamp_cool' : 'lamp_warm', { seg: 8, ...DECO, ao: false, cast: false });
  b.glow(x, yL - 0.05, z, { size: 0.8, color: o.cool ? '#dfe9ff' : '#ffc884', intensity: 0.55 });
  const pool = o.pool ?? 2.8, tint = o.cool ? '#d8e6ff' : '#ffbe78';
  b.decal(x, yF + 0.016, z, pool, pool * 0.94, 'puddle', { kind: 'light', tint, opacity: o.poolI ?? 0.28, ry: hash01(x, z, 4) * 6.28 });
  if (o.real && realLights(b)) b.light('point', x, yL - 0.15, z, { color: o.cool ? '#e2ecff' : '#ffd29a', intensity: o.intensity ?? 4, distance: o.distance ?? 6, priority: 2 });
}

// ---------------------------------------------------------------------------
// Möbel (lokal z = Vorderseite, (x, y, z) = Mitte am Boden)
// ---------------------------------------------------------------------------
/** Holztisch w × d (0,76 m hoch), Kollision als Quader. */
export function tisch(b, x, y, z, o = {}) {
  const w = o.w ?? 1.2, d = o.d ?? 0.8, f = frame(b, x, y, z, o.ry || 0), t = o.tint || WOOD_L;
  f.box(0, 0.72, 0, w, 0.045, d, 'wood_planks', { tint: t, ...DECO, grad: false });
  f.box(0, 0.62, 0, w - 0.12, 0.1, d - 0.12, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.06, 0.72, 0.06, 'wood_dark', { tint: WOOD_D, ...DECO });
  if (o.cloth) f.box(0, 0.765, 0, w * 0.55, 0.004, d + 0.04, 'white', { tint: o.cloth, ...DECO, ao: false, grad: false });
  f.solid(0, 0, 0, w, 0.77, d, NOMAP);
}

/** Holzstuhl mit Lehne (lokal −z = Lehne). Ohne Kollision (Kleinmöbel). */
export function stuhl(b, x, y, z, ry = 0, t = WOOD) {
  const f = frame(b, x, y, z, ry);
  for (const sx of [-0.17, 0.17]) for (const sz of [-0.17, 0.17]) f.box(sx, 0, sz, 0.04, 0.45, 0.04, 'wood_dark', { tint: WOOD_D, ...DECO });
  f.box(0, 0.45, 0, 0.42, 0.04, 0.42, 'wood_planks', { tint: t, ...DECO, grad: false });
  for (const sx of [-0.17, 0.17]) f.box(sx, 0.49, -0.19, 0.04, 0.46, 0.04, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false });
  f.box(0, 0.78, -0.19, 0.38, 0.14, 0.03, 'wood_planks', { tint: t, ...DECO, grad: false });
}

/** Tisch mit Stühlen ringsum (n: 2 → Längsseiten, 4 → je eine Seite, 6 → 2 + 2 + Stirnseiten). */
export function essplatz(b, x, y, z, o = {}) {
  const w = o.w ?? 1.2, d = o.d ?? 0.8, ry = o.ry || 0, n = o.n ?? 4, f = frame(b, x, y, z, ry);
  tisch(b, x, y, z, { ...o });
  const seats = [];
  if (n >= 2) { const k = n >= 6 ? 2 : 1; for (let i = 0; i < k; i++) { const lx = k === 1 ? 0 : (i - 0.5) * w * 0.5; seats.push([lx, d / 2 + 0.3, Math.PI], [lx, -d / 2 - 0.3, 0]); } }
  if (n === 4 || n >= 6) seats.push([w / 2 + 0.3, 0, -Math.PI / 2], [-w / 2 - 0.3, 0, Math.PI / 2]);
  for (const [lx, lz, a] of seats) {
    const [px, pz] = f.P(lx, lz);
    // leicht verdreht/abgerückt (bewohnt), positionsabhängig
    stuhl(b, px, y, pz, ry + a + (hash01(px, pz, 1) - 0.5) * 0.35, o.chair);
  }
}

/** Bett (Einzel 0,95 m / Doppel 1,6 m breit, 2 m lang); lokal −z = Kopfende an der Wand. Kollision 0,55 m. */
export function bett(b, x, y, z, ry = 0, o = {}) {
  const w = o.w ?? 0.95, L = 2.0, f = frame(b, x, y, z, ry);
  f.box(0, 0.1, 0, w, 0.22, L, 'wood_dark', { tint: o.frame || WOOD_D, ...DECO });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.04), 0, sz * (L / 2 - 0.04), 0.07, 0.12, 0.07, 'wood_dark', { tint: WOOD_D, ...DECO });
  f.box(0, -0.0, -L / 2 + 0.03, w + 0.04, 1.0, 0.06, 'wood_dark', { tint: o.frame || WOOD_D, ...DECO }); // Kopfteil
  f.box(0, 0.0, L / 2 - 0.03, w + 0.04, 0.6, 0.06, 'wood_dark', { tint: o.frame || WOOD_D, ...DECO });  // Fußteil
  f.box(0, 0.32, 0, w - 0.06, 0.16, L - 0.12, 'white', { tint: '#e9e4d8', ...DECO, grad: false });           // Matratze
  f.box(0, 0.47, 0.18, w - 0.02, 0.06, L * 0.62, 'white', { tint: o.blanket || '#7a4a3a', ...DECO, grad: false }); // Decke
  const pillows = w > 1.2 ? [-w / 4, w / 4] : [0];
  for (const px of pillows) f.box(px, 0.47, -L / 2 + 0.3, Math.min(0.6, w * 0.42 + 0.1), 0.1, 0.36, 'white', { tint: '#f2efe8', ...DECO, grad: false });
  f.solid(0, 0, 0, w + 0.04, 0.55, L, NOMAP);
}

/** Kleiderschrank (w 1,1, t 0,58, h 2,0); lokal +z = Türen. */
export function schrank(b, x, y, z, ry = 0, o = {}) {
  const w = o.w ?? 1.1, d = 0.58, h = o.h ?? 2.0, f = frame(b, x, y, z, ry), t = o.tint || WOOD;
  f.box(0, 0, 0, w, h, d, 'wood_planks', { tint: t, ...DECO });
  f.box(0, h, 0, w + 0.06, 0.06, d + 0.05, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false });
  f.box(0, 0.08, d / 2 + 0.005, 0.012, h - 0.2, 0.01, 'black', { ...DECO, ao: false });
  for (const sx of [-0.05, 0.05]) f.box(sx, h * 0.5, d / 2 + 0.02, 0.025, 0.14, 0.03, 'metal_galvanized', { ...DECO, ao: false });
  f.solid(0, 0, 0, w, h, d, NOMAP);
}

/** Offenes Regal (w × 0,36 × h) mit Büchern/Gläsern/Kisten; lokal +z = offen. */
export function regal(b, x, y, z, ry = 0, o = {}) {
  const w = o.w ?? 1.2, d = 0.36, h = o.h ?? 1.9, f = frame(b, x, y, z, ry), t = o.tint || WOOD;
  for (const sx of [-1, 1]) f.box(sx * (w / 2 - 0.02), 0, 0, 0.04, h, d, 'wood_planks', { tint: t, ...DECO });
  f.box(0, 0, -d / 2 + 0.01, w, h, 0.02, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false });
  const levels = Math.max(3, Math.round(h / 0.45));
  for (let l = 0; l < levels; l++) {
    const ly = 0.05 + (l * (h - 0.1)) / (levels - 1);
    f.box(0, ly, 0, w - 0.06, 0.03, d - 0.02, 'wood_planks', { tint: t, ...DECO, grad: false });
    if (l === levels - 1) continue;
    // Inhalt je Fach (positionsabhängig): Bücherreihe, Gläser oder Kisten
    let lx = -w / 2 + 0.08;
    const kind = o.kind || 'mix';
    while (lx < w / 2 - 0.12) {
      const q = hash01(x + lx, z + l, 5), qq = hash01(z + lx, x + l, 6);
      const k = kind === 'mix' ? (q < 0.45 ? 'buch' : q < 0.75 ? 'glas' : 'kiste') : kind;
      if (k === 'buch') {
        const bw = 0.03 + qq * 0.03, bh = 0.2 + qq * 0.1;
        f.box(lx + bw / 2, ly + 0.03, 0.02, bw, bh, 0.2, 'white', { tint: ['#7a2e26', '#2e4a6a', '#5a6a3a', '#8a7a5a', '#3a3a3a'][Math.floor(q * 5) % 5], ...DECO, grad: false, ao: false });
        lx += bw + 0.004;
      } else if (k === 'glas') {
        f.cyl(lx + 0.05, ly + 0.03, 0.02, 0.045, 0.16, 'glass', { ...DECO, seg: 8, ao: false, cast: false });
        f.cyl(lx + 0.05, ly + 0.03, 0.02, 0.04, 0.09, 'white', { tint: ['#c8402f', '#d8b04a', '#6a8a3a'][Math.floor(qq * 3) % 3], ...DECO, seg: 8, ao: false, cast: false });
        lx += 0.12;
      } else {
        f.box(lx + 0.14, ly + 0.03, 0.0, 0.26, 0.2, 0.28, 'cardboard', { ...DECO, grad: false, ao: false });
        lx += 0.3;
      }
      if (qq < 0.12) lx += 0.12; // Lücke
    }
  }
  f.solid(0, 0, 0, w, h, d, NOMAP);
}

/** Kommode / Anrichte (w × 0,5 × 0,9) mit Schubladen; lokal +z = Front. */
export function kommode(b, x, y, z, ry = 0, o = {}) {
  const w = o.w ?? 1.2, d = 0.5, h = o.h ?? 0.9, f = frame(b, x, y, z, ry), t = o.tint || WOOD;
  f.box(0, 0, 0, w, h, d, 'wood_planks', { tint: t, ...DECO });
  f.box(0, h, 0, w + 0.04, 0.04, d + 0.04, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false });
  for (let k = 0; k < 3; k++) f.box(0, 0.12 + k * (h - 0.2) / 3 + 0.12, d / 2 + 0.01, w - 0.1, 0.01, 0.01, 'black', { ...DECO, ao: false });
  if (o.aufsatz) {
    // Küchenbuffet: Aufsatz mit Glastüren
    f.box(0, h + 0.3, -d / 2 + 0.17, w, 0.95, 0.32, 'wood_planks', { tint: t, ...DECO });
    f.box(0, h + 0.38, -d / 2 + 0.335, w - 0.12, 0.78, 0.01, 'glass', { ...DECO, ao: false, cast: false });
  }
  f.solid(0, 0, 0, w, o.aufsatz ? h + 1.25 : h, d, NOMAP);
}

/** Küchenzeile (len × 0,6) mit Spüle, Herd, Hängeschränken (optional hang: [von, bis] lokal x). Lokal +z = Front. */
export function kueche(b, x, y, z, ry = 0, o = {}) {
  const len = o.len ?? 2.4, d = 0.6, f = frame(b, x, y, z, ry), t = o.tint || '#c8bca4';
  f.box(0, 0, 0, len, 0.86, d, 'wood_planks', { tint: t, ...DECO });
  f.box(0, 0.86, 0.01, len + 0.02, 0.04, d + 0.03, 'stone_wall', { tint: '#b8b0a2', ...DECO, grad: false, uv: 'local' });
  for (let i = 0; i < Math.floor(len / 0.6); i++) f.box(-len / 2 + 0.3 + i * 0.6, 0.12, d / 2 + 0.005, 0.56, 0.68, 0.01, 'wood_planks', { tint: '#ddd2bc', ...DECO, grad: false, ao: false });
  // Spüle (links) und Herd (rechts)
  const sx = -len / 2 + 0.55, hx = len / 2 - 0.45;
  f.box(sx, 0.83, 0.03, 0.5, 0.075, 0.4, 'metal_galvanized', { ...DECO, ao: false });
  f.cyl(sx, 0.9, -d / 2 + 0.1, 0.015, 0.24, 'metal_galvanized', { seg: 6, ...DECO, ao: false, rx: 0.5 });
  f.box(hx, 0.9, 0, 0.56, 0.02, 0.5, 'metal_painted', { tint: '#2a2a2a', ...DECO, ao: false });
  for (const [ox, oz] of [[-0.13, -0.11], [0.13, -0.11], [-0.13, 0.11], [0.13, 0.11]]) f.cyl(hx + ox, 0.92, oz, 0.08, 0.008, 'metal_painted', { tint: '#151515', seg: 10, ...DECO, ao: false });
  f.cyl(hx - 0.13, 0.928, 0.11, 0.09, 0.12, 'metal_painted', { tint: '#5a6a7a', seg: 10, ...DECO }); // Topf
  if (o.hang) {
    const [a, c] = o.hang;
    f.box((a + c) / 2, 1.45, -d / 2 + 0.18, c - a, 0.7, 0.34, 'wood_planks', { tint: t, ...DECO, grad: false });
  }
  f.solid(0, 0, 0, len, 0.9, d, NOMAP);
}

/** Kachelofen (Ecke), 0,9 × 0,9 × 1,8 m, mit Ofenbank-Sockel. */
export function kachelofen(b, x, y, z, ry = 0, o = {}) {
  const f = frame(b, x, y, z, ry), t = o.tint || '#5f7a6a';
  f.box(0, 0, 0, 0.95, 0.35, 0.95, 'stone_wall', { tint: '#9a9286', ...DECO, uv: 'local' });
  f.box(0, 0.35, 0, 0.86, 1.35, 0.86, 'tiles', { tint: t, ...DECO, uv: 'local', uvScale: 0.5 });
  f.box(0, 1.7, 0, 0.92, 0.08, 0.92, 'tiles', { tint: t, ...DECO, uv: 'local', grad: false });
  f.box(0, 0.6, 0.435, 0.32, 0.26, 0.02, 'metal_painted', { tint: '#1e1e1e', ...DECO, ao: false });
  f.solid(0, 0, 0, 0.95, 1.78, 0.95, NOMAP);
}

/** Schanktheke (len × 0,62 × 1,05) mit Zapfhahn; Rückwand-Regal mit Flaschen (back: Abstand nach −z). */
export function theke(b, x, y, z, ry = 0, o = {}) {
  const len = o.len ?? 4, f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, len, 1.0, 0.55, 'wood_planks', { tint: '#6e4e34', ...DECO });
  f.box(0, 1.0, 0.04, len + 0.06, 0.05, 0.66, 'wood_dark', { tint: '#4a3426', ...DECO, grad: false });
  f.box(0, 0, 0.29, len, 0.12, 0.04, 'wood_dark', { tint: '#3a2a1e', ...DECO });
  // Zapfanlage + Gläser
  f.box(len / 2 - 0.8, 1.05, -0.05, 0.12, 0.35, 0.08, 'metal_galvanized', { ...DECO, ao: false });
  for (const k of [0, 1]) f.cyl(len / 2 - 0.8 + (k - 0.5) * 0.08, 1.33, 0.02, 0.012, 0.08, 'metal_galvanized', { seg: 6, ...DECO, ao: false, rx: 1.4 });
  for (let i = 0; i < 4; i++) f.cyl(-len / 2 + 0.6 + i * 0.16, 1.05, 0.1, 0.035, 0.15, 'glass', { seg: 8, ...DECO, ao: false, cast: false });
  if (o.back != null) {
    const bz = -o.back;
    f.box(0, 0, bz, len - 0.2, 0.9, 0.4, 'wood_planks', { tint: '#6e4e34', ...DECO });
    for (const ly of [1.35, 1.75]) {
      f.box(0, ly, bz - 0.06, len - 0.2, 0.03, 0.26, 'wood_planks', { tint: '#6e4e34', ...DECO, grad: false });
      for (let i = 0; i < Math.floor((len - 0.4) / 0.14); i++) {
        const q = hash01(x + i, z + ly, 7);
        if (q < 0.15) continue;
        const bx = -len / 2 + 0.3 + i * 0.14;
        f.cyl(bx, ly + 0.03, bz - 0.06, 0.035, 0.22, 'glass', { tint: ['#3a6a3a', '#6a4a2a', '#c8c0a8', '#2a4a2a'][Math.floor(q * 4) % 4], seg: 6, ...DECO, ao: false, cast: false });
      }
    }
    f.solid(0, 0, bz, len - 0.2, 0.9, 0.4, NOMAP);
  }
  f.solid(0, 0, 0.02, len, 1.05, 0.62, NOMAP);
}

/** Kirchenbank (len) mit Lehne und Kniebank; lokal +z = Blickrichtung (zum Altar). */
export function kirchenbank(b, x, y, z, ry = 0, o = {}) {
  const len = o.len ?? 2.4, f = frame(b, x, y, z, ry), t = o.tint || '#7a5638';
  for (const sx of [-1, 1]) f.box(sx * (len / 2 - 0.03), 0, -0.05, 0.06, 0.95, 0.6, 'wood_planks', { tint: t, ...DECO });
  f.box(0, 0.43, -0.05, len - 0.08, 0.05, 0.42, 'wood_planks', { tint: t, ...DECO, grad: false });
  f.box(0, 0.5, -0.31, len - 0.08, 0.45, 0.04, 'wood_planks', { tint: t, ...DECO, grad: false, rx: -0.12 });
  f.box(0, 0.12, 0.33, len - 0.1, 0.06, 0.16, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false }); // Kniebank
  f.box(0, 0.86, 0.22, len - 0.1, 0.04, 0.2, 'wood_planks', { tint: t, ...DECO, grad: false });   // Buchablage (Rückseite der Bank davor)
  f.solid(0, 0, -0.05, len, 0.95, 0.62, NOMAP);
}

/** Altar mit Tuch, Kerzen und Altarstufe; Wandkreuz dahinter (wall: Abstand zur Wand nach −z). */
export function altar(b, x, y, z, ry = 0, o = {}) {
  const f = frame(b, x, y, z, ry), wd = o.stufe ?? [6.0, 2.2];
  f.box(0, 0, -0.2, wd[0], 0.16, wd[1], 'stone_wall', { tint: '#c9c0b0', ...DECO, grad: false, uv: 'local' });
  f.solid(0, 0, -0.2, wd[0], 0.16, wd[1], NOMAP);
  f.box(0, 0.16, -0.3, 1.7, 0.92, 0.8, 'stone_wall', { tint: '#d8d0c0', ...DECO, uv: 'local' });
  f.box(0, 1.08, -0.3, 1.85, 0.04, 0.9, 'white', { tint: '#f4f0e6', ...DECO, grad: false, ao: false });
  f.box(0, 0.72, 0.155, 0.7, 0.38, 0.004, 'white', { tint: '#8a2a26', ...DECO, grad: false, ao: false }); // Antependium
  for (const sx of [-0.6, 0.6]) {
    f.cyl(sx, 1.12, -0.35, 0.05, 0.05, 'metal_galvanized', { tint: '#c8a85a', seg: 8, ...DECO, ao: false });
    f.cyl(sx, 1.17, -0.35, 0.025, 0.3, 'white', { tint: '#f4efe0', seg: 8, ...DECO, ao: false });
    f.cyl(sx, 1.47, -0.35, 0.01, 0.035, 'lamp_warm', { seg: 6, ...DECO, ao: false, cast: false });
    const [gx, gz] = f.P(sx, -0.35);
    b.glow(gx, y + 1.5, gz, { size: 0.35, color: '#ffc070', intensity: 0.7 });
  }
  f.solid(0, 0.16, -0.3, 1.85, 0.96, 0.9, NOMAP);
  if (o.wall != null) {
    const wz = -o.wall + 0.03;
    f.box(0, 1.9, wz, 0.12, 1.9, 0.06, 'wood_dark', { tint: '#4a3426', ...DECO, grad: false });
    f.box(0, 3.05, wz, 1.1, 0.12, 0.06, 'wood_dark', { tint: '#4a3426', ...DECO, grad: false });
  }
}

/** Lesepult (Ambo). */
export function ambo(b, x, y, z, ry = 0) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.5, 0.06, 0.4, 'wood_dark', { tint: WOOD_D, ...DECO });
  f.box(0, 0.06, 0, 0.12, 1.0, 0.12, 'wood_planks', { tint: '#7a5638', ...DECO });
  f.box(0, 1.06, 0, 0.55, 0.04, 0.42, 'wood_planks', { tint: '#7a5638', ...DECO, grad: false, rx: 0.35 });
  f.solid(0, 0, 0, 0.55, 1.15, 0.45, NOMAP);
}

/** Wandbild (Rahmen + Motivfläche) an einer Wand; lokal +z = aus der Wand heraus. */
export function bild(b, x, y, z, ry = 0, o = {}) {
  const w = o.w ?? 0.5, h = o.h ?? 0.4, f = frame(b, x, y, z, ry);
  f.box(0, 0, 0.012, w, h, 0.025, 'wood_dark', { tint: '#4a3426', ...DECO, grad: false, ao: false });
  f.box(0, 0.04, 0.026, w - 0.08, h - 0.08, 0.004, 'white', { tint: o.tint || '#7a8a6a', ...DECO, grad: false, ao: false });
}

/** Teppich (flach, ohne Kollision). */
export function teppich(b, x, y, z, w, d, ry = 0, tint = '#7a3a2e') {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0.002, 0, w, 0.012, d, 'white', { tint, ...DECO, grad: false, ao: false, cast: false });
  f.box(0, 0.004, 0, w - 0.16, 0.012, d - 0.16, 'white', { tint: '#b89a6a', ...DECO, grad: false, ao: false, cast: false });
  f.box(0, 0.006, 0, w - 0.3, 0.012, d - 0.3, 'white', { tint, ...DECO, grad: false, ao: false, cast: false });
}

/** Truhe (0,9 × 0,5 × 0,5). */
export function truhe(b, x, y, z, ry = 0) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.9, 0.45, 0.5, 'wood_planks', { tint: '#7a5a3a', ...DECO });
  f.box(0, 0.45, 0, 0.92, 0.07, 0.52, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false });
  for (const sx of [-0.3, 0.3]) f.box(sx, 0, 0, 0.04, 0.53, 0.53, 'metal_painted', { tint: '#2b2d30', ...DECO, grad: false, ao: false });
  f.solid(0, 0, 0, 0.92, 0.52, 0.52, NOMAP);
}

/** Waschtisch mit Schüssel und Krug. */
export function waschtisch(b, x, y, z, ry = 0) {
  const f = frame(b, x, y, z, ry);
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.18, 0.18]) f.box(sx, 0, sz, 0.04, 0.8, 0.04, 'wood_dark', { tint: WOOD_D, ...DECO });
  f.box(0, 0.8, 0, 0.7, 0.04, 0.45, 'wood_planks', { tint: WOOD, ...DECO, grad: false });
  f.cyl(0, 0.84, 0, 0.17, 0.08, 'white', { r1: 0.2, tint: '#e8e4dc', seg: 12, ...DECO, ao: false });
  f.cyl(0.22, 0.84, 0.08, 0.06, 0.22, 'white', { r1: 0.045, tint: '#d8d4cc', seg: 10, ...DECO, ao: false });
  f.solid(0, 0, 0, 0.72, 0.85, 0.46, NOMAP);
}

/** Stockbett (Metall, Bunker); lokal −z = Wand. */
export function stockbett(b, x, y, z, ry = 0) {
  const f = frame(b, x, y, z, ry), L = 1.95, w = 0.85;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (L / 2 - 0.02), 0, sz * (w / 2 - 0.02), 0.04, 1.75, 0.04, 'metal_painted', { tint: '#4b5a46', ...DECO });
  for (const ly of [0.35, 1.25]) {
    f.box(0, ly, 0, L, 0.05, w, 'metal_painted', { tint: '#4b5a46', ...DECO, grad: false });
    f.box(0, ly + 0.05, 0, L - 0.08, 0.12, w - 0.08, 'fabric_camo_a', { tint: '#8a8a6a', ...DECO, grad: false });
    f.box(-L / 2 + 0.25, ly + 0.17, 0, 0.35, 0.08, w - 0.2, 'white', { tint: '#d8d2c0', ...DECO, grad: false, ao: false });
  }
  f.solid(0, 0, 0, L, 1.78, w, NOMAP);
}

/** Holzkisten-Stapel (Munition), ohne b.rand. */
export function munitionskisten(b, x, y, z, ry = 0, n = 3) {
  const f = frame(b, x, y, z, ry);
  for (let i = 0; i < n; i++) {
    const lx = (i % 2) * 0.62 - 0.31, ly = Math.floor(i / 2) * 0.32;
    f.box(lx, ly, 0, 0.6, 0.3, 0.4, 'wood_crate', { tint: '#6a7a4a', ...DECO, uv: 'fit', grad: false });
    f.box(lx, ly + 0.12, 0.205, 0.3, 0.06, 0.01, 'white', { tint: '#e8e0b0', ...DECO, ao: false, grad: false });
  }
  f.solid(0, 0, 0, 1.24, Math.ceil(n / 2) * 0.32, 0.42, NOMAP);
}

/** Funkgerät-Tisch mit Gerät, Hörer, Lampe (Bunker). */
export function funktisch(b, x, y, z, ry = 0) {
  const f = frame(b, x, y, z, ry);
  tisch(b, x, y, z, { ry, w: 1.5, d: 0.6, tint: '#7a7a6a' });
  f.box(-0.25, 0.77, -0.05, 0.6, 0.32, 0.36, 'metal_painted', { tint: '#4b5a46', ...DECO });
  f.box(-0.25, 0.85, 0.135, 0.5, 0.18, 0.01, 'black', { ...DECO, ao: false });
  for (let k = 0; k < 4; k++) f.cyl(-0.45 + k * 0.12, 0.9, 0.14, 0.025, 0.03, 'metal_galvanized', { axis: 'z', seg: 8, ...DECO, ao: false });
  f.cyl(-0.05, 0.86, 0.15, 0.012, 0.012, 'lamp_green', { axis: 'z', seg: 6, ...DECO, ao: false, cast: false });
  f.box(0.3, 0.77, 0.05, 0.18, 0.06, 0.08, 'polymer', { tint: '#1e1e1e', ...DECO, ao: false });
  f.box(0.5, 0.77, 0.0, 0.32, 0.005, 0.24, 'white', { tint: '#e8e0c8', ...DECO, ao: false, grad: false }); // Karte/Logbuch
  const [cx, cz] = f.P(0, 0.55);
  stuhl(b, cx, y, cz, ry + Math.PI, '#6a6a5a');
}

// ---------------------------------------------------------------------------
// Landwirtschaft
// ---------------------------------------------------------------------------
/** Quaderballen (1,2 × 0,6 × 0,8) mit Kollision. */
export function quaderballen(b, x, y, z, ry = 0) { b.box(x, y, z, 1.2, 0.6, 0.8, 'sand', { ry, tint: '#d6bd70', minimap: false }); }

/** Werkzeug an der Wand: Rechen, Mistgabel, Schaufel, Sense (lokal +z = aus der Wand). */
export function werkzeugwand(b, x, y, z, ry = 0) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 1.55, 0.03, 1.6, 0.08, 0.04, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false });
  const tools = [[-0.6, 'rechen'], [-0.2, 'gabel'], [0.2, 'schaufel'], [0.6, 'gabel']];
  for (const [lx, k] of tools) {
    f.box(lx, 0.25, 0.09, 0.035, 1.45, 0.035, 'wood_planks', { tint: '#a88a62', ...DECO, rz: 0.04, grad: false });
    if (k === 'rechen') { f.box(lx, 1.62, 0.09, 0.5, 0.04, 0.04, 'wood_dark', { tint: WOOD_D, ...DECO, grad: false }); for (let i = 0; i < 7; i++) f.box(lx - 0.22 + i * 0.073, 1.66, 0.09, 0.012, 0.08, 0.012, 'wood_dark', { tint: WOOD_D, ...DECO, ao: false }); }
    if (k === 'gabel') for (let i = 0; i < 3; i++) f.box(lx - 0.06 + i * 0.06, 1.68, 0.09, 0.012, 0.3, 0.012, 'metal_galvanized', { ...DECO, ao: false });
    if (k === 'schaufel') f.box(lx, 0.05, 0.09, 0.24, 0.3, 0.02, 'metal_painted', { tint: '#4a4f52', ...DECO, ao: false });
  }
}

/** Futtertrog (len × 0,5 × 0,55) mit Kollision. */
export function futtertrog(b, x, y, z, ry = 0, len = 3) {
  const f = frame(b, x, y, z, ry);
  for (const sz of [-0.22, 0.22]) f.box(0, 0, sz, len, 0.55, 0.06, 'wood_planks', { tint: '#7a5a3a', ...DECO });
  f.box(0, 0, 0, len, 0.12, 0.5, 'wood_dark', { tint: WOOD_D, ...DECO });
  f.box(0, 0.12, 0, len - 0.1, 0.18, 0.36, 'sand', { tint: '#c8b068', ...DECO, grad: false, ao: false });
  f.solid(0, 0, 0, len, 0.55, 0.5, NOMAP);
}

/** Stall-Trennwand (Bretter, 1,3 m) mit Kollision. */
export function boxenwand(b, x, y, z, ry = 0, len = 1.8) {
  const f = frame(b, x, y, z, ry);
  for (let k = 0; k < 4; k++) f.box(0, 0.15 + k * 0.3, 0, len, 0.24, 0.05, 'wood_planks', { tint: '#8a6a4a', ...DECO, grad: k === 0 });
  f.box(len / 2 - 0.05, 0, 0, 0.1, 1.35, 0.1, 'wood_dark', { tint: WOOD_D, ...DECO });
  f.solid(0, 0, 0, len, 1.3, 0.08, NOMAP);
}

/** Milchkannen-Gruppe (ohne Kollision). */
export function milchkannen(b, x, y, z, n = 3) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.1 + hash01(x, z, i) * 0.5, px = x + Math.cos(a) * 0.28 * (i > 0), pz = z + Math.sin(a) * 0.28 * (i > 0);
    b.cyl(px, y, pz, 0.16, 0.55, 'metal_galvanized', { seg: 10, ...DECO });
    b.cyl(px, y + 0.55, pz, 0.16, 0.12, 'metal_galvanized', { r1: 0.08, seg: 10, ...DECO, ao: false });
    b.cyl(px, y + 0.67, pz, 0.09, 0.06, 'metal_galvanized', { seg: 10, ...DECO, ao: false });
  }
}

/** Stroh am Boden (flache, unregelmäßige Lagen, ohne Kollision). */
export function stroh(b, x, y, z, w, d, ry = 0) {
  const f = frame(b, x, y, z, ry);
  for (let i = 0; i < 4; i++) {
    const q = hash01(x + i, z - i, 8), lx = (q - 0.5) * w * 0.5, lz = (hash01(z + i, x, 9) - 0.5) * d * 0.5;
    f.box(lx, 0.0, lz, w * (0.5 + q * 0.4), 0.05 + q * 0.04, d * (0.45 + q * 0.3), 'sand', { tint: '#cfb46a', ...DECO, ry: q * 0.8, grad: false, ao: false, cast: false });
  }
}

/**
 * Geländer um ein Treppenloch im Obergeschoss (Lauf entlang x): Raumseite (room 'n' → z0, 's' → z1) und das
 * geschlossene Ende (Treppenfuß, gegenüber der Ankunft open 'e' → x0 | 'w' → x1); die Ankunftsseite bleibt offen.
 */
export function lochgelaender(b, hole, y, room = 's', open = 'e') {
  const { x0, x1, z0, z1 } = hole, o = { mat: 'wood_dark', tint: '#5a4636', h: 0.95 };
  const zr = room === 's' ? z1 + 0.05 : z0 - 0.05, xe = open === 'e' ? x0 - 0.05 : x1 + 0.05;
  railing(b, xe, zr, open === 'e' ? x1 : x0, zr, y, o);
  railing(b, xe, room === 's' ? z0 : z1, xe, zr, y, o);
}
