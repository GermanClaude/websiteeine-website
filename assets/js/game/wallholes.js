// NULLPUNKT — Durchlöcherte Wände: jeder Treffer auf feste Kartengeometrie trägt „Beschädigung“ in eine Zelle von
// 30 cm ein (Schaden × Kaliber, combat.js). Ist die Zelle durch (Schwelle je Material: Holz schnell, Beton nur nach
// mehreren Magazinen), entsteht ein Loch, das mit weiterem Beschuss wächst. Durch ein Loch geht jede Kugel durch
// (combat.js _penetrate fragt at()), sonst entscheidet wie bisher das Kaliber. Darstellung: dunkle Scheibe auf
// Ein- und Austrittsseite. Jedes Gerät rechnet seine Löcher selbst (reine Optik + Durchschuss der eigenen Kugeln).
import * as THREE from 'three';

const CELL = 0.3;
const MAX_HOLES = 80;
// Beschädigung bis zum ersten Loch je Oberfläche (Treffer zählen Schaden × (0,3 + Durchschlag) der Waffe)
const THRESHOLD = { wood: 110, glass: 30, metal: 380, tile: 300, plaster: 260, concrete: 1300, dirt: 700, sand: 650 };

let MAT = null;
let GEO = null;

export class WallHoles {
  constructor(G) {
    this.G = G;
    this.cells = new Map();
    this.holes = [];
    this.group = new THREE.Group();
    this.group.name = 'einschussloecher';
    if (G.scene) G.scene.add(this.group);
    if (!MAT) {
      MAT = new THREE.MeshBasicMaterial({ color: 0x050505, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
      GEO = new THREE.CircleGeometry(1, 14);
    }
  }

  _key(p, s) { return `${s}|${Math.round(p.x / CELL)}|${Math.round(p.y / CELL)}|${Math.round(p.z / CELL)}`; }

  /** Treffer auf feste Geometrie (nicht Türen/Bauwerke) eintragen. hit: { point, normal, surface }, dir = Schussrichtung. */
  hit(hit, def, dir) {
    if (!hit || !hit.point || hit.solid || hit.targetId != null) return;
    const s = hit.surface || 'concrete';
    const th = THRESHOLD[s];
    if (!th || !def || !def.damage) return;
    const add = (def.damage.max || 20) * (0.3 + (def.penetration || 0)) * (def.antiMateriel ? 3 : 1);
    const key = this._key(hit.point, s);
    let c = this.cells.get(key);
    if (!c) { c = { acc: 0, hole: null, th }; this.cells.set(key, c); }
    c.acc += add;
    if (c.acc < c.th) return;
    const r = 0.04 + 0.26 * Math.min(1, (c.acc - c.th) / (c.th * 2));
    if (!c.hole) {
      if (this.holes.length >= MAX_HOLES) return;
      c.hole = this._make(hit, dir, s);
      this.holes.push(c.hole);
    }
    c.hole.r = r;
    for (const m of c.hole.meshes) m.scale.setScalar(r);
  }

  _make(hit, dir, surface) {
    const G = this.G;
    const pos = hit.point.clone();
    const n = (hit.normal ? hit.normal.clone() : dir.clone().negate()).normalize();
    if (n.dot(dir) > 0) n.negate(); // zur Schützenseite
    const meshes = [this._disc(pos, n)];
    // Austrittsseite: von hinten zurück auf die Wand messen (höchstens 1,2 m)
    const W = G.world;
    if (W && typeof W.raycast === 'function') {
      const probe = pos.clone().addScaledVector(dir, 1.22);
      const back = W.raycast(probe, dir.clone().negate(), 1.22);
      if (back && back.distance > 0.02) meshes.push(this._disc(back.point, dir.clone()));
    }
    return { pos, r: 0.04, meshes, surface };
  }

  _disc(p, n) {
    const m = new THREE.Mesh(GEO, MAT);
    m.position.copy(p).addScaledVector(n, 0.004);
    m.lookAt(p.clone().add(n));
    m.scale.setScalar(0.04);
    m.renderOrder = 2;
    this.group.add(m);
    return m;
  }

  /** Loch an dieser Stelle? → Loch oder null (combat.js: dann geht jede Kugel durch). */
  at(p) {
    for (const h of this.holes) if (h.pos.distanceToSquared(p) < (h.r + 0.03) ** 2) return h;
    return null;
  }

  dispose() {
    this.cells.clear();
    this.holes.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
