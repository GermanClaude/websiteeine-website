// P-9A (26.10.): eigene Oberflächen nach dem Referenzfoto der Glock 18C (p9a-ref.js). EIN Atlas für Schlitten und Rahmen (wie die
// Adler: zwei Materialien – Nitrid-Schlitten metallisch, Rahmen Polymer – teilen die Karten), gezeichnet in Fotopixeln:
//   – Schlitten links/rechts (je ein Band, rechts spiegelbildlich beschriftet), Oberseite + Stirn-/Rück-/Innenflächen in einem
//     Querband; Sägezahnrillen wie die P-9 (Höhe → Normalen), eigene Beschriftung (NULLPUNKT-Zeichen, „P9A“, „9x19“) an den Stellen
//     der Herstellerschrift, erhabene Wahlhebel-Punkte (1 Punkt Einzel oben, 2 Punkte Dauer unten), Kantenabrieb, Holsterkratzer;
//   – Rahmen (Gen 3): Kieselfeld auf den Griffseiten mit glattem Zeichenfeld, Querrillen auf dem Griffrücken, gerippte Felder in den
//     Fingermulden, Formnaht, feines Spritzgusskorn.
// Aufteilung (Anteile der Atlasgröße, alle Stufen gleich): Zeilen 0–0,195 Schlitten links, 0,195–0,39 rechts, 0,39–0,5 Oberseite,
// 0,5–1 Rahmen. Größe je Stufe (Bauanleitung §8.3): PC hoch 2048 × 1024, PC niedrig/mittel 1536 × 768, Handy 1024 × 512 ohne
// Rauheitskarte, Normalen dort halb so groß (≈ 3,5 MB).
import { canvas, toTexture, cached, rng } from './textures.js';
import { CPU, grey, path, subPath, engrave, pebblePattern, streak, scratches, noiseCanvas, grainCanvas, readHeight, blur, normalTex } from './pistol-tex.js';
import * as R from './p9a-ref.js';

// ---------------------------------------------------------------- Atlas-Abbildung
const SX0 = 80, SX1 = 2140, SY0 = 76, SY1 = 330;          // Fotofenster der Schlittenbänder
const FX0 = 80, FX1 = 2260, FY0 = 300, FY1 = 1450;        // Fotofenster des Rahmens
const BL = [0, 0.195], BR = [0.195, 0.39], BT = [0.39, 0.5], BF = [0.5, 1];   // Zeilenbereiche (Anteil, von oben)
const TOPW = 0.0142;                                      // halbe Breite im Querband (Schlitten 12,75 mm + Wahlschalter-Rand)
const colS = (px) => (px - SX0) / (SX1 - SX0);
const rowIn = (b, t) => b[0] + Math.min(1, Math.max(0, t)) * (b[1] - b[0]);

/** Atlas-UV des Schlittens (atlasUVTri: Normale je Dreieck): Seiten aus der Fotoprojektion, sonst Querband (Breite × Länge). */
export function p9aSlideUV(x, v, u, nx, ny) {
  const col = colS(R.photoX(u));
  let row;
  if (Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) > 0.35) row = rowIn(nx > 0 ? BR : BL, (R.photoY(v) - SY0) / (SY1 - SY0));
  else row = rowIn(BT, (x + TOPW) / (2 * TOPW));
  return [col, 1 - row];
}
/** Atlas-UV des Rahmens (beide Seiten gleich, Projektion entlang x; Zeichen symmetrisch). */
export function p9aFrameUV(x, v, u) {
  return [(R.photoX(u) - FX0) / (FX1 - FX0), 1 - rowIn(BF, (R.photoY(v) - FY0) / (FY1 - FY0))];
}
/** Musterwiederholung für Tarnmuster (Atlas-UV → 0,2 m je Einheit wie die übrigen Teile). */
export const CAMO_REPEAT = [(SX1 - SX0) / R.PPM / 0.2, (FY1 - FY0) / R.PPM / 0.2 * 2];

