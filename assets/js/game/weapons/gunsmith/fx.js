// Ego-Effekte: Mündungsfeuer (Stern + seitliche Flammen + Punktlicht, additiv & bloom-freundlich),
// Rauchfahne und gepoolte Hülsen mit einfacher Physik (InstancedMesh, ein Draw Call je Hülsenart).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flashMap, smokeMap } from './textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

export class MuzzleFlash {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'muendungsfeuer';
    const add = (map, color) => new THREE.MeshBasicMaterial({
      map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      toneMapped: false, side: THREE.DoubleSide, fog: false,
    });
    this.starMat = add(flashMap('star'), new THREE.Color(2.6, 1.7, 0.9));
    this.sideMat = add(flashMap('side'), new THREE.Color(2.2, 1.35, 0.7));
    // Frontaler Stern (Normale zur Kamera)
    this.star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.starMat);
    this.star.renderOrder = 10;
    // Zwei gekreuzte Flammenzungen entlang der Laufachse (−Z)
    const sideGeo = new THREE.PlaneGeometry(1, 0.42);
    sideGeo.translate(0.5, 0, 0);
    sideGeo.rotateY(Math.PI / 2);
    const s2 = sideGeo.clone();
    s2.rotateZ(Math.PI / 2);
    this.sides = new THREE.Mesh(mergeGeometries([sideGeo, s2]), this.sideMat);
    this.sides.renderOrder = 10;
    sideGeo.dispose(); s2.dispose();
    this.group.add(this.star, this.sides);
    this.group.visible = false;
    this.light = new THREE.PointLight(0xffa24a, 0, 3.2, 2);
    this.light.name = 'muendungslicht';
    this.t = 1; this.dur = 0.05; this.peak = 0;
  }

  fire(size = 1, length = 1) {
    if (size <= 0) return;
    this.t = 0;
    this.dur = 0.035 + 0.02 * Math.random();
    const s = (0.1 + Math.random() * 0.065) * size;
    this.star.scale.set(s, s, 1);
    this.star.rotation.z = Math.random() * Math.PI * 2;
    const l = (0.1 + Math.random() * 0.08) * length * Math.sqrt(size);
    this.sides.scale.set(1, 1, 1);
    this.sides.scale.setScalar(l);
    this.sides.rotation.z = Math.random() * Math.PI;
    this.group.visible = true;
    this.peak = 7 * size;
    this.light.intensity = this.peak;
  }

  update(dt) {
    if (this.t >= this.dur) { this.group.visible = false; this.light.intensity = 0; return; }
    this.t += dt;
    const k = Math.max(0, 1 - this.t / this.dur);
    this.starMat.opacity = this.sideMat.opacity = Math.min(1, k * 1.6);
    this.light.intensity = this.peak * k * k;
    if (this.t >= this.dur) { this.group.visible = false; this.light.intensity = 0; }
  }

  hide() { this.t = this.dur; this.group.visible = false; this.light.intensity = 0; }

  dispose() {
    this.star.geometry.dispose(); this.sides.geometry.dispose();
    this.starMat.dispose(); this.sideMat.dispose();
    this.light.dispose();
  }
}

// Leichter Rauch nach Schüssen (wenige Sprites, normal geblendet)
export class SmokeWisps {
  constructor(max = 10) {
    this.group = new THREE.Group();
    this.items = [];
    const tex = smokeMap();
    for (let i = 0; i < max; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xb9b3a8, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, life: 0, max: 1, vel: new THREE.Vector3() });
    }
    this.i = 0;
  }
  puff(pos, dir, amount = 1) {
    const it = this.items[this.i = (this.i + 1) % this.items.length];
    it.m.position.copy(pos);
    it.vel.copy(dir).multiplyScalar(0.05 + Math.random() * 0.05).add(_p.set((Math.random() - 0.5) * 0.02, 0.05 + Math.random() * 0.03, 0));
    it.life = 0; it.max = 0.7 + Math.random() * 0.5; it.amount = amount;
    it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.life += dt;
      const k = it.life / it.max;
      if (k >= 1) { it.m.visible = false; continue; }
      it.m.position.addScaledVector(it.vel, dt);
      it.vel.multiplyScalar(Math.exp(-1.5 * dt));
      const s = (0.03 + k * 0.08) * it.amount;
      it.m.scale.set(s, s, s);
      it.m.material.opacity = 0.16 * (1 - k) * Math.min(1, k * 6) * it.amount;
    }
  }
  clear() { for (const it of this.items) it.m.visible = false; }
  dispose() { for (const it of this.items) it.m.material.dispose(); }
}

