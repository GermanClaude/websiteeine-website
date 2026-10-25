// Adler .50 nach Referenzfoto (IMI Desert Eagle Mark XIX .50 AE, adler-ref.js) – Nutzer 24.10.2026: „Mach die Waffen viel
// detaillierter … nimm echte Bilder aus dem Internet und mach sie danach … ultra realistischer Detailgrad“. Verfahren wie
// M-17/P-9/VP-9: Umrisse aus dem freigestellten Foto verfolgt und kalibriert (Gesamtlänge 273,1 mm), Bauteile als Distanzfelder
// mit eigener Breite:
//   – Schlitten (beweglich): kurzer Block mit schrägem Heck, 45°-Fasen oben, Auswurffenster oben rechts mit Kanal zum Lager,
//     Mulden der beidseitigen Sicherung; 14 schräge Griffrillen im Atlas (Höhe → Normalen, wie die P-9-Sägezähne);
//   – Lauf (fest): Schiene mit Schwalbenschwanz-Kerbe und Querschlitzen, Schrägen zur Schulter, vertiefte Seitenflächen mit
//     Gravur, runder Patronenlager-Teil mit Übergangskurve, Mündung mit Bohrung und blanker Krone;
//   – Rahmen (fest): Staubschutz bis unter die Mündung mit Vorderstück (Trennfuge, Mulde), Absatz der Führungsleiste, eckiger
//     Abzugsbügel, Griffrahmen mit Sporn, Schlitz für den Hahn und den Abzug, Magazinschacht unten offen;
//   – Wickelgriff (Kunststoff, Atlas: Kieselstruktur, rundes Feld mit eigenem Zeichen).
// Kleinteile aus dem Pistolen-Baukasten (pistol-parts.js): Kimme mit Rechteckkimme und Punkten, Korn, Sicherung (Nabe,
// Schlitzschraube, Hebel mit Riffelung, roter Punkt), Hahn mit geriffeltem Sporn, Abzug, Schlittenfang links, Laufriegel rechts
// (Platte + Arm + Inbusachse) mit Knopf links, Magazinhalter (rechts Schlitzkopf, links Knopf), Stifte; Magazin mit breitem Boden
// und 7 Patronen .50 AE. Gravuren als Fantasie-Beschriftung im Atlas (keine Herstellerzeichen).
// Bewegliche Teile: Schlitten (Hub 42 mm, beim Schuss und leer offen), Hahn (gespannt gebaut, fällt beim Schuss), Magazin.
// Detailstufen: PC hoch/ultra (max), PC niedrig/mittel, Handy (lite), Bots (≤ 400 Dreiecke) – Anker in allen Stufen gleich.
import * as R from './adler-ref.js';
import { adlerSteelUV, adlerBodyUV, adlerGripUV } from './adler-tex.js';
import { extrudeRound, smin, simplifyRing } from './sdf.js';
import { STEEL, POLY, field2, box2, sdfMesh, inBox, roundMax } from './sdfkit.js';
import { pinHead, slotScrew, hexPivot, pushButton, notchSight, bladeSight, raisedRibs, sideUV, outlineField, atlasUVTri } from './pistol-parts.js';
import { magRounds } from './magfill.js';

const { U, V, M } = R;
const AX = R.AXIS;
const HW_SLIDE = 0.0145, HW_BARREL = 0.0142, HW_FRAME = 0.0135;
// Raster der vorgerechneten 2D-Umrissfelder je Stufe (wie VP-9): fein nur am PC hoch, sonst gröber (bilinear abgefragt)
const G2 = (b, s) => (b.max ? s : b.lite ? s * 3 : s * 2.2);
// Atlas je Stufe: PC niedrig/mittel mit eigenem, kleinerem Atlas (…S); Handy über liteKey (…@lite)
const STEELM = (b) => (b.max || b.lite ? 'adlerSteel' : 'adlerSteelS');
const GRIPM = (b) => (b.max || b.lite ? 'adlerGrip' : 'adlerGripS');
const clamp01 = (t) => Math.min(1, Math.max(0, t));
// Fotoumrisse mit vielen Punkten (Rahmen 223, Griff 207) als outlineField (exakt nur nahe der Kante); das 2D-Feld des Griffs
// je Bau nur einmal (Rahmen spart den Griff aus, der Griff selbst) – Bauzeit (25.10.)
const memo = new WeakMap();
const once = (b, key, make) => { let m = memo.get(b); if (!m) memo.set(b, (m = {})); return m[key] || (m[key] = make()); };
const rectPts = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// Fotoumriss geglättet (25.10., Prüfung „Wellenmaserung“ an Stirn-/Rückflächen): die Randverfolgung hinterlässt 2-px-Treppen
// (0,25 mm); jede Stufe ist eine eigene Facette mit eigener Normale → Spiegelung in Bändern. Douglas-Peucker 0,3 mm entfernt sie.
const MS = (pts) => simplifyRing(M(pts), 0.0003);

