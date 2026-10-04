// NULLPUNKT — „Physics-lite“-Ragdoll: 13 Verlet-Partikel (Hüften, Schultern, Kopf, Knie, Knöchel,
// Ellbogen, Handgelenke) mit Abstands- und Bereichs-Bedingungen. Kollision: Boden über
// world.groundHeight (Treppen, Kisten, Dächer), Wände über world.raycast für Rumpf + Kopf.
// Kommt zur Ruhe (schläft) und wird zurück auf das Skelett abgebildet.
import * as THREE from 'three';
import { BONE, DIM } from './rig.js';
import { quatFromYZ, quatFromXY, clamp } from './ik.js';

const P = { hipL: 0, hipR: 1, shL: 2, shR: 3, head: 4, kneeL: 5, ankleL: 6, kneeR: 7, ankleR: 8, elbowL: 9, wristL: 10, elbowR: 11, wristR: 12 };
const RADIUS = [0.11, 0.11, 0.1, 0.1, 0.12, 0.065, 0.06, 0.065, 0.06, 0.055, 0.05, 0.055, 0.05];
const HEAVY = [true, true, true, true, true, false, false, false, false, false, false, false, false];
// [a, b, minFactor, maxFactor] — Faktor bezogen auf den Startabstand
const LINKS = [
  [0, 1, 1, 1], [2, 3, 1, 1], [0, 2, 1, 1], [1, 3, 1, 1], [0, 3, 1, 1], [1, 2, 1, 1],
  [4, 2, 1, 1], [4, 3, 1, 1], [4, 0, 0.9, 1.04], [4, 1, 0.9, 1.04],
  [0, 5, 1, 1], [5, 6, 1, 1], [1, 7, 1, 1], [7, 8, 1, 1], [0, 6, 0.42, 1], [1, 8, 0.42, 1],
  [2, 9, 1, 1], [9, 10, 1, 1], [3, 11, 1, 1], [11, 12, 1, 1], [2, 10, 0.3, 1], [3, 12, 0.3, 1],
  [5, 7, 0.55, 3], [6, 8, 0.45, 4], [10, 12, 0.3, 6], [4, 6, 0.7, 2], [4, 8, 0.7, 2],
];
const GRAVITY = -17;

const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _mid = new THREE.Vector3();
const _mid2 = new THREE.Vector3();

export class Ragdoll {
  constructor() {
    this.p = Array.from({ length: 13 }, () => new THREE.Vector3());
    this.o = Array.from({ length: 13 }, () => new THREE.Vector3());
    this.ground = new Float32Array(13);
    this.groundXZ = Array.from({ length: 13 }, () => new THREE.Vector2(1e9, 1e9));
    this.rest = new Float32Array(LINKS.length);
    this.active = false;
    this.asleep = false;
    this.t = 0;
    this.calm = 0;
  }

  /**
   * Start aus der aktuellen Pose. joints(i) liefert Weltposition des Partikels i.
   * vel: Körpergeschwindigkeit (Welt), dir: Schussrichtung (Welt, normiert), strength 0..2, zone.
   */
  start(joints, vel, dir, strength = 1, zone = 'body', explosive = false) {
    for (let i = 0; i < 13; i++) {
      joints(i, this.p[i]);
      this.groundXZ[i].set(1e9, 1e9);
    }
    for (let k = 0; k < LINKS.length; k++) this.rest[k] = this.p[LINKS[k][0]].distanceTo(this.p[LINKS[k][1]]);
    const dt = 1 / 60;
    const imp = _d.copy(dir || _v.set(0, 0, 1));
    imp.y = Math.max(imp.y, -0.2);
    imp.normalize();
    const hitIdx = zone === 'head' ? [4] : zone === 'limb' ? [5, 7, 9, 11] : [2, 3];
    for (let i = 0; i < 13; i++) {
      // Grundgeschwindigkeit + Impuls (Oberkörper stärker → kippt in Schussrichtung)
      const upper = i <= 4 || i >= 9;
      let k = (upper ? 1.6 : 0.35) * strength;
      if (hitIdx.includes(i)) k *= 1.5;
      _v.copy(vel || _w.set(0, 0, 0)).multiplyScalar(0.85).addScaledVector(imp, k);
      if (explosive) _v.y += 3.2 * strength * (upper ? 1 : 0.8);
      // Knie knicken nach vorn ein
      if (i === 5 || i === 7) _v.addScaledVector(imp, -0.6).y -= 0.4;
      this.o[i].copy(this.p[i]).addScaledVector(_v, -dt);
    }
    this.active = true;
    this.asleep = false;
    this.t = 0;
    this.calm = 0;
  }

