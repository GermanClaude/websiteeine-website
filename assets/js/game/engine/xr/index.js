// NULLPUNKT — VR-Modus (Beta): WebXR „immersive-vr“ für Meta Quest 3 (Quest-Browser oder PC + Air Link/Quest Link).
// Anleitung, Test mit dem Emulator und Entscheidungen: docs/planung/vr.md.
//
// Räume: Trackingraum (Referenzraum local-floor, sonst local; Kopf h, Körpermitte c) und Welt.
//   G.xr.group (seit dem Start in G.scene → Teil der Basisszene, wird beim Matchwechsel nicht entsorgt)
//     ├─ rig (Drehung rigYaw um Y, Lage aus dem Spielerkörper)
//     │    └─ camera (XR-Kamera; three.js setzt ihre Pose je Bild aus dem Headset) └─ Overlay (Vignette/Treffer/Abblende)
//     ├─ Handgelenk-Anzeige (Nebenhand), Zielpunkt der Waffe, VR-Menü (Welt)
//   rig.position = Füße + (0, vOff, 0) − R(rigYaw)·c  ⇒  Kopf_Welt = Füße + R(rigYaw)·(h − c) + vOff
//   vOff = 1,65 m (Augenhöhe Stehen im Spiel) − kalibrierte Kopfhöhe + virtuelles Ducken (Spiel tiefer als der echte
//   Kopf: Taste B/Y, Decke) + Stufenglättung. Danach hält der Kopf 12 cm Abstand zu Wänden (Rig wird verschoben).
// Kopplung an den Spieler (player.js-Haken, nur während der Sitzung): yaw/pitch = Kopf (Laufrichtung, Lehnachse),
//   getEyePosition = Kopf, getAimDirection = vom Auge zu dem Punkt, auf den der Lauf zeigt (Strahl der Haupthand gegen
//   Welt + Gegner): Kugeln starten weiter am Auge (Netz/Anti-Cheat unverändert), treffen aber, wohin die Waffe zeigt.
//   Rückstoß kippt diese Richtung und stößt das Waffenmodell – die Kamera bleibt ruhig (keine Übelkeit).
// Körper: echtes Gehen verschiebt den Körper mit Kollision, sobald der Kopf mehr als 15 cm vor/hinter oder mehr als
//   die Lehnweite (38 cm, geduckt 30, liegend 18) neben der Körpermitte ist; seitlicher Versatz innerhalb oder Neigen
//   des Kopfes = Lehnen (player.xrLean → _updateLean mit Wandgrenzen). Echte Kopfhöhe → Ducken (< 78 %) / Hinlegen
//   (< 42 % der kalibrierten Stehhöhe), mit Hysterese.
// Bewegung: Stick der Nebenhand (relativ zu Blick oder Controller), Drehen mit dem Stick der Haupthand (Schritte 15/30/45°
//   oder flüssig) – mit Komfort-Vignette. Tasten über die Belegung (shared/bindings.data.js, Gerät 'xr').
// Bild: renderer.js zeichnet in VR ohne Nachbearbeitung (Welt + Waffe mit Welttiefe), main.js taktet per
//   renderer.setAnimationLoop. Eigene VR-Grafikvorgabe: Quest-Browser Stufe „Niedrig“ + 80 % Auflösung, PC wie am
//   Bildschirm + 100 %, Foveated Rendering 1, MSAA über den Kontext (renderer.js, Einstellung vrEnabled).

import * as THREE from 'three';
import { collisionRay, keepClear } from '../physics.js';
import { VrOverlay } from './overlay.js';
import { WristHud } from './wrist.js';
import { VrMenu } from './menu.js';

// Augenhöhen wie player.js (STAND_EYE, CROUCH_EYE, PRONE_EYE) und Lehnweiten (LEAN_SIDE, …_CROUCH, PRONE_LEAN_SIDE)
const EYE = { stand: 1.65, crouch: 1.0, prone: 0.38 };
const LEAN = { stand: 0.38, crouch: 0.3, prone: 0.18 };
const LEAN_DEAD = 0.06; // m seitlicher Kopfversatz ohne Lehnen
const ROLL_DEAD = 8 * Math.PI / 180; // Kopfneigung ohne Lehnen
const ROLL_FULL = 28 * Math.PI / 180; // Kopfneigung für volles Lehnen
const FWD_MAX = 0.15; // m Kopf vor/hinter der Körpermitte, ab dann folgt der Körper
const HEAD_R = 0.12; // m Mindestabstand Kopf ↔ Geometrie
const STANCE = { crouchIn: 0.78, crouchOut: 0.84, proneIn: 0.42, proneOut: 0.5 }; // Anteil der Stehhöhe
const SNAP_IN = 0.7;
const SNAP_OUT = 0.35;
const TURN_DEAD = 0.2;
const AIM_RANGE = 250;
const RESULT_TIME = 4; // s Ergebnistafel, dann endet VR
const CALIB_DELAY = 0.4; // s nach dem Start bis zur automatischen Höhenmessung (Headset beruhigt sich)
// Eigenständige Brillen-Browser (Quest, Pico, Wolvic) → VR-Grafik „Niedrig“; PC (Air Link/Quest Link) wie am Bildschirm
const STANDALONE_UA = /OculusBrowser|Quest|Pico|Wolvic/i;
const VR_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M6 16h36v16a3 3 0 0 1-3 3H31l-4-6h-6l-4 6H9a3 3 0 0 1-3-3z"/><circle cx="16" cy="24" r="3"/><circle cx="32" cy="24" r="3"/></svg>';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _hit = {};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

function pose() { return { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), dir: new THREE.Vector3(0, 0, -1), ok: false }; }
function hand() { return { src: null, gamepad: null, grip: pose(), ray: pose(), gripW: pose(), rayW: pose() }; }
function readPose(out, p) {
  if (!p) { out.ok = false; return; }
  const t = p.transform;
  out.pos.set(t.position.x, t.position.y, t.position.z);
  out.quat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
  out.ok = true;
}

