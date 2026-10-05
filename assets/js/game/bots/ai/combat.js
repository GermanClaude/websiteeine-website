// NULLPUNKT — Kampfverhalten eines Bots: Zielauswahl (verteilt, keine Fixierung auf den Spieler),
// Zielmodell (Reaktionszeit, begrenzte Drehgeschwindigkeit mit Feder, Zielfehler der im Gefecht abklingt,
// Abstands-/Bewegungs-Malus, Rückstoß-Kompensation), Abzugsdisziplin (Feuerstöße, Takt bei Einzelfeuer,
// Repetierer im Anschlag), Anschlag auf Distanz, Freund-im-Schussfeld-Prüfung, Nahkampf, Bewegung im
// Gefecht (Seitwärts, Vor/Zurück auf Idealdistanz, Ducken-Spähen, seltener Sprungschuss).
import * as THREE from 'three';
import { targetPoints } from './perception.js';

const _p = new THREE.Vector3();
const _h = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const IDEAL_RANGE = { shotgun: 6, smg: 11, pistol: 12, ar: 20, lmg: 24, marksman: 32, sniper: 42, melee: 1 };

export class Gunner {
  constructor(bot) {
    this.bot = bot;
    this.reset();
  }

  reset() {
    this.rec = null;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.errX = 0; this.errY = 0; this.errTX = 0; this.errTY = 0; this.nextErrAt = 0;
    this.engagedAt = 0;
    this.reactAt = 0;
    this.aimHead = false;
    this.burstLeft = 0;
    this.pauseUntil = 0;
    this.nextTapAt = 0;
    this.lastShot = -1e9;
    this.lofOk = true;
    this.lofAt = 0;
    this.onTargetSince = 0;
    this.moveMode = 'hold';
    this.moveUntil = 0;
    this.strafe = 1;
    this.peekUntil = 0;
    this.hidden = false;
    this.recoilP = 0;
    this.recoilY = 0;
    this.lastSeenAim = new THREE.Vector3();
    this.idealAt = 0;
  }

  /* ---------------------------------------------------------------- Zielauswahl */

  selectTarget(now) {
    const bot = this.bot;
    const mgr = bot.manager;
    let best = null, bs = Infinity;
    for (const rec of bot.memory.map.values()) {
      const a = rec.actor;
      if (!a.alive || !rec.visible || rec.spot < 1) continue;
      const d = rec.pos.distanceTo(bot.position);
      let s = d;
      if (rec.partial) s *= 1.25;
      s *= 1 + 0.32 * mgr.targetCount(a, bot);
      if (now - rec.hurtMe < 2.5) s *= 0.5;
      if (a === (this.rec && this.rec.actor)) s *= 0.72;
      if (a.isStreakEntity) s *= 1.7;
      else if (aimingAt(a, bot, d)) s *= 0.7;
      if (s < bs) { bs = s; best = rec; }
    }
    return best;
  }

  /** Neues Ziel: Reaktionszeit, Kopf/Brust, Zielfehler zurücksetzen. */
  engage(rec, now) {
    const bot = this.bot;
    const D = bot.diff;
    const prev = this.rec;
    this.rec = rec;
    if (!rec) return;
    if (prev && prev.actor === rec.actor) return;
    const d = rec.pos.distanceTo(bot.position);
    // Reaktion: im Augenwinkel/aus der Bewegung länger, schon zuvor bekannt kürzer
    let r = D.reaction * rnd(0.8, 1.3);
    const dirYaw = Math.atan2(-(rec.pos.x - bot.position.x), -(rec.pos.z - bot.position.z));
    const off = Math.abs(wrap(dirYaw - bot.yaw));
    r *= 1 + Math.min(1, off / 1.5) * 0.6;
    if (now - rec.visibleSince > 1.5) r *= 0.6;
    if (d < 5) r *= 0.75;
    this.reactAt = now + r;
    this.engagedAt = now;
    this.aimHead = Math.random() < D.headshotChance;
    this.burstLeft = 0;
    this.pauseUntil = now + r * 0.3;
    this.onTargetSince = now;
    this.moveUntil = 0;
    // erster Zielfehler groß
    const mag = this._errMag(d, now);
    const a = Math.random() * Math.PI * 2;
    this.errX = this.errTX = Math.cos(a) * mag * 1.3;
    this.errY = this.errTY = Math.sin(a) * mag * 0.8;
  }

