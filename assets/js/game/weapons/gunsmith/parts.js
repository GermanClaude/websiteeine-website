// Wiederverwendbare Waffenbaugruppen: Visiere, Mündungen, Abzug, Griffe, Auswurf.
// Alle Funktionen erhalten einen Builder b und arbeiten in Waffenkoordinaten (x, v, u).
import { roundRect, ellipsePts } from './builder.js';

// ---------- Visierungen ----------

// Holografisches Visier (EOTech-artig) auf Schiene mit Oberkante railTop.
// Liefert Höhe der optischen Achse.
export function holoSight(b, u0, railTop, o = {}) {
  const L = 0.092, W = 0.036;
  const baseH = 0.017, axis = railTop + baseH + 0.019;
  // Montagebasis mit Klemme
  b.box('alu', W, baseH, L, 0, railTop + baseH / 2, u0 + L / 2, { c: 0.003 });
  b.box('alu', 0.012, 0.012, 0.03, W / 2 + 0.004, railTop + 0.006, u0 + 0.03, { c: 0.002 });
  if (b.hi) {
    b.cyl('knurl', 0.006, 0.006, 0.008, W / 2 + 0.012, railTop + 0.006, u0 + 0.03, { axis: 'x', seg: 12 });
    // Batteriefach (quer) hinten
    b.cyl('alu', 0.0085, 0.0085, W + 0.008, 0, railTop + baseH * 0.55, u0 + 0.018, { axis: 'x', seg: 14 });
    // Bedienknöpfe hinten
    for (const dx of [-0.008, 0.008]) b.box('rubber', 0.007, 0.006, 0.004, dx, railTop + baseH + 0.003, u0 + 0.002, { c: 0.001 });
  }
  // Haube: rechteckiger Rahmen mit Fenster
  const hoodL = 0.05, hu = u0 + L - hoodL - 0.004;
  const ow = W / 2 + 0.002, oh0 = railTop + baseH - 0.001, oh1 = axis + 0.022;
  const iw = W / 2 - 0.0035, ih0 = railTop + baseH + 0.002, ih1 = axis + 0.017;
  if (b.hi) b.front('alu', roundRect(-ow, oh0, ow, oh1, 0.006, 3), hoodL, hu, { holes: [roundRect(-iw, ih0, iw, ih1, 0.004, 2).reverse()], bevel: 0.0015 });
  else b.box('alu', ow * 2, oh1 - oh0, hoodL, 0, (oh0 + oh1) / 2, hu + hoodL / 2, { c: 0 });
  if (b.hi) {
    // Schutzbügel-Kanten oben (Rippen)
    b.box('alu', 0.006, 0.003, hoodL - 0.006, -ow + 0.004, oh1 + 0.0012, hu + hoodL / 2, { c: 0.0008 });
    b.box('alu', 0.006, 0.003, hoodL - 0.006, ow - 0.004, oh1 + 0.0012, hu + hoodL / 2, { c: 0.0008 });
    // Fensterscheiben (vorn + hinten)
    b.plane('glass', iw * 2, ih1 - ih0, 0, (ih0 + ih1) / 2, hu + hoodL - 0.004, { renderOrder: 1 });
    b.plane('glass', iw * 2, ih1 - ih0, 0, (ih0 + ih1) / 2, hu + 0.004, { renderOrder: 1 });
    // Absehen (leuchtend): Ring + Punkt
    b.plane('reticleHolo', 0.02, 0.02, 0, axis, hu + 0.012, { renderOrder: 3 });
  }
  b.anchor('sight', 0, axis, u0, { data: { type: 'holo', eyeRelief: 0.2 } });
  return axis;
}

