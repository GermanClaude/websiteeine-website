// ZW-12 Zwilling – Doppelflinte mit Kipplauf nach Referenzfotos (zwilling-ref.js: Baikal IZH-43E für Basküle, Läufe,
// Vorderschaft und Bedienteile, Coach Gun für Lauflänge 508 mm und den geraden Kolben). Nutzerwunsch 24./26.10.2026: „mehr
// Waffen, unterschiedlichere Waffen … ultra realistischer Detailgrad wie M-17/P-9“.
// Bauteile:
//   – Läufe (beweglich, Teil „barrels“, dreht um den Scharnierstift): zwei Drehteile (Patronenlager 23,6 mm → Mündung 20,2 mm,
//     leicht zusammenlaufend) mit Bohrung, Randaussparung und Lagermund, erhabene Laufschiene mit Längsrillen (steigt zum
//     Stoßboden um 5,5 mm – wie im Foto), untere Schiene, Messing-Perlkorn, Kopfstück mit Laufhaken, Vorderschaft (Walnuss,
//     Holz-Atlas mit Fischhaut-Raute) samt Vorderschafteisen und Verschlusshebel, Riemenbügel;
//   – Auszieher (Teil „extractor“ in den Läufen) hebt beim Öffnen beide Patronen (Teile „shellR“/„shellL“, rote Hülse, Messingboden,
//     Zündhütchen) an;
//   – Basküle (fest, Distanzfeld): Stoßboden mit Rundungen um die Lager, Schlagbolzenbuchsen, Bahn mit Schlitz für die Laufhaken,
//     rundes Kopfstück mit Stiftköpfen, Abzugsblech; Oberhebel (Teil „toplever“, dreht beim Öffnen nach rechts), oberes
//     Schaftblech mit Schiebesicherung („S“), Abzugsbügel, zwei Abzüge (vorn rechter, hinten linker Lauf);
//   – Schaft (Walnuss, Distanzfeld mit eigener Breite je Längsstelle, Fischhaut am Pistolengriff), Griffkappe, Schaftkappe.
// Detailstufen: PC hoch/ultra (max), PC niedrig/mittel, Handy (lite), Bots (≈ 300 Dreiecke, „barrels“ bleibt eigenes Teil) –
// Anker in allen Stufen gleich (Hände, Visier, zwei Mündungen).
import * as R from './zwilling-ref.js';
import { woodUV } from './zwilling-tex.js';
import { extrudeRound, simplifyRing } from './sdf.js';
import { STEEL, field2, sdfMesh } from './sdfkit.js';
import { schrift } from './schrift.js';

