// NULLPUNKT — WeaponSystem (§7): erzeugt die WeaponController aller Akteure, simuliert Granaten,
// hilft Bots beim Granatwurf (Wurfwinkel, Gefahrenabfrage), schreibt dem Spieler Munition pro Abschuss gut
// und räumt beim Matchende auf.

import * as THREE from 'three';
import { WeaponController } from './controller.js';
import { GrenadeSystem, GRENADE_GRAVITY } from './grenades.js';
import { RocketSystem } from './ballistics/rockets.js';
import { EQUIPMENT as DATA_EQUIPMENT, killAmmoFor } from '../../shared/weapons.data.js';
import { clamp } from './ballistics/math.js';

export { WeaponController } from './controller.js';

const _eye = new THREE.Vector3();

export class WeaponSystem {
  constructor(G) {
    this.G = G;
    this.controllers = new Set();
    this.grenadeSystem = new GrenadeSystem(this);
    this.rocketSystem = new RocketSystem(this);
    /** Rauchwolken (Register): [{ position, radius (aktuell), maxRadius, born, until, grow, density, actor }] */
    this.smokes = [];
    this._subs = null;
    this._visWorld = null;
    this._killAmmoSeen = new WeakSet(); // Opfer, deren Tod schon Munition gebracht hat (bis zum Wiedereinstieg)
  }

  /** Aktive Granaten (nur lesen): [{ type, actor, position, velocity, fuse, radius, stuckTo, rest }] */
  get grenades() { return this.grenadeSystem.list; }
  /** Fliegende Projektile (Raketen, nur lesen): [{ pos, vel, actor, def, age }] */
  get projectiles() { return this.rocketSystem.list; }
  /** Brennende Flächen (Brandsatz, nur lesen): [{ position, radius, until, attacker, dps }] */
  get fires() { return this.grenadeSystem.fires; }

  /** Projektil-Waffe abfeuern (Controller): Rakete aus der Mündung in Richtung dir. */
  fireProjectile(actor, def, origin, dir, scale = 1, opts) {
    // Mehrspieler-Client: eigener Schuss → Meldung an den Host + Darstellungs-Rakete (Wirkung vom Host)
    const net = this._netClient(actor);
    if (net) return net.localRocket(actor, def, origin, dir);
    return this.rocketSystem.fire(actor, def, origin, dir, scale, opts);
  }

  /** Mehrspieler-Client-Synchronisation, wenn `actor` der lokale Spieler eines Online-Matches als Client ist (sonst null). */
  _netClient(actor) {
    const G = this.G;
    if (!actor || !actor.isPlayer || !G.match || G.match.netRole !== 'client') return null;
    const sync = G.net && G.net.sync;
    return sync && sync.role === 'client' && typeof sync.localThrow === 'function' ? sync : null;
  }

  /* ------------------------------------------------------------ Rauch-Register */

  /** Rauchwolke anlegen (Rauchgranate). spec = EQUIPMENT.smoke.smoke { radius, duration, grow, density }. */
  addSmoke(position, spec = {}, actor = null) {
    const now = this.G.time ? this.G.time.elapsed : 0;
    const s = {
      position: position.clone(), radius: 0.5, maxRadius: spec.radius || 5.5, born: now, until: now + (spec.duration || 16),
      grow: spec.grow || 2.6, density: spec.density || 0.9, actor,
    };
    this.smokes.push(s);
    this._installVisibility();
    this.G.events.emit('smoke:deploy', { position: s.position.clone(), radius: s.maxRadius, duration: spec.duration || 16, actor });
    return s;
  }

