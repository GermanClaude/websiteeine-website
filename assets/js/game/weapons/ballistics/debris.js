// NULLPUNKT — „Physik-lite“ für Hülsen und Magazine (Realismus-Plan P4, alle Qualitätsstufen, ohne Rapier).
//
// Ballistische Teilchen in Weltkoordinaten: Schwerkraft, Luftwiderstand, je Bild ein kurzer Strahl entlang der
// Bewegung gegen die Kugel-Geometrie (world.raycast, BVH) → Abprall mit Stoßzahl/Reibung je Oberfläche, Taumeln,
// Liegenbleiben (Hülse quer auf der Fläche, Magazin flach auf der breiten Seite) für 8–20 s je Stufe, dann
// Ausblenden. Wasser schluckt sie. Erster Aufschlag meldet `shell:land` (Klang je Oberfläche, audio).
// Hülsen: ein InstancedMesh je Art (rifle | pistol | big | shotgun), unsichtbar ohne aktive Hülse.
// Magazine: kleiner Pool aus Klonen der 3rd-Person-Magazine (bereits kompilierte Materialien der Bots).
// Keine Allokationen pro Bild außer world.raycast-Treffern (selten: nur beim Aufschlag).
import * as THREE from 'three';
import { casingGeometry } from '../gunsmith/fx.js';
import { createWeaponModel } from '../models.js';

export const CASING_TYPES = ['rifle', 'pistol', 'big', 'shotgun'];
// Je Qualitätsstufe: liegende Hülsen gesamt, Magazine, Liegezeit (s), Strahlen je Bild
export const DEBRIS_TIERS = {
  low: { shells: 24, mags: 3, rest: 8, rays: 10 },
  medium: { shells: 48, mags: 4, rest: 12, rays: 16 },
  high: { shells: 96, mags: 6, rest: 16, rays: 28 },
  ultra: { shells: 160, mags: 8, rest: 20, rays: 40 },
};
const CAP_PER_TYPE = 160;
const MAG_CAP = 8;
const GRAVITY = 9.81;
const FADE = 0.6;          // s Ausblenden am Ende
const MAX_FLIGHT = 5;      // s – danach liegen bleiben, wo sie ist
// Oberflächen: Stoßzahl e, Reibung mu (tangential pro Aufschlag), weich = kaum Abprall
const SURF = {
  concrete: [0.4, 0.25], tile: [0.42, 0.22], plaster: [0.38, 0.25], metal: [0.45, 0.2], glass: [0.42, 0.2],
  wood: [0.32, 0.35], dirt: [0.12, 0.7], grass: [0.1, 0.75], sand: [0.08, 0.8], fabric: [0.1, 0.7], flesh: [0.1, 0.7],
};
// Halber Durchmesser der Hülsen (Abstand zur Fläche im Liegen) und Gewicht für den Klang
const CASE_R = { rifle: 0.0057, pistol: 0.0049, big: 0.0074, shotgun: 0.0108 };

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

let _shellMats = null;
function shellMaterials() {
  if (_shellMats) return _shellMats;
  // Welt-Hülsen: eigenes Material (Weltlicht, Nebel); überdauert Matches → Programm bleibt gelinkt
  _shellMats = {
    brass: new THREE.MeshStandardMaterial({ name: 'fx:brass', vertexColors: true, metalness: 0.85, roughness: 0.34 }),
    shot: new THREE.MeshStandardMaterial({ name: 'fx:shotshell', vertexColors: true, metalness: 0.3, roughness: 0.5 }),
  };
  return _shellMats;
}

class Item {
  constructor() {
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.w = new THREE.Vector3();
    this.reset();
  }
  reset() {
    this.alive = false; this.flying = false; this.t = 0; this.restT = 0; this.acc = 0; this.bounces = 0; this.sounds = 0;
    this.scale = 1; this.actor = null; this.type = null; this.slot = -1; this.obj = null; this.r = 0.006; this.halfT = 0.006;
    this.thin = 0; this.mag = false; this.seq = 0;
  }
}

