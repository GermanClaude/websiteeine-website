// NULLPUNKT — Atmosphäre (Realismus-Plan R6, Welt-Teil; Owner: world): Sonnenstrahlen durch Fenster/Tore und
// schwebender Staub – je Kartenstimmung, günstig auf allen Stufen.
//
//   • Strahlen: für jede Öffnung (arch.wall), durch die die Sonne in einen dunklen Innenraum fällt, ein schräger
//     Lichtkörper bis zum Boden. Ein Zeichenaufruf für alle; der Shader rechnet die Weglänge des Blickstrahls durch
//     den Körper analytisch (Vorder-/Rückseiten, Kamera auch innen), Vorwärtsstreuung, weiche Ränder, Staubschlieren.
//   • Staub: Punktwolke um die Kamera (weltfest, umlaufend), leuchtet im Sonnenlicht (Schattenkarten der Nah- und
//     Fernkaskade bzw. Sonnensicht der Sonden) und matt im Himmels-/Lampenlicht; ein Zeichenaufruf.
import * as THREE from 'three';
import { WS } from './shading.js';

/** Stufen: max. Strahlen, Staubteilchen. */
const TIERS = { low: { beams: 10, dust: 140 }, medium: { beams: 20, dust: 260 }, high: { beams: 32, dust: 420 }, ultra: { beams: 48, dust: 620 } };

