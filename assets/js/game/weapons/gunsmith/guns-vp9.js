// VP-9 Viper nach Referenzfoto (MP5A5, vp9-ref.js) – Nutzer 24.10.2026: „Mach die Waffen viel detaillierter … nimm echte
// Bilder aus dem Internet und mach sie danach … ultra realistischer Detailgrad“. Verfahren wie M-17/P-9: Umrisse aus dem
// freigestellten Foto verfolgt und kalibriert (Visierlinie 340 mm), Bauteile als Distanzfelder mit eigener Breite (geprägtes
// Gehäuse mit Spannhebelrohr, Längssicken, Auswurffenster mit Verschluss dahinter, Schacht; Griffstück mit Bügel und Griff;
// Handschutz mit Fischhaut-Feldern; Kornträger mit runder Haube; Trommeldiopter; Schulterstütze), Kunststoff mit eigenem
// Atlas (vp9-tex.js: Piktogramme des Feuerstoß-Griffstücks, Fischhaut, Griffstruktur, Gummikappe), Gravuren über die
// gemeinsame Schrift-Textur (Fantasie-Beschriftung, keine Herstellerzeichen). HK-Teile aus dem Baukasten hk-parts.js.
// Bewegliche Teile: Verschluss (im Fenster sichtbar), Spannhebel („HK-Schlag“, dreht um die Rohrachse), Wahlhebel
// beidseitig (Sicher/Einzel/Feuerstoß/Dauer), Magazin mit Patronen. Detailstufen: PC hoch/ultra (max), PC niedrig/mittel,
// Handy (lite), Bots (≤ 600 Dreiecke) – Anker in allen Stufen gleich.
import * as R from './vp9-ref.js';
import { vp9UV } from './vp9-tex.js';
import { schrift } from './schrift.js';
import { extrudeRound, smin, simplifyPoly } from './sdf.js';
import { STEEL, POLY, field2, box2, sdRoundRect, roundMax, cutWindow, sdfMesh, inBox } from './sdfkit.js';
import { hkSection, hkDrum, hkHood, hkCockingHandle, hkPin, hkSelector, hkTriLug } from './hk-parts.js';
import { magRounds } from './magfill.js';

const { U, V, M } = R;
const AX = R.AXIS;
// Gehäuse-Querschnitt (Blechprägung): Rumpf 33,6 mm breit, Schulter bei y 103 (Kante unter dem Rohr im Foto), Spannhebelrohr
// Ø 19 mm (oben bündig mit der Fotooberkante y 97); vorn frei bis in den Kornträger, dort Ø 16,6 mm (Oberkante y 99)
const SEC = { hw: 0.0168, vB: V(R.REC_BOTTOM_Y), vS: V(103), rS: 0.0085, rB: 0.0018, tubeV: V(97) - 0.0095, tubeR: 0.0095, k: 0.0025 };
const TR = V(R.TUBE_TOP_Y) - SEC.tubeV;                       // freies Rohr
const ANG = 2.73;                                             // Nut/Spannhebel links, 156° von +x (Rohrachse)
const SIGHT_V = V(R.SIGHT_Y);
const HG_W = 0.0196;                                          // Handschutz halbe Breite
const HOUSE_W = 0.0158;                                       // Griffstück halbe Breite (oben)
const rect = ([x0, y0, x1, y1]) => ({ u0: U(x0), u1: U(x1), v0: V(y1), v1: V(y0), cu: (U(x0) + U(x1)) / 2, cv: (V(y0) + V(y1)) / 2, hu: (x1 - x0) / 2 / R.PPM, hv: (y1 - y0) / 2 / R.PPM });
// Gravuren (Typ, Nummer, Kaliber, Werk) – eine Schrift-Textur, ein Material; Handy ohne Schriftfelder
const { mark } = schrift('vp9');

