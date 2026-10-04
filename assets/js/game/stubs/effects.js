// NULLPUNKT — Stub für engine/effects.js (§7): minimale, gepoolte Effekte – Leuchtspuren, Funken/Staub
// bei Einschlägen, Blutnebel, Explosionsblitz + Feuerball, Mündungsfeuer für Bots, Kamerawackeln.

import * as THREE from 'three';

const MAX_PARTICLES = 160;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(G) {
    this.G = G;
    this._subs = null;
    this._built = false;
  }

  _build() {
    if (this._built) return;
    this._built = true;
    // Leuchtspuren
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerGeo.translate(0, 0, 0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      m.visible = false;
      m.frustumCulled = false;
      m.userData.life = 0;
      this.tracers.push(m);
    }
    // Partikel (Instanzen)
    this.partGeo = new THREE.BoxGeometry(1, 1, 1);
    this.partMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true });
    this.parts = new THREE.InstancedMesh(this.partGeo, this.partMat, MAX_PARTICLES);
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts.frustumCulled = false;
    this.parts.count = 0;
    this.pdata = [];
    this.parts.setColorAt(0, new THREE.Color(1, 1, 1));
    // Explosion
    this.fireGeo = new THREE.SphereGeometry(1, 16, 12);
    this.fireMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fire = new THREE.Mesh(this.fireGeo, this.fireMat);
    this.fire.visible = false;
    this.fireLife = 0;
    this.light = new THREE.PointLight(0xffa860, 0, 18, 2);
    this.flashes = [];
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashGeo = new THREE.SphereGeometry(0.09, 8, 6);
    for (let i = 0; i < 10; i++) {
      const f = new THREE.Mesh(this.flashGeo, this.flashMat);
      f.visible = false;
      f.userData.life = 0;
      this.flashes.push(f);
    }
  }

  attach(G) {
    this.G = G;
    this.detach();
    this._build();
    const scene = G.scene;
    for (const t of this.tracers) scene.add(t);
    for (const f of this.flashes) scene.add(f);
    scene.add(this.parts, this.fire, this.light);
    const s = (this._subs = G.events.scope());
    s.on('tracer', ({ from, to, actor }) => this._tracer(from, to, actor));
    s.on('impact', ({ point, normal, surface }) => this._impact(point, normal, surface));
    s.on('actor:hit', ({ point, dir, explosive }) => { if (point && !explosive) this._blood(point, dir); });
    s.on('explosion', ({ position, radius }) => this._explosion(position, radius || 6));
    s.on('weapon:fire', ({ actor, origin, dir }) => { if (actor && !actor.isPlayer && origin && dir) this._muzzle(origin, dir); });
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    if (!this._built) return;
    for (const t of this.tracers) { t.removeFromParent(); t.visible = false; }
    for (const f of this.flashes) { f.removeFromParent(); f.visible = false; }
    this.parts.removeFromParent();
    this.fire.removeFromParent();
    this.light.removeFromParent();
    this.pdata.length = 0;
    this.parts.count = 0;
  }

  get scale() {
    const p = this.G.renderer && this.G.renderer.preset;
    return p ? p.particleScale : 1;
  }

  _tracer(from, to, actor) {
    const t = this.tracers.find((m) => !m.visible);
    if (!t) return;
    _d.subVectors(to, from);
    const len = _d.length();
    if (len < 1) return;
    _d.divideScalar(len);
    // Spieler-Leuchtspur leicht versetzt beginnen (nicht durchs Visier)
    const start = actor && actor.isPlayer ? 1.2 : 0.3;
    t.position.copy(from).addScaledVector(_d, start);
    t.quaternion.setFromUnitVectors(Z, _d);
    const l = Math.min(len - start, 6 + Math.random() * 6);
    t.scale.set(0.018, 0.018, Math.max(0.1, l));
    t.userData.life = 0.05;
    t.userData.vel = _d.clone().multiplyScalar(Math.min(400, len / 0.05));
    t.userData.end = to.clone();
    t.visible = true;
  }

  _spawn(pos, vel, life, size, color, gravity = 9) {
    if (this.pdata.length >= MAX_PARTICLES) this.pdata.shift();
    this.pdata.push({ pos: pos.clone(), vel, life, max: life, size, color, gravity });
  }

  _impact(point, normal, surface) {
    const n = Math.max(1, Math.round(6 * this.scale));
    const spark = surface === 'metal';
    const dust = { concrete: 0x9a958a, wood: 0x8a6a45, dirt: 0x6e5a43, sand: 0xcdb68a, grass: 0x55703a, glass: 0xcfe6f0, tile: 0xb7b1a3, fabric: 0x8a7f66, water: 0xbfd8e8 }[surface] || 0x9a958a;
    for (let i = 0; i < n; i++) {
      const v = normal.clone().multiplyScalar(1.5 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3));
      if (spark && i < n / 2) this._spawn(point, v.multiplyScalar(1.8), 0.25, 0.025, new THREE.Color(0xffc060), 14);
      else this._spawn(point, v.multiplyScalar(0.6), 0.45 + Math.random() * 0.3, 0.05 + Math.random() * 0.05, new THREE.Color(dust), 2);
    }
  }

  _blood(point, dir) {
    const n = Math.max(1, Math.round(5 * this.scale));
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
      if (dir) v.addScaledVector(dir, 2);
      this._spawn(point, v, 0.35, 0.05 + Math.random() * 0.04, new THREE.Color(0x8a0d0d), 6);
    }
  }

  _explosion(position, radius) {
    this.fire.position.copy(position);
    this.fire.scale.setScalar(0.3);
    this.fire.visible = true;
    this.fireLife = 0.45;
    this.fireRadius = Math.min(3, radius * 0.4);
    this.light.position.copy(position).y += 0.5;
    this.light.intensity = 60;
    const n = Math.max(4, Math.round(26 * this.scale));
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 9, (Math.random() - 0.5) * 10);
      this._spawn(position, v, 0.8 + Math.random() * 0.6, 0.06 + Math.random() * 0.08, new THREE.Color(i % 3 ? 0x3a3530 : 0xff9a40), 9);
    }
    const p = this.G.player;
    if (p && p.alive && typeof p.shake === 'function') {
      const d = p.position.distanceTo(position);
      if (d < radius * 3) p.shake(Math.max(0, 0.9 - d / (radius * 3)) * 0.9);
    }
  }

  _muzzle(origin, dir) {
    const f = this.flashes.find((m) => !m.visible);
    if (!f) return;
    _p.crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    f.position.copy(origin).addScaledVector(dir, 0.7).addScaledVector(_p, 0.18);
    f.position.y -= 0.22;
    f.userData.life = 0.05;
    f.visible = true;
  }

  update(dt) {
    if (!this._built || !this._subs) return;
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      t.position.addScaledVector(t.userData.vel, dt);
      if (t.userData.life <= 0) t.visible = false;
    }
    for (const f of this.flashes) {
      if (!f.visible) continue;
      f.userData.life -= dt;
      if (f.userData.life <= 0) f.visible = false;
    }
    if (this.fire.visible) {
      this.fireLife -= dt;
      const k = 1 - this.fireLife / 0.45;
      this.fire.scale.setScalar(0.3 + this.fireRadius * Math.sqrt(k));
      this.fireMat.opacity = Math.max(0, 1 - k);
      this.light.intensity = Math.max(0, 60 * (1 - k * 1.6));
      if (this.fireLife <= 0) { this.fire.visible = false; this.light.intensity = 0; }
    }
    // Partikel
    let n = 0;
    const list = this.pdata;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-2 * dt));
      p.pos.addScaledVector(p.vel, dt);
    }
    for (const p of list) {
      const s = p.size * (0.4 + 0.6 * (p.life / p.max));
      _s.set(s, s, s);
      _m.compose(p.pos, _q, _s);
      this.parts.setMatrixAt(n, _m);
      this.parts.setColorAt(n, p.color);
      n++;
    }
    this.parts.count = n;
    this.parts.instanceMatrix.needsUpdate = true;
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.detach();
    if (!this._built) return;
    for (const d of [this.tracerGeo, this.tracerMat, this.partGeo, this.partMat, this.fireGeo, this.fireMat, this.flashGeo, this.flashMat]) d.dispose();
    this.parts.dispose();
    this.light.dispose();
    this._built = false;
  }
}
