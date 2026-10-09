// NULLPUNKT — Hafen: Ausstattung aus Primitiven (Owner: world). Büro-, Pförtner- und Lagermöbel, Deckenleuchten an der
// Decke (Gehäuse + Leuchtfläche, Licht ins Sonden-Gitter gebacken, echtes Licht nur ab „hoch“), begehbare offene
// Container (hohle Hülle, Holzboden, Ladung, Navigationslinie), Kaikanten-Absperrung (Pfosten mit Kette statt nur
// unsichtbarer Wand), Schiebetor an Tor 2, Steigleiter mit Rückenschutz am Kranbein.
// Alles deterministisch (kein Math.random, Varianten nur positionsabhängig über hash01). Kollision hängt weder von der
// Grafikstufe noch von der Bibliothek ab: Bibliotheksmodelle bekommen feste Quader in Manifest-Maßen.
import * as THREE from 'three';
import { frame, hash01, chair, crate, pallet, cable, CONTAINER_H, CONTAINER_W } from '../props.js';

const KEIN = { collide: false, minimap: false };
const VG = { ...KEIN, grad: false };
const hoch = b => b.lookQuality === 'high' || b.lookQuality === 'ultra';
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

/** Gedrehter Kollisionsquader (Unterkante-Mitte) in festen Maßen – für Bibliotheksmodelle und Möbel. */
function block(b, x, y, z, w, h, d, ry, minimap = 'prop') {
  b.box(x, y, z, w, h, d, 'black', { ry, visual: false, minimap });
}

/**
 * Bibliotheksmodell mit prozeduralem Ersatz; Kollision (o.solid) als Quader in Manifest-Maßen size [w, h, d],
 * unabhängig davon, ob das Modell lädt.
 */
function modell(b, id, x, y, z, ry, size, ersatz, o = {}) {
  b.model(id, x, y, z, { ry, collide: false, ...(o.model || {}), fallback: ersatz });
  if (o.solid) block(b, x, y, z, size[0], size[1], size[2], ry, o.minimap ?? (size[1] > 1 ? 'cover' : 'prop'));
}

/**
 * Bibliotheksmodell mit Ersatzquader in denselben Maßen und fester Kollision (size [w, h, d] des sichtbaren Teils) –
 * auf jedem Rechner gleich, auch wenn die Bibliothek nicht lädt. o: { part, mat, tint, minimap }
 */
export function festesModell(b, id, x, y, z, ry, size, o = {}) {
  const ersatz = (bb) => bb.box(x, y, z, size[0], size[1], size[2], o.mat || 'metal_painted', { ry, tint: o.tint || '#6f7a80', ...KEIN });
  modell(b, id, x, y, z, ry, size, ersatz, { solid: true, model: o.part ? { part: o.part } : undefined, minimap: o.minimap });
}