const { U, V, M } = R;
const AX = R.AXIS, UB = U(R.BREECH_X), LEN = R.LEN;
const PU = U(R.PIVOT[0]), PV = V(R.PIVOT[1]);
const HW_ACT = 0.0232;                                        // halbe Baskülenbreite = Läufe am Stoßboden (2 × 23,6 mm)
const G2 = (b, s) => (b.max ? s : b.lite ? s * 2.4 : s * 1.7);   // Raster der Umrissfelder je Stufe
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const tab = (T, t) => {
  if (t <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (t <= T[i][0]) { const [a, va] = T[i - 1], [c, vc] = T[i]; return va + (vc - va) * (t - a) / (c - a); }
  return T[T.length - 1][1];
};
/** Außenradius bzw. Achsabstand eines Laufs über den Abstand d vom Stoßboden. */
export const barrelR = (d) => tab(R.BARREL_R, d);
export const barrelX = (d) => R.BX0 + (R.BX1 - R.BX0) * clamp01(d / LEN);
const YAW = Math.atan((R.BX0 - R.BX1) / LEN);
const { mark, markTop } = schrift('zwilling');

export function zwilling(b) {
  // ---------------------------------------------------------------- bewegliche Teile (alle Stufen gleich)
  b.part('barrels', 0, PV, PU);
  b.part('extractor', 0, AX - 0.0072, UB, 'barrels');
  b.part('shellR', R.BX0, AX, UB, 'extractor');
  b.part('shellL', -R.BX0, AX, UB, 'extractor');
  const [lx, ly] = R.TOPLEVER.pivot;
  b.part('toplever', 0, V(ly), U(lx));
  if (b.hi) {
    b.shared('schaft', () => stockMesh(b));
    b.shared('vorderschaft', () => foreMesh(b));
    b.shared('baskuele', () => actionMesh(b));
    barrels(b);
    details(b);
  } else botTier(b);
  shells(b);
  // ---------------------------------------------------------------- Anker
  const uM = U(R.MUZZLE_X);
  b.anchor('muzzle', R.BX1, AX, uM + 0.002, { part: 'barrels' });     // rechter Lauf (vorderer Abzug) zuerst
  b.anchor('muzzle2', -R.BX1, AX, uM + 0.002, { part: 'barrels' });
  // Griff aus dem Foto: Vorderkante 33° geneigt, Hals 33 mm breit; Anker 23 mm hinter der Vorderkante unter der Handwurzel
  const grip = { rake: 0.57, gw: 0.0165, gd: 0.021, gu: 0.0, ho: 0.004, tu: 0.05 };
  b.anchor('rightHandGrip', 0, 0, 0, { data: grip });
  b.anchor('trigger', 0, V(588), U(2618));
  // Stützhand unter dem Vorderschaft (Anker im Teil – die Hand folgt den Läufen beim Öffnen)
  // Griffquerschnitt = Vorderschaft + Läufe (Unterkante 510 px bis Laufoberkante): die Finger bleiben unter der Schiene (Prüfbild:
  // mit Mitte auf der Laufachse griffen sie über die Läufe und verdeckten im Anschlag das Perlkorn)
  b.anchor('leftHandGrip', 0, V(508), U(2020), { part: 'barrels', data: { style: 'under', w: 0.024, h: 0.0165 } });
  b.anchor('barrelGrab', -0.0255, V(462), U(2140), { part: 'barrels' });   // Daumen/Finger links am Vorderschaft (Bots, Kippen)
  // Auge 30 mm über der Schiene: man blickt die Schiene entlang aufs Perlkorn (2,4° unter der Bildmitte); tiefer verdeckte die
  // Schusshand auf dem Kolbenhals im Anschlag die halbe Sicht (Prüfbilder 26.10.). Abstand wie am Original (Abzug → Auge ≈ 27 cm)
  b.anchor('sight', 0, AX + R.RIB_H(0) + 0.03, UB - 0.004, { data: { type: 'iron', eyeRelief: 0.3 } });
  b.anchor('chamberR', R.BX0, AX, UB, { part: 'barrels' });
  b.anchor('chamberL', -R.BX0, AX, UB, { part: 'barrels' });
  b.anchor('shellPort', 0, AX, UB - 0.01, { part: 'barrels' });
  b.meta = { sight: 'iron', axis: AX, kind: 'shotgun', hidden: ['shellR', 'shellL'], breakOpen: R.OPEN };
}

// ---------------------------------------------------------------- Läufe (Drehteile, Schienen, Kopfstück)
function barrels(b) {
  const P = { part: 'barrels' };
  const seg = b.max ? 40 : b.lite ? 20 : 28;
  for (const s of [1, -1]) {
    // Außenkontur vom Lagermund bis zur Mündung, innen Lager (hinten) bzw. Bohrung (vorn) ein Stück hinein
    const out = [[0.014, R.CHAMBER], [0.0016, R.CHAMBER], [0.0016, R.RIM], [0, R.RIM]];
    for (const [d, r] of R.BARREL_R) out.push([Math.max(0, d), r]);
    out.push([LEN, R.BORE + 0.0006], [LEN - 0.0008, R.BORE], [LEN - 0.012, R.BORE]);
    if (b.max) out.splice(4, 0, [0, R.BARREL_R[0][1] - 0.0004]);    // gebrochene Kante am Lagermund
    b.lathe('zwBarrel', out, s * R.BX0, AX, UB, { ...P, seg, ry: s * YAW });
    // Bohrung: dunkler Grund vorn (zeigt nach vorn) und im leeren Lager (zeigt nach hinten), blanke Krone
    b.circle('cavity', R.BORE, s * R.BX1, AX, UB + LEN - 0.010, { ...P, seg: 24, ry: Math.PI });
    b.lathe('crown', [[LEN - 0.0012, R.BORE + 0.0001], [LEN - 0.0001, R.BORE + 0.0011]], s * R.BX0, AX, UB, { ...P, seg: 28, ry: s * YAW });
    b.circle('cavity', R.CHAMBER, s * R.BX0, AX, UB + 0.012, { ...P, seg: 24 });
  }
  // Laufschiene oben: steigt zum Stoßboden (Foto), Längsrillen gegen Blendung (max als Kerben im Querschnitt)
  const rib = (top, w) => {
    const pts = [[-w, top - 0.0068], [w, top - 0.0068], [w, top - 0.0005], [w - 0.0006, top]];
    if (b.max) for (let i = 1; i < 7; i++) { const x = w - 0.0006 - i * (2 * (w - 0.0006) / 7); pts.push([x + 0.00035, top], [x, top - 0.00028], [x - 0.00035, top]); }
    pts.push([-w + 0.0006, top], [-w, top - 0.0005]);
    return pts;
  };
  const d1 = 0.415, slope = Math.atan((R.RIB_H(0) - R.RIB_H(d1)) / d1);
  b.front('zwBarrel', rib(0, 0.0043), d1 + 0.001, UB, { ...P, v: AX + R.RIB_H(0), rx: -slope });
  b.front('zwBarrel', rib(0, 0.0041), LEN - d1 - 0.0015, UB + d1, { ...P, v: AX + R.RIB_H(d1) });
  // untere Schiene (vom Vorderschaft bis zur Mündung)
  const dF = (R.BREECH_X - 1700) / R.PPM;
  b.front('zwBarrel', [[-0.0031, -R.RIB_LOW], [0.0031, -R.RIB_LOW], [0.004, -0.0075], [-0.004, -0.0075]], LEN - dF - 0.0015, UB + dF, { ...P, v: AX, bevel: 0.0004 });
  // Perlkorn (Messing) auf der Schiene
  b.sphere('brass', 0.00185, 0, AX + R.RIB_H(R.BEAD_D) + 0.0011, UB + R.BEAD_D, { ...P, seg: 16, hseg: 10 });
  // Kopfstück unter den Läufen (sitzt auf der Bahn) mit Laufhaken – bei offener Waffe sichtbar
  b.side('zwBlued', M([[2530, R.AXIS_Y], [2366, R.AXIS_Y], [2366, R.BAR_TOP_Y], [2530, R.BAR_TOP_Y]]), 0.0466, 0, { ...P, bevel: 0.0012 });
  b.side('zwBarrel', M(R.LUMPS), 0.0128, 0, { ...P, bevel: 0.0008 });
  // Lagerstirn: Laufflachen-Prägung (max), Auszieher-Ausschnitt dunkel
  if (b.max) for (const s of [1, -1]) mark(b, s > 0 ? '12/76' : 'ZW-12  4417', s * 0.0234, V(468), U(2450), 0.0032, { part: 'barrels', px: 48 });
}

// ---------------------------------------------------------------- Schaft, Vorderschaft, Basküle (Distanzfelder)
function stockField(b, cut = true) {
  const sd = field2(M(R.STOCK), [], G2(b, 0.0006));
  const uBt = U(R.BUTT_X);
  return (x, v, u) => {
    const d2 = sd(u, v);
    if (d2 > 0.008) return d2;
    const hw = tab(R.STOCK_HW, u);
    const d = extrudeRound(d2, x, hw, hw * 0.74);
    return cut ? Math.max(d, uBt - u) : d;
  };
}
function stockMesh(b) {
  const f = stockField(b), uBt = U(R.BUTT_X);
  sdfMesh(b, f, [-0.024, V(1014), uBt - 0.002], [0.024, V(398), U(2594)], 0.0028, 'zwWood', { uv: woodUV, cav: { r: 0.0016, edge: 0.4, cavity: 0.55 }, fine: 0.62, lite: 1.4 });
  // Schaftkappe (Kunststoff, 8 mm): gleiche Kontur, hinten leicht gewölbt
  const g = stockField(b, false), u1 = U(3834);
  const pad = (x, v, u) => Math.max(g(x, v, u), u - uBt - 0.0003, u1 + 0.002 * (x * x / 0.0004) - u);
  sdfMesh(b, pad, [-0.024, V(1014), u1 - 0.004], [0.024, V(580), uBt + 0.003], 0.0022, 'rubber', { fine: 0.7, lite: 1.4 });
}
function foreField(b) {
  const sd = field2(M(R.FORE), [], G2(b, 0.0005));
  const hw = 0.0236, vR = V(445);
  return (x, v, u) => {
    const d2 = sd(u, v);
    if (d2 > 0.006) return d2;
    const r = 0.0028 + 0.0052 * clamp01((vR - v) / 0.012);       // unten breit gerundet (Biberschwanz), oben schmale Wand
    let d = extrudeRound(d2, x, hw, r);
    const db = UB - u, ch = Math.hypot(Math.abs(x) - barrelX(db), v - AX) - barrelR(db) - 0.0003;
    return Math.max(d, -ch);                                     // Rinne für die Läufe
  };
}
function foreMesh(b) {
  sdfMesh(b, foreField(b), [-0.026, V(536), U(2366)], [0.026, V(418), U(1654)], 0.0024, 'zwWood', { uv: woodUV, cav: { r: 0.0016, edge: 0.4, cavity: 0.55 }, fine: 0.62, lite: 1.4, part: 'barrels' });
}
function actionField(b) {
  const sd = field2(M(R.ACTION), [], G2(b, 0.0004));
  const uF = U(2612), vStrap = V(404), vBar = V(R.BAR_TOP_Y), s0 = U(2516), s1 = U(2396);
  return (x, v, u) => {
    const d2 = sd(u, v);
    if (d2 > 0.006) return d2;
    const ax = Math.abs(x);
    let d = extrudeRound(d2, x, HW_ACT, 0.0026);
    // Rundungen hinter dem Stoßboden um die Lagerachsen (Foto: Oberkante fällt in einem Bogen zum Oberhebel)
    if (u < UB + 0.001 && u > uF && v > vStrap - 0.003) {
      const t = (UB - u) / (UB - uF), rf = 0.0151 - 0.0064 * t;
      d = Math.max(d, Math.min(Math.hypot(ax - R.BX0, v - AX) - rf, v - vStrap));   // unter der Hebelebene frei, darüber nur in den Rundungen
    }
    // Schlitz in der Bahn für die Laufhaken (geschlossen verdeckt, offen sichtbar)
    if (v > vBar - 0.016 && u > s0 - 0.001 && u < s1 + 0.001) d = Math.max(d, -Math.max(ax - 0.0069, vBar - 0.0148 - v, s0 - u, u - s1));
    return d;
  };
}
function actionMesh(b) {
  sdfMesh(b, actionField(b), [-HW_ACT - 0.003, V(562), U(2656)], [HW_ACT + 0.003, V(354), U(2334)], 0.0014, 'zwBlued', { cav: STEEL, fine: 0.62, lite: 1.4 });
}

// ---------------------------------------------------------------- Kleinteile, Bedienteile
function details(b) {
  const P = { part: 'barrels' };
  // Vorderschafteisen unten (folgt der Unterkante), Verschlusshebel
  const [i0, i1] = R.FORE_IRON, fy = R.FORE_BOTTOM;
  const sl = Math.atan((fy(i1) - fy(i0)) / (i1 - i0));
  b.front('zwBlued', [[-0.0082, 0], [0.0082, 0], [0.0088, 0.0016], [-0.0088, 0.0016]], (i1 - i0) / R.PPM, U(i1), { ...P, v: V(fy(i1)) - 0.0009, rx: sl, bevel: 0.0003 });
  const [l0, l1, lyy] = R.FORE_LATCH;
  b.box('zwBlued', 0.0058, 0.0032, (l1 - l0) / R.PPM, 0, V(lyy), U((l0 + l1) / 2), { ...P, c: 0.0007 });
  // Riemenbügel vorn an der unteren Schiene, hinten am Kolben
  const [sx, sy] = R.SWIVEL_F;
  b.box('zwBlued', 0.004, 0.004, 0.009, 0, V(sy) - 0.0015, U(sx), { ...P, c: 0.0006 });
  b.torus('zwBlued', 0.0085, 0.0011, 0, V(sy) - 0.0105, U(sx), { ...P, ry: Math.PI / 2, seg: 8, tseg: 20 });
  const [tx, ty] = R.SWIVEL_R;
  b.cyl('zwBlued', 0.0035, 0.0045, 0.006, 0, V(ty) - 0.001, U(tx), { axis: 'v', seg: 12 });
  b.torus('zwBlued', 0.0095, 0.0012, 0, V(ty) - 0.012, U(tx), { ry: Math.PI / 2, rx: 0.35, seg: 8, tseg: 20 });
  // Abzugsbügel (Rundstahl, breitgezogen), Riemen dahinter; Abzüge (vorn gerade, hinten gekrümmt)
  const pt = (x, y) => [0, V(y), U(x)];
  b.tube('zwBlued', R.GUARD.map(([x, y]) => pt(x, y)), 0.0026, { sx: 1.55, seg: 10, tubSeg: 40 });
  const [g0, g1, gy] = R.GUARD_STRAP;
  b.box('zwBlued', 0.0092, 0.0024, (g1 - g0) / R.PPM, 0, V(gy), U((g0 + g1) / 2), { rx: 0.1, c: 0.0007 });
  b.tube('zwPolish', R.TRIG_F.map(([x, y]) => pt(x, y)), 0.0018, { sx: 1.35, seg: 8, tubSeg: 14 });
  b.tube('zwPolish', R.TRIG_R.map(([x, y]) => pt(x, y)), 0.0018, { sx: 1.35, seg: 8, tubSeg: 14 });
  // Griffkappe
  b.side('zwBlued', M(R.GRIP_CAP), 0.027, 0, { bevel: 0.0035, bevelSeg: 2 });
  // Oberes Schaftblech + Schiebesicherung (Kolbenhals oben)
  const [[a0, b0], [a1, b1]] = R.TANG, ta = Math.atan((b1 - b0) / (a1 - a0));
  b.box('zwBlued', 0.0128, 0.0018, Math.hypot(a1 - a0, b1 - b0) / R.PPM, 0, V((b0 + b1) / 2) + 0.0004, U((a0 + a1) / 2), { rx: ta, c: 0.0006 });
  const [fx, fyy] = R.SAFETY;
  b.box('zwBlued', 0.0074, 0.0032, 0.0105, 0, V(fyy) + 0.0019, U(fx), { rx: ta, c: 0.0009 });
  if (b.max) {
    for (let i = -1; i <= 1; i++) b.box('zwPolish', 0.0068, 0.0006, 0.0008, 0, V(fyy) + 0.0036 - i * 0.0002, U(fx) + i * 0.0026, { rx: ta, c: 0 });
    const tyAt = (x) => b0 + (x - a0) * (b1 - b0) / (a1 - a0);
    markTop(b, 'S', 0, V(tyAt(fx + 22)) + 0.0023, U(fx + 22), 0.0034, { px: 48, weight: '700' });
    mark(b, 'ZW-12', -HW_ACT - 0.0001, V(503), U(2470), 0.0042, { px: 48 });
    mark(b, '12/76 · 70 mm', HW_ACT + 0.0001, V(503), U(2470), 0.0032, { px: 48 });
  }
  // Scharnierstift-Köpfe beidseitig, Schlagbolzenbuchsen im Stoßboden, Stifte des Schlosses
  for (const s of [1, -1]) {
    b.cyl('zwPolish', 0.0046, 0.0046, 0.0007, s * (HW_ACT + 0.0002), PV, PU, { axis: 'x', seg: 20 });
    if (!b.lite) b.box('cavity', 0.0002, 0.0007, 0.0068, s * (HW_ACT + 0.0006), PV, PU, { c: 0 });
    b.cyl('zwPolish', 0.0034, 0.0034, 0.0008, s * R.BX0, AX, UB - 0.0002, { seg: 16 });
    b.circle('cavity', 0.001, s * R.BX0, AX, UB + 0.0003, { seg: 10, ry: Math.PI });
    if (!b.lite) for (const [px, py] of [[2452, 492], [2575, 500]]) b.cyl('zwPolish', 0.0021, 0.0021, 0.0005, s * (HW_ACT + 0.0001), V(py), U(px), { axis: 'x', seg: 12 });
  }
  // Oberhebel: Daumenstück nach hinten, Nabe über der Spindel, Riffelung (max)
  const [lx, ly] = R.TOPLEVER.pivot, ut = U(R.TOPLEVER.tail), up = U(lx);
  const vL = V((R.TOPLEVER.top + R.TOPLEVER.bot) / 2), hL = (R.TOPLEVER.bot - R.TOPLEVER.top) / R.PPM;
  b.top('zwBlued', [[-0.0058, up + 0.004], [0.0058, up + 0.004], [0.0088, ut + 0.012], [0.0082, ut + 0.002], [0.0062, ut], [-0.0062, ut], [-0.0082, ut + 0.002], [-0.0088, ut + 0.012]], hL, vL, { part: 'toplever', bevel: 0.0009, bevelSeg: 2 });
  b.cyl('zwBlued', 0.0062, 0.0062, hL + 0.0006, 0, vL, up, { axis: 'v', part: 'toplever', seg: 20 });
  if (b.max) for (let i = 0; i < 6; i++) b.box('zwPolish', 0.0128, 0.0004, 0.0007, 0, vL + hL / 2 + 0.0001, ut + 0.0035 + i * 0.0022, { part: 'toplever', c: 0 });
  // Auszieher: Steg zwischen den Lagern + Ohren um die Patronenränder (max)
  const E = { part: 'extractor' };
  b.box('zwPolish', 0.0058, 0.006, 0.026, 0, AX - 0.009, UB + 0.013, { ...E, c: 0.0005 });   // passt unter die Lager (Spalt dort 6 mm)
  if (b.max) for (const s of [1, -1]) b.lathe('zwPolish', [[0, R.CHAMBER + 0.0001], [0, R.RIM - 0.0001], [0.0014, R.RIM - 0.0001], [0.0014, R.CHAMBER + 0.0001]], s * R.BX0, AX, UB, { ...E, seg: 16, t0: s > 0 ? Math.PI : Math.PI / 2, tl: Math.PI / 2 });
}

// ---------------------------------------------------------------- Patronen in den Lagern (rote Hülse, Messingboden)
function shells(b) {
  if (!b.hi) return;   // Bots: Teile ohne Netz (Patronen nur beim Nachladen in der Ego-Ansicht sichtbar)
  for (const [part, s] of [['shellR', 1], ['shellL', -1]]) {
    const x = s * R.BX0, o = { part, seg: 20 };
    {
      b.lathe('brass', [[-0.0001, 0.0028], [-0.0001, 0.0111], [0.0012, 0.0111], [0.0012, 0.0101], [0.012, 0.0101]], x, AX, UB, o);
      b.lathe('shellRed', [[0.0118, 0.0099], [0.058, 0.0099], [0.0618, 0.0086], [0.0626, 0.0035], [0.0626, 0]], x, AX, UB, o);
      b.circle('brass', 0.0029, x, AX, UB - 0.0002, { part, seg: 14 });
      b.circle('zwPolish', 0.0024, x, AX, UB - 0.0003, { part, seg: 14 });
    }
  }
}

// ---------------------------------------------------------------- Bot-Stufe (≈ 300 Dreiecke, Teile wie oben)
function botTier(b) {
  const sp = (pts, tol) => simplifyRing(M(pts), tol);
  for (const s of [1, -1]) b.cyl('zwBarrel', R.BARREL_R[4][1], R.BARREL_R[0][1], LEN, s * (R.BX0 + R.BX1) / 2, AX, UB + LEN / 2, { part: 'barrels', seg: 6 });
  b.box('zwBarrel', 0.008, 0.012, LEN * 0.9, 0, AX + 0.004, UB + LEN * 0.45, { part: 'barrels' });
  b.side('zwWood', sp(R.FORE, 0.004), 0.047, 0, { part: 'barrels' });
  b.side('zwBlued', sp(R.ACTION, 0.003), HW_ACT * 2, 0, {});
  b.side('zwWood', sp(R.STOCK, 0.006), 0.038, 0, {});
  b.tube('zwBlued', R.GUARD.filter((_, i) => i % 2 === 0).map(([x, y]) => [0, V(y), U(x)]), 0.003, { seg: 3, tubSeg: 4 });
}
