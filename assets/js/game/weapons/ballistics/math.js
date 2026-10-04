// NULLPUNKT — Ballistik-Hilfen (rein rechnerisch, ohne Allokationen im Schussweg).
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Framerate-unabhängiger Annäherungsfaktor (0..1). */
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const smooth01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const rand = (a, b) => a + Math.random() * (b - a);

const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ref = new THREE.Vector3();
const GOLDEN = 2.399963229728653; // Goldener Winkel (rad)

/** Orthonormale Basis (u, w) senkrecht zu dir. */
function basis(dir) {
  _ref.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.96) _ref.set(1, 0, 0);
  _u.crossVectors(dir, _ref).normalize();
  _w.crossVectors(_u, dir).normalize();
}

/** Richtung im Kegel: Winkelabstand r (rad) und Drehwinkel th um dir. */
export function offsetDir(dir, r, th, out) {
  if (r <= 1e-7) return out.copy(dir);
  basis(dir);
  const t = Math.tan(r);
  return out.copy(dir).addScaledVector(_u, t * Math.cos(th)).addScaledVector(_w, t * Math.sin(th)).normalize();
}

/** Gleichverteilt auf der Kreisscheibe des Kegels mit halbem Öffnungswinkel `angle`. */
export function sampleCone(dir, angle, out) {
  if (angle <= 1e-7) return out.copy(dir);
  return offsetDir(dir, angle * Math.sqrt(Math.random()), Math.random() * Math.PI * 2, out);
}

/**
 * Schrot: geschichtete Verteilung (Sonnenblumenmuster + Jitter) – gleichmäßiger als reiner Zufall,
 * dadurch verlässlichere Schusszahlen. rot = zufällige Drehung des ganzen Musters.
 */
export function samplePellet(dir, angle, i, n, rot, out) {
  if (n <= 1) return sampleCone(dir, angle, out);
  const k = clamp((i + 0.5 + (Math.random() - 0.5) * 0.7) / n, 0, 1);
  const r = angle * Math.sqrt(k) * (0.92 + Math.random() * 0.12);
  const th = rot + i * GOLDEN + (Math.random() - 0.5) * 0.45;
  return offsetDir(dir, r, th, out);
}

/** Rückstoßmuster-Eintrag für Schussindex i ([h, v]); nach dem Ende werden die letzten 4 wiederholt. */
const ONE = [0, 1];
export function patternAt(pattern, i) {
  if (!pattern || !pattern.length) return ONE;
  if (i < pattern.length) return pattern[i];
  const loop = Math.min(4, pattern.length);
  return pattern[pattern.length - loop + ((i - pattern.length) % loop)];
}

/** Yaw/Pitch einer Richtung (Yaw 0 = −Z, Pitch > 0 = hoch) – wie Player.getAimDirection. */
export function dirToYawPitch(dx, dy, dz) {
  const h = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, h) };
}

/** Richtung aus Yaw/Pitch. */
export function yawPitchToDir(yaw, pitch, out) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}
