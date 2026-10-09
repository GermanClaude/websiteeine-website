// NULLPUNKT — Kampfauflösung (§5): Hitscan gegen Welt + Hitboxen, Schadensabfall, Trefferzonen,
// Durchschlag dünner Deckung, Assists, Abschuss-Ereignisse (Erstes Blut, Weitschuss, Rache, Kopfschuss),
// Serien, Explosionen mit Sichtlinienprüfung. Friendly Fire aus, Eigenschaden bei Explosionen an.
//
// Statistik-Zuständigkeit: combat zählt kills, deaths, assists, headshots, streak, bestStreak, damage,
// shotsFired (über 'weapon:fire'), shotsHit, longestKill sowie actor.weaponStats[id] = {kills, shots, hits, headshots}.
// Punkte (stats.score) und captures zählt der Modus.

import * as THREE from 'three';
import { isLongshot } from '../shared/modes.data.js';
import { createArmorState, absorbDamage, canInsertPlate, insertPlate, plateCount, classDef } from '../shared/classes.data.js';

const _ray = new THREE.Ray();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

/* ================================================================ Hitboxen */

/** Maße der Standard-Hitboxen (Meter, bezogen auf 1,8 m Stehhöhe). */
export const HUMANOID = Object.freeze({
  headRadius: 0.15, headFromTop: 0.17,
  torsoBottom: 0.95, torsoTop: 1.38, torsoRadius: 0.26,
  legBottom: 0.12, legTop: 0.8, legRadius: 0.2,
  standHeight: 1.8,
});

/** Strahl–Kugel: Abstand t ≥ 0 oder -1. */
export function raySphere(ro, rd, center, r) {
  const ox = ro.x - center.x, oy = ro.y - center.y, oz = ro.z - center.z;
  const b = ox * rd.x + oy * rd.y + oz * rd.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const s = Math.sqrt(h);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : -1; // Ursprung in der Kugel
}

/** Strahl–Kapsel (Segment pa–pb, Radius r): Abstand t ≥ 0 oder -1. */
export function rayCapsule(ro, rd, pa, pb, r) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  if (a > 1e-9) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  // Kappen
  const t1 = raySphere(ro, rd, pa, r);
  const t2 = raySphere(ro, rd, pb, r);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}

/**
 * Standard-Hitboxen eines Menschen (Kopf-Kugel, Torso-Kapsel, Bein-Kapsel) an actor.position (Füße),
 * Höhe aus actor.body.height (Ducken). Für Spieler und Bots ohne eigenes Skelett. Lehnt der Akteur
 * (actor.leanOffset, Weltversatz des Kopfes), wandern Kopf und Oberkörper mit.
 * → { distance, point, normal, zone } | null
 */
export function raycastHumanoid(actor, ray, maxDist = Infinity) {
  if (actor.proneBlend > 0.5) return raycastProne(actor, ray, maxDist);
  const p = actor.position;
  const h = actor.body ? actor.body.height : HUMANOID.standHeight;
  const k = h / HUMANOID.standHeight;
  const ro = ray.origin;
  const rd = ray.direction;

  // Grober Ausschluss über Hüllkugel
  _v1.set(p.x, p.y + h * 0.5, p.z);
  const bound = h * 0.5 + 0.35;
  if (raySphere(ro, rd, _v1, bound) < 0) return null;

  let best = -1;
  let zone = null;
  const center = _v3;
  // Lehnen (F5): Kopf um den vollen Versatz, Torso oben 70 %, unten 10 %, Beine nicht (Körper kippt in der Hüfte)
  const lo = actor.leanOffset;
  const lx = lo ? lo.x : 0, lz = lo ? lo.z : 0, ly = lo ? Math.min(0, lo.y || 0) : 0;

  // Kopf
  _v2.set(p.x + lx, p.y + h - HUMANOID.headFromTop + ly, p.z + lz);
  let t = raySphere(ro, rd, _v2, HUMANOID.headRadius);
  if (t >= 0 && t <= maxDist) { best = t; zone = 'head'; center.copy(_v2); }

  // Torso
  _pa.set(p.x + lx * 0.1, p.y + HUMANOID.torsoBottom * k, p.z + lz * 0.1);
  _pb.set(p.x + lx * 0.7, p.y + Math.min(HUMANOID.torsoTop * k, h - HUMANOID.headFromTop - 0.1) + ly * 0.7, p.z + lz * 0.7);
  t = rayCapsule(ro, rd, _pa, _pb, HUMANOID.torsoRadius);
  if (t >= 0 && t <= maxDist && (best < 0 || t < best)) { best = t; zone = 'body'; closestOnSegment(ro, rd, t, _pa, _pb, center); }

  // Beine
  _pa.set(p.x, p.y + HUMANOID.legBottom * k, p.z);
  _pb.set(p.x, p.y + HUMANOID.legTop * k, p.z);
  t = rayCapsule(ro, rd, _pa, _pb, HUMANOID.legRadius);
  if (t >= 0 && t <= maxDist && (best < 0 || t < best)) { best = t; zone = 'limb'; closestOnSegment(ro, rd, t, _pa, _pb, center); }

  if (best < 0) return null;
  const point = new THREE.Vector3().copy(rd).multiplyScalar(best).add(ro);
  const normal = new THREE.Vector3().subVectors(point, center);
  if (normal.lengthSq() < 1e-8) normal.copy(rd).negate(); else normal.normalize();
  return { distance: best, point, normal, zone };
}

