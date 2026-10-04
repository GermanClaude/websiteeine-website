// UI-, Feedback- und Stinger-Klänge (Treffermarker, Medaillen, Streaks, Countdown, Sieg/Niederlage …).
import {
  TAU, len, buf, white, brown, filt, sweep, expGlide, env, ad, ahr, bell, mix, mixAt, drive, normalize,
  sine, modal, click, burst, grains, reverb, reverbSteps, fadeOut, dcBlock, trim, mtof, Saw, Square, clamp, panMix,
} from './dsp.js';

// ---------------------------------------------------------------- Instrumente

/** FM-Glocke. */
export function fmBell(d, sr, at, f, dur, amp = 1, { ratio = 3.5, index = 2.2, tau = dur * 0.3 } = {}) {
  const i0 = Math.round(at * sr), n = Math.min(len(sr, dur), d.length - i0);
  for (let i = 0; i < n; i++) {
    const t = i / sr, e = Math.exp(-t / tau), I = index * Math.exp(-t / (tau * 0.4));
    d[i0 + i] += Math.sin(TAU * f * t + I * Math.sin(TAU * f * ratio * t)) * e * amp * Math.min(1, t / 0.002);
  }
  return d;
}

/** Blechbläser-artiger Synth: verstimmte Sägezähne durch hüllkurvengesteuerten Tiefpass. */
export function brass(d, sr, at, f, dur, amp = 1, { attack = 0.03, release = 0.25, cutoff = 2400, detune = 0.006, vib = 0 } = {}) {
  const n = len(sr, dur + release), i0 = Math.round(at * sr), c = new Float32Array(n);
  const oscs = [-1, 0, 1].map(k => ({ o: new Saw(sr, (0.37 * (k + 2) + f * 0.001) % 1), k }));
  for (let i = 0; i < n; i++) {
    const t = i / sr, v = 1 + vib * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.4);
    let s = 0; for (const { o, k } of oscs) s += o.tick(f * v * (1 + k * detune));
    c[i] = s / 3;
  }
  sweep(c, sr, 'lowpass', t => 200 + cutoff * (t < attack ? t / attack : Math.exp(-(t - attack) / (dur * 0.8 + 0.05))), 1.2);
  env(c, sr, t => (t < attack ? t / attack : t < dur ? 1 : Math.exp(-(t - dur) / (release * 0.35))));
  const m = Math.min(n, d.length - i0);
  for (let i = 0; i < m; i++) d[i0 + i] += c[i] * amp;
  return d;
}

function blip(d, sr, at, f, dur, amp = 1, square = false) {
  const n = len(sr, dur), c = new Float32Array(n), e = ahr(0.002, dur * 0.45, dur * 0.22);
  if (square) {
    const o = new Square(sr);
    for (let i = 0; i < n; i++) c[i] = o.tick(f) * e(i / sr);
    filt(c, sr, 'lowpass', 3200, 0.7);
  } else sine(c, sr, 0, dur, () => f, e);
  return mixAt(d, sr, c, at, amp);
}

/** Funk-Bandpass (300–3000 Hz) mit leichter Verzerrung. */
function radio(d, sr) { filt(d, sr, 'highpass', 380, 0.8, 2); filt(d, sr, 'lowpass', 3000, 0.8, 2); drive(d, 2.2); return d; }
function squelch(d, sr, at, R, dur = 0.06, amp = 0.35) {
  burst(d, sr, at, { dur, type: 'bandpass', freq: 1900, q: 0.6, envFn: ahr(0.002, dur * 0.6, dur * 0.15), R, amp });
}
const st = (mono, sr, o) => reverb(mono, sr, o);

// ---------------------------------------------------------------- Menü

