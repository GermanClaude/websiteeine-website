// KV-47: eigene Oberflächen nach den Referenzfotos (kv47-ref.js) – zwei Atlanten in Fotopixeln (entzerrtes Foto 01):
//   Holz (kv47Wood): Schaft, Pistolengriff (Pressstoff mit Fischhaut), unterer und oberer Handschutz – Seitenflächen aus
//     der Seitenprojektion, Ober-/Unter-/Stirnflächen in eigene Bänder (Maserung läuft dort ebenfalls entlang der Waffe).
//   Gehäuse (kv47Rec): rechte Seite, linke Seite (Positionen aus Foto 02 über L2R), Oberseite – eingeprägte Ringe, ovale
//     Magazinführung, X-Prägungen um die Stiftköpfe (links), Wahlhebelmarken, Deckelsicke, eigene Beschriftung (statt
//     Werkszeichen, Jahr und Nummer des Vorbilds), Kantenabrieb und Kratzer im schwarzen Lack.
// Größen (25.10., zusammen so viel Speicher wie eine 2048 × 1024-Familie): Holz 2048 × 512 (≈ 3 Texel/mm in beide
// Richtungen), Gehäuse 1024 × 1024 (3,3 Texel/mm längs, 5 quer). Handy (lite): halbe Kantenlänge direkt gezeichnet
// (¼ Speicher, ¼ Zeichenzeit), gleiche UVs.
import { canvas, toTexture, cached, heightToNormal, fbm, rng } from './textures.js';
import { paintWood, paintBakelite, checkering, WOOD } from './holz-tex.js';
import * as R from './kv47-ref.js';

