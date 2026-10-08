// NULLPUNKT — CapsuleBody: Kollision gegen world.collider (Octree) für Spieler und Bots (§5).
//
// Modell „schwebende Kapsel“ (robust auf Dreieckssuppen):
//  - Die Kollisionskapsel beginnt stepHeight über den Füßen → sie berührt nur Wände/Decken.
//  - Boden wird per senkrechter Sonden (Mitte + Ring) gegen die lokal gesammelten Dreiecke gefunden:
//    Stufen/Bordsteine ≤ stepHeight werden dadurch automatisch erstiegen, Treppen abwärts haften,
//    Schrägen bis maxSlope sind begehbar (kein Abrutschen im Stand), steilere wirken als Wand.
//  - Im Fall fängt die Sonde Kanten bis stepHeight über den Füßen (leichtes „Hochziehen“ wie in COD).
//  - Unterschritte gegen Tunneln, eine Octree-Abfrage pro Unterschritt.
//  - stepOffset: vertikaler Versatz durch Stufen/Haftung im letzten step() (Kamera-Glättung).
// position = Füße. `capsule` = volle Körperkapsel (für andere Systeme), `collisionCapsule` = schwebend.
//
// Zusätzlich (Realismus-Plan F5/F6): collisionRay() – Strahl gegen die Kollisionsgeometrie (Lehnen, Kanten),
// probeLedge() – Kantensuche fürs Überklettern (0,5–1,3 m, auch dünne Hindernisse überspringen), canOccupy().
// walls: keepClear() – Mindestabstand eines Punktes (Kamera) zur Geometrie; Unterschritte bis 32 je step().

import { Vector3, Ray } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';

const _tris = [];
const _gather = new Capsule(new Vector3(), new Vector3(), 0.4);
const _probeCap = new Capsule(new Vector3(), new Vector3(), 0.3);
const _n = new Vector3();
const _push = new Vector3();
const _prev = new Vector3();
let _td = new Float64Array(64 * 12); // vorbereitete Bodendreiecke (xz-Baryzentrik)

// Sondenpunkte relativ zum Radius (Mitte zuerst)
const RING = [[0, 0]];
for (let i = 0; i < 8; i++) RING.push([Math.cos((i * Math.PI) / 4) * 0.72, Math.sin((i * Math.PI) / 4) * 0.72]);

export class CapsuleBody {
  constructor({ radius = 0.35, height = 1.8, crouchHeight = 1.15, maxSlope = 50, stepHeight = 0.45 } = {}) {
    this.radius = radius;
    this.standHeight = height;
    this.height = height;
    this.crouchHeight = crouchHeight;
    this.stepHeight = stepHeight;
    this.maxSlopeCos = Math.cos((maxSlope * Math.PI) / 180);

    this.position = new Vector3();
    this.velocity = new Vector3();
    this.onGround = false;
    this.groundNormal = new Vector3(0, 1, 0);
    /** Höhe des Bodens unter dem Körper (gültig wenn onGround). */
    this.groundY = 0;
    /** Vertikaler Versatz durch Stufen/Bodenhaftung im letzten step() (für Kamera-Glättung). */
    this.stepOffset = 0;
    /** true im Schritt, in dem der Körper gelandet ist; landSpeed = Fallgeschwindigkeit (m/s, positiv). */
    this.landed = false;
    this.landSpeed = 0;
    /** true, wenn der Körper unter world.bounds gefallen ist. */
    this.outOfWorld = false;
    /** Letzte Wandkontakt-Normale (horizontal) oder null. */
    this.wallNormal = null;
    /** Volle Körperkapsel (Füße → Kopf). */
    this.capsule = new Capsule(new Vector3(), new Vector3(), radius);
    /** Schwebende Kollisionskapsel (ab Stufenhöhe). */
    this.collisionCapsule = new Capsule(new Vector3(), new Vector3(), radius);
    this._wall = new Vector3();
    this._sync();
  }

  /** Abstand der Kollisionskapsel über den Füßen (bei kleiner Höhe reduziert). */
  _lift() {
    return Math.max(0.05, Math.min(this.stepHeight, this.height - this.radius * 2 - 0.02));
  }

