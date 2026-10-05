// NULLPUNKT — Eingabe (§5): Tastatur/Maus mit Pointer-Lock, Gamepad (Standard-Mapping) und eine
// vollständige Touch-Oberfläche im Stil von COD Mobile (DOM-Elemente .tc-* in #touch-ui).
//
// Ausgabe pro Frame (nach update(dt)):
//   move  {x, y}   -1..1, y = vorwärts, x = rechts (normalisiert)
//   look  {dx, dy} Radiant für diesen Frame; dx > 0 = nach rechts drehen, dy > 0 = nach unten.
//                  Der Spieler rechnet yaw -= dx, pitch -= dy. Empfindlichkeit, FOV/ADS-Skalierung,
//                  invertY und Zielhilfe sind bereits enthalten.
//   down(a) / pressed(a) / released(a) für die Aktionen in ACTIONS.
//
// Zusätzlich: aimTarget (Actor unter dem Fadenkreuz, Touch/Gamepad-Zielhilfe), lastDevice
// ('keyboard'|'mouse'|'gamepad'|'touch'), simulate.* (Testautomatisierung), vibrate().

import * as THREE from 'three';

export const ACTIONS = Object.freeze([
  'fire', 'ads', 'reload', 'jump', 'crouch', 'sprint', 'melee', 'grenade', 'swap', 'slot1', 'slot2',
  'streak1', 'streak2', 'streak3', 'scoreboard', 'pause', 'interact',
]);

// Kein Strg für Ducken: Strg+W/T/N sind Browser-Kürzel, die eine Seite nicht abfangen kann (Tab zu!).
const KEY_ACTIONS = {
  Space: 'jump', KeyC: 'crouch', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyR: 'reload', KeyV: 'melee', KeyG: 'grenade', KeyQ: 'grenade', Digit1: 'slot1', Digit2: 'slot2',
  Digit3: 'streak1', Digit4: 'streak2', Digit5: 'streak3', Tab: 'scoreboard', Escape: 'pause',
  KeyF: 'interact', KeyE: 'interact',
};
const MOVE_KEYS = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};
const MOUSE_ACTIONS = { 0: 'fire', 2: 'ads', 3: 'melee', 4: 'swap' };
// Gamepad-Standard-Mapping
const PAD_ACTIONS = {
  0: 'jump', 1: 'crouch', 2: 'reload', 3: 'swap', 4: 'grenade', 5: 'melee', 8: 'scoreboard', 9: 'pause',
  10: 'sprint', 11: 'melee', 12: 'streak1', 14: 'streak2', 15: 'streak3',
};

const MOUSE_RAD_PER_PX = 0.0022;
const TOUCH_RAD_PER_PX = 0.0054;
const PAD_YAW_RATE = 3.4; // rad/s bei Vollausschlag
const PAD_PITCH_RATE = 2.3;
const SOURCES = ['key', 'mouse', 'pad', 'touch', 'auto', 'sim'];

