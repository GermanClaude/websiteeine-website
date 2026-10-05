// NULLPUNKT — Eroberung (GROSSKAMPF_PLAN §5.1/§5.3): Flaggen A–E aus world.objectives.cq (Radius + Höhenband),
// Einnahmelogik von Herrschaft (12 s allein, mehr Leute schneller), Tickets je Seite (Wiedereinstieg −1, Ausbluten bei
// Flaggenmehrheit), HQs mit 10-s-Warnung für Gegner, Kampfgebietsgrenze, Trupps zu viert mit Befehlen und einem
// einfachen Teamhirn für die KI-Trupps, Einsatzkarte (HQ, eigene Flaggen, Truppkamerad, Fahrzeug).
// Spawn-API für ui/deploy.js: deployPoints(actor), setDeploy(choice), squadOrder(objectiveId).

import * as THREE from 'three';
import { ticketsFor } from '../../shared/modes.data.js';
import { DomMode } from './dom.js';
import { SquadSystem } from './squads.js';

const SQUAD_SAFE_R = 25; // m: kein bekannter Gegner so nah am Truppkameraden
const SQUAD_SAFE_T = 5; // s ohne Schaden
const BOUNDS_TIME = 10;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class ConquestMode extends DomMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    const o = this.def.objective || {};
    this.cfg = {
      captureTime: o.captureTime || 12, captureRateBonus: o.captureRateBonus ?? 0.5, maxCapturers: o.maxCapturers || 5,
      tickInterval: Infinity, pointsPerTick: 0,
    };
    this.scoreLimit = 0; // Tickets statt Punktelimit
    this.matchLength = (G.match && G.match.matchLength) || 'standard';
    this.ticketsMax = { A: 0, B: 0 };
    this.scoreMax = 0; // HUD: Balken = Tickets / Start
    this.flagBar = true;
    this.squads = new SquadSystem(G);
    this.hq = { A: null, B: null };
    this.deployChoice = null; // { kind: 'hq'|'flag'|'squad'|'vehicle', id }
    this._bleed = { A: 0, B: 0 };
    this._zoneT = new Map(); // Akteur → { kind: 'hq'|'bounds', t }
    this._lastHit = new Map();
    this._enterAfterSpawn = new Map();
    this._aiAt = 0;
    this._capLife = new Map();
    this._defendAt = new Map();
  }

  /* ------------------------------------------------------------ Lebenszyklus */

  onAttach(s) {
    const G = this.G;
    G.squads = this.squads;
    s.on('actor:hit', (e) => { if (e.target) this._lastHit.set(e.target, G.time.elapsed); });
    s.on('kill', ({ victim }) => { if (victim) this._capLife.delete(victim); });
  }

  onDetach() {
    super.onDetach();
    if (this.G.squads === this.squads) this.G.squads = null;
    this.squads.dispose();
    this._zoneT.clear();
    this._lastHit.clear();
    this._enterAfterSpawn.clear();
  }

  onStart() {
    const G = this.G;
    const w = G.world;
    const list = w && w.objectives && Array.isArray(w.objectives.cq) && w.objectives.cq.length ? w.objectives.cq : null;
    if (!list) { super.onStart(); this.flagBar = true; } else {
      this.objectives = list.map((f, i) => ({
        id: f.id || 'ABCDEFG'[i], name: f.name || '', position: vec(f.position), radius: f.radius || 14,
        band: Array.isArray(f.heightBand) ? [f.heightBand[0], f.heightBand[1]] : [-3, 6],
        spawns: (f.spawns || []).map((p) => ({ position: vec(p.position), yaw: p.yaw || 0 })),
        owner: null, capturingTeam: null, progress: 0, control: 0, contested: false, counts: { A: 0, B: 0 }, present: [], lastOwner: null,
      }));
      this._emit(true);
    }
    // HQs: Mittelpunkt der HQ-Spawns (Großkarte) bzw. der Teamspawns
    for (const t of ['A', 'B']) {
      const src = (w && w.spawns && ((w.spawns.hq && w.spawns.hq[t]) || w.spawns[t])) || [];
      const c = new THREE.Vector3();
      for (const p of src) c.add(p.position);
      if (src.length) c.multiplyScalar(1 / src.length);
      this.hq[t] = { team: t, position: c, radius: (this.def.objective && this.def.objective.hqRadius) || 34, spawns: src };
    }
    // Tickets nach Teamgröße
    const side = Math.max(this._teamSize.A || 1, this._teamSize.B || 1);
    const n = ticketsFor(side, this.matchLength);
    this.scores = { A: n, B: n };
    this.ticketsMax = { A: n, B: n };
    this.scoreMax = n;
    this.squads.build();
    this._aiAt = 0;
    G.events.emit('ticket', { team: 'A', value: n, reason: 'start' });
    G.events.emit('ticket', { team: 'B', value: n, reason: 'start' });
  }

  /* ------------------------------------------------------------ Tickets */

  spendTicket(team, n = 1, reason = 'respawn') {
    if (this.isOver || (team !== 'A' && team !== 'B')) return;
    this.scores[team] = Math.max(0, (this.scores[team] || 0) - n);
    this.G.events.emit('ticket', { team, value: this.scores[team], reason });
    if (this.scores[team] <= 0) this.end('tickets');
  }

  onSpawn(actor) {
    if (!this.started || this.isOver || !actor || (actor.team !== 'A' && actor.team !== 'B')) return;
    this.spendTicket(actor.team, 1, 'respawn');
    this.squads.of(actor);
    const v = this._enterAfterSpawn.get(actor);
    if (v) {
      this._enterAfterSpawn.delete(actor);
      const V = this.G.vehicles;
      if (V && typeof V.enter === 'function' && v.alive) { try { V.enter(actor, v); } catch (err) { console.error('[NULLPUNKT] Einsteigen nach Einsatz:', err); } }
    }
    if (actor.isPlayer) this.G.events.emit('deploy', { actor, spawn: this.deployChoice });
  }

  onCaptured(a, f) {
    // Flaggenstürmer: drei Einnahmen in einem Leben
    const n = (this._capLife.get(a) || 0) + 1;
    this._capLife.set(a, n);
    if (n === 3) this.medals.award(a, 'flaggenstuermer');
    // Truppbefehl „Angriff“ erfüllt
    const sq = a.squad;
    if (sq && sq.order && sq.order.kind === 'attack' && sq.order.objectiveId === f.id && !sq._done) {
      sq._done = true;
      this._orderDone(sq);
    }
  }

  _orderDone(sq) {
    const leader = sq.orderBy || sq.leader;
    if (leader && leader.stats) {
      this.award(leader, 'squad');
      this.medals.award(leader, 'truppfuehrer');
      this.count(leader, 'squad');
    }
    this.G.events.emit('squad:done', { squad: sq, order: sq.order });
    sq.order = null;
  }

  /* ------------------------------------------------------------ Bild */

  tick(dt, playing) {
    super.tick(dt, playing);
    if (!playing || this.isOver) return;
    const G = this.G;
    const now = G.time.elapsed;
    // Ausbluten
    let a = 0;
    let b = 0;
    for (const f of this.objectives) { if (f.owner === 'A') a++; else if (f.owner === 'B') b++; }
    const total = this.objectives.length;
    const bleed = (team, mine, theirs) => {
      const diff = theirs - mine;
      if (diff <= 0) { this._bleed[team] = 0; return; }
      const every = theirs === total ? 1 : ((this.def.objective && this.def.objective.bleedInterval) || 6) / diff;
      this._bleed[team] += dt;
      while (this._bleed[team] >= every && !this.isOver) { this._bleed[team] -= every; this.spendTicket(team, 1, 'bleed'); }
    };
    bleed('A', a, b);
    bleed('B', b, a);
    if (this.isOver) return;
    this._zones(dt);
    this._orders(now);
    if (now >= this._aiAt) { this._aiAt = now + 4; this._commander(now); }
  }

  /** HQ-Schutz (Gegner: Warnung, dann ausgeschaltet) und Kampfgebietsgrenze. */
  _zones(dt) {
    const G = this.G;
    const w = G.world;
    const warnT = (this.def.objective && this.def.objective.hqWarning) || 10;
    for (const a of G.actors) {
      if (!a.alive || a.isStreakEntity || (a.team !== 'A' && a.team !== 'B')) { this._zoneT.delete(a); continue; }
      const enemyHq = this.hq[a.team === 'A' ? 'B' : 'A'];
      let kind = null;
      if (enemyHq && enemyHq.position && flatDist(a.position, enemyHq.position) < enemyHq.radius) kind = 'hq';
      else if (w && typeof w.inBounds === 'function' && w.inBounds(a.position) === 'out') kind = 'bounds';
      const z = this._zoneT.get(a);
      if (!kind) {
        if (z) { this._zoneT.delete(a); if (a.isPlayer) G.events.emit('zone:warn', { actor: a, kind: null, left: 0 }); }
        continue;
      }
      const limit = kind === 'hq' ? warnT : BOUNDS_TIME;
      const t = (z && z.kind === kind ? z.t : 0) + dt;
      this._zoneT.set(a, { kind, t });
      if (a.isPlayer) G.events.emit('zone:warn', { actor: a, kind, left: Math.max(0, limit - t) });
      if (t >= limit) {
        this._zoneT.delete(a);
        try { G.combat.damage(a, { amount: 10000, attacker: null, weaponId: 'world', zone: 'body' }); } catch (err) { console.error('[NULLPUNKT] Gebietsgrenze:', err); }
      }
    }
  }

  /** Befehle: Verteidigen gilt nach 60 s gehaltener Flagge als erfüllt; abgelaufene Befehle verfallen. */
  _orders(now) {
    for (const sq of this.squads.list) {
      const o = sq.order;
      if (!o) continue;
      const f = this.objectives.find((x) => x.id === o.objectiveId);
      if (!f) { sq.order = null; continue; }
      if (o.kind === 'defend') {
        if (f.owner === sq.team && !f.contested) { if (now - o.at > 60 && !sq._done) { sq._done = true; this._orderDone(sq); } }
        else if (f.owner !== sq.team && f.owner) o.kind = 'attack';
      } else if (f.owner === sq.team && now - o.at > 4 && !sq._done) { sq._done = true; this._orderDone(sq); }
      if (sq.order && now - o.at > 150) sq.order = null;
    }
  }

  /** Teamhirn: jeder KI-Trupp bekommt ein Flaggenziel (Angriff auf nahe/fremde Flaggen, Verteidigung bedrohter). */
  _commander(now) {
    for (const team of ['A', 'B']) {
      const squads = this.squads.list.filter((s) => s.team === team && !(s.leader && s.leader.isPlayer));
      const load = {};
      for (const s of this.squads.list) if (s.team === team && s.order) load[s.order.objectiveId] = (load[s.order.objectiveId] || 0) + 1;
      for (const sq of squads) {
        if (sq.order && now - sq.order.at < 30 && !this._orderStale(sq)) continue;
        const mem = this.squads.members(sq, { alive: true });
        const center = mem.length ? avgPos(mem) : (this.hq[team] && this.hq[team].position) || new THREE.Vector3();
        let best = null;
        let bestS = -Infinity;
        for (const f of this.objectives) {
          const mine = f.owner === team;
          const threatened = mine && (f.contested || (f.capturingTeam && f.capturingTeam !== team));
          let sc = mine ? (threatened ? 2.4 : -1.5) : f.owner ? 1.4 : 1.8;
          sc -= flatDist(center, f.position) / 160;
          sc -= (load[f.id] || 0) * (mine ? 1.2 : 0.55);
          sc += Math.random() * 0.4;
          if (sc > bestS) { bestS = sc; best = f; }
        }
        if (!best) continue;
        if (sq.order) load[sq.order.objectiveId] = Math.max(0, (load[sq.order.objectiveId] || 1) - 1);
        load[best.id] = (load[best.id] || 0) + 1;
        sq._done = false;
        this.squads.order(sq, { kind: best.owner === team ? 'defend' : 'attack', objectiveId: best.id }, sq.leader);
      }
    }
  }

  _orderStale(sq) {
    const f = this.objectives.find((x) => x.id === sq.order.objectiveId);
    return !f || (sq.order.kind === 'attack' && f.owner === sq.team && !f.contested);
  }

  /** Spieler-Befehl an den eigenen Trupp („Angriff auf B“). */
  squadOrder(objectiveId, by = this.G.player) {
    const sq = by ? this.squads.of(by) : null;
    const f = this.objectives.find((x) => x.id === objectiveId);
    if (!sq || !f) return null;
    sq._done = false;
    const kind = f.owner === sq.team ? 'defend' : 'attack';
    this.squads.order(sq, { kind, objectiveId: f.id, label: `${kind === 'defend' ? 'Verteidigt' : 'Angriff auf'} ${f.id}${f.name ? ` – ${f.name}` : ''}` }, by);
    return sq.order;
  }

  /** Bots: Trupp-Befehl hat Vorrang, sonst Herrschafts-Verteilung. */
  objectiveFor(bot) {
    if (!bot || (bot.team !== 'A' && bot.team !== 'B') || !this.objectives.length) return null;
    const sq = this.squads.of(bot);
    const o = sq && sq.order;
    const f = o ? this.objectives.find((x) => x.id === o.objectiveId) : null;
    if (!f) return super.objectiveFor(bot);
    const now = this.G.time.elapsed;
    const cur = this._assign.get(bot);
    if (cur && cur.id === f.id && now < cur.until) return { id: f.id, position: cur.point, radius: f.radius, kind: o.kind === 'defend' ? 'defend' : 'capture' };
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * f.radius * 0.55;
    const point = f.position.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
    this._assign.set(bot, { id: f.id, point, kind: o.kind, until: now + 8 + Math.random() * 6 });
    return { id: f.id, position: point, radius: f.radius, kind: o.kind === 'defend' ? 'defend' : 'capture' };
  }

  /* ------------------------------------------------------------ Einsatz */

  /** Liste der Einsatzpunkte für den Einsatzbildschirm. */
  deployPoints(actor = this.G.player) {
    const G = this.G;
    const team = actor && actor.team;
    if (team !== 'A' && team !== 'B') return [];
    const out = [];
    const hq = this.hq[team];
    if (hq && hq.spawns.length) out.push({ kind: 'hq', id: 'hq', label: 'HQ', sub: 'Hauptquartier', position: hq.position, available: true });
    for (const f of this.objectives) {
      const ok = f.owner === team && !f.contested;
      out.push({ kind: 'flag', id: f.id, label: f.id, sub: f.name || 'Flagge', position: f.position, available: ok, owner: f.owner, contested: f.contested,
        reason: f.owner !== team ? (f.owner ? 'Gegnerische Flagge' : 'Neutral') : f.contested ? 'Umkämpft' : '' });
    }
    const sq = this.squads.of(actor);
    for (const m of this.squads.members(sq)) {
      if (m === actor) continue;
      const safe = m.alive && this._squadSafe(m);
      out.push({ kind: 'squad', id: m.id, label: m.squadLabel || m.name, sub: m.name, position: m.position, available: safe,
        reason: !m.alive ? 'Ausgeschaltet' : safe ? '' : 'Im Gefecht' });
    }
    const V = G.vehicles;
    if (V && Array.isArray(V.list)) {
      for (const v of V.list) {
        if (!v.alive || v.wreck) continue;
        const vt = v.team || v.spawnTeam;
        if (vt !== team) continue;
        const free = typeof v.freeSeats === 'function' ? v.freeSeats() : [];
        const near = hq && hq.position && flatDist(v.position, hq.position) < hq.radius + 25;
        const squadVeh = v.occupants && v.occupants.some && v.occupants.some((o) => o && o.squad === sq);
        if (!free.length || !(near || squadVeh)) continue;
        out.push({ kind: 'vehicle', id: v.id, label: v.name || v.def.name || 'Fahrzeug', sub: `${free.length} ${free.length === 1 ? 'Sitz' : 'Sitze'} frei`, position: v.position, available: true, vehicle: v });
      }
    }
    return out;
  }

  setDeploy(choice) {
    this.deployChoice = choice && choice.kind ? { kind: choice.kind, id: choice.id } : null;
  }

  _squadSafe(m) {
    const G = this.G;
    const now = G.time.elapsed;
    if (now - (this._lastHit.get(m) ?? -1e9) < SQUAD_SAFE_T) return false;
    if (m.vehicle) return false;
    for (const h of G.actors) {
      if (!h.alive || !G.combat.isHostile(m, h)) continue;
      if (h.position.distanceTo(m.position) < SQUAD_SAFE_R) return false;
    }
    return true;
  }

  chooseSpawn(actor) {
    const team = actor.team;
    if ((team !== 'A' && team !== 'B') || !this.objectives.length) return super.chooseSpawn(actor);
    let choice = null;
    if (actor.isPlayer) choice = this.deployChoice;
    else choice = this._botChoice(actor);
    const pts = choice ? this.deployPoints(actor) : [];
    const p = choice ? pts.find((x) => x.kind === choice.kind && String(x.id) === String(choice.id) && x.available) : null;
    if (p && p.kind === 'flag') {
      const f = this.objectives.find((x) => x.id === p.id);
      const s = this._pickSafe(actor, f.spawns.length ? f.spawns : [{ position: f.position, yaw: 0 }]);
      if (s) return s;
    }
    if (p && p.kind === 'squad') {
      const m = this.G.actors.find((x) => x.id === p.id);
      if (m && m.alive) return this._besideMate(m);
    }
    if (p && p.kind === 'vehicle' && p.vehicle) {
      this._enterAfterSpawn.set(actor, p.vehicle);
      const s = this._pickSafe(actor, this.hq[team].spawns, p.vehicle.position);
      if (s) return s;
    }
    return this._pickSafe(actor, this.hq[team].spawns) || super.chooseSpawn(actor);
  }

  /** KI: an der eigenen Flagge nahe dem Truppziel, sonst beim Truppführer, sonst HQ. */
  _botChoice(bot) {
    const sq = this.squads.of(bot);
    const team = bot.team;
    const target = sq && sq.order ? this.objectives.find((f) => f.id === sq.order.objectiveId) : null;
    const owned = this.objectives.filter((f) => f.owner === team && !f.contested && f.spawns.length);
    if (target && owned.length && Math.random() < 0.65) {
      owned.sort((x, y) => flatDist(x.position, target.position) - flatDist(y.position, target.position));
      if (owned[0] !== target || target.owner === team) return { kind: 'flag', id: owned[0].id };
    }
    const lead = sq && sq.leader;
    if (lead && lead !== bot && lead.alive && !lead.isPlayer && Math.random() < 0.35 && this._squadSafe(lead)) return { kind: 'squad', id: lead.id };
    return { kind: 'hq', id: 'hq' };
  }

  /** Bester freier Punkt aus `list` (weit weg von Gegnern, nicht belegt; optional nahe `near`). */
  _pickSafe(actor, list, near = null) {
    const G = this.G;
    let best = null;
    let bestS = -Infinity;
    for (const s of list || []) {
      if (!s || !s.position) continue;
      let sc = Math.random() * 6;
      let minD = 200;
      for (const a of G.actors) {
        if (!a.alive || a === actor) continue;
        const d = a.position.distanceTo(s.position);
        if (d < 1.3) sc -= 200;
        if (G.combat.isHostile(actor, a)) minD = Math.min(minD, d);
      }
      sc += Math.min(minD, 80);
      if (near) sc -= flatDist(s.position, near) * 0.8;
      if (sc > bestS) { bestS = sc; best = s; }
    }
    return best ? { position: best.position.clone(), yaw: best.yaw || 0, source: 'cq' } : null;
  }

  /** Neben dem Truppkameraden (hinter ihm, falls frei), sonst an seiner Stelle. */
  _besideMate(m) {
    const w = this.G.world;
    const yaw = m.yaw || 0;
    _a.copy(m.position);
    _b.set(m.position.x + Math.sin(yaw) * 1.4, m.position.y, m.position.z + Math.cos(yaw) * 1.4);
    const pos = _b.clone();
    if (w && typeof w.lineOfSight === 'function') {
      _a.y += 1; _b.y += 1;
      if (!w.lineOfSight(_a, _b)) pos.copy(m.position);
    }
    return { position: pos, yaw, source: 'squad' };
  }

  /* ------------------------------------------------------------ Ergebnis */

  allowOvertime() {
    return false;
  }

  extraRow(a) {
    return { label: 'Eroberungen', value: a.stats ? a.stats.captures || 0 : 0 };
  }

  resultExtra() {
    return { flags: this.objectives.map((f) => ({ id: f.id, owner: f.owner, name: f.name })), tickets: { ...this.scores }, ticketsMax: { ...this.ticketsMax } };
  }
}

function vec(p) {
  if (!p) return new THREE.Vector3();
  return p.isVector3 ? p.clone() : new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
}

function flatDist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function avgPos(list) {
  const v = new THREE.Vector3();
  for (const a of list) v.add(a.position);
  return v.multiplyScalar(1 / list.length);
}
