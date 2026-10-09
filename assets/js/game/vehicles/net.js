// NULLPUNKT — Fahrzeuge online (docs/planung/panzer-mp.md §C): Vermittler zwischen VehicleSystem und dem Netz (G.net).
//
// Host (replica = false): rechnet wie offline (Sim, Schaden, Brand, Wrack, Wiedererscheinen, Granaten, Laden) und
//   • vergibt Netz-Ids 1…255 (vehicle:spawn), schickt die Fahrzeugliste 'vehicles' {list:[[vid, typ, team, [netId je Sitz]]]}
//     bei Änderung an alle und voll an neue Clients (sync-host _admit);
//   • liefert je Schnappschuss-Takt die 60-Byte-Blöcke (blocks/blocksFor, Rate je Empfänger nach Abstand/Zustand);
//   • übernimmt die Sitz-Absicht eines Clients aus seinem Zustand (applyInput: Zähler-Flanken, Gas/Lenken, Zielrichtung,
//     Blick, Sicht) und prüft Anfragen 'veh' {a: enter|exit|seat|load} und Treffermeldungen 'vhit' (Anti-Cheat: Abstand,
//     Team, Sitz frei, Abstand zwischen Anfragen, Ausrüstung, Feuerrate über die Schussnummer);
//   • meldet 'ev' vs (Kanonenschuss, Darstellung bei allen), vh (Treffer an den Schützen), vn (Ablehnung), vo (Ausstieg).
// Client (replica = true, sys.remote = this): Abbild ohne Physik/Schaden/Spawns – Liste → Fahrzeuge und Sitze
//   (placeInSeat/clearSeat), Schnappschüsse puffern und mit der Abspieluhr der Puppen interpolieren (tickReplica), eigene
//   Sitz-Absicht als VEH_INPUT im 30-Hz-Zustand (inputState), Anfragen über enter/exit/seat/load.
import * as THREE from 'three';
import { VEHICLES, VEHICLE_IDS, VEHICLE_WEAPONS, staticComp } from './data.js';
import { WHY_TEXT, LOAD_TIMES, autoReload } from './crew.js';
import { falloff } from '../combat.js';

const HOST_ID = 1; // net/index.js HOST_ID (hier ohne Import: Fahrzeuge laden auch ohne Netzmodul)
const NEAR = 160; // m (xz): eigenes Fahrzeug und nähere bekommen jeden Takt einen Block
const FRESH = 1; // s nach dem Einstieg eines Clients: alle Blöcke jeden Takt
const REQ_GAP = 0.25; // s zwischen zwei Sitz-Anfragen (Einsteigen/Aussteigen/Wechsel) eines Clients
const ENTER_SLACK = 1.0; // m Zuschlag auf die Griffweite (Verzug zwischen Client und Host)
const REACH = 1.7;
const MAX_SAMPLES = 40;
const EXTRAPOLATE = 0.25; // s über den letzten Block hinaus fortschreiben
const SNAP = 5; // m: Sprung → setzen statt glätten
const SMOOTH_K = 10; // 1/s Abklingen des Glättungsversatzes
const CLOCK_STEER = 0.12;
const OWN_SOFT = 0.15; // rad: eigene Lafette weicht erst ab dieser Abweichung zum Host-Wert
const OWN_AHEAD = 0.1; // s: eigenes Fahrzeug so viel näher an der Host-Zeit abspielen (höchstens der Puffer)
const VHIT_GAP = 0.05; // s: Mindestabstand zweier Fahrzeugtreffer-Meldungen eines Clients (Feuerrate grob)
const AMMO = [null, 'mbt_ap', 'mbt_he'];
const STEPS = ['leer', 'gegriffen', 'eingeschoben', 'geladen'];
const BUSY_OF = { leer: 'greifen', gegriffen: 'einschieben', eingeschoben: 'schliessen' };
const LOAD_ACTIONS = new Set(['greifen', 'einschieben', 'schliessen', 'munition', 'weiter']);

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);
const nowSec = () => performance.now() / 1000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const lerp = (a, b, t) => a + (b - a) * t;
const ammoIdx = (id) => Math.max(0, AMMO.indexOf(id));
const teamCode = (t) => (t === 'A' ? 1 : t === 'B' ? 2 : 0);
const teamOf = (c) => (c === 1 ? 'A' : c === 2 ? 'B' : null);
const r3 = (v, d = 3) => [Math.round(v.x * 10 ** d) / 10 ** d, Math.round(v.y * 10 ** d) / 10 ** d, Math.round(v.z * 10 ** d) / 10 ** d];
const v3 = (a) => (Array.isArray(a) && a.length >= 3 && fin(a[0]) && fin(a[1]) && fin(a[2]) ? new THREE.Vector3(a[0], a[1], a[2]) : null);
/** Lafettenwinkel eines Fahrzeugs in Blockreihenfolge (KP-1: Turm, Rohr, Kommandanten-MG; GW-4: MG). */
const hasTurret = (def) => !!def.turretPivot;
/** MG-Plätze (Sitz, Waffenindex) in Sitzreihenfolge: mag0/mag1 im Block. */
function mgSlots(v) {
  if (v._mgSlots) return v._mgSlots;
  const out = [];
  for (const s of v.seats) s.weapons.forEach((w, i) => { if (w.def.kind === 'mg' && out.length < 2) out.push({ seat: s.index, w: i }); });
  return (v._mgSlots = out);
}
/** Sitze mit Waffen in Reihenfolge (sel bits0–1, bits2–3). */
function armedSeats(v) {
  if (v._armed) return v._armed;
  return (v._armed = v.seats.filter((s) => s.weapons.length).slice(0, 2));
}
const mgShots = (seat) => { let n = 0; for (const w of seat.weapons) if (w.def.kind === 'mg') n += w.shots | 0; return n & 255; };

export class VehicleNet {
  /**
   * @param {import('./index.js').VehicleSystem} sys
   * @param {{replica?: boolean}} opts replica: Client-Abbild (sonst Host)
   */
  constructor(sys, { replica = false } = {}) {
    this.sys = sys;
    this.G = sys.G;
    this.replica = !!replica;
    this.host = !replica;
    this._offs = [];
    // Host
    this._nextId = 1;
    this._listKey = '';
    this._dirty = true;
    this._fresh = new Map(); // Client → bis wann alle Blöcke jeden Takt
    this._reqAt = new Map(); // Client → letzte Sitz-Anfrage (s)
    this._vhitAt = new Map(); // Client → letzte Fahrzeugtreffer-Meldung (s)
    this._blocks = [];
    this._blockTick = -1;
    this.stats = { vehBytes: 0, vehBlocks: 0, lists: 0, inputs: 0, rejects: 0 };
    // Client
    this._samples = new Map(); // vid → [{t, s}] (auch für noch unbekannte vid)
    this._byVid = new Map(); // vid → Vehicle
    this._list = null; // letzte Liste (Sitze werden erneut abgeglichen, bis alle Akteure bekannt sind)
    this._unresolved = false;
    this._cnt = { up: 0, dn: 0, fire: 0, rel: 0, cyc: 0 };
    this._in = { vid: 0, seat: 0, throttle: 0, steer: 0, bits: 0, shift: 0, fireSeq: 0, act: 0, weapon: 255, view: 0, aimYaw: 0, aimPitch: 0, lookYaw: 0 };
    this._smooth = new Map();
    this._lastShots = new Map();
    this._subscribe();
  }

