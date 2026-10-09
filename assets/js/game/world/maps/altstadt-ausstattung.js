// NULLPUNKT — Karte „Altstadt“: Ausstattung (Owner: world / Altstadt, Kartenrunde 2).
//
// • Parkbänke mit gusseisernen Wangen: Sitz- und Lehnenlatten hängen sichtbar an Bein/Lehnenstütze (keine schwebende Lehne)
// • Blumenbeete: Trog mit umlaufenden Deckplatten, sichtbare Erde, gemischte Blüten je Beet (Farbpalette) + Grün
// • Brunnenwasser: Strahlen, Überlaufbahnen und Wellenringe, animiert nach der gemeinsamen Uhr (online Host-Zeit)
// • Abendlicht: Laternenglas leuchtet, Lichthof, Lichtpfütze am Boden, gebackenes Sondenlicht; echte Punktlichter nur
//   für die Platzlaternen auf hoch/ultra
// • Einheitliche Putzschäden (nur Außenseiten): Feuchtesockel über dem Steinsockel + vereinzelte Abplatzungen an
//   Ecken/Laibungen, immer Bruchstein darunter – statt zufällig verstreuter Ziegel-/Stein-/Flickstellen
// • Möbel + Innenleuchten (Pendelleuchten mit gebackenem Licht)
//
// Mehrspieler: alles deterministisch. Kein Math.random; Kollision nur über prozedurale Körper (gleich auf jeder
// Grafikstufe und mit/ohne Asset-Bibliothek). Neue Teile verbrauchen den Kartenzufall nicht (Positions-Hash bzw.
// withRng in altstadt.js) – Farben/Plätze der übrigen Karte bleiben unverändert.
import * as THREE from 'three';
import { frame, chair, tree } from '../props.js';
import { craneClock } from '../crane-anim.js';

const IRON = '#2b2d30';
const VIS = { collide: false, minimap: false };            // nur Optik (Kugeln treffen trotzdem)
const VG = { collide: false, minimap: false, grad: false };

