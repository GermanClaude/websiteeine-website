// NULLPUNKT — Fahrzeugsimulation (GROSSKAMPF_PLAN §6.3): eigener Starrkörper ohne Physik-Bibliothek.
//
// • Fester 60-Hz-Schritt mit Akkumulator und Interpolation (stabil bei niedriger Bildrate, ≤ 5 Teilschritte je Bild).
// • Federstrahl je Rad (Räder) bzw. je Laufrolle (Ketten, 2 × 5) gegen die Kollisionsgeometrie der Welt
//   (`physics.collisionRay` → Kollisions-BVH / Octree; zusätzlich `world.heightAt` für Gelände-Karten).
// • Längs-/Querreibung mit Reibungskreis, Schlupfbegrenzung, Handbremse (Räder), Differentiallenkung mit
//   Gier-Regler und reduzierter Seitenführung beim Drehen (Ketten, auch auf der Stelle).
// • Wannen-Stichproben (Ecken + Kantenmitten) gegen die Welt: Eindringen auflösen, Aufprallgeschwindigkeit melden.
// • Schlafzustand für stehende, unbesetzte Fahrzeuge (kostet dann nichts).
import * as THREE from 'three';
import { collisionRay } from '../engine/physics.js';
import { mountY, staticComp, VEHICLE_GRAVITY } from './data.js';
import { Drivetrain } from './drivetrain.js';

export const STEP = 1 / 60;
export const GRAVITY = VEHICLE_GRAVITY;
const MAX_STEPS = 5;

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _hit = { distance: 0, nx: 0, ny: 1, nz: 0 };
const _n = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _r = new THREE.Vector3();
const _vc = new THREE.Vector3(), _F = new THREE.Vector3(), _T = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3(), _app = new THREE.Vector3(), _iq = new THREE.Quaternion(), _q = new THREE.Quaternion();
const _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Strahl gegen die Kollisionsgeometrie (+ Gelände-Höhenfeld, falls vorhanden). Liefert out oder null.
 * out = { distance, nx, ny, nz } (Normale zur Strahlquelle gedreht).
 */
export function groundRay(world, origin, dir, maxDist, out = {}) {
  let res = world ? collisionRay(world, origin, dir, maxDist, out) : null;
  if (world && typeof world.heightAt === 'function' && dir.y < -0.5) {
    // Höhenfeld: Schnitt entlang des Strahls per Sekantenverfahren (auch schräge Federstrahlen am steilen Hang;
    // die senkrechte Schätzung allein schießt dort über maxDist hinaus und das Rad verlöre den Boden)
    const f = (t) => { const hh = world.heightAt(origin.x + dir.x * t, origin.z + dir.z * t); return Number.isFinite(hh) ? origin.y + dir.y * t - hh : NaN; };
    let ta = 0, fa = f(0);
    if (Number.isFinite(fa) && fa >= 0) {
      let tb = fa / -dir.y, fb = f(tb);
      for (let k = 0; k < 4 && Number.isFinite(fb) && Math.abs(fb) > 1e-4 && fb !== fa; k++) {
        const tc = tb - fb * (tb - ta) / (fb - fa);
        ta = tb; fa = fb; tb = tc; fb = f(tc);
      }
      const t = tb;
      if (Number.isFinite(t) && t >= 0 && t <= maxDist && (!res || t < res.distance)) {
        const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
        out.distance = t;
        if (typeof world.normalAt === 'function') { world.normalAt(x, z, _tmp2); out.nx = _tmp2.x; out.ny = _tmp2.y; out.nz = _tmp2.z; }
        else { out.nx = 0; out.ny = 1; out.nz = 0; }
        res = out;
      }
    }
  }
  return res;
}

