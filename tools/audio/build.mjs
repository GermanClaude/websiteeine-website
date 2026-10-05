// NULLPUNKT – Aufbereitung der aufgenommenen Klänge (Owner: audio-research).
// Liest tools/audio/recipes.mjs, schneidet/filtert/normalisiert per ffmpeg und kodiert MP3 (CBR, LAME-Tag für
// lückenlose Dekodierung; alle Browser inkl. iOS Safari). Schreibt assets/lib/audio/<gruppe>/<name>_<n>.mp3,
// assets/lib/audio/manifest.json (Messwerte je Datei) und docs/AUDIO_SOURCES.md (Herkunft/Lizenz je Datei).
// Aufruf: node tools/audio/build.mjs [filter-regex] [--dry]
// Quellen müssen vorher geladen sein: tools/audio/fs-fetch.mjs (Freesound), FFSL-Archiv (siehe AUDIO_SOURCES.md).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './analyze.mjs';
import { RECIPES, SOURCES } from './recipes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'assets/lib/audio');
const WORK = resolve(ROOT, 'tools/out/audio/work');
const RAW = resolve(ROOT, 'tools/out/audio');
const args = process.argv.slice(2), dry = args.includes('--dry'), filt = args.find(a => !a.startsWith('--'));
const re = filt ? new RegExp(filt) : null;
mkdirSync(WORK, { recursive: true });

/** Quellkennung → Datei. fs:<id> Freesound-Vorschau, ffsl:<pfad> Free Firearm Sound Library, kenney:<datei>. */
export function srcPath(src) {
  const [kind, rest] = [src.slice(0, src.indexOf(':')), src.slice(src.indexOf(':') + 1)];
  if (kind === 'fs') return resolve(RAW, 'raw', `fs_${rest}.ogg`);
  if (kind === 'ffsl') return resolve(RAW, 'ffsl/Prepared SFX Library', rest);
  if (kind === 'kenney') return resolve(RAW, 'kenney/impact/Audio', rest);
  throw new Error(`unbekannte Quelle ${src}`);
}

function coreFilters(r) {
  const f = [];
  if (r.ch === 1) f.push(r.chan === 'L' ? 'pan=mono|c0=c0' : r.chan === 'R' ? 'pan=mono|c0=c1' : 'pan=mono|c0=0.5*c0+0.5*c1');
  else if (r.width != null && r.width !== 1) f.push(`extrastereo=m=${r.width}:c=false`);
  if (r.denoise) f.push(`afftdn=nr=${r.denoise}:nf=${r.noiseFloor ?? -60}:tn=1`);
  if (r.hp) f.push(`highpass=f=${r.hp}:poles=2`);
  if (r.lp) f.push(`lowpass=f=${r.lp}:poles=2`);
  // „punch“: Transienten um n dB in einen Look-ahead-Limiter fahren → dichterer, lauterer Körper (spielfertig), Crest −n dB
  if (r.punch) f.push(`alimiter=level_in=${(10 ** (r.punch / 20)).toFixed(3)}:limit=${(10 ** (-1 / 20)).toFixed(4)}:attack=0.3:release=60:asc=1:asc_level=0.5:level=false`);
  for (const e of r.eq || []) f.push(e.type === 'lowshelf' ? `lowshelf=f=${e.f}:g=${e.g}` : e.type === 'highshelf' ? `highshelf=f=${e.f}:g=${e.g}` : `equalizer=f=${e.f}:t=q:w=${e.q || 1}:g=${e.g}`);
  return f;
}
const resample = r => `aresample=${r.rate}:resampler=soxr:precision=24`;

