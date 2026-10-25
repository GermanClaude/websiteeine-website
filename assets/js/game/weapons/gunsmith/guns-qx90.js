// QX-90 nach Referenzfoto (FN P90 Standard mit Ringvisier, qx90-ref.js) – Nutzer 24.10.2026: „Mach die Waffen viel
// detaillierter … nimm echte Bilder aus dem Internet und mach sie danach … Detailgrad wie bei der P-9 und der M-17“.
// Verfahren wie dort: Umrisse aus den (perspektivfreien) FN-Studiofotos verfolgt und kalibriert, Bauteile als
// Distanzfelder mit eigener Breite: Rahmen aus Schaftschale, Oberrahmen und schmalerem Griffmodul (Stufe wie am
// Original), Daumenloch und Abzugsschlaufe gerundet; Lauf- und Visiergruppe als Guss mit Bügel über dem Magazin, Träger,
// Frontblock und Unterteil; Ringvisier mit Fenster, Glas und Ringabsehen; durchscheinendes Magazin mit 50 quer liegenden
// Patronen in zwei Reihen; Spannhebel beidseitig, Drehwahlschalter unter dem Abzug, Feuerdämpfer mit Schrägschnitt.
// Rahmen und Gehäuse mit eigenem Atlas (qx90-tex.js), Schrauben/Kleinteile aus dem Polymer-Baukasten (polymer-parts.js).
// Detailstufen: PC hoch/ultra (b.max) feinste Netze + Kanten-/Muldenfarbe + Kleinteile, PC niedrig/mittel Standard,
// Handy (b.lite) gröbere Netze und kleiner Atlas, Bots ≤ 600 Dreiecke – Anker in allen Stufen gleich.
import * as R from './qx90-ref.js';
import { frameUV, upperUV } from './qx90-tex.js';
import { extrudeRound, smin, sdPolygon, simplifyPoly } from './sdf.js';
import { STEEL, POLY, sdfMesh, roundMax } from './sdfkit.js';
import { smoothPoly } from './ak-parts.js';
import { hexScrew, roundRect2, slot2, pocket, boss, smokeBox, gridBand } from './polymer-parts.js';
import { magRounds } from './magfill.js';
import { muzzleDevice, swapOptic } from './parts.js';
import { schrift } from './schrift.js';

const { U, V, M, HW } = R, AX = R.AXIS, px = (n) => n / R.PPM;
const MAT = { frame: 'qx90Frame', upper: 'qx90Upper', optic: 'qx90Optic', black: 'qx90Black', butt: 'qx90Butt', steel: 'qx90Steel', rod: 'qx90Rod', mag: 'qx90Mag', cap: 'qx90MagCap', tick: 'qx90MagTick' };
const CAST = { r: 0.0009, edge: 0.8, cavity: 0.55 };          // Guss: Kanten blank gerieben, Kehlen dunkel
// Netzweiten der Distanzfeld-Teile: [Standard-Raster (m), Faktor PC hoch/ultra, Faktor Handy] – abgestimmt auf die Budgets
// (waffen-bauanleitung 3.4: max ≤ 250 000, Standard ≤ 90 000, Handy ≤ 45 000 Dreiecke). Große Kunststoffflächen grob,
// Guss und Dämpfer fein; Oberseite (im Anschlag nah am Auge) über das Gehäuse.
const NET = { rahmen: [0.0031, 0.6, 1.5], kappe: [0.0028, 0.62, 1.45], gehaeuse: [0.0022, 0.62, 1.48], daempfer: [0.0013, 0.65, 1.4] };
const net = (k, o) => ({ ...o, fine: NET[k][1], lite: NET[k][2] });
const ss = (a, c, t) => { const k = Math.max(0, Math.min(1, (t - a) / (c - a))); return k * k * (3 - 2 * k); };
const lerp = (a, c, t) => a + (c - a) * t;
const box2 = (u, v, x0, y0, x1, y1) => Math.max(U(x0) - u, u - U(x1), v - V(y0), V(y1) - v);   // Fotorechteck (inside < 0)

// ---------------------------------------------------------------- 2D-Felder (einmal je Sitzung, stufenunabhängig)
let F = null;
/** Umriss + Löcher als vorgerechnetes Raster nur über dem Fenster [x0, y0, x1, y1] (Fotopixel) – die Silhouette hat
 *  ≈ 300 Punkte, über die ganze Waffe gerastert kostete das ein Vielfaches. */
function grid(outer, holes, [x0, y0, x1, y1], step) {
  return gridBand((u, v) => { let d = sdPolygon(u, v, outer); for (const h of holes) d = Math.max(d, -sdPolygon(u, v, h)); return d; }, U(x0), U(x1), V(y1), V(y0), step, 0.0065);
}
/** Polygon (u, v) auf u ≥ u0 beschnitten (Sutherland–Hodgman) – für Felder, die nur einen Teil der Silhouette abfragen:
 *  weniger Punkte = schnellere Abstände (Bauzeit-Budget 3.4); die Schnittkante liegt weit außerhalb des Fensters. */