  clear() { this.rec = null; }

  _errMag(d, now) {
    const bot = this.bot;
    const D = bot.diff;
    let k = 1 + D.falloff * d;
    k *= 0.35 + 0.65 * Math.exp(-(now - this.engagedAt) / 1.15);
    const sp = Math.hypot(bot.body.velocity.x, bot.body.velocity.z);
    if (sp > 1) k *= 1.2 + Math.min(1, sp / 6) * 0.3;
    const w = bot.weapon;
    if (w && w.adsProgress > 0.8) k *= 0.8;
    const cls = w && w.currentDef ? w.currentDef.cls : null;
    if (cls === 'sniper') k *= 1.9 - D.tracking * 0.15;
    if (now - bot.lastDamageTime < 1) k *= 1.25;
    const rec = this.rec;
    if (rec && rec.actor.body) {
      // seitliche Bewegung des Ziels erschwert das Nachführen
      const v = rec.actor.body.velocity;
      _d.subVectors(rec.pos, bot.position).setY(0).normalize();
      const lat = Math.abs(v.x * -_d.z + v.z * _d.x);
      k *= 1 + Math.min(1, lat / 5) * 0.55;
    }
    return D.aimError * k;
  }

  /* ---------------------------------------------------------------- Zielen */

  /**
   * Blick zum Ziel führen (Feder mit Geschwindigkeitsgrenze). Gibt den Winkelfehler (rad) zum
   * perfekten Zielpunkt zurück.
   */
  aim(dt, now) {
    const bot = this.bot;
    const rec = this.rec;
    const D = bot.diff;
    if (!rec) return Infinity;
    const a = rec.actor;
    targetPoints(a, _p, _h);
    const pt = this.aimHead || rec.partial ? _h : _p;
    // Vorhalten (gegen Nachführverzögerung)
    if (rec.visible && a.body) pt.addScaledVector(a.body.velocity, D.prediction * 0.12);
    if (!rec.visible) pt.copy(rec.pos).setY(rec.pos.y + 1.2);
    this.lastSeenAim.copy(pt);
    bot.getEyePosition(_eye);
    _d.subVectors(pt, _eye);
    const dist = _d.length() || 1e-3;
    const wantYaw = Math.atan2(-_d.x, -_d.z);
    const wantPitch = Math.atan2(_d.y, Math.hypot(_d.x, _d.z));
    // Zielfehler wandert
    if (now > this.nextErrAt) {
      const mag = this._errMag(dist, now);
      const ang = Math.random() * Math.PI * 2;
      const r = mag * Math.sqrt(Math.random()) * 0.95;
      this.errTX = Math.cos(ang) * r;
      this.errTY = Math.sin(ang) * r * 0.75;
      this.nextErrAt = now + rnd(0.28, 0.65);
    }
    const ek = Math.min(1, dt * 3.2);
    this.errX += (this.errTX - this.errX) * ek;
    this.errY += (this.errTY - this.errY) * ek;
    // Rückstoß abbauen (Kompensation je Schwierigkeit)
    const rc = Math.exp(-D.recoilComp * dt);
    this.recoilP *= rc;
    this.recoilY *= rc;
    const ty = wantYaw + this.errX, tp = wantPitch + this.errY;
    this._turn(dt, ty, tp, rec.visible ? D.tracking : D.tracking * 0.6);
    const ey = Math.abs(wrap(wantYaw - bot.yaw)), ep = Math.abs(wantPitch - bot.pitch);
    return Math.hypot(ey, ep);
  }

  /** Federgeführte Drehung mit Geschwindigkeitsgrenze. */
  _turn(dt, yaw, pitch, maxSpeed) {
    const bot = this.bot;
    const k = (maxSpeed * 2.2) ** 2, c = 2 * Math.sqrt(k) * 0.9;
    const ey = wrap(yaw - bot.yaw), ep = pitch - bot.pitch;
    this.yawVel += (k * ey - c * this.yawVel) * dt;
    this.pitchVel += (k * ep - c * this.pitchVel) * dt;
    this.yawVel = clamp(this.yawVel, -maxSpeed, maxSpeed);
    this.pitchVel = clamp(this.pitchVel, -maxSpeed * 0.7, maxSpeed * 0.7);
    // nicht überschießen
    if (Math.abs(this.yawVel * dt) > Math.abs(ey) && Math.sign(this.yawVel) === Math.sign(ey)) { bot.yaw = wrap(yaw); this.yawVel *= 0.3; }
    else bot.yaw = wrap(bot.yaw + this.yawVel * dt);
    if (Math.abs(this.pitchVel * dt) > Math.abs(ep) && Math.sign(this.pitchVel) === Math.sign(ep)) { bot.pitch = pitch; this.pitchVel *= 0.3; }
    else bot.pitch += this.pitchVel * dt;
    bot.pitch = clamp(bot.pitch, -1.3, 1.3);
  }

