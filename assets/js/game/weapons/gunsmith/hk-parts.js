// HK-Baukasten (24.10.2026, Plan „Gemeinsame Baukästen“ G4): Teile der Rollenverschluss-Familie nach Foto, entstanden mit
// der VP-9 (MP5A5) und gedacht für die G-7 (G3) und den Keiler (UMP-Spannhebel): Gehäuse-Querschnitt (Blechprägung mit
// aufgesetztem Spannhebelrohr), Trommeldiopter, Kornhaube mit Kornpfosten, HK-Spannhebel mit gerauter Kappe, Haltebolzen,
// beidseitiger Wahlhebel (Navy/Feuerstoß), Laufmündung mit Dreifachwarze; Piktogramme des Griffstücks in hk-tex.js.
// Koordinaten wie im Bauplan: x quer (rechts +), v hoch, u nach vorn; Maße in Metern. Die Funktionen legen nur Geometrie an
// (keine Anker/Meta) – Teile (b.part) und Anker setzt der Bauplan der Waffe.
import { smin } from './sdf.js';
import { sdfMesh, sdRoundRect, roundMax, STEEL } from './sdfkit.js';

// ---------------------------------------------------------------- Gehäuse
/**
 * Querschnitt des geprägten HK-Gehäuses (x, v) → Abstand: Rumpf als gerundetes Rechteck (halbe Breite hw, Unterkante vB,
 * Schulter oben vS mit Radius rS, unten rB) und darauf das Spannhebelrohr (Achse tubeV, Radius tubeR), weich vereinigt (k).
 */
export function hkSection(x, v, S) {
  const cv = (S.vB + S.vS) / 2, hv = (S.vS - S.vB) / 2;
  const body = sdRoundRect(x, v - cv, S.hw, hv, v > cv ? S.rS : S.rB);
  return smin(body, Math.hypot(x, v - S.tubeV) - S.tubeR, S.k ?? 0.0025);
}

// ---------------------------------------------------------------- Visierung
/**
 * Trommeldiopter (HK): Trommel um eine Querachse (x) – wie ein Rad gedreht, die Blenden sind radiale Bohrungen im Umfang;
 * die benutzte liegt längs (u) auf der Visierlinie durch die Achse, die nächste (um 90° versetzt) senkrecht. Rechte Hälfte
 * gerändelt (nur PC), Absatzrille, Stirnflächen mit Schlitzschraube. o: { u, v (Achse = Visierlinie), r, len, apR, mat, id }
 */
export function hkDrum(b, o) {
  const { u: cu, v: cv, r = 0.0065, len = 0.016, apR = 0.0024, mat = 'steel', id = 'hkTrommel' } = o;
  const knurl = b.max, hl = len / 2;
  const f = (x, v, u) => {
    const pv = v - cv, pu = u - cu, rad = Math.hypot(pv, pu);
    let rr = r;
    if (knurl && x > 0 && x < hl - 0.0011 && rad > r - 0.0012) rr -= 0.00015 * (1 + Math.cos(Math.atan2(pu, pv) * 36));   // Rändel
    let d = roundMax(rad - rr, Math.abs(x) - hl, 0.0008);
    d = Math.max(d, -Math.max(Math.abs(x) - 0.0004, (r - 0.0005) - rad));            // Absatzrille in der Mitte
    d = Math.max(d, -(Math.hypot(x, pv) - apR));                                     // benutzte Blende (längs)
    d = Math.max(d, -(Math.hypot(x, pu) - apR * 0.6));                               // nächste Blende (senkrecht, kleiner)
    if (Math.abs(x) > hl - 0.0012) {                                                  // Stirn: Schraubenkopf mit Schlitz
      d = Math.max(d, -Math.max(Math.abs(rad - 0.0024) - 0.00022, hl - 0.0004 - Math.abs(x)));
      if (rad < 0.0023) d = Math.max(d, -Math.max(Math.abs(pu) - 0.00026, hl - 0.0005 - Math.abs(x)));
    }
    return d;
  };
  sdfMesh(b, f, [-hl - 0.002, cv - r - 0.002, cu - r - 0.002], [hl + 0.002, cv + r + 0.002, cu + r + 0.002], 0.001, mat, { cav: STEEL, fine: 0.6, lite: 1.4, id });
}