export class VehicleBody {
  constructor(def) {
    this.def = def;
    this.mass = def.mass;
    const hb = def.hullBox;
    const sx = hb[3] * 2, sy = hb[4] * 2, sz = hb[5] * 2, m = def.mass;
    // Quader-Trägheit, etwas erhöht (Stabilität, schwere Anbauteile außen)
    this.inertia = new THREE.Vector3(m / 12 * (sy * sy + sz * sz), m / 12 * (sx * sx + sz * sz), m / 12 * (sx * sx + sy * sy)).multiplyScalar(1.35);
    this.com = new THREE.Vector3().fromArray(def.com);
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.renderPos = new THREE.Vector3();
    this.renderQuat = new THREE.Quaternion();
    // Steuerung (vehicle.js aus der Fahrer-Absicht): throttle 'auto' −1 … 1 bzw. 'hold' 0 … 1 (Vollgas-Anteil)
    this.controls = { throttle: 0, steer: 0, brake: 0, handbrake: false, gearbox: 'auto' };
    // Fahrleistung aus Schäden (vehicle.js): Motormoment-Faktor, höchster Gang, Abregeldrehzahl (Notlauf)
    this.mods = { torque: 1, maxGear: 5, immobile: false, turnMult: 1, cutRpm: null };
    this.acc = 0;
    this.sleeping = false;
    this._still = 0;
    this.speed = 0;        // vorwärts (m/s, negativ = rückwärts)
    this.grounded = 0;     // Anteil Räder mit Bodenkontakt
    this.impact = 0;       // größte Aufprallgeschwindigkeit seit dem letzten Abholen (Schaden/Klang)
    this.impactNormal = new THREE.Vector3();
    this.upsideDown = 0;   // Sekunden auf dem Dach/Seite
    this.trackSpeed = [0, 0]; // Ketten links/rechts (m/s, für Texturlauf und Klang)
    this.slip = 0;         // Querrutschen (Reifenquietschen/Staub)
    this.drivetrain = new Drivetrain(def); // Triebwerk/Getriebe (drivetrain.js)
    this.drive = this.drivetrain.state;    // Gang, Drehzahl, Last … (HUD, Klang, Netz); body.rpm = drive.rpmNorm
    this.surface = 'default'; // Oberfläche unter der Wanne (Reibwert, Rollwiderstand), ≤ 4× je Sekunde abgefragt
    this._surfT = 0;
    this._aLong = 0;       // Längsbeschleunigung des letzten Schritts (Drehmassen)

    const w = def.wheels, my = mountY(def);
    this.suspLen = w.rest + w.radius;
    this.wheels = [];
    const tracked = def.drive === 'tracked';
    this.tracked = tracked;
    for (const side of [-1, 1]) {
      w.z.forEach((z, i) => {
        this.wheels.push({
          local: new THREE.Vector3(w.x * side, my, z), side, axle: i,
          steer: !tracked && !!(w.steer && w.steer[i]), drive: tracked || !!(w.drive ? w.drive[i] : true),
          rear: !tracked && z > 0,
          comp: 0, prevComp: 0, contact: false, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0),
          spin: 0, steerAngle: 0, load: 0, surface: null,
        });
      });
    }
    // Wannen-Stichproben (lokal): 8 Ecken (unten/oben) + Kantenmitten vorn/hinten/seitlich (Mitte)
    const cx = hb[0], cy = hb[1], cz = hb[2], hx = hb[3], hy = hb[4], hz = hb[5];
    const yl = cy - hy * 0.45, yh = cy + hy * 0.7;
    this.samples = [];
    for (const y of [yl, yh]) {
      for (const sx2 of [-1, 1]) for (const sz2 of [-1, 1]) this.samples.push(new THREE.Vector3(cx + hx * sx2, y, cz + hz * sz2));
      this.samples.push(new THREE.Vector3(cx, y, cz - hz), new THREE.Vector3(cx, y, cz + hz));
    }
    this.samples.push(new THREE.Vector3(cx - hx, cy, cz), new THREE.Vector3(cx + hx, cy, cz));
    this.floorSamples = [];
    for (const sx2 of [-1, 1]) for (const sz2 of [-1, 1]) this.floorSamples.push(new THREE.Vector3(cx + hx * 0.85 * sx2, cy - hy, cz + hz * 0.85 * sz2));
    this.floorSamples.push(new THREE.Vector3(cx, cy - hy, cz));
  }

  /** Ursprung (Boden unter der Wannenmitte) an pos, Gier yaw; Bewegung null. */
  setPose(origin, yaw = 0) {
    this.quat.setFromAxisAngle(UP, yaw);
    this.pos.copy(this.com).applyQuaternion(this.quat).add(origin);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    this.renderPos.copy(this.pos); this.renderQuat.copy(this.quat);
    const c0 = staticComp(this.def);
    for (const w of this.wheels) { w.comp = w.prevComp = c0; w.contact = false; }
    this.acc = 0;
    this.wake();
  }

  wake() { this.sleeping = false; this._still = 0; }

  /** Alter Name (0 … ~1,06, Klang/Netz): normierte Motordrehzahl. */
  get rpm() { return this.drive.rpmNorm; }
  set rpm(v) { /* nur lesen – Drehzahl schreibt das Triebwerk (bzw. auf Abbildern das Netz in drive.*) */ }

  /** Lokaler Punkt → Welt (aktueller Simulationszustand). */
  toWorld(local, out) { return out.copy(local).sub(this.com).applyQuaternion(this.quat).add(this.pos); }
  /** Lokaler Punkt → Welt (interpolierte Darstellung). */
  toWorldRender(local, out) { return out.copy(local).sub(this.com).applyQuaternion(this.renderQuat).add(this.renderPos); }
  /** Welt → Lokal (aktueller Zustand). */
  toLocal(world, out) { _iq.copy(this.quat).invert(); return out.copy(world).sub(this.pos).applyQuaternion(_iq).add(this.com); }
  /** Ursprung (Boden-Bezugspunkt) in Weltkoordinaten. */
  origin(out) { return out.copy(this.com).negate().applyQuaternion(this.quat).add(this.pos); }
  forward(out) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out) { return out.set(1, 0, 0).applyQuaternion(this.quat); }
  /** Gierwinkel der Wanne (Konvention wie Spieler: vorwärts = (−sin, 0, −cos)). */
  yaw() { const f = this.forward(_tmp); return Math.atan2(-f.x, -f.z); }
  /** Geschwindigkeit eines Weltpunkts am Körper. */
  pointVelocity(p, out) { _r.copy(p).sub(this.pos); return out.crossVectors(this.angVel, _r).add(this.vel); }

  /** Kraftstoß J (Welt, N·s) am Punkt p. */
  applyImpulse(p, J) {
    this.vel.addScaledVector(J, 1 / this.mass);
    _r.copy(p).sub(this.pos).cross(J);
    this._applyAngular(_r, 1);
    this.wake();
  }

  _applyAngular(torqueOrMomentWorld, scale) {
    // ω += R · I⁻¹ · Rᵀ · τ · scale
    _iq.copy(this.quat).invert();
    _tmp.copy(torqueOrMomentWorld).applyQuaternion(_iq);
    _tmp.set(_tmp.x / this.inertia.x, _tmp.y / this.inertia.y, _tmp.z / this.inertia.z).applyQuaternion(this.quat);
    this.angVel.addScaledVector(_tmp, scale);
  }

  /**
   * Bild-Update: feste Schritte + Interpolation. others: weitere Körper (nur zum Aufwecken genutzt).
   * @returns {number} Anzahl Schritte
   */
  update(dt, world) {
    const c = this.controls, D = this.drive;
    if (Math.abs(c.throttle) > 0.01 || Math.abs(c.steer) > 0.01 || D.gear !== 0 || D.targetGear !== 0) this.wake();
    if (this.sleeping) { this.renderPos.copy(this.pos); this.renderQuat.copy(this.quat); return 0; }
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS);
    let n = 0;
    while (this.acc >= STEP) {
      this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
      this.step(STEP, world);
      this.acc -= STEP;
      n++;
    }
    const a = this.acc / STEP;
    this.renderPos.lerpVectors(this.prevPos, this.pos, a);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.quat, a);
    // Schlaf: steht in N, keine Eingabe (im eingelegten Gang hält der Regler das Fahrzeug wach)
    const still = this.grounded > 0.5 && this.vel.lengthSq() < 0.0025 && this.angVel.lengthSq() < 0.0025
      && Math.abs(c.throttle) < 0.01 && Math.abs(c.steer) < 0.01 && D.gear === 0 && D.targetGear === 0;
    this._still = still ? this._still + dt : 0;
    if (this._still > 1.2) { this.sleeping = true; this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.renderPos.copy(this.pos); this.renderQuat.copy(this.quat); }
    return n;
  }

  step(h, world) {
    const def = this.def, m = this.mass, W = def.wheels, E = def.engine, grip = def.grip;
    const c = this.controls, mods = this.mods;
    const up = this.up(_up), fwd = this.forward(_fw), right = this.right(_rt);
    _F.set(0, -GRAVITY * m, 0);
    _T.set(0, 0, 0);

    // --- Federstrahlen
    _d.copy(up).negate();
    let contacts = 0;
    for (const w of this.wheels) {
      this.toWorld(w.local, _o);
      w.prevComp = w.comp;
      const hit = groundRay(world, _o, _d, this.suspLen, _hit);
      if (hit) {
        w.contact = true;
        w.comp = this.suspLen - hit.distance;
        w.point.copy(_o).addScaledVector(_d, hit.distance);
        w.normal.set(hit.nx, hit.ny, hit.nz);
        if (w.normal.dot(up) < 0) w.normal.negate();
        contacts++;
      } else {
        w.contact = false;
        w.comp = 0;
      }
    }
    this.grounded = contacts / this.wheels.length;
    const vF = this.vel.dot(fwd);
    this.speed = vF;

    // --- Federkräfte und Radlasten (Antrieb verteilt sich nach Last – die Kette koppelt alle Laufrollen)
    let loadSum = 0, driveLoad = 0;
    for (const w of this.wheels) {
      if (!w.contact) { w.load = 0; w.Fs = 0; continue; }
      const cvel = clamp((w.comp - w.prevComp) / h, -6, 6);
      let Fs = W.stiffness * w.comp + W.damping * cvel;
      if (w.comp > W.rest * 0.92) Fs += W.stiffness * 6 * (w.comp - W.rest * 0.92); // Anschlag
      Fs = clamp(Fs, 0, m * GRAVITY * 3);
      w.Fs = Fs;
      w.load = Fs * Math.max(0, w.normal.dot(up));
      loadSum += w.load;
      if (w.drive) driveLoad += w.load;
    }

    // --- Oberfläche (zwischengespeichert) → Reibwert längs, Rollwiderstand
    this._surfT -= h;
    if (this._surfT <= 0) {
      this._surfT = 0.25;
      let sf = null;
      if (world && typeof world.surfaceAt === 'function') { try { sf = world.surfaceAt(this.origin(_tmp2)); } catch { sf = null; } }
      this.surface = sf || 'default';
    }
    const surf = this.surface;
    const trac = E.traction ? (E.traction[surf] ?? E.traction.default ?? 1) : 1;
    const crr = E.rollRes ? (E.rollRes[surf] ?? E.rollRes.default ?? 0.03) : 0.03;
    const muLong = this.tracked ? trac : (grip.long || 1) * trac;

    // --- Triebwerk: Zugkraft am Triebrad (Reibungsgrenze je Rad unten), Bremse
    const out = this.drivetrain.step(h, vF, c, mods, surf);
    const driveTotal = contacts ? out.force : 0;
    let brake = clamp(Math.max(c.brake || 0, out.brake || 0), 0, 1);
    if (mods.immobile) brake = Math.max(brake, 0.6);
    const mEff = m / Math.max(1, contacts);
    const steerIn = clamp(c.steer, -1, 1);
    const steerA = this.tracked ? 0 : steerIn * (W.maxSteer || 0.5) / (1 + Math.abs(vF) / 9);
    const turning = this.tracked && Math.abs(steerIn) > 0.1;
    let slip = 0, tSlip = 0;

    for (const w of this.wheels) {
      w.steerAngle = w.steer ? steerA : 0;
      if (!w.contact) continue;
      const N = w.load;
      _tmp.copy(w.normal).multiplyScalar(w.Fs);
      _F.add(_tmp);
      _r.copy(w.point).sub(this.pos);
      _T.add(_tmp2.crossVectors(_r, _tmp));

      // Reibung im Radsystem
      this.pointVelocity(w.point, _vc);
      if (w.steerAngle) _f.copy(fwd).multiplyScalar(Math.cos(w.steerAngle)).addScaledVector(right, Math.sin(w.steerAngle));
      else _f.copy(fwd);
      _f.addScaledVector(w.normal, -_f.dot(w.normal)).normalize();
      _s.crossVectors(_f, w.normal).normalize();
      const vLong = _vc.dot(_f), vLat = _vc.dot(_s);
      let latGrip = grip.lat;
      if (turning) latGrip = grip.latTurning;
      if (c.handbrake && w.rear) latGrip = grip.handbrakeLat ?? latGrip * 0.4;
      const latMax = latGrip * N, longMax = muLong * N;
      let Flat = clamp(-vLat * mEff / h * 0.55, -latMax * 1.6, latMax * 1.6);
      let Flong = w.drive && driveLoad > 0 ? driveTotal * (N / driveLoad) : 0;
      const Fdrive = Flong;
      // Bremse / Handbremse (geschwindigkeitsbegrenzt: hält im Stand, kehrt nicht um)
      let bk = brake;
      if (c.handbrake && (w.rear || this.tracked)) bk = 1;
      if (bk > 0) Flong += -Math.sign(vLong) * Math.min(E.brake / this.wheels.length * bk, Math.abs(vLong) * mEff / h);
      // Rollwiderstand (weich um den Stillstand)
      Flong -= clamp(vLong / 0.25, -1, 1) * crr * N;
      // Reibungskreis
      const k = Math.hypot(Flat / Math.max(1, latMax), Flong / Math.max(1, longMax));
      if (k > 1) { Flat /= k; Flong /= k; slip = Math.max(slip, Math.min(1, k - 1)); }
      if (Fdrive) tSlip = Math.max(tSlip, clamp(Math.abs(Fdrive) / Math.max(1, longMax) - 1, 0, 1), k > 1 ? Math.min(1, k - 1) : 0);
      slip = Math.max(slip, Math.min(1, Math.abs(vLat) / 6));
      _tmp.copy(_f).multiplyScalar(Flong).addScaledVector(_s, Flat);
      // Angriffspunkt Richtung Schwerpunkthöhe angehoben (weniger Wanken)
      _app.copy(w.point).addScaledVector(up, _r.copy(this.pos).sub(w.point).dot(up) * (1 - grip.rollInfluence));
      _F.add(_tmp);
      _r.copy(_app).sub(this.pos);
      _T.add(_tmp2.crossVectors(_r, _tmp));
      w.spin += (vLong / W.radius) * h;
    }
    this.slip = slip;
    const D = this.drive;
    D.slip += (tSlip - D.slip) * Math.min(1, h / 0.15);

    // --- Luftwiderstand (entlang der Fahrt)
    const sp = this.vel.length();
    if (sp > 0.01 && E.airRes) _F.addScaledVector(this.vel, -E.airRes * sp);

    // --- Drehmassen (Motor, Getriebe, Ketten): wirken wie zusätzliche Masse in Fahrtrichtung
    const lam = (E.rotInertia || 1) - 1;
    // (Rückkopplung über den vorigen Schritt: a = (F − λ'·m·a) / m → F / (m·(1 + λ')); stabil, da λ' < 1)
    if (contacts && lam > 0) _F.addScaledVector(fwd, -lam * m * this._aLong);
    this._aLong = contacts ? clamp(_F.dot(fwd) / m, -20, 20) : 0;

    // --- Ketten: Gier-Regler (Differentiallenkung, auch auf der Stelle = Neutrallenkung in N)
    if (this.tracked) {
      const gdir = Math.sign(D.shifting ? D.targetGear : D.gear);
      const rev = vF < -0.5 || (gdir < 0 && vF < 0.5) || (c.throttle < -0.1 && vF < 0.5);
      const av = Math.abs(vF);
      const rate = (av < 2 ? E.turnRate : Math.min(E.turnRateMoving, (E.latAccMax || 99) / av)) * mods.turnMult * (mods.immobile ? 0 : 1);
      const target = -steerIn * rate * (rev ? -1 : 1);
      const wy = this.angVel.dot(up);
      if (contacts) {
        const tq = (target - wy) * this.inertia.y * 22 * this.grounded; // straff: Seitenführung der Ketten bremst die Drehung
        _T.addScaledVector(up, tq);
      }
      // Kettenlauf für Darstellung/Klang (Durchdrehen sichtbar)
      const diff = (target) * (W.x || 1.4);
      const spin = D.slip * Math.sign(driveTotal) * 2.5;
      this.trackSpeed[0] = vF - diff + spin; // links
      this.trackSpeed[1] = vF + diff + spin; // rechts
    } else {
      this.trackSpeed[0] = this.trackSpeed[1] = vF;
    }

    // --- Integration (semi-implizit)
    this.vel.addScaledVector(_F, h / m);
    this._applyAngular(_T, h);
    const damp = def.angularDamp * (contacts ? 1 : 0.25);
    this.angVel.multiplyScalar(1 / (1 + damp * h));
    // Selbstaufrichtung in der Luft/auf der Seite (sanft)
    const tilt = up.dot(UP);
    if (tilt < 0.6) {
      _tmp.crossVectors(up, UP).multiplyScalar((0.6 - tilt) * 2.2 * h);
      this.angVel.add(_tmp);
    }
    this.pos.addScaledVector(this.vel, h);
    const wx = this.angVel.x, wy2 = this.angVel.y, wz = this.angVel.z;
    _q.set(wx * h * 0.5, wy2 * h * 0.5, wz * h * 0.5, 0).multiply(this.quat);
    this.quat.x += _q.x; this.quat.y += _q.y; this.quat.z += _q.z; this.quat.w += _q.w;
    this.quat.normalize();

    // --- Wanne gegen Welt
    this._collideHull(world);
    this.upsideDown = tilt < 0.25 ? this.upsideDown + h : 0;
  }

  _collideHull(world) {
    const hb = this.def.hullBox;
    for (const s of this.samples) {
      this.toWorld(s, _tmp);
      _o.set(hb[0], s.y, hb[2]);
      this.toWorld(_o, _o);
      _d.copy(_tmp).sub(_o);
      const len = _d.length();
      if (len < 1e-3) continue;
      _d.multiplyScalar(1 / len);
      const hit = collisionRay(world, _o, _d, len, _hit);
      if (!hit) continue;
      const depth = len - hit.distance;
      _n.set(hit.nx, hit.ny, hit.nz);
      if (_n.dot(_d) > 0) _n.negate();
      this.pos.addScaledVector(_n, depth * 0.6);
      this._contactResponse(_n);
    }
    // Boden unter der Wanne (Aufsetzen, Kanten): von oben nach unten prüfen
    const up = this.up(_up);
    _d.copy(up).negate();
    for (const s of this.floorSamples) {
      _tmp.copy(s); _tmp.y += 1.0;
      this.toWorld(_tmp, _o);
      const hit = groundRay(world, _o, _d, 1.0, _hit);
      if (!hit) continue;
      const depth = 1.0 - hit.distance;
      _n.set(hit.nx, hit.ny, hit.nz);
      if (_n.dot(up) < 0) _n.negate();
      this.pos.addScaledVector(_n, depth * 0.5);
      this._contactResponse(_n, 0.1);
    }
  }

  _contactResponse(n, bounce = 0.15) {
    const vn = this.vel.dot(n);
    if (vn < 0) {
      this.vel.addScaledVector(n, -vn * (1 + bounce));
      // Seitenreibung am Hindernis
      _tmp.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
      this.vel.addScaledVector(_tmp, -0.15);
      this.angVel.multiplyScalar(0.92);
      if (-vn > this.impact) { this.impact = -vn; this.impactNormal.copy(n); }
    }
  }

  /** Aufprall seit dem letzten Aufruf (m/s) – setzt zurück. */
  takeImpact() { const v = this.impact; this.impact = 0; return v; }

  /** Umgekippt: aufrichten (Gier behalten, 1,2 m anheben). */
  rightUp() {
    const yaw = this.yaw();
    const o = this.origin(new THREE.Vector3());
    o.y += 1.2;
    this.setPose(o, yaw);
  }
}
