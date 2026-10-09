// NULLPUNKT — FPV-Drohne (Serienprämie 'drohne'): kleine Kamikaze-Drohne aus Grundkörpern (Rahmen, vier Arme mit
// drehenden Rotoren, Kamera, LED, Akku). Verwaltet vom StreakManager wie das Wachgeschütz (streaks.entities): Kugeln
// treffen sie über world.raycast, Explosionen über 'explosion', Bots sehen sie als Ziel (manager.hostilesOf).
//
// Rollen (drone.role):
//   'pilot'   der eigene Spieler steuert (offline, Host, Client). Körper bleibt stehen (player.piloting), die Kamera
//             (G.camera = Spielerkamera, wie bei Fahrzeugen) sitzt in der Drohne; HUD: ui/drone-hud.js.
//   'bot'     Autopilot (offline/Host): steigt, fliegt zum nächsten Gegner, sprengt in der Nähe – spätestens der Akku
//             beendet den Flug (kein Hängenbleiben).
//   'remote'  Host: ein Client steuert, die Lage kommt per Netz ('drone' {a:'p'}), geglättet dargestellt.
//   'replica' Client: Drohne eines anderen, Lage vom Host ('ev' dr), geglättet dargestellt.
// Steuerung (Pilot): Blick = Maus/rechter Stick/Wischen; Bewegen = vor/zurück (in Blickrichtung, auch nach oben/unten)
// und seitwärts; Springen = steigen, Ducken = sinken, Sprinten = kurzer Schub; Feuern = Sprengen; Interagieren = Abbrechen.
// Flug: sanfte Trägheit (accel/brake), Kollision mit der Kollisionsgeometrie (collisionRay entlang des Wegs + keepClear,
// Weltkollision unverändert), harter Aufprall (Normalanteil > crashSpeed) = Absturz ohne Sprengung, Akku (battery s),
// Reichweite (range m ab Startpunkt; ab signalFade Rauschen, darüber Abbruch), Kartengrenzen (world.bounds).
// Ende (drone.end(why)): 'boom' Sprengung, 'abbruch', 'aufprall', 'akku', 'signal', 'abschuss', 'tot' (Besitzer tot),
// 'ende' (Matchende), 'abgelehnt' (Host verwirft die Sprengung eines Clients) → Ereignis 'drone:end' {drone, why, by}.
// Klang: DroneAudio (Summen der Rotoren, WebAudio-Synthese im sfx-Bus, Lautstärke nach Entfernung, höchstens drei Stimmen).

import * as THREE from 'three';
import { raySphere } from '../combat.js';
import { collisionRay, keepClear } from '../engine/physics.js';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = {};
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Echtzeit in s – Netzprüfungen des Hosts laufen in Echtzeit (die Simulationszeit eines langsamen Geräts läuft langsamer). */
export const realNow = () => performance.now() / 1000;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

/** Grundwerte (überschrieben von STREAKS.drohne.params). */
export const DRONE_DEFAULTS = Object.freeze({
  speed: 18, boost: 26, boostTime: 2.2, boostRecharge: 0.35, climb: 7, accel: 2.6, brake: 2.2, battery: 25, range: 150, signalFade: 110,
  radius: 4.5, innerRadius: 1.2, maxDamage: 180, minDamage: 25, health: 40, hitRadius: 0.36, crashSpeed: 8,
});
/** Kollisionskugel des Rahmens (m) – kleiner als die Trefferkugel. */
export const BODY_RADIUS = 0.22;
/** Netz: Lage-Meldungen des Piloten (Client → Host) bzw. Weitergabe (Host → alle) je Sekunde. */
export const POSE_HZ = 15;
export const RELAY_HZ = 12;
const PITCH_MIN = -1.35;
const PITCH_MAX = 1.2;
const SMOOTH = 12; // 1/s: Glättung entfernter Drohnen

let serial = 0;
let shared = null;

/** Geometrien/Materialien aller Drohnen, über Matches geteilt (vorkompiliert in der Aufwärmgruppe des Modus). */
export function droneResources() {
  return shared || (shared = createDroneResources());
}

