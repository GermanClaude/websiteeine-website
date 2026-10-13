// P-9: eigene Oberflächen nach dem Referenzfoto (p9-ref.js) – Texturatlanten statt Kachelmuster.
// Schlitten (2048 × 512): linke Seite, rechte Seite, Oberseite. Sägezahn-Griffrillen, eingeprägte Beschriftung
// (eigene Marke), feine Holsterkratzer. Rahmen (2048 × 1024, beide Seiten gleich): Würfelraster auf den Griffschalen,
// Querrillen an Vorder- und Rückenteil, Fuge des Rückenteils, Stift, Zierfeld (symmetrisch, damit es rechts nicht
// spiegelverkehrt steht). Gezeichnet wird direkt in Fotopixeln; slideUV/frameUV bilden Modellpunkte auf den Atlas ab.
import * as THREE from 'three';
import { canvas, toTexture, cached, heightToNormal, fbm, rng } from './textures.js';
import * as R from './p9-ref.js';

// ---------------------------------------------------------------- Atlas-Abbildung
const S = { W: 2048, H: 512, x0: 160, x1: 1600, y0: 287, y1: 461, band: 224, top: 448 };
const F = { W: 2048, H: 1024, x0: 150, x1: 1860, y0: 430, y1: 1285 };
const photoX = (u) => R.X0 + (R.U0 - u) * R.PPM;
const photoY = (v) => R.Y0 + (R.V0 - v) * R.PPM;

/** Atlas-UV für einen Schlittenpunkt (Modellmaße) mit Flächennormale n. */
export function slideUV(x, v, u, nx, ny) {
  const col = (photoX(u) - S.x0) / (S.x1 - S.x0);
  let row;
  if (Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) > 0.35) row = (photoY(v) - S.y0) / (S.y1 - S.y0) * S.band + (nx > 0 ? S.band : 0);
  else row = S.top + Math.min(1, Math.max(0, (x + 0.0135) / 0.027)) * (S.H - S.top);
  return [col, 1 - row / S.H];
}
/** Atlas-UV für einen Rahmenpunkt (beide Seiten gleich, Projektion entlang x). */
export function frameUV(x, v, u) {
  return [(photoX(u) - F.x0) / (F.x1 - F.x0), 1 - (photoY(v) - F.y0) / (F.y1 - F.y0)];
}
/** Musterwiederholung für Tarnmuster (Atlas-UV → 0,2 m je Einheit wie die übrigen Teile). */
export const SLIDE_CAMO_REPEAT = [(S.x1 - S.x0) / R.PPM / 0.2, (S.y1 - S.y0) / R.PPM * S.H / S.band / 0.2];
export const FRAME_CAMO_REPEAT = [(F.x1 - F.x0) / R.PPM / 0.2, (F.y1 - F.y0) / R.PPM / 0.2];

// ---------------------------------------------------------------- Zeichenhilfen
function ctxIn(c, a, rowOffset = 0, rows = c.height) {
  const g = c.getContext('2d');
  const sx = c.width / (a.x1 - a.x0), sy = rows / (a.y1 - a.y0);
  g.setTransform(sx, 0, 0, sy, -a.x0 * sx, -a.y0 * sy + rowOffset);
  return g;
}
const path = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
const grey = (h) => { const k = Math.max(0, Math.min(255, Math.round(h * 255))); return `rgb(${k},${k},${k})`; };

function readHeight(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
// 3er-Kastenfilter in x und y (weiche Kanten der Prägungen)
function blur(h, w, H) {
  const t = new Float32Array(h.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (h[i - (x > 0)] + h[i] + h[i + (x < w - 1)]) / 3; }
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; h[i] = (t[i - (y > 0) * w] + t[i] + t[i + (y < H - 1) * w]) / 3; }
  return h;
}
const FONT = '"DIN Alternate", Bahnschrift, "Arial Narrow", Arial, Helvetica, sans-serif';
// Gravur in eigener Schrift (Höhe = Tiefe, Albedo dunkler)
function text(g, str, x, yBase, px, { weight = '600', family = 'Arial, Helvetica, sans-serif', mirror = false, stretch = 1 } = {}) {
  g.save();
  g.translate(x, yBase);
  if (mirror) g.scale(-1, 1);
  g.scale(stretch, 1);
  g.font = `${weight} ${px}px ${family}`;
  g.textBaseline = 'alphabetic';
  g.fillText(str, mirror ? -g.measureText(str).width : 0, 0);
  g.restore();
}
// Zeichen der eigenen Marke: abgerundetes Feld mit Fadenkreuz-Null (symmetrisch)
function emblem(g, x0, y0, x1, y1, lw) {
  const r = (y1 - y0) * 0.18;
  g.lineWidth = lw;
  g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); g.stroke();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rr = (y1 - y0) * 0.27;
  g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - rr * 1.55, cy); g.lineTo(cx + rr * 1.55, cy); g.moveTo(cx, cy - rr * 1.55); g.lineTo(cx, cy + rr * 1.55); g.stroke();
}

