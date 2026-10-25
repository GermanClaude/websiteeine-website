// Polymer-Baukasten (25.10.2026, gemeinsamer Baukasten G12 – zuerst für die QX-90/P90, danach Kunststoffwaffen wie
// Keiler (UMP45), Wespe (MP7), K-36 (G36C) und BX-20 (AUG)): Bauteile, die bei gespritzten Kunststoffgehäusen immer wieder
// vorkommen. Koordinaten wie im Bauplan: x quer (rechts +), v hoch, u nach vorn (Meter).
//   hexScrew(b, mat, x, v, u, o)        – Innensechskantschraube bündig in einer Senkung (Kopf, Kuppe, Sechskant, Fase)
//   roundRect2(du, dv, hu, hv, r)       – 2D-Feld gerundetes Rechteck (Taschen, Fenster, Schlitze im Distanzfeld)
//   slot2(u, v, u0, u1, vc, hr)         – 2D-Feld Langloch (Riemenschlitz, Auswurf)
//   pocket(d, d2, x, hw, depth)         – flache Tasche in einer Seitenfläche (beidseitig) abziehen
//   boss(d, d2, x, hw, h, r)            – flache Erhebung auf einer Seitenfläche (beidseitig) anfügen
//   smokeBox(b, mat, o)                 – durchscheinender Magazinkörper als gerundeter Kasten (Wand außen, Kanten gerundet)
//   gridBand(f, a0, a1, b0, b1, step)   – 2D-Feld vorrechnen wie grid2D, exakt aber nur im Band um die Nulllinie
//                                          (große Silhouetten mit vielen Punkten: ≈ ⅓ der Auswertungen)
import { extrudeRound, smin } from './sdf.js';

const dome = (r, h) => [[0, 0], [0, r], [h * 0.35, r * 0.96], [h * 0.75, r * 0.7], [h, 0]];

/** 2D-Feld: gerundetes Rechteck um (0, 0), Halbmaße hu, hv, Eckradius r. */
export const roundRect2 = (du, dv, hu, hv, r) => { const qx = Math.abs(du) - hu + r, qy = Math.abs(dv) - hv + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
/** 2D-Feld: Langloch von u0 bis u1 auf Höhe vc, halbe Breite hr (runde Enden). */
export const slot2 = (u, v, u0, u1, vc, hr) => Math.hypot(u - Math.max(u0 + hr, Math.min(u1 - hr, u)), v - vc) - hr;
/** Flache Tasche (Tiefe depth) in beide Seitenflächen (halbe Breite hw) im Bereich d2 < 0 abziehen. */
export const pocket = (d, d2, x, hw, depth) => Math.max(d, -Math.max(d2, hw - depth - Math.abs(x)));
/** Flache Erhebung (Höhe h über der Seitenfläche hw, Kantenradius r) im Bereich d2 < 0 anfügen. */
export const boss = (d, d2, x, hw, h, r, k = 0.0006) => smin(d, extrudeRound(d2, x, hw + h, r), k);

/**
 * Innensechskantschraube bündig in einer Senkung der Seitenfläche bei x (Vorzeichen = Seite): Kuppe leicht gewölbt,
 * Sechskant-Innenloch (dunkel), am PC eine schmale Fase der Senkung. o: { r (Kopfradius, m), part, seg, deep (Senkung) }.
 * Nur in den Ego-Stufen (Bots: nichts); Handy ohne Sechskant (Kleinteil < 3 mm, Bauanleitung 3.2).
 */
export function hexScrew(b, mat, x, v, u, o = {}) {
  if (!b.hi) return;
  const s = Math.sign(x) || 1, r = o.r ?? 0.0032, P = o.part ? { part: o.part } : {}, seg = o.seg ?? (b.max ? 20 : 12);
  const xs = x - s * (o.deep ?? 0.0004);
  b.lathe(mat, dome(r, 0.0007), xs, v, u, { ...P, axis: 'x', ry: s > 0 ? 0 : Math.PI, seg });
  if (b.lite) return;
  // Sechskant: flaches Sechseck aus der Kreisscheibe (6 Segmente), knapp über der Kuppe
  b.circle('cavity', r * 0.42, xs + s * 0.00072, v, u, { ...P, ry: s * Math.PI / 2, seg: 6 });
  if (b.max) b.torus('cavity', r + 0.00032, 0.00022, x - s * 0.00002, v, u, { ...P, ry: Math.PI / 2, seg: 4, tseg: 20 });
}

/**
 * Durchscheinender Magazinkörper (Rauch-Polymer): gerundeter Kasten von u0 bis u1, v0 (unten) bis v1 (oben), halbe
 * Breite hw, Kantenradius r. Innen hohl genug, dass die Patronen (magfill, show 'all') durchscheinen – das Material ist
 * durchscheinend, der Kasten geschlossen (eine Hülle, beidseitig sichtbar über die Transparenz).
 */
export function smokeBox(b, mat, o) {
  const { u0, u1, v0, v1, hw, r = 0.002, part } = o;
  b.box(mat, 2 * hw, v1 - v0, u1 - u0, 0, (v0 + v1) / 2, (u0 + u1) / 2, { part, r: b.hi ? r : 0, rs: b.max ? 3 : 2, c: b.hi ? undefined : 0 });
}

/**
 * 2D-Feld f(a, b) als Raster (bilinear abgefragt, außerhalb exakt) wie sdf.js grid2D – exakt ausgewertet nur in einem
 * Band (band, m) um die Nulllinie; weiter weg aus einem 4fach gröberen Raster interpoliert. Für Fotosilhouetten mit
 * Hunderten Punkten (sdPolygon kostet je Punkt): gleiche Kanten, ≈ ⅓ der Rechenzeit.
 */
export function gridBand(f, a0, a1, b0, b1, step, band = 0.006) {
  const na = Math.ceil((a1 - a0) / step) + 1, nb = Math.ceil((b1 - b0) / step) + 1, K = 4;
  const ca = Math.ceil((na - 1) / K) + 1, cb = Math.ceil((nb - 1) / K) + 1, C = new Float32Array(ca * cb);
  for (let j = 0; j < cb; j++) for (let i = 0; i < ca; i++) C[j * ca + i] = f(a0 + i * K * step, b0 + j * K * step);
  const g = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) {
    const ci = Math.min(ca - 2, (i / K) | 0), cj = Math.min(cb - 2, (j / K) | 0), k = cj * ca + ci;
    const c00 = C[k], c10 = C[k + 1], c01 = C[k + ca], c11 = C[k + ca + 1];
    if (Math.min(Math.abs(c00), Math.abs(c10), Math.abs(c01), Math.abs(c11)) < band) { g[j * na + i] = f(a0 + i * step, b0 + j * step); continue; }
    const x = i / K - ci, y = j / K - cj;
    g[j * na + i] = (c00 * (1 - x) + c10 * x) * (1 - y) + (c01 * (1 - x) + c11 * x) * y;
  }
  return (a, b) => {
    let x = (a - a0) / step, y = (b - b0) / step;
    if (x < 0 || y < 0 || x > na - 1 || y > nb - 1) return f(a, b);
    const i = Math.min(na - 2, x | 0), j = Math.min(nb - 2, y | 0);
    x -= i; y -= j;
    const k = j * na + i;
    return (g[k] * (1 - x) + g[k + 1] * x) * (1 - y) + (g[k + na] * (1 - x) + g[k + na + 1] * x) * y;
  };
}
