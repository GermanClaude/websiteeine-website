// AK-Baukasten (25.10.2026, gemeinsamer Baukasten G3 – zuerst für die KV-47/AKM, danach KV-74U, LM-8/RPK, Uhu/VSS,
// Hagel/Saiga). Jede Baugruppe liest ihre Maße aus einem Ref-Modul (Fotopixel + Kalibrierung, Namen wie in
// kv47-ref.js) und legt die Teile in den Builder: gestanztes U-Gehäuse mit Nieten und Prägungen, gewölbter Deckel mit
// Querrippen, Sicherungshebel (Teil selector), Verschlussträger mit Ladehebel (Teil bolt), Tangentenvisier, Gasrohr mit
// oberem Handschutz, unterer Handschutz mit Griffmulden, Lauf, Gasblock, Kornträger mit Haube, Schrägmündungsbremse,
// Holzschaft mit Kappe, Pressstoffgriff, Abzugsgruppe und Stahlmagazin mit Rippen (Teil mag).
// Kontext K = akKit(b, R, { mat, uv }): mat = Materialschlüssel { rec, steel, wood, mag, bcg }, uv = Atlas-Abbildungen
// { rec, wood } (Fotopixel → Atlas der jeweiligen Waffe). Teure Netze liegen in geteilten Blöcken (Bauteil-Cache).
// Koordinaten wie im Bauplan: x quer (rechts +), v hoch, u nach vorn (Meter).
import * as THREE from 'three';
import { sdPolygon, extrudeRound, smin, simplifyPoly } from './sdf.js';
import { STEEL, POLY, field2, sdfMesh, sideFurn, roundMax, segDist, atlasUV } from './sdfkit.js';
import { shapeFrom } from './builder.js';
import { magRounds } from './magfill.js';
import { muzzleDevice } from './parts.js';

const WOOD = { r: 0.0016, edge: 0.4, cavity: 0.55 };      // Lackholz: Kanten abgegriffen, Kehlen dunkel
// Netzweiten der Distanzfeld-Teile: [Standard-Raster (m), Faktor PC hoch/ultra, Faktor Handy] – abgestimmt auf die
// Budgets (waffen-bauanleitung 3.4: Langwaffe max ≤ 250 000, Standard ≤ 90 000, lite ≤ 45 000 Dreiecke). Große, glatte
// Holzflächen grob, kleine Stahlteile mit Kanten (Korn, Bremse, Ladehebel) fein; das Visier liegt im Anschlag nah am Auge.
const NET = {
  schaft: [0.0027, 0.66, 1.62], griff: [0.002, 0.64, 1.5], handschutz: [0.0024, 0.64, 1.6], deckel: [0.0021, 0.57, 1.45],
  kimme: [0.0017, 0.62, 1.4], korn: [0.0014, 0.63, 1.4], gasblock: [0.0017, 0.58, 1.45], bremse: [0.0012, 0.6, 1.4], ladehebel: [0.0009, 0.67, 1.3],
};
const net = (k, o) => ({ ...o, fine: NET[k][1], lite: NET[k][2] });

/** Kontext einer AK-Waffe. o: { mat, uv, hwR (halbe Gehäusebreite) } */
export function akKit(b, R, o) {
  const P = R.PPM;
  return { b, R, U: R.U, V: R.V, M: R.M, AX: R.AXIS, px: (n) => n / P, mat: o.mat, uv: o.uv, hwR: o.hwR ?? 0.0147, rk: b.max ? 0.55 : 1 };
}

// ---------------------------------------------------------------- Extrusion mit Atlas-UVs und Kantenabrieb
// Kantenabrieb wie Builder-Extrusionen (Fasen zwischen Deckel und Wand = Abrieb), für eigene Geometrie mit Atlas
function extrudeWear(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const p = g.attributes.position.array, n = p.length / 3, wd = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const i = t * 3, ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2], bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz) || 1, k = Math.abs(nz / l);
    const w = k > 0.12 && k < 0.96 ? 1 : 0;
    for (let q = 0; q < 3; q++) wd[(t + q) * 2] = w;
  }
  g.setAttribute('wearDirt', new THREE.BufferAttribute(wd, 2));
  return g;
}
/** Querschnitt [[x, v], …] entlang u extrudiert (von u0 bis u0 + l) mit Atlas-UVs uv(x, v, u, nx, ny, nz). */
export function frontAtlas(b, mat, pts, l, u0, uv, o = {}) {
  const geo = b._extrude(shapeFrom(pts, b.hi ? (o.holes || []) : []), l, o.bevel ?? 0, o);
  const bev = b.hi && (o.bevel ?? 0) > 0 ? Math.min(o.bevel, l * 0.45) : 0;
  geo.translate(0, 0, -(l - bev));
  const g = b.max ? extrudeWear(geo) : geo;
  return b._push(uv ? atlasUV(g, (x, v, uu, nx, ny, nz) => uv(x, v, uu + u0, nx, ny, nz)) : g, mat, { part: o.part, u: u0 }, !!uv);
}
/** Seitenprofil [[u, v], …] quer extrudiert (Breite w um x) mit Atlas-UVs. */
export function sideAtlas(b, mat, pts, w, x, uv, o = {}) {
  const geo = b._extrude(shapeFrom(pts, b.hi ? (o.holes || []) : []), w, o.bevel ?? 0.0008, o);
  const bev = b.hi && (o.bevel ?? 0.0008) > 0 ? Math.min(o.bevel ?? 0.0008, w * 0.45) : 0;
  geo.translate(0, 0, -(w - 2 * bev) / 2);
  const g0 = b.max ? extrudeWear(geo) : geo;
  g0.rotateY(Math.PI / 2);
  return b._push(uv ? atlasUV(g0, (xx, v, u, nx, ny, nz) => uv(xx + x, v, u, nx, ny, nz)) : g0, mat, { part: o.part, x }, !!uv);
}
const arc = (cx, cv, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cv + Math.sin(a) * r]; });
const dome = (r, h) => [[0, 0], [0, r], [h * 0.35, r * 0.94], [h * 0.75, r * 0.62], [h, 0]];
/** Fotoumriss glätten (Pixeltreppen der Kontursuche zeichneten sich auf gerundeten Distanzfeld-Flächen als Riefen ab):
 *  gleichmäßig neu abtasten, gleitend gewichtet mitteln (± win Punkte), wieder ausdünnen. Modellmaße (Meter). */