export function vp9(b) {
  const rk = b.max ? 0.7 : 1;   // PC: knappere Kanten (geprägt/gefräst statt geknetet)
  if (b.hi) {
    // Teure Netze als geteilte Blöcke (Bauteil-Cache): je Stufe einmal, in allen Aufsatz-Varianten wiederverwendet
    b.shared('gehaeuse', () => vp9Receiver(b, rk));
    b.shared('endstueck', () => vp9Cap(b, rk));
    b.shared('griffstueck', () => vp9Housing(b, rk));
    b.shared('handschutz', () => vp9Handguard(b));
    b.shared('korntraeger', () => vp9FrontSight(b, rk));
    b.shared('kimme', () => vp9RearSight(b, rk));
    b.shared('schaft', () => vp9Butt(b));
  } else {
    // Bot-Detailstufe: dieselben Fotoumrisse, stark vereinfacht (≤ 600 Dreiecke)
    const sp = (pts, tol = 0.003) => simplifyPoly(M(pts), tol);
    b.side('vp9Rec', M([[397, 139], [413, 139], [435, 99], [451, 93], [493, 93], [497, 97], [884, 99], [884, 185], [397, 185]]), SEC.hw * 2, 0, {});
    b.side('vp9Rec', sp(R.WELL), 0.0284, 0, {});
    b.side('vp9Furn', sp(R.HOUSING, 0.0025), HOUSE_W * 2, 0, { holes: [sp(R.GUARD_OPEN, 0.003)], keepHoles: true });
    b.box('vp9Furn', HG_W * 2, V(118) - V(193), U(1087) - U(873), 0, (V(118) + V(193)) / 2, (U(873) + U(1087)) / 2, {});
    b.cyl('vp9Rec', TR, TR, U(R.TUBE[1]) - U(884), 0, SEC.tubeV, (U(884) + U(R.TUBE[1])) / 2, { seg: 5 });
    b.side('vp9Steel', sp([[1087, 101], [1105, 99], [1105, 59], [1115, 51], [1127, 53], [1137, 75], [1139, 99], [1147, 115], [1141, 135], [1141, 150], [1131, 183], [1087, 189]], 0.003), 0.021, 0, {});
    b.cyl('vp9Steel', 0.0075, 0.0075, U(1201) - U(1141), 0, AX, (U(1141) + U(1201)) / 2, { seg: 5 });
    b.side('vp9Furn', sp(R.BUTT, 0.004), 0.043, 0, {});
    for (const sx of [-1, 1]) b.box('vp9Steel', 0.0032, V(R.STRUT[1]) - V(R.STRUT[3]), U(R.STRUT[2]) - U(R.STRUT[0]), sx * 0.0167, (V(R.STRUT[1]) + V(R.STRUT[3])) / 2, (U(R.STRUT[0]) + U(R.STRUT[2])) / 2, {});
    b.box('vp9Steel', 0.02, V(65) - V(97), U(573) - U(511), 0, (V(65) + V(97)) / 2, (U(511) + U(573)) / 2, {});
  }
  // ---------------------------------------------------------------- Kleinteile (alle Ego-Stufen)
  if (b.hi) {
    vp9Struts(b);
    vp9Details(b);
  }
  // ---------------------------------------------------------------- Lauf mit Dreifachwarze, Mündung
  if (b.hi) {
    const bu0 = U(R.BARREL[0][0]);
    const bp = R.BARREL.map(([x, r]) => [U(x) - bu0, r]);
    b.lathe('vp9Steel', [[0, 0.0066], ...bp, [bp[bp.length - 1][0], 0.0048]], 0, AX, bu0, { seg: b.seg(28, 6) });
    hkTriLug(b, 'vp9Steel', U(1147), U(1160), AX, 0.0080, 0.0097);
    b.bore(0.0047, 0, AX, U(1201) + 0.0005);
    // Laufstück im Handschutz (durch die Stirnöffnung zu sehen)
    b.cyl('vp9Steel', 0.0072, 0.0072, U(1141) - U(1070), 0, AX, (U(1070) + U(1141)) / 2, { seg: 20 });
  }
  b.anchor('muzzle', 0, AX, U(1201) + 0.002);
  // ---------------------------------------------------------------- Abzug, Magazinhalter
  if (b.hi) {
    b.side('vp9Steel', M(R.TRIGGER), 0.0062, 0, { bevel: 0.0009, bevelSeg: 2 });
    b.side('vp9Steel', M(R.PADDLE), 0.0118, 0, { bevel: 0.0012, bevelSeg: 2 });
  }
  b.anchor('trigger', 0, V(292), U(641));
  // ---------------------------------------------------------------- Wahlhebel (beidseitig, gebaut auf SICHER)
  const [sx, sy] = R.SELECTOR;
  b.part('selector', 0, V(sy), U(sx));
  if (b.hi) hkSelector(b, { v: V(sy), u: U(sx), x: HOUSE_W - 0.0002, mat: 'vp9Steel', dir: Math.PI - 0.28 });
  // ---------------------------------------------------------------- Verschluss im Auswurffenster
  const P = rect(R.PORT);
  b.part('bolt', 0, AX, P.cu);
  if (b.hi) vp9Bolt(b, P);
  b.anchor('ejection', SEC.hw - 0.002, P.cv, P.cu, { rz: 0.5 });
  if (b.hi) b.anchor('boltFace', 0.004, P.v0 + 0.0042, P.u1 - 0.0012, { part: 'bolt' });
  // ---------------------------------------------------------------- Spannhebel links vorn („HK-Schlag“)
  const cu = U(R.CHARGE_X);
  b.part('charge', 0, SEC.tubeV, cu);
  if (b.hi) hkCockingHandle(b, { u: cu, v: SEC.tubeV, tubeR: TR, ang: ANG, reach: 0.0205, mat: 'vp9Steel', knobMat: 'knurl' });
  else b.box('vp9Steel', 0.02, 0.012, 0.012, Math.cos(ANG) * 0.017, SEC.tubeV + Math.sin(ANG) * 0.017, cu, { part: 'charge' });
  b.anchor('chargeGrab', Math.cos(ANG) * 0.025, SEC.tubeV + Math.sin(ANG) * 0.025, cu, { part: 'charge', data: { travel: [0, 0, U(R.CHARGE_X) - U(R.NOTCH_X)], style: 'hkslap' } });
  // ---------------------------------------------------------------- Magazin
  vp9Mag(b);
  // ---------------------------------------------------------------- Hände, Visier, Meta
  // Griff aus dem Foto: Mittellinie 32° geneigt (0,56 rad), durch u = 2,6 mm an der Unterkante des Griffstücks, Tiefe quer
  // 48 mm, Breite ≈ 31 mm; Handfläche 40 mm unter dem Ursprung (wie bisher)
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.56, gw: 0.0155, gd: 0.024, gu: 0.0026, ho: 0.04, tu: 0.022 } });
  b.anchor('magWell', 0, V(253), U(784));
  b.anchor('sight', 0, SIGHT_V, U(R.DRUM[0]), { data: { type: 'iron', eyeRelief: 0.13 } });
  b.anchor('leftHandGrip', 0, V(192), U(990), { data: { style: 'under', w: HG_W, h: (V(118) - V(193)) / 2 } });
  b.meta = { sight: 'iron', axis: AX, kind: 'smg', selector: { semi: 1.17, burst: 1.69, auto: 2.62 } };
}