/** Zufallsfolge aus Positionswerten (mulberry32) – auf allen Rechnern bitgleich, verbraucht keinen Kartenzufall. */
export function hrng(a, b2 = 0, c = 0) {
  let s = (Math.imul(Math.round(a * 100) | 0, 73856093) ^ Math.imul(Math.round(b2 * 100) | 0, 19349663) ^ Math.imul((Math.round(c * 100) + 7) | 0, 83492791)) >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// Tageszeit, Lampen
// ---------------------------------------------------------------------------
const LOOK = { night: false, rt: false, ultra: false };

/**
 * Zu Beginn von build(): Tageszeit (Kartenbedingungen) und Grafikstufe merken, Putzschäden der Altstadt einhängen.
 * time: 'morgen'|'mittag'|'nachmittag'|'abend'|… (null = Kartenzeit Mittag)
 */
export function setupLook(b, { time, quality }) {
  LOOK.night = time === 'abend' || time === 'nacht';
  LOOK.rt = quality === 'high' || quality === 'ultra';
  LOOK.ultra = quality === 'ultra';
  installPlasterStyle(b);
  return LOOK;
}
export const isNight = () => LOOK.night;

/** Material des Laternenglases: abends leuchtend, tagsüber mattweißes Glas. */
export const lampGlass = () => (LOOK.night ? 'lamp_warm' : 'white');

/**
 * Abendlicht einer Lampe: Lichthof (ein gemeinsamer Draw Call), gebackenes Sondenlicht (wärmt Fassaden/Boden ringsum,
 * kostet zur Laufzeit nichts), Lichtpfütze als additives Boden-Decal; o.realtime ('high' | 'ultra') zusätzlich als echtes
 * Punktlicht ab dieser Stufe. Tagsüber: nichts.
 * o: { glow (Größe, false = ohne), intensity, distance, pool (Radius, false = ohne), poolAt [x, z], groundY, realtime }
 */
export function lampLight(b, x, y, z, o = {}) {
  if (!LOOK.night) return;
  if (o.glow !== false) b.glow(x, y, z, { color: '#ffc47a', size: o.glow ?? 1.5, intensity: o.glowI ?? 0.85 });
  const rt = o.realtime === 'ultra' ? LOOK.ultra : o.realtime ? LOOK.rt : false;
  b.light('point', x, y - 0.12, z, { color: '#ffc27c', intensity: o.intensity ?? 8, distance: o.distance ?? 9, realtime: rt, priority: o.priority ?? 1, group: 0 });
  if (o.pool !== false) {
    const [px, pz] = o.poolAt || [x, z], r = o.pool ?? 2.4, gy = o.groundY ?? 0;
    b.decal(px, gy + 0.016, pz, r * 2, r * 1.9, 'puddle', { kind: 'light', tint: '#ffad5c', opacity: o.poolI ?? 0.22, ry: (px * 0.71 + pz * 0.37) % 6.283 });
    b.decal(px, gy + 0.018, pz, r * 0.95, r * 0.9, 'puddle', { kind: 'light', tint: '#ffc684', opacity: (o.poolI ?? 0.22) * 0.75, ry: (pz * 0.93) % 6.283 });
  }
}

// ---------------------------------------------------------------------------
// Putzschäden (ersetzt für diese Karte die weltweit verstreuten Ziegel-/Stein-/Flickstellen des MapBuilders)
// ---------------------------------------------------------------------------
function installPlasterStyle(b) {
  const inside = (px, py, pz) => {
    for (const v of b.interiors) if (px > v.minX && px < v.maxX && pz > v.minZ && pz < v.maxZ && py > v.minY && py < v.maxY) return true;
    return false;
  };
  // Eigene Instanz-Methode: gilt nur für diesen Aufbau (andere Karten behalten den Standard)
  b._plasterDamage = (x, y, z, w, h, d, o) => {
    const R = hrng(x, z, y + w * 0.37);
    const ry = o.ry || 0, c = Math.cos(ry), sn = Math.sin(ry);
    const tx = c, tz = -sn, nx0 = sn, nz0 = c; // lokale +x (Wandlänge) und +z (Wandnormale) in Welt
    const ground = y < 0.35;
    for (const side of [1, -1]) {
      const off = side * (d / 2), nx = nx0 * side, nz = nz0 * side;
      const fx = x + nx0 * off, fz = z + nz0 * off;
      // Innenseite (Raum dahinter): keine Schäden – Innenwände bleiben glatt verputzt
      if (inside(fx + nx * 0.25, y + 1.0, fz + nz * 0.25)) continue;
      const dec = (u, v, sw, sh, cell, opacity) => b.decal(fx + tx * u, y + v, fz + tz * u, sw, sh, cell, { normal: [nx, 0, nz], tangent: [tx * side, 0, tz * side], opacity });
      if (ground) {
        // Feuchtesockel: durchgehend über dem Steinsockel (0,55 m), gleiche Art an jedem Pfeiler
        if (w >= 0.9) { const sh = 0.5 + R() * 0.22; dec(0, 0.48 + sh / 2, Math.min(w - 0.1, 7), sh, 'damp', 0.42 + R() * 0.14); }
        // Abplatzung an der Pfeilerkante (Ecke/Laibung) direkt über dem Sockel – Bruchstein darunter
        if (w >= 1.3 && R() < 0.38) {
          const sw = Math.min(w * 0.42, 0.5 + R() * 0.4), sh = sw * (0.55 + R() * 0.2), e = R() < 0.5 ? -1 : 1;
          dec(e * (w / 2 - sw / 2 - 0.03), 0.58 + sh / 2, sw, sh, 'chip_stone', 1);
        }
      } else if (w >= 1.3 && h >= 2 && R() < 0.16) {
        // Obergeschoss: vereinzelt unter dem Gesims an der Kante
        const sw = 0.42 + R() * 0.3, sh = sw * (0.55 + R() * 0.2), e = R() < 0.5 ? -1 : 1;
        dec(e * (w / 2 - sw / 2 - 0.03), h - 0.32 - sh / 2, sw, sh, 'chip_stone', 1);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Parkbank (Gusseisen + Holzlatten)
// ---------------------------------------------------------------------------
/** Bank, lokal: Sitzende blicken nach +z, Lehne hinten (−z). o: { y, ry, len, wood } */
export function parkBench(b, x, z, o = {}) {
  const y = o.y ?? 0, f = frame(b, x, y, z, o.ry || 0);
  const L = o.len ?? 1.8, WD = o.wood || '#b58a5a';
  const I = { ...VG, tint: IRON, ao: false };
  const W = { ...VG, tint: WD };
  const SEAT = 0.44, A = 0.25, ca = Math.cos(A), sa = Math.sin(A);
  const bz = -0.2, by = SEAT - 0.04, LU = 0.5; // Fußpunkt und Länge der Lehnenstütze
  const hx = L / 2 - 0.13;
  for (const sx of [-hx, hx]) {
    f.box(sx, 0, 0.17, 0.055, SEAT - 0.03, 0.055, 'metal_painted', I);                // Vorderbein
    f.box(sx, 0, bz, 0.055, by, 0.055, 'metal_painted', I);                           // Hinterbein
    f.box(sx, by - 0.02, bz, 0.05, LU, 0.05, 'metal_painted', { ...I, rx: -A });      // Lehnenstütze (geneigt)
    f.box(sx, SEAT - 0.08, -0.015, 0.05, 0.05, 0.46, 'metal_painted', I);             // Sitzzarge
    f.box(sx, 0.09, -0.015, 0.035, 0.035, 0.38, 'metal_painted', I);                  // Fußstrebe
    // Armlehne: von der Lehnenstütze (Höhe 0,64) bis über das Vorderbein, mit Stütze
    const sArm = (0.64 - by) / ca, zArm = bz - sArm * sa;
    f.box(sx, 0.64, (zArm + 0.21) / 2, 0.05, 0.035, 0.21 - zArm, 'metal_painted', I);
    f.box(sx, SEAT - 0.03, 0.17, 0.04, 0.64 - SEAT + 0.03, 0.04, 'metal_painted', I);
  }
  // Sitzlatten (liegen auf den Zargen)
  for (let i = 0; i < 4; i++) f.box(0, SEAT - 0.03, -0.155 + i * 0.117, L, 0.035, 0.09, 'wood_planks', W);
  // Lehnenlatten in der Ebene der Stützen (vor der Stütze), Unterkante je Latte entlang der Neigung
  for (const s of [0.18, 0.3, 0.42]) {
    const yc = by + s * ca + 0.04 * sa, zc = bz - s * sa + 0.04 * ca;
    f.box(0, yc - 0.045 * ca, zc + 0.045 * sa, L, 0.09, 0.03, 'wood_planks', { ...W, rx: -A });
  }
  f.solid(0, 0, 0.0, L, 0.48, 0.46, { minimap: 'prop' });
}

// ---------------------------------------------------------------------------
// Blumenbeet
// ---------------------------------------------------------------------------
const FLOWER_SETS = [
  ['#d8283a', '#f4f1ea', '#e0405a'],   // Geranien rot/weiß
  ['#8a5fc0', '#b48ad8', '#f4f1ea'],   // Lavendel/Salbei
  ['#f2b22a', '#e8862a', '#f7e27a'],   // Ringelblume/Tagetes
  ['#e05a9a', '#c63a7c', '#f6d2e0'],   // Petunien rosa
  ['#3c64c8', '#f4f1ea', '#7a9ae0'],   // Männertreu blau/weiß
];
let flowerGeo = null;
/** Blütenkopf (flaches Oktaeder, 8 Dreiecke), einmal erzeugt. */
function flowerHead() {
  if (!flowerGeo) { const g = new THREE.OctahedronGeometry(1, 0); flowerGeo = g.index ? g.toNonIndexed() : g; flowerGeo.computeVertexNormals(); }
  return flowerGeo;
}

/**
 * Blumenbeet (Trog) w × d, Höhe h: Bruchsteinwände, umlaufende Deckplatten, Erde 7 cm unter der Kante, Grün + Blüten.
 * Kollision wie bisher ein Quader (Deckung). Verbraucht den Kartenzufall genau wie das frühere planter():
 * je Pflanze 2 (Lage) + 1 (Art, falls nicht vorgegeben) + 1 (Größe) + 1 (Drehung), Baum 3.
 * o: { h, ry, tint, plant ('flowers'|'bush'), tree ('olive'|…), set (Farbpalette 0..4) }
 */
export function flowerBed(b, x, z, w, d, o = {}) {
  const h = o.h ?? 0.75, ry = o.ry || 0, f = frame(b, x, 0, z, ry);
  const t = 0.16, soil = h - 0.07, STONE = o.tint || '#e0d2b8', CAP = '#efe7d6';
  f.solid(0, 0, 0, w, h, d, { minimap: 'cover' });
  // Trog: Kern bis unter die Erde, Wandkranz bis zur Kante, Deckplatten mit 4 cm Überstand
  f.box(0, 0, 0, w, soil - 0.06, d, 'stone_wall', { tint: STONE, ...VIS });
  for (const s of [-1, 1]) {
    f.box(0, soil - 0.06, s * (d / 2 - t / 2), w, h - soil + 0.06, t, 'stone_wall', { tint: STONE, ...VG });
    f.box(s * (w / 2 - t / 2), soil - 0.06, 0, t, h - soil + 0.06, d - 2 * t, 'stone_wall', { tint: STONE, ...VG });
    f.box(0, h, s * (d / 2 - t / 2 + 0.02), w + 0.08, 0.055, t + 0.04, 'stone_wall', { tint: CAP, ...VG });
    f.box(s * (w / 2 - t / 2 + 0.02), h, 0, t + 0.04, 0.055, d - 2 * t, 'stone_wall', { tint: CAP, ...VG });
  }
  f.box(0, soil - 0.06, 0, w - 2 * t + 0.01, 0.06, d - 2 * t + 0.01, 'dirt', { tint: '#7a5a3e', ...VG, ao: false });
  // Bepflanzung (Kartenzufall wie bisher; Blüten/Kanten mit Positions-Hash)
  const R = hrng(x, z, 911), pal = FLOWER_SETS[(o.set ?? Math.floor(R() * FLOWER_SETS.length)) % FLOWER_SETS.length];
  const iw = w - 2 * t, id = d - 2 * t;
  const n = o.mainLoop === false ? 0 : Math.max(1, Math.round((w * d) / 1.6));
  for (let i = 0; i < n; i++) {
    const u = b.rand() - 0.5, v = b.rand() - 0.5;
    const isFlower = o.plant ? o.plant === 'flowers' : b.rand() < 0.35;
    const s = 0.6 + b.rand() * 0.4;
    const [px, pz] = f.P(u * Math.max(0.1, iw - 0.45), v * Math.max(0.1, id - 0.45));
    if (isFlower) { b.rand(); flowerClump(b, px, soil, pz, pal, R, 0.22 + s * 0.12); }  // Drehung wie früher verbraucht
    else b.plant('bush', px, soil - 0.02, pz, { s: s * 0.55 });                         // Strauch (Drehung aus dem Kartenzufall)
  }
  // Randbepflanzung: Blütenreihe an den Längsseiten, Grünpolster dazwischen
  const along = w >= d, Lr = along ? iw : id, Lq = along ? id : iw;
  const k = Math.max(2, Math.round(Lr / 0.34));
  for (const e of [-1, 1]) for (let i = 0; i < k; i++) {
    const a = -Lr / 2 + 0.17 + (i * (Lr - 0.34)) / (k - 1), q = e * (Lq / 2 - 0.13);
    const [px, pz] = along ? f.P(a, q) : f.P(q, a);
    if (i % 2) b.plant('bush', px, soil - 0.03, pz, { s: 0.2 + R() * 0.06, ry: R() * 6.283 });
    else flowerClump(b, px, soil, pz, pal, R, 0.18 + R() * 0.06);
  }
  if (o.tree) tree(b, x, z, { y: soil - 0.03, kind: o.tree, h: 2.4 });
}

/** Blütenbüschel: Grünpolster + 3–5 Blütenköpfe in Palettenfarben (ohne Kollision, ohne Schatten). */
function flowerClump(b, x, y, z, pal, R, s) {
  b.plant('bush', x, y - 0.03, z, { s: s * 0.9, ry: R() * 6.283 });
  const n = 3 + Math.floor(R() * 3), col = pal[Math.floor(R() * pal.length)];
  for (let i = 0; i < n; i++) {
    const a = R() * 6.283, r = R() * s * 0.55, hs = 0.045 + R() * 0.03;
    b.geom(flowerHead(), x + Math.cos(a) * r, y + s * (0.45 + R() * 0.45), z + Math.sin(a) * r, 'white', {
      sx: hs, sy: hs * 0.55, sz: hs, ry: R() * 3, tint: R() < 0.8 ? col : pal[(pal.indexOf(col) + 1) % pal.length],
      collide: false, minimap: false, ao: false, cast: false, bullet: false, grad: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Brunnenwasser (animiert nach der gemeinsamen Uhr)
// ---------------------------------------------------------------------------
const GRAV = 9.81;
const T_WRAP = 500; // s – alle Muster-Geschwindigkeiten × T_WRAP sind ganzzahlig (nahtloser Umlauf, Float-Genauigkeit)

/** Fließwasser-Material (Strahlen, Überlaufbahnen): Strähnen wandern entlang der Lauflänge (uv.y in m), quer uv.x. */
function flowMaterial(uT) {
  const m = new THREE.MeshStandardMaterial({ color: '#d6ecef', roughness: 0.06, metalness: 0, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.35 });
  m.name = 'brunnen-strahl';
  m.userData.disposable = true;
  m.userData.surface = 'water';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWaterT = uT;
    sh.vertexShader = 'attribute float aFade;\nvarying vec2 vFlowUv;\nvarying float vFlowFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFlowUv = uv; vFlowFade = aFade;');
    sh.fragmentShader = 'uniform float uWaterT;\nvarying vec2 vFlowUv;\nvarying float vFlowFade;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
      {
        float strand = floor(vFlowUv.x);
        float hs = fract(sin(strand * 127.1 + 3.7) * 43758.5453);
        float p = fract(vFlowUv.y * 2.6 - uWaterT * (1.6 + hs * 0.4) + hs);
        float body = smoothstep(0.0, 0.18, p) * smoothstep(1.0, 0.62, p);
        float edge = sin(fract(vFlowUv.x) * 3.14159);
        float a = (0.34 + 0.46 * body) * mix(0.55, 1.0, edge);
        float foam = smoothstep(0.55, 1.0, body) * 0.45;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foam);
        diffuseColor.a *= a * vFlowFade;
      }`);
  };
  m.customProgramCacheKey = () => 'np-altstadt-flow-v1';
  return m;
}

/** Wellenringe auf Wasserflächen (unbeleuchtet, additiv-hell): Quellen = Auftreffpunkte, Ringe ziehen nach außen. */
function rippleMaterial(uT, spots, bright) {
  const S = spots.slice(0, 16);
  while (S.length < 16) S.push([1e4, 1e4, 0]);
  const m = new THREE.ShaderMaterial({
    uniforms: { uWaterT: uT, uSpots: { value: S.map(([x, z, k]) => new THREE.Vector3(x, z, k)) }, uBright: { value: bright } },
    vertexShader: `varying vec3 vRW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vRW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uWaterT; uniform vec3 uSpots[16]; uniform float uBright; varying vec3 vRW;
      void main() {
        float a = 0.0;
        for (int i = 0; i < 16; i++) {
          vec3 s = uSpots[i];
          if (s.z <= 0.0) continue;
          float d = distance(vRW.xz, s.xy);
          float ph = fract(d * 5.0 - uWaterT * 1.2 + s.x * 3.1);
          float ring = smoothstep(0.0, 0.12, ph) * smoothstep(0.42, 0.14, ph);
          a += s.z * (ring * exp(-d * 4.2) * 0.75 + exp(-d * d * 260.0) * 0.6);
        }
        a = clamp(a, 0.0, 0.85);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.92, 0.97, 1.0) * uBright, a);
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  m.name = 'brunnen-wellen';
  m.userData.disposable = true;
  m.userData.noWorldShading = true;
  return m;
}

/** Geometrie-Sammler (Position, Normale, UV, Fade) mit Index. */
function geoSink() {
  const P = [], N = [], U = [], F = [], I = [];
  return {
    P, N, U, F, I,
    base: () => P.length / 3,
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('aFade', new THREE.Float32BufferAttribute(F, 1));
      g.setIndex(I);
      g.computeBoundingSphere();
      return g;
    },
  };
}

/** Wasserstrahl als Wurfparabel: from [x,y,z], Richtung (dx, dz) waagerecht, v (m/s waagerecht), vy (m/s), bis yEnd. */
function addJet(G, j) {
  const [x0, y0, z0] = j.from, v = j.v, vy = j.vy ?? 0, len = Math.hypot(j.dir[0], j.dir[1]) || 1;
  const dx = j.dir[0] / len, dz = j.dir[1] / len;
  const T = (vy + Math.sqrt(vy * vy + 2 * GRAV * Math.max(0.01, y0 - j.yEnd))) / GRAV;
  const NS = 16, M = 6, strands = j.strands ?? 3, base = G.base();
  let s = 0, prev = null;
  for (let i = 0; i <= NS; i++) {
    const t = (i / NS) * T;
    const c = [x0 + dx * v * t, y0 + vy * t - 0.5 * GRAV * t * t, z0 + dz * v * t];
    if (prev) s += Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]);
    prev = c;
    const tg = new THREE.Vector3(dx * v, vy - GRAV * t, dz * v).normalize();
    const side = new THREE.Vector3().crossVectors(tg, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, tg).normalize();
    const r = j.r0 + (j.r1 - j.r0) * (i / NS);
    for (let k = 0; k <= M; k++) {
      const a = (k / M) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = side.x * ca + up.x * sa, ny = side.y * ca + up.y * sa, nz = side.z * ca + up.z * sa;
      G.P.push(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r);
      G.N.push(nx, ny, nz);
      G.U.push((k / M) * strands, s);
      G.F.push(i === NS ? 0.5 : 1);
    }
  }
  for (let i = 0; i < NS; i++) for (let k = 0; k < M; k++) {
    const a = base + i * (M + 1) + k, c = a + M + 1;
    G.I.push(a, c, a + 1, a + 1, c, c + 1);
  }
  return [x0 + dx * v * T, z0 + dz * v * T];
}

/**
 * Überlaufbahn (Wasserfilm) über einen Rand: Kreisbogen a0..a1 um (x, z) mit Radius r0 auf Höhe y0, fällt mit
 * Anfangsgeschwindigkeit v nach außen bis yEnd. → Radius beim Auftreffen.
 */
function addSheet(G, c) {
  const { x, z, r0, y0, yEnd, v } = c, a0 = c.a0 ?? 0, a1 = c.a1 ?? Math.PI * 2;
  const T = Math.sqrt(2 * Math.max(0.01, y0 - yEnd) / GRAV);
  const NS = 10, M = c.seg ?? Math.max(3, Math.round(((a1 - a0) * r0) / 0.12)), base = G.base();
  const strands = Math.max(1, Math.round(((a1 - a0) * r0) / 0.07));
  let s = 0;
  for (let i = 0; i <= NS; i++) {
    const t = (i / NS) * T, r = r0 + v * t, y = y0 - 0.5 * GRAV * t * t;
    if (i > 0) { const tp = ((i - 1) / NS) * T; s += Math.hypot(v * (t - tp), 0.5 * GRAV * (t * t - tp * tp)); }
    const ny = v / Math.hypot(v, GRAV * t + 0.3);
    for (let k = 0; k <= M; k++) {
      const a = a0 + ((a1 - a0) * k) / M, ca = Math.cos(a), sa = Math.sin(a);
      G.P.push(x + ca * r, y, z + sa * r);
      G.N.push(ca, ny, sa);
      G.U.push((k / M) * strands, s);
      G.F.push(i === 0 ? 0.7 : i === NS ? 0.45 : 1);
    }
  }
  for (let i = 0; i < NS; i++) for (let k = 0; k < M; k++) {
    const a = base + i * (M + 1) + k, cc = a + M + 1;
    G.I.push(a, cc, a + 1, a + 1, cc, cc + 1);
  }
  return r0 + v * T;
}

/**
 * Wasserspiel eines Brunnens. o: { jets: [{ from, dir, v, vy, yEnd, r0, r1 }], sheets: [{ x, z, r0, y0, yEnd, v, a0, a1 }],
 * pools: [{ x, z, y, r, seg, rot }] (Wasserflächen für die Wellenringe), extraSpots: [[x, z, k]] }. Ohne Kollision/Kugeln.
 * → { attach(G) } (gemeinsame Uhr)
 */
export function fountainWater(b, o) {
  const clock = craneClock();
  const uT = { value: 0 };
  const G = geoSink(), spots = [...(o.extraSpots || [])];
  for (const j of o.jets || []) { const [lx, lz] = addJet(G, j); spots.push([lx, lz, j.splash ?? 1]); }
  for (const c of o.sheets || []) {
    const rr = addSheet(G, c), am = ((c.a0 ?? 0) + (c.a1 ?? 0)) / 2;
    if (c.a1 != null) spots.push([c.x + Math.cos(am) * rr, c.z + Math.sin(am) * rr, c.splash ?? 0.8]);
  }
  const group = new THREE.Group();
  group.name = 'brunnen-wasserspiel';
  const flow = new THREE.Mesh(G.build(), flowMaterial(uT));
  flow.name = 'brunnen-strahlen'; flow.castShadow = false; flow.receiveShadow = false; flow.renderOrder = 3;
  group.add(flow);
  if (o.pools?.length) {
    // Wasserflächen als Scheiben (Umriss der Fläche: keine Ringe über dem Beckenrand)
    const P = [], I = [];
    for (const p of o.pools) {
      const k = P.length / 3, n = p.seg ?? 20, a0 = p.rot ?? 0;
      P.push(p.x, p.y, p.z);
      for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; P.push(p.x + Math.cos(a) * p.r, p.y, p.z + Math.sin(a) * p.r); }
      for (let i = 0; i < n; i++) I.push(k, k + 1 + ((i + 1) % n), k + 1 + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    g.computeBoundingSphere();
    const rip = new THREE.Mesh(g, rippleMaterial(uT, spots, LOOK.night ? 0.32 : 1));
    rip.name = 'brunnen-wellen'; rip.renderOrder = 2; rip.castShadow = false; rip.receiveShadow = false;
    group.add(rip);
  }
  group.traverse((m) => { m.matrixAutoUpdate = false; m.updateMatrix(); });
  b.object(group, { update: () => { uT.value = ((clock.now() % T_WRAP) + T_WRAP) % T_WRAP; } });
  return { attach(g) { clock.attach(g); } };
}

// ---------------------------------------------------------------------------
// Möbel (prozedural; Kollision nur für große Teile, Kleinkram ohne)
// ---------------------------------------------------------------------------
/** Tisch. y = Fußboden, lokal w entlang x. o: { ry, w, d, h, tint, cloth (Läufer-Farbe), round } */
export function table(b, x, y, z, o = {}) {
  const f = frame(b, x, y, z, o.ry || 0), w = o.w ?? 1.6, d = o.d ?? 0.9, h = o.h ?? 0.76, tint = o.tint || '#8a6440';
  f.box(0, h - 0.045, 0, w, 0.045, d, 'wood_planks', { tint, ...VG });
  f.box(0, h - 0.13, 0, w - 0.16, 0.085, d - 0.16, 'wood_dark', { tint: '#5a3f2b', ...VG });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07), 0.06, h - 0.045, 0.06, 'wood_dark', { tint: '#5a3f2b', ...VIS });
  if (o.cloth) f.box(0, h, 0, Math.max(0.3, w - 0.5), 0.006, d + 0.08, 'tarp', { tint: o.cloth, ...VG, ao: false });
  f.solid(0, 0, 0, w, h, d, { minimap: 'cover' });
}

/** Stühle um einen Tisch (lokal wie table): je Längsseite n Stühle, Blick zum Tisch. */
export function tableChairs(b, x, y, z, o = {}) {
  const ry = o.ry || 0, f = frame(b, x, y, z, ry), w = o.w ?? 1.6, d = o.d ?? 0.9, n = o.n ?? 2;
  for (const sz of o.sides || [-1, 1]) for (let i = 0; i < n; i++) {
    const lx = n === 1 ? 0 : -w / 2 + 0.35 + (i * (w - 0.7)) / (n - 1);
    const [cx, cz] = f.P(lx, sz * (d / 2 + 0.3));
    chair(b, cx, cz, { y, ry: ry + (sz > 0 ? Math.PI : 0) + (o.jitter ? (i - 0.5) * 0.12 : 0), tint: o.tint || '#7a5a3a' });
  }
}

/** Bett (Kopfende lokal −z). o: { w (1,4 Doppel / 0,95 Einzel), l, tint (Decke), wood } */
export function bed(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry), w = o.w ?? 1.4, l = o.l ?? 2.0, wood = o.wood || '#6a4a32';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.04), 0, sz * (l / 2 - 0.04), 0.07, 0.16, 0.07, 'wood_dark', { tint: wood, ...VIS });
  f.box(0, 0.14, 0, w, 0.18, l, 'wood_dark', { tint: wood, ...VIS });
  f.box(0, 0.32, 0.01, w - 0.06, 0.15, l - 0.06, 'tarp', { tint: '#ece6da', ...VG });
  f.box(0, 0.37, 0.23, w + 0.02, 0.12, l * 0.74, 'tarp', { tint: o.tint || '#6f86a8', ...VG });         // Decke (über die Kante)
  f.box(0, 0.49, 0.23 - l * 0.37 + 0.08, w - 0.02, 0.03, 0.16, 'tarp', { tint: '#f2eee6', ...VG, ao: false }); // Umschlag
  const np = w > 1.1 ? 2 : 1;
  for (let i = 0; i < np; i++) f.box(np === 1 ? 0 : (i ? 1 : -1) * (w / 4 - 0.02), 0.47, -l / 2 + 0.24, w / np - 0.14, 0.1, 0.36, 'tarp', { tint: '#f6f3ec', ...VG });
  f.box(0, 0, -l / 2 - 0.03, w + 0.08, 0.95, 0.06, 'wood_dark', { tint: wood, ...VIS });               // Kopfteil
  f.box(0, 0, l / 2 + 0.02, w + 0.06, 0.5, 0.05, 'wood_dark', { tint: wood, ...VIS });                 // Fußteil
  f.solid(0, 0, 0, w + 0.06, 0.52, l + 0.08, { minimap: 'cover' });
}