// Kompaktes Rotpunktvisier (Röhre) – type 'tube' – oder offenes Ringvisier – type 'ring'
export function redDot(b, u0, railTop, o = {}) {
  const ring = o.style === 'ring';
  const axis = railTop + (ring ? 0.03 : 0.028);
  if (ring) {
    // Ringvisier (QX-90): runder Ring auf schmalem Sockel mit Seitenschutz
    b.box(o.mat || 'polymer', 0.026, 0.012, 0.05, 0, railTop + 0.006, u0 + 0.025, { c: 0.003 });
    b.torus(o.mat || 'polymer', 0.0145, 0.0034, 0, axis, u0 + 0.034, { seg: b.seg(8, 4), tseg: b.seg(24, 10) });
    b.box(o.mat || 'polymer', 0.008, 0.016, 0.012, 0, railTop + 0.014, u0 + 0.034, { c: 0.002 });
    if (b.hi) {
      b.circle('lensClear', 0.0125, 0, axis, u0 + 0.033, { renderOrder: 1 });
      b.plane('reticleDot', 0.02, 0.02, 0, axis, u0 + 0.031, { renderOrder: 3 });
      b.cyl('knurl', 0.0055, 0.0055, 0.006, 0.019, axis, u0 + 0.034, { axis: 'x', seg: 12 });
    }
    b.anchor('sight', 0, axis, u0, { data: { type: 'reddot', eyeRelief: 0.2 } });
    return axis;
  }
  b.box('alu', 0.026, 0.008, 0.05, 0, railTop + 0.004, u0 + 0.025, { c: 0.002 });
  // Röhre hinten offen (nur Ringkante, Durchblick r = 0,0138) – ein geschlossener Boden wirkte beim Zielen wie eine
  // Schutzklappe vor dem Glas. Fernstufe ('third'): Boden zu, dort fehlen Innenwand und Linsen (LOD_SKIP).
  const rIn = 0.0138;
  b.lathe('alu', [[0, b.hi ? rIn : 0], [0, 0.0158], [0.004, 0.0158], [0.006, 0.0148], [0.034, 0.0148], [0.036, 0.0162], [0.042, 0.0162], [0.042, rIn]], 0, axis, u0 + 0.004, { seg: b.seg(20, 8) });
  // Sockel endet unter der Röhrenwand (ragte vorher in den Durchblick)
  b.box('alu', 0.014, 0.01, 0.02, 0, railTop + 0.009, u0 + 0.024, { c: 0.002 });
  if (b.hi) {
    // Innenwand (nach innen gerichtet, matt schwarz): Röhrenblick beim Zielen
    b.lathe('cavity', [[0.042, rIn], [0, rIn]], 0, axis, u0 + 0.004, { seg: b.seg(20, 8) });
    b.cyl('knurl', 0.0062, 0.0062, 0.008, 0.019, axis, u0 + 0.024, { axis: 'x', seg: 12 });
    b.cyl('knurl', 0.0062, 0.0062, 0.008, 0, axis + 0.019, u0 + 0.024, { axis: 'v', seg: 12 });
    // Linsen vorn + hinten: leicht getönt und spiegelnd, aber durchsichtig
    b.circle('lensClear', 0.0136, 0, axis, u0 + 0.0455, { renderOrder: 1 });
    b.circle('lensClear', rIn, 0, axis, u0 + 0.0055, { renderOrder: 1 });
    b.plane('reticleDot', 0.02, 0.02, 0, axis, u0 + 0.008, { renderOrder: 3 });
  }
  b.anchor('sight', 0, axis, u0, { data: { type: 'reddot', eyeRelief: 0.2 } });
  return axis;
}