  _sync() {
    const p = this.position;
    const r = this.radius;
    this.capsule.radius = r;
    this.capsule.start.set(p.x, p.y + r, p.z);
    this.capsule.end.set(p.x, p.y + Math.max(this.height - r, r + 0.01), p.z);
    const c = this.collisionCapsule;
    c.radius = r;
    const sy = p.y + this._lift() + r;
    c.start.set(p.x, sy, p.z);
    c.end.set(p.x, Math.max(p.y + this.height - r, sy + 0.001), p.z);
  }

  /** Kapselhöhe setzen (Ducken: Kopf senkt sich, Füße bleiben; Liegen bis 2r + 0,02 m). */
  setHeight(h) {
    this.height = Math.min(this.standHeight, Math.max(this.radius * 2 + 0.02, h));
    this._sync();
  }

  /** Ist über dem Kopf genug Platz, um auf `height` (Standard: Stehhöhe) zu wachsen? */
  canStand(world, height = this.standHeight) {
    const collider = world && world.collider;
    if (!collider || height <= this.height + 1e-3) return true;
    const r = this.radius * 0.9;
    const p = this.position;
    _probeCap.radius = r;
    _probeCap.start.set(p.x, p.y + Math.max(this.height - r, this._lift() + r), p.z);
    _probeCap.end.set(p.x, p.y + height - r, p.z);
    if (_probeCap.end.y <= _probeCap.start.y) return true;
    const hit = collider.capsuleIntersect(_probeCap);
    return !hit || hit.depth < 0.01;
  }

