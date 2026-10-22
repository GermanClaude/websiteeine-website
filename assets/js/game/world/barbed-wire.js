// NULLPUNKT — Stacheldraht (22.10., eigene Geometrie und Textur) (Owner: world).
// Ein Drahtstrang besteht aus Modulen von 0,45 m: zwei verdrillte Litzen (5 Schläge je Modul) und vier Stachelknoten
// (je zwei umgewickelte Drähte mit vier Spitzen, alle 11 cm, jeder Knoten anders gedreht). Zwei Stufen nach Abstand:
// nah echte Geometrie (Rost/Zink-Material 'draht' aus texgen), sonst zwei gekreuzte Streifen mit einem selbst
// gezeichneten Drahtbild (Canvas, Alphatest) – kostet 4 Dreiecke je Modul, daher auch auf dem Handy überall.
// Zäune (Pfosten + durchhängende Stränge) und Drahtrollen (Spiralen) setzen sich aus Strängen zusammen.
// Nur Optik: keine Kollision, Kugeln gehen durch.
import * as THREE from 'three';
import { getMaterial } from '../engine/textures.js';
import { addShaderPatch } from './shading.js';

export const MOD = 0.45;            // Modullänge (m)
const PITCH = MOD / 5;              // Schlaglänge der Verdrillung
const BARBS = 4;                    // Stachelknoten je Modul
const W = 0.056;                    // Breite der Fernstreifen (Spitzen ± 2,5 cm)
const RW = 0.0016, OFF = 0.0016;    // Litzenradius, Abstand der Litzen von der Achse (leicht übertrieben: sonst unsichtbar)
/** Nahstufe: Radius je Stufe (m) und Obergrenze der Nahmodule. */
const NEAR = { low: 0, medium: 6, high: 11, ultra: 15 };
const NEAR_CAP = { low: 0, medium: 500, high: 1400, ultra: 2200 };
/** Fernstufe: Blockgröße (m) und Sichtweite der Blöcke je Stufe (m). */
const CH = 32;
const FAR = { low: 90, medium: 120, high: 160, ultra: 200 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0), _d = new THREE.Vector3(), _qr = new THREE.Quaternion();

// Lage der Stachelknoten im Modul (gleich in Geometrie und Fernbild): Abstand, Drehung, Spitzenrichtungen
const KNOTS = Array.from({ length: BARBS }, (_, k) => ({ x: (k + 0.5) * (MOD / BARBS), rot: [0.3, 1.9, 0.9, 2.6][k] }));
function spikesOf(knot) {
  // zwei Drähte → vier Spitzen, grob über Kreuz, leicht entlang der Litze geneigt
  return [0, 1, 2, 3].map((j) => {
    const th = knot.rot + j * Math.PI / 2 + (j % 2 ? 0.18 : -0.12);
    const ax = (j < 2 ? 1 : -1) * (0.22 + 0.1 * (j % 2));
    const len = 0.017 + 0.004 * ((j * 7 + knot.rot * 10) % 3) / 2;
    const d = new THREE.Vector3(ax, Math.cos(th), Math.sin(th)).normalize();
    return { d, len };
  });
}

