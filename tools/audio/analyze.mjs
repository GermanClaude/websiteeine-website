// Objektive Klangmessung (ohne Abhören): dekodiert per ffmpeg (48 kHz, Kanäle erhalten) und misst
// Pegel (Spitze, max. Momentan-Lautheit LUFS nach BS.1770 K-Filter, 400 ms), Übersteuerung, Einsatz,
// Rauschboden, Crest-Faktor, Abklingzeiten (−20/−40/−60 dB), Bandbreite, Spektralschwerpunkt (Attacke/Fahne),
// Bandanteile, Stereokorrelation und Anzahl Transienten (Salven).
// Aufruf: node tools/audio/analyze.mjs <dateien…> [--json out.json] [--spec dir]   (--spec: Spektrogramm-PNGs via ffmpeg)
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const SR = 48000;
export function decode(file, sr = SR) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate,codec_name,bit_rate', '-of', 'json', file], { encoding: 'utf8' });
  const st = JSON.parse(probe).streams[0] || {};
  const ch = Math.min(2, st.channels || 1);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', String(ch), '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = all.length / ch, chs = [];
  for (let c = 0; c < ch; c++) { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = all[i * ch + c]; chs.push(d); }
  return { chs, sr, src: st };
}
const db = x => 20 * Math.log10(Math.max(1e-12, x));

// BS.1770 K-Gewichtung (48 kHz Koeffizienten)
function kweight(x) {
  const y = new Float32Array(x.length);
  const s1 = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
  const s2 = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };
  for (const s of [s1, s2]) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const src = s === s1 ? x : y;
    for (let i = 0; i < x.length; i++) { const v = src[i], o = s.b[0] * v + s.b[1] * x1 + s.b[2] * x2 - s.a[0] * y1 - s.a[1] * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; }
  }
  return y;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
/** Mittleres Leistungsspektrum (Hann, 4096) eines Abschnitts. */
function spectrum(x, from = 0, to = x.length, N = 4096) {
  const P = new Float64Array(N / 2); let frames = 0;
  for (let s = from; s + N <= Math.max(to, from + N) && s + N <= x.length; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    fft(re, im); for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; frames++;
  }
  if (!frames) { // kurz: nullauffüllen
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = from; i < Math.min(to, x.length, from + N); i++) re[i - from] = x[i];
    fft(re, im); for (let k = 0; k < N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k]; frames = 1;
  }
  return { P, N };
}
function centroid({ P, N }, sr) { let a = 0, b = 0; for (let k = 1; k < P.length; k++) { const f = k * sr / N; a += f * P[k]; b += P[k]; } return b ? a / b : 0; }
function bands({ P, N }, sr) {
  const edges = [0, 100, 500, 2000, 8000, 24000], e = new Array(5).fill(0); let tot = 0;
  for (let k = 1; k < P.length; k++) { const f = k * sr / N; for (let i = 0; i < 5; i++) if (f >= edges[i] && f < edges[i + 1]) e[i] += P[k]; tot += P[k]; }
  return e.map(v => +(100 * v / (tot || 1)).toFixed(1)); // % Energie: sub, low, mid, high, air
}
function bandwidth({ P, N }, sr) { // höchste Frequenz mit Pegel ≥ max − 60 dB (geglättet)
  let mx = 0; for (let k = 1; k < P.length; k++) mx = Math.max(mx, P[k]);
  const thr = mx * 1e-6; let hi = 0;
  for (let k = 8; k < P.length - 8; k++) { let s = 0; for (let j = -4; j <= 4; j++) s += P[k + j]; if (s / 9 >= thr) hi = k; }
  return Math.round(hi * sr / N);
}