  /** Ohne Ziel: Blick zu einem Punkt/einer Richtung führen (langsamer). */
  look(dt, yaw, pitch = 0, speedMul = 0.55) {
    this._turn(dt, yaw, pitch, this.bot.diff.tracking * speedMul + 0.8);
    this.errX *= 0.9; this.errY *= 0.9;
  }

  /** Rückstoß vom WeaponController. */
  addRecoil(pitch, yaw) {
    this.recoilP += pitch;
    this.recoilY -= yaw;
  }

  /* ---------------------------------------------------------------- Abzug */

  /** Schießabsicht setzen. angErr = Winkelfehler aus aim(). */
  trigger(dt, now, angErr, it) {
    const bot = this.bot;
    const rec = this.rec;
    const w = bot.weapon;
    const def = w && w.currentDef;
    if (!rec || !def) return;
    const D = bot.diff;
    const d = rec.pos.distanceTo(bot.position);
    const cls = def.cls;
    // Anschlag
    const wantAds = cls === 'sniper' || cls === 'marksman' ? d > 6 : cls === 'shotgun' || cls === 'melee' ? false : cls === 'pistol' ? d > 14 : d > 9;
    it.ads = wantAds && rec.visible;
    if (!rec.visible || now < this.reactAt) return;
    // Nahkampf
    const dh = Math.hypot(rec.actor.position.x - bot.position.x, rec.actor.position.z - bot.position.z);
    const dy = Math.abs(rec.actor.position.y - bot.position.y);
    if (!rec.actor.isStreakEntity && dy < 1.2 && (dh < 2.1 || (cls === 'melee' && dh < 4.2))) {
      if (!w.isMeleeing && angErr < 0.9) it.melee = true;
      return;
    }
    if (cls === 'melee') return;
    if (w.isReloading || w.isSwitching || w.isThrowing || w.isMeleeing) return;
    // Reichweite
    const maxR = cls === 'shotgun' ? Math.min(18, (def.damage && def.damage.rangeEnd) || 16) : (def.range || 100) * 0.92;
    if (d > maxR) return;
    // Freund im Schussfeld?
    if (now > this.lofAt) { this.lofAt = now + 0.15; this.lofOk = bot.manager.lineOfFireClear(bot, this.lastSeenAim); }
    if (!this.lofOk) return;
    const tol = Math.max(0.025, Math.atan(0.42 / Math.max(1, d))) * (cls === 'shotgun' ? 2 : 1);
    if (angErr > tol * 1.6) { this.onTargetSince = now; return; }
    const mode = def.fireMode || 'auto';
    if (mode === 'auto') {
      if (this.burstLeft <= 0) {
        if (now < this.pauseUntil) return;
        const [a, b] = D.burst;
        this.burstLeft = Math.round(rnd(a, b) * (d < 10 ? 1.5 : d > 35 ? 0.6 : 1));
      }
      it.fire = true;
      if (w.lastShotTime !== this.lastShot && w.lastShotTime > now - 0.2) {
        this.lastShot = w.lastShotTime;
        if (--this.burstLeft <= 0) this.pauseUntil = now + rnd(0.18, 0.42) + d * 0.009 + (cls === 'lmg' ? -0.08 : 0);
      }
    } else if (mode === 'bolt') {
      // Repetierer: voll im Anschlag und ruhig auf dem Ziel (gibt dem Gegner ein Zeitfenster)
      if (w.adsProgress < 0.95 || now - this.onTargetSince < 0.35 + D.reaction * 1.1) return;
      if (now >= this.nextTapAt) { it.firePressed = true; this.nextTapAt = now + 60 / Math.max(20, def.rpm || 46) + rnd(0.2, 0.5); }
    } else {
      if (now >= this.nextTapAt) {
        it.firePressed = true;
        const base = 60 / Math.max(30, def.rpm || 300);
        this.nextTapAt = now + Math.max(base, rnd(D.tapInterval[0], D.tapInterval[1])) + d * 0.003 + (mode === 'burst' ? 0.25 : 0);
      }
    }
  }