/** Liegende Maße relativ zu den Füßen/Kapselmitte (m, entlang der Blickrichtung; − = hinten). */
export const PRONE = Object.freeze({
  head: { fwd: 0.12, y: 0.3, r: 0.15 },
  torso: { a: -0.12, b: -0.78, y: 0.2, r: 0.2 },
  legs: { a: -0.82, b: -1.55, y: 0.12, r: 0.13 },
  length: 1.62, // Abstand Kapselmitte → Fußspitzen (Platzbedarf hinten)
});

/** Liegende Trefferzonen (Kopf vorn, Rumpf und Beine waagerecht nach hinten entlang actor.yaw; Lehnen rollt seitlich). */
function raycastProne(actor, ray, maxDist) {
  const p = actor.position;
  const fx = -Math.sin(actor.yaw || 0), fz = -Math.cos(actor.yaw || 0);
  const ro = ray.origin;
  const rd = ray.direction;
  _v1.set(p.x - fx * 0.7, p.y + 0.25, p.z - fz * 0.7);
  if (raySphere(ro, rd, _v1, 1.05) < 0) return null;
  const lo = actor.leanOffset;
  const lx = lo ? lo.x : 0, lz = lo ? lo.z : 0;
  let best = -1;
  let zone = null;
  const center = _v3;
  const P = PRONE;
  _v2.set(p.x + fx * P.head.fwd + lx, p.y + P.head.y, p.z + fz * P.head.fwd + lz);
  let t = raySphere(ro, rd, _v2, P.head.r);
  if (t >= 0 && t <= maxDist) { best = t; zone = 'head'; center.copy(_v2); }
  _pa.set(p.x + fx * P.torso.a + lx * 0.6, p.y + P.torso.y, p.z + fz * P.torso.a + lz * 0.6);
  _pb.set(p.x + fx * P.torso.b + lx * 0.2, p.y + P.torso.y - 0.02, p.z + fz * P.torso.b + lz * 0.2);
  t = rayCapsule(ro, rd, _pa, _pb, P.torso.r);
  if (t >= 0 && t <= maxDist && (best < 0 || t < best)) { best = t; zone = 'body'; closestOnSegment(ro, rd, t, _pa, _pb, center); }
  _pa.set(p.x + fx * P.legs.a, p.y + P.legs.y, p.z + fz * P.legs.a);
  _pb.set(p.x + fx * P.legs.b, p.y + P.legs.y, p.z + fz * P.legs.b);
  t = rayCapsule(ro, rd, _pa, _pb, P.legs.r);
  if (t >= 0 && t <= maxDist && (best < 0 || t < best)) { best = t; zone = 'limb'; closestOnSegment(ro, rd, t, _pa, _pb, center); }
  if (best < 0) return null;
  const point = new THREE.Vector3().copy(rd).multiplyScalar(best).add(ro);
  const normal = new THREE.Vector3().subVectors(point, center);
  if (normal.lengthSq() < 1e-8) normal.copy(rd).negate(); else normal.normalize();
  return { distance: best, point, normal, zone };
}

