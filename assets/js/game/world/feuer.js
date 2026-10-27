// NULLPUNKT — Feuer als Daumenkino (26.10., Etappe K0 „Sofort-Fehler“ W1) (Owner: world).
//
// Vorher: drei additive Kegel (ConeGeometry) über der Feuertonne – sie lasen sich als gelbe Papierspitzen. Jetzt:
// ein selbst gezeichneter Flammen-Atlas (14 Bilder einer nahtlos laufenden Flamme aus verschobenem Rauschen, dazu
// eine Funken- und eine Rauchzelle; Canvas, deterministisch, nach Kontextverlust neu gezeichnet) auf zur Kamera
// gedrehten Vierecken: drei Flammenzungen (je zwei überblendete Nachbarbilder → kein Ruckeln), Funkenflug und eine
// dünne Rauchsäule (ab „mittel“). Zwei Draw Calls je Feuer (additiv + Rauch), ein Programm (MeshBasicMaterial mit
// Textur und Vertexfarbe), das das Vorkompilieren der Welt (main.js, ganze Szene) mit abdeckt. Ferner als 70 m:
// unsichtbar, keine Rechenarbeit. Rein optisch: keine Kollision, kein Kartenzufall.
//
// createFire(b, x, y, z, o) → hängt das Feuer als animiertes Objekt an den MapBuilder (b.object).
//   o: { scale (1), seed, smoke (true ab „mittel“) }; y = Unterkante der Flammen (Glutbett)
import * as THREE from 'three';
import { atlasTexture, atlasScale } from './atlas.js';

const COLS = 8, ROWS = 2, FRAMES = 14, SPARK = 14, SMOKE = 15; // Zellen im Atlas (8 × 2, je 128 × 256 px)
const FPS = 16;
const FAR = 70;

