// NULLPUNKT — Mischung (Owner: audio, Plan §10 A8): Wiedergabeprofile und „HDR-Audio“.
// Profile: Kopfhörer (HRTF ab hoher Qualität, voller Bass, Sub-Schicht), Lautsprecher (Equal-Power, etwas
// weniger Bass, mehr Verdichtung), Handy (Hochpass 150 Hz + Präsenzanhebung, starke Verdichtung, damit
// Schritte über den kleinen Lautsprecher hörbar bleiben). Die EQ-Kette sitzt vor dem Glue-Kompressor.
// HDR: laute Ereignisse öffnen ein „Fenster“; leise Klänge (Schritte, Foley, Atmo) werden um den Abstand
// zur Fensteroberkante gedämpft und kehren mit ≈ 10 dB/s zurück.

export const MIX_PRESETS = {
  kopfhoerer: { label: 'Kopfhörer', hp: 18, lowDb: 0, presDb: 0, presF: 3000, airDb: 0, glue: { threshold: -14, knee: 10, ratio: 2.5 }, makeup: 1, hrtf: true, sub: 1, er: 1 },
  lautsprecher: { label: 'Lautsprecher', hp: 35, lowDb: -2, presDb: 1, presF: 2800, airDb: 0.5, glue: { threshold: -17, knee: 8, ratio: 3 }, makeup: 1.08, hrtf: false, sub: 0.7, er: 0.9 },
  handy: { label: 'Handy', hp: 150, lowDb: 0, presDb: 4.5, presF: 2800, airDb: 2, glue: { threshold: -23, knee: 6, ratio: 4 }, makeup: 1.3, hrtf: false, sub: 0.25, er: 0.8 },
};
export const MIX_IDS = Object.keys(MIX_PRESETS);

/** 'auto' → Handy auf Touch-Geräten, sonst Kopfhörer. */
export function resolveMix(id, coarse) {
  if (MIX_PRESETS[id]) return id;
  return coarse ? 'handy' : 'kopfhoerer';
}

/** EQ-Kette: Hochpass → Low-Shelf 110 Hz → Präsenz (Peaking) → High-Shelf 7 kHz. */
export class MixChain {
  constructor(ctx) {
    this.ctx = ctx;
    const f = (type, freq, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = q; return n; };
    this.hp = f('highpass', 18, 0.7); this.low = f('lowshelf', 110); this.pres = f('peaking', 3000, 0.9); this.air = f('highshelf', 7000);
    this.hp.connect(this.low).connect(this.pres).connect(this.air);
    this.input = this.hp; this.output = this.air;
    this.id = null;
  }
  apply(p, glue, immediate = false) {
    const t = this.ctx.currentTime, set = (a, v) => (immediate ? (a.value = v) : a.setTargetAtTime(v, t, 0.05));
    set(this.hp.frequency, p.hp); set(this.low.gain, p.lowDb); set(this.pres.gain, p.presDb); set(this.pres.frequency, p.presF); set(this.air.gain, p.airDb);
    if (glue) { set(glue.threshold, p.glue.threshold); set(glue.knee, p.glue.knee); set(glue.ratio, p.glue.ratio); }
  }
}

/**
 * HDR-Fenster: push(levelDb) für laute Ereignisse (geschätzter Pegel am Hörer, 0 dB ≈ eigener Schuss).
 * duck() liefert die Dämpfung der leisen Busse in dB (≤ 0).
 */
export class HdrWindow {
  constructor() { this.top = -60; this.floor = -14; this.max = 9; }
  push(levelDb) { if (levelDb > this.top) this.top = levelDb; }
  update(dt) { this.top = Math.max(-60, this.top - 10 * dt); }
  duck() { return -Math.min(this.max, Math.max(0, (this.top - this.floor) * 0.55)); }
}
