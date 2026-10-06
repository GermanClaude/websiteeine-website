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
import { targetPoints } from './ai/perception.js';
import { GADGETS } from '../../shared/classes.data.js';
import { BONE } from './soldier/rig.js';

const STAND_H = 1.8, CROUCH_H = 1.15, PRONE_H = 0.75;
const SPEED = { walk: 3.1, run: 5.4, sprint: 8.2, crouch: 2.6, crawl: 1.05 };
const PRONE_TIME = 0.7; // s hocken ↔ liegen (wie der Spieler)
const PRONE_YAW = 0.75; // rad: weiter seitlich liegt das Ziel nicht im Schussfeld → aufstehen
const SUPPRESS_CLS = new Set(['ar', 'carbine', 'lmg', 'smg']);
const GRAVITY = 24;
const JUMP_V = Math.sqrt(2 * GRAVITY * 1.1);
const ACCEL = 15, DECEL = 11;
const FALL_SAFE = 14;
const ANIM_MAX_STEP = 0.25; // s je Animationsschritt (6 übersprungene Bilder bei 24 fps)
// feste Optionsobjekte (keine Allokation pro Bild)
const STEP_OPTS = { gravity: GRAVITY, stepHeight: 0.45 };
const GO_COVER = { tolerance: 0.5, repath: 1 };
const GO_ENGAGE = { tolerance: 2.5, repath: 3 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _lp = new THREE.Vector3();
const _lh = new THREE.Vector3();
const _ld = new THREE.Vector3();
const _le = new THREE.Vector3();
// Lehnen (C6): seitlicher Kopfversatz wie beim Spieler (core-input F5: 0,38 m, Kopf 6 cm tiefer); die Soldaten-Pose
// erreicht ≈ 0,34 m (Becken 0,1 m + Rumpfrollen 0,33 rad)
const LEAN_SIDE = 0.34, LEAN_DROP = 0.05;
const LEAN_RATE = 12; // 1/s (≈ 90 % in 0,19 s)
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
    // Haltung (bots-scale, gleiche Felder wie der Spieler): stance 'stand'|'crouch'|'prone', proneBlend 0..1 (Trefferzonen
    // folgen der liegenden Pose), proneYaw (Körperachse beim Hinlegen)
    this.stance = 'stand';
    this.proneBlend = 0;
    this.proneYaw = 0;
    this._proneCheckAt = 0;
    this._proneOk = false;
    // Truppe (ai/squad.js): tsquad, ft (Feuerteam), role, order; Klasse/Gadget (main.equipActor setzt cls/classDef/armor)
    this.tsquad = null;
    this.ft = 0;
    this.role = null;
    this.order = null;
    this.gadget = null;
    this.atTarget = null;
    this._atCheckAt = 0;
    this._spotAt = 0;
    this._obstruct = 0;
    this._obsAt = 0;
    this._sup = { at: 0, ok: false, burst: 0, pauseUntil: 0, jit: new THREE.Vector3(), jitAt: 0, shots: 0 };
    // Simulations-Detailstufe (manager): Wahrnehmungs-/Entscheidungsrate × lodSense / × lodThink
    this.lodSense = 1;
    this.lodThink = 1;
    this.simEvery = 1;
    this.simPhase = (Math.random() * 12) | 0;
    this._simAcc = 0;
    // Lehnen (C6, gleiche Felder wie der Spieler): lean −1…1 (− = links), leanOffset (Welt, Kopfversatz), leanRoll (rad)
    this.lean = 0;
    this.leanOffset = new THREE.Vector3();
    this.leanRoll = 0;
    this.leanSide = 0; // letzte Prüfung: Seite mit Sicht auf das Ziel (−1/1), 0 = ohne Lehnen frei, null = keine
    this._leanWant = 0;
    this._leanCheckAt = 0;
    this._leanLimit = [1, 1];
    // Treffer-Reaktionen (C2): kurzes Taumeln (Bewegung/Abzug gedämpft), Hinken nach Beintreffer
    this.staggerUntil = 0;
    this.limpUntil = 0;
    this._staggerCd = 0;
    // Blendgranate (arsenal): gesetzt von grenades.js
    this.flashedUntil = 0;
    this.flashStrength = 0;

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
    this._goOpts = { tolerance: 1, repath: 1.5 };
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
      const s = new Soldier({ team: this.team, variant: this.variant, camo: this.scheme, quality: this.manager.tier || this.manager.quality, models: this.manager.models, name: this.name });
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

  /** Augenhöhe inkl. Lehn-Versatz (Sicht und Schüsse aus dem gelehnten Kopf, wie beim Spieler). */
  getEyePosition(out = new THREE.Vector3()) {
    const p = this.body.position, o = this.leanOffset;
    return out.set(p.x + o.x, p.y + this.body.height - 0.15 + o.y, p.z + o.z);
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
    // Trefferwirkung: Zielfehler + Reaktion des Körpers (C2)
    this.gunner.errX += (Math.random() - 0.5) * 0.06;
    this.gunner.errY += (Math.random() - 0.5) * 0.04;
    const amt = info.amount || 20;
    const s = this.soldier;
    if (s && info.dir) s.playHit(info.dir, info.zone, amt, info.point || null);
    if (info.dir && !info.explosive && this.alive) {
      // Taumeln: starke Treffer stoßen den Körper ein Stück in Schussrichtung, Abzug/Bewegung kurz gedämpft
      const k = clamp((amt - 14) / 40, 0, 1);
      if (k > 0 && now >= this._staggerCd) {
        const v = this.body.velocity, d = info.dir;
        const h = Math.hypot(d.x, d.z) || 1;
        v.x += (d.x / h) * 1.7 * k;
        v.z += (d.z / h) * 1.7 * k;
        this.staggerUntil = Math.max(this.staggerUntil, now + 0.1 + 0.32 * k * (1.15 - this.diff.tracking * 0.06));
        this._staggerCd = now + 0.55;
        this.gunner.errX += (Math.random() - 0.5) * 0.1 * k;
        this.gunner.errY += 0.05 * k;
      }
      // Beintreffer: kurz hinken (langsamer, kein Sprint)
      const py = info.point ? info.point.y - this.position.y : 1;
      if (info.zone === 'limb' && py < 0.95) this.limpUntil = now + 1.1 + Math.min(1, amt / 40);
    }
  }

  /** Blendgranate (Ereignis actor:flashed): Schutzhaltung, Ziel verloren, kurz orientierungslos. */
  onFlashed(strength = 1, duration = 2) {
    if (!this.alive) return;
    const s = this.soldier;
    if (s) s.playFlash(duration, strength);
    // gesehene Gegner sind nicht mehr sichtbar (Wahrnehmung setzt aus, solange flashedUntil läuft – perception.js)
    const list = this.memory.list;
    for (let i = 0; i < list.length; i++) { const r = list[i]; if (r.visible) { r.visible = false; r.spot = Math.min(r.spot, 0.6 * (1 - strength)); } }
    this.gunner.errX += (Math.random() - 0.5) * 0.4 * strength;
    this.gunner.errY += (Math.random() - 0.5) * 0.25 * strength;
    this._leanWant = 0;
  }

  /** Explosion in der Nähe (manager): Taumeln weg vom Zentrum, Stoß, Zielfehler. strength 0..1,5 */
  onBlast(dir, strength = 1) {
    if (!this.alive || !dir) return;
    const s = this.soldier;
    if (s) s.playStagger(dir, strength);
    const now = this.G.time.elapsed;
    const v = this.body.velocity;
    v.x += dir.x * 2.6 * strength;
    v.z += dir.z * 2.6 * strength;
    this.staggerUntil = Math.max(this.staggerUntil, now + 0.25 + 0.5 * Math.min(1, strength));
    this.gunner.errX += (Math.random() - 0.5) * 0.25 * strength;
    this.gunner.errY += (Math.random() - 0.5) * 0.18 * strength;
    this._leanWant = 0;
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
    this.stance = 'stand';
    this.atTarget = null;
    if (this.order) this.order.kind = null;
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
    this.lean = 0; this.leanRoll = 0; this.leanOffset.set(0, 0, 0); this._leanWant = 0; this.leanSide = 0;
    this.staggerUntil = this.limpUntil = this._staggerCd = 0;
    this.flashedUntil = 0; this.flashStrength = 0;
    this.stance = 'stand'; this.proneBlend = 0; this._proneOk = false;
    this.atTarget = null; this._obstruct = 0; this._simAcc = 0;
    if (this.order) this.order.kind = null;
    const gd = this.classDef && this.classDef.gadget ? GADGETS[this.classDef.gadget] : null;
    this.gadget = gd ? { id: gd.id, charges: gd.charges || 1, max: gd.charges || 1, cooldownUntil: 0 } : null;
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
      this._senseT += (1 / (D.senseHz * this.lodSense)) * rnd(0.85, 1.15);
      sense(this, now, this._senseDt);
      this._senseDt = 0;
      if (this.cls === 'aufklaerer' && now >= this._spotAt) this._spotEnemy(now);
      // gerade entdeckt → sofort neu entscheiden
      const rec = gunner.selectTarget(now);
      if (rec && (!gunner.rec || gunner.rec.actor !== rec.actor) && goal.kind !== 'engage') this._thinkT = Math.min(this._thinkT, 0.05);
    }
    if (!frozen) {
      this._thinkT -= dt;
      if (this._thinkT <= 0) {
        this._thinkT = D.thinkInterval * this.lodThink * rnd(0.85, 1.15);
        think(this, now);
      }
      this._streakT -= dt;
      if (this._streakT <= 0) { this._streakT = rnd(1.8, 3); if (this.manager.handlesStreaks) useStreaks(this, now); }
    }

    // --- Zielen / Blick
    let angErr = Infinity;
    const tp = this.throwPlan;
    const rec = gunner.rec;
    const ord = this.order && this.order.kind && now < this.order.until ? this.order : null;
    let suppressing = false;
    if (!frozen && now >= this._atCheckAt) this._findArmor(now);
    if (tp) {
      gunner.look(dt, tp.yaw, tp.pitch, 1.2);
    } else if (this.atTarget) {
      angErr = this._aimArmor(dt, now);
    } else if (rec && rec.actor.alive && (rec.visible || now - rec.seenAt < 1.0)) {
      angErr = gunner.aim(dt, now);
    } else if (ord && ord.suppress && !frozen && this._suppressOk(now, ord)) {
      angErr = this._aimSuppress(dt, now, ord);
      suppressing = true;
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
        const hold = goal.hold && goal.hasMove;
        const toCover = (this.coverNode || hold) && goal.hasMove && this.position.distanceTo(goal.move) > (hold ? 1.3 : 0.7) && (hold || rec.pos.distanceTo(this.position) > 8);
        if (toCover) {
          this.nav.goTo(goal.move, GO_COVER);
          const d = this.nav.update(dt, now, true);
          mx = d.x; mz = d.z; speedKind = 'run';
        } else if (hold) {
          // Stellung halten (Truppbefehl): nur ducken/spähen, nicht vorgehen
          this.nav.update(dt, now, false);
          if (ord && ord.stance === 'crouch') em.crouch = true;
        } else if (em.nav) {
          this.nav.goTo(em.nav, GO_ENGAGE);
          const d = this.nav.update(dt, now, true);
          mx = d.x; mz = d.z; speedKind = em.sprint ? 'sprint' : 'run';
        } else {
          mx = em.x; mz = em.z; speedKind = 'walk';
          this.nav.update(dt, now, false);
          // direkte Gefechtsbewegung (bots-scale): nicht in die Wand drücken, sondern an ihr entlang
          const wn = body.wallNormal;
          if (wn) { const k = mx * wn.x + mz * wn.z; if (k < 0) { mx -= wn.x * k * 1.1; mz -= wn.z * k * 1.1; } }
        }
        wantCrouch = em.crouch;
        wantJump = em.jump;
      } else if (goal.kind === 'squad' && ord && ord.stance === 'crouch' && !goal.hasMove) {
        wantCrouch = true; // warten auf den Einsatz (Stapel)
        this.nav.update(dt, now, false);
      } else if (goal.hasMove) {
        this._goOpts.tolerance = goal.tolerance;
        this._goOpts.repath = goal.repath || 1.5;
        this.nav.goTo(goal.move, this._goOpts);
        const d = this.nav.update(dt, now, !this.nav.arrived);
        if (!this.nav.arrived) { mx = d.x; mz = d.z; }
        wantCrouch = goal.crouch && this.nav.arrived;
        if (goal.kind === 'cover' || goal.kind === 'heal') wantCrouch = this.nav.arrived && !!(this.coverNode && !this.coverNode.coverHigh);
        if (goal.kind === 'squad' && ord && ord.stance === 'crouch' && (this.nav.arrived || this.position.distanceTo(goal.move) < 1.6)) wantCrouch = true;
      }
      if (this.nav.jump) wantJump = true;
      // lokales Ausweichen
      const sep = this._separation(_w);
      mx += sep.x; mz += sep.z;
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
    }

    // Taumeln/Blendung (C2/C6): Eigenbewegung gedämpft, geblendet kaum (orientierungslos)
    const staggered = now < this.staggerUntil;
    const blinded = this.flashedUntil > now;
    if (staggered) { mx *= 0.25; mz *= 0.25; wantJump = false; }
    if (blinded) { mx *= 0.3; mz *= 0.3; wantJump = false; if (this.flashStrength > 0.6) wantCrouch = true; }
    // Lehnen: im Stand an Deckungskanten statt Seitschritt (Wunsch aus dem Gefecht bzw. Sichtprüfung)
    if (!frozen) this._updateLean(dt, now, rec, Math.hypot(mx, mz));
    if (Math.abs(this.lean) > 0.25) { mx *= 0.15; mz *= 0.15; }

    this._mx = mx; this._mz = mz; // gewünschte Bewegung (Diagnose: gegen die Wand laufen)
    // Haltung (Liegen: Truppbefehl, Scharfschützen, unter Beschuss auf Distanz)
    if (!frozen) this._updateStance(dt, now, rec, Math.hypot(mx, mz), ord, wantCrouch);
    if (this.proneBlend > 0.05) { const k = this.stance === 'prone' ? 0.6 : 1 - this.proneBlend; mx *= k; mz *= k; wantJump = false; }
    if (this.stance === 'prone') wantCrouch = false;

    // Tempo
    const def = w ? w.currentDef : null;
    const ads = w ? w.adsProgress || 0 : 0;
    const moveLen = Math.hypot(mx, mz);
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const facing = moveLen > 0.1 ? (mx * fwdX + mz * fwdZ) / moveLen : 0;
    const limping = now < this.limpUntil;
    let sprint = speedKind === 'sprint' && facing > 0.8 && ads < 0.1 && (!w || w.canSprint !== false) && body.onGround && !wantCrouch && now - (w ? w.lastShotTime : 0) > 0.4 && !limping && !staggered && Math.abs(this.lean) < 0.1;
    if (sprint && rec && rec.visible) sprint = false;
    this.sprinting = sprint && moveLen > 0.3;
    if (this.stance === 'prone' || this.proneBlend > 0.3) this.sprinting = false;
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) this.crouching = true;
      else if (body.canStand(world)) this.crouching = false;
    }
    if (this.stance !== 'prone') this.stance = this.crouching ? 'crouch' : 'stand';
    const prone = this.stance === 'prone' || this.proneBlend > 0.3;
    const base = prone ? SPEED.crawl : this.crouching ? SPEED.crouch : this.sprinting ? SPEED.sprint : SPEED[speedKind === 'sprint' ? 'run' : speedKind] || SPEED.run;
    const arm = this.armor;
    const armMult = arm ? (this.sprinting ? arm.sprintMult || arm.speedMult || 1 : arm.speedMult || 1) : 1;
    const mult = (def && def.moveSpeedMult ? def.moveSpeedMult : 1) * (1 + ((def && def.adsMoveMult ? def.adsMoveMult : 0.6) - 1) * ads) * (limping ? 0.62 : 1) * armMult;
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
    const targetH = this.stance === 'prone' ? PRONE_H : this.crouching ? CROUCH_H : STAND_H;
    if (targetH > body.height + 1e-3) {
      const next = Math.min(targetH, body.height + (targetH - body.height) * (1 - Math.exp(-16 * dt)) + 0.01);
      if (body.canStand(world, next)) body.setHeight(next); else this.crouching = true;
    } else if (targetH < body.height - 1e-3) body.setHeight(body.height + (targetH - body.height) * (1 - Math.exp(-18 * dt)));
    const wasGround = body.onGround;
    const vyBefore = v.y;
    body.step(dt, world, STEP_OPTS);
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
    it.fire = it.firePressed = it.reload = it.swap = it.grenade = it.grenadeHeld = it.melee = it.cancelReload = it.tactical = it.tacticalHeld = false;
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
    it.prone = this.stance === 'prone';
    if (!frozen && w) {
      if (tp) this._throw(now, it);
      else if (this.atTarget && !staggered && !blinded) this._fireArmor(now, it, angErr);
      else if (rec && !staggered && !blinded) gunner.trigger(dt, now, angErr, it);
      else if (suppressing && !staggered && !blinded) this._suppressFire(now, it, angErr, ord);
      if (this.proneBlend > 0.15 && this.proneBlend < 0.85) { it.fire = it.firePressed = false; } // beim Hinlegen/Aufstehen kein Schuss
      if (this.atTarget) {
        // Werfer ziehen (Panzerabwehr)
        const li = this._launcherSlot();
        if (li >= 0 && w.index !== li && !w.isSwitching && now - (this._swapAt || 0) > 0.8) { it.slot = li + 1; this._swapAt = now; }
      } else if (!rec || !rec.visible) {
        if (this.wantReload && !suppressing) { it.reload = true; this.wantReload = false; }
        // zurück zur Hauptwaffe
        if (w.index === 1 && w.slots.length > 1 && !w.isSwitching && now - (this._swapAt || 0) > 2) { it.slot = 1; this._swapAt = now; }
      } else if (D.swapToPistol && w.index === 0 && w.slots.length > 1 && w.current && w.current.mag === 0 && rec.pos.distanceTo(this.position) < 14 && !w.isSwitching && w.slots[1].mag > 0 && !(w.slots[1].def && w.slots[1].def.cls === 'launcher')) {
        it.slot = 2; this._swapAt = now;
      } else if (w.currentDef && w.currentDef.cls === 'launcher' && !w.isSwitching && now - (this._swapAt || 0) > 1) {
        it.slot = 1; this._swapAt = now; // Werfer nie gegen Infanterie
      }
      if (this.sprinting) it.ads = false;
    }
    if (w) {
      w.update(dt, it);
      if (w.lastShotTime !== this._shotSeen) { this._shotSeen = w.lastShotTime; if (now - w.lastShotTime < 0.1) this._shotPending++; }
      if (w.currentDef && w.currentDef.id !== this._gunId) this._syncGun();
    }

    // Sanitäter: Verbandskasten für den Verwundeten bzw. sich selbst
    if (!frozen && this.gadget && this.gadget.id === 'medkit' && this.gadget.charges > 0 && now >= this.gadget.cooldownUntil) this._medkit(now, ord);

    // --- Darstellung
    this._animate(dt, now);
  }

  /* ================================================================ Haltung (bots-scale) */

  /** Hinlegen/Aufstehen: Wunsch aus Truppbefehl, Klasse und Lage; Platz hinter dem Körper geprüft (Beine 1,6 m). */
  _updateStance(dt, now, rec, moveLen, ord, wantCrouch) {
    const D = this.diff;
    let want = false;
    if (D.prone > 0 && moveLen < 0.15 && this.body.onGround && !this.throwPlan && !this.atTarget && this.flashedUntil <= now) {
      const def = this.weapon && this.weapon.currentDef;
      const sniper = !!def && (def.cls === 'sniper' || def.cls === 'marksman');
      const d = rec ? rec.pos.distanceTo(this.position) : 0;
      const atOrder = ord && ord.stance === 'prone' && (!ord.hasPos || this.position.distanceTo(ord.pos) < 1.6);
      if (atOrder) want = true;
      else if (sniper && D.prone >= 0.5 && rec && d > 35) want = true;
      else if (D.prone >= 1 && rec && rec.visible && d > 38 && now - this.lastDamageTime < 3 && !this.coverNode && (this.role === 'mg' || this.role === 'marksman' || this.role === 'rifleman')) want = true;
      else if (this.stance === 'prone' && rec && now - (rec.seenAt || 0) < 4 && !wantCrouch) want = true; // liegen bleiben
      if (want && rec) {
        const yaw = Math.atan2(-(rec.pos.x - this.position.x), -(rec.pos.z - this.position.z));
        if (this.stance === 'prone' && Math.abs(wrap(yaw - this.proneYaw)) > PRONE_YAW) want = false;
      }
      if (want && rec && rec.pos.distanceTo(this.position) < 9) want = false;
    }
    const prev = this.stance;
    if (want && prev !== 'prone') {
      if (now >= this._proneCheckAt) { this._proneCheckAt = now + 1; this._proneOk = this._proneSpace(); }
      if (this._proneOk) {
        this.stance = 'prone';
        this._proneSince = now;
        this.proneYaw = rec && rec.visible ? Math.atan2(-(rec.pos.x - this.position.x), -(rec.pos.z - this.position.z)) : this.yaw;
        this.crouching = false;
        this.G.events.emit('player:stance', { actor: this, stance: 'prone', prev, duration: PRONE_TIME });
        if (this.tsquad) this.manager.tactics.emit(this.tsquad, 'prone', { role: this.role });
      }
    } else if (!want && prev === 'prone' && (moveLen > 0.15 || now - this._proneSince > 2.5 || (rec && rec.pos.distanceTo(this.position) < 9))) {
      if (this.body.canStand(this.G.world, CROUCH_H)) {
        this.stance = 'crouch';
        this.crouching = true;
        this.G.events.emit('player:stance', { actor: this, stance: 'crouch', prev, duration: PRONE_TIME });
      }
    }
    const target = this.stance === 'prone' ? 1 : 0;
    const step = dt / PRONE_TIME;
    this.proneBlend = target > this.proneBlend ? Math.min(1, this.proneBlend + step) : Math.max(0, this.proneBlend - step * 0.82);
    // liegend: Blick im Schussfeld halten
    if (this.stance === 'prone') {
      const dy = wrap(this.yaw - this.proneYaw);
      if (Math.abs(dy) > PRONE_YAW + 0.1) this.yaw = this.proneYaw + Math.sign(dy) * (PRONE_YAW + 0.1);
    }
  }

  /** Platz zum Liegen? Boden hinter dem Körper eben, keine Wand auf 1,7 m nach hinten (zwei Strahlen auf Hüfthöhe). */
  _proneSpace() {
    const W = this.G.world;
    if (!W || typeof W.raycast !== 'function') return false;
    const p = this.body.position;
    const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw); // hinter dem Blick
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    _ld.set(bx, 0, bz);
    for (const s of [-0.22, 0.22]) {
      _lp.set(p.x + rx * s, p.y + 0.3, p.z + rz * s);
      const h = W.raycast(_lp, _ld, 1.75);
      if (h && h.distance < 1.7) return false;
    }
    if (typeof W.groundHeight === 'function') {
      for (const k of [0.8, 1.5]) {
        const g = W.groundHeight(p.x + bx * k, p.z + bz * k, p.y + 0.6);
        if (g === null || Math.abs(g - p.y) > 0.35) return false;
      }
    }
    return true;
  }

  /* ================================================================ Niederhalten (bots-scale) */

  /** Niederhalten möglich? Automatische Waffe, Munition, Schusslinie endet nahe der Feindposition (gedrosselt geprüft). */
  _suppressOk(now, ord) {
    const w = this.weapon;
    const def = w && w.currentDef;
    if (!def || !SUPPRESS_CLS.has(def.cls) || (def.fireMode && def.fireMode !== 'auto') || w.isReloading || !w.current || w.current.mag <= 0) return false;
    const sp = this._sup;
    if (now >= sp.at) {
      sp.at = now + 0.45;
      const W = this.G.world;
      const eye = this.getEyePosition(_eye);
      _v.subVectors(ord.supPos, eye);
      const d = _v.length();
      sp.ok = d > 8 && d < 130;
      if (sp.ok && W && typeof W.raycast === 'function') {
        _v.multiplyScalar(1 / d);
        const h = W.raycast(eye, _v, d);
        sp.ok = !h || h.distance > d - 4;
      }
      if (sp.ok) sp.ok = this.manager.lineOfFireClear(this, ord.supPos);
    }
    return sp.ok;
  }

  _aimSuppress(dt, now, ord) {
    const sp = this._sup;
    if (now >= sp.jitAt) { sp.jitAt = now + rnd(0.5, 1.1); sp.jit.set(rnd(-1.6, 1.6), rnd(-0.5, 0.6), rnd(-1.6, 1.6)); }
    const eye = this.getEyePosition(_eye);
    _v.copy(ord.supPos).add(sp.jit).sub(eye);
    const yaw = Math.atan2(-_v.x, -_v.z);
    const pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    this.gunner.look(dt, yaw, pitch, 0.9);
    return Math.abs(wrap(yaw - this.yaw)) + Math.abs(pitch - this.pitch);
  }

  /** Feuerstöße auf die letzte bekannte Feindposition (ohne Sicht auf ein Ziel). */
  _suppressFire(now, it, angErr, ord) {
    const sp = this._sup;
    const w = this.weapon;
    if (angErr > 0.06 || !w || w.isSwitching || w.isThrowing) return;
    if (sp.burst <= 0) {
      if (now < sp.pauseUntil) return;
      sp.burst = 3 + ((Math.random() * 4) | 0);
    }
    it.fire = true;
    if (w.lastShotTime !== sp.last && w.lastShotTime > now - 0.2) {
      sp.last = w.lastShotTime;
      sp.shots++;
      if (--sp.burst <= 0) sp.pauseUntil = now + rnd(0.55, 1.2);
    }
    if (w.current && w.current.mag <= 2) this.wantReload = true;
    void ord;
  }

  /* ================================================================ Panzerabwehr (Pionier) */

  _launcherSlot() {
    const w = this.weapon;
    if (!w || !w.slots) return -1;
    for (let i = 0; i < w.slots.length; i++) { const s = w.slots[i]; if (s && s.def && s.def.cls === 'launcher' && (s.mag > 0 || s.reserve > 0)) return i; }
    return -1;
  }

  /** Feindliches, besetztes Fahrzeug in Reichweite mit Sicht? (nur mit Werfer; alle 0,5 s) */
  _findArmor(now) {
    this._atCheckAt = now + 0.5;
    const V = this.G.vehicles;
    if (!V || !Array.isArray(V.list) || !V.list.length || this._launcherSlot() < 0) { this.atTarget = null; return; }
    const cur = this.atTarget;
    if (cur && (!cur.alive || cur.wreck || !cur.isOccupied)) this.atTarget = null;
    if (this.atTarget) return;
    const W = this.G.world;
    const eye = this.getEyePosition(_eye);
    let best = null, bd = 140;
    for (const v of V.list) {
      if (!v.alive || v.wreck || !v.isOccupied || !v.hostileTo(this)) continue;
      const p = v.position;
      const d = p.distanceTo(this.position);
      if (d >= bd || d < 12) continue;
      _lp.copy(p).setY(p.y + 1.3);
      if (W && W.lineOfSight && !W.lineOfSight(eye, _lp)) continue;
      bd = d; best = v;
    }
    if (best && this.atTarget !== best && this.tsquad) this.manager.tactics.emit(this.tsquad, 'at', { d: Math.round(bd) });
    this.atTarget = best;
  }

  _aimArmor(dt, now) {
    const v = this.atTarget;
    const eye = this.getEyePosition(_eye);
    const p = v.position;
    const d = p.distanceTo(eye);
    const t = d / 120; // Flugzeit grob (70 → 150 m/s)
    const vel = v.body && v.body.velocity;
    _v.set(p.x + (vel ? vel.x * t : 0), p.y + 1.1 + d * 0.004, p.z + (vel ? vel.z * t : 0)).sub(eye);
    const yaw = Math.atan2(-_v.x, -_v.z);
    const pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    this.gunner.look(dt, yaw, pitch, 1.1);
    void now;
    return Math.abs(wrap(yaw - this.yaw)) + Math.abs(pitch - this.pitch);
  }

  _fireArmor(now, it, angErr) {
    const w = this.weapon;
    const def = w && w.currentDef;
    if (!def || def.cls !== 'launcher' || w.isSwitching || w.isReloading) return;
    it.ads = true;
    if (!w.current || w.current.mag <= 0) { it.reload = true; return; }
    if (angErr < 0.03 && (w.adsProgress || 0) > 0.7 && now - (this._atShotAt || 0) > 1.5) {
      it.firePressed = true;
      this._atShotAt = now;
      if (this.tsquad) this.manager.tactics.emit(this.tsquad, 'at_fire', {});
    }
  }

  /* ================================================================ Sanitäter / Aufklärer */

  _medkit(now, ord) {
    const g = this.gadget;
    const mate = ord && ord.kind === 'medic' ? ord.target : null;
    const G = this.G;
    if (mate && mate.alive && mate.health < mate.maxHealth && mate.position.distanceTo(this.position) < 4) {
      const amount = Math.min(45, mate.maxHealth - mate.health);
      mate.health += amount;
      g.charges--;
      g.cooldownUntil = now + 1.2;
      G.events.emit('gadget:use', { actor: this, id: 'medkit', charges: g.charges });
      G.events.emit('gadget:heal', { actor: this, target: mate, amount });
      if (this.tsquad) this.manager.tactics.emit(this.tsquad, 'heal', { amount: Math.round(amount) });
      if (this.order) this.order.kind = null;
      return;
    }
    if (this.health < 45 && (!this.gunner.rec || !this.gunner.rec.visible)) {
      const amount = Math.min(60, this.maxHealth - this.health);
      this.health += amount;
      g.charges--;
      g.cooldownUntil = now + 2;
      G.events.emit('gadget:use', { actor: this, id: 'medkit', charges: g.charges });
      G.events.emit('gadget:heal', { actor: this, target: this, amount });
    }
  }

  /** Aufklärer: entdeckten Gegner auf Distanz markieren (Ereignis spot, Teamfunk ohne Verzögerung), höchstens alle 4 s. */
  _spotEnemy(now) {
    const list = this.memory.list;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const a = r.actor;
      if (!r.visible || r.spot < 1 || !a.alive || a.isStreakEntity || (a.spottedUntil || 0) > now) continue;
      if (r.pos.distanceTo(this.position) < 25) continue;
      a.spottedUntil = now + 8;
      this._spotAt = now + 4;
      this.manager.callout(this, a, r.pos, now - 0.8);
      this.G.events.emit('spot', { actor: this, target: a, until: now + 8, team: this.team });
      if (this.tsquad) this.manager.tactics.emit(this.tsquad, 'spot', {});
      return;
    }
    this._spotAt = now + 1;
  }

  /** Waffe an der Wand (bots-scale): Strahlen von der rechten Schulter (echte Lage der Waffe, auch geduckt/liegend)
   *  entlang Zielrichtung und entlang der Waffe zur Mündung, gedrosselt, nur für nahe sichtbare Bots. → 0..1 */
  _obstructAmount(now) {
    if (!this.inView || this.camDist > 45) return 0;
    if (now < this._obsAt) return this._obstruct;
    this._obsAt = now + 0.12;
    const W = this.G.world;
    const def = this.weapon && this.weapon.currentDef;
    const s = this.soldier;
    if (!W || typeof W.raycast !== 'function' || !def || def.cls === 'melee' || !s) { this._obstruct = 0; return 0; }
    const reach = def.cls === 'pistol' ? 0.65 : def.cls === 'sniper' || def.cls === 'lmg' || def.cls === 'launcher' ? 1.3 : 1.05;
    // Schulter (Pose des letzten Frames) – Waffe liegt rechts der Kapselachse und je nach Haltung tiefer
    s.joint(BONE.upperArmR, _lp);
    this.getAimDirection(_ld);
    let d = reach + 0.1;
    let h = W.raycast(_lp, _ld, d);
    if (h) d = h.distance;
    // zweiter Strahl entlang der tatsächlichen Waffe (Pose weicht vom Zielvektor ab), auf volle Länge verlängert
    s.getMuzzlePosition(_le).sub(_lp);
    const L = _le.length();
    if (L > 0.15 && _le.dot(_ld) > 0.8 * L) { // nur solange die Waffe noch im Anschlag liegt (sonst Decke → Selbsthalt)
      _le.multiplyScalar(1 / L);
      h = W.raycast(_lp, _le, reach + 0.1);
      if (h && h.distance < d) d = h.distance;
    }
    // Kapselachse → Schulter: steckt die Schulter selbst schon in der Wand (Ecke), ganz hochnehmen
    const p = this.body.position;
    _lh.set(p.x + this.leanOffset.x, _lp.y, p.z + this.leanOffset.z);
    _v.subVectors(_lp, _lh);
    const sl = _v.length();
    if (sl > 0.02 && W.raycast(_lh, _v.multiplyScalar(1 / sl), sl + 0.05)) d = 0;
    this._obstruct = clamp((reach + 0.1 - d) / (reach * 0.7), 0, 1);
    return this._obstruct;
  }

  /* ================================================================ Lehnen (C6) */

  /**
   * Lehnen statt Seitschritt an Deckungskanten: Ist das Ziel (bzw. seine letzte Position) aus dem Kopf nicht zu sehen,
   * aus einem um ±0,34 m versetzten Kopf aber schon, lehnt sich der Bot zu dieser Seite (gedrosselt geprüft, aus dem
   * Strahlenbudget). Gefechtsmodus „Spähen“ an hoher Deckung setzt den Wunsch über gunner.peekLean (0 = verdeckt
   * bleiben). Wände begrenzen die Auslenkung (Kopf bleibt außerhalb). Ergebnis: lean, leanOffset, leanRoll.
   */
  _updateLean(dt, now, rec, moveLen) {
    const w = this.weapon;
    const body = this.body;
    const busy = !w || w.isReloading || w.isThrowing || w.isMeleeing || w.isSwitching;
    const can = body.onGround && !this.sprinting && moveLen < 0.6 && !busy && this.flashedUntil <= now && now >= this.staggerUntil &&
      !!rec && rec.actor.alive && now - (rec.seenAt || -1e9) < 3.5 && Math.hypot(body.velocity.x, body.velocity.z) < 2.2;
    let want = 0;
    if (can) {
      if (now >= this._leanCheckAt) {
        this._leanCheckAt = now + 0.28 + Math.random() * 0.14;
        this.leanSide = this._leanProbe(rec);
      }
      const peek = this.gunner.peekLean;
      if (peek === 0) want = 0; // Spähen: gerade in Deckung
      else if (this.leanSide === -1 || this.leanSide === 1) want = this.leanSide;
    } else if (busy && Math.abs(this.lean) > 0.05) {
      want = 0; // zum Nachladen/Werfen zurück in Deckung
    }
    // Wandbegrenzung je Seite (aus der letzten Prüfung)
    if (want < 0) want = -Math.min(1, this._leanLimit[0]);
    else if (want > 0) want = Math.min(1, this._leanLimit[1]);
    this._leanWant = want;
    this.lean += (want - this.lean) * (1 - Math.exp(-LEAN_RATE * dt));
    if (Math.abs(this.lean) < 1e-3) this.lean = 0;
    // Kopfversatz (Welt) im Körperrahmen der Figur (Hüftgierung folgt dem Ziel mit Totzone): rechts = (cos, 0, −sin)
    const yaw = this._leanYaw();
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const a = this.lean * LEAN_SIDE;
    this.leanOffset.set(rx * a, -Math.abs(this.lean) * LEAN_DROP, rz * a);
    this.leanRoll = -this.lean * 0.38;
  }

  /** Gierung, um die die Figur lehnt (Körper der sichtbaren Figur, sonst Blick). */
  _leanYaw() {
    const s = this.soldier;
    return s && s.state === 'alive' && Number.isFinite(s.anim.bodyYaw) ? s.anim.bodyYaw : this.yaw;
  }

  /** Sichtprüfung für das Lehnen → 0 (ohne Lehnen frei), −1/1 (diese Seite frei), null (keine). Max. 3 + 2 Strahlen. */
  _leanProbe(rec) {
    const W = this.G.world;
    const mgr = this.manager;
    if (!W || !W.lineOfSight) return null;
    const p = this.body.position;
    const eye = _le.set(p.x, p.y + this.body.height - 0.15, p.z);
    const a = rec.actor;
    if (rec.visible && a.alive) targetPoints(a, _lp, _lh);
    else _lp.copy(rec.pos).setY(rec.pos.y + 1.2);
    if (!mgr.takeLos()) return this.leanSide;
    if (W.lineOfSight(eye, _lp)) return 0;
    // Seite zuerst, die zum Ziel zeigt (Ziel rechts vom Blick → rechts lehnen)
    const yaw = this._leanYaw();
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const side0 = ((_lp.x - p.x) * rx + (_lp.z - p.z) * rz) >= 0 ? 1 : -1;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? side0 : -side0;
      // Wand neben dem Kopf? Auslenkung begrenzen (Kopf 8 cm vor der Wand)
      let lim = 1;
      if (typeof W.raycast === 'function') {
        _ld.set(rx * side, 0, rz * side);
        const hit = W.raycast(eye, _ld, LEAN_SIDE + 0.12);
        if (hit && hit.distance < LEAN_SIDE + 0.12) lim = Math.max(0, (hit.distance - 0.08) / LEAN_SIDE);
      }
      this._leanLimit[side < 0 ? 0 : 1] = lim;
      if (lim < 0.55) continue;
      if (!mgr.takeLos()) return this.leanSide;
      const e2 = _ld.set(eye.x + rx * side * LEAN_SIDE * lim, eye.y - LEAN_DROP, eye.z + rz * side * LEAN_SIDE * lim);
      if (W.lineOfSight(e2, _lp)) return side;
    }
    return null;
  }

  _throw(now, it) {
    const tp = this.throwPlan;
    const w = this.weapon;
    if (!tp.started) {
      const ey = Math.abs(wrap(tp.yaw - this.yaw)), ep = Math.abs(tp.pitch - this.pitch);
      if ((ey < 0.07 && ep < 0.07) || now - tp.at > 1.2) {
        if (tp.slot === 'tactical') { it.tactical = true; it.tacticalHeld = tp.cook > 0; } else it.grenade = true;
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
    const actors = this.G.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
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
    if (every === 0 || (every > 1 && this._animFrame % every !== 0)) {
      s.place(this.body.position, s.anim.bodyYaw);
      return;
    }
    // aufgelaufene Zeit (gedrosselte Rate); begrenzt, damit Schrittzyklus/Gesten nicht springen
    const adt = Math.min(this._animAcc, ANIM_MAX_STEP);
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
    p.lean = this.lean;
    p.prone = this.stance === 'prone';
    p.proneYaw = this.proneYaw;
    p.obstruct = this._obstructAmount(now);
    p.position = this.body.position;
    s.animate(adt, p);
    // Schritte (synchron zum Aufsetzen der Füße)
    if (s.anim.events.footstep >= 0) this.manager.footstep(this);
  }

  _updateCorpses(dt) {
    const world = this.G.world;
    for (let i = 0; i < this.soldiers.length; i++) { const s = this.soldiers[i]; if (s && s.state === 'dead') s.updateDead(dt, world); }
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
