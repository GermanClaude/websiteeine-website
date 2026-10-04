// NULLPUNKT — Prozedurale Effekt-Texturen (Canvas, einmalig erzeugt, Cache über Matches hinweg):
//   Partikel-Atlas 4×4 (je 128 px): weiche Wolke, 2× Rauch, Funke, Stern-Blitz, Flammenzunge, Splitter,
//   Tropfen, 8 Feuerball-Phasen (Sprite-Sheet). Einschuss-Atlas 4×2: Beton (2), Metall, Holz, Erde,
//   Glas, Brandfleck, Putz/Fliese.
import * as THREE from 'three';

export const CELL = {
  SOFT: 0, SMOKE_A: 1, SMOKE_B: 2, SPARK: 3, STAR: 4, FLAME: 5, CHIP: 6, DROP: 7, FIRE: 8, FIRE_FRAMES: 8,
};
export const ATLAS_GRID = 4;

export const DECAL = { CONCRETE: 0, CONCRETE_B: 1, METAL: 2, WOOD: 3, SOFT: 4, GLASS: 5, SCORCH: 6, PLASTER: 7 };
export const DECAL_GRID = [4, 2];

/* ------------------------------------------------------------ Rauschen */

function makeNoise(seed) {
  const p = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = rnd();
  const fade = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = val[p[p[X] + Y]], b = val[p[p[X + 1] + Y]];
    const c = val[p[p[X] + Y + 1]], d = val[p[p[X + 1] + Y + 1]];
    const u = fade(xf), v = fade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, oct = 4) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { sum += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm;
  };
}

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Zelle pixelweise füllen: fn(u, v) → [r, g, b, a] (0..1), u/v in −1..1. */
function paintCell(ctx, cx, cy, size, fn) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const out = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      fn(u, v, out);
      const i = (y * size + x) * 4;
      d[i] = Math.max(0, Math.min(255, out[0] * 255));
      d[i + 1] = Math.max(0, Math.min(255, out[1] * 255));
      d[i + 2] = Math.max(0, Math.min(255, out[2] * 255));
      d[i + 3] = Math.max(0, Math.min(255, out[3] * 255));
    }
  }
  ctx.putImageData(img, cx, cy);
}

/* ------------------------------------------------------------ Partikel-Atlas */

let particleTex = null;
let decalTex = null;

