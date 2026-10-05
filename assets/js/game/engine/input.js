// NULLPUNKT — Eingabe (§5): Tastatur/Maus mit Pointer-Lock, Gamepad (Standard-Mapping), Gyro-Zielen und eine
// vollständige Touch-Oberfläche im Stil von COD Mobile (DOM-Elemente .tc-* in #touch-ui).
//
// Ausgabe pro Frame (nach update(dt)):
//   move  {x, y}   -1..1, y = vorwärts, x = rechts (normalisiert)
//   look  {dx, dy} Radiant für diesen Frame; dx > 0 = nach rechts drehen, dy > 0 = nach unten.
//                  Der Spieler rechnet yaw -= dx, pitch -= dy. Empfindlichkeit (je Gerät), FOV-/Zoom-Umrechnung,
//                  ADS-Faktor je Zoomstufe, Y-Faktor, invertY, Gyro und Zielhilfe sind bereits enthalten.
//   down(a) / pressed(a) / released(a) für die Aktionen in ACTIONS (physisch gehalten bzw. Flanken),
//   active(a)  logischer Zustand mit Halten/Umschalten (ads, lean_left, lean_right; Einstellungen *Mode).
//
// Belegung: frei änderbar (settings.bindings, Daten und Hilfen in shared/bindings.data.js) für Tastatur, Maus und
// Gamepad inkl. Akkorde („Pad6+Pad10“). Zusätzlich: aimTarget, lastDevice, label(), capture(), simulate.*,
// vibrate(), rumble(), Gyro (requestGyroPermission), Touch-Layout (applyTouchLayout, measureTouch).

import * as THREE from 'three';
import {
  ACTION_IDS, ACTION_BY_ID, resolveBindings, codeMap, findConflicts, codeLabel, isBindable,
  TOUCH_BUTTONS, aspectBucket, resolveTouchLayout, loadKeyboardLayout,
} from '../../shared/bindings.data.js';

/** Alle Aktionen (Reihenfolge wie ACTION_DEFS; die ursprünglichen 17 sind enthalten). */
export const ACTIONS = ACTION_IDS;

const MOUSE_RAD_PER_PX = 0.0022;
const TOUCH_RAD_PER_PX = 0.0054;
// Touch-Knöpfe, die beim Spiegeln (Linkshänder) die Plätze tauschen
const MIRROR_PAIR = { leanL: 'leanR', leanR: 'leanL' };
const PAD_YAW_RATE = 3.4; // rad/s bei Vollausschlag
const PAD_PITCH_RATE = 2.3;
const SOURCES = ['key', 'mouse', 'pad', 'touch', 'auto', 'sim'];
const DIGITAL = ['key', 'mouse', 'pad', 'sim'];
/** Aktionen, die input.js bei „Umschalten“ selbst einrastet (Sprint/Ducken entscheidet der Spieler). */
const LATCHABLE = new Set(['ads', 'lean_left', 'lean_right']);
const EMPTY = Object.freeze([]);

const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _to = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _best = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _ray = new THREE.Ray();
const ASSIST_RANGE = 60; // m: Zielhilfe/aimTarget
const CHEST = 0.62; // Anteil der Körperhöhe: Bezugspunkt für Bewegungsverfolgung
const D2R = Math.PI / 180;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Punkt auf der Körperachse eines Akteurs (Füße+0,3 m … Scheitel−0,12 m), der der Visierlinie am nächsten
 * liegt: Höhe der Visierlinie dort, wo sie die Achse horizontal passiert. Zielt man auf den Kopf, ist
 * das der Kopf – nicht ein fester Brustpunkt. Lehnt der Akteur (leanOffset), wandert die Achse oben mit.
 */
