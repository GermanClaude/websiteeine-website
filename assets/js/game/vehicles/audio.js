// NULLPUNKT — Fahrzeugklänge: Motor-/Kettenschleifen werden live synthetisiert (WebAudio-Knoten im sfx-Bus der
// AudioEngine → Lautstärke, Hall/Begrenzer und Stummschaltung gelten mit), Einzelklänge (Kanone, MG, Abpraller,
// Aufprall) über die vorhandene API `G.audio.play(name, …)` (Katalognamen: explosion, boom_sub, ricochet,
// impact_metal, Waffenprofile lmg/ar_heavy). Höchstens MAX_VOICES Motoren gleichzeitig (nächste zuerst).
const MAX_VOICES = 3;
const RANGE = 95;

const PROFILES = {
  tank: { base: 34, span: 46, saw: 0.5, sq: 0.55, noise: 0.5, clank: 0.6, cut: 260, cutSpan: 1300, vol: 0.9 },
  car: { base: 52, span: 120, saw: 0.55, sq: 0.35, noise: 0.25, clank: 0, cut: 420, cutSpan: 2400, vol: 0.62 },
};

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
  return buf;
}

class EngineVoice {
  constructor(ctx, dest, profile, noise) {
    this.ctx = ctx;
    this.p = profile;
    const t = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createPanner();
    Object.assign(this.pan, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 7, maxDistance: 160, rolloffFactor: 1.15 });
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = profile.cut;
    this.lp.Q.value = 0.7;
    this.saw = ctx.createOscillator(); this.saw.type = 'sawtooth';
    this.sq = ctx.createOscillator(); this.sq.type = 'square';
    const gs = ctx.createGain(); gs.gain.value = profile.saw;
    const gq = ctx.createGain(); gq.gain.value = profile.sq;
    this.saw.connect(gs).connect(this.lp);
    this.sq.connect(gq).connect(this.lp);
    // Rauschen (Ansaug/Auspuff) + Kettenklappern (Bandpass, amplitudenmoduliert)
    this.n = ctx.createBufferSource(); this.n.buffer = noise; this.n.loop = true;
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 180; nb.Q.value = 0.8;
    this.gn = ctx.createGain(); this.gn.gain.value = profile.noise * 0.3;
    this.n.connect(nb).connect(this.gn).connect(this.lp);
    this.clank = null;
    if (profile.clank > 0) {
      const cb = ctx.createBiquadFilter(); cb.type = 'bandpass'; cb.frequency.value = 900; cb.Q.value = 2.5;
      this.gc = ctx.createGain(); this.gc.gain.value = 0;
      this.lfo = ctx.createOscillator(); this.lfo.type = 'square'; this.lfo.frequency.value = 6;
      const lg = ctx.createGain(); lg.gain.value = 0;
      this.lfoGain = lg;
      this.lfo.connect(lg).connect(this.gc.gain);
      const n2 = ctx.createBufferSource(); n2.buffer = noise; n2.loop = true; n2.playbackRate.value = 1.7;
      n2.connect(cb).connect(this.gc).connect(this.out);
      this.clank = n2;
      this.lfo.start(t); n2.start(t);
    }
    this.lp.connect(this.out);
    this.out.connect(this.pan).connect(dest);
    this.saw.start(t); this.sq.start(t); this.n.start(t);
    this.vehicle = null;
  }

  set(vehicle, listenerInside, dt) {
    const ctx = this.ctx, t = ctx.currentTime, p = this.p;
    const b = vehicle.body;
    // Triebwerkszustand (drivetrain.js; auf Abbildern schreibt ihn das Netz): Drehzahl → Tonhöhe, Last → Klangfarbe
    const D = b.drive;
    const on = vehicle.alive && (!D || D.rpm > 0 || D.rpmNorm > 0);
    const rpm = on ? Math.max(0, Math.min(1.15, D ? D.rpmNorm : b.rpm)) : 0;
    const load = on ? Math.max(0, Math.min(1, D ? D.throttle : Math.abs((b.controls && b.controls.throttle) || 0))) : 0;
    const dip = D && D.shifting ? 0.72 : 1; // Schaltpause: kurzer Einbruch (Zugkraftunterbrechung)
    const f = p.base + p.span * rpm;
    this.saw.frequency.setTargetAtTime(f, t, 0.06);
    this.sq.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.lp.frequency.setTargetAtTime((p.cut + p.cutSpan * (rpm * 0.6 + load * 0.4)) * dip * (listenerInside ? 0.55 : 1), t, 0.08);
    this.gn.gain.setTargetAtTime(p.noise * (0.12 + rpm * 0.4 + load * 0.35) * dip, t, 0.1);
    const vol = on ? p.vol * (listenerInside ? 0.55 : 1) * (0.5 + rpm * 0.4 + load * 0.25) * dip : 0;
    this.out.gain.setTargetAtTime(vol, t, D && D.shifting ? 0.05 : 0.12);
    if (this.clank) {
      const sp = Math.abs(b.trackSpeed[0]) + Math.abs(b.trackSpeed[1]);
      this.lfo.frequency.setTargetAtTime(3 + sp * 1.6, t, 0.1);
      const g = Math.min(1, sp / 10) * p.clank * (listenerInside ? 0.5 : 1);
      this.lfoGain.gain.setTargetAtTime(g * 0.5, t, 0.1);
      this.gc.gain.setTargetAtTime(g * 0.5, t, 0.1);
    }
    const pos = b.renderPos;
    if (this.pan.positionX) {
      this.pan.positionX.setTargetAtTime(pos.x, t, 0.03);
      this.pan.positionY.setTargetAtTime(pos.y, t, 0.03);
      this.pan.positionZ.setTargetAtTime(pos.z, t, 0.03);
    } else this.pan.setPosition(pos.x, pos.y, pos.z);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.08);
    const end = t + 0.5;
    for (const n of [this.saw, this.sq, this.n, this.clank, this.lfo]) if (n) try { n.stop(end); } catch { /* schon gestoppt */ }
    setTimeout(() => { try { this.out.disconnect(); this.pan.disconnect(); } catch { /* egal */ } }, 700);
  }
}