export function adler(b) {
  if (b.hi) {
    // Teure Netze als geteilte Blöcke (Bauteil-Cache): je Stufe einmal, in allen Aufsatz-Varianten wiederverwendet
    b.part('slide', 0, AX, 0);
    b.shared('schlitten', () => adlerSlide(b));
    b.shared('rumpf', () => adlerBody(b));
    b.shared('griff', () => adlerGrip(b));
  } else {
    // Bot-Detailstufe: dieselben Fotoumrisse, stark vereinfacht (Pistole ≤ 400 Dreiecke); simplifyRing behält alle
    // Ecken (25.10.: simplifyPoly verlor den letzten Ringpunkt → Schlitten als Keil, Spalten Lauf/Rahmen und Griff/Boden)
    const sp = (pts, tol) => simplifyRing(M(pts), tol);
    b.part('slide', 0, AX, 0);
    b.side('adlerSteel', sp(R.SLIDE, 0.0025), HW_SLIDE * 2, 0, { part: 'slide' });
    b.side('adlerSteel', M([[940, 173], [2207, 173], [2245, 257], [2245, 340], [2229, 369], [940, 372]]), HW_BARREL * 2, 0, {});
    b.side('adlerSteel', sp(R.FRAME, 0.0035), HW_FRAME * 2, 0, { holes: [sp(R.GUARD_OPEN, 0.004)], keepHoles: true });
    b.side('adlerGrip', sp(R.PANEL, 0.004), 0.033, 0, {});
  }
  // ---------------------------------------------------------------- Visierung (Kimme am Schlitten, Korn am Lauf)
  const vS = V(R.SIGHT_Y);
  if (b.hi) {
    notchSight(b, 'adlerBlued', M(R.RSIGHT), 0.0068, { nw: 0.0042, vN: vS, part: 'slide', dots: true, uRear: U(499) });
    // Kimmenfuß im Schwalbenschwanz (25.10.): füllt die Nut über die ganze Schlittenbreite, Enden bündig mit den 45°-Fasen
    const [d0, d1, dy] = R.RSIGHT_DOVE, vT = V(R.SLIDE_TOP_Y), vD = V(dy), hw = HW_SLIDE - 0.0001;
    b.front('adlerBlued', [[-hw, vD], [hw, vD], [hw - (vT - vD), vT], [-(hw - (vT - vD)), vT]], U(d1) - U(d0) - 0.0002, U(d0) + 0.0001, { part: 'slide' });
    bladeSight(b, 'adlerBlued', M(R.FSIGHT), 0.0016, { dot: { v: vS - 0.0013, u: U(2107) } });
  }
  // ---------------------------------------------------------------- Sicherung (beidseitig, am Schlitten)
  if (b.hi) adlerSafety(b);
  // ---------------------------------------------------------------- Hahn (gespannt wie im Foto), Abzug, Bedienteile am Rahmen
  const [hx, hy] = R.HAMMER_PIVOT;
  b.part('hammer', 0, V(hy), U(hx));
  // Sporn gerundet (25.10., Prüfung: von hinten nur eine flache Platte mit Pixelstreifen): stark gebrochene Kanten, Zähne als
  // erhabene blanke Stege quer auf der Spornoberkante (im Profil als Zahnreihe sichtbar)
  b.side('adlerPolish', M(R.HAMMER), 0.0084, 0, { part: 'hammer', bevel: b.hi ? 0.0019 : 0.0008, bevelSeg: b.hi ? 3 : 1 });
  if (b.hi) {
    const [t0, t1, n] = R.HAMMER_TEETH, top = (px) => 242 + (px - 298) * (249 - 242) / (376 - 298);   // Oberkante (Foto)
    if (!b.lite) for (let i = 0; i < n; i++) {
      const px = t0 + (t1 - t0) * (i + 0.5) / n;
      b.box('adlerPolish', 0.0066, 0.0007, 0.00055, 0, V(top(px)) + 0.0002, U(px), { part: 'hammer', rx: -0.09, c: 0.00012 });
    }
    pinHead(b, 'adlerPolish', HW_FRAME - 0.0003, V(hy), U(hx), 0.0024);
    b.side('adlerPolish', M(R.TRIGGER), 0.0072, 0, { bevel: 0.0011, bevelSeg: 2 });
    for (const [px, py, pr] of R.PINS) pinHead(b, 'adlerPolish', HW_FRAME - 0.0002, V(py), U(px), pr / R.PPM);
    adlerControls(b);
  }
  b.anchor('trigger', 0, V(590), U(964));
  // ---------------------------------------------------------------- Mündung (Bohrung in der Stirn, Scheibe 3,5 mm tief, Krone)
  // 25.10. (Prüfung): Scheibe nach VORN gedreht (CircleGeometry zeigt nach hinten, +z – mit einseitigem Material war sie von
  // vorn unsichtbar und der blanke Bohrungsgrund sichtbar); Bohrung 8 mm tief, der Grund bleibt hinter der Scheibe
  const uMz = U(R.MUZZLE_X);
  if (b.hi) {
    b.circle('cavity', 0.0064, 0, AX, uMz - 0.0035, { seg: 28, ry: Math.PI });
    b.lathe('crown', [[-0.0012, 0.00635], [-0.00005, 0.0073]], 0, AX, uMz, { seg: 32 });
  } else b.circle('cavity', 0.0064, 0, AX, uMz + 0.0003, { seg: 8 });
  b.anchor('muzzle', 0, AX, uMz + 0.002);
  // ---------------------------------------------------------------- Magazin
  adlerMag(b);
  // ---------------------------------------------------------------- Anker, Meta
  b.anchor('slideGrab', 0, V(185), U(600), { part: 'slide', data: { travel: [0, 0, 0.042] } });
  b.anchor('ejection', 0.008, V(150), U(880), { rz: 0.35 });
  // Griff aus dem Foto: Vorderseite 15°, Rücken 27° → Hand 22° (wie P-9), Tiefe quer ≈ 62 mm, Breite 33 mm; Anker = Griffmitte in
  // Handhöhe (wie beim alten Modell bei (−0,02 | −0,018), Hüfthaltung bleibt)
  const grip = { rake: 0.38, gw: 0.0165, gd: 0.0295, gu: 0.0, ho: 0.004, tu: 0.054, wrap: 0.38, tf: 0.055 };
  b.anchor('rightHandGrip', 0, R.VA, R.UA, { data: grip });
  b.anchor('leftHandGrip', 0, R.VA, R.UA, { data: { style: 'pistol', ...grip } });
  b.anchor('sight', 0, vS, U(499), { data: { type: 'iron', eyeRelief: 0.36 } });
  b.meta = { sight: 'iron', axis: AX, kind: 'pistol' };
}

