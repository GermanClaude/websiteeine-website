// KTX2-Dateien dekodieren und als PNG-Kontaktbogen ablegen (Prüfung): node tools/assets/ktx-sheet.mjs <out.png> <datei.ktx2…>
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { decodeKTX2 } from './lib/decode.mjs';
const [, , out, ...files] = process.argv;
const C = 256, cols = Math.min(6, files.length);
const comps = [];
for (let i = 0; i < files.length; i++) {
  const d = await decodeKTX2(readFileSync(files[i]));
  const png = await sharp(Buffer.from(d.data), { raw: { width: d.width, height: d.height, channels: 4 } }).resize(C, C).flatten({ background: '#ff00ff' }).png().toBuffer();
  const x = (i % cols) * C, y = Math.floor(i / cols) * (C + 16);
  comps.push({ input: png, left: x, top: y });
  const label = files[i].split('/').pop();
  comps.push({ input: Buffer.from(`<svg width="${C}" height="16" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#000"/><text x="3" y="12" font-family="sans-serif" font-size="11" fill="#fff">${label}</text></svg>`), left: x, top: y + C });
}
await sharp({ create: { width: cols * C, height: Math.ceil(files.length / cols) * (C + 16), channels: 3, background: '#222' } }).composite(comps).png().toFile(out);
console.log('ok', out);