export function smoothPoly(pts, step = 0.0005, win = 3, tol = 0.00006) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n], k = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < k; j++) out.push([ax + (bx - ax) * j / k, ay + (by - ay) * j / k]);
  }
  const m = out.length;
  const sm = out.map((_, i) => {
    let x = 0, y = 0, w = 0;
    for (let d = -win; d <= win; d++) { const q = out[(i + d + m) % m], g = win + 1 - Math.abs(d); x += q[0] * g; y += q[1] * g; w += g; }
    return [x / w, y / w];
  });
  return simplifyPoly(sm, tol);
}
// Waagrechte Schnittpunkte eines Polygons in Höhe v → [min u, max u] (Hinter-/Vorderkante, z. B. Magazin)
function spanAt(poly, v) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ua, va] = poly[i], [ub, vb] = poly[j];
    if ((va > v) === (vb > v)) continue;
    const u = ua + (v - va) / (vb - va) * (ub - ua);
    lo = Math.min(lo, u); hi = Math.max(hi, u);
  }
  return [lo, hi];
}

// ---------------------------------------------------------------- Gehäuse (gestanzter U-Kanal), Nieten, Stifte
/** Gehäuse: U-Querschnitt aus 1,1-mm-Blech mit gebogener Unterkante, offen über dem Magazinschacht, rechts unter dem
 *  Auswurffenster niedriger; Verschlussstücke vorn/hinten; Nieten und Stiftköpfe beidseitig. */
export function akReceiver(K) {
  const { b, R, U, V, px, hwR, mat, uv } = K, t = 0.0011, rb = 0.0024;
  const vTop = V(R.REC.top), vBot = V(R.REC.bottom), vPort = V(R.PORT[3]);
  const Usec = (topR) => [
    [-hwR, vTop], ...arc(-hwR + rb, vBot + rb, rb, Math.PI, Math.PI * 1.5, 4), ...arc(hwR - rb, vBot + rb, rb, Math.PI * 1.5, Math.PI * 2, 4), [hwR, topR],
    [hwR - t, topR], ...arc(hwR - rb, vBot + rb, rb - t, 0, -Math.PI / 2, 4).slice(0), ...arc(-hwR + rb, vBot + rb, rb - t, -Math.PI / 2, -Math.PI, 4), [-hwR + t, vTop],
  ];
  const wall = (s, topW) => s < 0 ? [[-hwR, vTop], [-hwR, vBot + 0.0006], [-hwR + t, vBot + 0.0006], [-hwR + t, vTop]] : [[hwR - t, topW], [hwR - t, vBot + 0.0006], [hwR, vBot + 0.0006], [hwR, topW]];
  const seg = (x0, x1, f) => [U(x0), U(x1) - U(x0), f];
  const pieces = [
    seg(R.REC.x0, R.REC.wellX0, () => [Usec(vTop)]),
    seg(R.REC.wellX0, R.PORT[0], () => [wall(-1, vTop), wall(1, vTop)]),
    seg(R.PORT[0], R.REC.wellX1, () => [wall(-1, vTop), wall(1, vPort)]),
    seg(R.REC.wellX1, R.PORT[2], () => [Usec(vPort)]),
    seg(R.PORT[2], R.REC.x1, () => [Usec(vTop)]),
  ];
  for (const [u0, l, f] of pieces) for (const sec of f()) frontAtlas(b, mat.rec, sec, l, u0, uv.rec, { bevel: 0 });
  // Verschlussstücke (innen, Stirnflächen sichtbar): hinten am Schaft, vorn am Handschutz; dunkler Innenraum über dem Schacht
  b.box(mat.steel, 2 * (hwR - t), vTop - vBot - 0.002, 0.012, 0, (vTop + vBot) / 2 + 0.001, U(R.REC.x0) + 0.006, { c: 0.0006 });
  b.box(mat.steel, 2 * (hwR - t), vTop - vBot - 0.002, U(R.REC.x1) - U(R.PORT[2]) - 0.002, 0, (vTop + vBot) / 2 + 0.001, (U(R.REC.x1) + U(R.PORT[2])) / 2, { c: 0.0006 });
  if (b.hi) b.box('cavity', 2 * (hwR - t) - 0.001, vTop - V(1068), U(R.REC.wellX1) - U(R.REC.wellX0), 0, (vTop + V(1068)) / 2, (U(R.REC.wellX0) + U(R.REC.wellX1)) / 2, { c: 0 });
  if (!b.hi) return;
  // Nieten (gewölbt) und Stiftköpfe beidseitig
  const head = (x, y, r, side, h = 0.0012, m = mat.rec) => b.lathe(m, dome(px(r), h), side * hwR, V(y), U(x), { axis: 'x', ry: side > 0 ? 0 : Math.PI, seg: b.max ? 16 : 10 });
  for (const [x, y, r] of R.RIVETS_R) head(x, y, r, 1);
  for (const [x2, y2, r] of R.RIVETS_L) { const [x, y] = R.L2R(x2, y2); head(x, y, r * 0.963, -1); }
  for (const [x, y, r] of R.PINS_R) head(x, y, r, 1, 0.0005, mat.steel);
  for (const [x2, y2, r] of R.XPINS_L) { const [x, y] = R.L2R(x2, y2); head(x, y, Math.min(r, 13) * 0.963, -1, 0.0006, mat.steel); }
  if (b.max) {
    // Ovale Magazinführung als erhabenes Kissen (die Rille drumherum liegt im Atlas), beidseitig
    const pad = (x0, y0, x1, y1, side) => {
      const r = px(y1 - y0) / 2 - 0.0012, cu = U((x0 + x1) / 2), cv = V((y0 + y1) / 2), hu = px(x1 - x0) / 2 - 0.0012;
      const pts = [...arc(cu + hu - r, cv, r, -Math.PI / 2, Math.PI / 2, 6), ...arc(cu - hu + r, cv, r, Math.PI / 2, Math.PI * 1.5, 6)];
      sideAtlas(b, mat.rec, pts, 0.0014, side * (hwR - 0.0002), uv.rec, { bevel: 0.0005 });
    };
    const [a0, b0] = R.L2R(R.MAG_GUIDE_L[2], R.MAG_GUIDE_L[1]), [a1, b1] = R.L2R(R.MAG_GUIDE_L[0], R.MAG_GUIDE_L[3]);
    pad(...R.MAG_GUIDE, 1); pad(a0, b0, a1, b1, -1);
  }
}

// ---------------------------------------------------------------- Deckel (Distanzfeld)
/** Deckel: gewölbt (Radius 24 mm), Querrippen oben, Längssicke an beiden Seiten; Unterkante je Seite eigen (rechts
 *  Stufen am Sicherungshebel und über dem Auswurffenster, links gerade). Massiv statt Blechschale: die 1-mm-Wand riss
 *  im groben Raster (Standard/Handy) auf, und von außen sieht man nur die Hülle. */