// ---------------------------------------------------------------------------
// Büromöbel
// ---------------------------------------------------------------------------
/** Schreibtisch (Stahl, 2,0 × 0,95 m) mit Flachbildschirm, Tastatur, Telefon, Ablage. Lokal +z = Sitzseite. */
export function schreibtisch(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry);
  modell(b, 'metal_office_desk', x, y, z, ry, [2.0, 0.787, 0.947], (bb) => {
    const g = frame(bb, x, y, z, ry);
    g.box(0, 0.74, 0, 2.0, 0.045, 0.94, 'wood_planks', { tint: '#8a7a62', ...VG });
    g.box(-0.72, 0, 0, 0.5, 0.74, 0.9, 'metal_painted', { tint: '#6f7a80', ...KEIN });
    for (let k = 0; k < 3; k++) g.box(-0.72, 0.1 + k * 0.22, 0.455, 0.42, 0.18, 0.01, 'metal_painted', { tint: '#5f6a70', ...VG, ao: false });
    for (const sz of [-0.42, 0.42]) g.box(0.94, 0, sz, 0.05, 0.74, 0.05, 'metal_painted', { tint: '#4a5058', ...KEIN });
    g.box(0.94, 0.05, 0, 0.04, 0.04, 0.84, 'metal_painted', { tint: '#4a5058', ...VG, ao: false });
  }, { solid: true, minimap: 'cover' });
  if (o.leer) return;
  const top = 0.787;
  // Flachbildschirm auf Standfuß, Tastatur, Maus, Telefon, Papierstapel, Tasse
  f.box(0.2, top, -0.28, 0.22, 0.015, 0.16, 'polymer', { tint: '#1e2023', ...VG, ao: false });
  f.box(0.2, top + 0.015, -0.3, 0.04, 0.16, 0.03, 'polymer', { tint: '#1e2023', ...VG, ao: false });
  f.box(0.2, top + 0.13, -0.29, 0.56, 0.34, 0.035, 'polymer', { tint: '#1e2023', ...VG });
  f.box(0.2, top + 0.15, -0.271, 0.52, 0.3, 0.004, 'glass', { tint: hash01(x, z, 11) < 0.5 ? '#203848' : '#1a2228', ...VG, ao: false });
  f.box(0.2, top, 0.08, 0.44, 0.022, 0.15, 'polymer', { tint: '#2b2d30', ...VG, ao: false });
  f.box(0.56, top, 0.1, 0.06, 0.025, 0.1, 'polymer', { tint: '#2b2d30', ...VG, ao: false });
  f.box(-0.5, top, -0.1, 0.2, 0.07, 0.22, 'polymer', { tint: '#2b2d30', ...VG, ao: false });
  f.box(-0.78, top, 0.05, 0.24, 0.06, 0.32, 'white', { tint: '#ece8dc', ...VG, ao: false, ry: 0.15 });
  f.cyl(0.78, top, -0.1, 0.04, 0.1, 'white', { tint: '#e8e2d6', ...KEIN, seg: 8, ao: false });
}

/** Bürostuhl (Bibliothek: Schulstuhl) bzw. prozeduraler Stuhl; ohne Kollision (Kleinteil). Sitzender blickt lokal +z. */
export function stuhl(b, x, y, z, ry) {
  b.model('schoolchair_01', x, y, z, { ry: ry + Math.PI, collide: false, fallback: bb => chair(bb, x, z, { y, ry, tint: '#4a5a64' }) });
}

/** Aktenschrank (4 Schübe) 0,47 × 1,32 × 0,62 m, Front lokal +z. */
export function aktenschrank(b, x, y, z, ry, tint = '#7a8288') {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.47, 1.32, 0.62, 'metal_painted', { tint, ...KEIN });
  for (let k = 0; k < 4; k++) {
    f.box(0, 0.06 + k * 0.315, 0.312, 0.43, 0.29, 0.008, 'metal_painted', { tint, ...VG, ao: false });
    f.box(0, 0.24 + k * 0.315, 0.322, 0.14, 0.025, 0.02, 'metal_galvanized', { ...VG, ao: false });
  }
  block(b, x, y, z, 0.47, 1.32, 0.62, ry, 'cover');
}

/** Stahlregal (Bibliothek: steel_frame_shelves_01) mit Ordnern und Kartons; Front lokal +z, feste Kollision. */
export function regal(b, x, y, z, ry) {
  const f = frame(b, x, y, z, ry);
  modell(b, 'steel_frame_shelves_01', x, y, z, ry, [1.098, 2.14, 0.502], (bb) => {
    const g = frame(bb, x, y, z, ry);
    for (const sx of [-0.52, 0.52]) for (const sz of [-0.22, 0.22]) g.box(sx, 0, sz, 0.04, 2.14, 0.04, 'metal_painted', { tint: '#8a9096', ...KEIN });
    for (let k = 0; k < 5; k++) g.box(0, 0.08 + k * 0.5, 0, 1.08, 0.025, 0.48, 'metal_painted', { tint: '#9aa0a4', ...VG, ao: false });
  }, { solid: true });
  const cols = ['#2f5f94', '#c8402f', '#3e7a4c', '#d9a72a', '#5a5f66'];
  for (let k = 0; k < 3; k++) {
    const yy = 0.6 + k * 0.5, n = 4 + Math.floor(hash01(x + k, z, 41) * 5);
    for (let i = 0; i < n; i++) f.box(-0.44 + i * 0.075, yy, 0.02, 0.065, 0.3, 0.28, 'cardboard', { tint: cols[(i + k) % cols.length], ...VG, ao: false, uv: 'fit' });
    if (hash01(x, z + k, 42) < 0.7) f.box(0.25, yy, 0, 0.36, 0.26, 0.34, 'cardboard', { ...VG, ao: false, uv: 'fit', ry: 0.05 });
  }
}