function clipU(pts, u0) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ia = a[0] >= u0, ib = b[0] >= u0;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (u0 - a[0]) / (b[0] - a[0]); out.push([u0, a[1] + t * (b[1] - a[1])]); }
  }
  return out;
}
function fields() {
  if (F) return F;
  // Pixeltreppen der Kontursuche erst begradigen (Douglas-Peucker 1,6 px), dann leicht glätten – sonst Riefen auf den
  // gerundeten Flächen (Stirn, Daumenloch, Schlaufe)
  const clean = (q, r = 0.0005, w = 2, tol = 0.00004) => smoothPoly(simplifyPoly(M(q), 0.00045), r, w, tol);
  const sil = simplifyPoly(clean(R.SIL), 0.00025);
  F = {
    // Silhouette mit Daumenloch und Abzugsschlaufe (Rahmen, Kappe) – geglättet, Raster 1 mm (Kanten ohnehin ≥ 4 mm gerundet)
    frame: grid(sil, [clean(R.THUMB), clean(R.GUARD)], [130, 440, 1870, 990], 0.001),
    // Silhouette fast scharf (Guss, Raster 0,75 mm) mit Visierfenster, Spalt über dem Magazin, Fenster vor der Kappe –
    // Pixeltreppen begradigt (Douglas-Peucker 1,6 px, Ecken bleiben scharf): schräge Kanten wie die Stirn bestehen im
    // Foto aus 2-px-Stufen, die sich auf der Fläche als waagrechte Riefen abzeichneten
    upper: grid(clipU(clean(R.SIL, 0.0004, 1, 0.00008), U(1100)), [M(R.SIGHT_WIN), M(R.GAP), M(R.FRONT_WIN)], [1175, 225, 1870, 660], 0.00075),
    housing: M(R.HOUSING), magZone: M(R.MAG_ZONE), strap: M(R.STRAP),
  };
  return F;
}

// Breiten des Rahmens: Zone A (Schaft + Oberrahmen) und Zone B (Griffmodul mit Griffsteg, Schlaufe, Haken)
const uP = U(R.PANEL_X), vP = V(R.PANEL_Y), u13 = U(1300), rP = px(R.PANEL_R);
const zoneB = (u, v) => Math.min(roundMax(uP - u, v - vP, rP), u13 - u);          // < 0: Griffmodul
const hwA = (u, v) => lerp(HW.stock - 0.0005 + 0.0005 * ss(V(654), V(646), v), HW.upper, ss(U(660), U(730), u));
const hwB = (u, v) => {
  let h = lerp(HW.grip, HW.loop, ss(U(1400), U(1480), u));
  const front = lerp(HW.hook, 0.0175, ss(V(765), V(705), v));
  return lerp(h, front, ss(U(1625), U(1675), u));
};
/** Halbe Rahmenbreite an einer Stelle (Schrauben, Senkungen). */
const hwFrame = (u, v) => (zoneB(u, v) < 0 ? hwB(u, v) : hwA(u, v));

// ---------------------------------------------------------------- Rahmen (Distanzfeld)
function frame(b) {
  const S = fields();
  const ub = U(R.BUTT_X) + 0.0004;
  const screws = R.SCREWS.map(([x, y]) => { const u = U(x), v = V(y); return [u, v, hwFrame(u, v)]; });
  const rS = px(R.SCREW_R + 2.5);
  const [cx0, cy0, cx1, cy1] = R.CATCH_POCKET, [lx0, ly0, lx1, ly1, lr] = R.LUG, [sx0, sy0, sx1, sy1] = R.SLING_SLOT;
  const [ex0, ey0, ex1, ey1] = R.EJECT, [phx, phy, phr] = R.PIN_HOLE;
  const lugC = [U((lx0 + lx1) / 2), V((ly0 + ly1) / 2), px(lx1 - lx0) / 2, px(ly1 - ly0) / 2, px(lr)];
  // Sockel unter dem Magazin: oben gerade, unten flacher Bogen (Foto; Pfeilhöhe LUG_ARC) – Kreis durch Mitte und Ecken
  const lugHc = px(lx1 - lx0) / 2, lugS = px(R.LUG_ARC), lugR = (lugHc * lugHc + lugS * lugS) / (2 * lugS), lugCv = V(ly1) + lugR;
  const lugF = (u, v) => roundMax(roundRect2(u - lugC[0], v - lugC[1], lugC[2], lugC[3], lugC[4]), Math.hypot(u - lugC[0], v - lugCv) - lugR, 0.0012);
  const pocketC = [U((cx0 + cx1) / 2), V((cy0 + cy1) / 2), px(cx1 - cx0) / 2, px(cy1 - cy0) / 2];
  const d2 = (u, v) => {
    let d = S.frame(u, v);
    if (d > 0.012) return d;
    d = Math.max(d, ub - u, -sdPolygon(u, v, S.housing));
    d = Math.max(d, -box2(u, v, 733, 380, 1212, 545), -box2(u, v, 1815, 500, 2010, 640));          // Magazin, Lauf
    return d;
  };
  const f = (x, v, u) => {
    const p = d2(u, v);
    if (p > 0.009) return p;
    const ax = Math.abs(x), zb = zoneB(u, v), ha = hwA(u, v), hb = hwB(u, v);
    // Zone A breiter, an der Grenze zum Griffmodul scharf abgesetzt (Stufe); Zone B schmaler, stark gerundet
    let dA = roundMax(extrudeRound(p, x, ha, 0.0045), -zb, 0.0007);
    const dB = extrudeRound(Math.max(p, zb - 0.003), x, hb, Math.min(0.0065, hb * 0.38));
    let d = smin(dA, dB, 0.0012);
    // Tasche des Magazinhalters, Sockel unter dem Magazin, Riemenschlitz, Auswurf unten, Rastbohrung, Senkungen
    if (u < pocketC[0] + 0.02 && u > pocketC[0] - 0.02 && v > V(560)) d = pocket(d, roundRect2(u - pocketC[0], v - pocketC[1], pocketC[2], pocketC[3], 0.0012), x, ha, 0.0028);
    if (Math.abs(u - lugC[0]) < 0.02 && Math.abs(v - lugC[1]) < 0.012) d = boss(d, lugF(u, v), x, HW.upper, 0.0013, 0.001);
    if (u < U(sx1) + 0.004 && v < V(sy0) + 0.004) d = Math.max(d, -slot2(u, v, U(sx0), U(sx1), V((sy0 + sy1) / 2), px(sy1 - sy0) / 2 + 0.0004));
    if (u > U(ex0) - 0.004 && u < U(ex1) + 0.004 && v < V(ey0)) d = Math.max(d, -Math.max(box2(u, v, ex0, ey0 - 30, ex1, ey1 + 30), ax - 0.0105));
    if (Math.abs(u - U(phx)) < 0.004 && Math.abs(v - V(phy)) < 0.004) d = pocket(d, Math.hypot(u - U(phx), v - V(phy)) - px(phr), x, hb, 0.004);
    if (b.hi && !b.lite && ax > 0.012) for (const [su, sv, sh] of screws) if (Math.abs(u - su) < 0.006 && Math.abs(v - sv) < 0.006) d = pocket(d, Math.hypot(u - su, v - sv) - rS, x, sh, 0.0006);
    return d;
  };
  b.shared('rahmen', () => sdfMesh(b, f, [-0.0285, V(973), U(186)], [0.0285, V(452), U(1849)], NET.rahmen[0], MAT.frame, net('rahmen', { uv: frameUV, cav: POLY })));
  // Schaftkappe (Gummi): Silhouette hinter der Fuge, Kanten gerundet, vorn knapp gerundet. Sie reicht 1,2 mm in den
  // Schaft hinein – die Fuge ist eine dunkle Kerbe wie im Foto, kein durchsichtiger Spalt (Prüfung 25.10.)
  b.shared('kappe', () => {
    const fb = (x, v, u) => { const p = S.frame(u, v); if (p > 0.008) return p; return roundMax(extrudeRound(p, x, HW.butt, 0.0055), u - U(R.BUTT_X) - 0.0012, 0.0009); };
    sdfMesh(b, fb, [-0.0285, V(904), U(146)], [0.0285, V(452), U(R.BUTT_X) + 0.003], NET.kappe[0], MAT.butt, net('kappe', { cav: POLY }));
  });
  return { screws };
}

