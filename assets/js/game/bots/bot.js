// NULLPUNKT — Bot (Actor, §5): gleiche Regeln wie der Spieler (CapsuleBody, Tempo, Sprung, Ducken,
// Regeneration, Fallschaden, WeaponController + combat), gesteuert von Wahrnehmung → Entscheidung →
// Motorik. Darstellung über Soldier-Instanzen (zwei im Wechsel, damit die Leiche nach dem Respawn liegen
// bleiben und sich auflösen kann).
import * as THREE from 'three';
import { CapsuleBody } from '../engine/physics.js';
import { raycastHumanoid } from '../combat.js';
import { Soldier } from './character.js';
import { Memory } from './ai/memory.js';
import { sense } from './ai/perception.js';
import { Navigator } from './ai/navigator.js';
import { Gunner } from './ai/combat.js';
import { think, newGoal, useStreaks } from './ai/brain.js';

const STAND_H = 1.8, CROUCH_H = 1.15;
const SPEED = { walk: 3.1, run: 5.4, sprint: 8.2, crouch: 2.6 };
const GRAVITY = 24;
const JUMP_V = Math.sqrt(2 * GRAVITY * 1.1);
const ACCEL = 15, DECEL = 11;
const FALL_SAFE = 14;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _eye = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);

export function blankStats() {
  return { kills: 0, deaths: 0, assists: 0, score: 0, shotsFired: 0, shotsHit: 0, headshots: 0, streak: 0, bestStreak: 0, damage: 0, captures: 0, longestKill: 0 };
}

let serial = 0;

export class Bot {
  /**
   * @param {import('./manager.js').BotManager} manager
   * opts: { team, name, diff (Profil), loadout, variant, scheme, modeId, lane }
   */
  constructor(manager, { team, name, diff, loadout, variant = 0, scheme = null, modeId = 'tdm', lane = 1 }) {
    const G = manager.G;
    this.manager = manager;
    this.G = G;
    this.id = `bot_${++serial}`;
    this.name = name;
    this.team = team;
    this.isPlayer = false;
    this.isBot = true;
    this.alive = false;
    this.health = 100;
    this.maxHealth = 100;
    this.body = new CapsuleBody({ radius: 0.35, height: STAND_H, crouchHeight: CROUCH_H });
    this.position = this.body.position;
    this.yaw = 0;
    this.pitch = 0;
    this.loadout = { ...loadout };
    this.lastDamageTime = -1e9;
    this.lastFiredTime = -1e9;
    this.stats = blankStats();
    this.weaponStats = {};
    this.visible = false;
    this.diff = diff;
    this.difficulty = diff.id;
    this.damageScale = diff.damageScale;
    this.modeId = modeId;
    this.lane = lane;
    this.variant = variant;
    this.scheme = scheme;
    this.spawnTime = 0;
    this.diedAt = null;
    this.respawnAt = null;
    this.crouching = false;
    this.sprinting = false;

    // KI
    this.memory = new Memory();
    this.nav = new Navigator(this);
    this.gunner = new Gunner(this);
    this.goal = newGoal();
    // Kompatibel zu Lesern wie modes/streaks.js (actor.ai.target)
    const self = this;
    this.ai = Object.defineProperties({}, {
      target: { get() { return self.gunner.rec && self.gunner.rec.visible ? self.gunner.rec.actor : null; }, enumerable: true },
      state: { get() { return self.goal.kind; }, enumerable: true },
    });
    this.coverNode = null;
    this.throwPlan = null;
    this.nextGrenadeAt = 0;
    this.wantReload = false;
    this.lastGoal = null;
    this._senseT = Math.random() * 0.2;
    this._senseDt = 0;
    this._thinkT = Math.random() * 0.3;
    this._streakT = 2 + Math.random() * 2;
    this._em = { x: 0, z: 0, crouch: false, jump: false, nav: null, sprint: false };
    this._scan = { base: 0, t: 0 };
    this._intent = {
      fire: false, firePressed: false, ads: false, reload: false, swap: false, slot: null, grenade: false, grenadeHeld: false,
      melee: false, sprinting: false, moving: false, airborne: false, onGround: true, crouching: false, sliding: false,
      speed: 0, lookDX: 0, lookDY: 0, frozen: false, grenadeCook: 0, cancelReload: false,
    };

    // Darstellung
    this.soldiers = [];
    this.active = 0;
    this._gunId = null;
    this._shotSeen = -1e9;
    this._shotPending = 0;
    this._animAcc = 0;
    this._animFrame = (Math.random() * 6) | 0;
    this.animEvery = 1;
    this.inView = true;
    this.camDist = 50;
    this.lastHitZone = 'body';
    this.lastHitDir = null;
    this.lastHitExplosive = false;
    this._soldier(0);

    // Waffen
    this.weapon = G.weapons.createController(this, this.loadout);
    this._syncGun(true);
  }