export function akDustCover(K) {
  const { b, R, U, V, hwR, mat, uv, rk } = K;
  const hwC = hwR + 0.0012, vTop = V(R.DC_TOP), Rd = 0.024, cv = vTop - Rd;
  b.shared('deckel', () => {
    const prof = (x1, edge) => R.M([...R.DC_REAR, [x1, R.DC_TOP], ...edge.slice().reverse().slice(0, -1)]);
    const dR = field2(prof(R.DC_X1, R.DC_EDGE), [], 0.0005), dL = field2(prof(R.DC_X1_L, R.DC_EDGE_L), [], 0.0005);
    const ribs = R.DC_TOP_RIBS.map(U), rr = R.DC_RIB_W / R.PPM / 2;
    const ribR = R.DC_RIB.map(([x, y]) => [U(x), V(y)]), ribL = R.DC_RIB_L.map(([x, y]) => { const [a, c] = R.L2R(x, y); return [U(a), V(c)]; });
    const f = (x, v, u) => {
      const d2 = x >= 0 ? dR(u, v) : dL(u, v);
      if (d2 > 0.006) return d2;
      const ax = Math.abs(x);
      let d = extrudeRound(d2, x, hwC, 0.0011 * rk);
      d = roundMax(d, Math.hypot(x, v - cv) - Rd, 0.0016);
      // Querrippen (Sicken quer über den Rücken, ≈ 3,6 mm breit, 0,5 mm hoch)
      if (v > vTop - 0.008) for (const ru of ribs) if (Math.abs(u - ru) < 0.006) {
        const top = cv + Math.sqrt(Math.max(0, Rd * Rd - x * x));
        d = smin(d, Math.max(Math.hypot(u - ru, v - (top - 0.0013)) - rr, ax - (hwC - 0.0028)), 0.0012);
      }
      // Längssicken (Wulst an der Seitenwand)
      for (const [rib, s] of [[ribR, 1], [ribL, -1]]) {
        if (s * x < hwC - 0.003) continue;
        const dl = segDist(u, v, rib[0][0], rib[0][1], rib[1][0], rib[1][1]);
        if (dl < 0.004) d = smin(d, Math.hypot(dl, x - s * (hwC - 0.0006)) - 0.0012, 0.001);
      }
      return d;
    };
    sdfMesh(b, f, [-(hwC + 0.003), V(R.DC_EDGE[0][1]) - 0.003, U(R.DC_REAR[0][0]) - 0.003], [hwC + 0.003, vTop + 0.003, U(R.DC_X1_L) + 0.003], NET.deckel[0], mat.rec, net('deckel', { uv: uv.rec, cav: STEEL }));
  });
  // Knopf der Schließfederführung (ragt hinten durch den Deckel)
  const [sx0, sy0, sx1, sy1] = R.SPRING_BUTTON;
  b.box(mat.steel, 0.009, K.px(sy1 - sy0), K.px(sx1 - sx0) + 0.004, 0, V((sy0 + sy1) / 2), U((sx0 + sx1) / 2) + 0.002, { c: 0.0012 });
}

// ---------------------------------------------------------------- Sicherungshebel (Teil selector)
/** Sicherungs-/Wahlhebel rechts: Nabe mit Achsniet, Arm (2-mm-Blech), Daumenlasche mit Riffelung. Gebaut in Stellung
 *  SICHER (wie im Foto); das Viewmodel dreht ihn um die Querachse auf DAUER bzw. EINZEL (meta.selector). */
export function akSafety(K) {
  const { b, R, U, V, px, hwR, mat } = K;
  const [hx, hy, hr] = R.LEVER_HUB, pu = U(hx), pv = V(hy), P = { part: 'selector' };
  b.part('selector', hwR + 0.0012, pv, pu);
  b.side(mat.steel, R.M(R.LEVER), 0.0019, hwR + 0.0013, { ...P, bevel: 0.0005 });
  if (!b.hi) return;
  b.lathe(mat.steel, [[0, 0], [0, px(hr)], [0.0012, px(hr) * 0.98], [0.0021, px(hr) * 0.86], [0.0023, 0]], hwR + 0.0002, pv, pu, { ...P, axis: 'x', seg: b.max ? 24 : 14 });
  b.lathe(mat.steel, dome(px(R.LEVER_AXLE_R), 0.0016), hwR + 0.0024, pv, pu, { ...P, axis: 'x', seg: b.max ? 18 : 10 });
  // Daumenleiste: Unterkante der Platte nach außen abgekantet, quer geriffelt; Bohrung in der Sperrplatte
  const [[ex0, ey0], [ex1, ey1]] = R.LEVER_EDGE, ang = Math.atan2(ey0 - ey1, ex1 - ex0), len = px(Math.hypot(ex1 - ex0, ey1 - ey0));
  const xo = hwR + 0.0013 + 0.00095, xe = xo + 0.0012;
  b.box(mat.steel, 0.0024, 0.0017, len, xe, V((ey0 + ey1) / 2) + 0.0005, U((ex0 + ex1) / 2), { ...P, rx: ang, c: 0.0005 });
  if (b.max) for (let i = 0; i < 12; i++) {
    const t = (i + 0.5) / 12;
    b.box('cavity', 0.0026, 0.0019, 0.00045, xe, V(ey0 + (ey1 - ey0) * t) + 0.0005, U(ex0 + (ex1 - ex0) * t), { ...P, rx: ang, c: 0 });
  }
  const [lx, ly, lr] = R.LEVER_HOLE;
  b.circle('cavity', px(lr), xo + 0.0001, V(ly), U(lx), { ...P, ry: Math.PI / 2, seg: 12 });
}

// ---------------------------------------------------------------- Verschlussträger mit Ladehebel (Teil bolt)
/** Träger im Auswurffenster: unten flache Seite bis zur Stufe (CARRIER_STEP), darüber gewölbte Schultern bis unter die
 *  Deckelkante (im Foto der helle Lichtstreif), Fuge zum Verschluss; Ladehebel als vom Träger nach außen und oben
 *  gebogener Steg mit bohnenförmigem Knopf (von der Seite ein hohes Oval). Hub = Weg des Hebels bis zum Schlitzende.
 *  Anker chargeGrab (Knopf) und boltFace (Verschlussstirn). */
