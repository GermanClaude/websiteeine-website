// NULLPUNKT — Stub für modes/index.js (§9): einfacher Team-Deathmatch / Jeder-gegen-jeden mit
// Punkte-/Zeitlimit, sicherer Spawnwahl, Punktetabelle, Medaillen und Ergebnis nach §9.
// dom/gun/training laufen hier vereinfacht als TDM/FFA-Varianten.

import * as THREE from 'three';

const KILL_POINTS = 100;
const _v = new THREE.Vector3();
const _e = new THREE.Vector3();

export function createMode(G, modeId, opts = {}) {
  return new StubMode(G, modeId, opts);
}

class StubMode {
  constructor(G, modeId, opts) {
    const MODES = (G.data && G.data.MODES) || {};
    this.G = G;
    this.id = modeId;
    this.def = MODES[modeId] || { id: modeId, name: modeId, teams: modeId !== 'ffa' && modeId !== 'gun' };
    this.teams = modeId === 'ffa' || modeId === 'gun' ? false : this.def.teams !== false;
    const defScore = modeId === 'training' ? 0 : Number(this.def.scoreLimit) || (this.teams ? 40 : 25);
    const defTime = modeId === 'training' ? 0 : Number(this.def.timeLimit) || 600;
    this.scoreLimit = Number.isFinite(opts.scoreLimit) ? opts.scoreLimit : Number.isFinite(opts.score) ? opts.score : defScore;
    this.timeLimit = Number.isFinite(opts.timeLimit) ? opts.timeLimit : Number.isFinite(opts.time) ? opts.time : defTime;
    this.respawnDelay = Number(this.def.respawnDelay) || (this.teams ? 3 : 2.5);
    this.timeLeft = this.timeLimit || Infinity;
    this.scores = this.teams ? { A: 0, B: 0 } : {};
    this.isOver = false;
    this.result = null;
    this.started = false;
    this.startTime = 0;
    this.medals = {};
    this._subs = null;
    this._lastKillTime = new Map();
    this._multi = new Map();
  }

  attach(G) {
    this.G = G;
    this.detach();
    const s = (this._subs = G.events.scope());
    s.on('kill', (e) => this._onKill(e));
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
  }

  start() {
    this.started = true;
    this.startTime = this.G.time.elapsed;
    this.timeLeft = this.timeLimit || Infinity;
    if (!this.teams) for (const a of this.G.actors) this.scores[a.id] = 0;
  }

  /** Erzwingt das Matchende (debugApi.endMatch). */
  forceEnd() {
    if (!this.isOver) this._end('forced');
  }