/** Tisch (Platte w × d, 0,75 m), feste Kollision bis zur Plattenoberkante. */
export function tisch(b, x, y, z, ry, w = 1.2, d = 0.7) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0.72, 0, w, 0.035, d, 'wood_planks', { tint: '#b8a88a', ...VG });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 0.04, 0.72, 0.04, 'metal_painted', { tint: '#4a5058', ...KEIN });
  block(b, x, y, z, w, 0.755, d, ry, 'prop');
}

/** Besprechungstisch mit Stühlen an beiden Längsseiten (je n). */
export function besprechung(b, x, y, z, ry, w = 1.6, d = 0.9, n = 2) {
  tisch(b, x, y, z, ry, w, d);
  const f = frame(b, x, y, z, ry);
  for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
    const lx = n === 1 ? 0 : -w / 2 + 0.4 + (i * (w - 0.8)) / (n - 1);
    const [cx, cz] = f.P(lx, s * (d / 2 + 0.32));
    stuhl(b, cx, y, cz, ry + (s > 0 ? Math.PI : 0) + (hash01(cx, cz, 5) - 0.5) * 0.3);
  }
  // Ordner, Becher auf dem Tisch
  f.box(-0.3, 0.755, 0.05, 0.32, 0.04, 0.24, 'white', { tint: '#ece8dc', ...VG, ao: false, ry: 0.2 });
  f.cyl(0.35, 0.755, -0.12, 0.04, 0.1, 'white', { tint: '#e8e2d6', ...KEIN, seg: 8, ao: false });
}

/** Kaffeeecke: Kaffeemaschine, Wasserkocher, Tassen auf einer Fläche (Oberkante yTop), Kleinteile. */
export function kaffeeEcke(b, x, yTop, z, ry) {
  const f = frame(b, x, yTop, z, ry);
  f.box(-0.15, 0, 0, 0.22, 0.34, 0.26, 'polymer', { tint: '#2b2d30', ...VG });
  f.cyl(-0.15, 0.02, 0.08, 0.06, 0.12, 'glass', { tint: '#3a2a20', ...KEIN, seg: 8, ao: false });
  f.cyl(0.15, 0, 0, 0.07, 0.2, 'white', { tint: '#d8d8d2', ...KEIN, seg: 10, ao: false });
  for (const [lx, lz] of [[0.32, 0.08], [0.38, -0.06]]) f.cyl(lx, 0, lz, 0.04, 0.09, 'white', { tint: '#ece6da', ...KEIN, seg: 8, ao: false });
}

/** Küchenzeile (Unterschränke, Arbeitsplatte, Spüle, Kaffeeecke) Breite w, Front lokal +z. */
export function kuechenzeile(b, x, y, z, ry, w = 1.8) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0.1, -0.02, w, 0.78, 0.56, 'wood_planks', { tint: '#d8d2c4', ...KEIN });
  f.box(0, 0, 0.02, w - 0.04, 0.1, 0.5, 'polymer', { tint: '#2b2d30', ...KEIN });
  f.box(0, 0.88, 0, w + 0.02, 0.04, 0.6, 'wood_planks', { tint: '#6a5a48', ...VG });
  const nt = Math.max(2, Math.round(w / 0.6));
  for (let i = 1; i < nt; i++) f.box(-w / 2 + (i * w) / nt, 0.14, 0.262, 0.01, 0.7, 0.004, 'black', { ...VG, ao: false });
  for (let i = 0; i < nt; i++) f.box(-w / 2 + ((i + 0.5) * w) / nt, 0.76, 0.27, 0.12, 0.02, 0.02, 'metal_galvanized', { ...VG, ao: false });
  f.box(-w / 2 + 0.4, 0.905, 0, 0.45, 0.02, 0.38, 'metal_galvanized', { ...VG, ao: false });
  f.cyl(-w / 2 + 0.4, 0.92, -0.2, 0.015, 0.22, 'metal_galvanized', { ...KEIN, seg: 6, ao: false });
  const [kx, kz] = f.P(w / 2 - 0.45, -0.05);
  kaffeeEcke(b, kx, y + 0.92, kz, ry);
  block(b, x, y, z, w, 0.92, 0.6, ry, 'prop');
}

