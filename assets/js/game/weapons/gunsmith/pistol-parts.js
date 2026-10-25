// Pistolen-Baukasten (25.10.2026, Plan „Gemeinsame Baukästen“ G6): Kleinteile, die jede Pistole nach Foto braucht – entstanden
// mit der Adler .50 (Desert Eagle), gedacht für Sperber (Beretta 93R), P-9A und Kobra (Visier, Stifte, Schrauben, Knöpfe,
// Griffmagazin). Nur Geometrie (keine Anker/Teile/Meta – die setzt der Bauplan); Koordinaten wie im Bauplan: x quer (rechts +),
// v hoch, u vorn; Maße in Metern. Kleinteile unter 3 mm entfallen am Handy (b.lite), in der Bot-Stufe fallen Teile < 9 mm
// ohnehin weg (Builder).
import * as THREE from 'three';
import { shapeFrom } from './builder.js';
import { box2 } from './sdfkit.js';
import { sdPolygon } from './sdf.js';

// ---------------------------------------------------------------- Atlas-UVs je Dreieck
/**
 * Wie atlasUV (p9-tex.js): entindizieren, uvFn(x, v, u, nx, ny, nz, c) je Ecke – zusätzlich mit dem Schwerpunkt c = [x, v, u]
 * des Dreiecks (25.10., Adler-Prüfung). Atlasbereiche nach Lage (linkes Band, Innenwand, Lagerteil …) über c wählen, nicht über
 * die Ecke: sonst bekommt ein Dreieck über einer Bereichsgrenze UVs aus zwei weit entfernten Atlasstellen und zeigt einen
 * gestauchten Atlasstreifen (schwarzer Strich über Schlitten und Rahmen).
 */
