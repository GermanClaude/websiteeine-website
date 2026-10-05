// Waffen-Klangrezepte: Schüsse (nah/stereo + fern/mono), Nachladen, Handling, Granaten, Explosionen, Geschosse.
// Jedes Rezept: (sampleRate, rng, variante) → Float32Array | [L, R]
import {
  len, buf, white, brown, filt, sweep, expGlide, env, ad, ahr, bell, mix, mixAt, drive, normalize,
  sine, modal, metalModes, click, burst, grains, echoes, decorrelate, fadeOut, dcBlock, trim, clamp,
} from './dsp.js';

/**
 * Charakter je Schussprofil.
 * crack/crackF: Mündungsknall · b0→b1/bTau: Rauschkörper (Tiefpass-Verlauf, Abklingzeit)
 * t0→t1/tTau/tAmp: tieffrequenter Druckstoß · tail*: Nachhall-Rumpeln · mech: Verschluss-Mechanik
 */
export const GUN_PROFILES = {
  ar:           { crack: 1.0,  crackF: 3200, b0: 5200, b1: 850,  bTau: 0.050, t0: 140, t1: 50, tTau: 0.070, tAmp: 0.85, mid: 520, tail: 0.50, tailLp: 1500, tailAmp: 0.30, drive: 2.4, mech: 2400, mechAmp: 0.16, mechAt: 0.016, shell: 0.50, dur: 1.0,  gain: 0.86 },
  ar_heavy:     { crack: 1.05, crackF: 2700, b0: 4200, b1: 650,  bTau: 0.068, t0: 120, t1: 44, tTau: 0.085, tAmp: 1.00, mid: 430, tail: 0.65, tailLp: 1200, tailAmp: 0.36, drive: 2.8, mech: 1800, mechAmp: 0.19, mechAt: 0.020, shell: 0.55, dur: 1.15, gain: 0.90 },
  smg:          { crack: 0.9,  crackF: 3900, b0: 6500, b1: 1300, bTau: 0.032, t0: 185, t1: 75, tTau: 0.045, tAmp: 0.55, mid: 700, tail: 0.32, tailLp: 1900, tailAmp: 0.24, drive: 2.0, mech: 3100, mechAmp: 0.14, mechAt: 0.011, shell: 0.42, dur: 0.75, gain: 0.78 },
  lmg:          { crack: 1.05, crackF: 2600, b0: 4000, b1: 620,  bTau: 0.075, t0: 105, t1: 40, tTau: 0.090, tAmp: 1.05, mid: 400, tail: 0.75, tailLp: 1150, tailAmp: 0.40, drive: 3.0, mech: 1600, mechAmp: 0.20, mechAt: 0.018, shell: 0.55, belt: true, dur: 1.25, gain: 0.92 },
  sniper:       { crack: 1.25, crackF: 3000, b0: 5600, b1: 480,  bTau: 0.100, t0: 88,  t1: 32, tTau: 0.130, tAmp: 1.30, mid: 340, tail: 1.50, tailLp: 900,  tailAmp: 0.50, drive: 3.2, mech: 5200, mechAmp: 0.05, mechAt: 0.002, shell: 0,    roll: true, dur: 2.2, gain: 1.00 },
  shotgun:      { crack: 0.85, crackF: 2200, b0: 3300, b1: 380,  bTau: 0.110, t0: 92,  t1: 34, tTau: 0.120, tAmp: 1.35, mid: 300, tail: 0.95, tailLp: 1000, tailAmp: 0.48, drive: 3.4, mech: 0,    mechAmp: 0,    mechAt: 0,     shell: 0,    dur: 1.5,  gain: 1.00 },
  pistol:       { crack: 1.0,  crackF: 4300, b0: 7000, b1: 1500, bTau: 0.028, t0: 195, t1: 85, tTau: 0.040, tAmp: 0.45, mid: 820, tail: 0.28, tailLp: 2200, tailAmp: 0.22, drive: 2.2, mech: 2900, mechAmp: 0.15, mechAt: 0.008, shell: 0.38, dur: 0.65, gain: 0.84 },
  pistol_heavy: { crack: 1.15, crackF: 2900, b0: 4500, b1: 600,  bTau: 0.070, t0: 110, t1: 40, tTau: 0.090, tAmp: 1.10, mid: 380, tail: 0.75, tailLp: 1150, tailAmp: 0.42, drive: 3.0, mech: 2100, mechAmp: 0.17, mechAt: 0.012, shell: 0.50, dur: 1.2,  gain: 0.95 },
};
export const GUN_PROFILE_IDS = Object.keys(GUN_PROFILES);

