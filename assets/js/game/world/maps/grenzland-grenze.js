// NULLPUNKT — Grenzland: Grenzanlage als sichtbare Kartengrenze (Owner: world). Statt der unsichtbaren Wand steht
// rund um die Spielfläche ein Grenzzaun: Maschendraht 2,5 m auf Betonpfosten, nach außen geneigter Übersteigschutz
// mit Stacheldraht, davor ein Kontrollstreifen ohne Bäume/Gras (Sperrraster in bigworld.js über clearLines),
// Warnschilder („HALT! STAATSGRENZE“, „ACHTUNG MINEN“), an den Straßen geschlossene Grenzübergänge (Tor,
// Schlagbaum, Wachhaus), in den Flüssen eine Schwimmsperre. Folgt dem Gelände: gebaut nach dem Gelände
// (def.lateSites, Höhen aus dem fertigen Höhenfeld) – auf allen Rechnern identisch (Höhenfeld deterministisch).
// Kollision je Zaunfeld als Quader bis 3,2 m über dem höheren Pfosten (= sichtbare Höhe mit Übersteigschutz; nicht
// überklettrbar), Kugeln fliegen durch den Maschendraht. Die alte unsichtbare Wand (wallMargin) bleibt dahinter als
// Sicherheitsnetz.
import * as THREE from 'three';
import { frame, hash01 } from '../props.js';

const H = 2.5;          // Maschendraht-Höhe
const COL_H = 3.2;      // Kollision über dem höheren Pfosten (inkl. Übersteigschutz)

/** Grenzlinie: Quadrat mit abgeschrägten Ecken (im Uhrzeigersinn, Blick von oben: x rechts, z unten). */
export function grenzLinie(S = 268, c = 24) {
  return [[-S + c, -S], [S - c, -S], [S, -S + c], [S, S - c], [S - c, S], [-S + c, S], [-S, S - c], [-S, -S + c]];
}

/**
 * Grenzanlage bauen. o: { hf (Höhenfeld), roads (Gelände-Straßen { width, samples }), line (grenzLinie()), spacing (3,2) }
 * → { clearLines: [{ pts, r }] } (Kontrollstreifen ohne Bewuchs)
 */
