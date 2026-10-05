// NULLPUNKT — reine Textur-Generatoren (ohne three.js), nutzbar im Hauptthread und im Worker (Owner: world)
// generateTexture(texName, size) → { albedo, normal, rm, hasMetal, hasAlpha, S } (Uint8Array RGBA)

// ---------------------------------------------------------------------------
// Zufall & Rauschen (kachelbar)
// ---------------------------------------------------------------------------
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Addiert kachelbares Value-Noise mit px × py Gitterzellen und Amplitude amp. */
function addNoise(out, S, px, py, amp, r) {
  px = Math.max(1, Math.min(S, px | 0)); py = Math.max(1, Math.min(S, py | 0));
  const lat = new Float32Array(px * py);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const ix0 = new Int32Array(S), ix1 = new Int32Array(S), wx = new Float32Array(S);
  for (let x = 0; x < S; x++) {
    const f = (x * px) / S, i = Math.floor(f);
    ix0[x] = i % px; ix1[x] = (i + 1) % px; wx[x] = fade(f - i);
  }
  for (let y = 0; y < S; y++) {
    const f = (y * py) / S, j = Math.floor(f), t = fade(f - j);
    const r0 = (j % py) * px, r1 = ((j + 1) % py) * px;
    let o = y * S;
    for (let x = 0; x < S; x++, o++) {
      const w = wx[x];
      const a = lat[r0 + ix0[x]], b = lat[r0 + ix1[x]];
      const c = lat[r1 + ix0[x]], d = lat[r1 + ix1[x]];
      const top = a + (b - a) * w, bot = c + (d - c) * w;
      out[o] += (top + (bot - top) * t) * amp;
    }
  }
}

function normalizeField(f) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = mx > mn ? 1 / (mx - mn) : 0;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mn) * k;
  return f;
}

/** Fraktales Rauschen 0..1. p = Basis-Zellen in x, py in y (gestreckt), oct Oktaven. */
function fbm(S, p, oct, r, { py = p, gain = 0.5, lac = 2 } = {}) {
  const out = new Float32Array(S * S);
  let amp = 1, fx = p, fy = py;
  for (let o = 0; o < oct; o++) {
    addNoise(out, S, Math.round(fx), Math.round(fy), amp, r);
    amp *= gain; fx *= lac; fy *= lac;
    if (fx > S / 2 && fy > S / 2) break;
  }
  return normalizeField(out);
}

/** Kachelbares Worley-Rauschen: f1, f2 (Zellen-Einheiten), id (Zelle). cx × cy Zellen. */
function worley(S, cx, r, { cy = cx, jitter = 0.9 } = {}) {
  const pts = new Float32Array(cx * cy * 2);
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const k = (j * cx + i) * 2;
    pts[k] = i + 0.5 + (r() - 0.5) * jitter;
    pts[k + 1] = j + 0.5 + (r() - 0.5) * jitter;
  }
  const n = S * S, f1 = new Float32Array(n), f2 = new Float32Array(n), id = new Int32Array(n);
  const sx = cx / S, sy = cy / S;
  for (let y = 0; y < S; y++) {
    const fy = (y + 0.5) * sy, gy = Math.floor(fy);
    for (let x = 0; x < S; x++) {
      const fx = (x + 0.5) * sx, gx = Math.floor(fx);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = gy + dy, wy = ((yy % cy) + cy) % cy;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = gx + dx, wx = ((xx % cx) + cx) % cx;
          const k = (wy * cx + wx) * 2;
          const px = pts[k] + (xx - wx), py = pts[k + 1] + (yy - wy);
          const ddx = px - fx, ddy = py - fy, d = ddx * ddx + ddy * ddy;
          if (d < d1) { d2 = d1; d1 = d; best = wy * cx + wx; } else if (d < d2) d2 = d;
        }
      }
      const o = y * S + x;
      f1[o] = Math.sqrt(d1); f2[o] = Math.sqrt(d2); id[o] = best;
    }
  }
  return { f1, f2, id };
}

/** Weiche Punkte (Poren, Kiesel, Flecken) als Feld 0..1. */
function speckle(S, r, count, rMin, rMax) {
  const f = new Float32Array(S * S);
  for (let c = 0; c < count; c++) {
    const cx = r() * S, cy = r() * S, rad = rMin + r() * (rMax - rMin), strength = 0.5 + r() * 0.5;
    const ir = Math.ceil(rad + 1);
    for (let dy = -ir; dy <= ir; dy++) for (let dx = -ir; dx <= ir; dx++) {
      const d = Math.hypot(dx + 0.5 - (cx % 1), dy + 0.5 - (cy % 1));
      if (d > rad + 0.5) continue;
      const v = strength * (1 - smooth(rad - 0.7, rad + 0.5, d));
      const x = ((Math.floor(cx) + dx) % S + S) % S, y = ((Math.floor(cy) + dy) % S + S) % S;
      const o = y * S + x;
      if (v > f[o]) f[o] = v;
    }
  }
  return f;
}

/** Dünne Linien (Kratzer). */
function scratches(S, r, count, lenMin, lenMax, { angle = null, width = 1 } = {}) {
  const f = new Float32Array(S * S);
  for (let c = 0; c < count; c++) {
    let x = r() * S, y = r() * S;
    const a = angle === null ? r() * Math.PI * 2 : angle + (r() - 0.5) * 0.4;
    const len = lenMin + r() * (lenMax - lenMin), dx = Math.cos(a), dy = Math.sin(a), s = 0.4 + r() * 0.6;
    let bend = (r() - 0.5) * 0.02, ang = a;
    for (let t = 0; t < len; t++) {
      ang += bend; x += Math.cos(ang); y += Math.sin(ang);
      for (let w = 0; w < width; w++) {
        const px = ((Math.floor(x + w * -dy)) % S + S) % S, py = ((Math.floor(y + w * dx)) % S + S) % S;
        const o = py * S + px, v = s * (1 - t / len * 0.5);
        if (v > f[o]) f[o] = v;
      }
    }
  }
  return f;
}

/** Separierbarer Box-Blur mit Wrap. */
function blur(f, S, rad) {
  if (rad < 1) return f;
  const tmp = new Float32Array(S * S), k = 1 / (rad * 2 + 1);
  for (let y = 0; y < S; y++) {
    const row = y * S;
    let acc = 0;
    for (let i = -rad; i <= rad; i++) acc += f[row + ((i % S) + S) % S];
    for (let x = 0; x < S; x++) {
      tmp[row + x] = acc * k;
      acc += f[row + (x + rad + 1) % S] - f[row + ((x - rad) % S + S) % S];
    }
  }
  for (let x = 0; x < S; x++) {
    let acc = 0;
    for (let i = -rad; i <= rad; i++) acc += tmp[(((i % S) + S) % S) * S + x];
    for (let y = 0; y < S; y++) {
      f[y * S + x] = acc * k;
      acc += tmp[((y + rad + 1) % S) * S + x] - tmp[(((y - rad) % S + S) % S) * S + x];
    }
  }
  return f;
}

