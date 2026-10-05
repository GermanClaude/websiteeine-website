// NULLPUNKT — Objektiv „Bodycam“ (R2) + Hochskalierung (R12): letzter Pass, zeichnet direkt aufs Bild.
//
// Abbildung (LensModel): Weitwinkel-Fischauge aus der Familie ρ = tan(κθ)/κ (κ = 1 geradlinig, κ = 0,5
// stereografisch). Die Bildmitte behält den Maßstab der Spielkamera (Zielen, Empfindlichkeit, HUD-Mitte
// unverändert); dafür rendert der Renderer die Szene mit einem um F größeren Sichtfeld („Überscan“), sodass die
// Bildecken genau die Ecken des gerenderten Bilds treffen – keine schwarzen Ecken, mehr Peripherie. F ist
// begrenzt (maxOverscan); reicht das nicht (sehr breite Telefone), wird κ automatisch Richtung 1 geschoben.
// Weil die Verzeichnung vom Feldwinkel abhängt, verschwindet sie beim Zoomen (ADS) von selbst – wie bei einer
// echten Optik.
//
// HUD/Namensschilder müssen dieselbe Abbildung nutzen: `renderer.lens.toScreen(ndc)` (verzerrt eine mit
// camera.project() berechnete NDC-Position, an Ort und Stelle), `fromScreen(ndc)` (Umkehrung, z. B. für
// Antippen), `project(world, out)` (Welt → Bildschirm-px). Geschlossene Formeln, keine Iteration.
//
// Pass-Varianten (defines): INLINE_GRADE (low: Belichtung, Tonemapping und LUT im selben Pass, HDR-Eingang),
// CLASSIC (nur mit INLINE_GRADE), RESAMPLE 0 = „lite“ (FXAA-Konsole + Unschärfemaske über 4 Diagonal-Taps,
// bilinear hochskaliert), 1 = RCAS (AMD FidelityFX, Skala 1), 2 = EASU (AMD FidelityFX FSR 1.0, Skala < 1,
// 12 texelFetch) + leichte Nachschärfung. FSR-Formeln nach AMD FidelityFX FSR 1.0 (MIT-Lizenz, © 2021 AMD).

import * as THREE from 'three';
import { FULLSCREEN_VERT, GLSL_COMMON } from './common.js';
import { GRADE_GLSL, gradeUniforms } from './grade.js';

const HALF_PI = Math.PI / 2;

/* ------------------------------------------------------------ Abbildung (JS) */

/** Überscan F für κ und Eckradius rc (Bildebene, Brennweite 1); Infinity, wenn die Ecke ≥ 90° läge. */
function overscanFor(kappa, rc) {
  if (kappa >= 0.99999) return 1;
  const th = Math.atan(kappa * rc) / kappa;
  if (th >= HALF_PI - 0.02) return Infinity;
  return Math.tan(th) / rc;
}

export class LensModel {
  constructor() {
    /** Verzeichnungsstärke 0..1 (0 = geradlinig). */
    this.amount = 0;
    /** Größtes Überscan-Verhältnis (Kosten/Unschärfe in der Bildmitte). */
    this.maxOverscan = 1.3;
    this.kappa = 1;
    this.F = 1;
    this.T = Math.tan((65 * Math.PI) / 360);
    this.aspect = 16 / 9;
    this.active = false;
    /** Zählt jede Änderung der Abbildung (Caches im HUD können darauf prüfen). */
    this.version = 0;
    /** Kamera des letzten Bilds (für aktuelle FOV/Seitenverhältnis in toScreen/project). */
    this.camera = null;
    this.width = 1;
    this.height = 1;
    this._fov = -1;
    this._asp = -1;
  }

  /** Stärke/Überscan setzen (Renderer, aus den Einstellungen). */
  configure({ amount = this.amount, maxOverscan = this.maxOverscan } = {}) {
    const a = Math.max(0, Math.min(1, Number(amount) || 0));
    const m = Math.max(1, Math.min(1.6, Number(maxOverscan) || 1.3));
    if (a === this.amount && m === this.maxOverscan) return;
    this.amount = a;
    this.maxOverscan = m;
    this._fov = -1;
    if (this.camera) this.update(this.camera.fov, this.camera.aspect);
  }

