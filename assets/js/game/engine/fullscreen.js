// NULLPUNKT — Vollbild wie in einem richtigen Spiel, auf jeder Plattform (G.fullscreen).
//
// - Fullscreen-API normalisiert: Standard, webkit (altes iPadOS/Safari, gibt kein Promise zurück),
//   moz/ms (alt). Wirft nie, lehnt nie unbehandelt ab.
// - request() MUSS synchron in einer Nutzergeste laufen (click, pointerup bei Touch, keydown außer Esc),
//   nie nach einem await: requestFullscreen verbraucht die Nutzeraktivierung. Pointer-Lock deshalb vorher
//   anfordern (Pointer-Lock-Spezifikation; main.js tut das).
// - Keine Tastatursperre, kein Abfangen von Esc: Esc verlässt Vollbild und Pointer-Lock wie im Browser üblich,
//   das Spiel pausiert über den Verlust des Pointer-Locks (main.js). Browser-Tastenkürzel bleiben unberührt.
// - Beim Betreten auf Touch: Querformat sperren.
// - Einstellung „fullscreen“: 'auto' (Standard) betritt das Vollbild nur bei klaren Spielaktionen – „Einsatz
//   starten“ (Matchstart), „Fortsetzen“ und auf Touch beim Tippen auf die Touch-Steuerung im laufenden Match
//   (z. B. nach der Android-Zurück-Geste) | 'off' (nur Knopf/Taste). Nie bei einem beliebigen Klick auf der Seite.
//   Ausdrückliches Verlassen per Knopf/Taste schaltet die Automatik bis zum nächsten ausdrücklichen Betreten ab.
// - Tasten: Alt+Enter (fest) und Aktion „fullscreen“ (Standard F11, umbelegbar).
// - Wake-Lock auf Touch-Geräten, solange ein Match läuft (countdown/playing/paused).
// - Ereignis 'fullscreen:change' { active, kind: 'api'|'standalone'|'none' }; body[data-fullscreen].
// - Wird von main.js dynamisch geladen (MODULES, optional): fehlt das Modul, bleibt G.fullscreen null und main.js
//   nutzt einen kleinen Ersatz (Knopf, Taste, Alt+Enter, Matchstart/Fortsetzen).

import { resolveBindings } from '../../shared/bindings.data.js';

const D = typeof document !== 'undefined' ? document : null;
const WAKE_STATES = new Set(['countdown', 'playing', 'paused']);
const CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
const ERROR_EVENTS = ['fullscreenerror', 'webkitfullscreenerror', 'mozfullscreenerror', 'MSFullscreenError'];
const MODS = { Control: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey', Meta: 'metaKey', OS: 'metaKey' };
const MAX_FAILS = 2;

/* -------------------------------------------------------------- Erkennung */

const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
const IN_APP_RE = [
  /\bInstagram/i, /\bFB[\w_]+\/|\bFBAN|\bFBAV|\bFacebook/i, /musical_ly|Bytedance|TikTok/i, /Snapchat/i,
  /\b(WAiOS|WA4A)\//i, /\bLine\//i, /LinkedInApp/i, /\bBarcelona/i, /\bMicroMessenger\//i, /\bTwitter/i, /\bPinterest/i,
];

function mm(q) {
  try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch { return false; }
}

/** Plattform (einmal beim Laden). Auch im Spiel per G.fullscreen.platform lesbar. */
export function detectPlatform(ua = UA) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const iPhone = /iPhone|iPod/.test(ua);
  const iPad = /iPad/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
  const ios = iPhone || iPad;
  const android = /Android/i.test(ua);
  let inApp = IN_APP_RE.some((re) => re.test(ua)) || (android && /; wv\)/.test(ua));
  try { if (typeof window !== 'undefined' && ('TelegramWebview' in window || 'TelegramWebviewProxy' in window)) inApp = true; } catch { /* */ }
  let embedded = false;
  try { embedded = typeof window !== 'undefined' && window.top !== window.self; } catch { embedded = true; }
  const iosBrowser = ios ? (/CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : /OPiOS|OPT\//.test(ua) ? 'opera' : inApp ? 'app' : 'safari') : null;
  const coarse = mm('(pointer: coarse)') && !mm('(any-pointer: fine)');
  const installed = nav.standalone === true || mm('(display-mode: standalone)')
    || (mm('(display-mode: fullscreen)') && (coarse || ios || android) && !fsElement());
  return { ios, iPhone, iPad, android, inApp, embedded, iosBrowser, installed, mac: /Macintosh|Mac OS X/.test(ua) && !iPad };
}

