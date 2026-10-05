// Kodier-Vergleich (Grundlage der Profile in lib/ktx.mjs): kodiert ein Bild mit mehreren Einstellungen, dekodiert
// mit dem Basis-Transcoder von three.js und misst Größe + Fehler (Normalen: mittlerer Winkelfehler in Grad,
// sonst PSNR in dB). Aufruf: node tools/assets/codec-bench.mjs <bild> [--normal] [--size=1024]
import { encodeToKTX2 } from 'ktx2-encoder';
import { loadRGBA, renormalize } from './lib/ktx.mjs';
import { decodeKTX2, normalError, psnr } from './lib/decode.mjs';
import { parseArgs } from './lib/common.mjs';

const args = parseArgs();
const [file] = args._;
if (!file) { console.log('Aufruf: node tools/assets/codec-bench.mjs <bild> [--normal] [--size=1024]'); process.exit(1); }
const size = Number(args.size || 1024);
const normal = !!args.normal;
let img = await loadRGBA(file, size);
if (normal) img = renormalize(img);

const base = { isSetKTX2SRGBTransferFunc: !normal, isPerceptual: !normal, generateMipmap: true, isNormalMap: normal };
const tests = normal
  ? [
    ['UASTC ohne RDO', { isUASTC: true, needSupercompression: true, uastcLDRQualityLevel: 0 }],
    ['UASTC RDO λ1', { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1, uastcLDRQualityLevel: 0 }],
    ['UASTC RDO λ4', { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 4, uastcLDRQualityLevel: 0 }],
    ['ETC1S q255', { isUASTC: false, qualityLevel: 255, compressionLevel: 2 }],
    ['ETC1S q190', { isUASTC: false, qualityLevel: 190, compressionLevel: 2 }],
  ]
  : [110, 140, 160, 190, 255].map((q) => [`ETC1S q${q}`, { isUASTC: false, qualityLevel: q, compressionLevel: 2 }]);

const out = process.stdout.write.bind(process.stdout);
for (const [name, o] of tests) {
  const t = Date.now();
  process.stdout.write = () => true;
  let bytes;
  try { bytes = await encodeToKTX2(new Uint8Array(1), { ...base, ...o, enableDebug: false, imageDecoder: async () => img }); }
  finally { process.stdout.write = out; }
  const dec = await decodeKTX2(bytes);
  const q = normal ? `${normalError(img, dec).mean.toFixed(2)}°` : `${psnr(img, dec).toFixed(2)} dB`;
  console.log(`${name.padEnd(16)} ${String(bytes.length).padStart(9)} B  ${q.padStart(9)}  ${Date.now() - t} ms`);
}