// 4×-Kampfvisier (ACOG-artig) mit beleuchtetem Chevron und Glasfaser oben
export function acog(b, u0, railTop) {
  const axis = railTop + 0.036;
  const L = 0.15;
  // Montage
  b.box('alu', 0.03, 0.012, 0.07, 0, railTop + 0.006, u0 + 0.055, { c: 0.002 });
  b.box('alu', 0.022, 0.016, 0.05, 0, railTop + 0.016, u0 + 0.055, { c: 0.003 });
  if (b.hi) b.cyl('knurl', 0.0065, 0.0065, 0.01, 0.02, railTop + 0.006, u0 + 0.04, { axis: 'x', seg: 12 });
  // Gehäuse: Okular hinten, Prismenkörper, konisches Objektiv vorn
  b.lathe('alu', [
    [0, 0.0152], [0, 0.0175], [0.004, 0.0185], [0.022, 0.0185], [0.026, 0.0165], [0.03, 0.0165],
    [0.035, 0.017], [0.085, 0.017], [0.115, 0.0215], [0.142, 0.0222], [0.146, 0.0205], [0.15, 0.0205], [L, 0.019],
  ], 0, axis, u0, { seg: b.seg(20, 8) });
  // Innenwand (nach innen gerichtet): Tunnelblick beim Zielen
  b.lathe('cavity', [[L, 0.0185], [0.118, 0.0185], [0.085, 0.0152], [0.004, 0.0152]], 0, axis, u0, { seg: b.seg(20, 8) });
  // Prismengehäuse (kantig, typisch für das Profil) – seitlich/unten, Strahlengang frei
  for (const s of [-1, 1]) b.box('alu', 0.0065, 0.03, 0.05, s * 0.0188, axis - 0.003, u0 + 0.06, { c: 0.0022 });
  b.box('alu', 0.03, 0.008, 0.05, 0, axis - 0.0195, u0 + 0.06, { c: 0.003 });
  // Glasfaser-Sammler oben (leuchtet leicht)
  b.box('alu', 0.012, 0.006, 0.07, 0, axis + 0.019, u0 + 0.075, { c: 0.002 });
  if (b.hi) {
    b.cyl('glowAmber', 0.0022, 0.0022, 0.064, 0, axis + 0.0225, u0 + 0.075, { seg: 6 });
    // Gummi-Augenschutz
    b.lathe('rubber', [[0, 0.0175], [-0.006, 0.019], [-0.012, 0.0195], [-0.012, 0.016]], 0, axis, u0, { seg: 16 });
    // Linsen
    b.circle('lensClear', 0.0185, 0, axis, u0 + L - 0.002, { renderOrder: 1 });
    b.circle('lensClear', 0.0152, 0, axis, u0 + 0.002, { renderOrder: 1 });
    // Chevron im Okular (sichtbar beim Zielen)
    b.plane('reticleChevron', 0.011, 0.011, 0, axis, u0 + 0.004, { renderOrder: 3 });
    // Seiten-Einstelltürme
    b.cyl('alu', 0.007, 0.007, 0.006, 0.021, axis, u0 + 0.06, { axis: 'x', seg: 12 });
  }
  b.anchor('sight', 0, axis, u0 - 0.012, { data: { type: 'acog', eyeRelief: 0.085 } });
  return axis;
}

// Zielfernrohr (Scharfschütze): Objektivglocke, Türme, Okular, Montageringe
export function sniperScope(b, u0, railTop, o = {}) {
  const axis = railTop + 0.046;
  const L = 0.35;
  b.lathe('alu', [
    [0, 0], [0, 0.0225], [0.004, 0.0238], [0.034, 0.0238], [0.066, 0.0178], [0.076, 0.0168],
    [0.2, 0.0168], [0.24, 0.0168], [0.28, 0.0305], [0.334, 0.032], [0.341, 0.0302], [L, 0.0298], [L, 0.025],
  ], 0, axis, u0, { seg: b.seg(24, 8) });
  // Turmsattel
  b.box('alu', 0.04, 0.04, 0.055, 0, axis, u0 + 0.14, { r: 0.009 });
  b.cyl('knurl', 0.0135, 0.0135, 0.024, 0, axis + 0.031, u0 + 0.14, { axis: 'v', seg: b.seg(18, 6) });
  b.cyl('knurl', 0.0135, 0.0135, 0.024, 0.031, axis, u0 + 0.14, { axis: 'x', seg: b.seg(18, 6) });
  if (b.hi) {
    b.cyl('alu', 0.015, 0.015, 0.004, 0, axis + 0.044, u0 + 0.14, { axis: 'v', seg: 18 });
    b.cyl('paintSignal', 0.0151, 0.0151, 0.0015, 0, axis + 0.0375, u0 + 0.14, { axis: 'v', seg: 18 });
    b.cyl('alu', 0.015, 0.015, 0.004, 0.044, axis, u0 + 0.14, { axis: 'x', seg: 18 });
    // Parallaxe links
    b.cyl('knurl', 0.012, 0.012, 0.018, -0.028, axis, u0 + 0.14, { axis: 'x', seg: 16 });
    // Linsen
    b.circle('lens', 0.0296, 0, axis, u0 + L - 0.003);
    b.circle('lens', 0.0222, 0, axis, u0 + 0.002);
    // Vergrößerungsring mit Wurfhebel
    b.box('alu', 0.004, 0.012, 0.008, 0.024, axis + 0.006, u0 + 0.05, { c: 0.001 });
  }
  // Montageringe + Basis
  for (const du of [0.09, 0.2]) {
    b.cyl('alu', 0.0205, 0.0205, 0.016, 0, axis, u0 + du, { seg: b.seg(18, 6) });
    b.box('alu', 0.026, axis - railTop - 0.012, 0.014, 0, railTop + (axis - railTop - 0.012) / 2, u0 + du, { c: 0.002 });
    if (b.hi) for (const s of [-1, 1]) b.screw('steel', s * 0.0135, axis - 0.012, u0 + du, 'x', 0.0022);
  }
  b.anchor('sight', 0, axis, u0 - 0.02, { data: { type: 'sniper', eyeRelief: 0.09 } });
  return axis;
}

