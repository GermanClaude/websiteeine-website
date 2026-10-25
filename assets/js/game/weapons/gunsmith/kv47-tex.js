// KV-47: eigene Oberflächen nach den Referenzfotos (kv47-ref.js) – zwei Atlanten in Fotopixeln (entzerrtes Foto 01):
//   Holz (kv47Wood): Schaft, Pistolengriff (Pressstoff mit Fischhaut), unterer und oberer Handschutz – Seitenflächen aus
//     der Seitenprojektion, Ober-/Unter-/Stirnflächen in eigene Bänder (Maserung läuft dort ebenfalls entlang der Waffe).
//   Gehäuse (kv47Rec): rechte Seite, linke Seite (Positionen aus Foto 02 über L2R), Oberseite – eingeprägte Ringe, ovale
//     Magazinführung, X-Prägungen um die Stiftköpfe (links), Wahlhebelmarken, Deckelsicke, eigene Beschriftung (statt
//     Werkszeichen, Jahr und Nummer des Vorbilds), Kantenabrieb und Kratzer im schwarzen Lack.
// Größen (25.10., zusammen so viel Speicher wie eine 2048 × 1024-Familie): Holz 2048 × 512 (≈ 3 Texel/mm in beide
// Richtungen), Gehäuse 1024 × 1024 (3,3 Texel/mm längs, 5 quer). Handy (lite): halbe Kantenlänge direkt gezeichnet
// (¼ Speicher, ¼ Zeichenzeit), gleiche UVs.
import { canvas, toTexture, cached, fbm, rng, scheduleAtlas } from './textures.js';
import { paintWood, paintBakelite, checkering, WOOD } from './holz-tex.js';
import { sdPolygon } from './sdf.js';
import * as R from './kv47-ref.js';

const photoX = (u) => R.XG + u * R.PPM;
const photoY = (v) => R.YB - (v - R.AXIS) * R.PPM;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---------------------------------------------------------------- Holz-Atlas: Abbildung
const FW = { x0: 100, x1: 2820, y0: 770, y1: 1560 };
const U_STOCK = R.U(1090), U_GRIP1 = R.U(1392), V_GRIP = R.V(1108);
const atW = (px, py) => [(px - FW.x0) / (FW.x1 - FW.x0), 1 - (py - FW.y0) / (FW.y1 - FW.y0)];
// Bänder für Flächen, die nicht zur Seite zeigen (Fotopixel im Atlasfenster, außerhalb der Holzteile)
const BAND_A = { dx: 980, y: 786, h: 140, hw: 0.026 };          // Schaft oben: x 1096…2070
const BAND_A2 = { dx: 980, y: 932, h: 168, hw: 0.026 };         // Schaft unten (25.10. eigenes Band): x 1096…2070
const BAND_B = { dx: -735, y: 1146, h: 200, hw: 0.026 };        // unterer Handschutz oben/unten/Stirn: x 1393…2065
const BAND_C = { x: 2350, y: 1360, h: 96, hw: 0.018 };          // Griff vorn/hinten/unten (lange Achse = Höhe): x 2350…2800
// Oberer Handschutz (25.10., Prüfung: Längsstreifen aus der Seiten-/Bandumschaltung): zylindrisch abgebildet – Winkel um
// die Rohrachse → Atlaszeile, Stirnflächen in ein eigenes, dunkleres Hirnholz-Feld
const BAND_D = { dx: 0, y: 1146, h: 210, amax: 1.95, ro: 0.017 }; // x 2346…2800
const END_D = { x: 2350, y: 780, w: 440, h: 112 };
const V_HGAX = R.V(R.GAS_TUBE.y);
// Schaft: Breite wie im Bauplan (akStock), Ober-/Unterkante je u aus dem Umriss – damit die Bänder oben/unten an der
// Seitenkante dieselbe Holzlage zeigen wie die Seitenprojektion (Prüfung 25.10.: Naht mit Querstreifen auf dem Kamm)
const UF = R.U(R.REC.x0), UB = R.U(R.BUTTPLATE[1]);
const hwStock = (u) => 0.0148 + 0.0067 * clamp01((UF - u) / (UF - UB));
const STOCK_M = R.M(R.STOCK), SU0 = Math.min(...STOCK_M.map((p) => p[0])) + 0.0005, SU1 = Math.max(...STOCK_M.map((p) => p[0])) - 0.0005;
function vspan(poly, u) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ua, va] = poly[i], [ub, vb] = poly[j];
    if ((ua > u) === (ub > u)) continue;
    const v = va + (u - ua) / (ub - ua) * (vb - va);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return [lo, hi];
}
/** Atlas-UV für Holzteile und Griff (Projektion je Flächenrichtung). */
export function woodUV(x, v, u, nx, ny, nz) {
  const px = photoX(u), py = photoY(v);
  if (Math.abs(nx) > 0.6) return atW(px, py);
  if (u < U_STOCK) { const B = ny >= 0 ? BAND_A : BAND_A2; return atW(px + B.dx, B.y + clamp01((x + B.hw) / (2 * B.hw)) * B.h); }
  if (u < U_GRIP1 && v < V_GRIP) return atW(BAND_C.x + Math.max(0, py - 1108), BAND_C.y + clamp01((x + BAND_C.hw) / (2 * BAND_C.hw)) * BAND_C.h);
  return atW(px + BAND_B.dx, BAND_B.y + clamp01((x + BAND_B.hw) / (2 * BAND_B.hw)) * BAND_B.h);
}
/** Atlas-UV des oberen Handschutzes (zylindrisch um die Gasrohrachse). */
export function hgUpUV(x, v, u, nx, ny, nz) {
  const a = Math.atan2(x, v - V_HGAX), t = clamp01(a / (2 * BAND_D.amax) + 0.5);
  if (Math.abs(nz) > 0.7) return atW(END_D.x + clamp01(Math.hypot(x, v - V_HGAX) / BAND_D.ro) * END_D.w, END_D.y + clamp01(a / (2 * Math.PI) + 0.5) * END_D.h);
  return atW(photoX(u) + BAND_D.dx, BAND_D.y + t * BAND_D.h);
}
export const WOOD_CAMO_REPEAT = [(FW.x1 - FW.x0) / R.PPM / 0.2, (FW.y1 - FW.y0) / R.PPM / 0.2];