function closestOnSegment(ro, rd, t, a, b, out) {
  out.copy(rd).multiplyScalar(t).add(ro);
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  let s = ((out.x - a.x) * abx + (out.y - a.y) * aby + (out.z - a.z) * abz) / len2;
  s = Math.max(0, Math.min(1, s));
  out.set(a.x + abx * s, a.y + aby * s, a.z + abz * s);
}

/* ================================================================== Combat */

// Wie leicht eine Oberfläche zu durchschlagen ist (max. Dicke in m bei penetration = 1).
const PENETRABLE = { wood: 0.45, glass: 0.6, fabric: 0.6, metal: 0.22, tile: 0.12, plaster: 0.18 };
const ASSIST_WINDOW = 6;
const ASSIST_MIN = 25;

export class Combat {
  constructor(G) {
    this.G = G;
    this._subs = null;
    this.firstBloodTaken = false;
    this.killCount = 0;
  }

  attach(G) {
    this.G = G;
    this.detach();
    this.firstBloodTaken = false;
    this.killCount = 0;
    this._subs = G.events.scope();
    this._subs.on('weapon:fire', ({ actor, weaponId }) => {
      if (!actor || !actor.stats) return;
      actor.stats.shotsFired = (actor.stats.shotsFired || 0) + 1;
      actor._shotSerial = (actor._shotSerial || 0) + 1;
      actor.lastFiredTime = G.time.elapsed;
      if (weaponId) wstat(actor, weaponId).shots += 1;
    });
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
  }

  /** FFA (team null): alle anderen sind feindlich; Teams: unterschiedliches Team. */
  isHostile(a, b) {
    if (!a || !b || a === b) return false;
    if (a.team == null || b.team == null) return true;
    return a.team !== b.team;
  }

  /**
   * Ein Hitscan-Strahl (eine Kugel/Schrotkugel).
   * args: { shooter, origin, dir, range, weapon (def), pelletIndex, damageScale = 1 }
   * → { hit: 'actor'|'world'|null, point, distance, target, zone, normal, surface, damage, penetrated }
   */
  fireHitscan({ shooter, origin, dir, range, weapon, pelletIndex = 0, damageScale = 1 }) {
    const G = this.G;
    const def = weapon || {};
    const maxRange = range || def.range || 100;
    _origin.copy(origin);
    _dir.copy(dir).normalize();
    _ray.set(_origin, _dir);

    let worldHit = G.world ? G.world.raycast(_origin, _dir, maxRange) : null;
    if (worldHit && worldHit.distance > maxRange) worldHit = null;
    let limit = worldHit ? worldHit.distance : maxRange;

    let actorHit = this._raycastActors(shooter, _ray, limit);
    let penetrated = false;
    let penFactor = 1;

    // Durchschlag: Kugel geht durch dünne, durchlässige Deckung und trifft dahinter.
    if (!actorHit && worldHit && (def.penetration || 0) > 0) {
      const exit = this._penetrate(worldHit, _dir, def.penetration);
      if (exit) {
        const remaining = maxRange - exit.distance;
        if (remaining > 0.1) {
          _ray.origin.copy(exit.point).addScaledVector(_dir, 0.02);
          const behindWorld = G.world.raycast(_ray.origin, _dir, remaining);
          const behindLimit = behindWorld ? behindWorld.distance : remaining;
          const hit = this._raycastActors(shooter, _ray, behindLimit);
          if (hit) {
            hit.distance += exit.distance + 0.02;
            actorHit = hit;
            penetrated = true;
            penFactor = def.penetration;
            G.events.emit('impact', { point: worldHit.point.clone(), normal: worldHit.normal.clone(), surface: worldHit.surface, shooter, weaponId: def.id, penetrated: true });
          }
          _ray.origin.copy(_origin);
        }
      }
    }

    this._whiz(shooter, _origin, _dir, actorHit ? actorHit.distance : limit);

    if (actorHit) {
      const { target, zone, point, distance, normal } = actorHit;
      const base = falloff(def, distance);
      const mult = zone === 'head' ? (def.headMult || 1.4) : zone === 'limb' ? (def.limbMult || 0.9) : 1;
      const amount = base * mult * damageScale * penFactor;
      // Treffer pro Schuss nur einmal zählen (Schrot)
      if (shooter && shooter.stats && shooter._lastHitSerial !== shooter._shotSerial) {
        shooter._lastHitSerial = shooter._shotSerial;
        shooter.stats.shotsHit = (shooter.stats.shotsHit || 0) + 1;
        if (def.id) wstat(shooter, def.id).hits += 1;
      }
      const dealt = this.damage(target, {
        amount, attacker: shooter, weaponId: def.id, zone, dir: _dir.clone(), point, distance, pelletIndex, origin: _origin,
      });
      return { hit: 'actor', point, distance, target, zone, normal, surface: 'flesh', damage: dealt, penetrated };
    }
    if (worldHit) {
      G.events.emit('impact', { point: worldHit.point, normal: worldHit.normal, surface: worldHit.surface || 'concrete', shooter, weaponId: def.id });
      return { hit: 'world', point: worldHit.point, distance: worldHit.distance, target: null, zone: null, normal: worldHit.normal, surface: worldHit.surface, damage: 0, penetrated: false };
    }
    return { hit: null, point: _v1.copy(_dir).multiplyScalar(maxRange).add(_origin).clone(), distance: maxRange, target: null, zone: null, damage: 0, penetrated: false };
  }

