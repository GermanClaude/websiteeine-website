// NULLPUNKT — Infiziert (REALISM_PLAN §11.1): Team A = Überlebende (zufällige Waffen), Team B = Infizierte
// (Messer + Haftgranate, schneller zurück). Wer als Überlebender fällt, wechselt beim Wiedereinstieg die Seite.
// Die Infizierten gewinnen, sobald niemand mehr übrig ist; sonst gewinnen die Überlebenden nach Ablauf der Zeit.
// Punkte: Infizieren, Überlebens-Takt (alle surviveTick s), normale Abschüsse.
// Online: der Host verwaltet die Teams (Matchbeginn: genau ein Infizierter, zufällig; netTeamShift → sync-host füllt nur
// die Gesamtzahl auf) und verteilt jeden Wechsel als 'team:change' über die Identitäten (identityOf.t); das Abbild beim
// Client übernimmt das Team (sync-client _syncTeam), meldet 'infect' fürs HUD und setzt die Ausrüstung nur für den eigenen
// Spieler. Die Zufallswaffe eines Menschen hängt an Raumcode + Netz-Id – Host (Anti-Cheat) und Client wählen dieselbe.

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
    this.netTeamShift = true; // net/sync-host.js: Bots nur nach Gesamtzahl auffüllen
    this._known = new Set(); // Host: Akteure, deren Team der Modus festgelegt hat (Spätstarter → _admit)
    this._pool = Object.values(WEAPONS).filter((w) => w.slot === 'primary' && w.cls !== 'melee');
  }

  onAttach(s) {
    super.onAttach(s);
    if (!this.replica) return;
    // Abbild: Teamwechsel vom Host → HUD-Meldung, eigene Ausrüstung
    s.on('team:change', ({ actor, from, to }) => {
      if (!this.started || !actor) return;
      if (from === 'A' && to === 'B') this.G.events.emit('infect', { actor, by: null });
      if (actor.isPlayer && actor.alive) this._ownLoadout(actor);
    });
  }

  onStart() {
    const G = this.G;
    if (this.replica) { if (G.player) this._ownLoadout(G.player); return; }
    if (G.match && G.match.netRole === 'host') this._pickPatientZero();
    for (const a of G.actors) this._known.add(a);
    for (const a of G.actors) {
      if (a.team === 'B') { this._zero.add(a); this._infectLoadout(a); } else if (a.team === 'A') this._randomLoadout(a);
    }
    this._count();
    this.scoreMax = (this.scores.A || 0) + (this.scores.B || 0);
  }

  /** Online (Host): genau ein Infizierter zu Beginn – zufällig unter allen, falls die Lobby etwas anderes ergab. */
  _pickPatientZero() {
    const list = this.G.actors.filter((a) => (a.team === 'A' || a.team === 'B') && !a.isStreakEntity);
    if (list.filter((a) => a.team === 'B').length === 1 || !list.length) return;
    const zero = list[(Math.random() * list.length) | 0];
    for (const a of list) {
      const to = a === zero ? 'B' : 'A';
      if (a.team === to) continue;
      const from = a.team;
      a.team = to;
      this.G.events.emit('team:change', { actor: a, from, to });
    }
  }

  /** Zufallswaffe; für Menschen online fest aus Raumcode + Netz-Id (Host und Client wählen dieselbe). */
  _randomLoadout(a) {
    const pool = this._pool;
    if (!pool.length) return;
    const code = this.G.match && this.G.match.net && this.G.match.net.roomCode;
    let i = (Math.random() * pool.length) | 0;
    if (code && Number.isInteger(a.netId) && (a.isPlayer || a.isRemoteHuman)) {
      let h = 2166136261;
      for (const ch of `${code}#${a.netId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      i = (h >>> 0) % pool.length;
    }
    const w = pool[i];
    if (w) this._setLoadout(a, { primary: w.id, secondary: 'pi_p9', lethal: 'frag' });
  }

  /** Abbild: Ausrüstung des eigenen Spielers nach seinem Team. */
  _ownLoadout(a) {
    if (a.team === 'B') this._infectLoadout(a);
    else if (a.team === 'A') this._randomLoadout(a);
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
    this.G.events.emit('team:change', { actor: victim, from: 'A', to: 'B' });
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
    if (this.replica) { if (actor.isPlayer) this._ownLoadout(actor); return; }
    if (!this._known.has(actor) && !actor.isStreakEntity) this._admit(actor);
    if (actor.team === 'B') this._infectLoadout(actor);
  }

  /**
   * Host: Akteur, der nach dem Matchbeginn dazukommt (Puppe eines langsamer ladenden Clients, Beitritt mitten im Match):
   * ohne Infizierten wird er der erste, in den ersten 15 s Überlebender, danach Infizierter.
   */
  _admit(actor) {
    this._known.add(actor);
    const anyB = this.G.actors.some((a) => a !== actor && a.team === 'B');
    const to = !anyB ? 'B' : this.elapsed < 15 ? 'A' : 'B';
    if (to === 'B' && !anyB) this._zero.add(actor);
    if (actor.team !== to) {
      const from = actor.team;
      actor.team = to;
      this.G.events.emit('team:change', { actor, from, to });
    }
    if (to === 'A') this._randomLoadout(actor);
    this._count();
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