// ---------------------------------------------------------------- Schlitten (Distanzfeld, Atlas)
function adlerSlide(b) {
  const sd = field2(M(R.SLIDE), [], G2(b, 0.0003));
  const vTop = V(R.SLIDE_TOP_Y), uP0 = U(R.PORT[0]), uP1 = U(R.PORT[1]), vP = V(R.PORT[2]);
  const rec = field2(M(R.SAFETY_RECESS), [], G2(b, 0.0003)), rb = box2(M(R.SAFETY_RECESS), 0.002);
  const uD0 = U(R.RSIGHT_DOVE[0]), uD1 = U(R.RSIGHT_DOVE[1]), vD = V(R.RSIGHT_DOVE[2]);
  const f = (x, v, u) => {
    const d2 = sd(u, v);
    if (d2 > 0.005) return d2;
    const ax = Math.abs(x);
    let d = extrudeRound(d2, x, HW_SLIDE, 0.0007);
    d = Math.max(d, (ax - HW_SLIDE + v - (vTop - 0.0024)) * Math.SQRT1_2);                       // 45°-Fasen oben
    if (u > uP0 - 0.002 && u < uP1 + 0.002 && v > AX) {
      d = Math.max(d, -Math.max(uP0 - u, u - uP1, vP - v, -0.004 - x));                            // Fenster oben rechts
      d = Math.max(d, -Math.max(uP0 + 0.001 - u, u - uP1 + 0.0025, AX + 0.006 - v, ax - 0.0098));  // Kanal zum Lager (vorn ≥ 1,5 mm Steg)
    }
    if (ax > HW_SLIDE - 0.003 && inBox(rb, u, v)) d = Math.max(d, -Math.max(rec(u, v), HW_SLIDE - 0.0008 - ax));   // Mulde
    if (u > uD0 - 0.001 && u < uD1 + 0.001 && v > vD - 0.001) d = Math.max(d, -Math.max(uD0 - u, u - uD1, vD - v));   // Schwalbenschwanznut der Kimme
    return d;
  };
  // unten offen (liegt auf dem Rahmen, auch zurückgelaufen nur von unten einsehbar)
  const [u0, u1, , v1] = box2(M(R.SLIDE), 0.002);
  sdfMesh(b, f, [-HW_SLIDE - 0.002, V(R.SLIDE_BOTTOM_Y) + 0.0003, u0], [HW_SLIDE + 0.002, v1, u1], 0.0014, STEELM(b), { uv: adlerSteelUV, uvMap: atlasUVTri, cav: STEEL, fine: 0.66, lite: 1.4, part: 'slide' });
}