  get net() { return this.G.net; }
  get online() { return !!(this.G.net && this.G.net.online); }

  _subscribe() {
    const G = this.G, net = G.net;
    if (!net || typeof net.on !== 'function') return;
    if (this.host) {
      this._offs.push(
        net.on('veh', (m, from) => this._onRequest(m, from)),
        net.on('vhit', (m, from) => this._onVhit(m, from)),
        G.events.on('vehicle:spawn', (e) => { if (e && e.vehicle && !e.net) this._assignId(e.vehicle); this._dirty = true; }),
        G.events.on('vehicle:removed', () => { this._dirty = true; }),
        G.events.on('vehicle:enter', () => { this._dirty = true; }),
        G.events.on('vehicle:seat', () => { this._dirty = true; }),
        G.events.on('vehicle:exit', (e) => this._onExit(e)),
        G.events.on('vehicle:fire', (e) => this._onFire(e)),
        G.events.on('vehicle:hit', (e) => this._onHit(e)),
      );
    } else {
      this._offs.push(
        net.on('vehicles', (m, from) => { if (from === HOST_ID && m) this._onList(m.list); }),
        net.on('ev', (m, from) => { if (from === HOST_ID) this._onEv(m); }),
      );
      // vor dem Anschluss eingetroffene Liste (ClientSync puffert sie)
      const pend = net.sync && net.sync.lastVehicles;
      if (pend) this._onList(pend.list);
    }
  }

  dispose() {
    for (const off of this._offs) { try { off(); } catch { /* bereits gelöst */ } }
    this._offs = [];
    this._samples.clear();
    this._byVid.clear();
    this._smooth.clear();
    this._lastShots.clear();
    this._fresh.clear();
  }

  _send(to, msg) { const n = this.G.net; return n && n.online ? n.send(to, msg) : 0; }
  _puppet(id) { const b = this.G.bots && this.G.bots.byNetId(id); return b && b.isRemoteHuman ? b : null; }
  byNetId(vid) { return this.sys.list.find((v) => v.netId === vid) || null; }

  /* ====================================================================== Host */

  _assignId(v) {
    if (Number.isInteger(v.netId)) return;
    const used = new Set(this.sys.list.map((x) => x.netId));
    for (let k = 0; k < 255; k++) {
      const id = this._nextId;
      this._nextId = (id % 255) + 1;
      if (!used.has(id)) { v.netId = id; return; }
    }
  }

  /** Fahrzeugliste: [[vid, typ, team, [netId|0 je Sitz]], …] */
  _listNow() {
    const out = [];
    for (const v of this.sys.list) {
      if (!Number.isInteger(v.netId)) continue;
      out.push([v.netId, Math.max(0, VEHICLE_IDS.indexOf(v.type)), teamCode(v.spawnTeam), v.seats.map((s) => (s.actor && Number.isInteger(s.actor.netId) ? s.actor.netId : 0))]);
    }
    return out;
  }

  /** Host-Bild (sync-host postUpdate): Liste bei Änderung an alle. */
  hostTick() {
    if (!this.host || !this.online) return;
    if (!this._dirty) return;
    this._dirty = false;
    const list = this._listNow();
    const key = JSON.stringify(list);
    if (key === this._listKey) return;
    this._listKey = key;
    this.stats.lists++;
    this._send('all', { t: 'vehicles', list });
  }

  /** Neuer Client (sync-host _admit): volle Liste + 1 s alle Blöcke jeden Takt. */
  onAdmit(id) {
    if (!this.host) return;
    this._send(id, { t: 'vehicles', list: this._listNow() });
    this._fresh.set(id, nowSec() + FRESH);
  }

  onDrop(id) { this._fresh.delete(id); this._reqAt.delete(id); this._vhitAt.delete(id); }

  /** Blöcke aller Fahrzeuge für diesen Takt (einmal je Takt gebaut). → Array | null (keine Fahrzeuge) */
  blocks(tick) {
    if (!this.host) return null;
    const L = this.sys.list;
    if (!L.length) return null;
    if (this._blockTick === tick) return this._blocks.length ? this._blocks : null;
    this._blockTick = tick;
    const out = this._blocks;
    out.length = 0;
    for (const v of L) {
      if (!Number.isInteger(v.netId)) continue;
      if (!v._netBlock) {
        v._netBlock = { a: [0, 0, 0, 0], zones: [0, 0, 0], shots: [0, 0, 0, 0] };
        Object.defineProperty(v._netBlock, '_v', { value: v, enumerable: false });
      }
      out.push(this._block(v, v._netBlock));
    }
    return out.length ? out : null;
  }

  /**
   * Blöcke für einen Empfänger (Rate §C.4): eigenes und nahe (≤ 160 m) jeden Takt, übrige wache/besetzte 5 Hz, parkende
   * 1 Hz, ruhende Wracks 2 Hz; ein neuer Client 1 s lang alle. me = seine Puppe.
   */
  blocksFor(id, me, tick, all, interest = true) {
    if (!all) return null;
    if (!interest || (this._fresh.get(id) || 0) > nowSec()) return all;
    const out = [];
    const mp = me && me.position;
    const near2 = NEAR * NEAR;
    for (const b of all) {
      const v = b._v;
      if (me && me.vehicle === v) { out.push(b); continue; }
      const k = (tick + b.vid) | 0;
      if (v.wreck && v.body.sleeping) { if (k % 10 === 0) out.push(b); continue; }
      if (v.body.sleeping && v.alive && !v.disabled && !v.isOccupied) { if (k % 20 === 0) out.push(b); continue; }
      if (mp) { const dx = v.body.pos.x - mp.x, dz = v.body.pos.z - mp.z; if (dx * dx + dz * dz <= near2) { out.push(b); continue; } }
      if (k % 4 === 0) out.push(b);
    }
    return out.length ? out : null;
  }

