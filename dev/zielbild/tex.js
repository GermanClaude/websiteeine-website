// Zielbild – prozedurale Texturen (CPU, einmalig). Alles selbst erzeugt: Rauschen, Lack/Rost, Asphalt, Stoff, Tarnmuster.
// Konvention: Zeile 0 = v 0 (unten), flipY = false → Normalen im OpenGL-Format (+G = +v).
import * as THREE from 'three';

/* ------------------------------------------------------------------ Rauschen */
const LAT = new Float32Array(256 * 256);
{ let s = 1234567; for (let i = 0; i < LAT.length; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; LAT[i] = s / 4294967296; } }

export function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** Wertrauschen 0…1; p = Periode in Gitterzellen (0 = keine Kachelung). */
export function vn(x, y, p = 0) {
  let xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  let x1 = xi + 1, y1 = yi + 1;
  if (p) { xi = ((xi % p) + p) % p; x1 = ((x1 % p) + p) % p; yi = ((yi % p) + p) % p; y1 = ((y1 % p) + p) % p; }
  xi &= 255; x1 &= 255; yi &= 255; y1 &= 255;
  const a = LAT[(yi << 8) | xi], b = LAT[(yi << 8) | x1], c = LAT[(y1 << 8) | xi], d = LAT[(y1 << 8) | x1];
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4, p = 0, lac = 2, gain = 0.5) {
  let s = 0, a = 0.5, n = 0, f = 1;
  if (p) { for (let i = 0; i < oct; i++) { s += a * vn(x * f + i * 31.7, y * f + i * 17.3, p * f); n += a; a *= gain; f *= lac; } return s / n; }
  // nicht kachelnd: Oktaven gedreht (keine Gitter-Artefakte)
  let X = x, Y = y;
  for (let i = 0; i < oct; i++) { s += a * vn(X + i * 31.7, Y + i * 17.3); n += a; a *= gain; const t = X; X = (0.8 * t - 0.6 * Y) * lac; Y = (0.6 * t + 0.8 * Y) * lac; }
  return s / n;
}
/** Kammrauschen (Risse/Adern) 0…1, 1 = auf der Linie. */
export function ridge(x, y, oct = 4, p = 0) {
  let s = 0, a = 0.5, n = 0, f = 1;
  for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(vn(x * f + i * 11.1, y * f + i * 7.7, p ? p * f : 0) * 2 - 1); s += a * v * v; n += a; a *= 0.5; f *= 2; }
  return s / n;
}
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
/** Zellrauschen: [F1, F2, Zell-Hash] (kachelbar mit Periode p). */
export function worley(x, y, p = 0, out = [0, 0, 0]) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    let cx = xi + i, cy = yi + j;
    let hx = cx, hy = cy;
    if (p) { hx = ((cx % p) + p) % p; hy = ((cy % p) + p) % p; }
    const r1 = hash2(hx, hy), r2 = hash2(hx + 913, hy + 77);
    const dx = cx + r1 - x, dy = cy + r2 - y;
    const d = dx * dx + dy * dy;
    if (d < f1) { f2 = f1; f1 = d; id = hash2(hx + 5, hy + 3); } else if (d < f2) f2 = d;
  }
  out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2); out[2] = id; return out;
}
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hex(h) { const c = new THREE.Color(h); return [c.r, c.g, c.b]; } // THREE.Color = linear
const lin2srgb8 = (c) => { c = clamp(c); return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); };

/* ------------------------------------------------------------------ Hilfen */
export function makeTex(data, w, h, { srgb = false, repeat = false, aniso = 16 } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = aniso; t.flipY = false; t.needsUpdate = true;
  return t;
}
/** Höhenfeld → Normalenkarte (Sobel). k = Stärke, wrap = kachelbar. */
export function normalFromHeight(H, w, h, k = 1, wrap = false) {
  const out = new Uint8Array(w * h * 4);
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y; }
    return H[y * w + x];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * k, ny = -dy * k, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}
