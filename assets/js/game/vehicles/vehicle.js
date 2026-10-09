// NULLPUNKT — Fahrzeug-Entität: Sitze, Absichten (Spieler/Bots), Lafetten, Waffenzustand, Schaden mit Zonen,
// Zerstörung/Wrack, Reparatur, Darstellungsabgleich. Physik: sim.js, Modell: models.js, Autopilot: autopilot.js.
//
// Sitz-Absicht (intent) – Spieler-Steuerung und Bots schreiben dasselbe Objekt (vehicle.intentFor(actor)):
//   Fahrer:   throttle (−1…1), steer (−1 links … 1 rechts), brake (0…1), handbrake (bool)
//             oder moveTo (Vector3) / path (Vector3[]) + arriveRadius, maxSpeed, reverseAllowed → Autopilot
//             (Rückmeldung: arrived, stuck, blocked)
//   Schützen: aimDir (Vector3, Welt) oder aimAt (Vector3, Weltpunkt; Granaten mit ballistischem Vorhalt),
//             fire (gehalten), firePressed (Flanke), weapon (Index wählen), cycleWeapon (bool, einmalig),
//             fireWhenAligned (Standard true für Bots: erst ab Zielfehler ≤ 1,5°), reload (bool)
import * as THREE from 'three';
import { VEHICLES, VEHICLE_WEAPONS } from './data.js';
import { VehicleBody } from './sim.js';
import { createVehicleModel } from './models.js';
import { updateAutopilot, resetAutopilot } from './autopilot.js';
import { createGun, loadAction as crewLoad, onGunFired, updateGun, dropShell, gunSeat, isHuman } from './crew.js';
import { viewOf, viewAnchor, fpViewOf, viewsOf } from './views.js';