function casingGeometry(type) {
  if (type === 'shotgun') {
    const hull = new THREE.CylinderGeometry(0.0103, 0.0103, 0.05, 10, 1);
    hull.translate(0, 0.006, 0);
    const base = new THREE.CylinderGeometry(0.0108, 0.0108, 0.013, 10, 1);
    base.translate(0, -0.0245, 0);
    const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const g = mergeGeometries([col(hull, new THREE.Color(0x8f1f17)), col(base, new THREE.Color(0xc09a45))]);
    hull.dispose(); base.dispose();
    return g;
  }
  const dims = { rifle: [0.0046, 0.0057, 0.03, 0.0035], pistol: [0.0047, 0.0049, 0.019, 0.0], big: [0.006, 0.0074, 0.05, 0.0045] }[type] || [0.0046, 0.0057, 0.03, 0.0035];
  const [rNeck, rBody, len, neck] = dims;
  const pts = [[0, -len / 2], [rBody * 1.02, -len / 2], [rBody * 1.02, -len / 2 + 0.0015], [rBody * 0.9, -len / 2 + 0.002], [rBody, -len / 2 + 0.003], [rBody, len / 2 - neck - 0.003]];
  if (neck > 0) pts.push([rNeck, len / 2 - neck], [rNeck, len / 2]);
  else pts.push([rBody, len / 2]);
  pts.push([rNeck * 0.7, len / 2]);
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 8);
  const n = g.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color(0xc09a45);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Hülsen-Pool: spawn(type, position, velocity) im Elternraum; Schwerkraft über setGravity(). */
export class ShellPool {
  constructor(perType = 14) {
    this.group = new THREE.Group();
    this.group.name = 'huelsen';
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.32 });
    this.matShot = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.45 });
    this.pools = {};
    this.perType = perType;
    this.limit = perType;            // aktiv genutzte Plätze (≤ perType), z. B. kleiner auf 'low'
    this.gravity = new THREE.Vector3(0, -7.5, 0);
  }

  _pool(type) {
    let p = this.pools[type];
    if (p) return p;
    const geo = casingGeometry(type);
    const mesh = new THREE.InstancedMesh(geo, type === 'shotgun' ? this.matShot : this.mat, this.perType);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = this.perType;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.perType; i++) mesh.setMatrixAt(i, _m);
    this.group.add(mesh);
    p = this.pools[type] = { mesh, items: Array.from({ length: this.perType }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 0 })), next: 0 };
    return p;
  }

  setGravity(v) { this.gravity.copy(v); }

  spawn(type, pos, vel, orient) {
    if (!type || type === 'none') return;
    const p = this._pool(type);
    const it = p.items[p.next = (p.next + 1) % Math.max(1, Math.min(this.limit, p.items.length))];
    it.alive = true;
    it.life = 0;
    it.pos.copy(pos);
    it.vel.copy(vel);
    if (orient) it.q.copy(orient); else it.q.identity();
    // Hülse liegt quer zur Laufachse: lokal Y entlang Waffen-X
    it.q.multiply(_q.setFromEuler(_e.set(0, 0, Math.PI / 2)));
    it.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 12, 18 + Math.random() * 16);
  }

  update(dt) {
    for (const type in this.pools) {
      const p = this.pools[type];
      let dirty = false;
      for (let i = 0; i < p.items.length; i++) {
        const it = p.items[i];
        if (!it.alive) continue;
        dirty = true;
        it.life += dt;
        if (it.life > 1.1) { it.alive = false; _m.makeScale(0, 0, 0); p.mesh.setMatrixAt(i, _m); continue; }
        it.vel.addScaledVector(this.gravity, dt);
        it.vel.multiplyScalar(Math.exp(-0.6 * dt));
        it.pos.addScaledVector(it.vel, dt);
        _e.set(it.w.x * dt, it.w.y * dt, it.w.z * dt);
        it.q.multiply(_q.setFromEuler(_e));
        _s.setScalar(1);
        _m.compose(it.pos, it.q, _s);
        p.mesh.setMatrixAt(i, _m);
      }
      if (dirty) p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear() {
    for (const type in this.pools) {
      const p = this.pools[type];
      _m.makeScale(0, 0, 0);
      p.items.forEach((it, i) => { it.alive = false; p.mesh.setMatrixAt(i, _m); });
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const type in this.pools) { this.pools[type].mesh.geometry.dispose(); this.pools[type].mesh.dispose(); }
    this.mat.dispose(); this.matShot.dispose();
  }
}