export class XRSystem {
  /**
   * opts.onFrame(time, xrFrame): ein Bild der Spielschleife (main.js frame(t, 'xr', f));
   * opts.onStart(): Sitzung läuft (main: Pause verlassen); opts.onEnd(): Sitzung beendet (main: pausieren → 2D-Menü).
   */
  constructor(G, { onFrame = null, onStart = null, onEnd = null } = {}) {
    this.G = G;
    this.onFrame = onFrame;
    this.onStart = onStart;
    this.onEnd = onEnd;
    /** null = unbekannt, true/false = navigator.xr meldet „immersive-vr“. */
    this.supported = null;
    this.presenting = false;
    this.starting = false;
    /** true, sobald Kopfpose + Höhe kalibriert sind (vorher steuert VR nichts). */
    this.ready = false;
    this.session = null;
    this.space = null; // 'local-floor' | 'local'
    this.lastError = null;

    this.group = new THREE.Group();
    this.group.name = 'xr';
    this.group.visible = false;
    this.rig = new THREE.Group();
    this.rig.name = 'xr-rig';
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.03, 900);
    this.camera.name = 'xr-kamera';
    this.rig.add(this.camera);
    this.group.add(this.rig);
    this.overlay = new VrOverlay();
    this.camera.add(this.overlay.mesh);
    // Handgelenk, Menü und Zielpunkt erst beim ersten VR-Start (Leinwände kosten Speicher – ohne VR nie angelegt)
    this.wrist = null;
    this.menu = null;
    this.dot = null;
    if (G.scene) G.scene.add(this.group);

    // Trackingraum
    this.head = pose();
    this.hands = { main: hand(), off: hand() };
    this.center = new THREE.Vector2();
    this.rigYaw = 0;
    this.calib = 1.65;
    this._calibT = 0;
    this._physStance = 'stand';
    this._physEye = EYE.stand;
    this._drop = 0;
    this._snapArmed = true;
    this._snapPulse = 0;
    this._turnRate = 0;
    // Welt
    /** Kopf in Weltkoordinaten (nach Wandabstand) = player.getEyePosition() in VR. */
    this.eye = new THREE.Vector3();
    this.headQuat = new THREE.Quaternion();
    this.headFwd = new THREE.Vector3(0, 0, -1);
    /** Laufrichtung der Kugeln (Auge → Zielpunkt) und Zielpunkt (Lauf der Waffe gegen Welt/Gegner). */
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.aimPoint = new THREE.Vector3();
    this.aimDist = AIM_RANGE;
    this._aimFrame = -1;
    this._posedFrame = -1;
    this._dotT = 0;
    this._dotKind = '';
    this._menuPrev = { trig: false, a: false, nav: 0 };
    this._resultAt = null;
    this._wasAlive = true;
    this._loop = (t, f) => { if (f && this.onFrame) this.onFrame(t, f); };
    this._onEnd = () => this._ended();
    this._onVis = () => { if (this.session && this.session.visibilityState !== 'visible') this._pauseGame(); };
    this._onDeviceChange = () => this.probe();