// ---------------------------------------------------------------- Gehäuse (Distanzfeld)
// Rumpf mit Spannhebelrohr (hkSection), Längssicken beidseitig, Auswurffenster rechts mit Fase und hohlem Inneren (der
// Verschluss läuft darin sichtbar zurück), Punktnieten, Prägebuckel, Querstift-Bohrung, Rastmulden der Klemmmontage, Nut
// für den Spannhebel links mit Rastkerbe hinten, Magazinschacht unten (eigene Breite, offen), freies Rohr bis zum Kornträger.
function vp9Receiver(b, rk) {
  const u0 = U(497), u1 = U(884), uT1 = U(R.TUBE[1]);
  const P = rect(R.PORT), G = rect([480, R.GROOVE[1], R.GROOVE[2], R.GROOVE[3]]);
  const wellD = field2(M(R.WELL), [], 0.0004), wB = box2(M(R.WELL), 0.004);
  const mag = { u0: U(752), u1: U(812), vTop: V(193) };
  const WP = rect([751, 196, 801, 236]);
  const vLip = V(244);
  const rivets = R.RIVETS.map(([x, y]) => [U(x), V(y)]), boss = [U(R.BOSS[0]), V(R.BOSS[1])], fpin = [U(R.FRONT_PIN[0]), V(R.FRONT_PIN[1])];
  const dimples = R.DIMPLES.filter((x) => x < R.TUBE[1]).map((x) => U(x));
  const vSlot = SEC.tubeV + Math.sin(ANG) * SEC.tubeR + 0.0004, uS0 = U(R.SLOT[0]), uS1 = U(R.SLOT[1]), uN = U(R.NOTCH_X);
  const ca = Math.cos(ANG), sa = Math.sin(ANG);
  const f = (x, v, u) => {
    const ax = Math.abs(x);
    let d = u < u1 + 0.003 ? Math.max(hkSection(x, v, SEC), u0 - u, u - u1) : Infinity;
    // Magazinschacht: eigene Breite, unten ausgestellter Einführrand
    if (inBox(wB, u, v)) d = smin(d, extrudeRound(wellD(u, v), x, v < vLip ? 0.0151 : 0.0142, 0.0014 * rk), 0.0022);
    // aufgesetzte Platte am Schacht (Magazinhalter-Führung, im Foto rechts heller abgesetzt), beidseitig 0,7 mm erhaben
    if (Math.abs(u - WP.cu) < WP.hu + 0.003 && Math.abs(v - WP.cv) < WP.hv + 0.003) d = Math.min(d, extrudeRound(sdRoundRect(u - WP.cu, v - WP.cv, WP.hu, WP.hv, 0.0028), x, 0.0149, 0.0006));
    // freies Spannhebelrohr (vorn) – Ende im Kornträger
    if (u > u1 - 0.006) d = Math.min(d, Math.max(Math.hypot(x, v - SEC.tubeV) - TR, u1 - 0.004 - u, u - uT1));
    if (d > 0.006) return d;
    // Längssicke (Führung der Schaftstreben): 1,5 mm tief, Boden gerundet, hinten offen
    if (ax > SEC.hw - 0.004 && u < G.u1 + 0.003 && Math.abs(v - G.cv) < G.hv + 0.003) d = Math.max(d, -roundMax(sdRoundRect(u - G.cu, v - G.cv, G.hu, G.hv, G.hv), SEC.hw - 0.0015 - ax, 0.0006));
    // Auswurffenster rechts (runde Ecken, 0,7 mm Fase außen) und hohles Inneres dahinter (Wand 1,3 mm)
    if (x > 0.003 && Math.abs(u - P.cu) < P.hu + 0.004 && Math.abs(v - P.cv) < P.hv + 0.004) d = cutWindow(d, u - P.cu, v - P.cv, P.hu, P.hv, 0.0036, Math.max(0, x - (SEC.hw - 0.0007)), 0.004 - x);
    if (x > -0.004 && u > P.u0 - 0.014 && u < P.u1 + 0.004 && v > SEC.vB - 0.001) d = Math.max(d, -Math.max(hkSection(x, v, SEC) + 0.0013, P.u0 - 0.012 - u, u - (P.u1 + 0.002), SEC.vB + 0.004 - v, -0.002 - x));
    if (ax > SEC.hw - 0.006) {
      // Punktnieten der Verschlussführung, Prägebuckel vorn (beidseitig)
      for (const [ru, rv] of rivets) if (Math.abs(u - ru) < 0.004 && Math.abs(v - rv) < 0.004) d = Math.min(d, Math.hypot(ax - (SEC.hw - 0.0019), v - rv, u - ru) - 0.0025);
      if (Math.abs(u - boss[0]) < 0.007 && Math.abs(v - boss[1]) < 0.007) d = smin(d, Math.hypot(ax - (SEC.hw - 0.0052), v - boss[1], u - boss[0]) - 0.006, 0.0006);
    }
    // Querbohrung vorn (Haltestift des Handschutzes)
    if (Math.abs(u - fpin[0]) < 0.005 && Math.abs(v - fpin[1]) < 0.005) d = Math.max(d, -(Math.hypot(u - fpin[0], v - fpin[1]) - 0.003));
    // Rastmulden der Klemmmontage oben (nur PC)
    if (b.max && v > SEC.tubeV + 0.004) for (const du of dimples) if (Math.abs(u - du) < 0.004) d = Math.max(d, -(Math.hypot(ax - 0.0062, v - (SEC.tubeV + 0.0086), u - du) - 0.0021));
    // Spannhebel-Nut links: im Gehäuse als Rille in der Schulter (mit Rastkerbe nach oben), am freien Rohr durch die Wand
    if (x < 0 && u > uS0 - 0.004 && u < uS1 + 0.004) {
      if (u < u1 + 0.002 && x < -0.0085) {
        const shell = Math.max(-(hkSection(x, v, SEC) + 0.0024), x + 0.0095);
        d = Math.max(d, -Math.max(Math.abs(v - vSlot) - 0.0017, shell, uS0 - u));
        d = Math.max(d, -Math.max(Math.abs(u - uN) - 0.0019, vSlot - v, v - vSlot - 0.0034, shell));   // Rastkerbe
      }
      const along = x * ca + (v - SEC.tubeV) * sa, perp = Math.abs(x * sa - (v - SEC.tubeV) * ca);
      if (u > u1 - 0.002) {
        d = Math.max(d, -Math.max(perp - 0.0017, 0.003 - along, u1 - u, u - uS1));
        d = Math.max(d, -Math.max(Math.hypot(x, v - SEC.tubeV) - (TR - 0.0016), u1 + 0.002 - u, u - uS1 - 0.002));   // Rohr innen hohl
      }
    }
    // Magazinschacht offen (Magazin steckt sichtbar darin)
    d = Math.max(d, -Math.max(ax - 0.0116, mag.u0 - u, u - mag.u1, v - mag.vTop));
    return d;
  };
  sdfMesh(b, f, [-0.0195, V(258) - 0.002, u0 - 0.002], [0.0195, V(96), uT1 + 0.002], 0.0021, 'vp9Rec', { cav: STEEL, fine: 0.6, lite: 1.5 });
}

