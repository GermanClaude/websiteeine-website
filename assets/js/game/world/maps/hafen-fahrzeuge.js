// NULLPUNKT — Hafen: Fahrzeuge aus Primitiven mit richtig gedrehten Rädern (Owner: world). Ersetzt auf der Hafenkarte
// forklift/truck/van/car aus props.js: Dort liegt die Radachse entlang der Fahrzeuglänge (Räder stehen quer).
// Hier: Achse lokal x (quer), Reifen berühren den Boden (Mitte = Radius), Doppelbereifung hinten, Felge + Nabe.
// Gabelstapler: Gabel abgestellt am Boden bzw. beladen auf Transporthöhe, Zinken stecken in der Palette.
// Sattelzug: Auflieger mit Abstand hinter der Kabine (vorher ragte er 0,6 m in die Kabine), Stützbeine paarweise.
// Kollision wie bisher als einfache Quader (unabhängig von Grafikstufe und Bibliothek).
import * as THREE from 'three';
import { frame, container, pallet, crateStack, civilSpot, staplerLast } from '../props.js';

const KEIN = { collide: false, minimap: false };
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

const radGeo = new Map();
/** Reifen (gedrehtes Profil mit runder Schulter) und Felgenschüssel, Achse lokal x, Mitte im Ursprung (gecacht). */
function radGeometrie(r, w, low = false) {
  const key = r.toFixed(3) + ':' + w.toFixed(3) + (low ? ':lo' : '');
  if (radGeo.has(key)) return radGeo.get(key);
  const ri = r * 0.64, h = w / 2;
  const tire = new THREE.LatheGeometry([
    [ri, -h + 0.01], [r * 0.9, -h], [r - 0.012, -h + 0.025], [r, -h + 0.055], [r, h - 0.055], [r - 0.012, h - 0.025], [r * 0.9, h], [ri, h - 0.01],
  ].map(([a, b]) => new THREE.Vector2(a, b)), low ? 12 : 16);
  tire.rotateZ(Math.PI / 2);
  // Felge: Schüssel (außen etwas eingezogen), Ring, Nabe
  const rim = new THREE.LatheGeometry([
    [0.001, h - 0.06], [r * 0.18, h - 0.06], [r * 0.22, h - 0.035], [r * 0.5, h - 0.04], [r * 0.58, h - 0.02], [ri + 0.005, h - 0.012], [ri + 0.005, -h + 0.03],
  ].map(([a, b]) => new THREE.Vector2(a, b)), low ? 10 : 14);
  rim.rotateZ(-Math.PI / 2); // Profilhöhe → +x (Außenseite)
  const g = { tire, rim };
  radGeo.set(key, g);
  return g;
}

/**
 * Rad mit Achse quer zur Fahrtrichtung (lokal x). (lx, lz) Radmitte im Fahrzeugrahmen, Reifen steht auf ly − r.
 * side ±1: Außenseite (Felge zeigt nach außen), twin: Doppelbereifung (zweiter Reifen nach innen versetzt).
 * Reifen mit runder Schulter, Felgenschüssel mit Lüftungslöchern und Radmuttern.
 */
export function rad(f, lx, lz, r, w, o = {}) {
  const side = Math.sign(lx) || 1, y = o.y ?? 0, rim = o.rim || '#9aa0a6', low = f.b?.quality === 'low';
  const n = o.twin ? 2 : 1;
  const { tire, rim: rimG } = radGeometrie(r, w, low);
  for (let k = 0; k < n; k++) {
    const cx = lx - side * k * (w + 0.03);
    f.geom(tire, cx, y + r, lz, 'rubber', { ...KEIN, grad: false, uv: 'world' });
  }
  // Felgenschüssel zur Außenseite (Profil liegt bei +x → für die linke Seite spiegeln über ry = π)
  f.geom(rimG, lx, y + r, lz, 'metal_painted', { tint: rim, ...KEIN, grad: false, ao: false, ry: side > 0 ? 0 : Math.PI, uv: 'world' });
  const fx = lx + side * (w / 2 - 0.035);
  f.cyl(fx, y + r, lz, r * 0.17, 0.05, 'metal_galvanized', { axis: 'x', ...KEIN, seg: 8, ao: false, cast: false });
  // Radmuttern + Lüftungslöcher: kein Schatten; auf „niedrig“ weggelassen (je Rad ~450 Dreiecke)
  if (low) return;
  const nn = r > 0.45 ? 8 : 5;
  for (let i = 0; i < nn; i++) {
    const a = (i / nn) * Math.PI * 2;
    f.cyl(fx + side * 0.01, y + r + Math.sin(a) * r * 0.27, lz + Math.cos(a) * r * 0.27, 0.016, 0.03, 'metal_galvanized', { axis: 'x', ...KEIN, seg: 6, ao: false, cast: false });
    const b2 = a + Math.PI / nn;
    f.cyl(fx - side * 0.012, y + r + Math.sin(b2) * r * 0.42, lz + Math.cos(b2) * r * 0.42, r * 0.06, 0.012, 'black', { axis: 'x', ...KEIN, seg: 8, ao: false, cast: false });
  }
}

/** Kotflügel (flaches Blech über einem Rad), Oberkante y, Länge len entlang z. */
function kotfluegel(f, lx, y, lz, w, len, tint) {
  f.box(lx, y - 0.04, lz, w, 0.04, len, 'metal_painted', { tint, ...KEIN, grad: false, ao: false });
}