// ---------------------------------------------------------------- Lauf- und Visiergruppe (Guss, Distanzfeld)
/** 2D-Feld (u, v) des Freiraums für das Magazin (< 0 frei): Tunnel in Ruhelage plus der Weg beim Herausnehmen – hinten
 *  um MAG_TILT angehoben (Drehung um die Vorderkante unten, x 1706 / y 546), dann schräg nach hinten gezogen
 *  (anim/magwell.js). Oberkante = Gerade durch die gedrehte vordere Oberkante der Kappe, steigt nach hinten; Unterkante =
 *  Auflage (y 541), vorn unter der Kappe tiefer. Prüfung 25.10.: vorher fuhr das Magazin durch die massive Brücke. */
export function magClear(u, v) {
  const t = Math.tan(R.MAG_TILT), h = px(546 - R.MAG.cap[2]);
  const uC = U(1706) + Math.sin(R.MAG_TILT) * h, vC = V(546) + Math.cos(R.MAG_TILT) * h;    // gedrehte Kappenoberkante vorn
  const top = vC + (uC - u) * t + 0.0006;
  const bot = Math.min(V(541), V(546.5) + (U(1706) - u) * t);
  return Math.max(bot - v, v - top, U(1180) - u, u - uC - 0.0006);
}
function housing(b) {
  const S = fields();
  const vL = V(R.LOWER_Y), vT = V(297), hwBeam = HW.beam - 0.0035;
  const uFB = U(R.FRONT_BLOCK[0]), vFB = V(R.FRONT_BLOCK[1]);
  const [rx0, ry0, rx1, ry1, rr] = R.RECESS, rc = [U((rx0 + rx1) / 2), V((ry0 + ry1) / 2), px(rx1 - rx0) / 2, px(ry1 - ry0) / 2, px(rr)];
  const [qx0, qy0, qx1, qy1] = R.SLOT_R, qc = [U((qx0 + qx1) / 2), V((qy0 + qy1) / 2), px(qx1 - qx0) / 2, px(qy1 - qy0) / 2];
  const K = R.KEYHOLE, uO = U(R.OPTIC[2]), vCh = V(R.KEYHOLE.chBot) + K.chW, [hy, hr] = K.hole;
  const d2 = (u, v) => {
    let d = S.upper(u, v);
    if (d > 0.01) return d;
    d = Math.max(d, sdPolygon(u, v, S.housing), -sdPolygon(u, v, S.magZone));
    d = Math.max(d, -box2(u, v, 1418, 200, 1741, 301));                       // Optik sitzt darauf
    d = Math.max(d, -box2(u, v, 1843, 400, 2010, 700), -box2(u, v, R.BARREL_X0, 548, 2010, 700));   // Lauf ab der Front
    return d;
  };
  const f = (x, v, u) => {
    const p = d2(u, v);
    if (p > 0.008) return p;
    const ax = Math.abs(x), st = sdPolygon(u, v, S.strap);
    const r = 0.0011, fb = Math.max(uFB - u, v - vFB);        // fb < 0: dicker Teil des Frontblocks (unten vorn)
    // Bügel (umgreift das Magazin), dicker Frontblock, Unterteil (Lauf, Spannhebelkanäle), Träger und Front oben gleich
    // breit (keine Fuge), schmaler Rücken unter der Optik
    let d = extrudeRound(Math.max(p, st), x, HW.strap, 0.0014);
    d = smin(d, extrudeRound(Math.max(p, -st, fb), x, HW.front, r), 0.0008);
    d = smin(d, extrudeRound(Math.max(p, -st, -fb, v - vL), x, HW.lower, r), 0.0008);
    d = smin(d, extrudeRound(Math.max(p, -st, -fb, vL - v, v - vT), x, hwBeam, r), 0.0008);
    d = smin(d, extrudeRound(Math.max(p, vT - v), x, HW.optic, 0.0008), 0.0006);
    // Magazin: Tunnel + Freiraum zum Herausnehmen (der Bügel ist innen hohl – Foto ohne Magazin), Seitenwände bleiben
    if (ax < HW.mag + 0.0009 && u > U(1175) && u < U(1722) && v > V(560) && v < V(380)) d = Math.max(d, -Math.max(magClear(u, v), ax - HW.mag - 0.0008));
    // Notvisier-Kanal vorn auf dem Gehäuse (U-Form, zwischen den „Ohren“) mit Rundloch hinten unter der Optik
    if (u > uO - 0.012 && ax < K.chW + 0.004 && v > V(R.KEYHOLE.chBot) - 0.003) {
      d = Math.max(d, -Math.max(Math.hypot(x, Math.max(0, vCh - v)) - K.chW, uO - 0.0004 - u));
      d = Math.max(d, -Math.max(Math.hypot(x, v - V(hy)) - hr, uO - 0.011 - u));
    }
    // Tasche vorn (beidseitig), Schlitz rechts neben dem Knopf
    if (u > uFB - 0.004 && v < vFB + 0.004) d = pocket(d, roundRect2(u - rc[0], v - rc[1], rc[2], rc[3], rc[4]), x, HW.front, 0.0012);
    if (x > 0 && u > U(1790)) d = pocket(d, roundRect2(u - qc[0], v - qc[1], qc[2], qc[3], qc[2] * 0.95), x, hwBeam, 0.0015);
    return d;
  };
  b.shared('gehaeuse', () => sdfMesh(b, f, [-0.0275, V(642), U(1186)], [0.0275, V(260), U(1847)], NET.gehaeuse[0], MAT.upper, net('gehaeuse', { uv: upperUV, cav: CAST })));
  if (b.hi) b.circle('cavity', K.hole[1] * 0.9, 0, V(hy), uO - 0.0105, { seg: 16 });       // Rundloch dunkel (Grund)
  // Seitenschienen (beidseitig, Foto: kurze Picatinny-Leiste quer): Querschnitt mit 45°-Fasen oben und unten, zwei
  // Endstücke mit Schraube, dazwischen 4 Stege und 5 Nuten (5,3 mm) – Nutgrund dunkler; Bots: flache Leiste
  const [ax0, ay0, ax1, ay1] = R.RAIL, [t0, t1] = R.RAIL_TEETH, xr = hwBeam - 0.0003, rh = 0.0046, ch = 0.0026;
  const vB = V(ay1), vTp = V(ay0), floor = 0.0016;
  for (const s of [-1, 1]) {
    if (!b.hi) { b.box(MAT.optic, rh, vTp - vB, U(ax1) - U(ax0), s * (xr + rh / 2), (vB + vTp) / 2, (U(ax0) + U(ax1)) / 2, { c: 0.0006 }); continue; }
    const sec = (h) => [[s * xr, vB], [s * (xr + h), vB + Math.min(ch, h)], [s * (xr + h), vTp - Math.min(ch, h)], [s * xr, vTp]];
    b.front(MAT.black, sec(floor), U(ax1) - U(ax0), U(ax0), { bevel: 0 });                                  // Nutgrund
    const pitch = (t1 - t0) / 4.5, slot = pitch * 0.535;
    const segs = [[ax0, t0]];                                                                                // Endstück hinten
    for (let i = 0; i < 4; i++) segs.push([t0 + slot + i * pitch, t0 + (i + 1) * pitch]);                   // Stege
    segs.push([t1, ax1]);                                                                                    // Endstück vorn
    for (const [a0, a1] of segs) b.front(MAT.optic, sec(rh), px(a1 - a0), U(a0), { bevel: 0.0004, bevelSeg: 1 });
    for (const [x, y] of R.RAIL_SCREWS) {          // Zylinderkopfschraube in der Senkung (Foto: dunkler Ring, Kopf bündig)
      hexScrew(b, MAT.steel, s * (xr + rh + 0.0003), V(y), U(x), { r: px(R.SCREW_R) * 0.86 });
      if (b.max) b.torus('cavity', px(R.SCREW_R) * 0.93, 0.00035, s * (xr + rh + 0.0001), V(y), U(x), { ry: Math.PI / 2, seg: 4, tseg: 24 });
    }
  }
  if (b.hi) {
    const [kx, ky, kr, kc] = R.KNOB_R, xF = hwBeam;
    b.lathe(MAT.optic, [[0, 0], [0, px(kr)], [0.0009, px(kr)], [0.0013, px(kr) - 0.0004], [0.0013, 0]], xF - 0.0002, V(ky), U(kx), { axis: 'x', seg: b.max ? 32 : 18 });
    b.lathe(MAT.black, [[0, 0], [0, px(kc)], [0.0026, px(kc)], [0.0031, px(kc) - 0.0005], [0.0031, 0]], xF + 0.001, V(ky), U(kx), { axis: 'x', seg: b.max ? 28 : 16 });
    if (!b.lite) {
      b.circle('cavity', px(kc) * 0.36, xF + 0.0042, V(ky), U(kx), { ry: Math.PI / 2, seg: 6 });
      if (b.max) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; b.box('cavity', 0.0012, 0.0009, 0.0024, xF + 0.0039, V(ky) + Math.sin(a) * px(kc) * 0.86, U(kx) + Math.cos(a) * px(kc) * 0.86, { rx: -a, c: 0 }); }
    }
    const [bx, by, br] = R.BOSS_L;
    b.lathe(MAT.optic, [[0, 0], [0, px(br)], [0.0008, px(br) * 0.92], [0.0014, px(br) * 0.55], [0.0016, 0]], -xF + 0.0002, V(by), U(bx), { axis: 'x', ry: Math.PI, seg: b.max ? 24 : 14 });
    if (!b.lite) b.circle('cavity', 0.0011, -xF - 0.0017, V(by), U(bx), { ry: -Math.PI / 2, seg: 10 });
  }
}

