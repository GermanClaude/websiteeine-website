// NULLPUNKT — prozedurale Soldaten-Animation (alles im Modellraum, Füße im Ursprung, Blick −Z).
//
//  • Fortbewegung: Schrittzyklus synchron zur Bodengeschwindigkeit (Standphase bewegt den Fuß exakt mit
//    −v → kein Rutschen), Gang/Lauf/Sprint/Schleichen über Schrittlänge + Standanteil, Seit-/Rückwärts
//    über Hüftdrehung (max. ~45°) + Oberkörper-Gegendrehung, Stehen mit gepflanzten Füßen und
//    Nachsetzschritten beim Drehen, Luftphase (Beine angezogen), Landeeinknicken.
//  • Oberkörper: Zielrichtung über Wirbelsäule/Brust/Hals/Kopf verteilt, die Waffe liegt exakt in der
//    Ziel-Achse (Anschlagrahmen); beide Hände per Zwei-Knochen-IK an Griff + Handschutz der Waffe
//    (Griffstile under/flat/pump/post/pistol), Anschlag (ADS) mit Wangenauflage, Sprinthaltung,
//    Rückstoß-Feder, Nachladen (Magazin raus → Weste → rein, Ladehebel), Schrot Patrone für Patrone,
//    Repetieren (Kammerstängel/Pumpe), Granatwurf (Splint, Ausholen, Wurf), Messerstoß, Treffer-Zucken.
//  • Ergebnis: lokale Knochen-Quaternionen + Modellraum-Gelenke (für Trefferzonen/Ragdoll) +
//    Waffentransformation.
import * as THREE from 'three';
import { BONES, BONE, BONE_COUNT, DIM } from './rig.js';
import { quatFromYZ, quatFromXY, twoBone, clamp, lerp, smooth, damp, wrap, ramp, spring, qrot } from './ik.js';

const V = () => new THREE.Vector3();
const Qn = () => new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
const _q = Qn(), _q2 = Qn(), _qi = Qn();
const _v = V(), _v2 = V(), _v3 = V(), _v4 = V(), _a = V(), _b = V(), _c = V(), _pole = V();
// feste Zwischenspeicher (keine Allokationen pro Bild)
const S_R = V(), S_BP = V(), S_G = V(), S_L = V(), S_T = V(), S_M = V();
const S_GRIP = V(), S_WELL = V(), S_WD = V(), S_PORT = V(), S_END = V();
const S_LQ = Qn();
const PARENT = BONES.map((b) => b[1]); // Elternknochen je Index

/** Haltungen je Waffenart (Position des Griffs im Anschlagrahmen, Drehung Pitch/Yaw/Roll). */
const POSES = {
  rifle: {
    ready: { p: [0.15, -0.085, -0.31], r: [0.02, 0.04, 0.0] },
    ads: { p: [0.085, 0.015, -0.32], r: [0, 0, 0] },
    sprint: { p: [0.1, -0.2, -0.22], r: [-0.5, 0.85, -0.45] },
    lowered: { p: [0.12, -0.16, -0.27], r: [-0.3, 0.3, -0.55] },
    reload: { p: [0.12, -0.12, -0.29], r: [-0.18, 0.12, -0.45] },
    pole: { r: [0.55, -0.8, 0.25], l: [-0.45, -0.85, 0.15] },
  },
  pistol: {
    ready: { p: [0.07, -0.1, -0.4], r: [0.02, 0.0, 0] },
    ads: { p: [0.035, 0.07, -0.48], r: [0, 0, 0] },
    sprint: { p: [0.22, -0.42, -0.1], r: [-1.25, 0.1, 0] },
    lowered: { p: [0.18, -0.25, -0.3], r: [-0.6, 0.2, -0.2] },
    reload: { p: [0.08, -0.12, -0.36], r: [-0.1, 0.15, -0.35] },
    pole: { r: [0.5, -0.85, 0.2], l: [-0.5, -0.85, 0.2] },
  },
  knife: {
    ready: { p: [0.22, -0.24, -0.28], r: [0.35, 0.1, 0.25] },
    ads: { p: [0.2, -0.18, -0.32], r: [0.3, 0.1, 0.25] },
    sprint: { p: [0.24, -0.4, -0.12], r: [-0.2, 0.0, 0.3] },
    lowered: { p: [0.22, -0.3, -0.22], r: [0.2, 0.1, 0.3] },
    reload: { p: [0.22, -0.24, -0.28], r: [0.35, 0.1, 0.25] },
    pole: { r: [0.6, -0.7, 0.4], l: [-0.6, -0.7, 0.4] },
  },
};

// Griffpunkt relativ zum Handgelenk (Handraum): Mitte der Handfläche, zur Innenseite versetzt
const GRIP_R = new THREE.Vector3(-0.026, -0.062, 0);
const GRIP_L = new THREE.Vector3(0.026, -0.062, 0);

export class Animator {
  /**
   * @param {object} soldier { bones: THREE.Bone[] }
   */
  constructor(soldier) {
    this.soldier = soldier;
    this.lq = Array.from({ length: BONE_COUNT }, Qn); // lokale Rotationen
    this.wq = Array.from({ length: BONE_COUNT }, Qn); // Modellraum-Rotationen
    this.wp = Array.from({ length: BONE_COUNT }, V); // Modellraum-Positionen
    this.off = BONES.map((b) => new THREE.Vector3(...b[2]));
    this.hipsPos = new THREE.Vector3(0, DIM.standHip, 0);
    // Waffe im Modellraum
    this.gunPos = V();
    this.gunQuat = Qn();
    this.aimPivot = V();
    this.aimQuat = Qn();
    this.headCenter = V();
    this.handRGrip = V(); // Griffpunkt der rechten Hand (Modellraum)
    this.handLGrip = V();
    this.reset();
  }