const BEAM_VERT = /* glsl */ `
attribute vec3 aO;   // Mitte der Öffnung (Innenseite)
attribute vec3 aR0;  // Zeilen der inversen Basis (U·w/2, V·h/2, D): lokal = R · (P − O)
attribute vec3 aR1;
attribute vec3 aR2;
attribute vec4 aEnd; // Endebene (Normale zur Öffnung hin, Abstand): dot(P, n) − d ≥ 0 vor dem Boden
attribute vec2 aK;   // x: Stärke, y: Länge (m)
varying vec3 vW; varying vec3 vO; varying vec3 vR0; varying vec3 vR1; varying vec3 vR2; varying vec4 vEnd; varying vec2 vK;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xyz; vO = aO; vR0 = aR0; vR1 = aR1; vR2 = aR2; vEnd = aEnd; vK = aK;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;     // Sonne (linear) × Stärke der Karte
uniform vec3 uSunDir;    // zur Sonne
uniform float uTime;
uniform float uG;        // Henyey-Greenstein
varying vec3 vW; varying vec3 vO; varying vec3 vR0; varying vec3 vR1; varying vec3 vR2; varying vec4 vEnd; varying vec2 vK;
#include <logdepthbuf_pars_fragment>
float npHG( float c, float g ) { float g2 = g * g; return ( 1.0 - g2 ) / ( 12.566 * pow( max( 1.0 + g2 - 2.0 * g * c, 1e-3 ), 1.5 ) ); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 C = cameraPosition;
  vec3 Rd = vW - C;
  float tw = length( Rd );
  Rd /= max( tw, 1e-4 );
  // Strahl in Körperkoordinaten: a, b ∈ [−1, 1], c ∈ [0, L]
  vec3 o = vec3( dot( vR0, C - vO ), dot( vR1, C - vO ), dot( vR2, C - vO ) );
  vec3 d = vec3( dot( vR0, Rd ), dot( vR1, Rd ), dot( vR2, Rd ) );
  vec3 lo = vec3( -1.0, -1.0, 0.0 ), hi = vec3( 1.0, 1.0, vK.y );
  vec3 inv = 1.0 / mix( d, vec3( 1e-5 ), lessThan( abs( d ), vec3( 1e-5 ) ) );
  vec3 t0 = ( lo - o ) * inv, t1 = ( hi - o ) * inv;
  vec3 tn = min( t0, t1 ), tf = max( t0, t1 );
  float tin = max( max( tn.x, tn.y ), max( tn.z, 0.0 ) );
  float tout = min( min( tf.x, tf.y ), tf.z );
  // Endebene (Boden): vor dem Treffer
  float dn = dot( Rd, vEnd.xyz ), s0 = dot( C, vEnd.xyz ) - vEnd.w;
  if ( abs( dn ) > 1e-5 ) { float tp = -s0 / dn; if ( dn < 0.0 ) tout = min( tout, tp ); else tin = max( tin, tp ); }
  else if ( s0 < 0.0 ) discard;
  // Vorderseite: Eintritt hier; Rückseite: nur wenn die Kamera im Körper steht (sonst zeichnet die Vorderseite)
  if ( gl_FrontFacing ) tin = max( tin, tw - 0.02 );
  else if ( tin > 1e-3 ) discard;
  tout = min( tout, gl_FrontFacing ? 1e6 : tw );
  float len = tout - tin;
  if ( len <= 0.0 ) discard;
  vec3 mid = o + d * ( 0.5 * ( tin + tout ) );
  float edge = ( 1.0 - smoothstep( 0.45, 1.0, abs( mid.x ) ) ) * ( 1.0 - smoothstep( 0.4, 1.0, abs( mid.y ) ) );
  float along = smoothstep( 0.0, 0.6, mid.z ) * ( 1.0 - 0.55 * smoothstep( 0.0, vK.y, mid.z ) );
  // Staubschlieren (langsam ziehend)
  float n = 0.75 + 0.25 * sin( mid.x * 7.0 + uTime * 0.31 + mid.z * 0.9 ) * sin( mid.y * 5.3 - uTime * 0.23 + mid.z * 1.7 );
  // Phase: Vorwärtsstreuung (zur Sonne hin heller) + isotroper Anteil; Blick längs des Strahls begrenzt
  float ph = 0.35 + 0.65 * npHG( dot( Rd, uSunDir ), uG ) * 12.566;
  float a = vK.x * min( len, 4.0 ) * edge * along * n * ph;
  a = a / ( 1.0 + a ); // weiche Sättigung (kein Ausbrennen beim Blick in die Sonne)
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform float uBox;
uniform float uScale;      // Pixel je Meter in 1 m Abstand
uniform float uSize;       // Teilchengröße (m)
uniform vec3 uSunDir;
uniform vec3 uSun;         // Sonnenfarbe × Stärke × Dichte
uniform vec3 uSky;         // Himmelslicht × Dichte
uniform highp sampler2DShadow uNearMap;
uniform mat4 uNearMatrix;
uniform float uNearOn;
uniform highp sampler2DShadow npFarMap;
uniform mat4 npFarMatrix;
uniform vec4 npFar;
uniform highp sampler3D npProbeA;
uniform highp sampler3D npProbeB;
uniform vec3 npProbeMin;
uniform vec3 npProbeSize;
uniform vec4 npProbe;
uniform vec3 npGroups[ 3 ];
attribute vec4 aSeed;      // xyz Grundlage 0..1, w Phase
varying vec3 vCol;
varying float vA;
float shadowAt( highp sampler2DShadow m, mat4 M, vec3 p, out float inside ) {
  vec4 c = M * vec4( p, 1.0 ); c.xyz /= c.w;
  inside = step( 0.0, c.x ) * step( c.x, 1.0 ) * step( 0.0, c.y ) * step( c.y, 1.0 ) * step( c.z, 1.0 );
  return inside > 0.5 ? texture( m, vec3( c.xy, c.z - 0.0015 ) ) : 1.0;
}
void main() {
  // begrenztes Schweben (± 0,3 m, Perioden ≈ 60–90 s) + langsames Absinken (1,5 cm/s, umlaufend)
  vec3 drift = ( vec3( sin( uTime * 0.11 + aSeed.w * 6.28 ), sin( uTime * 0.07 + aSeed.w * 3.1 ), cos( uTime * 0.09 + aSeed.w * 4.7 ) ) * 0.3
    - vec3( 0.0, 0.015 * uTime, 0.0 ) ) / uBox;
  vec3 b = ( aSeed.xyz + drift ) * uBox;
  vec3 p = b + uBox * floor( ( cameraPosition - b ) / uBox + 0.5 );
  vec3 rel = p - cameraPosition;
  float dist = length( rel );
  // Sonne: Nahkaskade, sonst Fernkarte bzw. Sonnensicht der Sonden
  float inN = 0.0, inF = 0.0;
  float sun = 1.0;
  if ( uNearOn > 0.5 ) sun = shadowAt( uNearMap, uNearMatrix, p, inN );
  vec3 u = ( p - npProbeMin ) / npProbeSize;
  vec4 pa = npProbe.x > 0.5 ? texture( npProbeA, u ) : vec4( 0.0, 0.0, 0.0, 1.0 );
  vec4 pb = npProbe.x > 0.5 ? texture( npProbeB, u ) : vec4( 1.0, 0.0, 0.0, 0.0 );
  if ( inN < 0.5 ) {
    if ( npFar.x > 0.5 && npFar.x < 1.5 ) sun = shadowAt( npFarMap, npFarMatrix, p, inF );
    else if ( npFar.x > 1.5 ) sun = pb.r;
  }
  float c = dot( normalize( rel ), uSunDir );
  float ph = 0.35 + 2.4 * pow( max( c, 0.0 ), 6.0 ) + 0.4 * max( c, 0.0 );
  vec3 lamp = npProbe.w > 0.5 ? pb.g * pb.g * npGroups[ 0 ] + pb.b * pb.b * npGroups[ 1 ] + pb.a * pb.a * npGroups[ 2 ] : vec3( 0.0 );
  vCol = uSun * sun * ph + uSky * pa.a + lamp * 0.02;
  float edge = 1.0 - smoothstep( 0.32, 0.5, max( max( abs( rel.x ), abs( rel.y ) ), abs( rel.z ) ) / uBox );
  vA = edge * smoothstep( 0.4, 1.4, dist ) * ( 0.6 + 0.4 * sin( uTime * 1.3 + aSeed.w * 40.0 ) );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp( uSize * uScale / max( -mv.z, 0.3 ), 1.0, 3.5 );
}`;

