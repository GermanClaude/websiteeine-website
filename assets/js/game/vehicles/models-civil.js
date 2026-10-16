// NULLPUNKT — Zivilfahrzeuge (Nutzer 16.10.: „richtige Autos“ statt abgedeckter, Hafenfahrzeuge fahrbar in Ego- und
// Außenansicht): Limousine, Kastenwagen, Gabelstapler, Sattelzugmaschine.
//
// Damit die Ego-Sicht aus der Kabine stimmt, ist nur, was außerhalb der Kabine liegt, ein geschlossener Körper
// (Motorraum, Heck, Laderaum – Seitenprofil über die Breite extrudiert, Radläufe ausgeschnitten). Die Kabine selbst ist
// hohl: dünne Seitenwände bis zur Gürtellinie, darüber Säulen, Dach und durchsichtige Scheiben, innen Boden,
// Armaturenbrett mit Instrumenten, Lenkrad (dreht mit dem Lenkeinschlag), Sitze, Verkleidungen und Himmel.
// Insassen erscheinen als sitzende Figur (Hände am Lenkrad), solange der Sitz besetzt ist – der eigene Sitz in der
// Ego-Sicht nicht (vehicle.js). Je LOD-Stufe weniger Teile; Stufe 2 füllt die Kabine nur noch dunkel.
//
// Aufruf aus models.js template(): CIVIL_BUILDERS[model](lod, S, K, variant) → { hull, wheels, extra? }
//   K = Baukasten aus models.js (Bucket, box, cyl, sph, sideExtrude, topExtrude, tireGeometry, HQ, setLod)
//   wheels: [{ spin, axle, side, x, z, dx, dy }] (dx/dy: Versatz der Darstellung gegenüber dem Federpunkt)
//   extra (nur Stufe 0): [Lenkrad-Gruppe 'lenkrad' mit Kind 'lenkrad:dreh', Insassen 'occ:i' (unsichtbar)]
// Lage wie alle Fahrzeuge: vorwärts −z, y = 0 Boden bei statischer Last, Radmitte y = Radius (data.js).
import * as THREE from 'three';
import { VEHICLES } from './data.js';
import { civilPaint } from './materials.js';

const PI = Math.PI, HP = PI / 2;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _d = new THREE.Vector3(), AZ = new THREE.Vector3(0, 0, 1);

/** Lackfarben je Typ (variant % Anzahl). */
export const CIVIL_PAINT = {
  pkw: ['#8c2b24', '#2f4f6e', '#c7c7c2', '#3b3d40', '#6b7a52', '#b98b3a', '#1d1f22', '#e8e6e0'],
  transporter: ['#e8e6e0', '#cfd4d8', '#2d5f94', '#c8402f'],
  stapler: ['#e0a02a', '#d0502a', '#3a7a3c'],
  zugmaschine: ['#c8402f', '#2d5f94', '#e8e6e0', '#3e7a4c'],
};
export const civilColor = (type, variant) => { const L = CIVIL_PAINT[type] || ['#888888']; return L[(variant | 0) % L.length]; };
/** Gabelstapler-Last aus der Variante (Farbe + 8 · Last): 0 leer, 1 Kartons, 2 Säcke. */
export const staplerLoad = (variant) => Math.floor((variant | 0) / 8) % 3;

/* ------------------------------------------------------------------ Profil-Hilfen */

/** Linienzug [[u, y], …] (u aufsteigend) → y(u), linear, an den Enden geklemmt. */
const lin = (pts) => (u) => {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) { const [a, ya] = pts[i - 1], [b, yb] = pts[i]; return ya + ((yb - ya) * (u - a)) / (b - a || 1); }
  }
  return pts[pts.length - 1][1];
};
/** Unterkante mit Radläufen: base (Zahl oder y(u)), Bögen { u, y, R } (Mitte, Radius). */
const lowLine = (base, arches) => (u) => {
  let y = typeof base === 'function' ? base(u) : base;
  for (const a of arches) { const d = Math.abs(u - a.u); if (d < a.R) y = Math.max(y, a.y + Math.sqrt(a.R * a.R - d * d)); }
  return y;
};
/** Seitenfläche u ∈ [a, b] zwischen Unterkante low(u) und Oberkante top(u) als Umriss (für sideExtrude). */
function sideBlock(a, b, top, low, step) {
  const us = [];
  for (let u = a; u < b - 1e-4; u += step) us.push(u);
  us.push(b);
  const pts = us.map((u) => [u, top(u)]);
  for (let i = us.length - 1; i >= 0; i--) pts.push([us[i], low(us[i])]);
  return pts;
}
/** Quader von a nach b (Weltlage im Fahrzeug), Querschnitt w (x) × h. */
function bar(K, B, mat, a, b, w, h) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _d.length();
  if (len < 1e-4) return;
  _q.setFromUnitVectors(AZ, _d.multiplyScalar(1 / len));
  _e.setFromQuaternion(_q);
  B.add(K.box(w, h, len), mat, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [_e.x, _e.y, _e.z]);
}
/** Ebenes Vieleck in der Seitenebene (u = vorwärts, y) als dünne Platte bei x. */
function sidePanel(K, B, mat, pts, x, t = 0.012) { B.add(K.sideExtrude(pts, t), mat, [x, 0, 0]); }

/* ------------------------------------------------------------------ Räder */

/**
 * Räder je Achse: spec [{ z, r, w, twin, x, dx, dy, steer }] – x = Federpunkt (data.js), dx/dy Darstellungsversatz
 * (Gabelstapler: kleinere Lenkräder hinten). Reifen mit Schulter, Felge (Schüssel + Speichen ab Stufe 0), Nabe, Muttern.
 */
function addWheels(K, S, lod, seg, spec) {
  const out = [];
  spec.forEach((w, axle) => {
    for (const side of [-1, 1]) {
      const spin = new THREE.Group();
      const R = new K.Bucket();
      const n = w.twin ? 2 : 1, rr = w.r, ww = w.w;
      for (let k = 0; k < n; k++) {
        const ox = -side * k * (ww + 0.03);
        R.add(K.tireGeometry(rr, ww, seg, false), S.rubber, [ox, 0, 0], [0, 0, HP]);
        R.add(K.cyl(rr * 0.64, rr * 0.64, ww * 0.82, seg), w.rim || S.rim, [ox, 0, 0], [0, 0, HP]);
      }
      const face = side * ww * 0.42;
      R.add(K.cyl(rr * 0.17, rr * 0.19, 0.05, Math.max(6, seg >> 1)), S.chrome, [face + side * 0.02, 0, 0], [0, 0, HP]);
      if (lod === 0) {
        // Felgenschüssel: fünf Speichen + Radmuttern (außen)
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * PI * 2;
          R.add(K.box(0.02, rr * 0.38, rr * 0.11), S.rim, [face + side * 0.008, Math.cos(a) * rr * 0.36, Math.sin(a) * rr * 0.36], [a, 0, 0]);
          R.add(K.cyl(0.014, 0.014, 0.03, 6), S.dark, [face + side * 0.03, Math.sin(a + 0.6) * rr * 0.22, Math.cos(a + 0.6) * rr * 0.22], [0, 0, HP]);
        }
        R.add(new THREE.TorusGeometry(rr * 0.6, 0.012, 4, seg), S.rim, [face + side * 0.006, 0, 0], [0, HP, 0]);
      }
      const x = side * w.x;
      R.build(spin, { shadow: lod < 2, off: [x + side * (w.dx || 0), rr, w.z] });
      out.push({ spin, axle, side, x, z: w.z, dx: side * (w.dx || 0), dy: w.dy || 0 });
    }
  });
  return out;
}

