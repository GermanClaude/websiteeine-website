// NULLPUNKT — Gelände-Erzeugung für Großkarten (Owner: world). Ohne three-Abhängigkeit, deterministisch je Seed.
//
// generateTerrain(spec) → { hf: Heightfield, roads: [{ id, kind, width, samples: Float32Array (x, y, z je 2 m), bridge }] }
// spec (aus dem Kartenmodul, `terrain`):
//   size (m), res (m), seed, base { amp, scale, octaves, floor }, detail { amp, scale }, hills [{ x, z, r, h }],
//   edge { start, end, height } (Randgebirge), waterY, river { pts, width, depth, bank, fords [{ x, z, r, depth }] },
//   pads [{ x, z, w, d, y, blend, worn }] (eingeebnete Bauflächen), roads [{ id, kind 'asphalt'|'gravel'|'dirt', width,
//   pts, bridge? { a: [x, z], b: [x, z], y } }], fields [{ x, z, w, d, ry, kind 'acker'|'wiese' }], forests [{ x, z, r }]
// Reihenfolge: Grundform → Details → Fluss → Bauflächen → Straßen (planieren) → Felder → Splat/Maske.
import { createSimplex, fbm, ridged, smoothstep, lerp } from './noise.js';
import { Heightfield } from './heightfield.js';

/** Catmull-Rom-Kurve durch pts ([[x, z], …]), Abtastung ~step m. → [[x, z], …] */
export function sampleSpline(pts, step = 2) {
  if (pts.length < 2) return pts.map(p => [p[0], p[1]]);
  const out = [];
  const P = (k) => pts[Math.max(0, Math.min(pts.length - 1, k))];
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.round(L / step));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** Abstandsfeld zu einer Polylinie (nur Zellen bis radius): dist (∞ sonst), along = Abtastindex (k + t, gebrochen). */
function polyField(hf, line, radius, dist, along) {
  const n = hf.n, r = hf.res;
  dist.fill(Infinity);
  let acc = 0;
  for (let k = 0; k < line.length - 1; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1];
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1e-9, L = Math.sqrt(L2);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius - hf.minX) / r)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + radius - hf.minX) / r));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - radius - hf.minZ) / r)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + radius - hf.minZ) / r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = hf.minX + i * r, z = hf.minZ + j * r;
      let t = ((x - ax) * ex + (z - az) * ez) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      const o = j * n + i;
      if (d < dist[o]) { dist[o] = d; along[o] = k + t; }
    }
    acc += L;
  }
  return acc;
}

/**
 * Grundform (ohne Fluss/Bauflächen/Straßen) an beliebiger Stelle – auch außerhalb des Höhenfelds (Kulissenring).
 * → (x, z) => Höhe
 */
export function makeCoarse(spec) {
  const noise = createSimplex(spec.seed || 1), noise2 = createSimplex((spec.seed || 1) * 7 + 3);
  const base = spec.base || {}, edge = spec.edge || null;
  const waterY = spec.waterY ?? -1;
  const amp = base.amp ?? 6, sc = base.scale ?? 200, floor = base.floor ?? waterY + 1.2, off = base.offset ?? 2.5;
  const hills = spec.hills || [];
  return (x, z) => {
    const wx = x + fbm(noise2, x / 310, z / 310, 2) * 40, wz = z + fbm(noise2, x / 310 + 5.2, z / 310 - 3.1, 2) * 40;
    let h = off + amp * fbm(noise, wx / sc, wz / sc, base.octaves ?? 5);
    for (const hl of hills) {
      const d = Math.hypot(x - hl.x, z - hl.z) / hl.r;
      if (d < 1) { const f = 1 - d * d; h += hl.h * f * f * (3 - 2 * f) * 0.5 + hl.h * 0.5 * f * f; }
    }
    if (edge) {
      const e = Math.max(Math.abs(x), Math.abs(z));
      const k = smoothstep(edge.start, edge.end, e + fbm(noise2, x / 90, z / 90, 2) * 18);
      if (k > 0) h += k * edge.height * (0.55 + 0.45 * ridged(noise, x / 160, z / 160, 4) * 1.6) * (1 + Math.max(0, e - edge.end) / 700);
    }
    // weiches Minimum: kein zufälliger See außerhalb des Flusses
    if (h < floor + 1.5) h = floor + 1.5 * smoothstep(-2.5, 1.5, h - floor);
    return h;
  };
}

/**
 * @param {object} spec Kartenbeschreibung `terrain`
 * @param {{ onProgress?: (p:number, label:string)=>void, yieldEvery?: number }} [opts]
 */
