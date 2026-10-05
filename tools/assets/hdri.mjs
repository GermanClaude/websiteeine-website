// HDRIs → Beleuchtung (.hdr, RGBE mit RLE) in 512×256 (low) und 1024×512, plus sichtbarer Himmel als
// KTX2 (ETC1S, sRGB, mit dem Spiel-ACES vorab getonemappt) in 1024×512 (low) und 2048×1024.
// Kennzahlen (Sonnenrichtung in three.js-Koordinaten, Leuchtdichten, Belichtung) landen im Manifest,
// damit Karten Sonne/Schatten passend zur Umgebung ausrichten können.
// Aufruf: node tools/assets/hdri.mjs [ids…] [--force]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, gpuBytes, hash, loadSources, log, META, OUT, parseArgs, PIPELINE_VERSION, readJSON, rel, writeFileAtomic, writeJSON } from './lib/common.mjs';
import { analyze, downsample, readHDR, tonemap, writeHDR } from './lib/hdr.mjs';
import { encodeKTX2, ktx2Info } from './lib/ktx.mjs';
import { fetchHDRI } from './lib/sources.mjs';

const args = parseArgs();
const src = loadSources();
const byId = Object.fromEntries(src.hdris.map((t) => [t.id, t]));
const ids = args._.length ? args._ : src.hdris.map((t) => t.id);
const recipe = (e) => hash({ v: PIPELINE_VERSION, id: e.id, s: e.sourceId, tiers: e.tiers, k: 'h3' });

// PMREM (CubeUV, 256er Würfel, RGBA16F): ~768×1024 Texel × 8 B — gilt für beide Stufen
const PMREM_BYTES = 768 * 1024 * 8;

async function build(e) {
  const metaFile = join(META, 'hdris', `${e.id}.json`);
  const r = recipe(e);
  const old = readJSON(metaFile, null);
  const dir = ensureDir(join(OUT, 'hdri', e.id));
  if (!args.force && old?.recipe === r && Object.values(old.tiers).every((t) => existsSync(join(OUT, t.hdr.path)) && existsSync(join(OUT, t.background.path)))) { log('✓', e.id, '(aktuell)'); return; }
  const t0 = Date.now();
  const s = await fetchHDRI(e);
  const img1k = readHDR(readFileSync(s['1k']));
  const img2k = readHDR(readFileSync(s['2k']));
  const stats = analyze(img2k);
  // Belichtung für den Himmel: geometrisches Mittel der oberen Halbkugel → ~0,35 (vor ACES)
  const exposure = +Math.min(8, Math.max(0.02, 0.35 / Math.max(1e-4, stats.skyGeoLuminance))).toFixed(4);

  const writeHdr = (img, name) => {
    const buf = writeHDR(img);
    const f = join(dir, name);
    writeFileAtomic(f, buf);
    // HDRLoader → HalfFloat RGBA (8 B/px), ohne Mips; nach PMREM verwerfbar
    return { path: rel(f).replace(/^assets\/lib\//, ''), bytes: buf.length, width: img.width, height: img.height, gpu: { desktop: img.width * img.height * 8, mobile: img.width * img.height * 8, rgba8: img.width * img.height * 8 } };
  };
  const writeBg = async (img, name) => {
    const rgba = { data: tonemap(img, exposure), width: img.width, height: img.height };
    // ohne Mipmaps (three würde ein Mip-Equirect beim Umrechnen in eine Würfelkarte unvollständig lassen) und
    // zeilengespiegelt (komprimierte Texturen kennen kein flipY; so gilt v = 1 oben wie bei equirectUv)
    const bytes = await encodeKTX2(rgba, 'background', img.width, { mips: false, yflip: true });
    const f = join(dir, name);
    writeFileAtomic(f, bytes);
    const info = ktx2Info(bytes);
    return { path: rel(f).replace(/^assets\/lib\//, ''), bytes: bytes.length, width: info.width, height: info.height, codec: info.codec, gpu: gpuBytes(info.width, info.height, { codec: info.codec, mips: false }) };
  };

  const tiers = {
    512: { hdr: writeHdr(downsample(img1k, 512, 256), `${e.id}_512.hdr`), background: await writeBg(img1k, `${e.id}_bg_1024.ktx2`) },
    1024: { hdr: writeHdr(img1k, `${e.id}_1024.hdr`), background: await writeBg(img2k, `${e.id}_bg_2048.ktx2`) },
  };
  for (const t of Object.values(tiers)) {
    t.bytes = t.hdr.bytes + t.background.bytes;
    // Laufzeit: PMREM-Ziel + Hintergrund (Quell-HDR wird nach PMREM freigegeben)
    t.gpu = { desktop: PMREM_BYTES + t.background.gpu.desktop, mobile: PMREM_BYTES + t.background.gpu.mobile, rgba8: PMREM_BYTES + t.background.gpu.rgba8 };
  }
  writeJSON(metaFile, { id: e.id, recipe: r, tiers, stats: { ...stats, backgroundExposure: exposure } });
  log('✔', e.id, `sonne ${stats.sun.elevationDeg}°/${stats.sun.azimuthDeg}° dom ${stats.sun.dominance}`, Object.entries(tiers).map(([k, v]) => `${k}:${(v.bytes / 1024).toFixed(0)}K`).join(' '), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

for (const id of ids) {
  const e = byId[id];
  if (!e) { log('unbekannt', id); continue; }
  try { await build(e); } catch (err) { log('✗', id, err.stack || err.message); process.exitCode = 1; }
}
