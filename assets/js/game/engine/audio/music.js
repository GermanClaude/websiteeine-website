// Lobby-/Menümusik: dunkel, angespannt, modern, 100 BPM, d-Moll (harmonisch).
// Sieben Stems à 8 Takte (19,2 s) werden synchron geloopt; ein Arrangement blendet sie taktgenau ein/aus.
import {
  TAU, len, buf, white, brown, filt, sweep, expGlide, env, ad, ahr, bell, mix, mixAt, drive, normalize,
  sine, click, burst, reverb, reverbSteps, wrapLoop, mtof, Saw, Square, clamp,
} from './dsp.js';

export const MUSIC_SR = 32000;
export const BPM = 100;
export const BEAT = 60 / BPM;            // 0,6 s
export const STEP = BEAT / 4;            // Sechzehntel
export const BARS = 8;
export const LOOP = BARS * 4 * BEAT;     // 19,2 s

const CHORDS = [ // je 2 Takte: Dm – B – Gm – A (harmonisch Moll → Spannung)
  { root: 38, pad: [50, 62, 65, 69], arp: [62, 65, 69, 74] },
  { root: 34, pad: [46, 62, 65, 70], arp: [62, 65, 70, 74] },
  { root: 31, pad: [43, 62, 67, 70], arp: [62, 67, 70, 74] },
  { root: 33, pad: [45, 61, 64, 69], arp: [61, 64, 69, 73] },
];
const chordAt = bar => CHORDS[Math.floor(bar / 2) % 4];
const frac = x => ((x % 1) + 1) % 1;

/** Sidechain-Pumpen auf jede Viertel (Kick-Gefühl), mit weichem 20-ms-Einsatz gegen Knackser. */
const pump = (depth = 0.45) => t => { const b = t % BEAT; return 1 - depth * Math.min(1, b / 0.02) * Math.exp(-b / 0.11) * 1.1; };

function finish(chs, sr, N) { return wrapLoop(Array.isArray(chs) ? chs : [chs], N); }