/** Neuer, eigener Satz (Dev-Seiten); im Spiel droneResources(). */
export function createDroneResources() {
  const res = {
    body: new THREE.BoxGeometry(0.15, 0.045, 0.2),
    pack: new THREE.BoxGeometry(0.085, 0.04, 0.13),
    arm: new THREE.BoxGeometry(0.2, 0.014, 0.026),
    motor: new THREE.CylinderGeometry(0.021, 0.024, 0.032, 8),
    blade: new THREE.BoxGeometry(0.17, 0.004, 0.018),
    disc: new THREE.CircleGeometry(0.088, 18).rotateX(-Math.PI / 2),
    cam: new THREE.BoxGeometry(0.042, 0.036, 0.034),
    lens: new THREE.CylinderGeometry(0.013, 0.013, 0.014, 10).rotateX(Math.PI / 2),
    led: new THREE.SphereGeometry(0.011, 6, 4),
    antenna: new THREE.CylinderGeometry(0.0035, 0.0035, 0.1, 4),
    mats: {
      carbon: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.5, metalness: 0.35 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x30353a, roughness: 0.45, metalness: 0.6 }),
      pack: new THREE.MeshStandardMaterial({ color: 0x4b5236, roughness: 0.8, metalness: 0.1 }),
      blade: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.6, metalness: 0.1 }),
      lens: new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.08, metalness: 0.9 }),
      disc: new THREE.MeshBasicMaterial({ color: 0x8f969c, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide }),
      ally: new THREE.MeshStandardMaterial({ color: 0x0c2230, emissive: 0x38b6ff, emissiveIntensity: 2.4, roughness: 0.3 }),
      enemy: new THREE.MeshStandardMaterial({ color: 0x300c0c, emissive: 0xff3b3b, emissiveIntensity: 2.4, roughness: 0.3 }),
    },
  };
  res.mats.frame.userData.surface = 'metal';
  res.dispose = () => {
    for (const v of Object.values(res)) if (v && v.isBufferGeometry) v.dispose();
    for (const m of Object.values(res.mats)) m.dispose();
  };
  return res;
}

/** Startpunkt einer Drohne vor dem Kopf des Akteurs (etwas über Kopfhöhe, nach vorn, frei von Wänden). */
export function launchSpot(world, actor, out = new THREE.Vector3()) {
  const eye = actor.getEyePosition ? actor.getEyePosition(_a) : _a.copy(actor.position).setY(actor.position.y + 1.6);
  const yaw = actor.yaw || 0;
  _dir.set(-Math.sin(yaw) * 0.82, 0.57, -Math.cos(yaw) * 0.82).normalize();
  let len = 0.85;
  const h = collisionRay(world, eye, _dir, len + BODY_RADIUS, _hit);
  if (h) len = Math.max(0.05, h.distance - BODY_RADIUS - 0.02);
  out.copy(eye).addScaledVector(_dir, len);
  if (world) keepClear(world, out, BODY_RADIUS);
  return out;
}

export class Drone {
  /**
   * @param mgr StreakManager, owner Akteur, opts { role, position, yaw, pitch, params, netId, launch (Vector3), battery }
   */
  constructor(mgr, owner, opts = {}) {
    const G = mgr.G;
    this.mgr = mgr;
    this.G = G;
    this.kind = 'drohne';
    this.streakId = 'drohne';
    this.scoreReason = 'drone';
    this.isStreakEntity = true;
    this.id = `drohne_${++serial}`;
    this.netId = Number.isInteger(opts.netId) ? opts.netId : 0;
    this.name = 'FPV-Drohne';
    this.owner = owner;
    this.team = owner ? owner.team : null;
    this.isPlayer = false;
    this.isBot = false;
    this.surface = 'metal';
    this.role = opts.role || 'bot';
    this.params = { ...DRONE_DEFAULTS, ...(opts.params || {}) };
    this.maxHealth = this.params.health;
    this.health = this.maxHealth;
    this.alive = true;
    this.ended = null;
    this.position = (opts.position || owner.position).clone();
    this.launch = (opts.launch || this.position).clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Number.isFinite(opts.yaw) ? opts.yaw : owner.yaw || 0;
    this.pitch = clamp(Number.isFinite(opts.pitch) ? opts.pitch : 0, PITCH_MIN, PITCH_MAX);
    this.roll = 0;
    this.tilt = 0;
    this.battery = Number.isFinite(opts.battery) ? opts.battery : this.params.battery;
    this.boostLeft = this.params.boostTime;
    this.boosting = false;
    this.signal = 1;
    this.altitude = 0;
    this.speed = 0;
    this.throttle = 0.4;
    this.age = 0;
    this.stats = { kills: 0, deaths: 0, assists: 0, score: 0, shotsFired: 0, shotsHit: 0, headshots: 0, streak: 0, bestStreak: 0, damage: 0, captures: 0, longestKill: 0 };
    this.weaponStats = {};
    this.lastFiredTime = -1e9;
    this.lastDamageTime = -1e9;
    this.visible = true;
    // Netz: Ziel der Glättung (remote/replica), Sende-Takt (Pilot auf dem Client), Prüfung des Hosts (remote)
    this.netPos = this.position.clone();
    this.netVel = new THREE.Vector3();
    this.netYaw = this.yaw;
    this.netPitch = this.pitch;
    this.netAt = G.time.elapsed;
    this.seenAt = G.time.elapsed;
    this._sendAt = 0;
    this._altT = 0;
    this._hitT = 0;
    this._spin = 0;
    // Prüfung beim Host (Client-Drohne): Weg-Budget, letzte angenommene Lage, Startzeit (Echtzeit), Lageverlauf (Spielzeit)
    this.check = { budget: 6, at: realNow(), pos: this.position.clone(), started: realNow(), bad: 0, hist: [] };
    if (this.role === 'bot') this.ai = { target: null, scanT: 0, phase: 'steigen', phaseT: 0.7, stuckT: 0 };
    this._build(droneResources());
    if (this.role === 'pilot') this.group.visible = false; // eigene Drohne: Kamera sitzt vorn im Rahmen
    if (this.role === 'pilot' || this.role === 'bot') {
      // Abwurf: leichter Schwung nach vorn/oben
      this.velocity.set(-Math.sin(this.yaw) * 2.5, 1.2, -Math.cos(this.yaw) * 2.5);
    }
  }

