// NULLPUNKT — Granaten: Wurf, Flugbahn mit Luftwiderstand, Abpraller an der Welt (Strahl-Sweep gegen die
// Kugel-BVH der Karte, Oberfläche je Kontakt), Reibung/Rollen am Boden, Haftgranate klebt an Flächen und
// Gegnern, Zünder, Explosion über G.combat.explode. Modelle aus models.js ('third'), Haft-LED blinkt.
//
// Öffentliche Sicht (G.weapons.grenades): [{ id, type, actor, position, velocity, fuse, radius, stuckTo, rest }]

import * as THREE from 'three';
import { EQUIPMENT as DATA_EQUIPMENT } from '../../shared/weapons.data.js';
import { clamp } from './ballistics/math.js';

export const GRENADE_GRAVITY = 22; // m/s² (etwas weniger als Spieler – schönere Bögen)
const RADIUS = 0.06;
const AIR_DRAG = 0.06; // 1/s
const MAX_STEP = 1 / 120;
const MAX_LIVE = 24;
const UP = new THREE.Vector3(0, 1, 0);

const _dir = new THREE.Vector3();
const _move = new THREE.Vector3();
const _n = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ray = new THREE.Ray();
const _axis = new THREE.Vector3();
const _right = new THREE.Vector3();
const _box = new THREE.Box3();

let nextId = 1;

export class GrenadeSystem {
  constructor(system) {
    this.system = system;
    this.list = [];
    this._templates = new Map();
    this._ledTex = null;
    this._ledMat = null;
  }

  get G() { return this.system.G; }

  _eq(type) {
    const EQ = (this.G.data && this.G.data.EQUIPMENT) || DATA_EQUIPMENT;
    return EQ[type] || EQ.frag || { id: type, fuse: 2.8, radius: 6.5, maxDamage: 150, throwSpeed: 18, throwPitch: 0.18, bounciness: 0.38, friction: 0.55 };
  }

  /* ------------------------------------------------------------ Modelle */

  _model(type) {
    const G = this.G;
    const models = G.modules && G.modules.models;
    // createWeaponModel liefert bereits einen günstigen Klon (geteilte Geometrien) – nicht selbst klonen
    let inner = null;
    try { if (models && models.createWeaponModel) inner = models.createWeaponModel(type, { lod: 'third' }); } catch { inner = null; }
    let tpl = this._templates.get(type);
    if (!inner) {
      if (!tpl || !tpl.fallback) {
        const geo = new THREE.SphereGeometry(0.055, 10, 8);
        const mat = new THREE.MeshStandardMaterial({ color: type === 'semtex' ? 0x3d434a : 0x4a5236, roughness: 0.6, metalness: 0.3 });
        tpl = { type, fallback: { geo, mat }, center: new THREE.Vector3() };
        this._templates.set(type, tpl);
      }
      inner = new THREE.Mesh(tpl.fallback.geo, tpl.fallback.mat);
    } else if (!tpl) {
      _box.setFromObject(inner);
      tpl = { type, fallback: null, center: _box.getCenter(new THREE.Vector3()) };
      this._templates.set(type, tpl);
    }
    const pivot = new THREE.Group();
    pivot.name = `granate:${type}`;
    inner.position.copy(tpl.center).multiplyScalar(-1);
    inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    pivot.add(inner);
    if (type === 'semtex') {
      const led = new THREE.Sprite(this._led());
      led.scale.setScalar(0.11);
      led.position.set(0, 0.035, 0);
      led.renderOrder = 5;
      pivot.add(led);
      pivot.userData.led = led;
    }
    return pivot;
  }