export function analyze(file) {
  const { chs, sr, src } = decode(file);
  const n = chs[0].length, mono = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) mono[i] += c[i] / chs.length;
  let peak = 0, clip = 0, run = 0;
  for (const c of chs) for (let i = 0; i < n; i++) { const a = Math.abs(c[i]); peak = Math.max(peak, a); if (a >= 0.985) { run++; if (run === 3) clip += 3; else if (run > 3) clip++; } else run = 0; }
  // 10-ms-RMS-Hüllkurve
  const W = Math.round(sr * 0.01), env = [];
  for (let s = 0; s + W <= n; s += W) { let e = 0; for (let i = s; i < s + W; i++) e += mono[i] * mono[i]; env.push(Math.sqrt(e / W)); }
  const envDb = env.map(db), maxI = envDb.indexOf(Math.max(...envDb)), maxDb = envDb[maxI];
  const pk = peak; let onset = 0; for (let i = 0; i < n; i++) if (Math.abs(mono[i]) > pk * 0.03) { onset = i; break; }
  const sorted = [...envDb].sort((a, b) => a - b), floor = sorted[Math.floor(sorted.length * 0.1)] ?? -120;
  const pre = onset > W ? db(Math.sqrt(mono.subarray(0, onset).reduce((s, v) => s + v * v, 0) / onset)) : null;
  const decayTo = d => { for (let i = maxI; i < envDb.length; i++) if (envDb[i] < maxDb - d) return +((i - maxI) * 0.01).toFixed(2); return null; };
  // Momentan-Lautheit (400 ms, K-gewichtet, Kanäle summiert)
  const kw = chs.map(kweight), M = Math.round(sr * 0.4), hop = Math.round(sr * 0.05);
  let mMax = -Infinity; for (let s = 0; s < Math.max(1, n - M + 1); s += hop) { let z = 0; for (const k of kw) { let e = 0; const end = Math.min(n, s + M); for (let i = s; i < end; i++) e += k[i] * k[i]; z += e / M; } mMax = Math.max(mMax, -0.691 + 10 * Math.log10(z || 1e-12)); }
  // Crest über 100 ms ab Einsatz
  const a0 = onset, a1 = Math.min(n, onset + Math.round(sr * 0.1)); let ae = 0; for (let i = a0; i < a1; i++) ae += mono[i] * mono[i];
  const crest = db(pk) - db(Math.sqrt(ae / Math.max(1, a1 - a0)));
  // Transienten zählen (Hüllkurvenanstieg > 9 dB in 20 ms, oberhalb max−24 dB, Abstand ≥ 45 ms)
  const hits = []; for (let i = 2; i < envDb.length; i++) if (envDb[i] > maxDb - 24 && envDb[i] - envDb[i - 2] > 9 && (!hits.length || i - hits[hits.length - 1] >= 5)) hits.push(i);
  const att = spectrum(mono, onset, onset + Math.round(sr * 0.06)), tail = spectrum(mono, onset + Math.round(sr * 0.15), n), whole = spectrum(mono);
  let corr = null;
  if (chs.length === 2) { let lr = 0, ll = 0, rr = 0; for (let i = 0; i < n; i++) { lr += chs[0][i] * chs[1][i]; ll += chs[0][i] ** 2; rr += chs[1][i] ** 2; } corr = +(lr / Math.sqrt(ll * rr || 1)).toFixed(2); }
  return {
    file: basename(file), codec: src.codec_name, kbps: src.bit_rate ? Math.round(src.bit_rate / 1000) : null, ch: chs.length, dur: +(n / sr).toFixed(3),
    peakDb: +db(peak).toFixed(1), clipSamples: clip, lufsMmax: +mMax.toFixed(1), onsetMs: Math.round(onset / sr * 1000),
    noiseFloorDb: +floor.toFixed(1), preOnsetDb: pre == null ? null : +pre.toFixed(1), crestDb: +crest.toFixed(1),
    decay20: decayTo(20), decay40: decayTo(40), decay60: decayTo(60), transients: hits.length, hitTimes: hits.slice(0, 40).map(i => +(i * 0.01).toFixed(2)),
    bwHz: bandwidth(whole, sr), centroidAttack: Math.round(centroid(att, sr)), centroidTail: Math.round(centroid(tail, sr)), bands: bands(whole, sr), corr,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), files = [], opt = {};
  for (let i = 0; i < args.length; i++) { if (args[i] === '--json') opt.json = args[++i]; else if (args[i] === '--spec') opt.spec = args[++i]; else files.push(args[i]); }
  const out = [];
  for (const f of files) {
    try {
      const r = analyze(f); out.push(r);
      console.log(`${r.file.padEnd(26)} ${r.dur.toFixed(2).padStart(5)}s ch${r.ch} pk${String(r.peakDb).padStart(6)} clip${String(r.clipSamples).padStart(5)} M${String(r.lufsMmax).padStart(6)} on${String(r.onsetMs).padStart(5)}ms nf${String(r.noiseFloorDb).padStart(6)} cr${String(r.crestDb).padStart(5)} d20/40/60 ${r.decay20}/${r.decay40}/${r.decay60} tr${r.transients} bw${r.bwHz} cA${r.centroidAttack} cT${r.centroidTail} [${r.bands.join(' ')}]${r.corr != null ? ' corr' + r.corr : ''}`);
      if (opt.spec) {
        mkdirSync(opt.spec, { recursive: true });
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-lavfi', 'showspectrumpic=s=480x200:mode=combined:scale=log:fscale=log:legend=0:color=intensity', `${opt.spec}/${r.file.replace(/\.[^.]+$/, '')}.png`]);
      }
    } catch (e) { console.error(`${f}: ${e.message.split('\n')[0]}`); }
  }
  if (opt.json) writeFileSync(opt.json, JSON.stringify(out, null, 1));
}
