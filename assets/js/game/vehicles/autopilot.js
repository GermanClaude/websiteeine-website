// NULLPUNKT — Fahrer-Autopilot für Bots (und Tests): Pure Pursuit entlang eines Pfads mit Hindernisfächer,
// Abbremsen vor Kurven/Ziel, Rückwärtsfahren bei Ziel hinter dem Fahrzeug und Freifahren, wenn es feststeckt.
// Eingang: intent.moveTo (Vector3) oder intent.path (Vector3[]); Ausgang: intent.{throttle, steer, brake,
// handbrake} (werden vom Fahrzeug übernommen) sowie intent.arrived / intent.stuck / intent.blocked.
import * as THREE from 'three';
import { collisionRay } from '../engine/physics.js';

const _t = new THREE.Vector3(), _l = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3();
const _hit = {};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Punkt auf dem Pfad im Abstand `ahead` ab der Projektion von pos (Pfadindex wird mitgeführt). */
function pursuitTarget(intent, pos, ahead, out) {
  const path = intent.path;
  let i = Math.min(intent._wp | 0, path.length - 1);
  // Wegpunkte überspringen, die schon nah/überholt sind
  while (i < path.length - 1 && pos.distanceTo(path[i]) < Math.max(3, ahead * 0.6)) i++;
  intent._wp = i;
  let rest = ahead;
  let p = pos;
  for (let k = i; k < path.length; k++) {
    const d = p.distanceTo(path[k]);
    if (d >= rest) return out.copy(path[k]).sub(p).multiplyScalar(rest / Math.max(1e-3, d)).add(p);
    rest -= d;
    p = path[k];
  }
  return out.copy(path[path.length - 1]);
}

/**
 * Stellt intent.throttle/steer/brake aus moveTo/path. dt in s. world für Hindernisstrahlen.
 * Rückgabe: true, wenn der Autopilot steuert.
 */
export function updateAutopilot(vehicle, intent, dt, world) {
  if (!intent.path && intent.moveTo) intent.path = [intent.moveTo.clone()];
  const path = intent.path;
  if (!path || !path.length) return false;
  const b = vehicle.body, def = vehicle.def;
  const pos = b.origin(_o);
  const final = path[path.length - 1];
  const distFinal = Math.hypot(final.x - pos.x, final.z - pos.z);
  const v = b.speed;
  const vmax = Math.min(intent.maxSpeed || def.engine.maxSpeed, def.engine.maxSpeed);
  intent.arrived = distFinal < (intent.arriveRadius || 4);
  if (intent.arrived) {
    intent.throttle = 0; intent.steer = 0; intent.brake = 1;
    intent._stuckT = 0;
    return true;
  }
  const ahead = clamp(4 + Math.abs(v) * 0.8, 5, 18);
  pursuitTarget(intent, pos, ahead, _t);
  b.toLocal(_t, _l);
  // Lokal: −Z vorn, +X rechts
  const ang = Math.atan2(_l.x, -_l.z);
  const behind = Math.abs(ang) > 2.1;
  // Freifahren
  if (intent._reverseT > 0) {
    intent._reverseT -= dt;
    intent.throttle = -0.8;
    intent.steer = intent._reverseSteer || 0;
    intent.brake = 0;
    return true;
  }
  let throttle, steer;
  if (behind && distFinal < 14 && intent.reverseAllowed !== false) {
    // Ziel kurz hinter uns: rückwärts mit umgekehrter Lenkung
    throttle = -0.7;
    steer = clamp(-Math.sign(ang) * (Math.PI - Math.abs(ang)) * 1.8, -1, 1);
  } else {
    steer = clamp(ang * (vehicle.body.tracked ? 2.2 : 1.7), -1, 1);
    const turnSlow = 1 - Math.min(0.75, Math.abs(ang) / 1.3);
    const arriveSlow = clamp(distFinal / 18, 0.25, 1);
    const want = vmax * turnSlow * arriveSlow;
    throttle = clamp((want - v) * 0.35 + want / Math.max(1, def.engine.maxSpeed) * 0.5, -1, 1);
    if (vehicle.body.tracked && Math.abs(ang) > 0.9 && Math.abs(v) < 3) throttle = Math.min(throttle, 0.15); // auf der Stelle drehen
  }
  // Hindernisfächer (3 Strahlen in Stoßstangenhöhe)
  if (world && throttle > 0) {
    const len = 3 + Math.abs(v) * 1.1;
    const hb = def.hullBox;
    let left = len, right = len, mid = len;
    for (const [k, a] of [[0, 0], [1, -0.42], [2, 0.42]]) {
      _d.set(Math.sin(a), 0, -Math.cos(a)).applyQuaternion(b.quat);
      _f.set(0, 0.85, hb[2] - hb[5] + 0.2);
      b.toWorld(_f, _o);
      const h = collisionRay(world, _o, _d, len, _hit);
      const dd = h ? h.distance : len;
      if (k === 0) mid = dd; else if (k === 1) left = dd; else right = dd;
    }
    if (mid < len * 0.7 || left < len * 0.45 || right < len * 0.45) {
      steer = clamp(steer + (right > left ? 0.7 : -0.7), -1, 1);
      throttle *= clamp(mid / len, 0.3, 1);
    }
  }
  // Feststecken erkennen
  if (throttle > 0.3 && Math.abs(v) < 0.6) intent._stuckT = (intent._stuckT || 0) + dt;
  else intent._stuckT = Math.max(0, (intent._stuckT || 0) - dt * 2);
  intent.stuck = intent._stuckT > 2.5;
  if (intent.stuck) {
    intent._stuckT = 0;
    intent._reverseT = 1.6;
    intent._reverseSteer = steer >= 0 ? -1 : 1;
    intent.stuckCount = (intent.stuckCount || 0) + 1;
    intent.blocked = intent.stuckCount >= 3;
  }
  intent.throttle = throttle;
  intent.steer = steer;
  intent.brake = 0;
  return true;
}

/** Autopilot-Zustand löschen (neues Ziel). */
export function resetAutopilot(intent) {
  intent._wp = 0; intent._stuckT = 0; intent._reverseT = 0; intent.stuck = false; intent.blocked = false; intent.stuckCount = 0; intent.arrived = false;
}
