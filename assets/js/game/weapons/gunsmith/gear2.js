// Welle 2 – Nahkampf & Wurfmittel: Karambit, Machete, Kampfbeil; Aufschlag-, Brand-, Blend- und Rauchgranate;
// Schutzplatte (Westen-Einschub, Requisit der Ego-Ansicht). Ursprung = Griffmitte; Klinge/Kopf nach −Z bzw. oben.
import { ellipsePts } from './parts.js';

// Gummierter Griff entlang u (Länge len, Radius r, Ringe)
function handle(b, mat, u0, len, r, rings = 5) {
  const pts = [[u0, 0], [u0, r * 0.9]];
  const n = b.hi ? rings : 1;
  for (let i = 0; i < n; i++) { const a = u0 + (i + 0.15) * len / n, c = u0 + (i + 0.85) * len / n; pts.push([a, r], [c, r], [c + len / n * 0.15, r * 0.92]); }
  pts.push([u0 + len, r * 0.9], [u0 + len, 0]);
  b.lathe(mat, pts.map(([u, rr]) => [u - u0, rr]), 0, 0, u0, { seg: b.seg(14, 6), sx: 0.8 });
}

export function karambit(b) {
  // Fingerring hinten, kurzer Griff, sichelförmige Klinge nach vorn unten
  handle(b, 'rubber', -0.05, 0.1, 0.0135, 4);
  b.torus('steel', 0.017, 0.0042, 0, -0.004, -0.068, { ry: Math.PI / 2, seg: b.seg(8, 4), tseg: b.seg(20, 8) });
  b.box('steel', 0.012, 0.03, 0.006, 0, 0.0, 0.052, { c: 0.0015 });
  b.part('blade', 0, 0, 0);
  const n = b.hi ? 10 : 4, outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = -0.15 - t * 1.75;
    outer.push([0.055 + Math.cos(a) * 0.05 + t * 0.05, 0.03 + Math.sin(a) * 0.05]);
    inner.push([0.055 + Math.cos(a) * 0.026 + t * 0.045, 0.03 + Math.sin(a) * 0.03 + t * 0.004]);
  }
  b.side('bladeCoat', [...outer, ...inner.reverse()], 0.005, 0, { part: 'blade', bevel: 0.0014 });
  if (b.hi) b.side('blade', inner.map(([u, v], i) => [u + 0.001, v - 0.0035 * (1 - i / n)]).concat(inner.slice().reverse().map(([u, v]) => [u, v])), 0.0028, 0, { part: 'blade', bevel: 0.0006 });
  b.anchor('muzzle', 0, -0.03, 0.15);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0 } });
  b.meta = { sight: 'none', kind: 'melee' };
}

export function machete(b) {
  // Langer Griff mit Fangriemen-Öse, gerade Klinge mit abgeschrägter Spitze, Rückenzahnung
  handle(b, 'grip', -0.06, 0.12, 0.0145, 6);
  b.box('steel', 0.014, 0.05, 0.007, 0, -0.004, 0.064, { c: 0.0015 });
  b.torus('steel', 0.006, 0.0015, 0, -0.012, -0.068, { ry: Math.PI / 2, tseg: 12 });
  b.part('blade', 0, 0, 0);
  const blade = [[0.066, 0.014], [0.36, 0.016], [0.405, 0.03], [0.43, 0.012], [0.4, -0.022], [0.3, -0.026], [0.066, -0.022]];
  b.side('bladeCoat', blade, 0.0045, 0, { part: 'blade', bevel: 0.0012 });
  b.side('blade', [[0.07, -0.014], [0.3, -0.018], [0.4, -0.015], [0.428, 0.011], [0.4, -0.022], [0.3, -0.026], [0.07, -0.022]], 0.003, 0, { part: 'blade', bevel: 0.0008 });
  if (b.hi) for (let i = 0; i < 9; i++) b.box('bladeCoat', 0.0046, 0.004, 0.006, 0, 0.0165, 0.1 + i * 0.012, { part: 'blade', rx: 0.6, c: 0 });
  b.anchor('muzzle', 0, 0, 0.42);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0 } });
  b.meta = { sight: 'none', kind: 'melee' };
}

