// NULLPUNKT — Serienprämien (§9): Fortschritt (Abschüsse in einem Leben, Streak-Abschüsse zählen nicht),
// Bereitschaft (bleibt über den Tod hinaus bis zum Einsatz), Einsatz durch Spieler (Tasten 3/4/5/6, Touch,
// Gamepad), Bots (activate(), sonst automatische Nutzung) und die vier Prämien:
//   uav    Aufklärer: Radar-Sweep zeigt Gegner auf der Minikarte (auch gegnerischer UAV gegen den Spieler)
//   strike Präzisionsschlag: Ziel auf der Karte wählen → Jet + Einschläge (strike.js)
//   sentry Wachgeschütz: automatisches Geschütz (sentry.js), zerstörbar, 45 s
//   drohne FPV-Drohne: der Spieler steuert eine Kamikaze-Drohne (drone.js), Bots fliegen sie per Autopilot
// Plätze/Tasten: this.order = STREAK_ORDER (streak1 … streak4, fest); this.defs = verfügbare Prämien nach Abschüssen.
// Treffer auf Geschütze/Drohnen (this.entities): world.raycast wird solange um sie erweitert; 'impact' → Schaden.
// Mehrspieler (opts): only = erlaubte Prämien (online uav, drohne, strike – Wachgeschütz folgt); replica = Client – Fortschritt und Einsatz entscheidet
// der Host ('ev' sk/sa, Anfrage 'streak'), die eigene Drohne fliegt lokal und meldet sich ('drone' p/x/e), fremde Drohnen
// kommen als Abbild ('ev' dr/de), eigene Treffer auf fremde Drohnen gehen als Meldung an den Host ('drone' h). Der Host
// prüft Lage, Sprengung und Treffer (net*-Methoden, aufgerufen von net/sync-host.js).

import * as THREE from 'three';
import { STREAKS, STREAK_ORDER } from '../../shared/modes.data.js';
import { WEAPONS, EQUIPMENT } from '../../shared/weapons.data.js';
import { falloff } from '../combat.js';
import { Sentry, sentryResources } from './sentry.js';
import { Strike, strikeResources, groundAt } from './strike.js';
import { Drone, DroneAudio, droneResources, launchSpot, realNow } from './drone.js';
import { collisionRay } from '../engine/physics.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _wd = new THREE.Vector3();
const _wh = {};
const _wh2 = {};
/** Host: Wandstärke (m entlang des Wegs), ab der ein gemeldeter Weg einer Client-Drohne als „durch die Wand“ gilt. */
const WALL_MIN = 0.12;

/**
 * Host: Weg a → b einer Client-Drohne durch Kollisionsgeometrie? Strahl hin und zurück; nur ein Hindernis mit mehr als
 * WALL_MIN Stärke zählt (gestreifte Kanten und Ecken bei Kurven zwischen zwei Meldungen nicht). → Abstand ab a bis zur
 * Wand oder -1 (frei).
 */
function wallBetween(world, a, b) {
  if (!world) return -1;
  const len = a.distanceTo(b);
  if (len < WALL_MIN + 0.05) return -1;
  _wd.subVectors(b, a).divideScalar(len);
  const h = collisionRay(world, a, _wd, len, _wh);
  if (!h || h.distance > len - 0.05) return -1;
  const tf = h.distance;
  _wd.negate();
  const h2 = collisionRay(world, b, _wd, len, _wh2);
  if (!h2) return -1;
  return len - h2.distance - tf > WALL_MIN ? tf : -1;
}
/** Gründe, mit denen ein Client seinen Flug beenden darf. */
const CLIENT_END = new Set(['abbruch', 'aufprall', 'akku', 'signal']);
const vec = (a) => (Array.isArray(a) && a.length >= 3 && a.every((x) => Number.isFinite(x)) ? new THREE.Vector3(a[0], a[1], a[2]) : null);

export class StreakManager {
  /**
   * @param G Spielkontext, mode Modus, opts { only: [ids] erlaubte Prämien, replica: Client (Host entscheidet) }
   */
  constructor(G, mode, opts = {}) {
    this.G = G;
    this.mode = mode;
    this.replica = !!opts.replica;
    const allow = Array.isArray(opts.only) ? new Set(opts.only) : null;
    // Plätze (Tasten streak1 …) fest nach STREAK_ORDER; verfügbar (Fortschritt, HUD) nur die erlaubten, nach Abschüssen
    this.order = STREAK_ORDER.filter((id) => STREAKS[id]);
    this.defs = this.order.map((id) => STREAKS[id]).filter((d) => !allow || allow.has(d.id)).sort((a, b) => a.kills - b.kills);
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
    /** Eigene FPV-Drohne, solange der Spieler sie steuert (HUD, Minikarte, Kamera). */
    this.pilot = null;
    this.droneAudio = new DroneAudio(G);
    this._droneSerial = 0;
    this._pending = null; // Client: beim Host angefragte Prämie { id, at }
    this._endedNet = new Map(); // Client: Netz-Id beendeter Drohnen → Zeit (späte 'dr' legen sie nicht neu an)
    this._boomSent = null; // Client: eigene, an den Host gemeldete Sprengung { id, drone, at } (Antwort 'abgelehnt')
    this._hitRec = new Map(); // Host: Treffermeldungen je Schütze { serial, n, at }
    /**
     * Host: Spielraum der Flugdauer einer Client-Drohne in Echtzeit (Akku × Faktor + 3 s). Die Spielzeit eines langsamen
     * Geräts läuft langsamer (dt je Bild ≤ 1/20 s): 2,2 deckt Clients ab ≈ 9 Bildern/s; Prüfläufe in SwiftShader setzen mehr.
     */
    this.netTimeFactor = 2.2;
  }