  update(dt, world) {
    if (!this.active || this.asleep) return;
    this.t += dt;
    const steps = dt > 1 / 50 ? 2 : 1;
    const h = Math.min(dt / steps, 1 / 40);
    let maxMove = 0;
    for (let s = 0; s < steps; s++) {
      // Integration
      for (let i = 0; i < 13; i++) {
        const p = this.p[i], o = this.o[i];
        _v.subVectors(p, o).multiplyScalar(0.985);
        o.copy(p);
        p.add(_v);
        p.y += GRAVITY * h * h;
      }
      // Bedingungen
      for (let it = 0; it < 5; it++) {
        for (let k = 0; k < LINKS.length; k++) {
          const [a, b, mn, mx] = LINKS[k];
          const pa = this.p[a], pb = this.p[b];
          _d.subVectors(pb, pa);
          const len = _d.length() || 1e-6;
          const r = this.rest[k];
          let target = len;
          if (len < r * mn) target = r * mn; else if (len > r * mx) target = r * mx; else continue;
          const diff = (len - target) / len;
          const wa = HEAVY[a] && !HEAVY[b] ? 0.25 : !HEAVY[a] && HEAVY[b] ? 0.75 : 0.5;
          pa.addScaledVector(_d, diff * wa);
          pb.addScaledVector(_d, -diff * (1 - wa));
        }
        this._collide(world, it === 4);
      }
      for (let i = 0; i < 13; i++) maxMove = Math.max(maxMove, this.p[i].distanceToSquared(this.o[i]));
    }
    // Ruhe
    if (Math.sqrt(maxMove) < 0.0025 && this.t > 0.6) this.calm += dt; else this.calm = 0;
    if (this.calm > 0.4 || this.t > 4) this.asleep = true;
  }

  _collide(world, walls) {
    for (let i = 0; i < 13; i++) {
      const p = this.p[i], o = this.o[i], r = RADIUS[i];
      // Wände (nur Rumpf/Kopf, letzte Iteration)
      if (walls && HEAVY[i] && world && world.raycast) {
        _d.subVectors(p, o);
        const len = _d.length();
        if (len > 1e-4) {
          _d.multiplyScalar(1 / len);
          const hit = world.raycast(o, _d, len + r);
          if (hit && hit.normal && hit.normal.y < 0.6) {
            p.copy(o).addScaledVector(_d, Math.max(0, hit.distance - r));
            // Geschwindigkeit entlang der Normalen tilgen
            _v.subVectors(p, o);
            const vn = _v.dot(hit.normal);
            if (vn < 0) o.addScaledVector(hit.normal, vn);
          }
        }
      }
      // Boden
      const g = this.groundXZ[i];
      if (Math.abs(g.x - p.x) > 0.12 || Math.abs(g.y - p.z) > 0.12) {
        let gy = world && world.groundHeight ? world.groundHeight(p.x, p.z, p.y + 0.6) : 0;
        if (gy == null) gy = -50;
        this.ground[i] = gy;
        g.set(p.x, p.z);
      }
      const floor = this.ground[i] + r;
      if (p.y < floor) {
        p.y = floor;
        // Reibung + kaum Rückprall
        o.x += (p.x - o.x) * 0.45;
        o.z += (p.z - o.z) * 0.45;
        if (o.y < p.y) o.y = p.y + (p.y - o.y) * 0.05;
      }
    }
  }