export function getParticleAtlas() {
  if (particleTex) return particleTex;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S * ATLAS_GRID;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const at = (cell) => [(cell % ATLAS_GRID) * S, Math.floor(cell / ATLAS_GRID) * S];
  const n1 = makeNoise(7), n2 = makeNoise(31), n3 = makeNoise(97);

  // Weiche Wolke
  paintCell(ctx, ...at(CELL.SOFT), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const a = Math.pow(Math.max(0, 1 - d), 2.2);
    o[0] = o[1] = o[2] = 1; o[3] = a;
  });
  // Rauch A/B: wolkig, Licht von oben
  const smoke = (nz, off) => (u, v, o) => {
    const d = Math.hypot(u, v);
    const n = nz(u * 2.2 + off, v * 2.2 + off * 0.7, 5);
    const m = nz(u * 5 + off * 2, v * 5 - off, 3);
    const edge = 1 - sstep(0.35, 1.0, d + (n - 0.5) * 0.75);
    const a = edge * (0.45 + 0.55 * n) * (0.85 + 0.15 * m);
    const lit = 0.72 + 0.28 * (0.5 - v * 0.5) + (m - 0.5) * 0.2;
    o[0] = o[1] = o[2] = lit; o[3] = Math.max(0, a);
  };
  paintCell(ctx, ...at(CELL.SMOKE_A), S, smoke(n1, 3.1));
  paintCell(ctx, ...at(CELL.SMOKE_B), S, smoke(n2, 11.7));
  // Funke: harter Kern + Glühen
  paintCell(ctx, ...at(CELL.SPARK), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const core = 1 - sstep(0.08, 0.3, d);
    const glow = Math.exp(-d * 4.5) * 0.6;
    o[0] = o[1] = o[2] = 1; o[3] = Math.min(1, core + glow) * (1 - sstep(0.85, 1, d));
  });
  // Stern-Blitz (Mündungsfeuer frontal, Glanz): Kern + 4 Strahlen + 2 dünne
  paintCell(ctx, ...at(CELL.STAR), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const core = Math.exp(-d * 6);
    const ray = (x, y, w) => Math.max(0, 1 - Math.abs(y) / w) ** 2 * Math.max(0, 1 - Math.abs(x)) ** 1.5;
    const r1 = ray(u, v, 0.07) + ray(v, u, 0.07);
    const r2 = 0.5 * (ray((u + v) * 0.7071, (u - v) * 0.7071, 0.035) + ray((u - v) * 0.7071, (u + v) * 0.7071, 0.035));
    const a = Math.min(1, core * 1.3 + r1 * 0.9 + r2 * 0.6) * (1 - sstep(0.9, 1, d));
    o[0] = o[1] = o[2] = 1; o[3] = a;
  });
  // Flammenzunge entlang +x (Mündungsfeuer seitlich, gestreckt)
  paintCell(ctx, ...at(CELL.FLAME), S, (u, v, o) => {
    const t = (u + 1) * 0.5; // 0 = Mündung, 1 = Spitze
    const w = 0.55 * Math.pow(Math.sin(Math.PI * Math.pow(Math.max(0.001, t), 0.55)), 1.2) * (1 - t * 0.35);
    const n = n3(t * 6, v * 3, 3);
    const a = (1 - sstep(w * 0.4, w + 0.05, Math.abs(v) + (n - 0.5) * 0.15)) * (1 - sstep(0.75, 1, t)) * (0.7 + 0.3 * n);
    o[0] = o[1] = o[2] = 1; o[3] = Math.max(0, a);
  });
  // Splitter: unregelmäßiges Vieleck
  {
    const [cx, cy] = at(CELL.CHIP);
    ctx.save();
    ctx.translate(cx + S / 2, cy + S / 2);
    ctx.beginPath();
    const pts = [[-0.8, -0.35], [-0.2, -0.85], [0.55, -0.6], [0.85, 0.1], [0.35, 0.8], [-0.45, 0.6], [-0.9, 0.15]];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * S * 0.42, y * S * 0.42) : ctx.moveTo(x * S * 0.42, y * S * 0.42)));
    ctx.closePath();
    const g = ctx.createLinearGradient(-S * 0.4, -S * 0.4, S * 0.4, S * 0.4);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#a8a8a8');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
  // Tropfen: rund, weicher Rand, Glanzpunkt
  paintCell(ctx, ...at(CELL.DROP), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const a = 1 - sstep(0.55, 0.8, d);
    const hl = Math.exp(-Math.hypot(u + 0.25, v + 0.25) * 9) * 0.5;
    o[0] = o[1] = o[2] = Math.min(1, 0.82 + hl); o[3] = a;
  });
  // Feuerball-Phasen: heiß → ausbrennend
  for (let f = 0; f < CELL.FIRE_FRAMES; f++) {
    const t = f / (CELL.FIRE_FRAMES - 1);
    paintCell(ctx, ...at(CELL.FIRE + f), S, (u, v, o) => {
      const d = Math.hypot(u, v);
      const n = n1(u * 2.4 + t * 1.7, v * 2.4 - t * 2.3, 5);
      const m = n2(u * 4.6 - t * 3, v * 4.6 + t, 3);
      let heat = (1.05 - d * (1.15 + t * 0.4)) + (n - 0.5) * (0.9 + t * 0.6) + (m - 0.5) * 0.3 - t * 0.55;
      heat = Math.max(0, heat);
      const a = sstep(0.04, 0.32, heat) * (1 - sstep(0.88, 1.0, d));
      // Farbrampe: weißgelb → orange → rot → dunkel
      const h = Math.min(1, heat * 1.25);
      o[0] = Math.min(1, 0.55 + h * 0.9);
      o[1] = Math.min(1, 0.12 + h * h * 0.95);
      o[2] = Math.min(1, 0.02 + Math.pow(h, 4) * 0.8);
      o[3] = a;
    });
  }
  particleTex = new THREE.CanvasTexture(canvas);
  particleTex.colorSpace = THREE.SRGBColorSpace;
  particleTex.generateMipmaps = true;
  particleTex.minFilter = THREE.LinearMipmapLinearFilter;
  particleTex.magFilter = THREE.LinearFilter;
  particleTex.name = 'fx-atlas';
  return particleTex;
}

/* ------------------------------------------------------------ Einschuss-Atlas */

