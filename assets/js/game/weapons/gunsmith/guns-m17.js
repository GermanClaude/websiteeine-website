// M-17 Falke nach Referenzfoto (M4-Karabiner mit Schienen-Handschutz, m17-ref.js) – Nutzer 13.10.2026: „mit der
// Standardwaffe, um zu sehen, wie es ist“. Verfahren wie bei der P-9: Umrisse aus dem gerade gestellten Foto
// verfolgt und kalibriert, Bauteile als Distanzfelder (Profil × eigene Breite, weich vereinigt, Fenster/Nuten/Schächte
// abgezogen), Schaft und Griff mit eigenem Atlas, Gravuren als Schriftfelder. Der gemeinsame AR-Unterbau (arLower in
// guns-ar.js) bleibt für SK-14 und Ursprung unverändert.
import * as R from './m17-ref.js';
import { furnUV3, SLOTS } from './m17-tex.js';
import { schrift } from './schrift.js';
import { sdPolygon, extrudeRound, smin, surfaceNets, sdBox, simplifyPoly, cavityColors } from './sdf.js';
import { ALU, STEEL, POLY, box2, field2, sdRoundRect, roundMax, segDist, cutWindow, fase, sdfMesh, sideFurn } from './sdfkit.js';
import { roundRect, ellipsePts } from './builder.js';
import { holoSight, birdcage } from './parts.js';
import { magRounds } from './magfill.js';

const { U, V } = R;
const AX = R.AXIS;
// Auswurffenster nach Original (Standard-M4, Nutzer 14.10.2026): Öffnung ≈ 66 × 17 mm mit runden Ecken und Fase im
// runden Trägergehäuse (r ≈ 14,3 mm), Deckel ≈ 79 × 23,5 mm aus 1 mm Stahlblech im Gehäuseradius gewölbt, Scharnier-
// stange unten mit Drehfeder und Sicherungsring, Laufverlängerung 1,5 mm vor dem Fenster. Offen hängt der Deckel um
// 155° nach unten geklappt (frei vom Gehäuse). u vorwärts, v hoch, x rechts (m).
const EP = (() => {
  const pu = (U(R.PORT[0]) + U(R.PORT[2])) / 2, pv = (V(R.PORT[1]) + V(R.PORT[3])) / 2;
  const u = pu + 0.002, hu = 0.033, v = pv - 0.0008, hv = 0.0086, Rm = 0.0149;
  const thB = Math.asin((v - hv - 0.0018 - AX) / Rm), thT = Math.asin((v + hv + 0.0018 - AX) / Rm), thH = thB - 0.0785, Rh = Rm + 0.0004;
  return { u, hu, v, hv, r: 0.0024, uBX: u + hu + 0.0015, Rm, thB, thT, cu: u, cl: 0.0395, hx: Rh * Math.cos(thH), hv2: AX + Rh * Math.sin(thH), open: 155 * Math.PI / 180, R: 0.0143 };
})();
// Gravuren (Wahlhebelstellungen, Typ, Nummer, Stempel, Schienenzahlen) als Schriftfelder auf der Fläche – alle in einer
// gemeinsamen Schrift-Textur mit einem Material (schrift.js, 24.10.); auch am Handy wie bisher
const { mark, markTop, railNumbers } = schrift('m17', { lite: true });

