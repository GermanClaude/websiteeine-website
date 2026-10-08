// Karten-Atmosphären: nahtlose Stereo-Schleifen (als Generatoren, damit sie in Häppchen rendern)
// plus zufällig gestreute Einzelereignisse (Möwen, Schiffshorn, Hunde, Tropfen, Vögel …).
import {
  TAU, len, buf, white, pink, brown, filt, sweep, sweepSteps, expGlide, env, ad, ahr, bell, mix, mixAt, drive, normalize,
  sine, modal, metalModes, click, burst, grains, glottal, formant, reverb, reverbSteps, echoes, panMix, wrapLoop, Saw, clamp, lerp,
} from './dsp.js';

// Abtastraten nach gemessener Bandbreite (Anteil oberhalb 0,45 · Rate ≤ ca. −40 dB)
export const BED_RATE = { harbor: 16000, desert: 22050, industrial: 16000, range: 22050 };
export const EVENT_RATE = {
  amb_gull: 22050, amb_horn: 16000, amb_creak: 16000, amb_clank: 16000, amb_dog: 16000, amb_chime: 24000, amb_flap: 22050, amb_moped: 16000,
  amb_drip: 16000, amb_steam: 32000, amb_groan: 16000, amb_arc: 32000, amb_bird: 22050, amb_crow: 16000, amb_pa: 16000, loop_drone: 24000,
  amb_bell: 22050,
};
export const MAP_AMBIENCE = { hafen: 'harbor', altstadt: 'desert', werk: 'industrial', range: 'range', grenzland: 'range' };

/** Weich interpolierte Zufallskurve (Kosinus) mit Stützstellen alle step Sekunden. */
function smoothRandom(R, T, step, lo, hi) {
  const pts = Array.from({ length: Math.ceil(T / step) + 2 }, () => R.range(lo, hi));
  return t => {
    const x = clamp(t / step, 0, pts.length - 2), i = Math.floor(x), f = x - i, g = (1 - Math.cos(f * Math.PI)) / 2;
    return pts[i] * (1 - g) + pts[i + 1] * g;
  };
}

function* wind(L, Rt, sr, R, T, { lo = 250, hi = 1100, amp = 0.5, gust = [0.2, 1] }) {
  for (const ch of [L, Rt]) {
    const n = ch.length, w = white(n, R), fr = smoothRandom(R, T, 1.7, lo, hi), g = smoothRandom(R, T, 2.3, gust[0], gust[1]);
    yield* sweepSteps(w, sr, 'bandpass', fr, 0.9);
    env(w, sr, g);
    mix(ch, w, 0, amp);
    yield;
  }
}

// ---------------------------------------------------------------- Schleifen