/* ------------------------------------------------------------------ Lenkrad, Insassen */

/** Lenkrad: Gruppe 'lenkrad' an der Mitte C, Neigung tilt (rad um x), Kind 'lenkrad:dreh' dreht mit dem Einschlag. */
function steeringWheel(K, S, C, tilt, r) {
  const outer = new THREE.Group();
  outer.name = 'lenkrad';
  outer.position.fromArray(C);
  outer.rotation.x = tilt;
  const inner = new THREE.Group();
  inner.name = 'lenkrad:dreh';
  const B = new K.Bucket();
  B.add(new THREE.TorusGeometry(r, 0.019, 6, 22), S.plastic);
  B.add(K.cyl(0.06, 0.065, 0.05, 12), S.plastic, [0, 0, 0.0], [HP, 0, 0]);
  B.add(K.cyl(0.03, 0.03, 0.012, 10), S.chrome, [0, 0, 0.03], [HP, 0, 0]);
  for (const a of [0, PI, -HP]) {
    const L = r - 0.05;
    B.add(K.box(L, 0.034, 0.016), S.plastic, [Math.cos(a) * (L / 2 + 0.04), Math.sin(a) * (L / 2 + 0.04), 0], [0, 0, a]);
  }
  B.build(inner, { shadow: false });
  outer.add(inner);
  return outer;
}

/**
 * Sitzende Figur (Insasse): hip = Mitte der Sitzfläche oben, floor = Fußboden, hands = { c: Lenkradmitte, r, tilt }
 * oder null (Hände auf den Oberschenkeln). Kleidung wie die Soldaten (Oliv, Weste, Helm mit Bezug, Sturmhaube).
 */
function seatedFigure(K, S, idx, hip, floor, hands = null) {
  const g = new THREE.Group();
  g.name = `occ:${idx}`;
  g.visible = false;
  const B = new K.Bucket();
  const [x, y, z] = hip;
  const cloth = S.sleeve, vest = S.dark;
  B.add(K.box(0.36, 0.16, 0.32), cloth, [x, y + 0.06, z]);                         // Becken
  B.add(K.box(0.38, 0.48, 0.22), cloth, [x, y + 0.4, z + 0.05], [0.1, 0, 0]);       // Oberkörper (leicht zurückgelehnt)
  B.add(K.box(0.42, 0.34, 0.27), vest, [x, y + 0.42, z + 0.045], [0.1, 0, 0]);      // Weste
  B.add(K.cyl(0.055, 0.06, 0.09, 8), S.plastic, [x, y + 0.7, z + 0.08]);            // Hals
  B.add(K.sph(0.1, 10), S.plastic, [x, y + 0.82, z + 0.09]);                        // Kopf (Sturmhaube)
  B.add(new THREE.SphereGeometry(0.128, 12, 6, 0, PI * 2, 0, HP * 1.05), S.canvas, [x, y + 0.84, z + 0.09]); // Helm
  B.add(K.box(0.14, 0.03, 0.05), S.dark, [x, y + 0.83, z - 0.02]);                  // Brillenband
  const knee = (s) => [x + s * 0.1, y + 0.06, z - 0.42];
  for (const s of [-1, 1]) {
    bar(K, B, cloth, [x + s * 0.1, y + 0.06, z + 0.02], knee(s), 0.15, 0.15);       // Oberschenkel
    const foot = [x + s * 0.11, floor + 0.08, z - 0.5 - Math.max(0, 0.35 - (y - floor)) * 0.6];
    bar(K, B, cloth, knee(s), foot, 0.12, 0.12);                                     // Unterschenkel
    B.add(K.box(0.12, 0.1, 0.26), S.rubber, [foot[0], floor + 0.05, foot[2] - 0.06]); // Stiefel
    const sh = [x + s * 0.22, y + 0.58, z + 0.06];
    let hand, elbow;
    if (hands) {
      // Hände auf dem Kranz (Viertel nach neun), Ellbogen locker nach unten-außen
      const c = hands.c, ct = Math.cos(hands.tilt), st = Math.sin(hands.tilt);
      const hx = s * hands.r * 0.92, hy = 0.03;
      hand = [c[0] + hx, c[1] + hy * ct, c[2] - hy * st];
      elbow = [(sh[0] + hand[0]) / 2 + s * 0.08, (sh[1] + hand[1]) / 2 - 0.14, (sh[2] + hand[2]) / 2 + 0.04];
    } else {
      hand = [x + s * 0.15, y + 0.15, z - 0.3];
      elbow = [x + s * 0.24, y + 0.3, z - 0.04];
    }
    bar(K, B, cloth, sh, elbow, 0.1, 0.1);
    bar(K, B, cloth, elbow, hand, 0.085, 0.085);
    B.add(K.box(0.08, 0.05, 0.11), S.rubber, hand);                                  // Handschuh
  }
  B.build(g, { shadow: true });
  return g;
}

/** Sitz: Polster (gerundet ab Stufe 0), Lehne geneigt, Kopfstütze, Gestell. */
function seat(K, B, S, lod, x, yTop, z, w = 0.5, { back = 0.66, tilt = 0.18, base = 0.16, head = true } = {}) {
  const cushion = (ww, hh, dd, pos, rot) => {
    if (lod === 0) {
      const g = K.topExtrude([[-ww / 2 + 0.04, dd / 2 - 0.04], [ww / 2 - 0.04, dd / 2 - 0.04], [ww / 2 - 0.04, -dd / 2 + 0.04], [-ww / 2 + 0.04, -dd / 2 + 0.04]], hh - 0.08, true);
      g.translate(0, -hh / 2 + 0.04, 0);
      B.add(g, S.seat, pos, rot);
    } else B.add(K.box(ww, hh, dd), S.seat, pos, rot);
  };
  cushion(w, 0.12, 0.5, [x, yTop - 0.06, z]);
  const bz = z + 0.3 + Math.sin(tilt) * back / 2;
  cushion(w, back, 0.12, [x, yTop + back / 2 - 0.02, bz], [tilt, 0, 0]);
  if (head) B.add(K.box(Math.min(0.27, w * 0.55), 0.17, 0.1), S.seat, [x, yTop + back + 0.1, bz + Math.sin(tilt) * (back / 2 + 0.08)], [tilt, 0, 0]);
  if (base > 0) B.add(K.box(w * 0.75, base, 0.4), S.dark, [x, yTop - 0.12 - base / 2, z]);
}