export const STEMS = {
  *drums(sr, R) {
    const N = len(sr, LOOP), d = new Float32Array(N + len(sr, 1.5)), snr = new Float32Array(d.length);
    for (let bar = 0; bar < BARS; bar++) {
      const t0 = bar * 4 * BEAT, kicks = bar % 4 === 3 ? [0, 7, 10, 14] : [0, 7, 10];
      for (const s of kicks) {
        const t = t0 + s * STEP;
        sine(d, sr, t, 0.6, expGlide(135, 44, 0.05), ad(0.001, 0.24));
        click(d, sr, t, { dur: 0.003, tau: 0.0006, hp: 3000, amp: 0.15, R });
      }
      // Snare/Clap auf 3 (Halftime)
      const ts = t0 + 8 * STEP;
      burst(snr, sr, ts, { dur: 0.35, type: 'bandpass', freq: 1900, q: 0.7, envFn: ad(0.001, 0.11), R, amp: 0.9 });
      burst(snr, sr, ts, { dur: 0.15, type: 'highpass', freq: 5000, envFn: ad(0.001, 0.05), R, amp: 0.4 });
      sine(snr, sr, ts, 0.2, expGlide(210, 170, 0.03), t => ad(0.001, 0.05)(t) * 0.6);
      if (bar % 4 === 1) burst(snr, sr, t0 + 15 * STEP, { dur: 0.1, type: 'bandpass', freq: 2000, q: 0.8, envFn: ad(0.001, 0.04), R, amp: 0.25 });
      // Hi-Hats (Sechzehntel, Wirbel am Ende von Takt 8)
      for (let s = 0; s < 16; s++) {
        const vel = [0.9, 0.35, 0.6, 0.35][s % 4] * R.range(0.85, 1), open = (s === 6 || s === 14) && bar % 2 === 1;
        burst(d, sr, t0 + s * STEP, { dur: open ? 0.25 : 0.06, type: 'highpass', freq: 7200, envFn: ad(0.0005, open ? 0.09 : 0.018), R, amp: vel * 0.32 });
      }
      if (bar === BARS - 1) for (let k = 0; k < 8; k++) burst(d, sr, t0 + 12 * STEP + k * STEP / 2, { dur: 0.04, type: 'highpass', freq: 7500, envFn: ad(0.0005, 0.012), R, amp: 0.12 + k * 0.03 });
      // Taiko-artige Toms in Takt 4 und 8
      if (bar % 4 === 3) for (const s of [12, 13.5]) {
        sine(d, sr, t0 + s * STEP, 0.6, expGlide(115, 72, 0.06), t => ad(0.002, 0.22)(t) * 0.7);
        burst(d, sr, t0 + s * STEP, { dur: 0.2, type: 'lowpass', freq: 600, envFn: ad(0.001, 0.05), R, amp: 0.3 });
      }
      yield;
    }
    const [sl] = reverb(snr, sr, { size: 1, decay: 0.78, wet: 0.25, dry: 1, extra: 0, stereo: false });
    yield;
    mix(d, sl, 0, 0.8);
    drive(d, 1.4);
    return normalize(finish(d, sr, N), 0.85);
  },
  *bass(sr, R) {
    const N = len(sr, LOOP), d = new Float32Array(N + len(sr, 0.5));
    const pat = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1], oct = [0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 12, 0];
    for (let bar = 0; bar < BARS; bar++) {
      const c = chordAt(bar);
      for (let s = 0; s < 16; s++) {
        if (!pat[s]) continue;
        const f = mtof(c.root + 12 + oct[s]), T = STEP * 0.95, n = len(sr, T + 0.05), x = new Float32Array(n);
        const sw = new Saw(sr, 0), sq = new Square(sr, 0.25);
        for (let i = 0; i < n; i++) x[i] = sw.tick(f) * 0.6 + sq.tick(f * 0.5) * 0.4;
        const acc = s % 4 === 0 ? 1 : 0.75;
        sweep(x, sr, 'lowpass', t => 140 + 1200 * acc * Math.exp(-t / 0.06), 2.2);
        env(x, sr, ahr(0.003, T * 0.6, 0.03));
        mixAt(d, sr, x, bar * 4 * BEAT + s * STEP, acc);
      }
      yield;
    }
    drive(d, 1.8);
    env(d, sr, pump(0.5));
    return normalize(finish(d, sr, N), 0.85);
  },
  *pad(sr, R) {
    const N = len(sr, LOOP), extra = len(sr, 1.6), L = new Float32Array(N + extra), Rt = new Float32Array(N + extra);
    for (let k = 0; k < 4; k++) {
      const c = CHORDS[k], t0 = k * 8 * BEAT, T = 8 * BEAT, n = len(sr, T + 1.5);
      for (const [ch, side] of [[L, -1], [Rt, 1]]) {
        const x = new Float32Array(n);
        for (const m of c.pad) {
          const f = mtof(m);
          for (const det of [-0.007, 0.0, 0.006]) {
            const o = new Saw(sr, frac(m * 0.13 + det * 50 + side * 0.21 + (det < 0 ? 0.5 : 0))), ff = f * (1 + det + side * 0.0015);
            for (let i = 0; i < n; i++) x[i] += o.tick(ff) * 0.12;
          }
          yield;
        }
        sweep(x, sr, 'lowpass', t => 700 + 600 * (0.5 + 0.5 * Math.sin(TAU * (2 / LOOP) * (t0 + t) + side)), 1.1);
        env(x, sr, t => (t < 0.9 ? t / 0.9 : t < T ? 1 : Math.exp(-(t - T) / 0.4)));
        mixAt(ch, sr, x, t0, 1);
        yield;
      }
    }
    for (const ch of [L, Rt]) env(ch, sr, pump(0.4));
    return normalize(finish([L, Rt], sr, N), 0.8);
  },
  *arp(sr, R) {
    const N = len(sr, LOOP), L = new Float32Array(N + len(sr, 2.5)), Rt = new Float32Array(L.length);
    const order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2];
    for (let bar = 0; bar < BARS; bar++) {
      const c = chordAt(bar);
      for (let s = 0; s < 16; s++) {
        const m = c.arp[order[(s + bar * 3) % 16]] + (s % 8 === 7 ? 12 : 0), f = mtof(m), T = 0.16, n = len(sr, T), x = new Float32Array(n);
        const sq = new Square(sr, 0, 0.3);
        for (let i = 0; i < n; i++) x[i] = sq.tick(f) * 0.5 + Math.sin(TAU * f * 2 * i / sr) * 0.2;
        sweep(x, sr, 'lowpass', t => 900 + 2600 * Math.exp(-t / 0.04), 1.5);
        env(x, sr, ad(0.002, 0.05));
        const at = Math.round((bar * 4 * BEAT + s * STEP) * sr), g = s % 4 === 0 ? 1 : 0.7;
        mix(L, x, at, g * 0.8); mix(Rt, x, at, g * 0.8);
        // Ping-Pong-Delay (punktierte Achtel = 0,45 s)
        mix(Rt, x, at + len(sr, 0.45), g * 0.38); mix(L, x, at + len(sr, 0.9), g * 0.2); mix(Rt, x, at + len(sr, 1.35), g * 0.1);
      }
      yield;
    }
    return normalize(finish([L, Rt], sr, N), 0.75);
  },
  *bells(sr, R) {
    const N = len(sr, LOOP), d = new Float32Array(N + len(sr, 3));
    const motif = [[81, 0, 1], [77, 7 * BEAT, 0.5], [79, 8 * BEAT, 0.9], [76, 14 * BEAT, 0.45], [74, 16 * BEAT, 0.9], [77, 22 * BEAT, 0.5], [73, 24 * BEAT, 1], [76, 30 * BEAT, 0.5]];
    for (const [m, t, a] of motif) {
      const f = mtof(m), T = 2.6, n = len(sr, T), x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const tt = i / sr, I = 2 * Math.exp(-tt / 0.3);
        x[i] = Math.sin(TAU * f * tt + I * Math.sin(TAU * f * 3.5 * tt)) * Math.exp(-tt / 0.8) * Math.min(1, tt / 0.003);
      }
      mixAt(d, sr, x, t, a);
      yield;
    }
    const [l, r] = yield* reverbSteps(d, sr, { size: 1.4, decay: 0.87, wet: 0.45, dry: 0.7, extra: 0 });
    return normalize(finish([l, r], sr, N), 0.7);
  },
  *drone(sr, R) {
    const N = len(sr, LOOP), n = N + len(sr, 1), d = new Float32Array(n), s1 = new Saw(sr), s2 = new Saw(sr, 0.5);
    for (let i = 0; i < n; i++) {
      const t = i / sr, trem = 0.8 + 0.2 * Math.sin(TAU * t / (LOOP / 4));
      d[i] = (Math.sin(TAU * 36.71 * t) * 0.8 + (s1.tick(73.42) + s2.tick(73.6)) * 0.25) * trem;
    }
    filt(d, sr, 'lowpass', 170, 0.8, 2);
    yield;
    const air = white(n, R);
    sweep(air, sr, 'bandpass', t => 500 + 400 * Math.sin(TAU * t / LOOP), 3);
    mix(d, air, 0, 0.25);
    // Startbereich mit dem überstehenden Ende verschmelzen (wrapLoop addiert, also vorher ausblenden)
    for (let i = N; i < n; i++) { const g = 1 - (i - N) / (n - N); d[i] *= g; d[i - N] *= 1 - g; }
    return normalize(finish(d, sr, N), 0.8);
  },
  *riser(sr, R) {
    // Steigerung in den Takten 7–8, endet exakt auf der Eins
    const N = len(sr, LOOP), d = new Float32Array(N), t0 = 6 * 4 * BEAT, T = LOOP - t0, n = len(sr, T);
    const x = white(n, R);
    sweep(x, sr, 'bandpass', expGlide(300, 6500, T), 1.4);
    sine(x, sr, 0, T, expGlide(180, 900, T), t => 0.15);
    env(x, sr, t => Math.pow(t / T, 2.4) * (t > T - 0.02 ? (T - t) / 0.02 : 1));
    mix(d, x, len(sr, t0), 1);
    yield;
    return normalize([d], 0.8);
  },
};

