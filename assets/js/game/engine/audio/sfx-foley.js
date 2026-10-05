// Foley: Schritte je Untergrund, Einschläge je Oberfläche, Körper (Treffer, Schmerz, Tod, Herzschlag, Atem).
import {
  len, buf, white, brown, filt, sweep, expGlide, env, ad, ahr, bell, mix, mixAt, drive, normalize,
  sine, modal, metalModes, click, burst, grains, glottal, formant, fadeOut, dcBlock, trim, lerp,
} from './dsp.js';
import { thud, cloth, metalClick } from './sfx-weapons.js';

export const SURFACES = ['concrete', 'metal', 'wood', 'dirt', 'sand', 'grass', 'glass', 'water', 'tile', 'fabric'];

// ---------------------------------------------------------------- Schritte

const STEP = {
  concrete(d, sr, R) {
    thud(d, sr, 0, R.range(80, 100), 0.014, 0.35);
    burst(d, sr, 0, { dur: 0.05, type: 'lowpass', freq: 450, envFn: ad(0.001, 0.012), R, amp: 0.4 });
    click(d, sr, 0.001, { dur: 0.006, tau: 0.0016, hp: 2000, amp: 0.6, R });
    burst(d, sr, 0.004, { dur: 0.05, type: 'bandpass', freq: R.range(1800, 2800), q: 0.9, envFn: ad(0.002, 0.012), R, amp: 0.4 });
    grains(d, sr, 0.02, { dur: 0.06, count: 8, freq: [2500, 6000], amp: 0.22, R });
  },
  metal(d, sr, R) {
    thud(d, sr, 0, R.range(105, 125), 0.014, 0.35);
    click(d, sr, 0, { dur: 0.005, tau: 0.0014, hp: 1600, amp: 0.65, R });
    modal(d, sr, 0, metalModes(R.range(280, 420), R, { count: 6, decay: 0.07 }), 0.22, R);
    modal(d, sr, 0.004, metalModes(R.range(900, 1400), R, { count: 4, decay: 0.03 }), 0.18, R);
    burst(d, sr, 0.003, { dur: 0.05, type: 'bandpass', freq: 2600, q: 1, envFn: ad(0.001, 0.01), R, amp: 0.3 });
  },
  wood(d, sr, R) {
    burst(d, sr, 0, { dur: 0.1, type: 'bandpass', freq: R.range(560, 760), q: 3, envFn: ad(0.001, 0.028), R, amp: 1.1 });
    thud(d, sr, 0, R.range(110, 130), 0.02, 0.45);
    click(d, sr, 0, { dur: 0.004, tau: 0.0015, hp: 1600, amp: 0.45, R });
    if (R.chance(0.35)) sine(d, sr, 0.03, 0.12, t => 380 - 60 * t + 18 * Math.sin(t * 160), t => bell(0.12, 0.3)(t) * 0.04);
  },
  dirt(d, sr, R) {
    burst(d, sr, 0, { dur: 0.08, type: 'lowpass', freq: 480, envFn: ad(0.002, 0.026), R, amp: 0.8 });
    thud(d, sr, 0, R.range(70, 85), 0.02, 0.45);
    grains(d, sr, 0.004, { dur: 0.07, count: 14, freq: [800, 2600], q: 1.2, amp: 0.25, R });
  },
  sand(d, sr, R) {
    burst(d, sr, 0, { dur: 0.08, type: 'lowpass', freq: 340, envFn: ad(0.003, 0.025), R, amp: 0.6 });
    grains(d, sr, 0, { dur: 0.13, count: 34, grainDur: [0.001, 0.004], freq: [2000, 6500], q: 1, amp: 0.2, R, density: u => Math.sqrt(u) });
    burst(d, sr, 0.01, { dur: 0.12, type: 'bandpass', freq: 3800, q: 0.6, envFn: bell(0.12, 0.25), R, amp: 0.12 });
  },
  grass(d, sr, R) {
    burst(d, sr, 0, { dur: 0.07, type: 'lowpass', freq: 380, envFn: ad(0.002, 0.022), R, amp: 0.6 });
    burst(d, sr, 0, { dur: 0.13, type: 'bandpass', freq: R.range(3000, 4200), q: 0.7, envFn: bell(0.13, 0.3), R, amp: 0.3 });
    grains(d, sr, 0.01, { dur: 0.1, count: 10, freq: [3000, 7000], amp: 0.1, R });
  },
  glass(d, sr, R) {
    thud(d, sr, 0, R.range(80, 95), 0.016, 0.45);
    grains(d, sr, 0, { dur: 0.08, count: 16, freq: [1500, 4200], q: 1.5, amp: 0.3, R });
    for (let k = 0; k < 3; k++) modal(d, sr, R.range(0, 0.06), [[R.range(4200, 8200), 1, R.range(0.02, 0.05)]], 0.08, R);
  },
  water(d, sr, R) {
    burst(d, sr, 0, { dur: 0.15, type: 'bandpass', freq: R.range(1000, 1400), q: 0.8, envFn: ad(0.005, 0.05), R, amp: 0.7 });
    burst(d, sr, 0, { dur: 0.12, type: 'lowpass', freq: 400, envFn: ad(0.004, 0.035), R, amp: 0.5 });
    for (let k = 0; k < 4; k++) {
      const f = R.range(500, 900), t0 = R.range(0.01, 0.1);
      sine(d, sr, t0, 0.025, t => f * (1 + t * 40), t => ad(0.001, 0.008)(t) * 0.2);
    }
  },
  tile(d, sr, R) {
    click(d, sr, 0, { dur: 0.005, tau: 0.0016, hp: 2000, amp: 0.75, R });
    thud(d, sr, 0, R.range(95, 110), 0.012, 0.35);
    burst(d, sr, 0.003, { dur: 0.04, type: 'bandpass', freq: 3000, q: 1, envFn: ad(0.001, 0.008), R, amp: 0.3 });
    modal(d, sr, 0, [[R.range(1700, 1950), 1, 0.02], [R.range(3100, 3500), 0.5, 0.012]], 0.1, R);
  },
  fabric(d, sr, R) {
    burst(d, sr, 0, { dur: 0.08, type: 'lowpass', freq: 300, envFn: ad(0.003, 0.025), R, amp: 0.6 });
    cloth(d, sr, 0, R, 0.1, 0.15, 900);
  },
};