export function tomahawk(b) {
  // Schaft (Kompositgriff) entlang u, Kopf oben am vorderen Ende: Schneide nach oben, Dorn nach unten
  handle(b, 'grip', -0.07, 0.15, 0.0145, 6);
  b.box('polymer', 0.022, 0.026, 0.2, 0, 0.0, 0.18, { c: 0.004 });
  b.part('blade', 0, 0, 0.29);
  b.side('bladeCoat', [[0.27, 0.014], [0.31, 0.014], [0.33, 0.04], [0.36, 0.085], [0.335, 0.095], [0.29, 0.1], [0.26, 0.092], [0.28, 0.04]], 0.008, 0, { part: 'blade', bevel: 0.0018 });
  b.side('blade', [[0.338, 0.09], [0.365, 0.086], [0.35, 0.098], [0.29, 0.104], [0.258, 0.096], [0.262, 0.09], [0.292, 0.096]], 0.004, 0, { part: 'blade', bevel: 0.0008 });
  b.side('bladeCoat', [[0.272, -0.014], [0.312, -0.014], [0.298, -0.05], [0.29, -0.07], [0.286, -0.05]], 0.009, 0, { part: 'blade', bevel: 0.0016 });
  b.box('steel', 0.026, 0.03, 0.05, 0, 0.0, 0.29, { part: 'blade', c: 0.003 });
  if (b.hi) for (const s of [-1, 1]) b.screw('steel', s * 0.0132, 0.0, 0.29, 'x', 0.0035, { part: 'blade' });
  b.anchor('muzzle', 0, 0.09, 0.32);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0 } });
  b.meta = { sight: 'none', kind: 'melee' };
}

// Zylindrischer Granatkörper mit Zünderkopf, Löffel und Splint (gemeinsam für Blend/Rauch/Aufschlag)
function canister(b, body, band, r, h, o = {}) {
  b.cyl(body, r, r, h, 0, 0, 0, { axis: 'v', seg: b.seg(18, 7) });
  if (band) b.cyl(band, r + 0.0004, r + 0.0004, 0.01, 0, h * 0.18, 0, { axis: 'v', seg: b.seg(18, 7) });
  if (o.holes && b.hi) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; for (const dv of [-0.02, 0.0, 0.02]) b.cyl('cavity', 0.003, 0.003, 0.002, Math.cos(a) * r, dv, Math.sin(a) * r, { axis: 'x', ry: -a, seg: 8 }); }
  b.cyl('steel', 0.0095, 0.011, 0.012, 0, h / 2 + 0.006, 0, { axis: 'v', seg: b.seg(14, 6) });
  b.part('spoon', 0.01, h / 2 + 0.01, 0);
  b.box('steel', 0.012, 0.004, 0.014, 0.008, h / 2 + 0.013, 0, { part: 'spoon', c: 0.001 });
  b.box('steel', 0.004, h * 0.8, 0.013, r + 0.002, 0.0, 0, { part: 'spoon', c: 0.001 });
  b.part('pin', -0.012, h / 2 + 0.008, 0);
  b.torus('steelBright', 0.0105, 0.0014, -0.026, h / 2 + 0.008, 0, { part: 'pin', ry: Math.PI / 2, seg: b.seg(6, 3), tseg: b.seg(18, 8) });
  b.cyl('steelBright', 0.0011, 0.0011, 0.026, -0.008, h / 2 + 0.008, 0, { part: 'pin', axis: 'x', seg: 6 });
  b.anchor('pinGrab', -0.034, h / 2 + 0.008, 0, { part: 'pin' });
  b.anchor('rightHandGrip', 0, 0, 0);
  b.meta = { sight: 'none', kind: 'grenade' };
}

