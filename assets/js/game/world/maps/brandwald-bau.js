// NULLPUNKT — Bauteile der Karte „Brandwald“ (21.10., eigene Geometrie) (Owner: world):
// Grabenausbau (Sandsackwände aus einzelnen Säcken im Verband – sandbag-field.js –, Bretterwände mit Pfosten,
// Lattenroste, Wurzeln in den Erdwänden), Stromtrasse (Fachwerk-Gittermasten mit Traversen, Isolatoren und
// durchhängenden Leitungen, einzelne Masten umgestürzt), Gewächshausruine (Bogenrippen aus Rohr, Pfetten,
// Windverbände, teils eingeknickt), abgebrannter Holzplatz (Polterholz, Schuppenruine, Sägebock) und Feldposten.
import * as THREE from 'three';
import { sampleSpline } from '../terrain/generate.js';
import { sandbags, crateStack, barrelGroup } from '../props.js';
import { SandbagField } from '../sandbag-field.js';
import { getMaterial } from '../../engine/textures.js';
import { createSimplex } from '../terrain/noise.js';

const Y = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3(), _qq = new THREE.Quaternion(), _ee = new THREE.Euler();
const TAU = Math.PI * 2;
const rngOf = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/** Zylinder von a nach c (beliebige Richtung), Radius r. Ohne Kollision, sofern nicht o.collide. */
function beam(b, ax, ay, az, cx, cy, cz, r, mat, o = {}) {
  _d.set(cx - ax, cy - ay, cz - az);
  const L = _d.length();
  if (L < 1e-3) return;
  _d.multiplyScalar(1 / L);
  _qq.setFromUnitVectors(Y, _d); _ee.setFromQuaternion(_qq, 'YXZ');
  b.cyl(ax, ay, az, r, L, mat, { minimap: false, ...o, rx: _ee.x, ry: _ee.y, rz: _ee.z, collide: o.collide ?? false, seg: o.seg || 5 });
}
/** Vierkantstab (Winkelprofil-Ersatz) von a nach c, Kantenlänge w. */
function bar(b, ax, ay, az, cx, cy, cz, w, mat, o = {}) {
  _d.set(cx - ax, cy - ay, cz - az);
  const L = _d.length();
  if (L < 1e-3) return;
  _d.multiplyScalar(1 / L);
  _qq.setFromUnitVectors(Y, _d); _ee.setFromQuaternion(_qq, 'YXZ');
  b.box(ax, ay, az, w, L, w, mat, { minimap: false, grad: false, ao: false, uv: 'local', ...o, rx: _ee.x, ry: _ee.y, rz: _ee.z, collide: o.collide ?? false });
}

// ---------------------------------------------------------------------------
// Grabenausbau
// ---------------------------------------------------------------------------
const PLANK_TINT = '#4f4337', PLANK_DARK = '#3a3129', ROOT_TINT = '#2e2620', EARTH_TINT = '#7a6a5a', CAP_TINT = '#aaa59e';

