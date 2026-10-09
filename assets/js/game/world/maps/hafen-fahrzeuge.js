// NULLPUNKT — Hafen: Fahrzeuge aus Primitiven mit richtig gedrehten Rädern (Owner: world). Ersetzt auf der Hafenkarte
// forklift/truck/van/car aus props.js: Dort liegt die Radachse entlang der Fahrzeuglänge (Räder stehen quer).
// Hier: Achse lokal x (quer), Reifen berühren den Boden (Mitte = Radius), Doppelbereifung hinten, Felge + Nabe.
// Gabelstapler: Gabel abgestellt am Boden bzw. beladen auf Transporthöhe, Zinken stecken in der Palette.
// Sattelzug: Auflieger mit Abstand hinter der Kabine (vorher ragte er 0,6 m in die Kabine), Stützbeine paarweise.
// Kollision wie bisher als einfache Quader (unabhängig von Grafikstufe und Bibliothek).
import * as THREE from 'three';
import { frame, container, pallet, crateStack } from '../props.js';

const KEIN = { collide: false, minimap: false };
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

/**
 * Rad mit Achse quer zur Fahrtrichtung (lokal x). (lx, lz) Radmitte im Fahrzeugrahmen, Reifen steht auf ly − r.
 * side ±1: Außenseite (Felge zeigt nach außen), twin: Doppelbereifung (zweiter Reifen nach innen versetzt).
 */
export function rad(f, lx, lz, r, w, o = {}) {
  const side = Math.sign(lx) || 1, y = o.y ?? 0, rim = o.rim || '#9aa0a6';
  const n = o.twin ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const cx = lx - side * k * (w + 0.03);
    f.cyl(cx, y + r, lz, r, w, 'rubber', { axis: 'x', ...KEIN, seg: o.seg ?? 16, grad: false });
  }
  // Felge (außen etwas vorstehend) + Nabe
  f.cyl(lx + side * 0.012, y + r, lz, r * 0.58, w + 0.012, 'metal_painted', { axis: 'x', tint: rim, ...KEIN, seg: 12, ao: false });
  f.cyl(lx + side * (w / 2 + 0.02), y + r, lz, r * 0.2, 0.05, 'metal_galvanized', { axis: 'x', ...KEIN, seg: 8, ao: false });
}

/** Kotflügel (flaches Blech über einem Rad), Oberkante y, Länge len entlang z. */
function kotfluegel(f, lx, y, lz, w, len, tint) {
  f.box(lx, y - 0.04, lz, w, 0.04, len, 'metal_painted', { tint, ...KEIN, grad: false, ao: false });
}