export class VehicleAudio {
  constructor(G) {
    this.G = G;
    this.voices = new Map(); // vehicle → EngineVoice
    this._noise = null;
    this._ctx = null;
  }

  _dest() {
    const A = this.G.audio;
    if (!A || A.silent || !A.ctx || !A.bus || !A.bus.sfx) return null;
    if (A.ctx.state !== 'running') return null;
    if (this._ctx !== A.ctx) { this._ctx = A.ctx; this._noise = noiseBuffer(A.ctx); }
    return A.bus.sfx;
  }

  update(dt, vehicles, listenerVehicle) {
    const dest = this._dest();
    if (!dest) { if (this.voices.size) this.stopAll(); return; }
    const cam = this.G.camera;
    if (!cam) return;
    const cp = cam.position;
    const ranked = [];
    for (const v of vehicles) {
      if (!v.alive) continue;
      const d = v.body.renderPos.distanceTo(cp);
      if (d > RANGE) continue;
      // Leerlauf ohne Besatzung: nur wenn sehr nah (Motor aus)
      if (!v.isOccupied) continue;
      ranked.push([d, v]);
    }
    ranked.sort((a, b) => a[0] - b[0]);
    const keep = new Set(ranked.slice(0, MAX_VOICES).map((x) => x[1]));
    for (const [v, voice] of this.voices) if (!keep.has(v)) { voice.stop(); this.voices.delete(v); }
    for (const v of keep) {
      let voice = this.voices.get(v);
      if (!voice) {
        voice = new EngineVoice(this._ctx, dest, PROFILES[v.def.sound] || PROFILES.car, this._noise);
        this.voices.set(v, voice);
      }
      voice.set(v, v === listenerVehicle && v.def.armored, dt);
    }
  }