/** Instrumente: Rundinstrumente (leicht leuchtend) mit Zeiger, zum Fahrer geneigt. */
function gauges(K, B, S, cx, y, z, gap = 0.17, n = 2, r = 0.055) {
  for (let i = 0; i < n; i++) {
    const x = cx + (i - (n - 1) / 2) * gap;
    B.add(K.cyl(r, r, 0.012, 18), S.dial, [x, y, z], [1.25, 0, 0]);
    B.add(K.box(0.006, r * 0.8, 0.004), S.amber, [x, y + 0.012, z + 0.004], [1.25, 0, 0.6 - i * 1.1]);
  }
}

/* ------------------------------------------------------------------ Limousine */

function buildPkw(lod, S, K, variant) {
  K.setLod(lod);
  const D = VEHICLES.pkw;
  const paint = civilPaint(civilColor('pkw', variant));
  const hull = new THREE.Group();
  const B = new K.Bucket(), GB = new K.Bucket(), LB = new K.Bucket();
  const step = [0.04, 0.08, 0.16][lod], seg = [20, 12, 7][lod];
  // Seitenprofil (u = vorwärts): Heck mit Kofferraum, Gürtellinie, Motorhaube, Bug
  const top = lin([[-2.35, 0.6], [-2.33, 0.86], [-2.27, 0.96], [-2.1, 1.0], [-1.86, 1.01], [-1.05, 0.97], [1.0, 0.95], [1.9, 0.82], [2.22, 0.75], [2.33, 0.66], [2.35, 0.5]]);
  const low = lowLine(lin([[-2.35, 0.38], [-2.2, 0.28], [2.2, 0.28], [2.35, 0.36]]), [{ u: 1.38, y: 0.32, R: 0.37 }, { u: -1.43, y: 0.32, R: 0.37 }]);
  const bev = lod < 2, bw = bev ? 1.74 : 1.8;
  B.add(K.sideExtrude(sideBlock(1.0, 2.35, top, low, step), bw, bev), paint);      // Vorderwagen
  B.add(K.sideExtrude(sideBlock(-2.35, -1.05, top, low, step), bw, bev), paint);   // Heck
  // Kabine: Türen als dünne Wände bis zur Gürtellinie
  for (const sx of [-1, 1]) B.add(K.sideExtrude(sideBlock(-1.05, 1.0, top, low, 0.5), 0.05), paint, [sx * 0.875, 0, 0]);
  // Säulen, Dach, C-Säule mit Seitenteil
  for (const sx of [-1, 1]) {
    bar(K, B, paint, [sx * 0.85, 0.95, -1.0], [sx * 0.77, 1.42, -0.27], 0.075, 0.07);
    bar(K, B, paint, [sx * 0.865, 0.95, 0.1], [sx * 0.785, 1.42, 0.1], 0.07, 0.1);
    sidePanel(K, B, paint, [[-1.05, 0.95], [-1.9, 1.0], [-1.16, 1.43], [-1.05, 1.43]], sx * 0.815, 0.06);
  }
  B.add(K.box(1.62, 0.05, 1.47), paint, [0, 1.425, 0.445]);
  B.add(K.box(1.6, 0.04, 0.06), paint, [0, 1.41, -0.27]);
  // Unterboden, Radhausschalen (der Radlauf-Tunnel ist sonst quer durchsichtig)
  B.add(K.box(1.7, 0.04, 2.1), S.dark, [0, 0.29, 0.0]);
  for (const zz of [-1.38, 1.43]) B.add(K.box(1.2, 0.4, 0.86), S.dark, [0, 0.5, zz]);
  // Stoßfänger, Grill, Kennzeichen, Leuchten
  B.add(K.box(1.84, 0.22, 0.22), S.plastic, [0, 0.4, -2.3]);
  B.add(K.box(1.84, 0.22, 0.2), S.plastic, [0, 0.42, 2.32]);
  B.add(K.box(0.8, 0.13, 0.03), S.dark, [0, 0.6, -2.345]);
  B.add(K.box(0.52, 0.11, 0.012), S.plate, [0, 0.4, -2.416]);
  B.add(K.box(0.52, 0.11, 0.012), S.plate, [0, 0.66, 2.37]);
  for (const sx of [-1, 1]) {
    LB.add(K.box(0.34, 0.11, 0.04), S.lensOff, [sx * 0.6, 0.69, -2.31], [0, sx * 0.14, 0], null, { tag: { lens: true } });
    B.add(K.box(0.38, 0.13, 0.04), S.rearLamp, [sx * 0.6, 0.8, 2.345]);
    B.add(K.box(0.08, 0.05, 0.04), S.amber, [sx * 0.8, 0.62, -2.26]);
  }
  if (lod < 2) {
    // Außenspiegel, Türgriffe, Fensterleisten
    for (const sx of [-1, 1]) {
      bar(K, B, S.plastic, [sx * 0.86, 0.98, -0.8], [sx * 0.97, 1.0, -0.8], 0.04, 0.03);
      B.add(K.box(0.17, 0.12, 0.09), paint, [sx * 1.02, 1.02, -0.8]);
      B.add(K.box(0.15, 0.09, 0.005), S.chrome, [sx * 1.02, 1.02, -0.752]);
      for (const zz of [-0.25, 0.62]) B.add(K.box(0.022, 0.03, 0.14), S.chrome, [sx * 0.905, 0.86, zz]);
      B.add(K.box(0.03, 0.025, 2.06), S.plastic, [sx * 0.875, 0.965, 0.0]);
    }
    if (lod === 0) {
      for (let k = 0; k < 4; k++) B.add(K.box(0.76, 0.012, 0.01), S.chrome, [0, 0.555 + k * 0.03, -2.362]);
      for (const sx of [-1, 1]) for (const zz of [-0.98, 0.1, 1.03]) B.add(K.box(0.006, 0.6, 0.01), S.plastic, [sx * 0.903, 0.64, zz]);
      for (const sx of [-1, 1]) bar(K, B, S.plastic, [sx * 0.62, 0.975, -0.97], [sx * 0.08, 1.0, -0.94], 0.016, 0.012); // Wischer
      B.add(K.cyl(0.004, 0.006, 0.26, 4), S.dark, [0, 1.56, 1.05], [-0.4, 0, 0]);   // Antenne
      B.add(K.cyl(0.035, 0.035, 0.12, 8), S.dark, [0.55, 0.3, 2.37], [HP, 0, 0]);   // Auspuff
    }
  }
  // Innenraum
  if (lod < 2) {
    const P = S.plastic;
    B.add(K.box(1.66, 0.04, 2.02), S.interior, [0, 0.31, 0.0]);                      // Teppich
    B.add(K.box(1.66, 0.58, 0.03), P, [0, 0.62, -0.985]);                            // Stirnwand
    B.add(K.box(1.7, 0.2, 0.36), P, [0, 0.85, -0.8]);                                // Armaturenbrett
    B.add(K.box(1.7, 0.04, 0.5), P, [0, 0.975, -0.78], [-0.14, 0, 0]);
    B.add(K.box(0.44, 0.07, 0.18), P, [-0.38, 1.02, -0.66], [-0.1, 0, 0]);           // Instrumentenhutze
    B.add(K.box(0.26, 0.28, 0.8), P, [0, 0.47, -0.28]);                              // Mittelkonsole
    B.add(K.box(1.5, 0.02, 0.84), P, [0, 1.005, 1.46]);                              // Hutablage
    B.add(K.box(1.52, 0.02, 1.4), S.trim, [0, 1.39, 0.44]);                          // Himmel
    for (const sx of [-1, 1]) {
      B.add(K.box(0.02, 0.56, 2.0), S.trim, [sx * 0.845, 0.66, 0.0]);               // Türverkleidung
      B.add(K.box(0.07, 0.05, 0.7), P, [sx * 0.81, 0.72, -0.05]);                    // Armlehne
      B.add(K.box(0.36, 0.02, 0.16), S.trim, [sx * 0.38, 1.37, -0.2], [0.12, 0, 0]); // Sonnenblende
    }
    B.add(K.box(0.22, 0.06, 0.02), P, [0, 1.33, -0.3]);                              // Innenspiegel
    seat(K, B, S, lod, -0.38, 0.54, 0.05);
    seat(K, B, S, lod, 0.38, 0.54, 0.05);
    seat(K, B, S, lod, 0, 0.535, 0.66, 1.5, { back: 0.56, tilt: 0.22, base: 0, head: false });
    for (const sx of [-1, 1]) B.add(K.box(0.24, 0.16, 0.09), S.seat, [sx * 0.4, 1.195, 1.1], [0.22, 0, 0]);
    // Lenksäule
    bar(K, B, P, [-0.38, 0.86, -0.78], [-0.38, 0.97, -0.55], 0.06, 0.06);
    if (lod === 0) {
      gauges(K, B, S, -0.38, 0.968, -0.6);
      B.add(K.box(0.24, 0.14, 0.02), S.dial, [0, 0.92, -0.62], [-0.25, 0, 0]);       // Bildschirm
      for (const xx of [-0.68, -0.12, 0.12, 0.68]) B.add(K.box(0.12, 0.05, 0.02), S.dark, [xx, 0.88, -0.615]); // Lüftung
      B.add(K.cyl(0.012, 0.012, 0.12, 6), S.dark, [0, 0.66, -0.18]);                  // Wählhebel
      B.add(K.sph(0.032, 8), P, [0, 0.73, -0.18]);
      for (const xx of [-0.5, -0.36, -0.24]) B.add(K.box(0.06, 0.1, 0.02), S.dark, [xx, 0.42, -0.62], [0.5, 0, 0]); // Pedale
    }
  } else B.add(K.box(1.6, 0.5, 1.9), S.interior, [0, 0.62, 0.0]);
  // Scheiben
  bar(K, GB, S.glass, [0, 0.96, -0.99], [0, 1.4, -0.28], 1.56, 0.012);
  bar(K, GB, S.glass, [0, 1.01, 1.88], [0, 1.41, 1.17], 1.46, 0.012);
  for (const sx of [-1, 1]) {
    sidePanel(K, GB, S.glass, [[-0.08, 0.96], [0.96, 0.96], [0.29, 1.39], [-0.08, 1.39]], sx * 0.83);
    sidePanel(K, GB, S.glass, [[-1.04, 0.97], [-0.12, 0.97], [-0.12, 1.39], [-1.04, 1.39]], sx * 0.83);
  }
  B.build(hull, { shadow: true });
  GB.build(hull, { shadow: false });
  LB.build(hull, { shadow: false });
  const wheels = addWheels(K, S, lod, seg, [{ z: D.wheels.z[0], r: 0.32, w: 0.21, x: D.wheels.x }, { z: D.wheels.z[1], r: 0.32, w: 0.21, x: D.wheels.x }]);
  const out = { hull, wheels };
  if (lod === 0) {
    const C = [-0.38, 0.99, -0.52], tilt = -0.43, r = 0.185;
    out.extra = [steeringWheel(K, S, C, tilt, r)];
    const hands = { c: C, r, tilt };
    [[-0.38, 0.55, 0.13, hands], [0.38, 0.55, 0.13, null], [-0.4, 0.55, 0.74, null], [0.4, 0.55, 0.74, null]]
      .forEach(([x, y, z, h], i) => out.extra.push(seatedFigure(K, S, i, [x, y, z], 0.33, h)));
  }
  return out;
}