/* ------------------------------------------------------- API-Normalisierung */

function fsElement() {
  if (!D) return null;
  return D.fullscreenElement || D.webkitFullscreenElement || D.webkitCurrentFullScreenElement || D.mozFullScreenElement || D.msFullscreenElement || null;
}

function requestFn(el) {
  if (!el) return null;
  if (typeof el.requestFullscreen === 'function') return { kind: 'std', fn: el.requestFullscreen };
  if (typeof el.webkitRequestFullscreen === 'function') return { kind: 'webkit', fn: el.webkitRequestFullscreen };
  if (typeof el.webkitRequestFullScreen === 'function') return { kind: 'webkit', fn: el.webkitRequestFullScreen };
  if (typeof el.mozRequestFullScreen === 'function') return { kind: 'moz', fn: el.mozRequestFullScreen };
  if (typeof el.msRequestFullscreen === 'function') return { kind: 'ms', fn: el.msRequestFullscreen };
  return null;
}

function exitFn() {
  if (!D) return null;
  return D.exitFullscreen || D.webkitExitFullscreen || D.webkitCancelFullScreen || D.mozCancelFullScreen || D.msExitFullscreen || null;
}

function fsEnabledFlag() {
  if (!D) return false;
  for (const k of ['fullscreenEnabled', 'webkitFullscreenEnabled', 'mozFullScreenEnabled', 'msFullscreenEnabled']) {
    if (typeof D[k] === 'boolean') return D[k];
  }
  return null; // sehr altes WebKit ohne Flag
}

const swallow = (p) => { if (p && typeof p.then === 'function') p.then(null, () => {}); return p; };

/* ------------------------------------------- Installationsangebot (Chromium) */

// Früh abfangen (Modulauswertung vor bootstrap): Chromium feuert beforeinstallprompt kurz nach dem Laden.
let installEvent = null;
const installListeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { installEvent = e; installListeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { installEvent = null; installListeners.forEach((f) => f()); });
}

/* ------------------------------------------------------------------ Klasse */

export class FullscreenManager {
  /** @param G Spielkontext (settings, events, input, match). opts.autoDisabled: keine Automatik (Testläufe ?autostart=1). */
  constructor(G, { autoDisabled = false } = {}) {
    this.G = G;
    this.el = D ? D.documentElement : null;
    this.platform = detectPlatform();
    this.autoDisabled = !!autoDisabled;
    this.blocked = false; // Browser lehnt trotz Geste wiederholt ab (z. B. App-Browser, Richtlinie)
    this.lastError = null;
    this._req = requestFn(this.el);
    this._pending = false;
    this._fails = 0;
    this._optOut = false; // ausdrücklich verlassen → keine Automatik bis zum nächsten ausdrücklichen Betreten
    this._exitWanted = false; // ausdrückliches Verlassen noch nicht vollzogen (kam während des Betretens)
    this._autoAt = -1e9;
    this._active = !!fsElement();
    this._wakeLock = null;
    this._wakePending = false;
    this._noOpts = false;
    this._keys = [];
    this._off = [];
    this._reloadKeys();
    this._attach();
    this._applyBody();
  }

  /* ------------------------------------------------------------ Zustand */

  /** Element-Vollbild über die API möglich (mit Präfix-Rückfall). */
  get supported() {
    if (!this._req) return false;
    const f = fsEnabledFlag();
    return f === null ? true : f;
  }

  get active() { return !!fsElement(); }
  get pending() { return this._pending; }
  /** Als App gestartet (Home-Bildschirm/installiert): Browserleisten sind schon weg. */
  get standalone() { return this.platform.installed; }
  get kind() { return this.active ? 'api' : this.standalone ? 'standalone' : 'none'; }
  get setting() {
    const v = this.G.settings && typeof this.G.settings.get === 'function' ? this.G.settings.get('fullscreen') : null;
    return v === 'off' ? 'off' : 'auto';
  }
  get canLockOrientation() {
    const o = typeof screen !== 'undefined' ? screen.orientation : null;
    return this.supported && !!(o && typeof o.lock === 'function');
  }
  get installAvailable() { return !!installEvent; }