const BEDS = {
  *harbor(sr, R) {
    const T = 20, X = 1, n = len(sr, T + X), L = new Float32Array(n), Rt = new Float32Array(n);
    for (const [ch, ph] of [[L, 0], [Rt, 1.7]]) { // Meeresrauschen
      const w = pink(n, R); filt(w, sr, 'lowpass', 420, 0.7, 2);
      env(w, sr, t => 0.55 + 0.3 * Math.sin(TAU * 0.07 * t + ph) + 0.15 * Math.sin(TAU * 0.13 * t + ph * 2));
      mix(ch, w, 0, 0.9); yield;
    }
    let t = 0.2, k = 0; // Wellenschlag an der Kaimauer
    while (t < T + X - 0.4) {
      const dur = R.range(0.35, 0.85), c = buf(sr, dur);
      burst(c, sr, 0, { dur, type: 'bandpass', freqAt: expGlide(R.range(700, 1100), R.range(330, 480), dur), q: 1.2, envFn: bell(dur, 0.22), R, amp: 1, color: 'pink' });
      for (let b = 0; b < 3; b++) { const f = R.range(300, 700); sine(c, sr, R.range(0.05, dur - 0.05), 0.03, x => f * (1 + x * 25), x => ad(0.002, 0.008)(x) * 0.12); }
      panMix(L, Rt, c, Math.round(t * sr), R.bi() * 0.7, R.range(0.25, 0.6));
      t += R.range(0.45, 1.5); if (++k % 3 === 0) yield;
    }
    yield* wind(L, Rt, sr, R, T + X, { lo: 400, hi: 900, amp: 0.12 });
    const eng = brown(n, R); filt(eng, sr, 'lowpass', 95, 0.7, 2); // ferner Schiffsdiesel
    sine(eng, sr, 0, T + X, () => 47, x => 0.02 * (1 + 0.5 * Math.sin(TAU * 0.4 * x)));
    mix(L, eng, 0, 0.35); mix(Rt, eng, 0, 0.35); yield;
    for (let c = 0; c < 6; c++) { // Takelage-Klimpern
      const d = buf(sr, 0.6); modal(d, sr, 0, metalModes(R.range(1800, 2600), R, { count: 3, decay: 0.15 }), 1, R);
      panMix(L, Rt, d, len(sr, R.range(0, T)), R.bi(), 0.02);
    }
    return wrapLoop([L, Rt], n, len(sr, X));
  },
  *desert(sr, R) {
    const T = 20, X = 1, n = len(sr, T + X), L = new Float32Array(n), Rt = new Float32Array(n);
    yield* wind(L, Rt, sr, R, T + X, { lo: 280, hi: 1300, amp: 0.45, gust: [0.12, 1] });
    // Marktgemurmel: rauschangeregte Formanten mit Silbenrhythmus, weit entfernt
    const crowd = new Float32Array(n);
    for (let v = 0; v < 7; v++) {
      const src = white(n, R), vo = glottal(n, sr, smoothRandom(R, T + X, 0.4, 110, 230), R, { jitter: 0.04 });
      for (let i = 0; i < n; i++) src[i] = src[i] * 0.5 + vo[i] * 0.8;
      yield;
      yield* sweepSteps(src, sr, 'bandpass', smoothRandom(R, T + X, 0.17, 450, 1700), 3);
      const rate = R.range(3.5, 5.5), on = smoothRandom(R, T + X, 1.6, -0.4, 1);
      env(src, sr, x => Math.max(0, Math.sin(TAU * rate * x + v)) ** 2 * clamp(on(x)));
      mix(crowd, src, 0, R.range(0.6, 1));
      yield;
    }
    filt(crowd, sr, 'lowpass', 1500, 0.7, 2); filt(crowd, sr, 'highpass', 180, 0.7); yield;
    const [cl, cr] = yield* reverbSteps(crowd, sr, { size: 1.2, decay: 0.8, wet: 0.5, dry: 0.6, extra: 0 });
    mix(L, cl, 0, 0.18); mix(Rt, cr, 0, 0.18); yield;
    for (const [ch, ph] of [[L, 0], [Rt, 2]]) { // Zikaden in der Mittagshitze
      const c = white(n, R); filt(c, sr, 'bandpass', 4600, 6, 2);
      env(c, sr, x => (0.5 + 0.5 * Math.sin(TAU * 46 * x)) * (0.5 + 0.5 * Math.sin(TAU * 0.05 * x + ph)) ** 2);
      mix(ch, c, 0, 0.5); yield;
    }
    const tr = brown(n, R); filt(tr, sr, 'lowpass', 180, 0.7, 2);
    mix(L, tr, 0, 0.25); mix(Rt, tr, 0, 0.25);
    return wrapLoop([L, Rt], n, len(sr, X));
  },
  *industrial(sr, R) {
    const T = 19.2, X = 1, n = len(sr, T + X), L = new Float32Array(n), Rt = new Float32Array(n);
    const hum = new Float32Array(n);
    for (const [f, a] of [[50, 0.5], [100, 0.35], [150, 0.2], [200, 0.12], [250, 0.06]]) { sine(hum, sr, 0, T + X, () => f, x => a * (1 + 0.12 * Math.sin(TAU * (3 / 19.2) * x))); yield; }
    const bz = new Float32Array(n), saw = new Saw(sr);
    for (let i = 0; i < n; i++) bz[i] = Math.tanh(saw.tick(100) * 3);
    filt(bz, sr, 'bandpass', 1200, 1);
    mix(hum, bz, 0, 0.05); yield;
    mix(L, hum, 0, 0.22); mix(Rt, hum, 0, 0.2); yield;
    for (const ch of [L, Rt]) { // Lüftung
      const v = pink(n, R), v2 = v.slice();
      filt(v, sr, 'bandpass', 180, 0.7); filt(v2, sr, 'bandpass', 900, 1);
      mix(ch, v, 0, 0.9); mix(ch, v2, 0, 0.12); yield;
    }
    const press = new Float32Array(n); // ferne Presse, exakt periodisch (1,6 s)
    for (let t = 0; t < T + X - 0.1; t += 1.6) {
      sine(press, sr, t, 0.8, expGlide(80, 52, 0.04), ad(0.003, 0.12));
      burst(press, sr, t, { dur: 0.2, type: 'lowpass', freq: 300, envFn: ad(0.002, 0.04), R, amp: 0.5 });
      modal(press, sr, t + 0.05, [[310, 1, 0.25], [520, 0.7, 0.18], [870, 0.5, 0.12], [1300, 0.3, 0.08]], 0.25, R);
    }
    yield;
    const [pl, pr] = yield* reverbSteps(press, sr, { size: 1.5, decay: 0.86, wet: 0.6, dry: 0.4, extra: 0 });
    mix(L, pl, 0, 0.32); mix(Rt, pr, 0, 0.32); yield;
    const rat = new Float32Array(n); // Förderband-Rattern
    grains(rat, sr, 0, { dur: T + X, count: 900, grainDur: [0.001, 0.003], freq: [900, 3000], q: 2, amp: 0.3, R });
    env(rat, sr, x => 0.4 + 0.6 * Math.max(0, Math.sin(TAU * 6 * x)));
    filt(rat, sr, 'lowpass', 2000, 0.7);
    mix(L, rat, 0, 0.12); mix(Rt, rat, 0, 0.08);
    return wrapLoop([L, Rt], n, len(sr, X));
  },
  *range(sr, R) {
    const T = 20, X = 1, n = len(sr, T + X), L = new Float32Array(n), Rt = new Float32Array(n);
    yield* wind(L, Rt, sr, R, T + X, { lo: 300, hi: 800, amp: 0.25, gust: [0.15, 0.8] });
    for (const ch of [L, Rt]) { // Blätterrauschen
      const lv = white(n, R); filt(lv, sr, 'highpass', 2500, 0.7); filt(lv, sr, 'lowpass', 7000, 0.7);
      const g = smoothRandom(R, T + X, 0.12, 0, 1), g2 = smoothRandom(R, T + X, 3, 0, 1);
      env(lv, sr, x => g(x) ** 2 * g2(x));
      mix(ch, lv, 0, 0.12); yield;
    }
    const lo = brown(n, R); filt(lo, sr, 'lowpass', 120, 0.7, 2);
    mix(L, lo, 0, 0.15); mix(Rt, lo, 0, 0.15);
    return wrapLoop([L, Rt], n, len(sr, X));
  },
};