// Gehäuse-Endstück mit Schaftaufnahme (etwas breiter als das Gehäuse), seitliche Vertiefung, Bohrung des Schaftstifts
function vp9Cap(b, rk) {
  const capD = field2(M(R.CAP), [], 0.0004), W = rect([441, 104, 483, 136]), hw = 0.0177;
  const f = (x, v, u) => {
    const d2 = capD(u, v);
    if (d2 > 0.006) return d2;
    const ax = Math.abs(x);
    let d = extrudeRound(d2, x, hw, 0.003 * rk);
    if (ax > hw - 0.003) d = Math.max(d, -roundMax(sdRoundRect(u - W.cu, v - W.cv, W.hu, W.hv, 0.0022), hw - 0.0006 - ax, 0.0004));
    return d;
  };
  sdfMesh(b, f, [-hw - 0.002, V(186), U(396)], [hw + 0.002, V(92), U(498)], 0.0026, 'vp9Rec', { cav: STEEL, fine: 0.6, lite: 1.5 });
}

// ---------------------------------------------------------------- Griffstück (Kunststoff, Atlas)
// Gehäuse oben 31,6 mm breit, Bügel 12 mm, Griff 29–31,5 mm mit kräftiger Rundung; Navy-Feld um die Piktogramme 0,4 mm
// vertieft, Schlitz für den Abzug unten im Gehäuse; Bügelöffnung durch.
function vp9Housing(b, rk) {
  const hD = field2(M(R.HOUSING), [M(R.GUARD_OPEN)], 0.0004);
  const vG = V(R.GUARD_Y), uGr = U(R.GRIP_X1), vA = V(300), vB2 = V(400);
  const N = rect([505, 189, 697, 251]), T = { u0: U(612), u1: U(664) };
  const hwGrip = (v) => 0.0146 + 0.0012 * Math.min(1, Math.max(0, (vA - v) / (vA - vB2)));
  const f = (x, v, u) => {
    const d2 = hD(u, v);
    if (d2 > 0.006) return d2;
    const ax = Math.abs(x);
    let d = extrudeRound(Math.max(d2, vG - v), x, HOUSE_W, 0.0022 * rk);                                     // Gehäuse
    d = smin(d, extrudeRound(Math.max(d2, v - vG - 0.002, uGr - u), x, 0.006, 0.0024), 0.003);              // Bügel
    d = smin(d, extrudeRound(Math.max(d2, v - vG - 0.002, u - uGr), x, hwGrip(v), 0.0068), 0.0045);         // Griff
    // Navy-Feld (vertieft) um Wahlhebel und Piktogramme
    if (ax > HOUSE_W - 0.002 && Math.abs(u - N.cu) < N.hu + 0.002 && Math.abs(v - N.cv) < N.hv + 0.002) d = Math.max(d, -Math.max(sdRoundRect(u - N.cu, v - N.cv, N.hu, N.hv, 0.003), HOUSE_W - 0.0004 - ax));
    // Schlitz für den Abzug in der Unterseite
    if (u > T.u0 - 0.002 && u < T.u1 + 0.002 && v < vG + 0.006) d = Math.max(d, -Math.max(ax - 0.0039, T.u0 - u, u - T.u1, v - (vG + 0.004)));
    return d;
  };
  sdfMesh(b, f, [-0.0185, V(430), U(450)], [0.0185, V(184), U(754)], 0.0026, 'vp9Furn', { uv: vp9UV, cav: POLY, fine: 0.6, lite: 1.5 });
}

