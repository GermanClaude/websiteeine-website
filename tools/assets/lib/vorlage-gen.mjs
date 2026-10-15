// Prozedurale Texturen im Stil der Video-Vorlage (Grafik-Plan Etappe 2, docs/planung/grafik-vorlage-plan.md).
// Jeder Generator liefert für eine Kantenlänge `size` drei kachelbare Bilder (RGBA8, Zeile 0 = oben):
//   albedo (sRGB) · normal (OpenGL: +Y = Bildoberkante) · orm (R = Verdeckung, G = Rauheit, B = Metall)
// Grundlage ist ein Höhenfeld (plastische Rippen, Fugen, Risse – „3D-mäßig“, Nutzer 12./13.10.), aus dem Normalen und
// Hohlraum-Verdeckung entstehen; Farben gedeckt wie im Video (bild-0_3s, bild-2_0s, bild-3_5s, bild-6_5s).
// Einfärbbare Sätze (Container, Blech) sind fast neutral hell: die Farbe kommt aus dem Material (tint).

/* ------------------------------------------------------------------ Rauschen (periodisch, deterministisch) */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Periodisches Value-Noise mit Oktaven: n(u, v, px, py, oct) ∈ [0, 1], px/py = Zellen je Kachel. */
function makeNoise(seed) {
  const rnd = rng(seed), tables = new Map();
  const table = (p, q) => { const k = p * 4096 + q; if (!tables.has(k)) tables.set(k, Float32Array.from({ length: p * q }, rnd)); return tables.get(k); };
  const fade = (t) => t * t * (3 - 2 * t);
  const value = (u, v, p, q) => {
    const t = table(p, q), x = u * p, y = v * q, xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
    const i0 = ((xi % p) + p) % p, j0 = ((yi % q) + q) % q, i1 = (i0 + 1) % p, j1 = (j0 + 1) % q;
    const a = t[j0 * p + i0], b = t[j0 * p + i1], c = t[j1 * p + i0], d = t[j1 * p + i1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (u, v, px, py = px, oct = 4) => {
    let sum = 0, amp = 1, norm = 0, p = px, q = py;
    for (let o = 0; o < oct; o++) { sum += value(u, v, p, q) * amp; norm += amp; amp *= 0.5; p *= 2; q *= 2; }
    return sum / norm;
  };
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255));
function toLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const toSrgb8 = (c) => Math.round(255 * clamp01(c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(clamp01(c), 1 / 2.4) - 0.055));
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/* ------------------------------------------------------------------ Höhenfeld → Normalen / Verdeckung */
function heightToNormal(h, size, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size, yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const hx = (h[yc + xp] - h[yc + xm]) * 0.5 * strength, hy = (h[yp + x] - h[ym + x]) * 0.5 * strength;
      let nx = -hx, ny = hy, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const o = (yc + x) * 4;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255); out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255); out[o + 3] = 255;
    }
  }
  return out;
}
/** Kastenunschärfe (periodisch), r in Pixeln – für Hohlraum-Verdeckung. */
function blur(src, size, r) {
  const tmp = new Float32Array(size * size), out = new Float32Array(size * size), w = 2 * r + 1;
  for (let y = 0; y < size; y++) { let s = 0; for (let k = -r; k <= r; k++) s += src[y * size + ((k + size) % size)]; for (let x = 0; x < size; x++) { tmp[y * size + x] = s / w; s += src[y * size + ((x + r + 1) % size)] - src[y * size + ((x - r + size) % size)]; } }
  for (let x = 0; x < size; x++) { let s = 0; for (let k = -r; k <= r; k++) s += tmp[((k + size) % size) * size + x]; for (let y = 0; y < size; y++) { out[y * size + x] = s / w; s += tmp[((y + r + 1) % size) * size + x] - tmp[((y - r + size) % size) * size + x]; } }
  return out;
}
/** Hohlraum: Pixel unterhalb der geglätteten Umgebung werden dunkler (Fugen, Rillen, Risse). */
function cavity(h, size, radiusFrac, k) {
  const r = Math.max(1, Math.round(size * radiusFrac));
  const b = blur(h, size, r), ao = new Float32Array(size * size);
  for (let i = 0; i < ao.length; i++) ao[i] = clamp01(1 - Math.max(0, b[i] - h[i]) * k);
  return ao;
}