// ---------------------------------------------------------------- kleine Bausteine

/** Metallischer Klick (Verschluss, Abzug, Riegel). */
export function metalClick(d, sr, at, R, f0 = 2500, amp = 1, decay = 0.012) {
  click(d, sr, at, { dur: 0.004, tau: 0.0007, hp: 1500, amp: amp * 0.75, R });
  modal(d, sr, at, metalModes(f0, R, { count: 5, decay }), amp * 0.32, R);
}
/** Tieffrequenter Schlag mit Tonhöhenabfall. */
export function thud(d, sr, at, f, tau, amp = 1) {
  const e = ad(0.0012, tau);
  return sine(d, sr, at, tau * 7, expGlide(f * 1.7, f, Math.min(0.03, tau)), t => e(t) * amp);
}
/** Kratzendes Gleiten (Magazin, Schlitten), mit Rattern. */
export function scrape(d, sr, at, R, dur, f0, f1, amp = 0.4) {
  burst(d, sr, at, { dur, type: 'bandpass', freqAt: expGlide(f0, f1, dur), q: 2.2, envFn: bell(dur, 0.35), R, amp });
  grains(d, sr, at, { dur, count: Math.round(dur * 120), grainDur: [0.0008, 0.002], freq: [f0 * 1.2, f1 * 2.2], q: 3, amp: amp * 0.5, R });
}
/** Stoff-Rascheln. */
export function cloth(d, sr, at, R, dur, amp = 0.3, freq = 1200) {
  const n = len(sr, dur), c = white(n, R);
  filt(c, sr, 'bandpass', freq, 0.5); filt(c, sr, 'highpass', 300, 0.7);
  let g = 0, tgt = 1;
  for (let i = 0; i < n; i++) { if (i % 300 === 0) tgt = 0.3 + R() * 0.9; g += (tgt - g) * 0.01; c[i] *= g; }
  env(c, sr, bell(dur, 0.4));
  return mixAt(d, sr, c, at, amp);
}
/** Hülsen-Klimpern auf dem Boden. */
function shellTinkle(d, sr, at, R, amp) {
  const f = R.range(4200, 5600);
  modal(d, sr, at, [[f, 1, 0.05], [f * 1.53, 0.6, 0.035], [f * 2.31, 0.3, 0.02]], amp, R);
  modal(d, sr, at + R.range(0.06, 0.1), [[f * 1.04, 1, 0.03], [f * 1.6, 0.5, 0.02]], amp * 0.5, R);
  modal(d, sr, at + R.range(0.14, 0.2), [[f * 0.98, 1, 0.02]], amp * 0.25, R);
}

// ---------------------------------------------------------------- Schüsse

