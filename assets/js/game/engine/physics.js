// NULLPUNKT — CapsuleBody: Kapsel-Kollision gegen world.collider (Octree) für Spieler und Bots (§5).
//
// position = Füße. Eigenschaften:
//  - Unterschritte gegen Tunneln (max. halber Radius pro Teilschritt)
//  - Stufen/Bordsteine bis stepHeight (0,45 m) werden hochgestiegen
//  - begehbare Schrägen bis maxSlope (50°): kein Abrutschen im Stand, kein Hochklettern steilerer Flächen
//  - Bodenhaftung beim Hinabgehen von Treppen (snap down)
//  - stepOffset: vertikaler Versatz durch Stufen dieses Frames – der Spieler glättet damit die Kamera

import { Vector3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';

const _tris = [];
const _push = new Vector3();
const _n = new Vector3();
const _start = new Vector3();
const _vel = new Vector3();
const _delta = new Vector3();
const _probe = new Capsule();

export class CapsuleBody {
  constructor({ radius = 0.35, height = 1.8, crouchHeight = 1.15, maxSlope = 50 } = {}) {
    this.radius = radius;
    this.standHeight = height;
    this.height = height;
    this.crouchHeight = crouchHeight;
    this.maxSlopeCos = Math.cos((maxSlope * Math.PI) / 180);

    this.position = new Vector3();
    this.velocity = new Vector3();
    this.onGround = false;
    this.groundNormal = new Vector3(0, 1, 0);
    /** Vertikaler Versatz durch Stufen/Bodenhaftung im letzten step() (für Kamera-Glättung). */
    this.stepOffset = 0;
    /** true, wenn der Körper unter world.bounds gefallen ist. */
    this.outOfWorld = false;
    /** Letzte Wandkontakt-Normale (horizontal) oder null. */
    this.wallNormal = null;
    this.capsule = new Capsule(new Vector3(), new Vector3(), radius);
    this._wall = new Vector3();
    this._sync();
  }

  _sync() {
    const p = this.position;
    const r = this.radius;
    this.capsule.radius = r;
    this.capsule.start.set(p.x, p.y + r, p.z);
    this.capsule.end.set(p.x, p.y + Math.max(this.height - r, r + 0.01), p.z);
  }

  /** Kapselhöhe setzen (Ducken: Kopf senkt sich, Füße bleiben). */
  setHeight(h) {
    this.height = Math.min(this.standHeight, Math.max(this.radius * 2 + 0.05, h));
    this._sync();
  }

  /** Ist über dem Kopf genug Platz, um auf `height` (Standard: Stehhöhe) zu wachsen? */
  canStand(world, height = this.standHeight) {
    const collider = world && world.collider;
    if (!collider) return true;
    const r = this.radius * 0.92;
    const p = this.position;
    _probe.start.set(p.x, p.y + Math.max(this.height - this.radius, r) , p.z);
    _probe.end.set(p.x, p.y + height - r, p.z);
    _probe.radius = r;
    if (_probe.end.y <= _probe.start.y) return true;
    const hit = collider.capsuleIntersect(_probe);
    return !hit || hit.depth < 0.01;
  }

  teleport(pos) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    this.outOfWorld = false;
    this.stepOffset = 0;
    this._sync();
  }

  /**
   * Integriert Geschwindigkeit + Schwerkraft und löst Kollisionen.
   * opts: { gravity = 24, stepHeight = 0.45, snap = true }
   */
  step(dt, world, { gravity = 24, stepHeight = 0.45, snap = true } = {}) {
    const collider = world && world.collider;
    const v = this.velocity;
    const wasGround = this.onGround;
    this.stepOffset = 0;
    this.wallNormal = null;

    // Auf dem Boden keine Schwerkraft (kein Rutschen auf Schrägen); Bodenhaftung übernimmt snap.
    if (wasGround && v.y <= 0) v.y = 0;
    else v.y -= gravity * dt;

    if (!collider) {
      this.position.addScaledVector(v, dt);
      if (this.position.y < 0) { this.position.y = 0; v.y = Math.max(0, v.y); this.onGround = true; } else this.onGround = false;
      this._sync();
      return;
    }

    const fine = typeof collider.getCapsuleTriangles === 'function' && typeof collider.triangleCapsuleIntersect === 'function';
    const travel = v.length() * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(travel / (this.radius * 0.5))));
    const sdt = dt / steps;
    this.onGround = false;

    for (let i = 0; i < steps; i++) {
      _delta.copy(v).multiplyScalar(sdt);
      const grounded = wasGround || this.onGround;
      this._moveAndCollide(_delta, collider, fine, grounded && v.y <= 0.01 ? stepHeight : 0);
    }

    // Treppen abwärts: am Boden bleiben, solange darunter begehbarer Grund in Stufenhöhe liegt.
    if (snap && wasGround && !this.onGround && v.y <= 0.01) {
      _start.copy(this.position);
      this.position.y -= stepHeight;
      this._sync();
      this._resolve(collider, fine);
      if (this.onGround) {
        this.stepOffset += this.position.y - _start.y;
        v.y = 0;
      } else {
        this.position.copy(_start);
        this._sync();
      }
    }

    if (world.bounds && this.position.y < world.bounds.min.y - 6) this.outOfWorld = true;
  }

  _moveAndCollide(delta, collider, fine, stepHeight) {
    const v = this.velocity;
    _start.copy(this.position);
    _vel.copy(v);
    this.position.add(delta);
    this._sync();
    const res = this._resolve(collider, fine);

    // Stufe hochsteigen: nur wenn eine niedrige Kante die horizontale Bewegung blockiert.
    const hx = delta.x;
    const hz = delta.z;
    const hLen = Math.hypot(hx, hz);
    if (!stepHeight || !res.wall || hLen < 1e-5 || res.wallContactHeight > stepHeight + 0.05) return;

    const dirX = hx / hLen;
    const dirZ = hz / hLen;
    const progress1 = (this.position.x - _start.x) * dirX + (this.position.z - _start.z) * dirZ;
    if (progress1 > hLen * 0.9) return;

    const p1x = this.position.x, p1y = this.position.y, p1z = this.position.z;
    const v1x = v.x, v1y = v.y, v1z = v.z;
    const ground1 = this.onGround;

    // Versuch 2: anheben → horizontal bewegen → absenken
    v.copy(_vel);
    this.position.copy(_start);
    this.position.y += stepHeight;
    this._sync();
    this._resolve(collider, fine);
    const raisedY = this.position.y;
    this.position.x += hx;
    this.position.z += hz;
    this._sync();
    this._resolve(collider, fine);
    this.position.y -= stepHeight + 0.02 + (raisedY - _start.y - stepHeight);
    this._sync();
    this.onGround = false;
    this._resolve(collider, fine);
    const progress2 = (this.position.x - _start.x) * dirX + (this.position.z - _start.z) * dirZ;
    const rise = this.position.y - _start.y;

    if (this.onGround && progress2 > progress1 + 1e-3 && rise <= stepHeight + 0.01 && rise > -0.01) {
      this.stepOffset += rise;
      v.y = 0;
      return;
    }
    // Zurück zu Versuch 1
    this.position.set(p1x, p1y, p1z);
    v.set(v1x, v1y, v1z);
    this.onGround = ground1;
    this._sync();
  }

  /** Schiebt die Kapsel aus Überschneidungen. Liefert { wall, wallContactHeight }. */
  _resolve(collider, fine) {
    const out = { wall: false, wallContactHeight: Infinity };

    if (!fine) {
      // Grobe Variante (beliebiger Collider mit capsuleIntersect)
      for (let iter = 0; iter < 3; iter++) {
        const hit = collider.capsuleIntersect(this.capsule);
        if (!hit || hit.depth < 1e-5) break;
        this._applyContact(hit.normal, hit.depth, null, out);
      }
      return out;
    }

    for (let iter = 0; iter < 4; iter++) {
      _tris.length = 0;
      collider.getCapsuleTriangles(this.capsule, _tris);
      let any = false;
      for (let i = 0; i < _tris.length; i++) {
        const hit = collider.triangleCapsuleIntersect(this.capsule, _tris[i]);
        if (!hit || hit.depth < 1e-5) continue;
        any = true;
        this._applyContact(hit.normal, hit.depth, hit.point, out);
      }
      if (!any) break;
    }
    _tris.length = 0;
    return out;
  }

  _applyContact(normal, depth, point, out) {
    const v = this.velocity;
    _n.copy(normal);
    if (_n.y >= this.maxSlopeCos) {
      // Begehbarer Boden: senkrecht herausdrücken → kein seitliches Wegrutschen auf Schrägen.
      this.onGround = true;
      this.groundNormal.copy(_n);
      _push.set(0, Math.min(depth / Math.max(_n.y, 0.2), depth * 2.5), 0);
      if (v.y < 0) v.y = 0;
    } else if (_n.y <= -0.5) {
      // Decke
      _push.copy(_n).multiplyScalar(depth);
      if (v.y > 0) v.y = 0;
    } else {
      // Wand oder zu steile Schräge: nur horizontal schieben (verhindert Hochklettern).
      const hl = Math.hypot(_n.x, _n.z);
      if (hl > 1e-3 && _n.y > 0) {
        _n.set(_n.x / hl, 0, _n.z / hl);
        _push.copy(_n).multiplyScalar(depth / hl + 1e-4);
      } else {
        _push.copy(_n).multiplyScalar(depth);
      }
      const vn = v.x * _n.x + v.y * _n.y + v.z * _n.z;
      if (vn < 0) v.addScaledVector(_n, -vn);
      out.wall = true;
      if (point) out.wallContactHeight = Math.min(out.wallContactHeight, point.y - this.position.y);
      else out.wallContactHeight = 0;
      this.wallNormal = this._wall.copy(_n);
    }
    this.position.add(_push);
    this.capsule.translate(_push);
  }
}