// ---------------------------------------------------------------- Lauf (Distanzfeld, Atlas)
function barrelField(b) {
  const bd = field2(M(R.BARREL), [], G2(b, 0.0003));
  const vRT = V(R.RIB.top), vRB = V(R.RIB.base), vSh = V(R.SHOULDER_Y), vBot = V(R.LAUF_BOTTOM_Y);
  const HT = 0.0072, k = (HW_BARREL - HT) / (vRB - vSh), kn = Math.hypot(1, k);
  const ramp = R.RAMP.map(([x, y]) => [U(x), V(y)]);
  const uRamp = (v) => {
    if (v >= ramp[0][1]) return ramp[0][0];
    for (let i = 1; i < ramp.length; i++) if (v >= ramp[i][1]) { const [ua, va] = ramp[i - 1], [ub, vb] = ramp[i]; return ua + (ub - ua) * (v - va) / (vb - va); }
    return ramp[ramp.length - 1][0];
  };
  const pan = field2(M(R.PANEL_L), [], G2(b, 0.0003)), pb = box2(M(R.PANEL_L), 0.002);
  const uSide0 = U(920), uCyl0 = U(R.PORT[0]) - 0.002, uMz = U(R.MUZZLE_X), uRib0 = U(R.RIB.x0);
  const slot0 = U(1085), slot1 = U(2060), pitch = 0.0095;
  const vLow = V(R.LAUF_BOTTOM_Y), uBack = U(R.BARREL[0][0]);
  const f = (x, v, u) => {
    // weit unter/hinter dem Lauf (Rumpf-Netz reicht bis zum Griff): Schranke statt Umrissfeld außerhalb seines Rasters
    if (v < vLow - 0.006) return vLow - v;
    if (u < uBack - 0.006) return uBack - u;
    const d2 = bd(u, v);
    if (d2 > 0.005) return d2;
    const ax = Math.abs(x);
    const rib = Math.max(ax - 0.0062, v - vRT, vRB - 0.0005 - v, uRib0 - u);                                            // Schiene
    const side = Math.max(ax - HW_BARREL, (ax - HW_BARREL + (vBot + 0.0021) - v) * Math.SQRT1_2, v - vSh, uSide0 - u);  // Seiten
    const slope = Math.max(ax - HW_BARREL, (ax + k * (v - vRB) - HT) / kn, v - vRB, vSh - 0.001 - v, (uRamp(v) - u) * 0.55);  // Schrägen
    const cyl = Math.max(Math.hypot(x, v - AX) - 0.0133, uCyl0 - u);                                                    // Lager
    let d = Math.max(Math.min(rib, side, slope, cyl), d2);
    // Schwalbenschwanz-Kerbe am Schienenfuß, Querschlitze der Schiene (nicht unter dem Korn)
    if (v < vRB + 0.0012 && v > vRB - 0.0006 && ax > 0.0046) d = Math.max(d, -Math.max(0.0052 - ax, v - (vRB + 0.0008), vRB - 0.0002 - v));
    if (v > vRB - 0.0005 && u > slot0 - 0.003 && u < slot1 + 0.003) {
      const du = u - (slot0 + Math.round((u - slot0) / pitch) * pitch);
      if (Math.abs(du) < 0.0025) d = Math.max(d, -Math.max(Math.abs(du) - 0.0016, vRT - 0.0015 - v));
    }
    // vertiefte Seitenfläche (Gravurfeld) beidseitig 0,8 mm
    if (ax > HW_BARREL - 0.0025 && inBox(pb, u, v)) d = Math.max(d, -Math.max(pan(u, v), HW_BARREL - 0.0008 - ax));
    // Bohrung 8 mm tief (dunkle Scheibe 3,5 mm hinter der Stirn im Bauplan; der Grund liegt sicher dahinter)
    if (u > uMz - 0.0095 && ax < 0.008 && Math.abs(v - AX) < 0.008) d = Math.max(d, -Math.max(Math.hypot(x, v - AX) - 0.00635, uMz - 0.008 - u));
    return d;
  };
  return f;
}