export function grenzanlage(b, o) {
  const hf = o.hf, line = o.line || grenzLinie(), sp = o.spacing ?? 3.2, wy = hf.waterY;
  const low = b.lookQuality === 'low';
  b.defineSign('grenze_halt', { style: 'plate', text: 'HALT! STAATSGRENZE', sub: 'Überschreiten verboten', bg: '#b8231c', fg: '#ffffff' });
  b.defineSign('grenze_minen', { style: 'warning', text: 'ACHTUNG MINEN', sub: 'Lebensgefahr – Streifen nicht betreten' });
  b.defineSign('grenze_tor', { style: 'plate', text: 'GRENZÜBERGANG', sub: 'Geschlossen – kein Durchlass', bg: '#f2f0ea', fg: '#1c1c1c' });
  const gy = (x, z) => hf.heightAt(x, z);

  // Pfosten je Kante (Ecken gemeinsam); Innenrichtung zur Kartenmitte
  const posts = []; // { x, z, y, ux, uz, nx, nz, e }
  for (let e = 0; e < line.length; e++) {
    const [ax, az] = line[e], [bx, bz] = line[(e + 1) % line.length];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / sp)), ux = (bx - ax) / L, uz = (bz - az) / L;
    let nx = -uz, nz = ux;
    if (nx * -(ax + bx) + nz * -(az + bz) < 0) { nx = -nx; nz = -nz; }
    for (let i = 0; i < n; i++) {
      const x = ax + ux * (L * i) / n, z = az + uz * (L * i) / n, y = gy(x, z);
      // im Fluss steht der Zaun von der Sohle bis 1,8 m über den Wasserspiegel
      posts.push({ x, z, y, top: Math.max(y + H, wy + 1.8), ux, uz, nx, nz, e });
    }
  }
  const N = posts.length;

  // Straßenübergänge: Schnittpunkt Straßenmitte × Grenzlinie → nächster Pfosten; Tor über 3 Felder (≈ 9,6 m)
  const gates = [];
  for (const rd of o.roads || []) {
    const s = rd.samples;
    if (!s) continue;
    for (let k = 0; k + 5 < s.length; k += 3) {
      const x0 = s[k], z0 = s[k + 2], x1 = s[k + 3], z1 = s[k + 5];
      for (let e = 0; e < line.length; e++) {
        const [ax, az] = line[e], [bx, bz] = line[(e + 1) % line.length];
        const d = (x1 - x0) * (bz - az) - (z1 - z0) * (bx - ax);
        if (Math.abs(d) < 1e-9) continue;
        const t = ((ax - x0) * (bz - az) - (az - z0) * (bx - ax)) / d, u = ((ax - x0) * (z1 - z0) - (az - z0) * (x1 - x0)) / d;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
        let bi = 0, bd = Infinity;
        posts.forEach((p, i) => { const dd = (p.x - cx) ** 2 + (p.z - cz) ** 2; if (dd < bd) { bd = dd; bi = i; } });
        if (!gates.some(g => Math.abs(g.i - bi) < 6)) gates.push({ i: bi, x: cx, z: cz, w: rd.width || 5 });
      }
    }
  }
  // Straße endet kurz vor der Grenze (Dorfweg im Westen): Endpunkt < 12 m von der Linie → ebenfalls Übergang
  for (const rd of o.roads || []) {
    const s = rd.samples;
    if (!s || s.length < 6) continue;
    for (const k of [0, s.length - 3]) {
      const ex = s[k], ez = s[k + 2];
      let bi = 0, bd = Infinity;
      posts.forEach((p, i) => { const dd = (p.x - ex) ** 2 + (p.z - ez) ** 2; if (dd < bd) { bd = dd; bi = i; } });
      if (bd < 144 && !gates.some(g => Math.abs(g.i - bi) < 6)) gates.push({ i: bi, x: posts[bi].x, z: posts[bi].z, w: rd.width || 4, end: true });
    }
  }
  const gateAt = new Map(); // Feldindex → Tor
  for (const g of gates) for (const k of [g.i - 2, g.i - 1, g.i]) gateAt.set((k + N) % N, g);

  // Geometrie: Maschendraht, Übersteigschutz (schräg nach außen), Stacheldraht (schmale Bänder)
  const mesh = { P: [], N: [], U: [] }, wire = { P: [], N: [], U: [] };
  const quad = (G, a, bq, c, d, n, uv) => { for (const k of [0, 1, 2, 0, 2, 3]) { const v = [a, bq, c, d][k]; G.P.push(v[0], v[1], v[2]); G.N.push(n[0], n[1], n[2]); G.U.push(uv[k][0], uv[k][1]); } };
  let run = 0;
  for (let i = 0; i < N; i++) {
    const A = posts[i], B = posts[(i + 1) % N];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    // Kollision je Feld (auch im Tor und im Wasser), Enden 0,15 m überlappend
    const yl = Math.min(A.y, B.y) - 0.6, yh = Math.max(A.top, B.top) + COL_H - H;
    b.box((A.x + B.x) / 2, yl, (A.z + B.z) / 2, L + 0.3, yh - yl, 0.24, 'black', { ry: Math.atan2(-(B.z - A.z), B.x - A.x), visual: false, minimap: false, bullet: false });
    if (gateAt.has(i)) { run += L; continue; }
    const n = [A.nx, 0, A.nz], u0 = run, u1 = run + L;
    quad(mesh, [A.x, A.y + 0.05, A.z], [B.x, B.y + 0.05, B.z], [B.x, B.top, B.z], [A.x, A.top, A.z], n, [[u0, 0], [u1, 0], [u1, B.top - B.y], [u0, A.top - A.y]]);
    // Übersteigschutz: 0,55 m schräg nach außen
    const ox = -A.nx * 0.42, oz = -A.nz * 0.42;
    quad(mesh, [A.x, A.top, A.z], [B.x, B.top, B.z], [B.x + ox, B.top + 0.38, B.z + oz], [A.x + ox, A.top + 0.38, A.z + oz], [A.nx * 0.7, 0.7, A.nz * 0.7], [[u0, 0], [u1, 0], [u1, 0.55], [u0, 0.55]]);
    for (const t of [0.35, 0.7, 1.0]) {
      const dx = ox * t, dz = oz * t, yy = 0.38 * t;
      quad(wire, [A.x + dx, A.top + yy - 0.008, A.z + dz], [B.x + dx, B.top + yy - 0.008, B.z + dz], [B.x + dx, B.top + yy + 0.008, B.z + dz], [A.x + dx, A.top + yy + 0.008, A.z + dz], n, [[u0, 0], [u1, 0], [u1, 0.02], [u0, 0.02]]);
    }
    // Spanndraht unten
    quad(wire, [A.x, A.y + 0.12, A.z], [B.x, B.y + 0.12, B.z], [B.x, B.y + 0.135, B.z], [A.x, A.y + 0.135, A.z], n, [[u0, 0], [u1, 0], [u1, 0.02], [u0, 0.02]]);
    run += L;
  }
  const geo = (G) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(G.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(G.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(G.U, 2));
    return g;
  };
  b.geom(geo(mesh), 0, 0, 0, 'chainlink', { uv: 'keep', collide: false, minimap: false, bullet: false, grad: false, ao: false, cast: false, interior: false });
  b.geom(geo(wire), 0, 0, 0, 'metal_galvanized', { uv: 'keep', collide: false, minimap: false, bullet: false, grad: false, ao: false, cast: false, interior: false });

  // Pfosten (Beton) mit Ausleger; im Wasser bis zur Sohle
  for (let i = 0; i < N; i++) {
    const p = posts[i];
    if (gateAt.has(i) && gateAt.has((i - 1 + N) % N)) continue; // innere Torpfosten entfallen
    const ry = Math.atan2(-p.uz, p.ux);
    b.box(p.x, p.y - 0.4, p.z, 0.14, p.top - p.y + 0.5, 0.14, 'concrete', { ry, tint: '#bdb8ad', collide: false, minimap: false, grad: false, interior: false });
    // Ausleger (Winkelstahl) schräg nach außen bis zum obersten Stacheldraht
    strut(b, p.x, p.top - 0.05, p.z, p.x - p.nx * 0.44, p.top + 0.42, p.z - p.nz * 0.44, 0.03, 'metal_galvanized');
  }

  // Warnschilder alle ≈ 80 m (abwechselnd), innen am Zaun
  let k = 0;
  for (let i = 0; i < N; i += 25) {
    const p = posts[i];
    if (gateAt.has(i) || gateAt.has((i - 1 + N) % N) || p.y < wy + 0.3) continue;
    const ry = Math.atan2(p.nx, p.nz);
    const key = k++ % 2 ? 'grenze_minen' : 'grenze_halt';
    b.sign(p.x + p.nx * 0.09 + p.ux * 1.6, p.y + 1.25, p.z + p.nz * 0.09 + p.uz * 1.6, key === 'grenze_halt' ? 1.4 : 0.9, key === 'grenze_halt' ? 0.55 : 0.8, key, { ry, back: false, depth: 0.012 });
    // Minenpflöcke im Streifen (Holzpflock mit Warnschild)
    if (key === 'grenze_minen' && !low) for (const off of [-7, 7]) {
      const mx = p.x + p.nx * 2.6 + p.ux * off, mz = p.z + p.nz * 2.6 + p.uz * off, my = gy(mx, mz);
      if (my < wy + 0.3) continue;
      b.box(mx, my - 0.2, mz, 0.08, 1.1, 0.08, 'wood_dark', { tint: '#6a5038', collide: false, minimap: false, grad: false, interior: false });
      b.sign(mx + p.nx * 0.05, my + 0.55, mz + p.nz * 0.05, 0.36, 0.32, 'grenze_minen', { ry, back: false, depth: 0.008 });
    }
  }

  // Grenzübergänge
  for (const g of gates) uebergang(b, posts, g, N, gy);

  // Schwimmsperre im Fluss (3 m innen): Bojenkette, wo das Wasser tiefer als 0,3 m ist
  for (let i = 0; i < N; i++) {
    const p = posts[i];
    if (p.y > wy - 0.3) continue;
    for (const t of [0, 0.5]) {
      const B = posts[(i + 1) % N], x = p.x + (B.x - p.x) * t + p.nx * 3, z = p.z + (B.z - p.z) * t + p.nz * 3;
      if (gy(x, z) > wy - 0.25) continue;
      b.cyl(x, wy - 0.12, z, 0.16, 0.26, 'metal_painted', { tint: hash01(x, z, 2) < 0.5 ? '#e0602a' : '#e8e4da', seg: 10, collide: false, minimap: false, ao: false, interior: false });
    }
    const B = posts[(i + 1) % N];
    if (B.y <= wy - 0.3) b.box((p.x + B.x) / 2 + p.nx * 3, wy + 0.02, (p.z + B.z) / 2 + p.nz * 3, Math.hypot(B.x - p.x, B.z - p.z), 0.025, 0.025, 'black', { ry: Math.atan2(-(B.z - p.z), B.x - p.x), tint: '#2a2a2a', collide: false, minimap: false, grad: false, ao: false, interior: false });
  }

  return { clearLines: [{ pts: [...line, line[0]], r: 4.5 }] };
}

