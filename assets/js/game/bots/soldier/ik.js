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

/**
 * Gedämpfte Feder (skalar): state = { x, v }, x'' = −k·(x − target) − c·x'.
 * Exakte (analytische) Lösung über den Schritt dt → für jedes dt stabil (auch bei gedrosselter
 * Animationsrate mit großen, aufgelaufenen Schritten); Energie nimmt nie zu.
 */
export function spring(s, target, k, c, dt) {
  if (!(dt > 0)) return s.x;
  const y0 = s.x - target, v0 = s.v;
  const a = 0.5 * c;
  const disc = k - a * a;
  let y, v;
  if (disc > 1e-9) {
    // unterdämpft
    const w = Math.sqrt(disc);
    const e = Math.exp(-a * dt), cw = Math.cos(w * dt), sw = Math.sin(w * dt);
    y = e * (y0 * cw + ((v0 + a * y0) / w) * sw);
    v = e * (v0 * cw - ((a * v0 + k * y0) / w) * sw);
  } else if (disc < -1e-9) {
    // überdämpft
    const b = Math.sqrt(-disc);
    const r1 = -a + b, r2 = -a - b;
    const c1 = (v0 - r2 * y0) / (r1 - r2), c2 = y0 - c1;
    const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
    y = c1 * e1 + c2 * e2;
    v = r1 * c1 * e1 + r2 * c2 * e2;
  } else {
    // kritisch gedämpft
    const e = Math.exp(-a * dt), B = v0 + a * y0;
    y = (y0 + B * dt) * e;
    v = (v0 - a * B * dt) * e;
  }
  s.x = y + target;
  s.v = v;
  return s.x;
}