// ---------------------------------------------------------------------------
// Textur-Arbeitsfläche
// ---------------------------------------------------------------------------
class TexData {
  constructor(S) {
    this.S = S; this.n = S * S;
    this.albedo = new Uint8Array(this.n * 4);
    this.height = new Float32Array(this.n);
    this.rough = new Float32Array(this.n).fill(0.8);
    this.metal = null;
    this.alpha = null;
  }
  set(i, r, g, b) {
    const o = i * 4;
    this.albedo[o] = r < 0 ? 0 : r > 255 ? 255 : r;
    this.albedo[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    this.albedo[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    this.albedo[o + 3] = 255;
  }
  setC(i, c, k = 1) { this.set(i, c[0] * k, c[1] * k, c[2] * k); }
}

function hex(h) { const v = parseInt(h.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function mixC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function pick(pal, r) { return pal[Math.floor(r() * pal.length) % pal.length]; }
function jitterC(c, r, amt) { const k = 1 + (r() - 0.5) * amt; return [c[0] * k, c[1] * k * (1 + (r() - 0.5) * amt * 0.15), c[2] * k]; }

// ---------------------------------------------------------------------------
// Generatoren
// ---------------------------------------------------------------------------
const G = {};

G.concrete = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#9a9892');
  const big = fbm(S, 3, 5, r), mid = fbm(S, 12, 3, r), fine = fbm(S, 128, 2, r);
  const stain = fbm(S, 4, 4, r), streak = fbm(S, 48, 3, r, { py: 3 });
  const pits = speckle(S, r, Math.round(n * 0.0025), 0.4, 1.6);
  const cracks = fbm(S, 6, 5, r), crackMask = fbm(S, 2, 3, r);
  for (let i = 0; i < n; i++) {
    let v = 0.93 + (big[i] - 0.5) * 0.16 + (mid[i] - 0.5) * 0.1 + (fine[i] - 0.5) * 0.12;
    const s = smooth(0.62, 0.92, stain[i]) * 0.14, st = smooth(0.64, 0.95, streak[i]) * 0.08;
    const cr = (1 - smooth(0.0, 0.012, Math.abs(cracks[i] - 0.5))) * smooth(0.62, 0.75, crackMask[i]);
    v *= 1 - s - st - cr * 0.35; v -= pits[i] * 0.22;
    const warm = (big[i] - 0.5) * 6;
    t.set(i, base[0] * v + warm, base[1] * v, base[2] * v - warm);
    t.height[i] = fine[i] * 0.14 + mid[i] * 0.22 + big[i] * 0.15 - pits[i] * 0.55 - cr * 0.5;
    t.rough[i] = 0.9 - s * 0.5 + (fine[i] - 0.5) * 0.08;
  }
  if (o.panels) { // Schalungsfugen + Ankerlöcher
    const [pw, ph] = o.panels;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = (x / S) * pw, fy = (y / S) * ph;
      const ex = Math.min(fx % 1, 1 - (fx % 1)) * S / pw, ey = Math.min(fy % 1, 1 - (fy % 1)) * S / ph;
      const i = y * S + x;
      const line = 1 - smooth(0.6, 2.2, Math.min(ex, ey));
      // Ankerlöcher bei 1/6 und 5/6 der Paneelbreite
      const hx = ((fx % 1) * 3) % 1, hy = ((fy % 1) * 2) % 1;
      const hole = 1 - smooth(S / pw * 0.012, S / pw * 0.02, Math.hypot((hx - 0.5) * S / pw / 3, (hy - 0.5) * S / ph / 2));
      const k = 1 - line * 0.3 - hole * 0.45;
      const a = t.albedo, q = i * 4;
      a[q] *= k; a[q + 1] *= k; a[q + 2] *= k;
      t.height[i] -= line * 0.6 + hole * 0.9;
    }
  }
};

G.asphalt = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#5a5b5c');
  const big = fbm(S, 3, 5, r), fine = fbm(S, 160, 2, r), agg = new Float32Array(n);
  addNoise(agg, S, S / 2, S / 2, 1, r); normalizeField(agg);
  const patch = fbm(S, 2, 4, r), cracks = fbm(S, 5, 5, r), cm = fbm(S, 2, 3, r);
  const tar = speckle(S, r, Math.round(n * 0.0004), 2, 6);
  for (let i = 0; i < n; i++) {
    let v = 0.9 + (big[i] - 0.5) * 0.25;
    const light = smooth(0.78, 0.92, agg[i]), dark = smooth(0.3, 0.12, agg[i]);
    const p = smooth(0.62, 0.66, patch[i]);
    const cr = (1 - smooth(0.0, 0.01, Math.abs(cracks[i] - 0.5))) * smooth(0.55, 0.7, cm[i]);
    v *= 1 - p * 0.22 - cr * 0.5 - tar[i] * 0.3;
    const c = v + light * 0.28 - dark * 0.14;
    t.set(i, base[0] * c, base[1] * c, base[2] * c * 1.02);
    t.height[i] = agg[i] * 0.22 + fine[i] * 0.1 - cr * 0.7 + p * 0.08;
    t.rough[i] = 0.92 - tar[i] * 0.35 - p * 0.05;
  }
};

G.plaster = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#e8e2d6');
  const big = fbm(S, 2, 5, r), mid = fbm(S, 10, 4, r), stucco = fbm(S, 96, 3, r), dirt = fbm(S, 3, 4, r);
  const streak = fbm(S, 40, 3, r, { py: 2 });
  const dmg = fbm(S, 3, 5, r), stones = worley(S, 14, r, { cy: 22 });
  const crack = fbm(S, 5, 5, r);
  const stone = hex(o.stone || '#a8957a');
  for (let i = 0; i < n; i++) {
    let v = 0.94 + (big[i] - 0.5) * 0.12 + (mid[i] - 0.5) * 0.08 + (stucco[i] - 0.5) * 0.08;
    const d = (smooth(0.6, 0.95, dirt[i]) * 0.14 + smooth(0.65, 0.95, streak[i]) * 0.1) * (o.dirt ?? 1);
    const peel = smooth(0.9, 0.915, dmg[i]) * (o.peel ?? 1);
    const cr = (1 - smooth(0.0, 0.008, Math.abs(crack[i] - 0.5))) * smooth(0.7, 0.8, big[i]);
    v *= 1 - d - cr * 0.4;
    let c = [base[0] * v, base[1] * v, base[2] * v];
    if (peel > 0) {
      const mortar = smooth(0.05, 0.12, stones.f2[i] - stones.f1[i]);
      const sv = 0.75 + ((stones.id[i] * 7919) % 100) / 400;
      const sc = [stone[0] * sv * (0.6 + 0.4 * mortar), stone[1] * sv * (0.6 + 0.4 * mortar), stone[2] * sv * (0.6 + 0.4 * mortar)];
      c = mixC(c, sc, peel);
    }
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = stucco[i] * 0.35 + mid[i] * 0.2 - peel * 0.8 - cr * 0.4;
    t.rough[i] = 0.92 - d * 0.2;
  }
};

G.brick = (t, r, o) => {
  const { S, n } = t;
  const rows = o.rows || 24, cols = o.cols || 8;
  const pal = (o.palette || ['#8f4a34', '#9c5238', '#7d3f2c', '#a65f42', '#874633', '#6f3a2a']).map(hex);
  const mortarC = hex(o.mortar || '#b6aea0');
  const colors = [];
  for (let i = 0; i < rows * cols; i++) colors.push(jitterC(pick(pal, r), r, 0.18));
  const noise = fbm(S, 64, 3, r), big = fbm(S, 3, 4, r), soot = fbm(S, 4, 4, r);
  const rowH = S / rows, colW = S / cols, mw = Math.max(1, rowH * 0.14);
  for (let y = 0; y < S; y++) {
    const rf = y / rowH, row = Math.floor(rf), fy = rf - row;
    for (let x = 0; x < S; x++) {
      const cf = x / colW + (row % 2 ? 0.5 : 0), col = Math.floor(cf) % cols, fx = cf - Math.floor(cf);
      const ex = Math.min(fx, 1 - fx) * colW, ey = Math.min(fy, 1 - fy) * rowH;
      const e = Math.min(ex, ey);
      const i = y * S + x;
      const brick = smooth(mw * 0.5, mw * 0.5 + 1.5, e);
      const bc = colors[row * cols + col];
      const v = 0.9 + (noise[i] - 0.5) * 0.25 + (big[i] - 0.5) * 0.15;
      const c = mixC(mortarC.map(c => c * (0.85 + noise[i] * 0.2)), bc.map(c => c * v), brick);
      const s = smooth(0.6, 0.9, soot[i]) * 0.25;
      t.set(i, c[0] * (1 - s), c[1] * (1 - s), c[2] * (1 - s));
      t.height[i] = brick * (0.7 + noise[i] * 0.3) * smooth(0, 3, e - mw * 0.5) + noise[i] * 0.1;
      t.rough[i] = 0.88 + (1 - brick) * 0.08;
    }
  }
};

