// NULLPUNKT — Raketen (Panzerabwehr, Pionier): Projektil mit Startschub → Marschfahrt, leichter Schwerkraft,
// Treffer gegen Welt, Fahrzeuge (Trefferseite: vorn 0,6 · Seite 1 · hinten 2 · oben 1,6 wie die Panzergranaten)
// und Akteure; Splitterwirkung über combat.explode, Rückstrahl hinter dem Schützen, Selbstzerlegung nach `life`.
//
// def.projectile = { kind: 'rocket', speed, cruise, boost, gravity, life, armDistance, vehicleDamage, actorDamage,
//                    splash: { radius, innerRadius, maxDamage, minDamage }, backblast: { length, damage } }
// Ereignisse: projectile:launch { actor, weaponId, position, velocity, kind }, projectile:impact { actor, weaponId,
//   position, vehicle?, target?, armed }. Bots: G.weapons.projectiles (nur lesen) → [{ position, velocity, actor, def }].
import * as THREE from 'three';

const MAX_LIVE = 12;
const FACE_MULT = { front: 0.6, side: 1.0, rear: 2.0, top: 1.6 };
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, -1);
const _ray = new THREE.Ray(), _to = new THREE.Vector3(), _at = new THREE.Vector3();
let nextId = 1;

export class RocketSystem {
  constructor(system) {
    this.system = system;
    this.list = [];
    this._fallback = null;
  }

  get G() { return this.system.G; }

  _mesh() {
    const G = this.G;
    const models = G.modules && G.modules.models;
    let m = null;
    try { if (models && models.createWeaponModel) m = models.createWeaponModel('rocket', { lod: 'third' }); } catch { m = null; }
    if (!m) {
      if (!this._fallback) {
        const geo = new THREE.CylinderGeometry(0.035, 0.04, 0.5, 8);
        geo.rotateX(-Math.PI / 2);
        this._fallback = { geo, mat: new THREE.MeshStandardMaterial({ color: 0x4b5134, roughness: 0.6, metalness: 0.3 }) };
      }
      m = new THREE.Mesh(this._fallback.geo, this._fallback.mat);
    }
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return m;
  }

  /**
   * Rakete abfeuern (vom WeaponController). origin = Mündung (Welt), dir = Flugrichtung (normiert).
   * opts (Mehrspieler): remote (nur Darstellung, Treffer/Explosion vom Host), cid (Schussnummer des Clients), netId (Id des Hosts).
   */
  fire(actor, def, origin, dir, scale = 1, opts = {}) {
    const G = this.G;
    const P = def.projectile || {};
    if (this.list.length >= MAX_LIVE) {
      const old = this.list[0];
      if (old.remote) this._remove(old); else this._detonate(old, old.pos, null, true);
    }
    const pos = origin.clone();
    // Start nicht in der Wand: vom Auge zur Mündung prüfen
    if (G.world && typeof G.world.raycast === 'function' && actor && actor.getEyePosition) {
      const eye = actor.getEyePosition(new THREE.Vector3());
      _to.subVectors(pos, eye);
      const len = _to.length();
      if (len > 1e-3) {
        const hit = G.world.raycast(eye, _to.divideScalar(len), len);
        if (hit) pos.copy(eye).addScaledVector(_to, Math.max(0, hit.distance - 0.1));
      }
    }
    const vel = dir.clone().normalize().multiplyScalar(P.speed || 70);
    const mesh = this._mesh();
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(_z, _d.copy(vel).normalize());
    G.scene.add(mesh);
    const r = {
      pos, vel, dir: dir.clone().normalize(), actor, def, P, scale, age: 0, travel: 0, mesh, trailT: 0,
      id: nextId++, remote: !!opts.remote, cid: Number.isFinite(opts.cid) ? opts.cid : null, netId: Number.isFinite(opts.netId) ? opts.netId : null,
    };
    this.list.push(r);
    this._backblast(actor, def, P, pos, r.dir, scale);
    G.events.emit('projectile:launch', { actor, weaponId: def.id, position: pos.clone(), velocity: vel.clone(), kind: P.kind || 'rocket', rocket: r });
    return r;
  }

  /* ------------------------------------------------------------ Mehrspieler (Client) */

  /** Rakete mit Host-Id (netId) bzw. eigener Schussnummer (cid). */
  findNet(netId, cid = null) {
    for (const r of this.list) if ((netId != null && r.netId === netId) || (cid != null && r.cid === cid && r.netId == null)) return r;
    return null;
  }