  teleport(pos) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    this.outOfWorld = false;
    this.landed = false;
    this.stepOffset = 0;
    this._sync();
  }

  /**
   * Integriert Geschwindigkeit + Schwerkraft und löst Kollisionen.
   * opts: { gravity = 24, stepHeight = this.stepHeight, snap = true }
   */
  step(dt, world, { gravity = 24, stepHeight = this.stepHeight, snap = true } = {}) {
    const collider = world && world.collider;
    const v = this.velocity;
    this.stepOffset = 0;
    this.wallNormal = null;
    this.landed = false;
    if (stepHeight !== this.stepHeight) { this.stepHeight = stepHeight; }
    if (!(dt > 0)) { this._sync(); return; }

    // Am Boden keine Schwerkraft (kein Rutschen auf Schrägen); Haftung übernimmt die Bodensonde.
    if (this.onGround && v.y <= 0) v.y = 0;
    else v.y -= gravity * dt;

    if (!collider) {
      this.position.addScaledVector(v, dt);
      if (this.position.y < 0) {
        if (!this.onGround) { this.landed = true; this.landSpeed = -v.y; }
        this.position.y = 0; v.y = Math.max(0, v.y); this.onGround = true;
      } else this.onGround = false;
      this._sync();
      return;
    }

    const fine = typeof collider.getCapsuleTriangles === 'function' && typeof collider.triangleCapsuleIntersect === 'function';
    if (!fine) { this._stepCoarse(dt, collider, world); return; }

    const hTravel = Math.hypot(v.x, v.z) * dt;
    const vTravel = Math.abs(v.y) * dt;
    // walls: Unterschritte ≤ halber Radius auch bei großem dt (Zeitlupe/Zeitraffer bis ×4, 10-FPS-Geräte, Hechtsprung)
    const steps = Math.min(32, Math.max(1, Math.ceil(Math.max(hTravel / (this.radius * 0.5), vTravel / 0.4))));
    const sdt = dt / steps;

    for (let i = 0; i < steps; i++) {
      const wasGround = this.onGround;
      const vyBefore = v.y;
      _prev.copy(this.position);
      this.position.addScaledVector(v, sdt);
      this._sync();

      // Sondenbereich: oben stepHeight über den Füßen (bzw. Fallweg), unten Haftung/Fall
      const fall = Math.max(0, _prev.y - this.position.y);
      const probeTop = this.position.y + Math.max(stepHeight, fall) + 0.02;
      const probeBot = this.position.y - (wasGround && snap && v.y <= 0 ? stepHeight : 0.02);
      this._gatherTris(collider, probeBot);

      this._resolve(collider, wasGround);

      if (v.y <= 0.001) {
        const gy = this._probeGround(probeBot, probeTop);
        if (gy !== null) {
          const rise = gy - this.position.y;
          this.position.y = gy;
          if (wasGround || rise > 0.03) this.stepOffset += rise;
          if (!wasGround) { this.landed = true; this.landSpeed = Math.max(0, -vyBefore); }
          if (v.y < 0) v.y = 0;
          this.onGround = true;
          this.groundY = gy;
          this._sync();
          if (Math.abs(rise) > 0.01) this._resolve(collider, true);
        } else {
          this.onGround = false;
        }
      } else {
        this.onGround = false;
      }
    }
    _tris.length = 0;

    if (world.bounds && this.position.y < world.bounds.min.y - 6) this.outOfWorld = true;
  }

  /**
   * walls 2: Nachschub nach äußeren Korrekturen (Kartengrenze o. ä. nach step()): Kapsel aus der Geometrie schieben
   * (gleiche Regeln wie im Unterschritt: Wände nur waagerecht). Ohne Dreiecks-Collider wirkungslos.
   */
  depenetrate(world) {
    const collider = world && world.collider;
    if (!collider || typeof collider.getCapsuleTriangles !== 'function' || typeof collider.triangleCapsuleIntersect !== 'function') return;
    this._gatherTris(collider, this.position.y - 0.02);
    this._resolve(collider, this.onGround);
    _tris.length = 0;
  }

  /** Sammelt einmal pro Unterschritt alle Dreiecke um Körper + Sondenbereich. */
  _gatherTris(collider, probeBot) {
    const p = this.position;
    const r = this.radius + 0.12;
    _gather.radius = r;
    _gather.start.set(p.x, Math.min(probeBot, p.y) - 0.05 + r, p.z);
    _gather.end.set(p.x, Math.max(p.y + this.height + 0.08 - r, _gather.start.y + 0.01), p.z);
    _tris.length = 0;
    collider.getCapsuleTriangles(_gather, _tris);
  }

  /** Schiebt die schwebende Kapsel aus Wänden/Decken (Dreiecke aus _gatherTris). */
  _resolve(collider, grounded) {
    const cap = this.collisionCapsule;
    for (let iter = 0; iter < 4; iter++) {
      let any = false;
      for (let i = 0; i < _tris.length; i++) {
        const hit = collider.triangleCapsuleIntersect(cap, _tris[i]);
        if (!hit || !(hit.depth > 1e-5)) continue;
        any = true;
        this._applyContact(hit.normal, Math.min(hit.depth, this.radius), grounded);
      }
      if (!any) break;
    }
  }

  _applyContact(normal, depth, grounded) {
    const v = this.velocity;
    _n.copy(normal);
    if (_n.y <= -0.45) {
      // Decke
      _push.copy(_n).multiplyScalar(depth);
      if (v.y > 0) v.y = 0;
    } else if (!grounded && _n.y >= this.maxSlopeCos) {
      // In der Luft auf begehbarer Fläche/Kante: entlang der Normalen gleiten (Sonde übernimmt die Landung)
      _push.copy(_n).multiplyScalar(depth + 1e-4);
      const vn = v.dot(_n);
      if (vn < 0) v.addScaledVector(_n, -vn);
    } else {
      // Wand (auch steile Schrägen): nur horizontal schieben → kein Hochklettern
      const hl = Math.hypot(_n.x, _n.z);
      if (hl < 0.08) {
        _push.set(0, _n.y > 0 ? depth : -depth, 0);
      } else {
        _n.set(_n.x / hl, 0, _n.z / hl);
        _push.copy(_n).multiplyScalar(Math.min(depth / hl, depth * 3) + 1e-4);
        const vn = v.x * _n.x + v.z * _n.z;
        if (vn < 0) { v.x -= _n.x * vn; v.z -= _n.z * vn; }
        this.wallNormal = this._wall.copy(_n);
      }
    }
    this.position.add(_push);
    this.capsule.translate(_push);
    this.collisionCapsule.translate(_push);
  }

  /**
   * Senkrechte Bodensonden gegen die gesammelten Dreiecke: höchster begehbarer Punkt in [bot, top].
   * Mitte hat Vorrang (präzise auf Schrägen/Treppen), der Ring trägt an Kanten.
   */
  _probeGround(bot, top) {
    const n = _tris.length;
    if (!n) return null;
    if (_td.length < n * 12) _td = new Float64Array(n * 16);
    const td = _td;
    let m = 0;
    const minNy = this.maxSlopeCos;
    for (let i = 0; i < n; i++) {
      const t = _tris[i];
      const ax = t.a.x, ay = t.a.y, az = t.a.z;
      const e1x = t.b.x - ax, e1y = t.b.y - ay, e1z = t.b.z - az;
      const e2x = t.c.x - ax, e2y = t.c.y - ay, e2z = t.c.z - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      const nyAbs = Math.abs(ny) / len;
      if (nyAbs < minNy) continue;
      const maxY = Math.max(ay, t.b.y, t.c.y), minY = Math.min(ay, t.b.y, t.c.y);
      if (maxY < bot || minY > top) continue;
      const det = e1x * e2z - e2x * e1z;
      if (Math.abs(det) < 1e-12) continue;
      const o = m * 12;
      td[o] = ax; td[o + 1] = ay; td[o + 2] = az; td[o + 3] = e1x; td[o + 4] = e1y; td[o + 5] = e1z;
      td[o + 6] = e2x; td[o + 7] = e2y; td[o + 8] = e2z; td[o + 9] = 1 / det; td[o + 10] = nyAbs; td[o + 11] = i;
      m++;
    }
    if (!m) return null;
    const p = this.position;
    const rr = this.radius;
    let best = null, bestNy = 1, center = null, centerNy = 1, centerTri = -1, bestTri = -1;
    for (let k = 0; k < RING.length; k++) {
      const x = p.x + RING[k][0] * rr, z = p.z + RING[k][1] * rr;
      let hy = -Infinity, hny = 1, ht = -1;
      for (let j = 0; j < m; j++) {
        const o = j * 12;
        const px = x - td[o], pz = z - td[o + 2];
        const inv = td[o + 9];
        const u = (px * td[o + 8] - td[o + 6] * pz) * inv;
        if (u < -1e-6 || u > 1 + 1e-6) continue;
        const w = (td[o + 3] * pz - px * td[o + 5]) * inv;
        if (w < -1e-6 || u + w > 1 + 1e-6) continue;
        const y = td[o + 1] + u * td[o + 4] + w * td[o + 7];
        if (y > top || y < bot) continue;
        if (y > hy) { hy = y; hny = td[o + 10]; ht = td[o + 11]; }
      }
      if (hy === -Infinity) continue;
      if (k === 0) { center = hy; centerNy = hny; centerTri = ht; break; }
      if (best === null || hy > best) { best = hy; bestNy = hny; bestTri = ht; }
    }
    const y = center !== null ? center : best;
    if (y === null) return null;
    const ti = center !== null ? centerTri : bestTri;
    const t = _tris[ti];
    if (t) {
      t.getNormal(this.groundNormal);
      if (this.groundNormal.y < 0) this.groundNormal.negate();
    } else this.groundNormal.set(0, center !== null ? centerNy : bestNy, 0).normalize();
    return y;
  }

  /** Rückfall für Collider ohne Dreieckszugriff (nur capsuleIntersect). */
  _stepCoarse(dt, collider, world) {
    const v = this.velocity;
    const wasGround = this.onGround;
    this.position.addScaledVector(v, dt);
    this._sync();
    this.onGround = false;
    for (let iter = 0; iter < 3; iter++) {
      const hit = collider.capsuleIntersect(this.capsule);
      if (!hit || hit.depth < 1e-5) break;
      _n.copy(hit.normal);
      if (_n.y >= this.maxSlopeCos) {
        this.onGround = true;
        this.groundNormal.copy(_n);
        _push.set(0, hit.depth / Math.max(_n.y, 0.3), 0);
        if (v.y < 0) v.y = 0;
      } else {
        _push.copy(_n).multiplyScalar(hit.depth);
        const vn = v.dot(_n);
        if (vn < 0) v.addScaledVector(_n, -vn);
      }
      this.position.add(_push);
      this._sync();
    }
    if (!wasGround && this.onGround) { this.landed = true; this.landSpeed = 0; }
    if (world.bounds && this.position.y < world.bounds.min.y - 6) this.outOfWorld = true;
  }
}

