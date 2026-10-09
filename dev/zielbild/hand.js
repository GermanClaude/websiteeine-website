// Zielbild – Handschuh-Hand am Pistolengriff (SDF aus Kapseln, glatt vereinigt → Surface Nets) + Ärmel.
import * as THREE from 'three';
import { weaveTile, camoTile, vn, fbm } from './tex.js';

const V3 = THREE.Vector3;
/* ------------------------------------------------------------------ SDF */
function sdCapsule(px, py, pz, a, b, ra, rb) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return [Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h), h];
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/**
 * Hand im Griff-Rahmen: u = Griffachse (nach unten), v = nach vorn (Vorderkante), w = rechts.
 * Rückgabe: Liste von Kapseln {a,b,ra,rb,kind,finger,seg}.
 */
function handRig() {
  const P = (u, v, w) => new V3(u, v, w);
  const caps = [];
  const C = (a, b, ra, rb, kind, finger = -1, seg = 0) => caps.push({ a, b, ra, rb, kind, finger, seg });
  // Handfläche (rechte Griffseite) – mehrere Kapseln für eine flache, breite Form
  for (const [u, rr] of [[0.012, 0.015], [0.034, 0.016], [0.056, 0.016], [0.076, 0.015]]) C(P(u, -0.044, 0.03), P(u + 0.002, 0.002, 0.032), rr, rr - 0.002, 'palm');
  C(P(0.02, -0.05, 0.02), P(0.075, -0.052, 0.022), 0.017, 0.016, 'palm'); // Ballen hinten
  C(P(0.03, -0.052, 0.008), P(0.07, -0.055, 0.01), 0.013, 0.013, 'heel'); // um den Rücken
  // Finger (Mittel, Ring, Klein) um die Vorderkante
  const gv = 0.024 + 0.0098, gw = 0.0152 + 0.0098; // Achsabstand
  const pathPt = (t) => { // Weg: rechte Seite → Vorderkante → linke Seite (Rundecken)
    const r = 0.011, a = gv - r, b = gw - r;
    const L1 = a, L2 = (Math.PI / 2) * r, L3 = 2 * b, L4 = (Math.PI / 2) * r;
    if (t < L1) return [t, gw];
    t -= L1; if (t < L2) { const q = t / r; return [a + Math.sin(q) * r, b + Math.cos(q) * r]; }
    t -= L2; if (t < L3) return [gv, b - t];
    t -= L3; if (t < L4) { const q = t / r; return [a + Math.cos(q) * r, -b - Math.sin(q) * r]; }
    t -= L4; return [a - t, -gw];
  };
  const fingers = [[0.022, 0.041, 0.027, 0.023, 0.0098], [0.045, 0.038, 0.025, 0.021, 0.0094], [0.066, 0.031, 0.021, 0.018, 0.0085]];
  fingers.forEach(([u, l1, l2, l3, r], fi) => {
    const s0 = -0.004;
    const pts = [s0, s0 + l1, s0 + l1 + l2, s0 + l1 + l2 + l3].map((t) => { const [v, w] = pathPt(Math.max(0, t)); return P(u + t * 0.06, v, w); });
    pts[0] = P(u, -0.006, gw + 0.002);
    for (let k = 0; k < 3; k++) C(pts[k], pts[k + 1], k === 0 ? r + 0.0008 : r - k * 0.0006, r - (k + 1) * 0.0007, 'finger', fi + 1, k);
  });
  // Zeigefinger gestreckt an der rechten Gehäuseseite (Abzugsdisziplin)
  {
    const r = 0.0098;
    const p0 = P(0.0, -0.004, 0.028), p1 = P(-0.022, 0.034, 0.024), p2 = P(-0.03, 0.06, 0.023), p3 = P(-0.034, 0.08, 0.022);
    C(p0, p1, r + 0.0008, r, 'finger', 0, 0); C(p1, p2, r - 0.0004, r - 0.0012, 'finger', 0, 1); C(p2, p3, r - 0.0012, r - 0.002, 'finger', 0, 2);
  }
  // Daumen über den Griffrücken auf die linke Seite
  {
    const t0 = P(0.03, -0.048, 0.03), t1 = P(0.004, -0.05, 0.012), t2 = P(-0.008, -0.036, -0.018), t3 = P(-0.012, -0.012, -0.024), t4 = P(-0.013, 0.008, -0.025);
    C(t0, t1, 0.016, 0.013, 'thumb', 5, 0); C(t1, t2, 0.012, 0.0112, 'thumb', 5, 1); C(t2, t3, 0.0112, 0.0104, 'thumb', 5, 2); C(t3, t4, 0.0104, 0.0094, 'thumb', 5, 3);
  }
  // Handgelenk + Bündchen
  C(P(0.05, -0.05, 0.03), P(0.085, -0.1, 0.045), 0.026, 0.027, 'wrist');
  C(P(0.075, -0.088, 0.042), P(0.1, -0.13, 0.05), 0.0295, 0.03, 'cuff');
  return caps;
}