/** Nahgeometrie eines Moduls entlang +x (0 … MOD). steps: Stützpunkte je Schlag. */
function moduleGeometry(steps) {
  const P = [], N = [], U = [], I = [], A = [];
  const tube = (pts, r, sides, u0) => {
    // pts: Mittellinie; Ring je Punkt (Normale aus Tangente), Mantel ohne Deckel
    const base = P.length / 3;
    const t = new THREE.Vector3(), a = new THREE.Vector3(), c = new THREE.Vector3(), up = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      t.subVectors(q, o).normalize();
      up.set(0, 1, 0); if (Math.abs(t.y) > 0.9) up.set(1, 0, 0);
      a.crossVectors(t, up).normalize(); c.crossVectors(a, t).normalize();
      const rr = typeof r === 'function' ? r(i / (pts.length - 1)) : r;
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = a.x * ca + c.x * sa, ny = a.y * ca + c.y * sa, nz = a.z * ca + c.z * sa;
        P.push(p.x + nx * rr, p.y + ny * rr, p.z + nz * rr); N.push(nx, ny, nz); A.push(rr);
        U.push(u0 + p.x, k / sides);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides, a0 = base + i * sides + k, a1 = base + i * sides + k1, b0 = a0 + sides, b1 = a1 + sides;
      I.push(a0, b0, a1, a1, b0, b1);
    }
  };
  // zwei Litzen (Phase 0 / π), Schläge exakt periodisch → Module schließen nahtlos an
  const n = Math.round((MOD / PITCH) * steps);
  for (const ph of [0, Math.PI]) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * MOD, a = (x / PITCH) * Math.PI * 2 + ph;
      pts.push(new THREE.Vector3(x, Math.cos(a) * OFF, Math.sin(a) * OFF));
    }
    tube(pts, RW, 3, 0);
  }
  // Stachelknoten: Wicklung (kurzer, dickerer Ring) + vier spitz zulaufende Drähte
  for (const kn of KNOTS) {
    tube([new THREE.Vector3(kn.x - 0.005, 0, 0), new THREE.Vector3(kn.x + 0.005, 0, 0)], OFF + RW * 1.9, 5, 0);
    for (const { d, len } of spikesOf(kn)) {
      const p0 = new THREE.Vector3(kn.x, 0, 0).addScaledVector(d, OFF), p1 = p0.clone().addScaledVector(d, len * 0.6), p2 = p0.clone().addScaledVector(d, len);
      tube([p0, p1, p2], (t) => 0.0012 * (1 - t * 0.92), 3, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(A, 1));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

/** Fernstufe: zwei gekreuzte Streifen (senkrecht + waagerecht) der Breite W über die Modullänge. */
function cardGeometry() {
  const h = W / 2;
  const P = [0, -h, 0, MOD, -h, 0, MOD, h, 0, 0, h, 0, 0, 0, -h, MOD, 0, -h, MOD, 0, h, 0, 0, h];
  const N = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const U = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  g.computeBoundingSphere();
  return g;
}

let CARD_TEX = null;
/**
 * Drahtbild für die Fernstufe (ein Modul, 1024 × 128 und alle Mip-Stufen einzeln gezeichnet): Litzen hinten/vorn,
 * Glanzkante, Stachelknoten, Rostflecken. In kleinen Stufen bleibt der Draht eine deckende Linie von ≥ 1 Pixel –
 * automatisch erzeugte Mipmaps mitteln dünne Linien weg (Alphatest verwirft sie dann, der Draht verschwindet).
 */
function drawCard(Wpx, Hpx) {
  // OffscreenCanvas ohne 2D-Kontext (ältere Safari-/WebView-Versionen) → normales Canvas (21.10.)
  let cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Wpx, Hpx) : null;
  let g = cv ? cv.getContext('2d') : null;
  if (!g) { cv = Object.assign(document.createElement('canvas'), { width: Wpx, height: Hpx }); g = cv.getContext('2d'); }
  g.clearRect(0, 0, Wpx, Hpx);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const k = Wpx / MOD, kv = Hpx / W, cy = Hpx / 2;
  // Farbe entlang der Litze: verzinkt grau ↔ Rost (weiche Wellen, periodisch über das Modul)
  const rust = (x) => 0.5 + 0.5 * Math.sin((x / Wpx) * Math.PI * 2 * 3 + 1.3) * Math.sin((x / Wpx) * Math.PI * 2 * 2 + 0.4);
  const col = (x, light) => {
    const t = rust(x), zn = [104, 104, 100], ru = [92, 58, 36], c = zn.map((v, i) => v + (ru[i] - v) * t * 0.6);
    return `rgb(${c.map((v) => Math.min(255, Math.round(v * light))).join(',')})`;
  };
  if (Hpx < 8) {
    // winzige Stufen: eine deckende Mittellinie (Durchschnittsfarbe)
    g.fillStyle = col(Wpx * 0.3, 0.8);
    g.fillRect(0, Math.floor(cy - 0.5), Wpx, Math.max(1, Math.round(Hpx / 8)));
    if (Hpx < 2) g.fillRect(0, 0, Wpx, 1);
    return cv;
  }
  const rw = Math.max(0.6, RW * kv), off = OFF * kv, step = Math.max(1, Math.round(2 * Wpx / 1024));
  const strand = (ph, front) => {
    for (let x = 0; x < Wpx; x += step) {
      const a0 = (x / k / PITCH) * Math.PI * 2 + ph, a1 = ((x + step) / k / PITCH) * Math.PI * 2 + ph;
      if ((Math.sin(a0) > 0) !== front) continue;
      g.strokeStyle = col(x, front ? 0.95 : 0.55); g.lineWidth = Math.max(1.2, rw * 2 + 1.2 * Hpx / 128);
      g.beginPath(); g.moveTo(x, cy + Math.cos(a0) * off); g.lineTo(x + step, cy + Math.cos(a1) * off); g.stroke();
    }
  };
  strand(0, false); strand(Math.PI, false);
  strand(0, true); strand(Math.PI, true);
  if (Hpx >= 32) {
    // Glanzkante auf den vorderen Abschnitten
    g.globalAlpha = 0.55; g.lineWidth = Math.max(0.8, 1.1 * Hpx / 128);
    for (const ph of [0, Math.PI]) for (let x = 0; x < Wpx; x += step) {
      const a0 = (x / k / PITCH) * Math.PI * 2 + ph, a1 = ((x + step) / k / PITCH) * Math.PI * 2 + ph;
      if (Math.sin(a0) <= 0.3) continue;
      g.strokeStyle = col(x, 1.45);
      g.beginPath(); g.moveTo(x, cy + Math.cos(a0) * off - rw * 0.5); g.lineTo(x + step, cy + Math.cos(a1) * off - rw * 0.5); g.stroke();
    }
    g.globalAlpha = 1;
  }
  if (Hpx >= 16) {
    // Stachelknoten: Spitzen als schmale Dreiecke (Seitenansicht der 3-D-Richtung), darüber die Wicklung
    for (const kn of KNOTS) {
      const x0 = kn.x * k;
      for (const { d, len } of spikesOf(kn)) {
        const tx = x0 + d.x * (len + OFF) * k, ty = cy - d.y * (len + OFF) * kv; // Bild-y nach unten
        const nx = -(ty - cy), ny = tx - x0, nl = Math.hypot(nx, ny) || 1, bw = Math.max(0.7, 2.1 * Hpx / 128);
        g.fillStyle = col(x0, 0.6 + 0.35 * Math.max(0, d.z));
        g.beginPath(); g.moveTo(x0 + (nx / nl) * bw, cy + (ny / nl) * bw); g.lineTo(tx, ty); g.lineTo(x0 - (nx / nl) * bw, cy - (ny / nl) * bw); g.closePath(); g.fill();
      }
      g.fillStyle = col(x0 + 30, 0.62);
      g.beginPath(); g.ellipse(x0, cy, Math.max(1, 0.006 * k), Math.max(1, (OFF + RW * 2) * kv), 0, 0, Math.PI * 2); g.fill();
      if (Hpx >= 64) {
        g.strokeStyle = col(x0 + 60, 1.0); g.lineWidth = 1.2;
        for (let j = -1; j <= 1; j++) { g.beginPath(); g.moveTo(x0 + j * 4 - 2, cy - (OFF + RW * 2) * kv); g.lineTo(x0 + j * 4 + 2, cy + (OFF + RW * 2) * kv); g.stroke(); }
      }
    }
  }
  return cv;
}

function cardTexture() {
  if (CARD_TEX) return CARD_TEX;
  const levels = [];
  for (let w = 1024, h = 128; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) { levels.push(drawCard(w, h)); if (w === 1 && h === 1) break; }
  const tex = new THREE.CanvasTexture(levels[0]);
  tex.mipmaps = levels;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  CARD_TEX = tex;
  return tex;
}

// Mindestbreite in Bildpunkten: Pixelgröße in 1 m Abstand (je Bild aus Kamera/Fenster), gemeinsam für alle Drähte
const PX = { value: 0.0016 };
/** Nahdraht: Röhren nie dünner als ≈ 1 Pixel (aR = Röhrenradius je Punkt; objectNormal zeigt nach außen). */
function nearPatch(shader) {
  shader.uniforms.uWirePx = PX;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uWirePx;\nattribute float aR;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    #ifdef USE_INSTANCING
    vec4 npWp = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
    #else
    vec4 npWp = modelMatrix * vec4( transformed, 1.0 );
    #endif
    float npMin = uWirePx * length( npWp.xyz - cameraPosition ) * 0.6;
    transformed += objectNormal * max( 0.0, npMin - aR );
  }`);
}
/** Fernstreifen: Breite wächst mit dem Abstand, sodass der Draht im Bild ≥ 1 Pixel bleibt (Mip-Stufen tragen die Linie). */
function cardPatch(shader) {
  shader.uniforms.uWirePx = PX;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uWirePx;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    vec4 npWp = modelMatrix * instanceMatrix * vec4( transformed.x, 0.0, 0.0, 1.0 );
    float npS = max( 1.0, uWirePx * length( npWp.xyz - cameraPosition ) * ${(14 / W).toFixed(1)} );
    transformed.yz *= npS;
  }`);
}