/** Naher Schuss (Spieler/2D und nahe Positionsquellen), Stereo. */
export function gunNear(P) {
  return (sr, R) => {
    const N = len(sr, P.dur), L = new Float32Array(N), Rt = new Float32Array(N);
    const J = (x, k = 0.07) => R.jit(x, k);

    // 1) Transient (mono)
    const tr = buf(sr, 0.01);
    click(tr, sr, 0, { dur: 0.01, tau: 0.0011, hp: 650, amp: 1, R });
    // 2) Mündungsknall: Bandpass-Rauschen + Luftanteil
    const cr = buf(sr, 0.08);
    burst(cr, sr, 0, { dur: 0.08, type: 'bandpass', freq: J(P.crackF, 0.12), q: 0.75, envFn: ad(0.0004, J(0.009)), R, amp: 1.2 });
    burst(cr, sr, 0, { dur: 0.03, type: 'highpass', freq: 5200, q: 0.7, envFn: ad(0.0002, 0.0035), R, amp: 0.7 });
    // 3) Rauschkörper mit fallendem Tiefpass, Kanäle teilkorreliert
    const nB = len(sr, P.bTau * 8 + 0.03), common = white(nB, R);
    const glide = expGlide(J(P.b0, 0.1), J(P.b1, 0.15), P.bTau * 2.4), bTau = J(P.bTau, 0.1);
    const body = [0, 1].map(() => {
      const own = white(nB, R), b = new Float32Array(nB);
      for (let i = 0; i < nB; i++) b[i] = common[i] * 0.82 + own[i] * 0.55;
      sweep(b, sr, 'lowpass', glide, 0.85);
      filt(b, sr, 'highpass', 85, 0.7);
      return env(b, sr, ad(0.0006, bTau));
    });
    // Mitten-"Punch" (Brustkorb-Gefühl)
    const mid = buf(sr, 0.12);
    burst(mid, sr, 0, { dur: 0.12, type: 'bandpass', freq: J(P.mid, 0.08), q: 1.4, envFn: ad(0.001, bTau * 0.7), R, amp: 1.4 });
    // 4) Druckstoß
    const th = buf(sr, P.tTau * 7 + 0.01), tf = expGlide(J(P.t0, 0.06), J(P.t1, 0.06), P.tTau * 0.8);
    sine(th, sr, 0, P.tTau * 7, tf, ad(0.0015, P.tTau));
    sine(th, sr, 0, P.tTau * 3, t => tf(t) * 2.02, t => ad(0.001, P.tTau * 0.45)(t) * 0.28);
    // 5) Fahne/Rumpeln (stereo unabhängig)
    const tails = [0, 1].map(() => {
      const t = brown(len(sr, P.tail * 1.6 + 0.05), R);
      filt(t, sr, 'lowpass', J(P.tailLp, 0.1), 0.7, 2);
      filt(t, sr, 'highpass', 45, 0.7);
      return env(t, sr, ad(0.004, P.tail * 0.32));
    });
    // 6) Mechanik (rechts betont, Waffe liegt rechts)
    const mech = buf(sr, 0.25);
    if (P.mech) {
      metalClick(mech, sr, P.mechAt, R, J(P.mech, 0.05), P.mechAmp, 0.014);
      if (P.mechAt > 0.005) metalClick(mech, sr, P.mechAt + J(0.028, 0.15), R, J(P.mech * 1.25, 0.05), P.mechAmp * 0.6, 0.009);
      if (P.belt) grains(mech, sr, 0.03, { dur: 0.08, count: 10, grainDur: [0.001, 0.003], freq: [2600, 6200], q: 4, amp: 0.1, R });
    }
    // 7) Hülsen
    const sh = buf(sr, 0.9);
    if (P.shell) shellTinkle(sh, sr, J(P.shell, 0.18), R, 0.035);

    for (const [ch, side] of [[L, -1], [Rt, 1]]) {
      const k = side < 0 ? 0 : 1;
      mix(ch, tr, 0, 0.9); mix(ch, cr, 0, P.crack * 0.85);
      mix(ch, body[k], 0, 1.0); mix(ch, mid, 0, 0.5);
      mix(ch, th, 0, P.tAmp); mix(ch, tails[k], 0, P.tailAmp);
      mix(ch, mech, 0, side > 0 ? 1 : 0.6); mix(ch, sh, 0, side > 0 ? 0.8 : 1);
      drive(ch, P.drive); dcBlock(ch, sr, 22);
    }
    if (P.roll) { // Scharfschütze: rollendes Echo eingebacken
      for (const ch of [L, Rt]) {
        const e = echoes(ch.slice(0, len(sr, 0.4)), sr, [[R.range(0.18, 0.24), 0.18, 1400], [R.range(0.42, 0.55), 0.1, 900], [R.range(0.8, 1.0), 0.06, 600]]);
        mix(ch, e.subarray(len(sr, 0.4)), len(sr, 0.4), 1);
      }
    }
    normalize([L, Rt], 0.95);
    return trim([L, Rt], sr);
  };
}