export const footstep = surface => (sr, R) => {
  const d = buf(sr, 0.28);
  (STEP[surface] || STEP.concrete)(d, sr, R);
  // Abrollen (Ferse → Ballen)
  const toe = buf(sr, 0.15); (STEP[surface] || STEP.concrete)(toe, sr, R);
  filt(toe, sr, 'lowpass', 2600, 0.7);
  mixAt(d, sr, toe, R.range(0.045, 0.07), 0.3);
  dcBlock(d, sr, 30);
  return trim(normalize(d, 0.9), sr);
};

/** Ausrüstungsklappern (Sprint-Ebene). */
export function gearRattle(sr, R) {
  const d = buf(sr, 0.28);
  cloth(d, sr, 0, R, 0.18, 0.4, 1000);
  grains(d, sr, 0.01, { dur: 0.1, count: 6, grainDur: [0.001, 0.003], freq: [2200, 6000], q: 4, amp: 0.4, R });
  modal(d, sr, R.range(0.01, 0.05), metalModes(R.range(2500, 3500), R, { count: 3, decay: 0.02 }), 0.12, R);
  return normalize(d, 0.75);
}

export function jump(sr, R) {
  const d = buf(sr, 0.35);
  cloth(d, sr, 0, R, 0.22, 0.5, 1100);
  const n = len(sr, 0.16), ex = white(n, R);
  const h = formant(ex, sr, 'h', { shift: R.range(0.9, 1.1) });
  env(h, sr, bell(0.16, 0.2)); filt(h, sr, 'lowpass', 3500);
  mix(d, h, len(sr, 0.01), 0.35);
  grains(d, sr, 0.02, { dur: 0.08, count: 4, freq: [2500, 5000], q: 4, amp: 0.2, R });
  return normalize(d, 0.6);
}

export function land(sr, R) {
  const d = buf(sr, 0.45);
  thud(d, sr, 0, R.range(48, 58), 0.06, 1);
  burst(d, sr, 0, { dur: 0.15, type: 'lowpass', freq: 520, envFn: ad(0.002, 0.045), R, amp: 0.8 });
  click(d, sr, 0, { dur: 0.006, tau: 0.002, hp: 1800, amp: 0.25, R });
  const g = gearRattle(sr, R); mixAt(d, sr, g, 0.015, 0.45);
  cloth(d, sr, 0.01, R, 0.2, 0.25);
  drive(d, 1.6);
  return normalize(d, 0.9);
}

