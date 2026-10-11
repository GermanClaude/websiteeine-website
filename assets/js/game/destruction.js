// NULLPUNKT — Zerstörbare Fassaden (Wunschliste 10.10., „wie Battlefield“): ausgewählte Hauswände bestehen aus Paneelen
// (≈ 1,5 m, world/arch.js wall({ destructible })). Jedes Paneel ist ein eigenes Mesh und ein beweglicher Festkörper
// (Kollision/Kugeln über building.js addSolid). Explosionen (Granate, Rakete, Panzer, Luftschlag) und wiederholte
// schwere Treffer (MG, Präzisionsgewehr, Panzerbüchse) zermürben es; bei 0 bricht es heraus: Staubwolke, Brocken,
// Durchgang. Steht ein Paneel danach ohne Halt da (darunter und beidseitig nichts mehr), stürzt es nach.
// Jedes Gerät rechnet aus denselben Ereignissen ('explosion', Treffer) – reine Weltänderung, keine Netzbotschaft.
import * as THREE from 'three';
import { worldPartsFrom } from './building.js';

const HP = { concrete: 380, plaster: 260, tile: 300, wood: 160, metal: 300 };
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Destruction {
  constructor(G) {
    this.G = G;
    this.panels = [];
    this.broken = 0;
    this._queue = [];
    const list = (G.world && G.world.destructibles) || [];
    const byKey = new Map();
    for (const d of list) {
      const surface = (d.mesh && d.mesh.userData.surface) || 'concrete';
      const part = worldPartsFrom([[0, d.h / 2, 0, d.w / 2, d.h / 2, d.d / 2, 0]], d.x, d.y, d.z, d.ry)[0];
      const p = { d, hp: HP[surface] ?? 300, max: HP[surface] ?? 300, surface, alive: true, solid: null, center: new THREE.Vector3(d.x, d.y + d.h / 2, d.z) };
      p.solid = { id: `wand${d.id}`, def: { surface }, mesh: d.mesh, parts: [part], onHit: (dmg, by, def) => this._bullet(p, dmg, def) };
      if (G.building) G.building.addSolid(p.solid);
      byKey.set(`${d.wall}|${d.col}|${d.row}`, p);
      this.panels.push(p);
    }
    // Nachbarn für den Einsturz (gleiche Wand: darunter, links, rechts)
    for (const p of this.panels) {
      const { wall, col, row } = p.d;
      p.below = [...byKey.values()].find((q) => q.d.wall === wall && q.d.col === col && q.d.row < row && Math.abs(q.d.y + q.d.h - p.d.y) < 0.05) || null;
      p.side = [...byKey.values()].filter((q) => q !== p && q.d.wall === wall && q.d.row === row && Math.abs(Math.hypot(q.d.x - p.d.x, q.d.z - p.d.z) - (p.d.w + q.d.w) / 2) < 0.05);
    }
    this._off = this.panels.length ? [G.events.on('explosion', (e) => this._explosion(e))] : [];
  }

  _explosion(e) {
    if (!e || e.nonLethal || !e.position) return;
    const r = (e.radius || 6) + 0.8;
    const power = 170 * Math.min(2.2, (e.radius || 6) / 5.5) * (e.type === 'strike' || e.type === 'tank' ? 1.6 : 1);
    for (const p of this.panels) {
      if (!p.alive) continue;
      // Abstand zur Paneelfläche (nicht zur Mitte): Box-Nächstpunkt
      const box = p.solid.parts[0].box;
      box.clampPoint(e.position, _c);
      const d = _c.distanceTo(e.position);
      if (d > r) continue;
      this._damage(p, power * (1 - d / r) * (d < 1.2 ? 1.5 : 1));
    }
  }

  _bullet(p, dmg, def) {
    if (!p.alive || !def) return;
    const k = def.antiMateriel ? 3 : (def.penetration || 0) >= 0.75 ? 0.5 : 0.12;
    this._damage(p, dmg * k);
  }

  _damage(p, amount) {
    if (!p.alive || !(amount > 0)) return;
    p.hp -= amount;
    if (p.hp <= 0) this._break(p);
  }

  _break(p, chain = false) {
    if (!p.alive) return;
    p.alive = false;
    this.broken++;
    const G = this.G;
    if (G.building) G.building.removeSolid(p.solid);
    if (p.d.mesh) p.d.mesh.visible = false; // Geometrie gibt die Welt beim Abbau frei
    _n.set(Math.sin(p.d.ry), 0, Math.cos(p.d.ry)); // Wandnormale (lokal z)
    if (G.effects && typeof G.effects.rubble === 'function') G.effects.rubble(p.center, _n, p.surface, Math.max(p.d.w, p.d.h));
    if (G.audio && typeof G.audio.play === 'function') { try { G.audio.play('debris', { position: p.center, volume: chain ? 0.6 : 1 }); } catch { /* */ } }
    G.events.emit('wall:break', { position: p.center.clone(), surface: p.surface, chain });
    // ohne Halt: Paneele darüber stürzen kurz danach nach
    for (const q of this.panels) if (q.alive && q.below === p) this._queue.push({ p: q, at: G.time.elapsed + 0.25 + Math.random() * 0.2 });
  }

  update() {
    if (!this._queue.length) return;
    const now = this.G.time.elapsed;
    for (let i = this._queue.length - 1; i >= 0; i--) {
      const { p, at } = this._queue[i];
      if (now < at) continue;
      this._queue.splice(i, 1);
      if (!p.alive) continue;
      const held = p.side.some((q) => q.alive && q.below && q.below.alive);
      if (!held) this._break(p, true);
    }
  }

  dispose() {
    for (const f of this._off) f();
    this._off = [];
    if (this.G.building) for (const p of this.panels) this.G.building.removeSolid(p.solid);
    this.panels = [];
    this._queue = [];
  }
}
