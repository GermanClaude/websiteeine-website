// NULLPUNKT — Stub für weapons/index.js (§7): WeaponSystem + WeaponController für alle Roster-IDs.
// Magazin/Reserve, Nachladen (auch Patrone für Patrone), ADS, Feuermodi auto/semi/burst/bolt/pump,
// Schrotkugeln, Streuung (Hüfte/ADS/Laufen/Springen), Rückstoßmuster → actor.addRecoil, Sprint-zu-Feuer,
// Messer, Granaten (Splitter/Haft, Abpraller, Zünder) → G.combat.explode. Treibt das Viewmodel des Spielers.

import * as THREE from 'three';
import * as stubViewModel from './viewmodel.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pellet = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _to = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

const FALLBACK_DEF = {
  id: 'ar_m17', name: 'M-17 Falke', cls: 'ar', slot: 'primary', model: 'm17', damage: { max: 25, min: 19, rangeStart: 20, rangeEnd: 42 },
  headMult: 1.35, limbMult: 0.9, pellets: 1, rpm: 700, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 120, reloadTime: 2.1,
  reloadEmptyTime: 2.7, equipTime: 0.55, adsTime: 0.22, adsZoom: 1.35, sprintToFire: 0.18, moveSpeedMult: 0.95, adsMoveMult: 0.62,
  hipSpread: 0.045, adsSpread: 0.0022, moveSpreadMult: 1.45, jumpSpreadMult: 2.5, recoil: { vertical: 0.0078, horizontal: 0.0028, recovery: 10, firstShotMult: 1.1 },
  range: 110, penetration: 0.55, sound: { profile: 'ar', pitch: 1 },
};

/** Zufällige Richtung im Kegel mit halbem Öffnungswinkel `angle` (gleichverteilt auf der Kreisscheibe). */
export function randomInCone(dir, angle, out) {
  if (angle <= 1e-6) return out.copy(dir);
  const r = angle * Math.sqrt(Math.random());
  const th = Math.random() * Math.PI * 2;
  _u.crossVectors(dir, Math.abs(dir.y) > 0.95 ? _w.set(1, 0, 0) : UP).normalize();
  _w.crossVectors(_u, dir).normalize();
  return out.copy(dir)
    .addScaledVector(_u, Math.tan(r * Math.cos(th)))
    .addScaledVector(_w, Math.tan(r * Math.sin(th)))
    .normalize();
}

export class WeaponSystem {
  constructor(G) {
    this.G = G;
    this.grenades = [];
    this.controllers = new Set();
    this._geo = null;
    this._mats = {};
  }

  attach(G) {
    this.G = G;
    this._clearGrenades();
  }

  detach() {
    this._clearGrenades();
    for (const c of [...this.controllers]) c.dispose();
    this.controllers.clear();
    if (this._geo) { this._geo.dispose(); this._geo = null; }
    for (const m of Object.values(this._mats)) m.dispose();
    this._mats = {};
  }

  createController(actor, loadout) {
    const c = new WeaponController(this, actor, loadout || {});
    this.controllers.add(c);
    return c;
  }

  _clearGrenades() {
    for (const g of this.grenades) g.mesh.removeFromParent();
    this.grenades.length = 0;
  }

  /** Granate werfen (vom Controller aufgerufen). cook = bereits abgelaufene Zündzeit (s). */
  throwGrenade(actor, id, cook = 0) {
    const G = this.G;
    const eq = (G.data && G.data.EQUIPMENT && G.data.EQUIPMENT[id]) || { id, fuse: 2.8, radius: 6.5, maxDamage: 150, throwSpeed: 18, throwPitch: 0.18, bounciness: 0.38, friction: 0.55 };
    if (!this._geo) this._geo = new THREE.SphereGeometry(0.06, 10, 8);
    if (!this._mats[id]) this._mats[id] = new THREE.MeshStandardMaterial({ color: id === 'semtex' ? 0x40454c : 0x4a5236, roughness: 0.6, metalness: 0.4, emissive: id === 'semtex' ? 0x330000 : 0x000000 });
    const mesh = new THREE.Mesh(this._geo, this._mats[id]);
    mesh.castShadow = true;
    const pos = actor.getEyePosition(new THREE.Vector3());
    const dir = actor.getAimDirection(new THREE.Vector3());
    pos.addScaledVector(dir, 0.5);
    pos.y -= 0.15;
    const pitchUp = eq.throwPitch || 0.18;
    const vel = dir.clone();
    vel.y += pitchUp;
    vel.normalize().multiplyScalar(eq.throwSpeed || 18);
    if (actor.body) vel.addScaledVector(actor.body.velocity, 0.5);
    mesh.position.copy(pos);
    G.scene.add(mesh);
    const g = { actor, eq, mesh, pos, vel, fuse: Math.max(0.05, (eq.fuse || 2.8) - cook), stuck: null, stuckOffset: null, rest: false };
    this.grenades.push(g);
    G.events.emit('grenade:throw', { actor, position: pos.clone(), velocity: vel.clone(), type: id });
    return g;
  }