/** Rutschen (Spieler): Aufsetzen, Reiben über den Boden mit fallender Tonhöhe, Stoff und Ausrüstung. */
export function slide(sr, R) {
  const T = R.range(0.6, 0.75), d = buf(sr, T + 0.1);
  thud(d, sr, 0, R.range(62, 74), 0.035, 0.55);
  burst(d, sr, 0, { dur: 0.1, type: 'lowpass', freq: 600, envFn: ad(0.002, 0.03), R, amp: 0.5 });
  const n = len(sr, T), fr = white(n, R), step = Math.max(1, Math.round(sr * 0.005));
  sweep(fr, sr, 'bandpass', expGlide(R.range(1700, 2100), R.range(520, 650), T), 0.7);
  filt(fr, sr, 'highpass', 180, 0.7);
  let g = 0, tgt = 1; // raue, unregelmäßige Reibung
  for (let i = 0; i < n; i++) { if (i % step === 0) tgt = 0.55 + R() * 0.45; g += (tgt - g) * 0.02; fr[i] *= g; }
  env(fr, sr, t => Math.min(1, t / 0.025) * (t < T * 0.35 ? 1 : Math.exp(-(t - T * 0.35) / (T * 0.28))));
  mix(d, fr, len(sr, 0.01), 0.9);
  grains(d, sr, 0.02, { dur: T * 0.7, count: Math.round(T * 50), grainDur: [0.001, 0.003], freq: [1800, 5200], q: 1.4, amp: 0.18, R, density: u => Math.pow(u, 1.4) });
  cloth(d, sr, 0, R, 0.3, 0.35, 1300);
  modal(d, sr, R.range(0.02, 0.06), metalModes(R.range(2600, 3400), R, { count: 3, decay: 0.02 }), 0.08, R);
  dcBlock(d, sr, 30);
  return trim(normalize(d, 0.8), sr);
}

// ---------------------------------------------------------------- Einschläge (Kugel trifft Welt)