export class Debris {
  /** opts: { events } – Ereignisbus für `shell:land` (optional) */
  constructor(opts = {}) {
    this.events = opts.events || null;
    this.group = new THREE.Group();
    this.group.name = 'fx-debris';
    this.tier = DEBRIS_TIERS.high;
    this.stats = { shells: 0, mags: 0, flying: 0, rays: 0 };
    this._seq = 0;
    this._time = 0;
    // Hülsen je Art
    const mats = shellMaterials();
    this.pools = {};
    for (const type of CASING_TYPES) {
      const mesh = new THREE.InstancedMesh(casingGeometry(type), type === 'shotgun' ? mats.shot : mats.brass, CAP_PER_TYPE);
      mesh.name = 'fx-casings-' + type;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      for (let i = 0; i < CAP_PER_TYPE; i++) mesh.setMatrixAt(i, ZERO_M);
      mesh.count = 0;
      this.group.add(mesh);
      const items = Array.from({ length: CAP_PER_TYPE }, () => new Item());
      this.pools[type] = { mesh, items, free: Array.from({ length: CAP_PER_TYPE }, (_, i) => CAP_PER_TYPE - 1 - i), used: 0, dirty: false };
    }
    // Magazine
    this._magProto = new Map();   // modelKey → { obj (Gruppe, Ursprung = Mitte), thin: Achse 0|1|2, half: [hx,hy,hz] }
    this.mags = [];
    this._magPool = [];
    this._pending = [];           // verzögerte Abwürfe (Bots): { at, key, pos, vel, quat, actor }
  }

  /** Stufe 'low' | 'medium' | 'high' | 'ultra' (Mengen, Liegezeit, Strahlenbudget). */
  setQuality(q) {
    this.tier = DEBRIS_TIERS[q] || DEBRIS_TIERS.high;
    this._enforceCaps(true);
  }

  /** Sichtbar lassen, bis der Aufrufer die Shader kompiliert hat (leere Pools blenden sich im ersten update aus). */
  showForCompile() { for (const t of CASING_TYPES) this.pools[t].mesh.visible = true; }

  /* ================================================================ Erzeugen */

  /**
   * Hülse auswerfen. type: rifle | pistol | big | shotgun; pos/vel (m, m/s) in Welt; quat optional (Achse = lokales Y).
   * opts: { actor, spin (rad/s) }
   */
  casing(type, pos, vel, quat, opts = {}) {
    const p = this.pools[type] || this.pools.rifle;
    if (!p) return null;
    if (!p.free.length || this.stats.shells >= this.tier.shells) this._evictShell();
    if (!p.free.length) return null;
    const slot = p.free.pop();
    const it = p.items[slot];
    it.reset();
    it.alive = true; it.flying = true; it.slot = slot; it.type = type in CASE_R ? type : 'rifle';
    it.r = CASE_R[it.type]; it.halfT = it.r;
    it.pos.copy(pos); it.vel.copy(vel);
    if (quat) it.q.copy(quat); else it.q.setFromAxisAngle(X, Math.PI / 2);
    const sp = opts.spin ?? 28;
    it.w.set((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp * 0.4, (Math.random() * 0.6 + 0.7) * sp);
    it.actor = opts.actor || null;
    it.seq = ++this._seq;
    p.used = Math.max(p.used, slot + 1);
    p.mesh.count = p.used;
    p.mesh.visible = true;
    this.stats.shells++;
    this._write(p, it);
    return it;
  }

  /**
   * Magazin fallen lassen (3rd-Person-Magazin des Modells). key = Modellschlüssel (def.model), pos/vel Welt.
   * opts: { actor, delay (s) }
   */
  magazine(key, pos, vel, quat, opts = {}) {
    if (opts.delay > 0) {
      if (this._pending.length < 16) this._pending.push({ at: this._time + opts.delay, key, pos: pos.clone(), vel: vel.clone(), quat: quat ? quat.clone() : null, actor: opts.actor || null });
      return null;
    }
    const proto = this._proto(key);
    if (!proto) return null;
    const cap = Math.min(MAG_CAP, this.tier.mags);
    while (this.mags.length >= cap) this._removeMag(this._oldestMag());
    const it = this._magPool.pop() || new Item();
    it.reset();
    it.alive = true; it.flying = true; it.mag = true; it.type = key;
    it.obj = proto.take();
    it.thin = proto.thin; it.halfT = proto.half[proto.thin]; it.r = Math.max(0.015, it.halfT);
    it.pos.copy(pos); it.vel.copy(vel);
    if (quat) it.q.copy(quat); else it.q.identity();
    it.w.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 9);
    it.actor = opts.actor || null;
    it.seq = ++this._seq;
    it.obj.position.copy(it.pos);
    it.obj.quaternion.copy(it.q);
    it.obj.scale.setScalar(1);
    it.obj.visible = true;
    this.group.add(it.obj);
    this.mags.push(it);
    this.stats.mags = this.mags.length;
    return it;
  }