  _led() {
    if (this._ledMat) return this._ledMat;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,70,50,1)');
    grd.addColorStop(0.5, 'rgba(255,20,10,0.35)');
    grd.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    this._ledTex = new THREE.CanvasTexture(c);
    this._ledTex.colorSpace = THREE.SRGBColorSpace;
    this._ledMat = new THREE.SpriteMaterial({ map: this._ledTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    return this._ledMat;
  }

  /* ------------------------------------------------------------ Wurf */

  /**
   * Granate werfen. opts: { cook (s bereits abgelaufen), drop (fallen lassen), origin, dir, speed }
   */
  throw(actor, type, opts = {}) {
    const G = this.G;
    const eq = this._eq(type);
    if (this.list.length >= MAX_LIVE) this._explode(this.list[0], 0);
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const eye = actor.getEyePosition(new THREE.Vector3());
    const aim = opts.dir ? _dir.copy(opts.dir).normalize() : actor.getAimDirection(_dir);
    if (opts.drop) {
      pos.copy(eye);
      pos.y -= 0.9;
      vel.set((Math.random() - 0.5) * 0.6, 0.5, (Math.random() - 0.5) * 0.6);
    } else {
      // Startpunkt: rechte Hand vor dem Körper; nicht durch Wände
      _right.crossVectors(aim, UP);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); else _right.normalize();
      pos.copy(opts.origin || eye).addScaledVector(aim, 0.42).addScaledVector(_right, 0.16);
      pos.y -= 0.06;
      if (G.world && typeof G.world.raycast === 'function') {
        _move.subVectors(pos, eye);
        const len = _move.length();
        if (len > 1e-4) {
          const hit = G.world.raycast(eye, _move.divideScalar(len), len + RADIUS);
          if (hit) pos.copy(eye).addScaledVector(_move, Math.max(0, hit.distance - RADIUS * 1.5));
        }
      }
      // Abwurf: Blickrichtung leicht nach oben gekippt
      const pitchUp = eq.throwPitch ?? 0.18;
      const h = Math.hypot(aim.x, aim.z);
      const pitch = Math.atan2(aim.y, h) + pitchUp;
      const yaw = Math.atan2(-aim.x, -aim.z);
      const speed = opts.speed || eq.throwSpeed || 18;
      const c = Math.cos(pitch);
      vel.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c).multiplyScalar(speed);
      if (actor.body && actor.body.velocity) {
        vel.x += actor.body.velocity.x * 0.6;
        vel.z += actor.body.velocity.z * 0.6;
        vel.y += Math.max(0, actor.body.velocity.y) * 0.3;
      }
    }
    const mesh = this._model(eq.id || type);
    mesh.position.copy(pos);
    G.scene.add(mesh);
    const fuse = Math.max(0.05, (eq.fuse || 2.8) - (eq.cookable ? opts.cook || 0 : 0));
    const g = {
      id: nextId++, type: eq.id || type, eq, actor, position: pos, velocity: vel, fuse, radius: eq.radius || 6.5,
      mesh, stuckTo: null, stuckLocal: null, stuckYaw: 0, stuckNormal: null, rest: false, rolling: false, age: 0,
      lastBounce: -1, spin: new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).normalize(),
      spinRate: opts.drop ? 2 : 9 + Math.random() * 6, sticky: !!eq.sticky, armed: true,
    };
    this.list.push(g);
    G.events.emit('grenade:throw', { actor, position: pos.clone(), velocity: vel.clone(), type: g.type, cooked: opts.cook || 0, dropped: !!opts.drop });
    return g;
  }

  /** Splittergranate zu lange gehalten: Explosion an der Hand. */
  explodeInHand(actor, type) {
    const eq = this._eq(type);
    const p = actor.getEyePosition(new THREE.Vector3());
    p.y -= 0.35;
    this._boom(p, eq, actor);
  }

  /* ------------------------------------------------------------ Simulation */

  update(dt) {
    const list = this.list;
    if (!list.length) return;
    const G = this.G;
    const world = G.world;
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      g.age += dt;
      g.fuse -= dt;
      if (g.stuckTo) this._followStuck(g);
      else if (!g.rest) this._simulate(g, dt, world);
      this._visual(g, dt);
      if (g.fuse <= 0) this._explode(g, i);
    }
  }

  _simulate(g, dt, world) {
    let left = dt;
    let guard = 0;
    while (left > 1e-6 && guard++ < 16) {
      const speed = g.velocity.length();
      const h = Math.min(left, MAX_STEP, speed > 1e-3 ? 0.25 / speed : MAX_STEP);
      left -= h;
      this._step(g, h, world);
      if (g.rest || g.stuckTo) break;
    }
    // Außerhalb der Karte: am Rand halten, unter der Karte: Ruhe
    const b = world && world.bounds;
    if (b) {
      const p = g.position;
      if (p.x < b.min.x) { p.x = b.min.x; g.velocity.x = Math.abs(g.velocity.x) * 0.3; }
      if (p.x > b.max.x) { p.x = b.max.x; g.velocity.x = -Math.abs(g.velocity.x) * 0.3; }
      if (p.z < b.min.z) { p.z = b.min.z; g.velocity.z = Math.abs(g.velocity.z) * 0.3; }
      if (p.z > b.max.z) { p.z = b.max.z; g.velocity.z = -Math.abs(g.velocity.z) * 0.3; }
      if (p.y < b.min.y - 2) { g.rest = true; g.velocity.set(0, 0, 0); }
    }
  }

  _step(g, h, world) {
    const G = this.G;
    const v = g.velocity;
    const p = g.position;
    v.y -= GRENADE_GRAVITY * h;
    const drag = Math.exp(-AIR_DRAG * h);
    v.multiplyScalar(drag);
    // Rollen auf dem Boden: Normalanteil entfernen, Rollreibung
    if (g.rolling && world) {
      const ground = world.raycast(p, _dir.set(0, -1, 0), RADIUS + 0.08);
      if (ground && ground.normal.y > 0.55) {
        _n.copy(ground.normal);
        const vn = v.dot(_n);
        if (vn < 0) v.addScaledVector(_n, -vn);
        const fr = g.eq.friction ?? 0.55;
        const roll = Math.exp(-(1.1 + 3.2 * fr) * h);
        v.multiplyScalar(roll);
        p.y = ground.point.y + RADIUS;
        if (v.lengthSq() < 0.01 && ground.normal.y > 0.85) { g.rest = true; v.set(0, 0, 0); return; }
      } else g.rolling = false;
    }
    _move.copy(v).multiplyScalar(h);
    const len = _move.length();
    if (len < 1e-6) return;
    _dir.copy(_move).divideScalar(len);
    // Haftgranate trifft Gegner
    if (g.sticky && this._stickActor(g, len)) return;
    // Frag prallt von Akteuren leicht ab
    if (!g.sticky && this._bumpActor(g, len)) return;
    const hit = world && typeof world.raycast === 'function' ? world.raycast(p, _dir, len + RADIUS) : null;
    if (!hit) { p.add(_move); return; }
    _n.copy(hit.normal);
    if (_n.dot(_dir) > 0) _n.negate();
    p.copy(hit.point).addScaledVector(_n, RADIUS * 1.02);
    if (g.sticky) {
      g.stuckTo = 'world';
      g.stuckNormal = _n.clone();
      g.rest = true;
      v.set(0, 0, 0);
      G.events.emit('grenade:stick', { actor: g.actor, type: g.type, position: p.clone(), target: null, surface: hit.surface });
      G.events.emit('grenade:bounce', { position: p.clone(), speed: 3, surface: hit.surface, type: g.type, stick: true });
      return;
    }
    const vn = v.dot(_n);
    if (vn < 0) {
      const impact = -vn;
      const e = g.eq.bounciness ?? 0.38;
      const fr = g.eq.friction ?? 0.55;
      // Normalanteil spiegeln, Tangentialanteil reiben
      _vt.copy(v).addScaledVector(_n, -vn);
      const tk = Math.max(0, 1 - fr * Math.min(1, impact / 4) * 0.9);
      v.copy(_vt).multiplyScalar(tk).addScaledVector(_n, impact * (impact > 1.2 ? e : 0));
      g.spinRate = Math.min(16, g.spinRate * 0.7 + _vt.length() * 2);
      if (impact > 1.2 && g.age - g.lastBounce > 0.08) {
        g.lastBounce = g.age;
        G.events.emit('grenade:bounce', { position: p.clone(), speed: impact, surface: hit.surface || 'concrete', type: g.type });
      }
      if (_n.y > 0.55 && impact < 2.4) g.rolling = true;
    }
  }

  _stickActor(g, len) {
    const G = this.G;
    _ray.set(g.position, _dir);
    for (const a of G.actors) {
      if (!a.alive || a === g.actor || (g.actor && !G.combat.isHostile(g.actor, a)) || typeof a.raycastHitboxes !== 'function') continue;
      _p.copy(a.position);
      _p.y += 0.9;
      if (_ray.distanceSqToPoint(_p) > 2.2) continue;
      const hit = a.raycastHitboxes(_ray, len + RADIUS);
      if (!hit) continue;
      g.position.copy(hit.point);
      g.stuckTo = a;
      g.stuckYaw = a.yaw || 0;
      g.stuckLocal = hit.point.clone().sub(a.position).applyAxisAngle(UP, -(a.yaw || 0));
      g.velocity.set(0, 0, 0);
      g.rest = true;
      G.events.emit('grenade:stick', { actor: g.actor, type: g.type, position: hit.point.clone(), target: a, surface: 'flesh' });
      return true;
    }
    return false;
  }

  _bumpActor(g, len) {
    const G = this.G;
    _ray.set(g.position, _dir);
    for (const a of G.actors) {
      if (!a.alive || (a === g.actor && g.age < 0.25) || typeof a.raycastHitboxes !== 'function') continue;
      _p.copy(a.position);
      _p.y += 0.9;
      if (_ray.distanceSqToPoint(_p) > 2.2) continue;
      const hit = a.raycastHitboxes(_ray, len + RADIUS);
      if (!hit) continue;
      _n.copy(hit.normal);
      _n.y *= 0.3;
      _n.normalize();
      const vn = g.velocity.dot(_n);
      if (vn < 0) g.velocity.addScaledVector(_n, -1.3 * vn).multiplyScalar(0.45);
      g.position.copy(hit.point).addScaledVector(_n, RADIUS * 1.5);
      return true;
    }
    return false;
  }

  _followStuck(g) {
    const a = g.stuckTo;
    if (a === 'world') return;
    if (!a || !a.alive) {
      // Träger tot: Granate fällt herunter
      g.stuckTo = null;
      g.rest = false;
      g.rolling = false;
      g.velocity.set(0, -0.5, 0);
      g.sticky = false;
      return;
    }
    _p.copy(g.stuckLocal).applyAxisAngle(UP, a.yaw || 0);
    g.position.copy(a.position).add(_p);
  }

  _visual(g, dt) {
    const m = g.mesh;
    m.position.copy(g.position);
    if (!g.rest && !g.stuckTo) {
      const sp = g.velocity.length();
      if (g.rolling) {
        // Rollachse = oben × Bewegung
        _axis.crossVectors(UP, g.velocity);
        if (_axis.lengthSq() > 1e-8) {
          _axis.normalize();
          _q.setFromAxisAngle(_axis, (sp / RADIUS) * dt * 0.5);
          m.quaternion.premultiply(_q);
        }
      } else if (sp > 0.1) {
        _q.setFromAxisAngle(g.spin, g.spinRate * dt);
        m.quaternion.premultiply(_q);
      }
    } else if (g.stuckNormal && !g._oriented) {
      g._oriented = true;
      m.quaternion.setFromUnitVectors(UP, g.stuckNormal);
    }
    const led = m.userData.led;
    if (led) {
      // Blinkt schneller, je näher die Zündung
      const f = 2 + 10 * clamp(1 - g.fuse / Math.max(0.1, g.eq.fuse || 2.2), 0, 1);
      led.visible = Math.sin(g.age * f * Math.PI * 2) > -0.2;
    }
  }

  _explode(g, i) {
    const idx = i >= 0 && this.list[i] === g ? i : this.list.indexOf(g);
    if (idx >= 0) this.list.splice(idx, 1);
    this._removeMesh(g);
    const p = g.position.clone();
    if (!g.stuckTo || g.stuckTo === 'world') p.y += 0.08;
    this._boom(p, g.eq, g.actor);
  }

  _boom(p, eq, actor) {
    const G = this.G;
    if (!G.combat) return;
    G.combat.explode({
      position: p, radius: eq.radius || 6.5, maxDamage: eq.maxDamage || 150, innerRadius: eq.innerRadius, minDamage: eq.minDamage,
      attacker: actor || null, weaponId: eq.id, type: eq.id,
    });
  }

  _removeMesh(g) {
    if (!g.mesh) return;
    g.mesh.removeFromParent();
    g.mesh = null;
  }

  /** Alle Granaten entfernen (Match-Ende) – ohne Explosion. */
  clear() {
    for (const g of this.list) this._removeMesh(g);
    this.list.length = 0;
  }

  dispose() {
    this.clear();
    for (const t of this._templates.values()) {
      if (t.fallback) { t.fallback.geo.dispose(); t.fallback.mat.dispose(); }
    }
    this._templates.clear();
    if (this._ledMat) { this._ledMat.dispose(); this._ledTex.dispose(); this._ledMat = null; this._ledTex = null; }
  }
}