/** Abstand Punkt → Polylinie (2D). */
function distToLine(line, x, z) {
  let best = Infinity;
  for (let k = 0; k < line.length - 1; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const ex = ax + dx * t - x, ez = az + dz * t - z, d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Indizierte Geometrie aus Punkt-/UV-/Farblisten. */
function meshOf(P, U, C, I) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  if (C) g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/**
 * Wurzel aus der Grabenwand: Start (x, y, z), Richtung in den Graben (dx, dz), Wandrichtung (ux, uz); 3–4 gekrümmte,
 * verjüngte Abschnitte, hängt durch, dazu 0–2 dünne Seitenwurzeln.
 */
function root(b, r, x, y, z, dx, dz, ux, uz, len, rad, depth = 0, fine = true) {
  const segs = fine ? 3 + (r() < 0.5 ? 1 : 0) : 2, sl = len / segs;
  let px = x, py = y, pz = z, ax = dx * 0.75, ay = -0.15 - r() * 0.35, az = dz * 0.75;
  let side = (r() - 0.5) * 0.9;
  for (let k = 0; k < segs; k++) {
    // Richtung driftet: seitlich, zunehmend nach unten (Schwerkraft), etwas zur Wand zurück
    side += (r() - 0.5) * 0.7;
    const vx = ax + ux * side, vz = az + uz * side, vy = ay - k * 0.22;
    const vl = Math.hypot(vx, vy, vz) || 1;
    const qx = px + (vx / vl) * sl, qy = py + (vy / vl) * sl, qz = pz + (vz / vl) * sl;
    const r0 = rad * (1 - k / (segs + 0.5)), r1 = rad * (1 - (k + 1) / (segs + 0.5));
    b.cyl(px, py, pz, Math.max(0.003, r0), sl, 'wood_dark', { ...dirTo(px, py, pz, qx, qy, qz), r1: Math.max(0.002, r1), tint: ROOT_TINT, collide: false, minimap: false, seg: 3, caps: false, ao: false, bullet: false });
    if (fine && !depth && k < segs - 1 && r() < 0.35) root(b, r, qx, qy, qz, dx * 0.4 + ux * (r() - 0.5), dz * 0.4 + uz * (r() - 0.5), ux, uz, sl * (0.6 + r() * 0.6), Math.max(0.003, r1 * 0.5), 1, fine);
    px = qx; py = qy; pz = qz;
    ax *= 0.8; az *= 0.8;
  }
}
/** Drehung (rx, ry, rz in 'YXZ') für einen Zylinder von p nach q. */
function dirTo(ax, ay, az, cx, cy, cz) {
  _d.set(cx - ax, cy - ay, cz - az).normalize();
  _qq.setFromUnitVectors(Y, _d); _ee.setFromQuaternion(_qq, 'YXZ');
  return { rx: _ee.x, ry: _ee.y, rz: _ee.z };
}

/**
 * Gräben ausbauen (lateSite; braucht ctx.hf). Das Gelände ist um tr.revet breiter ausgehoben; hier entstehen die
 * eigentlichen, fast senkrechten Grabenwände: je Seite ein Wandband entlang der Geländekurve (Erdwand aus Grabenlehm,
 * verrauscht, unten nass) mit Bodenkappe bis über den Aushub (Brandboden, kleiner Erdwall), Kollision als glatte
 * Fläche (auf allen Stufen gleich – Mehrspieler). Davor je ≈ 3-m-Abschnitt Sandsäcke (Anteil tr.sandbags, eher auf der
 * Feindseite), Bretterwand mit Pfosten oder rohe Erde mit Wurzeln; Lattenroste auf der Sohle. An Kreuzungen mit
 * anderen Gräben bleibt die Wand offen. → { clearLines }
 */
export function trenchWorks(b, ctx, trenches, o = {}) {
  const hf = ctx.hf, q = ctx.quality || 'high', low = q === 'low';
  const H = (x, z) => hf.heightAt(x, z);
  const noise = createSimplex(2113);
  const field = new SandbagField({ quality: q, shadow: q === 'high' || q === 'ultra' });
  const clearLines = [];
  const lines = trenches.map((tr) => {
    const line = sampleSpline(tr.pts, 1.5), xs = line.map((p) => p[0]), zs = line.map((p) => p[1]);
    return { tr, line, hw: (tr.width ?? 2) / 2, rv: tr.revet || 0, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  });
  // liegt (x, z) in einem anderen Graben? (Kreuzung/Einmündung: dort keine Wand)
  const inOther = (self, x, z, pad) => lines.some((L) => L !== self && x > L.minX - L.hw - pad && x < L.maxX + L.hw + pad && z > L.minZ - L.hw - pad && z < L.maxZ + L.hw + pad && distToLine(L.line, x, z) < L.hw + pad);
  const rows = low ? 3 : q === 'medium' ? 5 : 7;
  const earthM = 'grabenlehm', capM = 'brandboden';
  let seed = 1;
  for (const Lr of lines) {
    const { tr, line, hw, rv } = Lr;
    const N = line.length;
    clearLines.push({ pts: line, r: hw + rv + 2.4 });
    const r = rngOf((tr.id || 'x').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    // eigener Zufall für alles mit Kollision (Kisten): gleiche Folge auf jeder Qualitätsstufe (Mehrspieler)
    const rc = rngOf((tr.id || 'x').split('').reduce((a, c) => a * 37 + c.charCodeAt(0), 11));
    // Zufall für stufenabhängige Kleinteile (Wurzeln, Latten) – so bleibt die Folge von r (Aufbau) überall gleich
    const rx = rngOf((tr.id || 'x').split('').reduce((a, c) => a * 41 + c.charCodeAt(0), 13));
    const enemySide = Math.sign(tr.pts[0][1]) > 0 ? -1 : 1; // Feind liegt in Richtung Kartenmitte (−z für Süd)
    const tang = line.map((p, i) => {
      const a = line[Math.max(0, i - 1)], c = line[Math.min(N - 1, i + 1)], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    });
    const back = hw + rv + 1.75;                       // Kappe reicht bis hinter den Aushubrand
    // Ausstiegsrampen: dort ist der Graben aufgefüllt – beidseits keine Wand (offener Durchgang)
    const nearRamp = (x, z, r) => (tr.ramps || []).some(([rx, rz]) => Math.hypot(x - rx, z - rz) < r);
    const capD = [0.1, 0.45, rv * 0.6 + 0.4, rv + 0.9, rv + 1.35, rv + 1.75]; // Kappenpunkte (Abstand ab Wandfront)
    for (const side of [1, -1]) {
      // Querschnitte
      const S = line.map(([x, z], i) => {
        const [ux, uz] = tang[i], nx = -uz * side, nz = ux * side; // nach außen
        const floor = H(x, z);
        const topF = H(x + nx * (hw + rv + 2.5), z + nz * (hw + rv + 2.5)) + 0.04; // ursprüngliche Oberfläche hinter dem Wall
        const cap = capD.map((d, k) => {
          const px = x + nx * (hw + d), pz = z + nz * (hw + d);
          const mound = [0.02, 0.1, 0.14, 0.1, 0.04, -0.05][k];
          const y = k === capD.length - 1 ? H(px, pz) - 0.05 : Math.max(topF + mound, H(px, pz) + 0.05);
          return [px, y, pz];
        });
        const fx = x + nx * hw, fz = z + nz * hw;
        const skip = inOther(Lr, fx, fz, 0.3) || inOther(Lr, x + nx * (hw + rv * 0.7), z + nz * (hw + rv * 0.7), 0.1) || nearRamp(x, z, 3.1);
        return { x, z, nx, nz, hw, ux: tang[i][0], uz: tang[i][1], floor, top: cap[0][1], cap, skip, h: cap[0][1] - floor };
      });
      // Läufe (zusammenhängend, Wand höher als 0,3 m, nicht in anderem Graben), in Stücke ≤ 12 Querschnitte
      const runs = [];
      let cur = null;
      for (let i = 0; i < N; i++) {
        const ok = !S[i].skip && S[i].h > 0.3;
        if (ok) { if (!cur) runs.push(cur = [i, i]); else cur[1] = i; } else cur = null;
      }
      for (const [r0, r1] of runs) {
        if (r1 - r0 < 1) continue;
        for (let p0 = r0; p0 < r1; p0 += 12) {
          const p1 = Math.min(r1, p0 + 12);
          emitWall(S.slice(p0, p1 + 1), p0 === r0, p1 === r1);
        }
      }
    }
    // Ausbau je ≈ 3-m-Abschnitt
    for (let k = 0; k + 2 < N; k += 2) {
      const [ax, az] = line[k], [bx, bz] = line[k + 2];
      const L = Math.hypot(bx - ax, bz - az);
      const cr = [rc(), rc(), rc(), rc(), rc(), rc(), rc()]; // Kisten/Brustwehr: immer sieben Ziehungen je Abschnitt
      if (L < 0.5) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, ry0 = Math.atan2(-uz, ux);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const floor = H(mx, mz);
      const mode = r(), bagsHere = mode < (tr.sandbags ?? 0.3), planksHere = !bagsHere && mode < (tr.sandbags ?? 0.3) + 0.22;
      for (const side of [1, -1]) {
        const fx = mx + nx * side * hw, fz = mz + nz * side * hw;
        if (inOther(Lr, fx, fz, 0.6) || nearRamp(mx, mz, 3.6)) continue;
        const edge = H(mx + nx * side * (hw + rv + 2.5), mz + nz * side * (hw + rv + 2.5)) + 0.1, wallH = edge - floor;
        if (wallH < 0.8) continue; // Rampe
        const faceEnemy = Math.sign(nz * side) === enemySide;
        const wx = mx + nx * side * (hw - 0.04), wz = mz + nz * side * (hw - 0.04);
        const ry = side > 0 ? ry0 + Math.PI : ry0; // lokal +z zeigt in den Graben
        if (bagsHere && (faceEnemy || r() < 0.55)) {
          // vor der Erdwand (gleiche Rückneigung 0,07 m/m), Säcke stecken hinten in der Erde
          const bx2 = mx + nx * side * (hw - 0.12), bz2 = mz + nz * side * (hw - 0.12);
          field.addWall(bx2, floor - 0.04, bz2, ry, L + 0.2, wallH + 0.1, { seed: seed++, wet: 0.45 + r() * 0.3, tone: 0.9 + r() * 0.2, lean: 0.07 });
        } else if (planksHere) {
          // Bretterwand: liegende Bohlen (leicht verzogen, einzelne fehlen/gebrochen), zwei Pfosten
          const n = Math.max(3, Math.round(wallH / 0.22));
          for (let i = 0; i < n; i++) {
            if (i > 1 && r() < 0.07) continue;
            const y = floor + i * (wallH / n), th = 0.03 + r() * 0.02;
            const off = side * (0.03 + r() * 0.03);
            b.box(wx - nx * off, y, wz - nz * off, L + 0.1 - r() * 0.3, wallH / n - 0.02, th, 'wood_dark', { ry: ry0 + (r() - 0.5) * 0.04, rx: (r() - 0.5) * 0.04, tint: r() < 0.5 ? PLANK_TINT : PLANK_DARK, collide: false, minimap: false, uv: 'local', grad: false });
          }
          for (const s2 of [-0.45, 0.45]) b.cyl(wx + ux * L * s2 - nx * side * 0.08, floor - 0.2, wz + uz * L * s2 - nz * side * 0.08, 0.065, wallH + 0.3, 'wood_dark', { tint: PLANK_DARK, collide: false, minimap: false, seg: 6 });
        } else if (!low) {
          // rohe Erdwand: Wurzeln ragen heraus (gekrümmt, verjüngt, hängend, mit Seitenwurzeln) – meist im oberen Teil
          const nRoots = 1 + Math.floor(rx() * 3);
          for (let i = 0; i < nRoots; i++) {
            const t = (rx() - 0.5) * L * 0.9, y = floor + wallH * (0.45 + Math.sqrt(rx()) * 0.5);
            const px = mx + ux * t + nx * side * (hw + 0.05), pz = mz + uz * t + nz * side * (hw + 0.05);
            root(b, rx, px, y, pz, -nx * side, -nz * side, ux, uz, 0.25 + rx() * 0.7, 0.006 + rx() * 0.02, 0, q === 'high' || q === 'ultra');
          }
        }
      }
      // Brustwehr aus Sandsäcken auf der Feindseite der Frontgräben (≈ 55 %): drei Lagen auf der Kante, Vorder- und
      // Rückseite als zwei Säckreihen, Kollision als Quader (Deckung; gleiche Ziehung auf jeder Stufe)
      if ((tr.sandbags ?? 0) >= 0.4 && cr[5] < 0.55 && !inOther(Lr, mx, mz, 1.2) && !nearRamp(mx, mz, 4.2)) {
        const es = enemySide * Math.sign(nz || 1) || 1;
        const top = H(mx + nx * es * (hw + rv + 2.5), mz + nz * es * (hw + rv + 2.5)) + 0.08;
        if (top - floor > 1.2) {
          const ph = 0.38 + cr[6] * 0.12, d0 = hw + 0.32;
          const px = mx + nx * es * d0, pz = mz + nz * es * d0;
          const ryIn = es > 0 ? ry0 + Math.PI : ry0;           // lokal +z zeigt in den Graben
          field.addWall(px, top - 0.03, pz, ryIn, L + 0.15, ph, { seed: seed++, wet: 0, tone: 0.95 + r() * 0.15, lean: 0.05 });
          field.addWall(px + nx * es * 0.3, top - 0.03, pz + nz * es * 0.3, ryIn + Math.PI, L + 0.15, ph - 0.1, { seed: seed++, wet: 0, tone: 0.9 + r() * 0.15, lean: 0.12 });
          b.solid(px + nx * es * 0.15, top - 0.05, pz + nz * es * 0.15, L, ph + 0.02, 0.62, { ry: ry0, minimap: false });
        }
      }
      // Pfützen auf der Sohle (Schlammwasser), Sturmleitern an der Feindseite der Frontgräben, Munitionskisten
      const junction = inOther(Lr, mx, mz, 0.4);
      if (!junction && r() < 0.3) b.decal(mx + ux * (r() - 0.5) * L * 0.6, floor + 0.035, mz + uz * (r() - 0.5) * L * 0.6, 0.9 + r() * 1.4, 0.6 + r() * 0.5, 'puddle', { opacity: 0.9, ry: ry0 + (r() - 0.5) * 0.3 });
      if (!junction && (tr.sandbags ?? 0) >= 0.4 && k % 14 === 6) {
        const es = enemySide * Math.sign(nz || 1) || 1;   // Seite (±1), deren Normale zum Feind zeigt
        const wl = hw - 0.02, hgt = (H(mx + nx * es * (hw + rv + 2.5), mz + nz * es * (hw + rv + 2.5)) - floor) + 0.5, tilt = 0.32;
        const fx0 = mx + nx * es * (wl - hgt * Math.sin(tilt)), fz0 = mz + nz * es * (wl - hgt * Math.sin(tilt));
        for (const s2 of [-0.24, 0.24]) beam(b, fx0 + ux * s2, floor, fz0 + uz * s2, mx + nx * es * wl + ux * s2, floor + hgt * Math.cos(tilt), mz + nz * es * wl + uz * s2, 0.035, 'wood_dark', { tint: PLANK_TINT, seg: 5 });
        for (let y = 0.3; y < hgt * Math.cos(tilt) - 0.1; y += 0.32) {
          const f = y / (hgt * Math.cos(tilt)), lx = fx0 + (mx + nx * es * wl - fx0) * f, lz = fz0 + (mz + nz * es * wl - fz0) * f;
          beam(b, lx - ux * 0.27, floor + y, lz - uz * 0.27, lx + ux * 0.27, floor + y, lz + uz * 0.27, 0.02, 'wood_dark', { tint: PLANK_DARK, seg: 4 });
        }
      }
      if (!junction && cr[0] < 0.08) {
        const s2 = cr[1] < 0.5 ? 1 : -1;
        b.box(mx + nx * s2 * (hw - 0.3), floor, mz + nz * s2 * (hw - 0.3), 0.55, 0.32, 0.36, 'wood_crate', { ry: ry0 + (cr[2] - 0.5) * 0.4, tint: '#6d6450', minimap: false });
        if (cr[3] < 0.5) b.box(mx + nx * s2 * (hw - 0.3), floor + 0.32, mz + nz * s2 * (hw - 0.3), 0.5, 0.28, 0.32, 'wood_crate', { ry: ry0 + (cr[4] - 0.5) * 0.6, tint: '#5e5644', minimap: false, collide: false });
      }
      // Lattenrost auf der Sohle (≈ 40 %): zwei Längshölzer + Querlatten
      if (r() < 0.4 && !junction) {
        const yb = floor + 0.02;
        for (const s2 of [-0.32, 0.32]) b.box(mx + nx * s2, yb, mz + nz * s2, L, 0.07, 0.08, 'wood_dark', { ry: ry0, tint: PLANK_DARK, collide: false, minimap: false, uv: 'local', grad: false });
        // Handy: Belag als eine Bohlenplatte statt einzelner Latten
        if (low) { b.box(mx, yb + 0.07, mz, L, 0.025, 0.86, 'wood_planks', { ry: ry0, tint: PLANK_TINT, collide: false, minimap: false, uv: 'local', grad: false }); continue; }
        const ns = Math.floor(L / 0.24);
        for (let i = 0; i < ns; i++) {
          if (rx() < 0.06) continue; // einzelne Latte fehlt
          const t = -L / 2 + (i + 0.5) * (L / ns);
          b.box(mx + ux * t, yb + 0.07, mz + uz * t, 0.11, 0.025, 0.85 + rx() * 0.08, 'wood_planks', { ry: ry0 + (rx() - 0.5) * 0.06, tint: rx() < 0.5 ? PLANK_TINT : PLANK_DARK, collide: false, minimap: false, uv: 'local', grad: false });
        }
      }
    }
  }

  /** Wandband + Kappe + Kollision für eine Folge von Querschnitten (Weltkoordinaten relativ zur Stückmitte). */
  function emitWall(Q, openStart, openEnd) {
    const cx = Q.reduce((a, s) => a + s.x, 0) / Q.length, cz = Q.reduce((a, s) => a + s.z, 0) / Q.length, cy = Q[0].floor;
    const n = Q.length, hw = Q[0].hw;
    // Bogenlänge entlang der Wand (UV)
    const arc = [0];
    for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(Q[i].x - Q[i - 1].x, Q[i].z - Q[i - 1].z));
    // Front (Erde): rows Teilungen von der Sohle bis zur Kante, leicht zurückgeneigt, verrauscht
    {
      const P = [], U = [], C = [], I = [];
      for (let i = 0; i < n; i++) {
        const s = Q[i], y0 = s.floor - 0.15, y1 = s.top;
        for (let k = 0; k <= rows; k++) {
          const t = k / rows, y = y0 + (y1 - y0) * t, hy = y - s.floor;
          const nn = noise(arc[i] * 0.9 + s.x * 0.01, y * 1.3) * 0.6 + noise(arc[i] * 2.7, y * 3.1 + 5) * 0.4;
          // Rundung an der Oberkante (Erde bricht ab), Fuß etwas vorgewölbt (abgerutschte Erde)
          const d = hw + Math.max(0, hy) * 0.07 + nn * (low ? 0.03 : 0.06) + (t > 0.85 ? (t - 0.85) * 0.6 : 0) - (t < 0.12 ? (0.12 - t) * 0.9 : 0);
          P.push(s.x + s.nx * d - cx, y - cy, s.z + s.nz * d - cz);
          U.push(arc[i], y);
          const wet = smooth01((0.9 - hy) / 0.9);
          const c = (0.82 + nn * 0.12) * (1 - wet * 0.38);
          C.push(c, c * 0.97, c * 0.93);
        }
      }
      const R = rows + 1;
      for (let i = 0; i < n - 1; i++) for (let k = 0; k < rows; k++) {
        const a = i * R + k, b2 = (i + 1) * R + k;
        // Außennormale zeigt in den Graben (−n); Wicklung je nach Seite
        I.push(a, a + 1, b2, b2, a + 1, b2 + 1);
      }
      fixWinding(P, I, Q[0], cx, cz, true);
      b.geom(meshOf(P, U, C, I), cx, cy, cz, earthM, { tint: EARTH_TINT, collide: false, minimap: false, uv: 'keep', grad: false, ao: false });
    }
    // Kappe (Brandboden) von der Kante bis hinter den Aushub
    {
      const P = [], U = [], I = [];
      const m = Q[0].cap.length;
      for (let i = 0; i < n; i++) for (let k = 0; k < m; k++) {
        const [px, py, pz] = Q[i].cap[k];
        const nn = low ? 0 : noise(px * 0.8, pz * 0.8) * 0.025;
        P.push(px - cx, py + nn - cy, pz - cz);
        U.push(px, pz);
      }
      for (let i = 0; i < n - 1; i++) for (let k = 0; k < m - 1; k++) {
        const a = i * m + k, b2 = (i + 1) * m + k;
        I.push(a, a + 1, b2, b2, a + 1, b2 + 1);
      }
      fixWinding(P, I, Q[0], cx, cz, false);
      b.geom(meshOf(P, U, null, I), cx, cy, cz, capM, { tint: CAP_TINT, collide: false, minimap: false, uv: 'keep', grad: false, ao: false });
    }
    // Stirnflächen an offenen Enden (Kreuzung/Rampe): Querschnitt schließen, damit kein Hohlraum sichtbar ist
    for (const [s, open] of [[Q[0], openStart], [Q[n - 1], openEnd]]) {
      if (!open) continue;
      const P = [], U = [], I = [];
      const pts = [[s.x + s.nx * hw, s.floor - 0.15, s.z + s.nz * hw], [s.x + s.nx * hw, s.top, s.z + s.nz * hw], ...s.cap.slice(1), [s.cap[s.cap.length - 1][0], s.floor - 0.15, s.cap[s.cap.length - 1][2]]];
      for (const [px, py, pz] of pts) { P.push(px - cx, py - cy, pz - cz); U.push(Math.hypot(px - s.x, pz - s.z), py); }
      for (let k = 1; k < pts.length - 1; k++) I.push(0, k, k + 1);
      const g = meshOf(P, U, null, I);
      const g2 = meshOf(P, U, null, I.slice().reverse()); // beidseitig: zweite, umgekehrte Lage
      b.geom(g, cx, cy, cz, earthM, { tint: EARTH_TINT, collide: false, minimap: false, uv: 'keep', grad: false, ao: false });
      b.geom(g2, cx, cy, cz, earthM, { tint: EARTH_TINT, collide: false, minimap: false, uv: 'keep', grad: false, ao: false });
      // Kollision der Stirnfläche (sonst ließe sich unter die Kappe laufen); Punkte ohne Rauschen = auf allen Stufen gleich
      const gc = new THREE.BufferGeometry();
      gc.setAttribute('position', new THREE.Float32BufferAttribute(P.slice(), 3));
      gc.setIndex(I.slice());
      b.geom(gc, cx, cy, cz, earthM, { visual: false, collide: 'mesh', minimap: false });
    }
    // Kollision: glatte Front + Kappe (unabhängig von der Qualitätsstufe)
    {
      const P = [], I = [];
      const m = Q[0].cap.length + 2;
      for (const s of Q) {
        P.push(s.x + s.nx * hw - cx, s.floor - 0.4 - cy, s.z + s.nz * hw - cz);
        P.push(s.x + s.nx * (hw + 0.05) - cx, s.top - cy, s.z + s.nz * (hw + 0.05) - cz);
        for (const [px, py, pz] of s.cap) P.push(px - cx, py - cy, pz - cz);
      }
      for (let i = 0; i < n - 1; i++) for (let k = 0; k < m - 1; k++) {
        const a = i * m + k, b2 = (i + 1) * m + k;
        I.push(a, a + 1, b2, b2, a + 1, b2 + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setIndex(I);
      b.geom(g, cx, cy, cz, earthM, { visual: false, collide: 'mesh', minimap: false });
    }
  }

  /** Dreiecke so drehen, dass die Front in den Graben (−n) bzw. die Kappe nach oben zeigt. */
  function fixWinding(P, I, s, cx, cz, front) {
    const ax = P[I[1] * 3] - P[I[0] * 3], ay = P[I[1] * 3 + 1] - P[I[0] * 3 + 1], az = P[I[1] * 3 + 2] - P[I[0] * 3 + 2];
    const bx = P[I[2] * 3] - P[I[0] * 3], by = P[I[2] * 3 + 1] - P[I[0] * 3 + 1], bz = P[I[2] * 3 + 2] - P[I[0] * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const ok = front ? nx * -s.nx + nz * -s.nz > 0 : ny > 0;
    if (!ok) for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
  }

  if (field.bags.length) b.object(field.build(getMaterial), { update: (dt, cam) => cam && field.update(cam) });
  return { clearLines };
}

const smooth01 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// Gelände-Ausstattung: Pfützen in Senken, Stacheldraht vor den Fronten
// ---------------------------------------------------------------------------
/**
 * Pfützen in Trichtern und Senken: Raster 4 m, tiefster Punkt je Zelle; liegt er deutlich unter seinem Umkreis,
 * kommt ein waagrechtes Nass-Decal knapp darüber (die Mulde „füllt“ sich bis zu dieser Höhe). Dazu Stacheldraht-
 * gürtel (Pfähle, drei Drähte, Kreuzverspannung; nur Optik) vor beiden Frontlinien mit Lücken.
 * o: { area {minX,maxX,minZ,maxZ}, avoid [[pts…], r] (Gräben), wire [{ z, x0, x1 }] }
 */
export function groundDetails(b, ctx, o = {}) {
  const hf = ctx.hf, A = o.area, H = (x, z) => hf.heightAt(x, z);
  let sd = 9137;
  const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lines = (o.avoid || []).map(([pts, r]) => ({ line: sampleSpline(pts, 2), r }));
  const nearTrench = (x, z) => lines.some(({ line, r }) => distToLine(line, x, z) < r);
  let n = 0;
  for (let z = A.minZ; z < A.maxZ; z += 4) for (let x = A.minX; x < A.maxX; x += 4) {
    let mx = x, mz = z, my = Infinity;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const px = x + i * 2, pz = z + j * 2, y = H(px, pz); if (y < my) { my = y; mx = px; mz = pz; } }
    if (my <= hf.waterY + 0.05 || nearTrench(mx, mz)) continue;
    let ring = 0;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; ring += H(mx + Math.cos(a) * 2.6, mz + Math.sin(a) * 2.6); }
    const depth = ring / 8 - my;
    if (depth < 0.22 || rnd() > 0.75) continue;
    const lvl = Math.min(0.16, depth * 0.3), rr = Math.min(3.2, 1.2 + depth * 1.6);
    b.decal(mx, my + lvl, mz, rr * (1.6 + rnd() * 0.5), rr * (1.3 + rnd() * 0.4), 'puddle', { opacity: 0.92, ry: rnd() * TAU });
    if (++n > 160) break;
  }
  // Fahrzeugwracks
  (o.wrecks || []).forEach(([x, z, ry, kind], i) => burntWreck(b, x, H(x, z) - 0.05, z, ry, kind, i + 1));
  // Stacheldraht
  for (const wv of o.wire || []) {
    for (let x = wv.x0; x < wv.x1; x += 3) {
      if (((x - wv.x0) % 55) > 46) continue; // Gassen
      const zz = wv.z + Math.sin(x * 0.29) * 1.4 + Math.sin(x * 0.07) * 2, y0 = H(x, zz), x2 = x + 3, zz2 = wv.z + Math.sin(x2 * 0.29) * 1.4 + Math.sin(x2 * 0.07) * 2, y1 = H(x2, zz2);
      if (nearTrench(x, zz)) continue;
      const lean = (rnd() - 0.5) * 0.25;
      b.cyl(x, y0 - 0.15, zz, 0.035, 1.35, 'wood_dark', { tint: '#2f2a25', collide: false, minimap: false, seg: 5, rz: lean, bullet: false });
      const sag = rnd() < 0.15 ? 0.4 : 0, lowQ = ctx.quality === 'low';
      for (const hy of lowQ ? [0.4, 1.0] : [0.32, 0.72, 1.12]) beam(b, x, y0 + hy, zz, x2, y1 + hy - sag, zz2, 0.005, 'metal_rust', { tint: '#3a332d', seg: 3, cast: false, ao: false, bullet: false, caps: false });
      if (!lowQ) {
        beam(b, x, y0 + 1.1, zz, x2, y1 + 0.3, zz2, 0.005, 'metal_rust', { tint: '#3a332d', seg: 3, cast: false, ao: false, bullet: false, caps: false });
        beam(b, x, y0 + 0.3, zz, x2, y1 + 1.1, zz2, 0.005, 'metal_rust', { tint: '#3a332d', seg: 3, cast: false, ao: false, bullet: false, caps: false });
      }
    }
  }
  return { clearLines: [] };
}

// ---------------------------------------------------------------------------
// Stromtrasse
// ---------------------------------------------------------------------------
/**
 * Fachwerkmast an (x, y, z), Drehung ry (Traversen quer zur Trasse), Höhe h; fallen: umgestürzt (Winkel um die lokale
 * x-Achse). Beine mit Kollision (Kugeln treffen nur die Eckstiele), Streben nur Optik.
 * → Spitzen der Leiterseile (Weltkoordinaten) für die Seile zum Nachbarmast.
 */
function pylon(b, x, y, z, ry, h = 30, fallen = 0, mat = 'metal_galvanized', tint = '#8c8e8b') {
  const base = 3.4, top = 0.8, waist = h * 0.66;
  const c = Math.cos(ry), s = Math.sin(ry);
  // lokale → Welt (umgestürzt: um lokale x-Achse kippen, Drehpunkt am Fuß)
  const cf = Math.cos(fallen), sf = Math.sin(fallen);
  const W = (lx, ly, lz) => {
    const yy = ly * cf - lz * sf, zz = ly * sf + lz * cf;
    return [x + lx * c + zz * s, y + yy, z - lx * s + zz * c];
  };
  const half = (ly) => (ly < waist ? base + (top - base) * (ly / waist) : top);
  const corner = (ly, sx, sz) => W(sx * half(ly), ly, sz * half(ly));
  const levels = [0, 3.5, 7, 10.2, 13.2, 16, 18.5, waist, waist + 2.4, h - 2.2, h];
  const legW = 0.16, brW = 0.07;
  const B = (p, q, w, o) => bar(b, p[0], p[1], p[2], q[0], q[1], q[2], w, mat, { tint, ...o });
  // Eckstiele (Kollision nur aufrecht und nur unten – darüber ist der Mast für Spieler unerreichbar)
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (let k = 0; k < levels.length - 1; k++) B(corner(levels[k], sx, sz), corner(levels[k + 1], sx, sz), legW, { collide: !fallen && k < 3, bullet: true });
  }
  // Riegel und Kreuzverbände je Seite
  const faces = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
  for (let k = 0; k < levels.length - 1; k++) {
    const y0 = levels[k], y1 = levels[k + 1];
    for (const [[ax, az], [bx, bz]] of faces) {
      B(corner(y1, ax, az), corner(y1, bx, bz), brW, { bullet: false });
      B(corner(y0, ax, az), corner(y1, bx, bz), brW * 0.8, { bullet: false });
      B(corner(y0, bx, bz), corner(y1, ax, az), brW * 0.8, { bullet: false });
    }
  }
  // Traversen (zwei Ebenen) + Isolatorketten; Seilaufhängepunkte zurückgeben
  const tips = [];
  for (const [ly, span] of [[waist + 1.2, 6.2], [h - 1.2, 4.6]]) {
    for (const sx of [-1, 1]) {
      const root = W(sx * top, ly, 0), end = W(sx * span, ly, 0), rootU = W(sx * top, ly + 1.4, 0);
      for (const sz of [-1, 1]) {
        B(W(sx * top, ly, sz * top), W(sx * span, ly, 0), brW, { bullet: false });
        B(W(sx * top, ly + 1.4, sz * top * 0.6), W(sx * span, ly, 0), brW * 0.8, { bullet: false });
      }
      B(root, end, brW * 0.9, { bullet: false });
      B(rootU, end, brW * 0.7, { bullet: false });
      // Isolatorkette (hängend) + Seilklemme
      const ins = W(sx * (span - 0.25), ly - 0.15, 0), insE = W(sx * (span - 0.25), ly - 1.6, 0);
      if (!fallen) {
        beam(b, insE[0], insE[1], insE[2], ins[0], ins[1], ins[2], 0.09, 'polymer', { tint: '#3c3f3e', seg: 7 });
        for (let i = 0; i < 6; i++) { const t = 0.12 + i * 0.15; b.cyl(ins[0] + (insE[0] - ins[0]) * t, ins[1] + (insE[1] - ins[1]) * t - 0.02, ins[2] + (insE[2] - ins[2]) * t, 0.16, 0.04, 'polymer', { tint: '#4a4d4b', collide: false, minimap: false, seg: 8 }); }
      }
      tips.push(insE);
    }
  }
  // Mastspitze (Erdseil)
  tips.push(W(0, h + 0.4, 0));
  B(W(0, h - 1, 0), W(0, h + 0.4, 0), brW, { bullet: false });
  // Fundamente (Betonsockel)
  if (!fallen) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + (sx * base * c + sz * base * s), y - 0.4, z + (-sx * base * s + sz * base * c), 0.8, 0.65, 0.8, 'concrete', { ry, tint: '#8a8780', minimap: false });
  return tips;
}

/** Durchhängendes Seil zwischen zwei Punkten (Kettenlinien-Näherung, n Abschnitte). */
function wire(b, p, q, sag, n = 10) {
  let prev = p;
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = p[0] + (q[0] - p[0]) * t, z = p[2] + (q[2] - p[2]) * t, y = p[1] + (q[1] - p[1]) * t - sag * 4 * t * (1 - t);
    beam(b, prev[0], prev[1], prev[2], x, y, z, 0.014, 'metal_rust', { tint: '#2d2b29', seg: 3, cast: false, ao: false });
    prev = [x, y, z];
  }
}

/** Stromtrasse entlang `line` (Masten an den Punkten innerhalb der Grenzen; o.fallen = Index eines umgestürzten Masts). */
export function pylonLine(b, ctx, line, o = {}) {
  const hf = ctx.hf;
  const clearLines = [{ pts: line, r: 7 }];
  let prevTips = null, prevFallen = false;
  line.forEach(([x, z], i) => {
    if (!hf.contains(x, z)) { prevTips = null; return; }
    const nx = line[Math.min(line.length - 1, i + 1)], pv = line[Math.max(0, i - 1)];
    const ry = Math.atan2(-(nx[1] - pv[1]), nx[0] - pv[0]) + Math.PI / 2; // Traversen quer zur Trasse
    const fallen = i === o.fallen ? 1.38 : 0;
    const y = hf.heightAt(x, z) - 0.05;
    const tips = pylon(b, x, y, z, ry, 30, fallen);
    if (fallen) {
      // umgestürzter Mast: Kollision als liegender Körper (grob), abgerissene Seile am Boden
      const c = Math.cos(ry), s = Math.sin(ry);
      for (let k = 2; k < 26; k += 4) {
        const yy = hf.heightAt(x + k * s, z + k * c);
        b.solid(x + k * s, yy, z + k * c, 2.4, 1.6, 4, { ry, minimap: 'cover' });
      }
    }
    if (prevTips && !fallen && !prevFallen) for (let k = 0; k < tips.length; k++) wire(b, prevTips[k], tips[k], 3.2);
    else if (prevTips && fallen) for (let k = 0; k < prevTips.length; k++) { const p = prevTips[k]; wire(b, p, [p[0] + (x - p[0]) * 0.55, hf.heightAt(p[0] + (x - p[0]) * 0.55, p[2] + (z - p[2]) * 0.55) + 0.05, p[2] + (z - p[2]) * 0.55], 1.2, 8); }
    prevTips = tips; prevFallen = !!fallen;
  });
  return { clearLines };
}

// ---------------------------------------------------------------------------
// Gewächshausruine
// ---------------------------------------------------------------------------
/**
 * Drei Bogenhallen (je 9 m Spannweite, 4,6 m hoch, 30 m lang) aus Rohrrippen alle 2,5 m mit Pfetten und Windverbänden;
 * Verglasung fehlt (Scherben am Boden), einzelne Rippen eingeknickt bzw. umgelegt, Fundamentsockel aus Beton.
 */
export function greenhouseRuin(b, cx, cz, y0) {
  const r = rngOf(4401), span = 9, hgt = 4.6, len = 30, mat = 'metal_galvanized', tint = '#9a9c98';
  for (let hall = 0; hall < 3; hall++) {
    const ox = cx - 11 + hall * 11, oz0 = cz - len / 2;
    // Sockelmauer
    for (const sx of [-1, 1]) b.box(ox + sx * span / 2, y0 - 0.2, cz, 0.25, 0.55, len, 'concrete', { tint: '#7a7770', minimap: 'cover' });
    const ribs = [];
    const nR = Math.round(len / 2.5);
    for (let i = 0; i <= nR; i++) {
      const z = oz0 + i * (len / nR);
      // Einknicken: Rippen im hinteren Drittel der mittleren Halle, ganze Halle 3 teilweise umgelegt
      const crushed = (hall === 1 && i > nR * 0.6) || (hall === 2 && i % 4 === 1) ? 0.35 + r() * 0.5 : 0;
      const tilt = hall === 2 && i > nR * 0.7 ? 0.5 + r() * 0.4 : 0;
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const a = (k / 12) * Math.PI;
        let px = -Math.cos(a) * span / 2, py = Math.sin(a) * hgt;
        if (crushed) { py *= 1 - crushed * Math.pow(Math.sin(a), 3); px *= 1 + crushed * 0.15 * Math.sin(a); }
        const pz = z + Math.sin(a) * tilt * hgt * 0.4;
        pts.push([ox + px, y0 + 0.35 + py * (1 - tilt * 0.3), pz]);
      }
      ribs.push(pts);
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, ay, az] = pts[k], [bx, by, bz] = pts[k + 1];
        beam(b, ax, ay, az, bx, by, bz, 0.035, mat, { tint, seg: 6, collide: k === 0 || k === 11, bullet: false });
      }
      // senkrechte Fußstütze
      beam(b, pts[0][0], y0 - 0.1, pts[0][2], pts[0][0], pts[0][1], pts[0][2], 0.04, mat, { tint, seg: 6 });
      beam(b, pts[12][0], y0 - 0.1, pts[12][2], pts[12][0], pts[12][1], pts[12][2], 0.04, mat, { tint, seg: 6 });
    }
    // Pfetten (Längsrohre) an 5 Stellen des Bogens, einzelne fehlen; Windverband (Diagonalen) in den Endfeldern
    for (const k of [1, 3, 6, 9, 11]) {
      for (let i = 0; i < ribs.length - 1; i++) {
        if (r() < 0.12) continue;
        const a = ribs[i][k], c2 = ribs[i + 1][k];
        beam(b, a[0], a[1], a[2], c2[0], c2[1], c2[2], 0.022, mat, { tint, seg: 5 });
      }
    }
    for (const i of [0, ribs.length - 2]) for (const k of [2, 10]) {
      const a = ribs[i][k - 2], c2 = ribs[i + 1][k + 1];
      beam(b, a[0], a[1], a[2], c2[0], c2[1], c2[2], 0.018, mat, { tint, seg: 4 });
    }
    // Pflanztische (verkohlt) und Scherben
    for (let i = 0; i < 6; i++) {
      const z = oz0 + 3 + i * 4.4;
      if (r() < 0.3) continue;
      b.box(ox - 2.4 + r() * 0.3, y0 + 0.75, z, 1.2, 0.06, 3.2, 'wood_dark', { tint: '#2d2620', minimap: false, rz: r() < 0.3 ? 0.25 : 0 });
      for (const sx of [-0.5, 0.5]) for (const sz of [-1.4, 1.4]) b.box(ox - 2.4 + sx, y0, z + sz, 0.06, 0.75, 0.06, 'metal_rust', { tint: '#5a4d42', collide: false, minimap: false });
    }
    for (let i = 0; i < 40; i++) {
      const gx = ox + (r() - 0.5) * span * 1.1, gz = oz0 + r() * len;
      b.box(gx, y0 + 0.31, gz, 0.15 + r() * 0.35, 0.008, 0.1 + r() * 0.3, 'glass', { ry: r() * TAU, rx: (r() - 0.5) * 0.2, collide: false, minimap: false, cast: false, ao: false });
    }
  }
  // Heizkessel-Ruine (Ziegelsockel + Rohr) an der Stirnseite
  b.box(cx + 18, y0, cz - 6, 3, 2.2, 3.4, 'brick_dark', { tint: '#5c4a40', minimap: 'cover' });
  beam(b, cx + 18, y0 + 2.2, cz - 6, cx + 18.2, y0 + 7.5, cz - 6, 0.22, 'metal_rust', { tint: '#4c4038', seg: 10, collide: true });
}

