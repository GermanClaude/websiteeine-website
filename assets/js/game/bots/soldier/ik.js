// NULLPUNKT — kleine Mathe-Helfer für Skelett-Animation: Basis → Quaternion, Zwei-Knochen-IK, Federn.
import * as THREE from 'three';

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Glatter Übergang a→b im Intervall [t0, t1]. */
export const ramp = (t, t0, t1) => smooth((t - t0) / Math.max(1e-6, t1 - t0));

/** Orientierung, deren +Y-Achse entlang y zeigt und deren +Z möglichst zHint folgt. */
export function quatFromYZ(out, y, zHint) {
  _y.copy(y).normalize();
  _x.crossVectors(_y, zHint);
  if (_x.lengthSq() < 1e-8) _x.crossVectors(_y, Math.abs(_y.z) < 0.9 ? AZ : AX);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Orientierung aus +X-Achse x und ungefährer +Y-Achse yHint. */
export function quatFromXY(out, x, yHint) {
  _x.copy(x).normalize();
  _z.crossVectors(_x, yHint);
  if (_z.lengthSq() < 1e-8) _z.crossVectors(_x, Math.abs(_x.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : AZ);
  _z.normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/**
 * Analytische Zwei-Knochen-IK. S = Wurzel (Schulter/Hüfte), T = Ziel, a/b = Knochenlängen,
 * pole = Richtung, in die das Mittelgelenk zeigen soll. Schreibt Mittelgelenk nach outE und das
 * erreichbare Ende nach outT. Rückgabe: Streckung 0..1.
 */
export function twoBone(S, T, a, b, pole, outE, outT) {
  _u.subVectors(T, S);
  let d = _u.length();
  if (d < 1e-5) { _u.set(0, -1, 0); d = 1e-5; } else _u.multiplyScalar(1 / d);
  const dMin = Math.abs(a - b) + 1e-3;
  const dMax = (a + b) * 0.9995;
  const dist = clamp(d, dMin, dMax);
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_p.lengthSq() < 1e-8) { _p.set(0, 0, -1).addScaledVector(_u, _u.z); if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0); }
  _p.normalize();
  outE.copy(S).addScaledVector(_u, a * cosA).addScaledVector(_p, a * sinA);
  outT.copy(S).addScaledVector(_u, dist);
  return dist / (a + b);
}

/** Gedämpfte Feder (skalar): state = { x, v }. */
export function spring(s, target, k, c, dt) {
  const a = -k * (s.x - target) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  return s.x;
}