/** Ferner Schuss: gedämpfter Knall, Grollen, rollende Echos (mono). */
export function gunFar(P) {
  return (sr, R) => {
    const N = len(sr, P.tail * 1.3 + 1.4), d = new Float32Array(N);
    burst(d, sr, 0, { dur: 0.03, type: 'bandpass', freq: R.range(1700, 2400), q: 0.6, envFn: ad(0.0005, 0.004), R, amp: 0.4 * P.crack });
    const body = buf(sr, 0.7);
    burst(body, sr, 0, { dur: 0.7, type: 'lowpass', freqAt: expGlide(R.range(1500, 2000), 280, 0.18), q: 0.8, envFn: ad(0.002, P.bTau * 1.9 + 0.02), R, amp: 1 });
    const tb = buf(sr, 0.7);
    sine(tb, sr, 0, 0.7, expGlide(P.t1 * 1.5, P.t1 * 0.9, 0.08), ad(0.004, P.tTau * 1.7));
    mix(body, tb, 0, P.tAmp * 0.8);
    mix(d, body, 0, 1);
    let t = 0;
    [[0.5, 1200], [0.32, 900], [0.2, 700], [0.12, 520]].forEach(([g, lp]) => {
      t += R.range(0.11, 0.28);
      const c = body.slice(); filt(c, sr, 'lowpass', lp, 0.6, 2);
      mixAt(d, sr, c, t, g);
    });
    const rum = brown(len(sr, P.tail * 1.3 + 1), R);
    filt(rum, sr, 'lowpass', 230, 0.7, 2);
    env(rum, sr, ad(0.03, P.tail * 0.45 + 0.25));
    mix(d, rum, 0, 0.55);
    dcBlock(d, sr, 35);
    drive(d, 1.6);
    normalize(d, 0.9);
    return trim(d, sr);
  };
}

// ---------------------------------------------------------------- Handling & Nachladen