// ---------------------------------------------------------------- Ringvisier (Optik) bzw. Schiene für Aufsatz-Optiken
function optic(b) {
  const [ox0, oy0, ox1, oy1] = R.OPTIC, hw = HW.optic, u0 = U(ox0), u1 = U(ox1), vTop = V(oy0), vBot = V(oy1) - 0.003;
  const want = b.att && b.att.optik;
  if (want && want !== 'ring') {
    // Fremde Optik: flache Schiene auf dem Gehäuse (wie die TR-Ausführung), Optik darauf (swapOptic setzt den Anker)
    const vR = V(oy1);
    b.box(MAT.optic, 0.024, 0.004, u1 - u0, 0, vR + 0.002, (u0 + u1) / 2, { c: 0.0008 });
    b.picatinny(MAT.optic, 0, vR + 0.003, u0 + 0.004, u1 - 0.004);
    swapOptic(b, 'ring', u0 + 0.012, vR + 0.003 + 0.0077);
    return null;
  }
  const vS = V(R.SIGHT_Y), { h, w, r } = R.OPTIC_WIN, K = R.KEYHOLE, nw = K.neck;
  // Querschnitt: oben breit gefast (Foto Mündungsseite: helle Fasenkante ≈ 3 mm)
  const cc = 0.003, sec = [[-hw, vBot], [hw, vBot], [hw, vTop - cc], [hw - cc, vTop], [-hw + cc, vTop], [-hw, vTop - cc]];
  const n = 4, arc = (cx, cy, a0, a1) => { const q = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; q.push([cx + Math.cos(a) * r, vS + cy + Math.sin(a) * r]); } return q; };
  const P2 = Math.PI / 2, wx = w / 2 - r, wy = h / 2 - r, wb = vS - h / 2;
  // Gehäuse in einem Stück mit Schlüsselloch-Querschnitt (Fenster + Hals nach unten zum Kanal, wie im Mündungsseiten-
  // Foto); hinter der vorderen Blende (K.depth) füllt ein Steg den Hals wieder – keine Fuge außen
  const key = [[-hw, vBot], [-nw, vBot], [-nw, wb], ...arc(-wx, -wy, 3 * P2, 2 * P2), ...arc(-wx, wy, 2 * P2, P2), ...arc(wx, wy, P2, 0), ...arc(wx, -wy, 0, -P2),
    [nw, wb], [nw, vBot], [hw, vBot], [hw, vTop - cc], [hw - cc, vTop], [-hw + cc, vTop], [-hw, vTop - cc]];
  b.front(MAT.optic, key, u1 - u0, u0, { bevel: 0.0005, bevelSeg: 2, curveSeg: 1 });
  b.front(MAT.optic, [[-nw - 0.0002, vBot], [nw + 0.0002, vBot], [nw + 0.0002, wb], [-nw - 0.0002, wb]], u1 - u0 - K.depth, u0 + 0.0003, { bevel: 0 });
  // Glas hinter der Blende (leicht getönt, spiegelt), Ringabsehen dahinter; Lichtsensor im Hals unter dem Fenster
  // (Prüfung 25.10.: lag halb im Fenster und wirkte wie ein schwarzer Punkt darin); Stifte seitlich
  b.plane('lensClear', w, h, 0, vS, u1 - K.depth - 0.0004, { renderOrder: 1 });
  b.plane('reticleHolo', 0.022, 0.022, 0, vS, u1 - K.depth - 0.0014, { renderOrder: 3 });
  b.circle('lens', 0.0021, 0, V(294), u1 - K.depth + 0.0003, { ry: Math.PI, seg: 16 });
  const [dx, dy, dr] = R.OPTIC_DOT;
  for (const s of [-1, 1]) b.lathe(MAT.optic, [[0, 0], [0, px(dr)], [0.0003, px(dr) * 0.9], [0.0004, 0]], s * hw, V(dy), U(dx), { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 12 });
  return vS;
}

