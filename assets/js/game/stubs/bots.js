// NULLPUNKT — Stub für bots/manager.js (§8): einfache Kastensoldaten mit CapsuleBody, die über den
// NavGraph patrouillieren, Gegner sehen/hören, mit Reaktionszeit und Zielfehler in Feuerstößen über
// ihren WeaponController (→ G.combat) schießen, seitlich ausweichen, bei wenig Leben Deckung suchen,
// sterben (Umfallen) und vom Hauptprogramm wiederbelebt werden (respawn).

import * as THREE from 'three';
import { CapsuleBody } from '../engine/physics.js';
import { raycastHumanoid } from '../combat.js';
import * as stubModels from './models.js';

export const DIFFICULTY = {
  rekrut: { reaction: 0.75, aimError: 0.09, turn: 3.2, burst: [0.15, 0.35], pause: [0.5, 0.9], damage: 0.55, sight: 40, fov: 1.6, headshot: 0.05 },
  regulaer: { reaction: 0.5, aimError: 0.06, turn: 4.6, burst: [0.2, 0.5], pause: [0.35, 0.7], damage: 0.75, sight: 55, fov: 1.9, headshot: 0.12 },
  veteran: { reaction: 0.32, aimError: 0.04, turn: 6.5, burst: [0.3, 0.7], pause: [0.25, 0.5], damage: 0.9, sight: 70, fov: 2.1, headshot: 0.2 },
  elite: { reaction: 0.2, aimError: 0.025, turn: 9, burst: [0.4, 0.9], pause: [0.15, 0.35], damage: 1.0, sight: 85, fov: 2.3, headshot: 0.3 },
};

const NAMES = ['Falke', 'Wolf', 'Kobra', 'Specht', 'Luchs', 'Dachs', 'Bussard', 'Fuchs', 'Rabe', 'Iltis', 'Otter', 'Marder', 'Hornisse', 'Viper', 'Adler', 'Habicht', 'Keiler', 'Sperber', 'Elster', 'Kranich'];
const TEAM_COLORS = { A: [0x3d6a8f, 0x24435c], B: [0x9a4a2e, 0x5c2c1c], null: [0x6d6a45, 0x3f3d28] };