export function akCarrier(K) {
  const { b, R, U, V, px, hwR, mat } = K, P = { part: 'bolt' };
  const w = hwR - 0.0013, vS = V(R.CARRIER_STEP), vb = V(R.PORT[3] + 14), rs = 0.0095;
  const uf = U(R.PORT[2]), ur = U(R.PORT[0]) - 0.03;
  b.part('bolt', 0, (vS + vb) / 2, U(R.CARRIER_SEAM));
  const n = b.hi ? 9 : 3;
  const sec = [[-w, vb], [w, vb], ...arc(w - rs, vS, rs, 0, 1.15, n), ...arc(-(w - rs), vS, rs, Math.PI - 1.15, Math.PI, n)];
  b.front(mat.bcg, sec, uf - ur, ur, { ...P, bevel: b.hi ? 0.0007 : 0 });
  // Verschlusskopf vorn (rund, Laufachse), Kolbenstange zum Gasrohr
  b.cyl(mat.bcg, 0.0093, 0.0093, 0.03, 0, K.AX + 0.002, uf - 0.016, { ...P, seg: b.seg(20, 6) });
  if (b.hi) b.cyl(mat.bcg, 0.0068, 0.0068, 0.1, 0, V(R.GAS_TUBE.y), uf + 0.045, { ...P, seg: 14 });
  // Ladehebel: schräg nach außen, oben und vorn gebogener Steg, Knopf bohnenförmig (von der Seite ein schräges Oval)
  const A = [w - 0.001, V(938), U(2022)], B = [hwR + 0.0125, V(880), U(2047)];
  const dx = B[0] - A[0], dv = B[1] - A[1], du = B[2] - A[2], dd = dx * dx + dv * dv + du * du;
  const lever = (x, v, u) => {
    const t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (v - A[1]) * dv + (u - A[2]) * du) / dd));
    return Math.hypot(x - A[0] - t * dx, v - A[1] - t * dv, u - A[2] - t * du) - (0.0026 + 0.0022 * t * t);
  };
  if (b.hi) b.shared('ladehebel', () => sdfMesh(b, lever, [w - 0.005, V(946), A[2] - 0.005], [hwR + 0.0195, V(862), B[2] + 0.007], NET.ladehebel[0], mat.bcg, net('ladehebel', { part: 'bolt', cav: STEEL })));
  else b.box(mat.bcg, 0.014, V(870) - V(940), 0.007, hwR + 0.006, V(905), U(2034), P);
  if (b.hi) {
    b.box('cavity', 0.0004, 0.0008, uf - ur - 0.004, w + 0.0001, vS, (uf + ur) / 2, { ...P, c: 0 });                  // Stufe/Führungsnut
    b.box('cavity', 0.0004, vS - vb - 0.002, 0.0006, w + 0.0001, (vS + vb) / 2, U(R.CARRIER_SEAM), { ...P, c: 0 });       // Fuge Träger/Verschluss
  }
  b.anchor('chargeGrab', hwR + 0.013, B[1], B[2], { part: 'bolt', data: { travel: [0, 0, px(R.CHARGE.knob[0] - R.CARRIER_STOP_X)], style: 'right' } });
  b.anchor('boltFace', 0.003, V(958), uf, P);
  // Patronenlager dunkel hinter dem Träger (sichtbar, wenn er zurückläuft)
  if (b.hi) b.circle('cavity', 0.0072, 0, K.AX + 0.002, uf + 0.004, { seg: 18 });
}

// ---------------------------------------------------------------- Visier (Tangentenvisier, Kornträger mit Haube)
/** Visierfuß (Distanzfeld), Visierklappe mit Entfernungsmarken, Kimmenblatt mit Kerbe (Visierlinie SIGHT_Y), Schieber mit
 *  gerändelten Knöpfen, Sperrhebel des Gasrohrs rechts. */
export function akRearSight(K) {
  const { b, R, U, V, px, mat, rk } = K, hw = 0.0136;
  if (b.hi) b.shared('kimme', () => {
    const dD = field2(R.M(R.RS_BLOCK), [], 0.0004);
    const f = (x, v, u) => { const d2 = dD(u, v); if (d2 > 0.005) return d2; return extrudeRound(d2, x, hw, 0.0016 * rk); };
    sdfMesh(b, f, [-hw - 0.002, V(R.RS_BLOCK[11][1]) - 0.002, U(R.RS_BLOCK[0][0]) - 0.002], [hw + 0.002, V(R.RS_BLOCK[5][1]) + 0.002, U(R.RS_BLOCK[9][0]) + 0.002], NET.kimme[0], mat.steel, net('kimme', { cav: STEEL }));
  });
  else b.side(mat.steel, simplifyPoly(R.M(R.RS_BLOCK), 0.003), 2 * hw, 0, { bevel: 0.001 });
  const [lx0, ly0, lx1, ly1] = R.RS_LEAF, [bx0, by0, bx1, by1] = R.RS_BLADE, vS = V(R.SIGHT_Y);
  b.box(mat.steel, 0.0168, px(ly1 - ly0), px(lx1 - lx0), 0, V((ly0 + ly1) / 2), U((lx0 + lx1) / 2), { c: 0.0006 });
  // Kimmenblatt: zwei Wangen + Steg unter der Kerbe (Kerbe 2 mm breit bis zur Visierlinie)
  const bu = U((bx0 + bx1) / 2), bl = px(bx1 - bx0), bTop = V(by0), bBot = V(by1);
  for (const s of [-1, 1]) b.box(mat.steel, 0.0068, bTop - bBot, bl, s * 0.0044, (bTop + bBot) / 2, bu, { c: 0.0005 });
  b.box(mat.steel, 0.0022, vS - bBot, bl, 0, (vS + bBot) / 2, bu, { c: 0.0002 });
  const [sx0, sy0, sx1, sy1] = R.RS_SLIDER;
  b.box(mat.steel, 0.019, px(sy1 - sy0), px(sx1 - sx0), 0, V((sy0 + sy1) / 2), U((sx0 + sx1) / 2), { c: 0.001 });
  if (!b.hi) return;
  const [kx, ky, kr] = R.RS_KNOB;
  for (const s of [-1, 1]) {
    b.cyl(mat.steel, px(kr), px(kr), 0.0034, s * 0.0112, V(ky), U(kx), { axis: 'x', seg: b.max ? 20 : 12 });
    if (b.max) for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; b.box('cavity', 0.0036, 0.0005, 0.0004, s * 0.0112, V(ky) + Math.sin(a) * px(kr), U(kx) + Math.cos(a) * px(kr), { rx: -a, c: 0 }); }
  }
  if (b.max) for (let i = 0; i < 10; i++) b.box('cavity', 0.011, 0.0003, 0.0005, 0, V(ly0) + 0.00005, U(lx0 + 42 + i * 13), { c: 0 });   // Entfernungsmarken
  // Sperrhebel des Gasrohrs (rechts am Visierfuß): runder Kopf, Arm
  const [hx, hy, hr] = R.RS_LEVER.head;
  b.cyl(mat.steel, px(hr), px(hr), 0.003, hw + 0.0015, V(hy), U(hx), { axis: 'x', seg: b.max ? 22 : 12 });
  b.side(mat.steel, R.M(R.RS_LEVER.arm), 0.0022, hw + 0.0011, { bevel: 0.0005 });
}

