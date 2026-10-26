// ZW-12 Zwilling (26.10.): Holz-Atlas für Schaft und Vorderschaft nach den Referenzfotos (zwilling-ref.js), gemeinsamer
// Holz-Baukasten G1 (holz-tex.js): Walnuss mit Öl-/Lackschicht, Maserung entlang der Waffe, Fischhaut als Höhe (→ Normalen)
// auf dem Pistolengriff (beidseitig) und als Raute am Vorderschaft wie an der IZH-43E.
// Abbildung: Seitenflächen aus der Seitenprojektion (Fotopixel), Ober-/Unter- und Stirnflächen auf dieselbe Längsstelle mit
// der Breite (x) als Höhe im Atlas – die Faser läuft dort ebenfalls längs, ohne zweites Atlasfenster. Größen nach
// Bauanleitung 8.3: PC 2048 × 512 (≈ 3 Texel/mm längs), Handy 1024 × 256 ohne Rauheitskarte; gezeichnet zeitgeteilt im
// Hintergrund (Platzhalter sofort, scheduleAtlas), nie in der Bot-Stufe.
import { canvas, toTexture, cached, scheduleAtlas } from './textures.js';
import { paintWood, checkering } from './holz-tex.js';
import * as R from './zwilling-ref.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
// Atlasfenster in Fotopixeln: Vorderschaft (x 1659…2362) und Schaft (x 2598…3833) liegen nebeneinander
const FW = { x0: 1640, x1: 3850, y0: 372, y1: 1024 };
const atW = (px, py) => [(px - FW.x0) / (FW.x1 - FW.x0), 1 - clamp01((py - FW.y0) / (FW.y1 - FW.y0))];
// Walnuss, rotbraun geölt (IZH-43E: Mitteltöne ≈ 98/40/10, Coach Gun dunkler) – Spätholz deutlich, ruhige Flammung
const NUSS = { early: [92, 42, 17], late: [50, 21, 8], linie: [34, 14, 6], fleck: [104, 52, 22], dark: [26, 11, 5], lack: 0.38, ringe: 300 };
/** Atlas-UV für Holzteile (Schaft, Vorderschaft). */
export function woodUV(x, v, u, nx, ny, nz) {
  const px = R.XG - u * R.PPM, py = R.YB - v * R.PPM;
  if (Math.abs(nx) > 0.55) return atW(px, py);
  if (Math.abs(nz) > 0.7) return atW(px + x * R.PPM * 0.7, py);      // Stirnflächen: quer über die Breite
  return atW(px, py + x * R.PPM * 0.7);                               // Ober-/Unterseite: Breite → Atlashöhe
}
/** Tarnmuster-Wiederholung (Atlasfenster ≈ 0,68 × 0,2 m). */
export const WOOD_CAMO_REPEAT = [(FW.x1 - FW.x0) / R.PPM / 0.2, (FW.y1 - FW.y0) / R.PPM / 0.2];

// ---------------------------------------------------------------- zeitgeteilt zeichnen (wie kv47-tex.js)
function filled(W, H, css) { const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = css; g.fillRect(0, 0, W, H); return c; }
function* strips(area) {
  const n = Math.max(4, Math.floor(3000 / Math.max(1, area[2] - area[0])) & ~3);
  for (let y = area[1]; y < area[3]; y += n) yield [area[0], y, area[2], Math.min(area[3], y + n)];
}
function blur(h, w, H) {
  const t = new Float32Array(h.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (h[i - (x > 0)] + h[i] + h[i + (x < w - 1)]) / 3; }
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; h[i] = (t[i - (y > 0) * w] + t[i] + t[i + (y < H - 1) * w]) / 3; }
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

function* woodJob(lite, out) {
  const W = lite ? 1024 : 2048, H = lite ? 256 : 512;
  const sx = W / (FW.x1 - FW.x0), sy = H / (FW.y1 - FW.y0);
  const px = { W, H, a: new Uint8ClampedArray(W * H * 4), r: new Float32Array(W * H).fill(0.5), h: new Float32Array(W * H).fill(0.5) };
  for (let i = 0; i < W * H; i++) { px.a[i * 4] = 84; px.a[i * 4 + 1] = 38; px.a[i * 4 + 2] = 15; px.a[i * 4 + 3] = 255; }
  yield;
  const toModel = (ix, iy) => [R.U(FW.x0 + (ix + 0.5) / sx), R.V(FW.y0 + (iy + 0.5) / sy)];
  // ganze Fläche als Holz (auch Ober-/Unterseiten greifen über die Seitenkante hinaus); Vorderschaft eigener Stamm (Saat)
  const split = Math.round((2480 - FW.x0) * sx);
  for (const part of strips([0, 0, split, H])) { paintWood(px, part, toModel, { pal: NUSS, seed: 21, wear: 0.45 }); yield; }
  for (const part of strips([split, 0, W, H])) { paintWood(px, part, toModel, { pal: NUSS, seed: 23, wear: 0.6 }); yield; }
  // Fischhaut: Teilung ≈ 1,4 mm (18 Linien/Zoll), schmaler glatter Rand
  for (const poly of [R.GRIP_CHECK, R.FORE_CHECK]) {
    const p = poly.map(([x, y]) => [(x - FW.x0) * sx, (y - FW.y0) * sy]), ys = p.map((q) => q[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y += 24) {
      checkering(px, p, { pitch: 0.0014 * R.PPM * sx, ang: 0.52, aspect: sx / sy, rim: lite ? 1.5 : 3, rows: [y, y + 23] });
      yield;
    }
  }
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

/** Holz-Atlas des Zwillings (PC 2048 × 512, Handy 1024 × 256 ohne Rauheitskarte): sofort Platzhalter, gezeichnet im
 *  Hintergrund. dispose() bricht einen laufenden Auftrag ab. */
export function zwWoodMaps(lite = false) {
  const k = lite ? 'zwwood:lite' : 'zwwood';
  return cached(k, () => {
    const W = lite ? 1024 : 2048, H = lite ? 256 : 512;
    const out = {
      map: toTexture(filled(W, H, 'rgb(84,38,15)'), { srgb: true, repeat: false, aniso: 8 }),
      normalMap: toTexture(filled(W, H, 'rgb(128,128,255)')),
      roughnessMap: lite ? null : toTexture(filled(W, H, `rgb(255,${Math.round((NUSS.lack + 0.06) * 255)},255)`), { repeat: false, aniso: 8 }),
      roughness: NUSS.lack + 0.06,
    };
    const job = scheduleAtlas(woodJob(lite, out));
    return { key: k, ...out, dispose() { job.cancel(); for (const t of [out.map, out.normalMap, out.roughnessMap]) if (t) t.dispose(); } };
  });
}