/* ------------------------------------------------------------------ Bauen */
function assemble(size, fn, { normal = 6, cav = [0.01, 2.2], aoMin = 0.35 } = {}) {
  const n = size * size, H = new Float32Array(n), A = new Float32Array(n * 3), R = new Float32Array(n), M = new Float32Array(n), O = new Float32Array(n).fill(1);
  const px = { h: 0, col: null, rough: 0.7, metal: 0, ao: 1 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    px.h = 0; px.col = null; px.rough = 0.7; px.metal = 0; px.ao = 1;
    fn((x + 0.5) / size, 1 - (y + 0.5) / size, px); // v = 1 oben
    H[i] = px.h; A[i * 3] = px.col[0]; A[i * 3 + 1] = px.col[1]; A[i * 3 + 2] = px.col[2]; R[i] = px.rough; M[i] = px.metal; O[i] = px.ao;
  }
  const ao = cavity(H, size, cav[0], cav[1]);
  const albedo = new Uint8Array(n * 4), orm = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const occ = Math.max(aoMin, ao[i] * O[i]);
    // Albedo bekommt einen Teil der Verdeckung (Schmutz sammelt sich in Fugen), der Rest wirkt als AO-Karte
    const dirt = 0.55 + 0.45 * occ;
    albedo[i * 4] = toSrgb8(A[i * 3] * dirt); albedo[i * 4 + 1] = toSrgb8(A[i * 3 + 1] * dirt); albedo[i * 4 + 2] = toSrgb8(A[i * 3 + 2] * dirt); albedo[i * 4 + 3] = 255;
    orm[i * 4] = Math.round(occ * 255); orm[i * 4 + 1] = Math.round(clamp01(R[i]) * 255); orm[i * 4 + 2] = Math.round(clamp01(M[i]) * 255); orm[i * 4 + 3] = 255;
  }
  // Normalenstärke bezieht sich auf die Kachel: gleiche Wirkung in jeder Stufe
  const nrm = heightToNormal(H, size, normal * size / 1024);
  const img = (data) => ({ data, width: size, height: size });
  return { albedo: img(albedo), normal: img(nrm), orm: img(orm) };
}