const IMPACT = {
  concrete(d, sr, R) {
    click(d, sr, 0, { dur: 0.008, tau: 0.0015, hp: 1800, amp: 1, R });
    thud(d, sr, 0, R.range(150, 180), 0.014, 0.4);
    grains(d, sr, 0.005, { dur: 0.16, count: 16, freq: [1500, 5000], amp: 0.3, R, density: u => u * u });
    burst(d, sr, 0, { dur: 0.14, type: 'bandpass', freq: 4000, q: 0.7, envFn: bell(0.14, 0.15), R, amp: 0.14 });
  },
  metal(d, sr, R, v) {
    click(d, sr, 0, { dur: 0.005, tau: 0.001, hp: 2500, amp: 0.8, R });
    modal(d, sr, 0, metalModes(R.range(1300, 2500), R, { count: 6, decay: 0.12 }), 0.55, R);
    if (v % 3 === 2) { // Abpraller mit Heulen
      const T = R.range(0.3, 0.42), f0 = R.range(3800, 4600), f1 = f0 * R.range(0.42, 0.55);
      sine(d, sr, 0.01, T, t => f0 * Math.pow(f1 / f0, t / T) * (1 + 0.01 * Math.sin(t * 90)), t => bell(T, 0.15)(t) * 0.28);
    }
  },
  wood(d, sr, R) {
    burst(d, sr, 0, { dur: 0.1, type: 'bandpass', freq: R.range(800, 1000), q: 2.5, envFn: ad(0.0006, 0.024), R, amp: 1 });
    thud(d, sr, 0, R.range(170, 200), 0.018, 0.5);
    grains(d, sr, 0.004, { dur: 0.08, count: 9, freq: [2000, 5000], q: 2, amp: 0.25, R });
  },
  dirt(d, sr, R) {
    burst(d, sr, 0, { dur: 0.12, type: 'lowpass', freq: 650, envFn: ad(0.001, 0.03), R, amp: 0.8 });
    click(d, sr, 0, { dur: 0.005, tau: 0.0012, hp: 1200, amp: 0.3, R });
    grains(d, sr, 0.01, { dur: 0.25, count: 26, freq: [800, 3000], q: 1.2, amp: 0.25, R, density: u => u * u });
  },
  sand(d, sr, R) {
    burst(d, sr, 0, { dur: 0.15, type: 'lowpass', freq: 1500, envFn: bell(0.11, 0.15), R, amp: 0.6 });
    grains(d, sr, 0.01, { dur: 0.3, count: 36, grainDur: [0.001, 0.004], freq: [2000, 6000], q: 1, amp: 0.18, R, density: u => u * u });
  },
  grass(d, sr, R) {
    burst(d, sr, 0, { dur: 0.08, type: 'lowpass', freq: 420, envFn: ad(0.001, 0.025), R, amp: 0.7 });
    burst(d, sr, 0, { dur: 0.1, type: 'highpass', freq: 2500, envFn: bell(0.1, 0.2), R, amp: 0.3 });
    grains(d, sr, 0.005, { dur: 0.12, count: 10, freq: [1500, 4500], amp: 0.15, R });
  },
  glass(d, sr, R) {
    click(d, sr, 0, { dur: 0.005, tau: 0.001, hp: 3000, amp: 1, R });
    burst(d, sr, 0, { dur: 0.15, type: 'bandpass', freq: 2500, q: 0.8, envFn: ad(0.001, 0.05), R, amp: 0.4 });
    for (let k = 0; k < 26; k++) {
      const t = 0.003 + Math.pow(R(), 1.5) * 0.5;
      modal(d, sr, t, [[R.range(3000, 9000), 1, R.range(0.04, 0.18)], [R.range(5000, 11000), 0.4, 0.03]], R.range(0.05, 0.22) * (1 - t), R);
    }
  },
  water(d, sr, R) {
    sine(d, sr, 0, 0.04, t => 300 + 18000 * t, t => ad(0.001, 0.012)(t) * 0.5);
    burst(d, sr, 0, { dur: 0.2, type: 'bandpass', freq: 1500, q: 0.8, envFn: ad(0.002, 0.06), R, amp: 0.7 });
    for (let k = 0; k < 10; k++) {
      const f = R.range(1000, 3000), t0 = R.range(0.04, 0.45);
      sine(d, sr, t0, 0.02, t => f * (1 + t * 30), t => ad(0.001, 0.006)(t) * 0.12);
    }
  },
  tile(d, sr, R) {
    click(d, sr, 0, { dur: 0.006, tau: 0.0012, hp: 2200, amp: 1, R });
    modal(d, sr, 0, [[R.range(2600, 3200), 1, 0.03], [R.range(4300, 5000), 0.6, 0.02]], 0.3, R);
    grains(d, sr, 0.004, { dur: 0.1, count: 8, freq: [2500, 6000], amp: 0.2, R });
  },
  fabric(d, sr, R) {
    burst(d, sr, 0, { dur: 0.08, type: 'lowpass', freq: 800, envFn: ad(0.001, 0.02), R, amp: 0.8 });
    burst(d, sr, 0, { dur: 0.08, type: 'bandpass', freq: 1500, q: 0.8, envFn: ad(0.002, 0.03), R, amp: 0.2 });
  },
};

export const impact = surface => (sr, R, v) => {
  const d = buf(sr, surface === 'glass' || surface === 'water' || surface === 'metal' ? 0.7 : 0.35);
  (IMPACT[surface] || IMPACT.concrete)(d, sr, R, v);
  dcBlock(d, sr, 40);
  return trim(normalize(d, 0.9), sr);
};

// ---------------------------------------------------------------- Körper

export function hitFlesh(sr, R) {
  const d = buf(sr, 0.28);
  thud(d, sr, 0, R.range(58, 70), 0.032, 0.9);
  burst(d, sr, 0, { dur: 0.12, type: 'lowpass', freq: 700, envFn: ad(0.001, 0.035), R, amp: 0.85 });
  burst(d, sr, 0, { dur: 0.04, type: 'bandpass', freq: R.range(1500, 2100), q: 1, envFn: ad(0.0005, 0.008), R, amp: 0.55 });
  grains(d, sr, 0.004, { dur: 0.05, count: 5, freq: [900, 2200], q: 1, amp: 0.2, R });
  drive(d, 1.8);
  return normalize(d, 0.9);
}

export function hitHelmet(sr, R) {
  const d = buf(sr, 0.9);
  click(d, sr, 0, { dur: 0.004, tau: 0.0008, hp: 3000, amp: 0.7, R });
  const j = () => R.range(0.97, 1.03);
  modal(d, sr, 0, [[2150 * j(), 1, 0.25], [3480 * j(), 0.7, 0.18], [5620 * j(), 0.45, 0.12], [7950 * j(), 0.25, 0.08]], 0.4, R);
  thud(d, sr, 0, 300, 0.01, 0.3);
  return normalize(d, 0.85);
}

