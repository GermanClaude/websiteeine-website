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
import { vp9UV, SEL_PTR } from './vp9-tex.js';
import { schrift } from './schrift.js';
import { extrudeRound, smin, simplifyRing } from './sdf.js';
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
// Raster der vorgerechneten 2D-Umrissfelder je Stufe (25.10.): fein nur am PC hoch (Netz 1,1–1,6 mm), sonst gröber – die
// Felder werden bilinear abgefragt, ihr Aufbau war ≈ ⅙ der Bauzeit in Standard/Handy
const G2 = (b, s) => (b.max ? s : b.lite ? s * 3 : s * 2.2);
// Kunststoff-Atlas je Stufe: PC niedrig/mittel mit eigenem, kleinerem Atlas (vp9FurnS); Handy über liteKey (vp9Furn@lite)
const FURN = (b) => (b.max || b.lite ? 'vp9Furn' : 'vp9FurnS');
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
    // simplifyRing (25.10. Zusammenführung Etappe 1): simplifyPoly ließ den letzten Ringpunkt fallen – Schacht 29 mm,
    // Kornträger 25 mm, Griffstück 15 mm, Magazin 9 mm vom Fotoumriss weg (Befund aus der Adler-Prüfung)
    const sp = (pts, tol = 0.003) => simplifyRing(M(pts), tol);
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
    // 25.10.: Lauf beginnt 2 px im Kornträger (vorher 3–3,6 mm Luft zwischen Stirn und Lauf), Bund aus dem Fotoumriss R.FSB
    // (x 1141–1149, y 147–175), dahinter Dreifachwarze
    const bu0 = U(R.BARREL[0][0]);
    const bp = R.BARREL.map(([x, r]) => [U(x) - bu0, r]);
    b.lathe('vp9Steel', [[0, 0.0066], ...bp, [bp[bp.length - 1][0], 0.0048]], 0, AX, bu0, { seg: b.seg(28, 6) });
    hkTriLug(b, 'vp9Steel', U(1149), U(1161), AX, 0.0080, 0.0097);
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
  // Achse und Zeigerwinkel aus dem PASKAL-Foto (vp9-tex.js SEL_PTR: Richtung der Zuleitungen der Piktogramme)
  const [sx, sy] = R.SELECTOR;
  b.part('selector', 0, V(sy), U(sx));
  if (b.hi) hkSelector(b, { v: V(sy), u: U(sx), x: HOUSE_W - 0.0002, mat: 'vp9Steel', ptr: SEL_PTR.safe });
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
  b.anchor('sight', 0, SIGHT_V, U(R.DRUM[0]), { data: { type: 'iron', eyeRelief: 0.14 } });
  b.anchor('leftHandGrip', 0, V(192), U(990), { data: { style: 'under', w: HG_W, h: (V(118) - V(193)) / 2 } });
  b.meta = { sight: 'iron', axis: AX, kind: 'smg', selector: { semi: SEL_PTR.semi - SEL_PTR.safe, burst: SEL_PTR.burst - SEL_PTR.safe, auto: SEL_PTR.auto - SEL_PTR.safe } };
}