// ---------------------------------------------------------------------------
// Atlas
// ---------------------------------------------------------------------------
function hashI(i, j, k) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Wertrauschen 2D, in x periodisch mit px (Zellen), glatt interpoliert. */
function vnoise(x, y, px, k) {
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const w = (a) => ((a % px) + px) % px;
  const a = hashI(w(i), j, k), b = hashI(w(i + 1), j, k), c = hashI(w(i), j + 1, k), d = hashI(w(i + 1), j + 1, k);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function fbm(x, y, k) { return vnoise(x, y, 64, k) * 0.55 + vnoise(x * 2.1, y * 2.1, 128, k + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, 256, k + 13) * 0.15; }
const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Farbverlauf einer Flamme nach Intensität 0…1 (dunkelrot → orange → gelb → helles Kerngelb). */
function ramp(I) {
  const st = [[0, 0.35, 0.03, 0], [0.3, 0.85, 0.22, 0.02], [0.55, 1, 0.5, 0.1], [0.8, 1, 0.78, 0.35], [1, 1, 0.95, 0.75]];
  for (let k = 1; k < st.length; k++) {
    if (I <= st[k][0]) {
      const a = st[k - 1], b = st[k], t = (I - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return st[st.length - 1].slice(1);
}

function drawFireAtlas(ctx, W, H) {
  const cw = W / COLS, ch = H / ROWS;
  const img = ctx.createImageData(W, H), D = img.data;
  const put = (cell, fn) => {
    const ox = (cell % COLS) * cw, oy = Math.floor(cell / COLS) * ch;
    for (let py = 0; py < ch; py++) for (let px = 0; px < cw; px++) {
      const u = (px + 0.5) / cw - 0.5, v = 1 - (py + 0.5) / ch; // u quer (−0,5…0,5), v von unten (0…1)
      const c = fn(u, v);
      const o = ((oy + py) * W + ox + px) * 4;
      D[o] = c[0] * 255; D[o + 1] = c[1] * 255; D[o + 2] = c[2] * 255; D[o + 3] = c[3] * 255;
    }
  };
  // Flammen: Rauschen steigt nach oben; nahtlose Schleife durch Überblenden zweier um eine Periode versetzter Felder
  for (let f = 0; f < FRAMES; f++) {
    const t = f / FRAMES;
    put(f, (u, v) => {
      const field = (s, k) => {
        const y = v * 3.2 - s * 2.6;
        return fbm(u * 3 + 8, y, k);
      };
      const n1 = field(t, 1) * (1 - t) + field(t - 1, 1) * t;
      const n2 = field(t * 1.3, 5) * (1 - t) + field(t * 1.3 - 1.3, 5) * t;
      // seitliches Flackern nimmt nach oben zu; Körper verjüngt sich, Zungen reißen oben ab
      const uu = u + (n1 - 0.5) * 0.42 * (0.25 + v);
      const wv = 0.36 * Math.pow(Math.max(0, 1 - v), 0.55) * (0.55 + 0.45 * sstep(0, 0.14, v));
      const body = 1 - sstep(wv * 0.35, wv, Math.abs(uu));
      const top = 1 - sstep(0.42, 0.98, v + (n2 - 0.5) * 0.55);
      const base = sstep(0, 0.06, v);
      let I = Math.max(0, body * top * base * (0.75 + n2 * 0.5));
      I = Math.min(1, I * (1.15 - v * 0.35));
      const c = ramp(I);
      return [c[0], c[1], c[2], Math.min(1, I * 1.25)];
    });
  }
  // Funke: kleiner heller Punkt mit weichem Hof
  put(SPARK, (u, v) => {
    const r = Math.hypot(u * 2, (v - 0.5) * 1);
    const I = Math.max(0, 1 - sstep(0.02, 0.5, r));
    return [1, 0.82, 0.45, I];
  });
  // Rauch: weiche, unregelmäßige graue Wolke (Alpha), normal überblendet
  put(SMOKE, (u, v) => {
    const r = Math.hypot(u * 2, (v - 0.5) * 1.6);
    const n = fbm(u * 3 + 30, v * 2.4, 21);
    const a = Math.max(0, 1 - sstep(0.25, 0.95, r + (n - 0.5) * 0.5)) * 0.85;
    const g = 0.36 + n * 0.12;
    return [g, g * 0.97, g * 0.94, a];
  });
  ctx.putImageData(img, 0, 0);
}

const atlases = new Map();
function fireAtlas(quality) {
  const s = atlasScale(quality), key = s;
  let t = atlases.get(key);
  if (!t) {
    t = atlasTexture(Math.round(1024 * s), Math.round(512 * s), (ctx, w, h) => drawFireAtlas(ctx, w, h), { anisotropy: 1, name: 'feuer' });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    atlases.set(key, t);
  }
  return t;
}

/** Diagnose (Prüfseiten): Atlas der Stufe zeichnen lassen und als Canvas zurückgeben. */
export function fireAtlasCanvas(quality = 'high') {
  const s = atlasScale(quality), W = Math.round(1024 * s), H = Math.round(512 * s);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  drawFireAtlas(cv.getContext('2d'), W, H);
  return cv;
}

// ---------------------------------------------------------------------------
// Feuer
// ---------------------------------------------------------------------------
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _hr = new THREE.Vector3();

/** Vierecks-Puffer: n Vierecke mit Position, UV, Farbe (RGBA). */
function quadBuffer(n) {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 12), 3).setUsage(THREE.DynamicDrawUsage);
  const uv = new THREE.BufferAttribute(new Float32Array(n * 8), 2).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.BufferAttribute(new Float32Array(n * 16), 4).setUsage(THREE.DynamicDrawUsage);
  const idx = [];
  for (let i = 0; i < n; i++) { const o = i * 4; idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
  g.setIndex(idx);
  g.setAttribute('position', pos); g.setAttribute('uv', uv); g.setAttribute('color', col);
  return g;
}

/**
 * Viereck k schreiben: Mitte unten (cx, cy, cz), Breite w entlang rx/rz (waagrecht) bzw. R, Höhe h entlang U,
 * Atlaszelle cell, Farbe (r, g, b, a). center: Mitte statt Unterkante.
 */
function writeQuad(g, k, cx, cy, cz, R, U, w, h, cell, r, gg, bb, a, center) {
  const P = g.attributes.position.array, T = g.attributes.uv.array, C = g.attributes.color.array;
  const hw = w / 2, y0 = center ? -h / 2 : 0, y1 = center ? h / 2 : h;
  const cu = (cell % COLS) / COLS, cv = 1 - (Math.floor(cell / COLS) + 1) / ROWS, du = 1 / COLS, dv = 1 / ROWS;
  const pts = [[-hw, y0, cu + du * 0.01, cv + dv * 0.005], [hw, y0, cu + du * 0.99, cv + dv * 0.005], [hw, y1, cu + du * 0.99, cv + dv * 0.995], [-hw, y1, cu + du * 0.01, cv + dv * 0.995]];
  for (let i = 0; i < 4; i++) {
    const [s, t, uu, vv] = pts[i], o = (k * 4 + i);
    P[o * 3] = cx + R.x * s + U.x * t; P[o * 3 + 1] = cy + R.y * s + U.y * t; P[o * 3 + 2] = cz + R.z * s + U.z * t;
    T[o * 2] = uu; T[o * 2 + 1] = vv;
    C[o * 4] = r; C[o * 4 + 1] = gg; C[o * 4 + 2] = bb; C[o * 4 + 3] = a;
  }
}

export function createFire(b, x, y, z, o = {}) {
  const q = b.quality || b.lookQuality || 'high', low = q === 'low';
  const sc = o.scale ?? 1, smokeOn = (o.smoke ?? true) && !low;
  const tex = fireAtlas(q);
  const NF = 3, NS = low ? 5 : 10, NR = smokeOn ? 7 : 0;
  // Flammen (je zwei Bilder überblendet) + Funken: additiv, ohne Tiefe schreiben, ohne Nebel (Feuer leuchtet durch)
  const gF = quadBuffer(NF * 2 + NS);
  const matF = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
  matF.color.setRGB(1.9, 1.75, 1.6);
  matF.userData.disposable = true; matF.userData.noWorldShading = true;
  const meshF = new THREE.Mesh(gF, matF);
  meshF.name = 'feuer'; meshF.renderOrder = 4; meshF.frustumCulled = true;
  gF.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y + 1.2 * sc, z), 2.6 * sc);
  const group = new THREE.Group();
  group.name = 'feuertonne';
  group.add(meshF);
  let gR = null;
  if (NR) {
    gR = quadBuffer(NR);
    const matR = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
    matR.userData.disposable = true; matR.userData.noWorldShading = true;
    const meshR = new THREE.Mesh(gR, matR);
    meshR.name = 'feuer-rauch'; meshR.renderOrder = 3;
    gR.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y + 2.5 * sc, z), 3.5 * sc);
    group.add(meshR);
  }
  // eigener Zufall (Funken/Rauch), deterministisch je Feuer
  let sd = ((o.seed ?? Math.round(x * 31 + z * 17)) >>> 0) || 7;
  const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const flames = [
    { dx: 0, dz: 0, w: 0.56, h: 1.05, ph: rnd() * FRAMES, sp: 1 },
    { dx: 0.09, dz: 0.05, w: 0.4, h: 0.78, ph: rnd() * FRAMES, sp: 1.15 },
    { dx: -0.08, dz: -0.06, w: 0.42, h: 0.7, ph: rnd() * FRAMES, sp: 0.9 },
  ];
  const sparks = Array.from({ length: NS }, () => ({ life: 0, age: rnd() * 1.2, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0 }));
  const puffs = Array.from({ length: NR }, (_, i) => ({ life: 3.2 + rnd(), age: (i / Math.max(1, NR)) * 3.2, x: x + (rnd() - 0.5) * 0.2, z: z + (rnd() - 0.5) * 0.2, dx: 0.12 + rnd() * 0.12, dz: (rnd() - 0.5) * 0.1, s: 0.8 + rnd() * 0.5 }));
  let t = o.t0 ?? 0, vis = true;
  const update = (dt, cam) => {
    dt = Math.min(dt || 0.016, 0.1);
    t += dt;
    if (!cam) return;
    const d = Math.hypot(cam.position.x - x, cam.position.z - z);
    const on = d < FAR;
    if (on !== vis) { vis = on; group.visible = on; }
    if (!on) return;
    // Blickachsen: Flammen bleiben senkrecht (waagrechte Rechte), Funken/Rauch zeigen voll zur Kamera
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _hr.set(_r.x, 0, _r.z); if (_hr.lengthSq() < 1e-6) _hr.set(1, 0, 0); _hr.normalize();
    const UP = { x: 0, y: 1, z: 0 };
    let k = 0;
    for (const f of flames) {
      const fr = (t * FPS * f.sp + f.ph) % FRAMES, i0 = Math.floor(fr), a = fr - i0, i1 = (i0 + 1) % FRAMES;
      const flick = 0.92 + Math.sin(t * 13 + f.ph) * 0.05 + Math.sin(t * 29 + f.ph * 2) * 0.03;
      const w = f.w * sc, h = f.h * sc * flick;
      writeQuad(gF, k++, x + f.dx * sc, y, z + f.dz * sc, _hr, UP, w, h, i0, 1, 1, 1, 1 - a, false);
      writeQuad(gF, k++, x + f.dx * sc, y, z + f.dz * sc, _hr, UP, w, h, i1, 1, 1, 1, a, false);
    }
    for (const p of sparks) {
      p.age += dt;
      if (p.age >= p.life) {
        const a = rnd() * Math.PI * 2, r = rnd() * 0.16 * sc;
        p.x = x + Math.cos(a) * r; p.z = z + Math.sin(a) * r; p.y = y + 0.15 * sc;
        p.vx = (rnd() - 0.5) * 0.5; p.vz = (rnd() - 0.5) * 0.5; p.vy = 1.4 + rnd() * 1.8;
        p.life = 0.5 + rnd() * 1.1; p.age = 0; p.s = 0.025 + rnd() * 0.03;
      }
      p.vx += (Math.sin(t * 7 + p.life * 9) * 0.9) * dt; p.vy -= 0.35 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const fade = 1 - p.age / p.life;
      writeQuad(gF, k++, p.x, p.y, p.z, _r, _u, p.s, p.s * 2.2, SPARK, 1, 0.9 * fade + 0.1, 0.6 * fade, fade, true);
    }
    gF.attributes.position.needsUpdate = gF.attributes.uv.needsUpdate = gF.attributes.color.needsUpdate = true;
    if (gR) {
      let j = 0;
      for (const p of puffs) {
        p.age += dt;
        if (p.age >= p.life) { p.age -= p.life; p.x = x + (rnd() - 0.5) * 0.2; p.z = z + (rnd() - 0.5) * 0.2; p.dx = 0.12 + rnd() * 0.12; p.dz = (rnd() - 0.5) * 0.1; p.s = 0.8 + rnd() * 0.5; }
        const k2 = p.age / p.life, yy = y + (0.75 + k2 * 2.6) * sc, size = (0.35 + k2 * 1.2) * sc * p.s;
        const a = Math.min(1, k2 * 5) * (1 - k2) * 0.3;
        writeQuad(gR, j++, p.x + p.dx * p.age, yy, p.z + p.dz * p.age, _r, _u, size, size * 1.25, SMOKE, 1, 1, 1, a, true);
      }
      gR.attributes.position.needsUpdate = gR.attributes.uv.needsUpdate = gR.attributes.color.needsUpdate = true;
    }
  };
  b.object(group, { update });
  return group;
}
