// Zielbild – Gewehr (moderner Karabiner mit LPVO), Waffenraum: x rechts, y oben, −z = Mündung, Ursprung = Abzugsbereich.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { gunDetailTile } from './tex.js';

/* ------------------------------------------------------------------ Geometrie */
// Profil in (s = nach vorn, y), extrudiert entlang x (Breite w, zentriert).
function shapeFrom(pts) {
  const sh = new THREE.Shape();
  pts.forEach((p, i) => {
    if (i === 0) sh.moveTo(p[0], p[1]);
    else if (p.length === 4) sh.quadraticCurveTo(p[2], p[3], p[0], p[1]);
    else sh.lineTo(p[0], p[1]);
  });
  sh.closePath();
  return sh;
}
function finish(g, edge = true, crease = 35) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals(); // flach je Dreieck → Kantenmaß ohne Verschmieren über Deckflächen
  const n = g.attributes.normal, c = n.count;
  const e = new Float32Array(c);
  if (edge) for (let i = 0; i < c; i++) { const nz = Math.abs(n.getZ(i)), nxy = Math.hypot(n.getX(i), n.getY(i)); e[i] = Math.min(1, Math.min(nz, nxy) * 2.6); }
  g = toCreasedNormals(g, (crease * Math.PI) / 180);
  g.setAttribute('aEdge', new THREE.BufferAttribute(e, 1));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c * 2), 2));
  return g;
}
/** Profil (s,y) → extrudiert in x. bevel in m. */
function side(pts, w, bevel = 0.0012, { x = 0, holes = [], seg = 2, curve = 10 } = {}) {
  const sh = shapeFrom(pts);
  for (const h of holes) sh.holes.push(h);
  const d = Math.max(0.0002, w - 2 * bevel);
  let g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: seg, curveSegments: curve });
  g.translate(0, 0, -d / 2);
  g = finish(g);
  g.rotateY(Math.PI / 2); // s → −z, Extrusion → x
  g.translate(x, 0, 0);
  return g;
}
/** Querschnitt (x,y) → extrudiert entlang s (von s0 nach s1). */
function along(pts, s0, s1, bevel = 0.001, { holes = [], curve = 12, seg = 2 } = {}) {
  const sh = pts instanceof THREE.Shape ? pts : shapeFrom(pts);
  for (const h of holes) sh.holes.push(h);
  const len = Math.abs(s1 - s0) - 2 * bevel;
  let g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: seg, curveSegments: curve });
  g = finish(g);
  // Extrusion +Z → −z vom Start s0
  g.translate(0, 0, bevel);
  g.scale(1, 1, -1);
  g.translate(0, 0, -s0);
  // Wicklung nach Spiegelung korrigieren
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) for (const A of [p, n, g.attributes.uv, g.attributes.aEdge]) {
    const sz = A.itemSize; for (let k = 0; k < sz; k++) { const t = A.array[(i + 1) * sz + k]; A.array[(i + 1) * sz + k] = A.array[(i + 2) * sz + k]; A.array[(i + 2) * sz + k] = t; }
  }
  return g;
}
function rect(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
function rrPath(x0, y0, x1, y1, r) { const p = new THREE.Path(); p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.quadraticCurveTo(x1, y0, x1, y0 + r); p.lineTo(x1, y1 - r); p.quadraticCurveTo(x1, y1, x1 - r, y1); p.lineTo(x0 + r, y1); p.quadraticCurveTo(x0, y1, x0, y1 - r); p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0); return p; }
/** Drehkörper entlang s (Profil [s, r]). */
function lathe(prof, seg = 40, { x = 0, y = 0 } = {}) {
  const pts = prof.map(([s, r]) => new THREE.Vector2(r, s));
  let g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(-Math.PI / 2); // y(s) → −z
  g.translate(x, y, 0);
  g = g.toNonIndexed();
  g.computeVertexNormals();
  const c = g.attributes.position.count;
  // Kanten: schräge Flächen (Fasen an Stirnseiten), flach je Dreieck bestimmt
  const n = g.attributes.normal, e = new Float32Array(c);
  for (let i = 0; i < c; i++) { const nz = Math.abs(n.getZ(i)); e[i] = nz > 0.3 && nz < 0.95 ? 0.8 : 0; }
  g = toCreasedNormals(g, (40 * Math.PI) / 180);
  g.setAttribute('aEdge', new THREE.BufferAttribute(e, 1));
  return g;
}
function cyl(r, h, seg = 20, { axis = 'x', pos = [0, 0, 0], r2 = r } = {}) {
  let g = new THREE.CylinderGeometry(r, r2, h, seg, 1);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(...pos);
  g = g.toNonIndexed();
  g = toCreasedNormals(g, (40 * Math.PI) / 180);
  const c = g.attributes.position.count, e = new Float32Array(c).fill(0.6);
  g.setAttribute('aEdge', new THREE.BufferAttribute(e, 1));
  return g;
}