    if (G.player) { G.player.xr = this; G.player.xrLean = 0; }
    this._wire();
    this._buildButton();
    this.probe();
  }

  /* ================================================================ Zustand */

  /** VR-Einstellung an? */
  get enabled() { return !!(this.G.settings && this.G.settings.get('vrEnabled')); }
  /** Einstellung an und Gerät/Browser kann VR. */
  get available() { return this.enabled && this.supported === true; }

  /** Gamepads der Hände für engine/input.js ({ main, off } | null außerhalb der Sitzung). */
  get gamepads() {
    if (!this.presenting) return null;
    return { main: this.hands.main.gamepad, off: this.hands.off.gamepad };
  }

  /** navigator.xr fragen (beim Start, bei Gerätewechsel). */
  async probe() {
    const xr = typeof navigator !== 'undefined' ? navigator.xr : null;
    if (!xr || typeof xr.isSessionSupported !== 'function') { this.supported = false; this._syncButton(); return false; }
    if (!this._probed) {
      this._probed = true;
      try { xr.addEventListener('devicechange', this._onDeviceChange); } catch { /* alte Implementierungen */ }
    }
    try { this.supported = !!(await xr.isSessionSupported('immersive-vr')); } catch { this.supported = false; }
    this._syncButton();
    this.G.events.emit('xr:support', { supported: this.supported });
    return this.supported;
  }

  /* ================================================================ Sitzung */

  /** Handgelenk-Anzeige, Menü und Zielpunkt anlegen (einmal, beim ersten VR-Start). */
  _ensureParts() {
    if (this.wrist) return;
    this.wrist = new WristHud(this.G);
    this.group.add(this.wrist.mesh);
    this.menu = new VrMenu(this.G);
    this.group.add(this.menu.group);
    const dm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false });
    dm.toneMapped = false;
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(1, 16), dm);
    this.dot.name = 'xr-zielpunkt';
    this.dot.renderOrder = 1e5;
    this.dot.visible = false;
    this.group.add(this.dot);
  }

  /**
   * VR starten – direkt aus einer Nutzergeste (Klick) aufrufen: requestSession ist der erste Aufruf (kein await davor).
   * → Promise<boolean>
   */
  async start() {
    if (this.presenting || this.starting || !this.available) return false;
    const G = this.G;
    this.starting = true;
    this.lastError = null;
    let session = null;
    try {
      // kein await davor: requestSession braucht die Nutzergeste dieses Klicks
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    } catch (err) {
      this.starting = false;
      this.lastError = err;
      console.warn('[NULLPUNKT] VR konnte nicht gestartet werden:', err);
      G.events.emit('xr:error', { error: err });
      return false;
    }
    const r = G.renderer.renderer;
    try {
      // Referenzraum: local-floor (Boden = 0, Höhe echt), sonst local (Start-Kopfhöhe = 0)
      let type = 'local-floor';
      try { await session.requestReferenceSpace('local-floor'); } catch { type = 'local'; }
      this.space = type;
      const scale = this._preset(true);
      r.xr.enabled = true;
      r.xr.setReferenceSpaceType(type);
      r.xr.setFramebufferScaleFactor(scale);
      r.xr.setFoveation(1);
      session.addEventListener('end', this._onEnd);
      session.addEventListener('visibilitychange', this._onVis);
      this.session = session;
      // Schleife vor setSession: Aufrufe ohne XRFrame (Fenster-rAF von three.js) werden ignoriert
      r.setAnimationLoop(this._loop);
      await r.xr.setSession(session);
    } catch (err) {
      this.lastError = err;
      console.error('[NULLPUNKT] VR-Sitzung:', err);
      this.starting = false;
      try { await session.end(); } catch { /* schon beendet */ }
      this._ended();
      G.events.emit('xr:error', { error: err });
      return false;
    }
    this.starting = false;
    this.presenting = true;
    this.ready = false;
    this._calibT = 0;
    this._resultAt = null;
    this._wasAlive = !!(G.player && G.player.alive);
    this._physStance = 'stand';
    this._physEye = EYE.stand;
    this._drop = 0;
    this._ensureParts();
    this.group.visible = true;
    this.overlay.reset();
    this.overlay.fadeTo(1, 0.1, 1);
    this.wrist.reset();
    this.menu.hide();
    if (G.input) { G.input.exitLock(); if (typeof G.input.setXr === 'function') G.input.setXr(true); }
    this._syncButton();
    G.events.emit('xr:start', { space: this.space });
    if (this.onStart) { try { this.onStart(); } catch (err) { console.error(err); } }
    return true;
  }

  /** VR beenden (Menü, Matchende, Lobby). */
  end() {
    const s = this.session;
    if (!s) return;
    try { const p = s.end(); if (p && p.catch) p.catch(() => this._ended()); } catch { this._ended(); }
  }

  _ended() {
    const G = this.G;
    const was = this.presenting;
    const r = G.renderer && G.renderer.renderer;
    if (this.session) {
      this.session.removeEventListener('end', this._onEnd);
      this.session.removeEventListener('visibilitychange', this._onVis);
    }
    this.session = null;
    this.presenting = false;
    this.starting = false;
    this.ready = false;
    if (r) { r.setAnimationLoop(null); r.xr.enabled = false; }
    this.group.visible = false;
    if (this.menu) this.menu.hide();
    this.overlay.reset();
    if (this.wrist) this.wrist.reset();
    if (this.dot) this.dot.visible = false;
    this._resultAt = null;
    for (const h of [this.hands.main, this.hands.off]) { h.src = null; h.gamepad = null; h.grip.ok = h.ray.ok = h.gripW.ok = h.rayW.ok = false; }
    this.head.ok = false;
    this._preset(false);
    if (G.player) G.player.xrLean = 0;
    if (G.input && typeof G.input.setXr === 'function') G.input.setXr(false);
    if (G.renderer && typeof G.renderer.resize === 'function') G.renderer.resize(true);
    this._syncButton();
    if (was) {
      G.events.emit('xr:end', {});
      if (this.onEnd) { try { this.onEnd(); } catch (err) { console.error(err); } }
    }
  }

  /**
   * VR-Grafikvorgabe an/aus. an: Stufe „Niedrig“ auf Brillen-Browsern (Einstellung vrQuality), Rückgabe = Faktor der
   * Bildpuffergröße (vrScale; auto: Brille 0,8, PC 1). aus: vorige Stufe wiederherstellen.
   */
  _preset(on) {
    const G = this.G;
    const R = G.renderer;
    const S = G.settings;
    const standalone = typeof navigator !== 'undefined' && STANDALONE_UA.test(navigator.userAgent || '');
    if (on) {
      const q = S.get('vrQuality');
      const low = q === 'niedrig' || (q === 'auto' && standalone);
      this._prevQuality = null;
      if (low && R && R.quality !== 'low') { this._prevQuality = R.requested; R.setQuality('low'); }
      const sc = S.get('vrScale');
      return sc === 'auto' ? (standalone ? 0.8 : 1) : clamp(Number(sc) || 1, 0.5, 1);
    }
    if (this._prevQuality != null && R) { R.setQuality(this._prevQuality); }
    this._prevQuality = null;
    return 1;
  }

  /* ================================================================ Bild (main.js) */

  /** Je XR-Bild vor der Simulation: Kopf- und Handposen im Trackingraum, automatische Höhenmessung. */
  beginFrame(dt, frame) {
    if (!this.presenting || !frame || !this.session) return;
    const r = this.G.renderer.renderer;
    const ref = r.xr.getReferenceSpace();
    if (!ref) return;
    let vp = null;
    try { vp = frame.getViewerPose(ref); } catch { vp = null; }
    readPose(this.head, vp);
    const mainSide = this.G.settings.get('vrHand') === 'links' ? 'left' : 'right';
    const M = this.hands.main, O = this.hands.off;
    M.grip.ok = M.ray.ok = O.grip.ok = O.ray.ok = false;
    M.gamepad = O.gamepad = null;
    for (const src of this.session.inputSources || []) {
      const side = src.handedness;
      if (side !== 'left' && side !== 'right') continue;
      const h = side === mainSide ? M : O;
      h.src = src;
      h.gamepad = src.gamepad || null;
      try {
        readPose(h.grip, src.gripSpace ? frame.getPose(src.gripSpace, ref) : null);
        readPose(h.ray, src.targetRaySpace ? frame.getPose(src.targetRaySpace, ref) : null);
      } catch { h.grip.ok = h.ray.ok = false; }
      if (!h.grip.ok && h.ray.ok) { h.grip.pos.copy(h.ray.pos); h.grip.quat.copy(h.ray.quat); h.grip.ok = true; }
    }
    // Höhe + Ausrichtung beim ersten stabilen Kopfbild
    if (!this.ready && this.head.ok) {
      this._calibT += dt;
      if (this._calibT >= CALIB_DELAY) {
        const S = this.G.settings;
        const stored = Number(S.get('vrHeight')) || 0;
        // Stehend mit gespeicherter Höhe (local-floor) – sonst die aktuelle Kopfhöhe
        this.calib = !S.get('vrSeated') && this.space === 'local-floor' && stored > 0.8 ? stored : this.head.pos.y;
        this.realign();
        this.ready = true;
        this.overlay.fadeTo(0, 0.6);
        const st = this.G.match && this.G.match.state;
        if (st === 'paused') this.openMenu();
        else if (st === 'ended') this._showResult();
      }
    }
  }

  /**
   * Nach input.update, nur während der Simulation: Drehen, Laufrichtung, Zielen am Auge, Kopf → Blick des Spielers,
   * Raumbewegung, Lehnen, echtes Ducken/Hinlegen.
   */
  preUpdate(dt) {
    const G = this.G;
    const p = G.player;
    const input = G.input;
    if (!this.presenting || !p || !input) return;
    input.look.dx = 0;
    input.look.dy = 0;
    if (!this.ready) { input.move.x = 0; input.move.y = 0; return; }
    const S = G.settings;
    // Drehen (Stick der Haupthand) – nicht im Menü (online läuft die Simulation dort weiter, der Stick bedient das Menü)
    const tx = input.enabled && input.xr ? input.xr.turn : 0;
    let turned = 0;
    if (S.get('vrTurn') === 'fluessig') {
      const m = Math.abs(tx);
      if (m > TURN_DEAD) turned = -Math.sign(tx) * ((m - TURN_DEAD) / (1 - TURN_DEAD)) * ((S.get('vrTurnSpeed') || 120) * Math.PI / 180) * dt;
      this._snapArmed = true;
    } else {
      if (!this._snapArmed && Math.abs(tx) < SNAP_OUT) this._snapArmed = true;
      if (this._snapArmed && Math.abs(tx) > SNAP_IN) {
        turned = -Math.sign(tx) * (Number(S.get('vrTurnStep')) || 30) * Math.PI / 180;
        this._snapArmed = false;
        this._snapPulse = 1;
      }
    }
    if (turned) this.rigYaw = wrap(this.rigYaw + turned);
    this._turnRate = dt > 0 ? Math.abs(turned) / dt : 0;
    if (Math.abs(turned) > 1e-6) this.G.events.emit('xr:turn', { amount: turned });
    // Kopf → Blick des Spielers (Laufrichtung und Lehnachse)
    this._headForward(_f);
    p.yaw = Math.atan2(-_f.x, -_f.z);
    p.pitch = Math.asin(clamp(_f.y, -1, 1));
    // Laufen relativ zur Controller-Richtung (Nebenhand)
    const O = this.hands.off;
    if (S.get('vrMoveDir') === 'controller' && O.ray.ok && (input.move.x || input.move.y)) {
      _v.set(0, 0, -1).applyQuaternion(O.ray.quat).applyAxisAngle(UP, this.rigYaw);
      _v.y = 0;
      if (_v.lengthSq() > 1e-4) {
        _v.normalize();
        const cy = Math.atan2(-_v.x, -_v.z) - p.yaw;
        const c = Math.cos(cy), s = Math.sin(cy);
        const mx = input.move.x, my = input.move.y;
        // Wunschvektor im Controller-Rahmen in den Blickrahmen drehen (Drehung um +cy)
        input.move.x = mx * c - my * s;
        input.move.y = mx * s + my * c;
      }
    }
    // Zielen: Waffe am Auge (zusätzlich zur Griff-Taste)
    if (typeof input.setXrPose === 'function') input.setXrPose('ads', p.alive && this._adsNear());
    // Countdown/Menü: echtes Gehen verschiebt den Körper nicht (die Welt gleitet mit), sonst wie Laufen
    this._body(dt, p, G.match.state !== 'playing');
  }

  /** Waffe ans Auge gehoben? Strahl der Haupthand läuft ≤ 7 cm am Kopf vorbei, zeigt grob in Blickrichtung, Hand ≤ 55 cm vor dem Kopf. */
  _adsNear() {
    const r = this.hands.main.ray;
    if (!r.ok || !this.head.ok) return false;
    const d = _v.set(0, 0, -1).applyQuaternion(r.quat);
    const to = _v2.subVectors(this.head.pos, r.pos);
    const t = to.dot(d); // Kopf liegt hinter dem Strahlursprung → t < 0
    if (t > 0.05 || t < -0.55) return false;
    const off = to.addScaledVector(d, -t).length();
    if (off > 0.07) return false;
    const hf = _f.set(0, 0, -1).applyQuaternion(this.head.quat);
    return hf.dot(d) > 0.9; // ≈ 25°
  }

  /** Raumbewegung (Körper folgt dem Kopf), Lehnen aus dem Seitenversatz, echtes Ducken/Hinlegen. */
  _body(dt, p, frozen = false) {
    const S = this.G.settings;
    const h = this.head.pos;
    const c = this.center;
    const physical = !!S.get('vrPhysical');
    if (!p.alive || p.vehicle || p.mantling) {
      if (!p.alive) c.set(h.x, h.z);
      p.xrLean = 0;
      return;
    }
    // waagerechte Kopfachsen im Trackingraum
    _v.set(0, 0, -1).applyQuaternion(this.head.quat);
    let fx = _v.x, fz = _v.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 0.2) { fx = this._lastFx ?? 0; fz = this._lastFz ?? -1; } else { fx /= fl; fz /= fl; this._lastFx = fx; this._lastFz = fz; }
    const rx = -fz, rz = fx;
    const ox = h.x - c.x, oz = h.z - c.y;
    const lat = ox * rx + oz * rz;
    const fwd = ox * fx + oz * fz;
    const side = p.prone ? LEAN.prone : p.crouching ? LEAN.crouch : LEAN.stand;
    const latLim = physical ? side : 0;
    const exL = Math.abs(lat) > latLim ? lat - Math.sign(lat) * latLim : 0;
    const exF = Math.abs(fwd) > FWD_MAX ? fwd - Math.sign(fwd) * FWD_MAX : 0;
    // Rückführung: vor/zurück zügig (Körper folgt), seitlich nur innerhalb der Totzone (sonst bliebe kein Lehnen)
    const dF = exF + (fwd - exF) * damp(1 / 0.6, dt);
    const dL = exL + (Math.abs(lat) < LEAN_DEAD ? (lat - exL) * damp(1 / 1.5, dt) : 0);
    const dx = rx * dL + fx * dF, dz = rz * dL + fz * dF;
    c.x += dx;
    c.y += dz;
    if (!frozen && Math.abs(dx) + Math.abs(dz) > 1e-5) {
      // Trackingraum → Welt (Drehung um Y)
      const cy = Math.cos(this.rigYaw), sy = Math.sin(this.rigYaw);
      this._moveBody(p, dx * cy + dz * sy, -dx * sy + dz * cy, dt);
    }
    // Lehnen (−1 … 1), Wandgrenzen und Feder in player._updateLean: seitlicher Versatz zur Körpermitte oder Neigen des
    // Kopfes (Rollen ab 8°, voll bei 28° – beim Spähen um eine Ecke neigt man den Kopf mit) – der stärkere Anteil zählt
    const l = lat - dL;
    let lean = 0;
    if (physical) {
      lean = Math.sign(l) * clamp((Math.abs(l) - LEAN_DEAD) / Math.max(0.05, side - LEAN_DEAD), 0, 1);
      const roll = -Math.asin(clamp(_v2.set(1, 0, 0).applyQuaternion(this.head.quat).y, -1, 1)); // > 0: nach rechts geneigt
      const rl = Math.sign(roll) * clamp((Math.abs(roll) - ROLL_DEAD) / (ROLL_FULL - ROLL_DEAD), 0, 1);
      if (Math.abs(rl) > Math.abs(lean)) lean = rl;
    }
    p.xrLean = lean;
    // Echte Kopfhöhe → Haltung (nur stehend gespielt)
    if (physical && !S.get('vrSeated')) {
      const r = (EYE.stand + h.y - this.calib) / EYE.stand;
      let st = this._physStance;
      if (st === 'stand') { if (r < STANCE.proneIn) st = 'prone'; else if (r < STANCE.crouchIn) st = 'crouch'; }
      else if (st === 'crouch') { if (r < STANCE.proneIn) st = 'prone'; else if (r > STANCE.crouchOut) st = 'stand'; }
      else if (r > STANCE.crouchOut) st = 'stand';
      else if (r > STANCE.proneOut) st = 'crouch';
      if (st !== this._physStance) {
        this._physStance = st;
        try { p.setStance(st); } catch (err) { console.error(err); }
        this.G.events.emit('xr:stance', { stance: st, ratio: r });
      }
    } else this._physStance = 'stand';
    this._physEye += (EYE[this._physStance] - this._physEye) * damp(14, dt);
  }

  /** Körper um (dx, dz) (Welt) mit Kollision verschieben (echtes Gehen). Große Sprünge (Tracking verloren) nur zentrieren. */
  _moveBody(p, dx, dz, dt) {
    const body = p.body;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5 || len > 0.6) return;
    const world = this.G.world;
    if (!world) { body.position.x += dx; body.position.z += dz; return; }
    const v = body.velocity;
    const sx = v.x, sy = v.y, sz = v.z;
    const step = Math.max(dt, 1 / 120);
    v.set(dx / step, 0, dz / step);
    try { body.step(step, world, { gravity: 0, stepHeight: 0.45 }); } catch (err) { console.error(err); }
    // Stufen beim Gehen weich (wie die Stufenglättung der Kamera)
    if (Number.isFinite(p._stepSmooth)) p._stepSmooth = clamp(p._stepSmooth - (body.stepOffset || 0), -0.5, 0.5);
    v.set(sx, sy, sz);
  }

  /** Kopf-Vorwärtsrichtung in Weltkoordinaten (rigYaw + Kopfdrehung). */
  _headForward(out) {
    _q.setFromAxisAngle(UP, this.rigYaw).multiply(this.head.quat);
    return out.set(0, 0, -1).applyQuaternion(_q);
  }

  /** Körper unter den Kopf, Blick in Spielerrichtung (VR-Start, Wiedereinstieg, Kalibrieren). */
  realign(yaw = null) {
    const p = this.G.player;
    const target = Number.isFinite(yaw) ? yaw : p ? p.yaw : 0;
    _v.set(0, 0, -1).applyQuaternion(this.head.quat);
    const headYaw = Math.atan2(-_v.x, -_v.z);
    this.rigYaw = wrap(target - headYaw);
    this.center.set(this.head.pos.x, this.head.pos.z);
    this._physStance = 'stand';
    this._physEye = EYE.stand;
    this._aimFrame = -1;
  }

  /** Höhe kalibrieren (Menü): aktuelle Kopfhöhe = Stehen bzw. Sitzen; stehend auf diesem Gerät gespeichert. */
  calibrate() {
    if (!this.head.ok) return false;
    const S = this.G.settings;
    this.calib = this.head.pos.y;
    if (!S.get('vrSeated') && this.space === 'local-floor') S.set('vrHeight', this.head.pos.y);
    const p = this.G.player;
    this.realign(p ? p.yaw : null);
    if (p && p.alive && !p.prone) { try { p.setStance('stand'); } catch { /* */ } }
    this.overlay.fadeTo(0, 0.35, 0.6);
    this.G.events.emit('xr:calibrate', { height: this.calib });
    return true;
  }

  /**
   * player._updateCamera (Ende, jedes Mal): Rig aus dem Körper, Kamera = Kopf (Wandabstand), Hände in Weltkoordinaten,
   * Zielpunkt (einmal je Bild). → false, solange VR nicht bereit ist.
   */
  poseCamera(cam) {
    const G = this.G;
    const p = G.player;
    if (!this.presenting || !this.ready || !p) return false;
    if (p.alive) this._drop = Math.min(0, (p._eye ?? EYE.stand) - this._physEye);
    const vOff = EYE.stand - this.calib + this._drop + (Number.isFinite(p._stepSmooth) ? p._stepSmooth : 0);
    const rig = this.rig;
    rig.rotation.set(0, this.rigYaw, 0);
    _v.set(this.center.x, 0, this.center.y).applyAxisAngle(UP, this.rigYaw);
    const b = p.body.position;
    rig.position.set(b.x - _v.x, b.y + vOff, b.z - _v.z);
    rig.updateMatrixWorld(true);
    // Kopf in der Welt, 12 cm Abstand zu Wänden/Decken (das Rig weicht aus)
    const head = _v2.copy(this.head.pos).applyMatrix4(rig.matrixWorld);
    this.eye.copy(head);
    this._clearHead(p, this.eye);
    if (this.eye.distanceToSquared(head) > 1e-8) {
      rig.position.add(_v.subVectors(this.eye, head));
      rig.updateMatrixWorld(true);
    }
    this.headQuat.copy(rig.quaternion).multiply(this.head.quat);
    this.headFwd.set(0, 0, -1).applyQuaternion(this.headQuat);
    if (cam) {
      cam.position.copy(this.eye);
      cam.quaternion.copy(this.headQuat);
      cam.updateMatrixWorld();
    }
    // Hände
    for (const h of [this.hands.main, this.hands.off]) {
      toWorld(h.grip, h.gripW, rig);
      toWorld(h.ray, h.rayW, rig);
    }
    this._posedFrame = G.time.frame;
    if (this._aimFrame !== G.time.frame) { this._aimFrame = G.time.frame; this._updateAim(p); }
    return true;
  }

  _clearHead(p, pos) {
    const world = this.G.world;
    if (!world || !world.collider) return;
    const b = p.body;
    const lo = b.position.y + 0.3, hi = b.position.y + Math.max(0.3, b.height - 0.1);
    const o = _f.set(b.position.x, clamp(pos.y, lo, hi), b.position.z);
    const d = _v.subVectors(pos, o);
    const len = d.length();
    if (len > 1e-4) {
      d.multiplyScalar(1 / len);
      const r = collisionRay(world, o, d, len + HEAD_R, _hit);
      if (r && r.distance < len + HEAD_R) pos.copy(o).addScaledVector(d, Math.max(0, r.distance - HEAD_R));
    }
    keepClear(world, pos, HEAD_R);
  }

  /** Zielpunkt: Strahl der Haupthand gegen Welt und Gegner; Laufrichtung = Auge → Zielpunkt. */
  _updateAim(p) {
    const r = this.hands.main.rayW;
    if (!r.ok) {
      this.aimDir.copy(this.headFwd);
      this.aimDist = 50;
      this.aimPoint.copy(this.eye).addScaledVector(this.aimDir, 50);
      return;
    }
    const G = this.G;
    let dist = AIM_RANGE;
    try {
      const hit = G.world && typeof G.world.raycast === 'function' ? G.world.raycast(r.pos, r.dir, AIM_RANGE) : null;
      if (hit && hit.distance < dist) dist = hit.distance;
    } catch { /* Welt im Abbau */ }
    try {
      if (G.combat && typeof G.combat._raycastActors === 'function') {
        _ray.set(r.pos, r.dir);
        const ah = G.combat._raycastActors(p, _ray, dist);
        if (ah && ah.distance < dist) dist = ah.distance;
      }
    } catch { /* */ }
    this.aimDist = dist;
    this.aimPoint.copy(r.pos).addScaledVector(r.dir, dist);
    const d = _v.subVectors(this.aimPoint, this.eye);
    const l = d.length();
    if (l < 0.3 || d.dot(r.dir) <= 0) this.aimDir.copy(r.dir);
    else this.aimDir.copy(d).multiplyScalar(1 / l);
  }

  /** Laufrichtung inkl. Rückstoß/Zucken (Radiant, wie player.getAimDirection). */
  aimDirection(out, yawOff = 0, pitchOff = 0) {
    const d = this.aimDir;
    if (!yawOff && !pitchOff) return out.copy(d);
    const yaw = Math.atan2(-d.x, -d.z) + yawOff;
    const pitch = clamp(Math.asin(clamp(d.y, -1, 1)) + pitchOff, -1.55, 1.55);
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  }

  /**
   * Pose der Waffe (weapons/viewmodel.js): Position = Griff der Haupthand, Drehung = Zielstrahl (Lauf zeigt dorthin,
   * wohin auch der Zielpunkt zeigt). → false ohne verfolgte Haupthand.
   */
  gunPose(pos, quat) {
    if (!this.presenting || !this.ready) return false;
    const M = this.hands.main;
    if (!M.rayW.ok) return false;
    pos.copy(M.gripW.ok ? M.gripW.pos : M.rayW.pos);
    quat.copy(M.rayW.quat);
    return true;
  }

  /** Je XR-Bild nach der Simulation: Kamera/Hände (auch in der Pause), Overlay, Handgelenk, Zielpunkt, Menü. */
  endFrame(dt, sim) {
    if (!this.presenting) return;
    const G = this.G;
    const p = G.player;
    if (this.ready && this._posedFrame !== G.time.frame) this.poseCamera(G.camera);
    if (!this.ready) { this.overlay.update(dt); return; }
    // Waffe in der Hand, auch wenn die Simulation steht (Pause, Matchende)
    const vm = G.viewmodel && G.viewmodel.rig;
    if (!sim && vm && typeof vm.syncXr === 'function') { try { vm.syncXr(); } catch { /* */ } }
    const S = G.settings;
    // Komfort-Vignette: Stick-Bewegung/Geschwindigkeit, Drehen (flüssig) und kurzer Impuls beim Schrittdrehen
    this._snapPulse = Math.max(0, this._snapPulse - dt * 5);
    let mv = 0;
    if (p && p.alive && sim) {
      const v = p.body.velocity;
      mv = Math.min(1, Math.hypot(v.x, v.z) / 4.5);
      if (G.input) mv = Math.max(mv, Math.min(1, Math.hypot(G.input.move.x, G.input.move.y)) * 0.8);
    }
    const turn = Math.min(1, this._turnRate / 2);
    this.overlay.vignette = S.get('vrVignette') ? Math.max(mv, turn, this._snapPulse) : 0;
    // Tod: abdunkeln; Wiedereinstieg blendet über actor:spawn auf
    const alive = !!(p && p.alive);
    if (this._wasAlive && !alive) this.overlay.fadeTo(0.82, 0.9);
    this._wasAlive = alive;
    const strength = clamp(S.get('vrVignetteStrength') ?? 0.6, 0.1, 1);
    this.overlay.update(dt, { strength, inner: 0.85 - 0.35 * strength });
    // Handgelenk (Nebenhand)
    const O = this.hands.off;
    this.wrist.place(O.gripW.ok ? O.gripW : null, this.eye, this.headFwd);
    this.wrist.update(dt);
    // Zielpunkt der Waffe
    this._updateDot(dt, alive);
    // Menü / Ergebnis
    this._updateMenu(dt);
    if (this._resultAt != null && G.time.real >= this._resultAt) { this._resultAt = null; this.end(); }
  }

  _updateDot(dt, alive) {
    const d = this.dot;
    this._dotT = Math.max(0, this._dotT - dt);
    const vm = this.G.viewmodel;
    const show = alive && this.G.settings.get('vrLaser') && this.hands.main.rayW.ok && !this.menu.open && !!(vm && vm.scene && vm.scene.visible !== false);
    d.visible = show;
    if (!show) return;
    // 2,5 mrad scheinbare Größe (beim Treffer größer), knapp vor der Fläche, zum Kopf gedreht
    const dist = Math.max(0.5, this.eye.distanceTo(this.aimPoint));
    d.position.copy(this.aimPoint).addScaledVector(this.hands.main.rayW.dir, -0.02);
    d.scale.setScalar(dist * (this._dotT > 0 ? 0.0055 : 0.0028));
    _m.lookAt(this.eye, d.position, UP);
    d.quaternion.setFromRotationMatrix(_m);
    d.material.color.set(this._dotT > 0 ? (this._dotKind === 'kill' ? 0xff3b1f : this._dotKind === 'head' ? 0xffc23d : 0xff8a4f) : 0xffffff);
  }

  /* ================================================================ Menü in der Brille */

  /** Pausenmenü in VR (main: Pause → match:state 'paused'). */
  openMenu() {
    if (!this.presenting || !this.ready) return;
    const S = this.G.settings;
    const items = [
      { id: 'weiter', label: 'Weiter' },
      { id: 'vignette', label: () => `Vignette: ${S.get('vrVignette') ? 'an' : 'aus'}` },
      { id: 'drehen', label: () => `Drehen: ${S.get('vrTurn') === 'fluessig' ? 'flüssig' : `in Schritten (${S.get('vrTurnStep')}°)`}` },
      { id: 'hoehe', label: () => `Höhe kalibrieren${S.get('vrSeated') ? ' (sitzend)' : ' (gerade hinstellen)'}` },
      { id: 'beenden', label: 'VR beenden' },
    ];
    this.menu.show('menu', this.eye, this.headQuat, { items, title: 'Menü', sub: this._matchLine() });
    this._menuPrev.trig = this._menuPrev.a = true; // gehaltener Abzug klickt nicht sofort
  }

  closeMenu() { if (this.menu && this.menu.open && this.menu.kind === 'menu') this.menu.hide(); }

  _matchLine() {
    const G = this.G;
    const m = G.mode;
    const def = m && m.def;
    const parts = [def && def.name, G.world && G.world.name];
    if (m && Number.isFinite(m.timeLeft)) { const t = Math.max(0, Math.ceil(m.timeLeft)); parts.push(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`); }
    if (m && m.teams && m.scores && G.player) { const a = G.player.team === 'B' ? 'B' : 'A'; parts.push(`${m.scores[a] || 0} : ${m.scores[a === 'A' ? 'B' : 'A'] || 0}`); }
    return parts.filter(Boolean).join(' · ');
  }

  _updateMenu(dt) {
    const menu = this.menu;
    if (!menu.open) return;
    if (menu.kind === 'menu') menu.sub = this._matchLine();
    else if (this._resultAt != null) menu.sub = `VR wird in ${Math.max(1, Math.ceil(this._resultAt - this.G.time.real))} s beendet …`;
    const M = this.hands.main;
    const gp = M.gamepad;
    const b = gp && gp.buttons ? gp.buttons : [];
    const trig = !!(b[0] && (b[0].pressed || b[0].value > 0.55));
    const a = !!(b[4] && b[4].pressed);
    const y = gp && gp.axes ? gp.axes[3] || 0 : 0;
    const nav = y < -0.7 ? -1 : y > 0.7 ? 1 : 0;
    const prev = this._menuPrev;
    const press = (trig && !prev.trig) || (a && !prev.a);
    const navEdge = nav !== 0 && nav !== prev.nav ? nav : 0;
    prev.trig = trig; prev.a = a; prev.nav = nav;
    const ray = M.rayW.ok ? { origin: M.rayW.pos, dir: M.rayW.dir } : null;
    const id = menu.update(dt, ray, press, navEdge);
    if (id) this._menuAction(id);
  }

  _menuAction(id) {
    const G = this.G;
    const S = G.settings;
    G.events.emit('ui:sound', { name: id === 'beenden' || id === 'jetzt' ? 'back' : 'click' });
    this._pulse(this.hands.main, 0.2, 20);
    if (id === 'weiter') { this.menu.hide(); if (G.menus && typeof G.menus.onResume === 'function') G.menus.onResume(); }
    else if (id === 'vignette') S.set('vrVignette', !S.get('vrVignette'));
    else if (id === 'drehen') S.set('vrTurn', S.get('vrTurn') === 'fluessig' ? 'schritt' : 'fluessig');
    else if (id === 'hoehe') this.calibrate();
    else if (id === 'beenden' || id === 'jetzt') this.end();
  }

  /** Matchende: Ergebnistafel, dann VR beenden (Endbildschirm/Lobby sind 2D). */
  _showResult() {
    if (!this.presenting || !this.ready) { this.end(); return; }
    const res = this.G.match && this.G.match.result;
    const title = !res || res.draw ? 'Unentschieden' : res.playerWon ? 'Sieg' : 'Niederlage';
    this._resultAt = this.G.time.real + RESULT_TIME;
    this.menu.show('result', this.eye, this.headQuat, { items: [{ id: 'jetzt', label: 'VR jetzt beenden' }], title, sub: '' });
    this._menuPrev.trig = this._menuPrev.a = true;
  }

  /* ================================================================ Ereignisse, Rückmeldung */

  _wire() {
    const G = this.G;
    const ev = G.events;
    const P = () => G.player;
    ev.on('weapon:fire', ({ actor, weaponId } = {}) => {
      if (!this.presenting || actor !== P()) return;
      const def = G.data && G.data.WEAPONS ? G.data.WEAPONS[weaponId] : null;
      const heavy = def && (def.cls === 'sniper' || def.cls === 'shotgun' || def.cls === 'lmg');
      this._pulse(this.hands.main, heavy ? 0.7 : 0.35, heavy ? 45 : 25);
    });
    ev.on('actor:hit', ({ attacker, target, zone, killed } = {}) => {
      if (!this.presenting || !attacker || attacker !== P() || target === P()) return;
      const kind = killed ? 'kill' : zone === 'head' ? 'head' : '';
      this._dotT = killed ? 0.35 : 0.15;
      this._dotKind = kind;
      this.wrist.hit(kind);
      this._pulse(this.hands.main, killed ? 0.5 : 0.2, killed ? 40 : 15);
    });
    ev.on('player:damaged', ({ amount, dir, attacker } = {}) => {
      if (!this.presenting) return;
      const p = P();
      let src = null;
      if (attacker && attacker !== p && attacker.position && p) src = _v.subVectors(attacker.position, p.position).setY(0).normalize();
      else if (dir) src = _v.set(-dir.x, 0, -dir.z).normalize();
      this.overlay.hit(Math.min(1, 0.35 + (Number(amount) || 10) / 60), src && src.lengthSq() > 0.5 ? src : null);
      this._pulse(this.hands.off, 0.5, 60);
      this._pulse(this.hands.main, 0.35, 40);
    });
    ev.on('kill', ({ killer, victim } = {}) => {
      const p = P();
      if (!victim || !this.wrist) return;
      this.wrist.pushKill(killer, victim, killer === p || victim === p);
    });
    ev.on('actor:spawn', ({ actor } = {}) => {
      if (!this.presenting || !this.ready || actor !== P()) return;
      this.realign(actor.yaw);
      this.overlay.fadeTo(0, 0.5, 1);
      this._wasAlive = true;
    });
    ev.on('match:state', ({ state } = {}) => {
      this._syncButton();
      if (!this.presenting) return;
      if (state === 'paused') this.openMenu();
      else this.closeMenu();
      if (state === 'ended') this._showResult();
      else if (state === 'lobby' || state === 'loading') this.end();
    });
    ev.on('settings:change', ({ key, value } = {}) => {
      if (key === 'vrEnabled') { if (!value && this.presenting) this.end(); this._syncButton(); }
      if (key === 'vrSeated' && this.presenting && this.head.ok) this.calibrate();
    });
    ev.on('input:lock', () => this._syncButton());
  }

  _pauseGame() {
    const st = this.G.match && this.G.match.state;
    if (st === 'playing' || st === 'countdown') {
      // wie Esc: main.pause() über das Pausen-Ereignis der Menüs
      if (typeof this.G.pause === 'function') this.G.pause();
    }
  }

  /** Haptik: hand = this.hands.main/off, intensity 0..1, ms. */
  _pulse(h, intensity, ms) {
    const gp = h && h.gamepad;
    if (!gp) return;
    try {
      const act = gp.hapticActuators && gp.hapticActuators[0];
      if (act && typeof act.pulse === 'function') { const r = act.pulse(intensity, ms); if (r && r.catch) r.catch(() => {}); return; }
      const va = gp.vibrationActuator;
      if (va && typeof va.playEffect === 'function') { const r = va.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity }); if (r && r.catch) r.catch(() => {}); }
    } catch { /* nicht unterstützt */ }
  }

  /* ================================================================ Knopf „VR starten“ (2D) */

  _buildButton() {
    if (typeof document === 'undefined') return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'm-btn m-primary xr-start';
    b.hidden = true;
    b.innerHTML = `${VR_ICON}<span>VR starten</span>`;
    b.style.cssText = 'position:fixed;left:50%;bottom:max(16px, env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;display:inline-flex;align-items:center;gap:.5em;pointer-events:auto';
    const svg = b.querySelector('svg');
    if (svg) svg.style.cssText = 'width:1.6em;height:1.6em';
    const stop = (e) => { e.stopPropagation(); };
    b.addEventListener('pointerdown', stop);
    b.addEventListener('mousedown', stop);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.start(); });
    (document.getElementById('game-root') || document.body).appendChild(b);
    this.button = b;
  }

  _syncButton() {
    const b = this.button;
    if (!b) return;
    const st = this.G.match && this.G.match.state;
    const input = this.G.input;
    const show = this.available && !this.presenting && !this.starting && (st === 'countdown' || st === 'playing') && !(input && input.locked);
    if (b.hidden === show) b.hidden = !show;
  }

  /* ================================================================ Tests/Debug */

  debugState() {
    const p = this.G.player;
    return {
      supported: this.supported, enabled: this.enabled, presenting: this.presenting, ready: this.ready, space: this.space,
      rigYaw: this.rigYaw, calib: this.calib, stance: this._physStance, lean: p ? p.xrLean : 0, playerLean: p ? p.lean : 0,
      eye: this.eye.toArray(), aimDir: this.aimDir.toArray(), aimDist: this.aimDist,
      hands: { main: this.hands.main.rayW.ok, off: this.hands.off.gripW.ok },
      menu: this.menu && this.menu.open ? this.menu.kind : null, wristDraws: this.wrist ? this.wrist.draws : 0, wristAmmo: this.wrist ? this.wrist.lastAmmo : '',
      vignette: this.overlay.uniforms.uVig.value, fade: this.overlay.fade,
    };
  }
}

/** Pose im Trackingraum → Welt (über das Rig). */
function toWorld(src, out, rig) {
  if (!src.ok) { out.ok = false; return; }
  out.pos.copy(src.pos).applyMatrix4(rig.matrixWorld);
  out.quat.copy(rig.quaternion).multiply(src.quat);
  out.dir.set(0, 0, -1).applyQuaternion(out.quat);
  out.ok = true;
}