/** Zylinder von Punkt G nach Punkt M (Welt). */
function strut(b, gx, gy, gz, mx, my, mz, r, mat) {
  const dx = mx - gx, dy = my - gy, dz = mz - gz, L = Math.hypot(dx, dy, dz);
  b.cyl(gx, gy, gz, r, L, mat, { rx: Math.acos(Math.max(-1, Math.min(1, dy / L))), ry: Math.atan2(dx, dz), seg: 4, collide: false, minimap: false, ao: false, interior: false, caps: false });
}

/** Geschlossener Grenzübergang über drei Zaunfelder: Torflügel, dicke Torpfosten, Schlagbaum, Wachhaus, Schilder. */
function uebergang(b, posts, g, N, gy) {
  const A = posts[(g.i - 2 + N) % N], B = posts[(g.i + 1) % N], P = posts[g.i];
  const ux = P.ux, uz = P.uz, nx = P.nx, nz = P.nz, ry = Math.atan2(-uz, ux);
  const L = Math.hypot(B.x - A.x, B.z - A.z), cx = (A.x + B.x) / 2, cz = (A.z + B.z) / 2, cy = Math.min(A.y, B.y, gy(cx, cz));
  const tint = '#4f5a4a';
  // Torpfosten (Beton, 0,3 m)
  for (const q of [A, B]) b.box(q.x, q.y - 0.4, q.z, 0.3, 3.4, 0.3, 'concrete', { ry, tint: '#c8c2b6', collide: false, minimap: false, interior: false });
  // zwei Torflügel: Rahmen + Querstreben + Maschendraht
  const f = frame(b, cx, cy, cz, ry);
  const half = L / 2 - 0.2;
  for (const s of [-1, 1]) {
    const mx = s * (half / 2 + 0.05);
    f.box(mx, 0.12, 0, half, 0.07, 0.07, 'metal_painted', { tint, collide: false, minimap: false, grad: false, interior: false });
    f.box(mx, 2.55, 0, half, 0.07, 0.07, 'metal_painted', { tint, collide: false, minimap: false, grad: false, interior: false });
    f.box(mx, 1.3, 0, half, 0.05, 0.05, 'metal_painted', { tint, collide: false, minimap: false, grad: false, interior: false });
    for (const ex of [mx - half / 2 + 0.035, mx + half / 2 - 0.035]) f.box(ex, 0.12, 0, 0.07, 2.5, 0.07, 'metal_painted', { tint, collide: false, minimap: false, grad: false, interior: false });
    f.box(mx, 0.19, 0, half - 0.1, 2.36, 0.012, 'chainlink', { collide: false, minimap: false, bullet: false, grad: false, ao: false, interior: false, uvScale: 1 });
    // Diagonale
    f.box(mx, 1.3, 0.04, Math.hypot(half, 2.3), 0.04, 0.04, 'metal_painted', { tint, collide: false, minimap: false, grad: false, interior: false, rz: Math.atan2(2.3, half) * s });
    f.box(mx + s * (half / 2 - 0.25), 2.62, 0, 0.5, 0.3, 0.02, 'metal_painted', { tint: '#c8302a', collide: false, minimap: false, grad: false, ao: false, interior: false });
  }
  // Schild am Tor (innen)
  const iry = Math.atan2(nx, nz);
  b.sign(cx + nx * 0.06, cy + 1.45, cz + nz * 0.06, 2.0, 0.62, 'grenze_halt', { ry: iry, back: false, depth: 0.012 });
  // Schlagbaum 5 m innen quer über die Straße
  const sx = cx + nx * 5, sz = cz + nz * 5, sy = gy(sx, sz), bw = Math.max(6, g.w + 2);
  const [px, pz] = [sx - ux * (bw / 2 + 0.3), sz - uz * (bw / 2 + 0.3)];
  b.box(px, sy, pz, 0.35, 1.05, 0.35, 'metal_painted', { ry, tint: '#e8e4da', minimap: false, interior: false });
  b.box(px - ux * 0.35, sy + 0.95, pz - uz * 0.35, 0.5, 0.35, 0.3, 'concrete', { ry, tint: '#8a8680', collide: false, minimap: false, interior: false });
  const nStripe = 8;
  for (let i = 0; i < nStripe; i++) {
    const t = (i + 0.5) / nStripe - 0.5, bx = sx + ux * t * bw, bz = sz + uz * t * bw;
    b.box(bx, sy + 0.92, bz, bw / nStripe, 0.1, 0.1, 'metal_painted', { ry, tint: i % 2 ? '#c8302a' : '#f2f0ea', collide: false, minimap: false, grad: false, ao: false, interior: false });
  }
  b.box(sx, sy + 0.9, sz, bw, 0.14, 0.12, 'black', { ry, visual: false, minimap: false, bullet: false });
  const [qx, qz] = [sx + ux * (bw / 2 + 0.2), sz + uz * (bw / 2 + 0.2)];
  b.box(qx, sy, qz, 0.1, 0.92, 0.1, 'metal_painted', { ry, tint: '#e8e4da', collide: false, minimap: false, interior: false });
  b.box(qx, sy + 0.8, qz, 0.3, 0.06, 0.1, 'metal_painted', { ry, tint: '#e8e4da', collide: false, minimap: false, interior: false });
  b.sign(px + nx * 0.2, sy + 1.55, pz + nz * 0.2, 1.4, 0.45, 'grenze_tor', { ry: iry, depth: 0.02 });
  b.box(px, sy + 1.05, pz, 0.08, 0.7, 0.08, 'metal_galvanized', { ry, collide: false, minimap: false, interior: false });
  // Wachhaus neben der Straße (innen), Fenster zur Straße
  const hx = sx + ux * (bw / 2 + 2.6) + nx * 1.5, hz = sz + uz * (bw / 2 + 2.6) + nz * 1.5, hy = gy(hx, hz);
  const wf = frame(b, hx, hy - 0.1, hz, ry);
  wf.box(0, 0, 0, 1.9, 2.55, 1.9, 'wood_planks', { tint: '#6a7a5a', minimap: false, interior: false });
  wf.box(0, 2.55, 0, 2.2, 0.12, 2.2, 'metal_painted', { tint: '#3a3c3a', collide: false, minimap: false, grad: false, interior: false });
  for (const [lx, lz, w, d] of [[-0.951, 0, 0.02, 1.2], [0, 0.951, 1.2, 0.02], [0, -0.951, 1.2, 0.02]]) wf.box(lx, 1.25, lz, w, 0.7, d, 'glass', { collide: false, minimap: false, ao: false, interior: false });
  wf.box(0.951, 0.1, 0.3, 0.02, 2.0, 0.8, 'wood_dark', { tint: '#4a3a2c', collide: false, minimap: false, ao: false, interior: false });
  wf.box(0, 0.95, 0.955, 1.9, 0.08, 0.04, 'white', { tint: '#c8302a', collide: false, minimap: false, ao: false, grad: false, interior: false });
}