  _proto(key) {
    let p = this._magProto.get(key);
    if (p !== undefined) return p;
    p = null;
    try {
      const model = createWeaponModel(key, { lod: 'third' });
      const src = model.userData.parts && (model.userData.parts.mag || model.userData.parts.belt);
      if (src) {
        const base = src.clone(true);
        base.position.set(0, 0, 0); base.quaternion.identity(); base.scale.set(1, 1, 1);
        base.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(base);
        const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        base.position.copy(c).negate();
        base.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = true; } });
        const half = [size.x / 2, size.y / 2, size.z / 2];
        const thin = half[0] <= half[1] && half[0] <= half[2] ? 0 : half[1] <= half[2] ? 1 : 2;
        const spare = [];
        p = {
          half, thin,
          // Klon-Hülle (Ursprung = Mitte des Magazins); Geometrie/Material bleiben geteilt (Modell-Cache)
          take: () => { if (spare.length) return spare.pop(); const g = new THREE.Group(); g.name = 'fx-mag-' + key; g.add(base.clone(true)); return g; },
          give: (g) => { if (spare.length < MAG_CAP) spare.push(g); },
        };
      }
    } catch { p = null; }
    this._magProto.set(key, p);
    return p;
  }

  /* ================================================================ Takt */

  /** world: { raycast, bounds } (darf fehlen – dann fallen Teile nur). camPos für die Entfernung (optional). */
  update(dt, world) {
    this._time += dt;
    if (this._pending.length) {
      for (let i = this._pending.length - 1; i >= 0; i--) {
        const d = this._pending[i];
        if (d.at > this._time) continue;
        this._pending.splice(i, 1);
        this.magazine(d.key, d.pos, d.vel, d.quat, { actor: d.actor });
      }
    }
    let budget = this.tier.rays;
    this.stats.rays = 0;
    let flying = 0;
    const rest = this.tier.rest;
    for (const type of CASING_TYPES) {
      const p = this.pools[type];
      if (!p.mesh.visible) continue;
      let any = false;
      for (let i = 0; i < p.used; i++) {
        const it = p.items[i];
        if (!it.alive) continue;
        any = true;
        if (it.flying) {
          flying++;
          it.acc += dt;
          if (budget > 0 || it.acc > 0.1) { budget--; this._step(it, it.acc, world); it.acc = 0; p.dirty = true; }
        } else {
          it.restT += dt;
          if (it.restT > rest) {
            it.scale = 1 - (it.restT - rest) / FADE;
            p.dirty = true;
            if (it.scale <= 0) { this._freeShell(p, it); continue; }
          }
        }
        if (p.dirty && it.alive) this._write(p, it);
      }
      if (p.dirty) { p.mesh.instanceMatrix.needsUpdate = true; p.dirty = false; }
      if (!any) { p.mesh.visible = false; p.used = 0; p.mesh.count = 0; }
    }
    for (let i = this.mags.length - 1; i >= 0; i--) {
      const it = this.mags[i];
      if (it.flying) {
        flying++;
        it.acc += dt;
        if (budget > 0 || it.acc > 0.1) { budget--; this._step(it, it.acc, world); it.acc = 0; }
        if (!it.alive) continue;
      } else {
        it.restT += dt;
        if (it.restT > rest + 4) {
          it.scale = 1 - (it.restT - rest - 4) / FADE;
          if (it.scale <= 0) { this._removeMag(it); continue; }
        }
      }
      it.obj.position.copy(it.pos);
      it.obj.quaternion.copy(it.q);
      it.obj.scale.setScalar(Math.max(0.001, it.scale));
    }
    this.stats.flying = flying;
  }

  /** Ein Integrationsschritt mit Kollisionsstrahl (Halbschritte bei großem dt). */
  _step(it, dt, world) {
    it.t += dt;
    const n = dt > 0.034 ? Math.ceil(dt / 0.034) : 1;
    const h = dt / n;
    for (let k = 0; k < n && it.flying; k++) {
      it.vel.y -= GRAVITY * h;
      const drag = Math.exp(-(it.mag ? 0.05 : 0.18) * h);
      it.vel.multiplyScalar(drag);
      _d.copy(it.vel).multiplyScalar(h);
      const len = _d.length();
      let hit = null;
      if (len > 1e-6 && world && typeof world.raycast === 'function') {
        _v.copy(_d).divideScalar(len);
        this.stats.rays++;
        try { hit = world.raycast(it.pos, _v, len + it.r); } catch { hit = null; }
        if (hit && hit.targetId !== undefined) hit = null;
      }
      if (hit) this._bounce(it, hit);
      else it.pos.add(_d);
      // Taumeln
      _e.set(it.w.x * h, it.w.y * h, it.w.z * h);
      it.q.multiply(_q.setFromEuler(_e)).normalize();
    }
    if (it.alive && it.flying && (it.t > MAX_FLIGHT || (world && world.bounds && it.pos.y < world.bounds.min.y - 4))) {
      if (it.t > MAX_FLIGHT) this._settle(it, Y);
      else this._kill(it);
    }
  }

  _bounce(it, hit) {
    _n.copy(hit.normal);
    if (_n.dot(it.vel) > 0) _n.negate();
    const surf = hit.surface || 'concrete';
    if (surf === 'water') { this._emit(it, hit.point, surf, it.vel.length()); this._kill(it); return; }
    const [e0, mu0] = SURF[surf] || SURF.concrete;
    const e = it.mag ? e0 * 0.45 : e0, mu = it.mag ? Math.min(0.9, mu0 + 0.25) : mu0;
    const vn = it.vel.dot(_n);
    const speed = it.vel.length();
    it.pos.copy(hit.point).addScaledVector(_n, it.r);
    // Normal- und Tangentialanteil
    _t.copy(it.vel).addScaledVector(_n, -vn).multiplyScalar(1 - mu);
    it.vel.copy(_t).addScaledVector(_n, -vn * e * (0.85 + Math.random() * 0.3));
    it.w.multiplyScalar(0.55).add(_v.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 18).multiplyScalar(Math.min(1, -vn / 3)));
    it.bounces++;
    if (-vn > 0.45 && it.sounds < 3) this._emit(it, hit.point, surf, -vn);
    const settled = (it.vel.length() < 0.45 && _n.y > 0.55) || it.bounces >= 7 || (speed < 0.6 && _n.y > 0.3);
    if (settled) this._settle(it, _n, hit.point);
  }

  /** Liegenbleiben: Hülse quer zur Normalen (zufällige Richtung), Magazin mit der dünnsten Achse zur Normalen. */
  _settle(it, normal, point) {
    it.flying = false;
    it.restT = 0;
    it.vel.set(0, 0, 0);
    it.w.set(0, 0, 0);
    const n = _n.copy(normal).normalize();
    if (point) it.pos.copy(point);
    if (it.mag) {
      const axis = it.thin === 0 ? X : it.thin === 1 ? Y : _v.set(0, 0, 1);
      _q.setFromUnitVectors(axis, Math.random() < 0.5 ? n : _t.copy(n).negate());
      _q2.setFromAxisAngle(n, Math.random() * Math.PI * 2);
      it.q.copy(_q2).multiply(_q);
      it.pos.addScaledVector(n, it.halfT + 0.002);
    } else {
      // Achse (lokal Y) in die Fläche legen
      _t.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _t.addScaledVector(n, -_t.dot(n));
      if (_t.lengthSq() < 1e-6) _t.crossVectors(n, X);
      _t.normalize();
      _q.setFromUnitVectors(Y, _t);
      _q2.setFromAxisAngle(_t, Math.random() * Math.PI * 2);
      it.q.copy(_q2).multiply(_q);
      it.pos.addScaledVector(n, it.r * 0.95);
    }
    if (!it.mag) this._enforceCaps(false);
  }

  _emit(it, point, surface, speed) {
    it.sounds++;
    const ev = this.events;
    if (!ev) return;
    ev.emit('shell:land', {
      position: point.clone ? point.clone() : new THREE.Vector3(point.x, point.y, point.z), surface,
      kind: it.mag ? 'mag' : 'shell', type: it.type, speed, first: it.sounds === 1, actor: it.actor,
    });
  }

  _write(p, it) {
    _s.setScalar(Math.max(0, it.scale));
    if (it.scale <= 0) p.mesh.setMatrixAt(it.slot, ZERO_M);
    else p.mesh.setMatrixAt(it.slot, _m.compose(it.pos, it.q, _s));
  }

  /* ================================================================ Verwaltung */

  _kill(it) {
    if (it.mag) { this._removeMag(it); return; }
    const p = this.pools[it.type];
    if (p) { this._freeShell(p, it); p.mesh.instanceMatrix.needsUpdate = true; }
  }

  _freeShell(p, it) {
    p.mesh.setMatrixAt(it.slot, ZERO_M);
    p.free.push(it.slot);
    it.alive = false;
    it.flying = false;
    this.stats.shells = Math.max(0, this.stats.shells - 1);
    p.dirty = true;
  }

  /** Älteste (bevorzugt liegende) Hülse entfernen, damit eine neue Platz hat. */
  _evictShell() {
    let best = null, bp = null;
    for (const type of CASING_TYPES) {
      const p = this.pools[type];
      for (let i = 0; i < p.used; i++) {
        const it = p.items[i];
        if (!it.alive) continue;
        const key = (it.flying ? 1e12 : 0) + it.seq;
        if (!best || key < ((best.flying ? 1e12 : 0) + best.seq)) { best = it; bp = p; }
      }
    }
    if (best) { this._freeShell(bp, best); bp.mesh.instanceMatrix.needsUpdate = true; }
  }

  /** Obergrenze der Stufe durchsetzen (beim Liegenbleiben bzw. Stufenwechsel). */
  _enforceCaps(all) {
    let guard = 400;
    while (this.stats.shells > this.tier.shells && guard-- > 0) this._evictShell();
    if (all) while (this.mags.length > this.tier.mags) this._removeMag(this._oldestMag());
  }

  _oldestMag() {
    let o = this.mags[0];
    for (const m of this.mags) if (m.seq < o.seq) o = m;
    return o;
  }

  _removeMag(it) {
    if (!it) return;
    const i = this.mags.indexOf(it);
    if (i >= 0) this.mags.splice(i, 1);
    if (it.obj) {
      it.obj.removeFromParent();
      const proto = this._magProto.get(it.type);
      if (proto) proto.give(it.obj);
    }
    it.reset();
    this._magPool.push(it);
    this.stats.mags = this.mags.length;
  }

  clear() {
    for (const type of CASING_TYPES) {
      const p = this.pools[type];
      for (let i = 0; i < p.used; i++) if (p.items[i].alive) { p.items[i].alive = false; p.mesh.setMatrixAt(i, ZERO_M); }
      p.free.length = 0;
      for (let i = CAP_PER_TYPE - 1; i >= 0; i--) p.free.push(i);
      p.used = 0; p.mesh.count = 0; p.mesh.visible = false; p.mesh.instanceMatrix.needsUpdate = true;
    }
    while (this.mags.length) this._removeMag(this.mags[this.mags.length - 1]);
    this._pending.length = 0;
    this.stats.shells = this.stats.mags = this.stats.flying = 0;
  }

  dispose() {
    this.clear();
    for (const type of CASING_TYPES) { const m = this.pools[type].mesh; m.geometry.dispose(); m.dispose(); }
    this._magProto.clear();
    this.group.removeFromParent();
    // Materialien (fx:brass/fx:shotshell) bleiben für das nächste Match gelinkt (wie die Effektschichten)
  }
}
