// NULLPUNKT — Soldat (§8): prozedurales Operator-Modell mit Skelett, Animation, LOD, Trefferzonen,
// Ragdoll-Tod, fallengelassener Waffe und Auflösen der Leiche.
//
// createSoldier({ team, variant, camo, quality, models }) → Soldier
//   team: 'A' | 'B' | null (FFA), camo: Schema-Id (SCHEMES) – Standard aus Team, variant: Id/Index
//   Soldier: root (Group), setWeaponModel(group, def), hitboxes (Liste), animate(dt, params),
//            playHit(dir, zone, amount), playDeath(dir, info), reset(), dispose()
//
// Ein Soldat = 1 SkinnedMesh je Detailstufe (alles in einer Geometrie + einem Material zusammengeführt)
// + Waffe (2–4 Draw Calls). Detailstufen: 0 nah, 1 mittel, 2 fern (Schwellen je Qualität).
import * as THREE from 'three';
import { BONES, BONE, BONE_COUNT, BIND, DIM } from './soldier/rig.js';
import { Animator } from './soldier/animator.js';
import { Ragdoll } from './soldier/ragdoll.js';
import { soldierGeometry, VARIANTS, VARIANT_IDS } from './soldier/gear.js';
import { soldierMaterial, SCHEMES, FFA_SCHEMES } from './soldier/materials.js';
import { raySphere, rayCapsule } from '../combat.js';

export { VARIANTS, VARIANT_IDS, SCHEMES, FFA_SCHEMES };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const ZERO = new THREE.Vector3();

// Gemeinsame Inverse der Bindepose (alle Soldaten haben dieselbe Bindepose)
const BONE_INVERSES = BIND.map((p) => new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));

// Trefferzonen: [Name, Zone, Gelenk A, Gelenk B (oder -1 = Kugel), Radius]
// Gelenke: Knochenindex, oder 'head' (Kopfmitte)
export const HITBOXES = [
  ['kopf', 'head', 'head', -1, 0.135],
  ['hals', 'body', BONE.neck, BONE.head, 0.07],
  ['rumpf', 'body', BONE.spine, BONE.neck, 0.175],
  ['becken', 'body', 'hipL', 'hipR', 0.135],
  ['oberarmL', 'limb', BONE.upperArmL, BONE.foreArmL, 0.062],
  ['unterarmL', 'limb', BONE.foreArmL, BONE.handL, 0.055],
  ['oberarmR', 'limb', BONE.upperArmR, BONE.foreArmR, 0.062],
  ['unterarmR', 'limb', BONE.foreArmR, BONE.handR, 0.055],
  ['oberschenkelL', 'limb', BONE.thighL, BONE.shinL, 0.09],
  ['unterschenkelL', 'limb', BONE.shinL, BONE.footL, 0.068],
  ['oberschenkelR', 'limb', BONE.thighR, BONE.shinR, 0.09],
  ['unterschenkelR', 'limb', BONE.shinR, BONE.footR, 0.068],
];

const LOD_DIST = { high: [13, 36], low: [8, 24] };

let serial = 0;

