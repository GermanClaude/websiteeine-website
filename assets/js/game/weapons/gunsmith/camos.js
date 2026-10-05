// Waffen-Tarnmuster (Skins): prozedurale, kachelbare Texturen (256², gecacht) + Materialvarianten.
// Tarnung liegt auf Gehäuse, Handschutz, Schaft, Magazin, Holz und Klingenbeschichtung – Lauf, Visier, Griffflächen,
// Gummi und Optik bleiben unverändert (wie in CoD). 3.-Person-Modelle (Bots): das Matt-Sammelmaterial bekommt das
// Muster, das Metall-Sammelmaterial nur bei metallischen Mustern (Gold, Damast …).
//
//   applyCamo(root, camoId)        Muster auf ein Modell (Klon aus createWeaponModel) legen; 'werk'/null = Werkszustand
//   camoTexture(camoId)            CanvasTexture (sRGB, Wiederholung) – auch für Vorschauen/Website
//   camoSwatch(camoId, size)       kleines Vorschaubild (Canvas) für Menüs
//   disposeCamos()                 alle Texturen/Materialien freigeben
import * as THREE from 'three';
import { CAMOS } from '../../../shared/weapons.data.js';
import { getMat } from './materials.js';

const SIZE = 256;
/** Materialschlüssel (gs:<key>), die ein Tarnmuster erhalten. */
export const CAMO_TARGETS = new Set(['alu', 'aluTan', 'aluOD', 'polymer', 'polymerTan', 'polymerOD', 'polymerGrey', 'steel', 'stainless',
  'woodWarm', 'woodWalnut', 'paintOlive', 'bladeCoat', 'canvasOD']);