  /* ================================================================ Darstellung */

  _soldier(i) {
    if (!this.soldiers[i]) {
      const s = new Soldier({ team: this.team, variant: this.variant, camo: this.scheme, quality: this.manager.quality, models: this.manager.models, name: this.name });
      s.guns = new Map();
      this.manager.scene.add(s.root);
      this.soldiers[i] = s;
    }
    return this.soldiers[i];
  }

  get soldier() { return this.soldiers[this.active]; }

  /** Drittpersonen-Waffe der aktiven Instanz an die aktuelle Waffe anpassen. */
  _syncGun(force = false) {
    const def = this.weapon && this.weapon.currentDef;
    const s = this.soldier;
    if (!def || !s) return;
    if (!force && s.def && s.def.id === def.id && s.gun) return;
    let gun = s.guns.get(def.id);
    if (!gun) {
      gun = this.manager.makeGun(def);
      if (!gun) return;
      s.guns.set(def.id, gun);
    }
    s.setWeaponModel(gun, def);
    this._gunId = def.id;
  }

  /* ================================================================ Actor-API */

  getEyePosition(out = new THREE.Vector3()) {
    const p = this.body.position;
    return out.set(p.x, p.y + this.body.height - 0.15, p.z);
  }

  getAimDirection(out = new THREE.Vector3()) {
    const yaw = this.yaw + this.gunner.recoilY;
    const pitch = clamp(this.pitch + this.gunner.recoilP, -1.4, 1.4);
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  }

  getMuzzlePosition(out = new THREE.Vector3()) {
    const s = this.soldier;
    if (s && s.state === 'alive' && this.camDist < 120) return s.getMuzzlePosition(out);
    this.getEyePosition(out);
    this.getAimDirection(_v);
    return out.addScaledVector(_v, 0.6).add(_w.set(0, -0.15, 0));
  }

  raycastHitboxes(ray, maxDist) {
    const s = this.soldier;
    if (s && s.state === 'alive') return s.raycast(ray, maxDist);
    return raycastHumanoid(this, ray, maxDist);
  }

  addRecoil(pitch = 0, yaw = 0) {
    this.gunner.addRecoil(pitch * 0.85, yaw * 0.85);
  }

  /** Geräusch/Hinweis: Blick dorthin lenken (falls frei). */
  alert(pos, now) {
    if (!this.alive) return;
    this._alertPos = this._alertPos || new THREE.Vector3();
    this._alertPos.copy(pos);
    this._alertUntil = now + 1.6;
    this._thinkT = Math.min(this._thinkT, 0.08 + this.diff.reaction * 0.4);
  }

  onDamaged(info) {
    const now = this.G.time.elapsed;
    const a = info.attacker;
    this.lastHitZone = info.zone || 'body';
    this.lastHitDir = info.dir ? info.dir.clone() : null;
    this.lastHitExplosive = !!info.explosive;
    if (a && a !== this && a.position) {
      if (a.alive !== false) this.memory.damaged(a, now);
      this.alert(a.position, now);
    }
    // Trefferwirkung: Zielfehler + Zucken
    this.gunner.errX += (Math.random() - 0.5) * 0.06;
    this.gunner.errY += (Math.random() - 0.5) * 0.04;
    const s = this.soldier;
    if (s && info.dir) s.playHit(info.dir, info.zone, info.amount || 20);
  }