// ---------------------------------------------------------------- Handschutz (Kunststoff, Atlas)
// Schlank: Querschnitt gerundetes Rechteck 39 mm breit, oben Rinne um das Spannhebelrohr, unten leicht nach vorn steigend;
// beidseitig zwei Fischhaut-Felder (0,6 mm vertieft, Muster im Atlas), Stirn mit Öffnung um den Lauf.
function vp9Handguard(b) {
  const uR = U(873), uF = U(1087), vT = V(118), vB0 = V(193), vB1 = V(190);
  const panels = R.HG_PANELS.map(rect);
  const sec = (x, v, u) => {
    const vB = vB0 + (vB1 - vB0) * Math.min(1, Math.max(0, (u - uR) / (uF - uR))), cv = (vT + vB) / 2, hv = (vT - vB) / 2;
    return Math.max(sdRoundRect(x, v - cv, HG_W, hv, v > cv ? 0.0045 : 0.0095), -(Math.hypot(x, v - SEC.tubeV) - (TR + 0.0008)));
  };
  const f = (x, v, u) => {
    const ax = Math.abs(x);
    const d0 = roundMax(sec(x, v, u), Math.max(uR - u, u - uF), 0.0028);
    let d = d0;
    if (d > 0.004) return d;
    for (const p of panels) if (ax > HG_W - 0.003 && Math.abs(v - p.cv) < p.hv + 0.002 && Math.abs(u - p.cu) < p.hu + 0.002) d = Math.max(d, -Math.max(sdRoundRect(u - p.cu, v - p.cv, p.hu, p.hv, 0.0013), -(d0 + 0.0006)));
    if (u > uF - 0.008) d = Math.max(d, -Math.max(Math.hypot(x, v - AX) - 0.0098, uF - 0.006 - u));   // Laufdurchtritt
    return d;
  };
  sdfMesh(b, f, [-HG_W - 0.002, vB1 - 0.006, uR - 0.002], [HG_W + 0.002, vT + 0.002, uF + 0.002], 0.0026, 'vp9Furn', { uv: vp9UV, cav: POLY, fine: 0.6, lite: 1.5 });
}

