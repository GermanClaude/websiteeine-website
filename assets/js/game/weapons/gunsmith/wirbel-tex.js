// PS-41 Wirbel (26.10.): eigene Oberflächen nach dem Referenzfoto (wirbel-ref.js).
//   Holz (wirbelWood): Schaft aus Birke, rotbraun lackiert – Seitenprojektion in Fotopixeln (Fenster um den Schaft), die Maserung
//     läuft auf allen Flächen entlang der Waffe; Randabdunklung und Druckstellen wie im Foto. PC 2048 × 512, Handy 1024 × 256
//     (ohne Rauheitskarte), im Hintergrund gezeichnet (scheduleAtlas) – Bau blockiert nicht.
//   Laufmantel (wirbelMantel): Durchlässigkeitskarte in Abwicklung (u längs, Winkel um die Achse quer) – Kühlschlitze, Seitenfenster
//     der Bremse, Auswurf oben, Spannhebelschlitz rechts und der offene Deckelboden über dem Schaft werden ausgeschnitten (alphaTest).
//     So bleibt der Mantel ein Rohr mit ≈ 250 Dreiecken statt eines Distanzfeld-Netzes mit 60–150 k.
import { canvas, toTexture, cached, scheduleAtlas } from './textures.js';
import { paintWood } from './holz-tex.js';
import { sdPolygon } from './sdf.js';
import * as R from './wirbel-ref.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const photoX = (u) => R.XG - u * R.PPM;
const photoY = (v) => R.YG - v * R.PPM;

// ---------------------------------------------------------------- Holz: Abbildung
const [FX0, FX1, FY0, FY1] = R.STOCK_BOX;
/** Atlas-UV des Schafts: Seitenprojektion (Maserung längs, Ober-/Unterseite übernehmen die Kantenzeile). */
export function woodUV(x, v, u) { return [clamp01((photoX(u) - FX0) / (FX1 - FX0)), 1 - clamp01((photoY(v) - FY0) / (FY1 - FY0))]; }
export const WOOD_CAMO_REPEAT = [(FX1 - FX0) / R.PPM / 0.2, (FY1 - FY0) / R.PPM / 0.2];
// Birke der Kriegsfertigung: dunkel rotbraun lackiert, im Foto (ohne Glanzlicht) Median ≈ 92/40/20, Kanten fast schwarz
const PAL = { early: [96, 40, 17], late: [46, 18, 7], linie: [32, 12, 5], fleck: [118, 58, 26], dark: [24, 9, 4], lack: 0.5, ringe: 380 };