export function getDecalAtlas() {
  if (decalTex) return decalTex;
  const S = 128;
  const [GX, GY] = DECAL_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = S * GX;
  canvas.height = S * GY;
  const ctx = canvas.getContext('2d');
  const at = (cell) => [(cell % GX) * S, Math.floor(cell / GX) * S];
  const n1 = makeNoise(13), n2 = makeNoise(57), n3 = makeNoise(211);

  // Beton/Putz: dunkles Loch, abgeplatzter Krater, Staubhof
  const crater = (nz, off, ring, rim) => (u, v, o) => {
    const d = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const n = nz(Math.cos(ang) * 2 + off, Math.sin(ang) * 2 + off, 4);
    const hole = 1 - sstep(0.1, 0.16, d);
    const chip = 1 - sstep(0.24 + n * 0.22, 0.3 + n * 0.24, d);
    const dust = (1 - sstep(0.3, 0.85, d + (n - 0.5) * 0.3)) * 0.35;
    const a = Math.max(hole, chip * 0.92, dust);
    const c = hole > 0.5 ? 0.04 : chip > 0.5 ? ring - n * 0.12 : rim;
    o[0] = o[1] = o[2] = c; o[3] = a;
  };
  paintCell(ctx, ...at(DECAL.CONCRETE), S, crater(n1, 1.3, 0.3, 0.42));
  paintCell(ctx, ...at(DECAL.CONCRETE_B), S, crater(n2, 7.1, 0.27, 0.38));
  paintCell(ctx, ...at(DECAL.PLASTER), S, crater(n3, 3.3, 0.86, 0.74));
  // Metall: kleines Loch mit hellem, aufgeworfenem Rand
  paintCell(ctx, ...at(DECAL.METAL), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const hole = 1 - sstep(0.1, 0.14, d);
    const rim = (1 - sstep(0.15, 0.22, d)) * sstep(0.1, 0.14, d);
    const smudge = (1 - sstep(0.18, 0.5, d)) * 0.4;
    o[0] = o[1] = o[2] = hole > 0.5 ? 0.03 : rim > 0.3 ? 0.85 : 0.18;
    o[3] = Math.max(hole, rim, smudge);
  });
  // Holz: Loch mit Splitterstrahlen
  paintCell(ctx, ...at(DECAL.WOOD), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const spikes = Math.pow(Math.abs(Math.sin(ang * 3.5 + n2(ang, 0.5, 2) * 4)), 6);
    const hole = 1 - sstep(0.1, 0.15, d);
    const spl = (1 - sstep(0.18, 0.2 + spikes * 0.45, d)) * 0.9;
    o[0] = hole > 0.5 ? 0.05 : 0.28; o[1] = hole > 0.5 ? 0.04 : 0.2; o[2] = hole > 0.5 ? 0.03 : 0.12;
    o[3] = Math.max(hole, spl);
  });
  // Erde/Sand/Gras: weicher dunkler Fleck
  paintCell(ctx, ...at(DECAL.SOFT), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const n = n1(u * 3 + 5, v * 3 + 2, 4);
    const a = (1 - sstep(0.15, 0.7, d + (n - 0.5) * 0.4)) * 0.75;
    o[0] = 0.12; o[1] = 0.1; o[2] = 0.08; o[3] = a;
  });
  // Glas: Sprung-Stern + Kreisbögen
  paintCell(ctx, ...at(DECAL.GLASS), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const k = 9;
    const rayDist = Math.abs(Math.sin(ang * k * 0.5 + n3(ang * 2, 0, 2) * 2)) * d;
    const rays = (1 - sstep(0.0, 0.025, rayDist)) * (1 - sstep(0.5, 0.95, d));
    const rings = (1 - sstep(0.0, 0.02, Math.abs(d - 0.32 - n3(ang * 3, 1, 2) * 0.08))) * 0.8 +
      (1 - sstep(0.0, 0.018, Math.abs(d - 0.55 - n3(ang * 2, 4, 2) * 0.1))) * 0.5 * (1 - sstep(0.6, 0.8, d));
    const center = 1 - sstep(0.05, 0.11, d);
    o[0] = o[1] = o[2] = center > 0.5 ? 0.15 : 0.95;
    o[3] = Math.min(1, Math.max(center, rays * 0.85, rings));
  });
  // Brandfleck (Explosion)
  paintCell(ctx, ...at(DECAL.SCORCH), S, (u, v, o) => {
    const d = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const n = n2(u * 2.5 + 9, v * 2.5 + 4, 5);
    const streak = Math.pow(Math.abs(Math.sin(ang * 6 + n * 5)), 4) * 0.25;
    const a = (1 - sstep(0.2, 0.95, d + (n - 0.5) * 0.45 - streak)) * 0.95;
    const c = 0.03 + sstep(0.2, 0.9, d) * 0.12;
    o[0] = c * 1.1; o[1] = c; o[2] = c * 0.9; o[3] = a;
  });

  decalTex = new THREE.CanvasTexture(canvas);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  decalTex.generateMipmaps = true;
  decalTex.minFilter = THREE.LinearMipmapLinearFilter;
  decalTex.anisotropy = 4;
  decalTex.name = 'fx-decals';
  return decalTex;
}

/** Texturen freigeben (z. B. dev-Seite); im Spiel bleiben sie über Matches erhalten. */
export function disposeFxTextures() {
  if (particleTex) { particleTex.dispose(); particleTex = null; }
  if (decalTex) { decalTex.dispose(); decalTex = null; }
}
