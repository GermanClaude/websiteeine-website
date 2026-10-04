// Kleine Animationshelfer: gedämpfte Federn, Easing, Schlüsselbild-Kurven.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = t => t * t * (3 - 2 * t);
export const easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeIn = t => t * t * t;
export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t, s = 1.6) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
/** Exponentielle Annäherung, framerate-unabhängig */
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** Gedämpfte Feder (Skalar). k = Steifigkeit, c = Dämpfung. */
export class Spring {
  constructor(k = 160, c = 18) { this.k = k; this.c = c; this.x = 0; this.v = 0; }
  update(dt, target = 0) {
    // Halbimplizites Euler in Teilschritten (stabil auch bei großen dt)
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v) { this.v += v; }
  reset() { this.x = 0; this.v = 0; }
}

/** Drei Federn als Vektor */
export class Spring3 {
  constructor(k, c) { this.s = [new Spring(k, c), new Spring(k, c), new Spring(k, c)]; this.value = new THREE.Vector3(); }
  update(dt, tx = 0, ty = 0, tz = 0) {
    this.value.set(this.s[0].update(dt, tx), this.s[1].update(dt, ty), this.s[2].update(dt, tz));
    return this.value;
  }
  kick(x, y, z) { this.s[0].kick(x); this.s[1].kick(y); this.s[2].kick(z); }
  reset() { for (const s of this.s) s.reset(); this.value.set(0, 0, 0); }
}

/**
 * Schlüsselbild-Kurve: keys = [[t, wert], …] (t aufsteigend, wert Zahl oder Array).
 * Zwischen Schlüsseln wird geglättet (smoothstep) interpoliert; außerhalb gelten die Randwerte.
 */
export function curve(t, keys, out) {
  const n = keys.length;
  if (t <= keys[0][0]) return copyVal(keys[0][1], out);
  if (t >= keys[n - 1][0]) return copyVal(keys[n - 1][1], out);
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1];
  const w = smooth(clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1));
  if (typeof a === 'number') return a + (b - a) * w;
  out = out || new Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * w;
  return out;
}

function copyVal(v, out) {
  if (typeof v === 'number') return v;
  out = out || new Array(v.length);
  for (let k = 0; k < v.length; k++) out[k] = v[k];
  return out;
}

/** Fenster-Gewicht: 0 vor a, Rampe bis b, 1 bis c, Rampe bis d, danach 0 */
export function windowW(t, a, b, c, d) {
  if (t <= a || t >= d) return 0;
  if (t < b) return smooth((t - a) / (b - a));
  if (t <= c) return 1;
  return smooth(1 - (t - c) / (d - c));
}
