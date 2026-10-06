// Welle 2 – schwere & besondere Waffen: Titan .50 (Anti-Material, halbautomatisch, Zweibein),
// HF-12 Hagel (Selbstladeflinte mit Kastenmagazin), R-6 Kobra (Revolver mit Schwenktrommel + Schnelllader),
// RW-90 Donnerkeil (Panzerabwehr-Rohr, vorn geladene Raketengranate) und die fliegende Rakete.
import { sniperScope, ejectionPort, triggerGuard, arGrip, slots, roundRect, ellipsePts } from './parts.js';

// Doppelkammer-Mündungsbremse (Anti-Material): breite Seitenfenster
function bigBrake(b, u0, axis) {
  const L = 0.11;
  b.box('steelDark', 0.062, 0.034, L, 0, axis, u0 + L / 2, { c: 0.006 });
  if (b.hi) {
    for (const s of [-1, 1]) for (const du of [0.028, 0.075]) b.box('cavity', 0.004, 0.026, 0.03, s * 0.0298, axis, u0 + du, { c: 0 });
    b.box('steelDark', 0.004, 0.034, 0.008, 0, axis, u0 + 0.052, { c: 0 });
  }
  b.circle('cavity', 0.008, 0, axis, u0 + L + 0.0005);
  return u0 + L;
}

// Rakete (Panzerabwehr-Granate): Spitze vorn (+u), Leitwerk hinten. Für Ladeteil und fliegende Rakete.
function rocketBody(b, u0, axis, o = {}) {
  const part = o.part;
  // Gefechtskopf: Ogive + zylindrischer Körper (Olivlack), Zünderspitze
  b.lathe('paintOlive', [[0, 0.0], [0, 0.034], [0.02, 0.041], [0.075, 0.042], [0.11, 0.036], [0.15, 0.022], [0.172, 0.009], [0.178, 0.0]], 0, axis, u0, { seg: b.seg(20, 8), part });
  b.lathe('steel', [[0.172, 0.009], [0.19, 0.005], [0.194, 0.0]], 0, axis, u0, { seg: b.seg(12, 6), part });
  if (b.hi) {
    b.cyl('paintYellow', 0.0422, 0.0422, 0.008, 0, axis, u0 + 0.06, { seg: 20, part });
    b.cyl('steel', 0.0352, 0.0352, 0.006, 0, axis, u0 + 0.002, { seg: 18, part });
  }
  // Treibladungsrohr hinter dem Kopf (steckt im Werfer), Leitwerk
  b.cyl('steel', 0.019, 0.022, 0.2, 0, axis, u0 - 0.1, { seg: b.seg(16, 6), part });
  if (o.fins !== false) for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    b.box('steel', 0.0018, 0.03, 0.05, Math.cos(a) * 0.03, axis + Math.sin(a) * 0.03, u0 - 0.17, { rz: a - Math.PI / 2, c: 0, part });
  }
}