/**
 * Kornhaube mit Kornpfosten (HK): Schnitt zweier Zylinder (längs u und quer x, Radius r) – von vorn und von der Seite
 * rund –, darin der Sehtunnel (ri) und quer die Lichtfenster (rw), darunter der Hals bis vNeck; der Pfosten steht von
 * unten bis zur Mitte (Visierlinie) mit breiterem Fuß und Querbohrung. o: { u, v (Mitte = Visierlinie), r, ri, rw, vNeck, mat, id }
 */
export function hkHood(b, o) {
  const { u: cu, v: cv, r = 0.0097, ri = 0.0074, rw = 0.0058, vNeck, neckX = 0.0042, mat = 'steel', id = 'hkKornhaube' } = o;
  const f = (x, v, u) => {
    const pv = v - cv, pu = u - cu;
    let d = Math.max(Math.hypot(x, pv) - r, Math.hypot(pv, pu) - r);
    d = Math.max(d, -(Math.hypot(x, pv) - ri));                                    // Sehtunnel (längs)
    d = Math.max(d, -(Math.hypot(pv, pu) - rw));                                   // Lichtfenster (quer)
    // Hals unter der Haube (bis in den Kornträger)
    d = Math.min(d, roundMax(Math.max(Math.abs(x) - neckX, Math.abs(pu) - r * 0.82), Math.max(vNeck - v, pv + r * 0.6), 0.0012));
    // Kornpfosten: Klinge 1,5 mm bis zur Visierlinie, Fuß 4 mm breit mit Querbohrung
    const post = Math.max(Math.abs(x) - 0.00075, Math.abs(pu) - 0.0012, pv, -pv - ri - 0.001);
    const foot = Math.max(Math.abs(x) - (0.0021 - Math.max(0, pv + ri - 0.0035) * 0.3), Math.abs(pu) - 0.0016, pv + ri - 0.0035, -pv - ri - 0.001);
    d = Math.min(d, smin(post, foot, 0.0008));
    d = Math.max(d, -Math.max(Math.hypot(x, pv + ri - 0.0016) - 0.00055, Math.abs(pu) - 0.003));
    return d;
  };
  sdfMesh(b, f, [-r - 0.002, vNeck - 0.002, cu - r - 0.002], [r + 0.002, cv + r + 0.002, cu + r + 0.002], 0.0013, mat, { cav: STEEL, fine: 0.6, lite: 1.4, id });
}

// ---------------------------------------------------------------- Spannhebel, Bolzen, Wahlhebel
/**
 * HK-Spannhebel (am Teil o.part, Drehpunkt = Rohrachse): Arm aus der Nut im Rohr unter dem Winkel ang (von +x, links
 * oben ≈ 160°), runde Kappe mit gerauter Stirn (Kreuzrändel), Stift im Rohr. o: { u, v (Rohrachse), tubeR, ang, reach,
 * knobR, knobT, mat, knobMat, part }
 */
export function hkCockingHandle(b, o) {
  const { u, v, tubeR, ang = 2.8, reach = 0.0205, knobR = 0.0074, knobT = 0.0078, mat = 'steel', knobMat = 'knurl', part = 'charge' } = o;
  const c = Math.cos(ang), s = Math.sin(ang);
  const at = (d) => [c * d, v + s * d];
  // Arm (flach, 4,6 mm in u, 3,4 mm dick) vom Rohr bis in die Kappe
  const armL = reach - knobT * 0.5 - tubeR + 0.003, [amx, amv] = at(tubeR - 0.003 + armL / 2);
  b.box(mat, armL, 0.0034, 0.0046, amx, amv, u, { part, rz: ang, c: 0.0006 });
  // Kappe: Zylinder entlang des Arms, Stirn gerändelt, Rand gefast
  const [kx, kv] = at(reach);
  b.lathe(mat, [[-knobT / 2, 0], [-knobT / 2, knobR * 0.78], [-knobT / 2 + 0.0012, knobR], [knobT / 2 - 0.0009, knobR], [knobT / 2, knobR - 0.0009], [knobT / 2, 0]], kx, kv, u, { part, axis: 'x', rz: ang, seg: b.seg(28, 8) });
  if (b.hi) {
    // Stirn: Kreuzrändel (Material knurl), Bohrung des Haltestifts in der Mitte
    const [fx, fv] = at(reach + knobT / 2 + 0.00012);
    b.circle(knobMat, knobR - 0.0012, fx, fv, u, { part, ry: Math.PI / 2, rz: ang, order: 'ZYX', seg: 28 });
    const [gx, gv] = at(reach + knobT / 2 + 0.00022);
    b.circle('cavity', 0.0013, gx, gv, u, { part, ry: Math.PI / 2, rz: ang, order: 'ZYX', seg: 14 });
  }
}

