// NULLPUNKT — Fahrzeugkameras (GROSSKAMPF_PLAN §6.5): 1P (Optik/Sitz) und 3P (Verfolger mit Federarm und
// Kollisionsstrahlen). Die Hauptkamera bleibt G.camera (= Spielerkamera) → der Objektiv-Nachbearbeitungsstapel
// (renderer.lens) wirkt unverändert; HUD-Projektionen laufen über lens.toScreen.
//
// Blickzustand je Sitz (seat.look):
//   Lafetten-Sitze (gun/cmg/mg): yaw/pitch = gewünschte Zielrichtung in Welt (Turm folgt mit Richtgeschwindigkeit)
//   freie Sitze (Fahrer Geländewagen, Mitfahrer): relYaw/relPitch relativ zur Wanne
import * as THREE from 'three';
import { collisionRay, keepClear } from '../engine/physics.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _piv = new THREE.Vector3(), _t = new THREE.Vector3(), _hit = {};
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _o = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
// walls: Federarm – Strahlenbündel (Mitte + 4 Versätze ≈ Kamerakugel), Polster zur Wand, Mindestabstand der Nahebene
const ARM_RAYS = [[0, 0], [0.32, 0], [-0.32, 0], [0, 0.24], [0, -0.24]];
const ARM_PAD = 0.35, CAM_CLEAR = 0.2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function dirFromYawPitch(yaw, pitch, out) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

export class VehicleCamera {
  constructor() {
    this.mode = 'tp';          // Spielerwahl 'fp' | 'tp' (Zielen schaltet immer in die Optik)
    this.pos = new THREE.Vector3();
    this.ready = false;
    this.zoom = 1;
    this.sight = false;        // aktuell in der Optik/1P
    this.dir = new THREE.Vector3(0, 0, -1); // Blickrichtung der Kamera (Welt)
  }

  reset() { this.ready = false; this.zoom = 1; this.arm = 0; }

  /** Weltrichtung des Blicks eines Sitzes. */
  lookDir(vehicle, seat, out) {
    const L = seat.look;
    if (seat.def.mount) return dirFromYawPitch(L.yaw, L.pitch, out);
    _e.set(L.relPitch, L.relYaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    return out.set(0, 0, -1).applyQuaternion(_q).applyQuaternion(vehicle.body.renderQuat);
  }

  /**
   * Kamera setzen. baseFov = vertikales Grund-FOV (Grad). Rückgabe: { sight, zoom }.
   */
  update(camera, vehicle, seat, dt, world, baseFov = 70) {
    const fp = seat.def.fp, tp = seat.def.tp;
    const zooms = fp.zoom || [1];
    const zi = Math.min(seat.zoomIndex || 0, zooms.length - 1);
    const wantZoom = zooms[zi] || 1;
    this.sight = this.mode === 'fp' || zi > 0;
    const k = 1 - Math.exp(-dt * 14);
    this.zoom += (wantZoom - this.zoom) * (Math.abs(wantZoom - this.zoom) < 0.01 ? 1 : 1 - Math.exp(-dt * 18));
    const dir = this.lookDir(vehicle, seat, this.dir);
    if (this.sight) {
      if (seat.def.mount) vehicle.sightPose(seat.index, _p, _q);
      else vehicle.body.toWorldRender(_t.fromArray(fp.pos), _p);
      this.pos.copy(_p);
      this.ready = true;
    } else {
      // Verfolger: Drehpunkt über der Wanne, Arm entgegen der Blickrichtung
      vehicle.body.toWorldRender(_t.set(0, tp.pivot, 0), _piv);
      let d = dir;
      if (!seat.def.mount) {
        // freie Sitze: Kamera schaut leicht abwärts über das Fahrzeug
        _d.copy(dir); _d.y -= 0.22; d = _d.normalize();
      }
      const dist = tp.dist;
      _p.copy(_piv).addScaledVector(d, -dist);
      _p.y += tp.height - tp.pivot;
      // Kollision (walls): Federarm vom Drehpunkt – kürzer sofort, länger mit Feder; nach dem Nachführen nochmals
      // begrenzen (der geglättete Weg darf nicht durch eine Ecke schneiden), danach Mindestabstand zur Geometrie
      _t.copy(_p).sub(_piv);
      const len = _t.length();
      let arm = len;
      if (len > 1e-3 && world) {
        _t.multiplyScalar(1 / len);
        _r.crossVectors(_t, UP);
        if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); else _r.normalize();
        _u.crossVectors(_r, _t);
        for (const [ox, oy] of ARM_RAYS) {
          _o.copy(_piv).addScaledVector(_r, ox).addScaledVector(_u, oy);
          const h = collisionRay(world, _o, _t, len + ARM_PAD, _hit);
          if (h) arm = Math.min(arm, Math.max(0.25, h.distance - ARM_PAD));
        }
      }
      this.arm = !this.ready || !(this.arm > 0) || arm < this.arm ? arm : this.arm + (arm - this.arm) * (1 - Math.exp(-dt * 3));
      if (len > 1e-3) _p.copy(_piv).addScaledVector(_t, Math.min(this.arm, len));
      if (!this.ready) { this.pos.copy(_p); this.ready = true; }
      else this.pos.lerp(_p, k);
      // Nie unter den Boden
      if (world && typeof world.groundHeight === 'function') {
        const g = world.groundHeight(this.pos.x, this.pos.z, this.pos.y + 1.5);
        if (g != null && this.pos.y < g + 0.4) this.pos.y = g + 0.4;
      }
      if (world) {
        _t.copy(this.pos).sub(_piv);
        const l2 = _t.length();
        if (l2 > 1e-3) {
          _t.multiplyScalar(1 / l2);
          const h = collisionRay(world, _piv, _t, l2 + CAM_CLEAR, _hit);
          if (h && h.distance < l2 + CAM_CLEAR) this.pos.copy(_piv).addScaledVector(_t, Math.max(0.2, h.distance - CAM_CLEAR));
        }
        keepClear(world, this.pos, CAM_CLEAR);
      }
    }
    camera.position.copy(this.pos);
    _t.copy(this.pos).add(_d.copy(this.sight ? dir : (seat.def.mount ? dir : _d.copy(dir).setY(dir.y - 0.08).normalize())));
    camera.up.set(0, 1, 0);
    camera.lookAt(_t);
    const fov = clamp((2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / this.zoom) * 180) / Math.PI, 4, 120);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return { sight: this.sight, zoom: this.zoom };
  }
}