/**
 * Weiche Trennung lebender Akteure (Spieler/Bots laufen nicht ineinander, schieben sich sanft weg).
 * Rein horizontal, höchstens maxPush m pro Aufruf und Akteur; Wände löst der nächste step() auf.
 */
export function separateActors(actors, maxPush = 0.12) {
  const n = actors.length;
  for (let i = 0; i < n; i++) {
    const a = actors[i];
    if (!a || !a.alive || !a.body) continue;
    const pa = a.body.position;
    for (let j = i + 1; j < n; j++) {
      const b = actors[j];
      if (!b || !b.alive || !b.body) continue;
      const pb = b.body.position;
      const dy = pb.y - pa.y;
      if (dy > a.body.height - 0.2 || -dy > b.body.height - 0.2) continue; // übereinander (stehen auf Kopf o. Ä.)
      const minD = a.body.radius + b.body.radius;
      let dx = pb.x - pa.x;
      let dz = pb.z - pa.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) { const t = (i * 7 + j * 13) % 6.283; dx = Math.cos(t); dz = Math.sin(t); d = 1; } else { dx /= d; dz /= d; }
      // Mehrspieler-Puppen (Position kommt aus dem Netz) weichen nicht aus – der andere Akteur nimmt den ganzen Stoß
      if (a.puppet && b.puppet) continue;
      const push = Math.min(maxPush, (minD - Math.min(d, minD)) * 0.5);
      // Der Spieler wird weniger geschoben als Bots (fühlt sich „fester“ an)
      const wa = a.puppet ? 0 : b.puppet ? 2 : a.isPlayer ? 0.35 : b.isPlayer ? 1.65 : 1;
      pa.x -= dx * push * wa; pa.z -= dz * push * wa;
      pb.x += dx * push * (2 - wa); pb.z += dz * push * (2 - wa);
      a.body._sync();
      b.body._sync();
    }
  }
}