export function* ambienceBed(id, sr, R) {
  const chs = yield* (BEDS[id] || BEDS.range)(sr, R);
  for (const c of chs) filt(c, sr, 'highpass', 25, 0.7);
  return normalize(chs, 0.7);
}

// ---------------------------------------------------------------- Einzelereignisse

export const AMB_EVENTS = {
  amb_gull: (sr, R) => {
    const calls = 2 + Math.floor(R() * 3), d = buf(sr, calls * 0.45 + 0.8);
    for (let c = 0; c < calls; c++) {
      const t0 = c * R.range(0.32, 0.45), T = R.range(0.22, 0.38), f0 = R.range(1500, 1900), fp = R.range(2300, 2900), f1 = R.range(1200, 1500);
      const n = len(sr, T), x = new Float32Array(n); let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, u = t / T, f = u < 0.25 ? lerp(f0, fp, u / 0.25) : lerp(fp, f1, (u - 0.25) / 0.75);
        ph += TAU * f / sr; x[i] = Math.tanh(Math.sin(ph) * 2.5 + Math.sin(ph * 2) * 0.5) * bell(T, 0.2)(t);
      }
      filt(x, sr, 'bandpass', 2400, 0.8);
      mixAt(d, sr, x, t0, 1);
    }
    return normalize(reverb(d, sr, { size: 1.3, decay: 0.75, wet: 0.25, extra: 0.8, stereo: false })[0], 0.8);
  },
  amb_horn: (sr, R) => {
    const T = 3.2, d = buf(sr, T + 1);
    for (const [f, a] of [[98, 1], [146.8, 0.7]]) {
      const n = len(sr, T + 1), x = new Float32Array(n), s1 = new Saw(sr, 0.1), s2 = new Saw(sr, 0.6);
      for (let i = 0; i < n; i++) { const t = i / sr, v = 1 + 0.004 * Math.sin(TAU * 4.5 * t); x[i] = (s1.tick(f * v) + s2.tick(f * v * 1.004)) * 0.5; }
      filt(x, sr, 'lowpass', 900, 0.9); filt(x, sr, 'peaking', 350, 1, 1, 5);
      env(x, sr, t => (t < 0.3 ? t / 0.3 : t < T ? 1 : Math.exp(-(t - T) / 0.25)));
      mix(d, x, 0, a);
    }
    drive(d, 1.8);
    const e = echoes(d, sr, [[0.9, 0.3, 500], [1.9, 0.15, 350]]);
    return normalize(reverb(e, sr, { size: 1.6, decay: 0.88, wet: 0.5, dry: 0.6, extra: 2, stereo: false })[0], 0.85);
  },
  amb_creak: (sr, R) => {
    const T = R.range(0.9, 1.6), d = buf(sr, T + 0.2), base = R.range(160, 300);
    const n = len(sr, T), x = new Float32Array(n), j = smoothRandom(R, T, 0.05, -1, 1); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * base * (1 + 0.25 * j(t)) / sr; x[i] = Math.tanh(Math.sin(ph) * 4) * bell(T, 0.4)(t); }
    filt(x, sr, 'bandpass', base * 3, 2);
    mix(d, x, 0, 1);
    return normalize(d, 0.6);
  },
  amb_clank: (sr, R) => {
    const d = buf(sr, 1.4);
    modal(d, sr, 0, [[R.range(100, 130), 1, 0.4], [R.range(260, 300), 0.7, 0.3], [R.range(500, 560), 0.5, 0.2], [R.range(830, 900), 0.3, 0.12]], 1, R);
    burst(d, sr, 0, { dur: 0.1, type: 'lowpass', freq: 600, envFn: ad(0.001, 0.03), R, amp: 0.6 });
    filt(d, sr, 'lowpass', 1800, 0.7);
    return normalize(echoes(d, sr, [[0.35, 0.3, 900], [0.8, 0.15, 600]]), 0.8);
  },
  amb_dog: (sr, R) => {
    const barks = 2 + Math.floor(R() * 3), d = buf(sr, barks * 0.35 + 1);
    const f0 = R.range(280, 420), vowel = R.pick(['a', 'o']);
    for (let b = 0; b < barks; b++) {
      const T = R.range(0.09, 0.15), n = len(sr, T);
      const src = glottal(n, sr, t => f0 * (1 - t / T * 0.35), R, { jitter: 0.06 });
      const nz = white(n, R); for (let i = 0; i < n; i++) src[i] = src[i] + nz[i] * 0.3;
      const x = formant(src, sr, vowel, { shift: 1.15 });
      env(x, sr, ad(0.008, T * 0.35)); drive(x, 2);
      mixAt(d, sr, x, b * R.range(0.22, 0.35), 1);
    }
    filt(d, sr, 'lowpass', 2000, 0.7);
    return normalize(reverb(d, sr, { size: 1.4, decay: 0.8, wet: 0.45, dry: 0.7, extra: 0.8, stereo: false })[0], 0.8);
  },
  amb_chime: (sr, R) => {
    const d = buf(sr, 3.2), scale = [0, 3, 5, 7, 10, 12];
    for (let k = 0, hits = 4 + Math.floor(R() * 4); k < hits; k++) {
      const f = 1046.5 * Math.pow(2, R.pick(scale) / 12);
      modal(d, sr, R.range(0, 1.4), [[f, 1, 0.9], [f * 2.76, 0.4, 0.4], [f * 5.4, 0.2, 0.2]], R.range(0.3, 0.7), R);
    }
    return normalize(d, 0.6);
  },
  // Kirchenglocke (Bronze, ≈ 1,6 m, Altstadt: Stundenschlag/Geläut aus world/maps/altstadt-glocke.js, nicht zufällig
  // gestreut): Teiltöne einer Moll-Terz-Glocke – Summton (Unteroktave), Prime, kleine Terz, Quinte, Nominal (Oktave,
  // bestimmt den Schlagton), darüber Dezime, Undezime, Duodezime, Doppeloktave. Jeder Teilton als Doppel (Schwebung
  // durch die Unrundheit des Gusses), tiefe lange, hohe kurz; dazu der Anschlag des Klöppels und Widerhall vom Platz.
  amb_bell: (sr, R) => {
    const T = 6.5, d = buf(sr, T), f1 = 164;
    for (const [r, a, tau] of [[0.5, 0.5, 4.2], [1, 0.42, 2.8], [1.19, 0.55, 2.4], [1.5, 0.18, 1.5], [2, 0.7, 2.0], [2.51, 0.26, 1.1], [2.67, 0.16, 0.9], [3.01, 0.2, 0.7], [4.03, 0.11, 0.45], [5.08, 0.06, 0.25]]) {
      const f = f1 * r * (1 + R.bi() * 0.002), beat = R.range(0.3, 1.3);
      modal(d, sr, 0.003, [[f, a * 0.62, tau], [f + beat, a * 0.38, tau * 0.92]], 1, R, T);
    }
    burst(d, sr, 0, { dur: 0.05, type: 'bandpass', freq: 2600, q: 0.9, envFn: ad(0.0008, 0.012), R, amp: 0.45 });
    modal(d, sr, 0, metalModes(R.range(1700, 1900), R, { count: 5, decay: 0.05, spread: 0.06, ratios: [1, 1.63, 2.42, 3.3, 4.6] }), 0.22, R);
    env(d, sr, t => (t > T - 1.2 ? ((T - t) / 1.2) ** 2 : 1));
    const e = echoes(d, sr, [[0.13, 0.22, 1800], [0.29, 0.12, 1200], [0.52, 0.06, 900]]);
    return normalize(reverb(e, sr, { size: 1.5, decay: 0.8, wet: 0.16, dry: 1, extra: 0.5, stereo: false })[0], 0.85);
  },
  amb_flap: (sr, R) => {
    const d = buf(sr, 1.2);
    for (let k = 0, m = 3 + Math.floor(R() * 4); k < m; k++)
      burst(d, sr, k * R.range(0.08, 0.16), { dur: 0.08, type: 'lowpass', freq: R.range(600, 1100), envFn: ad(0.003, 0.02), R, amp: R.range(0.5, 1) });
    return normalize(d, 0.6);
  },
  amb_moped: (sr, R) => {
    // Zweitakter fährt in der Ferne vorbei (Doppler)
    const T = 6, n = len(sr, T), x = new Float32Array(n), saw = new Saw(sr), pk = R.range(2.6, 3.4);
    for (let i = 0; i < n; i++) {
      const t = i / sr, dop = 1 + 0.06 * Math.tanh((pk - t) * 1.5), rpm = 95 + 30 * Math.sin(t * 0.7);
      x[i] = Math.tanh(saw.tick(rpm * dop) * 2.5) * (0.6 + 0.4 * Math.sin(TAU * 31 * t));
    }
    filt(x, sr, 'bandpass', 900, 0.8); filt(x, sr, 'lowpass', 2200, 0.7);
    env(x, sr, t => Math.exp(-((t - pk) ** 2) / 2.2));
    return normalize(x, 0.7);
  },
  amb_drip: (sr, R) => {
    const d = buf(sr, 0.15);
    const f0 = R.range(900, 1300), f1 = f0 * R.range(1.8, 2.4);
    sine(d, sr, 0, 0.06, t => f0 * Math.pow(f1 / f0, Math.min(1, t / 0.012)), ad(0.0008, 0.012));
    return normalize(reverb(d, sr, { size: 1.6, decay: 0.85, wet: 0.5, dry: 0.7, extra: 1.4, stereo: false })[0], 0.7);
  },
  amb_steam: (sr, R) => {
    const T = R.range(0.8, 1.6), d = buf(sr, T + 0.3);
    burst(d, sr, 0, { dur: T, type: 'highpass', freq: R.range(2000, 3000), envFn: ahr(0.05, T - 0.45, 0.12), R, amp: 1 });
    burst(d, sr, 0, { dur: T, type: 'bandpass', freq: 6500, q: 1, envFn: ahr(0.05, T - 0.45, 0.12), R, amp: 0.4 });
    return normalize(d, 0.6);
  },
  amb_groan: (sr, R) => {
    const T = R.range(1.5, 2.4), n = len(sr, T), x = new Float32Array(n), j = smoothRandom(R, T, 0.08, -1, 1), f = R.range(65, 110); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * f * (1 + 0.08 * j(t)) / sr; x[i] = Math.tanh((Math.sin(ph) + 0.4 * Math.sin(ph * 2.7)) * 3) * bell(T, 0.35)(t); }
    filt(x, sr, 'lowpass', 900, 0.8);
    return normalize(reverb(x, sr, { size: 1.5, decay: 0.84, wet: 0.45, dry: 0.7, extra: 1.2, stereo: false })[0], 0.75);
  },
  amb_arc: (sr, R) => {
    const T = R.range(0.4, 0.8), d = buf(sr, T + 0.1);
    for (let k = 0; k < 40; k++) click(d, sr, R() * T, { dur: 0.003, tau: 0.0006, hp: 1500, amp: R.range(0.2, 1), R });
    const bz = buf(sr, T), saw = new Saw(sr);
    for (let i = 0; i < bz.length; i++) bz[i] = saw.tick(120) * (R() < 0.3 ? 1 : 0.2);
    filt(bz, sr, 'bandpass', 3000, 1.5); env(bz, sr, bell(T, 0.3));
    mix(d, bz, 0, 0.4);
    return normalize(d, 0.65);
  },
  amb_bird: (sr, R) => {
    const d = buf(sr, 2.2), notes = 6 + Math.floor(R() * 9); let t = 0;
    const base = R.range(3000, 4500), style = R() * 3 | 0;
    for (let k = 0; k < notes; k++) {
      const T = R.range(0.04, 0.11), f0 = base * R.range(0.8, 1.35), f1 = f0 * (style === 0 ? R.range(1.2, 1.5) : style === 1 ? R.range(0.6, 0.8) : R.range(0.9, 1.1));
      sine(d, sr, t, T, x => f0 * Math.pow(f1 / f0, x / T) * (1 + 0.04 * Math.sin(x * 400)), bell(T, 0.3));
      t += T + R.range(0.02, 0.09); if (t > 1.9) break;
    }
    return normalize(d, 0.6);
  },
  amb_crow: (sr, R) => {
    const caws = 2 + Math.floor(R() * 2), d = buf(sr, caws * 0.55 + 0.6);
    for (let c = 0; c < caws; c++) {
      const T = R.range(0.22, 0.32), n = len(sr, T);
      const src = glottal(n, sr, t => R.range(480, 520) * (1 - t * 0.6), R, { jitter: 0.12, shimmer: 0.3 });
      const nz = white(n, R); for (let i = 0; i < n; i++) src[i] += nz[i] * 0.5;
      const x = formant(src, sr, 'a', { shift: 1.4 }); env(x, sr, bell(T, 0.2)); drive(x, 3);
      mixAt(d, sr, x, c * R.range(0.4, 0.55), 1);
    }
    filt(d, sr, 'lowpass', 3000, 0.7);
    return normalize(reverb(d, sr, { size: 1.3, decay: 0.75, wet: 0.35, extra: 0.6, stereo: false })[0], 0.7);
  },
  amb_pa: (sr, R) => {
    const d = buf(sr, 1.6);
    [[784, 0], [988, 0.32], [1175, 0.64]].forEach(([f, t]) => sine(d, sr, t, 0.5, () => f, ahr(0.01, 0.15, 0.12)));
    filt(d, sr, 'bandpass', 1200, 0.6); drive(d, 2);
    return normalize(echoes(reverb(d, sr, { size: 1.6, decay: 0.8, wet: 0.5, dry: 0.6, extra: 1, stereo: false })[0], sr, [[0.42, 0.3, 1500]]), 0.7);
  },
  loop_drone: (sr, R) => {
    // Drohnen-Summen als nahtlose Schleife (Dev-Orbit, auch für Spielobjekte nutzbar)
    const T = 2, n = len(sr, T), d = new Float32Array(n), s1 = new Saw(sr), s2 = new Saw(sr, 0.3);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (s1.tick(180) + s2.tick(181.5 + 2 * Math.sin(TAU * 0.5 * t))) * 0.5; }
    filt(d, sr, 'lowpass', 1800, 1.2);
    const nz = white(n, R); filt(nz, sr, 'bandpass', 2400, 1); mix(d, nz, 0, 0.15);
    return normalize(d, 0.7);
  },
};