/** ffmpeg-Argumente für den Zwischenschnitt (float-WAV). Schleifen: Ende per Gleichleistungs-Überblendung in den Anfang. */
function cutArgs(r, src, wav) {
  const io = ['-i', src];
  const out = ['-ac', String(r.ch), '-c:a', 'pcm_f32le', wav];
  if (r.loop) {
    const XF = r.loop, L = r.len, core = coreFilters(r).join(',');
    // 0,2 s Vorlauf/Nachlauf, damit Hochpass und Resampler eingeschwungen sind; dann exakt schneiden und überblenden
    const PAD = Math.min(0.2, r.at);
    const g = `[0:a]atrim=start=${(r.at - PAD).toFixed(4)}:duration=${(L + XF + PAD + 0.2).toFixed(4)},asetpts=PTS-STARTPTS${core ? ',' + core : ''},${resample(r)},`
      + `atrim=start=${PAD.toFixed(4)}:duration=${(L + XF).toFixed(4)},asetpts=PTS-STARTPTS,asplit=3[s1][s2][s3];`
      + `[s1]atrim=start=${XF}:end=${L},asetpts=PTS-STARTPTS[m];[s2]atrim=start=${L}:end=${L + XF},asetpts=PTS-STARTPTS[t];`
      + `[s3]atrim=start=0:end=${XF},asetpts=PTS-STARTPTS[h];[t]afade=t=out:st=0:d=${XF}:curve=qsin[tf];[h]afade=t=in:st=0:d=${XF}:curve=qsin[hf];`
      + `[tf][hf]amix=inputs=2:normalize=0:duration=longest[x];[m][x]concat=n=2:v=0:a=1[out]`;
    return [...io, '-filter_complex', g, '-map', '[out]', ...out];
  }
  const t0 = Math.max(0, r.at - (r.pre ?? 0.002)), len = r.len, f = [];
  f.push(`atrim=start=${t0.toFixed(4)}:duration=${len.toFixed(4)}`, 'asetpts=PTS-STARTPTS', ...coreFilters(r));
  f.push(r.fadeIn ? `afade=t=in:st=0:d=${r.fadeIn}:curve=tri` : 'afade=t=in:st=0:d=0.0015:curve=tri');
  const fo = r.fade ?? Math.min(0.3, len * 0.3);
  if (fo > 0) f.push(`afade=t=out:st=${(len - fo).toFixed(4)}:d=${fo.toFixed(4)}:curve=${r.fadeCurve || 'exp'}`);
  f.push(resample(r));
  return [...io, '-af', f.join(','), ...out];
}

