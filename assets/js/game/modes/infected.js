// NULLPUNKT — Infiziert (REALISM_PLAN §11.1): Team A = Überlebende (zufällige Waffen), Team B = Infizierte
// (Messer + Haftgranate, schneller zurück). Wer als Überlebender fällt, wechselt beim Wiedereinstieg die Seite.
// Die Infizierten gewinnen, sobald niemand mehr übrig ist; sonst gewinnen die Überlebenden nach Ablauf der Zeit.
// Punkte: Infizieren, Überlebens-Takt (alle surviveTick s), normale Abschüsse.

import { WEAPONS } from '../../shared/weapons.data.js';
import { BaseMode } from './base.js';

export class InfectedMode extends BaseMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.teams = true;
    this.scores = { A: 0, B: 0 };
    this.teamNames = this.def.teamNames || { A: 'Überlebende', B: 'Infizierte' };
    const o = this.def.objective || {};
    this.surviveTick = o.surviveTick || 20;
    this.infLoadout = o.infectedLoadout || { primary: 'knife', secondary: null, lethal: 'semtex' };
    this.lockLoadout = true; // Ausrüstung kommt vom Modus
    this.scoreMax = 0;
    this._surviveT = 0;
    this._zero = new Set();
    this._zeroInfects = 0;
  }

  onStart() {
    const G = this.G;
    const pool = Object.values(WEAPONS).filter((w) => w.slot === 'primary' && w.cls !== 'melee');
    for (const a of G.actors) {
      if (a.team === 'B') { this._zero.add(a); this._infectLoadout(a); } else if (a.team === 'A') this._randomLoadout(a, pool);
    }
    this._count();
    this.scoreMax = (this.scores.A || 0) + (this.scores.B || 0);
  }

  _randomLoadout(a, pool) {
    const w = pool[(Math.random() * pool.length) | 0];
    if (w) this._setLoadout(a, { primary: w.id, secondary: 'pi_p9', lethal: 'frag' });
  }

  _infectLoadout(a) {
    this._setLoadout(a, { ...this.infLoadout });
  }

  _setLoadout(a, lo) {
    a.loadout = { ...(a.loadout || {}), ...lo };
    if (a.weapon && typeof a.weapon.setLoadout === 'function') {
      try { a.weapon.setLoadout(a.loadout); } catch (err) { console.error('[NULLPUNKT] Infiziert setLoadout:', err); }
    }
  }

  _count() {
    let A = 0;
    let B = 0;
    for (const a of this.G.actors) { if (a.team === 'A') A++; else if (a.team === 'B') B++; }
    this.scores.A = A;
    this.scores.B = B;
  }

  /** Überlebender ausgeschaltet (auch durch Sturz/Granate) → wird infiziert. */
  _infect(victim, by) {
    if (!victim || victim.team !== 'A') return;
    victim.team = 'B';
    if (by && by !== victim && by.team === 'B') {
      this.award(by, 'infect');
      this.count(by, 'infects');
      if (this._zero.has(by) && ++this._zeroInfects === 3) this.medals.award(by, 'patientnull');
    }
    this._count();
    this.G.events.emit('infect', { actor: victim, by: by || null });
    if (this.scores.A <= 0) this.end('infected');
  }

  onKillScored(killer, victim) {
    this._infect(victim, killer);
  }

  onSuicide(victim) {
    this._infect(victim, null);
  }

  onSpawn(actor) {
    if (!this.started || !actor) return;
    if (actor.team === 'B') this._infectLoadout(actor);
  }

  tick(dt, playing) {
    if (!playing) return;
    this._count();
    this._surviveT += dt;
    if (this._surviveT >= this.surviveTick) {
      this._surviveT -= this.surviveTick;
      for (const a of this.G.actors) if (a.team === 'A' && a.alive) { this.award(a, 'survive'); }
    }
  }

  allowOvertime() {
    return false;
  }

  /** Zeit um und noch Überlebende → Team A gewinnt; niemand mehr übrig → Team B. */
  decide() {
    return { winner: (this.scores.A || 0) > 0 ? 'A' : 'B' };
  }

  end(reason) {
    if (this.isOver) return;
    const p = this.G.player;
    if (reason !== 'forced' && p && p.team === 'A' && (this.scores.A || 0) > 0) {
      this.medals.award(p, 'ueberlebender');
      this.count(p, 'survivals');
    }
    super.end(reason);
  }

  extraRow(a) {
    return { label: 'Infiziert', value: a.stats ? a.stats.infections || 0 : 0 };
  }

  award(actor, reason, points) {
    if (reason === 'infect' && actor && actor.stats) actor.stats.infections = (actor.stats.infections || 0) + 1;
    return super.award(actor, reason, points);
  }
}