/* ===================================================================== Strahlen & Kanten */

const _rayHit = { t: 0, tri: -1, nx: 0, ny: 0, nz: 0, data: 0 };
const _ray3 = new Ray();
const _o = new Vector3();
const _d = new Vector3();
const _occCap = new Capsule(new Vector3(), new Vector3(), 0.3);

/**
 * Strahl gegen die Kollisionsgeometrie der Welt: world.collisionRaycast(origin, dir, maxDist) → {distance, normal} falls
 * vorhanden, sonst world.collisionBVH bzw. debugData.colliderBVH, sonst Octree, sonst Kugel-Raycast.
 * dir normiert. → out = { distance, nx, ny, nz } oder null.
 */
export function collisionRay(world, origin, dir, maxDist, out = {}) {
  if (!world) return null;
  // Zusammengesetzte Welten (z. B. Gelände + Gebäude) können einen eigenen Kollisionsstrahl anbieten
  if (typeof world.collisionRaycast === 'function') {
    const r = world.collisionRaycast(origin, dir, maxDist);
    if (!r) return null;
    const n = r.normal || { x: 0, y: 1, z: 0 };
    out.distance = r.distance; out.nx = n.x; out.ny = n.y; out.nz = n.z;
    return out;
  }
  const cb = world.collisionBVH || (world.debugData && world.debugData.colliderBVH);
  if (cb && typeof cb.raycast === 'function') {
    if (!cb.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, _rayHit)) return null;
    out.distance = _rayHit.t; out.nx = _rayHit.nx; out.ny = _rayHit.ny; out.nz = _rayHit.nz;
    return out;
  }
  const oc = world.collider;
  if (oc && typeof oc.rayIntersect === 'function') {
    _ray3.origin.copy(origin); _ray3.direction.copy(dir);
    const r = oc.rayIntersect(_ray3);
    if (!r || r.distance > maxDist) return null;
    const n = r.triangle.getNormal(_d);
    if (n.dot(dir) > 0) n.negate();
    out.distance = r.distance; out.nx = n.x; out.ny = n.y; out.nz = n.z;
    return out;
  }
  if (typeof world.raycast === 'function') {
    const r = world.raycast(origin, dir, maxDist);
    if (!r) return null;
    out.distance = r.distance; out.nx = r.normal.x; out.ny = r.normal.y; out.nz = r.normal.z;
    return out;
  }
  return null;
}