/* ------------------------------------------------------------------ Kastenwagen */

function buildTransporter(lod, S, K, variant) {
  K.setLod(lod);
  const D = VEHICLES.transporter;
  const paint = civilPaint(civilColor('transporter', variant));
  const hull = new THREE.Group();
  const B = new K.Bucket(), GB = new K.Bucket(), LB = new K.Bucket();
  const step = [0.04, 0.08, 0.16][lod], seg = [20, 12, 7][lod];
  const arches = [{ u: 1.75, y: 0.36, R: 0.44 }, { u: -1.55, y: 0.36, R: 0.44 }];
  const low = lowLine(lin([[-2.62, 0.5], [-2.5, 0.46], [2.5, 0.46], [2.64, 0.52]]), arches);
  const topCargo = lin([[-2.62, 2.28], [-2.55, 2.39], [-2.45, 2.42], [-0.1, 2.42]]);
  const topNose = lin([[1.8, 1.31], [2.2, 1.25], [2.48, 1.15], [2.6, 1.0], [2.64, 0.64]]);
  const belt = lin([[-0.1, 1.38], [1.8, 1.32]]);
  const bev = lod < 2, bw = bev ? 1.94 : 2.0;
  B.add(K.sideExtrude(sideBlock(-2.62, -0.1, topCargo, low, step), bw, bev), paint);  // Laderaum
  B.add(K.sideExtrude(sideBlock(1.8, 2.64, topNose, low, step), bw, bev), paint);     // Bug
  for (const sx of [-1, 1]) B.add(K.sideExtrude(sideBlock(-0.1, 1.8, belt, low, step), 0.05), paint, [sx * 0.975, 0, 0]);
  // Fahrerhaus oben: A-/B-Säulen, Dach, Holm über den Fenstern, Stirnbalken
  for (const sx of [-1, 1]) {
    bar(K, B, paint, [sx * 0.95, 1.31, -1.82], [sx * 0.93, 2.42, -1.18], 0.08, 0.08);
    bar(K, B, paint, [sx * 0.965, 1.37, 0.0], [sx * 0.965, 2.43, 0.0], 0.07, 0.12);
    B.add(K.box(0.06, 0.24, 1.3), paint, [sx * 0.97, 2.32, -0.58]);
  }
  B.add(K.box(1.96, 0.05, 1.36), paint, [0, 2.425, -0.56]);
  B.add(K.box(1.92, 0.16, 0.08), paint, [0, 2.33, -1.2]);
  B.add(K.box(1.4, 0.18, 4.4), S.dark, [0, 0.55, 0.0]);                                 // Unterboden
  for (const zz of [1.55]) B.add(K.box(1.3, 0.4, 0.96), S.dark, [0, 0.62, zz]);
  // Bug, Heck, Leuchten
  B.add(K.box(2.02, 0.3, 0.18), S.plastic, [0, 0.52, -2.6]);
  B.add(K.box(0.92, 0.26, 0.04), S.dark, [0, 0.86, -2.625]);
  B.add(K.box(0.52, 0.11, 0.012), S.plate, [0, 0.5, -2.695]);
  B.add(K.box(2.02, 0.26, 0.14), S.plastic, [0, 0.52, 2.62]);
  B.add(K.box(0.52, 0.11, 0.012), S.plate, [0, 0.68, 2.66]);
  for (const sx of [-1, 1]) {
    LB.add(K.box(0.36, 0.16, 0.05), S.lensOff, [sx * 0.7, 0.95, -2.6], [0, sx * 0.12, 0], null, { tag: { lens: true } });
    B.add(K.box(0.14, 0.42, 0.04), S.rearLamp, [sx * 0.9, 1.0, 2.64]);
    B.add(K.box(0.1, 0.05, 0.04), S.amber, [sx * 0.92, 0.6, -2.58]);
    B.add(K.box(0.03, 0.16, 2.2), S.plastic, [sx * 1.0, 0.56, -0.2]);                  // Schutzleiste
  }
  if (lod < 2) {
    B.add(K.box(0.012, 1.7, 0.012), S.plastic, [0, 1.4, 2.656]);                         // Hecktürfuge
    for (const sx of [-1, 1]) {
      bar(K, B, S.plastic, [sx * 0.97, 1.6, -1.72], [sx * 1.14, 1.62, -1.72], 0.04, 0.04);
      B.add(K.box(0.1, 0.34, 0.2), S.plastic, [sx * 1.2, 1.55, -1.72]);                  // Außenspiegel
      B.add(K.box(0.005, 0.3, 0.16), S.chrome, [sx * 1.2, 1.55, -1.61], [0, HP, 0]);
      B.add(K.box(0.02, 0.04, 0.18), S.plastic, [sx * 1.0, 1.22, -0.12]);               // Türgriff
    }
    for (const zz of [0.15, 1.25]) B.add(K.box(0.008, 1.65, 0.012), S.plastic, [1.003, 1.32, zz]); // Schiebetür
    B.add(K.box(0.02, 0.03, 1.9), S.dark, [1.012, 2.2, 0.9]);
    B.add(K.box(0.02, 0.04, 0.2), S.plastic, [1.02, 1.2, 0.35]);
    if (lod === 0) for (const sx of [-1, 1]) bar(K, B, S.plastic, [sx * 0.75, 1.34, -1.8], [sx * 0.08, 1.37, -1.77], 0.016, 0.012);
  }
  // Innenraum
  if (lod < 2) {
    const P = S.plastic;
    B.add(K.box(1.88, 0.05, 1.9), S.interior, [0, 0.64, -0.85]);                         // Boden
    for (const sx of [-1, 1]) B.add(K.box(0.36, 0.3, 0.82), P, [sx * 0.78, 0.78, -1.72]); // Radkästen
    B.add(K.box(1.9, 1.76, 0.03), S.trim, [0, 1.52, 0.085]);                             // Trennwand
    B.add(K.box(1.9, 0.32, 0.45), P, [0, 1.12, -1.6]);                                   // Armaturenbrett
    B.add(K.box(1.9, 0.04, 0.5), P, [0, 1.3, -1.6], [-0.12, 0, 0]);
    B.add(K.box(0.44, 0.08, 0.18), P, [-0.5, 1.36, -1.42], [-0.1, 0, 0]);
    B.add(K.box(1.86, 0.02, 1.3), S.trim, [0, 2.39, -0.58]);                              // Himmel
    for (const sx of [-1, 1]) {
      B.add(K.box(0.02, 0.62, 1.7), S.trim, [sx * 0.945, 1.04, -0.9]);
      B.add(K.box(0.4, 0.02, 0.18), S.trim, [sx * 0.5, 2.34, -1.1], [0.15, 0, 0]);
    }
    seat(K, B, S, lod, -0.5, 1.06, -0.55, 0.5, { back: 0.7, tilt: 0.15, base: 0.3 });
    seat(K, B, S, lod, 0.47, 1.06, -0.55, 0.92, { back: 0.7, tilt: 0.15, base: 0.3, head: false });
    for (const xx of [0.27, 0.69]) B.add(K.box(0.24, 0.17, 0.1), S.seat, [xx, 1.86, -0.12], [0.15, 0, 0]);
    bar(K, B, P, [-0.5, 1.26, -1.42], [-0.5, 1.42, -1.25], 0.06, 0.06);
    if (lod === 0) {
      gauges(K, B, S, -0.5, 1.32, -1.36);
      B.add(K.box(0.3, 0.2, 0.02), S.dial, [0.05, 1.2, -1.37], [-0.2, 0, 0]);
      B.add(K.cyl(0.012, 0.012, 0.16, 6), S.dark, [-0.12, 1.2, -1.3], [-0.6, 0, 0]);    // Schalthebel
      B.add(K.sph(0.03, 8), P, [-0.12, 1.27, -1.25]);
      B.add(K.box(0.22, 0.06, 0.02), P, [0, 2.3, -1.16]);
    }
  } else B.add(K.box(1.8, 0.7, 1.7), S.interior, [0, 1.1, -0.9]);
  // Scheiben (Front, Seitenfenster, Heckfenster)
  bar(K, GB, S.glass, [0, 1.33, -1.79], [0, 2.24, -1.21], 1.8, 0.012);
  for (const sx of [-1, 1]) {
    sidePanel(K, GB, S.glass, [[-0.04, 1.39], [1.76, 1.39], [1.3, 2.2], [-0.04, 2.2]], sx * 0.975);
    GB.add(K.box(0.7, 0.5, 0.01), S.glass, [sx * 0.45, 1.86, 2.652]);
  }
  B.build(hull, { shadow: true });
  GB.build(hull, { shadow: false });
  LB.build(hull, { shadow: false });
  const W = D.wheels;
  const wheels = addWheels(K, S, lod, seg, [{ z: W.z[0], r: 0.36, w: 0.24, x: W.x }, { z: W.z[1], r: 0.36, w: 0.24, x: W.x }]);
  const out = { hull, wheels };
  if (lod === 0) {
    const C = [-0.5, 1.46, -1.2], tilt = -0.72, r = 0.2;
    out.extra = [steeringWheel(K, S, C, tilt, r)];
    out.extra.push(seatedFigure(K, S, 0, [-0.5, 1.07, -0.48], 0.67, { c: C, r, tilt }));
    out.extra.push(seatedFigure(K, S, 1, [0.5, 1.07, -0.48], 0.67, null));
  }
  return out;
}