// ---------------------------------------------------------------- Magazinschacht (unten offen, 13 mm tief sichtbar)
function magWell() {
  const [px, py] = R.MAG_PIVOT, pu = U(px), pv = V(py), s = Math.sin(R.MAG_RAKE), c = Math.cos(R.MAG_RAKE);
  return (x, v, u) => {
    const du = u - pu, dv = v - pv, along = du * s + dv * c, across = du * c - dv * s;
    return Math.max(Math.abs(x) - 0.0099, Math.abs(across) - 0.0236, along - 0.013, -along - 0.01);
  };
}

// ---------------------------------------------------------------- Griff (Wickelgriff, Kunststoff, Atlas)
function gripField(b) {
  const gd = once(b, 'griff2d', () => outlineField(MS(R.PANEL), [], G2(b, 0.0004), 0.0075));
  const vT = V(400), vB = V(1134);
  return (x, v, u) => {
    const d2 = gd(u, v);
    if (d2 > 0.007) return d2;
    return extrudeRound(d2, x, 0.016 + 0.0008 * clamp01((vT - v) / (vT - vB)), 0.0055);   // unten etwas breiter
  };
}
function adlerGrip(b) {
  const g = gripField(b), well = magWell();
  const f = (x, v, u) => Math.max(g(x, v, u), -well(x, v, u));
  const [u0, u1, v0, v1] = box2(M(R.PANEL), 0.002);
  sdfMesh(b, f, [-0.0192, v0, u0], [0.0192, v1, u1], 0.0022, GRIPM(b), { uv: adlerGripUV, uvMap: atlasUVTri, cav: POLY, fine: 0.7, lite: 1.5 });
}

