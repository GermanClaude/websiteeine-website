// M-17 Falke nach Referenzfoto (M4-Karabiner mit Schienen-Handschutz, m17-ref.js) – Nutzer 13.10.2026: „mit der
// Standardwaffe, um zu sehen, wie es ist“. Verfahren wie bei der P-9: Umrisse aus dem gerade gestellten Foto
// verfolgt und kalibriert, Bauteile als Distanzfelder (Profil × eigene Breite, weich vereinigt, Fenster/Nuten/Schächte
// abgezogen), Schaft und Griff mit eigenem Atlas, Gravuren als Schriftfelder. Der gemeinsame AR-Unterbau (arLower in
// guns-ar.js) bleibt für SK-14 und Ursprung unverändert.
import * as R from './m17-ref.js';
import { furnUV3, markMat, markAspect, SLOTS } from './m17-tex.js';
import { atlasUV } from './p9-tex.js';
import { sdPolygon, extrudeRound, smin, surfaceNets, sdBox, grid2D, simplifyPoly, contours2D } from './sdf.js';
import { roundRect, shapeFrom } from './builder.js';
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
    m17Stock(b);
    // ---------------------------------------------------------------- Griff (A2, Rautenfeld)
    const gp = R.M(R.GRIP), gD = field2(gp, [], 0.0005);
    const gripF = (x, v, u) => { const d2 = gD(u, v); if (d2 > 0.006) return d2; return extrudeRound(d2, x, 0.0128, 0.0072); };
    const gg = surfaceNets(gripF, [-0.015, V(1752), U(950)], [0.015, V(1294), U(1350)], 0.0017);
    b._push(atlasUV(gg, furnUV3), 'm17Furn', {}, true);
    // ---------------------------------------------------------------- Unterteil (Gehäuse, Abzugsbügel, Magazinschacht)
    const lo = R.M(R.LOWER), op = R.M(R.OPEN), loD0 = field2(lo, [op], 0.0005), upD0 = field2(R.M(R.UPPER), [], 0.0005);
    // Trennfuge wie im Foto: hinten (bis zum Auswurffenster) liegt sie 13 mm höher, vorn ragt die Schwenkstift-Nase hoch
    const lugs = R.LOWER_LUGS.map(([x0, y0, x1, y1]) => [(U(x0) + U(x1)) / 2, (V(y0) + V(y1)) / 2, (U(x1) - U(x0)) / 2, (V(y0) - V(y1)) / 2]);
    const lugD = (u, v) => Math.min(...lugs.map(([cu, cv, hu, hv]) => Math.max(Math.abs(u - cu) - hu, Math.abs(v - cv) - hv)));
    const loD = (u, v) => Math.min(loD0(u, v), Math.max(upD0(u, v), lugD(u, v)));
    const vGuard = V(R.GUARD_Y), uG0 = U(1342), uW0 = U(R.WELL_X0);
    const [mrx, mry, mrr] = R.MAG_RELEASE, mru = U(mrx), mrv = V(mry), mrR = mrr / R.PPM;
    const well = { u0: U(1556), u1: U(1846), vTop: V(1250) };
    const lowerF = (x, v, u) => {
      const d2 = loD(u, v);
      if (d2 > 0.006) return d2;
      const ax = Math.abs(x);
      let d = extrudeRound(Math.max(d2, u - uW0 - 0.002, Math.min(vGuard - v, u - uG0)), x, 0.0111, 0.0012);     // Gehäuse
      d = smin(d, extrudeRound(Math.max(d2, v - vGuard - 0.002, uG0 - u, u - uW0), x, 0.0058, 0.0018), 0.002);   // Abzugsbügel
      d = smin(d, extrudeRound(Math.max(d2, uW0 - u, v - V(1199)), x, 0.0132, 0.0025), 0.003);                     // Magazinschacht
      if (v > V(1203)) d = Math.min(d, extrudeRound(d2, x, 0.0111, 0.0012));                                      // Nasen über dem Schacht
      // Schutzrippe um den Magazinknopf (rechts)
      if (x > 0 && Math.abs(u - mru) < 0.012 && Math.abs(v - mrv) < 0.012) d = smin(d, Math.max(Math.abs(Math.hypot(u - mru, v - mrv) - mrR - 0.0022) - 0.0011, Math.abs(x - 0.0119) - 0.0009), 0.0008);
      // Schacht offen: das Magazin steckt sichtbar darin
      d = Math.max(d, -Math.max(ax - 0.0106, well.u0 - u, u - well.u1, v - well.vTop));
      return d;
    };
    const lg = surfaceNets(lowerF, [-0.0168, V(1412), U(1026)], [0.0168, V(1133), U(1898)], 0.0016);
    b._push(lg, 'm17Rec', {});
    // ---------------------------------------------------------------- Oberteil (Gehäuse, Auswurffenster, Hülsenabweiser)
    const upD = (u, v) => Math.max(upD0(u, v), -lugD(u, v));
    const [px0, py0, px1, py1] = R.PORT, port = { u0: U(px0), u1: U(px1), v0: V(py1), v1: V(py0) };
    const defl = R.M(R.DEFLECTOR), dflB = box2(defl);
    const upperF = (x, v, u) => {
      const d2 = upD(u, v);
      if (d2 > 0.006) return d2;
      let d = extrudeRound(d2, x, 0.0112, 0.0016);
      // Runder Gehäusewulst um den Verschlussträger (links durchgehend, rechts vor dem Fenster)
      if (x < 0 || u > port.u1 + 0.004) d = smin(d, Math.max(Math.hypot(x, v - axis) - 0.0126, d2 + 0.0015, x > 0 ? 0 : x + 0.006), 0.0025);
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
  // Ladehebel (T-Griff): Schaft im Kanal, Griffstück rechts, Klinke links mit Gelenkstift, Griffrillen hinten
  const cu = U(1000), cv = 0.1145;
  b.part('charge', 0, cv, cu);
  b.box('m17Rec', 0.0084, 0.0066, 0.034, 0, cv, cu + 0.016, { part: 'charge', c: 0.001 });
  b.top('m17Rec', roundRect(-0.0046, cu - 0.0095, 0.0158, cu + 0.0016, 0.0022, 2), 0.0074, cv, { part: 'charge', bevel: 0.0008 });
  if (b.hi) {
    b.top('m17Rec', roundRect(-0.0214, cu - 0.0095, -0.0052, cu + 0.0026, 0.0028, 2), 0.0068, cv, { part: 'charge', bevel: 0.0008 });
    b.cyl('m17Steel', 0.0009, 0.0009, 0.0072, -0.0062, cv, cu - 0.001, { axis: 'v', part: 'charge', seg: 8 });
    for (let i = 0; i < 3; i++) {
      b.box('cavity', 0.0011, 0.0056, 0.0007, 0.0068 + i * 0.0026, cv, cu - 0.0096, { part: 'charge', c: 0 });
      b.box('cavity', 0.0011, 0.005, 0.0007, -0.0175 + i * 0.0026, cv, cu - 0.0096, { part: 'charge', c: 0 });
    }
  } else b.box('m17Rec', 0.016, 0.0068, 0.011, -0.012, cv, cu - 0.004, { part: 'charge', c: 0 });
  b.anchor('chargeGrab', -0.014, cv, cu - 0.004, { part: 'charge', data: { travel: [0, 0, 0.065], style: 'release' } });
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
  const bcU = U(1528);
  if (b.hi) {
    // Stiftköpfe (gewölbt) beidseitig: Halte-/Schwenkstift groß, Hammer-/Abzugsstift klein
    const pin = (x0, y0, r, h, s) => b.lathe('m17Steel', [[0, 0], [0, r], [h * 0.55, r], [h * 0.85, r * 0.82], [h, 0]], s * 0.0106, V(y0), U(x0), { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 18 });
    for (const [x, y, r] of R.PINS.slice(0, 2)) for (const s of [-1, 1]) pin(x, y, r / R.PPM, 0.0021, s);
    for (const [x, y] of R.SMALL_PINS) for (const s of [-1, 1]) pin(x, y, 0.0019, 0.0009, s);
    // Wahlhebel: rechts runder Achsknopf, links Nabe + flacher Hebel (auf SICHER nach vorn) mit Griffrillen
    const [sx, sy, sr] = R.PINS[2], su = U(sx), sv = V(sy);
    b.cyl('m17Steel', sr / R.PPM, sr / R.PPM, 0.0018, 0.0119, sv, su, { axis: 'x', seg: 18 });
    // Linker Hebel als drehbares Teil: gebaut in Stellung SICHER (nach vorn), im Spiel dreht er auf EINZEL (oben) bzw.
    // DAUER (hinten) – meta.selector (Viewmodel)
    b.part('selector', -0.012, sv, su);
    b.lathe('m17Steel', [[0, 0], [0, 0.0057], [0.0012, 0.0057], [0.0019, 0.0049], [0.0021, 0]], -0.0108, sv, su, { axis: 'x', ry: Math.PI, seg: 20, part: 'selector' });
    b.side('m17Steel', [[su, sv + 0.0027], [su + 0.0185, sv + 0.0022], [su + 0.0216, sv + 0.0011], [su + 0.0224, sv], [su + 0.0216, sv - 0.0011], [su + 0.0185, sv - 0.0022], [su, sv - 0.0027]], 0.0021, -0.0137, { bevel: 0.0005, part: 'selector' });
    for (let i = 0; i < 4; i++) b.box('cavity', 0.0003, 0.0036, 0.0006, -0.01485, sv, su + 0.0128 + i * 0.0021, { c: 0, part: 'selector' });
    // Magazinknopf rechts (gerändelt)
    const [mx, my, mr] = R.MAG_RELEASE;
    b.cyl('knurl', mr / R.PPM, mr / R.PPM, 0.0034, 0.0124, V(my), U(mx), { axis: 'x', seg: 18 });
    // Verschlussfang links: zwei Lageraugen mit Spannstift, Fangkörper, oberes Lösepaddel (gerillt), unteres Fangpaddel (ausgestellt)
    for (const du of [-0.0052, 0.0052]) b.box('m17Rec', 0.0024, 0.0076, 0.0032, -0.0121, 0.0592, bcU + du, { c: 0.0007 });
    b.cyl('m17Steel', 0.0011, 0.0011, 0.0138, -0.0124, 0.0592, bcU, { seg: 10 });
    b.box('m17Steel', 0.0024, 0.0175, 0.0064, -0.0124, 0.0595, bcU, { c: 0.0006 });
    b.box('m17Steel', 0.0028, 0.0052, 0.0072, -0.0128, 0.0662, bcU, { c: 0.0007 });
    for (let i = 0; i < 4; i++) b.box('cavity', 0.0003, 0.0006, 0.0062, -0.01425, 0.0644 + i * 0.0012, bcU, { c: 0 });
    b.box('m17Steel', 0.0032, 0.0066, 0.0096, -0.0137, 0.0512, bcU, { rz: -0.32, c: 0.0008 });
    for (let i = 0; i < 3; i++) b.box('cavity', 0.0003, 0.0007, 0.0084, -0.01525 + i * 0.0005, 0.0494 + i * 0.0016, bcU, { rz: -0.32, c: 0 });
    // Gravuren: Wahlhebelstellungen beidseitig, Typ/Kaliber/Nummer links am Magazinschacht, Herstellerzeile über dem Abzug
    for (const [k, t] of [['sicher', 'SICHER'], ['einzel', 'EINZEL'], ['dauer', 'DAUER']]) { const [mxp, myp] = R.MARKS[k]; mark(b, t, 0.0113, V(myp), U(mxp), 0.0021); }
    mark(b, 'SICHER', -0.0113, sv, su + 0.0282, 0.0021);
    mark(b, 'EINZEL', -0.0113, V(1175), su, 0.0021);
    mark(b, 'DAUER', -0.0113, sv, su - 0.0172, 0.0021);
    const wx = -0.01335;
    mark(b, 'EIGENTUM NULLPUNKT', wx, 0.0532, 0.107, 0.0018);
    mark(b, 'M-17 FALKE', wx, 0.0494, 0.107, 0.0024);
    mark(b, 'KAL 5,56 MM', wx, 0.0457, 0.107, 0.0021);
    mark(b, 'NP 104729', wx, 0.0421, 0.107, 0.0021);
    mark(b, 'NULLPUNKT WAFFENWERK', -0.0113, 0.0503, 0.05, 0.0016);
  }
  b.side('m17Steel', R.M(R.TRIGGER), 0.0045, 0, { bevel: 0.0006 });
  b.anchor('trigger', 0, V(1335), U(1392));
  b.anchor('boltCatch', -0.0146, 0.0662, bcU);
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
    [2017, 2106, 2195, 2291, 2380, 2469, 2557, 2646].forEach((x, i) => {
      mark(b, 'R' + (14 + i * 2), H + 0.00465, axis - 0.0012, U(x), 0.0068, { vertical: true, px: 48 });
      mark(b, 'L' + (14 + i * 2), -H - 0.00465, axis - 0.0012, U(x), 0.0068, { vertical: true, px: 48 });
    });
  } else b.box('m17Ras', 0.02, 0.008, ru1 - ru0, 0, axis + H + 0.002, (ru0 + ru1) / 2, { c: 0 });
  const [fb0, fb1] = R.FSB_BASE;
  b.cyl('m17Steel', R.FSB_RING_R, R.FSB_RING_R, U(fb1) - U(fb0), 0, axis, (U(fb0) + U(fb1)) / 2, { seg: b.seg(22, 7) });
  if (b.hi) {
    const [qx0, qy0, qx1, qy1] = R.POST;
    b.box('m17Steel', 0.0018, V(qy0) - V(qy1), U(qx1) - U(qx0), 0, (V(qy0) + V(qy1)) / 2, (U(qx0) + U(qx1)) / 2, { c: 0.0003 });
    b.cyl('m17Steel', 0.0024, 0.0024, 0.006, 0, V(qy0) - 0.006, (U(qx0) + U(qx1)) / 2, { axis: 'v', seg: 10 });   // Rastung
  }
  const end = b.att && b.att.muendung ? birdcage(b, U(R.FH[0]), axis, R.FH_R) : m17Birdcage(b, U(R.FH[0]), axis);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Klappkimme (umgelegt, wie im Foto): Klemmfuß mit Querschraube, Gelenk, umgelegter Körper mit Lochblende oben,
  // großer Seitentrommel rechts (gerändelt, mit Bohrung)
  if (b.hi) {
    const ku0 = U(1247), ku1 = U(1355), km = (ku0 + ku1) / 2, rt = 0.124;
    b.box('m17Rec', 0.0236, 0.0046, ku1 - ku0, 0, rt + 0.0023, km, { c: 0.0012 });
    for (const s of [-1, 1]) b.box('m17Rec', 0.0026, 0.0078, ku1 - ku0 - 0.002, s * 0.0118, rt - 0.0031, km, { c: 0.0008 });
    b.cyl('m17Steel', 0.0029, 0.0029, 0.0018, -0.0139, rt - 0.0028, km, { axis: 'x', seg: 16 });
    b.box('cavity', 0.0004, 0.0042, 0.0007, -0.0149, rt - 0.0028, km, { c: 0 });
    b.cyl('m17Steel', 0.0034, 0.0034, 0.0024, 0.0141, rt - 0.0028, km, { axis: 'x', seg: 6 });
    b.cyl('m17Rec', 0.0032, 0.0032, 0.017, 0, rt + 0.0058, ku0 + 0.001, { axis: 'x', seg: 14 });
    b.box('m17Rec', 0.0172, 0.0096, 0.023, 0, rt + 0.0052, U(1196), { c: 0.0022 });
    b.box('m17Rec', 0.0138, 0.0046, 0.014, 0, rt + 0.0026, U(1110), { c: 0.0014 });
    b.circle('cavity', 0.0021, 0, rt + 0.00495, U(1112), { rx: -Math.PI / 2, seg: 14 });
    b.cyl('m17Rec', 0.0076, 0.0076, 0.0068, 0.0119, 0.1323, U(1185), { axis: 'x', seg: 28 });
    for (let i = 0; i < 14; i++) { const a = i * Math.PI / 7; b.box('cavity', 0.0056, 0.0007, 0.0004, 0.0119, 0.1323 + Math.sin(a) * 0.0076, U(1185) + Math.cos(a) * 0.0076, { rx: -a, c: 0 }); }
    b.circle('cavity', 0.0016, 0.0154, 0.1323, U(1185), { ry: Math.PI / 2, seg: 10 });
  }
  // ---------------------------------------------------------------- Holo-Visier (Werksoptik) und Magazin
  holoSight(b, U(1440), 0.124);   // wie die Optik im Foto: vorn auf der Gehäuseschiene, hinten Platz für die Klappkimme
  m17Mag(b);
  const grip = { rake: 0.38, gw: 0.0135, gd: 0.023, gu: 0.0, ho: 0.018, tu: 0.034 };
  b.anchor('rightHandGrip', 0, 0.0, 0, { data: grip });
  b.anchor('magWell', 0, V(1452), U(1700));
  b.anchor('leftHandGrip', 0, axis - 0.026, 0.255, { data: { style: 'under', r: 0.026 } });
  b.meta = { sight: 'holo', axis, kind: 'rifle', selector: { semi: Math.PI / 2, auto: Math.PI } };
}

