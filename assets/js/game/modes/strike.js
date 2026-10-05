// NULLPUNKT — Präzisionsschlag (Serienprämie 'strike'): Zielmarkierung am Boden, Jet-Überflug aus Grundkörpern,
// danach eine Reihe Raketeneinschläge entlang der Flugrichtung über combat.explode (Angreifer = Besitzer).

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, -1);
const ALT = 72;
const SPEED = 165;

/** Bodenhöhe unter (x, z) – bevorzugt world.groundHeight, sonst Strahl nach unten. */
export function groundAt(world, x, z, yFrom = 40) {
  if (!world) return 0;
  if (typeof world.groundHeight === 'function') {
    const y = world.groundHeight(x, z, yFrom);
    if (Number.isFinite(y)) return y;
  }
  if (typeof world.raycast === 'function') {
    const hit = world.raycast(_v.set(x, yFrom, z), new THREE.Vector3(0, -1, 0), yFrom + 30);
    if (hit) return hit.point.y;
  }
  return 0;
}

let shared = null;

/** Geteilte Ressourcen des Präzisionsschlags (wie sentryResources: vorkompiliert, über Matches hinweg). */
export function strikeResources() {
  return shared || (shared = createStrikeResources());
}

/** Neuer, eigener Satz (Dev-Seiten); im Spiel strikeResources(). */
export function createStrikeResources() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -1.2);
  shape.lineTo(5.8, 2.6);
  shape.lineTo(5.8, 3.6);
  shape.lineTo(0, 2.4);
  shape.lineTo(-5.8, 3.6);
  shape.lineTo(-5.8, 2.6);
  shape.closePath();
  const wing = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.1, 0);
  const res = {
    body: new THREE.CylinderGeometry(0.75, 0.95, 11, 10).rotateX(Math.PI / 2),
    nose: new THREE.ConeGeometry(0.75, 3.2, 10).rotateX(-Math.PI / 2).translate(0, 0, -7.1),
    canopy: new THREE.SphereGeometry(0.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 2.2).translate(0, 0.55, -3.6),
    wing,
    fin: new THREE.BoxGeometry(0.16, 2.6, 2.2).translate(0, 1.6, 4.4),
    tail: new THREE.BoxGeometry(5.2, 0.14, 1.6).translate(0, 0.2, 4.7),
    glow: new THREE.CircleGeometry(0.7, 12).translate(0, 0, 0).rotateY(0),
    trail: new THREE.PlaneGeometry(1.1, 26).rotateX(-Math.PI / 2).translate(0, 0, 18.5),
    missile: new THREE.CylinderGeometry(0.12, 0.14, 1.9, 8).rotateX(Math.PI / 2),
    mtrail: new THREE.PlaneGeometry(0.5, 9).rotateX(-Math.PI / 2).translate(0, 0, 5.2),
    ring: new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
    disc: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
    beam: new THREE.CylinderGeometry(0.18, 0.18, 34, 8, 1, true).translate(0, 17, 0),
    mats: {
      hull: new THREE.MeshStandardMaterial({ color: 0x5b636b, roughness: 0.55, metalness: 0.45 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.15, metalness: 0.8 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffa04a, toneMapped: false, side: THREE.DoubleSide }),
      trail: new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      missile: new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.6, metalness: 0.3 }),
      ringAlly: new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
      ringEnemy: new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
      discAlly: new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }),
      discEnemy: new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false }),
      beam: new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    },
  };
  res.dispose = () => {
    for (const v of Object.values(res)) if (v && v.isBufferGeometry) v.dispose();
    for (const m of Object.values(res.mats)) m.dispose();
  };
  return res;
}