// ---------------------------------------------------------------- Kornträger (Stahl) mit Haube und Pfosten
const FSB_BASE = [[1087, 101], [1095, 101], [1097, 103], [1103, 103], [1107, 99], [1139, 99], [1145, 107], [1145, 113], [1147, 115], [1147, 125], [1141, 135], [1141, 150], [1137, 181], [1133, 181], [1131, 183], [1115, 183], [1111, 187], [1109, 189], [1087, 189]];
function vp9FrontSight(b, rk) {
  const bD = field2(M(FSB_BASE), [], 0.0003), hw = 0.0106;
  const f = (x, v, u) => {
    const d2 = bD(u, v);
    if (d2 > 0.005) return d2;
    let d = extrudeRound(d2, x, hw, 0.0018 * rk);
    // Rohr und Lauf treten als Bund aus der Stirn (leicht abgesetzt)
    return d;
  };
  sdfMesh(b, f, [-hw - 0.002, V(190), U(1085)], [hw + 0.002, V(98), U(1149)], 0.0019, 'vp9Steel', { cav: STEEL, fine: 0.6, lite: 1.5 });
  const [hx, , hr] = R.HOOD;
  hkHood(b, { u: U(hx), v: SIGHT_V, r: hr / R.PPM, ri: 0.0074, rw: 0.0057, vNeck: V(101), mat: 'vp9Steel', id: 'kornhaube' });
}

// ---------------------------------------------------------------- Trommeldiopter auf dem Gehäuse
const RS_BASE = [[511, 105], [513, 83], [515, 77], [519, 69], [527, 65], [541, 65], [546, 74], [566, 82], [568, 89], [575, 97], [575, 105]];
function vp9RearSight(b, rk) {
  const bD = field2(M(RS_BASE), [], 0.0003), hw = 0.0102, Wn = rect([519, 74, 536, 87]), uD = U(R.DRUM[0]) - 0.004;
  const f = (x, v, u) => {
    const d2 = bD(u, v);
    if (d2 > 0.005) return d2;
    let d = extrudeRound(d2, x, hw, 0.0014 * rk);
    d = Math.max(d, -sdRoundRect(u - Wn.cu, v - Wn.cv, Wn.hu, Wn.hv, 0.0018));   // Fenster quer durch den Sockel
    // Schutzbügel hinter der Trommel als Bogen: Durchblick längs auf die Lochblende (wie im Zielbild „Visierlinie“)
    if (u < uD) d = Math.max(d, -Math.max(Math.hypot(x, v - SIGHT_V) - 0.0058, u - uD));
    return d;
  };
  sdfMesh(b, f, [-hw - 0.002, V(106), U(509)], [hw + 0.002, V(63), U(577)], 0.0015, 'vp9Steel', { cav: STEEL, fine: 0.6, lite: 1.5 });
  // Trommel um die Querachse auf der Visierlinie (Foto: Ø ≈ 13 mm, Oberkante y 57), Blende Ø 7,8 mm (Spiel: größer als am
  // Original ≈ 2–3,5 mm, damit Haube und Korn im Anschlag ganz in der Lochblende stehen – wie im Zielbild „Visierlinie“), Seitenschraube rechts
  hkDrum(b, { u: U(R.DRUM[0]), v: SIGHT_V, r: 0.0065, len: 0.016, apR: 0.0039, mat: 'vp9Steel', id: 'trommel' });
  hkPinHead(b, hw, V(90), U(533));
}

// ---------------------------------------------------------------- Schulterstütze (Gummikappe, Atlas)
function vp9Butt(b) {
  const sD = field2(M(R.BUTT), [], 0.0005), hw = 0.0205;
  const f = (x, v, u) => {
    const d2 = sD(u, v);
    if (d2 > 0.007) return d2;
    return extrudeRound(d2, x, hw, 0.0055);
  };
  sdfMesh(b, f, [-hw - 0.002, V(320), U(54)], [hw + 0.002, V(119), U(136)], 0.0034, 'vp9Furn', { uv: vp9UV, cav: POLY, fine: 0.6, lite: 1.5 });
}