// Distanzfeld-Netze (sdfMesh), Profile (sideFurn), Fenster/Fasen und Gebrauchsspuren-Voreinstellungen: sdfkit.js
export function m17(b) {
  const axis = AX;
  const rk = b.max ? 0.45 : 1;   // PC: knappe Kantenrundung (gefräst statt geknetet)
  if (b.hi) {
    // Teure Netze (Distanzfelder, Profile) als geteilte Blöcke: einmal je Stufe gerechnet, in allen Aufsatz-Varianten
    // wiederverwendet (Bauteil-Cache, builder.js b.shared) – sie hängen nicht von den Aufsätzen ab
    b.shared('schaft', () => m17Stock(b));
    // ---------------------------------------------------------------- Griff (A2, Rautenfeld)
    b.shared('griff', () => {
      const gp = R.M(R.GRIP), gD = field2(gp, [], 0.0005);
      const gripF = (x, v, u) => { const d2 = gD(u, v); if (d2 > 0.006) return d2; return extrudeRound(d2, x, 0.0128, 0.0072); };
      sdfMesh(b, gripF, [-0.015, V(1752), U(950)], [0.015, V(1294), U(1350)], 0.0017, 'm17Furn', { uv: furnUV3, cav: POLY });
    });
    b.shared('gehaeuse', () => m17Receiver(b, axis, rk));
    b.shared('handschutz', () => m17Handguard(b, axis));
    b.shared('korntraeger', () => m17FrontSight(b, axis, rk));
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
  b.picatinny('m17Rec', 0, 0.1163, U(R.UPPER_X0) + 0.002, U(R.UPPER_X1) - 0.002);
  railNumbers(b, 0, 0.124, U(R.UPPER_X0) + 0.002, U(R.UPPER_X1) - 0.002, 1, 'T');
  // Ladehebel (T-Griff): Schaft im Kanal, Griffstück rechts, Klinke links mit Gelenkstift, Griffrillen hinten
  const cu = U(1000), cv = 0.1145;
  b.part('charge', 0, cv, cu);
  b.box('m17Rec', 0.0084, 0.0066, 0.034, 0, cv, cu + 0.016, { part: 'charge', c: 0.001 });
  if (b.hi) b.top('m17Rec', roundRect(-0.0046, cu - 0.0095, 0.0158, cu + 0.0016, 0.0022, 2), 0.0074, cv, { part: 'charge', bevel: 0.0008 });
  else b.box('m17Rec', 0.0204, 0.0074, 0.0111, 0.0056, cv, cu - 0.00395, { part: 'charge', c: 0 });   // Bots: Quader (24.10., ≤ 600 Dreiecke)
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
  if (b.max) m17BoltGroup(b, axis);
  else b.box('m17Steel', 0.006, ph - 0.002, pl - 0.004, 0.0062, pv, pu, { part: 'bolt', c: 0.001 });
  if (b.hi) {
    if (!b.max) {
      for (let i = 0; i < 7; i++) b.box('cavity', 0.0004, 0.0042, 0.0016, 0.0094, pv + 0.004, pu - 0.03 + i * 0.0032, { part: 'bolt', c: 0 });   // Verriegelungszähne
      b.box('cavity', 0.0004, 0.0016, pl - 0.012, 0.0094, pv - 0.0045, pu, { part: 'bolt', c: 0 });
    }
    // Staubschutzdeckel als Klappe am Scharnier: im Modell offen (wie im Foto), im Spiel zu, bis der erste Schuss sie
    // aufschlagen lässt (Viewmodel, Teil dustCover; Schließwinkel in meta.dustCover)
    if (b.max) m17DustCover(b, axis);
    else {
      const [dx0, dy0, dx1, dy1] = R.DUST_COVER;
      b.part('dustCover', 0.0122, V(dy0) - 0.0006, (U(dx0) + U(dx1)) / 2);
      b.box('m17Rec', 0.0013, V(dy0) - V(dy1), U(dx1) - U(dx0), 0.0126, (V(dy0) + V(dy1)) / 2, (U(dx0) + U(dx1)) / 2, { c: 0.0005, part: 'dustCover' });
      b.box('m17Rec', 0.003, 0.004, 0.006, 0.0137, V(dy0) - 0.006, U(1640), { c: 0.001, part: 'dustCover' });
      b.cyl('steel', 0.0011, 0.0011, U(dx1) - U(dx0) + 0.004, 0.0122, V(dy0) - 0.0006, (U(dx0) + U(dx1)) / 2, { seg: 8 });
    }
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
    if (b.max) {
      // Magazinhalter-Arm links: flacher Stahlbalken in seiner Fräsung, hinten rundes Ende mit Schlitzkopf der Knopfachse
      const mcu = U(R.WELL_X0) + 0.0123, mcv = V(R.MAG_RELEASE[1]) + 0.0006, mcE = mcu - 0.0112 + 0.0025;
      b.side('m17Steel', roundRect(mcu - 0.0112, mcv - 0.0025, mcu + 0.0112, mcv + 0.0025, 0.0024, 3), 0.0013, -0.0128, { bevel: 0.0003 });
      b.lathe('m17Steel', [[0, 0], [0, 0.0019], [0.0003, 0.0018], [0.0005, 0]], -0.0131, mcv, mcE, { axis: 'x', ry: Math.PI, seg: 16 });
      b.box('cavity', 0.0003, 0.003, 0.0005, -0.01352, mcv, mcE, { c: 0 });
      // Abzugsbügel: Rastbolzen vorn, Spannstift hinten (beidseitig in den Lageraugen)
      for (const s of [-1, 1]) {
        b.lathe('m17Steel', [[0, 0], [0, 0.0016], [0.0003, 0.0015], [0.0004, 0]], s * 0.0088, V(1408), U(1534), { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 12 });
        b.lathe('m17Steel', [[0, 0], [0, 0.0012], [0.0003, 0.0011], [0.0004, 0]], s * 0.0088, V(1398), U(1352), { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 12 });
        b.box('cavity', 0.0003, 0.0018, 0.0004, s * 0.00915, V(1398), U(1352), { c: 0 });   // Schlitz im Spannstift
      }
      // Prüf- und Schmiedestempel links vorn am Oberteil, Abnahmestempel am Unterteil
      mark(b, 'NP', -0.0113, 0.0748, U(1860) - 0.012, 0.0024, { weight: '700' });
      mark(b, 'MP', -0.0113, 0.0748, U(1860) - 0.0215, 0.0019);
    }
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
  b.picatinny('m17Ras', 0, axis + H - 0.0005, ru0, ru1);
  railNumbers(b, 0, axis + H - 0.0005 + 0.0077, ru0, ru1, 22, 'T');
  if (b.hi) {
    b.picatinny('m17Ras', 0, axis - H + 0.0005, ru0, ru1, { rz: Math.PI });
    for (const s of [-1, 1]) b.picatinny('m17Ras', s * (H - 0.0005), axis, ru0, ru1, { rz: -s * Math.PI / 2 });
    // Schienennummern rechts (R14 … R28) zwischen den Zähnen
    [2017, 2106, 2195, 2291, 2380, 2469, 2557, 2646].forEach((x, i) => {
      mark(b, 'R' + (14 + i * 2), H + 0.00465, axis - 0.0012, U(x), 0.0068, { vertical: true, px: 48 });
      mark(b, 'L' + (14 + i * 2), -H - 0.00465, axis - 0.0012, U(x), 0.0068, { vertical: true, px: 48 });
    });
  } else b.box('m17Ras', 0.02, 0.008, ru1 - ru0, 0, axis + H + 0.002, (ru0 + ru1) / 2, { c: 0 });
  const [fb0, fb1] = R.FSB_BASE;
  b.cyl('m17Steel', R.FSB_RING_R, R.FSB_RING_R, U(fb1) - U(fb0), 0, axis, (U(fb0) + U(fb1)) / 2, { seg: b.seg(b.max ? 40 : 22, 7) });
  if (b.hi) {
    // Kegelstifte durch den Kornträgerfuß (beidseitig sichtbar), Gasrohr vom Gehäuse bis in den Kornträger
    for (const px of [2740, 2895]) for (const s of [-1, 1]) b.lathe('m17Steel', [[0, 0], [0, 0.0019], [0.0006, 0.0017], [0.0008, 0]], s * 0.0116, V(1112), U(px), { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 14 });
    b.cyl('m17Steel', 0.0024, 0.0024, U(2772) - U(1900), 0, axis + 0.0137, (U(1900) + U(2772)) / 2, { seg: 14 });
  }
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
  b.meta = { sight: 'holo', axis, kind: 'rifle', selector: { semi: Math.PI / 2, auto: Math.PI }, dustCover: { closed: b.max ? EP.open : Math.PI } };
}

// Unterteil (Gehäuse, Abzugsbügel, Magazinschacht) und Oberteil (Gehäuse, Auswurffenster, Hülsenabweiser) – ein
// geteilter Block (das Oberteil nutzt die Trennfuge des Unterteils)
function m17Receiver(b, axis, rk) {
  const lo = R.M(R.LOWER), op = R.M(R.OPEN), loD0 = field2(lo, [op], 0.0005), upD0 = field2(R.M(R.UPPER), [], 0.0005);
  // Trennfuge wie im Foto: hinten (bis zum Auswurffenster) liegt sie 13 mm höher, vorn ragt die Schwenkstift-Nase hoch
  const lugs = R.LOWER_LUGS.map(([x0, y0, x1, y1]) => [(U(x0) + U(x1)) / 2, (V(y0) + V(y1)) / 2, (U(x1) - U(x0)) / 2, (V(y0) - V(y1)) / 2]);
  const lugD = (u, v) => Math.min(...lugs.map(([cu, cv, hu, hv]) => Math.max(Math.abs(u - cu) - hu, Math.abs(v - cv) - hv)));
  const loD = (u, v) => Math.min(loD0(u, v), Math.max(upD0(u, v), lugD(u, v)));
  const vGuard = V(R.GUARD_Y), uG0 = U(1342), uW0 = U(R.WELL_X0);
  const [mrx, mry, mrr] = R.MAG_RELEASE, mru = U(mrx), mrv = V(mry), mrR = mrr / R.PPM;
  const well = { u0: U(1556), u1: U(1846), vTop: V(1250) };
  const MC = { u: uW0 + 0.0123, v: mrv + 0.0006, hu: 0.0112, hv: 0.0025 };   // Spalt rundum 1,3 mm   // Magazinhalter-Arm links (Schachtwand)
  const lowerF = (x, v, u) => {
    const d2 = loD(u, v);
    if (d2 > 0.006) return d2;
    const ax = Math.abs(x);
    let d = extrudeRound(Math.max(d2, u - uW0 - 0.002, Math.min(vGuard - v, u - uG0)), x, 0.0111, 0.0012 * rk);     // Gehäuse
    d = smin(d, extrudeRound(Math.max(d2, v - vGuard - 0.002, uG0 - u, u - uW0), x, 0.0058, 0.0018 * rk), 0.002 * rk);   // Abzugsbügel
    d = smin(d, extrudeRound(Math.max(d2, uW0 - u, v - V(1199)), x, 0.0132, 0.0025 * rk), 0.003 * rk);                     // Magazinschacht
    if (v > V(1203)) d = Math.min(d, extrudeRound(d2, x, 0.0111, 0.0012 * rk));                                      // Nasen über dem Schacht
    // Schutzrippe um den Magazinknopf (rechts)
    if (x > 0 && Math.abs(u - mru) < 0.012 && Math.abs(v - mrv) < 0.012) d = smin(d, Math.max(Math.abs(Math.hypot(u - mru, v - mrv) - mrR - 0.0022) - 0.0011, Math.abs(x - 0.0119) - 0.0009), 0.0008);
    if (b.max) {
      // Lageraugen des Abzugsbügels (vorn am Schacht, hinten am Griff) – breiter als der Bügel, mit Querstiften
      d = smin(d, extrudeRound(Math.max(d2, v - vGuard + 0.004, Math.min(Math.max(uG0 - u, u - uG0 - 0.0052), Math.max(uW0 - 0.0056 - u, u - uW0 - 0.001))), x, 0.0089, 0.0009), 0.0012);
      // Ausgestellter Schachtrand unten (Einführtrichter): Wulst außen, innen angefast
      d = smin(d, extrudeRound(Math.max(d2, uW0 - u, v - V(1430)), x, 0.0141, 0.0011), 0.0016);
      // Links: Fräsung für den Magazinhalter-Arm (flacher Stahlbalken liegt darin, siehe unten)
      if (x < -0.009) d = Math.max(d, -Math.max(sdRoundRect(u - MC.u, v - MC.v, MC.hu + 0.0013, MC.hv + 0.0013, MC.hv + 0.0013), -x - 0.0119));
    }
    // Schacht offen: das Magazin steckt sichtbar darin
    const flare = b.max ? 0.0013 * Math.min(1, Math.max(0, (V(1427) - v) / (V(1427) - V(1442)))) : 0;
    d = Math.max(d, -Math.max(ax - 0.0106 - flare, well.u0 - u - flare, u - well.u1 - flare, v - well.vTop));
    return d;
  };
  sdfMesh(b, lowerF, [-0.0168, V(1412), U(1026)], [0.0168, V(1133), U(1898)], 0.0016, 'm17Rec', { cav: ALU, fine: 0.45 });
  // ---------------------------------------------------------------- Oberteil (Gehäuse, Auswurffenster, Hülsenabweiser)
  const upD = (u, v) => Math.max(upD0(u, v), -lugD(u, v));
  const [px0, py0, px1, py1] = R.PORT, port = { u0: U(px0), u1: U(px1), v0: V(py1), v1: V(py0) };
  const defl = R.M(R.DEFLECTOR), dflB = box2(defl), bcU = U(1528);
  const upperF = (x, v, u) => {
    const d2 = upD(u, v);
    if (d2 > 0.006) return d2;
    let d = extrudeRound(d2, x, 0.0112, 0.0016 * rk);
    // Runder Gehäusewulst um den Verschlussträger (links durchgehend, rechts vor dem Fenster). Am PC in Originalmaß:
    // Trägerrohr ≈ 29 mm außen, steht links gut 3 mm über die gefräste Seitenwand (22 mm wie das Unterteil) hinaus –
    // mit Schattenkante darunter; rechts flacher, damit der Staubschutzdeckel bündig sitzt
    // PC: beidseitig wie das Original (rundes Trägergehäuse auch um das Auswurffenster, Deckel liegt darauf)
    const bR = b.max ? 0.0143 : 0.0126;
    if (b.max || x < 0 || u > port.u1 + 0.004) d = smin(d, Math.max(Math.hypot(x, v - axis) - bR, d2 + 0.0015, b.max ? 0.006 - Math.abs(x) : x > 0 ? 0 : x + 0.006), b.max ? 0.0012 : 0.0025);
    if (b.max) {
      // Fenster mit runden Ecken und 0,7-mm-Fase außen; dahinter der hohle Trägerkanal (Ø 25,2 mm), in dem der Träger
      // beim Schuss sichtbar zurückläuft – vorn schließt die Laufverlängerung an
      if (x > 0.002) {
        const rr = Math.hypot(x, v - axis);
        d = cutWindow(d, u - EP.u, v - EP.v, EP.hu, EP.hv, EP.r, fase(rr, EP.R, 0.0007), 0.0035 - x);
      }
      if (u > EP.u - EP.hu - 0.012 && u < EP.uBX) d = Math.max(d, -(Math.hypot(x, v - axis) - 0.0126));
    } else d = Math.max(d, -sdBox(x, v, u, 0.012, (port.v0 + port.v1) / 2, (port.u0 + port.u1) / 2, 0.0082, (port.v1 - port.v0) / 2, (port.u1 - port.u0) / 2));
    // Hülsenabweiser hinter dem Fenster (am PC kräftiger, steht ≈ 3 mm über das Gehäuse)
    if (x > 0 && u > dflB[0] && u < dflB[1] && v > dflB[2] && v < dflB[3]) d = smin(d, b.max ? extrudeRound(sdPolygon(u, v, defl), x - 0.0118, 0.0054, 0.0014) : extrudeRound(sdPolygon(u, v, defl), x - 0.0105, 0.0048, 0.0014), 0.0015);
    if (b.max && x < 0) {
      // Links: Freischnitt über dem Verschlussfang (Paddel taucht ins Oberteil)
      d = Math.max(d, -sdBox(x, v, u, -0.0128, V(1196) + 0.0012, bcU, 0.0036, 0.0034, 0.0066));
    }
    return d;
  };
  sdfMesh(b, upperF, [b.max ? -0.0195 : -0.0165, V(1200), U(996)], [b.max ? 0.0195 : 0.0165, V(956), U(1900)], 0.0017, 'm17Rec', { cav: ALU, fine: 0.45 });   // PC: Hülsenabweiser steht weiter vor
}

// Schienen-Handschutz: am PC hohl mit echten Lüftungslöchern, sonst Profil mit dunklen Öffnungen
function m17Handguard(b, axis) {
  // ---------------------------------------------------------------- Schienen-Handschutz: Profil + Lüftungsfenster (dunkle Öffnungen)
  const [ra0, ra1] = R.RAS, ru0 = U(ra0), ru1 = U(ra1), H = R.RAS_HALF;
  const upH = [2049, 2146, 2243, 2340, 2436, 2533, 2630], loH = [2041, 2122, 2211, 2291, 2372, 2453, 2533, 2614];
  if (b.max) {
    // Hohler Handschutz aus Wänden mit echten Lüftungslöchern (Lauf und Gasrohr innen sichtbar), runde Ecken, Endringe
    const t = 0.0022, rc = 0.004, hw = H - rc;
    const holes = [...upH.map((x) => ellipsePts(U(x), axis + 0.0143, 0.0072, 0.0033, 22)), ...loH.map((x) => ellipsePts(U(x), axis - 0.0156, 0.0046, 0.0018, 16))];
    for (const s of [-1, 1]) b.side('m17Ras', [[ru0, axis - hw], [ru1, axis - hw], [ru1, axis + hw], [ru0, axis + hw]], t, s * (H - t / 2), { holes, bevel: 0.0003 });
    for (const s of [-1, 1]) b.top('m17Ras', [[-hw, ru0], [hw, ru0], [hw, ru1], [-hw, ru1]], t, axis + s * (H - t / 2), { bevel: 0.0003 });
    for (const [sx, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const arc = (r, rev) => Array.from({ length: 7 }, (_, k) => { const a = (rev ? 6 - k : k) / 6 * Math.PI / 2; return [sx * (hw + Math.cos(a) * r), axis + sv * (hw + Math.sin(a) * r)]; });
      b.front('m17Ras', [...arc(rc, false), ...arc(rc - t, true)], ru1 - ru0, ru0);
    }
    const ringOut = roundRect(-H + 0.0003, axis - H + 0.0003, H - 0.0003, axis + H - 0.0003, rc, 3), bore = ellipsePts(0, axis, 0.0128, 0.0128, 28);
    b.front('m17Ras', ringOut, 0.0032, ru1 - 0.0032, { holes: [bore], bevel: 0.0006 });
    b.front('m17Ras', ringOut, 0.003, ru0, { holes: [bore] });
  } else {
    b.front('m17Ras', roundRect(-H, axis - H, H, axis + H, 0.004, 3), ru1 - ru0, ru0, { bevel: 0.0015 });
    for (const s of [-1, 1]) {
      for (const x of upH) b.circle('cavity', 0.0033, s * (H + 0.0002), axis + 0.0143, U(x), { ry: s * Math.PI / 2, sx: 0.0072 / 0.0033, seg: 20 });
      for (const x of loH) b.circle('cavity', 0.0018, s * (H + 0.0002), axis - 0.0156, U(x), { ry: s * Math.PI / 2, sx: 0.0046 / 0.0018, seg: 16 });
    }
  }
}

// Kornträger (A-Rahmen mit Fenster, Bajonetthalter, Riemenbügel) als Distanzfeld
function m17FrontSight(b, axis, rk) {
  // ---------------------------------------------------------------- Kornträger (A-Rahmen mit Fenster, Bajonetthalter, Riemenbügel)
  const fs = R.M(R.FSB), fh = R.M(R.FSB_HOLE), fD = field2(fs, [fh], 0.0004);
  const fa = U(2778), fb = U(2888);
  const fsbF = (x, v, u) => {
    const d2 = fD(u, v);
    if (d2 > 0.005) return d2;
    let d = extrudeRound(d2, x, 0.0062, 0.0011 * rk);
    d = Math.max(d, -Math.max(Math.abs(v - axis) - 0.0091, Math.min(u - fa, fb - u)));   // Lauf läuft frei durch (außer im Fuß)
    return Math.max(d, -Math.max(Math.abs(x) - 0.0026, V(862) - v));                     // Schutzohren: oben offen, Korn dazwischen
  };
  sdfMesh(b, fsbF, [-0.0078, V(1262), U(2686)], [0.0078, V(738), U(2944)], 0.0011, 'm17Steel', { cav: STEEL, fine: 0.5 });
}

// Verschlussträgergruppe in voller Länge nach Original: Träger Ø 24,8 mm mit 14 Rastkerben für den Hilfsschließer,
// Verschluss Ø 13 mm mit sieben Verriegelungswarzen, Auszieher mit Kralle und Stift, Schlagbolzenloch und Auswerfer in
// der Stirn; Laufverlängerung mit acht Warzen, M4-Zuführrampen und Patronenlager. Der Träger läuft beim Schuss 82 mm
// zurück (handling boltTravel) – das Fenster zeigt dann Verschlusskopf und offenes Patronenlager. Anker boltFace =
// Verschlussstirn (dort startet die Hülse, Viewmodel _ejectFromBolt).
function m17BoltGroup(b, axis) {
  const uCf = EP.uBX - 0.003, uBF = EP.uBX + 0.0105, L = uBF - uCf, P = { part: 'bolt' };
  b.lathe('m17Bcg', [[-0.15, 0], [-0.15, 0.0118], [-0.1494, 0.0124], [-0.0013, 0.0124], [0, 0.0114], [0, 0.0068]], 0, axis, uCf, { ...P, seg: 40 });
  for (let i = 0; i < 14; i++) b.box('cavity', 0.0008, 0.0048, 0.0008, Math.cos(0.12) * 0.0121, axis + Math.sin(0.12) * 0.0121, EP.u - 0.026 + i * 0.0018, { ...P, rz: 0.12, c: 0 });
  b.lathe('m17Bcg', [[0, 0.0066], [L - 0.0062, 0.0066], [L - 0.0062, 0.0058], [L - 0.0004, 0.0058], [L, 0.0054], [L, 0]], 0, axis, uCf, { ...P, seg: 32 });
  for (let k = 1; k < 8; k++) { const a = k * Math.PI / 4; b.box('m17Bcg', 0.0022, 0.0026, 0.0048, Math.cos(a) * 0.0069, axis + Math.sin(a) * 0.0069, uBF - 0.003, { ...P, rz: a, c: 0.0003 }); }
  b.box('m17Bcg', 0.0018, 0.0038, 0.0215, 0.0067, axis, uBF - 0.0108, { ...P, c: 0.0004 });          // Auszieher
  b.box('m17Bcg', 0.0012, 0.0038, 0.0014, 0.0052, axis, uBF + 0.0004, { ...P, c: 0.0002 });           // Kralle
  b.cyl('m17Bcg', 0.0008, 0.0008, 0.0046, 0.0067, axis, uBF - 0.017, { ...P, axis: 'v', seg: 10 });   // Auszieherstift
  b.circle('cavity', 0.001, 0, axis, uBF + 0.0001, { ...P, ry: Math.PI, seg: 12 });                      // Schlagbolzenloch
  b.circle('cavity', 0.0009, Math.cos(3.5) * 0.0037, axis + Math.sin(3.5) * 0.0037, uBF + 0.0001, { ...P, ry: Math.PI, seg: 10 });   // Auswerfer
  b.anchor('boltFace', 0, axis, uBF, P);
  // Laufverlängerung (fest), Warzen innen, Zuführrampen unten, Patronenlager dunkel
  b.lathe('m17Bcg', [[0, 0.0084], [0, 0.0126], [0.017, 0.0126], [0.017, 0.0072], [0.0012, 0.0072], [0, 0.0084]], 0, axis, EP.uBX, { seg: 40 });
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; b.box('m17Bcg', 0.001, 0.0028, 0.0045, Math.cos(a) * 0.0067, axis + Math.sin(a) * 0.0067, EP.uBX + 0.0035, { rz: a, c: 0.0002 }); }
  for (const a of [-1.95, -1.19]) b.box('cavity', 0.003, 0.0035, 0.003, Math.cos(a) * 0.0088, axis + Math.sin(a) * 0.0088, EP.uBX + 0.001, { rz: a, c: 0 });
  b.circle('cavity', 0.0072, 0, axis, EP.uBX + 0.0166, { seg: 24 });
}

// Staubschutzdeckel nach Original: gewölbtes Stahlblech (1,1 mm) mit runden Ecken, an beiden Enden um die Stange
// gerollte Scharnieraugen, innen die Riegelnase; Scharnierstange mit Lageraugen am Gehäuse, Drehfeder in der Mitte,
// Sicherungsring vorn. Als Distanzfeld in geschlossener Lage beschrieben, im Modell offen (um EP.open gedreht).
function m17DustCover(b, axis) {
  b.part('dustCover', EP.hx, EP.hv2, EP.cu);
  const co = Math.cos(EP.open), so = Math.sin(EP.open), sC = (EP.thB + EP.thT) / 2, hs = (EP.thT - EP.thB) / 2 * EP.Rm;
  const lth = EP.thT - 0.16, lr = EP.Rm - 0.001, lx = lr * Math.cos(lth), lv = axis + lr * Math.sin(lth);
  const closed = (x, v, u) => {
    const rr = Math.hypot(x, v - axis), s = (Math.atan2(v - axis, x) - sC) * EP.Rm;
    let d = extrudeRound(sdRoundRect(u - EP.cu, s, EP.cl, hs, 0.0032), rr - EP.Rm, 0.00055, 0.00028);
    d = smin(d, Math.max(Math.hypot(x - EP.hx, v - EP.hv2) - 0.00125, Math.abs(Math.abs(u - EP.cu) - (EP.cl - 0.0052)) - 0.0046), 0.0005);
    return Math.min(d, sdBox(x, v, u, lx, lv, EP.cu - EP.cl + 0.0075, 0.0009, 0.0011, 0.0017) - 0.0002);
  };
  const f = (x, v, u) => { const dx = x - EP.hx, dv = v - EP.hv2; return closed(EP.hx + dx * co - dv * so, EP.hv2 + dx * so + dv * co, u); };
  b.shared('staubdeckel', () => {
    const g = surfaceNets(f, [0.0092, 0.057, EP.cu - EP.cl - 0.002], [0.0285, 0.0885, EP.cu + EP.cl + 0.002], 0.00042);
    cavityColors(g, f, STEEL);
    b._push(g, 'm17Steel', { part: 'dustCover' });
  });
  const rl = 2 * EP.cl + 0.009;
  b.cyl('m17Steel', 0.0008, 0.0008, rl, EP.hx, EP.hv2, EP.cu, { seg: 12 });
  for (const s of [-1, 1]) b.cyl('m17Rec', 0.0018, 0.0018, 0.0034, EP.hx - 0.0004, EP.hv2, EP.cu + s * (EP.cl + 0.0024), { seg: 16 });
  b.torus('m17Steel', 0.00112, 0.00028, EP.hx, EP.hv2, EP.cu + EP.cl + 0.0045, { arc: Math.PI * 1.6, rz: 2.2, seg: 6, tseg: 14 });
  const coil = [], n = 9 * 14, cl = 0.021;
  for (let i = 0; i <= n; i++) { const a = i / 14 * Math.PI * 2; coil.push([EP.hx + Math.cos(a) * 0.00118, EP.hv2 + Math.sin(a) * 0.00118, EP.cu - cl / 2 + cl * i / n]); }
  b.tube('m17Steel', coil, 0.00026, { tubSeg: n * 2, seg: 5 });
}

// A2-Feuerdämpfer (Vogelkäfig) wie am Vorbild: Bund mit Quetschscheibe, fünf durchgehende Schlitze im Käfig (unten
// geschlossen gegen Staub), vorn ein Ring mit weiter Öffnung, innen dunkel mit der Laufmündung am Grund
function m17Birdcage(b, u0, axis) {
  const ro = 0.0104, ri = 0.0062, L = 0.0473, s0 = 0.017, s1 = 0.036;
  const ring = (r, n = 28) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, axis + Math.sin(i / n * Math.PI * 2) * r]);
  // Bots: ein Zylinder über die ganze Länge (24.10.: Bot-Stufe ≤ 600 Dreiecke; Absätze sind dort ohnehin unsichtbar)
  if (!b.hi) { b.cyl('m17Steel', ro, ro, L, 0, axis, u0 + L / 2, { seg: 6 }); return u0 + L; }
  b.lathe('m17Steel', [[-0.0016, 0], [-0.0016, 0.0097], [0, 0.0097]], 0, axis, u0, { seg: b.seg(24, 8) });                 // Quetschscheibe
  b.lathe('m17Steel', [[0, 0], [0, ro * 0.92], [0.0012, ro], [0.013, ro]], 0, axis, u0, { seg: b.seg(28, 8) });
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
  sdfMesh(b, bodyF, [-0.034, V(1206), U(214)], [0.034, V(984), U(1002)], 0.0019, 'm17Furn', { uv: furnUV3, cav: POLY });
  // Steg, Hebel, untere Kappe: flache Teile als Profil-Extrusionen (Konturen aus den 2D-Feldern)
  const vCut = vT + 0.0015, vSplit = V(1205), uPad = U(300), uLev = U(553), vLev = V(1266);
  const rib = [U(322), V(1204), U(479), V(1351)], boss = [U(422), V(1307)];
  const slots = SLOTS.map(([x0, y0, x1, y1]) => [(U(x0) + U(x1)) / 2, (V(y0) + V(y1)) / 2, (U(x1) - U(x0)) / 2, (V(y0) - V(y1)) / 2]);
  const slotD = (u, v) => Math.min(...slots.map(([cu, cv, hu, hv]) => sdRoundRect(u - cu, v - cv, hu, hv, Math.min(hu, hv))));
  const outl = (u, v) => Math.max(stD(u, v), v - vCut, -slotD(u, v));
  const lever = (u, v) => Math.max(uLev - u, v - vLev);
  const recess = (u, v) => Math.max(Math.max(stD(u, v), v - vSplit, uPad - u) + 0.0042, -(segDist(u, v, ...rib) - 0.0021), -(Math.hypot(u - boss[0], v - boss[1]) - 0.0046), -lever(u, v));
  const win = [U(214), U(915), V(1512), vCut + 0.002];
  const furn = { mat: 'm17Furn', uv: furnUV3 };
  sideFurn(b, (u, v) => Math.max(outl(u, v), -lever(u, v), -recess(u, v), uPad - u), win, 0.0104, 0.0012, furn);   // Rand + Rippe
  sideFurn(b, (u, v) => Math.max(outl(u, v), -lever(u, v)), win, 0.0056, 0.0006, furn);                             // vertiefte Felder
  sideFurn(b, (u, v) => Math.max(outl(u, v), u - uPad - 0.0004), win, 0.0115, 0.0016, furn);                        // Kappe unten
  sideFurn(b, (u, v) => Math.max(outl(u, v), lever(u, v), -Math.max(Math.abs(u - (U(743) + U(790)) / 2) - 0.0056, v - V(1279))), win, 0.0072, 0.0016, furn);   // Hebel
  if (b.hi) {
    b.cyl('m17Furn', 0.0052, 0.0052, V(1279) - V(1311), 0, (V(1279) + V(1311)) / 2, (U(743) + U(790)) / 2, { axis: 'v', seg: 16 });   // Riemenzapfen
    b.cyl('m17Furn', 0.0046, 0.0046, 0.0224, 0, boss[1], boss[0], { axis: 'x', seg: 18 });                                           // Bolzen
    b.cyl('m17Steel', 0.0013, 0.0013, 0.0238, 0, boss[1], boss[0], { axis: 'x', seg: 10 });
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
  // Prägung links zwischen den Rippen (dem Bogen folgend)
  if (b.max) mark(b, 'NP 5,56 MM · 30 SCHUSS', -0.01117, V(1652), U(1677), 0.0021, { part: 'mag', vertical: true, rx: 0.2 });
  // Bodenplatte: etwas breiter, folgt der Unterkante (aus dem Foto)
  if (b.hi) {
    const fl = [[1913, 1788], [1880, 1813], [1800, 1831], [1720, 1856], [1668, 1865], [1647, 1846]];
    b.side('m17Rec', R.M([...fl, ...fl.slice().reverse().map(([x, y]) => [x - 3, y - 15])]), 0.0238, 0, { part: 'mag', bevel: 0.0009 });
  }
  const path = [[1701, 1250], [1700, 1452], [1722, 1600], [1748, 1760], [1760, 1830]].map(([x, y]) => [0, V(y), U(x)]);
  magRounds(b, { cal: 'r556', width: 0.0195, depth: 0.058, show: 3, path });
  b.anchor('magGrab', 0, V(1620), U(1752), { part: 'mag', data: { w: 0.0113, d: 0.029 } });
}