// ---------------------------------------------------------------- Magazin (Teil mag): Rauch-Polymer, Patronen quer
function magazine(b) {
  const m = R.MAG, P = { part: 'mag' }, hw = HW.mag;
  b.part('mag', 0, V((m.top + m.bot) / 2), U(1205));
  smokeBox(b, MAT.mag, { u0: U(m.rear), u1: U(m.cap[0]) + 0.0005, v0: V(m.foot), v1: V(m.top), hw, r: 0.0022, part: 'mag' });
  // Bodenleiste (Führung), Heck mit der Zuführung (Foto: ebenfalls Rauch-Polymer, darin dunkel die runde Drehrampe –
  // Prüfung 25.10.: vorher ein schwarzer Block), Kappe vorn mit Haltenase
  b.box(MAT.cap, 2 * hw - 0.002, px(m.bot - m.foot), U(m.cap[0]) - U(m.rear), 0, V((m.foot + m.bot) / 2), (U(m.rear) + U(m.cap[0])) / 2, { ...P, c: 0.0008 });
  b.box(MAT.mag, 2 * hw, px(545 - 461), U(m.rear) - U(m.x0), 0, V((461 + 545) / 2), (U(m.x0) + U(m.rear)) / 2, { ...P, r: b.hi ? 0.0025 : 0 });
  if (b.hi) b.cyl(MAT.cap, 0.0066, 0.0066, px(537 - 469), 0, V((469 + 537) / 2), U(766), { ...P, axis: 'v', seg: b.max ? 28 : 16 });
  const [c0, c1, cy0, cy1] = m.cap;
  b.box(MAT.cap, 2 * hw + 0.001, px(cy1 - cy0), px(c1 - c0), 0, V((cy0 + cy1) / 2), U((c0 + c1) / 2), { ...P, r: b.hi ? 0.0015 : 0 });
  if (b.hi) {
    b.box(MAT.cap, 0.016, 0.0022, 0.004, 0, V(cy0) - 0.0006, U(c1) - 0.002, { ...P, c: 0.0005 });              // Haltenase oben
    // Strichskala beidseitig (Fotos: hell bernsteinfarbene Teilstriche im Rauch-Polymer)
    if (!b.lite) for (const t of R.MAG_TICKS) if (t > m.rear + 8 && t < c0 - 8) for (const s of [-1, 1]) b.box(MAT.tick, 0.0004, px(46), 0.0007, s * (hw + 0.0001), V(495), U(t), { ...P, c: 0 });
  }
  // 50 Patronen 5,7 × 28 quer (Spitzen nach links), zwei Reihen; Zuführung hinten – der Zubringer wandert nach hinten
  // Patronen hinter dem Rauch-Polymer gedämpft (eigenes Material), Hülsenböden frontal zur Seite – mehr Segmente
  magRounds(b, { cal: 'p57', axis: 'x', dir: -1, show: 'all', width: 0.0168, depth: 0.042, fol: [0.0158, 0.006, 0.04], folMat: MAT.cap, path: [[0, V(494), U(m.rear + 14)], [0, V(494), U(c0 - 6)]],
    roundMat: 'qx90Rounds', seg: b.max ? 18 : b.lite ? 10 : 14 });
  b.anchor('magGrab', 0, V(m.top), U(1060), { part: 'mag', data: { w: hw, h: 0.0105 } });
}