export class BarbedWire {
  /** quality: 'low'|'medium'|'high'|'ultra'; seed: Drehung/Tönung der Module. */
  constructor({ quality = 'high', seed = 1 } = {}) {
    this.quality = quality;
    this.segs = []; // { m, x, z, col, coil, chunk, slot }
    this.group = new THREE.Group();
    this.group.name = 'stacheldraht';
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    let s = (seed * 7919 + 13) >>> 0;
    this.rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.stats = { modules: 0, near: 0 };
  }

  /** Strang entlang der Punktfolge [[x,y,z], …] (in Modullängen zerlegt). o: { coil, tone } */
  addPath(pts, o = {}) {
    const r = this.rnd;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
      if (len < 0.02) continue;
      const n = Math.max(1, Math.round(len / MOD));
      _d.set(dx / len, dy / len, dz / len);
      _q.setFromUnitVectors(_x, _d);
      for (let k = 0; k < n; k++) {
        const t = k / n, L = len / n;
        _qr.setFromAxisAngle(_x, r() * Math.PI * 2); // jedes Modul um die eigene Achse gedreht
        _p.set(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t);
        _s.set(L / MOD, 1, 1);
        const m = new THREE.Matrix4().compose(_p, _q.clone().multiply(_qr), _s);
        const tone = (o.tone ?? 1) * (0.78 + r() * 0.3);
        this.segs.push({ m, x: _p.x + dx * 0.5 / n, z: _p.z + dz * 0.5 / n, col: tone, coil: !!o.coil });
      }
    }
  }

  /** Durchhängender Strang zwischen zwei Punkten (Kettenlinien-Näherung, sag in m). */
  addSpan(p, q, sag = 0.05, o = {}) {
    const len = Math.hypot(q[0] - p[0], q[2] - p[2]);
    const n = Math.max(2, Math.round(len / 0.9));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t - sag * 4 * t * (1 - t), p[2] + (q[2] - p[2]) * t]);
    }
    this.addPath(pts, o);
  }

  /**
   * Drahtrolle (Spirale) entlang der Achse axis [[x, z], …] am Boden: Radius r, Windungsabstand pitch,
   * ground(x, z) → Bodenhöhe. Die Windungen sind leicht flachgedrückt und unregelmäßig (verbogen, eingesunken).
   */
  addCoil(axis, ground, o = {}) {
    const r0 = o.r ?? 0.42, pitch = o.pitch ?? 0.5, r = this.rnd;
    const cum = [0];
    for (let i = 1; i < axis.length; i++) cum.push(cum[i - 1] + Math.hypot(axis[i][0] - axis[i - 1][0], axis[i][1] - axis[i - 1][1]));
    const len = cum[cum.length - 1];
    if (len < 0.5) return;
    const at = (s) => {
      let i = 1; while (i < axis.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), a = axis[i - 1], b = axis[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return [a[0] + dx * t, a[1] + dz * t, dx / l, dz / l];
    };
    const per = 10, N = Math.round((len / pitch) * per);
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const ph = (i / per) * Math.PI * 2;
      const [cx, cz, ux, uz] = at(Math.min(len, Math.max(0, (i / N) * len + Math.sin(ph) * 0.04)));
      const nx = -uz, nz = ux, g = ground(cx, cz);
      const rr = r0 * (1 + (r() - 0.5) * 0.12), sq = 0.85; // etwas flachgedrückt
      pts.push([cx + nx * Math.cos(ph) * rr, g + rr * sq + Math.sin(ph) * rr * sq - 0.04, cz + nz * Math.cos(ph) * rr]);
    }
    this.addPath(pts, { ...o, coil: true, tone: (o.tone ?? 1) * 0.8 });
  }

  build() {
    const q = this.quality, n = this.segs.length;
    const cardMat = new THREE.MeshStandardMaterial({ map: cardTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, metalness: 0.3, name: 'stacheldraht-fern' });
    cardMat.userData.surface = 'metal';
    addShaderPatch(cardMat, 'drahtpx', cardPatch);
    const cardGeo = cardGeometry();
    // Fernstufe in Blöcken (CH × CH m): eigener Sichtkegel-Ausschluss, fern ausgeblendet; Matrizen bleiben liegen,
    // nur Module in der Nahstufe werden im Block auf Größe 0 gesetzt (kleiner Aktualisierungsbereich)
    const byCell = new Map();
    this.segs.forEach((sg, i) => {
      const key = Math.floor(sg.x / CH) + ',' + Math.floor(sg.z / CH);
      let c = byCell.get(key);
      if (!c) byCell.set(key, (c = { idx: [], cx: (Math.floor(sg.x / CH) + 0.5) * CH, cz: (Math.floor(sg.z / CH) + 0.5) * CH }));
      c.idx.push(i);
    });
    this.chunks = [];
    for (const c of byCell.values()) {
      const m = new THREE.InstancedMesh(cardGeo, cardMat, c.idx.length);
      m.name = 'stacheldraht-fern'; m.castShadow = false; m.receiveShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c.idx.length * 3), 3);
      c.idx.forEach((si, k) => {
        const sg = this.segs[si];
        sg.chunk = c; sg.slot = k;
        sg.m.toArray(m.instanceMatrix.array, k * 16);
        m.instanceColor.array[k * 3] = sg.col; m.instanceColor.array[k * 3 + 1] = sg.col * 0.97; m.instanceColor.array[k * 3 + 2] = sg.col * 0.94;
      });
      m.computeBoundingSphere();
      m.frustumCulled = true;
      c.mesh = m; c.lo = Infinity; c.hi = -1;
      this.group.add(m);
      this.chunks.push(c);
    }
    const cap = Math.min(n, NEAR_CAP[q] ?? 0);
    if (cap) {
      const m = new THREE.InstancedMesh(moduleGeometry(q === 'medium' ? 4 : 6), cardMat, cap); // Material folgt (setNearMaterial)
      m.name = 'stacheldraht-nah'; m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.visible = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      this.near = m;
    }
    this._nearSet = new Set();
    this.stats.modules = n; this.stats.chunks = this.chunks.length;
    return this.group;
  }

  /** Nahmaterial nachreichen (Rost/Zink 'draht' aus engine/textures.js). */
  setNearMaterial(mat) { if (this.near) { addShaderPatch(mat, 'drahtpx', nearPatch); this.near.material = mat; this._nearReady = true; } }

  update(camera, force = false) {
    const p = camera.position;
    if (!this.chunks) return;
    if (camera.isPerspectiveCamera) PX.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(240, globalThis.innerHeight || 720);
    // Blöcke fern ausblenden (jedes Bild billig: wenige Dutzend Blöcke)
    const far = FAR[this.quality] ?? 140, f2 = (far + CH) * (far + CH);
    for (const c of this.chunks) { const dx = c.cx - p.x, dz = c.cz - p.z; c.mesh.visible = dx * dx + dz * dz < f2; }
    if (!force && this._last.distanceToSquared(p) < 2.25) return;
    this._last.copy(p);
    const near = this.near && this._nearReady ? this.near : null;
    if (!near) return;
    const R = NEAR[this.quality] ?? 0, R2 = R * R, Rc2 = (R * 0.6) * (R * 0.6), cap = near.instanceMatrix.count;
    // Kandidaten nur aus Blöcken in Reichweite
    const next = new Set();
    for (const c of this.chunks) {
      const dx = c.cx - p.x, dz = c.cz - p.z, lim = R + CH * 0.71;
      if (dx * dx + dz * dz > lim * lim) continue;
      for (const si of c.idx) {
        if (next.size >= cap) break;
        const sg = this.segs[si], ex = sg.x - p.x, ez = sg.z - p.z, d2 = ex * ex + ez * ez;
        if (d2 < (sg.coil ? Rc2 : R2)) next.add(si);
      }
    }
    // Fernstreifen der Nahmodule ausblenden bzw. zurückholen (nur geänderte Stellen hochladen)
    const touch = (sg, on) => {
      const c = sg.chunk, a = c.mesh.instanceMatrix.array, o = sg.slot * 16;
      if (on) sg.m.toArray(a, o); else for (let i = 0; i < 16; i++) a[o + i] = 0;
      if (sg.slot < c.lo) c.lo = sg.slot;
      if (sg.slot > c.hi) c.hi = sg.slot;
    };
    for (const si of this._nearSet) if (!next.has(si)) touch(this.segs[si], true);
    for (const si of next) if (!this._nearSet.has(si)) touch(this.segs[si], false);
    for (const c of this.chunks) if (c.hi >= 0) {
      const im = c.mesh.instanceMatrix;
      im.clearUpdateRanges(); im.addUpdateRange(c.lo * 16, (c.hi - c.lo + 1) * 16); im.needsUpdate = true;
      c.lo = Infinity; c.hi = -1;
    }
    this._nearSet = next;
    // Nahmodule schreiben
    let k = 0;
    const ma = near.instanceMatrix.array, ca = near.instanceColor.array;
    for (const si of next) {
      const sg = this.segs[si];
      sg.m.toArray(ma, k * 16);
      ca[k * 3] = sg.col; ca[k * 3 + 1] = sg.col * 0.97; ca[k * 3 + 2] = sg.col * 0.94;
      k++;
    }
    near.count = k; near.visible = k > 0;
    if (k) {
      near.instanceMatrix.clearUpdateRanges(); near.instanceMatrix.addUpdateRange(0, k * 16); near.instanceMatrix.needsUpdate = true;
      near.instanceColor.clearUpdateRanges(); near.instanceColor.addUpdateRange(0, k * 3); near.instanceColor.needsUpdate = true;
    }
    this.stats.near = k;
  }

  dispose() { this.group.traverse((o) => { if (o.isInstancedMesh) { o.geometry.dispose(); o.dispose(); } }); }
}

