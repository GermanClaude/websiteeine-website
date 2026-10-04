// NULLPUNKT — Jeder gegen jeden: Wertung = Abschüsse, Platz 1–3 zählt als Sieg (MODES.ffa.winPlaces),
// Gleichstand an der Spitze bei Zeitende → Verlängerung (nächster Abschuss), sonst Unentschieden.

import { BaseMode } from './base.js';

export class FfaMode extends BaseMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.teams = false;
    this.scores = {};
  }

  onStart() {
    for (const a of this.G.actors) this.scores[a.id] = a.stats ? a.stats.kills || 0 : 0;
  }

  onSpawn(actor) {
    if (actor && !actor.isStreakEntity && !(actor.id in this.scores)) this.scores[actor.id] = actor.stats ? actor.stats.kills || 0 : 0;
  }

  onKillScored(killer) {
    this.scores[killer.id] = (this.scores[killer.id] || 0) + 1;
  }

  compareRows(x, y) {
    return y.kills - x.kills || y.score - x.score || x.deaths - y.deaths || (x.isPlayer ? -1 : y.isPlayer ? 1 : 0);
  }

  rankKey(r) {
    return `${r.kills}`;
  }

  /** Spieler-Sicht für das HUD: { place, mine, leaderKills, leaderName, total }. */
  standing(actor = this.G.player) {
    const board = this.scoreboard();
    const i = board.findIndex((r) => r.actor === actor);
    const leader = board[0];
    const other = board.find((r) => r.actor !== actor);
    return {
      place: i + 1, total: board.length, mine: i >= 0 ? board[i].kills : 0,
      leaderKills: leader ? leader.kills : 0, leaderName: leader ? leader.name : '', leaderIsMe: leader ? leader.actor === actor : false,
      bestOther: other ? other.kills : 0, bestOtherName: other ? other.name : '',
    };
  }
}