// ---------------------------------------------------------------- Rahmen (Distanzfeld, Atlas)
const sstep = (a, c, t) => { const s = clamp01((t - a) / (c - a)); return s * s * (3 - 2 * s); };
const smax = (a, c, k) => -smin(-a, -c, k);
function frameField(b) {
  const fd = outlineField(MS(R.FRAME), [MS(R.GUARD_OPEN)], G2(b, 0.0004), 0.006);
  const vG = V(R.GUARD_Y), uGr = U(R.GRIP_X1), vRail = V(R.RAIL_LINE_Y), vBody = V(470);
  const uSeam = U(R.FRONT_SEAM_X), [gx, gy, gr] = R.GUIDE_HOLE, gu = U(gx), gv = V(gy), grr = gr / R.PPM;
  const TS = R.TRIGGER_SLOT, ts = [U(TS[0]), U(TS[2]), V(TS[3]), V(TS[1])];
  const grip = gripField(b), gbox = box2(M(R.PANEL), 0.003), well = magWell();
  const uH0 = U(262), uH1 = U(358), vH = V(418);
  const vTop = V(R.FRAME_TOP_Y);
  // Bügelöffnung der Außenwände (25.10., Prüfung: vorher nur der Durchblick – massive Wand bis y 545, Abzug stummelig):
  // dahinter der Mittelsteg ± 5,2 mm mit Abzugsschlitz, zur Wand mit 3 mm ausgerundet, Außenkante leicht gebrochen. Wo das
  // Magazin (± 9,4 mm) im Rahmen steckt (oben hinter dem Abzug), bleibt die Vertiefung flach (Steg ± 10,4 mm).
  const oo = outlineField(M(R.OPEN_OUT), [], G2(b, 0.0004), 0.004), ob = box2(M(R.OPEN_OUT), 0.004);
  const [mpx, mpy] = R.MAG_PIVOT, mpu = U(mpx), mpv = V(mpy), ms = Math.sin(R.MAG_RAKE), mc = Math.cos(R.MAG_RAKE);
  // Sporn: links der Trennkante im Foto (Bogen TANG_LINE) schmal, rechts Rahmenbreite
  const TL = R.TANG_LINE, tangX = (py) => {
    if (py <= TL[0][1]) return TL[0][0];
    for (let i = 1; i < TL.length; i++) if (py <= TL[i][1]) { const [xa, ya] = TL[i - 1], [xb, yb] = TL[i]; return xa + (xb - xa) * (py - ya) / (yb - ya); }
    return TL[TL.length - 1][0];
  };
  const PX = (u) => R.XA + (u - R.UA) * R.PPM, PY = (v) => R.YA - (v - R.VA) * R.PPM;
  const f = (x, v, u) => {
    if (v > vTop + 0.006) return v - vTop;   // über dem Rahmen (Laufbereich): Schranke statt exaktem Umriss außerhalb des Rasters
    const d2 = fd(u, v);
    if (d2 > 0.006) return d2;
    const ax = Math.abs(x);
    // Ein Profil für Rumpf, Griffrahmen und Sporn (vor dem Griff erst ab der Bügeloberkante), Breite und Kantenradius stetig
    // (25.10., Prüfung: harte Wechsel 11,2/12,5/13,5 mm und zwei überlappende Teilstücke ergaben Risslinien am Sporn und eine
    // Stufe vor dem Griff): Rahmen 27 mm (Führungsleiste 26 mm, 0,4-mm-Absatz), Sporn 22,4 mm (Übergang 4,5 mm an der Trennkante – flach genug,
    // dass die Schulter ganz in der Fotoprojektion liegt);
    // Kanten: Rumpf 1,2 mm, Griffrahmen 5 mm, Sporn 4 mm
    const tT = sstep(-0.00225, 0.00225, (PX(u) - tangX(PY(v))) / R.PPM), tG = Math.max(sstep(uGr - 0.003, uGr, u), sstep(vBody - 0.003, vBody, v));
    const hw = 0.0112 + (HW_FRAME - 0.0005 * sstep(vRail - 0.0002, vRail + 0.0002, v) - 0.0112) * tT;
    const rr = 0.004 + (0.005 + (0.0012 - 0.005) * tG - 0.004) * tT;
    let d = extrudeRound(Math.max(d2, Math.min(u - uGr, vG - v)), x, hw, rr);
    d = smin(d, extrudeRound(Math.max(d2, v - vG - 0.002, uGr - 0.003 - u), x, 0.0056, 0.0022), 0.003);                        // Bügel
    if (d > 0.004) return d;
    if (inBox(ob, u, v) && ax > 0.0012) {
      const o = oo(u, v);
      if (o < 0.002) {
        // zwei Ausschnitte statt stetig veränderlicher Stegbreite (sonst Feldsprünge → Netzspitzen): flach überall in der Öffnung,
        // tief erst 1 mm vor der Magazinvorderwand (Absatz vor dem Magazin, ausgerundet)
        const across = (u - mpu) * mc - (v - mpv) * ms;
        const flat = roundMax(o, 0.0104 - ax, 0.002), deep = roundMax(roundMax(o, 0.024 - across, 0.0015), 0.0052 - ax, 0.003);
        d = smax(d, -Math.min(flat, deep), 0.0006);
      }
    }
    // im Wickelgriff verborgen: dort kein Rahmen (spart Dreiecke, keine verdeckten Flächen); 0,7 mm Abstand auch außen, damit
    // am Griffrücken (gleicher Fotoumriss) keine Rahmenhaut mit dem Griff flimmert – vorn bleibt eine feine Fuge zum Griffstück
    if (inBox(gbox, u, v)) d = Math.max(d, -(grip(x, v, u) - 0.0007));
    // Schlitze für Abzug und Hahn, Magazinschacht
    // Abzugsschlitz erst vor der Magazinvorderwand (sonst sähe man durch ihn das Magazin)
    if (u > ts[0] - 0.002 && u < ts[1] + 0.002 && v > ts[2] - 0.002 && v < ts[3] + 0.002) d = Math.max(d, -Math.max(ax - 0.0042, ts[0] - u, u - ts[1], ts[2] - v, v - ts[3], 0.0235 - ((u - mpu) * mc - (v - mpv) * ms)));
    if (u > uH0 - 0.002 && u < uH1 + 0.002 && v > vH - 0.002) d = Math.max(d, -Math.max(ax - 0.0047, uH0 - u, u - uH1, vH - v));
    if (v < V(1080)) d = Math.max(d, -well(x, v, u));
    // Vorderstück: Trennfuge (nur PC) und runde Mulde (Führungsstange)
    if (b.max && Math.abs(u - uSeam) < 0.0012 && ax > HW_FRAME - 0.002) d = Math.max(d, -Math.max(Math.abs(u - uSeam) - 0.0003, HW_FRAME - 0.0005 - ax));
    if (Math.abs(u - gu) < grr + 0.002 && Math.abs(v - gv) < grr + 0.002) d = Math.max(d, -Math.max(Math.hypot(u - gu, v - gv) - grr, HW_FRAME - 0.0012 - ax));
    return d;
  };
  return f;
}