// A2-Feuerdämpfer (Vogelkäfig) wie am Vorbild: Bund mit Quetschscheibe, fünf durchgehende Schlitze im Käfig (unten
// geschlossen gegen Staub), vorn ein Ring mit weiter Öffnung, innen dunkel mit der Laufmündung am Grund
function m17Birdcage(b, u0, axis) {
  const ro = 0.0104, ri = 0.0062, L = 0.0473, s0 = 0.017, s1 = 0.036;
  const ring = (r, n = 28) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, axis + Math.sin(i / n * Math.PI * 2) * r]);
  b.lathe('m17Steel', [[-0.0016, 0], [-0.0016, 0.0097], [0, 0.0097]], 0, axis, u0, { seg: b.seg(24, 8) });                 // Quetschscheibe
  b.lathe('m17Steel', [[0, 0], [0, ro * 0.92], [0.0012, ro], [0.013, ro]], 0, axis, u0, { seg: b.seg(28, 8) });
  if (!b.hi) { b.cyl('m17Steel', ro, ro, L - 0.013, 0, axis, u0 + 0.013 + (L - 0.013) / 2, { seg: 6 }); return u0 + L; }
  b.front('m17Steel', ring(ro).reverse(), s0 - 0.013, u0 + 0.013, { holes: [ring(ri)] });
  b.front('m17Steel', ring(ro).reverse(), L - s1 - 0.0006, u0 + s1, { holes: [ring(ri)], bevel: 0.0005 });
  // Stege zwischen den Schlitzen (Schlitzmitten 30°, 90°, 150°, 210°, 330°; 270° = geschlossener Boden)
  const w = 0.13, cuts = [30, 90, 150, 210, 330].map((d) => d * Math.PI / 180);
  for (let i = 0; i < cuts.length; i++) {
    const a0 = cuts[i] + w, a1 = (i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + Math.PI * 2) - w, n = Math.max(3, Math.round((a1 - a0) / 0.12));
    const arc = (r, rev) => Array.from({ length: n + 1 }, (_, k) => { const a = rev ? a1 - (a1 - a0) * k / n : a0 + (a1 - a0) * k / n; return [Math.cos(a) * r, axis + Math.sin(a) * r]; });
    b.front('m17Steel', [...arc(ro, false), ...arc(ri, true)], s1 - s0, u0 + s0);
  }
  b.circle('steelDark', ri, 0, axis, u0 + 0.0131, { seg: 24 });     // Grund des Käfigs (rußig)
  b.bore(0.0029, 0, axis, u0 + 0.0136);
  return u0 + L;
}