// Leinwand-Transformation: Fotorechteck [x0, x1] × [y0, y1] → Zeilenbereich rows (Anteil) des Atlas W × H
function ctxBand(g, W, H, x0, x1, y0, y1, rows) {
  const sx = W / (x1 - x0), sy = H * (rows[1] - rows[0]) / (y1 - y0);
  g.setTransform(sx, 0, 0, sy, -x0 * sx, H * rows[0] - y0 * sy);
  return [sx, sy];
}

// ---------------------------------------------------------------- Zeichenhilfen
const FONT = '"DIN Alternate", Bahnschrift, "Arial Narrow", Arial, Helvetica, sans-serif';
// Zeichen der eigenen Marke (wie P-9): abgerundetes Feld mit Fadenkreuz-Null, symmetrisch
function emblem(g, x0, y0, x1, y1, lw) {
  const r = (y1 - y0) * 0.18;
  g.lineWidth = lw;
  g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); g.stroke();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rr = (y1 - y0) * 0.27;
  g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - rr * 1.55, cy); g.lineTo(cx + rr * 1.55, cy); g.moveTo(cx, cy - rr * 1.55); g.lineTo(cx, cy + rr * 1.55); g.stroke();
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- Schlitten
// kind: 'h' Höhe, 'a' Albedo, 'r' Rauheit; mirror: rechte Seite (Schrift spiegelbildlich, damit sie von rechts lesbar ist)
function drawSlideSide(g, kind, mirror) {
  // Sägezahnrillen (7, wie P-9): flache Fläche – schräge Flanke – steile Wand
  const { x0, x1, n } = R.SERR, pitch = (x1 - x0) / n, yTop = 106, yBot = 310;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * pitch, xf = xa + pitch * 0.58, xw = xa + pitch * 0.94, xe = xa + pitch;
    if (kind === 'h') {
      const gr = g.createLinearGradient(xf, 0, xw, 0); gr.addColorStop(0, grey(0.5)); gr.addColorStop(1, grey(0.22));
      g.fillStyle = gr; g.fillRect(xf, yTop, xw - xf, yBot - yTop);
      g.fillStyle = grey(0.3); g.fillRect(xw, yTop, xe - xw, yBot - yTop);
    } else if (kind === 'a') {
      g.fillStyle = 'rgba(20,21,24,0.35)'; g.fillRect(xf, yTop, xw - xf, yBot - yTop);
      g.fillStyle = 'rgba(10,10,12,0.6)'; g.fillRect(xw - 0.4, yTop, 1.8, yBot - yTop);
    } else { g.fillStyle = grey(0.5); g.fillRect(xf, yTop, xe - xf, yBot - yTop); }
  }
  // Beschriftung (links: Zeichen, Typ, Hersteller, Kaliber; rechts: Nummer und Kaliber, spiegelbildlich)
  g.fillStyle = g.strokeStyle = { h: grey(0.3), a: 'rgba(28,29,32,0.92)', r: grey(0.62) }[kind];
  if (!mirror) {
    const [lx0, ly0, lx1, ly1] = R.MARKS.logo;
    emblem(g, lx0, ly0, lx1, ly1, 4.4);
    const [mx0, , , my1] = R.MARKS.model, [ox0, , , oy1] = R.MARKS.origin, [cx0, , , cy1] = R.MARKS.cal;
    g.save(); g.translate(mx0, my1 - 2); g.scale(0.9, 1); g.font = `400 58px ${FONT}`; g.fillText('P9A', 0, 0); g.restore();
    g.save(); g.translate(ox0, oy1 - 3); g.scale(0.86, 1); g.font = `600 30px ${FONT}`; g.fillText('NULLPUNKT', 0, 0); g.restore();
    g.font = `600 31px ${FONT}`; g.fillText('9x19', cx0, cy1 - 3);
  } else {
    for (const [s, x, px] of [['NPK 1803', 470, 25], ['9x19', 900, 25]]) {
      g.save(); g.translate(x, 262); g.scale(-1, 1); g.font = `600 ${px}px ${FONT}`; g.fillText(s, -g.measureText(s).width, 0); g.restore();
    }
  }
  // Wahlhebel-Punkte (links): erhaben, matt, Kuppe blank gerieben
  if (!mirror) for (const [x, y, r] of R.SEL_DOTS) {
    if (kind === 'h') { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, grey(0.78)); gr.addColorStop(0.75, grey(0.66)); gr.addColorStop(1, grey(0.5)); g.fillStyle = gr; }
    else g.fillStyle = kind === 'a' ? 'rgba(150,152,156,0.55)' : grey(0.34);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Kantenabrieb und Holsterkratzer (nicht in der Höhe)
  if (kind !== 'h') {
    const rr = rng(mirror ? 191 : 193);
    const wear = (a) => (kind === 'a' ? `rgba(196,199,204,${a})` : `rgba(40,40,40,${a})`);
    streak(g, rr, 92, 2106, 86, 4, 0.55, wear, { len: [10, 100], gap: 40 });     // Kante oben (Fase → Deckfläche)
    streak(g, rr, 96, 2100, 108, 3, 0.5, wear, { len: [10, 100], gap: 40 });    // Fase → Seitenfläche
    streak(g, rr, 96, 1100, 318, 3.4, 0.5, wear, { len: [10, 100], gap: 40 });  // Unterkante vorn (Holster)
    let gr = g.createLinearGradient(89, 0, 152, 0); gr.addColorStop(0, wear(0.75)); gr.addColorStop(1, wear(0));
    g.fillStyle = gr; g.fillRect(86, 85, 66, 238);                               // Nase
    gr = g.createLinearGradient(2110, 0, 2083, 0); gr.addColorStop(0, wear(0.6)); gr.addColorStop(1, wear(0));
    g.fillStyle = gr; g.fillRect(2083, 85, 30, 238);                             // Heck
    for (let i = 0; i <= R.SERR.n; i++) { g.fillStyle = wear(0.7); g.fillRect(R.SERR.x0 + i * (R.SERR.x1 - R.SERR.x0) / R.SERR.n - 0.9, 106, 2.3, 200); }
    scratches(g, rng(mirror ? 177 : 141), [100, 96, 2090, 312], 90, (k) => (kind === 'a' ? `rgba(196,200,206,${0.05 + k * 0.1})` : `rgba(60,60,60,${0.3 + k * 0.3})`), { len: [6, 50], spread: 0.5, lw: [0.5, 1.1] });
  }
}