/** Kleiderschrank / Vitrine (Front lokal +z). o: { w, d, h, tint, doors } */
export function wardrobe(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry), w = o.w ?? 1.2, d = o.d ?? 0.58, h = o.h ?? 2.0, tint = o.tint || '#6a4a32';
  f.box(0, 0.07, 0, w, h - 0.07, d, 'wood_dark', { tint, ...VIS });
  f.box(0, 0, 0.02, w - 0.06, 0.07, d - 0.06, 'wood_dark', { tint: '#3a2a1e', ...VIS });
  f.box(0, h, 0, w + 0.06, 0.05, d + 0.05, 'wood_dark', { tint, ...VG });
  const nd = o.doors ?? (w > 0.8 ? 2 : 1);
  for (let i = 1; i < nd; i++) f.box(-w / 2 + (i * w) / nd, 0.12, d / 2 + 0.002, 0.012, h - 0.2, 0.006, 'black', { ...VG, ao: false });
  for (let i = 0; i < nd; i++) {
    const cx = -w / 2 + ((i + 0.5) * w) / nd + (nd > 1 ? (i ? -1 : 1) * (w / nd / 2 - 0.07) : w / 2 - 0.1);
    f.box(cx, h * 0.48, d / 2 + 0.012, 0.022, 0.14, 0.02, 'metal_painted', { tint: '#b08a3a', ...VG, ao: false });
  }
  f.solid(0, 0, 0, w, h, d, { minimap: 'cover' });
}

