// Quell-Downloads (Poly Haven / ambientCG) in den Cache tools/out/assets-cache/src/.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { apiJSON, download, ensureDir, SRC } from './common.mjs';

const PH = 'https://api.polyhaven.com';

export async function phFiles(id) { return apiJSON(`${PH}/files/${id}`, `ph_files_${id}.json`); }

/**
 * Textur-Rohdaten holen. → { albedo, normal, arm?, rough?, ao?, metal?, opacity?, res }
 * Poly Haven: 2k-JPG (Diffuse, nor_gl, arm) — verkleinert ergibt das schärfere 1024er als die 1k-Dateien.
 * ambientCG: 1K-JPG-Zip, für 2048er-Stufen 2K-JPG-Zip.
 */
export async function fetchTexture(e) {
  const maxTier = Math.max(...e.tiers);
  const dir = ensureDir(join(SRC, 'textures', e.id));
  if (e.source === 'polyhaven') {
    const files = await phFiles(e.sourceId);
    const res = '2k';
    const pick = (key) => {
      const f = files[key]?.[res]?.jpg || files[key]?.[res]?.png || files[key]?.['1k']?.jpg;
      return f || null;
    };
    const want = { albedo: 'Diffuse', normal: 'nor_gl', arm: 'arm', rough: 'Rough', ao: 'AO', metal: 'Metal', opacity: 'Alpha' };
    const out = { res };
    for (const [k, key] of Object.entries(want)) {
      if ((k === 'rough' || k === 'ao' || k === 'metal') && files.arm) continue; // ARM reicht
      const f = pick(key);
      if (!f) continue;
      const ext = f.url.split('.').pop();
      out[k] = await download(f.url, join(dir, `${k}.${ext}`), { md5: f.md5 });
    }
    if (!out.albedo || !out.normal) throw new Error(`${e.id}: Diffuse/nor_gl fehlt`);
    return out;
  }
  if (e.source === 'ambientcg') {
    const res = maxTier >= 2048 ? '2K' : '1K';
    const name = `${e.sourceId}_${res}-JPG`;
    const zip = await download(`https://ambientcg.com/get?file=${name}.zip`, join(dir, `${name}.zip`));
    const ex = ensureDir(join(dir, res));
    if (!readdirSync(ex).some((f) => f.endsWith('_Color.jpg'))) execFileSync('unzip', ['-o', '-q', zip, '-x', '*.blend', '*.usdc', '*.mtlx', '*.tres', '*_NormalDX.jpg', '-d', ex]);
    const f = (suffix) => { const p = join(ex, `${name}_${suffix}.jpg`); return existsSync(p) ? p : null; };
    const out = { res, albedo: f('Color'), normal: f('NormalGL'), rough: f('Roughness'), ao: f('AmbientOcclusion'), metal: f('Metalness'), opacity: f('Opacity') };
    if (!out.albedo || !out.normal) throw new Error(`${e.id}: Color/NormalGL fehlt`);
    return out;
  }
  throw new Error('unbekannte Quelle ' + e.source);
}

/** HDRI: 1k + 2k .hdr */
export async function fetchHDRI(e) {
  if (e.source === 'procedural') {
    // eigene Himmel (tools/assets/skygen.py → tools/assets/sky-src/<id>_1k.hdr / _2k.hdr)
    const dir = new URL('../sky-src/', import.meta.url).pathname;
    const out = { '1k': join(dir, `${e.sourceId}_1k.hdr`), '2k': join(dir, `${e.sourceId}_2k.hdr`) };
    for (const f of Object.values(out)) if (!existsSync(f)) throw new Error(`${e.id}: ${f} fehlt – zuerst python3 tools/assets/skygen.py ${e.sourceId}`);
    return out;
  }
  const files = await phFiles(e.sourceId);
  const dir = ensureDir(join(SRC, 'hdris', e.id));
  const out = {};
  for (const r of ['1k', '2k']) {
    const f = files.hdri?.[r]?.hdr;
    if (!f) throw new Error(`${e.id}: ${r} hdr fehlt`);
    out[r] = await download(f.url, join(dir, `${e.sourceId}_${r}.hdr`), { md5: f.md5 });
  }
  return out;
}

/** Modell: glTF (+bin +Texturen) in Auflösung res ('1k'|'2k'). → Pfad der .gltf */
export async function fetchModel(e, res = '1k') {
  if (e.source === 'procedural') {
    // Eigene Modelle (lib/eigen-models.mjs): GLB je Auflösung, neu gebaut wenn Quelltext/Maße sich ändern
    const { buildModelGLB, modelHash } = await import('./eigen-models.mjs');
    const dir = ensureDir(join(SRC, 'models', e.id, res));
    const f = join(dir, `eigen-${modelHash(e.sourceId)}.glb`);
    if (!existsSync(f)) writeFileSync(f, await buildModelGLB(e.sourceId, res === '2k' ? 2048 : 1024));
    return f;
  }
  const files = await phFiles(e.sourceId);
  const g = files.gltf?.[res]?.gltf;
  if (!g) throw new Error(`${e.id}: gltf ${res} fehlt`);
  const dir = ensureDir(join(SRC, 'models', e.id, res));
  const gltfPath = await download(g.url, join(dir, g.url.split('/').pop()), { md5: g.md5 });
  for (const [relPath, f] of Object.entries(g.include || {})) {
    await download(f.url, join(dir, relPath), { md5: f.md5 });
  }
  return gltfPath;
}