/* ------------------------------------------------------------------ Sattelzugmaschine */

function buildZugmaschine(lod, S, K, variant) {
  K.setLod(lod);
  const D = VEHICLES.zugmaschine;
  const col = civilColor('zugmaschine', variant);
  const paint = civilPaint(col), paint2 = civilPaint(new THREE.Color(col).multiplyScalar(0.9).getHex());
  const hull = new THREE.Group();
  const B = new K.Bucket(), GB = new K.Bucket(), LB = new K.Bucket();
  const step = [0.05, 0.1, 0.2][lod], seg = [22, 12, 8][lod];
  const lowCab = lowLine(lin([[0.95, 0.95], [3.1, 0.95], [3.22, 1.08]]), [{ u: 2.2, y: 0.52, R: 0.62 }]);
  const belt = lin([[0.95, 1.72], [3.12, 1.7]]);
  // Kabine unten: Seitenwände (Radlauf vorn), Bug als Körper, Rückwand, Unterseite
  for (const sx of [-1, 1]) B.add(K.sideExtrude(sideBlock(0.95, 3.0, belt, lowCab, step), 0.05), paint, [sx * 1.2, 0, 0]);
  B.add(K.sideExtrude(sideBlock(2.95, 3.22, lin([[2.95, 1.7], [3.18, 1.7], [3.22, 1.6]]), lin([[2.95, 0.95], [3.1, 0.95], [3.22, 1.08]]), 0.05), lod < 2 ? 2.39 : 2.45, lod < 2), paint);
  B.add(K.box(2.44, 1.97, 0.05), paint, [0, 1.935, -0.975]);
  B.add(K.box(1.5, 0.32, 2.0), S.dark, [0, 1.1, -1.95]);
  for (const sx of [-1, 1]) B.add(K.box(0.42, 0.18, 1.3), S.dark, [sx * 0.98, 1.2, -2.2]);
  // oben: A-/B-Säulen, Dach, Stirn, Seitenteile hinter der Tür und über dem Fenster, Windleitblech, Sonnenblende
  for (const sx of [-1, 1]) {
    bar(K, B, paint, [sx * 1.17, 1.7, -3.2], [sx * 1.16, 2.9, -2.98], 0.08, 0.08);
    bar(K, B, paint, [sx * 1.19, 1.7, -1.95], [sx * 1.19, 2.9, -1.95], 0.07, 0.1);
    sidePanel(K, B, paint, [[0.95, 1.7], [1.95, 1.7], [1.95, 2.92], [0.95, 2.92]], sx * 1.195, 0.05);
    sidePanel(K, B, paint, [[1.95, 2.55], [3.02, 2.55], [2.96, 2.92], [1.95, 2.92]], sx * 1.195, 0.05);
  }
  B.add(K.box(2.42, 0.06, 2.06), paint, [0, 2.92, -1.97]);
  B.add(K.box(2.36, 0.32, 0.08), paint, [0, 2.76, -3.0], [0.15, 0, 0]);
  B.add(K.sideExtrude([[1.15, 2.92], [2.67, 2.92], [2.35, 3.36], [1.15, 3.4]], 2.3, lod === 0), paint2);
  B.add(K.box(2.3, 0.07, 0.32), S.plastic, [0, 2.66, -3.12], [0.25, 0, 0]);
  // Bug: Grill, Stoßfänger, Leuchten, Kennzeichen
  B.add(K.box(1.7, 0.5, 0.03), S.plastic, [0, 1.33, -3.235]);
  B.add(K.box(2.49, 0.52, 0.24), S.plastic, [0, 0.68, -3.22]);
  B.add(K.box(0.52, 0.11, 0.012), S.plate, [0, 0.52, -3.346]);
  for (const sx of [-1, 1]) {
    LB.add(K.box(0.36, 0.18, 0.03), S.lensOff, [sx * 0.9, 0.8, -3.345], null, null, { tag: { lens: true } });
    B.add(K.box(0.1, 0.16, 0.03), S.amber, [sx * 1.15, 0.8, -3.342]);
  }
  // Fahrgestell: Längsträger, Sattelkupplung, Tanks, Luftkessel, Auspuff, Kotflügel, Schmutzfänger, Heckträger
  B.add(K.box(0.9, 0.3, 6.1), S.dark, [0, 0.77, 0.0]);
  B.add(K.box(1.3, 0.1, 1.1), S.dark, [0, 0.97, 1.4]);
  B.add(K.box(1.2, 0.06, 1.0), S.steel, [0, 1.05, 1.4]);
  B.add(K.cyl(0.3, 0.3, 1.1, seg), S.chrome, [-0.82, 0.68, -0.4], [HP, 0, 0]);
  B.add(K.cyl(0.2, 0.2, 0.55, seg), civilPaint('#2f5a8a'), [0.82, 0.62, -0.6], [HP, 0, 0]);
  B.add(K.cyl(0.14, 0.14, 0.4, Math.max(6, seg >> 1)), S.dark, [0.82, 0.62, -0.05], [HP, 0, 0]);
  B.add(K.cyl(0.07, 0.07, 2.3, 10), S.chrome, [1.05, 2.15, -0.8]);
  B.add(K.cyl(0.075, 0.075, 0.08, 10), S.dark, [1.05, 3.3, -0.8]);
  for (const sx of [-1, 1]) {
    B.add(K.box(0.7, 0.04, 1.3), S.dark, [sx * 0.9, 1.16, 1.4]);
    B.add(K.box(0.66, 0.6, 0.02), S.rubber, [sx * 0.9, 0.55, 2.12]);
    for (const yy of [0.42, 0.72]) B.add(K.box(0.26, 0.04, 0.5), S.dark, [sx * 1.1, yy, -1.95]); // Trittstufen
    B.add(K.box(0.03, 0.6, 0.5), S.dark, [sx * 1.2, 0.6, -1.95]);
    B.add(K.box(0.3, 0.12, 0.04), S.rearLamp, [sx * 0.95, 0.75, 3.08]);
  }
  B.add(K.box(2.3, 0.15, 0.1), S.dark, [0, 0.75, 3.02]);
  if (lod < 2) {
    for (const sx of [-1, 1]) {
      bar(K, B, S.plastic, [sx * 1.2, 2.38, -2.95], [sx * 1.42, 2.38, -2.98], 0.04, 0.04);
      bar(K, B, S.plastic, [sx * 1.2, 1.72, -2.95], [sx * 1.42, 1.72, -2.98], 0.04, 0.04);
      B.add(K.box(0.05, 0.7, 0.04), S.chrome, [sx * 1.42, 2.05, -2.98]);
      B.add(K.box(0.08, 0.46, 0.24), S.plastic, [sx * 1.46, 2.18, -2.96]);              // Hauptspiegel
      B.add(K.box(0.07, 0.2, 0.18), S.plastic, [sx * 1.46, 1.84, -2.96]);               // Weitwinkel
      B.add(K.box(0.02, 0.05, 0.22), S.plastic, [sx * 1.22, 1.55, -2.7]);               // Türgriff
      B.add(K.box(0.008, 1.55, 0.012), S.plastic, [sx * 1.226, 1.72, -1.97]);           // Türfuge
    }
    for (let k = 0; k < 5; k++) B.add(K.box(1.64, 0.028, 0.02), civilPaint(new THREE.Color(col).multiplyScalar(0.55).getHex()), [0, 1.13 + k * 0.095, -3.255]);
    B.add(K.cyl(0.05, 0.05, 0.12, 6), S.chrome, [0.5, 2.98, -2.5]);                     // Fanfare
  }
  // Innenraum
  if (lod < 2) {
    const P = S.plastic;
    B.add(K.box(2.3, 0.06, 1.95), S.interior, [0, 1.26, -1.95]);
    B.add(K.box(0.7, 0.28, 1.3), P, [0, 1.43, -2.2]);                                   // Motortunnel
    B.add(K.box(2.3, 0.4, 0.45), P, [0, 1.86, -2.82]);                                  // Armaturenbrett
    B.add(K.box(2.3, 0.04, 0.5), P, [0, 2.06, -2.8], [-0.12, 0, 0]);
    B.add(K.box(0.5, 0.08, 0.2), P, [-0.55, 2.13, -2.6], [-0.1, 0, 0]);
    B.add(K.box(2.3, 1.6, 0.03), S.trim, [0, 2.1, -1.0]);                               // Rückwand innen
    B.add(K.box(2.3, 0.02, 1.9), S.trim, [0, 2.86, -1.96]);                             // Himmel
    B.add(K.box(2.2, 0.12, 0.7), S.seat, [0, 1.75, -1.32]);                             // Liege
    for (const sx of [-1, 1]) B.add(K.box(0.02, 0.4, 1.9), S.trim, [sx * 1.17, 1.5, -1.95]);
    seat(K, B, S, lod, -0.55, 1.71, -1.95, 0.52, { back: 0.72, tilt: 0.12, base: 0.3 });
    seat(K, B, S, lod, 0.55, 1.71, -1.95, 0.52, { back: 0.72, tilt: 0.12, base: 0.3 });
    bar(K, B, P, [-0.55, 1.8, -2.62], [-0.55, 1.98, -2.42], 0.07, 0.07);
    if (lod === 0) {
      gauges(K, B, S, -0.55, 2.11, -2.54, 0.2, 2, 0.065);
      B.add(K.box(0.36, 0.22, 0.02), S.dial, [0.15, 1.96, -2.6], [-0.25, 0, 0]);
      B.add(K.cyl(0.014, 0.014, 0.22, 6), S.dark, [-0.12, 1.75, -2.45], [-0.5, 0, 0]);
      B.add(K.sph(0.035, 8), P, [-0.12, 1.85, -2.4]);
    }
  } else B.add(K.box(2.2, 0.9, 1.8), S.interior, [0, 1.75, -1.95]);
  // Scheiben
  bar(K, GB, S.glass, [0, 1.72, -3.18], [0, 2.6, -3.04], 2.24, 0.012);
  for (const sx of [-1, 1]) sidePanel(K, GB, S.glass, [[1.97, 1.74], [3.1, 1.74], [3.0, 2.54], [1.97, 2.54]], sx * 1.19);
  B.build(hull, { shadow: true });
  GB.build(hull, { shadow: false });
  LB.build(hull, { shadow: false });
  const W = D.wheels;
  const wheels = addWheels(K, S, lod, seg, [{ z: W.z[0], r: 0.52, w: 0.36, x: W.x }, { z: W.z[1], r: 0.52, w: 0.3, x: W.x + 0.02, twin: true }]);
  const out = { hull, wheels };
  if (lod === 0) {
    const C = [-0.55, 2.02, -2.36], tilt = -0.85, r = 0.24;
    out.extra = [steeringWheel(K, S, C, tilt, r)];
    out.extra.push(seatedFigure(K, S, 0, [-0.55, 1.72, -1.88], 1.29, { c: C, r, tilt }));
    out.extra.push(seatedFigure(K, S, 1, [0.55, 1.72, -1.88], 1.29, null));
  }
  return out;
}