export function titan(b) {
  const axis = 0.072;
  // Oberes Gehäuse (Stahlblech, lang) mit Schiene, unteres Gehäuse mit Griff
  b.front('steel', roundRect(-0.026, 0.05, 0.026, 0.106, 0.006, b.hi ? 3 : 1), 0.52, -0.22, { bevel: 0.002 });
  b.front('steel', roundRect(-0.024, 0.012, 0.024, 0.052, 0.004, b.hi ? 2 : 1), 0.42, -0.2, { bevel: 0.002 });
  b.rail('steel', 0, 0.106, -0.2, 0.26);
  if (b.hi) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) b.box('cavity', 0.0015, 0.024, 0.04, s * 0.0262, 0.078, 0.07 + i * 0.044, { c: 0 });      // Kühlschlitze
      for (const u of [-0.17, -0.05, 0.12, 0.25]) b.screw('steelBright', s * 0.0265, 0.06, u, 'x', 0.0034);
    }
  }
  // Langer Lauf (kanneliert) + Doppelkammerbremse
  b.cyl('steelDark', 0.0165, 0.0165, 0.5, 0, axis, 0.55, { seg: b.seg(16, 6) });
  if (b.hi) for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; b.box('cavity', 0.004, 0.003, 0.3, Math.cos(a) * 0.0164, axis + Math.sin(a) * 0.0164, 0.5, { rz: a, c: 0 }); }
  const end = bigBrake(b, 0.8, axis);
  b.anchor('muzzle', 0, axis, end + 0.002);
  // Zweibein (eingeklappt nach vorn) am Laufmantel
  b.cyl('steel', 0.022, 0.022, 0.03, 0, axis, 0.33, { seg: b.seg(16, 6) });
  for (const s of [-1, 1]) {
    b.box('steel', 0.009, 0.009, 0.3, s * 0.018, axis - 0.026, 0.49, { rx: 0.04, c: 0.002 });
    b.box('rubber', 0.016, 0.014, 0.03, s * 0.018, axis - 0.032, 0.645, { c: 0.003 });
  }
  // Ladehebel rechts (groß, wie KV-47-Stil)
  b.part('charge', 0.03, 0.08, 0.14);
  b.box('steel', 0.014, 0.014, 0.05, 0.03, 0.08, 0.14, { part: 'charge', c: 0.003 });
  b.cyl('polymer', 0.009, 0.009, 0.028, 0.047, 0.08, 0.15, { part: 'charge', axis: 'x', seg: b.seg(12, 5) });
  b.anchor('chargeGrab', 0.058, 0.08, 0.15, { part: 'charge', data: { travel: [0, 0, 0.11], style: 'right' } });
  ejectionPort(b, 0.0262, 0.078, 0.02, 0.07, 0.026);
  b.part('bolt', 0, 0.078, 0.02);
  b.box('steelBright', 0.005, 0.02, 0.066, 0.023, 0.078, 0.02, { part: 'bolt', c: 0.001 });
  // Griff + Abzugsbügel
  arGrip(b, 'grip', { top: 0.016, w: 0.034 });
  triggerGuard(b, 'steel', 0.02, 0.075, 0.014, 0.032, { t: 0.006, w: 0.016, trigPos: 0.3 });
  // Schaft mit Rückstoßdämpfer-Kappe und Stützfuß
  b.front('steel', roundRect(-0.024, 0.014, 0.024, 0.104, 0.008, b.hi ? 3 : 1), 0.2, -0.42, { bevel: 0.003 });
  b.box('rubber', 0.05, 0.15, 0.03, 0, 0.05, -0.44, { c: 0.008 });
  b.box('polymer', 0.034, 0.028, 0.16, 0, 0.12, -0.33, { c: 0.006 });                  // Wangenauflage
  b.box('steel', 0.014, 0.07, 0.014, 0, -0.025, -0.39, { c: 0.002 });                 // Stützfuß
  // Magazin (10er, groß) vor dem Abzug
  b.part('mag', 0, 0.012, 0.13);
  b.box('steel', 0.04, 0.12, 0.084, 0, -0.045, 0.132, { part: 'mag', c: 0.004 });
  b.box('steel', 0.044, 0.01, 0.09, 0, -0.108, 0.132, { part: 'mag', c: 0.003 });
  if (b.hi) {
    for (const s of [-1, 1]) b.box('steel', 0.002, 0.08, 0.006, s * 0.0205, -0.045, 0.11, { part: 'mag', c: 0 });
  }
  // Patronen (.50, gestaucht) versetzt gestapelt; Stahl: oberste an den Lippen bzw. leerer Zubringer
  magRounds(b, { cal: 'r50', fit: 0.084, width: 0.036, depth: 0.08, pitch: 0.011, path: [[0, 0.0175, 0.142], [0, -0.08, 0.142]] });
  b.anchor('magGrab', 0, -0.06, 0.135, { part: 'mag', data: { w: 0.02, d: 0.042 } });
  b.anchor('magWell', 0, 0.012, 0.13);
  // Zielfernrohr (hohe Montage)
  sniperScope(b, -0.12, 0.116);
  b.anchor('rightHandGrip', 0, -0.02, 0, { data: { rake: 0.32, gw: 0.017, gd: 0.023, gu: 0.0, ho: 0.03, tu: 0.04 } });
  b.anchor('leftHandGrip', 0, 0.012, 0.25, { data: { style: 'flat', w: 0.024, h: 0.03 } });
  b.meta = { sight: 'sniper', axis, kind: 'sniper' };
}