function drawSlideTop(g, kind) {
  // Querband: Länge = Foto-x, Quer = Zeilen; blanke Kanten an beiden Rändern, Stirn vorn hell, Heck dunkler
  if (kind === 'h') return;
  const wear = (a) => (kind === 'a' ? `rgba(196,199,204,${a})` : `rgba(40,40,40,${a})`);
  const rr = rng(197);
  streak(g, rr, 90, 2110, 0, 0.03, 0.45, wear, { len: [10, 120], gap: 50 });
  streak(g, rr, 90, 2110, 0.97, 0.03, 0.45, wear, { len: [10, 120], gap: 50 });
  g.fillStyle = wear(0.3); g.fillRect(SX0, 0, 90 - SX0, 1);
}

// ---------------------------------------------------------------- Rahmen
function backStrapBand() {
  // Streifen entlang der Griffrückenkante (Kontur von (2006, 779) bis (2240, 1284)), R.BACK_RIBS.depth Fotopixel tief
  const i0 = R.LOWER.findIndex(([x, y]) => x === 2006 && y === 779), i1 = R.LOWER.findIndex(([x, y]) => x === 2240 && y === 1284);
  const edge = R.LOWER.slice(i0, i1 + 1);
  return [...edge, ...edge.slice().reverse().map(([x, y]) => [x - R.BACK_RIBS.depth * 1.15, y + 4])];
}