// ---------------------------------------------------------------------------
// Holzplatz
// ---------------------------------------------------------------------------
/** Abgebrannter Holzplatz: Polterholz (Stammstapel, verkohlt), Schuppenruine (Pfosten, Restwände, eingestürztes Dach), Sägebock, Bohlen. */
export function timberYard(b, cx, cz, y0) {
  const r = rngOf(5521);
  // Polter: 3 Stapel quer liegender Stämme (Pyramide)
  for (const [px, pz, ry] of [[-10, -6, 0.1], [-9, 6, -0.05], [6, 9, 1.55]]) {
    const L = 7 + r() * 3;
    for (let row = 0; row < 4; row++) {
      const n = 5 - row;
      for (let i = 0; i < n; i++) {
        const rr = 0.18 + r() * 0.09, off = (i - (n - 1) / 2) * 0.48;
        const lx = Math.cos(ry) * 0 - Math.sin(ry) * off, lz = Math.cos(ry) * off;
        b.cyl(cx + px + lx, y0 + 0.2 + row * 0.42, cz + pz + lz, rr, L * (0.92 + r() * 0.12), r() < 0.6 ? 'borke_verkohlt' : 'totholz', { axis: 'x', ry, seg: 9, minimap: row === 0 ? 'cover' : false, collide: row < 3 });
      }
    }
  }
  // Schuppenruine: 6 Pfosten, Reste der Bretterwände, eingestürzter Dachstuhl
  const sx = cx + 5, sz = cz - 6, w = 10, d = 6;
  for (const [ox, oz] of [[-w / 2, -d / 2], [0, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [0, d / 2], [w / 2, d / 2]]) {
    const h = 2.4 + r() * 1.4;
    b.box(sx + ox, y0, sz + oz, 0.18, h, 0.18, 'borke_verkohlt', { tint: '#4a4440', minimap: 'pillar' });
  }
  for (let i = 0; i < 14; i++) {
    const t = r(), h = 0.4 + r() * 1.8;
    b.box(sx - w / 2 + t * w, y0, sz - d / 2 - 0.05, 0.2, h, 0.04, 'wood_dark', { tint: '#26201b', minimap: false, rz: (r() - 0.5) * 0.15 });
  }
  for (let i = 0; i < 6; i++) {
    const t = -w / 2 + i * (w / 5);
    bar(b, sx + t, y0 + 0.2, sz - d / 2, sx + t + (r() - 0.5) * 0.6, y0 + 1.6 + r(), sz + d / 2, 0.12, 'borke_verkohlt', { tint: '#3c3632' });
  }
  // Wellblechtafeln vom Dach (verbogen, rostig)
  for (let i = 0; i < 5; i++) b.box(sx - 3 + r() * 6, y0 + 0.15 + r() * 0.5, sz + (r() - 0.5) * 5, 2.2, 0.03, 0.9, 'metal_corrugated', { ry: r() * TAU, rx: (r() - 0.5) * 0.5, rz: (r() - 0.5) * 0.3, tint: '#7a5a44', minimap: false, collide: false });
  // Sägebock und verstreute Bohlen
  b.box(cx - 2, y0, cz + 2, 3.2, 0.8, 0.9, 'metal_rust', { tint: '#5b4a3e', minimap: 'cover' });
  b.cyl(cx - 2, y0 + 1.15, cz + 2, 0.45, 0.04, 'metal_rust', { axis: 'z', tint: '#6b5a4c', collide: false, minimap: false, seg: 18 });
  for (let i = 0; i < 12; i++) b.box(cx + (r() - 0.5) * 18, y0 + 0.05 + r() * 0.1, cz + (r() - 0.5) * 14, 2.5 + r() * 1.5, 0.05, 0.22, 'wood_planks', { ry: r() * TAU, rz: (r() - 0.5) * 0.15, tint: r() < 0.5 ? '#3d342c' : '#5a4c3e', minimap: false, collide: false });
  barrelGroup(b, cx + 12, cz + 8, { n: 3 });
}

// ---------------------------------------------------------------------------
// Ausgebrannte Fahrzeugwracks (eigene Modelle)
// ---------------------------------------------------------------------------
/** Brandfarben: verkohlt (schwarz), Rost (orange-braun), Asche/ausgeglüht (grauweiß) – je Teil gestreut. */
const BURN = ['#1c1a18', '#26221f', '#2b2724', '#1f1d1b', '#4a3a2e', '#5c4a3c', '#6b655e', '#33302c'];

/**
 * Ausgebrannter Pritschenwagen: Leiterrahmen, Fahrerhaus als Blechschale ohne Scheiben (eine Tür fehlt, Dach
 * eingedrückt), Motorblock unter fehlender Haube, Pritsche ohne Bretter (nur Rahmen, verkohlte Reste), Felgen ohne
 * Reifen (eine Seite tiefer – Wrack schief). kind 'lkw' | 'pkw' (ausgebrannter Kombi). Kollision grob (Quader).
 */
export function burntWreck(b, x, y, z, ry, kind = 'lkw', seed = 1) {
  const r = rngOf(seed * 7717 + 3);
  const tilt = 0.04 + r() * 0.05;
  const f = (lx, ly, lz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + lx * c + lz * s, y + ly + lx * tilt, z - lx * s + lz * c]; };
  const col = () => BURN[Math.floor(r() * BURN.length)];
  const panel = (lx, ly, lz, w, h, d, o = {}) => { const [px, py, pz] = f(lx, ly, lz); b.box(px, py, pz, w, h, d, o.mat || (r() < 0.25 ? 'metal_rust' : 'metal_painted'), { ry, rz: tilt + (o.rz || 0), rx: o.rx || 0, tint: o.tint || col(), collide: false, minimap: false, grad: false, uv: 'local' }); };
  const rim = (lx, lz, rr) => { const [px, py, pz] = f(lx, rr * 0.8, lz); b.cyl(px, py, pz, rr, 0.2, 'metal_rust', { axis: 'x', ry, tint: '#4a3a2e', collide: false, minimap: false, seg: 12 }); b.cyl(px, py, pz, rr * 0.45, 0.24, 'metal_rust', { axis: 'x', ry, tint: '#2a2420', collide: false, minimap: false, seg: 8 }); };
  if (kind === 'pkw') {
    const L = 4.5, W = 1.75;
    panel(0, 0.28, 0, W, 0.45, L);                                        // Wanne/Schweller
    panel(0, 0.72, 1.55, W - 0.05, 0.12, 1.3, { rx: -0.08 });            // Motorhaube (verzogen)
    panel(0, 0.72, -1.7, W - 0.05, 0.1, 1.0);                             // Heckdeckel
    for (const sx of [-1, 1]) for (const zz of [0.85, -0.2, -1.2]) panel(sx * (W / 2 - 0.05), 0.75, zz, 0.06, 0.62, 0.08); // Säulen
    panel(0, 1.33, -0.2, W - 0.15, 0.05, 2.1, { rz: 0.03, rx: 0.04 });   // Dach (eingesackt)
    for (const sx of [-1, 1]) panel(sx * (W / 2 - 0.02), 0.32, -0.2, 0.04, 0.42, 2.0);  // Türbleche unten
    panel(0, 0.45, 1.9, 0.7, 0.4, 0.5, { mat: 'metal_galvanized', tint: '#3d3530' });  // Motor
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rim(sx * (W / 2 - 0.12), sz * 1.4, 0.24);
    const [cx, cy, cz] = f(0, 0, 0);
    b.solid(cx, cy, cz, W, 1.35, L, { ry, minimap: 'vehicle' });
    return;
  }
  // Pritschenwagen
  const W = 2.1, cabZ = 2.0;
  for (const sx of [-0.45, 0.45]) panel(sx, 0.55, -0.4, 0.14, 0.2, 6.2, { tint: '#2a221d' });          // Leiterrahmen
  for (let k = 0; k < 5; k++) panel(0, 0.57, -3 + k * 1.4, 1.05, 0.12, 0.1, { tint: '#2a221d' });       // Quertraversen
  // Fahrerhaus: Boden, Rückwand, Dach (eingedrückt), Seitenwände (Tür links fehlt), Front mit Kühlergrill
  panel(0, 0.85, cabZ, W, 0.08, 1.7);
  panel(0, 0.9, cabZ - 0.82, W, 1.5, 0.06);
  panel(0, 2.25, cabZ, W - 0.1, 0.06, 1.6, { rx: 0.06, rz: -0.05 });
  panel(W / 2 - 0.03, 0.9, cabZ, 0.05, 0.75, 1.6);
  panel(W / 2 - 0.03, 1.65, cabZ - 0.55, 0.05, 0.6, 0.12);
  panel(W / 2 - 0.03, 1.65, cabZ + 0.75, 0.05, 0.6, 0.1);
  panel(-W / 2 + 0.03, 0.9, cabZ - 0.6, 0.05, 1.35, 0.15);
  panel(-W / 2 + 0.03, 1.65, cabZ + 0.75, 0.05, 0.6, 0.1);
  panel(0, 0.9, cabZ + 0.84, W, 0.75, 0.06);
  for (let k = 0; k < 5; k++) panel(-0.6 + k * 0.3, 0.98, cabZ + 0.89, 0.06, 0.45, 0.04, { tint: '#3a332d' }); // Grill
  panel(0, 0.62, cabZ + 0.95, W + 0.05, 0.16, 0.1, { tint: '#2a2420' });                                       // Stoßstange
  panel(0, 1.0, cabZ + 0.2, 0.75, 0.55, 0.9, { mat: 'metal_galvanized', tint: '#3a332e' });                     // Motor
  panel(0.35, 1.0, cabZ - 0.25, 0.5, 0.06, 0.45, { tint: '#1e1c1a', rx: 0.3 });                                 // Sitzgerippe
  // Pritsche: Rahmen und Bordwände halb, verkohlte Bretterreste
  panel(0, 0.75, -1.6, W, 0.1, 3.9, { tint: '#2c2620' });
  for (const sx of [-1, 1]) panel(sx * (W / 2 - 0.02), 0.85, -1.6, 0.05, 0.5, 3.9, { rz: sx * 0.08 });
  panel(0, 0.85, -3.55, W, 0.45, 0.05, { rx: 0.35 });
  for (let k = 0; k < 6; k++) if (r() < 0.6) panel(-0.8 + k * 0.32, 0.86, -1.6 + (r() - 0.5) * 1.5, 0.22, 0.04, 0.8 + r() * 1.6, { mat: 'borke_verkohlt', tint: '#2a2622', rx: (r() - 0.5) * 0.1 });
  for (const sx of [-1, 1]) { rim(sx * 0.95, cabZ + 0.1, 0.42); rim(sx * 0.95, -2.3, 0.42); }
  // Kollision: Fahrerhaus + Pritsche
  { const [cx, cy, cz] = f(0, 0, cabZ); b.solid(cx, cy, cz, W, 2.3, 1.9, { ry, minimap: 'vehicle' }); }
  { const [cx, cy, cz] = f(0, 0, -1.6); b.solid(cx, cy, cz, W, 1.3, 4.0, { ry, minimap: 'vehicle' }); }
  // Brandfleck am Boden
  b.decal(x, y + 0.02, z, 4.5, 8, 'stain', { ry, opacity: 0.8, tint: '#141210' });
}

// ---------------------------------------------------------------------------
// Feldposten (Basis)
// ---------------------------------------------------------------------------
export function fieldPost(b, cx, cz, s, y0) {
  // Sandsackriegel vor der Basis (Richtung Feind = −s·z), Munitionskisten, Fässer
  for (const x of [-28, -16, 16, 28]) sandbags(b, cx + x - 3, cz - s * 9, cx + x + 3, cz - s * 9, { rows: 3, y: y0 });
  crateStack(b, cx - 6, cz + s * 6, { n: 3 });
  crateStack(b, cx + 7, cz + s * 5, { n: 2 });
  barrelGroup(b, cx + 22, cz + s * 6, { n: 3 });
}
