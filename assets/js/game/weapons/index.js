// NULLPUNKT — WeaponSystem (§7): erzeugt die WeaponController aller Akteure, simuliert Granaten,
// hilft Bots beim Granatwurf (Wurfwinkel, Gefahrenabfrage) und räumt beim Matchende auf.

import * as THREE from 'three';
import { WeaponController } from './controller.js';
import { GrenadeSystem, GRENADE_GRAVITY } from './grenades.js';
import { EQUIPMENT as DATA_EQUIPMENT } from '../../shared/weapons.data.js';
import { clamp } from './ballistics/math.js';

export { WeaponController } from './controller.js';

const _eye = new THREE.Vector3();

export class WeaponSystem {
  constructor(G) {
    this.G = G;
    this.controllers = new Set();
    this.grenadeSystem = new GrenadeSystem(this);
    this._subs = null;
  }

  /** Aktive Granaten (nur lesen): [{ type, actor, position, velocity, fuse, radius, stuckTo, rest }] */
  get grenades() { return this.grenadeSystem.list; }

  attach(G) {
    this.G = G;
    this.detach(false);
    this._subs = G.events.scope();
    // Tod: gezogene Granate fällt (COD), laufende Aktionen enden
    this._subs.on('kill', ({ victim }) => {
      const w = victim && victim.weapon;
      if (w && typeof w.onDeath === 'function') w.onDeath();
    });
  }

  detach(disposeControllers = true) {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    this.grenadeSystem.clear();
    if (disposeControllers) for (const c of [...this.controllers]) c.dispose();
  }

  createController(actor, loadout) {
    const c = new WeaponController(this, actor, loadout || {});
    this.controllers.add(c);
    if (actor && actor.isPlayer) c.warmup();
    return c;
  }

  update(dt) {
    this.grenadeSystem.update(dt);
  }

  /* ------------------------------------------------------------ Granaten */

  /** Granate werfen. opts: { cook, drop, origin, dir, speed } */
  throwGrenade(actor, type, opts = {}) {
    return this.grenadeSystem.throw(actor, type || 'frag', opts);
  }

  explodeInHand(actor, type) {
    this.grenadeSystem.explodeInHand(actor, type || 'frag');
  }

  /**
   * Nächste gefährliche Granate für eine Position (Bots: ausweichen).
   * → { grenade, distance } | null — nur Granaten, deren Radius (+ margin) die Position erreicht.
   */
  dangerAt(position, margin = 1) {
    let best = null;
    let bd = Infinity;
    for (const g of this.grenadeSystem.list) {
      const d = g.position.distanceTo(position);
      if (d < g.radius + margin && d < bd) { bd = d; best = g; }
    }
    return best ? { grenade: best, distance: bd } : null;
  }

  /**
   * Wurfwinkel, damit eine Granate (ohne Abpraller) bei `target` landet.
   * → { yaw, pitch (Blick-Pitch für actor.pitch), reachable, flightTime }
   */
  grenadeAim(actor, target, type = 'frag') {
    const EQ = (this.G.data && this.G.data.EQUIPMENT) || DATA_EQUIPMENT;
    const eq = EQ[type] || EQ.frag;
    const s = (eq && eq.throwSpeed) || 18;
    const up = (eq && eq.throwPitch) || 0.18;
    actor.getEyePosition(_eye);
    const dx = target.x - _eye.x;
    const dz = target.z - _eye.z;
    const dy = target.y - (_eye.y - 0.06);
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const g = GRENADE_GRAVITY;
    const s2 = s * s;
    const disc = s2 * s2 - g * (g * d * d + 2 * dy * s2);
    let elev;
    let reachable = true;
    if (disc < 0 || d < 1e-3) {
      elev = d < 1e-3 ? 1.2 : Math.PI / 4;
      reachable = d < 1e-3;
    } else {
      elev = Math.atan((s2 - Math.sqrt(disc)) / (g * d)); // flacher Bogen
    }
    const flightTime = d / Math.max(0.1, s * Math.cos(elev));
    return { yaw, pitch: clamp(elev - up, -1.3, 1.3), reachable, flightTime };
  }

  dispose() {
    this.detach(true);
    this.grenadeSystem.dispose();
  }
}