  _raycastActors(shooter, ray, maxDist) {
    const actors = this.G.actors;
    let best = null;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.alive || a === shooter || !this.isHostile(shooter, a) || typeof a.raycastHitboxes !== 'function') continue;
      // Schneller Ausschluss: Abstand Strahl ↔ Körpermitte (liegend: Mitte des Körpers hinter der Kapsel)
      _v1.copy(a.position);
      if (a.proneBlend > 0.5) { _v1.x += Math.sin(a.yaw || 0) * 0.7; _v1.z += Math.cos(a.yaw || 0) * 0.7; _v1.y += 0.25; } else _v1.y += 0.9;
      const o = ray.origin, d = ray.direction;
      const along = (_v1.x - o.x) * d.x + (_v1.y - o.y) * d.y + (_v1.z - o.z) * d.z;
      if (along < -1 || along > maxDist + 1.5) continue;
      if (ray.distanceSqToPoint(_v1) > 2.6) continue;
      const h = a.raycastHitboxes(ray, best ? best.distance : maxDist);
      if (h && h.distance <= (best ? best.distance : maxDist)) best = { ...h, target: a };
    }
    return best;
  }

  _penetrate(hit, dir, power) {
    const G = this.G;
    const k = PENETRABLE[hit.surface];
    if (!k) return null;
    const maxThick = k * Math.min(1, power);
    if (maxThick < 0.02) return null;
    // Von hinten zurück auf die Austrittsfläche messen.
    const probe = _v2.copy(hit.point).addScaledVector(dir, maxThick + 0.02);
    const back = G.world.raycast(probe, _v3.copy(dir).negate(), maxThick + 0.02);
    if (!back) return null;
    const thickness = maxThick + 0.02 - back.distance;
    if (thickness > maxThick || thickness <= 0) return null;
    return { point: back.point.clone(), distance: hit.distance + thickness, thickness };
  }

  /** Meldet nahe vorbeifliegende Kugeln am Spieler ('bullet:whiz'). */
  _whiz(shooter, origin, dir, length) {
    const p = this.G.player;
    if (!p || !p.alive || p === shooter || !this.isHostile(shooter, p)) return;
    const head = p.getEyePosition(_v1);
    const t = _v2.copy(head).sub(origin).dot(dir);
    if (t < 2 || t > length) return;
    _v3.copy(dir).multiplyScalar(t).add(origin);
    const d = _v3.distanceTo(head);
    if (d < 2.2 && d > 0.25) this.G.events.emit('bullet:whiz', { position: _v3.clone(), shooter, distance: d });
  }

  /**
   * Schaden zufügen. info: { amount, attacker, weaponId, zone, dir, point, explosive, distance }
   * Gibt den tatsächlich verrechneten Schaden zurück.
   */
  damage(target, info = {}) {
    const G = this.G;
    if (!target || !target.alive) return 0;
    // Mehrspieler-Client: Schaden entscheidet der Host. Eigene Treffer auf Puppen werden als Treffermeldung geschickt
    // (vorhergesagte Trefferanzeige), eigener Sturz-/Weltschaden als Meldung an sich selbst; alles andere ist nur Darstellung.
    if (G.match && G.match.netRole === 'client') {
      const sync = G.net && G.net.sync;
      return sync && typeof sync.claimDamage === 'function' ? sync.claimDamage(target, info) || 0 : 0;
    }
    const attacker = info.attacker || null;
    if (attacker && attacker !== target && !this.isHostile(attacker, target)) return 0; // Friendly Fire aus
    if (target.godMode || target.invulnerable) return 0;
    let amount = Number(info.amount) || 0;
    if (amount <= 0) return 0;
    const now = G.time.elapsed;
    const env = info.weaponId === 'fall' || info.weaponId === 'world';
    // Spielstil (Realistisch: mehr Schaden) und Klasseneigenschaft (Pionier: −20 % Explosionen)
    const flags = G.match && G.match.styleFlags;
    if (!env && flags) amount *= info.explosive ? flags.explosiveMult || 1 : flags.bulletMult || 1;
    if (info.explosive && target.cls) amount *= 1 - ((classDef(target.cls).perks || {}).explosiveResist || 0);
    // Panzerung: Weste/Helm nehmen ihren Anteil vorweg (Sturz/Welt umgeht sie)
    const zone = info.zone || 'body';
    let armorRes = null;
    const st = target.armor;
    if (!env && st && (st.hp > 0 || (zone === 'head' && st.helmetHp > 0))) {
      const def = G.data && G.data.WEAPONS ? G.data.WEAPONS[info.weaponId] : null;
      armorRes = absorbDamage(st, amount, { zone, explosive: !!info.explosive, weaponCls: def ? def.cls : null, distance: info.distance, perShot: amount });
      amount = armorRes.health;
    }
    const absorbed = armorRes ? armorRes.plates + armorRes.helmet : 0;
    const before = target.health;
    target.health = Math.max(0, target.health - amount);
    target.lastDamageTime = now;
    const dealt = before - target.health;
    const killed = target.health <= 0;

    if (attacker && attacker !== target) {
      if (attacker.stats) attacker.stats.damage = (attacker.stats.damage || 0) + dealt + absorbed;
      const log = target._damageLog || (target._damageLog = []);
      log.push({ attacker, amount: dealt + absorbed, time: now });
      if (log.length > 24) log.splice(0, log.length - 24);
    }

    const dir = info.dir ? info.dir.clone ? info.dir.clone() : info.dir : null;
    const payload = {
      target, attacker, amount: dealt, zone, dir, point: info.point || null,
      weaponId: info.weaponId || null, explosive: !!info.explosive, killed,
      armor: armorRes ? { absorbed, plates: plateCount(st), hp: st.hp, maxHp: st.maxHp, helmet: armorRes.helmet, broken: armorRes.broken, pierced: armorRes.pierced } : null,
    };
    if (armorRes && (absorbed > 0 || armorRes.pierced)) {
      G.events.emit('armor:hit', { target, attacker, absorbed, plates: plateCount(st), hp: st.hp, maxHp: st.maxHp, helmet: armorRes.helmet, helmetHp: st.helmetHp, zone, pierced: armorRes.pierced });
      if (armorRes.platesBroken > 0) G.events.emit('armor:broken', { target, attacker, kind: armorRes.broken ? 'vest' : 'plate', plates: plateCount(st) });
      if (armorRes.helmetBroken) G.events.emit('armor:broken', { target, attacker, kind: 'helmet', plates: plateCount(st) });
    }
    G.events.emit('actor:hit', payload);
    if (target.isPlayer) G.events.emit('player:damaged', { amount: dealt, dir, attacker });
    if (typeof target.onDamaged === 'function') target.onDamaged(payload);
    if (killed) this._kill(target, info);
    return dealt;
  }

  _kill(victim, info) {
    const G = this.G;
    const now = G.time.elapsed;
    const killer = info.attacker || null;
    const suicide = !killer || killer === victim;
    const headshot = info.zone === 'head' && !info.explosive;
    victim.alive = false;
    victim.health = 0;
    if (victim.stats) {
      victim.stats.deaths += 1;
      victim.stats.streak = 0;
    }

    let distance = Number.isFinite(info.distance) ? info.distance : 0;
    if (!distance && killer && !suicide) distance = killer.position.distanceTo(victim.position);

    let assisters = [];
    let firstBlood = false;
    let longshot = false;
    let revenge = false;
    let streak = 0;

    if (!suicide) {
      const ks = killer.stats;
      if (ks) {
        ks.kills += 1;
        ks.streak = (ks.streak || 0) + 1;
        ks.bestStreak = Math.max(ks.bestStreak || 0, ks.streak);
        if (headshot) ks.headshots += 1;
        ks.longestKill = Math.max(ks.longestKill || 0, Math.round(distance * 10) / 10);
        streak = ks.streak;
      }
      if (info.weaponId) {
        const w = wstat(killer, info.weaponId);
        w.kills += 1;
        if (headshot) w.headshots += 1;
      }
      if (!this.firstBloodTaken) { this.firstBloodTaken = true; firstBlood = true; }
      // Weitschuss nach denselben Klassen-Schwellen wie Punkte/Medaille (modes.data.js MEDAL_RULES.longshotByClass)
      const def = G.data && G.data.WEAPONS ? G.data.WEAPONS[info.weaponId] : null;
      longshot = !info.explosive && !!def && isLongshot(def.cls, distance);
      revenge = killer._lastKilledBy === victim;
      if (revenge) killer._lastKilledBy = null;
      victim._lastKilledBy = killer;

      // Assists: ≥ 25 Schaden in den letzten 6 s, nicht der Schütze
      const seen = new Map();
      for (const e of victim._damageLog || []) {
        if (now - e.time > ASSIST_WINDOW || e.attacker === killer || e.attacker === victim) continue;
        seen.set(e.attacker, (seen.get(e.attacker) || 0) + e.amount);
      }
      for (const [a, dmg] of seen) {
        if (dmg >= ASSIST_MIN && this.isHostile(a, victim)) {
          assisters.push(a);
          if (a.stats) a.stats.assists += 1;
        }
      }
    }
    victim._damageLog = [];
    this.killCount += 1;
    if (victim.armor) this.cancelPlate(victim);
    // Abschuss: eine Platte des Gegners aufnehmen (Reserve), sofern Platz
    const ka = !suicide && killer.armor;
    if (ka && ka.slots > 0 && ka.carry < ka.carryMax) {
      ka.carry += 1;
      G.events.emit('armor:pickup', { actor: killer, carry: ka.carry });
    }

    const deathInfo = {
      killer: suicide ? null : killer, weaponId: info.weaponId || null, headshot, explosive: !!info.explosive,
      dir: info.dir || null, point: info.point || null, distance,
    };
    if (typeof victim.onDeath === 'function') victim.onDeath(deathInfo);

    G.events.emit('kill', {
      victim, killer: suicide ? (killer === victim ? victim : null) : killer, weaponId: info.weaponId || null,
      headshot, explosive: !!info.explosive, assisters, streak, firstBlood, longshot, revenge,
      distance: Math.round(distance * 10) / 10, suicide,
    });
  }

  /**
   * Explosion mit Sichtlinienprüfung (Kopf/Brust/Füße), Eigenschaden an, Teamschaden aus.
   * { position, radius, maxDamage, attacker, weaponId, type, innerRadius?, minDamage?, source? }
   * source ('grenade'|'rocket', Mehrspieler): Herkunft im 'explosion'-Ereignis – der Host spielt sie über die Granate/Rakete nach.
   * concuss false: kein Gehör-Effekt beim Hörer (FPV-Drohne: der Hörer saß bis eben in der Drohne).
   */
  explode({ position, radius = 6, maxDamage = 150, attacker = null, weaponId = null, type = 'frag', innerRadius, minDamage, source, concuss }) {
    const G = this.G;
    const pos = position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z);
    const ev = { position: pos, radius, attacker, type, weaponId };
    if (source) ev.source = source;
    if (concuss === false) ev.concuss = false;
    G.events.emit('explosion', ev);
    const from = _v1.copy(pos);
    from.y += 0.15;
    const hits = [];
    for (const a of G.actors) {
      if (!a.alive) continue;
      if (attacker && a !== attacker && !this.isHostile(attacker, a)) continue;
      const chest = _v2.copy(a.position);
      chest.y += (a.body ? a.body.height : 1.8) * 0.55;
      const d = chest.distanceTo(pos);
      if (d > radius) continue;
      if (G.world && G.world.lineOfSight && !this._exposed(from, a)) continue;
      let dmg;
      if (Number.isFinite(innerRadius) && Number.isFinite(minDamage)) {
        dmg = d <= innerRadius ? maxDamage : maxDamage + (minDamage - maxDamage) * ((d - innerRadius) / Math.max(0.01, radius - innerRadius));
      } else {
        dmg = maxDamage * Math.pow(1 - d / radius, 1.35);
      }
      hits.push({ a, dmg, dir: chest.clone().sub(pos).normalize(), d });
    }
    for (const h of hits) {
      this.damage(h.a, { amount: h.dmg, attacker, weaponId, zone: 'body', dir: h.dir, point: pos, explosive: true, distance: h.d });
    }
    return hits.length;
  }

  /* ---------------------------------------------------------- Panzerung */

  /** Weste/Helm ausgeben (am Spawn; voll aufgefüllt). tier/helmet = ARMOR_TIERS-/HELMETS-ID. */
  equipArmor(actor, tier = 'keine', helmet = 'keine') {
    if (!actor) return null;
    actor.armor = createArmorState(tier, helmet);
    return actor.armor;
  }

  /** Platte einsetzen beginnen (Dauer = Stufe). chain = danach weitermachen, solange nötig. → true, wenn begonnen. */
  insertPlate(actor, { chain = false } = {}) {
    const s = actor && actor.armor;
    if (!s || !actor.alive || s.inserting || !canInsertPlate(s)) return false;
    s.inserting = { start: this.G.time.elapsed, dur: s.plateTime, chain };
    this.G.events.emit('armor:plate', { actor, phase: 'start', duration: s.plateTime, plates: plateCount(s), carry: s.carry, hp: s.hp });
    return true;
  }

  /** Einsetzen abbrechen (Platte bleibt in der Reserve). */
  cancelPlate(actor) {
    const s = actor && actor.armor;
    if (!s || !s.inserting) return false;
    s.inserting = null;
    this.G.events.emit('armor:plate', { actor, phase: 'cancel', duration: 0, plates: plateCount(s), carry: s.carry, hp: s.hp });
    return true;
  }

  /**
   * Je Bild (main): laufende Einsetzungen abschließen; Bots setzen nach 3 s ohne Schaden und ohne eigenen Schuss
   * selbst Platten ein (außer actor.manualPlates), ein eigener Schuss bricht bei Bots ab.
   */
  tickArmor(actors) {
    const G = this.G;
    const now = G.time.elapsed;
    for (const a of actors) {
      const s = a.armor;
      if (!s || s.slots <= 0) continue;
      const ins = s.inserting;
      if (ins) {
        if (!a.alive || (a.isBot && (a.lastFiredTime || -1e9) > ins.start)) { this.cancelPlate(a); continue; }
        if (now - ins.start < ins.dur) continue;
        s.inserting = null;
        insertPlate(s);
        G.events.emit('armor:plate', { actor: a, phase: 'end', duration: ins.dur, plates: plateCount(s), carry: s.carry, hp: s.hp });
        if (ins.chain && canInsertPlate(s)) this.insertPlate(a, { chain: true });
      } else if (a.isBot && a.alive && !a.manualPlates && canInsertPlate(s) && now - (a.lastDamageTime || -1e9) > 3 && now - (a.lastFiredTime || -1e9) > 2) {
        this.insertPlate(a, { chain: true });
      }
    }
  }

  _exposed(from, actor) {
    const w = this.G.world;
    const h = actor.body ? actor.body.height : 1.8;
    for (const f of [0.9, 0.5, 0.15]) {
      _v3.copy(actor.position);
      _v3.y += h * f;
      if (w.lineOfSight(from, _v3)) return true;
    }
    return false;
  }
}

/** Schaden pro Kugel auf Distanz (linearer Abfall zwischen rangeStart und rangeEnd, 0 jenseits range). */
export function falloff(def, distance) {
  const d = def.damage || { max: 25, min: 18, rangeStart: 20, rangeEnd: 40 };
  if (def.range && distance > def.range) return 0;
  if (distance <= d.rangeStart) return d.max;
  if (distance >= d.rangeEnd) return d.min;
  return d.max + (d.min - d.max) * ((distance - d.rangeStart) / Math.max(0.01, d.rangeEnd - d.rangeStart));
}

function wstat(actor, id) {
  const ws = actor.weaponStats || (actor.weaponStats = {});
  return ws[id] || (ws[id] = { kills: 0, shots: 0, hits: 0, headshots: 0 });
}
