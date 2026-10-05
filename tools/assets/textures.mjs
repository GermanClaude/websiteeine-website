// PBR-Texturensätze → KTX2 in Stufen (512 / 1024 / 2048).
// Je Satz und Stufe: <id>_<tier>_albedo.ktx2 (sRGB, ETC1S; Alpha bei Gittern), _normal.ktx2 (OpenGL-Konvention,
// UASTC+RDO+Zstd), _orm.ktx2 (R = Umgebungsverdeckung, G = Rauheit, B = Metall; linear, ETC1S).
// Aufruf: node tools/assets/textures.mjs [ids…] [--force]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addGpu, ensureDir, fileSize, GPU0, gpuBytes, hash, loadSources, log, META, OUT, parseArgs, PIPELINE_VERSION, readJSON, rel, writeFileAtomic, writeJSON } from './lib/common.mjs';
import { encodeKTX2, ktx2Info, loadGray, loadRGBA, neutralize, renormalize } from './lib/ktx.mjs';
import { fetchTexture } from './lib/sources.mjs';

const args = parseArgs();
const src = loadSources();
const byId = Object.fromEntries(src.textures.map((t) => [t.id, t]));
const ids = args._.length ? args._ : src.textures.map((t) => t.id);

const recipe = (e) => hash({ v: PIPELINE_VERSION, e: { ...e, url: undefined, author: undefined, name: undefined }, profiles: 'k5' });

