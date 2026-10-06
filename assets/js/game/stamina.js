// NULLPUNKT — Ausdauer (Spieler und Bots): Sprint zehrt stetig, Rutschen/Springen/Klettern kosten je einen Anteil,
// Erholung nach kurzer Pause (im Stand/geduckt schneller als im Gehen, beim Rutschen/Klettern/in der Luft keine).
// Leer = erschöpft: Sprint und Rutschen gesperrt, bis wieder RESUME (30 %) erreicht sind (Hysterese). Die
// Sprint-Absicht (Taste halten, Umschalten, Touch-Sprintsperre) bleibt dabei bestehen und setzt danach von selbst
// wieder ein – nichts bleibt hängen, nichts muss neu gedrückt werden.
// Spielstil: styleFlags.staminaMult (GAME_STYLES; Realistisch zehrt schneller: ≈ 5 s statt ≈ 7 s Dauersprint).
// Rückmeldung: HUD-Balken (hud.js .h-stam), Atmung (audio.js Foley), strain → player.exertion (Kamera-Atmung,
// Zielwandern der Waffe über controller.winded).
//
// API (auch für andere Systeme, z. B. Sprint-Schwimmen): value 0…100, ratio 0…1, exhausted, canSprint, canSlide,
// drain(menge) einmalig, drainRate(proSekunde, dt) stetig, sprint(dt), update(dt, erholung) einmal je Bild nach
// allen Verbräuchen, reset(), deny() (kurzes Aufblinken des Balkens bei verweigerter Aktion). Keine Allokationen.

export const STAMINA_MAX = 100;
/** Einmalkosten (× Spielstil). */
export const STAMINA_COST = { slide: 28, jump: 9, mantle: 6 };
/** Erholungsart für update(): keine (Rutschen, Klettern, Luft), Gehen, Stand/geduckt. */
export const RECOVER = { none: 0, move: 1, still: 2 };
const SPRINT_TIME = 7; // s Dauersprint mit voller Ausdauer (Arcade)
const SLIDE_MIN = 20; // Rutschen braucht mindestens so viel (sonst nur Ducken)
const RESUME = 30; // erschöpft → ab hier wieder Sprint/Rutschen
const DELAY = 1; // s ohne Verbrauch bis zur Erholung
const RATE_STILL = 26; // Erholung/s im Stand oder geduckt (leer → voll ≈ 1 + 3,8 s)
const RATE_MOVE = 16; // Erholung/s im Gehen (leer → voll ≈ 1 + 6,3 s)
const DENY_TIME = 0.6; // s Aufblinken

export class Stamina {
  constructor() {
    this.value = STAMINA_MAX;
    this.exhausted = false;
    /** Verbrauchsfaktor des Spielstils (styleFlags.staminaMult). */
    this.mult = 1;
    /** > 0: eben verweigert (HUD blinkt). */
    this.deniedT = 0;
    this._idle = DELAY;
  }

  reset() {
    this.value = STAMINA_MAX;
    this.exhausted = false;
    this.deniedT = 0;
    this._idle = DELAY;
  }

  get ratio() { return this.value / STAMINA_MAX; }
  get canSprint() { return !this.exhausted && this.value > 0; }
  get canSlide() { return !this.exhausted && this.value >= SLIDE_MIN; }
  /** Schwelle, ab der eine Erschöpfung endet (0…1, HUD-Marke). */
  get resumeRatio() { return RESUME / STAMINA_MAX; }

  /** 0…1: Anstrengung durch knappe Ausdauer (unter 45 % steigend, erschöpft am stärksten) – Atmung, Zielwandern. */
  get strain() {
    const low = Math.min(1, Math.max(0, (45 - this.value) / 45));
    return low * 0.6 + (this.exhausted ? 0.3 : 0);
  }

  /** Spielstil übernehmen (styleFlags; ohne Angabe 1). */
  setStyle(flags) {
    const m = flags && Number.isFinite(flags.staminaMult) ? flags.staminaMult : 1;
    this.mult = m > 0 ? m : 1;
  }

  /** Einmaliger Verbrauch (× Spielstil); hält die Erholung an. */
  drain(amount) {
    if (!(amount > 0)) return;
    this.value = Math.max(0, this.value - amount * this.mult);
    this._idle = 0;
    if (this.value <= 0) this.exhausted = true;
  }

  /** Stetiger Verbrauch (Einheiten/s). */
  drainRate(rate, dt) {
    if (dt > 0) this.drain(rate * dt);
  }

  /** Sprint: volle Ausdauer reicht SPRINT_TIME s (× Spielstil). */
  sprint(dt) {
    this.drainRate(STAMINA_MAX / SPRINT_TIME, dt);
  }

  /** Verweigerte Aktion (Sprint/Rutschen ohne Ausdauer): Balken blinkt kurz. */
  deny() {
    this.deniedT = DENY_TIME;
  }

  /** Je Bild NACH allen Verbräuchen: Pause, dann Erholung je nach Art (RECOVER). */
  update(dt, mode = RECOVER.move) {
    if (!(dt > 0)) return;
    if (this.deniedT > 0) this.deniedT = Math.max(0, this.deniedT - dt);
    if (this._idle < DELAY) { this._idle += dt; return; }
    if (mode === RECOVER.none || this.value >= STAMINA_MAX) return;
    this.value = Math.min(STAMINA_MAX, this.value + (mode === RECOVER.still ? RATE_STILL : RATE_MOVE) * dt);
    if (this.exhausted && this.value >= RESUME) this.exhausted = false;
  }
}