const texCache = new Map();
const matCache = new Map();

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const hex = (c) => { const n = parseInt(String(c).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Periodische Wertrausch-Funktion (kachelbar über SIZE): Gitter g×g
function periodicNoise(rand, g) {
  const v = new Float32Array(g * g);
  for (let i = 0; i < v.length; i++) v[i] = rand();
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / SIZE) * g, fy = (y / SIZE) * g;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
    const i0 = ((x0 % g) + g) % g, j0 = ((y0 % g) + g) % g, i1 = (i0 + 1) % g, j1 = (j0 + 1) % g;
    const a = v[j0 * g + i0], b = v[j0 * g + i1], c = v[j1 * g + i0], d = v[j1 * g + i1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}
function fbm(rand, octaves = 4, base = 4) {
  const ns = []; for (let o = 0; o < octaves; o++) ns.push(periodicNoise(rand, base << o));
  return (x, y) => { let s = 0, a = 0.5, n = 0; for (const f of ns) { s += f(x, y) * a; n += a; a *= 0.5; } return s / n; };
}

// Pixelweise füllen: fn(x, y) → [r, g, b]
function pixels(ctx, fn) {
  const img = ctx.createImageData(SIZE, SIZE), d = img.data;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const c = fn(x, y), i = (y * SIZE + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Schwellwert-Schichten über Rauschen: jede Farbe ab 1 belegt Flächen, in denen ihr eigenes Rauschfeld > Schwelle
function layered(ctx, rand, cols, scale, levels, octaves = 3) {
  const fields = cols.slice(1).map((_, i) => fbm(rng(Math.floor(rand() * 1e9) + i), octaves, Math.max(2, Math.round(4 / scale))));
  pixels(ctx, (x, y) => {
    let c = cols[0];
    for (let i = 0; i < fields.length; i++) if (fields[i](x, y) > levels[i]) c = cols[i + 1];
    return c;
  });
}

const PAINTERS = {
  solid(ctx, rand, cols) {
    const a = cols[0] || [128, 128, 128], b = cols[1] || shade(a, 0.85), n = fbm(rand, 4, 8);
    pixels(ctx, (x, y) => mix(a, b, Math.max(0, n(x, y) - 0.35) * 1.4));
  },
  blobs(ctx, rand, cols, scale) { layered(ctx, rand, cols, scale, [0.52, 0.56, 0.6, 0.62], 3); },
  flecks(ctx, rand, cols) {
    layered(ctx, rand, cols.slice(0, 2), 1.2, [0.55], 3);
    for (let i = 2; i < cols.length; i++) {
      ctx.fillStyle = `rgb(${cols[i].join(',')})`;
      for (let k = 0; k < 260; k++) {
        const x = rand() * SIZE, y = rand() * SIZE, r = 2 + rand() * 4;
        for (const [ox, oy] of [[0, 0], [SIZE, 0], [0, SIZE], [-SIZE, 0], [0, -SIZE]]) { ctx.beginPath(); ctx.ellipse(x + ox, y + oy, r * (0.8 + rand() * 0.6), r, rand() * 3, 0, Math.PI * 2); ctx.fill(); }
      }
    }
  },
  digital(ctx, rand, cols) {
    const fields = cols.slice(1).map((_, i) => fbm(rng(Math.floor(rand() * 1e9) + i), 3, 4));
    const cell = 8;
    for (let y = 0; y < SIZE; y += cell) for (let x = 0; x < SIZE; x += cell) {
      let c = cols[0];
      for (let i = 0; i < fields.length; i++) if (fields[i](x + cell / 2, y + cell / 2) + (rand() - 0.5) * 0.08 > 0.54 + i * 0.02) c = cols[i + 1];
      ctx.fillStyle = `rgb(${c.map(Math.round).join(',')})`;
      ctx.fillRect(x, y, cell, cell);
    }
  },
  tiger(ctx, rand, cols) {
    const n = fbm(rand, 3, 4), n2 = fbm(rand, 2, 2);
    pixels(ctx, (x, y) => {
      const w = Math.sin((y / SIZE) * Math.PI * 2 * 7 + n2(x, y) * 9 + Math.sin((x / SIZE) * Math.PI * 2) * 1.5);
      const t = w + (n(x, y) - 0.5) * 1.6;
      return t > 0.55 ? cols[1] : t > 0.35 && cols[2] ? cols[2] : cols[0];
    });
  },
  splinter(ctx, rand, cols) {
    ctx.fillStyle = `rgb(${cols[0].join(',')})`; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let k = 0; k < 70; k++) {
      const c = cols[1 + Math.floor(rand() * (cols.length - 1))];
      ctx.fillStyle = `rgb(${c.join(',')})`;
      const cx = rand() * SIZE, cy = rand() * SIZE, r = 14 + rand() * 30, a0 = rand() * Math.PI;
      for (const [ox, oy] of [[0, 0], [SIZE, 0], [0, SIZE], [-SIZE, 0], [0, -SIZE], [SIZE, SIZE], [-SIZE, -SIZE]]) {
        ctx.beginPath();
        for (let i = 0; i < 4; i++) { const a = a0 + i * (Math.PI / 2) + (rand() - 0.5) * 0.6, rr = r * (0.4 + rand()); ctx.lineTo(cx + ox + Math.cos(a) * rr * 1.8, cy + oy + Math.sin(a) * rr * 0.6); }
        ctx.closePath(); ctx.fill();
      }
    }
  },
  stripes(ctx, rand, cols) {
    const n = fbm(rand, 3, 4);
    pixels(ctx, (x, y) => (Math.sin(((x + y * 0.35) / SIZE) * Math.PI * 2 * 6 + n(x, y) * 10) > 0.1 ? cols[1] : cols[0]));
  },
  hex(ctx, rand, cols) {
    ctx.fillStyle = `rgb(${cols[0].join(',')})`; ctx.fillRect(0, 0, SIZE, SIZE);
    const r = 16, w = Math.sqrt(3) * r;
    for (let row = -1; row < SIZE / (1.5 * r) + 1; row++) for (let col = -1; col < SIZE / w + 1; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * 1.5 * r;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(cx + Math.cos(a) * (r - 1.5), cy + Math.sin(a) * (r - 1.5)); }
      ctx.closePath();
      const c = rand() < 0.3 ? cols[2] || cols[1] : cols[1];
      ctx.fillStyle = `rgb(${shade(c, 0.85 + rand() * 0.3).map(Math.round).join(',')})`; ctx.fill();
    }
  },
  carbon(ctx, rand, cols) {
    const cell = 8;
    pixels(ctx, (x, y) => {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), up = (cx + cy) % 2 === 0;
      const t = up ? (x % cell) / cell : (y % cell) / cell;
      return mix(cols[0], cols[1], 0.25 + 0.75 * Math.sin(t * Math.PI));
    });
  },
  damask(ctx, rand, cols) {
    const n = fbm(rand, 4, 4);
    pixels(ctx, (x, y) => {
      const v = Math.sin(((y + n(x, y) * 120) / SIZE) * Math.PI * 2 * 9 + Math.sin((x / SIZE) * Math.PI * 4) * 2);
      const t = 0.5 + 0.5 * v;
      return t > 0.8 ? cols[2] : mix(cols[1], cols[0], t);
    });
  },
  brushed(ctx, rand, cols) {
    const rows = new Float32Array(SIZE); for (let i = 0; i < SIZE; i++) rows[i] = rand();
    const n = fbm(rand, 3, 4);
    pixels(ctx, (x, y) => {
      const t = rows[y] * 0.5 + n(x, y) * 0.5;
      return t > 0.72 ? cols[2] : mix(cols[1], cols[0], Math.min(1, t * 1.4));
    });
  },
  rust(ctx, rand, cols) {
    const n = fbm(rand, 5, 4), m = fbm(rand, 3, 8);
    pixels(ctx, (x, y) => {
      const a = n(x, y), b = m(x, y);
      let c = mix(cols[2], cols[0], a);
      if (a > 0.55) c = mix(c, cols[1], Math.min(1, (a - 0.55) * 4));
      if (b > 0.68) c = mix(c, cols[3], 0.7);
      return c;
    });
  },
  marble(ctx, rand, cols) {
    const n = fbm(rand, 5, 4);
    pixels(ctx, (x, y) => {
      const v = Math.abs(Math.sin(((x + y) / SIZE) * Math.PI * 2 * 2 + n(x, y) * 14));
      return v < 0.08 ? cols[2] : v < 0.3 ? mix(cols[1], cols[0], v / 0.3) : cols[0];
    });
  },
  aurora(ctx, rand, cols) {
    const n = fbm(rand, 4, 4);
    pixels(ctx, (x, y) => {
      const t = (y / SIZE + n(x, y) * 0.6) % 1;
      const band = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3);
      const hueMix = 0.5 + 0.5 * Math.sin((x / SIZE) * Math.PI * 2 + n(x, y) * 6);
      const glow = mix(cols[1], mix(cols[2], cols[3] || cols[2], hueMix), 0.5 + 0.5 * Math.sin(t * 9));
      return mix(cols[0], glow, Math.pow(band, 2.2));
    });
  },
};

