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
// Rumpf-Boden-Korrektur: Partikel (Index, Anteil) – Schultern/Kopf voll, Becken halb
const TORSO_PUSH = [[2, 1], [3, 1], [4, 0.9], [0, 0.45], [1, 0.45]];

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
const _q3 = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0);
const _qFoot = new THREE.Quaternion().setFromAxisAngle(_ax, -0.55); // Fußspitzen gestreckt

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
   * style (Todesart, rein optisch): 'back' (in Schussrichtung umgeworfen), 'crumple' (sackt in sich zusammen),
   * 'forward' (stolpert nach vorn aufs Gesicht), 'twist' (dreht sich weg und fällt seitlich), 'knees' (auf die Knie,
   * dann vornüber). depth: { front, back } – Dicke von Weste/Rucksack ab Rumpfmitte (Boden-Kollision des Rumpfs).
   */
  start(joints, vel, dir, strength = 1, zone = 'body', explosive = false, style = 'back', depth = null) {
    for (let i = 0; i < 13; i++) {
      joints(i, this.p[i]);
      this.groundXZ[i].set(1e9, 1e9);
    }
    for (let k = 0; k < LINKS.length; k++) this.rest[k] = this.p[LINKS[k][0]].distanceTo(this.p[LINKS[k][1]]);
    this.front = depth && Number.isFinite(depth.front) ? depth.front : 0.2;
    this.back = depth && Number.isFinite(depth.back) ? depth.back : 0.2;
    this.style = explosive ? 'back' : style || 'back';
    const dt = 1 / 60;
    const imp = _d.copy(dir || _v.set(0, 0, 1));
    imp.y = Math.max(imp.y, -0.2);
    imp.normalize();
    // Blickrichtung des Körpers (waagrecht): oben × rechts
    const fwd = _x.subVectors(this.p[3], this.p[2]);
    fwd.set(-fwd.z, 0, fwd.x); // (0,1,0) × (x,y,z) = (z, 0, −x) → vorn = −(…): Rechtsvektor um 90° nach vorn gedreht
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); else fwd.normalize();
    fwd.negate();
    const side = Math.random() < 0.5 ? -1 : 1; // Drehrichtung (Wegdrehen)
    const st = this.style;
    const hitIdx = zone === 'head' ? [4] : zone === 'limb' ? [5, 7, 9, 11] : [2, 3];
    for (let i = 0; i < 13; i++) {
      const upper = i <= 4 || i >= 9;
      _v.copy(vel || _w.set(0, 0, 0)).multiplyScalar(0.85);
      if (st === 'crumple') {
        // Beine geben nach: Becken fällt, Knie nach vorn unten, Oberkörper sackt hinterher (wenig Schussimpuls)
        _v.addScaledVector(imp, (upper ? 0.45 : 0.12) * strength);
        if (i === 0 || i === 1) _v.y -= 1.5;
        if (i === 5 || i === 7) _v.addScaledVector(fwd, 1.0).y -= 1.1;
        if (i === 2 || i === 3 || i === 4) _v.addScaledVector(fwd, 0.3).y -= 0.4;
      } else if (st === 'forward') {
        // nach vorn: Oberkörper kippt in Blickrichtung, Füße bleiben hängen
        _v.addScaledVector(imp, (upper ? 0.5 : 0.15) * strength);
        if (upper) _v.addScaledVector(fwd, 1.5 * Math.min(1.3, strength));
        if (i === 6 || i === 8) _v.addScaledVector(fwd, -0.4);
        if (i === 5 || i === 7) _v.addScaledVector(fwd, 0.5).y -= 0.5;
      } else if (st === 'twist') {
        // Wegdrehen um die Hochachse (Schultern gegenläufig) und seitlich fallen
        let k = (upper ? 0.9 : 0.25) * strength;
        if (hitIdx.includes(i)) k *= 1.3;
        _v.addScaledVector(imp, k);
        const left = i === 2 || i === 9 || i === 10 ? 1 : i === 3 || i === 11 || i === 12 ? -1 : 0;
        if (left) _v.addScaledVector(fwd, left * side * 1.5);
        if (i === 4) _v.addScaledVector(_w.set(fwd.z, 0, -fwd.x), side * 0.6);
        if (i === 5 || i === 7) _v.addScaledVector(fwd, 0.4).y -= 0.6;
      } else if (st === 'knees') {
        // auf die Knie: Becken sackt senkrecht, Knie nach vorn; Oberkörper kippt verzögert vornüber
        _v.addScaledVector(imp, (upper ? 0.3 : 0.1) * strength);
        if (i === 0 || i === 1) _v.y -= 2.0;
        if (i === 5 || i === 7) _v.addScaledVector(fwd, 0.7).y -= 1.7;
        if (i === 2 || i === 3 || i === 4) _v.addScaledVector(fwd, 0.45);
      } else {
        // Grundgeschwindigkeit + Impuls (Oberkörper stärker → kippt in Schussrichtung)
        let k = (upper ? 1.6 : 0.35) * strength;
        if (hitIdx.includes(i)) k *= 1.5;
        _v.addScaledVector(imp, k);
        // Knie knicken nach vorn ein
        if (i === 5 || i === 7) _v.addScaledVector(imp, -0.6).y -= 0.4;
      }
      if (explosive) _v.y += 3.2 * strength * (upper ? 1 : 0.8);
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
          const L = LINKS[k];
          const a = L[0], b = L[1], mn = L[2], mx = L[3];
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

  /**
   * Rumpf gegen den Boden: Weste vorn und Rucksack hinten ragen weit über die Partikelradien hinaus (bis 0,37 m ab
   * Rumpfmitte). Liegt die Leiche auf Brust oder Rücken, hebt das den Oberkörper an, statt Weste/Rucksack im Boden
   * versinken zu lassen (Leichen bleiben liegen – die Endlage muss stimmen).
   */
  _torso() {
    const p = this.p, o = this.o, g = this.ground;
    const S = _mid.addVectors(p[2], p[3]).multiplyScalar(0.5);
    const H = _mid2.addVectors(p[0], p[1]).multiplyScalar(0.5);
    _y.subVectors(S, H);
    _x.subVectors(p[3], p[2]);
    _z.crossVectors(_y, _x); // vorn (Brust)
    if (_z.lengthSq() < 1e-8) return;
    _z.normalize();
    const cy = H.y + (S.y - H.y) * 0.68;
    const gy = (g[2] + g[3]) * 0.34 + (g[0] + g[1]) * 0.16;
    const low = Math.min(cy + _z.y * this.front, cy - _z.y * this.back);
    const pen = gy + 0.012 - low;
    if (!(pen > 0)) return;
    const push = Math.min(pen, 0.08); // je Iteration begrenzt (kein Hochschnellen)
    for (const [i, k] of TORSO_PUSH) { p[i].y += push * k; o[i].y += push * k; }
  }

  _collide(world, walls) {
    if (walls && this.front) this._torso();
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
    quatFromYZ(_q3, _y, _z); // Kopf
    _q.copy(_q2).slerp(_q3, 0.5);
    anim._setWorld(BONE.neck, _q);
    anim._setWorld(BONE.head, _q3);
    // Gliedmaßen (Hände/Füße: nicht in den Boden – die Leiche bleibt so liegen)
    limb(anim, m, BONE.upperArmL, P.shL, P.elbowL, P.wristL, false);
    anim._setWorld(BONE.handL, wq[BONE.foreArmL]);
    this._aboveGround(anim, m, BONE.handL, P.wristL, HAND_TIP, null);
    limb(anim, m, BONE.upperArmR, P.shR, P.elbowR, P.wristR, false);
    anim._setWorld(BONE.handR, wq[BONE.foreArmR]);
    this._aboveGround(anim, m, BONE.handR, P.wristR, HAND_TIP, null);
    limb(anim, m, BONE.thighL, P.hipL, P.kneeL, P.ankleL, true);
    limb(anim, m, BONE.thighR, P.hipR, P.kneeR, P.ankleR, true);
    _q2.multiplyQuaternions(wq[BONE.footL - 1], _qFoot);
    anim._setWorld(BONE.footL, _q2);
    this._aboveGround(anim, m, BONE.footL, P.ankleL, TOE, HEEL);
    _q2.multiplyQuaternions(wq[BONE.footR - 1], _qFoot);
    anim._setWorld(BONE.footR, _q2);
    this._aboveGround(anim, m, BONE.footR, P.ankleR, TOE, HEEL);
    anim.headCenter.fromArray(DIM.headCenter).applyQuaternion(wq[BONE.head]).add(wp[BONE.head]);
    void clamp;
  }
}

