// KTX2 im Node dekodieren (Basis-Transcoder aus three@0.186.1) — für Qualitätsmessungen der Pipeline.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './common.mjs';
const require = createRequire(import.meta.url);
const DIR = join(ROOT, 'assets/vendor/three/addons/libs/basis');
let mod;
async function basis() {
  if (!mod) {
    const BASIS = require(join(DIR, 'basis_transcoder.js'));
    mod = await BASIS({ wasmBinary: readFileSync(join(DIR, 'basis_transcoder.wasm')) });
    mod.initializeBasis();
  }
  return mod;
}
/** Ebene 0 als RGBA8 → { data, width, height } */
export async function decodeKTX2(bytes) {
  const m = await basis();
  const f = new m.KTX2File(new Uint8Array(bytes));
  try {
    if (!f.isValid() || !f.startTranscoding()) throw new Error('KTX2 ungültig');
    const width = f.getWidth(), height = f.getHeight();
    const RGBA32 = 13;
    const size = f.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32);
    const dst = new Uint8Array(size);
    if (!f.transcodeImage(dst, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error('transcode fehlgeschlagen');
    return { data: dst, width, height };
  } finally { f.close(); f.delete(); }
}
/** Mittlerer Winkelfehler (Grad) zweier Normalenkarten */
export function normalError(a, b) {
  let sum = 0, n = a.width * a.height, max = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const ax = a.data[o] / 127.5 - 1, ay = a.data[o + 1] / 127.5 - 1, az = a.data[o + 2] / 127.5 - 1;
    const bx = b.data[o] / 127.5 - 1, by = b.data[o + 1] / 127.5 - 1, bz = b.data[o + 2] / 127.5 - 1;
    const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1;
    const d = Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)));
    const ang = Math.acos(d) * 180 / Math.PI; sum += ang; if (ang > max) max = ang;
  }
  return { mean: sum / n };
}
/** PSNR (dB) über RGB */
export function psnr(a, b) {
  let se = 0; const n = a.width * a.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const d = a.data[i * 4 + c] - b.data[i * 4 + c]; se += d * d; }
  const mse = se / (n * 3); return mse === 0 ? 99 : 10 * Math.log10(255 * 255 / mse);
}
