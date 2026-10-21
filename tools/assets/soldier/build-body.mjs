// soldier-body-v1: erzeugt den Soldatenkörper (ein durchgehendes, gehäutetes Netz je Detailstufe) für
// assets/js/game/bots/soldier/gear.js.
//   node tools/assets/soldier/build-body.mjs [--res=0.004] [--lod0=7000] [--lod1=2600] [--lod2=700] [--obj]
// Nutzer 21.10.: „sehen aus wie B1-Kampfdroiden … menschlicher machen“. Statt starrer Röhren je Knochen ein Körper
// aus einem Guss: vorzeichenbehaftetes Distanzfeld aus anatomischen Grundkörpern (Becken, Bauch, Brustkorb, Brust-,
// Rücken-, Kapuzen- und Gesäßmuskeln, Hals mit Kopfwendern, Schädel/Gesicht mit Nase, Brauen, Augenhöhlen, Ohren;
// Deltamuskel, Bizeps/Trizeps, Unterarm, Handschuh-Faust um den Griffpunkt; Oberschenkel mit Quadrizeps/Beuger/
// Adduktoren, Knie, Wade, Stiefel mit Sohle) in Uniform (Ärmel- und Beintaschen, Bündchen, über den Stiefeln
// gebauschte Hose, Falten an Ellbogen, Knie, Bauch und Oberschenkel) – glatt vereinigt (smooth-min).
// Gebaut in einer A-Haltung (Arme 31° abgespreizt, Beine 6°), damit Arme/Rumpf und die Beine getrennte Flächen
// bekommen; Oberfläche per Surface Nets, mit meshoptimizer vereinfacht, auf die Fläche projiziert; Hautgewichte je
// Gelenk (Gruppen weich nach Nähe, entlang der Kette über Gelenkebenen, ≤ 4 Knochen); danach per inverser
// Gewichtsmischung in die Bindehaltung des Skeletts (rig.js: Arme hängen, Beine senkrecht) zurückgeführt.
// UV in Metern je Insel (Rumpf, Kopf, Arme, Beine: abgewickelte Zylinder, Nähte innen/hinten, Ecken an Nähten doppelt),
// Bereichsnummer je Ecke (Hemd, Ärmel, Unterarm, Handschuh, Hose, Stiefel, Sohle, Hals, Schädel, Augenpartie,
// Gesicht, Ohren, Tasche, Kragen) für die Materialien je Ausführung + Feld-Umgebungsverdeckung.
// Ausgabe: assets/js/game/bots/soldier/body-mesh.js (quantisiert, base64).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MeshoptSimplifier } from '../node_modules/meshoptimizer/index.js';
import { BONE, BIND, DIM } from '../../../assets/js/game/bots/soldier/rig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const RES = Number(opt.res || 0.004);
const TARGETS = [Number(opt.lod0 || 9500), Number(opt.lod1 || 3000), Number(opt.lod2 || 700)];
const ERRS = [0.03, 0.4, 0.8];           // Fehlergrenzen (relativ) je Stufe
const AW = [1, 0.5, 0.15];               // Gewicht der Attribute je Stufe
const t0 = Date.now();
const log = (s) => console.log(`${s} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// ------------------------------------------------------------------ Maße aus dem Skelett
const SX = DIM.shoulderX;                   // Schultergelenk x
const SY = BIND[BONE.upperArmR][1];         // Schultergelenk y
const EY = BIND[BONE.foreArmR][1];          // Ellbogen
const WY = BIND[BONE.handR][1];             // Handgelenk
const HX = BIND[BONE.thighR][0];            // Hüftgelenk x
const HY = BIND[BONE.thighR][1];            // Hüftgelenk y
const KY = BIND[BONE.shinR][1];             // Knie
const AY = BIND[BONE.footR][1];             // Knöchel
const TA = 0.78;                            // Bauhaltung: Arme abgespreizt (rad)
const TL = 0.13;                            // Bauhaltung: Beine abgespreizt (rad)

// ------------------------------------------------------------------ Distanzfeld-Bausteine
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }
function ellipsoid(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az;
  const h = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
  return Math.hypot(px - dx * h, py - dy * h, pz - dz * h) - r;
}
function roundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
// senkrechter, abgerundeter Kegel: oben (yT, r1) → unten (yB, r2) um die Achse (0, 0) im Querschnitt (px, pz)
function coneY(px, y, pz, yT, yB, r1, r2) {
  const qx = Math.hypot(px, pz), qy = yT - y, h = yT - yB;
  const b = (r1 - r2) / h, a = Math.sqrt(1 - b * b);
  const k = -b * qx + a * qy;
  if (k < 0) return Math.hypot(qx, qy) - r1;
  if (k > a * h) return Math.hypot(qx, qy - h) - r2;
  return qx * a + qy * b - r1;
}
// Aufgesetztes Stoffteil (Tasche, Polster, Leiste): Oberfläche um t nach außen versetzt, nur im Bereich reg (< 0 innen) –
// folgt der Körperform, mit kleiner Rundung an der Kante (Naht)
function patch(d, reg, t, k = 0.0015) { return smin(d, Math.max(d - t, reg), k); }
// abgerundetes Rechteck in (u, v) als Bereichsfunktion (Meter)
function rect(u, v, hu, hv, r = 0.004) {
  const qu = Math.abs(u) - hu + r, qv = Math.abs(v) - hv + r;
  return Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) + Math.min(Math.max(qu, qv), 0) - r;
}
// Wertrauschen 3D (glatt, deterministisch) für Faltenverläufe
function hash3(i, j, k) { let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(i, j, k), hash3(i + 1, j, k), u), L(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), u), v),
    L(L(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), u), L(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), u), v), w) * 2 - 1;
}

// ------------------------------------------------------------------ Körperteile (Bindehaltung, je Glied lokal)
// Rumpf (symmetrisch, ax = |x|): Hemd bis zum Gürtel, darunter Hose; Falten über dem Gürtel
function trunkD(ax, y, z) {
  let d = ellipsoid(ax, y - 0.955, z - 0.008, 0.18, 0.12, 0.13);                    // Becken
  d = smin(d, ellipsoid(ax, y - 1.085, z, 0.172, 0.135, 0.13), 0.07);               // Bauch
  d = smin(d, ellipsoid(ax, y - 1.29, z - 0.005, 0.188, 0.19, 0.145), 0.07);        // Brustkorb
  d = smin(d, ellipsoid(ax - 0.078, y - 1.34, z + 0.075, 0.095, 0.075, 0.064), 0.04); // Brustmuskeln
  d = smin(d, ellipsoid(ax - 0.13, y - 1.27, z - 0.016, 0.062, 0.14, 0.095), 0.05);   // breiter Rückenmuskel
  d = smin(d, ellipsoid(ax - 0.08, y - 1.35, z - 0.075, 0.1, 0.12, 0.07), 0.05);      // oberer Rücken/Schulterblätter
  d = smin(d, capsule(ax, y, z, 0, 1.505, 0.03, SX - 0.035, 1.462, 0.012, 0.07), 0.07);   // Kapuzenmuskel → Schulter
  d = smin(d, ellipsoid(ax - 0.082, y - 0.895, z - 0.07, 0.096, 0.106, 0.082), 0.04); // Gesäß
  // Kragen (Stehkragen des Kampfhemds)
  d = smin(d, coneY(ax, y, z - 0.012, 1.565, 1.47, 0.08, 0.098), 0.02);  // hoher Stehkragen (Nacken bedeckt wie im Video)
  // Bauchfalten über dem Gürtel, leichte Knitter am Hemd
  const fm = smooth(1.0, 1.02, y) * smooth(1.14, 1.06, y);
  d += 0.0022 * Math.sin(y * 92 + vnoise(ax * 14, y * 6, z * 14) * 2.2) * fm;
  d += 0.0011 * vnoise(ax * 22, y * 9, z * 22) * smooth(1.0, 1.05, y);
  // 21.10. Kleidungsdetails (Nutzer: „gar keine Details an der Kleidung“): Reißverschlussleiste, Brusttaschen mit
  // Klappen, Rückenpasse, Gesäßtaschen mit Klappen
  const front = z + 0.03, back = 0.03 - z;
  d = patch(d, Math.max(rect(ax, y - 1.27, 0.011, 0.24), front), 0.0035);
  d = patch(d, Math.max(rect(ax - 0.085, y - 1.345, 0.048, 0.058), front), 0.006);
  d = patch(d, Math.max(rect(ax - 0.085, y - 1.402, 0.053, 0.016), front), 0.0095);
  d = patch(d, Math.max(rect(ax, y - 1.43, 0.17, 0.005), back), 0.0028);
  d = patch(d, Math.max(rect(ax - 0.085, y - 0.9, 0.058, 0.062), 0.05 - z), 0.005);
  d = patch(d, Math.max(rect(ax - 0.085, y - 0.952, 0.063, 0.014), 0.05 - z), 0.0085);
  return d;
}
// Kopf + Hals (Sturmhaube eng anliegend)
function headD(x, y, z) {
  const ax = Math.abs(x);
  let d = coneY(ax, y, z - 0.012, 1.63, 1.46, 0.066, 0.086);                         // Hals
  d = smin(d, capsule(ax, y, z, 0.054, 1.652, 0.018, 0.02, 1.49, -0.045, 0.022), 0.02); // Kopfwender
  d = smin(d, ellipsoid(ax, y - 1.705, z - 0.008, 0.077, 0.092, 0.098), 0.03);       // Schädel
  d = smin(d, ellipsoid(ax, y - 1.64, z + 0.028, 0.062, 0.062, 0.072), 0.035);        // Gesicht/Kiefer
  d = smin(d, ellipsoid(ax, y - 1.592, z + 0.062, 0.03, 0.025, 0.028), 0.02);         // Kinn
  d = smin(d, ellipsoid(ax - 0.05, y - 1.615, z, 0.02, 0.025, 0.03), 0.02);           // Kieferwinkel
  d = smin(d, ellipsoid(ax - 0.045, y - 1.67, z + 0.072, 0.022, 0.015, 0.02), 0.012); // Wangenknochen
  d = smin(d, capsule(x, y, z, -0.038, 1.71, -0.088, 0.038, 1.71, -0.088, 0.012), 0.012); // Brauen
  d = smin(d, capsule(x, y, z, 0, 1.695, -0.094, 0, 1.658, -0.108, 0.0105), 0.008);  // Nasenrücken
  d = smin(d, ellipsoid(x, y - 1.655, z + 0.1, 0.017, 0.009, 0.01), 0.006);           // Nasenflügel
  d = smax(d, -ellipsoid(ax - 0.033, y - 1.692, z + 0.096, 0.018, 0.011, 0.014), 0.008); // Augenhöhlen
  d = smin(d, ellipsoid(x, y - 1.622, z + 0.093, 0.024, 0.009, 0.01), 0.006);         // Lippen
  d = smin(d, ellipsoid(ax - 0.078, y - 1.675, z - 0.012, 0.011, 0.03, 0.019), 0.008); // Ohren
  return d;
}
// Arm in Gliedkoordinaten: lx nach außen, ly wie Bindehaltung, z (vorn −)
const GRIP = [-0.026, WY - 0.062];          // Griffpunkt (wie animator.js GRIP_R)
function armD(lx, ly, z) {
  let d = coneY(lx, ly, z, SY + 0.005, EY, 0.07, 0.058);                             // Oberarm
  d = smin(d, ellipsoid(lx - 0.02, ly - (SY - 0.03), z, 0.08, 0.1, 0.09), 0.035);     // Deltamuskel
  d = smin(d, ellipsoid(lx, ly - (SY - 0.16), z + 0.024, 0.056, 0.085, 0.053), 0.03); // Bizeps
  d = smin(d, ellipsoid(lx - 0.006, ly - (SY - 0.125), z - 0.024, 0.058, 0.095, 0.054), 0.03); // Trizeps
  d = smin(d, Math.hypot(lx, ly - (EY + 0.005), z - 0.012) - 0.054, 0.03);             // Ellbogen
  d = smin(d, coneY(lx / 0.88, ly, z, EY, WY + 0.02, 0.062, 0.042) * 0.88, 0.02);       // Unterarm (flach)
  d = smin(d, ellipsoid(lx - 0.004, ly - (EY - 0.065), z + 0.004, 0.056, 0.085, 0.064), 0.03); // Unterarmmuskeln
  d = smin(d, coneY(lx, ly, z, WY + 0.045, WY + 0.02, 0.045, 0.047), 0.012);           // Ärmelbündchen
  // Ärmeltasche (Oberarm außen) mit Klappe
  d = smin(d, roundBox(lx - 0.073, ly - (SY - 0.1), z + 0.002, 0.009, 0.042, 0.038, 0.005), 0.005);
  // Ellbogenfalten (Beuge vorn) + leichte Knitter
  const em = Math.exp(-(((ly - EY - 0.01) / 0.05) ** 2));
  d += 0.0024 * Math.sin((ly - EY) * 125 + vnoise(lx * 30, ly * 20, z * 30) * 2) * em * smooth(0.01, -0.03, z);
  d += 0.001 * vnoise(lx * 25, ly * 12, z * 25) * smooth(WY + 0.04, WY + 0.08, ly);
  // Ellbogenschoner-Tasche (hinten), Klappe der Ärmeltasche, Klettlasche am Bündchen
  d = patch(d, Math.max((Math.hypot((ly - EY + 0.01) / 0.065, lx / 0.05) - 1) * 0.05, 0.005 - z), 0.006);
  d = smin(d, roundBox(lx - 0.085, ly - (SY - 0.052), z + 0.002, 0.005, 0.012, 0.041, 0.003), 0.003);
  d = smin(d, roundBox(lx - 0.047, ly - (WY + 0.031), z + 0.002, 0.004, 0.012, 0.018, 0.003), 0.003);
  return smin(d, handD(lx, ly, z), 0.012);
}
// Handschuh: Handgelenkstulpe, Handteller außen, Finger als Bogen um den Griffpunkt, Knöchel, Daumen mit Ballen
function handD(lx, ly, z) {
  let d = coneY(lx, ly, z, WY + 0.03, WY - 0.012, 0.04, 0.036);                        // Stulpe
  d = smin(d, roundBox(lx - 0.004, ly - (WY - 0.047), z, 0.02, 0.046, 0.045, 0.015), 0.012); // Handteller
  // Finger: Bogen (Radius R, Röhre r) um den Griffpunkt von außen über unten nach innen, 7 cm breit
  const cx = lx - GRIP[0], cy = ly - GRIP[1];
  const R = 0.029, r = 0.0142, a0 = 0.15, span = 3.6;
  const phi = Math.atan2(cy, cx);
  let t = a0 - phi; t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let d2;
  if (t <= span) d2 = Math.abs(Math.hypot(cx, cy) - R) - r;
  else {
    const e0 = [Math.cos(a0) * R, Math.sin(a0) * R], e1 = [Math.cos(a0 - span) * R, Math.sin(a0 - span) * R];
    d2 = Math.min(Math.hypot(cx - e0[0], cy - e0[1]), Math.hypot(cx - e1[0], cy - e1[1])) - r;
  }
  const dz = Math.abs(z) - 0.04;
  const fing = Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) + Math.min(Math.max(d2, dz), 0);
  // Fingerrillen (zwischen den vier Fingern)
  const groove = 0.0012 * Math.cos(z / 0.068 * 4 * Math.PI * 2) * smooth(0.04, 0.03, Math.abs(z));
  d = smin(d, fing + groove, 0.01);
  d = smin(d, capsule(lx, ly, z, 0.009, WY - 0.089, -0.036, 0.009, WY - 0.089, 0.036, 0.0138), 0.01); // Knöchel
  d = smin(d, ellipsoid(lx + 0.006, ly - (WY - 0.03), z + 0.025, 0.016, 0.025, 0.018), 0.01);       // Daumenballen
  d = smin(d, capsule(lx, ly, z, -0.008, WY - 0.02, -0.035, -0.031, WY - 0.054, -0.047, 0.0122), 0.008); // Daumen
  d = smin(d, roundBox(lx - 0.024, ly - (WY - 0.045), z, 0.004, 0.028, 0.034, 0.004), 0.004);             // Handrückenpolster
  return d;
}
// Bein in Gliedkoordinaten (lx nach außen)
function legD(lx, ly, z) {
  let d = coneY(lx / 0.95, ly, z, HY + 0.02, KY + 0.01, 0.115, 0.074) * 0.95;          // Oberschenkel
  d = smin(d, ellipsoid(lx - 0.008, ly - 0.72, z + 0.032, 0.092, 0.19, 0.084), 0.04);   // Quadrizeps
  d = smin(d, ellipsoid(lx, ly - 0.72, z - 0.032, 0.084, 0.18, 0.078), 0.04);          // Beuger
  d = smin(d, ellipsoid(lx + 0.03, ly - 0.8, z, 0.075, 0.1, 0.072), 0.04);             // Adduktoren
  d = smin(d, Math.hypot(lx, ly - KY, z + 0.008) - 0.072, 0.04);                       // Knie
  d = smin(d, ellipsoid(lx, ly - KY, z + 0.045, 0.03, 0.035, 0.02), 0.02);             // Kniescheibe
  d = smin(d, coneY(lx, ly, z, KY, AY + 0.04, 0.066, 0.05), 0.03);                     // Schienbein
  d = smin(d, ellipsoid(lx - 0.004, ly - 0.37, z - 0.024, 0.072, 0.125, 0.074), 0.04);  // Wade
  // Beintasche (außen) + Klappe mit Fuge
  d = smin(d, roundBox(lx - 0.097, ly - 0.7, z + 0.004, 0.012, 0.082, 0.078, 0.008), 0.008);
  d = smax(d, -roundBox(lx - 0.111, ly - 0.745, z + 0.004, 0.006, 0.0015, 0.084, 0.001), 0.002);
  // Kniepolster-Taschen (vorn), Außennaht, Wadentasche, erhabene Klappe der Beintasche
  d = patch(d, Math.max((Math.hypot((ly - KY - 0.015) / 0.075, lx / 0.065) - 1) * 0.06, z + 0.02), 0.007);
  d = patch(d, Math.max(Math.abs(z + 0.004) - 0.005, 0.03 - lx, Math.abs(ly - 0.6) - 0.3), 0.0025);
  d = smin(d, roundBox(lx - 0.077, ly - 0.38, z + 0.006, 0.009, 0.05, 0.04, 0.005), 0.006);
  d = smin(d, roundBox(lx - 0.112, ly - 0.766, z + 0.004, 0.005, 0.018, 0.081, 0.003), 0.003);
  // Hose über dem Stiefelschaft gebauscht (mit Längsfalten)
  const ang = Math.atan2(z, lx);
  d = smin(d, coneY(lx, ly, z, 0.27, 0.205, 0.074, 0.078) + 0.0028 * Math.sin(ang * 13 + vnoise(ly * 30, 0, ang) * 2), 0.02);
  // Stiefel: Schaft, Ferse, Rist, Kappe, Sohle (etwas breiter, Profilrand)
  let b = coneY(lx, ly, z, 0.212, AY - 0.01, 0.066, 0.058);
  b = smin(b, ellipsoid(lx, ly - 0.05, z - 0.035, 0.042, 0.05, 0.045), 0.02);
  b = smin(b, capsule(lx, ly, z, 0, 0.075, -0.01, 0, 0.045, -0.14, 0.043), 0.02);
  b = smin(b, ellipsoid(lx - 0.002, ly - 0.04, z + 0.165, 0.046, 0.036, 0.055), 0.02);
  b = smin(b, roundBox(lx - 0.002, ly - 0.014, z + 0.07, 0.051, 0.014, 0.148, 0.008), 0.006);
  // Schnürung: Querstege vorn auf Schaft und Rist, Fersenkappe
  for (let i = 0; i < 6; i++) {
    const yy = 0.1 + i * 0.019, rr = 0.058 + 0.008 * (yy - 0.07) / 0.142;
    b = smin(b, capsule(lx, ly, z, -0.019, yy, -rr - 0.001, 0.019, yy, -rr - 0.001, 0.0034), 0.002);
  }
  for (const [yy, zz] of [[0.11, -0.043], [0.104, -0.068], [0.097, -0.092]]) b = smin(b, capsule(lx, ly, z, -0.018, yy, zz, 0.018, yy, zz, 0.0034), 0.002);
  b = patch(b, Math.max(rect(lx, ly - 0.05, 0.04, 0.035), 0.04 - z), 0.004);
  d = smin(d, b, 0.015);
  // Kniefalten (ringsum, hinten stärker), Oberschenkel-Faltenwurf, Knitter
  const km = Math.exp(-(((ly - KY - 0.03) / 0.065) ** 2));
  d += 0.0032 * Math.sin((ly - KY) * 135 + vnoise(lx * 25, ly * 12, z * 25) * 2.5) * km * (0.6 + 0.4 * smooth(-0.02, 0.04, z)) * smooth(0.27, 0.3, ly);
  const tm = smooth(0.56, 0.62, ly) * smooth(HY + 0.02, HY - 0.08, ly);
  d += 0.0018 * Math.sin(ang * 5 + ly * 16 + vnoise(lx * 9, ly * 5, z * 9) * 2.5) * tm;
  d += 0.0011 * vnoise(lx * 24, ly * 10, z * 24) * smooth(0.25, 0.3, ly);
  return d;
}

// ------------------------------------------------------------------ Bauhaltung (A-Haltung) und Gliedkoordinaten
const cA = Math.cos(TA), sA = Math.sin(TA), cL = Math.cos(TL), sL = Math.sin(TL);
// Weltpunkt (Bauhaltung) → Gliedkoordinaten in Bindehaltung; s = −1 links, +1 rechts
function limbLocal(x, y, s, jx, jy, c, sn, out) {
  const dx = x - s * jx, dy = y - jy;
  const xr = dx * c + dy * sn * s, yr = -dx * sn * s + dy * c;
  out[0] = s * xr; out[1] = jy + yr;
  return out;
}
const _a = [0, 0];
const G = new Float64Array(6);              // 0 Rumpf, 1 Kopf, 2 Arm L, 3 Arm R, 4 Bein L, 5 Bein R
function field(x, y, z) {
  const ax = Math.abs(x);
  G[0] = trunkD(ax, y, z);
  G[1] = headD(x, y, z);
  limbLocal(x, y, -1, SX, SY, cA, sA, _a); G[2] = armD(_a[0], _a[1], z);
  limbLocal(x, y, 1, SX, SY, cA, sA, _a); G[3] = armD(_a[0], _a[1], z);
  limbLocal(x, y, -1, HX, HY, cL, sL, _a); G[4] = legD(_a[0], _a[1], z);
  limbLocal(x, y, 1, HX, HY, cL, sL, _a); G[5] = legD(_a[0], _a[1], z);
  let d = smin(G[0], G[1], 0.03);
  d = smin(d, G[2], 0.025); d = smin(d, G[3], 0.025);
  d = smin(d, Math.min(G[4], G[5]), 0.03);
  return d;
}

// ------------------------------------------------------------------ Gitter (grob → fein) + Surface Nets
const handX = SX + Math.sin(TA) * (SY - WY + 0.12) + 0.05;
const BX = [-handX, handX], BY = [-0.02, 1.84], BZ = [-0.26, 0.2];
function sample(res) {
  const nx = Math.ceil((BX[1] - BX[0]) / res) + 1, ny = Math.ceil((BY[1] - BY[0]) / res) + 1, nz = Math.ceil((BZ[1] - BZ[0]) / res) + 1;
  return { nx, ny, nz, res, f: new Float32Array(nx * ny * nz) };
}
const C = sample(0.016);
for (let k = 0; k < C.nz; k++) for (let j = 0; j < C.ny; j++) for (let i = 0; i < C.nx; i++)
  C.f[(k * C.ny + j) * C.nx + i] = field(BX[0] + i * C.res, BY[0] + j * C.res, BZ[0] + k * C.res);
const F = sample(RES);
let exact = 0;
for (let k = 0; k < F.nz; k++) {
  const z = BZ[0] + k * RES, cz = Math.min((z - BZ[0]) / C.res, C.nz - 1.001), kz = cz | 0, fz = cz - kz;
  for (let j = 0; j < F.ny; j++) {
    const y = BY[0] + j * RES, cy = Math.min((y - BY[0]) / C.res, C.ny - 1.001), ky = cy | 0, fy = cy - ky;
    for (let i = 0; i < F.nx; i++) {
      const x = BX[0] + i * RES, cx = Math.min((x - BX[0]) / C.res, C.nx - 1.001), kx = cx | 0, fx = cx - kx;
      const c = (a, b, e) => C.f[((kz + e) * C.ny + ky + b) * C.nx + kx + a];
      const v = (1 - fz) * ((1 - fy) * ((1 - fx) * c(0, 0, 0) + fx * c(1, 0, 0)) + fy * ((1 - fx) * c(0, 1, 0) + fx * c(1, 1, 0)))
        + fz * ((1 - fy) * ((1 - fx) * c(0, 0, 1) + fx * c(1, 0, 1)) + fy * ((1 - fx) * c(0, 1, 1) + fx * c(1, 1, 1)));
      const idx = (k * F.ny + j) * F.nx + i;
      if (Math.abs(v) > 0.022) F.f[idx] = v; else { F.f[idx] = field(x, y, z); exact++; }
    }
  }
}
log(`Gitter ${F.nx}×${F.ny}×${F.nz} (genau ${exact})`);

const { nx, ny, nz } = F, NI = (i, j, k) => (k * ny + j) * nx + i;
const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
const CI = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
const P = [];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const corner = new Float64Array(8);
for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
  let mask = 0;
  for (let c = 0; c < 8; c++) { const v = F.f[NI(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; corner[c] = v; if (v < 0) mask |= 1 << c; }
  if (mask === 0 || mask === 255) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    const va = corner[a], vb = corner[b];
    if ((va < 0) === (vb < 0)) continue;
    const t = va / (va - vb);
    sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
  }
  cellV[CI(i, j, k)] = P.length / 3;
  P.push(BX[0] + (i + sx / n) * RES, BY[0] + (j + sy / n) * RES, BZ[0] + (k + sz / n) * RES);
}
const T = [];
function quad(a, b, c, d) { if (a < 0 || b < 0 || c < 0 || d < 0) return; T.push(a, b, c, a, c, d); }
for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const v0 = F.f[NI(i, j, k)] < 0;
  if (v0 !== (F.f[NI(i + 1, j, k)] < 0)) quad(cellV[CI(i, j - 1, k - 1)], cellV[CI(i, j, k - 1)], cellV[CI(i, j, k)], cellV[CI(i, j - 1, k)]);
  if (v0 !== (F.f[NI(i, j + 1, k)] < 0)) quad(cellV[CI(i - 1, j, k - 1)], cellV[CI(i, j, k - 1)], cellV[CI(i, j, k)], cellV[CI(i - 1, j, k)]);
  if (v0 !== (F.f[NI(i, j, k + 1)] < 0)) quad(cellV[CI(i - 1, j - 1, k)], cellV[CI(i, j - 1, k)], cellV[CI(i, j, k)], cellV[CI(i - 1, j, k)]);
}
log(`Surface Nets: ${P.length / 3} Ecken, ${T.length / 3} Dreiecke`);

const _g = [0, 0, 0];
function grad(x, y, z, h = 0.0004) {
  _g[0] = field(x + h, y, z) - field(x - h, y, z); _g[1] = field(x, y + h, z) - field(x, y - h, z); _g[2] = field(x, y, z + h) - field(x, y, z - h);
  const l = Math.hypot(_g[0], _g[1], _g[2]) || 1; _g[0] /= l; _g[1] /= l; _g[2] /= l;
  return _g;
}
function project(pos) {
  for (let v = 0; v < pos.length; v += 3) for (let it = 0; it < 3; it++) {
    const d = field(pos[v], pos[v + 1], pos[v + 2]);
    if (Math.abs(d) < 1e-5) break;
    const g = grad(pos[v], pos[v + 1], pos[v + 2]);
    const s = clamp(d, -RES, RES);
    pos[v] -= g[0] * s; pos[v + 1] -= g[1] * s; pos[v + 2] -= g[2] * s;
  }
}
function orientTris(pos, idx) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
    const g = grad((pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3);
    if (nx_ * g[0] + ny_ * g[1] + nz_ * g[2] < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
}
const pos0 = new Float32Array(P);
project(pos0);
const idx0 = new Uint32Array(T);
orientTris(pos0, idx0);

// ------------------------------------------------------------------ Hautgewichte (Bauhaltung)
const NB = 17;
const gw = new Float64Array(6);
function groupWeights(x, y, z) {
  field(x, y, z);
  let gmin = Infinity;
  for (let g = 0; g < 6; g++) gmin = Math.min(gmin, G[g]);
  let s = 0;
  for (let g = 0; g < 6; g++) { gw[g] = Math.exp(-(G[g] - gmin) / 0.01); s += gw[g]; }
  for (let g = 0; g < 6; g++) gw[g] /= s;
  return gw;
}
function weightsAt(x, y, z, out) {
  out.fill(0);
  groupWeights(x, y, z);
  // Rumpf: Becken → Lende → Brust → Hals
  if (gw[0] > 1e-4) {
    const b1 = smooth(0.97, 1.09, y), b2 = smooth(1.15, 1.27, y), b3 = smooth(1.47, 1.515, y);
    out[BONE.hips] += gw[0] * (1 - b1); out[BONE.spine] += gw[0] * b1 * (1 - b2);
    out[BONE.chest] += gw[0] * b1 * b2 * (1 - b3); out[BONE.neck] += gw[0] * b1 * b2 * b3;
  }
  if (gw[1] > 1e-4) {
    const bn = smooth(1.47, 1.515, y), bh = smooth(1.55, 1.6, y);
    out[BONE.chest] += gw[1] * (1 - bn); out[BONE.neck] += gw[1] * bn * (1 - bh); out[BONE.head] += gw[1] * bn * bh;
  }
  for (const [g, s, ua, fa, ha] of [[2, -1, BONE.upperArmL, BONE.foreArmL, BONE.handL], [3, 1, BONE.upperArmR, BONE.foreArmR, BONE.handR]]) {
    if (gw[g] < 1e-4) continue;
    limbLocal(x, y, s, SX, SY, cA, sA, _a);
    const ly = _a[1];
    const bs = smooth(-0.07, 0.03, SY - ly), be = smooth(-0.035, 0.035, EY - ly), bw = smooth(-0.022, 0.018, WY + 0.012 - ly);
    out[BONE.chest] += gw[g] * (1 - bs); out[ua] += gw[g] * bs * (1 - be); out[fa] += gw[g] * bs * be * (1 - bw); out[ha] += gw[g] * bs * be * bw;
  }
  for (const [g, s, th, sh, ft] of [[4, -1, BONE.thighL, BONE.shinL, BONE.footL], [5, 1, BONE.thighR, BONE.shinR, BONE.footR]]) {
    if (gw[g] < 1e-4) continue;
    limbLocal(x, y, s, HX, HY, cL, sL, _a);
    const ly = _a[1];
    const bh = smooth(-0.04, 0.08, HY - ly), bk = smooth(-0.045, 0.045, KY - ly);
    const ba = Math.max(smooth(-0.02, 0.035, AY + 0.005 - ly), smooth(-0.03, -0.07, z) * smooth(0.14, 0.1, ly));
    out[BONE.hips] += gw[g] * (1 - bh); out[th] += gw[g] * bh * (1 - bk); out[sh] += gw[g] * bh * bk * (1 - ba); out[ft] += gw[g] * bh * bk * ba;
  }
  return out;
}

// Rückführung in die Bindehaltung: Bauhaltung = Σ w·T_b · Bindehaltung (T_b = Drehung der Gliedkette um ihr Gelenk)
function boneXform(b) {
  // → [c, s, jx, jy] Drehung um z (Winkel) um Gelenk (jx, jy), oder null
  const arm = { [BONE.upperArmL]: -1, [BONE.foreArmL]: -1, [BONE.handL]: -1, [BONE.upperArmR]: 1, [BONE.foreArmR]: 1, [BONE.handR]: 1 };
  const leg = { [BONE.thighL]: -1, [BONE.shinL]: -1, [BONE.footL]: -1, [BONE.thighR]: 1, [BONE.shinR]: 1, [BONE.footR]: 1 };
  if (arm[b]) return [Math.cos(TA * arm[b]), Math.sin(TA * arm[b]), arm[b] * SX, SY];
  if (leg[b]) return [Math.cos(TL * leg[b]), Math.sin(TL * leg[b]), leg[b] * HX, HY];
  return null;
}
const XF = Array.from({ length: NB }, (_, b) => boneXform(b));
function unpose(x, y, z, n, W, outP, outN) {
  // M = Σ w_b T_b (affin in xy, z bleibt): [m00 m01 tx; m10 m11 ty]
  let m00 = 0, m01 = 0, m10 = 0, m11 = 0, tx = 0, ty = 0;
  for (let b = 0; b < NB; b++) {
    const w = W[b]; if (w <= 0) continue;
    const X = XF[b];
    if (!X) { m00 += w; m11 += w; continue; }
    const [c, s, jx, jy] = X;
    // p' = R (p − j) + j  →  R p + (j − R j)
    m00 += w * c; m01 += w * -s; m10 += w * s; m11 += w * c;
    tx += w * (jx - (c * jx - s * jy)); ty += w * (jy - (s * jx + c * jy));
  }
  const det = m00 * m11 - m01 * m10;
  const px = x - tx, py = y - ty;
  outP[0] = (m11 * px - m01 * py) / det; outP[1] = (-m10 * px + m00 * py) / det; outP[2] = z;
  // Normale: n_bind ∝ Mᵀ n
  const nx_ = m00 * n[0] + m10 * n[1], ny_ = m01 * n[0] + m11 * n[1], nz_ = n[2] * (m00 * m11 - m01 * m10 > 0 ? 1 : 1);
  const l = Math.hypot(nx_, ny_, nz_) || 1;
  outN[0] = nx_ / l; outN[1] = ny_ / l; outN[2] = nz_ / l;
}

// ------------------------------------------------------------------ Bereiche (Materialien), Inseln (UV), AO
export const REG = { SHIRT: 0, SLEEVE: 1, FOREARM: 2, GLOVE: 3, PANTS: 4, BOOT: 5, SOLE: 6, NECK: 7, SKULL: 8, EYES: 9, FACE: 10, EARS: 11, POCKET: 12, COLLAR: 13, PAD: 14 };
function dominant() { let best = 0; for (let g = 1; g < 6; g++) if (gw[g] > gw[best]) best = g; return best; }
// Bereich aus Bauhaltung (Gliedkoordinaten) + Bindehaltung (bx, by, bz)
function regionAt(x, y, z, bx, by, bz) {
  groupWeights(x, y, z);
  const g = dominant();
  if (g === 0) {
    if (by > 1.452 && Math.hypot(bx, bz - 0.012) < 0.1) return REG.COLLAR;
    const ab = Math.abs(bx);
    if (bz < -0.03 && Math.abs(ab - 0.085) < 0.056 && by > 1.283 && by < 1.42) return REG.POCKET;
    if (bz > 0.05 && Math.abs(ab - 0.085) < 0.066 && by > 0.836 && by < 0.968) return REG.POCKET;
    return by > 1.005 ? REG.SHIRT : REG.PANTS;
  }
  if (g === 1) {
    const ax = Math.abs(bx);
    if (by < 1.6 && !(bz < -0.045 && by > 1.585)) return REG.NECK;
    if (ax > 0.066 && by > 1.635 && by < 1.715 && bz > -0.025 && bz < 0.045) return REG.EARS;
    if (bz < -0.035 && by > 1.674 && by < 1.716 && ax < 0.074) return REG.EYES;
    if (by < 1.674 && bz < 0.0) return REG.FACE;
    return REG.SKULL;
  }
  if (g === 2 || g === 3) {
    const s = g === 2 ? -1 : 1;
    limbLocal(x, y, s, SX, SY, cA, sA, _a);
    const lx = _a[0], ly = _a[1];
    if (ly < WY + 0.03) return REG.GLOVE;
    if (lx > 0.062 && Math.abs(ly - (SY - 0.1)) < 0.046 && Math.abs(z + 0.002) < 0.041) return REG.POCKET;
    if (z > 0.005 && Math.hypot((ly - EY + 0.01) / 0.065, lx / 0.05) < 1) return REG.PAD;
    return ly > EY - 0.055 ? REG.SLEEVE : REG.FOREARM;
  }
  const s = g === 4 ? -1 : 1;
  limbLocal(x, y, s, HX, HY, cL, sL, _a);
  const lx = _a[0], ly = _a[1];
  if (ly < 0.212) return ly < 0.03 ? REG.SOLE : REG.BOOT;
  if (lx > 0.09 && Math.abs(ly - 0.7) < 0.084 && Math.abs(z + 0.004) < 0.082) return REG.POCKET;
  if (lx > 0.068 && Math.abs(ly - 0.38) < 0.052 && Math.abs(z + 0.006) < 0.042) return REG.POCKET;
  if (z < -0.02 && Math.hypot((ly - KY - 0.015) / 0.075, lx / 0.065) < 1) return REG.PAD;
  return REG.PANTS;
}
// Inseln: 0 Rumpf, 1 Kopf, 2/3 Arm L/R, 4/5 Bein L/R → UV-Abwicklung in Bindehaltung
const ISL_R = [0.16, 0.085, 0.05, 0.05, 0.085, 0.085];
function islandAngle(isl, bx, bz) {
  if (isl <= 1) return Math.atan2(bx, -bz);                         // vorn 0, Naht hinten
  const s = isl === 2 || isl === 4 ? -1 : 1, jx = isl <= 3 ? SX : HX;
  const lx = s * (bx - s * jx);
  return Math.atan2(-bz, lx);                                       // außen 0, Naht innen
}
function islandAxis(isl) { return isl <= 1 ? 0 : (isl === 2 || isl === 4 ? -1 : 1) * (isl <= 3 ? SX : HX); }
function fieldAO(x, y, z, n) {
  let occ = 0;
  for (let i = 1; i <= 5; i++) {
    const dl = i * 0.012;
    occ += (dl - field(x + n[0] * dl, y + n[1] * dl, z + n[2] * dl)) / Math.pow(2, i - 1);
  }
  return clamp(1 - occ * 22, 0.3, 1);
}

// ------------------------------------------------------------------ Vereinfachen + Attribute
await MeshoptSimplifier.ready;
const W = new Float64Array(NB);
function build(target, lod) {
  const nv = pos0.length / 3;
  const pos = new Float32Array(pos0), idx = new Uint32Array(idx0);
  const AS = 6, attr = new Float32Array(nv * AS);
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], g = grad(x, y, z);
    weightsAt(x, y, z, W);
    let mx = 0; for (let b = 0; b < NB; b++) mx = Math.max(mx, W[b]);
    const r = regionAt(x, y, z, x, y, z);
    attr.set([g[0], g[1], g[2], mx, (r === REG.GLOVE || r === REG.EYES) ? 1 : 0, r === REG.POCKET ? 1 : 0], v * AS);
  }
  const aw = AW[lod];
  const [cnt, err] = MeshoptSimplifier.simplifyWithUpdate(idx, pos, 3, attr, AS, [0.3, 0.3, 0.3, 0.6, 0.5, 0.3].map((w) => w * aw), null, target * 3, ERRS[lod], lod === 0 ? ['Regularize'] : lod === 1 ? ['Regularize', 'Permissive'] : ['Permissive', 'Prune']);
  const ind = idx.slice(0, cnt);
  const remap = new Int32Array(nv).fill(-1); const keep = [];
  for (let i = 0; i < ind.length; i++) { const v = ind[i]; if (remap[v] < 0) { remap[v] = keep.length; keep.push(v); } ind[i] = remap[v]; }
  const n = keep.length, PB = new Float32Array(n * 3);
  keep.forEach((v, i) => PB.set(pos.subarray(v * 3, v * 3 + 3), i * 3));
  project(PB);
  orientTris(PB, ind);
  // je Ecke: Gewichte, Bindehaltung, Normale, Bereich, Insel, AO
  const PI_ = new Float32Array(n * 3), NI_ = new Float32Array(n * 3), SKI = new Uint8Array(n * 4), SKW = new Uint8Array(n * 4), REGS = new Uint8Array(n), AO = new Uint8Array(n), ISL = new Uint8Array(n);
  const oP = [0, 0, 0], oN = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const x = PB[v * 3], y = PB[v * 3 + 1], z = PB[v * 3 + 2];
    const g = [...grad(x, y, z)];
    weightsAt(x, y, z, W);
    const order = [...W.keys()].sort((a, b) => W[b] - W[a]).slice(0, 4).filter((b) => W[b] > 0.01);
    const s = order.reduce((a, b) => a + W[b], 0);
    let acc = 0;
    const Wq = new Float64Array(NB);
    order.forEach((b, k) => { SKI[v * 4 + k] = b; const q = k === order.length - 1 ? 255 - acc : Math.round(W[b] / s * 255); SKW[v * 4 + k] = q; acc += q; Wq[b] = q / 255; });
    unpose(x, y, z, g, Wq, oP, oN);
    PI_.set(oP, v * 3); NI_.set(oN, v * 3);
    REGS[v] = regionAt(x, y, z, oP[0], oP[1], oP[2]);
    groupWeights(x, y, z); ISL[v] = dominant();
    AO[v] = Math.round(fieldAO(x, y, z, g) * 255);
  }
  // Inseln je Dreieck (Mehrheit der Ecken), Ecken an Insel-/Nahtgrenzen doppelt
  const outV = [], key = new Map(), outI = new Uint32Array(ind.length);
  const UVs = [];
  for (let t = 0; t < ind.length; t += 3) {
    const a = ind[t], b = ind[t + 1], c = ind[t + 2];
    const il = ISL[a] === ISL[b] || ISL[a] === ISL[c] ? ISL[a] : ISL[b] === ISL[c] ? ISL[b] : ISL[a];
    const ang = [a, b, c].map((v) => islandAngle(il, PI_[v * 3], PI_[v * 3 + 2]));
    const wrap = Math.max(...ang) - Math.min(...ang) > Math.PI;
    for (let k = 0; k < 3; k++) {
      const v = ind[t + k];
      let th = ang[k];
      const w = wrap && th < 0 ? 1 : 0;
      if (w) th += 2 * Math.PI;
      const kk = v * 16 + il * 2 + w;
      let o = key.get(kk);
      if (o === undefined) {
        o = outV.length; key.set(kk, o); outV.push(v);
        // v: Höhe, auf Kuppen (Schulter, Kopf, Hand, Sohle) um den Achsabstand abgerollt – sonst fallen dort alle Ecken auf
        // denselben UV-Punkt (Tangentenrahmen aus UV-Ableitungen wird unendlich → helle Streifen)
        const ax = islandAxis(il), rr = Math.hypot(PI_[v * 3] - ax, PI_[v * 3 + 2]);
        UVs.push(th * ISL_R[il], PI_[v * 3 + 1] + (ISL_R[il] - rr) * NI_[v * 3 + 1]);
      }
      outI[t + k] = o;
    }
  }
  const m = outV.length;
  const R = { n: m, tris: ind.length / 3, err, pos: new Float32Array(m * 3), nrm: new Float32Array(m * 3), uv: new Float32Array(UVs), ski: new Uint8Array(m * 4), skw: new Uint8Array(m * 4), reg: new Uint8Array(m), ao: new Uint8Array(m), idx: outI };
  outV.forEach((v, i) => {
    R.pos.set(PI_.subarray(v * 3, v * 3 + 3), i * 3); R.nrm.set(NI_.subarray(v * 3, v * 3 + 3), i * 3);
    R.ski.set(SKI.subarray(v * 4, v * 4 + 4), i * 4); R.skw.set(SKW.subarray(v * 4, v * 4 + 4), i * 4);
    R.reg[i] = REGS[v]; R.ao[i] = AO[v];
  });
  return R;
}
const lods = TARGETS.map((tg, l) => { const r = build(tg, l); log(`LOD${l}: ${r.n} Ecken, ${r.tris} Dreiecke, Fehler ${r.err.toFixed(4)}`); return r; });

// Gesichtsmaße für gear.js (Augen, Stirn): Strahl von vorn auf das Feld (Bindehaltung = Bauhaltung am Kopf)
function frontZ(x, y) { let z = -0.2; for (let i = 0; i < 400; i++) { const d = field(x, y, z); if (d < 1e-4) break; z += Math.max(d * 0.8, 1e-4); } return z; }
const face = { eyeZ: +frontZ(0.033, 1.692).toFixed(4), browZ: +frontZ(0.035, 1.71).toFixed(4), noseZ: +frontZ(0, 1.665).toFixed(4), mouthZ: +frontZ(0, 1.622).toFixed(4), skullTop: 1.705 + 0.092 };
log(`Gesicht ${JSON.stringify(face)}`);

// ------------------------------------------------------------------ Kodieren
const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');
function encode(r) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < r.n; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], r.pos[v * 3 + k]); hi[k] = Math.max(hi[k], r.pos[v * 3 + k]); }
  const sc = hi.map((h, k) => (h - lo[k]) / 65535 || 1);
  const q = new Uint16Array(r.n * 3), nq = new Int8Array(r.n * 3), uq = new Int16Array(r.n * 2);
  for (let v = 0; v < r.n; v++) {
    for (let k = 0; k < 3; k++) {
      q[v * 3 + k] = Math.round((r.pos[v * 3 + k] - lo[k]) / sc[k]);
      nq[v * 3 + k] = Math.round(clamp(r.nrm[v * 3 + k], -1, 1) * 127);
    }
    uq[v * 2] = Math.round(clamp(r.uv[v * 2] * 16000, -32767, 32767)); uq[v * 2 + 1] = Math.round(clamp(r.uv[v * 2 + 1] * 16000, -32767, 32767));
  }
  return { n: r.n, tris: r.tris, lo: lo.map((x) => +x.toFixed(6)), sc: sc.map((x) => +x.toPrecision(7)), pos: b64(q), nrm: b64(nq), uv: b64(uq), idx: b64(new Uint16Array(r.idx)), ski: b64(r.ski), skw: b64(r.skw), reg: b64(r.reg), ao: b64(r.ao) };
}
const enc = { v: 1, rig: { shoulderX: SX, hipX: HX }, face, regions: REG, lods: lods.map(encode) };
const js = `// ERZEUGT von tools/assets/soldier/build-body.mjs (soldier-body-v1) – nicht von Hand ändern.
// Soldatenkörper in Uniform (Bindehaltung aus rig.js), je Detailstufe: pos Uint16 (lo + q·sc), nrm Int8, uv Int16
// (Meter × 16000, Inseln je Rumpf/Kopf/Arm/Bein), idx Uint16, Hautindizes/-gewichte Uint8×4, reg Uint8 (Bereich,
// siehe regions), ao Uint8 (Feld-Umgebungsverdeckung).
export const BODY_MESH = ${JSON.stringify(enc)};
`;
writeFileSync(resolve(ROOT, 'assets/js/game/bots/soldier/body-mesh.js'), js);
log(`body-mesh.js ${(js.length / 1024).toFixed(1)} KB`);

if (opt.obj) {
  mkdirSync(resolve(ROOT, 'tools/out/soldier'), { recursive: true });
  lods.forEach((r, l) => {
    let s = '';
    for (let v = 0; v < r.n; v++) s += `v ${r.pos[v * 3]} ${r.pos[v * 3 + 1]} ${r.pos[v * 3 + 2]}\n`;
    for (let t = 0; t < r.idx.length; t += 3) s += `f ${r.idx[t] + 1} ${r.idx[t + 1] + 1} ${r.idx[t + 2] + 1}\n`;
    writeFileSync(resolve(ROOT, `tools/out/soldier/body-lod${l}.obj`), s);
  });
}