/** Gabelstapler (lokal z = Fahrtrichtung, Gabel bei +z). o: { ry, color, load, forkY } */
export function stapler(b, x, z, o = {}) {
  const y0 = o.y ?? 0, f = frame(b, x, y0, z, o.ry || 0), col = o.color || '#e0a02a', dark = '#2b2d30';
  // Fahrgestell (schmal, zwischen den Rädern) + Aufbau: hinten über den Hinterrädern, vorn zwischen den Vorderrädern
  f.box(0, 0.16, -0.2, 0.68, 0.36, 1.9, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  f.box(0, 0.52, -0.5, 1.12, 0.55, 1.1, 'metal_painted', { tint: col, ...KEIN, grad: false });
  f.box(0, 0.52, 0.38, 0.66, 0.55, 0.66, 'metal_painted', { tint: col, ...KEIN, grad: false });
  // Gegengewicht (gerundet) hinten, Motorhaube mit Sitz
  f.cyl(0, 0.22, -1.05, 0.56, 0.85, 'metal_painted', { tint: dark, ...KEIN, arc: Math.PI, ry: Math.PI / 2, caps: true });
  f.box(0, 1.07, -0.6, 1.12, 0.06, 0.9, 'metal_painted', { tint: shade(col, 0.85), ...KEIN, grad: false, ao: false });
  f.box(0, 1.13, -0.45, 0.48, 0.12, 0.45, 'polymer', { tint: '#1e2023', ...KEIN, grad: false });
  f.box(0, 1.25, -0.68, 0.46, 0.5, 0.08, 'polymer', { tint: '#1e2023', ...KEIN, grad: false, rx: -0.12 });
  // Armaturenträger, Lenksäule, Lenkrad
  f.box(0, 1.07, 0.38, 0.66, 0.36, 0.3, 'metal_painted', { tint: col, ...KEIN, grad: false });
  f.cyl(0, 1.38, 0.3, 0.025, 0.28, 'metal_painted', { tint: dark, ...KEIN, seg: 6, ao: false, rx: 0.55 });
  const lenk = new THREE.TorusGeometry(0.17, 0.02, 6, 14);
  f.geom(lenk, 0, 1.64, 0.17, 'polymer', { tint: '#1e2023', rx: -1.0, ...KEIN });
  lenk.dispose();
  // Räder: vorn Antrieb (groß, mit Kotflügel), hinten Lenkachse unter dem Gegengewicht
  for (const sx of [-1, 1]) {
    rad(f, sx * 0.47, 0.42, 0.33, 0.24, { rim: '#c8c8c0' });
    rad(f, sx * 0.44, -0.86, 0.26, 0.2, { rim: '#c8c8c0' });
    kotfluegel(f, sx * 0.47, 0.8, 0.42, 0.3, 0.74, col);
  }
  // Fahrerschutzdach: hintere Pfosten auf der Haube, vordere auf den Kotflügeln
  for (const sx of [-0.5, 0.5]) {
    f.box(sx, 1.07, -0.82, 0.06, 1.13, 0.06, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx, 0.8, 0.3, 0.06, 1.4, 0.06, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  }
  f.box(0, 2.2, -0.26, 1.1, 0.05, 1.24, 'metal_grate', { ...KEIN, grad: false });
  f.box(0, 2.25, -0.86, 0.18, 0.08, 0.18, 'lamp_warm', { ...KEIN, ao: false, cast: false });
  // Hubmast (zwei Profile, Querhaupt oben, Hubzylinder in der Mitte)
  for (const sx of [-0.32, 0.32]) f.box(sx, 0.06, 0.8, 0.1, 2.36, 0.12, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  f.box(0, 2.3, 0.8, 0.74, 0.1, 0.12, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  f.cyl(0, 0.3, 0.76, 0.05, 1.7, 'metal_galvanized', { ...KEIN, seg: 8 });
  // Gabelträger + zwei L-förmige Zinken (Spitze bei lz 2,05): abgestellt am Boden, beladen auf Transporthöhe;
  // Zinken bei ±0,19 m laufen zwischen den Kufen der Europalette
  const fy = o.forkY ?? (o.load ? 0.2 : 0.02);
  f.box(0, fy + 0.12, 0.89, 0.86, 0.42, 0.06, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  for (const sx of [-0.19, 0.19]) {
    f.box(sx, fy, 0.92, 0.12, 0.62, 0.05, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx, fy, 1.5, 0.12, 0.045, 1.1, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  }
  // Kollision: Fahrzeug mit Mast (Zinken flach, ohne Kollision)
  f.solid(0, 0, -0.2, 1.2, 2.3, 2.1, { minimap: 'vehicle' });
  // Last: Palette steckt auf den Zinken (Zinken zwischen Boden- und Deckbrettern, vor dem Gabelrücken)
  if (o.load) { const [px, pz] = f.P(0, 1.56); pallet(b, px, y0 + fy - 0.035, pz, { ry: (o.ry || 0) + Math.PI / 2, load: o.load }); }
}

/** Sattelzug / Lkw. trailer: 'container'|'box'|'flatbed'|null. Lokal z = Länge, Kabine bei +z. */
export function lkw(b, x, z, o = {}) {
  const y = o.y ?? 0, f = frame(b, x, y, z, o.ry || 0), col = o.color || '#c8402f', dark = '#26282b';
  const cabZ = o.trailer === null ? 2.2 : 5.6;
  // Kabine (Unterkante über den Vorderrädern), Windschutzscheibe, Seitenfenster, Grill, Stoßfänger, Dachspoiler
  f.box(0, 0.95, cabZ, 2.45, 2.05, 2.2, 'metal_painted', { tint: col, ...KEIN, grad: false });
  f.box(0, 1.85, cabZ + 1.11, 2.2, 0.85, 0.02, 'glass', { ...KEIN, ao: false });
  for (const sx of [-1, 1]) f.box(sx * 1.235, 1.9, cabZ + 0.55, 0.02, 0.75, 0.9, 'glass', { ...KEIN, ao: false });
  f.box(0, 1.0, cabZ + 1.13, 1.4, 0.55, 0.04, 'metal_galvanized', { ...KEIN, ao: false });
  f.box(0, 0.48, cabZ + 1.15, 2.45, 0.38, 0.16, 'polymer', { ...KEIN, grad: false });
  f.box(0, 3.0, cabZ - 0.2, 2.3, 0.4, 1.6, 'metal_painted', { tint: shade(col, 0.9), ...KEIN, grad: false });
  for (const sx of [-1, 1]) f.box(sx * 0.95, 0.65, cabZ + 1.18, 0.32, 0.14, 0.04, 'lamp_warm', { ...KEIN, ao: false, cast: false });
  // Einstieg (zwei Trittstufen je Seite) + Spiegel
  for (const sx of [-1, 1]) {
    for (const k of [0, 1]) f.box(sx * 1.16, 0.42 + k * 0.32, cabZ + 0.55, 0.16, 0.04, 0.5, 'metal_tread', { ...KEIN, grad: false, ao: false });
    f.box(sx * 1.36, 1.9, cabZ + 0.95, 0.05, 0.42, 0.2, 'polymer', { tint: '#1e2023', ...KEIN, grad: false, ao: false });
  }
  // Fahrgestell: Längsträger, Sattelkupplung, Tanks, Kotflügel
  f.box(0, 0.62, cabZ - 1.6, 1.0, 0.3, 5.0, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  f.box(0, 0.92, cabZ - 2.6, 1.3, 0.1, 1.1, 'metal_painted', { tint: '#3a3d40', ...KEIN, grad: false });
  for (const sx of [-1, 1]) f.cyl(sx * 0.82, 0.68, cabZ - 1.25, 0.27, 1.1, 'metal_galvanized', { axis: 'z', ...KEIN });
  // Räder: Vorderachse einzeln, Antriebsachse doppelt bereift
  for (const sx of [-1, 1]) {
    rad(f, sx * 1.0, cabZ + 0.2, 0.52, 0.36);
    rad(f, sx * 1.02, cabZ - 2.6, 0.52, 0.3, { twin: true });
    kotfluegel(f, sx * 0.88, 1.16, cabZ - 2.6, 0.7, 1.3, '#2b2d30');
  }
  f.solid(0, 0, cabZ, 2.5, 3.4, 2.4, { minimap: 'vehicle' });
  f.solid(0, 0, cabZ - 2.6, 2.5, 1.15, 2.9, { minimap: false });
  if (o.trailer === null) return;
  // Auflieger: Vorderkante 0,5 m hinter der Kabine, Königszapfen über der Sattelkupplung
  const tl = 12.2, front = cabZ - 1.1 - 0.5, tz = front - tl / 2;
  const tt = o.trailer || 'box';
  f.box(0, 1.05, tz, 2.5, 0.25, tl, 'metal_painted', { tint: '#3a3d40', ...KEIN, grad: false });
  // Dreiachs-Aggregat hinten (doppelt bereift), Unterfahrschutz seitlich + hinten
  for (const sx of [-1, 1]) for (const k of [0, 1, 2]) rad(f, sx * 1.02, tz - tl / 2 + 1.4 + k * 1.3, 0.5, 0.28, { twin: true });
  for (const sx of [-1, 1]) f.box(sx * 1.18, 0.55, tz + 1.5, 0.04, 0.12, 5.6, 'metal_painted', { tint: '#c9c4b8', ...KEIN, grad: false, ao: false });
  f.box(0, 0.45, tz - tl / 2 + 0.08, 2.3, 0.14, 0.1, 'metal_painted', { tint: '#c9c4b8', ...KEIN, grad: false, ao: false });
  for (const sx of [-1, 1]) f.box(sx * 0.9, 1.25, tz - tl / 2 + 0.03, 0.3, 0.12, 0.04, 'lamp_red', { ...KEIN, ao: false, cast: false });
  // Stützbeine (eingefahren: Füße 0,25 m über dem Boden, Kurbel außen)
  for (const sx of [-0.9, 0.9]) {
    f.box(sx, 0.32, front - 2.6, 0.12, 0.73, 0.12, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx, 0.25, front - 2.6, 0.24, 0.07, 0.3, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
  }
  f.box(1.0, 0.75, front - 2.6, 0.04, 0.04, 0.3, 'metal_galvanized', { ...KEIN, ao: false });
  if (tt === 'container') {
    const [cx, cz] = f.P(0, tz);
    container(b, cx, y + 1.3, cz, { len: 12.19, ry: (o.ry || 0) + Math.PI / 2, color: o.containerColor, logo: o.logo, minimap: 'vehicle' });
  } else if (tt === 'box') {
    f.box(0, 1.3, tz, 2.5, 2.7, tl, 'metal_corrugated', { tint: o.boxColor || '#d8d8d2', minimap: 'vehicle', grad: false, uv: 'local' });
    if (o.logo) for (const s of [1, -1]) { const [lx, lz] = f.P(s * 1.26, tz); b.sign(lx, y + 2.0, lz, 7, 1.4, o.logo, { ry: (o.ry || 0) + s * Math.PI / 2, back: false, depth: 0 }); }
  } else if (tt === 'flatbed') {
    const [cx, cz] = f.P(0, tz - 2), [px, pz] = f.P(0.3, tz + 2.5);
    crateStack(b, cx, cz, { ry: o.ry, y: y + 1.3 });
    pallet(b, px, y + 1.3, pz, { ry: o.ry, load: 'wrapped' });
  }
  f.solid(0, 0, tz, 2.5, 1.3, tl, { minimap: false });
}

/** Lieferwagen / Transporter (lokal z = Länge, Front bei +z). */
export function transporter(b, x, z, o = {}) {
  const y = o.y ?? 0, f = frame(b, x, y, z, o.ry || 0), col = o.color || '#e8e6e0';
  const L = 5.2, W = 2.0;
  // Aufbau mit Radausschnitten: Unterkante 0,45 (über den Reifen), Schweller tiefer zwischen den Achsen
  f.box(0, 0.45, -0.35, W, 1.95, L - 0.8, 'metal_painted', { tint: col, ...KEIN, grad: false });
  f.box(0, 0.45, L / 2 - 0.6, W - 0.02, 0.98, 1.2, 'metal_painted', { tint: col, ...KEIN, grad: false });
  f.box(0, 0.28, 0, W - 0.06, 0.2, 2.2, 'metal_painted', { tint: shade(col, 0.8), ...KEIN, grad: false });
  f.wedge(0, 1.43, L / 2 - 0.85, W - 0.04, 0.8, 0.72, 'glass', { ry: Math.PI, ...KEIN });
  for (const sx of [-1, 1]) f.box(sx * (W / 2 + 0.005), 1.45, L / 2 - 1.55, 0.02, 0.6, 0.8, 'glass', { ...KEIN, ao: false });
  f.box(0, 0.32, L / 2 + 0.03, W, 0.22, 0.1, 'polymer', { ...KEIN, grad: false });
  f.box(0, 0.32, -L / 2 + 0.02, W, 0.2, 0.1, 'polymer', { ...KEIN, grad: false });
  for (const sx of [-1, 1]) {
    f.box(sx * 0.72, 0.7, L / 2 + 0.005, 0.3, 0.12, 0.04, 'lamp_warm', { ...KEIN, ao: false, cast: false });
    f.box(sx * 0.86, 1.0, -L / 2 + 0.02, 0.14, 0.3, 0.04, 'lamp_red', { ...KEIN, ao: false, cast: false });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rad(f, sx * (W / 2 - 0.14), sz * 1.7, 0.36, 0.24);
  if (o.logo) { const [lx, lz] = f.P(W / 2 + 0.01, -0.6); b.sign(lx, y + 1.0, lz, 2.4, 0.8, o.logo, { ry: (o.ry || 0) + Math.PI / 2, back: false, depth: 0 }); }
  f.solid(0, 0, 0, W, 2.4, L, { minimap: 'vehicle' });
}

/** PKW (lokal z = Länge): abgedecktes Auto aus der Bibliothek, sonst prozedural mit richtig gedrehten Rädern. */
export function pkw(b, x, z, o = {}) {
  const y = o.y ?? 0, col = o.color || '#3b3d40';
  const proc = (bb) => {
    const f = frame(bb, x, y, z, o.ry || 0), L = 4.3, W = 1.8, pm = 'metal_painted';
    f.box(0, 0.32, 0, W, 0.52, L, pm, { tint: col, ...KEIN, grad: false });
    f.wedge(0, 0.84, L / 2 - 0.65, W - 0.04, 0.08, 1.2, pm, { ry: Math.PI, tint: col, ...KEIN });
    f.box(0, 0.84, -0.15, W - 0.16, 0.5, 2.1, 'glass', { ...KEIN, grad: false });
    f.box(0, 1.32, -0.15, W - 0.2, 0.06, 1.85, pm, { tint: col, ...KEIN, grad: false });
    f.box(0, 0.3, L / 2 + 0.03, W - 0.05, 0.18, 0.1, 'polymer', { ...KEIN, grad: false });
    f.box(0, 0.3, -L / 2 - 0.03, W - 0.05, 0.18, 0.1, 'polymer', { ...KEIN, grad: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rad(f, sx * (W / 2 - 0.12), sz * 1.35, 0.32, 0.22, { rim: '#b8bcc0' });
  };
  if (b.hasModel('covered_car') && o.model !== false) b.model('covered_car', x, y, z, { ry: o.ry || 0, collide: false, fallback: proc });
  else proc(b);
  // Kollision in festen Maßen (gleich mit und ohne Bibliothek)
  frame(b, x, y, z, o.ry || 0).solid(0, 0, 0, 1.8, 1.42, 4.3, { minimap: 'vehicle' });
  b.decal(x, y + 0.01, z, 2.6, 4.6, 'oil', { ry: o.ry || 0, opacity: 0.5 });
}