/** Kommode / Anrichte (Front +z) mit Schubladen. */
export function dresser(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry), w = o.w ?? 1.3, d = o.d ?? 0.48, h = o.h ?? 0.86, tint = o.tint || '#7a5a40';
  f.box(0, 0.06, 0, w, h - 0.06, d, 'wood_dark', { tint, ...VIS });
  f.box(0, h, 0, w + 0.04, 0.035, d + 0.03, 'wood_planks', { tint: '#9a7452', ...VG });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 0.05, 0.06, 0.05, 'wood_dark', { tint: '#3a2a1e', ...VIS });
  for (let k = 1; k < 3; k++) f.box(0, 0.06 + (k * (h - 0.06)) / 3, d / 2 + 0.002, w - 0.06, 0.012, 0.006, 'black', { ...VG, ao: false });
  for (let k = 0; k < 3; k++) for (const sx of [-0.25, 0.25]) f.box(sx * w, 0.06 + ((k + 0.5) * (h - 0.06)) / 3, d / 2 + 0.012, 0.09, 0.018, 0.018, 'metal_painted', { tint: '#b08a3a', ...VG, ao: false });
  f.solid(0, 0, 0, w, h, d, { minimap: 'cover' });
  return f;
}

/** Nachttisch. */
export function nightstand(b, x, y, z, ry) {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0, 0.45, 0.55, 0.4, 'wood_dark', { tint: '#6a4a32', ...VIS });
  f.box(0, 0.4, 0.201, 0.08, 0.018, 0.012, 'metal_painted', { tint: '#b08a3a', ...VG, ao: false });
  // Nachttischlampe (Fuß + Schirm), Buch
  f.cyl(0.08, 0.55, -0.05, 0.05, 0.22, 'white', { r1: 0.02, tint: '#d8cbb0', seg: 8, ...VG, ao: false });
  f.cyl(0.08, 0.74, -0.05, 0.11, 0.13, 'tarp', { r1: 0.07, tint: '#efe4cf', seg: 10, ...VG, ao: false });
  f.box(-0.1, 0.55, 0.05, 0.15, 0.03, 0.21, 'tarp', { tint: '#8a3a2a', ...VG, ao: false, ry: 0.3 });
}