/** Gabelstapler (lokal z = Fahrtrichtung, Gabel bei +z). o: { ry, color, load, forkY } */
export function stapler(b, x, z, o = {}) {
  // Nutzer 16.10.: fahrbar (vehicles/models-civil.js, Palette mit Last auf der Gabel) – hier nur der Stellplatz
  if (o.drivable !== false && civilSpot(b, 'stapler', x, o.y ?? 0, z, o.ry || 0, o.color || '#e0a02a', staplerLast(o.load))) return;
  const y0 = o.y ?? 0, f = frame(b, x, y0, z, o.ry || 0), col = o.color || '#e0a02a', dark = '#2b2d30';
  // Nutzer 15.10.: Fahrzeuge „absolut undetailliert“ → Aufbau aus dem Seitenprofil (gerundete Haube, Fußraum,
  // Armaturenträger, Radläufe), dunkles Gussgegengewicht, Treibgasflasche, Schutzdach mit Streben, Hubmast mit
  // Innen-/Außenprofilen, Ketten, Neigezylindern, Arbeitsscheinwerfern und Rundumleuchte
  const prof = [[-1.2, 0.2], ...radlauf(-0.86, 0.26, 0.31, 0.2, 6), ...radlauf(0.42, 0.33, 0.38, 0.2, 6), [0.72, 0.2], [0.74, 0.92],
    [0.6, 1.08], [0.34, 1.1], [0.27, 0.62], [-0.12, 0.6], [-0.17, 1.02], [-0.26, 1.13], [-1.06, 1.15], [-1.24, 1.02], [-1.3, 0.62], [-1.26, 0.3]];
  const body = profilKoerper(prof, 1.12, 0.06);
  f.geom(body, 0, 0, 0, 'car_paint', { tint: col, ...KEIN, grad: false, uv: 'world' });
  body.dispose();
  const cw = profilKoerper([[-1.33, 0.18], [-0.95, 0.18], [-0.95, 0.98], [-1.2, 1.0], [-1.33, 0.86]], 1.16, 0.07);
  f.geom(cw, 0, 0, 0, 'metal_painted', { tint: dark, ...KEIN, grad: false, uv: 'world' });
  cw.dispose();
  f.box(0, 0.12, -0.2, 0.62, 0.12, 1.8, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
  f.box(0, 0.6, 0.07, 0.86, 0.02, 0.36, 'metal_tread', { ...KEIN, grad: false, ao: false });
  // Treibgasflasche quer hinten auf dem Gegengewicht (Halter + Ventil)
  f.cyl(0, 1.33, -1.0, 0.15, 0.78, 'metal_painted', { axis: 'x', tint: '#c9cdd0', ...KEIN, seg: 12 });
  for (const sx of [-0.3, 0.3]) f.box(sx, 1.14, -1.0, 0.04, 0.2, 0.3, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
  f.cyl(0.42, 1.33, -1.0, 0.03, 0.08, 'metal_galvanized', { axis: 'x', ...KEIN, seg: 6, ao: false });
  // Fahrersitz (Polster + Lehne + Hüftgurt), Armaturenträger mit Hebeln, Lenksäule, Lenkrad mit Knauf
  f.box(0, 1.13, -0.48, 0.5, 0.11, 0.46, 'polymer', { tint: '#1e2023', ...KEIN, grad: false });
  f.box(0, 1.22, -0.72, 0.48, 0.56, 0.1, 'polymer', { tint: '#1e2023', ...KEIN, grad: false, rx: -0.14 });
  f.box(0.24, 1.26, -0.5, 0.03, 0.05, 0.2, 'polymer', { tint: '#b8392c', ...KEIN, grad: false, ao: false });
  for (let k = 0; k < 3; k++) {
    f.cyl(0.18 + k * 0.07, 1.1, 0.4, 0.01, 0.2, 'metal_galvanized', { ...KEIN, seg: 5, ao: false });
    f.cyl(0.18 + k * 0.07, 1.3, 0.4, 0.025, 0.04, 'polymer', { tint: k === 0 ? '#b8392c' : '#1e2023', ...KEIN, seg: 6, ao: false });
  }
  f.cyl(0, 1.08, 0.33, 0.035, 0.4, 'metal_painted', { tint: dark, ...KEIN, seg: 6, ao: false, rx: 0.5 });
  const lenk = new THREE.TorusGeometry(0.17, 0.02, 6, 14);
  f.geom(lenk, 0, 1.5, 0.22, 'polymer', { tint: '#1e2023', rx: -1.05, ...KEIN });
  lenk.dispose();
  f.cyl(0.12, 1.52, 0.17, 0.018, 0.06, 'polymer', { tint: '#1e2023', ...KEIN, seg: 6, ao: false });
  // Räder: vorn Antrieb (groß, mit Kotflügel), hinten Lenkachse unter dem Gegengewicht
  for (const sx of [-1, 1]) {
    rad(f, sx * 0.47, 0.42, 0.33, 0.24, { rim: '#c8c8c0' });
    rad(f, sx * 0.44, -0.86, 0.26, 0.2, { rim: '#c8c8c0' });
    kotfluegel(f, sx * 0.5, 0.82, 0.42, 0.3, 0.74, col);
  }
  // Fahrerschutzdach: hintere Pfosten auf der Haube, vordere auf dem Armaturenträger, Dach aus Rahmen + Querstreben
  for (const sx of [-0.5, 0.5]) {
    f.box(sx, 1.13, -0.86, 0.07, 1.05, 0.07, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx, 1.08, 0.42, 0.07, 1.1, 0.07, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx, 2.15, -0.22, 0.07, 0.07, 1.36, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx * 1.04, 2.0, 0.47, 0.08, 0.1, 0.06, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
    flaeche(f, [[sx * 1.04 - 0.035, 2.01, 0.501], [sx * 1.04 + 0.035, 2.01, 0.501], [sx * 1.04 + 0.035, 2.09, 0.501], [sx * 1.04 - 0.035, 2.09, 0.501]], 'lamp_lens', { cast: false });
  }
  for (const zz of [-0.86, 0.42]) f.box(0, 2.15, zz, 1.07, 0.07, 0.07, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  for (let k = 1; k < 6; k++) f.box(0, 2.16, -0.86 + k * 0.213, 1.0, 0.04, 0.035, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
  f.cyl(-0.38, 2.22, -0.8, 0.07, 0.12, 'lamp_orange', { ...KEIN, seg: 10, ao: false, cast: false });
  f.cyl(-0.38, 2.34, -0.8, 0.072, 0.012, 'polymer', { tint: '#1e2023', ...KEIN, seg: 10, ao: false });
  // Hubmast: Außenprofile (U), Innenprofile, Querhäupter, Hubzylinder mit Kettenrollen und Ketten, Neigezylinder
  for (const sx of [-1, 1]) {
    f.box(sx * 0.34, 0.08, 0.8, 0.08, 2.3, 0.14, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx * 0.26, 0.14, 0.82, 0.07, 2.2, 0.1, 'metal_painted', { tint: shade(dark, 1.25), ...KEIN, grad: false });
    f.box(sx * 0.12, 0.3, 0.86, 0.025, 1.92, 0.018, 'metal_painted', { tint: '#1a1b1d', ...KEIN, grad: false, ao: false, cast: false });
    f.cyl(sx * 0.12, 2.25, 0.82, 0.07, 0.05, 'metal_galvanized', { axis: 'x', ...KEIN, seg: 10, ao: false });
    f.cyl(sx * 0.38, 0.62, 0.48, 0.045, 0.42, 'metal_galvanized', { axis: 'z', ...KEIN, seg: 8, ao: false });
    f.cyl(sx * 0.38, 0.62, 0.3, 0.06, 0.2, 'metal_painted', { axis: 'z', tint: dark, ...KEIN, seg: 8, ao: false });
  }
  for (const yy of [0.12, 1.2, 2.3]) f.box(0, yy, 0.8, 0.76, 0.08, 0.1, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  f.cyl(0, 0.3, 0.74, 0.055, 1.9, 'metal_galvanized', { ...KEIN, seg: 8 });
  // Gabelträger + zwei L-förmige Zinken (Spitze bei lz 2,05): abgestellt am Boden, beladen auf Transporthöhe;
  // Zinken bei ±0,19 m laufen zwischen den Kufen der Europalette
  const fy = o.forkY ?? (o.load ? 0.2 : 0.02);
  f.box(0, fy + 0.12, 0.89, 0.86, 0.42, 0.06, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  for (const yy of [0.14, 0.44]) f.box(0, fy + yy, 0.93, 0.9, 0.08, 0.04, 'metal_painted', { tint: shade(dark, 1.3), ...KEIN, grad: false, ao: false });
  for (let k = -2; k <= 2; k++) f.box(k * 0.2, fy + 0.54, 0.9, 0.03, 0.62, 0.03, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
  f.box(0, fy + 1.14, 0.9, 0.86, 0.04, 0.04, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
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
  const W = 2.45, hw = W / 2 + 0.004, fz = cabZ + 1.17;
  // Nutzer 16.10.: Zugmaschine fahrbar (vehicles/models-civil.js) – ohne Auflieger an der Kabinenstelle, sonst 0,6 m vor
  // dem auf seinen Stützen abgestellten Auflieger (Kabinenmitte 2,05 m vor ihrem Ursprung, Heck 3,05 m dahinter)
  const parked = o.drivable !== false && typeof b.civil === 'function';
  if (parked) {
    const [tx, tz] = f.P(0, o.trailer === null ? cabZ - 2.05 : cabZ - 1.6 + 0.6 + 3.05);
    civilSpot(b, 'zugmaschine', tx, y, tz, o.ry || 0, col);
    if (o.trailer === null) return;
  } else {
    // Frontlenker-Kabine aus dem Seitenprofil (runde Kanten, leicht geneigte Front, Scheibe schräg, Dach mit Absatz)
    const cab = profilKoerper([[-1.1, 0.95], [1.1, 0.95], [1.17, 1.08], [1.18, 1.58], [1.14, 1.66], [0.99, 2.6], [0.84, 2.86], [-1.0, 2.9], [-1.1, 2.8]].map(([zz, yy]) => [zz + cabZ, yy]), W, 0.11);
    f.geom(cab, 0, 0, 0, 'car_paint', { tint: col, ...KEIN, grad: false, uv: 'world' });
    cab.dispose();
    // Frontscheibe (zweiteilig mit Mittelsteg), Seitenfenster mit schräger Vorderkante, Sonnenblende
    flaeche(f, [[-1.06, 1.7, cabZ + 1.146], [1.06, 1.7, cabZ + 1.146], [0.98, 2.55, cabZ + 1.01], [-0.98, 2.55, cabZ + 1.01]], 'glass');
    f.box(0, 1.7, cabZ + 1.085, 0.05, 0.86, 0.04, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false, rx: -0.16 });
    for (const sd of [-1, 1]) flaeche(f, [[sd * hw, 1.72, cabZ + 0.1], [sd * hw, 1.72, cabZ + 1.06], [sd * hw, 2.5, cabZ + 0.92], [sd * hw, 2.5, cabZ + 0.1]], 'glass');
    f.box(0, 2.6, cabZ + 1.02, W - 0.1, 0.08, 0.32, 'polymer', { tint: dark, ...KEIN, grad: false, rx: 0.25 });
    // Grill mit Lamellen + Markenplakette, Stoßfänger mit Scheinwerfern und Blinkern
    f.box(0, 1.08, cabZ + 1.2, 1.7, 0.5, 0.03, 'polymer', { tint: '#141516', ...KEIN, grad: false, ao: false });
    for (let k = 0; k < 5; k++) f.box(0, 1.11 + k * 0.095, cabZ + 1.222, 1.64, 0.028, 0.02, 'metal_painted', { tint: shade(col, 0.55), ...KEIN, grad: false, ao: false });
    f.box(0, 1.6, cabZ + 1.19, 0.42, 0.1, 0.02, 'metal_galvanized', { ...KEIN, ao: false });
    f.box(0, 0.42, fz + 0.04, W + 0.04, 0.52, 0.22, 'polymer', { tint: '#2a2c2f', ...KEIN, grad: false });
    for (const sd of [-1, 1]) {
      flaeche(f, [[sd * 0.72, 0.7, fz + 0.155], [sd * 1.08, 0.7, fz + 0.155], [sd * 1.08, 0.88, fz + 0.155], [sd * 0.72, 0.88, fz + 0.155]], 'lamp_lens', { cast: false });
      f.box(sd * 1.14, 0.7, fz + 0.15, 0.08, 0.18, 0.02, 'lamp_orange', { ...KEIN, ao: false, cast: false });
    }
    f.box(0, 0.5, fz + 0.165, 0.52, 0.11, 0.01, 'white', { tint: '#f2f2ee', ...KEIN, grad: false, ao: false });
    // Türen (Fugen, Griff), Einstieg (zwei Trittstufen), Spiegel an Armen (Haupt- + Weitwinkelspiegel), Druckluftfanfare
    for (const sd of [-1, 1]) {
      for (const zz of [cabZ + 0.06, cabZ + 1.08]) f.box(sd * (W / 2 + 0.006), 1.0, zz, 0.008, 1.55, 0.012, 'polymer', { tint: '#0e0f10', ...KEIN, grad: false, ao: false, cast: false });
      f.box(sd * (W / 2 + 0.02), 1.55, cabZ + 0.25, 0.03, 0.05, 0.22, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false });
      for (const k of [0, 1]) f.box(sd * 1.1, 0.4 + k * 0.3, cabZ - 0.68, 0.26, 0.04, 0.5, 'metal_painted', { tint: '#3a3d40', ...KEIN, grad: false, ao: false });
      f.box(sd * 1.2, 0.36, cabZ - 0.68, 0.03, 0.6, 0.5, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
      f.box(sd * 1.3, 2.38, cabZ + 1.0, 0.2, 0.04, 0.04, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false });
      f.box(sd * 1.3, 1.72, cabZ + 1.0, 0.2, 0.04, 0.04, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false });
      f.box(sd * 1.42, 1.72, cabZ + 0.98, 0.05, 0.7, 0.04, 'metal_galvanized', { ...KEIN, ao: false });
      f.box(sd * 1.46, 1.86, cabZ + 0.96, 0.08, 0.46, 0.24, 'polymer', { tint: '#1e2023', ...KEIN, grad: false });
      f.box(sd * 1.46, 1.58, cabZ + 0.96, 0.07, 0.2, 0.18, 'polymer', { tint: '#1e2023', ...KEIN, grad: false });
      // Radlauf vorn (dunkle Radhausschale unter der Kabine)
      f.box(sd * 0.85, 0.62, cabZ + 0.2, 0.5, 0.36, 1.25, 'polymer', { tint: '#151617', ...KEIN, grad: false, ao: false });
    }
    f.cyl(0.5, 2.92, cabZ + 0.5, 0.05, 0.12, 'metal_galvanized', { ...KEIN, seg: 6, ao: false });
    // Windleitblech auf dem Dach (nach vorn geneigt, gerundet)
    const spoiler = profilKoerper([[-0.9, 2.84], [0.62, 2.84], [0.3, 3.32], [-0.9, 3.36]].map(([zz, yy]) => [zz + cabZ, yy]), 2.3, 0.07);
    f.geom(spoiler, 0, 0, 0, 'car_paint', { tint: shade(col, 0.92), ...KEIN, grad: false, uv: 'world' });
    spoiler.dispose();
    // Fahrgestell: Längsträger, Sattelkupplung, Tanks (Diesel + AdBlue), Luftkessel, Seitenverkleidung, Auspuff
    f.box(0, 0.62, cabZ - 1.6, 1.0, 0.3, 5.0, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(0, 0.92, cabZ - 2.6, 1.3, 0.1, 1.1, 'metal_painted', { tint: '#3a3d40', ...KEIN, grad: false });
    f.cyl(-0.82, 0.68, cabZ - 1.35, 0.3, 1.1, 'metal_galvanized', { axis: 'z', ...KEIN, seg: 14 });
    f.cyl(0.82, 0.62, cabZ - 1.55, 0.2, 0.55, 'polymer', { axis: 'z', tint: '#2f5a8a', ...KEIN, seg: 12 });
    f.cyl(0.82, 0.62, cabZ - 1.05, 0.14, 0.35, 'metal_painted', { axis: 'z', tint: '#3a3d40', ...KEIN, seg: 10 });
    f.cyl(1.05, 1.0, cabZ - 1.22, 0.07, 2.25, 'metal_galvanized', { ...KEIN, seg: 10 });
    f.cyl(1.05, 3.2, cabZ - 1.22, 0.075, 0.08, 'black', { ...KEIN, seg: 10, ao: false });
    // Räder: Vorderachse einzeln, Antriebsachse doppelt bereift, Kotflügel + Schmutzfänger hinten
    for (const sx of [-1, 1]) {
      rad(f, sx * 1.0, cabZ + 0.2, 0.52, 0.36);
      rad(f, sx * 1.02, cabZ - 2.6, 0.52, 0.3, { twin: true });
      kotfluegel(f, sx * 0.88, 1.16, cabZ - 2.6, 0.7, 1.3, '#2b2d30');
      f.box(sx * 0.88, 0.18, cabZ - 3.3, 0.66, 0.85, 0.02, 'rubber', { ...KEIN, grad: false, ao: false });
    }
    f.solid(0, 0, cabZ, 2.5, 3.4, 2.4, { minimap: 'vehicle' });
    f.solid(0, 0, cabZ - 2.6, 2.5, 1.15, 2.9, { minimap: false });
    if (o.trailer === null) return;
  }
  // Auflieger: Vorderkante 0,5 m hinter der Kabine, Königszapfen über der Sattelkupplung
  const tl = 12.2, front = cabZ - 1.1 - 0.5, tz = front - tl / 2;
  const tt = o.trailer || 'box';
  f.box(0, 1.05, tz, 2.5, 0.25, tl, 'metal_painted', { tint: '#3a3d40', ...KEIN, grad: false });
  // Dreiachs-Aggregat hinten (doppelt bereift), Unterfahrschutz seitlich + hinten
  for (const sx of [-1, 1]) for (const k of [0, 1, 2]) rad(f, sx * 1.02, tz - tl / 2 + 1.4 + k * 1.3, 0.5, 0.28, { twin: true });
  for (const sx of [-1, 1]) f.box(sx * 1.18, 0.55, tz + 1.5, 0.04, 0.12, 5.6, 'metal_painted', { tint: '#c9c4b8', ...KEIN, grad: false, ao: false });
  f.box(0, 0.45, tz - tl / 2 + 0.08, 2.3, 0.14, 0.1, 'metal_painted', { tint: '#c9c4b8', ...KEIN, grad: false, ao: false });
  for (const sx of [-1, 1]) {
    f.box(sx * 0.9, 1.08, tz - tl / 2 - 0.01, 0.36, 0.14, 0.04, 'lamp_redlens', { ...KEIN, ao: false, cast: false });
    f.box(sx * 0.62, 1.08, tz - tl / 2 - 0.01, 0.12, 0.14, 0.04, 'lamp_orange', { ...KEIN, ao: false, cast: false });
  }
  f.box(0, 1.0, tz - tl / 2 - 0.02, 0.52, 0.11, 0.01, 'white', { tint: '#f2f2ee', ...KEIN, grad: false, ao: false });
  // Stützbeine: abgestellt bis zum Boden, angekuppelt eingefahren (Füße 0,25 m über dem Boden); Kurbel außen
  for (const sx of [-0.9, 0.9]) {
    f.box(sx, parked ? 0.07 : 0.32, front - 2.6, 0.12, parked ? 0.98 : 0.73, 0.12, 'metal_painted', { tint: dark, ...KEIN, grad: false });
    f.box(sx, parked ? 0 : 0.25, front - 2.6, 0.24, 0.07, 0.3, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
  }
  f.box(1.0, 0.75, front - 2.6, 0.04, 0.04, 0.3, 'metal_galvanized', { ...KEIN, ao: false });
  if (tt === 'container') {
    const [cx, cz] = f.P(0, tz);
    container(b, cx, y + 1.3, cz, { len: 12.19, ry: (o.ry || 0) + Math.PI / 2, color: o.containerColor, logo: o.logo, minimap: 'vehicle' });
  } else if (tt === 'box') {
    // Koffer: glatte Paneele mit Profilen, Ober-/Untergurt, Hecktüren mit Verschlussstangen, Leuchten
    const bc = o.boxColor || '#d8d8d2';
    f.box(0, 1.3, tz, 2.5, 2.7, tl, 'metal_painted', { tint: bc, minimap: 'vehicle', grad: false, uv: 'local' });
    for (let k = -tl / 2 + 0.6; k < tl / 2 - 0.3; k += 0.62) for (const sd of [-1, 1]) f.box(sd * 1.258, 1.35, tz + k, 0.018, 2.6, 0.07, 'metal_painted', { tint: shade(bc, 0.92), ...KEIN, grad: false, ao: false });
    for (const yy of [1.3, 3.92]) for (const sd of [-1, 1]) f.box(sd * 1.262, yy, tz, 0.03, 0.08, tl + 0.02, 'metal_galvanized', { ...KEIN, ao: false });
    const rz = tz - tl / 2 - 0.012;
    f.box(0, 1.34, rz, 0.02, 2.56, 0.012, 'polymer', { tint: '#202224', ...KEIN, grad: false, ao: false, cast: false });
    for (const xx of [-0.95, -0.35, 0.35, 0.95]) {
      f.cyl(xx, 1.36, rz - 0.03, 0.022, 2.5, 'metal_galvanized', { ...KEIN, seg: 6, ao: false });
      f.box(xx + (xx > 0 ? -0.12 : 0.12), 1.9, rz - 0.04, 0.26, 0.05, 0.04, 'metal_galvanized', { ...KEIN, ao: false });
    }
    for (const sd of [-1, 1]) for (const yy of [1.6, 2.6, 3.6]) f.box(sd * 1.2, yy, rz - 0.02, 0.1, 0.16, 0.03, 'metal_galvanized', { ...KEIN, ao: false });
    for (let k = -tl / 2 + 1; k < tl / 2; k += 3) for (const sd of [-1, 1]) f.box(sd * 1.27, 1.2, tz + k, 0.02, 0.05, 0.08, 'lamp_orange', { ...KEIN, ao: false, cast: false });
    if (o.logo) for (const s of [1, -1]) { const [lx, lz] = f.P(s * 1.26, tz); b.sign(lx, y + 2.0, lz, 7, 1.4, o.logo, { ry: (o.ry || 0) + s * Math.PI / 2, back: false, depth: 0 }); }
  } else if (tt === 'flatbed') {
    const [cx, cz] = f.P(0, tz - 2), [px, pz] = f.P(0.3, tz + 2.5);
    crateStack(b, cx, cz, { ry: o.ry, y: y + 1.3 });
    pallet(b, px, y + 1.3, pz, { ry: o.ry, load: 'wrapped' });
  }
  f.solid(0, 0, tz, 2.5, 1.3, tl, { minimap: false });
}

/** Kotflügel als gebogenes Blech (Bogen um die Radmitte zc/yc, Radius R, Breite w) an der Seite lx. */
function bogenBlech(f, lx, zc, yc, R, w, tint) {
  const sh = new THREE.Shape(), n = 10, a0 = 0.2, a1 = Math.PI - 0.2, t = 0.06;
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); (i ? sh.lineTo : sh.moveTo).call(sh, zc + Math.cos(a) * (R + t), yc + Math.sin(a) * (R + t)); }
  for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / n); sh.lineTo(zc + Math.cos(a) * R, yc + Math.sin(a) * R); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2); g.translate(w / 2, 0, 0);
  f.geom(g, lx, 0, 0, 'metal_painted', { tint, ...KEIN, grad: false, uv: 'world' });
  g.dispose();
}

/** Schräger Träger (Quader) von (za, ya) nach (zb, yb) entlang lokal z, Unterkante auf der Verbindungslinie. */
function traeger(f, lx, za, ya, zb, yb, w, h, mat, o = {}) {
  const L = Math.hypot(zb - za, yb - ya), rx = -Math.atan2(yb - ya, zb - za);
  f.box(lx, (ya + yb) / 2, (za + zb) / 2, w, h, L, mat, { ...KEIN, grad: false, ...o, rx });
}

/** Schräger Zylinder (Hydraulik) von (za, ya) nach (zb, yb). */
function zylinder(f, lx, za, ya, zb, yb, r, mat, o = {}) {
  const L = Math.hypot(zb - za, yb - ya), rx = Math.atan2(zb - za, yb - ya);
  f.cyl(lx, ya, za, r, L, mat, { ...KEIN, seg: 10, ...o, rx });
}

/**
 * Containerstapler (Reachstacker), lokal z = vorn (Ausleger + Spreader bei +z), hält einen 20-Fuß-Container knapp über
 * dem Boden. Nutzer 15.10.: Fahrzeuge „absolut undetailliert“ → Fahrgestell, Gussgegengewicht, Motorhaube mit
 * Lüftungsschlitzen, verglaste Kabine mit Dach, Leiter, Rundumleuchte, Teleskopausleger mit Hubzylindern, Spreader mit
 * Twistlock-Ecken, große Räder mit Kotflügeln. Kollision wie bisher.
 */
export function containerstapler(b, x, z, ry) {
  const f = frame(b, x, 0, z, ry), yel = '#e0a02a', dark = '#2b2d30';
  const body = profilKoerper([[-4.1, 0.55], [3.5, 0.55], [3.65, 0.8], [3.6, 1.5], [3.15, 1.72], [-3.2, 1.72], [-4.1, 1.5]], 2.0, 0.08);
  f.geom(body, 0, 0, 0, 'car_paint', { tint: yel, ...KEIN, grad: false, uv: 'world' });
  body.dispose();
  const cw = profilKoerper([[-4.35, 0.6], [-3.2, 0.6], [-3.2, 2.62], [-3.85, 2.68], [-4.35, 2.3]], 2.9, 0.1);
  f.geom(cw, 0, 0, 0, 'metal_painted', { tint: dark, ...KEIN, grad: false, uv: 'world' });
  cw.dispose();
  const hood = profilKoerper([[-3.2, 1.7], [-1.3, 1.7], [-1.3, 2.45], [-1.5, 2.62], [-3.2, 2.62]], 2.3, 0.08);
  f.geom(hood, 0, 0, 0, 'car_paint', { tint: yel, ...KEIN, grad: false, uv: 'world' });
  hood.dispose();
  for (const sd of [-1, 1]) for (let k = 0; k < 7; k++) f.box(sd * 1.153, 1.95 + (k % 2) * 0.28, -2.95 + Math.floor(k / 2) * 0.42 + 0.2, 0.01, 0.06, 0.34, 'black', { ...KEIN, ao: false, cast: false });
  for (const sd of [-1, 1]) {
    f.box(sd * 0.95, 1.2, -4.36, 0.32, 0.16, 0.03, 'lamp_redlens', { ...KEIN, ao: false, cast: false });
    f.box(sd * 0.55, 1.2, -4.36, 0.14, 0.16, 0.03, 'lamp_orange', { ...KEIN, ao: false, cast: false });
  }
  // Räder: vorn Antriebsachse (breit), hinten Lenkachse, gebogene Kotflügel
  for (const sd of [-1, 1]) {
    rad(f, sd * 1.42, 2.4, 0.82, 0.7, { rim: '#c9a227' });
    rad(f, sd * 1.36, -2.3, 0.78, 0.6, { rim: '#c9a227' });
    bogenBlech(f, sd * 1.42, 2.4, 0.82, 0.9, 0.78, yel);
    bogenBlech(f, sd * 1.36, -2.3, 0.82, 0.86, 0.68, yel);
  }
  // Kabine rechts, erhöht: Rahmen aus dem Profil, Glas rundum, Dach, Leiter, Spiegel, Rundumleuchte, Arbeitsscheinwerfer
  const cx = 0.78;
  const cab = profilKoerper([[-1.2, 1.75], [0.55, 1.75], [0.7, 3.0], [0.55, 3.85], [-1.2, 3.9]], 1.45, 0.06);
  f.geom(cab, cx, 0, 0, 'car_paint', { tint: yel, ...KEIN, grad: false, uv: 'world' });
  cab.dispose();
  const zl = (y) => 0.55 + 0.15 * (y - 1.75) / 1.25 + 0.012, zu = (y) => 0.7 - 0.15 * (y - 3.0) / 0.85 + 0.012;
  flaeche(f, [[cx - 0.62, 2.2, zl(2.2)], [cx + 0.62, 2.2, zl(2.2)], [cx + 0.62, 2.96, zl(2.96)], [cx - 0.62, 2.96, zl(2.96)]], 'glass');
  flaeche(f, [[cx - 0.62, 3.04, zu(3.04)], [cx + 0.62, 3.04, zu(3.04)], [cx + 0.6, 3.74, zu(3.74)], [cx - 0.6, 3.74, zu(3.74)]], 'glass');
  for (const sd of [-1, 1]) flaeche(f, [[cx + sd * 0.729, 2.3, -1.05], [cx + sd * 0.729, 2.3, 0.45], [cx + sd * 0.729, 3.72, 0.45], [cx + sd * 0.729, 3.72, -1.05]], 'glass');
  flaeche(f, [[cx - 0.6, 2.5, -1.204], [cx + 0.6, 2.5, -1.204], [cx + 0.6, 3.72, -1.204], [cx - 0.6, 3.72, -1.204]], 'glass');
  f.box(cx, 3.88, -0.3, 1.6, 0.1, 1.95, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  f.cyl(cx + 0.5, 3.98, -1.0, 0.09, 0.15, 'lamp_orange', { ...KEIN, seg: 10, ao: false, cast: false });
  for (const sd of [-1, 1]) {
    f.box(cx + sd * 0.55, 3.86, 0.62, 0.16, 0.1, 0.08, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false });
    flaeche(f, [[cx + sd * 0.55 - 0.07, 3.87, 0.661], [cx + sd * 0.55 + 0.07, 3.87, 0.661], [cx + sd * 0.55 + 0.07, 3.95, 0.661], [cx + sd * 0.55 - 0.07, 3.95, 0.661]], 'lamp_lens', { cast: false });
  }
  for (let k = 0; k < 4; k++) f.box(cx + 0.8, 0.7 + k * 0.32, -0.4, 0.06, 0.04, 0.5, 'metal_galvanized', { ...KEIN, ao: false });
  for (const zz of [-0.66, -0.14]) f.box(cx + 0.82, 0.62, zz, 0.04, 1.2, 0.04, 'metal_galvanized', { ...KEIN, ao: false });
  f.box(cx + 0.95, 3.0, 0.5, 0.05, 0.4, 0.22, 'polymer', { tint: '#1e2023', ...KEIN, grad: false });
  // Teleskopausleger links neben der Kabine: Lagerbock hinten, Außen- + Innenrohr, zwei Hubzylinder
  const bx = -0.42, za = -2.6, ya = 2.95, zb = 6.6, yb = 3.72;
  f.box(bx, 1.7, za, 1.1, 1.3, 0.7, 'metal_painted', { tint: yel, ...KEIN, grad: false });
  traeger(f, bx, za, ya, 2.4, ya + (yb - ya) * (5.0 / 9.2), 0.86, 1.02, 'car_paint', { tint: yel });
  traeger(f, bx, 2.2, ya + (yb - ya) * (4.8 / 9.2) + 0.08, zb + 0.3, yb + 0.1, 0.7, 0.82, 'car_paint', { tint: shade(yel, 0.94) });
  for (const sd of [-1, 1]) {
    zylinder(f, bx + sd * 0.55, 0.3, 1.6, 2.4, 3.25, 0.13, 'metal_painted', { tint: yel });
    zylinder(f, bx + sd * 0.55, 1.2, 2.35, 2.9, 3.55, 0.07, 'metal_galvanized');
  }
  // Spreader: Rotator, Längsträger, Querhäupter an beiden Enden mit Twistlock-Ecken, Warnstreifen
  f.box(bx + 0.12, 3.15, zb, 0.7, 0.56, 0.7, 'metal_painted', { tint: dark, ...KEIN, grad: false });
  f.box(-0.3, 2.75, zb, 0.62, 0.42, 6.0, 'metal_painted', { tint: '#d9a72a', ...KEIN, grad: false });
  for (const sz of [-1, 1]) {
    f.box(-0.3, 2.72, zb + sz * 2.95, 2.5, 0.4, 0.3, 'metal_painted', { tint: '#d9a72a', ...KEIN, grad: false });
    for (const sx of [-1, 1]) f.box(-0.3 + sx * 1.1, 2.6, zb + sz * 2.95, 0.22, 0.14, 0.24, 'metal_painted', { tint: dark, ...KEIN, grad: false, ao: false });
    f.box(-0.3, 3.12, zb + sz * 2.95, 2.3, 0.01, 0.08, 'hazard', { ...KEIN, grad: false, ao: false, cast: false });
  }
  const [px, pz] = f.P(-0.3, zb);
  container(b, px, 0.12, pz, { len: 6.06, ry: ry + Math.PI / 2, color: '#c8402f', minimap: 'container' });
  f.solid(0, 0, -0.5, 3.4, 4.1, 7.6, { minimap: 'vehicle' });
}

/**
 * Karosserie aus einem Seitenprofil (Punkte [z, y] gegen den Uhrzeigersinn, Front bei +z), über die Breite W extrudiert
 * und an den Kanten gerundet (Fase nach innen: Außenkontur = Profil) – statt Quadern: Motorhaube, schräge Frontscheibe, runde Dachkanten, Radläufe.
 */
function profilKoerper(pts, W, bevel = 0.05) {
  const sh = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: W - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateY(-Math.PI / 2);
  g.translate(W / 2 - bevel, 0, 0);
  return g;
}

/** Radlauf: Bogen (Mitte zc, Radius R) in einem Profil, das auf der Unterkante y0 läuft (vorwärts = +z). */
function radlauf(zc, yc, R, y0, n = 8) {
  const a0 = Math.asin(Math.max(-1, Math.min(1, (y0 - yc) / R)));
  const out = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI - a0 - (Math.PI - 2 * a0) * (i / n); out.push([zc + R * Math.cos(a), yc + R * Math.sin(a)]); }
  return out;
}

/** Ebenes Vieleck (Fenster, Leuchten) aus lokalen Punkten [x, y, z], beidseitig sichtbar. */
function flaeche(f, pts, mat, o = {}) {
  const pos = [];
  for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1], pts[0], pts[i + 1], pts[i]]) pos.push(...q);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  f.geom(g, 0, 0, 0, mat, { ...KEIN, ao: false, grad: false, ...o });
  g.dispose();
}