// ---------------------------------------------------------------- Schlitten
function drawSlide(g, kind, mirror) {
  // kind: 'h' Höhe, 'a' Albedo, 'r' Rauheit
    // Sägezahnrillen: 7 Zähne, je flache Fläche – schräg abfallende Flanke – steile Wand
  const { x0, x1, n } = R.SERR, pitch = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * pitch, xf = xa + pitch * 0.58, xw = xa + pitch * 0.94, xe = xa + pitch;
    if (kind === 'h') {
      const gr = g.createLinearGradient(xf, 0, xw, 0); gr.addColorStop(0, grey(0.5)); gr.addColorStop(1, grey(0.22));
      g.fillStyle = gr; g.fillRect(xf, 312, xw - xf, 141);
      g.fillStyle = grey(0.3); g.fillRect(xw, 312, xe - xw, 141);
    } else if (kind === 'a') {
      g.fillStyle = 'rgba(20,21,24,0.35)'; g.fillRect(xf, 312, xw - xf, 141);
      g.fillStyle = 'rgba(10,10,12,0.6)'; g.fillRect(xw - 0.3, 312, 1.3, 141);
    } else {
      g.fillStyle = grey(0.5); g.fillRect(xf, 312, xe - xf, 141);
    }
  }
  // Beschriftung (links: Marke, Typ, Hersteller, Kaliber; rechts: Nummer und Kaliber)
  g.fillStyle = g.strokeStyle = { h: grey(0.3), a: 'rgba(28,29,32,0.92)', r: grey(0.62) }[kind];
  if (!mirror) {
    const [lx0, ly0, lx1, ly1] = R.MARKS.logo;
    emblem(g, lx0, ly0, lx1, ly1, 3.2);
    text(g, 'P9', 398, 400, 40, { weight: '400', stretch: 0.86, family: FONT });
    text(g, 'Gen 4', 446, 400, 21, { weight: '600', family: FONT });
    text(g, 'NULLPUNKT', 553, 398, 25, { weight: '600', stretch: 0.86, family: FONT });
    text(g, '9x19', 795, 399, 26, { weight: '600', family: FONT });
  } else {
    text(g, 'NPK 0471', 330, 404, 18, { weight: '600', mirror: true, family: FONT });
    text(g, '9x19', 640, 404, 18, { weight: '600', mirror: true, family: FONT });
  }
  // Kantenabrieb (Holster, Hand): blank geriebene, glattere Kanten – Oberkante/Fase, Unterkante vorn, Nase, Heck,
  // Grate der Sägezahnrillen. Unregelmäßig unterbrochen wie echter Abrieb.
  if (kind !== 'h') {
    const rr = rng(mirror ? 91 : 93);
    const wear = (a) => (kind === 'a' ? `rgba(196,199,204,${a})` : `rgba(40,40,40,${a})`);
    const streak = (xa, xb, y, h, a) => { for (let x = xa; x < xb;) { const l = 8 + rr() * 70, k = rr(); if (k > 0.25) { g.fillStyle = wear(a * (0.4 + 0.6 * rr())); g.fillRect(x, y, l, h); } x += l + rr() * 30; } };
    streak(196, 1572, 298, 3, 0.55);          // Kante oben (Fase → Deckfläche)
    streak(200, 1568, 314, 2.2, 0.5);         // Kante Fase → Seitenfläche
    streak(186, 900, 447, 2.4, 0.5);          // Unterkante vorn (Holster)
    let gr = g.createLinearGradient(171, 0, 215, 0); gr.addColorStop(0, wear(0.75)); gr.addColorStop(1, wear(0));
    g.fillStyle = gr; g.fillRect(171, 297, 44, 155);                       // Nase
    gr = g.createLinearGradient(1579, 0, 1560, 0); gr.addColorStop(0, wear(0.6)); gr.addColorStop(1, wear(0));
    g.fillStyle = gr; g.fillRect(1560, 297, 19, 155);                      // Heck
    for (let i = 0; i <= n; i++) { g.fillStyle = wear(0.7); g.fillRect(x0 + i * pitch - 0.6, 312, 1.6, 140); }   // Rillengrate
  }
  // Holsterkratzer und Abrieb (nur Albedo/Rauheit)
  if (kind !== 'h') {
    const r = rng(mirror ? 77 : 41);
    for (let k = 0; k < 120; k++) {
      const x = 180 + r() * 1380, y = 305 + r() * 140, len = 6 + r() * 60, a = (r() - 0.5) * 0.25;
      g.strokeStyle = kind === 'a' ? `rgba(196,200,206,${0.08 + r() * 0.18})` : grey(0.2 + r() * 0.1);
      g.lineWidth = 0.5 + r() * 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
  }
}

