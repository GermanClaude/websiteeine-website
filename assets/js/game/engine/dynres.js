// NULLPUNKT — Dynamische Auflösung (§11a), geregelt nach den Bildkosten statt nach der reinen Bildrate.
//
// Eine niedrige Bildrate allein beweist keine Grafiküberlast: iOS-Stromsparmodus und Android-Akkusparer
// begrenzen requestAnimationFrame auf 30 Hz, auch wenn die GPU fast nichts zu tun hat. Deshalb:
//  - Messgrößen je Bild: Bildabstand (rAF-Zeitstempel) und Hauptthread-Arbeit (Simulation + Render-Aufruf),
//    ausgewertet als Median über ~1,5 s.
//  - Zielbild: Touch 30 FPS (zu langsam < 27), Desktop 60 FPS (zu langsam < 45). Eine 30-Hz-Sperre auf
//    dem Telefon löst also gar nichts aus.
//  - Ist es zu langsam und der Hauptthread nicht ausgelastet, wird die Auflösung probeweise um 0,15
//    gesenkt. Bringt das nach 2,5 s keine messbare Verbesserung: Auflösung zurück; liegt die Bildrate auf einer
//    typischen Begrenzung (30/60 Hz …), Plateau merken und nichts weiter tun, sonst ist nicht die Pixelarbeit der
//    Engpass → Entlastungsstufen (21.10.).
//  - Ist der Hauptthread selbst ausgelastet (Arbeit ≥ 85 % des Bildabstands), hilft Auflösung nicht → Entlastung.
//  - Erholung: Bildrate am Ziel (bzw. am Plateau) und Arbeit < 60 % des Bildabstands für 6 s → +0,1.
//    Eine Skala, die sich als zu teuer erwiesen hat, wird erst nach einer Wartezeit erneut versucht
//    (30 s, danach jeweils doppelt so lang).
//  - Qualitätsstufen werden nie mitten im Match gewechselt (Shader-Neukompilierung = Ruckler):
//    reicht die Mindestskala nicht, merkt sich der Regler wantTierDrop; main wendet das beim
//    nächsten Matchstart an. stepUpOk() erlaubt eine Stufe zurück, wenn ein Match durchweg Reserve hatte.
//  - Entlastung (21.10.): reicht die Mindestskala nicht oder ist der Hauptthread voll, steigt `relief` (0–3) in
//    Schritten – Hebel ohne Neukompilierung, die Renderer, Effekte, Bots und Handkontakt selbst lesen (G.perf.relief):
//    Schatten seltener neu, AO/Lichtstrahlen, dann Bloom und Kantenglättung aus, weniger Partikel, Bots ferner
//    seltener animiert und ohne Schatten. Ab Stufe 2 merkt sich der Regler zusätzlich wantTierDrop (nächstes Match).
//    Mit Reserve sinkt sie wieder (langsamer als sie steigt; eine wieder nötige Stufe hält doppelt so lange).
//    Bloom und Kantenglättung (`postRelief`) fallen nur bei einem GPU-Engpass weg (Hauptthread nicht voll, kleinere
//    Auflösung hatte gewirkt bzw. ist fest eingestellt) – bei vollem Hauptthread sparen sie nichts, nur Bildqualität.
//  - Feste Auflösungsskala (Einstellung renderScale): lockScale – keine Proben und kein Hochskalieren, Entlastung und
//    Lernen der Stufe laufen trotzdem.

const WINDOW_S = 1.5;
const MIN_SAMPLES = 8;
const EVAL_EVERY = 0.5;
const PROBE_S = 2.5;
const SLOW_HOLD = 3;
const GOOD_HOLD = 6;
const MIN_GAP = 3;
export const RELIEF_MAX = 3;
const RELIEF_HOLD = 12; // s mit Reserve, bevor eine Entlastungsstufe zurückgenommen wird

