// P-9A Kompakt-Automatik (26.10., Nutzerwunsch 24./26.10. „mehr Waffen, unterschiedlichere Waffen … ultra realistischer Detailgrad
// wie M-17/P-9“): Ableitung der P-9 nach dem Referenzfoto einer Glock 18C (3. Generation, p9a-ref.js). Gebaut aus den P-9-Bausteinen
// (guns-pistol.js p9(b, o) – gleicher Schlitten, gleiche Mechanik und Griffpunkte), mit den Unterschieden des Vorbilds:
//   – Rahmen Gen 3 nach Foto: schmalerer Griffrücken, gerippte Abzugsbügel-Front, gerader Griffboden, kleiner Magazinhalter,
//     kleiner Schlittenfang mit Querrillen, Zerlegehebel mit Metallzunge, Querstifte und Loch der Abzugseinheit wie im Foto;
//   – Kompensator: Fenster oben im Schlitten hinter dem Korn (Langloch 24,5 × 7,2 mm) über dem Lauf mit vier Bohrungen, die nach vorn
//     größer werden (Glock-Begleitblatt: „vier Bohrungen im Lauf, Fenster im Schlitten“; Lage/Größe nach Beschreibung geschätzt,
//     das Seitenfoto zeigt die Oberseite nicht);
//   – Wahlschalter hinten links am Schlitten: Deckscheibe Ø 12,9 mm, Hebel 17 mm mit Pfeilspitze, dreht als Teil 'selector'
//     (Kind des Schlittens) um 86° von Einzel (oben, 1 Punkt) auf Dauer (unten, 2 Punkte) – Stellungen in meta.selector;
//   – kleineres Korn weiter vorn, Kimme mit schräger Rückfläche (Foto);
//   – 19er-Magazin mit verlängertem Boden (+2) wie im Foto; Aufsatz „Erweitertes Magazin“ = 33er-Stangenmagazin (ragt ≈ 10 cm heraus,
//     eigene Patronenbahn, meta.magExt: attach.js streckt es nicht zusätzlich).
// Eigener Atlas (p9a-tex.js) für Schlitten und Rahmen. Detailstufen nach Budget §3.4 (Pistole): PC hoch ≤ 150 k, PC niedrig/mittel
// ≤ 60 k, Handy ≤ 30 k, Bots ≤ 400 Dreiecke – gröberes Raster als die P-9 (die P-9 selbst bleibt unverändert).
import { p9, P9, gripMag } from './guns-pistol.js';
import * as R9 from './p9-ref.js';
import * as R from './p9a-ref.js';
import { p9aSlideUV, p9aFrameUV } from './p9a-tex.js';
import { atlasUVTri } from './pistol-parts.js';
import { surfaceNets, cavityColors, simplifyPoly } from './sdf.js';
import { magRounds } from './magfill.js';

const { U, V, M } = R;
const { axis: AX, front: UF, hw: HW } = P9;
const RAKE = 0.38;
// Kompensator: Fenster im Schlitten (Langloch längs, Mitte x = 0) und vier Laufbohrungen (u-Mitte, Länge, Breite)
const WIN = { u0: UF - 0.0375, u1: UF - 0.013, hw: 0.0036, floor: AX + 0.0035 };
const PORTS = [[UF - 0.0167, 0.0036, 0.0040], [UF - 0.0219, 0.0033, 0.0037], [UF - 0.0269, 0.0030, 0.0034], [UF - 0.0317, 0.0027, 0.0031]];
const BARREL_R = 0.006, BORE_R = 0.0046, CHANNEL_R = 0.0068;
// Raster je Stufe (Budget Pistole): Schlitten / Rahmen – PC hoch, PC niedrig/mittel, Handy
const STEP = { slide: { max: 0.00084, std: 0.00136, lite: 0.00194 }, frame: { max: 0.00099, std: 0.00158, lite: 0.00223 } };
const SLIDEM = (b) => (b.max || b.lite ? 'p9aSlide' : 'p9aSlideS');
const FRAMEM = (b) => (b.max || b.lite ? 'p9aFrame' : 'p9aFrameS');
const near = (pts, [x, y]) => pts.reduce((bi, p, i) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(pts[bi][0] - x, pts[bi][1] - y) ? i : bi), 0);
const sdRoundRect = (a, b, ha, hb, r) => {
  const qa = Math.abs(a) - ha + r, qb = Math.abs(b) - hb + r;
  return Math.min(Math.max(qa, qb), 0) + Math.hypot(Math.max(qa, 0), Math.max(qb, 0)) - r;
};
// Wahlschalter (Fotomaße): Drehpunkt = Mitte der Deckscheibe auf der linken Schlittenfläche
const SEL = { u: U(R.SELECTOR.c[0]), v: V(R.SELECTOR.c[1]), r: R.SELECTOR.r / R.PPM };
const SEL_AUTO = -1.5;   // Drehung um +x von Einzel (Foto) nach Dauer: Schwanz zeigt von 60° nach −26° (vorn unten, 2 Punkte)