  reset(yaw = 0) {
    this.time = Math.random() * 10;
    this.bodyYaw = yaw;
    this.hipYaw = 0;
    this.phase = 0;
    this.cycle = 1.2;
    this.duty = 0.6;
    this.speed = 0;
    this.localVel = new THREE.Vector3();
    this.crouch = 0;
    this.sprint = 0;
    this.ads = 0;
    this.air = 0;
    this.airTime = 0;
    this.land = { x: 0, v: 0 };
    this.recoil = { x: 0, v: 0 };
    this.recoilP = { x: 0, v: 0 };
    this.flinchP = { x: 0, v: 0 };
    this.flinchR = { x: 0, v: 0 };
    this.flinchH = { x: 0, v: 0 };
    // Treffer-Reaktionen (C2): Rumpfdrehung aus dem Drehmoment des Einschlags, Hüftversatz (Stolpern), Einknicken je
    // Bein, Waffe aus dem Anschlag geschlagen (Nicken/Gieren), Schutzhaltung bei Blendung, Lehnen (C6)
    this.twist = { x: 0, v: 0 };
    this.shoveX = { x: 0, v: 0 };
    this.shoveZ = { x: 0, v: 0 };
    this.buckleL = { x: 0, v: 0 };
    this.buckleR = { x: 0, v: 0 };
    this.jerkP = { x: 0, v: 0 };
    this.jerkY = { x: 0, v: 0 };
    this.cower = 0; // 0..1 Blendung/Explosion: Arm vors Gesicht, Kopf weg, Waffe gesenkt
    this.cowerT = 0;
    this.leanX = 0; // −1…1 (− = links), geglättet vom Bot
    this._springs = [this.land, this.recoil, this.recoilP, this.flinchP, this.flinchR, this.flinchH, this.twist, this.shoveX, this.shoveZ, this.buckleL, this.buckleR, this.jerkP, this.jerkY];
    this.lean = 0;
    this.stepping = 0; // Nachsetzschritt im Stand
    this.stepYaw = yaw;
    this.idleFeet = null; // gepflanzte Fußpositionen (Welt) im Stand
    this.throwT = -1;
    this.meleeT = -1;
    this.boltT = 1e3;
    this.lastShot = -1e3;
    this.shellT = 0;
    this.lowered = 0; // Waffe gesenkt (Werfen/Messer)
    this.reloadW = 0;
    this.footPlant = [0, 0];
    this.lastFootT = [0, 0];
    this.events = { footstep: -1 };
    this.glance = { yaw: 0, pitch: 0, until: 0, tYaw: 0, tPitch: 0 };
    this.pose(true);
  }

  /* ================================================================ Waffe */

  /** Waffe setzen: Anker im Waffenraum vermessen. */
  setWeapon(gun, def) {
    this.gun = gun || null;
    this.def = def || null;
    const cls = def ? def.cls : 'ar';
    this.kind = cls === 'pistol' ? 'pistol' : cls === 'melee' ? 'knife' : 'rifle';
    this.fireMode = def ? def.fireMode : 'auto';
    this.cls = cls;
    const A = (this.anchors = { grip: V(), left: V(), well: null, charge: null, pump: null, bolt: null, shell: null, sight: V(0, 0.07, 0), muzzle: V(0, 0.03, -0.6), maxZ: 0.25, style: 'under' });
    if (gun) {
      const ud = gun.userData || {};
      const prevParent = gun.parent;
      const prevPos = gun.position.clone(), prevQuat = gun.quaternion.clone(), prevScale = gun.scale.clone();
      if (prevParent) prevParent.remove(gun);
      gun.position.set(0, 0, 0); gun.quaternion.identity(); gun.scale.set(1, 1, 1);
      gun.updateMatrixWorld(true);
      const pos = (o) => (o ? o.getWorldPosition(V()) : null);
      if (ud.leftHandGrip) { A.left.copy(pos(ud.leftHandGrip)); A.style = (ud.leftHandGrip.userData && ud.leftHandGrip.userData.style) || 'under'; }
      else A.left.set(0, -0.02, -0.25);
      const an = ud.anchors || {};
      A.well = pos(an.magWell || an.magGrab);
      A.charge = pos(an.chargeGrab || an.boltCatch);
      A.pump = pos(an.pumpGrab);
      A.bolt = pos(an.boltGrab || an.slideGrab);
      A.shell = pos(an.shellPort);
      if (ud.sight) A.sight.copy(pos(ud.sight));
      if (ud.muzzle) A.muzzle.copy(pos(ud.muzzle));
      const info = ud.info || {};
      if (info.max) A.maxZ = info.max[2];
      this.magazine = ud.magazine && ud.magazine !== gun ? ud.magazine : null;
      gun.position.copy(prevPos); gun.quaternion.copy(prevQuat); gun.scale.copy(prevScale);
      if (prevParent) prevParent.add(gun);
    } else this.magazine = null;
    if (this.kind === 'pistol') A.style = 'pistol';
    if (this.kind === 'rifle' && A.style === 'pistol') A.style = 'under';
    // Haltung an Schaftlänge/Visierhöhe anpassen
    const base = POSES[this.kind];
    this.poses = {};
    for (const k of Object.keys(base)) this.poses[k] = { p: V().fromArray(base[k].p || [0, 0, 0]), r: base[k].r ? [...base[k].r] : null };
    if (this.kind === 'rifle') {
      const butt = clamp(A.maxZ, 0.08, 0.42);
      const z = -0.035 - butt;
      this.poses.ready.p.z = z;
      this.poses.ads.p.z = z - 0.01;
      this.poses.reload.p.z = z + 0.02;
      this.poses.ads.p.y = 0.15 - clamp(A.sight.y, 0.03, 0.12);
      this.poses.ads.p.x = 0.05;
      if (this.cls === 'lmg') { this.poses.ready.p.y -= 0.03; this.poses.ready.p.x += 0.01; }
    } else if (this.kind === 'pistol') {
      this.poses.ads.p.y = 0.15 - clamp(A.sight.y, 0.02, 0.06);
    }
    this.poleR = V().fromArray(base.pole.r).normalize();
    this.poleL = V().fromArray(base.pole.l).normalize();
  }

  /* ================================================================ Ereignisse */

  shot(strength = 1) {
    const k = this.kind === 'pistol' ? 0.9 : 1;
    this.recoil.v -= 0.9 * strength * k;
    this.recoilP.v += 2.6 * strength * k;
    this.lastShot = this.time;
    if (this.fireMode === 'bolt' || this.fireMode === 'pump') this.boltT = 0;
  }