/** Text-/Schablonenmaske über ein 2D-Canvas (Zeile 0 = oben im Canvas → wird beim Lesen gespiegelt). */
function textMask(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  draw(g, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = d[((h - 1 - y) * w + x) * 4] / 255;
  return m;
}

/* ------------------------------------------------------------------ Lackierter Stahl (Container, Kran) */
/**
 * kind: 'side' | 'end' | 'frame' | 'crane'. W/H in Metern, ppm Pixel je Meter.
 * corr: { pitch } Wellenteilung (für Schmutz in den Tälern; muss zur Geometrie passen).
 * Liefert { map, orm, normal } – orm: R = AO, G = Rauheit, B = Metall.
 */
export function paintedSteel({ W, H, ppm = 200, color = '#a33a22', seed = 1, kind = 'side', pitch = 0.278, age = 0.5, code = 'NLPU 482913 7', iso = '45G1', tile = false }) {
  const w = Math.max(8, Math.round(W * ppm)), h = Math.max(8, Math.round(H * ppm));
  const N = w * h;
  const base = hex(color);
  const rustD = hex('#2e1a10'), rustO = hex('#7a3a17'), rustL = hex('#9a5524'), primer = hex('#6f625a'), dirt = hex('#4a4136'), steel = hex('#8c8a86');
  const R = rng(seed);
  const ox = R() * 200, oy = R() * 200;
  const P = tile ? (v) => Math.round(v) : () => 0; // Kachelperiode je Frequenz
  const fq = (f) => (tile ? Math.max(1, Math.round(W * f)) / W : f); // Frequenz an Kachel anpassen
  // Stufe 1: Masken
  const rust = new Float32Array(N), chip = new Float32Array(N), Hgt = new Float32Array(N);
  const f1 = fq(1.1), f2 = fq(13), f3 = fq(22), f4 = fq(70);
  for (let y = 0; y < h; y++) {
    const Y = y / ppm;
    for (let x = 0; x < w; x++) {
      const X = x / ppm, i = y * w + x;
      const n1 = fbm((X) * f1 + (tile ? 0 : ox), Y * f1 + (tile ? 0 : oy), 3, tile ? W * f1 : 0);
      const wx = tile ? 0 : (vn(X * 4.1 + 7, Y * 4.1) - 0.5) * 0.09, wy = tile ? 0 : (vn(X * 4.1, Y * 4.1 + 13) - 0.5) * 0.09;
      const n2 = fbm((X + wx) * f2 + (tile ? 0 : ox), (Y + wy) * f2 + (tile ? 0 : oy), 5, tile ? W * f2 : 0);
      const n3 = vn(X * f4, Y * f4, tile ? W * f4 : 0);
      let edge = 0;
      if (!tile) {
        const ed = Math.min(Y, H - Y, X, W - X);
        edge = Math.exp(-ed / 0.18) * 0.32;
      }
      const bottom = kind === 'crane' ? 0 : Math.pow(clamp(1 - Y / H), 4) * 0.18;
      const v = n2 + edge + bottom + (n1 - 0.5) * 0.45 + (n3 - 0.5) * 0.05 + (age - 0.5) * 0.2;
      chip[i] = sstep(0.69, 0.705, v);     // Lack weg (Grundierung)
      rust[i] = sstep(0.72, 0.75, v);      // bis zum Rost
      const pit = fbm(X * f3, Y * f3, 3, tile ? W * f3 : 0);
      Hgt[i] = 1 - chip[i] * 0.35 - rust[i] * 0.25 * (0.5 + pit) + (vn(X * fq(3), Y * fq(3), tile ? W * fq(3) : 0) - 0.5) * 0.4; // Lackkante + Narben + Beulen
    }
  }
  // Stufe 2: Rostläufer (laufen von Abplatzern und der Oberkante nach unten)
  const streak = new Float32Array(N);
  for (let x = 0; x < w; x++) {
    const X = x / ppm;
    const col = vn(X * fq(38) + ox, 3.3, tile ? W * fq(38) : 0), col2 = vn(X * fq(9) + ox, 7.7, tile ? W * fq(9) : 0);
    const decay = 1 - (0.004 + 0.02 * (1 - col)) * (200 / ppm);
    let s = tile ? 0 : (kind === 'crane' ? 0 : sstep(0.55, 0.85, col2) * 0.55 * age);
    for (let y = h - 1; y >= 0; y--) {
      const i = y * w + x;
      s = Math.max(rust[i] * (0.4 + col * 0.8), s * decay);
      streak[i] = s * sstep(0.25, 0.75, col * 0.7 + vn(X * fq(120), y / ppm * 2, tile ? W * fq(120) : 0) * 0.5);
    }
  }
  // Schablonen-Schrift
  let txt = null;
  if (kind === 'side' && !tile) {
    txt = textMask(w, h, (g) => {
      const s = ppm;
      g.font = `bold ${Math.round(0.11 * s)}px "DejaVu Sans", Arial, sans-serif`;
      g.textAlign = 'right';
      g.fillText(code, w - 0.45 * s, 0.38 * s);
      g.fillText(iso, w - 0.45 * s, 0.56 * s);
      g.font = `bold ${Math.round(0.42 * s)}px "DejaVu Sans", Arial, sans-serif`;
      g.textAlign = 'left';
      g.globalAlpha = 0.9;
      g.fillText('NLP', 0.9 * s, 1.35 * s);
      g.font = `bold ${Math.round(0.16 * s)}px "DejaVu Sans", Arial, sans-serif`;
      g.fillText('NULLPUNKT  LINES', 0.95 * s, 1.62 * s);
    });
  } else if (kind === 'end' && !tile) {
    txt = textMask(w, h, (g) => {
      const s = ppm;
      g.textAlign = 'left';
      g.font = `bold ${Math.round(0.1 * s)}px "DejaVu Sans", Arial, sans-serif`;
      g.fillText(code.slice(0, 4), W * s * 0.56, 0.32 * s);
      g.fillText(code.slice(5), W * s * 0.56, 0.45 * s);
      g.fillText(iso, W * s * 0.56, 0.62 * s);
      g.font = `${Math.round(0.045 * s)}px "DejaVu Sans", Arial, sans-serif`;
      const lines = ['MAX.GROSS  32.500 KG', '           71.650 LB', 'TARE        3.750 KG', 'NET        28.750 KG', 'CU.CAP.    67,7 CU.M'];
      lines.forEach((l, k) => g.fillText(l, W * s * 0.57, H * s * 0.55 + k * 0.06 * s));
      g.fillRect(W * s * 0.08, H * s * 0.62, 0.32 * s, 0.2 * s); // CSC-Schild
    });
  }
  // Stufe 3: Farben
  const alb = new Uint8Array(N * 4), orm = new Uint8Array(N * 4);
  const fade = hex('#d8cfc4');
  for (let y = 0; y < h; y++) {
    const Y = y / ppm;
    for (let x = 0; x < w; x++) {
      const X = x / ppm, i = y * w + x;
      const n1 = fbm(X * fq(1.6) + 50, Y * fq(1.6) + 9, 3, tile ? W * fq(1.6) : 0);
      const nf = vn(X * fq(160), Y * fq(160), tile ? W * fq(160) : 0);
      const nm = fbm(X * fq(14) + 3, Y * fq(14), 3, tile ? W * fq(14) : 0);
      // Lack: Fleckigkeit + Ausbleichen (oben stärker)
      const sun = (kind === 'crane' ? 0.35 : 0.15 + 0.35 * clamp(Y / H)) * sstep(0.3, 0.8, n1) * 0.55;
      let r = base[0] * (0.82 + 0.3 * n1 + 0.06 * nf), g = base[1] * (0.82 + 0.3 * n1 + 0.06 * nf), b = base[2] * (0.82 + 0.3 * n1 + 0.06 * nf);
      r = mix(r, fade[0] * base[0] * 2.2, sun * 0.5); g = mix(g, fade[1] * base[1] * 2.2, sun * 0.5); b = mix(b, fade[2] * base[2] * 2.2, sun * 0.5);
      let rough = 0.52 + 0.18 * n1 + 0.08 * nf + sun * 0.2, metal = 0;
      // Schrift (abgenutzt)
      if (txt) {
        const t = txt[i] * sstep(0.25, 0.5, nm + 0.15);
        r = mix(r, 0.62, t); g = mix(g, 0.6, t); b = mix(b, 0.56, t); rough = mix(rough, 0.45, t);
      }
      // Grundierung
      const c = chip[i] - rust[i];
      if (c > 0) { r = mix(r, primer[0], c); g = mix(g, primer[1], c); b = mix(b, primer[2], c); rough = mix(rough, 0.7, c); }
      // Rost
      const ru = rust[i];
      if (ru > 0) {
        const rn = fbm(X * fq(40), Y * fq(40), 3, tile ? W * fq(40) : 0);
        const rc0 = mix(rustD[0], rustO[0], rn), rc1 = mix(rustD[1], rustO[1], rn), rc2 = mix(rustD[2], rustO[2], rn);
        r = mix(r, rc0, ru); g = mix(g, rc1, ru); b = mix(b, rc2, ru); rough = mix(rough, 0.86 + rn * 0.1, ru);
        // blankes Metall in frischen Kratzern
        const sc = sstep(0.82, 0.9, nm) * ru * 0.6;
        r = mix(r, steel[0], sc); g = mix(g, steel[1], sc); b = mix(b, steel[2], sc); metal = sc; rough = mix(rough, 0.4, sc);
      }
      // Rostläufer
      const st = clamp(streak[i] * 0.75) * (1 - ru);
      if (st > 0) { r = mix(r, rustL[0] * 0.8, st * 0.7); g = mix(g, rustL[1] * 0.75, st * 0.7); b = mix(b, rustL[2] * 0.7, st * 0.7); rough = mix(rough, 0.8, st * 0.6); }
      // Schmutz: unten + in den Wellentälern
      let d = 0;
      if (kind === 'side' || kind === 'end') {
        d += sstep(0.55, 0.0, Y) * 0.55 * (0.6 + 0.6 * nm);
        const t = ((X / pitch) % 1 + 1) % 1, cc = Math.cos(t * 6.2832);
        d += sstep(-0.4, -1, cc) * 0.12 * (0.5 + nm);
      } else if (kind === 'crane') d += sstep(0.5, 0.75, nm) * 0.35;
      d += sstep(0.62, 0.8, fbm(X * fq(3) + 9, Y * fq(3), 3, tile ? W * fq(3) : 0)) * 0.25;
      d = clamp(d);
      r = mix(r, dirt[0], d); g = mix(g, dirt[1], d); b = mix(b, dirt[2], d); rough = mix(rough, 0.92, d);
      const k = i * 4;
      alb[k] = lin2srgb8(r); alb[k + 1] = lin2srgb8(g); alb[k + 2] = lin2srgb8(b); alb[k + 3] = 255;
      orm[k] = 255 - d * 60 - ru * 30; orm[k + 1] = clamp(rough) * 255; orm[k + 2] = metal * 255; orm[k + 3] = 255;
      Hgt[i] -= d * 0.05;
    }
  }
  const nrm = normalFromHeight(Hgt, w, h, 1.4 * (ppm / 200), tile);
  return { map: makeTex(alb, w, h, { srgb: true, repeat: tile }), orm: makeTex(orm, w, h, { repeat: tile }), normal: makeTex(nrm, w, h, { repeat: tile }), w, h };
}

/* ------------------------------------------------------------------ Asphalt (kachelbar) */
export function asphaltTile(size = 1024, metres = 4) {
  const w = size, h = size, N = w * h, ppm = size / metres;
  const H = new Float32Array(N), alb = new Uint8Array(N * 4), orm = new Uint8Array(N * 4);
  const wo = [0, 0, 0], wo2 = [0, 0, 0];
  const per = (f) => Math.round(metres * f);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x / ppm, Y = y / ppm, i = y * w + x;
    const fA = per(70), fB = per(160);
    worley(X * fA / metres, Y * fA / metres, fA, wo);
    worley(X * fB / metres, Y * fB / metres, fB, wo2);
    const stone = sstep(0.42, 0.28, wo[0]) * (0.4 + 0.6 * wo[2]);       // Splitt
    const fine = sstep(0.4, 0.25, wo2[0]) * wo2[2];
    const n1 = fbm(X * per(0.8) / metres, Y * per(0.8) / metres, 4, per(0.8));
    const n2 = fbm(X * per(6) / metres, Y * per(6) / metres, 4, per(6));
    const cr = ridge(X * per(1.2) / metres + 0.3, Y * per(1.2) / metres, 4, per(1.2));
    const crack = sstep(0.93, 0.985, cr) * sstep(0.45, 0.6, n1);
    const binder = 0.028 + 0.016 * n2;
    let v = binder + stone * (0.05 + 0.05 * wo[2]) * (0.4 + n1) + fine * 0.02;
    const worn = sstep(0.5, 0.75, n1); // Ausgefahren: Splitt liegt frei, heller
    v = v * (1 + worn * 0.5);
    v *= 1 - crack * 0.7;
    const r = v * 1.0, g = v * 0.98, b = v * 0.95;
    const k = i * 4;
    alb[k] = lin2srgb8(r); alb[k + 1] = lin2srgb8(g); alb[k + 2] = lin2srgb8(b); alb[k + 3] = 255;
    orm[k] = 255 - crack * 120 - (1 - stone) * 25; orm[k + 1] = clamp(0.88 - stone * 0.18 + n2 * 0.1 - worn * 0.05) * 255; orm[k + 2] = 0; orm[k + 3] = 255;
    H[i] = stone * 0.6 + fine * 0.25 + n2 * 0.2 - crack * 1.2;
  }
  const nrm = normalFromHeight(H, w, h, 2.2, true);
  return { map: makeTex(alb, w, h, { srgb: true, repeat: true }), orm: makeTex(orm, w, h, { repeat: true }), normal: makeTex(nrm, w, h, { repeat: true }) };
}