export class Soldier {
  constructor({ team = null, variant = 0, camo = null, quality = 'high', models = null, name = '' } = {}) {
    this.id = ++serial;
    this.team = team;
    this.scheme = camo && SCHEMES[camo] ? camo : team === 'A' ? 'A' : team === 'B' ? 'B' : FFA_SCHEMES[this.id % FFA_SCHEMES.length];
    const vi = typeof variant === 'number' ? variant : Math.max(0, VARIANT_IDS.indexOf(variant));
    this.variant = VARIANTS[((vi % VARIANTS.length) + VARIANTS.length) % VARIANTS.length].id;
    this.quality = quality === 'low' ? 'low' : 'high';
    this.models = models;
    this.name = name;

    const root = (this.root = new THREE.Group());
    root.name = `soldat:${name || this.id}`;
    // Knochen
    this.bones = BONES.map(([n, , off]) => {
      const b = new THREE.Bone();
      b.name = n;
      b.position.fromArray(off);
      return b;
    });
    for (let i = 0; i < BONE_COUNT; i++) {
      const p = BONES[i][1];
      if (p >= 0) this.bones[p].add(this.bones[i]); else root.add(this.bones[i]);
    }
    this.skeleton = new THREE.Skeleton(this.bones, BONE_INVERSES);
    // Detailstufen
    const mat = soldierMaterial(this.scheme, { quality: this.quality });
    this.material = mat;
    this.meshes = [0, 1, 2].map((lod) => {
      const m = new THREE.SkinnedMesh(soldierGeometry(this.variant, this.scheme, lod), mat);
      m.name = `soldat-lod${lod}`;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = lod === 0;
      m.bind(this.skeleton, new THREE.Matrix4());
      m.visible = lod === 1;
      root.add(m);
      return m;
    });
    this.lod = 1;
    // Waffenhalter (Modellraum, vom Animator gesetzt)
    this.gunHolder = new THREE.Group();
    this.gunHolder.name = 'waffe';
    root.add(this.gunHolder);
    this.gun = null;
    this.def = null;
    this.muzzleLocal = new THREE.Vector3(0, 0.03, -0.6);
    // Requisiten (Granate rechts, Messer links)
    this.props = { grenade: null, knife: null };
    this.anim = new Animator(this);
    this.ragdoll = new Ragdoll();
    this.state = 'alive'; // alive | dead | hidden
    this.deadT = 0;
    this.dissolve = 0;
    this._dissolveMat = null;
    this._drop = null;
    this._hitStamp = -1;
    this._hb = HITBOXES.map(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }));
    this._velModel = new THREE.Vector3();
    this.castShadow = false;
    this.root.visible = false;
    this._writePose();
  }

  /* ================================================================ Waffe */

  /** Drittpersonen-Waffenmodell setzen (Klon aus models.createWeaponModel(..., {lod:'third'})). */
  setWeaponModel(group, def = null) {
    if (this.gun) this.gun.removeFromParent();
    this.gun = group || null;
    this.def = def;
    if (group) {
      this.gunHolder.add(group);
      group.position.set(0, 0, 0);
      group.quaternion.identity();
      group.traverse((o) => { if (o.isMesh) { o.castShadow = this.castShadow; o.frustumCulled = false; } });
    }
    this.anim.setWeapon(group, def);
    this.muzzleLocal.copy(this.anim.anchors.muzzle);
    if (this.anim.magazine) this.anim.magazine.visible = true;
    this._ensureProps();
  }

  _ensureProps() {
    const M = this.models;
    if (!M || !M.createWeaponModel) return;
    try {
      if (!this.props.grenade) {
        const g = M.createWeaponModel('frag', { lod: 'third' });
        g.position.set(-0.03, -0.07, 0);
        g.visible = false;
        this.bones[BONE.handR].add(g);
        this.props.grenade = g;
      }
      if (!this.props.knife) {
        const k = M.createWeaponModel('knife', { lod: 'third' });
        k.position.set(0.026, -0.062, 0);
        k.visible = false;
        this.bones[BONE.handL].add(k);
        this.props.knife = k;
      }
    } catch { /* Modelle optional */ }
  }

  /* ================================================================ Darstellung */

  setShadows(on) {
    on = !!on;
    if (this.castShadow === on) return;
    this.castShadow = on;
    for (const m of this.meshes) m.castShadow = on;
    if (this.gun) this.gun.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  }

  /** Detailstufe aus Kameraabstand (mit Hysterese). */
  updateLod(dist, quality = this.quality) {
    const [d0, d1] = LOD_DIST[quality === 'low' ? 'low' : 'high'];
    let lod = this.lod;
    if (lod === 0 && dist > d0 + 1.5) lod = 1;
    if (lod === 1 && dist < d0 - 1) lod = 0;
    if (lod === 1 && dist > d1 + 2) lod = 2;
    if (lod === 2 && dist < d1 - 2) lod = 1;
    if (lod !== this.lod) {
      this.lod = lod;
      for (let i = 0; i < 3; i++) this.meshes[i].visible = i === lod;
    }
    return lod;
  }

  /** Wurzel setzen (Füße, Körper-Gierung). */
  place(position, yaw) {
    this.root.position.copy(position);
    this.root.rotation.set(0, yaw, 0);
  }

  /* ================================================================ Animation */

  /**
   * params: { velocity (Welt, Vector3) | speed + strafe, aimYaw (Welt), aimPitch, crouch, sprint, ads,
   *           airborne | onGround, firing (Schuss in diesem Bild), shotStrength, reloading, reloadProgress,
   *           reloadEmpty, perShell, throwing, cooking, meleeing, idleLook, position (Füße, Welt) }
   * Gibt die Körper-Gierung zurück.
   */
  animate(dt, params = {}) {
    if (this.state !== 'alive') { this.updateDead(dt, params.world || null); return this.anim.bodyYaw; }
    const a = this.anim;
    const yaw = a.bodyYaw;
    // Welt → Modellraum
    const vm = this._velModel;
    if (params.velocity) {
      const c = Math.cos(-yaw), s = Math.sin(-yaw);
      const vx = params.velocity.x, vz = params.velocity.z;
      vm.set(vx * c + vz * s, 0, -vx * s + vz * c);
    } else {
      vm.set(params.strafe || 0, 0, -(params.speed || 0));
    }
    const p = this._p || (this._p = {});
    p.velocity = vm;
    p.aimYaw = Number.isFinite(params.aimYaw) ? params.aimYaw : yaw;
    p.aimPitch = params.aimPitch || 0;
    p.crouch = typeof params.crouch === 'number' ? params.crouch > 0.5 : !!params.crouch;
    p.sprint = !!params.sprint;
    p.ads = params.ads || 0;
    p.onGround = params.onGround !== undefined ? !!params.onGround : !params.airborne;
    p.reloading = !!params.reloading;
    p.reloadProgress = params.reloadProgress || 0;
    p.reloadEmpty = !!params.reloadEmpty;
    p.perShell = !!params.perShell;
    p.throwing = !!params.throwing;
    p.cooking = !!params.cooking;
    p.meleeing = !!params.meleeing;
    p.idleLook = !!params.idleLook;
    if (params.firing) a.shot(params.shotStrength || 1);
    const bodyYaw = a.update(dt, p);
    if (params.position) this.place(params.position, bodyYaw);
    else this.root.rotation.y = bodyYaw;
    if (this.props.grenade) this.props.grenade.visible = !!a.grenadeVisible;
    if (this.props.knife) this.props.knife.visible = !!a.knifeVisible;
    this._writePose();
    return bodyYaw;
  }

  /** Nur Zeit/Phase fortschreiben, ohne Pose (unsichtbare/ferne Soldaten). */
  _writePose() {
    const a = this.anim;
    for (let i = 0; i < BONE_COUNT; i++) this.bones[i].quaternion.copy(a.lq[i]);
    this.bones[0].position.copy(a.hipsPos);
    this.gunHolder.position.copy(a.gunPos);
    this.gunHolder.quaternion.copy(a.gunQuat);
    this._hitStamp = -1;
  }

  /** Bodenanpassung der Füße (Treppen): dy links/rechts relativ zur Wurzel. */
  setGroundOffsets(l, r) {
    const a = this.anim;
    if (!a.groundOff) a.groundOff = [0, 0];
    a.groundOff[0] = l;
    a.groundOff[1] = r;
    a.feetLift = Math.max(0, -Math.min(l, r)) * 0.9;
  }

  playHit(dirWorld, zone = 'body', amount = 25) {
    if (this.state !== 'alive' || !dirWorld) return;
    const yaw = this.anim.bodyYaw;
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    _v.set(dirWorld.x * c + dirWorld.z * s, dirWorld.y, -dirWorld.x * s + dirWorld.z * c);
    this.anim.hit(_v, zone, amount);
  }

  /* ================================================================ Gelenke (Welt) */

  /** Modellraum → Welt (in place). */
  toWorld(v) {
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const x = v.x, z = v.z;
    v.x = x * c + z * s + this.root.position.x;
    v.z = -x * s + z * c + this.root.position.z;
    v.y += this.root.position.y;
    return v;
  }

  toModel(v) {
    const yaw = this.root.rotation.y;
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    const x = v.x - this.root.position.x, z = v.z - this.root.position.z;
    v.x = x * c + z * s;
    v.z = -x * s + z * c;
    v.y -= this.root.position.y;
    return v;
  }

  /** Weltposition eines Gelenks (Knochenindex oder 'head', 'hipL', 'hipR'). */
  joint(id, out = new THREE.Vector3()) {
    const a = this.anim;
    if (id === 'head') out.copy(a.headCenter);
    else if (id === 'hipL' || id === 'hipR') out.copy(a.wp[id === 'hipL' ? BONE.thighL : BONE.thighR]);
    else out.copy(a.wp[id]);
    return this.toWorld(out);
  }

  getHeadPosition(out = new THREE.Vector3()) { return this.joint('head', out); }

  /** Mündung in Weltkoordinaten (aus der aktuellen Pose). */
  getMuzzlePosition(out = new THREE.Vector3()) {
    const a = this.anim;
    out.copy(this.muzzleLocal).applyQuaternion(a.gunQuat).add(a.gunPos);
    return this.toWorld(out);
  }

  /* ================================================================ Trefferzonen */

  _updateHitboxes() {
    const a = this.anim;
    for (let i = 0; i < HITBOXES.length; i++) {
      const [, , A, B] = HITBOXES[i];
      const hb = this._hb[i];
      this.joint(A, hb.a);
      if (B !== -1) this.joint(B, hb.b);
      if (i === 2) hb.b.lerp(hb.a, 0.22); // Rumpf endet unter dem Kinn
      // Unterarm bis in die Hand, Unterschenkel bis zur Sohle verlängern
      if (A === BONE.foreArmL || A === BONE.foreArmR || A === BONE.shinL || A === BONE.shinR) {
        _v.subVectors(hb.b, hb.a).multiplyScalar(A === BONE.shinL || A === BONE.shinR ? 0.12 : 0.3);
        hb.b.add(_v);
      }
    }
    void a;
    this._hitStamp = 1;
  }

  /** Aktuelle Trefferzonen (Welt): [{ name, zone, a, b, r }] – b === null bei Kugeln. */
  get hitboxes() {
    if (this._hitStamp < 0) this._updateHitboxes();
    return HITBOXES.map(([name, zone, , B, r], i) => ({ name, zone, a: this._hb[i].a, b: B === -1 ? null : this._hb[i].b, r }));
  }

  /** Strahl gegen die Trefferzonen → { distance, point, normal, zone } | null. */
  raycast(ray, maxDist = Infinity) {
    if (this.state !== 'alive') return null;
    if (this._hitStamp < 0) this._updateHitboxes();
    const ro = ray.origin, rd = ray.direction;
    // Hüllkugel um die Brust
    const c = this._hb[2].a;
    _v2.copy(c).add(this._hb[2].b).multiplyScalar(0.5);
    if (raySphere(ro, rd, _v2, 1.35) < 0) return null;
    let best = -1, bi = -1;
    for (let i = 0; i < HITBOXES.length; i++) {
      const hb = this._hb[i];
      const r = HITBOXES[i][4];
      const t = HITBOXES[i][3] === -1 ? raySphere(ro, rd, hb.a, r) : rayCapsule(ro, rd, hb.a, hb.b, r);
      if (t >= 0 && t <= maxDist && (best < 0 || t < best)) { best = t; bi = i; }
    }
    if (bi < 0) return null;
    const point = new THREE.Vector3().copy(rd).multiplyScalar(best).add(ro);
    const hb = this._hb[bi];
    const normal = new THREE.Vector3();
    if (HITBOXES[bi][3] === -1) normal.subVectors(point, hb.a);
    else {
      // nächster Punkt auf der Achse
      _v.subVectors(hb.b, hb.a);
      const len2 = _v.lengthSq() || 1;
      const s = Math.max(0, Math.min(1, _v2.subVectors(point, hb.a).dot(_v) / len2));
      normal.copy(point).sub(_v2.copy(hb.a).addScaledVector(_v, s));
    }
    if (normal.lengthSq() < 1e-8) normal.copy(rd).negate(); else normal.normalize();
    return { distance: best, point, normal, zone: HITBOXES[bi][1], part: HITBOXES[bi][0] };
  }

  /* ================================================================ Tod */

  /**
   * Ragdoll starten. dirWorld: Schussrichtung; info: { velocity, zone, strength, explosive, scene }
   */
  playDeath(dirWorld, info = {}) {
    if (this.state !== 'alive') return;
    this.state = 'dead';
    this.deadT = 0;
    this.dissolve = 0;
    const a = this.anim;
    if (this.props.grenade) this.props.grenade.visible = false;
    if (this.props.knife) this.props.knife.visible = false;
    if (a.magazine) a.magazine.visible = true;
    const joints = (i, out) => {
      const map = [BONE.thighL, BONE.thighR, BONE.upperArmL, BONE.upperArmR, 'head', BONE.shinL, BONE.footL, BONE.shinR, BONE.footR, BONE.foreArmL, BONE.handL, BONE.foreArmR, BONE.handR];
      return this.joint(map[i], out);
    };
    const dir = dirWorld ? _v.copy(dirWorld).normalize() : _v.set(-Math.sin(a.bodyYaw), 0, -Math.cos(a.bodyYaw)).negate();
    this.ragdoll.start(joints, info.velocity || ZERO, dir, info.strength ?? 1, info.zone || 'body', !!info.explosive);
    this._dropGun(dir, info);
  }

  _dropGun(dir, info) {
    const gun = this.gun;
    const scene = info.scene || (this.root.parent || null);
    if (!gun || !scene) return;
    this.root.updateMatrixWorld(true);
    gun.updateMatrixWorld(true);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    gun.matrixWorld.decompose(pos, quat, scl);
    gun.removeFromParent();
    scene.add(gun);
    gun.position.copy(pos);
    gun.quaternion.copy(quat);
    const vel = new THREE.Vector3().copy(info.velocity || ZERO).multiplyScalar(0.6).addScaledVector(dir, 1.2);
    vel.y += 1.2;
    const spin = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8);
    this._drop = { gun, vel, spin, rest: false, ground: null, t: 0 };
  }

  _updateDrop(dt, world) {
    const d = this._drop;
    if (!d || d.rest) return;
    d.t += dt;
    const g = d.gun;
    d.vel.y -= 16 * dt;
    g.position.addScaledVector(d.vel, dt);
    _q.setFromEuler(new THREE.Euler(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt));
    g.quaternion.premultiply(_q);
    if (d.ground === null || d.t % 0.2 < dt) {
      const gy = world && world.groundHeight ? world.groundHeight(g.position.x, g.position.z, g.position.y + 0.5) : 0;
      d.ground = gy == null ? -50 : gy;
    }
    if (g.position.y < d.ground + 0.04) {
      g.position.y = d.ground + 0.04;
      d.vel.multiplyScalar(0.35);
      d.vel.y = Math.abs(d.vel.y) * 0.2;
      d.spin.multiplyScalar(0.4);
      // flach auf die Seite legen (Lauf bleibt in der Horizontalen)
      _v.set(0, 0, -1).applyQuaternion(g.quaternion);
      _v.y = 0;
      if (_v.lengthSq() < 1e-4) _v.set(0, 0, -1);
      _v.normalize();
      const yaw = Math.atan2(-_v.x, -_v.z);
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ'));
      g.quaternion.slerp(target, 0.35);
      if (d.vel.lengthSq() < 0.05 && d.t > 0.4) { g.quaternion.copy(target); d.rest = true; }
    }
  }

  /** Leiche: Ragdoll, Waffe, Auflösen. Rückgabe: true solange sichtbar. */
  updateDead(dt, world) {
    if (this.state !== 'dead') return false;
    this.deadT += dt;
    const rd = this.ragdoll;
    if (!rd.asleep) {
      rd.update(dt, world);
      rd.apply(this.anim, (v) => this.toModel(v));
      this._writePose();
    }
    this._updateDrop(dt, world);
    // Auflösen nach ~4,5 s
    if (this.deadT > 4.5) {
      if (!this._dissolveMat) this._dissolveMat = soldierMaterial(this.scheme, { dissolve: true, quality: this.quality });
      if (this.meshes[0].material !== this._dissolveMat) {
        for (const m of this.meshes) { m.material = this._dissolveMat; m.castShadow = false; }
      }
      this.dissolve = Math.min(1, (this.deadT - 4.5) / 1.1);
      this._dissolveMat.userData.uDissolve.value = this.dissolve;
      if (this._drop && this.dissolve > 0.6) this._drop.gun.visible = false;
      if (this.dissolve >= 1) { this.hide(); return false; }
    }
    return true;
  }

  /** Sofort ausblenden (z. B. vor Wiederverwendung). */
  hide() {
    this.state = 'hidden';
    this.root.visible = false;
    this._restoreGun();
  }

  _restoreGun() {
    const d = this._drop;
    if (d) {
      d.gun.removeFromParent();
      d.gun.visible = true;
      this.gunHolder.add(d.gun);
      d.gun.position.set(0, 0, 0);
      d.gun.quaternion.identity();
      this._drop = null;
    }
  }

  /** Lebendig zurücksetzen (Respawn). */
  reset(position, yaw = 0) {
    this._restoreGun();
    for (const m of this.meshes) { m.material = this.material; m.castShadow = this.castShadow; }
    this.state = 'alive';
    this.deadT = 0;
    this.dissolve = 0;
    this.ragdoll.active = false;
    this.anim.reset(yaw);
    if (this.anim.magazine) this.anim.magazine.visible = true;
    if (position) this.place(position, yaw);
    this.root.visible = true;
    this._writePose();
  }

  dispose() {
    this._restoreGun();
    if (this.gun) this.gun.removeFromParent();
    this.root.removeFromParent();
    if (this._dissolveMat) { this._dissolveMat.dispose(); this._dissolveMat = null; }
    this.skeleton.dispose();
    // Geometrien/Materialien sind geteilt (Cache) und bleiben bestehen
  }
}

/** Vertrags-Fabrik (§8). */
export function createSoldier(opts = {}) {
  return new Soldier(opts);
}

export { DIM };
