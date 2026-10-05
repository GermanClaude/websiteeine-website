// NULLPUNKT — Ego-Spieler (Actor, §5): Bewegung mit Gewicht (Beschleunigung/Trägheit je Zustand, Schrägen,
// Stufen, harte Landungen), Sprint, Ducken, COD-Mobile-Rutschen, Sprung, Überklettern (F6), Lehnen Q/E (F5),
// freies Zielen mit Totzone (F4), Körperkamera-Bewegung (F1: Schrittimpulse, Atmung, Sprintwippen,
// Landestauchung, Trägheit beim Beschleunigen und Drehen, Treffer-Stöße – alles × Komfortregler cameraMotion),
// Sprint-FOV, ADS-FOV aus der Waffendefinition, Rückstoß mit Federrückführung (addRecoil), Kamerawackeln
// (shake), COD-Gesundheitsregeneration, Todeskamera, Respawn, Schrittgeräusche je Oberfläche.
//
// Der Spieler besitzt die Kamera-FOV: fov = lerp(Basis + Sprint/Rutsch-Kick, ADS-FOV, adsProgress).
// settings.fov ist das COD-übliche horizontale 4:3-FOV; die Kamera nutzt das vertikale Äquivalent.
// Kamerabewegung verändert nur das Bild, nie die Zielrichtung: getAimDirection() = Sicht + Rückstoß + Zucken +
// freies Zielen; getAimScreenPoint() liefert den Laufpunkt auf dem Bildschirm (Fadenkreuz).

import * as THREE from 'three';
import { CapsuleBody, collisionRay, probeLedge } from './engine/physics.js';
import { raycastHumanoid, PRONE } from './combat.js';
import { canInsertPlate, plateCount, classDef, gadgetDef, GADGETS } from '../shared/classes.data.js';

const STAND_H = 1.8;
const CROUCH_H = 1.15;
const SLIDE_H = 1.0;
const STAND_EYE = 1.65;
const CROUCH_EYE = 1.0;
const SLIDE_EYE = 0.82;
const SPEED_WALK = 5.4;
const SPEED_SPRINT = 8.2;
const SPEED_CROUCH = 2.6;
// Hinlegen (core-mechanics): Kapsel/Auge, Kriechtempo, Übergangszeiten (Waffe gesenkt), Blickgrenzen
const PRONE_H = 0.75;
const PRONE_EYE = 0.38;
const SPEED_PRONE = 1.05;
const ACCEL_PRONE = 6;
const STANCE_TIME = { standProne: 0.75, crouchProne: 0.6, proneCrouch: 0.6, proneStand: 0.85, dive: 0.5 };
const PRONE_PITCH_MIN = -0.52; // −30°
const PRONE_PITCH_MAX = 0.96; // +55°
const PRONE_LEAN_SIDE = 0.18;
const PRONE_HOLD = 0.4; // s Ducken halten (Controller/Touch) → Hinlegen
const GRAVITY = 24;
const JUMP_V = Math.sqrt(2 * GRAVITY * 1.1);
// Beschleunigung (1/s, exponentielle Annäherung an die Wunschgeschwindigkeit): Gehen ~0,18 s auf 90 %,
// Sprint baut Schwung langsamer auf und ab, Umkehren bremst kräftig (kein Eis), Ducken ist flink.
const ACCEL_WALK = 13;
const ACCEL_SPRINT = 7.5;
const ACCEL_CROUCH = 15;
const BRAKE_WALK = 10.5;
const BRAKE_SPRINT = 6.5;
const BRAKE_REVERSE = 16;
const AIR_ACCEL = 2.4;
const SLIDE_TIME = 0.9;
const SLIDE_BOOST = 2.9;
const SLIDE_FRICTION = 1.25;
const REGEN_DELAY = 3.5;
const REGEN_RATE = 55;
const PITCH_LIMIT = 1.48;
const FALL_SAFE = 14; // m/s Aufprallgeschwindigkeit ohne Schaden (≈ 4 m)
const RECOIL_KEEP = 0.3; // Anteil des Rückstoßes, der nicht zurückgeführt wird (Spray wandert)
// Lehnen (F5)
const LEAN_ANGLE = (14 * Math.PI) / 180;
const LEAN_SIDE = 0.38;
const LEAN_SIDE_CROUCH = 0.3;
const LEAN_DROP = 0.06;
const LEAN_OMEGA = 26; // ≈ 0,18 s bis zur vollen Neigung
const HEAD_R = 0.17;
// Freies Zielen (F4): Totzonen-Radius je Einstellung (rad)
const FREE_AIM = { off: 0, light: (2 * Math.PI) / 180, strong: (5 * Math.PI) / 180 };

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _o = new THREE.Vector3();
const _hit = {};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// Kritisch gedämpfte Feder mit Ruhelage 0 (x'' = −ω²x − 2ωx'), exakt gelöst statt explizit
// integriert → stabil für jedes dt (Zeitlupe/Zeitraffer, Bildaussetzer). Ergebnis in `_spr`.
const _spr = { x: 0, v: 0 };
function critSpring(x, v, omega, dt) {
  const e = Math.exp(-omega * dt);
  const b = v + omega * x;
  _spr.x = (x + b * dt) * e;
  _spr.v = (v - omega * b * dt) * e;
  return _spr;
}
const KICK_OMEGA = Math.sqrt(220); // Kameraschlag beim Schuss
const LAND_OMEGA = Math.sqrt(180); // Einknicken bei der Landung

/**
 * Unterkritisch gedämpfte Feder (ζ < 1) mit Ruhelage 0, exakt gelöst (stabil für jedes dt): s = { x, v }.
 * Schrittimpulse addieren Geschwindigkeit; die Feder schwingt organisch aus (Körperkamera).
 */
function wobble(s, omega, zeta, dt) {
  if (!(dt > 0)) return s;
  const a = zeta * omega;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-a * dt);
  const c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
  const c1 = s.x, c2 = (s.v + a * s.x) / wd;
  s.x = e * (c1 * c + c2 * sn);
  s.v = e * ((-a * c1 + wd * c2) * c + (-a * c2 - wd * c1) * sn);
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) { s.x = 0; s.v = 0; }
  return s;
}
const POS_OMEGA = 15, POS_ZETA = 0.55;
const ROT_OMEGA = 13, ROT_ZETA = 0.5;

/** COD-FOV (horizontal, 4:3) → vertikales Kamera-FOV in Grad. */
export function hfovToVfov(hfov) {
  return (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) * 0.75) * 180) / Math.PI;
}

/** Vertikales FOV bei Vergrößerung `zoom` relativ zu `baseFov` (Grad). */
export function zoomFov(baseFov, zoom) {
  return (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / Math.max(1, zoom)) * 180) / Math.PI;
}

export function blankStats() {
  return {
    kills: 0, deaths: 0, assists: 0, score: 0, shotsFired: 0, shotsHit: 0, headshots: 0,
    streak: 0, bestStreak: 0, damage: 0, captures: 0, longestKill: 0,
  };
}