  update(dt) {
    const G = this.G;
    const sphere = new THREE.Sphere(new THREE.Vector3(), 0.07);
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (g.stuck) {
        if (g.stuck.position) g.pos.copy(g.stuck.position).add(g.stuckOffset);
      } else if (!g.rest) {
        g.vel.y -= 20 * dt;
        const steps = Math.max(1, Math.ceil((g.vel.length() * dt) / 0.05));
        const sdt = dt / steps;
        for (let s = 0; s < steps; s++) {
          g.pos.addScaledVector(g.vel, sdt);
          // Haftgranate an Gegnern
          if (g.eq.sticky) {
            for (const a of G.actors) {
              if (!a.alive || a === g.actor || !G.combat.isHostile(g.actor, a)) continue;
              _to.copy(a.position); _to.y += 1.1;
              if (_to.distanceTo(g.pos) < 0.55) { g.stuck = a; g.stuckOffset = g.pos.clone().sub(a.position); break; }
            }
            if (g.stuck) break;
          }
          const col = G.world && G.world.collider;
          if (!col) continue;
          sphere.center.copy(g.pos);
          const hit = col.sphereIntersect(sphere);
          if (hit) {
            g.pos.addScaledVector(hit.normal, hit.depth);
            if (g.eq.sticky) { g.stuck = { position: g.pos.clone() }; g.stuckOffset = new THREE.Vector3(); g.vel.set(0, 0, 0); break; }
            const vn = g.vel.dot(hit.normal);
            if (vn < 0) {
              const speed = g.vel.length();
              g.vel.addScaledVector(hit.normal, -(1 + (g.eq.bounciness ?? 0.38)) * vn);
              const f = g.eq.friction ?? 0.55;
              const tangential = g.vel.clone().addScaledVector(hit.normal, -g.vel.dot(hit.normal));
              g.vel.addScaledVector(tangential, -f * 0.5);
              if (speed > 2.5) G.events.emit('grenade:bounce', { position: g.pos.clone(), speed });
              if (g.vel.length() < 0.6 && hit.normal.y > 0.6) { g.rest = true; g.vel.set(0, 0, 0); break; }
            }
          }
        }
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.vel.length() * dt * 2;
      if (g.fuse <= 0) {
        g.mesh.removeFromParent();
        this.grenades.splice(i, 1);
        if (G.combat) {
          G.combat.explode({
            position: g.pos.clone(), radius: g.eq.radius || 6.5, maxDamage: g.eq.maxDamage || 150,
            innerRadius: g.eq.innerRadius, minDamage: g.eq.minDamage, attacker: g.actor, weaponId: g.eq.id, type: g.eq.id,
          });
        }
      }
    }
  }
}

export class WeaponController {
  constructor(system, actor, loadout) {
    this.system = system;
    this.G = system.G;
    this.actor = actor;
    this.slots = [];
    this.index = 0;
    this.equipment = { lethal: { id: null, count: 0 } };
    this.adsProgress = 0;
    this.spread = 0.04;
    this.isReloading = false;
    this.reloadProgress = 0;
    this.isSwitching = false;
    this.canSprint = true;
    this.lastShotTime = -1e9;
    this._cooldown = 0;
    this._sprintDelay = 0;
    this._burstLeft = 0;
    this._shotIndex = 0;
    this._bloom = 0;
    this._reload = null;
    this._switch = null;
    this._melee = null;
    this._throw = null;
    this._queued = 0;
    this._adsOn = false;
    this.viewModel = null;
    if (actor.isPlayer && this.G.viewmodel) {
      const VM = this.G.modules && this.G.modules.viewmodel && this.G.modules.viewmodel.ViewModel ? this.G.modules.viewmodel.ViewModel : stubViewModel.ViewModel;
      try { this.viewModel = new VM(this.G); } catch (err) { console.error('[NULLPUNKT] ViewModel:', err); this.viewModel = new stubViewModel.ViewModel(this.G); }
      this.G.viewmodel.rig = this.viewModel;
    }
    this.setLoadout(loadout);
  }