/**
 * HK-Haltebolzen quer durch Gehäuse/Griffstück: Kopf mit Rastrille auf der Seite s (−1 links / 1 rechts), Gegenseite flach
 * mit Fase. x = halbe Breite an der Stelle (Außenfläche), r = Kopfradius.
 */
export function hkPin(b, mat, x, v, u, r, s = -1, o = {}) {
  const h = o.h ?? 0.0016;
  b.lathe(mat, [[0, 0], [0, r], [h * 0.45, r], [h * 0.55, r * 0.86], [h * 0.7, r * 0.86], [h * 0.8, r * 0.95], [h, r * 0.7], [h, 0]], s * (x - 0.0002), v, u, { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: b.seg(20, 6), part: o.part });
  if (b.hi) b.lathe(mat, [[0, 0], [0, r * 0.82], [0.0004, r * 0.7], [0.0004, 0]], -s * (x - 0.0002), v, u, { axis: 'x', ry: s > 0 ? Math.PI : 0, seg: 16, part: o.part });
}

/**
 * Beidseitiger Wahlhebel (Navy-/Feuerstoß-Griffstück): Nabe mit weißem Zeigerstrich, Daumenflügel gegenüber (Tropfenform,
 * breiter am Ende). Gebaut in Stellung SICHER: Zeiger nach unten, Flügel nach hinten oben (dir: Winkel des Flügels in der
 * u-v-Ebene, von +u gegen den Uhrzeigersinn). x = Außenfläche des Griffstücks. Teil o.part (Drehung um x).
 */
export function hkSelector(b, o) {
  const { v, u, x, dir = Math.PI - 0.28, hubR = 0.0052, tipR = 0.0058, reach = 0.0175, t = 0.0034, mat = 'steel', part = 'selector' } = o;
  const du = Math.cos(dir), dv = Math.sin(dir), n = b.hi ? 14 : 5;
  // Umriss: Hüllkurve zweier Kreise (Nabe r = hubR, Flügelende r = tipR im Abstand reach)
  const tu = u + du * reach, tv = v + dv * reach, a = Math.atan2(dv, du), k = Math.asin((tipR - hubR) / reach);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t2 = a + Math.PI / 2 + k + (Math.PI - 2 * k) * i / n; pts.push([u + Math.cos(t2) * hubR, v + Math.sin(t2) * hubR]); }
  for (let i = 0; i <= n; i++) { const t2 = a - Math.PI / 2 - k + (Math.PI + 2 * k) * i / n; pts.push([tu + Math.cos(t2) * tipR, tv + Math.sin(t2) * tipR]); }
  for (const s of [-1, 1]) {
    b.side(mat, pts, t, s * (x + t / 2), { part, bevel: b.max ? 0.0009 : 0.0006, bevelSeg: b.hi ? 2 : 1 });
    if (b.hi) {
      // Achsschraube in der Nabe, Zeigerstrich (weiß) nach unten, Griffmulde im Flügel
      b.cyl(mat, 0.0019, 0.0019, 0.0006, s * (x + t + 0.0002), v, u, { axis: 'x', part, seg: 14 });
      b.box('cavity', 0.0002, 0.0026, 0.00045, s * (x + t + 0.0006), v, u, { part, c: 0 });
      b.box('paintWhite', 0.0002, 0.0042, 0.0007, s * (x + t + 0.0001), v - hubR + 0.0024, u, { part, c: 0 });
      if (b.max) b.box('cavity', 0.00015, 0.0036, 0.0004, s * (x + t + 0.00008), tv - dv * 0.001, tu - du * 0.001, { part, c: 0, rx: -(a - Math.PI / 2) });
    }
  }
}

// ---------------------------------------------------------------- Lauf
/** Dreifachwarze (Aufnahme für Schalldämpfer/Feuerdämpfer) auf dem Laufbund: drei Nocken bei 90°, 210°, 330°. */
export function hkTriLug(b, mat, u0, u1, axis, r0, rLug) {
  if (!b.hi) return;
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * Math.PI * 2 / 3, h = rLug - r0 + 0.0008, rm = r0 + h / 2 - 0.0008;
    b.box(mat, 0.0052, h, u1 - u0, Math.cos(a) * rm, axis + Math.sin(a) * rm, (u0 + u1) / 2, { rz: a - Math.PI / 2, c: 0.0005 });
  }
}
// Piktogramme des Griffstücks (Textur): hk-tex.js (ohne Abhängigkeiten, damit materials.js → <waffe>-tex.js keinen Kreis bildet)
