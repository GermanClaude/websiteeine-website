// NULLPUNKT — Fahrzeugkameras (GROSSKAMPF_PLAN §6.5, panzer-mp.md §B.3): mehrere Sichten je Sitz (1P-Anker im
// Wannen-/Turm-/Rohr-/Kuppel-/MG-Raum, Winkelspiegel, Optiken mit Vergrößerungsstufen) und die Außenansicht 'aussen'
// (Verfolger mit Federarm und Kollisionsstrahlen). Die Hauptkamera bleibt G.camera (= Spielerkamera) → der
// Objektiv-Nachbearbeitungsstapel (renderer.lens) wirkt unverändert; HUD-Projektionen laufen über lens.toScreen.
//
// Blickzustand je Sitz (seat.look), Art aus der Sicht (view.look):
//   'mount'     yaw/pitch = gewünschte Zielrichtung in Welt (Lafette folgt mit Richtgeschwindigkeit)
//   'rel'       relYaw/relPitch relativ zur Wanne (Fahrer, Mitfahrer)
//   'relTurret' relYaw/relPitch relativ zum Turm (Ladeschütze)
// Welche Sicht gilt, entscheidet VehicleSystem (seat.view, erlaubte Sichten); update() bekommt die wirksame Sicht.
import * as THREE from 'three';
import { collisionRay, keepClear } from '../engine/physics.js';
import { dirFromYawPitch, viewOf, viewAnchor, viewLookDir, viewZoom, isTp, viewsOf, firstFp } from './views.js';

export { dirFromYawPitch };

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const _piv = new THREE.Vector3(), _t = new THREE.Vector3(), _hit = {};
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _o = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
// walls: Federarm – Strahlenbündel (Mitte + 4 Versätze ≈ Kamerakugel), Polster zur Wand, Mindestabstand der Nahebene
const ARM_RAYS = [[0, 0], [0.32, 0], [-0.32, 0], [0, 0.24], [0, -0.24]];
const ARM_PAD = 0.35, CAM_CLEAR = 0.2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class VehicleCamera {
  constructor(sys = null) {
    this.sys = sys;            // VehicleSystem (Setter mode → Sicht des Spielersitzes)
    this.pos = new THREE.Vector3();
    this.ready = false;
    this.zoom = 1;
    this.sight = false;        // aktuell 1P (Optik/Sitz)
    this.view = null;          // wirksame Sicht des letzten Bildes
    this.dir = new THREE.Vector3(0, 0, -1); // Blickrichtung der Kamera (Welt)
    this._mode = 'tp';
  }

  /** Verträglichkeit (dev/vehicles.js): 'fp' → erste 1P-Sicht des Sitzes, 'tp' → Außenansicht (falls erlaubt). */
  get mode() {
    const p = this.sys && this.sys.G && this.sys.G.player;
    const seat = p && p.vehicleSeat;
    return seat ? (isTp(viewOf(seat)) ? 'tp' : 'fp') : this._mode;
  }
  set mode(m) {
    this._mode = m === 'fp' ? 'fp' : 'tp';
    const sys = this.sys, p = sys && sys.G && sys.G.player;
    const seat = p && p.vehicleSeat;
    if (!seat || typeof sys.setSeatView !== 'function') return;
    const list = viewsOf(seat.def);
    const allowed = sys.allowedViews ? sys.allowedViews(seat) : list.map((_, i) => i);
    let idx = this._mode === 'tp' ? list.findIndex((v) => isTp(v)) : firstFp(seat.def);
    if (!allowed.includes(idx)) idx = allowed[0] ?? 0;
    sys.setSeatView(p, idx);
  }

  reset() { this.ready = false; this.zoom = 1; this.arm = 0; }

  /** Weltrichtung des Blicks eines Sitzes (aktuelle bzw. angegebene Sicht). */
  lookDir(vehicle, seat, out, view = null) { return viewLookDir(vehicle, seat, view || viewOf(seat), out); }

  /**
   * Kamera setzen. baseFov = vertikales Grund-FOV (Grad); view = wirksame Sicht (sonst seat.view).
   * Rückgabe: { sight, zoom, view }.
   */
  update(camera, vehicle, seat, dt, world, baseFov = 70, view = null) {
    view = view || viewOf(seat);
    const tp = view.tp;
    const wantZoom = viewZoom(view, seat.zoomIndex || 0);
    const switched = this.view !== view;
    this.view = view;
    this.sight = !tp;
    const k = 1 - Math.exp(-dt * 14);
    // Sichtwechsel: Vergrößerung springt (Optik → Außen sonst langsames Herauszoomen)
    if (switched) this.zoom = wantZoom;
    this.zoom += (wantZoom - this.zoom) * (Math.abs(wantZoom - this.zoom) < 0.01 ? 1 : 1 - Math.exp(-dt * 18));
    const dir = this.lookDir(vehicle, seat, this.dir, view);
    if (this.sight) {
      viewAnchor(vehicle, view, _p, null);
      this.pos.copy(_p);
      this.ready = true;
    } else {
      // Verfolger: Drehpunkt über der Wanne, Arm entgegen der Blickrichtung
      vehicle.body.toWorldRender(_t.set(0, tp.pivot, 0), _piv);
      let d = dir;
      if (view.look !== 'mount') {
        // freie Sitze: Kamera schaut leicht abwärts über das Fahrzeug
        _d.copy(dir); _d.y -= 0.22; d = _d.normalize();
      }
      const dist = tp.dist;
      _p.copy(_piv).addScaledVector(d, -dist);
      _p.y += tp.height - tp.pivot;
      if (switched) this.ready = false;
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
    _t.copy(this.pos).add(_d.copy(this.sight || view.look === 'mount' ? dir : _d.copy(dir).setY(dir.y - 0.08).normalize()));
    camera.up.set(0, 1, 0);
    camera.lookAt(_t);
    const fov = clamp((2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / this.zoom) * 180) / Math.PI, 3, 120);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    void _q;
    return { sight: this.sight, zoom: this.zoom, view };
  }
}