/** Kühlschrank (0,6 × 1,45 × 0,62), Front lokal +z. */
export function kuehlschrank(b, x, y, z, ry) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.6, 1.45, 0.62, 'white', { tint: '#e8e6e0', ...KEIN });
  f.box(0, 0.9, 0.312, 0.58, 0.006, 0.004, 'black', { ...VG, ao: false });
  f.box(0.24, 0.55, 0.33, 0.025, 0.3, 0.03, 'metal_galvanized', { ...VG, ao: false });
  block(b, x, y, z, 0.6, 1.45, 0.62, ry, 'cover');
}

/** Kleiner Kühlschrank (unter Fensterbank) mit Kaffeeecke obenauf. */
export function minikuehlschrank(b, x, y, z, ry) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.55, 0.84, 0.55, 'white', { tint: '#e8e6e0', ...KEIN });
  f.box(0.2, 0.5, 0.285, 0.025, 0.22, 0.025, 'metal_galvanized', { ...VG, ao: false });
  kaffeeEcke(b, x, y + 0.84, z, ry);
  block(b, x, y, z, 0.55, 0.84, 0.55, ry, 'prop');
}

/** Wasserspender (Gallone auf Ständer), Kleinteil-Kollision. */
export function wasserspender(b, x, y, z, ry) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.32, 0.98, 0.32, 'white', { tint: '#e8e6e0', ...KEIN });
  f.box(0, 0.62, 0.165, 0.16, 0.12, 0.02, 'polymer', { tint: '#2b2d30', ...VG, ao: false });
  f.cyl(0, 0.98, 0, 0.13, 0.42, 'glass', { tint: '#6aa0c8', ...KEIN, seg: 10 });
  block(b, x, y, z, 0.34, 1.4, 0.34, ry, 'prop');
}

/** Pinnwand mit Zetteln an einer Wand (Mitte; ry = Blickrichtung aus der Wand). */
export function pinnwand(b, x, y, z, ry, w = 1.0, h = 0.7) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0.012, w, h, 0.024, 'wood_planks', { tint: '#8a6440', ...VG, ao: false });
  f.box(0, 0.03, 0.026, w - 0.06, h - 0.06, 0.004, 'cardboard', { tint: '#b98b5a', ...VG, ao: false });
  const tints = ['#f2efe6', '#f4e27a', '#f2efe6', '#bfd8ec', '#f2efe6'];
  for (let i = 0; i < 6; i++) {
    const u = (hash01(x + i, z, 31) - 0.5) * (w - 0.3), v = 0.12 + hash01(x, z + i, 32) * (h - 0.42);
    f.box(u, v, 0.03, 0.18, 0.24, 0.003, 'white', { tint: tints[i % tints.length], ...VG, ao: false, rz: (hash01(x, i, 33) - 0.5) * 0.2 });
  }
}

/** Spinde (n Türen à 0,42 m), Front lokal +z, mit Lüftungsschlitzen und Namensschildern. */
export function spinde(b, x, y, z, ry, n = 3, tint = '#6f7f8a') {
  const f = frame(b, x, y, z, ry);
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * 0.42;
    f.box(lx, 0.08, 0, 0.4, 1.77, 0.5, 'metal_painted', { tint, ...KEIN });
    for (let k = 0; k < 3; k++) f.box(lx, 1.45 + k * 0.06, 0.252, 0.25, 0.015, 0.006, 'black', { ...VG, ao: false });
    f.box(lx + 0.13, 0.95, 0.256, 0.025, 0.12, 0.012, 'metal_galvanized', { ...VG, ao: false });
    f.box(lx, 1.32, 0.256, 0.12, 0.05, 0.004, 'white', { tint: '#f2efe6', ...VG, ao: false });
  }
  f.box(0, 0, 0, n * 0.42, 0.08, 0.46, 'polymer', { tint: '#2b2d30', ...KEIN });
  block(b, x, y, z, n * 0.42, 1.85, 0.5, ry, 'cover');
}