// ---------------------------------------------------------------- Gehäuse-Atlas: Abbildung
const FR = { x0: 1050, x1: 2330, y0: 760, y1: 1130 };
const REC_HW = 0.0165;
/** Atlas-UV für Gehäuse und Deckel: Seiten aus dem Foto (rechts/links eigene Bänder), Ober-/Unterseite eigenes Band. */
export function recUV(x, v, u, nx, ny, nz) {
  const col = (photoX(u) - FR.x0) / (FR.x1 - FR.x0);
  if (Math.abs(nx) > 0.6) return [col, 1 - (clamp01((photoY(v) - FR.y0) / (FR.y1 - FR.y0)) * 448 + (nx > 0 ? 0 : 448)) / 1024];
  return [col, 1 - (896 + clamp01((x + REC_HW) / (2 * REC_HW)) * 127) / 1024];
}
export const REC_CAMO_REPEAT = [(FR.x1 - FR.x0) / R.PPM / 0.2, (FR.y1 - FR.y0) / R.PPM / 0.2 * 1024 / 448];

// ---------------------------------------------------------------- gemeinsame Helfer
const grey = (h) => { const k = Math.max(0, Math.min(255, Math.round(h * 255))); return `rgb(${k},${k},${k})`; };
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

// ---------------------------------------------------------------- Zeitgeteilt zeichnen (Prüfung 25.10.: Bauzeit)
// Die Atlanten kosteten am PC 0,6–0,75 s im Bau (Budget Standard ≤ 1,0 s gesamt). Jetzt: sofort Platzhalter in voller
// Größe (Grundfarbe, flache Normale), dann zeitgeteilt im Hintergrund zeichnen (textures.js scheduleAtlas) und am Ende
// in dieselben Leinwände schreiben – Speicher und UVs bleiben gleich, der Bau blockiert nicht mehr.
function filled(W, H, css) { const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = css; g.fillRect(0, 0, W, H); return c; }
/** Bereich [x0, y0, x1, y1] in Zeilenstreifen (Höhe Vielfaches von 4 = Grobraster von paintWood) mit ≈ 3000 Pixeln. */
function* strips(area) {
  const n = Math.max(4, Math.floor(3000 / Math.max(1, area[2] - area[0])) & ~3);
  for (let y = area[1]; y < area[3]; y += n) yield [area[0], y, area[2], Math.min(area[3], y + n)];
}
/** Normalen aus dem Höhenfeld zeilenweise in die Normalen-Leinwand (wie textures.js heightToNormal, kachelnd). */
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
const lacq = (r) => `rgb(255,${Math.round(r * 255)},255)`;
/** Kartensatz mit Platzhaltern; lite ohne Rauheitskarte (Konstante, Bauanleitung 8.3). */
function deferredSet(W, H, base, rough, lite, rW = W, rH = H) {
  const out = {
    map: toTexture(filled(W, H, base), { srgb: true, repeat: false, aniso: 8 }),
    normalMap: toTexture(filled(W, H, 'rgb(128,128,255)')),
    roughnessMap: lite ? null : toTexture(filled(rW, rH, lacq(rough)), { repeat: false, aniso: 8 }),
    roughness: rough,
  };
  return out;
}