  /** Explosion vom Host nachspielen (Darstellung; Schaden entscheidet der Host). dud = Blindgänger (Funken). */
  remoteBoom(netId, position, { def = null, actor = null, dud = false, normal = null } = {}) {
    const G = this.G;
    const r = this.findNet(netId);
    if (r) this._remove(r);
    const d = def || (r && r.def);
    if (dud) {
      if (G.effects && typeof G.effects.impact === 'function') G.effects.impact(position, normal || new THREE.Vector3(0, 1, 0), 'concrete', { big: true });
      return;
    }
    if (!G.combat || !d) return;
    const P = d.projectile || {};
    const sp = P.splash || { radius: 4.5, innerRadius: 1.2, maxDamage: 130, minDamage: 20 };
    G.combat.explode({ position, radius: sp.radius, maxDamage: sp.maxDamage, attacker: actor || (r && r.actor) || null, weaponId: d.id, type: 'rocket', innerRadius: sp.innerRadius, minDamage: sp.minDamage || 0, source: 'rocket' });
  }

  _backblast(actor, def, P, pos, dir, scale) {
    const G = this.G;
    const bb = P.backblast;
    if (G.effects && typeof G.effects.backblast === 'function') G.effects.backblast(pos, dir);
    if (!bb || !G.combat) return;
    const rear = _p.copy(pos).addScaledVector(dir, -0.9);
    for (const a of G.actors) {
      if (!a || !a.alive || a === actor || (actor && !G.combat.isHostile(actor, a))) continue;
      _to.copy(a.position); _to.y += 1.1; _to.sub(rear);
      const d = _to.length();
      if (d > bb.length || d < 1e-3) continue;
      if (-_to.dot(dir) / d < 0.6) continue;
      G.combat.damage(a, { amount: bb.damage * (1 - d / bb.length) * scale, attacker: actor, weaponId: def.id, explosive: true, zone: 'body', dir: dir.clone().negate(), point: a.position.clone() });
    }
  }