/** Passt eine Kapsel (Radius r, Höhe h, Füße bei pos) frei in die Welt? */
export function canOccupy(world, pos, height, radius = 0.32) {
  const collider = world && world.collider;
  if (!collider || typeof collider.capsuleIntersect !== 'function') return true;
  _occCap.radius = radius;
  _occCap.start.set(pos.x, pos.y + radius + 0.04, pos.z);
  _occCap.end.set(pos.x, pos.y + Math.max(height - radius, radius + 0.06), pos.z);
  const hit = collider.capsuleIntersect(_occCap);
  return !hit || hit.depth < 0.012;
}

const _hitA = {};
const _hitB = {};

/* ===================================================================== Punktabstand (Kamera) */

const _ptTris = [];
const _ptCap = new Capsule(new Vector3(), new Vector3(), 0.1);
const _cp = new Vector3();
const _ab = new Vector3(), _ac = new Vector3(), _ap = new Vector3();

/** Nächster Punkt auf dem Dreieck (a, b, c) zu p → out (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTri(p, a, b, c, out) {
  _ab.subVectors(b, a); _ac.subVectors(c, a); _ap.subVectors(p, a);
  const d1 = _ab.dot(_ap), d2 = _ac.dot(_ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  _ap.subVectors(p, b);
  const d3 = _ab.dot(_ap), d4 = _ac.dot(_ap);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(_ab, d1 / (d1 - d3));
  _ap.subVectors(p, c);
  const d5 = _ab.dot(_ap), d6 = _ac.dot(_ap);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(_ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return out.copy(b).addScaledVector(_ap.subVectors(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return out.copy(a).addScaledVector(_ab, vb * den).addScaledVector(_ac, vc * den);
}

/**
 * Hält einen Punkt (z. B. die Kamera) mindestens `radius` von der Kollisionsgeometrie fern: schiebt ihn entlang der
 * Abstandsrichtung heraus (wenige Iterationen, Ecken). Der Punkt muss auf der freien Seite liegen (vorher per
 * collisionRay vom sicheren Anker begrenzen). → kleinster gefundener Abstand vor dem Schieben (m; Infinity = frei).
 */
export function keepClear(world, point, radius) {
  const collider = world && world.collider;
  if (!collider || typeof collider.getCapsuleTriangles !== 'function') return Infinity;
  _ptCap.radius = radius;
  _ptCap.start.copy(point);
  _ptCap.end.copy(point);
  _ptCap.end.y += 1e-3;
  _ptTris.length = 0;
  collider.getCapsuleTriangles(_ptCap, _ptTris);
  let first = Infinity;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (let i = 0; i < _ptTris.length; i++) {
      const t = _ptTris[i];
      closestOnTri(point, t.a, t.b, t.c, _cp);
      _n.subVectors(point, _cp);
      const d = _n.length();
      if (iter === 0 && d < first) first = d;
      if (d >= radius) continue;
      if (d < 1e-5) { t.getNormal(_n); } else _n.multiplyScalar(1 / d);
      point.addScaledVector(_n, radius - d + 1e-4);
      moved = true;
    }
    if (!moved) break;
  }
  _ptTris.length = 0;
  return first;
}

/**
 * Kantensuche fürs Überklettern (F6): Wand in Laufrichtung (dirX, dirZ normiert, waagerecht) in Hüfthöhe, Oberkante
 * per Abwärtsstrahl, Platz für den geduckten Körper oben und freie Bahn über die Kante. Dünne Hindernisse bis
 * vaultMax Höhe werden übersprungen (vault), sonst wird auf die Oberkante geklettert.
 * opts: { reach = 0.7, minH = 0.5, maxH = 1.3, vaultMax = 1.1, crouchH = 1.15 }
 * → { height, topY, wallDist, nx, nz, end: Vector3 (Füße am Ende), vault: bool, depth } | null
 */