  onDeath(info = {}) {
    this.alive = false;
    const s = this.soldier;
    const dir = info.dir || this.lastHitDir || (info.killer && info.killer.position ? _v.subVectors(this.position, info.killer.position).normalize().clone() : null);
    const W = this.G.data && this.G.data.WEAPONS && info.weaponId ? this.G.data.WEAPONS[info.weaponId] : null;
    let strength = 1;
    if (info.explosive) strength = 1.8;
    else if (W && (W.cls === 'sniper' || W.cls === 'shotgun')) strength = 1.5;
    else if (W && W.cls === 'melee') strength = 0.7;
    if (s && s.state === 'alive') {
      s.playDeath(dir, { velocity: this.body.velocity.clone(), zone: info.headshot ? 'head' : this.lastHitZone, strength, explosive: !!info.explosive, scene: this.manager.scene });
    }
    this.gunner.reset();
    this.nav.stop();
    this.memory.clear();
    this.throwPlan = null;
    this.coverNode = null;
    this.goal.kind = 'idle';
    this.sprinting = this.crouching = false;
    this.manager.onBotDeath(this);
  }

  respawn(spawn) {
    const pos = spawn && spawn.position ? spawn.position : new THREE.Vector3();
    // Leiche noch sichtbar → andere Instanz verwenden
    const cur = this.soldier;
    if (cur && cur.state === 'dead') {
      const other = 1 - this.active;
      const o = this._soldier(other);
      if (o.state === 'dead') o.hide();
      this.active = other;
    }
    this.body.setHeight(STAND_H);
    this.body.teleport(pos);
    this.yaw = spawn && Number.isFinite(spawn.yaw) ? spawn.yaw : 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.lastDamageTime = -1e9;
    this.spawnTime = this.G.time.elapsed;
    this.respawnAt = null;
    this.crouching = this.sprinting = false;
    this.memory.clear();
    this.gunner.reset();
    this.nav.reset();
    this.goal = newGoal();
    this.throwPlan = null;
    this.coverNode = null;
    this._thinkT = 0.05 + Math.random() * 0.25;
    this._senseT = Math.random() * 0.15;
    this.nextGrenadeAt = this.spawnTime + rnd(4, 10);
    if (this.weapon) this.weapon.refill();
    this._syncGun(true);
    const s = this.soldier;
    s.reset(pos, this.yaw);
    this._animAcc = 0;
  }

  /* ================================================================ Bild */