  _build(R) {
    const g = new THREE.Group();
    g.name = `drohne:${this.owner ? this.owner.name : ''}`;
    g.position.copy(this.position);
    const mk = (geo, mat, parent, x = 0, y = 0, z = 0, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      parent.add(m);
      return m;
    };
    const tiltG = new THREE.Group(); // Neigung/Rollen (Darstellung), darunter der Rahmen
    g.add(tiltG);
    mk(R.body, R.mats.carbon, tiltG, 0, 0, 0);
    mk(R.pack, R.mats.pack, tiltG, 0, 0.042, 0.015);
    for (const s of [1, -1]) {
      const a = mk(R.arm, R.mats.frame, tiltG, 0, 0.004, 0);
      a.rotation.y = s * Math.PI / 4;
      a.scale.x = 1.55;
    }
    const isAlly = this._allyOfPlayer();
    this.rotors = [];
    const RX = 0.128;
    for (const [x, z, dir] of [[RX, -RX, 1], [-RX, -RX, -1], [RX, RX, -1], [-RX, RX, 1]]) {
      mk(R.motor, R.mats.frame, tiltG, x, 0.02, z);
      const rotor = new THREE.Group();
      rotor.position.set(x, 0.04, z);
      tiltG.add(rotor);
      mk(R.blade, R.mats.blade, rotor, 0, 0, 0, false);
      const disc = mk(R.disc, R.mats.disc, rotor, 0, 0.002, 0, false);
      disc.renderOrder = 2;
      rotor.userData.dir = dir;
      this.rotors.push(rotor);
    }
    mk(R.cam, R.mats.frame, tiltG, 0, -0.012, -0.112);
    mk(R.lens, R.mats.lens, tiltG, 0, -0.012, -0.132, false);
    const ant = mk(R.antenna, R.mats.carbon, tiltG, 0.03, 0.08, 0.085, false);
    ant.rotation.x = -0.5;
    this.led = mk(R.led, isAlly ? R.mats.ally : R.mats.enemy, tiltG, 0, 0.012, 0.104, false);
    this.ledB = mk(R.led, isAlly ? R.mats.ally : R.mats.enemy, tiltG, 0, -0.03, -0.09, false);
    g.rotation.order = 'YXZ';
    tiltG.rotation.order = 'YXZ';
    this.group = g;
    this.tiltG = tiltG;
    this.G.scene.add(g);
  }

  _allyOfPlayer() {
    const p = this.G.player;
    if (!p || !this.owner) return false;
    if (this.owner === p) return true;
    return this.owner.team != null && this.owner.team === p.team && !!(this.G.mode && this.G.mode.teams);
  }

  /* ------------------------------------------------------------ Akteur-artige API */

  getEyePosition(out = new THREE.Vector3()) {
    return out.copy(this.position);
  }