/* ------------------------------------------------------------------ Gabelstapler */

/** Radlauf-Bogen in einem Profil (Mitte uc/yc, Radius R, Unterkante y0, vorwärts = +u). */
function radlauf(uc, yc, R, y0, n) {
  const a0 = Math.asin(Math.max(-1, Math.min(1, (y0 - yc) / R)));
  const out = [];
  for (let i = 0; i <= n; i++) { const a = PI - a0 - (PI - 2 * a0) * (i / n); out.push([uc + R * Math.cos(a), yc + R * Math.sin(a)]); }
  return out;
}

function buildStapler(lod, S, K, variant) {
  K.setLod(lod);
  const D = VEHICLES.stapler;
  const paint = civilPaint(civilColor('stapler', variant));
  const load = staplerLoad(variant);
  const hull = new THREE.Group();
  const B = new K.Bucket(), LB = new K.Bucket();
  const seg = [20, 12, 7][lod], n = [6, 4, 3][lod];
  const dark = S.dark;
  // Aufbau aus dem Seitenprofil (Haube, Fußraum, Armaturenträger, Radläufe), Gussgegengewicht hinten
  const prof = [[-1.2, 0.2], ...radlauf(-0.86, 0.26, 0.31, 0.2, n), ...radlauf(0.42, 0.33, 0.38, 0.2, n), [0.72, 0.2], [0.74, 0.92],
    [0.6, 1.08], [0.34, 1.1], [0.27, 0.62], [-0.12, 0.6], [-0.17, 1.02], [-0.26, 1.13], [-1.06, 1.15], [-1.24, 1.02], [-1.3, 0.62], [-1.26, 0.3]];
  B.add(K.sideExtrude(prof, 1.06, lod < 2), paint);
  B.add(K.sideExtrude([[-1.33, 0.18], [-0.95, 0.18], [-0.95, 0.98], [-1.2, 1.0], [-1.33, 0.86]], 1.1, lod < 2), dark);
  B.add(K.box(0.62, 0.12, 1.8), dark, [0, 0.18, 0.2]);
  B.add(K.box(0.86, 0.02, 0.36), dark, [0, 0.61, -0.07]);                                // Trittblech
  for (const sx of [-1, 1]) B.add(K.box(0.3, 0.04, 0.74), paint, [sx * 0.5, 0.8, -0.42]); // Kotflügel
  // Treibgasflasche quer auf dem Gegengewicht
  B.add(K.cyl(0.15, 0.15, 0.78, seg), civilPaint('#c9cdd0'), [0, 1.33, 1.0], [0, 0, HP]);
  for (const sx of [-1, 1]) B.add(K.box(0.04, 0.2, 0.3), dark, [sx * 0.3, 1.24, 1.0]);
  // Sitz mit Hüftgurt, Armaturenträger mit Hebeln, Lenksäule
  seat(K, B, S, lod, 0, 1.24, 0.4, 0.5, { back: 0.56, tilt: 0.14, base: 0, head: false });
  if (lod < 2) {
    B.add(K.box(0.03, 0.05, 0.2), civilPaint('#b8392c'), [0.24, 1.285, 0.5]);
    for (let k = 0; k < 3; k++) {
      B.add(K.cyl(0.01, 0.01, 0.2, 5), S.chrome, [0.18 + k * 0.07, 1.2, -0.4]);
      B.add(K.cyl(0.025, 0.025, 0.04, 6), k === 0 ? civilPaint('#b8392c') : S.plastic, [0.18 + k * 0.07, 1.32, -0.4]);
    }
    if (lod === 0) gauges(K, B, S, -0.18, 1.12, -0.44, 0.12, 2, 0.04);
  }
  bar(K, B, dark, [0, 1.06, -0.43], [0, 1.5, -0.24], 0.07, 0.07);
  // Räder: vorn Antrieb (groß), hinten Lenkachse (klein, unter dem Gegengewicht)
  const W = D.wheels;
  const wheels = addWheels(K, S, lod, seg, [
    { z: W.z[0], r: 0.33, w: 0.24, x: W.x },
    { z: W.z[1], r: 0.26, w: 0.2, x: W.x, dx: -0.03, dy: 0.26 - 0.33 },
  ]);
  // Fahrerschutzdach: Pfosten, Rahmen, Querstreben, Rundumleuchte, Arbeitsscheinwerfer
  for (const sx of [-0.5, 0.5]) {
    B.add(K.box(0.07, 1.05, 0.07), dark, [sx, 1.655, 0.86]);
    B.add(K.box(0.07, 1.1, 0.07), dark, [sx, 1.63, -0.42]);
    B.add(K.box(0.07, 0.07, 1.36), dark, [sx, 2.185, 0.22]);
    B.add(K.box(0.08, 0.1, 0.06), dark, [sx * 1.04, 2.05, -0.47]);
    LB.add(K.box(0.07, 0.08, 0.01), S.lensOff, [sx * 1.04, 2.05, -0.503], null, null, { tag: { lens: true } });
  }
  for (const zz of [-0.42, 0.86]) B.add(K.box(1.07, 0.07, 0.07), dark, [0, 2.185, zz]);
  for (let k = 1; k < 6; k++) B.add(K.box(1.0, 0.04, 0.035), dark, [0, 2.18, 0.86 - k * 0.213]);
  B.add(K.cyl(0.07, 0.07, 0.12, 10), S.amber, [-0.38, 2.28, 0.8]);
  B.add(K.cyl(0.072, 0.072, 0.012, 10), S.plastic, [-0.38, 2.346, 0.8]);
  // Hubmast: Außen-/Innenprofile, Querhäupter, Hubzylinder, Ketten, Neigezylinder
  const dark2 = S.steel;
  for (const sx of [-1, 1]) {
    B.add(K.box(0.08, 2.3, 0.14), dark, [sx * 0.34, 1.23, -0.8]);
    B.add(K.box(0.07, 2.2, 0.1), dark2, [sx * 0.26, 1.24, -0.82]);
    if (lod < 2) {
      B.add(K.box(0.025, 1.92, 0.018), S.plastic, [sx * 0.12, 1.26, -0.86]);
      B.add(K.cyl(0.07, 0.07, 0.05, 10), S.chrome, [sx * 0.12, 2.25, -0.82], [0, 0, HP]);
    }
    B.add(K.cyl(0.045, 0.045, 0.42, 8), S.chrome, [sx * 0.38, 0.62, -0.48], [HP, 0, 0]);
    B.add(K.cyl(0.06, 0.06, 0.2, 8), dark, [sx * 0.38, 0.62, -0.3], [HP, 0, 0]);
  }
  for (const yy of [0.16, 1.24, 2.34]) B.add(K.box(0.76, 0.08, 0.1), dark, [0, yy, -0.8]);
  B.add(K.cyl(0.055, 0.055, 1.9, 8), S.chrome, [0, 1.25, -0.74]);
  // Gabelträger mit Lastschutzgitter und zwei Zinken (Transporthöhe), Palette mit Last
  const fy = load ? 0.2 : 0.12;
  B.add(K.box(0.86, 0.42, 0.06), dark, [0, fy + 0.33, -0.89]);
  for (const yy of [0.14, 0.44]) B.add(K.box(0.9, 0.08, 0.04), dark2, [0, fy + yy + 0.04, -0.93]);
  for (let k = -2; k <= 2; k++) B.add(K.box(0.03, 0.62, 0.03), dark, [k * 0.2, fy + 0.85, -0.9]);
  B.add(K.box(0.86, 0.04, 0.04), dark, [0, fy + 1.16, -0.9]);
  for (const sx of [-0.19, 0.19]) {
    B.add(K.box(0.12, 0.62, 0.05), dark, [sx, fy + 0.31, -0.92]);
    B.add(K.box(0.12, 0.045, 1.1), dark, [sx, fy + 0.0225, -1.5]);
  }
  if (load) {
    const y0 = fy - 0.035, pz = -1.56, wood = S.wood;
    for (const xx of [-0.35, 0, 0.35]) B.add(K.box(0.1, 0.022, 1.2), wood, [xx, y0 + 0.011, pz]);
    for (const xx of [-0.35, 0, 0.35]) for (const zz of [-0.53, 0, 0.53]) B.add(K.box(0.1, 0.078, 0.145), wood, [xx, y0 + 0.061, pz + zz]);
    for (const zz of [-0.53, 0, 0.53]) B.add(K.box(0.8, 0.022, 0.145), wood, [0, y0 + 0.111, pz + zz]);
    for (let k = 0; k < 5; k++) B.add(K.box(0.13, 0.022, 1.2), wood, [-0.34 + k * 0.17, y0 + 0.133, pz]);
    const ty = y0 + 0.144;
    if (load === 1) {
      for (let L = 0; L < 2; L++) for (const xx of [-0.2, 0.2]) for (const zz of [-0.3, 0.3]) {
        B.add(K.box(0.38, 0.32, 0.58), S.carton, [xx, ty + 0.16 + L * 0.325, pz + zz]);
        if (lod === 0) B.add(K.box(0.06, 0.004, 0.585), S.plate, [xx, ty + 0.322 + L * 0.325, pz + zz]);
      }
    } else {
      for (let L = 0; L < 2; L++) for (let k = 0; k < 3; k++) {
        const g = lod === 0 ? K.topExtrude([[-0.36, 0.17], [0.36, 0.17], [0.36, -0.17], [-0.36, -0.17]], 0.12, true) : K.box(0.78, 0.18, 0.38);
        if (lod !== 0) g.translate(0, 0.09, 0);
        B.add(g, S.sack, [0, ty + 0.01 + L * 0.19, pz - 0.4 + k * 0.4], [0, L ? 0.04 : -0.03, 0]);
      }
    }
  }
  B.build(hull, { shadow: true });
  LB.build(hull, { shadow: false });
  const out = { hull, wheels };
  if (lod === 0) {
    const C = [0, 1.5, -0.22], tilt = -1.05, r = 0.17;
    out.extra = [steeringWheel(K, S, C, tilt, r), seatedFigure(K, S, 0, [0, 1.25, 0.47], 0.62, { c: C, r, tilt })];
  }
  return out;
}

export const CIVIL_BUILDERS = { pkw: buildPkw, transporter: buildTransporter, stapler: buildStapler, zugmaschine: buildZugmaschine };