// ---------------------------------------------------------------- Holz-Atlas zeichnen
function* woodJob(lite, out) {
  const W = lite ? 1024 : 2048, H = lite ? 256 : 512;
  const sx = W / (FW.x1 - FW.x0), sy = H / (FW.y1 - FW.y0);
  const px = { W, H, a: new Uint8ClampedArray(W * H * 4), r: new Float32Array(W * H).fill(0.5), h: new Float32Array(W * H).fill(0.5) };
  for (let i = 0; i < W * H; i++) { px.a[i * 4] = 76; px.a[i * 4 + 1] = 28; px.a[i * 4 + 2] = 12; px.a[i * 4 + 3] = 255; }   // Grund = mittlerer Holzton (Mipmap-Ränder)
  yield;
  const A = (x0, y0, x1, y1) => [Math.floor((x0 - FW.x0) * sx), Math.floor((y0 - FW.y0) * sy), Math.ceil((x1 - FW.x0) * sx), Math.ceil((y1 - FW.y0) * sy)];
  const P = (ix) => FW.x0 + (ix + 0.5) / sx, Q = (iy) => FW.y0 + (iy + 0.5) / sy;
  const side = (ix, iy) => [R.U(P(ix)), R.V(Q(iy))];
  const hgLow = R.M(R.HG_LOW);
  const jobs = [];
  // Seitenflächen: Schaft (Birke) und unterer Handschutz mit Randabdunklung (Abstand zum Fotoumriss), Griff (Pressstoff)
  jobs.push([paintWood, A(116, 936, 1090, 1412), side, { pal: WOOD.akBirke, seed: 3, wear: 0.8, edge: (u, v) => -sdPolygon(u, v, STOCK_M) }]);
  jobs.push([paintWood, A(2128, 900, 2800, 1132), side, { pal: WOOD.akHand, seed: 5, wear: 0.5, edge: (u, v) => -sdPolygon(u, v, hgLow) }]);
  jobs.push([paintBakelite, A(1088, 1104, 1392, 1552), side, { seed: 7 }]);
  // Schaft oben/unten: Holzlage v_eff = Kante + Bogenlänge nach innen (stetig an der Seitenkante, Rundung 5,8 mm)
  const stockBand = (B, top) => {
    const sp = new Map();
    const at = (u) => { const k = Math.round(Math.max(SU0, Math.min(SU1, u)) * 4000); let r = sp.get(k); if (!r) { r = vspan(STOCK_M, k / 4000); sp.set(k, r); } return r; };
    const xOf = (iy) => ((Q(iy) - B.y) / B.h - 0.5) * 2 * B.hw;
    return {
      map: (ix, iy) => { const u = R.U(P(ix) - B.dx), [lo, hi] = at(u), inward = hwStock(u) - 0.00232 - Math.abs(xOf(iy)); return [u, top ? hi - 0.00116 + inward : lo + 0.00116 - inward]; },
      edge: (u, v, ix, iy) => hwStock(u) - 0.00116 - Math.abs(xOf(iy)),
    };
  };
  for (const [B, top] of [[BAND_A, true], [BAND_A2, false]]) {
    const sb = stockBand(B, top);
    jobs.push([paintWood, A(B.dx + 116, B.y - 2, B.dx + 1090, B.y + B.h + 2), sb.map, { pal: WOOD.akBirke, seed: 3, wear: 0.8, edge: sb.edge }]);
  }
  const band = (B, y0, y1) => (ix, iy) => [R.U(P(ix) - B.dx), ((Q(iy) - y0) / (y1 - y0) - 0.5) * 2 * B.hw];
  jobs.push([paintWood, A(1393, 1142, 2070, 1350), band(BAND_B, BAND_B.y, BAND_B.y + BAND_B.h), { pal: WOOD.akHand, seed: 5, wear: 0.5 }]);
  // Oberer Handschutz: Band in Bogenlänge um die Achse, Stirnflächen als dunkleres Hirnholz
  jobs.push([paintWood, A(2342, BAND_D.y - 4, 2804, BAND_D.y + BAND_D.h + 4), (ix, iy) => [R.U(P(ix) - BAND_D.dx), ((Q(iy) - BAND_D.y) / BAND_D.h - 0.5) * 2 * BAND_D.amax * BAND_D.ro], { pal: WOOD.akHand, seed: 6, wear: 0.4 }]);
  jobs.push([paintWood, A(END_D.x - 4, END_D.y - 4, END_D.x + END_D.w + 4, END_D.y + END_D.h + 4), (ix, iy) => [(Q(iy) - END_D.y) / R.PPM * 3, (P(ix) - END_D.x) / R.PPM], { pal: WOOD.akHirn, seed: 9, wear: 0.2 }]);
  jobs.push([paintBakelite, A(2346, 1356, 2804, 1460), (ix, iy) => [(P(ix) - BAND_C.x) / R.PPM, (Q(iy) - BAND_C.y) / R.PPM], { seed: 8 }]);
  for (const [fn, area, map, o] of jobs) for (const part of strips(area)) { fn(px, part, map, o); yield; }
  // Fischhaut auf der Griffschale (Feld wie im Foto, Teilung ≈ 1,6 mm), schmaler glatter Rand
  const panel = R.GRIP_PANEL.map(([x, y]) => [(x - FW.x0) * sx, (y - FW.y0) * sy]), pys = panel.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...pys)); y <= Math.max(...pys); y += 24) { checkering(px, panel, { pitch: 0.0016 * R.PPM * sx * 0.72, ang: 0.62, aspect: sx / sy, rim: lite ? 1.5 : 3, rows: [y, y + 23] }); yield; }
  // Ergebnis in die Platzhalter-Leinwände
  const ga = out.map.image.getContext('2d'), ia = ga.createImageData(W, H); ia.data.set(px.a); ga.putImageData(ia, 0, 0);
  out.map.needsUpdate = true;
  yield;
  if (out.roughnessMap) {
    const gr = out.roughnessMap.image.getContext('2d'), ir = gr.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const g = Math.max(0, Math.min(255, px.r[i] * 255)); ir.data[i * 4] = 255; ir.data[i * 4 + 1] = g; ir.data[i * 4 + 2] = 255; ir.data[i * 4 + 3] = 255; }
    gr.putImageData(ir, 0, 0);
    out.roughnessMap.needsUpdate = true;
    yield;
  }
  blur(px.h, W, H);
  yield;
  yield* normalsInto(out.normalMap.image, px.h, W, H, lite ? 1.0 : 1.6);
  out.normalMap.needsUpdate = true;
}
/** Holz-Atlas der KV-47 (PC 2048 × 512, Handy 1024 × 256 ohne Rauheitskarte) – sofort mit Platzhaltern, gezeichnet im
 *  Hintergrund (scheduleAtlas). dispose() bricht einen laufenden Auftrag ab. */