// Kompensatorfenster + verlängerter Laufkanal (Lauf durch das Fenster sichtbar)
function compCut(d, x, v, u) {
  d = Math.max(d, -Math.max(Math.hypot(x, v - AX) - CHANNEL_R, UF - 0.041 - u));
  const uc = Math.min(Math.max(u, WIN.u0 + WIN.hw), WIN.u1 - WIN.hw);
  return Math.max(d, -Math.max(Math.hypot(x, u - uc) - WIN.hw, WIN.floor - v));
}

// Lauf: Haube im Auswurffenster (wie P-9), hinterer Teil als Drehteil, vorderer Teil mit den vier Bohrungen als Distanzfeld
function barrel(b, port) {
  const vTop = P9.top;
  b.box('barrelNitride', 0.0125, vTop - 0.0007 - (AX - 0.002), port.hu * 2 - 0.0008, 0, (vTop - 0.0007 + AX - 0.002) / 2, port.cu, { part: 'slide', c: 0.0005 });
  const uRear = UF + 0.0007 - 0.06, uSplit = UF - 0.04;
  b.lathe('barrelNitride', [[0, BARREL_R], [uSplit - uRear + 0.0004, BARREL_R]], 0, AX, uRear, { part: 'slide', seg: 28 });
  // Raster nur für den Abschnitt mit den Bohrungen (unter dem Fenster); das vorstehende Laufende als Drehteil, damit die Mündung
  // auch in den groben Stufen rund bleibt
  const uCut = UF - 0.012;
  const f = (x, v, u) => {
    let d = Math.max(Math.hypot(x, v - AX) - BARREL_R, u - uCut, uSplit - u);
    for (const [pu, pl, pw] of PORTS) d = Math.max(d, -Math.max(sdRoundRect(u - pu, x, pl / 2, pw / 2, 0.0012), AX + BORE_R - v));
    return d;
  };
  const g = surfaceNets(f, [-0.0068, AX - 0.0068, uSplit - 0.001], [0.0068, AX + 0.0068, uCut + 0.001], STEP.slide[b.tier]);
  if (b.max) cavityColors(g, f, { r: 0.0006, edge: 0.9, cavity: 0.5 });
  b._push(g, 'barrelNitride', { part: 'slide' });
  const u0 = uCut - 0.0004, L = UF + R.BARREL_PROUD - u0;
  const seg = b.lite ? 20 : 28;
  b.lathe('barrelNitride', [[0, BARREL_R], [L - 0.0003, BARREL_R], [L, BARREL_R - 0.0003], [L, BORE_R]], 0, AX, u0, { part: 'slide', seg });
  // Bohrung (Prüfung 26.10.: die b.bore-Scheibe zeigt nach hinten und ist mit einseitigem Material unsichtbar – man sah die
  // helle Stirn des Laufabschnitts darunter): schwarzes Rohr nach innen gerichtet bis kurz vor den Bohrungsabschnitt, Boden nach vorn
  b.lathe('cavity', [[L - 0.0001, BORE_R], [0.0008, BORE_R], [0.0008, 0]], 0, AX, u0, { part: 'slide', seg });
  // Boden der Bohrungen dunkel (Blick in den Lauf), Mündung mit Bohrung und Krone wie P-9
  for (const [pu, pl, pw] of PORTS) b.box('cavity', pw * 0.92, 0.0002, pl * 0.92, 0, AX + BORE_R + 0.0001, pu, { part: 'slide', c: 0 });
  b.bore(BORE_R, 0, AX, UF + R.BARREL_PROUD + 0.0004, { part: 'slide', seg: 24 });
}