  /** Einzelklang über die AudioEngine (fehlertolerant). */
  play(name, opts) {
    const A = this.G.audio;
    if (!A || typeof A.play !== 'function') return null;
    try { return A.play(name, opts); } catch { return null; }
  }

  /**
   * Ladeklänge im Turm (Nutzer 11.10.), live synthetisiert: 'greifen' (Granate aus dem Gestell: Schaben + Klacken),
   * 'einschieben' (Gleiten ins Rohr + dumpfer Anschlag), 'schliessen' (Keil fährt zu: metallisches Klirren), 'munition'
   * (Umschalten: Klicken), 'geladen' (Bereit-Klacken). vol: 1 im eigenen Turm, leiser für Nachbarn.
   */
  loadSound(kind, vol = 1) {
    const dest = this._dest();
    if (!dest) return;
    const ctx = this._ctx, t0 = ctx.currentTime, out = ctx.createGain();
    out.gain.value = 0.55 * vol;
    out.connect(dest);
    const burst = (at, dur, f, q, g, type = 'bandpass') => {
      const n = ctx.createBufferSource(); n.buffer = this._noise;
      const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
      const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t0 + at); gg.gain.linearRampToValueAtTime(g, t0 + at + 0.008); gg.gain.exponentialRampToValueAtTime(0.0008, t0 + at + dur);
      n.connect(bf); bf.connect(gg); gg.connect(out);
      n.start(t0 + at, Math.random() * 1.5); n.stop(t0 + at + dur + 0.05);
    };
    const ring = (at, freqs, dur, g) => {
      for (const [f, k] of freqs) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (0.98 + Math.random() * 0.04);
        const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t0 + at); gg.gain.linearRampToValueAtTime(g * k, t0 + at + 0.004); gg.gain.exponentialRampToValueAtTime(0.0006, t0 + at + dur * k);
        o.connect(gg); gg.connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
      }
    };
    const thump = (at, f, dur, g) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 1.8, t0 + at); o.frequency.exponentialRampToValueAtTime(f, t0 + at + 0.06);
      const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t0 + at); gg.gain.linearRampToValueAtTime(g, t0 + at + 0.005); gg.gain.exponentialRampToValueAtTime(0.0008, t0 + at + dur);
      o.connect(gg); gg.connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
    };
    if (kind === 'greifen') {
      burst(0, 0.12, 2400, 3, 0.35);                 // Riegel des Gestells
      burst(0.08, 0.45, 900, 1.2, 0.22);             // Hülse schabt aus dem Rohr
      thump(0.5, 70, 0.25, 0.5); ring(0.5, [[620, 1], [1580, 0.6]], 0.35, 0.12);
    } else if (kind === 'einschieben') {
      burst(0, 0.5, 600, 0.9, 0.25, 'lowpass');      // Gleiten
      burst(0.1, 0.4, 1800, 2, 0.12);
      thump(0.52, 55, 0.4, 0.9); ring(0.52, [[340, 1], [910, 0.7], [2210, 0.35]], 0.5, 0.2); burst(0.52, 0.12, 3000, 2, 0.4);
    } else if (kind === 'schliessen') {
      burst(0, 0.08, 4200, 4, 0.35);                 // Hebel
      thump(0.06, 80, 0.3, 0.8);
      ring(0.06, [[430, 1], [1130, 0.75], [2350, 0.45], [3720, 0.25]], 0.7, 0.24);
      burst(0.06, 0.1, 2600, 2, 0.5);
    } else if (kind === 'munition') {
      burst(0, 0.05, 3500, 5, 0.3); burst(0.07, 0.05, 2800, 5, 0.25);
    } else if (kind === 'geladen') {
      burst(0, 0.06, 3000, 4, 0.3); ring(0.02, [[880, 1]], 0.15, 0.05);
    }
    setTimeout(() => { try { out.disconnect(); } catch { /* */ } }, 2000);
  }

  stopAll() {
    for (const voice of this.voices.values()) voice.stop();
    this.voices.clear();
  }

  dispose() { this.stopAll(); }
}