export const UI_RECIPES = {
  hover: (sr, R, v) => {
    const d = buf(sr, 0.06), f = [2400, 2620, 2830][v % 3];
    sine(d, sr, 0, 0.05, () => f, ad(0.001, 0.011));
    click(d, sr, 0, { dur: 0.002, tau: 0.0004, hp: 6000, amp: 0.15, R });
    return normalize(d, 0.32);
  },
  click: (sr, R) => {
    const d = buf(sr, 0.09);
    click(d, sr, 0, { dur: 0.003, tau: 0.0012, hp: 2500, amp: 0.6, R });
    sine(d, sr, 0, 0.06, expGlide(1250, 880, 0.03), ad(0.001, 0.018));
    sine(d, sr, 0, 0.05, () => 180, t => ad(0.001, 0.014)(t) * 0.3);
    return normalize(d, 0.5);
  },
  toggle: (sr) => {
    const d = buf(sr, 0.13);
    sine(d, sr, 0, 0.05, () => 1600, ad(0.001, 0.014));
    sine(d, sr, 0.045, 0.06, () => 2150, ad(0.001, 0.016));
    return normalize(d, 0.45);
  },
  confirm: (sr, R) => {
    const d = buf(sr, 0.5);
    fmBell(d, sr, 0, 660, 0.3, 0.8, { ratio: 2, index: 0.8, tau: 0.08 });
    fmBell(d, sr, 0.07, 990, 0.4, 1, { ratio: 2, index: 0.9, tau: 0.14 });
    burst(d, sr, 0.06, { dur: 0.15, type: 'highpass', freq: 6000, envFn: bell(0.15, 0.2), R, amp: 0.05 });
    return normalize(d, 0.55);
  },
  back: (sr) => {
    const d = buf(sr, 0.35);
    fmBell(d, sr, 0, 880, 0.25, 0.8, { ratio: 2, index: 0.6, tau: 0.06 });
    fmBell(d, sr, 0.06, 587, 0.3, 0.9, { ratio: 2, index: 0.6, tau: 0.1 });
    return normalize(d, 0.45);
  },
  error: (sr) => {
    const d = buf(sr, 0.3);
    blip(d, sr, 0, 220, 0.08, 0.8, true); blip(d, sr, 0.11, 196, 0.1, 0.8, true);
    return normalize(d, 0.45);
  },
};

// ---------------------------------------------------------------- Feedback & Stinger