/** Surface Nets über f (Gitter nx×ny×nz, Ursprung o, Schritt h). */
function surfaceNets(f, nx, ny, nz, o, h) {
  const idx = (x, y, z) => x + nx * (y + ny * z);
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cIdx = (x, y, z) => x + (nx - 1) * (y + (ny - 1) * z);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    let m = 0;
    for (let c = 0; c < 8; c++) { const v = f[idx(x + corners[c][0], y + corners[c][1], z + corners[c][2])]; val[c] = v; if (v < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      const va = val[a], vb = val[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
      n++;
    }
    cellV[cIdx(x, y, z)] = pos.length / 3;
    pos.push(o.x + (x + sx / n) * h, o.y + (y + sy / n) * h, o.z + (z + sz / n) * h);
  }
  const tri = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d); };
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) { // Kanten in x
    const a = f[idx(x, y, z)] < 0, b = f[idx(x + 1, y, z)] < 0; if (a === b) continue;
    quad(cellV[cIdx(x, y - 1, z - 1)], cellV[cIdx(x, y, z - 1)], cellV[cIdx(x, y, z)], cellV[cIdx(x, y - 1, z)], a);
  }
  for (let z = 1; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) { // Kanten in y
    const a = f[idx(x, y, z)] < 0, b = f[idx(x, y + 1, z)] < 0; if (a === b) continue;
    quad(cellV[cIdx(x - 1, y, z - 1)], cellV[cIdx(x - 1, y, z)], cellV[cIdx(x, y, z)], cellV[cIdx(x, y, z - 1)], a);
  }
  for (let z = 0; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) { // Kanten in z
    const a = f[idx(x, y, z)] < 0, b = f[idx(x, y, z + 1)] < 0; if (a === b) continue;
    quad(cellV[cIdx(x - 1, y - 1, z)], cellV[cIdx(x, y - 1, z)], cellV[cIdx(x, y, z)], cellV[cIdx(x - 1, y, z)], a);
  }
  return { pos, tri };
}

/**
 * Hand bauen. frame: { origin (Waffenraum), a (Griffachse ↓), f (vorn), r (rechts) } → Mesh im Waffenraum.
 */
