// Sample-Synthese-Bausteine: alles rechnet direkt in Float32Arrays (kein WebAudio nötig),
// damit Puffer in Häppchen vorgerendert und zwischen Kontexten geteilt werden können.

export const TAU = Math.PI * 2;
export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = db => Math.pow(10, db / 20);

/** Deterministischer Zufall (mulberry32) mit Komfortfunktionen. */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.bi = () => r() * 2 - 1;
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.jit = (v, k) => v * (1 + (r() * 2 - 1) * k);
  r.chance = p => r() < p;
  return r;
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const len = (sr, s) => Math.max(1, Math.round(sr * s));
export const buf = (sr, s) => new Float32Array(len(sr, s));

// ---------------------------------------------------------------- Filter

/** RBJ-Biquad. tick() pro Sample, run() über einen Bereich. */
export class Biquad {
  constructor(sr, type = 'lowpass', freq = 1000, q = 0.707, gainDb = 0) {
    this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(type, freq, q, gainDb);
  }
  set(type, freq, q = this.q || 0.707, gainDb = 0) {
    this.type = type; this.q = q;
    const f = clamp(freq, 8, this.sr * 0.47);
    const w = TAU * f / this.sr, cs = Math.cos(w), sn = Math.sin(w);
    const alpha = sn / (2 * q), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'highpass': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
      case 'notch': b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; break;
      case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cs + s); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - s);
        a0 = (A + 1) + (A - 1) * cs + s; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - s; break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cs + s); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - s);
        a0 = (A + 1) - (A - 1) * cs + s; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - s; break;
      }
      default: b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha; // lowpass
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  tick(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(d, from = 0, to = d.length) {
    let { x1, x2, y1, y2 } = this; const { b0, b1, b2, a1, a2 } = this;
    for (let i = from; i < to; i++) {
      const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
    }
    this.x1 = x1; this.x2 = x2; this.y1 = y1; this.y2 = y2;
    return d;
  }
}

/** Filter in-place mit fester Frequenz. Mehrere Stufen = steilere Flanke. */
export function filt(d, sr, type, freq, q = 0.707, stages = 1, gainDb = 0) {
  for (let s = 0; s < stages; s++) new Biquad(sr, type, freq, q, gainDb).run(d);
  return d;
}

/** Zeitvariables Filter: freqAt(tSek) liefert die Frequenz (Koeffizienten alle 32 Samples). */
export function sweep(d, sr, type, freqAt, q = 0.707, from = 0, to = d.length) {
  const bq = new Biquad(sr, type, freqAt(0), q);
  for (let i = from; i < to; i += 32) {
    bq.set(type, freqAt((i - from) / sr), q);
    bq.run(d, i, Math.min(to, i + 32));
  }
  return d;
}

/** Wie sweep(), aber als Generator: pausiert alle `chunk` Samples (für lange Puffer). */
export function* sweepSteps(d, sr, type, freqAt, q = 0.707, chunk = 131072) {
  const bq = new Biquad(sr, type, freqAt(0), q);
  for (let i = 0; i < d.length; i += 32) {
    bq.set(type, freqAt(i / sr), q);
    bq.run(d, i, Math.min(d.length, i + 32));
    if (i && i % chunk === 0) yield;
  }
}

/** Exponentieller Frequenzverlauf f0→f1 über T Sekunden (danach f1). */
export const expGlide = (f0, f1, T) => t => (t >= T ? f1 : f0 * Math.pow(f1 / f0, t / T));

export class OnePole {
  constructor(sr, freq) { this.sr = sr; this.z = 0; this.set(freq); }
  set(freq) { this.a = Math.exp(-TAU * clamp(freq, 1, this.sr * 0.49) / this.sr); return this; }
  lp(x) { this.z = x + (this.z - x) * this.a; return this.z; }
  hp(x) { return x - this.lp(x); }
}

// ---------------------------------------------------------------- Rauschen