export function atlasUVTri(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array, n = p.length / 3, uv = new Float32Array(n * 2), c = [0, 0, 0];
  for (let t = 0; t < n; t += 3) {
    const i = t * 3;
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    c[0] = (p[i] + p[i + 3] + p[i + 6]) / 3; c[1] = (p[i + 1] + p[i + 4] + p[i + 7]) / 3; c[2] = -(p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    for (let k = 0; k < 3; k++) {
      const j = (t + k) * 3;
      const [U, W] = fn(p[j], p[j + 1], -p[j + 2], nx, ny, nz, c);
      uv[(t + k) * 2] = U; uv[(t + k) * 2 + 1] = W;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------- Polygone
/**
 * 2D-Umrissfeld wie sdfkit.field2 (Raster step, bilinear abgefragt, außerhalb exakt), aber schneller (25.10., Bauzeit):
 *  – exakt nur in einem Streifen ± band um den Umriss; weiter innen/außen aus einem viermal gröberen Raster interpoliert –
 *    dort entscheidet das Feld keine Fläche (Abstandsfeld, Lipschitz 1). band ≥ größter Kantenradius, der den 2D-Wert nutzt;
 *  – im Streifen der Abstand nur zu den Kanten aus dem eigenen Fach (Fächer à R, Kanten nach Hüllrechteck + R einsortiert),
 *    das Vorzeichen je Rasterzeile aus den sortierten Schnittpunkten (gerade/ungerade) – gleiche Werte wie sdPolygon.
 * Löcher müssen im Umriss liegen. Für Fotoumrisse mit vielen Punkten (Adler-Rahmen 223, Griff 207).
 */
export function outlineField(pts, holes = [], step = 0.0005, band = 0.006) {
  const [u0, u1, v0, v1] = box2(pts, 0.008);
  const exact = (u, v) => { let d = sdPolygon(u, v, pts); for (const h of holes) d = Math.max(d, -sdPolygon(u, v, h)); return d; };
  const K = 4, S = step * K, na = Math.ceil((u1 - u0) / step) + 1, nb = Math.ceil((v1 - v0) / step) + 1;
  const ma = Math.ceil((na - 1) / K) + 2, mb = Math.ceil((nb - 1) / K) + 2, c = new Float32Array(ma * mb);
  for (let j = 0; j < mb; j++) for (let i = 0; i < ma; i++) c[j * ma + i] = exact(u0 + i * S, v0 + j * S);
  // Zelle weit weg: alle vier Ecken weiter als lim von der Kante (jeder Punkt der Zelle ≤ 0,71 S von einer Ecke)
  const lim = band + S * 0.75, R = lim + S, R2 = R * R;
  // Kanten aller Ringe (Umriss + Löcher) und Fächer (Seitenlänge R): Kante in jedes Fach, das ihr Hüllrechteck + R berührt
  const segs = [];
  for (const ring of [pts, ...holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) segs.push(ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
  const sg = Float64Array.from(segs), ns = sg.length / 4, fa = Math.ceil((u1 - u0) / R) + 1, fb = Math.ceil((v1 - v0) / R) + 1;
  const bins = Array.from({ length: fa * fb }, () => []);
  for (let s = 0; s < ns; s++) {
    const o = s * 4, a0 = Math.max(0, Math.floor((Math.min(sg[o], sg[o + 2]) - R - u0) / R)), a1 = Math.min(fa - 1, Math.floor((Math.max(sg[o], sg[o + 2]) + R - u0) / R));
    const b0 = Math.max(0, Math.floor((Math.min(sg[o + 1], sg[o + 3]) - R - v0) / R)), b1 = Math.min(fb - 1, Math.floor((Math.max(sg[o + 1], sg[o + 3]) + R - v0) / R));
    for (let bj = b0; bj <= b1; bj++) for (let bi = a0; bi <= a1; bi++) bins[bj * fa + bi].push(o);
  }
  const near2 = (u, v) => {   // kleinstes Abstandsquadrat zu den Kanten des Fachs (≥ R² → unbekannt)
    const bi = Math.min(fa - 1, Math.max(0, ((u - u0) / R) | 0)), bj = Math.min(fb - 1, Math.max(0, ((v - v0) / R) | 0));
    let m = R2;
    for (const o of bins[bj * fa + bi]) {
      const ax = sg[o], ay = sg[o + 1], ex = sg[o + 2] - ax, ey = sg[o + 3] - ay, wx = u - ax, wy = v - ay;
      const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1))), bx = wx - ex * t, by = wy - ey * t, q = bx * bx + by * by;
      if (q < m) m = q;
    }
    return m;
  };
  const g = new Float32Array(na * nb), cross = [];
  for (let j = 0; j < nb; j++) {
    const cj = (j / K) | 0, ty = j / K - cj, v = v0 + j * step;
    // Schnittpunkte der Zeile mit allen Kanten (halboffen wie sdPolygon), sortiert → innen = ungerade Anzahl links davon
    cross.length = 0;
    for (let o = 0; o < sg.length; o += 4) { const ay = sg[o + 1], by = sg[o + 3]; if ((ay <= v) !== (by <= v)) cross.push(sg[o] + (v - ay) * (sg[o + 2] - sg[o]) / (by - ay)); }
    cross.sort((p, q) => p - q);
    let k2 = 0;
    for (let i = 0; i < na; i++) {
      const u = u0 + i * step;
      while (k2 < cross.length && cross[k2] < u) k2++;
      const ci = (i / K) | 0, tx = i / K - ci, k = cj * ma + ci, a = c[k], b = c[k + 1], d = c[k + ma], e = c[k + ma + 1];
      const far = (a > lim && b > lim && d > lim && e > lim) || (a < -lim && b < -lim && d < -lim && e < -lim);
      if (far) { g[j * na + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; continue; }
      const q = near2(u, v);
      g[j * na + i] = q < R2 ? (k2 & 1 ? -1 : 1) * Math.sqrt(q) : exact(u, v);
    }
  }
  return (a, b) => {
    let x = (a - u0) / step, y = (b - v0) / step;
    if (x < 0 || y < 0 || x > na - 1 || y > nb - 1) return exact(a, b);
    const i = Math.min(na - 2, x | 0), j = Math.min(nb - 2, y | 0);
    x -= i; y -= j;
    const k = j * na + i;
    return (g[k] * (1 - x) + g[k + 1] * x) * (1 - y) + (g[k + na] * (1 - x) + g[k + na + 1] * x) * y;
  };
}

/** Polygon [[u, v], …] an der Waagrechten v = c schneiden; above = true behält den Teil darüber (Sutherland–Hodgman). */
export function clipV(pts, c, above = true) {
  const inside = (p) => (above ? p[1] >= c : p[1] <= c), out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], p = pts[i];
    const cut = () => { const t = (c - a[1]) / (p[1] - a[1]); return [a[0] + t * (p[0] - a[0]), c]; };
    if (inside(p)) { if (!inside(a)) out.push(cut()); out.push(p); } else if (inside(a)) out.push(cut());
  }
  return out;
}

// ---------------------------------------------------------------- Stifte, Schrauben, Knöpfe
// side: +1 nur rechts, −1 nur links, 0 beidseitig; xs = Lage der Oberfläche (Betrag); Kopf steht h über der Fläche
const sides = (side) => (side ? [side] : [-1, 1]);

/** Gewölbter Stiftkopf (Querstift im Rahmen): flacher Zylinderansatz mit Kuppe. */
export function pinHead(b, mat, xs, v, u, r, side = 0, { h = Math.max(0.0004, r * 0.3), part, seg = 16 } = {}) {
  if (b.lite && r < 0.0015) return;
  for (const s of sides(side)) b.lathe(mat, [[0, 0], [0, r], [h * 0.55, r], [h * 0.85, r * 0.8], [h, 0]], s * xs, v, u, { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg, part });
}

/** Linsenkopf mit Schlitz (Winkel ang in der u-v-Ebene, 0 = längs). */
export function slotScrew(b, mat, xs, v, u, r, side = 0, { ang = 0.6, h = r * 0.32, part, seg = 18 } = {}) {
  for (const s of sides(side)) {
    b.lathe(mat, [[0, 0], [0, r], [h * 0.4, r * 0.97], [h * 0.8, r * 0.75], [h, 0]], s * xs, v, u, { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg, part });
    if (b.hi && !b.lite) b.box('cavity', 0.0006, r * 0.36, r * 2.05, s * (xs + h * 0.75), v, u, { rx: ang, c: 0, part });
  }
}

/** Achse mit Innensechskant (flacher Kopf, Fase, dunkle Sechskantöffnung). */
export function hexPivot(b, mat, xs, v, u, r, side = 0, { h = 0.0007, part } = {}) {
  for (const s of sides(side)) {
    b.lathe(mat, [[0, 0], [0, r], [h * 0.6, r], [h, r * 0.82], [h, 0]], s * xs, v, u, { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 20, part });
    if (b.hi) b.circle('cavity', r * 0.42, s * (xs + h + 0.00005), v, u, { ry: s > 0 ? Math.PI / 2 : -Math.PI / 2, seg: 6, part });
  }
}

/** Runder Druckknopf mit gefaster Kante, steht h über der Fläche (Magazinhalter, Laufriegel). */
export function pushButton(b, mat, xs, v, u, r, side = 0, { h = 0.0012, part, rim = true } = {}) {
  for (const s of sides(side)) {
    b.lathe(mat, [[-0.0008, 0], [-0.0008, r], [h - 0.0004, r], [h, r - 0.0004], [h, 0]], s * xs, v, u, { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 22, part });
    if (rim && b.hi && !b.lite) b.torus('cavity', r + 0.00025, 0.00022, s * (xs + 0.00005), v, u, { ry: Math.PI / 2, seg: 4, tseg: 24, part });   // Spalt
  }
}

// ---------------------------------------------------------------- Visierung
/**
 * Kimme mit Rechteckkimme: Seitenprofil pts [[u, v], …] (m), quer auf ±hw extrudiert; oberhalb des Kimmengrunds vN nur die
 * beiden Wangen (Kimmenbreite nw), darunter voller Block. dots: weiße Punkte beidseitig der Kimme (Fläche nach hinten).
 */
export function notchSight(b, mat, pts, hw, { nw, vN, part, bevel = 0.00035, dots = false, uRear } = {}) {
  const low = clipV(pts, vN, false), high = clipV(pts, vN, true);
  if (low.length > 2) b.side(mat, low, hw * 2, 0, { part, bevel, bevelSeg: 1 });
  const ew = hw - nw / 2;
  if (high.length > 2 && ew > 0.0005) for (const s of [-1, 1]) b.side(mat, high, ew, s * (nw / 2 + ew / 2), { part, bevel: Math.min(bevel, ew * 0.3), bevelSeg: 1 });
  if (dots && b.hi && uRear !== undefined) {
    const vTop = Math.max(...high.map((p) => p[1]));
    for (const s of [-1, 1]) b.circle('paintWhite', 0.0008, s * (nw / 2 + ew / 2), (vN + vTop) / 2 - 0.0004, uRear - 0.00005, { ry: Math.PI, seg: 12, part });
  }
}

/** Korn: Seitenprofil (Rampe), quer ±hw; dot: weißer Punkt hinten (Fläche nach hinten) auf Höhe dot.v bei dot.u. */
export function bladeSight(b, mat, pts, hw, { part, bevel = 0.0003, dot } = {}) {
  b.side(mat, pts, hw * 2, 0, { part, bevel, bevelSeg: 1 });
  if (dot && b.hi) b.circle('paintWhite', Math.min(hw * 0.7, 0.0009), 0, dot.v, dot.u - 0.00005, { ry: Math.PI, rx: dot.rx || 0, seg: 12, part });
}

// ---------------------------------------------------------------- Rillen, Riffelung
/** Waagrechte Ausdehnung [u0, u1] eines Umrisses [[u, v], …] auf Höhe v (Schnitt der Waagrechten), null wenn außerhalb. */
export function spanAt(pts, v) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ua, va] = pts[j], [ub, vb] = pts[i];
    if ((va <= v) === (vb <= v)) continue;
    const u = ua + (ub - ua) * (v - va) / (vb - va);
    if (u < lo) lo = u; if (u > hi) hi = u;
  }
  return lo < hi ? [lo, hi] : null;
}