/** Lieferwagen / Transporter (Kastenwagen, lokal z = Länge, Front bei +z): gerundete Karosserie mit Haube, schräger
 *  Frontscheibe, Radläufen, Seitenfenster, Schiebetür, Hecktüren, Kunststoffleisten, Scheinwerfer, Grill, Spiegel. */
export function transporter(b, x, z, o = {}) {
  if (o.drivable !== false && civilSpot(b, 'transporter', x, o.y ?? 0, z, o.ry || 0, o.color || '#e8e6e0')) return;
  const y = o.y ?? 0, f = frame(b, x, y, z, o.ry || 0), col = o.color || '#e8e6e0', dark = '#1e2023';
  const L = 5.2, W = 2.0, rw = 0.36, zr = -1.55, zf = 1.75, y0 = 0.46;
  const prof = [[-2.6, y0], ...radlauf(zr, rw, 0.46, y0), ...radlauf(zf, rw, 0.46, y0), [2.52, y0], [2.6, 0.62], [2.62, 0.98],
    [2.48, 1.14], [1.86, 1.3], [1.22, 2.22], [1.02, 2.38], [-2.48, 2.42], [-2.6, 2.3]];
  const body = profilKoerper(prof, W, 0.06);
  f.geom(body, 0, 0, 0, 'car_paint', { tint: col, ...KEIN, grad: false, uv: 'world' });
  body.dispose();
  const hw = W / 2 + 0.004;
  // Glas: Frontscheibe, Seitenfenster Fahrerhaus, Heckscheiben (dunkel getönt)
  flaeche(f, [[-0.86, 1.36, 1.829], [0.86, 1.36, 1.829], [0.82, 2.17, 1.266], [-0.82, 2.17, 1.266]], 'glass');
  for (const s of [-1, 1]) flaeche(f, [[s * hw, 1.4, 0.98], [s * hw, 1.4, 1.74], [s * hw, 2.1, 1.25], [s * hw, 2.1, 0.98]], 'glass');
  for (const s of [-1, 1]) flaeche(f, [[s * 0.08, 1.55, -2.604], [s * 0.86, 1.55, -2.604], [s * 0.86, 2.12, -2.604], [s * 0.08, 2.12, -2.604]], 'glass');
  // Kunststoffleisten unten rundum, Stoßfänger, Grill mit Lamellen, Scheinwerfer, Blinker, Nummernschilder
  for (const s of [-1, 1]) f.box(s * (W / 2 + 0.01), 0.47, 0.1, 0.03, 0.16, 2.2, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false });
  f.box(0, 0.36, L / 2 + 0.04, W + 0.04, 0.3, 0.16, 'polymer', { tint: dark, ...KEIN, grad: false });
  f.box(0, 0.36, -L / 2 - 0.03, W + 0.02, 0.26, 0.12, 'polymer', { tint: dark, ...KEIN, grad: false });
  f.box(0, 0.74, L / 2 + 0.02, 0.9, 0.26, 0.04, 'polymer', { tint: '#111214', ...KEIN, grad: false, ao: false });
  for (const k of [0, 1, 2]) f.box(0, 0.77 + k * 0.075, L / 2 + 0.045, 0.86, 0.018, 0.02, 'metal_painted', { tint: '#4a4d52', ...KEIN, grad: false, ao: false });
  for (const s of [-1, 1]) {
    flaeche(f, [[s * 0.52, 0.86, 2.632], [s * 0.88, 0.86, 2.612], [s * 0.86, 1.04, 2.57], [s * 0.54, 1.02, 2.6]], 'lamp_lens', { cast: false });
    f.box(s * 0.9, 0.52, L / 2 + 0.1, 0.12, 0.05, 0.02, 'lamp_orange', { ...KEIN, ao: false, cast: false });
    f.box(s * 0.9, 0.95, -L / 2 - 0.015, 0.14, 0.42, 0.03, 'lamp_redlens', { ...KEIN, ao: false, cast: false });
  }
  f.box(0, 0.42, L / 2 + 0.125, 0.52, 0.11, 0.01, 'white', { tint: '#f2f2ee', ...KEIN, grad: false, ao: false });
  f.box(0, 0.62, -L / 2 - 0.02, 0.52, 0.11, 0.01, 'white', { tint: '#f2f2ee', ...KEIN, grad: false, ao: false });
  // Fugen: Fahrertür, Schiebetür rechts (mit Laufschiene), Hecktüren-Mittelfuge, Griffe, Tankdeckel
  const fuge = (s, zz, y1, y2) => f.box(s * (W / 2 + 0.006), y1, zz, 0.008, y2 - y1, 0.012, 'polymer', { tint: '#0e0f10', ...KEIN, grad: false, ao: false, cast: false });
  for (const s of [-1, 1]) { fuge(s, 0.95, 0.62, 2.2); fuge(s, 1.98, 0.62, 1.3); f.box(s * (W / 2 + 0.02), 1.22, 1.0, 0.03, 0.04, 0.18, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false }); }
  fuge(1, -0.6, 0.62, 2.18); fuge(1, 0.9, 0.62, 2.18);
  f.box(W / 2 + 0.012, 2.2, -0.75, 0.02, 0.03, 1.9, 'metal_painted', { tint: '#3a3d40', ...KEIN, grad: false, ao: false });
  f.box(W / 2 + 0.02, 1.2, -0.45, 0.03, 0.04, 0.2, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false });
  f.box(0, 0.62, -L / 2 - 0.005, 0.012, 1.68, 0.01, 'polymer', { tint: '#0e0f10', ...KEIN, grad: false, ao: false, cast: false });
  f.box(-(W / 2 + 0.008), 1.05, -1.0, 0.01, 0.12, 0.16, 'metal_painted', { tint: shade(col, 0.85), ...KEIN, grad: false, ao: false });
  // Außenspiegel (Arm + Gehäuse + Glas), Scheibenwischer
  for (const s of [-1, 1]) {
    f.box(s * (W / 2 + 0.08), 1.62, 1.72, 0.16, 0.04, 0.04, 'polymer', { tint: dark, ...KEIN, grad: false, ao: false });
    f.box(s * (W / 2 + 0.2), 1.5, 1.7, 0.1, 0.32, 0.18, 'polymer', { tint: dark, ...KEIN, grad: false });
    f.box(-0.02 * s + s * 0.35, 1.37, 1.86, 0.62, 0.02, 0.025, 'polymer', { tint: '#0e0f10', ...KEIN, grad: false, ao: false, ry: s * 0.1 });
  }
  // Radhausschalen (dunkel, hinter den Rädern), Räder
  for (const zz of [zr, zf]) f.box(0, y0, zz, W - 0.3, 0.36, 0.86, 'polymer', { tint: '#151617', ...KEIN, grad: false, ao: false });
  for (const sx of [-1, 1]) for (const zz of [zr, zf]) rad(f, sx * (W / 2 - 0.15), zz, rw, 0.24, { rim: '#aab0b6' });
  if (o.logo) { const [lx, lz] = f.P(W / 2 + 0.015, -0.9); b.sign(lx, y + 1.0, lz, 2.6, 0.8, o.logo, { ry: (o.ry || 0) + Math.PI / 2, back: false, depth: 0 }); }
  f.solid(0, 0, 0, W, 2.4, L, { minimap: 'vehicle' });
}