export function hagel(b) {
  const axis = 0.07;
  // Geprägtes Gehäuse (AK-artig), Deckel, Schiene; Polymerhandschutz; Selbstlade-Gaskolben
  b.front('steel', roundRect(-0.021, 0.028, 0.021, 0.092, 0.008, b.hi ? 3 : 1), 0.3, -0.09, { bevel: 0.002 });
  b.rail('steel', 0, 0.092, -0.06, 0.18);
  if (b.hi) for (const s of [-1, 1]) for (const u of [-0.05, 0.05, 0.17]) b.screw('steelBright', s * 0.0213, 0.04, u, 'x', 0.003);
  b.side('polymer', [[0.21, 0.094], [0.42, 0.09], [0.43, 0.08], [0.43, 0.04], [0.42, 0.03], [0.22, 0.03], [0.21, 0.04]], 0.05, 0, { bevel: 0.006, bevelSeg: 2 });
  if (b.hi) for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.box('cavity', 0.0015, 0.004, 0.024, s * 0.0248, 0.06, 0.235 + i * 0.03, { c: 0 });
  // Lauf + Röhre darüber, Würgebohrung
  b.cyl('steelDark', 0.012, 0.012, 0.3, 0, axis, 0.56, { seg: b.seg(16, 6) });
  b.cyl('steel', 0.009, 0.009, 0.18, 0, axis + 0.026, 0.4, { seg: b.seg(12, 5) });
  b.cyl('steelDark', 0.0145, 0.0145, 0.05, 0, axis, 0.7, { seg: b.seg(16, 6) });
  if (b.hi) for (let i = 0; i < 4; i++) b.box('cavity', 0.004, 0.004, 0.012, 0, axis + 0.0142, 0.688 + i * 0.008, { c: 0 });
  b.circle('cavity', 0.0095, 0, axis, 0.7255);
  b.anchor('muzzle', 0, axis, 0.727);
  // Geisterring-Visier: Ring hinten, Korn vorn (Säule)
  const sv = 0.118;
  b.box('steel', 0.03, 0.012, 0.03, 0, 0.098, -0.04, { c: 0.002 });
  b.torus('steel', 0.0095, 0.0032, 0, sv, -0.04, { seg: b.seg(8, 4), tseg: b.seg(20, 8) });
  if (b.hi) for (const s of [-1, 1]) b.box('steel', 0.004, 0.026, 0.02, s * 0.015, sv - 0.004, -0.04, { c: 0.001 });
  b.box('steel', 0.012, sv - axis - 0.012, 0.016, 0, (sv + axis) / 2 + 0.002, 0.68, { c: 0.0015 });
  b.box('glowAmber', 0.003, 0.003, 0.003, 0, sv - 0.0015, 0.672, { c: 0 });
  // Ladehebel rechts
  b.part('charge', 0.024, 0.06, 0.14);
  b.box('steel', 0.01, 0.01, 0.034, 0.024, 0.06, 0.14, { part: 'charge', c: 0.002 });
  b.cyl('steel', 0.0055, 0.0055, 0.018, 0.034, 0.06, 0.148, { part: 'charge', axis: 'x', seg: b.seg(10, 5) });
  b.anchor('chargeGrab', 0.042, 0.06, 0.148, { part: 'charge', data: { travel: [0, 0, 0.085], style: 'right' } });
  ejectionPort(b, 0.0212, 0.066, 0.06, 0.07, 0.024);
  b.part('bolt', 0, 0.066, 0.06);
  b.box('steelBright', 0.004, 0.018, 0.06, 0.018, 0.066, 0.06, { part: 'bolt', c: 0.001 });
  // Griff, Abzugsbügel, Schaft (Polymer, Daumenloch)
  arGrip(b, 'grip', { top: 0.03, w: 0.032 });
  triggerGuard(b, 'steel', 0.02, 0.072, 0.03, 0.03, { t: 0.005, w: 0.013, trigPos: 0.3 });
  b.side('polymer', [
    [-0.09, 0.09], [-0.36, 0.094], [-0.372, 0.088], [-0.372, -0.03], [-0.36, -0.04], [-0.3, -0.03], [-0.18, 0.0], [-0.11, 0.024], [-0.09, 0.03],
  ], 0.04, 0, { bevel: 0.006, bevelSeg: 2, holes: [[[-0.17, 0.03], [-0.12, 0.046], [-0.12, 0.07], [-0.17, 0.07]]] });
  b.box('rubber', 0.044, 0.135, 0.014, 0, 0.026, -0.378, { c: 0.004 });
  // Kastenmagazin (8 Patronen Kaliber 12, leicht gebogen)
  b.part('mag', 0, 0.02, 0.12);
  b.side('polymer', [[0.09, 0.026], [0.092, -0.04], [0.1, -0.13], [0.17, -0.142], [0.164, -0.04], [0.156, 0.026]], 0.036, 0, { part: 'mag', bevel: 0.0025 });
  b.box('polymer', 0.04, 0.01, 0.074, 0, -0.14, 0.136, { part: 'mag', rx: -0.17, c: 0.003 });
  if (b.hi) {
    for (const s of [-1, 1]) b.box('polymer', 0.002, 0.11, 0.004, s * 0.0182, -0.05, 0.126, { part: 'mag', rx: -0.1, c: 0 });
  }
  // Schrotpatronen: oberste an den Lippen bzw. leerer Zubringer
  magRounds(b, { cal: 'g12', width: 0.033, depth: 0.066, path: [[0, 0.033, 0.123], [0, -0.04, 0.128], [0, -0.11, 0.132]] });
  b.anchor('magGrab', 0, -0.07, 0.13, { part: 'mag', data: { w: 0.019, d: 0.032 } });
  b.anchor('magWell', 0, 0.02, 0.12);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.32, gw: 0.016, gd: 0.022, gu: 0.004, ho: 0.03, tu: 0.034 } });
  b.anchor('sight', 0, sv, -0.04, { data: { type: 'iron', eyeRelief: 0.18 } });
  b.anchor('leftHandGrip', 0, 0.03, 0.33, { data: { style: 'under', w: 0.025, h: 0.022 } });
  b.meta = { sight: 'iron', axis, kind: 'shotgun' };
}