  get current() { return this.slots[this.index] || null; }
  get currentDef() { const s = this.slots[this.index]; return s ? s.def : null; }

  _def(id) {
    const W = this.G.data && this.G.data.WEAPONS;
    return (W && W[id]) || null;
  }

  setLoadout(loadout = {}) {
    const primary = this._def(loadout.primary) || this._def('ar_m17') || FALLBACK_DEF;
    const secondary = loadout.secondary === null ? null : this._def(loadout.secondary || 'pi_p9');
    this.slots = [this._state(primary)];
    if (secondary) this.slots.push(this._state(secondary));
    const lethalId = loadout.lethal === null ? null : (loadout.lethal || 'frag');
    const eq = lethalId && this.G.data && this.G.data.EQUIPMENT ? this.G.data.EQUIPMENT[lethalId] : null;
    this.equipment.lethal = { id: lethalId, count: lethalId ? (eq ? eq.count : 1) : 0 };
    this.index = 0;
    this._reload = this._switch = this._melee = this._throw = null;
    this.isReloading = this.isSwitching = false;
    this._cooldown = 0;
    if (this.viewModel) this.viewModel.setWeapon(this.currentDef.id);
    this.G.events.emit('weapon:switch', { actor: this.actor, weaponId: this.currentDef.id });
  }

  _state(def) {
    return { id: def.id, def, mag: def.mag || 0, reserve: def.reserve || 0 };
  }

  refill() {
    for (const s of this.slots) { s.mag = s.def.mag || 0; s.reserve = s.def.reserve || 0; }
    const eq = this.equipment.lethal;
    if (eq.id) {
      const def = this.G.data && this.G.data.EQUIPMENT ? this.G.data.EQUIPMENT[eq.id] : null;
      eq.count = def ? def.count : 1;
    }
    this._reload = this._melee = this._throw = this._switch = null;
    this.isReloading = this.isSwitching = false;
    this.adsProgress = 0;
    this._cooldown = 0;
    this._shotIndex = 0;
    this._bloom = 0;
    if (this.index !== 0) { this.index = 0; if (this.viewModel) this.viewModel.setWeapon(this.currentDef.id); }
  }

  update(dt, it) {
    const G = this.G;
    const now = G.time.elapsed;
    const st = this.current;
    if (!st) return;
    const def = st.def;
    this._cooldown = Math.max(-1, this._cooldown - dt);
    this._sprintDelay = Math.max(0, this._sprintDelay - dt);
    this._queued = Math.max(0, this._queued - dt);
    this._bloom *= Math.exp(-6 * dt);
    if (now - this.lastShotTime > 0.35) this._shotIndex = 0;

    if (!it.frozen) {
      this._updateMelee(dt, it);
      this._updateThrow(dt, it);
      this._updateSwitch(dt, it);
      this._updateReload(dt, it);
    }

    // ADS
    const blocked = it.frozen || it.sprinting || this._switch || this._melee || this._throw || def.cls === 'melee';
    const wantAds = !!it.ads && !blocked;
    if (wantAds !== this._adsOn) {
      this._adsOn = wantAds;
      G.events.emit('weapon:ads', { actor: this.actor, on: wantAds });
    }
    const adsRate = 1 / Math.max(0.08, def.adsTime || 0.25);
    this.adsProgress = Math.max(0, Math.min(1, this.adsProgress + (wantAds ? adsRate : -adsRate * 1.4) * dt));

    // Sprint verzögert den ersten Schuss
    if (it.sprinting) this._sprintDelay = def.sprintToFire || 0.2;
    this.canSprint = !this._melee && !this._throw;

    // Streuung
    const ads = this.adsProgress;
    const base = (def.hipSpread ?? 0.045) + ((def.adsSpread ?? 0.003) - (def.hipSpread ?? 0.045)) * ads;
    let mult = 1;
    if (it.moving) mult *= 1 + ((def.moveSpreadMult ?? 1.4) - 1) * (1 - 0.7 * ads);
    if (it.airborne) mult *= def.jumpSpreadMult ?? 2.5;
    if (it.crouching && !it.moving) mult *= 0.85;
    if (it.sliding) mult *= 1.25;
    const target = base * mult + this._bloom * (1 - 0.75 * ads);
    this.spread += (target - this.spread) * damp(14, dt);

    // Feuern
    if (!it.frozen && !this._switch && !this._throw) {
      const mode = def.fireMode || 'auto';
      if (def.cls === 'melee') {
        if (it.firePressed || it.fire) this._startMelee();
      } else if (mode === 'auto') {
        if (it.fire || it.firePressed) this._tryFire(it);
      } else if (mode === 'burst') {
        if (it.firePressed && this._burstLeft === 0 && this._cooldown <= 0) this._burstLeft = def.burstCount || 3;
        if (this._burstLeft > 0 && this._cooldown <= 0) {
          if (this._tryFire(it)) {
            this._burstLeft -= 1;
            if (this._burstLeft === 0) this._cooldown += (def.burstDelay || 60 / def.rpm) - 60 / def.rpm;
          } else this._burstLeft = 0;
        }
      } else {
        if (it.firePressed) this._queued = 0.14;
        if (this._queued > 0 && this._cooldown <= 0 && this._tryFire(it)) this._queued = 0;
      }
    }

    this.isReloading = !!this._reload;
    this.isSwitching = !!this._switch;

    // Viewmodel
    if (this.viewModel) {
      this.viewModel.update(dt, {
        ads: wantAds, adsProgress: this.adsProgress, moving: it.moving, speed: it.speed || 0, sprinting: it.sprinting,
        crouching: it.crouching, onGround: it.onGround !== false && !it.airborne, lookDX: it.lookDX || 0, lookDY: it.lookDY || 0,
        reloading: this.isReloading, reloadProgress: this.reloadProgress, reloadEmpty: this._reload ? this._reload.empty : false,
        firing: now - this.lastShotTime < 0.1, timeSinceShot: now - this.lastShotTime,
      });
    }
  }

