// Pistolen: P-9 Kompakt (Polymer, Schlagbolzen). Adler .50 nach Foto in guns-adler.js (25.10.).
import { slots } from './parts.js';
import { magRounds } from './magfill.js';
import { sdPolygon, extrudeRound, smin, surfaceNets, sdBox, sdEllipsoid, simplifyPoly, grid2D, cavityColors } from './sdf.js';
import * as R from './p9-ref.js';
import { slideUV, frameUV, atlasUV } from './p9-tex.js';

const RAKE = 0.3;

// Magazin im Griff: fällt entlang der Griffachse heraus
// cal = Kaliber (magfill.js): oberste Patronen an den Lippen bzw. leerer Zubringer (Stahl, beim Wechsel sichtbar)
// Exportiert (24.10.) für den Pistolen-Baukasten (P-9A, Sperber …)
export function gripMag(b, { u, v, w, len, depth, plate = 'polymer', body = 'steel', rake = RAKE, cal = 'p9' }) {
  b.part('mag', 0, v, u);
  const s = Math.sin(rake), c = Math.cos(rake);
  // Körper (im Griff verborgen, sichtbar beim Wechsel)
  b.box(body, w, len, depth, 0, v + c * len / 2 + 0.004, u + s * len / 2, { part: 'mag', rx: -rake, c: 0.0015 });
  if (plate) b.box(plate, w + 0.005, 0.009, depth + 0.008, 0, v, u + 0.002, { part: 'mag', rx: -rake, c: 0.0025 });
  const at = (l) => [0, v + 0.004 + c * l, u + s * l];
  magRounds(b, { cal, fit: depth - 0.003, width: w - 0.003, depth: depth - 0.002, path: [at(len + 0.002), at(0.02)] });
  b.anchor('magGrab', 0, v - 0.004, u + 0.004, { part: 'mag', data: { w: 0.011, d: 0.016 } });
}

// Lage der wichtigsten P-9-Maße (auch für Abwandlungen wie die Funke)
export const P9 = { axis: R.V(R.BORE_Y), top: R.V(297), bottom: R.V(451), front: R.U(171), rear: R.U(1579), hw: 0.01275 };

/**
 * P-9 (Glock 17, 4. Gen.). o (26.10., Pistolen-Baukasten G6, Ableitung P-9A): Abwandlungen in Modellmaßen – ohne o baut
 * der Plan exakt wie zuvor (Geometrie-Hash aller Stufen bitgleich geprüft). Felder (alle optional):
 *   slide, lower, open, botGrip   Seitenumriss Schlitten, Rahmenumriss, Bügelöffnung, Griffprofil der Bot-Stufe ([[u, v], …])
 *   boss, ledge, slot      Buckel des Zerlegehebels, Abweisleiste, Schlitz; takedown + takedownRibs(b) Zerlegehebel
 *   trigger, safety, slideStop + stopMat + stopRibs(b), magRelease, pins [[u, v, r]]   Bedienteile und Querstifte
 *   frontSight, rearSight, notch { rv, ru, uf } bzw. rearNotch(b), frontDot { v, u, rx }, sight { v, u }   Visierung
 *   step { slide, frame } je Stufe { max, std, lite }, mats { slide, frame }, slideUV, frameUV, atlas (UV-Funktion)
 *   slideCut(d, x, v, u) → d   zusätzliche Aussparungen im Schlitten (Kompensatorfenster)
 *   barrel(b, port)       eigener Lauf statt Haube + Drehteil (Kompensatorbohrungen); mag(b, rake) eigenes Magazin,
 *   magWell { v, u }, muzzleU   Lage des Magazinschachts und der Mündung (Anker)
 *   meta                  zusätzliche Metadaten (Wahlhebel …)
 */
