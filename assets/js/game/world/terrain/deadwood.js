// NULLPUNKT — Totholz des Brandwalds (21.10., eigene Geometrie und Texturen) (Owner: world).
// Stehende Baumleichen in vier Formen – hohe, ausgedünnte Spieße mit Spitze, in Brusthöhe bis Kronenmitte
// abgebrochene Stämme mit Splitterkrone (lange Rindenspäne, helle Bruchfläche), Stümpfe und „graue“ Stämme, deren
// Rinde oberhalb einer Brandnarbe abgefallen ist – dazu umgestürzte Stämme mit Wurzelteller oder Bruchende.
// Jede Form mit Wurzelanlauf, unregelmäßigem Querschnitt, leichter Krümmung, Aststümpfen und dünnen, toten Ästen.
// Zwei bzw. drei Materialgruppen je Geometrie: 0 = verkohlte Borke, 1 = helles Totholz (Bruch, Splitter, entrindete
// Teile), 2 = Erde (Wurzelteller). Instanziert mit Nah-/Fernstufe wie vegetation.js; Kollision je Stamm (Prisma) bzw.
// liegendem Stamm (gedrehtes Prisma) auf JEDER Stufe gleich (Mehrspieler) – nur die Optik hängt an der Stufe.
import * as THREE from 'three';
import { rng, hash2, createSimplex, smoothstep } from './noise.js';