  attach(scope) {
    scope.on('impact', (p) => this._onImpact(p));
    scope.on('explosion', (p) => this._onExplosion(p));
    scope.on('match:state', ({ state }) => {
      if (state !== 'playing' && state !== 'countdown') this.cancelTargeting();
      if (state !== 'playing' && state !== 'countdown' && state !== 'paused') this.endAll(); // Ende/Lobby: Kamera zurück
      // Pause offline: die Simulation steht (kein update mehr) – Summen aus; beim Fortsetzen legt update die Stimmen neu an.
      // Online läuft die Simulation im Pausenmenü weiter.
      if (state === 'paused' && !(this.G.match && this.G.match.netRole)) { try { this.droneAudio.stopAll(); } catch { /* */ } }
    });
    scope.on('match:end', () => this.endAll());
    // VR-Sitzung beginnt im Flug: Drohne abbrechen (in VR gibt es sie nicht, die Brille führt die Kamera)
    scope.on('xr:start', () => { if (this.pilot && this.pilot.alive) this.pilot.end('abbruch'); });
    scope.on('kill', ({ victim }) => {
      if (victim === this.G.player) this.cancelTargeting();
      // Besitzer tot → seine Drohne stürzt ab (fremde Abbilder beendet der Host)
      if (victim) for (const e of this.entities) if (e.kind === 'drohne' && e.alive && e.owner === victim && e.role !== 'replica') e.end('tot');
    });
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

  /**
   * Akkord-Tasten der Serien (input._chordIdle, Gamepad LT + ▼ = Serie 4): true, wenn eine der Aktionen (streak1…) jetzt
   * einsetzbar ist – sonst gilt die einfache Belegung der Taste (Lampe/Platte).
   */
  chordReady(actions) {
    const p = this.G.player;
    if (!p || !p.alive || this.targeting || this.pilot) return false;
    for (const a of actions) {
      const m = /^streak(\d)$/.exec(a);
      const id = m ? this.order[Number(m[1]) - 1] : null;
      if (id && this.byId[id] && this.isReady(p, id)) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ Einsatz */

  /**
   * Prämie einsetzen. opts.target (Vector3) für 'strike' (Bots ohne Ziel: automatisch).
   * → true bei Erfolg.
   */
  activate(actor, streakId, opts = {}) {
    const G = this.G;
    // online im Pausenmenü des Hosts läuft das Match weiter (netLive)
    if (!actor || !actor.alive || this.mode.isOver || (G.match.state !== 'playing' && !G.match.netLive)) return false;
    const s = this._st(actor);
    const i = s.ready.indexOf(streakId);
    if (i < 0) return false;
    const def = this.byId[streakId];
    if (!def) return false;
    let target = null;
    if (streakId === 'drohne') {
      if (!this._launchDrone(actor, def, opts)) return false;
    } else if (streakId === 'strike') {
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

  /** Spieler: Präzisionsschlag über die Zielkarte (HUD), sonst direkt; Client: Anfrage an den Host. */
  _playerActivate(id) {
    const G = this.G;
    const p = G.player;
    if (id === 'drohne' && !this._droneAllowed(p)) return false;
    if (this.replica && id !== 'strike') return this._request(id);
    if (id !== 'strike') return this.activate(p, id);
    // Luftschlag: Zielkarte (online schickt der Client das Ziel an den Host)
    const fire = (pos) => (this.replica ? this._request('strike', pos) : this.activate(p, 'strike', { target: pos }));
    const hud = G.hud;
    if (!hud || typeof hud.openStrikeTargeting !== 'function' || !G.world || !G.world.minimap) return fire(this._aimPoint(p));
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
      onConfirm: (pos) => { close(); fire(pos); },
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
    if (playing && p && p.alive && !this.targeting && !this.pilot && G.input) {
      for (let i = 0; i < this.order.length; i++) {
        if (!G.input.pressed(`streak${i + 1}`)) continue;
        const id = this.order[i];
        const d = this.byId[id];
        if (!d) continue; // in diesem Spiel nicht verfügbar (online ohne Wachgeschütz)
        if (this.isReady(p, id)) this._playerActivate(id);
        else {
          const s = this._st(p);
          G.events.emit('streak:denied', { actor: p, streakId: id, need: Math.max(0, d.kills - s.kills) });
        }
      }
    }
    if (this._pending && now - this._pending.at > 3) this._pending = null; // keine Antwort des Hosts → erneut möglich
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
    // Geschütze und Drohnen
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (!e.update(dt, playing)) { e.dispose(); this.entities.splice(i, 1); }
    }
    if (!this.entities.length) this._uninstallRaycast();
    // Kamera in der eigenen Drohne (nach player.update – wie die Fahrzeugkamera bleibt G.camera die Spielerkamera)
    if (this.pilot && this.pilot.alive) this._pilotCamera(this.pilot);
    try { this.droneAudio.update(this.entities, this.pilot); } catch { /* Klang ist Beiwerk */ }
    // Bots: automatische Nutzung, falls der BotManager sie nicht selbst steuert
    if (playing && !this.replica && !(G.bots && G.bots.handlesStreaks)) this._autoBots(now);
  }

  _autoBots(now) {
    for (const [actor, s] of this.state) {
      if (!actor.isBot || actor.puppet || actor.isRemoteHuman || !actor.alive || !s.ready.length) continue;
      let plan = this._botPlans.get(actor);
      if (!plan) { plan = { at: now + 1.5 + Math.random() * 4 }; this._botPlans.set(actor, plan); }
      if (now < plan.at) continue;
      plan.at = now + 2 + Math.random() * 3;
      const id = s.ready[0];
      if (id === 'strike' && !this.suggestStrikeTarget(actor)) continue;
      if (id === 'sentry' && actor.ai && actor.ai.target) continue; // nicht mitten im Gefecht
      if (id === 'drohne' && !this.droneTargetFor(actor)) continue;
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
    this._hitEntity(e, dmg, shooter, def.id);
  }

  _onExplosion(p) {
    // Client: Explosionen kommen vom Host (Darstellung), Schaden an Drohnen entscheidet der Host
    if (!p || !p.position || !this.entities.length || this.replica || p.net) return;
    const G = this.G;
    const attacker = p.attacker || null;
    const eq = EQUIPMENT[p.type] || EQUIPMENT[p.weaponId];
    const strike = STREAKS.strike && STREAKS.strike.params;
    const drone = STREAKS.drohne && STREAKS.drohne.params;
    const max = eq ? eq.maxDamage : p.weaponId === 'strike' || p.type === 'airstrike' ? (strike && strike.maxDamage) || 200 : p.weaponId === 'drohne' ? (drone && drone.maxDamage) || 180 : 120;
    const radius = p.radius || 5;
    for (const e of this.entities) {
      if (!e.alive || !attacker || !e._hostile(attacker)) continue;
      const d = e.getAimPoint(_v).distanceTo(p.position);
      if (d > radius) continue;
      this._hitEntity(e, max * Math.pow(1 - d / radius, 1.2), attacker);
    }
  }

  _hitEntity(e, amount, attacker, weaponId = null) {
    if (amount <= 0) return;
    const dealt = e.applyDamage(amount, attacker, weaponId);
    if (dealt > 0) this.G.events.emit('streak:hit', { entity: e, attacker, amount: dealt, destroyed: !e.alive });
  }

  _destroyEntity(e, by) {
    const G = this.G;
    const credit = by && by.isStreakEntity ? by.owner : by;
    if (e.kind === 'drohne') e.end('abschuss', credit || null); // Absturz ohne große Explosion
    else {
      e.alive = false;
      e._dying = 0.001;
      G.events.emit('explosion', { position: e.getAimPoint(new THREE.Vector3()), radius: 2.2, attacker: null, type: 'sentry', weaponId: null });
    }
    if (credit && credit !== e.owner && !credit.isStreakEntity) {
      this.mode.award(credit, e.scoreReason || 'destroy');
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
    return kind === 'strike' ? strikeResources() : kind === 'drohne' ? droneResources() : sentryResources();
  }

  /**
   * Je Material ein Objekt für die Aufwärmgruppe des Modus (BaseMode): main.warmUp() kompiliert sie mit Licht,
   * Nebel und Umgebung des Matches – sonst linkt das erste Geschütz bzw. der erste Luftschlag mitten im Gefecht.
   */
  warmObjects() {
    const out = [];
    for (const kind of ['sentry', 'strike', 'drohne']) {
      if (kind === 'drohne' && !this.byId.drohne) continue;
      if (kind !== 'drohne' && this.replica) continue;
      const R = this.resources(kind);
      const geo = kind === 'strike' ? R.missile : kind === 'drohne' ? R.body : R.hub;
      for (const mat of Object.values(R.mats)) out.push(new THREE.Mesh(geo, mat));
    }
    return out;
  }

  /**
   * Matchende: alles anhalten (Objekte bleiben bis dispose sichtbar); Drohnen landen, die Kamera kehrt zurück. Danach ruft
   * niemand mehr update auf (BaseMode bricht bei isOver ab) – daher das Summen hier anhalten.
   */
  endAll() {
    this.cancelTargeting();
    for (const e of this.entities) if (e.kind === 'drohne' && e.alive) e.end('ende', null, null, { quiet: true });
    try { this.droneAudio.stopAll(); } catch { /* Klang ist Beiwerk */ }
  }

  dispose() {
    this.cancelTargeting();
    for (const e of this.entities) if (e.kind === 'drohne' && e.alive) e.end('ende', null, null, { quiet: true });
    try { this.droneAudio.stopAll(); } catch { /* */ }
    for (const e of this.entities) e.dispose();
    for (const s of this.strikes) s.dispose();
    this.entities = [];
    this.strikes = [];
    this._uninstallRaycast();
    this.uav.clear();
    this.state.clear();
    this._botPlans.clear();
    this._endedNet.clear();
    this._boomSent = null;
    this._hitRec.clear();
    this.pilot = null;
  }

  /* ================================================================ FPV-Drohne */

  /** Drohne erlaubt? (VR: nicht angeboten – Hinweis; im Fahrzeug, beim Klettern oder während eines Flugs nicht) */
  _droneAllowed(p) {
    const G = this.G;
    if (G.xr && G.xr.presenting) { G.events.emit('streak:refused', { actor: p, streakId: 'drohne', reason: 'vr' }); return false; }
    if (p.vehicle || p.mantling) { G.events.emit('streak:refused', { actor: p, streakId: 'drohne', reason: 'busy' }); return false; }
    if (this.pilot || this._pending) return false;
    return true;
  }

  /** Bots: Gegner in Reichweite der Drohne (sonst bleibt die Prämie bereit). */
  droneTargetFor(actor) {
    const G = this.G;
    let best = null;
    let bd = 65 * 65;
    for (const a of G.actors) {
      if (!a.alive || a === actor || !G.combat || !G.combat.isHostile(actor, a)) continue;
      const d = a.position.distanceToSquared(actor.position);
      if (d < 64 || d >= bd) continue; // zu nah: lieber schießen
      bd = d;
      best = a;
    }
    return best;
  }

  /** Lebende Drohne eines Akteurs (nicht die Abbilder auf Clients). */
  droneOf(actor) {
    return this.entities.find((e) => e.kind === 'drohne' && e.alive && e.owner === actor && e.role !== 'replica') || null;
  }

  _droneByNet(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    return this.entities.find((e) => e.kind === 'drohne' && e.netId === id) || null;
  }

  /**
   * Drohne starten. opts: { position (Vector3, Startpunkt – vom Client vorgeschlagen, geprüft), yaw, pitch, netId, battery }.
   * Rolle: eigener Spieler 'pilot', Puppe eines Clients (Host) 'remote', sonst 'bot'. → Drohne oder null.
   */
  _launchDrone(actor, def, opts = {}) {
    const G = this.G;
    if (this.droneOf(actor)) return null;
    const role = actor === G.player ? 'pilot' : actor.isRemoteHuman ? 'remote' : 'bot';
    if (role === 'pilot' && !this.replica && !this._droneAllowed(actor)) return null;
    if (role === 'bot' && !this.droneTargetFor(actor)) return null;
    const spot = launchSpot(G.world, actor, new THREE.Vector3());
    let pos = spot;
    const want = opts.position && opts.position.isVector3 ? opts.position : null;
    if (want) {
      // Vorschlag des Clients nur nahe am eigenen Kopf und mit freier Sicht dorthin
      actor.getEyePosition(_e);
      const w = G.world;
      const near = want.distanceTo(_e) < (role === 'pilot' ? 6 : 4);
      if (near && (!w || !w.lineOfSight || role === 'pilot' || w.lineOfSight(_e, want))) pos = want.clone();
    }
    const yaw = Number.isFinite(opts.yaw) ? opts.yaw : actor.yaw || 0;
    const pitch = Number.isFinite(opts.pitch) ? opts.pitch : (actor.pitch || 0) * 0.5;
    const netId = Number.isInteger(opts.netId) && opts.netId > 0 ? opts.netId : this.replica ? 0 : ++this._droneSerial;
    const d = new Drone(this, actor, { role, position: pos, launch: pos, yaw, pitch, params: def.params, netId, battery: opts.battery });
    this.entities.push(d);
    this._installRaycast();
    if (role === 'pilot') this._startPilot(d);
    return d;
  }

  _startPilot(d) {
    const G = this.G;
    const p = G.player;
    this.pilot = d;
    p.piloting = d;
    if (G.input && typeof G.input.cancelAds === 'function') G.input.cancelAds();
    const vm = G.viewmodel && G.viewmodel.scene;
    if (vm) { this._vmVisible = vm.visible !== false; vm.visible = false; } // Waffe gesenkt (Ich-Sicht in der Drohne)
    G.events.emit('drone:pilot', { drone: d, on: true });
  }

  _endPilot(d, why) {
    const G = this.G;
    if (this.pilot !== d) return;
    this.pilot = null;
    const p = G.player;
    if (p && p.piloting === d) {
      p.piloting = null;
      p._fireGate = true; // gehaltene Feuertaste (Sprengen) schießt nicht sofort mit der Waffe weiter
    }
    const vm = G.viewmodel && G.viewmodel.scene;
    if (vm && this._vmVisible !== false && p && p.alive) vm.visible = true; // tot: Waffe bleibt weg (player.onDeath)
    // Kamera sofort zurück in den Kopf (Lage, Drehung, Sichtfeld): nach Matchende läuft player.update nicht mehr, der
    // Endbildschirm zeigte sonst das Drohnenbild; mitten im Spiel spart es ein Bild in der alten Drohnensicht
    if (p && p.alive && typeof p._updateCamera === 'function' && !(G.xr && G.xr.presenting)) {
      try { p._updateCamera(0); } catch { /* */ }
    }
    G.events.emit('drone:pilot', { drone: d, on: false, why });
  }

  /** Kamera in der Drohne (vorn im Rahmen), weiteres Sichtfeld, leichtes Zittern bei Tempo. */
  _pilotCamera(d) {
    const G = this.G;
    const cam = G.camera;
    if (!cam) return;
    const cp = Math.cos(d.pitch), sp = Math.sin(d.pitch);
    _e.set(-Math.sin(d.yaw) * cp, sp, -Math.cos(d.yaw) * cp);
    cam.position.copy(d.position).addScaledVector(_e, 0.1);
    const t = d.age;
    const sh = (d.boosting ? 0.0035 : 0.0012) * Math.min(1.5, 0.3 + d.speed / 18);
    const n1 = Math.sin(t * 41.3) * 0.6 + Math.sin(t * 23.1 + 1.7) * 0.4;
    const n2 = Math.sin(t * 37.7 + 0.4) * 0.6 + Math.sin(t * 19.9 + 2.2) * 0.4;
    cam.rotation.set(d.pitch + d.tilt * 0.15 + n1 * sh, d.yaw + n2 * sh, d.roll * 0.55, 'YXZ');
    const p = G.player;
    const fov = Math.min(110, Math.max(70, (p && p.baseFov ? p.baseFov : 75) + 14));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  /** Sprengung (offline/Host): Flug beenden, Explosion mit dem Besitzer als Angreifer (zählt als dessen Abschuss). */
  _droneExplode(d, pos) {
    const G = this.G;
    const P = d.params;
    const position = pos.clone();
    const own = d.role === 'pilot'; // Hörer saß bis eben in der Drohne: kein Gehör-Effekt (fremde Drohnen wie Granaten)
    d.position.copy(position);
    d.end('boom');
    if (!G.combat) return;
    G.combat.explode({
      position, radius: P.radius, maxDamage: P.maxDamage, minDamage: P.minDamage, innerRadius: P.innerRadius,
      attacker: d.owner || null, weaponId: 'drohne', type: 'drohne', concuss: own ? false : undefined,
    });
  }

  _onDroneEnd(d, why, by, opts = {}) {
    const G = this.G;
    if (d === this.pilot) this._endPilot(d, why);
    // Client: eigenen Flug beim Host beenden (Sprengung ist schon gemeldet; vom Host beendet → nichts zurück)
    if (this.replica && d.role === 'pilot' && !opts.fromHost && why !== 'boom' && why !== 'ende' && d.netId) this._sendDrone({ a: 'e', d: d.netId, why });
    // beendete Netz-Ids sperren (späte 'dr' legen sie nicht neu an) – nicht nach einem bloßen Ausbleiben der Lage (timeout)
    if (this.replica && d.netId && !opts.timeout) this._endedNet.set(d.netId, G.time.elapsed);
    // Client: eigene Sprengung gemeldet – lehnt der Host sie ab ('de' abgelehnt), ist die Drohne hier schon weg (applyNetDroneEnd)
    if (this.replica && d.role === 'pilot' && why === 'boom' && d.netId) this._boomSent = { id: d.netId, drone: d, at: G.time.elapsed };
    G.events.emit('drone:end', { drone: d, why, by: by || null, owner: d.owner, net: !!opts.fromHost });
  }

  /* ------------------------------------------------------------ Client (replica): Anfragen und Abbild */

  _sendDrone(msg) {
    const sync = this.G.net && this.G.net.sync;
    if (sync && typeof sync.sendDrone === 'function') sync.sendDrone(msg);
  }

  /** Prämie beim Host anfragen (Drohne: mit Startpunkt vor dem eigenen Kopf). */
  _request(id, target = null) {
    const G = this.G;
    const p = G.player;
    const sync = G.net && G.net.sync;
    if (this._pending || !sync || typeof sync.sendStreak !== 'function') return false;
    const msg = { id };
    if (target && Number.isFinite(target.x)) msg.t = [r2(target.x), r2(target.y), r2(target.z)];
    if (id === 'drohne') {
      const spot = launchSpot(G.world, p, _e);
      msg.p = [r2(spot.x), r2(spot.y), r2(spot.z)];
      msg.y = r3(p.yaw || 0);
      msg.pi = r3((p.pitch || 0) * 0.5);
    }
    this._pending = { id, at: G.time.elapsed };
    sync.sendStreak(msg);
    return true;
  }

  /** Eigener Treffer auf eine fremde Drohne (Client): Meldung an den Host, vorhergesagte Anzeige. */
  _claimDroneHit(d, amount, attacker, weaponId) {
    const G = this.G;
    if (attacker !== G.player || d.role !== 'replica' || !d.netId || !weaponId) return 0;
    this._sendDrone({ a: 'h', d: d.netId, w: weaponId, dmg: r2(amount), s: G.player._shotSerial | 0 });
    d._hitT = 0.15;
    return amount;
  }

  /** 'ev' sk: eigener Fortschritt laut Host { k, rd: [bereit], er: [verdient] }. */
  applyNetProgress(m) {
    const G = this.G;
    const p = G.player;
    if (!p || !m) return;
    const s = this._st(p);
    const ok = (id) => typeof id === 'string' && !!this.byId[id];
    const before = new Set(s.ready);
    s.kills = Math.max(0, m.k | 0);
    s.earned = new Set((Array.isArray(m.er) ? m.er : []).filter(ok));
    s.ready = (Array.isArray(m.rd) ? m.rd : []).filter(ok);
    for (const id of s.ready) if (!before.has(id)) G.events.emit('streak:ready', { actor: p, streakId: id, net: true });
    G.events.emit('streak:progress', { actor: p, value: s.kills, next: this._next(s), net: true });
  }

  /** 'ev' sa: Antwort auf die eigene Anfrage { id, ok, d (Netz-Id der Drohne), p, y, pi, bt }. */
  applyNetActivate(m) {
    const G = this.G;
    const p = G.player;
    this._pending = null;
    if (!m || !p || typeof m.id !== 'string') return;
    if (!m.ok) { G.events.emit('streak:refused', { actor: p, streakId: m.id, reason: 'host' }); return; }
    const s = this._st(p);
    const i = s.ready.indexOf(m.id);
    if (i >= 0) s.ready.splice(i, 1);
    if (m.id === 'drohne') {
      if (!p.alive || this.mode.isOver) { if (Number.isInteger(m.d)) this._sendDrone({ a: 'e', d: m.d, why: 'abbruch' }); return; }
      const def = this.byId.drohne;
      // eigener, frischer Startpunkt (der Host kennt die Lage etwas verspätet); weicht er ab, gilt der des Hosts
      const own = launchSpot(G.world, p, new THREE.Vector3());
      const host = vec(m.p);
      const pos = host && host.distanceTo(own) > 3 ? host : own;
      const d = this._launchDrone(p, def, { position: pos, yaw: p.yaw || 0, pitch: Number(m.pi) || 0, netId: m.d | 0, battery: Number(m.bt) || undefined });
      if (!d) { this._sendDrone({ a: 'e', d: m.d | 0, why: 'abbruch' }); return; }
      d._sendAt = -1; // sofort die erste Lage melden
    }
    if (m.id === 'uav' && Number.isFinite(m.r)) this._netUav(p, m.r);
    G.events.emit('streak:activate', { actor: p, streakId: m.id, target: null, net: true });
  }

  /** Abbild: Aufklärer der Seite von owner für r Sekunden (laut Host) – Sweeps laufen lokal in update(). */
  _netUav(owner, r) {
    const G = this.G;
    const now = G.time.elapsed;
    const key = this._uavKey(owner);
    const def = this.byId.uav;
    const cur = this.uav.get(key);
    const entry = cur && cur.until > now ? cur : { key, owner, until: now, nextSweep: now, sweepAt: now, blips: [], interval: (def && def.params && def.params.sweepInterval) || 2 };
    entry.owner = owner;
    entry.until = now + Math.max(0, Math.min(120, r));
    entry.nextSweep = Math.min(entry.nextSweep, now);
    this.uav.set(key, entry);
    G.events.emit('uav:state', { team: key, active: true, until: entry.until, owner });
  }

  /** 'ev' sv: Prämie eines anderen (Hinweis, Klang). */
  applyNetOther(m, byNetId) {
    const a = m && typeof byNetId === 'function' ? byNetId(m.o) : null;
    if (!a || a === this.G.player || typeof m.id !== 'string') return;
    if (m.id === 'uav' && Number.isFinite(m.r)) this._netUav(a, m.r);
    this.G.events.emit('streak:activate', { actor: a, streakId: m.id, target: m.id === 'strike' ? vec(m.p) : null, net: true });
  }

  /** 'ev' dr: Lage aller Drohnen [[netId, Besitzer-netId, x, y, z, yaw, pitch], …] (eigene fliegt lokal). */
  applyNetDrones(list, byNetId) {
    const G = this.G;
    if (!Array.isArray(list) || !this.byId.drohne) return;
    const now = G.time.elapsed;
    for (const [id, t] of this._endedNet) if (now - t > 10) this._endedNet.delete(id);
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 7) continue;
      const id = row[0] | 0;
      if (!id || this._endedNet.has(id) || (this.pilot && this.pilot.netId === id)) continue;
      const pos = vec([row[2], row[3], row[4]]);
      if (!pos) continue;
      let d = this._droneByNet(id);
      if (d && d.role !== 'replica') continue;
      if (!d) {
        const owner = typeof byNetId === 'function' ? byNetId(row[1] | 0) : null;
        if (!owner || owner === G.player) continue;
        d = new Drone(this, owner, { role: 'replica', position: pos, launch: pos, yaw: Number(row[5]) || 0, pitch: Number(row[6]) || 0, params: this.byId.drohne.params, netId: id });
        this.entities.push(d);
        this._installRaycast();
      }
      d.netUpdate(pos, Number(row[5]), Number(row[6]));
    }
  }

  /** 'ev' de: Ende einer Drohne laut Host { d, why, b (Schütze bei Abschuss) }. */
  applyNetDroneEnd(m, byNetId) {
    const G = this.G;
    if (!m || !Number.isInteger(m.d)) return;
    this._endedNet.set(m.d, G.time.elapsed);
    const why = typeof m.why === 'string' ? m.why.slice(0, 16) : 'ende';
    // Eigene Sprengung vom Host verworfen: die Drohne endete hier schon mit 'boom' (still) – Rückmeldung nachreichen (HUD)
    const sent = this._boomSent;
    if (sent && sent.id === m.d) {
      this._boomSent = null;
      if (why === 'abgelehnt' && G.time.elapsed - sent.at < 10) {
        G.events.emit('drone:end', { drone: sent.drone, why, by: null, owner: sent.drone.owner, net: true });
        return;
      }
    }
    const d = this._droneByNet(m.d);
    if (!d || !d.alive) return;
    const by = typeof byNetId === 'function' && m.b ? byNetId(m.b) : null;
    if (why === 'abschuss') G.events.emit('streak:destroyed', { streakId: 'drohne', entity: d, owner: d.owner, by, net: true });
    d.end(why, by, null, { fromHost: true, quiet: why === 'boom' || why === 'ende' });
  }

  /* ------------------------------------------------------------ Host: Meldungen eines Clients (net/sync-host.js) */

  /**
   * Lage der Drohne ('drone' p) prüfen und übernehmen: Weg-Budget (Schub × 1,5 je Sekunde Echtzeit, höchstens 1,2 s angespart),
   * Reichweite. Echtzeit: die Meldungen kommen in Echtzeit, das Gerät des Piloten fliegt höchstens so schnell. → { ok, reason }
   */
  netPose(owner, m) {
    const d = this._droneByNet(m && m.d);
    if (!d || d.owner !== owner || !d.alive || d.role !== 'remote') return { ok: false, reason: 'inaktiv' };
    const pos = vec(m.p);
    if (!pos) return { ok: false, reason: 'ungueltig' };
    const c = d.check;
    const now = realNow();
    const P = d.params;
    c.budget = Math.min(P.boost * 1.5 * 1.2, c.budget + Math.max(0, now - c.at) * P.boost * 1.5);
    c.at = now;
    const step = pos.distanceTo(c.pos);
    if (step > c.budget + 3 || pos.distanceTo(d.launch) > P.range + 10) {
      c.bad += 1;
      return { ok: false, reason: 'tempo', dist: Math.round(step * 10) / 10 };
    }
    // Weg durch eine Wand: die Lage bleibt kurz davor stehen (keine Wirkung dahinter, Sprengung von dort scheitert an
    // netDetonate). Hängt sie länger als 1,5 s (Grenzfall Ecke/Rundung), gilt die Meldung wieder – sonst stünde eine
    // ehrliche Drohne für alle still. Kein Verstoß (Toleranz).
    const tw = wallBetween(this.G.world, c.pos, pos);
    if (tw >= 0 && (!c.wallAt || now - c.wallAt < 1.5)) {
      if (!c.wallAt) c.wallAt = now;
      const stop = Math.max(0, tw - 0.3);
      _d.subVectors(pos, c.pos).normalize();
      c.pos.addScaledVector(_d, stop);
      c.budget = Math.max(0, c.budget - stop);
      d.netUpdate(c.pos, Number(m.y), Number(m.pi));
      return { ok: false, reason: 'wand' };
    }
    c.wallAt = 0;
    c.budget = Math.max(0, c.budget - step);
    c.pos.copy(pos);
    c.bad = 0;
    d.netUpdate(pos, Number(m.y), Number(m.pi));
    return { ok: true };
  }

  /**
   * Sprengung eines Clients ('drone' x) prüfen (Echtzeit): Drohne aktiv, Zeit seit Start ≤ Akku (Spielzeit des Piloten läuft auf
   * langsamen Geräten langsamer: × 2,2 + 3 s), Punkt erreichbar seit der letzten angenommenen Lage (Schub × Zeit, höchstens
   * 1 s, × 1,25 + 4 m),
   * Abstand zum Startpunkt ≤ Reichweite (+ 5 m), keine Wand dazwischen (wallBetween). Gültig → Explosion mit der Puppe als Angreifer; sonst endet die Drohne ohne
   * Wirkung ('abgelehnt'). → { ok, reason }
   */
  netDetonate(owner, m) {
    const d = this._droneByNet(m && m.d);
    if (!d || d.owner !== owner || !d.alive || d.role !== 'remote') return { ok: false, reason: 'inaktiv' };
    const P = d.params;
    const c = d.check;
    const now = realNow();
    const pos = vec(m.p);
    let reason = null;
    if (!pos) reason = 'ungueltig';
    else if (now - c.started > P.battery * this.netTimeFactor + 3) reason = 'akku';
    // Zeit seit der letzten Lage höchstens 1 s: der Pilot meldet seine Lage jedes Bild bzw. mit 15 Hz, geordnet vor der Sprengung –
    // eine längere Lücke heißt Stillstand (Bild hängt, Tab verdeckt), kein Weg; sonst reicht Lage-Zurückhalten für einen Sprung
    else if (pos.distanceTo(c.pos) > P.boost * Math.min(1, Math.max(0, now - c.at)) * 1.25 + 4) reason = 'weg';
    else if (pos.distanceTo(d.launch) > P.range + 5) reason = 'reichweite';
    else if (wallBetween(this.G.world, c.pos, pos) >= 0) reason = 'wand'; // Sprengpunkt hinter einer Wand
    if (reason) {
      d.end('abgelehnt', null, null, { quiet: true });
      return { ok: false, reason, dist: pos ? Math.round(pos.distanceTo(c.pos) * 10) / 10 : null };
    }
    this._droneExplode(d, pos);
    return { ok: true };
  }

  /** Flugende eines Clients ('drone' e). */
  netEnd(owner, m) {
    const d = this._droneByNet(m && m.d);
    if (!d || d.owner !== owner || !d.alive) return false;
    d.end(CLIENT_END.has(m.why) ? m.why : 'abbruch');
    return true;
  }

  /**
   * Treffer eines Clients auf eine Drohne ('drone' h { d, w, dmg, s }): Waffe in seiner Ausrüstung (weapons), Feuerrate
   * (je Schuss höchstens pellets Treffer), Reichweite und Sichtlinie vom Kopf der Puppe zu einer Lage der letzten 0,6 s;
   * Nahkampf bis zur Klingenreichweite + MELEE_SLACK (Latenz, wie anticheat meleeSlack). Projektile wirken über die
   * Explosion beim Host ('projektil', kein Verstoß). Schaden rechnet der Host (Abfall nach Entfernung, höchstens die
   * Meldung). → { ok, reason, dmg }
   */
  netHit(shooter, m, weapons = null) {
    const G = this.G;
    const d = this._droneByNet(m && m.d);
    if (!d || !d.alive || !shooter || !shooter.alive || !d._hostile(shooter)) return { ok: false, reason: 'ziel' };
    const def = WEAPONS[m.w];
    if (!def || (weapons && !weapons.includes(def.id))) return { ok: false, reason: 'waffe' };
    if (def.projectile) return { ok: false, reason: 'projektil' };
    const melee = def.cls === 'melee';
    const now = realNow(); // Feuerrate in Echtzeit (Meldungen kommen in Echtzeit)
    const serial = Number.isFinite(m.s) ? m.s | 0 : -1;
    const rec = this._hitRec.get(shooter) || { serial: -2, n: 0, at: -1e9 };
    const gap = (60 / Math.max(1, def.rpm || 600)) * 0.7;
    if (serial === rec.serial && serial >= 0) {
      if (rec.n >= Math.max(1, def.pellets || 1)) return { ok: false, reason: 'doppelt' };
      rec.n += 1;
    } else {
      if (now - rec.at < gap) return { ok: false, reason: 'feuerrate' };
      rec.serial = serial; rec.n = 1; rec.at = now;
    }
    this._hitRec.set(shooter, rec);
    shooter.getEyePosition(_e);
    const w = G.world;
    const range = melee ? ((def.melee && def.melee.range) || def.range || 2.5) + MELEE_SLACK : (def.range || 100) * 1.05 + 2;
    let best = Infinity;
    const test = (x, y, z) => {
      _v.set(x, y, z);
      const dist = _v.distanceTo(_e);
      if (dist > range || dist >= best) return;
      if (w && w.lineOfSight && !w.lineOfSight(_e, _v)) return;
      best = dist;
    };
    test(d.position.x, d.position.y, d.position.z);
    const simNow = G.time.elapsed;
    for (const h of d.check.hist) if (simNow - h[0] <= 0.6) test(h[1], h[2], h[3]);
    if (!Number.isFinite(best)) return { ok: false, reason: 'sicht' };
    const claimed = Number(m.dmg);
    let dmg = falloff(def, best);
    if (Number.isFinite(claimed) && claimed > 0) dmg = Math.min(dmg, claimed);
    const dealt = d.applyDamage(dmg, shooter, def.id);
    if (dealt > 0) G.events.emit('streak:hit', { entity: d, attacker: shooter, amount: dealt, destroyed: !d.alive });
    return { ok: true, dmg: dealt };
  }

  /** Host: Lage aller Drohnen für die Weitergabe ('ev' dr). */
  netDroneList() {
    const out = [];
    for (const e of this.entities) {
      if (e.kind !== 'drohne' || !e.alive || !e.netId) continue;
      const o = e.owner && Number.isInteger(e.owner.netId) ? e.owner.netId : 0;
      if (!o) continue;
      out.push([e.netId, o, r2(e.position.x), r2(e.position.y), r2(e.position.z), r3(e.yaw), r3(e.pitch)]);
    }
    return out;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
/** m Zusatzreichweite für Nahkampftreffer eines Clients auf eine Drohne (Latenz; wie net/anticheat.js meleeSlack). */
const MELEE_SLACK = 1.75;
const r3 = (v) => Math.round(v * 1000) / 1000;
