// NULLPUNKT — Gemeinsame Modus-Logik (§9): Zeit-/Punktelimit, Verlängerung, Punkte nach SCORE_RULES,
// Medaillen, Serienprämien, sichere Spawns, Respawn-Ausgleich ungleicher Teams, Punktetabelle, Ergebnis.
// Unterklassen überschreiben die Haken onKillScored / onSuicide / tick / decide / extraRow.

import * as THREE from 'three';
import { MODES, SCORE_RULES, MEDAL_RULES, isLongshot } from '../../shared/modes.data.js';
import { WEAPONS } from '../../shared/weapons.data.js';
import { chooseSpawn } from './spawns.js';
import { MedalTracker } from './medals.js';
import { StreakManager } from './streaks.js';

const STREAK_WEAPONS = new Set(['strike', 'sentry', 'uav']);
export const OVERTIME_SECONDS = 60;

const num = (...vals) => {
  for (const v of vals) {
    const n = typeof v === 'string' && v !== '' ? Number(v) : v;
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
};

export class BaseMode {
  constructor(G, modeId, opts = {}) {
    this.G = G;
    this.id = modeId;
    this.opts = opts;
    this.def = MODES[modeId] || { id: modeId, name: modeId, teams: true };
    this.teams = this.def.teams !== false;
    this.rules = SCORE_RULES;
    this.scoreLimit = num(opts.scoreLimit, opts.score, this.def.scoreLimit);
    this.timeLimit = num(opts.timeLimit, opts.time, this.def.timeLimit);
    this.respawnDelay = Number.isFinite(this.def.respawnDelay) ? this.def.respawnDelay : 3;
    this.timeLeft = this.timeLimit > 0 ? this.timeLimit : Infinity;
    this.elapsed = 0;
    this.scores = this.teams ? { A: 0, B: 0 } : {};
    this.objectives = [];
    this.isOver = false;
    this.result = null;
    this.started = false;
    this.overtime = false;
    this.endReason = null;
    this.medals = new MedalTracker(this);
    this.streaks = this.def.streaks ? new StreakManager(G, this) : null;
    this._subs = null;
    this._warmup = null;
    this._life = new Map(); // actor → { kills, all, deathsInRow }
    this._recentSpawns = new Map();
    this._lastKill = null;
    this._teamSize = { A: 0, B: 0 };
  }

  /* ------------------------------------------------------------ Lebenszyklus */

  attach(G) {
    this.G = G;
    this.detach();
    const s = (this._subs = G.events.scope());
    s.on('kill', (e) => { if (!this.isOver) this._onKill(e); });
    s.on('actor:hit', (e) => this.medals.onHit(e));
    s.on('impact', (e) => this.medals.onImpact(e));
    s.on('weapon:fire', (e) => this.medals.onFire(e));
    s.on('actor:spawn', ({ actor }) => this.onSpawn(actor));
    s.on('match:start', () => this.onMatchStart());
    if (this.streaks) this.streaks.attach(s);
    this._addWarmup(G);
    this.onAttach(s);
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    this._removeWarmup();
    if (this.streaks) this.streaks.dispose();
    this.onDetach();
  }

  /**
   * Aufwärmgruppe: je ein Objekt mit den Materialien, die erst mitten im Match auftauchen (Wachgeschütz,
   * Präzisionsschlag, Haft-LED der Semtex). attach() läuft vor main.warmUp(): dessen Kompilierdurchgang und das
   * Aufwärmbild linken genau die späteren Programme (Licht, Nebel, Umgebung, Renderziel des Matches). Die Objekte
   * werden nicht weggeschnitten, liegen aber weit unter der Karte (kein Pixel); beim ersten update() (Countdown)
   * verschwindet die Gruppe wieder.
   */
  _addWarmup(G) {
    this._removeWarmup();
    if (!G.scene) return;
    const objs = [];
    if (this.streaks) objs.push(...this.streaks.warmObjects());
    const gs = G.weapons && G.weapons.grenadeSystem;
    if (this.def.lethals !== false && gs && typeof gs.warmObjects === 'function') objs.push(...gs.warmObjects());
    if (!objs.length) return;
    const g = new THREE.Group();
    g.name = 'aufwaermen:modus';
    for (const o of objs) {
      o.position.set(0, -500, 0);
      o.scale.setScalar(0.001);
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      g.add(o);
    }
    G.scene.add(g);
    this._warmup = g;
  }

  _removeWarmup() {
    if (!this._warmup) return;
    this._warmup.removeFromParent();
    this._warmup = null;
  }

  /** Vor dem Countdown (Spieler + Bots sind gespawnt). */
  start() {
    const G = this.G;
    this.started = true;
    this.elapsed = 0;
    this.timeLeft = this.timeLimit > 0 ? this.timeLimit : Infinity;
    this._teamSize = { A: 0, B: 0 };
    for (const a of G.actors) {
      if (!this.teams) this.scores[a.id] = this.scores[a.id] || 0;
      else if (a.team === 'A' || a.team === 'B') this._teamSize[a.team] += 1;
      this._lifeOf(a);
    }
    this.onStart();
  }

  update(dt) {
    if (this._warmup) this._removeWarmup();
    if (this.isOver || !this.started) return;
    const G = this.G;
    const playing = G.match.state === 'playing';
    if (playing) {
      this.elapsed += dt;
      if (Number.isFinite(this.timeLeft)) {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (this.timeLeft <= 0) {
          if (this.overtime) this._finishOvertime();
          else this._onTimeUp();
        }
      }
    }
    if (this.isOver) return;
    this.tick(dt, playing);
    if (this.streaks) this.streaks.update(dt, playing);
  }

  /** debugApi.endMatch */
  forceEnd() {
    if (!this.isOver) this.end('forced');
  }

  canRespawn() {
    return !this.isOver;
  }

  /* ------------------------------------------------------------ Haken */

  onAttach() {}
  onDetach() {}
  onStart() {}
  onMatchStart() {}
  onSpawn() {}
  tick() {}
  /** Abschuss mit Punktwirkung (credit = Schütze oder Besitzer der Serienprämie). */
  onKillScored() {}
  /** Selbst-/Umgebungstod. */
  onSuicide() {}
  /** Zusatzspalte in der Tabelle (z. B. Flaggen, Stufe). */
  extraRow() { return null; }

  /* ------------------------------------------------------------ Punkte */

  _lifeOf(a) {
    let l = this._life.get(a);
    if (!l) { l = { kills: 0, all: 0, deathsInRow: 0 }; this._life.set(a, l); }
    return l;
  }

  /** Punkte gutschreiben + 'score'-Ereignis. */
  award(actor, reason, points) {
    if (!actor || !actor.stats) return 0;
    const p = Number.isFinite(points) ? points : this.rules[reason] || 0;
    if (!p) return 0;
    actor.stats.score = (actor.stats.score || 0) + p;
    this.G.events.emit('score', { actor, points: p, reason });
    return p;
  }

  addTeamScore(team, n) {
    if (!this.teams || (team !== 'A' && team !== 'B') || !n) return;
    this.scores[team] = Math.max(0, (this.scores[team] || 0) + n);
    this._afterScore();
  }

  _afterScore() {
    if (this.isOver) return;
    if (this.overtime) {
      const lead = this.leader();
      if (lead && !lead.tied) this.end('overtime');
      return;
    }
    if (this.scoreLimit > 0) {
      const top = this.topScore();
      if (top >= this.scoreLimit) this.end('score');
    }
  }

  topScore() {
    let top = 0;
    for (const v of Object.values(this.scores)) if (v > top) top = v;
    return top;
  }

  /** { key, value, tied } – führende Seite (Team oder Akteur-Id). */
  leader() {
    const entries = Object.entries(this.scores);
    if (!entries.length) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return { key: entries[0][0], value: entries[0][1], tied: entries.length > 1 && entries[1][1] === entries[0][1] };
  }

  _onKill(e) {
    const G = this.G;
    const { victim, weaponId } = e;
    if (!victim || victim.isStreakEntity) return;
    let killer = e.killer;
    const streakKill = STREAK_WEAPONS.has(weaponId);
    // Wachgeschütz-Abschüsse dem Besitzer gutschreiben
    if (killer && killer.isStreakEntity) {
      const owner = killer.owner;
      if (owner && owner.stats && owner !== victim) {
        owner.stats.kills += 1;
        owner.stats.streak = (owner.stats.streak || 0) + 1;
        owner.stats.bestStreak = Math.max(owner.stats.bestStreak || 0, owner.stats.streak);
        const ws = owner.weaponStats || (owner.weaponStats = {});
        const w = ws[weaponId] || (ws[weaponId] = { kills: 0, shots: 0, hits: 0, headshots: 0 });
        w.kills += 1;
      }
      killer = owner && owner !== victim ? owner : null;
    }
    const vLife = this._lifeOf(victim);
    const victimStreak = vLife.all;
    vLife.kills = 0;
    vLife.all = 0;
    vLife.deathsInRow += 1;
    if (this.streaks) this.streaks.onDeath(victim);
    this._adjustRespawn(victim);

    const suicide = !killer || killer === victim || e.suicide;
    if (suicide) {
      this.medals.onDeath(victim);
      this.onSuicide(victim, e);
      this._afterScore();
      return;
    }
    const kLife = this._lifeOf(killer);
    const deathsInRow = kLife.deathsInRow;
    kLife.deathsInRow = 0;
    kLife.all += 1;
    if (!streakKill) kLife.kills += 1;

    this.award(killer, 'kill');
    if (e.headshot) this.award(killer, 'headshot');
    if (e.firstBlood) this.award(killer, 'firstblood');
    if (e.revenge) this.award(killer, 'revenge');
    const def = WEAPONS[weaponId];
    const isLong = def ? isLongshot(def.cls, e.distance || 0) : !!e.longshot;
    if (isLong && !e.explosive) this.award(killer, 'longshot');
    for (const a of e.assisters || []) if (a && a !== killer && !a.isStreakEntity) this.award(a, 'assist');

    this.medals.onKill({ credit: killer, victim, e, streakKill, victimStreak, deathsInRow, teams: this.teams });
    this._lastKill = { actor: killer, time: G.time.elapsed };
    if (this.streaks && !streakKill) this.streaks.onKill(killer, kLife.kills);
    this.onKillScored(killer, victim, e);
    this._afterScore();
  }

  /** Respawn-Zeit je Opfer: Modus-Standard, kleineres Team kommt schneller zurück. */
  _adjustRespawn(victim) {
    const G = this.G;
    if (victim.respawnAt == null) return;
    let delay = this.respawnDelay;
    if (this.teams && (victim.team === 'A' || victim.team === 'B')) {
      const mine = this._teamSize[victim.team] || 0;
      const other = this._teamSize[victim.team === 'A' ? 'B' : 'A'] || 0;
      const diff = mine - other;
      if (diff > 0) delay += Math.min(2, diff * 0.6);
      else if (diff < 0) delay = Math.max(1.2, delay + diff * 0.35);
    }
    victim.respawnAt = G.time.elapsed + delay;
    victim.respawnDelay = delay;
  }

  /* ------------------------------------------------------------ Zeit / Ende */

  _onTimeUp() {
    const lead = this.leader();
    if (lead && lead.tied && this.allowOvertime()) {
      this.overtime = true;
      this.timeLeft = OVERTIME_SECONDS;
      this.G.events.emit('mode:overtime', { mode: this, seconds: OVERTIME_SECONDS });
      return;
    }
    this.end('time');
  }

  _finishOvertime() {
    this.end('time');
  }

  allowOvertime() {
    return true;
  }

  /** Gewinner bestimmen → { winner: 'A'|'B'|actorId|'draw' }. */
  decide(board) {
    if (this.teams) {
      const a = this.scores.A || 0;
      const b = this.scores.B || 0;
      return { winner: a > b ? 'A' : b > a ? 'B' : 'draw' };
    }
    if (!board.length) return { winner: 'draw' };
    const [top, second] = board;
    if (second && this.rankKey(second) === this.rankKey(top)) return { winner: 'draw' };
    return { winner: top.actor.id };
  }

  /** Vergleichswert für die FFA-Rangfolge. */
  rankKey(row) {
    return `${row.score}`;
  }

  end(reason = 'score') {
    if (this.isOver) return;
    const G = this.G;
    this.endReason = reason;
    this.isOver = true;
    // Siegtreffer: der Abschuss, der das Limit erreicht hat
    if ((reason === 'score' || reason === 'overtime') && this._lastKill && G.time.elapsed - this._lastKill.time < 0.05) {
      this.medals.award(this._lastKill.actor, 'siegtreffer');
    }
    const p = G.player;
    if (p && p.stats.deaths === 0 && p.stats.kills >= MEDAL_RULES.flawlessMinKills && reason !== 'forced') {
      this.medals.award(p, 'unaufhaltsam');
    }
    if (this.streaks) this.streaks.endAll();
    this.result = this.buildResult(reason);
  }

  /* ------------------------------------------------------------ Tabelle */

  /** Sortierte Zeilen der Punktetabelle. */
  scoreboard() {
    const rows = [];
    for (const a of this.G.actors) {
      if (a.isStreakEntity) continue;
      const s = a.stats || {};
      rows.push({
        actor: a, id: a.id, name: a.name, team: a.team, score: s.score || 0, kills: s.kills || 0, deaths: s.deaths || 0,
        assists: s.assists || 0, captures: s.captures || 0, isPlayer: !!a.isPlayer, isBot: !!a.isBot,
        extra: this.extraRow(a), alive: !!a.alive,
      });
    }
    rows.sort((x, y) => this.compareRows(x, y));
    return rows;
  }

  compareRows(x, y) {
    return y.score - x.score || y.kills - x.kills || x.deaths - y.deaths || (x.isPlayer ? -1 : y.isPlayer ? 1 : 0);
  }

  /** Platzierung eines Akteurs (1-basiert) in der Gesamtwertung (FFA) bzw. im eigenen Team. */
  placementOf(actor, board = this.scoreboard()) {
    const list = this.teams ? board.filter((r) => r.team === actor.team) : board;
    const i = list.findIndex((r) => r.actor === actor);
    return i < 0 ? list.length : i + 1;
  }

  /* ------------------------------------------------------------ Ergebnis */

  buildResult(reason) {
    const G = this.G;
    const board = this.scoreboard();
    const { winner } = this.decide(board);
    const player = G.player;
    let draw = winner === 'draw';
    let playerWon = false;
    const placement = player ? this.placementOf(player, board) : 0;
    if (this.teams) playerWon = !draw && !!player && winner === player.team;
    else if (player) {
      // Jeder für sich: Unentschieden nur für die punktgleichen Führenden, sonst zählt die eigene Platzierung
      const mine = board.find((r) => r.actor === player);
      draw = draw && !!mine && board.length > 0 && this.rankKey(mine) === this.rankKey(board[0]);
      playerWon = !draw && placement <= (this.def.winPlaces || 1);
    }
    // MVP: höchste Punktzahl (bei Gleichstand mehr Abschüsse)
    const byScore = [...board].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    const mvp = byScore.length && byScore[0].score > 0 ? byScore[0].actor : null;
    const teamMvp = {};
    if (this.teams) for (const t of ['A', 'B']) { const r = byScore.find((x) => x.team === t); if (r && r.score > 0) teamMvp[t] = r.id; }
    if (mvp && mvp === player) this.medals.award(player, 'mvp');

    const ps = player ? player.stats : null;
    const medals = player ? this.medals.medalsOf(player) : {};
    const resultKey = draw ? 'draw' : playerWon ? 'win' : 'loss';
    const weaponStats = {};
    if (player) for (const [id, w] of Object.entries(player.weaponStats || {})) if (WEAPONS[id]) weaponStats[id] = { kills: w.kills | 0, shots: w.shots | 0, hits: w.hits | 0, headshots: w.headshots | 0 };
    const duration = Math.round(this.elapsed * 10) / 10;
    const playerSummary = player ? {
      modeId: this.id, mapId: G.match.mapId, result: resultKey,
      kills: ps.kills | 0, deaths: ps.deaths | 0, assists: ps.assists | 0, headshots: ps.headshots | 0, score: ps.score | 0,
      shotsFired: ps.shotsFired | 0, shotsHit: Math.min(ps.shotsHit | 0, ps.shotsFired | 0), bestStreak: ps.bestStreak | 0,
      longestKill: Math.round((ps.longestKill || 0) * 10) / 10, damage: Math.round(ps.damage || 0), captures: ps.captures | 0,
      medals, weaponStats, duration, placement, players: board.length,
    } : null;
    const winnerRow = winner !== 'draw' && !this.teams ? board.find((r) => r.id === winner) : null;
    return {
      modeId: this.id, mapId: G.match.mapId, modeName: this.def.name, mapName: G.world ? G.world.name : G.match.mapId,
      teams: this.teams, winner, winnerName: winnerRow ? winnerRow.name : null, playerWon: !!playerWon, draw, reason,
      overtime: this.overtime, duration, placement, players: board.length,
      teamScores: this.teams ? { A: this.scores.A || 0, B: this.scores.B || 0 } : null,
      scoreLimit: this.scoreLimit, timeLimit: this.timeLimit, scoreUnit: this.def.scoreUnit || 'Punkte',
      scoreboard: board.map((r) => ({
        id: r.id, name: r.name, team: r.team, score: r.score, kills: r.kills, deaths: r.deaths, assists: r.assists,
        captures: r.captures, extra: r.extra, isPlayer: r.isPlayer, isBot: r.isBot, mvp: mvp ? r.actor === mvp : false,
        teamMvp: this.teams ? teamMvp[r.team] === r.id : false,
      })),
      mvp: mvp ? mvp.id : null, mvpName: mvp ? mvp.name : null, teamMvp,
      playerSummary,
      extra: this.resultExtra(),
    };
  }

  resultExtra() { return null; }

  /* ------------------------------------------------------------ Spawns */

  chooseSpawn(actor) {
    const threats = this.streaks ? this.streaks.entities : [];
    const zones = this.streaks ? this.streaks.dangerZones() : [];
    return chooseSpawn(this.G, actor, { teams: this.teams, recent: this._recentSpawns, threats, zones, attract: this.spawnAttract(actor) });
  }

  spawnAttract() { return null; }
}

