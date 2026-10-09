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
//  • Waffenhandhabung (actions.js): Nachladen je Waffenart mit Magazin in der Hand (exakt entlang der Schachtachse),
//    bewegliche Teile (Schlitten, Ladehebel, Kammerstängel, Pumpe, Gurtdeckel, Trommel), Varianten je Vorgang.
//  • Stand: Füße fest in der Welt, Nachsetzschritte (_plantFeet), Leerlauf-Gesten (Bots), Hinlegen über die Knie,
//    Kriechen, Hürdenhaltung beim Sprung nach vorn, Rutschen (Puppen), Wurf-/Nahkampf-Varianten.
//  • Ergebnis: lokale Knochen-Quaternionen + Modellraum-Gelenke (für Trefferzonen/Ragdoll) +
//    Waffentransformation.
import * as THREE from 'three';
import { BONES, BONE, BONE_COUNT, DIM } from './rig.js';
import { quatFromYZ, quatFromXY, twoBone, clamp, lerp, smooth, damp, wrap, ramp, spring, qrot } from './ik.js';
import { Handling } from './actions.js';

const V = () => new THREE.Vector3();
const Qn = () => new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
const _q = Qn(), _q2 = Qn(), _qi = Qn();
// Liegen (bots-scale): Beinknochen (Neigung, Gierung, Rollen) – gestreckt, leicht gespreizt, rechtes Knie etwas angewinkelt
const PRONE_LEGS = [[BONE.thighL, 0.16, 0, 0.12], [BONE.shinL, 0.02, 0, 0], [BONE.footL, 0.3, 0, 0], [BONE.thighR, 0.14, 0, -0.16], [BONE.shinR, -0.08, 0, 0], [BONE.footR, 0.35, 0, 0]];
const _v = V(), _v2 = V(), _v3 = V(), _v4 = V(), _a = V(), _b = V(), _c = V(), _pole = V();
const _ax = V();
const PRONE_ANKLE_Y = 0.1; // m über der Standfläche (Liegen)
const KNEE_MIN = 0.06; // Kniegelenk mindestens so hoch (Radius des Knies) – liegend, kniend, kriechend
const PRONE_CHAINS = [[BONE.thighL, BONE.shinL, BONE.footL], [BONE.thighR, BONE.shinR, BONE.footR]];
// lokale Drehungen der Liege-Beinhaltung je Bein [Oberschenkel, Unterschenkel] (für _proneAnkle)
const PRONE_Q = [[0, 1], [3, 4]].map(([a, b]) => [a, b].map((k) => new THREE.Quaternion().setFromEuler(new THREE.Euler(PRONE_LEGS[k][1], PRONE_LEGS[k][2], PRONE_LEGS[k][3], 'YXZ'))));
const _qa = new THREE.Quaternion(), _ka = new THREE.Vector3(), _kb = new THREE.Vector3();
const _ku = V(), _ke1 = V(), _ke2 = V();

/**
 * Knie K auf seinem Kreis um die Achse Hüfte H → Knöchel T nach oben drehen, bis K.y ≥ minY (Knochenlängen und Knöchel
 * bleiben; reicht der Kreis nicht so hoch, der höchste Punkt). side = −1 links / +1 rechts: das Knie weicht nach außen aus.
 */