function drawFrame(g, kind, pats) {
  // Kieselfeld (gespritzte Struktur Gen 3) mit glattem Zeichenfeld
  g.save(); path(g, R.PANEL); g.clip();
  g.fillStyle = pats.pebble; g.fillRect(1500, 650, 700, 700);
  const [ex0, ey0, ex1, ey1] = R.EMBLEM;
  g.fillStyle = { h: grey(0.5), a: grey(0.86), r: grey(0.42) }[kind];
  g.beginPath(); g.roundRect(ex0 - 8, ey0 - 8, ex1 - ex0 + 16, ey1 - ey0 + 16, 10); g.fill();
  g.restore();
  // Rand des Kieselfelds (leicht vertieft) und Zeichen (erhaben)
  const hi = { h: grey(0.64), r: grey(0.32), a: grey(1) }[kind], lo = { h: grey(0.34), r: grey(0.7), a: grey(0.42) }[kind];
  g.strokeStyle = lo; g.lineWidth = 2.6; g.lineJoin = 'round'; path(g, R.PANEL); g.stroke();
  g.strokeStyle = hi; emblem(g, R.EMBLEM[0], R.EMBLEM[1], R.EMBLEM[2], R.EMBLEM[3], 5);
  // Querrillen am Griffrücken
  g.save(); path(g, backStrapBand()); g.clip();
  const { y0, y1, pitch } = R.BACK_RIBS;
  for (let y = y0; y < y1; y += pitch) {
    if (kind === 'h') { g.fillStyle = grey(0.26); g.fillRect(1900, y, 400, pitch * 0.45); g.fillStyle = grey(0.62); g.fillRect(1900, y + pitch * 0.5, 400, pitch * 0.18); }
    else { g.fillStyle = kind === 'a' ? 'rgba(70,70,74,0.5)' : grey(0.72); g.fillRect(1900, y, 400, pitch * 0.45); }
  }
  g.restore();
  // gerippte Felder in den Fingermulden: Querrillen + zwei Längsfugen
  for (const P of R.FINGER_PATCHES) {
    g.save(); path(g, P); g.clip();
    const ys = P.map((p) => p[1]), yA = Math.min(...ys), yB = Math.max(...ys);
    for (let y = yA + 6; y < yB; y += 15) { g.fillStyle = kind === 'h' ? grey(0.28) : kind === 'a' ? 'rgba(40,40,44,0.6)' : grey(0.7); g.fillRect(1400, y, 400, 6); }
    const [a, b2, c, d] = P;
    g.strokeStyle = kind === 'h' ? grey(0.3) : kind === 'a' ? 'rgba(40,40,44,0.6)' : grey(0.7); g.lineWidth = 4;
    for (const t of [0.36, 0.68]) { g.beginPath(); g.moveTo(lerp(a[0], b2[0], t), lerp(a[1], b2[1], t)); g.lineTo(lerp(d[0], c[0], t), lerp(d[1], c[1], t)); g.stroke(); }
    g.restore();
    g.strokeStyle = lo; g.lineWidth = 2; path(g, P); g.stroke();
  }
  // Magazinhalter-Mulde, Loch der Abzugseinheit (Ring), Formnaht längs des Staubschutzes, Trennfuge Bügel
  const [bx, by, br] = R.BACK_PIN;
  g.strokeStyle = lo; g.lineWidth = 2.4; g.beginPath(); g.arc(bx, by, br + 3, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.6; g.beginPath(); g.moveTo(100, 400); g.lineTo(760, 412); g.stroke();
  g.lineWidth = 2; path(g, R.MAG_RELEASE.map(([x, y], i) => [x + (i === 0 || i === 3 ? -6 : 6), y + (i < 2 ? -6 : 6)])); g.stroke();
  // Abrieb an Griffkanten (Albedo/Rauheit)
  if (kind !== 'h') {
    const rr = rng(211);
    scratches(g, rr, [1450, 450, 2240, 1420], 50, (k) => (kind === 'a' ? `rgba(120,122,128,${0.08 + k * 0.12})` : `rgba(60,60,60,${0.2 + k * 0.2})`), { len: [6, 40], spread: 1.6, lw: [0.6, 1.2] });
  }
}

// ---------------------------------------------------------------- Ebenen
// Grundtöne: Schlitten wie P-9 (Nitrid #5c5e62, Material weiß), Rahmen hell (× Materialfarbe 0x232427 wie P-9)
const BASE = { slide: { h: grey(0.5), a: '#5c5e62', r: grey(0.44) }, frame: { h: grey(0.5), a: grey(0.86), r: grey(0.4) } };
function layer(kind, W, H, shared) {
  const c = canvas(W, H), g = c.getContext('2d', CPU);
  g.fillStyle = BASE.slide[kind]; g.fillRect(0, 0, W, H * BF[0]);
  g.fillStyle = BASE.frame[kind]; g.fillRect(0, H * BF[0], W, H * (1 - BF[0]));
  if (kind !== 'h') {
    // Nitrid-Fleckung und Spritzguss-Wolken weich skaliert
    g.save(); g.globalCompositeOperation = 'overlay'; g.imageSmoothingQuality = 'low';
    g.globalAlpha = kind === 'a' ? 0.1 : 0.3; g.drawImage(shared.noise, 0, 0, W, H * BF[0]);
    g.globalAlpha = kind === 'a' ? 0.08 : 0.25; g.drawImage(shared.noise2, 0, H * BF[0], W, H * (1 - BF[0]));
    g.restore();
  }
  // feines Korn überall (Strahlkorn/Spritzguss): als Muster im Atlasmaßstab
  {
    const pat = g.createPattern(shared.grain, 'repeat'), k = W / 2048;
    if (pat.setTransform && typeof DOMMatrix === 'function') pat.setTransform(new DOMMatrix().scale(k, k));
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = kind === 'h' ? 0.05 : kind === 'r' ? 0.18 : 0.05;
    g.fillStyle = pat; g.fillRect(0, 0, W, H); g.restore();
  }
  // Schlitten links / rechts
  for (const [rows, mirror] of [[BL, false], [BR, true]]) {
    g.save(); g.beginPath(); g.rect(0, H * rows[0], W, H * (rows[1] - rows[0])); g.clip();
    ctxBand(g, W, H, SX0, SX1, SY0, SY1, rows);
    drawSlideSide(g, kind, mirror);
    g.restore();
  }
  // Querband (Zeilen 0…1 quer)
  g.save(); g.beginPath(); g.rect(0, H * BT[0], W, H * (BT[1] - BT[0])); g.clip();
  ctxBand(g, W, H, SX0, SX1, 0, 1, BT); drawSlideTop(g, kind); g.restore();
  // Rahmen
  g.save(); g.beginPath(); g.rect(0, H * BF[0], W, H * (BF[1] - BF[0])); g.clip();
  const [, sy] = ctxBand(g, W, H, FX0, FX1, FY0, FY1, BF);
  const pats = { pebble: pebblePattern(g, kind, { size: 150, scale: Math.max(0.5, sy), r0: 2.4, r1: 4.4, n: 760, seed: kind === 'a' ? 17 : 19 }) };
  drawFrame(g, kind, pats);
  g.restore();
  return c;
}

const SIZE = { max: 1, std: 0.75, lite: 0.5 };
function maps(tier) {
  const f = SIZE[tier], W = 2048 * f, H = 1024 * f, nf = tier === 'lite' ? 0.5 : 1, NW = W * nf, NH = H * nf;
  const shared = { noise: noiseCanvas(431, 256, 64, 6), noise2: noiseCanvas(433, 256, 128, 5), grain: grainCanvas(437) };
  const h = blur(readHeight(layer('h', NW, NH, shared)), NW, NH);
  return {
    map: toTexture(layer('a', W, H, shared), { srgb: true, repeat: false, aniso: 8 }),
    normalMap: normalTex(h, NW, NH, 3.0 * f * nf),
    roughnessMap: tier === 'lite' ? null : toTexture(layer('r', W, H, shared), { repeat: false, aniso: 8 }),
  };
}

/** Atlas der P-9A je Stufe ('max' | 'std' | 'lite'); Schlitten und Rahmen teilen ihn. */
export function p9aMaps(tier = 'max') {
  const key = tier === 'max' ? 'p9a' : 'p9a:' + tier;
  return cached(key, () => ({ key, ...maps(tier) }));
}