// ---------------------------------------------------------------------------------------------
// Prozedurale Tarnmuster (kachelbar): periodisches Value-Noise mit Domain-Warping
// ---------------------------------------------------------------------------------------------
function makeNoise(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const tables = new Map();
  const table = (p) => { if (!tables.has(p)) tables.set(p, Float32Array.from({ length: p * p }, rnd)); return tables.get(p); };
  const fade = (t) => t * t * (3 - 2 * t);
  // u,v ∈ [0,1), Periode p Zellen
  const value = (u, v, p) => {
    const t = table(p), x = u * p, y = v * p, xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
    const i0 = ((xi % p) + p) % p, j0 = ((yi % p) + p) % p, i1 = (i0 + 1) % p, j1 = (j0 + 1) % p;
    const a = t[j0 * p + i0], b = t[j0 * p + i1], c = t[j1 * p + i0], d = t[j1 * p + i1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (u, v, p0, oct = 4) => { let sum = 0, amp = 1, norm = 0, p = p0; for (let o = 0; o < oct; o++) { sum += value(u, v, p) * amp; norm += amp; amp *= 0.5; p *= 2; } return sum / norm; };
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
const CAMO = {
  // Grundfarbe + drei Flecklagen (Farbe, Schwelle, Periode); Farben gedeckt, keine realen Muster nachgebildet
  woodland: { seed: 11, base: '#6a6847', layers: [['#424d30', 0.5, 3], ['#5e4a33', 0.56, 4], ['#24241f', 0.63, 5]] },
  desert: { seed: 23, base: '#c4ae86', layers: [['#a88d65', 0.5, 3], ['#806a4f', 0.6, 4], ['#ddd0ae', 0.64, 6]] },
  urban: { seed: 37, base: '#8b8f92', layers: [['#5d6266', 0.5, 3], ['#2c2f31', 0.6, 4], ['#c3c6c8', 0.64, 6]] },
};
export const CAMO_DETAIL_REPEAT = 8; // Gewebe-Kacheln je Tarnmuster-Kachel

async function camoAlbedo(kind, size, baseAlbedo) {
  const cfg = CAMO[kind];
  const noise = makeNoise(cfg.seed), warp = makeNoise(cfg.seed + 101);
  const detail = await loadRGBA(baseAlbedo, size / CAMO_DETAIL_REPEAT);
  // Gewebe-Helligkeit normieren (Mittel 1)
  const dl = new Float32Array(detail.width * detail.height);
  let mean = 0;
  for (let i = 0; i < dl.length; i++) { const o = i * 4; dl[i] = 0.2126 * toLin(detail.data[o] / 255) + 0.7152 * toLin(detail.data[o + 1] / 255) + 0.0722 * toLin(detail.data[o + 2] / 255); mean += dl[i]; }
  mean /= dl.length;
  const base = hex(cfg.base).map(toLin), layers = cfg.layers.map(([c, t, p]) => [hex(c).map(toLin), t, p]);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let u = x / size, v = y / size;
    const wu = warp(u, v, 8, 3) - 0.5, wv = warp(v, u, 8, 3) - 0.5;
    u = (u + wu * 0.06 + 1) % 1; v = (v + wv * 0.06 + 1) % 1;
    let col = base;
    layers.forEach(([c, t, p], li) => { if (noise((u + li * 0.37) % 1, (v + li * 0.61) % 1, p, 4) > t) col = c; });
    const dx = x % detail.width, dy = y % detail.height;
    const d = Math.min(1.35, Math.max(0.65, dl[dy * detail.width + dx] / mean));
    const o = (y * size + x) * 4;
    out[o] = toSrgb(col[0] * d); out[o + 1] = toSrgb(col[1] * d); out[o + 2] = toSrgb(col[2] * d); out[o + 3] = 255;
  }
  return { data: out, width: size, height: size };
}

// ---------------------------------------------------------------------------------------------
async function buildORM(s, size) {
  if (s.arm) {
    const img = await loadRGBA(s.arm, size);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    return img;
  }
  const n = size * size;
  const rough = s.rough ? await loadGray(s.rough, size) : new Uint8Array(n).fill(200);
  const ao = s.ao ? await loadGray(s.ao, size) : new Uint8Array(n).fill(255);
  const metal = s.metal ? await loadGray(s.metal, size) : new Uint8Array(n).fill(0);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { data[i * 4] = ao[i]; data[i * 4 + 1] = rough[i]; data[i * 4 + 2] = metal[i]; data[i * 4 + 3] = 255; }
  return { data, width: size, height: size };
}

function stats(albedo, orm) {
  let r = 0, g = 0, b = 0, ro = 0, me = 0, ao = 0, a = 0;
  const n = albedo.width * albedo.height;
  for (let i = 0; i < n; i++) {
    r += toLin(albedo.data[i * 4] / 255); g += toLin(albedo.data[i * 4 + 1] / 255); b += toLin(albedo.data[i * 4 + 2] / 255); a += albedo.data[i * 4 + 3] / 255;
    if (orm) { ao += orm.data[i * 4] / 255; ro += orm.data[i * 4 + 1] / 255; me += orm.data[i * 4 + 2] / 255; }
  }
  const hexOf = (v) => toSrgb(v / n).toString(16).padStart(2, '0');
  return { avgColor: '#' + hexOf(r) + hexOf(g) + hexOf(b), avgRoughness: orm ? +(ro / n).toFixed(3) : null, avgMetalness: orm ? +(me / n).toFixed(3) : null, avgAO: orm ? +(ao / n).toFixed(3) : null, coverage: +(a / n).toFixed(3) };
}

async function writeKTX(file, img, kind, tier) {
  const bytes = await encodeKTX2(img, kind, tier);
  writeFileAtomic(file, bytes);
  const info = ktx2Info(bytes);
  return { path: rel(file).replace(/^assets\/lib\//, ''), bytes: bytes.length, width: info.width, height: info.height, codec: info.codec, alpha: info.alpha, gpu: gpuBytes(info.width, info.height, { codec: info.codec, alpha: info.alpha }) };
}

async function buildSet(e) {
  const metaFile = join(META, 'textures', `${e.id}.json`);
  const r = recipe(e);
  const old = readJSON(metaFile, null);
  const outDir = ensureDir(join(OUT, 'textures', e.id));
  if (!args.force && old?.recipe === r && Object.values(old.tiers).every((t) => Object.values(t.files).every((f) => f.shared || existsSync(join(OUT, f.path))))) {
    log('✓', e.id, '(aktuell)');
    return;
  }
  const t0 = Date.now();
  const meta = { id: e.id, recipe: r, tiers: {}, stats: null };
  if (e.source === 'derived') {
    const base = byId[e.base];
    const baseMeta = readJSON(join(META, 'textures', `${e.base}.json`), null);
    if (!baseMeta) throw new Error(`${e.id}: Basis ${e.base} zuerst bauen`);
    const s = await fetchTexture(base);
    for (const tier of e.tiers) {
      const albedo = await camoAlbedo(e.sourceId.split(':')[1], tier, s.albedo);
      const files = { albedo: await writeKTX(join(outDir, `${e.id}_${tier}_albedo.ktx2`), albedo, 'albedo', tier) };
      const bt = baseMeta.tiers[tier];
      files.normal = { ...bt.files.normal, shared: e.base };
      files.orm = { ...bt.files.orm, shared: e.base };
      meta.tiers[tier] = files;
      if (tier === 512) meta.stats = { ...stats(albedo, null), avgRoughness: baseMeta.stats.avgRoughness, avgMetalness: baseMeta.stats.avgMetalness, avgAO: baseMeta.stats.avgAO };
    }
    meta.detailRepeat = CAMO_DETAIL_REPEAT;
  } else {
    const s = await fetchTexture(e);
    for (const tier of e.tiers) {
      const albedo = await loadRGBA(s.albedo, tier);
      if (e.recolor) neutralize(albedo, e.recolor);
      if (e.alpha && s.opacity) {
        const op = await loadGray(s.opacity, tier);
        for (let i = 0; i < op.length; i++) albedo.data[i * 4 + 3] = op[i];
      } else for (let i = 3; i < albedo.data.length; i += 4) albedo.data[i] = 255;
      const normal = renormalize(await loadRGBA(s.normal, tier));
      const orm = await buildORM(s, tier);
      const files = {
        albedo: await writeKTX(join(outDir, `${e.id}_${tier}_albedo.ktx2`), albedo, 'albedo', tier),
        normal: await writeKTX(join(outDir, `${e.id}_${tier}_normal.ktx2`), normal, 'normal', tier),
        orm: await writeKTX(join(outDir, `${e.id}_${tier}_orm.ktx2`), orm, 'orm', tier),
      };
      meta.tiers[tier] = files;
      if (tier === 512) meta.stats = stats(albedo, orm);
    }
  }
  for (const files of Object.values(meta.tiers)) {
    let bytes = 0, gpu = GPU0();
    for (const f of Object.values(files)) { if (!f.shared) bytes += f.bytes; gpu = addGpu(gpu, f.gpu); }
    files._total = { bytes, gpu };
  }
  // _total aus files herausziehen
  for (const [tier, files] of Object.entries(meta.tiers)) { const tot = files._total; delete files._total; meta.tiers[tier] = { files, ...tot }; }
  writeJSON(metaFile, meta);
  log('✔', e.id, Object.entries(meta.tiers).map(([t, v]) => `${t}:${(v.bytes / 1024).toFixed(0)}K`).join(' '), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

for (const id of ids) {
  const e = byId[id];
  if (!e) { log('unbekannt', id); continue; }
  try { await buildSet(e); } catch (err) { log('✗', id, err.stack || err.message); process.exitCode = 1; }
}
