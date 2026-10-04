// Prozedurale Canvas-Texturen für Waffen, Handschuhe und Ärmel (eigene Helfer, unabhängig von engine/textures.js).
// Alle Texturen sind kachelbar, klein (≤ 512 px) und werden einmalig erzeugt und gecacht.
import * as THREE from 'three';

const cache = new Map();

// Deterministischer Zufallsgenerator (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Kachelbare Value-Noise-FBM als Float32Array (0..1)
export function fbm(w, h, { seed = 1, octaves = 4, period = 8, gain = 0.5, periodY } = {}) {
  const out = new Float32Array(w * h);
  const rand = rng(seed);
  let amp = 1, total = 0, px = period, py = periodY ?? Math.max(1, Math.round(period * h / w));
  for (let o = 0; o < octaves; o++) {
    const gx = px, gy = py;
    const lattice = new Float32Array(gx * gy);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * gy, iy = Math.floor(fy), ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % gy) * gx, y1 = ((iy + 1) % gy) * gx;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * gx, ix = Math.floor(fx), tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % gx, x1 = (ix + 1) % gx;
        const a = lattice[y0 + x0], b = lattice[y0 + x1], c = lattice[y1 + x0], d = lattice[y1 + x1];
        out[y * w + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    total += amp; amp *= gain; px *= 2; py *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(c, { srgb = false, repeat = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// Höhenfeld → Normal-Map (Sobel, kachelnd)
function heightToNormal(height, w, h, strength = 2) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const H = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

// Rauheits-/Metall-Map mit Kratzern, Flecken und Abrieb (G = Rauheit, B = Metall)
export function wearMap() {
  return cached('wear', () => {
    const S = 256, c = canvas(S, S), ctx = c.getContext('2d');
    const n = fbm(S, S, { seed: 11, period: 6, octaves: 5 });
    const img = ctx.createImageData(S, S), d = img.data;
    for (let i = 0; i < S * S; i++) {
      const v = n[i];
      d[i * 4] = 255;
      d[i * 4 + 1] = 190 + v * 65;           // Rauheit 0.75..1.0 (× material.roughness)
      d[i * 4 + 2] = 225 + v * 30;           // Metall leicht variiert
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Feine Kratzer: glattere (dunklere G) Linien
    const r = rng(5);
    ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 140; k++) {
      const x = r() * S, y = r() * S, len = 4 + r() * 26, a = (r() - 0.5) * 0.9 + (r() < 0.5 ? 0 : Math.PI / 2);
      ctx.strokeStyle = `rgba(255,${60 + r() * 60 | 0},255,${0.25 + r() * 0.35})`;
      ctx.lineWidth = 0.6 + r() * 0.8;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len); ctx.stroke();
      }
    }
    return toTexture(c);
  });
}

// Gebürstetes Metall: Streifen entlang U
export function brushedMap() {
  return cached('brushed', () => {
    const W = 512, H = 64, c = canvas(W, H), ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H), d = img.data, r = rng(9);
    const rows = new Float32Array(H).map(() => r());
    const n = fbm(W, H, { seed: 3, period: 4, periodY: 1, octaves: 3 });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, v = rows[y] * 0.6 + n[y * W + x] * 0.4;
      d[i] = 255; d[i + 1] = 120 + v * 120; d[i + 2] = 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

// Feine Oberflächenstruktur (Parkerisierung / Polymer-Korn)
export function grainNormal() {
  return cached('grainN', () => {
    const S = 256, n = fbm(S, S, { seed: 21, period: 96, octaves: 2, gain: 0.45 });
    return heightToNormal(n, S, S, 0.22);
  });
}

// Stippling für Griffflächen
export function stippleNormal() {
  return cached('stippleN', () => {
    const S = 256, h = new Float32Array(S * S), r = rng(33);
    for (let k = 0; k < 5200; k++) {
      const cx = r() * S, cy = r() * S, rad = 0.9 + r() * 1.1;
      for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
        const dd = Math.hypot(x, y) / rad;
        if (dd < 1) {
          const px = ((Math.round(cx) + x) % S + S) % S, py = ((Math.round(cy) + y) % S + S) % S;
          h[py * S + px] = Math.max(h[py * S + px], Math.cos(dd * Math.PI / 2));
        }
      }
    }
    const t = heightToNormal(h, S, S, 0.9);
    t.repeat.set(3, 3);
    return t;
  });
}

// Rautenrändel für Drehknöpfe/Türme
export function knurlNormal() {
  return cached('knurlN', () => {
    const S = 128, h = new Float32Array(S * S), f = 16;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = Math.abs(Math.sin((x + y) / S * Math.PI * f)), b = Math.abs(Math.sin((x - y) / S * Math.PI * f));
      h[y * S + x] = Math.min(a, b);
    }
    return heightToNormal(h, S, S, 3);
  });
}

// Holzmaserung (Albedo, sRGB), Fasern laufen entlang U (= Waffenlänge).
// scheme: 'warm' (KV-47, rötliches Schichtholz) | 'walnut' (Bulldog, dunkle Walnuss)
export function woodMap(scheme = 'warm') {
  return cached('wood:' + scheme, () => {
    const W = 512, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H), d = img.data;
    const warp = fbm(W, H, { seed: scheme === 'warm' ? 7 : 8, period: 2, periodY: 3, octaves: 3 });
    const fiber = fbm(W, H, { seed: 4, period: 2, periodY: 96, octaves: 2 });
    const blot = fbm(W, H, { seed: 17, period: 5, periodY: 3, octaves: 3 });
    const pal = scheme === 'warm'
      ? { a: [112, 58, 32], b: [70, 34, 18], hi: [140, 82, 46] }
      : { a: [92, 58, 36], b: [50, 30, 18], hi: [118, 78, 50] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // Jahresringe: überwiegend quer zur Faser, leicht gewellt
      const g = Math.sin((y / H * 6 + warp[i] * 1.6) * Math.PI * 2) * 0.5 + 0.5;
      const ring = Math.pow(g, 6) * 0.35;
      const t = Math.min(1, Math.max(0, ring + (fiber[i] - 0.5) * 0.9 + 0.25));
      const lb = blot[i];
      for (let k = 0; k < 3; k++) {
        let v = pal.a[k] * (1 - t) + pal.b[k] * t;
        v *= 0.9 + lb * 0.2;
        if (lb > 0.62) v += (pal.hi[k] - v) * (lb - 0.62) * 0.9;
        d[i * 4 + k] = v;
      }
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: true });
  });
}