  update(dt) {
    if (this.isOver || !this.started || this.G.match.state !== 'playing') return;
    if (Number.isFinite(this.timeLeft) && this.timeLimit > 0) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this._end('time');
    }
  }

  _award(actor, points, reason) {
    if (!actor || !actor.stats) return;
    actor.stats.score += points;
    this.G.events.emit('score', { actor, points, reason });
  }

  _medal(actor, id, label) {
    if (!actor) return;
    if (actor.isPlayer) this.medals[id] = (this.medals[id] || 0) + 1;
    this.G.events.emit('medal', { actor, id, label });
  }

  _onKill({ victim, killer, headshot, firstBlood, longshot, revenge, assisters, suicide }) {
    if (this.isOver) return;
    const G = this.G;
    const now = G.time.elapsed;
    if (killer && !suicide && killer !== victim) {
      this._award(killer, KILL_POINTS, 'kill');
      if (headshot) { this._award(killer, 50, 'headshot'); this._medal(killer, 'headshot', 'Kopfschuss'); }
      if (firstBlood) { this._award(killer, 100, 'firstblood'); this._medal(killer, 'firstblood', 'Erstes Blut'); }
      if (longshot) { this._award(killer, 50, 'longshot'); this._medal(killer, 'longshot', 'Weitschuss'); }
      if (revenge) { this._award(killer, 50, 'revenge'); this._medal(killer, 'revenge', 'Rache'); }
      // Mehrfachabschüsse (≤ 4 s Abstand)
      const last = this._lastKillTime.get(killer) || -1e9;
      const n = now - last <= 4 ? (this._multi.get(killer) || 1) + 1 : 1;
      this._multi.set(killer, n);
      this._lastKillTime.set(killer, now);
      if (n === 2) this._medal(killer, 'double', 'Doppelabschuss');
      else if (n === 3) this._medal(killer, 'triple', 'Dreifachabschuss');
      else if (n >= 4) this._medal(killer, 'fury', 'Furie');
      const st = killer.stats.streak;
      if (st === 5) this._medal(killer, 'streak5', 'Serie: 5');
      if (st === 10) this._medal(killer, 'streak10', 'Serie: 10');
      if (this.teams) {
        if (killer.team && killer.team !== victim.team) this.scores[killer.team] = (this.scores[killer.team] || 0) + 1;
      } else {
        this.scores[killer.id] = (this.scores[killer.id] || 0) + 1;
      }
    } else if (victim && this.teams && victim.team) {
      // Selbstabschuss: Punkt für das andere Team
      const other = victim.team === 'A' ? 'B' : 'A';
      this.scores[other] = (this.scores[other] || 0) + 1;
    }
    for (const a of assisters || []) this._award(a, 25, 'assist');
    if (this.scoreLimit > 0) {
      const top = Math.max(0, ...Object.values(this.scores));
      if (top >= this.scoreLimit) this._end('score');
    }
  }

  /** Sicherer Spawn: weit weg von (sichtbaren) Gegnern, etwas Zufall. */
  chooseSpawn(actor) {
    const G = this.G;
    const w = G.world;
    const sp = w && w.spawns ? w.spawns : null;
    let list = null;
    if (sp) list = this.teams && actor.team ? sp[actor.team] : sp.ffa;
    if (!list || !list.length) list = (sp && (sp.ffa || sp.A)) || [{ position: new THREE.Vector3(0, 0, 0), yaw: 0 }];
    const hostiles = G.actors.filter((a) => a.alive && a !== actor && G.combat.isHostile(actor, a));
    let best = list[0];
    let bestScore = -Infinity;
    for (const s of list) {
      let score = Math.random() * 6;
      let minD = Infinity;
      for (const h of hostiles) {
        const d = h.position.distanceTo(s.position);
        minD = Math.min(minD, d);
        if (d < 30 && w && w.lineOfSight) {
          _v.copy(s.position); _v.y += 1.6;
          h.getEyePosition ? h.getEyePosition(_e) : _e.copy(h.position).setY(h.position.y + 1.6);
          if (w.lineOfSight(_e, _v)) score -= 40;
        }
      }
      score += Math.min(minD, 40);
      // nicht direkt auf Mitspieler
      for (const a of G.actors) if (a !== actor && a.alive && a.position.distanceTo(s.position) < 1.2) score -= 50;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return { position: best.position.clone(), yaw: best.yaw || 0 };
  }

  scoreboard() {
    const rows = this.G.actors.map((a) => ({
      actor: a, name: a.name, team: a.team, score: a.stats.score, kills: a.stats.kills, deaths: a.stats.deaths,
      assists: a.stats.assists, ping: a.isBot ? 18 + ((a.id.length * 7) % 40) : 0, isPlayer: !!a.isPlayer,
    }));
    rows.sort((x, y) => y.score - x.score || y.kills - x.kills || x.deaths - y.deaths);
    return rows;
  }

  _end(reason) {
    if (this.isOver) return;
    const G = this.G;
    this.isOver = true;
    const player = G.player;
    const board = this.scoreboard();
    let winner = 'draw';
    if (this.teams) {
      if (this.scores.A > this.scores.B) winner = 'A';
      else if (this.scores.B > this.scores.A) winner = 'B';
    } else if (board.length) {
      const top = board[0];
      const second = board[1];
      winner = second && second.score === top.score && second.kills === top.kills ? 'draw' : top.actor.id;
    }
    const playerWon = this.teams ? winner === (player ? player.team : 'A') : winner === (player ? player.id : null);
    const draw = winner === 'draw';
    const duration = G.time.elapsed - this.startTime;
    const ps = player ? player.stats : null;
    const mvp = board.length ? board[0].actor.id : null;
    const playerSummary = player ? {
      modeId: this.id, mapId: G.match.mapId, result: draw ? 'draw' : playerWon ? 'win' : 'loss',
      kills: ps.kills, deaths: ps.deaths, assists: ps.assists, headshots: ps.headshots, score: ps.score,
      shotsFired: ps.shotsFired, shotsHit: ps.shotsHit, bestStreak: ps.bestStreak, longestKill: ps.longestKill || 0,
      damage: Math.round(ps.damage), captures: ps.captures, medals: { ...this.medals },
      weaponStats: JSON.parse(JSON.stringify(player.weaponStats || {})), duration,
    } : null;
    if (playerSummary && mvp === player.id) playerSummary.medals.mvp = (playerSummary.medals.mvp || 0) + 1;
    this.result = {
      modeId: this.id, mapId: G.match.mapId, winner, playerWon: !draw && playerWon, draw, duration, reason,
      teamScores: this.teams ? { ...this.scores } : null,
      scoreboard: board.map((r) => ({ id: r.actor.id, name: r.name, team: r.team, score: r.score, kills: r.kills, deaths: r.deaths, assists: r.assists, isPlayer: r.isPlayer })),
      mvp, playerSummary,
    };
    G.events.emit('match:end', { result: this.result });
  }
}