export function flash(b) { canister(b, 'polymerGrey', 'paintWhite', 0.024, 0.085, { holes: true }); }
export function smoke(b) {
  canister(b, 'paintOlive', 'paintWhite', 0.027, 0.1);
  if (b.hi) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; b.circle('cavity', 0.003, Math.cos(a) * 0.012, -0.0505, Math.sin(a) * 0.012, { rx: Math.PI / 2, seg: 8 }); }
}
export function impact(b) {
  // Aufschlaggranate: kugeliger Körper mit Aufschlagzünder-Kappe (gelb), Splint
  b.sphere('paintOlive', 0.03, 0, 0, 0, { sy: 1.15, seg: b.seg(16, 7), hseg: b.seg(12, 5) });
  b.cyl('paintYellow', 0.031, 0.031, 0.008, 0, 0.0, 0, { axis: 'v', seg: b.seg(16, 7) });
  b.cyl('steel', 0.012, 0.016, 0.014, 0, 0.038, 0, { axis: 'v', seg: b.seg(14, 6) });
  b.sphere('paintSignal', 0.01, 0, 0.048, 0, { seg: b.seg(10, 5), hseg: b.seg(8, 4) });
  b.part('pin', -0.012, 0.038, 0);
  b.torus('steelBright', 0.0105, 0.0014, -0.026, 0.038, 0, { part: 'pin', ry: Math.PI / 2, seg: b.seg(6, 3), tseg: b.seg(18, 8) });
  b.anchor('pinGrab', -0.034, 0.038, 0, { part: 'pin' });
  b.anchor('rightHandGrip', 0, 0, 0);
  b.meta = { sight: 'none', kind: 'grenade' };
}
export function molotov(b) {
  // Flasche (Glas getönt) mit Lappen im Hals; der „Splint“ ist der Lappenzipfel (Feuerzeug-Geste)
  b.lathe('smoke', [[-0.055, 0], [-0.055, 0.028], [-0.05, 0.031], [0.02, 0.031], [0.035, 0.022], [0.05, 0.012], [0.07, 0.011], [0.074, 0.012], [0.074, 0]], 0, 0, 0, { axis: 'v', seg: b.seg(16, 7) });
  b.lathe('paintYellow', [[-0.05, 0], [-0.05, 0.0285], [0.0, 0.0285], [0.0, 0]], 0, 0, 0, { axis: 'v', seg: b.seg(14, 6) });
  b.cyl('cord', 0.0095, 0.008, 0.05, 0, 0.09, 0, { axis: 'v', seg: b.seg(10, 5) });
  b.part('pin', 0.004, 0.115, 0);
  b.box('cord', 0.022, 0.01, 0.012, 0.012, 0.118, 0, { part: 'pin', rz: -0.5, c: 0.002 });
  b.anchor('pinGrab', 0.022, 0.122, 0, { part: 'pin' });
  b.anchor('rightHandGrip', 0, 0, 0);
  b.meta = { sight: 'none', kind: 'grenade' };
}

export function plate(b) {
  // Keramikplatte in Stoffhülle (leicht gewölbt), Griffband oben
  const w = 0.25, h = 0.3, t = 0.022;
  b.box('canvasOD', w, h, t, 0, 0, 0, { r: 0.012, rs: 2 });
  b.box('polymer', w * 0.6, 0.026, t + 0.003, 0, h / 2 - 0.03, 0, { c: 0.003 });
  if (b.hi) {
    b.box('paintWhite', 0.07, 0.03, 0.0008, -0.05, -0.06, -(t / 2 + 0.0004), { c: 0 });
    for (const s of [-1, 1]) b.box('polymer', 0.004, h * 0.8, t + 0.002, s * (w / 2 - 0.02), 0, 0, { c: 0.001 });
  }
  b.anchor('rightHandGrip', 0, 0, 0);
  b.meta = { sight: 'none', kind: 'gear' };
}

export { ellipsePts };
