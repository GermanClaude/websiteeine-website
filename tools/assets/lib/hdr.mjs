// Radiance-HDR (RGBE) lesen/schreiben, verkleinern, Sonne finden, für den sichtbaren Himmel tonemappen.
// Ohne Abhängigkeiten; Bilder als { width, height, data: Float32Array(width*height*3) } (linear, oben→unten).

export function readHDR(buf) {
  let pos = 0;
  const line = () => { let s = ''; while (pos < buf.length && buf[pos] !== 0x0a) s += String.fromCharCode(buf[pos++]); pos++; return s; };
  const magic = line();
  if (!magic.startsWith('#?')) throw new Error('kein Radiance-HDR');
  let l;
  while ((l = line()) !== '') { if (l.startsWith('FORMAT=') && !l.includes('32-bit_rle_rgbe')) throw new Error('nur RGBE: ' + l); }
  const res = line().match(/-Y (\d+) \+X (\d+)/);
  if (!res) throw new Error('Auflösungszeile nicht unterstützt');
  const height = +res[1], width = +res[2];
  const data = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width < 32768 && buf[pos] === 2 && buf[pos + 1] === 2 && ((buf[pos + 2] << 8) | buf[pos + 3]) === width) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let n = buf[pos++];
          if (n > 128) { n -= 128; const v = buf[pos++]; for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = v; }
          else { for (let i = 0; i < n; i++) scan[(x++) * 4 + c] = buf[pos++]; }
        }
      }
    } else {
      for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) scan[x * 4 + c] = buf[pos++];
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3], o = (y * width + x) * 3;
      if (e === 0) { data[o] = data[o + 1] = data[o + 2] = 0; continue; }
      const f = Math.pow(2, e - 136); // 2^(e-128) / 256
      data[o] = (scan[x * 4] + 0.5) * f; data[o + 1] = (scan[x * 4 + 1] + 0.5) * f; data[o + 2] = (scan[x * 4 + 2] + 0.5) * f;
    }
  }
  return { width, height, data };
}

function toRGBE(r, g, b, out, o) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
  const e = Math.ceil(Math.log2(m) + 1e-9);
  const f = 256 / Math.pow(2, e);
  out[o] = Math.min(255, Math.floor(r * f)); out[o + 1] = Math.min(255, Math.floor(g * f)); out[o + 2] = Math.min(255, Math.floor(b * f)); out[o + 3] = e + 128;
}

