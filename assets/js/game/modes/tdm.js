// NULLPUNKT — Team-Deathmatch: jeder Abschuss = 1 Teampunkt, Punktelimit / Zeitlimit, bei Gleichstand
// Verlängerung (nächster Abschuss entscheidet, 60 s), danach Unentschieden. Selbsttötung kostet nichts.

import { BaseMode } from './base.js';

export class TdmMode extends BaseMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.teams = true;
    this.scores = { A: 0, B: 0 };
  }

  onKillScored(killer, victim) {
    if (killer.team && killer.team !== victim.team) this.addTeamScore(killer.team, 1);
  }
}
