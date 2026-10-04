// NULLPUNKT — Wachgeschütz (Serienprämie 'sentry'): Dreibein-Geschütz aus Grundkörpern, dreht sich zum
// nächsten sichtbaren Gegner, feuert über combat.fireHitscan (Schütze = diese Entität, Besitzer = owner),
// ist zerstörbar (Kugeln über world.raycast, Explosionen) und verschwindet nach Ablauf der Dauer.

import * as THREE from 'three';
import { raySphere, rayCapsule } from '../combat.js';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const HEAD_Y = 1.0;
const PIVOT_Y = 0.66;

/** Waffendefinition des Geschützes (für combat.falloff, Killfeed „Wachgeschütz“). */
export function sentryWeaponDef(params = {}) {
  const dmg = params.damage || 20;
  return {
    id: 'sentry', name: 'Wachgeschütz', cls: 'lmg', slot: 'streak', pellets: 1,
    damage: { max: dmg, min: Math.round(dmg * 0.7), rangeStart: 18, rangeEnd: params.range || 45 },
    headMult: 1.2, limbMult: 0.9, range: (params.range || 45) + 5, penetration: 0.2, rpm: params.rpm || 540,
    sound: { profile: 'lmg', pitch: 1.15 },
  };
}

let serial = 0;

/** Gemeinsame Geometrien/Materialien (vom StreakManager entsorgt). */
export function createSentryResources() {
  const res = {
    leg: new THREE.CylinderGeometry(0.022, 0.03, 0.8, 6),
    hub: new THREE.CylinderGeometry(0.09, 0.11, 0.14, 10),
    body: new THREE.BoxGeometry(0.38, 0.3, 0.52),
    ammo: new THREE.BoxGeometry(0.16, 0.2, 0.28),
    shroud: new THREE.BoxGeometry(0.15, 0.15, 0.42),
    barrel: new THREE.CylinderGeometry(0.024, 0.028, 0.5, 8).rotateX(Math.PI / 2),
    shield: new THREE.BoxGeometry(0.56, 0.34, 0.03),
    sensor: new THREE.BoxGeometry(0.12, 0.08, 0.1),
    flash: new THREE.PlaneGeometry(0.34, 0.34),
    mats: {
      metal: new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.5, metalness: 0.65 }),
      olive: new THREE.MeshStandardMaterial({ color: 0x4b5236, roughness: 0.8, metalness: 0.15 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.7 }),
      ally: new THREE.MeshStandardMaterial({ color: 0x0c2230, emissive: 0x38b6ff, emissiveIntensity: 2.2, roughness: 0.3 }),
      enemy: new THREE.MeshStandardMaterial({ color: 0x300c0c, emissive: 0xff3b3b, emissiveIntensity: 2.2, roughness: 0.3 }),
      flash: new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    },
  };
  res.mats.metal.userData.surface = 'metal';
  res.dispose = () => {
    for (const v of Object.values(res)) if (v && v.isBufferGeometry) v.dispose();
    for (const m of Object.values(res.mats)) m.dispose();
  };
  return res;
}

export class Sentry {
  /**
   * @param mgr StreakManager, owner Actor, position Vector3 (Füße), yaw, params STREAKS.sentry.params, duration s
   */
  constructor(mgr, owner, position, yaw, params, duration) {
    const G = mgr.G;
    this.mgr = mgr;
    this.G = G;
    this.kind = 'sentry';
    this.streakId = 'sentry';
    this.isStreakEntity = true;
    this.id = `sentry_${++serial}`;
    this.name = 'Wachgeschütz';
    this.owner = owner;
    this.team = owner.team;
    this.isPlayer = false;
    this.isBot = false;
    this.surface = 'metal';
    this.params = { range: 45, rpm: 540, damage: 20, health: 350, turnSpeed: 3.5, aimError: 0.02, reactionTime: 0.4, ...params };
    this.maxHealth = this.params.health;
    this.health = this.maxHealth;
    this.alive = true;
    this.duration = duration || 45;
    this.timeLeft = this.duration;
    this.position = position.clone();
    this.yaw = yaw;
    this.pitch = 0;
    this.stats = { kills: 0, deaths: 0, assists: 0, score: 0, shotsFired: 0, shotsHit: 0, headshots: 0, streak: 0, bestStreak: 0, damage: 0, captures: 0, longestKill: 0 };
    this.weaponStats = {};
    this.lastFiredTime = -1e9;
    this.lastDamageTime = -1e9;
    this.visible = true;
    this.def = sentryWeaponDef(this.params);
    this.target = null;
    this._acquiredAt = 0;
    this._scanT = 0;
    this._cool = 0;
    this._flashT = 0;
    this._hitT = 0;
    this._deploy = 0;
    this._dying = 0;
    this._build(mgr.resources());
  }

