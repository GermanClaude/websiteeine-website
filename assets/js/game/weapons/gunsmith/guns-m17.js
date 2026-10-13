// M-17 Falke nach Referenzfoto (M4-Karabiner mit Schienen-Handschutz, m17-ref.js) – Nutzer 13.10.2026: „mit der
// Standardwaffe, um zu sehen, wie es ist“. Verfahren wie bei der P-9: Umrisse aus dem gerade gestellten Foto
// verfolgt und kalibriert, Bauteile als Distanzfelder (Profil × eigene Breite, weich vereinigt, Fenster/Nuten/Schächte
// abgezogen), Schaft und Griff mit eigenem Atlas, Gravuren als Schriftfelder. Der gemeinsame AR-Unterbau (arLower in
// guns-ar.js) bleibt für SK-14 und Ursprung unverändert.
import * as R from './m17-ref.js';
import { furnUV, markMat, markAspect } from './m17-tex.js';
import { atlasUV } from './p9-tex.js';
import { sdPolygon, extrudeRound, smin, surfaceNets, sdBox, grid2D, simplifyPoly } from './sdf.js';
import { roundRect } from './builder.js';
import { holoSight, birdcage } from './parts.js';
import { magRounds } from './magfill.js';
import * as THREE from 'three';

const { U, V } = R;
const AX = R.AXIS;
const box2 = (pts, m = 0.003) => { const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]); return [Math.min(...us) - m, Math.max(...us) + m, Math.min(...vs) - m, Math.max(...vs) + m]; };
// Polygon(e) als vorgerechnetes 2D-Feld über ihrem Hüllrechteck (u, v)
function field2(pts, holes = [], step = 0.0005) {
  const [u0, u1, v0, v1] = box2(pts, 0.008);
  return grid2D((u, v) => { let d = sdPolygon(u, v, pts); for (const h of holes) d = Math.max(d, -sdPolygon(u, v, h)); return d; }, u0, u1, v0, v1, step);
}
// Schriftfeld (Gravur) als Fläche auf einer Seitenfläche: side = +1 rechts, −1 links; h = Schrifthöhe in m
function mark(b, text, x, v, u, h, o = {}) {
  if (!b.hi) return;
  const asp = markAspect(text, o);
  const geo = new THREE.PlaneGeometry(o.vertical ? h : h * asp, o.vertical ? h / asp : h);
  const side = Math.sign(x) || 1;
  geo.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  if (o.rx) geo.rotateX(o.rx);
  b._push(geo, markMat(text, o), { x, v, u, part: o.part }, true);
}