export class Player {
  constructor(G) {
    this.G = G;
    this.id = 'player';
    this.name = (G.settings && G.settings.get('playerName')) || 'Operator';
    this.team = 'A';
    this.isPlayer = true;
    this.isBot = false;
    this.alive = false;
    this.health = 100;
    this.maxHealth = 100;
    this.body = new CapsuleBody({ radius: 0.35, height: STAND_H, crouchHeight: CROUCH_H });
    this.position = this.body.position; // gleiche Vector3-Referenz (Füße)
    this.yaw = 0;
    this.pitch = 0;
    this.loadout = null;
    this.weapon = null;
    this.lastDamageTime = -1e9;
    this.lastFiredTime = -1e9;
    this.stats = blankStats();
    this.weaponStats = {};
    this.visible = true;
    this.godMode = false;
    this.spawnTime = 0;
    this.diedAt = null;
    this.respawnAt = null;
    this.killer = null;

    this.camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.baseFov = 65;
    /** Vergrößerung der aktuellen Waffe im Anschlag (für die ADS-Empfindlichkeit je Zoomstufe). */
    this.adsZoom = 1;

    // Bewegungszustand
    this.crouching = false;
    this.sliding = false;
    this.sprinting = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.slideDir = new THREE.Vector3();
    this._sprintLatch = false;
    this._prevSprintLock = false;
    this._eye = STAND_EYE;
    this._stepSmooth = 0;
    this._landDip = 0;
    this._landVel = 0;
    this._landSlow = 0;
    this._stairSlow = 0;
    this._bobPhase = 0;
    this._stepDist = 0;
    this._stepSide = 1;
    this._tilt = 0;
    this._sprintBlend = 0;
    this._slideBlend = 0;
    this._regenning = false;
    this._jumpBuffer = 0;
    /** 0…1: Anstrengung nach dem Sprint (Atmung, Waffenschwanken). */
    this.exertion = 0;

    // Haltung (core-mechanics): stance 'stand'|'crouch'|'prone', Übergang stanceT 0…1, proneBlend für Trefferzonen/Animation
    this.prone = false;
    this.stance = 'stand';
    this.stanceFrom = 'stand';
    this.stanceT = 1;
    this.proneBlend = 0;
    this.crawling = false;
    this._stanceDur = 0;
    this._stanceEye0 = STAND_EYE;
    this._stanceSide = 1;
    this._crouchHeld = 0;
    this._proneHoldUsed = false;
    this._proneYaw = 0;
    this._dive = false;
    // Klasse, Panzerung (combat.equipArmor setzt this.armor am Spawn), Klassen-Ausrüstung
    this.cls = null;
    this.classDef = null;
    this.armor = null;
    this.plating = false;
    this.gadget = null;
    this.boostUntil = 0;
    this._boostMult = 1;
    this._heal = 0;
    this._busyUntil = 0;
    this._repairing = false;
    this.repairTarget = null;
    this.spotTarget = null;

    // Lehnen (F5)
    /** −1 … 1 (geglättet), − = links. */
    this.lean = 0;
    this._leanVel = 0;
    this._leanWant = 0;
    this._leanLast = 1;
    this._leanLimit = 1;
    /** Waagerechter Kopfversatz durch Lehnen (Welt, m); y = Absenken des Kopfes. */
    this.leanOffset = new THREE.Vector3();
    /** Kamera-Rollwinkel durch Lehnen (rad, ohne Komfortfaktor). */
    this.leanRoll = 0;

    // Freies Zielen (F4)
    /** Laufrichtung relativ zur Sicht (rad): x > 0 rechts, y > 0 oben. */
    this.aimOffset = { x: 0, y: 0 };
    /** Aktueller Totzonen-Radius (rad; schrumpft beim Anlegen). */
    this.freeAimRadius = 0;

    // Überklettern (F6)
    this.mantling = false;
    this.mantleProgress = 0;
    this._mantle = null;

    // Körperkamera (F1): Federn für Translation (Kamera-lokal, m) und Rotation (rad)
    this._cam = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, z: { x: 0, v: 0 }, p: { x: 0, v: 0 }, w: { x: 0, v: 0 }, r: { x: 0, v: 0 } };
    this._breathPh = Math.random() * Math.PI * 2;
    this._accF = 0;
    this._accS = 0;
    this._prevV = new THREE.Vector3();
    this._turn = 0;
    /** Wirksamer Komfortfaktor der Kamerabewegung (0…1). */
    this.cameraMotion = 0.6;

    // Rückstoß / Kamera-Effekte
    this.recoilPitch = 0; // angezeigt + auf das Zielen angewendet
    this.recoilYaw = 0;
    this._recoilTP = 0; // rückführbares Ziel
    this._recoilTY = 0;
    this._recoilRate = 8;
    this._lastRecoilAt = -1e9;
    this._kick = 0;
    this._kickVel = 0;
    this._flinchP = 0;
    this._flinchY = 0;
    this.trauma = 0;
    this._time = 0;
    this._deathCam = null;