function slideBand(kind) {
  const c = canvas(S.W, S.H), g0 = c.getContext('2d', { willReadFrequently: true });
  const base = { h: grey(0.5), a: '#66686c', r: grey(0.42) }[kind];
  g0.fillStyle = base; g0.fillRect(0, 0, S.W, S.H);
  if (kind !== 'h') {
    // wolkige Nitrid-Fleckung und feine Längsmaserung über den ganzen Atlas
    const n = fbm(256, 64, { seed: kind === 'a' ? 51 : 53, period: 6, octaves: 4 });
    const img = g0.getImageData(0, 0, S.W, S.H), d = img.data;
    const rr = rng(kind === 'a' ? 57 : 59), rows = new Float32Array(S.H).map(() => rr() - 0.5);
    const lines = fbm(512, 128, { seed: kind === 'a' ? 61 : 63, period: 32, periodY: 64, octaves: 2 });
    for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
      const v = n[(y >> 3) * 256 + (x >> 3)] - 0.5, i = (y * S.W + x) * 4;
      const st = rows[y] * (0.6 + lines[(y >> 2) * 512 + (x >> 2)]);
      const k = kind === 'a' ? v * 20 + st * 4 : v * 30 + st * 12;
      d[i] += k; d[i + 1] += k; d[i + 2] += k;
    }
    g0.putImageData(img, 0, 0);
    // Oberseite: Kanten abgerieben, Stirnfläche (Mündung) und Heck blank
    const gt = c.getContext('2d');
    const col = (x) => (x - S.x0) / (S.x1 - S.x0) * S.W;
    gt.fillStyle = kind === 'a' ? 'rgba(196,199,204,0.45)' : 'rgba(40,40,40,0.5)';
    gt.fillRect(0, S.top, S.W, 3); gt.fillRect(0, S.H - 3, S.W, 3);
    gt.fillStyle = kind === 'a' ? 'rgba(196,199,204,0.3)' : 'rgba(40,40,40,0.3)';
    gt.fillRect(col(160), S.top, col(176) - col(160), S.H - S.top);
    gt.fillStyle = kind === 'a' ? 'rgba(20,21,24,0.25)' : 'rgba(160,160,160,0.25)';
    gt.fillRect(col(1574), S.top, col(1600) - col(1574), S.H - S.top);
  }
  for (const mirror of [false, true]) {
    const g = ctxIn(c, S, mirror ? S.band : 0, S.band);
    g.save(); g.beginPath(); g.rect(S.x0, S.y0, S.x1 - S.x0, S.y1 - S.y0); g.clip();
    drawSlide(g, kind, mirror);
    g.restore();
  }
  return c;
}

export function p9SlideMaps() {
  return cached('p9slide', () => {
    const h = slideBand('h');
    const hh = blur(readHeight(h), S.W, S.H);
    return {
      map: toTexture(slideBand('a'), { srgb: true, repeat: false, aniso: 8 }),
      normalMap: heightToNormal(hh, S.W, S.H, 3.2),
      roughnessMap: toTexture(slideBand('r'), { repeat: false, aniso: 8 }),
    };
  });
}

// ---------------------------------------------------------------- Rahmen
function frontStrapBand() {
  // Streifen entlang der Griffvorderseite (Fingermulden) von der Bügelunterkante bis zum Griffende, 9 mm tief
  const i0 = R.LOWER.findIndex(([x, y]) => x === 1263 && y === 1213), i1 = R.LOWER.findIndex(([x, y]) => x === 1107 && y === 788);
  const edge = R.LOWER.slice(i0, i1 + 1);
  return [...edge, ...edge.slice().reverse().map(([x, y]) => [x + 40, y])];
}
function backStrapBand() {
  const i0 = R.LOWER.findIndex(([x, y]) => x === 1467 && y === 643), i1 = R.LOWER.findIndex(([x, y]) => x === 1637 && y === 1255);
  const edge = R.LOWER.slice(i0, i1 + 1);
  return [...edge, ...R.SEAM.slice().reverse().map(([x, y]) => [x + 14, y])];
}

