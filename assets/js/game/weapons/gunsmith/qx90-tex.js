// QX-90: eigene Oberflächen nach den Referenzfotos (qx90-ref.js), zwei Atlanten in Fotopixeln (rechte Seite):
//   Rahmen (qx90Frame): Schaft, Oberrahmen, Griffmodul, Abzugsschlaufe – rechte Seite, linke Seite (Lagen aus dem linken
//     Foto über L2R) und Ober-/Unterseite. Matter Spritzguss mit Wolken, Formnaht oben/unten, Abrieb an Griff- und
//     Schaftkanten, Senkungen der Schrauben, eingeformte eigene Beschriftung links (statt des Werksnamens des Vorbilds).
//   Gehäuse (qx90Upper): Lauf- und Visiergruppe, lackierter Guss – halbglänzend, sehr feines Korn, helle Kratzer und
//     blanke Kanten wie im Foto, eingeprägte eigene Nummer links vorn (statt der Seriennummer des Vorbilds).
//   Kratzer liegen nur in Farbe und Rauheit, nicht im Höhenkanal (Prüfung 25.10.: Hammerschlag-/Schleifpapier-Eindruck).
// Größen (Bauanleitung 8.3): PC Rahmen 2048 × 1024 (Normalen und Rauheit 1024 × 512), Gehäuse 1024 × 512 (Rauheit 512 × 256);
// Handy Rahmen 768 × 384 (Normalen 384 × 192), Gehäuse 512 × 256 (Normalen 256 × 128), ohne Rauheitskarten – zusammen
// ≈ 2,9 MB mit Mipmaps (Bauanleitung 8.3: ≤ 4 MB; vorher 4,9 MB).
// Gezeichnet wird im Hintergrund in Zeitscheiben (textures.js scheduleAtlas) – sofort Platzhalter, dann das fertige Bild;
// jede Ebene in Teilschritten (Grundton, rechte Seite, linke Seite), kein Schritt über ≈ 30 ms am PC.
import { canvas, toTexture, cached, rng, scheduleAtlas } from './textures.js';
import { mottle, moldedText, edgeWear, scuffs, ring, GREY } from './poly-tex.js';
import * as R from './qx90-ref.js';

const photoX = (u) => R.XG + u * R.PPM;
const photoY = (v) => R.YB - (v - R.AXIS) * R.PPM;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---------------------------------------------------------------- Abbildungen (Fotopixel → Atlas)
// Rahmen: Zeilen 0…447 rechts, 448…895 links, 896…1023 oben/unten/vorn/hinten (quer über die Breite)
const FA = { x0: 140, x1: 1860, y0: 445, y1: 985, hw: 0.028 };
/** Atlas-UV für Rahmen und Schaftkappe (Projektion je Flächenrichtung). */
export function frameUV(x, v, u, nx, ny, nz) {
  const col = (photoX(u) - FA.x0) / (FA.x1 - FA.x0);
  if (Math.abs(nx) > 0.55) return [col, 1 - (clamp01((photoY(v) - FA.y0) / (FA.y1 - FA.y0)) * 447 + (nx > 0 ? 0 : 448)) / 1024];
  // Stirnflächen (Kappe hinten, Stufen, Schlaufe vorn): Höhe → Spalte, Breite → Zeile im Ober-/Unterseitenband
  // (Spaltenspanne so gewählt, dass ein Texel in Höhe und Breite gleich groß ist – sonst Streifen)
  if (Math.abs(nz) > Math.abs(ny)) return [0.02 + 0.165 * clamp01((photoY(v) - FA.y0) / (FA.y1 - FA.y0)), 1 - (896 + clamp01((x + FA.hw) / (2 * FA.hw)) * 127) / 1024];
  return [col, 1 - (896 + clamp01((x + FA.hw) / (2 * FA.hw)) * 127) / 1024];
}
export const FRAME_CAMO_REPEAT = [(FA.x1 - FA.x0) / R.PPM / 0.2, (FA.y1 - FA.y0) / R.PPM / 0.2 * 1024 / 448];
// Gehäuse: Zeilen 0…223 rechts, 224…447 links, 448…511 oben/unten
const UA = { x0: 1185, x1: 1860, y0: 230, y1: 650, hw: 0.027 };
/** Atlas-UV für Gehäuse (Guss) und Seitenschienen. */
export function upperUV(x, v, u, nx, ny, nz) {
  const col = (photoX(u) - UA.x0) / (UA.x1 - UA.x0);
  if (Math.abs(nx) > 0.55) return [col, 1 - (clamp01((photoY(v) - UA.y0) / (UA.y1 - UA.y0)) * 223 + (nx > 0 ? 0 : 224)) / 512];
  if (Math.abs(nz) > Math.abs(ny)) return [0.02 + 0.13 * clamp01((photoY(v) - UA.y0) / (UA.y1 - UA.y0)), 1 - (448 + clamp01((x + UA.hw) / (2 * UA.hw)) * 63) / 512];
  return [col, 1 - (448 + clamp01((x + UA.hw) / (2 * UA.hw)) * 63) / 512];
}
export const UPPER_CAMO_REPEAT = [(UA.x1 - UA.x0) / R.PPM / 0.2, (UA.y1 - UA.y0) / R.PPM / 0.2 * 512 / 224];