const GOODS_COLORS = {
  books: ['#7a2e24', '#2f4f6e', '#3c6a4a', '#b08a3a', '#5a3a5a', '#d8cbb0', '#1f2a36'],
  jars: ['#c9783a', '#a33a2a', '#d9b04a', '#6a8a3a', '#7a4a2a', '#e6dcc8'],
  bottles: ['#3a6a3a', '#7a3a2a', '#c9b48e', '#2a4a6a', '#5a6a2a'],
  cloth: ['#2f6f9a', '#c8402f', '#e0a32c', '#3c7a5a', '#efe6d4', '#8a3a7a'],
  boxes: ['#c8a878', '#b89868', '#d8c8a8', '#a88858'],
  bread: ['#c98a4a', '#b8783a', '#d9a060'],
  pharma: ['#f4f1ea', '#e6eef0', '#d8e8dc', '#f2e6d0'],
  tools: ['#c8402f', '#2f5f94', '#3d4247', '#c9a227'],
};

/** Offenes Regal (Front +z) mit Waren je Fach. goods: Schlüssel aus GOODS_COLORS (Kleinteile ohne Kollision). */
export function shelf(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry), w = o.w ?? 1.2, d = o.d ?? 0.38, h = o.h ?? 1.9, n = o.n ?? 4, tint = o.tint || '#7a5a40';
  for (const sx of [-1, 1]) f.box(sx * (w / 2 - 0.02), 0, 0, 0.04, h, d, 'wood_dark', { tint, ...VIS });
  f.box(0, 0, -d / 2 + 0.01, w - 0.06, h, 0.02, 'wood_dark', { tint: '#4a3426', ...VIS });
  const levels = [];
  for (let k = 0; k < n; k++) { const yy = 0.06 + (k * (h - 0.1)) / (n - 1); levels.push(yy); f.box(0, yy, 0.01, w - 0.06, 0.03, d - 0.02, 'wood_dark', { tint, ...VG }); }
  const kind = o.goods || 'books', cols = GOODS_COLORS[kind] || GOODS_COLORS.books, R = hrng(x, z, 77 + y);
  for (let k = 0; k < n - 1; k++) {
    if (o.skipLow && k === 0) continue;
    const yb = levels[k] + 0.03, gap = levels[k + 1] - yb - 0.04;
    let lx = -w / 2 + 0.06;
    while (lx < w / 2 - 0.12) {
      const c = cols[Math.floor(R() * cols.length)];
      if (kind === 'books') {
        const bw = 0.03 + R() * 0.04, bh = Math.min(gap, 0.2 + R() * 0.1);
        f.box(lx + bw / 2, yb, 0.02, bw, bh, d * 0.7, 'tarp', { tint: c, ...VG, ao: false, bullet: false });
        lx += bw + 0.004 + (R() < 0.1 ? 0.12 : 0);
      } else if (kind === 'jars' || kind === 'pharma') {
        const r = 0.045 + R() * 0.02;
        f.cyl(lx + r, yb, 0.02, r, Math.min(gap, 0.1 + R() * 0.06), kind === 'pharma' ? 'white' : 'glass', { tint: c, seg: 8, ...VG, ao: false, bullet: false });
        lx += 2 * r + 0.03;
      } else if (kind === 'bottles') {
        f.cyl(lx + 0.04, yb, 0.02, 0.035, Math.min(gap, 0.28), 'glass', { tint: c, seg: 6, ...VG, ao: false, bullet: false });
        lx += 0.09;
      } else if (kind === 'bread') {
        const s = 0.09 + R() * 0.04;
        f.cyl(lx + s, yb, 0.02, s, 0.07, 'wood_crate', { r1: s * 0.8, tint: c, seg: 8, ...VG, ao: false, bullet: false });
        lx += 2 * s + 0.03;
      } else if (kind === 'cloth') {
        const bw = 0.3 + R() * 0.12, bh = Math.min(gap, 0.12 + R() * 0.12);
        f.box(lx + bw / 2, yb, 0.02, bw, bh, d * 0.8, 'tarp', { tint: c, ...VG, ao: false, bullet: false });
        lx += bw + 0.03;
      } else {
        const bw = 0.2 + R() * 0.14, bh = Math.min(gap, 0.14 + R() * 0.14);
        f.box(lx + bw / 2, yb, 0.02, bw, bh, d * 0.8, kind === 'tools' ? 'metal_painted' : 'cardboard', { tint: c, ...VG, ao: false, bullet: false });
        lx += bw + 0.04;
      }
    }
  }
  f.solid(0, 0, 0, w, h, d, { minimap: 'cover' });
}