export const HANDLING = {
  dryfire: (sr, R) => {
    const d = buf(sr, 0.18);
    metalClick(d, sr, 0, R, R.range(3200, 3800), 1, 0.006);
    modal(d, sr, 0.002, [[R.range(880, 1000), 1, 0.04]], 0.08, R);
    thud(d, sr, 0, 320, 0.008, 0.25);
    return normalize(d, 0.8);
  },
  reload_mag_out: (sr, R) => {
    const d = buf(sr, 0.5);
    metalClick(d, sr, 0, R, R.range(2600, 3000), 0.55, 0.008);
    metalClick(d, sr, 0.03, R, R.range(1800, 2100), 0.85, 0.016);
    scrape(d, sr, 0.04, R, 0.1, 1900, 950, 0.45);
    thud(d, sr, 0.13, 240, 0.012, 0.3);
    cloth(d, sr, 0.12, R, 0.28, 0.2);
    return normalize(d, 0.85);
  },
  reload_mag_in: (sr, R) => {
    const d = buf(sr, 0.5);
    scrape(d, sr, 0, R, 0.085, 900, 2300, 0.4);
    thud(d, sr, 0.09, 180, 0.03, 0.75);
    metalClick(d, sr, 0.09, R, R.range(1400, 1650), 1.0, 0.02);
    metalClick(d, sr, 0.102, R, R.range(2500, 2800), 0.6, 0.012);
    thud(d, sr, 0.18, 125, 0.025, 0.45);
    burst(d, sr, 0.18, { dur: 0.05, type: 'lowpass', freq: 900, envFn: ad(0.001, 0.012), R, amp: 0.4 });
    return normalize(d, 0.9);
  },
  reload_bolt: (sr, R) => {
    const d = buf(sr, 0.55);
    metalClick(d, sr, 0, R, R.range(2100, 2400), 0.6, 0.01);
    scrape(d, sr, 0.01, R, 0.08, 2600, 1400, 0.35);
    thud(d, sr, 0.13, 150, 0.03, 0.75);
    metalClick(d, sr, 0.13, R, R.range(1600, 1800), 1.1, 0.03);
    modal(d, sr, 0.13, metalModes(R.range(900, 1100), R, { count: 4, decay: 0.12 }), 0.18, R);
    return normalize(d, 0.9);
  },
  bolt: (sr, R) => {
    const d = buf(sr, 0.75);
    metalClick(d, sr, 0, R, R.range(1800, 2000), 0.6, 0.012);
    scrape(d, sr, 0.05, R, 0.12, 1500, 2600, 0.4);
    metalClick(d, sr, 0.17, R, R.range(2200, 2450), 0.7, 0.014);
    scrape(d, sr, 0.3, R, 0.1, 2600, 1600, 0.35);
    thud(d, sr, 0.41, 160, 0.025, 0.6);
    metalClick(d, sr, 0.41, R, R.range(1500, 1700), 1.0, 0.025);
    metalClick(d, sr, 0.5, R, R.range(2000, 2200), 0.7, 0.012);
    return normalize(d, 0.9);
  },
  pump: (sr, R) => {
    const d = buf(sr, 0.55);
    scrape(d, sr, 0, R, 0.07, 1200, 700, 0.5);
    thud(d, sr, 0.07, 140, 0.025, 0.7);
    metalClick(d, sr, 0.07, R, R.range(1250, 1400), 0.9, 0.02);
    burst(d, sr, 0.11, { dur: 0.06, type: 'bandpass', freq: 620, q: 1.5, envFn: ad(0.001, 0.02), R, amp: 0.3 });
    scrape(d, sr, 0.18, R, 0.06, 800, 1300, 0.45);
    thud(d, sr, 0.245, 180, 0.03, 0.9);
    metalClick(d, sr, 0.245, R, R.range(1450, 1600), 1.15, 0.025);
    // ausgeworfene Hülse (Kunststoff) fällt
    burst(d, sr, 0.42, { dur: 0.04, type: 'bandpass', freq: 900, q: 2, envFn: ad(0.001, 0.008), R, amp: 0.15 });
    return normalize(d, 0.92);
  },
  reload_shell: (sr, R) => {
    const d = buf(sr, 0.22);
    burst(d, sr, 0, { dur: 0.04, type: 'bandpass', freq: R.range(1300, 1700), q: 1.2, envFn: ad(0.001, 0.01), R, amp: 0.5 });
    metalClick(d, sr, 0.02, R, R.range(2500, 2800), 0.55, 0.01);
    thud(d, sr, 0.05, 220, 0.02, 0.45);
    modal(d, sr, 0.05, [[R.range(700, 800), 1, 0.05]], 0.07, R);
    return normalize(d, 0.8);
  },
  equip: (sr, R) => {
    const d = buf(sr, 0.45);
    cloth(d, sr, 0, R, 0.25, 0.4);
    grains(d, sr, 0.05, { dur: 0.12, count: 8, grainDur: [0.001, 0.003], freq: [2000, 5000], q: 3, amp: 0.35, R });
    thud(d, sr, 0.2, 170, 0.02, 0.4);
    metalClick(d, sr, 0.22, R, R.range(2300, 2600), 0.7, 0.014);
    return normalize(d, 0.8);
  },
  ads_in: (sr, R) => {
    const d = buf(sr, 0.26);
    burst(d, sr, 0, { dur: 0.15, type: 'bandpass', freqAt: expGlide(800, 1600, 0.15), q: 0.8, envFn: bell(0.15, 0.6), R, amp: 0.6 });
    cloth(d, sr, 0, R, 0.12, 0.25, 900);
    metalClick(d, sr, 0.11, R, R.range(3000, 3400), 0.14, 0.006);
    return normalize(d, 0.6);
  },
  ads_out: (sr, R) => {
    const d = buf(sr, 0.22);
    burst(d, sr, 0, { dur: 0.13, type: 'bandpass', freqAt: expGlide(1500, 800, 0.13), q: 0.8, envFn: bell(0.13, 0.3), R, amp: 0.55 });
    cloth(d, sr, 0.01, R, 0.12, 0.2, 1000);
    return normalize(d, 0.55);
  },
  melee_swing: (sr, R) => {
    const d = buf(sr, 0.38), T = R.range(0.24, 0.3);
    burst(d, sr, 0, { dur: T, type: 'bandpass', freqAt: t => 300 + 1600 * Math.sin(Math.PI * Math.min(1, t / T)) ** 1.5, q: 1.4, envFn: bell(T, 0.45), R, amp: 1 });
    burst(d, sr, 0.02, { dur: T, type: 'highpass', freq: 3000, envFn: bell(T * 0.9, 0.5), R, amp: 0.15 });
    return normalize(d, 0.7);
  },
  melee_hit: (sr, R) => {
    const d = buf(sr, 0.4);
    thud(d, sr, 0, R.range(52, 60), 0.05, 1);
    burst(d, sr, 0, { dur: 0.15, type: 'lowpass', freq: 900, envFn: ad(0.001, 0.04), R, amp: 0.9 });
    burst(d, sr, 0, { dur: 0.04, type: 'bandpass', freq: R.range(1300, 1800), q: 1, envFn: ad(0.0005, 0.008), R, amp: 0.7 });
    grains(d, sr, 0.005, { dur: 0.05, count: 6, freq: [2000, 4000], amp: 0.3, R });
    cloth(d, sr, 0.02, R, 0.15, 0.25);
    drive(d, 2);
    return normalize(d, 0.92);
  },
  grenade_pin: (sr, R) => {
    const d = buf(sr, 0.7);
    scrape(d, sr, 0, R, 0.06, 3000, 4500, 0.3);
    modal(d, sr, 0.07, [[R.range(3700, 3900), 1, 0.15], [5900, 0.4, 0.08], [8200, 0.2, 0.05]], 0.3, R);
    metalClick(d, sr, 0.25, R, R.range(2500, 2700), 0.5, 0.02);
    modal(d, sr, 0.25, [[R.range(2550, 2700), 1, 0.25], [5100, 0.5, 0.12]], 0.3, R);
    modal(d, sr, 0.26, [[R.range(420, 480), 1, 0.12]], 0.1, R);
    return normalize(d, 0.75);
  },
  grenade_throw: (sr, R) => {
    const d = buf(sr, 0.45), T = 0.3;
    burst(d, sr, 0, { dur: T, type: 'bandpass', freqAt: t => 250 + 1100 * Math.sin(Math.PI * Math.min(1, t / T)), q: 1.1, envFn: bell(T, 0.55), R, amp: 1 });
    cloth(d, sr, 0, R, 0.3, 0.4);
    return normalize(d, 0.6);
  },
  grenade_bounce: (sr, R) => {
    const d = buf(sr, 0.35);
    thud(d, sr, 0, R.range(200, 240), 0.02, 0.7);
    modal(d, sr, 0, [[R.range(650, 750), 1, 0.06], [R.range(1250, 1400), 0.7, 0.045], [R.range(2000, 2300), 0.5, 0.03], [3400, 0.25, 0.02]], 0.5, R);
    burst(d, sr, 0, { dur: 0.04, type: 'lowpass', freq: 1500, envFn: ad(0.0005, 0.012), R, amp: 0.5 });
    return normalize(d, 0.8);
  },
  grenade_stick: (sr, R) => {
    // Haftgranate klebt: dumpfer Aufschlag, schmatzende Haftmasse, Zünder piept zweimal (scharf)
    const d = buf(sr, 0.5);
    thud(d, sr, 0, R.range(120, 150), 0.018, 0.65);
    burst(d, sr, 0, { dur: 0.07, type: 'lowpass', freq: 1300, envFn: ad(0.0008, 0.014), R, amp: 0.8 });
    burst(d, sr, 0.003, { dur: 0.12, type: 'bandpass', freqAt: expGlide(R.range(2500, 3000), 900, 0.09), q: 1.8, envFn: ad(0.002, 0.03), R, amp: 0.4 });
    metalClick(d, sr, 0.004, R, R.range(1900, 2300), 0.35, 0.01);
    const beep = buf(sr, 0.06);
    sine(beep, sr, 0, 0.06, () => 3150, ahr(0.002, 0.03, 0.008));
    drive(beep, 2.5);
    mixAt(d, sr, beep, 0.17, 0.2); mixAt(d, sr, beep, 0.29, 0.2);
    return normalize(d, 0.85);
  },
  low_ammo: (sr, R) => {
    const d = buf(sr, 0.1);
    modal(d, sr, 0, [[R.range(3600, 4000), 1, 0.012], [6100, 0.5, 0.006]], 0.6, R);
    click(d, sr, 0, { dur: 0.003, tau: 0.0006, hp: 3000, amp: 0.3, R });
    return normalize(d, 0.6);
  },
};