// Streben (Flachstahl beidseitig, gerundete Kanten), Nieten an der Kappe, Schaftverriegelung unter dem Endstück
function vp9Struts(b) {
  const [x0, y0, x1, y1] = R.STRUT, su = (U(x0) + U(x1)) / 2, sl = U(x1) - U(x0) + 0.006, sv = (V(y0) + V(y1)) / 2, sh = V(y0) - V(y1);
  for (const s of [-1, 1]) {
    b.box('vp9Steel', 0.0032, sh, sl, s * 0.0167, sv, su, { c: 0.001 });
    if (b.max) for (const y of [y0 + 8, y1 - 8]) hkPinHead(b, s * 0.0216, V(y), U(118));
  }
  b.side('vp9Steel', M(R.LATCH), 0.0156, 0, { bevel: 0.0012, bevelSeg: 2 });
  if (b.hi) for (let i = 0; i < 4; i++) b.box('cavity', 0.0158, 0.0005, 0.0007, 0, V(214 - i * 3.2) - 0.0002, U(414 + i * 1.5), { c: 0 });   // Griffrillen
}
const hkPinHead = (b, x, v, u) => b.lathe('vp9Steel', [[0, 0], [0, 0.0019], [0.0005, 0.0017], [0.0007, 0]], x, v, u, { axis: 'x', ry: x > 0 ? 0 : Math.PI, seg: 12 });

// Bolzen, Knopf, Kappe des Spannhebelrohrs, Riemenöse, Gravuren
function vp9Details(b) {
  // Haltebolzen Griffstück (hinten/vorn) und Schaftstift: Kopf links mit Rastrille, rechts flach
  const [[px0, py0, pr0], [px1, py1, pr1]] = R.PINS;
  hkPin(b, 'vp9Steel', HOUSE_W + 0.0024, V(py0), U(px0), pr0 / R.PPM, -1);
  hkPin(b, 'vp9Steel', HOUSE_W, V(py1), U(px1), pr1 / R.PPM, -1);
  hkPin(b, 'vp9Steel', 0.0177, V(R.STOCK_PIN[1]), U(R.STOCK_PIN[0]), R.STOCK_PIN[2] / R.PPM, -1);
  // Querstift vorn im Gehäuse (in der Bohrung, 1 mm vertieft)
  b.cyl('vp9Steel', 0.0026, 0.0026, SEC.hw * 2 - 0.002, 0, V(R.FRONT_PIN[1]), U(R.FRONT_PIN[0]), { axis: 'x', seg: 16 });
  // Magazinknopf rechts (Druckknopf mit Ring)
  const [mx, my, mr] = R.MAG_BUTTON;
  b.cyl('vp9Steel', mr / R.PPM, mr / R.PPM, 0.0026, HOUSE_W + 0.0011, V(my), U(mx), { axis: 'x', seg: 20 });
  b.torus('vp9Steel', mr / R.PPM + 0.0009, 0.0005, HOUSE_W + 0.0004, V(my), U(mx), { ry: Math.PI / 2, seg: 6, tseg: 22 });
  // Kappe des Spannhebelrohrs vorn am Kornträger (gerändelt), Querstift rechts, Riemenöse links
  b.lathe('knurl', [[0, 0], [0, 0.0072], [0.0042, 0.0072], [0.005, 0.0062], [0.005, 0]], 0, SEC.tubeV, U(1141), { seg: 24 });
  hkPinHead(b, 0.0108, V(138), U(1100));
  b.torus('vp9Steel', 0.0058, 0.0011, -0.0118, V(152), U(1112), { ry: Math.PI / 2, seg: 8, tseg: 24 });
  b.cyl('vp9Steel', 0.0019, 0.0019, 0.004, -0.0112, V(143), U(1112), { axis: 'x', seg: 12 });
  // Gravuren links (eigene Bezeichnung statt Herstellerzeichen): Typ, Nummer, Werk, Kaliber am Schacht
  const lx = -(SEC.hw + 0.0001);
  mark(b, 'VP-9 VIPER', lx, V(174), U(602), 0.0031, { weight: '700' });
  mark(b, 'NP 59 3017', lx, V(174), U(694), 0.0026);
  mark(b, 'NULLPUNKT WAFFENWERK', lx, V(132), U(612), 0.0018);
  mark(b, 'KAL. 9 MM x 19', lx, V(176), U(792), 0.0026);
  if (b.max) mark(b, 'S·E·3·D', HOUSE_W + 0.0001, V(256), U(560), 0.0016);
}