function filled(W, H, css) { const c = canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = css; g.fillRect(0, 0, W, H); return c; }
function* strips(area) {
  const n = Math.max(4, Math.floor(3000 / Math.max(1, area[2] - area[0])) & ~3);
  for (let y = area[1]; y < area[3]; y += n) yield [area[0], y, area[2], Math.min(area[3], y + n)];
}
function* normalsInto(c, height, w, h, strength) {
  const g = c.getContext('2d', { willReadFrequently: true }), img = g.createImageData(w, h), d = img.data;
  const Hh = (x, y) => height[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y0 = 0; y0 < h; y0 += 32) {
    for (let y = y0; y < Math.min(h, y0 + 32); y++) for (let x = 0; x < w; x++) {
      const dx = Hh(x + 1, y) - Hh(x - 1, y), dy = Hh(x, y + 1) - Hh(x, y - 1);
      const nx = -dx * strength * 4, ny = dy * strength * 4, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    yield;
  }
  g.putImageData(img, 0, 0);
}

function* woodJob(lite, out) {
  const W = lite ? 1024 : 2048, H = lite ? 256 : 512;
  const px = { W, H, a: new Uint8ClampedArray(W * H * 4), r: new Float32Array(W * H).fill(PAL.lack), h: new Float32Array(W * H).fill(0.5) };
  for (let i = 0; i < W * H; i++) { px.a[i * 4] = 80; px.a[i * 4 + 1] = 34; px.a[i * 4 + 2] = 15; px.a[i * 4 + 3] = 255; }
  yield;
  const sx = W / (FX1 - FX0), sy = H / (FY1 - FY0);
  const toModel = (ix, iy) => [R.U(FX0 + (ix + 0.5) / sx), R.V(FY0 + (iy + 0.5) / sy)];
  const stockM = R.M(R.STOCK);
  for (const part of strips([0, 0, W, H])) { paintWood(px, part, toModel, { pal: PAL, seed: 41, wear: 0.9, edge: (u, v) => -sdPolygon(u, v, stockM) }); yield; }
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
  yield* normalsInto(out.normalMap.image, px.h, W, H, lite ? 1.0 : 1.5);
  out.normalMap.needsUpdate = true;
}

/** Holz-Atlas (PC 2048 × 512, Handy 1024 × 256 ohne Rauheitskarte) – sofort mit Platzhaltern, gezeichnet im Hintergrund. */
export function wirbelWoodMaps(lite = false) {
  const k = lite ? 'wirbelwood:lite' : 'wirbelwood';
  return cached(k, () => {
    const W = lite ? 1024 : 2048, H = lite ? 256 : 512;
    const out = {
      map: toTexture(filled(W, H, 'rgb(80,34,15)'), { srgb: true, repeat: false, aniso: 8 }),
      normalMap: toTexture(filled(W, H, 'rgb(128,128,255)'), { repeat: false }),
      roughnessMap: lite ? null : toTexture(filled(W, H, `rgb(255,${Math.round(PAL.lack * 255)},255)`), { repeat: false, aniso: 8 }),
      roughness: PAL.lack,
    };
    const job = scheduleAtlas(woodJob(lite, out));
    return { key: k, ...out, dispose() { job.cancel(); for (const t of [out.map, out.normalMap, out.roughnessMap]) if (t) t.dispose(); } };
  });
}

// ---------------------------------------------------------------- Laufmantel: Abwicklung und Ausschnitte
// u-Bereich des Mantels (Stirn oben bis Kappe), Winkel a von oben (0) über rechts (+π/2) bis unten (±π)
export const MANTEL_U0 = R.U(R.CAP[0][0]), MANTEL_U1 = R.U(R.MANTEL.x0) + 0.001;
export const mantelUV = (u, a) => [(u - MANTEL_U0) / (MANTEL_U1 - MANTEL_U0), a / (2 * Math.PI) + 0.5];
export const MANTEL_CAMO_REPEAT = [(MANTEL_U1 - MANTEL_U0) / 0.2, 2 * Math.PI * R.MANTEL_R / 0.2];
const RR = R.MANTEL_R;
/** Ausschnitte als Liste { u0, u1, a, ha } (Stadion/abgerundetes Rechteck in der Abwicklung, ha = halbe Bogenhöhe in m). */
export function mantelCuts() {
  const out = [];
  const hv = (R.SLOT_Y[1] - R.SLOT_Y[0]) / 2 / R.PPM, ha = Math.asin(Math.min(0.99, hv / RR)) * RR;
  const ac = Math.PI / 2;                                   // Schlitzmitte im Foto 1 mm unter der Achse – seitlich mittig
  for (const s of [-1, 1]) {
    for (const [x0, x1] of R.SLOTS) out.push({ u0: R.U(x1), u1: R.U(x0), a: s * ac, ha, r: ha, kind: 'slot' });
    const pv = (R.PORT[3] - R.PORT[2]) / 2 / R.PPM, pha = Math.asin(Math.min(0.99, pv / RR)) * RR;
    out.push({ u0: R.U(R.PORT[1]), u1: R.U(R.PORT[0]), a: s * Math.PI / 2, ha: pha, r: 0.0045, kind: 'port' });
  }
  out.push({ u0: R.U(R.PORT_TOP[1]), u1: R.U(R.PORT_TOP[0]), a: 0, ha: 0.0068, r: 0.002, kind: 'eject' });
  const ca = Math.acos(Math.max(-1, Math.min(1, (R.AXIS_Y - R.CHARGE.y) / R.PPM / RR)));
  out.push({ u0: R.U(R.CHARGE.slot[1]), u1: R.U(R.CHARGE.slot[0]), a: ca, ha: 0.0033, r: 0.0033, kind: 'charge' });
  return out;
}
// Deckel ab dem Scharnier: unterhalb y 1092 offen (Holz/Gehäuse ab 1077, Überlappung gegen Fugen) – darunter liegen unteres Gehäuse (bis x 1913) und Schaft
export const OPEN_BELOW = { u: R.U(1500), a: Math.acos(Math.max(-1, Math.min(1, (R.AXIS_Y - 1092) / R.PPM / RR))) };   // 4 mm Überlappung
/** Durchlässigkeitskarte des Mantels (weiß = Blech, schwarz = Loch); PC 1024 × 512, Handy 512 × 256. Gezeichnet in Metern
 *  (Leinwand-Transform: u längs, Bogenlänge quer), damit die Eckenradien der Schlitze rund bleiben; Kanten geglättet
 *  (alphaTest 0,5 schneidet in der Mitte). */
export function wirbelMantelAlpha(lite = false) {
  const k = lite ? 'wirbelmantel:lite' : 'wirbelmantel';
  return cached(k, () => {
    const W = lite ? 512 : 1024, H = lite ? 256 : 512, c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const ku = W / (MANTEL_U1 - MANTEL_U0), ks = H / (2 * Math.PI * RR);
    // Leinwand-y oben = UV v 1 = Winkel +π → s nach unten fallend
    g.setTransform(ku, 0, 0, -ks, -MANTEL_U0 * ku, H / 2);
    g.fillStyle = '#000';
    for (const cu of mantelCuts()) {
      const hu = (cu.u1 - cu.u0) / 2, r = Math.min(cu.r, hu, cu.ha), sc = cu.a * RR;
      g.beginPath(); g.roundRect(cu.u0, sc - cu.ha, cu.u1 - cu.u0, 2 * cu.ha, r); g.fill();
    }
    const sb = OPEN_BELOW.a * RR, sm = Math.PI * RR + 0.002;
    g.fillRect(MANTEL_U0 - 0.002, sb, OPEN_BELOW.u - MANTEL_U0 + 0.002, sm - sb);
    g.fillRect(MANTEL_U0 - 0.002, -sm, OPEN_BELOW.u - MANTEL_U0 + 0.002, sm - sb);
    const t = toTexture(c, { repeat: false, aniso: 4 });
    return { key: k, map: t, dispose() { t.dispose(); } };
  });
}