// ---------------------------------------------------------------------------
// Leuchten (an der Decke montiert)
// ---------------------------------------------------------------------------
/**
 * Leuchtstoff-Langfeldleuchte bündig unter der Decke (Unterseite yDecke), Länge len entlang ry. Licht wird ins
 * Sonden-Gitter gebacken; echtes Licht nur mit o.real ab „hoch“ (sparsam).
 */
export function deckenleuchte(b, x, yDecke, z, ry, len = 1.25, o = {}) {
  b.box(x, yDecke - 0.07, z, len, 0.07, 0.24, 'metal_painted', { ry, tint: '#d8d8d2', ...VG, ao: false });
  b.box(x, yDecke - 0.085, z, len - 0.06, 0.015, 0.18, 'lamp_cool', { ry, ...VG, ao: false, cast: false });
  b.glow(x, yDecke - 0.16, z, { color: '#e6efff', size: o.glowSize ?? Math.min(1.6, len * 0.9), intensity: o.glowI ?? 0.45 });
  if (o.light !== false) {
    b.light('point', x, yDecke - 0.45, z, {
      color: '#eef3ff', intensity: o.intensity ?? 8, distance: o.distance ?? 8,
      realtime: !!(o.real && hoch(b)), priority: 2,
    });
  }
}

// ---------------------------------------------------------------------------
// Begehbarer offener Container
// ---------------------------------------------------------------------------
/**
 * ISO-Container mit geöffneten Türen (Türseite lokal +x), begehbar: Holzboden 0,16 m (Stufe), Kollision als hohle
 * Hülle (Wände 6 cm, Dach, Türrahmen), Türflügel ~100° aufgeklappt, hinten etwas Ladung (Kisten mit Kollision,
 * Kartons ohne). Dachfläche ohne Navigation, innen eine Navigationslinie (Bots können hinein und wieder heraus).
 * ry beliebig (auch Werk-Hof: 0,15); Innenraum-Abdunklung (achsenparallel) nur bei 90°-Schritten, sonst dunklere
 * Innenhaut. o: { len (6,06|12,19), ry, color, cargo, nav }
 */