/** PKW (lokal z = Länge): fahrbare Limousine (Nutzer 16.10.: kein abgedecktes Auto mehr), sonst prozedural. */
export function pkw(b, x, z, o = {}) {
  const y = o.y ?? 0, col = o.color || '#3b3d40';
  if (o.drivable !== false && civilSpot(b, 'pkw', x, y, z, o.ry || 0, col)) { b.decal(x, y + 0.01, z, 2.6, 4.6, 'oil', { ry: o.ry || 0, opacity: 0.5 }); return; }
  const proc = (bb) => {
    const f = frame(bb, x, y, z, o.ry || 0), L = 4.3, W = 1.8, pm = 'car_paint';
    f.box(0, 0.32, 0, W, 0.52, L, pm, { tint: col, ...KEIN, grad: false });
    f.wedge(0, 0.84, L / 2 - 0.65, W - 0.04, 0.08, 1.2, pm, { ry: Math.PI, tint: col, ...KEIN });
    f.box(0, 0.84, -0.15, W - 0.16, 0.5, 2.1, 'glass', { ...KEIN, grad: false });
    f.box(0, 1.32, -0.15, W - 0.2, 0.06, 1.85, pm, { tint: col, ...KEIN, grad: false });
    f.box(0, 0.3, L / 2 + 0.03, W - 0.05, 0.18, 0.1, 'polymer', { ...KEIN, grad: false });
    f.box(0, 0.3, -L / 2 - 0.03, W - 0.05, 0.18, 0.1, 'polymer', { ...KEIN, grad: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rad(f, sx * (W / 2 - 0.12), sz * 1.35, 0.32, 0.22, { rim: '#b8bcc0' });
  };
  proc(b);
  // Kollision in festen Maßen (gleich mit und ohne Bibliothek)
  frame(b, x, y, z, o.ry || 0).solid(0, 0, 0, 1.8, 1.42, 4.3, { minimap: 'vehicle' });
  b.decal(x, y + 0.01, z, 2.6, 4.6, 'oil', { ry: o.ry || 0, opacity: 0.5 });
}