// Tarnmuster (eigenes Muster „NP-Flecktarn“, Albedo sRGB)
export function camoMap(scheme = 'arid') {
  return cached('camo:' + scheme, () => {
    const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
    const P = scheme === 'arid'
      ? ['#9a8a68', '#6f6448', '#4d5236', '#3a3226', '#b9ab88']
      : ['#5d6146', '#3f4530', '#2c2f22', '#6f6650', '#7f7a5c'];
    const img = ctx.createImageData(S, S), d = img.data;
    const n1 = fbm(S, S, { seed: 41, period: 5, octaves: 4 });
    const n2 = fbm(S, S, { seed: 42, period: 7, octaves: 4 });
    const n3 = fbm(S, S, { seed: 43, period: 11, octaves: 3 });
    const weave = fbm(S, S, { seed: 44, period: 128, periodY: 128, octaves: 1 });
    const hex = P.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    for (let i = 0; i < S * S; i++) {
      let col = hex[0];
      if (n1[i] > 0.56) col = hex[1];
      if (n2[i] > 0.6) col = hex[2];
      if (n3[i] > 0.66) col = hex[3];
      if (n1[i] < 0.34 && n2[i] < 0.45) col = hex[4];
      const x = i % S, y = (i / S) | 0;
      const w = ((x & 3) < 2) !== ((y & 3) < 2) ? 0.93 : 1.05; // Gewebe-Struktur
      const v = w * (0.92 + weave[i] * 0.16);
      d[i * 4] = col[0] * v; d[i * 4 + 1] = col[1] * v; d[i * 4 + 2] = col[2] * v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: true });
  });
}

// Gewebe-Normal-Map (Stoff, Handschuh)
export function fabricNormal() {
  return cached('fabricN', () => {
    const S = 128, h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = Math.sin(x / S * Math.PI * 32) * Math.sin(y / S * Math.PI * 64);
      const b = Math.sin(y / S * Math.PI * 32) * Math.sin(x / S * Math.PI * 64);
      h[y * S + x] = ((x >> 2) + (y >> 2)) % 2 ? a * 0.5 + 0.5 : b * 0.5 + 0.5;
    }
    return heightToNormal(h, S, S, 1.2);
  });
}

