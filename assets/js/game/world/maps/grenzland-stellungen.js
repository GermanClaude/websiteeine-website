// NULLPUNKT — Grenzland: MG-Stellungen (Owner: world). Sandsack-Hufeisen mit Maschinengewehr auf Dreibein, an den
// Engstellen (Brückenköpfe, Ortseingang, Gehöft-Zufahrt, Kieswerk-Einfahrt, Funkhügel-Aufgang) mit Blick auf die
// Zugangswege. Statisch, Kollision unabhängig von der Grafikstufe; Platzierung ohne b.rand (nur die Sandsack-
// Unregelmäßigkeit aus props.sandbags nutzt den Ortschafts-Zufall wie jede andere Sandsackreihe).
import { frame, sandbags } from '../props.js';

/** Zylinder von Bodenpunkt G zu Punkt M (Welt), z. B. Dreibein-Bein. */
function strut(b, gx, gy, gz, mx, my, mz, r, mat, o = {}) {
  const dx = mx - gx, dy = my - gy, dz = mz - gz, L = Math.hypot(dx, dy, dz);
  b.cyl(gx, gy, gz, r, L, mat, { rx: Math.acos(Math.max(-1, Math.min(1, dy / L))), ry: Math.atan2(dx, dz), seg: 6, collide: false, minimap: false, ao: false, ...o });
}

/**
 * MG-Nest. (x, z) Mitte; o: { y (Boden), ry (Feuerrichtung = lokal +z), r (Innenradius 1,45), rows (Lagen, 5 ≈ 0,75 m) }
 * Sandsäcke doppelt, Hufeisen über ±135° (hinten ≈ 1,8 m offen als Zugang). Waffe: Gehäuse, Lauf mit Kühlmantel,
 * Mündung, Kolben, Griff, Gurtkasten links, Gurt; Dreibein (ein Bein vorn an der Brüstung, zwei hinten).
 * Kollision: Sandsack-Segmente (props.sandbags), Waffe + Dreibein als schmaler Quader ohne Kugelkollision.
 */
export function mgNest(b, x, z, o = {}) {
  const y = o.y ?? 0, ry = o.ry || 0, r = o.r ?? 1.45, rows = o.rows ?? 5;
  const f = frame(b, x, y, z, ry);
  // Hufeisen: Mittellinie der Doppelreihe auf R; Segmente beidseitig 0,2 m verlängert (überlappende Ecken)
  const R = r + 0.33, n = 6, a0 = -2.36, a1 = 2.36;
  const pts = [];
  for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; pts.push([Math.sin(a) * R, Math.cos(a) * R]); }
  for (let k = 0; k < n; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const [wx0, wz0] = f.P(ax - ux * 0.2, az - uz * 0.2), [wx1, wz1] = f.P(bx + ux * 0.2, bz + uz * 0.2);
    sandbags(b, wx0, wz0, wx1, wz1, { rows: k === 0 || k === n - 1 ? rows - 1 : rows, y, double: true });
  }
  // Waffe (zeigt lokal +z über die Brüstung)
  const gm = { collide: false, minimap: false }, gy = 0.94, zr = r - 0.62; // Gehäuse-Mitte
  f.box(0, gy - 0.075, zr, 0.11, 0.15, 0.56, 'gunmetal', { ...gm, grad: false });
  f.box(0, gy + 0.075, zr - 0.04, 0.1, 0.035, 0.38, 'gunmetal', { ...gm, grad: false, ao: false });
  f.cyl(0, gy + 0.01, zr + 0.48, 0.036, 0.42, 'gunmetal', { ...gm, axis: 'z', seg: 10 });
  for (let k = 0; k < 4; k++) f.cyl(0, gy + 0.01, zr + 0.34 + k * 0.08, 0.039, 0.02, 'black', { ...gm, axis: 'z', seg: 10, ao: false });
  f.cyl(0, gy + 0.01, zr + 0.86, 0.015, 0.36, 'gunmetal', { ...gm, axis: 'z', seg: 8 });
  f.cyl(0, gy + 0.01, zr + 1.06, 0.027, 0.08, 'gunmetal', { ...gm, axis: 'z', seg: 8, r1: 0.022 });
  f.box(0, gy + 0.07, zr + 0.62, 0.012, 0.05, 0.012, 'gunmetal', { ...gm, ao: false }); // Korn
  f.box(0, gy - 0.12, zr - 0.43, 0.06, 0.13, 0.32, 'wood_dark', { ...gm, tint: '#4a3426', grad: false, rx: 0.12 }); // Kolben
  f.box(0, gy - 0.22, zr - 0.18, 0.04, 0.15, 0.055, 'polymer', { ...gm, tint: '#1e1e1e', grad: false, rx: 0.3 });   // Griff
  f.box(-0.17, gy - 0.16, zr + 0.02, 0.1, 0.17, 0.25, 'metal_painted', { ...gm, tint: '#4b5a3a', grad: false });     // Gurtkasten
  f.box(-0.1, gy + 0.005, zr + 0.02, 0.1, 0.012, 0.055, 'metal_galvanized', { ...gm, tint: '#c8a24a', rz: -0.5, ao: false, grad: false }); // Gurt
  // Dreibein: Kopf unter dem Gehäuse
  const [hx, hz] = f.P(0, zr + 0.12), hy = y + gy - 0.17;
  for (const [lx, lz] of [[0, r - 0.05], [-0.42, zr - 0.55], [0.42, zr - 0.55]]) { const [px, pz] = f.P(lx, lz); strut(b, px, y, pz, hx, hy, hz, 0.018, 'gunmetal'); }
  f.cyl(0, gy - 0.2, zr + 0.12, 0.035, 0.05, 'gunmetal', { ...gm, seg: 8 });
  // Munitionskästen am Boden
  f.box(0.55, 0, zr - 0.7, 0.3, 0.19, 0.14, 'metal_painted', { ...gm, tint: '#4b5a3a', ry: 0.4 });
  f.box(0.62, 0.19, zr - 0.72, 0.3, 0.19, 0.14, 'metal_painted', { ...gm, tint: '#56653f', ry: 0.25 });
  f.solid(0, 0, zr + 0.15, 0.62, gy + 0.12, 1.5, { minimap: false, bullet: false });
  addEmplacement(b, f, y, zr, gy);
}

/**
 * Benutzbare MG-Stellung melden (game/mappoints.js): Platz des Schützen hinter der Waffe, Feuerrichtung, Höhe der Waffe.
 * b.emplacements sammelt sie je Bauabschnitt; loadWorld/bigworld hängen sie als world.emplacements an.
 */
export function addEmplacement(b, f, y, zr, gy) {
  const [ox, oz] = f.P(0, zr - 0.9), [gx, gz] = f.P(0, zr), [hx, hz] = f.P(0, zr + 1);
  const L = Math.hypot(hx - gx, hz - gz) || 1;
  (b.emplacements || (b.emplacements = [])).push({ kind: 'mg', x: ox, y, z: oz, gx, gz, gunY: y + gy, dx: (hx - gx) / L, dz: (hz - gz) / L, arc: (250 * Math.PI) / 180 });
}