export function white(n, R, amp = 1) { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = (R() * 2 - 1) * amp; return d; }

export function pink(n, R, amp = 1) {
  const d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = R() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * amp; b6 = w * 0.115926;
  }
  return d;
}

export function brown(n, R, amp = 1) {
  const d = new Float32Array(n); let z = 0;
  for (let i = 0; i < n; i++) { z = (z + (R() * 2 - 1) * 0.02) * 0.998; d[i] = z * 3.5 * amp; }
  return d;
}

// ---------------------------------------------------------------- Hüllkurven

/** Multipliziert d[from..] mit env(tSek). */
export function env(d, sr, fn, from = 0, to = d.length) {
  for (let i = from; i < to; i++) d[i] *= fn((i - from) / sr);
  return d;
}

/** Attack (linear, a Sek.) + exponentielles Abklingen (Zeitkonstante tau). */
export const ad = (a, tau) => t => (t < a ? t / a : Math.exp(-(t - a) / tau));
/** Attack, Halten, exp. Release. */
export const ahr = (a, h, tau) => t => (t < a ? t / a : t < a + h ? 1 : Math.exp(-(t - a - h) / tau));
/** Glockenförmig (Hann) über Dauer T, optional schief (peak 0..1). */
export const bell = (T, peak = 0.5) => t => {
  if (t <= 0 || t >= T) return 0;
  const x = t / T, p = x < peak ? x / peak : 1 - (x - peak) / (1 - peak);
  return Math.sin(p * Math.PI / 2) ** 2;
};

// ---------------------------------------------------------------- Mischen & Formen

export function mix(dst, src, at = 0, gain = 1) {
  const n = Math.min(src.length, dst.length - at);
  for (let i = 0; i < n; i++) dst[at + i] += src[i] * gain;
  return dst;
}

export const mixAt = (dst, sr, src, tSec, gain = 1) => mix(dst, src, Math.round(tSec * sr), gain);

export function scale(d, g) { for (let i = 0; i < d.length; i++) d[i] *= g; return d; }

export function peakOf(chs) {
  let p = 0;
  for (const d of (Array.isArray(chs) ? chs : [chs])) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  return p;
}

export function normalize(chs, target = 0.9) {
  const p = peakOf(chs); if (p < 1e-9) return chs;
  const g = target / p;
  for (const d of (Array.isArray(chs) ? chs : [chs])) scale(d, g);
  return chs;
}

/** Weiche Sättigung, normiert auf 1 → 1. */
export function drive(d, amount = 2) {
  const n = Math.tanh(amount);
  for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * amount) / n;
  return d;
}

export function fadeOut(d, sr, sec) {
  const n = Math.min(d.length, len(sr, sec));
  for (let i = 0; i < n; i++) d[d.length - 1 - i] *= (i / n) ** 2;
  return d;
}
export function fadeIn(d, sr, sec) {
  const n = Math.min(d.length, len(sr, sec));
  for (let i = 0; i < n; i++) d[i] *= i / n;
  return d;
}

/** Entfernt DC und tiefes Rumpeln. */
export const dcBlock = (d, sr, f = 18) => filt(d, sr, 'highpass', f, 0.6);

export function reverse(d) { d.reverse(); return d; }

/** Kürzt nachlaufende Stille (unter thr) – spart Speicher. */
export function trim(chs, sr, thr = 0.0004, minSec = 0.05) {
  const list = Array.isArray(chs) ? chs : [chs];
  let last = len(sr, minSec);
  for (const d of list) for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > thr) { last = i; break; }
  const n = Math.min(list[0].length, last + len(sr, 0.01));
  const out = list.map(d => { const c = d.slice(0, n); fadeOut(c, sr, Math.min(0.02, n / sr / 4)); return c; });
  return Array.isArray(chs) ? out : out[0];
}

// ---------------------------------------------------------------- Oszillatoren