// ---------- Mündungen ----------

// Vogelkäfig-Mündungsfeuerdämpfer (AR)
export function birdcage(b, u0, axis, r = 0.0105) {
  b.lathe('steelDark', [[0, 0], [0, r * 0.9], [0.004, r], [0.044, r], [0.046, r * 0.85], [0.046, r * 0.55]], 0, axis, u0, { seg: b.seg(14, 6) });
  if (b.hi) for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    if (i === 3) continue; // geschlossener Boden (A2)
    b.box('cavity', 0.0035, 0.0035, 0.024, Math.cos(a) * r * 0.98, axis + Math.sin(a) * r * 0.98, u0 + 0.026, { rz: a, c: 0 });
  }
  b.circle('cavity', r * 0.45, 0, axis, u0 + 0.0465);
  return u0 + 0.046;
}

// Schräger Mündungskompensator (KV-47)
export function akBrake(b, u0, axis) {
  b.lathe('steelDark', [[0, 0], [0, 0.0105], [0.004, 0.0115], [0.03, 0.0115], [0.034, 0.0105], [0.036, 0.0095], [0.036, 0.0055]], 0, axis, u0, { seg: b.seg(14, 6) });
  if (b.hi) {
    b.box('steelDark', 0.016, 0.007, 0.012, 0.004, axis + 0.009, u0 + 0.041, { rx: -0.35, c: 0.0015 });
    b.circle('cavity', 0.005, 0, axis, u0 + 0.0365);
  }
  return u0 + 0.045;
}

// Großer Mündungsbremse mit Seitenschlitzen
export function brake(b, u0, axis, r = 0.0125, len = 0.06) {
  b.lathe('steelDark', [[0, 0], [0, r * 0.95], [0.004, r], [len - 0.004, r], [len, r * 0.9], [len, r * 0.45]], 0, axis, u0, { seg: b.seg(16, 6) });
  if (b.hi) {
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      b.box('cavity', 0.004, r * 1.25, 0.0085, s * (r - 0.0012), axis, u0 + 0.012 + i * 0.015, { c: 0 });
    }
    b.circle('cavity', r * 0.42, 0, axis, u0 + len + 0.0005);
  }
  return u0 + len;
}

// ---------- Allgemeine Kleinteile ----------

// Auswurffenster (rechts, x > 0): dunkle Öffnung mit Rahmen
export function ejectionPort(b, x, v, u, l, h, mat = 'steel') {
  b.box('cavity', 0.002, h, l, x + 0.0008, v, u, { c: 0 });
  if (b.hi) {
    b.box(mat, 0.003, 0.002, l + 0.004, x, v + h / 2 + 0.001, u, { c: 0.0006 });
    b.box(mat, 0.003, 0.002, l + 0.004, x, v - h / 2 - 0.001, u, { c: 0.0006 });
    b.box('steelBright', 0.0015, h * 0.7, l * 0.85, x - 0.003, v, u, { c: 0 });
  }
  b.anchor('ejection', x + 0.004, v, u);
}

// Abzugsbügel (Seitenprofil-Ring) + Abzug
export function triggerGuard(b, mat, u0, u1, vTop, depth, o = {}) {
  const t = o.t ?? 0.0045, w = o.w ?? 0.012;
  const vb = vTop - depth;
  const outer = [[u0 - t, vTop], [u0 - t, vb + 0.006], [u0 + 0.004, vb - t], [u1 - 0.004, vb - t], [u1 + t * 0.4, vb + 0.004], [u1 + t * 0.4, vTop]];
  const inner = [[u0, vTop], [u0, vb + 0.006], [u0 + 0.006, vb], [u1 - 0.006, vb], [u1 - t * 0.6, vb + 0.005], [u1 - t * 0.6, vTop]];
  if (!b.hi) {
    // Bot-Detailstufe: Bügel als flacher Bogen aus drei Quadern
    b.box(mat, w, t, u1 - u0, 0, vb - t / 2, (u0 + u1) / 2, { c: 0 });
    b.box(mat, w, depth, t, 0, vTop - depth / 2, u0 - t / 2, { c: 0 });
  } else b.side(mat, [...outer, ...inner.reverse()], w, 0, { bevel: 0.0012 });
  // Abzug
  const tu = u0 + (u1 - u0) * (o.trigPos ?? 0.38);
  b.anchor('trigger', 0, vTop - depth * 0.55, tu - 0.002);
  if (!b.hi) return;
  b.side(o.trigMat || 'steel', [[tu + 0.003, vTop + 0.004], [tu + 0.0045, vTop - 0.01], [tu + 0.0005, vTop - depth * 0.78], [tu - 0.0035, vTop - depth * 0.72], [tu - 0.001, vTop - 0.01], [tu - 0.002, vTop + 0.004]], 0.006, 0, { bevel: 0.0008, part: o.part });
}