/** Stimmhaftes Grunzen aus Pulsfolge + Rauschen durch Formanten (keine Sprache). */
function grunt(sr, R, { dur, f0, drop, vowel, breath = 0.35, shift = 1, a = 0.02 }) {
  const n = len(sr, dur);
  const src = glottal(n, sr, t => f0 * (1 - drop * (t / dur)), R, { jitter: 0.03, shimmer: 0.15 });
  const nz = white(n, R);
  for (let i = 0; i < n; i++) src[i] = src[i] * 0.9 + nz[i] * breath * 0.25;
  const out = formant(src, sr, vowel, { shift });
  env(out, sr, t => (t < a ? t / a : Math.exp(-(t - a) / (dur * 0.45))) * (t > dur - 0.03 ? Math.max(0, (dur - t) / 0.03) : 1));
  // Aspiriertes Ansetzen
  const h = white(len(sr, 0.05), R); const hh = formant(h, sr, 'h'); env(hh, sr, bell(0.05, 0.7));
  const d = buf(sr, dur + 0.06); mix(d, hh, 0, 0.25); mix(d, out, len(sr, 0.025), 1);
  filt(d, sr, 'lowpass', 3800, 0.7); filt(d, sr, 'highpass', 90, 0.7);
  normalize(d, 1); drive(d, 2.4); // Scheitelfaktor senken → präsenter
  return d;
}

export function pain(sr, R, v) {
  const d = grunt(sr, R, {
    dur: R.range(0.16, 0.32), f0: R.range(95, 150) * (v % 2 ? 1 : 1.12), drop: R.range(0.12, 0.3),
    vowel: ['a', 'u', 'o', 'ae', 'a', 'u'][v % 6], shift: R.range(0.92, 1.08),
  });
  return normalize(d, 0.8);
}

export function death(sr, R, v) {
  const d = buf(sr, 1.1);
  const g = normalize(grunt(sr, R, { dur: R.range(0.35, 0.5), f0: R.range(105, 135), drop: 0.35, vowel: ['a', 'o', 'u'][v % 3], breath: 0.5 }), 1);
  mix(d, g, 0, 1);
  const tf = R.range(0.38, 0.5);
  thud(d, sr, tf, R.range(60, 75), 0.06, 0.55);
  burst(d, sr, tf, { dur: 0.15, type: 'lowpass', freq: 500, envFn: ad(0.002, 0.05), R, amp: 0.6 });
  const gr = gearRattle(sr, R); mixAt(d, sr, gr, tf, 0.5);
  metalClick(d, sr, tf + R.range(0.05, 0.1), R, R.range(900, 1300), 0.4, 0.05);
  metalClick(d, sr, tf + R.range(0.14, 0.2), R, R.range(1100, 1500), 0.2, 0.03);
  cloth(d, sr, tf - 0.05, R, 0.3, 0.3);
  return normalize(d, 0.88);
}

export function heartbeat(sr, R) {
  const d = buf(sr, 0.7);
  thud(d, sr, 0, 44, 0.07, 1);
  burst(d, sr, 0, { dur: 0.1, type: 'lowpass', freq: 160, envFn: ad(0.004, 0.03), R, amp: 0.4, color: 'brown' });
  thud(d, sr, 0.27, 38, 0.06, 0.7);
  filt(d, sr, 'lowpass', 220, 0.7);
  return normalize(d, 0.95);
}

export function breathIn(sr, R) {
  const T = R.range(0.5, 0.65), n = len(sr, T), src = white(n, R);
  const d = formant(src, sr, 'h', { shift: R.range(0.85, 1.05) });
  filt(d, sr, 'bandpass', 1700, 0.5);
  env(d, sr, bell(T, 0.7));
  return normalize(d, 0.6);
}

export function breathOut(sr, R) {
  const T = R.range(0.55, 0.7), n = len(sr, T), src = white(n, R);
  const vo = glottal(n, sr, t => 105 - 20 * t, R);
  for (let i = 0; i < n; i++) src[i] = src[i] * 0.8 + vo[i] * 0.25;
  const d = formant(src, sr, R.chance(0.5) ? 'h' : 'o', { shift: R.range(0.85, 1.0) });
  filt(d, sr, 'lowpass', 3000, 0.7);
  env(d, sr, bell(T, 0.22));
  return normalize(d, 0.6);
}