  /** Abbildung für vertikales Kamera-FOV (Grad) und Seitenverhältnis bestimmen (gecacht). */
  update(fovDeg, aspect) {
    if (fovDeg === this._fov && aspect === this._asp) return this;
    this._fov = fovDeg;
    this._asp = aspect;
    const T = Math.tan((Math.max(1, Math.min(170, fovDeg)) * Math.PI) / 360);
    let kappa = 1, F = 1;
    if (this.amount > 0.001) {
      const rc = Math.hypot(aspect, 1) * T;
      kappa = 1 - 0.5 * this.amount;
      F = overscanFor(kappa, rc);
      if (!(F <= this.maxOverscan)) {
        let lo = kappa, hi = 1;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          if (overscanFor(mid, rc) > this.maxOverscan) lo = mid; else hi = mid;
        }
        kappa = hi;
        F = overscanFor(kappa, rc);
      }
    }
    const changed = kappa !== this.kappa || F !== this.F || T !== this.T || aspect !== this.aspect;
    this.kappa = kappa;
    this.F = F;
    this.T = T;
    this.aspect = aspect;
    this.active = kappa < 0.99999;
    if (changed) this.version++;
    return this;
  }

  _sync() {
    const c = this.camera;
    if (c && c.isPerspectiveCamera) this.update(c.fov, c.aspect);
  }

  /**
   * Unverzerrte NDC (camera.project) → NDC auf dem Bildschirm. Ändert `v` (x, y) an Ort und Stelle und gibt es
   * zurück; z bleibt. Ohne aktives Objektiv unverändert.
   */
  toScreen(v) {
    this._sync();
    if (!this.active) return v;
    const a = this.aspect, T = this.T, k = this.kappa;
    const qx = v.x * a * T, qy = v.y * T;
    const r = Math.hypot(qx, qy);
    if (r < 1e-7) return v;
    const ro = Math.tan(k * Math.atan(r)) / k;
    const s = ro / r;
    v.x *= s;
    v.y *= s;
    return v;
  }

  /** Bildschirm-NDC → unverzerrte NDC (Umkehrung von toScreen). Punkte jenseits 90° landen weit außen. */
  fromScreen(v) {
    this._sync();
    if (!this.active) return v;
    const a = this.aspect, T = this.T, k = this.kappa;
    const qx = v.x * a * T, qy = v.y * T;
    const ro = Math.hypot(qx, qy);
    if (ro < 1e-7) return v;
    const th = Math.min(HALF_PI - 1e-4, Math.atan(k * ro) / k);
    const s = Math.tan(th) / ro;
    v.x *= s;
    v.y *= s;
    return v;
  }

  /** Örtlicher Maßstab der Abbildung an einer unverzerrten NDC-Position (≤ 1 am Rand) – für Markergrößen. */
  scaleAt(x, y) {
    this._sync();
    if (!this.active) return 1;
    const a = this.aspect, T = this.T, k = this.kappa;
    const r = Math.hypot(x * a * T, y * T);
    if (r < 1e-6) return 1;
    // tangential (ro/r) und radial (dro/dr) gemittelt
    const th = Math.atan(r);
    const ro = Math.tan(k * th) / k;
    const c = Math.cos(k * th);
    const radial = 1 / (c * c * (1 + r * r));
    return Math.sqrt((ro / r) * radial);
  }

  /**
   * Welt → Bildschirm. out = { x, y (CSS-px), ndcX, ndcY, behind } (wird angelegt, falls nicht übergeben).
   * camera: Standard = Kamera des letzten Bilds.
   */
  project(world, out = {}, camera = this.camera) {
    if (!camera) { out.x = out.y = out.ndcX = out.ndcY = 0; out.behind = true; return out; }
    _v.copy(world).applyMatrix4(camera.matrixWorldInverse);
    out.behind = _v.z > 0;
    _v.applyMatrix4(camera.projectionMatrix);
    this.toScreen(_v);
    out.ndcX = _v.x;
    out.ndcY = _v.y;
    out.x = (_v.x * 0.5 + 0.5) * this.width;
    out.y = (-_v.y * 0.5 + 0.5) * this.height;
    return out;
  }

  /** Werte für das Shader-Uniform uLens (κ, T, Seitenverhältnis, 1/F). */
  uniform(out) { return out.set(this.kappa, this.T, this.aspect, 1 / this.F); }
}