export function m17(b) {
  const axis = AX;
  if (b.hi) {
    // ---------------------------------------------------------------- Schaft (Verstellschaft, Polymer)
    const st = R.M(R.STOCK), stD = field2(st, [], 0.0006), vSplit = V(R.STOCK_SPLIT_Y);
    const stockF = (x, v, u) => {
      const d2 = stD(u, v);
      if (d2 > 0.006) return d2;
      const top = extrudeRound(Math.max(d2, vSplit - v), x, 0.03, 0.011);     // Rohr + Wangenauflage (breit, rund)
      const toe = extrudeRound(d2, x, 0.0115, 0.0035);                         // Schaftfuß mit Schlitzen, Hebel
      return smin(top, toe, 0.004);
    };
    const sg = surfaceNets(stockF, [-0.033, V(1528), U(214)], [0.033, V(984), U(1002)], 0.0024);
    b._push(atlasUV(sg, (x, v, u) => furnUV(x, v, u)), 'm17Furn', {}, true);
    // ---------------------------------------------------------------- Griff (A2, Rautenfeld)
    const gp = R.M(R.GRIP), gD = field2(gp, [], 0.0005);
    const gripF = (x, v, u) => { const d2 = gD(u, v); if (d2 > 0.006) return d2; return extrudeRound(d2, x, 0.0128, 0.0072); };
    const gg = surfaceNets(gripF, [-0.015, V(1752), U(950)], [0.015, V(1294), U(1350)], 0.0017);
    b._push(atlasUV(gg, (x, v, u) => furnUV(x, v, u)), 'm17Furn', {}, true);
    // ---------------------------------------------------------------- Unterteil (Gehäuse, Abzugsbügel, Magazinschacht)
    const lo = R.M(R.LOWER), op = R.M(R.OPEN), loD = field2(lo, [op], 0.0005);
    const vGuard = V(R.GUARD_Y), uG0 = U(1342), uW0 = U(R.WELL_X0);
    const [mrx, mry, mrr] = R.MAG_RELEASE, mru = U(mrx), mrv = V(mry), mrR = mrr / R.PPM;
    const well = { u0: U(1556), u1: U(1846), vTop: V(1250) };
    const lowerF = (x, v, u) => {
      const d2 = loD(u, v);
      if (d2 > 0.006) return d2;
      const ax = Math.abs(x);
      let d = extrudeRound(Math.max(d2, u - uW0 - 0.002, Math.min(vGuard - v, u - uG0)), x, 0.0111, 0.0012);     // Gehäuse
      d = smin(d, extrudeRound(Math.max(d2, v - vGuard - 0.002, uG0 - u, u - uW0), x, 0.0058, 0.0018), 0.002);   // Abzugsbügel
      d = smin(d, extrudeRound(Math.max(d2, uW0 - u), x, 0.0132, 0.0025), 0.003);                                // Magazinschacht
      // Schutzrippe um den Magazinknopf (rechts)
      if (x > 0 && Math.abs(u - mru) < 0.012 && Math.abs(v - mrv) < 0.012) d = smin(d, Math.max(Math.abs(Math.hypot(u - mru, v - mrv) - mrR - 0.0022) - 0.0011, Math.abs(x - 0.0119) - 0.0009), 0.0008);
      // Schacht offen: das Magazin steckt sichtbar darin
      d = Math.max(d, -Math.max(ax - 0.0106, well.u0 - u, u - well.u1, v - well.vTop));
      return d;
    };
    const lg = surfaceNets(lowerF, [-0.0168, V(1412), U(1030)], [0.0168, V(1190), U(1872)], 0.0016);
    b._push(lg, 'm17Rec', {});
    // ---------------------------------------------------------------- Oberteil (Gehäuse, Auswurffenster, Hülsenabweiser)
    const upP = R.M(R.UPPER), upD = field2(upP, [], 0.0005);
    const [px0, py0, px1, py1] = R.PORT, port = { u0: U(px0), u1: U(px1), v0: V(py1), v1: V(py0) };
    const defl = R.M(R.DEFLECTOR), dflB = box2(defl);
    const upperF = (x, v, u) => {
      const d2 = upD(u, v);
      if (d2 > 0.006) return d2;
      let d = extrudeRound(d2, x, 0.0112, 0.0016);
      d = Math.max(d, -sdBox(x, v, u, 0.012, (port.v0 + port.v1) / 2, (port.u0 + port.u1) / 2, 0.0082, (port.v1 - port.v0) / 2, (port.u1 - port.u0) / 2));
      if (x > 0 && u > dflB[0] && u < dflB[1] && v > dflB[2] && v < dflB[3]) d = smin(d, extrudeRound(sdPolygon(u, v, defl), x - 0.0105, 0.0048, 0.0014), 0.0015);
      return d;
    };
    const ug = surfaceNets(upperF, [-0.0165, V(1200), U(996)], [0.0165, V(956), U(1900)], 0.0017);
    b._push(ug, 'm17Rec', {});
    // ---------------------------------------------------------------- Schienen-Handschutz: Profil + Lüftungsfenster (dunkle Öffnungen)
    const [ra0, ra1] = R.RAS, ru0 = U(ra0), ru1 = U(ra1), H = R.RAS_HALF;
    b.front('m17Ras', roundRect(-H, axis - H, H, axis + H, 0.004, 3), ru1 - ru0, ru0, { bevel: 0.0015 });
    for (const s of [-1, 1]) {
      for (const x of [2049, 2146, 2243, 2340, 2436, 2533, 2630]) b.circle('cavity', 0.0033, s * (H + 0.0002), axis + 0.0143, U(x), { ry: s * Math.PI / 2, sx: 0.0072 / 0.0033, seg: 20 });
      for (const x of [2041, 2122, 2211, 2291, 2372, 2453, 2533, 2614]) b.circle('cavity', 0.0018, s * (H + 0.0002), axis - 0.0156, U(x), { ry: s * Math.PI / 2, sx: 0.0046 / 0.0018, seg: 16 });
    }
    // ---------------------------------------------------------------- Kornträger (A-Rahmen mit Fenster, Bajonetthalter, Riemenbügel)
    const fs = R.M(R.FSB), fh = R.M(R.FSB_HOLE), fD = field2(fs, [fh], 0.0004);
    const fa = U(2778), fb = U(2888);
    const fsbF = (x, v, u) => {
      const d2 = fD(u, v);
      if (d2 > 0.005) return d2;
      const d = extrudeRound(d2, x, 0.0062, 0.0011);
      return Math.max(d, -Math.max(Math.abs(v - axis) - 0.0091, Math.min(u - fa, fb - u)));   // Lauf läuft frei durch (außer im Fuß)
    };
    const fg = surfaceNets(fsbF, [-0.0078, V(1262), U(2686)], [0.0078, V(738), U(2944)], 0.0011);
    b._push(fg, 'm17Steel', {});
  } else {
    // Bot-Detailstufe: dieselben Fotoumrisse, stark vereinfacht
    b.side('polymer', simplifyPoly(R.M(R.STOCK), 0.004), 0.052, 0, { bevel: 0.008, bevelSeg: 1 });
    b.side('polymer', simplifyPoly(R.M(R.GRIP), 0.003), 0.025, 0, { bevel: 0.005, bevelSeg: 1 });
    b.side('alu', simplifyPoly(R.M(R.LOWER), 0.003), 0.024, 0, { bevel: 0.002 });
    b.side('alu', simplifyPoly(R.M(R.UPPER), 0.003), 0.023, 0, { bevel: 0.002 });
    b.box('alu', R.RAS_HALF * 2 + 0.008, R.RAS_HALF * 2 + 0.008, U(R.RAS[1]) - U(R.RAS[0]), 0, axis, (U(R.RAS[0]) + U(R.RAS[1])) / 2, { c: 0.004 });
    b.side('steel', simplifyPoly(R.M(R.FSB), 0.003), 0.012, 0, { bevel: 0.001 });
  }
  // ---------------------------------------------------------------- Pufferrohr, Schlossmutter, Endplatte
  const [t0, t1] = R.TUBE;
  b.cyl('m17Rec', R.TUBE_R, R.TUBE_R, U(t1) - U(t0) + 0.01, 0, axis, (U(t0) + U(t1)) / 2 - 0.005, { seg: b.seg(20, 6) });
  if (b.hi) {
    b.cyl('m17Steel', 0.0176, 0.0176, 0.007, 0, axis, U(t1) - 0.006, { seg: 24 });
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; b.box('cavity', 0.0022, 0.0022, 0.0074, Math.cos(a) * 0.0172, axis + Math.sin(a) * 0.0172, U(t1) - 0.006, { c: 0 }); }
    b.cyl('m17Steel', 0.0196, 0.0196, 0.0028, 0, axis, U(t1) - 0.0012, { seg: 24 });
    b.cyl('m17Steel', 0.0045, 0.0045, 0.006, -0.018, axis - 0.012, U(t1) - 0.0012, { axis: 'x', seg: 12 });
  }
  // ---------------------------------------------------------------- Schiene oben, Ladehebel, Verschluss, Staubschutzdeckel
  b.rail('m17Rec', 0, 0.1163, U(R.UPPER_X0) + 0.002, U(R.UPPER_X1) - 0.002);
  b.part('charge', 0, 0.1145, U(1000));
  b.box('m17Rec', 0.012, 0.0068, 0.03, 0, 0.1145, U(1000) + 0.011, { part: 'charge', c: 0.0015 });
  b.box('m17Rec', 0.042, 0.0078, 0.011, 0, 0.1145, U(1000) - 0.004, { part: 'charge', c: 0.002 });
  if (b.hi) b.box('m17Rec', 0.006, 0.0055, 0.012, -0.0235, 0.1145, U(1000) - 0.001, { part: 'charge', c: 0.001 });
  b.anchor('chargeGrab', -0.012, 0.1145, U(1000) - 0.006, { part: 'charge', data: { travel: [0, 0, 0.065], style: 'release' } });
  const [px0, py0, px1, py1] = R.PORT, pu = (U(px0) + U(px1)) / 2, pl = U(px1) - U(px0), pv = (V(py0) + V(py1)) / 2, ph = V(py0) - V(py1);
  b.part('bolt', 0, axis, pu);
  b.box('m17Steel', 0.006, ph - 0.002, pl - 0.004, 0.0062, pv, pu, { part: 'bolt', c: 0.001 });
  if (b.hi) {
    for (let i = 0; i < 7; i++) b.box('cavity', 0.0004, 0.0042, 0.0016, 0.0094, pv + 0.004, pu - 0.03 + i * 0.0032, { part: 'bolt', c: 0 });   // Verriegelungszähne
    b.box('cavity', 0.0004, 0.0016, pl - 0.012, 0.0094, pv - 0.0045, pu, { part: 'bolt', c: 0 });
    // Staubschutzdeckel offen nach unten geklappt, Scharnierstange, Riegelnase
    const [dx0, dy0, dx1, dy1] = R.DUST_COVER;
    b.box('m17Rec', 0.0013, V(dy0) - V(dy1), U(dx1) - U(dx0), 0.0126, (V(dy0) + V(dy1)) / 2, (U(dx0) + U(dx1)) / 2, { c: 0.0005 });
    b.cyl('steel', 0.0011, 0.0011, U(dx1) - U(dx0) + 0.004, 0.0122, V(dy0) - 0.0006, (U(dx0) + U(dx1)) / 2, { seg: 8 });
    b.box('m17Rec', 0.003, 0.004, 0.006, 0.0137, V(dy0) - 0.006, U(1640), { c: 0.001 });
    // Vorderer Hilfsschließer (Rohr rechts hinten) mit gerilltem Knopf
    const [fx0, fy0, fx1, fy1] = R.FWD_ASSIST, fu = (U(fx0) + U(fx1)) / 2, fv = (V(fy0) + V(fy1)) / 2;
    b.cyl('m17Rec', 0.0072, 0.0078, U(fx1) - U(fx0), 0.0128, fv, fu, { ry: -0.28, seg: 18 });
    b.cyl('knurl', 0.0066, 0.0066, 0.008, 0.0158, fv, U(fx0) + 0.002, { ry: -0.28, seg: 16 });
  }
  b.anchor('ejection', 0.012, pv, pu + 0.01, { rz: 0.5 });
  // ---------------------------------------------------------------- Stifte, Wahlhebel, Magazinknopf, Verschlussfang, Abzug
  if (b.hi) {
    for (const [x, y, r] of R.PINS.slice(0, 2)) for (const s of [-1, 1]) b.cyl('m17Steel', r / R.PPM, r / R.PPM, 0.0016, s * 0.0118, V(y), U(x), { axis: 'x', seg: 16 });
    const [sx, sy, sr] = R.PINS[2];
    b.cyl('m17Steel', sr / R.PPM, sr / R.PPM, 0.0018, 0.0119, V(sy), U(sx), { axis: 'x', seg: 18 });
    b.cyl('m17Steel', 0.0058, 0.0058, 0.003, -0.0126, V(sy), U(sx), { axis: 'x', seg: 16 });
    b.box('m17Steel', 0.0028, 0.0042, 0.017, -0.0142, V(sy) + 0.003, U(sx) + 0.006, { rx: -0.5, c: 0.001 });
    const [mx, my, mr] = R.MAG_RELEASE;
    b.cyl('knurl', mr / R.PPM, mr / R.PPM, 0.0034, 0.0124, V(my), U(mx), { axis: 'x', seg: 18 });
    b.box('m17Steel', 0.004, 0.018, 0.008, -0.0128, 0.06, 0.068, { c: 0.001 });
    for (let i = 0; i < 4; i++) b.box('cavity', 0.0006, 0.0008, 0.006, -0.0151, 0.054 + i * 0.0032, 0.068, { c: 0 });
    // Gravuren: Wahlhebelstellungen (rechts, wie im Foto), Typ/Kaliber/Nummer links am Magazinschacht
    for (const [k, t] of [['sicher', 'SICHER'], ['einzel', 'EINZEL'], ['dauer', 'DAUER']]) { const [mxp, myp] = R.MARKS[k]; mark(b, t, 0.0113, V(myp), U(mxp), 0.0021); }
    mark(b, 'M-17 FALKE', -0.0145, V(1300), U(1700), 0.0024);
    mark(b, 'KAL 5,56 × 45', -0.0145, V(1322), U(1700), 0.0021);
    mark(b, 'NP 104729', -0.0145, V(1342), U(1700), 0.0021);
  }
  b.side('m17Steel', R.M(R.TRIGGER), 0.0045, 0, { bevel: 0.0006 });
  b.anchor('trigger', 0, V(1335), U(1392));
  b.anchor('boltCatch', -0.0145, 0.062, 0.068);
  // ---------------------------------------------------------------- Delta-Ring, Lauf, Schienen, Kornträger-Fuß, Feuerdämpfer
  const [d0, d1] = R.DELTA, du0 = U(d0), dl = U(d1) - du0;
  const ring = [[0, 0.0175], [0.0015, R.DELTA_R]];
  if (b.hi) for (let i = 0; i < 6; i++) { const t = 0.006 + i * (dl - 0.012) / 5; ring.push([t - 0.001, R.DELTA_R], [t - 0.0004, R.DELTA_R - 0.0007], [t + 0.0004, R.DELTA_R - 0.0007], [t + 0.001, R.DELTA_R]); }
  ring.push([dl - 0.0015, R.DELTA_R], [dl, 0.02]);
  b.lathe('m17Rec', ring, 0, axis, du0, { seg: b.seg(30, 8) });
  const bu0 = U(2640), bp = [[0, 0.0089], ...R.BARREL.map(([x, r]) => [U(x) - bu0, r])];
  b.lathe('m17Steel', bp, 0, axis, bu0, { seg: b.seg(22, 7) });
  const [ra0, ra1] = R.RAS, ru0 = U(ra0) + 0.001, ru1 = U(ra1) - 0.001, H = R.RAS_HALF;
  b.rail('m17Ras', 0, axis + H - 0.0005, ru0, ru1);
  if (b.hi) {
    b.rail('m17Ras', 0, axis - H + 0.0005, ru0, ru1, { rz: Math.PI });
    for (const s of [-1, 1]) b.rail('m17Ras', s * (H - 0.0005), axis, ru0, ru1, { rz: -s * Math.PI / 2 });
    // Schienennummern rechts (R14 … R28) zwischen den Zähnen
    [2017, 2106, 2195, 2291, 2380, 2469, 2557, 2646].forEach((x, i) => mark(b, 'R' + (14 + i * 2), H + 0.00465, axis - 0.0012, U(x), 0.0068, { vertical: true, px: 48 }));
  } else b.box('m17Ras', 0.02, 0.008, ru1 - ru0, 0, axis + H + 0.002, (ru0 + ru1) / 2, { c: 0 });
  const [fb0, fb1] = R.FSB_BASE;
  b.cyl('m17Steel', R.FSB_RING_R, R.FSB_RING_R, U(fb1) - U(fb0), 0, axis, (U(fb0) + U(fb1)) / 2, { seg: b.seg(22, 7) });
  if (b.hi) {
    const [qx0, qy0, qx1, qy1] = R.POST;
    b.box('m17Steel', 0.0018, V(qy0) - V(qy1), U(qx1) - U(qx0), 0, (V(qy0) + V(qy1)) / 2, (U(qx0) + U(qx1)) / 2, { c: 0.0003 });
    b.cyl('m17Steel', 0.0024, 0.0024, 0.006, 0, V(qy0) - 0.006, (U(qx0) + U(qx1)) / 2, { axis: 'v', seg: 10 });   // Rastung
  }
  const end = birdcage(b, U(R.FH[0]), axis, R.FH_R);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Klappkimme (umgelegt) hinten auf der Schiene: Fuß, umgelegte Lochplatte, Rändelknopf
  if (b.hi) {
    const ku = U(1100);
    b.box('m17Rec', 0.018, 0.0065, 0.024, 0, 0.1272, ku, { c: 0.0015 });
    b.box('m17Rec', 0.015, 0.0028, 0.02, 0, 0.1318, ku + 0.003, { c: 0.001 });
    b.cyl('knurl', 0.0034, 0.0034, 0.0042, 0.0108, 0.127, ku - 0.006, { axis: 'x', seg: 12 });
  }
  // ---------------------------------------------------------------- Holo-Visier (Werksoptik) und Magazin
  holoSight(b, 0.0, 0.124);
  m17Mag(b);
  const grip = { rake: 0.38, gw: 0.0135, gd: 0.023, gu: 0.0, ho: 0.018, tu: 0.034 };
  b.anchor('rightHandGrip', 0, 0.0, 0, { data: grip });
  b.anchor('magWell', 0, V(1452), U(1700));
  b.anchor('leftHandGrip', 0, axis - 0.026, 0.255, { data: { style: 'under', r: 0.026 } });
  b.meta = { sight: 'holo', axis, kind: 'rifle' };
}

