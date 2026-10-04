// NULLPUNKT — Waffenspiel: 18 Stufen (GUN_GAME_STEPS), jeder Abschuss = nächste Waffe, letzte Stufe Messer.
// Messerabschuss stuft das Opfer zurück (Medaille „Demütigung“), Selbsttötung ebenfalls. Gewinner: wer mit der
// letzten Stufe trifft; bei Zeitende höchste Stufe (dann Abschüsse), Gleichstand → Verlängerung.

import { BaseMode } from './base.js';

const FALLBACK_STEPS = [
  'smg_vp9', 'smg_qx90', 'ar_m17', 'ar_kv47', 'lmg_hm60', 'mr_sk14', 'sg_bulldog', 'sr_brecher', 'pi_adler', 'pi_p9',
  'smg_vp9', 'ar_m17', 'ar_kv47', 'sg_bulldog', 'mr_sk14', 'sr_brecher', 'pi_adler', 'knife',
];

export class GunMode extends BaseMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.teams = false;
    this.scores = {};
    const W = (G.data && G.data.WEAPONS) || {};
    const steps = (G.data && G.data.GUN_GAME_STEPS) || FALLBACK_STEPS;
    this.steps = steps.filter((id) => W[id] || id === 'knife');
    if (!this.steps.length) this.steps = FALLBACK_STEPS.slice();
    this.scoreLimit = this.steps.length;
    this.level = new Map();
    this._pending = new Set();
  }

  onStart() {
    for (const a of this.G.actors) this._setLevel(a, 0);
    this._flush();
  }

  /** Waffenwechsel erst im nächsten Modus-Takt (nicht mitten im Schuss des Controllers). */
  tick() {
    if (this._pending.size) this._flush();
  }

  _flush() {
    for (const a of this._pending) this._applyLoadout(a);
    this._pending.clear();
  }

  onSpawn(actor) {
    if (!actor || actor.isStreakEntity) return;
    if (!this.level.has(actor)) this._setLevel(actor, 0);
    this._applyLoadout(actor);
    this._pending.delete(actor);
  }

  levelOf(actor) {
    return this.level.get(actor) || 0;
  }

  weaponFor(level) {
    return this.steps[Math.max(0, Math.min(this.steps.length - 1, level))];
  }

  _setLevel(actor, lvl) {
    const l = Math.max(0, Math.min(this.steps.length, lvl));
    this.level.set(actor, l);
    this.scores[actor.id] = l;
    if (l < this.steps.length) this._pending.add(actor);
  }

  _applyLoadout(actor) {
    const id = this.weaponFor(this.levelOf(actor));
    const w = actor.weapon;
    const lo = { primary: id, secondary: null, lethal: null };
    actor.loadout = lo;
    if (!w || typeof w.setLoadout !== 'function') return;
    const cur = w.currentDef ? w.currentDef.id : null;
    if (cur === id && (!w.slots || w.slots.length === 1)) return;
    try { w.setLoadout(lo); } catch (err) { console.error('[NULLPUNKT] Waffenspiel setLoadout:', err); }
  }

  onKillScored(killer, victim, e) {
    const melee = e.weaponId === 'knife' || (this.G.data.WEAPONS && this.G.data.WEAPONS[e.weaponId] && this.G.data.WEAPONS[e.weaponId].cls === 'melee');
    if (melee && this.def.demoteOnMelee !== false && this.levelOf(victim) > 0) {
      this._setLevel(victim, this.levelOf(victim) - 1);
      this.medals.award(killer, 'demuetigung');
      this.G.events.emit('gun:demote', { actor: victim, by: killer, level: this.levelOf(victim) });
    }
    // Nur Abschüsse mit der aktuellen Stufenwaffe (oder Messer) zählen – Granaten gibt es hier nicht.
    const next = this.levelOf(killer) + 1;
    this._setLevel(killer, next);
    this.G.events.emit('gun:promote', { actor: killer, level: next, weaponId: next < this.steps.length ? this.weaponFor(next) : null, final: next >= this.steps.length - 1 });
  }

  onSuicide(victim) {
    if (this.levelOf(victim) > 0) {
      this._setLevel(victim, this.levelOf(victim) - 1);
      this.G.events.emit('gun:demote', { actor: victim, by: null, level: this.levelOf(victim) });
    }
  }

  compareRows(x, y) {
    return (y.extra ? y.extra.value : 0) - (x.extra ? x.extra.value : 0) || y.kills - x.kills || x.deaths - y.deaths || (x.isPlayer ? -1 : y.isPlayer ? 1 : 0);
  }

  rankKey(r) {
    return `${r.extra ? r.extra.value : 0}:${r.kills}`;
  }

  extraRow(a) {
    return { label: 'Stufe', value: Math.min(this.steps.length, this.levelOf(a) + 1) };
  }

  /** HUD: { level (1-basiert), total, weaponId, nextId, leader } */
  standing(actor = this.G.player) {
    const lvl = this.levelOf(actor);
    const board = this.scoreboard();
    const lead = board[0];
    return {
      level: Math.min(this.steps.length, lvl + 1), total: this.steps.length, weaponId: this.weaponFor(lvl),
      nextId: lvl + 1 < this.steps.length ? this.weaponFor(lvl + 1) : null, place: board.findIndex((r) => r.actor === actor) + 1,
      leaderName: lead ? lead.name : '', leaderLevel: lead && lead.extra ? lead.extra.value : 0, leaderIsMe: lead ? lead.actor === actor : false,
    };
  }

  resultExtra() {
    return { steps: this.steps.slice() };
  }

  onDetach() {
    this._pending.clear();
  }
}