export function offenerContainer(b, x, z, o = {}) {
  const len = o.len ?? 6.06, H = CONTAINER_H, W = CONTAINER_W, ry = o.ry || 0, color = o.color || '#2d5f94';
  const f = frame(b, x, 0, z, ry);
  // Innenraum-Volumen sind achsenparallel: nur bei 90°-Drehungen eines anlegen, sonst die Innenhaut gleich dunkler
  const axis = Math.abs(Math.sin(2 * ry)) < 1e-3;
  const dark = shade(color, 0.72), innen = shade(color, axis ? 0.55 : 0.36);
  const L2 = len / 2, W2 = W / 2, t = 0.06, fl = 0.16;
  const V = { ...KEIN, uv: 'local' };
  // Außenhaut + dunklere Innenhaut (Seiten, Stirnwand, Dach)
  for (const s of [-1, 1]) {
    f.box(0, 0.05, s * (W2 - 0.03), len - 0.12, H - 0.11, 0.03, 'container', { tint: color, ...V, aoFloor: 0 });
    f.box(-0.03, fl, s * (W2 - t + 0.012), len - 0.3, H - fl - 0.12, 0.012, 'container', { tint: innen, ...V, grad: false });
  }
  f.box(-L2 + 0.04, 0.05, 0, 0.03, H - 0.11, W - 0.1, 'container', { tint: color, ...V, aoFloor: 0 });
  f.box(-L2 + t + 0.01, fl, 0, 0.012, H - fl - 0.12, W - 2 * t, 'container', { tint: innen, ...V, grad: false });
  f.box(0, H - 0.07, 0, len - 0.12, 0.04, W - 0.08, 'container', { tint: color, ...V, grad: false });
  f.box(-0.03, H - 0.1, 0, len - 0.3, 0.012, W - 2 * t, 'container', { tint: innen, ...V, grad: false });
  // Holzboden (Oberkante fl)
  f.box(0, 0.02, 0, len - 0.2, fl - 0.02, W - 2 * t, 'wood_planks', { tint: '#7a5a3c', ...VG });
  // Eckpfosten, Ober-/Untergurte, Türrahmen (Kopfträger + Schwelle)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (L2 - 0.09), 0, sz * (W2 - 0.09), 0.18, H, 0.18, 'container', { tint: dark, ...V, grad: false });
  for (const sz of [-1, 1]) {
    f.box(0, H - 0.12, sz * (W2 - 0.06), len - 0.3, 0.12, 0.12, 'container', { tint: dark, ...V, grad: false });
    f.box(0, 0, sz * (W2 - 0.06), len - 0.3, 0.16, 0.12, 'container', { tint: dark, ...V, grad: false });
  }
  f.box(L2 - 0.09, H - 0.26, 0, 0.18, 0.26, W - 0.3, 'container', { tint: dark, ...V, grad: false });
  f.box(L2 - 0.08, 0, 0, 0.16, fl, W - 0.3, 'metal_painted', { tint: '#3a3d40', ...VG });
  // Türflügel: an den Eckpfosten angeschlagen, ~100° geöffnet (leicht nach außen gespreizt), Verschlussstangen außen
  const lw = W2 - 0.04, phi = 0.17;
  for (const s of [-1, 1]) {
    const hx = L2 + 0.03, hz = s * (W2 + 0.02), dx = Math.cos(phi), dz = s * Math.sin(phi);
    const cx = hx + dx * lw / 2, cz = hz + dz * lw / 2, rr = -s * phi;
    f.box(cx, 0.06, cz, lw, H - 0.16, 0.05, 'container', { tint: color, ...V, ry: rr, grad: false });
    const nx = -Math.sin(phi), nz = s * Math.cos(phi); // Außennormale des Flügels (um 90° + phi gedreht)
    for (const k of [0.3, 0.75]) {
      const px = hx + dx * lw * k + nx * 0.045, pz = hz + dz * lw * k + nz * 0.045;
      f.cyl(px, 0.12, pz, 0.022, H - 0.3, 'metal_galvanized', { ...KEIN, seg: 6, ao: false });
      f.box(px + nx * 0.02, 1.05, pz + nz * 0.02, 0.05, 0.05, 0.2, 'metal_galvanized', { ...VG, ao: false, ry: rr });
    }
    // Kollision des Flügels (dünn, gedreht)
    const [wx, wz] = f.P(cx, cz);
    b.box(wx, 0.06, wz, lw, H - 0.16, 0.06, 'black', { ry: ry + rr, visual: false, minimap: false });
  }
  // Kollision: hohle Hülle (Boden, Seiten, Stirnwand, Dach, Kopfträger, Pfosten an der Tür)
  f.solid(0, 0, 0, len, fl, W, { minimap: false });
  for (const s of [-1, 1]) {
    f.solid(0, 0, s * (W2 - t / 2), len, H, t, { minimap: false });
    f.solid(L2 - 0.09, 0, s * (W2 - 0.09), 0.18, H, 0.18, { minimap: false });
  }
  f.solid(-L2 + t / 2, 0, 0, t, H, W, { minimap: false });
  f.solid(0, H - t, 0, len, t, W, { minimap: false });
  f.solid(L2 - 0.09, H - 0.26, 0, 0.18, 0.26, W, { minimap: false });
  // Minikarte + Bodenschatten wie ein normaler Container
  b.footprints.push({ x, z, hw: len / 2, hd: W2, ry, y0: 0, y1: H, kind: 'container' });
  // Innenraum dunkler (achsenparallel; Türseite offen)
  const c = Math.abs(Math.cos(ry)) > 0.5, ix = (c ? len / 2 : W2) - t - 0.02, iz = (c ? W2 : len / 2) - t - 0.02;
  if (axis) b.interior(x - ix, z - iz, x + ix, z + iz, fl - 0.05, H - t - 0.02, 0.58);
  // Ladung hinten: Kisten (Kollision), Palette mit Säcken, Kartons (ohne)
  if (o.cargo !== false) {
    const back = -L2 + t + 0.02, rot = ry + Math.PI / 2;
    const k1 = f.P(back + 0.52, -0.62), k3 = f.P(back + 0.54, -0.6);
    crate(b, k1[0], fl, k1[1], 0.95, { ry: ry + 0.04, aoFloor: fl });
    crate(b, k3[0], fl + 0.95, k3[1], 0.8, { ry: ry - 0.08, aoFloor: fl });
    const p = f.P(back + 0.5, 0.5);
    pallet(b, p[0], fl, p[1], { ry: rot, load: hash01(x, z, 3) < 0.5 ? 'sacks' : 'wrapped', wrapTint: '#cfd6d8' });
    if (len > 8) {
      const q = f.P(back + 2.0, 0.5);
      pallet(b, q[0], fl, q[1], { ry: rot + 0.05, load: 'boxes' });
      const r = f.P(back + 1.9, -0.6);
      crate(b, r[0], fl, r[1], 1.0, { ry: ry + 0.1, aoFloor: fl });
    }
    // lose Kartons (ohne Kollision)
    const kx = back + (len > 8 ? 3.1 : 1.55);
    for (const [lx, lz, ly, s] of [[kx, 0.7, 0, 0.45], [kx + 0.1, 0.25, 0, 0.4], [kx + 0.05, 0.5, 0.405, 0.38]]) {
      const [px, pz] = f.P(lx, lz);
      b.box(px, fl + ly, pz, s, s * 0.9, s * 1.1, 'cardboard', { ry: ry + hash01(px, pz, 2) * 0.6, uv: 'fit', ...VG });
    }
  }
  // Navigation: Dach ausgeschlossen, Linie von draußen vor der Tür bis vor die Ladung
  // (gedrehte Hülle: Ausdehnung der Ecken; bei 90°-Schritten wie bisher)
  const ac = Math.abs(Math.cos(ry)), as = Math.abs(Math.sin(ry));
  const hx = ac * len / 2 + as * W2 + 0.4, hz = as * len / 2 + ac * W2 + 0.4;
  b.noNav(x - hx, z - hz, x + hx, z + hz, 1.2, 30);
  if (o.nav !== false) {
    const [ax, az] = f.P(L2 + 1.5, 0), [ex, ez] = f.P(-L2 + (len > 8 ? 3.6 : 2.3), 0);
    b.navLine(ax, 0.25, az, ex, fl + 0.25, ez, 1.1);
  }
}

