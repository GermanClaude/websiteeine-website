// PS-41 Wirbel nach Referenzfoto (PPSch-41 mit 71er-Trommel, wirbel-ref.js) – neue Waffe 26.10. (Nutzerwunsch „mehr Waffen,
// unterschiedlichere Waffen … Detailgrad wie M-17/P-9“). Verfahren wie dort: Umrisse aus dem Foto, kalibriert (843 mm), Bauteile
// mit eigener Breite als Distanzfelder (Birkenschaft mit Kolbenhals und Griffnase, unteres Gehäuse mit Scharnierblock und
// Trommelschacht, Deckelkappe), Laufmantel als Blechrohr mit ausgeschnittenen Kühlschlitzen (Durchlässigkeitskarte, Ränder als
// echte Blechkante), schräge Mündungsbremse mit Seitenfenstern, Lauf im Mantel sichtbar, Korn mit Schutzblech, Kippkimme,
// Trommel (Achse parallel zum Lauf) mit Deckel, Sicken, Riegel und Aufziehknopf. Offener Verschluss: das Modell zeigt den
// Verschluss in Ruhelage HINTEN (Spannhebel rechts hinten, Lager im Auswurffenster oben frei), Animation viewmodel.js (openBolt).
// Detailstufen: PC hoch/ultra (max), PC niedrig/mittel, Handy (lite), Bots (≤ 600 Dreiecke) – Anker in allen Stufen gleich.
import * as THREE from 'three';
import * as R from './wirbel-ref.js';
import { woodUV, mantelUV, mantelCuts, MANTEL_U0 } from './wirbel-tex.js';
import { extrudeRound, simplifyRing } from './sdf.js';
import { STEEL, POLY, field2, sdRoundRect, sdfMesh } from './sdfkit.js';
import { magRounds } from './magfill.js';

const { U, V, M } = R;
const AX = R.AXIS, RO = R.MANTEL_R, RI = R.MANTEL_R - 0.0009;
const px = (u) => R.XG - u * R.PPM;
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
// Schaftbreite je Lage (Foto oben/hinten nicht vorhanden – Maße der PPSch: Vorderschaft 41 mm, Kolbenhals 35 mm, Kolben 42 mm)
const hwStock = (u) => { const x = px(u); return x < 2480 ? 0.0205 : x < 2580 ? lerp(0.0205, 0.0174, (x - 2480) / 100) : x < 2790 ? 0.0174 : lerp(0.0174, 0.0212, (x - 2790) / 160); };
const U_BOLT = U(1905), BOLT_L = (2285 - 1905) / R.PPM, TRAVEL = (1905 - R.BARREL.breech) / R.PPM;   // Hub 65 mm bis zum Lager
const DRUM_U0 = U(R.DRUM.x1), DRUM_L = (R.DRUM.x1 - R.DRUM.x0) / R.PPM, DRUM_V = V(R.DRUM.cy), DRUM_R = R.DRUM.r / R.PPM;
const U_FRONT = (v) => U(R.frontX(R.AXIS_Y - (v - AX) * R.PPM));   // schräge Stirn: u je Höhe

export function wirbel(b) {
  if (b.hi) {
    b.shared('schaft', () => stock(b));
    b.shared('gehaeuse', () => housing(b));
    b.shared('kappe', () => cap(b));
    b.shared('mantel', () => mantel(b));
    smallParts(b);
  } else botStage(b);
  bolt(b);
  drum(b);
  // Anker (alle Stufen gleich)
  const uMz = U_FRONT(AX);
  b.anchor('muzzle', 0, AX, uMz + 0.002);
  b.anchor('ejection', 0.004, AX + RO - 0.004, U(1720), { rz: 1.2 });
  b.anchor('trigger', 0, V(1300), U(2318));
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.62, gw: 0.0178, gd: 0.023, gu: 0.0, ho: 0.03, tu: 0.045 } });
  // Stützhand unter dem Scharnierblock vor der Trommel (Fotos/Ausbildung: Mantel heiß, Trommel wackelt) – Hände ≈ 29 cm auseinander
  b.anchor('leftHandGrip', 0, V(1182), U(1420), { data: { style: 'under', w: 0.02, h: 0.02 } });
  b.anchor('magWell', 0, V(R.ROUND_TOP[1]), U(R.ROUND_TOP[0]));
  b.anchor('magGrab', -0.055, DRUM_V - 0.03, DRUM_U0 + DRUM_L / 2, { part: 'mag', data: { w: 0.05, d: 0.06 } });
  b.anchor('chargeGrab', RO + 0.013, V(R.CHARGE.y), U(R.CHARGE.x), { part: 'bolt', data: { style: 'right', travel: [0, 0, TRAVEL] } });
  b.anchor('sight', 0, V(R.SIGHT_Y), U(2180), { data: { type: 'iron', eyeRelief: 0.27 } });   // Auge etwas hinter der Wange: Schießhand am Kolbenhals sonst bildfüllend
  // Wahlhebel vor dem Abzug: hinten Dauer, vorn Einzel (kippt um seinen Kopf im Holz)
  b.meta = { sight: 'iron', axis: AX, kind: 'smg', selector: { auto: 0, semi: 0.32 } };
}