  /**
   * Warum kein Vollbild möglich ist (null = möglich):
   * 'iframe' (eingebettet ohne allow="fullscreen") | 'in-app' (App-Browser) | 'ios-no-api' (iPhone: Safari kennt
   * kein Element-Vollbild) | 'none' (Browser ohne API) | 'blocked' (API da, Anfragen scheitern trotz Geste).
   */
  get reason() {
    if (this.supported) return this.blocked ? (this.platform.inApp ? 'in-app' : this.platform.embedded ? 'iframe' : 'blocked') : null;
    if (this.platform.embedded && !this.platform.inApp) return 'iframe';
    if (this.platform.inApp) return 'in-app';
    if (this.platform.ios) return 'ios-no-api';
    return 'none';
  }

  /** Anleitung sinnvoll? (kein Vollbild möglich und nicht schon als App gestartet) */
  get needsGuide() { return !this.standalone && this.reason !== null; }

  /** Taste(n) der Aktion „fullscreen“ (Codes), z. B. ['F11']. */
  get keys() { return this._keys.slice(); }

  /* ------------------------------------------------------------ Aktionen */

  /**
   * Vollbild anfordern – synchron aus einer Nutzergeste aufrufen. user = ausdrücklicher Wunsch (Knopf/Taste):
   * hebt das Abschalten der Automatik auf. → true, wenn angefragt (oder schon aktiv/unterwegs).
   */
  request({ user = false } = {}) {
    if (user) this._optOut = false;
    this._exitWanted = false;
    if (!this.supported || !this.el) return false;
    if (this.active) { this._afterEnter(); return true; }
    if (this._pending) return true;
    // Ohne Nutzeraktivierung lehnt der Browser mit Konsolenwarnung ab (autostart, Esc, Gamepad) → still bleiben
    const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    if (ua && !ua.isActive) return false;
    const { kind, fn } = this._req;
    let ret;
    this._pending = true;
    this._userReq = !!user;
    try {
      if (kind === 'std') ret = fn.call(this.el, this._noOpts ? undefined : { navigationUI: 'hide' });
      else if (kind === 'webkit') {
        // Altes Safari (Mac) braucht ALLOW_KEYBOARD_INPUT für Tasten; iPadOS lehnt das Flag ab → dort ohne
        const flag = !this.platform.ios && typeof Element !== 'undefined' ? Element.ALLOW_KEYBOARD_INPUT : 0;
        ret = flag ? fn.call(this.el, flag) : fn.call(this.el);
      }
      else ret = fn.call(this.el);
    } catch (err) {
      this._pending = false;
      this._failed(err);
      return false;
    }
    if (ret && typeof ret.then === 'function') {
      ret.then(() => { this._pending = false; this._fails = 0; this._sync(); }, (err) => {
        this._pending = false;
        // Unbekannter Optionswert (künftige Browser): ohne Optionen erneut, solange die Geste noch gilt
        if (err && err.name === 'TypeError' && !this._noOpts) { this._noOpts = true; if (this.request({ user: this._userReq })) return; }
        this._failed(err);
        this._sync();
      });
    } else {
      // Präfix-API ohne Promise: Ergebnis kommt als (webkit)fullscreenchange/-error
      setTimeout(() => { if (this._pending) { this._pending = false; this._sync(); } }, 1500);
    }
    return true;
  }

  /**
   * Automatik (Einstellung 'auto') – nur aus klaren Spielaktionen aufrufen: „Einsatz starten“, „Fortsetzen“ (main.js)
   * und Tippen auf die Touch-Steuerung im laufenden Match (input.js, throttle 4000). throttle in ms.
   */
  auto({ throttle = 0 } = {}) {
    if (this.autoDisabled || this._optOut || this.blocked || this.setting !== 'auto' || !this.supported) return false;
    if (this.standalone && this._touch()) return false; // installierte App läuft schon randlos
    if (this.active || this._pending) return false;
    if (throttle && performance.now() - this._autoAt < throttle) return false;
    const ok = this.request();
    if (ok) this._autoAt = performance.now();
    return ok;
  }

  /** Vollbild verlassen. user = ausdrücklich (Knopf/Taste) → Automatik ruht bis zum nächsten Betreten. */
  exit({ user = false } = {}) {
    if (user) { this._optOut = true; this._exitWanted = true; }
    if (!this.active) return false;
    const fn = exitFn();
    if (!fn) return false;
    try { swallow(fn.call(D)); } catch { return false; }
    return true;
  }