  _tryFire(it) {
    const G = this.G;
    const st = this.current;
    const def = st.def;
    if (this._cooldown > 0 || this._sprintDelay > 0 || this._melee) return false;
    if (this._reload) {
      if (this._reload.shells && st.mag > 0) this._finishReload(true);
      else return false;
    }
    if (st.mag <= 0) {
      if (this._cooldown <= 0) {
        G.events.emit('weapon:dryfire', { actor: this.actor, weaponId: def.id });
        this._cooldown = 0.3;
        if (st.reserve > 0 || this.actor.isBot) this._startReload();
      }
      return false;
    }
    this._fire(it);
    return true;
  }

  _fire() {
    const G = this.G;
    const actor = this.actor;
    const st = this.current;
    const def = st.def;
    const now = G.time.elapsed;
    st.mag -= 1;
    const interval = 60 / Math.max(1, def.rpm || 600);
    this._cooldown = Math.max(0, this._cooldown) + interval;
    if (now - this.lastShotTime > 0.35) this._shotIndex = 0; else this._shotIndex += 1;
    this.lastShotTime = now;
    actor.lastFiredTime = now;

    actor.getEyePosition(_origin);
    actor.getAimDirection(_dir);
    if (this.viewModel) this.viewModel.getMuzzleWorldPosition(_muzzle);
    else if (typeof actor.getMuzzlePosition === 'function') actor.getMuzzlePosition(_muzzle);
    else {
      _u.crossVectors(_dir, UP).normalize();
      _muzzle.copy(_origin).addScaledVector(_dir, 0.6).addScaledVector(_u, 0.18).addScaledVector(UP, -0.22);
    }

    G.events.emit('weapon:fire', { actor, weaponId: def.id, origin: _origin.clone(), dir: _dir.clone(), suppressed: !!def.suppressed });

    const pellets = Math.max(1, def.pellets || 1);
    const spread = pellets > 1 ? Math.max(this.spread, def.adsSpread || 0.04) : this.spread;
    for (let i = 0; i < pellets; i++) {
      randomInCone(_dir, spread, _pellet);
      const res = G.combat.fireHitscan({ shooter: actor, origin: _origin, dir: _pellet, range: def.range || 100, weapon: def, pelletIndex: i, damageScale: actor.damageScale || 1 });
      if (pellets === 1 || i % 3 === 0) {
        G.events.emit('tracer', { from: _muzzle.clone(), to: res.point.clone ? res.point.clone() : res.point, actor, weaponId: def.id, hit: res.hit });
      }
    }

    // Rückstoß nach Muster
    const r = def.recoil || { vertical: 0.008, horizontal: 0.003, recovery: 8, firstShotMult: 1 };
    const pat = r.pattern;
    let e = [0, 1];
    if (pat && pat.length) {
      const i = this._shotIndex;
      e = i < pat.length ? pat[i] : pat[pat.length - 4 + ((i - pat.length) % Math.min(4, pat.length))] || pat[pat.length - 1];
    }
    const first = this._shotIndex === 0 ? (r.firstShotMult || 1) : 1;
    const adsDamp = 1 - 0.15 * this.adsProgress;
    const pitch = r.vertical * e[1] * first * adsDamp;
    const yaw = r.horizontal * (e[0] + (Math.random() * 0.7 - 0.35)) * adsDamp;
    if (typeof actor.addRecoil === 'function') actor.addRecoil(pitch, yaw, r.recovery);
    this._bloom = Math.min((def.hipSpread || 0.04) * 0.9, this._bloom + (def.hipSpread || 0.04) * 0.18);
    if (this.viewModel) {
      const strength = def.cls === 'sniper' || def.cls === 'shotgun' ? 2.2 : def.cls === 'marksman' || def.id === 'pi_adler' ? 1.6 : 1;
      this.viewModel.onShot(strength);
    }
    // Bots: Reserve nie leer
    if (actor.isBot && st.reserve < def.mag) st.reserve = def.reserve || def.mag * 4;
  }

