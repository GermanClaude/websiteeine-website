// Texturen 1:1 aus der Video-Vorlage (Nutzer 15.10.: „genau rausfinden, aus welcher Textur der Boden ist, und 1:1
// kopieren“ – das Video stammt vom Nutzer selbst). Werkzeuge: Videobild laden, Fläche entzerren (Boden über
// Kameramodell, Wand über vier Eckpunkte), Beleuchtung herausrechnen, kachelbar machen.
// Bilder sind { data: Float32Array (linear RGB, 3 Kanäle), width, height }.
import sharp from 'sharp';

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const toSrgb8 = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055)));

/** PNG/JPG → linear RGB. */
export async function loadImage(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(info.width * info.height * 3);
  for (let i = 0; i < out.length; i++) out[i] = toLin(data[i] / 255);
  return { data: out, width: info.width, height: info.height };
}

/** Bilinear abtasten (Pixelkoordinaten, Mitte = +0,5). */
function sample(img, x, y, out, o) {
  const w = img.width, h = img.height;
  x = Math.min(w - 1.001, Math.max(0, x - 0.5)); y = Math.min(h - 1.001, Math.max(0, y - 0.5));
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  for (let c = 0; c < 3; c++) {
    const a = img.data[(yi * w + xi) * 3 + c], b = img.data[(yi * w + xi + 1) * 3 + c];
    const d = img.data[((yi + 1) * w + xi) * 3 + c], e = img.data[((yi + 1) * w + xi + 1) * 3 + c];
    out[o + c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  }
}

/**
 * Bodenfläche aus einer Ego-Ansicht entzerren: Kamera in Höhe h (m), Horizont in Bildzeile yh, Brennweite f (px),
 * Bildmitte cx. Ausschnitt X ∈ [x0, x1] (m, rechts +), Z ∈ [z0, z1] (m, Tiefe) → w × hgt Pixel (Zeile 0 = fern).
 */
export function rectifyGround(img, { h = 1.7, yh, f, cx = img.width / 2, X, Z, w, hgt }) {
  const out = new Float32Array(w * hgt * 3);
  for (let j = 0; j < hgt; j++) {
    const z = Z[1] + (Z[0] - Z[1]) * ((j + 0.5) / hgt);
    for (let i = 0; i < w; i++) {
      const x = X[0] + (X[1] - X[0]) * ((i + 0.5) / w);
      sample(img, cx + (x * f) / z, yh + (h * f) / z, out, (j * w + i) * 3);
    }
  }
  return { data: out, width: w, height: hgt };
}

/** Homographie aus 4 Punktpaaren (Ziel-Einheitsquadrat → Bild). */
function homography(src) {
  // Abbildung (u, v) ∈ [0,1]² → Bild; src = [[x0,y0] (u0,v0 oben links), [x1,y1] (oben rechts), [x2,y2] (unten rechts), [x3,y3] (unten links)]
  const dst = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [], b = [];
  for (let k = 0; k < 4; k++) {
    const [u, v] = dst[k], [x, y] = src[k];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  // Gauß-Elimination
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) { const k = A[r][c] / A[c][c]; for (let q = c; q < n; q++) A[r][q] -= k * A[c][q]; b[r] -= k * b[c]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let q = r + 1; q < n; q++) s -= A[r][q] * x[q]; x[r] = s / A[r][r]; }
  return (u, v) => { const d = x[6] * u + x[7] * v + 1; return [(x[0] * u + x[1] * v + x[2]) / d, (x[3] * u + x[4] * v + x[5]) / d]; };
}

/** Schräg gesehene Wand/Fläche über ihre vier Bildecken (oben links, oben rechts, unten rechts, unten links) entzerren. */
export function rectifyQuad(img, corners, w, hgt) {
  const H = homography(corners), out = new Float32Array(w * hgt * 3);
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
    const [x, y] = H((i + 0.5) / w, (j + 0.5) / hgt);
    sample(img, x, y, out, (j * w + i) * 3);
  }
  return { data: out, width: w, height: hgt };
}

/** Größe ändern (bilinear). */
export function resize(img, w, hgt) {
  const out = new Float32Array(w * hgt * 3);
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) sample(img, ((i + 0.5) / w) * img.width, ((j + 0.5) / hgt) * img.height, out, (j * w + i) * 3);
  return { data: out, width: w, height: hgt };
}

/** Kastenunschärfe je Kanal (Rand: geklemmt), r in Pixeln. */
function boxBlur(img, r) {
  const { width: w, height: h } = img, tmp = new Float32Array(w * h * 3), out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
    for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); s += img.data[(y * w + xx) * 3 + c]; n++; } tmp[(y * w + x) * 3 + c] = s / n; }
  }
  for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); s += tmp[(yy * w + x) * 3 + c]; n++; } out[(y * w + x) * 3 + c] = s / n; }
  }
  return { data: out, width: w, height: h };
}

/**
 * Beleuchtung herausrechnen: großräumige Helligkeitsverläufe (Licht, Schatten, Vignette) durch die Unschärfe im
 * Radius r teilen, dann auf die Zielfarbe `target` (linear RGB, Mittel) setzen. Lokale Unterschiede (Risse, Flecken,
 * Fugen) bleiben 1:1.
 */
export function delight(img, r, target) {
  const b = boxBlur(img, r), out = new Float32Array(img.data.length);
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  let mean = [0, 0, 0];
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const L = Math.max(1e-4, lum(b.data, i * 3));
    for (let c = 0; c < 3; c++) { out[i * 3 + c] = img.data[i * 3 + c] / L; mean[c] += out[i * 3 + c]; }
  }
  mean = mean.map((m) => m / n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = (out[i * 3 + c] / mean[c]) * target[c];
  return { data: out, width: img.width, height: img.height };
}

/**
 * Kachelbar machen (Überblendung): das Bild wird um `ov` (Anteil) breiter/höher eingelesen; rechter/unterer Rand wird
 * weich in den linken/oberen überblendet. Ergebnis: (w·(1−ov)) × (h·(1−ov)).
 */
export function makeTileable(img, ov = 0.18) {
  const W = img.width, H = img.height, w = Math.round(W * (1 - ov)), h = Math.round(H * (1 - ov)), ow = W - w, oh = H - h;
  const px = (x, y, c) => img.data[(y * W + x) * 3 + c];
  const tmp = new Float32Array(w * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let v = px(x, y, c);
    if (x < ow) { const t = x / ow, s = t * t * (3 - 2 * t); v = px(x + w, y, c) * (1 - s) + v * s; }
    tmp[(y * w + x) * 3 + c] = v;
  }
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let v = tmp[(y * w + x) * 3 + c];
    if (y < oh) { const t = y / oh, s = t * t * (3 - 2 * t); v = tmp[((y + h) * w + x) * 3 + c] * (1 - s) + v * s; }
    out[(y * w + x) * 3 + c] = v;
  }
  return { data: out, width: w, height: h };
}

/** Helligkeit (linear) als Float32Array. */
export function luminance(img) {
  const n = img.width * img.height, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.2126 * img.data[i * 3] + 0.7152 * img.data[i * 3 + 1] + 0.0722 * img.data[i * 3 + 2];
  return out;
}

/** Linear RGB → PNG (Vorschau). */
export async function savePng(img, file) {
  const n = img.width * img.height, buf = Buffer.alloc(n * 3);
  for (let i = 0; i < n * 3; i++) buf[i] = toSrgb8(img.data[i]);
  await sharp(buf, { raw: { width: img.width, height: img.height, channels: 3 } }).png().toFile(file);
}