// ---------------------------------------------------------------- Helfer
function bandCtx(c, win, rows, row0, total) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const k = c.height / total, s = c.width / (win.x1 - win.x0), t = rows * k / (win.y1 - win.y0);
  g.setTransform(s, 0, 0, t, -win.x0 * s, -win.y0 * t + row0 * k);
  return g;
}
function heightField(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
function blur(h, w, H) {
  const t = new Float32Array(h.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (h[i - (x > 0)] + h[i] + h[i + (x < w - 1)]) / 3; }
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; h[i] = (t[i - (y > 0) * w] + t[i] + t[i + (y < H - 1) * w]) / 3; }
  return h;
}
function* normalsInto(c, height, w, h, strength) {
  const g = c.getContext('2d', { willReadFrequently: true }), img = g.createImageData(w, h), d = img.data;
  const Hh = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y0 = 0; y0 < h; y0 += 32) {
    for (let y = y0; y < Math.min(h, y0 + 32); y++) for (let x = 0; x < w; x++) {
      const dx = (Hh(x + 1, y - 1) + 2 * Hh(x + 1, y) + Hh(x + 1, y + 1)) - (Hh(x - 1, y - 1) + 2 * Hh(x - 1, y) + Hh(x - 1, y + 1));
      const dy = (Hh(x - 1, y + 1) + 2 * Hh(x, y + 1) + Hh(x + 1, y + 1)) - (Hh(x - 1, y - 1) + 2 * Hh(x, y - 1) + Hh(x + 1, y - 1));
      const nx = -dx * strength, ny = dy * strength, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    yield;
  }
  g.putImageData(img, 0, 0);
}
function filled(W, H, css) { const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = css; g.fillRect(0, 0, W, H); return c; }
const rough = (r) => `rgb(255,${Math.round(r * 255)},255)`;
function deferredSet(W, H, nW, nH, base, r, lite) {
  return {
    map: toTexture(filled(W, H, base), { srgb: true, repeat: false, aniso: 8 }),
    normalMap: toTexture(filled(nW, nH, 'rgb(128,128,255)')),
    roughnessMap: lite ? null : toTexture(filled(W >> 1, H >> 1, rough(r)), { repeat: false, aniso: 8 }),
    roughness: r,
  };
}