export function buildHand(frame) {
  const caps = handRig();
  const k = 0.0075;
  const sdf = (u, v, w, info) => {
    let d = 1e9, best = 1e9, bi = -1, bh = 0;
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      const [di, hh] = sdCapsule(u, v, w, c.a, c.b, c.ra, c.rb);
      d = d > 1e8 ? di : smin(d, di, c.kind === 'finger' || c.kind === 'thumb' ? k * 0.55 : k * 1.4);
      if (di < best) { best = di; bi = i; bh = hh; }
    }
    // Stofffalten / Polster: leichte Verschiebung (nur Rückseite)
    if (info) { info.i = bi; info.h = bh; }
    return d - (vn(u * 900, w * 900 + v * 300) - 0.5) * 0.0004;
  };
  // Gitter
  const o = new V3(-0.06, -0.15, -0.055), size = new V3(0.2, 0.27, 0.14), h = 0.0011;
  const nx = Math.ceil(size.x / h) + 1, ny = Math.ceil(size.y / h) + 1, nz = Math.ceil(size.z / h) + 1;
  const f = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) f[x + nx * (y + ny * z)] = sdf(o.x + x * h, o.y + y * h, o.z + z * h);
  const { pos, tri } = surfaceNets(f, nx, ny, nz, o, h);
  // Normalen aus dem SDF-Gradienten + Bereiche (Leder innen, Stoff außen, Protektoren, Naht)
  const nV = pos.length / 3;
  const nor = new Float32Array(nV * 3), reg = new Float32Array(nV * 4);
  const e = 0.0004, info = { i: 0, h: 0 };
  // Griffachse (Mitte) im u-v-w-Raum: v = -0.024? (Mitte des Griffs bei v = 0, w = 0)
  for (let i = 0; i < nV; i++) {
    const u = pos[i * 3], v = pos[i * 3 + 1], w = pos[i * 3 + 2];
    let gx = sdf(u + e, v, w) - sdf(u - e, v, w), gy = sdf(u, v + e, w) - sdf(u, v - e, w), gz = sdf(u, v, w + e) - sdf(u, v, w - e);
    const l = Math.hypot(gx, gy, gz) || 1; gx /= l; gy /= l; gz /= l;
    nor[i * 3] = gx; nor[i * 3 + 1] = gy; nor[i * 3 + 2] = gz;
    sdf(u, v, w, info);
    const c = caps[info.i];
    // Innen = Normale zeigt zur Griffachse (v,w → 0)
    const toAx = -(v * gy + w * gz) / (Math.hypot(v, w) || 1);
    let leather = c.kind === 'cuff' ? 0 : THREE.MathUtils.smoothstep(toAx, 0.05, 0.4);
    if (c.kind === 'wrist') leather *= THREE.MathUtils.smoothstep(-u, -0.07, -0.05);
    // Knöchelprotektor: Grundgelenke der Finger, Außenseite
    let pad = 0;
    if ((c.kind === 'finger' && c.seg === 0 && info.h < 0.55) || (c.kind === 'palm' && v > -0.02)) pad = (1 - leather) * THREE.MathUtils.smoothstep(v, -0.03, -0.004);
    if (c.kind === 'finger' && c.seg === 1 && info.h > 0.15 && info.h < 0.75) pad = Math.max(pad, (1 - leather) * 0.85);
    const cuff = c.kind === 'cuff' ? 1 : 0;
    reg[i * 4] = leather; reg[i * 4 + 1] = pad; reg[i * 4 + 2] = cuff; reg[i * 4 + 3] = (info.i * 0.37) % 1;
  }
  // Rahmen: (u,v,w) → Waffenraum
  const M = new THREE.Matrix4().makeBasis(frame.a, frame.f, frame.r).setPosition(frame.origin);
  const N3 = new THREE.Matrix3().getNormalMatrix(M);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aReg', new THREE.Float32BufferAttribute(reg, 4));
  g.setIndex(tri);
  // Wicklung prüfen (gegen Normale) und ggf. drehen
  {
    const I = g.index.array, p = pos, n = nor; let bad = 0, tot = 0;
    for (let t = 0; t < I.length; t += 3 * 50) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ax = p[b * 3] - p[a * 3], ay = p[b * 3 + 1] - p[a * 3 + 1], az = p[b * 3 + 2] - p[a * 3 + 2];
      const bx = p[c * 3] - p[a * 3], by = p[c * 3 + 1] - p[a * 3 + 1], bz = p[c * 3 + 2] - p[a * 3 + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      if (cx * n[a * 3] + cy * n[a * 3 + 1] + cz * n[a * 3 + 2] < 0) bad++; tot++;
    }
    if (bad > tot / 2) { for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; } }
  }
  g.applyMatrix4(M);
  // Material
  const W = weaveTile(256, 40);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x6a6458) });
  const U = { tW: { value: W.normal }, tV: { value: W.var } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aReg; varying vec4 vReg; varying vec3 vOP; varying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = aReg; vOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec4 vReg; varying vec3 vOP; varying vec3 vON; uniform sampler2D tW; uniform sampler2D tV;
float hN(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hN(i),hN(i+vec3(1,0,0)),f.x),mix(hN(i+vec3(0,1,0)),hN(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hN(i+vec3(0,0,1)),hN(i+vec3(1,0,1)),f.x),mix(hN(i+vec3(0,1,1)),hN(i+vec3(1,1,1)),f.x),f.y),f.z); }
vec3 pNA(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd) {
  vec3 sx = normalize(dFdx(surf_pos)), sy = normalize(dFdy(surf_pos));
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  float det = dot(sx, R1) * fd;
  vec3 grad = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(det) * surf_norm - grad);
}
float gHeight;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float lea = vReg.x, pad = vReg.y, cuf = vReg.z;
        vec3 bw = pow(abs(normalize(vON)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vOP * 520.0;
        float weave = (texture2D(tV, P.zy).r * bw.x + texture2D(tV, P.xz).r * bw.y + texture2D(tV, P.xy).r * bw.z);
        vec3 Pw = vOP * 1400.0;
        float wv = 0.0; { vec3 q = fract(Pw) - 0.5; wv = (abs(q.x) + abs(q.y) + abs(q.z)) ; }
        float grain = vnoise(vOP * 2600.0) * 0.6 + vnoise(vOP * 700.0) * 0.4;
        float crease = vnoise(vOP * 160.0 + 3.0);
        vec3 fabric = vec3(0.105, 0.098, 0.085) * (0.85 + 0.3 * weave);
        vec3 leather = vec3(0.32, 0.25, 0.17) * (0.8 + 0.25 * grain) * (0.85 + 0.3 * crease);
        vec3 tpr = vec3(0.035, 0.035, 0.034);
        vec3 cuff = vec3(0.07, 0.068, 0.062) * (0.9 + 0.2 * weave);
        vec3 col = mix(fabric, leather, lea);
        col = mix(col, tpr, smoothstep(0.35, 0.6, pad));
        col = mix(col, cuff, cuf);
        // Naht an der Grenze Leder/Stoff
        float seam = 1.0 - smoothstep(0.0, 0.12, abs(lea - 0.5));
        float stitch = step(0.5, fract((vOP.x + vOP.y * 0.7 + vOP.z * 0.4) * 260.0));
        col = mix(col, col * 0.45, seam * 0.8);
        col = mix(col, vec3(0.2, 0.19, 0.16), seam * stitch * 0.7);
        // Abrieb/Staub an Fingerkuppen und Knöcheln
        col = mix(col, vec3(0.22, 0.2, 0.17), smoothstep(0.62, 0.9, vnoise(vOP * 90.0)) * 0.35 * (1.0 - pad));
        diffuseColor.rgb = col;
        gHeight = mix(weave * 0.6, grain * 0.5, lea) + seam * -0.8 + smoothstep(0.35, 0.6, pad) * (vnoise(vOP * 300.0) * 0.6) ;
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(mix(0.82, 0.55, vReg.x), 0.48, smoothstep(0.35, 0.6, vReg.y));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec2 dH = vec2(dFdx(gHeight), dFdy(gHeight)) * 0.5; normal = pNA(-vViewPosition, normal, dH, faceDirection); }`)
      .replace('#include <lights_fragment_begin>', `material.sheenColor *= (1.0 - vReg.x) * (1.0 - vReg.y);
#include <lights_fragment_begin>`);
  };
  mat.customProgramCacheKey = () => 'zb-glove';
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'handschuh';
  return mesh;
}