/**
 * Stacheldraht eines MapBuilders (einer je Builder, beim ersten Aufruf angelegt). Gebaut wird kurz vor dem Aufbau des
 * Builders (b.beforeBuild), damit Welt-Schattierung/Nebel die Materialien mit erfassen; danach Abstandsstufen je Bild.
 */
export function barbedWireOf(b) {
  if (b._barbed) return b._barbed;
  const w = new BarbedWire({ quality: b.lookQuality || 'high', seed: 4711 });
  b._barbed = w;
  const holder = new THREE.Group();
  holder.name = 'stacheldraht-halter';
  (b.beforeBuild ||= []).push(() => {
    if (!w.segs.length) return;
    holder.add(w.build());
    w.setNearMaterial(getMaterial('draht', {}));
  });
  b.object(holder, { update: (dt, cam) => cam && w.update(cam) });
  return w;
}

/**
 * Stacheldrahtzaun: Pfosten an posts [[x, y, z], …] (y = Boden), Stränge in den Höhen hs, dazu (o.cross) zwei
 * Schrägstränge je Feld; Gassen bleiben offen, wenn o.gap(i) für das Feld i true liefert. Pfosten aus Holz
 * (o.post 'wood') oder Eisen-Schraubpfähle ('iron'). → Anzahl Felder
 */