const durCache = new Map();
function srcDur(src) {
  if (!durCache.has(src)) durCache.set(src, +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }).trim());
  return durCache.get(src);
}
/** Länge an das Quellende anpassen (sonst bricht das Ausblenden ab). */
function clampLen(r, src) {
  const d = srcDur(src), t0 = Math.max(0, r.at - (r.pre ?? 0.002)), need = r.loop ? r.at + r.len + r.loop : t0 + r.len;
  if (need <= d - 0.002) return r;
  const len = r.loop ? d - 0.002 - r.at - r.loop : d - 0.002 - t0;
  console.warn(`  ${r.name}_${r.v}: Quelle endet bei ${d.toFixed(3)} s → Länge ${r.len} → ${len.toFixed(3)} s`);
  return { ...r, len, fade: r.fade != null ? Math.min(r.fade, len * 0.6) : r.fade };
}
const ff = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { maxBuffer: 1 << 28 });
const manifest = existsSync(resolve(OUT, 'manifest.json')) && re ? JSON.parse(readFileSync(resolve(OUT, 'manifest.json'), 'utf8')) : { sounds: {} };
const gains = new Map();
let n = 0;
for (let r of RECIPES) {
  if (re && !re.test(r.name)) continue;
  const src = srcPath(r.src);
  if (!existsSync(src)) { console.error(`FEHLT ${r.name}: ${src}`); continue; }
  r = clampLen(r, src);
  const wav = resolve(WORK, `${r.name}_${r.v}.wav`);
  ff(cutArgs(r, src, wav));
  const pre = analyze(wav);
  // Pegel: Spitze (Transienten) oder max. Momentan-Lautheit, immer mit Spitzen-Obergrenze
  const ceil = r.ceil ?? -1.5;
  let gain;
  if (r.gainFrom) gain = gains.get(r.gainFrom);
  else if (r.target?.lufs != null) gain = Math.min(r.target.lufs - pre.lufsMmax, ceil - pre.peakDb);
  else gain = (r.target?.peak ?? ceil) - pre.peakDb;
  if (gain == null || !Number.isFinite(gain)) throw new Error(`${r.name}: Verstärkung unbekannt (gainFrom ${r.gainFrom}?)`);
  if (pre.peakDb + gain > ceil + 0.05) gain = ceil - pre.peakDb;
  gains.set(`${r.name}_${r.v}`, gain);
  const dir = resolve(OUT, r.group); mkdirSync(dir, { recursive: true });
  const mp3 = resolve(dir, `${r.name}_${r.v}.mp3`);
  if (!dry) ff(['-i', wav, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', `${r.kbps}k`, ...(r.cutoff ? ['-cutoff', String(r.cutoff)] : []), '-ar', String(r.rate), '-ac', String(r.ch),
    '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', mp3]);
  const post = dry ? pre : analyze(mp3);
  const bytes = dry ? 0 : statSync(mp3).size;
  const e = manifest.sounds[r.name] ||= { group: r.group, layer: r.layer, catalog: r.catalog ?? r.name, rate: r.rate, ch: r.ch, kbps: r.kbps, variants: [] };
  Object.assign(e, { group: r.group, layer: r.layer, catalog: r.catalog ?? r.name, rate: r.rate, ch: r.ch, kbps: r.kbps, mix: r.mix ?? e.mix ?? null, note: r.note ?? e.note ?? null });
  e.variants = e.variants.filter(x => x.v !== r.v);
  e.variants.push({ v: r.v, file: relative(OUT, mp3), src: r.src, at: r.at, dur: post.dur, bytes, peakDb: post.peakDb, lufsM: post.lufsMmax, onsetMs: post.onsetMs, gainDb: +gain.toFixed(2) });
  e.variants.sort((a, b) => a.v - b.v);
  n++;
  console.log(`${r.group}/${r.name}_${r.v}.mp3  ${post.dur.toFixed(2)}s ${r.ch}ch ${r.rate} ${r.kbps}k  ${(bytes / 1024).toFixed(1)} KB  pk ${post.peakDb} M ${post.lufsMmax}  gain ${gain.toFixed(1)} dB`);
}
// Verwaiste Dateien (Rezept entfernt) aufräumen – nur bei Vollbau
if (!re && !dry) {
  const keep = new Set(RECIPES.map(r => `${r.group}/${r.name}_${r.v}.mp3`));
  for (const g of readdirSync(OUT, { withFileTypes: true })) if (g.isDirectory()) for (const f of readdirSync(resolve(OUT, g.name))) if (f.endsWith('.mp3') && !keep.has(`${g.name}/${f}`)) { rmSync(resolve(OUT, g.name, f)); console.log(`entfernt ${g.name}/${f}`); }
  for (const k of Object.keys(manifest.sounds)) if (!RECIPES.some(r => r.name === k)) delete manifest.sounds[k];
}
// Summen
let bytes = 0, secs = 0, files = 0, decoded = 0;
const byGroup = {};
for (const s of Object.values(manifest.sounds)) for (const v of s.variants) {
  bytes += v.bytes; secs += v.dur; files++; decoded += v.dur * s.rate * s.ch * 4;
  const g = byGroup[s.group] ||= { files: 0, bytes: 0, secs: 0 }; g.files++; g.bytes += v.bytes; g.secs += v.dur;
}
manifest.version = 1;
manifest.generated = new Date().toISOString().slice(0, 10);
manifest.format = { codec: 'mp3', note: 'CBR, LAME/Xing-Tag (Encoder-Delay), ohne ID3. Einsatz (onsetMs) mit ffmpeg gemessen; Browser-Decoder können wenige ms abweichen → beim Laden führende Stille kürzen.' };
manifest.totals = { files, bytes, MB: +(bytes / 1048576).toFixed(2), seconds: +secs.toFixed(1), decodedMB: +(decoded / 1048576).toFixed(1), byGroup };
if (!dry) writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`\n${n} Dateien gebaut · gesamt ${files} Dateien, ${(bytes / 1048576).toFixed(2)} MB, ${secs.toFixed(1)} s Audio, dekodiert (eigene Rate) ≈ ${(decoded / 1048576).toFixed(1)} MB`);
for (const [g, v] of Object.entries(byGroup)) console.log(`  ${g.padEnd(9)} ${String(v.files).padStart(3)} Dateien ${(v.bytes / 1024).toFixed(0).padStart(6)} KB ${v.secs.toFixed(1).padStart(6)} s`);
if (!dry && !re) {
  const { writeSourcesDoc } = await import('./sources-doc.mjs');
  writeSourcesDoc(RECIPES, SOURCES, manifest);
}
