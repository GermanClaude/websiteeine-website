// VP-9: eigene Oberflächen nach dem Referenzfoto (vp9-ref.js, 24.10.2026). EIN Atlas für alle Kunststoffteile (Griffstück
// mit Griff und Bügel, Handschutz, Schulterstütze), gezeichnet in Fotopixeln und entlang x projiziert (beide Seiten gleich –
// keine Schrift im Atlas, Gravuren als Schriftfelder über schrift.js): Spritzgusskorn, Griff mit Feinstruktur, Feuerstoß-
// Piktogramme (rot, Sicher weiß) mit Zuleitungen zur Wahlhebelachse, Fischhaut-Felder des Handschutzes, Gummikappe mit
// Rippen (eigenes Feld für die Rückseite), Kantenabrieb und Griffspuren. Albedo trägt die echte Farbe (Material weiß).
import { canvas, toTexture, cached, heightToNormal, fbm, rng } from './textures.js';
import * as R from './vp9-ref.js';
import { hkPictograms } from './hk-tex.js';

// ---------------------------------------------------------------- Atlas-Abbildung (Fotopixel → Atlas)
const F = { W: 2048, H: 1024, x0: 50, x1: 1100, y0: 110, y1: 440 };
const PLAIN = [150, 205, 440, 300], BACK = [150, 312, 440, 436];   // freie Fotobereiche: Blankfeld, Kappe von hinten
const photoX = (u) => R.XG + u * R.PPM, photoY = (v) => R.YB - (v - R.AXIS) * R.PPM;
const at = (px, py) => [(px - F.x0) / (F.x1 - F.x0), 1 - (py - F.y0) / (F.y1 - F.y0)];
const U_BUTT = R.U(140), V_BT = R.V(121), V_BB = R.V(317);
/** Atlas-UV je Dreieck nach Flächenrichtung: Seiten aus der Fotoprojektion, Kappe hinten ins Rippenfeld, Ober-/Unter-
 *  und Stirnflächen ins Blankfeld (Korn ohne verschmierte Seitenprojektion). */
export function vp9UV(x, v, u, nx, ny, nz) {
  if (Math.abs(nx) > 0.6) return at(photoX(u), photoY(v));
  if (nz > 0.45 && u < U_BUTT) return at(BACK[0] + (x + 0.025) / 0.05 * (BACK[2] - BACK[0]), BACK[1] + (V_BT - v) / (V_BT - V_BB) * (BACK[3] - BACK[1]));
  const fx = (x + 0.025) / 0.05 * (PLAIN[3] - PLAIN[1]);
  if (Math.abs(ny) >= Math.abs(nz)) { const px = photoX(u); return at(PLAIN[0] + (((px - PLAIN[0]) % 580) + 580) % 290, PLAIN[1] + fx); }
  const t = ((((R.YB - photoY(v)) * 1.3) % 580) + 580) % 580, tri = 290 - Math.abs(t - 290);   // gespiegelt wiederholt
  return at(PLAIN[0] + tri, PLAIN[1] + fx);
}
export const CAMO_REPEAT = [(F.x1 - F.x0) / R.PPM / 0.2, (F.y1 - F.y0) / R.PPM / 0.2];

// ---------------------------------------------------------------- Zeichnen
const CPU = { willReadFrequently: true };   // alle Hilfsleinwände im Hauptspeicher (GPU↔CPU-Kopien kosten im Software-GL viel)
const grey = (h) => { const k = Math.max(0, Math.min(255, Math.round(h * 255))); return `rgb(${k},${k},${k})`; };
const path = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
function ctxIn(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const sx = c.width / (F.x1 - F.x0), sy = c.height / (F.y1 - F.y0);
  g.setTransform(sx, 0, 0, sy, -F.x0 * sx, -F.y0 * sy);
  return g;
}
// Piktogramme des Feuerstoß-Griffstücks (mm relativ zur Wahlhebelachse, vom linken Detailfoto übertragen): Dauer (7 Patronen,
// oben), Feuerstoß (3), Einzel (1), Sicher (weiß, durchgekreuzt) – Spitzen zeigen nach vorn
const PICTO = [
  { n: 7, u0: -20.5, u1: 26.5, v0: 9.0, v1: 12.4, lead: [4.0, 9.0] },
  { n: 3, u0: 8.6, u1: 30.0, v0: 0.8, v1: 4.2, lead: [8.6, 2.5] },
  { n: 1, u0: 9.0, u1: 16.4, v0: -6.8, v1: -4.1, lead: [9.0, -5.4] },
  { n: 1, u0: -2.0, u1: 5.4, v0: -14.4, v1: -11.0, lead: [1.7, -11.0], safe: true },
];
const RED = '#a7362a', WHITE = '#dcdad2';
const POLY = [38, 39, 42];                 // Grundton Kunststoff (sRGB)