  /**
   * Sicht durch Rauch zwischen a und b: 1 = frei, → 0 = vollständig verdeckt (exp(−Dichte × Rauchstrecke)).
   * Für Bots (Wahrnehmung, Schussentscheidung), Namensschilder, Zielhilfe. Ohne Rauch: 1 (billig).
   */
  smokeVisibility(a, b) {
    const L = this.smokes;
    if (!L.length) return 1;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-8) return 1;
    let optical = 0;
    for (const s of L) {
      const r = s.radius;
      if (r <= 0.05) continue;
      // Wolke als Kugel, unten abgeflacht (Mittelpunkt etwas über dem Boden)
      const cx = s.position.x, cy = s.position.y + r * 0.45, cz = s.position.z;
      const fx = a.x - cx, fy = (a.y - cy) * 1.35, fz = a.z - cz;
      const ey = dy * 1.35;
      const A = dx * dx + ey * ey + dz * dz, B = fx * dx + fy * ey + fz * dz, C = fx * fx + fy * fy + fz * fz - r * r;
      const disc = B * B - A * C;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = Math.max(0, (-B - sq) / A), t1 = Math.min(1, (-B + sq) / A);
      if (t1 > t0) optical += (t1 - t0) * Math.sqrt(len2) * s.density * this._smokeFade(s);
    }
    return optical > 0 ? Math.exp(-optical) : 1;
  }

  /** Steht ein Punkt im Rauch? → Dichte 0..1 (Bots: Deckung suchen/nutzen, HUD). */
  smokeAt(p) {
    let best = 0;
    for (const s of this.smokes) {
      const d = Math.hypot(p.x - s.position.x, (p.y - s.position.y - s.radius * 0.45) * 1.35, p.z - s.position.z);
      if (d < s.radius) best = Math.max(best, (1 - d / s.radius) * this._smokeFade(s) + 0.3);
    }
    return Math.min(1, best);
  }

  _smokeFade(s) {
    const now = this.G.time ? this.G.time.elapsed : 0;
    const left = s.until - now;
    return left < 3 ? Math.max(0, left / 3) : 1;
  }

  _updateSmokes() {
    const L = this.smokes;
    if (!L.length) return;
    const now = this.G.time.elapsed;
    for (let i = L.length - 1; i >= 0; i--) {
      const s = L[i];
      if (now >= s.until) { L.splice(i, 1); continue; }
      const k = Math.min(1, (now - s.born) / s.grow);
      s.radius = s.maxRadius * (0.25 + 0.75 * (1 - (1 - k) * (1 - k)));
    }
  }

  /**
   * world.visibility (Bot-Wahrnehmung 0..1, Großkarten: Wald) um den Rauch erweitern; Arena-Karten bekommen eine
   * world.visibility = Sichtlinie × Rauch. Beim Matchende wird das Original wiederhergestellt.
   */
  _installVisibility() {
    const w = this.G.world;
    if (!w || this._visWorld === w) return;
    this._uninstallVisibility();
    const own = Object.prototype.hasOwnProperty.call(w, 'visibility');
    const orig = w.visibility;
    const self = this;
    w.visibility = function visibilityWithSmoke(a, b) {
      const base = typeof orig === 'function' ? orig.call(w, a, b) : (w.lineOfSight ? (w.lineOfSight(a, b) ? 1 : 0) : 1);
      return base > 0 ? base * self.smokeVisibility(a, b) : base;
    };
    this._visWorld = w;
    this._visOrig = { own, orig };
  }

  _uninstallVisibility() {
    const w = this._visWorld;
    if (!w) return;
    const { own, orig } = this._visOrig || {};
    if (own) w.visibility = orig; else delete w.visibility;
    this._visWorld = null;
    this._visOrig = null;
  }

  attach(G) {
    this.G = G;
    this.detach(false);
    this._subs = G.events.scope();
    // Tod: gezogene Granate fällt (COD), laufende Aktionen enden
    this._subs.on('kill', ({ victim }) => {
      const w = victim && victim.weapon;
      if (w && typeof w.onDeath === 'function') w.onDeath();
    });
    // Munition pro Abschuss (nur der eigene Spieler, jedes Gerät für sich); ein Tod zählt bis zum Wiedereinstieg einmal
    this._killAmmoSeen = new WeakSet();
    this._subs.on('kill', (e) => this._killAmmo(e));
    this._subs.on('actor:spawn', ({ actor } = {}) => { if (actor) this._killAmmoSeen.delete(actor); });
    // Rüstung (core-mechanics): Platte einsetzen → Ego-Animation + Sperre im Controller
    this._subs.on('armor:plate', (e = {}) => {
      const w = e.actor && e.actor.weapon;
      if (!w) return;
      if (e.phase === 'cancel') { if (typeof w.cancelPlate === 'function') w.cancelPlate(); return; }
      if ((e.phase === undefined || e.phase === 'start') && typeof w.plateInsert === 'function') w.plateInsert(e.duration || 1.6);
    });
  }

  detach(disposeControllers = true) {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    this._killAmmoSeen = new WeakSet();
    this.grenadeSystem.clear();
    this.rocketSystem.clear();
    this.smokes.length = 0;
    this._uninstallVisibility();
    if (disposeControllers) for (const c of [...this.controllers]) c.dispose();
  }

  /* ------------------------------------------------------------ Munition pro Abschuss */

  /**
   * Gilt „Munition pro Abschuss“ im laufenden Match? Online entscheidet die Raum-Einstellung des Hosts (cfg.net.killAmmo,
   * Standard an), offline die Spieleinstellung killAmmo (Standard an). Schießstand/Waffenspiel und Modi mit
   * unendlicher Munition: nie.
   */
  killAmmoEnabled() {
    const G = this.G;
    const M = G.match;
    if (!M || M.modeId === 'training' || M.modeId === 'gun') return false;
    const m = G.mode;
    if (m && m.def && m.def.infiniteAmmo) return false;
    if (M.net) return M.net.killAmmo !== false;
    return !(G.settings && typeof G.settings.get === 'function' && G.settings.get('killAmmo') === false);
  }

  /**
   * Abschuss des eigenen Spielers → Munition für die Waffe des Abschusses (sonst die gehaltene bzw. erste Schusswaffe:
   * Messer, Granaten, Werfer, Fahrzeuge, Serien). Menge/Obergrenze: killAmmoFor(def) (shared/weapons.data.js).
   * Offline und Host: 'kill' aus combat.js; Client: 'kill' des Hosts (net/sync-client.js) mit dem eigenen Spieler als
   * Schütze – jedes Gerät schreibt nur sich selbst gut, Bots und Puppen nie. Kein Teamabschuss/Selbstmord; ein Tod zählt
   * bis zum Wiedereinstieg des Opfers nur einmal (doppelt zugestellte Meldung). Meldet 'ammo:pickup'
   * { actor, weaponId, amount, mag, reserve, source: 'kill' } (HUD „+30“) und spielt ein leises Aufnahme-Geräusch.
   */
  _killAmmo(e) {
    const G = this.G;
    const p = G.player;
    const v = e && e.victim;
    // Abschuss durch eigenes Wachgeschütz o. ä. zählt als eigener (Schütze = Besitzer der Serien-Entität)
    const killer = e.killer && e.killer.isStreakEntity ? e.killer.owner : e.killer;
    if (!p || !v || v === p || killer !== p || e.suicide || !p.alive) return;
    if (G.combat && typeof G.combat.isHostile === 'function' && !G.combat.isHostile(p, v)) return;
    if (!this.killAmmoEnabled()) return;
    const w = p.weapon;
    if (!w || !Array.isArray(w.slots) || typeof w.grantAmmo !== 'function') return;
    if (this._killAmmoSeen.has(v)) return;
    this._killAmmoSeen.add(v);
    const ok = (s) => !!s && !!s.def && killAmmoFor(s.def).amount > 0;
    let st = e.weaponId ? w.slots.find((s) => s.id === e.weaponId) : null;
    if (!ok(st)) st = ok(w.current) ? w.current : w.slots.find(ok);
    if (!st) return;
    const k = killAmmoFor(st.def);
    const got = w.grantAmmo(st, k.amount, { belt: k.belt, cap: k.cap });
    if (!got) return;
    G.events.emit('ammo:pickup', { actor: p, weaponId: st.id, amount: got.mag + got.reserve, mag: got.mag, reserve: got.reserve, source: 'kill' });
    const au = G.audio;
    if (au && typeof au.play === 'function') { try { au.play('reload_mag_in', { player: true, volume: 0.3, pitch: 1.18 }); } catch { /* Klang ist Beiwerk */ } }
  }

  createController(actor, loadout) {
    const c = new WeaponController(this, actor, loadout || {});
    this.controllers.add(c);
    if (actor && actor.isPlayer) c.warmup();
    return c;
  }

  update(dt) {
    this.grenadeSystem.update(dt);
    this.rocketSystem.update(dt);
    this._updateSmokes();
  }

  /* ------------------------------------------------------------ Granaten */

  /** Granate werfen. opts: { cook, drop, origin, dir, speed } */
  throwGrenade(actor, type, opts = {}) {
    // Mehrspieler-Client: Wurf an den Host melden, lokal nur eine Darstellungs-Granate (Zündung vom Host)
    const net = this._netClient(actor);
    if (net) return net.localThrow(actor, type || 'frag', opts);
    return this.grenadeSystem.throw(actor, type || 'frag', opts);
  }

  explodeInHand(actor, type) {
    const net = this._netClient(actor);
    if (net) { net.localThrow(actor, type || 'frag', { inHand: true }); return; }
    this.grenadeSystem.explodeInHand(actor, type || 'frag');
  }

  /**
   * Nächste gefährliche Granate für eine Position (Bots: ausweichen).
   * → { grenade, distance } | null — nur Granaten, deren Radius (+ margin) die Position erreicht.
   */
  dangerAt(position, margin = 1) {
    let best = null;
    let bd = Infinity;
    for (const g of this.grenadeSystem.list) {
      const d = g.position.distanceTo(position);
      if (d < g.radius + margin && d < bd) { bd = d; best = g; }
    }
    return best ? { grenade: best, distance: bd } : null;
  }

  /**
   * Wurfwinkel, damit eine Granate (ohne Abpraller) bei `target` landet.
   * → { yaw, pitch (Blick-Pitch für actor.pitch), reachable, flightTime }
   */
  grenadeAim(actor, target, type = 'frag') {
    const EQ = (this.G.data && this.G.data.EQUIPMENT) || DATA_EQUIPMENT;
    const eq = EQ[type] || EQ.frag;
    const s = (eq && eq.throwSpeed) || 18;
    const up = (eq && eq.throwPitch) || 0.18;
    actor.getEyePosition(_eye);
    const dx = target.x - _eye.x;
    const dz = target.z - _eye.z;
    const dy = target.y - (_eye.y - 0.06);
    const d = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    const g = GRENADE_GRAVITY;
    const s2 = s * s;
    const disc = s2 * s2 - g * (g * d * d + 2 * dy * s2);
    let elev;
    let reachable = true;
    if (disc < 0 || d < 1e-3) {
      elev = d < 1e-3 ? 1.2 : Math.PI / 4;
      reachable = d < 1e-3;
    } else {
      elev = Math.atan((s2 - Math.sqrt(disc)) / (g * d)); // flacher Bogen
    }
    const flightTime = d / Math.max(0.1, s * Math.cos(elev));
    return { yaw, pitch: clamp(elev - up, -1.3, 1.3), reachable, flightTime };
  }

  dispose() {
    this.detach(true);
    this.grenadeSystem.dispose();
    this.rocketSystem.dispose();
  }
}