G.stoneWall = (t, r, o) => {
  const { S, n } = t;
  const w = worley(S, o.cells || 6, r, { cy: o.cellsY || 9, jitter: 0.85 });
  const pal = (o.palette || ['#c8b694', '#b8a582', '#d4c4a2', '#a99674', '#c2ae8c']).map(hex);
  const mortar = hex(o.mortar || '#9c8f78');
  const noise = fbm(S, 32, 4, r), big = fbm(S, 3, 4, r), cols = [];
  for (let i = 0; i < 400; i++) cols.push(jitterC(pick(pal, r), r, 0.2));
  for (let i = 0; i < n; i++) {
    const edge = w.f2[i] - w.f1[i];
    const st = smooth(0.04, 0.16, edge);
    const c0 = cols[w.id[i] % cols.length], v = 0.85 + noise[i] * 0.3 - (1 - big[i]) * 0.08;
    const c = mixC(mortar.map(c => c * (0.8 + noise[i] * 0.3)), c0.map(c => c * v), st);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = st * (0.6 + Math.min(edge, 0.4)) + noise[i] * 0.3;
    t.rough[i] = 0.9;
  }
};

G.cobble = (t, r, o) => {
  const { S, n } = t;
  const w = worley(S, o.cells || 10, r, { cy: o.cellsY || o.cells || 10, jitter: o.jitter ?? 0.7 });
  const pal = (o.palette || ['#8d8a84', '#7b7872', '#9a958c', '#6f6b66', '#a29d93']).map(hex);
  const grout = hex(o.grout || '#6b6152');
  const noise = fbm(S, 48, 3, r), big = fbm(S, 3, 4, r), cols = [];
  for (let i = 0; i < 400; i++) cols.push(jitterC(pick(pal, r), r, 0.15));
  for (let i = 0; i < n; i++) {
    const edge = w.f2[i] - w.f1[i];
    const st = smooth(0.03, 0.14, edge);
    const c0 = cols[w.id[i] % cols.length], v = 0.88 + noise[i] * 0.22 + (big[i] - 0.5) * 0.12;
    const c = mixC(grout.map(c => c * (0.8 + noise[i] * 0.3)), c0.map(c => c * v), st);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = st * (0.5 + Math.min(edge * 1.5, 0.5)) + noise[i] * 0.15;
    t.rough[i] = 0.78 + (1 - st) * 0.18 - (big[i] > 0.7 ? 0.1 : 0);
  }
};

G.slabs = (t, r, o) => {
  const { S, n } = t;
  const rows = o.rows || 4;
  const pal = (o.palette || ['#d8cdb6', '#cfc3aa', '#e0d6c0', '#c7bba2']).map(hex);
  const joint = hex(o.joint || '#9a8f78');
  const noise = fbm(S, 40, 4, r), big = fbm(S, 3, 4, r), spots = speckle(S, r, Math.round(n * 0.0008), 1, 3);
  // Pro Reihe zufällige Fugenpositionen (kachelbar)
  const rowCuts = [];
  for (let i = 0; i < rows; i++) {
    const cuts = []; let u = r() * 0.3;
    while (u < 1) { cuts.push(u); u += 0.22 + r() * 0.3; }
    rowCuts.push(cuts);
  }
  const rowH = S / rows, jw = Math.max(1, S / 300);
  const tone = []; for (let i = 0; i < 64; i++) tone.push(jitterC(pick(pal, r), r, 0.12));
  for (let y = 0; y < S; y++) {
    const rf = y / rowH, row = Math.floor(rf), fy = rf - row, cuts = rowCuts[row];
    for (let x = 0; x < S; x++) {
      const u = x / S;
      let seg = 0, dmin = 1e9;
      for (let k = 0; k < cuts.length; k++) {
        let d = Math.abs(u - cuts[k]); d = Math.min(d, 1 - d); if (d < dmin) dmin = d;
        if (u >= cuts[k]) seg = k + 1;
      }
      if (seg === cuts.length) seg = 0;
      const ey = Math.min(fy, 1 - fy) * rowH, ex = dmin * S, e = Math.min(ex, ey);
      const i = y * S + x;
      const slab = smooth(jw * 0.5, jw * 0.5 + 1.2, e);
      const c0 = tone[(row * 7 + seg * 3) % tone.length], v = 0.9 + noise[i] * 0.18 + (big[i] - 0.5) * 0.1 - spots[i] * 0.15;
      const c = mixC(joint, c0.map(c => c * v), slab);
      t.set(i, c[0], c[1], c[2]);
      t.height[i] = slab * 0.6 + noise[i] * 0.2;
      t.rough[i] = 0.75 + (1 - slab) * 0.2 + noise[i] * 0.05;
    }
  }
};

G.roofTiles = (t, r, o) => {
  const { S, n } = t;
  const cols = o.cols || 10, rows = o.rows || 5;
  const pal = (o.palette || ['#b65a37', '#a84f30', '#c06a42', '#9a4a2e', '#b8603c', '#8c4a35']).map(hex);
  const tone = []; for (let i = 0; i < cols * rows; i++) tone.push(jitterC(pick(pal, r), r, 0.2));
  const noise = fbm(S, 48, 3, r), moss = fbm(S, 4, 4, r), big = fbm(S, 2, 3, r);
  for (let y = 0; y < S; y++) {
    const rf = y / S * rows, row = Math.floor(rf), fy = rf - row;
    for (let x = 0; x < S; x++) {
      const cf = x / S * cols + (row % 2 ? 0.5 : 0), col = Math.floor(cf) % cols, fx = cf - Math.floor(cf);
      const i = y * S + x;
      const prof = Math.sin(fx * Math.PI);            // Mönch-Nonne-artige Wölbung
      const lap = smooth(0.0, 0.18, fy);              // Überlappungsschatten am unteren Rand
      const v = (0.62 + prof * 0.38) * (0.65 + lap * 0.35) * (0.9 + noise[i] * 0.2);
      const m = smooth(0.7, 0.9, moss[i]) * (1 - prof) * 0.6;
      const c = mixC(tone[row * cols + col].map(c => c * v), [92, 96, 62], m);
      t.set(i, c[0] * (0.92 + big[i] * 0.12), c[1], c[2]);
      t.height[i] = prof * 0.8 + fy * 0.35 + noise[i] * 0.1;
      t.rough[i] = 0.82 - prof * 0.08;
    }
  }
};

G.planks = (t, r, o) => {
  const { S, n } = t;
  const rows = o.rows || 12;
  const pal = (o.palette || ['#8a7458', '#7c6850', '#957d5f', '#6e5c46', '#a08766']).map(hex);
  const grain = fbm(S, 3, 4, r, { py: 96 }), grain2 = fbm(S, 2, 3, r, { py: 220 }), dirt = fbm(S, 3, 4, r);
  const rowH = S / rows;
  const plank = []; for (let i = 0; i < rows; i++) plank.push({ c: jitterC(pick(pal, r), r, 0.2), joint: r(), off: r() });
  for (let y = 0; y < S; y++) {
    const rf = y / rowH, row = Math.floor(rf) % rows, fy = rf - Math.floor(rf), p = plank[row];
    for (let x = 0; x < S; x++) {
      const u = x / S, i = y * S + x;
      let dj = Math.abs(u - p.joint); dj = Math.min(dj, 1 - dj);
      const gap = Math.max(1 - smooth(0.0, 0.06, Math.min(fy, 1 - fy)), 1 - smooth(0.0, 0.0035, dj));
      const g = grain[(y * S + ((x + Math.floor(p.off * S)) % S))] * 0.6 + grain2[i] * 0.4;
      const ring = 0.5 + 0.5 * Math.sin(g * 40);
      const nail = (dj > 0.006 && dj < 0.016 && Math.abs(fy - 0.5) > 0.22 && Math.abs(fy - 0.5) < 0.3) ? 1 : 0;
      const v = (0.82 + g * 0.25 + ring * 0.06) * (1 - smooth(0.6, 0.95, dirt[i]) * 0.18);
      let c = p.c.map(c => c * v);
      c = mixC(c, [30, 26, 22], gap * 0.85);
      if (nail) c = [55, 52, 50];
      t.set(i, c[0], c[1], c[2]);
      t.height[i] = (1 - gap) * (0.7 + g * 0.3) - nail * 0.3;
      t.rough[i] = 0.82 + g * 0.1;
    }
  }
};