// Verstellschaft mit Batterieröhren (Fotoform): oben breiter Körper aus Wangenauflage und zwei seitlichen Röhren
// (Querschnitt von hinten wie das Vorbild), darunter der Steg mit Rand, vertieften Feldern, Diagonalrippe und Bolzen,
// durchgehende Riemenschlitze, Verstellhebel mit Riemenzapfen, Gummikappe hinten. Zwei Netze: Körper grob, Steg fein.
const roundMax = (a, c, r) => Math.min(Math.max(a + r, c + r), 0) + Math.hypot(Math.max(a + r, 0), Math.max(c + r, 0)) - r;
const sdRoundRect = (px, py, bx, by, r) => { const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
function m17Stock(b) {
  const st = R.M(R.STOCK), stD = field2(st, [], 0.0006);
  const vTop = V(990), vT = V(1150), xT = 0.0205, rT = 0.0116, hoodW = 0.0262;
  // Querschnitt Körper (x, v): Wangenauflage (oben rund) + zwei Batterieröhren unten seitlich
  const body2 = (x, v) => smin(sdRoundRect(x, v - (vT + vTop) / 2, hoodW, (vTop - vT) / 2, 0.011), Math.hypot(Math.abs(x) - xT, v - vT) - rT, 0.004);
  const uFront = U(940), chR = R.TUBE_R + 0.0005;
  const bodyF = (x, v, u) => {
    const d2 = stD(u, v);
    if (d2 > 0.006) return d2;
    let d = roundMax(d2, body2(x, v), 0.0028);
    if (u > uFront) d = Math.max(d, -(Math.hypot(x, v - R.AXIS) - chR));          // Kanal für das Pufferrohr
    return d;
  };
  const bg = surfaceNets(bodyF, [-0.034, V(1206), U(214)], [0.034, V(984), U(1002)], 0.0019);
  b._push(atlasUV(bg, furnUV3), 'm17Furn', {}, true);
  // Steg, Hebel, untere Kappe: flache Teile als Profil-Extrusionen (Konturen aus den 2D-Feldern)
  const vCut = vT + 0.0015, vSplit = V(1205), uPad = U(300), uLev = U(553), vLev = V(1266);
  const rib = [U(322), V(1204), U(479), V(1351)], boss = [U(422), V(1307)];
  const slots = SLOTS.map(([x0, y0, x1, y1]) => [(U(x0) + U(x1)) / 2, (V(y0) + V(y1)) / 2, (U(x1) - U(x0)) / 2, (V(y0) - V(y1)) / 2]);
  const slotD = (u, v) => Math.min(...slots.map(([cu, cv, hu, hv]) => sdRoundRect(u - cu, v - cv, hu, hv, Math.min(hu, hv))));
  const outl = (u, v) => Math.max(stD(u, v), v - vCut, -slotD(u, v));
  const lever = (u, v) => Math.max(uLev - u, v - vLev);
  const recess = (u, v) => Math.max(Math.max(stD(u, v), v - vSplit, uPad - u) + 0.0042, -(segDist(u, v, ...rib) - 0.0021), -(Math.hypot(u - boss[0], v - boss[1]) - 0.0046), -lever(u, v));
  const win = [U(214), U(915), V(1512), vCut + 0.002];
  sideFurn(b, (u, v) => Math.max(outl(u, v), -lever(u, v), -recess(u, v), uPad - u), win, 0.0104, 0.0012);   // Rand + Rippe
  sideFurn(b, (u, v) => Math.max(outl(u, v), -lever(u, v)), win, 0.0056, 0.0006);                             // vertiefte Felder
  sideFurn(b, (u, v) => Math.max(outl(u, v), u - uPad - 0.0004), win, 0.0115, 0.0016);                        // Kappe unten
  sideFurn(b, (u, v) => Math.max(outl(u, v), lever(u, v), -Math.max(Math.abs(u - (U(743) + U(790)) / 2) - 0.0056, v - V(1279))), win, 0.0072, 0.0016);   // Hebel
  if (b.hi) {
    b.cyl('m17Furn', 0.0052, 0.0052, V(1279) - V(1311), 0, (V(1279) + V(1311)) / 2, (U(743) + U(790)) / 2, { axis: 'v', seg: 16 });   // Riemenzapfen
    b.cyl('m17Furn', 0.0046, 0.0046, 0.0224, 0, boss[1], boss[0], { axis: 'x', seg: 18 });                                           // Bolzen
    b.cyl('m17Steel', 0.0013, 0.0013, 0.0238, 0, boss[1], boss[0], { axis: 'x', seg: 10 });
  }
}
// Flaches Polymerteil: Kontur eines 2D-Felds (u, v) quer extrudiert (halbe Breite hw, Fase), Atlas-UVs je Fläche
function sideFurn(b, f, [u0, u1, v0, v1], hw, bevel, step = 0.00035) {
  for (const { outer, holes } of contours2D(f, u0, u1, v0, v1, step, 0.00012)) {
    const geo = b._extrude(shapeFrom(outer, holes), hw * 2, bevel, { bevelSeg: 2, curveSeg: 1 });
    geo.translate(0, 0, -(hw * 2 - 2 * Math.min(bevel, hw * 0.9)) / 2);
    geo.rotateY(Math.PI / 2);
    b._push(atlasUV(geo, furnUV3), 'm17Furn', {}, true);
  }
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
  // Bodenplatte: etwas breiter, folgt der Unterkante (aus dem Foto)
  if (b.hi) {
    const fl = [[1913, 1788], [1880, 1813], [1800, 1831], [1720, 1856], [1668, 1865], [1647, 1846]];
    b.side('m17Rec', R.M([...fl, ...fl.slice().reverse().map(([x, y]) => [x - 3, y - 15])]), 0.0238, 0, { part: 'mag', bevel: 0.0009 });
  }
  const path = [[1701, 1250], [1700, 1452], [1722, 1600], [1748, 1760], [1760, 1830]].map(([x, y]) => [0, V(y), U(x)]);
  magRounds(b, { cal: 'r556', width: 0.0195, depth: 0.058, show: 3, path });
  b.anchor('magGrab', 0, V(1620), U(1752), { part: 'mag', data: { w: 0.0113, d: 0.029 } });
}