/** Sinus mit Frequenzfunktion f(t) und Amplitudenfunktion a(t) ab Zeitpunkt at. */
export function sine(d, sr, at, dur, freqAt, ampAt, phase = 0) {
  const i0 = Math.round(at * sr), n = Math.min(len(sr, dur), d.length - i0);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i0 + i] += Math.sin(ph) * ampAt(t);
    ph += TAU * freqAt(t) / sr;
  }
  return d;
}

/** PolyBLEP-Sägezahn (bandbegrenzt). */
export function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

export class Saw {
  constructor(sr, phase = 0) { this.sr = sr; this.p = phase; }
  tick(f) { const dt = f / this.sr; let v = 2 * this.p - 1 - polyBlep(this.p, dt); this.p += dt; if (this.p >= 1) this.p -= 1; return v; }
}
export class Square {
  constructor(sr, phase = 0, pw = 0.5) { this.sr = sr; this.p = phase; this.pw = pw; }
  tick(f) {
    const dt = f / this.sr; let v = this.p < this.pw ? 1 : -1;
    v += polyBlep(this.p, dt);
    let p2 = this.p - this.pw; if (p2 < 0) p2 += 1;
    v -= polyBlep(p2, dt);
    this.p += dt; if (this.p >= 1) this.p -= 1; return v;
  }
}

/** Modalsynthese: Summe gedämpfter Sinus-Moden [freq, amp, decayTau]. */
export function modal(d, sr, at, modes, gain = 1, R = null, maxDur = 2) {
  const i0 = Math.round(at * sr);
  for (const [f, a, tau] of modes) {
    if (f >= sr * 0.47) continue;
    const n = Math.min(len(sr, Math.min(maxDur, tau * 7)), d.length - i0);
    const w = TAU * f / sr; let ph = R ? R() * TAU : 0;
    const k = Math.exp(-1 / (tau * sr)); let e = a * gain;
    // Rekursiver Oszillator wäre schneller, Sinus bleibt bei kurzen Moden ausreichend
    for (let i = 0; i < n; i++) { d[i0 + i] += Math.sin(ph) * e; ph += w; e *= k; }
  }
  return d;
}

/** Metallische Moden aus Grundfrequenz mit unharmonischen Verhältnissen. */
export function metalModes(f0, R, { count = 5, decay = 0.08, spread = 0.04, ratios = [1, 1.58, 2.31, 3.17, 4.12, 5.43, 6.9] } = {}) {
  const out = [];
  for (let k = 0; k < Math.min(count, ratios.length); k++) {
    out.push([f0 * ratios[k] * (1 + (R() * 2 - 1) * spread), 1 / (1 + k * 0.55), decay / (1 + k * 0.35)]);
  }
  return out;
}

/** Kurzer Rausch-Impuls (Klick/Transient), hochpassgefiltert. */
export function click(d, sr, at, { dur = 0.004, tau = 0.0012, hp = 1200, amp = 1, R, lp = 0 }) {
  const n = len(sr, dur), c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = (R() * 2 - 1) * Math.exp(-i / sr / tau);
  c[0] += 0.9; if (n > 1) c[1] -= 0.5;
  if (hp) filt(c, sr, 'highpass', hp, 0.7);
  if (lp) filt(c, sr, 'lowpass', lp, 0.7);
  return mixAt(d, sr, c, at, amp);
}

/** Rauschstoß mit Filter und Hüllkurve. */
export function burst(d, sr, at, { dur = 0.1, type = 'bandpass', freq = 1000, q = 0.8, envFn, amp = 1, R, color = 'white', stages = 1, freqAt = null }) {
  const n = len(sr, dur);
  const c = color === 'pink' ? pink(n, R) : color === 'brown' ? brown(n, R) : white(n, R);
  if (freqAt) sweep(c, sr, type, freqAt, q); else filt(c, sr, type, freq, q, stages);
  if (envFn) env(c, sr, envFn);
  return mixAt(d, sr, c, at, amp);
}