/** Küchenzeile entlang lokal x (Front +z, Rückseite an der Wand): Unterschränke, Arbeitsplatte, Spüle, Herd, Fliesen, Hängeschränke. */
export function kitchen(b, x, y, z, ry, o = {}) {
  const f = frame(b, x, y, z, ry), L = o.len ?? 2.4, d = 0.6, h = 0.86, tint = o.tint || '#e2dccb';
  f.box(0, 0.09, 0, L, h - 0.09, d, 'wood_painted', { tint, ...VIS });
  f.box(0, 0, 0.03, L - 0.02, 0.09, d - 0.08, 'wood_dark', { tint: '#3a2e24', ...VIS });
  f.box(0, h, 0.01, L + 0.02, 0.04, d + 0.03, 'stone_wall', { tint: '#d8d0bf', ...VG });
  const nd = Math.max(2, Math.round(L / 0.6));
  for (let i = 1; i < nd; i++) f.box(-L / 2 + (i * L) / nd, 0.13, d / 2 + 0.002, 0.01, h - 0.17, 0.006, 'black', { ...VG, ao: false });
  for (let i = 0; i < nd; i++) f.box(-L / 2 + ((i + 0.5) * L) / nd, h - 0.13, d / 2 + 0.012, 0.13, 0.018, 0.018, 'metal_galvanized', { ...VG, ao: false });
  // Spüle mit Hahn (links), Herd mit vier Kochstellen (rechts)
  f.box(-L / 2 + 0.42, h + 0.035, 0.03, 0.52, 0.012, 0.4, 'metal_galvanized', { ...VG, ao: false });
  f.cyl(-L / 2 + 0.42, h + 0.04, -0.22, 0.018, 0.26, 'metal_galvanized', { seg: 6, ...VG, ao: false });
  f.box(-L / 2 + 0.42, h + 0.27, -0.16, 0.025, 0.025, 0.14, 'metal_galvanized', { ...VG, ao: false });
  f.box(L / 2 - 0.4, h + 0.04, 0.03, 0.58, 0.02, 0.5, 'black', { ...VG, ao: false });
  for (const sx of [-0.13, 0.13]) for (const sz of [-0.11, 0.15]) f.cyl(L / 2 - 0.4 + sx, h + 0.06, sz, 0.075, 0.012, 'metal_galvanized', { seg: 10, ...VG, ao: false });
  // Topf auf dem Herd
  f.cyl(L / 2 - 0.27, h + 0.072, 0.15, 0.1, 0.13, 'metal_galvanized', { seg: 10, ...VG, ao: false, bullet: false });
  // Fliesenspiegel + Hängeschränke
  f.box(0, h + 0.04, -d / 2 + 0.012, L, 0.6, 0.02, 'tiles', { tint: '#e3ecee', ...VG, ao: false });
  if (o.upper !== false) {
    f.box(0, h + 0.66, -d / 2 + 0.17, L, 0.62, 0.34, 'wood_painted', { tint, ...VIS });
    for (let i = 1; i < nd; i++) f.box(-L / 2 + (i * L) / nd, h + 0.69, -d / 2 + 0.342, 0.01, 0.56, 0.006, 'black', { ...VG, ao: false });
  }
  f.solid(0, 0, 0, L, h + 0.04, d, { minimap: 'cover' });
}