// ---------------------------------------------------------------- Spannhebel (Teil charge), beidseitig
function chargingHandles(b) {
  b.part('charge', 0, V(615), U(1680));
  const P = { part: 'charge' }, [r0, ry0, r1, ry1] = R.ROD, [k0, ky0, k1, ky1] = R.CH_KNOB, [lx0, ly0, lx1, ly1] = R.CH_LOOP;
  const knob = M([[k0, 590], [k0 + 4, ky0 + 6], [1676, ky0 + 4], [1690, ky0], [1712, ky0 + 1], [1724, 598], [k1, 616], [1724, 634], [1712, ky1 - 1], [1690, ky1], [1676, ky1 - 4], [k0 + 4, ky1 - 6], [k0, 640]]);
  const loop = M([[lx0, ly0 + 6], [lx0 + 6, ly0], [lx1 - 8, ly0], [lx1, (ly0 + ly1) / 2], [lx1 - 8, ly1], [lx0 + 6, ly1], [lx0, ly1 - 6]]);
  const [px0, py0, pr] = R.CH_PIN;
  for (const s of [-1, 1]) {
    b.box(MAT.rod, 0.0024, px(ry1 - ry0), U(r1) - U(r0), s * HW.rod, V((ry0 + ry1) / 2), (U(r0) + U(r1)) / 2, { ...P, c: 0.0005 });
    b.side(MAT.black, knob, 0.0052, s * (HW.knob - 0.0026), { ...P, holes: [loop], bevel: b.hi ? 0.0009 : 0, bevelSeg: 2 });
    if (b.hi) b.cyl(MAT.steel, px(pr), px(pr), 0.0058, s * (HW.knob - 0.0026), V(py0), U(px0), { ...P, axis: 'x', seg: b.max ? 16 : 10 });
  }
  b.anchor('chargeGrab', -HW.knob, V(615), U(1700), { part: 'charge', data: { travel: [0, 0, 0.06], style: 'pull' } });
}

