// NULLPUNKT — Ego-Spieler (Actor, §5): flüssige Bewegung mit Beschleunigung/Reibung/Luftsteuerung,
// Sprint (Latch), Ducken, COD-Mobile-Rutschen (Sprint + Ducken), Sprung, Kopfwippen, Neigung beim
// Seitwärtslaufen, Landeeinknicken, Sprint-FOV, ADS-FOV aus der Waffendefinition, Rückstoß mit
// Federrückführung (addRecoil), Kamerawackeln (shake), Treffer-Zucken, COD-Gesundheitsregeneration,
// Todeskamera (Kamera sinkt und dreht sich zum Schützen), Respawn, Schrittgeräusche je Oberfläche.
//
// Der Spieler besitzt die Kamera-FOV: fov = lerp(Basis + Sprint/Rutsch-Kick, ADS-FOV, adsProgress).
// settings.fov ist das COD-übliche horizontale 4:3-FOV; die Kamera nutzt das vertikale Äquivalent.

import * as THREE from 'three';
import { CapsuleBody } from './engine/physics.js';
import { raycastHumanoid } from './combat.js';

const STAND_H = 1.8;
const CROUCH_H = 1.15;
const SLIDE_H = 1.0;
const STAND_EYE = 1.65;
const CROUCH_EYE = 1.0;
const SLIDE_EYE = 0.82;
const SPEED_WALK = 5.4;
const SPEED_SPRINT = 8.2;
const SPEED_CROUCH = 2.6;
const GRAVITY = 24;
const JUMP_V = Math.sqrt(2 * GRAVITY * 1.1);
const ACCEL = 15;
const DECEL = 11;
const AIR_ACCEL = 2.4;
const SLIDE_TIME = 0.9;
const SLIDE_BOOST = 2.9;
const SLIDE_FRICTION = 1.25;
const REGEN_DELAY = 3.5;
const REGEN_RATE = 55;
const PITCH_LIMIT = 1.48;
const FALL_SAFE = 14; // m/s Aufprallgeschwindigkeit ohne Schaden (≈ 4 m)
const RECOIL_KEEP = 0.3; // Anteil des Rückstoßes, der nicht zurückgeführt wird (Spray wandert)

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _eye = new THREE.Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t) => t * t * (3 - 2 * t);

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

    // Bewegungszustand
    this.crouching = false;
    this.sliding = false;
    this.sprinting = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.slideDir = new THREE.Vector3();
    this._sprintLatch = false;
    this._eye = STAND_EYE;
    this._stepSmooth = 0;
    this._landDip = 0;
    this._landVel = 0;
    this._bobPhase = 0;
    this._bobAmp = 0;
    this._stepDist = 0;
    this._tilt = 0;
    this._sprintBlend = 0;
    this._slideBlend = 0;
    this._regenning = false;

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
    };
    this._updateBaseFov();
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
    this._deathCam = null;
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
    this._eye = STAND_EYE;
    this._stepSmooth = this._landDip = this._landVel = 0;
    this.recoilPitch = this.recoilYaw = this._recoilTP = this._recoilTY = 0;
    this._kick = this._kickVel = this._flinchP = this._flinchY = 0;
    this.trauma = 0;
    this._deathCam = null;
    this._regenning = false;
    this.killer = null;
    this.lastDamageTime = -1e9;
    this.spawnTime = this.G.time ? this.G.time.elapsed : 0;
    this.respawnAt = null;
    if (this.weapon && typeof this.weapon.refill === 'function') this.weapon.refill();
    if (this.G.viewmodel) this.G.viewmodel.scene.visible = true;
    if (this.G.input) this.G.input.cancelAds();
    this._updateCamera(0);
  }

  /* ------------------------------------------------------- Actor-API */

  getEyePosition(out = new THREE.Vector3()) {
    const p = this.body.position;
    return out.set(p.x, p.y + this._eye + this._stepSmooth, p.z);
  }

  getAimDirection(out = new THREE.Vector3()) {
    const yaw = this.yaw + this.recoilYaw + this._flinchY;
    const pitch = clamp(this.pitch + this.recoilPitch + this._flinchP, -PITCH_LIMIT, PITCH_LIMIT);
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  }

  raycastHitboxes(ray, maxDist) {
    return raycastHumanoid(this, ray, maxDist);
  }

  /**
   * Rückstoß: pitch > 0 = nach oben, yaw > 0 = nach rechts (Radiant). recovery = Rückführrate (1/s).
   * 70 % werden federnd zurückgeführt, 30 % verbleiben (Dauerfeuer wandert).
   */
  addRecoil(pitch = 0, yaw = 0, recovery) {
    this.pitch = clamp(this.pitch + pitch * RECOIL_KEEP, -PITCH_LIMIT, PITCH_LIMIT);
    this.yaw -= yaw * RECOIL_KEEP;
    this._recoilTP += pitch * (1 - RECOIL_KEEP);
    this._recoilTY -= yaw * (1 - RECOIL_KEEP);
    if (Number.isFinite(recovery) && recovery > 0) this._recoilRate = recovery;
    this._lastRecoilAt = this._time;
    this._kickVel += pitch * 14; // sichtbarer Kameraschlag (zusätzlich, ohne Zielwirkung)
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
  }

  onDeath(info) {
    this.alive = false;
    this.killer = info && info.killer ? info.killer : null;
    this.sprinting = this.sliding = false;
    this._sprintLatch = false;
    this._deathCam = {
      t: 0, eye: this._eye + this._stepSmooth, roll: (Math.random() < 0.5 ? -1 : 1) * (0.22 + Math.random() * 0.15),
      killer: this.killer,
    };
    if (this.G.viewmodel) this.G.viewmodel.scene.visible = false;
    if (this.G.input) this.G.input.cancelAds();
    this.shake(0.35);
  }

  /* ----------------------------------------------------------- Update */

  update(dt) {
    const G = this.G;
    this._time += dt;
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

    // Blick (auch im Countdown)
    this.yaw = wrap(this.yaw - input.look.dx);
    this.pitch = clamp(this.pitch - input.look.dy, -PITCH_LIMIT, PITCH_LIMIT);

    const mx = frozen ? 0 : input.move.x;
    const my = frozen ? 0 : input.move.y;
    const moveMag = Math.min(1, Math.hypot(mx, my));
    const adsHeld = !frozen && input.down('ads');
    const fireHeld = !frozen && (input.down('fire') || input.pressed('fire'));
    const v = body.velocity;
    const hSpeed = Math.hypot(v.x, v.z);

    // Ducken / Rutschen
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    if (!frozen && input.pressed('crouch')) {
      if (this.sprinting && body.onGround && this.slideCooldown <= 0 && hSpeed > 5) this._startSlide();
      else if (this.sliding) this._endSlide();
      else if (this.crouching) { if (body.canStand(world)) this.crouching = false; }
      else this.crouching = true;
    }

    // Sprung
    if (!frozen && input.pressed('jump') && body.onGround) {
      if (this.crouching && !this.sliding) {
        if (body.canStand(world)) this.crouching = false; // aus der Hocke: erst aufstehen
      } else if (body.canStand(world, Math.max(body.height, CROUCH_H + 0.2))) {
        if (this.sliding) this._endSlide(true);
        v.y = JUMP_V;
        body.onGround = false;
        G.events.emit('player:jump', { velocity: v.y });
      }
    }

    // Sprint (Latch: einmal ausgelöst, hält er, solange vorwärts gelaufen wird)
    if (!frozen && input.pressed('sprint')) this._sprintLatch = true;
    if (!frozen && input.down('sprint') && my > 0.35) this._sprintLatch = true;
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
    const speedMult = (def && def.moveSpeedMult ? def.moveSpeedMult : 1) * (1 + ((def && def.adsMoveMult ? def.adsMoveMult : 0.6) - 1) * ads);
    const base = this.crouching ? SPEED_CROUCH : this.sprinting ? SPEED_SPRINT : SPEED_WALK;
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _wish.set(0, 0, 0).addScaledVector(_fwd, my).addScaledVector(_right, mx);
    if (_wish.lengthSq() > 1) _wish.normalize();
    // Richtungsabhängiges Tempo (COD): vorwärts 100 %, seitwärts 90 %, rückwärts 75 % – Rückzug ist
    // langsamer als Angriff. Sprint (nur vorwärts) und Rutschen bleiben unberührt.
    let dirMult = 1;
    if (!this.sprinting && moveMag > 0.01) {
      const f = my / Math.hypot(mx, my); // −1 (rückwärts) … 1 (vorwärts)
      dirMult = f >= 0 ? 0.9 + 0.1 * f : 0.9 + 0.15 * f;
    }
    _wish.multiplyScalar(base * speedMult * dirMult);

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
      const k = _wish.lengthSq() > 0.01 && (_wish.x * v.x + _wish.z * v.z) >= 0 ? ACCEL : DECEL;
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
    let targetH = this.sliding ? SLIDE_H : this.crouching ? CROUCH_H : STAND_H;
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
    if (!wasGround && body.onGround && vyBefore < -2.5) {
      this._landVel -= clamp(-vyBefore * 0.02, 0.04, 0.3);
      if (vyBefore < -9) this.shake(clamp((-vyBefore - 9) * 0.04, 0, 0.35));
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

    // Schritte + Kopfwippen
    const hs = Math.hypot(v.x, v.z);
    if (body.onGround && !this.sliding && hs > 0.6) {
      const stride = this.sprinting ? 2.7 : this.crouching ? 1.5 : 2.1;
      this._bobPhase += ((hs * dt) / stride) * Math.PI;
      this._stepDist += hs * dt;
      if (this._stepDist >= stride) {
        this._stepDist -= stride;
        const surface = world && world.surfaceAt ? world.surfaceAt(body.position) : 'concrete';
        G.events.emit('footstep', { actor: this, surface, sprint: this.sprinting, crouch: this.crouching, position: body.position.clone() });
      }
    }
    const bobTarget = body.onGround && !this.sliding
      ? clamp(hs / SPEED_WALK, 0, 1.5) * (this.sprinting ? 0.05 : this.crouching ? 0.016 : 0.028) * (1 - 0.8 * ads)
      : 0;
    this._bobAmp += (bobTarget - this._bobAmp) * damp(8, dt);

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
      it.fire = !frozen && input.down('fire');
      it.firePressed = !frozen && input.pressed('fire');
      it.ads = adsHeld && !this.sprinting;
      it.reload = !frozen && input.pressed('reload');
      it.swap = !frozen && input.pressed('swap');
      it.slot = frozen ? null : input.pressed('slot1') ? 1 : input.pressed('slot2') ? 2 : null;
      it.grenade = !frozen && input.pressed('grenade');
      it.grenadeHeld = !frozen && input.down('grenade');
      it.melee = !frozen && input.pressed('melee');
      it.sprinting = this.sprinting;
      it.moving = hs > 0.5;
      it.airborne = !body.onGround;
      it.onGround = body.onGround;
      it.crouching = this.crouching || this.sliding;
      it.sliding = this.sliding;
      it.speed = hs;
      it.lookDX = input.look.dx;
      it.lookDY = input.look.dy;
      it.frozen = frozen;
      w.update(dt, it);
    }

    this._updateCamera(dt);
  }

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
    this.G.events.emit('player:slide', { velocity: sp, phase: 'start', position: this.body.position.clone() });
  }

  _endSlide(jumped = false) {
    if (!this.sliding) return;
    this.sliding = false;
    this.slideCooldown = 0.55;
    this.crouching = !jumped;
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
    if (!dc) return;
    dc.t += dt;
    const k = dc.killer;
    if (k && k.position && dc.t > 0.25) {
      const target = k.getEyePosition ? k.getEyePosition(_v) : _v.copy(k.position).setY(k.position.y + 1.6);
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

  _adsFov(def) {
    if (!def) return this.baseFov;
    let zoom = def.adsZoom || (def.scope && def.scope.zoom) || 0;
    if (!zoom && def.adsFov) zoom = Math.tan((80 * Math.PI) / 360) / Math.tan((def.adsFov * Math.PI) / 360);
    return zoomFov(this.baseFov, zoom || 1.15);
  }

  _updateCamera(dt) {
    const G = this.G;
    const cam = this.camera;
    const reduced = G.settings && G.settings.get('reducedMotion');
    const motion = reduced ? 0.35 : 1;
    this._updateBaseFov();

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
      // Kick-Feder (kritisch gedämpft)
      this._kickVel += (-this._kick * 220 - this._kickVel * 2 * Math.sqrt(220)) * dt;
      this._kick += this._kickVel * dt;
      const fl = Math.exp(-9 * dt);
      this._flinchP *= fl;
      this._flinchY *= fl;
      this._stepSmooth *= Math.exp(-16 * dt);
      // Landeeinknicken (Feder)
      this._landVel += (-this._landDip * 180 - this._landVel * 2 * Math.sqrt(180)) * dt;
      this._landDip += this._landVel * dt;
      this.trauma = Math.max(0, this.trauma - 1.5 * dt);
    }

    // Augenhöhe
    let eyeTarget = this.sliding ? SLIDE_EYE : this.crouching ? CROUCH_EYE : STAND_EYE;
    eyeTarget = Math.min(eyeTarget, this.body.height - 0.12);
    if (this.alive) this._eye += (eyeTarget - this._eye) * damp(14, dt);
    else if (this._deathCam) {
      const t = clamp(this._deathCam.t / 0.7, 0, 1);
      this._eye = this._deathCam.eye + (0.32 - this._deathCam.eye) * (1 - Math.pow(1 - t, 3));
    }

    // Kopfwippen
    const bobY = Math.abs(Math.sin(this._bobPhase)) * this._bobAmp * 1.2 * motion - this._bobAmp * 0.6 * motion;
    const bobX = Math.cos(this._bobPhase) * this._bobAmp * 0.6 * motion;

    // Neigung (Seitwärts, Rutschen)
    const input = G.input;
    const strafe = this.alive && input ? input.move.x : 0;
    this._slideBlend += ((this.sliding ? 1 : 0) - this._slideBlend) * damp(10, dt);
    const tiltTarget = (-strafe * 0.02 + this._slideBlend * 0.07) * motion;
    this._tilt += (tiltTarget - this._tilt) * damp(8, dt);

    // Shake
    const sh = this.trauma * this.trauma * motion;
    const t = this._time;
    const n1 = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.7 + 1.3) * 0.4;
    const n2 = Math.sin(t * 41.3 + 2.1) * 0.6 + Math.sin(t * 19.1 + 0.7) * 0.4;
    const n3 = Math.sin(t * 29.9 + 4.2) * 0.6 + Math.sin(t * 31.3 + 2.9) * 0.4;

    const p = this.body.position;
    const eye = this._eye + this._stepSmooth + this._landDip + bobY;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    cam.position.set(p.x + cy * bobX + n1 * sh * 0.05, p.y + eye + n2 * sh * 0.04, p.z - sy * bobX + n3 * sh * 0.05);

    let roll = this._tilt + n3 * sh * 0.06;
    if (!this.alive && this._deathCam) roll += this._deathCam.roll * clamp(this._deathCam.t / 0.6, 0, 1);
    const pitch = clamp(this.pitch + this.recoilPitch + this._flinchP + this._kick * motion + n1 * sh * 0.035, -1.55, 1.55);
    const yaw = this.yaw + this.recoilYaw + this._flinchY + n2 * sh * 0.035;
    cam.rotation.set(pitch, yaw, roll, 'YXZ');

    // FOV
    const w = this.weapon;
    const ads = w && this.alive ? ease(clamp(w.adsProgress || 0, 0, 1)) : 0;
    this._sprintBlend += ((this.sprinting ? 1 : 0) - this._sprintBlend) * damp(6, dt);
    const hipFov = this.baseFov + (this._sprintBlend * 3.5 + this._slideBlend * 6) * (reduced ? 0.3 : 1);
    const fov = hipFov + (this._adsFov(w ? w.currentDef : null) - hipFov) * ads;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