/** Sessel (Front +z): Polster, Lehne, Armlehnen. */
export function armchair(b, x, y, z, ry, tint = '#7a3a2a') {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0.08, 0.02, 0.72, 0.36, 0.7, 'tarp', { tint, ...VIS });
  f.box(0, 0.44, -0.27, 0.72, 0.46, 0.16, 'tarp', { tint, ...VIS, rx: -0.12 });
  for (const sx of [-1, 1]) f.box(sx * 0.31, 0.08, 0.02, 0.12, 0.58, 0.7, 'tarp', { tint, ...VIS });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * 0.3, 0, sz * 0.28, 0.05, 0.08, 0.05, 'wood_dark', { tint: '#3a2a1e', ...VIS });
  f.solid(0, 0, 0, 0.74, 0.6, 0.72, { minimap: 'prop' });
}

/** Pendelleuchte unter der Decke (yC = Deckenunterseite) mit gebackenem Licht (kostenlos zur Laufzeit). */
export function pendant(b, x, yC, z, o = {}) {
  const drop = o.drop ?? 0.75, yS = yC - drop, r = o.r ?? 0.22;
  b.cyl(x, yC - 0.035, z, 0.07, 0.035, 'metal_painted', { tint: IRON, seg: 8, ...VG, ao: false });
  b.cyl(x, yS + 0.17, z, 0.008, drop - 0.2, 'black', { seg: 4, ...VG, ao: false, bullet: false });
  b.cyl(x, yS, z, r, 0.2, 'metal_painted', { r1: 0.05, seg: 12, tint: o.tint || '#2f5f4a', ...VG });
  b.cyl(x, yS - 0.06, z, 0.055, 0.07, 'lamp_warm', { seg: 8, ...VG, ao: false, cast: false });
  if (o.light !== false) b.light('point', x, yS - 0.2, z, { color: '#ffd29a', intensity: o.intensity ?? 11, distance: o.distance ?? 9, realtime: o.realtime === true && LOOK.rt, priority: 1, group: 0 });
}

