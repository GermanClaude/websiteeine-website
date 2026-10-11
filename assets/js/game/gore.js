// NULLPUNKT — Mehr Gore (Wunschliste 10.10.): Blutlachen, die unter Gefallenen langsam größer werden, und Blutspritzer
// an Wand/Boden hinter Getroffenen (Strahl in Schussrichtung, ≤ 2,4 m). Reine Optik, überall lokal (offline, Host,
// Clients): ein InstancedMesh mit Kanten-Rauschtextur, beleuchtet, älteste zuerst überschrieben (Obergrenze je Stufe).
import * as THREE from 'three';

const CAP = { low: 24, medium: 48, high: 80, ultra: 120 };
const POOL_GROW = 7;      // s bis zur vollen Größe
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);

let TEX = null;
function texture() {
  if (TEX) return TEX;
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // unregelmäßiger Fleck aus überlagerten Kreisen + Tropfen am Rand
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#fff';
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 22, rad = 14 + rnd() * 20;
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rad, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = 36 + rnd() * 22, rad = 1.5 + rnd() * 4;
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rad, 0, Math.PI * 2); g.fill();
  }
  TEX = new THREE.CanvasTexture(c);
  TEX.colorSpace = THREE.NoColorSpace;
  return TEX;
}

export class Gore {
  constructor(G) {
    this.G = G;
    const q = (G.renderer && (G.renderer.quality || (G.renderer.preset && G.renderer.preset.id))) || 'medium';
    this.cap = CAP[q] || CAP.medium;
    const mat = new THREE.MeshLambertMaterial({
      color: 0x4a0604, alphaMap: texture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.cap);
    this.mesh.name = 'blut';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    this.items = [];       // { pos, quat, size, target, t0 }
    this.cursor = 0;
    this._pending = [];    // Lachen, die erst nach dem Hinfallen entstehen
    if (G.scene) G.scene.add(this.mesh);
    this._off = [
      G.events.on('actor:hit', (e) => this._hit(e)),
      G.events.on('kill', (e) => { if (e.victim) this._pending.push({ actor: e.victim, at: G.time.elapsed + 1.4 }); }),
    ];
  }

  _add(pos, normal, size, grow) {
    const now = this.G.time.elapsed;
    const it = { pos: pos.clone(), quat: new THREE.Quaternion().setFromUnitVectors(Z, normal), rot: Math.random() * Math.PI * 2, target: size, t0: now, grow };
    it.quat.multiply(_q.setFromAxisAngle(Z, it.rot));
    let i;
    if (this.items.length < this.cap) { i = this.items.length; this.items.push(it); } else { i = this.cursor; this.items[i] = it; this.cursor = (this.cursor + 1) % this.cap; }
    this._write(i, grow ? 0.15 : 1);
    this.mesh.count = this.items.length;
  }

  _write(i, k) {
    const it = this.items[i];
    const s = it.target * k;
    _p.copy(it.pos);
    _m.compose(_p, it.quat, _s.set(s, s, 1));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Spritzer hinter dem Getroffenen (Kopftreffer und Schrot größer). */
  _hit(e) {
    const W = this.G.world;
    if (!e || e.explosive || !e.point || !e.dir || !W || typeof W.raycast !== 'function') return;
    _d.set(e.dir.x, e.dir.y, e.dir.z).normalize();
    _p.copy(e.point).addScaledVector(_d, 0.25);
    const h = W.raycast(_p, _d, 2.4);
    if (!h || !h.point || !h.normal) return;
    _n.copy(h.normal);
    if (_n.dot(_d) > 0) _n.negate();
    const big = e.zone === 'head' ? 1.4 : 1;
    this._add(h.point.clone().addScaledVector(_n, 0.006), _n, (0.32 + Math.random() * 0.3) * big * (1 - (h.distance || 0) / 4), false);
  }

  update() {
    const G = this.G;
    const now = G.time.elapsed;
    // Lachen unter Gefallenen (Ragdoll-Becken, sonst Position beim Tod)
    for (let k = this._pending.length - 1; k >= 0; k--) {
      const p = this._pending[k];
      if (now < p.at) continue;
      this._pending.splice(k, 1);
      const a = p.actor;
      const rd = a && a.soldier && a.soldier.ragdoll;
      const src = rd && rd.p && rd.p[0] ? rd.p[0] : a && a.position;
      if (!src || !G.world || typeof G.world.raycast !== 'function') continue;
      _p.set(src.x, src.y + 0.6, src.z);
      const h = G.world.raycast(_p, DOWN, 2.5);
      if (!h || !h.point || !h.normal || h.normal.y < 0.6) continue;
      this._add(h.point.clone().addScaledVector(h.normal, 0.008), h.normal, 1.1 + Math.random() * 0.6, true);
    }
    // Wachstum der Lachen
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.grow) continue;
      const u = Math.min(1, (now - it.t0) / POOL_GROW);
      this._write(i, 0.15 + 0.85 * (1 - (1 - u) * (1 - u)));
      if (u >= 1) it.grow = false;
    }
  }

  dispose() {
    for (const f of this._off) f();
    this._off = [];
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.items = [];
  }
}