// Kimme mit schräger Rückfläche: Kimmenausschnitt und weiße U-Markierung in der Ebene der Rückfläche
function rearNotch(b) {
  const [, , [rx0, ry0], [rx1, ry1]] = R.REAR_SIGHT;   // [2018,85] → [1997,37]
  const rv = V(ry1), slope = Math.atan2((rx0 - rx1) / R.PPM, (ry0 - ry1) / R.PPM);   // Neigung der Rückfläche gegen die Senkrechte
  const ruAt = (v) => U(rx1 + (rx0 - rx1) * ((rv - v) * R.PPM) / (ry0 - ry1));
  const uf = U(1936), o = { part: 'slide', c: 0, rx: -slope };
  const ru = ruAt(rv - 0.0013);
  b.box('cavity', 0.0034, 0.0026, uf - ru + 0.0008, 0, rv - 0.0011, (uf + ru) / 2, { part: 'slide', c: 0 });
  for (const s of [-1, 1]) b.box('paintWhite', 0.0008, 0.0031, 0.0003, s * 0.0025, rv - 0.0016, ruAt(rv - 0.0016) - 0.00018, o);
  b.box('paintWhite', 0.0058, 0.0008, 0.0003, 0, rv - 0.0034, ruAt(rv - 0.0034) - 0.00018, o);
}

// Wahlschalter: Deckscheibe am Schlitten, Hebel als eigenes Teil (Kind des Schlittens)
function selector(b) {
  const xs = -HW;
  b.part('selector', xs, SEL.v, SEL.u, 'slide');
  b.lathe('barrelNitride', [[0, 0], [0, SEL.r], [0.0006, SEL.r], [0.001, SEL.r - 0.0005], [0.0011, 0]], xs, SEL.v, SEL.u, { axis: 'x', ry: Math.PI, seg: b.hi ? 36 : 6, part: 'slide' });
  if (b.hi && !b.lite) b.torus('cavity', SEL.r + 0.0002, 0.00018, xs - 0.00005, SEL.v, SEL.u, { ry: Math.PI / 2, seg: 4, tseg: 36, part: 'slide' });   // Spalt um die Scheibe
  // Hebel: Schwanz (schmal) bis zum Drehpunkt, Pfeilspitze darüber hinaus (Fotomaße, Stellung Einzelfeuer)
  const T = [U(R.SELECTOR.tail[0]), V(R.SELECTOR.tail[1])], A = [U(R.SELECTOR.tip[0]), V(R.SELECTOR.tip[1])], P = [SEL.u, SEL.v];
  const e = [T[0] - P[0], T[1] - P[1]], le = Math.hypot(e[0], e[1]), n = [-e[1] / le, e[0] / le];
  const at = (p, k) => [p[0] + n[0] * k, p[1] + n[1] * k];
  const lever = [at(T, 0.0007), at(P, 0.0019), A, at(P, -0.0019), at(T, -0.0007)];
  b.side('barrelNitride', lever, 0.0015, xs - 0.0011 - 0.00075, { part: 'selector', bevel: 0.00045, bevelSeg: 2 });
  // Nabe und Rippe auf dem Hebel (blank gerieben)
  if (b.hi) {
    b.cyl('steelBright', 0.0013, 0.0013, 0.0006, xs - 0.0027, SEL.v, SEL.u, { axis: 'x', seg: 16, part: 'selector' });
    if (!b.lite) b.side('steelBright', [at(T, 0.00022), at(P, 0.0004), at(P, -0.0004), at(T, -0.00022)], 0.0004, xs - 0.00278, { part: 'selector', bevel: 0.00012 });
  }
}