function kneeUp(H, T, K, minY, side) {
  _ku.subVectors(T, H);
  const d = _ku.length();
  if (d < 1e-5) return;
  _ku.multiplyScalar(1 / d);
  const s = _ke1.subVectors(K, H).dot(_ku);
  const cx = H.x + _ku.x * s, cy = H.y + _ku.y * s, cz = H.z + _ku.z * s;
  _ke1.set(K.x - cx, K.y - cy, K.z - cz);
  const R = _ke1.length();
  if (R < 1e-5) return;
  _ke1.multiplyScalar(1 / R);
  _ke2.crossVectors(_ku, _ke1);
  const A = R * Math.hypot(_ke1.y, _ke2.y);
  if (A < 1e-6) return;
  const top = Math.atan2(_ke2.y, _ke1.y); // Winkel des höchsten Kreispunkts (0 = jetzige Lage)
  const c = (minY - cy) / A;
  let th = top;
  if (c < 1) {
    // von den zwei Lösungen die, bei der das Knie nach außen geht (nie über das andere Bein)
    const w = Math.acos(Math.max(-1, c)), t1 = wrap(top + w), t2 = wrap(top - w);
    const x1 = _ke1.x * Math.cos(t1) + _ke2.x * Math.sin(t1), x2 = _ke1.x * Math.cos(t2) + _ke2.x * Math.sin(t2);
    th = x1 * side >= x2 * side ? t1 : t2;
  }
  const cs = Math.cos(th) * R, sn = Math.sin(th) * R;
  K.set(cx + _ke1.x * cs + _ke2.x * sn, cy + _ke1.y * cs + _ke2.y * sn, cz + _ke1.z * cs + _ke2.z * sn);
}
// feste Zwischenspeicher (keine Allokationen pro Bild)
const S_R = V(), S_BP = V(), S_G = V(), S_L = V(), S_T = V(), S_M = V();
// (Griff-/Schacht-Zwischenspeicher des früheren Nachladens: jetzt in actions.js)
const S_LQ = Qn();
const S_SH = V(), S_GZ = V(), S_D = V();
// Reichweite Schulter → Handfläche (Ober- + Unterarm + Handballen), leicht gebeugter Ellbogen
const LEFT_REACH = 0.555;
// Rumpf leicht seitlich eingedreht (linke Schulter vor) bei Langwaffen – wie echte Schützen, die Hand erreicht den Vorderschaft
const BLADE = 0.24;
// Wurfbahnen der rechten Hand (Anschlagrahmen, relativ zur Schulter): Ausholen, Abwurf (0,66 s), Nachschwung
const THROW_OVER = [[0.1, 0.25, 0.18], [0.02, 0.12, -0.52], [-0.1, -0.25, -0.38]];
const THROW_UNDER = [[0.12, -0.5, 0.2], [0.02, -0.12, -0.5], [-0.04, 0.1, -0.42]];
const THROW_SIDE = [[0.42, -0.04, 0.1], [0.0, 0.02, -0.52], [-0.32, -0.1, -0.3]];
const PARENT = BONES.map((b) => b[1]); // Elternknochen je Index
const win = (r, a, b, c, d) => ramp(r, a, b) * (1 - ramp(r, c, d)); // Fenster: ein a→b, aus c→d
/** Prüfstand: feste Leerlauf-Geste statt Zufall (dev/bots.html, tools/anim-soldier.mjs); null = zufällig. */
export const Fidget = { force: null };
/** Prüfstand: feste Wurf-/Nahkampf-Variante ('over'|'under'|'side', 'stab'|'slash'|'butt'); null = zufällig. */
export const Gesture = { throw: null, melee: null };

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
    // alle Felder vorab anlegen (feste Objektgestalt → schnelle Zugriffe in den heißen Schleifen)
    this.lGap = 0; this.plantShift = 0; this._blade = 0; this._prLie = 0; this._replant = false;
    this.throwVar = 'over'; this.meleeVar = 'stab'; this.longK = 0; this.bladeK = BLADE;
    this.reloadP = 0; this.reloadEmpty = false; this.perShell = false; this.aimPitch = 0; this.aimRel = 0; this.turning = false;
    this.grenadeVisible = false; this.knifeVisible = false;
    this._feet = [V(), V()]; this._fp = [0, 0]; this._fy = [0, 0]; this._nx = [0, 0]; this._nz = [0, 0];
    this._fl = { y: 0, p: 0, r: 0, sy: 0, cp: 0 };
    this.hd = new Handling(this); // Waffenhandhabung: Nachladen je Waffenart, bewegliche Teile (actions.js)
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
    this.prone = 0; // bots-scale: Liegen 0..1 (Becken flach, Rumpf auf den Ellbogen, Beine gestreckt nach hinten)
    this.proneLin = 0;
    this.obstruct = 0; // bots-scale: Waffe an der Wand 0..1 (zurückgezogen + hoch)
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
    this.stepping = 0; // Drehen im Stand läuft
    this.turnV = 0; // Winkelgeschwindigkeit beim Drehen im Stand
    this.vy = 0; // senkrechte Geschwindigkeit (Luftphase: steigend/fallend)
    this.hurdle = 0; // Sprung nach vorn (über ein Hindernis): Hürdenhaltung 0..1
    this.slide = 0; // Rutschen (Mehrspieler-Puppen) 0..1
    this.crawlW = 0; this.crawlPh = 0; // Kriechen (liegend in Bewegung)
    this.stepYaw = yaw;
    // Stand: Füße stehen fest in der Welt (x, z, Gierung), Nachsetzschritte (t ≥ 0) – siehe _plantFeet
    this.plant = { on: false, w: 0, rel: 0, f: [0, 1].map(() => ({ x: 0, z: 0, yaw: 0, t: -1, dur: 0.28, sx: 0, sz: 0, syaw: 0, h0: 0, lift: 0, w: 0 })) };
    this.rootX = NaN; this.rootZ = NaN;
    this._dt = 0;
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
    // Leerlauf-Gesten (nur Bots im Stand, rein optisch): Gewicht verlagern, Ausrüstung richten, Helm, Waffe prüfen,
    // Nacken lockern, über die Schulter schauen
    this.fid = { kind: null, t: 0, dur: 0, side: 1, next: 2 + Math.random() * 5, allow: 0, w: 0, hand: 0 };
    if (this.hd) { this.hd.restore(); this.hd.on = false; this.hd.r = 0; this.hd.tl = null; }
    this.pose(true);
  }

  /** Bewegliche Teile der Waffe in Ruhelage (Tod: Waffe fällt mit eingesetztem Magazin; Respawn; Waffenwechsel). */
  restWeapon() {
    if (this.hd) { this.hd.restore(); this.hd.on = false; this.hd.tl = null; }
    this.reloadW = 0;
  }

  /* ================================================================ Waffe */

  /** Waffe setzen: Anker im Waffenraum vermessen. */
  setWeapon(gun, def) {
    this.hd.restore(); // vorherige Waffe: Teile in Ruhelage, bevor neu vermessen wird
    this.longK = 0;
    this.bladeK = BLADE;
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
      // Magazin (für Aufrufer, z. B. Leichen): nur echte Magazine – die Schrotpatrone ('shell') bleibt versteckt
      this.magazine = ud.magazine && ud.magazine !== gun && ud.magazine.name === 'mag' ? ud.magazine : null;
      this.hd.setWeapon(gun, def, A); // Teile vermessen (Waffe steht in Grundstellung)
      // Vordergriff darf bis kurz vor den Magazinschacht (bzw. bei Bullpup/ohne Schacht bis vor den Abzugsbügel) wandern
      const mg = this.hd.rig && this.hd.rig.mag;
      const stop = mg && mg.p0.z < -0.03 && !mg.top ? mg.p0.z - 0.035 : -0.1;
      // Pumpflinte: Hand bleibt am Vorderschaft (bewegt sich beim Repetieren mit)
      A.slideMax = this.hd.rig && this.hd.rig.pump ? 0.08 : Math.max(0, stop - A.left.z);
      // lange Waffen: stärker eingedreht (Länge Schaft bis Mündung), in Hüfthaltung etwas näher am Körper
      const len = (info.max ? info.max[2] : 0.3) - (info.min ? info.min[2] : -0.5);
      this.longK = clamp((len - 0.75) / 0.6, 0, 1);
      this.bladeK = BLADE + 0.26 * this.longK;
      gun.position.copy(prevPos); gun.quaternion.copy(prevQuat); gun.scale.copy(prevScale);
      if (prevParent) prevParent.add(gun);
    } else { this.magazine = null; this.hd.setWeapon(null, null, A); }
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
      // Hüfthaltung langer Waffen: Schaft unter die Achsel, Waffe näher (Vorderhand erreicht den Vorderschaft)
      this.poses.ready.p.z += 0.09 * (this.longK || 0);
      this.poses.ready.p.x -= 0.02 * (this.longK || 0);
      this.poses.ads.p.z += 0.05 * (this.longK || 0);
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
    this._dt = dt;
    this.rootX = Number.isFinite(p.rootX) ? p.rootX : NaN;
    this.rootZ = Number.isFinite(p.rootZ) ? p.rootZ : NaN;
    const sp = Math.hypot(p.velocity.x, p.velocity.z);
    this.speed += (sp - this.speed) * damp(12, dt);
    this.localVel.lerp(p.velocity, damp(10, dt));
    this.crouch += ((p.crouch ? 1 : 0) - this.crouch) * damp(9, dt);
    // Hinlegen/Aufstehen: gleichmäßiger Ablauf (0,75 s hin, 0,6 s auf) mit weichem Anfang/Ende – erst auf die Knie, dann flach
    this.proneLin = clamp((this.proneLin || 0) + (p.prone ? dt / 0.75 : -dt / 0.6), 0, 1);
    this.prone = smooth(this.proneLin);
    if (this.prone < 1e-3) this.prone = 0;
    this.obstruct += ((p.obstruct || 0) - this.obstruct) * damp((p.obstruct || 0) > this.obstruct ? 22 : 8, dt); // schnell hoch, langsam zurück
    this.sprint += ((p.sprint ? 1 : 0) - this.sprint) * damp(7, dt);
    this.ads += ((p.ads || 0) - this.ads) * damp(14, dt);
    const airborne = !p.onGround;
    this.airTime = airborne ? this.airTime + dt : 0;
    const airTarget = airborne && this.airTime > 0.08 ? 1 : 0;
    if (!airTarget && this.air > 0.5 && p.onGround) this.land.v -= 1.6 * this.air; // Landung
    this.air += (airTarget - this.air) * damp(airTarget ? 8 : 14, dt);
    this.vy = Number.isFinite(p.vy) ? p.vy : 0;
    // Sprung nach vorn (Hindernis überwinden): Hürdenhaltung, solange in der Luft
    const fwdV = -this.localVel.z;
    this.hurdle += ((this.air > 0.3 ? clamp((fwdV - 1.5) / 2, 0, 1) : 0) - this.hurdle) * damp(10, dt);
    this.slide += ((p.sliding ? 1 : 0) - this.slide) * damp(p.sliding ? 10 : 6, dt);
    if (this.slide < 1e-3) this.slide = 0;

    // Körper-Gierung: folgt dem Ziel im Lauf eng, im Stand mit Totzone + Nachsetzschritt
    const want = this.prone > 0.05 && Number.isFinite(p.proneYaw) ? p.proneYaw : p.aimYaw;
    const diff = wrap(want - this.bodyYaw);
    if (this.speed > 0.6 || this.air > 0.5) {
      this.bodyYaw = wrap(this.bodyYaw + diff * damp(9, dt));
      this.turnV = 0;
    } else if (Math.abs(diff) > 0.85 || this.turning) {
      // Drehen im Stand: Winkelgeschwindigkeit mit Anlauf/Abbremsen (kein ruckartiges Mitdrehen); die Füße bleiben stehen
      // und setzen nach (_plantFeet)
      this.turning = Math.abs(diff) > 0.1;
      const target = clamp(diff * 7, -4.8, 4.8);
      this.turnV += (target - this.turnV) * damp(12, dt);
      if (Math.abs(this.turnV * dt) > Math.abs(diff)) this.turnV = diff / Math.max(dt, 1e-4);
      this.bodyYaw = wrap(this.bodyYaw + this.turnV * dt);
      this.stepping = Math.min(1, this.stepping + dt * 4);
    } else {
      this.turnV *= 1 - damp(10, dt);
      this.stepping = Math.max(0, this.stepping - dt * 2.5);
    }

    // Gang (im Stand übernimmt _plantFeet die Füße – der Schrittzyklus läuft nur bei echter Bewegung)
    const crouch = this.crouch;
    const s = this.speed;
    const moving = s > 0.25;
    const sEff = s;
    const duty = s < 1.5 ? 0.62 : s < 5 ? lerp(0.62, 0.34, (s - 1.5) / 3.5) : lerp(0.34, 0.24, clamp((s - 5) / 3.2, 0, 1));
    // Schrittlänge: geduckt kurze, schnelle Schritte (Knie bleibt über dem Boden), sonst wie gehabt
    const reach = lerp(0.86, 0.6, crouch);
    const cycle = clamp(lerp(0.55 + 0.5 * sEff, 0.42 + 0.3 * sEff, crouch), lerp(0.6, 0.5, crouch), reach / duty);
    this.duty += (duty - this.duty) * damp(6, dt);
    this.cycle += (cycle - this.cycle) * damp(6, dt);
    const prevPhase = this.phase;
    if (moving && this.air < 0.5 && this.slide < 0.5) this.phase = (this.phase + (sEff / this.cycle) * dt) % 1;
    // Kriechen: Zugphase läuft mit der Geschwindigkeit (≈ 0,9 m je Doppelzug, links/rechts im Wechsel)
    const crawlT = this.prone > 0.6 ? clamp((s - 0.08) / 0.45, 0, 1) : 0;
    this.crawlW += (crawlT - this.crawlW) * damp(5, dt);
    if (this.crawlW > 0.01) this.crawlPh = (this.crawlPh + (s / 0.9) * dt) % 1;
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
    this.leanX += (leanT - this.leanX) * damp(30, dt); // Bot glättet selbst (LEAN_RATE) – hier nur gegen Sprünge

    // Gesten-Zeitgeber (Varianten je Wurf/Stoß rein optisch, je Client zufällig; Zeitpunkte bleiben die des Spiels)
    if (p.throwing) {
      if (this.throwT < 0) {
        this.throwT = 0;
        const low = p.crouch || p.prone;
        const r = Math.random();
        this.throwVar = Gesture.throw || (low ? (r < 0.65 ? 'under' : 'side') : r < 0.6 ? 'over' : r < 0.8 ? 'side' : 'under');
      }
      this.throwT += dt;
      if (p.cooking && this.throwT > 0.47) this.throwT = 0.47;
    } else if (this.throwT >= 0) {
      this.throwT = this.throwT < 0.9 && this.throwT > 0 ? this.throwT + dt : -1;
      if (this.throwT > 1.0) this.throwT = -1;
    }
    if (p.meleeing) {
      if (this.meleeT < 0) {
        this.meleeT = 0;
        const r = Math.random();
        // Schusswaffe: Messerstoß, Messerschnitt, Stoß mit der Waffe; Messer in der Hand: Stich oder Schnitt
        this.meleeVar = Gesture.melee || (this.kind === 'knife' ? (r < 0.55 ? 'stab' : 'slash') : r < 0.45 ? 'stab' : r < 0.8 ? 'slash' : 'butt');
      }
      this.meleeT += dt;
    } else if (this.meleeT >= 0) { this.meleeT += dt; if (this.meleeT > 0.75) this.meleeT = -1; }
    this.boltT += dt;
    const reloading = !!p.reloading;
    const hd = this.hd;
    // Leer nachgeladene Pumpflinte: nach der letzten Patrone repetieren (wie der Ton in audio.js)
    if (!reloading && hd.on && hd.empty && hd.tl && hd.tl.kind === 'shell' && hd.r > 0.75 && this.fireMode === 'pump') this.boltT = 0;
    hd.update(dt, reloading, p.reloadProgress, p.reloadEmpty, p.reloadPhase);
    this.reloadW += ((reloading ? 1 : 0) - this.reloadW) * damp(reloading ? 10 : 7, dt);
    if (this.reloadW < 1e-3) this.reloadW = 0;
    this.reloadP = hd.r;
    this.reloadEmpty = hd.empty;
    this.perShell = !!p.perShell;
    const throwing = this.throwT >= 0;
    const meleeOff = this.meleeT >= 0 && this.kind !== 'knife' && this.meleeVar !== 'butt';
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
    this._fidget(dt, p);

    this.aimPitch = clamp(p.aimPitch || 0, -1.3, 1.3);
    this.aimRel = clamp(wrap(want - this.bodyYaw), -1.4, 1.4);
    this.pose(false, p);
    return this.bodyYaw;
  }

  /**
   * Leerlauf-Gesten: starten nur im ruhigen Stand (Bot, kein Anschlag/Nachladen/Wurf/Nahkampf/Drehen), werden bei jeder
   * Störung sofort weich ausgeblendet. Ergebnis: this.fid.w (Hülle 0..1) + this.fid.hand (linke Hand frei 0..1).
   */
  _fidget(dt, p) {
    const F = this.fid;
    const ok = !!p.idleLook && this.speed < 0.3 && this.reloadW < 0.05 && this.throwT < 0 && this.meleeT < 0 && this.ads < 0.2 &&
      this.sprint < 0.1 && this.cower < 0.05 && this.prone < 0.1 && this.air < 0.1 && !this.turning && this.obstruct < 0.1;
    F.allow += ((ok ? 1 : 0) - F.allow) * damp(ok ? 4 : 12, dt);
    if (F.kind) {
      F.t += dt;
      if (F.t >= F.dur || F.allow < 0.02) { F.kind = null; F.next = this.time + 3 + Math.random() * 6; }
    } else if (ok && this.time > F.next) {
      const KINDS = ['weight', 'weight', 'gear', 'helmet', 'check', 'stretch', 'look'];
      F.kind = KINDS[(Math.random() * KINDS.length) | 0];
      if (Fidget.force) F.kind = Fidget.force;
      F.t = 0;
      F.side = Math.random() < 0.5 ? -1 : 1;
      F.dur = F.kind === 'weight' ? 3 + Math.random() * 3 : F.kind === 'check' ? 2.2 : F.kind === 'look' ? 2.4 : F.kind === 'gear' ? 1.8 : 1.6;
    }
    if (!F.kind) { F.w = 0; F.hand = 0; return; }
    const t = F.t, d = F.dur;
    F.w = win(t, 0, F.kind === 'weight' ? 0.7 : 0.35, d - (F.kind === 'weight' ? 0.8 : 0.4), d) * F.allow;
    F.hand = F.kind === 'gear' || F.kind === 'helmet' ? win(t, 0.12, 0.45, d - 0.45, d - 0.1) * F.allow : 0;
  }

  /** Blick/Rumpf der Leerlauf-Gesten (y/p Hals+Kopf, r Kopf rollen, sy Rumpf gieren, cp Brust neigen). */
  _fidLook() {
    const o = this._fl || (this._fl = { y: 0, p: 0, r: 0, sy: 0, cp: 0 });
    o.y = o.p = o.r = o.sy = o.cp = 0;
    const F = this.fid;
    if (!F.kind || F.w <= 1e-3) return o;
    const w = F.w, t = F.t, sd = F.side;
    if (F.kind === 'check') { o.y = 0.28 * w; o.p = -0.32 * w; }
    else if (F.kind === 'look') { const k = win(t, 0.2, 0.7, 1.6, 2.1); o.y = sd * 0.75 * k * F.allow; o.sy = sd * 0.22 * k * F.allow; o.p = -0.05 * w; }
    else if (F.kind === 'stretch') { const k = Math.sin(Math.PI * 2 * clamp((t - 0.25) / 1.0, 0, 1)); o.r = 0.32 * k * sd * w; o.p = -0.15 * w; o.cp = -0.06 * w; }
    else if (F.kind === 'helmet') { o.r = 0.16 * sd * w; o.y = -0.12 * w; }
    else if (F.kind === 'gear') { o.p = -0.22 * w; o.y = -0.1 * w; }
    else if (F.kind === 'weight') { o.y = 0.08 * sd * w; }
    return o;
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
    // Leerlauf: Gewicht auf ein Bein (Becken seitlich, freie Hüfte sinkt → Knie gibt nach), Oberkörper gleicht aus
    const fd = this.fid;
    const wShift = fd.kind === 'weight' ? fd.w * fd.side : 0;
    hipY -= Math.abs(wShift) * 0.012;
    this.hipsPos.set(sway * 0.5 + leanX * 0.13 + clamp(this.shoveX.x, -0.3, 0.3) * 0.6 + (this.plantShift || 0) + wShift * 0.045, hipY, crouch * 0.04 + clamp(this.shoveZ.x, -0.3, 0.3) * 0.6);
    const twist = s > 0.3 ? Math.sin(ph) * lerp(0.08, 0.16, run) * (1 - crouch * 0.5) : 0;
    const slide = this.slide;
    const pelvisPitch = -crouch * 0.18 - sprint * 0.12 + slide * 0.38;
    if (slide > 0) this.hipsPos.y = lerp(this.hipsPos.y, 0.5, slide); // Rutschen: Becken tief, Oberkörper zurück
    _e.set(pelvisPitch, this.hipYaw + twist + wShift * 0.06, sway * 1.4 + (bL - bR) * 0.26 + leanRoll * 0.15 + wShift * 0.075, 'YXZ');
    wq[0].setFromEuler(_e);
    const pr = this.prone;
    if (pr > 0) {
      // Liegen: Becken flach (Wirbelsäule zeigt nach vorn, Beine nach hinten), knapp über dem Boden, Körper hinter den Füßen.
      // Übergang über die Knie: erst sinkt das Becken (kniend, leicht vorgebeugt), dann legt sich der Körper nach vorn ab.
      // Kriechen: Becken pendelt seitlich und dreht im Wechsel mit dem ziehenden Knie
      const cw = this.crawlW * pr, cph = this.crawlPh * Math.PI * 2;
      const k1 = smooth(pr / 0.45), k2 = (this._prLie = smooth((pr - 0.3) / 0.7));
      const y = lerp(lerp(this.hipsPos.y, 0.52, k1), 0.2, k2), z = lerp(lerp(this.hipsPos.z, 0.1, k1), 0.66, k2);
      this.hipsPos.set(this.hipsPos.x * (1 - pr) + Math.sin(cph) * 0.035 * cw, y, z);
      _e.set(-1.47, this.hipYaw * 0.3 + Math.sin(cph) * 0.13 * cw, sway * 0.5 + Math.sin(cph) * 0.05 * cw, 'YXZ');
      _q.setFromEuler(_e);
      _e.set(-0.3, this.hipYaw * 0.3, 0, 'YXZ'); // kniend: Becken nach vorn gekippt
      _q2.setFromEuler(_e);
      wq[0].slerp(_q2, k1 * (1 - k2)).slerp(_q, k2);
    } else this._prLie = 0;
    lq[0].copy(wq[0]);
    wp[0].copy(this.hipsPos);

    /* ---------- Wirbelsäule → Kopf (Zielverteilung) */
    const aimRel = this.aimRel || 0;
    const pitch = this.aimPitch || 0;
    const ads = this.ads;
    const yawRest = aimRel - (this.hipYaw + twist); // durch Rumpf auszugleichen
    const lean = 0.04 + run * 0.06 + sprint * 0.22 + crouch * 0.12 * (1 - slide) - slide * 0.42;
    const fP = this.flinchP.x, fR = this.flinchR.x;
    const tw = clamp(this.twist.x, -0.7, 0.7);
    const breatheP = Math.sin(t * 1.7 + 0.6) * 0.012;
    // Schutzhaltung: Kopf weg- und nach unten gedreht, Rumpf leicht eingerollt
    const cwY = cower * 0.55, cwP = cower * 0.3;
    // Wirbelsäule, Brust, Hals, Kopf: (Gierung, Neigung, Rollen)
    const gl = this.glance;
    // Handhabung (Nachladen): Waffenhaltung + Blick zur Waffe/Tasche – reine Funktion des Fortschritts, vor der Wirbelsäule
    this.hd.gunPose(this.reloadW);
    const fl = this._fidLook();
    // Wurf: Oberkörper dreht beim Ausholen nach rechts, beim Abwurf nach links (unten: weniger, seitlich: mehr)
    if (this.throwT >= 0) {
      const tt = this.throwT, k = this.throwVar === 'under' ? 0.5 : this.throwVar === 'side' ? 1.3 : 1;
      const twistT = (-0.32 * ramp(tt, 0.3, 0.47) + 0.62 * ramp(tt, 0.56, 0.68) - 0.3 * ramp(tt, 0.74, 0.96)) * k;
      fl.sy += twistT * 0.5;
      fl.cp += (this.throwVar === 'under' ? -0.12 : 0.1) * win(tt, 0.52, 0.66, 0.74, 0.92);
    }
    if (this.crawlW > 0.01 && pr > 0) fl.sy -= Math.sin(this.crawlPh * Math.PI * 2) * 0.1 * this.crawlW * pr;
    // Nahkampf: Schnitt dreht den Rumpf mit, Stoß mit der Waffe lehnt nach vorn
    if (this.meleeT >= 0 && this.meleeVar !== 'stab') {
      const m = this.meleeT;
      if (this.meleeVar === 'slash') fl.sy += (-0.18 * ramp(m, 0, 0.08) + 0.4 * ramp(m, 0.08, 0.2)) * (1 - ramp(m, 0.3, 0.7));
      else fl.cp += 0.14 * win(m, 0.06, 0.16, 0.3, 0.6);
    }
    const lkY = gl.yaw + this.hd.lookY + fl.y, lkP = gl.pitch + this.hd.lookP + fl.p;
    // Langwaffe: Rumpf eingedreht (linke Schulter vor), Hals/Kopf gleichen aus – Blick bleibt auf dem Ziel
    const blade = (this._blade = this.kind === 'rifle' ? (this.bladeK || BLADE) * (1 - sprint) * (1 - pr) * (1 - this.slide) * (1 - 0.45 * ads) : 0);
    this._rotFk(1, yawRest * 0.35 + tw * 0.5 + fl.sy - blade * 0.45, pr * 0.16 + pitch * 0.18 - lean * 0.5 - pelvisPitch * 0.4 + fP * 0.5 + cower * 0.12, -sway * 1.2 + fR * 0.5 + leanRoll * 0.4 - wShift * 0.05);
    this._rotFk(2, yawRest * 0.4 + tw * 0.35 + fl.sy - blade * 0.55, pr * 0.36 + pitch * 0.32 - lean * 0.45 - pelvisPitch * 0.6 + breatheP + fP * 0.5 + this.recoilP.x * 0.04 + cower * 0.1 + this.hd.lookP * 0.15 + fl.cp, fR * 0.4 + leanRoll * 0.4 - wShift * 0.04);
    this._rotFk(3, yawRest * 0.12 + lkY * 0.4 - tw * 0.3 + cwY * 0.4 + blade * 0.55, pr * 0.42 + pitch * 0.2 + lean * 0.4 - ads * 0.22 + lkP * 0.4 + cwP * 0.4, -ads * 0.06 + leanRoll * 0.08 + fl.r * 0.4);
    this._rotFk(4, yawRest * 0.13 + lkY * 0.6 - tw * 0.2 + cwY * 0.6 + blade * 0.45, pr * 0.4 + pitch * 0.3 + lean * 0.55 + ads * 0.12 + this.flinchH.x * 0.3 + lkP * 0.6 + cwP * 0.6, -ads * 0.2 - fR * 0.2 - leanRoll * 0.1 + fl.r * 0.6);

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
    if (pr > 0) this._proneLegs(this._prLie || 0);

    /* ---------- Kopfmitte (Trefferzone) */
    qrot(this.headCenter.fromArray(DIM.headCenter), wq[BONE.head]).add(wp[BONE.head]);
    void init;
  }

  /** Knöchel der Liege-Beinhaltung (Modellraum) für Bein f, aus Becken + PRONE_LEGS (ohne die Knochen zu verändern). */
  _proneAnkle(f, out) {
    const [th, sh] = PRONE_CHAINS[f];
    const qt = _qa.multiplyQuaternions(this.wq[0], PRONE_Q[f][0]);
    const knee = qrot(_ka.copy(this.off[th]), this.wq[0]).add(this.wp[0]).add(qrot(_kb.copy(this.off[sh]), qt));
    const qs = qt.multiply(PRONE_Q[f][1]);
    return out.copy(knee).add(qrot(_kb.copy(this.off[sh + 1]), qs));
  }

  /** Liegen: Beine gestreckt und leicht gespreizt, Fußspitzen im Boden (Überblendung über die Lauf-IK). */
  _proneLegs(pr) {
    // Liege-Beinhaltung erst gegen Ende des Ablegens überblenden (davor führt die Bein-IK über den Knie-Bodenpfad aus _legs –
    // ein Mischen der lokalen Drehungen mittendrin ließe das Knie durch den Boden schwingen)
    const L = PRONE_LEGS, wl = smooth((this.prone - 0.7) / 0.3);
    for (let k = 0; k < L.length; k++) {
      const [i, x, y, z] = L[k];
      _e.set(x, y, z, 'YXZ');
      _q.setFromEuler(_e);
      this.lq[i].slerp(_q, wl);
      this._fk(i);
    }
    // Kriechen: abwechselnd ein Knie seitlich nach vorn ziehen, das andere Bein schiebt gestreckt nach
    // (Zwei-Knochen-IK: Knöchel rückt zur Hüfte und etwas nach außen, das Knie zeigt seitlich zum Boden –
    // Unterschenkel bleibt flach am Boden statt in die Luft zu stehen)
    const cw = this.crawlW * pr;
    if (cw > 0.01) {
      for (let f = 0; f < 2; f++) {
        const side = f === 0 ? -1 : 1;
        const kk = Math.max(0, Math.sin((this.crawlPh + f * 0.5) * Math.PI * 2)) * cw;
        if (kk < 1e-3) continue;
        const [th, sh, ft] = PRONE_CHAINS[f];
        const H = this.wp[th];
        const tgt = _v.copy(this.wp[ft]).lerp(_v2.set(H.x + side * 0.13, H.y - 0.1, H.z + 0.64), kk);
        if (tgt.y < PRONE_ANKLE_Y) tgt.y = PRONE_ANKLE_Y;
        _pole.set(side, -0.3, -0.25).normalize();
        twoBone(H, tgt, DIM.thigh, DIM.shin, _pole, _c, _v4);
        quatFromYZ(_q, _v3.subVectors(H, _c), _v2.copy(_pole).negate());
        this._setWorld(th, _q);
        quatFromYZ(_q, _v3.subVectors(_c, _v4), _v2.copy(_pole).negate());
        this._setWorld(sh, _q);
        this._fk(ft);
      }
    }
    // Knöchel nicht unter den Boden (Modellraum y = 0 = Standfläche): Oberschenkel so weit anheben, dass das
    // Fußgelenk ≥ PRONE_ANKLE_Y liegt – nur die Fußspitzen berühren den Boden
    // (auch im Übergang: Mindesthöhe vom Stand-Knöchel 0,08 m zur Liegehöhe, Korrektur immer voll)
    const ankleMin = lerp(DIM.ankle, PRONE_ANKLE_Y, pr);
    for (const [th, sh, ft] of PRONE_CHAINS) {
      const need = ankleMin - this.wp[ft].y;
      if (this.wp[sh].y < KNEE_MIN - 0.003) {
        // Kniegelenk im Boden (Übergang kniend ↔ liegend): Bein neu lösen – Knöchel bleibt (mind. ankleMin), das Knie dreht
        // auf seinem Kreis um die Achse Hüfte–Knöchel nach oben (Kniescheibe liegt auf statt im Boden)
        const H = this.wp[th];
        const A = _v.copy(this.wp[ft]);
        if (A.y < ankleMin) A.y = ankleMin;
        twoBone(H, A, DIM.thigh, DIM.shin, _v2.subVectors(this.wp[sh], H), _c, _v4);
        kneeUp(H, _v4, _c, KNEE_MIN, th === BONE.thighL ? -1 : 1);
        _v3.subVectors(_v4, H).normalize();
        _ax.subVectors(_c, H);
        _ax.addScaledVector(_v3, -_ax.dot(_v3)).negate(); // −Beugerichtung (wie −pole in _legs)
        if (_ax.lengthSq() < 1e-8) _ax.set(0, 1, 0);
        quatFromYZ(_q, _v3.subVectors(H, _c), _ax);
        this._setWorld(th, _q);
        quatFromYZ(_q, _v3.subVectors(_c, _v4), _ax);
        this._setWorld(sh, _q);
        this._fk(ft);
        continue;
      }
      if (need <= 0.005) continue;
      // Bein um die Hüfte zur Senkrechten hin drehen (Achse = Bein × oben): hebt den Knöchel auf kürzestem Weg an
      const leg = _v.subVectors(this.wp[ft], this.wp[th]);
      const len = Math.max(0.3, leg.length());
      _ax.crossVectors(leg, UP);
      if (_ax.lengthSq() < 1e-8) continue;
      _ax.normalize();
      const ang = Math.min(0.9, Math.asin(clamp((need + 0.01) / len, 0, 1)));
      _q.setFromAxisAngle(_ax, ang).multiply(this.wq[th]);
      this._setWorld(th, _q);
      this._fk(sh); this._fk(ft);
    }
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
    // Eingedrehter Rumpf: Schaft bleibt an der (zurückgenommenen) rechten Schulter, die Laufrichtung bleibt das Ziel
    const bl = this._blade || 0;
    if (bl > 0) { pos.z += Math.sin(bl) * DIM.shoulderX; pos.x -= (1 - Math.cos(bl)) * DIM.shoulderX; }
    // Laufen: leichtes Wippen der Waffe
    const ph = this.phase * Math.PI * 2;
    const mv = clamp(this.speed / 5, 0, 1) * (1 - ads * 0.8);
    pos.x += Math.sin(ph) * 0.008 * mv;
    pos.y += Math.abs(Math.cos(ph)) * 0.012 * mv;
    // Leerlauf-Atmen
    pos.y += Math.sin(this.time * 1.7) * 0.003;
    blend(P.sprint, sprint * (1 - this.reloadW));
    // Nachlade-Grundhaltung (Patrone für Patrone: nur solange geladen wird – zum Repetieren zurück an die Pumpe)
    blend(P.reload, this.reloadW * (this.perShell ? 0.6 * (this.hd.pres ?? 1) : 1));
    blend(P.lowered, this.lowered);
    // Nachladen: Haltung je Waffenart und Phase (actions.js: Schacht zur Hand, Einsetz-Stoß, Ladehebel, Trommel …)
    if (this.reloadW > 1e-3) {
      const g = this.hd.g;
      rx += g.rx; ry += g.ry; rz += g.rz;
      pos.x += g.x; pos.y += g.y; pos.z += g.z;
    }
    // Messerstoß / -schnitt (Messer als Waffe)
    if (this.kind === 'knife' && this.meleeT >= 0) {
      const m = this.meleeT;
      if (this.meleeVar === 'slash') {
        // Schnitt von rechts außen nach links vorn (Klinge quer), Treffer ≈ 0,14 s
        const wind = ramp(m, 0, 0.08) * (1 - ramp(m, 0.08, 0.16));
        const cut = ramp(m, 0.08, 0.2) * (1 - ramp(m, 0.34, 0.62));
        pos.x += 0.14 * wind - 0.3 * cut;
        pos.z += 0.05 * wind - 0.22 * cut;
        pos.y += 0.04 * cut;
        ry += 0.5 * wind - 0.9 * cut;
        rz -= 1.2 * Math.max(wind, cut);
      } else {
        const k = ramp(m, 0.0, 0.08) * (1 - ramp(m, 0.08, 0.2));
        const thrust = ramp(m, 0.08, 0.18) * (1 - ramp(m, 0.3, 0.6));
        pos.z += 0.12 * k - 0.38 * thrust;
        pos.y += 0.1 * thrust;
        pos.x -= 0.1 * thrust;
        rx -= 0.6 * thrust;
      }
    } else if (this.meleeT >= 0 && this.meleeVar === 'butt') {
      // Stoß mit der Waffe (beide Hände bleiben dran): kurz zurück, dann kräftig nach vorn, Mündung hoch; Pistole schlägt
      const m = this.meleeT;
      const wind = ramp(m, 0, 0.07) * (1 - ramp(m, 0.07, 0.15));
      const hit = ramp(m, 0.07, 0.16) * (1 - ramp(m, 0.3, 0.62));
      if (this.kind === 'pistol') { rx += 0.7 * wind - 0.5 * hit; pos.y += 0.08 * wind; pos.z -= 0.16 * hit; }
      else { pos.z += 0.08 * wind - 0.3 * hit; pos.y += 0.04 * hit; rx += 0.25 * hit; ry -= 0.25 * hit; pos.x -= 0.06 * hit; }
    }
    // Landung: Waffe sackt mit dem Körper kurz ab; Kriechen: Waffe wandert im Takt der Ellbogen vor und zurück
    pos.y += this.land.x * 0.05;
    rx += this.land.x * 0.12;
    if (this.crawlW > 0.01 && this.prone > 0.5) {
      const cw = this.crawlW * this.prone, cph = this.crawlPh * Math.PI * 2;
      pos.z += Math.sin(cph + 0.6) * 0.045 * cw;
      pos.x += Math.cos(cph) * 0.02 * cw;
      rz += Math.sin(cph) * 0.06 * cw;
    }
    // Leerlauf-Gesten: Waffe kurz prüfen (gekippt, näher), einhändig gehalten (Ausrüstung/Helm: Waffe sinkt etwas)
    const fd = this.fid;
    if (fd.kind && fd.w > 1e-3) {
      if (fd.kind === 'check') {
        const k = fd.w, roll = Math.sin(Math.PI * clamp((fd.t - 0.3) / 1.6, 0, 1));
        rz -= (0.45 + 0.25 * roll) * k; ry += 0.3 * k; rx += 0.08 * k;
        pos.x -= 0.04 * k; pos.z += 0.07 * k; pos.y += 0.02 * k;
      } else if (fd.hand > 0) blend(P.lowered, fd.hand * 0.4);
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
    // Waffe an der Wand (bots-scale): zurückziehen und hochnehmen („high ready“), damit der Lauf nicht in die Wand ragt
    const ob = this.obstruct;
    if (ob > 1e-3) { pos.z += 0.34 * ob; pos.y += 0.12 * ob; rx += 1.4 * ob; } // ob=1: Lauf fast senkrecht („high port“)
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
    // Nachladen zuerst planen (linke Hand, actions.js) – kann die rechte Hand beanspruchen (Ladehebel rechts, Kammerstängel)
    const hd = this.hd;
    const relW = hd.on || this.reloadW > 0.01 ? hd.left(S_T) * (hd.on ? 1 : this.reloadW) : 0;
    // Kammerstängel (Repetierer): nach dem Schuss bzw. beim leeren Nachladen – Hand am Knauf, der Stängel dreht hoch,
    // fährt zurück und wieder vor (Teil bewegt sich mit, die Hand rutscht nicht ab)
    let boltW = 0, boltU = 0;
    if (this.fireMode === 'bolt' && hd.rig && hd.rig.bolt) {
      if (this.boltT < 0.76) { boltW = ramp(this.boltT, 0, 0.1) * (1 - ramp(this.boltT, 0.62, 0.75)); boltU = clamp((this.boltT - 0.1) / 0.52, 0, 1); }
      const tl = hd.tl;
      if (relW > 0 && tl && tl.charge === 'bolt') {
        const r = hd.r;
        const w = win(r, 0.6, 0.66, 0.9, 0.96) * relW;
        if (w > boltW) { boltW = w; boltU = clamp((r - 0.66) / 0.24, 0, 1); }
      }
    }
    if (boltW > 1e-3) {
      const bp = hd.boltPoint(boltU, S_BP);
      if (bp) { rTarget.lerp(bp, boltW); rFree = Math.max(rFree, boltW * 0.5); }
    }
    // Ladehebel rechts (leeres Nachladen): rechte Hand zieht, die linke hält die Waffe
    if (hd.rw > 0 && relW > 0) { rTarget.lerp(hd.rTarget, hd.rw * relW); rFree = Math.max(rFree, hd.rw * relW); }
    // Granatwurf
    let grenadeVisible = false;
    if (this.throwT >= 0) {
      const tt = this.throwT;
      const shoulder = _a.set(DIM.shoulderX, DIM.shoulderY, 0).applyQuaternion(this.wq[chest]).add(wp[chest]);
      const chestP = _v3.set(0.05, 0.05, -0.2).applyQuaternion(this.wq[chest]).add(wp[chest]);
      // Überkopf (Standard), von unten (Lob, geduckt/liegend bevorzugt), seitlich (flach)
      const tv = this.throwVar;
      const K = tv === 'under' ? THROW_UNDER : tv === 'side' ? THROW_SIDE : THROW_OVER;
      const back = _v4.fromArray(K[0]).applyQuaternion(this.aimQuat).add(shoulder);
      const fwd = _b.fromArray(K[1]).applyQuaternion(this.aimQuat).add(shoulder);
      const follow = _c.fromArray(K[2]).applyQuaternion(this.aimQuat).add(shoulder);
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
      this._leftGrip(lTarget);
      this._handOnGrip(lQuat, 'L');
    }
    // Pistole im Sprint: linker Arm schwingt frei
    if (kind === 'pistol' && this.sprint > 0.01) {
      const ph = this.phase * Math.PI * 2;
      const swing = _v3.set(-0.24, -0.3, -0.08 + Math.sin(ph) * 0.18).applyQuaternion(this.wq[0]).add(wp[0]).add(_v4.set(0, 0.25, 0));
      lTarget.lerp(swing, this.sprint);
      lFree = Math.max(lFree, this.sprint);
    }
    // Nachladen: Hand folgt Magazin/Hebel/Patrone (Zielpunkt aus hd.left oben)
    let holdW = 0;
    if (relW > 0) {
      lTarget.lerp(S_T, relW);
      lFree = Math.max(lFree, relW * (1 - hd.lgrip));
      holdW = relW * hd.lhold;
    }
    // Sprung über ein Hindernis: linke Hand löst sich steigend kurz von der Waffe und stützt seitlich ab
    const hw = this.hurdle * this.air * clamp(this.vy / 2.5, 0, 1) * (kind === 'knife' ? 0 : 1);
    if (hw > 0.01) {
      const tg = qrot(_v3.set(-0.3, -0.02, -0.28), this.wq[0]).add(wp[0]);
      lTarget.lerp(tg, hw);
      lFree = Math.max(lFree, hw);
    }
    // Leerlauf: linke Hand richtet Ausrüstung (Schultergurt, kurzer Zug) bzw. den Helm
    const fd = this.fid;
    if (fd.hand > 0.01) {
      let tg;
      if (fd.kind === 'helmet') tg = qrot(_v3.set(-0.115, 0.07, -0.02), this.wq[BONE.head]).add(this.wp[BONE.head]);
      else {
        tg = qrot(_v3.set(-0.1, 0.16 + Math.sin(Math.max(0, fd.t - 0.45) * 13) * 0.012 * fd.hand, -0.17), this.wq[chest]).add(wp[chest]);
      }
      lTarget.lerp(tg, fd.hand);
      lFree = Math.max(lFree, fd.hand);
    }
    // Schutzhaltung (Blendung/Explosion): linke Hand vor die Augen
    if (this.cower > 0.01) {
      const hq = this.wq[BONE.head];
      const face = qrot(_v3.set(0.03, 0.09, -0.17), hq).add(this.wp[BONE.head]);
      lTarget.lerp(face, this.cower);
      lFree = Math.max(lFree, this.cower);
    }
    // Pumpe nach dem Schuss: Hand und Vorderschaft fahren gemeinsam zurück (Weg aus dem Modell)
    hd.pumpK = 0;
    if (this.boltT < 0.6 && this.fireMode === 'pump' && (A.pump || (hd.rig && hd.rig.pump))) {
      const b = Math.sin(Math.PI * ramp(this.boltT, 0.08, 0.55));
      const tz = hd.rig && hd.rig.pump ? hd.rig.pump.travel.z : 0.085;
      lTarget.add(_v3.set(0, 0, tz * b).applyQuaternion(this.gunQuat));
      hd.pumpK = b;
    }
    // Messer mit der Linken (Nahkampf mit Schusswaffe)
    let knifeVisible = false;
    if (this.meleeT >= 0 && kind !== 'knife') {
      const m = this.meleeT;
      const shoulder = _a.set(-DIM.shoulderX, DIM.shoulderY, 0).applyQuaternion(this.wq[chest]).add(wp[chest]);
      const slash = this.meleeVar === 'slash';
      // Stich: von der Schulter gerade nach vorn; Schnitt: von rechts vor der Brust quer nach links vorn
      const wind = (slash ? _v3.set(0.28, 0.02, -0.22) : _v3.set(-0.05, -0.05, -0.12)).applyQuaternion(this.aimQuat).add(shoulder);
      const stab = (slash ? _v4.set(-0.22, -0.02, -0.5) : _v4.set(0.12, 0.05, -0.55)).applyQuaternion(this.aimQuat).add(shoulder);
      const w = this.meleeVar === 'butt' ? 0 : ramp(m, 0, 0.05) * (1 - ramp(m, 0.6, 0.72));
      if (w > 0) {
        const g = S_M.copy(lTarget).lerp(wind, ramp(m, 0, 0.08)).lerp(stab, ramp(m, 0.08, slash ? 0.2 : 0.17));
        g.lerp(lTarget, ramp(m, 0.35, 0.7));
        lTarget.lerp(g, w);
        lFree = Math.max(lFree, w);
      }
      knifeVisible = w > 0 && m > 0.03 && m < 0.62;
    }
    this.knifeVisible = knifeVisible;
    let lq = lQuat;
    if (lFree > 0.01) lq = lQuat.slerp(this._freeHandQuat(_q, 'L', lTarget), lFree);
    if (holdW > 0.01) lq.slerp(hd.lq, holdW); // hält Magazin/Patrone: Orientierung am Teil
    this._armIK('L', lTarget, lq, this._poleWorld(this.poleL, lFree > 0.6 ? _v.set(-0.4, -0.5, 0.6) : null));
    qrot(this.handRGrip.copy(GRIP_R), this.wq[BONE.handR]).add(this.wp[BONE.handR]);
    qrot(this.handLGrip.copy(GRIP_L), this.wq[BONE.handL]).add(this.wp[BONE.handL]);
    this.lGap = this.handLGrip.distanceTo(lTarget); // Prüfwert: Hand erreicht ihr Ziel (Magazin/Hebel)?
    // Teile der Waffe in ihre aktuelle Lage (Magazin in der Hand, Schlitten, Ladehebel, Deckel, Trommel, Stängel, Pumpe)
    hd.parts(this.reloadW);
  }

  /**
   * Vordergriff der linken Hand (Modellraum). Liegt er außerhalb der Armreichweite (lange Waffen in Hüfthaltung), greift
   * die Hand weiter hinten am Vorderschaft – entlang der Laufachse bis höchstens kurz vor den Magazinschacht. So liegt die
   * Hand immer an der Waffe statt davor in der Luft zu hängen.
   */
  _leftGrip(out) {
    const A = this.anchors;
    this._gunToModel(A.left, out);
    if (!(A.slideMax > 0)) return out;
    const S = qrot(S_SH.copy(this.off[BONE.upperArmL]), this.wq[BONE.chest]).add(this.wp[BONE.chest]);
    const D = S_D.subVectors(out, S);
    const d2 = D.lengthSq();
    const R = LEFT_REACH;
    if (d2 <= R * R) return out;
    const gz = qrot(S_GZ.set(0, 0, 1), this.gunQuat);
    const b = D.dot(gz), disc = b * b - (d2 - R * R);
    const t = clamp(disc >= 0 ? -b - Math.sqrt(disc) : -b, 0, A.slideMax);
    return out.addScaledVector(gz, t);
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
    const moving = s > 0.25;
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
        // Hermite-Bahn: beim Abheben und Aufsetzen dieselbe Geschwindigkeit wie im Stand (relativ zur Hüfte) → in der Welt
        // steht der Fuß in diesen Augenblicken still (kein Schleifen über den Boden beim Lösen/Aufsetzen)
        const a = Math.min(1.5, (1 - duty) / Math.max(0.05, duty)); // Sprint gedeckelt: Rückhol-/Überschwung ≤ 8 % der Schrittlänge
        const k2 = k * k, k3 = k2 * k;
        along = stanceLen * (-0.5 + (3 * k2 - 2 * k3) * (1 + a) - a * k);
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
    // Luftphase: Beine anziehen; nach vorn (Hindernis) wie beim Hürdenlauf – vorderes Bein gestreckt, hinteres seitlich
    // angewinkelt; fallend strecken sich die Beine dem Boden entgegen
    if (air > 0.01) {
      const h = this.hurdle, fall = clamp(-this.vy / 4, 0, 1) * 0.55;
      _v.set(lerp(-0.11, -0.09, h), lerp(0.32, 0.36, h), lerp(-0.12, -0.42, h));
      _v2.set(lerp(0.11, 0.21, h), lerp(0.22, 0.4, h), lerp(0.12, 0.15, h));
      _v.y *= 1 - fall; _v2.y *= 1 - fall;
      feet[0].lerp(_v, air * 0.85);
      feet[1].lerp(_v2, air * 0.85);
    }
    // Rutschen: vorderes Bein lang nach vorn, hinteres unter dem Körper angewinkelt
    if (this.slide > 0.01) {
      feet[0].lerp(_v.set(-0.1, 0.05, -0.72), this.slide);
      feet[1].lerp(_v.set(0.15, 0.0, -0.06), this.slide);
    }
    // Liegen/Übergang (über die Knie): Knie-Bodenpfad – Kniegelenk auf KNEE_MIN + 1 cm, Schienbein flach dahinter; je nach
    // Beckenhöhe rückt der Fuß nach hinten (kniend ½ m, liegend ~0,8 m hinter der Hüfte). Erst am Ende die Liege-Fußziele
    // (Vorwärtskinematik der Liegehaltung) – mittendrin zeigten die am halb aufrechten Becken nach unten, das Knie klappte
    // durch den Boden. Sohle nie unter dem Boden.
    const prn = this.prone;
    if (prn > 0) {
      const k1 = smooth(prn / 0.45), kl = smooth((prn - 0.75) / 0.25);
      for (let f = 0; f < 2; f++) {
        const hj = qrot(_v3.copy(this.off[f === 0 ? BONE.thighL : BONE.thighR]), wq[0]).add(wp[0]); // Hüftgelenk
        const hk = hj.y - (KNEE_MIN + 0.01);
        const back = Math.sqrt(Math.max(0, DIM.thigh * DIM.thigh - hk * hk)) + DIM.shin * 0.97;
        feet[f].lerp(_v.set(hj.x + (f === 0 ? -0.02 : 0.02), 0.01, hj.z + back), k1);
        if (kl > 0) {
          const ank = this._proneAnkle(f, _v);
          ank.y -= DIM.ankle;
          feet[f].lerp(ank, kl);
        }
        if (feet[f].y < 0) feet[f].y = 0;
      }
    }
    // Bodenanpassung (Treppen) aus Soldier
    const gOff = this.groundOff;
    if (gOff) { feet[0].y += gOff[0]; feet[1].y += gOff[1]; }
    // Fuß-Gierung (Modellraum): Hüfte + leicht auswärts; im Stand aus den gepflanzten Füßen
    const fy = this._fy || (this._fy = [0, 0]);
    fy[0] = this.hipYaw + 0.08; fy[1] = this.hipYaw - 0.08;
    this._plantFeet(feet, fy);

    for (let f = 0; f < 2; f++) {
      const side = f === 0 ? -1 : 1;
      const th = f === 0 ? BONE.thighL : BONE.thighR;
      const sh = th + 1, ft = th + 2;
      const H = qrot(_a.copy(this.off[th]), wq[0]).add(wp[0]);
      const foot = feet[f];
      const ankle = _b.set(foot.x, foot.y + DIM.ankle, foot.z + 0.0);
      // Knie zeigt nach vorn (zwischen Hüft- und Fußrichtung) und leicht nach außen; liegend/kniend nach unten
      _pole.set(side * 0.18, 0.1, -1).applyAxisAngle(UP, this.hipYaw + wrap(fy[f] + side * 0.08 - this.hipYaw) * 0.6);
      if (prn > 0) _pole.lerp(_v2.set(side * 0.2, -1, -0.3), prn);
      _pole.normalize();
      const K = _c, T = _v4;
      twoBone(H, ankle, DIM.thigh, DIM.shin, _pole, K, T);
      _v.subVectors(H, K);
      quatFromYZ(_q, _v, _v2.copy(_pole).negate());
      this._setWorld(th, _q);
      _v.subVectors(K, T);
      quatFromYZ(_q, _v, _v2.copy(_pole).negate());
      this._setWorld(sh, _q);
      // Fuß: flach (Gierung der Hüfte bzw. gepflanzt + leicht auswärts), Neigung aus dem Gang
      _e.set(pitches[f], fy[f], 0, 'YXZ');
      _q.setFromEuler(_e);
      this._setWorld(ft, _q);
    }
  }

  /**
   * Stand: Füße stehen fest in der Welt (kein Gleiten beim Drehen, Anhalten oder leichten Schieben). Weicht ein Fuß zu weit
   * von seiner Grundstellung ab (Abstand + Verdrehung), setzt er mit einem kleinen Bogenschritt nach – immer nur einer, bei
   * großer Drehung überlappend. Anlaufen blendet in den Schrittzyklus über; beim Anhalten wird die aktuelle Fußlage
   * übernommen (ein fliegender Fuß setzt als Schritt auf). Benötigt die Weltlage der Wurzel (rootX/Z, sonst aus).
   */
  _plantFeet(feet, fy) {
    const P = this.plant;
    const dt = this._dt;
    const gOff = this.groundOff;
    const rest = this.speed < 0.3 && this.air < 0.2 && this.prone < 0.3 && Number.isFinite(this.rootX);
    const by = this.bodyYaw;
    const c = Math.cos(by), sn = Math.sin(by);
    const rx = this.rootX, rz = this.rootZ;
    this.plantShift = 0;
    if (!rest) {
      // Anlaufen: das Standbein bleibt stehen, bis der Schrittzyklus es anhebt – dann löst es sich als Schritt (statt über den
      // Boden zu gleiten); spätestens nach 0,5 s oder 30 cm Abstand zum Zyklus. Springen/Hinlegen: sofort lösen.
      P.on = false;
      if (!(P.w > 0) || !Number.isFinite(rx)) { P.w = 0; P.f[0].w = 0; P.f[1].w = 0; return; }
      P.rel += dt;
      const now = this.air >= 0.2 || this.prone >= 0.05 || P.rel > 0.5;
      let wMax = 0;
      for (let f = 0; f < 2; f++) {
        const F = P.f[f];
        if (F.w <= 0) continue;
        const dx = F.x - rx, dz = F.z - rz;
        const dev = Math.hypot(dx * c - dz * sn - feet[f].x, dx * sn + dz * c - feet[f].z);
        if (dev > 0.9) { F.w = 0; continue; } // Sprung der Wurzel
        if (now || dev > 0.3 || feet[f].y - (gOff ? gOff[f] : 0) > 0.008) F.w = Math.max(0, F.w - dt * (now ? 8 : 5));
        if (F.w > wMax) wMax = F.w;
      }
      P.w = wMax;
      if (wMax <= 0) return;
    } else if (!P.on) {
      P.on = true;
      P.w = 1;
      P.rel = 0;
      for (let f = 0; f < 2; f++) {
        const F = P.f[f], m = feet[f];
        F.w = 1;
        F.x = m.x * c + m.z * sn + rx;
        F.z = -m.x * sn + m.z * c + rz;
        F.yaw = fy[f] + by;
        F.t = -1;
        const h = m.y - (gOff ? gOff[f] : 0);
        if (h > 0.012) { F.t = 0; F.dur = 0.18; F.sx = F.x; F.sz = F.z; F.syaw = F.yaw; F.h0 = h; }
      }
    }
    const crouch = this.crouch;
    // Grundstellung (Modellraum) wie der Schrittzyklus ohne Bewegung (links/rechts)
    const NX = this._nx || (this._nx = [0, 0]), NZ = this._nz || (this._nz = [0, 0]);
    NX[0] = -(0.1 + crouch * 0.05); NX[1] = -NX[0];
    NZ[0] = crouch * 0.02 - crouch * 0.1; NZ[1] = -crouch * 0.02 + crouch * 0.12;
    // Abweichung je Fuß → ggf. Schritt starten
    let worst = -1, worstScore = 0, busy = -1;
    for (let f = 0; f < 2 && P.on; f++) { // beim Lösen (Anlaufen) keine neuen Schritte/Neupflanzungen
      const F = P.f[f];
      if (F.t >= 0) { busy = f; continue; }
      const dx = F.x - rx, dz = F.z - rz;
      const mx = dx * c - dz * sn, mz = dx * sn + dz * c;
      const dev = Math.hypot(mx - NX[f], mz - NZ[f]);
      if (dev > 0.9 && !this._replant) {
        // Sprung der Wurzel (Teleport, Respawn): aktuelle Lage neu übernehmen
        this._replant = true; P.on = false;
        this._plantFeet(feet, fy);
        this._replant = false;
        return;
      }
      const yd = Math.abs(wrap(F.yaw - by - (f === 0 ? 0.08 : -0.08)));
      const score = dev + yd * 0.22;
      if (score > worstScore) { worstScore = score; worst = f; }
    }
    const thr = 0.12 + crouch * 0.03;
    const other = busy >= 0 ? P.f[busy] : null;
    const free = !other || (other.t / other.dur > 0.55 && worstScore > thr * 2);
    if (P.on && worst >= 0 && worstScore > thr && free) {
      const F = P.f[worst];
      F.t = 0; F.dur = 0.26 + crouch * 0.08; F.sx = F.x; F.sz = F.z; F.syaw = F.yaw; F.h0 = 0;
    }
    // Schritte fortschreiben, Füße setzen (Gewicht je Fuß: beim Anlaufen löst sich erst das Schwungbein)
    let shift = 0;
    for (let f = 0; f < 2; f++) {
      const F = P.f[f], w = F.w;
      let lift = 0;
      if (F.t >= 0) {
        F.t += dt;
        const k = Math.min(1, F.t / F.dur), e = smooth(k);
        // Ziel: Grundstellung in der Welt (folgt dem Körper weiter, falls er sich noch dreht)
        const tx = NX[f] * c + NZ[f] * sn + rx, tz = -NX[f] * sn + NZ[f] * c + rz;
        const tyaw = by + (f === 0 ? 0.08 : -0.08);
        F.x = F.sx + (tx - F.sx) * e;
        F.z = F.sz + (tz - F.sz) * e;
        F.yaw = F.syaw + wrap(tyaw - F.syaw) * e;
        lift = F.h0 * (1 - e) + Math.sin(Math.PI * k) * (0.035 + 0.025 * (1 - crouch * 0.5));
        if (k >= 1) F.t = -1;
      }
      const dx = F.x - rx, dz = F.z - rz;
      const mx = dx * c - dz * sn, mz = dx * sn + dz * c;
      const m = feet[f];
      const y = (gOff ? gOff[f] : 0) + lift;
      m.set(m.x + (mx - m.x) * w, m.y + (y - m.y) * w, m.z + (mz - m.z) * w);
      // Lösen beim Anlaufen: der Fuß hebt im Bogen ab (erster Schritt), statt am Boden zur Zyklus-Lage zu rutschen
      if (!P.on && w > 0 && w < 1) m.y += Math.sin(Math.PI * (1 - w)) * 0.05;
      fy[f] += wrap(F.yaw - by - fy[f]) * w;
      shift += (mx - NX[f]) * 0.5 * w;
    }
    // Becken folgt den Füßen ein Stück (Gewicht zwischen den Füßen)
    this.plantShift = clamp(shift * 0.35, -0.05, 0.05);
  }
}

export { POSES };
