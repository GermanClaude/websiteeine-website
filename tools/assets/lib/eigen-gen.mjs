// NULLPUNKT — eigene PBR-Texturen (Nutzer 16.10.: „jede Textur, die von Open-Source-Seiten stammt, selber machen“).
// Ersetzt die früheren Poly-Haven-/ambientCG-Sätze unter derselben Id (Zuordnung in world/library.js bleibt): jeder
// Generator liefert für eine Kantenlänge `size` kachelbare Albedo/Normal/ORM-Bilder (wie lib/vorlage-gen.mjs) aus einem
// Höhenfeld (Fugen, Risse, Maserung, Rippen → Normalen + Hohlraum-Verdeckung). Danach wird die Albedo kanalweise auf
// die mittlere Farbe des alten Satzes kalibriert (TARGET, linear gemittelt) – so bleiben die Kalibrierfaktoren der
// Karten und die Lichtabstimmung gültig, nur das Bild ist neu und eigen.
import { makeNoise, clamp01, smooth, mix, hex, mix3, assemble, toLin } from './vorlage-gen.mjs';

/* ------------------------------------------------------------------ Hilfen */
const hashI = (a, b, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const frac = (x) => x - Math.floor(x);
const wrap = (i, n) => ((i % n) + n) % n;

/** Periodische Voronoi-Zellen: n × n Punkte je Kachel. → { d1, d2, id, fx, fy } (Abstände in Zellen). */
function makeCells(n, seed, jitter = 0.85) {
  const px = new Float32Array(n * n), py = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    px[j * n + i] = 0.5 + (hashI(i, j, seed) - 0.5) * jitter;
    py[j * n + i] = 0.5 + (hashI(i + 101, j + 37, seed) - 0.5) * jitter;
  }
  const out = { d1: 0, d2: 0, id: 0, cx: 0, cy: 0, ex: 0 };
  return (u, v) => {
    const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y);
    let d1 = 9, d2 = 9, id = 0, cx = 0, cy = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ci = wrap(xi + di, n), cj = wrap(yi + dj, n), k = cj * n + ci;
      const qx = xi + di + px[k], qy = yi + dj + py[k];
      const d = (qx - x) * (qx - x) + (qy - y) * (qy - y);
      if (d < d1) { d2 = d1; d1 = d; id = k; cx = qx; cy = qy; } else if (d < d2) d2 = d;
    }
    out.d1 = Math.sqrt(d1); out.d2 = Math.sqrt(d2); out.id = id; out.cx = cx / n; out.cy = cy / n;
    out.ex = out.d2 - out.d1; // ≈ Abstand zur Zellgrenze (Kantenmaß)
    return out;
  };
}

/**
 * Periodische Striche (Halme, Kratzer, Fasern): n × n Zellen mit je m Strichen (Lage, Winkel, Länge, Breite zufällig).
 * ang: [Mitte, Streuung] in rad; len/wid in Kachelanteilen. → { m: Deckung 0..1, id, t: Lage entlang 0..1 }
 */
function makeStrokes(n, m, seed, { ang = [0, Math.PI], len = [0.6, 1.2], wid = [0.04, 0.08] } = {}) {
  const N = n * n * m, P = new Float32Array(N * 6);
  for (let k = 0; k < N; k++) {
    const a = ang[0] + (hashI(k, 5, seed) - 0.5) * 2 * ang[1];
    P[k * 6] = hashI(k, 1, seed); P[k * 6 + 1] = hashI(k, 2, seed);
    P[k * 6 + 2] = Math.cos(a); P[k * 6 + 3] = Math.sin(a);
    P[k * 6 + 4] = (len[0] + (len[1] - len[0]) * hashI(k, 3, seed)) / n * 0.5;
    P[k * 6 + 5] = (wid[0] + (wid[1] - wid[0]) * hashI(k, 4, seed)) / n * 0.5;
  }
  const out = { m: 0, id: -1, t: 0 };
  const R = Math.ceil(Math.max(len[1], 1) * 0.5 + 0.5);
  return (u, v) => {
    const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y);
    out.m = 0; out.id = -1; out.t = 0;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const ci = wrap(xi + di, n), cj = wrap(yi + dj, n);
      for (let s = 0; s < m; s++) {
        const k = (cj * n + ci) * m + s, o = k * 6;
        const dx = u - (xi + di + P[o]) / n, dy = v - (yi + dj + P[o + 1]) / n;
        const al = dx * P[o + 2] + dy * P[o + 3], ac = -dx * P[o + 3] + dy * P[o + 2];
        const L = P[o + 4]; if (al > L || al < -L) continue;
        const t = (al + L) / (2 * L), W = P[o + 5] * (1 - t * t * 0.85); // zur Spitze schmaler
        const c = smooth(W, W * 0.35, Math.abs(ac));
        if (c > out.m || (c > 0 && hashI(k, 9, seed) > 0.5 && c > out.m * 0.9)) { out.m = c; out.id = k; out.t = t; }
      }
    }
    return out;
  };
}

/** Kalibrierung: Albedo kanalweise (linear) auf die Zielfarbe skalieren; ORM-Rauheit optional auf Zielmittel. */
function calibrate(set, target, roughTarget = null, metalTarget = null) {
  const a = set.albedo.data, n = a.length / 4;
  const sum = [0, 0, 0]; let wsum = 0;
  for (let i = 0; i < n; i++) { const w = a[i * 4 + 3] / 255; wsum += w; for (let c = 0; c < 3; c++) sum[c] += toLin(a[i * 4 + c] / 255) * w; }
  const t = hex(target);
  const k = t.map((tv, c) => tv / Math.max(1e-5, sum[c] / Math.max(1, wsum)));
  const toS = (x) => Math.round(255 * clamp01(x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(clamp01(x), 1 / 2.4) - 0.055));
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) a[i * 4 + c] = toS(toLin(a[i * 4 + c] / 255) * k[c]);
  if (roughTarget != null) {
    const o = set.orm.data; let r = 0;
    for (let i = 0; i < n; i++) r += o[i * 4 + 1];
    const kr = (roughTarget * 255) / Math.max(1, r / n);
    for (let i = 0; i < n; i++) o[i * 4 + 1] = Math.round(Math.min(255, o[i * 4 + 1] * kr));
  }
  if (metalTarget != null) {
    const o = set.orm.data; let m = 0;
    for (let i = 0; i < n; i++) m += o[i * 4 + 2];
    const km = (metalTarget * 255) / Math.max(1, m / n);
    for (let i = 0; i < n; i++) o[i * 4 + 2] = Math.round(Math.min(255, o[i * 4 + 2] * km));
  }
  return set;
}
// src: Generatorquelltext + Zielwerte → Teil des Bau-Rezepts (tools/assets/textures.mjs baut nur Geändertes neu)
const def = (target, rough, fn, metal = null) => Object.assign((size) => calibrate(fn(size), target, rough, metal), { src: fn.toString() + JSON.stringify([target, rough, metal]) });

/**
 * Verband (Ziegel, Fliesen, Blöcke): R Reihen, C Steine je Reihe, Versatz je zweiter Reihe; cuts: Reihe in zufällig
 * breite Steine teilen ([min, max] Anzahl). → { id, row, fu, fv (lokal 0..1), e (Kantenabstand in uv), w, h (Steinmaß uv) }
 */
function makeBond(R, C, { stagger = 0.5, seed = 0, cuts = null, rowJitter = 0 } = {}) {
  const rows = [];
  for (let r = 0; r < R; r++) {
    if (cuts) {
      const n = cuts[0] + Math.floor(hashI(r, 11, seed) * (cuts[1] - cuts[0] + 1));
      const w = Array.from({ length: n }, (_, k) => 0.55 + hashI(r, k + 20, seed)); const sum = w.reduce((a, b) => a + b, 0);
      let acc = hashI(r, 7, seed); const cs = [];
      for (let k = 0; k < n; k++) { cs.push(acc); acc += w[k] / sum; }
      rows.push(cs);
    } else rows.push(null);
  }
  const out = { id: 0, row: 0, fu: 0, fv: 0, e: 0, w: 0, h: 0 };
  return (u, v) => {
    const y = v * R, r = Math.floor(y), fy = y - r, rr = wrap(r, R);
    out.row = rr; out.fv = fy; out.h = 1 / R;
    if (rows[rr]) {
      const cs = rows[rr]; const n = cs.length;
      // Segment mit Start ≤ x (periodisch)
      let k = -1, x = u;
      for (let i = 0; i < n; i++) if (frac(x - cs[i]) < frac(x - (k < 0 ? cs[0] : cs[k])) || k < 0) k = i;
      const a = cs[k], b = cs[(k + 1) % n] + (k + 1 === n ? 1 : 0);
      const w = b - a, fx = frac(x - a) / w;
      out.id = rr * 64 + k; out.fu = fx; out.w = w;
      out.e = Math.min(Math.min(fx, 1 - fx) * w, Math.min(fy, 1 - fy) / R);
    } else {
      const off = (rr % 2 ? stagger : 0) + (rowJitter ? (hashI(rr, 3, seed) - 0.5) * rowJitter : 0);
      const x = u * C + off, c = Math.floor(x), fx = x - c;
      out.id = rr * C + wrap(c, C); out.fu = fx; out.w = 1 / C;
      out.e = Math.min(Math.min(fx, 1 - fx) / C, Math.min(fy, 1 - fy) / R);
    }
    return out;
  };
}

/** Holzmaserung entlang u (Bretter quer = v): Jahresringe + Fasern; seed je Brett. → [0,1] */
function grainAt(nA, nB, u, v, seed, along = 1) {
  const w = nA(u * 0.6 + seed * 0.37, v, 6, 3, 3);
  const ring = frac((v * 9 + w * 2.2 + seed * 3.1) * 1.0);
  const fib = nB(u, v + seed * 0.13, 6, 160, 2);
  return clamp01(0.55 * Math.abs(ring - 0.5) * 2 + 0.45 * fib) * along;
}

/**
 * Holz: a = Lage entlang der Faser, c = quer (beide in Kachel-uv, periodisch), sd = Brett-Zufall.
 * → { late: Spätholz-Linien 0..1, fib: Faser 0..1, knot: Ast 0..1 }
 */
function makeWood(seed, { rings = 26, knots = 0.25 } = {}) {
  const nA = makeNoise(seed), nB = makeNoise(seed + 1), nK = makeCells(5, seed + 2, 0.9);
  const out = { late: 0, fib: 0, knot: 0 };
  return (a, c, sd) => {
    const k = nK(a, c); const kOn = hashI(k.id, 1, seed) < knots ? 1 : 0;
    const kd = k.d1 * 5; // Abstand in Zellen*… → Ast-Einfluss
    const swirl = kOn * Math.exp(-kd * kd * 2.5) * 0.6;
    const warp = nA(a + sd * 0.31, c, 2, 6, 3) * 0.75 + swirl * Math.sign(c - k.cy);
    const ring = frac(c * rings + warp * 2 + sd * 5.3);
    out.late = (smooth(0.3, 0.92, ring) * (1 - smooth(0.92, 1, ring)) * 0.7 + 0.3 * smooth(0.3, 0.8, nB(a, c, 2, 90, 3))) * (0.6 + 0.4 * nB(a, c, 3, 30, 2));
    out.fib = nB(a, c + sd * 0.17, 8, 260, 2);
    out.knot = kOn * smooth(0.06, 0.02, k.d1 * (0.8 + 0.4 * hashI(k.id, 2, seed)));
    return out;
  };
}

/** Leinwandbindung: N Fäden je Kachel. → { h, gap, warp (1 = Kettfaden oben) } */
function weave(u, v, N, slub = null) {
  const x = u * N, y = v * N, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const over = (i + j) % 2 === 0;
  const pw = Math.cos((fx - 0.5) * Math.PI * 0.95), pf = Math.cos((fy - 0.5) * Math.PI * 0.95);
  const h = over ? pw * (0.75 + 0.25 * Math.sin(Math.PI * fy)) : pf * (0.75 + 0.25 * Math.sin(Math.PI * fx));
  const gap = (1 - smooth(0.06, 0.16, Math.min(fx, 1 - fx))) * (1 - smooth(0.06, 0.16, Math.min(fy, 1 - fy)));
  return { h: h * (1 - gap), gap, warp: over ? 1 : 0, i, j };
}

