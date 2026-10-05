// NULLPUNKT — Sonden-Gitter (Realismus-Plan R5/A2, Owner: world): beim Laden gebackenes Licht- und Akustik-Gitter.
//
// Ohne three-Abhängigkeit (läuft im Welt-Worker, Rückfall Hauptthread). Je Zelle (2 m, low 3 m, ultra 1,5 m):
//   • Himmelssicht V (kosinusgewichtet, obere Halbkugel; Glas lässt Licht durch) + 1 Streuschritt durch Öffnungen
//     (Himmelslicht fällt durch Türen/Fenster ein Stück in den Raum) → multipliziert Himmels-/Umgebungslicht im Material
//   • Sonnen-Rückprall (1 Sprung): Strahlen treffen Flächen; besonnt (CPU-Schattenraster aus Sonnenrichtung)?
//     → Albedo × cos × Sonne. Gespeichert als Anteil der Sonnenbestrahlung (rgb, sqrt-codiert)
//   • Sonnensicht der Zelle (Fernschatten auf low / ohne Schattenkarten)
//   • bis zu 3 Lichtgruppen (Lampen gebacken, Flackern zur Laufzeit über Uniforms)
//   • Akustik: Innenanteil, Deckenhöhe, mittlere freie Weglänge, Offenheit, Wandabstände in 8 Richtungen, Absorption
// Zellen in massiver Geometrie (Rückseitentreffer) werden aus Nachbarn aufgefüllt – kein Dunkel-Durchbluten in Wände.

const TAU = Math.PI * 2;

/** Stufen: Zellmaß (m), Himmelsstrahlen, Abwärtsstrahlen. */
export const PROBE_TIERS = Object.freeze({
  low: Object.freeze({ spacing: 3, sky: 12, down: 6 }),
  medium: Object.freeze({ spacing: 2.5, sky: 14, down: 6 }),
  high: Object.freeze({ spacing: 2, sky: 16, down: 8 }),
  ultra: Object.freeze({ spacing: 1.6, sky: 18, down: 8 }),
});

/** Schallabsorption je Oberfläche (Index wie builder.SURFACES). */
const ABSORB = [0.05, 0.04, 0.18, 0.35, 0.4, 0.5, 0.03, 0.02, 0.03, 0.6, 0.5];
const GLASS = 6;
const MAX_D = 48;          // Strahlenreichweite (m) – darüber „frei“
const B_SCALE = 0.5;       // Rückprall-Codierung: gespeichert sqrt(B / B_SCALE), B in Anteilen der Sonnenbestrahlung
export const PROBE_BOUNCE_SCALE = B_SCALE;
export const PROBE_MAX_D = MAX_D;

/** Kosinusgewichtete Richtungen auf der Halbkugel um +Y (Hammersley), y ≥ 0. */
function hemiDirs(n, ySign = 1) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let bits = i; bits = ((bits << 16) | (bits >>> 16)) >>> 0;
    bits = (((bits & 0x55555555) << 1) | ((bits & 0xAAAAAAAA) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xCCCCCCCC) >>> 2)) >>> 0;
    bits = (((bits & 0x0F0F0F0F) << 4) | ((bits & 0xF0F0F0F0) >>> 4)) >>> 0;
    bits = (((bits & 0x00FF00FF) << 8) | ((bits & 0xFF00FF00) >>> 8)) >>> 0;
    const u = (i + 0.5) / n, v = bits / 4294967296;
    const r = Math.sqrt(u), phi = TAU * v;
    const y = Math.sqrt(Math.max(0, 1 - u));
    out[i * 3] = r * Math.cos(phi); out[i * 3 + 1] = y * ySign; out[i * 3 + 2] = r * Math.sin(phi);
  }
  return out;
}

