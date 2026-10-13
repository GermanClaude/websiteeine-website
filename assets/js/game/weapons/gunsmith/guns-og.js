// Waffen der ersten Stunde (Nutzer 13.10.2026: „eine eigene Waffe, die es nur für sie gibt – einzigartig, nicht
// überstark“): UR-1 Ursprung (Karabiner), P-0 Funke (Pistole), Erstlicht (Dolch). Schwarz mit polierten Goldakzenten
// und dem Nullpunkt-Zeichen (Goldscheibe mit dunklem Ring). Griffpunkte/Teile wie bei den bewährten Bauarten, damit
// Hände, Nachladen und Animationen passen.
import { redDot, brake } from './parts.js';
import { arLower, arMag } from './guns-ar.js';
import { p9, P9 } from './guns-pistol.js';

/** Nullpunkt-Zeichen seitlich (x = Außenfläche, beide Seiten): Goldscheibe mit dunklem Ring. */
function emblem(b, x, v, u, r = 0.009, part) {
  if (!b.hi) return;
  for (const s of [-1, 1]) {
    b.cyl('goldTrim', r, r, 0.0012, s * (x + 0.0006), v, u, { axis: 'x', seg: 20, part });
    b.torus('polymer', r * 0.56, r * 0.13, s * (x + 0.0013), v, u, { ry: Math.PI / 2, tseg: 20, part });
  }
}

export function ursprung(b) {
  const axis = 0.093;
  arLower(b, { lowerMat: 'polymer', upperMat: 'alu', gripMat: 'grip', axis });
  // Schlanker runder Handschutz mit Fenstern und drei Goldringen
  b.lathe('alu', [[0, 0.0238], [0.196, 0.0238], [0.202, 0.021], [0.202, 0.011]], 0, axis, 0.118, { seg: b.seg(18, 8) });
  b.rail('alu', 0, axis + 0.0236, 0.12, 0.3);
  if (b.hi) {
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.box('cavity', 0.0012, 0.009, 0.026, s * 0.0234, axis - 0.002, 0.15 + i * 0.04, { c: 0 });
    for (const u of [0.122, 0.21, 0.317]) b.torus('goldTrim', 0.0242, 0.0017, 0, axis, u, { tseg: 24 });
  }
  // Lauf, goldener Ring, Mündungsbremse
  b.cyl('steelDark', 0.0094, 0.0094, 0.05, 0, axis, 0.338, { seg: b.seg(14, 6) });
  if (b.hi) b.torus('goldTrim', 0.0123, 0.0018, 0, axis, 0.362, { tseg: 20 });
  const end = brake(b, 0.362, axis, 0.0122, 0.05);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Fester Schaft mit Wangenauflage und Daumenaussparung, goldene Linie an der Schaftkappe
  b.side('polymer', [
    [-0.165, 0.112], [-0.205, 0.124], [-0.27, 0.126], [-0.282, 0.118], [-0.282, 0.0], [-0.27, -0.01], [-0.248, -0.006],
    [-0.215, 0.038], [-0.182, 0.068], [-0.165, 0.08],
  ], 0.032, 0, { bevel: 0.004, bevelSeg: 2, holes: [[[-0.256, 0.032], [-0.214, 0.064], [-0.206, 0.1], [-0.262, 0.106]]] });
  b.box('rubber', 0.034, 0.128, 0.012, 0, 0.058, -0.288, { c: 0.004 });
  if (b.hi) b.box('goldTrim', 0.035, 0.128, 0.0018, 0, 0.058, -0.2815, { c: 0 });
  emblem(b, 0.0135, 0.026, 0.087);
  redDot(b, 0.0, 0.124);
  arMag(b, 'smoke');
  b.anchor('leftHandGrip', 0, axis - 0.024, 0.232, { data: { style: 'under', r: 0.024 } });
  b.meta = { sight: 'reddot', axis, kind: 'rifle' };
}

export function funke(b) {
  p9(b);
  const { axis, top, bottom, front: uF, hw } = P9;
  const mid = (top + bottom) / 2;
  // Goldener Kompensator vor dem Schlitten (fest am Rahmen), Mündung nach vorn verlegt
  b.box('goldTrim', hw * 2 + 0.0007, top - bottom + 0.0042, 0.026, 0, mid + 0.0004, uF + 0.0148, { c: 0.003 });
  if (b.hi) for (const u of [uF + 0.007, uF + 0.017]) b.box('cavity', 0.012, 0.001, 0.005, 0, top + 0.0025, u, { c: 0 });
  b.bore(0.0048, 0, axis, uF + 0.0281);
  b.anchor('muzzle', 0, axis, uF + 0.0298);
  // Goldlinie längs am Schlitten, goldenes Korn, Fenster oben im Schlitten
  if (b.hi) {
    for (const s of [-1, 1]) b.box('goldTrim', 0.0008, 0.0022, 0.1, s * (hw + 0.0003), top - 0.0045, 0.06, { part: 'slide', c: 0 });
    b.box('goldTrim', 0.0034, 0.0042, 0.0062, 0, top + 0.0021, uF - 0.0128, { part: 'slide', c: 0.0008 });
    for (let i = 0; i < 3; i++) b.box('cavity', 0.009, 0.001, 0.008, 0, top + 0.0003, 0.074 + i * 0.013, { part: 'slide', c: 0 });
  }
  emblem(b, hw + 0.0001, mid, 0.014, 0.0062, 'slide');
}

export function erstlicht(b) {
  // Dolch: zweischneidig mit Mittelgrat, goldene Parierstange, Goldringe am Griff, goldener Knauf. Klinge nach vorn (+u).
  const ring = [];
  const nr = b.hi ? 6 : 1;
  ring.push([-0.056, 0.0], [-0.056, 0.0122]);
  for (let i = 0; i < nr; i++) { const u = -0.052 + i * (0.1 / nr); ring.push([u + 0.003, 0.0138], [u + 0.1 / nr - 0.004, 0.0138], [u + 0.1 / nr - 0.001, 0.0125]); }
  ring.push([0.05, 0.0128], [0.052, 0.0]);
  b.lathe('rubber', ring, 0, 0, 0, { seg: b.seg(14, 6), sx: 0.8 });
  if (b.hi) for (const u of [-0.03, 0.03]) b.torus('goldTrim', 0.0124, 0.0014, 0, 0, u, { tseg: 18, sx: 0.8 });
  b.lathe('goldTrim', [[0, 0], [0, 0.0135], [0.004, 0.0146], [0.011, 0.0128], [0.014, 0.0]], 0, 0, -0.07, { seg: b.seg(12, 6), sx: 0.8 });
  b.box('goldTrim', 0.014, 0.074, 0.009, 0, 0, 0.058, { c: 0.0025 });
  // Klinge
  b.part('blade', 0, 0, 0);
  b.side('blade', [[0.062, 0.0145], [0.2, 0.0115], [0.262, 0.0], [0.2, -0.0115], [0.062, -0.0145]], 0.0042, 0, { part: 'blade', bevel: 0.0016 });
  b.side('bladeCoat', [[0.066, 0.0062], [0.19, 0.0046], [0.236, 0.0], [0.19, -0.0046], [0.066, -0.0062]], 0.0052, 0, { part: 'blade', bevel: 0.0012 });
  if (b.hi) for (const s of [-1, 1]) b.box('goldTrim', 0.0006, 0.0016, 0.1, s * 0.0027, 0, 0.13, { part: 'blade', c: 0 });
  b.anchor('muzzle', 0, 0, 0.255);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0 } });
  b.meta = { sight: 'none', kind: 'melee' };
}