/** Bildrate auf einer typischen Begrenzung (Bildschirmtakt/Stromsparmodus)? */
const nearCap = (fps) => [20, 24, 30, 40, 45, 48, 50, 60, 72, 75, 90, 120].some((c) => Math.abs(fps - c) <= c * 0.06);

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
    this.relief = 0;
    this.reliefHold = RELIEF_HOLD;
    this.reliefGoodSince = null;
    this.reliefEvals = 0; // Bewertungen mit Entlastung > 0 (für stepUpOk)
    this.scaleUseless = false; // Probe ohne Wirkung und keine typische Begrenzung → gleich Entlastung
    this.reliefGpu = false; // Entlastung wegen GPU-Engpass (dann auch Bloom/Kantenglättung aus)
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
    this.relief = 0;
    this.reliefHold = RELIEF_HOLD;
    this.reliefGoodSince = null;
    this.reliefEvals = 0;
    this.scaleUseless = false;
    this.reliefGpu = false;
  }

  /** Entlastungsstufe für die reinen Bildpässe (Bloom ab 2, Kantenglättung ab 3): nur bei GPU-Engpass. */
  get postRelief() { return this.reliefGpu ? this.relief : 0; }

  /** Pause/Zustandswechsel: angefangene Messungen sind nicht mehr vergleichbar. */
  clearSamples() {
    this._t.length = this._int.length = this._work.length = 0;
    this.lowSince = this.goodSince = this.reliefGoodSince = null;
  }

  /** Entlastung eine Stufe höher (Rückgabe 'relief') bzw. null, wenn schon am Anschlag. */
  _raiseRelief(now, canDropTier, gpu = false) {
    if (gpu) this.reliefGpu = true;
    if (this.relief >= RELIEF_MAX) { if (canDropTier) this.wantTierDrop = true; return null; }
    this.relief += 1;
    if (this.relief >= 2 && canDropTier) this.wantTierDrop = true;
    this.lastChange = now;
    this.reliefGoodSince = null;
    this.clearSamples();
    return 'relief';
  }

  /** Ein Bild im Zustand 'playing': now = Echtzeit (s), intervalMs = rAF-Abstand, workMs = Hauptthread-Arbeit. */
  frame(now, intervalMs, workMs) {
    if (!(intervalMs > 0) || intervalMs > 1000) return; // echte Hänger (GC, Tab im Hintergrund), erstes Bild
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
   * floor = Mindestskala, canDropTier = Stufe darf beim nächsten Match sinken (quality 'auto'), lockScale = feste
   * Auflösungsskala (keine Proben, kein Hochskalieren – nur Entlastung).
   * Gibt 'down' | 'up' | 'revert' | 'relief' | 'ease' | null zurück (für Debug/Tests).
   */
  update(now, R, { floor = 0.55, canDropTier = false, lockScale = false } = {}) {
    if (lockScale) { this.probe = null; floor = R.resolutionScale; }
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
      // Kein Effekt → zurück. Liegt die Bildrate auf einer typischen Begrenzung (Stromsparmodus 30 Hz, 60 Hz …), Plateau
      // merken und nichts weiter tun; sonst ist nicht die Pixelarbeit der Engpass (Ecken, Schattenpass, Draw Calls) –
      // dann helfen die Entlastungsstufen (21.10.)
      R.setResolutionScale(p.from);
      if (nearCap(p.fpsBefore)) this.plateau = p.fpsBefore;
      else this.scaleUseless = true;
      return 'revert';
    }

    this.evals += 1;
    if (this.relief > 0) this.reliefEvals += 1;
    if (this.plateau && fps >= good) this.plateau = null; // Begrenzung aufgehoben (z. B. Sparmodus aus)
    // Hauptthread voll: eine Bildratenbegrenzung (Plateau) ist es dann nicht – die Entlastung kann helfen
    const cpuBound = load >= 0.85;
    const slow = fps < low && (cpuBound || !(this.plateau && fps >= this.plateau * 0.85));
    const goodFps = this.plateau ? Math.min(good, this.plateau * 0.95) : good;
    const roomy = fps >= goodFps && load < 0.6;
    if (roomy && scale >= 0.999) this.goodEvals += 1;

    if (slow) {
      this.goodSince = null;
      this.reliefGoodSince = null;
      if (this.lowSince == null) this.lowSince = now;
      if (now - this.lowSince < SLOW_HOLD || now - this.lastChange < MIN_GAP) return null;
      this.lowSince = now;
      // Hauptthread voll bzw. Auflösung brachte nichts: CPU-/Pass-Hebel der Entlastung (Bots, Schattenpass, Partikel)
      if (cpuBound || this.scaleUseless) return this._raiseRelief(now, canDropTier, false);
      if (scale > floor + 0.01) {
        const to = Math.max(floor, Math.round((scale - 0.15) * 100) / 100);
        this.probe = { from: scale, to, fpsBefore: fps, at: now };
        R.setResolutionScale(to);
        this.lastChange = now;
        this.clearSamples();
        return 'down';
      }
      // Mindestskala erreicht (bzw. feste Skala), Hauptthread nicht voll → GPU-Engpass: auch Bildpässe dürfen weg
      return this._raiseRelief(now, canDropTier, true);
    }
    this.lowSince = null;

    // Entlastung zurücknehmen (vor dem Hochskalieren): länger Reserve als beim Steigen; musste die Stufe wieder
    // steigen, hält die nächste doppelt so lange (bis 2 min)
    if (this.relief > 0) {
      if (roomy) {
        if (this.reliefGoodSince == null) this.reliefGoodSince = now;
        if (now - this.reliefGoodSince >= this.reliefHold && now - this.lastChange >= MIN_GAP) {
          this.relief -= 1;
          if (!this.relief) this.reliefGpu = false;
          this.reliefHold = Math.min(120, this.reliefHold * 2);
          this.reliefGoodSince = now;
          this.lastChange = now;
          this.clearSamples();
          return 'ease';
        }
      } else this.reliefGoodSince = null;
      return null;
    }

    if (roomy && scale < 0.999 && !lockScale) {
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
    return this.evals >= 20 && this.goodEvals / this.evals >= 0.9 && !this.wantTierDrop && this.reliefEvals === 0;
  }
}