G.crate = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#b48c5a');
  const grainH = fbm(S, 3, 4, r, { py: 120 }), grainV = fbm(S, 120, 4, r, { py: 3 }), dirt = fbm(S, 3, 4, r);
  const fw = 0.12, inner = 5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const inFrameH = v < fw || v > 1 - fw, inFrameV = u < fw || u > 1 - fw;
    let g, edge, tone;
    // Diagonalstrebe
    const dd = Math.abs((u - fw) - (v - fw)) / Math.SQRT2;
    const diag = !inFrameH && !inFrameV && dd < 0.06;
    if (inFrameH) { g = grainH[i]; edge = Math.min(Math.abs(v - (v < fw ? 0 : 1)), Math.abs(v - (v < fw ? fw : 1 - fw))); tone = 1.02; }
    else if (inFrameV) { g = grainV[i]; edge = Math.min(Math.abs(u - (u < fw ? 0 : 1)), Math.abs(u - (u < fw ? fw : 1 - fw))); tone = 1.0; }
    else if (diag) { g = grainH[i] * 0.5 + grainV[i] * 0.5; edge = 0.06 - dd; tone = 1.05; }
    else {
      const pf = (u - fw) / (1 - 2 * fw) * inner, pi = Math.floor(pf);
      g = grainV[(y * S + ((x + pi * 37) % S))]; edge = Math.min(pf - pi, 1 - (pf - pi)) / inner * (1 - 2 * fw); tone = 0.86 + ((pi * 13) % 5) * 0.03;
    }
    const gap = 1 - smooth(0.0, 0.006, edge);
    const ring = 0.5 + 0.5 * Math.sin(g * 36);
    const val = (0.8 + g * 0.25 + ring * 0.07) * tone * (1 - smooth(0.6, 0.95, dirt[i]) * 0.2);
    const nail = (inFrameH || inFrameV) && ((Math.abs(u - fw / 2) < 0.012 || Math.abs(u - 1 + fw / 2) < 0.012) && (Math.abs(v - fw / 2) < 0.012 || Math.abs(v - 1 + fw / 2) < 0.012));
    let c = base.map(c => c * val);
    c = mixC(c, [40, 30, 20], gap * 0.8);
    if (nail) c = [60, 58, 55];
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = (inFrameH || inFrameV || diag ? 1 : 0.6) * (1 - gap) + g * 0.15;
    t.rough[i] = 0.8 + g * 0.1;
  }
};

G.cardboard = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#ae8a5c');
  const noise = fbm(S, 24, 4, r), big = fbm(S, 2, 3, r), flute = fbm(S, 2, 2, r, { py: 200 });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const tape = Math.abs(v - 0.5) < 0.06;
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const dark = 1 - smooth(0.0, 0.03, edge) * 0.15 - 0.15;
    let c;
    if (tape) c = [196, 170, 120].map(k => k * (0.95 + noise[i] * 0.1));
    else c = base.map(k => k * (0.85 + noise[i] * 0.15 + (big[i] - 0.5) * 0.1) * (dark + 0.15));
    // Druckmarken (Pfeile) – einfache Balken
    const mark = !tape && v > 0.68 && v < 0.86 && ((u > 0.12 && u < 0.15) || (u > 0.2 && u < 0.23)) && v < 0.84 - Math.abs(u - 0.135) * 0;
    if (mark) c = [70, 52, 36];
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = flute[i] * 0.2 + (tape ? 0.3 : 0) + noise[i] * 0.1;
    t.rough[i] = tape ? 0.45 : 0.92;
  }
};

G.paint = (t, r, o) => { // lackiertes Metall
  const { S, n } = t;
  const base = hex(o.base || '#c9ccd0'), metalC = hex('#6a6c6f');
  const mott = fbm(S, 5, 5, r), grime = fbm(S, 3, 4, r), chip = fbm(S, 18, 4, r), fine = fbm(S, 128, 2, r);
  const scr = scratches(S, r, Math.round(S * 0.1), S * 0.03, S * 0.12);
  const streak = fbm(S, 40, 3, r, { py: 2 });
  t.metal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ch = smooth(0.8, 0.83, chip[i] * 0.75 + grime[i] * 0.25);
    const g = smooth(0.55, 0.9, grime[i]) * 0.16 + smooth(0.6, 0.95, streak[i]) * 0.1;
    const v = (0.95 + (mott[i] - 0.5) * 0.08 + (fine[i] - 0.5) * 0.04) * (1 - g);
    const k = 1 - ch, sc = scr[i] * 0.3 * k;
    t.set(i, (base[0] * v * k + metalC[0] * ch) * (1 - sc) + 225 * sc, (base[1] * v * k + metalC[1] * ch) * (1 - sc) + 227 * sc, (base[2] * v * k + metalC[2] * ch) * (1 - sc) + 230 * sc);
    t.height[i] = k * 0.4 + fine[i] * 0.15 - scr[i] * 0.3;
    t.rough[i] = lerp(0.48 + mott[i] * 0.12 + g * 0.4, 0.4, ch);
    t.metal[i] = ch * 0.9 + scr[i] * 0.25;
  }
};

G.rust = (t, r, o) => {
  const { S, n } = t;
  const pal = ['#6e3a1e', '#8a4a22', '#a35d2c', '#5a3220', '#7d4a2a', '#4a2c1c'].map(hex);
  const a = fbm(S, 4, 6, r), b = fbm(S, 16, 4, r), c2 = fbm(S, 64, 2, r);
  const pits = speckle(S, r, Math.round(n * 0.003), 0.6, 2.2);
  for (let i = 0; i < n; i++) {
    const k = a[i] * 0.6 + b[i] * 0.4;
    const idx = Math.min(pal.length - 2, Math.floor(k * (pal.length - 1)));
    const f = k * (pal.length - 1) - idx;
    let c = mixC(pal[idx], pal[idx + 1], f).map(v => v * (0.85 + c2[i] * 0.3));
    c = mixC(c, [40, 26, 18], pits[i] * 0.6);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = b[i] * 0.5 + c2[i] * 0.4 - pits[i] * 0.8;
    t.rough[i] = 0.9 + c2[i] * 0.08;
  }
};

G.corrugated = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#b9bcb8'), ribs = o.ribs || 16, trap = !!o.trapezoid;
  const streak = fbm(S, 24, 4, r, { py: 2 }), mott = fbm(S, 4, 5, r), fine = fbm(S, 96, 2, r);
  const rust = fbm(S, 8, 5, r), dent = fbm(S, 2, 3, r);
  const scr = scratches(S, r, Math.round(S * 0.06), S * 0.02, S * 0.1, { angle: 0 });
  t.metal = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, f = (x / S * ribs) % 1;
    let prof;
    if (trap) { // Trapezprofil (Container)
      prof = f < 0.3 ? 1 : f < 0.5 ? 1 - smooth(0.3, 0.5, f) : f < 0.8 ? 0 : smooth(0.8, 1.0, f);
    } else prof = 0.5 + 0.5 * Math.cos(f * Math.PI * 2);
    const trough = 1 - prof;
    const rs = smooth(0.55, 0.85, streak[i] * 0.7 + rust[i] * 0.3) * (0.4 + trough * 0.6) * (o.rustAmt ?? 1);
    const g = smooth(0.6, 0.95, mott[i]) * 0.12;
    let c = base.map(k => k * (0.94 + (fine[i] - 0.5) * 0.06 + prof * 0.05) * (1 - g));
    c = mixC(c, [128, 72, 40], rs * 0.75);
    c = mixC(c, [80, 82, 84], scr[i] * 0.5);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = prof * 1.0 + (dent[i] - 0.5) * 0.3 + fine[i] * 0.05;
    t.rough[i] = 0.55 + rs * 0.35 + g;
    t.metal[i] = o.metallic ? 0.6 * (1 - rs) : scr[i] * 0.5;
  }
};

G.galvanized = (t, r, o) => {
  const { S, n } = t;
  const w = worley(S, 28, r), fine = fbm(S, 64, 3, r), grime = fbm(S, 3, 4, r);
  const base = hex(o.base || '#a7abad');
  t.metal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cell = ((w.id[i] * 2654435761) >>> 0) / 4294967296;
    const g = smooth(0.6, 0.95, grime[i]) * 0.3;
    const v = (0.86 + cell * 0.2 + fine[i] * 0.05) * (1 - g);
    t.set(i, base[0] * v, base[1] * v, base[2] * v);
    t.height[i] = cell * 0.2 + fine[i] * 0.2;
    t.rough[i] = 0.42 + cell * 0.15 + g * 0.5;
    t.metal[i] = 0.85 - g;
  }
};