  /** Umschalten (Knopf/Taste, aus einer Geste). → true wenn danach (voraussichtlich) Vollbild. */
  toggle() {
    if (this._pending) return true; // Anfrage läuft (schnelles Doppeldrücken): nicht abbrechbar → ignorieren statt Automatik abzuschalten
    if (this.active) { this.exit({ user: true }); return false; }
    return this.request({ user: true });
  }

  /** Installationsdialog (Chromium, beforeinstallprompt) – aus einer Geste. → Promise<'accepted'|'dismissed'|'unavailable'> */
  install() {
    const e = installEvent;
    if (!e || typeof e.prompt !== 'function') return Promise.resolve('unavailable');
    installEvent = null;
    try {
      const p = e.prompt();
      const choice = e.userChoice && typeof e.userChoice.then === 'function' ? e.userChoice : Promise.resolve(p);
      return choice.then((c) => (c && c.outcome) || 'dismissed', () => 'dismissed').finally(() => installListeners.forEach((f) => f()));
    } catch {
      return Promise.resolve('unavailable');
    }
  }

  /** Rückruf, wenn sich das Installationsangebot ändert. → Abmeldefunktion */
  onInstallChange(fn) { installListeners.add(fn); return () => installListeners.delete(fn); }

  dispose() {
    this._off.forEach((f) => f());
    this._off = [];
    this._releaseWake();
  }

  /* ------------------------------------------------------------ Intern */

  _touch() {
    const m = this.G.input && this.G.input.mode;
    return m ? m === 'touch' : mm('(pointer: coarse)');
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._off.push(() => target.removeEventListener(type, fn, opts));
  }

  _attach() {
    if (!D) return;
    // Chromium löst das request-Promise vor dem Ende des Übergangs auf; ein exitFullscreen() in diesem Fenster
    // (schnelles Doppeldrücken) kann verloren gehen → nach dem Übergang nachholen.
    for (const t of CHANGE_EVENTS) this._on(D, t, () => { this._sync(); if (this._exitWanted && this.active) this.exit(); });
    for (const t of ERROR_EVENTS) this._on(D, t, () => { if (this._pending) { this._pending = false; this._failed(new Error(t)); } this._sync(); });
    // Kein Vollbild auf beliebige Klicks/Tasten: nur Start/Fortsetzen (main.js), Touch-Steuerung (input.js), Knopf, Taste.
    // Tasten: Capture, vor deploy.js/strike-target.js (Enter ohne Alt-Prüfung)
    this._on(window, 'keydown', (e) => this._key(e), { capture: true });
    this._on(D, 'dragstart', (e) => { const t = e.target; if (!(t && t.closest && t.closest('input, textarea'))) e.preventDefault(); });
    this._on(D, 'visibilitychange', () => this._wake());
    const ev = this.G.events;
    if (ev && typeof ev.on === 'function') {
      const onState = () => this._wake();
      const onMode = () => this._wake();
      ev.on('match:state', onState);
      ev.on('input:mode', onMode);
      this._off.push(() => { ev.off && ev.off('match:state', onState); ev.off && ev.off('input:mode', onMode); });
    }
    const S = this.G.settings;
    if (S && typeof S.onChange === 'function') {
      const off = S.onChange((key, value) => {
        if (key === 'bindings') this._reloadKeys();
        // 'auto' gewählt: Automatik wieder erlaubt – wirksam ab dem nächsten Start/Fortsetzen (nicht sofort)
        if (key === 'fullscreen' && value === 'auto') this._optOut = false;
        if (key === 'fullscreen') this._emit();
      });
      if (typeof off === 'function') this._off.push(off);
    }
  }

  _reloadKeys() {
    try {
      const b = resolveBindings(this.G.settings ? this.G.settings.get('bindings') : null);
      this._keys = (b.kb && b.kb.fullscreen) || [];
    } catch { this._keys = ['F11']; }
  }

