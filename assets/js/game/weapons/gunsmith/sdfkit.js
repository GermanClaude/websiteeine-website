// Baukasten für Waffen nach Referenzfoto (24.10.2026, Vorarbeit V7): die Helfer, mit denen M-17 und P-9 gebaut sind,
// an einer Stelle statt kopiert in jeder Waffe. Bauteile als Distanzfeld (Fotoumriss × eigene Breite, weich vereinigt,
// Fenster/Nuten/Schächte abgezogen), flache Teile als Profil-Extrusion, Kanten-/Muldenfarbe am PC.
// Koordinaten wie im Bauplan: x quer (rechts +), v hoch, u nach vorn; Maße in Metern (waffen-bauanleitung.md 2.3–2.5).
import { sdPolygon, surfaceNets, grid2D, contours2D, cavityColors } from './sdf.js';
import { shapeFrom } from './builder.js';
import { atlasUV } from './p9-tex.js';

export { atlasUV };

// ---------------------------------------------------------------- Gebrauchsspuren (cavityColors, nur b.max)
/** Eloxal reibt sich an Kanten blank (Aluminium). */
export const ALU = { r: 0.0009, edge: 0.85, cavity: 0.6 };
/** Phosphatierter/brünierter Stahl. */
export const STEEL = { r: 0.0008, edge: 0.7, cavity: 0.6 };
/** Kunststoff: Kanten speckig, Kehlen staubig. */
export const POLY = { r: 0.0013, edge: 0.45, cavity: 0.5 };

// ---------------------------------------------------------------- 2D-Felder und Formen
/** Hüllrechteck [u0, u1, v0, v1] einer Punktliste [[u, v], …] mit Rand m. */
export const box2 = (pts, m = 0.003) => { const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]); return [Math.min(...us) - m, Math.max(...us) + m, Math.min(...vs) - m, Math.max(...vs) + m]; };

/** Polygon (+ Löcher) als vorgerechnetes 2D-Feld über seinem Hüllrechteck (u, v) – immer für Fotoumrisse benutzen. */
export function field2(pts, holes = [], step = 0.0005) {
  const [u0, u1, v0, v1] = box2(pts, 0.008);
  return grid2D((u, v) => { let d = sdPolygon(u, v, pts); for (const h of holes) d = Math.max(d, -sdPolygon(u, v, h)); return d; }, u0, u1, v0, v1, step);
}

/** Gerundetes Rechteck um den Ursprung: Halbmaße bx, by, Eckradius r. */
export const sdRoundRect = (px, py, bx, by, r) => { const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };

/** Gerundeter Schnitt zweier Felder (wie Math.max(a, c), die Kante mit Radius r). */
export const roundMax = (a, c, r) => Math.min(Math.max(a + r, c + r), 0) + Math.hypot(Math.max(a + r, 0), Math.max(c + r, 0)) - r;

/** Abstand Punkt (px, py) – Strecke (ax, ay)…(bx, by). */
export const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };

/** Liegt (u, v) im Rechteck bb = [u0, u1, v0, v1]? Lokale Merkmale nur dort auswerten (spart Rechenzeit). */
export const inBox = (bb, u, v) => u > bb[0] && u < bb[1] && v > bb[2] && v < bb[3];

// ---------------------------------------------------------------- Fenster, Nuten, Fasen
/** Abziehen: Gebiet e < 0 (Fenster, Nut, Schacht, Bohrung) aus dem Feld d entfernen. */
export const cut = (d, e) => Math.max(d, -e);

/**
 * Fenster mit runden Ecken in einer Wand: Ausschnitt (du, dv) relativ zur Fenstermitte, Halbmaße hu, hv, Eckradius r.
 * flare: Fase – die Öffnung wächst nach außen um diesen Betrag (siehe fase()); guard: Feld der Tiefengrenze
 * (z. B. 0.0035 − x: nur die Wand rechts von x = 3,5 mm wird geöffnet).
 */
export const cutWindow = (d, du, dv, hu, hv, r, flare = 0, guard = -Infinity) => Math.max(d, -Math.max(sdRoundRect(du, dv, hu, hv, r) - flare, guard));

/** Fase einer Öffnung in einem runden Gehäuse (Radius R um die Achse): wächst ab R − w nach außen; rr = Abstand zur Achse. */
export const fase = (rr, R, w) => Math.max(0, rr - (R - w));

/** Ebene 45°-Fase: s = Summe der Abstände zu beiden Flächen (z. B. |x| − Halbbreite + v − (Oberkante − Fasenbreite)). */
export const chamfer = (d, s) => Math.max(d, s * Math.SQRT1_2);

// ---------------------------------------------------------------- Netze
/**
 * Distanzfeld-Bauteil vernetzen und einhängen. Schrittweite step = Standard (PC niedrig/mittel); am PC (b.max)
 * feiner (× o.fine, Standard 0,6) mit Kanten-/Muldenfarbe (o.cav: ALU/STEEL/POLY), am Handy (b.lite) gröber
 * (× o.lite, Standard 1,4 ≈ ½ Dreiecke). lo/hi = Box [x, v, u] mit ≥ 1–2 Rasterzellen Rand. o.uv = Atlas-Abbildung
 * fn(x, v, u, nx, ny, nz) → [U, V] (sonst Kachel-UVs), o.part = bewegliches Teil (Netz in Waffenkoordinaten).
 * o.id: als geteilter Block in den Bauteil-Cache (b.shared) – einmal je Stufe gerechnet, in allen Aufsatz-Varianten
 * wiederverwendet. Größere Abschnitte (mit field2-Vorrechnung) besser selbst in b.shared(id, () => …) fassen.
 */
export function sdfMesh(b, f, lo, hi, step, mat, o = {}) {
  if (o.id) return b.shared(o.id, () => sdfMesh(b, f, lo, hi, step, mat, { ...o, id: null }));
  const g = surfaceNets(f, lo, hi, b.max ? step * (o.fine ?? 0.6) : b.lite ? step * (o.lite ?? 1.4) : step);
  if (b.max) cavityColors(g, f, o.cav);
  return b._push(o.uv ? atlasUV(g, o.uv) : g, mat, { part: o.part }, !!o.uv);
}

/**
 * Flaches Teil: Nulllinien eines 2D-Felds f(u, v) im Fenster [u0, u1, v0, v1] quer extrudiert (halbe Breite hw,
 * Fase bevel) – viel weniger Dreiecke als ein Volumennetz. Schichten verschiedener Breite übereinander ergeben
 * Rand, vertiefte Felder, Rippen. o.mat Material, o.uv Atlas-Abbildung (sonst Kachel-UVs), o.step Raster (PC × 0,7),
 * o.part bewegliches Teil, o.id geteilter Block (Bauteil-Cache, wie bei sdfMesh).
 */
export function sideFurn(b, f, win, hw, bevel, o = {}) {
  if (o.id) return b.shared(o.id, () => sideFurn(b, f, win, hw, bevel, { ...o, id: null }));
  const [u0, u1, v0, v1] = win, { mat, uv = null, step = 0.00035, part } = o;
  for (const { outer, holes } of contours2D(f, u0, u1, v0, v1, b.max ? step * 0.7 : step, b.max ? 0.00007 : 0.00012)) {
    const geo = b._extrude(shapeFrom(outer, holes), hw * 2, bevel, { bevelSeg: 2, curveSeg: 1 });
    geo.translate(0, 0, -(hw * 2 - 2 * Math.min(bevel, hw * 0.9)) / 2);
    geo.rotateY(Math.PI / 2);
    b._push(uv ? atlasUV(geo, uv) : geo, mat, { part }, !!uv);
  }
}