G.tread = (t, r, o) => {
  const { S, n } = t;
  const cells = o.cells || 16, base = hex(o.base || '#9fa3a6'), fine = fbm(S, 64, 3, r), grime = fbm(S, 3, 4, r);
  t.metal = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const fx = (x / S) * cells, fy = (y / S) * cells, cx = Math.floor(fx), cy = Math.floor(fy);
    let u = fx - cx - 0.5, v = fy - cy - 0.5;
    const flip = (cx + cy) % 2 ? 1 : -1;
    const a = 0.785 * flip, ru = u * Math.cos(a) - v * Math.sin(a), rv = u * Math.sin(a) + v * Math.cos(a);
    const d = Math.sqrt((ru / 0.36) ** 2 + (rv / 0.08) ** 2);
    const bump = 1 - smooth(0.7, 1.0, d);
    const g = smooth(0.55, 0.95, grime[i]) * 0.35;
    const vv = (0.85 + bump * 0.12 + fine[i] * 0.06) * (1 - g * (1 - bump));
    t.set(i, base[0] * vv, base[1] * vv, base[2] * vv);
    t.height[i] = bump + fine[i] * 0.05;
    t.rough[i] = 0.45 + g * 0.4 - bump * 0.1;
    t.metal[i] = 0.9 - g;
  }
};

G.grate = (t, r, o) => {
  const { S, n } = t;
  const cx = o.cx || 8, cy = o.cy || 24, base = hex(o.base || '#6d7174'), fine = fbm(S, 48, 3, r), rust = fbm(S, 4, 4, r);
  t.metal = new Float32Array(n); t.alpha = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const fx = (x / S) * cx, fy = (y / S) * cy;
    const ex = Math.min(fx % 1, 1 - (fx % 1)) * S / cx, ey = Math.min(fy % 1, 1 - (fy % 1)) * S / cy;
    const bar = ex < S / cx * 0.09 ? 1 : ey < S / cy * 0.12 ? 0.8 : 0;
    const rs = smooth(0.6, 0.9, rust[i]) * 0.5;
    let c = base.map(k => k * (0.85 + fine[i] * 0.25));
    c = mixC(c, [110, 66, 38], rs);
    t.set(i, c[0], c[1], c[2]);
    t.alpha[i] = bar > 0 ? 1 : 0;
    t.height[i] = bar;
    t.rough[i] = 0.55 + rs * 0.4;
    t.metal[i] = 0.8 * (1 - rs);
  }
};

G.hazard = (t, r, o) => {
  const { S, n } = t;
  const wear = fbm(S, 8, 5, r), fine = fbm(S, 96, 2, r), stripes = o.stripes || 4;
  t.metal = new Float32Array(n);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const s = ((x + y) / S * stripes) % 1 < 0.5;
    const w = smooth(0.7, 0.74, wear[i]);
    let c = s ? [232, 178, 22] : [28, 28, 30];
    c = c.map(k => k * (0.9 + fine[i] * 0.15));
    c = mixC(c, [120, 122, 124], w);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = (1 - w) * 0.3 + fine[i] * 0.1;
    t.rough[i] = 0.55 + w * 0.1;
    t.metal[i] = w * 0.8;
  }
};

G.sand = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#d2b98f');
  const big = fbm(S, 3, 5, r), fine = new Float32Array(n), warp = fbm(S, 4, 3, r), peb = speckle(S, r, Math.round(n * 0.0012), 0.6, 2);
  addNoise(fine, S, S / 2, S / 2, 1, r); normalizeField(fine);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const rip = 0.5 + 0.5 * Math.sin((y / S + warp[i] * 0.35) * Math.PI * 2 * (o.ripples ?? 14));
    const v = 0.9 + (big[i] - 0.5) * 0.2 + (fine[i] - 0.5) * 0.12 - rip * 0.04;
    let c = base.map(k => k * v);
    c = mixC(c, [140, 120, 96], peb[i] * 0.6);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = rip * 0.3 * (o.ripples === 0 ? 0 : 1) + fine[i] * 0.35 + peb[i] * 0.5;
    t.rough[i] = 0.96;
  }
};

G.dirt = (t, r, o) => {
  const { S, n } = t;
  const pal = (o.palette || ['#7a6148', '#6b543e', '#86705a', '#5e4a38']).map(hex);
  const a = fbm(S, 4, 6, r), b = fbm(S, 24, 3, r), damp = fbm(S, 3, 4, r);
  const peb = speckle(S, r, Math.round(n * 0.003), 0.8, 2.6), w = worley(S, 40, r);
  for (let i = 0; i < n; i++) {
    const k = clamp01(a[i] * 0.7 + b[i] * 0.3), idx = Math.min(pal.length - 2, Math.floor(k * (pal.length - 1))), f = k * (pal.length - 1) - idx;
    const d = smooth(0.62, 0.85, damp[i]);
    let c = mixC(pal[idx], pal[idx + 1], f).map(v => v * (0.9 + b[i] * 0.2) * (1 - d * 0.25));
    const pv = peb[i] * (0.6 + ((w.id[i] * 31) % 10) / 25);
    c = mixC(c, [150, 140, 125], pv * 0.7);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = a[i] * 0.3 + b[i] * 0.3 + pv * 0.8;
    t.rough[i] = 0.95 - d * 0.2;
  }
};

G.gravel = (t, r, o) => {
  const { S, n } = t;
  const w = worley(S, o.cells || 48, r, { jitter: 1 });
  const pal = (o.palette || ['#8e8b85', '#77736c', '#a19c93', '#6a665f', '#958c80']).map(hex);
  const fine = fbm(S, 64, 2, r), cols = []; for (let i = 0; i < 997; i++) cols.push(jitterC(pick(pal, r), r, 0.25));
  for (let i = 0; i < n; i++) {
    const e = w.f2[i] - w.f1[i], st = smooth(0.02, 0.18, e);
    const c = mixC([58, 52, 46], cols[w.id[i] % 997].map(k => k * (0.85 + fine[i] * 0.2)), st);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = st * (0.5 + Math.min(e, 0.5)) + fine[i] * 0.1;
    t.rough[i] = 0.9;
  }
};

G.grass = (t, r, o) => {
  const { S, n } = t;
  const pal = (o.palette || ['#5b6e34', '#6c7f3c', '#4e602d', '#7d8a45', '#8a8a4c']).map(hex);
  const a = fbm(S, 3, 5, r), blades = fbm(S, 96, 2, r, { py: 24 }), blades2 = fbm(S, 128, 2, r, { py: 40 });
  const dirtM = fbm(S, 4, 5, r), dry = fbm(S, 2, 4, r);
  for (let i = 0; i < n; i++) {
    const k = clamp01(a[i]), idx = Math.min(pal.length - 2, Math.floor(k * (pal.length - 1))), f = k * (pal.length - 1) - idx;
    const bl = blades[i] * 0.6 + blades2[i] * 0.4;
    let c = mixC(pal[idx], pal[idx + 1], f).map(v => v * (0.7 + bl * 0.5));
    c = mixC(c, [150, 140, 90], smooth(0.6, 0.9, dry[i]) * 0.35);
    const d = smooth(0.7, 0.8, dirtM[i]);
    c = mixC(c, [104, 86, 64].map(v => v * (0.85 + bl * 0.2)), d);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = bl * (1 - d * 0.6);
    t.rough[i] = 0.9;
  }
};