/**
 * Hofkarte (nicht kachelnd) über ein Rechteck der Welt: R = Pfützen, G = Ölflecken/Teer, B = Farbmarkierung (Stärke),
 * A = Markierungsfarbe (0 = weiß, 1 = gelb). Dazu Höhen-/Rissmaske über Teerfugen.
 */
export function yardMap(rect, size = 2048, { lines = [], puddles = [], seed = 3 } = {}) {
  const [x0, z0, x1, z1] = rect;
  const w = size, h = size, N = w * h;
  const data = new Uint8Array(N * 4);
  const R = rng(seed);
  const stains = Array.from({ length: 90 }, () => ({ x: mix(x0, x1, R()), z: mix(z0, z1, R()), r: 0.3 + R() * 1.4, k: R() }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = mix(x0, x1, (x + 0.5) / w), Z = mix(z0, z1, (y + 0.5) / h);
    // Pfützen: Senken aus Rauschen + gesetzte Pfützen
    let pud = 0, pn = -1;
    for (const p of puddles) {
      const dx = (X - p.x) / p.rx, dz = (Z - p.z) / p.rz;
      if (dx * dx + dz * dz > 2.6) continue;
      if (pn < 0) pn = fbm(X * 1.5, Z * 1.5, 4);
      const d = Math.sqrt(dx * dx + dz * dz) + (pn - 0.5) * 0.9;
      pud = Math.max(pud, sstep(1.0, 0.82, d));
    }
    // Öl/Teer
    let oil = 0;
    for (const s of stains) {
      if (Math.abs(X - s.x) > s.r * 1.4 || Math.abs(Z - s.z) > s.r * 1.4) continue;
      const d = Math.hypot(X - s.x, Z - s.z) / s.r + (vn(X * 3 + s.k * 50, Z * 3) - 0.5) * 0.8;
      if (d < 1) oil = Math.max(oil, sstep(1, 0.4, d) * (0.4 + 0.6 * s.k));
    }
    // Teerfugen (vergossene Risse): lange gewundene Linien
    const tr = ridge(X * 0.09 + 3.1, Z * 0.09 + 1.7, 3);
    const tar = sstep(0.965, 0.99, tr);
    oil = Math.max(oil, tar * 0.95);
    // Markierungen
    let paint = 0, yellow = 0;
    for (const L of lines) {
      // Segment (ax,az)-(bx,bz), Breite wd, Strich (dash) optional
      const vx = L.bx - L.ax, vz = L.bz - L.az, len = Math.hypot(vx, vz);
      const t = ((X - L.ax) * vx + (Z - L.az) * vz) / (len * len);
      if (t < 0 || t > 1) continue;
      const px = L.ax + vx * t - X, pz = L.az + vz * t - Z;
      const d = Math.hypot(px, pz);
      if (d > L.wd) continue;
      if (L.dash && ((t * len) % (L.dash * 2)) > L.dash) continue;
      const wear = sstep(0.3, 0.62, fbm(X * 2.2, Z * 2.2, 5) + vn(X * 30, Z * 30) * 0.25);
      const p = sstep(L.wd, L.wd * 0.8, d) * wear;
      if (p > paint) { paint = p; yellow = L.yellow ? 1 : 0; }
    }
    const k = (y * w + x) * 4;
    data[k] = pud * 255; data[k + 1] = oil * 255; data[k + 2] = paint * 255; data[k + 3] = yellow * 255;
  }
  const t = makeTex(data, w, h, {});
  return t;
}

/* ------------------------------------------------------------------ Stoff / Tarnung / Handschuh / Waffe (kachelbar) */
/** Gewebe-Höhe + Rauheit, Leinwandbindung. Liefert normal (RGB) + rough in A? → zwei Texturen. */
export function weaveTile(size = 256, threads = 32, { twill = false } = {}) {
  const w = size, h = size, N = w * h, H = new Float32Array(N), d = new Uint8Array(N * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x / w) * threads, v = (y / h) * threads;
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const over = twill ? ((iu + iv) % 4) < 2 : ((iu + iv) & 1) === 0;
    const warp = Math.sin(fu * Math.PI), weft = Math.sin(fv * Math.PI);
    const n = vn(u * 2.0, v * 0.5, threads * 2) * 0.25 + vn(u * 0.5, v * 2.0, threads * 2) * 0.25;
    const hv = (over ? warp * (0.6 + 0.4 * weft) : weft * (0.6 + 0.4 * warp)) + n;
    H[y * w + x] = hv;
    const k = (y * w + x) * 4;
    d[k] = Math.max(0, Math.min(255, hv / 1.3 * 255)); d[k + 1] = 128 + (n - 0.25) * 200; d[k + 2] = 128; d[k + 3] = 255;
  }
  return { normal: makeTex(normalFromHeight(H, w, h, 1.6, true), w, h, { repeat: true }), var: makeTex(d, w, h, { repeat: true }) };
}