/** Ärmel (Tarnstoff mit Falten) vom Handgelenk a nach b (Waffenraum). */
export function buildSleeve(a, b, r0 = 0.036, r1 = 0.05) {
  const segL = 120, segR = 48;
  const dir = b.clone().sub(a); const L = dir.length(); dir.normalize();
  const up = Math.abs(dir.y) > 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0);
  const X = new V3().crossVectors(up, dir).normalize(), Y = new V3().crossVectors(dir, X);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segL; i++) {
    const t = i / segL;
    for (let j = 0; j <= segR; j++) {
      const ang = (j / segR) * Math.PI * 2;
      // Falten: Querwülste (Stauchung am Handgelenk) + Längsfalten
      const fold = 0.006 * Math.pow(Math.max(0, Math.sin(t * 38 + Math.sin(ang * 2) * 1.6)), 3) * (1 - t * 0.6)
        + 0.004 * (fbm(t * 9, ang * 1.4, 3) - 0.5) + 0.002 * Math.sin(ang * 5 + t * 12);
      const cuffBulge = t < 0.08 ? 0.006 * (1 - t / 0.08) : 0;
      const r = r0 + (r1 - r0) * Math.pow(t, 0.8) + fold + cuffBulge;
      const p = a.clone().addScaledVector(dir, t * L).addScaledVector(X, Math.cos(ang) * r).addScaledVector(Y, Math.sin(ang) * r * 0.92);
      pos.push(p.x, p.y, p.z); uv.push(j / segR * 1.6, t * L * 6);
      if (i < segL && j < segR) { const q = i * (segR + 1) + j; idx.push(q, q + 1, q + segR + 1, q + 1, q + segR + 2, q + segR + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const camo = camoTile(512);
  const W = weaveTile(256, 48, { twill: true });
  W.normal.repeat.set(30, 30);
  const mat = new THREE.MeshPhysicalMaterial({ map: camo, normalMap: W.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.88, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x8a826c) });
  // Dichter Stoffvorderseite prüfen: Wicklung (Außenseite sichtbar)
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  m.name = 'aermel';
  return m;
}