// Punktstruktur (Strahlkorn, Gummi) als kleine Leinwand in Atlasauflösung statt tausender Einzel-Rechtecke im Clip
// (die kosteten beim Rastern ≈ 0,3 s je Ebene); col(r) → [Grauwert, Alpha]
function dots(g, w, h, p, seed, col) {
  const m = g.getTransform(), cw = Math.max(1, Math.round(w * m.a)), ch = Math.max(1, Math.round(h * m.d));
  const c = canvas(cw, ch), x = c.getContext('2d', CPU), img = x.createImageData(cw, ch), d = img.data, r = rng(seed);
  for (let i = 0; i < cw * ch; i++) {
    if (r() >= p) continue;
    const [k, a] = col(r); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = k; d[i * 4 + 3] = a;
  }
  x.putImageData(img, 0, 0);
  return c;
}

function draw(g, kind) {
  const k = R.PPM / 1000;                  // Fotopixel je mm
  const [sx, sy] = R.SELECTOR;
  const deep = { h: grey(0.36), r: grey(0.86), a: 'rgba(14,14,16,0.55)' }[kind];
  const hiC = { h: grey(0.6), r: grey(0.62), a: 'rgba(70,72,76,0.35)' }[kind];
  // ---- Griff: feine Struktur (Strahlkorn-ähnliche Punkte) innerhalb des Griffumrisses unter dem Gehäuse
  g.save(); path(g, R.HOUSING); g.clip();
  g.beginPath(); g.rect(440, R.GUARD_Y + 2, R.GRIP_X1 - 440 - 4, 200); g.clip();
  g.imageSmoothingEnabled = false;
  g.drawImage(dots(g, 170, 170, 0.12, kind === 'a' ? 211 : 213, (r) => (kind === 'h' ? (r() < 0.5 ? [97, 255] : [163, 255])
    : kind === 'r' ? [204 + r() * 38, 255] : (r() < 0.5 ? [20, 90] : [65, 90]))), 440, R.GUARD_Y, 170, 170);
  g.restore();
  // Griff: Formtrennkante unter dem Gehäuse, Daumenauflage-Kante
  g.strokeStyle = deep; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(533, R.GUARD_Y); g.lineTo(600, R.GUARD_Y); g.stroke();
  // ---- Feuerstoß-Piktogramme (vertiefte Farbfüllung) und Zuleitungen
  const col = (it) => (kind === 'a' ? (it.safe ? WHITE : RED) : kind === 'h' ? grey(0.42) : grey(0.5));
  for (const it of PICTO) hkPictograms(g, [{ ...it, col: col(it) }], sx, sy, k, { lw: 0.36 });
  // ---- Navy-Feld (vertieftes Feld um die Piktogramme): Rand als feine Kante
  g.strokeStyle = deep; g.lineWidth = 0.6;
  g.beginPath(); g.roundRect(503, 189, 194, 62, 4); g.stroke();
  // ---- Bügel/Griffstück: Formtrennnaht längs, Auswerfermarken (kleine Kreise) innen
  g.strokeStyle = hiC; g.lineWidth = 0.5;
  for (const [x, y] of [[520, 238], [700, 230], [660, 330]]) { g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.stroke(); }
  // ---- Handschutz: Fischhaut-Felder (Rauten 1,3 mm), glatter Rahmen
  for (const [x0, y0, x1, y1] of R.HG_PANELS) {
    g.save(); g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, 2); g.clip();
    const p = 1.3 * k;
    g.strokeStyle = { h: grey(0.3), r: grey(0.9), a: 'rgba(10,10,12,0.5)' }[kind]; g.lineWidth = p * 0.42;
    for (let d = -80; d < (x1 - x0) + 80; d += p) {
      g.beginPath(); g.moveTo(x0 + d, y0); g.lineTo(x0 + d + (y1 - y0), y1); g.stroke();
      g.beginPath(); g.moveTo(x0 + d, y1); g.lineTo(x0 + d + (y1 - y0), y0); g.stroke();
    }
    g.restore();
    g.strokeStyle = deep; g.lineWidth = 0.7; g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, 2); g.stroke();
  }
  // Handschutz: Trennfuge der Schalen (Mitte unten) und Formkante oben
  g.strokeStyle = deep; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(878, 165); g.lineTo(1084, 165); g.stroke();
  // ---- Schulterstütze: Gummikappe (untere Hälfte) mit Naht, Rahmen oben glatt
  g.save(); path(g, R.BUTT); g.clip();
  g.fillStyle = { h: grey(0.5), r: grey(0.93), a: 'rgba(30,30,32,0.5)' }[kind];
  g.beginPath(); g.moveTo(40, 205); g.lineTo(140, 190); g.lineTo(140, 330); g.lineTo(40, 330); g.closePath(); g.fill();
  g.imageSmoothingEnabled = false;
  g.drawImage(dots(g, 60, 125, 0.08, kind === 'a' ? 221 : 223, (r) => (kind === 'h' ? [r() < 0.5 ? 112 : 143, 255]
    : kind === 'r' ? [230 + r() * 20, 255] : [47, 64])), 55, 195, 60, 125);
  g.strokeStyle = deep; g.lineWidth = 0.8; g.beginPath(); g.moveTo(40, 205); g.lineTo(140, 190); g.stroke();
  g.restore();
  // ---- Kappe von hinten (eigenes Feld): Querrippen, umlaufender Rand
  const [qx0, qy0, qx1, qy1] = BACK;
  g.fillStyle = { h: grey(0.5), r: grey(0.92), a: 'rgba(30,30,32,0.6)' }[kind]; g.fillRect(qx0, qy0, qx1 - qx0, qy1 - qy0);
  for (let y = qy0 + (qy1 - qy0) * 0.45; y < qy1 - 4; y += 4.2) { g.fillStyle = deep; g.fillRect(qx0 + 30, y, qx1 - qx0 - 60, 1.6); }
  // ---- Kantenabrieb (nur Albedo/Rauheit): Griffrücken, Bügelunterkante, Handschutz-Kanten
  if (kind !== 'h') {
    const rw = rng(kind === 'a' ? 231 : 233);
    const wear = (a) => (kind === 'a' ? `rgba(66,68,72,${a})` : `rgba(70,70,70,${a})`);
    const streak = (xa, xb, y, h, a) => { for (let x = xa; x < xb;) { const l = 3 + rw() * 22, q = rw(); if (q > 0.3) { g.fillStyle = wear(a * (0.4 + 0.6 * rw())); g.fillRect(x, y, l, h); } x += l + rw() * 14; } };
    streak(878, 1080, 118.5, 1.0, 0.25); streak(878, 1080, 190.5, 1.2, 0.3);   // Handschutz oben/unten
    streak(600, 690, 331.5, 1.3, 0.5);                                         // Bügel unten
    streak(455, 750, 185.5, 0.9, 0.35);                                        // Griffstück oben
    // Griffspuren: speckige, glattere Flecken am Griff
    for (let i = 0; i < 14; i++) {
      const x = 470 + rw() * 110, y = 290 + rw() * 120, r0 = 6 + rw() * 12;
      const gr = g.createRadialGradient(x, y, 0, x, y, r0);
      gr.addColorStop(0, kind === 'a' ? 'rgba(80,82,86,0.18)' : 'rgba(60,60,60,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
    }
    // feine Kratzer
    for (let i = 0; i < 90; i++) {
      const x = 460 + rw() * 630, y = 120 + rw() * 300, len = 2 + rw() * 14, a = (rw() - 0.5) * 0.8;
      g.strokeStyle = kind === 'a' ? `rgba(110,112,118,${0.08 + rw() * 0.12})` : `rgba(60,60,60,${0.3 + rw() * 0.3})`;
      g.lineWidth = 0.25 + rw() * 0.3;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
  }
}

// Rauschen als kleine Leinwände, skaliert bzw. als Muster aufgetragen (statt Schleifen über jedes Atlaspixel: der Atlas
// entsteht im Hauptthread – PC ≈ 0,3 s, Handy ≈ 0,1 s direkt in halber Größe; Software-GL gemessen)
function noiseCanvas(seed) {
  const n = fbm(256, 128, { seed, period: 5, octaves: 4 }), c = canvas(256, 128), g = c.getContext('2d', CPU), img = g.createImageData(256, 128);
  for (let i = 0; i < 256 * 128; i++) { const k = Math.max(0, Math.min(255, n[i] * 255)); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
function grainCanvas(seed, size = 128) {
  const c = canvas(size, size), g = c.getContext('2d', CPU), img = g.createImageData(size, size), r = rng(seed);
  for (let i = 0; i < size * size; i++) { const k = (r() * 255) | 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
function layer(kind, W, H) {
  const c = canvas(W, H), g0 = c.getContext('2d', { willReadFrequently: true });
  g0.fillStyle = kind === 'a' ? `rgb(${POLY.join(',')})` : { h: grey(0.5), r: grey(0.74) }[kind];
  g0.fillRect(0, 0, W, H);
  // wolkige Fleckung (Spritzguss, matt/glänzend) weich skaliert, feines Korn als Kachelmuster; Höhe: Korn ≈ 0,15 mm
  g0.save();
  g0.globalCompositeOperation = 'overlay';
  if (kind !== 'h') { g0.globalAlpha = kind === 'a' ? 0.1 : 0.32; g0.imageSmoothingQuality = 'high'; g0.drawImage(noiseCanvas(kind === 'a' ? 241 : 243), 0, 0, W, H); }
  g0.globalAlpha = kind === 'a' ? 0.05 : kind === 'r' ? 0.16 : 0.08;
  g0.fillStyle = g0.createPattern(grainCanvas(kind === 'a' ? 245 : kind === 'r' ? 247 : 251), 'repeat');
  g0.fillRect(0, 0, W, H);
  g0.restore();
  draw(ctxIn(c), kind);
  return c;
}
function readHeight(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
function blur(h, w, H) {
  const t = new Float32Array(h.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (h[i - (x > 0)] + h[i] + h[i + (x < w - 1)]) / 3; }
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; h[i] = (t[i - (y > 0) * w] + t[i] + t[i + (y < H - 1) * w]) / 3; }
  return h;
}
function maps(lite) {
  // Handy (V4): halbe Kantenlänge direkt gezeichnet (¼ Speicher und Zeit); Normalenstärke halbiert (doppelte Texelgröße)
  const W = lite ? F.W / 2 : F.W, H = lite ? F.H / 2 : F.H;
  const h = blur(readHeight(layer('h', W, H)), W, H);
  return {
    map: toTexture(layer('a', W, H), { srgb: true, repeat: false, aniso: 8 }),
    normalMap: heightToNormal(h, W, H, lite ? 1.3 : 2.6),
    roughnessMap: toTexture(layer('r', W, H), { repeat: false, aniso: 8 }),
  };
}

/** Kunststoff-Atlas der VP-9; lite (Handy): halbe Kantenlänge (¼ Speicher), direkt in dieser Größe gezeichnet. */
export function vp9FurnMaps(lite = false) {
  if (lite) return cached('vp9furn:lite', () => ({ key: 'vp9furn:lite', ...maps(true) }));
  return cached('vp9furn', () => ({ key: 'vp9furn', ...maps(false) }));
}
