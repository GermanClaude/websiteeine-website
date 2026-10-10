// NULLPUNKT — Nur Messer: Team-Deathmatch, in dem alle (Spieler, Mitspieler, Bots) ausschließlich das Messer tragen –
// keine Schusswaffen, keine Granaten, keine Serienprämien. Die Ausrüstung kommt vom Modus (wie bei Infiziert) und
// wird bei jedem Wiedereinstieg erneut gesetzt; online setzt jedes Gerät sie für seine eigenen Akteure (Abbild).
// Das Cheat-Menü (../cheats.js) hängt seit 10.10. an jedem Modus (base.js).

import { TdmMode } from './tdm.js';

const KNIFE_LOADOUT = { primary: 'knife', secondary: null, lethal: null, tactical: null };

export class KnifeMode extends TdmMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    const o = this.def.objective || {};
    this.knifeLoadout = { ...KNIFE_LOADOUT, ...(o.loadout || {}) };
    this.lockLoadout = true; // Ausrüstung kommt vom Modus
  }

  _knife(a) {
    if (!a) return;
    a.loadout = { ...(a.loadout || {}), ...this.knifeLoadout };
    if (a.weapon && typeof a.weapon.setLoadout === 'function') {
      try { a.weapon.setLoadout(a.loadout); } catch (err) { console.error('[NULLPUNKT] Nur Messer setLoadout:', err); }
    }
  }

  onStart() {
    for (const a of this.G.actors) this._knife(a);
  }

  onSpawn(actor) {
    if (!this.started || !actor) return;
    this._knife(actor);
  }
}
