// NULLPUNKT — VehicleSystem (`G.vehicles`, GROSSKAMPF_PLAN §6/§12): Spawn-Verwaltung mit Wiedererscheinen,
// Takt aller Fahrzeuge, Sitze (Ein-/Aussteigen, Schutz geschützter Sitze), Fahrzeuge als dynamische Hindernisse für
// Akteure (Hinausschieben, Überfahren, Draufstehen), Fahrzeug-gegen-Fahrzeug (OBB/SAT), Treffer über
// world.raycast-Hülle (Kugeln → impact), Explosionen, Kanonen-Granaten, Spieler-Steuerung/Kamera/HUD/Klang.
//
// Lebenszyklus: new VehicleSystem(G) beim Start; attach(G) je Match (nach Welt/Bots), update(dt) je Frame
// (nach bots, vor weapons), updateOccupant(player, dt) statt player.update, solange der Spieler sitzt; detach().
import * as THREE from 'three';
import { VEHICLES, VEHICLE_WEAPONS, VEHICLE_CAUSES, VEHICLE_IDS, respawnFor } from './data.js';
import { Vehicle, newIntent } from './vehicle.js';
import { ShellPool, raycastActors } from './projectiles.js';
import { VehicleCamera, dirFromYawPitch } from './camera.js';
import { readPlayerControls } from './controls.js';
import { VehicleHUD, projectToScreen } from './hud.js';
import { VehicleAudio } from './audio.js';
import { upgradeVehicleMaterials, vehicleMaterials } from './materials.js';
import { prepareVehicleModels } from './models.js';
import { groundRay } from './sim.js';
import { collisionRay, canOccupy } from '../engine/physics.js';
import { falloff } from '../combat.js';

export { VEHICLES, VEHICLE_WEAPONS, VEHICLE_IDS, Vehicle };