/** Tarnmuster (Multi-Terrain-artig), kachelbar, sRGB. */
export function camoTile(size = 512) {
  const w = size, h = size, d = new Uint8Array(w * h * 4);
  const cols = ['#7b7259', '#5d5a43', '#9a8c6c', '#3f3d2c', '#b8a988', '#6c6648'].map(hex);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    let c = cols[0];
    const a = fbm(u * 5 + 1, v * 9 + 2, 4, 5), b = fbm(u * 7 + 7, v * 11 + 3, 4, 7), e = fbm(u * 12 + 5, v * 18, 3, 12), f = fbm(u * 16, v * 10 + 9, 3, 16);
    if (a > 0.56) c = cols[1];
    if (b > 0.58) c = cols[2];
    if (e > 0.62) c = cols[3];
    if (f > 0.66) c = cols[4];
    if (a < 0.36 && b < 0.45) c = cols[5];
    const n = 0.92 + vn(u * 256, v * 256, 256) * 0.16;
    const k = (y * w + x) * 4;
    d[k] = lin2srgb8(c[0] * n); d[k + 1] = lin2srgb8(c[1] * n); d[k + 2] = lin2srgb8(c[2] * n); d[k + 3] = 255;
  }
  return makeTex(d, w, h, { srgb: true, repeat: true });
}