/** Körnige Textur (Kies, Sand, Trümmer): viele kurze gefilterte Rauschkörner. */
export function grains(d, sr, at, { dur = 0.2, count = 20, grainDur = [0.002, 0.008], freq = [2000, 5000], q = 1.5, amp = 0.5, R, density = null }) {
  for (let k = 0; k < count; k++) {
    const u = density ? density(R()) : R();
    const t = at + u * dur, gd = R.range(grainDur[0], grainDur[1]);
    burst(d, sr, t, { dur: gd * 3, freq: R.range(freq[0], freq[1]), q, R, amp: amp * R.range(0.3, 1), envFn: ad(gd * 0.2, gd * 0.5) });
  }
  return d;
}

// ---------------------------------------------------------------- Stimme (ohne Sprache)

export const VOWELS = {
  a: [[800, 1, 80], [1150, 0.5, 90], [2900, 0.18, 120], [3900, 0.08, 130]],
  o: [[450, 1, 70], [800, 0.45, 80], [2830, 0.1, 100], [3800, 0.05, 120]],
  u: [[325, 1, 50], [700, 0.25, 60], [2700, 0.06, 170], [3800, 0.03, 180]],
  e: [[400, 1, 60], [1700, 0.35, 80], [2600, 0.2, 120], [3600, 0.08, 150]],
  ae: [[660, 1, 80], [1720, 0.4, 90], [2410, 0.2, 120], [3500, 0.07, 130]],
  h: [[700, 0.6, 400], [1500, 0.7, 500], [2600, 0.5, 600], [3600, 0.3, 700]],
};

/** Glottal-Pulsfolge (weich), f0At(t) in Hz. Liefert Anregung für Formanten. */
export function glottal(n, sr, f0At, R, { jitter = 0.02, shimmer = 0.1 } = {}) {
  const d = new Float32Array(n); let ph = 0, amp = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += f0At(t) * (1 + (R() * 2 - 1) * jitter) / sr;
    if (ph >= 1) { ph -= 1; amp = 1 + (R() * 2 - 1) * shimmer; }
    // Rosenberg-ähnlicher Puls: Öffnungsphase 0..0.6
    d[i] = ph < 0.6 ? amp * (0.5 - 0.5 * Math.cos(Math.PI * ph / 0.6)) * (ph < 0.4 ? 1 : (0.6 - ph) / 0.2) : 0;
  }
  // Differenzieren → Abstrahlcharakteristik
  for (let i = n - 1; i > 0; i--) d[i] -= d[i - 1];
  return d;
}

/** Paralleles Formantfilter. vowelAt(t) kann Vokalwechsel liefern (Name). */
export function formant(src, sr, vowel, { shift = 1 } = {}) {
  const out = new Float32Array(src.length);
  for (const [f, g, bw] of VOWELS[vowel] || VOWELS.a) {
    const c = src.slice(), fc = f * shift;
    new Biquad(sr, 'bandpass', fc, fc / bw).run(c);
    mix(out, c, 0, g);
  }
  return out;
}

// ---------------------------------------------------------------- Raum & Stereo

/** Kompakter Schroeder-/Freeverb-Hall (mono → stereo, oder nur links mit stereo:false). */
export function reverb(mono, sr, { size = 1, decay = 0.82, damp = 0.35, wet = 0.35, dry = 1, extra = 1.5, stereo = true, spread = 0 } = {}) {
  const n = mono.length + len(sr, extra), input = new Float32Array(n);
  for (let i = 0; i < mono.length; i++) input[i] = mono[i] * 0.015;
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116], aps = [556, 441, 341, 225];
  const d1 = 1 - damp, outs = [];
  for (const sp of stereo ? [0, 23] : [spread]) {
    const acc = new Float32Array(n);
    for (const c of combs) { // Kammfilter: jeweils über das ganze Signal (schnelle, enge Schleifen)
      const D = Math.max(2, Math.round(c * size * sr / 44100) + sp), b = new Float32Array(D);
      let k = 0, z = 0;
      for (let i = 0; i < n; i++) {
        const y = b[k]; z = y * d1 + z * damp; b[k] = input[i] + z * decay;
        if (++k === D) k = 0; acc[i] += y;
      }
    }
    for (const c of aps) {
      const D = Math.max(2, Math.round(c * sr / 44100) + sp), b = new Float32Array(D);
      let k = 0;
      for (let i = 0; i < n; i++) { const y = b[k], x = acc[i]; acc[i] = y - x; b[k] = x + y * 0.5; if (++k === D) k = 0; }
    }
    const g = wet * 3;
    for (let i = 0; i < n; i++) acc[i] = acc[i] * g + (i < mono.length ? mono[i] * dry : 0);
    outs.push(acc);
  }
  return outs;
}