G.tiles = (t, r, o) => {
  const { S, n } = t;
  const cells = o.cells || 6, base = (o.palette || ['#d9d2c3', '#d1c9b8', '#e0d9cb']).map(hex), grout = hex(o.grout || '#8f877a');
  const noise = fbm(S, 32, 3, r), big = fbm(S, 3, 4, r), scr = scratches(S, r, S * 0.05, S * 0.02, S * 0.08);
  const tones = []; for (let i = 0; i < cells * cells; i++) tones.push(jitterC(pick(base, r), r, o.vary ?? 0.08));
  const cw = S / cells, gw = Math.max(1, cw * (o.groutW ?? 0.035));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, cx = Math.floor(x / cw), cy = Math.floor(y / cw);
    const ex = Math.min(x - cx * cw, (cx + 1) * cw - x), ey = Math.min(y - cy * cw, (cy + 1) * cw - y), e = Math.min(ex, ey);
    const tile = smooth(gw * 0.5, gw * 0.5 + 1.5, e);
    let c = tones[(cy % cells) * cells + (cx % cells)].map(k => k * (0.94 + noise[i] * 0.1 + (big[i] - 0.5) * 0.08));
    if (o.pattern) { // Zementfliesen-Muster
      const u = ((x - cx * cw) / cw) * 2 - 1, v = ((y - cy * cw) / cw) * 2 - 1, au = Math.abs(u), av = Math.abs(v);
      const dia = au + av, rad = Math.hypot(au - 1, av - 1), cir = Math.hypot(u, v);
      const p1 = hex(o.pattern[0]), p2 = hex(o.pattern[1]);
      if (dia < 0.42) c = p1; else if (dia < 0.52) c = [236, 230, 214];
      else if (Math.abs(cir - 0.78) < 0.07) c = p2;
      if (rad < 0.38) c = p1; else if (rad < 0.46) c = [236, 230, 214];
      if (Math.abs(u) < 0.04 || Math.abs(v) < 0.04) if (dia < 0.9 && dia > 0.52) c = p2;
      c = c.map(k => k * (0.93 + noise[i] * 0.1));
    }
    c = mixC(grout.map(k => k * (0.9 + noise[i] * 0.2)), c, tile);
    c = mixC(c, c.map(k => k * 0.85), scr[i] * 0.4);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = tile * 0.6 + noise[i] * 0.05;
    t.rough[i] = lerp(0.85, o.glossy ?? 0.3, tile) + scr[i] * 0.2;
  }
};

G.glass = (t, r, o) => {
  const { S, n } = t;
  const smudge = fbm(S, 4, 5, r), fine = fbm(S, 64, 2, r), base = hex(o.base || '#26323a');
  for (let i = 0; i < n; i++) {
    const s = smooth(0.55, 0.9, smudge[i]);
    const v = 0.9 + fine[i] * 0.1 + s * 0.25;
    t.set(i, base[0] * v, base[1] * v, base[2] * v);
    t.height[i] = fine[i] * 0.02;
    t.rough[i] = 0.04 + s * 0.22;
  }
};

G.burlap = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#a3916a'), k = o.weave || 96;
  const noise = fbm(S, 16, 4, r), big = fbm(S, 3, 3, r), fibers = fbm(S, 128, 2, r, { py: 32 });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const wx = Math.sin((x / S) * Math.PI * 2 * k), wy = Math.sin((y / S) * Math.PI * 2 * k);
    const weave = 0.5 + 0.5 * (((Math.floor(x / S * k * 2) + Math.floor(y / S * k * 2)) % 2) ? wx : wy);
    const v = (0.78 + weave * 0.2 + fibers[i] * 0.1) * (0.9 + (noise[i] - 0.5) * 0.2) * (0.92 + big[i] * 0.12);
    t.set(i, base[0] * v, base[1] * v, base[2] * v);
    t.height[i] = weave * 0.6 + noise[i] * 0.3;
    t.rough[i] = 0.95;
  }
};

G.tarp = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#d8dad6'), k = o.weave || 160;
  const folds = fbm(S, 3, 3, r, { py: 1 }), noise = fbm(S, 8, 4, r), grime = fbm(S, 3, 4, r);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const weave = 0.5 + 0.25 * (Math.sin(x / S * Math.PI * 2 * k) + Math.sin(y / S * Math.PI * 2 * k));
    const g = smooth(0.55, 0.9, grime[i]) * 0.22;
    const v = (0.86 + weave * 0.08 + (noise[i] - 0.5) * 0.12 + (folds[i] - 0.5) * 0.15) * (1 - g);
    t.set(i, base[0] * v, base[1] * v, base[2] * v);
    t.height[i] = folds[i] * 1.2 + weave * 0.1;
    t.rough[i] = 0.75 + g * 0.2;
  }
};

G.stripes = (t, r, o) => { // Markisen-Atlas: 4 Bänder mit Streifendesigns
  const { S, n } = t;
  const designs = o.designs;
  const noise = fbm(S, 8, 4, r), weave = fbm(S, 128, 2, r);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, band = Math.floor(y / S * designs.length), d = designs[band];
    const u = x / S, idx = Math.floor(u * d.count) % d.colors.length;
    const c = hex(d.colors[idx]).map(k => k * (0.88 + weave[i] * 0.1 + (noise[i] - 0.5) * 0.12));
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = weave[i] * 0.3 + noise[i] * 0.4;
    t.rough[i] = 0.85;
  }
};

G.rubber = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#202022'), noise = fbm(S, 64, 3, r), big = fbm(S, 3, 3, r), gran = speckle(S, r, o.granules ? Math.round(n * 0.03) : 0, 0.5, 1.4);
  const gc = o.granules ? hex(o.granules) : null;
  for (let i = 0; i < n; i++) {
    const v = 0.85 + noise[i] * 0.25 + (big[i] - 0.5) * 0.1;
    let c = base.map(k => k * v);
    if (gc) c = mixC(c, gc, gran[i] * 0.6);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = noise[i] * 0.4 + gran[i] * 0.3;
    t.rough[i] = 0.82 + noise[i] * 0.1;
  }
};

G.gunmetal = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#3b3e43'), brushed = fbm(S, 2, 4, r, { py: 200 }), wear = fbm(S, 6, 5, r), fine = fbm(S, 128, 2, r);
  t.metal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = smooth(0.72, 0.85, wear[i]);
    const v = 0.88 + brushed[i] * 0.18 + w * 0.35;
    t.set(i, base[0] * v, base[1] * v, base[2] * v * 1.02);
    t.height[i] = brushed[i] * 0.2 + fine[i] * 0.1;
    t.rough[i] = 0.42 - w * 0.12 + brushed[i] * 0.08;
    t.metal[i] = 0.82 + w * 0.15;
  }
};

G.polymer = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#2b2c2e'), w = worley(S, 90, r), noise = fbm(S, 8, 4, r);
  for (let i = 0; i < n; i++) {
    const st = smooth(0.0, 0.35, w.f1[i]);
    const v = 0.9 + st * 0.12 + (noise[i] - 0.5) * 0.08;
    t.set(i, base[0] * v, base[1] * v, base[2] * v);
    t.height[i] = 1 - st;
    t.rough[i] = 0.6 + st * 0.1;
  }
};

G.woodStock = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#6e4027'), grain = fbm(S, 2, 5, r, { py: 64 }), fine = fbm(S, 3, 3, r, { py: 200 });
  for (let i = 0; i < n; i++) {
    const ring = 0.5 + 0.5 * Math.sin(grain[i] * 60);
    const v = 0.75 + ring * 0.25 + fine[i] * 0.12;
    t.set(i, base[0] * v * 1.04, base[1] * v, base[2] * v * 0.95);
    t.height[i] = ring * 0.2 + fine[i] * 0.2;
    t.rough[i] = 0.38 + ring * 0.12;
  }
};

/**
 * Rinde. o.rings > 0: Palmstamm – waagerechte Blattnarben-Ringe (je Kachel o.rings), heller Wulst über einer
 * schattigen Kerbe, senkrechte Fasern. Sonst Borke (Olive/Laubbaum): senkrechte Platten mit tiefen Furchen.
 * Albedo bewusst mittelhell (Stämme stehen in der Sonne; die Vertexfarbe tönt nur noch leicht).
 */