/** Hand-/Fußspitze relativ zum Gelenk (Knochenraum): Fingerspitzen, Zehenspitze (Sohle), Ferse (Sohle). */
const HAND_TIP = new THREE.Vector3(0, -0.1, 0);
const TOE = new THREE.Vector3(0, -0.07, -0.165);
const HEEL = new THREE.Vector3(0, -0.08, 0.07);
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Endknochen (Hand/Fuß) so drehen, dass seine Spitze(n) nicht unter dem Boden liegen: Bodenhöhe im Modellraum aus dem
 * Partikel des Gelenks; die Spitze wird um das Gelenk auf Bodenhöhe gehoben (kürzeste Drehung).
 */
Ragdoll.prototype._aboveGround = function (anim, m, bone, pi, tipA, tipB) {
  const gm = m[pi].y - (this.p[pi].y - this.ground[pi]) + 0.008;
  const wq = anim.wq, wp = anim.wp;
  for (const tip of tipB ? [tipA, tipB] : [tipA]) {
    _t.copy(tip).applyQuaternion(wq[bone]);
    const len = _t.length();
    const need = gm - wp[bone].y; // minimale Höhe der Spitze relativ zum Gelenk
    if (_t.y >= need || len < 1e-4) continue;
    const ny = clamp(need / len, -0.95, 0.95);
    _n.copy(_t).multiplyScalar(1 / len);
    const h = Math.hypot(_n.x, _n.z);
    const nh = Math.sqrt(1 - ny * ny);
    if (h > 1e-4) { _n.x *= nh / h; _n.z *= nh / h; } else _n.x = nh;
    _n.y = ny;
    _q3.setFromUnitVectors(_t.multiplyScalar(1 / len), _n);
    _q2.multiplyQuaternions(_q3, wq[bone]);
    anim._setWorld(bone, _q2);
  }
};

/** Gliedmaße aus drei Partikeln: bone = oberer Knochen; a = oberes, b = mittleres, c = unteres Gelenk. */
function limb(anim, m, bone, a, b, c, knee) {
  _mid.addVectors(m[a], m[c]).multiplyScalar(0.5);
  _d.subVectors(m[b], _mid); // Beugerichtung (zum Mittelgelenk)
  if (_d.lengthSq() < 1e-5) _d.set(0, 0, knee ? -1 : 1).applyQuaternion(anim.wq[0]);
  if (knee) _d.negate(); // Kniescheibe (−Z) zeigt in Beugerichtung; Ellbogenspitze (+Z)
  _y.subVectors(m[a], m[b]);
  quatFromYZ(_q, _y, _d);
  anim._setWorld(bone, _q);
  _y.subVectors(m[b], m[c]);
  quatFromYZ(_q, _y, _d);
  anim._setWorld(bone + 1, _q);
}

export const RAGDOLL_JOINT_BONES = [
  BONE.thighL, BONE.thighR, BONE.upperArmL, BONE.upperArmR, -1, BONE.shinL, BONE.footL, BONE.shinR, BONE.footR,
  BONE.foreArmL, BONE.handL, BONE.foreArmR, BONE.handR,
];