function drawFrame(g, kind) {
  const hi = { h: grey(0.62), r: grey(0.34), a: grey(1) }[kind], lo = { h: grey(0.32), r: grey(0.7), a: grey(0.42) }[kind];
  const rib = { h: grey(0.42), r: grey(0.58), a: grey(0.6) }[kind];
  // Würfelraster (RTF): erhabene Quadrate 1,2 mm im 2,1-mm-Raster, Zierfeld ausgespart
  g.save(); path(g, R.RTF); g.clip();
  const [ex0, ey0, ex1, ey1] = R.EMBLEM;
  const P = 16, Q = 9;
  for (let y = 690; y < 1170; y += P) for (let x = 1190; x < 1580; x += P) {
    const ox = ((y / P) & 1) ? P / 2 : 0;
    const qx = x + ox, qy = y;
    if (qx > ex0 - 8 && qx < ex1 + 8 && qy > ey0 - 8 && qy < ey1 + 8) continue;
    g.fillStyle = lo; g.fillRect(qx - 1.5, qy - 1.5, Q + 3, Q + 3);
    g.fillStyle = hi; g.fillRect(qx, qy, Q, Q);
  }
  g.restore();
  // Querrillen vorn (zwischen den Fingermulden) und am Rückenteil
  for (const band of [frontStrapBand(), backStrapBand()]) {
    g.save(); path(g, band); g.clip();
    for (let y = 560; y < 1260; y += 15) { g.fillStyle = rib; g.fillRect(1050, y, 700, 5); }
    g.restore();
  }
  // Fuge des Rückenteils, Haltestift, Zierfeld
  g.strokeStyle = lo; g.lineWidth = 3.2; g.lineJoin = 'round';
  g.beginPath(); R.SEAM.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  const [bx, by, br] = R.BACKSTRAP_PIN;
  g.lineWidth = 2.4; g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = hi; emblem(g, ex0, ey0, ex1, ey1, 4);
  // Formtrennnaht längs des Staubschutzes
  g.strokeStyle = lo; g.lineWidth = 1.2; g.beginPath(); g.moveTo(190, 540); g.lineTo(640, 548); g.stroke();
}

function frameLayer(kind) {
  const c = canvas(F.W, F.H), g0 = c.getContext('2d', { willReadFrequently: true });
  g0.fillStyle = { h: grey(0.5), r: grey(0.4), a: grey(0.86) }[kind]; g0.fillRect(0, 0, F.W, F.H);
  if (kind !== 'h') {
    const n = fbm(256, 128, { seed: 61, period: 5, octaves: 4 });
    const img = g0.getImageData(0, 0, F.W, F.H), d = img.data;
    for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) { const v = (n[(y >> 3) * 256 + (x >> 3)] - 0.5) * 40, i = (y * F.W + x) * 4; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
    g0.putImageData(img, 0, 0);
  }
  drawFrame(ctxIn(c, F), kind);
  return c;
}

export function p9FrameMaps() {
  return cached('p9frame', () => {
    const h = readHeight(frameLayer('h'));
    // feines Spritzgusskorn auf der ganzen Fläche
    const n = fbm(512, 256, { seed: 67, period: 64, octaves: 2, gain: 0.5 });
    for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) h[y * F.W + x] += (n[(y >> 2) * 512 + (x >> 2)] - 0.5) * 0.035;
    blur(h, F.W, F.H);
    return {
      map: toTexture(frameLayer('a'), { srgb: true, repeat: false, aniso: 8 }),
      normalMap: heightToNormal(h, F.W, F.H, 3.0),
      roughnessMap: toTexture(frameLayer('r'), { repeat: false, aniso: 8 }),
    };
  });
}

/** UVs je Dreieck setzen (Geometrie wird dafür entindiziert); fn(x, v, u, nx, ny, nz) → [U, V]. */
export function atlasUV(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array, n = p.length / 3, uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const i = t * 3;
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) {
      const j = (t + k) * 3;
      const [U, W] = fn(p[j], p[j + 1], -p[j + 2], nx, ny, nz);
      uv[(t + k) * 2] = U; uv[(t + k) * 2 + 1] = W;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