/**
 * Waffen-Detail (kachelbar, für Dreifach-Projektion): R = Fingerabdrücke (Rillenringe), G = Ölfilm/Wischer,
 * B = Feinrauschen, A = Kratzer.
 */
export function gunDetailTile(size = 1024) {
  const w = size, h = size, d = new Uint8Array(w * h * 4);
  const R = rng(9);
  const prints = Array.from({ length: 26 }, () => ({ x: R(), y: R(), r: 0.035 + R() * 0.03, a: R() * 3.14, e: 0.6 + R() * 0.3, f: 85 + R() * 30 }));
  const scr = Array.from({ length: 70 }, () => ({ x: R(), y: R(), a: R() * 3.14, l: 0.02 + R() * 0.12 }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    let fp = 0;
    for (const p of prints) {
      let dx = u - p.x, dy = v - p.y; dx -= Math.round(dx); dy -= Math.round(dy);
      const ca = Math.cos(p.a), sa = Math.sin(p.a);
      const rx = (dx * ca + dy * sa) / p.e, ry = -dx * sa + dy * ca;
      const r = Math.hypot(rx, ry) / p.r;
      if (r > 1) continue;
      const ridges = 0.5 + 0.5 * Math.sin(r * p.f * p.r * 6.28 + vn(u * 300, v * 300) * 2);
      fp = Math.max(fp, ridges * sstep(1, 0.5, r) * (0.6 + 0.4 * vn(u * 60, v * 60)));
    }
    const oil = sstep(0.55, 0.8, fbm(u * 4, v * 4, 4, 4));
    let sc = 0;
    for (const s of scr) {
      let dx = u - s.x, dy = v - s.y; dx -= Math.round(dx); dy -= Math.round(dy);
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const t = dx * ca + dy * sa, n = -dx * sa + dy * ca;
      if (Math.abs(t) < s.l && Math.abs(n) < 0.0015) sc = Math.max(sc, (1 - Math.abs(n) / 0.0015) * (1 - Math.abs(t) / s.l));
    }
    const k = (y * w + x) * 4;
    d[k] = fp * 255; d[k + 1] = oil * 255; d[k + 2] = fbm(u * 64, v * 64, 3, 64) * 255; d[k + 3] = sc * 255;
  }
  return makeTex(d, w, h, { repeat: true });
}

/** Wasser-Normalen (kachelbar). */
export function waterNormal(size = 512) {
  const w = size, h = size, H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    H[y * w + x] = fbm(u * 6, v * 14, 5, 6) + 0.5 * fbm(u * 24 + 3, v * 40, 3, 24);
  }
  return makeTex(normalFromHeight(H, w, h, 3, true), w, h, { repeat: true });
}