const hash = (i, j, k) => { let h = Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * CPU-Schattenraster aus Sonnenrichtung (orthografisch): je Texel die größte Lichttiefe (Abstand zur Sonne hin) der
 * Geometrie. Punkt p besonnt ⇔ dot(p, L) ≥ Raster(u, v) − bias. Kleine Dreiecke markieren mindestens ihr Texel.
 */
function sunRaster(tri, count, L, bounds, texel) {
  // Basis: U waagerecht ⊥ L, W = L × U … beliebige Orthonormalbasis
  let ux = -L[2], uy = 0, uz = L[0];
  let ul = Math.hypot(ux, uz);
  if (ul < 1e-4) { ux = 1; uz = 0; ul = 1; }
  ux /= ul; uz /= ul;
  const wx = L[1] * uz - L[2] * uy, wy = L[2] * ux - L[0] * uz, wz = L[0] * uy - L[1] * ux;
  // Ausdehnung aus den Ecken des Gitterbereichs
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) for (const z of [bounds.minZ, bounds.maxZ]) {
    const u = x * ux + y * uy + z * uz, v = x * wx + y * wy + z * wz;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const W = Math.max(2, Math.ceil((u1 - u0) / texel)), H = Math.max(2, Math.ceil((v1 - v0) / texel));
  const depth = new Float32Array(W * H).fill(-1e9);
  const inv = 1 / texel;
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
    const bx = ax + tri[o + 3], by = ay + tri[o + 4], bz = az + tri[o + 5];
    const cx = ax + tri[o + 6], cy = ay + tri[o + 7], cz = az + tri[o + 8];
    const pu0 = (ax * ux + ay * uy + az * uz - u0) * inv, pv0 = (ax * wx + ay * wy + az * wz - v0) * inv;
    const pu1 = (bx * ux + by * uy + bz * uz - u0) * inv, pv1 = (bx * wx + by * wy + bz * wz - v0) * inv;
    const pu2 = (cx * ux + cy * uy + cz * uz - u0) * inv, pv2 = (cx * wx + cy * wy + cz * wz - v0) * inv;
    const d0 = ax * L[0] + ay * L[1] + az * L[2], d1 = bx * L[0] + by * L[1] + bz * L[2], d2 = cx * L[0] + cy * L[1] + cz * L[2];
    const iu0 = Math.max(0, Math.floor(Math.min(pu0, pu1, pu2))), iu1 = Math.min(W - 1, Math.floor(Math.max(pu0, pu1, pu2)));
    const iv0 = Math.max(0, Math.floor(Math.min(pv0, pv1, pv2))), iv1 = Math.min(H - 1, Math.floor(Math.max(pv0, pv1, pv2)));
    if (iu1 < iu0 || iv1 < iv0) continue;
    const det = (pu1 - pu0) * (pv2 - pv0) - (pu2 - pu0) * (pv1 - pv0);
    if (iu0 === iu1 && iv0 === iv1 || Math.abs(det) < 1e-6) {
      // winziges bzw. kantenständiges Dreieck: größte Tiefe in alle berührten Texel
      const dm = Math.max(d0, d1, d2);
      for (let j = iv0; j <= iv1; j++) for (let i = iu0; i <= iu1; i++) { const k = j * W + i; if (dm > depth[k]) depth[k] = dm; }
      continue;
    }
    const id = 1 / det;
    let hit = false;
    for (let j = iv0; j <= iv1; j++) {
      const pv = j + 0.5;
      for (let i = iu0; i <= iu1; i++) {
        const pu = i + 0.5;
        const l1 = ((pu - pu0) * (pv2 - pv0) - (pu2 - pu0) * (pv - pv0)) * id;
        const l2 = ((pu1 - pu0) * (pv - pv0) - (pu - pu0) * (pv1 - pv0)) * id;
        const e = 0.02;
        if (l1 < -e || l2 < -e || l1 + l2 > 1 + e) continue;
        const d = d0 + (d1 - d0) * l1 + (d2 - d0) * l2;
        const k = j * W + i;
        if (d > depth[k]) depth[k] = d;
        hit = true;
      }
    }
    if (!hit) { // schmaler Splitter zwischen Texelmitten: Schwerpunkt-Texel
      const i = Math.min(W - 1, Math.max(0, Math.floor((pu0 + pu1 + pu2) / 3))), j = Math.min(H - 1, Math.max(0, Math.floor((pv0 + pv1 + pv2) / 3)));
      const dm = Math.max(d0, d1, d2), k = j * W + i;
      if (dm > depth[k]) depth[k] = dm;
    }
  }
  const sx = ux, sz = uz;
  return {
    W, H, depth, texel,
    /** 1 = besonnt, 0 = verschattet (bias in m). */
    lit(x, y, z, bias = 0.25) {
      const u = (x * sx + z * sz - u0) * inv, v = (x * wx + y * wy + z * wz - v0) * inv;
      const i = Math.floor(u), j = Math.floor(v);
      if (i < 0 || j < 0 || i >= W || j >= H) return 1;
      const d = x * L[0] + y * L[1] + z * L[2];
      return d >= depth[j * W + i] - bias ? 1 : 0;
    },
  };
}