export function kobra(b) {
  const axis = 0.074;
  const cu = 0.062, cr = 0.0205, cl = 0.058;           // Trommel: Mitte (u), Radius, Länge
  // Rahmen (Edelstahl): Brücke über der Trommel, Abzugsbügel, Griffrahmen
  b.side('stainless', [
    [-0.03, 0.096], [0.098, 0.096], [0.1, 0.05], [0.094, 0.044], [0.03, 0.044], [0.03, 0.05], [0.025, 0.05], [0.02, 0.02],
    [-0.02, 0.016], [-0.04, 0.04], [-0.044, 0.074],
  ], 0.026, 0, { bevel: 0.0022, holes: [[[0.03, 0.05], [0.093, 0.05], [0.093, 0.0935], [0.03, 0.0935]]] });
  // Lauf mit voller Unterlaufschiene + Belüftungsrippe
  b.front('stainless', [[-0.0135, 0.052], [0.0135, 0.052], [0.0135, 0.086], [0.009, 0.094], [-0.009, 0.094], [-0.0135, 0.086]], 0.13, 0.1, { bevel: 0.0015 });
  b.front('stainless', [[-0.005, 0.094], [0.005, 0.094], [0.004, 0.101], [-0.004, 0.101]], 0.125, 0.102, { bevel: 0.0008 });
  if (b.hi) for (let i = 0; i < 6; i++) b.box('cavity', 0.008, 0.004, 0.012, 0, 0.0995, 0.115 + i * 0.019, { c: 0 });
  b.circle('cavity', 0.0058, 0, axis, 0.2305);
  b.anchor('muzzle', 0, axis, 0.232);
  // Korn (Rampe mit rotem Einsatz) und Kimme (Kerbe in der Brücke)
  b.side('stainless', [[0.208, 0.101], [0.226, 0.101], [0.226, 0.112], [0.22, 0.112]], 0.004, 0, { bevel: 0.0005 });
  if (b.hi) b.box('paintSignal', 0.0042, 0.004, 0.002, 0, 0.11, 0.222, { c: 0 });
  b.box('steelDark', 0.02, 0.012, 0.016, 0, 0.102, -0.022, { c: 0.002 });
  // Kran (Schwenkarm) mit Trommel und Ausstoßerstange – Gelenk links unten vor der Trommel
  b.part('crane', -0.012, axis - 0.022, cu + cl / 2 + 0.004);
  b.box('stainless', 0.006, 0.012, 0.012, -0.011, axis - 0.02, cu + cl / 2 + 0.006, { part: 'crane', c: 0.0015 });
  b.cyl('stainless', 0.0045, 0.0045, 0.12, 0, axis - 0.0225, cu + cl / 2 + 0.06, { part: 'crane', seg: b.seg(10, 5) });     // Ausstoßerstange
  b.part('cylinder', 0, axis - 0.003, cu, 'crane');
  b.cyl('stainless', cr, cr, cl, 0, axis - 0.003, cu, { part: 'cylinder', seg: b.seg(24, 8) });
  if (b.hi) {
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6;
      // Flutes außen + Kammern vorn
      b.box('cavity', 0.004, 0.0035, cl * 0.62, Math.cos(a) * cr * 0.97, axis - 0.003 + Math.sin(a) * cr * 0.97, cu + 0.004, { part: 'cylinder', rz: a, c: 0 });
      b.circle('cavity', 0.0048, Math.cos(a + Math.PI / 6) * 0.0122, axis - 0.003 + Math.sin(a + Math.PI / 6) * 0.0122, cu + cl / 2 + 0.0006, { part: 'cylinder', seg: 10 });
    }
  }
  // Ausstoßerstern (hinten an der Trommel) – Teil 'ejector', schiebt die Hülsen beim Druck auf die Stange hinaus
  b.part('ejector', 0, axis - 0.003, cu - cl / 2, 'cylinder');
  b.cyl('steelBright', 0.0138, 0.0138, 0.003, 0, axis - 0.003, cu - cl / 2 - 0.0012, { part: 'ejector', seg: b.seg(12, 6) });
  if (b.hi) for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 3; b.cyl('brass', 0.0052, 0.0052, 0.004, Math.cos(a) * 0.0122, axis - 0.003 + Math.sin(a) * 0.0122, cu - cl / 2 - 0.004, { part: 'ejector', seg: 10 }); }
  // Hahn (gespannt beim Schuss) mit Sporn
  b.part('hammer', 0, 0.072, -0.036);
  b.side('steelDark', [[-0.036, 0.06], [-0.026, 0.07], [-0.03, 0.094], [-0.046, 0.104], [-0.052, 0.098], [-0.042, 0.088], [-0.044, 0.064]], 0.006, 0, { part: 'hammer', bevel: 0.0008 });
  // Abzugsbügel + Abzug
  triggerGuard(b, 'stainless', 0.012, 0.05, 0.044, 0.03, { t: 0.0045, w: 0.01, trigPos: 0.4 });
  // Holzgriff (Walnuss), Medaillon
  b.side('woodWalnut', [[0.0, 0.046], [-0.004, 0.02], [-0.004, -0.02], [0.002, -0.06], [-0.012, -0.076], [-0.044, -0.074], [-0.05, -0.06], [-0.048, -0.02], [-0.046, 0.03], [-0.04, 0.046]], 0.036, 0, { bevel: 0.009, bevelSeg: 2 });
  if (b.hi) for (const s of [-1, 1]) b.cyl('steel', 0.0055, 0.0055, 0.002, s * 0.0182, 0.004, -0.026, { axis: 'x', seg: 14 });
  // Schnelllader (nur beim Nachladen sichtbar; Teil der Trommel, damit er mit ihr ausschwenkt)
  b.part('loader', 0, axis - 0.003, cu - cl / 2 - 0.032, 'cylinder');
  b.cyl('polymer', 0.0175, 0.0175, 0.016, 0, axis - 0.003, cu - cl / 2 - 0.04, { part: 'loader', seg: b.seg(16, 6) });
  b.cyl('knurl', 0.008, 0.008, 0.012, 0, axis - 0.003, cu - cl / 2 - 0.054, { part: 'loader', seg: b.seg(12, 5) });
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 3;
    b.cyl('brass', 0.0048, 0.0048, 0.03, Math.cos(a) * 0.0122, axis - 0.003 + Math.sin(a) * 0.0122, cu - cl / 2 - 0.018, { part: 'loader', seg: b.seg(10, 5) });
    if (b.hi) b.cyl('copper', 0.002, 0.0046, 0.008, Math.cos(a) * 0.0122, axis - 0.003 + Math.sin(a) * 0.0122, cu - cl / 2 + 0.0, { part: 'loader', seg: 8 });
  }
  // Geladene Kammern: Geschossspitzen vorn in der Trommel (abgefeuerte bleiben dunkel); Platz 0 = nächster Schuss
  magRounds(b, { part: 'cylinder', cal: 'nose357', follower: false, cyl: { c: [0, axis - 0.003], u: cu + cl / 2 - 0.001, R: 0.0122, n: 6, F: Math.PI * 2 / 3 } });
  b.anchor('loaderGrab', 0, axis - 0.003, cu - cl / 2 - 0.056, { part: 'loader' });
  b.anchor('cylGrab', -0.022, axis - 0.006, cu, { part: 'cylinder' });
  b.anchor('ejectorGrab', 0, axis - 0.0225, cu + cl / 2 + 0.118, { part: 'crane' });
  b.anchor('ejection', -0.03, axis, cu - cl / 2);
  const grip = { rake: 0.25, gw: 0.0175, gd: 0.024, gu: 0.022, ho: 0.008, tu: 0.07 };
  b.anchor('rightHandGrip', 0, -0.016, -0.022, { data: grip });
  b.anchor('magWell', 0, axis, cu);
  b.anchor('sight', 0, 0.112, -0.03, { data: { type: 'iron', eyeRelief: 0.36 } });
  b.anchor('leftHandGrip', 0, -0.016, -0.022, { data: { style: 'pistol', ...grip } });
  b.meta = { sight: 'iron', axis, kind: 'pistol', hidden: ['loader'] };
}