const DUST_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = dot( q, q ) * 4.0;
  if ( r > 1.0 ) discard;
  float a = vA * ( 1.0 - r );
  gl_FragColor = vec4( vCol * a, 1.0 );
}`;

const _v = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * Lichtschlitze im Freien (atmosphere-weather): schmale, besonnte Streifen zwischen beschatteten Bereichen (Gassen,
 * Lücken zwischen Containern/Häusern, Torbögen). Rasterabtastung über bounds in zwei Höhen; je Fund wird der Eintritt
 * des Lichts gesucht (zur Sonne hin, bis die Nachbarn nicht mehr im Schatten liegen) und als virtuelle Öffnung
 * (senkrecht zur Sonne) geliefert – die Strahlen-Logik unten behandelt sie wie Fenster. → [{x,y,z,ux,uz,w,h,t,virtual}]
 */
function findLightSlots(occluded, L, bounds, max, step = 3) {
  const out = [];
  const lh = Math.hypot(L.x, L.z);
  if (!bounds || lh < 0.05 || L.y > 0.75) return out; // steile Mittagssonne: kaum seitliche Schlitze
  const ux = -L.z / lh, uz = L.x / lh; // waagerecht, quer zur Sonne
  const hit = occluded.hit;
  const shadow = (x, y, z) => occluded(x, y, z, L.x, L.y, L.z, 140);
  const edge = (x, y, z, sgn) => {
    for (let d = 0.3; d <= 2.4; d += 0.3) if (shadow(x + ux * sgn * d, y, z + uz * sgn * d)) return d - 0.15;
    return -1;
  };
  for (let x = bounds.minX + step / 2; x < bounds.maxX; x += step) {
    for (let z = bounds.minZ + step / 2; z < bounds.maxZ; z += step) {
      if (!occluded(x, 40, z, 0, -1, 0, 60) || hit.ny < 0.7) continue;
      const gy = 40 - hit.t;
      for (const h of [1.5, 3.4]) {
        const y = gy + h;
        if (shadow(x, y, z)) continue;
        const l = edge(x, y, z, -1); if (l < 0) continue;
        const r = edge(x, y, z, 1); if (r < 0) continue;
        const w = l + r;
        if (w < 0.5 || w > 3.6) continue;
        const cx = x + ux * (r - l) / 2, cz = z + uz * (r - l) / 2;
        // Eintritt: zur Sonne laufen, bis beide Nachbarn (± w/2 + 0,5) besonnt sind (vor den Hindernissen)
        const side = w / 2 + 0.5;
        let k = 0;
        for (let s = 0.8; s <= 14; s += 0.8) {
          const px = cx + L.x * s, py = y + L.y * s, pz = cz + L.z * s;
          if (!shadow(px + ux * side, py, pz + uz * side) && !shadow(px - ux * side, py, pz - uz * side)) { k = s; break; }
        }
        if (k < 1.2) continue; // kein Durchgang (offene Fläche hinter einer einzelnen Kante)
        const ex = cx + L.x * (k - 0.4), ey = y + L.y * (k - 0.4), ez = cz + L.z * (k - 0.4);
        if (out.some((o) => (o.x - ex) ** 2 + (o.y - ey) ** 2 + (o.z - ez) ** 2 < 9)) continue;
        out.push({ x: ex, y: ey, z: ez, ux, uz, w: Math.max(0.6, w), h: 2.2, t: 0.1, virtual: true });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/**
 * opts: { quality, def (lighting-Definition der Karte), sunDir (zur Sonne), openings (MapBuilder.openings),
 *         bvh (Kugel-BVH), probes (createProbeQuery | null), sun (DirectionalLight), hemiSky (Color) }
 * → { group, update(dt, camera), dispose(), stats }
 */
export function createAtmosphere(G, { quality, def, sunDir, openings = [], bvh, probes, sun, bounds = null }) {
  const tier = TIERS[quality] || TIERS.high;
  const A = def.atmos || {};
  const group = new THREE.Group();
  group.name = 'atmos';
  const stats = { beams: 0, beamCandidates: 0, slots: 0, dust: 0, ms: 0 };
  const t0 = performance.now();
  const L = sunDir.clone().normalize();
  const sunCol = new THREE.Color(def.sun.color);
  const hit = { t: 0, tri: 0, nx: 0, ny: 0, nz: 0, data: 0 };
  const occluded = (x, y, z, dx, dy, dz, max) => bvh && bvh.raycast(x, y, z, dx, dy, dz, max, hit);
  occluded.hit = hit;

  // ------------------------------------------------------------------ Strahlen
  let beamMesh = null, beamMat = null;
  const beamStrength = A.beams ?? 0.02;
  if (beamStrength > 0 && L.y > 0.02 && bvh) {
    const cand = [];
    // Lichtschlitze im Freien (A.slots = relative Stärke; nur Karten, die es wollen) + Öffnungen ins Helle (A.outdoor)
    const slotK = A.slots ?? 0, outK = A.outdoor ?? 0;
    const slots = slotK > 0 ? findLightSlots(occluded, L, bounds, tier.beams * 2) : [];
    stats.slots = slots.length;
    for (const op of slots.length ? [...openings, ...slots] : openings) {
      const nx = -op.uz, nz = op.ux; // Wandnormale (eine Seite)
      const dn = -(L.x * nx + L.z * nz); // Lichtlaufrichtung (−L) · n
      if (Math.abs(dn) < 0.1) continue;
      const s = Math.sign(dn), inX = nx * s, inZ = nz * s; // nach innen (in Lichtrichtung)
      const half = op.t / 2 + 0.03;
      // Öffnung besonnt? Mitte + 4 Ecken (eingerückt), von außen zur Sonne
      let lit = 0;
      for (const [a, c] of [[0, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
        const px = op.x + op.ux * a * op.w / 2 - inX * half, py = op.y + c * op.h / 2, pz = op.z + op.uz * a * op.w / 2 - inZ * half;
        if (!occluded(px, py, pz, L.x, L.y, L.z, 120)) lit++;
      }
      if (lit < 2) continue;
      // Innen dunkel? (Sondenhimmel bzw. Decke über der Öffnung) – sonst (Torbogen, Gasse) nur, wenn die Luft
      // neben dem Strahl im Schatten liegt (Lichtschlitz) und die Karte Strahlen im Freien will
      const ix = op.x + inX * 1.6 - L.x * 0.8, iy = op.y - L.y * 0.8, iz = op.z + inZ * 1.6 - L.z * 0.8;
      let kOut = 1;
      const dark = !op.virtual && (probes ? probes.light(ix, iy, iz).sky <= 0.55 : occluded(ix, iy, iz, 0, 1, 0, 14));
      if (!dark) {
        if (!op.virtual && outK <= 0) continue;
        const sd = op.w / 2 + 0.7, bx = op.x + inX * 1.5 - L.x * 1.2, by = op.y - L.y * 1.2, bz = op.z + inZ * 1.5 - L.z * 1.2;
        if (!op.virtual && !(occluded(bx + op.ux * sd, by, bz + op.uz * sd, L.x, L.y, L.z, 120) && occluded(bx - op.ux * sd, by, bz - op.uz * sd, L.x, L.y, L.z, 120))) continue;
        kOut = op.virtual ? slotK : outK;
      }
      // Länge bis zum Boden/zur Wand: Endebene aus dem Mitteltreffer; trifft eine Ecke vorher etwas anderes (Zwischen-
      // wand, Regal), endet der Körper dort (sonst ragte er in den Nachbarraum)
      const ox = op.x + inX * half, oy = op.y, oz = op.z + inZ * half;
      let maxLen = 0, minHit = Infinity, blocked = false, endN = null, endD = 0;
      for (const [a, c] of [[0, 0], [-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
        const px = ox + op.ux * a * op.w / 2, py = oy + c * op.h / 2, pz = oz + op.uz * a * op.w / 2;
        const ok = occluded(px, py, pz, -L.x, -L.y, -L.z, 30);
        const len = ok ? hit.t : 30;
        if (a === 0 && c === 0) {
          if (!ok || hit.t < 0.4) { maxLen = -1; break; }
          endN = [hit.nx, hit.ny, hit.nz];
          const hx = px - L.x * hit.t, hy = py - L.y * hit.t, hz = pz - L.z * hit.t;
          endD = endN[0] * hx + endN[1] * hy + endN[2] * hz - 0.02;
        } else {
          // erwarteter Abstand bis zur Endebene: n·(p − t·L) = d → t = (n·p − d) / (n·L)
          const nl = endN[0] * L.x + endN[1] * L.y + endN[2] * L.z;
          const tPlane = Math.abs(nl) > 1e-3 ? (endN[0] * px + endN[1] * py + endN[2] * pz - endD) / nl : 30;
          if (len < tPlane - 0.35) blocked = true;
        }
        maxLen = Math.max(maxLen, len);
        minHit = Math.min(minHit, len);
      }
      if (maxLen <= 0 || !endN) continue;
      if (blocked) maxLen = minHit;
      if (maxLen < 0.6) continue;
      const area = op.w * op.h;
      cand.push({ op, s, ox, oy, oz, len: Math.min(maxLen + 0.5, 30), endN, endD, k: lit / 5, kOut, score: area * Math.min(maxLen, 10) * (lit / 5) * (kOut < 1 ? 0.7 : 1) });
    }
    stats.beamCandidates = cand.length;
    cand.sort((a, b) => b.score - a.score);
    const use = cand.slice(0, tier.beams);
    if (use.length) {
      const per = 8, idx = [];
      const P = new Float32Array(use.length * per * 3), O = new Float32Array(use.length * per * 3);
      const R0 = new Float32Array(use.length * per * 3), R1 = new Float32Array(use.length * per * 3), R2 = new Float32Array(use.length * per * 3);
      const E = new Float32Array(use.length * per * 4), K = new Float32Array(use.length * per * 2);
      const M = new THREE.Matrix3();
      use.forEach((c, i) => {
        const { op } = c;
        // (U, V, D) rechtshändig halten (Wandrichtung je nach Sonnenseite umkehren) → Außenseiten gegen den Uhrzeigersinn
        const U = new THREE.Vector3(op.ux, 0, op.uz).multiplyScalar(c.s * op.w / 2);
        const V = new THREE.Vector3(0, op.h / 2, 0);
        const D = _d.set(-L.x, -L.y, -L.z);
        // Basis-Matrix (Spalten U, V, D) → Inverse: Zeilen liefern die lokalen Koordinaten
        M.set(U.x, V.x, D.x, U.y, V.y, D.y, U.z, V.z, D.z).invert();
        const e = M.elements; // spaltenweise
        const r0 = [e[0], e[3], e[6]], r1 = [e[1], e[4], e[7]], r2 = [e[2], e[5], e[8]];
        const base = i * per;
        let k = 0;
        for (const cz of [0, c.len]) for (const cy of [-1, 1]) for (const cx of [-1, 1]) {
          const j = (base + k) * 3;
          P[j] = c.ox + U.x * cx * 1.04 + D.x * cz; P[j + 1] = c.oy + V.y * cy * 1.04 + D.y * cz; P[j + 2] = c.oz + U.z * cx * 1.04 + D.z * cz;
          O.set([c.ox, c.oy, c.oz], j); R0.set(r0, j); R1.set(r1, j); R2.set(r2, j);
          E.set([c.endN[0], c.endN[1], c.endN[2], c.endD], (base + k) * 4);
          K.set([beamStrength * (0.6 + 0.4 * c.k) * (op.glass ? 0.8 : 1) * c.kOut, c.len], (base + k) * 2);
          k++;
        }
        // Quader-Indizes (Ecken: Bit0 x, Bit1 y, Bit2 z)
        for (const f of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) {
          idx.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('aO', new THREE.BufferAttribute(O, 3));
      g.setAttribute('aR0', new THREE.BufferAttribute(R0, 3));
      g.setAttribute('aR1', new THREE.BufferAttribute(R1, 3));
      g.setAttribute('aR2', new THREE.BufferAttribute(R2, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(E, 4));
      g.setAttribute('aK', new THREE.BufferAttribute(K, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      beamMat = new THREE.ShaderMaterial({
        name: 'np:sonnenstrahlen',
        uniforms: {
          uColor: { value: sunCol.clone().multiplyScalar(def.sun.intensity) },
          uSunDir: { value: L.clone() }, uTime: { value: 0 }, uG: { value: A.beamG ?? 0.4 },
        },
        vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      beamMesh = new THREE.Mesh(g, beamMat);
      beamMesh.name = 'sonnenstrahlen';
      beamMesh.renderOrder = 6;
      beamMesh.frustumCulled = true;
      beamMesh.matrixAutoUpdate = false;
      group.add(beamMesh);
      stats.beams = use.length;
    }
  }

  // ------------------------------------------------------------------ Staub
  let dust = null, dustMat = null;
  const dustDensity = A.dust ?? 1;
  const nDust = Math.round(tier.dust * dustDensity);
  if (nDust > 0) {
    const seed = new Float32Array(nDust * 4);
    let s = 1234567;
    const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nDust * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const box = A.dustBox ?? 14;
    const hemi = new THREE.Color(def.hemi.sky).multiplyScalar((def.hemi.intensity ?? 1) * 0.06 * (A.dustSky ?? 1));
    dustMat = new THREE.ShaderMaterial({
      name: 'np:staub',
      uniforms: {
        ...WS,
        uTime: { value: 0 }, uBox: { value: box }, uScale: { value: 600 }, uSize: { value: A.dustSize ?? 0.012 },
        uSunDir: { value: L.clone() },
        uSun: { value: sunCol.clone().multiplyScalar(def.sun.intensity * 0.05 * (A.dustSun ?? 1)) },
        uSky: { value: hemi },
        uNearMap: { value: null }, uNearMatrix: { value: new THREE.Matrix4() }, uNearOn: { value: 0 },
      },
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    dust = new THREE.Points(g, dustMat);
    dust.name = 'staub';
    dust.frustumCulled = false;
    dust.renderOrder = 7;
    dust.matrixAutoUpdate = false;
    const v2 = new THREE.Vector2();
    dust.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(v2);
      dustMat.uniforms.uScale.value = v2.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 60) / 2));
      // Nahkaskade nur, wenn ihre Karte existiert (sonst Platzhalter + aus)
      const map = sun?.castShadow && sun.shadow?.map?.depthTexture;
      const u = dustMat.uniforms;
      u.uNearOn.value = map ? 1 : 0;
      u.uNearMap.value = map || WS.npFarMap.value;
      if (map) u.uNearMatrix.value.copy(sun.shadow.matrix);
    };
    group.add(dust);
    stats.dust = nDust;
  }
  stats.ms = Math.round(performance.now() - t0);

  return {
    group,
    stats,
    update(dt) {
      if (beamMat) beamMat.uniforms.uTime.value += dt;
      if (dustMat) dustMat.uniforms.uTime.value += dt;
    },
    dispose() {
      beamMesh?.geometry.dispose(); beamMat?.dispose();
      dust?.geometry.dispose(); dustMat?.dispose();
      group.removeFromParent();
    },
  };
}