// ---------------------------------------------------------------- Schaft (Birke, Atlas) und Kolbenkappe
function stock(b) {
  const f2 = field2(M(R.STOCK), [], b.max ? 0.0006 : 0.0011);
  const uPlate = U(R.BUTTPLATE), rr = b.max ? 0.0075 : 0.0068;
  const wood = (x, v, u) => {
    const d2 = f2(u, v);
    if (d2 > 0.004) return d2;
    return extrudeRound(Math.max(d2, uPlate - u), x, hwStock(u), rr);
  };
  sdfMesh(b, wood, [-0.025, V(1714), U(R.BUTTPLATE) - 0.002], [0.025, V(1066), U(1902)], 0.0024, 'wirbelWood', { cav: POLY, fine: 0.6, uv: woodUV });
  const plate = (x, v, u) => {
    const d2 = f2(u, v);
    if (d2 > 0.004) return d2;
    return extrudeRound(Math.max(d2, u - uPlate), x, 0.0206, 0.0045);
  };
  sdfMesh(b, plate, [-0.024, V(1712), U(3642)], [0.024, V(1245), uPlate + 0.002], 0.0018, 'wirbelSteel', { cav: STEEL, fine: 0.6 });
}

// ---------------------------------------------------------------- Unteres Gehäuse: Scharnierblock, Trommelschacht mit Seitenfenstern
function housing(b) {
  const f2 = field2(M(R.HOUSING), [], b.max ? 0.0005 : 0.001);
  const HW = 0.019, [w0, w1, wy] = R.HOUSING_WIN, cu = (U(w0) + U(w1)) / 2, hu = (w1 - w0) / 2 / R.PPM;
  const vBot = V(1267), cv = (V(wy) + vBot - 0.02) / 2, hv = (V(wy) - vBot + 0.02) / 2;
  const f = (x, v, u) => {
    const d2 = f2(u, v);
    if (d2 > 0.004) return d2;
    let d = extrudeRound(d2, x, HW, b.max ? 0.0016 : 0.0022);
    // Fenster beidseitig (Wand 4,5 mm, Gehäuse 38 mm): der Trommelrand läuft hindurch
    d = Math.max(d, -Math.max(sdRoundRect(u - cu, v - cv, hu, hv, 0.003), 0.0145 - Math.abs(x)));
    return d;
  };
  sdfMesh(b, f, [-0.0215, V(1272), U(1918)], [0.0215, V(1070), U(1266)], 0.0016, 'wirbelSteel', { cav: STEEL, fine: 0.55 });
}

// ---------------------------------------------------------------- Deckelkappe hinten (Riegel)
function cap(b) {
  const f2 = field2(M(R.CAP), [], b.max ? 0.0005 : 0.001);
  const f = (x, v, u) => { const d2 = f2(u, v); if (d2 > 0.004) return d2; return extrudeRound(d2, x, 0.0196, 0.0085); };
  sdfMesh(b, f, [-0.022, V(1080), U(2503)], [0.022, V(958), U(2212)], 0.0016, 'wirbelSteel', { cav: STEEL, fine: 0.55 });
}