/* ------------------------------------------------------------------ Generatoren */
export const EIGEN = {
  /* ================================================================ Böden draußen */
  // Asphalt: Splittkörnung, Bitumen, Netzrisse, geflickte Felder, Ölflecken
  asphalt: def('#5c5c56', 0.77, (size) => {
    const n1 = makeNoise(1101), n2 = makeNoise(1102), n3 = makeNoise(1103), n4 = makeNoise(1104);
    const cells = makeCells(5, 1105, 0.9), pebbles = makeCells(90, 1106, 1.0);
    const bit = hex('#3b3b39'), stone = hex('#6d6b66'), patch = hex('#2f302f'), oil = hex('#262624');
    return assemble(size, (u, v, p) => {
      const pb = pebbles(u, v);
      const stoneM = smooth(0.4, 0.26, pb.d1) * (hashI(pb.id, 3, 1107) > 0.55 ? 1 : 0) * (0.5 + 0.5 * smooth(0.35, 0.6, n4(u, v, 10, 10, 3)));
      const c = cells(u, v);
      const crackOn = smooth(0.5, 0.62, n3(u, v, 4, 4, 2));
      const crack = (1 - smooth(0.0, 0.035 + 0.02 * n1(u, v, 30, 30, 2), c.ex)) * crackOn;
      const patchM = smooth(0.66, 0.7, n2(u, v, 3, 3, 3));
      const grain = n4(u, v, 200, 200, 2);
      p.h = 0.5 + stoneM * 0.18 + (grain - 0.5) * 0.08 - crack * 0.6 + patchM * 0.05;
      let col = mix3(bit, stone.map((x) => x * (0.75 + 0.5 * hashI(pb.id, 9, 1108))), stoneM * 0.55);
      col = col.map((x) => x * (0.9 + 0.2 * n1(u, v, 8, 8, 4)));
      col = mix3(col, patch, patchM * 0.75);
      col = mix3(col, oil, smooth(0.7, 0.85, n2(u, v, 9, 9, 4)) * 0.5);
      col = mix3(col, hex('#1c1c1b'), crack * 0.8);
      p.col = col;
      p.rough = 0.82 - patchM * 0.1 - smooth(0.7, 0.85, n2(u, v, 9, 9, 4)) * 0.25 + grain * 0.06;
      p.ao = 1 - crack * 0.5;
    }, { normal: 6, cav: [0.004, 2.5], aoMin: 0.4 });
  }),

  // Erde: Krume, Steinchen, Klumpen, Fußspuren-artige Mulden, trockene/feuchte Flecken
  dirt: def('#63533e', 0.94, (size) => {
    const n1 = makeNoise(1201), n2 = makeNoise(1202), n3 = makeNoise(1203);
    const peb = makeCells(36, 1204, 1.0), clods = makeCells(12, 1205, 1.0);
    const soil = hex('#6e5a42'), dark = hex('#4a3b2b'), dry = hex('#837055'), stone = hex('#76705f');
    return assemble(size, (u, v, p) => {
      const pb = peb(u, v), cl = clods(u, v);
      const stoneM = smooth(0.3, 0.18, pb.d1) * (hashI(pb.id, 1, 1206) > 0.8 ? 1 : 0) * 0.7;
      const clod = smooth(0.55, 0.2, cl.d1) * 0.5;
      const fine = n1(u, v, 120, 120, 3);
      const wet = smooth(0.55, 0.75, n2(u, v, 4, 4, 4));
      p.h = 0.4 + clod * 0.35 + stoneM * 0.3 + (fine - 0.5) * 0.25 - smooth(0.6, 0.8, n3(u, v, 6, 6, 3)) * 0.2;
      let col = mix3(soil, dry, smooth(0.45, 0.75, n3(u, v, 7, 7, 4)) * (1 - wet));
      col = mix3(col, dark, wet * 0.7);
      col = col.map((x) => x * (0.82 + 0.36 * fine));
      col = mix3(col, stone.map((x) => x * (0.8 + 0.4 * hashI(pb.id, 4, 1207))), stoneM);
      p.col = col;
      p.rough = 0.95 - wet * 0.15;
    }, { normal: 7, cav: [0.006, 2.0], aoMin: 0.45 });
  }),

  // Schlamm: dunkel, nass glänzende Mulden (Pfützenränder), Fahrspuren-Rillen
  mud: def('#4f4639', 0.95, (size) => {
    const n1 = makeNoise(1301), n2 = makeNoise(1302), n3 = makeNoise(1303);
    const mud = hex('#4d4336'), wetC = hex('#2f2a22'), dryC = hex('#6a5e4b');
    return assemble(size, (u, v, p) => {
      const base = n1(u, v, 5, 5, 5);
      const rut = Math.abs(Math.sin((u + 0.1 * n2(u, v, 3, 3, 2)) * Math.PI * 4));
      const puddle = smooth(0.62, 0.7, 1 - base);
      const fine = n3(u, v, 90, 90, 3);
      p.h = base * 0.6 - puddle * 0.25 + (fine - 0.5) * 0.15 + rut * 0.08;
      let col = mix3(mud, dryC, smooth(0.6, 0.8, base) * 0.6);
      col = mix3(col, wetC, puddle * 0.85);
      col = col.map((x) => x * (0.85 + 0.3 * fine));
      p.col = col;
      p.rough = mix(0.9, 0.18, puddle) + (fine - 0.5) * 0.05;
    }, { normal: 5, cav: [0.008, 1.6], aoMin: 0.5 });
  }),

  // Sand: feines Korn, Windrippel, einzelne Kiesel, Muschelsplitter
  sand: def('#938164', 0.97, (size) => {
    const n1 = makeNoise(1401), n2 = makeNoise(1402), n3 = makeNoise(1403);
    const peb = makeCells(40, 1404, 1.0);
    const sand = hex('#b3a07c'), dark = hex('#8d7b5d'), light = hex('#cbbb98');
    return assemble(size, (u, v, p) => {
      const warp = n2(u, v, 3, 3, 3);
      const ripple = 0.5 + 0.5 * Math.sin((v * 22 + warp * 3.2 + u * 1) * Math.PI * 2);
      const grain = n1(u, v, 256, 256, 2);
      const pb = peb(u, v);
      const pebble = smooth(0.22, 0.12, pb.d1) * (hashI(pb.id, 2, 1405) > 0.86 ? 1 : 0);
      p.h = ripple * 0.35 + (grain - 0.5) * 0.15 + pebble * 0.3;
      let col = mix3(dark, light, 0.35 + 0.4 * ripple * (0.5 + 0.5 * n3(u, v, 6, 6, 3)));
      col = col.map((x) => x * (0.85 + 0.3 * grain));
      col = mix3(col, hex('#7a7468'), pebble);
      p.col = mix3(col, sand, 0.3);
      p.rough = 0.96;
    }, { normal: 4, cav: [0.004, 1.2], aoMin: 0.6 });
  }),

  // Kies: dicht gepackte runde Steine verschiedener Farbe/Größe, dunkle Zwischenräume
  gravel: def('#ada99e', 0.47, (size) => {
    const c1 = makeCells(26, 1501, 0.95), c2 = makeCells(43, 1502, 0.95), n1 = makeNoise(1503);
    const cols = ['#aaa49a', '#9a958c', '#b3aa98', '#8f8b84', '#a39a8a', '#88837a'].map(hex), gap = hex('#57534b');
    return assemble(size, (u, v, p) => {
      const a = c1(u, v); const aId = a.id, ad1 = a.d1, aex = a.ex;
      const b = c2(u, v);
      const useB = b.d1 * 1.25 < ad1;
      const id = useB ? b.id + 5000 : aId, d1 = useB ? b.d1 : ad1, ex = useB ? b.ex : aex;
      const dome = Math.sqrt(clamp01(1 - (d1 / 0.62) ** 2));
      const inStone = smooth(0.02, 0.12, ex);
      p.h = inStone * (0.3 + dome * 0.7) + (n1(u, v, 150, 150, 2) - 0.5) * 0.06;
      const c = cols[Math.floor(hashI(id, 7, 1504) * cols.length)].map((x) => x * (0.85 + 0.3 * n1(u, v, 60, 60, 2)));
      p.col = mix3(gap, c, inStone);
      p.rough = mix(0.95, 0.55 + 0.2 * hashI(id, 3, 1505), inStone);
      p.ao = 0.55 + 0.45 * inStone;
    }, { normal: 9, cav: [0.006, 2.5], aoMin: 0.3 });
  }),

  // Trockener, gerissener Lehmboden: verzogene Schollen (Voronoi mit Verzerrung), feine Haarrisse, Staub, Krümel
  ground_dry: def('#867b6b', 0.83, (size) => {
    const cells = makeCells(13, 1601, 0.95), fine = makeCells(34, 1602, 0.95), n1 = makeNoise(1603), n2 = makeNoise(1604), n3 = makeNoise(1606);
    const peb = makeCells(60, 1607, 1.0);
    const clay = hex('#9d907c'), dark = hex('#4f463b'), dust = hex('#b3a690'), stone = hex('#857d70');
    return assemble(size, (u, v, p) => {
      const wu = u + (n3(u, v, 6, 6, 3) - 0.5) * 0.05, wv = v + (n3(u + 0.37, v + 0.71, 6, 6, 3) - 0.5) * 0.05;
      const c = cells(wu, wv); const cex = c.ex, cid = c.id;
      const f = fine(wu, wv);
      const w = 0.012 + 0.03 * n1(u, v, 14, 14, 3) ** 2;
      const crackOpen = smooth(0.3, 0.55, n2(u, v, 4, 4, 3)); // nicht überall gleich stark gerissen
      const crack = (1 - smooth(0.0, w, cex)) * (0.35 + 0.65 * crackOpen);
      const small = (1 - smooth(0.0, 0.018, f.ex)) * smooth(0.45, 0.7, n1(u + 0.5, v, 9, 9, 3)) * 0.6;
      const curl = smooth(0.06, 0.0, cex - w) * 0.18 * crackOpen;
      const grain = n2(u, v, 180, 180, 2);
      const pb = peb(u, v), pebble = smooth(0.28, 0.16, pb.d1) * (hashI(pb.id, 3, 1608) > 0.88 ? 1 : 0);
      p.h = 0.6 - crack * 0.7 - small * 0.25 + curl + (grain - 0.5) * 0.08 + pebble * 0.25;
      let col = clay.map((x) => x * (0.94 + 0.08 * hashI(cid, 2, 1605) + 0.16 * (n1(u, v, 30, 30, 3) - 0.5) + 0.1 * (grain - 0.5)));
      col = mix3(col, dust, smooth(0.55, 0.85, n3(u, v, 5, 5, 4)) * 0.45);
      col = mix3(col, stone.map((x) => x * (0.8 + 0.4 * hashI(pb.id, 5, 1609))), pebble);
      col = mix3(col, dark, Math.max(crack, small) * 0.8);
      p.col = col;
      p.rough = 0.86 - pebble * 0.15;
      p.ao = 1 - crack * 0.5;
    }, { normal: 6, cav: [0.005, 2.2], aoMin: 0.35 });
  }),

  // Schutt: Betonbrocken (verschieden grau/beige), wenige Ziegelsplitter, feiner Grus in den Lücken, Staubschleier
  rubble: def('#a19389', 0.9, (size) => {
    const big = makeCells(9, 1701, 0.95), mid = makeCells(22, 1702, 0.95), grit = makeCells(70, 1708, 1.0);
    const n1 = makeNoise(1703), n2 = makeNoise(1704), n3 = makeNoise(1709);
    const concs = ['#a19c93', '#8f8a82', '#aaa192', '#7f7a73', '#9a9184'].map(hex), brick = hex('#76594c'), dust = hex('#ada395'), gap = hex('#5f5850');
    return assemble(size, (u, v, p) => {
      const a = big(u, v); const aId = a.id, aex = a.ex, ad1 = a.d1, acx = a.cx, acy = a.cy;
      const b = mid(u, v);
      const pickB = b.d1 < ad1 * 0.75;
      const id = pickB ? b.id + 900 : aId, ex = pickB ? b.ex : aex;
      const chunk = smooth(0.01, 0.07, ex) * (pickB || hashI(aId, 8, 1710) > 0.25 ? 1 : 0);
      // Bruchflächen: je Brocken eine schräge Ebene + Bruchrauschen
      const tilt = (hashI(id, 1, 1705) - 0.5) * ((u - (pickB ? b.cx : acx)) * 9) + (hashI(id, 2, 1705) - 0.5) * ((v - (pickB ? b.cy : acy)) * 9);
      const facet = 0.35 + tilt * 0.6 + (n1(u, v, 50, 50, 3) - 0.5) * 0.25;
      const g = grit(u, v), gr = smooth(0.4, 0.2, g.d1) * 0.5;
      p.h = chunk * (0.45 + facet) + (1 - chunk) * gr * 0.3 + (n2(u, v, 220, 220, 2) - 0.5) * 0.06;
      const isBrick = hashI(id, 4, 1706) > 0.92;
      let col = (isBrick ? brick : concs[Math.floor(hashI(id, 6, 1707) * concs.length)]).map((x) => x * (0.88 + 0.2 * n3(u, v, 40, 40, 2)));
      const gritC = concs[Math.floor(hashI(g.id, 2, 1711) * concs.length)].map((x) => x * (0.7 + 0.3 * gr * 2));
      col = mix3(mix3(gap, gritC, gr * 1.6), col, chunk);
      col = mix3(col, dust, smooth(0.45, 0.8, n2(u, v, 6, 6, 4)) * 0.5 + 0.1);
      p.col = col;
      p.rough = 0.9;
      p.ao = 0.55 + 0.45 * Math.max(chunk, gr);
    }, { normal: 8, cav: [0.008, 2.4], aoMin: 0.3 });
  }),

  // Grasnarbe (Bodentextur unter dem Gras): Halme in drei Lagen (Striche, verschiedene Richtungen), trockene
  // Halme und Spitzen, Erde/Streu in den Lücken, Büschel-Helligkeit
  grass: def('#636f33', 0.27, (size) => {
    const n1 = makeNoise(1801), n3 = makeNoise(1803), n4 = makeNoise(1804);
    const L1 = makeStrokes(14, 3, 1805, { len: [1.4, 2.4], wid: [0.07, 0.12] });
    const L2 = makeStrokes(22, 3, 1806, { len: [1.4, 2.6], wid: [0.08, 0.13] });
    const L3 = makeStrokes(34, 2, 1807, { len: [1.2, 2.2], wid: [0.09, 0.14] });
    const g1 = hex('#4f6529'), g2 = hex('#7b8c3c'), dry = hex('#a19358'), soil = hex('#4d3f2e'), litter = hex('#7a6a4b');
    return assemble(size, (u, v, p) => {
      const clump = n3(u, v, 7, 7, 4), dryN = n4(u, v, 5, 5, 3);
      let h = 0, col = mix3(soil, litter, smooth(0.4, 0.7, n1(u, v, 40, 40, 3)) * 0.6), cover = 0;
      for (const [L, z] of [[L3, 0.25], [L2, 0.55], [L1, 0.85]]) {
        const s = L(u, v); if (s.m <= 0) continue;
        const isDry = hashI(s.id, 3, 1808) < 0.12 + 0.4 * smooth(0.55, 0.8, dryN);
        let c = mix3(g1, g2, hashI(s.id, 1, 1809) * 0.7 + s.t * 0.3);
        if (isDry) c = mix3(dry, dry.map((x) => x * 0.8), hashI(s.id, 2, 1810));
        c = mix3(c, dry, smooth(0.75, 1, s.t) * 0.35); // Spitzen heller/trocken
        c = c.map((x) => x * (0.75 + 0.35 * z + 0.15 * (clump - 0.5)));
        col = mix3(col, c, s.m); h = mix(h, z + 0.15 * s.t, s.m); cover = Math.max(cover, s.m);
      }
      p.h = h;
      p.col = col;
      p.rough = mix(0.95, 0.8, cover);
      p.ao = 0.6 + 0.4 * h;
    }, { normal: 5, cav: [0.004, 2.0], aoMin: 0.4 });
  }),

  /* ================================================================ Beton */
  // Ortbeton-Wand dunkel: Schalbrett-Abdrücke, Ankerlöcher im Raster, Nester, Wasserläufer
  concrete_wall_dark: def('#5c5146', 0.77, (size) => {
    const n1 = makeNoise(1901), n2 = makeNoise(1902), n3 = makeNoise(1903);
    const base = hex('#6b6156'), dark = hex('#3f3830'), light = hex('#857a6c');
    return assemble(size, (u, v, p) => {
      const board = Math.floor(v * 8), fb = v * 8 - board;
      const seam = 1 - smooth(0.0, 0.025, Math.min(fb, 1 - fb));
      const tie = (() => { const tu = frac(u * 2) - 0.5, tv = frac(v * 2 + 0.25) - 0.5; return smooth(0.03, 0.018, Math.hypot(tu, tv * 1.0)); })();
      const plank = (hashI(board, 1, 1904) - 0.5) * 0.08;
      const pores = smooth(0.78, 0.86, n1(u, v, 90, 90, 2));
      const streak = smooth(0.55, 0.85, n2(u, v, 30, 2, 3)) * (0.3 + 0.7 * v);
      p.h = 0.5 + plank - seam * 0.2 - tie * 0.5 - pores * 0.15 + (n3(u, v, 12, 60, 2) - 0.5) * 0.05;
      let col = base.map((x) => x * (0.92 + 0.12 * n3(u, v, 6, 6, 4) + plank));
      col = mix3(col, light, smooth(0.6, 0.8, n1(u, v, 5, 5, 3)) * 0.3);
      col = mix3(col, dark, Math.max(streak * 0.5, tie * 0.9, seam * 0.4, pores * 0.5));
      p.col = col;
      p.rough = 0.78 - streak * 0.08;
      p.ao = 1 - tie * 0.6;
    }, { normal: 5, cav: [0.005, 2], aoMin: 0.4 });
  }),

  // Betonfertigteile: Platten 1 × 1 m mit Fugen, Ankerlöcher, Kantenabplatzungen
  concrete_panels: def('#767363', 0.77, (size) => {
    const n1 = makeNoise(2001), n2 = makeNoise(2002), n3 = makeNoise(2003);
    const base = hex('#8a8776'), grime = hex('#5a584c');
    return assemble(size, (u, v, p) => {
      const fu = frac(u * 2), fv = frac(v * 2), pid = Math.floor(u * 2) + 2 * Math.floor(v * 2);
      const dj = Math.min(fu, 1 - fu, fv, 1 - fv);
      const joint = 1 - smooth(0.004, 0.012, dj);
      const chip = smooth(0.72, 0.8, n1(u, v, 30, 30, 3)) * (1 - smooth(0.012, 0.04, dj));
      const holes = (() => { let m = 0; for (const [a, b] of [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) m = Math.max(m, smooth(0.022, 0.014, Math.hypot(fu - a, fv - b))); return m; })();
      const tone = (hashI(pid, 1, 2004) - 0.5) * 0.1;
      p.h = 0.6 - joint * 0.6 - chip * 0.25 - holes * 0.4 + (n2(u, v, 120, 120, 2) - 0.5) * 0.05;
      let col = base.map((x) => x * (0.93 + tone + 0.1 * (n3(u, v, 8, 8, 4) - 0.5)));
      col = mix3(col, grime, Math.max(joint * 0.8, holes * 0.8, smooth(0.6, 0.85, n2(u, v, 20, 3, 3)) * 0.3 * v));
      p.col = col;
      p.rough = 0.77;
      p.ao = 1 - joint * 0.5 - holes * 0.5;
    }, { normal: 5, cav: [0.004, 2.2], aoMin: 0.4 });
  }),

  // Verschmutzter Hallenboden: geglätteter Estrich, Reifenspuren, Ölflecken, Kratzer, Fugenschnitte
  concrete_dirty: def('#8a8479', 0.86, (size) => {
    const n1 = makeNoise(2101), n2 = makeNoise(2102), n3 = makeNoise(2103), n4 = makeNoise(2104);
    const base = hex('#958f83'), dirt = hex('#625c52'), oil = hex('#45413b');
    return assemble(size, (u, v, p) => {
      const cut = 1 - smooth(0.0, 0.004, Math.min(frac(u * 1), 1 - frac(u * 1), frac(v * 1), 1 - frac(v * 1)));
      const tire = smooth(0.7, 0.9, n1(u, v, 2, 40, 2)) * smooth(0.4, 0.6, n2(u, v, 3, 3, 2));
      const oilM = smooth(0.74, 0.84, n2(u, v, 6, 6, 4));
      const scratch = smooth(0.92, 0.97, n3(u, v, 120, 6, 2));
      const grain = n4(u, v, 220, 220, 2);
      p.h = 0.5 - cut * 0.5 + (grain - 0.5) * 0.04 - scratch * 0.05;
      let col = base.map((x) => x * (0.9 + 0.15 * n3(u, v, 5, 5, 4) + 0.06 * (grain - 0.5)));
      col = mix3(col, dirt, Math.max(tire * 0.45, smooth(0.55, 0.85, n1(u, v, 8, 8, 4)) * 0.35));
      col = mix3(col, oil, oilM * 0.6);
      col = mix3(col, hex('#b0aa9e'), scratch * 0.3);
      p.col = col;
      p.rough = 0.88 - oilM * 0.35 - tire * 0.05;
      p.ao = 1 - cut * 0.5;
    }, { normal: 3, cav: [0.004, 2], aoMin: 0.5 });
  }),

  // Grün gestrichener Beton, abblätternd: Farbschicht mit Abplatzungen, Beton darunter, Schmutzläufer
  concrete_painted: def('#506d53', 0.77, (size) => {
    const n1 = makeNoise(2201), n2 = makeNoise(2202), n3 = makeNoise(2203);
    const paint = hex('#567a59'), conc = hex('#8d887c'), grime = hex('#3f4a3d');
    return assemble(size, (u, v, p) => {
      const peelN = n1(u, v, 6, 6, 5);
      const peel = smooth(0.66, 0.68, peelN);
      const edge = smooth(0.64, 0.66, peelN) - peel; // Farbkante
      const streak = smooth(0.55, 0.85, n2(u, v, 24, 2, 3)) * (0.4 + 0.6 * v);
      p.h = 0.5 + (1 - peel) * 0.08 + edge * 0.1 + (n3(u, v, 140, 140, 2) - 0.5) * 0.05;
      let col = mix3(paint.map((x) => x * (0.9 + 0.15 * n3(u, v, 7, 7, 4))), conc.map((x) => x * (0.85 + 0.2 * n3(u, v, 40, 40, 3))), peel);
      col = mix3(col, grime, streak * 0.4);
      p.col = col;
      p.rough = mix(0.6, 0.9, peel);
    }, { normal: 4, cav: [0.004, 2], aoMin: 0.5 });
  }),

  // Epoxid-Boden: fast neutral, leichte Wolken, Rollerspuren, Abrieb (Farbe kommt aus den Kartenfaktoren)
  concrete_epoxy: def('#56534d', 0.5, (size) => {
    const n1 = makeNoise(2301), n2 = makeNoise(2302), n3 = makeNoise(2303);
    const base = hex('#5b5852'), worn = hex('#6e6a63');
    return assemble(size, (u, v, p) => {
      const roll = 0.5 + 0.5 * Math.sin((u + 0.02 * n1(u, v, 4, 4, 2)) * Math.PI * 2 * 12);
      const wear = smooth(0.62, 0.82, n2(u, v, 5, 5, 4));
      const scratch = smooth(0.93, 0.975, n3(u, v, 100, 8, 2));
      p.h = 0.5 + (n1(u, v, 60, 60, 2) - 0.5) * 0.02 - scratch * 0.04;
      let col = base.map((x) => x * (0.96 + 0.05 * roll + 0.06 * (n1(u, v, 6, 6, 3) - 0.5)));
      col = mix3(col, worn, Math.max(wear * 0.5, scratch * 0.6));
      p.col = col;
      p.rough = 0.4 + wear * 0.25 + scratch * 0.2;
    }, { normal: 2, cav: [0.004, 1.5], aoMin: 0.7 });
  }),
  /* ================================================================ Putz, Innenwände, Innenböden */
  // Glatter Kellenputz beige: feine Körnung, Kellenschwünge, leichte Wolken
  plaster_beige: def('#836f56', 0.667, (size) => {
    const n1 = makeNoise(3001), n2 = makeNoise(3002), n3 = makeNoise(3003);
    const base = hex('#8a7459');
    return assemble(size, (u, v, p) => {
      const sw = n2(u + 0.05 * n3(u, v, 4, 4, 2), v, 10, 6, 3);
      const grain = n1(u, v, 300, 300, 2);
      p.h = 0.5 + (sw - 0.5) * 0.12 + (grain - 0.5) * 0.08;
      p.col = base.map((x) => x * (0.93 + 0.1 * (n3(u, v, 5, 5, 4) - 0.5) + 0.06 * (sw - 0.5) + 0.05 * (grain - 0.5)));
      p.rough = 0.66 + (grain - 0.5) * 0.1;
    }, { normal: 3, cav: [0.004, 1.5], aoMin: 0.7 });
  }),

  // Rauputz hell: Kratzputz-Körnung, Spritzer, Schmutz unten, kleine Ausbesserungen
  plaster_white: def('#aeadaa', 0.888, (size) => {
    const n1 = makeNoise(3101), n2 = makeNoise(3102), n3 = makeNoise(3103), gr = makeCells(120, 3104, 1.0);
    const base = hex('#b3b2ae'), dirt = hex('#8e8a80'), patch = hex('#c2c0ba');
    return assemble(size, (u, v, p) => {
      const g = gr(u, v), pit = smooth(0.3, 0.12, g.d1) * (hashI(g.id, 1, 3105) > 0.6 ? 1 : 0);
      const grain = n1(u, v, 260, 260, 2);
      const patchM = smooth(0.7, 0.74, n2(u, v, 6, 6, 4));
      p.h = 0.5 + (grain - 0.5) * 0.2 - pit * 0.3 + patchM * 0.05;
      let col = base.map((x) => x * (0.94 + 0.1 * (n3(u, v, 6, 6, 4) - 0.5) + 0.06 * (grain - 0.5)));
      col = mix3(col, patch, patchM * 0.5);
      col = mix3(col, dirt, smooth(0.6, 0.85, n2(u, v, 20, 3, 3)) * 0.25 + pit * 0.4);
      p.col = col;
      p.rough = 0.9 - patchM * 0.05;
    }, { normal: 5, cav: [0.003, 2], aoMin: 0.5 });
  }),

  // Weißer Anstrich, großflächig abgeblättert: Farbschollen mit Kante, grauer Putz darunter, rote Ziegelstellen
  plaster_white_peeling: def('#bab9b3', 0.52, (size) => {
    const n1 = makeNoise(3201), n2 = makeNoise(3202), n3 = makeNoise(3203), n4 = makeNoise(3204);
    const paint = hex('#e3e1db'), plaster = hex('#9a958c'), brick = hex('#a0624a'), grime = hex('#6e695f');
    return assemble(size, (u, v, p) => {
      const pn = n1(u, v, 5, 5, 6) * 0.75 + n4(u, v, 24, 24, 3) * 0.25;
      const peel = smooth(0.52, 0.535, pn);
      const lip = smooth(0.49, 0.52, pn) * (1 - peel); // aufgeworfener Farbrand
      const deep = smooth(0.66, 0.69, pn);              // bis zum Ziegel
      const grain = n2(u, v, 220, 220, 2);
      p.h = 0.55 + (1 - peel) * 0.12 + lip * 0.08 - deep * 0.12 + (grain - 0.5) * 0.08;
      let col = paint.map((x) => x * (0.9 + 0.12 * n3(u, v, 8, 8, 4)));
      col = mix3(col, plaster.map((x) => x * (0.85 + 0.25 * grain)), peel);
      col = mix3(col, brick.map((x) => x * (0.8 + 0.3 * n3(u, v, 30, 30, 2))), deep * 0.85);
      col = mix3(col, grime, lip * 0.3 + smooth(0.6, 0.85, n2(u, v, 16, 3, 3)) * 0.2);
      p.col = col;
      p.rough = mix(0.4, 0.85, peel);
    }, { normal: 5, cav: [0.004, 2.4], aoMin: 0.45 });
  }),

  // Putz mit Fehlstellen, darunter Ziegelmauerwerk (Läufer 25 × 6,5 cm) – Kanten ausgebrochen, Wasserflecken
  plaster_damaged_brick: def('#958474', 0.907, (size) => {
    const n1 = makeNoise(3301), n2 = makeNoise(3302), n3 = makeNoise(3303);
    const bond = makeBond(24, 7, { seed: 3304 });
    const plaster = hex('#a5998b'), stain = hex('#7c6f60'), brickC = hex('#97563b'), mortar = hex('#9a9184');
    return assemble(size, (u, v, p) => {
      const hole = smooth(0.6, 0.62, n1(u, v, 4, 4, 6));
      const edge = smooth(0.56, 0.6, n1(u, v, 4, 4, 6)) * (1 - hole);
      const b = bond(u, v);
      const inB = smooth(0.0015, 0.004, b.e);
      const grain = n2(u, v, 200, 200, 2);
      p.h = (1 - hole) * (0.75 + (grain - 0.5) * 0.1) + hole * (0.3 + inB * 0.2) + edge * 0.05;
      let col = plaster.map((x) => x * (0.9 + 0.15 * n3(u, v, 6, 6, 4) + 0.06 * (grain - 0.5)));
      col = mix3(col, stain, smooth(0.55, 0.8, n2(u, v, 12, 3, 4)) * 0.45);
      const bc = mix3(mortar, brickC.map((x) => x * (0.75 + 0.45 * hashI(b.id, 1, 3305))), inB);
      col = mix3(col, bc, hole);
      p.col = mix3(col, hex('#6a5d50'), edge * 0.3);
      p.rough = 0.9;
    }, { normal: 6, cav: [0.004, 2.2], aoMin: 0.4 });
  }),

  // Grauer Putz, ausgebessert: dunklere Flicken, senkrechte Fugen alter Platten, Laufspuren
  plaster_worn_patched: def('#776e5e', 0.971, (size) => {
    const n1 = makeNoise(3401), n2 = makeNoise(3402), n3 = makeNoise(3403);
    const base = hex('#857c6c'), patch = hex('#5b5246'), light = hex('#9a917f');
    return assemble(size, (u, v, p) => {
      const pn = n1(u, v, 5, 5, 5);
      const patchM = smooth(0.62, 0.64, pn), rim = smooth(0.6, 0.62, pn) - patchM;
      const seamX = [0.27, 0.71].map((s) => 1 - smooth(0.0, 0.004, Math.abs(u - s - 0.004 * (n2(u, v, 2, 20, 2) - 0.5))));
      const seam = Math.max(...seamX);
      const grain = n3(u, v, 240, 240, 2);
      p.h = 0.5 - patchM * 0.06 + rim * 0.04 - seam * 0.3 + (grain - 0.5) * 0.1;
      let col = base.map((x) => x * (0.92 + 0.14 * n2(u, v, 7, 7, 4) + 0.06 * (grain - 0.5)));
      col = mix3(col, light, smooth(0.55, 0.8, n3(u, v, 4, 4, 3)) * 0.35);
      col = mix3(col, patch, patchM * 0.75);
      col = mix3(col, hex('#4a443b'), Math.max(seam * 0.7, smooth(0.6, 0.85, n2(u, v, 18, 2, 3)) * 0.25));
      p.col = col;
      p.rough = 0.97;
    }, { normal: 4, cav: [0.004, 2], aoMin: 0.5 });
  }),

  // Türkis gestrichener Putz, ausgewaschen: senkrechte Regenläufer, Kalkausblühungen, abgewitterte Stellen
  plaster_blue_weathered: def('#88a5a0', 0.879, (size) => {
    const n1 = makeNoise(3501), n2 = makeNoise(3502), n3 = makeNoise(3503);
    const paint = hex('#7bb0a8'), worn = hex('#a9b9b2'), plaster = hex('#9a9a92');
    return assemble(size, (u, v, p) => {
      const streak = n1(u, v, 40, 2, 4);
      const washed = smooth(0.45, 0.75, streak);
      const bare = smooth(0.74, 0.77, n2(u, v, 6, 6, 5)) * 0.7;
      const grain = n3(u, v, 220, 220, 2);
      p.h = 0.5 - bare * 0.08 + (grain - 0.5) * 0.12;
      let col = paint.map((x) => x * (0.9 + 0.15 * n3(u, v, 7, 7, 4)));
      col = mix3(col, worn, washed * 0.55);
      col = mix3(col, plaster.map((x) => x * (0.85 + 0.25 * grain)), bare);
      p.col = col.map((x) => x * (0.95 + 0.08 * (grain - 0.5)));
      p.rough = 0.88;
    }, { normal: 4, cav: [0.004, 2], aoMin: 0.55 });
  }),

  // Gestrichener Putz (Farbe aus der Karte): fast neutral, Rollerstruktur, Schatten alter Flecken, Sockelschmutz
  plaster_painted: def('#aba3a0', 0.919, (size) => {
    const n1 = makeNoise(3601), n2 = makeNoise(3602), n3 = makeNoise(3603);
    const base = hex('#aea7a3'), dirt = hex('#8c8580');
    return assemble(size, (u, v, p) => {
      const roller = n1(u, v, 90, 30, 3);
      const stainM = smooth(0.62, 0.8, n2(u, v, 5, 5, 4));
      p.h = 0.5 + (roller - 0.5) * 0.12 + (n3(u, v, 260, 260, 2) - 0.5) * 0.05;
      let col = base.map((x) => x * (0.96 + 0.06 * (roller - 0.5) + 0.06 * (n3(u, v, 6, 6, 3) - 0.5)));
      col = mix3(col, dirt, stainM * 0.35 + smooth(0.65, 0.9, n2(u, v, 22, 3, 3)) * 0.15);
      p.col = col;
      p.rough = 0.92;
    }, { normal: 2.5, cav: [0.004, 1.5], aoMin: 0.7 });
  }),

  // Fleckige Tapete: helles Papier, feines Prägemuster, Wasser-/Schimmelränder (Wolken mit dunklem Saum)
  wallpaper_stained: def('#b5b4ab', 0.621, (size) => {
    const n1 = makeNoise(3701), n2 = makeNoise(3702), n3 = makeNoise(3703);
    const paper = hex('#dedbd0'), stain = hex('#8c8468'), mold = hex('#5c5a48');
    return assemble(size, (u, v, p) => {
      const emb = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 48) * Math.sin(v * Math.PI * 2 * 48);
      const sn = n1(u, v, 4, 4, 6);
      const st = smooth(0.36, 0.6, sn * 0.7 + n2(u + 0.3, v, 10, 10, 4) * 0.3), ring = smooth(0.56, 0.6, sn) * (1 - smooth(0.6, 0.64, sn));
      const spots = smooth(0.7, 0.8, n2(u, v, 30, 30, 3)) * st;
      p.h = 0.5 + emb * 0.05 + (n3(u, v, 200, 200, 2) - 0.5) * 0.04;
      let col = paper.map((x) => x * (0.96 + 0.04 * emb));
      col = mix3(col, stain, st * 0.55);
      col = mix3(col, mold, Math.max(ring * 0.5, spots * 0.6));
      p.col = col;
      p.rough = 0.62 + st * 0.1;
    }, { normal: 2, cav: [0.003, 1.2], aoMin: 0.8 });
  }),

  // Abgenutzter Hallen-Estrich dunkel: geglättet, Schleifspuren, Kratzer, Ausbesserungen, glatt gelaufene Bahnen
  concrete_floor_worn: def('#565754', 0.541, (size) => {
    const n1 = makeNoise(3801), n2 = makeNoise(3802), n3 = makeNoise(3803), n4 = makeNoise(3804);
    const S = makeStrokes(10, 2, 3805, { ang: [0.3, 0.8], len: [1.5, 3.5], wid: [0.012, 0.025] });
    const base = hex('#5b5c59'), light = hex('#737470'), dark = hex('#43443f');
    return assemble(size, (u, v, p) => {
      const trow = n1(u, v, 3, 3, 4);
      const polish = smooth(0.5, 0.75, n2(u, v, 2, 8, 3));
      const sc = S(u, v).m;
      const grain = n3(u, v, 260, 260, 2);
      p.h = 0.5 - sc * 0.06 + (grain - 0.5) * 0.03;
      let col = base.map((x) => x * (0.92 + 0.14 * (trow - 0.5) * 2 * 0.5 + 0.04 * (grain - 0.5)));
      col = mix3(col, light, smooth(0.65, 0.85, n4(u, v, 6, 6, 4)) * 0.35 + sc * 0.4);
      col = mix3(col, dark, smooth(0.7, 0.85, n1(u + 0.3, v, 8, 8, 4)) * 0.4);
      p.col = col;
      p.rough = 0.6 - polish * 0.15 + sc * 0.15 + (grain - 0.5) * 0.06;
    }, { normal: 2, cav: [0.003, 1.5], aoMin: 0.7 });
  }),

  // Rasterdecke 6 × 6 Platten: Mineralfaser mit Lochung, T-Profile, vergilbte Platten, Wasserfleck
  ceiling_office: def('#f5f5f5', 0.692, (size) => {
    const n1 = makeNoise(3901), n2 = makeNoise(3902), holes = makeCells(110, 3903, 0.8);
    const bond = makeBond(6, 6, { stagger: 0 });
    const tile = hex('#f4f3ef'), bar = hex('#d9d9d7');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      const barM = 1 - smooth(0.0035, 0.0045, b.e);
      const h = holes(u, v), hole = smooth(0.16, 0.08, h.d1) * (hashI(h.id, 1, 3904) > 0.35 ? 1 : 0);
      const yellow = hashI(b.id, 2, 3905) > 0.8 ? 0.15 : 0;
      const stain = smooth(0.72, 0.8, n1(u, v, 3, 3, 5));
      p.h = barM * 0.2 + (1 - barM) * (0.5 - hole * 0.25 + (n2(u, v, 200, 200, 2) - 0.5) * 0.05);
      let col = tile.map((x, c) => x * (1 - yellow * [0, 0.05, 0.18][c]) * (0.97 + 0.03 * n2(u, v, 8, 8, 3)));
      col = mix3(col, hex('#b9b6ad'), hole * 0.5);
      col = mix3(col, hex('#c8b996'), stain * 0.45 * (1 - barM));
      p.col = mix3(col, bar, barM);
      p.rough = mix(0.72, 0.4, barM);
      p.metal = barM * 0.6;
    }, { normal: 3, cav: [0.003, 1.5], aoMin: 0.6 });
  }),

  // Schmutziger Schlingenteppich: Schlingen-Raster, Laufstraßen, Flecken, Streifen
  carpet_dirty: def('#373126', 0.813, (size) => {
    const n1 = makeNoise(4001), n2 = makeNoise(4002), n3 = makeNoise(4003);
    const loops = makeCells(96, 4004, 0.5);
    const base = hex('#3d3529'), fleck = hex('#6e5a2e'), dark = hex('#1f1b15');
    return assemble(size, (u, v, p) => {
      const l = loops(u, v), loop = Math.sqrt(clamp01(1 - (l.d1 / 0.6) ** 2));
      const band = smooth(0.85, 0.95, 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 3)) * smooth(0.4, 0.7, n1(u, v, 30, 2, 3));
      p.h = loop * 0.7 + (n2(u, v, 6, 6, 3) - 0.5) * 0.2;
      let col = base.map((x) => x * (0.6 + 0.6 * loop) * (0.85 + 0.3 * hashI(l.id, 1, 4005)));
      col = mix3(col, fleck, band * 0.35);
      col = mix3(col, dark, smooth(0.6, 0.8, n3(u, v, 5, 5, 4)) * 0.5);
      p.col = col;
      p.rough = 0.82;
      p.ao = 0.4 + 0.6 * loop;
    }, { normal: 5, cav: [0.003, 2], aoMin: 0.3 });
  }),

  // Filz-Akustikplatte: schräge Fasern, leichte Melierung
  felt_panel: def('#a2a0a6', 0.818, (size) => {
    const n1 = makeNoise(4101), n2 = makeNoise(4102);
    const S = makeStrokes(40, 3, 4103, { ang: [0.7, 0.35], len: [1.5, 3], wid: [0.05, 0.1] });
    const base = hex('#a3a1a8');
    return assemble(size, (u, v, p) => {
      const f = S(u, v);
      const mel = n1(u, v, 12, 12, 4);
      p.h = 0.5 + f.m * 0.15 + (n2(u, v, 200, 200, 2) - 0.5) * 0.06;
      p.col = base.map((x) => x * (0.9 + 0.1 * (mel - 0.5) * 2 + f.m * (hashI(f.id, 2, 4104) - 0.4) * 0.25));
      p.rough = 0.82;
    }, { normal: 3, cav: [0.003, 1.2], aoMin: 0.75 });
  }),

  // Linoleum: marmorierte Körnung in Längsrichtung, Laufspuren, Kratzer
  linoleum: def('#997a59', 0.649, (size) => {
    const n1 = makeNoise(4201), n2 = makeNoise(4202), n3 = makeNoise(4203);
    const S = makeStrokes(8, 2, 4204, { ang: [0, 1.2], len: [1, 2.5], wid: [0.01, 0.02] });
    const base = hex('#9a7b5a'), light = hex('#b49674'), dark = hex('#7a5f43');
    return assemble(size, (u, v, p) => {
      const marb = n1(u, v, 40, 40, 4) * 0.7 + n2(u, v, 160, 160, 2) * 0.3;
      const sc = S(u, v).m;
      const wear = smooth(0.55, 0.8, n3(u, v, 3, 3, 3));
      p.h = 0.5 - sc * 0.08 + (n2(u, v, 240, 240, 2) - 0.5) * 0.03;
      let col = mix3(dark, light, smooth(0.2, 0.8, marb));
      col = mix3(col, base, 0.8);
      p.col = mix3(col, hex('#b8a080'), sc * 0.4 + wear * 0.15);
      p.rough = 0.62 + wear * 0.12 + sc * 0.15;
    }, { normal: 1.5, cav: [0.003, 1.2], aoMin: 0.8 });
  }),

  // Gummiboden schwarz: Granulat-Einstreuung (EPDM), leichte Noppen
  rubber_floor: def('#1f2223', 0.59, (size) => {
    const n1 = makeNoise(4301), gran = makeCells(140, 4302, 1.0);
    const base = hex('#1b1d1e'), flecks = ['#5b5f61', '#3a3d3f', '#6b6656'].map(hex);
    return assemble(size, (u, v, p) => {
      const g = gran(u, v), fl = smooth(0.32, 0.22, g.d1) * (hashI(g.id, 1, 4303) > 0.72 ? 1 : 0);
      p.h = 0.5 + fl * 0.1 + (n1(u, v, 120, 120, 2) - 0.5) * 0.08;
      p.col = mix3(base.map((x) => x * (0.92 + 0.16 * n1(u, v, 6, 6, 3))), flecks[Math.floor(hashI(g.id, 2, 4304) * 3)], fl);
      p.rough = 0.6;
    }, { normal: 3, cav: [0.003, 1.5], aoMin: 0.7 });
  }),
  /* ================================================================ Mauerwerk, Pflaster, Dach, Fliesen */
  // Sandstein-Quader: 7 Schichten, Steine unterschiedlich lang, bossierte Ansicht, ausgebrochene Kanten, Mörtelfugen
  sandstone_blocks: def('#b39f88', 0.833, (size) => {
    const n1 = makeNoise(5001), n2 = makeNoise(5002), n3 = makeNoise(5003);
    const bond = makeBond(7, 3, { seed: 5004, cuts: [2, 4] });
    const stone = hex('#c2ad92'), dark = hex('#8c7a64'), mortar = hex('#a39886');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      const chip = (n1(u, v, 40, 40, 3) - 0.5) * 0.012;
      const inS = smooth(0.003, 0.009, b.e + chip);
      const boss = Math.min(1, b.e / 0.03); // Ansicht wölbt sich zur Mitte
      const rough = n2(u, v, 60, 60, 4);
      p.h = inS * (0.45 + 0.25 * Math.sqrt(boss) + (rough - 0.5) * 0.35) + (1 - inS) * 0.15;
      let col = stone.map((x) => x * (0.85 + 0.25 * hashI(b.id, 1, 5005) + 0.15 * (rough - 0.5)));
      col = mix3(col, dark, smooth(0.55, 0.85, n3(u, v, 8, 8, 4)) * 0.4 + smooth(0.6, 0.8, n3(u, v, 50, 50, 2)) * 0.2);
      p.col = mix3(mortar, col, inS);
      p.rough = 0.85;
    }, { normal: 8, cav: [0.006, 2.4], aoMin: 0.35 });
  }),

  // Fabrik-Klinker: 20 Schichten × 6 Läufer, rotbraun gemischt, helle Fugen, gebrannte Köpfe, Kalkschleier
  brick_factory: def('#896f5a', 0.82, (size) => {
    const n1 = makeNoise(5101), n2 = makeNoise(5102), n3 = makeNoise(5103);
    const bond = makeBond(20, 6, { seed: 5104 });
    const cols = ['#9a6448', '#8a5a43', '#a8735a', '#7d523e', '#94705c'].map(hex), mortar = hex('#b9b0a2');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      const inB = smooth(0.0025, 0.005, b.e + (n1(u, v, 80, 80, 2) - 0.5) * 0.002);
      const surf = n2(u, v, 120, 120, 3);
      p.h = inB * (0.6 + (surf - 0.5) * 0.15 + (hashI(b.id, 3, 5105) - 0.5) * 0.08) + (1 - inB) * 0.25;
      let col = cols[Math.floor(hashI(b.id, 1, 5106) * cols.length)].map((x) => x * (0.88 + 0.2 * (surf - 0.5) + 0.12 * (hashI(b.id, 2, 5107) - 0.5)));
      col = mix3(col, hex('#5e3f30'), smooth(0.75, 0.95, n3(u, v, 30, 30, 2)) * 0.35);
      col = mix3(mortar, col, inB);
      p.col = mix3(col, hex('#b3a89a'), smooth(0.6, 0.85, n3(u, v, 5, 5, 4)) * 0.2);
      p.rough = 0.82;
    }, { normal: 6, cav: [0.004, 2.4], aoMin: 0.4 });
  }),

  // Dunkler Klinker: 24 Schichten × 8, braunviolett, dunkle Fugen
  brick_dark: def('#4a3931', 0.787, (size) => {
    const n1 = makeNoise(5201), n2 = makeNoise(5202), n3 = makeNoise(5203);
    const bond = makeBond(24, 8, { seed: 5204 });
    const cols = ['#5a3c33', '#4a332c', '#62453a', '#3f2e29', '#55413a'].map(hex), mortar = hex('#5b544c');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      const inB = smooth(0.002, 0.0045, b.e + (n1(u, v, 80, 80, 2) - 0.5) * 0.0015);
      const surf = n2(u, v, 140, 140, 3);
      p.h = inB * (0.6 + (surf - 0.5) * 0.12) + (1 - inB) * 0.3;
      let col = cols[Math.floor(hashI(b.id, 1, 5205) * cols.length)].map((x) => x * (0.85 + 0.25 * (surf - 0.5) + 0.15 * (hashI(b.id, 2, 5206) - 0.5)));
      col = mix3(mortar, col, inB);
      p.col = mix3(col, hex('#2c2420'), smooth(0.6, 0.85, n3(u, v, 6, 6, 4)) * 0.3);
      p.rough = 0.79;
    }, { normal: 6, cav: [0.004, 2.4], aoMin: 0.4 });
  }),

  // Kopfsteinpflaster: 9 × 9 Steine (Voronoi wenig gestreut), gewölbt, Sand-/Erdfugen, blaugrau bis beige
  cobblestone: def('#958f84', 0.578, (size) => {
    const cells = makeCells(9, 5301, 0.42), n1 = makeNoise(5302), n2 = makeNoise(5303), n3 = makeNoise(5304);
    const cols = ['#9a9a96', '#939599', '#a09b92', '#8a8c8e', '#a7a49c', '#8f8a82'].map(hex), joint = hex('#6a6152');
    return assemble(size, (u, v, p) => {
      const c = cells(u, v);
      const e = c.ex + (n1(u, v, 30, 30, 3) - 0.5) * 0.08;
      const inS = smooth(0.06, 0.2, e) * smooth(0.78, 0.62, c.d1); // Ecken gerundet
      const dome = Math.sqrt(clamp01(1 - (c.d1 / 0.75) ** 2));
      const surf = n2(u, v, 70, 70, 3);
      p.h = inS * (0.4 + dome * 0.45 + (surf - 0.5) * 0.12) + (1 - inS) * (0.1 + n3(u, v, 120, 120, 2) * 0.1);
      let col = cols[Math.floor(hashI(c.id, 1, 5305) * cols.length)].map((x) => x * (0.82 + 0.35 * (surf - 0.5) + 0.12 * dome + 0.12 * (hashI(c.id, 2, 5306) - 0.5)));
      col = mix3(col, hex('#5e584e'), smooth(0.6, 0.85, n1(u + 0.4, v, 6, 6, 4)) * 0.35);
      col = mix3(joint.map((x) => x * (0.8 + 0.4 * n3(u, v, 90, 90, 2))), col, inS);
      p.col = col;
      p.rough = mix(0.95, 0.5 + 0.15 * (1 - dome), inS);
      p.ao = 0.5 + 0.5 * inS;
    }, { normal: 8, cav: [0.006, 2.4], aoMin: 0.35 });
  }),

  // Polygonalplatten: große Natursteinplatten (Voronoi, gerade Kanten), beige/grau gemischt, schmale Fugen
  paving_flagstone: def('#98826c', 0.738, (size) => {
    const cells = makeCells(4, 5401, 0.85), n1 = makeNoise(5402), n2 = makeNoise(5403);
    const cols = ['#b0957a', '#9b9488', '#a88a6c', '#8f8b84', '#b9a089'].map(hex), joint = hex('#5e5446');
    return assemble(size, (u, v, p) => {
      const c = cells(u, v);
      const inS = smooth(0.012, 0.03, c.ex);
      const surf = n1(u, v, 50, 50, 4);
      p.h = inS * (0.6 + (surf - 0.5) * 0.12 + (hashI(c.id, 3, 5404) - 0.5) * 0.1) + (1 - inS) * 0.2;
      let col = mix3(cols[Math.floor(hashI(c.id, 1, 5405) * cols.length)], cols[Math.floor(hashI(c.id, 2, 5406) * cols.length)], hashI(c.id, 3, 5407)).map((x) => x * (0.85 + 0.25 * (surf - 0.5) + 0.15 * (hashI(c.id, 4, 5408) - 0.5)));
      col = mix3(col, hex('#6f6250'), smooth(0.6, 0.85, n2(u, v, 7, 7, 4)) * 0.3);
      p.col = mix3(joint, col, inS);
      p.rough = 0.74;
    }, { normal: 6, cav: [0.006, 2.2], aoMin: 0.35 });
  }),

  // Mönch-Nonne-artige Hohlziegel: 15 Bahnen × 10 Reihen, gewölbt, Überdeckung mit Schattenkante, Flechten
  roof_clay_tiles: def('#97532d', 0.915, (size) => {
    const n1 = makeNoise(5501), n2 = makeNoise(5502), n3 = makeNoise(5503);
    const C = 15, R = 10;
    const cols = ['#b45a2e', '#a24c27', '#c06836', '#8e4424', '#aa5f3a'].map(hex), lichen = hex('#6f6a50');
    return assemble(size, (u, v, p) => {
      const x = u * C, ci = Math.floor(x), fx = x - ci;
      const y = v * R + (ci % 2) * 0.5 + (hashI(ci, 0, 5504) - 0.5) * 0.15, ri = Math.floor(y), fy = y - ri;
      const id = wrap(ci, C) * 64 + wrap(ri, R);
      const arch = Math.sin(Math.PI * fx);
      const lap = fy; // unten (fy → 0) liegt der Ziegel auf dem darunterliegenden: Höhe wächst nach oben
      const gap = 1 - smooth(0.0, 0.06, Math.min(fx, 1 - fx));
      p.h = arch * 0.55 + lap * 0.25 - gap * 0.3;
      let col = cols[Math.floor(hashI(id, 1, 5505) * cols.length)].map((x) => x * (0.8 + 0.25 * arch + 0.15 * (n1(u, v, 60, 60, 3) - 0.5)));
      col = mix3(col, lichen, smooth(0.7, 0.85, n2(u, v, 20, 20, 4)) * 0.6);
      col = mix3(col, hex('#3b2416'), smooth(0.15, 0.0, fy) * 0.5 + gap * 0.5);
      p.col = col;
      p.rough = 0.92;
      p.ao = 1 - smooth(0.12, 0.0, fy) * 0.5;
    }, { normal: 7, cav: [0.006, 2], aoMin: 0.35 });
  }),

  // Terrakotta-Bodenfliesen 8 × 8: dunkelrotbraun, gewachst, jede Fliese etwas anders, dunkle Fugen
  tiles_terracotta: def('#4e271a', 0.751, (size) => {
    const n1 = makeNoise(5601), n2 = makeNoise(5602);
    const bond = makeBond(8, 8, { stagger: 0 });
    const base = hex('#6a3220'), joint = hex('#2c1d16');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      const inT = smooth(0.0025, 0.005, b.e);
      const surf = n1(u, v, 60, 60, 3);
      p.h = inT * (0.6 + (surf - 0.5) * 0.06) + (1 - inT) * 0.3;
      let col = base.map((x) => x * (0.8 + 0.35 * hashI(b.id, 1, 5603) + 0.15 * (surf - 0.5)));
      col = mix3(col, hex('#8a4a30'), smooth(0.6, 0.85, n2(u, v, 9, 9, 4)) * 0.3);
      p.col = mix3(joint, col, inT);
      p.rough = mix(0.85, 0.7, inT) + (surf - 0.5) * 0.1;
    }, { normal: 4, cav: [0.004, 2], aoMin: 0.45 });
  }),

  // Abgenutzte Steinzeugfliesen 4 × 4: dunkel olivgrau, wolkig fleckig, Abplatzer an Ecken, verschmutzte Fugen
  tiles_worn: def('#4c473c', 0.58, (size) => {
    const n1 = makeNoise(5701), n2 = makeNoise(5702), n3 = makeNoise(5703);
    const bond = makeBond(4, 4, { stagger: 0 });
    const base = hex('#59544a'), dark = hex('#2f2c26'), light = hex('#77715f');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      const inT = smooth(0.003, 0.006, b.e);
      const chip = smooth(0.74, 0.8, n1(u, v, 24, 24, 3)) * (1 - smooth(0.006, 0.03, b.e));
      const cloud = n2(u, v, 10, 10, 5);
      p.h = inT * (0.6 - chip * 0.3) + (1 - inT) * 0.25;
      let col = mix3(dark, light, smooth(0.25, 0.8, cloud));
      col = mix3(col, base, 0.4).map((x) => x * (0.9 + 0.2 * hashI(b.id, 1, 5704)));
      col = mix3(col, dark, chip * 0.6 + smooth(0.65, 0.85, n3(u, v, 30, 30, 3)) * 0.3);
      p.col = mix3(hex('#26231e'), col, inT);
      p.rough = 0.55 + smooth(0.5, 0.8, cloud) * 0.1 + chip * 0.3;
    }, { normal: 4, cav: [0.004, 2.2], aoMin: 0.4 });
  }),

  // Schachbrettfliesen 4 × 4: hell beige / grau marmoriert, Fugen, leichte Kantenabnutzung
  tiles_checker: def('#7d726e', 0.507, (size) => {
    const n1 = makeNoise(5801), n2 = makeNoise(5802);
    const bond = makeBond(4, 4, { stagger: 0 });
    const lightC = hex('#bdb3a5'), darkC = hex('#77797a');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      const inT = smooth(0.002, 0.0045, b.e);
      const r = Math.floor(v * 4), c = Math.floor(u * 4);
      const marb = n1(u + 0.05 * n2(u, v, 6, 6, 3), v, 12, 12, 5);
      const vein = smooth(0.02, 0.0, Math.abs(marb - 0.5)) * 0.4;
      let col = ((r + c) % 2 ? darkC : lightC).map((x) => x * (0.9 + 0.15 * (marb - 0.5) * 2 + 0.06 * hashI(b.id, 1, 5803)));
      col = mix3(col, hex('#55524c'), vein);
      p.h = inT * 0.6 + (1 - inT) * 0.3;
      p.col = mix3(hex('#4d4a45'), col, inT);
      p.rough = mix(0.8, 0.45 + 0.1 * n2(u, v, 20, 20, 3), inT);
    }, { normal: 3, cav: [0.003, 2], aoMin: 0.5 });
  }),

  // Lange weiße Wandfliesen (22 × 3, halb versetzt): glasiert, leicht gewellt, graue Fugen
  tiles_white_wall: def('#cfc8b9', 0.242, (size) => {
    const n1 = makeNoise(5901), n2 = makeNoise(5902);
    // Fliesen stehen hochkant: Reihen über u (22), Länge über v (3) → Verband in vertauschten Achsen
    const bond = makeBond(22, 3, { seed: 5903 });
    const glaze = hex('#d8d1c2'), joint = hex('#9b968a');
    return assemble(size, (u, v, p) => {
      const b = bond(v, u);
      const inT = smooth(0.0015, 0.003, b.e);
      const wave = n1(u, v, 6, 30, 3);
      p.h = inT * (0.6 + (wave - 0.5) * 0.08 + 0.05 * Math.sin(Math.PI * b.fv)) + (1 - inT) * 0.3;
      let col = glaze.map((x) => x * (0.95 + 0.07 * hashI(b.id, 1, 5904) + 0.03 * (wave - 0.5)));
      col = mix3(col, hex('#b8ad96'), smooth(0.7, 0.9, n2(u, v, 8, 8, 4)) * 0.25);
      p.col = mix3(joint, col, inT);
      p.rough = mix(0.8, 0.18, inT);
    }, { normal: 3, cav: [0.003, 2], aoMin: 0.55 });
  }),
  /* ================================================================ Holz, Pappe */
  // Bretterwand/-boden warm: 8 Bretter quer, wenige Stöße, Maserung mit Ästen, dunkle Fugen
  wood_planks: def('#795939', 0.862, (size) => {
    const W = makeWood(6001, { rings: 22 }), n1 = makeNoise(6002), n2 = makeNoise(6003);
    const bond = makeBond(8, 1, { seed: 6004, cuts: [1, 1] });
    const light = hex('#8e6a44'), dark = hex('#5a3f26');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v), sd = hashI(b.id, 1, 6005);
      const gapM = 1 - smooth(0.0012, 0.003, b.e);
      const w = W(u, v, sd);
      p.h = (1 - gapM) * (0.6 - w.late * 0.08 + (w.fib - 0.5) * 0.08 + (sd - 0.5) * 0.05) + gapM * 0.1;
      let col = mix3(light, dark, w.late * 0.55 + w.knot * 0.8).map((x) => x * (0.85 + 0.3 * sd + 0.12 * (w.fib - 0.5)));
      col = mix3(col, hex('#3b2a1b'), smooth(0.6, 0.85, n1(u, v, 6, 6, 4)) * 0.25 + smooth(0.6, 0.9, n2(u, v, 4, 30, 3)) * 0.15);
      p.col = mix3(col, hex('#1e150e'), gapM);
      p.rough = 0.86 - w.late * 0.05;
    }, { normal: 5, cav: [0.004, 2.2], aoMin: 0.4 });
  }),

  // Verwitterte Bretter senkrecht: 9 Bretter, vergraut, aufgerissene Fasern, Nagelreihen, Spalten
  wood_planks_weathered: def('#51443b', 0.736, (size) => {
    const W = makeWood(6101, { rings: 18, knots: 0.35 }), n1 = makeNoise(6102), n2 = makeNoise(6103);
    const bond = makeBond(9, 1, { seed: 6104, cuts: [1, 1] });
    const gray = hex('#6b625a'), brown = hex('#5a4535');
    return assemble(size, (u, v, p) => {
      const b = bond(v, u), sd = hashI(b.id, 1, 6105); // Bretter stehen: Reihen über u
      const gapM = 1 - smooth(0.003, 0.007, b.e);
      const w = W(v, u, sd);
      const nail = [0.12, 0.88].reduce((m, y) => Math.max(m, smooth(0.006, 0.003, Math.hypot((b.fv - 0.5) * b.h * 9 * 0.111, v - y))), 0);
      const crack = smooth(0.85, 0.95, n2(u * 1, v, 60, 3, 2)) * 0.6;
      p.h = (1 - gapM) * (0.6 - w.late * 0.15 - crack * 0.3 + (w.fib - 0.5) * 0.18) + gapM * 0.05 - nail * 0.1;
      let col = mix3(brown, gray, smooth(0.3, 0.7, n1(u, v, 4, 8, 4)) * 0.7 + sd * 0.2).map((x) => x * (0.85 + 0.25 * (w.fib - 0.5) - w.late * 0.15));
      col = mix3(col, hex('#2a221c'), Math.max(crack, w.knot * 0.7));
      col = mix3(col, hex('#3a2a20'), nail);
      p.col = mix3(col, hex('#120e0b'), gapM);
      p.rough = 0.74 + crack * 0.1;
      p.metal = nail * 0.5;
    }, { normal: 7, cav: [0.004, 2.4], aoMin: 0.35 });
  }),

  // Dunkle Dielen quer: 7 Bretter, graubraun, Kratzer und Abrieb, wenige Stöße
  wood_planks_dark: def('#544a3f', 0.661, (size) => {
    const W = makeWood(6201, { rings: 20 }), n1 = makeNoise(6202);
    const S = makeStrokes(8, 2, 6203, { ang: [0, 0.35], len: [1, 2.5], wid: [0.01, 0.02] });
    const bond = makeBond(7, 1, { seed: 6204, cuts: [1, 2] });
    const base = hex('#5b5045'), dark = hex('#3b322a');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v), sd = hashI(b.id, 1, 6205);
      const gapM = 1 - smooth(0.002, 0.0045, b.e);
      const w = W(u, v, sd), sc = S(u, v).m;
      p.h = (1 - gapM) * (0.6 - w.late * 0.06 - sc * 0.08 + (w.fib - 0.5) * 0.06) + gapM * 0.1;
      let col = mix3(base, dark, w.late * 0.45 + w.knot).map((x) => x * (0.85 + 0.3 * sd + 0.1 * (w.fib - 0.5)));
      col = mix3(col, hex('#7b6f62'), sc * 0.4 + smooth(0.65, 0.9, n1(u, v, 5, 5, 4)) * 0.2);
      p.col = mix3(col, hex('#17120e'), gapM);
      p.rough = 0.64 + sc * 0.15;
    }, { normal: 4, cav: [0.004, 2], aoMin: 0.45 });
  }),

  // Kistenbretter (Rohholz): 20 schmale Bretter, Stöße versetzt, Fichte hell bis vergraut, Äste, Sägeriefen
  wood_crate: def('#a78358', 0.717, (size) => {
    const W = makeWood(6301, { rings: 40, knots: 0.4 }), n1 = makeNoise(6302), n2 = makeNoise(6303);
    const bond = makeBond(20, 1, { seed: 6304, cuts: [2, 4] });
    const tones = ['#b48e66', '#bd9a70', '#a68058', '#97826a', '#ad895e', '#8d7a63'].map(hex);
    return assemble(size, (u, v, p) => {
      const b = bond(u, v), sd = hashI(b.id, 1, 6305);
      const gapM = 1 - smooth(0.0025, 0.005, b.e);
      const w = W(u, v, sd);
      const saw = 0.5 + 0.5 * Math.sin((u * 140 + sd * 10 + n2(u, v, 3, 20, 2)) * Math.PI * 2);
      p.h = (1 - gapM) * (0.6 - w.late * 0.06 + saw * 0.03 + (w.fib - 0.5) * 0.08 + (sd - 0.5) * 0.06) + gapM * 0.1;
      let col = tones[Math.floor(hashI(b.id, 2, 6306) * tones.length)].map((x) => x * (0.92 + 0.12 * (w.fib - 0.5) - w.late * 0.12));
      col = mix3(col, hex('#5a4026'), w.knot * 0.9);
      col = mix3(col, hex('#5e5446'), smooth(0.6, 0.85, n1(u, v, 8, 30, 4)) * 0.3);
      p.col = mix3(col, hex('#2a2119'), gapM);
      p.rough = 0.72;
    }, { normal: 5, cav: [0.004, 2.2], aoMin: 0.4 });
  }),

  // OSB-Platte: gepresste Späne (Striche verschiedener Richtung), Glanzharz, Tiefen dazwischen
  osb: def('#bc9973', 0.581, (size) => {
    const n1 = makeNoise(6401);
    const L1 = makeStrokes(10, 4, 6402, { ang: [0, 0.6], len: [1.5, 3], wid: [0.25, 0.5] });
    const L2 = makeStrokes(14, 3, 6403, { ang: [0, Math.PI], len: [1.2, 2.5], wid: [0.25, 0.45] });
    const tones = ['#c8a57c', '#b48e64', '#d4b48c', '#a8875f', '#c09a6c'].map(hex);
    return assemble(size, (u, v, p) => {
      const a = L1(u, v); const aM = a.m, aId = a.id;
      const b = L2(u, v);
      const top = b.m > aM ? b : null;
      const m = Math.max(aM, b.m), id = top ? b.id + 99999 : aId;
      p.h = 0.3 + m * (0.4 + 0.2 * hashI(id, 3, 6404)) + (n1(u, v, 160, 160, 2) - 0.5) * 0.05;
      const c = tones[Math.floor(hashI(id, 1, 6405) * tones.length)];
      p.col = mix3(hex('#7a5a3a'), c, smooth(0.0, 0.5, m)).map((x) => x * (0.9 + 0.2 * n1(u, v, 80, 20, 2)));
      p.rough = 0.55 + (1 - m) * 0.2;
    }, { normal: 4, cav: [0.004, 2.2], aoMin: 0.45 });
  }),

  // Alter Dielenboden: 22 schmale Dielen, dunkel geölt, abgelaufene helle Bahnen, Fugen mit Schmutz
  wood_floor_old: def('#57493e', 0.814, (size) => {
    const W = makeWood(6501, { rings: 30 }), n1 = makeNoise(6502), n2 = makeNoise(6503);
    const bond = makeBond(22, 1, { seed: 6504, cuts: [1, 3] });
    const base = hex('#5d4d40'), dark = hex('#3a2e25'), worn = hex('#76675a');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v), sd = hashI(b.id, 1, 6505);
      const gapM = 1 - smooth(0.0015, 0.0035, b.e);
      const w = W(u, v, sd);
      const wear = smooth(0.55, 0.8, n1(u, v, 3, 3, 3));
      p.h = (1 - gapM) * (0.6 - w.late * 0.05 + (w.fib - 0.5) * 0.05) + gapM * 0.15;
      let col = mix3(base, dark, w.late * 0.5 + w.knot).map((x) => x * (0.85 + 0.25 * sd + 0.1 * (w.fib - 0.5)));
      col = mix3(col, worn, wear * 0.35);
      col = mix3(col, hex('#2c241d'), smooth(0.65, 0.9, n2(u, v, 7, 7, 4)) * 0.3);
      p.col = mix3(col, hex('#15100c'), gapM);
      p.rough = 0.82 - wear * 0.08;
    }, { normal: 3, cav: [0.003, 2], aoMin: 0.45 });
  }),

  // Abblätternder Lack auf Holz: blaugraue Farbe, längs der Faser aufgerissen, braunes Holz darunter
  wood_peeling_paint: def('#4e453b', 0.839, (size) => {
    const W = makeWood(6601, { rings: 14 }), n1 = makeNoise(6602), n2 = makeNoise(6603);
    const paint = hex('#2f3c45'), paintW = hex('#46525a'), wood = hex('#86603e');
    return assemble(size, (u, v, p) => {
      const w = W(u, v, 0.3);
      const pn = n1(u, v, 4, 18, 5) * 0.7 + w.fib * 0.3;
      const peel = smooth(0.56, 0.58, pn), lip = smooth(0.54, 0.56, pn) * (1 - peel);
      p.h = 0.5 + (1 - peel) * 0.1 + lip * 0.08 - w.late * 0.06 * peel + (w.fib - 0.5) * 0.06;
      let col = mix3(paint, paintW, smooth(0.4, 0.8, n2(u, v, 6, 6, 4)) * 0.6).map((x) => x * (0.9 + 0.15 * (w.fib - 0.5)));
      col = mix3(col, mix3(wood, hex('#5a3d25'), w.late * 0.6).map((x) => x * (0.85 + 0.2 * w.fib)), peel);
      p.col = mix3(col, hex('#1d1a17'), lip * 0.4);
      p.rough = mix(0.78, 0.9, peel);
    }, { normal: 5, cav: [0.004, 2.2], aoMin: 0.45 });
  }),

  // Palmenstamm: graue, faserige Rinde mit waagrechten Blattnarben-Ringen
  bark_palm: def('#9f9385', 0.7, (size) => {
    const n1 = makeNoise(6701), n2 = makeNoise(6702), n3 = makeNoise(6703);
    const base = hex('#a39789'), dark = hex('#6b6156'), light = hex('#bdb4a8');
    return assemble(size, (u, v, p) => {
      const y = v * 9 + (n1(u, v, 4, 2, 3) - 0.5) * 0.6, f = frac(y);
      const scar = smooth(0.0, 0.12, f) * smooth(0.35, 0.15, f);
      const fib = n2(u, v, 140, 10, 3);
      p.h = 0.5 + scar * 0.25 - smooth(0.0, 0.05, f) * smooth(0.12, 0.05, f) * 0.3 + (fib - 0.5) * 0.2;
      let col = mix3(base, light, scar * 0.4).map((x) => x * (0.85 + 0.3 * (fib - 0.5)));
      col = mix3(col, dark, smooth(0.6, 0.85, n3(u, v, 8, 8, 4)) * 0.4 + smooth(0.08, 0.0, f) * 0.4);
      p.col = col;
      p.rough = 0.72;
    }, { normal: 7, cav: [0.005, 2.2], aoMin: 0.4 });
  }),

  // Wellpappe: Deckpapier, durchscheinende Wellen, Knicke, Klebestreifen-Reste, Schmutz
  cardboard: def('#b98f4d', 0.635, (size) => {
    const n1 = makeNoise(6801), n2 = makeNoise(6802), n3 = makeNoise(6803);
    const base = hex('#bb914f'), dark = hex('#8f6b38');
    return assemble(size, (u, v, p) => {
      const flute = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 60);
      const scuff = smooth(0.7, 0.85, n1(u, v, 12, 12, 4));
      const tape = smooth(0.012, 0.008, Math.abs(v - 0.5 - 0.01 * n2(u, v, 2, 2, 2))) * smooth(0.3, 0.32, n2(u, v, 2, 2, 2));
      p.h = 0.5 + flute * 0.04 - scuff * 0.04 + (n3(u, v, 220, 220, 2) - 0.5) * 0.03;
      let col = base.map((x) => x * (0.95 + 0.04 * flute + 0.08 * (n3(u, v, 8, 8, 4) - 0.5)));
      col = mix3(col, dark, smooth(0.6, 0.85, n2(u, v, 5, 5, 4)) * 0.3);
      col = mix3(col, hex('#d8c6a3'), scuff * 0.5);
      p.col = mix3(col, hex('#c9a46a'), tape * 0.6);
      p.rough = 0.65 - tape * 0.3;
    }, { normal: 2, cav: [0.003, 1.5], aoMin: 0.7 });
  }),

  // Lackierter Nussbaum-Schaft: dunkle, feine Maserung längs, Klarlack (glatt), leichte Abnutzung
  wood_stock: def('#2f1c0f', 0.248, (size) => {
    const W = makeWood(6901, { rings: 34, knots: 0.05 }), n1 = makeNoise(6902);
    const base = hex('#3c2414'), dark = hex('#1d0f07'), light = hex('#55341c');
    return assemble(size, (u, v, p) => {
      const w = W(u, v, 0.6);
      p.h = 0.5 + (w.fib - 0.5) * 0.02;
      let col = mix3(base, dark, w.late * 0.7).map((x) => x * (0.88 + 0.2 * (w.fib - 0.5)));
      p.col = mix3(col, light, smooth(0.65, 0.9, n1(u, v, 5, 5, 4)) * 0.3);
      p.rough = 0.24 + smooth(0.6, 0.9, n1(u + 0.5, v, 8, 8, 3)) * 0.15;
    }, { normal: 1, cav: [0.003, 1], aoMin: 0.9 });
  }),
  /* ================================================================ Metall */
  // Lackiertes Blech (neutral, Farbe aus der Karte): Lackhaut, Rostpunkte an Kratzern und Löchern, Rostläufer
  metal_painted: def('#a0a09f', 0.504, (size) => {
    const n1 = makeNoise(7001), n2 = makeNoise(7002), n3 = makeNoise(7003), pits = makeCells(14, 7004, 0.9);
    const S = makeStrokes(4, 1, 7005, { ang: [0, Math.PI], len: [0.5, 1.2], wid: [0.01, 0.02] });
    const paint = hex('#a3a3a2'), rust = hex('#7a4a26'), rustL = hex('#a46a33');
    return assemble(size, (u, v, p) => {
      const pc = pits(u, v), pit = smooth(0.09, 0.04, pc.d1) * (hashI(pc.id, 1, 7006) > 0.75 ? 1 : 0);
      const sc = S(u, v).m;
      // Läufer: unter Rostpunkten nach unten (v kleiner)
      const run = smooth(0.12, 0.0, Math.abs(u - pc.cx) * 14) * (pc.cy > v ? smooth(0.25, 0.0, pc.cy - v) : 0) * (hashI(pc.id, 1, 7006) > 0.75 ? 1 : 0);
      const blot = smooth(0.78, 0.86, n1(u, v, 6, 6, 5));
      const rustM = Math.max(pit, blot);
      p.h = 0.5 - pit * 0.2 - sc * 0.1 + blot * 0.05 + (n2(u, v, 200, 200, 2) - 0.5) * 0.02;
      let col = paint.map((x) => x * (0.94 + 0.1 * (n3(u, v, 6, 6, 4) - 0.5)));
      col = mix3(col, mix3(rust, rustL, n2(u, v, 40, 40, 2)), rustM);
      col = mix3(col, rustL, run * 0.35 * (1 - rustM));
      p.col = mix3(col, hex('#c9c9c6'), sc * 0.5 * (1 - rustM));
      p.rough = mix(0.45, 0.9, rustM) + (n3(u, v, 30, 30, 2) - 0.5) * 0.08;
    }, { normal: 3, cav: [0.003, 2], aoMin: 0.6 });
  }),

  // Weiß lackiertes Blech, stark durchgerostet: Rostnester mit Hof, Lack wirft Blasen
  metal_rust_painted: def('#ac9267', 0.423, (size) => {
    const n1 = makeNoise(7101), n2 = makeNoise(7102), n3 = makeNoise(7103);
    const paint = hex('#b9bab8'), rust = hex('#c0761c'), rustD = hex('#7a4014');
    return assemble(size, (u, v, p) => {
      const rn = n1(u, v, 6, 6, 6) * 0.7 + n2(u, v, 30, 30, 3) * 0.3;
      const rustM = smooth(0.44, 0.5, rn), halo = smooth(0.38, 0.44, rn) * (1 - rustM);
      const blister = smooth(0.8, 0.9, n3(u, v, 60, 60, 2)) * halo;
      p.h = 0.5 + blister * 0.15 - rustM * 0.05 + (n2(u, v, 160, 160, 2) - 0.5) * rustM * 0.15;
      let col = paint.map((x) => x * (0.92 + 0.1 * n3(u, v, 8, 8, 3)));
      col = mix3(col, hex('#c8a774'), halo * 0.6);
      col = mix3(col, mix3(rust, rustD, smooth(0.4, 0.8, n2(u, v, 25, 25, 3))), rustM);
      p.col = col;
      p.rough = mix(0.3, 0.75, rustM);
    }, { normal: 3, cav: [0.003, 2], aoMin: 0.6 });
  }),

  // Verzinktes Wellblech: 27 Wellen, Zinkblumen-Flecken, matte Oxidschicht, Schmutz in den Tälern
  metal_corrugated: def('#595851', 0.521, (size) => {
    const n1 = makeNoise(7201), n2 = makeNoise(7202), sp = makeCells(30, 7203, 1.0);
    const zinc = hex('#6a6a64'), ox = hex('#4f4e48');
    return assemble(size, (u, v, p) => {
      const ph = u * 27, wave = 0.5 + 0.5 * Math.sin(ph * Math.PI * 2);
      const s = sp(u, v), spangle = hashI(s.id, 1, 7204);
      const dirt = smooth(0.4, 0.0, wave) * smooth(0.4, 0.8, n1(u, v, 6, 20, 3));
      p.h = wave * 0.9 + (n2(u, v, 120, 120, 2) - 0.5) * 0.01;
      let col = zinc.map((x) => x * (0.9 + 0.15 * spangle));
      col = mix3(col, ox, smooth(0.45, 0.8, n2(u, v, 5, 5, 4)) * 0.5);
      p.col = mix3(col, hex('#3b3730'), dirt * 0.5);
      p.rough = 0.45 + smooth(0.45, 0.8, n2(u, v, 5, 5, 4)) * 0.25 + dirt * 0.2;
      p.metal = 0.35 * (1 - dirt) * (1 - smooth(0.45, 0.8, n2(u, v, 5, 5, 4)) * 0.6);
    }, { normal: 14, cav: [0.004, 1.5], aoMin: 0.55 });
  }, 0.199),

  // Durchgerostetes Wellblech: 26 Wellen, rotbraun, senkrechte Laufspuren, schwarze Stellen, Lochfraß
  metal_corrugated_rusty: def('#592b19', 0.936, (size) => {
    const n1 = makeNoise(7301), n2 = makeNoise(7302), n3 = makeNoise(7303), holes = makeCells(18, 7304, 0.9);
    const rust = hex('#6b331c'), rustL = hex('#8e4a25'), black = hex('#2e1a12');
    return assemble(size, (u, v, p) => {
      const wave = 0.5 + 0.5 * Math.sin(u * 26 * Math.PI * 2);
      const streak = n1(u, v, 60, 3, 3);
      const h = holes(u, v), pit = smooth(0.12, 0.06, h.d1) * (hashI(h.id, 1, 7305) > 0.8 ? 1 : 0);
      p.h = wave * 0.85 - pit * 0.3 + (n2(u, v, 160, 160, 3) - 0.5) * 0.12;
      let col = mix3(rust, rustL, smooth(0.4, 0.75, streak) * 0.7).map((x) => x * (0.85 + 0.3 * (n2(u, v, 50, 50, 2) - 0.5)));
      col = mix3(col, black, smooth(0.62, 0.8, n3(u, v, 8, 8, 4)) * 0.5 + pit * 0.8);
      p.col = col;
      p.rough = 0.93;
    }, { normal: 12, cav: [0.004, 2], aoMin: 0.45 });
  }),

  // Trapezblech-Fassade grün: 8 Rippen, Kreide-Ausblühung, gelbliche Laufspuren unter den Rippen, Schraubenreihen
  metal_cladding_green: def('#63774d', 0.95, (size) => {
    const n1 = makeNoise(7401), n2 = makeNoise(7402), n3 = makeNoise(7403);
    const paint = hex('#648055'), chalk = hex('#8aa07a'), ochre = hex('#8a8a3a');
    return assemble(size, (u, v, p) => {
      const x = u * 8, f = x - Math.floor(x);
      // Trapez: Rippe oben (0.35..0.65), Flanken, Tal
      const prof = smooth(0.22, 0.32, f) * smooth(0.78, 0.68, f);
      const flank = smooth(0.22, 0.32, f) - smooth(0.68, 0.78, f) < 0 ? 0 : (f < 0.32 && f > 0.22) || (f > 0.68 && f < 0.78) ? 1 : 0;
      const screw = smooth(0.008, 0.004, Math.hypot((f - 0.05) / 8, frac(v * 3) / 3 - 0.16)) + smooth(0.008, 0.004, Math.hypot((f - 0.95) / 8, frac(v * 3) / 3 - 0.16));
      const streak = smooth(0.5, 0.8, n1(u, v, 40, 3, 3)) * smooth(0.35, 0.2, Math.abs(f - 0.15)) ;
      p.h = prof * 0.8 + screw * 0.1;
      let col = paint.map((x) => x * (0.9 + 0.12 * (n2(u, v, 6, 6, 4) - 0.5) + prof * 0.06));
      col = mix3(col, chalk, smooth(0.5, 0.8, n3(u, v, 10, 4, 4)) * 0.4 * prof);
      col = mix3(col, ochre, streak * 0.55);
      p.col = mix3(col, hex('#3c4a35'), screw);
      p.rough = 0.95;
      p.metal = screw * 0.6;
    }, { normal: 8, cav: [0.004, 1.5], aoMin: 0.5 });
  }),

  // Rolltor-Lamellen: 28 Profile, jede mit Sicke, hellgrau lackiert, Kratzer, Staub in den Fugen
  metal_shutter: def('#808487', 0.633, (size) => {
    const n1 = makeNoise(7501), n2 = makeNoise(7502);
    const S = makeStrokes(6, 2, 7503, { ang: [0, 0.2], len: [1, 3], wid: [0.008, 0.016] });
    const paint = hex('#8a8e91');
    return assemble(size, (u, v, p) => {
      const y = v * 28, f = y - Math.floor(y);
      const prof = Math.sin(Math.PI * f) * 0.7 + smooth(0.45, 0.5, f) * smooth(0.6, 0.55, f) * -0.25;
      const joint = 1 - smooth(0.0, 0.08, Math.min(f, 1 - f));
      const sc = S(u, v).m;
      p.h = prof - sc * 0.05;
      let col = paint.map((x) => x * (0.92 + 0.1 * (n1(u, v, 6, 6, 4) - 0.5) + 0.06 * prof));
      col = mix3(col, hex('#5d5f5e'), joint * 0.6 + smooth(0.6, 0.85, n2(u, v, 20, 4, 3)) * 0.2);
      p.col = mix3(col, hex('#b8bcbe'), sc * 0.5);
      p.rough = 0.62 + sc * 0.1;
    }, { normal: 7, cav: [0.004, 1.5], aoMin: 0.5 });
  }),

  // Verzinktes Blech glatt: Zinkblumen (Kristallflecken), Walzriefen, metallisch
  metal_galvanized: def('#929598', 0.469, (size) => {
    const n1 = makeNoise(7601), n2 = makeNoise(7602), sp = makeCells(30, 7603, 1.0);
    const zinc = hex('#9a9da0');
    return assemble(size, (u, v, p) => {
      const s = sp(u, v), sh = hashI(s.id, 1, 7604);
      const brush = n1(u, v, 4, 300, 2);
      p.h = 0.5 + (brush - 0.5) * 0.02;
      p.col = zinc.map((x) => x * (0.95 + 0.06 * sh + 0.05 * (brush - 0.5) + 0.06 * (n2(u, v, 5, 5, 3) - 0.5)));
      p.rough = 0.42 + sh * 0.1 + (n2(u, v, 7, 7, 4) - 0.5) * 0.15;
      p.metal = 1;
    }, { normal: 1, cav: [0.003, 1], aoMin: 0.9 });
  }, 1),

  // Riffelblech (Tränenblech) rostig: Linsen wechselnd gedreht, olivbraune Patina, blanke Kanten
  metal_tread: def('#3f341d', 0.589, (size) => {
    const n1 = makeNoise(7701), n2 = makeNoise(7702), N = 14;
    const steel = hex('#5f5e57'), rust = hex('#5c4120'), olive = hex('#4a4628');
    return assemble(size, (u, v, p) => {
      const x = u * N, y = v * N, i = Math.floor(x), j = Math.floor(y), fx = x - i - 0.5, fy = y - j - 0.5;
      const a = (i + j) % 2 ? Math.PI / 4 : -Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
      const al = fx * ca + fy * sa, ac = -fx * sa + fy * ca;
      const lens = clamp01(1 - (al / 0.38) ** 2 - (ac / 0.07) ** 2);
      const bump = Math.sqrt(lens);
      const rn = n1(u, v, 5, 5, 5);
      p.h = 0.3 + bump * 0.6;
      let col = mix3(olive, rust, smooth(0.4, 0.7, rn)).map((x) => x * (0.85 + 0.3 * (n2(u, v, 40, 40, 2) - 0.5)));
      col = mix3(col, steel, smooth(0.3, 0.8, bump) * (1 - smooth(0.6, 0.8, rn) * 0.6) * 0.85);
      p.col = col;
      p.metal = smooth(0.5, 0.9, bump) * 0.8 * (1 - smooth(0.5, 0.7, rn)) + 0.15;
      p.rough = 0.65 - bump * 0.15;
    }, { normal: 12, cav: [0.004, 1.5], aoMin: 0.5 });
  }, 0.386),

  // Langloch-Gitterrost (Alpha): 20 Reihen × 8 Langlöcher, dunkel blaugrau beschichtet, blanke Trittflächen
  metal_grate: def('#313038', 0.474, (size) => {
    const n1 = makeNoise(7801), n2 = makeNoise(7802);
    const bond = makeBond(20, 8, { seed: 7803 });
    const coat = hex('#363540'), bare = hex('#6b6c70');
    return assemble(size, (u, v, p) => {
      const b = bond(u, v);
      // Langloch: Rechteck mit runden Enden in der Mitte des Felds
      const lx = (b.fu - 0.5) * b.w, ly = (b.fv - 0.5) * b.h;
      const hl = b.w * 0.36, hr = b.h * 0.3;
      const d = Math.hypot(Math.max(0, Math.abs(lx) - hl), ly) - hr;
      const hole = smooth(0.0006, -0.0006, d);
      const wear = smooth(0.6, 0.85, n1(u, v, 6, 6, 4)) * smooth(0.0, 0.004, d);
      p.h = 0.5 + smooth(0.0, 0.003, d) * 0.2;
      p.col = mix3(coat.map((x) => x * (0.9 + 0.15 * n2(u, v, 20, 20, 3))), bare, wear * 0.6);
      p.alpha = 1 - hole;
      p.rough = 0.5 - wear * 0.15;
      p.metal = wear * 0.7;
    }, { normal: 3, cav: [0.003, 1.2], aoMin: 0.6 });
  }),

  // Maschendraht (Alpha): verzinkte Drähte im Rautenmuster, 16 Rauten je Kachel, Verdrillung an den Knoten
  chainlink: def('#9ea0a3', 0.477, (size) => {
    const n1 = makeNoise(7901), N = 16;
    const zinc = hex('#a3a5a8'), rust = hex('#8a6a4a');
    return assemble(size, (u, v, p) => {
      // zwei Drahtscharen diagonal
      const a = frac((u + v) * N), b = frac((u - v) * N);
      const da = Math.min(a, 1 - a), db = Math.min(b, 1 - b);
      const w = 0.07;
      const wa = smooth(w, w * 0.4, da), wb = smooth(w, w * 0.4, db);
      const wire = Math.max(wa, wb);
      const twist = 0.5 + 0.5 * Math.sin((u - v) * N * Math.PI * 2 * 3);
      p.h = wire * (0.5 + 0.3 * (wa > wb ? twist : 1 - twist));
      p.col = mix3(zinc.map((x) => x * (0.85 + 0.25 * twist)), rust, smooth(0.7, 0.9, n1(u, v, 8, 8, 4)) * 0.5);
      p.alpha = wire;
      p.rough = 0.45;
      p.metal = 1;
    }, { normal: 3, cav: [0.002, 1], aoMin: 0.7 });
  }, 1),

  // Warnanstrich gelb/schwarz schräg, abgewittert: Rostplatten, Kratzer, Schmutz
  hazard_stripes: def('#846e11', 0.634, (size) => {
    const n1 = makeNoise(8001), n2 = makeNoise(8002), n3 = makeNoise(8003);
    const yel = hex('#e2b70f'), blk = hex('#1b1a17'), rust = hex('#6c3a17');
    return assemble(size, (u, v, p) => {
      const st = frac((u + v) * 8);
      const isY = smooth(0.48, 0.5, st) * smooth(1.0, 0.98, st) + smooth(0.02, 0.0, st);
      const rn = n1(u, v, 4, 4, 6) * 0.75 + n2(u, v, 24, 24, 3) * 0.25;
      const rustM = smooth(0.6, 0.64, rn), edge = smooth(0.57, 0.6, rn) * (1 - rustM);
      p.h = 0.5 + (1 - rustM) * 0.08 + edge * 0.04 - rustM * (n3(u, v, 80, 80, 2) * 0.1);
      let col = mix3(blk, yel, isY).map((x) => x * (0.88 + 0.12 * n3(u, v, 8, 8, 4)));
      col = mix3(col, mix3(rust, hex('#8e5424'), n3(u, v, 30, 30, 2)), rustM);
      p.col = mix3(col, hex('#3a2a18'), edge * 0.4);
      p.rough = mix(0.5, 0.88, rustM);
    }, { normal: 3, cav: [0.003, 2], aoMin: 0.55 });
  }),

  // Containerwand (neutral, Farbe aus der Karte): 7 Trapezsicken, Lack mit Kreidung, Rost an Kanten, Dellen
  container: def('#aaaaaa', 0.666, (size) => {
    const n1 = makeNoise(8101), n2 = makeNoise(8102), n3 = makeNoise(8103);
    const paint = hex('#ababab'), rust = hex('#7a4a2a');
    return assemble(size, (u, v, p) => {
      const f = frac(u * 7);
      const prof = smooth(0.12, 0.25, f) * smooth(0.62, 0.5, f);
      const edgeE = Math.abs(f - 0.185) < 0.07 || Math.abs(f - 0.56) < 0.07 ? 1 : 0;
      const dent = (n1(u, v, 3, 3, 3) - 0.5) * 0.15;
      const rustM = smooth(0.72, 0.8, n2(u, v, 10, 10, 5)) * (0.4 + 0.6 * edgeE);
      p.h = prof * 0.8 + dent;
      let col = paint.map((x) => x * (0.92 + 0.1 * (n3(u, v, 6, 6, 4) - 0.5) + 0.05 * prof));
      col = mix3(col, hex('#c4c4c4'), smooth(0.55, 0.85, n3(u, v, 12, 3, 3)) * 0.25);
      p.col = mix3(col, rust, clamp01(rustM));
      p.rough = mix(0.62, 0.9, clamp01(rustM));
    }, { normal: 8, cav: [0.004, 1.5], aoMin: 0.55 });
  }),

  // Abgenutzter Waffenstahl (brüniert): dunkle Brünierung, blankgegriffene Stellen, feine Kratzer
  gunmetal_worn: def('#3f3f40', 0.354, (size) => {
    const n1 = makeNoise(8201), n2 = makeNoise(8202);
    const S = makeStrokes(10, 2, 8203, { ang: [0, Math.PI], len: [0.6, 1.6], wid: [0.01, 0.02] });
    const blue = hex('#353638'), bare = hex('#6e6f72');
    return assemble(size, (u, v, p) => {
      const wear = smooth(0.58, 0.82, n1(u, v, 6, 6, 5));
      const sc = S(u, v).m;
      p.h = 0.5 - sc * 0.05;
      p.col = mix3(blue.map((x) => x * (0.92 + 0.12 * n2(u, v, 30, 30, 3))), bare, Math.max(wear * 0.7, sc * 0.6));
      p.rough = 0.38 - wear * 0.12 + sc * 0.1;
      p.metal = 0.75 + wear * 0.25;
    }, { normal: 1, cav: [0.003, 1], aoMin: 0.85 });
  }, 0.826),

  // Schwarzer Kunststoff: feine Erodier-Struktur (Stippling), leicht glänzend, Griffspuren
  polymer_black: def('#07080a', 0.249, (size) => {
    const n1 = makeNoise(8301), st = makeCells(160, 8302, 1.0);
    return assemble(size, (u, v, p) => {
      const s = st(u, v), dot = smooth(0.4, 0.2, s.d1);
      p.h = 0.5 + dot * 0.2;
      p.col = hex('#0a0b0d').map((x) => x * (0.9 + 0.2 * hashI(s.id, 1, 8303)));
      p.rough = 0.24 + dot * 0.04 + smooth(0.6, 0.9, n1(u, v, 6, 6, 4)) * -0.06;
    }, { normal: 2, cav: [0.002, 1], aoMin: 0.9 });
  }),

  // Gummi: fein genarbte Oberfläche, Abrieb
  rubber: def('#2a2c32', 0.591, (size) => {
    const n1 = makeNoise(8401), n2 = makeNoise(8402);
    return assemble(size, (u, v, p) => {
      const g = n1(u, v, 140, 140, 3);
      p.h = 0.5 + (g - 0.5) * 0.3;
      p.col = hex('#2b2d33').map((x) => x * (0.9 + 0.15 * (g - 0.5) + 0.1 * (n2(u, v, 6, 6, 4) - 0.5)));
      p.rough = 0.58 + (g - 0.5) * 0.1;
    }, { normal: 3, cav: [0.003, 1.2], aoMin: 0.8 });
  }),

  /* ================================================================ Stoffe */
  // Jute (Sandsack): grobe Leinwandbindung ~ 90 Fäden, ungleich dicke Fäden, Löcher dunkel, Fusseln
  burlap: def('#907b5b', 0.584, (size) => {
    const n1 = makeNoise(8501), n2 = makeNoise(8502), n3 = makeNoise(8503);
    const fib = hex('#9c8560'), dark = hex('#3f3424');
    return assemble(size, (u, v, p) => {
      const ju = u + (n1(u, v, 8, 8, 2) - 0.5) * 0.004, jv = v + (n1(u + 0.5, v, 8, 8, 2) - 0.5) * 0.004;
      const w = weave(ju, jv, 90);
      const thick = 0.85 + 0.3 * hashI(w.warp ? w.i : w.j + 500, 1, 8504);
      const fuzz = n2(u, v, 400, 400, 1);
      p.h = w.h * thick + (fuzz - 0.5) * 0.1;
      let col = fib.map((x) => x * (0.75 + 0.35 * w.h + 0.12 * (hashI(w.warp ? w.i : w.j + 500, 2, 8505) - 0.5) + 0.1 * (fuzz - 0.5)));
      col = mix3(col, hex('#7a6748'), smooth(0.5, 0.8, n3(u, v, 5, 5, 4)) * 0.3);
      p.col = mix3(col, dark, w.gap);
      p.rough = 0.6;
      p.ao = 1 - w.gap * 0.6;
    }, { normal: 5, cav: [0.003, 1.5], aoMin: 0.35 });
  }),

  // Zeltbahn/Leinen (neutral, Farbe aus der Karte): feine Leinwandbindung, Fadenverdickungen, leichte Knitter
  canvas: def('#b4b4b4', 0.659, (size) => {
    const n1 = makeNoise(8601), n2 = makeNoise(8602), n3 = makeNoise(8603);
    return assemble(size, (u, v, p) => {
      const w = weave(u, v, 150);
      const slub = n1(w.warp ? u : v, w.warp ? v : u, 150, 6, 2);
      const crease = n2(u, v, 3, 3, 3);
      p.h = w.h * (0.8 + 0.4 * slub) * 0.6 + crease * 0.4;
      p.col = hex('#b5b5b5').map((x) => x * (0.82 + 0.25 * w.h + 0.08 * (slub - 0.5) + 0.06 * (n3(u, v, 6, 6, 3) - 0.5)) * (1 - w.gap * 0.4));
      p.rough = 0.66;
    }, { normal: 3, cav: [0.003, 1.5], aoMin: 0.6 });
  }),

  // Markisenstoff: schräge rot/weiße Streifen (Köper), feine Bindung
  awning_stripes: def('#d197a1', 0.866, (size) => {
    const n1 = makeNoise(8701);
    const red = hex('#c03548'), white = hex('#ece6e4');
    return assemble(size, (u, v, p) => {
      const w = weave(u, v, 200);
      const st = frac((u - v) * 40);
      const isW = smooth(0.42, 0.46, st) * smooth(0.96, 0.92, st);
      p.h = w.h * 0.6;
      p.col = mix3(red, white, isW).map((x) => x * (0.85 + 0.2 * w.h + 0.06 * (n1(u, v, 8, 8, 3) - 0.5)));
      p.rough = 0.86;
    }, { normal: 2, cav: [0.002, 1.2], aoMin: 0.7 });
  }),

  // Uniformstoff (neutral, Grundlage der Tarnmuster): Rip-Stop-Gitter alle 5 mm auf feinem Köper, 10 cm Kachel
  fabric_uniform: def('#9a9a9a', 0.829, (size) => {
    const n1 = makeNoise(8801), n2 = makeNoise(8802);
    return assemble(size, (u, v, p) => {
      const tw = frac((u * 120 + v * 120) / 2 + 0.25 * Math.floor(v * 120) * 0) ; // Köpergrat diagonal
      const twill = 0.5 + 0.5 * Math.sin((u + v) * 120 * Math.PI * 2);
      const w = weave(u, v, 120);
      const gx = frac(u * 20), gy = frac(v * 20);
      const rip = Math.max(smooth(0.06, 0.0, Math.min(gx, 1 - gx)), smooth(0.06, 0.0, Math.min(gy, 1 - gy)));
      p.h = w.h * 0.4 + twill * 0.25 + rip * 0.35 + tw * 0;
      p.col = hex('#9b9b9b').map((x) => x * (0.86 + 0.12 * w.h + 0.06 * twill + 0.08 * rip + 0.06 * (n1(u, v, 10, 10, 3) - 0.5)));
      p.rough = 0.83 + (n2(u, v, 30, 30, 2) - 0.5) * 0.05;
    }, { normal: 3, cav: [0.003, 1.5], aoMin: 0.55 });
  }),
};
