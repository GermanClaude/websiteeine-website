// NULLPUNKT — Serienprämien (§9): Fortschritt (Abschüsse in einem Leben, Streak-Abschüsse zählen nicht),
// Bereitschaft (bleibt über den Tod hinaus bis zum Einsatz), Einsatz durch Spieler (Tasten 3/4/5, Touch,
// Gamepad), Bots (activate(), sonst automatische Nutzung) und die drei Prämien:
//   uav    Aufklärer: Radar-Sweep zeigt Gegner auf der Minikarte (auch gegnerischer UAV gegen den Spieler)
//   strike Präzisionsschlag: Ziel auf der Karte wählen → Jet + Einschläge (strike.js)
//   sentry Wachgeschütz: automatisches Geschütz (sentry.js), zerstörbar, 45 s
// Treffer auf Geschütze: world.raycast wird solange um die Geschütze erweitert; 'impact' → Schaden.

import * as THREE from 'three';
import { STREAKS, STREAK_ORDER } from '../../shared/modes.data.js';
import { WEAPONS, EQUIPMENT } from '../../shared/weapons.data.js';
import { falloff } from '../combat.js';
import { Sentry, sentryResources } from './sentry.js';
import { Strike, strikeResources, groundAt } from './strike.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class StreakManager {
  constructor(G, mode) {
    this.G = G;
    this.mode = mode;
    this.defs = STREAK_ORDER.map((id) => STREAKS[id]).filter(Boolean).sort((a, b) => a.kills - b.kills);
    this.order = this.defs.map((d) => d.id);
    this.byId = Object.fromEntries(this.defs.map((d) => [d.id, d]));
    this.state = new Map(); // actor → { kills, earned:Set, ready:[] }
    this.uav = new Map(); // Schlüssel (Team oder Akteur-Id) → { key, owner, until, nextSweep, sweepAt, blips:[] }
    this.entities = []; // Wachgeschütze
    this.strikes = [];
    this.targeting = null;
    this._world = null;
    this._origRaycast = null;
    this._entityHits = [];
    this._botPlans = new Map();
    this._subs = null;
  }

  attach(scope) {
    scope.on('impact', (p) => this._onImpact(p));
    scope.on('explosion', (p) => this._onExplosion(p));
    scope.on('match:state', ({ state }) => { if (state !== 'playing' && state !== 'countdown') this.cancelTargeting(); });
    scope.on('kill', ({ victim }) => { if (victim === this.G.player) this.cancelTargeting(); });
  }

  /* ------------------------------------------------------------ Fortschritt */

  _st(actor) {
    let s = this.state.get(actor);
    if (!s) { s = { kills: 0, earned: new Set(), ready: [] }; this.state.set(actor, s); }
    return s;
  }

  /** Vom Modus nach jedem (Nicht-Streak-)Abschuss: lifeKills = Abschüsse in diesem Leben. */
  onKill(actor, lifeKills) {
    if (!actor || actor.isStreakEntity) return;
    const s = this._st(actor);
    s.kills = lifeKills;
    for (const d of this.defs) {
      if (lifeKills >= d.kills && !s.earned.has(d.id)) {
        s.earned.add(d.id);
        if (!s.ready.includes(d.id)) {
          s.ready.push(d.id);
          this.G.events.emit('streak:ready', { actor, streakId: d.id });
        }
      }
    }
    this.G.events.emit('streak:progress', { actor, value: lifeKills, next: this._next(s) });
  }

  onDeath(actor) {
    const s = this.state.get(actor);
    if (!s) return;
    s.kills = 0;
    s.earned.clear();
    this.G.events.emit('streak:progress', { actor, value: 0, next: this._next(s) });
  }

  _next(s) {
    const d = this.defs.find((x) => !s.earned.has(x.id) && s.kills < x.kills);
    return d ? { id: d.id, kills: d.kills } : null;
  }

  progress(actor) {
    const s = this._st(actor);
    const n = this._next(s);
    return { kills: s.kills, nextId: n ? n.id : null, nextKills: n ? n.kills : null, ready: [...s.ready], earned: [...s.earned] };
  }

  ready(actor) {
    return [...this._st(actor).ready];
  }

  isReady(actor, id) {
    return this._st(actor).ready.includes(id);
  }

  /* ------------------------------------------------------------ Einsatz */

  /**
   * Prämie einsetzen. opts.target (Vector3) für 'strike' (Bots ohne Ziel: automatisch).
   * → true bei Erfolg.
   */
  activate(actor, streakId, opts = {}) {
    const G = this.G;
    if (!actor || !actor.alive || this.mode.isOver || G.match.state !== 'playing') return false;
    const s = this._st(actor);
    const i = s.ready.indexOf(streakId);
    if (i < 0) return false;
    const def = this.byId[streakId];
    let target = null;
    if (streakId === 'strike') {
      target = opts.target || this.suggestStrikeTarget(actor) || this._aimPoint(actor);
      if (!target) return false;
      this.strikes.push(new Strike(this, actor, target, def.params));
    } else if (streakId === 'sentry') {
      const spot = this._sentrySpot(actor);
      this._installRaycast();
      this.entities.push(new Sentry(this, actor, spot.position, spot.yaw, def.params, def.duration || 45));
    } else if (streakId === 'uav') {
      this._startUav(actor, def);
    } else return false;
    s.ready.splice(i, 1);
    this.mode.award(actor, 'streak');
    G.events.emit('streak:activate', { actor, streakId, target: target ? target.clone() : null });
    return true;
  }

  /** Spieler: Präzisionsschlag über die Zielkarte (HUD), sonst direkt. */
  _playerActivate(id) {
    const G = this.G;
    const p = G.player;
    if (id !== 'strike') return this.activate(p, id);
    const hud = G.hud;
    if (!hud || typeof hud.openStrikeTargeting !== 'function' || !G.world || !G.world.minimap) return this.activate(p, id, { target: this._aimPoint(p) });
    const session = { done: false };
    this.targeting = session;
    G.input.setEnabled(false);
    const close = () => {
      if (session.done) return;
      session.done = true;
      if (this.targeting === session) this.targeting = null;
      const st = G.match.state;
      if (G.input) G.input.setEnabled(st === 'playing' || st === 'countdown');
    };
    const ok = hud.openStrikeTargeting({
      radius: this.byId.strike.params ? this.byId.strike.params.radius || 7 : 7,
      spacing: this.byId.strike.params ? this.byId.strike.params.spacing || 6 : 6,
      onConfirm: (pos) => { close(); this.activate(p, 'strike', { target: pos }); },
      onCancel: () => close(),
    });
    session.close = () => { close(); if (hud.closeStrikeTargeting) hud.closeStrikeTargeting(); };
    if (!ok) { close(); return this.activate(p, id, { target: this._aimPoint(p) }); }
    return true;
  }

  cancelTargeting() {
    if (this.targeting && this.targeting.close) this.targeting.close();
    this.targeting = null;
  }

  /** Punkt unter dem Fadenkreuz (Rückfall für den Schlag). */
  _aimPoint(actor) {
    const G = this.G;
    if (!G.world || !actor.getEyePosition) return null;
    const eye = actor.getEyePosition(new THREE.Vector3());
    const dir = actor.getAimDirection(new THREE.Vector3());
    const hit = G.world.raycast(eye, dir, 140);
    const p = hit ? hit.point.clone() : eye.addScaledVector(dir, 40);
    p.y = groundAt(G.world, p.x, p.z, p.y + 3);
    return p;
  }

  /** Gegnerhaufen für den Schlag (Bots / Rückfall). */
  suggestStrikeTarget(actor) {
    const G = this.G;
    const hostiles = G.actors.filter((a) => a.alive && a !== actor && G.combat && G.combat.isHostile(actor, a));
    let best = null;
    let bestScore = 0;
    for (const h of hostiles) {
      if (h.position.distanceTo(actor.position) < 16) continue;
      let score = 1;
      for (const o of hostiles) if (o !== h && o.position.distanceTo(h.position) < 9) score += 1;
      // Eigene Leute in der Nähe vermeiden (kein Teamschaden, aber Selbstschaden)
      if (h.position.distanceTo(actor.position) < 22) score -= 0.5;
      score += Math.random() * 0.4;
      if (score > bestScore) { bestScore = score; best = h; }
    }
    return best ? best.position.clone() : null;
  }

  _sentrySpot(actor) {
    const G = this.G;
    const w = G.world;
    const yaw = actor.yaw || 0;
    const fwd = _d.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const base = actor.position.clone();
    let pos = base.clone();
    for (const dist of [1.7, 1.2, 0.8]) {
      const c = base.clone().addScaledVector(fwd, dist);
      const from = _v.copy(base);
      from.y += 0.9;
      const to = c.clone();
      to.y += 0.9;
      if (!w || !w.lineOfSight || w.lineOfSight(from, to)) {
        const gy = groundAt(w, c.x, c.z, base.y + 1.2);
        if (Math.abs(gy - base.y) < 0.8) { c.y = gy; pos = c; break; }
      }
    }
    for (const e of this.entities) if (e.alive && e.position.distanceTo(pos) < 1) pos.addScaledVector(fwd, -1);
    return { position: pos, yaw };
  }

  /* ------------------------------------------------------------ Aufklärer */

  _uavKey(actor) {
    return this.mode.teams && actor.team != null ? actor.team : actor.id;
  }

  _startUav(actor, def) {
    const G = this.G;
    const now = G.time.elapsed;
    const key = this._uavKey(actor);
    const dur = def.duration || 30;
    const cur = this.uav.get(key);
    const entry = cur && cur.until > now ? cur : { key, owner: actor, until: now, nextSweep: now, sweepAt: now, blips: [], interval: (def.params && def.params.sweepInterval) || 2 };
    entry.owner = actor;
    // Stapeln verlängert, aber höchstens auf 1,5 × Dauer ab jetzt
    entry.until = Math.min(Math.max(entry.until, now) + dur, now + dur * 1.5);
    entry.nextSweep = now;
    this.uav.set(key, entry);
    G.events.emit('uav:state', { team: key, active: true, until: entry.until, owner: actor });
  }

  _hostileToKey(a, key) {
    if (this.mode.teams && (key === 'A' || key === 'B')) return a.team !== key;
    return a.id !== key;
  }

  /** Hat diese Seite (Team 'A'|'B', Akteur oder Akteur-Id) einen aktiven Aufklärer? */
  uavActive(teamOrActor) {
    const key = typeof teamOrActor === 'object' && teamOrActor ? this._uavKey(teamOrActor) : teamOrActor;
    const e = this.uav.get(key);
    return !!e && e.until > this.G.time.elapsed;
  }

  /**
   * Wird `actor` gerade von einem gegnerischen Aufklärer erfasst? Optional `by` (Team 'A'|'B', Akteur
   * oder Akteur-Id): nur der Aufklärer dieser Seite zählt (FFA: nicht der eines Dritten).
   */
  isRevealed(actor, by) {
    const now = this.G.time.elapsed;
    if (by != null) {
      const e = this.uav.get(typeof by === 'object' ? this._uavKey(by) : by);
      return !!e && e.until > now && this._hostileToKey(actor, e.key);
    }
    for (const e of this.uav.values()) if (e.until > now && this._hostileToKey(actor, e.key)) return true;
    return false;
  }

  /** HUD: { own: entry|null, enemy: bool, enemyUntil } aus Sicht von `actor`. */
  uavInfo(actor) {
    const now = this.G.time.elapsed;
    const key = this._uavKey(actor);
    const own = this.uav.get(key);
    let enemy = false;
    let enemyUntil = 0;
    for (const e of this.uav.values()) if (e.key !== key && e.until > now) { enemy = true; enemyUntil = Math.max(enemyUntil, e.until); }
    return { own: own && own.until > now ? own : null, enemy, enemyUntil };
  }

  /* ------------------------------------------------------------ Update */

  update(dt, playing) {
    const G = this.G;
    const now = G.time.elapsed;
    // Spieler-Eingabe
    const p = G.player;
    if (playing && p && p.alive && !this.targeting && G.input) {
      for (let i = 0; i < 3; i++) {
        if (!G.input.pressed(`streak${i + 1}`)) continue;
        const id = this.order[i];
        if (!id) continue;
        if (this.isReady(p, id)) this._playerActivate(id);
        else {
          const s = this._st(p);
          const d = this.byId[id];
          G.events.emit('streak:denied', { actor: p, streakId: id, need: Math.max(0, d.kills - s.kills) });
        }
      }
    }
    // Aufklärer
    for (const [key, e] of this.uav) {
      if (now >= e.until) {
        this.uav.delete(key);
        G.events.emit('uav:state', { team: key, active: false, until: e.until, owner: e.owner });
        continue;
      }
      if (now >= e.nextSweep) {
        e.nextSweep = now + e.interval;
        e.sweepAt = now;
        e.blips = [];
        for (const a of G.actors) if (a.alive && this._hostileToKey(a, key)) e.blips.push({ actor: a, x: a.position.x, z: a.position.z, yaw: a.yaw || 0 });
        for (const s of this.entities) if (s.alive && this._hostileToKey(s.owner, key)) e.blips.push({ actor: s, x: s.position.x, z: s.position.z, yaw: s.yaw, entity: true });
      }
    }
    // Schläge
    for (let i = this.strikes.length - 1; i >= 0; i--) if (!this.strikes[i].update(dt)) this.strikes.splice(i, 1);
    // Geschütze
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (!e.update(dt, playing)) { e.dispose(); this.entities.splice(i, 1); }
    }
    if (!this.entities.length) this._uninstallRaycast();
    // Bots: automatische Nutzung, falls der BotManager sie nicht selbst steuert
    if (playing && !(G.bots && G.bots.handlesStreaks)) this._autoBots(now);
  }

  _autoBots(now) {
    for (const [actor, s] of this.state) {
      if (!actor.isBot || !actor.alive || !s.ready.length) continue;
      let plan = this._botPlans.get(actor);
      if (!plan) { plan = { at: now + 1.5 + Math.random() * 4 }; this._botPlans.set(actor, plan); }
      if (now < plan.at) continue;
      plan.at = now + 2 + Math.random() * 3;
      const id = s.ready[0];
      if (id === 'strike' && !this.suggestStrikeTarget(actor)) continue;
      if (id === 'sentry' && actor.ai && actor.ai.target) continue; // nicht mitten im Gefecht
      this.activate(actor, id);
    }
  }

  /** Gefahrenzonen für die Spawnwahl. */
  dangerZones() {
    return this.strikes.filter((s) => !s.done).map((s) => ({ position: s.target, radius: s.radius }));
  }

  /* ------------------------------------------------------------ Geschütz-Treffer */

  _installRaycast() {
    const w = this.G.world;
    if (!w || this._origRaycast || typeof w.raycast !== 'function') return;
    const orig = w.raycast;
    const own = Object.prototype.hasOwnProperty.call(w, 'raycast');
    this._world = w;
    this._origRaycast = { fn: orig, own };
    const self = this;
    w.raycast = function raycastWithEntities(origin, dir, maxDist = 1000) {
      let best = orig.call(w, origin, dir, maxDist);
      for (const e of self.entities) {
        if (!e.alive) continue;
        const h = e.raycast(origin, dir, best ? best.distance : maxDist);
        if (h) best = h;
      }
      if (best && best.entity) { self._entityHits.push(best); if (self._entityHits.length > 6) self._entityHits.shift(); }
      return best;
    };
  }

  _uninstallRaycast() {
    if (!this._origRaycast || !this._world) return;
    const w = this._world;
    if (this._origRaycast.own) w.raycast = this._origRaycast.fn;
    else delete w.raycast;
    this._origRaycast = null;
    this._world = null;
    this._entityHits.length = 0;
  }

  _onImpact(p) {
    if (!p || !p.point || !this._entityHits.length) return;
    const h = this._entityHits.find((x) => x.point === p.point) || this._entityHits.find((x) => x.point.distanceToSquared(p.point) < 0.0004);
    this._entityHits.length = 0;
    if (!h) return;
    const e = h.entity;
    const shooter = p.shooter;
    if (!e || !e.alive || !shooter || !e._hostile(shooter)) return;
    const def = WEAPONS[p.weaponId] || (shooter.def && shooter.def.id === p.weaponId ? shooter.def : null);
    if (!def) return;
    let dist = 10;
    if (shooter.getEyePosition) dist = shooter.getEyePosition(_v).distanceTo(p.point);
    const dmg = falloff(def, dist) * (Number.isFinite(shooter.damageScale) ? shooter.damageScale : 1);
    this._hitEntity(e, dmg, shooter);
  }

  _onExplosion(p) {
    if (!p || !p.position || !this.entities.length) return;
    const G = this.G;
    const attacker = p.attacker || null;
    const eq = EQUIPMENT[p.type] || EQUIPMENT[p.weaponId];
    const strike = this.byId.strike && this.byId.strike.params;
    const max = eq ? eq.maxDamage : p.weaponId === 'strike' || p.type === 'airstrike' ? (strike && strike.maxDamage) || 200 : 120;
    const radius = p.radius || 5;
    for (const e of this.entities) {
      if (!e.alive || !attacker || !e._hostile(attacker)) continue;
      const d = e.getAimPoint(_v).distanceTo(p.position);
      if (d > radius) continue;
      this._hitEntity(e, max * Math.pow(1 - d / radius, 1.2), attacker);
    }
  }

  _hitEntity(e, amount, attacker) {
    if (amount <= 0) return;
    const dealt = e.applyDamage(amount, attacker);
    if (dealt > 0) this.G.events.emit('streak:hit', { entity: e, attacker, amount: dealt, destroyed: !e.alive });
  }

  _destroyEntity(e, by) {
    const G = this.G;
    e.alive = false;
    e._dying = 0.001;
    const credit = by && by.isStreakEntity ? by.owner : by;
    G.events.emit('explosion', { position: e.getAimPoint(new THREE.Vector3()), radius: 2.2, attacker: null, type: 'sentry', weaponId: null });
    if (credit && credit !== e.owner && !credit.isStreakEntity) {
      this.mode.award(credit, 'destroy');
      this.mode.medals.award(credit, 'abwehr');
    }
    G.events.emit('streak:destroyed', { streakId: e.streakId, entity: e, owner: e.owner, by: credit || null });
  }

  _expireEntity(e) {
    this.G.events.emit('streak:expired', { streakId: e.streakId, entity: e, owner: e.owner });
  }

  _strikeImpact() {}

  /* ------------------------------------------------------------ Ressourcen */

  /** Geteilte Geometrien/Materialien (sentry.js/strike.js); werden nicht mit dem Match entsorgt. */
  resources(kind = 'sentry') {
    return kind === 'strike' ? strikeResources() : sentryResources();
  }

  /**
   * Je Material ein Objekt für die Aufwärmgruppe des Modus (BaseMode): main.warmUp() kompiliert sie mit Licht,
   * Nebel und Umgebung des Matches – sonst linkt das erste Geschütz bzw. der erste Luftschlag mitten im Gefecht.
   */
  warmObjects() {
    const out = [];
    for (const kind of ['sentry', 'strike']) {
      const R = this.resources(kind);
      const geo = kind === 'strike' ? R.missile : R.hub;
      for (const mat of Object.values(R.mats)) out.push(new THREE.Mesh(geo, mat));
    }
    return out;
  }

  /** Matchende: alles anhalten (Objekte bleiben bis dispose sichtbar). */
  endAll() {
    this.cancelTargeting();
  }

  dispose() {
    this.cancelTargeting();
    for (const e of this.entities) e.dispose();
    for (const s of this.strikes) s.dispose();
    this.entities = [];
    this.strikes = [];
    this._uninstallRaycast();
    this.uav.clear();
    this.state.clear();
    this._botPlans.clear();
  }
}