/** Kornträger (Distanzfeld): Ring um den Lauf, Turm mit geschlossener Haube (innen hohl, Fenster seitlich), Korn auf der
 *  Höhentrommel, Querstifte. Kornspitze auf der Visierlinie. */
export function akFrontSight(K) {
  const { b, R, U, V, px, AX, mat, rk } = K;
  const vS = V(R.SIGHT_Y), vRing = V(945), uPost = U(R.FS_POST_X);
  if (b.hi) b.shared('korn', () => {
    const dD = field2(R.M(R.FS), [], 0.0004), win = R.M(R.FS_WINDOW);
    const hood = { v0: V(832), v1: V(786) };      // Haube innen hohl zwischen Dach und Höhentrommel (vorn/hinten offen)
    const f = (x, v, u) => {
      const d2 = dD(u, v);
      if (d2 > 0.005) return d2;
      let d = extrudeRound(d2, x, 0.0078, 0.0016 * rk);
      if (v < vRing + 0.003) d = smin(d, roundMax(extrudeRound(d2, x, 0.0112, 0.002 * rk), Math.hypot(x, v - AX) - 0.0114, 0.002), 0.002);
      if (v < hood.v1 && v > hood.v0) d = Math.max(d, -Math.max(Math.abs(x) - 0.0047, v - hood.v1, hood.v0 - v));
      return Math.max(d, -sdPolygon(u, v, win));                                                                    // Fenster (durchgehend)
    };
    sdfMesh(b, f, [-0.0135, V(1052), U(3494)], [0.0135, V(774), U(3624)], NET.korn[0], mat.steel, net('korn', { cav: STEEL }));
  });
  else b.side(mat.steel, simplifyPoly(R.M(R.FS), 0.003), 0.016, 0, { bevel: 0.001 });
  // Korn (Stift auf der Höhentrommel) und Trommel
  b.box(mat.steel, 0.0019, vS - V(834), 0.0019, 0, (vS + V(834)) / 2, uPost, { c: 0.0003 });
  if (!b.hi) return;
  const [dx, dy, dr] = R.FS_DRUM;
  b.cyl(mat.steel, px(dr), px(dr), 0.0104, 0, V(dy), U(dx), { axis: 'x', seg: b.max ? 22 : 12 });
  for (const x of [3530, 3577]) for (const s of [-1, 1]) b.lathe(mat.steel, dome(0.0013, 0.0004), s * 0.0112, V(955), U(x), { axis: 'x', ry: s > 0 ? 0 : Math.PI, seg: 10 });
}

// ---------------------------------------------------------------- Lauf, Gasrohr, Gasblock, Putzstock, Mündungsbremse
/** Lauf (zwei Durchmesser), Gasblock mit Bajonetthalter (Distanzfeld), Putzstock; Schrägmündungsbremse. → Mündungsende u */
export function akBarrel(K) {
  const { b, R, U, V, px, AX, mat, rk } = K;
  const bu0 = U(R.REC.x1) - 0.004;
  b.lathe(mat.steel, [[0, R.BARREL[0][1]], ...R.BARREL.map(([x, r]) => [U(x) - bu0, r])], 0, AX, bu0, { seg: b.seg(24, 6) });
  if (b.hi) b.shared('gasblock', () => {
    const dD = field2(R.M(R.GAS_BLOCK), [], 0.0004), vLug = V(1030);
    const f = (x, v, u) => {
      const d2 = dD(u, v);
      if (d2 > 0.006) return d2;
      return v < vLug ? extrudeRound(d2, x, 0.0062, 0.0012) : extrudeRound(d2, x, 0.0118, 0.0062 * Math.min(1, rk + 0.2));
    };
    sdfMesh(b, f, [-0.0135, V(1058), U(2996)], [0.0135, V(842), U(3244)], NET.gasblock[0], mat.steel, net('gasblock', { cav: STEEL }));
  });
  else b.side(mat.steel, simplifyPoly(R.M(R.GAS_BLOCK), 0.003), 0.022, 0, { bevel: 0.002 });
  // Putzstock unter dem Lauf, Kopf am Kornträger
  const { x0, x1, y, r, head } = R.ROD;
  b.cyl(mat.steel, r, r, px(x1 - x0), 0, V(y), U((x0 + x1) / 2), { seg: b.seg(10, 5) });
  if (b.hi) b.cyl(mat.steel, r * 1.5, r * 1.5, px(head[1] - head[0]), 0, V(y), U((head[0] + head[1]) / 2), { seg: 12 });
  // Mündung: Werks-Schrägbremse oder Aufsatz
  const B = R.BRAKE;
  if (b.att && b.att.muendung) return muzzleDevice(b, b.att.muendung, U(B.x0), AX, 0.0112);
  if (b.hi) {
    b.shared('bremse', () => {
      const u0 = U(B.x0), u1 = U(B.x1), [ax, ay] = B.cutTop, [bx, by] = B.cutTip, Au = U(ax), Av = V(ay), Bu = U(bx), Bv = V(by);
      const lu = Bu - Au, lv = Bv - Av, ll = Math.hypot(lu, lv), ring = U(B.ring[1]);
      const f = (x, v, u) => {
        const rr = Math.hypot(x, v - AX);
        const rad = u < ring ? B.r + 0.0006 : B.r;
        let d = roundMax(rr - rad, Math.max(u0 - u, u - u1), 0.0008);
        if (u > ring - 0.0006 && u < ring + 0.0006) d = Math.max(d, -(Math.abs(u - ring) - 0.0004 + Math.max(0, rad - 0.0004 - rr)));   // Fuge am Bund
        d = Math.max(d, ((u - Au) * lv - (v - Av) * lu) / ll * -1);              // Schrägschnitt oben vorn
        return Math.max(d, -(rr - 0.0044));                                        // Bohrung
      };
      sdfMesh(b, f, [-0.011, AX - 0.011, u0 - 0.002], [0.011, AX + 0.011, u1 + 0.002], NET.bremse[0], mat.steel, net('bremse', { cav: STEEL }));
    });
    b.bore(0.0039, 0, AX, U(R.BARREL[R.BARREL.length - 1][0]) + 0.0005, { seg: 24 });
  } else b.cyl(mat.steel, B.r, B.r, U(B.x1) - U(B.x0), 0, AX, (U(B.x0) + U(B.x1)) / 2, { seg: 6 });
  return U(B.x1);
}