// ---------------------------------------------------------------- Verschluss (im Fenster sichtbar)
// Verschlussträger (geölt) mit Fräsung, davor Verschlusskopf auf der Laufachse mit den zwei Verriegelungsrollen und dem
// Auszieher rechts; Stirn am Fensterende (Patronenlager). Hub beim Schuss: handling boltTravel.
function vp9Bolt(b, P) {
  const o = { part: 'bolt' }, uF = P.u1 - 0.0012, cv = 0.0778;
  b.cyl('vp9Bcg', 0.0104, 0.0104, uF - 0.006 - (P.u0 - 0.014), 0, cv, (uF - 0.006 + P.u0 - 0.014) / 2, { ...o, seg: 28 });
  b.cyl('vp9Bcg', 0.0076, 0.0076, 0.016, 0, AX + 0.002, uF - 0.008, { ...o, seg: 24 });
  b.box('vp9Bcg', 0.0062, 0.016, 0.012, 0, (cv + AX) / 2, uF - 0.006, { ...o, c: 0.001 });               // Steuerstück
  b.box('vp9Bcg', 0.0018, 0.004, 0.017, 0.0069, AX + 0.004, uF - 0.0085, { ...o, c: 0.0004 });          // Auszieher
  if (b.max) {
    for (const s of [-1, 1]) b.cyl('vp9Bcg', 0.0025, 0.0025, 0.0062, s * 0.0068, AX + 0.002, uF - 0.0095, { ...o, axis: 'v', seg: 14 });   // Rollen
    b.circle('cavity', 0.0012, 0, AX + 0.002, uF + 0.0001, { ...o, seg: 12 });                          // Schlagbolzenloch
  }
}

// ---------------------------------------------------------------- Magazin (gebogen, 30 Schuss 9 × 19)
const lerpEdge = (pts, y) => { for (let i = 1; i < pts.length; i++) { const [xa, ya] = pts[i - 1], [xb, yb] = pts[i]; if ((y - ya) * (y - yb) <= 0 && ya !== yb) return xa + (xb - xa) * (y - ya) / (yb - ya); } return (Math.abs(pts[0][1] - y) < Math.abs(pts[pts.length - 1][1] - y) ? pts[0] : pts[pts.length - 1])[0]; };
function vp9Mag(b) {
  const pu = U(784), pv = V(253);
  b.part('mag', 0, pv, pu);
  const body = [[753, 193], [811, 193], ...R.MAG.slice(1)];
  b.side('vp9Mag', b.hi ? M(body) : simplifyPoly(M(body), 0.003), 0.0224, 0, { part: 'mag', bevel: b.hi ? 0.0012 : 0, bevelSeg: b.max ? 2 : 1 });
  if (b.hi) {
    // zwei erhabene Längssicken dem Bogen folgend (vorn und hinten), Bodenplatte etwas breiter
    const i0 = R.MAG.findIndex(([x, y]) => x === 897 && y === 481), front = R.MAG.slice(1, i0 + 1), rear = R.MAG.slice(i0 + 1).reverse();
    for (const t of [0.2, 0.74]) {
      const ys = [272, 300, 340, 380, 420, 455, 474];
      const line = ys.map((y) => [lerpEdge(rear, y) + t * (lerpEdge(front, y) - lerpEdge(rear, y)), y]);
      const band = [...line.map(([x, y]) => [x - 1.6, y]), ...line.slice().reverse().map(([x, y]) => [x + 1.6, y])];
      b.side('vp9Mag', M(band), 0.0232, 0, { part: 'mag', bevel: 0.0004 });
    }
    const bottom = R.MAG.slice(i0, i0 + 11), up = (p) => [p[0] - 0.342 * 9, p[1] - 0.94 * 9];
    b.side('vp9Mag', M([...bottom, ...bottom.slice().reverse().map(up)]), 0.0238, 0, { part: 'mag', bevel: 0.0008 });
    if (b.max) mark(b, '9 MM x 19 · 30 SCHUSS', -0.0113, V(380), U(817), 0.0023, { part: 'mag', vertical: true, rx: 0.35 });
  }
  const path = [[784, 195], [786, 253], [787, 275], [802, 330], [825, 400], [848, 450], [862, 478]].map(([x, y]) => [0, V(y), U(x)]);
  magRounds(b, { cal: 'p9', width: 0.0196, depth: 0.03, show: 3, path });
  b.anchor('magGrab', 0, V(380), U(812), { part: 'mag', data: { w: 0.0116, d: 0.018 } });
}