// 30-Schuss-Magazin in Fotoform (gebogen, drei Längsrillen), Aluminium grau eloxiert wie im Foto
function m17Mag(b) {
  const pu = U(1700), pv = V(1452);
  b.part('mag', 0, pv, pu);
  // Profil: Fotoumriss unten, oben bis zu den Lippen im Schacht verlängert
  const body = [[1556, 1236], [1846, 1236], ...R.MAG.filter(([, y]) => y >= 1468)];
  b.side('m17Mag', R.M(b.hi ? body : simplifyPoly(body, 6)), 0.0222, 0, { part: 'mag', bevel: b.hi ? 0.0016 : 0.001 });
  if (b.hi) {
    // Drei erhabene Längsrippen, dem Bogen folgend (aus dem Foto)
    const rear = [[1560, 1472], [1572, 1600], [1600, 1720], [1630, 1810]], frontE = [[1826, 1472], [1840, 1600], [1866, 1720], [1886, 1800]];
    for (const f of [0.2, 0.5, 0.76]) {
      const pl = rear.map(([x, y], i) => [U(x + f * (frontE[i][0] - x)), V(y)]);
      b.side('m17Mag', [...pl.map(([u, v]) => [u - 0.0011, v]), ...pl.slice().reverse().map(([u, v]) => [u + 0.0011, v])], 0.0234, 0, { part: 'mag', bevel: 0.0004 });
    }
  }
  const path = [[1701, 1250], [1700, 1452], [1722, 1600], [1748, 1760], [1760, 1830]].map(([x, y]) => [0, V(y), U(x)]);
  magRounds(b, { cal: 'r556', width: 0.0195, depth: 0.058, show: 3, path });
  b.anchor('magGrab', 0, V(1620), U(1752), { part: 'mag', data: { w: 0.0113, d: 0.029 } });
}