// ---------------------------------------------------------------- Explosionen

export function* explosionNear(sr, R) {
  const N = len(sr, 4.2), L = new Float32Array(N), Rt = new Float32Array(N);
  // Gemeinsamer Sub-Druck
  const sub = buf(sr, 2.2);
  sine(sub, sr, 0, 2.2, expGlide(R.range(68, 76), 27, 0.45), ad(0.003, 0.5));
  sine(sub, sr, 0, 1, expGlide(140, 55, 0.25), t => ad(0.002, 0.18)(t) * 0.4);
  for (const ch of [L, Rt]) {
    const crack = buf(sr, 0.1);
    burst(crack, sr, 0, { dur: 0.1, type: 'highpass', freq: 1400, envFn: ad(0.0004, 0.012), R, amp: 1 });
    const blast = buf(sr, 1.4);
    burst(blast, sr, 0, { dur: 1.4, type: 'lowpass', freqAt: expGlide(6500, 380, 0.35), q: 0.8, envFn: ad(0.001, 0.2), R, amp: 1.1 });
    const boom = brown(len(sr, 2.2), R);
    filt(boom, sr, 'lowpass', 600, 0.7, 2); env(boom, sr, ad(0.005, 0.5));
    const debris = buf(sr, 3.2);
    grains(debris, sr, 0.25, { dur: 2.6, count: 140, grainDur: [0.001, 0.006], freq: [1400, 6500], q: 2, amp: 0.3, R, density: u => u * u });
    grains(debris, sr, 0.2, { dur: 1.8, count: 26, grainDur: [0.006, 0.02], freq: [250, 800], q: 1.2, amp: 0.45, R, density: u => u * u });
    yield;
    env(debris, sr, t => Math.exp(-t / 1.2));
    const rum = brown(len(sr, 4), R);
    filt(rum, sr, 'lowpass', 180, 0.7, 2); env(rum, sr, ad(0.12, 1.1));
    mix(ch, crack, 0, 0.9); mix(ch, blast, 0, 1); mix(ch, boom, 0, 1.0);
    mix(ch, sub, 0, 1.4); mix(ch, debris, 0, 0.5); mix(ch, rum, 0, 0.6);
    drive(ch, 2.6); dcBlock(ch, sr, 20);
    yield;
  }
  normalize([L, Rt], 0.97);
  return trim([L, Rt], sr);
}