/** Gasrohr mit Längsrillen vorn, Endkappe hinten, Ring vorn; oberer Handschutz (Holz, Kreisbogen mit flacher Unterseite). */
export function akGasTube(K) {
  const { b, R, U, V, px, mat, uv } = K, G = R.GAS_TUBE, vT = V(G.y), r = G.r;
  const u0 = U(G.capX[1]), u1 = U(G.x1);
  b.lathe(mat.steel, [[0, r], [u1 - u0 - 0.004, r], [u1 - u0, r * 0.94]], 0, vT, u0, { seg: b.seg(24, 6) });
  b.lathe(mat.steel, [[0, 0.006], [0, 0.0112], [0.0015, 0.0119], [px(G.capX[1] - G.capX[0]) - 0.001, 0.0119], [px(G.capX[1] - G.capX[0]), 0.0105]], 0, vT, U(G.capX[0]), { seg: b.seg(24, 6) });
  const [fr0, fr1] = R.HG_FERRULE;
  b.lathe(mat.steel, [[0, 0.0104], [0, 0.0118], [px(fr1 - fr0), 0.0118], [px(fr1 - fr0), 0.0104]], 0, vT, U(fr0), { seg: b.seg(24, 6) });
  if (b.hi) {
    const [ra, rb] = G.ribs, l = px(rb - ra) - 0.006;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; b.box('cavity', 0.0004, 0.0024, l, Math.cos(a) * (r - 0.00005), vT + Math.sin(a) * (r - 0.00005), U((ra + rb) / 2), { rz: a, c: 0 }); }
  }
  // Oberer Handschutz: Querschnitt Kreisbogen (r = Oberkante über der Rohrachse), unten flach (Spalt zum unteren
  // Handschutz wie im Foto), innen Kanal für das Gasrohr
  const ro = V(Math.min(...R.HG_UP.map((p) => p[1]))) - vT, cut = V(907) - vT, ri = r + 0.0008;
  const a0 = Math.asin(Math.max(-1, cut / ro)), ai = Math.asin(Math.max(-1, cut / ri)), n = b.hi ? 28 : 8;
  const outer = arc(0, vT, ro, a0, Math.PI - a0, n), inner = arc(0, vT, ri, Math.PI - ai, ai, Math.max(6, n >> 1));
  const hx0 = Math.min(...R.HG_UP.map((p) => p[0])), hx1 = Math.max(...R.HG_UP.map((p) => p[0]));
  frontAtlas(b, mat.wood, [...outer, ...inner], px(hx1 - hx0), U(hx0), uv.wood, { bevel: b.hi ? 0.0022 : 0, bevelSeg: 3, curveSeg: 1 });
}

/** Unterer Handschutz (Distanzfeld): Fotoumriss, Griffmulden (breiter unterhalb der Kante), gerundete Kanten;
 *  vorderer Halter (Blechband) mit Riemenbügel. */
export function akLowerHandguard(K) {
  const { b, R, U, V, px, AX, mat, uv } = K;
  const ss = (a, c, t) => { const k = Math.max(0, Math.min(1, (t - a) / (c - a))); return k * k * (3 - 2 * k); };
  if (b.hi) b.shared('handschutz', () => {
    const dD = field2(smoothPoly(R.M(R.HG_LOW)), [], 0.0005);
    const vS0 = V(982), vS1 = V(1006), uA = U(2245), uB = U(2295), uC = U(2560), uD = U(2615);
    const f = (x, v, u) => {
      const d2 = dD(u, v);
      if (d2 > 0.007) return d2;
      const swell = ss(vS0, vS1, v) * ss(uA, uB, u) * (1 - ss(uC, uD, u));
      return extrudeRound(d2, x, 0.0186 + 0.0034 * swell, 0.0042);
    };
    sdfMesh(b, f, [-0.025, V(1130), U(2128)], [0.025, V(905), U(2798)], NET.handschutz[0], mat.wood, net('handschutz', { uv: uv.wood, cav: WOOD }));
  });
  else b.side(mat.wood, simplifyPoly(R.M(R.HG_LOW), 0.004), 0.04, 0, { bevel: 0.004 });
  // Vorderer Halter: Blechband um das Ende, unten Riemenbügel
  const [f0, f1] = R.HG_FERRULE, fv0 = V(1068), fv1 = V(912), hw = 0.0198;
  b.front(mat.steel, [[-hw, fv0 + 0.004], [-hw + 0.004, fv0], [hw - 0.004, fv0], [hw, fv0 + 0.004], [hw, fv1], [-hw, fv1]], px(f1 - f0), U(f0), { holes: [arc(0, AX, 0.0089, 0, Math.PI * 2, 16)], bevel: 0.0005 });
  if (b.hi) {
    const [sx, sy] = R.HG_FRONT_SWIVEL;
    b.torus(mat.steel, 0.0058, 0.0011, 0, V(sy), U(sx), { ry: Math.PI / 2, rx: 0.35, seg: 6, tseg: 18 });
  }
}

// ---------------------------------------------------------------- Schaft, Griff
/** Holzschaft (Distanzfeld, wird zur Kappe hin breiter), Schaftkappe aus Stahl mit Klappe, Riemenbügel unten. */
export function akStock(K) {
  const { b, R, U, V, px, mat, uv } = K;
  const uF = U(R.REC.x0), uB = U(R.BUTTPLATE[1]);
  if (b.hi) b.shared('schaft', () => {
    const dD = field2(smoothPoly(R.M(R.STOCK)), [], 0.0006);
    const f = (x, v, u) => {
      const d2 = dD(u, v);
      if (d2 > 0.008) return d2;
      const k = Math.max(0, Math.min(1, (uF - u) / (uF - uB)));
      return extrudeRound(d2, x, 0.0148 + 0.0067 * k, 0.0058);
    };
    sdfMesh(b, f, [-0.025, V(1408), U(R.BUTTPLATE[1] - 4)], [0.025, V(955), U(R.REC.x0 + 6)], NET.schaft[0], mat.wood, net('schaft', { uv: uv.wood, cav: WOOD }));
  });
  else b.side(mat.wood, simplifyPoly(R.M(R.STOCK), 0.005), 0.036, 0, { bevel: 0.004 });
  // Schaftkappe: Stahlplatte der Kontur des Schaftendes folgend, Klappe (Zubehörfach) hinten
  const sp = R.STOCK.filter(([x]) => x < R.BUTTPLATE[1] + 14), ys = sp.map((p) => p[1]), yt = Math.min(...ys), yb = Math.max(...ys);
  const plate = [[R.BUTTPLATE[1], yt + 2], [R.BUTTPLATE[1], yb - 2], [R.BUTTPLATE[0] + 8, yb - 1], [R.BUTTPLATE[0] + 1, yb - 14], [R.BUTTPLATE[0], (yt + yb) / 2], [R.BUTTPLATE[0] + 2, yt + 16], [R.BUTTPLATE[0] + 9, yt + 3]];
  b.side(mat.steel, R.M(plate), 0.0436, 0, { bevel: 0.0024, bevelSeg: 2 });
  if (b.hi) {
    const ue = U(R.BUTTPLATE[0]) - 0.0001;
    b.box('cavity', 0.026, px(yb - yt) * 0.45, 0.0004, 0, V((yt + yb) / 2 - 20), ue, { c: 0 });          // Fuge der Klappe
    b.box(mat.steel, 0.024, px(yb - yt) * 0.43, 0.0007, 0, V((yt + yb) / 2 - 20), ue - 0.0002, { c: 0.0002 });
    for (const yy of [yt + 30, yb - 30]) b.lathe(mat.steel, dome(0.0032, 0.0008), 0, V(yy), ue, { ry: Math.PI, seg: 12 });
    // Riemenbügel am Schaftunterteil: Platte mit zwei Schrauben, Bügel
    const [[ax, ay], [bx, by]] = R.STOCK_SWIVEL, ang = Math.atan2(by - ay, bx - ax) * -1;
    b.box(mat.steel, 0.012, 0.0022, px(bx - ax) * 0.75, 0, V((ay + by) / 2) + 0.0006, U((ax + bx) / 2 + 15), { rx: ang, c: 0.0006 });
    b.torus(mat.steel, 0.0085, 0.0012, 0, V(ay) - 0.004, U(ax + 18), { ry: Math.PI / 2, rx: 1.2, seg: 6, tseg: 20 });
  }
}