const photoX = (u) => R.XG + u * R.PPM;
const photoY = (v) => R.YB - (v - R.AXIS) * R.PPM;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// ---------------------------------------------------------------- Holz-Atlas: Abbildung
const FW = { x0: 100, x1: 2820, y0: 770, y1: 1560 };
const U_STOCK = R.U(1090), U_GRIP1 = R.U(1392), V_GRIP = R.V(1108);
const atW = (px, py) => [(px - FW.x0) / (FW.x1 - FW.x0), 1 - (py - FW.y0) / (FW.y1 - FW.y0)];
// Bänder für Flächen, die nicht zur Seite zeigen (Fotopixel im Atlasfenster, außerhalb der Holzteile)
const BAND_A = { dx: 980, y: 786, h: 140, hw: 0.026 };          // Schaft oben/unten: x 1096…2070
const BAND_B = { dx: -735, y: 1146, h: 200, hw: 0.026 };        // unterer Handschutz oben/unten/Stirn: x 1393…2065
const BAND_C = { x: 2350, y: 1360, h: 96, hw: 0.018 };          // Griff vorn/hinten/unten (lange Achse = Höhe): x 2350…2800
const BAND_D = { dx: 0, y: 1146, h: 170, hw: 0.0135 };          // oberer Handschutz oben (gewölbt, im Anschlag nah am Auge): x 2346…2800
const U_HGUP = R.U(2340), V_HGUP = R.V(912);
/** Atlas-UV für Holzteile und Griff (Projektion je Flächenrichtung). */
export function woodUV(x, v, u, nx, ny, nz) {
  const px = photoX(u), py = photoY(v);
  if (Math.abs(nx) > 0.6) return atW(px, py);
  if (u < U_STOCK) return atW(px + BAND_A.dx, BAND_A.y + clamp01((x + BAND_A.hw) / (2 * BAND_A.hw)) * BAND_A.h);
  if (u < U_GRIP1 && v < V_GRIP) return atW(BAND_C.x + Math.max(0, py - 1108), BAND_C.y + clamp01((x + BAND_C.hw) / (2 * BAND_C.hw)) * BAND_C.h);
  if (u > U_HGUP && v > V_HGUP) return atW(px + BAND_D.dx, BAND_D.y + clamp01((x + BAND_D.hw) / (2 * BAND_D.hw)) * BAND_D.h);
  return atW(px + BAND_B.dx, BAND_B.y + clamp01((x + BAND_B.hw) / (2 * BAND_B.hw)) * BAND_B.h);
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

// ---------------------------------------------------------------- Holz-Atlas zeichnen
function woodMaps(lite) {
  const W = lite ? 1024 : 2048, H = lite ? 256 : 512;
  const sx = W / (FW.x1 - FW.x0), sy = H / (FW.y1 - FW.y0);
  const px = { W, H, a: new Uint8ClampedArray(W * H * 4), r: new Float32Array(W * H).fill(0.5), h: new Float32Array(W * H).fill(0.5) };
  for (let i = 0; i < W * H; i++) { px.a[i * 4] = 80; px.a[i * 4 + 1] = 33; px.a[i * 4 + 2] = 17; px.a[i * 4 + 3] = 255; }   // Grund = mittlerer Holzton (Mipmap-Ränder)
  const A = (x0, y0, x1, y1) => [Math.floor((x0 - FW.x0) * sx), Math.floor((y0 - FW.y0) * sy), Math.ceil((x1 - FW.x0) * sx), Math.ceil((y1 - FW.y0) * sy)];
  const side = (ix, iy) => [R.U(FW.x0 + (ix + 0.5) / sx), R.V(FW.y0 + (iy + 0.5) / sy)];
  // Seitenflächen: Schaft (Birke dunkler), Handschutz (heller), Griff (Pressstoff)
  paintWood(px, A(116, 936, 1090, 1412), side, { pal: WOOD.akBirke, seed: 3, wear: 0.8 });
  paintWood(px, A(2128, 900, 2800, 1132), side, { pal: WOOD.akHand, seed: 5, wear: 0.5 });
  paintWood(px, A(2346, 808, 2800, 912), side, { pal: WOOD.akHand, seed: 6, wear: 0.4 });
  paintBakelite(px, A(1088, 1104, 1392, 1552), side, { seed: 7 });
  // Bänder: Schaft oben/unten, Handschutz oben/unten/Stirn, Griff vorn/hinten
  const band = (B, y0, y1) => (ix, iy) => { const p = FW.x0 + (ix + 0.5) / sx, q = FW.y0 + (iy + 0.5) / sy; return [R.U(p - B.dx), ((q - y0) / (y1 - y0) - 0.5) * 2 * B.hw]; };
  paintWood(px, A(1092, 782, 2074, 930), band(BAND_A, BAND_A.y, BAND_A.y + BAND_A.h), { pal: WOOD.akBirke, seed: 3, wear: 0.8 });
  paintWood(px, A(1393, 1142, 2070, 1350), band(BAND_B, BAND_B.y, BAND_B.y + BAND_B.h), { pal: WOOD.akHand, seed: 5, wear: 0.5 });
  paintWood(px, A(2342, 1142, 2804, 1320), band(BAND_D, BAND_D.y, BAND_D.y + BAND_D.h), { pal: WOOD.akHand, seed: 6, wear: 0.4 });
  paintBakelite(px, A(2346, 1356, 2804, 1460), (ix, iy) => { const p = FW.x0 + (ix + 0.5) / sx, q = FW.y0 + (iy + 0.5) / sy; return [(p - BAND_C.x) / R.PPM, (q - BAND_C.y) / R.PPM]; }, { seed: 8 });
  // Fischhaut auf der Griffschale (Feld wie im Foto, Teilung ≈ 1,6 mm), schmaler glatter Rand
  const panel = R.GRIP_PANEL.map(([x, y]) => [(x - FW.x0) * sx, (y - FW.y0) * sy]);
  checkering(px, panel, { pitch: 0.0016 * R.PPM * sx * 0.72, ang: 0.62, aspect: sx / sy, rim: lite ? 1.5 : 3 });
  // Schaft: Riemenbügel-Platte unten, Kappe hinten liegen als Teile darauf – nur Abrieb an den Kanten (Shader)
  // Leinwände → Texturen
  const ca = canvas(W, H), ga = ca.getContext('2d'), ia = ga.createImageData(W, H); ia.data.set(px.a); ga.putImageData(ia, 0, 0);
  const cr = canvas(W, H), gr = cr.getContext('2d'), ir = gr.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const g = Math.max(0, Math.min(255, px.r[i] * 255)); ir.data[i * 4] = 255; ir.data[i * 4 + 1] = g; ir.data[i * 4 + 2] = 255; ir.data[i * 4 + 3] = 255; }
  gr.putImageData(ir, 0, 0);
  blur(px.h, W, H);
  return {
    map: toTexture(ca, { srgb: true, repeat: false, aniso: 8 }),
    normalMap: heightToNormal(px.h, W, H, lite ? 1.0 : 1.6),
    roughnessMap: toTexture(cr, { repeat: false, aniso: 8 }),
  };
}
/** Holz-Atlas der KV-47 (PC 2048 × 512, Handy 1024 × 256). */
export function kv47WoodMaps(lite = false) {
  const k = lite ? 'kv47wood:lite' : 'kv47wood';
  return cached(k, () => ({ key: k, ...woodMaps(lite) }));
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
    // X-förmige Prägungen um die Stiftköpfe: vier Lappen unter 45°
    for (const [x, y, r] of R.XPINS_L) {
      const [a, b] = L2(x, y), L = r * 2.2;
      g.save(); g.translate(a, b);
      for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.save(); g.rotate(Math.PI / 4); g.lineWidth = 4.5; g.strokeStyle = groove; g.beginPath(); g.roundRect(r * 0.7, -r * 0.45, L - r * 0.5, r * 0.9, r * 0.45); g.stroke(); g.restore(); }
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
  g0.fillStyle = { h: grey(0.5), r: grey(0.55), a: 'rgb(58,58,61)' }[kind]; g0.fillRect(0, 0, W, H);
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
function recMaps(lite) {
  const W = lite ? 512 : 1024, H = lite ? 512 : 1024;
  const h = heightField(recLayer('h', W, H)), rg = rng(219);
  for (let i = 0; i < h.length; i++) h[i] += (rg() - 0.5) * 0.016;    // Lackhaut, nach dem Weichzeichnen kaum spürbar (Foto: glatt, seidenmatt)
  blur(h, W, H);
  return {
    map: toTexture(recLayer('a', W, H), { srgb: true, repeat: false, aniso: 8 }),
    normalMap: heightToNormal(h, W, H, lite ? 1.2 : 1.8),
    roughnessMap: toTexture(recLayer('r', W, H), { repeat: false, aniso: 8 }),
  };
}
/** Gehäuse-Atlas der KV-47 (PC 1024 × 1024, Handy 512 × 512). */
export function kv47RecMaps(lite = false) {
  const k = lite ? 'kv47rec:lite' : 'kv47rec';
  return cached(k, () => ({ key: k, ...recMaps(lite) }));
}