  /* ------------------------------------------------------------ Nachladen */

  _startReload() {
    const st = this.current;
    const def = st.def;
    if (this._reload || def.cls === 'melee' || st.mag >= def.mag || (st.reserve <= 0 && !this.actor.isBot)) return;
    const empty = st.mag === 0;
    if (def.perShellReload) {
      const tm = def.shellTiming || { start: 0.3, insert: 0.45, end: 0.4 };
      this._reload = { shells: true, phase: 'start', t: 0, timing: tm, empty, total: tm.start + tm.end + tm.insert * (def.mag - st.mag) };
    } else {
      this._reload = { shells: false, t: 0, dur: empty ? (def.reloadEmptyTime || 2.5) : (def.reloadTime || 2), empty, inserted: false };
    }
    this.reloadProgress = 0;
    this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def.id, phase: 'start', empty });
    if (this.viewModel && typeof this.viewModel.playReload === 'function') this.viewModel.playReload(empty);
  }

  _updateReload(dt, it) {
    const st = this.current;
    const def = st.def;
    if (!this._reload && !this._switch && !this._melee) {
      if (it.reload && st.mag < def.mag && (st.reserve > 0 || this.actor.isBot)) this._startReload();
      else if (st.mag === 0 && (st.reserve > 0 || this.actor.isBot) && this._cooldown <= 0 && def.cls !== 'melee') this._startReload();
    }
    const r = this._reload;
    if (!r) { this.reloadProgress = 0; return; }
    r.t += dt;
    if (!r.shells) {
      this.reloadProgress = Math.min(1, r.t / r.dur);
      if (!r.inserted && r.t >= r.dur * 0.6) {
        r.inserted = true;
        this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def.id, phase: 'insert', empty: r.empty });
      }
      if (r.t >= r.dur) {
        const add = this.actor.isBot ? def.mag - st.mag : Math.min(def.mag - st.mag, st.reserve);
        st.mag += add;
        if (!this.actor.isBot) st.reserve -= add;
        this._finishReload(false);
      }
      return;
    }
    const tm = r.timing;
    if (r.phase === 'start' && r.t >= tm.start) { r.phase = 'insert'; r.t = 0; }
    else if (r.phase === 'insert' && r.t >= tm.insert) {
      r.t = 0;
      st.mag += 1;
      if (!this.actor.isBot) st.reserve -= 1;
      this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def.id, phase: 'insert', empty: r.empty });
      if (st.mag >= def.mag || (st.reserve <= 0 && !this.actor.isBot)) r.phase = 'end';
    } else if (r.phase === 'end' && r.t >= tm.end) {
      this._finishReload(false);
      return;
    }
    this.reloadProgress = Math.min(1, st.mag / Math.max(1, def.mag));
  }

  _finishReload(interrupted) {
    const def = this.currentDef;
    const r = this._reload;
    this._reload = null;
    this.reloadProgress = 0;
    this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def.id, phase: 'end', empty: r ? r.empty : false, interrupted });
  }

  /* --------------------------------------------------------- Waffenwechsel */

  _updateSwitch(dt, it) {
    if (!this._switch && this.slots.length > 1 && !this._melee) {
      let to = null;
      if (it.swap) to = (this.index + 1) % this.slots.length;
      else if (it.slot && it.slot - 1 !== this.index && this.slots[it.slot - 1]) to = it.slot - 1;
      if (to !== null) {
        if (this._reload) { this._reload = null; this.reloadProgress = 0; }
        const next = this.slots[to].def;
        this._switch = { t: 0, to, swapped: false, dur: 0.18 + (next.equipTime || 0.5) * 0.7 };
        this._burstLeft = 0;
      }
    }
    const s = this._switch;
    if (!s) return;
    s.t += dt;
    if (!s.swapped && s.t >= 0.16) {
      s.swapped = true;
      this.index = s.to;
      this._shotIndex = 0;
      if (this.viewModel) this.viewModel.setWeapon(this.currentDef.id);
      this.G.events.emit('weapon:switch', { actor: this.actor, weaponId: this.currentDef.id });
    }
    if (s.t >= s.dur) this._switch = null;
  }

  /* ---------------------------------------------------------------- Messer */

  _startMelee() {
    if (this._melee || this._switch) return;
    const W = this.G.data && this.G.data.WEAPONS;
    const knife = (W && W.knife) || { melee: { range: 2.4, arc: 0.6, swingTime: 0.75, hitDelay: 0.14 }, damage: { max: 135 } };
    if (this._reload) { this._reload = null; this.reloadProgress = 0; }
    this._melee = { t: 0, hit: false, def: knife };
    if (this.viewModel) this.viewModel.playMelee();
    this.G.events.emit('weapon:melee', { actor: this.actor, phase: 'swing' });
  }

  _updateMelee(dt, it) {
    if (!this._melee && it.melee) this._startMelee();
    const m = this._melee;
    if (!m) return;
    m.t += dt;
    const spec = m.def.melee || { range: 2.4, arc: 0.6, swingTime: 0.75, hitDelay: 0.14 };
    if (!m.hit && m.t >= (spec.hitDelay || 0.14)) {
      m.hit = true;
      const G = this.G;
      const a = this.actor;
      a.getEyePosition(_origin);
      a.getAimDirection(_dir);
      let best = null;
      let bd = Infinity;
      for (const t of G.actors) {
        if (!t.alive || t === a || !G.combat.isHostile(a, t)) continue;
        _to.copy(t.position); _to.y += (t.body ? t.body.height : 1.8) * 0.6;
        _to.sub(_origin);
        const d = _to.length();
        if (d > (spec.range || 2.4) + 0.4 || d >= bd) continue;
        if (Math.acos(Math.max(-1, Math.min(1, _to.dot(_dir) / d))) > (spec.arc || 0.6) + 0.25) continue;
        best = t;
        bd = d;
      }
      if (best) {
        _to.copy(best.position); _to.y += 1.1;
        G.combat.damage(best, { amount: (m.def.damage && m.def.damage.max) || 135, attacker: a, weaponId: 'knife', zone: 'body', dir: _dir.clone(), point: _to.clone(), distance: bd });
        G.events.emit('weapon:melee', { actor: a, phase: 'hit', target: best });
      }
    }
    if (m.t >= (spec.swingTime || 0.75)) this._melee = null;
  }

  /* --------------------------------------------------------------- Granate */

  _updateThrow(dt, it) {
    const lethal = this.equipment.lethal;
    if (!this._throw && it.grenade && lethal.id && lethal.count > 0 && !this._melee) {
      if (this._reload) { this._reload = null; this.reloadProgress = 0; }
      this._throw = { t: 0, thrown: false };
      if (this.viewModel) this.viewModel.playGrenade();
    }
    const tr = this._throw;
    if (!tr) return;
    tr.t += dt;
    if (!tr.thrown && tr.t >= 0.28) {
      tr.thrown = true;
      lethal.count -= 1;
      this.system.throwGrenade(this.actor, lethal.id, 0);
    }
    if (tr.t >= 0.6) this._throw = null;
  }

  dispose() {
    if (this.viewModel) {
      this.viewModel.dispose();
      if (this.G.viewmodel && this.G.viewmodel.rig === this.viewModel) this.G.viewmodel.rig = null;
      this.viewModel = null;
    }
    this.system.controllers.delete(this);
  }
}
