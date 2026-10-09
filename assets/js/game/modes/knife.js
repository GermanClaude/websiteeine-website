// NULLPUNKT — Nur Messer: Team-Deathmatch, in dem alle (Spieler, Mitspieler, Bots) ausschließlich das Messer tragen –
// keine Schusswaffen, keine Granaten, keine Serienprämien. Die Ausrüstung kommt vom Modus (wie bei Infiziert) und
// wird bei jedem Wiedereinstieg erneut gesetzt; online setzt jedes Gerät sie für seine eigenen Akteure (Abbild).
// Dazu das Cheat-Menü des Modus (../cheats.js): nur der eigene Spieler, je Match neu; main.js ruft preUpdate(dt) vor dem
// Spieler, die Punktetabelle trägt „cheat“ (Symbol) für jeden mit aktivem Schalter.

import { TdmMode } from './tdm.js';
import { CheatSystem } from '../cheats.js';

const KNIFE_LOADOUT = { primary: 'knife', secondary: null, lethal: null, tactical: null };

export class KnifeMode extends TdmMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    const o = this.def.objective || {};
    this.knifeLoadout = { ...KNIFE_LOADOUT, ...(o.loadout || {}) };
    this.lockLoadout = true; // Ausrüstung kommt vom Modus
    this.cheats = null;
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

  /* ------------------------------------------------------------ Cheat-Menü */

  onAttach(s) {
    super.onAttach(s);
    try {
      this.cheats = new CheatSystem(this.G, this);
      this.cheats.attach(s);
    } catch (err) { console.error('[NULLPUNKT] Cheat-Menü:', err); this.cheats = null; }
  }

  onDetach() {
    super.onDetach();
    if (this.cheats) { try { this.cheats.dispose(); } catch (err) { console.error('[NULLPUNKT] Cheat-Menü:', err); } }
    this.cheats = null;
  }

  /** main.js: nach der Eingabe, vor dem Spieler – Blick, Bewegung und Nahkampf des Cheat-Menüs für dieses Bild. */
  preUpdate(dt) {
    if (this.cheats) this.cheats.preUpdate(dt);
  }

  update(dt) {
    super.update(dt);
    if (this.cheats) this.cheats.update(dt);
  }

  /** Punktetabelle: cheat = Cheat-Menü aktiv (eigener Spieler lokal, alle anderen Menschen laut Roster des Hosts). */
  scoreboard() {
    const rows = super.scoreboard();
    const net = this.G.net && this.G.net.online && typeof this.G.net.rosterEntry === 'function' ? this.G.net : null;
    for (const r of rows) {
      const a = r.actor;
      if (!a) continue;
      if (a.isPlayer) { if (this.cheats && this.cheats.active) r.cheat = true; continue; }
      if (net && Number.isInteger(a.netId)) {
        const e = net.rosterEntry(a.netId);
        if (e && e.cheat === true) r.cheat = true;
      }
    }
    return rows;
  }
}