export class Strike {
  /**
   * @param mgr StreakManager, owner Actor, target Vector3, params STREAKS.strike.params
   */
  constructor(mgr, owner, target, params) {
    const G = mgr.G;
    this.mgr = mgr;
    this.G = G;
    this.owner = owner;
    this.team = owner.team;
    this.params = { delay: 2.5, impacts: 3, spacing: 6, interval: 0.35, radius: 7, maxDamage: 200, minDamage: 30, ...params };
    this.t = 0;
    this.done = false;
    const w = G.world;
    // Flugrichtung: vom Besitzer zum Ziel (sonst Blickrichtung)
    const dir = new THREE.Vector3(target.x - owner.position.x, 0, target.z - owner.position.z);
    if (dir.lengthSq() < 4) owner.getAimDirection ? owner.getAimDirection(dir) : dir.set(0, 0, -1);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    this.dir = dir;
    this.target = new THREE.Vector3(target.x, groundAt(w, target.x, target.z, (target.y || 0) + 30), target.z);
    const n = Math.max(1, this.params.impacts | 0);
    this.impacts = [];
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * this.params.spacing;
      const x = this.target.x + dir.x * off;
      const z = this.target.z + dir.z * off;
      const at = this.params.delay + i * this.params.interval;
      this.impacts.push({ pos: new THREE.Vector3(x, groundAt(w, x, z, this.target.y + 30), z), at, launched: false, exploded: false, missile: null, from: null });
    }
    this.passAt = Math.max(0.6, this.params.delay - 0.75);
    this.end = this.impacts[n - 1].at + Math.max(0.6, 520 / SPEED - (this.params.delay - this.passAt));
    this._build(mgr.resources('strike'));
  }

  get position() { return this.target; }
  get radius() { return this.params.radius + this.params.spacing; }

  _build(R) {
    const G = this.G;
    const P = G.player;
    const ally = P && (this.owner === P || (this.owner.team != null && this.owner.team === P.team));
    const root = new THREE.Group();
    root.name = 'strike';
    // Markierung
    const mark = new THREE.Group();
    mark.position.copy(this.target);
    mark.position.y += 0.06;
    const r = this.params.radius;
    const ring = new THREE.Mesh(R.ring, ally ? R.mats.ringAlly : R.mats.ringEnemy);
    ring.scale.setScalar(r);
    const disc = new THREE.Mesh(R.disc, ally ? R.mats.discAlly : R.mats.discEnemy);
    disc.scale.setScalar(r);
    const beam = new THREE.Mesh(R.beam, R.mats.beam);
    mark.add(ring, disc, beam);
    for (const m of [ring, disc, beam]) { m.renderOrder = 3; m.frustumCulled = false; }
    root.add(mark);
    // Jet
    const jet = new THREE.Group();
    for (const [geo, mat] of [[R.body, R.mats.hull], [R.nose, R.mats.hull], [R.canopy, R.mats.glass], [R.wing, R.mats.hull], [R.fin, R.mats.hull], [R.tail, R.mats.hull]]) {
      const m = new THREE.Mesh(geo, mat);
      jet.add(m);
    }
    const glow = new THREE.Mesh(R.glow, R.mats.glow);
    glow.position.z = 5.55;
    const trail = new THREE.Mesh(R.trail, R.mats.trail);
    jet.add(glow, trail);
    _q.setFromUnitVectors(FWD, this.dir);
    jet.quaternion.copy(_q);
    jet.visible = false;
    root.add(jet);
    this.root = root;
    this.mark = mark;
    this.ring = ring;
    this.jet = jet;
    this.R = R;
    G.scene.add(root);
  }

  update(dt) {
    if (this.done) return false;
    const G = this.G;
    this.t += dt;
    const t = this.t;
    // Markierung pulsiert
    const pulse = 1 + Math.sin(t * 9) * 0.04;
    this.ring.scale.setScalar(this.params.radius * pulse);
    // Jet-Überflug
    const s = (t - this.passAt) * SPEED;
    if (Math.abs(s) < 900) {
      this.jet.visible = true;
      this.jet.position.copy(this.target).addScaledVector(this.dir, s);
      this.jet.position.y = this.target.y + ALT + Math.max(0, -s) * 0.04;
    } else this.jet.visible = false;
    // Raketen
    for (const im of this.impacts) {
      if (!im.launched && t >= im.at - 0.55) {
        im.launched = true;
        im.from = this.target.clone().addScaledVector(this.dir, -26).setY(this.target.y + ALT - 6);
        im.from.x += (im.pos.x - this.target.x);
        im.from.z += (im.pos.z - this.target.z);
        const m = new THREE.Group();
        m.add(new THREE.Mesh(this.R.missile, this.R.mats.missile), new THREE.Mesh(this.R.mtrail, this.R.mats.trail));
        _v.subVectors(im.pos, im.from).normalize();
        m.quaternion.setFromUnitVectors(FWD, _v);
        m.position.copy(im.from);
        this.root.add(m);
        im.missile = m;
      }
      if (im.missile && !im.exploded) {
        const k = Math.min(1, (t - (im.at - 0.55)) / 0.55);
        im.missile.position.lerpVectors(im.from, im.pos, k * k);
      }
      if (!im.exploded && t >= im.at) {
        im.exploded = true;
        if (im.missile) { im.missile.removeFromParent(); im.missile = null; }
        if (G.combat && G.match.state !== 'ended') {
          const p = this.params;
          G.combat.explode({
            position: im.pos.clone().setY(im.pos.y + 0.35), radius: p.radius, maxDamage: p.maxDamage, minDamage: p.minDamage,
            innerRadius: p.radius * 0.3, attacker: this.owner, weaponId: 'strike', type: 'airstrike',
          });
        }
        this.mgr._strikeImpact(this, im.pos);
      }
    }
    if (t > this.impacts[this.impacts.length - 1].at) this.mark.visible = false;
    if (t >= this.end) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.done = true;
    if (this.root) this.root.removeFromParent();
    this.root = null;
  }
}
