// NULLPUNKT — Deterministisches Rauschen für Großkarten (Simplex 2D, fBm, Kamm-Rauschen, Hash) (Owner: world)
// Ohne three-Abhängigkeit: läuft auch im Welt-Worker. Gleicher Seed → gleiche Werte (Kartenaufbau reproduzierbar).

/** Kleiner, schneller Zufallsgenerator (mulberry32). → () => [0, 1) */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ganzzahl-Hash zweier Gitterkoordinaten (+ Kanal k) → [0, 1). */
export function hash2(i, j, k = 0) {
  let n = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);

/** Simplex-Rauschen 2D mit eigener Permutation je Seed. noise(x, y) → [-1, 1] */
export function createSimplex(seed = 1) {
  const r = rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm8 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm8[i] = perm[i] & 7; }
  return function noise(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm8[ii + perm[jj]] * 2; t0 *= t0; n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm8[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm8[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2); }
    return 70 * n;
  };
}

/** Fraktales Rauschen (Summe von Oktaven), normiert auf etwa [-1, 1]. */
export function fbm(noise, x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += a * noise(x * f + o * 17.31, y * f - o * 9.77);
    norm += a; a *= gain; f *= lacunarity;
  }
  return sum / norm;
}

/** Kamm-Rauschen (Grate) in [0, 1]. */
export function ridged(noise, x, y, octaves = 4) {
  let a = 0.5, f = 1, sum = 0, w = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(x * f + o * 31.7, y * f + o * 7.3));
    n *= n * w;
    w = Math.min(1, n * 2);
    sum += n * a; a *= 0.5; f *= 2.1;
  }
  return sum;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