export function donner(b) {
  const axis = 0.09;
  // Rohr (Stahl, Hitzeschutz aus Holz in der Mitte), trichterförmige Düse hinten
  b.cyl('steel', 0.022, 0.022, 0.9, 0, axis, 0.06, { seg: b.seg(18, 7) });
  b.cyl('woodWarm', 0.0285, 0.0285, 0.26, 0, axis, 0.03, { seg: b.seg(18, 7) });
  if (b.hi) for (const du of [-0.098, 0.158]) b.cyl('steel', 0.0298, 0.0298, 0.012, 0, axis, du, { seg: 18 });
  b.lathe('steel', [[0, 0.022], [0.0, 0.026], [-0.06, 0.034], [-0.12, 0.046], [-0.13, 0.046], [-0.13, 0.04]], 0, axis, -0.39, { seg: b.seg(20, 8) });
  b.lathe('cavity', [[-0.128, 0.042], [-0.12, 0.04], [-0.06, 0.03], [0.0, 0.0]], 0, axis, -0.39, { seg: b.seg(16, 6) });
  b.cyl('steel', 0.0255, 0.0255, 0.03, 0, axis, 0.5, { seg: b.seg(18, 7) });
  b.circle('cavity', 0.02, 0, axis, 0.5155);
  b.anchor('muzzle', 0, axis, 0.52);
  // Griffstück unter dem Rohr (zwei Griffe) + Abzugsbügel
  b.box('steel', 0.024, 0.03, 0.14, 0, axis - 0.034, 0.03, { c: 0.003 });
  arGrip(b, 'woodWarm', { top: 0.04, w: 0.03 });
  triggerGuard(b, 'steel', 0.02, 0.07, 0.04, 0.03, { t: 0.005, w: 0.013, trigPos: 0.32 });
  b.side('woodWarm', [[0.2, 0.06], [0.236, 0.06], [0.232, 0.0], [0.226, -0.04], [0.206, -0.044], [0.2, -0.03], [0.202, 0.02]], 0.03, 0, { bevel: 0.007, bevelSeg: 2 });
  b.box('steel', 0.024, 0.016, 0.06, 0, axis - 0.03, 0.218, { c: 0.002 });
  // Klappvisier (Rahmen mit Entfernungsstufen) + Korn, Optikschiene links
  const sv = 0.142;
  b.box('steel', 0.03, 0.016, 0.03, 0, axis + 0.028, -0.02, { c: 0.002 });
  b.front('steel', [[-0.013, axis + 0.034], [0.013, axis + 0.034], [0.013, sv + 0.01], [-0.013, sv + 0.01]], 0.004, -0.024, {
    holes: [[[-0.0025, sv - 0.006], [0.0025, sv - 0.006], [0.0025, sv + 0.006], [-0.0025, sv + 0.006]]], bevel: 0.0008,
  });
  b.box('steel', 0.014, sv - axis - 0.022, 0.012, 0, (sv + axis) / 2 + 0.008, 0.36, { c: 0.002 });
  b.box('steel', 0.003, 0.012, 0.003, 0, sv - 0.006, 0.36, { c: 0 });
  if (b.hi) {
    for (const s of [-1, 1]) b.box('steel', 0.003, 0.016, 0.012, s * 0.0082, sv - 0.004, 0.36, { c: 0.0006 });
    b.box('steel', 0.006, 0.05, 0.12, -0.028, axis, 0.03, { c: 0.002 });
    b.box('paintSignal', 0.0005, 0.004, 0.004, 0.0222, axis + 0.016, 0.1, { c: 0 });
    b.torus('steel', 0.009, 0.0016, 0.026, axis - 0.012, 0.2, { ry: Math.PI / 2, tseg: 12 });
  }
  // Geladene Rakete (Teil 'rocket': unsichtbar, solange leer)
  b.part('rocket', 0, axis, 0.52);
  rocketBody(b, 0.62, axis, { part: 'rocket', fins: false });
  b.anchor('rocketGrab', -0.02, axis - 0.03, 0.66, { part: 'rocket', data: { w: 0.04, d: 0.042 } });
  b.anchor('magGrab', -0.02, axis - 0.03, 0.66, { part: 'rocket', data: { w: 0.04, d: 0.042 } });
  b.anchor('magWell', 0, axis, 0.52);
  b.anchor('ejection', 0, axis, -0.4);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0.28, gw: 0.016, gd: 0.022, gu: 0.0, ho: 0.03, tu: 0.034 } });
  b.anchor('sight', 0, sv, -0.024, { data: { type: 'iron', eyeRelief: 0.12 } });
  b.anchor('leftHandGrip', 0, 0.01, 0.218, { data: { style: 'post', rake: 0.08, gw: 0.016, gd: 0.02, gu: 0, ho: 0.03 } });
  b.meta = { sight: 'iron', axis, kind: 'launcher' };
}

/** Fliegende Rakete (3.-Person-Modell der Projektile): Spitze nach −Z (vorn). */
export function rocket(b) {
  rocketBody(b, 0.08, 0, {});
  b.anchor('rightHandGrip', 0, 0, 0);
  b.anchor('muzzle', 0, 0, -0.12);
  b.meta = { sight: 'none', kind: 'gear' };
}