// Absehen-Texturen (Graustufen-Alpha; Farbe kommt aus dem Material)
export function reticleMap(type) {
  return cached('ret:' + type, () => {
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d'), m = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 4;
    if (type === 'holo') {
      ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.arc(m, m, 40, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(m, m, 4.5, 0, Math.PI * 2); ctx.fill();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.beginPath(); ctx.moveTo(m + Math.cos(a) * 40, m + Math.sin(a) * 40); ctx.lineTo(m + Math.cos(a) * 50, m + Math.sin(a) * 50); ctx.stroke();
      }
    } else if (type === 'dot') {
      const g = ctx.createRadialGradient(m, m, 0, m, m, 14);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.shadowBlur = 0; ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    } else if (type === 'chevron') {
      ctx.lineWidth = 7; ctx.lineJoin = 'miter';
      ctx.beginPath(); ctx.moveTo(m - 22, m + 18); ctx.lineTo(m, m - 6); ctx.lineTo(m + 22, m + 18); ctx.stroke();
      ctx.lineWidth = 3; ctx.globalAlpha = 0.65;
      ctx.beginPath(); ctx.moveTo(m, m + 18); ctx.lineTo(m, m + 56); ctx.stroke();
      for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(m - 9 + k, m + 18 + k * 10); ctx.lineTo(m + 9 - k, m + 18 + k * 10); ctx.stroke(); }
    } else if (type === 'cross') {
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, m); ctx.lineTo(S, m); ctx.moveTo(m, 0); ctx.lineTo(m, S); ctx.stroke();
    }
    return toTexture(c, { repeat: false });
  });
}

// Mündungsfeuer: Stern frontal + Flammenzunge seitlich (Alpha-Luminanz)
export function flashMap(kind = 'star') {
  return cached('flash:' + kind, () => {
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d'), m = S / 2;
    ctx.globalCompositeOperation = 'lighter';
    if (kind === 'star') {
      const r = rng(77);
      const core = ctx.createRadialGradient(m, m, 0, m, m, m * 0.55);
      core.addColorStop(0, 'rgba(255,255,240,1)'); core.addColorStop(0.3, 'rgba(255,220,140,0.85)'); core.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = core; ctx.fillRect(0, 0, S, S);
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2 + r() * 0.4, len = m * (0.55 + r() * 0.45), wid = 5 + r() * 6;
        ctx.save(); ctx.translate(m, m); ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, 'rgba(255,240,200,0.95)'); g.addColorStop(0.5, 'rgba(255,170,60,0.55)'); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -wid); ctx.lineTo(len, 0); ctx.lineTo(0, wid); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    } else {
      // Seitliche Flamme: entlang +X (von links nach rechts ausfransend)
      const r = rng(78);
      for (let k = 0; k < 5; k++) {
        const y = m + (r() - 0.5) * 16, len = S * (0.6 + r() * 0.4), wid = 10 + r() * 12;
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, 'rgba(255,245,210,0.95)'); g.addColorStop(0.4, 'rgba(255,170,60,0.6)'); g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, y - wid * 0.5); ctx.quadraticCurveTo(len * 0.5, y - wid, len, y); ctx.quadraticCurveTo(len * 0.5, y + wid, 0, y + wid * 0.5); ctx.closePath(); ctx.fill();
      }
    }
    return toTexture(c, { srgb: true, repeat: false });
  });
}

// Weiches Rauchwölkchen
export function smokeMap() {
  return cached('smoke', () => {
    const S = 64, c = canvas(S, S), ctx = c.getContext('2d'), m = S / 2;
    const n = fbm(S, S, { seed: 90, period: 4, octaves: 3 });
    const img = ctx.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, r = Math.hypot(x - m, y - m) / m;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.55 + n[i] * 0.6);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.min(255, a * 255);
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { repeat: false });
  });
}

// Lebendiges Uhren-Display (zeigt die echte Uhrzeit, Minutentakt)
export function watchFaceTexture() {
  return cached('watch', () => {
    const c = canvas(128, 128);
    const t = toTexture(c, { srgb: true, repeat: false });
    const draw = () => {
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0d120f'; ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#16231b'; ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
      ctx.fillStyle = '#ff7a3d';
      ctx.font = 'bold 44px "JetBrains Mono NP", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${hh}:${mm}`, 64, 66);
      ctx.font = 'bold 13px "JetBrains Mono NP", monospace';
      ctx.fillStyle = '#7fa08a';
      const tage = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
      ctx.fillText(`${tage[now.getDay()]} ${String(now.getDate()).padStart(2, '0')}`, 64, 34);
      ctx.fillText('NP-01', 64, 98);
      t.needsUpdate = true;
    };
    draw();
    t.userData.redraw = draw;
    return t;
  });
}

// Klebeband-Textur (leicht faserig)
export function tapeMap() {
  return cached('tape', () => {
    const W = 128, H = 32, c = canvas(W, H), ctx = c.getContext('2d');
    const n = fbm(W, H, { seed: 61, period: 16, periodY: 2, octaves: 3 });
    const img = ctx.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++) {
      const v = 0.85 + n[i] * 0.3;
      d[i * 4] = 78 * v; d[i * 4 + 1] = 82 * v; d[i * 4 + 2] = 60 * v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: true });
  });
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}