function axisPoint(actor, eye, dir, out) {
  const p = actor.position;
  const h = actor.body ? actor.body.height : 1.8;
  let y = p.y + h * CHEST;
  const hh = dir.x * dir.x + dir.z * dir.z;
  if (hh > 1e-6) {
    const t = ((p.x - eye.x) * dir.x + (p.z - eye.z) * dir.z) / hh;
    if (t > 0) y = eye.y + dir.y * t;
  }
  y = clamp(y, p.y + Math.min(0.3, h * 0.2), p.y + h - 0.12);
  out.set(p.x, y, p.z);
  const lo = actor.leanOffset;
  if (lo && (lo.x || lo.z)) {
    const k = clamp((y - p.y - h * 0.5) / (h * 0.5), 0, 1);
    out.x += lo.x * k;
    out.z += lo.z * k;
  }
  return out;
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** 1-Euro-Filter (Casiez et al.): glättet Zittern bei langsamer Bewegung, folgt schnellen Bewegungen ohne Verzug. */
class OneEuro {
  constructor(minCutoff = 1.6, beta = 0.25, dCutoff = 1) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }
  reset() { this.x = null; this.dx = 0; this.t = 0; }
  _a(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += (dx - this.dx) * this._a(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (x - this.x) * this._a(cutoff, dt);
    return this.x;
  }
}

/* ------------------------------------------------------------ SVG-Icons */
const I = (body, vb = '0 0 48 48') =>
  `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const LEAN = '<path d="M31 40c0-11-3-19-12-25"/><path d="M12 13l7 2-1 7"/><path d="M36 8v32" opacity=".45"/>';
const ICONS = {
  fire: I('<circle cx="24" cy="24" r="10"/><path d="M24 6v8M24 34v8M6 24h8M34 24h8"/><circle cx="24" cy="24" r="2" fill="currentColor" stroke="none"/>'),
  ads: I('<circle cx="24" cy="24" r="14"/><path d="M24 14v6M24 28v6M14 24h6M28 24h6"/>'),
  adsfire: I('<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="5.5" fill="currentColor" stroke="none"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7"/>'),
  reload: I('<path d="M36 18a13 13 0 1 0 1 12"/><path d="M37 9v9h-9"/>'),
  jump: I('<path d="M12 28l12-12 12 12"/><path d="M12 38l12-12 12 12" opacity=".45"/>'),
  crouch: I('<path d="M12 18l12 12 12-12"/><path d="M14 38h20"/>'),
  grenade: I('<circle cx="24" cy="28" r="11"/><path d="M19 17v-5h10v5M29 13c5 0 7 3 7 7"/><path d="M16 28h16" opacity=".5"/>'),
  tactical: I('<rect x="16" y="15" width="16" height="25" rx="3"/><path d="M19 15v-4h10v4M16 23h16M16 32h16"/><path d="M36 12l4-3M37 19h5" opacity=".6"/>'),
  melee: I('<path d="M10 38l6-6M14 34l20-20 6-4-4 6-20 20z"/><path d="M12 30l6 6"/>'),
  swap: I('<path d="M10 18h26l-6-6M38 30H12l6 6"/>'),
  leanL: I(LEAN),
  leanR: I(`<g transform="translate(48 0) scale(-1 1)">${LEAN}</g>`),
  light: I('<path d="M8 19h13l8-6v22l-8-6H8z"/><path d="M35 15l6-3M36 24h7M35 33l6 3"/>'),
  pause: I('<path d="M18 13v22M30 13v22"/>'),
  score: I('<path d="M12 14h24M12 24h24M12 34h24"/><circle cx="8" cy="14" r="1" fill="currentColor"/><circle cx="8" cy="24" r="1" fill="currentColor"/><circle cx="8" cy="34" r="1" fill="currentColor"/>'),
  streak: I('<path d="M24 8l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z"/>'),
  lock: I('<rect x="15" y="22" width="18" height="14" rx="2"/><path d="M19 22v-5a5 5 0 0 1 10 0v5"/>'),
  sprint: I('<path d="M14 30l10-10 10 10"/><path d="M14 20l10-10 10 10"/>'),
};

export class Input {
  constructor(G) {
    this.G = G;
    this.mode = detectTouchFirst() ? 'touch' : 'desktop';
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.locked = false;
    this.everLocked = false;
    this.enabled = false;
    /** Maustasten ohne Pointer-Lock zulassen (autostart/Tests). */
    this.allowUnlockedMouse = false;
    this.lastDevice = this.mode === 'touch' ? 'touch' : 'keyboard';
    this.aimTarget = null;
    this.adsToggled = false;
    this.sprintLock = false;
    /** Aufgelöste Belegung { kb: {aktion: [codes]}, pad: {…} } und ihre Konflikte. */
    this.bindings = resolveBindings(null);
    this.conflicts = [];
    /** true, solange capture() auf eine Taste wartet (Menüs sollten Eingaben dann ignorieren). */
    this.capturing = false;
    /** Gyro-Zielen: Zustand für Einstellungen/HUD. */
    this.gyro = { supported: gyroSupported(), permission: 'unknown', active: false, receiving: false };
    /** Aufgelöstes Touch-Layout (shared/bindings.data.js resolveTouchLayout) oder null vor attach(). */
    this.touchLayout = null;

    this._held = {};
    for (const s of SOURCES) this._held[s] = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this._latched = new Set();
    this._maps = { kb: codeMap(this.bindings, 'kb'), pad: codeMap(this.bindings, 'pad') };
    this._codes = { kb: new Map(), pad: new Map() }; // gehaltene Codes → { src, acts }
    this._kbLayout = null;
    this._capture = null;
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._touchDX = 0; // bereits in Radiant (Touch-Empfindlichkeit + Beschleunigung)
    this._touchDY = 0;
    this._gyroDX = 0; // Radiant (Gyro, vor FOV-Umrechnung)
    this._gyroDY = 0;
    this._padMove = { x: 0, y: 0 };
    this._padLook = { x: 0, y: 0 };
    this._padPrev = [];
    this._padActive = false;
    this._padAccel = 0;
    this._pad = null;
    this._lastRumble = 0;
    this._simMove = null;
    this._simTaps = new Set();
    this._wheelTaps = [];
    this._wheelAt = 0;
    this._listeners = [];
    this._subs = null;
    this._offSettings = null;
    this._los = new Map();
    this._autoPulse = 0;
    this._lastVibrate = 0;
    this._fsTriedAt = -1e9;
    this._track = null; // Rotationshilfe: letzte Peilung des Ziels
    this._uiRefreshAt = 0;
    this._touch = null; // Touch-Oberfläche (DOM + Zeiger-Zuordnung)
    this._gyroOn = false;
    this._gyroAsked = false;
    this._gyroT = -1;
    this._gUp = { x: 0, y: 0, z: 0, n: 0, flip: 1, bad: 0 };
    this._euroYaw = new OneEuro(1.6, 0.25);
    this._euroPitch = new OneEuro(1.6, 0.25);
    this._onMotion = (e) => this._motion(e);

    this.simulate = {
      look: (dxPx, dyPx) => { this._mouseDX += dxPx; this._mouseDY += dyPx; },
      press: (a) => this._press(a, 'sim'),
      release: (a) => this._release(a, 'sim'),
      tap: (a) => { this._press(a, 'sim'); this._simTaps.add(a); },
      move: (x, y) => { this._simMove = x == null ? null : { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; },
      clear: () => { this._held.sim.clear(); this._simMove = null; },
      /** Physische Taste über die Belegung (Tests): code wie „KeyQ“, „Mouse0“, „Pad6+Pad10“ wird zerlegt. */
      code: (code, down = true) => {
        const dev = code.startsWith('Pad') ? 'pad' : 'kb';
        const parts = code.split('+');
        if (down) for (const c of parts) this._codeDown(dev === 'pad' ? 'pad' : c.startsWith('Mouse') ? 'mouse' : 'key', dev, c);
        else for (const c of parts.reverse()) this._codeUp(dev, c);
      },
      gyro: (dxRad, dyRad) => { this._gyroDX += dxRad; this._gyroDY += dyRad; },
    };
  }

  /* ----------------------------------------------------------- Zustand */

  down(action) {
    const h = this._held;
    return h.key.has(action) || h.mouse.has(action) || h.pad.has(action) || h.touch.has(action) || h.auto.has(action) || h.sim.has(action);
  }
  pressed(action) { return this._pressed.has(action); }
  released(action) { return this._released.has(action); }

  /** 'hold' | 'toggle' für Aktionen mit wählbarem Verhalten (Touch: immer Umschalten). */
  behavior(action) {
    const key = ACTION_BY_ID[action] && ACTION_BY_ID[action].modeKey;
    if (!key) return 'hold';
    if (this.mode === 'touch') return 'toggle';
    const s = this.G.settings;
    return s && s.get(key) === 'toggle' ? 'toggle' : 'hold';
  }

  /**
   * Logischer Zustand: bei „Umschalten“ eingerastet (ads, lean_*), sonst gehalten. Touch-Knöpfe, Tests und
   * Auto-Feuer zählen immer als gehalten. Sprint/Ducken: siehe Player (dort entscheidet behavior()).
   */
  active(action) {
    if (LATCHABLE.has(action) && this.behavior(action) === 'toggle') {
      const h = this._held;
      return this._latched.has(action) || h.touch.has(action) || h.sim.has(action) || h.auto.has(action);
    }
    return this.down(action);
  }

  /** Eingerasteten Zustand setzen/lösen (z. B. Sprint beendet Zielen, Tod beendet Lehnen). */
  setActive(action, on) {
    if (on) {
      this._latched.add(action);
      if (action === 'lean_left') this._latched.delete('lean_right');
      if (action === 'lean_right') this._latched.delete('lean_left');
    } else {
      this._latched.delete(action);
      if (this._held.touch.has(action) && action !== 'ads') this._release(action, 'touch');
    }
    if (action === 'ads' && !on) this.cancelAds();
  }

  _press(action, src) {
    if (!this.enabled && src !== 'sim') return;
    const was = this.down(action);
    this._held[src].add(action);
    if (!was) this._pressed.add(action);
    // Umschalten: Flanke eines physischen Geräts schaltet den eingerasteten Zustand
    if (!was && LATCHABLE.has(action) && (src === 'key' || src === 'mouse' || src === 'pad') && this.behavior(action) === 'toggle') {
      this.setActive(action, !this._latched.has(action));
    }
  }

  _release(action, src) {
    if (!this._held[src].delete(action)) return;
    if (!this.down(action)) this._released.add(action);
  }

  _releaseSource(src) {
    for (const a of [...this._held[src]]) this._release(a, src);
    if (src === 'key' || src === 'mouse') { for (const [c, r] of [...this._codes.kb]) if (r.src === src) this._codes.kb.delete(c); }
    if (src === 'pad') this._codes.pad.clear(); // _padPrev bleibt: gehaltene Tasten lösen nicht erneut aus
  }

  releaseAll() {
    for (const s of SOURCES) this._releaseSource(s);
    this._codes.kb.clear();
    this._codes.pad.clear();
    this._latched.clear();
    this._wheelTaps.length = 0;
    this._mouseDX = this._mouseDY = this._touchDX = this._touchDY = this._gyroDX = this._gyroDY = 0;
    this.adsToggled = false;
    this.sprintLock = false;
    if (this._touch) this._touch.reset();
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.releaseAll();
    this._pressed.clear();
    this._released.clear();
  }

  /** ADS beenden: Touch-Umschalter und eingerastetes Zielen (Sprint, Tod, Respawn). */
  cancelAds() {
    this._latched.delete('ads');
    if (this.adsToggled) { this.adsToggled = false; this._release('ads', 'touch'); }
  }

  /** Kurzes haptisches Feedback (nur Touch, gedrosselt). ms = Dauer oder Muster [an, aus, an …]. */
  vibrate(ms = 10) {
    if (this.mode !== 'touch' || typeof navigator.vibrate !== 'function' || !navigator.userActivation?.hasBeenActive) return;
    const now = performance.now();
    if (now - this._lastVibrate < 60) return;
    this._lastVibrate = now;
    try { navigator.vibrate(ms); } catch { /* nicht erlaubt */ }
  }

  /** Gamepad-Vibration (S5): strong/weak 0..1, Dauer ms. Nur mit Gamepad als letztem Gerät und Einstellung an. */
  rumble(strong = 0.3, weak = 0.3, ms = 80) {
    const pad = this._pad;
    if (!pad || this.lastDevice !== 'gamepad' || !this.G.settings.get('padVibration')) return;
    const act = pad.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return;
    const now = performance.now();
    if (now - this._lastRumble < 40) return;
    this._lastRumble = now;
    try {
      const p = act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* nicht unterstützt */ }
  }

  _setMode(mode, device) {
    if (device) this.lastDevice = device;
    if (mode === this.mode) return;
    this.mode = mode;
    document.body.dataset.inputMode = mode;
    this._latched.clear();
    if (mode === 'touch') {
      this._releaseSource('mouse');
      this._releaseSource('key');
      if (this.locked) this.exitLock();
    } else if (this._touch) {
      this._releaseSource('touch');
      this._touch.reset();
    }
    this._gyroSync();
    if (this.G.events) this.G.events.emit('input:mode', { mode });
  }

  /* ------------------------------------------------------ Belegung */

  /** Belegung aus settings.bindings neu aufbauen (auch bei Änderungen zur Laufzeit). */
  reloadBindings() {
    const s = this.G.settings;
    this.bindings = resolveBindings(s ? s.get('bindings') : null);
    this.conflicts = findConflicts(this.bindings);
    this._maps.kb = codeMap(this.bindings, 'kb');
    this._maps.pad = codeMap(this.bindings, 'pad');
    // Gehaltene Tasten mit alter Bedeutung lösen
    for (const src of ['key', 'mouse', 'pad']) for (const a of [...this._held[src]]) this._release(a, src);
    this._codes.kb.clear();
    this._codes.pad.clear();
    // Akkord-Auslöser der Tastatur auch dann verfolgen, wenn der Modifikator selbst nichts auslöst
    this._kbMods = new Set();
    for (const list of this._maps.kb.chords.values()) for (const ch of list) this._kbMods.add(ch.mod);
  }

  /**
   * Beschriftung der Taste einer Aktion für Hinweise („F“, „X“, „LT + L3“). device: 'kb' | 'pad' | 'touch'
   * (Standard: zuletzt benutztes Gerät; Touch → ''). all: alle Belegungen mit „/“ verbunden.
   */
  label(action, device = null, { all = false, long = false } = {}) {
    const dev = device || (this.mode === 'touch' ? 'touch' : this.lastDevice === 'gamepad' ? 'pad' : 'kb');
    if (dev === 'touch') return '';
    const list = (this.bindings[dev] && this.bindings[dev][action]) || EMPTY;
    const opts = { long, layout: this._kbLayout };
    if (!list.length) return '';
    return all ? list.map((c) => codeLabel(c, opts)).join(' / ') : codeLabel(list[0], opts);
  }

  /**
   * Nächste Taste erfassen („Taste drücken …“): device 'kb' (Tastatur + Maus + Rad) oder 'pad' (Akkord: zweite
   * Taste, während die erste gehalten wird). Esc bzw. Menü-Taste oder Zeitablauf → null. Während der Erfassung
   * lösen Tasten keine Aktionen aus.
   */
  capture({ device = 'kb', timeout = 8000 } = {}) {
    this.cancelCapture();
    return new Promise((resolve) => {
      const c = {
        device, first: null, chord: null, down: new Set(),
        done: (code) => {
          if (this._capture !== c) return;
          clearTimeout(c.timer);
          this._capture = null;
          this.capturing = false;
          resolve(code);
        },
      };
      c.timer = setTimeout(() => c.done(null), Math.max(1000, timeout));
      c.ignore = null; // beim ersten Abfragen gedrückte Pad-Tasten (z. B. A, mit dem die Erfassung gestartet wurde)
      this._capture = c;
      this.capturing = true;
      // Menüs rufen update() nicht auf → Gamepad hier selbst abfragen
      if (device === 'pad') {
        const poll = () => {
          if (this._capture !== c) return;
          this._capturePoll(c);
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }
    });
  }

  _capturePoll(c) {
    if (typeof navigator.getGamepads !== 'function') return;
    let pad = null;
    for (const p of navigator.getGamepads()) if (p && p.connected) { pad = p; break; }
    if (!pad) return;
    const b = pad.buttons;
    const n = Math.min(b.length, 17);
    const now = [];
    for (let i = 0; i < n; i++) {
      const v = b[i] ? (typeof b[i] === 'object' ? (b[i].pressed ? Math.max(b[i].value, 0.5) : b[i].value) : b[i]) : 0;
      now[i] = v > (i === 6 || i === 7 ? 0.35 : 0.5);
    }
    if (!c.ignore) { c.ignore = new Set(); now.forEach((on, i) => { if (on) c.ignore.add(i); }); c.prev = now; return; }
    for (let i = 0; i < n; i++) if (!!now[i] !== !!c.prev[i]) this._padCapture(c, i, !!now[i]);
    c.prev = now;
  }

  cancelCapture() {
    if (this._capture) this._capture.done(null);
  }

  /** Code gedrückt (Tastatur/Maus/Gamepad): Akkorde zuerst, dann einfache Belegung. */
  _codeDown(src, device, code) {
    const rec = this._codes[device];
    if (rec.has(code)) return;
    const map = this._maps[device];
    let acts = null;
    const chords = map.chords.get(code);
    if (chords) for (const ch of chords) if (rec.has(ch.mod)) { acts = ch.actions; break; }
    if (!acts) acts = map.plain.get(code) || EMPTY;
    rec.set(code, { src, acts });
    for (const a of acts) this._press(a, src);
  }

  _codeUp(device, code) {
    const rec = this._codes[device];
    const r = rec.get(code);
    if (!r) return;
    rec.delete(code);
    for (const a of r.acts) {
      let still = false;
      for (const [, o] of rec) if (o.src === r.src && o.acts.includes(a)) { still = true; break; }
      if (!still) this._release(a, r.src);
    }
  }

  _bound(device, code) {
    const m = this._maps[device];
    return m.plain.has(code) || m.chords.has(code) || (device === 'kb' && !!this._kbMods && this._kbMods.has(code));
  }

  /* ------------------------------------------------------ Pointer-Lock */

  requestLock() {
    const canvas = this.G.canvas;
    if (this.mode === 'touch' || !canvas || !canvas.requestPointerLock || this.locked) return Promise.resolve(this.locked);
    const done = () => this.locked;
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.then === 'function') {
        return p.catch((err) => {
          if (err && err.name === 'NotSupportedError') {
            const q = canvas.requestPointerLock();
            return q && q.then ? q.catch(() => {}) : undefined;
          }
          return undefined;
        }).then(done);
      }
    } catch {
      try { canvas.requestPointerLock(); } catch { /* nicht verfügbar */ }
    }
    return Promise.resolve(this.locked);
  }

  exitLock() {
    if (document.pointerLockElement && document.exitPointerLock) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  /* ------------------------------------------------------- Listener */

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  attach(G) {
    this.G = G;
    this.detach();
    document.body.dataset.inputMode = this.mode;
    const canvas = G.canvas;
    const isFormField = (el) => el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]');
    this.reloadBindings();
    loadKeyboardLayout().then((m) => { this._kbLayout = m; });

    this._on(window, 'keydown', (e) => {
      const cap = this._capture;
      if (cap && cap.device === 'kb') {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') cap.done(null);
        else if (!e.repeat && isBindable(e.code, 'kb')) cap.done(e.code);
        return;
      }
      if (isFormField(e.target)) return;
      if (!this._bound('kb', e.code)) return;
      if (this.mode === 'touch' && e.isTrusted) this._setMode('desktop', 'keyboard'); else this.lastDevice = 'keyboard';
      if (!this.enabled) return;
      if (e.code !== 'Escape') e.preventDefault();
      if (!e.repeat) this._codeDown('key', 'kb', e.code);
    }, { capture: true });
    this._on(window, 'keyup', (e) => { this._codeUp('kb', e.code); });
    this._on(window, 'blur', () => this.releaseAll());

    // Erfassung: jede Maustaste (auch außerhalb der Leinwand)
    this._on(window, 'mousedown', (e) => {
      const cap = this._capture;
      if (!cap || cap.device !== 'kb') return;
      e.preventDefault();
      e.stopPropagation();
      const code = `Mouse${e.button}`;
      if (isBindable(code, 'kb')) cap.done(code);
    }, { capture: true });
    this._on(canvas, 'mousedown', (e) => {
      if (this.mode === 'touch' || e.sourceCapabilities?.firesTouchEvents) return;
      this.lastDevice = 'mouse';
      if (!this.enabled) return;
      if (!this.locked && !this.allowUnlockedMouse) {
        this.requestLock();
        return;
      }
      const code = `Mouse${e.button}`;
      if (this._bound('kb', code)) { e.preventDefault(); this._codeDown('mouse', 'kb', code); }
    });
    this._on(window, 'mouseup', (e) => { this._codeUp('kb', `Mouse${e.button}`); });
    this._on(document, 'mousemove', (e) => {
      if (this.mode === 'touch') return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      // Bekannter Chrome-Fehler: einzelne riesige Sprünge beim Pointer-Lock verwerfen.
      if (Math.abs(dx) > 450 || Math.abs(dy) > 450) return;
      if (this.locked || (this.allowUnlockedMouse && e.buttons && this.enabled)) {
        this._mouseDX += dx;
        this._mouseDY += dy;
        this.lastDevice = 'mouse';
      }
    });
    this._on(window, 'wheel', (e) => {
      const cap = this._capture;
      if (cap && cap.device === 'kb') {
        e.preventDefault();
        if (Math.abs(e.deltaY) >= 1) cap.done(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
        return;
      }
      if (!this.enabled) return;
      e.preventDefault();
      const now = performance.now();
      if (now - this._wheelAt < 160 || Math.abs(e.deltaY) < 1) return;
      this._wheelAt = now;
      const m = this._maps.kb.plain;
      const acts = [...(m.get('Wheel') || EMPTY), ...(m.get(e.deltaY < 0 ? 'WheelUp' : 'WheelDown') || EMPTY)];
      for (const a of acts) { this._press(a, 'mouse'); this._wheelTaps.push(a); }
    }, { passive: false });
    this._on(document, 'contextmenu', (e) => e.preventDefault());

    this._on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.everLocked = true;
      if (!this.locked) { this._releaseSource('mouse'); this._mouseDX = this._mouseDY = 0; }
      if (was !== this.locked && G.events) G.events.emit('input:lock', { locked: this.locked });
    });
    this._on(document, 'pointerlockerror', () => {
      if (G.events) G.events.emit('input:lock', { locked: false, error: true });
    });

    // Moduserkennung (echte Maus vs. Touch)
    this._on(window, 'pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') this._setMode('touch', 'touch');
      else if (e.pointerType === 'mouse' && this.mode === 'touch' && !e.sourceCapabilities?.firesTouchEvents) this._setMode('desktop', 'mouse');
    }, { capture: true });
    this._on(window, 'pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.mode === 'touch' && (Math.abs(e.movementX) + Math.abs(e.movementY)) > 2) this._setMode('desktop', 'mouse');
    }, { passive: true });

    // Zoom/Scroll/Pull-to-refresh unterbinden
    const stop = (e) => e.preventDefault();
    this._on(document, 'gesturestart', stop);
    this._on(document, 'dblclick', stop);
    this._on(document, 'touchmove', (e) => { if (!isScrollable(e.target)) e.preventDefault(); }, { passive: false });

    this._on(window, 'gamepadconnected', () => { this.lastDevice = 'gamepad'; });

    // Touch-Oberfläche
    const root = document.getElementById('touch-ui');
    if (root) {
      this._touch = new TouchUI(this, root);
      this._listeners.push(() => this._touch.destroy());
      this.applyTouchLayout();
      this._on(window, 'resize', () => { if (this._touch) this._touch.layoutDirty = true; });
    }

    // Einstellungen: Belegung, Touch-Layout, Gyro, Halten/Umschalten
    if (G.settings && typeof G.settings.onChange === 'function') {
      this._offSettings = G.settings.onChange((key) => {
        if (key === 'bindings') this.reloadBindings();
        else if (key === 'touchLayout' || key === 'touchOpacity' || key === 'touchButtonScale') this.applyTouchLayout();
        else if (key === 'gyroMode') { this._gyroSync(); }
        else if (key === 'adsMode' || key === 'leanMode') { this._latched.clear(); }
      });
    }
    this._gyroSync();

    // Abos (Haptik, Streak-Anzeige)
    this._subs = G.events.scope();
    // Haptik: Treffer/Abschüsse des Spielers und erlittener Schaden (nicht jeder Schuss – das ermüdet)
    this._subs.on('actor:hit', ({ attacker, killed }) => {
      if (!attacker || !attacker.isPlayer) return;
      this.vibrate(killed ? [18, 40, 26] : 10);
      this.rumble(killed ? 0.45 : 0.1, killed ? 0.6 : 0.35, killed ? 140 : 60);
    });
    this._subs.on('player:damaged', ({ amount }) => {
      this.vibrate(30);
      this.rumble(clamp((amount || 20) / 60, 0.25, 0.9), 0.35, 160);
    });
    this._subs.on('weapon:fire', ({ actor }) => { if (actor && actor.isPlayer) this.rumble(0.05, 0.16, 40); });
    this._subs.on('explosion', ({ position }) => {
      const p = G.player;
      if (!(p && p.alive && position)) return;
      const d = p.position.distanceTo(position);
      if (d < 12) this.vibrate(45);
      if (d < 18) this.rumble(clamp(1 - d / 18, 0.2, 1), 0.5, 320);
    });
    this._subs.on('streak:ready', ({ actor, streakId }) => { if (actor && actor.isPlayer && this._touch) this._touch.setStreak(streakId, true); });
    this._subs.on('streak:activate', ({ actor, streakId }) => { if (actor && actor.isPlayer && this._touch) this._touch.setStreak(streakId, false); });
    this._subs.on('match:state', ({ state }) => { if (state === 'loading' && this._touch) this._touch.resetStreaks(); });
  }

  detach() {
    while (this._listeners.length) this._listeners.pop()();
    if (this._subs) this._subs.dispose();
    this._subs = null;
    if (this._offSettings) this._offSettings();
    this._offSettings = null;
    this._touch = null;
    this.cancelCapture();
    if (this._gyroOn) { window.removeEventListener('devicemotion', this._onMotion); this._gyroOn = false; }
  }

  /* --------------------------------------------------------- Update */

  update(dt) {
    const G = this.G;
    const s = G.settings;
    this._pollGamepad(dt);

    // Bewegung: digitale Tasten (frei belegt), Gamepad-Stick, Touch-Stick, Tests – der stärkste Ausschlag gewinnt
    let mx = (this._digital('move_right') ? 1 : 0) - (this._digital('move_left') ? 1 : 0);
    let my = (this._digital('move_forward') ? 1 : 0) - (this._digital('move_back') ? 1 : 0);
    const kl = Math.hypot(mx, my);
    if (kl > 1) { mx /= kl; my /= kl; }
    let bx = mx, by = my, bm = Math.hypot(mx, my);
    const cand = (x, y) => { const m = Math.hypot(x, y); if (m > bm) { bx = x; by = y; bm = m; } };
    cand(this._padMove.x, this._padMove.y);
    if (this._touch) { const t = this._touch.moveVector(); cand(t[0], t[1]); }
    if (this._simMove) cand(this._simMove.x, this._simMove.y);
    this.move.x = this.enabled ? bx : 0;
    this.move.y = this.enabled ? by : 0;

    // Blick
    const player = G.player;
    const cam = G.camera;
    const fovScale = this._fovScale(player, cam);
    const ads = player && player.weapon ? player.weapon.adsProgress || 0 : 0;
    const zoom = player && player.adsZoom ? player.adsZoom : 1;
    const band = zoom < 1.75 ? 'adsSensitivity' : zoom < 5 ? 'adsSensitivityMid' : 'adsSensitivityHigh';
    const adsScale = 1 + ((s.get(band) ?? s.get('adsSensitivity')) - 1) * ads;
    const scale = fovScale * adsScale;
    const inv = s.get('invertY') ? -1 : 1;
    const yk = s.get('sensitivityY') ?? 1;
    const ms = MOUSE_RAD_PER_PX * s.get('sensitivity') * scale;
    const ps = (s.get('padSensitivity') ?? 1) * scale * dt;

    let dx = this._mouseDX * ms;
    let dy = this._mouseDY * ms * yk;
    dx += this._touchDX * scale;
    dy += this._touchDY * scale * yk;
    dx += this._padLook.x * PAD_YAW_RATE * ps;
    dy += this._padLook.y * PAD_PITCH_RATE * ps * yk;
    dy *= inv;
    // Gyro: 1:1-Drehung des Geräts (× Empfindlichkeit), nur FOV-Umrechnung, nie invertiert
    const gyroOn = this._gyroWanted(ads);
    this.gyro.active = gyroOn && this.gyro.receiving;
    if (gyroOn) { dx += this._gyroDX * fovScale; dy += this._gyroDY * fovScale; }
    this._mouseDX = this._mouseDY = this._touchDX = this._touchDY = this._gyroDX = this._gyroDY = 0;

    if (!this.enabled) { dx = 0; dy = 0; }
    this.look.dx = dx;
    this.look.dy = dy;

    this._assist(dt);
    if (this._touch) {
      const now = performance.now();
      if (now - this._uiRefreshAt > 100) { this._uiRefreshAt = now; this._touch.refresh(); }
    }
  }

  _digital(a) {
    const h = this._held;
    return h.key.has(a) || h.mouse.has(a) || h.pad.has(a) || h.sim.has(a);
  }

  /**
   * Umrechnung der Empfindlichkeit beim Zoomen (S4): Monitorabstand 0 % = Verhältnis der Tangenten (Bildmitte
   * bleibt gleich schnell), 75/100 % = gleiche Bildschirmstrecke an diesem Anteil des halben Bildes (waagerecht).
   */
  _fovScale(player, cam) {
    const baseFov = player && player.baseFov ? player.baseFov : (cam ? cam.fov : 70);
    const curFov = cam ? cam.fov : baseFov;
    const tb = Math.tan((baseFov * Math.PI) / 360);
    const tc = Math.tan((curFov * Math.PI) / 360);
    const coef = parseFloat(this.G.settings.get('zoomSensitivityCoef')) || 0;
    if (coef <= 0 || Math.abs(curFov - baseFov) < 0.01) return tc / tb;
    const asp = cam && cam.aspect ? cam.aspect : 16 / 9;
    return Math.atan(coef * tc * asp) / Math.atan(coef * tb * asp);
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
    for (const t of this._simTaps) this._held.sim.delete(t);
    this._simTaps.clear();
    if (this._wheelTaps.length) {
      for (const a of this._wheelTaps) {
        let still = false;
        for (const [, o] of this._codes.kb) if (o.src === 'mouse' && o.acts.includes(a)) { still = true; break; }
        if (!still) this._held.mouse.delete(a);
      }
      this._wheelTaps.length = 0;
    }
  }

  /* -------------------------------------------------------- Gamepad */

  _pollGamepad(dt) {
    if (typeof navigator.getGamepads !== 'function') return;
    let pad = null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this._pad = pad;
    if (!pad) {
      if (this._padActive) { this._releaseSource('pad'); this._padActive = false; }
      this._padMove.x = this._padMove.y = this._padLook.x = this._padLook.y = 0;
      return;
    }
    const s = this.G.settings;
    const b = pad.buttons;
    const val = (i) => (b[i] ? (typeof b[i] === 'object' ? (b[i].pressed ? Math.max(b[i].value, 0.5) : b[i].value) : b[i]) : 0);
    let activity = false;
    const capturing = !!(this._capture && this._capture.device === 'pad');
    const n = Math.min(b.length, 17);
    for (let i = 0; i < n; i++) {
      const on = val(i) > (i === 6 || i === 7 ? 0.35 : 0.5);
      const prev = !!this._padPrev[i];
      if (on === prev) continue;
      this._padPrev[i] = on;
      activity = true;
      if (capturing) continue; // Erfassung fragt selbst ab
      const code = `Pad${i}`;
      if (on) this._codeDown('pad', 'pad', code); else this._codeUp('pad', code);
    }

    // Sticks: radiale innere/äußere Totzone, Kurve je Einstellung, Sticks tauschbar (Linkshänder)
    const dz = clamp(s.get('padDeadzone') ?? 0.13, 0, 0.4);
    const outer = Math.max(dz + 0.05, s.get('padOuterDeadzone') ?? 1);
    const radial = (x, y, inner) => {
      const m = Math.hypot(x, y);
      if (m < inner || m < 1e-6) return [0, 0, 0];
      const k = Math.min(1, (m - inner) / Math.max(0.05, outer - inner));
      return [(x / m) * k, (y / m) * k, k];
    };
    const swap = !!s.get('padSwapSticks');
    const ax = pad.axes;
    const L = swap ? [ax[2] || 0, ax[3] || 0] : [ax[0] || 0, ax[1] || 0];
    const R = swap ? [ax[0] || 0, ax[1] || 0] : [ax[2] || 0, ax[3] || 0];
    const [lx, ly] = radial(L[0], L[1], Math.max(0.1, dz + 0.03));
    const [rx, ry, rm] = radial(R[0], R[1], dz);
    this._padMove.x = lx;
    this._padMove.y = -ly;
    const curve = s.get('padCurve') || 'classic';
    if (curve === 'classic') {
      // feine Kontrolle nahe der Mitte, je Achse (wie bisher)
      const c = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
      this._padLook.x = c(rx);
      this._padLook.y = c(ry);
      this._padAccel = 0;
    } else {
      // radial: Richtung bleibt exakt; dynamisch = S-Kurve + Beschleunigung am Rand (schnelle Drehungen)
      let f = rm;
      if (curve === 'dynamic') {
        f = 0.3 * rm + 0.7 * rm * rm * rm;
        this._padAccel = rm > 0.94 ? Math.min(0.45, this._padAccel + (dt || 0)) : 0;
        f *= 1 + 0.6 * smooth(0.12, 0.45, this._padAccel);
      } else this._padAccel = 0;
      const k = rm > 1e-6 ? f / rm : 0;
      this._padLook.x = rx * k;
      this._padLook.y = ry * k;
    }
    if (lx || ly || rx || ry) activity = true;
    if (activity) {
      this._padActive = true;
      if (this.mode === 'touch') this._setMode('desktop', 'gamepad'); else this.lastDevice = 'gamepad';
    }
  }

  /** Gamepad-Erfassung: erste Taste merken, zweite Taste bei gehaltener erster = Akkord; fertig beim Loslassen. */
  _padCapture(cap, i, on) {
    if (cap.ignore && cap.ignore.has(i)) { if (!on) cap.ignore.delete(i); return; }
    if (on) {
      if (i === 9 || i === 16) { cap.done(null); return; } // Menü/Home bricht ab
      cap.down.add(i);
      if (cap.first == null) cap.first = i;
      else if (cap.chord == null && cap.down.has(cap.first) && i !== cap.first) cap.chord = `Pad${cap.first}+Pad${i}`;
      return;
    }
    cap.down.delete(i);
    if (cap.down.size === 0 && cap.first != null) {
      const code = cap.chord || `Pad${cap.first}`;
      cap.done(isBindable(code, 'pad') ? code : null);
    }
  }

  /* ------------------------------------------------------------ Gyro */

  _gyroWanted(ads) {
    if (this.mode !== 'touch') return false;
    const m = this.G.settings.get('gyroMode');
    if (m === 'always') return true;
    if (m === 'ads') return ads > 0.3 || this.active('ads');
    return false;
  }

  /** Listener je nach Einstellung/Modus/Erlaubnis an- oder abmelden. */
  _gyroSync() {
    const g = this.gyro;
    const want = this.mode === 'touch' && g.supported && this.G.settings && this.G.settings.get('gyroMode') !== 'off' &&
      g.permission !== 'denied' && g.permission !== 'unsupported';
    if (want && !this._gyroOn) {
      window.addEventListener('devicemotion', this._onMotion);
      this._gyroOn = true;
      this._gyroT = -1;
      this._euroYaw.reset();
      this._euroPitch.reset();
    } else if (!want && this._gyroOn) {
      window.removeEventListener('devicemotion', this._onMotion);
      this._gyroOn = false;
      g.receiving = false;
    }
  }

  /**
   * Erlaubnis für Bewegungssensoren (S6). iOS 13+: nur aus einer Nutzergeste (Klick/Tippen) heraus aufrufen –
   * sonst lehnt Safari ab. Andere Browser: ohne Nachfrage. → Promise<'granted'|'denied'|'unsupported'>
   */
  requestGyroPermission() {
    const g = this.gyro;
    const DME = typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined;
    const set = (p) => {
      if (g.permission !== p) { g.permission = p; if (this.G.events) this.G.events.emit('input:gyro', { permission: p }); }
      this._gyroSync();
      return p;
    };
    if (!DME || !g.supported) return Promise.resolve(set('unsupported'));
    if (typeof DME.requestPermission !== 'function') return Promise.resolve(set('granted'));
    this._gyroAsked = true;
    let p;
    try { p = DME.requestPermission(); } catch { return Promise.resolve(g.permission); }
    return Promise.resolve(p).then((r) => set(r === 'granted' ? 'granted' : 'denied'), () => g.permission);
  }

  _motion(e) {
    const rr = e.rotationRate;
    if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
    const g = this.gyro;
    if (!g.receiving) g.receiving = true;
    if (g.permission === 'unknown') g.permission = 'granted';
    const t = (e.timeStamp || performance.now()) / 1000;
    const dt = this._gyroT < 0 ? 0 : clamp(t - this._gyroT, 0, 0.1);
    this._gyroT = t;
    // Nullpunkt aus der Gyro-Kalibrierung (Einstellungen gyroBiasX/Y/Z in °/s, ui-controls) abziehen
    const cal = this.G.settings;
    const wx = ((rr.beta || 0) - (cal.get('gyroBiasX') || 0)) * D2R, wy = ((rr.gamma || 0) - (cal.get('gyroBiasY') || 0)) * D2R, wz = ((rr.alpha || 0) - (cal.get('gyroBiasZ') || 0)) * D2R;
    // Bildschirmachsen im Gerätesystem je Ausrichtung
    const ang = screenAngle();
    let rx = 1, ry = 0, ux = 0, uy = 1;
    if (ang === 90) { rx = 0; ry = -1; ux = 1; uy = 0; } else if (ang === 270) { rx = 0; ry = 1; ux = -1; uy = 0; } else if (ang === 180) { rx = -1; ry = 0; ux = 0; uy = -1; }
    // Hochachse aus der Schwerkraft (Tiefpass) → „Spielerraum“-Gieren: Drehen um die echte Senkrechte
    const up = this._gUp;
    const a = e.accelerationIncludingGravity;
    if (a && a.x != null && dt > 0) {
      const k = 1 - Math.exp(-dt * 5);
      up.x += ((a.x || 0) - up.x) * k; up.y += ((a.y || 0) - up.y) * k; up.z += ((a.z || 0) - up.z) * k;
      up.n = Math.min(up.n + 1, 1000);
    }
    let yx = ux, yy = uy, yz = 0;
    const gl = Math.hypot(up.x, up.y, up.z);
    if (gl > 3 && up.n > 5) {
      yx = (up.x / gl) * up.flip; yy = (up.y / gl) * up.flip; yz = (up.z / gl) * up.flip;
      // Plausibilität: beim Spielen zeigt „oben“ nie vom Bildschirm-oben bzw. von der Vorderseite weg (manche Geräte melden das Vorzeichen umgekehrt)
      if (yx * ux + yy * uy + 0.5 * yz < -0.35) { up.bad += dt; if (up.bad > 0.6) { up.flip = -up.flip; up.bad = 0; } } else up.bad = 0;
    }
    let yaw = wx * yx + wy * yy + wz * yz; // > 0 = nach links
    let pitch = wx * rx + wy * ry; // > 0 = nach oben
    yaw = this._euroYaw.filter(yaw, t);
    pitch = this._euroPitch.filter(pitch, t);
    // weiche Totzone gegen Sensorrauschen (≈ 0,6–1,2 °/s)
    const soft = (v) => { const m = Math.abs(v); return m < 0.0105 ? 0 : m < 0.021 ? Math.sign(v) * (m - 0.0105) * 2 : v; };
    yaw = soft(yaw);
    pitch = soft(pitch);
    if (!dt || !this.enabled) return;
    const s = this.G.settings;
    this._gyroDX += -yaw * dt * (s.get('gyroSensitivityX') ?? 1);
    this._gyroDY += -pitch * dt * (s.get('gyroSensitivityY') ?? 1);
  }

  /* ------------------------------------- Zielhilfe + Auto-Feuer (Touch/Pad) */

  _assist(dt) {
    const G = this.G;
    const player = G.player;
    const assistDevice = this.mode === 'touch' || this.lastDevice === 'gamepad';
    this.aimTarget = null;
    if (!player || !player.alive || !this.enabled || !G.actors || !G.combat) { this._releaseSource('auto'); this._track = null; return; }

    player.getEyePosition(_eye);
    player.getAimDirection(_aim);
    const now = G.time ? G.time.elapsed : 0;
    let best = null;
    let bestScore = 1;
    let bestDist = 0;
    for (const a of G.actors) {
      if (!a.alive || a === player || !G.combat.isHostile(player, a)) continue;
      axisPoint(a, _eye, _aim, _pt);
      _to.subVectors(_pt, _eye);
      const dist = _to.length();
      if (dist < 0.6 || dist > ASSIST_RANGE) continue;
      const ang = Math.acos(clamp(_to.dot(_aim) / dist, -1, 1));
      const cone = clamp(Math.atan(0.95 / dist), 0.035, 0.13);
      if (ang > cone) continue;
      const score = ang / cone;
      if (score >= bestScore) continue;
      if (!this._visible(a, now, _pt)) continue;
      best = a;
      bestScore = score;
      bestDist = dist;
      _best.copy(_pt);
    }
    this.aimTarget = best;

    if (best && assistDevice && G.settings.get('aimAssist')) {
      const strength = clamp(G.settings.get('aimAssistStrength') ?? 1, 0, 1.5);
      const closeness = 1 - bestScore;
      const ads = player.weapon ? player.weapon.adsProgress || 0 : 0;
      const ux = this.look.dx; // Daumen/Stick dieses Bildes (vor der Hilfe)
      const uy = this.look.dy;
      // 1) Verlangsamung über dem Ziel (feinere Korrekturen möglich, nie Stillstand)
      const friction = 1 - Math.min(0.55, 0.4 * closeness * strength);
      this.look.dx *= friction;
      this.look.dy *= friction;

      // 2) Rotationshilfe (COD): Winkelbewegung des Ziels relativ zum Spieler teilweise mitführen –
      //    gleicht eigenes Seitwärtslaufen und laufende Gegner aus, zieht aber nie gegen den Daumen.
      const h = best.body ? best.body.height : 1.8;
      const bx = best.position.x - _eye.x;
      const by = best.position.y + h * CHEST - _eye.y;
      const bz = best.position.z - _eye.z;
      const bearYaw = Math.atan2(-bx, -bz);
      const bearPitch = Math.atan2(by, Math.hypot(bx, bz));
      const tr = this._track;
      const dYaw = tr ? wrapAngle(bearYaw - tr.yaw) : 0;
      const dPitch = tr ? bearPitch - tr.pitch : 0;
      // Sprünge (Respawn, Teleport) nicht mitführen
      if (tr && tr.actor === best && dt > 0 && Math.abs(dYaw) < 0.2 && Math.abs(dPitch) < 0.2) {
        const k = Math.min(0.95, (0.45 + 0.35 * ads) * closeness * strength);
        this.look.dx -= dYaw * k;
        this.look.dy -= dPitch * k * 0.5;
      }
      this._track = { actor: best, yaw: bearYaw, pitch: bearPitch };

      // 3) Leichter Zug zur Körperachse – nur in Aktion (laufen, feuern, zielen), und je Achse nur,
      //    wenn der Spieler nicht gerade vom Ziel weg zieht. Innerhalb der Körperhöhe zieht nichts nach
      //    unten zur Brust (Kopfschüsse bleiben möglich). Bezug ist die Laufrichtung (auch beim freien Zielen).
      const moving = Math.hypot(this.move.x, this.move.y) > 0.2;
      if (moving || this.down('fire') || ads > 0.5) {
        _to.subVectors(_best, _eye);
        const wantYaw = Math.atan2(-_to.x, -_to.z);
        const wantPitch = Math.asin(clamp(_to.y / bestDist, -1, 1));
        const yaw = Math.atan2(-_aim.x, -_aim.z);
        const pitch = Math.asin(clamp(_aim.y, -1, 1));
        const rate = (0.9 + 1.6 * ads) * closeness * strength * dt;
        const px = -clamp(wrapAngle(wantYaw - yaw), -rate, rate); // Beitrag zu look.dx
        const py = -clamp(wantPitch - pitch, -rate, rate) * 0.6;
        if (ux * px >= 0) this.look.dx += px;
        if (uy * py >= 0) this.look.dy += py;
      }
    } else {
      this._track = null;
    }

    // Auto-Feuer (Touch, „einfacher Modus“): feuert, solange die Visierlinie eine echte Trefferzone eines
    // sichtbaren Gegners schneidet (Kopf, Körper, Glieder) – in Waffenreichweite und wenn die Waffe bereit ist.
    const wpn = player.weapon;
    const autoOn = this.mode === 'touch' && G.settings.get('autoFire') && (!wpn || wpn.autoFireReady !== false) && !player.mantling;
    const target = autoOn ? this._autoFireTarget(player, wpn) : null;
    if (target) {
      const def = wpn && wpn.currentDef;
      const auto = def && def.fireMode === 'auto';
      if (auto) this._press('fire', 'auto');
      else {
        this._autoPulse -= dt;
        if (this._autoPulse <= 0) { this._autoPulse = 0.16; this._press('fire', 'auto'); } else this._release('fire', 'auto');
      }
    } else {
      this._releaseSource('auto');
    }
  }

  /** Gegner, dessen Trefferzonen die Visierlinie schneidet (freie Sicht, ≤ autoFireRange) – sonst null. */
  _autoFireTarget(player, wpn) {
    const G = this.G;
    const range = (wpn && wpn.autoFireRange) || ASSIST_RANGE;
    _ray.origin.copy(_eye);
    _ray.direction.copy(_aim);
    let best = null;
    let bestD = range;
    for (const a of G.actors) {
      if (!a.alive || a === player || typeof a.raycastHitboxes !== 'function' || !G.combat.isHostile(player, a)) continue;
      // Grobfilter: Abstand der Körpermitte zur Visierlinie > 1,2 m → kann nicht treffen
      const h = a.body ? a.body.height : 1.8;
      _to.copy(a.position);
      _to.y += h * 0.5;
      _to.sub(_eye);
      const along = _to.dot(_aim);
      if (along <= 0 || along > bestD + 1.5 || _to.lengthSq() - along * along > 1.44) continue;
      const hit = a.raycastHitboxes(_ray, bestD);
      if (hit && hit.distance < bestD) {
        best = a;
        bestD = hit.distance;
        _hit.copy(hit.point);
      }
    }
    if (!best) return null;
    const w = G.world;
    return !w || !w.lineOfSight || w.lineOfSight(_eye, _hit) ? best : null;
  }

  _visible(actor, now, point) {
    const w = this.G.world;
    if (!w || !w.lineOfSight) return true;
    const c = this._los.get(actor);
    if (c && now - c.t < 0.12) return c.v;
    const v = w.lineOfSight(_eye, point);
    this._los.set(actor, { t: now, v });
    if (this._los.size > 64) this._los.clear();
    return v;
  }

  /* ------------------------------------------------------- Touch-Layout */

  /**
   * Touch-Layout anwenden (S7). layout = touchLayout-Objekt (Vorschau im Editor, wird nicht gespeichert) oder
   * weglassen = aus den Einstellungen. Wirkt sofort auf die DOM-Knöpfe in #touch-ui.
   */
  applyTouchLayout(layout) {
    const t = this._touch;
    const s = this.G.settings;
    if (!t) return null;
    const src = layout !== undefined ? layout : (s ? s.get('touchLayout') : null);
    const r = t.root.getBoundingClientRect();
    const aspect = aspectBucket(r.width || window.innerWidth, r.height || window.innerHeight);
    this.touchLayout = resolveTouchLayout(src, aspect);
    t.applyLayout(this.touchLayout, {
      opacity: s ? s.get('touchOpacity') ?? 1 : 1,
      scale: s ? s.get('touchButtonScale') ?? 1 : 1,
    });
    return this.touchLayout;
  }

  /**
   * Lage der Touch-Knöpfe messen (Editor): { aspect, buttons: { id: { x, y, w, h, visible } } } – Mitte und Größe in %
   * von #touch-ui. defaults: true = Lage laut game.css/Standard (eigene Lagen kurz entfernt). #touch-ui muss sichtbar sein.
   */
  measureTouch({ defaults = false } = {}) {
    return this._touch ? this._touch.measure(defaults) : null;
  }

  /* ------------------------------------------------- Vollbild (Touch) */

  /**
   * Vollbild nach Verlassen (Android: Zurück-Geste) wiederherstellen. Nur aus pointerup/touchend aufrufen –
   * bei Touch ist pointerdown keine Nutzeraktivierung, der Browser würde mit Konsolenwarnung ablehnen.
   */
  _maybeFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !document.fullscreenEnabled || !el.requestFullscreen) return;
    const st = this.G.match && this.G.match.state;
    if (st !== 'playing' && st !== 'countdown') return;
    const ua = navigator.userActivation;
    if (ua && !ua.isActive) return;
    const now = performance.now();
    if (now - this._fsTriedAt < 4000) return;
    this._fsTriedAt = now;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock ? screen.orientation.lock('landscape').catch(() => {}) : null)
      .catch(() => {});
  }

  /** Aus pointerup (Nutzergeste): iOS-Gyro-Erlaubnis einmal erfragen, wenn Gyro-Zielen eingeschaltet ist. */
  _maybeGyroPermission() {
    if (this._gyroAsked || this.gyro.permission !== 'unknown' || !this.gyro.supported) return;
    if (this.G.settings.get('gyroMode') === 'off') return;
    const DME = window.DeviceMotionEvent;
    if (!DME || typeof DME.requestPermission !== 'function') return;
    this.requestGyroPermission();
  }
}

function detectTouchFirst() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
}

function gyroSupported() {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return false;
  return !!(window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches);
}

function screenAngle() {
  let a = 0;
  if (typeof screen !== 'undefined' && screen.orientation && Number.isFinite(screen.orientation.angle)) a = screen.orientation.angle;
  else if (typeof window !== 'undefined' && Number.isFinite(window.orientation)) a = window.orientation;
  a = ((Math.round(a / 90) * 90) % 360 + 360) % 360;
  return a;
}

function isScrollable(el) {
  return !!(el && el.closest && el.closest('[data-scrollable], .np-scroll'));
}

/* ======================================================================
 * Touch-Oberfläche (COD-Mobile-Stil)
 *  - Stick-Hälfte (Standard links, Layout „Linkshänder“ rechts): schwebender (oder fester) Joystick; nach oben
 *    über den Rand → Sprint-Sperre
 *  - übrige Fläche: Blick ziehen (mit Beschleunigungskurve)
 *  - großer Feuerknopf: halten = feuern, gleichzeitig ziehen = zielen
 *  - Knöpfe: linker Feuerknopf, ADS (Umschalter), Zielen+Feuern, Nachladen, Springen, Ducken/Rutschen,
 *    Granate, taktische Granate, Messer, Lehnen links/rechts, Lampe, Waffenwechsel, Serien 1–3, Tabelle, Pause
 *  - Lage/Größe/Deckkraft/Sichtbarkeit je Knopf aus settings.touchLayout (applyLayout)
 * ==================================================================== */

const BTN_HTML = (cls, action, label, icon, extra = '') =>
  `<div class="tc-btn ${cls}" data-action="${action}" role="button" aria-label="${label}"${extra}>${icon}</div>`;

class TouchUI {
  constructor(input, root) {
    this.input = input;
    this.root = root;
    this.pointers = new Map(); // pointerId → { kind, ... }
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, mx: 0, my: 0, inLock: false };
    this.streakState = {};
    this.layout = null;
    this.layoutDirty = false;
    this._side = 'left';
    this._fixed = false;
    this._rest = null; // { x, y } in % (eigene Ruhelage des Sticks)
    this._stickScale = 1;
    this._auto = {}; // id → zuletzt gesetzte automatische Sichtbarkeit
    this._baseS = new Map();
    this._cache = {};
    this._listeners = [];
    this._build();
    this._bind();
  }

  _build() {
    const r = this.root;
    r.classList.add('tc-ready');
    r.innerHTML = `
      <div class="tc-stick" data-idle="1">
        <div class="tc-stick-lock" aria-hidden="true">${ICONS.lock}<span>Sprint</span></div>
        <div class="tc-stick-base"></div>
        <div class="tc-stick-knob"></div>
      </div>
      ${BTN_HTML('tc-fire tc-fire-r', 'fire', 'Feuern', ICONS.fire)}
      ${BTN_HTML('tc-fire tc-fire-l', 'fire', 'Feuern (links)', ICONS.fire)}
      ${BTN_HTML('tc-ads', 'ads', 'Zielen', ICONS.ads, ' data-toggle="1"')}
      ${BTN_HTML('tc-adsfire', 'adsfire', 'Zielen und feuern', ICONS.adsfire)}
      ${BTN_HTML('tc-reload', 'reload', 'Nachladen', ICONS.reload)}
      ${BTN_HTML('tc-jump', 'jump', 'Springen', ICONS.jump)}
      ${BTN_HTML('tc-crouch', 'crouch', 'Ducken / Rutschen', ICONS.crouch)}
      <div class="tc-btn tc-grenade" data-action="grenade" role="button" aria-label="Granate">${ICONS.grenade}<span class="tc-badge">1</span></div>
      <div class="tc-btn tc-tactical" data-action="tactical" role="button" aria-label="Taktische Granate">${ICONS.tactical}<span class="tc-badge">1</span></div>
      ${BTN_HTML('tc-melee', 'melee', 'Messer', ICONS.melee)}
      ${BTN_HTML('tc-lean tc-lean-l', 'lean_left', 'Links lehnen', ICONS.leanL, ' data-toggle="1"')}
      ${BTN_HTML('tc-lean tc-lean-r', 'lean_right', 'Rechts lehnen', ICONS.leanR, ' data-toggle="1"')}
      ${BTN_HTML('tc-light', 'light', 'Lampe', ICONS.light)}
      <div class="tc-btn tc-swap" data-action="swap" role="button" aria-label="Waffe wechseln">${ICONS.swap}<span class="tc-swap-name">—</span></div>
      <div class="tc-streaks">
        <div class="tc-btn tc-streak" data-action="streak1" role="button" aria-label="Serie 1">${ICONS.streak}</div>
        <div class="tc-btn tc-streak" data-action="streak2" role="button" aria-label="Serie 2">${ICONS.streak}</div>
        <div class="tc-btn tc-streak" data-action="streak3" role="button" aria-label="Serie 3">${ICONS.streak}</div>
      </div>
      <div class="tc-btn tc-score" data-action="scoreboard" data-toggle="1" role="button" aria-label="Punktetabelle">${ICONS.score}</div>
      <div class="tc-btn tc-pause" data-action="pause" role="button" aria-label="Pause">${ICONS.pause}</div>
    `;
    this.el = {
      stick: r.querySelector('.tc-stick'),
      base: r.querySelector('.tc-stick-base'),
      knob: r.querySelector('.tc-stick-knob'),
      lock: r.querySelector('.tc-stick-lock'),
      ads: r.querySelector('.tc-ads'),
      score: r.querySelector('.tc-score'),
      badge: r.querySelector('.tc-grenade .tc-badge'),
      grenade: r.querySelector('.tc-grenade'),
      tactical: r.querySelector('.tc-tactical'),
      tacBadge: r.querySelector('.tc-tactical .tc-badge'),
      leanL: r.querySelector('.tc-lean-l'),
      leanR: r.querySelector('.tc-lean-r'),
      swapName: r.querySelector('.tc-swap-name'),
      reload: r.querySelector('.tc-reload'),
      streaks: [...r.querySelectorAll('.tc-streak')],
    };
    this.items = {};
    for (const b of TOUCH_BUTTONS) this.items[b.id] = r.querySelector(b.sel);
    this._applyStreakIcons();
  }

  _applyStreakIcons() {
    const data = this.input.G.data;
    const streaks = data && data.STREAKS ? Object.values(data.STREAKS) : [];
    this.el.streaks.forEach((btn, i) => {
      const s = streaks[i];
      if (!s) return;
      btn.dataset.streak = s.id;
      btn.setAttribute('aria-label', s.name || `Serie ${i + 1}`);
      if (typeof s.icon === 'string' && s.icon.trim().startsWith('<svg')) btn.innerHTML = s.icon;
    });
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  _bind() {
    const opts = { passive: false };
    this._on(this.root, 'pointerdown', (e) => this._down(e), opts);
    this._on(window, 'pointermove', (e) => this._move(e), opts);
    this._on(window, 'pointerup', (e) => this._up(e), opts);
    this._on(window, 'pointercancel', (e) => this._up(e), opts);
  }

  destroy() {
    while (this._listeners.length) this._listeners.pop()();
    this.root.innerHTML = '';
    this.root.classList.remove('tc-ready');
    this.root.style.removeProperty('opacity');
  }

  reset() {
    for (const [, p] of this.pointers) if (p.kind === 'button') this._btnUp(p);
    this.pointers.clear();
    this._stickRelease(true);
    this.input._releaseSource('touch');
    this.root.querySelectorAll('.is-down').forEach((n) => n.classList.remove('is-down'));
    this.root.querySelectorAll('.tc-lean.is-active').forEach((n) => n.classList.remove('is-active'));
  }

  /** Stick-Vektor [x, y] (y = vorwärts). Sprint-Sperre → volle Vorwärtsfahrt. */
  moveVector() {
    if (this.input.sprintLock && this.stick.id === null) return [0, 1];
    return [this.stick.mx, this.stick.my];
  }

  _unit() {
    const v = parseFloat(getComputedStyle(this.root).getPropertyValue('--tc-u'));
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  _inStickZone(x) {
    const w = window.innerWidth;
    return this._side === 'right' ? x > w * 0.58 : x < w * 0.42;
  }

  _down(e) {
    if (e.pointerType === 'mouse') return;
    const input = this.input;
    if (!input.enabled) return;
    e.preventDefault();
    input._setMode('touch', 'touch');
    const btn = e.target.closest && e.target.closest('.tc-btn');
    const now = performance.now();
    if (btn) {
      const action = btn.dataset.action;
      const look = btn.classList.contains('tc-fire') || action === 'adsfire';
      const p = { kind: 'button', btn, action, x: e.clientX, y: e.clientY, t: now, look };
      this.pointers.set(e.pointerId, p);
      btn.classList.add('is-down');
      if (btn.dataset.toggle) {
        if (action === 'ads') {
          input.adsToggled = !input.adsToggled;
          if (input.adsToggled) input._press('ads', 'touch'); else input._release('ads', 'touch');
        } else if (action === 'scoreboard') {
          if (input._held.touch.has('scoreboard')) input._release('scoreboard', 'touch'); else input._press('scoreboard', 'touch');
        } else if (action === 'lean_left' || action === 'lean_right') {
          // Lehnen auf Touch: Antippen schaltet um, die Gegenseite wird gelöst
          const other = action === 'lean_left' ? 'lean_right' : 'lean_left';
          if (input._held.touch.has(action)) input._release(action, 'touch');
          else { input._release(other, 'touch'); input._press(action, 'touch'); }
          this._syncLean();
        }
      } else if (action === 'adsfire') {
        // Zielen + Feuern (COD): halten legt an und feuert; Loslassen beendet beides (außer ADS ist eingeschaltet)
        input._press('ads', 'touch');
        input._press('fire', 'touch');
      } else {
        input._press(action, 'touch');
      }
      return;
    }
    if (this._inStickZone(e.clientX) && this.stick.id === null) {
      // Joystick an der Berührungsstelle aufspannen (fester Stick: an seiner Ruhelage)
      input.sprintLock = false;
      input._release('sprint', 'touch');
      const u = this._unit();
      const R = 62 * u * this._stickScale;
      const w = window.innerWidth;
      const h = window.innerHeight;
      let ox, oy;
      if (this._fixed) {
        const c = this._restPx();
        ox = c.x; oy = c.y;
      } else {
        ox = this._side === 'right' ? clamp(e.clientX, w * 0.58, w - R - 8) : clamp(e.clientX, R + 8, w * 0.42);
        oy = clamp(e.clientY, R + 8, h - R - 8);
      }
      Object.assign(this.stick, { id: e.pointerId, ox, oy, x: e.clientX, y: e.clientY, R });
      this.pointers.set(e.pointerId, { kind: 'stick' });
      this.el.stick.dataset.idle = '0';
      const rr = this.root.getBoundingClientRect();
      this.el.stick.style.setProperty('--sx', `${ox - rr.left}px`);
      this.el.stick.style.setProperty('--sy', `${oy - rr.top}px`);
      this._stickUpdate();
      return;
    }
    this.pointers.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY, t: now });
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') {
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
      this._stickUpdate();
      return;
    }
    if (p.kind === 'look' || (p.kind === 'button' && p.look)) {
      const now = performance.now();
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      const dtm = Math.max(4, now - p.t) / 1000;
      p.x = e.clientX;
      p.y = e.clientY;
      p.t = now;
      // Beschleunigung bei schnellen Wischern (präzise bei langsamen)
      const speed = Math.hypot(dx, dy) / dtm;
      const gain = 1 + 0.85 * smooth(350, 2600, speed);
      const k = TOUCH_RAD_PER_PX * this.input.G.settings.get('touchSensitivity') * gain;
      this.input._touchDX += dx * k;
      this.input._touchDY += dy * k;
    }
  }

  _up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (e.type === 'pointerup' && e.pointerType !== 'mouse') {
      this.input._maybeFullscreen(); // Nutzeraktivierung
      this.input._maybeGyroPermission();
    }
    if (p.kind === 'stick') this._stickRelease(false);
    else if (p.kind === 'button') this._btnUp(p);
  }

  _btnUp(p) {
    p.btn.classList.remove('is-down');
    if (p.btn.dataset.toggle) return;
    const input = this.input;
    const held = (action) => { for (const [, q] of this.pointers) if (q.kind === 'button' && (q.action === action || (q.action === 'adsfire' && (action === 'fire' || action === 'ads')))) return true; return false; };
    if (p.action === 'adsfire') {
      if (!held('fire')) input._release('fire', 'touch');
      if (!input.adsToggled && !held('ads')) input._release('ads', 'touch');
      return;
    }
    // Gleiche Aktion evtl. noch über einen anderen Finger gehalten (zwei Feuerknöpfe)
    if (held(p.action)) return;
    if (p.action === 'ads' && input.adsToggled) return;
    input._release(p.action, 'touch');
  }

  _syncLean() {
    const h = this.input._held.touch;
    if (this.el.leanL) this.el.leanL.classList.toggle('is-active', h.has('lean_left'));
    if (this.el.leanR) this.el.leanR.classList.toggle('is-active', h.has('lean_right'));
  }

  _stickUpdate() {
    const s = this.stick;
    const R = s.R || 62;
    let dx = s.x - s.ox;
    let dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    // Sprint-Sperrzone: deutlich über dem Stick, nach oben
    const inLock = dy < -R * 1.45 && Math.abs(dx) < R * 0.9;
    s.inLock = inLock;
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    let mx = dx / R;
    let my = -dy / R;
    const m = Math.hypot(mx, my);
    if (m < 0.12) { mx = 0; my = 0; } else { const n = (m - 0.12) / 0.88 / m; mx *= n; my *= n; }
    s.mx = mx;
    s.my = my;
    const k = 1 / this._stickScale; // Knopfversatz im skalierten Stick
    this.el.stick.style.setProperty('--kx', `${dx * k}px`);
    this.el.stick.style.setProperty('--ky', `${dy * k}px`);
    this.el.stick.classList.toggle('is-locking', inLock);
    // Auto-Sprint bei Vollausschlag nach vorn oder in der Sperrzone
    const sprint = inLock || (my > 0.93 && Math.abs(mx) < 0.4);
    if (sprint) this.input._press('sprint', 'touch'); else if (!this.input.sprintLock) this.input._release('sprint', 'touch');
  }

  _stickRelease(silent) {
    const s = this.stick;
    const lock = !silent && s.inLock;
    s.id = null;
    s.mx = s.my = 0;
    s.inLock = false;
    this.el.stick.dataset.idle = '1';
    this._stickRestStyle();
    this.el.stick.style.setProperty('--kx', '0px');
    this.el.stick.style.setProperty('--ky', '0px');
    this.el.stick.classList.remove('is-locking');
    this.input.sprintLock = lock;
    this.el.stick.classList.toggle('is-locked', lock);
    if (lock) this.input._press('sprint', 'touch'); else this.input._release('sprint', 'touch');
  }

  /** Ruhelage des Sticks: eigene Lage (Layout) oder game.css. */
  _stickRestStyle() {
    const st = this.el.stick.style;
    if (this._rest) { st.setProperty('--sx', `${this._rest.x}%`); st.setProperty('--sy', `${this._rest.y}%`); }
    else { st.removeProperty('--sx'); st.removeProperty('--sy'); }
  }

  _restPx() {
    const r = this.el.stick.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  setStreak(streakId, ready) {
    this.streakState[streakId] = ready;
    for (const b of this.el.streaks) if (b.dataset.streak === streakId) b.classList.toggle('is-ready', ready);
  }

  resetStreaks() {
    this.streakState = {};
    for (const b of this.el.streaks) b.classList.remove('is-ready');
  }

  /* ------------------------------------------------- Layout (S7) */

  _visibleRoot() {
    return this.root.getClientRects().length > 0 && this.root.clientWidth > 0;
  }

  _clearInline(el) {
    const st = el.style;
    for (const p of ['left', 'top', 'right', 'bottom', 'translate', 'filter', 'display', 'scale', '--s']) st.removeProperty(p);
    if (el.classList.contains('tc-streaks')) for (const c of el.children) c.style.removeProperty('--s');
  }

  /** CSS-Grundgröße (--s) eines Knopfs (einmal je Element gelesen). */
  _baseSize(el, fallback = 56) {
    if (this._baseS.has(el)) return this._baseS.get(el);
    const v = parseFloat(getComputedStyle(el).getPropertyValue('--s'));
    const s = Number.isFinite(v) && v > 0 ? v : fallback;
    this._baseS.set(el, s);
    return s;
  }

  _feature(kind) {
    const G = this.input.G;
    const p = G.player;
    const w = p && p.weapon;
    if (kind === 'tactical') { const t = w && w.equipment && w.equipment.tactical; return !!(t && t.id); }
    if (kind === 'light') return !!(p && (p.flashlight || (w && (w.hasLight || w.light))));
    return true;
  }

  /** Mitte/Größe aller Knöpfe in % von #touch-ui (aktueller Zustand oder CSS-Standard). */
  measure(defaults, restore = true) {
    if (!this._visibleRoot()) return null;
    if (defaults) for (const b of TOUCH_BUTTONS) { const el = this.items[b.id]; if (el) this._clearInline(el); }
    const rr = this.root.getBoundingClientRect();
    const out = { aspect: aspectBucket(rr.width, rr.height), buttons: {} };
    for (const b of TOUCH_BUTTONS) {
      const el = this.items[b.id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      let w = r.width, h = r.height, cx = r.left + w / 2, cy = r.top + h / 2;
      if (b.kind === 'stick') { const base = this.el.base.getBoundingClientRect(); w = base.width; h = base.height; cx = r.left; cy = r.top; }
      const visible = getComputedStyle(el).display !== 'none';
      // Knöpfe mit def haben in game.css keine Lage – ohne Inline-Werte stünden sichtbare (Editor-Geist, Lampe)
      // in der Ecke und würden beim Spiegeln dorthin übernommen
      const def = defaults && b.def ? b.def : null;
      out.buttons[b.id] = def
        ? { x: def.x, y: def.y, w: visible ? (w / rr.width) * 100 : 0, h: visible ? (h / rr.height) * 100 : 0, visible }
        : { x: ((cx - rr.left) / rr.width) * 100, y: ((cy - rr.top) / rr.height) * 100, w: (w / rr.width) * 100, h: (h / rr.height) * 100, visible };
    }
    if (defaults && restore && this.layout) this.applyLayout(this.layout, this._globals);
    return out;
  }

  /** Layout auf die Knöpfe anwenden (Lage, Größe, Deckkraft, Sichtbarkeit), Stick-Seite und -Art übernehmen. */
  applyLayout(L, globals = { opacity: 1, scale: 1 }) {
    this.layout = L;
    this._globals = globals;
    this.layoutDirty = false;
    const root = this.root;
    const gOp = clamp(globals.opacity ?? 1, 0.2, 1);
    const gScale = clamp(globals.scale ?? 1, 0.6, 1.6);
    if (gOp < 0.999) root.style.opacity = String(gOp); else root.style.removeProperty('opacity');
    this._side = L.stick.side === 'right' ? 'right' : 'left';
    this._fixed = !!L.stick.fixed;
    // Spiegeln braucht die CSS-Lagen → messen (nur möglich, wenn #touch-ui sichtbar ist; sonst später nachholen)
    let defs = null;
    if (L.mirror) {
      defs = this.measure(true, false);
      this.layoutDirty = !defs;
    } else {
      for (const b of TOUCH_BUTTONS) { const el = this.items[b.id]; if (el) this._clearInline(el); }
    }
    this._auto = {};
    for (const b of TOUCH_BUTTONS) {
      const el = this.items[b.id];
      if (!el) continue;
      const e = L.buttons[b.id] || {};
      let x = e.x, y = e.y;
      // Gespiegelt tauscht das Lehnen-Paar die Plätze: „links lehnen“ bleibt links von „rechts lehnen“
      const pid = L.mirror && MIRROR_PAIR[b.id] ? MIRROR_PAIR[b.id] : b.id;
      const d = defs && defs.buttons[pid];
      if (L.mirror && d) { if (x == null) x = 100 - d.x; if (y == null) y = d.y; }
      if (b.def) {
        const bd = (pid !== b.id && TOUCH_BUTTONS.find((t) => t.id === pid).def) || b.def;
        if (x == null) x = L.mirror ? 100 - bd.x : bd.x;
        if (y == null) y = bd.y;
      }
      const s = (e.s ?? 1) * gScale;
      if (b.kind === 'stick') {
        this._rest = x != null && y != null ? { x, y } : null;
        this._stickScale = s;
        if (Math.abs(s - 1) > 1e-3) el.style.scale = String(s); else el.style.removeProperty('scale');
        if (this.stick.id === null) this._stickRestStyle();
      } else {
        if (x != null && y != null) {
          const st = el.style;
          st.left = `${x}%`;
          st.top = `${y}%`;
          st.right = 'auto';
          st.bottom = 'auto';
          // .tc-swap ist per CSS waagerecht zentriert (transform), die anderen nicht
          st.translate = el.classList.contains('tc-swap') ? '0 -50%' : '-50% -50%';
        }
        if (b.kind === 'group') {
          if (Math.abs(s - 1) > 1e-3) for (const c of el.children) c.style.setProperty('--s', String(this._baseSize(c, 44) * s));
        } else if (Math.abs(s - 1) > 1e-3 || b.def) {
          el.style.setProperty('--s', String((b.def ? b.def.s : this._baseSize(el)) * s));
        }
      }
      if (e.o != null && e.o < 0.999) el.style.filter = `opacity(${e.o})`;
      // Sichtbarkeit: eigene Angabe > optional (aus) > automatisch (Funktion verfügbar)
      let hidden = false;
      if (typeof e.h === 'boolean') hidden = e.h;
      else if (b.optional) hidden = true;
      else if (b.auto) { hidden = !this._feature(b.auto); this._auto[b.id] = hidden; }
      if (hidden) el.style.display = 'none';
    }
  }

  /** DOM-Zustand (Munition, Granaten, Zweitwaffe, ADS, automatische Knöpfe) – ~10× pro Sekunde. */
  refresh() {
    const input = this.input;
    const G = input.G;
    const w = G.player && G.player.weapon;
    const set = (key, val, fn) => { if (this._cache[key] !== val) { this._cache[key] = val; fn(val); } };
    set('ads', input.adsToggled, (v) => this.el.ads.classList.toggle('is-active', v));
    set('score', input._held.touch.has('scoreboard'), (v) => this.el.score.classList.toggle('is-active', v));
    set('lock', input.sprintLock, (v) => this.el.stick.classList.toggle('is-locked', v));
    set('leanL', input._held.touch.has('lean_left'), () => this._syncLean());
    set('leanR', input._held.touch.has('lean_right'), () => this._syncLean());
    if (this.layoutDirty && this.layout && this._visibleRoot()) input.applyTouchLayout();
    // automatische Knöpfe (taktische Granate, Lampe) erscheinen, sobald die Funktion verfügbar ist
    if (this.layout) {
      for (const b of TOUCH_BUTTONS) {
        if (!b.auto || !(b.id in this._auto)) continue;
        const hidden = !this._feature(b.auto);
        if (hidden !== this._auto[b.id]) {
          this._auto[b.id] = hidden;
          const el = this.items[b.id];
          if (el) { if (hidden) el.style.display = 'none'; else el.style.removeProperty('display'); }
        }
      }
    }
    if (!w) return;
    const lethal = w.equipment && w.equipment.lethal;
    const count = lethal ? lethal.count : 0;
    set('nade', count, (v) => { this.el.badge.textContent = String(v); this.el.grenade.classList.toggle('is-empty', v <= 0); });
    const tac = w.equipment && w.equipment.tactical;
    const tcount = tac && Number.isFinite(tac.count) ? tac.count : 0;
    set('tac', tcount, (v) => { this.el.tacBadge.textContent = String(v); this.el.tactical.classList.toggle('is-empty', v <= 0); });
    const slots = w.slots || [];
    const other = slots.find((st) => st && st !== w.current);
    set('swap', other && other.def ? other.def.name : '—', (v) => { this.el.swapName.textContent = v; });
    const cur = w.current;
    const low = !!(cur && cur.def && cur.def.mag > 0 && cur.mag <= Math.ceil(cur.def.mag * 0.25));
    set('low', low, (v) => this.el.reload.classList.toggle('is-alert', v));
    if (!this._streakIconsApplied && G.data && G.data.STREAKS) { this._streakIconsApplied = true; this._applyStreakIcons(); }
  }
}