// ---------------------------------------------------------------- Rahmen zeichnen (Fotopixel)
// Prüfung 25.10.: Rahmen im Fotostudio ≈ ⅓ dunkler als im Foto (Schaft L 75 gegen 104) – Grundton heller
const FRAME_BASE = { a: 'rgb(64,65,68)', r: GREY(0.74), h: GREY(0.5) };
function drawFrameSide(g, kind, left) {
  // Abrieb: Schaftoberkante, Hinterkante an der Kappe, Griffsteg-Vorderkante (Finger), Daumenloch- und Schlaufenrand,
  // Unterkante unter dem Daumenloch, Haken vorn – hell, glatt, unterbrochen
  const T = R.THUMB, G = R.GUARD;
  const wear = (line, w, al, seed) => edgeWear(g, kind, line, { width: w, alpha: al, seed, col: '108,110,114' });
  wear([[195, 462], [700, 462]], 3, 0.3, left ? 3 : 4);
  wear([[1293, 841], [1247, 887], [1203, 919], [1161, 941], [1095, 961], [1045, 966], [900, 966]], 4.5, 0.6, left ? 5 : 6);
  wear(T.concat([T[0]]), 3, 0.5, left ? 7 : 8);
  wear(G.slice(0, 12), 3, 0.45, left ? 9 : 10);
  wear([[1669, 772], [1663, 835], [1641, 885], [1601, 929], [1553, 957], [1499, 966], [1390, 966]], 4, 0.55, left ? 11 : 12);
  wear([[1695, 746], [1759, 746], [1783, 765], [1784, 816], [1829, 820], [1840, 700]], 3, 0.5, left ? 13 : 14);
  wear([[193, 896], [620, 896]], 3, 0.4, left ? 15 : 16);
  // Senkungen der Schrauben (Ring); die weiche Längskante am Schaft (CREASE_Y) ist im Foto nur ein Lichtwechsel der
  // gewölbten Fläche – keine Rille im Höhenkanal (Prüfung 25.10.), nur ein Hauch glatter
  for (const [x, y] of R.SCREWS) ring(g, kind, x, y, R.SCREW_R + 2.5);
  if (kind === 'r') {
    g.strokeStyle = 'rgba(150,150,150,0.25)'; g.lineWidth = 7; g.beginPath(); g.moveTo(195, R.CREASE_Y); g.lineTo(R.PANEL_X - 6, R.CREASE_Y); g.stroke();
  }
  // Griffspuren: speckig glatter (Rauheit niedriger) am Griffsteg und an der Schlaufe vorn
  if (kind === 'r') {
    for (const [cx, cy, rx, ry] of [[1210, 880, 80, 55], [1600, 880, 70, 70], [1050, 900, 120, 40]]) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry)); gr.addColorStop(0, 'rgba(70,70,70,0.45)'); gr.addColorStop(1, 'rgba(70,70,70,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, rx, ry, -0.6, 0, Math.PI * 2); g.fill();
    }
  }
  // feine Gebrauchskratzer nur in Farbe und Glanz (poly-tex scuffs: nicht im Höhenkanal)
  scuffs(g, kind, [200, 470, 1840, 960], { n: 110, seed: left ? 41 : 43, len: 22, alpha: 0.08, col: '120,122,128', spread: 1.2 });
  if (left) {
    // Eingeformte Beschriftung (eigene Zeichen, Lage und Größe wie die Werksschrift des Vorbilds); gespiegelt gezeichnet,
    // damit sie auf der linken Seite (Atlas-u läuft zur Mündung) richtig herum steht
    const [, , tx1, ty1] = R.TEXT_L;
    moldedText(g, kind, 'NULLPUNKT WAFFENWERK  QX-90', tx1, ty1 - 3, { mirror: true, size: 19, weight: 700, raised: true });
    moldedText(g, kind, 'KAL. 5,7 × 28', tx1 - 40, ty1 + 22, { mirror: true, size: 13, weight: 700, raised: true });
  }
  // (Die Stellungen S – 1 – A stehen wie am Vorbild auf der Wahlscheibe selbst, nicht auf dem Rahmen – guns-qx90.js)
}
// Ober-/Unterseite: Formnaht in der Mitte (Trennebene der Schalen)
function frameRest(c, kind) {
  const gt = c.getContext('2d', { willReadFrequently: true }), k = c.height / 1024, W = c.width;
  gt.setTransform(1, 0, 0, 1, 0, 0);
  if (kind === 'h') { gt.fillStyle = GREY(0.54); gt.fillRect(0, (896 + 63) * k, W, Math.max(1, 1.4 * k)); }
  if (kind === 'a') { gt.fillStyle = 'rgba(70,72,76,0.3)'; gt.fillRect(0, (896 + 63) * k, W, Math.max(1, 1.2 * k)); }
}

