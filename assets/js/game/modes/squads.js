// NULLPUNKT — Trupps (Eroberung, GROSSKAMPF_PLAN §5.3): je Team Gruppen zu vier (Anton, Berta, Cäsar …),
// der Spieler führt seinen Trupp. Befehle („Angriff auf B“, „Verteidigt C“) gelten für alle Mitglieder;
// mode.objectiveFor(bot) folgt ihnen. KI-Trupps bekommen ihre Ziele vom einfachen Teamhirn im Modus.
// API (G.squads): list, of(actor), members(squad, {alive}), leaderOf(actor), order(squad, order, by), clearOrder(squad).

import { SQUAD_NAMES, SQUAD_SIZE } from '../../shared/modes.data.js';

export class SquadSystem {
  constructor(G) {
    this.G = G;
    this.list = [];
    this._byTeam = { A: [], B: [] };
  }

  /** Alle Teamakteure einteilen (nach dem ersten Spawn). Der Spieler kommt mit den nächsten Verbündeten zusammen. */
  build() {
    const G = this.G;
    this.list = [];
    this._byTeam = { A: [], B: [] };
    for (const a of G.actors) if (a.squad) a.squad = null;
    for (const team of ['A', 'B']) {
      const pool = G.actors.filter((a) => a.team === team && !a.isStreakEntity);
      const pl = pool.find((a) => a.isPlayer);
      if (pl) {
        pool.splice(pool.indexOf(pl), 1);
        pool.sort((x, y) => x.position.distanceToSquared(pl.position) - y.position.distanceToSquared(pl.position));
        pool.unshift(pl);
      }
      while (pool.length) this._make(team, pool.splice(0, SQUAD_SIZE));
    }
  }

  _make(team, members) {
    const list = this._byTeam[team];
    const index = list.length;
    const name = SQUAD_NAMES[index % SQUAD_NAMES.length] + (index >= SQUAD_NAMES.length ? `-${Math.floor(index / SQUAD_NAMES.length) + 1}` : '');
    const sq = { id: `${team}-${index}`, team, index, name, label: name, members: [], leader: null, order: null, orderAt: 0, orderBy: null, targetAt: 0 };
    for (const m of members) this._join(sq, m);
    list.push(sq);
    this.list.push(sq);
    return sq;
  }

  _join(sq, a) {
    sq.members.push(a);
    a.squad = sq;
    if (!sq.leader || a.isPlayer) sq.leader = a;
    a.squadLabel = `${sq.name}-${sq.members.length}`;
  }

  /** Trupp eines Akteurs (spät hinzugekommene Bots werden aufgefüllt). */
  of(actor) {
    if (!actor || (actor.team !== 'A' && actor.team !== 'B')) return null;
    if (actor.squad && actor.squad.team === actor.team) return actor.squad;
    const list = this._byTeam[actor.team];
    const free = list.find((s) => s.members.filter((m) => this.G.actors.includes(m)).length < SQUAD_SIZE);
    if (free) { free.members = free.members.filter((m) => this.G.actors.includes(m)); this._join(free, actor); return free; }
    return this._make(actor.team, [actor]);
  }

  members(sq, { alive = false } = {}) {
    if (!sq) return [];
    return sq.members.filter((m) => this.G.actors.includes(m) && m.team === sq.team && (!alive || m.alive));
  }

  leaderOf(actor) {
    const sq = this.of(actor);
    return sq ? sq.leader : null;
  }

  /** Befehl an einen Trupp: { kind: 'attack'|'defend', objectiveId, label? }. */
  order(sq, order, by = null) {
    if (!sq || !order) return;
    sq.order = { kind: order.kind === 'defend' ? 'defend' : 'attack', objectiveId: order.objectiveId, label: order.label || '', at: this.G.time.elapsed };
    sq.orderAt = this.G.time.elapsed;
    sq.orderBy = by;
    this.G.events.emit('squad:order', { squad: sq, order: sq.order, by });
  }

  clearOrder(sq) {
    if (sq) sq.order = null;
  }

  dispose() {
    for (const a of this.G.actors) if (a.squad) { a.squad = null; a.squadLabel = null; }
    this.list = [];
    this._byTeam = { A: [], B: [] };
  }
}