  _block(v, o) {
    const G = this.G, b = v.body, m = v.mount, def = v.def, now = G.time.elapsed;
    o.vid = v.netId;
    o.kind = (Math.max(0, VEHICLE_IDS.indexOf(v.type)) & 15) | (teamCode(v.spawnTeam) << 4);
    const Z = v.zones;
    const zdead = (k) => !!(Z[k] && Z[k].hp <= 0);
    o.bits = (v.alive ? 1 : 0) | (v.wreck ? 2 : 0) | (v.disabled ? 4 : 0) | (v.lights ? 8 : 0) | (b.sleeping ? 16 : 0)
      | (zdead('tracks') && now < v.trackDownUntil ? 32 : 0) | (zdead('engine') ? 64 : 0) | (zdead('turret') ? 128 : 0);
    let seats = 0;
    v.seats.forEach((s, i) => { if (i < 4) { if (s.hatchOpen) seats |= 1 << i; if (now < (s.readyAt || 0)) seats |= 16 << i; } });
    o.seats = seats;
    o.x = b.pos.x; o.y = b.pos.y; o.z = b.pos.z;
    o.qx = b.quat.x; o.qy = b.quat.y; o.qz = b.quat.z; o.qw = b.quat.w;
    o.vx = b.vel.x; o.vy = b.vel.y; o.vz = b.vel.z;
    o.wy = b.angVel.y;
    if (hasTurret(def)) { o.a[0] = m.turretYaw; o.a[1] = m.gunPitch; o.a[2] = m.cmgYaw; o.a[3] = m.cmgPitch; }
    else { o.a[0] = m.mgYaw; o.a[1] = m.mgPitch; o.a[2] = 0; o.a[3] = 0; }
    o.hp = Math.max(0, Math.round(v.health));
    ['engine', 'tracks', 'turret'].forEach((k, i) => { o.zones[i] = Z[k] ? Math.round((Math.max(0, Z[k].hp) / Z[k].max) * 255) : 255; });
    const D = b.drive || {};
    o.gear = D.gear | 0;
    o.rpm = D.rpmNorm || 0;
    // drive: 0 Schaltpause, 1 Bremse, 2 Drehzahl zu niedrig, 3 Gang halten; bits4–7 Motorlast ×15 (Klang)
    o.drive = (D.shifting ? 1 : 0) | (b.controls && b.controls.brake > 0 ? 2 : 0) | (D.lugging ? 4 : 0) | (D.gearbox === 'hold' ? 8 : 0)
      | (Math.round(clamp(D.throttle || 0, 0, 1) * 15) << 4);
    for (let i = 0; i < 4; i++) o.shots[i] = v.seats[i] ? mgShots(v.seats[i]) : 0;
    const g = v.gun;
    if (g) {
      o.gun = ammoIdx(g.loaded) | (ammoIdx(g.held) << 2) | (Math.max(0, STEPS.indexOf(g.step)) << 4) | (g.breechOpen ? 128 : 0);
      o.busy = g.auto ? (g.autoMax > 0 ? 1 - g.autoT / g.autoMax : 0) : g.busy > 0 && g._busyMax > 0 ? 1 - g.busy / g._busyMax : 0;
      o.rackAP = g.rack.mbt_ap | 0; o.rackHE = g.rack.mbt_he | 0;
    } else { o.gun = 0; o.busy = 0; o.rackAP = 0; o.rackHE = 0; }
    const mg = mgSlots(v);
    const w0 = mg[0] && v.seats[mg[0].seat].weapons[mg[0].w], w1 = mg[1] && v.seats[mg[1].seat].weapons[mg[1].w];
    o.mag0 = w0 ? w0.mag | 0 : 0; o.mag1 = w1 ? w1.mag | 0 : 0;
    const arm = armedSeats(v);
    o.sel = ((arm[0] ? arm[0].weaponIndex : 0) & 3) | (((arm[1] ? arm[1].weaponIndex : 0) & 3) << 2)
      | (w0 && w0.reloadT > 0 ? 16 : 0) | (w1 && w1.reloadT > 0 ? 32 : 0) | (g && !autoReload(v) ? 64 : 0) | (g && g.auto ? 128 : 0);
    o.aux = g ? (ammoIdx(g.select) & 3) | (Math.min(63, Math.round(Math.max(0, g.autoT || 0) * 4)) << 2) : 0;
    return o;
  }

  /** Sitz-Absicht eines Clients aus seinem Zustand (sync-host _onFast). Nur, wenn die Puppe in vid/seat sitzt. */
  applyInput(p, vin) {
    if (!this.host || !p || !vin) return;
    const v = p.vehicle;
    if (!v || v.netId !== vin.vid || !p.alive) return;
    const idx = v.seatOf(p);
    if (idx < 0 || idx !== vin.seat) return;
    const seat = v.seats[idx], it = seat.intent;
    this.stats.inputs++;
    // Zähler: erster Zustand nach dem Einsteigen/Wechsel setzt nur den Bezug
    const key = `${vin.vid}:${idx}`;
    const c = p._vehIn;
    const up = vin.shift & 15, dn = (vin.shift >> 4) & 15, rel = vin.act & 15, cyc = (vin.act >> 4) & 15;
    if (!c || c.key !== key) { p._vehIn = { key, up, dn, fire: vin.fireSeq, rel, cyc, view: -1 }; }
    else {
      const d4 = (a, b) => Math.min(7, (a - b) & 15);
      const dUp = d4(up, c.up), dDn = d4(dn, c.dn), dRel = d4(rel, c.rel), dCyc = d4(cyc, c.cyc);
      const dFire = Math.min(7, (vin.fireSeq - c.fire) & 255);
      c.up = up; c.dn = dn; c.rel = rel; c.cyc = cyc; c.fire = vin.fireSeq;
      if (dUp) it.shiftUp = (+it.shiftUp || 0) + dUp;
      if (dDn) it.shiftDown = (+it.shiftDown || 0) + dDn;
      if (dFire) it.firePressed = true;
      if (dRel) it.reload = true;
      if (dCyc) it.cycleWeapon = true;
    }
    it.fire = (vin.bits & 1) !== 0;
    if (seat.def.drive) {
      const hold = (vin.bits & 16) !== 0;
      it.gearbox = hold ? 'hold' : 'auto';
      it.throttle = clamp(fin(vin.throttle) ? vin.throttle : 0, hold ? 0 : -1, 1);
      it.steer = clamp(fin(vin.steer) ? vin.steer : 0, -1, 1);
      it.brake = (vin.bits & 2) ? 1 : 0;
      it.handbrake = (vin.bits & 4) !== 0;
      it.path = null; it.moveTo = null;
      const lights = (vin.bits & 8) !== 0;
      if (v.lights !== lights && v.alive) v.lights = lights;
    }
    if (Number.isInteger(vin.weapon) && vin.weapon !== 255 && vin.weapon < seat.weapons.length) it.weapon = vin.weapon;
    if (seat.def.mount && fin(vin.aimYaw) && fin(vin.aimPitch)) {
      const yaw = vin.aimYaw, pitch = clamp(vin.aimPitch, -1.5, 1.5), cp = Math.cos(pitch);
      it.aimDir = (it.aimDir || new THREE.Vector3()).set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
      it.aimAt = null;
    }
    if (fin(vin.lookYaw)) seat.look.relYaw = wrap(vin.lookYaw);
    const pc = p._vehIn;
    if (vin.view !== pc.view) {
      pc.view = vin.view;
      if (vin.view !== seat.view) this.sys.setSeatView(p, vin.view);
    }
  }

  _reject(id, why) {
    this.stats.rejects++;
    this._send(id, { t: 'ev', e: 'vn', why });
  }