/**
 * Erhabene Querrippen auf einer Bedienfläche (25.10., Adler-Prüfung: schwarze Kerben wirkten wie ein aufgemalter Strichcode):
 * je Höhe v aus vs ein blanker Steg (Material mat, Breite w in v, steht h über der Fläche xs, side ±1) über die Breite des
 * Umrisses pts ([[u, v], …]) an dieser Höhe, um inset eingerückt. Nur Ego-Stufen ohne Handy.
 */
export function raisedRibs(b, mat, pts, vs, xs, side, { w = 0.00055, h = 0.00035, inset = 0.0008, part } = {}) {
  if (!b.hi || b.lite) return;
  const r = w / 2;   // runder Steg (Zylinder längs u, halb eingesenkt): fängt Licht aus allen Richtungen wie die gefrästen Rippen
  for (const v of vs) {
    const sp = spanAt(pts, v);
    if (!sp || sp[1] - sp[0] < 2 * inset + 0.001) continue;
    b.cyl(mat, r, r, sp[1] - sp[0] - 2 * inset, side * (xs + h - r), v, (sp[0] + sp[1]) / 2, { seg: 8, part });
  }
}

// ---------------------------------------------------------------- Profile mit Atlas
/**
 * Seitenprofil pts [[u, v], …] quer extrudiert (Breite width um x), mit Atlas-UVs uvFn(x, v, u, nx, ny, nz) – für flache Teile
 * aus demselben Foto-Atlas wie die Distanzfeld-Netze (z. B. Magazinboden). Bot-Stufe: wie b.side ohne Atlas.
 */
export function sideUV(b, mat, pts, width, x, uvFn, { part, bevel = 0.001, bevelSeg = 2, holes = [] } = {}) {
  if (!b.hi) return b.side(mat, pts, width, x, { part, bevel: 0 });
  const geo = b._extrude(shapeFrom(pts, holes), width, bevel, { bevelSeg, curveSeg: 4 });
  const realBev = Math.min(bevel, width * 0.45);
  geo.translate(0, 0, -(width - 2 * realBev) / 2);
  geo.rotateY(Math.PI / 2);
  geo.translate(x, 0, 0);
  return b._push(atlasUVTri(geo, uvFn), mat, { part }, true);
}