// Magazin: 19er mit verlängertem Boden (Foto) bzw. 33er-Stange (Aufsatz „Erweitert“)
function magazine(b, rake) {
  const u = U(1900), v = V(R.FRAME_BOTTOM_Y + 4), s = Math.sin(rake), c = Math.cos(rake);
  const ext = b.att && b.att.magazin === 'erweitert';
  if (!ext) {
    gripMag(b, { u, v, w: 0.0208, len: 0.097, depth: 0.0305, plate: null, rake });
    const plate = b.hi ? M(R.MAG19) : simplifyPoly(M(R.MAG19), 0.0025);
    b.side('polymer', plate, 0.0258, 0, { part: 'mag', bevel: 0.0016 });
    if (b.hi && !b.lite) for (const sd of [-1, 1]) b.circle('cavity', R.MAG19_HOLE[2] / R.PPM, sd * 0.01292, V(R.MAG19_HOLE[1]), U(R.MAG19_HOLE[0]), { part: 'mag', ry: sd * Math.PI / 2, seg: 10 });
    return;
  }
  // 33 Schuss: Körper 88 mm länger, gerade in der Griffachse, Glock-Boden; Patronenbahn über die ganze Länge
  const E = 0.088, len = 0.097 + E, ub = u - s * E, vb = v - c * E;
  gripMag(b, { u: ub, v: vb, w: 0.0208, len, depth: 0.0305, plate: null, rake });
  const at = (l) => [0, vb + 0.004 + c * l, ub + s * l];
  magRounds(b, { cal: 'p9', fit: 0.0275, width: 0.0178, depth: 0.0285, path: [at(len + 0.002), at(0.02)], cap: 33 });
  // Boden: flacher Polymerboden mit vorderer Nase (lokal: a längs der Tiefe nach vorn, h längs der Griffachse nach oben)
  const loc = (a, h) => [ub + a * c + h * s, vb - a * s + h * c];
  const fp = [[-0.0172, 0.0012], [0.0158, 0.0012], [0.0184, -0.0018], [0.0184, -0.0068], [0.0168, -0.0082], [-0.0162, -0.0082], [-0.0176, -0.0066]].map(([a, h]) => loc(a, h));
  b.side('polymer', fp, 0.0262, 0, { part: 'mag', bevel: 0.0014 });
  // Zählerlöcher hinten (9, 15, 20, 25, 30, 33 Patronen)
  if (b.hi && !b.lite) for (let i = 0; i < 6; i++) {
    const l = 0.03 + i * 0.026;
    b.circle('cavity', 0.0011, 0, vb + 0.004 + c * l + s * 0.01525, ub + s * l - c * 0.01526 - 0.0001, { part: 'mag', rx: -rake, seg: 10 });
  }
}

export function p9a(b) {
  const lower = M(R.LOWER);
  const i0 = near(R.LOWER, R.BOT_GRIP.from), i1 = near(R.LOWER, R.BOT_GRIP.to);
  const ext = b.att && b.att.magazin === 'erweitert';
  // Schlitten: P-9-Umriss ab Rillen bis Heck, vorn die Nase aus dem Foto
  const slideP9 = R9.M(R9.SLIDE), slide = [...slideP9.slice(0, 8), ...M(R.SLIDE_NOSE)];
  p9(b, {
    slide, lower, open: M(R.OPEN),
    botGrip: [...lower.slice(i0, i1 + 1), ...M(R.BOT_GRIP.extra)],
    boss: M(R.TAKEDOWN_BOSS), ledge: M(R.STOP_LEDGE), slot: M(R.TAKEDOWN), takedown: M(R.TAKEDOWN),
    takedownRibs(bb) {
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) bb.box('polymer', 0.0006, 0.0006, 0.0034, s * 0.0112, V(378 + i * 13), U(1031 + i * 3.4), { c: 0, rx: -0.26 });
      bb.side('stainless', M([[1036, 428], [1062, 424], [1070, 458], [1046, 464]]), 0.0226, 0, { bevel: 0.0002 });
    },
    slideStop: M(R.SLIDE_STOP), stopMat: 'steelDark',   // Gen 3: schwarz brünierter Fang (Foto), P-9 Gen 4 Edelstahl
    stopRibs(bb) { for (const y of R.STOP_RIBS) bb.box('cavity', 0.0003, 0.0004, 0.0088, -0.0127, V(y), U(1528), { c: 0 }); },
    pins: R.PINS.map(([x, y, r]) => [U(x), V(y), r / R.PPM]),
    magRelease: M(R.MAG_RELEASE), trigger: M(R.TRIGGER), safety: M(R.SAFETY),
    frontSight: M(R.FRONT_SIGHT), rearSight: M(R.REAR_SIGHT), rearNotch,
    frontDot: { v: V(62), u: U(214) - 0.0003, rx: -0.36 },
    sight: { v: V(38.4), u: U(1966.5) },
    magWell: { v: V(R.FRAME_BOTTOM_Y + 4), u: U(1900) }, muzzleU: UF + R.BARREL_PROUD + 0.0008,
    step: STEP, mats: { slide: SLIDEM(b), frame: FRAMEM(b) }, slideUV: p9aSlideUV, frameUV: p9aFrameUV, atlas: atlasUVTri,
    slideCut: compCut, barrel, mag: magazine,
    meta: { selector: { semi: 0, auto: SEL_AUTO }, ...(ext ? { magExt: true } : {}) },
  });
  selector(b);
  // Loch der Abzugseinheit oben im Griffrücken (beidseitig sichtbar)
  if (b.hi) b.cyl('cavity', R.BACK_PIN[2] / R.PPM, R.BACK_PIN[2] / R.PPM, 0.0302, 0, V(R.BACK_PIN[1]), U(R.BACK_PIN[0]), { axis: 'x', seg: 12 });
}