// ---------------------------------------------------------------- Gehäuse (Distanzfeld)
// Rumpf mit Spannhebelrohr (hkSection), Prägungen wie im Foto: obere Rinne unter dem Rohr mit Prägekante darunter, lange
// Längssicke (Strebenführung), Lasche mit Punktnieten, aufgeprägter Hülsenabweiser vor dem Fenster, Prägebuckel, Mulde;
// Auswurffenster rechts (Enden gerundet, Fase außen) mit Tasche dahinter (Verschluss sichtbar), Querstift-Bohrung, Rastmulden
// der Klemmmontage, Nut für den Spannhebel links mit Rastkerbe hinten, Magazinschacht unten (eigene Breite, offen) mit Lasche
// rechts und Halteplatte links, freies Rohr bis zum Kornträger.
// 25.10. (Prüfung): Die Tasche hinter dem Fenster reicht nur über die Fensterhöhe (oben bis zur Fensterkante, unten bis knapp
// über die Längssicke) – vorher schnitt die 1,5 mm tiefe Sicke durch die 1,3-mm-Wand des Hohlraums (zweites Loch unter dem
// Fenster, am Handy mit dem Fenster verschmolzen), und oben blieben dünne Grate in der Rohrschulter (Sägezahn).
function vp9Receiver(b, rk) {
  const u0 = U(497), u1 = U(884), uT1 = U(R.TUBE[1]);
  const P = rect(R.PORT), G = rect([480, R.GROOVE[1], R.GROOVE[2], R.GROOVE[3]]), FL = rect(R.FLUTE), DF = rect(R.DEFLECTOR);
  const pR = R.PORT_R / R.PPM, vSeam = V(R.SEAM_Y), uSeam1 = P.u0 - 0.0015;
  const wellD = field2(M(R.WELL), [], G2(b, 0.0004)), wB = box2(M(R.WELL), 0.004);
  const mag = { u0: U(752), u1: U(812), vTop: V(193) };
  const wpR = field2(M(R.WELL_PLATE_R), [], G2(b, 0.0004)), wpRB = box2(M(R.WELL_PLATE_R), 0.003);
  const wpL = field2(M(R.WELL_PLATE_L), [], G2(b, 0.0004)), wpLB = box2(M(R.WELL_PLATE_L), 0.003);
  const rp = field2(M(R.RIVET_PLATE), [], G2(b, 0.0003)), rpB = box2(M(R.RIVET_PLATE), 0.003);
  const vLip = V(244);
  const rivets = R.RIVETS.map(([x, y]) => [U(x), V(y)]), boss = [U(R.BOSS[0]), V(R.BOSS[1])], fpin = [U(R.FRONT_PIN[0]), V(R.FRONT_PIN[1])];
  const dim = [U(R.DIMPLE[0]), V(R.DIMPLE[1]), R.DIMPLE[2] / R.PPM];
  const dimples = R.DIMPLES.filter((x) => x < R.TUBE[1]).map((x) => U(x));
  const vSlot = SEC.tubeV + Math.sin(ANG) * SEC.tubeR + 0.0004, uS0 = U(R.SLOT[0]), uS1 = U(R.SLOT[1]), uN = U(R.NOTCH_X);
  const ca = Math.cos(ANG), sa = Math.sin(ANG);
  // Tasche hinter dem Fenster: Wand ≥ eine Rasterzelle (sonst Löcher), am PC 3 mm nach hinten verlängert (Tiefe beim Schrägblick)
  const step = b.max ? 0.0021 * 0.55 : b.lite ? 0.0021 * 1.5 : 0.0021;
  const cav = { u0: P.u0 - (b.max ? 0.003 : 0), u1: P.u1 + 0.0008, v0: G.v1 + 0.001, v1: P.v1, wall: Math.max(0.0014, step * 1.15) };
  const f = (x, v, u) => {
    const ax = Math.abs(x);
    const sec = hkSection(x, v, SEC);
    let d = u < u1 + 0.003 ? Math.max(sec, u0 - u, u - u1) : Infinity;
    // Magazinschacht: eigene Breite, unten ausgestellter Einführrand
    if (inBox(wB, u, v)) {
      d = smin(d, extrudeRound(wellD(u, v), x, v < vLip ? 0.0151 : 0.0142, 0.0014 * rk), 0.0022);
      // Lasche rechts (Trapez, 0,7 mm erhaben) und Halteplatte links (0,8 mm)
      if (x > 0.004 && inBox(wpRB, u, v)) d = Math.min(d, Math.max(wpR(u, v), x - 0.0149, 0.004 - x));
      if (x < -0.004 && inBox(wpLB, u, v)) d = Math.min(d, Math.max(wpL(u, v), -x - 0.0150, x + 0.004));
    }
    // freies Spannhebelrohr (vorn) – Ende im Kornträger
    if (u > u1 - 0.006) d = Math.min(d, Math.max(Math.hypot(x, v - SEC.tubeV) - TR, u1 - 0.004 - u, u - uT1));
    if (d > 0.006) return d;
    if (u < u1 + 0.001) {
      // Hülsenabweiser rechts (aufgeprägt 0,9 mm, folgt der Rohrschulter) und Lasche unter den Nieten (0,5 mm)
      if (x > 0.004 && Math.abs(u - DF.cu) < DF.hu + 0.002 && Math.abs(v - DF.cv) < DF.hv + 0.002) d = smin(d, roundMax(sdRoundRect(u - DF.cu, v - DF.cv, DF.hu, DF.hv, 0.0022), sec - 0.0009, 0.0005), 0.0005);
      if (inBox(rpB, u, v) && ax > SEC.hw - 0.004) d = smin(d, Math.max(rp(u, v) + 0.0005, sec - 0.0005), 0.0011);   // weich (feiner als das Raster)
      // obere Prägerinne (1 mm tief, folgt der gerundeten Schulter) und Prägekante darunter (nur PC fein genug)
      if (ax > SEC.hw - 0.006 && Math.abs(u - FL.cu) < FL.hu + 0.002 && Math.abs(v - FL.cv) < FL.hv + 0.002) d = Math.max(d, -roundMax(sdRoundRect(u - FL.cu, v - FL.cv, FL.hu, FL.hv, FL.hv * 0.9), -(sec + 0.001), 0.0005));
      if (b.max && ax > SEC.hw - 0.002 && Math.abs(v - vSeam) < 0.0012 && u > u0 + 0.002 && u < uSeam1) d = Math.max(d, -Math.max(Math.abs(v - vSeam) - 0.0005, -(sec + 0.00045), u0 + 0.004 - u, u - uSeam1));
    }
    // Längssicke (Führung der Schaftstreben): 1,5 mm tief, Boden gerundet, hinten offen
    if (ax > SEC.hw - 0.004 && u < G.u1 + 0.003 && Math.abs(v - G.cv) < G.hv + 0.003) d = Math.max(d, -roundMax(sdRoundRect(u - G.cu, v - G.cv, G.hu, G.hv, G.hv), SEC.hw - 0.0015 - ax, 0.0006));
    // Auswurffenster rechts (Enden gerundet, Fase 0,7 mm entlang der gewölbten Außenfläche) und Tasche dahinter
    if (x > 0.003 && Math.abs(u - P.cu) < P.hu + 0.004 && Math.abs(v - P.cv) < P.hv + 0.004) {
      d = cutWindow(d, u - P.cu, v - P.cv, P.hu, P.hv, pR, Math.max(0, sec + 0.0007), 0.004 - x);
      if (u > cav.u0 - 0.001 && u < cav.u1 + 0.001 && v > cav.v0 - 0.001 && v < cav.v1 + 0.001) d = Math.max(d, -Math.max(sec + cav.wall, cav.u0 - u, u - cav.u1, cav.v0 - v, v - cav.v1, 0.0035 - x));
    }
    if (ax > SEC.hw - 0.006) {
      // Punktnieten der Verschlussführung (auf der Lasche), Prägebuckel vorn (beidseitig)
      for (const [ru, rv] of rivets) if (Math.abs(u - ru) < 0.004 && Math.abs(v - rv) < 0.004) d = Math.min(d, Math.hypot(ax - (SEC.hw - 0.0005), v - rv, u - ru) - 0.0021);   // Kopf Ø ≈ 3,7 mm, 1,1 mm über der Lasche
      if (Math.abs(u - boss[0]) < 0.007 && Math.abs(v - boss[1]) < 0.007) d = smin(d, Math.hypot(ax - (SEC.hw - 0.0052), v - boss[1], u - boss[0]) - 0.006, 0.0006);
      // kleine Prägemulde vorn oben (rechts)
      if (x > 0 && Math.abs(u - dim[0]) < 0.004 && Math.abs(v - dim[1]) < 0.004) d = Math.max(d, -(Math.hypot(x - (SEC.hw + dim[2] * 1.4), v - dim[1], u - dim[0]) - dim[2] * 1.75));
    }
    // Querbohrung vorn (Haltestift des Handschutzes)
    if (Math.abs(u - fpin[0]) < 0.005 && Math.abs(v - fpin[1]) < 0.005) d = Math.max(d, -(Math.hypot(u - fpin[0], v - fpin[1]) - 0.003));
    // Rastmulden der Klemmmontage oben (nur PC)
    if (b.max && v > SEC.tubeV + 0.004) for (const du of dimples) if (Math.abs(u - du) < 0.004) d = Math.max(d, -(Math.hypot(ax - 0.0062, v - (SEC.tubeV + 0.0086), u - du) - 0.0021));
    // Spannhebel-Nut links: im Gehäuse als Rille in der Schulter (mit Rastkerbe nach oben), am freien Rohr durch die Wand
    if (x < 0 && u > uS0 - 0.004 && u < uS1 + 0.004) {
      if (u < u1 + 0.002 && x < -0.0085) {
        const shell = Math.max(-(sec + 0.0024), x + 0.0095);
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
  // PC hoch etwas feiner (1,16 mm; Prägerinne, Kante und Nieten sind das Meistgesehene im Ego-Bild)
  sdfMesh(b, f, [-0.0195, V(262) - 0.002, u0 - 0.002], [0.0195, V(96), uT1 + 0.002], 0.0021, 'vp9Rec', { cav: STEEL, fine: 0.55, lite: 1.5 });
}

// Gehäuse-Endstück mit Schaftaufnahme (etwas breiter als das Gehäuse), seitliche Vertiefung oben mit senkrechtem Schlitz
// (25.10. auf Fotomaß: 35 × 14 px statt 42 × 32 px), Bohrung des Schaftstifts
function vp9Cap(b, rk) {
  const capD = field2(M(R.CAP), [], G2(b, 0.0004)), W = rect(R.CAP_RECESS), S = rect(R.CAP_SLOT), hw = 0.0177;
  const f = (x, v, u) => {
    const d2 = capD(u, v);
    if (d2 > 0.006) return d2;
    const ax = Math.abs(x);
    let d = extrudeRound(d2, x, hw, 0.003 * rk);
    if (ax > hw - 0.003) {
      d = Math.max(d, -roundMax(sdRoundRect(u - W.cu, v - W.cv, W.hu, W.hv, 0.0018), hw - 0.0008 - ax, 0.0004));
      if (b.max) d = Math.max(d, -roundMax(sdRoundRect(u - S.cu, v - S.cv, S.hu, S.hv, S.hu), hw - 0.0011 - ax, 0.0002));
    }
    return d;
  };
  sdfMesh(b, f, [-hw - 0.002, V(186), U(396)], [hw + 0.002, V(92), U(498)], 0.0026, 'vp9Rec', { cav: STEEL, fine: 0.6, lite: 1.5 });
}

// ---------------------------------------------------------------- Griffstück (Kunststoff, Atlas)
// Gehäuse oben 31,6 mm breit, Bügel 12 mm, Griff 29–31,5 mm mit kräftiger Rundung; Seitenflächen glatt um die Piktogramme
// (25.10.: das vertiefte „Navy-Feld“ zeigt kein Foto – entfernt), rechts vorn die Mulde um Magazinknopf und vorderen Bolzen
// (Hauptfoto), Schlitz für den Abzug unten im Gehäuse; Bügelöffnung durch.
function vp9Housing(b, rk) {
  const hD = field2(M(R.HOUSING), [M(R.GUARD_OPEN)], G2(b, 0.0004));
  const vG = V(R.GUARD_Y), uGr = U(R.GRIP_X1), vA = V(300), vB2 = V(400);
  const [bx, by0, by1, bw] = R.BUTTON_POCKET, BP = { cu: U(bx), cv: (V(by0) + V(by1)) / 2, hu: bw / R.PPM, hv: (by1 - by0) / 2 / R.PPM };
  const T = { u0: U(612), u1: U(664) };
  const hwGrip = (v) => 0.0146 + 0.0012 * Math.min(1, Math.max(0, (vA - v) / (vA - vB2)));
  const f = (x, v, u) => {
    const d2 = hD(u, v);
    if (d2 > 0.006) return d2;
    const ax = Math.abs(x);
    let d = extrudeRound(Math.max(d2, vG - v), x, HOUSE_W, 0.0022 * rk);                                     // Gehäuse
    d = smin(d, extrudeRound(Math.max(d2, v - vG - 0.002, uGr - u), x, 0.006, 0.0024), 0.003);              // Bügel
    d = smin(d, extrudeRound(Math.max(d2, v - vG - 0.002, u - uGr), x, hwGrip(v), 0.0068), 0.0045);         // Griff
    // Mulde rechts um Magazinknopf und Bolzen (1,4 mm tief, senkrechtes Langloch)
    if (x > HOUSE_W - 0.003 && Math.abs(u - BP.cu) < BP.hu + 0.002 && Math.abs(v - BP.cv) < BP.hv + 0.002) d = Math.max(d, -roundMax(sdRoundRect(u - BP.cu, v - BP.cv, BP.hu, BP.hv, BP.hu * 0.95), HOUSE_W - 0.0014 - x, 0.0005));
    // Schlitz für den Abzug in der Unterseite
    if (u > T.u0 - 0.002 && u < T.u1 + 0.002 && v < vG + 0.006) d = Math.max(d, -Math.max(ax - 0.0039, T.u0 - u, u - T.u1, v - (vG + 0.004)));
    return d;
  };
  sdfMesh(b, f, [-0.0185, V(430), U(450)], [0.0185, V(184), U(754)], 0.0026, FURN(b), { uv: vp9UV, cav: POLY, fine: 0.6, lite: 1.5 });
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
  sdfMesh(b, f, [-HG_W - 0.002, vB1 - 0.006, uR - 0.002], [HG_W + 0.002, vT + 0.002, uF + 0.002], 0.0026, FURN(b), { uv: vp9UV, cav: POLY, fine: 0.6, lite: 1.5 });
}

// ---------------------------------------------------------------- Kornträger (Stahl) mit Haube und Pfosten
// 25.10. als 3D-Gussform statt flacher Extrusion: Seitenumriss aus dem Foto (Stirn unten bei x 1143 – der Lauf beginnt
// darin, keine Lücke mehr), im Querschnitt zwei runde Augen um Spannhebelrohr und Lauf mit schmalem Steg dazwischen (von vorn
// gerundet wie am Original), hinten die etwas breitere Schelle für den Handschutz (Trennfuge x 1120), vorn die Nase des
// Rohrs. Stifte rechts: Schellenstift mit Ω-Kopf und Querstift mit Bohrung (beide im Foto).
const FSB_BASE = [[1087, 101], [1095, 101], [1097, 103], [1103, 103], [1107, 99], [1139, 99], [1145, 107], [1147, 115], [1147, 125], [1143, 135], [1143, 177], [1139, 182], [1131, 183], [1115, 183], [1111, 187], [1109, 189], [1087, 189]];
function fsbField(b, rk) {
  const bD = field2(M(FSB_BASE), [], G2(b, 0.0003)), uSeam = U(R.FSB_SEAM_X);
  return (x, v, u) => {
    const d2 = bD(u, v);
    if (d2 > 0.005) return d2;
    const ax = Math.abs(x), clamp = u < uSeam ? 0.0007 : 0;           // Schelle hinten 0,7 mm breiter
    const eyeT = Math.hypot(x, v - SEC.tubeV) - 0.0094 - clamp;           // Auge um das Spannhebelrohr
    const eyeB = roundMax(Math.hypot(x, v - AX) - 0.0124 - clamp, ax - 0.0104 - clamp, 0.002);   // Auge um den Lauf
    const web = ax - 0.0077 - clamp;                                      // Steg
    let d = roundMax(d2, smin(smin(eyeT, eyeB, 0.004), web, 0.0025), 0.0018 * rk);
    if (b.max && Math.abs(u - uSeam) < 0.0012 && ax > 0.006) d = Math.max(d, -Math.max(Math.abs(u - uSeam) - 0.00035, -(d + 0.0004)));   // Trennfuge
    return d;
  };
}
// Außenfläche (x > 0) des Kornträgers an (v, u) – für Stifte auf der gewölbten Fläche
function surfX(f, v, u) { let x = 0.016; while (x > 0 && f(x, v, u) > 0) x -= 0.0001; return x; }
function vp9FrontSight(b, rk) {
  const f = fsbField(b, rk), hw = 0.0132;
  sdfMesh(b, f, [-hw - 0.002, V(190), U(1085)], [hw + 0.002, V(98), U(1149)], 0.0019, 'vp9Steel', { cav: STEEL, fine: 0.6, lite: 1.5 });
  const [hx, , hr] = R.HOOD;
  hkHood(b, { u: U(hx), v: SIGHT_V, r: hr / R.PPM, ri: 0.0074, rw: 0.0057, vNeck: V(101), mat: 'vp9Steel', id: 'kornhaube' });
  // Stifte rechts (links: Gegenenden flach), Ω-Kopf als gewölbter Kopf mit Schlitz, Querstift mit Bohrung
  const [[p1x, p1y, p1r], [p2x, p2y, p2r]] = R.FSB_PINS;
  const s1 = surfX(f, V(p1y), U(p1x)), s2 = surfX(f, V(p2y), U(p2x));
  hkPin(b, 'vp9Steel', s1 + 0.0002, V(p1y), U(p1x), p1r / R.PPM * 0.75, 1, { h: 0.0011, xb: s1 + 0.0002 });
  if (b.hi) b.box('cavity', 0.0003, 0.0004, p1r / R.PPM * 1.2, s1 + 0.0012, V(p1y), U(p1x), { c: 0 });
  for (const sx of [-1, 1]) b.lathe('vp9Steel', [[0, 0], [0, p2r / R.PPM * 0.8], [0.0005, p2r / R.PPM * 0.72], [0.0005, 0]], sx * (s2 - 0.0002), V(p2y), U(p2x), { axis: 'x', ry: sx > 0 ? 0 : Math.PI, seg: 16 });
  if (b.hi) b.circle('cavity', p2r / R.PPM * 0.35, s2 + 0.00035, V(p2y), U(p2x), { ry: Math.PI / 2, seg: 12 });
}

// ---------------------------------------------------------------- Trommeldiopter auf dem Gehäuse
const RS_BASE = [[511, 105], [513, 83], [515, 77], [519, 69], [527, 65], [541, 65], [546, 74], [566, 82], [568, 89], [575, 97], [575, 105]];
function vp9RearSight(b, rk) {
  const bD = field2(M(RS_BASE), [], G2(b, 0.0003)), hw = 0.0102, Wn = rect([519, 74, 536, 87]), uD = U(R.DRUM[0]) - 0.004;
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
  // Trommel um die Querachse auf der Visierlinie (25.10. nachgemessen: Achsschraube y 68, über die Ecken Ø ≈ 18 mm = R.DRUM,
  // Stellungsflächen ≈ 16 mm; vorher Ø 13 mm), Blende Ø 7,8 mm (Spiel: größer als am Original ≈ 2–3,5 mm, damit Haube und Korn
  // im Anschlag ganz in der Lochblende stehen – wie im Zielbild „Visierlinie“), Seitenschraube rechts
  hkDrum(b, { u: U(R.DRUM[0]), v: SIGHT_V, r: R.DRUM[2] / R.PPM * 0.98, flat: 0.008, len: 0.016, apR: 0.0039, mat: 'vp9Steel', id: 'trommel' });
  hkPinHead(b, hw, V(90), U(533));
}

// ---------------------------------------------------------------- Schulterstütze (Gummikappe, Atlas)
function vp9Butt(b) {
  const sD = field2(M(R.BUTT), [], G2(b, 0.0005)), hw = 0.0205;
  const f = (x, v, u) => {
    const d2 = sD(u, v);
    if (d2 > 0.007) return d2;
    return extrudeRound(d2, x, hw, 0.0055);
  };
  sdfMesh(b, f, [-hw - 0.002, V(320), U(54)], [hw + 0.002, V(119), U(136)], 0.0034, FURN(b), { uv: vp9UV, cav: POLY, fine: 0.6, lite: 1.5 });
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
  hkPin(b, 'vp9Steel', HOUSE_W, V(py1), U(px1), pr1 / R.PPM, -1, { xb: HOUSE_W - 0.0012 });   // rechts in der Mulde
  hkPin(b, 'vp9Steel', 0.0177, V(R.STOCK_PIN[1]), U(R.STOCK_PIN[0]), R.STOCK_PIN[2] / R.PPM, -1);
  // Querstift vorn im Gehäuse (in der Bohrung, 1 mm vertieft)
  b.cyl('vp9Steel', 0.0026, 0.0026, SEC.hw * 2 - 0.002, 0, V(R.FRONT_PIN[1]), U(R.FRONT_PIN[0]), { axis: 'x', seg: 16 });
  // Magazinknopf rechts (Druckknopf mit Ring, steht aus der Mulde)
  const [mx, my, mr] = R.MAG_BUTTON;
  b.cyl('vp9Steel', mr / R.PPM, mr / R.PPM, 0.0026, HOUSE_W - 0.0003, V(my), U(mx), { axis: 'x', seg: 20 });
  b.torus('vp9Steel', mr / R.PPM + 0.0006, 0.0005, HOUSE_W - 0.0012, V(my), U(mx), { ry: Math.PI / 2, seg: 6, tseg: 22 });
  // Magazinschacht: Niet der Lasche rechts, links Halteplatte mit Schrauben und Rastknopf (PASKAL-Foto)
  const [rx, ry, rr] = R.WELL_RIVET_R;
  b.lathe('vp9Steel', [[0, 0], [0, rr / R.PPM], [0.0005, rr / R.PPM * 0.8], [0.0008, 0]], 0.0142, V(ry), U(rx), { axis: 'x', seg: 14 });
  for (const [wx, wy, wr] of R.WELL_SCREWS_L) {
    b.lathe('vp9Steel', [[0, 0], [0, wr / R.PPM], [0.0006, wr / R.PPM * 0.9], [0.0009, wr / R.PPM * 0.55], [0.0009, 0]], -0.0150, V(wy), U(wx), { axis: 'x', ry: Math.PI, seg: 16 });
    if (b.hi) b.box('cavity', 0.0003, 0.0004, wr / R.PPM * 1.5, -0.0159, V(wy), U(wx), { c: 0, rx: 0.5 });
  }
  const [lx0, ly0, lhu, lhv] = R.WELL_LATCH_L;
  b.box('vp9Steel', 0.0022, lhv * 2 / R.PPM, lhu * 2 / R.PPM, -0.0151, V(ly0), U(lx0), { c: 0.0006 });
  if (b.hi) for (let i = -1; i <= 1; i++) b.box('cavity', 0.0002, lhv * 1.4 / R.PPM, 0.0004, -0.0163, V(ly0), U(lx0) + i * 0.0018, { c: 0 });
  // Kappe des Spannhebelrohrs vorn am Kornträger (gerändelt), Querstift rechts, Riemenöse links
  b.lathe('knurl', [[0, 0], [0, 0.0072], [0.0042, 0.0072], [0.005, 0.0062], [0.005, 0]], 0, SEC.tubeV, U(1141), { seg: 24 });
  b.torus('vp9Steel', 0.0058, 0.0011, -0.0118, V(152), U(1112), { ry: Math.PI / 2, seg: 8, tseg: 24 });
  b.cyl('vp9Steel', 0.0019, 0.0019, 0.004, -0.0112, V(143), U(1112), { axis: 'x', seg: 12 });
  // Endstück links (PASKAL-Foto, nur PC): Riemenbügel aus Draht – aus einer Bohrung in der Seite über die Vorderkante der
  // Oberseite gebogen –, erhabenes Pfeildreieck vorn
  if (b.max) {
    const cx = -0.0177, top = V(93) + 0.0013, wu = U(469);
    b.tube('vp9Steel', [[cx - 0.0002, V(150), wu + 0.0004], [cx - 0.0013, V(132), wu], [cx - 0.0014, V(108), wu - 0.0004], [cx + 0.0006, top + 0.0004, wu - 0.0006], [cx + 0.006, top, wu - 0.0005], [-0.0075, V(93) - 0.0006, wu - 0.0004]], 0.0013, { seg: 8, tubSeg: 28 });
    b.cyl('cavity', 0.0017, 0.0017, 0.0004, cx - 0.00005, V(150), wu + 0.0004, { axis: 'x', seg: 12 });
    b.side('vp9Rec', [[U(484), V(126)], [U(494), V(132)], [U(484), V(138)]], 0.0008, cx - 0.0003, { bevel: 0.0002, bevelSeg: 1 });
  }
  // Gravuren links (eigene Bezeichnung statt Herstellerzeichen): Typ, Nummer, Werk, Kaliber am Schacht
  const lx = -(SEC.hw + 0.0001), MK = R.MARKS;
  mark(b, 'VP-9 VIPER', lx, V(MK.typ[1] + 2), U(MK.typ[0] + 2), 0.0031, { weight: '700' });
  mark(b, 'NP 59 3017', lx, V(MK.nummer[1] + 2), U(MK.nummer[0] + 34), 0.0026);
  mark(b, 'NULLPUNKT WAFFENWERK', lx, V(132), U(612), 0.0018);
  mark(b, 'KAL. 9 MM x 19', -0.0143, V(193), U(MK.kaliber[0] + 8), 0.0032);   // oben am Schacht (PASKAL: über der Halteplatte)
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
  b.side('vp9Mag', b.hi ? M(body) : simplifyRing(M(body), 0.003), 0.0224, 0, { part: 'mag', bevel: b.hi ? 0.0012 : 0, bevelSeg: b.max ? 2 : 1 });
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