/* ------------------------------------------------------------------ Material (Dreifach-Detail + Kantenabrieb) */
let DET = null;
const QW = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const WEARK = Number(QW.get('wear') ?? 1);
export function gunMat({ color, rough = 0.55, metal = 0.2, edge = '#9a958c', edgeMetal = 0.9, wear = 1, fp = 1, clear = 0, sheen = 0, scale = 9 }) {
  if (!DET) DET = gunDetailTile(1024);
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat: clear, clearcoatRoughness: 0.4, sheen, sheenRoughness: 0.5, sheenColor: new THREE.Color(color).multiplyScalar(1.5) });
  const U = { tDet: { value: DET }, uDS: { value: scale }, uEdgeCol: { value: new THREE.Color(edge) }, uEdgeMetal: { value: edgeMetal }, uWear: { value: wear * WEARK }, uFP: { value: fp } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEdge; varying float vEdge; varying vec3 vOP; varying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge; vOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vEdge; varying vec3 vOP; varying vec3 vON; uniform sampler2D tDet; uniform float uDS; uniform vec3 uEdgeCol; uniform float uEdgeMetal; uniform float uWear; uniform float uFP;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      {
        vec3 bw = pow(abs(normalize(vON)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 P = vOP * uDS;
        vec4 dt = texture2D(tDet, P.zy) * bw.x + texture2D(tDet, P.xz + 0.37) * bw.y + texture2D(tDet, P.xy + 0.71) * bw.z;
        vec4 dt2 = texture2D(tDet, P.zy * 0.23 + 0.5) * bw.x + texture2D(tDet, P.xz * 0.23) * bw.y + texture2D(tDet, P.xy * 0.23 + 0.2) * bw.z;
        float w = smoothstep(0.42, 0.62, vEdge * (0.45 + dt2.b * 1.1)) * uWear;
        w = max(w, dt.a * 0.85 * uWear);
        roughnessFactor = clamp(roughnessFactor + (dt.b - 0.5) * 0.1 - dt.r * 0.22 * uFP - dt2.g * 0.1 * uFP, 0.2, 1.0);
        diffuseColor.rgb *= 0.9 + 0.2 * dt2.b;
        diffuseColor.rgb = mix(diffuseColor.rgb, uEdgeCol, w);
        metalnessFactor = mix(metalnessFactor, uEdgeMetal, w);
        roughnessFactor = mix(roughnessFactor, 0.3, w);
      }`);
  };
  m.customProgramCacheKey = () => 'zb-gun';
  return m;
}

/* ------------------------------------------------------------------ Bau */
export function buildRifle() {
  const P = { recv: [], poly: [], dark: [], optic: [], steel: [] };
  // --- Oberes Gehäuse
  P.recv.push(side([[-0.098, 0.0], [0.165, 0.0], [0.165, 0.05], [0.13, 0.052], [-0.06, 0.052], [-0.098, 0.05]], 0.0265, 0.0016));
  // Hülsenabweiser / Schließhilfe rechts (Silhouette)
  P.recv.push(side([[-0.03, 0.012], [0.0, 0.012], [0.0, 0.036], [-0.03, 0.04]], 0.008, 0.0012, { x: 0.016 }));
  // Ladehebel
  P.recv.push(side([[-0.112, 0.036], [-0.096, 0.036], [-0.096, 0.05], [-0.112, 0.05]], 0.016, 0.001));
  P.recv.push(side([[-0.118, 0.038], [-0.106, 0.038], [-0.106, 0.05], [-0.118, 0.05]], 0.05, 0.002));
  // --- Unteres Gehäuse inkl. Magazinschacht
  P.recv.push(side([[-0.11, -0.002], [0.112, -0.002], [0.112, -0.03], [0.104, -0.072], [0.1, -0.078], [0.026, -0.078], [0.022, -0.05], [0.012, -0.03], [-0.035, -0.03], [-0.07, -0.022], [-0.11, -0.022]], 0.0245, 0.0018));
  // Abzugsbügel (mit Loch)
  {
    const hole = rrPath(-0.001, -0.052, 0.042, -0.031, 0.008);
    P.recv.push(side([[-0.008, -0.03], [0.05, -0.03], [0.05, -0.058], [-0.005, -0.06]], 0.011, 0.0012, { holes: [hole] }));
  }
  // Abzug
  P.dark.push(side([[0.018, -0.03], [0.026, -0.03], [0.022, -0.047], [0.016, -0.05], [0.017, -0.04]], 0.006, 0.0006));
  // Bedienelemente links: Sicherungshebel, Fanghebel, Achsstifte
  P.steel.push(side([[-0.05, 0.002], [-0.02, -0.004], [-0.018, -0.01], [-0.05, -0.006]], 0.003, 0.0006, { x: -0.0145 }));
  P.steel.push(cyl(0.0062, 0.004, 16, { pos: [-0.0135, -0.004, 0.035] }));
  P.recv.push(side([[0.06, -0.008], [0.085, -0.004], [0.088, -0.016], [0.062, -0.02]], 0.004, 0.0008, { x: -0.0135 }));
  for (const s of [0.098, -0.088]) P.steel.push(cyl(0.0034, 0.027, 14, { pos: [0, -0.012, -s] }));
  // --- Pistolengriff (Fingermulden vorn)
  P.poly.push(side([[-0.006, -0.026], [-0.012, -0.05, -0.004, -0.04], [-0.02, -0.073, -0.026, -0.062], [-0.03, -0.098, -0.022, -0.088], [-0.04, -0.124, -0.042, -0.112], [-0.047, -0.132], [-0.086, -0.13], [-0.09, -0.124], [-0.078, -0.09, -0.086, -0.104], [-0.068, -0.05, -0.07, -0.072], [-0.06, -0.034], [-0.068, -0.024, -0.07, -0.03], [-0.05, -0.016]], 0.03, 0.004, { curve: 14, seg: 3 }));
  // --- Magazin (gebogen, Polymer) + Rippen + Bodenplatte
  P.poly.push(side([[0.03, -0.07], [0.098, -0.07], [0.118, -0.25, 0.104, -0.16], [0.052, -0.25], [0.03, -0.07, 0.04, -0.16]], 0.022, 0.002, { curve: 16 }));
  P.poly.push(side([[0.046, -0.248], [0.124, -0.248], [0.128, -0.262], [0.044, -0.262]], 0.027, 0.003));
  for (let k = 0; k < 4; k++) { const y = -0.2 - k * 0.011; P.poly.push(side([[0.055 + k * 0.0018, y], [0.107 + k * 0.002, y], [0.107 + k * 0.002, y - 0.004], [0.055 + k * 0.0018, y - 0.004]], 0.0245, 0.001)); }
  // --- Pufferrohr + Schaft
  P.recv.push(lathe([[-0.098, 0.0], [-0.098, 0.017], [-0.102, 0.0175], [-0.104, 0.0155], [-0.2, 0.0155], [-0.2, 0]], 40, { y: 0.026 }));
  // Schaftkappe liegt außerhalb des Bildes (dicht vor der Kamera) – weggelassen
  // --- Handschutz (Achteck aus Platten mit M-LOK-Schlitzen)
  const hg0 = 0.166, hg1 = 0.5;
  const slots = (y0, y1) => { const hs = []; for (let s = 0.195; s < hg1 - 0.03; s += 0.042) hs.push(rrPath(s, y0, s + 0.032, y1, 0.0034)); return hs; };
  for (const sx of [-1, 1]) P.recv.push(side([[hg0, 0.006], [hg1, 0.006], [hg1, 0.046], [hg0, 0.046]], 0.0032, 0.0008, { x: sx * 0.0235, holes: slots(0.0225, 0.0295) }));
  // unten
  {
    let g = side([[hg0, -0.0115], [hg1, -0.0115], [hg1, 0.0115], [hg0, 0.0115]], 0.0032, 0.0008, { holes: (() => { const hs = []; for (let s = 0.2; s < hg1 - 0.03; s += 0.042) hs.push(rrPath(s, -0.0035, s + 0.032, 0.0035, 0.0034)); return hs; })() });
    g.rotateZ(Math.PI / 2); g.translate(0, -0.006, 0); P.recv.push(g);
  }
  // Schrägen
  for (const [sx, sy, y] of [[-1, 1, 0.052], [1, 1, 0.052], [-1, -1, -0.002], [1, -1, -0.002]]) {
    let g = side([[hg0, -0.0075], [hg1, -0.0075], [hg1, 0.0075], [hg0, 0.0075]], 0.0032, 0.0008);
    g.rotateZ(sx * sy * Math.PI / 4); g.translate(sx * 0.0185, y - sy * 0.002, 0); P.recv.push(g);
  }
  // Endkappe vorn
  P.recv.push(along([[-0.024, -0.006], [0.024, -0.006], [0.024, 0.05], [-0.024, 0.05]], hg1, hg1 + 0.006, 0.0012, { holes: [rrPath(-0.011, 0.015, 0.011, 0.037, 0.01)] }));
  // Handschutz-Schrauben (Innensechskant)
  for (const s of [0.18, 0.205]) {
    P.steel.push(cyl(0.0036, 0.003, 18, { pos: [-0.0262, 0.014, -s] }));
    P.dark.push(cyl(0.0016, 0.0032, 6, { pos: [-0.0268, 0.014, -s] }));
  }
  // --- Lauf + Mündungsbremse
  P.steel.push(lathe([[hg0, 0.0], [hg0, 0.0098], [0.6, 0.0098], [0.6, 0.0]], 28, { y: 0.026 }));
  P.dark.push(lathe([[0.598, 0.0], [0.598, 0.0122], [0.604, 0.0126], [0.61, 0.0126], [0.612, 0.0118], [0.62, 0.0118], [0.622, 0.0126], [0.632, 0.0126], [0.634, 0.0118], [0.642, 0.0118], [0.644, 0.0126], [0.664, 0.0126], [0.668, 0.0116], [0.668, 0.005], [0.66, 0.005], [0.66, 0.0]], 32, { y: 0.026 }));
  // --- Picatinny-Schiene (Gehäuse + Handschutz)
  const rail = (s0, s1, y) => {
    const base = along([[-0.0079, 0], [0.0079, 0], [0.0079, 0.003], [-0.0079, 0.003]], s0, s1, 0.0005);
    base.translate(0, y, 0); P.recv.push(base);
    const tooth = [[-0.0079, 0.003], [0.0079, 0.003], [0.0105, 0.0058], [0.0078, 0.0094], [-0.0078, 0.0094], [-0.0105, 0.0058]];
    for (let s = s0 + 0.002; s + 0.0053 < s1; s += 0.01) { const g = along(tooth, s, s + 0.0053, 0.0005); g.translate(0, y, 0); P.recv.push(g); }
  };
  rail(-0.09, 0.162, 0.052);
  rail(0.172, 0.496, 0.05);
  // --- Optik (LPVO 1–6×) auf Freiträgermontage
  const oy = 0.1;
  P.optic.push(lathe([
    [-0.082, 0.0], [-0.082, 0.0186], [-0.08, 0.0205], [-0.074, 0.0212], [-0.04, 0.0212], [-0.038, 0.0204], [-0.036, 0.0212], [-0.032, 0.0204], [-0.03, 0.0212], [-0.022, 0.0212], [-0.012, 0.0172], [-0.006, 0.0172],
    [-0.004, 0.0182], [0.0, 0.0182], [0.002, 0.0172], [0.012, 0.0164], [0.012, 0.0152], [0.15, 0.0152], [0.162, 0.0168], [0.198, 0.0172], [0.2, 0.0165], [0.2, 0.0],
  ], 56, { y: oy }));
  // Vergrößerungsring-Hebel
  P.optic.push(side([[-0.006, oy + 0.016], [0.0, oy + 0.016], [-0.001, oy + 0.03], [-0.005, oy + 0.03]], 0.004, 0.0008, { x: -0.006 }));
  // Sattel + Türme
  P.optic.push(along([[-0.0175, -0.0175], [0.0175, -0.0175], [0.0175, 0.0175], [-0.0175, 0.0175]].map(([x, y]) => [x, y + oy]), 0.06, 0.098, 0.003));
  const turret = (axis, sgn) => {
    const prof = [[0, 0.0], [0, 0.0105], [0.012, 0.0105], [0.013, 0.0118], [0.024, 0.0118], [0.025, 0.0105], [0.026, 0.0]];
    let g = lathe(prof, 48);
    // Achse s → Turmachse
    if (axis === 'y') { g.rotateX(sgn * Math.PI / 2); g.translate(0, oy + sgn * 0.015, -0.079); }
    else { g.rotateY(-sgn * Math.PI / 2); g.translate(sgn * 0.015, oy, -0.079); }
    return g;
  };
  P.optic.push(turret('y', 1), turret('x', 1), turret('x', -1));
  // Riffelung an Turmkappen (Rippen)
  for (const [ax, sg] of [['y', 1], ['x', -1], ['x', 1]]) for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    const g = cyl(0.0009, 0.011, 4, { axis: 'y' });
    const r = 0.0119;
    if (ax === 'y') g.translate(Math.cos(a) * r, oy + 0.015 + 0.0185, -0.079 + Math.sin(a) * r);
    else { g.rotateZ(Math.PI / 2); g.translate(sg * (0.015 + 0.0185), oy + Math.cos(a) * r, -0.079 + Math.sin(a) * r); }
    P.optic.push(g);
  }
  // Montage: Basis + zwei Ringe + Klemmschrauben
  P.optic.push(along([[-0.011, 0.0615], [0.011, 0.0615], [0.011, 0.07], [-0.011, 0.07]], -0.03, 0.13, 0.0012));
  for (const s of [-0.015, 0.11]) {
    const ring = new THREE.Path(); ring.absarc(0, oy, 0.0153, 0, Math.PI * 2, true);
    const rs = new THREE.Shape(); rs.moveTo(-0.019, 0.066); rs.lineTo(0.019, 0.066); rs.lineTo(0.019, oy); rs.absarc(0, oy, 0.019, 0, Math.PI, false); rs.lineTo(-0.019, 0.066);
    rs.holes.push(ring);
    P.optic.push(along(rs, s, s + 0.014, 0.0012, { curve: 24 }));
    for (const sx of [-1, 1]) for (const ds of [0.0035, 0.0105]) {
      P.steel.push(cyl(0.0027, 0.004, 14, { pos: [sx * 0.0205, oy, -(s + ds)] }));
      P.dark.push(cyl(0.0012, 0.0042, 6, { pos: [sx * 0.0208, oy, -(s + ds)] }));
    }
    // Querbolzen der Basis
    P.steel.push(cyl(0.0042, 0.03, 16, { pos: [0, 0.0655, -(s + 0.007)] }));
  }
  // --- Materialien
  const M = {
    recv: gunMat({ color: '#0d0e0f', rough: 0.66, metal: 0.05, edge: '#8d8a83', wear: 0.8, fp: 1, scale: 9 }),          // Cerakote Graphit
    poly: gunMat({ color: '#4a3f33', rough: 0.78, metal: 0.0, edge: '#8c7a60', edgeMetal: 0, wear: 0.6, fp: 0.6, scale: 11 }), // FDE-Polymer
    optic: gunMat({ color: '#0f1011', rough: 0.4, metal: 0.35, edge: '#8f8b84', wear: 0.8, fp: 1.2, scale: 10 }),    // eloxiert
    steel: gunMat({ color: '#3c3c3b', rough: 0.36, metal: 0.9, edge: '#b8b4ac', wear: 0.5, fp: 0.8, scale: 12 }),
    dark: gunMat({ color: '#121212', rough: 0.45, metal: 0.6, edge: '#5a5853', wear: 0.4, fp: 0.3, scale: 12 }),
  };
  const G = new THREE.Group();
  for (const k of Object.keys(P)) {
    const parts = P[k].map((g) => { const keep = new THREE.BufferGeometry(); for (const a of ['position', 'normal', 'uv', 'aEdge']) keep.setAttribute(a, g.attributes[a]); return keep; });
    const mesh = new THREE.Mesh(mergeGeometries(parts), M[k]);
    mesh.castShadow = mesh.receiveShadow = true;
    G.add(mesh);
  }
  // Linsen (Vergütung schillert) + beleuchteter Absehenpunkt
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x07090b, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [260, 460], envMapIntensity: 1.4 });
  const lens = (s, r, dir) => {
    const g = new THREE.SphereGeometry(r * 2.2, 40, 12, 0, Math.PI * 2, 0, 0.47);
    g.rotateX(dir * Math.PI / 2); g.translate(0, oy, -s - dir * r * 2.2 * Math.cos(0.47));
    const m = new THREE.Mesh(g, lensMat); m.receiveShadow = true; G.add(m);
  };
  lens(-0.0765, 0.0186, 1);
  lens(0.196, 0.0158, -1);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0007, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.08, 0.03).multiplyScalar(40), toneMapped: true }));
  dot.position.set(0, oy, 0.0808); G.add(dot);
  G.userData.mats = M;
  return G;
}
