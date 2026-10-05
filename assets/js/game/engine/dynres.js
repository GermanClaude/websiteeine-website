// NULLPUNKT — Dynamische Auflösung (§11a), geregelt nach den Bildkosten statt nach der reinen Bildrate.
//
// Eine niedrige Bildrate allein beweist keine Grafiküberlast: iOS-Stromsparmodus und Android-Akkusparer
// begrenzen requestAnimationFrame auf 30 Hz, auch wenn die GPU fast nichts zu tun hat. Deshalb:
//  - Messgrößen je Bild: Bildabstand (rAF-Zeitstempel) und Hauptthread-Arbeit (Simulation + Render-Aufruf),
//    ausgewertet als Median über ~1,5 s.
//  - Zielbild: Touch 30 FPS (zu langsam < 27), Desktop 60 FPS (zu langsam < 45). Eine 30-Hz-Sperre auf
//    dem Telefon löst also gar nichts aus.
//  - Ist es zu langsam und der Hauptthread nicht ausgelastet, wird die Auflösung probeweise um 0,15
//    gesenkt. Bringt das nach 2,5 s keine messbare Verbesserung, war es eine Bildratenbegrenzung oder
//    CPU-Last: Auflösung zurück, Plateau merken, nicht weiter absenken.
//  - Ist der Hauptthread selbst ausgelastet (Arbeit ≥ 85 % des Bildabstands), hilft Auflösung nicht → Plateau.
//  - Erholung: Bildrate am Ziel (bzw. am Plateau) und Arbeit < 60 % des Bildabstands für 6 s → +0,1.
//    Eine Skala, die sich als zu teuer erwiesen hat, wird erst nach einer Wartezeit erneut versucht
//    (30 s, danach jeweils doppelt so lang).
//  - Qualitätsstufen werden nie mitten im Match gewechselt (Shader-Neukompilierung = Ruckler):
//    reicht die Mindestskala nicht, merkt sich der Regler wantTierDrop; main wendet das beim
//    nächsten Matchstart an. stepUpOk() erlaubt eine Stufe zurück, wenn ein Match durchweg Reserve hatte.

const WINDOW_S = 1.5;
const MIN_SAMPLES = 8;
const EVAL_EVERY = 0.5;
const PROBE_S = 2.5;
const SLOW_HOLD = 3;
const GOOD_HOLD = 6;
const MIN_GAP = 3;