G.bark = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#857a6b'), dark = hex(o.dark || '#463d33'), light = hex(o.light || '#a69c8c');
  const mott = fbm(S, 3, 5, r), fib = fbm(S, 48, 3, r, { py: 4 }), fine = fbm(S, 96, 2, r);
  const rings = o.rings | 0;
  if (rings > 0) {
    // Palmstamm: je Ring eine Blattnarbe – schattige Kerbe unten, gewölbter Wulst darüber, faserige Fläche;
    // Ringe laufen leicht wellig und setzen stellenweise aus (Narben umfassen den Stamm nicht überall gleich)
    const wob = fbm(S, 5, 3, r, { py: 2 }), brk = fbm(S, 6, 3, r, { py: rings });
    const ring = []; for (let k = 0; k < rings; k++) ring.push({ tone: (r() - 0.5) * 0.18, w: 0.12 + r() * 0.1 });
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const fy = (y / S) * rings + (wob[i] - 0.5) * 0.5;
      const k = ((Math.floor(fy) % rings) + rings) % rings, f = fy - Math.floor(fy), R = ring[k];
      const depth = 0.55 + 0.45 * smooth(0.25, 0.6, brk[i]);
      const groove = (1 - smooth(0, R.w, f)) * depth;
      const bulge = smooth(R.w * 0.5, R.w + 0.3, f) * (1 - smooth(0.55, 1, f) * 0.6);
      const fiber = fib[i] * 0.65 + fine[i] * 0.35;
      let c = mixC(base, light, bulge * 0.5 + (fiber - 0.5) * 0.6);
      c = c.map(v => v * (0.88 + mott[i] * 0.24 + R.tone) * (1 - (1 - f) * 0.12));
      c = mixC(c, dark, groove * 0.9);
      t.set(i, c[0], c[1], c[2]);
      t.height[i] = bulge * 0.7 - groove * 0.7 + fiber * 0.35;
      t.rough[i] = 0.86 + fine[i] * 0.1;
    }
    return;
  }
  // Borke: lange, mäandernde Längsrisse (Höhenlinien eines senkrecht gestreckten Rauschens) zwischen rauen
  // Platten; ein zweites Feld verzweigt sie. Rissbreite über den Gradienten in Pixeln gemessen → gleichmäßig breit.
  const f1 = fbm(S, 7, 4, r, { py: 1 }), f2 = fbm(S, 11, 3, r, { py: 2 });
  const lines = o.lines || 3, px = S / 256;
  const distPx = (f, x, y, k, off) => {
    const i = y * S + x, xm = y * S + (x - 1 + S) % S, xp = y * S + (x + 1) % S, ym = ((y - 1 + S) % S) * S + x, yp = ((y + 1) % S) * S + x;
    const g = Math.hypot(f[xp] - f[xm], f[yp] - f[ym]) * 0.5 * k + 1e-6;
    const a = (f[i] * k + off) % 1;
    return Math.min(a, 1 - a) / g;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const d1 = distPx(f1, x, y, lines, 0), d2 = distPx(f2, x, y, lines + 1, 0.37);
    const furrow = Math.max(1 - smooth(0.6 * px, 2.6 * px, d1), (1 - smooth(0.4 * px, 1.5 * px, d2)) * 0.75);
    const plate = smooth(1 * px, 9 * px, Math.min(d1, d2 * 1.5));
    const fiber = fib[i] * 0.6 + fine[i] * 0.4;
    let c = mixC(base, light, plate * 0.35 + (fiber - 0.5) * 0.5);
    c = c.map(v => v * (0.86 + mott[i] * 0.26));
    c = mixC(c, dark, furrow * 0.9);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = plate * 0.6 - furrow * 0.6 + fiber * 0.35;
    t.rough[i] = 0.88 + fine[i] * 0.1;
  }
};

G.camo = (t, r, o) => {
  const { S, n } = t;
  const cols = o.colors.map(hex);
  const layers = [fbm(S, 4, 5, r), fbm(S, 5, 5, r), fbm(S, 6, 4, r)];
  const dots = speckle(S, r, Math.round(n * 0.0006), 2, 5), weave = fbm(S, 128, 2, r), k = 140;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    let c = cols[0];
    if (layers[0][i] > 0.55) c = cols[1];
    if (layers[1][i] > 0.62) c = cols[2];
    if (layers[2][i] > 0.7 || dots[i] > 0.5) c = cols[3];
    const wv = 0.5 + 0.25 * (Math.sin(x / S * Math.PI * 2 * k) + Math.sin(y / S * Math.PI * 2 * k));
    const v = 0.88 + wv * 0.1 + weave[i] * 0.06;
    t.set(i, c[0] * v, c[1] * v, c[2] * v);
    t.height[i] = wv * 0.5 + weave[i] * 0.3;
    t.rough[i] = 0.92;
  }
};

G.skin = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#c99d80'), mott = fbm(S, 6, 5, r), pores = fbm(S, 160, 2, r), red = fbm(S, 3, 4, r);
  for (let i = 0; i < n; i++) {
    const v = 0.92 + (mott[i] - 0.5) * 0.1 + (pores[i] - 0.5) * 0.06;
    const rr = smooth(0.5, 0.9, red[i]) * 10;
    t.set(i, base[0] * v + rr, base[1] * v, base[2] * v);
    t.height[i] = pores[i] * 0.3;
    t.rough[i] = 0.55 + pores[i] * 0.1;
  }
};

G.epoxy = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#7d8a84'), mott = fbm(S, 3, 5, r), fine = fbm(S, 128, 2, r), wear = fbm(S, 6, 5, r);
  const scr = scratches(S, r, S * 0.15, S * 0.03, S * 0.2);
  for (let i = 0; i < n; i++) {
    const w = smooth(0.66, 0.8, wear[i]) * 0.5;
    const v = 0.92 + (mott[i] - 0.5) * 0.12 + (fine[i] - 0.5) * 0.04;
    let c = base.map(k => k * v);
    c = mixC(c, [138, 136, 130], w);
    c = mixC(c, c.map(k => k * 1.2), scr[i] * 0.5);
    t.set(i, c[0], c[1], c[2]);
    t.height[i] = fine[i] * 0.1 - scr[i] * 0.2 - w * 0.2;
    t.rough[i] = 0.32 + w * 0.4 + scr[i] * 0.2 + (mott[i] - 0.5) * 0.1;
  }
};

G.panelWall = (t, r, o) => { // Akustikpaneele (Schießanlage)
  const { S, n } = t;
  const base = hex(o.base || '#c3c9cc'), pw = o.pw || 2, ph = o.ph || 4, noise = fbm(S, 8, 4, r), fine = fbm(S, 96, 2, r);
  const holes = o.holes ?? 48;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const fx = (x / S) * pw, fy = (y / S) * ph;
    const ex = Math.min(fx % 1, 1 - (fx % 1)) * S / pw, ey = Math.min(fy % 1, 1 - (fy % 1)) * S / ph;
    const seam = 1 - smooth(0.5, 2, Math.min(ex, ey));
    const hx = (x / S * holes) % 1 - 0.5, hy = (y / S * holes) % 1 - 0.5;
    const hole = holes ? (1 - smooth(0.12, 0.2, Math.hypot(hx, hy))) * smooth(4, 10, Math.min(ex, ey)) : 0;
    const v = (0.93 + (noise[i] - 0.5) * 0.08 + fine[i] * 0.04) * (1 - seam * 0.45 - hole * 0.35);
    t.set(i, base[0] * v, base[1] * v, base[2] * v);
    t.height[i] = 1 - seam - hole * 0.6;
    t.rough[i] = 0.7;
  }
};

G.flat = (t, r, o) => {
  const { S, n } = t;
  const base = hex(o.base || '#ffffff'), noise = fbm(S, 8, 3, r);
  for (let i = 0; i < n; i++) {
    const v = 0.97 + noise[i] * 0.03;
    t.set(i, base[0] * v, base[1] * v, base[2] * v);
    t.height[i] = noise[i] * 0.05;
    t.rough[i] = o.rough ?? 0.5;
  }
};

G.waterNormal = (t, r) => {
  const { S, n } = t;
  const a = fbm(S, 6, 6, r, { gain: 0.55 }), b = fbm(S, 3, 3, r, { py: 9 });
  for (let i = 0; i < n; i++) { t.height[i] = a[i] * 0.8 + b[i] * 0.4; t.set(i, 40, 80, 90); t.rough[i] = 0.05; }
};