// AR-Pistolengriff (Seitenprofil, geneigt), Mitte des Griffs = Ursprung
export function arGrip(b, mat, o = {}) {
  const top = o.top ?? 0.035;
  const pts = [
    [0.031, top], [0.028, top - 0.012], [0.02, top - 0.022], [0.022, top - 0.033], [0.017, top - 0.045], [0.012, top - 0.07],
    [0.006, top - 0.094], [0.004, top - 0.104], [-0.004, top - 0.11], [-0.034, top - 0.108], [-0.04, top - 0.1],
    [-0.035, top - 0.07], [-0.026, top - 0.035], [-0.02, top - 0.012], [-0.022, top],
  ];
  b.side(mat, pts, o.w ?? 0.03, 0, { bevel: b.hi ? 0.007 : 0, bevelSeg: 2 });
  return top;
}

// Schlitz-Reihe (M-LOK) als dunkle Vertiefungen auf einer Seitenfläche
export function slots(b, x, v, u0, n, pitch, l = 0.018, h = 0.006, rz = 0) {
  if (!b.hi) return;
  for (let i = 0; i < n; i++) b.box('cavity', 0.0015, h, l, x, v, u0 + i * pitch, { rz, c: 0 });
}

// Kimme/Korn-Leuchtpunkte
/**
 * Gravierte Beschriftung (Typenbezeichnung, Kaliber, Seriennummer) auf einer Seitenfläche bei x: je Zeile ein Text, je
 * Zeichen ein feiner heller Strich in Buchstabengröße (aus der Nähe liest es sich als Gravur auf brüniertem Metall),
 * Leerzeichen = Lücke. Zeilen von oben nach unten. Nur Nah-Stufe.
 */
export function engrave(b, x, v, u0, rows, o = {}) {
  if (!b.hi) return;
  const h = o.h ?? 0.0017, cw = o.cw ?? 0.00105, gap = o.gap ?? 0.00042, line = o.line ?? 0.0029, mat = o.mat ?? 'stainless';
  const dir = o.dir ?? 1; // Schreibrichtung entlang u (+1 zur Mündung)
  rows.forEach((text, i) => {
    let u = u0;
    for (const ch of String(text)) {
      if (ch === ' ') { u += dir * (cw + gap) * 1.2; continue; }
      const narrow = ch === '-' || ch === '.' || ch === ',' || ch === '1' || ch === 'I';
      const w = narrow ? cw * 0.45 : cw;
      const hh = ch === '-' ? h * 0.25 : ch === '.' || ch === ',' ? h * 0.3 : h;
      const vv = ch === '.' || ch === ',' ? v - i * line - h * 0.35 : v - i * line;
      b.box(mat, 0.0003, hh, w, x, vv, u + dir * w / 2, { part: o.part, c: 0 });
      u += dir * (w + gap);
    }
  });
}

/** QD-Riemenaufnahme (Stahlring mit Bohrung) auf einer Seitenfläche bei x (Vorzeichen = Seite). */
export function qdCup(b, x, v, u, r = 0.0058, o = {}) {
  if (!b.hi) return;
  const s = Math.sign(x) || 1;
  b.cyl('steel', r, r, 0.003, x + s * 0.0012, v, u, { axis: 'x', seg: 14, part: o.part });
  b.cyl('cavity', r * 0.55, r * 0.55, 0.0032, x + s * 0.0014, v, u, { axis: 'x', seg: 10, part: o.part });
}

export function dot(b, mat, x, v, u, r = 0.0013) {
  if (!b.hi) return;
  b.circle(mat, r, x, v, u, { seg: 10 });
}

export { roundRect, ellipsePts };