// ---------------------------------------------------------------- Laufmantel + Deckel: Blechrohr mit Ausschnitten
// Außen- und Innenfläche je Winkelspalte als ein Viereck (Länge über die ganze Waffe; die Schlitze schneidet die
// Durchlässigkeitskarte pixelgenau), Blechkanten an jedem Ausschnitt als Streifen, Stirnblech schräg mit Geschossloch.
function mantel(b) {
  const N = b.max ? 72 : b.lite ? 36 : 54;
  const pos = [], nrm = [], uv = [];
  const P = (x, v, u) => [x, v, -u];
  const tri = (A, B, C, n, ua, ub, uc) => {
    // Umlauf nach gewünschter Normale ausrichten (vorn sichtbar)
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    for (const [p, t] of flip ? [[A, ua], [C, uc], [B, ub]] : [[A, ua], [B, ub], [C, uc]]) { pos.push(...p); nrm.push(...(p.n || n)); uv.push(...t); }
  };
  const ring = (r, a, u) => { const p = P(r * Math.sin(a), AX + r * Math.cos(a), u); p.n = r === RO ? [Math.sin(a), Math.cos(a), 0] : [-Math.sin(a), -Math.cos(a), 0]; return p; };
  for (const r of [RO, RI]) {
    for (let j = 0; j < N; j++) {
      const a0 = -Math.PI + j * 2 * Math.PI / N, a1 = a0 + 2 * Math.PI / N;
      const f0 = U_FRONT(AX + r * Math.cos(a0)), f1 = U_FRONT(AX + r * Math.cos(a1));
      const A = ring(r, a0, MANTEL_U0), B = ring(r, a1, MANTEL_U0), C = ring(r, a1, f1), D = ring(r, a0, f0);
      const n = r === RO ? [Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2), 0] : [-Math.sin((a0 + a1) / 2), -Math.cos((a0 + a1) / 2), 0];
      tri(A, B, C, n, mantelUV(MANTEL_U0, a0), mantelUV(MANTEL_U0, a1), mantelUV(f1, a1));
      tri(A, C, D, n, mantelUV(MANTEL_U0, a0), mantelUV(f1, a1), mantelUV(f0, a0));
    }
  }
  // Blechkanten der Ausschnitte (nicht Handy): Streifen zwischen außen und innen entlang des Umrisses
  if (!b.lite) {
    for (const c of mantelCuts()) {
      const cu = (c.u0 + c.u1) / 2, hu = (c.u1 - c.u0) / 2, r = Math.min(c.r, hu, c.ha), ca = c.a;
      const pts = [], K = b.max ? 10 : 6;
      const corner = (sx, sy, a0) => { for (let k = 0; k <= K; k++) { const t = a0 + k / K * Math.PI / 2; pts.push([cu + sx * (hu - r) + r * Math.cos(t), sy * (c.ha - r) + r * Math.sin(t)]); } };
      corner(1, 1, 0); corner(-1, 1, Math.PI / 2); corner(-1, -1, Math.PI); corner(1, -1, 1.5 * Math.PI);
      for (let i = 0; i < pts.length; i++) {
        const [ua, sa] = pts[i], [ub, sb] = pts[(i + 1) % pts.length];
        const aa = ca + sa / RO, ab = ca + sb / RO;
        const A = ring(RO, aa, ua), B = ring(RO, ab, ub), C = ring(RI, ab, ub), D = ring(RI, aa, ua);
        // Normale zeigt in den Ausschnitt (zur Mitte)
        const mu = cu - (ua + ub) / 2, ms = -(sa + sb) / 2, am = (aa + ab) / 2, l = Math.hypot(mu, ms) || 1;
        const n = [Math.cos(am) * ms / l, -Math.sin(am) * ms / l, -mu / l];
        A.n = B.n = C.n = D.n = n;
        tri(A, B, C, n, mantelUV(ua, aa), mantelUV(ub, ab), mantelUV(ub, ab));
        tri(A, C, D, n, mantelUV(ua, aa), mantelUV(ub, ab), mantelUV(ua, aa));
      }
    }
  }
  // Stirnblech (schräg): Ring zwischen Geschossloch (r 5,2 mm) und Mantel, Vorder- und Rückseite
  const rh = 0.0052, nf = new THREE.Vector3(0, (R.MANTEL.x1 - R.MANTEL.x0) / (R.MANTEL.y1 - R.MANTEL.y0), 1).normalize();
  for (const [off, s] of [[0, 1], [-0.0009, -1]]) {
    const n = [0, nf.y * s, -nf.z * s];
    for (let j = 0; j < N; j++) {
      const a0 = -Math.PI + j * 2 * Math.PI / N, a1 = a0 + 2 * Math.PI / N;
      const H0 = P(rh * Math.sin(a0), AX + rh * Math.cos(a0), U_FRONT(AX + rh * Math.cos(a0)) + off);
      const H1 = P(rh * Math.sin(a1), AX + rh * Math.cos(a1), U_FRONT(AX + rh * Math.cos(a1)) + off);
      const O0 = P(RO * Math.sin(a0), AX + RO * Math.cos(a0), U_FRONT(AX + RO * Math.cos(a0)) + off);
      const O1 = P(RO * Math.sin(a1), AX + RO * Math.cos(a1), U_FRONT(AX + RO * Math.cos(a1)) + off);
      for (const p of [H0, H1, O0, O1]) p.n = n;
      const q = mantelUV(U_FRONT(AX) + 0.0005, 0);
      tri(H0, O0, O1, n, q, q, q); tri(H0, O1, H1, n, q, q, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  b._push(g, 'wirbelMantel', {}, true);
  // Lauf im Mantel (durch die Schlitze sichtbar): Lager im Gehäuse, schlanke Mündung unter dem Korn, Bohrung
  const L = (R.BARREL.breech - R.BARREL.muzzle) / R.PPM, uB = U(R.BARREL.breech);
  b.lathe('steelDark', [[0, 0.0088], [0.036, 0.0088], [0.046, 0.0074], [L - 0.003, 0.0068], [L - 0.001, 0.0064], [L, 0.0058], [L, 0.0041]], 0, AX, uB, { seg: b.max ? 28 : 18 });
  b.bore(0.0039, 0, AX, uB + L + 0.0005);
}

// ---------------------------------------------------------------- Kleinteile (Ego-Stufen)
function smallParts(b) {
  // Korn: Schutzblech (Dreieck mit Fenster) und Säule mit Kopf
  b.side('wirbelSteel', M(R.FS_BASE), 0.009, 0, { holes: [M(R.FS_HOLE)], bevel: 0.0007, v: -0.0006 });
  const [fx, fy0, fy1] = R.FS_POST;
  b.cyl('wirbelSteel', 0.0011, 0.0013, V(fy1) - V(fy0), 0, (V(fy0) + V(fy1)) / 2, U(fx), { axis: 'v', seg: 10 });
  b.cyl('wirbelSteel', 0.0016, 0.0016, 0.0022, 0, V(fy1) - 0.001, U(fx), { axis: 'v', seg: 10 });
  // Kimme: Visierfuß, Blattfeder, Kippkimme mit Kerbe (2,4 mm breit, Schultern auf der Visierlinie)
  b.side('wirbelSteel', M(R.RS_BODY), 0.014, 0, { bevel: 0.0008 });
  b.box('wirbelSteel', 0.0085, 0.0012, (2150 - 1925) / R.PPM, 0, V(951) + 0.0004, U(2037), { c: 0.0003 });
  const leaf = R.RS_LEAF, low = leaf.map(([x, y]) => [x, Math.max(y, 946)]);
  b.side('wirbelSteel', M(low), 0.012, 0, { bevel: 0.0006 });
  for (const s of [-1, 1]) b.side('wirbelSteel', M([[2150, 947], [2151, 946], [2160, 940], [2192, 940], [2205, 948], [2204, 947]]), 0.0048, s * 0.0036, { bevel: 0.0004 });
  // Scharnierbolzen und Schraube (beidseitig), Kappenknopf, vorderer Riemenbügel (links)
  for (const s of [-1, 1]) {
    b.cyl('wirbelSteel', R.HINGE[2] / R.PPM, R.HINGE[2] / R.PPM, 0.003, s * 0.0195, V(R.HINGE[1]), U(R.HINGE[0]), { axis: 'x', seg: 24 });
    b.cyl('steelDark', 0.0024, 0.0024, 0.0034, s * 0.0206, V(R.HINGE[1]), U(R.HINGE[0]), { axis: 'x', seg: 12 });
    b.cyl('wirbelSteel', R.SCREW[2] / R.PPM, R.SCREW[2] / R.PPM * 0.9, 0.0022, s * 0.0196, V(R.SCREW[1]), U(R.SCREW[0]), { axis: 'x', seg: 14 });
    b.cyl('wirbelSteel', R.CAP_BUTTON[2] / R.PPM, R.CAP_BUTTON[2] / R.PPM, 0.0024, s * 0.0196, V(R.CAP_BUTTON[1]), U(R.CAP_BUTTON[0]), { axis: 'x', seg: 14 });
  }
  const [sx0, sx1, sy0, sy1] = R.SWIVEL, su = U((sx0 + sx1) / 2), sw = -RO;
  b.tube('wirbelSteel', [[sw + 0.002, V(sy0) - 0.002, su], [sw - 0.004, V(sy0 + 12), su], [sw - 0.0075, AX, su], [sw - 0.004, V(sy1 - 12), su], [sw + 0.002, V(sy1) + 0.002, su]], 0.0018, { seg: 8 });
  // Magazinhalter (Hebel hinter der Trommel), Abzugsbügel (Stahlband), Abzug, Wahlhebel
  b.side('wirbelSteel', M(R.CATCH), 0.009, 0, { bevel: 0.0008 });
  const inner = [[2097, 1271], [2101, 1340], [2105, 1385], [2116, 1392], [2378, 1392], [2390, 1385], [2395, 1360], [2398, 1310], [2402, 1271]];
  b.side('wirbelSteel', M([...R.GUARD, ...inner.reverse()]), 0.010, 0, { bevel: 0.0007 });
  b.side('wirbelSteel', M(R.TRIGGER), 0.006, 0, { bevel: 0.0008 });
  const [qx, qy0, qy1] = R.SELECTOR;
  b.part('selector', 0, V(qy0), U(qx));
  b.side('wirbelSteel', M([[qx - 7, qy0 - 4], [qx + 8, qy0 - 4], [qx + 9, qy1 - 18], [qx + 5, qy1], [qx - 5, qy1], [qx - 8, qy1 - 18]]), 0.004, 0, { bevel: 0.0005, part: 'selector' });
  b.box('wirbelSteel', 0.007, 0.0035, 0.0045, 0, V(qy1) + 0.0016, U(qx), { part: 'selector', c: 0.0008 });
  // Hintere Riemenöse links am Kolben: Platte mit zwei Schrauben und zwei Schlitzen
  const [p0, p1, q0, q1] = R.SLING_PLATE, pu = U((p0 + p1) / 2), pv = V((q0 + q1) / 2), xs = -hwStock(pu) - 0.0004;
  b.box('wirbelSteel', 0.0016, (q1 - q0) / R.PPM, (p1 - p0) / R.PPM, xs, pv, pu, { r: 0.0007 });
  for (const s of [-1, 1]) {
    b.box('cavity', 0.0006, 0.013, 0.0042, xs - 0.0008, pv, pu + s * 0.004, { c: 0 });
    b.screw('wirbelSteel', xs - 0.0006, pv, pu + s * 0.0155, 'x', 0.0022);
  }
}

// ---------------------------------------------------------------- Verschluss (offen: Ruhelage hinten) mit Spannhebel
function bolt(b) {
  b.part('bolt', 0, AX, U_BOLT);
  if (b.hi) {
    b.cyl('wirbelBolt', 0.0142, 0.0142, BOLT_L, 0, AX, U_BOLT - BOLT_L / 2, { part: 'bolt', seg: b.lite ? 16 : 24 });
    b.cyl('steelDark', 0.0055, 0.0055, 0.0012, 0, AX - 0.002, U_BOLT + 0.0004, { part: 'bolt', seg: 14 });   // Stoßboden
    if (b.max) b.box('wirbelBolt', 0.003, 0.0035, 0.012, 0.0085, AX + 0.006, U_BOLT - 0.004, { part: 'bolt', c: 0.0005 });   // Auszieher
  }
  // Spannhebel rechts: Steg durch den Schlitz, Knauf mit Sicherungsschieber
  const cu = U(R.CHARGE.x), cv = V(R.CHARGE.y);
  b.box('wirbelBolt', 0.009, 0.0058, 0.0085, RO + 0.0015, cv, cu, { part: 'bolt', c: 0.0008 });
  b.box('wirbelSteel', 0.0125, 0.0092, 0.0118, RO + 0.0105, cv, cu, { part: 'bolt', r: 0.0022 });
  if (b.hi) b.box('wirbelBolt', 0.006, 0.0022, 0.0062, RO + 0.0105, cv + 0.0052, cu + 0.0012, { part: 'bolt', c: 0.0005 });
}

// ---------------------------------------------------------------- Trommel (Achse parallel zum Lauf) mit Hals und Patronen
function drum(b) {
  const top = V(R.ROUND_TOP[1]), uR = U(R.ROUND_TOP[0]);
  b.part('mag', 0, top, uR);
  const L = DRUM_L, r = DRUM_R, rib1 = (R.DRUM.x1 - R.DRUM.ribs[1]) / R.PPM, rib2 = (R.DRUM.x1 - R.DRUM.ribs[0]) / R.PPM, lid = (R.DRUM.x1 - R.DRUM.lid) / R.PPM;
  if (b.hi) {
    const rib = (d) => [[d - 0.0016, r], [d - 0.0008, r + 0.0011], [d + 0.0008, r + 0.0011], [d + 0.0016, r]];
    const prof = [[0.0012, 0], [0.0012, 0.0115], [0, 0.0145], [0, 0.046], [0.0007, 0.049], [0.0007, 0.058], [0, 0.061], [0, 0.0705],
      [0.0016, r], ...rib(rib1), ...rib(rib2), [lid - 0.0004, r], [lid, r + 0.0011], [L - 0.008, r + 0.0011], [L - 0.004, r - 0.001], [L - 0.0012, r - 0.0045], [L, r - 0.009],
      [L, 0.062], [L - 0.0008, 0.063], [L - 0.0008, 0.051], [L, 0.048], [L, 0.0165], [L + 0.0012, 0.0135], [L + 0.0012, 0]];
    b.lathe('wirbelDrum', prof, 0, DRUM_V, DRUM_U0, { part: 'mag', seg: b.max ? 72 : b.lite ? 36 : 54 });
    // Aufziehknopf vorn (Achse), Riegel links am Deckel, Haltelasche oben
    b.cyl('wirbelSteel', 0.0085, 0.0085, 0.0024, 0, DRUM_V, DRUM_U0 + L + 0.0024, { part: 'mag', seg: 20 });
    b.box('wirbelSteel', 0.003, 0.016, 0.0035, 0, DRUM_V, DRUM_U0 + L + 0.0045, { part: 'mag', c: 0.0008 });
    // Deckelriegel links am Rand (im Foto bei x 1520 … 1567 innerhalb des Umrisses)
    b.box('wirbelSteel', 0.004, 0.022, 0.012, -r + 0.0008, V(R.DRUM.latch[1]), U(1545), { part: 'mag', r: 0.0012 });
    b.box('wirbelSteel', 0.012, 0.004, 0.012, 0, DRUM_V + r + 0.0006, U(1697), { part: 'mag', c: 0.0008 });
  } else b._push(new THREE.CylinderGeometry(r, r, L, 12).rotateX(-Math.PI / 2), 'wirbelDrum', { part: 'mag', x: 0, v: DRUM_V, u: DRUM_U0 + L / 2 });   // Bots: 12-Eck statt 6-Eck (cyl begrenzt)
  // Hals (Zuführung) bis an die Lippen
  const [n0, n1] = R.DRUM.neck, nh = top + 0.004 - (DRUM_V + r - 0.012);
  b.box('wirbelDrum', 0.019, nh, (n1 - n0) / R.PPM, 0, DRUM_V + r - 0.012 + nh / 2, U((n0 + n1) / 2), { part: 'mag', c: 0.0012 });
  if (b.hi) for (const s of [-1, 1]) b.box('wirbelSteel', 0.0016, 0.004, 0.03, s * 0.0058, top + 0.002, uR, { part: 'mag', c: 0.0003 });   // Lippen
  // Patronen (7,62 × 25): zwei im Hals sichtbar (Trommel undurchsichtig), liegen längs zur Waffe
  magRounds(b, { cal: 'p762t', width: 0.0105, follower: false, stagger: false, show: 2, pitch: 0.0099, path: [[0, top - 0.0049, uR], [0, top - 0.045, uR]] });
}

// ---------------------------------------------------------------- Bot-Stufe (≤ 600 Dreiecke): Fotoumrisse vereinfacht
function botStage(b) {
  const sp = (pts, tol = 0.004) => simplifyRing(M(pts), tol);
  b.side('wirbelWood', sp(R.STOCK, 0.0025), 0.038, 0, {});
  b.side('wirbelSteel', sp(R.HOUSING), 0.034, 0, {});
  b.side('wirbelSteel', sp(R.CAP), 0.038, 0, {});
  const uF = U_FRONT(AX), uE = U(R.CAP[0][0]);
  b._push(new THREE.CylinderGeometry(RO, RO, uF - uE, 8).rotateX(-Math.PI / 2), 'wirbelMantel', { x: 0, v: AX, u: (uF + uE) / 2 });
  b.side('wirbelSteel', sp([...R.GUARD, [2402, 1279], [2398, 1310], [2390, 1385], [2116, 1392], [2101, 1340], [2097, 1279]], 0.003), 0.01, 0, {});
  b.side('wirbelSteel', sp([...R.FS_BASE.slice(1, 3), [555, 942]], 0.002), 0.009, 0, {});
  b.side('wirbelSteel', sp(R.RS_BODY, 0.003), 0.014, 0, {});
}