let SERIAL = 0;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _iq = new THREE.Quaternion(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _n = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const approach = (cur, target, maxStep) => { const d = wrap(target - cur); return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep; };

export function newIntent() {
  return {
    throttle: 0, steer: 0, brake: 0, handbrake: false,
    moveTo: null, path: null, arriveRadius: 4, maxSpeed: null, reverseAllowed: true, autopilot: true,
    arrived: false, stuck: false, blocked: false,
    aimDir: null, aimAt: null, fire: false, firePressed: false, weapon: null, cycleWeapon: false, reload: false,
    fireWhenAligned: false, zoom: 0,
    // Getriebe (Antrieb): 'hold' | 'auto', ausstehende Schaltflanken (A setzt nach Verbrauch auf 0)
    gearbox: 'auto', shiftUp: 0, shiftDown: 0,
    // gewünschter Sichtindex (Netz/Host → sys.setSeatView)
    view: 0,
  };
}

/** Strahl gegen achsparallelen Quader (lokal). → { t, nx, ny, nz } | null */
function rayBox(o, d, cx, cy, cz, hx, hy, hz, maxT) {
  let tmin = 0, tmax = maxT, nx = 0, ny = 0, nz = 0;
  const axes = [[o.x, d.x, cx, hx, 0], [o.y, d.y, cy, hy, 1], [o.z, d.z, cz, hz, 2]];
  for (const [oo, dd, c, h, ax] of axes) {
    const lo = c - h, hi = c + h;
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; nx = ny = nz = 0; if (ax === 0) nx = s; else if (ax === 1) ny = s; else nz = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin <= 0) return null; // Start im Quader: ignorieren (eigene Mündung)
  return { t: tmin, nx, ny, nz };
}

export class Vehicle {
  constructor(sys, type, { position, yaw = 0, team = null, quality = 'high', spawn = null } = {}) {
    const def = VEHICLES[type];
    if (!def) throw new Error(`Unbekannter Fahrzeugtyp „${type}“`);
    this.sys = sys;
    this.G = sys.G;
    this.def = def;
    this.type = type;
    this.id = `${type}-${++SERIAL}`;
    this.name = def.name;
    this.spawnTeam = team;
    this.spawn = spawn;
    this.isVehicle = true;
    this.body = new VehicleBody(def);
    this.body.setPose(position, yaw);
    this.model = createVehicleModel(type, { team, quality });
    this.health = this.maxHealth = def.health;
    this.zones = {};
    for (const [k, z] of Object.entries(def.zones)) this.zones[k] = { id: k, label: z.label, hp: z.hp, max: z.hp };
    this.alive = true;
    this.disabled = false;
    this.wreck = false;
    this.wreckLeft = 0;
    this.trackDownUntil = 0;
    this.lastHitTime = -1e9;
    this.lastAttacker = null;
    this.lastWeaponId = null;
    this.mount = { turretYaw: 0, gunPitch: 0, cmgYaw: 0, cmgPitch: 0, mgYaw: 0, mgPitch: 0 };
    this.recoil = 0;
    this.lights = false;
    this._fxT = 0;
    this._burnAcc = 0;
    this.seats = def.seats.map((sd, i) => ({
      index: i, def: sd, actor: null, intent: newIntent(),
      weapons: sd.weapons.map((id) => ({ def: VEHICLE_WEAPONS[id], mag: VEHICLE_WEAPONS[id].mag, reloadT: 0, cooldown: 0, shots: 0 })),
      weaponIndex: 0, aimError: 0, zoomIndex: 0,
      look: { yaw, pitch: 0, relYaw: 0, relPitch: 0, idle: 0 },
      // Besatzung (§3.3): Sicht, Luke, Wechselsperre, gewünschte Lafettenrichtung, Bot-Stellvertreter
      view: 0, hatchOpen: false, hatchT: 0, readyAt: 0, aimWant: new THREE.Vector3(), proxy: null,
    }));
    this._aimDir = new THREE.Vector3();
    // Hauptkanone mit Ladezustand + Gestell (crew.js; nur Fahrzeuge mit Granatwaffe)
    this.gun = createGun(this);
    this._modelState = {};
  }

  /* --------------------------------------------------------------- Abfragen */

  get position() { return this.body.origin(this._pos || (this._pos = new THREE.Vector3())); }
  get yaw() { return this.body.yaw(); }
  get speed() { return this.body.speed; }
  get driver() { const s = this.seats.find((x) => x.def.drive); return s ? s.actor : null; }
  get occupants() { return this.seats.map((s) => s.actor); }
  get isOccupied() { return this.seats.some((s) => !!s.actor); }
  /** Team: Team der Besatzung, sonst Team des Spawns (null = neutral, jeder darf einsteigen). */
  get team() { const a = this.seats.find((s) => s.actor); return a ? a.actor.team : this.spawnTeam; }
  seatOf(actor) { return this.seats.findIndex((s) => s.actor === actor); }
  freeSeats() { return this.seats.filter((s) => !s.actor).map((s) => s.index); }
  intentFor(actor) { const i = this.seatOf(actor); return i >= 0 ? this.seats[i].intent : null; }
  /** Weltpunkt eines Sitzes (Füße des Insassen). */
  seatPosition(i, out = new THREE.Vector3(), render = true) {
    const p = _a.fromArray(this.seats[i].def.pos);
    return render ? this.body.toWorldRender(p, out) : this.body.toWorld(p, out);
  }
  /** Mittelpunkt (Schwerpunkt) in Weltkoordinaten. */
  center(out = new THREE.Vector3()) { return out.copy(this.body.pos); }

  /* --------------------------------------------------------------- Sitze (Bot-API) */

  /** Sitz anfordern: Index oder −1. Ohne seat: Fahrer zuerst, sonst erster freier. */
  requestSeat(actor, seat = null) { return this.sys.enter(actor, this, seat); }
  leave(actor) { return this.sys.exit(actor); }

  /** Fahr-Hilfen für Bots. */
  driveTo(actor, point, opts = {}) {
    const it = this.intentFor(actor);
    if (!it) return false;
    resetAutopilot(it);
    it.path = null;
    it.moveTo = point ? point.clone() : null;
    Object.assign(it, { arriveRadius: opts.arriveRadius ?? 5, maxSpeed: opts.maxSpeed ?? null, reverseAllowed: opts.reverseAllowed ?? true });
    if (point && opts.plan !== false) {
      const path = this.sys.planPath(this.position, point);
      if (path && path.length) it.path = path;
    }
    return true;
  }
  followPath(actor, points, opts = {}) {
    const it = this.intentFor(actor);
    if (!it) return false;
    resetAutopilot(it);
    it.moveTo = null;
    it.path = points && points.length ? points.map((p) => p.clone()) : null;
    Object.assign(it, { arriveRadius: opts.arriveRadius ?? 5, maxSpeed: opts.maxSpeed ?? null });
    return true;
  }
  stop(actor) { const it = this.intentFor(actor); if (it) { it.path = it.moveTo = null; it.throttle = it.steer = 0; it.brake = 1; } }
  aimAt(actor, point, fire = false) {
    const it = this.intentFor(actor);
    if (!it) return false;
    it.aimAt = point ? (it.aimAt || new THREE.Vector3()).copy(point) : null;
    it.aimDir = null;
    it.fire = !!fire;
    it.fireWhenAligned = true;
    return true;
  }
  canFire(seatIndex) {
    const s = this.seats[seatIndex];
    const w = s && s.weapons[s.weaponIndex];
    if (!w || !this.alive || this.G.time.elapsed < (s.readyAt || 0)) return false;
    if (w.def.kind === 'shell') return !!(this.gun && this.gun.step === 'geladen' && w.cooldown <= 0);
    return w.mag > 0 && w.reloadT <= 0 && w.cooldown <= 0;
  }

  /** Ladeschritt des Ladeschützen (Host/offline; crew.js). → { ok, why? } */
  loadAction(seat, action, ammo = null, opts = {}) {
    if (typeof seat === 'number') seat = this.seats[seat];
    return crewLoad(this, seat, action, ammo, opts);
  }

  /** Bot-Einzelbesatzung (§B.8): Bot-Fahrer bedient den leeren Richtschützensitz stellvertretend. */
  _proxyGunner() {
    const gs = gunSeat(this);
    if (!gs) return;
    const ds = this.seats.find((s) => s.def.drive);
    const bot = ds && ds.actor && !isHuman(ds.actor) ? ds.actor : null;
    const want = !gs.actor && bot && this.G.time.elapsed >= (ds.readyAt || 0) ? bot : null;
    if (gs.proxy !== want) {
      gs.proxy = want;
      if (want) { gs.intent = newIntent(); gs.intent.fireWhenAligned = true; }
    }
    if (!want) return;
    // Schützenfelder der Fahrer-Absicht auf den Richtschützensitz umleiten (einmalige Felder dort verbrauchen)
    const src = ds.intent, dst = gs.intent;
    dst.aimAt = src.aimAt ? (dst.aimAt || new THREE.Vector3()).copy(src.aimAt) : null;
    dst.aimDir = src.aimDir ? (dst.aimDir || new THREE.Vector3()).copy(src.aimDir) : null;
    dst.fire = !!src.fire;
    dst.fireWhenAligned = src.fireWhenAligned !== false;
    if (src.firePressed) { dst.firePressed = true; src.firePressed = false; }
    if (src.weapon != null) { dst.weapon = src.weapon; src.weapon = null; }
    if (src.cycleWeapon) { dst.cycleWeapon = true; src.cycleWeapon = false; }
    if (src.reload) { dst.reload = true; src.reload = false; }
  }

  /* --------------------------------------------------------------- Lafetten */

  /** Lafettenlage (lokal): Ursprung + Richtung für Sitz/Waffe. space 'gun'|'cmg'|'mg'. */
  _mountLocal(seat, wIndex, outPos, outDir) {
    const d = this.def, m = this.mount;
    const w = seat.weapons[wIndex];
    switch (seat.def.mount) {
      case 'gun': {
        _q.setFromAxisAngle(Y, m.turretYaw);
        _q2.setFromAxisAngle(X, m.gunPitch);
        const gunQ = _q.clone().multiply(_q2);
        const tip = w && w.def.kind === 'mg' ? _b.fromArray(d.coax).add(_c.set(0, 0, -0.6)) : _b.fromArray(d.muzzle);
        outPos.copy(tip).applyQuaternion(_q2).add(_c.fromArray(d.gunPivot)).applyQuaternion(_q).add(_c.fromArray(d.turretPivot));
        outDir.set(0, 0, -1).applyQuaternion(gunQ);
        return;
      }
      case 'cmg': {
        _q.setFromAxisAngle(Y, m.turretYaw + m.cmgYaw);
        _q2.setFromAxisAngle(X, m.cmgPitch);
        _q.multiply(_q2);
        outPos.fromArray(d.cmgMuzzle).applyQuaternion(_q);
        _q2.setFromAxisAngle(Y, m.turretYaw);
        outPos.add(_c.fromArray(d.cmgPivot).applyQuaternion(_q2)).add(_c.fromArray(d.turretPivot));
        outDir.set(0, 0, -1).applyQuaternion(_q);
        return;
      }
      case 'mg': {
        _q.setFromAxisAngle(Y, m.mgYaw);
        _q2.setFromAxisAngle(X, m.mgPitch);
        _q.multiply(_q2);
        outPos.fromArray(d.mgMuzzle).applyQuaternion(_q).add(_c.fromArray(d.mgPivot));
        outDir.set(0, 0, -1).applyQuaternion(_q);
        return;
      }
      default:
        outPos.set(0, 1.5, 0); outDir.set(0, 0, -1);
    }
  }

  /** Mündung in Weltkoordinaten (Simulations- oder Darstellungslage). */
  muzzle(seatIndex, outPos, outDir, render = false, wIndex = null) {
    const s = this.seats[seatIndex];
    this._mountLocal(s, wIndex ?? s.weaponIndex, outPos, outDir);
    const q = render ? this.body.renderQuat : this.body.quat;
    if (render) this.body.toWorldRender(outPos, outPos); else this.body.toWorld(outPos, outPos);
    outDir.applyQuaternion(q);
    return outPos;
  }

  /** Kamera-Anker eines Sitzes (Welt, Darstellungslage) + Blickquaternion der Lafette (für die Optik). */
  sightPose(seatIndex, outPos, outQuat, view = null) {
    const s = this.seats[seatIndex];
    view = view || viewOf(s);
    if (view.tp) view = fpViewOf(s);
    return viewAnchor(this, view, outPos, outQuat);
  }

  /** Ballistische Erhöhung (rad) für Mündungsgeschwindigkeit v auf Ziel (dx horizontal, dy Höhe). */
  static lobAngle(v, g, dx, dy) {
    const v2 = v * v, disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
    if (disc < 0 || dx < 1e-3) return Math.atan2(dy, Math.max(dx, 1e-3));
    return Math.atan((v2 - Math.sqrt(disc)) / (g * dx));
  }

  _aimSeat(seat, dt) {
    const it = seat.intent, def = this.def, m = this.mount;
    if (!seat.def.mount) return;
    const w = seat.weapons[seat.weaponIndex];
    // Gewünschte Richtung (Welt)
    let want = null;
    if (it.aimAt) {
      this.muzzle(seat.index, _ro, _rd);
      _a.copy(it.aimAt).sub(_ro);
      if (w && w.def.kind === 'shell') {
        // Ballistik der geladenen Granate (sonst der gewählten)
        const bd = (this.gun && this.gun.loaded && VEHICLE_WEAPONS[this.gun.loaded]) || w.def;
        const dx = Math.hypot(_a.x, _a.z);
        const el = Vehicle.lobAngle(bd.speed, bd.gravity, dx, _a.y);
        const yaw = Math.atan2(-_a.x, -_a.z);
        _a.set(-Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el));
      }
      want = _a.normalize();
    } else if (it.aimDir) want = _a.copy(it.aimDir).normalize();
    if (!want) return;
    this._aimDir.copy(want);
    seat.aimWant.copy(want); // gewünschte Lafettenrichtung (Netz: Client → Host)
    _iq.copy(this.body.quat).invert();
    _b.copy(want).applyQuaternion(_iq);
    const yawH = Math.atan2(-_b.x, -_b.z);
    const pitchH = Math.asin(clamp(_b.y, -1, 1));
    const turretMult = this.zones.turret && this.zones.turret.hp <= 0 ? 0.5 : 1;
    if (seat.def.mount === 'gun') {
      m.turretYaw = wrap(approach(m.turretYaw, yawH, def.traverse * turretMult * dt));
      m.gunPitch = approach(m.gunPitch, clamp(pitchH, def.gunLimits.min, def.gunLimits.max), def.elevate * dt);
    } else if (seat.def.mount === 'cmg') {
      m.cmgYaw = wrap(approach(m.cmgYaw, wrap(yawH - m.turretYaw), 2.6 * dt));
      m.cmgPitch = approach(m.cmgPitch, clamp(pitchH, -0.17, 0.85), 2.0 * dt);
    } else if (seat.def.mount === 'mg') {
      m.mgYaw = wrap(approach(m.mgYaw, yawH, 3.2 * dt));
      m.mgPitch = approach(m.mgPitch, clamp(pitchH, def.mgLimits.min, def.mgLimits.max), 2.4 * dt);
    }
    this.muzzle(seat.index, _ro, _rd);
    seat.aimError = Math.acos(clamp(_rd.dot(want), -1, 1));
  }

  _updateWeapons(seat, dt) {
    const it = seat.intent;
    if (!seat.weapons.length) return;
    if (it.weapon != null && it.weapon >= 0 && it.weapon < seat.weapons.length && it.weapon !== seat.weaponIndex) {
      seat.weaponIndex = it.weapon;
      this.G.events.emit('vehicle:weapon', { vehicle: this, seat: seat.index, actor: seat.actor, weaponId: seat.weapons[seat.weaponIndex].def.id });
    }
    it.weapon = null;
    if (it.cycleWeapon) {
      it.cycleWeapon = false;
      seat.weaponIndex = (seat.weaponIndex + 1) % seat.weapons.length;
      this.G.events.emit('vehicle:weapon', { vehicle: this, seat: seat.index, actor: seat.actor, weaponId: seat.weapons[seat.weaponIndex].def.id });
    }
    for (const w of seat.weapons) {
      w.cooldown = Math.max(0, w.cooldown - dt);
      if (w.reloadT > 0) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) { w.reloadT = 0; w.mag = w.def.mag; }
      }
    }
    const w = seat.weapons[seat.weaponIndex];
    const shell = w.def.kind === 'shell';
    // MG: Magazin nachladen (R); Kanone: Ladeschütze/Automatik (crew.js)
    if (it.reload && !shell && w.mag < w.def.mag && w.reloadT <= 0) { w.reloadT = w.def.reload; this.G.events.emit('vehicle:reload', { vehicle: this, seat: seat.index, weaponId: w.def.id }); }
    it.reload = false;
    const frozen = !this.sys.live;
    const shooter = seat.actor || seat.proxy;
    // Kanone: Menschen (Spieler, entfernte Spieler) nur auf Druck, Bots auch gehalten
    const wants = shell ? (it.firePressed || (it.fire && shooter && !isHuman(shooter))) : it.fire;
    it.firePressed = false;
    if (frozen || !wants || !this.alive) return;
    if (it.fireWhenAligned && seat.aimError > 0.026) return;
    let fw = w;
    if (shell) {
      // gefeuert wird die geladene Granate, egal welche Sorte gewählt ist
      if (!this.gun || this.gun.step !== 'geladen' || !this.gun.loaded || w.cooldown > 0) return;
      fw = seat.weapons.find((x) => x.def.id === this.gun.loaded) || { def: VEHICLE_WEAPONS[this.gun.loaded], mag: 1, reloadT: 0, cooldown: 0, shots: 0 };
    } else if (w.mag <= 0 || w.reloadT > 0 || w.cooldown > 0) return;
    this.muzzle(seat.index, _ro, _rd);
    const fseat = seat.actor ? seat : Object.create(seat, { actor: { value: shooter } });
    this.sys.fire(this, fseat, fw, _ro.clone(), _rd.clone());
    fw.shots += 1;
    if (shell) {
      w.cooldown = fw.cooldown = 0.25;
      onGunFired(this);
    } else {
      w.mag -= 1;
      w.cooldown = 60 / w.def.rpm;
      if (w.mag <= 0) { w.reloadT = w.def.reload; this.G.events.emit('vehicle:reload', { vehicle: this, seat: seat.index, weaponId: w.def.id }); }
    }
    if (shell) {
      this.recoil = 1;
      // Rückstoß auf die Wanne
      _a.copy(_rd).multiplyScalar(-this.def.mass * 0.25);
      this.body.applyImpulse(_ro, _a);
    }
  }

  /* --------------------------------------------------------------- Schaden */

  /** Trefferzone aus lokalem Punkt ('hull'|'engine'|'tracks'|'turret'). */
  zoneAt(local, turretHit = false) {
    if (turretHit && this.zones.turret) return 'turret';
    const hb = this.def.hullBox;
    if (Math.abs(local.x) > hb[3] - 0.45 && local.y < (this.type === 'mbt' ? 1.0 : 0.95)) return 'tracks';
    if (this.type === 'mbt' ? local.z > 1.7 : local.z < -1.0) return 'engine';
    return 'hull';
  }

  /** Strahl gegen Wanne (+ Turm). → { distance, point, normal, surface, object, vehicle, zone, face } */
  raycast(origin, dir, maxDist = 1000) {
    if (!this.model.root.parent) return null;
    const def = this.def, b = this.body;
    // Grobe Kugelprüfung
    const r = Math.hypot(def.hullBox[3], def.hullBox[4] + 1, def.hullBox[5]) + 0.5;
    _a.copy(b.pos).sub(origin);
    const tca = _a.dot(dir);
    if (tca < -r || _a.lengthSq() - tca * tca > r * r || tca - r > maxDist) return null;
    _iq.copy(b.quat).invert();
    b.toLocal(origin, _ro);
    _rd.copy(dir).applyQuaternion(_iq);
    const hb = def.hullBox;
    let best = rayBox(_ro, _rd, hb[0], hb[1], hb[2], hb[3], hb[4], hb[5], maxDist);
    let turretHit = false;
    let tq = null;
    if (def.turretBox) {
      tq = _q.setFromAxisAngle(Y, -this.mount.turretYaw);
      const o2 = _b.copy(_ro).sub(_c.fromArray(def.turretPivot)).applyQuaternion(tq);
      const d2 = _n.copy(_rd).applyQuaternion(tq);
      const tb = def.turretBox;
      const h2 = rayBox(o2, d2, tb[0], tb[1], tb[2], tb[3], tb[4], tb[5], best ? best.t : maxDist);
      if (h2) { best = h2; turretHit = true; }
    }
    if (!best) return null;
    const local = _b.copy(_ro).addScaledVector(_rd, best.t);
    const ln = _n.set(best.nx, best.ny, best.nz);
    if (turretHit) ln.applyQuaternion(_q2.setFromAxisAngle(Y, this.mount.turretYaw));
    const face = ln.y > 0.7 ? 'top' : ln.z < -0.7 ? 'front' : ln.z > 0.7 ? 'rear' : 'side';
    const zone = this.zoneAt(local, turretHit);
    const point = new THREE.Vector3().copy(origin).addScaledVector(dir, best.t);
    const normal = ln.clone().applyQuaternion(b.quat);
    return { distance: best.t, point, normal, surface: 'metal', object: this.model.root, vehicle: this, zone, face, localNormal: ln.clone() };
  }

  /** Feindlich gegenüber einem Angreifer? (Teamschaden aus wie bei Akteuren) */
  hostileTo(actor) {
    if (!actor) return true;
    if (this.seatOf(actor) >= 0) return false;
    const t = this.team;
    if (t == null || actor.team == null) return true;
    return t !== actor.team;
  }

  /**
   * Schaden anwenden. info: { attacker, weaponId, zone, kind: 'bullet'|'explosive'|'shell'|'collision'|'fire', point, dir }
   * @returns {number} verrechneter Schaden
   */
  applyDamage(amount, info = {}) {
    if (!this.alive || !(amount > 0)) return 0;
    const attacker = info.attacker || null;
    if (attacker && !this.hostileTo(attacker) && info.kind !== 'fire' && info.kind !== 'collision') return 0;
    const now = this.G.time.elapsed;
    const before = this.health;
    this.health = Math.max(0, this.health - amount);
    const dealt = before - this.health;
    const zone = this.zones[info.zone] ? info.zone : 'hull';
    const z = this.zones[zone];
    if (zone !== 'hull') {
      const was = z.hp;
      z.hp = Math.max(0, z.hp - amount * 1.2);
      if (was > 0 && z.hp <= 0) this._zoneBroken(zone);
    }
    this.zones.hull.hp = this.health;
    if (dealt >= 60 && this.gun) dropShell(this); // schwerer Treffer: Ladeschütze lässt die Granate fallen
    if (info.kind !== 'fire') { this.lastHitTime = now; }
    if (attacker) { this.lastAttacker = attacker; this.lastWeaponId = info.weaponId || null; }
    this.body.wake();
    this.G.events.emit('vehicle:damaged', { vehicle: this, amount: dealt, attacker, zone, weaponId: info.weaponId || null, kind: info.kind || 'bullet', health: this.health, point: info.point || null });
    if (this.health <= 0) { this.destroy(attacker || this.lastAttacker, info.weaponId || this.lastWeaponId); return dealt; }
    if (!this.disabled && this.health < this.maxHealth * 0.2) {
      this.disabled = true;
      this.G.events.emit('vehicle:disabled', { vehicle: this, attacker });
    }
    return dealt;
  }

  _zoneBroken(zone) {
    if (zone === 'tracks') this.trackDownUntil = this.G.time.elapsed + 6;
    this.G.events.emit('vehicle:component', { vehicle: this, zone, broken: true });
  }

  /** Reparatur (Reparaturbrenner/Bots/Modi): +amount HP, Zonen anteilig. → reparierte HP */
  repair(amount, by = null) {
    if (!this.alive || !(amount > 0)) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    for (const z of Object.values(this.zones)) if (z.id !== 'hull') z.hp = Math.min(z.max, z.hp + amount * (z.max / this.maxHealth) * 2);
    this.zones.hull.hp = this.health;
    if (this.disabled && this.health >= this.maxHealth * 0.2) this.disabled = false;
    const healed = this.health - before;
    if (healed > 0) this.G.events.emit('vehicle:repair', { vehicle: this, amount: healed, by });
    return healed;
  }

  destroy(by = null, weaponId = null) {
    if (!this.alive) return;
    const G = this.G;
    this.alive = false;
    this.health = 0;
    this.disabled = true;
    this.wreck = true;
    this.wreckLeft = this.def.wreckTime;
    const center = this.body.pos.clone();
    // Insassen: geschützte wie offene Sitze sterben
    for (const s of this.seats) {
      const a = s.actor;
      if (!a) continue;
      this.sys.removeFromSeat(a, { teleport: false });
      if (!a.alive) continue;
      let dealt = 0;
      if (by && G.combat.isHostile(by, a)) dealt = G.combat.damage(a, { amount: 999, attacker: by, weaponId: weaponId || 'vehicle_explosion', explosive: true, point: center, zone: 'body' });
      if (a.alive && !dealt) G.combat.damage(a, { amount: 999, attacker: null, weaponId: 'vehicle_explosion', explosive: true, point: center, zone: 'body' });
    }
    this.sys.ownExplosion(() => G.combat.explode({ position: center, radius: this.type === 'mbt' ? 7 : 6, maxDamage: 110, attacker: by, weaponId: 'vehicle_explosion', type: 'frag' }));
    // Wrack: Turm springt, leichte Fahrzeuge hüpfen
    this.model.setWreck(true);
    if (this.model.turret) {
      this.model.turret.position.y += 0.18;
      this.model.turret.rotation.z = (Math.random() - 0.5) * 0.25;
      this.mount.turretYaw += (Math.random() - 0.5) * 1.2;
      this.mount.gunPitch = -0.12;
    }
    const kick = this.type === 'mbt' ? 1.5 : 6.5;
    this.body.applyImpulse(_a.copy(center).add(_b.set((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 2)), _c.set(0, this.def.mass * kick, 0));
    this.body.controls.throttle = this.body.controls.steer = 0;
    this.body.controls.handbrake = true;
    this.body.drivetrain?.setGear(0);
    G.events.emit('vehicle:destroyed', { vehicle: this, by, weaponId: weaponId || null });
  }

  /* --------------------------------------------------------------- Takt */

  update(dt, world) {
    const G = this.G, def = this.def, b = this.body, now = G.time.elapsed;
    // Fahrer → Steuerung (Getriebe: Mensch nach Einstellung, Bots/Autopilot Automatik; drivetrain.js)
    const ds = this.seats.find((s) => s.def.drive);
    const c = b.controls, dtn = b.drivetrain;
    if (dtn && !dtn.onGear) dtn.onGear = (gear, blocked) => G.events.emit('vehicle:gear', { vehicle: this, gear, blocked: !!blocked });
    if (this.alive && ds && ds.actor && this.sys.live && !(ds.readyAt > now)) {
      const it = ds.intent;
      const human = !!(ds.actor.isPlayer || ds.actor.isRemoteHuman);
      const manual = Math.abs(it.throttle) > 0.01 || Math.abs(it.steer) > 0.01 || it.handbrake || it.brake > 0;
      if ((it.path || it.moveTo) && it.autopilot !== false && !(human && manual)) updateAutopilot(this, it, dt, world);
      const autoDrive = !human || ((it.path || it.moveTo) && it.autopilot !== false && !manual);
      c.gearbox = !autoDrive && b.tracked && it.gearbox === 'hold' ? 'hold' : 'auto';
      dtn?.run();
      const up = +it.shiftUp || 0, down = +it.shiftDown || 0;
      if (up || down) {
        if (c.gearbox === 'hold' && dtn) { if (up) dtn.shift(Math.min(up, 7)); if (down) dtn.shift(-Math.min(down, 7)); }
        it.shiftUp = 0; it.shiftDown = 0;
        b.wake();
      }
      c.throttle = c.gearbox === 'hold' ? clamp(it.throttle, 0, 1) : clamp(it.throttle, -1, 1);
      // Lenkung geglättet (Tastatur) – Ketten direkt
      const st = clamp(it.steer, -1, 1);
      c.steer = b.tracked ? st : c.steer + clamp(st - c.steer, -dt * 4.5, dt * 4.5);
      c.brake = clamp(it.brake, 0, 1);
      c.handbrake = !!it.handbrake;
    } else {
      c.throttle = 0; c.steer = 0; c.brake = 0;
      c.handbrake = true;
      if (ds && ds.intent) { ds.intent.shiftUp = 0; ds.intent.shiftDown = 0; }
      dtn?.park(dt);
    }
    // Komponenten → Fahrleistung (Motor: Notlauf, Kette: erst bewegungsunfähig, dann max. 2. Gang; panzer-mp.md §A.9)
    const E = def.engine;
    let torque = 1, maxGear = 5, immobile = false, cutRpm = null;
    if (this.zones.engine && this.zones.engine.hp <= 0) { torque *= 0.5; cutRpm = Math.round(E.idleRpm + (E.ratedRpm - E.idleRpm) * 0.68); }
    if (this.zones.tracks && this.zones.tracks.hp <= 0) {
      if (now < this.trackDownUntil) immobile = true; else { torque *= 0.6; maxGear = 2; }
    }
    if (this.disabled) torque *= 0.35;
    if (!this.alive) immobile = true;
    b.mods.torque = torque;
    b.mods.maxGear = maxGear;
    b.mods.cutRpm = cutRpm;
    b.mods.immobile = immobile;
    b.mods.turnMult = immobile ? 0 : 1;

    // Lafetten + Waffen (Sitz mit Insasse oder Bot-Stellvertreter; nach einem Sitzwechsel bis readyAt inaktiv)
    if (this.alive) {
      this._proxyGunner();
      for (const s of this.seats) {
        if (!s.actor && !s.proxy) { s.intent.fire = false; continue; }
        if (now < (s.readyAt || 0)) { s.intent.fire = s.intent.firePressed = false; s.intent.reload = false; continue; }
        this._aimSeat(s, dt);
        this._updateWeapons(s, dt);
      }
      if (this.gun && this.sys.live) updateGun(this, dt);
    }

    // Physik
    b.update(dt, world);
    const imp = b.takeImpact();
    if (imp > 9 && this.alive) {
      this.applyDamage((imp - 9) * 9 * (def.ramMult ?? 1), { kind: 'collision', zone: 'hull', weaponId: 'vehicle_crash' });
      G.events.emit('vehicle:collide', { vehicle: this, speed: imp, position: b.pos.clone() });
    }
    if (b.upsideDown > 4 && this.alive && Math.abs(b.speed) < 2) b.rightUp();
    // Aus der Welt gefallen
    const bounds = world && world.bounds;
    if (bounds && this.alive && b.pos.y < bounds.min.y - 15) this.destroy(this.lastAttacker, this.lastWeaponId);

    // Brand / Selbstreparatur
    if (this.alive && this.disabled) {
      this._burnAcc += dt * 5;
      if (this._burnAcc >= 1) {
        const n = Math.floor(this._burnAcc);
        this._burnAcc -= n;
        this.applyDamage(n, { kind: 'fire', attacker: this.lastAttacker, weaponId: this.lastWeaponId || 'vehicle_explosion' });
      }
    } else if (this.alive && def.armored && now - this.lastHitTime > 10 && this.health < this.maxHealth * 0.4) {
      this.repair(Math.min(this.maxHealth * 0.4 - this.health, 12 * dt));
    }
    if (this.zones.tracks && this.zones.tracks.hp <= 0 && now > this.trackDownUntil + 8) this.zones.tracks.hp = this.zones.tracks.max * 0.3; // Notreparatur

    // Wrack-/Brandeffekte
    this._fxT -= dt;
    if ((this.disabled || this.wreck) && this._fxT <= 0 && G.effects) {
      this._fxT = this.wreck ? 0.22 : 0.3;
      const p = _a.copy(b.renderPos); p.y += this.type === 'mbt' ? 1.2 : 0.8;
      const fresh = this.wreck && this.wreckLeft > def.wreckTime - 9;
      G.effects.smoke?.(p, { count: fresh ? 3 : 2, color: 0x1c1a18, size: fresh ? 2.2 : 1.5, life: 3.5, rise: 2.2, alpha: 0.55 });
      if (fresh || (this.disabled && !this.wreck)) G.effects.smoke?.(p, { count: 1, color: 0xff7a2a, size: 0.8, life: 0.6, rise: 2.5, alpha: 0.45 });
    }
    if (this.wreck) this.wreckLeft -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 3.2);
  }

  /** Modell an die interpolierte Lage anpassen (nach update, vor dem Rendern). */
  sync(dt) {
    const b = this.body, M = this.model, m = this.mount, def = this.def;
    _a.copy(b.com).negate().applyQuaternion(b.renderQuat).add(b.renderPos);
    M.root.position.copy(_a);
    M.root.quaternion.copy(b.renderQuat);
    if (M.turret) {
      M.turret.rotation.y = m.turretYaw;
      if (M.gun) { M.gun.rotation.x = m.gunPitch; M.gun.position.z = def.gunPivot[2] + this.recoil * this.recoil * 0.45; }
      if (M.cmg) { M.cmg.rotation.set(m.cmgPitch, m.cmgYaw, 0, 'YXZ'); }
    }
    if (M.mg) M.mg.rotation.set(m.mgPitch, m.mgYaw, 0, 'YXZ');
    if (M.wheels.length) {
      const W = def.wheels, my = this.body.wheels[0].local.y;
      // Rad-Zuordnung: Modellräder sind [achse0 links, achse0 rechts, achse1 links, …]; Körperräder [links: achsen…, rechts: achsen…]
      const nAx = W.z.length;
      for (const mw of M.wheels) {
        const bi = (mw.side < 0 ? 0 : nAx) + mw.axle;
        const bw = this.body.wheels[bi];
        if (!bw) continue;
        const comp = bw.contact ? bw.comp : 0;
        mw.pivot.position.y = my - W.rest + Math.min(comp, W.rest * 0.95);
        mw.pivot.rotation.y = -bw.steerAngle;
        if (mw.spin) mw.spin.rotation.x = -bw.spin;
      }
    }
    if (M.trackMats.length) M.scrollTracks(b.trackSpeed[0], b.trackSpeed[1], dt);
    if (M.lightsOn !== this.lights) M.setLights(this.lights);
    this._syncCrew(dt);
  }

  /**
   * Besatzungsdarstellung (läuft auch im Abbild, liest nur Zustand): Luken glätten (0,6 s, Schutz ab hatchT ≥ 0,5),
   * Innenraum für den lokalen Insassen, Verschlusskeil, Gestell, Granate in der Hand. Modell-API immer mit ?.
   */
  _syncCrew(dt) {
    const M = this.model, st = this._modelState;
    for (const s of this.seats) {
      const want = this.alive && s.hatchOpen ? 1 : 0;
      if (s.hatchT !== want) s.hatchT = want > s.hatchT ? Math.min(want, s.hatchT + dt / 0.6) : Math.max(want, s.hatchT - dt / 0.6);
      if (s._hatchId === undefined) s._hatchId = (viewsOf(s.def).find((v) => v.hatch) || {}).hatch || null;
      if (s._hatchId && st['h' + s.index] !== s.hatchT) { st['h' + s.index] = s.hatchT; M.setHatch?.(s._hatchId, s.hatchT); }
    }
    const p = this.G.player;
    const cv = this.sys && this.sys.camera ? this.sys.camera.view : null;
    const inside = !!(p && p.vehicle === this && cv && cv.interior && this.alive);
    if (st.interior !== inside) { st.interior = inside; M.setInterior?.(inside); }
    const g = this.gun;
    if (!g) return;
    const bw = g.breechOpen ? 1 : 0;
    st.breech = st.breech == null ? bw : bw > st.breech ? Math.min(1, st.breech + dt * 4) : Math.max(0, st.breech - dt * 4);
    if (st.breechSent !== st.breech) { st.breechSent = st.breech; M.setBreech?.(st.breech); }
    const rk = `${g.rack.mbt_ap}|${g.rack.mbt_he}`;
    if (st.rack !== rk) { st.rack = rk; M.setRack?.(g.rack); }
    if (st.held !== g.held) { st.held = g.held; M.setHeld?.(g.held); }
  }

  dispose() {
    this.model.dispose();
  }
}