  _build(R) {
    const g = new THREE.Group();
    g.name = `sentry:${this.owner ? this.owner.name : ''}`;
    g.position.copy(this.position);
    const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const leg = mk(R.leg, R.mats.dark, g, Math.sin(a) * 0.22, 0.32, Math.cos(a) * 0.22);
      leg.rotation.set(Math.cos(a) * 0.62, 0, -Math.sin(a) * 0.62);
    }
    mk(R.hub, R.mats.metal, g, 0, 0.6, 0);
    const head = new THREE.Group();
    head.position.y = PIVOT_Y;
    head.rotation.y = this.yaw;
    g.add(head);
    mk(R.body, R.mats.metal, head, 0, 0.18, 0.04);
    mk(R.ammo, R.mats.olive, head, -0.27, 0.14, 0.06);
    const pitch = new THREE.Group();
    pitch.position.set(0, 0.24, -0.08);
    head.add(pitch);
    mk(R.shroud, R.mats.metal, pitch, 0, 0, -0.26);
    mk(R.barrel, R.mats.dark, pitch, 0, 0, -0.66);
    mk(R.shield, R.mats.olive, pitch, 0, -0.04, -0.2);
    const isAlly = this.G.player && this.owner && (this.owner === this.G.player || (this.owner.team != null && this.owner.team === this.G.player.team));
    const lens = mk(R.sensor, isAlly ? R.mats.ally : R.mats.enemy, pitch, 0, 0.13, -0.1);
    lens.castShadow = false;
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.93);
    pitch.add(muzzle);
    const flash = new THREE.Group();
    const f1 = new THREE.Mesh(R.flash, R.mats.flash);
    const f2 = new THREE.Mesh(R.flash, R.mats.flash);
    f2.rotation.y = Math.PI / 2;
    const f3 = new THREE.Mesh(R.flash, R.mats.flash);
    f3.rotation.x = Math.PI / 2;
    flash.add(f1, f2, f3);
    flash.position.set(0, 0, -0.98);
    flash.visible = false;
    pitch.add(flash);
    g.scale.setScalar(0.01);
    this.group = g;
    this.head = head;
    this.pitchPivot = pitch;
    this.muzzle = muzzle;
    this.flash = flash;
    this.lens = lens;
    this.G.scene.add(g);
  }

  /* ------------------------------------------------------------ Actor-artige API */

  getEyePosition(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.position.y + HEAD_Y, this.position.z);
  }

  getAimDirection(out = new THREE.Vector3()) {
    const c = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c);
  }

  /** Zielpunkt für Bots/Zielhilfe. */
  getAimPoint(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.position.y + 0.85, this.position.z);
  }

  getMuzzlePosition(out = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(out);
  }

  /** Strahl gegen das Geschütz → { distance, point, normal } | null (Ursprung im Inneren zählt nicht). */
  raycast(origin, dir, maxDist) {
    if (!this.alive) return null;
    const p = this.position;
    _a.set(p.x, p.y + HEAD_Y, p.z);
    if (origin.distanceToSquared(_a) < 0.2) return null;
    let best = raySphere(origin, dir, _a, 0.4);
    _a.set(p.x, p.y + 0.12, p.z);
    _b.set(p.x, p.y + 0.62, p.z);
    const t2 = rayCapsule(origin, dir, _a, _b, 0.3);
    if (t2 > 0 && (best <= 0 || t2 < best)) best = t2;
    if (!(best > 0.01) || best > maxDist) return null;
    const point = new THREE.Vector3().copy(dir).multiplyScalar(best).add(origin);
    const normal = new THREE.Vector3().subVectors(point, _v.set(p.x, point.y, p.z));
    if (normal.lengthSq() < 1e-6) normal.copy(dir).negate(); else normal.normalize();
    return { distance: best, point, normal, surface: 'metal', object: this.group, entity: this };
  }

  /** Schaden (Kugeln/Explosionen). Gibt den verrechneten Schaden zurück. */
  applyDamage(amount, attacker) {
    if (!this.alive || amount <= 0) return 0;
    const dealt = Math.min(this.health, amount);
    this.health -= dealt;
    this.lastDamageTime = this.G.time.elapsed;
    this._hitT = 0.12;
    if (attacker && attacker.stats && !attacker.isStreakEntity) attacker.stats.damage = (attacker.stats.damage || 0) + dealt;
    // Angreifer als Ziel bevorzugen
    if (attacker && attacker.alive && !attacker.isStreakEntity && this._hostile(attacker)) this.target = attacker;
    if (this.health <= 0) this.mgr._destroyEntity(this, attacker);
    return dealt;
  }

  _hostile(a) {
    if (!a || a === this || a === this.owner) return false;
    if (a.isStreakEntity && a.owner === this.owner) return false;
    if (a.team != null && this.team != null) return a.team !== this.team;
    return true;
  }

  /* ------------------------------------------------------------ Update */

  update(dt, playing) {
    const G = this.G;
    this._deploy = Math.min(1, this._deploy + dt * 3.2);
    const s = this._dying > 0 ? Math.max(0.01, 1 - this._dying * 2.5) : 0.01 + 0.99 * easeOutBack(this._deploy);
    this.group.scale.setScalar(s);
    if (this._dying > 0) {
      this._dying += dt;
      this.head.rotation.x = Math.min(0.6, this._dying * 2);
      return this._dying < 0.4;
    }
    if (!this.alive) return false;
    if (playing) this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.alive = false;
      this._dying = 0.001;
      this.mgr._expireEntity(this);
      return true;
    }
    this._flashT -= dt;
    this.flash.visible = this._flashT > 0;
    if (this._hitT > 0) {
      this._hitT -= dt;
      this.lens.visible = Math.floor(this._hitT * 40) % 2 === 0;
    } else this.lens.visible = true;
    if (!playing || this._deploy < 1) return true;

    // Ziel suchen (gestaffelt)
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = 0.2 + Math.random() * 0.05;
      const prev = this.target;
      this.target = this._findTarget();
      if (this.target && this.target !== prev) this._acquiredAt = G.time.elapsed;
    }
    const t = this.target;
    let wantYaw = this.yaw;
    let wantPitch = 0;
    if (t) {
      this.getEyePosition(_v);
      aimPointOf(t, _aim).sub(_v);
      wantYaw = Math.atan2(-_aim.x, -_aim.z);
      wantPitch = Math.atan2(_aim.y, Math.hypot(_aim.x, _aim.z));
    } else {
      // langsames Schwenken im Leerlauf
      wantYaw = this.yaw + Math.sin(G.time.elapsed * 0.6 + this.position.x) * 0.6 * dt;
    }
    const turn = this.params.turnSpeed * dt;
    const dy = wrap(wantYaw - this.yaw);
    this.yaw = wrap(this.yaw + clamp(dy, -turn, turn));
    this.pitch += clamp(wantPitch - this.pitch, -turn, turn);
    this.head.rotation.y = this.yaw;
    this.pitchPivot.rotation.x = this.pitch;

    // Feuern
    this._cool -= dt;
    if (t && Math.abs(dy) < 0.08 && G.time.elapsed - this._acquiredAt >= this.params.reactionTime) {
      const interval = 60 / this.params.rpm;
      let guard = 0;
      while (this._cool <= 0 && guard++ < 3) {
        this._cool += interval;
        this._fire(t);
      }
    }
    if (this._cool < -0.2) this._cool = 0;
    return true;
  }

  _findTarget() {
    const G = this.G;
    const w = G.world;
    const range = this.params.range;
    this.getEyePosition(_v);
    let best = null;
    let bestD = Infinity;
    const consider = (a, bias) => {
      if (!a.alive || !this._hostile(a)) return;
      aimPointOf(a, _aim);
      const d = _aim.distanceTo(_v) * bias;
      if (d > range * bias || d >= bestD) return;
      if (w && w.lineOfSight && !w.lineOfSight(_v, _aim)) return;
      best = a;
      bestD = d;
    };
    if (this.target) consider(this.target, 0.7);
    for (const a of G.actors) if (a !== this.target) consider(a, 1);
    for (const e of this.mgr.entities) if (e !== this && e !== this.target) consider(e, 1.4);
    return best;
  }

  _fire(target) {
    const G = this.G;
    const now = G.time.elapsed;
    this.getMuzzlePosition(_a);
    aimPointOf(target, _aim);
    _dir.subVectors(_aim, _a);
    const dist = _dir.length();
    _dir.multiplyScalar(1 / Math.max(dist, 1e-4));
    randomInCone(_dir, this.params.aimError * (0.6 + Math.random() * 0.8), _dir);
    // Nicht durch den eigenen Besitzer schießen (FFA: Besitzer ist für combat „feindlich“)
    const o = this.owner;
    if (o && o.alive && o.position) {
      _b.copy(o.position);
      _b.y += 1.0;
      const along = _b.clone().sub(_a).dot(_dir);
      if (along > 0 && along < dist) {
        _v.copy(_dir).multiplyScalar(along).add(_a);
        if (_v.distanceTo(_b) < 0.9) return;
      }
    }
    this.lastFiredTime = now;
    this._flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    G.events.emit('weapon:fire', { actor: this, weaponId: 'sentry', origin: _a.clone(), dir: _dir.clone(), muzzle: _a.clone(), suppressed: false });
    let res = null;
    if (target.isStreakEntity) {
      // Geschütz gegen Geschütz: direkt über den Weltstrahl (enthält Geschütze)
      const hit = G.world ? G.world.raycast(_a, _dir, this.def.range) : null;
      res = { point: hit ? hit.point : _a.clone().addScaledVector(_dir, this.def.range), hit: hit ? 'world' : null };
      if (hit) G.events.emit('impact', { point: hit.point, normal: hit.normal, surface: hit.surface || 'metal', shooter: this, weaponId: 'sentry' });
    } else if (G.combat) {
      const sc = o && Number.isFinite(o.damageScale) ? o.damageScale : 1;
      res = G.combat.fireHitscan({ shooter: this, origin: _a, dir: _dir, range: this.def.range, weapon: this.def, damageScale: sc });
    }
    if (res) G.events.emit('tracer', { from: _a.clone(), to: res.point.clone ? res.point.clone() : res.point, actor: this, weaponId: 'sentry', hit: res.hit });
  }

  dispose() {
    this.alive = false;
    if (this.group) this.group.removeFromParent();
    this.group = null;
  }
}

function aimPointOf(a, out) {
  if (a.isStreakEntity && a.getAimPoint) return a.getAimPoint(out);
  const h = a.body ? a.body.height : 1.8;
  return out.set(a.position.x, a.position.y + h * 0.62, a.position.z);
}

function randomInCone(dir, angle, out) {
  if (angle <= 1e-6) return out.copy(dir);
  const r = angle * Math.sqrt(Math.random());
  const th = Math.random() * Math.PI * 2;
  _u.crossVectors(dir, Math.abs(dir.y) > 0.95 ? _w.set(1, 0, 0) : UP).normalize();
  _w.crossVectors(_u, dir).normalize();
  return out.copy(dir).addScaledVector(_u, Math.tan(r * Math.cos(th))).addScaledVector(_w, Math.tan(r * Math.sin(th))).normalize();
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