const _v = new THREE.Vector3();
const _to = new THREE.Vector3();
const _eye = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class BotManager {
  constructor(G) {
    this.G = G;
    this.bots = [];
    this._subs = null;
    this._shared = null;
    this._serial = 0;
  }

  attach(G) {
    this.G = G;
    this.detach();
    const s = (this._subs = G.events.scope());
    // Hören: Schüsse und Sprintschritte verraten die Position
    s.on('weapon:fire', ({ actor, suppressed }) => {
      if (!actor || suppressed) return;
      for (const b of this.bots) if (b.alive && b !== actor && G.combat.isHostile(b, actor)) b.hear(actor, 42);
    });
    s.on('footstep', ({ actor, sprint }) => {
      if (!actor || !sprint) return;
      for (const b of this.bots) if (b.alive && b !== actor && G.combat.isHostile(b, actor)) b.hear(actor, 11);
    });
  }

  detach() {
    this.removeAll();
    if (this._subs) this._subs.dispose();
    this._subs = null;
    if (this._shared) {
      this._shared.box.dispose();
      for (const m of Object.values(this._shared.mats)) m.dispose();
      this._shared = null;
    }
  }

  _sharedRes() {
    if (this._shared) return this._shared;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mats = {
      skin: new THREE.MeshStandardMaterial({ color: 0xc99a7a, roughness: 0.75 }),
      boots: new THREE.MeshStandardMaterial({ color: 0x1e1d1b, roughness: 0.9 }),
      pants: new THREE.MeshStandardMaterial({ color: 0x4a4a3c, roughness: 0.95 }),
    };
    for (const team of ['A', 'B', 'null']) {
      mats[`vest_${team}`] = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team][0], roughness: 0.85 });
      mats[`helmet_${team}`] = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team][1], roughness: 0.6, metalness: 0.2 });
    }
    mats.marker = new THREE.MeshBasicMaterial({ color: 0x38b6ff, depthTest: false, transparent: true, opacity: 0.9 });
    this._shared = { box, mats };
    return this._shared;
  }

  spawnBots({ allies = 0, enemies = 0, ffa = false, difficulty = 'regulaer', modeId = 'tdm' } = {}) {
    const G = this.G;
    const created = [];
    const loadouts = (G.data && G.data.DEFAULT_LOADOUTS) || [{ primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag' }];
    const used = new Set(G.actors.map((a) => a.name));
    const pickName = () => {
      const free = NAMES.filter((n) => !used.has(n));
      const n = free.length ? free[(Math.random() * free.length) | 0] : `Bot ${++this._serial}`;
      used.add(n);
      return n;
    };
    const make = (team) => {
      const lo = loadouts[(Math.random() * loadouts.length) | 0];
      const bot = new Bot(this, { team, name: pickName(), difficulty, loadout: { primary: lo.primary, secondary: lo.secondary, lethal: lo.lethal }, modeId });
      bot.castShadows = this.bots.length < ((G.renderer && G.renderer.preset && G.renderer.preset.maxBotsVisibleShadows) ?? 8);
      bot.applyShadows();
      this.bots.push(bot);
      if (!G.actors.includes(bot)) G.actors.push(bot);
      created.push(bot);
    };
    if (ffa) for (let i = 0; i < allies + enemies; i++) make(null);
    else {
      for (let i = 0; i < allies; i++) make('A');
      for (let i = 0; i < enemies; i++) make('B');
    }
    return created;
  }

  removeAll() {
    const G = this.G;
    for (const b of this.bots) {
      b.dispose();
      const i = G.actors.indexOf(b);
      if (i >= 0) G.actors.splice(i, 1);
    }
    this.bots = [];
  }

  update(dt) {
    for (const b of this.bots) b.update(dt);
  }
}

class Bot {
  constructor(manager, { team, name, difficulty, loadout, modeId }) {
    const G = manager.G;
    this.manager = manager;
    this.G = G;
    this.id = `bot_${++manager._serial}`;
    this.name = name;
    this.team = team;
    this.isPlayer = false;
    this.isBot = true;
    this.alive = false;
    this.health = 100;
    this.maxHealth = 100;
    this.body = new CapsuleBody({ radius: 0.35, height: 1.8 });
    this.position = this.body.position;
    this.yaw = 0;
    this.pitch = 0;
    this.loadout = loadout;
    this.lastDamageTime = -1e9;
    this.lastFiredTime = -1e9;
    this.stats = { kills: 0, deaths: 0, assists: 0, score: 0, shotsFired: 0, shotsHit: 0, headshots: 0, streak: 0, bestStreak: 0, damage: 0, captures: 0, longestKill: 0 };
    this.weaponStats = {};
    this.visible = false;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'regulaer';
    this.diff = DIFFICULTY[this.difficulty];
    this.damageScale = this.diff.damage;
    this.modeId = modeId;
    this.castShadows = true;

    this._buildModel();
    this.weapon = G.weapons.createController(this, loadout);
    this._attachGun();

    this.ai = this._freshAi();
    this._intent = {
      fire: false, firePressed: false, ads: false, reload: false, swap: false, slot: null, grenade: false, grenadeHeld: false,
      melee: false, sprinting: false, moving: false, airborne: false, crouching: false, sliding: false, speed: 0, onGround: true,
      lookDX: 0, lookDY: 0, frozen: false,
    };
    this._phase = Math.random() * 6;
    this._stepDist = 0;
    this._deathT = 0;
    this._aimYawErr = 0;
    this._aimPitchErr = 0;
    this._crouch = 0;
    this._lastSeenCheck = Math.random() * 0.2;
  }

  _freshAi() {
    return {
      state: 'roam', target: null, lastSeen: new THREE.Vector3(), lastSeenTime: -1e9, reactAt: 0, engagedAt: 0,
      path: [], pathIdx: 0, repathAt: 0, goal: null, strafe: 1, strafeUntil: 0, crouchUntil: 0,
      burstUntil: 0, pauseUntil: 0, semiNext: 0, stuckT: 0, lastPos: new THREE.Vector3(), grenadeAt: 0,
    };
  }

  /* ------------------------------------------------------------ Modell */

  _buildModel() {
    const { box, mats } = this.manager._sharedRes();
    const team = String(this.team);
    const root = new THREE.Group();
    root.name = `bot:${this.name}`;
    const part = (parent, w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const pivotY = 0.86;
    this.hipL = new THREE.Group(); this.hipL.position.set(-0.11, pivotY, 0);
    this.hipR = new THREE.Group(); this.hipR.position.set(0.11, pivotY, 0);
    part(this.hipL, 0.17, 0.78, 0.2, 0, -0.39, 0, mats.pants);
    part(this.hipR, 0.17, 0.78, 0.2, 0, -0.39, 0, mats.pants);
    part(this.hipL, 0.18, 0.12, 0.28, 0, -0.8, -0.04, mats.boots);
    part(this.hipR, 0.18, 0.12, 0.28, 0, -0.8, -0.04, mats.boots);
    this.torso = new THREE.Group();
    this.torso.position.set(0, pivotY, 0);
    part(this.torso, 0.44, 0.58, 0.26, 0, 0.32, 0, mats[`vest_${team}`]);
    part(this.torso, 0.22, 0.24, 0.24, 0, 0.75, 0, mats.skin);
    part(this.torso, 0.27, 0.12, 0.29, 0, 0.9, 0.01, mats[`helmet_${team}`]);
    this.armR = new THREE.Group(); this.armR.position.set(0.24, 0.52, 0);
    part(this.armR, 0.11, 0.11, 0.48, 0, -0.06, -0.2, mats[`vest_${team}`]);
    this.armL = new THREE.Group(); this.armL.position.set(-0.24, 0.52, 0);
    part(this.armL, 0.11, 0.11, 0.5, 0.1, -0.08, -0.24, mats[`vest_${team}`]);
    this.armL.rotation.y = -0.45;
    this.gunMount = new THREE.Group();
    this.gunMount.position.set(0.12, 0.45, -0.38);
    this.torso.add(this.armR, this.armL, this.gunMount);
    root.add(this.hipL, this.hipR, this.torso);
    // Teammarkierung über Verbündeten
    if (this.team === 'A' && this.G.player && this.G.player.team === 'A') {
      const mk = new THREE.Mesh(box, mats.marker);
      mk.scale.set(0.16, 0.16, 0.16);
      mk.rotation.set(Math.PI / 4, 0, Math.PI / 4);
      mk.position.set(0, 2.2, 0);
      mk.renderOrder = 10;
      root.add(mk);
      this.marker = mk;
    }
    root.visible = false;
    this.root = root;
    this.G.scene.add(root);
  }

  _attachGun() {
    if (this.gun) { this.gun.removeFromParent(); disposeGeometries(this.gun); }
    const def = this.weapon && this.weapon.currentDef;
    const models = this.G.modules && this.G.modules.models && this.G.modules.models.createWeaponModel ? this.G.modules.models : stubModels;
    let gun;
    try { gun = models.createWeaponModel(def ? def.model : 'm17', { lod: 'third' }); } catch { gun = stubModels.createWeaponModel(def ? def.model : 'm17', { lod: 'third' }); }
    this.gun = gun;
    this.gunMount.add(gun);
    this._gunId = def ? def.id : null;
    this.applyShadows();
  }

  applyShadows() {
    if (!this.root) return;
    const on = !!this.castShadows;
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = on && o !== this.marker; });
  }

  /* ------------------------------------------------------------ Actor-API */

  getEyePosition(out = new THREE.Vector3()) {
    const p = this.body.position;
    return out.set(p.x, p.y + this.body.height - 0.15, p.z);
  }

  getAimDirection(out = new THREE.Vector3()) {
    const yaw = this.yaw + this._aimYawErr;
    const pitch = this.pitch + this._aimPitchErr;
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  }

  getMuzzlePosition(out = new THREE.Vector3()) {
    const m = this.gun && this.gun.userData && this.gun.userData.muzzle;
    if (m && this.root.visible) { this.root.updateMatrixWorld(true); return m.getWorldPosition(out); }
    return this.getEyePosition(out);
  }

  raycastHitboxes(ray, maxDist) {
    return raycastHumanoid(this, ray, maxDist);
  }

  addRecoil(pitch) {
    this.pitch += pitch * 0.35;
  }

  /** Geräusch wahrgenommen: Position merken (falls kein sichtbares Ziel). */
  hear(actor, range) {
    if (!this.alive || this.ai.target) return;
    if (actor.position.distanceTo(this.position) > range) return;
    this.ai.lastSeen.copy(actor.position);
    this.ai.lastSeenTime = this.G.time.elapsed - 2.5;
  }

  onDamaged(info) {
    const a = info.attacker;
    if (a && a !== this && this.alive) {
      this.ai.lastSeen.copy(a.position);
      this.ai.lastSeenTime = this.G.time.elapsed;
      if (!this.ai.target) {
        this.yaw += wrap(Math.atan2(-(a.position.x - this.position.x), -(a.position.z - this.position.z)) - this.yaw) * 0.5;
      }
    }
    this._aimYawErr += (Math.random() - 0.5) * 0.08;
    this._aimPitchErr += (Math.random() - 0.5) * 0.05;
  }

  onDeath(info) {
    this.alive = false;
    this._deathT = 0;
    this._deathDir = info && info.dir ? Math.sign(info.dir.x * Math.cos(this.yaw) - info.dir.z * Math.sin(this.yaw)) || 1 : 1;
    this.ai = this._freshAi();
    if (this.marker) this.marker.visible = false;
  }

  respawn(spawn) {
    const pos = spawn && spawn.position ? spawn.position : new THREE.Vector3();
    this.body.setHeight(1.8);
    this.body.teleport(pos);
    this.yaw = spawn && Number.isFinite(spawn.yaw) ? spawn.yaw : 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.lastDamageTime = -1e9;
    this.ai = this._freshAi();
    this.ai.lastPos.copy(pos);
    this.root.visible = true;
    this.root.rotation.set(0, this.yaw, 0);
    this.root.position.copy(pos);
    if (this.marker) this.marker.visible = true;
    if (this.weapon) this.weapon.refill();
    this._crouch = 0;
  }

  /* ------------------------------------------------------------ KI */

  update(dt) {
    const G = this.G;
    if (!this.alive) { this._updateDead(dt); return; }
    const now = G.time.elapsed;
    const frozen = G.match.state !== 'playing';
    const ai = this.ai;
    const world = G.world;

    // Wahrnehmung (gestaffelt)
    this._lastSeenCheck -= dt;
    if (this._lastSeenCheck <= 0) {
      this._lastSeenCheck = 0.18 + Math.random() * 0.08;
      this._perceive(now);
    }
    const t = ai.target;
    if (t && (!t.alive || now - ai.targetSeenAt > 0.6)) {
      if (t.alive) { ai.lastSeen.copy(t.position); ai.lastSeenTime = ai.targetSeenAt; }
      ai.target = null;
    }

    // Zustand
    if (ai.target) ai.state = this.health < 35 && world && world.nav ? 'cover' : 'engage';
    else if (now - ai.lastSeenTime < 7) ai.state = 'chase';
    else if (ai.state !== 'roam') { ai.state = 'roam'; ai.path = []; }
    if (ai.state === 'cover' && this.health > 80) ai.state = ai.target ? 'engage' : 'roam';

    // Bewegungsziel
    let mx = 0, mz = 0, speed = 0, faceMove = true;
    if (!frozen) {
      if (ai.state === 'engage' && ai.target) {
        faceMove = false;
        if (now > ai.strafeUntil) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = now + rand(0.6, 1.5); if (Math.random() < 0.15) ai.strafe = 0; }
        if (now > ai.crouchUntil && Math.random() < dt * 0.3) ai.crouchUntil = now + rand(0.8, 1.6);
        const d = ai.target.position.distanceTo(this.position);
        const def = this.weapon.currentDef;
        const ideal = def && (def.cls === 'shotgun' || def.cls === 'smg') ? 7 : def && (def.cls === 'sniper' || def.cls === 'marksman') ? 30 : 16;
        _to.subVectors(ai.target.position, this.position).setY(0).normalize();
        const fwd = d > ideal * 1.5 ? 0.8 : d < ideal * 0.5 ? -0.6 : 0;
        mx = -_to.z * ai.strafe + _to.x * fwd;
        mz = _to.x * ai.strafe + _to.z * fwd;
        speed = now < ai.crouchUntil ? 2.4 : 4.0;
      } else {
        const goal = this._goal(now, ai);
        if (goal) {
          _to.subVectors(goal, this.position).setY(0);
          const len = _to.length();
          if (len > 0.05) { mx = _to.x / len; mz = _to.z / len; }
          speed = ai.state === 'roam' ? 5.2 : ai.state === 'cover' ? 6.5 : 5.6;
        }
      }
    }

    // Blick
    let wantYaw = this.yaw;
    let wantPitch = 0;
    if (ai.target) {
      const tgt = ai.target;
      this.getEyePosition(_eye);
      const h = tgt.body ? tgt.body.height : 1.8;
      _v.copy(tgt.position);
      _v.y += ai.aimHead ? h - 0.17 : h * 0.62;
      _v.sub(_eye);
      wantYaw = Math.atan2(-_v.x, -_v.z);
      wantPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    } else if ((mx || mz) && faceMove) {
      wantYaw = Math.atan2(-mx, -mz);
    } else if (ai.state === 'chase') {
      _v.subVectors(ai.lastSeen, this.position);
      wantYaw = Math.atan2(-_v.x, -_v.z);
    }
    const turn = this.diff.turn * dt * (ai.target ? 1 : 0.7);
    this.yaw = wrap(this.yaw + clamp(wrap(wantYaw - this.yaw), -turn, turn));
    this.pitch += clamp(wantPitch - this.pitch, -turn, turn);
    // Zielfehler baut sich im Gefecht ab
    const engagedFor = now - ai.engagedAt;
    const errScale = this.diff.aimError * (0.35 + 0.65 * Math.exp(-engagedFor * 1.1));
    const wob = now * 2.3 + this._phase;
    this._aimYawErr += ((Math.sin(wob) * errScale) - this._aimYawErr) * Math.min(1, dt * 4);
    this._aimPitchErr += ((Math.cos(wob * 1.3) * errScale * 0.6) - this._aimPitchErr) * Math.min(1, dt * 4);

    // Physik
    const body = this.body;
    const v = body.velocity;
    const a = 1 - Math.exp(-10 * dt);
    v.x += (mx * speed - v.x) * a;
    v.z += (mz * speed - v.z) * a;
    const crouch = !frozen && ai.state === 'engage' && now < ai.crouchUntil;
    this._crouch += ((crouch ? 1 : 0) - this._crouch) * Math.min(1, dt * 10);
    const h = 1.8 - 0.65 * this._crouch;
    if (h < body.height || body.canStand(world, h)) body.setHeight(h);
    body.step(dt, world, { gravity: 24, stepHeight: 0.45 });
    if (body.outOfWorld && G.combat) { G.combat.damage(this, { amount: 9999, attacker: null, weaponId: 'world' }); return; }
    if (world && world.bounds) {
      const b = world.bounds;
      body.position.x = clamp(body.position.x, b.min.x + 0.4, b.max.x - 0.4);
      body.position.z = clamp(body.position.z, b.min.z + 0.4, b.max.z - 0.4);
    }

    // Festgefahren? → neu planen / springen
    const hs = Math.hypot(v.x, v.z);
    if (speed > 1 && !frozen) {
      ai.stuckT += dt;
      if (ai.stuckT > 1.2) {
        if (ai.lastPos.distanceTo(this.position) < 0.4) {
          ai.path = [];
          ai.repathAt = 0;
          if (body.onGround) v.y = 6.5;
          ai.strafe = -ai.strafe;
        }
        ai.stuckT = 0;
        ai.lastPos.copy(this.position);
      }
    }

    // Schritte
    if (body.onGround && hs > 1) {
      this._stepDist += hs * dt;
      if (this._stepDist > 2.2) {
        this._stepDist = 0;
        G.events.emit('footstep', { actor: this, surface: world && world.surfaceAt ? world.surfaceAt(this.position) : 'concrete', sprint: hs > 5.5, crouch: crouch, position: this.position.clone() });
      }
    }

    // Regeneration wie beim Spieler
    if (this.health < this.maxHealth && now - this.lastDamageTime > 3.5) this.health = Math.min(this.maxHealth, this.health + 55 * dt);

    // Waffe
    const it = this._intent;
    it.frozen = frozen;
    it.fire = false;
    it.firePressed = false;
    it.reload = false;
    it.grenade = false;
    it.moving = hs > 0.5;
    it.speed = hs;
    it.airborne = !body.onGround;
    it.onGround = body.onGround;
    it.crouching = crouch;
    it.sprinting = false;
    it.ads = false;
    if (!frozen && ai.target && now >= ai.reactAt) {
      const yawErr = Math.abs(wrap(wantYaw - this.yaw));
      const def = this.weapon.currentDef;
      const dist = ai.target.position.distanceTo(this.position);
      it.ads = dist > 12 && def && def.cls !== 'shotgun';
      if (yawErr < 0.09) {
        if (now > ai.pauseUntil) {
          ai.burstUntil = now + rand(...this.diff.burst) * (def && def.fireMode === 'auto' ? 1 : 2.5);
          ai.pauseUntil = ai.burstUntil + rand(...this.diff.pause);
        }
        if (now < ai.burstUntil) {
          if (def && def.fireMode === 'auto') it.fire = true;
          else if (now > ai.semiNext) { it.firePressed = true; ai.semiNext = now + 60 / Math.max(60, def ? def.rpm : 300) + rand(0.08, 0.25); }
        }
      }
      // Gelegentlich Granate auf Gegner hinter Deckung
      if (!ai.grenadeAt) ai.grenadeAt = now + rand(6, 14);
    } else if (!frozen && !ai.target && ai.state === 'chase' && ai.grenadeAt && now > ai.grenadeAt && now - ai.lastSeenTime < 3) {
      const d = ai.lastSeen.distanceTo(this.position);
      if (d > 9 && d < 24 && Math.random() < 0.5) {
        _v.subVectors(ai.lastSeen, this.position);
        this.yaw = Math.atan2(-_v.x, -_v.z);
        this.pitch = 0.25;
        it.grenade = true;
      }
      ai.grenadeAt = now + rand(10, 20);
    }
    if (!frozen && !ai.target) {
      const st = this.weapon.current;
      if (st && st.def.mag && st.mag < st.def.mag * 0.4) it.reload = true;
    }
    this.weapon.update(dt, it);
    if (this.weapon.currentDef && this.weapon.currentDef.id !== this._gunId) this._attachGun();

    this._animate(dt, hs, crouch);
  }

  _perceive(now) {
    const G = this.G;
    const ai = this.ai;
    const world = G.world;
    this.getEyePosition(_eye);
    let best = null;
    let bestScore = Infinity;
    const facingX = -Math.sin(this.yaw), facingZ = -Math.cos(this.yaw);
    for (const a of G.actors) {
      if (!a.alive || a === this || !G.combat.isHostile(this, a)) continue;
      _v.copy(a.position);
      _v.y += (a.body ? a.body.height : 1.8) * 0.75;
      const dx = _v.x - _eye.x, dz = _v.z - _eye.z;
      const d = Math.hypot(dx, dz);
      if (d > this.diff.sight) continue;
      const cos = (dx * facingX + dz * facingZ) / Math.max(d, 1e-4);
      const inFov = cos > Math.cos(this.diff.fov / 2) || d < 6 || a === ai.target;
      if (!inFov) continue;
      // Spieler, der gerade schießt, fällt eher auf
      const score = d * (a === ai.target ? 0.6 : 1) * (now - (a.lastFiredTime || -1e9) < 1 ? 0.8 : 1);
      if (score >= bestScore) continue;
      if (world && world.lineOfSight && !world.lineOfSight(_eye, _v)) continue;
      best = a;
      bestScore = score;
    }
    if (best) {
      if (best !== ai.target) {
        ai.target = best;
        ai.reactAt = now + this.diff.reaction * rand(0.7, 1.3);
        ai.engagedAt = now;
        ai.aimHead = Math.random() < this.diff.headshot;
      }
      ai.targetSeenAt = now;
      ai.lastSeen.copy(best.position);
      ai.lastSeenTime = now;
    }
  }

  _goal(now, ai) {
    const G = this.G;
    const world = G.world;
    const nav = world && world.nav;
    if (ai.state === 'cover' && nav && ai.lastSeen) {
      if (!ai.coverNode || now > ai.repathAt) {
        ai.coverNode = nav.coverNear(this.position, ai.lastSeen, 14);
        ai.repathAt = now + 2;
        ai.path = ai.coverNode ? nav.findPath(this.position, ai.coverNode.position) : [];
        ai.pathIdx = 0;
      }
    } else if (ai.state === 'chase') {
      if (!ai.path.length || now > ai.repathAt || (ai.goal && ai.goal.distanceTo(ai.lastSeen) > 3)) {
        ai.goal = ai.lastSeen.clone();
        ai.path = nav ? nav.findPath(this.position, ai.goal) : [ai.goal.clone()];
        ai.pathIdx = 0;
        ai.repathAt = now + 1.5;
      }
    } else if (!ai.path.length || ai.pathIdx >= ai.path.length || now > ai.repathAt) {
      let goal = null;
      if (nav) {
        const enemySide = this.team === 'A' ? -1 : this.team === 'B' ? 1 : 0;
        const node = enemySide && Math.random() < 0.6
          ? nav.randomNode((n) => Math.sign(n.position.z) === enemySide)
          : nav.randomNode();
        goal = node ? node.position.clone() : null;
      }
      if (!goal) goal = new THREE.Vector3(rand(-20, 20), 0, rand(-20, 20));
      ai.goal = goal;
      ai.path = nav ? nav.findPath(this.position, goal) : [goal];
      ai.pathIdx = 0;
      ai.repathAt = now + rand(10, 18);
    }
    while (ai.pathIdx < ai.path.length) {
      const p = ai.path[ai.pathIdx];
      if (Math.hypot(p.x - this.position.x, p.z - this.position.z) < 0.9) ai.pathIdx++;
      else return p;
    }
    if (ai.state === 'chase') ai.lastSeenTime = -1e9; // angekommen, niemand da
    return null;
  }

  _animate(dt, speed, crouch) {
    const r = this.root;
    r.position.copy(this.body.position);
    r.rotation.set(0, this.yaw, 0);
    this._phase += dt * (2 + speed * 1.7);
    const swing = Math.min(1, speed / 5) * 0.6;
    this.hipL.rotation.x = Math.sin(this._phase) * swing - this._crouch * 0.9;
    this.hipR.rotation.x = -Math.sin(this._phase) * swing - this._crouch * 0.9;
    this.torso.position.y = 0.86 - this._crouch * 0.42;
    this.hipL.position.y = this.hipR.position.y = 0.86 - this._crouch * 0.3;
    this.torso.rotation.x = this.pitch * 0.7 + this._crouch * 0.15;
    this.armR.rotation.x = this.armL.rotation.x = 0;
    void crouch;
  }

  _updateDead(dt) {
    if (!this.root.visible) return;
    this._deathT += dt;
    const k = Math.min(1, this._deathT / 0.45);
    this.root.rotation.set(-k * k * 1.45, this.yaw, this._deathDir * k * 0.25);
    this.root.position.y = this.body.position.y - k * 0.05;
    if (this._deathT > 4) this.root.visible = false;
  }

  dispose() {
    if (this.weapon && typeof this.weapon.dispose === 'function') this.weapon.dispose();
    this.weapon = null;
    if (this.gun) disposeGeometries(this.gun);
    this.root.removeFromParent();
    this.alive = false;
  }
}

function disposeGeometries(obj) {
  obj.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
}
