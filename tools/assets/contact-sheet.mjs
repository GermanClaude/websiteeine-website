// Kontaktbogen aus Vorschaubildern (Kuratierung): node tools/assets/contact-sheet.mjs <out.png> <id|acg:ID|…>
import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, ensureDir } from './lib/common.mjs';
const [, , out, ...ids] = process.argv;
const T = ensureDir(join(CACHE, 'thumbs')) + '/';
const C = 200, cols = 6;
async function thumb(id) {
  const [src, name] = id.includes(':') ? id.split(':') : ['ph', id];
  const f = T + src + '_' + name + '.img';
  if (!existsSync(f)) {
    const url = src === 'acg' ? `https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/256-PNG/${name}.png`
      : src === 'phm' ? `https://cdn.polyhaven.com/asset_img/thumbs/${name}.png?width=256&height=256`
      : `https://cdn.polyhaven.com/asset_img/thumbs/${name}.png?width=256&height=256`;
    for (let i = 0; i < 4; i++) {
      try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; }
      catch (e) { if (i === 3) { console.error('fail', id, e.message); return null; } }
    }
  }
  return sharp(readFileSync(f)).resize(C, C, { fit: 'contain', background: '#808080' }).flatten({ background: '#808080' }).png().toBuffer();
}
const rows = Math.ceil(ids.length / cols);
const comps = [];
for (let i = 0; i < ids.length; i++) {
  const b = await thumb(ids[i]);
  const x = (i % cols) * C, y = Math.floor(i / cols) * (C + 18);
  if (b) comps.push({ input: b, left: x, top: y });
  const svg = `<svg width="${C}" height="18" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#000"/><text x="3" y="13" font-family="sans-serif" font-size="12" fill="#fff">${ids[i]}</text></svg>`;
  comps.push({ input: Buffer.from(svg), left: x, top: y + C });
}
await sharp({ create: { width: cols * C, height: rows * (C + 18), channels: 3, background: '#222' } }).composite(comps).png().toFile(out);
console.log('ok', out);
