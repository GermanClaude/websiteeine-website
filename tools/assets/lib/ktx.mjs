// KTX2/Basis-Kodierung über den WASM-Encoder (npm ktx2-encoder, Basis Universal) + Bildhilfen (sharp).
// Alles ETC1S (klein, transkodiert je nach GPU zu BC7/BC1/ETC1/ETC2/ASTC/PVRTC).
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
import { read as readKTX2 } from 'ktx-parse';

sharp.concurrency(1);   // Rechner ist geteilt — sharp nicht alle Kerne nehmen lassen
sharp.cache(false);

// Der WASM-Encoder schreibt Diagnosezeilen auf stdout — während des Kodierens stummschalten.
const realWrite = process.stdout.write.bind(process.stdout);
let muted = 0;
process.stdout.write = (chunk, ...rest) => (muted ? true : realWrite(chunk, ...rest));

/**
 * Kodier-Profile (gemessen mit tools/assets/lib/decode.mjs an Poly-Haven-Sätzen, 1024²):
 *  Albedo ETC1S q160 ≈ 40 dB PSNR bei ~150 KB. Normalen: ETC1S q255 (Normal-Preset) ≈ 1,4° mittlerer
 *  Winkelfehler bei ~155 KB — gleichwertig zu UASTC+RDO λ1 (1,1°, 520 KB) und auf Mobil nur 0,5 B/px (ETC1).
 *  UASTC wäre bei 2048² 3–4 MB je Normalenkarte (Budget!), daher auch dort ETC1S.
 */
export const PROFILES = {
  albedo: (tier) => ({ isUASTC: false, qualityLevel: tier >= 2048 ? 190 : 160, compressionLevel: 2, isSetKTX2SRGBTransferFunc: true, isPerceptual: true }),
  orm: (tier) => ({ isUASTC: false, qualityLevel: tier >= 2048 ? 128 : 110, compressionLevel: 2, isSetKTX2SRGBTransferFunc: false, isPerceptual: false }),
  normal: () => ({ isUASTC: false, isNormalMap: true, qualityLevel: 255, compressionLevel: 2, isSetKTX2SRGBTransferFunc: false, isPerceptual: false }),
  background: () => ({ isUASTC: false, qualityLevel: 160, compressionLevel: 2, isSetKTX2SRGBTransferFunc: true, isPerceptual: true }),
};

/**
 * RGBA8-Raster → KTX2-Bytes.
 * @param {{data:Uint8Array,width:number,height:number}} img
 * @param {'albedo'|'orm'|'normal'|'background'} kind
 */
export async function encodeKTX2(img, kind, tier = img.width, { mips = true, yflip = false } = {}) {
  const opts = { ...PROFILES[kind](tier), generateMipmap: mips, isYFlip: yflip, enableDebug: false, isKTX2File: true };
  muted++;
  try {
    return await encodeToKTX2(new Uint8Array(1), { ...opts, imageDecoder: async () => img });
  } finally { muted--; }
}

/** KTX2-Kopf lesen → { width, height, levels, codec: 'etc1s'|'uastc', alpha } */
export function ktx2Info(bytes) {
  const c = readKTX2(bytes);
  const codec = c.supercompressionScheme === 1 ? 'etc1s' : 'uastc'; // 1 = BasisLZ
  const dfd = c.dataFormatDescriptor[0];
  const alpha = (dfd?.samples?.length || 0) > 1;
  return { width: c.pixelWidth, height: c.pixelHeight, levels: c.levels.length, codec, alpha };
}

/** Bild laden und auf Quadrat/Zielgröße bringen → RGBA8 raw. */
export async function loadRGBA(input, w, h = w, { kernel = 'lanczos3', fit = 'fill' } = {}) {
  const { data, info } = await sharp(input, { limitInputPixels: false }).resize(w, h, { kernel, fit }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/** Einkanaliges Graustufenbild (Rauheit/AO/Metall) in Zielgröße → Uint8Array(w*h) */
export async function loadGray(input, w, h = w) {
  const { data } = await sharp(input, { limitInputPixels: false }).resize(w, h, { kernel: 'lanczos3', fit: 'fill' }).removeAlpha().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

export async function imageSize(input) { const m = await sharp(input).metadata(); return { width: m.width, height: m.height }; }

/** Normalenkarte nach dem Verkleinern renormieren (Länge 1, Z ≥ 0). In place. */
export function renormalize(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let x = d[i] / 127.5 - 1, y = d[i + 1] / 127.5 - 1, z = d[i + 2] / 127.5 - 1;
    if (z < 0) z = 0;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    d[i] = Math.round((x + 1) * 127.5); d[i + 1] = Math.round((y + 1) * 127.5); d[i + 2] = Math.round((z + 1) * 127.5); d[i + 3] = 255;
  }
  return img;
}

/** RGB → HSV-Farbton (0–360) und Sättigung (0–1). */
export function hueSat(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return [0, 0];
  let h;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, mx === 0 ? 0 : d / mx];
}

/**
 * Lack neutralisieren (für einfärbbare Materialien): Pixel, deren Farbton im Bereich liegt, werden zu Grau
 * mit gleicher Helligkeit, danach auf mittlere Zielhelligkeit normiert. Rost/Schmutz (anderer Farbton) bleibt
 * farbig, wird aber mitskaliert. In place.
 * @param {{hue:[number,number], target:number, keepOther?:number}} o
 */
export function neutralize(img, { hue = [0, 360], target = 0.62, satMin = 0.08, keepOther = 1 } = {}) {
  const d = img.data;
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const enc = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
  const inRange = (h) => hue[0] <= hue[1] ? h >= hue[0] && h <= hue[1] : h >= hue[0] || h <= hue[1];
  let sum = 0, n = 0;
  const L = new Float32Array(d.length / 4), mask = new Float32Array(d.length / 4);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = lin(d[i]), g = lin(d[i + 1]), b = lin(d[i + 2]);
    const [h, s] = hueSat(d[i], d[i + 1], d[i + 2]);
    L[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // weicher Übergang am Rand des Farbtonbereichs
    const m = inRange(h) && s >= satMin ? 1 : s < satMin ? 1 : 1 - keepOther;
    mask[p] = m;
    if (m > 0.5) { sum += L[p]; n++; }
  }
  const scale = n ? (Math.pow(target, 2.2) / (sum / n)) : 1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = lin(d[i]), g = lin(d[i + 1]), b = lin(d[i + 2]), m = mask[p];
    const gr = L[p];
    d[i] = enc((gr * m + r * (1 - m)) * scale);
    d[i + 1] = enc((gr * m + g * (1 - m)) * scale);
    d[i + 2] = enc((gr * m + b * (1 - m)) * scale);
  }
  return img;
}