// ---------------------------------------------------------------- Lauf + Rahmen (ein Netz: gleiches Material, fest)
// 25.10.: als EIN Distanzfeld vernetzt – die Auflageflächen zwischen Lauf und Rahmen (≈ 0,005 m², bei 1,6 mm ≈ 4 000 Dreiecke)
// entfallen; die Trennfuge bleibt als feine Rille (0,5 mm) sichtbar wie im Foto.
function adlerBody(b) {
  const fb = barrelField(b), ff = frameField(b), vJ = V(R.LAUF_BOTTOM_Y + 0.5), uJ0 = U(R.SLIDE[R.SLIDE.length - 1][0]) - 0.004;
  const f = (x, v, u) => {
    let d = Math.min(fb(x, v, u), ff(x, v, u));
    if (u > uJ0 && Math.abs(v - vJ) < 0.0012) d = Math.max(d, -Math.max(Math.abs(v - vJ) - 0.00025, Math.abs(x) - 0.03, -(d + 0.0005)));   // Fuge Lauf/Rahmen
    return d;
  };
  const [u0, u1, v0] = box2(M(R.FRAME), 0.002), [, , , v1] = box2(M(R.BARREL), 0.002);
  sdfMesh(b, f, [-0.017, v0, Math.min(u0, U(R.PORT[0]) - 0.004)], [0.017, v1, u1], 0.002, STEELM(b), { uv: adlerBodyUV, uvMap: atlasUVTri, cav: STEEL, fine: 0.62, lite: 1.45 });
}

// ---------------------------------------------------------------- Sicherung (Schlitten, beidseitig)
function adlerSafety(b) {
  // 25.10. (Prüfung): ovale Nabenplatte statt Scheibe, schlanker gewölbter Hebel (dicker, stark gerundet) statt flacher Platte,
  // erhabene blanke Querrippen statt schwarzer Kerben, roter Punkt auf der Hebelspitze
  const o = { part: 'slide' };
  const [sx, sy, sr] = R.SAFETY_SCREW, [dx, dy, dr] = R.SAFETY_DOT, [qx, qy, qr] = R.SAFETY_PIN;
  const plate = M(R.SAFETY_PLATE), lever = M(R.SAFETY_LEVER), x0 = HW_SLIDE - 0.0008;   // Muldengrund
  for (const s of [-1, 1]) {
    b.side('adlerPolish', plate, 0.0013, s * (x0 + 0.00065), { ...o, bevel: 0.00045, bevelSeg: 2 });
    b.side('adlerPolish', lever, 0.0024, s * (x0 + 0.0012), { ...o, bevel: 0.00115, bevelSeg: 4 });
    raisedRibs(b, 'adlerPolish', lever, R.SAFETY_RIBS.map(V), x0 + 0.0024, s, { w: 0.0005, h: 0.0003, inset: 0.0011, part: 'slide' });
    if (!b.lite) b.circle('shellRed', dr / R.PPM, s * (x0 + 0.0024 + 0.00004), V(dy), U(dx), { ry: s > 0 ? Math.PI / 2 : -Math.PI / 2, seg: 12, ...o });
  }
  slotScrew(b, 'adlerPolish', x0 + 0.0012, V(sy), U(sx), sr / R.PPM, 0, { ang: -0.5, ...o });
  pinHead(b, 'adlerPolish', HW_SLIDE - 0.0004, V(qy), U(qx), qr / R.PPM, 0, o);
}

