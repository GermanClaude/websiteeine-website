// NULLPUNKT — Modus-Fabrik (§9): createMode(G, modeId, opts) → Mode.
// tdm Team-Deathmatch · ffa Jeder gegen jeden · dom Herrschaft · gun Waffenspiel · training Schießstand ·
// cq Eroberung (Tickets, Trupps, Einsatzkarte) · kc Abschuss bestätigt · inf Infiziert · messer Nur Messer.
// Gemeinsame API siehe base.js; Bot-Schnittstelle (objectives, objectiveFor, streaks) im Changelog.

import { MODES } from '../../shared/modes.data.js';
import { BaseMode } from './base.js';
import { TdmMode } from './tdm.js';
import { FfaMode } from './ffa.js';
import { DomMode } from './dom.js';
import { GunMode } from './gun.js';
import { TrainingMode } from './training.js';
import { ConquestMode } from './conquest.js';
import { KillConfirmedMode } from './killconfirmed.js';
import { InfectedMode } from './infected.js';
import { UltimateMode } from './ultimate.js';
import { KnifeMode } from './knife.js';

export const MODE_CLASSES = { tdm: TdmMode, ffa: FfaMode, dom: DomMode, gun: GunMode, training: TrainingMode, cq: ConquestMode, kc: KillConfirmedMode, inf: InfectedMode, messer: KnifeMode, ult: UltimateMode };

export function createMode(G, modeId, opts = {}) {
  const Cls = MODE_CLASSES[modeId];
  if (Cls) return new Cls(G, modeId, opts);
  // Unbekannter Modus: nach Datenlage Team- oder Einzelwertung
  const def = MODES[modeId];
  return def && def.teams === false ? new FfaMode(G, modeId, opts) : new TdmMode(G, modeId, opts);
}

export { BaseMode, TdmMode, FfaMode, DomMode, GunMode, TrainingMode, ConquestMode, KillConfirmedMode, InfectedMode, KnifeMode };
export { SquadSystem } from './squads.js';
export { chooseSpawn } from './spawns.js';
export { StreakManager } from './streaks.js';