  /* ---------------------------------------------------------------- Bewegung im Gefecht */

  /**
   * Gefechtsbewegung: liefert { x, z } (Weltrichtung * Anteil), crouch, jump, nav (Ziel für Anlauf).
   */
  engageMove(dt, now, out) {
    const bot = this.bot;
    const rec = this.rec;
    const D = bot.diff;
    out.x = 0; out.z = 0; out.crouch = false; out.jump = false; out.nav = null; out.sprint = false;
    if (!rec) return out;
    const def = bot.weapon && bot.weapon.currentDef;
    const cls = def ? def.cls : 'ar';
    const w = bot.weapon;
    const ideal = cls === 'melee' ? 1 : Math.max(4, Math.min(IDEAL_RANGE[cls] || 18, w && Number.isFinite(w.idealRange) && w.idealRange > 0 ? w.idealRange * 1.1 : 99));
    _d.subVectors(rec.pos, bot.position).setY(0);
    const d = _d.length() || 1e-3;
    _d.multiplyScalar(1 / d);
    // Messer: direkt hin, sprinten
    if (cls === 'melee') {
      if (d > 3) { out.nav = rec.pos; out.sprint = d > 6; }
      else { out.x = _d.x; out.z = _d.z; }
      return out;
    }
    if (now > this.moveUntil) {
      this.moveUntil = now + rnd(0.6, 1.5);
      const r = Math.random();
      if (!rec.visible || d > ideal * 1.7) this.moveMode = 'advance';
      else if (d < ideal * 0.45 && cls !== 'shotgun') this.moveMode = 'backoff';
      else if (bot.coverNode && bot.position.distanceTo(bot.coverNode.position) < 1.2 && r < D.peekChance) this.moveMode = 'peek';
      else if (r < D.strafeChance) this.moveMode = 'strafe';
      else if (d > 14 && r < D.strafeChance + D.peekChance * 0.5) this.moveMode = 'crouch';
      else this.moveMode = cls === 'shotgun' && d > ideal ? 'advance' : 'hold';
      if (Math.random() < 0.55) this.strafe = -this.strafe;
      if (this.moveMode === 'strafe' && D.jumpShot > 0 && d < 16 && Math.random() < D.jumpShot * 3) out.jump = true;
    }
    const lx = -_d.z * this.strafe, lz = _d.x * this.strafe;
    switch (this.moveMode) {
      case 'advance':
        if (!rec.visible || d > ideal * 2.4) { out.nav = rec.pos; }
        else { out.x = _d.x * 0.85 + lx * 0.4; out.z = _d.z * 0.85 + lz * 0.4; }
        break;
      case 'backoff':
        out.x = -_d.x * 0.8 + lx * 0.5; out.z = -_d.z * 0.8 + lz * 0.5;
        break;
      case 'strafe':
        out.x = lx; out.z = lz;
        break;
      case 'crouch':
        out.crouch = true;
        break;
      case 'peek': {
        // hinter Deckung: ducken ↔ auftauchen
        if (now > this.peekUntil) {
          this.hidden = !this.hidden;
          this.peekUntil = now + (this.hidden ? rnd(0.5, 1.1) : rnd(1.1, 2.2));
        }
        const low = bot.coverNode && !bot.coverNode.coverHigh;
        if (low) out.crouch = this.hidden;
        else if (this.hidden) { out.x = lx * 0.6; out.z = lz * 0.6; }
        break;
      }
      default: break;
    }
    // Seitwärts nicht in Abgründe/Wände: Wandkontakt kehrt die Richtung um
    if (bot.body.wallNormal && (out.x * bot.body.wallNormal.x + out.z * bot.body.wallNormal.z) < -0.3) this.strafe = -this.strafe;
    return out;
  }
}

/** Zielt a ungefähr auf b? (Bedrohung) */
function aimingAt(a, b, d) {
  if (!a.getAimDirection || d > 45) return false;
  a.getAimDirection(_a);
  _d.set(b.position.x - a.position.x, b.position.y + 1.2 - a.position.y - 1.5, b.position.z - a.position.z).normalize();
  return _a.dot(_d) > 0.985;
}