// ---------------------------------------------------------------------------
// Kartengrenzen und Anlagen
// ---------------------------------------------------------------------------
/**
 * Kaikanten-Absperrung: gelbe Pfosten auf der Kante (x) mit durchhängender Kette, von z0 bis z1. Die Kollision der
 * Kante bleibt die vorhandene Kaimauer-Hülle – die Kette zeigt sie sichtbar an (keine „unsichtbare Wand“ mehr).
 */
export function kaiAbsperrung(b, x, z0, z1, o = {}) {
  const step = o.step ?? 3.2, n = Math.max(1, Math.round((z1 - z0) / step)), h = o.h ?? 0.95, y0 = o.y ?? 0.22;
  const tops = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    b.cyl(x, y0, z, 0.05, h, 'metal_painted', { tint: '#e8c22c', ...KEIN, seg: 8 });
    for (const k of [0.25, 0.6]) b.cyl(x, y0 + h * k, z, 0.052, 0.1, 'metal_painted', { tint: '#1d1d1f', ...KEIN, seg: 8, ao: false });
    b.cyl(x, y0 + h, z, 0.065, 0.04, 'metal_painted', { tint: '#1d1d1f', ...KEIN, seg: 8, ao: false });
    b.cyl(x, y0 - 0.02, z, 0.11, 0.04, 'metal_galvanized', { ...KEIN, seg: 8, ao: false });
    tops.push([x, y0 + h - 0.06, z]);
  }
  for (let i = 0; i < n; i++) cable(b, tops[i], tops[i + 1], { sag: o.sag ?? 0.16, segments: 5, r: 0.014 });
}