/** Wie reverb(), aber als Generator (Pause zwischen den Kanälen) – für lange Puffer. */
export function* reverbSteps(mono, sr, opts = {}) {
  const [l] = reverb(mono, sr, { ...opts, stereo: false, spread: 0 });
  yield;
  const [r] = reverb(mono, sr, { ...opts, stereo: false, spread: 23 });
  return [l, r];
}

/** Echos: [delaySek, gain, lowpassHz]. In-place auf Kopie, gibt neues (längeres) Array zurück. */
export function echoes(d, sr, taps) {
  const maxDel = Math.max(...taps.map(t => t[0]));
  const out = new Float32Array(d.length + len(sr, maxDel));
  out.set(d);
  for (const [del, g, lp] of taps) {
    const c = d.slice(); if (lp) filt(c, sr, 'lowpass', lp, 0.6, 2);
    mixAt(out, sr, c, del, g);
  }
  return out;
}

/** Stereo aus zwei teilweise korrelierten Signalen erzeugen. */
export function decorrelate(mono, sr, R, amount = 0.35) {
  const a = mono.slice(), b = mono.slice();
  // Kurze Allpass-Ketten mit unterschiedlichen Verzögerungen
  const ap = (d, delay, g) => {
    const D = Math.max(1, Math.round(delay * sr)), z = new Float32Array(D); let k = 0;
    for (let i = 0; i < d.length; i++) { const y = z[k]; const v = -g * d[i] + y; z[k] = d[i] + g * v; k = (k + 1) % D; d[i] = v; }
  };
  ap(a, 0.0031 + R() * 0.002, 0.5 * amount * 2); ap(a, 0.0071, 0.4 * amount * 2);
  ap(b, 0.0043 + R() * 0.002, 0.5 * amount * 2); ap(b, 0.0057, 0.4 * amount * 2);
  for (let i = 0; i < mono.length; i++) { a[i] = lerp(mono[i], a[i], amount * 2); b[i] = lerp(mono[i], b[i], amount * 2); }
  return [a, b];
}

/** Panorama eines Mono-Signals in ein Stereopaar mischen (−1..1, Equal-Power). */
export function panMix(L, R, src, at, pan, gain = 1) {
  const p = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
  mix(L, src, at, Math.cos(p) * gain); mix(R, src, at, Math.sin(p) * gain);
}

/** Nahtlose Schleife: Nachlauf hinter N wird auf den Anfang gefaltet, danach weiche Überblendung. */
export function wrapLoop(chs, N, xfadeSamples = 0) {
  return chs.map(d => {
    const out = d.slice(0, N);
    for (let i = N; i < d.length; i++) out[(i - N) % N] += d[i];
    if (xfadeSamples > 0) {
      // Überblendung Ende→Anfang gegen Knackser bei nicht-periodischen Signalen
      const X = Math.min(xfadeSamples, N >> 2);
      for (let i = 0; i < X; i++) {
        const g = i / X, a = Math.sqrt(g), b = Math.sqrt(1 - g);
        out[i] = out[i] * a + out[N - X + i] * b;
      }
      // Ende wurde in den Anfang übernommen → Schleife beginnt bei X
      return out.subarray(0, N - X).slice();
    }
    return out;
  });
}