export function wireFence(b, posts, o = {}) {
  const w = barbedWireOf(b), r = w.rnd;
  const hs = o.heights || [0.3, 0.7, 1.1];
  const top = hs[hs.length - 1] + 0.12;
  for (let i = 0; i < posts.length; i++) {
    const [x, y, z] = posts[i];
    const lean = (r() - 0.5) * 0.22;
    if (o.post === 'iron') {
      b.cyl(x, y - 0.25, z, 0.016, top + 0.3, 'metal_rust', { tint: '#4a3a30', collide: false, minimap: false, seg: 5, rz: lean, bullet: false });
      b.cyl(x, y + top - 0.05, z, 0.045, 0.02, 'metal_rust', { tint: '#4a3a30', collide: false, minimap: false, seg: 6, bullet: false });
    } else b.cyl(x, y - 0.15, z, 0.035, top + 0.2, 'wood_dark', { tint: o.postTint || '#2f2a25', collide: false, minimap: false, seg: 5, rz: lean, bullet: false });
  }
  let fields = 0;
  for (let i = 0; i < posts.length - 1; i++) {
    if (o.gap && o.gap(i)) continue;
    const [x0, y0, z0] = posts[i], [x1, y1, z1] = posts[i + 1];
    fields++;
    const loose = r() < 0.15; // einzelne Felder hängen durch (zerschossen)
    for (const h of hs) w.addSpan([x0, y0 + h, z0], [x1, y1 + h - (loose ? 0.25 : 0), z1], loose ? 0.35 : 0.04 + r() * 0.04, { tone: o.tone });
    if (o.cross !== false) {
      w.addSpan([x0, y0 + hs[hs.length - 1], z0], [x1, y1 + hs[0], z1], 0.06, { tone: o.tone });
      w.addSpan([x0, y0 + hs[0], z0], [x1, y1 + hs[hs.length - 1], z1], 0.06, { tone: o.tone });
    }
  }
  return fields;
}
