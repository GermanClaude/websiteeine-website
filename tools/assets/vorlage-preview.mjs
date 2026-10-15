// Vorschau der Video-Vorlage-Texturen als PNG (Albedo | Normal | ORM, darunter 2 × 2 gekachelt):
// node tools/assets/vorlage-preview.mjs [name,…] [size=512] → tools/out/vorlage-tex/<name>.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { GENERATORS } from './lib/vorlage-gen.mjs';
const names = (process.argv[2] || Object.keys(GENERATORS).join(',')).split(',');
const size = +(process.argv[3] || 512);
const OUT = 'tools/out/vorlage-tex';
mkdirSync(OUT, { recursive: true });
for (const name of names) {
  const t0 = Date.now();
  const set = GENERATORS[name](size);
  const raw = (img) => sharp(Buffer.from(img.data), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  const [a, n, o] = await Promise.all([raw(set.albedo), raw(set.normal), raw(set.orm)]);
  const tile = await sharp({ create: { width: size * 2, height: size * 2, channels: 4, background: '#000' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: a, left: size, top: 0 }, { input: a, left: 0, top: size }, { input: a, left: size, top: size }]).png().toBuffer();
  await sharp({ create: { width: size * 3, height: size * 3, channels: 4, background: '#000' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: n, left: size, top: 0 }, { input: o, left: size * 2, top: 0 }, { input: tile, left: 0, top: size }])
    .png().toFile(`${OUT}/${name}.png`);
  console.log(name, `${Date.now() - t0} ms`, `${OUT}/${name}.png`);
}