  /** Partikel → Skelett (Animator-Modellraum). toModel(v) wandelt Welt → Modellraum (in place). */
  apply(anim, toModel) {
    const m = this._m || (this._m = Array.from({ length: 13 }, () => new THREE.Vector3()));
    for (let i = 0; i < 13; i++) toModel(m[i].copy(this.p[i]));
    const wq = anim.wq, wp = anim.wp, lq = anim.lq;
    // Becken
    _mid.addVectors(m[P.hipL], m[P.hipR]).multiplyScalar(0.5);
    _mid2.addVectors(m[P.shL], m[P.shR]).multiplyScalar(0.5);
    _x.subVectors(m[P.hipR], m[P.hipL]);
    _y.subVectors(_mid2, _mid);
    quatFromXY(_q, _x, _y);
    wq[0].copy(_q);
    lq[0].copy(_q);
    wp[0].set(0, DIM.hipDrop, 0).applyQuaternion(_q).add(_mid);
    anim.hipsPos.copy(wp[0]);
    // Brust
    _x.subVectors(m[P.shR], m[P.shL]);
    quatFromXY(_q2, _x, _y);
    _q.copy(wq[0]).slerp(_q2, 0.45);
    anim._setWorld(BONE.spine, _q);
    anim._setWorld(BONE.chest, _q2);
    // Hals + Kopf
    const neckPos = _w.copy(anim.off[BONE.neck]).applyQuaternion(wq[BONE.chest]).add(wp[BONE.chest]);
    _y.subVectors(m[P.head], neckPos);
    _z.set(0, 0, 1).applyQuaternion(_q2);
    quatFromYZ(_q, _y, _z);
    const headQ = _q.clone();
    _q.copy(_q2).slerp(headQ, 0.5);
    anim._setWorld(BONE.neck, _q);
    anim._setWorld(BONE.head, headQ);
    // Gliedmaßen
    const limb = (bone, a, b, c, knee) => {
      // bone: oberer Knochen; a = oberes Gelenk, b = mittleres, c = unteres
      _mid.addVectors(m[a], m[c]).multiplyScalar(0.5);
      _d.subVectors(m[b], _mid); // Beugerichtung (zum Mittelgelenk)
      if (_d.lengthSq() < 1e-5) _d.set(0, 0, knee ? -1 : 1).applyQuaternion(wq[0]);
      if (knee) _d.negate(); // Kniescheibe (−Z) zeigt in Beugerichtung; Ellbogenspitze (+Z)
      _y.subVectors(m[a], m[b]);
      quatFromYZ(_q, _y, _d);
      anim._setWorld(bone, _q);
      _y.subVectors(m[b], m[c]);
      quatFromYZ(_q, _y, _d);
      anim._setWorld(bone + 1, _q);
    };
    limb(BONE.upperArmL, P.shL, P.elbowL, P.wristL, false);
    anim._setWorld(BONE.handL, wq[BONE.foreArmL]);
    limb(BONE.upperArmR, P.shR, P.elbowR, P.wristR, false);
    anim._setWorld(BONE.handR, wq[BONE.foreArmR]);
    limb(BONE.thighL, P.hipL, P.kneeL, P.ankleL, true);
    limb(BONE.thighR, P.hipR, P.kneeR, P.ankleR, true);
    for (const ft of [BONE.footL, BONE.footR]) {
      _q.setFromAxisAngle(_x.set(1, 0, 0), -0.55);
      _q2.multiplyQuaternions(wq[ft - 1], _q);
      anim._setWorld(ft, _q2);
    }
    anim.headCenter.fromArray(DIM.headCenter).applyQuaternion(wq[BONE.head]).add(wp[BONE.head]);
    void clamp;
  }
}

export const RAGDOLL_JOINT_BONES = [
  BONE.thighL, BONE.thighR, BONE.upperArmL, BONE.upperArmR, -1, BONE.shinL, BONE.footL, BONE.shinR, BONE.footR,
  BONE.foreArmL, BONE.handL, BONE.foreArmR, BONE.handR,
];