  getAimDirection(out = new THREE.Vector3()) {
    const c = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c);
  }

  /** Zielpunkt für Bots/Zielhilfe (Mitte des Rahmens). */
  getAimPoint(out = new THREE.Vector3()) {
    return out.copy(this.position);
  }

  /** Strahl gegen die Trefferkugel → { distance, point, normal, entity } | null (Ursprung im Inneren zählt nicht). */
  raycast(origin, dir, maxDist) {
    if (!this.alive) return null;
    const r = this.params.hitRadius;
    if (origin.distanceToSquared(this.position) < r * r * 1.5) return null;
    const t = raySphere(origin, dir, this.position, r);
    if (!(t > 0.01) || t > maxDist) return null;
    const point = new THREE.Vector3().copy(dir).multiplyScalar(t).add(origin);
    const normal = new THREE.Vector3().subVectors(point, this.position);
    if (normal.lengthSq() < 1e-6) normal.copy(dir).negate(); else normal.normalize();
    return { distance: t, point, normal, surface: 'metal', object: this.group, entity: this };
  }

  /**
   * Schaden (Kugeln/Explosionen). Offline/Host verrechnet ihn selbst; auf einem Client entscheidet der Host (Treffermeldung,
   * vorhergesagte Anzeige). → verrechneter bzw. erwarteter Schaden.
   */
  applyDamage(amount, attacker, weaponId = null) {
    if (!this.alive || amount <= 0) return 0;
    if (this.mgr.replica) return this.mgr._claimDroneHit(this, amount, attacker, weaponId);
    const dealt = Math.min(this.health, amount);
    this.health -= dealt;
    this.lastDamageTime = this.G.time.elapsed;
    this._hitT = 0.15;
    if (attacker && attacker.stats && !attacker.isStreakEntity) attacker.stats.damage = (attacker.stats.damage || 0) + dealt;
    if (this.health <= 0) this.mgr._destroyEntity(this, attacker);
    return dealt;
  }

  _hostile(a) {
    if (!a || a === this || a === this.owner) return false;
    if (a.isStreakEntity && a.owner === this.owner) return false;
    if (a.team != null && this.team != null) return a.team !== this.team;
    return true;
  }

  /** Restlaufzeit 0…1 */
  get batteryFrac() {
    return clamp(this.battery / Math.max(1, this.params.battery), 0, 1);
  }

  /** Abstand zum Startpunkt (m) */
  get distance() {
    return this.position.distanceTo(this.launch);
  }

  /* ------------------------------------------------------------ Update */

  /** Je Bild (StreakManager.update). → false, sobald die Drohne entfernt werden kann. */
  update(dt, playing) {
    if (!this.alive) return false;
    const G = this.G;
    this.age += dt;
    if (this._hitT > 0) this._hitT -= dt;
    const live = playing !== false;
    if (this.role === 'pilot') this._updatePilot(dt, live);
    else if (this.role === 'bot') this._updateBot(dt, live);
    else this._updateNet(dt, live);
    if (!this.alive) return false;
    // Host/offline: Lageverlauf der letzten 0,6 s (Trefferprüfung der Meldungen von Clients)
    if (!this.mgr.replica) {
      const h = this.check.hist;
      h.push([G.time.elapsed, this.position.x, this.position.y, this.position.z]);
      while (h.length > 2 && G.time.elapsed - h[0][0] > 0.6) h.shift();
      if (h.length > 90) h.splice(0, h.length - 90);
    }
    // Höhe über Grund (gestaffelt)
    this._altT -= dt;
    if (this._altT <= 0) {
      this._altT = 0.2;
      const h = collisionRay(G.world, this.position, _t.set(0, -1, 0), 200, _hit);
      this.altitude = h ? h.distance : this.position.y - (G.world && G.world.bounds ? G.world.bounds.min.y : 0);
    }
    this._pose(dt);
    return this.alive;
  }

  /** Darstellung: Lage, Neigung nach Beschleunigung, Rotoren, LED. */
  _pose(dt) {
    const g = this.group;
    g.position.copy(this.position);
    g.rotation.set(0, this.yaw, 0);
    // Neigung aus der Geschwindigkeit im eigenen Rahmen (vorwärts → Nase runter, seitwärts → rollen)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const v = this.role === 'pilot' || this.role === 'bot' ? this.velocity : this.netVel;
    const vf = -(v.x * sy + v.z * cy);
    const vs = v.x * cy - v.z * sy;
    this.tilt += (clamp(-vf * 0.022, -0.5, 0.5) - this.tilt) * damp(6, dt);
    this.roll += (clamp(-vs * 0.026, -0.5, 0.5) - this.roll) * damp(6, dt);
    this.tiltG.rotation.set(this.tilt, 0, this.roll);
    this.speed = v.length();
    this.throttle = clamp(0.35 + this.speed / 30 + Math.max(0, v.y) / 12, 0.2, 1);
    this._spin += dt * (55 + this.throttle * 40);
    for (const r of this.rotors) r.rotation.y = this._spin * r.userData.dir;
    const blink = this._hitT > 0 ? Math.floor(this._hitT * 40) % 2 === 0 : Math.floor(this.age * 2.5) % 2 === 0;
    this.led.visible = blink;
    this.ledB.visible = !blink || this._hitT > 0;
  }

  /* ------------------------------------------------------------ Pilot (eigener Spieler) */

  _updatePilot(dt, live) {
    const G = this.G;
    const input = G.input;
    if (live && input) {
      this.yaw = wrap(this.yaw - input.look.dx);
      this.pitch = clamp(this.pitch - input.look.dy, PITCH_MIN, PITCH_MAX);
      if (input.pressed('fire')) { input.consume('fire'); this.detonate(); return; }
      if (input.pressed('interact')) { input.consume('interact'); this.end('abbruch'); return; }
    }
    const mx = live && input ? input.move.x : 0;
    const my = live && input ? input.move.y : 0;
    const up = live && input ? (input.down('jump') ? 1 : 0) - (input.down('crouch') || input.down('prone') ? 1 : 0) : 0;
    const wantBoost = live && !!input && input.down('sprint') && Math.hypot(mx, my) > 0.2;
    this._steerInput(dt, mx, my, up, wantBoost);
    this._move(dt);
    if (!this.alive) return;
    this._tickBattery(dt, live);
    if (!this.alive) return;
    // Client: Lage an den Host (15 Hz)
    if (this.mgr.replica) {
      const now = G.time.elapsed;
      if (now - this._sendAt >= 1 / POSE_HZ - 0.002) {
        this._sendAt = now;
        this.mgr._sendDrone({ a: 'p', d: this.netId, p: [r2(this.position.x), r2(this.position.y), r2(this.position.z)], y: r3(this.yaw), pi: r3(this.pitch) });
      }
    }
  }

  /** Eingaben → Zielgeschwindigkeit (vorwärts = Blickrichtung samt Neigung, seitwärts waagerecht, steigen/sinken). */
  _steerInput(dt, mx, my, up, wantBoost) {
    const P = this.params;
    // Schub: hält boostTime s, lädt langsam nach
    this.boosting = wantBoost && this.boostLeft > 0.02;
    if (this.boosting) this.boostLeft = Math.max(0, this.boostLeft - dt);
    else this.boostLeft = Math.min(P.boostTime, this.boostLeft + P.boostRecharge * dt);
    const vmax = this.boosting ? P.boost : P.speed;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    _fwd.set(-sy * cp, sp, -cy * cp);
    _right.set(cy, 0, -sy);
    _t.set(0, 0, 0).addScaledVector(_fwd, my * vmax).addScaledVector(_right, mx * vmax * 0.8);
    _t.y += up * P.climb;
    const lim = Math.max(vmax, P.climb);
    if (_t.lengthSq() > lim * lim) _t.setLength(lim);
    this._approach(_t, dt);
  }

  /** Geschwindigkeit sanft an das Ziel führen (Trägheit: Beschleunigen accel, Bremsen brake). */
  _approach(target, dt) {
    const P = this.params;
    const k = target.lengthSq() > this.velocity.lengthSq() ? P.accel : P.brake;
    this.velocity.lerp(target, damp(k, dt));
  }

  /** Bewegung mit Kollision: Strahl entlang des Wegs (kein Durchdringen), Gleiten an Flächen, harter Aufprall = Absturz. */
  _move(dt) {
    const G = this.G;
    const w = G.world;
    const P = this.params;
    const pos = this.position;
    const v = this.velocity;
    let remaining = v.length() * dt;
    for (let iter = 0; iter < 4 && remaining > 1e-5; iter++) {
      _dir.copy(v).normalize();
      const h = w ? collisionRay(w, pos, _dir, remaining + BODY_RADIUS, _hit) : null;
      if (!h) { pos.addScaledVector(_dir, remaining); break; }
      const travel = Math.max(0, h.distance - BODY_RADIUS - 0.01);
      pos.addScaledVector(_dir, Math.min(travel, remaining));
      _a.set(h.nx, h.ny, h.nz);
      if (_a.dot(_dir) > 0) _a.negate();
      const vn = v.dot(_a); // < 0: in die Fläche hinein
      if (-vn > P.crashSpeed) { this.end('aufprall', null, _a); return; }
      v.addScaledVector(_a, -vn * 1.15); // Normalanteil weg (+ leichtes Abprallen), Rest gleitet
      remaining = Math.max(0, remaining - travel) * 0.6;
      if (v.lengthSq() < 0.01) break;
    }
    if (w) keepClear(w, pos, BODY_RADIUS);
    // Kartengrenzen (und eine Decke über dem höchsten Punkt der Karte)
    const b = w && w.bounds;
    if (b && b.min && Number.isFinite(b.min.x)) {
      const x = clamp(pos.x, b.min.x + 0.5, b.max.x - 0.5);
      const z = clamp(pos.z, b.min.z + 0.5, b.max.z - 0.5);
      const y = clamp(pos.y, b.min.y + 0.3, b.max.y + 12);
      if (x !== pos.x) v.x = 0;
      if (z !== pos.z) v.z = 0;
      if (y !== pos.y) v.y = 0;
      pos.set(x, y, z);
    }
  }

  /** Akku und Signal (Reichweite ab Startpunkt). */
  _tickBattery(dt, live) {
    const P = this.params;
    if (live) this.battery -= dt;
    if (this.battery <= 0) { this.battery = 0; this.end('akku'); return; }
    const d = this.distance;
    this.signal = d <= P.signalFade ? 1 : clamp(1 - (d - P.signalFade) / Math.max(1, P.range - P.signalFade), 0, 1);
    if (d > P.range) this.end('signal');
  }

  /* ------------------------------------------------------------ Bot (Autopilot) */

  _updateBot(dt, live) {
    const G = this.G;
    const P = this.params;
    const ai = this.ai;
    if (!live) { this._approach(_t.set(0, 0, 0), dt); this._move(dt); return; }
    // Ziel: nächster lebender Gegner (alle 0,5 s neu), bevorzugt mit freier Sicht von der Drohne
    ai.scanT -= dt;
    if (ai.scanT <= 0 || (ai.target && !ai.target.alive)) {
      ai.scanT = 0.5;
      ai.target = this._pickTarget();
    }
    const tgt = ai.target;
    ai.phaseT -= dt;
    if (ai.phase === 'steigen' && ai.phaseT <= 0) ai.phase = 'jagen';
    _t.set(0, 0, 0);
    if (ai.phase === 'steigen' || !tgt) {
      _t.set(-Math.sin(this.yaw) * 2, P.climb * 0.6, -Math.cos(this.yaw) * 2);
      if (!tgt && this.altitude > 6) _t.y = 0;
    } else {
      // Brust des Ziels; aus der Ferne etwas darüber anfliegen (über Deckung), nah direkt
      _b.copy(tgt.position);
      _b.y += (tgt.body ? tgt.body.height : 1.8) * 0.6;
      const d = _b.distanceTo(this.position);
      if (d < 2.4) { this.detonate(); return; }
      const lift = d > 14 ? 2.5 : d > 6 ? 1 : 0;
      _a.copy(_b);
      _a.y += lift;
      _dir.subVectors(_a, this.position);
      const len = _dir.length();
      if (len > 1e-3) _dir.multiplyScalar(1 / len);
      const sp = d < 8 ? P.speed * 0.75 : P.speed * 0.8;
      _t.copy(_dir).multiplyScalar(sp);
      // Hindernis voraus → steigen (über Mauern/Container)
      const ahead = collisionRay(G.world, this.position, _dir, Math.min(5, len), _hit);
      if (ahead && ahead.distance < 4) { _t.multiplyScalar(0.35); _t.y = P.climb; ai.stuckT += dt; } else ai.stuckT = Math.max(0, ai.stuckT - dt);
      // Hängt an einer Kante fest → zur Seite ausweichen
      if (ai.stuckT > 2) { _t.x += Math.cos(this.yaw) * 6; _t.z -= Math.sin(this.yaw) * 6; }
      // Gegner in Reichweite und Akku fast leer → jetzt sprengen
      if (this.battery < 1.2 && d < P.radius * 0.8) { this.detonate(); return; }
    }
    this._approach(_t, dt);
    // Blick folgt dem Flug
    if (this.velocity.lengthSq() > 0.5) {
      const v = this.velocity;
      const want = Math.atan2(-v.x, -v.z);
      this.yaw = wrap(this.yaw + clamp(wrap(want - this.yaw), -4 * dt, 4 * dt));
      this.pitch += (clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)), -1, 1) - this.pitch) * damp(4, dt);
    }
    // Bots stürzen nicht beim leichten Anstoßen: Aufprallgrenze höher (der Autopilot bremst nicht)
    const crash = P.crashSpeed;
    P.crashSpeed = crash * 1.6;
    this._move(dt);
    P.crashSpeed = crash;
    if (!this.alive) return;
    this._tickBattery(dt, live);
  }

  _pickTarget() {
    const G = this.G;
    const w = G.world;
    let best = null;
    let bestD = 70;
    for (const a of G.actors) {
      if (!a.alive || a === this.owner || !G.combat || !G.combat.isHostile(this.owner, a)) continue;
      _b.copy(a.position);
      _b.y += 1.2;
      let d = _b.distanceTo(this.position);
      if (d >= bestD + 20) continue;
      if (w && w.lineOfSight && !w.lineOfSight(this.position, _b)) d += 20; // verdeckt: nur, wenn nichts Besseres
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /* ------------------------------------------------------------ Netz (Host: Client-Drohne, Client: fremde Drohne) */

  /** Neue Lage aus dem Netz (Host: Meldung des Piloten; Client: Weitergabe des Hosts). */
  netUpdate(pos, yaw, pitch) {
    const now = this.G.time.elapsed;
    const dtN = now - this.netAt;
    if (dtN > 0.02 && dtN < 1) {
      _v.subVectors(pos, this.netPos).multiplyScalar(1 / dtN);
      if (_v.lengthSq() < 40 * 40) this.netVel.lerp(_v, 0.6);
    } else if (dtN >= 1) this.netVel.set(0, 0, 0);
    this.netPos.copy(pos);
    if (Number.isFinite(yaw)) this.netYaw = yaw;
    if (Number.isFinite(pitch)) this.netPitch = pitch;
    this.netAt = now;
    this.seenAt = now;
  }

  _updateNet(dt, live) {
    const G = this.G;
    const now = G.time.elapsed;
    // Ziel = letzte Lage, höchstens 0,15 s fortgeschrieben; Darstellung folgt geglättet (ab 6 m Sprung: setzen)
    const ex = Math.min(0.15, Math.max(0, now - this.netAt));
    _t.copy(this.netPos).addScaledVector(this.netVel, ex);
    if (_t.distanceTo(this.position) > 6) this.position.copy(_t);
    else this.position.lerp(_t, damp(SMOOTH, dt));
    this.yaw = wrap(this.yaw + wrap(this.netYaw - this.yaw) * damp(SMOOTH, dt));
    this.pitch += (this.netPitch - this.pitch) * damp(SMOOTH, dt);
    if (this.role === 'remote' && !this.mgr.replica) {
      // Host: Sicherheitsgrenzen (der Client beendet seinen Flug selbst; fehlt das, endet er hier). Großzügig in Echtzeit:
      // auf einem langsamen Gerät (< 20 Bilder/s) läuft dessen Spielzeit – und damit sein Akku – langsamer
      if (live) this.battery -= dt;
      if (realNow() - this.check.started > this.params.battery * (this.mgr.netTimeFactor || 2.2) + 5) { this.end('akku'); return; }
      if (now - this.netAt > 3) { this.end('signal'); return; }
    }
    // Client: keine Lage mehr vom Host (Host hängt) → ausblenden; kommt wieder eine, entsteht das Abbild neu (timeout)
    if (this.mgr.replica && now - this.seenAt > 2) this.end('signal', null, null, { quiet: true, timeout: true });
  }

  /* ------------------------------------------------------------ Ende */

  /** Sprengung: offline/Host sofort (combat.explode, Angreifer = Besitzer), Client → Meldung an den Host. */
  detonate() {
    if (!this.alive) return false;
    if (this.mgr.replica) {
      this.mgr._sendDrone({ a: 'x', d: this.netId, p: [r2(this.position.x), r2(this.position.y), r2(this.position.z)] });
      this.end('boom', null, null, { quiet: true, pending: true });
      return true;
    }
    this.mgr._droneExplode(this, this.position);
    return true;
  }

  /**
   * Flug beenden. why: 'boom' | 'abbruch' | 'aufprall' | 'akku' | 'signal' | 'abschuss' | 'tot' | 'ende' | 'abgelehnt'.
   * opts.quiet: kein Absturz-Effekt; opts.pending: Client hat gesprengt, Wirkung kommt vom Host.
   */
  end(why, by = null, normal = null, opts = {}) {
    if (!this.alive) return;
    const G = this.G;
    this.alive = false;
    this.ended = why;
    // Absturz: Funken + Rauchfahne + Blech (keine große Explosion)
    if (why !== 'boom' && why !== 'ende' && !opts.quiet && G.effects) {
      try {
        if (typeof G.effects.impact === 'function') G.effects.impact(this.position, normal || UP, 'metal', { scale: 1.6 });
        if (typeof G.effects.wisp === 'function') { G.effects.wisp(this.position, { strength: 1 }); G.effects.wisp(this.position, { strength: 0.8 }); }
      } catch { /* Effekte sind Beiwerk */ }
      if (G.audio && typeof G.audio.play === 'function') {
        try { G.audio.play('impact_metal', { position: this.position.clone(), volume: 0.9 }); } catch { /* */ }
      }
    }
    this.mgr._onDroneEnd(this, why, by, opts);
  }

  dispose() {
    if (this.group) this.group.removeFromParent();
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/* ======================================================================== Klang */

const MAX_VOICES = 3;
const RANGE = 70;

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Summen einer Drohne: zwei verstimmte Sägezähne (Blattfrequenz) + Bandrauschen (Luftstrom), leichtes Schwanken. */
class DroneVoice {
  constructor(ctx, dest, noise) {
    this.ctx = ctx;
    const t = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createPanner();
    Object.assign(this.pan, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 2.5, maxDistance: 120, rolloffFactor: 1.25 });
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 2400;
    this.lp.Q.value = 0.6;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o1.frequency.value = 170;
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth'; this.o2.frequency.value = 176;
    this.o3 = ctx.createOscillator(); this.o3.type = 'square'; this.o3.frequency.value = 340;
    const g1 = ctx.createGain(); g1.gain.value = 0.32;
    const g2 = ctx.createGain(); g2.gain.value = 0.28;
    const g3 = ctx.createGain(); g3.gain.value = 0.07;
    this.o1.connect(g1).connect(this.lp);
    this.o2.connect(g2).connect(this.lp);
    this.o3.connect(g3).connect(this.lp);
    this.n = ctx.createBufferSource(); this.n.buffer = noise; this.n.loop = true;
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 1300; nb.Q.value = 0.7;
    this.gn = ctx.createGain(); this.gn.gain.value = 0.18;
    this.n.connect(nb).connect(this.gn).connect(this.lp);
    // Schwanken (Rotoren laufen nie ganz gleich)
    this.am = ctx.createGain(); this.am.gain.value = 1;
    this.lfo = ctx.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = 7.5;
    const lg = ctx.createGain(); lg.gain.value = 0.12;
    this.lfo.connect(lg).connect(this.am.gain);
    this.lp.connect(this.am).connect(this.out);
    this.out.connect(this.pan).connect(dest);
    for (const o of [this.o1, this.o2, this.o3, this.n, this.lfo]) o.start(t);
  }

  set(drone, onboard) {
    const ctx = this.ctx, t = ctx.currentTime;
    const th = drone.alive ? drone.throttle : 0;
    const f = 150 + th * 120;
    this.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.o2.frequency.setTargetAtTime(f * 1.035, t, 0.05);
    this.o3.frequency.setTargetAtTime(f * 2, t, 0.05);
    this.lp.frequency.setTargetAtTime(onboard ? 900 : 1800 + th * 1600, t, 0.08);
    this.gn.gain.setTargetAtTime(0.12 + th * 0.2, t, 0.1);
    const vol = drone.alive ? (onboard ? 0.16 : 0.55 + th * 0.35) : 0;
    this.out.gain.setTargetAtTime(vol, t, 0.1);
    const p = drone.position;
    if (this.pan.positionX) {
      this.pan.positionX.setTargetAtTime(p.x, t, 0.03);
      this.pan.positionY.setTargetAtTime(p.y, t, 0.03);
      this.pan.positionZ.setTargetAtTime(p.z, t, 0.03);
    } else this.pan.setPosition(p.x, p.y, p.z);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.06);
    const end = t + 0.4;
    for (const n of [this.o1, this.o2, this.o3, this.n, this.lfo]) try { n.stop(end); } catch { /* schon gestoppt */ }
    setTimeout(() => { try { this.out.disconnect(); this.pan.disconnect(); } catch { /* egal */ } }, 600);
  }
}

/** Rauschen der Funkstrecke beim Piloten (schwaches Signal), eigene Stimme ohne Raumklang. */
class StaticVoice {
  constructor(ctx, dest, noise) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.n = ctx.createBufferSource(); this.n.buffer = noise; this.n.loop = true; this.n.playbackRate.value = 0.7;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    this.n.connect(hp).connect(this.out).connect(dest);
    this.n.start(ctx.currentTime);
  }

  set(level) {
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(0.3, level * 0.3)), this.ctx.currentTime, 0.05);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    try { this.n.stop(t + 0.3); } catch { /* */ }
    setTimeout(() => { try { this.out.disconnect(); } catch { /* */ } }, 500);
  }
}