// ---------------------------------------------------------------- Gehäuse zeichnen (Guss)
// Prüfung 25.10.: Guss im Foto fast so hell wie der Rahmen (Brücke/Rahmen 0,77, Träger 0,91), im Modell halb so hell –
// satinierter, dunkelgrauer Lack statt Schwarz
const UPPER_BASE = { a: 'rgb(54,55,58)', r: GREY(0.56), h: GREY(0.5) };
function drawUpperSide(g, kind, left) {
  const wear = (line, w, al, seed) => edgeWear(g, kind, line, { width: w, alpha: al, seed, col: '150,152,156' });
  // Frontblock und Unterteil sind im Foto deutlich dunkler als Träger und Bügel (Tonwert 0,51 gegen 0,8–0,9 des Rahmens)
  if (kind === 'a') {
    const [fx, fy] = R.FRONT_BLOCK;
    g.fillStyle = 'rgba(14,14,16,0.38)'; g.fillRect(fx, fy, 1860 - fx, 650 - fy);
    g.fillStyle = 'rgba(14,14,16,0.22)'; g.fillRect(1330, R.LOWER_Y, fx - 1330, 650 - R.LOWER_Y);
  }
  // blanke Kanten: Brücke (Vorder-/Hinterkante), Träger oben, Frontblock-Kante, Unterteil-Unterkante, Rand der Tasche vorn
  wear([[1279, 303], [1241, 385], [1213, 445], [1207, 585]], 3, 0.55, left ? 51 : 52);
  wear(R.STRAP_FRONT, 3, 0.6, left ? 53 : 54);
  wear([[1281, 302], [1415, 296]], 2.5, 0.5, left ? 55 : 56);
  wear([[1741, 302], [1815, 303], [1835, 410], [1841, 545]], 3, 0.6, left ? 57 : 58);
  wear([[1330, 636], [1815, 636]], 2.5, 0.45, left ? 59 : 60);
  wear(R.BEAM_LOW, 2.5, 0.5, left ? 61 : 62);
  const [rx0, ry0, rx1, ry1] = R.RECESS;
  wear([[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1], [rx0, ry0]], 2, 0.5, left ? 63 : 64);
  // helle Kratzer wie im Foto (Guss, lackiert, abgegriffen) – nur Farbe und Glanz, keine Rillen
  scuffs(g, kind, [1200, 300, 1845, 636], { n: 170, seed: left ? 71 : 73, len: 14, alpha: 0.14, col: '170,172,176', spread: 3.2, rough: 70 });
  // Gusskorn: sehr feine, flache Pünktchen (vorher kräftig in Höhe und Farbe – wirkte wie Schleifpapier)
  if (kind !== 'r') {
    const rr = rng(left ? 81 : 83);
    for (let i = 0; i < 1400; i++) {
      const x = 1200 + rr() * 645, y = 300 + rr() * 336, s = 0.6 + rr() * 1.0;
      g.fillStyle = kind === 'h' ? (rr() > 0.5 ? GREY(0.515) : GREY(0.485)) : `rgba(${rr() > 0.5 ? '80,81,84' : '30,31,33'},${0.1 + rr() * 0.15})`;
      g.fillRect(x, y, s, s);
    }
  }
  if (left) {
    // eingeprägte Nummer links vorn (eigene Zeichen statt der Seriennummer des Vorbilds), gespiegelt gezeichnet
    const [, , sx1, sy1] = R.SERIAL_L;
    moldedText(g, kind, 'QX 902471', sx1, sy1, { mirror: true, size: 12, weight: 600, raised: false });
  }
}
// Ebenen-Beschreibung je Atlas: Grundton/Wolken, Fenster in Fotopixeln, Zeilen je Seite, Seitenmotive, Rest
const FRAME_L = { mottle: { base: FRAME_BASE, seed: 311, amp: 0.7 }, win: FA, rows: 448, total: 1024, side: drawFrameSide, rest: frameRest };
const UPPER_L = { mottle: { base: UPPER_BASE, seed: 331, amp: 1.1, period: 9 }, win: UA, rows: 224, total: 512, side: drawUpperSide, rest: null };

// ---------------------------------------------------------------- Aufträge (zeitgeteilt)
/** Eine Ebene (kind) in die Leinwand c zeichnen – in Teilschritten (Grundton, rechte Seite, linke Seite, Rest), damit
 *  keine Zeitscheibe am PC über ≈ 30 ms kommt (Prüfung 25.10.: lange Schritte = Ruckler in Lobby/Matchstart). */