/**
 * Backt das Gitter. bvh: TriangleBVH (Kugel-Geometrie; data & 255 = Oberfläche, orig = ursprünglicher Index),
 * opts: { bounds {minX,maxX,minY,maxY,minZ,maxZ}, tier ('low'|…), sunDir [x,y,z] (zur Sonne), albedo Uint8Array
 *   (RGB je ursprünglichem Dreieck, sRGB-nah linear·255), lights [{x,y,z,color:[r,g,b],intensity,distance,group}] }
 * → { dims [nx,ny,nz], min [x,y,z] (Gitterecke), spacing, a Uint8Array(n·4), b Uint8Array(n·4), groups [{color,max}],
 *     acoustic { indoor, ceil, free, open, absorb (Uint8Array n), walls Uint8Array(n·8) }, stats }
 */
export function bakeProbes(bvh, opts) {
  const t0 = now();
  const tier = PROBE_TIERS[opts.tier] || PROBE_TIERS.high;
  const s = opts.spacing || tier.spacing;
  const B = opts.bounds;
  const L = normalize(opts.sunDir || [0.3, 0.8, 0.2]);
  // Gitter: Zellmitten in y bei 1 + k·s (1 m über dem Erdgeschoss), waagerecht ab minX
  const kY0 = Math.floor((B.minY - 1) / s), kY1 = Math.ceil((B.maxY - 1) / s);
  const nx = Math.max(2, Math.ceil((B.maxX - B.minX) / s)), nz = Math.max(2, Math.ceil((B.maxZ - B.minZ) / s)), ny = Math.max(2, kY1 - kY0 + 1);
  const ox = B.minX + s / 2, oy = 1 + kY0 * s, oz = B.minZ + s / 2; // erste Zellmitte
  const n = nx * ny * nz;
  const idx = (i, j, k) => (k * ny + j) * nx + i;

  const tri = bvh.tri, orig = bvh.orig, data = bvh.data, count = bvh.count;
  const albedo = opts.albedo || null;
  // Spaltenhöhen (größte Geometriehöhe je Gitterspalte, 3×3 aufgeweitet) → Zellen darüber sind frei
  const colTop = new Float32Array(nx * nz).fill(-1e9);
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
    const bx = ax + tri[o + 3], by = ay + tri[o + 4], bz = az + tri[o + 5];
    const cx = ax + tri[o + 6], cy = ay + tri[o + 7], cz = az + tri[o + 8];
    const top = Math.max(ay, by, cy);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - B.minX) / s)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - B.minX) / s));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - B.minZ) / s)), k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - B.minZ) / s));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) { const c = k * nx + i; if (top > colTop[c]) colTop[c] = top; }
  }
  const colTop3 = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    let m = -1e9;
    for (let dk = -2; dk <= 2; dk++) for (let di = -2; di <= 2; di++) {
      const ii = i + di, kk = k + dk;
      if (ii >= 0 && kk >= 0 && ii < nx && kk < nz && colTop[kk * nx + ii] > m) m = colTop[kk * nx + ii];
    }
    colTop3[k * nx + i] = m;
  }
  const tCol = now();

  // Sonnenraster (Rückprall + Sonnensicht)
  const rasterTexel = s <= 1.7 ? 0.22 : s <= 2.2 ? 0.28 : 0.4;
  const sun = L[1] > 0.01 ? sunRaster(tri, count, L, { minX: B.minX - 10, maxX: B.maxX + 10, minY: B.minY, maxY: B.maxY + 10, minZ: B.minZ - 10, maxZ: B.maxZ + 10 }, rasterTexel) : null;
  const tSun = now();

  // Strahlensätze
  const SKY = hemiDirs(tier.sky, 1), DOWN = hemiDirs(tier.down, -1);
  const HOR = new Float32Array(24);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; HOR[k * 3] = Math.cos(a); HOR[k * 3 + 2] = -Math.sin(a); } // 0 = +X, gegen den Uhrzeigersinn um +Y
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };

  // Ergebnisfelder
  const V = new Float32Array(n);          // Himmelssicht (roh)
  const BR = new Float32Array(n * 3);     // Rückprall (Anteil Sonnenbestrahlung)
  const SV = new Float32Array(n);         // Sonnensicht
  const valid = new Uint8Array(n);        // 1 = frei, 0 = in Geometrie
  const walls = new Uint8Array(n * 8);
  const ceil = new Uint8Array(n), free = new Uint8Array(n), open = new Uint8Array(n), absorb = new Uint8Array(n);
  const qd = (d) => Math.round(Math.sqrt(Math.min(d, MAX_D) / MAX_D) * 254); // 255 = frei (∞)
  let traced = 0, rays = 0;

  // Treffer inkl. Glas-Durchgang; Rückgabe: Abstand (Infinity = frei); setzt last* für Rückprall/Akustik
  let lastBack = false, lastTri = -1, lastSurf = 0, lastNx = 0, lastNy = 0, lastNz = 0;
  const trace = (x, y, z, dx, dy, dz, maxD) => {
    let travelled = 0;
    for (let g = 0; g < 4; g++) {
      rays++;
      if (!bvh.raycast(x, y, z, dx, dy, dz, maxD - travelled, hit)) return Infinity;
      const surf = data[hit.tri] & 255;
      if (surf === GLASS) { // Glas: Licht geht durch, weiter dahinter
        const step = hit.t + 0.02; travelled += step;
        x += dx * step; y += dy * step; z += dz * step;
        if (travelled >= maxD) return Infinity;
        continue;
      }
      const o = hit.tri * 9;
      const e1x = tri[o + 3], e1y = tri[o + 4], e1z = tri[o + 5], e2x = tri[o + 6], e2y = tri[o + 7], e2z = tri[o + 8];
      const rx = e1y * e2z - e1z * e2y, ry = e1z * e2x - e1x * e2z, rz = e1x * e2y - e1y * e2x;
      lastBack = rx * dx + ry * dy + rz * dz > 0;
      lastTri = hit.tri; lastSurf = surf; lastNx = hit.nx; lastNy = hit.ny; lastNz = hit.nz;
      return travelled + hit.t;
    }
    return Infinity;
  };

  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = idx(i, j, k);
    const x = ox + i * s, y = oy + j * s, z = oz + k * s;
    // frei über allen Dächern der Umgebung → offener Himmel
    if (y > colTop3[k * nx + i] + 0.5) {
      V[c] = 1; SV[c] = 1; valid[c] = 1;
      walls.fill(255, c * 8, c * 8 + 8); ceil[c] = 255; free[c] = 255; open[c] = 255; absorb[c] = 0;
      continue;
    }
    traced++;
    const rot = hash(i, j, k) * TAU, cr = Math.cos(rot), sr = Math.sin(rot);
    let esc = 0, back = 0, close = 0, nHits = 0, br = 0, bg = 0, bb = 0, sumD = 0, nRays = 0, absSum = 0, escAll = 0;
    const bounce = (d, dx, dy, dz, w) => {
      // Fläche bei Treffer: besonnt? → Albedo × cos(Sonne) × w
      if (!sun || lastBack) return;
      const cosS = lastNx * L[0] + lastNy * L[1] + lastNz * L[2];
      if (cosS <= 0) return;
      const hx = x + dx * d + lastNx * 0.08, hy = y + dy * d + lastNy * 0.08, hz = z + dz * d + lastNz * 0.08;
      if (!sun.lit(hx, hy, hz)) return;
      let ar = 0.4, ag = 0.4, ab = 0.4;
      if (albedo) { const a = orig[lastTri] * 3; ar = albedo[a] / 255; ag = albedo[a + 1] / 255; ab = albedo[a + 2] / 255; }
      const f = cosS * w;
      br += ar * f; bg += ag * f; bb += ab * f;
    };
    const ray = (dx, dy, dz, w, sky) => {
      const d = trace(x, y, z, dx, dy, dz, MAX_D);
      nRays++;
      if (d === Infinity) { if (sky) esc++; escAll++; sumD += MAX_D; return d; }
      sumD += d; nHits++;
      if (lastBack) { back++; if (d < s * 0.75) close++; } else absSum += ABSORB[lastSurf] ?? 0.05;
      bounce(d, dx, dy, dz, w);
      return d;
    };
    // obere Halbkugel (Himmelssicht + Rückprall von Wänden/Decken)
    for (let r = 0; r < SKY.length; r += 3) {
      const dx = SKY[r] * cr - SKY[r + 2] * sr, dz = SKY[r] * sr + SKY[r + 2] * cr;
      ray(dx, SKY[r + 1], dz, 1, true);
    }
    // untere Halbkugel (Rückprall vom Boden, Erkennung „in Geometrie“)
    for (let r = 0; r < DOWN.length; r += 3) {
      const dx = DOWN[r] * cr - DOWN[r + 2] * sr, dz = DOWN[r] * sr + DOWN[r + 2] * cr;
      ray(dx, DOWN[r + 1], dz, 1, false);
    }
    // waagerecht: Wandabstände (Akustik) + Rückprall
    for (let r = 0; r < 8; r++) {
      const d = ray(HOR[r * 3], 0, HOR[r * 3 + 2], 0.5, false);
      walls[c * 8 + r] = d === Infinity ? 255 : qd(d);
    }
    // Decke
    const dUp = trace(x, y, z, 0, 1, 0, MAX_D);
    ceil[c] = dUp === Infinity ? 255 : qd(dUp);
    const total = SKY.length / 3 + DOWN.length / 3 + 8;
    const isValid = !(back > total * 0.45 || close > total * 0.3);
    valid[c] = isValid ? 1 : 0;
    V[c] = esc / (SKY.length / 3);
    const wsum = SKY.length / 3 + DOWN.length / 3 + 4;
    BR[c * 3] = br / wsum; BR[c * 3 + 1] = bg / wsum; BR[c * 3 + 2] = bb / wsum;
    SV[c] = sun ? sun.lit(x, y, z, 0.15) : 1;
    free[c] = qd(sumD / Math.max(1, nRays));
    open[c] = Math.round((escAll / Math.max(1, nRays)) * 255);
    absorb[c] = Math.round(clamp01(nHits ? absSum / Math.max(1, nHits - back) : 0) * 255);
  }
  const tTrace = now();

  // Zellen in Geometrie aus gültigen Nachbarn füllen (mehrere Runden, 6er-Nachbarschaft)
  const fill = (fields, comps) => {
    const done = valid.slice();
    for (let pass = 0; pass < 4; pass++) {
      let changed = 0;
      const next = done.slice();
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = idx(i, j, k);
        if (done[c]) continue;
        let w = 0;
        const acc = new Float32Array(16);
        const take = (ii, jj, kk) => {
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) return;
          const q = idx(ii, jj, kk);
          if (!done[q]) return;
          let o = 0;
          for (let f = 0; f < fields.length; f++) for (let m = 0; m < comps[f]; m++) acc[o++] += fields[f][q * comps[f] + m];
          w++;
        };
        take(i - 1, j, k); take(i + 1, j, k); take(i, j + 1, k); take(i, j - 1, k); take(i, j, k - 1); take(i, j, k + 1);
        if (!w) continue;
        let o = 0;
        for (let f = 0; f < fields.length; f++) for (let m = 0; m < comps[f]; m++) fields[f][c * comps[f] + m] = acc[o++] / w;
        next[c] = 1; changed++;
      }
      done.set(next);
      if (!changed) break;
    }
  };
  fill([V, BR, SV], [1, 3, 1]);

  // Verbindungen zu den Nachbarn (+x, +y, +z) für die Streuung durch Öffnungen
  const link = new Uint8Array(n); // Bit 0: +x frei, 1: +y, 2: +z
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = idx(i, j, k);
    const x = ox + i * s, y = oy + j * s, z = oz + k * s;
    const top = y > colTop3[k * nx + i] + 0.5;
    let m = 0;
    if (top) m = 7;
    else {
      if (i + 1 < nx && !bvh.occluded(x, y, z, 1, 0, 0, s)) m |= 1;
      if (j + 1 < ny && !bvh.occluded(x, y, z, 0, 1, 0, s)) m |= 2;
      if (k + 1 < nz && !bvh.occluded(x, y, z, 0, 0, 1, s)) m |= 4;
      rays += 3;
    }
    link[c] = m;
  }
  // Streuung: Himmelslicht fällt durch Öffnungen ein (je Runde ≈ ein Zellschritt, abklingend)
  const gain = opts.scatter ?? 0.42;
  let S = Float32Array.from(V);
  const S2 = new Float32Array(n);
  const steps = Math.max(3, Math.round(9 / s));
  for (let it = 0; it < steps; it++) {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = idx(i, j, k);
      let sum = 0, w = 0;
      if (link[c] & 1) { sum += S[c + 1]; w++; }
      if (i > 0 && link[c - 1] & 1) { sum += S[c - 1]; w++; }
      if (link[c] & 2) { sum += S[c + nx]; w++; }
      if (j > 0 && link[c - nx] & 2) { sum += S[c - nx]; w++; }
      if (link[c] & 4) { sum += S[c + nx * ny]; w++; }
      if (k > 0 && link[c - nx * ny] & 4) { sum += S[c - nx * ny]; w++; }
      const nb = w ? sum / 6 : 0; // durch 6 statt w: geschlossene Seiten dämpfen
      S2[c] = Math.max(V[c], V[c] + (1 - V[c]) * gain * nb);
    }
    S.set(S2);
  }
  // Rückprall glätten (eine Runde über offene Verbindungen; Rauschen der wenigen Strahlen)
  const BR2 = BR.slice();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = idx(i, j, k);
    let w = 2;
    let r = BR[c * 3] * 2, g = BR[c * 3 + 1] * 2, b = BR[c * 3 + 2] * 2;
    const add = (q) => { r += BR[q * 3]; g += BR[q * 3 + 1]; b += BR[q * 3 + 2]; w++; };
    if (link[c] & 1) add(c + 1);
    if (i > 0 && link[c - 1] & 1) add(c - 1);
    if (link[c] & 2) add(c + nx);
    if (j > 0 && link[c - nx] & 2) add(c - nx);
    if (link[c] & 4) add(c + nx * ny);
    if (k > 0 && link[c - nx * ny] & 4) add(c - nx * ny);
    BR2[c * 3] = r / w; BR2[c * 3 + 1] = g / w; BR2[c * 3 + 2] = b / w;
  }
  const tScatter = now();

  // Lichtgruppen (gebackene Lampen): bis zu 3 Gruppen, je Zelle Bestrahlung × Sichtbarkeit
  const lights = opts.lights || [];
  const G = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const groupCol = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], groupW = [0, 0, 0];
  for (const Lt of lights) {
    const g = Math.max(0, Math.min(2, Lt.group | 0));
    const range = Lt.distance || 12;
    const lum = 0.2126 * Lt.color[0] + 0.7152 * Lt.color[1] + 0.0722 * Lt.color[2] || 1;
    groupCol[g][0] += Lt.color[0] / lum * Lt.intensity; groupCol[g][1] += Lt.color[1] / lum * Lt.intensity; groupCol[g][2] += Lt.color[2] / lum * Lt.intensity; groupW[g] += Lt.intensity;
    const i0 = Math.max(0, Math.floor((Lt.x - range - ox) / s)), i1 = Math.min(nx - 1, Math.ceil((Lt.x + range - ox) / s));
    const j0 = Math.max(0, Math.floor((Lt.y - range - oy) / s)), j1 = Math.min(ny - 1, Math.ceil((Lt.y + range - oy) / s));
    const k0 = Math.max(0, Math.floor((Lt.z - range - oz) / s)), k1 = Math.min(nz - 1, Math.ceil((Lt.z + range - oz) / s));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = idx(i, j, k);
      if (!valid[c]) continue;
      const x = ox + i * s, y = oy + j * s, z = oz + k * s;
      const dx = Lt.x - x, dy = Lt.y - y, dz = Lt.z - z, d = Math.hypot(dx, dy, dz);
      if (d >= range) continue;
      if (d > 0.3 && bvh.occluded(x, y, z, dx / d, dy / d, dz / d, d - 0.3)) continue;
      rays++;
      // wie three.js (physikalisch, Abklingen 2): I / d² · Fenster
      const win = Math.pow(clamp01(1 - Math.pow(d / range, 4)), 2);
      G[g][c] += lum * Lt.intensity * win / Math.max(d * d, 0.8);
    }
  }
  const groups = [0, 1, 2].map((g) => {
    let max = 0;
    for (let c = 0; c < n; c++) if (G[g][c] > max) max = G[g][c];
    const w = groupW[g] || 1;
    return { color: groupCol[g].map((v) => v / w), max };
  });
  const tLights = now();

  // Codieren (RGBA8): a = [sqrt-Rückprall rgb, Himmelssicht inkl. Streuung], b = [Sonnensicht, Gruppen 0..2 (sqrt)]
  const A = new Uint8Array(n * 4), Bt = new Uint8Array(n * 4), indoor = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    const v = S[c];
    // Rückprall nur, wo der Himmel ihn nicht schon über das Halbkugellicht (Bodenfarbe) liefert
    const k = 1 - V[c];
    A[c * 4] = Math.round(Math.sqrt(clamp01((BR2[c * 3] * k) / B_SCALE)) * 255);
    A[c * 4 + 1] = Math.round(Math.sqrt(clamp01((BR2[c * 3 + 1] * k) / B_SCALE)) * 255);
    A[c * 4 + 2] = Math.round(Math.sqrt(clamp01((BR2[c * 3 + 2] * k) / B_SCALE)) * 255);
    A[c * 4 + 3] = Math.round(clamp01(v) * 255);
    Bt[c * 4] = Math.round(clamp01(SV[c]) * 255);
    for (let g = 0; g < 3; g++) Bt[c * 4 + 1 + g] = groups[g].max > 0 ? Math.round(Math.sqrt(clamp01(G[g][c] / groups[g].max)) * 255) : 0;
    indoor[c] = Math.round((1 - smooth(0.06, 0.5, V[c])) * 255);
  }
  const tEnd = now();
  return {
    dims: [nx, ny, nz], min: [ox - s / 2, oy - s / 2, oz - s / 2], spacing: s,
    a: A, b: Bt, groups,
    acoustic: { indoor, ceil, free, open, absorb, walls },
    stats: {
      cells: n, traced, rays, invalid: n - valid.reduce((a, b) => a + b, 0),
      ms: { total: Math.round(tEnd - t0), columns: Math.round(tCol - t0), sun: Math.round(tSun - tCol), trace: Math.round(tTrace - tSun), scatter: Math.round(tScatter - tTrace), lights: Math.round(tLights - tScatter), encode: Math.round(tEnd - tLights) },
      raster: sun ? [sun.W, sun.H] : null,
    },
  };
}

