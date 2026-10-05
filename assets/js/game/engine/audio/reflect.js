// NULLPUNKT — Frühe Reflexionen (Owner: audio, Plan §10 A3).
// Feste Mehrfach-Verzögerung mit 5 Abgriffen (4 Wände + Decke) für alle lauten Ereignisse: Stimmen schicken
// nur einen Send hinein (ein GainNode je Stimme), Verzögerungen/Pegel/Panorama folgen der Hörer-Sonde
// (acoustics.js) weich nachgeführt. Wände dämpfen Höhen (Tiefpass), tiefe Frequenzen werden nicht verstärkt.
//   in → Hochpass 140 Hz → Tiefpass 6 kHz ┬→ Delay → Gain → Pan ┐
//                                          ├→ …                  ├→ out
//                                          └→ Delay → Gain → Pan ┘

const TAPS = 5;

export class EarlyReflections {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.6;
    const lp = this.lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.5;
    this.output = ctx.createGain(); this.output.gain.value = 1;
    this.input.connect(hp).connect(lp);
    this.taps = [];
    for (let i = 0; i < TAPS; i++) {
      const d = ctx.createDelay(0.3), g = ctx.createGain();
      d.delayTime.value = 0.02 + i * 0.01; g.gain.value = 0;
      lp.connect(d).connect(g);
      let pan = null;
      if (ctx.createStereoPanner) { pan = ctx.createStereoPanner(); g.connect(pan).connect(this.output); } else g.connect(this.output);
      this.taps.push({ d, g, pan, cur: { delay: -1, gain: -1, pan: 9 } });
    }
    this.output.connect(dest);
    this.level = 1;
  }

  /** Abgriffe nachführen (aus Acoustics.taps). Nur bei merklicher Änderung neu planen. */
  set(list, tau = 0.06) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < TAPS; i++) {
      const tap = this.taps[i], s = list[i] || { delay: 0.05, gain: 0, pan: 0 }, c = tap.cur;
      const gain = s.gain * this.level;
      if (Math.abs(s.delay - c.delay) > 0.0008) { tap.d.delayTime.setTargetAtTime(s.delay, t, tau); c.delay = s.delay; }
      if (Math.abs(gain - c.gain) > 0.004) { tap.g.gain.setTargetAtTime(gain, t, tau); c.gain = gain; }
      if (tap.pan && Math.abs(s.pan - c.pan) > 0.03) { tap.pan.pan.setTargetAtTime(s.pan, t, 0.03); c.pan = s.pan; }
    }
  }

  /** Gesamtpegel (z. B. Mischprofil, Stufe). */
  setLevel(x) { this.level = x; for (const tap of this.taps) tap.cur.gain = -1; }

  dispose() {
    try { this.input.disconnect(); this.output.disconnect(); } catch { /* */ }
    for (const t of this.taps) { try { t.d.disconnect(); t.g.disconnect(); t.pan?.disconnect(); } catch { /* */ } }
  }
}
