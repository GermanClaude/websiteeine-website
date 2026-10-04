// Raumakustik: generierte Impulsantworten (innen) und Slap-Back-/Weite-Parameter (außen) je Karte.
import { len, OnePole, filt, makeRng, clamp } from './dsp.js';

/**
 * rt: Nachhallzeit innen (s) · pre: Vorverzögerung · damp: Höhendämpfung 0..1
 * slap: Außen-Echos [Verzögerung s, Pegel, Panorama] · slapLp: Echo-Tiefpass · tail: ferner Außen-Nachhall (s)
 */
export const SPACES = {
  default:    { rt: 1.0, pre: 0.008, damp: 0.5,  slap: [[0.09, 0.3, -0.5], [0.2, 0.2, 0.5], [0.37, 0.1, 0]], slapLp: 3000, tail: 1.8 },
  harbor:     { rt: 1.6, pre: 0.012, damp: 0.55, slap: [[0.075, 0.42, -0.5], [0.16, 0.3, 0.6], [0.31, 0.2, -0.2], [0.55, 0.12, 0.3]], slapLp: 3200, tail: 2.6 },
  desert:     { rt: 0.75, pre: 0.006, damp: 0.4, slap: [[0.045, 0.5, -0.4], [0.1, 0.35, 0.5], [0.21, 0.18, -0.1]], slapLp: 4200, tail: 1.6 },
  industrial: { rt: 2.3, pre: 0.02, damp: 0.6,  slap: [[0.12, 0.4, -0.3], [0.26, 0.28, 0.5], [0.43, 0.16, -0.6]], slapLp: 2600, tail: 3.0 },
  range:      { rt: 0.9, pre: 0.01, damp: 0.5,  slap: [[0.21, 0.35, -0.5], [0.48, 0.22, 0.4], [0.9, 0.12, 0]], slapLp: 2200, tail: 3.2 },
};

function energyNormalize(chs, target = 1) {
  for (const d of chs) {
    let e = 0; for (let i = 0; i < d.length; i++) e += d[i] * d[i];
    const g = target / Math.sqrt(e || 1); for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return chs;
}

/** Diffuser Innenraum: frühe Reflexionen + exponentiell abklingendes, zunehmend dumpferes Rauschen. */
export function roomIR(sr, { rt, pre, damp }, { maxLen = 3, seed = 7 } = {}) {
  const R = makeRng(seed), T = Math.min(maxLen, rt * 1.15 + pre), n = len(sr, T), tau = rt / 6.91, p0 = len(sr, pre);
  return energyNormalize([0, 1].map(c => {
    const d = new Float32Array(n), lp = new OnePole(sr, 9000);
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr;
      if ((i & 63) === 0) lp.set(600 + 8500 * Math.exp(-t / (rt * 0.55 * (1 - damp) + 0.08)));
      d[i] = lp.lp((R() * 2 - 1) * Math.exp(-t / tau) * Math.min(1, t / 0.006 + 0.15));
    }
    for (let k = 0; k < 10; k++) { // frühe Reflexionen
      const i = p0 + len(sr, 0.003 + R() * 0.06 * (1 + k * 0.1));
      if (i < n) d[i] += (R() < 0.5 ? -1 : 1) * (0.6 - k * 0.04) * (c ? 0.9 : 1);
    }
    filt(d, sr, 'highpass', 90, 0.7);
    return d;
  }));
}

/** Weite Außenfahne: spärliche, späte Reflexionen von fernen Fassaden/Gelände. */
export function outdoorIR(sr, { tail }, { seed = 11 } = {}) {
  const R = makeRng(seed), n = len(sr, tail);
  return energyNormalize([0, 1].map(() => {
    const d = new Float32Array(n);
    for (let k = 0; k < 140; k++) {
      const t = 0.03 + Math.pow(R(), 0.8) * (tail - 0.05), i = len(sr, t);
      d[i] += (R() < 0.5 ? -1 : 1) * R() * Math.exp(-t / (tail / 3.5));
    }
    filt(d, sr, 'lowpass', 2200, 0.6, 2); filt(d, sr, 'highpass', 140, 0.7);
    return d;
  }));
}

export const spaceFor = id => SPACES[id] || SPACES.default;
export const clampSpace = s => ({ ...s, rt: clamp(s.rt, 0.2, 4) });
