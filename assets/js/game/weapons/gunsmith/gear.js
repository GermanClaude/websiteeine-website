// Nahkampf & Wurfwaffen: Kampfmesser, Splittergranate, Haftgranate
import { ellipsePts } from './parts.js';

export function knife(b) {
  // Griff (gummiert, oval) mit Ringen, Parierstange, Knauf. Klinge zeigt nach −Z (vorn), Schneide unten.
  const ring = [];
  const nr = b.hi ? 7 : 1;
  ring.push([-0.058, 0.0], [-0.058, 0.0125]);
  for (let i = 0; i < nr; i++) { const u = -0.054 + i * (0.106 / nr); ring.push([u + 0.003, 0.0142], [u + 0.106 / nr - 0.004, 0.0142], [u + 0.106 / nr - 0.001, 0.0128]); }
  ring.push([0.052, 0.013], [0.054, 0.0]);
  b.lathe('rubber', ring, 0, 0, 0, { seg: b.seg(14, 6), sx: 0.82 });
  b.lathe('steel', [[0, 0], [0, 0.014], [0.004, 0.0148], [0.01, 0.0132], [0.012, 0.0]], 0, 0, -0.07, { seg: b.seg(12, 6), sx: 0.82 });
  b.box('steel', 0.013, 0.06, 0.008, 0, -0.002, 0.058, { c: 0.002 });
  // Klinge: Clip-Point, beschichtet, mit blank geschliffener Schneide und Hohlkehle
  const blade = [[0.06, 0.013], [0.18, 0.013], [0.205, 0.008], [0.245, 0.0], [0.232, -0.008], [0.205, -0.015], [0.17, -0.019], [0.07, -0.019], [0.06, -0.016]];
  b.part('blade', 0, 0, 0);
  b.side('bladeCoat', blade, 0.0055, 0, { part: 'blade', bevel: 0.0016 });
  b.side('blade', [[0.07, -0.0125], [0.17, -0.0125], [0.203, -0.009], [0.236, -0.0045], [0.2455, 0.0], [0.232, -0.0085], [0.205, -0.0155], [0.17, -0.0195], [0.07, -0.0195]], 0.0036, 0, { part: 'blade', bevel: 0.0012 });
  b.side('blade', [[0.18, 0.0132], [0.205, 0.0085], [0.2455, 0.0], [0.205, 0.0105], [0.18, 0.0145]], 0.0028, 0, { part: 'blade', bevel: 0.0008 });
  if (b.hi) for (const s of [-1, 1]) b.box('cavity', 0.0008, 0.0035, 0.09, s * 0.0029, 0.004, 0.125, { part: 'blade', c: 0 });
  b.anchor('muzzle', 0, -0.002, 0.24);
  b.anchor('rightHandGrip', 0, 0, 0, { data: { rake: 0 } });
  b.meta = { sight: 'none', kind: 'melee' };
}

export function frag(b) {
  // Grüner Kugelkörper, Zünder, Sicherungsbügel (Löffel), Abzugsring mit Splint
  b.sphere('paintOlive', 0.031, 0, 0, 0, { seg: b.seg(18, 8), hseg: b.seg(14, 6) });
  b.cyl('paintYellow', 0.0105, 0.0105, 0.004, 0, 0.029, 0, { axis: 'v', seg: b.seg(14, 6) });
  b.cyl('steel', 0.0085, 0.01, 0.014, 0, 0.037, 0, { axis: 'v', seg: b.seg(14, 6) });
  b.cyl('steel', 0.006, 0.0085, 0.006, 0, 0.047, 0, { axis: 'v', seg: b.seg(12, 6) });
  // Löffel: gebogenes Band an der rechten Seite
  b.part('spoon', 0.01, 0.046, 0);
  const n = b.hi ? 8 : 3, outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 - 0.15 - i * (1.55 / n);
    outer.push([Math.cos(a) * 0.0365 + 0.002, Math.sin(a) * 0.0365 + 0.012]);
    inner.push([Math.cos(a) * 0.0335 + 0.002, Math.sin(a) * 0.0335 + 0.012]);
  }
  b.front('steel', [...outer, ...inner.reverse()], 0.013, -0.0065, { part: 'spoon' });
  b.box('steel', 0.014, 0.004, 0.013, 0.006, 0.049, 0, { part: 'spoon', c: 0.001 });
  // Ring + Splint
  b.part('pin', -0.012, 0.042, 0);
  b.torus('steelBright', 0.0105, 0.0014, -0.026, 0.042, 0, { part: 'pin', ry: Math.PI / 2, seg: b.seg(6, 3), tseg: b.seg(18, 8) });
  b.cyl('steelBright', 0.0011, 0.0011, 0.026, -0.008, 0.042, 0, { part: 'pin', axis: 'x', seg: 6 });
  b.anchor('pinGrab', -0.034, 0.042, 0, { part: 'pin' });
  b.anchor('rightHandGrip', 0, 0, 0);
  b.meta = { sight: 'none', kind: 'grenade' };
}

export function semtex(b) {
  // Zylindrischer Körper mit Warnstreifen, klebrige Masse unten, Zündmodul mit LED oben
  b.cyl('paintOlive', 0.024, 0.024, 0.07, 0, 0, 0, { axis: 'v', seg: b.seg(18, 7) });
  b.cyl('paintYellow', 0.0245, 0.0245, 0.012, 0, 0.018, 0, { axis: 'v', seg: b.seg(18, 7) });
  for (const v of [-0.012, 0.0115, 0.0245]) b.cyl('polymer', 0.0247, 0.0247, 0.003, 0, v, 0, { axis: 'v', seg: b.seg(18, 7) });
  b.sphere('putty', 0.027, 0, -0.04, 0, { sy: 0.45, seg: b.seg(16, 7), hseg: b.seg(10, 4) });
  b.box('polymer', 0.032, 0.016, 0.032, 0, 0.043, 0, { c: 0.004 });
  b.cyl('steel', 0.005, 0.006, 0.012, 0, 0.056, 0, { axis: 'v', seg: b.seg(10, 5) });
  b.part('led', 0, 0.052, 0);
  b.sphere('glowRed', 0.0035, 0.009, 0.052, -0.016, { part: 'led', seg: 8, hseg: 6 });
  b.part('pin', -0.01, 0.056, 0);
  b.torus('steelBright', 0.009, 0.0013, -0.02, 0.056, 0, { part: 'pin', ry: Math.PI / 2, seg: b.seg(6, 3), tseg: b.seg(16, 8) });
  b.anchor('pinGrab', -0.028, 0.056, 0, { part: 'pin' });
  b.anchor('rightHandGrip', 0, 0, 0);
  b.meta = { sight: 'none', kind: 'grenade' };
}

export { ellipsePts };
