// NULLPUNKT — Gehör (Owner: audio, Plan §10 A6): Dosis-Modell für Ohrenklingeln.
// Laute Ereignisse (nahe Explosion, Blendgranate, Schüsse in engen Räumen) erhöhen eine Dosis D, die mit
// τ ≈ 5–9 s abklingt. Aus D folgen: Klingeln R = smoothstep(0,12 … 1, D) → Tiefpass auf der Welt (dumpf)
// und ein Pfeifton 3,5–4,1 kHz (zwei leicht verstimmte Sinus, langsame Schwebung) auf dem Feedback-Bus.
// Gehörschutz (Einstellung) senkt die Dosis auf 45 % und den Pfeifton auf 35 %. Oszillatoren laufen nur,
// solange es klingelt.

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const NO_MUFFLE = 22000;

/** Grunddosis je Schussprofil (eigener Schuss im engen Raum, ohne Gehörschutz). */
export const SHOT_DOSE = { pistol: 0.022, pistol_heavy: 0.045, smg: 0.02, ar: 0.03, ar_heavy: 0.035, lmg: 0.035, sniper: 0.075, shotgun: 0.065 };

export class Hearing {
  constructor() {
    this.dose = 0; this.ring = 0; this.protection = false;
    this.ctx = null; this.dest = null; this.osc = null; this._quiet = 0; this._f = 3800;
    this.stats = { peakDose: 0, exposures: 0 };
  }

  attach(ctx, dest) { this.ctx = ctx; this.dest = dest; }
  setProtection(on) { this.protection = !!on; }

  /** Dosis hinzufügen (0 … ~1,6). Gibt die neue Dosis zurück. */
  expose(amount) {
    if (!(amount > 0)) return this.dose;
    const a = amount * (this.protection ? 0.45 : 1);
    this.dose = Math.min(2, this.dose + a);
    this.stats.exposures++; this.stats.peakDose = Math.max(this.stats.peakDose, this.dose);
    if (a > 0.25) this._f = 3500 + Math.random() * 600; // neuer Knall → neue Tonhöhe
    this._sync(0.06);
    return this.dose;
  }

  /** Sofort zurücksetzen (Respawn, Lobby). */
  reset() { this.dose = 0; this.ring = 0; this._sync(0.2); this._stop(); }

  /** Je Bild: Dosis abklingen lassen; liefert die Tiefpass-Frequenz der Welt (Hz). */
  update(dt) {
    if (this.dose > 0) {
      const tau = 5 + 4 * Math.min(1, this.dose); // starke Dosen klingen langsamer ab
      this.dose *= Math.exp(-dt / tau);
      if (this.dose < 0.004) this.dose = 0;
    }
    this.ring = smooth(0.12, 1, this.dose);
    this._sync(0.35);
    if (this.osc && this.ring < 0.01) { this._quiet += dt; if (this._quiet > 1.2) this._stop(); } else this._quiet = 0;
    return this.muffle;
  }

  /** Klingeln 1 → 650 Hz, 0,35 → ≈ 11 kHz, 0,1 → ≈ 19 kHz (logarithmisch). */
  get muffle() { return this.ring > 0.002 ? NO_MUFFLE * Math.pow(650 / NO_MUFFLE, Math.pow(this.ring, 1.6)) : NO_MUFFLE; }

  _level() { return this.ring * this.ring * 0.075 * (this.protection ? 0.35 : 1); }

  _sync(tau) {
    if (!this.ctx || !this.dest) return;
    const lvl = this._level();
    if (lvl > 0.0004 && !this.osc) this._start();
    if (!this.osc) return;
    const t = this.ctx.currentTime;
    this.osc.g.gain.setTargetAtTime(lvl, t, tau);
    this.osc.a.frequency.setTargetAtTime(this._f, t, 0.5);
    this.osc.b.frequency.setTargetAtTime(this._f * 1.0032, t, 0.5);
  }

  _start() {
    const ctx = this.ctx;
    try {
      const a = ctx.createOscillator(), b = ctx.createOscillator(), g = ctx.createGain(), mb = ctx.createGain();
      a.type = 'sine'; b.type = 'sine'; a.frequency.value = this._f; b.frequency.value = this._f * 1.0032;
      g.gain.value = 0; mb.gain.value = 0.55;
      a.connect(g); b.connect(mb).connect(g); g.connect(this.dest);
      a.start(); b.start();
      this.osc = { a, b, g, mb };
    } catch { this.osc = null; }
  }

  _stop() {
    const o = this.osc; if (!o) return;
    this.osc = null;
    try { const t = this.ctx.currentTime; o.g.gain.setTargetAtTime(0, t, 0.05); o.a.stop(t + 0.3); o.b.stop(t + 0.3); } catch { /* */ }
    setTimeout(() => { try { o.a.disconnect(); o.b.disconnect(); o.mb.disconnect(); o.g.disconnect(); } catch { /* */ } }, 600);
  }

  dispose() { this._stop(); this.ctx = null; this.dest = null; }
}