/** Puffer des Ergebnisses für den Transfer aus dem Worker. */
export function probeTransferables(p) {
  if (!p) return [];
  const a = p.acoustic;
  return [p.a.buffer, p.b.buffer, a.indoor.buffer, a.ceil.buffer, a.free.buffer, a.open.buffer, a.absorb.buffer, a.walls.buffer];
}

function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

/**
 * Laufzeit-Abfragen (Hauptthread) auf den gebackenen Daten: Akustik für audio (`world.acoustics.sample`) und
 * Licht für CPU-Nutzer (Viewmodel-Sonde, Partikel): `light(x, y, z)` → { sky, sun, bounce }.
 */
export function createProbeQuery(p) {
  const [nx, ny, nz] = p.dims, s = p.spacing, inv = 1 / s;
  const mx = p.min[0], my = p.min[1], mz = p.min[2];
  const ac = p.acoustic;
  const decD = (q) => (q === 255 ? Infinity : (q / 254) ** 2 * MAX_D);
  const cell = (x, y, z) => {
    const i = Math.floor((x - mx) * inv), j = Math.floor((y - my) * inv), k = Math.floor((z - mz) * inv);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    return (k * ny + j) * nx + i;
  };
  // trilinear über ein Uint8-Feld (Schrittweite stride, Kanal ch) → 0..1
  const tri = (arr, stride, ch, x, y, z) => {
    let fx = (x - mx) * inv - 0.5, fy = (y - my) * inv - 0.5, fz = (z - mz) * inv - 0.5;
    fx = Math.min(nx - 1, Math.max(0, fx)); fy = Math.min(ny - 1, Math.max(0, fy)); fz = Math.min(nz - 1, Math.max(0, fz));
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), k = Math.min(nz - 2, Math.floor(fz));
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const g = (ii, jj, kk) => arr[((kk * ny + jj) * nx + ii) * stride + ch];
    const c00 = g(i, j, k) * (1 - tx) + g(i + 1, j, k) * tx, c10 = g(i, j + 1, k) * (1 - tx) + g(i + 1, j + 1, k) * tx;
    const c01 = g(i, j, k + 1) * (1 - tx) + g(i + 1, j, k + 1) * tx, c11 = g(i, j + 1, k + 1) * (1 - tx) + g(i + 1, j + 1, k + 1) * tx;
    return ((c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz) / 255;
  };
  const inside = (x, y, z) => x >= mx && y >= my && z >= mz && x <= mx + nx * s && y <= my + ny * s && z <= mz + nz * s;
  const OPEN = Object.freeze({ indoor: 0, ceiling: Infinity, meanFree: MAX_D, openness: 1, absorb: 0 });
  return {
    dims: p.dims, spacing: s, min: p.min,
    /**
     * Akustik am Punkt: { indoor 0..1, ceiling m|Infinity, meanFree m, openness 0..1, walls number[8] (m, 0 = +X,
     * gegen den Uhrzeigersinn um +Y in 45°-Schritten; Infinity = frei), absorb 0..1 }. out wird wiederverwendet.
     */
    sample(x, y, z, out = {}) {
      if (!inside(x, y, z)) {
        Object.assign(out, OPEN);
        out.walls = out.walls || new Array(8);
        out.walls.fill(Infinity);
        return out;
      }
      out.indoor = tri(ac.indoor, 1, 0, x, y, z);
      out.openness = tri(ac.open, 1, 0, x, y, z);
      out.absorb = tri(ac.absorb, 1, 0, x, y, z);
      const f = tri(ac.free, 1, 0, x, y, z);
      out.meanFree = (f * 255 / 254) ** 2 * MAX_D;
      const c = cell(x, y, z);
      out.ceiling = c < 0 ? Infinity : decD(ac.ceil[c]);
      const w = out.walls || (out.walls = new Array(8));
      for (let r = 0; r < 8; r++) w[r] = c < 0 ? Infinity : decD(ac.walls[c * 8 + r]);
      return out;
    },
    /** Licht am Punkt: { sky (Himmelssicht 0..1), sun (Sonnensicht 0..1), bounce (Anteil Sonnenbestrahlung, rgb) }. */
    light(x, y, z, out = {}) {
      if (!inside(x, y, z)) { out.sky = 1; out.sun = 1; out.bounce = out.bounce || [0, 0, 0]; out.bounce[0] = out.bounce[1] = out.bounce[2] = 0; return out; }
      out.sky = tri(p.a, 4, 3, x, y, z);
      out.sun = tri(p.b, 4, 0, x, y, z);
      const b = out.bounce || (out.bounce = [0, 0, 0]);
      for (let ch = 0; ch < 3; ch++) { const e = tri(p.a, 4, ch, x, y, z); b[ch] = e * e * B_SCALE; }
      return out;
    },
  };
}