export const FEEDBACK = {
  hitmarker: (sr, R) => {
    const d = buf(sr, 0.08);
    click(d, sr, 0, { dur: 0.003, tau: 0.0009, hp: 3000, amp: 1, R });
    sine(d, sr, 0, 0.06, () => R.range(1950, 2150), t => ad(0.0005, 0.016)(t) * 0.5);
    sine(d, sr, 0, 0.03, () => 4100, t => ad(0.0003, 0.007)(t) * 0.2);
    sine(d, sr, 0, 0.04, () => 620, t => ad(0.001, 0.01)(t) * 0.25);
    return normalize(d, 0.75);
  },
  hitmarker_kill: (sr, R) => {
    const d = buf(sr, 0.22);
    click(d, sr, 0, { dur: 0.004, tau: 0.001, hp: 2500, amp: 1, R });
    sine(d, sr, 0, 0.1, () => R.range(1450, 1550), t => ad(0.0005, 0.03)(t) * 0.5);
    sine(d, sr, 0, 0.18, expGlide(240, 140, 0.05), t => ad(0.001, 0.05)(t) * 0.75);
    burst(d, sr, 0, { dur: 0.06, type: 'lowpass', freq: 1200, envFn: ad(0.001, 0.018), R, amp: 0.4 });
    modal(d, sr, 0.002, [[3000, 1, 0.05], [4700, 0.5, 0.03]], 0.22, R);
    drive(d, 1.5);
    return normalize(d, 0.9);
  },
  headshot: (sr, R) => {
    const d = buf(sr, 1.0), j = () => R.range(0.98, 1.02);
    click(d, sr, 0, { dur: 0.003, tau: 0.0008, hp: 4000, amp: 0.6, R });
    modal(d, sr, 0, [[2900 * j(), 1, 0.3], [4450 * j(), 0.6, 0.2], [6900 * j(), 0.35, 0.12], [9200 * j(), 0.2, 0.07]], 0.5, R);
    sine(d, sr, 0, 0.12, expGlide(300, 160, 0.04), t => ad(0.001, 0.03)(t) * 0.35);
    return normalize(d, 0.85);
  },
  medal: (sr, R) => {
    const d = buf(sr, 0.9);
    fmBell(d, sr, 0, 1318.5, 0.6, 0.8, { ratio: 3.01, index: 1.6, tau: 0.2 });
    fmBell(d, sr, 0.09, 1975.5, 0.8, 1, { ratio: 3.01, index: 1.6, tau: 0.3 });
    for (let k = 0; k < 4; k++) fmBell(d, sr, 0.16 + k * 0.045, mtof(96 + [0, 4, 7, 12][k]), 0.25, 0.18, { ratio: 2, index: 0.5, tau: 0.06 });
    return normalize(st(d, sr, { size: 0.8, decay: 0.8, wet: 0.22, extra: 1 }), 0.8);
  },
  *levelup(sr, R) {
    const d = buf(sr, 2.6);
    const notes = [62, 66, 69, 74]; // D-Dur aufwärts
    notes.forEach((m, k) => brass(d, sr, k * 0.11, mtof(m), 0.18, 0.5, { attack: 0.015, cutoff: 3200 }));
    yield;
    for (const m of [50, 62, 66, 69, 74, 78]) { brass(d, sr, 0.46, mtof(m), 1.3, 0.28, { attack: 0.06, cutoff: 2600, vib: 0.006, release: 0.8 }); yield; }
    sine(d, sr, 0.46, 1.2, expGlide(90, 45, 0.3), t => ad(0.003, 0.3)(t) * 0.9);
    for (let k = 0; k < 8; k++) fmBell(d, sr, 0.5 + k * 0.07, mtof(86 + [0, 4, 7, 12, 16, 19, 24, 28][k]), 0.4, 0.12, { ratio: 2, index: 0.6, tau: 0.12 });
    burst(d, sr, 0.35, { dur: 1.5, type: 'highpass', freq: 7000, envFn: bell(1.5, 0.15), R, amp: 0.08 });
    yield;
    return normalize(yield* reverbSteps(d, sr, { size: 1.1, decay: 0.84, wet: 0.25, extra: 1.6 }), 0.85);
  },
  streak_ready: (sr, R) => {
    const d = buf(sr, 0.8);
    squelch(d, sr, 0, R);
    blip(d, sr, 0.08, 1320, 0.07, 0.8, true); blip(d, sr, 0.19, 1320, 0.07, 0.8, true); blip(d, sr, 0.3, 1760, 0.14, 0.9, true);
    burst(d, sr, 0.05, { dur: 0.55, type: 'bandpass', freq: 2500, q: 0.4, envFn: () => 1, R, amp: 0.05 });
    squelch(d, sr, 0.5, R, 0.08, 0.3);
    radio(d, sr);
    return normalize(d, 0.75);
  },
  uav: (sr, R) => {
    const d = buf(sr, 2.6);
    burst(d, sr, 0, { dur: 0.7, type: 'bandpass', freqAt: expGlide(400, 3200, 0.65), q: 2, envFn: bell(0.7, 0.85), R, amp: 0.5 });
    [0, 0.35, 0.7].forEach((t, k) => fmBell(d, sr, 0.65 + t, 1450, 1.2, 0.8 / (1 + k * 1.5), { ratio: 1.5, index: 0.4, tau: 0.35 }));
    for (let k = 0; k < 10; k++) blip(d, sr, 0.8 + R() * 0.8, R.range(2000, 4200), 0.025, 0.15, true);
    sine(d, sr, 0.6, 1.6, () => 55, t => bell(1.6, 0.2)(t) * 0.3);
    return normalize(st(d, sr, { size: 1.2, decay: 0.85, wet: 0.3, extra: 1.2 }), 0.8);
  },
  uav_end: (sr) => {
    const d = buf(sr, 0.4);
    blip(d, sr, 0, 1450, 0.08, 0.7); blip(d, sr, 0.1, 970, 0.14, 0.7);
    return normalize(d, 0.5);
  },
  airstrike: (sr, R) => {
    // Jet-Überflug links → rechts mit Doppler + Funkbestätigung
    const T = 3.6, n = len(sr, T), L = new Float32Array(n), Rt = new Float32Array(n), peak = 1.3;
    const jet = new Float32Array(n), nz = white(n, R), saw = new Saw(sr);
    const dop = t => 1 + 0.35 * Math.tanh((peak - t) * 2.2);
    for (let i = 0; i < n; i++) { const t = i / sr; jet[i] = nz[i] * 0.7 + saw.tick(520 * dop(t)) * 0.18; }
    sweep(jet, sr, 'bandpass', t => 1300 * dop(t), 0.9);
    const rum = brown(n, R); filt(rum, sr, 'lowpass', 140, 0.7, 2);
    for (let i = 0; i < n; i++) jet[i] += rum[i] * 0.8;
    env(jet, sr, t => Math.exp(-((t - peak) ** 2) / (2 * (t < peak ? 0.55 : 0.8) ** 2)));
    for (let i = 0; i < n; i++) {
      const t = i / sr, p = (clamp((t - peak) / 1.2, -1, 1) + 1) * Math.PI / 4;
      L[i] = jet[i] * Math.cos(p); Rt[i] = jet[i] * Math.sin(p);
    }
    const r = buf(sr, 0.5); squelch(r, sr, 0, R); blip(r, sr, 0.07, 1200, 0.08, 0.7, true); blip(r, sr, 0.17, 1600, 0.1, 0.7, true); radio(r, sr);
    mix(L, r, 0, 0.35); mix(Rt, r, 0, 0.35);
    return normalize([L, Rt], 0.85);
  },
  sentry: (sr, R) => {
    const d = buf(sr, 1.3);
    sine(d, sr, 0, 0.3, expGlide(200, 110, 0.03), ad(0.002, 0.05));
    burst(d, sr, 0, { dur: 0.08, type: 'lowpass', freq: 800, envFn: ad(0.001, 0.02), R, amp: 0.5 });
    const n = len(sr, 0.55), sv = new Float32Array(n), saw = new Saw(sr);
    for (let i = 0; i < n; i++) { const t = i / sr; sv[i] = saw.tick(300 + 220 * (t / 0.55)) * (0.6 + 0.4 * Math.sin(TAU * 42 * t)); }
    filt(sv, sr, 'bandpass', 1200, 0.9); env(sv, sr, bell(0.55, 0.5));
    mixAt(d, sr, sv, 0.15, 0.7);
    modal(d, sr, 0.72, [[1600, 1, 0.03], [2550, 0.6, 0.02], [900, 0.5, 0.08]], 0.5, R);
    click(d, sr, 0.72, { dur: 0.004, tau: 0.001, hp: 1500, amp: 0.6, R });
    blip(d, sr, 0.86, 2000, 0.05, 0.4); blip(d, sr, 0.96, 2000, 0.05, 0.4);
    return normalize(d, 0.8);
  },
  capture: (sr, R) => {
    const d = buf(sr, 1.2);
    squelch(d, sr, 0, R, 0.04, 0.2);
    [880, 1174.7, 1480].forEach((f, k) => fmBell(d, sr, 0.04 + k * 0.1, f, 0.7, 0.7, { ratio: 2, index: 1, tau: 0.22 }));
    return normalize(st(d, sr, { size: 0.9, decay: 0.8, wet: 0.2, extra: 0.8 }), 0.75);
  },
  capture_lost: (sr) => {
    const d = buf(sr, 1.1);
    [987.8, 784, 587.3].forEach((f, k) => blip(d, sr, k * 0.12, f, 0.16, 0.7, true));
    sine(d, sr, 0.3, 0.6, () => 110, t => bell(0.6, 0.2)(t) * 0.3);
    return normalize(st(d, sr, { size: 0.9, decay: 0.78, wet: 0.2, extra: 0.6 }), 0.7);
  },
  countdown: (sr, R) => {
    const d = buf(sr, 0.35);
    sine(d, sr, 0, 0.25, () => 880, ahr(0.002, 0.07, 0.05));
    sine(d, sr, 0, 0.2, () => 1760, t => ahr(0.002, 0.04, 0.03)(t) * 0.25);
    click(d, sr, 0, { dur: 0.003, tau: 0.0008, hp: 3000, amp: 0.3, R });
    return normalize(d, 0.6);
  },
  *go(sr, R) {
    const d = buf(sr, 1.1);
    for (const m of [62, 69, 74, 78]) { brass(d, sr, 0.08, mtof(m), 0.22, 0.3, { attack: 0.006, cutoff: 3800, release: 0.4 }); yield; }
    burst(d, sr, 0, { dur: 0.12, type: 'bandpass', freqAt: expGlide(600, 4000, 0.1), q: 1, envFn: bell(0.12, 0.9), R, amp: 0.4 });
    sine(d, sr, 0.08, 0.5, expGlide(110, 50, 0.12), t => ad(0.002, 0.14)(t) * 0.9);
    click(d, sr, 0.08, { dur: 0.004, tau: 0.001, hp: 2000, amp: 0.5, R });
    return normalize(yield* reverbSteps(d, sr, { size: 1, decay: 0.8, wet: 0.2, extra: 0.8 }), 0.85);
  },
  *win(sr, R) {
    const d = buf(sr, 3.6);
    sine(d, sr, 0, 1.5, expGlide(90, 40, 0.3), t => ad(0.003, 0.5)(t) * 1.0);
    sine(d, sr, 0.3, 1.2, expGlide(80, 40, 0.3), t => ad(0.003, 0.4)(t) * 0.7);
    for (const m of [50, 57, 62, 66, 69, 74]) { brass(d, sr, 0.02, mtof(m), 2.0, 0.22, { attack: 0.35, cutoff: 3000, vib: 0.005, release: 1.2 }); yield; }
    [74, 78, 81, 86].forEach((m, k) => fmBell(d, sr, 0.3 + k * 0.12, mtof(m), 1.4, 0.25, { ratio: 3.01, index: 1.2, tau: 0.45 }));
    yield;
    return normalize(yield* reverbSteps(d, sr, { size: 1.2, decay: 0.86, wet: 0.28, extra: 2 }), 0.85);
  },
  *lose(sr, R) {
    const d = buf(sr, 3.8);
    sine(d, sr, 0, 1.6, expGlide(70, 36, 0.4), t => ad(0.004, 0.6)(t) * 0.9);
    for (const m of [38, 50, 53, 57]) { brass(d, sr, 0.02, mtof(m), 2.2, 0.25, { attack: 0.5, cutoff: 1100, detune: 0.01, release: 1.2 }); yield; }
    sine(d, sr, 0.4, 2.4, t => mtof(69) * Math.pow(2, -t / 2.4 * 5 / 12), t => bell(2.4, 0.15)(t) * 0.18);
    const g = brown(len(sr, 3), R); filt(g, sr, 'lowpass', 120, 0.7); env(g, sr, bell(3, 0.3)); mix(d, g, 0, 0.6);
    drive(d, 1.4);
    yield;
    return normalize(yield* reverbSteps(d, sr, { size: 1.3, decay: 0.87, wet: 0.3, extra: 2 }), 0.82);
  },
  *draw(sr) {
    const d = buf(sr, 3);
    for (const m of [50, 57, 62, 67, 69]) { brass(d, sr, 0.02, mtof(m), 1.6, 0.22, { attack: 0.4, cutoff: 1800, release: 1 }); yield; }
    return normalize(yield* reverbSteps(d, sr, { size: 1.1, decay: 0.84, wet: 0.26, extra: 1.6 }), 0.78);
  },
  spawn: (sr, R) => {
    const d = buf(sr, 0.6);
    squelch(d, sr, 0, R, 0.05, 0.2);
    blip(d, sr, 0.06, 990, 0.06, 0.5, true); blip(d, sr, 0.14, 1320, 0.08, 0.5, true);
    radio(d, sr);
    const c = buf(sr, 0.4); burst(c, sr, 0, { dur: 0.3, type: 'bandpass', freq: 1100, q: 0.5, envFn: bell(0.3, 0.4), R, amp: 0.3 });
    mix(d, c, len(sr, 0.15), 1);
    return normalize(d, 0.5);
  },
  tinnitus: (sr) => {
    const d = buf(sr, 3.6);
    sine(d, sr, 0, 3.5, () => 3720, ahr(0.03, 0.3, 1.0));
    sine(d, sr, 0, 3.5, () => 3795, t => ahr(0.03, 0.3, 0.8)(t) * 0.5);
    return normalize(d, 0.5);
  },
};