// ---------------------------------------------------------------- Lauf, Feuerdämpfer (Käfig mit Taille, 4 Fenstern, Schrägschnitt)
function barrel(b) {
  const u0 = U(R.BARREL_X0) - 0.006, H = R.HIDER;
  if (b.att && b.att.muendung) {
    b.lathe(MAT.steel, [[0, 0.0095], ...R.BARREL.filter(([x]) => x <= 1898).map(([x, r]) => [U(x) - u0, r]), [U(1898) - u0, 0.0083]], 0, AX, u0, { seg: b.seg(28, 6) });
    return muzzleDevice(b, b.att.muendung, U(1898), AX, 0.0095);
  }
  b.lathe(MAT.steel, [[0, 0.0095], ...R.BARREL.map(([x, r]) => [U(x) - u0, r])], 0, AX, u0, { seg: b.seg(28, 6) });
  const ua = U(H.x0), A = [U(H.top), V(R.YB - H.r * R.PPM)], B = [U(H.bot), V(R.YB + H.r * R.PPM)];
  const lu = B[0] - A[0], lv = B[1] - A[1], ll = Math.hypot(lu, lv);
  const [w0, wm, w1, wd] = H.waist, uw0 = U(w0), uwm = U(wm), uw1 = U(w1), uIn = U(H.x0 + 6);
  const um = (U(H.slots[0]) + U(H.slots[1])) / 2, hl = (U(H.slots[1]) - U(H.slots[0])) / 2, hs = H.slotW / 2;
  const dirs = H.angles.map((a) => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)]);
  // Prüfung 25.10.: vorher glatter Zylinder mit schmalen Langlöchern und einem dunklen Innenzylinder, der oben aus dem
  // Schrägschnitt ragte – jetzt der Käfig wie im Foto, innen weit (Durchblick durch die Fenster), dunkel nur der Grund
  if (b.hi) b.shared('daempfer', () => {
    const f = (x, v, u) => {
      const q = v - AX, rr = Math.hypot(x, q);
      const tw = u <= uw0 || u >= uw1 ? 0 : u < uwm ? ss(uw0, uwm, u) : ss(uw1, uwm, u);       // Taille
      let d = roundMax(rr - (H.r - wd * tw), ua - u, 0.0005);
      d = roundMax(d, -((u - A[0]) * lv - (v - A[1]) * lu) / ll, 0.0004);                       // Schrägschnitt (unten länger)
      // innen weit, hinten die Bohrung (kurzer Konus); Innenkanten leicht gerundet – scharf zerfransten sie im Netz
      d = roundMax(d, -(rr - lerp(H.bore, H.inner, ss(ua + 0.0006, uIn + 0.0016, u))), 0.0003);
      for (const [cx, cy] of dirs) {                                                             // vier Fenster (gerundete Rechtecke)
        if (x * cx + q * cy < 0.003) continue;
        d = roundMax(d, -roundRect2(u - um, x * cy - q * cx, hl, hs, H.slotR), 0.0004);         // Kante leicht gerundet
      }
      return d;
    };
    sdfMesh(b, f, [-0.0125, AX - 0.0125, ua - 0.0015], [0.0125, AX + 0.0125, U(H.bot) + 0.0015], NET.daempfer[0], MAT.steel, net('daempfer', { cav: STEEL }));
  });
  else b.cyl(MAT.steel, H.r, H.r, U(H.bot) - ua, 0, AX, (ua + U(H.bot)) / 2, { seg: 6 });
  b.bore(0.0029, 0, AX, ua + 0.0008, { seg: 20 });
  return U(H.bot);
}

// ---------------------------------------------------------------- Abzug, Drehwahlschalter (Teil selector), Halter
const { markTop } = schrift('qx90');
function controls(b, hwAt) {
  // Abzug: gewölbtes Blatt (Kanten stark gerundet), füllt die hintere Mulde der Schlaufe – Prüfung 25.10.: vorher eine
  // kantige Platte mit durchsichtigem Spalt ringsum
  b.side(MAT.black, M(R.TRIGGER), 0.0094, 0, { bevel: b.hi ? 0.0028 : 0, bevelSeg: b.max ? 5 : b.hi ? 3 : 1 });
  // Wahlscheibe (Achse senkrecht), vorn und hinten abgeflacht: die Laschen stehen beidseitig über den Rahmen (Foto
  // x 1349–1438), in die Fingeröffnung ragt nur die vordere Abflachung bis x ≈ 1440 (vorher 6,5 mm weiter)
  const S = R.SELECTOR, [cx, cy] = S.c, P = { part: 'selector' }, Rr = S.r, uc = U(cx), f0 = U(S.flat[0]) - uc, f1 = U(S.flat[1]) - uc;
  b.part('selector', 0, V(cy), uc);
  const N = b.max ? 48 : 28, disc = [];
  for (let i = 0; i < N; i++) { const a = (i / N) * 2 * Math.PI; disc.push([Math.cos(a) * Rr, uc + Math.max(f0, Math.min(f1, Math.sin(a) * Rr))]); }
  b.top(MAT.black, disc, S.h, V(cy), { ...P, bevel: b.hi ? 0.0008 : 0, bevelSeg: 2, curveSeg: 1 });
  if (b.hi) {
    // geriffelter Griffbereich der Laschen (vorn rechts / vorn links wie im Foto), oben die Zeigerkerbe
    const n = b.max ? 9 : 5, a0 = 0.3;
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const a = a0 + (i - (n - 1) / 2) * 0.062, ca = Math.cos(a), sa = Math.sin(a);
      b.box(MAT.black, 0.0012, S.h * 0.86, 0.0012, s * ca * (Rr + 0.0002), V(cy), uc + sa * (Rr + 0.0002), { ...P, ry: -s * a, c: 0.0002 });
    }
    if (!b.lite) b.box('cavity', 0.0008, 0.0004, 0.005, 0, V(cy) + S.h / 2 + 0.0001, uc + f1 - 0.003, { ...P, c: 0 });
    // Stellungen S – 1 – A auf der Oberseite der rechten Lasche (Foto: auf der Scheibe, nicht auf dem Rahmen)
    for (const [k, a] of Object.entries(R.SEL_MARKS)) markTop(b, k === 's' ? 'S' : k === 'e' ? '1' : 'A', Math.cos(a) * 0.0197, V(cy) + S.h / 2 + 0.0001, uc + Math.sin(a) * 0.0197, 0.0021, { part: 'selector', std: true, px: 48, weight: '700' });
  }
  // Magazinhalter-Tasten (beidseitig, in der Tasche des Rahmens), am PC mit Riffeln an der Rückseite
  const [t0, ty0, t1, ty1] = R.CATCH_TAB;
  for (const s of [-1, 1]) {
    const hw = hwAt(U((t0 + t1) / 2), V((ty0 + ty1) / 2));
    b.box(MAT.black, 0.0032, px(ty1 - ty0) - 0.0008, px(t1 - t0), s * (hw - 0.0012), V((ty0 + ty1) / 2), U((t0 + t1) / 2), { c: 0.0005 });
    if (b.max) for (let i = 0; i < 3; i++) b.box('cavity', 0.0034, px(ty1 - ty0) - 0.002, 0.0004, s * (hw - 0.0012), V((ty0 + ty1) / 2), U(t1) - 0.0008 - i * 0.0011, { c: 0 });
  }
}