// ---------------------------------------------------------------- Bedienteile am Rahmen
function adlerControls(b) {
  // Schlittenfang links (Leiste auf dem Rahmen, Daumenstück vorn)
  b.side('adlerPolish', M(R.SLIDE_STOP), 0.0014, -(HW_FRAME + 0.0006), { bevel: 0.0004 });
  const [sx, sy, sr] = R.SLIDE_STOP_PAD;
  b.lathe('adlerPolish', [[0, 0], [0, sr / R.PPM], [0.0011, sr / R.PPM], [0.0016, sr / R.PPM * 0.75], [0.0016, 0]], -(HW_FRAME + 0.0012), V(sy), U(sx), { axis: 'x', ry: Math.PI, seg: 20 });
  // Laufriegel rechts: geriffelte Platte in der Nut, Arm zur Inbusachse; links Druckknopf über der Achse
  const [, ly0, , ly1] = R.LEVER_PLATE;
  b.side('adlerPolish', M(rectPts(R.LEVER_PLATE)), 0.0013, HW_FRAME + 0.00045, { bevel: 0.0004 });
  // erhabene Querrippen wie im Foto (25.10.: vorher schwarze Kerben)
  raisedRibs(b, 'adlerPolish', M(rectPts(R.LEVER_PLATE)), [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => V(ly0 + (ly1 - ly0) * t)), HW_FRAME + 0.0011, 1, { inset: 0.0006 });
  b.side('adlerPolish', M(R.LEVER_ARM), 0.0013, HW_FRAME + 0.00045, { bevel: 0.0004 });
  const [px, py, pr] = R.LEVER_PIVOT, [bx, by, br] = R.LEVER_BUTTON_L;
  hexPivot(b, 'adlerPolish', HW_FRAME + 0.001, V(py), U(px), pr / R.PPM, 1);
  hexPivot(b, 'adlerPolish', HW_FRAME - 0.0002, V(py), U(px), pr / R.PPM * 0.85, -1);
  pushButton(b, 'adlerPolish', HW_FRAME, V(by), U(bx), br / R.PPM, -1, { h: 0.0009 });
  // Magazinhalter: rechts Schlitzkopf, links runder Knopf
  const [mx, my, mr] = R.MAG_SCREW;
  slotScrew(b, 'adlerPolish', HW_FRAME - 0.0001, V(my), U(mx), mr / R.PPM * 0.85, 1, { ang: 0.3 });   // Griffrahmen jetzt 27 mm (25.10.)
  pushButton(b, 'adlerPolish', HW_FRAME - 0.0001, V(my), U(mx), mr / R.PPM * 1.15, -1, { h: 0.0016 });
}

// ---------------------------------------------------------------- Magazin (Edelstahl, breiter Boden nach Foto, 7 × .50 AE)
function adlerMag(b) {
  const [px, py] = R.MAG_PIVOT, pu = U(px), pv = V(py), rake = R.MAG_RAKE, s = Math.sin(rake), c = Math.cos(rake);
  b.part('mag', 0, pv, pu);
  const len = 0.097, depth = 0.046, w = 0.0188;
  const at = (l) => [0, pv + c * l, pu + s * l];
  const [, bv, bu] = at(len / 2);
  b.box('stainless', w, len, depth, 0, bv, bu, { part: 'mag', rx: -rake, c: 0.0015 });
  if (b.hi) {
    // Zuführlippen oben (eingebördelt) und drei Sichtlöcher links
    const [, tv, tu] = at(len - 0.002);
    for (const sx of [-1, 1]) b.box('stainless', 0.0025, 0.004, depth * 0.55, sx * (w / 2 - 0.0012), tv, tu + 0.004, { part: 'mag', rx: -rake, c: 0.0006 });
    if (!b.lite) for (let i = 0; i < 3; i++) { const [, hv, hu] = at(0.03 + i * 0.022); b.circle('cavity', 0.0016, -(w / 2 + 0.00005), hv, hu - 0.012, { part: 'mag', ry: -Math.PI / 2, seg: 12 }); }
  }
  // Boden: Platte (Umriss nach Foto) mit erhabenem Mittelfeld und Bohrungen
  if (b.hi) {
    sideUV(b, STEELM(b), MS(R.MAGPLATE), 0.0296, 0, adlerSteelUV, { part: 'mag', bevel: 0.0013 });
    sideUV(b, STEELM(b), M(R.MAG_PAD), 0.0308, 0, adlerSteelUV, { part: 'mag', bevel: 0.0006, bevelSeg: 1 });
    // Bohrungen auf der Fläche, die sie trägt (25.10.: die hintere liegt außerhalb des Mittelfelds auf der Platte ± 14,8 mm)
    const inPad = (x, y) => x >= R.MAG_PAD[0][0] && x <= R.MAG_PAD[1][0] && y >= R.MAG_PAD[0][1];
    for (const [hx, hy, hr] of R.MAG_HOLES) for (const sx of [-1, 1]) b.circle('cavity', hr / R.PPM, sx * ((inPad(hx, hy) ? 0.0154 : 0.0148) + 0.00005), V(hy), U(hx), { part: 'mag', ry: sx > 0 ? Math.PI / 2 : -Math.PI / 2, seg: 14 });
  } else b.side('adlerSteel', simplifyRing(M(R.MAGPLATE), 0.003), 0.0296, 0, { part: 'mag' });
  magRounds(b, { cal: 'p50', fit: depth - 0.004, width: w - 0.003, depth: depth - 0.003, show: 3, path: [at(len - 0.0075), at(0.012)] });
  b.anchor('magGrab', 0, pv - 0.011, pu - 0.004, { part: 'mag', data: { w: 0.0148, d: 0.027 } });
  b.anchor('magWell', 0, pv, pu);
}