/** RGBE mit RLE-Scanlines schreiben. */
export function writeHDR({ width, height, data }) {
  const head = Buffer.from(`#?RADIANCE\n# NULLPUNKT asset pipeline\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'latin1');
  const chunks = [head];
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) { const o = (y * width + x) * 3; toRGBE(data[o], data[o + 1], data[o + 2], scan, x * 4); }
    const out = [2, 2, width >> 8, width & 255];
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < width) {
        // Lauf gleicher Werte?
        let run = 1;
        while (x + run < width && run < 127 && scan[(x + run) * 4 + c] === scan[x * 4 + c]) run++;
        if (run >= 3) { out.push(128 + run, scan[x * 4 + c]); x += run; continue; }
        // sonst Literal bis zum nächsten Lauf
        let n = 0; const start = x;
        while (x < width && n < 128) {
          let r = 1;
          while (x + r < width && r < 3 && scan[(x + r) * 4 + c] === scan[x * 4 + c]) r++;
          if (r >= 3) break;
          x++; n++;
        }
        out.push(n); for (let i = 0; i < n; i++) out.push(scan[(start + i) * 4 + c]);
      }
    }
    chunks.push(Buffer.from(out));
  }
  return Buffer.concat(chunks);
}

/** Flächenmittel auf Zielgröße (ganzzahlige Faktoren). */
export function downsample(img, w, h) {
  const fx = img.width / w, fy = img.height / h;
  if (fx !== Math.floor(fx) || fy !== Math.floor(fy)) throw new Error('nur ganzzahlige Faktoren');
  const out = new Float32Array(w * h * 3);
  const n = fx * fy;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) {
      const o = ((y * fy + j) * img.width + x * fx + i) * 3; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2];
    }
    const o = (y * w + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return { width: w, height: h, data: out };
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Pixel (Mitte) → Richtung in three.js-Konvention (equirectUv, flipY wie HDRLoader). */
export function pixelToDir(x, y, w, h) {
  const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h;
  const phi = (u - 0.5) * 2 * Math.PI, theta = (v - 0.5) * Math.PI;
  return [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
}

/** Kennzahlen: Sonne (hellster Bereich), mittlere Leuchtdichte (gesamt / obere Halbkugel). */
export function analyze(img) {
  const s = downsample(img, 256, 128);
  let best = -1, bx = 0, by = 0, sum = 0, sumUp = 0, logUp = 0, nUp = 0, logAll = 0, nAll = 0;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const o = (y * s.width + x) * 3, L = lum(s.data[o], s.data[o + 1], s.data[o + 2]);
    const wgt = Math.cos(((y + 0.5) / s.height - 0.5) * Math.PI); // Raumwinkel
    sum += L * wgt;
    logAll += Math.log(1e-4 + L) * wgt; nAll += wgt;
    if (y < s.height / 2) { sumUp += L * wgt; logUp += Math.log(1e-4 + L) * wgt; nUp += wgt; }
    if (L > best) { best = L; bx = x; by = y; }
  }
  let wsum = 0;
  for (let y = 0; y < s.height; y++) wsum += Math.cos(((y + 0.5) / s.height - 0.5) * Math.PI) * s.width;
  const avg = sum / wsum, avgUp = sumUp / nUp, geoUp = Math.exp(logUp / nUp);
  const dir = pixelToDir(bx, by, s.width, s.height);
  const elevation = Math.asin(dir[1]) * 180 / Math.PI;
  const azimuth = Math.atan2(dir[0], -dir[2]) * 180 / Math.PI; // 0° = −Z (Blickrichtung Yaw 0), positiv nach +X
  return {
    sun: { dir: dir.map((v) => +v.toFixed(4)), elevationDeg: +elevation.toFixed(1), azimuthDeg: +azimuth.toFixed(1), peak: +best.toFixed(2), dominance: +(best / Math.max(1e-6, avgUp)).toFixed(1) },
    avgLuminance: +avg.toFixed(4), skyLuminance: +avgUp.toFixed(4), skyGeoLuminance: +geoUp.toFixed(4), geoLuminance: +Math.exp(logAll / nAll).toFixed(4),
  };
}

// ACES-Filmic wie three.js (RRT+ODT-Fit, Eingang ×1/0.6 wie im Shader)
function rrtOdt(v) { const a = v * (v + 0.0245786) - 0.000090537; const b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
const ACES_IN = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
const ACES_OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
function mulCols(m, r, g, b) { return [m[0][0] * r + m[1][0] * g + m[2][0] * b, m[0][1] * r + m[1][1] * g + m[2][1] * b, m[0][2] * r + m[1][2] * g + m[2][2] * b]; }
const srgb = (c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** HDR → sRGB-RGBA8 (ACES wie im Spiel, Belichtung frei). */
export function tonemap(img, exposure) {
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0, n = img.width * img.height; i < n; i++) {
    let r = img.data[i * 3] * exposure / 0.6, g = img.data[i * 3 + 1] * exposure / 0.6, b = img.data[i * 3 + 2] * exposure / 0.6;
    [r, g, b] = mulCols(ACES_IN, r, g, b);
    r = rrtOdt(r); g = rrtOdt(g); b = rrtOdt(b);
    [r, g, b] = mulCols(ACES_OUT, r, g, b);
    out[i * 4] = Math.round(255 * srgb(Math.min(1, Math.max(0, r))));
    out[i * 4 + 1] = Math.round(255 * srgb(Math.min(1, Math.max(0, g))));
    out[i * 4 + 2] = Math.round(255 * srgb(Math.min(1, Math.max(0, b))));
    out[i * 4 + 3] = 255;
  }
  return out;
}