export function kv47WoodMaps(lite = false) {
  const k = lite ? 'kv47wood:lite' : 'kv47wood';
  return cached(k, () => {
    const W = lite ? 1024 : 2048, H = lite ? 256 : 512, out = deferredSet(W, H, 'rgb(76,28,12)', WOOD.akBirke.lack + 0.06, lite);
    const job = scheduleAtlas(woodJob(lite, out));
    return { key: k, ...out, dispose() { job.cancel(); for (const t of [out.map, out.normalMap, out.roughnessMap]) if (t) t.dispose(); } };
  });
}

// ---------------------------------------------------------------- Gehäuse-Atlas zeichnen
// Zeichenfläche je Band in Fotopixeln (rechts: Zeilen 0…447, links: 448…895, oben: 896…1023 bei voller Größe)
function bandCtx(c, row0, rows) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const k = c.height / 1024, s = c.width / (FR.x1 - FR.x0), t = rows * k / (FR.y1 - FR.y0);
  g.setTransform(s, 0, 0, t, -FR.x0 * s, -FR.y0 * t + row0 * k);
  return g;
}
const L2 = (x, y) => R.L2R(x, y);
function drawRecSide(g, kind, left) {
  const groove = { h: grey(0.3), a: 'rgba(14,14,16,0.55)', r: grey(0.78) }[kind];
  const raise = { h: grey(0.68), a: 'rgba(90,92,96,0.35)', r: grey(0.42) }[kind];
  const engr = { h: grey(0.3), a: 'rgba(20,20,22,0.8)', r: grey(0.74) }[kind];       // Schlagzahlen: dunkel, matt, vertieft
  const ring = (x, y, r) => { g.lineWidth = 2.4; g.strokeStyle = groove; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1; g.strokeStyle = raise; g.beginPath(); g.arc(x, y, r - 2.2, 0, Math.PI * 2); g.stroke(); };
  const oval = ([x0, y0, x1, y1]) => {
    g.lineWidth = 5; g.strokeStyle = groove; g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, (y1 - y0) / 2); g.stroke();
    g.fillStyle = raise; g.beginPath(); g.roundRect(x0 + 8, y0 + 8, x1 - x0 - 16, y1 - y0 - 16, (y1 - y0 - 16) / 2); g.fill();
  };
  const dimple = (x, y, r) => { const gr = g.createRadialGradient(x, y, r * 0.6, x, y, r + 5); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.6, kind === 'h' ? 'rgba(60,60,60,0.35)' : 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.fill(); };
  if (!left) {
    for (const [x, y, r] of R.RINGS_R) ring(x, y, r);
    for (const [x, y, r] of R.RIVETS_R) dimple(x, y, r);
    oval(R.MAG_GUIDE);
    // Wahlhebelmarken: Strich mit Querstrich + Buchstabe (D = Dauer, E = Einzel; eigene Zeichen statt C/P des Vorbilds)
    g.fillStyle = engr; g.strokeStyle = engr; g.lineWidth = 3;
    for (const [k, [x, y]] of Object.entries(R.SEL_MARKS)) {
      g.beginPath(); g.moveTo(x - 22, y); g.lineTo(x + 18, y); g.stroke(); g.beginPath(); g.moveTo(x - 6, y - 7); g.lineTo(x - 6, y + 7); g.stroke();
      g.font = '700 22px Arial, Helvetica, sans-serif'; g.textBaseline = 'middle'; g.fillText(k === 'dauer' ? 'D' : 'E', x + 34, y + 1);
    }
    // Längssicke am Deckel
    g.lineCap = 'round'; g.lineWidth = 6; g.strokeStyle = groove; g.beginPath(); g.moveTo(...R.DC_RIB[0]); g.lineTo(...R.DC_RIB[1]); g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = raise; g.beginPath(); g.moveTo(R.DC_RIB[0][0], R.DC_RIB[0][1] - 1.5); g.lineTo(R.DC_RIB[1][0], R.DC_RIB[1][1] - 1.5); g.stroke();
  } else {
    for (const [x, y, r] of R.RINGS_L) { const [a, b] = L2(x, y); ring(a, b, r * 0.963); }
    for (const [x, y, r] of R.RIVETS_L) { const [a, b] = L2(x, y); dimple(a, b, r * 0.963); }
    const [ga0, gb0] = L2(R.MAG_GUIDE_L[2], R.MAG_GUIDE_L[1]), [ga1, gb1] = L2(R.MAG_GUIDE_L[0], R.MAG_GUIDE_L[3]);
    oval([ga0, gb0, ga1, gb1]);
    // Prägungen um die Stiftköpfe: X mit vier Lappen unter 45° bzw. V mit nur den beiden oberen (Foto 02: zwei von drei)
    for (const [x, y, r, kind = 'X'] of R.XPINS_L) {
      const [a, b] = L2(x, y), L = r * 2.2;
      g.save(); g.translate(a, b);
      for (let k = 0; k < 4; k++) {
        g.rotate(Math.PI / 2);
        if (kind === 'V' && (k === 0 || k === 3)) continue;           // k = 0/3: untere Lappen (Leinwand-y nach unten)
        g.save(); g.rotate(Math.PI / 4); g.lineWidth = 4.5; g.strokeStyle = groove; g.beginPath(); g.roundRect(r * 0.7, -r * 0.45, L - r * 0.5, r * 0.9, r * 0.45); g.stroke(); g.restore();
      }
      g.restore();
    }
    // Längssicke am Deckel links
    const [p0, q0] = L2(...R.DC_RIB_L[0]), [p1, q1] = L2(...R.DC_RIB_L[1]);
    g.lineCap = 'round'; g.lineWidth = 6; g.strokeStyle = groove; g.beginPath(); g.moveTo(p0, q0); g.lineTo(p1, q1); g.stroke();
    // Beschriftung am vorderen Verschlussstück (eigene Zeichen): Werkoval „NP“, Baujahr, Nummer – gespiegelt gezeichnet,
    // damit sie von links gelesen richtig steht (Atlas-u läuft zur Mündung, die linke Seite zeigt sie nach links)
    const [mx0, my0] = L2(R.MARK_L[0], R.MARK_L[1]), [, my1] = L2(R.MARK_L[0], R.MARK_L[3]);
    g.save(); g.translate(mx0, (my0 + my1) / 2); g.scale(-1, 1);
    g.strokeStyle = engr; g.fillStyle = engr; g.lineWidth = 2.6;
    g.beginPath(); g.ellipse(26, 0, 25, 13, 0, 0, Math.PI * 2); g.stroke();
    g.font = '700 19px Arial, Helvetica, sans-serif'; g.textBaseline = 'middle'; g.fillText('NP', 13, 1);
    g.font = '600 21px Arial, Helvetica, sans-serif'; g.fillText('1974', 64, 1); g.fillText('KV 470125', 124, 1);
    g.restore();
  }
  // Kantenabrieb: Unterkante des Gehäuses, Deckelkante, Schachtvorderkante (helle, unterbrochene Streifen)
  if (kind !== 'h') {
    const rr = rng(left ? 131 : 137);
    const wear = (al) => (kind === 'a' ? `rgba(150,152,156,${al})` : `rgba(40,40,40,${al})`);
    const streak = (xa, xb, y, h, al) => { for (let x = xa; x < xb;) { const l = 10 + rr() * 80; if (rr() > 0.3) { g.fillStyle = wear(al * (0.4 + 0.6 * rr())); g.fillRect(x, y, l, h); } x += l + rr() * 40; } };
    streak(R.REC.x0, R.REC.x1, R.REC.bottom - 3, 3, 0.5);
    for (let k = 0; k < R.DC_EDGE.length - 1; k++) { const [a, b] = R.DC_EDGE[k], [c] = R.DC_EDGE[k + 1]; if (Math.abs(R.DC_EDGE[k + 1][1] - b) < 3) streak(a, c, b - 3, 2.5, 0.45); }
    streak(R.DC_REAR[R.DC_REAR.length - 1][0], R.DC_X1, R.DC_TOP + 1, 2.5, 0.55);
    // Kratzer und Griffspuren
    for (let k = 0; k < 90; k++) {
      const x = R.REC.x0 + rr() * (R.REC.x1 - R.REC.x0), y = 850 + rr() * 260, len = 5 + rr() * 40, a = (rr() - 0.5) * 0.6;
      g.strokeStyle = kind === 'a' ? `rgba(160,162,168,${0.05 + rr() * 0.12})` : `rgba(70,70,70,${0.3 + rr() * 0.3})`;
      g.lineWidth = 0.6 + rr() * 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
  }
}
function recLayer(kind, W, H) {
  const c = canvas(W, H), g0 = c.getContext('2d', { willReadFrequently: true });
  g0.fillStyle = { h: grey(0.5), r: grey(0.55), a: 'rgb(38,38,41)' }[kind]; g0.fillRect(0, 0, W, H);   // 25.10.: dunkler (Foto: schwarzer Lack)
  if (kind !== 'h') {
    // Lack wolkig (leicht ungleichmäßig gespritzt): kleines Rauschbild weich hochskaliert und weich eingeblendet
    // (statt Pixelschleife über den ganzen Atlas – spart ≈ 0,1 s je Ebene)
    const nw = 256, nh = 128, n = fbm(nw, nh, { seed: kind === 'a' ? 211 : 213, period: 6, octaves: 4 });
    const nc = canvas(nw, nh), ng = nc.getContext('2d'), id = ng.createImageData(nw, nh), amp = kind === 'a' ? 36 : 90;
    for (let i = 0; i < nw * nh; i++) { const k = 128 + (n[i] - 0.5) * amp; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = k; id.data[i * 4 + 3] = 255; }
    ng.putImageData(id, 0, 0);
    g0.globalCompositeOperation = 'soft-light'; g0.imageSmoothingEnabled = true; g0.drawImage(nc, 0, 0, W, H); g0.globalCompositeOperation = 'source-over';
  }
  for (const left of [false, true]) {
    const g = bandCtx(c, left ? 448 : 0, 448);
    g.save(); g.beginPath(); g.rect(FR.x0, FR.y0, FR.x1 - FR.x0, FR.y1 - FR.y0); g.clip();
    drawRecSide(g, kind, left);
    g.restore();
  }
  // Oberseite (Deckel oben, Gehäuse unten): Abrieb an den Querrippen und am Deckelende
  if (kind !== 'h') {
    const g = bandCtx(c, 896, 128), sy = (FR.y1 - FR.y0) / 128;
    g.fillStyle = kind === 'a' ? 'rgba(150,152,156,0.3)' : 'rgba(40,40,40,0.4)';
    for (const x of R.DC_TOP_RIBS) g.fillRect(x - R.DC_RIB_W / 2, FR.y0 + 30 * sy, R.DC_RIB_W, 68 * sy);
  }
  return c;
}
function* recJob(lite, out) {
  const W = lite ? 512 : 1024, H = W, rW = lite ? 0 : W >> 1;
  const h = heightField(recLayer('h', W, H));
  yield;
  const rg = rng(219);
  for (let i = 0; i < h.length; i++) h[i] += (rg() - 0.5) * 0.016;    // Lackhaut, nach dem Weichzeichnen kaum spürbar (Foto: glatt, seidenmatt)
  blur(h, W, H);
  yield;
  yield* normalsInto(out.normalMap.image, h, W, H, lite ? 1.2 : 1.8);
  out.normalMap.needsUpdate = true;
  out.map.image.getContext('2d').drawImage(recLayer('a', W, H), 0, 0);
  out.map.needsUpdate = true;
  yield;
  if (out.roughnessMap) { out.roughnessMap.image.getContext('2d').drawImage(recLayer('r', rW, rW), 0, 0); out.roughnessMap.needsUpdate = true; }
}
/** Gehäuse-Atlas der KV-47 (PC 1024 × 1024, Rauheit 512 × 512; Handy 512 × 512 ohne Rauheitskarte) – im Hintergrund. */
export function kv47RecMaps(lite = false) {
  const k = lite ? 'kv47rec:lite' : 'kv47rec';
  return cached(k, () => {
    const W = lite ? 512 : 1024, out = deferredSet(W, W, 'rgb(38,38,41)', 0.55, lite, W >> 1, W >> 1);
    const job = scheduleAtlas(recJob(lite, out));
    return { key: k, ...out, dispose() { job.cancel(); for (const t of [out.map, out.normalMap, out.roughnessMap]) if (t) t.dispose(); } };
  });
}
