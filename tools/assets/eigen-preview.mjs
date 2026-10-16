// Beleuchtete Vorschau eigener Texturen (lib/eigen-gen.mjs): je Satz 2 × 2 gekachelt, Licht schräg von links oben,
// Lambert + Normalen + AO + etwas Glanz nach Rauheit. node tools/assets/eigen-preview.mjs name1,name2,… [size=384] [out.png]
import sharp from 'sharp';
import { EIGEN } from './lib/eigen-gen.mjs';
import { GENERATORS } from './lib/vorlage-gen.mjs';
const ALL = { ...GENERATORS, ...EIGEN };
const names = (process.argv[2] || Object.keys(EIGEN).join(',')).split(',');
const size = +(process.argv[3] || 384);
const out = process.argv[4] || 'tools/out/eigen-preview.png';
const L = [-0.45, 0.55, 0.7]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
const H = [L[0], L[1], L[2] + 1]; const hl = Math.hypot(...H); H[0] /= hl; H[1] /= hl; H[2] /= hl;
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toS = (x) => Math.round(255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)));
const tiles = [];
for (const name of names) {
  const t0 = Date.now();
  const set = ALL[name](size);
  const a = set.albedo.data, nm = set.normal.data, o = set.orm.data;
  const W = size * 2, img = Buffer.alloc(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = ((y % size) * size + (x % size)) * 4;
    const nx = nm[i] / 127.5 - 1, ny = nm[i + 1] / 127.5 - 1, nz = nm[i + 2] / 127.5 - 1;
    const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    const ndh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
    const ao = o[i] / 255, rough = Math.max(0.05, o[i + 1] / 255), metal = o[i + 2] / 255;
    const spec = Math.pow(ndh, 2 / (rough * rough * rough + 0.002)) * (1 - rough) * 0.6;
    const alpha = a[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const alb = toLin(a[i + c] / 255);
      const v = (alb * (1 - metal * 0.6) * (0.28 * ao + 1.05 * ndl) + spec * (0.04 + metal * alb * 2)) * 1.25;
      const bg = ((x >> 4) + (y >> 4)) % 2 ? 0.18 : 0.12;
      img[(y * W + x) * 3 + c] = toS(v * alpha + bg * (1 - alpha));
    }
  }
  tiles.push({ name, buf: await sharp(img, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer() });
  console.log(name, `${Date.now() - t0} ms`);
}
const cols = Math.min(4, tiles.length), rows = Math.ceil(tiles.length / cols), S = size * 2, pad = 22;
const svg = (t) => Buffer.from(`<svg width="${S}" height="${pad}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="sans-serif" font-size="15" fill="#fff">${t}</text></svg>`);
const comp = [];
tiles.forEach((t, k) => { const x = (k % cols) * S, y = Math.floor(k / cols) * (S + pad); comp.push({ input: svg(t.name), left: x, top: y }, { input: t.buf, left: x, top: y + pad }); });
await sharp({ create: { width: cols * S, height: rows * (S + pad), channels: 3, background: '#111' } }).composite(comp).png().toFile(out);
console.log('→', out);