  update(dt) {
    const G = this.G;
    if (!this.alive) { this._updateCorpses(dt); return; }
    const now = G.time.elapsed;
    const frozen = G.match.state !== 'playing';
    const D = this.diff;
    const goal = this.goal;
    const gunner = this.gunner;
    const body = this.body;
    const w = this.weapon;
    const world = G.world;

    // --- Wahrnehmen + Entscheiden (gestaffelt)
    this._senseDt += dt;
    this._senseT -= dt;
    if (this._senseT <= 0) {
      this._senseT += (1 / D.senseHz) * rnd(0.85, 1.15);
      sense(this, now, this._senseDt);
      this._senseDt = 0;
      // gerade entdeckt → sofort neu entscheiden
      const rec = gunner.selectTarget(now);
      if (rec && (!gunner.rec || gunner.rec.actor !== rec.actor) && goal.kind !== 'engage') this._thinkT = Math.min(this._thinkT, 0.05);
    }
    if (!frozen) {
      this._thinkT -= dt;
      if (this._thinkT <= 0) {
        this._thinkT = D.thinkInterval * rnd(0.85, 1.15);
        think(this, now);
      }
      this._streakT -= dt;
      if (this._streakT <= 0) { this._streakT = rnd(1.8, 3); if (this.manager.handlesStreaks) useStreaks(this, now); }
    }

    // --- Zielen / Blick
    let angErr = Infinity;
    const tp = this.throwPlan;
    const rec = gunner.rec;
    if (tp) {
      gunner.look(dt, tp.yaw, tp.pitch, 1.2);
    } else if (rec && rec.actor.alive && (rec.visible || now - rec.seenAt < 1.0)) {
      angErr = gunner.aim(dt, now);
    } else {
      this._lookAround(dt, now);
    }

    // --- Bewegung
    let mx = 0, mz = 0;
    let speedKind = goal.speed || 'run';
    let wantCrouch = false, wantJump = false;
    if (!frozen && !tp) {
      if (goal.kind === 'engage' && rec) {
        const em = gunner.engageMove(dt, now, this._em);
        const toCover = this.coverNode && goal.hasMove && this.position.distanceTo(goal.move) > 0.7 && rec.pos.distanceTo(this.position) > 8;
        if (toCover) {
          this.nav.goTo(goal.move, { tolerance: 0.5, repath: 1 });
          const d = this.nav.update(dt, now, true);
          mx = d.x; mz = d.z; speedKind = 'run';
        } else if (em.nav) {
          this.nav.goTo(em.nav, { tolerance: 2.5, repath: 3 });
          const d = this.nav.update(dt, now, true);
          mx = d.x; mz = d.z; speedKind = em.sprint ? 'sprint' : 'run';
        } else {
          mx = em.x; mz = em.z; speedKind = 'walk';
          this.nav.update(dt, now, false);
        }
        wantCrouch = em.crouch;
        wantJump = em.jump;
      } else if (goal.hasMove) {
        this.nav.goTo(goal.move, { tolerance: goal.tolerance });
        const d = this.nav.update(dt, now, !this.nav.arrived);
        if (!this.nav.arrived) { mx = d.x; mz = d.z; }
        wantCrouch = goal.crouch && this.nav.arrived;
        if (goal.kind === 'cover' || goal.kind === 'heal') wantCrouch = this.nav.arrived && !!(this.coverNode && !this.coverNode.coverHigh);
      }
      if (this.nav.jump) wantJump = true;
      // lokales Ausweichen
      const sep = this._separation(_w);
      mx += sep.x; mz += sep.z;
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
    }

    // Tempo
    const def = w ? w.currentDef : null;
    const ads = w ? w.adsProgress || 0 : 0;
    const moveLen = Math.hypot(mx, mz);
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const facing = moveLen > 0.1 ? (mx * fwdX + mz * fwdZ) / moveLen : 0;
    let sprint = speedKind === 'sprint' && facing > 0.8 && ads < 0.1 && (!w || w.canSprint !== false) && body.onGround && !wantCrouch && now - (w ? w.lastShotTime : 0) > 0.4;
    if (sprint && rec && rec.visible) sprint = false;
    this.sprinting = sprint && moveLen > 0.3;
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) this.crouching = true;
      else if (body.canStand(world)) this.crouching = false;
    }
    const base = this.crouching ? SPEED.crouch : this.sprinting ? SPEED.sprint : SPEED[speedKind === 'sprint' ? 'run' : speedKind] || SPEED.run;
    const mult = (def && def.moveSpeedMult ? def.moveSpeedMult : 1) * (1 + ((def && def.adsMoveMult ? def.adsMoveMult : 0.6) - 1) * ads);
    const tx = mx * base * mult, tz = mz * base * mult;

    // Physik
    const v = body.velocity;
    if (!(w && w.isMeleeing)) {
      if (body.onGround) {
        const k = (tx * v.x + tz * v.z) >= 0 && (tx || tz) ? ACCEL : DECEL;
        const a = 1 - Math.exp(-k * dt);
        v.x += (tx - v.x) * a;
        v.z += (tz - v.z) * a;
      } else {
        const a = 1 - Math.exp(-2.4 * dt);
        v.x += (tx - v.x) * a * 0.5;
        v.z += (tz - v.z) * a * 0.5;
      }
    }
    if (!frozen && wantJump && body.onGround && !this.crouching && body.canStand(world, STAND_H)) { v.y = JUMP_V; body.onGround = false; }
    // Kapselhöhe
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    if (targetH > body.height + 1e-3) {
      const next = Math.min(targetH, body.height + (targetH - body.height) * (1 - Math.exp(-16 * dt)) + 0.01);
      if (body.canStand(world, next)) body.setHeight(next); else this.crouching = true;
    } else if (targetH < body.height - 1e-3) body.setHeight(body.height + (targetH - body.height) * (1 - Math.exp(-18 * dt)));
    const wasGround = body.onGround;
    const vyBefore = v.y;
    body.step(dt, world, { gravity: GRAVITY, stepHeight: 0.45 });
    if (!wasGround && body.onGround && -vyBefore > FALL_SAFE && G.combat && !frozen) {
      G.combat.damage(this, { amount: (-vyBefore - FALL_SAFE) * 9, attacker: null, weaponId: 'fall', zone: 'body', dir: new THREE.Vector3(0, -1, 0) });
      if (!this.alive) return;
    }
    if (body.outOfWorld && G.combat) { G.combat.damage(this, { amount: 9999, attacker: null, weaponId: 'world' }); return; }
    if (world && world.bounds) this._clamp(world.bounds);

    // Regeneration (wie Spieler)
    if (this.health < this.maxHealth && now - this.lastDamageTime > 3.5) this.health = Math.min(this.maxHealth, this.health + 55 * dt);

    // --- Waffe
    const it = this._intent;
    it.frozen = frozen;
    it.fire = it.firePressed = it.reload = it.swap = it.grenade = it.grenadeHeld = it.melee = it.cancelReload = false;
    it.slot = null;
    it.grenadeCook = 0;
    it.ads = false;
    const hs = Math.hypot(v.x, v.z);
    it.moving = hs > 0.5;
    it.speed = hs;
    it.airborne = !body.onGround;
    it.onGround = body.onGround;
    it.crouching = this.crouching;
    it.sprinting = this.sprinting;
    if (!frozen && w) {
      if (tp) this._throw(now, it);
      else if (rec) gunner.trigger(dt, now, angErr, it);
      if (!rec || !rec.visible) {
        if (this.wantReload) { it.reload = true; this.wantReload = false; }
        // zurück zur Hauptwaffe
        if (w.index === 1 && w.slots.length > 1 && !w.isSwitching && now - (this._swapAt || 0) > 2) { it.slot = 1; this._swapAt = now; }
      } else if (D.swapToPistol && w.index === 0 && w.slots.length > 1 && w.current && w.current.mag === 0 && rec.pos.distanceTo(this.position) < 14 && !w.isSwitching && w.slots[1].mag > 0) {
        it.slot = 2; this._swapAt = now;
      }
      if (this.sprinting) it.ads = false;
    }
    if (w) {
      w.update(dt, it);
      if (w.lastShotTime !== this._shotSeen) { this._shotSeen = w.lastShotTime; if (now - w.lastShotTime < 0.1) this._shotPending++; }
      if (w.currentDef && w.currentDef.id !== this._gunId) this._syncGun();
    }

    // --- Darstellung
    this._animate(dt, now);
  }

  _throw(now, it) {
    const tp = this.throwPlan;
    const w = this.weapon;
    if (!tp.started) {
      const ey = Math.abs(wrap(tp.yaw - this.yaw)), ep = Math.abs(tp.pitch - this.pitch);
      if ((ey < 0.07 && ep < 0.07) || now - tp.at > 1.2) {
        it.grenade = true;
        it.grenadeCook = tp.cook;
        tp.started = true;
        tp.startAt = now;
      }
      if (now - tp.at > 2.5) this.throwPlan = null;
    } else if (!w.isThrowing && now - tp.startAt > 0.2) {
      this.throwPlan = null;
      this._thinkT = 0.05;
    } else if (now - tp.startAt > 4) this.throwPlan = null;
  }

  /** Ohne Ziel: in Laufrichtung, zum Hinweis oder suchend umherblicken. */
  _lookAround(dt, now) {
    const goal = this.goal;
    const v = this.body.velocity;
    const hs = Math.hypot(v.x, v.z);
    let yaw = this.yaw, pitch = 0, speed = 0.55;
    if (this._alertUntil && now < this._alertUntil) {
      _v.subVectors(this._alertPos, this.position);
      yaw = Math.atan2(-_v.x, -_v.z);
      pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.5, 0.5);
      speed = 0.9;
    } else if (goal.hasLook && goal.look === 'point') {
      _v.subVectors(goal.lookAt, this.position);
      yaw = Math.atan2(-_v.x, -_v.z);
      pitch = clamp(Math.atan2(_v.y + 0.2, Math.hypot(_v.x, _v.z)), -0.4, 0.4);
      if (hs > 4 && Math.abs(wrap(yaw - Math.atan2(-v.x, -v.z))) > 1.6 && goal.kind !== 'heal') yaw = Math.atan2(-v.x, -v.z);
    } else if (hs > 1) {
      yaw = Math.atan2(-v.x, -v.z);
    } else {
      // umsehen
      const sc = this._scan;
      if (now > sc.t) { sc.t = now + rnd(1.2, 2.8); sc.base = this.yaw + rnd(-1.1, 1.1); }
      yaw = sc.base;
      speed = 0.35;
    }
    this.gunner.look(dt, yaw, pitch, speed);
  }

  /** Verbündete/Akteure in der Nähe sanft umgehen. */
  _separation(out) {
    out.set(0, 0, 0);
    const p = this.position;
    for (const a of this.G.actors) {
      if (a === this || !a.alive || !a.position) continue;
      const dx = p.x - a.position.x, dz = p.z - a.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1.3 || d2 < 1e-6 || Math.abs(a.position.y - p.y) > 1.5) continue;
      const d = Math.sqrt(d2);
      const k = (1.15 - d) / 1.15 * 0.9;
      out.x += (dx / d) * k;
      out.z += (dz / d) * k;
    }
    return out;
  }

  _clamp(b) {
    const p = this.body.position, v = this.body.velocity, r = this.body.radius;
    if (p.x < b.min.x + r) { p.x = b.min.x + r; if (v.x < 0) v.x = 0; }
    if (p.x > b.max.x - r) { p.x = b.max.x - r; if (v.x > 0) v.x = 0; }
    if (p.z < b.min.z + r) { p.z = b.min.z + r; if (v.z < 0) v.z = 0; }
    if (p.z > b.max.z - r) { p.z = b.max.z - r; if (v.z > 0) v.z = 0; }
    this.body._sync();
  }

  /* ================================================================ Animation */

  _animate(dt, now) {
    const s = this.soldier;
    if (!s) return;
    this._animAcc += dt;
    this._animFrame++;
    const every = this.animEvery;
    if (every > 1 && this._animFrame % every !== 0) {
      s.place(this.body.position, s.anim.bodyYaw);
      return;
    }
    const adt = this._animAcc;
    this._animAcc = 0;
    const w = this.weapon;
    const def = w ? w.currentDef : null;
    const p = this._ap || (this._ap = { velocity: new THREE.Vector3() });
    p.velocity.copy(this.body.velocity);
    p.aimYaw = this.yaw + this.gunner.recoilY;
    p.aimPitch = this.pitch + this.gunner.recoilP * 0.6;
    p.crouch = this.crouching;
    p.sprint = this.sprinting;
    p.ads = w ? w.adsProgress : 0;
    p.onGround = this.body.onGround;
    p.firing = this._shotPending > 0;
    p.shotStrength = def ? (def.cls === 'sniper' || def.cls === 'shotgun' ? 1.8 : def.cls === 'marksman' ? 1.3 : def.cls === 'smg' ? 0.75 : 1) : 1;
    this._shotPending = 0;
    p.reloading = w ? w.isReloading : false;
    p.reloadProgress = w ? w.reloadProgress : 0;
    p.reloadEmpty = w ? w.reloadEmpty : false;
    p.perShell = !!(def && def.perShellReload);
    p.throwing = w ? w.isThrowing : false;
    p.cooking = w ? w.cooking : false;
    p.meleeing = w ? w.isMeleeing : false;
    p.idleLook = !this.gunner.rec && Math.hypot(this.body.velocity.x, this.body.velocity.z) < 0.4;
    p.position = this.body.position;
    s.animate(adt, p);
    // Schritte (synchron zum Aufsetzen der Füße)
    if (s.anim.events.footstep >= 0) this.manager.footstep(this);
  }

  _updateCorpses(dt) {
    const world = this.G.world;
    for (const s of this.soldiers) if (s && s.state === 'dead') s.updateDead(dt, world);
  }

  /** Leichen weiterführen, auch wenn der Bot schon wieder lebt. */
  updateCorpsesOnly(dt) {
    const world = this.G.world;
    for (let i = 0; i < this.soldiers.length; i++) {
      if (i === this.active) continue;
      const s = this.soldiers[i];
      if (s && s.state === 'dead') s.updateDead(dt, world);
    }
  }

  dispose() {
    if (this.weapon && typeof this.weapon.dispose === 'function') this.weapon.dispose();
    this.weapon = null;
    for (const s of this.soldiers) if (s) s.dispose();
    this.soldiers = [];
    this.alive = false;
  }
}