export function explosionFar(sr, R) {
  const d = new Float32Array(len(sr, 4.6));
  const body = buf(sr, 1.6);
  burst(body, sr, 0, { dur: 1.6, type: 'lowpass', freqAt: expGlide(1100, 240, 0.4), q: 0.7, envFn: ad(0.006, 0.38), R, amp: 1 });
  sine(body, sr, 0, 1.6, expGlide(48, 29, 0.5), ad(0.01, 0.6));
  mix(d, body, 0, 1);
  let t = 0;
  [[0.55, 700], [0.38, 520], [0.24, 400], [0.14, 300]].forEach(([g, lp]) => {
    t += R.range(0.2, 0.45);
    const c = body.slice(); filt(c, sr, 'lowpass', lp, 0.6, 2); mixAt(d, sr, c, t, g);
  });
  const rum = brown(d.length, R); filt(rum, sr, 'lowpass', 150, 0.7, 2); env(rum, sr, ad(0.15, 1.5));
  mix(d, rum, 0, 0.8);
  dcBlock(d, sr, 22); drive(d, 1.5);
  return trim(normalize(d, 0.92), sr);
}

// ---------------------------------------------------------------- Geschosse

/** Unterschall-Pfeifen (Pistole/MP/Schrot), Doppler-Abfall. */
export function bulletWhiz(sr, R) {
  const T = R.range(0.2, 0.3), d = buf(sr, T + 0.05);
  const f0 = R.range(2800, 3600), f1 = R.range(800, 1100);
  burst(d, sr, 0, { dur: T, type: 'bandpass', freqAt: t => f0 * Math.pow(f1 / f0, clamp(t / T)), q: 3, envFn: bell(T, R.range(0.45, 0.6)), R, amp: 1 });
  sine(d, sr, 0, T, t => (f0 * 0.7) * Math.pow(f1 / f0, clamp(t / T)), t => bell(T, 0.5)(t) * 0.12);
  return normalize(d, 0.8);
}

/** Überschall-Knall (N-Welle) vorbeifliegender Gewehrgeschosse. */
export function bulletCrack(sr, R) {
  const d = buf(sr, 0.28), w = Math.max(3, Math.round(sr * R.range(0.00025, 0.0004)));
  for (let i = 0; i < w; i++) d[i] = 1 - 2 * (i / w);
  click(d, sr, 0, { dur: 0.004, tau: 0.0007, hp: 2500, amp: 0.45, R });
  sine(d, sr, 0.001, 0.07, expGlide(R.range(3600, 4200), 2300, 0.06), t => ad(0.002, 0.02)(t) * 0.12);
  burst(d, sr, 0.001, { dur: 0.08, type: 'bandpass', freq: 2200, q: 0.8, envFn: ad(0.001, 0.015), R, amp: 0.2 });
  const e = d.slice(0, len(sr, 0.03)); filt(e, sr, 'lowpass', 2500, 0.7);
  mixAt(d, sr, e, R.range(0.022, 0.04), 0.22);
  return normalize(d, 0.85);
}