export const STEM_IDS = Object.keys(STEMS);
/** Abtastrate je Stem nach gemessener Bandbreite (dunkle Flächen brauchen weniger → schneller, kleiner). */
export const STEM_SR = { drums: 32000, bass: 16000, pad: 16000, arp: 22050, bells: 24000, drone: 16000, riser: 32000 };
export const STEM_GAIN = { drums: 0.62, bass: 0.55, pad: 0.42, arp: 0.24, bells: 0.3, drone: 0.4, riser: 0.22 };

/** Abschnitte à 8 Takte; nach dem letzten geht es ab LOOP_FROM weiter. */
export const ARRANGEMENT = [
  { drone: 1, pad: 0.8, bells: 0.7, riser: 0.6 },
  { drone: 1, pad: 1, bass: 1, riser: 1 },
  { drone: 0.8, pad: 1, bass: 1, drums: 1 },
  { drone: 0.8, pad: 1, bass: 1, drums: 1, arp: 1, bells: 0.6, riser: 1 },
  { drone: 1, pad: 0.9, arp: 1, bells: 1, riser: 1 },
  { drone: 0.8, pad: 1, bass: 1, drums: 1, arp: 1, bells: 0.5 },
];
export const LOOP_FROM = 2;

/** Spielt die Stems synchron und setzt Abschnitts-Lautstärken vorausschauend. */
export class MusicPlayer {
  constructor(ctx, out) { this.ctx = ctx; this.out = out; this.playing = false; this.nodes = []; this.timer = 0; }
  start(buffers, when = this.ctx.currentTime + 0.1) {
    this.stop(0);
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.out);
    this.master.gain.setValueAtTime(0, when); this.master.gain.linearRampToValueAtTime(1, when + 1.5);
    this.gains = {};
    for (const id of STEM_IDS) {
      const b = buffers[id]; if (!b) continue;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = b; src.loop = true; src.loopStart = 0; src.loopEnd = LOOP;
      g.gain.value = 0; src.connect(g).connect(this.master); src.start(when);
      this.gains[id] = g; this.nodes.push(src, g);
    }
    this.t0 = when; this.section = -1; this.playing = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 500);
  }
  /** Plant den nächsten Abschnitt, sobald er weniger als 1,5 s entfernt ist. */
  schedule() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    for (;;) {
      const next = this.section + 1, at = this.t0 + next * LOOP;
      if (at > now + 1.5) break;
      const idx = next < ARRANGEMENT.length ? next : LOOP_FROM + ((next - LOOP_FROM) % (ARRANGEMENT.length - LOOP_FROM));
      const sec = ARRANGEMENT[idx];
      for (const id of STEM_IDS) {
        const g = this.gains[id]; if (!g) continue;
        const v = (sec[id] || 0) * STEM_GAIN[id];
        g.gain.setTargetAtTime(v, Math.max(now, at - 0.01), id === 'drums' || id === 'bass' ? 0.01 : 0.4);
      }
      this.section = next;
    }
  }
  stop(fade = 1.2) {
    clearInterval(this.timer); this.timer = 0;
    if (!this.playing && !this.nodes.length) return;
    const ctx = this.ctx, now = ctx.currentTime, nodes = this.nodes, m = this.master;
    this.playing = false; this.nodes = [];
    if (m) { m.gain.cancelScheduledValues(now); m.gain.setValueAtTime(m.gain.value, now); m.gain.linearRampToValueAtTime(0, now + Math.max(0.02, fade)); }
    for (const n of nodes) if (n.stop) { try { n.stop(now + Math.max(0.03, fade) + 0.05); } catch { /* bereits gestoppt */ } }
    setTimeout(() => { for (const n of nodes) { try { n.disconnect(); } catch { /* egal */ } } try { m?.disconnect(); } catch { /* egal */ } }, (fade + 0.3) * 1000);
  }
}