    this._intent = {
      fire: false, firePressed: false, ads: false, reload: false, swap: false, slot: null, grenade: false,
      grenadeHeld: false, melee: false, sprinting: false, moving: false, airborne: false, crouching: false,
      sliding: false, speed: 0, onGround: true, lookDX: 0, lookDY: 0, frozen: false,
      tactical: false, tacticalHeld: false, light: false, interact: false,
      leaning: 0, mantling: false, aimOffsetX: 0, aimOffsetY: 0, exertion: 0,
    };
    this._updateBaseFov();
    // Unterdrückung: nahe Vorbeiflüge rucken die Körperkamera kurz (× Komfortregler bei der Ausgabe)
    if (G.events && typeof G.events.on === 'function') {
      G.events.on('bullet:whiz', (e) => this._onWhiz(e));
      G.events.on('kill', (e) => this._onKill(e));
    }
  }

  /** Sturm: nach einem Abschuss kurz schneller. */
  _onKill(e) {
    if (!e || e.killer !== this || e.victim === this || !this.alive) return;
    const pk = (this.classDef && this.classDef.perks) || {};
    if (!pk.sprintAfterKill) return;
    const now = this.G.time ? this.G.time.elapsed : 0;
    if (now >= this.boostUntil || this._boostMult <= pk.sprintAfterKill) { this._boostMult = pk.sprintAfterKill; this.boostUntil = Math.max(this.boostUntil, now + (pk.sprintAfterKillTime || 5)); }
  }

  /** Klasse übernehmen (Spawn bzw. sofortiger Ausrüstungswechsel): Gadget mit vollen Ladungen. */
  applyClass() {
    this.classDef = classDef(this.cls || (this.loadout && this.loadout.cls));
    if (!this.cls) this.cls = this.classDef.id;
    const g = gadgetDef(this.classDef.gadget);
    this.gadget = g ? { id: g.id, charges: g.charges, max: g.charges, cooldownUntil: 0, active: false } : null;
  }

  _onWhiz(e) {
    if (!this.alive || !e) return;
    const k = clamp(1 - (e.distance || 1.5) / 2.2, 0.15, 1);
    const c = this._cam;
    const side = e.position ? Math.sign((e.position.x - this.position.x) * Math.cos(this.yaw) - (e.position.z - this.position.z) * Math.sin(this.yaw)) || 1 : 1;
    c.r.v += side * 0.22 * k;
    c.w.v -= side * 0.12 * k;
    c.p.v += 0.08 * k;
    this.trauma = Math.min(1, this.trauma + 0.035 * k);
  }

  /* ------------------------------------------------------------ Match */

  /** Vor jedem Match: Team, Name, Statistik, Waffen (WeaponController aus G.weapons). */
  resetForMatch({ team = 'A', loadout, name } = {}) {
    this.team = team;
    this.name = name || (this.G.settings && this.G.settings.get('playerName')) || 'Operator';
    this.stats = blankStats();
    this.weaponStats = {};
    this.alive = false;
    this.health = this.maxHealth;
    this.diedAt = null;
    this.respawnAt = null;
    this.killer = null;
    this._lastKilledBy = null;
    this._damageLog = [];
    this.godMode = !!this.godMode;
    if (this.weapon && typeof this.weapon.dispose === 'function') this.weapon.dispose();
    this.weapon = null;
    this.loadout = loadout ? { ...loadout } : null;
    if (this.G.weapons && loadout) this.weapon = this.G.weapons.createController(this, this.loadout);
    this._updateBaseFov();
  }

  endMatch() {
    if (this.weapon && typeof this.weapon.dispose === 'function') this.weapon.dispose();
    this.weapon = null;
    this.alive = false;
    this.sprinting = this.sliding = this.crouching = false;
    this._resetStance();
    this.armor = null;
    this.plating = false;
    this._deathCam = null;
    this._endMantle(false);
    this._resetPose();
    if (this.G.viewmodel) this.G.viewmodel.scene.visible = true;
  }

  respawn(spawn) {
    const pos = spawn && spawn.position ? spawn.position : new THREE.Vector3();
    this.body.setHeight(STAND_H);
    this.body.teleport(pos);
    this.yaw = spawn && Number.isFinite(spawn.yaw) ? spawn.yaw : 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.crouching = this.sliding = this.sprinting = false;
    this._sprintLatch = false;
    this._resetStance();
    this.plating = false;
    this.boostUntil = 0;
    this._boostMult = 1;
    this._heal = 0;
    this._busyUntil = 0;
    this._repairing = false;
    this.repairTarget = this.spotTarget = null;
    this.applyClass();
    this._eye = STAND_EYE;
    this._stepSmooth = this._landDip = this._landVel = this._landSlow = this._stairSlow = 0;
    this.recoilPitch = this.recoilYaw = this._recoilTP = this._recoilTY = 0;
    this._kick = this._kickVel = this._flinchP = this._flinchY = 0;
    this.trauma = 0;
    this.exertion = 0;
    this._deathCam = null;
    this._regenning = false;
    this.killer = null;
    this.lastDamageTime = -1e9;
    this.spawnTime = this.G.time ? this.G.time.elapsed : 0;
    this.respawnAt = null;
    this._mantle = null;
    this.mantling = false;
    this._resetPose();
    if (this.weapon && typeof this.weapon.refill === 'function') this.weapon.refill();
    if (this.G.viewmodel) this.G.viewmodel.scene.visible = true;
    const input = this.G.input;
    if (input) {
      input.cancelAds();
      if (input.setActive) { input.setActive('lean_left', false); input.setActive('lean_right', false); }
    }
    this._updateCamera(0);
  }

  /** Haltung auf Stehen zurücksetzen (Spawn, Matchende). */
  _resetStance() {
    this.prone = false;
    this.stance = this.stanceFrom = 'stand';
    this.stanceT = 1;
    this.proneBlend = 0;
    this.crawling = false;
    this._crouchHeld = 0;
    this._proneHoldUsed = false;
    this._dive = false;
  }

  /** Lehnen, freies Zielen und Kamerafedern zurücksetzen. */
  _resetPose() {
    this.lean = this._leanVel = this._leanWant = 0;
    this._leanLimit = 1;
    this.leanOffset.set(0, 0, 0);
    this.leanRoll = 0;
    this.aimOffset.x = this.aimOffset.y = 0;
    for (const k of Object.keys(this._cam)) { this._cam[k].x = 0; this._cam[k].v = 0; }
    this._accF = this._accS = this._turn = 0;
    this._prevV.set(0, 0, 0);
    this._jumpBuffer = 0;
  }

  /* ------------------------------------------------------- Actor-API */

  getEyePosition(out = new THREE.Vector3()) {
    const p = this.body.position;
    const lo = this.leanOffset;
    return out.set(p.x + lo.x, p.y + this._eye + this._stepSmooth + lo.y, p.z + lo.z);
  }

  /** Laufrichtung (Schüsse): Sicht + Rückstoß + Zucken, dazu die Auslenkung des freien Zielens. */
  getAimDirection(out = new THREE.Vector3()) {
    const yaw = this.yaw + this.recoilYaw + this._flinchY;
    const pitch = clamp(this.pitch + this.recoilPitch + this._flinchP, -PITCH_LIMIT, PITCH_LIMIT);
    const ox = this.aimOffset.x, oy = this.aimOffset.y;
    if (!ox && !oy) {
      const c = Math.cos(pitch);
      return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
    }
    // Richtung im Sichtraum (x rechts, y oben, −z vorn), dann Nicken (X) und Gieren (Y) wie die Kamera (YXZ)
    const tx = Math.tan(ox), ty = Math.tan(oy);
    const n = 1 / Math.sqrt(tx * tx + ty * ty + 1);
    const lx = tx * n, ly = ty * n, lz = -n;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y1 = ly * cp - lz * sp;
    const z1 = ly * sp + lz * cp;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    return out.set(lx * cy + z1 * sy, y1, -lx * sy + z1 * cy);
  }

  /** Blickrichtung der Kamera (inkl. Kamerabewegung, ohne freies Zielen). */
  getViewDirection(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  /**
   * Laufpunkt auf dem Bildschirm (NDC −1…1, y oben): wohin die Waffe gerade zeigt – für das Fadenkreuz beim freien
   * Zielen bzw. mit Kamerabewegung und Lehnen. out = { x, y } (wird zurückgegeben).
   */
  getAimScreenPoint(out = { x: 0, y: 0 }) {
    this.getEyePosition(_o);
    this.getAimDirection(_dir);
    _v.copy(_o).addScaledVector(_dir, 30).project(this.camera);
    out.x = Number.isFinite(_v.x) ? clamp(_v.x, -1.5, 1.5) : 0;
    out.y = Number.isFinite(_v.y) ? clamp(_v.y, -1.5, 1.5) : 0;
    return out;
  }

  raycastHitboxes(ray, maxDist) {
    return raycastHumanoid(this, ray, maxDist);
  }

  /**
   * Rückstoß: pitch > 0 = nach oben, yaw > 0 = nach rechts (Radiant). recovery = Rückführrate (1/s).
   * 70 % werden federnd zurückgeführt, 30 % verbleiben (Dauerfeuer wandert).
   */
  addRecoil(pitch = 0, yaw = 0, recovery) {
    // Liegend (Zweibein-artig auf dem Boden abgestützt): 40 % weniger Rückstoß
    const steady = 1 - 0.4 * this.proneBlend;
    pitch *= steady;
    yaw *= steady;
    this.pitch = clamp(this.pitch + pitch * RECOIL_KEEP, -PITCH_LIMIT, PITCH_LIMIT);
    this.yaw -= yaw * RECOIL_KEEP;
    this._recoilTP += pitch * (1 - RECOIL_KEEP);
    this._recoilTY -= yaw * (1 - RECOIL_KEEP);
    if (Number.isFinite(recovery) && recovery > 0) this._recoilRate = recovery;
    this._lastRecoilAt = this._time;
    this._kickVel += pitch * 14; // sichtbarer Kameraschlag (zusätzlich, ohne Zielwirkung)
    // Körperkamera: der Rumpf nimmt einen Teil des Stoßes auf (kurzes Zurückfedern und Rollen)
    this._cam.z.v += 0.06 + pitch * 4;
    this._cam.r.v += (Math.random() - 0.5) * pitch * 6;
  }

  /** Kamerawackeln (Trauma-Modell): intensity 0..1 wird addiert und klingt ab. */
  shake(intensity = 0.3) {
    this.trauma = Math.min(1, this.trauma + Math.max(0, intensity));
  }

  onDamaged(info) {
    const f = Math.min(1, (info.amount || 0) / 60);
    this._flinchP += (0.012 + 0.03 * f) * (Math.random() < 0.8 ? 1 : -1);
    this._flinchY += (Math.random() - 0.5) * 0.035 * (0.4 + f);
    this.shake(0.1 + 0.22 * f + (info.explosive ? 0.35 : 0));
    // Körperkamera: Stoß aus der Trefferrichtung (Rollen zur abgewandten Seite, kurzes Nicken)
    const c = this._cam;
    let side = Math.random() < 0.5 ? -1 : 1;
    if (info.dir) {
      _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      side = Math.sign(info.dir.x * _right.x + info.dir.z * _right.z) || side;
    }
    c.r.v += -side * (0.35 + 0.9 * f);
    c.p.v += 0.25 + 0.6 * f;
    c.x.v += side * (0.12 + 0.3 * f);
    c.y.v -= 0.1 + 0.25 * f;
  }

  onDeath(info) {
    this.alive = false;
    this.killer = info && info.killer ? info.killer : null;
    this.sprinting = this.sliding = false;
    this.plating = false;
    this.crawling = false;
    this._heal = 0;
    this.repairTarget = null;
    this._sprintLatch = false;
    this._endMantle(false);
    this._deathCam = {
      t: 0, eye: this._eye + this._stepSmooth, roll: (Math.random() < 0.5 ? -1 : 1) * (0.22 + Math.random() * 0.15),
      killer: this.killer,
    };
    if (this.G.viewmodel) this.G.viewmodel.scene.visible = false;
    const input = this.G.input;
    if (input) {
      input.cancelAds();
      if (input.setActive) { input.setActive('lean_left', false); input.setActive('lean_right', false); }
    }
    this.shake(0.35);
  }

  /* ----------------------------------------------------------- Update */

  update(dt) {
    const G = this.G;
    this._time += dt;
    this._updateMotionSetting();
    if (!this.alive) {
      this._updateDead(dt);
      this._updateCamera(dt);
      return;
    }
    const input = G.input;
    const world = G.world;
    const body = this.body;
    const frozen = !G.match || G.match.state !== 'playing';
    const now = G.time.elapsed;
    const w = this.weapon;
    const def = w ? w.currentDef : null;
    const touch = input.mode === 'touch';

    // Blick (auch im Countdown) – beim freien Zielen bewegt sich zuerst die Waffe, die Sicht folgt am Rand der Totzone
    this._applyLook(input.look.dx, input.look.dy, dt, touch, w);

    const mx = frozen || this.mantling ? 0 : input.move.x;
    const my = frozen || this.mantling ? 0 : input.move.y;
    const moveMag = Math.min(1, Math.hypot(mx, my));
    let adsHeld = !frozen && !this.mantling && input.active('ads');
    const fireHeld = !frozen && (input.down('fire') || input.pressed('fire'));
    const v = body.velocity;
    const hSpeed = Math.hypot(v.x, v.z);
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Überklettern läuft kinematisch: keine Physik, kein Feuern, Waffe gesenkt
    if (this.mantling) {
      this._updateMantle(dt);
      this._updateCommon(dt, now, frozen, input, w, 0, adsHeld);
      return;
    }

    // Ducken / Rutschen (Halten oder Umschalten; Touch: Antippen)
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    const crouchHold = input.behavior('crouch') === 'hold';
    if (!frozen && input.pressed('crouch')) {
      if (this.sprinting && body.onGround && this.slideCooldown <= 0 && hSpeed > 5) this._startSlide();
      else if (this.sliding) this._endSlide();
      else if (crouchHold) this.crouching = true;
      else if (this.crouching) { if (body.canStand(world)) this.crouching = false; }
      else this.crouching = true;
    }
    if (crouchHold && !frozen && !this.sliding && this.crouching && !input.down('crouch') && body.canStand(world)) this.crouching = false;

    // Sprung bzw. Überklettern (Leertaste vor einem Hindernis von 0,5–1,3 m; im Sprung kurz gepuffert)
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    if (!frozen && input.pressed('jump')) this._jumpBuffer = 0.3;
    if (!frozen && this._jumpBuffer > 0 && this._tryMantle(world, mx, my)) {
      this._jumpBuffer = 0;
      this._updateCommon(dt, now, frozen, input, w, 0, false);
      return;
    }
    if (!frozen && input.pressed('jump') && body.onGround) {
      this._jumpBuffer = 0;
      if (this.crouching && !this.sliding) {
        if (body.canStand(world)) this.crouching = false; // aus der Hocke: erst aufstehen
      } else if (body.canStand(world, Math.max(body.height, CROUCH_H + 0.2))) {
        if (this.sliding) this._endSlide(true);
        v.y = JUMP_V;
        body.onGround = false;
        this.exertion = Math.min(1, this.exertion + 0.04);
        G.events.emit('player:jump', { velocity: v.y });
      }
    }

    // Sprint: „Umschalten“ = einmal auslösen, hält solange vorwärts gelaufen wird; „Halten“ = nur bei gedrückter Taste
    const sprintHold = input.behavior('sprint') === 'hold';
    const lockEdge = touch && input.sprintLock && !this._prevSprintLock;
    this._prevSprintLock = !!input.sprintLock;
    // Ein bewusster Sprint (Taste/Sperre) beendet eingerastetes Zielen (gehaltenes Zielen blockiert den Sprint)
    if (!frozen && adsHeld && my > 0.35 && ((!touch && input.pressed('sprint') && input.behavior('ads') === 'toggle') || lockEdge)) {
      input.cancelAds();
      adsHeld = false;
    }
    if (sprintHold) this._sprintLatch = !frozen && input.down('sprint') && my > 0.35;
    else {
      if (!frozen && input.pressed('sprint')) this._sprintLatch = true;
      if (!frozen && input.down('sprint') && my > 0.35) this._sprintLatch = true;
    }
    const blockSprint = frozen || my < 0.35 || adsHeld || fireHeld || this.sliding || (w && w.canSprint === false);
    if (blockSprint) this._sprintLatch = false;
    let sprint = this._sprintLatch && (body.onGround || this.sprinting);
    if (sprint && this.crouching) {
      if (body.canStand(world)) this.crouching = false; else sprint = false;
    }
    if (sprint && !this.sprinting && input.adsToggled) input.cancelAds();
    this.sprinting = sprint;

    // Zielgeschwindigkeit
    const ads = w ? w.adsProgress || 0 : 0;
    const wMult = def && def.moveSpeedMult ? def.moveSpeedMult : 1;
    const speedMult = wMult * (1 + ((def && def.adsMoveMult ? def.adsMoveMult : 0.6) - 1) * ads);
    const base = this.crouching ? SPEED_CROUCH : this.sprinting ? SPEED_SPRINT : SPEED_WALK;
    _wish.set(0, 0, 0).addScaledVector(_fwd, my).addScaledVector(_right, mx);
    if (_wish.lengthSq() > 1) _wish.normalize();
    // Richtungsabhängiges Tempo (COD): vorwärts 100 %, seitwärts 90 %, rückwärts 75 % – Rückzug ist
    // langsamer als Angriff. Sprint (nur vorwärts) und Rutschen bleiben unberührt.
    let dirMult = 1;
    if (!this.sprinting && moveMag > 0.01) {
      const f = my / Math.hypot(mx, my); // −1 (rückwärts) … 1 (vorwärts)
      dirMult = f >= 0 ? 0.9 + 0.1 * f : 0.9 + 0.15 * f;
    }
    // Gelände: bergauf langsamer (bis −30 %), bergab etwas schneller; nach Stufen und harten Landungen kurz gebremst
    let terrain = 1;
    if (body.onGround && _wish.lengthSq() > 0.01 && body.groundNormal.y < 0.995 && body.groundNormal.y > 0.3) {
      const n = body.groundNormal;
      const wl = Math.hypot(_wish.x, _wish.z);
      const grade = -(n.x * _wish.x + n.z * _wish.z) / wl / n.y; // Steigung in Laufrichtung (m/m)
      terrain = grade > 0 ? 1 - Math.min(0.3, grade * 0.32) : 1 + Math.min(0.06, -grade * 0.08);
    }
    terrain *= (1 - this._landSlow) * (1 - this._stairSlow);
    _wish.multiplyScalar(base * speedMult * dirMult * terrain);

    if (this.sliding) {
      this.slideTime += dt;
      // leicht lenkbar, Tempo nimmt ab
      const steer = mx * 0.9 * dt;
      if (steer) this.slideDir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -steer).normalize();
      const cur = Math.hypot(v.x, v.z); // nach _startSlide() bereits mit Schub
      const sp = Math.max(0, cur * Math.exp(-SLIDE_FRICTION * dt) - 0.6 * dt);
      v.x = this.slideDir.x * sp;
      v.z = this.slideDir.z * sp;
      if (this.slideTime > SLIDE_TIME || sp < 3.4 || (!body.onGround && this.slideTime > 0.15)) this._endSlide();
    } else if (body.onGround) {
      // Gewicht: Sprint baut Schwung langsam auf und ab, Umkehren bremst kräftig, schwere Waffen etwas träger
      const wishSq = _wish.lengthSq();
      let k;
      if (wishSq < 0.01) k = this.sprinting || hSpeed > SPEED_WALK + 0.5 ? BRAKE_SPRINT : BRAKE_WALK;
      else if ((_wish.x * v.x + _wish.z * v.z) < -0.2 * Math.sqrt(wishSq) * hSpeed) k = BRAKE_REVERSE;
      else k = this.sprinting ? ACCEL_SPRINT : this.crouching ? ACCEL_CROUCH : ACCEL_WALK;
      k *= 0.82 + 0.18 * clamp((wMult - 0.82) / 0.18, 0, 1);
      const a = damp(k, dt);
      v.x += (_wish.x - v.x) * a;
      v.z += (_wish.z - v.z) * a;
    } else {
      // Luftsteuerung: Richtung korrigierbar, Schwung bleibt erhalten
      if (_wish.lengthSq() < 0.01) {
        const drag = Math.exp(-0.3 * dt);
        v.x *= drag;
        v.z *= drag;
      } else {
        const a = damp(AIR_ACCEL, dt);
        let nx = v.x + (_wish.x - v.x) * a;
        let nz = v.z + (_wish.z - v.z) * a;
        const after = Math.hypot(nx, nz);
        if (after < hSpeed && after > 1e-4) { nx *= hSpeed / after; nz *= hSpeed / after; }
        v.x = nx;
        v.z = nz;
      }
    }

    // Kapselhöhe (Aufstehen nur mit Kopffreiheit)
    const targetH = this.sliding ? SLIDE_H : this.crouching ? CROUCH_H : STAND_H;
    if (targetH > body.height + 1e-3) {
      const next = Math.min(targetH, body.height + (targetH - body.height) * damp(16, dt) + 0.01);
      if (body.canStand(world, next)) body.setHeight(next);
      else if (!this.sliding) this.crouching = true;
    } else if (targetH < body.height - 1e-3) {
      body.setHeight(body.height + (targetH - body.height) * damp(18, dt));
    }

    // Physik
    const wasGround = body.onGround;
    const vyBefore = v.y;
    body.step(dt, world, { gravity: GRAVITY, stepHeight: 0.45 });
    this._stepSmooth -= body.stepOffset;
    this._stepSmooth = clamp(this._stepSmooth, -0.5, 0.5);
    // Stufe hinauf: kurzer Tempoverlust und ein kleiner Stoß in der Körperkamera (Treppen fühlen sich nach Treppen an)
    if (wasGround && body.onGround && body.stepOffset > 0.06) {
      this._stairSlow = Math.min(0.12, this._stairSlow + body.stepOffset * 0.35);
      this._cam.y.v -= Math.min(0.35, body.stepOffset * 1.4);
      this._cam.p.v -= Math.min(0.12, body.stepOffset * 0.5);
    }
    if (!wasGround && body.onGround && vyBefore < -2.5) {
      this._landVel -= clamp(-vyBefore * 0.02, 0.04, 0.3);
      if (vyBefore < -9) this.shake(clamp((-vyBefore - 9) * 0.04, 0, 0.35));
      // Körperkamera: Stauchung, Nicken nach vorn, kurzes Rollen; harte Landungen bremsen kurz
      const k = clamp((-vyBefore - 2.5) / 10, 0, 1);
      this._cam.p.v -= 0.15 + 0.85 * k;
      this._cam.r.v += (Math.random() - 0.5) * (0.2 + 0.6 * k);
      this._cam.y.v -= 0.2 + 0.6 * k;
      if (vyBefore < -7) this._landSlow = Math.max(this._landSlow, clamp((-vyBefore - 7) * 0.07, 0, 0.45));
      G.events.emit('player:land', { velocity: vyBefore });
      // Fallschaden ab ≈ 4 m Fallhöhe
      if (-vyBefore > FALL_SAFE && G.combat && !frozen) {
        G.combat.damage(this, { amount: (-vyBefore - FALL_SAFE) * 9, attacker: null, weaponId: 'fall', zone: 'body', dir: new THREE.Vector3(0, -1, 0) });
        if (!this.alive) return;
      }
    }
    if (body.outOfWorld && G.combat) {
      G.combat.damage(this, { amount: 9999, attacker: null, weaponId: 'world' });
      return;
    }
    if (world && world.bounds) this._clampToBounds(world.bounds);

    // Schritte → Geräusch + Fersenaufsatz in der Körperkamera
    const hs = Math.hypot(v.x, v.z);
    if (body.onGround && !this.sliding && hs > 0.6) {
      const stride = this.sprinting ? 2.7 : this.crouching ? 1.5 : 2.1;
      this._bobPhase += ((hs * dt) / stride) * Math.PI;
      this._stepDist += hs * dt;
      if (this._stepDist >= stride) {
        this._stepDist -= stride;
        this._footImpulse(hs);
        const surface = world && world.surfaceAt ? world.surfaceAt(body.position) : 'concrete';
        G.events.emit('footstep', { actor: this, surface, sprint: this.sprinting, crouch: this.crouching, position: body.position.clone() });
      }
    }

    this._updateCommon(dt, now, frozen, input, w, hs, adsHeld);
  }

  /** Gemeinsamer Rest jedes Bildes: Lehnen, Anstrengung, Regeneration, Waffe, Kamera. */
  _updateCommon(dt, now, frozen, input, w, hs, adsHeld) {
    const G = this.G;
    const body = this.body;
    this._landSlow = Math.max(0, this._landSlow - dt * 1.6);
    this._stairSlow = Math.max(0, this._stairSlow - dt * 3);
    // Anstrengung: Sprint baut auf (≈ 8 s bis voll), Ruhe baut ab
    if (this.sprinting) this.exertion = Math.min(1, this.exertion + dt / 8);
    else this.exertion = Math.max(0, this.exertion - dt * (hs > 0.6 ? 0.06 : 0.11));

    this._updateLean(dt, frozen, input);

    // Regeneration (COD)
    if (this.health < this.maxHealth && now - this.lastDamageTime > REGEN_DELAY) {
      if (!this._regenning) { this._regenning = true; G.events.emit('player:regen', { health: this.health, phase: 'start' }); }
      this.health = Math.min(this.maxHealth, this.health + REGEN_RATE * dt);
      if (this.health >= this.maxHealth) { this._regenning = false; G.events.emit('player:regen', { health: this.health, phase: 'end' }); }
    } else if (this._regenning && now - this.lastDamageTime <= REGEN_DELAY) {
      this._regenning = false;
    }

    // Waffe
    if (w) {
      const it = this._intent;
      const blocked = frozen || this.mantling;
      it.fire = !blocked && input.down('fire');
      it.firePressed = !blocked && input.pressed('fire');
      it.ads = adsHeld && !this.sprinting && !this.mantling;
      it.reload = !frozen && input.pressed('reload');
      it.swap = !blocked && input.pressed('swap');
      it.slot = blocked ? null : input.pressed('slot1') ? 1 : input.pressed('slot2') ? 2 : null;
      it.grenade = !blocked && input.pressed('grenade');
      it.grenadeHeld = !blocked && input.down('grenade');
      it.tactical = !blocked && input.pressed('tactical');
      it.tacticalHeld = !blocked && input.down('tactical');
      it.light = !frozen && input.pressed('light');
      it.interact = !frozen && input.pressed('interact');
      it.melee = !blocked && input.pressed('melee');
      it.sprinting = this.sprinting;
      it.moving = this.mantling || hs > 0.5;
      it.airborne = !body.onGround && !this.mantling;
      it.onGround = body.onGround || this.mantling;
      it.crouching = this.crouching || this.sliding;
      it.sliding = this.sliding;
      it.speed = this.mantling ? 2.5 : hs;
      it.lookDX = input.look.dx;
      it.lookDY = input.look.dy;
      it.frozen = frozen;
      it.leaning = this.lean;
      it.mantling = this.mantling;
      it.aimOffsetX = this.aimOffset.x;
      it.aimOffsetY = this.aimOffset.y;
      it.exertion = this.exertion;
      w.update(dt, it);
    }

    this._updateCamera(dt);
  }

  /* ------------------------------------------------------ Blick / freies Zielen */

  _applyLook(dx, dy, dt, touch, w) {
    const s = this.G.settings;
    const mode = s ? s.get('freeAim') : 'off';
    let R = touch ? 0 : FREE_AIM[mode] || 0;
    const ads = w ? clamp(w.adsProgress || 0, 0, 1) : 0;
    R *= 1 - ease(ads); // beim Anlegen schrumpft die Totzone, die Sicht holt die Waffe ein
    const o = this.aimOffset;
    if (R <= 1e-5) {
      // ohne Totzone: Auslenkung in die Sicht übernehmen (Laufrichtung bleibt, Sicht dreht nach)
      this.yaw = wrap(this.yaw - dx - o.x);
      this.pitch = clamp(this.pitch - dy + o.y, -PITCH_LIMIT, PITCH_LIMIT);
      o.x = o.y = 0;
      this.freeAimRadius = 0;
      return;
    }
    o.x += dx;
    o.y -= dy;
    // Sprint/Rutschen/Klettern: Waffe pendelt zur Mitte zurück
    if (this.sprinting || this.sliding || this.mantling) { const k = Math.exp(-6 * dt); o.x *= k; o.y *= k; }
    const m = Math.hypot(o.x, o.y);
    if (m > R) {
      const ex = o.x * (1 - R / m), ey = o.y * (1 - R / m);
      o.x -= ex;
      o.y -= ey;
      this.yaw = wrap(this.yaw - ex);
      const np = clamp(this.pitch + ey, -PITCH_LIMIT, PITCH_LIMIT);
      o.y += ey - (np - this.pitch); // am Nick-Anschlag bleibt der Rest in der Auslenkung
      this.pitch = np;
      o.y = clamp(o.y, -R, R);
    }
    this.freeAimRadius = R;
  }

  /* ------------------------------------------------------------- Lehnen */

  _updateLean(dt, frozen, input) {
    const G = this.G;
    let want = 0;
    if (!frozen && this.alive && input.active) {
      if (input.pressed('lean_left')) this._leanLast = -1;
      if (input.pressed('lean_right')) this._leanLast = 1;
      const L = input.active('lean_left'), R = input.active('lean_right');
      want = L && R ? this._leanLast : L ? -1 : R ? 1 : 0;
    }
    // Sprint, Rutschen und Klettern beenden das Lehnen (eingerastetes Lehnen wird gelöst)
    if (want && (this.sprinting || this.sliding || this.mantling)) {
      want = 0;
      if (input.setActive) { input.setActive('lean_left', false); input.setActive('lean_right', false); }
    }
    if (Math.sign(want) !== Math.sign(this._leanWant)) G.events.emit('player:lean', { dir: Math.sign(want) });
    this._leanWant = want;

    // Kollision: Kopf und Schulter dürfen nicht in die Wand – Strahlen zur Seite begrenzen die Auslenkung
    const side = this.crouching ? LEAN_SIDE_CROUCH : LEAN_SIDE;
    let limit = 1;
    const dir = want || Math.sign(this.lean);
    if (dir && G.world && Math.abs(want || this.lean) > 0.01) {
      const p = this.body.position;
      _dir.set(Math.cos(this.yaw) * dir, 0, -Math.sin(this.yaw) * dir);
      let free = side;
      for (const h of [this._eye - 0.02, this._eye - 0.32]) {
        _o.set(p.x, p.y + h, p.z);
        const r = collisionRay(G.world, _o, _dir, side + HEAD_R, _hit);
        if (r) free = Math.min(free, Math.max(0, r.distance - HEAD_R));
      }
      limit = clamp(free / side, 0, 1);
    }
    this._leanLimit += (limit - this._leanLimit) * damp(limit < this._leanLimit ? 40 : 10, dt);
    const target = want * Math.min(this._leanLimit, limit < this._leanLimit ? limit : 1);
    if (dt > 0) {
      const sp = critSpring(this.lean - target, this._leanVel, LEAN_OMEGA, dt);
      this.lean = target + sp.x;
      this._leanVel = sp.v;
    }
    // harte Grenze (Wand schneller als die Feder)
    if (dir) this.lean = dir > 0 ? Math.min(this.lean, Math.max(0, limit)) : Math.max(this.lean, -Math.max(0, limit));
    if (Math.abs(this.lean) < 1e-4 && !want) { this.lean = 0; this._leanVel = 0; }

    const l = this.lean;
    this.leanOffset.set(Math.cos(this.yaw) * side * l, -LEAN_DROP * Math.abs(l), -Math.sin(this.yaw) * side * l);
    this.leanRoll = -l * LEAN_ANGLE;
  }

  /* -------------------------------------------------------- Überklettern */

  _tryMantle(world, mx, my) {
    const body = this.body;
    if (!world || this.sliding || this.mantling) return false;
    // Richtung: Laufwunsch, sonst Blickrichtung (nur wenn vorwärts gedrückt oder in der Luft auf ein Hindernis zu)
    let dx = _fwd.x * my + _right.x * mx;
    let dz = _fwd.z * my + _right.z * mx;
    const l = Math.hypot(dx, dz);
    if (l < 0.3) {
      if (body.onGround) return false;
      dx = _fwd.x; dz = _fwd.z;
    } else { dx /= l; dz /= l; }
    // nur Richtungen grob nach vorn (Seitwärts-Klettern sieht falsch aus)
    if (dx * _fwd.x + dz * _fwd.z < 0.35) return false;
    const ledge = probeLedge(world, body, dx, dz, { crouchH: CROUCH_H });
    if (!ledge) return false;
    if (!body.onGround && ledge.topY < body.position.y + 0.25) return false; // in der Luft schon fast oben: Physik fängt
    this._startMantle(ledge, dx, dz);
    return true;
  }

  _startMantle(ledge, dx, dz) {
    const body = this.body;
    const G = this.G;
    const h = ledge.height;
    const start = body.position.clone();
    const dur = ledge.vault ? 0.42 + 0.08 * h : 0.32 + 0.16 * h;
    this._mantle = { t: 0, dur, start, end: ledge.end.clone(), topY: ledge.topY, height: h, vault: ledge.vault, dx, dz, wall: ledge.wallDist };
    this.mantling = true;
    this.mantleProgress = 0;
    this.sprinting = false;
    this._sprintLatch = false;
    if (this.sliding) this._endSlide(true);
    body.velocity.set(0, 0, 0);
    body.setHeight(CROUCH_H);
    if (G.input) {
      G.input.cancelAds();
      if (G.input.setActive) { G.input.setActive('lean_left', false); G.input.setActive('lean_right', false); }
    }
    // Körperkamera: Ansatz (leichtes Absenken, Nicken nach unten)
    this._cam.p.v -= 0.5;
    this._cam.y.v -= 0.25;
    this.exertion = Math.min(1, this.exertion + 0.05);
    G.events.emit('player:mantle', { phase: 'start', height: Math.round(h * 100) / 100, vault: ledge.vault, position: start.clone() });
  }

  _updateMantle(dt) {
    const m = this._mantle;
    const body = this.body;
    if (!m) { this.mantling = false; return; }
    m.t += dt;
    const t = clamp(m.t / m.dur, 0, 1);
    this.mantleProgress = t;
    const s = m.start, e = m.end;
    // Phase 1 (0–55 %): hochstemmen bis über die Kante, kaum vorwärts; Phase 2: über die Kante nach vorn
    const lift = m.topY + (m.vault ? 0.22 : 0.1);
    const near = Math.max(0, m.wall - body.radius - 0.02);
    let x, y, z;
    if (t < 0.55) {
      const u = easeOut(t / 0.55);
      y = s.y + (lift - s.y) * u;
      const f = near * u * 0.8;
      x = s.x + m.dx * f;
      z = s.z + m.dz * f;
    } else {
      const u = ease((t - 0.55) / 0.45);
      const f0 = near * 0.8;
      const ax = s.x + m.dx * f0, az = s.z + m.dz * f0;
      x = ax + (e.x - ax) * u;
      z = az + (e.z - az) * u;
      y = lift + (e.y - lift) * u;
    }
    body.position.set(x, y, z);
    body.velocity.set(0, 0, 0);
    body.onGround = false;
    body._sync();
    if (t >= 1) this._endMantle(true);
  }

  _endMantle(completed) {
    const m = this._mantle;
    this._mantle = null;
    if (!this.mantling) return;
    this.mantling = false;
    this.mantleProgress = 0;
    const body = this.body;
    if (completed && m) {
      body.position.copy(m.end);
      if (m.vault) body.velocity.set(m.dx * 3.2, 0, m.dz * 3.2);
      else body.velocity.set(m.dx * 1.2, 0, m.dz * 1.2);
      body._sync();
      // Stehen, falls Platz (sonst geduckt bleiben)
      this.crouching = !body.canStand(this.G.world);
      this._cam.y.v -= 0.3;
      this._cam.p.v += 0.2;
      this.G.events.emit('player:mantle', { phase: 'end', height: Math.round(m.height * 100) / 100, vault: m.vault, position: body.position.clone() });
      const world = this.G.world;
      const surface = world && world.surfaceAt ? world.surfaceAt(body.position) : 'concrete';
      this.G.events.emit('footstep', { actor: this, surface, sprint: false, crouch: this.crouching, position: body.position.clone() });
    }
  }

  /* --------------------------------------------------------------- Rutschen */

  _startSlide() {
    const v = this.body.velocity;
    const hs = Math.hypot(v.x, v.z) || 1;
    this.slideDir.set(v.x / hs, 0, v.z / hs);
    const sp = Math.max(hs, SPEED_SPRINT * 0.95) + SLIDE_BOOST;
    v.x = this.slideDir.x * sp;
    v.z = this.slideDir.z * sp;
    this.sliding = true;
    this.slideTime = 0;
    this.sprinting = false;
    this._sprintLatch = false;
    this.crouching = true;
    this._landVel -= 0.05;
    this._cam.r.v += 0.25;
    this.G.events.emit('player:slide', { velocity: sp, phase: 'start', position: this.body.position.clone() });
  }

  _endSlide(jumped = false) {
    if (!this.sliding) return;
    this.sliding = false;
    this.slideCooldown = 0.55;
    const input = this.G.input;
    // Halten-Modus: nach dem Rutschen nur geduckt bleiben, solange Ducken gehalten wird
    this.crouching = !jumped && (!input || input.behavior('crouch') !== 'hold' || input.down('crouch') || !this.body.canStand(this.G.world));
    this.G.events.emit('player:slide', { velocity: Math.hypot(this.body.velocity.x, this.body.velocity.z), phase: 'end' });
  }

  _clampToBounds(b) {
    const p = this.body.position;
    const v = this.body.velocity;
    const r = this.body.radius;
    if (p.x < b.min.x + r) { p.x = b.min.x + r; if (v.x < 0) v.x = 0; }
    if (p.x > b.max.x - r) { p.x = b.max.x - r; if (v.x > 0) v.x = 0; }
    if (p.z < b.min.z + r) { p.z = b.min.z + r; if (v.z < 0) v.z = 0; }
    if (p.z > b.max.z - r) { p.z = b.max.z - r; if (v.z > 0) v.z = 0; }
    this.body._sync();
  }

  _updateDead(dt) {
    const G = this.G;
    const body = this.body;
    const dc = this._deathCam;
    // Körper fällt/rutscht aus
    body.velocity.x *= Math.exp(-6 * dt);
    body.velocity.z *= Math.exp(-6 * dt);
    if (G.world) body.step(dt, G.world, { gravity: GRAVITY });
    // Lehnen und freies Zielen klingen aus
    const k = Math.exp(-8 * dt);
    this.lean *= k;
    this.leanOffset.multiplyScalar(k);
    this.leanRoll *= k;
    this.aimOffset.x *= k;
    this.aimOffset.y *= k;
    if (!dc) return;
    dc.t += dt;
    const kl = dc.killer;
    if (kl && kl.position && dc.t > 0.25) {
      const target = kl.getEyePosition ? kl.getEyePosition(_v) : _v.copy(kl.position).setY(kl.position.y + 1.6);
      this.getEyePosition(_eye);
      const dx = target.x - _eye.x;
      const dy = target.y - _eye.y;
      const dz = target.z - _eye.z;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      const a = damp(3.2, dt);
      this.yaw = wrap(this.yaw + wrap(wantYaw - this.yaw) * a);
      this.pitch += (clamp(wantPitch, -1.2, 1.2) - this.pitch) * a;
    }
  }

  /* ----------------------------------------------------------- Kamera */

  _updateBaseFov() {
    const s = this.G.settings;
    this.baseFov = hfovToVfov(s ? s.get('fov') : 80);
  }

  /** Komfortregler: cameraMotion (Touch × ⅔), „Bewegung reduzieren“ (Einstellung oder System) ≤ 0,15. */
  _updateMotionSetting() {
    const s = this.G.settings;
    let m = s ? s.get('cameraMotion') : 0.6;
    if (!Number.isFinite(m)) m = 0.6;
    if (this.G.input && this.G.input.mode === 'touch') m *= 2 / 3;
    const sysReduced = typeof matchMedia === 'function' && (this._rmq || (this._rmq = matchMedia('(prefers-reduced-motion: reduce)'))).matches;
    if ((s && s.get('reducedMotion')) || sysReduced) m = Math.min(m, 0.15);
    this.cameraMotion = clamp(m, 0, 1);
  }

  _adsFov(def) {
    if (!def) return this.baseFov;
    let zoom = def.adsZoom || (def.scope && def.scope.zoom) || 0;
    if (!zoom && def.adsFov) zoom = Math.tan((80 * Math.PI) / 360) / Math.tan((def.adsFov * Math.PI) / 360);
    return zoomFov(this.baseFov, zoom || 1.15);
  }

  /** Fersenaufsatz: Impulse in die Körperkamera-Federn (abwechselnd links/rechts). */
  _footImpulse(hs) {
    const c = this._cam;
    const side = (this._stepSide = -this._stepSide);
    const sp = clamp(hs / SPEED_WALK, 0.5, 1.4);
    const sprint = this.sprinting, crouch = this.crouching;
    const kY = sprint ? 1.4 : crouch ? 0.35 : 0.75;
    const kR = sprint ? 0.34 : crouch ? 0.08 : 0.2;
    const kP = sprint ? 0.26 : crouch ? 0.06 : 0.13;
    const kW = sprint ? 0.22 : crouch ? 0.03 : 0.06;
    const kX = sprint ? 0.7 : crouch ? 0.15 : 0.35;
    c.y.v -= kY * sp;
    c.r.v += side * kR * sp;
    c.p.v -= kP * sp;
    c.w.v += side * kW * sp;
    c.x.v += side * kX * sp;
  }

  _updateCamera(dt) {
    const G = this.G;
    const cam = this.camera;
    const M = this.cameraMotion;
    const reduced = M <= 0.15 + 1e-6 && G.settings && (G.settings.get('reducedMotion') || (this._rmq && this._rmq.matches));
    // Gameplay-Rückmeldungen (Rückstoß-Schlag, Landung, Wackeln) nie ganz aus; ab Standard 0,6 voll wie bisher
    const kM = 0.35 + 0.65 * clamp(M / 0.6, 0, 1);
    this._updateBaseFov();
    const w = this.weapon;
    const ads = w && this.alive ? ease(clamp(w.adsProgress || 0, 0, 1)) : 0;
    const body = this.body;
    const c = this._cam;

    // Federn/Abklingen
    if (dt > 0) {
      // Rückstoß: nach kurzer Pause exponentiell zurück, Anzeige folgt schnell
      if (this._time - this._lastRecoilAt > 0.09) {
        const r = Math.exp(-this._recoilRate * dt);
        this._recoilTP *= r;
        this._recoilTY *= r;
      }
      const s = damp(38, dt);
      this.recoilPitch += (this._recoilTP - this.recoilPitch) * s;
      this.recoilYaw += (this._recoilTY - this.recoilYaw) * s;
      // Kick-Feder (kritisch gedämpft, exakt)
      let sp = critSpring(this._kick, this._kickVel, KICK_OMEGA, dt);
      this._kick = sp.x;
      this._kickVel = sp.v;
      const fl = Math.exp(-9 * dt);
      this._flinchP *= fl;
      this._flinchY *= fl;
      this._stepSmooth *= Math.exp(-16 * dt);
      // Landeeinknicken (Feder, exakt)
      sp = critSpring(this._landDip, this._landVel, LAND_OMEGA, dt);
      this._landDip = sp.x;
      this._landVel = sp.v;
      this.trauma = Math.max(0, this.trauma - 1.5 * dt);
      // Körperkamera-Federn (unterkritisch, exakt)
      wobble(c.x, POS_OMEGA, POS_ZETA, dt);
      wobble(c.y, POS_OMEGA, POS_ZETA, dt);
      wobble(c.z, POS_OMEGA, POS_ZETA, dt);
      wobble(c.p, ROT_OMEGA, ROT_ZETA, dt);
      wobble(c.w, ROT_OMEGA, ROT_ZETA, dt);
      wobble(c.r, ROT_OMEGA, ROT_ZETA, dt);
      // Trägheit: Beschleunigung im Körper (vorwärts/seitwärts) und Drehrate, geglättet
      const v = body.velocity;
      const inv = 1 / dt;
      const ax = (v.x - this._prevV.x) * inv, az = (v.z - this._prevV.z) * inv;
      this._prevV.copy(v);
      const aF = this.alive && body.onGround && !this.mantling ? clamp(-(ax * Math.sin(this.yaw) + az * Math.cos(this.yaw)), -25, 25) : 0;
      const aS = this.alive && body.onGround && !this.mantling ? clamp(ax * Math.cos(this.yaw) - az * Math.sin(this.yaw), -25, 25) : 0;
      this._accF += (aF - this._accF) * damp(9, dt);
      this._accS += (aS - this._accS) * damp(9, dt);
      const input = G.input;
      const turn = this.alive && input ? clamp(-input.look.dx * inv, -12, 12) : 0;
      this._turn += (turn - this._turn) * damp(10, dt);
      // Atmung: 0,25 Hz in Ruhe, nach dem Sprint schneller und tiefer
      this._breathPh += Math.PI * 2 * (0.25 + 0.33 * this.exertion) * dt;
    }

    // Augenhöhe (beim Klettern geduckt)
    let eyeTarget = this.sliding ? SLIDE_EYE : this.crouching || this.mantling ? CROUCH_EYE : STAND_EYE;
    eyeTarget = Math.min(eyeTarget, this.body.height - 0.12);
    if (this.alive) this._eye += (eyeTarget - this._eye) * damp(14, dt);
    else if (this._deathCam) {
      const t = clamp(this._deathCam.t / 0.7, 0, 1);
      this._eye = this._deathCam.eye + (0.32 - this._deathCam.eye) * (1 - Math.pow(1 - t, 3));
    }

    // Körperkamera-Anteile (× Komfortregler, im Anschlag stark gedämpft)
    const hs = Math.hypot(body.velocity.x, body.velocity.z);
    const moving = clamp(hs / 3, 0, 1);
    const mm = M * (1 - 0.75 * ads) * (this.alive ? 1 : 0.3);
    this._sprintBlend += ((this.sprinting ? 1 : 0) - this._sprintBlend) * damp(6, dt);
    const ex = this.exertion;
    const bA = 0.0028 * (1 + 1.6 * ex) * (1 - 0.6 * moving);
    const breathY = Math.sin(this._breathPh) * bA;
    const breathP = Math.sin(this._breathPh - 0.7) * 0.0019 * (1 + 2 * ex) * (1 - 0.5 * moving);
    // seitliches Pendeln im Schrittzyklus (zwischen den Impulsen), beim Sprint kräftiger
    const gaitAmp = body.onGround && !this.sliding && this.alive ? clamp(hs / SPEED_WALK, 0, 1.5) : 0;
    const swayX = Math.cos(this._bobPhase) * gaitAmp * (0.006 + 0.01 * this._sprintBlend);
    const camX = (c.x.x + swayX) * mm;
    const camY = (c.y.x + breathY) * mm;
    const camZ = c.z.x * mm;
    const accP = clamp(-this._accF * 0.0011, -0.022, 0.022);
    const accR = clamp(-this._accS * 0.0009, -0.016, 0.016);
    const turnR = clamp(this._turn * 0.0025, -0.011, 0.011) * (0.4 + 0.6 * moving);
    const sprintP = -0.026 * this._sprintBlend;
    const mantleP = this.mantling ? -0.07 * Math.sin(Math.PI * this.mantleProgress) : 0;
    const camP = (c.p.x + breathP + accP + sprintP + mantleP) * mm;
    const camW = c.w.x * mm;
    const camR = (c.r.x + accR + turnR) * mm;

    // Neigung (Seitwärts, Rutschen) – wie bisher, × Komfort
    const input = G.input;
    const strafe = this.alive && input ? input.move.x : 0;
    this._slideBlend += ((this.sliding ? 1 : 0) - this._slideBlend) * damp(10, dt);
    const tiltTarget = (-strafe * 0.02 + this._slideBlend * 0.07) * kM;
    this._tilt += (tiltTarget - this._tilt) * damp(8, dt);

    // Shake
    const sh = this.trauma * this.trauma * kM;
    const t = this._time;
    const n1 = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.7 + 1.3) * 0.4;
    const n2 = Math.sin(t * 41.3 + 2.1) * 0.6 + Math.sin(t * 19.1 + 0.7) * 0.4;
    const n3 = Math.sin(t * 29.9 + 4.2) * 0.6 + Math.sin(t * 31.3 + 2.9) * 0.4;

    // Position: Füße + Auge + Stufenglättung + Landung + Lehnen + Körperkamera (in Blickrichtung gedreht)
    const p = this.body.position;
    const lo = this.leanOffset;
    const eye = this._eye + this._stepSmooth + this._landDip * kM + lo.y;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // lokale Achsen: rechts (cy, 0, −sy), vorn (−sy, 0, −cy)
    cam.position.set(
      p.x + lo.x + cy * camX - sy * -camZ + n1 * sh * 0.05,
      p.y + eye + camY + n2 * sh * 0.04,
      p.z + lo.z - sy * camX - cy * -camZ + n3 * sh * 0.05,
    );

    const leanRollK = 0.4 + 0.6 * clamp(M / 0.6, 0, 1);
    let roll = this._tilt + this.leanRoll * leanRollK + camR + n3 * sh * 0.06;
    if (!this.alive && this._deathCam) roll += this._deathCam.roll * clamp(this._deathCam.t / 0.6, 0, 1);
    const pitch = clamp(this.pitch + this.recoilPitch + this._flinchP + this._kick * kM + camP + n1 * sh * 0.035, -1.55, 1.55);
    const yaw = this.yaw + this.recoilYaw + this._flinchY + camW + n2 * sh * 0.035;
    cam.rotation.set(pitch, yaw, roll, 'YXZ');

    // FOV
    const zoomDef = w ? w.currentDef : null;
    const adsFov = this._adsFov(zoomDef);
    this.adsZoom = Math.tan((this.baseFov * Math.PI) / 360) / Math.tan((adsFov * Math.PI) / 360);
    const hipFov = this.baseFov + (this._sprintBlend * 3.5 + this._slideBlend * 6) * (reduced ? 0.3 : 1);
    const fov = hipFov + (adsFov - hipFov) * ads;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