  update(dt) {
    if (!this.list.length) return;
    const G = this.G;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (!this.list.includes(r)) continue;
      r.age += dt;
      const P = r.P;
      // Schub: Geschwindigkeit steigt bis zur Marschfahrt, danach leichter Luftwiderstand; Schwerkraft schwach
      _d.copy(r.vel).normalize();
      const sp = r.vel.length();
      const cruise = P.cruise || 150, boost = Math.max(0.05, P.boost || 0.45);
      if (r.age < boost && sp < cruise) r.vel.addScaledVector(_d, ((cruise - (P.speed || 70)) / boost) * dt);
      r.vel.y -= (P.gravity ?? 4.5) * dt;
      const step = r.vel.length() * dt;
      _d.copy(r.vel).normalize();
      let hit = null;
      // Fahrzeugsystem nur, wenn es im Match aktiv ist (online ohne Fahrzeuge: eigene Spur gegen Welt + Akteure)
      if (G.vehicles && G.vehicles.attached !== false && typeof G.vehicles.traceShell === 'function') {
        hit = G.vehicles.traceShell(r.pos, _d, step, { vehicle: r.actor && r.actor.vehicle ? r.actor.vehicle : null, age: r.age, shooter: r.actor });
      } else hit = this._trace(r, _d, step);
      if (hit && hit.distance <= step) {
        // Mehrspieler-Client: Darstellungs-Rakete endet am Hindernis, die Wirkung kommt vom Host (remoteBoom)
        if (r.remote) { this._remove(r); continue; }
        _at.copy(r.pos).addScaledVector(_d, hit.distance);
        this._impact(r, hit, _at, _d);
        continue;
      }
      r.pos.addScaledVector(_d, step);
      r.travel += step;
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.setFromUnitVectors(_z, _d);
      r.trailT -= dt;
      if (r.trailT <= 0 && G.effects && typeof G.effects.rocketTrail === 'function') { r.trailT = 0.016; G.effects.rocketTrail(r.pos, _d); }
      const bounds = G.world && G.world.bounds;
      if (r.age > (P.life || 4.5) || (bounds && r.pos.y < bounds.min.y - 10)) { if (r.remote) this._remove(r); else this._detonate(r, r.pos, null, true); }
    }
  }

  /** Ohne Fahrzeugsystem: Welt + feindliche Akteure entlang des Schritts. */
  _trace(r, d, len) {
    const G = this.G;
    let best = null;
    const w = G.world;
    if (w && typeof w.raycast === 'function') {
      const h = w.raycast(r.pos, d, len);
      if (h && h.distance <= len) best = { point: h.point, normal: h.normal, distance: h.distance, surface: h.surface };
    }
    _ray.set(r.pos, d);
    for (const a of G.actors) {
      if (!a || !a.alive || a === r.actor || typeof a.raycastHitboxes !== 'function') continue;
      if (r.actor && G.combat && !G.combat.isHostile(r.actor, a)) continue;
      _p.copy(a.position); _p.y += 0.9;
      if (_ray.distanceSqToPoint(_p) > 2.5) continue;
      const h = a.raycastHitboxes(_ray, best ? best.distance : len);
      if (h && (!best || h.distance < best.distance)) best = { point: h.point, normal: h.normal || d.clone().negate(), distance: h.distance, actor: a, zone: h.zone };
    }
    return best;
  }

  _impact(r, hit, at, dir) {
    const G = this.G;
    const P = r.P, def = r.def, attacker = r.actor || null;
    const armed = r.travel + hit.distance >= (P.armDistance ?? 6);
    if (hit.vehicle) {
      const v = hit.vehicle;
      const mult = (FACE_MULT[hit.face] || 1) * (v.def && v.def.armored ? 1 : 1.35) * (armed ? 1 : 0.15);
      // gameplay-hunt: nicht scharfe Rakete läuft als 'collision' an der Freund-Feind-Prüfung von applyDamage vorbei →
      // eigenes/verbündetes Fahrzeug nahm bis 60 Schaden durch einen Blindgänger; jetzt nur gegen feindliche Fahrzeuge
      const dud = !armed && attacker && typeof v.hostileTo === 'function' && !v.hostileTo(attacker);
      const dealt = dud ? 0 : v.applyDamage((P.vehicleDamage || 300) * mult * r.scale, { attacker, weaponId: def.id, zone: hit.zone, kind: armed ? 'shell' : 'collision', point: at.clone(), dir: dir.clone() });
      if (dealt > 0) G.events.emit('vehicle:hit', { vehicle: v, attacker, amount: dealt, weaponId: def.id, face: hit.face, zone: hit.zone });
    } else if (hit.actor && G.combat) {
      G.combat.damage(hit.actor, { amount: (armed ? P.actorDamage || 150 : 45) * r.scale, attacker, weaponId: def.id, explosive: armed, point: at.clone(), dir: dir.clone(), zone: hit.zone || 'body' });
    }
    if (armed) {
      _p.copy(at);
      if (hit.normal) _p.addScaledVector(hit.normal, 0.25); else _p.addScaledVector(dir, -0.25);
      this._detonate(r, _p, hit.vehicle || null, true);
    } else {
      // Nicht scharf (zu nah): Abpraller mit Funken, keine Explosion
      if (G.effects && typeof G.effects.impact === 'function') G.effects.impact(at, hit.normal || dir.clone().negate(), hit.vehicle ? 'metal' : hit.surface || 'concrete', { big: true });
      G.events.emit('projectile:dud', { rocket: r, position: at.clone(), normal: hit.normal ? hit.normal.clone() : null });
      this._remove(r);
    }
    G.events.emit('projectile:impact', { actor: attacker, weaponId: def.id, position: at.clone(), vehicle: hit.vehicle || null, target: hit.actor || null, armed });
  }

  /** Explosion (Splitter) – Fahrzeuge: das getroffene nimmt den Volltreffer, alle anderen den Splitterschaden. */
  _detonate(r, pos, hitVehicle, splash) {
    const G = this.G;
    const P = r.P, def = r.def, attacker = r.actor || null;
    this._remove(r);
    if (!splash || !G.combat) return;
    const sp = P.splash || { radius: 4.5, innerRadius: 1.2, maxDamage: 130, minDamage: 20 };
    const at = pos.clone();
    G.events.emit('projectile:detonate', { rocket: r, position: at.clone() });
    const boom = () => G.combat.explode({ position: at, radius: sp.radius, maxDamage: sp.maxDamage * r.scale, attacker, weaponId: def.id, type: 'rocket', innerRadius: sp.innerRadius, minDamage: (sp.minDamage || 0) * r.scale, source: 'rocket' });
    const V = G.vehicles;
    if (V && typeof V.ownExplosion === 'function') {
      V.ownExplosion(boom);
      for (const v of V.list || []) {
        if (!v.alive || v === hitVehicle) continue;
        const hull = v.def && v.def.hullBox ? v.def.hullBox[3] : 1.5;
        const d = Math.max(0, v.body.pos.distanceTo(at) - hull);
        if (d > sp.radius) continue;
        v.applyDamage(sp.maxDamage * Math.pow(1 - d / sp.radius, 1.2) * (v.def.explosiveMult ?? 1) * r.scale, { attacker, weaponId: def.id, kind: 'explosive', zone: 'hull', point: at });
      }
    } else boom();
  }

  _remove(r) {
    const i = this.list.indexOf(r);
    if (i >= 0) this.list.splice(i, 1);
    if (r.mesh) { r.mesh.removeFromParent(); r.mesh = null; }
  }

  clear() { for (const r of [...this.list]) this._remove(r); }

  dispose() {
    this.clear();
    if (this._fallback) { this._fallback.geo.dispose(); this._fallback.mat.dispose(); this._fallback = null; }
  }
}