// ---------------------------------------------------------------- Bot-Stufe (≤ 600 Dreiecke)
function bot(b) {
  b.side(MAT.frame, M(R.BOT_FRAME), 2 * 0.0215, 0, { keepHoles: true, holes: [M(R.BOT_THUMB), M(R.BOT_GUARD)], bevel: 0 });
  b.side(MAT.butt, M([[150, 462], [189, 457], [189, 901], [152, 897]]), 2 * HW.butt, 0, { bevel: 0 });
  b.side(MAT.upper, M(R.BOT_HOUSING), 2 * 0.023, 0, { bevel: 0 });
  const [ox0, oy0, ox1, oy1] = R.OPTIC;
  b.box(MAT.optic, 2 * HW.optic, px(oy1 - oy0), px(ox1 - ox0), 0, V((oy0 + oy1) / 2), U((ox0 + ox1) / 2), {});
  const m = R.MAG;
  b.part('mag', 0, V((m.top + m.bot) / 2), U(1205));
  b.box(MAT.mag, 2 * HW.mag, px(m.bot - m.top), U(m.cap[1]) - U(m.x0), 0, V((m.top + m.bot) / 2), (U(m.x0) + U(m.cap[1])) / 2, { part: 'mag' });
  magRounds(b, { cal: 'p57', axis: 'x', dir: -1, show: 'all', width: 0.0168, depth: 0.042, fol: [0.0158, 0.006, 0.04], folMat: MAT.cap, path: [[0, V(494), U(m.rear + 14)], [0, V(494), U(m.cap[0] - 6)]] });
  b.anchor('magGrab', 0, V(m.top), U(1060), { part: 'mag', data: { w: HW.mag, h: 0.0105 } });
  b.part('charge', 0, V(615), U(1680));
  const [r0, ry0, , ry1] = R.ROD;
  for (const s of [-1, 1]) b.box(MAT.rod, 0.004, px(ry1 - ry0), U(1730) - U(r0), s * (HW.rod + 0.001), V((ry0 + ry1) / 2), (U(r0) + U(1730)) / 2, { part: 'charge' });
  b.anchor('chargeGrab', -HW.knob, V(615), U(1700), { part: 'charge', data: { travel: [0, 0, 0.06], style: 'pull' } });
  const u0 = U(R.BARREL_X0), H = R.HIDER;
  if (b.att && b.att.muendung) return muzzleDevice(b, b.att.muendung, U(1898), AX, 0.0095);
  b.cyl(MAT.steel, H.r, 0.0095, U(H.bot) - u0, 0, AX, (u0 + U(H.bot)) / 2, { seg: 6 });
  return U(H.bot);
}

export function qx90(b) {
  let end, sightV = null;
  if (b.hi) {
    const fr = frame(b);
    housing(b);
    sightV = optic(b);
    magazine(b);
    chargingHandles(b);
    end = barrel(b);
    controls(b, hwFrame);
    // Schrauben beidseitig (Innensechskant, bündig in den Senkungen)
    for (const [su, sv, sh] of fr.screws) for (const s of [-1, 1]) hexScrew(b, MAT.steel, s * sh, sv, su, { r: px(R.SCREW_R), deep: 0.0006 });
  } else {
    end = bot(b);
    const want = b.att && b.att.optik;
    if (want && want !== 'ring') swapOptic(b, 'ring', U(R.OPTIC[0]) + 0.012, V(R.OPTIC[3]) + 0.0107);
    else sightV = V(R.SIGHT_Y);
  }
  // Anker (alle Stufen gleich): Mündung, Auswurf (unten hinter dem Griff), Abzug, Hände, Schacht, Visier
  b.anchor('muzzle', 0, AX, end + 0.002);
  b.anchor('ejection', 0, V(R.EJECT[1]) - 0.004, U((R.EJECT[0] + R.EJECT[2]) / 2), { rz: -Math.PI / 2 });
  b.anchor('trigger', 0, V(735), U(1410));
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.75, gw: 0.0185, gd: 0.019, gu: 0, ho: 0.012, tu: 0.032 } });
  b.anchor('leftHandGrip', 0, V(800), U(1612), { data: { style: 'post', rake: 0.45, gw: 0.0165, gd: 0.016, gu: 0, ho: 0.012 } });
  b.anchor('magWell', 0, V((R.MAG.top + R.MAG.bot) / 2), U(1205));
  // Ringvisier (Werksoptik, auch beim Aufsatz „Ringvisier“): Anker an der Hinterkante des Visierblocks; fremde Optiken
  // setzen ihren eigenen Anker (swapOptic). Augenabstand 0,22 (Prüfung 25.10.: 0,2 verdeckte 35 % der Bildmitte, Ziel
  // 22–34 %; 0,22 → 32 % – kleiner wäre schlechter: 0,18 → 38 %, 0,17 → 40 %)
  if (sightV !== null) b.anchor('sight', 0, sightV, U(R.OPTIC[0]), { data: { type: 'reddot', eyeRelief: 0.22 } });
  // Drehwahlschalter (Achse senkrecht): Einzel/Dauer aus der Stellung SICHER (gebaut) um ≈ 25°/50° gedreht
  // Kontaktgitter (Hände) auf 3,5-mm-Raster: die großen Schalenflächen ergaben bei 3 mm 53 000 Dreiecke (Budget 45 000)
  b.meta = { sight: 'reddot', axis: AX, kind: 'smg', selector: { axis: 'v', semi: -0.44, auto: -0.88 }, contactQuant: 0.0035 };
}