export async function generateTerrain(spec, { onProgress } = {}) {
  let slice = performance.now();
  const breathe = async () => { if (performance.now() - slice > 12) { await new Promise(r => setTimeout(r, 0)); slice = performance.now(); } };
  const res = spec.res || 1, size = spec.size || 640;
  const n = Math.round(size / res) + 1;
  const minX = -size / 2, minZ = -size / 2;
  const N = n * n;
  const H = new Float32Array(N);
  const noise = createSimplex(spec.seed || 1), noise2 = createSimplex((spec.seed || 1) * 7 + 3);
  const det = spec.detail || {}, edge = spec.edge || null;
  const waterY = spec.waterY ?? -1;

  // 1) Grundform auf grobem 4-m-Raster (fBm + Hügel + Randgebirge), dann bikubisch auf res hochgerechnet
  const cs = 4, cn = Math.ceil(size / cs) + 3;
  const coarse = new Float32Array(cn * cn);
  const cx0 = minX - cs;
  const coarseAt = makeCoarse(spec);
  for (let j = 0; j < cn; j++) {
    for (let i = 0; i < cn; i++) coarse[j * cn + i] = coarseAt(cx0 + i * cs, cx0 + j * cs);
    await breathe();
  }
  onProgress?.(0.15, 'Gelände: Grundform');
  const cub = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const dAmp = det.amp ?? 0.35, dSc = det.scale ?? 11, dSc2 = dSc * 0.31;
  // erst je Grobzeile in x interpolieren (Zwischenpuffer), dann je Zielzeile in z
  const rowX = new Float32Array(cn * n);
  for (let cj = 0; cj < cn; cj++) {
    const o = cj * cn;
    for (let i = 0; i < n; i++) {
      const fx = (minX + i * res - cx0) / cs, ci = Math.floor(fx), tx = fx - ci;
      const a = Math.max(0, ci - 1), b = Math.min(cn - 1, ci), c = Math.min(cn - 1, ci + 1), d = Math.min(cn - 1, ci + 2);
      rowX[cj * n + i] = cub(coarse[o + a], coarse[o + b], coarse[o + c], coarse[o + d], tx);
    }
  }
  for (let j = 0; j < n; j++) {
    const z = minZ + j * res, fz = (z - cx0) / cs, cj = Math.floor(fz), tz = fz - cj;
    const ra = Math.max(0, cj - 1) * n, rb = Math.min(cn - 1, cj) * n, rc = Math.min(cn - 1, cj + 1) * n, rd = Math.min(cn - 1, cj + 2) * n;
    for (let i = 0; i < n; i++) {
      const x = minX + i * res;
      H[j * n + i] = cub(rowX[ra + i], rowX[rb + i], rowX[rc + i], rowX[rd + i], tz)
        + dAmp * noise2(x / dSc, z / dSc) + dAmp * 0.3 * noise(x / dSc2, z / dSc2);
    }
    if ((j & 15) === 0) await breathe();
  }
  onProgress?.(0.3, 'Gelände: Details');
  const hf = new Heightfield({ n, res, minX, minZ, heights: H, waterY });
  const dist = new Float32Array(N), along = new Float32Array(N);
  const splat = new Uint8Array(N * 4), mask = new Uint8Array(N);
  const wet = new Float32Array(N); // 0..1 Uferschlamm

  // 2) Fluss: Bett unter den Wasserspiegel graben, Ufer weich auslaufen lassen, Furten anheben
  const rv = spec.river;
  let riverLine = null;
  if (rv) {
    riverLine = sampleSpline(rv.pts, 3);
    const hw = rv.width / 2, bank = rv.bank ?? 10;
    polyField(hf, riverLine, hw + bank + 2, dist, along);
    for (let o = 0; o < N; o++) {
      const d = dist[o];
      if (d === Infinity) continue;
      const i = o % n, j = (o / n) | 0, x = minX + i * res, z = minZ + j * res;
      const wob = noise(x / 23, z / 23) * 1.4;
      const dd = Math.max(0, d + wob);
      let bed;
      if (dd < hw) { const q = dd / hw; bed = waterY - (rv.depth ?? 2) * (1 - q * q) - 0.25; }
      else bed = waterY - 0.25 + (dd - hw) * 0.55;
      for (const f of rv.fords || []) {
        const fd = Math.hypot(x - f.x, z - f.z);
        if (fd < f.r * 1.6) bed = lerp(Math.max(bed, waterY - f.depth), bed, smoothstep(f.r, f.r * 1.6, fd));
      }
      const k = 1 - smoothstep(hw, hw + bank, dd);
      if (bed < H[o]) H[o] = lerp(H[o], bed, Math.max(k, dd < hw ? 1 : 0));
      wet[o] = Math.max(wet[o], 1 - smoothstep(hw - 1, hw + bank * 0.6, dd));
    }
  }
  await breathe();
  onProgress?.(0.4, 'Gelände: Fluss');

  // 3) Bauflächen (Rechtecke) auf ihre Höhe einebnen, weich auslaufend
  for (const p of spec.pads || []) {
    const blend = p.blend ?? 14, y = (p.y ?? 0) - 0.04;
    const hwp = p.w / 2, hdp = p.d / 2;
    const i0 = Math.max(0, Math.floor((p.x - hwp - blend - minX) / res)), i1 = Math.min(n - 1, Math.ceil((p.x + hwp + blend - minX) / res));
    const j0 = Math.max(0, Math.floor((p.z - hdp - blend - minZ) / res)), j1 = Math.min(n - 1, Math.ceil((p.z + hdp + blend - minZ) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = minX + i * res, z = minZ + j * res;
      const qx = Math.abs(x - p.x) - hwp, qz = Math.abs(z - p.z) - hdp;
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
      const w = 1 - smoothstep(0, blend, sd + noise(x / 9, z / 9) * 2.5 * smoothstep(0, 3, sd));
      if (w <= 0) continue;
      const o = j * n + i;
      H[o] = lerp(H[o], y, w);
      if (p.worn !== false && sd < 0) splat[o * 4] = Math.max(splat[o * 4], Math.round(255 * Math.max(0, 0.18 + noise2(x / 6, z / 6) * 0.3)));
    }
  }
  await breathe();
  onProgress?.(0.5, 'Gelände: Bauflächen');

  // 4) Straßen: Mittellinie geglättet, Gelände darunter planieren; Spuren in Splat/Maske
  const roadsOut = [];
  for (const rd of spec.roads || []) {
    const line = sampleSpline(rd.pts, 2);
    // Profil: Geländehöhe entlang der Linie gleitend gemittelt (±12 m); Brücke hält ihre Höhe
    const raw = line.map(([x, z]) => hf.heightAt(x, z));
    const prof = raw.map((_, k) => {
      let s = 0, c = 0;
      for (let m = Math.max(0, k - 6); m <= Math.min(raw.length - 1, k + 6); m++) { s += raw[m]; c++; }
      return s / c;
    });
    let bridgeA = -1, bridgeB = -1;
    if (rd.bridge) {
      const near = (p) => { let bi = 0, bd = Infinity; line.forEach(([x, z], k) => { const d = Math.hypot(x - p[0], z - p[1]); if (d < bd) { bd = d; bi = k; } }); return bi; };
      bridgeA = Math.min(near(rd.bridge.a), near(rd.bridge.b)); bridgeB = Math.max(near(rd.bridge.a), near(rd.bridge.b));
      const ramp = 10; // Rampe 20 m je Seite
      for (let k = 0; k < line.length; k++) {
        const y = rd.bridge.y;
        if (k >= bridgeA && k <= bridgeB) prof[k] = y;
        else if (k < bridgeA && k >= bridgeA - ramp) prof[k] = lerp(prof[k], y, smoothstep(bridgeA - ramp, bridgeA, k));
        else if (k > bridgeB && k <= bridgeB + ramp) prof[k] = lerp(prof[k], y, 1 - smoothstep(bridgeB, bridgeB + ramp, k));
      }
    }
    const hw = rd.width / 2, shoulder = rd.shoulder ?? 3;
    polyField(hf, line, hw + shoulder + 1, dist, along);
    const L = line.length;
    for (let o = 0; o < N; o++) {
      const d = dist[o];
      if (d === Infinity) continue;
      const k = Math.min(L - 1, Math.max(0, Math.round(along[o])));
      if (k > bridgeA && k < bridgeB) continue; // unter der Brücke bleibt der Fluss
      const i = o % n, j = (o / n) | 0, x = minX + i * res, z = minZ + j * res;
      const ty = prof[k] - (rd.kind === 'asphalt' ? 0.04 : 0.06);
      const w = 1 - smoothstep(hw, hw + shoulder, d);
      if (w <= 0) continue;
      H[o] = lerp(H[o], ty, w);
      const s4 = o * 4;
      const edgeN = noise(x / 3.1, z / 3.1) * 0.35;
      if (rd.kind === 'asphalt') {
        if (d < hw + 0.2) mask[o] = 1;
        if (d < hw + 1.3 + edgeN) splat[s4 + 1] = Math.max(splat[s4 + 1], 210);
      } else if (rd.kind === 'gravel') {
        if (d < hw + edgeN) splat[s4 + 1] = Math.max(splat[s4 + 1], 235);
        else if (d < hw + 1.2 + edgeN) splat[s4] = Math.max(splat[s4], 140);
      } else {
        // Feldweg: zwei Fahrspuren, Grasstreifen in der Mitte
        const rut = Math.abs(d - hw * 0.55);
        if (d > 0.45 + edgeN * 0.5 && rut < hw * 0.42 + edgeN) splat[s4] = Math.max(splat[s4], 235);
        else if (d < hw + 0.6) splat[s4] = Math.max(splat[s4], 70);
      }
    }
    const samples = new Float32Array(L * 3);
    line.forEach(([x, z], k2) => { samples[k2 * 3] = x; samples[k2 * 3 + 1] = prof[k2]; samples[k2 * 3 + 2] = z; });
    roadsOut.push({ id: rd.id, kind: rd.kind, width: rd.width, samples, bridge: rd.bridge ? [bridgeA, bridgeB] : null, name: rd.name || '' });
    await breathe();
  }
  onProgress?.(0.62, 'Gelände: Wege');

  // 5) Felder: Acker mit Furchen (Höhe ±6 cm, 2,8-m-Raster entlang ry), Wiese bleibt Gras
  for (const f of spec.fields || []) {
    const c = Math.cos(f.ry || 0), s = Math.sin(f.ry || 0), hw = f.w / 2, hd = f.d / 2;
    const ext = Math.hypot(hw, hd) + 2;
    const i0 = Math.max(0, Math.floor((f.x - ext - minX) / res)), i1 = Math.min(n - 1, Math.ceil((f.x + ext - minX) / res));
    const j0 = Math.max(0, Math.floor((f.z - ext - minZ) / res)), j1 = Math.min(n - 1, Math.ceil((f.z + ext - minZ) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = minX + i * res - f.x, z = minZ + j * res - f.z;
      const lx = x * c - z * s, lz = x * s + z * c;
      const ex = Math.max(Math.abs(lx) - hw, Math.abs(lz) - hd);
      if (ex > 1.5) continue;
      const o = j * n + i;
      const w = 1 - smoothstep(-1.5, 1.5, ex + noise(x / 4, z / 4) * 0.8);
      if (f.kind === 'acker') {
        splat[o * 4 + 3] = Math.max(splat[o * 4 + 3], Math.round(255 * w));
        H[o] += 0.06 * Math.sin((lx / 2.8) * Math.PI * 2) * w;
      } else if (f.kind === 'stoppel') {
        splat[o * 4] = Math.max(splat[o * 4], Math.round(110 * w));
      }
    }
  }
  await breathe();

  // 6) Splat: Fels nach Steilheit/Höhe, Erdflecken, Waldboden, Ufer; Summe ≤ 1
  const nrm = [0, 1, 0];
  const forests = spec.forests || [];
  for (let j = 0; j < n; j++) {
    const z = minZ + j * res;
    for (let i = 0; i < n; i++) {
      const x = minX + i * res, o = j * n + i, s4 = o * 4;
      hf.vertexNormal(i, j, nrm);
      const steep = 1 - nrm[1];
      const h = H[o];
      let rock = smoothstep(0.16, 0.34, steep + noise(x / 14, z / 14) * 0.05);
      if (edge) rock = Math.max(rock, smoothstep(edge.height * 0.45, edge.height * 0.9, h + noise2(x / 30, z / 30) * 6) * 0.85);
      let dirt = smoothstep(0.42, 0.75, fbm(noise2, x / 38, z / 38, 3)) * 0.55;
      for (const f of forests) {
        const fd = Math.hypot(x - f.x, z - f.z) / f.r;
        if (fd < 1.1) dirt = Math.max(dirt, (1 - smoothstep(0.6, 1.1, fd)) * (0.35 + 0.3 * noise(x / 5, z / 5)));
      }
      const wv = wet[o];
      let mud = splat[s4 + 3] / 255;
      if (wv > 0 && h < waterY + 1.4) mud = Math.max(mud, wv * smoothstep(waterY + 1.4, waterY + 0.3, h) * 0.9);
      let gravel = splat[s4 + 1] / 255;
      if (h < waterY - 0.3) gravel = Math.max(gravel, 0.45);
      let dr = Math.max(splat[s4] / 255, dirt);
      if (mask[o]) { rock = 0; mud = 0; }
      const sum = dr + gravel + rock + mud;
      const k = sum > 1 ? 1 / sum : 1;
      splat[s4] = Math.round(dr * k * 255); splat[s4 + 1] = Math.round(gravel * k * 255);
      splat[s4 + 2] = Math.round(rock * k * 255); splat[s4 + 3] = Math.round(mud * k * 255);
    }
    if ((j & 31) === 0) await breathe();
  }
  hf.splat = splat; hf.mask = mask;
  hf.buildBlocks();
  hf.riverLine = riverLine;
  onProgress?.(0.75, 'Gelände: Bodenarten');
  return { hf, roads: roadsOut };
}