const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _to = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _best = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _ray = new THREE.Ray();
const ASSIST_RANGE = 60; // m: Zielhilfe/aimTarget
const CHEST = 0.62; // Anteil der Körperhöhe: Bezugspunkt für Bewegungsverfolgung

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Punkt auf der Körperachse eines Akteurs (Füße+0,3 m … Scheitel−0,12 m), der der Visierlinie am nächsten
 * liegt: Höhe der Visierlinie dort, wo sie die Achse horizontal passiert. Zielt man auf den Kopf, ist
 * das der Kopf – nicht ein fester Brustpunkt.
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
  return out.set(p.x, clamp(y, p.y + Math.min(0.3, h * 0.2), p.y + h - 0.12), p.z);
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ------------------------------------------------------------ SVG-Icons */
const I = (body, vb = '0 0 48 48') =>
  `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  fire: I('<circle cx="24" cy="24" r="10"/><path d="M24 6v8M24 34v8M6 24h8M34 24h8"/><circle cx="24" cy="24" r="2" fill="currentColor" stroke="none"/>'),
  ads: I('<circle cx="24" cy="24" r="14"/><path d="M24 14v6M24 28v6M14 24h6M28 24h6"/>'),
  reload: I('<path d="M36 18a13 13 0 1 0 1 12"/><path d="M37 9v9h-9"/>'),
  jump: I('<path d="M12 28l12-12 12 12"/><path d="M12 38l12-12 12 12" opacity=".45"/>'),
  crouch: I('<path d="M12 18l12 12 12-12"/><path d="M14 38h20"/>'),
  grenade: I('<circle cx="24" cy="28" r="11"/><path d="M19 17v-5h10v5M29 13c5 0 7 3 7 7"/><path d="M16 28h16" opacity=".5"/>'),
  melee: I('<path d="M10 38l6-6M14 34l20-20 6-4-4 6-20 20z"/><path d="M12 30l6 6"/>'),
  swap: I('<path d="M10 18h26l-6-6M38 30H12l6 6"/>'),
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

    this._held = {};
    for (const s of SOURCES) this._held[s] = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this._keys = { f: false, b: false, l: false, r: false };
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._touchDX = 0; // bereits in Radiant (Touch-Empfindlichkeit + Beschleunigung)
    this._touchDY = 0;
    this._padMove = { x: 0, y: 0 };
    this._padLook = { x: 0, y: 0 };
    this._padPrev = [];
    this._padActive = false;
    this._simMove = null;
    this._simTaps = new Set();
    this._wheelAt = 0;
    this._listeners = [];
    this._subs = null;
    this._los = new Map();
    this._autoPulse = 0;
    this._lastVibrate = 0;
    this._fsTriedAt = -1e9;
    this._track = null; // Rotationshilfe: letzte Peilung des Ziels
    this._uiRefreshAt = 0;
    this._touch = null; // Touch-Oberfläche (DOM + Zeiger-Zuordnung)

    this.simulate = {
      look: (dxPx, dyPx) => { this._mouseDX += dxPx; this._mouseDY += dyPx; },
      press: (a) => this._press(a, 'sim'),
      release: (a) => this._release(a, 'sim'),
      tap: (a) => { this._press(a, 'sim'); this._simTaps.add(a); },
      move: (x, y) => { this._simMove = x == null ? null : { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; },
      clear: () => { this._held.sim.clear(); this._simMove = null; },
    };
  }

  /* ----------------------------------------------------------- Zustand */

  down(action) {
    const h = this._held;
    return h.key.has(action) || h.mouse.has(action) || h.pad.has(action) || h.touch.has(action) || h.auto.has(action) || h.sim.has(action);
  }
  pressed(action) { return this._pressed.has(action); }
  released(action) { return this._released.has(action); }

  _press(action, src) {
    if (!this.enabled && src !== 'sim') return;
    const was = this.down(action);
    this._held[src].add(action);
    if (!was) this._pressed.add(action);
  }

  _release(action, src) {
    if (!this._held[src].delete(action)) return;
    if (!this.down(action)) this._released.add(action);
  }

  _releaseSource(src) {
    for (const a of [...this._held[src]]) this._release(a, src);
  }

  releaseAll() {
    for (const s of SOURCES) this._releaseSource(s);
    this._keys.f = this._keys.b = this._keys.l = this._keys.r = false;
    this._mouseDX = this._mouseDY = this._touchDX = this._touchDY = 0;
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

  /** Touch: ADS-Umschalter zurücksetzen (z. B. wenn der Spieler sprintet). */
  cancelAds() {
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

  _setMode(mode, device) {
    if (device) this.lastDevice = device;
    if (mode === this.mode) return;
    this.mode = mode;
    document.body.dataset.inputMode = mode;
    if (mode === 'touch') {
      this._releaseSource('mouse');
      this._releaseSource('key');
      if (this.locked) this.exitLock();
    } else if (this._touch) {
      this._releaseSource('touch');
      this._touch.reset();
    }
    if (this.G.events) this.G.events.emit('input:mode', { mode });
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

    this._on(window, 'keydown', (e) => {
      if (isFormField(e.target)) return;
      const action = KEY_ACTIONS[e.code];
      const mv = MOVE_KEYS[e.code];
      if (!action && !mv) return;
      if (this.mode === 'touch' && e.isTrusted) this._setMode('desktop', 'keyboard'); else this.lastDevice = 'keyboard';
      if (!this.enabled) return;
      if (e.code !== 'Escape') e.preventDefault();
      if (mv) this._keys[mv] = true;
      if (action && !e.repeat) this._press(action, 'key');
    });
    this._on(window, 'keyup', (e) => {
      const action = KEY_ACTIONS[e.code];
      const mv = MOVE_KEYS[e.code];
      if (mv) this._keys[mv] = false;
      if (action) this._release(action, 'key');
    });
    this._on(window, 'blur', () => this.releaseAll());

    this._on(canvas, 'mousedown', (e) => {
      if (this.mode === 'touch' || e.sourceCapabilities?.firesTouchEvents) return;
      this.lastDevice = 'mouse';
      if (!this.enabled) return;
      if (!this.locked && !this.allowUnlockedMouse) {
        this.requestLock();
        return;
      }
      const action = MOUSE_ACTIONS[e.button];
      if (action) { e.preventDefault(); this._press(action, 'mouse'); }
    });
    this._on(window, 'mouseup', (e) => {
      const action = MOUSE_ACTIONS[e.button];
      if (action) this._release(action, 'mouse');
    });
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
      if (!this.enabled) return;
      e.preventDefault();
      const now = performance.now();
      if (now - this._wheelAt < 160 || Math.abs(e.deltaY) < 1) return;
      this._wheelAt = now;
      this._press('swap', 'mouse');
      this._simTaps.add('swap:mouse');
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
    }

    // Abos (Haptik, Streak-Anzeige)
    this._subs = G.events.scope();
    // Haptik: Treffer/Abschüsse des Spielers und erlittener Schaden (nicht jeder Schuss – das ermüdet)
    this._subs.on('actor:hit', ({ attacker, killed }) => { if (attacker && attacker.isPlayer) this.vibrate(killed ? [18, 40, 26] : 10); });
    this._subs.on('player:damaged', () => this.vibrate(30));
    this._subs.on('explosion', ({ position }) => {
      const p = G.player;
      if (p && p.alive && position && p.position.distanceTo(position) < 12) this.vibrate(45);
    });
    this._subs.on('streak:ready', ({ actor, streakId }) => { if (actor && actor.isPlayer && this._touch) this._touch.setStreak(streakId, true); });
    this._subs.on('streak:activate', ({ actor, streakId }) => { if (actor && actor.isPlayer && this._touch) this._touch.setStreak(streakId, false); });
    this._subs.on('match:state', ({ state }) => { if (state === 'loading' && this._touch) this._touch.resetStreaks(); });
  }

  detach() {
    while (this._listeners.length) this._listeners.pop()();
    if (this._subs) this._subs.dispose();
    this._subs = null;
    this._touch = null;
  }

  /* --------------------------------------------------------- Update */

  update(dt) {
    const G = this.G;
    const s = G.settings;
    this._pollGamepad(dt);

    // Bewegung
    let mx = (this._keys.r ? 1 : 0) - (this._keys.l ? 1 : 0);
    let my = (this._keys.f ? 1 : 0) - (this._keys.b ? 1 : 0);
    const kl = Math.hypot(mx, my);
    if (kl > 1) { mx /= kl; my /= kl; }
    const cands = [[mx, my], [this._padMove.x, this._padMove.y]];
    if (this._touch) cands.push(this._touch.moveVector());
    if (this._simMove) cands.push([this._simMove.x, this._simMove.y]);
    let best = cands[0];
    for (const c of cands) if (Math.hypot(c[0], c[1]) > Math.hypot(best[0], best[1])) best = c;
    this.move.x = this.enabled ? best[0] : 0;
    this.move.y = this.enabled ? best[1] : 0;

    // Blick
    const player = G.player;
    const cam = G.camera;
    const baseFov = player && player.baseFov ? player.baseFov : (cam ? cam.fov : 70);
    const curFov = cam ? cam.fov : baseFov;
    const fovScale = Math.tan((curFov * Math.PI) / 360) / Math.tan((baseFov * Math.PI) / 360);
    const ads = player && player.weapon ? player.weapon.adsProgress || 0 : 0;
    const adsScale = 1 + (s.get('adsSensitivity') - 1) * ads;
    const scale = fovScale * adsScale;
    const inv = s.get('invertY') ? -1 : 1;

    let dx = this._mouseDX * MOUSE_RAD_PER_PX * s.get('sensitivity') * scale;
    let dy = this._mouseDY * MOUSE_RAD_PER_PX * s.get('sensitivity') * scale;
    dx += this._touchDX * scale;
    dy += this._touchDY * scale;
    dx += this._padLook.x * PAD_YAW_RATE * s.get('sensitivity') * scale * dt;
    dy += this._padLook.y * PAD_PITCH_RATE * s.get('sensitivity') * scale * dt;
    this._mouseDX = this._mouseDY = this._touchDX = this._touchDY = 0;
    dy *= inv;

    if (!this.enabled) { dx = 0; dy = 0; }
    this.look.dx = dx;
    this.look.dy = dy;

    this._assist(dt);
    if (this._touch) {
      const now = performance.now();
      if (now - this._uiRefreshAt > 100) { this._uiRefreshAt = now; this._touch.refresh(); }
    }
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
    for (const t of this._simTaps) {
      if (t === 'swap:mouse') this._held.mouse.delete('swap');
      else this._held.sim.delete(t);
    }
    this._simTaps.clear();
  }

  /* -------------------------------------------------------- Gamepad */

  _pollGamepad() {
    if (typeof navigator.getGamepads !== 'function') return;
    let pad = null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) {
      if (this._padActive) { this._releaseSource('pad'); this._padActive = false; }
      this._padMove.x = this._padMove.y = this._padLook.x = this._padLook.y = 0;
      return;
    }
    const b = pad.buttons;
    const val = (i) => (b[i] ? (typeof b[i] === 'object' ? (b[i].pressed ? Math.max(b[i].value, 0.5) : b[i].value) : b[i]) : 0);
    let activity = false;
    const setBtn = (i, action, on) => {
      const prev = this._padPrev[i] || false;
      if (on !== prev) {
        activity = true;
        if (on) this._press(action, 'pad'); else this._release(action, 'pad');
      }
      this._padPrev[i] = on;
    };
    for (const [i, action] of Object.entries(PAD_ACTIONS)) setBtn(+i, action, val(+i) > 0.5);
    setBtn(6, 'ads', val(6) > 0.35);
    setBtn(7, 'fire', val(7) > 0.35);

    const stick = (x, y, dz) => {
      const m = Math.hypot(x, y);
      if (m < dz) return [0, 0];
      const n = Math.min(1, (m - dz) / (1 - dz));
      return [(x / m) * n, (y / m) * n];
    };
    const [lx, ly] = stick(pad.axes[0] || 0, pad.axes[1] || 0, 0.16);
    const [rx, ry] = stick(pad.axes[2] || 0, pad.axes[3] || 0, 0.13);
    this._padMove.x = lx;
    this._padMove.y = -ly;
    // Antwortkurve: feine Kontrolle nahe der Mitte
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
    this._padLook.x = curve(rx);
    this._padLook.y = curve(ry);
    if (lx || ly || rx || ry) activity = true;
    if (activity) {
      this._padActive = true;
      if (this.mode === 'touch') this._setMode('desktop', 'gamepad'); else this.lastDevice = 'gamepad';
    }
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
      const closeness = 1 - bestScore;
      const ads = player.weapon ? player.weapon.adsProgress || 0 : 0;
      const ux = this.look.dx; // Daumen/Stick dieses Bildes (vor der Hilfe)
      const uy = this.look.dy;
      // 1) Verlangsamung über dem Ziel (feinere Korrekturen möglich, nie Stillstand)
      const friction = 1 - 0.4 * closeness;
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
      if (tr && tr.actor === best && dt > 0) {
        const k = (0.45 + 0.35 * ads) * closeness;
        this.look.dx -= wrapAngle(bearYaw - tr.yaw) * k;
        this.look.dy -= (bearPitch - tr.pitch) * k * 0.5;
      }
      this._track = { actor: best, yaw: bearYaw, pitch: bearPitch };

      // 3) Leichter Zug zur Körperachse – nur in Aktion (laufen, feuern, zielen), und je Achse nur,
      //    wenn der Spieler nicht gerade vom Ziel weg zieht. Innerhalb der Körperhöhe zieht nichts nach
      //    unten zur Brust (Kopfschüsse bleiben möglich).
      const moving = Math.hypot(this.move.x, this.move.y) > 0.2;
      if (moving || this.down('fire') || ads > 0.5) {
        _to.subVectors(_best, _eye);
        const wantYaw = Math.atan2(-_to.x, -_to.z);
        const wantPitch = Math.asin(clamp(_to.y / bestDist, -1, 1));
        const yaw = player.yaw + (player.recoilYaw || 0);
        const pitch = player.pitch + (player.recoilPitch || 0);
        const rate = (0.9 + 1.6 * ads) * closeness * dt;
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
    const autoOn = this.mode === 'touch' && G.settings.get('autoFire') && (!wpn || wpn.autoFireReady !== false);
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
}

function detectTouchFirst() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
}

function isScrollable(el) {
  return !!(el && el.closest && el.closest('[data-scrollable], .np-scroll'));
}

/* ======================================================================
 * Touch-Oberfläche (COD-Mobile-Stil)
 *  - linke Hälfte: schwebender Joystick; nach oben über den Rand → Sprint-Sperre
 *  - rechte Hälfte: Blick ziehen (mit Beschleunigungskurve)
 *  - großer rechter Feuerknopf: halten = feuern, gleichzeitig ziehen = zielen
 *  - Knöpfe: linker Feuerknopf, ADS (Umschalter), Nachladen, Springen, Ducken/Rutschen,
 *    Granate, Messer, Waffenwechsel, Serien 1–3, Punktetabelle, Pause
 * ==================================================================== */

class TouchUI {
  constructor(input, root) {
    this.input = input;
    this.root = root;
    this.pointers = new Map(); // pointerId → { kind, ... }
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, mx: 0, my: 0, inLock: false };
    this.streakState = {};
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
      <div class="tc-btn tc-fire tc-fire-r" data-action="fire" role="button" aria-label="Feuern">${ICONS.fire}</div>
      <div class="tc-btn tc-fire tc-fire-l" data-action="fire" role="button" aria-label="Feuern (links)">${ICONS.fire}</div>
      <div class="tc-btn tc-ads" data-action="ads" data-toggle="1" role="button" aria-label="Zielen">${ICONS.ads}</div>
      <div class="tc-btn tc-reload" data-action="reload" role="button" aria-label="Nachladen">${ICONS.reload}</div>
      <div class="tc-btn tc-jump" data-action="jump" role="button" aria-label="Springen">${ICONS.jump}</div>
      <div class="tc-btn tc-crouch" data-action="crouch" role="button" aria-label="Ducken / Rutschen">${ICONS.crouch}</div>
      <div class="tc-btn tc-grenade" data-action="grenade" role="button" aria-label="Granate">${ICONS.grenade}<span class="tc-badge">1</span></div>
      <div class="tc-btn tc-melee" data-action="melee" role="button" aria-label="Messer">${ICONS.melee}</div>
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
      badge: r.querySelector('.tc-badge'),
      grenade: r.querySelector('.tc-grenade'),
      swapName: r.querySelector('.tc-swap-name'),
      reload: r.querySelector('.tc-reload'),
      streaks: [...r.querySelectorAll('.tc-streak')],
    };
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
  }

  reset() {
    for (const [, p] of this.pointers) if (p.kind === 'button') this._btnUp(p);
    this.pointers.clear();
    this._stickRelease(true);
    this.input._releaseSource('touch');
    this.root.querySelectorAll('.is-down').forEach((n) => n.classList.remove('is-down'));
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
      const p = { kind: 'button', btn, action, x: e.clientX, y: e.clientY, t: now, look: btn.classList.contains('tc-fire') };
      this.pointers.set(e.pointerId, p);
      btn.classList.add('is-down');
      if (btn.dataset.toggle) {
        if (action === 'ads') {
          input.adsToggled = !input.adsToggled;
          if (input.adsToggled) input._press('ads', 'touch'); else input._release('ads', 'touch');
        } else if (action === 'scoreboard') {
          if (input._held.touch.has('scoreboard')) input._release('scoreboard', 'touch'); else input._press('scoreboard', 'touch');
        }
      } else {
        input._press(action, 'touch');
      }
      return;
    }
    const w = window.innerWidth;
    if (e.clientX < w * 0.42 && this.stick.id === null) {
      // Joystick an der Berührungsstelle aufspannen
      input.sprintLock = false;
      input._release('sprint', 'touch');
      const u = this._unit();
      const R = 62 * u;
      const ox = clamp(e.clientX, R + 8, w * 0.42);
      const oy = clamp(e.clientY, R + 8, window.innerHeight - R - 8);
      Object.assign(this.stick, { id: e.pointerId, ox, oy, x: e.clientX, y: e.clientY, R });
      this.pointers.set(e.pointerId, { kind: 'stick' });
      this.el.stick.dataset.idle = '0';
      this.el.stick.style.setProperty('--sx', `${ox}px`);
      this.el.stick.style.setProperty('--sy', `${oy}px`);
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
    if (e.type === 'pointerup' && e.pointerType !== 'mouse') this.input._maybeFullscreen(); // Nutzeraktivierung
    if (p.kind === 'stick') this._stickRelease(false);
    else if (p.kind === 'button') this._btnUp(p);
  }

  _btnUp(p) {
    p.btn.classList.remove('is-down');
    if (p.btn.dataset.toggle) return;
    // Gleiche Aktion evtl. noch über einen anderen Finger gehalten (zwei Feuerknöpfe)
    for (const [, q] of this.pointers) if (q.kind === 'button' && q.action === p.action) return;
    this.input._release(p.action, 'touch');
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
    this.el.stick.style.setProperty('--kx', `${dx}px`);
    this.el.stick.style.setProperty('--ky', `${dy}px`);
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
    this.el.stick.style.removeProperty('--sx');
    this.el.stick.style.removeProperty('--sy');
    this.el.stick.style.setProperty('--kx', '0px');
    this.el.stick.style.setProperty('--ky', '0px');
    this.el.stick.classList.remove('is-locking');
    this.input.sprintLock = lock;
    this.el.stick.classList.toggle('is-locked', lock);
    if (lock) this.input._press('sprint', 'touch'); else this.input._release('sprint', 'touch');
  }

  setStreak(streakId, ready) {
    this.streakState[streakId] = ready;
    for (const b of this.el.streaks) if (b.dataset.streak === streakId) b.classList.toggle('is-ready', ready);
  }

  resetStreaks() {
    this.streakState = {};
    for (const b of this.el.streaks) b.classList.remove('is-ready');
  }

  /** DOM-Zustand (Munition, Granaten, Zweitwaffe, ADS) – ~10× pro Sekunde. */
  refresh() {
    const input = this.input;
    const G = input.G;
    const w = G.player && G.player.weapon;
    const set = (key, val, fn) => { if (this._cache[key] !== val) { this._cache[key] = val; fn(val); } };
    set('ads', input.adsToggled, (v) => this.el.ads.classList.toggle('is-active', v));
    set('score', input._held.touch.has('scoreboard'), (v) => this.el.score.classList.toggle('is-active', v));
    set('lock', input.sprintLock, (v) => this.el.stick.classList.toggle('is-locked', v));
    if (!w) return;
    const lethal = w.equipment && w.equipment.lethal;
    const count = lethal ? lethal.count : 0;
    set('nade', count, (v) => { this.el.badge.textContent = String(v); this.el.grenade.classList.toggle('is-empty', v <= 0); });
    const slots = w.slots || [];
    const other = slots.find((st) => st && st !== w.current);
    set('swap', other && other.def ? other.def.name : '—', (v) => { this.el.swapName.textContent = v; });
    const cur = w.current;
    const low = !!(cur && cur.def && cur.def.mag > 0 && cur.mag <= Math.ceil(cur.def.mag * 0.25));
    set('low', low, (v) => this.el.reload.classList.toggle('is-alert', v));
    if (!this._streakIconsApplied && G.data && G.data.STREAKS) { this._streakIconsApplied = true; this._applyStreakIcons(); }
  }
}