/**
 * Geschlossenes Schiebetor (Laufschiene außen vor der Zaunlinie) zwischen x0 und x1 bei z. Rahmen aus Vierkantrohr,
 * Maschendraht-Füllung, Laufrollen; Kollision bleibt der Grenzkollider der Karte. Optional Schild zur Terminalseite.
 */
export function schiebetor(b, x0, x1, z, o = {}) {
  const L = x1 - x0, cx = (x0 + x1) / 2, h = o.h ?? 2.3, m = 'metal_galvanized';
  b.box(cx, 0.1, z, L, 0.08, 0.08, m, { ...VG });
  b.box(cx, h - 0.08, z, L, 0.08, 0.08, m, { ...VG });
  const nv = Math.max(2, Math.round(L / 1.8));
  for (let i = 0; i <= nv; i++) b.box(x0 + (L * i) / nv, 0.1, z, 0.07, h - 0.1, 0.07, m, { ...VG });
  // Diagonalstreben je Feld
  for (let i = 0; i < nv; i++) {
    const a = x0 + (L * i) / nv, e = x0 + (L * (i + 1)) / nv, dl = Math.hypot(e - a, h - 0.26);
    b.box((a + e) / 2, (0.1 + h) / 2 - 0.025, z, dl, 0.05, 0.04, m, { ...VG, rz: (i % 2 ? -1 : 1) * Math.atan2(h - 0.26, e - a), ao: false, uv: 'local' });
  }
  b.box(cx, 0.18, z, L - 0.1, h - 0.3, 0.02, 'chainlink', { ...KEIN, bullet: false, grad: false, ao: false, matOpts: null, cast: false });
  // Laufschiene am Boden + Laufrollen
  b.box(cx, 0, z, L + 3, 0.04, 0.12, 'metal_painted', { tint: '#3a3d40', ...VG, ao: false });
  for (const fx of [0.12, 0.88]) b.cyl(x0 + L * fx, 0.07, z, 0.07, 0.08, 'metal_painted', { axis: 'x', ry: Math.PI / 2, tint: '#2b2d30', ...KEIN, seg: 10 });
  // Schild in der Tormitte, lesbar von der Terminalseite (−z)
  if (o.sign) b.sign(cx, 1.25, z - 0.06, 1.6, 0.6, o.sign, { ry: Math.PI, depth: 0.02 });
}

/**
 * Steigleiter mit Rückenschutz an einer Stütze: Holme in (x, z ± 0,23) von y0 bis y1, Sprossen alle 0,33 m,
 * Rückenbügel ab 2,4 m (von der Stütze weg), Halter alle 3 m zur Stützenfläche bei faceX.
 */
export function steigleiter(b, x, z, y0, y1, faceX) {
  const m = 'metal_painted', T = { tint: '#e8c22c', ...VG, ao: false }, sx = Math.sign(x - faceX) || 1;
  for (const s of [-1, 1]) b.box(x, y0, z + s * 0.23, 0.05, y1 - y0, 0.05, m, T);
  for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.33) b.cyl(x, y, z, 0.016, 0.46, m, { ...T, axis: 'z' });
  // Rückenbügel (U aus drei Stäben) + vier senkrechte Korbstäbe
  for (let y = y0 + 2.4; y < y1 - 0.4; y += 1.1) {
    for (const s of [-1, 1]) b.box(x + sx * 0.36, y, z + s * 0.36, 0.72, 0.05, 0.04, m, T);
    b.box(x + sx * 0.72, y, z, 0.04, 0.05, 0.76, m, T);
  }
  for (const [dx, dz] of [[0.72, -0.25], [0.72, 0.25], [0.4, -0.36], [0.4, 0.36]]) b.box(x + sx * dx, y0 + 2.4, z + dz, 0.035, y1 - y0 - 2.8, 0.035, m, T);
  for (let y = y0 + 1.5; y < y1; y += 3) for (const s of [-1, 1]) b.box((faceX + x) / 2, y, z + s * 0.23, Math.abs(x - faceX) + 0.02, 0.06, 0.05, m, T);
}