// ---------------------------------------------------------------------------
// Materialtabelle
// ---------------------------------------------------------------------------
// tex: Textur-Gruppe (gen + Parameter), tile: Meter pro Kachel, surface: Oberflächentyp für Treffer/Schritte
export const TEX = {
  concrete:       { gen: 'concrete', o: { base: '#a3a19a' }, normal: 1.4 },
  concrete_dark:  { gen: 'concrete', o: { base: '#6f6e6a' }, normal: 1.4 },
  concrete_panel: { gen: 'concrete', o: { base: '#a8a59e', panels: [2, 2] }, normal: 1.8 },
  asphalt:        { gen: 'asphalt', o: {}, normal: 1.3 },
  // peel 0: keine großen Ausbrüche in der Kachel (wiederholten sich alle 3 m) – MapBuilder verstreut sie als Decals
  // Schmutzflecken halbiert: ihr Rhythmus (Kachel) war an langen Wänden deutlich zu sehen
  plaster_warm:   { gen: 'plaster', o: { base: '#dcc29a', stone: '#a08a6c', peel: 0, dirt: 0.5 }, normal: 2 },
  plaster_white:  { gen: 'plaster', o: { base: '#ece7dc', stone: '#a8957a', peel: 0, dirt: 0.5 }, normal: 2 },
  brick:          { gen: 'brick', o: {}, normal: 3.5 },
  brick_dark:     { gen: 'brick', o: { palette: ['#5e3a2e', '#6a4232', '#523428', '#74493a', '#4c2f25'], mortar: '#7d776e' }, normal: 3.5 },
  stone_wall:     { gen: 'stoneWall', o: {}, normal: 4 },
  cobble:         { gen: 'cobble', o: {}, normal: 4 },
  paving:         { gen: 'slabs', o: {}, normal: 3 },
  roof_tiles:     { gen: 'roofTiles', o: {}, normal: 5 },
  wood_planks:    { gen: 'planks', o: {}, normal: 3 },
  wood_dark:      { gen: 'planks', o: { palette: ['#5a4634', '#4e3c2c', '#62503c', '#45362a'], rows: 10 }, normal: 3 },
  wood_paint:     { gen: 'planks', o: { palette: ['#dcd9d2', '#d2cfc8', '#e4e1da', '#cbc7bf'], rows: 12 }, normal: 3 }, // hell: Tönung = Lackfarbe
  wood_crate:     { gen: 'crate', o: {}, normal: 3 },
  wood_stock:     { gen: 'woodStock', o: {}, normal: 1.5 },
  bark:           { gen: 'bark', o: { base: '#857c6f', dark: '#433b32', light: '#a8a092', lines: 3 }, normal: 4 },
  bark_palm:      { gen: 'bark', o: { base: '#8f8270', dark: '#4a4034', light: '#b0a38c', rings: 12 }, normal: 3.5 },
  cardboard:      { gen: 'cardboard', o: {}, normal: 1.5 },
  metal_painted:  { gen: 'paint', o: {}, normal: 1.5 },
  metal_rust:     { gen: 'rust', o: {}, normal: 3 },
  metal_corrugated: { gen: 'corrugated', o: { ribs: 16, rustAmt: 1 }, normal: 4 },
  metal_galvanized: { gen: 'galvanized', o: {}, normal: 1 },
  metal_tread:    { gen: 'tread', o: {}, normal: 5 },
  metal_grate:    { gen: 'grate', o: {}, normal: 2 },
  hazard:         { gen: 'hazard', o: {}, normal: 1 },
  container:      { gen: 'corrugated', o: { base: '#e6e6e2', ribs: 8, trapezoid: true, rustAmt: 0.8 }, normal: 3.6 },
  sand:           { gen: 'sand', o: {}, normal: 2 },
  dirt:           { gen: 'dirt', o: {}, normal: 3 },
  gravel:         { gen: 'gravel', o: { cells: 30, palette: ['#9a958c', '#8c877e', '#a7a197', '#7f7a72', '#a09789'] }, normal: 3 },
  grass:          { gen: 'grass', o: {}, normal: 2.5 },
  tiles:          { gen: 'tiles', o: {}, normal: 2 },
  tiles_terracotta: { gen: 'tiles', o: { cells: 5, palette: ['#b56a45', '#a95f3d', '#bd7450', '#9f573a'], grout: '#8a7a68', vary: 0.18, glossy: 0.55, groutW: 0.05 }, normal: 2.5 },
  tiles_pattern:  { gen: 'tiles', o: { cells: 8, palette: ['#ece4d2'], grout: '#b2a894', pattern: ['#2f5f8a', '#b8643c'], vary: 0.04, glossy: 0.4, groutW: 0.02 }, normal: 1.5 },
  glass:          { gen: 'glass', o: {}, normal: 0.3 },
  sandbag:        { gen: 'burlap', o: { base: '#c4b48c' }, normal: 3 },
  tarp:           { gen: 'tarp', o: {}, normal: 2.5 },
  awning:         { gen: 'stripes', o: { designs: [
    { count: 10, colors: ['#c8402f', '#efe6d2'] }, { count: 12, colors: ['#2f6f9a', '#efe9da'] },
    { count: 8, colors: ['#3f7a4a', '#ece4cf'] }, { count: 14, colors: ['#e0a32c', '#f1ead6', '#c8402f', '#f1ead6'] }] }, normal: 1.5 },
  rubber:         { gen: 'rubber', o: {}, normal: 1 },
  rubber_floor:   { gen: 'rubber', o: { base: '#2c2f33', granules: '#5f6b74' }, normal: 1.5 },
  gunmetal:       { gen: 'gunmetal', o: {}, normal: 0.8 },
  polymer:        { gen: 'polymer', o: {}, normal: 1 },
  fabric_camo_a:  { gen: 'camo', o: { colors: ['#5d6a74', '#3f4a54', '#7c8790', '#2a3036'] }, normal: 1.5 },
  fabric_camo_b:  { gen: 'camo', o: { colors: ['#9b8461', '#6f5c42', '#b9a37c', '#4e4130'] }, normal: 1.5 },
  skin:           { gen: 'skin', o: {}, normal: 0.6 },
  epoxy:          { gen: 'epoxy', o: {}, normal: 0.8 },
  epoxy_blue:     { gen: 'epoxy', o: { base: '#5d7488' }, normal: 0.8 },
  panel_wall:     { gen: 'panelWall', o: {}, normal: 2 },
  white:          { gen: 'flat', o: { base: '#f2f2f0', rough: 0.55 }, normal: 0.2 },
  water:          { gen: 'waterNormal', o: {}, normal: 4 },
};


/** Erzeugt Albedo-, Normal- und Roughness/Metalness-Daten einer Texturgruppe. */
export function generateTexture(texName, S) {
  const def = TEX[texName];
  const t = new TexData(S);
  G[def.gen](t, makeRng(hashString(texName) ^ 0x9e3779b9), def.o || {});
  if (t.alpha) for (let i = 0; i < t.n; i++) t.albedo[i * 4 + 3] = t.alpha[i] * 255;
  // Normalmap aus Höhenfeld (zentrale Differenzen, wrap)
  const nrm = new Uint8Array(t.n * 4), h = t.height, k = (def.normal || 2) * S / 512;
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S, yr = y * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const dx = (h[yr + xp] - h[yr + xm]) * k, dy = (h[yp + x] - h[ym + x]) * k;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), o = (yr + x) * 4;
      nrm[o] = (-dx * il * 0.5 + 0.5) * 255; nrm[o + 1] = (-dy * il * 0.5 + 0.5) * 255; nrm[o + 2] = (il * 0.5 + 0.5) * 255; nrm[o + 3] = 255;
    }
  }
  // Roughness (G) + Metalness (B)
  const rm = new Uint8Array(t.n * 4);
  for (let i = 0; i < t.n; i++) {
    const o = i * 4;
    rm[o] = 255; rm[o + 1] = clamp01(t.rough[i]) * 255; rm[o + 2] = t.metal ? clamp01(t.metal[i]) * 255 : 0; rm[o + 3] = 255;
  }
  return { albedo: t.albedo, normal: nrm, rm, hasMetal: !!t.metal, hasAlpha: !!t.alpha, S };
}