/** Ereignisplan pro Atmosphäre. dist = Entfernung (m), vol = Lautstärke, every = Intervall (s). */
export const AMBIENCES = {
  harbor: {
    name: 'Hafen', space: 'harbor', events: [
      { name: 'amb_gull', every: [5, 14], vol: [0.3, 0.6], dist: [25, 70], height: [8, 30], first: [1, 4] },
      { name: 'amb_horn', every: [45, 90], vol: [0.55, 0.75], dist: [160, 260], height: [0, 5], first: [10, 20] },
      { name: 'amb_creak', every: [10, 26], vol: [0.2, 0.4], dist: [15, 40], height: [0, 12] },
      { name: 'amb_clank', every: [14, 32], vol: [0.25, 0.45], dist: [40, 90], height: [0, 10] },
    ],
  },
  desert: {
    name: 'Altstadt', space: 'desert', events: [
      { name: 'amb_dog', every: [12, 30], vol: [0.25, 0.5], dist: [50, 120], height: [0, 4], first: [4, 9] },
      { name: 'amb_chime', every: [16, 40], vol: [0.2, 0.35], dist: [15, 35], height: [2, 6] },
      { name: 'amb_flap', every: [6, 16], vol: [0.25, 0.45], dist: [8, 25], height: [3, 6] },
      { name: 'amb_moped', every: [35, 70], vol: [0.25, 0.4], dist: [60, 120], height: [0, 2], first: [15, 30] },
    ],
  },
  industrial: {
    name: 'Werk', space: 'industrial', events: [
      { name: 'amb_drip', every: [1.5, 5], vol: [0.25, 0.5], dist: [6, 25], height: [2, 8] },
      { name: 'amb_steam', every: [14, 30], vol: [0.25, 0.4], dist: [15, 45], height: [1, 8] },
      { name: 'amb_groan', every: [18, 40], vol: [0.3, 0.5], dist: [30, 70], height: [5, 15] },
      { name: 'amb_arc', every: [20, 45], vol: [0.2, 0.35], dist: [20, 50], height: [3, 9] },
    ],
  },
  range: {
    name: 'Schießstand', space: 'range', events: [
      { name: 'amb_bird', every: [3, 9], vol: [0.25, 0.5], dist: [20, 50], height: [5, 15], first: [0.5, 2] },
      { name: 'amb_crow', every: [25, 60], vol: [0.25, 0.4], dist: [60, 120], height: [10, 30] },
      { name: 'amb_pa', every: [60, 120], vol: [0.3, 0.45], dist: [40, 80], height: [4, 8], first: [20, 40] },
      { name: 'gunfar_ar', every: [8, 22], vol: [0.12, 0.25], dist: [150, 300], height: [0, 2], burst: [1, 5], first: [3, 8] },
    ],
  },
};
