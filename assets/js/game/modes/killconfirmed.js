// NULLPUNKT — Abschuss bestätigt (REALISM_PLAN §11.1): Jeder Ausgeschaltete verliert seine Erkennungsmarke.
// Gegnerische Marke einsammeln = bestätigt (+1 Teampunkt), Marke eines Kameraden = verweigert. Marken verfallen nach
// tagLife Sekunden. Darstellung: kleine schwebende Marken (geteilte Geometrie/Materialien, unbeleuchtet).
// Bots: objectiveFor(bot) führt zur nächsten Marke in der Nähe.

import * as THREE from 'three';
import { BaseMode } from './base.js';

const POOL = 28;
const COL_ALLY = 0x38b6ff;
const COL_ENEMY = 0xff4a2e;
let shared = null; // { geo, ring, ally, enemy, ringAlly, ringEnemy } – matchübergreifend

function resources() {
  if (shared) return shared;
  const geo = new THREE.BoxGeometry(0.16, 0.24, 0.025);
  geo.translate(0, 0.0, 0);
  const ring = new THREE.RingGeometry(0.34, 0.42, 24);
  ring.rotateX(-Math.PI / 2);
  const mk = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1, fog: true });
  shared = { geo, ring, ally: mk(COL_ALLY), enemy: mk(COL_ENEMY), ringAlly: mk(COL_ALLY, 0.45), ringEnemy: mk(COL_ENEMY, 0.45) };
  return shared;
}

export class KillConfirmedMode extends BaseMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.teams = true;
    this.scores = { A: 0, B: 0 };
    const o = this.def.objective || {};
    this.tagLife = o.tagLife || 30;
    this.pickupR = o.pickupRadius || 1.7;
    this.tags = [];
    this._group = null;
    this._pool = [];
    this._lifeTags = new Map();
    this._seq = 0;
  }

  onAttach() {
    const G = this.G;
    const R = resources();
    this._group = new THREE.Group();
    this._group.name = 'kc:marken';
    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Group();
      const tag = new THREE.Mesh(R.geo, R.enemy);
      const ring = new THREE.Mesh(R.ring, R.ringEnemy);
      ring.position.y = 0.04;
      g.add(tag, ring);
      g.visible = false;
      g.userData = { tag, ring };
      this._group.add(g);
      this._pool.push(g);
    }
    if (G.scene) G.scene.add(this._group);
  }

  onDetach() {
    if (this._group) this._group.removeFromParent();
    this._group = null;
    this._pool = [];
    this.tags = [];
    this._lifeTags.clear();
  }

  warmObjects() {
    const R = resources();
    return [new THREE.Mesh(R.geo, R.ally), new THREE.Mesh(R.geo, R.enemy), new THREE.Mesh(R.ring, R.ringAlly), new THREE.Mesh(R.ring, R.ringEnemy)];
  }

  /* ------------------------------------------------------------ Marken */

  _drop(victim, killer) {
    if (!victim || (victim.team !== 'A' && victim.team !== 'B') || !victim.position) return;
    if (this.tags.length >= POOL) this._remove(this.tags[0]);
    // gameplay-hunt: belegte Knoten über ein Flag statt `visible` – blinkende Marken (letzte 5 s) sind zeitweise
    // unsichtbar und ihr Knoten wurde sonst an eine neue Marke vergeben (zwei Marken teilen ein Modell, eine wird unsichtbar)
    const g = this._pool.find((x) => !x.userData.used);
    const pos = victim.position.clone();
    const tag = { id: ++this._seq, team: victim.team, victim, killer, position: pos, born: this.G.time.elapsed, node: g };
    if (g) { g.userData.used = true; g.visible = true; g.position.copy(pos); }
    this.tags.push(tag);
    this.G.events.emit('tag:drop', { tag: { id: tag.id, team: tag.team, position: pos }, victim, killer });
  }

  _remove(tag) {
    const i = this.tags.indexOf(tag);
    if (i >= 0) this.tags.splice(i, 1);
    if (tag.node) { tag.node.visible = false; tag.node.userData.used = false; }
  }

  onKillScored(killer, victim) {
    this._drop(victim, killer);
  }

  onSuicide(victim) {
    this._drop(victim, null);
  }

  tick(dt, playing) {
    const G = this.G;
    const now = G.time.elapsed;
    const R = resources();
    const me = G.player && G.player.team;
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const t = this.tags[i];
      const age = now - t.born;
      if (age > this.tagLife) { this._remove(t); continue; }
      const g = t.node;
      if (g) {
        const ally = t.team === me;
        const { tag, ring } = g.userData;
        if (tag.material !== (ally ? R.ally : R.enemy)) { tag.material = ally ? R.ally : R.enemy; ring.material = ally ? R.ringAlly : R.ringEnemy; }
        tag.position.y = 0.72 + Math.sin(now * 2.6 + t.id) * 0.06;
        tag.rotation.y = now * 2.2 + t.id;
        // letzte 5 s blinken
        g.visible = age < this.tagLife - 5 || Math.sin(age * 14) > -0.2;
      }
      if (!playing) continue;
      for (const a of G.actors) {
        if (!a.alive || a.isStreakEntity || (a.team !== 'A' && a.team !== 'B')) continue;
        const dx = a.position.x - t.position.x;
        const dz = a.position.z - t.position.z;
        if (dx * dx + dz * dz > this.pickupR * this.pickupR || Math.abs(a.position.y - t.position.y) > 2) continue;
        this._collect(a, t);
        break;
      }
    }
  }

  _collect(a, t) {
    this._remove(t);
    const confirm = a.team !== t.team;
    if (confirm) {
      this.award(a, 'confirm');
      this.count(a, 'confirms');
      const n = (this._lifeTags.get(a) || 0) + 1;
      this._lifeTags.set(a, n);
      if (n === 5) this.medals.award(a, 'markensammler');
      this.G.events.emit('tag:confirm', { actor: a, team: a.team, victim: t.victim, position: t.position });
      this.addTeamScore(a.team, 1);
    } else {
      this.award(a, 'deny');
      this.count(a, 'denies');
      this.G.events.emit('tag:deny', { actor: a, team: a.team, victim: t.victim, position: t.position });
    }
  }

  onSpawn(actor) {
    this._lifeTags.delete(actor);
  }

  /** Bots: nächste Marke (≤ 30 m) aufsammeln. */
  objectiveFor(bot) {
    if (!bot || !this.tags.length) return null;
    let best = null;
    let bestD = 30;
    for (const t of this.tags) {
      const d = bot.position.distanceTo(t.position);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (!best) return null;
    return { id: `tag${best.id}`, position: best.position.clone(), radius: 1.1, kind: 'capture' };
  }

  extraRow(a) {
    return { label: 'Marken', value: a.stats ? a.stats.kcConfirms || 0 : 0 };
  }

  award(actor, reason, points) {
    if (reason === 'confirm' && actor && actor.stats) actor.stats.kcConfirms = (actor.stats.kcConfirms || 0) + 1;
    return super.award(actor, reason, points);
  }
}