export class DroneAudio {
  constructor(G) {
    this.G = G;
    this.voices = new Map(); // Drohne → DroneVoice
    this.static = null;
    this._noise = null;
    this._ctx = null;
  }

  _dest() {
    const A = this.G.audio;
    if (!A || A.silent || !A.ctx || !A.bus || !A.bus.sfx) return null;
    if (A.ctx.state !== 'running') return null;
    if (this._ctx !== A.ctx) { this.stopAll(); this._ctx = A.ctx; this._noise = noiseBuffer(A.ctx); }
    return A.bus.sfx;
  }

  update(drones, pilot) {
    const dest = this._dest();
    if (!dest) { if (this.voices.size || this.static) this.stopAll(); return; }
    const cam = this.G.camera;
    if (!cam) return;
    const cp = cam.position;
    const ranked = [];
    for (const d of drones) {
      if (!d.alive || d.kind !== 'drohne') continue;
      const dist = d === pilot ? 0 : d.position.distanceTo(cp);
      if (dist > RANGE) continue;
      ranked.push([dist, d]);
    }
    ranked.sort((a, b) => a[0] - b[0]);
    const keep = new Set(ranked.slice(0, MAX_VOICES).map((x) => x[1]));
    for (const [d, v] of this.voices) if (!keep.has(d)) { v.stop(); this.voices.delete(d); }
    for (const d of keep) {
      let v = this.voices.get(d);
      if (!v) { v = new DroneVoice(this._ctx, dest, this._noise); this.voices.set(d, v); }
      v.set(d, d === pilot);
    }
    if (pilot && pilot.alive) {
      if (!this.static) this.static = new StaticVoice(this._ctx, dest, this._noise);
      this.static.set((1 - pilot.signal) * 0.9 + (pilot.batteryFrac < 0.15 ? 0.1 : 0));
    } else if (this.static) { this.static.stop(); this.static = null; }
  }

  stopAll() {
    for (const v of this.voices.values()) v.stop();
    this.voices.clear();
    if (this.static) { this.static.stop(); this.static = null; }
  }
}