function* layerInto(c, kind, L) {
  mottle(c, kind, L.mottle);
  yield;
  for (const left of [false, true]) {
    const g = bandCtx(c, L.win, L.rows, left ? L.rows : 0, L.total);
    g.save(); g.beginPath(); g.rect(L.win.x0, L.win.y0, L.win.x1 - L.win.x0, L.win.y1 - L.win.y0); g.clip();
    L.side(g, kind, left);
    g.restore();
    yield;
  }
  if (L.rest) L.rest(c, kind);
}
function* job(L, W, H, nW, nH, out, grain, strength, seed, sideRows) {
  // Höhe zuerst in voller Größe (Kanten scharf), dann auf die Normalengröße verkleinert
  const hc = canvas(W, H);
  yield* layerInto(hc, 'h', L);
  let src = hc;
  // Prüfung 25.10.: die Zwischenleinwand ohne willReadFrequently lag auf der Grafikkarte – das Zurücklesen
  // (heightField) blockierte den Hauptthread in EINER Zeitscheibe 0,4–2,2 s; im Hauptspeicher ≈ 4 ms
  if (nW !== W) { src = canvas(nW, nH); src.getContext('2d', { willReadFrequently: true }).drawImage(hc, 0, 0, nW, nH); }
  const h = heightField(src), rg = rng(seed), nSide = Math.round(nH * sideRows) * nW;
  yield;
  // Spritzguss-/Gusskorn nur in den Seitenbändern: das Ober-/Unterseitenband ist quer gestaucht (Korn würde zu
  // Querstreifen) – dort trägt der Shader die Feinstruktur (wearPatch bump)
  for (let i = 0; i < nSide; i++) h[i] += (rg() - 0.5) * grain;
  blur(h, nW, nH);
  yield;
  yield* normalsInto(out.normalMap.image, h, nW, nH, strength);
  out.normalMap.needsUpdate = true;
  yield;
  // Farbe und Rauheit direkt in die Platzhalter-Leinwände (gleiche Größe), danach hochladen
  yield* layerInto(out.map.image, 'a', L);
  out.map.needsUpdate = true;
  yield;
  if (out.roughnessMap) { yield* layerInto(out.roughnessMap.image, 'r', L); out.roughnessMap.needsUpdate = true; }
}
/** Rahmen-Atlas der QX-90 (PC 2048 × 1024, Handy 768 × 384 mit Normalen 384 × 192, ohne Rauheitskarte). */
export function qx90FrameMaps(lite = false) {
  const k = lite ? 'qx90frame:lite' : 'qx90frame';
  return cached(k, () => {
    // Handy (Prüfung 25.10., Bauanleitung 8.3 ≤ 4 MB je Waffe): Farbe 768 × 384, Normalen 384 × 192
    const W = lite ? 768 : 2048, H = W >> 1, nW = lite ? 384 : 1024, nH = nW >> 1;   // Normalen halb so groß (Korn sitzt im Shader)
    const out = deferredSet(W, H, nW, nH, FRAME_BASE.a, 0.74, lite);
    // Korn und Normalenstärke klein (Prüfung 25.10.: vorher 0,05/1,5 – grobe Beulen wie Hammerschlaglack; im Foto glatt-matt)
    const j = scheduleAtlas(job(FRAME_L, W, H, nW, nH, out, lite ? 0.012 : 0.02, lite ? 0.8 : 1.0, 351, 896 / 1024));
    return { key: k, ...out, dispose() { j.cancel(); for (const t of [out.map, out.normalMap, out.roughnessMap]) if (t) t.dispose(); } };
  });
}
/** Gehäuse-Atlas der QX-90 (PC 1024 × 512, Handy 512 × 256 mit Normalen 256 × 128, ohne Rauheitskarte). */
export function qx90UpperMaps(lite = false) {
  const k = lite ? 'qx90upper:lite' : 'qx90upper';
  return cached(k, () => {
    const W = lite ? 512 : 1024, H = W >> 1, nW = lite ? W >> 1 : W, nH = nW >> 1;      // Handy: Normalen halb
    const out = deferredSet(W, H, nW, nH, UPPER_BASE.a, 0.56, lite);
    // Gusskorn fein (vorher 0,09/1,8 – wirkte wie Schleifpapier; im Foto halbglänzend mit sehr feinem Korn)
    const j = scheduleAtlas(job(UPPER_L, W, H, nW, nH, out, lite ? 0.02 : 0.03, lite ? 0.9 : 1.1, 353, 448 / 512));
    return { key: k, ...out, dispose() { j.cancel(); for (const t of [out.map, out.normalMap, out.roughnessMap]) if (t) t.dispose(); } };
  });
}