function paint(def) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(SIZE, SIZE);
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const rand = rng(hash(def.id));
  const cols = (def.colors || []).map(hex);
  (PAINTERS[def.pattern] || PAINTERS.solid)(ctx, rand, cols.length ? cols : [[110, 110, 110]], def.scale || 1);
  return c;
}

/** Kachelbare Tarnmuster-Textur (gecacht). null für den Werkszustand. */
export function camoTexture(id) {
  const def = CAMOS[id];
  if (!def || id === 'werk') return null;
  let t = texCache.get(id);
  if (!t) {
    t = new THREE.CanvasTexture(paint(def));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    // 1 UV-Einheit = 0,2 m (boxUV) → Muster ≈ 0,2 m je Kachel; grobe Muster etwas größer
    const sc = 1 / (def.scale || 1);
    t.repeat.set(sc, sc);
    t.name = 'camo:' + id;
    texCache.set(id, t);
  }
  return t;
}

/** Kleines Vorschaubild (Canvas) eines Musters für Menüs/Website. */
export function camoSwatch(id, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const def = CAMOS[id];
  const ctx = c.getContext('2d');
  if (!def || id === 'werk') { ctx.fillStyle = '#2a2b2f'; ctx.fillRect(0, 0, size, size); return c; }
  ctx.drawImage(paint(def), 0, 0, size, size);
  return c;
}

/** Materialvariante eines Waffenmaterials (Schlüssel aus materials.js) mit Tarnmuster. */
export function camoMaterial(baseKey, id) {
  const def = CAMOS[id];
  if (!def || id === 'werk') return getMat(baseKey);
  const k = baseKey + '|' + id;
  let m = matCache.get(k);
  if (m) return m;
  const base = getMat(baseKey);
  m = base.clone();
  m.name = `gs:${baseKey}:camo:${id}`;
  m.map = camoTexture(id);
  m.color = new THREE.Color(0xffffff);
  if (m.vertexColors) m.vertexColors = false;
  const f = def.finish || {};
  const metallic = (f.metalness ?? 0) >= 0.5;
  m.metalness = f.metalness ?? (baseKey === 'lodMetal' ? 0.5 : Math.min(base.metalness ?? 0, 0.35));
  m.roughness = f.roughness ?? Math.max(0.55, base.roughness ?? 0.7);
  if (!metallic) m.metalnessMap = null;
  m.userData = { camo: id, baseKey };
  m.needsUpdate = true;
  matCache.set(k, m);
  return m;
}

function keyOf(mat) {
  const n = mat && mat.name;
  if (!n || !n.startsWith('gs:')) return null;
  const k = n.slice(3);
  return k.includes(':') ? k.slice(0, k.indexOf(':')) : k;
}

/**
 * Muster auf ein Waffenmodell legen (Klon aus createWeaponModel; Materialien werden je Mesh getauscht, Geometrie
 * bleibt geteilt). id = Muster-Id aus CAMOS, 'werk'/null/unbekannt = Werkszustand. → root
 */
export function applyCamo(root, id) {
  const def = id && CAMOS[id] && id !== 'werk' ? CAMOS[id] : null;
  const metallic = !!(def && (def.finish?.metalness ?? 0) >= 0.5);
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const base = o.userData.baseMat || o.material;
    const key = keyOf(base);
    if (!key) return;
    const target = CAMO_TARGETS.has(key) || key === 'lodMatte' || (metallic && key === 'lodMetal');
    if (!target) return;
    if (!o.userData.baseMat) o.userData.baseMat = base;
    o.material = def ? camoMaterial(key, id) : base;
  });
  root.userData.camo = def ? id : null;
  return root;
}

export function disposeCamos() {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
}