  /** Alt+Enter (fest) und Aktion „fullscreen“ (umbelegbar, Standard F11). */
  _key(e) {
    // Esc wird nie abgefangen (verlässt Vollbild/Pointer-Lock wie üblich); Wiederholungen ignorieren die Menüs selbst.
    if (e.repeat || !e.isTrusted) return;
    const inp = this.G.input;
    if (inp && inp._capture) return; // Tastenbelegung wird gerade aufgenommen
    const altEnter = (e.code === 'Enter' || e.code === 'NumpadEnter') && e.altKey && !e.ctrlKey && !e.metaKey;
    if (!altEnter && !this._matches(e)) return;
    if (!this.supported) return; // Browser-Vollbild (F11) nicht blockieren
    e.preventDefault();
    if (altEnter) e.stopImmediatePropagation(); // sonst löst Enter „Einsatz“/Zielwahl aus
    this.toggle();
  }

  _matches(e) {
    const t = e.target;
    const typing = t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
    for (const code of this._keys) {
      const parts = code.split('+');
      const trig = parts[parts.length - 1];
      if (trig !== e.code) continue;
      if (typing && !/^F\d{1,2}$/.test(trig)) continue;
      if (parts.length === 2) {
        const mod = MODS[parts[0].replace(/(Left|Right)$/, '')];
        if (mod && e[mod]) return true;
        continue;
      }
      if (!e.ctrlKey && !e.altKey && !e.metaKey) return true;
    }
    return false;
  }

  _failed(err) {
    this.lastError = err || null;
    // Nur zählen, wenn die Geste sicher war (sonst lehnen alte Browser ohne userActivation bei Esc/Gamepad ab)
    if (typeof navigator !== 'undefined' && navigator.userActivation) {
      this._fails += 1;
      if (this._fails >= MAX_FAILS && !this.blocked) { this.blocked = true; this._emit(); }
    }
    const ev = this.G.events;
    if (ev && typeof ev.emit === 'function') ev.emit('fullscreen:error', { error: err || null, user: !!this._userReq, blocked: this.blocked });
  }

  _sync() {
    const on = this.active;
    if (on === this._active) return;
    this._active = on;
    if (on) { this._pending = false; this._fails = 0; if (!this._exitWanted) this._optOut = false; this._afterEnter(); } else {
      // Verlassen (Esc, F11, Zurück-Geste, Knopf): nie automatisch neu betreten. Esc beendet am Desktop auch den
      // Pointer-Lock → Pause (main.js); das nächste „Fortsetzen“ bzw. „Einsatz starten“ betritt wieder (Einstellung 'auto').
      this._exitWanted = false;
    }
    this._applyBody();
    this._emit();
  }

  _afterEnter() {
    if (!this.active) return;
    if (this._touch()) {
      const o = typeof screen !== 'undefined' ? screen.orientation : null;
      if (o && typeof o.lock === 'function') { try { swallow(o.lock('landscape')); } catch { /* */ } }
    }
    this._wake();
  }

  _wantWake() {
    const st = this.G.match && this.G.match.state;
    return this._touch() && WAKE_STATES.has(st) && !(D && D.hidden);
  }

  /** Bildschirm wach halten, solange auf Touch ein Match läuft; nach visibilitychange neu anfordern. */
  _wake() {
    const wl = typeof navigator !== 'undefined' ? navigator.wakeLock : null;
    if (!wl || typeof wl.request !== 'function') return;
    if (!this._wantWake()) { this._releaseWake(); return; }
    if (this._wakeLock || this._wakePending) return;
    this._wakePending = true;
    let p;
    try { p = wl.request('screen'); } catch { this._wakePending = false; return; }
    if (!p || typeof p.then !== 'function') { this._wakePending = false; return; }
    p.then((s) => {
      this._wakePending = false;
      if (!this._wantWake()) { swallow(s.release && s.release()); return; }
      this._wakeLock = s;
      if (typeof s.addEventListener === 'function') s.addEventListener('release', () => { if (this._wakeLock === s) this._wakeLock = null; });
    }, () => { this._wakePending = false; });
  }

  _releaseWake() {
    const s = this._wakeLock;
    this._wakeLock = null;
    if (s && typeof s.release === 'function') { try { swallow(s.release()); } catch { /* */ } }
  }

  _applyBody() {
    if (D && D.body) D.body.dataset.fullscreen = this.kind;
  }

  _emit() {
    const ev = this.G.events;
    if (ev && typeof ev.emit === 'function') ev.emit('fullscreen:change', { active: this.active, kind: this.kind });
  }
}

/** Fabrik: G.fullscreen = createFullscreen(G, opts). */
export function createFullscreen(G, opts) {
  return new FullscreenManager(G, opts);
}