const _v = new THREE.Vector3();

/* ------------------------------------------------------------ GLSL */

const LENS_FRAG = /* glsl */ `
  ${GLSL_COMMON}
  uniform sampler2D tColor;
  uniform vec4 uSrc;          // interne Größe: w, h, 1/w, 1/h
  uniform vec4 uOut;          // Ausgabegröße
  uniform vec4 uLens;         // κ, T, Seitenverhältnis, 1/F
  uniform float uLensOn;
  uniform float uCA;          // Farbsaum (UV-Versatz in der Bildecke)
  uniform float uVig;         // natürliche Randabdunklung (cos² des Feldwinkels)
  uniform float uVigC;        // klassische Vignette
  uniform float uDamage;
  uniform float uSupp;        // Unterdrückung (Beschuss)
  uniform float uGrain;
  uniform vec2 uGrainSeed;
  uniform float uGrainScale;
  uniform float uArt;         // Kompressionsspuren
  uniform float uMotion;      // Kamerabewegung 0..1 (für Blockartefakte)
  uniform float uBlock;       // Blockgröße (Ausgabepixel)
  uniform float uBorder;
  uniform vec2 uBorderShift;
  uniform float uSharp;
  varying vec2 vUv;

#ifdef INLINE_GRADE
  ${GRADE_GLSL}
  float gE = 1.0;
  // Filterraum: belichtet + Reinhard auf dem größten Kanal (umkehrbar) → Kanten/Schärfe wie im Bildraum
  vec3 toF(vec3 c) { c *= gE; return c / (1.0 + npMax3(c)); }
  vec3 fromF(vec3 f) { return f / max(1.0 - npMax3(f), 1e-3); }
#else
  vec3 toF(vec3 c) { return c; }
  vec3 fromF(vec3 f) { return f; }
#endif

  vec3 tapC(vec2 uv) { return texture2D(tColor, uv).rgb; }
  float npRcasL(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

  // Ausgabe-UV → Quell-UV (Fischauge, Überscan); cosT = Kosinus des Feldwinkels
  vec2 lensMap(vec2 uv, out float cosT) {
    cosT = 1.0;
    if (uLensOn < 0.5) return uv;
    vec2 p = (uv * 2.0 - 1.0) * vec2(uLens.z, 1.0) * uLens.y;
    float ro = length(p);
    float k = uLens.x;
    float th = atan(k * ro) / k;
    cosT = cos(th);
    float s = ro > 1e-6 ? tan(th) / ro : 1.0;
    return p * s / (vec2(uLens.z, 1.0) * uLens.y) * uLens.w * 0.5 + 0.5;
  }

#if RESAMPLE == 2
  vec3 fetchC(ivec2 p) { return texelFetch(tColor, clamp(p, ivec2(0), ivec2(uSrc.xy) - 1), 0).rgb; }
  float easuL(vec3 c) { return c.g + 0.5 * (c.r + c.b); }
  void easuSet(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
    float dc = lD - lC, cb = lC - lB;
    float lenX = max(abs(dc), abs(cb));
    lenX = 1.0 / max(lenX, 1e-5);
    float dirX = lD - lB;
    lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
    lenX *= lenX;
    float ec = lE - lC, ca = lC - lA;
    float lenY = max(abs(ec), abs(ca));
    lenY = 1.0 / max(lenY, 1e-5);
    float dirY = lE - lA;
    lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
    lenY *= lenY;
    dir += vec2(dirX, dirY) * w;
    len += (lenX + lenY) * w;
  }
  void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
    vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * (-dir.y) + off.y * dir.x) * len;
    float d2 = min(dot(v, v), clp);
    float wB = 0.4 * d2 - 1.0;
    float wA = lob * d2 - 1.0;
    wB *= wB; wA *= wA;
    wB = 1.5625 * wB - 0.5625;
    float w = wB * wA;
    aC += c * w; aW += w;
  }
#endif

  void main() {
#ifdef INLINE_GRADE
    gE = npExposure();
#endif
    float cosT;
    vec2 uvs = lensMap(vUv, cosT);
    vec2 px = uSrc.zw;
    vec3 col, base, blur;
    float sharpLim = 1.0;

#if RESAMPLE == 0
    vec3 cM = toF(tapC(uvs));
    vec3 cNW = toF(tapC(uvs + vec2(-0.5, 0.5) * px));
    vec3 cNE = toF(tapC(uvs + vec2(0.5, 0.5) * px));
    vec3 cSW = toF(tapC(uvs + vec2(-0.5, -0.5) * px));
    vec3 cSE = toF(tapC(uvs + vec2(0.5, -0.5) * px));
    float lM = npLuma(cM), lNW = npLuma(cNW), lNE = npLuma(cNE), lSW = npLuma(cSW), lSE = npLuma(cSE);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    base = cM;
    blur = 0.25 * (cNW + cNE + cSW + cSE);
    col = cM;
    if (lMax - lMin > max(0.045, lMax * 0.15)) {
      // FXAA (Konsolenvariante): entlang der Kante mischen
      float gx = (lNE + lSE) - (lNW + lSW);
      float gy = (lNW + lNE) - (lSW + lSE);
      vec2 dir = vec2(-gy, gx);
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
      dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -6.0, 6.0) * px;
      vec3 a = 0.5 * (toF(tapC(uvs - dir * (1.0 / 6.0))) + toF(tapC(uvs + dir * (1.0 / 6.0))));
      vec3 b = a * 0.5 + 0.25 * (toF(tapC(uvs - dir * 0.5)) + toF(tapC(uvs + dir * 0.5)));
      float lb = npLuma(b);
      col = (lb < lMin || lb > lMax) ? a : b;
    } else if (uSharp > 0.0) {
      vec3 mn = min(min(min(cNW, cNE), min(cSW, cSE)), cM);
      vec3 mx = max(max(max(cNW, cNE), max(cSW, cSE)), cM);
      col = clamp(cM + (cM - blur) * (uSharp * 1.6), mn, mx);
    }
#elif RESAMPLE == 1
    // RCAS (FidelityFX): Kreuz b/d/f/h um e
    vec3 e = tapC(uvs);
    vec3 b = tapC(uvs + vec2(0.0, px.y)), d = tapC(uvs - vec2(px.x, 0.0));
    vec3 f = tapC(uvs + vec2(px.x, 0.0)), h = tapC(uvs - vec2(0.0, px.y));
    base = e;
    blur = 0.25 * (b + d + f + h);
    col = e;
    if (uSharp > 0.0) {
      vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
      vec3 hitMin = min(mn4, e) / (4.0 * mx4 + 1e-4);
      vec3 hitMax = (1.0 - max(mx4, e)) / (4.0 * mn4 - 4.0 - 1e-4);
      vec3 lobeRGB = max(-hitMin, hitMax);
      float lobe = max(-0.1875, min(npMax3(lobeRGB), 0.0)) * uSharp;
      float bL = npRcasL(b), dL = npRcasL(d), fL = npRcasL(f), hL = npRcasL(h), eL = npRcasL(e);
      float nz = 0.25 * (bL + dL + fL + hL) - eL;
      float rng = max(max(max(bL, dL), max(fL, hL)), eL) - min(min(min(bL, dL), min(fL, hL)), eL);
      nz = clamp(abs(nz) / max(rng, 1e-4), 0.0, 1.0);
      lobe *= 1.0 - 0.5 * nz;
      col = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
    }
#else
    // EASU (FidelityFX FSR 1.0): 12 Taps, richtungsabhängiges Lanczos-2 mit Entklingeln
    vec2 pp = uvs * uSrc.xy - 0.5;
    vec2 fp = floor(pp);
    pp -= fp;
    ivec2 ip = ivec2(fp);
    vec3 bC = fetchC(ip + ivec2(0, -1)), cC = fetchC(ip + ivec2(1, -1));
    vec3 eC = fetchC(ip + ivec2(-1, 0)), fC = fetchC(ip), gC = fetchC(ip + ivec2(1, 0)), hC = fetchC(ip + ivec2(2, 0));
    vec3 iC = fetchC(ip + ivec2(-1, 1)), jC = fetchC(ip + ivec2(0, 1)), kC = fetchC(ip + ivec2(1, 1)), lC = fetchC(ip + ivec2(2, 1));
    vec3 nC = fetchC(ip + ivec2(0, 2)), oC = fetchC(ip + ivec2(1, 2));
    float bL = easuL(bC), cL = easuL(cC), eL = easuL(eC), fL = easuL(fC), gL = easuL(gC), hL = easuL(hC);
    float iL = easuL(iC), jL = easuL(jC), kL = easuL(kC), lL = easuL(lC), nL = easuL(nC), oL = easuL(oC);
    vec2 dir = vec2(0.0);
    float len = 0.0;
    easuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    easuSet(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    easuSet(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    easuSet(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
    vec2 dir2 = dir * dir;
    float dirR = dir2.x + dir2.y;
    bool zro = dirR < 1.0 / 32768.0;
    dirR = zro ? 1.0 : inversesqrt(dirR);
    dir.x = zro ? 1.0 : dir.x;
    dir *= dirR;
    len = len * 0.5;
    len *= len;
    float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
    float clp = 1.0 / lob;
    vec3 aC = vec3(0.0);
    float aW = 0.0;
    easuTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, bC);
    easuTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, cC);
    easuTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, iC);
    easuTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, jC);
    easuTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, fC);
    easuTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, eC);
    easuTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, kC);
    easuTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, lC);
    easuTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, hC);
    easuTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, gC);
    easuTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, oC);
    easuTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, nC);
    vec3 mn4 = min(min(fC, gC), min(jC, kC)), mx4 = max(max(fC, gC), max(jC, kC));
    col = clamp(aC / aW, mn4, mx4);
    base = mix(mix(fC, gC, pp.x), mix(jC, kC, pp.x), pp.y);
    blur = 0.25 * (fC + gC + jC + kC);
    if (uSharp > 0.0) col = clamp(col + (col - base) * (uSharp * 0.6), mn4, mx4);
#endif

    // Farbsaum (laterale chromatische Aberration): R/B radial versetzt, Detail aus der Rekonstruktion übernommen
    vec2 dC = vUv - 0.5;
    float rN = length(dC * vec2(uLens.z, 1.0)) / length(vec2(uLens.z, 1.0) * 0.5); // 0 Mitte … 1 Ecke
    if (uLensOn > 0.5 && uCA > 0.0) {
      vec2 off = (uvs - 0.5) * (uCA * rN * rN * 1.41421);
      vec3 cr = toF(tapC(uvs + off)), cb = toF(tapC(uvs - off));
      col.r = max(cr.r + (col.r - base.r), 0.0);
      col.b = max(cb.b + (col.b - base.b), 0.0);
    }
    // Unterdrückung: Randunschärfe (zwei radiale Taps)
    if (uSupp > 0.01) {
      vec2 dd = (uvs - 0.5) * (0.018 * uSupp * rN * rN);
      vec3 sb = 0.5 * (toF(tapC(uvs + dd)) + toF(tapC(uvs - dd)));
      col = mix(col, sb, smoothstep(0.25, 0.95, rN) * min(1.0, uSupp * 1.5));
    }
    // Kompression: Farbe in halber Auflösung (4:2:0), bei schneller Bewegung im Dunkeln 8×8-Blöcke
    if (uArt > 0.0) {
      float y = npLuma(col);
      col = mix(col, blur * (y / max(npLuma(blur), 1e-4)), uArt * 0.75);
      float dark = 1.0 - smoothstep(0.06, 0.32, y);
      float wb = uArt * uMotion * dark;
      if (wb > 0.02) {
        vec2 cell = (floor(gl_FragCoord.xy / uBlock) + 0.5) * uBlock * uOut.zw;
        float ct;
        vec2 cs = lensMap(cell, ct);
        vec2 q = uBlock * 0.25 * uOut.zw * uLens.w;
        vec3 avg = 0.25 * (toF(tapC(cs + vec2(-q.x, -q.y))) + toF(tapC(cs + vec2(q.x, -q.y))) + toF(tapC(cs + vec2(-q.x, q.y))) + toF(tapC(cs + q)));
        col = mix(col, avg + (col - avg) * 0.3, min(0.7, wb * 1.4));
      }
    }

#ifdef INLINE_GRADE
    vec3 c = npGrade(fromF(col));
#else
    vec3 c = col;
#endif

    // Randabdunklung: natürlich (Feldwinkel), klassisch (radial), Unterdrückung, Schaden
    float lum = npLuma(c);
    c *= mix(1.0, cosT * cosT, uVig);
    c *= 1.0 - uVigC * smoothstep(0.35, 1.05, rN);
    if (uSupp > 0.0) {
      float e = smoothstep(0.2, 0.95, rN) * uSupp;
      c = mix(c, vec3(npLuma(c)), e * 0.55);
      c *= 1.0 - 0.5 * smoothstep(0.3, 1.0, rN) * uSupp;
    }
    if (uDamage > 0.0) c = mix(c, vec3(0.55, 0.02, 0.0) * (0.35 + lum), smoothstep(0.45, 1.0, rN) * uDamage * 0.75);

    // Sensorrauschen: helligkeitsabhängig (Schatten stärker), neues Muster ~24×/s
    if (uGrain > 0.0) {
      vec2 gp = floor(gl_FragCoord.xy / uGrainScale) + uGrainSeed;
      float n = npHash(gp) + npHash(gp + vec2(57.0, 113.0)) - 1.0;
      float nc = npHash(gp + vec2(211.0, 7.0)) - 0.5;
      float amp = uGrain * mix(0.085, 0.032, smoothstep(0.02, 0.75, npLuma(c)));
      c += amp * vec3(n + nc * 0.6, n, n - nc * 0.6);
    }
    // Gehäuse: abgerundeter, weicher schwarzer Rand, folgt dem Kamerawackeln minimal
    if (uBorder > 0.0) {
      vec2 q = (vUv - 0.5 + uBorderShift) * vec2(uLens.z, 1.0) * 2.0;
      vec2 hs = vec2(uLens.z, 1.0) * 0.985;
      float rad = 0.34;
      vec2 dq = abs(q) - (hs - rad);
      float sd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - rad;
      float m = smoothstep(0.0, -0.05, sd) * (0.78 + 0.22 * smoothstep(0.0, -0.3, sd));
      c *= mix(1.0, m, uBorder);
    }
    // Dither gegen Stufen im 8-Bit-Bild
    c += (npHash(gl_FragCoord.xy + uGrainSeed.yx * 3.0) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export class LensPass {
  constructor() {
    this.materials = new Map();
  }

  /** variant = { inline: bool, classic: bool, resample: 0|1|2 } → Material (gecacht). */
  material({ inline = false, classic = false, resample = 0 } = {}) {
    const key = `${inline ? 'i' : 'x'}${classic ? 'c' : 'a'}${resample}`;
    let m = this.materials.get(key);
    if (m) return m;
    const defines = { RESAMPLE: resample };
    if (inline) defines.INLINE_GRADE = 1;
    if (inline && classic) defines.CLASSIC = 1;
    m = new THREE.ShaderMaterial({
      name: `NullpunktLens_${key}`,
      defines,
      uniforms: {
        ...(inline ? gradeUniforms() : {}),
        tColor: { value: null },
        uSrc: { value: new THREE.Vector4(1, 1, 1, 1) },
        uOut: { value: new THREE.Vector4(1, 1, 1, 1) },
        uLens: { value: new THREE.Vector4(1, 0.6, 16 / 9, 1) },
        uLensOn: { value: 0 },
        uCA: { value: 0 },
        uVig: { value: 0 },
        uVigC: { value: 0 },
        uDamage: { value: 0 },
        uSupp: { value: 0 },
        uGrain: { value: 0 },
        uGrainSeed: { value: new THREE.Vector2(17, 29) },
        uGrainScale: { value: 1 },
        uArt: { value: 0 },
        uMotion: { value: 0 },
        uBlock: { value: 8 },
        uBorder: { value: 0 },
        uBorderShift: { value: new THREE.Vector2() },
        uSharp: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: LENS_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.set(key, m);
    return m;
  }

  dispose() {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