/** Deckenleuchte flach (Glasschale) mit gebackenem Licht. */
export function ceilingLamp(b, x, yC, z, o = {}) {
  b.cyl(x, yC - 0.05, z, 0.16, 0.05, 'metal_painted', { tint: '#d8d0c0', seg: 10, ...VG, ao: false });
  b.cyl(x, yC - 0.13, z, 0.15, 0.08, 'lamp_warm', { r1: 0.2, seg: 12, ...VG, ao: false, cast: false });
  if (o.light !== false) b.light('point', x, yC - 0.4, z, { color: '#ffdcae', intensity: o.intensity ?? 9, distance: o.distance ?? 9, realtime: false, priority: 1, group: 0 });
}

/** Teppich (flach, ohne Kollision). */
export function rug(b, x, y, z, w, d, ry, tint, border = '#e8dcc4') {
  b.box(x, y + 0.002, z, w, 0.01, d, 'tarp', { tint: border, ry, ...VG, ao: false, bullet: false });
  b.box(x, y + 0.004, z, w - 0.18, 0.01, d - 0.18, 'tarp', { tint, ry, ...VG, ao: false, bullet: false });
}

/** Bild an der Wand (Mitte x/y/z vor der Wand, ry = Blickrichtung aus der Wand). */
export function picture(b, x, y, z, ry, w = 0.7, h = 0.5, tint = '#4a6a8a') {
  const f = frame(b, x, y, z, ry);
  f.box(0, 0, 0.015, w, h, 0.03, 'wood_dark', { tint: '#5a3f2b', ...VG, ao: false });
  f.box(0, 0.05, 0.032, w - 0.1, h - 0.1, 0.006, 'tarp', { tint, ...VG, ao: false });
  f.box(-w * 0.12, h * 0.42, 0.036, w * 0.4, h * 0.2, 0.004, 'tarp', { tint: '#d9b04a', ...VG, ao: false });
}

/** Weinfässer liegend auf einem Gestell (Front +z). */
export function barrelRack(b, x, y, z, ry, n = 3) {
  const f = frame(b, x, y, z, ry), w = n * 0.72;
  for (const sz of [-0.25, 0.25]) f.box(0, 0, sz, w, 0.22, 0.1, 'wood_dark', { tint: '#4a3426', ...VIS });
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + 0.36 + i * 0.72;
    f.cyl(lx, 0.55, 0, 0.32, 0.8, 'wood_planks', { axis: 'z', tint: '#8a5a3a', seg: 14, ...VIS });
    for (const sz of [-0.28, 0.28]) f.cyl(lx, 0.55, sz, 0.335, 0.05, 'metal_painted', { axis: 'z', tint: IRON, seg: 14, ...VG, ao: false });
    f.cyl(lx, 0.55, 0.42, 0.04, 0.06, 'wood_dark', { axis: 'z', tint: '#3a2a1e', seg: 6, ...VG, ao: false });
  }
  f.solid(0, 0, 0, w, 0.9, 0.86, { minimap: 'cover' });
}

/** Sackstapel (Mehl/Gewürze), ohne Palette; Kollision nur bei großen Stapeln. */
export function sacks(b, x, y, z, ry, n = 4, tint = '#d8ccb0') {
  const f = frame(b, x, y, z, ry), R = hrng(x, z, 5);
  for (let i = 0; i < n; i++) {
    const lx = ((i % 2) - 0.5) * 0.5, lz = (Math.floor(i / 2) % 2 - 0.5) * 0.34, ly = Math.floor(i / 4) * 0.24;
    f.box(lx, ly, lz, 0.46, 0.24, 0.32, 'tarp', { tint, ...VIS, ry: (R() - 0.5) * 0.2, ao: false });
  }
  if (n >= 4) f.solid(0, 0, 0, 1.0, 0.24 * Math.ceil(n / 4), 0.7, { minimap: 'prop' });
}