/* ------------------------------------------------------------------ Generatoren */
export const GENERATORS = {
  /**
   * Containerwand (bild-2_0s): Trapezsicken senkrecht, 8 je Kachel (2,24 m → Teilung 0,28 m wie ISO-Container),
   * gealterter Lack (heller Grund, Farbe aus tint), Rostnester an Sickenkanten und unten, Laufspuren von oben,
   * Kratzer, leichte Beulen.
   */
  container(size) {
    const n1 = makeNoise(11), n2 = makeNoise(12), n3 = makeNoise(13), n4 = makeNoise(14);
    const paint = hex('#c9c7c2'), rust = hex('#6e4630'), rustDark = hex('#3f2c22'), grime = hex('#77736b');
    const RIBS = 8;
    return assemble(size, (u, v, p) => {
      const t = (u * RIBS) % 1;
      // Trapez: oben 0..0,36, Flanke 0,36..0,5, unten 0,5..0,86, Flanke 0,86..1
      const prof = t < 0.36 ? 1 : t < 0.5 ? 1 - (t - 0.36) / 0.14 : t < 0.86 ? 0 : (t - 0.86) / 0.14;
      const flank = (t > 0.34 && t < 0.52) || t > 0.84 || t < 0.02 ? 1 : 0;
      const dent = (n4(u, v, 3, 3, 3) - 0.5) * 0.35;
      p.h = prof * 1.0 + dent + (n1(u, v, 64, 64, 2) - 0.5) * 0.02;
      // Laufspuren: in u fein, in v lang gezogen, oben stärker
      const streak = smooth(0.55, 0.8, n2(u, v, 48, 2, 3)) * (0.35 + 0.65 * v);
      // Rost: Flanken + unteres Drittel + Flecken
      // Rost sparsam: kleine Nester an Flanken und unten, darunter kurze Rostläufer (Video: Lack überwiegt)
      const spot = smooth(0.76, 0.86, n3(u, v, 14, 14, 5) + flank * 0.05 + (1 - v) * 0.1 * smooth(0.5, 0.75, n1(u, v, 6, 6, 3)));
      const drip = smooth(0.8, 0.9, n3(u, (v + 0.02) % 1, 14, 14, 5)) * smooth(0.6, 0.85, n2(u, v, 90, 3, 2)) * 0.6;
      const rustMask = Math.max(spot, drip);
      const scratch = smooth(0.93, 0.97, n1(u * 1.0, v, 160, 6, 2));
      let col = paint.map((c) => c * (0.92 + 0.12 * n4(u, v, 16, 16, 3)));
      col = mix3(col, grime, streak * 0.45);
      col = mix3(col, mix3(rust, rustDark, n2(u, v, 40, 40, 2)), rustMask * 0.8);
      col = mix3(col, hex('#d8d6d0'), scratch * 0.35 * (1 - rustMask));
      p.col = col;
      p.rough = 0.52 + streak * 0.12 + rustMask * 0.33;
      p.ao = 1 - 0.18 * (1 - prof);
    }, { normal: 9, cav: [0.012, 1.4], aoMin: 0.5 });
  },

  /**
   * Kaibeton (bild-2_0s, bild-0_3s): 2 × 2 Platten je 6-m-Kachel mit Fugen, Haarrissen, Flecken, Körnung; hell-grau.
   */
  concrete_slab(size) {
    const n1 = makeNoise(21), n2 = makeNoise(22), n3 = makeNoise(23), n4 = makeNoise(24), n5 = makeNoise(25);
    const base = hex('#a39f97'), dark = hex('#6f6b64'), stain = hex('#8b857a'), oil = hex('#55524d');
    const joint = 0.0028; // ≈ 1,7 cm bei 6 m
    return assemble(size, (u, v, p) => {
      const su = (u * 2) % 1, sv = (v * 2) % 1, slab = Math.floor(u * 2) + 2 * Math.floor(v * 2);
      const dj = Math.min(su, 1 - su, sv, 1 - sv) / 2; // Abstand zur Fuge (Kachelanteil)
      const jointM = 1 - smooth(joint * 0.5, joint * 1.6, dj);
      const edge = 1 - smooth(joint, joint * 5, dj); // gebrochene Plattenkante
      // Risse: Nulllinien eines verzerrten Rauschens, nur stellenweise
      const w = n2(u, v, 3, 3, 2);
      const c1 = Math.abs(n1((u + w * 0.08) % 1, (v + w * 0.05) % 1, 5, 5, 4) - 0.5);
      const crackOn = smooth(0.56, 0.66, n3(u, v, 4, 4, 2));
      const crack = (1 - smooth(0.0, 0.0045, c1)) * crackOn;
      const grain = n4(u, v, 256, 256, 2);
      p.h = 0.6 + (grain - 0.5) * 0.06 + (n5(u, v, 24, 24, 3) - 0.5) * 0.05 - jointM * 0.7 - edge * 0.12 - crack * 0.5;
      const tone = 0.93 + 0.1 * ((slab * 0.37) % 1) + 0.08 * (n5(u, v, 6, 6, 4) - 0.5);
      let col = base.map((c) => c * tone * (0.94 + 0.12 * grain));
      col = mix3(col, stain, smooth(0.58, 0.8, n3(u, v, 3, 3, 5)) * 0.5);
      col = mix3(col, oil, smooth(0.72, 0.85, n2(u, v, 7, 7, 4)) * 0.45);
      col = mix3(col, dark, Math.max(jointM * 0.85, crack * 0.8, edge * 0.25));
      p.col = col;
      p.rough = 0.86 + 0.08 * grain - smooth(0.72, 0.85, n2(u, v, 7, 7, 4)) * 0.2;
      p.ao = 1 - jointM * 0.45 - crack * 0.4;
    }, { normal: 5, cav: [0.004, 3], aoMin: 0.35 });
  },

  /**
   * Hallen-Trapezblech (bild-0_3s, bild-6_5s): senkrechte Trapezrippen (12 je 2,7 m), Stoß mit Schraubenreihe,
   * grau-grüner Lack (Farbe zusätzlich über tint), Laufspuren, wenig Rost.
   */
  cladding(size) {
    const n1 = makeNoise(31), n2 = makeNoise(32), n3 = makeNoise(33);
    const paint = hex('#c4c8c4'), grime = hex('#6d716c'), rust = hex('#6a4a35');
    const RIBS = 12;
    return assemble(size, (u, v, p) => {
      const t = (u * RIBS) % 1;
      const prof = t < 0.22 ? 1 : t < 0.32 ? 1 - (t - 0.22) / 0.1 : t < 0.9 ? 0 : (t - 0.9) / 0.1;
      // flache Zwischenfelder mit zwei leichten Versteifungsrillen
      const mid = t >= 0.32 && t < 0.9 ? 0.08 * (smooth(0.48, 0.5, t) - smooth(0.52, 0.54, t) + smooth(0.68, 0.7, t) - smooth(0.72, 0.74, t)) : 0;
      const seam = 1 - smooth(0.0, 0.012, Math.min(v, 1 - v)); // Überlappung unten/oben
      const screwRow = Math.abs(v - 0.02) < 0.006 || Math.abs(v - 0.98) < 0.006;
      const screw = screwRow && t > 0.06 && t < 0.16 ? 1 - smooth(0.0, 0.006, Math.hypot(((t - 0.11) / RIBS), (Math.min(Math.abs(v - 0.02), Math.abs(v - 0.98))))) : 0;
      p.h = prof * 1.0 + mid - seam * 0.15 + screw * 0.25 + (n1(u, v, 40, 40, 2) - 0.5) * 0.015;
      const streak = smooth(0.5, 0.82, n2(u, v, 60, 2, 3)) * (0.3 + 0.7 * v);
      const rustM = smooth(0.74, 0.86, n3(u, v, 12, 12, 4)) * (0.4 + 0.6 * (1 - v));
      let col = paint.map((c) => c * (0.93 + 0.1 * n3(u, v, 8, 8, 3)));
      col = mix3(col, grime, streak * 0.4 + seam * 0.3);
      col = mix3(col, rust, rustM * 0.7 + screw * 0.6);
      p.col = col;
      p.rough = 0.5 + streak * 0.15 + rustM * 0.3;
      p.ao = 1 - 0.12 * (1 - prof) - seam * 0.2;
    }, { normal: 8, cav: [0.01, 1.2], aoMin: 0.55 });
  },

  /**
   * Ziegelwand (bild-5_0s, bild-6_5s): Läuferverband, 6 Steine × 18 Schichten je 1,5 m, rot-braune Steine mit
   * Farbstreuung, abgestoßene Kanten, zurückliegende hellgraue Fugen.
   */
  brick(size) {
    const n1 = makeNoise(41), n2 = makeNoise(42), n3 = makeNoise(43);
    const reds = ['#8a3f2a', '#93452d', '#7f3a27', '#9a4b31', '#86412c', '#8f4a35'].map(hex);
    const mortar = hex('#8e877d'), soot = hex('#3a2a24');
    const ROWS = 18, COLS = 6, jy = 0.12, jx = 0.04; // Fugen als Anteil der Schicht/des Steins
    const hashI = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    return assemble(size, (u, v, p) => {
      const row = Math.floor(v * ROWS), fv = v * ROWS - row;
      const off = row % 2 ? 0.5 : 0;
      const cx = u * COLS + off, col = Math.floor(cx) % COLS, fu = cx - Math.floor(cx);
      const dy = Math.min(fv, 1 - fv);
      // gerundete Steinkanten (Fase ≈ 1 cm) statt harter Stufe – „3D-mäßig“
      const inBrick = smooth(jy * 0.5, jy * 0.5 + 0.12, dy) * smooth(jx * 0.5, jx * 0.5 + 0.05, Math.min(fu, 1 - fu));
      const chip = smooth(0.62, 0.7, n1(u, v, 60, 60, 3)) * (1 - smooth(0.0, 0.18, Math.min(dy, Math.min(fu, 1 - fu) * 3)));
      const r = hashI(col + 17, row + 3);
      const brickCol = reds[Math.floor(r * reds.length)].map((c) => c * (0.92 + 0.14 * hashI(col, row)));
      const surf = n2(u, v, 120, 120, 3), speck = n1(u, v, 320, 320, 2);
      p.h = inBrick * (0.8 + (surf - 0.5) * 0.12 + (speck - 0.5) * 0.05) - chip * 0.25 * inBrick + (1 - inBrick) * (0.15 + (n3(u, v, 200, 200, 2) - 0.5) * 0.05);
      let c = mix3(mortar.map((m) => m * (0.9 + 0.15 * n3(u, v, 90, 90, 2))), brickCol.map((b) => b * (0.86 + 0.18 * surf + 0.14 * (speck - 0.5))), inBrick);
      c = mix3(c, soot, smooth(0.66, 0.85, n2(u, v, 4, 4, 4)) * 0.25);
      p.col = c;
      p.rough = mix(0.92, 0.82, inBrick);
      p.ao = 1 - (1 - inBrick) * 0.35;
    }, { normal: 7, cav: [0.006, 2.2], aoMin: 0.45 });
  },
};