  /** Schutz: nicht endliche oder unplausible Federzustände (z. B. aus NaN-Eingaben) auf Ruhe setzen. */
  _saneSprings() {
    const list = this._springs;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!(Math.abs(s.x) < 10) || !(Math.abs(s.v) < 500)) { s.x = 0; s.v = 0; }
    }
  }

  /**
   * Treffer-Reaktion (C2): dir = Flugrichtung der Kugel im Modellraum, point = Einschlag im Modellraum (optional),
   * zone 'head'|'body'|'limb', amount = Schaden. Impuls je Trefferzone und Richtung in die Federn: Kopf schnappt,
   * Rumpf nickt/rollt/dreht sich um die Einschlagstelle, Becken wird versetzt, getroffenes Bein knickt ein, Arm-Treffer
   * schlagen die Waffe aus dem Anschlag. Starke Treffer (Schrot, Scharfschütze) ≈ doppelt.
   */
  hit(dir, zone, amount = 25, point = null) {
    const s = clamp(amount / 35, 0.4, 1.8);
    // Höhe/Seite des Einschlags (ohne Punkt: aus der Zone geschätzt)
    const py = point ? point.y : zone === 'head' ? 1.7 : zone === 'limb' ? 0.6 : 1.25;
    const px = point ? point.x : 0, pz = point ? point.z : 0;
    const leg = zone === 'limb' && py < 0.95;
    const arm = zone === 'limb' && !leg;
    this.flinchP.v += dir.z * (leg ? 1.2 : 3.2) * s;
    this.flinchR.v += -dir.x * (leg ? 1.4 : 3.0) * s;
    if (zone === 'head') this.flinchH.v += (dir.z * 5 - Math.abs(dir.x) * 2) * s;
    // Drehmoment um die Hochachse (r × F).y = rz·Fx − rx·Fz → Rumpfdrehung, Schulter weicht zurück
    const tq = (pz * dir.x - px * dir.z) * (zone === 'head' ? 0.6 : 1);
    this.twist.v += clamp(tq * 22, -4, 4) * s;
    // Becken: Stoß in Schussrichtung (Rumpf stärker als Arme), bei Beinen wenig
    const shove = (leg ? 0.25 : arm ? 0.35 : 0.7) * s;
    this.shoveX.v += dir.x * shove;
    this.shoveZ.v += dir.z * shove;
    if (leg) {
      // getroffenes Bein knickt ein (Seite aus dem Einschlag, sonst zufällig)
      const left = point ? px < 0 : Math.random() < 0.5;
      (left ? this.buckleL : this.buckleR).v += 5.5 * s;
    }
    if (arm || zone === 'body') {
      // Waffe wird aus dem Anschlag geschlagen (Arm: stark, Rumpf: leicht)
      const k = arm ? 1 : 0.35;
      this.jerkP.v += (Math.random() * 0.6 - 0.9) * 3.2 * k * s;
      this.jerkY.v += (px >= 0 ? 1 : -1) * 2.6 * k * s;
    }
  }

  /**
   * Taumeln (Explosion, Stoß): dir = Richtung vom Auslöser weg (Modellraum), strength 0..1.5. Becken weit versetzt,
   * Knie geben nach, Rumpf dreht weg, Waffe hoch/weg, kurze Schutzhaltung.
   */
  stagger(dir, strength = 1) {
    const s = clamp(strength, 0, 1.6);
    this.shoveX.v += dir.x * 1.6 * s;
    this.shoveZ.v += dir.z * 1.6 * s;
    this.flinchP.v += dir.z * 4.5 * s;
    this.flinchR.v += -dir.x * 4.2 * s;
    this.buckleL.v += 3.5 * s;
    this.buckleR.v += 3.5 * s;
    this.land.v -= 1.2 * s;
    this.twist.v += (Math.random() < 0.5 ? -1 : 1) * 2.5 * s;
    this.jerkP.v += 2.4 * s;
    this.cowerT = Math.max(this.cowerT, 0.35 + 0.45 * s);
  }

  /** Blendung: Schutzhaltung für `duration` s (Arm vor die Augen, Kopf abgewandt, Waffe gesenkt). */
  flash(duration = 2, strength = 1) {
    this.cowerT = Math.max(this.cowerT, clamp(duration, 0.3, 6) * clamp(strength, 0.3, 1));
    this.flinchH.v += 4 * strength;
  }

  /* ================================================================ Hauptschleife */

  /**
   * p: { velocity (Modellraum, m/s), aimYaw (Welt), aimPitch, crouch 0..1, sprint, ads 0..1, onGround,
   *      reloading, reloadProgress, reloadEmpty, perShell, throwing, cooking, meleeing, frozen }
   * yaw: gewünschte Welt-Gierung (Ziel); Rückgabe: Körper-Gierung (Welt) für die Wurzel.
   */
  update(dt, p) {
    this.time += dt;
    const sp = Math.hypot(p.velocity.x, p.velocity.z);
    this.speed += (sp - this.speed) * damp(12, dt);
    this.localVel.lerp(p.velocity, damp(10, dt));
    this.crouch += ((p.crouch ? 1 : 0) - this.crouch) * damp(9, dt);
    this.sprint += ((p.sprint ? 1 : 0) - this.sprint) * damp(7, dt);
    this.ads += ((p.ads || 0) - this.ads) * damp(14, dt);
    const airborne = !p.onGround;
    this.airTime = airborne ? this.airTime + dt : 0;
    const airTarget = airborne && this.airTime > 0.08 ? 1 : 0;
    if (!airTarget && this.air > 0.5 && p.onGround) this.land.v -= 1.6 * this.air; // Landung
    this.air += (airTarget - this.air) * damp(airTarget ? 8 : 14, dt);

    // Körper-Gierung: folgt dem Ziel im Lauf eng, im Stand mit Totzone + Nachsetzschritt
    const want = p.aimYaw;
    const diff = wrap(want - this.bodyYaw);
    if (this.speed > 0.6 || this.air > 0.5) {
      this.bodyYaw = wrap(this.bodyYaw + diff * damp(9, dt));
    } else if (Math.abs(diff) > 0.85 || this.turning) {
      this.turning = Math.abs(diff) > 0.12;
      const step = clamp(diff, -6 * dt, 6 * dt);
      this.bodyYaw = wrap(this.bodyYaw + step);
      this.stepping = Math.min(1, this.stepping + dt * 4);
    } else {
      this.stepping = Math.max(0, this.stepping - dt * 2.5);
    }

    // Gang
    const crouch = this.crouch;
    const s = this.speed;
    const moving = s > 0.25 || this.stepping > 0.05;
    const sEff = Math.max(s, this.stepping * 1.4);
    const duty = s < 1.5 ? 0.62 : s < 5 ? lerp(0.62, 0.34, (s - 1.5) / 3.5) : lerp(0.34, 0.24, clamp((s - 5) / 3.2, 0, 1));
    const reach = lerp(0.86, 1.0, crouch);
    const cycle = clamp(0.55 + 0.5 * sEff, 0.6, reach / duty);
    this.duty += (duty - this.duty) * damp(6, dt);
    this.cycle += (cycle - this.cycle) * damp(6, dt);
    const prevPhase = this.phase;
    if (moving && this.air < 0.5) this.phase = (this.phase + (sEff / this.cycle) * dt) % 1;
    // Fußaufsetzen (Schrittgeräusch)
    this.events.footstep = -1;
    for (let f = 0; f < 2; f++) {
      const o = f * 0.5;
      const a = (prevPhase + o) % 1, b = (this.phase + o) % 1;
      if (moving && this.air < 0.5 && b < a && sEff > 0.9) this.events.footstep = f; // Wrap = Aufsetzen
    }

    // Hüftdrehung zur Laufrichtung (seitwärts/rückwärts)
    let hipTarget = 0;
    if (s > 0.6) {
      const mu = Math.atan2(this.localVel.x, -this.localVel.z); // 0 = vorwärts, +π/2 = rechts
      const back = Math.abs(mu) > Math.PI / 2 + 0.15;
      const dev = back ? wrap(mu - Math.PI) : mu;
      hipTarget = -clamp(dev, -0.8, 0.8) * (1 - this.sprint * 0.5);
    }
    this.hipYaw += (hipTarget - this.hipYaw) * damp(7, dt);

    // Federn: exakter Schritt (stabil für jedes dt, auch bei gedrosselter Animationsrate)
    spring(this.recoil, 0, 320, 30, dt);
    spring(this.recoilP, 0, 260, 28, dt);
    spring(this.flinchP, 0, 150, 16, dt);
    spring(this.flinchR, 0, 150, 16, dt);
    spring(this.flinchH, 0, 180, 18, dt);
    spring(this.land, 0, 140, 15, dt);
    spring(this.twist, 0, 90, 11, dt);
    spring(this.shoveX, 0, 60, 11, dt);
    spring(this.shoveZ, 0, 60, 11, dt);
    spring(this.buckleL, 0, 70, 10, dt);
    spring(this.buckleR, 0, 70, 10, dt);
    spring(this.jerkP, 0, 120, 14, dt);
    spring(this.jerkY, 0, 120, 14, dt);
    this._saneSprings();
    // Schutzhaltung (Blendung/Explosion) ein- und ausblenden
    this.cowerT = Math.max(0, this.cowerT - dt);
    this.cower += ((this.cowerT > 0 ? 1 : 0) - this.cower) * damp(this.cowerT > 0 ? 12 : 4, dt);
    // Lehnen (C6): Ziel vom Bot (p.lean), weich nachgeführt
    const leanT = clamp(p.lean || 0, -1, 1);
    this.leanX += (leanT - this.leanX) * damp(11, dt);

    // Gesten-Zeitgeber
    if (p.throwing) {
      if (this.throwT < 0) this.throwT = 0;
      this.throwT += dt;
      if (p.cooking && this.throwT > 0.47) this.throwT = 0.47;
    } else if (this.throwT >= 0) {
      this.throwT = this.throwT < 0.9 && this.throwT > 0 ? this.throwT + dt : -1;
      if (this.throwT > 1.0) this.throwT = -1;
    }
    if (p.meleeing) { if (this.meleeT < 0) this.meleeT = 0; this.meleeT += dt; } else if (this.meleeT >= 0) { this.meleeT += dt; if (this.meleeT > 0.75) this.meleeT = -1; }
    this.boltT += dt;
    const reloading = !!p.reloading;
    this.reloadW += ((reloading ? 1 : 0) - this.reloadW) * damp(reloading ? 10 : 7, dt);
    this.reloadP = p.reloadProgress || 0;
    this.reloadEmpty = !!p.reloadEmpty;
    this.perShell = !!p.perShell;
    if (reloading && this.perShell) this.shellT += dt; else this.shellT = 0;
    const throwing = this.throwT >= 0;
    const meleeOff = this.meleeT >= 0 && this.kind !== 'knife';
    this.lowered += ((throwing || meleeOff ? 1 : this.cower * 0.85) - this.lowered) * damp(14, dt);

    // Blick umherschweifen lassen (nur im Leerlauf)
    const g = this.glance;
    if (p.idleLook && this.time > g.until) {
      g.until = this.time + 1.5 + Math.random() * 3;
      g.tYaw = Math.random() < 0.4 ? 0 : (Math.random() - 0.5) * 1.1;
      g.tPitch = (Math.random() - 0.6) * 0.25;
    } else if (!p.idleLook) { g.tYaw = 0; g.tPitch = 0; }
    g.yaw += (g.tYaw - g.yaw) * damp(3, dt);
    g.pitch += (g.tPitch - g.pitch) * damp(3, dt);

    this.aimPitch = clamp(p.aimPitch || 0, -1.3, 1.3);
    this.aimRel = clamp(wrap(want - this.bodyYaw), -1.4, 1.4);
    this.pose(false, p);
    return this.bodyYaw;
  }

  /* ================================================================ Pose */

  pose(init = false, p = null) {
    const lq = this.lq, wq = this.wq, wp = this.wp, off = this.off;
    const crouch = this.crouch, sprint = this.sprint, air = this.air;
    const s = this.speed;
    const t = this.time;
    const ph = this.phase * Math.PI * 2;
    const run = clamp((s - 1.5) / 4, 0, 1);

    /* ---------- Hüfte */
    const bob = this.speed > 0.3 && air < 0.5 ? -Math.cos(ph * 2) * lerp(0.012, 0.035, run) * (1 - crouch * 0.5) : 0;
    const breathe = Math.sin(t * 1.7) * 0.004;
    // Treffer/Taumeln (C2): eingeknickte Beine senken das Becken (einseitig → Becken kippt zur getroffenen Seite)
    const bL = Math.max(0, this.buckleL.x), bR = Math.max(0, this.buckleR.x);
    const cower = this.cower;
    let hipY = lerp(DIM.standHip, DIM.crouchHip, crouch) - run * 0.035 - sprint * 0.02 + bob + breathe + this.land.x * 0.12 - air * 0.06;
    hipY -= Math.min(0.18, (bL + bR) * 0.11) + cower * 0.07;
    if (this.feetLift) hipY -= this.feetLift;
    const sway = Math.sin(ph) * lerp(0.01, 0.018, run) * (s > 0.3 ? 1 : 0);
    // Lehnen (C6): Gewicht aufs äußere Bein (Becken seitlich), Oberkörper rollt zur Seite → Kopf ≈ 0,34 m versetzt
    const leanX = this.leanX;
    const leanRoll = -leanX * 0.38;
    this.hipsPos.set(sway * 0.5 + leanX * 0.13 + clamp(this.shoveX.x, -0.3, 0.3) * 0.6, hipY, crouch * 0.04 + clamp(this.shoveZ.x, -0.3, 0.3) * 0.6);
    const twist = s > 0.3 ? Math.sin(ph) * lerp(0.08, 0.16, run) * (1 - crouch * 0.5) : 0;
    const pelvisPitch = -crouch * 0.18 - sprint * 0.12;
    _e.set(pelvisPitch, this.hipYaw + twist, sway * 1.4 + (bL - bR) * 0.26 + leanRoll * 0.15, 'YXZ');
    wq[0].setFromEuler(_e);
    lq[0].copy(wq[0]);
    wp[0].copy(this.hipsPos);

    /* ---------- Wirbelsäule → Kopf (Zielverteilung) */
    const aimRel = this.aimRel || 0;
    const pitch = this.aimPitch || 0;
    const ads = this.ads;
    const yawRest = aimRel - (this.hipYaw + twist); // durch Rumpf auszugleichen
    const lean = 0.04 + run * 0.06 + sprint * 0.22 + crouch * 0.12;
    const fP = this.flinchP.x, fR = this.flinchR.x;
    const tw = clamp(this.twist.x, -0.7, 0.7);
    const breatheP = Math.sin(t * 1.7 + 0.6) * 0.012;
    // Schutzhaltung: Kopf weg- und nach unten gedreht, Rumpf leicht eingerollt
    const cwY = cower * 0.55, cwP = cower * 0.3;
    // Wirbelsäule, Brust, Hals, Kopf: (Gierung, Neigung, Rollen)
    const gl = this.glance;
    this._rotFk(1, yawRest * 0.35 + tw * 0.5, pitch * 0.18 - lean * 0.5 - pelvisPitch * 0.4 + fP * 0.5 + cower * 0.12, -sway * 1.2 + fR * 0.5 + leanRoll * 0.4);
    this._rotFk(2, yawRest * 0.4 + tw * 0.35, pitch * 0.32 - lean * 0.45 - pelvisPitch * 0.6 + breatheP + fP * 0.5 + this.recoilP.x * 0.04 + cower * 0.1, fR * 0.4 + leanRoll * 0.4);
    this._rotFk(3, yawRest * 0.12 + gl.yaw * 0.4 - tw * 0.3 + cwY * 0.4, pitch * 0.2 + lean * 0.4 - ads * 0.22 + gl.pitch * 0.4 + cwP * 0.4, -ads * 0.06 + leanRoll * 0.08);
    this._rotFk(4, yawRest * 0.13 + gl.yaw * 0.6 - tw * 0.2 + cwY * 0.6, pitch * 0.3 + lean * 0.55 + ads * 0.12 + this.flinchH.x * 0.3 + gl.pitch * 0.6 + cwP * 0.6, -ads * 0.2 - fR * 0.2 - leanRoll * 0.1);

    /* ---------- Anschlagrahmen + Waffe */
    const chest = BONE.chest;
    qrot(this.aimPivot.set(0, 0.15, -0.01), wq[chest]).add(wp[chest]);
    _e.set(pitch, aimRel, 0, 'YXZ');
    this.aimQuat.setFromEuler(_e);
    const P = this.poses || null;
    if (P) this._weaponPose(p);

    /* ---------- Arme */
    this._arms(p);

    /* ---------- Beine */
    this._legs(p);

    /* ---------- Kopfmitte (Trefferzone) */
    qrot(this.headCenter.fromArray(DIM.headCenter), wq[BONE.head]).add(wp[BONE.head]);
    void init;
  }

  _fk(i) {
    const parent = PARENT[i];
    this.wq[i].multiplyQuaternions(this.wq[parent], this.lq[i]);
    qrot(this.wp[i].copy(this.off[i]), this.wq[parent]).add(this.wp[parent]);
  }

  /** Lokale Drehung (Gierung y, Neigung x, Rollen z; Reihenfolge YXZ) setzen + Vorwärtskinematik. */
  _rotFk(i, y, x, z) {
    _e.set(x, y, z, 'YXZ');
    this.lq[i].setFromEuler(_e);
    this._fk(i);
  }

  /** Weltrotation eines Knochens setzen → lokale Rotation (Elternteil muss aktuell sein). */
  _setWorld(i, q) {
    const parent = PARENT[i];
    this.wq[i].copy(q);
    _qi.copy(this.wq[parent]).invert();
    this.lq[i].multiplyQuaternions(_qi, q);
    qrot(this.wp[i].copy(this.off[i]), this.wq[parent]).add(this.wp[parent]);
  }

  /* ---------------------------------------------------------------- Waffe */

  _weaponPose(p) {
    const P = this.poses;
    const ads = this.ads, sprint = this.sprint;
    const pos = _v.copy(P.ready.p).lerp(P.ads.p, ads);
    let rx = P.ready.r[0] * (1 - ads), ry = P.ready.r[1] * (1 - ads), rz = P.ready.r[2] * (1 - ads);
    const blend = (pose, w) => {
      if (w <= 1e-3) return;
      pos.lerp(pose.p, w);
      rx += (pose.r[0] - rx) * w; ry += (pose.r[1] - ry) * w; rz += (pose.r[2] - rz) * w;
    };
    // Laufen: leichtes Wippen der Waffe
    const ph = this.phase * Math.PI * 2;
    const mv = clamp(this.speed / 5, 0, 1) * (1 - ads * 0.8);
    pos.x += Math.sin(ph) * 0.008 * mv;
    pos.y += Math.abs(Math.cos(ph)) * 0.012 * mv;
    // Leerlauf-Atmen
    pos.y += Math.sin(this.time * 1.7) * 0.003;
    blend(P.sprint, sprint * (1 - this.reloadW));
    blend(P.reload, this.reloadW * (this.perShell ? 0.6 : 1));
    blend(P.lowered, this.lowered);
    // Nachladen: Waffe dreht sich zum Magazin
    if (this.reloadW > 0.01 && !this.perShell) {
      const r = this.reloadP;
      const tilt = ramp(r, 0.05, 0.2) * (1 - ramp(r, 0.8, 0.96));
      rz -= 0.25 * tilt * this.reloadW;
      pos.y += 0.02 * Math.sin(Math.PI * ramp(r, 0.7, 0.85)) * this.reloadW; // Einsetzen: kleiner Stoß
      if (this.reloadEmpty && this.kind === 'pistol') rx += 0.25 * ramp(r, 0.85, 0.93) * (1 - ramp(r, 0.93, 1));
    }
    // Messerstoß (Messer als Waffe)
    if (this.kind === 'knife' && this.meleeT >= 0) {
      const m = this.meleeT;
      const k = ramp(m, 0.0, 0.08) * (1 - ramp(m, 0.08, 0.2));
      const thrust = ramp(m, 0.08, 0.18) * (1 - ramp(m, 0.3, 0.6));
      pos.z += 0.12 * k - 0.38 * thrust;
      pos.y += 0.1 * thrust;
      pos.x -= 0.1 * thrust;
      rx -= 0.6 * thrust;
    }
    // Rückstoß
    pos.z -= this.recoil.x * 0.06;
    pos.y += this.recoilP.x * 0.01;
    rx += this.recoilP.x * 0.05;
    // Treffer schlägt die Waffe aus dem Anschlag (C2); beim Lehnen wird die Waffe mitgekantet (C6)
    rx += clamp(this.jerkP.x, -0.6, 0.6) * 0.7;
    ry += clamp(this.jerkY.x, -0.6, 0.6) * 0.7;
    pos.x += clamp(this.jerkY.x, -0.6, 0.6) * 0.03;
    rz += -this.leanX * 0.38 * 0.6;
    // Repetieren (Waffe kippt leicht)
    if (this.boltT < 0.75 && this.kind === 'rifle') {
      const b = Math.sin(Math.PI * ramp(this.boltT, 0.12, 0.7));
      rz -= b * (this.fireMode === 'bolt' ? 0.18 : 0.08);
      pos.y -= b * 0.01;
    }
    // Rahmen → Modellraum
    qrot(this.gunPos.copy(pos), this.aimQuat).add(this.aimPivot);
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    this.gunQuat.multiplyQuaternions(this.aimQuat, _q);
  }

  /** Waffenraum → Modellraum. */
  _gunToModel(local, out) {
    return qrot(out.copy(local), this.gunQuat).add(this.gunPos);
  }

  /* ---------------------------------------------------------------- Arme */

  _arms(p) {
    const wp = this.wp;
    const A = this.anchors;
    const kind = this.kind;
    const chest = BONE.chest;
    if (!A) return;
    const gq = this.gunQuat;

    // --- Rechte Hand: am Griff, oder Geste (Granate / Kammerstängel)
    const rTarget = this._gunToModel(_v2.set(0, 0, 0), S_R);
    const rQuat = this._handOnGrip(_q2, 'R');
    let rFree = 0;
    // Kammerstängel / Pumpe (Repetierer)
    if (this.boltT < 0.75 && this.fireMode === 'bolt' && A.bolt) {
      const b = Math.sin(Math.PI * ramp(this.boltT, 0.1, 0.72));
      const bp = this._gunToModel(_v3.copy(A.bolt).add(_v4.set(0.03, 0.0, 0.07 * ramp(this.boltT, 0.3, 0.45) * (1 - ramp(this.boltT, 0.5, 0.65)))), S_BP);
      rTarget.lerp(bp, b);
    }
    // Granatwurf
    let grenadeVisible = false;
    if (this.throwT >= 0) {
      const tt = this.throwT;
      const shoulder = _a.set(DIM.shoulderX, DIM.shoulderY, 0).applyQuaternion(this.wq[chest]).add(wp[chest]);
      const chestP = _v3.set(0.05, 0.05, -0.2).applyQuaternion(this.wq[chest]).add(wp[chest]);
      const back = _v4.set(0.1, 0.25, 0.18).applyQuaternion(this.aimQuat).add(shoulder);
      const fwd = _b.set(0.02, 0.12, -0.52).applyQuaternion(this.aimQuat).add(shoulder);
      const follow = _c.set(-0.1, -0.25, -0.38).applyQuaternion(this.aimQuat).add(shoulder);
      const g = S_G;
      if (tt < 0.3) g.copy(rTarget).lerp(chestP, ramp(tt, 0, 0.22));
      else if (tt < 0.5) g.copy(chestP).lerp(back, ramp(tt, 0.3, 0.47));
      else if (tt < 0.7) g.copy(back).lerp(fwd, ramp(tt, 0.56, 0.68));
      else g.copy(fwd).lerp(follow, ramp(tt, 0.7, 0.82)).lerp(rTarget, ramp(tt, 0.82, 0.98));
      rFree = ramp(tt, 0, 0.12) * (1 - ramp(tt, 0.86, 0.98));
      rTarget.lerp(g, rFree);
      grenadeVisible = tt < 0.66;
    }
    this.grenadeVisible = grenadeVisible;
    // Rechte Hand ohne Waffe (Pistole im Sprint: frei schwingender linker Arm, rechte hält)
    let rq = rQuat;
    if (rFree > 0.01) {
      // Hand folgt grob der Unterarmrichtung
      rq = _q2.slerp(this._freeHandQuat(_q, 'R', rTarget), rFree);
    }
    this._armIK('R', rTarget, rq, this._poleWorld(this.poleR, rFree > 0.5 ? _v.set(0.3, -0.2, 0.8) : null));

    // --- Linke Hand
    const lTarget = S_L;
    const lQuat = S_LQ.identity();
    let lFree = 0;
    // Grundgriff
    if (kind === 'knife') {
      // freie Hand vor dem Körper (Deckung)
      lTarget.set(-0.2, -0.12, -0.28).applyQuaternion(this.aimQuat).add(this.aimPivot);
      lFree = 1;
    } else {
      this._gunToModel(A.left, lTarget);
      this._handOnGrip(lQuat, 'L');
    }
    // Pistole im Sprint: linker Arm schwingt frei
    if (kind === 'pistol' && this.sprint > 0.01) {
      const ph = this.phase * Math.PI * 2;
      const swing = _v3.set(-0.24, -0.3, -0.08 + Math.sin(ph) * 0.18).applyQuaternion(this.wq[0]).add(wp[0]).add(_v4.set(0, 0.25, 0));
      lTarget.lerp(swing, this.sprint);
      lFree = Math.max(lFree, this.sprint);
    }
    // Nachladen
    if (this.reloadW > 0.01) {
      const tgt = this._reloadLeft(S_T);
      if (tgt) { lTarget.lerp(tgt, this.reloadW); lFree = Math.max(lFree, this.reloadW * 0.6); }
    }
    // Schutzhaltung (Blendung/Explosion): linke Hand vor die Augen
    if (this.cower > 0.01) {
      const hq = this.wq[BONE.head];
      const face = qrot(_v3.set(0.03, 0.09, -0.17), hq).add(this.wp[BONE.head]);
      lTarget.lerp(face, this.cower);
      lFree = Math.max(lFree, this.cower);
    }
    // Pumpe nach dem Schuss
    if (this.boltT < 0.6 && this.fireMode === 'pump' && A.pump) {
      const b = Math.sin(Math.PI * ramp(this.boltT, 0.08, 0.55));
      lTarget.add(_v3.set(0, 0, 0.09 * b).applyQuaternion(this.gunQuat));
    }
    // Messer mit der Linken (Nahkampf mit Schusswaffe)
    let knifeVisible = false;
    if (this.meleeT >= 0 && kind !== 'knife') {
      const m = this.meleeT;
      const shoulder = _a.set(-DIM.shoulderX, DIM.shoulderY, 0).applyQuaternion(this.wq[chest]).add(wp[chest]);
      const wind = _v3.set(-0.05, -0.05, -0.12).applyQuaternion(this.aimQuat).add(shoulder);
      const stab = _v4.set(0.12, 0.05, -0.55).applyQuaternion(this.aimQuat).add(shoulder);
      const g = S_M.copy(lTarget).lerp(wind, ramp(m, 0, 0.08)).lerp(stab, ramp(m, 0.08, 0.17));
      g.lerp(lTarget, ramp(m, 0.35, 0.7));
      const w = ramp(m, 0, 0.05) * (1 - ramp(m, 0.6, 0.72));
      lTarget.lerp(g, w);
      lFree = Math.max(lFree, w);
      knifeVisible = m > 0.03 && m < 0.62;
    }
    this.knifeVisible = knifeVisible;
    let lq = lQuat;
    if (lFree > 0.01) lq = lQuat.slerp(this._freeHandQuat(_q, 'L', lTarget), lFree);
    this._armIK('L', lTarget, lq, this._poleWorld(this.poleL, lFree > 0.6 ? _v.set(-0.4, -0.5, 0.6) : null));
    qrot(this.handRGrip.copy(GRIP_R), this.wq[BONE.handR]).add(this.wp[BONE.handR]);
    qrot(this.handLGrip.copy(GRIP_L), this.wq[BONE.handL]).add(this.wp[BONE.handL]);
  }

  /** Pol im Anschlagrahmen → Modellraum. */
  _poleWorld(pole, override) {
    return qrot(_pole.copy(override || pole), this.aimQuat);
  }

  /** Hand-Orientierung auf einem Griff (Modellraum). */
  _handOnGrip(out, side) {
    const gq = this.gunQuat;
    if (side === 'R') {
      // Handrücken nach außen (+X der Waffe), Finger entlang des Griffs (nach hinten geneigt)
      const kind = this.kind;
      const x = qrot(_a.set(1, 0, 0), gq);
      const y = qrot(kind === 'knife' ? _b.set(0, 0.2, 1).normalize() : _b.set(0, 0.94, -0.34), gq);
      return quatFromXY(out, x, y);
    }
    const st = this.anchors.style;
    let x, y;
    if (st === 'flat') { x = _a.set(1, 0.15, 0); y = _b.set(0, 0.35, 1); }
    else if (st === 'post') { x = _a.set(1, 0, 0.1); y = _b.set(0, 1, -0.25); }
    else if (st === 'pistol') { x = _a.set(0.8, 0.3, -0.2); y = _b.set(0.2, 0.75, 0.5); }
    else { x = _a.set(0.25, 1, 0); y = _b.set(-1, 0.25, -0.15); } // under / pump
    qrot(x.normalize(), gq);
    qrot(y.normalize(), gq);
    return quatFromXY(out, x, y);
  }

  /** Freie Hand: entlang des Unterarms, Handfläche nach innen. */
  _freeHandQuat(out, side, target) {
    const sh = side === 'R' ? BONE.upperArmR : BONE.upperArmL;
    const dir = _v3.subVectors(this.wp[sh], target); // Hand → Schulter ≈ +Y der Hand
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    const out2 = quatFromYZ(out, dir, _v4.set(0, 0, 1).applyQuaternion(this.aimQuat));
    return out2;
  }

  /** Zwei-Knochen-IK für einen Arm: Griffpunkt + Handorientierung. */
  _armIK(side, gripTarget, handQ, pole) {
    const ua = side === 'R' ? BONE.upperArmR : BONE.upperArmL;
    const fa = ua + 1, hd = ua + 2;
    const chest = BONE.chest;
    // Schulter (aus Brust-FK)
    const S = qrot(_a.copy(this.off[ua]), this.wq[chest]).add(this.wp[chest]);
    // Handgelenk = Griffpunkt − Hand·Griffversatz
    const W = qrot(_b.copy(side === 'R' ? GRIP_R : GRIP_L), handQ).negate().add(gripTarget);
    const E = _c;
    const T = _v4;
    twoBone(S, W, DIM.upperArm, DIM.foreArm, pole, E, T);
    // Oberarm: +Y zeigt vom Ellbogen zur Schulter, +Z in Richtung Ellbogenspitze (Beugeaußenseite)
    const mid = _v3.addVectors(S, T).multiplyScalar(0.5);
    const bend = mid.subVectors(E, mid);
    if (bend.lengthSq() < 1e-6) bend.copy(pole);
    _v.subVectors(S, E);
    quatFromYZ(_q, _v, bend);
    this._setWorld(ua, _q);
    _v.subVectors(E, T);
    quatFromYZ(_q, _v, bend);
    this._setWorld(fa, _q);
    this._setWorld(hd, handQ);
  }

  /** Linke Hand beim Nachladen: Zielpunkt im Modellraum (oder null). */
  _reloadLeft(out) {
    const A = this.anchors;
    const r = this.reloadP;
    const chest = BONE.chest;
    const grip = this._gunToModel(A.left, S_GRIP);
    const well = A.well ? this._gunToModel(A.well, S_WELL) : this._gunToModel(_v3.set(0, -0.06, -0.08), S_WELL);
    const wellDown = S_WD.copy(well).add(_v3.set(0, -0.16, 0.04).applyQuaternion(this.gunQuat));
    const pouch = _v4.set(-0.07, -0.12, -0.2).applyQuaternion(this.wq[chest]).add(this.wp[chest]);
    if (this.perShell) {
      // Patrone für Patrone: Gürtel ↔ Ladeöffnung im Takt
      const port = A.shell ? this._gunToModel(A.shell, S_PORT) : well;
      const belt = _v3.set(-0.15, -0.05, -0.08).applyQuaternion(this.wq[0]).add(this.wp[0]);
      const k = 0.5 - 0.5 * Math.cos(this.shellT * Math.PI * 2 / 0.48);
      return out.copy(port).lerp(belt, k * (1 - ramp(r, 0.92, 1)));
    }
    if (this.kind === 'pistol') {
      const keys = [[0, grip], [0.15, well], [0.3, wellDown], [0.45, pouch], [0.6, pouch], [0.72, wellDown], [0.8, well], [0.92, grip], [1, grip]];
      return this._keys(out, keys, r);
    }
    const end = this.reloadEmpty && A.charge ? this._gunToModel(A.charge, S_END) : grip;
    const keys = [[0, grip], [0.12, well], [0.27, wellDown], [0.42, pouch], [0.56, pouch], [0.72, wellDown], [0.8, well], [0.88, end], [0.95, grip], [1, grip]];
    // Magazin sichtbar? (raus zwischen 0,25 und 0,74)
    if (this.magazine) this.magazine.visible = !(r > 0.26 && r < 0.73);
    return this._keys(out, keys, r);
  }

  _keys(out, keys, r) {
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, a] = keys[i], [t1, b] = keys[i + 1];
      if (r <= t1) return out.copy(a).lerp(b, smooth((r - t0) / Math.max(1e-4, t1 - t0)));
    }
    return out.copy(keys[keys.length - 1][1]);
  }

  /* ---------------------------------------------------------------- Beine */

  _legs(p) {
    const wq = this.wq, wp = this.wp;
    const s = this.speed;
    const crouch = this.crouch, air = this.air;
    const run = clamp((s - 1.5) / 4, 0, 1);
    const duty = this.duty;
    const S = this.cycle;
    // Laufrichtung relativ zur Hüftausrichtung
    const hy = this.hipYaw;
    const cy = Math.cos(-hy), sy = Math.sin(-hy);
    let dx = 0, dz = -1;
    const lv = this.localVel;
    const lvl = Math.hypot(lv.x, lv.z);
    if (lvl > 0.05) { dx = lv.x / lvl; dz = lv.z / lvl; }
    // in Hüftraum drehen
    const hdx = dx * cy + dz * sy, hdz = -dx * sy + dz * cy;
    const moving = s > 0.25 || this.stepping > 0.05;
    const amp = moving ? 1 : 0;
    const lift = (0.07 + 0.035 * Math.min(s, 8.5)) * (1 - crouch * 0.35);
    const stanceLen = S * duty;
    const feet = this._feet || (this._feet = [V(), V()]);
    const pitches = this._fp || (this._fp = [0, 0]);
    for (let f = 0; f < 2; f++) {
      const side = f === 0 ? -1 : 1;
      const tt = (this.phase + f * 0.5) % 1;
      let along, up = 0, fp = 0;
      if (tt < duty) {
        const k = tt / duty;
        along = stanceLen * (0.5 - k);
        fp = lerp(0.12, -0.28, k) * run * 0.6;
        if (k > 0.75) fp -= (k - 0.75) * 1.2 * run;
      } else {
        const k = (tt - duty) / (1 - duty);
        const e = smooth(k);
        along = stanceLen * (-0.5 + e);
        up = Math.sin(Math.PI * Math.pow(k, 0.8)) * lift;
        fp = lerp(-0.5, 0.25, k) * run * 0.7 + Math.sin(Math.PI * k) * 0.15;
      }
      along *= amp;
      up *= amp;
      // Hüftraum: seitlicher Versatz, Laufweg entlang (hdx, hdz)
      const lat = side * (0.1 + crouch * 0.05 + 0.01 * run);
      let lx = lat + hdx * along, lz = hdz * along - crouch * 0.02 * side;
      if (crouch > 0.01) lz += crouch * (side < 0 ? -0.1 : 0.12); // Ausfallschritt-Stand in der Hocke
      // zurück in Modellraum (Drehung um hy)
      const mx = lx * Math.cos(hy) + lz * Math.sin(hy);
      const mz = -lx * Math.sin(hy) + lz * Math.cos(hy);
      feet[f].set(mx, up, mz);
      pitches[f] = fp * amp;
    }
    // Luftphase: Beine anziehen
    if (air > 0.01) {
      feet[0].lerp(_v.set(-0.11, 0.32, -0.12), air * 0.8);
      feet[1].lerp(_v.set(0.11, 0.22, 0.12), air * 0.8);
    }
    // Bodenanpassung (Treppen) aus Soldier
    const gOff = this.groundOff;
    if (gOff) { feet[0].y += gOff[0]; feet[1].y += gOff[1]; }

    for (let f = 0; f < 2; f++) {
      const side = f === 0 ? -1 : 1;
      const th = f === 0 ? BONE.thighL : BONE.thighR;
      const sh = th + 1, ft = th + 2;
      const H = qrot(_a.copy(this.off[th]), wq[0]).add(wp[0]);
      const foot = feet[f];
      const ankle = _b.set(foot.x, foot.y + DIM.ankle, foot.z + 0.0);
      // Knie zeigt nach vorn (Hüftausrichtung) und leicht nach außen
      _pole.set(side * 0.18, 0.1, -1).applyAxisAngle(UP, this.hipYaw).normalize();
      const K = _c, T = _v4;
      twoBone(H, ankle, DIM.thigh, DIM.shin, _pole, K, T);
      _v.subVectors(H, K);
      quatFromYZ(_q, _v, _v2.copy(_pole).negate());
      this._setWorld(th, _q);
      _v.subVectors(K, T);
      quatFromYZ(_q, _v, _v2.copy(_pole).negate());
      this._setWorld(sh, _q);
      // Fuß: flach (Gierung der Hüfte + leicht auswärts), Neigung aus dem Gang
      _e.set(pitches[f], this.hipYaw - side * 0.08, 0, 'YXZ');
      _q.setFromEuler(_e);
      this._setWorld(ft, _q);
    }
  }
}

export { POSES };