const TAU = Math.PI * 2;
/** Abstände je Stufe [nah, mittel, fern] in m (fern ≈ wo der Dunst die Stämme schluckt) und Obergrenze der Nahstufe. */
const DEAD_LOD = { low: [40, 95, 210], medium: [60, 140, 260], high: [90, 190, 330], ultra: [110, 230, 380] };
const NEAR_CAP = { low: 200, medium: 450, high: 700, ultra: 900 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Euler(), _c = new THREE.Color(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Geometrie-Sammler
// ---------------------------------------------------------------------------
/** Indizierte Geometrie mit Materialgruppen (Dreiecke je Gruppe getrennt gesammelt). */
class Mesher {
  constructor(groups = 2) { this.P = []; this.U = []; this.C = []; this.idx = Array.from({ length: groups }, () => []); }
  v(x, y, z, u, w, col = 1) { this.P.push(x, y, z); this.U.push(u, w); this.C.push(col, col, col); return this.P.length / 3 - 1; }
  tri(g, a, b, c) { this.idx[g].push(a, b, c); }
  /** Viereck a→b→c→d gegen den Uhrzeigersinn von außen gesehen. */
  quad(g, a, b, c, d) { this.idx[g].push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    const all = [];
    let off = 0;
    this.idx.forEach((L, k) => { for (const i of L) all.push(i); g.addGroup(off, L.length, k); off += L.length; });
    g.setIndex(all);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Orthonormalbasis (a, b) senkrecht zu d mit a × b = −d (Ringe laufen dann wie beim Stamm, Außenseite vorn). */
function frame(d) {
  const h = Math.abs(d.y) < 0.9 ? _up : new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3().crossVectors(d, h).normalize();
  const b = new THREE.Vector3().crossVectors(a, d).normalize();
  return [a, b];
}

/**
 * Ast/Aststumpf/Wurzel: verjüngtes Prisma von p0 entlang d (normiert), `segs` Abschnitte, Hängen nach unten (droop,
 * m am Ende), spitz zulaufend. Gruppe g, Farbe col.
 */
function limb(M, g, p0, d, len, r0, r1, sides, segs, droop, col) {
  const [a, b] = frame(d);
  const rings = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, r = r0 + (r1 - r0) * t;
    const cx = p0.x + d.x * len * t, cy = p0.y + d.y * len * t - droop * t * t, cz = p0.z + d.z * len * t;
    const ring = [];
    for (let j = 0; j <= sides; j++) {
      const ph = (j / sides) * TAU, ca = Math.cos(ph), sa = Math.sin(ph);
      ring.push(M.v(cx + (a.x * ca + b.x * sa) * r, cy + (a.y * ca + b.y * sa) * r, cz + (a.z * ca + b.z * sa) * r, j / sides * 0.3, t * len, col));
    }
    rings.push(ring);
  }
  for (let s = 0; s < segs; s++) for (let j = 0; j < sides; j++) M.quad(g, rings[s][j], rings[s + 1][j], rings[s + 1][j + 1], rings[s][j + 1]);
  // Spitze
  const tip = M.v(p0.x + d.x * (len + r1 * 2), p0.y + d.y * (len + r1 * 2) - droop, p0.z + d.z * (len + r1 * 2), 0.15, len, col);
  for (let j = 0; j < sides; j++) M.tri(g, rings[segs][j], tip, rings[segs][j + 1]);
}

// ---------------------------------------------------------------------------
// Stehender Stamm (Baumleiche)
// ---------------------------------------------------------------------------
/**
 * Stamm entlang +y von 0 bis H mit Wurzelanlauf, unregelmäßigem Querschnitt, Krümmung, Brandgrenze (Gruppe 0 unten/
 * verkohlt, Gruppe 1 entrindet oben), Spitze oder Splitterkrone, Aststümpfen und toten Ästen.
 * o: { H, r0, sides, step, tip, charH, charSide, lean:[x,z], bend, splinter, stubs, twigs, seed, far, buttress }
 * → BufferGeometry (Gruppen 0/1); Mittelstufe (far = 1) einfacher, ohne Äste; Fernstufe (far = 2) nur noch ein
 * vierkantiger, sich verjüngender Schaft mit Spitze bzw. Bruchzacken (≈ 30 Dreiecke).
 */
export function snagGeometry(o) {
  const r = rng(o.seed || 1), noise = createSimplex((o.seed || 1) * 7 + 3);
  const M = new Mesher(2);
  const H = o.H, r0 = o.r0, far2 = o.far === 2, sides = far2 ? 4 : o.far ? 5 : (o.sides || 9), tip = !!o.tip;
  const lean = o.lean || [0, 0], bend = o.bend ?? 0.15, bph = r() * TAU, bf = 0.12 + r() * 0.12;
  const charH = o.charH ?? H + 5, charSide = o.charSide ?? 0;
  const circ = TAU * r0 * 1.15;
  // Ringhöhen: dichter am Fuß (Anlauf) und an der Bruchstelle
  const ys = far2 ? [0, 0.5] : [0, 0.12, 0.35, 0.75];
  const step = far2 ? H : o.far ? Math.max(2.5, H / 3) : (o.step || 0.9);
  if (far2) { if (H > 4) ys.push(H * 0.5); } else for (let y = 1.4; y < H - 0.15; y += step * (0.8 + r() * 0.4)) ys.push(y);
  ys.push(H);
  const cen = (y) => [lean[0] * y + bend * Math.sin(y * bf + bph) * (y / H), lean[1] * y + bend * Math.cos(y * bf * 0.8 + bph) * (y / H)];
  const rad = (y, th) => {
    const flare = 1 + 0.55 * Math.exp(-y / 0.32) + 0.14 * Math.exp(-y / 1.3);
    const taper = tip ? Math.pow(Math.max(0, 1 - y / (H * 1.02)), 0.72) * 0.96 + 0.025 : 1 - 0.32 * (y / Math.max(H, 6));
    // Wurzelanläufe (4–5 Wülste am Fuß), Querschnitt unregelmäßig, feine Längswülste
    const butt = (o.buttress ?? 0.4) * Math.exp(-y / 0.45) * Math.pow(Math.max(0, Math.cos(th * 4 + bph)), 2);
    const irr = noise(Math.cos(th) * 1.1 + y * 0.18, Math.sin(th) * 1.1 + y * 0.31) * 0.13 + Math.sin(th * 5 + y * 0.6 + bph) * 0.035;
    return r0 * flare * taper * (1 + butt + irr);
  };
  // Brandgrenze je Winkel: eine Seite höher verkohlt (Feuer vom Hang/Wind), verrauscht
  const charAt = (y, th) => y < charH + Math.cos(th - charSide) * charH * 0.45 + noise(Math.cos(th) * 1.4, Math.sin(th) * 1.4 + y * 0.35) * 1.4 + Math.sin(th * 3 + bph) * 0.5;
  const rings = [];
  for (const y of ys) {
    const [cx, cz] = cen(y), ring = [];
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * TAU, rr = rad(y, th);
      const ch = charAt(y, th);
      // Ruß am Übergang, Fuß dunkler, leichte Eigenhelligkeit
      const col = ch ? 0.8 + 0.2 * smoothstep(0, 1.2, y) : 0.42 + 0.5 * smoothstep(charH, charH + 3.5, y) + noise(th * 3, y * 0.7) * 0.08;
      ring.push(M.v(cx + Math.cos(th) * rr, y, cz + Math.sin(th) * rr, (j / sides) * circ, y, col));
    }
    rings.push({ y, ring, ch: ring.map((_, j) => charAt(y, (j / sides) * TAU)) });
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let j = 0; j < sides; j++) {
      const g = (A.ch[j] || A.ch[j + 1]) ? 0 : 1;
      M.quad(g, A.ring[j], B.ring[j], B.ring[j + 1], A.ring[j + 1]);
    }
  }
  const top = rings[rings.length - 1];
  const [tx, tz] = cen(H);
  const topG = top.ch.some(Boolean) ? 0 : 1;
  if (tip) {
    const t = M.v(tx, H + r0 * 0.6, tz, circ * 0.5, H, 0.9);
    for (let j = 0; j < sides; j++) M.tri(topG, top.ring[j], t, top.ring[j + 1]);
  } else {
    // Splitterkrone: je Spalte ein Zahn; 1–2 lange Späne (äußere Schale), gegenüber kürzer; Bruchfläche hell (Gruppe 1)
    const rt = rad(H, 0), L = [];
    for (let j = 0; j < sides; j++) L.push(0.04 + r() * r() * 0.3 * Math.max(1, r0 * 3));
    const big = Math.floor(r() * sides), sp = (o.splinter ?? 1.2) * (0.6 + r() * 0.8);
    L[big] = sp; L[(big + 1) % sides] = Math.max(L[(big + 1) % sides], sp * (0.35 + r() * 0.3)); L[(big + sides - 1) % sides] = Math.max(L[(big + sides - 1) % sides], sp * (0.2 + r() * 0.3));
    if (!o.far && r() < 0.6) { const b2 = (big + Math.floor(sides / 2)) % sides; L[b2] = Math.max(L[b2], sp * (0.25 + r() * 0.35)); }
    const Lmax = Math.max(...L), spikes = [];
    for (let j = 0; j <= sides; j++) {
      const jj = j % sides, th = (jj / sides) * TAU, l = L[jj];
      // lange Späne bleiben außen (dünne Schale), kurze Zähne rücken nach innen
      const rr = rt * (l > Lmax * 0.5 ? 0.78 : 0.5 + 0.2 * r());
      spikes.push(M.v(tx + Math.cos(th) * rr, H + l, tz + Math.sin(th) * rr, (jj / sides) * circ, H + l, 0.95));
    }
    for (let j = 0; j < sides; j++) M.quad(topG, top.ring[j], spikes[j], spikes[j + 1], top.ring[j + 1]);
    // Bruchfläche: helles Holz, vertiefte Mitte
    const c = M.v(tx, H + Math.min(0.25, Lmax * 0.15), tz, 0, 0, 1);
    for (let j = 0; j < sides; j++) M.tri(1, c, spikes[j + 1], spikes[j]);
    // Innenseite der langen Späne (sonst von innen hohl): zweite, nach innen versetzte Lage für die Spalten am Span
    if (!o.far) {
      const inner = [];
      for (let j = 0; j <= sides; j++) {
        const jj = j % sides, th = (jj / sides) * TAU, l = L[jj];
        inner.push(M.v(tx + Math.cos(th) * rt * 0.42, H + l * 0.92, tz + Math.sin(th) * rt * 0.42, (jj / sides) * circ * 0.6, H + l, 1));
      }
      for (let j = 0; j < sides; j++) {
        if (L[j] < Lmax * 0.3 && L[(j + 1) % sides] < Lmax * 0.3) continue;
        M.quad(1, spikes[j + 1], inner[j + 1], inner[j], spikes[j]);
      }
    }
  }
  if (!o.far) {
    const P0 = new THREE.Vector3(), D = new THREE.Vector3();
    // Aststümpfe (kurz, kräftig, meist leicht aufwärts)
    for (let k = 0; k < (o.stubs || 0); k++) {
      const y = 1.6 + r() * Math.max(0.5, H - 2.2), th = r() * TAU, [cx, cz] = cen(y), rr = rad(y, th) * 0.85;
      P0.set(cx + Math.cos(th) * rr, y, cz + Math.sin(th) * rr);
      D.set(Math.cos(th), 0.15 + r() * 0.5, Math.sin(th)).normalize();
      const len = 0.12 + r() * 0.45, rb = Math.min(rad(y, th) * 0.35, 0.03 + r() * 0.05);
      limb(M, charAt(y, th) ? 0 : 1, P0, D, len, rb, rb * 0.45, 4, 1, 0, 0.85);
    }
    // dünne, tote Äste (lang, fast waagrecht, leicht hängend) – im oberen Teil
    for (let k = 0; k < (o.twigs || 0); k++) {
      const y = H * (0.35 + r() * 0.6), th = r() * TAU, [cx, cz] = cen(y), rr = rad(y, th) * 0.9;
      P0.set(cx + Math.cos(th) * rr, y, cz + Math.sin(th) * rr);
      D.set(Math.cos(th), -0.05 + r() * 0.35, Math.sin(th)).normalize();
      const len = 0.6 + r() * 1.8, rb = 0.012 + r() * 0.022;
      limb(M, 0, P0, D, len, rb, 0.004, 3, 2, len * (0.05 + r() * 0.12), 0.75);
    }
  }
  return M.build();
}

// ---------------------------------------------------------------------------
// Liegender Stamm
// ---------------------------------------------------------------------------
/**
 * Umgestürzter Stamm entlang +x (Fuß bei x = 0, Achse in Höhe r über dem Boden): Wurzelteller (Gruppe 2: Erde, mit
 * Wurzelstümpfen) oder Bruchende am Fuß, Splitterende an der Spitze. o: { L, r0, root, seed, far }
 */
export function logGeometry(o) {
  const r = rng((o.seed || 1) * 13 + 1);
  // Stamm als stehende Leiche erzeugen und umlegen (y → x)
  const g = snagGeometry({ H: o.L, r0: o.r0, sides: o.far ? 5 : 8, step: 1.4, tip: false, charH: o.charH ?? (o.L * 0.4), charSide: r() * TAU, bend: 0.08, splinter: 0.8, stubs: o.far ? 0 : 3 + Math.floor(r() * 4), twigs: 0, seed: o.seed, far: o.far, buttress: o.root ? 0.55 : 0.25 });
  g.rotateZ(-Math.PI / 2);
  g.translate(0, o.r0 * 0.92, 0);
  if (!o.root || o.far) return g;
  // Wurzelteller: unregelmäßige Scheibe senkrecht zur Stammachse am Fuß, Vorder- und Rückseite + Rand, Wurzelstümpfe
  const M = new Mesher(3), R = o.r0 * (3.2 + r() * 1.6), n = 14, th0 = 0.18 + r() * 0.12;
  const out = [];
  for (let j = 0; j < n; j++) out.push(R * (0.55 + r() * 0.45));
  const cy = o.r0 * 0.9 + R * 0.25;
  const ring = (x, k) => out.map((rr, j) => { const a = (j / n) * TAU; return M.v(x, Math.max(-0.25, cy + Math.sin(a) * rr * k), Math.cos(a) * rr * k, Math.cos(a) * rr, Math.sin(a) * rr, 0.8); });
  const front = ring(-th0, 1), back = ring(th0 * 0.5, 0.9);
  const cf = M.v(-th0 - 0.12, cy, 0, 0, 0, 0.9), cb = M.v(th0, cy, 0, 0, 0, 0.7);
  for (let j = 0; j < n; j++) {
    const j1 = (j + 1) % n;
    M.tri(2, cf, front[j1], front[j]);
    M.tri(2, cb, back[j], back[j1]);
    M.quad(2, front[j], front[j1], back[j1], back[j]);
  }
  const P0 = new THREE.Vector3(), D = new THREE.Vector3();
  for (let k = 0; k < 9; k++) {
    const a = r() * TAU, rr = R * (0.45 + r() * 0.5);
    P0.set(-th0 * 0.5, cy + Math.sin(a) * rr, Math.cos(a) * rr);
    D.set(-0.3 - r() * 0.5, Math.sin(a) * 0.8, Math.cos(a) * 0.8).normalize();
    limb(M, 0, P0, D, 0.3 + r() * 0.9, 0.03 + r() * 0.05, 0.006, 4, 2, 0.1, 0.7);
  }
  const rg = M.build();
  return mergeGrouped([g, rg]);
}

/** Geometrien mit Gruppen zusammenführen (Gruppe k aller Teile → Gruppe k). Attribute position/uv/color. */
function mergeGrouped(list) {
  const P = [], U = [], C = [], byG = [];
  let base = 0;
  for (const g of list) {
    const pos = g.attributes.position.array, uv = g.attributes.uv.array, col = g.attributes.color.array, idx = g.index.array;
    for (let i = 0; i < pos.length; i++) P.push(pos[i]);
    for (let i = 0; i < uv.length; i++) U.push(uv[i]);
    for (let i = 0; i < col.length; i++) C.push(col[i]);
    for (const gr of g.groups) {
      const L = byG[gr.materialIndex] || (byG[gr.materialIndex] = []);
      for (let i = gr.start; i < gr.start + gr.count; i++) L.push(idx[i] + base);
    }
    base += pos.length / 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const all = [];
  let off = 0;
  for (let k = 0; k < byG.length; k++) { const L = byG[k] || []; for (const i of L) all.push(i); out.addGroup(off, L.length, k); off += L.length; }
  out.setIndex(all);
  out.computeVertexNormals();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------
/** Feste Vorlagen (deterministisch): kind, Parameter, Kollisionsradius/-höhe (Maßstab 1). */
function protoDefs() {
  const r = rng(4711), P = [];
  const add = (kind, o) => P.push({ kind, o: { ...o, seed: 101 + P.length * 37 } });
  // hohe, ausgedünnte Spieße mit Spitze (verkohlt bis weit hinauf bzw. ganz)
  for (let k = 0; k < 4; k++) add('hoch', { H: 15 + r() * 8, r0: 0.17 + r() * 0.07, tip: true, charH: k < 2 ? 40 : 5 + r() * 6, charSide: r() * TAU, lean: [(r() - 0.5) * 0.03, (r() - 0.5) * 0.03], bend: 0.2 + r() * 0.2, stubs: 7 + Math.floor(r() * 6), twigs: 4 + Math.floor(r() * 8), step: 1.1 });
  // abgebrochen (4–13 m), dick, Splitterkrone
  for (let k = 0; k < 6; k++) add('gebrochen', { H: 4 + r() * 9, r0: 0.22 + r() * 0.14, tip: false, charH: k % 3 === 2 ? 2 + r() * 3 : 40, charSide: r() * TAU, lean: [(r() - 0.5) * 0.05, (r() - 0.5) * 0.05], bend: 0.12 + r() * 0.15, splinter: 0.8 + r() * 1.8, stubs: 3 + Math.floor(r() * 5), twigs: Math.floor(r() * 3), step: 0.85 });
  // Stümpfe
  for (let k = 0; k < 3; k++) add('stumpf', { H: 0.6 + r() * 1.9, r0: 0.25 + r() * 0.17, tip: false, charH: 40, splinter: 0.4 + r() * 0.7, stubs: Math.floor(r() * 2), twigs: 0, step: 0.5, buttress: 0.55 });
  // graue Stämme (Rinde oben abgefallen, Brandnarbe unten), hoch, teils abgebrochen
  for (let k = 0; k < 3; k++) add('grau', { H: 11 + r() * 9, r0: 0.18 + r() * 0.09, tip: k !== 1, charH: 1.2 + r() * 2.5, charSide: r() * TAU, lean: [(r() - 0.5) * 0.03, (r() - 0.5) * 0.03], bend: 0.18, splinter: 1.4, stubs: 6 + Math.floor(r() * 5), twigs: 3 + Math.floor(r() * 5), step: 1.1 });
  return P;
}
function logDefs() {
  const r = rng(9001), L = [];
  for (let k = 0; k < 4; k++) L.push({ L: 5 + r() * 9, r0: 0.18 + r() * 0.16, root: k < 2, seed: 707 + k * 53 });
  return L;
}

// ---------------------------------------------------------------------------
// Totholz-Bestand
// ---------------------------------------------------------------------------
/**
 * spec: { density (Stämme je 100 m²), step (Rastermaß), clearNoise (Lichtungen 0..1), mix {hoch, gebrochen, stumpf,
 *         grau}, logs (liegende je 100 m²), groves [[x, z, r, dens]], clearings [[x, z, r]], seed }
 */
export class Deadwood {
  constructor(o) {
    this.hf = o.hf; this.spec = o.spec || {}; this.quality = o.quality; this.tier = o.tier;
    this.blocked = o.blocked || (() => false);
    this.bounds = o.bounds;
    this.group = new THREE.Group();
    this.group.name = 'totholz';
    this.protos = protoDefs();
    this.logProtos = logDefs();
    this.items = [];   // stehend: { p, x, y, z, s, ry, tx, tz }
    this.logs = [];    // liegend: { p, x, y, z, s, ry, pitch }
    this.stats = { standing: 0, logs: 0, near: 0, mid: 0, far: 0 };
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this._place();
  }

  _place() {
    const hf = this.hf, sp = this.spec, r = rng(sp.seed || 77), noise = createSimplex((sp.seed || 77) + 11);
    const n3 = { x: 0, y: 1, z: 0 };
    const mix = sp.mix || { hoch: 0.3, gebrochen: 0.35, stumpf: 0.15, grau: 0.2 };
    const kinds = Object.keys(mix), wsum = kinds.reduce((a, k) => a + mix[k], 0);
    const byKind = {};
    this.protos.forEach((p, i) => (byKind[p.kind] || (byKind[p.kind] = [])).push(i));
    const pickProto = (rr) => {
      let t = rr() * wsum;
      for (const k of kinds) { t -= mix[k]; if (t <= 0) { const L = byKind[k]; return L[Math.floor(rr() * L.length) % L.length]; } }
      return 0;
    };
    const cleared = (x, z) => (sp.clearings || []).some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr);
    const ok = (x, z) => hf.contains(x, z) && !this.blocked(x, z) && !cleared(x, z) && hf.heightAt(x, z) > hf.waterY + 0.25 && hf.normalAt(x, z, n3).y > 0.72;
    const dens0 = (sp.density ?? 1.6) / 100, step = sp.step ?? 3.2;
    const groves = sp.groves || [];
    for (let z = hf.minZ + 3; z < hf.maxZ - 3; z += step) for (let x = hf.minX + 3; x < hf.maxX - 3; x += step) {
      const jx = x + (r() - 0.5) * step * 0.95, jz = z + (r() - 0.5) * step * 0.95;
      // Lichtungen/dichtere Horste aus großräumigem Rauschen, Haine aus der Kartendefinition
      const nz = noise(jx / 70, jz / 70) * 0.6 + noise(jx / 23, jz / 23) * 0.4;
      let d = dens0 * smoothstep(-(sp.clearNoise ?? 0.45), 0.25, nz) * 1.25;
      for (const [gx, gz, gr, gd] of groves) { const t = 1 - Math.hypot(jx - gx, jz - gz) / gr; if (t > 0) d = Math.max(d, gd / 100 * smoothstep(0, 0.4, t)); }
      const pr = r(), pk = pickProto(r), s = 0.82 + r() * 0.4, ry = r() * TAU, tx = (r() - 0.5) * 0.06, tz = (r() - 0.5) * 0.06;
      if (pr > d * step * step || !ok(jx, jz)) continue;
      this.items.push({ p: pk, x: jx, y: hf.heightAt(jx, jz) - 0.08, z: jz, s, ry, tx, tz });
    }
    // liegende Stämme
    const rl = rng((sp.seed || 77) * 3 + 5), logD = (sp.logs ?? 0.25) / 100, ls = 6;
    for (let z = hf.minZ + 6; z < hf.maxZ - 6; z += ls) for (let x = hf.minX + 6; x < hf.maxX - 6; x += ls) {
      const jx = x + (rl() - 0.5) * ls, jz = z + (rl() - 0.5) * ls, pk = Math.floor(rl() * this.logProtos.length), ry = rl() * TAU, s = 0.85 + rl() * 0.3;
      if (rl() > logD * ls * ls) continue;
      const L = this.logProtos[pk].L * s, ex = jx + Math.cos(ry) * L, ez = jz - Math.sin(ry) * L;
      if (!ok(jx, jz) || !ok(ex, ez) || !ok((jx + ex) / 2, (jz + ez) / 2)) continue;
      const y0 = hf.heightAt(jx, jz), y1 = hf.heightAt(ex, ez);
      this.logs.push({ p: pk, x: jx, y: y0 - 0.12, z: jz, s, ry, pitch: Math.atan2(y1 - y0, L) });
    }
    // Matrizen
    const mk = (it, log) => {
      if (log) _e.set(0, it.ry, it.pitch, 'YXZ'); else _e.set(it.tx, it.ry, it.tz, 'YXZ');
      _q.setFromEuler(_e); _s.setScalar(it.s); _p.set(it.x, it.y, it.z);
      return _m.compose(_p, _q, _s).clone();
    };
    for (const it of this.items) it.m = mk(it, false);
    for (const it of this.logs) it.m = mk(it, true);
    this.stats.standing = this.items.length; this.stats.logs = this.logs.length;
  }

  /** Kollisions-/Kugel-Dreiecke: Sechskant-Prismen je Stamm (volle Höhe) und je liegendem Stamm (gedreht). */
  colliders() {
    const out = [], b = this.bounds, V = new THREE.Vector3();
    const prism = (m, r, y0, h, axisX) => {
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * TAU, a1 = ((k + 1) / seg) * TAU;
        const pts = axisX
          ? [[y0, Math.sin(a0) * r + r, Math.cos(a0) * r], [y0, Math.sin(a1) * r + r, Math.cos(a1) * r], [y0 + h, Math.sin(a1) * r + r, Math.cos(a1) * r], [y0 + h, Math.sin(a0) * r + r, Math.cos(a0) * r]]
          : [[Math.cos(a0) * r, y0, Math.sin(a0) * r], [Math.cos(a1) * r, y0, Math.sin(a1) * r], [Math.cos(a1) * r, y0 + h, Math.sin(a1) * r], [Math.cos(a0) * r, y0 + h, Math.sin(a0) * r]];
        const w = pts.map(([x, y, z]) => V.set(x, y, z).applyMatrix4(m).toArray());
        out.push(...w[0], ...w[1], ...w[2], ...w[0], ...w[2], ...w[3]);
      }
    };
    const inPlay = (x, z) => x > b.minX - 30 && x < b.maxX + 30 && z > b.minZ - 30 && z < b.maxZ + 30;
    for (const it of this.items) {
      if (!inPlay(it.x, it.z)) continue;
      const o = this.protos[it.p].o;
      prism(it.m, o.r0 * 1.08, -0.3, o.H + (o.tip ? 0 : (o.splinter ?? 1) * 0.4), false);
    }
    for (const it of this.logs) {
      if (!inPlay(it.x, it.z)) continue;
      const o = this.logProtos[it.p];
      prism(it.m, o.r0 * 0.95, 0, o.L, true);
    }
    const arr = new Float32Array(out);
    return { col: arr, bullet: arr };
  }

  /** Meshes anlegen: je Vorlage ein InstancedMesh nah (Gruppen → Materialliste) und eines fern. */
  build(getMaterial) {
    const q = this.quality, t = this.tier, low = q === 'low';
    const charM = getMaterial('borke_verkohlt', { vertexColors: true });
    const woodM = getMaterial('totholz', { vertexColors: true });
    const earthM = getMaterial('grabenlehm', { vertexColors: true });
    const mats = [charM, woodM, earthM];
    this._geoms = [];
    const make = (geom, mat, n, name, cast) => {
      const m = new THREE.InstancedMesh(geom, mat, Math.max(1, n));
      m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = !!cast; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    const cnt = new Array(this.protos.length).fill(0), lcnt = new Array(this.logProtos.length).fill(0);
    for (const it of this.items) cnt[it.p]++;
    for (const it of this.logs) lcnt[it.p]++;
    const nearCap = (n) => Math.min(n, NEAR_CAP[q] || 700);
    this.meshes = this.protos.map((p, i) => {
      if (!cnt[i]) return null;
      const ng = snagGeometry({ ...p.o, sides: low ? 6 : p.o.sides, twigs: low ? Math.min(2, p.o.twigs || 0) : p.o.twigs });
      const mg = snagGeometry({ ...p.o, far: 1 }), fg = snagGeometry({ ...p.o, far: 2 });
      this._geoms.push(ng, mg, fg);
      return { near: make(ng, mats, nearCap(cnt[i]), 'totholz-' + p.kind, t.treeShadow), mid: make(mg, mats, cnt[i], 'totholz-mittel', false), far: make(fg, mats, cnt[i], 'totholz-fern', false) };
    });
    // liegende Stämme: nah + mittel, darüber hinaus nicht (flach am Boden, im Dunst unsichtbar)
    this.logMeshes = this.logProtos.map((p, i) => {
      if (!lcnt[i]) return null;
      const ng = logGeometry(p), mg = logGeometry({ ...p, far: true });
      this._geoms.push(ng, mg);
      return { near: make(ng, mats, nearCap(lcnt[i]), 'totholz-liegend', t.treeShadow), mid: make(mg, mats, lcnt[i], 'totholz-liegend-fern', false), far: null };
    });
    // Instanzfarben (leichte Helligkeitsschwankung je Stamm)
    this.items.forEach((it, i) => { it.col = 0.82 + hash2(i, 3, 19) * 0.3; });
    this.logs.forEach((it, i) => { it.col = 0.8 + hash2(i, 5, 23) * 0.3; });
    return this.group;
  }

  /** Nah/Fern neu verteilen, wenn sich die Kamera ≥ 4 m bewegt hat. */
  update(camera, force = false) {
    const p = camera.position;
    if (!force && this._last.distanceToSquared(p) < 16) return;
    this._last.copy(p);
    const [dn, dm, df] = DEAD_LOD[this.quality] || DEAD_LOD.high;
    const near2 = dn * dn, mid2 = dm * dm, far2 = df * df;
    let nn = 0, nm = 0, nf = 0;
    const fill = (list, meshes) => {
      const cN = meshes.map(() => 0), cM = meshes.map(() => 0), cF = meshes.map(() => 0);
      for (const it of list) {
        const M = meshes[it.p];
        if (!M) continue;
        const dx = it.x - p.x, dz = it.z - p.z, d2 = dx * dx + dz * dz;
        let mesh, k;
        if (d2 < near2 && cN[it.p] < M.near.instanceMatrix.count) { mesh = M.near; k = cN[it.p]++; }
        else if (d2 < mid2) { mesh = M.mid; k = cM[it.p]++; }
        else if (d2 < far2 && M.far) { mesh = M.far; k = cF[it.p]++; }
        else continue;
        it.m.toArray(mesh.instanceMatrix.array, k * 16);
        mesh.instanceColor.array[k * 3] = mesh.instanceColor.array[k * 3 + 1] = mesh.instanceColor.array[k * 3 + 2] = it.col;
      }
      meshes.forEach((M, i) => {
        if (!M) return;
        for (const [mesh, c] of [[M.near, cN[i]], [M.mid, cM[i]], [M.far, cF[i]]]) {
          if (!mesh) continue;
          mesh.count = c; mesh.visible = c > 0;
          if (c) { mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, c * 16); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, c * 3); mesh.instanceColor.needsUpdate = true; }
        }
        nn += cN[i]; nm += cM[i]; nf += cF[i];
      });
    };
    fill(this.items, this.meshes);
    fill(this.logs, this.logMeshes);
    this.stats.near = nn; this.stats.mid = nm; this.stats.far = nf;
  }

  dispose() {
    for (const g of this._geoms || []) g.dispose();
    this.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
}