export function probeLedge(world, body, dirX, dirZ, opts = {}) {
  const { reach = 0.7, minH = 0.5, maxH = 1.3, vaultMax = 1.1, crouchH = 1.15 } = opts;
  if (!world) return null;
  const p = body.position;
  const r = body.radius;
  _d.set(dirX, 0, dirZ);
  if (_d.lengthSq() < 1e-6) return null;
  _d.normalize();
  // 1) Wand vor dem Körper (zwei Höhen: Knie und Hüfte)
  let wall = null;
  for (const hy of [minH - 0.12, Math.min(maxH - 0.15, 0.85)]) {
    _o.set(p.x, p.y + hy, p.z);
    const h = collisionRay(world, _o, _d, r + reach, _hitA);
    if (h && Math.abs(h.ny) < 0.6 && (!wall || h.distance < wall.distance)) wall = { distance: h.distance, nx: h.nx, nz: h.nz };
  }
  if (!wall) return null;
  // nur frontal genug (nicht an einer Wand entlangschrammen)
  const facing = -(wall.nx * _d.x + wall.nz * _d.z) / Math.max(1e-3, Math.hypot(wall.nx, wall.nz));
  if (facing < 0.45) return null;
  // 2) Oberkante: Abwärtsstrahl knapp hinter der Wandfläche (dünne Mauern ab 8 cm Stärke werden noch getroffen)
  const topStart = p.y + maxH + 0.65;
  let topY = -Infinity, probe = 0;
  for (const k of [0.08, 0.22]) {
    _o.set(p.x + _d.x * (wall.distance + k), topStart, p.z + _d.z * (wall.distance + k));
    const down = collisionRay(world, _o, _v3down, maxH + 0.65 - minH + 0.25, _hitB);
    if (down && down.ny >= 0.7 && topStart - down.distance > topY) { topY = topStart - down.distance; probe = wall.distance + k; }
  }
  if (topY === -Infinity) return null;
  const height = topY - p.y;
  if (height < minH - 0.06 || height > maxH + 0.04) return null;
  // Über dem Startpunkt des Abwärtsstrahls darf nichts hängen (sonst steckt der Kopf in der Decke)
  _o.set(p.x + _d.x * probe, topY + 0.05, p.z + _d.z * probe);
  if (collisionRay(world, _o, _v3up, crouchH + 0.05, _hitA)) return null;
  // 3) freie Bahn über die Kante (in Hüft- und Kopfhöhe des geduckten Körpers über der Oberkante)
  for (const hy of [0.3, crouchH - 0.2]) {
    _o.set(p.x, topY + hy, p.z);
    if (collisionRay(world, _o, _d, wall.distance + r + 0.45, _hitA)) return null;
  }
  // 4) dünn? → überspringen (Boden dahinter deutlich tiefer als die Oberkante)
  let vault = false;
  let depth = Infinity;
  if (height <= vaultMax) {
    for (const k of [0.3, 0.5, 0.7, 0.9]) {
      _o.set(p.x + _d.x * (wall.distance + k), topY + 0.25, p.z + _d.z * (wall.distance + k));
      const g = collisionRay(world, _o, _v3down, 0.6, _hitA);
      if (!g) { depth = k - 0.05; break; }
    }
    if (depth <= 0.9) vault = true;
  }
  const end = new Vector3();
  if (vault) {
    // Landeplatz hinter dem Hindernis (Füße in Oberkantenhöhe; danach fällt der Körper normal)
    const d = wall.distance + depth + r + 0.12;
    end.set(p.x + _d.x * d, topY + 0.06, p.z + _d.z * d);
    if (!canOccupy(world, end, crouchH, r * 0.92)) vault = false;
  }
  if (!vault) {
    const d = wall.distance + r + 0.1;
    end.set(p.x + _d.x * d, topY + 0.02, p.z + _d.z * d);
    if (!canOccupy(world, end, crouchH, r * 0.92)) return null;
  }
  return { height, topY, wallDist: wall.distance, nx: wall.nx, nz: wall.nz, end, vault, depth: Number.isFinite(depth) ? depth : null };
}

const _v3down = new Vector3(0, -1, 0);
const _v3up = new Vector3(0, 1, 0);