/** Pistolengriff aus Pressstoff (Distanzfeld, Fischhaut im Atlas). */
export function akGrip(K) {
  const { b, R, U, V, mat, uv } = K;
  if (b.hi) b.shared('griff', () => {
    const dD = field2(smoothPoly(R.M(R.GRIP)), [], 0.0005), vB = V(1540), vT = V(1115);
    const f = (x, v, u) => {
      const d2 = dD(u, v);
      if (d2 > 0.007) return d2;
      const k = Math.max(0, Math.min(1, (vT - v) / (vT - vB)));
      return extrudeRound(d2, x, 0.0146 + 0.0008 * k, 0.0058);
    };
    sdfMesh(b, f, [-0.0175, V(1552), U(1090)], [0.0175, V(1110), U(1392)], NET.griff[0], mat.wood, net('griff', { uv: uv.wood, cav: POLY }));
  });
  else b.side(mat.wood, simplifyPoly(R.M(R.GRIP), 0.004), 0.029, 0, { bevel: 0.004 });
}

// ---------------------------------------------------------------- Abzugsgruppe
/** Abzugsbügel (Blech, ohne Abzug und Magazinhalter aus dem Fotoumriss geschnitten), Abzug, Magazinhalter-Paddel. */
export function akTriggerGroup(K) {
  const { b, R, U, V, M, mat } = K;
  const trig = M(R.TRIGGER), catchP = M(R.MAG_CATCH);
  if (b.hi) {
    const gD = field2(M(R.GUARD_OUT), [], 0.0003), oD = field2(M(R.GUARD_IN), [], 0.0003), uCut = U(R.MAG_CATCH[0][0]), vTop = V(R.REC.bottom) - 0.0004;
    const box = [U(R.GUARD_OUT[0][0]) - 0.002, uCut + 0.002, V(1254) - 0.002, V(R.REC.bottom) + 0.001];
    sideFurn(b, (u, v) => Math.max(gD(u, v), -oD(u, v), u - uCut, v - vTop), box, 0.0052, 0.0008, { mat: mat.steel, step: 0.0004 });
  } else b.side(mat.steel, simplifyPoly(M(R.GUARD), 0.003), 0.01, 0, { bevel: 0.001 });
  b.side(mat.steel, trig, 0.0062, 0, { bevel: 0.0009 });
  b.side(mat.steel, catchP, 0.0165, 0, { bevel: 0.0012 });
  // Bohrung im Magazinhalter (Lagerachse), beidseitig
  if (b.hi) for (const s of [-1, 1]) b.circle('cavity', K.px(10), s * 0.0084, V(1185), U(1645), { ry: s * Math.PI / 2, seg: 14 });
}

// ---------------------------------------------------------------- Magazin (Teil mag)
/** Stahlmagazin: Körper als Profil (gebogen, oben bis in den Schacht verlängert), Längsrippen parallel zur Vorderkante,
 *  dickere Bodenplatte; Patronen an den Lippen (magfill). Drehpunkt an der Schachtmündung. */