export function p9(b, o = {}) {
  // Nach dem Referenzfoto einer Glock 17 (4. Generation) nachgebaut, alle Umrisse und Lagen aus dem Foto (p9-ref.js):
  // flacher Schlitten 186 × 25,5 × 20,4 mm mit gerundeter Nase, Fasen oben, 7 Sägezahnrillen hinten, Auswurffenster
  // mit Laufhaube; Polymerrahmen mit Schiene (Längsnut, ein Querschlitz), Zerlegehebel im Buckel, zwei Querstifte,
  // Schlittenfang aus Edelstahl über einer Abweisleiste, Daumenmulde, großer Magazinhalter, Griff mit Fingermulden
  // und 22° Griffwinkel, Würfelraster/Rillen als eigene Texturen (p9-tex.js). Ego-Detailstufe aus Distanzfeldern.
  const { axis, top: vTop, front: uF, rear: uB, hw: HW } = P9;
  const rake = 0.38;
  const sideSL = o.slide || R.M(R.SLIDE), lower = o.lower || R.M(R.LOWER), open = o.open || R.M(R.OPEN);
  const MAT = o.mats || { slide: 'p9Slide', frame: 'p9Frame' }, UVA = o.atlas || atlasUV;
  const stepOf = (k, max, std) => (o.step ? o.step[k][b.tier] : b.max ? max : std);
  b.part('slide', 0, axis, 0);
  if (b.hi) {
    // ---------------------------------------------------------------- Schlitten (Distanzfeld)
    const port = { cx: 0.008, hx: 0.012, cu: 0.0405, hu: 0.0205, v0: axis + 0.0034 };
    // Schlitten und Rahmen als geteilte Blöcke (Bauteil-Cache, 24.10.): je Stufe einmal gerechnet, in allen
    // Aufsatz-Varianten wiederverwendet
    b.shared('schlitten', () => {
      const sideD = grid2D((u, v) => sdPolygon(u, v, sideSL), uB - 0.002, uF + 0.002, P9.bottom - 0.002, vTop + 0.002, 0.0004);
      const slideF = (x, v, u) => {
        const ax = Math.abs(x);
        let d = extrudeRound(sideD(u, v), x, HW, 0.0006);
        d = Math.max(d, (ax - HW + v - (vTop - 0.0025)) * Math.SQRT1_2);                    // Fasen oben
        const r = u > 0.05 ? 0.0028 : 0.0014;                                               // senkrechte Kanten gerundet
        const qx = Math.abs(u - (uF + uB) / 2) - (uF - uB) / 2 + r, qz = ax - HW + r;
        d = Math.max(d, Math.min(Math.max(qx, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) - r);
        d = Math.max(d, -Math.max(Math.hypot(x, v - axis) - 0.0068, uF - 0.008 - u));         // Mündungsöffnung
        d = Math.max(d, -sdBox(x, v, u, port.cx, (port.v0 + vTop + 0.004) / 2, port.cu, port.hx, (vTop + 0.004 - port.v0) / 2, port.hu));
        return o.slideCut ? o.slideCut(d, x, v, u) : d;
      };
      // PC (b.max): feineres Netz + Gebrauchsspuren (blanke Kanten am Schlitten, Schmutz in Rillen)
      // Handy (b.lite): bewusst dasselbe Raster wie Standard – ein gröberes (× 1,4: 37 810 statt 71 666 Dreiecke, auch
      // × 1,15 oder nur der Schlitten) war im Bildvergleich sichtbar (Hebel, Kanten; 24.10.), die P-9 bleibt optisch
      // unverändert. Das Handy spart über den halben Atlas (p9Slide@lite/p9Frame@lite, materials.js).
      const sg = surfaceNets(slideF, [-0.0138, P9.bottom - 0.0012, uB - 0.0012], [0.0138, vTop + 0.0012, uF + 0.0012], stepOf('slide', 0.0007, 0.00115));
      if (b.max) cavityColors(sg, slideF, { r: 0.0008, edge: 0.9, cavity: 0.6 });
      b._push(UVA(sg, o.slideUV || slideUV), MAT.slide, { part: 'slide' }, true);
    });
    // Lauf: Haube im Auswurffenster, Mündung mit Krone und Bohrung knapp vor der Schlittenfront
    if (o.barrel) o.barrel(b, port);
    else {
      b.box('barrelNitride', 0.0125, vTop - 0.0007 - (axis - 0.002), port.hu * 2 - 0.0008, 0, (vTop - 0.0007 + axis - 0.002) / 2, port.cu, { part: 'slide', c: 0.0005 });
      b.lathe('barrelNitride', [[0, R.BARREL_R], [uF + 0.0007 - 0.06, R.BARREL_R], [uF + 0.0007 - 0.06, 0.0046]], 0, axis, 0.06, { part: 'slide', seg: 28 });
      b.bore(0.0046, 0, axis, uF + 0.0011, { part: 'slide', seg: 24 });
    }
    // Auszieher rechts hinter dem Fenster, Abdeckplatte hinten mit Schlagbolzenkanal
    b.box('steel', 0.0007, 0.0034, 0.017, HW + 0.0001, axis + 0.0042, port.cu - port.hu - 0.0095, { part: 'slide', c: 0.0003 });
    b.box('polymer', 0.0122, 0.0128, 0.0008, 0, axis - 0.0022, uB - 0.0002, { part: 'slide', c: 0.0003 });
    b.circle('cavity', 0.0012, 0, axis, uB - 0.0007, { part: 'slide', ry: Math.PI, seg: 10 });
    // ---------------------------------------------------------------- Rahmen + Abzugsbügel + Griff (ein Spritzgussteil)
    b.shared('rahmen', () => {
      const [A, B] = R.M(R.GRIP_LINE);
      const lx = B[0] - A[0], lv = B[1] - A[1], ll = Math.hypot(lx, lv);
      const vBand = R.V(592), vGuardTop = R.V(565), vGripTop = R.V(540), vFlare0 = R.V(560), vFlare1 = R.V(690);
      const boss = o.boss || R.M(R.TAKEDOWN_BOSS), slot = o.slot || R.M(R.TAKEDOWN), ledge = o.ledge || R.M(R.STOP_LEDGE);
      const [tx, ty, trx, try_] = R.THUMB_REST, [dx, dy, dr] = R.GUARD_DIMPLE;
      const thumb = { u: R.U(tx), v: R.V(ty), ru: trx / R.PPM, rv: try_ / R.PPM };
      const dimple = { u: R.U(dx), v: R.V(dy), r: dr / R.PPM };
      const railV = R.V(492), railU0 = R.U(600), slotU = R.U(374);
      const box2 = (pts) => { const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]); return [Math.min(...us) - 0.002, Math.max(...us) + 0.002, Math.min(...vs) - 0.002, Math.max(...vs) + 0.002]; };
      const BB = { boss: box2(boss), ledge: box2(ledge), slot: box2(slot) };
      const inBox = (b, u, v) => u > b[0] && u < b[1] && v > b[2] && v < b[3];
      const smooth = (e0, e1, t) => { const k = Math.min(1, Math.max(0, (t - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
      const outD = grid2D((u, v) => Math.max(sdPolygon(u, v, lower), -sdPolygon(u, v, open)), R.U(1700), R.U(175), R.V(1260), R.V(450), 0.0005);
      const frameF = (x, v, u) => {
        const ax = Math.abs(x);
        const d2 = outD(u, v);
        if (d2 > 0.004 || ax > 0.02) return Math.max(d2, ax - 0.016);
        const side = ((u - A[0]) * lv - (v - A[1]) * lx) / ll;                               // > 0: hinter der Griffvorderkante
        const hwG = 0.0111 + 0.0041 * smooth(vFlare0, vFlare1, v);
        let d = extrudeRound(Math.max(d2, vBand - v), x, 0.011, 0.0012);                    // Staubschutz, Schienen, Biberschwanz
        d = smin(d, extrudeRound(Math.max(d2, side, v - vGuardTop), x, 0.0047, 0.0018), 0.003);      // Abzugsbügel
        d = smin(d, extrudeRound(Math.max(d2, -side, v - vGripTop), x, hwG, 0.0075), 0.004);        // Griff
        // Kleinteile nur in ihrer Umgebung auswerten (spart den Großteil der Rechenzeit)
        if (inBox(BB.boss, u, v)) d = smin(d, extrudeRound(sdPolygon(u, v, boss), x, 0.0118, 0.0006), 0.0008);   // Buckel um den Zerlegehebel
        if (inBox(BB.ledge, u, v)) d = smin(d, extrudeRound(sdPolygon(u, v, ledge), x, 0.0123, 0.0007), 0.0006);  // Abweisleiste unter dem Schlittenfang
        if (inBox(BB.slot, u, v)) d = Math.max(d, -Math.max(sdPolygon(u, v, slot), 0.0104 - ax));                 // Schlitz für den Zerlegehebel
        if (u > railU0 && Math.abs(v - railV) < 0.003) d = Math.max(d, -Math.max(Math.abs(v - railV) - 0.0011, 0.0097 - ax, railU0 - u));   // Längsnut der Schiene
        if (Math.abs(u - slotU) < 0.003) d = Math.max(d, -Math.max(Math.abs(u - slotU) - 0.0009, v - R.V(562)));   // Querschlitz
        if (Math.abs(u - thumb.u) < thumb.ru + 0.004 && Math.abs(v - thumb.v) < thumb.rv + 0.004) d = -smin(-d, sdEllipsoid(ax, v, u, hwG + 0.0052, thumb.v, thumb.u, 0.0062, thumb.rv, thumb.ru), 0.003);   // Daumenmulde (weich)
        if (Math.abs(u - dimple.u) < 0.005 && Math.abs(v - dimple.v) < 0.005) d = Math.max(d, -sdEllipsoid(ax, v, u, 0.0047 + dimple.r - 0.0008, dimple.v, dimple.u, dimple.r, dimple.r, dimple.r));  // Mulde am Bügel
        return d;
      };
      const fg = surfaceNets(frameF, [-0.0172, R.V(1258), R.U(1698)], [0.0172, R.V(452), R.U(177)], stepOf('frame', 0.0008, 0.0013));   // Handy: Standard-Raster (s. Schlitten)
      if (b.max) cavityColors(fg, frameF, { r: 0.0011, edge: 0.5, cavity: 0.55 });
      b._push(UVA(fg, o.frameUV || frameUV), MAT.frame, {}, true);
    });
  } else {
    // Bot-Detailstufe: Profile aus denselben Fotoumrissen, stark vereinfacht
    b.side('slideNitride', simplifyPoly(sideSL, 0.0015), HW * 2, 0, { part: 'slide', bevel: 0.0015 });
    const gripI0 = R.LOWER.findIndex(([x, y]) => x === 1467 && y === 643), gripI1 = R.LOWER.findIndex(([x, y]) => x === 1107 && y === 788);
    b.side('polymerSatin', simplifyPoly(lower, 0.0016), 0.022, 0, { bevel: 0.002, holes: [simplifyPoly(open, 0.002)], keepHoles: true });
    b.side('polymerSatin', simplifyPoly(o.botGrip || [...lower.slice(gripI0, gripI1 + 1), [R.U(1059), R.V(594)], [R.U(1470), R.V(560)]], 0.0022), 0.029, 0, { bevel: 0.006, bevelSeg: 2 });
  }
  // ---------------------------------------------------------------- Visierung (Polymer, weißer Punkt / weißes U)
  b.side('polymer', o.frontSight || R.M(R.FRONT_SIGHT), 0.0032, 0, { part: 'slide', bevel: 0.0005 });
  b.side('polymer', o.rearSight || R.M(R.REAR_SIGHT), 0.0148, 0, { part: 'slide', bevel: 0.0006 });
  if (b.hi) {
    if (o.rearNotch) o.rearNotch(b);
    else {
      const { rv, ru, uf } = o.notch || { rv: R.V(267), ru: R.U(1540), uf: R.U(1466) };
      b.box('cavity', 0.0034, 0.0026, uf - ru + 0.0006, 0, rv - 0.0011, (uf + ru) / 2, { part: 'slide', c: 0 });
      for (const s of [-1, 1]) b.box('paintWhite', 0.0008, 0.0031, 0.0003, s * 0.0025, rv - 0.0016, ru - 0.0002, { part: 'slide', c: 0 });
      b.box('paintWhite', 0.0058, 0.0008, 0.0003, 0, rv - 0.0034, ru - 0.0002, { part: 'slide', c: 0 });
    }
    const fd = o.frontDot || { v: R.V(288), u: R.U(309) - 0.0004, rx: -0.55 };
    b.circle('paintWhite', 0.001, 0, fd.v, fd.u, { part: 'slide', rx: fd.rx, seg: 12 });
  }
  b.anchor('slideGrab', 0, axis + 0.002, R.U(1380), { part: 'slide', data: { travel: [0, 0, 0.032] } });
  // ---------------------------------------------------------------- Abzug, Bedienteile, Stifte
  b.side('polymer', o.trigger || R.M(R.TRIGGER), 0.0058, 0, { bevel: 0.0009 });
  if (b.hi) b.side('polymer', o.safety || R.M(R.SAFETY), 0.0024, 0, { bevel: 0.0004, u: 0.0006 });
  b.anchor('trigger', 0, R.V(690), R.U(996));
  if (b.hi) {
    // Schlittenfang links (Edelstahl, drei Rillen), Zerlegehebel beidseitig im Schlitz (gerillt)
    b.side(o.stopMat || 'stainless', o.slideStop || R.M(R.SLIDE_STOP), 0.0016, -0.0118, { bevel: 0.0005 });
    if (o.stopRibs) o.stopRibs(b);
    else for (let i = 0; i < 3; i++) b.box('cavity', 0.0003, 0.0004, 0.0078, -0.0127, R.V(466 + i * 11), R.U(1168), { c: 0 });
    b.side('polymer', o.takedown || R.M(R.TAKEDOWN), 0.0222, 0, { bevel: 0.0003 });
    if (o.takedownRibs) o.takedownRibs(b);
    else for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.box('polymer', 0.0006, 0.0006, 0.0047, s * 0.0112, R.V(492 + i * 7), R.U(829), { c: 0 });
    for (const [pu, pv, r] of o.pins || R.PINS.map(([px, py, pr]) => [R.U(px), R.V(py), pr / R.PPM])) {
      b.cyl('steelDark', r, r, 0.0226, 0, pv, pu, { axis: 'x', seg: 12 });
      if (r > 12 / R.PPM) b.cyl('steelBright', 0.0011, 0.0011, 0.0228, 0, pv, pu, { axis: 'x', seg: 10 });
    }
    // Magazinhalter links (gerillt, parallel zur Griffachse)
    const mr = o.magRelease || R.M(R.MAG_RELEASE);
    b.side('polymer', mr, 0.0032, -0.0146, { bevel: 0.0006 });
    const [m0, m1, m2, m3] = mr;
    for (let i = 1; i < 8; i++) {
      const t = i / 8, a = [m0[0] + (m1[0] - m0[0]) * t, m0[1] + (m1[1] - m0[1]) * t], c = [m3[0] + (m2[0] - m3[0]) * t, m3[1] + (m2[1] - m3[1]) * t];
      b.box('cavity', 0.0004, Math.hypot(c[0] - a[0], c[1] - a[1]) * 0.9, 0.0005, -0.0163, (a[1] + c[1]) / 2, (a[0] + c[0]) / 2, { rx: -Math.atan2(a[0] - c[0], a[1] - c[1]), c: 0 });
    }
    // Führungsstange der Schließfeder vorn im Staubschutz
    b.cyl('cavity', 0.0036, 0.0036, 0.001, 0, R.V(495), R.U(181) + 0.0002, { seg: 16 });
    b.cyl('steelDark', 0.0022, 0.0022, 0.003, 0, R.V(495), R.U(181), { seg: 12 });
  }
  // ---------------------------------------------------------------- Magazin (Boden nach Foto)
  if (o.mag) o.mag(b, rake);
  else {
    const plate = R.M(R.PLATE);
    gripMag(b, { u: R.U(1462), v: R.V(1259), w: 0.0208, len: 0.097, depth: 0.0305, plate: null, rake });
    b.side('polymer', plate, 0.0262, 0, { part: 'mag', bevel: 0.0016 });
  }
  b.anchor('ejection', 0.006, vTop - 0.001, 0.04, { rz: 0.5 });
  b.anchor('muzzle', 0, axis, o.muzzleU ?? uF + 0.0015);
  const grip = { rake, gw: 0.0148, gd: 0.0258, gu: -0.0025, ho: 0.0, tu: 0.052, wrap: 0.38, tf: 0.055 };   // wrap/tf: hands-v3 (Daumen links am Rahmen)
  b.anchor('rightHandGrip', 0, -0.015, R.U(1390), { data: grip });
  const mw = o.magWell || { v: R.V(1259), u: R.U(1462) }, sg = o.sight || { v: R.V(268), u: R.U(1503) };
  b.anchor('magWell', 0, mw.v, mw.u);
  b.anchor('sight', 0, sg.v, sg.u, { data: { type: 'iron', eyeRelief: 0.36 } });
  b.anchor('leftHandGrip', 0, -0.015, R.U(1390), { data: { style: 'pistol', ...grip } });
  b.meta = { sight: 'iron', axis, kind: 'pistol', ...o.meta };
}

export { slots };
