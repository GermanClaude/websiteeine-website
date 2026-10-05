// NULLPUNKT — Herrschaft: drei Flaggen (world.objectives.dom). Kontrollwert je Flagge −1 (B) … 0 (neutral) … +1 (A);
// Anwesende eines Teams schieben ihn (mehr Spieler = schneller, max. maxCapturers), beide Teams = umkämpft (Stillstand).
// Gegnerische Flagge: erst neutralisieren, dann einnehmen (gleiche Dauer). Jede gehaltene Flagge bringt
// pointsPerTick alle tickInterval Sekunden. Bots: G.mode.objectives / objectiveFor(bot).

import * as THREE from 'three';
import { MEDAL_RULES } from '../../shared/modes.data.js';
import { BaseMode } from './base.js';

const VERT = 2.6; // m Höhentoleranz im Flaggenkreis
const DRIFT = 0.22; // Rückfall pro Sekunde ohne Anwesende

export class DomMode extends BaseMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.teams = true;
    this.scores = { A: 0, B: 0 };
    const o = this.def.objective || {};
    this.cfg = {
      captureTime: o.captureTime || 5, captureRateBonus: o.captureRateBonus ?? 0.5, maxCapturers: o.maxCapturers || 3,
      tickInterval: o.tickInterval || 4, pointsPerTick: o.pointsPerTick || 1,
    };
    this._tickT = 0;
    this._assign = new Map();
    this._emitAt = 0;
    this._dominating = null;
  }

  onStart() {
    const w = this.G.world;
    let list = w && w.objectives && Array.isArray(w.objectives.dom) ? w.objectives.dom : [];
    if (!list.length && w && w.spawns) list = fallbackFlags(w);
    this.objectives = list.slice(0, 3).map((f, i) => ({
      id: f.id || 'ABC'[i], position: f.position.clone ? f.position.clone() : new THREE.Vector3(f.position.x, f.position.y, f.position.z),
      radius: f.radius || 5, owner: null, capturingTeam: null, progress: 0, control: 0, contested: false,
      counts: { A: 0, B: 0 }, present: [], lastOwner: null,
    }));
    this._tickT = 0;
    this._emit(true);
  }

  tick(dt, playing) {
    if (!playing) return;
    const C = this.cfg;
    let changed = false;
    for (const f of this.objectives) {
      f.counts.A = 0;
      f.counts.B = 0;
      f.present.length = 0;
      for (const a of this.G.actors) {
        if (!a.alive || (a.team !== 'A' && a.team !== 'B') || !this._inZone(a, f)) continue;
        f.counts[a.team] += 1;
        f.present.push(a);
      }
      const { A, B } = f.counts;
      const contested = A > 0 && B > 0;
      if (contested !== f.contested) { f.contested = contested; changed = true; }
      let team = null;
      if (!contested && (A || B)) team = A ? 'A' : 'B';
      const prevCap = f.capturingTeam;
      if (team) {
        const n = Math.min(C.maxCapturers, f.counts[team]);
        const rate = (1 + C.captureRateBonus * (n - 1)) / C.captureTime;
        const sign = team === 'A' ? 1 : -1;
        const goal = sign; // volle Kontrolle
        if (f.owner === team && Math.abs(f.control - goal) < 1e-3) {
          f.capturingTeam = null;
        } else {
          f.capturingTeam = team;
          const before = f.control;
          f.control = clamp(f.control + sign * rate * dt, -1, 1);
          // Neutralisieren: Vorzeichenwechsel/0 erreicht bei gegnerischer Flagge
          if (f.owner && f.owner !== team && Math.sign(before) === -sign && (f.control * sign >= 0)) {
            f.control = 0;
            this._neutralize(f, team);
            changed = true;
          }
          if (Math.abs(f.control - goal) < 1e-3 && f.owner !== team) {
            f.control = goal;
            this._capture(f, team);
            changed = true;
          }
        }
      } else if (!contested) {
        // Niemand da: zurück zum Zustand des Besitzers
        f.capturingTeam = null;
        const rest = f.owner === 'A' ? 1 : f.owner === 'B' ? -1 : 0;
        const d = rest - f.control;
        f.control += Math.sign(d) * Math.min(Math.abs(d), DRIFT * dt);
      }
      if (prevCap !== f.capturingTeam) changed = true;
      const cap = f.capturingTeam;
      f.progress = cap === 'A' ? Math.max(0, f.control) : cap === 'B' ? Math.max(0, -f.control) : f.owner ? 1 : 0;
    }
    // Punkte
    this._tickT += dt;
    if (this._tickT >= C.tickInterval) {
      this._tickT -= C.tickInterval;
      let a = 0;
      let b = 0;
      for (const f of this.objectives) { if (f.owner === 'A') a++; else if (f.owner === 'B') b++; }
      if (a) this.scores.A += a * C.pointsPerTick;
      if (b) this.scores.B += b * C.pointsPerTick;
      if (a || b) {
        this.G.events.emit('mode:tick', { scores: { ...this.scores }, held: { A: a, B: b } });
        this._afterScore();
      }
    }
    const now = this.G.time.elapsed;
    if (changed || now - this._emitAt > 1) this._emit(changed);
  }

  /** Steht `a` im Flaggenkreis? (Eroberung: Höhenband je Flagge) */
  _inZone(a, f) {
    const dx = a.position.x - f.position.x;
    const dz = a.position.z - f.position.z;
    if (dx * dx + dz * dz > f.radius * f.radius) return false;
    const dy = a.position.y - f.position.y;
    return f.band ? dy >= f.band[0] && dy <= f.band[1] : Math.abs(dy) <= VERT;
  }

  /** Punkte je Grund (Modus-Daten objective.points, sonst SCORE_RULES). */
  pointsFor(reason) {
    const p = this.def.objective && this.def.objective.points;
    return p && Number.isFinite(p[reason]) ? p[reason] : undefined;
  }

  /** Bis zum nächsten Punkt-Takt (s) – fürs HUD. */
  get tickIn() {
    return Math.max(0, this.cfg.tickInterval - this._tickT);
  }

  _emit(force) {
    this._emitAt = this.G.time.elapsed;
    if (!force) return;
    this.G.events.emit('objective:update', { objectives: this.objectives.map((f) => this._public(f)) });
  }

  _public(f) {
    return { id: f.id, position: f.position, radius: f.radius, owner: f.owner, capturingTeam: f.capturingTeam, progress: f.progress, control: f.control, contested: f.contested, counts: { ...f.counts } };
  }

  _neutralize(f, team) {
    const prev = f.owner;
    f.lastOwner = prev;
    f.owner = null;
    this._dominating = null;
    for (const a of f.present) if (a.team === team) this.award(a, 'neutralize', this.pointsFor('neutralize'));
    this.G.events.emit('objective:neutral', { objective: this._public(f), by: team, prev });
  }

  _capture(f, team) {
    const prev = f.owner;
    f.owner = team;
    f.capturingTeam = null;
    for (const a of f.present) {
      if (a.team !== team) continue;
      this.award(a, 'capture', this.pointsFor('capture'));
      a.stats.captures = (a.stats.captures || 0) + 1;
      this.onCaptured(a, f);
      this.medals.award(a, 'eroberer');
    }
    this.G.events.emit('objective:captured', { objective: this._public(f), team, prev });
    const all = this.objectives.length >= 3 && this.objectives.every((x) => x.owner === team);
    if (all && this._dominating !== team) {
      this._dominating = team;
      for (const a of this.G.actors) if (a.team === team && a.alive && !a.isStreakEntity) this.medals.award(a, 'vorherrschaft');
    } else if (!all) this._dominating = null;
  }

  onKillScored(killer, victim) {
    // Verteidigung: Gegner an/auf eigener Flagge ausgeschaltet
    const R = MEDAL_RULES.defendRadius;
    for (const f of this.objectives) {
      if (f.owner !== killer.team) continue;
      const near = (a) => a && a.position && a.position.distanceTo(f.position) <= Math.max(R, f.radius + 2);
      if (near(victim) || near(killer)) {
        this.award(killer, 'defend', this.pointsFor('defend'));
        this.medals.award(killer, 'verteidiger');
        break;
      }
    }
  }

  /** Bots: Ziel-Empfehlung (verteilt die Teams auf die Flaggen). */
  objectiveFor(bot) {
    if (!bot || !this.objectives.length || (bot.team !== 'A' && bot.team !== 'B')) return null;
    const now = this.G.time.elapsed;
    const cur = this._assign.get(bot);
    if (cur && now < cur.until) {
      const f = this.objectives.find((x) => x.id === cur.id);
      if (f && !(f.owner === bot.team && !f.contested && f.capturingTeam !== otherTeam(bot.team) && cur.kind === 'capture')) {
        return { id: f.id, position: cur.point, radius: f.radius, kind: f.owner === bot.team ? 'defend' : 'capture' };
      }
    }
    const load = {};
    for (const [b, a] of this._assign) if (b !== bot && b.alive && now < a.until && b.team === bot.team) load[a.id] = (load[a.id] || 0) + 1;
    let best = null;
    let bestScore = -Infinity;
    for (const f of this.objectives) {
      const mine = f.owner === bot.team;
      const threatened = mine && (f.contested || f.capturingTeam === otherTeam(bot.team));
      let score = mine ? (threatened ? 2.2 : -1.2) : f.owner ? 1.6 : 1.3;
      score -= bot.position.distanceTo(f.position) / 45;
      score -= (load[f.id] || 0) * (mine ? 0.9 : 0.45);
      score += Math.random() * 0.5;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    if (!best) return null;
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * best.radius * 0.6;
    const point = best.position.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
    const kind = best.owner === bot.team ? 'defend' : 'capture';
    this._assign.set(bot, { id: best.id, point, kind, until: now + 7 + Math.random() * 6 });
    return { id: best.id, position: point, radius: best.radius, kind };
  }

  /** Spawns bevorzugt bei eigenen Flaggen. */
  spawnAttract(actor) {
    const out = [];
    for (const f of this.objectives) {
      if (f.owner === actor.team && !f.contested) out.push({ position: f.position, weight: 22 });
      else if (f.owner && f.owner !== actor.team) out.push({ position: f.position, weight: -26 });
    }
    return out;
  }

  onCaptured() {}

  extraRow(a) {
    return { label: 'Eroberungen', value: a.stats ? a.stats.captures || 0 : 0 };
  }

  resultExtra() {
    return { flags: this.objectives.map((f) => ({ id: f.id, owner: f.owner })) };
  }

  onDetach() {
    this._assign.clear();
  }
}

function otherTeam(t) {
  return t === 'A' ? 'B' : 'A';
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** Ohne Kartendaten: Flaggen zwischen den Teamspawns verteilen. */
function fallbackFlags(w) {
  const avg = (list) => {
    const v = new THREE.Vector3();
    for (const s of list) v.add(s.position);
    return list.length ? v.multiplyScalar(1 / list.length) : v;
  };
  const a = avg(w.spawns.A || []);
  const b = avg(w.spawns.B || []);
  const mid = a.clone().lerp(b, 0.5);
  return [
    { id: 'A', position: a.clone().lerp(b, 0.2), radius: 5 },
    { id: 'B', position: mid, radius: 6 },
    { id: 'C', position: a.clone().lerp(b, 0.8), radius: 5 },
  ];
}