  /** Anfrage eines Clients ('veh' {a, v, s, k, am, ly}): prüfen und wie offline ausführen. */
  _onRequest(m, from) {
    const G = this.G, sys = this.sys;
    if (!this.host || !m || typeof m.a !== 'string' || !sys.attached) return;
    const p = this._puppet(from);
    if (!p) return;
    const now = nowSec();
    if (m.a === 'load') {
      const v = p.vehicle;
      if (!v || !p.alive) return;
      const seat = v.seats[v.seatOf(p)];
      const k = typeof m.k === 'string' && LOAD_ACTIONS.has(m.k) ? m.k : null;
      if (!seat || !seat.def.loader || !k) return this._reject(from, 'sitz');
      if (fin(m.ly)) seat.look.relYaw = wrap(m.ly); // Blick zum Zeitpunkt der Handlung (der Zustand kann später kommen)
      const am = typeof m.am === 'string' && VEHICLE_WEAPONS[m.am] && VEHICLE_WEAPONS[m.am].kind === 'shell' ? m.am : null;
      const r = typeof v.loadAction === 'function' ? v.loadAction(seat, k, am, { net: true }) : { ok: false, why: 'sitz' };
      if (r && r.ok === false && !(k === 'munition' && r.why === 'schritt')) this._reject(from, r.why || 'schritt');
      return;
    }
    if (now - (this._reqAt.get(from) || -1e9) < REQ_GAP) return this._reject(from, 'sperre');
    this._reqAt.set(from, now);
    if (!sys.live) return this._reject(from, 'sperre');
    switch (m.a) {
      case 'enter': {
        if (!p.alive || p.vehicle) return;
        const v = Number.isInteger(m.v) ? this.byNetId(m.v) : null;
        if (!v || !v.alive) return this._reject(from, 'tot');
        if (sys._boxDistance(v, p.position, 0.9) > REACH + ENTER_SLACK) return this._reject(from, 'weit');
        if (v.isOccupied && v.team != null && p.team != null && v.team !== p.team) return this._reject(from, 'feind');
        let s = Number.isInteger(m.s) && m.s >= 0 && m.s < v.seats.length ? m.s : null;
        if (s != null && v.seats[s].actor) s = null; // gewünschter Sitz belegt → erster freier
        if (!v.freeSeats().length) return this._reject(from, 'besetzt');
        const idx = sys.enter(p, v, s);
        if (idx < 0) this._reject(from, 'besetzt');
        return;
      }
      case 'exit': {
        if (!p.vehicle) return;
        if (!sys.exit(p)) this._reject(from, 'blockiert');
        return;
      }
      case 'seat': {
        const v = p.vehicle;
        if (!v || !p.alive) return;
        const idx = Number.isInteger(m.s) ? m.s : -1;
        if (idx < 0 || idx >= v.seats.length || idx === v.seatOf(p)) return;
        if (v.seats[idx].actor) return this._reject(from, 'besetzt');
        if (!sys.switchSeat(p, idx)) this._reject(from, 'besetzt');
        return;
      }
      default:
    }
  }

  /** Ausstieg eines Menschen: Lage an ihn ('vo', vor der Liste), Anti-Cheat-Anker neu. */
  _onExit(e) {
    this._dirty = true;
    const a = e && e.actor;
    if (!a || !a.isRemoteHuman || !Number.isInteger(a.netId) || !a.alive) return;
    const net = this.G.net;
    const pos = a.position;
    const vel = a.body && a.body.velocity ? a.body.velocity : _a.set(0, 0, 0);
    this._send(a.netId, { t: 'ev', e: 'vo', v: e.vehicle ? e.vehicle.netId : 0, pos: r3(pos, 2), vel: r3(vel, 2) });
    if (net && net.anticheat) net.anticheat.onTeleport(a.netId, [pos.x, pos.y, pos.z], net.serverTime());
    // Puppe: die gemeldete Pose (noch im Sitz) nicht mehr übernehmen, bis der Client sie neu schickt
    if (a._ownPose) { a._ownPose.pos[0] = pos.x; a._ownPose.pos[1] = pos.y; a._ownPose.pos[2] = pos.z; }
    if (a._ownRaw) { a._ownRaw.pos[0] = pos.x; a._ownRaw.pos[1] = pos.y; a._ownRaw.pos[2] = pos.z; }
    a._vehIn = null;
  }

  /** Kanonenschuss → 'vs' an alle (Darstellungsgranate, Mündungsfeuer, Klang, Rückstoß). MG läuft über die Schusszähler. */
  _onFire(e) {
    if (!e || !e.vehicle || !this.online) return;
    const def = VEHICLE_WEAPONS[e.weaponId];
    if (!def || def.kind !== 'shell' || !Number.isInteger(e.vehicle.netId)) return;
    const a = e.actor;
    this._send('all', { t: 'ev', e: 'vs', v: e.vehicle.netId, s: e.seat | 0, w: def.id, o: r3(e.origin, 2), d: r3(e.dir, 4), sh: a && Number.isInteger(a.netId) ? a.netId : 0 });
  }

  /** Treffer auf ein Fahrzeug durch einen Client → 'vh' an ihn (Treffermarker). */
  _onHit(e) {
    const a = e && e.attacker;
    if (!a || !a.isRemoteHuman || !Number.isInteger(a.netId) || !e.vehicle) return;
    this._send(a.netId, { t: 'ev', e: 'vh', v: e.vehicle.netId || 0, d: Math.round(e.amount || 0), z: e.zone || 'hull' });
  }

  /**
   * Treffermeldung eines Clients auf ein Fahrzeug ('vhit' {v, w, z, d, sr, o, p}): Infanteriewaffe in der Ausrüstung,
   * Ursprung ≤ 3,5 m vom Auge, Punkt ≤ Wanne + 2 m, Reichweite, grobe Feuerrate → Schaden wie offline (_onImpact).
   */
  _onVhit(m, from) {
    const G = this.G, sys = this.sys;
    if (!this.host || !m || !sys.attached) return;
    const p = this._puppet(from);
    if (!p || !p.alive || p.vehicle) return;
    const v = Number.isInteger(m.v) ? this.byNetId(m.v) : null;
    if (!v || !v.alive) return;
    const W = (G.data && G.data.WEAPONS) || {};
    const def = W[m.w];
    const sync = G.net && G.net.sync;
    if (!def || !def.damage || !sync || typeof sync._weaponsOf !== 'function' || !sync._weaponsOf(p, from).includes(def.id)) return;
    const now = nowSec();
    const gap = Math.max(VHIT_GAP, 60 / Math.max(60, (def.rpm || 600) * 1.2) * 0.5);
    if (now - (this._vhitAt.get(from) || -1e9) < gap) return;
    this._vhitAt.set(from, now);
    const o = v3(m.o), pt = v3(m.p);
    if (!o || !pt) return;
    p.getEyePosition(_a);
    if (o.distanceTo(_a) > 3.5) return;
    if (sys._boxDistance(v, pt, 0) > 2) return;
    const dist = o.distanceTo(pt);
    if (dist > (def.range || 400) * 1.1 + 5) return;
    const zone = v.zones[m.z] ? m.z : 'hull';
    let mult = v.def.smallArmsMult * (def.vehicleMult ? def.vehicleMult / 0.4 : 1);
    if (def.antiMateriel) mult = Math.max(mult, v.def.armored ? 0.15 : 1);
    if (mult <= 0) return;
    const fo = falloff(def, dist);
    const dealt = v.applyDamage(fo * mult, { attacker: p, weaponId: def.id, zone, kind: 'bullet', point: pt });
    if (dealt > 0) G.events.emit('vehicle:hit', { vehicle: v, attacker: p, amount: dealt, weaponId: def.id, zone });
  }

  /* ====================================================================== Client */