const CAP = { low: 6, medium: 10, high: 16, ultra: 20 };
const STAND_H = 1.8, SEAT_H = 1.15;
const REACH = 1.7;
const NULL_HITBOX = () => null;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _hit = {}, DOWN = new THREE.Vector3(0, -1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

const ICONS = {
  shell: '<svg viewBox="0 0 48 24" fill="currentColor"><path d="M4 13h7l3-5h14l2 3h14v3H30l-2 3H6z"/><rect x="9" y="17" width="26" height="4" rx="2"/></svg>',
  mg: '<svg viewBox="0 0 48 24" fill="currentColor"><path d="M3 10h30v4H3zM33 8h8v8h-8zM18 14h4v6h-4z"/></svg>',
  wheel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',
  boom: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2 6 6-2-3 5 5 3-6 1 1 6-5-4-5 4 1-6-6-1 5-3-3-5 6 2z"/></svg>',
};

export class VehicleSystem {
  constructor(G) {
    this.G = G;
    this.list = [];
    this.spawns = [];
    this.attached = false;
    this.live = false;
    this.world = null;
    this.camera = new VehicleCamera();
    this.camMode = 'tp';
    this.shells = new ShellPool(this);
    this.hud = null;
    this.audio = new VehicleAudio(G);
    this._own = 0;
    this._vehHits = [];
    this._ignore = null;
    this._rc = null;
    this._offs = [];
    this._near = null;
    this._enterT = -1e9;
    this._exitT = -1e9;
    this._seatT = 0;
    this._gunScr = { x: 0, y: 0, on: false, ready: false };
    this._stats = { steps: 0, ms: 0 };
  }

  /* =============================================================== Lebenszyklus */

  attach(G = this.G) {
    if (this.attached) this.detach();
    this.G = G;
    this.world = G.world;
    if (!this.world) return;
    this.attached = true;
    this.quality = (G.renderer && G.renderer.quality) || 'high';
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    G.scene.add(this.group);
    this.shells.attach(this.group);
    this._installRaycast();
    const ev = G.events;
    this._offs = [
      ev.on('impact', (e) => this._onImpact(e)),
      ev.on('explosion', (e) => this._onExplosion(e)),
      ev.on('kill', (e) => this._onKill(e)),
      ev.on('actor:spawn', (e) => { if (e && e.actor && e.actor.vehicle) this.removeFromSeat(e.actor, { teleport: false }); }),
      ev.on('vehicle:damaged', (e) => { if (e.vehicle === (G.player && G.player.vehicle) && e.kind !== 'fire') this.hud && this.hud.damaged(); }),
      ev.on('vehicle:hit', (e) => { if (e.attacker && e.attacker === G.player) this.hud && this.hud.hit(); }),
    ];
    try { this.hud = new VehicleHUD(G); } catch (err) { this.hud = null; console.warn('[vehicles] HUD nicht verfügbar', err); }
    this.camera.reset();
    // Ein gemeinsamer Scheinwerfer für das Fahrzeug des Spielers (medium+; immer vorhanden → keine Shader-Wechsel)
    if (this.quality !== 'low') {
      this.spot = new THREE.SpotLight(0xffe6c0, 0, 55, 0.5, 0.55, 1.6);
      this.spot.castShadow = false;
      this.spot.name = 'vehicle-headlight';
      this.group.add(this.spot, this.spot.target);
    }
    this._setupSpawns();
    if (this.list.length || this.spawns.length) {
      upgradeVehicleMaterials(G.renderer && G.renderer.renderer, this.quality);
      // Shader vorwärmen (main.warmUp kompiliert sichtbare Szenenobjekte): Granate, Scheinwerfer an, Lichtkegel, Wrack
      const S = vehicleMaterials();
      const warm = new THREE.Group();
      warm.name = 'vehicle-warmup';
      warm.position.set(0, -9999, 0);
      const g = new THREE.BoxGeometry(0.01, 0.01, 0.01);
      for (const m of [this.shells.mat, S.lensOn, S.cone, S.wreck]) warm.add(new THREE.Mesh(g, m));
      this.group.add(warm);
    }
  }

  detach() {
    if (!this.attached) return;
    const G = this.G;
    for (const v of this.list) for (const s of v.seats) if (s.actor) this.removeFromSeat(s.actor, { teleport: false });
    for (const v of this.list) v.dispose();
    this.list.length = 0;
    this.spawns.length = 0;
    this.shells.clear();
    if (this.spot) { this.spot.removeFromParent(); this.spot.target.removeFromParent(); this.spot.dispose?.(); this.spot = null; }
    if (this.group) { this.group.removeFromParent(); this.group = null; }
    this._uninstallRaycast();
    for (const off of this._offs) try { off(); } catch { /* bereits gelöst */ }
    this._offs = [];
    if (this.hud) { this.hud.dispose(); this.hud = null; }
    this.audio.stopAll();
    this._near = null;
    this.attached = false;
    this.world = null;
    void G;
  }

  /* =============================================================== Spawns */

  /** Spawn-Punkt anmelden (erscheint sofort und nach Zerstörung erneut). → Spawn-Eintrag */
  registerSpawn({ type, position, yaw = 0, team = null, respawn = null }) {
    if (!VEHICLES[type]) return null;
    const sp = { type, position: position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z), yaw, team, respawn: respawn ?? respawnFor(type), vehicle: null, respawnAt: null };
    this.spawns.push(sp);
    this._spawnAt(sp);
    return sp;
  }

  _spawnAt(sp) {
    if (this.list.length >= (CAP[this.quality] || 16)) { sp.respawnAt = this.G.time.elapsed + 5; return null; }
    const v = this.spawnVehicle(sp.type, sp.position, sp.yaw, sp.team, { spawn: sp });
    sp.vehicle = v;
    sp.respawnAt = null;
    return v;
  }

  /** Fahrzeug erzeugen (Modi/Tests/Bots). position = Bodenpunkt unter der Wannenmitte. */
  spawnVehicle(type, position, yaw = 0, team = null, { spawn = null } = {}) {
    if (!this.attached) return null;
    const pos = position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z);
    const v = new Vehicle(this, type, { position: pos, yaw, team, quality: this.quality, spawn });
    this.list.push(v);
    this.group.add(v.model.root);
    v.sync(0);
    this.G.events.emit('vehicle:spawn', { vehicle: v });
    return v;
  }

  /** Fahrzeug entfernen (Insassen steigen aus; Spawn startet den Wiedererscheinen-Zähler). */
  removeVehicle(v) {
    const i = this.list.indexOf(v);
    if (i < 0) return;
    for (const s of v.seats) if (s.actor) this.removeFromSeat(s.actor, { teleport: true });
    this.list.splice(i, 1);
    v.dispose();
    if (v.spawn && v.spawn.vehicle === v) { v.spawn.vehicle = null; v.spawn.respawnAt = this.G.time.elapsed + Math.max(3, v.spawn.respawn - v.def.wreckTime); }
    this.G.events.emit('vehicle:removed', { vehicle: v });
  }

  _setupSpawns() {
    const G = this.G, w = this.world;
    const param = G.params && typeof G.params.get === 'function' ? G.params.get('vehicles') : null;
    let entries = Array.isArray(w.vehicleSpawns) ? w.vehicleSpawns : null;
    if (param === '0') entries = null;
    else if (!entries && (param === '1' || (G.match && G.match.vehicles))) entries = this.autoSpawns();
    if (!entries || !entries.length) return;
    entries = entries.filter((e) => e && VEHICLES[e.type] && !e.secret);
    // Reihum je Team anmelden: bei der Stufen-Obergrenze (Handy) bekommen beide Seiten gleich viele Fahrzeuge
    const byTeam = new Map();
    for (const e of entries) { const k = e.team ?? null; if (!byTeam.has(k)) byTeam.set(k, []); byTeam.get(k).push(e); }
    const order = [];
    for (let i = 0; order.length < entries.length; i++) for (const list of byTeam.values()) if (list[i]) order.push(list[i]);
    prepareVehicleModels([...new Set(order.map((e) => e.type))], [...byTeam.keys()], this.quality);
    for (const e of order) this.registerSpawn(e);
  }

  /** Automatische Aufstellung (Karten ohne vehicleSpawns): je Team ein Kampfpanzer und ein Geländewagen nahe der Basis. */
  autoSpawns() {
    const w = this.world, out = [];
    const ffa = this.G.match && this.G.match.ffa;
    const teams = ffa ? [null] : ['A', 'B'];
    const center = w.bounds ? w.bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const placed = [];
    for (const team of teams) {
      const list = (w.spawns && (team ? w.spawns[team] : w.spawns.ffa)) || [];
      const anchor = new THREE.Vector3();
      if (list.length) { for (const s of list) anchor.add(s.position); anchor.multiplyScalar(1 / list.length); } else anchor.copy(center);
      for (const type of ['mbt', 'jeep']) {
        const spot = this.findSpot(anchor, type, { avoid: placed, avoidSpawns: true, toward: center });
        if (spot) { out.push({ type, position: spot.position, yaw: spot.yaw, team }); placed.push(spot.position); }
      }
    }
    return out;
  }

  /**
   * Freien, ebenen Stellplatz nahe `near` suchen (Spirale bis maxR). → { position, yaw } | null
   * opts: { avoid: Vector3[], avoidSpawns, toward: Vector3 (Ausrichtung), maxR = 45 }
   */
  findSpot(near, type, { avoid = [], avoidSpawns = false, toward = null, maxR = 45 } = {}) {
    const w = this.world, def = VEHICLES[type];
    if (!w || !def) return null;
    const hb = def.hullBox;
    const spawnPts = avoidSpawns && w.spawns ? [...(w.spawns.A || []), ...(w.spawns.B || []), ...(w.spawns.ffa || [])].map((s) => s.position) : [];
    const top = (w.bounds ? w.bounds.max.y : near.y + 30) + 2;
    for (let r = 0; r <= maxR; r += 3) {
      const steps = r === 0 ? 1 : Math.max(8, Math.round((r * Math.PI * 2) / 4));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2 + r * 0.37;
        const x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
        if (w.bounds && (x < w.bounds.min.x + 4 || x > w.bounds.max.x - 4 || z < w.bounds.min.z + 4 || z > w.bounds.max.z - 4)) continue;
        const g = groundRay(w, _a.set(x, top, z), DOWN, top - (w.bounds ? w.bounds.min.y : -10) + 5, _hit);
        if (!g || g.ny < 0.92) continue;
        const gy = top - g.distance;
        if (Math.abs(gy - near.y) > 4) continue;
        const pos = new THREE.Vector3(x, gy, z);
        if (avoid.some((p) => p.distanceTo(pos) < 10)) continue;
        if (spawnPts.some((p) => Math.hypot(p.x - x, p.z - z) < hb[5] + 3)) continue;
        if (this.list.some((v) => v.body.pos.distanceTo(pos) < 9)) continue;
        const yaw = toward ? Math.atan2(-(toward.x - x), -(toward.z - z)) : 0;
        if (this._clear(pos, yaw, def)) return { position: pos, yaw };
      }
    }
    return null;
  }

  /** Grundfläche frei und eben? (Eckpunkte gleiche Bodenhöhe, Strahlen von der Mitte zu Ecken/Kanten frei) */
  _clear(pos, yaw, def) {
    const w = this.world, hb = def.hullBox;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const toW = (lx, lz, y, out) => out.set(pos.x + lx * cy + lz * sy, pos.y + y, pos.z - lx * sy + lz * cy);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      toW(lx * (hb[3] + 0.3), lz * (hb[5] + 0.3), 3, _a);
      const g = groundRay(w, _a, DOWN, 6, _hit);
      if (!g || Math.abs(3 - g.distance) > 0.5) return false;
    }
    for (const y of [0.6, 1.6, 2.6]) {
      toW(0, 0, y, _b);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        toW(lx * (hb[3] + 0.6), lz * (hb[5] + 0.6), y, _a);
        _c.copy(_a).sub(_b);
        const len = _c.length();
        _c.multiplyScalar(1 / len);
        if (collisionRay(w, _b, _c, len, _hit)) return false;
      }
    }
    return true;
  }

  /** Test-/Konsolenhilfe: Fahrzeug vor einem Akteur aufstellen. */
  spawnNear(actor, type = 'jeep', team = actor ? actor.team : null) {
    if (!this.attached || !actor) return null;
    const f = _d.set(-Math.sin(actor.yaw || 0), 0, -Math.cos(actor.yaw || 0));
    const near = actor.position.clone().addScaledVector(f, 8);
    const spot = this.findSpot(near, type, { toward: actor.position.clone().addScaledVector(f, 40), maxR: 30 });
    if (!spot) return null;
    return this.spawnVehicle(type, spot.position, spot.yaw, team);
  }

  /* =============================================================== Sitze */

  /** Einsteigen. → Sitzindex | −1 */
  enter(actor, v, seatIdx = null) {
    if (!actor || !actor.alive || !v || !v.alive || actor.vehicle || !this.attached) return -1;
    if (v.isOccupied && v.team != null && actor.team != null && v.team !== actor.team) return -1;
    let idx = seatIdx;
    if (idx == null || idx < 0 || idx >= v.seats.length || v.seats[idx].actor) idx = v.seats.findIndex((s) => !s.actor);
    if (idx < 0) return -1;
    this._seat(actor, v, idx);
    if (actor.isPlayer) this._playerEnter(actor, v);
    v.body.wake();
    this.G.events.emit('vehicle:enter', { vehicle: v, actor, seat: idx });
    return idx;
  }

  _seat(actor, v, idx) {
    const seat = v.seats[idx];
    seat.actor = actor;
    seat.intent = newIntent();
    seat.intent.fireWhenAligned = !actor.isPlayer;
    seat.zoomIndex = 0;
    actor.vehicle = v;
    actor.seat = idx;
    actor.vehicleSeat = seat;
    // Schutz: geschützte Sitze unverwundbar und ohne Trefferzonen (Kugeln treffen die Wanne); offene Sitze geduckt
    if (!actor._veh) {
      actor._veh = {
        inv: actor.invulnerable, hb: Object.prototype.hasOwnProperty.call(actor, 'raycastHitboxes') ? actor.raycastHitboxes : undefined,
      };
    }
    if (seat.def.exposed) {
      actor.invulnerable = actor._veh.inv;
      if (actor._veh.hb === undefined) delete actor.raycastHitboxes; else actor.raycastHitboxes = actor._veh.hb;
      actor.body && actor.body.setHeight && actor.body.setHeight(SEAT_H);
    } else {
      actor.invulnerable = true;
      actor.raycastHitboxes = NULL_HITBOX;
    }
    if (actor.body && actor.body.velocity) actor.body.velocity.set(0, 0, 0);
    const L = seat.look;
    L.yaw = Number.isFinite(actor.yaw) ? actor.yaw : v.yaw;
    L.pitch = clamp(actor.pitch || 0, -0.5, 0.6);
    L.relYaw = 0; L.relPitch = -0.05; L.idle = 0;
  }

  _unseat(actor) {
    const v = actor.vehicle;
    if (v) {
      const i = v.seatOf(actor);
      if (i >= 0) { v.seats[i].actor = null; v.seats[i].intent = newIntent(); }
    }
    actor.vehicle = null;
    actor.seat = null;
    actor.vehicleSeat = null;
    const sv = actor._veh;
    if (sv) {
      actor.invulnerable = sv.inv;
      if (sv.hb === undefined) delete actor.raycastHitboxes; else actor.raycastHitboxes = sv.hb;
      actor._veh = null;
    }
    if (actor.body && actor.body.setHeight) actor.body.setHeight(STAND_H);
  }

  /** Aussteigen am freien Ausstiegspunkt. → bool (false: blockiert) */
  exit(actor) { return this.removeFromSeat(actor, { teleport: true }); }

  /** Sitz verlassen; teleport: an einen freien Ausstiegspunkt setzen (sonst bleibt der Körper, z. B. tot). */
  removeFromSeat(actor, { teleport = true } = {}) {
    const v = actor && actor.vehicle;
    if (!v) return false;
    const idx = v.seatOf(actor);
    let pos = null;
    if (teleport) {
      pos = this._findExit(v, idx);
      if (!pos) return false;
    }
    this._unseat(actor);
    if (pos && actor.body) {
      if (typeof actor.body.teleport === 'function') actor.body.teleport(pos); else actor.body.position.copy(pos);
      if (actor.body.velocity) actor.body.velocity.copy(v.body.vel).multiplyScalar(0.5).setY(Math.max(0, v.body.vel.y));
    }
    if (actor.isPlayer) this._playerExit(actor, v);
    this.G.events.emit('vehicle:exit', { vehicle: v, actor, seat: idx });
    return true;
  }

  /** Sitz wechseln (1–6). → bool */
  switchSeat(actor, idx) {
    const v = actor && actor.vehicle;
    if (!v || idx < 0 || idx >= v.seats.length || v.seats[idx].actor) return false;
    const from = v.seatOf(actor);
    if (from === idx) return false;
    v.seats[from].actor = null;
    v.seats[from].intent = newIntent();
    this._seat(actor, v, idx);
    if (actor.isPlayer) { this.camera.reset(); this._enterT = this.G.time.elapsed; }
    this.G.events.emit('vehicle:seat', { vehicle: v, actor, from, seat: idx });
    return true;
  }

  _findExit(v, idx) {
    const w = this.world, seat = v.seats[idx];
    // walls 2: mehr Ausweichpunkte (Diagonalen, weiter außen) – an Gelände-/Mauerkanten (Grenzland-Panzer) war sonst
    // gelegentlich kein Punkt frei
    const cands = [...(seat ? seat.def.exit : []), [-3, 0, 0], [3, 0, 0], [0, 0, -5], [0, 0, 5],
      [-3.6, 0, -2.6], [3.6, 0, -2.6], [-3.6, 0, 2.6], [3.6, 0, 2.6], [-4.4, 0, 0], [4.4, 0, 0], [0, 0, -6.2], [0, 0, 6.2]];
    v.center(_c);
    for (const e of cands) {
      _a.fromArray(e);
      v.body.toWorld(_a, _a);
      const g = groundRay(w, _b.set(_a.x, _a.y + 2.5, _a.z), DOWN, 6, _hit);
      if (!g) continue;
      const pos = new THREE.Vector3(_a.x, _a.y + 2.5 - g.distance + 0.05, _a.z);
      // Weg vom Fahrzeug zum Ausstieg frei (Brusthöhe), Kopf frei
      _b.set(pos.x, pos.y + 1.2, pos.z);
      _d.copy(_b).sub(_c);
      const len = _d.length();
      if (len > 1e-3 && collisionRay(w, _c, _d.multiplyScalar(1 / len), len, _hit)) continue;
      if (collisionRay(w, _b, _n.set(0, 1, 0), 0.7, _hit)) continue;
      // walls: Körper ab Stufenhöhe frei (keine Wand/Kante im Ausstiegspunkt; Hänge und Bordsteine zählen nicht)
      if (!canOccupy(w, new THREE.Vector3(pos.x, pos.y + 0.42, pos.z), 1.38, 0.34)) continue;
      if (this.list.some((o) => o !== v && o.raycast(_b.clone().add(_n.set(0, 3, 0)), DOWN, 3.2))) continue;
      return pos;
    }
    if (!v.alive) return v.body.pos.clone().add(_n.set(0, 2.5, 0));
    return null;
  }

  _playerEnter(player, v) {
    const G = this.G;
    if (G.viewmodel && G.viewmodel.scene) G.viewmodel.scene.visible = false;
    const input = G.input;
    if (input) {
      input.cancelAds && input.cancelAds();
      if (input.setActive) { input.setActive('lean_left', false); input.setActive('lean_right', false); input.setActive('ads', false); }
    }
    player.sprinting = player.sliding = false;
    player.crouching = false;
    // Infanteriewaffe ruht: kein hängender Zielzustand (Empfindlichkeit/HUD lesen adsProgress)
    try { if (player.weapon && 'adsProgress' in player.weapon) player.weapon.adsProgress = 0; } catch { /* nur Getter */ }
    this.camera.reset();
    this.camera.mode = this.camMode;
    this._enterT = G.time.elapsed;
    void v;
  }

  _playerExit(player, v) {
    const G = this.G;
    if (G.viewmodel && G.viewmodel.scene) G.viewmodel.scene.visible = !!player.alive;
    const d = this.camera.dir;
    if (player.alive && d) {
      player.yaw = Math.atan2(-d.x, -d.z);
      player.pitch = clamp(Math.asin(clamp(d.y, -1, 1)), -1.2, 1.2);
    }
    this.camera.reset();
    if (this.spot) this.spot.intensity = 0;
    this._exitT = G.time.elapsed;
    void v;
  }

  /* =============================================================== Spieler im Fahrzeug */

  /** Ersetzt player.update(dt), solange der Spieler sitzt (main.js). */
  updateOccupant(player, dt) {
    const G = this.G, v = player.vehicle;
    if (!v || !this.attached) { player.vehicle = null; player.update(dt); return; }
    const idx = v.seatOf(player);
    if (idx < 0) { this._unseat(player); player.update(dt); return; }
    const seat = v.seats[idx];
    const frozen = !G.match || G.match.state !== 'playing';
    const act = readPlayerControls(G.input, v, seat, dt, { frozen });
    // Zielen: Optik → Blickrichtung; 3P → Bildmitte-Strahl (Rohr konvergiert auf den Zielpunkt)
    if (seat.def.mount) {
      const dir = dirFromYawPitch(seat.look.yaw, seat.look.pitch, _d);
      if (this.camera.sight || !this.camera.ready) {
        seat.intent.aimDir = (seat.intent.aimDir || new THREE.Vector3()).copy(dir);
        seat.intent.aimAt = null;
      } else {
        const from = G.camera.position;
        this._ignore = v;
        const h = this.world.raycast(from, dir, 700);
        this._ignore = null;
        const p = h && h.distance > 4 ? h.point : _a.copy(from).addScaledVector(dir, 700);
        seat.intent.aimAt = (seat.intent.aimAt || new THREE.Vector3()).copy(p);
        seat.intent.aimDir = null;
      }
    }
    // Lebensregeneration wie zu Fuß (3,5 s nach Schaden, 55 HP/s)
    if (player.alive && player.health < player.maxHealth && G.time.elapsed - (player.lastDamageTime ?? -1e9) > 3.5) {
      player.health = Math.min(player.maxHealth, player.health + 55 * dt);
    }
    if (frozen) return;
    if (act.exit && G.time.elapsed - this._enterT > 0.35) {
      if (!this.exit(player)) this._flash('Ausstieg blockiert');
      return;
    }
    if (act.camera) { this.camMode = this.camera.mode = this.camera.mode === 'tp' ? 'fp' : 'tp'; }
    if (act.lights && seat.def.drive) v.lights = !v.lights;
    if (G.time.elapsed - this._seatT > 0.4) {
      let to = act.seatTo;
      if (to == null && act.nextSeat) {
        for (let k = 1; k <= v.seats.length; k++) { const j = (idx + k) % v.seats.length; if (!v.seats[j].actor) { to = j; break; } }
      }
      if (to != null && to !== idx) { if (this.switchSeat(player, to)) this._seatT = G.time.elapsed; else this._flash('Sitz besetzt'); }
    }
  }

  _flash(text) { this._msg = { text, until: this.G.time.elapsed + 1.6 }; }

  /* =============================================================== Takt */

  update(dt) {
    if (!this.attached) return;
    const G = this.G, world = this.world;
    const t0 = performance.now();
    this.live = !!G.match && G.match.state === 'playing';
    const now = G.time.elapsed;
    // Wiedererscheinen
    for (const sp of this.spawns) {
      if (sp.vehicle || sp.respawnAt == null || now < sp.respawnAt) continue;
      if (this.list.some((v) => v.body.pos.distanceTo(sp.position) < 8)) { sp.respawnAt = now + 2; continue; }
      this._spawnAt(sp);
    }
    for (const v of this.list) v.update(dt, world);
    this._collideVehicles();
    this._collideActors(dt);
    this.shells.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (v.wreck && v.wreckLeft <= 0) this.removeVehicle(v);
    }
    for (const v of this.list) { v.sync(dt); this._pinOccupants(v); }
    this._updatePlayer(dt);
    this.audio.update(dt, this.list, G.player && G.player.vehicle);
    this._stats.ms = performance.now() - t0;
  }

  _pinOccupants(v) {
    for (const s of v.seats) {
      const a = s.actor;
      if (!a || !a.body) continue;
      v.seatPosition(s.index, a.body.position, true);
      if (a.body.velocity) a.body.velocity.set(0, 0, 0);
      a.body.onGround = true;
      if (!a.isPlayer) {
        // Blickrichtung der Bots: Lafette bzw. Fahrtrichtung
        const yaw = s.def.mount ? v.yaw + (s.def.mount === 'gun' ? v.mount.turretYaw : s.def.mount === 'cmg' ? v.mount.turretYaw + v.mount.cmgYaw : v.mount.mgYaw) : v.yaw;
        a.yaw = wrap(yaw);
      }
    }
  }

  _updatePlayer(dt) {
    const G = this.G, p = G.player;
    if (!p) return;
    const seated = !!p.vehicle;
    let state = { seated, visible: !!G.match && (G.match.state === 'playing' || G.match.state === 'countdown') && p.alive, keyFor: (a) => this._key(a) };
    if (seated) {
      const v = p.vehicle, seat = v.seats[v.seatOf(p)];
      if (!seat) return;
      const r = this.camera.update(G.camera, v, seat, dt, this.world, p.baseFov || 70);
      const d = this.camera.dir;
      p.yaw = Math.atan2(-d.x, -d.z);
      p.pitch = Math.asin(clamp(d.y, -1, 1));
      // Rohr-Marker: wohin die Waffe tatsächlich zeigt
      let gun = null;
      if (seat.def.mount && seat.weapons.length) {
        v.muzzle(seat.index, _a, _b, true);
        const w = seat.weapons[seat.weaponIndex];
        const range = w.def.kind === 'shell' ? 400 : w.def.range;
        this._ignore = v;
        const h = this._rc ? this._rc.orig.call(this.world, _a, _b, range) : null;
        this._ignore = null;
        _c.copy(_a).addScaledVector(_b, h ? h.distance : range);
        gun = projectToScreen(G, _c, this._gunScr);
        gun.ready = w.mag > 0 && w.reloadT <= 0;
      }
      // Scheinwerfer folgt dem Fahrzeug des Spielers
      if (this.spot) {
        const on = v.lights && v.alive;
        this.spot.intensity = on ? 38 : 0;
        if (on) {
          v.body.toWorldRender(_a.set(0, 1.3, v.def.hullBox[2] - v.def.hullBox[5]), this.spot.position);
          v.body.toWorldRender(_a.set(0, 0, v.def.hullBox[2] - v.def.hullBox[5] - 18), this.spot.target.position);
          this.spot.target.updateMatrixWorld();
        }
      }
      Object.assign(state, { vehicle: v, seat, sight: r.sight, zoom: r.zoom, gunScreen: gun });
    } else {
      if (this.spot) this.spot.intensity = 0;
      // Einsteigen in Reichweite?
      this._near = p.alive ? this._nearestEnterable(p) : null;
      if (this._near) {
        const v = this._near;
        const idx = v.seats.findIndex((s) => !s.actor);
        state.near = { vehicle: v, seatLabel: v.seats[idx].def.label };
        const input = G.input;
        // nicht im selben Tastendruck wieder einsteigen, mit dem gerade ausgestiegen wurde
        if (this.live && input && G.time.elapsed - this._exitT > 0.4 && (input.pressed('interact') || input.pressed('v_enter'))) this.enter(p, v);
      }
    }
    if (this._msg && G.time.elapsed > this._msg.until) this._msg = null;
    if (this.hud) {
      this.hud.update(dt, state);
      if (this._msg && this.hud.el) { this.hud._set('warn', this.hud.el.warn, 'text', this._msg.text); this.hud._set('warnH', this.hud.el.warn, 'hidden', false); }
    }
  }

  _key(action) {
    const input = this.G.input;
    if (!input || typeof input.label !== 'function') return null;
    try { return input.label(action) || null; } catch { return null; }
  }

  /** Nächstes Fahrzeug mit freiem Sitz in Griffweite des Akteurs. */
  _nearestEnterable(actor) {
    let best = null, bd = REACH;
    for (const v of this.list) {
      if (!v.alive || !v.freeSeats().length) continue;
      if (v.isOccupied && v.team != null && actor.team != null && v.team !== actor.team) continue;
      if (v.body.pos.distanceToSquared(actor.position) > 100) continue;
      const d = this._boxDistance(v, actor.position, 0.9);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Abstand eines Punkts (+ Höhe h) zur Wanne (0 = innen). */
  _boxDistance(v, p, h = 0) {
    const hb = v.def.hullBox;
    v.body.toLocal(_a.set(p.x, p.y + h, p.z), _a);
    const dx = Math.max(0, Math.abs(_a.x - hb[0]) - hb[3]);
    const dy = Math.max(0, Math.abs(_a.y - hb[1]) - hb[4] - 0.4);
    const dz = Math.max(0, Math.abs(_a.z - hb[2]) - hb[5]);
    return Math.hypot(dx, dy, dz);
  }

  /* =============================================================== Kollisionen */

  _collideVehicles() {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        const A = L[i], B = L[j];
        const ha = A.def.hullBox, hbx = B.def.hullBox;
        const ra = Math.hypot(ha[3], ha[5]), rb = Math.hypot(hbx[3], hbx[5]);
        const pa = A.body.toWorld(_a.set(ha[0], ha[1], ha[2]), _a), pb = B.body.toWorld(_b.set(hbx[0], hbx[1], hbx[2]), _b);
        const dx = pb.x - pa.x, dz = pb.z - pa.z;
        if (dx * dx + dz * dz > (ra + rb) * (ra + rb)) continue;
        if (Math.abs(pb.y - pa.y) > ha[4] + hbx[4]) continue;
        // SAT in XZ mit den Gierachsen beider Wannen
        const ya = A.body.yaw(), yb = B.body.yaw();
        const axes = [[Math.cos(ya), -Math.sin(ya)], [Math.sin(ya), Math.cos(ya)], [Math.cos(yb), -Math.sin(yb)], [Math.sin(yb), Math.cos(yb)]];
        const ext = (yaw, h, ax) => Math.abs(h[3] * (Math.cos(yaw) * ax[0] - Math.sin(yaw) * ax[1])) + Math.abs(h[5] * (Math.sin(yaw) * ax[0] + Math.cos(yaw) * ax[1]));
        let minO = Infinity, nx = 0, nz = 0;
        let sep = false;
        for (const ax of axes) {
          const dist = dx * ax[0] + dz * ax[1];
          const o = ext(ya, ha, ax) + ext(yb, hbx, ax) - Math.abs(dist);
          if (o <= 0) { sep = true; break; }
          if (o < minO) { minO = o; const s = dist >= 0 ? 1 : -1; nx = ax[0] * s; nz = ax[1] * s; }
        }
        if (sep) continue;
        const ma = A.body.mass, mb = B.body.mass, mt = ma + mb;
        _n.set(nx, 0, nz);
        A.body.pos.addScaledVector(_n, -minO * (mb / mt));
        B.body.pos.addScaledVector(_n, minO * (ma / mt));
        const vrel = B.body.vel.dot(_n) - A.body.vel.dot(_n);
        if (vrel < 0) {
          const jimp = (-(1.2) * vrel) / (1 / ma + 1 / mb);
          A.body.vel.addScaledVector(_n, -jimp / ma);
          B.body.vel.addScaledVector(_n, jimp / mb);
          const sp = -vrel;
          if (sp > 6) {
            const dmgA = (sp - 6) * 30 * (mb / mt) * (A.def.ramMult ?? 1);
            const dmgB = (sp - 6) * 30 * (ma / mt) * (B.def.ramMult ?? 1);
            if (A.alive) A.applyDamage(dmgA, { kind: 'collision', attacker: B.driver, weaponId: 'vehicle_crash' });
            if (B.alive) B.applyDamage(dmgB, { kind: 'collision', attacker: A.driver, weaponId: 'vehicle_crash' });
            this.G.events.emit('vehicle:collide', { vehicle: A, other: B, speed: sp, position: pa.clone() });
          }
        }
        A.body.wake(); B.body.wake();
      }
    }
  }

  _collideActors(dt) {
    const G = this.G;
    if (!this.list.length) return;
    for (const actor of G.actors) {
      if (!actor.alive || actor.vehicle || !actor.body) continue;
      const p = actor.body.position;
      const r = 0.36;
      const h = actor.body.height || STAND_H;
      for (const v of this.list) {
        const hb = v.def.hullBox;
        if (v.body.pos.distanceToSquared(p) > (hb[5] + 3) * (hb[5] + 3)) continue;
        const L = v.body.toLocal(_a.copy(p), _a);
        const lx = L.x - hb[0], lz = L.z - hb[2];
        const top = hb[1] + hb[4];
        if (L.y + h < hb[1] - hb[4] || L.y > top + 0.1) continue;
        if (Math.abs(lx) > hb[3] + r || Math.abs(lz) > hb[5] + r) continue;
        if (L.y > top - 0.45 && Math.abs(lx) < hb[3] && Math.abs(lz) < hb[5]) {
          // Draufstehen: Füße auf das Deck, Fahrzeugbewegung mitnehmen
          v.body.toWorld(_b.set(L.x, top, L.z), _b);
          p.y = _b.y;
          if (actor.body.velocity && actor.body.velocity.y < 0) actor.body.velocity.y = 0;
          actor.body.onGround = true;
          p.x += v.body.vel.x * dt; p.z += v.body.vel.z * dt;
          continue;
        }
        // Hinausschieben entlang der kleinsten Überlappung
        const ox = hb[3] + r - Math.abs(lx), oz = hb[5] + r - Math.abs(lz);
        if (ox < oz) _b.set(Math.sign(lx) * ox, 0, 0); else _b.set(0, 0, Math.sign(lz) * oz);
        _b.applyQuaternion(v.body.quat);
        _b.y = 0;
        const pushLen = _b.length();
        if (pushLen < 1e-5) continue;
        p.add(_b);
        _n.copy(_b).multiplyScalar(1 / pushLen);
        // Überfahren: Annäherung des Fahrzeugs an den Akteur
        const closing = v.body.pointVelocity(p, _c).dot(_n);
        if (closing > 5 && v.alive && (actor._roadkillT ?? -1) < G.time.elapsed) {
          actor._roadkillT = G.time.elapsed + 0.6;
          const dmg = Math.min(400, (v.body.mass / 1000) * closing * closing * 0.6);
          if (actor.body.velocity) actor.body.velocity.addScaledVector(_n, closing * 0.9).add(_c.set(0, 3, 0));
          G.combat.damage(actor, { amount: dmg, attacker: v.driver || null, weaponId: 'roadkill', dir: _n.clone(), point: p.clone(), zone: 'body' });
          G.events.emit('vehicle:roadkill', { vehicle: v, actor, speed: closing });
        } else if (actor.body.velocity) {
          const vn = actor.body.velocity.dot(_n);
          if (vn < 0) actor.body.velocity.addScaledVector(_n, -vn);
        }
      }
    }
  }

  /* =============================================================== Waffen */

  /** Schuss einer Fahrzeugwaffe (vom Fahrzeug aufgerufen). */
  fire(v, seat, w, origin, dir) {
    const G = this.G, def = w.def, actor = seat.actor;
    const isPlayer = !!(actor && actor.isPlayer);
    if (actor) {
      actor._shotSerial = (actor._shotSerial || 0) + 1;
      if (actor.stats) actor.stats.shotsFired = (actor.stats.shotsFired || 0) + 1;
      actor.lastFiredTime = G.time.elapsed;
    }
    if (def.kind === 'shell') {
      this.shells.fire(def, origin, dir, actor, v);
      G.effects?.muzzleFlash?.(origin, dir, { cls: 'sniper', scale: 3.4 });
      G.effects?.muzzleLight?.(origin, 34, 3, 0.09, 20);
      G.effects?.smoke?.(_a.copy(origin).addScaledVector(dir, 1.2), { count: 7, size: 2.6, life: 2.4, rise: 0.35, alpha: 0.42 });
      this.audio.play('explosion', { position: isPlayer ? null : origin, volume: isPlayer ? 0.8 : 1, pitch: 1.55, priority: 3 });
      this.audio.play('boom_sub', { position: isPlayer ? null : origin, volume: 1, priority: 3 });
      if (isPlayer) { actor.shake?.(def.shake || 0.5); G.input?.rumble?.(0.9, 0.6, 200); }
    } else {
      // Streuung (Normalverteilung, Kegel def.spread)
      const s = def.spread * (v.body.speed !== 0 ? 1 + Math.min(1, Math.abs(v.body.speed) / 10) : 1);
      _d.copy(dir);
      _n.set(1, 0, 0).cross(_d);
      if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1).cross(_d);
      _n.normalize();
      _c.crossVectors(_d, _n);
      const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
      _d.addScaledVector(_n, g() * s).addScaledVector(_c, g() * s).normalize();
      this._ignore = v;
      const res = G.combat.fireHitscan({ shooter: actor, origin, dir: _d, range: def.range, weapon: def });
      this._ignore = null;
      if (w.shots % (def.tracerEvery || 3) === 0 && res && res.point) G.events.emit('tracer', { from: origin.clone(), to: res.point.clone ? res.point.clone() : res.point, actor, weaponId: def.id });
      G.effects?.muzzleFlash?.(origin, _d, { cls: 'lmg', actor, scale: 1.25 });
      this.audio.play(def.profile || 'lmg', { position: isPlayer ? null : origin, player: isPlayer, actor });
      if (isPlayer) actor.shake?.(0.05);
    }
    G.events.emit('vehicle:fire', { vehicle: v, seat: seat.index, actor, weaponId: def.id, origin, dir });
  }

  /** Granatenbahn-Abschnitt gegen Welt, Fahrzeuge und Akteure. → Treffer mit point/normal/distance (+vehicle|actor) */
  traceShell(p, d, len, s) {
    const w = this.world;
    if (!w) return null;
    let best = null;
    const wh = this._rc ? this._rc.orig.call(w, p, d, len) : w.raycast(p, d, len);
    if (wh && wh.distance <= len) best = { point: wh.point, normal: wh.normal, distance: wh.distance, surface: wh.surface };
    for (const v of this.list) {
      if (v === s.vehicle && s.age < 0.25) continue;
      const h = v.raycast(p, d, best ? best.distance : len);
      if (h) best = h;
    }
    const ah = raycastActors(this.G, s.shooter, s.vehicle, p, d, best ? best.distance : len);
    if (ah) best = { point: ah.point.clone ? ah.point.clone() : new THREE.Vector3().copy(ah.point), normal: ah.normal ? ah.normal.clone() : d.clone().negate(), distance: ah.distance, actor: ah.actor, zone: ah.zone };
    return best;
  }

  /** Strahl gegen alle Fahrzeuge. */
  raycastVehicles(origin, dir, maxDist, ignore = null) {
    let best = null;
    for (const v of this.list) {
      if (v === ignore) continue;
      const h = v.raycast(origin, dir, best ? best.distance : maxDist);
      if (h) best = h;
    }
    return best;
  }

  ownExplosion(fn) {
    this._own++;
    try { return fn(); } finally { this._own--; }
  }

  /* =============================================================== Ereignisse */

  _installRaycast() {
    const w = this.world;
    if (!w || typeof w.raycast !== 'function' || this._rc) return;
    const orig = w.raycast;
    const own = Object.prototype.hasOwnProperty.call(w, 'raycast');
    const self = this;
    const fn = function raycastWithVehicles(origin, dir, maxDist = 1000) {
      let best = orig.call(w, origin, dir, maxDist);
      if (!self.attached || !self.list.length || !self._rc || self._rc.fn !== raycastWithVehicles) return best;
      const vh = self.raycastVehicles(origin, dir, best ? best.distance : maxDist, self._ignore);
      if (vh) {
        best = vh;
        self._vehHits.push(vh);
        if (self._vehHits.length > 8) self._vehHits.shift();
      }
      return best;
    };
    this._rc = { w, orig, own, fn };
    w.raycast = fn;
  }

  _uninstallRaycast() {
    const rc = this._rc;
    if (!rc) return;
    if (rc.w.raycast === rc.fn) { if (rc.own) rc.w.raycast = rc.orig; else delete rc.w.raycast; }
    this._rc = null; // eine überlagerte Hülle reicht dann nur noch durch (Kennung passt nicht mehr)
    this._vehHits.length = 0;
  }

  _onImpact(e) {
    if (!e || !e.point || !this._vehHits.length) return;
    const h = this._vehHits.find((x) => x.point === e.point) || this._vehHits.find((x) => x.point.distanceToSquared(e.point) < 4e-4);
    this._vehHits.length = 0;
    if (!h) return;
    const G = this.G;
    G.effects?._cancelDecal?.(e.point); // kein Einschussloch in der Luft, wenn das Fahrzeug wegfährt
    const v = h.vehicle, shooter = e.shooter;
    if (!v || !v.alive || !shooter) return;
    const W = (G.data && G.data.WEAPONS) || {};
    const def = W[e.weaponId] || VEHICLE_WEAPONS[e.weaponId];
    if (!def || !def.damage) return;
    let mult = v.def.smallArmsMult * (def.vehicleMult ? def.vehicleMult / 0.4 : 1);
    if (def.antiMateriel) mult = Math.max(mult, v.def.armored ? 0.15 : 1);
    if (mult <= 0) {
      if (Math.random() < 0.25) this.audio.play('ricochet', { position: e.point, volume: 0.6 });
      return;
    }
    const from = shooter.getEyePosition ? shooter.getEyePosition(_a) : e.point;
    const dealt = v.applyDamage(falloff(def, from.distanceTo(e.point)) * mult, { attacker: shooter, weaponId: e.weaponId, zone: h.zone, kind: 'bullet', point: e.point });
    if (dealt > 0) G.events.emit('vehicle:hit', { vehicle: v, attacker: shooter, amount: dealt, weaponId: e.weaponId, zone: h.zone, face: h.face });
  }

  _onExplosion(e) {
    if (this._own > 0 || !e || !e.position || !this.list.length || e.nonLethal) return;   // Blend/Rauch (arsenal): kein Schaden
    const EQ = (this.G.data && this.G.data.EQUIPMENT) || {};
    const eq = EQ[e.type] || EQ[e.weaponId];
    const max = eq && eq.maxDamage ? eq.maxDamage : (e.weaponId === 'strike' || e.type === 'airstrike') ? 240 : 120;
    const r = e.radius || 5;
    for (const v of this.list) {
      if (!v.alive) continue;
      const d = Math.max(0, v.body.pos.distanceTo(e.position) - v.def.hullBox[3] * 0.8);
      if (d > r) continue;
      const f = Math.pow(1 - d / r, 1.2);
      const dealt = v.applyDamage(max * f * v.def.explosiveMult, { attacker: e.attacker || null, weaponId: e.weaponId || e.type, kind: 'explosive', zone: 'hull', point: e.position });
      if (!v.def.armored && v.alive) {
        _n.copy(v.body.pos).sub(e.position).setY(0.6).normalize();
        v.body.applyImpulse(v.body.pos, _n.multiplyScalar(v.body.mass * 3.5 * f));
      }
      if (dealt > 0) this.G.events.emit('vehicle:hit', { vehicle: v, attacker: e.attacker || null, amount: dealt, weaponId: e.weaponId || e.type, zone: 'hull' });
    }
  }

  _onKill(e) {
    if (e && e.victim && e.victim.vehicle) this.removeFromSeat(e.victim, { teleport: false });
  }

  /* =============================================================== Bot-/Modus-API */

  /** Nächstes Fahrzeug. opts: { maxDist = 60, free (Sitz frei), team (nicht feindlich besetzt), type, seatRole: 'driver'|'gunner' } */
  nearest(pos, { maxDist = 60, free = false, team = undefined, type = null, seatRole = null } = {}) {
    let best = null, bd = maxDist * maxDist;
    for (const v of this.list) {
      if (!v.alive || (type && v.type !== type)) continue;
      if (free && !v.freeSeats().length) continue;
      if (team !== undefined && v.isOccupied && v.team != null && team != null && v.team !== team) continue;
      if (seatRole === 'driver' && v.driver) continue;
      if (seatRole === 'gunner' && !v.seats.some((s) => !s.actor && s.weapons.length && !s.def.drive)) continue;
      const d = v.body.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Fahrweg (Straßennetz, sonst Nav-Graph, sonst gerade). → Vector3[] */
  planPath(from, to) {
    const w = this.world;
    let path = null;
    try {
      if (w && w.roads && typeof w.roads.findPath === 'function') path = w.roads.findPath(from, to);
      else if (w && w.nav && typeof w.nav.findPath === 'function') path = w.nav.findPath(from, to);
    } catch { path = null; }
    if (!path || !path.length) return [to.clone()];
    // Ausdünnen (Fahrzeuge brauchen keine engen Wegpunkte)
    const out = [];
    let last = from;
    for (const p of path) { if (p.distanceTo(last) >= 6) { out.push(p.clone()); last = p; } }
    if (!out.length || out[out.length - 1].distanceTo(to) > 1) out.push(to.clone());
    return out;
  }

  /** Killfeed-Hilfen (ui): Name/Symbol für Fahrzeugwaffen und -ursachen. */
  weaponName(id) { return (VEHICLE_WEAPONS[id] && VEHICLE_WEAPONS[id].name) || VEHICLE_CAUSES[id] || null; }
  weaponIcon(id) {
    const w = VEHICLE_WEAPONS[id];
    if (w) return ICONS[w.icon] || ICONS.shell;
    if (id === 'roadkill') return ICONS.wheel;
    if (id === 'vehicle_explosion' || id === 'vehicle_crash') return ICONS.boom;
    return null;
  }

  stats() {
    return {
      vehicles: this.list.length, alive: this.list.filter((v) => v.alive).length, sleeping: this.list.filter((v) => v.body.sleeping).length,
      shells: this.shells.list.length, spawns: this.spawns.length, ms: +this._stats.ms.toFixed(3), engines: this.audio.voices.size,
    };
  }
}