const median = (arr) => {
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export class DynamicResolution {
  /** @param {{touch?: boolean}} opts */
  constructor({ touch = false } = {}) {
    this.touch = !!touch;
    this._t = [];
    this._int = [];
    this._work = [];
    this.probe = null; // { from, to, fpsBefore, at }
    this.plateau = null; // FPS, bei der weniger Auflösung nichts bringt
    this.badScale = 2; // Skala, die zuletzt zu langsam war
    this.badUntil = 0;
    this.backoff = 30;
    this.lowSince = null;
    this.goodSince = null;
    this.lastChange = -1e9;
    this.lastEval = -1e9;
    this.wantTierDrop = false;
    this.evals = 0;
    this.goodEvals = 0;
    this.stats = { fps: 0, interval: 0, work: 0, load: 0 };
  }

  /** Schwellen in FPS: unter `low` ist es zu langsam, ab `good` gibt es Reserve. */
  get thresholds() {
    return this.touch ? { low: 27, good: 29.5 } : { low: 45, good: 55 };
  }

  /** Neues Match: Messungen verwerfen; Skala-Lernwerte nur bei gleicher Karte behalten (macht main). */
  reset() {
    this.clearSamples();
    this.probe = null;
    this.plateau = null;
    this.badScale = 2;
    this.badUntil = 0;
    this.backoff = 30;
    this.lastChange = -1e9;
    this.wantTierDrop = false;
    this.evals = 0;
    this.goodEvals = 0;
  }

  /** Pause/Zustandswechsel: angefangene Messungen sind nicht mehr vergleichbar. */
  clearSamples() {
    this._t.length = this._int.length = this._work.length = 0;
    this.lowSince = this.goodSince = null;
  }

  /** Ein Bild im Zustand 'playing': now = Echtzeit (s), intervalMs = rAF-Abstand, workMs = Hauptthread-Arbeit. */
  frame(now, intervalMs, workMs) {
    if (!(intervalMs > 0) || intervalMs > 250) return; // Hänger, Hintergrund-Tab, erstes Bild
    this._t.push(now);
    this._int.push(intervalMs);
    this._work.push(Math.max(0, workMs || 0));
    while (this._t.length > MIN_SAMPLES && now - this._t[0] > WINDOW_S) {
      this._t.shift();
      this._int.shift();
      this._work.shift();
    }
  }

  /**
   * Entscheidet höchstens alle 0,5 s. R = Renderer (resolutionScale, setResolutionScale).
   * floor = Mindestskala, canDropTier = Stufe darf beim nächsten Match sinken (quality 'auto').
   * Gibt 'down' | 'up' | 'revert' | null zurück (für Debug/Tests).
   */
  update(now, R, { floor = 0.55, canDropTier = false } = {}) {
    if (now - this.lastEval < EVAL_EVERY) return null;
    this.lastEval = now;
    if (this._int.length < MIN_SAMPLES || now - this._t[0] < 0.9) return null;
    const interval = median(this._int);
    const work = median(this._work);
    const fps = 1000 / interval;
    const load = work / interval;
    this.stats = { fps: Math.round(fps * 10) / 10, interval: Math.round(interval * 10) / 10, work: Math.round(work * 10) / 10, load: Math.round(load * 100) / 100 };
    const { low, good } = this.thresholds;
    const scale = R.resolutionScale;

    // Laufende Probe auswerten
    if (this.probe) {
      if (now - this.probe.at < PROBE_S) return null;
      const p = this.probe;
      this.probe = null;
      this.lastChange = now;
      this.clearSamples();
      if (fps >= p.fpsBefore * 1.1 || fps >= good) {
        // GPU-gebunden: geholfen. Die alte Skala gilt eine Weile als zu teuer.
        this.badScale = p.from;
        this.badUntil = now + this.backoff;
        this.backoff = Math.min(240, this.backoff * 2);
        return null;
      }
      // Kein Effekt → Bildratenbegrenzung oder CPU-Last: zurück und Plateau merken
      R.setResolutionScale(p.from);
      this.plateau = p.fpsBefore;
      return 'revert';
    }

    this.evals += 1;
    if (this.plateau && fps >= good) this.plateau = null; // Begrenzung aufgehoben (z. B. Sparmodus aus)
    const slow = fps < low && !(this.plateau && fps >= this.plateau * 0.85);
    const goodFps = this.plateau ? Math.min(good, this.plateau * 0.95) : good;
    const roomy = fps >= goodFps && load < 0.6;
    if (roomy && scale >= 0.999) this.goodEvals += 1;

    if (slow) {
      this.goodSince = null;
      if (this.lowSince == null) this.lowSince = now;
      if (now - this.lowSince < SLOW_HOLD || now - this.lastChange < MIN_GAP) return null;
      this.lowSince = now;
      if (load >= 0.85) { this.plateau = fps; return null; } // Hauptthread voll: Auflösung hilft nicht
      if (scale > floor + 0.01) {
        const to = Math.max(floor, Math.round((scale - 0.15) * 100) / 100);
        this.probe = { from: scale, to, fpsBefore: fps, at: now };
        R.setResolutionScale(to);
        this.lastChange = now;
        this.clearSamples();
        return 'down';
      }
      if (canDropTier) this.wantTierDrop = true;
      return null;
    }
    this.lowSince = null;

    if (roomy && scale < 0.999) {
      if (this.goodSince == null) this.goodSince = now;
      const next = Math.min(1, Math.round((scale + 0.1) * 100) / 100);
      const blocked = next >= this.badScale - 1e-3 && now < this.badUntil;
      if (!blocked && now - this.goodSince >= GOOD_HOLD && now - this.lastChange >= MIN_GAP) {
        R.setResolutionScale(next);
        this.lastChange = now;
        this.goodSince = now;
        this.clearSamples();
        return 'up';
      }
    } else {
      this.goodSince = null;
    }
    return null;
  }

  /** Nach einem Match: hatte es fast durchgehend Reserve bei voller Auflösung? */
  stepUpOk() {
    return this.evals >= 20 && this.goodEvals / this.evals >= 0.9 && !this.wantTierDrop;
  }
}