export function akMagazine(K, cap = {}) {
  const { b, R, U, V, M, px, mat } = K, hw = 0.0134;
  const [mx, my] = R.MAG_PIVOT;
  b.part('mag', 0, V(my), U(mx));
  const P = { part: 'mag' };
  const mp = smoothPoly(M(R.MAG)), xs = R.MAG.map((p) => p[0]), ys = R.MAG.map((p) => p[1]);
  const yTop = 1068, top = [[R.REC.wellX0 + 4, yTop], [R.REC.wellX1 - 4, yTop], [R.REC.wellX1 - 4, R.REC.bottom + 8], [R.REC.wellX0 + 4, R.REC.bottom + 8]];
  const win = [U(Math.min(...xs)) - 0.004, U(Math.max(...xs)) + 0.004, V(Math.max(...ys)) - 0.004, V(yTop) + 0.003];
  if (b.hi) b.shared('magazin', () => {
    const mD = field2(mp, [], 0.0005), tD = field2(M(top), [], 0.0005);
    const body = (u, v) => Math.min(mD(u, v), tD(u, v)), st = b.lite ? 0.0008 : 0.0005;   // Handy: Kontur gröber
    sideFurn(b, body, win, hw, 0.0016, { ...P, mat: mat.mag, step: st });
    // Rippen: Mittellinien als Anteil zwischen Hinter- und Vorderkante (folgen der Krümmung), oben unter dem Schacht
    // beginnend, unten rund auslaufend; Spannen je Höhe vorgerechnet (Feld wird zeilenweise abgefragt)
    const vTop = V(R.MAG_RIB_TOP), hr = 0.0021, spans = new Map();
    const spanV = (v) => { const k = Math.round(v * 20000); let sp = spans.get(k); if (!sp) { sp = spanAt(mp, k / 20000); spans.set(k, sp); } return sp; };
    const strip = (u, v, ti, vEnd, h) => {
      const [s0, s1] = spanV(v), w = s1 - s0;
      if (!(w > 0)) return 1;
      const qx = Math.abs((u - s0) / w - ti) * w, qy = Math.max(v - vTop, vEnd - v) + h;
      return Math.hypot(qx, Math.max(qy, 0)) - h;                                // Streifen mit runden Enden (Radius h)
    };
    const foot = R.MAG_FOOT_RIBS.map((sg) => sg.map(([x, y]) => [U(x), V(y)]));
    const ribD = (u, v) => {
      let d = Infinity;
      for (const [ti, ye] of R.MAG_RIBS) d = Math.min(d, strip(u, v, ti, V(ye), hr));
      for (const [[au, av], [bu, bv]] of foot) d = Math.min(d, segDist(u, v, au, av, bu, bv) - hr);
      return d;
    };
    sideFurn(b, (u, v) => Math.max(ribD(u, v), mD(u, v) + 0.0016), win, hw + 0.001, 0.0009, { ...P, mat: mat.mag, step: st });
    // Längsnut vor dem vorderen Feld (dunkle Linie knapp über der Seitenfläche)
    if (b.max) sideFurn(b, (u, v) => Math.max(strip(u, v, R.MAG_GROOVE[0], V(R.MAG_GROOVE[1]), 0.0005), mD(u, v) + 0.002), win, hw + 0.00006, 0, { ...P, mat: 'cavity', step: 0.0005 });
    // Bodenplatte: Band an der Unterkante, etwas breiter und überstehend
    const [[fx0, fy0], [fx1, fy1]] = R.MAG_FLOOR, Au = U(fx0), Av = V(fy0), lu = U(fx1) - Au, lv = V(fy1) - Av, ll = Math.hypot(lu, lv);
    const cu = mp.reduce((a, p) => a + p[0], 0) / mp.length, cv = mp.reduce((a, p) => a + p[1], 0) / mp.length;
    const sg = Math.sign((cu - Au) * lv - (cv - Av) * lu) || 1;
    const line = (u, v) => sg * ((u - Au) * lv - (v - Av) * lu) / ll;            // > 0 oberhalb der Bodenlinie (Seite des Schwerpunkts)
    sideFurn(b, (u, v) => Math.max(mD(u, v) - 0.0009, line(u, v) - 0.0062), win, hw + 0.0008, 0.0009, { ...P, mat: mat.mag, step: st * 0.8 });
  });
  else {
    b.side(mat.mag, simplifyPoly(mp, 0.005), 2 * hw, 0, { ...P, bevel: 0.001 });
    b.box(mat.mag, 2 * hw - 0.002, px(R.REC.bottom + 8 - yTop), px(top[1][0] - top[0][0]), 0, V((yTop + R.REC.bottom + 8) / 2), U((top[0][0] + top[1][0]) / 2), P);
  }
  const path = R.MAG_PATH.map(([x, y]) => [0, V(y), U(x)]);
  magRounds(b, { cal: 'r762k', width: 0.0232, depth: 0.056, show: 3, path, ...cap });
  const [gx, gy] = R.MAG_GRAB || [1990, 1400];
  b.anchor('magGrab', 0, V(gy), U(gx), { part: 'mag', data: { w: hw, d: 0.031 } });
}

// ---------------------------------------------------------------- Bot-Stufe (≤ 600 Dreiecke)
/** Bot-Stufe: dieselben Fotoumrisse stark vereinfacht (Seitenprofile/Zylinder), Teile mag/bolt mit gleichen Drehpunkten
 *  und Ankern wie die Ego-Fassung. → Mündungsende u */
export function akBot(K) {
  const { b, R, U, V, M, px, AX, mat } = K, s = (pts, tol) => simplifyPoly(M(pts), tol);
  b.side(mat.rec, s(R.REC_SIL, 0.004), 2 * K.hwR + 0.0018, 0, { bevel: 0.001 });
  b.side(mat.wood, s(R.STOCK, 0.006), 0.036, 0, { bevel: 0.003 });
  b.side(mat.wood, s(R.GRIP, 0.005), 0.029, 0, { bevel: 0.003 });
  b.side(mat.wood, s(R.HG_LOW, 0.006), 0.04, 0, { bevel: 0.003 });
  const G = R.GAS_TUBE, hx0 = Math.min(...R.HG_UP.map((p) => p[0])), hx1 = Math.max(...R.HG_UP.map((p) => p[0]));
  b.box(mat.wood, 0.032, V(820) - V(907), px(hx1 - hx0), 0, (V(907) + V(820)) / 2, U((hx0 + hx1) / 2), {});
  b.cyl(mat.steel, G.r, G.r, px(G.x1 - hx1), 0, V(G.y), U((hx1 + G.x1) / 2), { seg: 5 });
  b.box(mat.steel, 0.027, V(845) - V(905), px(2310 - 2150), 0, (V(845) + V(905)) / 2, U(2230), {});
  const B = R.BARREL, bx0 = R.HG_FERRULE[1], bx1 = B[B.length - 1][0];
  b.cyl(mat.steel, B[0][1], B[B.length - 1][1], px(bx1 - bx0), 0, AX, U((bx0 + bx1) / 2), { seg: 5 });
  b.side(mat.steel, s(R.GAS_BLOCK, 0.004), 0.02, 0, {});
  b.side(mat.steel, s(R.FS, 0.004), 0.015, 0, {});
  const Br = R.BRAKE;
  b.cyl(mat.steel, Br.r, Br.r, px(Br.x1 - Br.x0), 0, AX, U((Br.x0 + Br.x1) / 2), { seg: 5 });
  b.side(mat.steel, s(R.GUARD, 0.004), 0.01, 0, {});
  // Träger mit Ladehebel (Teil bolt), Magazin (Teil mag)
  const uf = U(R.PORT[2]), vt = V(R.PORT[1]), vb = V(R.PORT[3] - 2), hu = U(2034);
  b.part('bolt', 0, (V(R.CARRIER_STEP) + V(R.PORT[3] + 14)) / 2, U(R.CARRIER_SEAM));
  b.box(mat.bcg, 0.012, vt - vb, 0.026, K.hwR - 0.006, (vt + vb) / 2, uf - 0.013, { part: 'bolt' });
  b.box(mat.bcg, 0.014, V(870) - V(940), 0.006, K.hwR + 0.006, V(905), hu, { part: 'bolt' });
  b.anchor('chargeGrab', K.hwR + 0.013, V(880), U(2047), { part: 'bolt', data: { travel: [0, 0, px(R.CHARGE.knob[0] - R.CARRIER_STOP_X)], style: 'right' } });
  b.anchor('boltFace', 0.003, V(958), uf, { part: 'bolt' });
  akMagazine(K);
  return U(Br.x1);
}
