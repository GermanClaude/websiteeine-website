// NULLPUNKT — Ballistische Granaten der Fahrzeugkanonen (Schwerkraft, Teilschritt-Strahlen gegen Welt, Fahrzeuge,
// Akteure). Treffer: Fahrzeuge → Schaden nach Trefferseite (vorn ×0,6, Seite ×1, hinten ×2, oben ×1,6) mit
// Abprallern bei flachem Auftreffwinkel (> 70°), Akteure → Volltreffer, überall Splash über combat.explode.
// Darstellung: kleiner additiver Leuchtspur-Körper je Granate (Pool, höchstens MAX gleichzeitig).
import * as THREE from 'three';

const MAX = 24;
const FACE_MULT = { front: 0.6, side: 1.0, rear: 2.0, top: 1.6 };
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _ray = new THREE.Ray();

export class ShellPool {
  constructor(sys) {
    this.sys = sys;
    this.list = [];
    this.free = [];
    this.geo = new THREE.CylinderGeometry(0.05, 0.11, 2.2, 6, 1, true).rotateX(Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.group = new THREE.Group();
    this.group.name = 'vehicle-shells';
  }

  attach(scene) { if (!this.group.parent) scene.add(this.group); }

  fire(def, origin, dir, shooter, vehicle) {
    if (this.list.length >= MAX) this._remove(this.list[0]);
    let mesh = this.free.pop();
    if (!mesh) { mesh = new THREE.Mesh(this.geo, this.mat); mesh.frustumCulled = false; mesh.renderOrder = 6; }
    this.group.add(mesh);
    const vel = dir.clone().multiplyScalar(def.speed);
    if (vehicle) vel.add(vehicle.body.vel);
    const s = { def, pos: origin.clone(), vel, shooter, vehicle, age: 0, mesh, ricochets: 0 };
    mesh.position.copy(s.pos);
    this.list.push(s);
    return s;
  }

  _remove(s) {
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
    s.mesh.removeFromParent();
    this.free.push(s.mesh);
  }

  update(dt) {
    const sys = this.sys;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.age += dt;
      if (s.age > s.def.life) { this._remove(s); continue; }
      const speed = s.vel.length();
      const n = Math.min(8, Math.max(1, Math.ceil((speed * dt) / 12)));
      const h = dt / n;
      let done = false;
      for (let k = 0; k < n && !done; k++) {
        _p.copy(s.pos);
        s.vel.y -= s.def.gravity * h;
        s.pos.addScaledVector(s.vel, h);
        _d.copy(s.pos).sub(_p);
        const len = _d.length();
        if (len < 1e-6) continue;
        _d.multiplyScalar(1 / len);
        const hit = sys.traceShell(_p, _d, len, s);
        if (hit) done = this._impact(s, hit, _d.clone());
      }
      if (done) { this._remove(s); continue; }
      // Darstellung: Körper entlang der Flugbahn
      s.mesh.position.copy(s.pos);
      _q.setFromUnitVectors(_z, _d.copy(s.vel).normalize());
      s.mesh.quaternion.copy(_q);
      const bounds = sys.world && sys.world.bounds;
      if (bounds && s.pos.y < bounds.min.y - 20) this._remove(s);
    }
  }

  /** → true, wenn die Granate verbraucht ist (sonst Abpraller, fliegt weiter). */
  _impact(s, hit, dir) {
    const sys = this.sys, G = sys.G, def = s.def;
    const attacker = s.shooter || null;
    const p = hit.point;
    if (hit.vehicle) {
      const v = hit.vehicle;
      const cos = -dir.dot(hit.normal);
      if (def.penetrating && cos < 0.34 && s.ricochets < 1 && v.def.armored) {
        // Abpraller: reflektieren, halbe Energie
        s.ricochets++;
        s.vel.reflect(hit.normal).multiplyScalar(0.45);
        s.pos.copy(p).addScaledVector(hit.normal, 0.05);
        G.effects?.impact?.(p, hit.normal, 'metal', { big: true });
        sys.audio.play('ricochet', { position: p, volume: 1, pitch: 0.55 });
        G.events.emit('vehicle:ricochet', { vehicle: v, attacker, weaponId: def.id, point: p.clone() });
        return false;
      }
      const mult = (FACE_MULT[hit.face] || 1) * (v.def.armored ? 1 : 1.35);
      const dealt = v.applyDamage(def.vehicleDamage * mult, { attacker, weaponId: def.id, zone: hit.zone, kind: 'shell', point: p, dir });
      if (dealt > 0) G.events.emit('vehicle:hit', { vehicle: v, attacker, amount: dealt, weaponId: def.id, face: hit.face, zone: hit.zone });
    } else if (hit.actor) {
      G.combat.damage(hit.actor, { amount: def.actorDamage, attacker, weaponId: def.id, explosive: true, point: p, dir, zone: 'body' });
    }
    // Splash (Infanterie) – leicht vor der Oberfläche, damit die Sichtprüfung nicht in der Wand startet
    const at = p.clone();
    if (hit.normal) at.addScaledVector(hit.normal, 0.25); else at.addScaledVector(dir, -0.25);
    const sp = def.splash;
    sys.ownExplosion(() => G.combat.explode({ position: at, radius: sp.radius, maxDamage: sp.maxDamage, attacker, weaponId: def.id, type: def.penetrating ? 'shell_ap' : 'shell_he', innerRadius: sp.innerRadius, minDamage: sp.minDamage }));
    // Splash auf andere Fahrzeuge
    for (const v of sys.list) {
      if (!v.alive || v === hit.vehicle) continue;
      const d = Math.max(0, v.body.pos.distanceTo(at) - v.def.hullBox[3]);
      if (d > sp.radius) continue;
      const dmg = sp.maxDamage * Math.pow(1 - d / sp.radius, 1.2) * v.def.explosiveMult;
      v.applyDamage(dmg, { attacker, weaponId: def.id, kind: 'explosive', zone: 'hull', point: at });
    }
    return true;
  }

  clear() { for (const s of [...this.list]) this._remove(s); }

  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Strahl gegen Akteur-Trefferzonen (alle lebenden, feindlichen; ohne Insassen des eigenen Fahrzeugs). */
export function raycastActors(G, shooter, ownVehicle, origin, dir, maxDist) {
  _ray.set(origin, dir);
  let best = null;
  for (const a of G.actors) {
    if (!a.alive || a === shooter || typeof a.raycastHitboxes !== 'function') continue;
    if (ownVehicle && a.vehicle === ownVehicle) continue;
    if (shooter && G.combat && !G.combat.isHostile(shooter, a)) continue;
    const h = a.raycastHitboxes(_ray, best ? best.distance : maxDist);
    if (h && h.distance <= maxDist && (!best || h.distance < best.distance)) best = { ...h, actor: a };
  }
  return best;
}