  /** Fahrzeugliste des Hosts → Fahrzeuge anlegen/entfernen, Sitze abgleichen. */
  _onList(list) {
    if (!this.replica || !Array.isArray(list) || !this.sys.attached) return;
    const sys = this.sys;
    const seen = new Set();
    this._list = [];
    for (const e of list) {
      if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < 1 || e[0] > 255) continue;
      const [vid, ti, tc, seats] = e;
      const type = VEHICLE_IDS[ti];
      if (!type || !VEHICLES[type]) continue;
      seen.add(vid);
      let v = this._byVid.get(vid);
      if (v && v.type !== type) { this._removeReplica(v); v = null; }
      if (!v) v = this._spawnReplica(vid, type, teamOf(tc));
      if (v) this._list.push({ v, seats: Array.isArray(seats) ? seats : [] });
    }
    for (const [vid, v] of [...this._byVid]) if (!seen.has(vid)) this._removeReplica(v);
    for (const vid of [...this._samples.keys()]) if (!seen.has(vid) && !this._byVid.has(vid)) { const L = this._samples.get(vid); if (!L.length || nowSec() - L.at > 5) this._samples.delete(vid); }
    void sys;
    this._applySeats();
  }

  _spawnReplica(vid, type, team) {
    const sys = this.sys;
    const L = this._samples.get(vid);
    const s = L && L.length ? L[L.length - 1].s : null;
    const pos = new THREE.Vector3(0, -500, 0);
    let yaw = 0;
    if (s) {
      _q.set(s.qx, s.qy, s.qz, s.qw);
      _f.set(0, 0, -1).applyQuaternion(_q);
      yaw = Math.atan2(-_f.x, -_f.z);
      pos.set(s.x, s.y, s.z);
      pos.sub(_a.fromArray(VEHICLES[type].com).applyQuaternion(_q));
    }
    const v = sys.spawnVehicle(type, pos, yaw, team);
    if (!v) return null;
    v.netId = vid;
    v._net = { gotSample: false, extra: null, fxT: 0, shots: [0, 0, 0, 0], shotsInit: false, hp: v.health };
    if (!s) v.model.root.visible = false; // erst mit dem ersten Block zeigen
    // Räder: Anzeige ohne Federsim (Ruhelage)
    const c0 = staticComp(v.def);
    for (const w of v.body.wheels) { w.contact = true; w.comp = c0; w.prevComp = c0; }
    v.body.sleeping = true;
    this._byVid.set(vid, v);
    return v;
  }

  _removeReplica(v) {
    const sys = this.sys;
    for (const s of v.seats) if (s.actor) sys.clearSeat(s.actor, { net: true });
    const i = sys.list.indexOf(v);
    if (i >= 0) sys.list.splice(i, 1);
    this._byVid.delete(v.netId);
    this._smooth.delete(v);
    v.dispose();
    this.G.events.emit('vehicle:removed', { vehicle: v, net: true });
  }

  _actor(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    const G = this.G;
    if (G.net && id === G.net.selfId) return G.player;
    return G.net && typeof G.net.actorById === 'function' ? G.net.actorById(id) : null;
  }

  /** Sitze laut Liste: wer nicht mehr (dort) sitzt, wird freigegeben; dann einbuchen. */
  _applySeats() {
    if (!this._list) return;
    const sys = this.sys;
    const want = new Map();
    let unresolved = false;
    for (const { v, seats } of this._list) {
      for (let i = 0; i < v.seats.length; i++) {
        const id = seats[i] | 0;
        if (!id) continue;
        const a = this._actor(id);
        if (!a) { unresolved = true; continue; }
        want.set(a, { v, i });
      }
    }
    this._unresolved = unresolved;
    for (const v of sys.list) {
      for (const s of v.seats) {
        const a = s.actor;
        if (!a) continue;
        const w = want.get(a);
        if (!w) sys.clearSeat(a, { net: true });
      }
    }
    for (const [a, w] of want) {
      if (a.vehicle === w.v && w.v.seatOf(a) === w.i) continue;
      if (a.isPlayer && !a.alive) continue;
      sys.placeInSeat(a, w.v, w.i, { net: true });
      if (a.isPlayer) this._cnt = { up: 0, dn: 0, fire: 0, rel: 0, cyc: 0 };
    }
  }

  /** Schnappschuss des Hosts (ClientSync._onFast): Blöcke puffern. t = Host-Zeit des Schnappschusses. */
  onSnapshot(t, blocks) {
    if (!this.replica) return;
    const now = nowSec();
    for (const s of blocks) {
      let L = this._samples.get(s.vid);
      if (!L) this._samples.set(s.vid, (L = []));
      if (L.length) {
        const last = L[L.length - 1];
        if (t <= last.t) continue;
        const g = t - last.t;
        if (g > 0 && g < 3) L.gap = L.gap ? L.gap * 0.7 + g * 0.3 : g;
      }
      L.push({ t, s });
      L.at = now;
      if (L.length > MAX_SAMPLES) L.splice(0, L.length - MAX_SAMPLES);
    }
  }

  /** Abbild: pro Bild vor tickReplica (VehicleSystem.update) – Flanken der eigenen Absicht einsammeln. */
  replicaFrame() {
    // Sitze erneut abgleichen, solange Akteure der Liste noch fehlen (Akteursliste kommt getrennt)
    if (this._unresolved && (this._seatT = (this._seatT || 0) + this.G.time.dt) > 0.5) { this._seatT = 0; this._applySeats(); }
    const p = this.G.player;
    const v = p && p.vehicle;
    if (!v) return;
    const seat = v.seats[v.seatOf(p)];
    if (!seat) return;
    const it = seat.intent, c = this._cnt;
    if (it.shiftUp) { c.up += +it.shiftUp | 0; it.shiftUp = 0; }
    if (it.shiftDown) { c.dn += +it.shiftDown | 0; it.shiftDown = 0; }
    if (it.firePressed) { c.fire++; it.firePressed = false; }
    if (it.reload) { c.rel++; it.reload = false; }
    if (it.cycleWeapon) { c.cyc++; it.cycleWeapon = false; }
  }

  /** Eigene Sitz-Absicht für den 30-Hz-Zustand (ClientSync.postUpdate). → VEH_INPUT-Objekt | null */
  inputState() {
    if (!this.replica) return null;
    const p = this.G.player;
    const v = p && p.vehicle;
    if (!v || !Number.isInteger(v.netId) || !p.alive) return null;
    const idx = v.seatOf(p);
    const seat = v.seats[idx];
    if (!seat) return null;
    const it = seat.intent, c = this._cnt, o = this._in;
    o.vid = v.netId; o.seat = idx;
    o.throttle = clamp(it.throttle || 0, -1, 1);
    o.steer = clamp(it.steer || 0, -1, 1);
    o.bits = (it.fire ? 1 : 0) | (it.brake > 0 ? 2 : 0) | (it.handbrake ? 4 : 0) | (v.lights ? 8 : 0) | (it.gearbox === 'hold' ? 16 : 0);
    o.shift = (c.up & 15) | ((c.dn & 15) << 4);
    o.fireSeq = c.fire & 255;
    o.act = (c.rel & 15) | ((c.cyc & 15) << 4);
    o.weapon = 255;
    o.view = seat.view | 0;
    const w = seat.aimWant;
    if (seat.def.mount && w && w.lengthSq() > 0.5) {
      o.aimYaw = Math.atan2(-w.x, -w.z);
      o.aimPitch = Math.asin(clamp(w.y, -1, 1));
    } else { o.aimYaw = 0; o.aimPitch = 0; }
    o.lookYaw = seat.look.relYaw || 0;
    return o;
  }

  /** Anfragen des eigenen Spielers (sys.remote). */
  enter(v, seatIdx = null) {
    if (!v || !Number.isInteger(v.netId)) return -1;
    this._send(HOST_ID, { t: 'veh', a: 'enter', v: v.netId, s: Number.isInteger(seatIdx) ? seatIdx : -1 });
    return -1;
  }
  exit() { this._send(HOST_ID, { t: 'veh', a: 'exit' }); return undefined; }
  seat(idx) { this._send(HOST_ID, { t: 'veh', a: 'seat', s: idx | 0 }); return undefined; }
  load(action, ammo = null) {
    const p = this.G.player, v = p && p.vehicle;
    const seat = v ? v.seats[v.seatOf(p)] : null;
    this._send(HOST_ID, { t: 'veh', a: 'load', k: action, am: ammo || null, ly: seat ? Math.round((seat.look.relYaw || 0) * 1000) / 1000 : 0 });
    return null;
  }

  /** Infanterietreffer des eigenen Spielers auf ein Abbild-Fahrzeug → Meldung an den Host (Schaden rechnet er). */
  claimHit(v, e) {
    if (!this.replica || !v || !Number.isInteger(v.netId) || !e) return;
    const p = this.G.player;
    if (!p || e.shooter !== p || p.vehicle) return;
    const W = (this.G.data && this.G.data.WEAPONS) || {};
    if (!W[e.weaponId]) return;
    const o = p.getEyePosition ? p.getEyePosition(_c) : p.position;
    this._send(HOST_ID, { t: 'vhit', v: v.netId, w: e.weaponId, z: e.zone || 'hull', d: Math.round(o.distanceTo(e.point) * 10) / 10, sr: p._shotSerial | 0, o: r3(o, 2), p: r3(e.point, 2) });
  }

  /** Ereignisse des Hosts: vs (Kanonenschuss), vh (Treffer), vn (Ablehnung), vo (Ausstieg). */
  _onEv(m) {
    if (!m || typeof m.e !== 'string' || !this.sys.attached) return;
    const G = this.G, sys = this.sys;
    switch (m.e) {
      case 'vs': {
        const v = this._byVid.get(m.v);
        const def = VEHICLE_WEAPONS[m.w];
        const o = v3(m.o), d = v3(m.d);
        if (!def || !o || !d) return;
        d.normalize();
        const shooter = this._actor(m.sh);
        sys.shells.fire(def, o, d, shooter, v || null, { display: true });
        G.effects?.muzzleFlash?.(o, d, { cls: 'sniper', scale: 3.4 });
        G.effects?.muzzleLight?.(o, 34, 3, 0.09, 20);
        G.effects?.smoke?.(_a.copy(o).addScaledVector(d, 1.2), { count: 7, size: 2.6, life: 2.4, rise: 0.35, alpha: 0.42 });
        const own = !!(v && G.player && G.player.vehicle === v);
        sys.audio.play('explosion', { position: own ? null : o, volume: own ? 0.8 : 1, pitch: 1.55, priority: 3 });
        sys.audio.play('boom_sub', { position: own ? null : o, volume: 1, priority: 3 });
        if (v) v.recoil = 1;
        if (own) { G.player.shake?.(def.shake || 0.5); G.input?.rumble?.(0.9, 0.6, 200); }
        G.events.emit('vehicle:fire', { vehicle: v || null, seat: m.s | 0, actor: shooter, weaponId: def.id, origin: o, dir: d, net: true });
        return;
      }
      case 'vh': // Treffermarker: index.js zeigt ihn für vehicle:hit mit dem eigenen Spieler als Angreifer
        G.events.emit('vehicle:hit', { vehicle: this._byVid.get(m.v) || null, attacker: G.player, amount: Number(m.d) || 0, zone: m.z || 'hull', net: true });
        return;
      case 'vn':
        if (typeof m.why === 'string') sys._flash(WHY_TEXT[m.why] || m.why);
        G.events.emit('vehicle:reject', { why: m.why, net: true });
        return;
      case 'vo': {
        const p = G.player;
        const pos = v3(m.pos);
        if (!p || !pos) return;
        if (p.vehicle) sys.clearSeat(p, { net: true });
        if (p.body) {
          if (typeof p.body.teleport === 'function') p.body.teleport(pos); else p.body.position.copy(pos);
          const vel = v3(m.vel);
          if (p.body.velocity) { if (vel) p.body.velocity.copy(vel); else p.body.velocity.set(0, 0, 0); }
        }
        const s = G.net && G.net.sync;
        if (s) s._sendAt = 0; // sofort melden
        return;
      }
      default:
    }
  }

  /** Abspielzeit (Host-Zeit) dieses Bildes – dieselbe Uhr wie die Puppen (ClientSync._playout). */
  _rt() {
    const s = this.G.net && this.G.net.sync;
    return s && s.clock ? s.clock.rt : null;
  }

  /**
   * Abbild eines Fahrzeugs für dieses Bild (statt Vehicle.update): Lage interpolieren, Zustand aus dem Block ≤ rt,
   * eigener Sitz zielt lokal (Turm folgt sofort), Effekte (MG-Schüsse, Wrack, Rauch).
   */
  tickReplica(v, dt) {
    const L = this._samples.get(v.netId);
    const rt = this._rt();
    const st = v._net || (v._net = { gotSample: false, extra: null, fxT: 0, shots: [0, 0, 0, 0], shotsInit: false, hp: v.health });
    const b = v.body;
    if (L && L.length && rt != null) {
      const sync = this.G.net && this.G.net.sync;
      const snapGap = (sync && sync._snapGap) || 0.05;
      const want = Math.min(0.4, Math.max(0, (L.gap || 0) - snapGap) * 1.1);
      if (st.extra == null) st.extra = want;
      else { const step = CLOCK_STEER * Math.max(0, dt); st.extra += clamp(want - st.extra, -step, step); }
      // eigenes Fahrzeug: bis zu 0,1 s weiter vorn abspielen (weniger Verzug beim Fahren; fortgeschrieben ≤ 0,25 s)
      const p0 = this.G.player;
      const ahead = p0 && p0.vehicle === v ? Math.min(OWN_AHEAD, sync && sync.clock ? sync.clock.buf || 0 : 0) : 0;
      const t = rt - st.extra + ahead;
      let i = L.length - 1;
      while (i >= 0 && L[i].t > t) i--;
      const A = i >= 0 ? L[i] : null;
      const B = i + 1 < L.length ? L[i + 1] : null;
      const s0 = A ? A.s : B.s;
      const s1 = A && B ? B.s : s0;
      const f = A && B ? clamp((t - A.t) / Math.max(1e-3, B.t - A.t), 0, 1) : 0;
      const ex = A && !B ? clamp(t - A.t, 0, EXTRAPOLATE) : 0;
      this._pose(v, s0, s1, f, ex, dt);
      this._state(v, A ? A.s : s0, dt);
      if (!st.gotSample) { st.gotSample = true; v.model.root.visible = true; }
    }
    // eigener Sitz: Lafette folgt lokal sofort (aimWant geht an den Host)
    const p = this.G.player;
    if (p && p.vehicle === v && v.alive) {
      const seat = v.seats[v.seatOf(p)];
      if (seat && seat.def.mount && this.G.time.elapsed >= (seat.readyAt || 0)) {
        this._softOwnMount(v, seat, dt);
        v._aimSeat(seat, dt);
      }
    }
    this._fx(v, dt);
    v.recoil = Math.max(0, v.recoil - dt * 3.2);
    void b;
  }

  /** Lage: Position/Quaternion/Geschwindigkeit interpolieren (bzw. ≤ 0,25 s fortschreiben), geglättet. */
  _pose(v, s0, s1, f, ex, dt) {
    const b = v.body;
    const x = lerp(s0.x, s1.x, f) + s0.vx * ex, y = lerp(s0.y, s1.y, f) + s0.vy * ex, z = lerp(s0.z, s1.z, f) + s0.vz * ex;
    _q.set(s0.qx, s0.qy, s0.qz, s0.qw);
    _q2.set(s1.qx, s1.qy, s1.qz, s1.qw);
    if (_q.dot(_q2) < 0) _q2.set(-_q2.x, -_q2.y, -_q2.z, -_q2.w);
    _q.slerp(_q2, f);
    if (ex > 0 && Math.abs(s0.wy) > 1e-4) _q.premultiply(_q2.setFromAxisAngle(Y, s0.wy * ex));
    _q.normalize();
    // Glättung: Abweichung von der erwarteten Bewegung klingt ab, Sprünge > 5 m setzen
    let sm = this._smooth.get(v);
    _a.set(x, y, z);
    if (!sm) { this._smooth.set(v, (sm = { o: new THREE.Vector3(), raw: _a.clone() })); }
    else {
      const vx = lerp(s0.vx, s1.vx, f), vy = lerp(s0.vy, s1.vy, f), vz = lerp(s0.vz, s1.vz, f);
      _b.set(x - sm.raw.x - vx * dt, y - sm.raw.y - vy * dt, z - sm.raw.z - vz * dt);
      sm.raw.copy(_a);
      const dev = _b.length();
      if (dev > SNAP) sm.o.set(0, 0, 0);
      else if (dev > 0.03) sm.o.sub(_b);
      sm.o.multiplyScalar(Math.exp(-SMOOTH_K * dt));
      if (sm.o.length() > SNAP) sm.o.set(0, 0, 0);
    }
    b.pos.set(x + sm.o.x, y + sm.o.y, z + sm.o.z);
    b.quat.copy(_q);
    b.prevPos.copy(b.pos); b.prevQuat.copy(b.quat);
    b.renderPos.copy(b.pos); b.renderQuat.copy(b.quat);
    b.vel.set(lerp(s0.vx, s1.vx, f), lerp(s0.vy, s1.vy, f), lerp(s0.vz, s1.vz, f));
    b.angVel.set(0, lerp(s0.wy, s1.wy, f), 0);
    b.forward(_f);
    const vF = b.vel.dot(_f);
    b.speed = vF;
    const W = v.def.wheels;
    if (b.tracked) {
      const wy = b.angVel.y, hx = (W && W.x) || 1.5;
      b.trackSpeed[0] = vF - wy * hx; b.trackSpeed[1] = vF + wy * hx;
    } else if (W) {
      // Räder: Drehung aus der Fahrt, Lenkwinkel aus der Gierrate genähert
      const wb = W.z && W.z.length > 1 ? Math.abs(W.z[0] - W.z[W.z.length - 1]) : 2.8;
      const steer = Math.abs(vF) > 0.5 ? clamp(Math.atan2(b.angVel.y * wb, Math.abs(vF)), -(W.maxSteer || 0.6), W.maxSteer || 0.6) : 0;
      for (const w of b.wheels) {
        w.spin = (w.spin + (vF * dt) / (W.radius || 0.4)) % (Math.PI * 2);
        w.steerAngle = w.steer ? -steer * Math.sign(vF || 1) : 0;
      }
    }
    const m = v.mount, def = v.def;
    const own = this._ownSeatMount(v);
    const ang = (k, i) => { if (own !== k) m[k] = wrap(s0.a[i] + wrap(s1.a[i] - s0.a[i]) * f); };
    if (hasTurret(def)) { ang('turretYaw', 0); if (own !== 'turretYaw') m.gunPitch = lerp(s0.a[1], s1.a[1], f); ang('cmgYaw', 2); if (own !== 'cmgYaw') m.cmgPitch = lerp(s0.a[3], s1.a[3], f); }
    else { ang('mgYaw', 0); if (own !== 'mgYaw') m.mgPitch = lerp(s0.a[1], s1.a[1], f); }
    if (own) { const hm = this._hostMount || (this._hostMount = { v: null, a: [0, 0, 0, 0] }); hm.v = v; for (let k = 0; k < 4; k++) hm.a[k] = s1.a[k]; }
  }

  /** Lafettenfeld des eigenen Sitzes (lokal gezielt) oder null. */
  _ownSeatMount(v) {
    const p = this.G.player;
    if (!p || p.vehicle !== v) return null;
    const seat = v.seats[v.seatOf(p)];
    const mt = seat && seat.def.mount;
    return mt === 'gun' ? 'turretYaw' : mt === 'cmg' ? 'cmgYaw' : mt === 'mg' ? 'mgYaw' : null;
  }

  /** Eigene Lafette: der lokale Wert bleibt (_aimSeat); weicht er > 0,15 rad vom Host ab, zieht er weich dorthin. */
  _softOwnMount(v, seat, dt) {
    const hm = this._hostMount, m = v.mount;
    if (!hm || hm.v !== v) return;
    const keys = seat.def.mount === 'gun' ? ['turretYaw', 'gunPitch'] : seat.def.mount === 'cmg' ? ['cmgYaw', 'cmgPitch'] : ['mgYaw', 'mgPitch'];
    const idx = hasTurret(v.def) ? (seat.def.mount === 'gun' ? [0, 1] : [2, 3]) : [0, 1];
    keys.forEach((k, j) => {
      const d = wrap(hm.a[idx[j]] - m[k]);
      if (Math.abs(d) > OWN_SOFT) m[k] = wrap(m[k] + d * Math.min(1, dt * 4));
    });
  }

  /** Diskrete Felder aus dem Block ≤ rt: Zustand, Schaden, Sitze, Getriebe, Kanone, Magazine, Schusszähler. */
  _state(v, s, dt) {
    const G = this.G, now = G.time.elapsed, st = v._net;
    const p = G.player;
    const own = !!(p && p.vehicle === v);
    const ownIdx = own ? v.seatOf(p) : -1;
    const alive = (s.bits & 1) !== 0;
    // Schaden
    const hp = s.hp;
    if (own && alive && hp < st.hp - 0.5) this.sys.hud && this.sys.hud.damaged && this.sys.hud.damaged();
    st.hp = hp;
    v.health = hp;
    ['engine', 'tracks', 'turret'].forEach((k, i) => { const z = v.zones[k]; if (z) z.hp = (s.zones[i] / 255) * z.max; });
    if (v.zones.hull) v.zones.hull.hp = hp;
    v.disabled = (s.bits & 4) !== 0;
    if ((s.bits & 32) !== 0) v.trackDownUntil = Math.max(v.trackDownUntil, now + 0.5);
    if (!(own && v.seats[ownIdx] && v.seats[ownIdx].def.drive)) v.lights = (s.bits & 8) !== 0; // eigener Fahrer schaltet selbst
    v.body.sleeping = (s.bits & 16) !== 0;
    if (v.alive && !alive) this._wreck(v);
    else if (!v.alive && alive) { v.alive = true; v.wreck = false; }
    if ((s.bits & 2) !== 0) v.wreck = true;
    // Sitze: Luke (fremde Sitze; die eigene Luke folgt der eigenen Sicht), Wechselsperre
    v.seats.forEach((seat, i) => {
      if (i >= 4) return;
      if (i !== ownIdx) seat.hatchOpen = (s.seats & (1 << i)) !== 0;
      const sw = (s.seats & (16 << i)) !== 0;
      if (sw) seat.readyAt = Math.max(seat.readyAt || 0, now + 0.05);
      else if ((seat.readyAt || 0) > now && i !== ownIdx) seat.readyAt = now;
    });
    // Getriebe
    const D = v.body.drive;
    if (D) {
      D.gear = s.gear;
      D.targetGear = s.gear;
      D.shifting = (s.drive & 1) !== 0;
      D.lugging = (s.drive & 4) !== 0;
      D.gearbox = (s.drive & 8) !== 0 ? 'hold' : 'auto';
      D.throttle = ((s.drive >> 4) & 15) / 15;
      D.rpmNorm = s.rpm;
      const E = v.def.engine || {};
      D.rpm = alive && (s.rpm > 0 || v.isOccupied) ? (E.idleRpm || 700) + s.rpm * ((E.ratedRpm || 2600) - (E.idleRpm || 700)) : 0;
    }
    v.body.controls.brake = (s.drive & 2) !== 0 ? 1 : 0;
    // Kanone
    const g = v.gun;
    if (g) {
      g.loaded = AMMO[s.gun & 3] || null;
      g.held = AMMO[(s.gun >> 2) & 3] || null;
      g.step = STEPS[(s.gun >> 4) & 7] || 'leer';
      g.breechOpen = (s.gun & 128) !== 0;
      g.rack.mbt_ap = s.rackAP; g.rack.mbt_he = s.rackHE;
      g.select = AMMO[s.aux & 3] || g.select;
      g.auto = (s.sel & 128) !== 0;
      g.autoT = ((s.aux >> 2) & 63) / 4;
      g.autoMax = g.auto && s.busy < 0.999 ? g.autoT / Math.max(0.001, 1 - s.busy) : g.autoT;
      const kind = !g.auto && s.busy > 0 ? BUSY_OF[g.step] : null;
      if (kind) { g._busyMax = LOAD_TIMES[kind]; g.busy = Math.max(0.01, (1 - s.busy) * g._busyMax); g.busyKind = kind; }
      else { g.busy = 0; g.busyKind = null; }
      // Meldung „Geladen“ (wie crew.finishLoad) beim Übergang
      if (st.step && st.step !== 'geladen' && g.step === 'geladen' && g.loaded) {
        g._msg = { text: `Geladen – ${g.loaded === 'mbt_he' ? 'SG' : 'PG'}`, until: now + 2 };
        G.events.emit('vehicle:loaded', { vehicle: v, ammo: g.loaded, net: true });
        if (own) this.sys.audio?.play?.('reload_bolt', { volume: 0.75, pitch: 0.55 });
      }
      st.step = g.step;
    }
    // Waffenwahl + Magazine
    const arm = armedSeats(v);
    if (arm[0]) arm[0].weaponIndex = Math.min(arm[0].weapons.length - 1, s.sel & 3);
    if (arm[1]) arm[1].weaponIndex = Math.min(arm[1].weapons.length - 1, (s.sel >> 2) & 3);
    const mg = mgSlots(v);
    const setMag = (slot, mag, rl) => { if (!slot) return; const w = v.seats[slot.seat].weapons[slot.w]; w.mag = mag; w.reloadT = rl ? Math.max(w.reloadT, 0.1) : 0; };
    setMag(mg[0], s.mag0, (s.sel & 16) !== 0);
    setMag(mg[1], s.mag1, (s.sel & 32) !== 0);
    // MG-Schüsse: Zuwachs der Zähler → Mündungsfeuer, Klang, Leuchtspur (nur Darstellung)
    for (let i = 0; i < 4 && i < v.seats.length; i++) {
      const n = s.shots[i];
      if (!st.shotsInit) { st.shots[i] = n; continue; }
      const d = Math.min(6, (n - st.shots[i]) & 255);
      st.shots[i] = n;
      if (d > 0 && alive) this._mgShots(v, i, d, n);
    }
    st.shotsInit = true;
    void dt;
  }

  _mgShots(v, si, n, total) {
    const G = this.G, sys = this.sys, seat = v.seats[si];
    const wi = seat.weapons.findIndex((w) => w.def.kind === 'mg');
    if (wi < 0) return;
    const w = seat.weapons[wi], def = w.def;
    v.muzzle(si, _a, _b, true, wi);
    G.effects?.muzzleFlash?.(_a, _b, { cls: 'lmg', actor: seat.actor || null, scale: 1.25 });
    const own = !!(G.player && G.player.vehicle === v && v.seatOf(G.player) === si);
    sys.audio.play(def.profile || 'lmg', { position: own ? null : _a, player: own, actor: seat.actor || null });
    if (own) G.player.shake?.(0.05);
    // Leuchtspur jede tracerEvery-te Kugel (Zählerstand des Hosts)
    const every = def.tracerEvery || 3;
    let tracer = false;
    for (let k = 0; k < n; k++) if (((total - k) & 255) % every === 0) tracer = true;
    if (!tracer || !sys.world) return;
    sys._ignore = v;
    const h = sys.world.raycast(_a, _b, def.range || 300);
    sys._ignore = null;
    const to = h && h.point ? h.point.clone() : _c.copy(_a).addScaledVector(_b, def.range || 300).clone();
    G.events.emit('tracer', { from: _a.clone(), to, actor: seat.actor || null, weaponId: def.id, net: true });
  }

  /** Zustandswechsel lebt → Wrack (wie Vehicle.destroy, nur Darstellung; Explosion kommt als 'ex'). */
  _wreck(v) {
    v.alive = false;
    v.health = 0;
    v.disabled = true;
    v.wreck = true;
    v.wreckLeft = v.def.wreckTime;
    v.model.setWreck?.(true);
    if (v.model.turret) {
      // Turmversatz: Zufall nur optisch (Lafettenwinkel kommen weiter vom Host)
      v.model.turret.position.y += 0.18;
      v.model.turret.rotation.z = (Math.random() - 0.5) * 0.25;
    }
    for (const s of v.seats) { s.hatchOpen = false; }
  }

  /** Rauch/Brand wie Vehicle.update (Abbild). */
  _fx(v, dt) {
    const G = this.G, st = v._net;
    st.fxT -= dt;
    if ((v.disabled || v.wreck) && st.fxT <= 0 && G.effects) {
      st.fxT = v.wreck ? 0.22 : 0.3;
      const p = _a.copy(v.body.renderPos); p.y += v.type === 'mbt' ? 1.2 : 0.8;
      const fresh = v.wreck && v.wreckLeft > v.def.wreckTime - 9;
      G.effects.smoke?.(p, { count: fresh ? 3 : 2, color: 0x1c1a18, size: fresh ? 2.2 : 1.5, life: 3.5, rise: 2.2, alpha: 0.55 });
      if (fresh || (v.disabled && !v.wreck)) G.effects.smoke?.(p, { count: 1, color: 0xff7a2a, size: 0.8, life: 0.6, rise: 2.5, alpha: 0.45 });
    }
    if (v.wreck) v.wreckLeft -= dt;
  }

  /** Prüf-/Konsolenhilfe: Zustand des Netzes. */
  info() {
    return {
      role: this.replica ? 'client' : 'host', vehicles: this.sys.list.map((v) => ({ vid: v.netId, type: v.type, team: v.spawnTeam, alive: v.alive, hp: Math.round(v.health), seats: v.seats.map((s) => (s.actor ? s.actor.netId ?? -1 : 0)) })),
      samples: [...this._samples.values()].reduce((n, L) => n + L.length, 0), stats: { ...this.stats },
    };
  }
}
