// NULLPUNKT — Modelle der Versorgungspunkte (mappoints.js; Nutzer 21.10.: „Station, wo man Munition und HP auffüllen kann,
// besser bzw. passender machen“). Glaubwürdig militärisch statt Kiste mit Leuchtstreifen:
//   • Munitionsausgabe: Europalette mit gestapelten olivgrünen Munitionskisten (Schablonenschrift, Stirnleisten,
//     Seilgriffe), davor eine offene Kiste mit Magazinen und herausgezogenem Patronengurt, zwei Munitionsdosen,
//     Schild „MUNITION“ mit rotem Wimpel (Kennzeichnung Explosivstoffe).
//   • Sanitätsstation: Krankentrage auf zwei Böcken mit Wolldecke, Sanitätstasche und Sanitätskiste mit rotem Kreuz auf
//     weißem Feld, Fahne mit rotem Kreuz.
//   • Fahrzeug-Versorgung (Depot an den Panzer-Stellplätzen): Paletten mit langen Granatkisten und Kraftstoffkanistern,
//     MG-Gurtkästen, Schild „VERSORGUNG“ mit gelbem Wimpel.
// Jede Art ist EINE zusammengeführte Geometrie (Draw Call) mit einem gemeinsamen Canvas-Atlas (512²: Bretter, Schrift,
// Kreuz, Gurt, Kanister …) und Vertexfarben (Tönung, Bodenabdunklung); dazu die Signalleuchte (pulsiert, wenn bereit).
// Geometrie, Atlas und Material entstehen einmal je Seite und werden über Matches hinweg wiederverwendet;
// 'low' (Telefone) lässt Kleinteile weg (nie Teile mit Kollision, STATION_SOLIDS). Dreiecke: Munition ≈ 640,
// Sanität ≈ 380, Depot ≈ 690 (low ≈ 60 %).
import * as THREE from 'three';

const AW = 512, AH = 512;
// Atlasregionen [x, y, w, h] in Pixeln (Canvas, oben links)
const R = {
  crateA: [0, 0, 256, 128], crateB: [256, 0, 256, 128],
  shellA: [0, 128, 256, 64], shellB: [0, 192, 256, 64],
  crateEnd: [256, 128, 128, 128], crateTop: [384, 128, 128, 128],
  can: [0, 256, 128, 64], canTop: [0, 320, 64, 64], wood: [64, 320, 64, 64],
  cross: [128, 256, 128, 128], bag: [256, 256, 128, 64], cloth: [256, 320, 64, 64], khaki: [320, 320, 64, 64],
  jerry: [384, 256, 128, 128],
  belt: [0, 384, 256, 32], mag: [0, 416, 64, 32], metal: [64, 416, 64, 32], red: [128, 416, 64, 32], white: [192, 416, 32, 32], black: [224, 416, 32, 32],
  yellow: [0, 448, 64, 64], blanket: [64, 448, 64, 64], olive: [128, 448, 64, 64], rope: [192, 448, 64, 64],
  signMun: [256, 384, 256, 40], signSan: [256, 424, 256, 40], signVer: [256, 464, 256, 40],
};
const UV = {};
for (const [k, [x, y, w, h]] of Object.entries(R)) {
  // 1,5 px Rand nach innen (Mipmaps ziehen sonst Nachbarregionen an die Kanten)
  UV[k] = [(x + 1.5) / AW, 1 - (y + h - 1.5) / AH, (x + w - 1.5) / AW, 1 - (y + 1.5) / AH];
}

/* =========================================================================== Atlas */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
function shade(c, f) { const n = parseInt(c.slice(1), 16); return hex(((n >> 16) & 255) * f, ((n >> 8) & 255) * f, (n & 255) * f); }

function paintAtlas() {
  const cv = document.createElement('canvas');
  cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d');
  const r = rng(2110);
  const rect = (k) => R[k];
  // Sprenkel/Abnutzung: helle und dunkle Pünktchen
  const speckle = (k, n, light, dark, a = 0.18) => {
    const [x, y, w, h] = rect(k);
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + r() * 0.6);
      g.fillStyle = r() < 0.5 ? light : dark;
      const s = 1 + r() * 2.2;
      g.fillRect(x + r() * w, y + r() * h, s, s * (0.6 + r()));
    }
    g.globalAlpha = 1;
  };
  // Holzbretter (dir 'h': Fugen waagerecht) mit Maserung, Farbe je Brett leicht verschieden
  const planks = (k, base, n, dir = 'h', grain = 0.13) => {
    const [x, y, w, h] = rect(k);
    const len = dir === 'h' ? h : w;
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(base, 0.9 + r() * 0.16);
      const a = (i * len) / n, b = ((i + 1) * len) / n;
      if (dir === 'h') g.fillRect(x, y + a, w, b - a); else g.fillRect(x + a, y, b - a, h);
      g.globalAlpha = grain;
      g.strokeStyle = shade(base, 0.62);
      g.lineWidth = 1;
      for (let j = 0; j < 7; j++) {
        g.beginPath();
        const o = a + (b - a) * r();
        if (dir === 'h') { g.moveTo(x, y + o); g.bezierCurveTo(x + w * 0.3, y + o + (r() - 0.5) * 4, x + w * 0.7, y + o + (r() - 0.5) * 4, x + w, y + o + (r() - 0.5) * 3); }
        else { g.moveTo(x + o, y); g.bezierCurveTo(x + o + (r() - 0.5) * 4, y + h * 0.3, x + o + (r() - 0.5) * 4, y + h * 0.7, x + o + (r() - 0.5) * 3, y + h); }
        g.stroke();
      }
      g.globalAlpha = 1;
      // Fuge
      g.fillStyle = shade(base, 0.45);
      if (dir === 'h') g.fillRect(x, y + b - 1.5, w, 1.5); else g.fillRect(x + b - 1.5, y, 1.5, h);
    }
  };
  // Schablonenschrift: Buchstaben einzeln, Stege durch geschlossene Formen, abgeplatzte Farbe
  const stencil = (text, cx, cy, size, color, bg, { width = 0, spacing = 0.08 } = {}) => {
    g.font = `bold ${size}px "Arial Narrow", "DejaVu Sans Condensed", Arial, sans-serif`;
    g.textBaseline = 'middle';
    const ws = [...text].map((ch) => g.measureText(ch).width);
    const sp = size * spacing;
    let total = ws.reduce((a, b) => a + b, 0) + sp * (text.length - 1);
    const sx = width && total > width ? width / total : 1;
    total *= sx;
    let px = cx - total / 2;
    g.save();
    g.translate(px, cy);
    g.scale(sx, 1);
    px = 0;
    [...text].forEach((ch, i) => {
      g.fillStyle = color;
      g.globalAlpha = 0.86 + r() * 0.12;
      g.fillText(ch, px, 0);
      if ('ABDOPQR0689ÄÖ'.includes(ch)) {
        g.globalAlpha = 1;
        g.fillStyle = bg;
        const m = px + ws[i] / 2;
        g.fillRect(m - size * 0.045, -size * 0.38, size * 0.09, size * 0.2);
        g.fillRect(m - size * 0.045, size * 0.18, size * 0.09, size * 0.2);
      }
      px += ws[i] + sp;
    });
    g.restore();
    g.globalAlpha = 1;
  };
  const OLIVE = '#474d2e', OLIVE_D = '#383d24', YEL = '#cdb855';

  // Munitionskisten: Olivlack auf Brettern, gelbe Schablonenschrift
  planks('crateA', OLIVE, 3, 'h', 0.1);
  { const [x, y, w, h] = R.crateA; stencil('PATRONEN 7,62 MM', x + w / 2, y + h * 0.36, 25, YEL, OLIVE, { width: w * 0.86 }); stencil('800 STK · GURT · LOS 21-10', x + w / 2, y + h * 0.66, 15, YEL, OLIVE, { width: w * 0.8 }); }
  speckle('crateA', 260, '#8f9468', '#22261a', 0.2);
  planks('crateB', '#535a37', 3, 'h', 0.1);
  { const [x, y, w, h] = R.crateB; stencil('PATRONEN 5,56 MM', x + w / 2, y + h * 0.36, 25, YEL, '#535a37', { width: w * 0.86 }); stencil('1680 STK · 30-SCHUSS-MAG.', x + w / 2, y + h * 0.66, 15, YEL, '#535a37', { width: w * 0.82 }); }
  speckle('crateB', 260, '#8f9468', '#22261a', 0.2);
  // lange Granatkisten (Fahrzeug-Versorgung)
  planks('shellA', '#4c5332', 2, 'h', 0.1);
  { const [x, y, w, h] = R.shellA; stencil('2 GRANATEN · PG', x + w / 2, y + h * 0.36, 20, YEL, '#4c5332', { width: w * 0.84 }); stencil('NICHT STÜRZEN', x + w / 2, y + h * 0.72, 12, '#e8e4d4', '#4c5332', { width: w * 0.5 }); }
  speckle('shellA', 180, '#8f9468', '#22261a', 0.2);
  planks('shellB', '#555c39', 2, 'h', 0.1);
  { const [x, y, w, h] = R.shellB; stencil('2 GRANATEN · SG', x + w / 2, y + h * 0.36, 20, YEL, '#555c39', { width: w * 0.84 }); g.fillStyle = '#b8352a'; g.fillRect(x + 10, y + h * 0.62, w - 20, 5); }
  speckle('shellB', 180, '#8f9468', '#22261a', 0.2);
  planks('crateEnd', OLIVE_D, 4, 'v', 0.1);
  speckle('crateEnd', 120, '#8f9468', '#1c2014', 0.2);
  planks('crateTop', '#4b5231', 3, 'h', 0.1);
  { const [x, y, w, h] = R.crateTop; stencil('OBEN', x + w / 2, y + h * 0.5, 22, YEL, '#4b5231'); g.fillStyle = YEL; g.beginPath(); g.moveTo(x + w / 2, y + 12); g.lineTo(x + w / 2 - 10, y + 28); g.lineTo(x + w / 2 + 10, y + 28); g.fill(); }
  speckle('crateTop', 160, '#8f9468', '#22261a', 0.2);
  // Munitionsdose (Blech, Oliv) mit Aufschrift
  { const [x, y, w, h] = R.can; g.fillStyle = '#4a5131'; g.fillRect(x, y, w, h); g.fillStyle = '#3b4127'; g.fillRect(x, y + 6, w, 3); g.fillRect(x, y + h - 9, w, 3); stencil('7,62 MM · 200', x + w / 2, y + h * 0.5, 15, YEL, '#4a5131', { width: w * 0.86 }); }
  speckle('can', 120, '#9aa078', '#1d2015', 0.22);
  { const [x, y, w, h] = R.canTop; g.fillStyle = '#4d5434'; g.fillRect(x, y, w, h); g.strokeStyle = '#363b24'; g.lineWidth = 2; g.strokeRect(x + 5, y + 5, w - 10, h - 10); }
  speckle('canTop', 80, '#9aa078', '#1d2015', 0.22);
  // Palettenholz
  planks('wood', '#a98e66', 3, 'h', 0.22);
  speckle('wood', 90, '#d8c49c', '#5a4630', 0.18);
  // Rotes Kreuz auf weißem Feld
  { const [x, y, w, h] = R.cross; g.fillStyle = '#ece9e0'; g.fillRect(x, y, w, h); g.fillStyle = '#c4202a'; const t = w * 0.2; g.fillRect(x + w / 2 - t / 2, y + h * 0.18, t, h * 0.64); g.fillRect(x + w * 0.18, y + h / 2 - t / 2, w * 0.64, t); }
  speckle('cross', 90, '#ffffff', '#9a968c', 0.14);
  // Sanitätstasche: Olivstoff, weißes Rund mit rotem Kreuz
  { const [x, y, w, h] = R.bag; g.fillStyle = '#596043'; g.fillRect(x, y, w, h); g.globalAlpha = 0.25; g.strokeStyle = '#2c301f'; for (let i = 0; i < w; i += 3) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i, y + h); g.stroke(); } g.globalAlpha = 1;
    g.fillStyle = '#ece9e0'; g.beginPath(); g.arc(x + w / 2, y + h / 2, h * 0.36, 0, Math.PI * 2); g.fill(); g.fillStyle = '#c4202a'; const t = h * 0.15; g.fillRect(x + w / 2 - t / 2, y + h / 2 - h * 0.25, t, h * 0.5); g.fillRect(x + w / 2 - h * 0.25, y + h / 2 - t / 2, h * 0.5, t);
    g.fillStyle = '#2f3322'; g.fillRect(x, y + 4, w, 3); }
  speckle('bag', 70, '#8f9670', '#23261a', 0.2);
  // Stoffe: Oliv, Khaki (Trage), Wolldecke
  const weave = (k, base) => { const [x, y, w, h] = R[k]; g.fillStyle = base; g.fillRect(x, y, w, h); g.globalAlpha = 0.16; g.fillStyle = shade(base, 0.6); for (let i = 0; i < w; i += 2) g.fillRect(x + i, y, 1, h); for (let j = 0; j < h; j += 2) g.fillRect(x, y + j, w, 1); g.globalAlpha = 1; };
  weave('cloth', '#5b6145'); speckle('cloth', 40, '#8f9670', '#23261a', 0.15);
  weave('khaki', '#7a7456'); speckle('khaki', 50, '#b5ad8a', '#4a452f', 0.16);
  weave('blanket', '#5d5f52'); { const [x, y, w] = R.blanket; g.fillStyle = '#3e4036'; g.fillRect(x, y + 8, w, 3); g.fillRect(x, y + 52, w, 3); }
  weave('rope', '#8a7a55'); { const [x, y, w, h] = R.rope; g.strokeStyle = '#5a4c32'; g.lineWidth = 2; for (let i = -h; i < w; i += 6) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.stroke(); } }
  // Kraftstoffkanister: Oliv, geprägtes X mit Licht/Schatten, Aufschrift
  { const [x, y, w, h] = R.jerry; g.fillStyle = '#4e5632'; g.fillRect(x, y, w, h);
    const line = (x0, y0, x1, y1, c, lw) => { g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    for (const [d, c] of [[-2, '#6c7548'], [2, '#353b22']]) { line(x + 14, y + 14 + d, x + w - 14, y + h - 14 + d, c, 5); line(x + w - 14, y + 14 + d, x + 14, y + h - 14 + d, c, 5); }
    line(x + 14, y + 14, x + w - 14, y + h - 14, '#4e5632', 4); line(x + w - 14, y + 14, x + 14, y + h - 14, '#4e5632', 4);
    g.strokeStyle = '#3a4026'; g.lineWidth = 3; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
    stencil('DIESEL', x + w * 0.5, y + h * 0.5 - 1, 15, '#e2dcc2', '#4e5632'); }
  speckle('jerry', 140, '#99a073', '#1e2115', 0.22);
  // Patronengurt: Messinghülsen mit Kupfergeschoss, dunkle Glieder
  { const [x, y, w, h] = R.belt; g.fillStyle = '#23211d'; g.fillRect(x, y, w, h);
    for (let i = 0; i < 26; i++) { const cx = x + 2 + i * (w - 4) / 26;
      g.fillStyle = '#b38f45'; g.fillRect(cx + 1, y + 9, 6.5, h - 11); g.fillStyle = '#e0c27a'; g.fillRect(cx + 2, y + 10, 1.6, h - 13);
      g.fillStyle = '#8c5530'; g.beginPath(); g.moveTo(cx + 1, y + 9); g.lineTo(cx + 4.25, y + 1.5); g.lineTo(cx + 7.5, y + 9); g.fill();
      g.fillStyle = '#3a3833'; g.fillRect(cx - 0.5, y + 16, 1.8, 10); } }
  // Magazin (Kunststoff, Rippen), Metall, Farben
  { const [x, y, w, h] = R.mag; g.fillStyle = '#2b2c29'; g.fillRect(x, y, w, h); g.fillStyle = '#3a3b37'; for (let i = 4; i < w; i += 8) g.fillRect(x + i, y + 3, 3, h - 6); }
  { const [x, y, w, h] = R.metal; g.fillStyle = '#5b5e5c'; g.fillRect(x, y, w, h); } speckle('metal', 50, '#8d9190', '#2d2f2e', 0.25);
  { const [x, y, w, h] = R.red; g.fillStyle = '#b52a24'; g.fillRect(x, y, w, h); } speckle('red', 30, '#d0544c', '#6a1410', 0.15);
  { const [x, y, w, h] = R.white; g.fillStyle = '#e6e3da'; g.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R.black; g.fillStyle = '#1d1e1c'; g.fillRect(x, y, w, h); }
  { const [x, y, w, h] = R.yellow; g.fillStyle = '#d5aa2a'; g.fillRect(x, y, w, h); } speckle('yellow', 30, '#f0cf6a', '#7a5e14', 0.15);
  { const [x, y, w, h] = R.olive; g.fillStyle = '#4f5634'; g.fillRect(x, y, w, h); } speckle('olive', 60, '#8f9468', '#22261a', 0.2);
  // Schilder
  { const [x, y, w, h] = R.signMun; g.fillStyle = '#3d4329'; g.fillRect(x, y, w, h); g.strokeStyle = YEL; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, w - 6, h - 6); stencil('MUNITION', x + w / 2, y + h / 2 + 1, 24, YEL, '#3d4329'); }
  speckle('signMun', 80, '#8f9468', '#1c2014', 0.18);
  { const [x, y, w, h] = R.signSan; g.fillStyle = '#ece9e0'; g.fillRect(x, y, w, h); g.fillStyle = '#c4202a'; const t = 7; g.fillRect(x + 22 - t / 2, y + 7, t, h - 14); g.fillRect(x + 22 - (h - 14) / 2, y + h / 2 - t / 2, h - 14, t); g.fillRect(x + w - 22 - t / 2, y + 7, t, h - 14); g.fillRect(x + w - 22 - (h - 14) / 2, y + h / 2 - t / 2, h - 14, t); stencil('SANITÄT', x + w / 2, y + h / 2 + 1, 24, '#b81d26', '#ece9e0'); }
  speckle('signSan', 60, '#ffffff', '#9a968c', 0.14);
  { const [x, y, w, h] = R.signVer; g.fillStyle = '#d2a729'; g.fillRect(x, y, w, h); g.fillStyle = '#1d1e1c'; for (let i = -h; i < w; i += 16) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + 8, y + h); g.lineTo(x + i + 8 + 5, y + h - 5); g.lineTo(x + i + 5, y + h - 5); g.fill(); g.beginPath(); g.moveTo(x + i, y + 5); g.lineTo(x + i + 8, y + 5); g.lineTo(x + i + 13, y); g.lineTo(x + i + 5, y); g.fill(); }
    stencil('VERSORGUNG', x + w / 2, y + h / 2, 21, '#1d1e1c', '#d2a729', { width: w * 0.84 }); }
  speckle('signVer', 60, '#f0d070', '#5a4410', 0.16);
  return cv;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const tex = new THREE.CanvasTexture(paintAtlas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = 'versorgung-atlas';
  // Grundfarbe leicht gedämpft: die Welt-Abstimmung (Belichtung/Grading) hellt Olivtöne sonst ins Lindgrüne auf
  const body = new THREE.MeshStandardMaterial({ map: tex, color: 0xcfcfcf, vertexColors: true, roughness: 0.84, metalness: 0.04 });
  body.name = 'versorgung';
  SHARED = { tex, body, geo: new Map(), lamp: new THREE.SphereGeometry(0.045, 10, 7), lampMat: new Map() };
  return SHARED;
}

/* =========================================================================== Geometrie-Baukasten */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

class Kit {
  constructor(low) { this.low = low; this.p = []; this.n = []; this.u = []; this.c = []; }

  /** Ein Dreieck in Weltlage (Stationsraum): Punkte, Normale, UV, Tönung (+ Bodenabdunklung nach Höhe). */
  _vert(p, n, u, v, t) {
    this.p.push(p.x, p.y, p.z);
    this.n.push(n.x, n.y, n.z);
    this.u.push(u, v);
    const ao = 0.6 + 0.4 * smooth(0, 0.5, p.y);
    const [r, g, b] = Array.isArray(t) ? t : [t, t, t];
    this.c.push(r * ao, g * ao, b * ao);
  }

  /** Viereck a-b-c-d (gegen den Uhrzeigersinn von vorn) mit Atlasregion; flip spiegelt u. */
  quad(a, b, c, d, reg, tint = 1, flip = false) {
    const [u0, v0, u1, v1] = UV[reg] || UV.olive;
    const ua = flip ? u1 : u0, ub = flip ? u0 : u1;
    _n.subVectors(b, a).cross(_v.subVectors(d, a)).normalize();
    const n = _n.clone();
    this._vert(a, n, ua, v0, tint); this._vert(b, n, ub, v0, tint); this._vert(c, n, ub, v1, tint);
    this._vert(a, n, ua, v0, tint); this._vert(c, n, ub, v1, tint); this._vert(d, n, ua, v1, tint);
  }

  _mat(x, y, z, o) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    _q.setFromEuler(_e);
    return _m.compose(_v.set(x, y, z), _q, _s);
  }

  /**
   * Quader mit Unterkante bei y (lokale Mitte unten = (x, y, z)), Maße w (x) × h × d (z); lange Achse = x.
   * faces: Region für alle Seiten oder { side (±z), end (±x), top, bottom, pz, nz, px, nx, all }.
   * o: { ry, rx, rz, tint, oy (Drehpunkt-Höhe über y, Standard 0) }
   */
  box(x, y, z, w, h, d, faces, o = {}) {
    const F = typeof faces === 'string' ? { all: faces } : faces;
    const reg = (k, grp) => F[k] || F[grp] || F.all || 'olive';
    const M = this._mat(x, y, z, o).clone();
    const hx = w / 2, hz = d / 2;
    const P = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(M);
    const t = o.tint ?? 1;
    const tb = Array.isArray(t) ? t.map((c) => c * 0.75) : t * 0.75;
    // +z, −z, +x, −x, oben, unten (Ecken gegen den Uhrzeigersinn von außen)
    this.quad(P(-hx, 0, hz), P(hx, 0, hz), P(hx, h, hz), P(-hx, h, hz), reg('pz', 'side'), t);
    this.quad(P(hx, 0, -hz), P(-hx, 0, -hz), P(-hx, h, -hz), P(hx, h, -hz), reg('nz', 'side'), t);
    this.quad(P(hx, 0, hz), P(hx, 0, -hz), P(hx, h, -hz), P(hx, h, hz), reg('px', 'end'), t);
    this.quad(P(-hx, 0, -hz), P(-hx, 0, hz), P(-hx, h, hz), P(-hx, h, -hz), reg('nx', 'end'), t);
    this.quad(P(-hx, h, hz), P(hx, h, hz), P(hx, h, -hz), P(-hx, h, -hz), reg('py', 'top'), t);
    if (o.bottom !== false && y + (o.oy || 0) > 0.01) this.quad(P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz), reg('ny', 'bottom'), tb);
  }

  /** Zylinder (stehend; o.rz/o.rx kippen), Mantel- und Deckelregion. */
  cyl(x, y, z, rad, h, seg, side, cap, o = {}) {
    const M = this._mat(x, y, z, o).clone();
    const P = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(M);
    const t = o.tint ?? 1;
    const [u0, v0, u1, v1] = UV[side];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0) * rad, s0 = Math.sin(a0) * rad, c1 = Math.cos(a1) * rad, s1 = Math.sin(a1) * rad;
      const A = P(c0, 0, -s0), B = P(c1, 0, -s1), C = P(c1, h, -s1), D = P(c0, h, -s0);
      const nA = new THREE.Vector3(Math.cos(a0), 0, -Math.sin(a0)).applyQuaternion(_q.setFromRotationMatrix(M));
      const nB = new THREE.Vector3(Math.cos(a1), 0, -Math.sin(a1)).applyQuaternion(_q);
      const ua = u0 + (u1 - u0) * (i / seg), ub = u0 + (u1 - u0) * ((i + 1) / seg);
      this._vert(A, nA, ua, v0, t); this._vert(B, nB, ub, v0, t); this._vert(C, nB, ub, v1, t);
      this._vert(A, nA, ua, v0, t); this._vert(C, nB, ub, v1, t); this._vert(D, nA, ua, v1, t);
      if (cap) {
        const [cu0, cv0, cu1, cv1] = UV[cap];
        const cu = (cu0 + cu1) / 2, cvv = (cv0 + cv1) / 2, ru = (cu1 - cu0) / 2, rv = (cv1 - cv0) / 2;
        const top = P(0, h, 0), nT = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
        this._vert(top, nT, cu, cvv, t); this._vert(D, nT, cu + Math.cos(a0) * ru, cvv + Math.sin(a0) * rv, t); this._vert(C, nT, cu + Math.cos(a1) * ru, cvv + Math.sin(a1) * rv, t);
      }
    }
  }

  /** Wimpel/Fahne am Mast: Tuch in der lokalen x-y-Ebene ab (x, y, z), Länge L, Höhe H, gewellt; beidseitig. */
  flag(x, y, z, L, H, reg, o = {}) {
    const seg = this.low ? 3 : 5, taper = o.taper ?? 0, amp = o.amp ?? 0.05, ry = o.ry || 0;
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const at = (lx, ly) => { const lz = Math.sin(lx * 5.2 + 0.4) * amp * (lx / L); return new THREE.Vector3(x + lx * cy + lz * sy, y + ly, z - lx * sy + lz * cy); };
    const [u0, v0, u1, v1] = UV[reg];
    for (let i = 0; i < seg; i++) {
      const xa = (i / seg) * L, xb = ((i + 1) / seg) * L;
      const ha = H * (1 - taper * (i / seg)), hb = H * (1 - taper * ((i + 1) / seg));
      const A = at(xa, (H - ha) / 2), B = at(xb, (H - hb) / 2), C = at(xb, (H + hb) / 2), D = at(xa, (H + ha) / 2);
      const ua = u0 + (u1 - u0) * (i / seg), ub = u0 + (u1 - u0) * ((i + 1) / seg);
      const va0 = v0 + (v1 - v0) * ((H - ha) / 2 / H), va1 = v0 + (v1 - v0) * ((H + ha) / 2 / H);
      const vb0 = v0 + (v1 - v0) * ((H - hb) / 2 / H), vb1 = v0 + (v1 - v0) * ((H + hb) / 2 / H);
      _n.subVectors(B, A).cross(_v.subVectors(D, A)).normalize();
      const n = _n.clone(), nb = n.clone().negate();
      this._vert(A, n, ua, va0, 1); this._vert(B, n, ub, vb0, 1); this._vert(C, n, ub, vb1, 1);
      this._vert(A, n, ua, va0, 1); this._vert(C, n, ub, vb1, 1); this._vert(D, n, ua, va1, 1);
      // Rückseite (Schrift/Kreuz spiegelverkehrt wie beim echten Tuch)
      this._vert(A, nb, ua, va0, 0.92); this._vert(C, nb, ub, vb1, 0.92); this._vert(B, nb, ub, vb0, 0.92);
      this._vert(A, nb, ua, va0, 0.92); this._vert(D, nb, ua, va1, 0.92); this._vert(C, nb, ub, vb1, 0.92);
    }
  }

  /** Band (Patronengurt) entlang einer Punktfolge [x, y, z] mit Breite w, waagerecht liegend; Unterseite dunkel. */
  ribbon(pts, w, reg, back = 'black') {
    const [u0, v0, u1, v1] = UV[reg];
    const [bu0, bv0, bu1, bv1] = UV[back];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = new THREE.Vector3(...pts[i]), p1 = new THREE.Vector3(...pts[i + 1]);
      const dir = _a.subVectors(p1, p0).normalize();
      const side = _b.set(-dir.z, 0, dir.x).normalize().multiplyScalar(w / 2);
      const A = p0.clone().sub(side), B = p1.clone().sub(side), C = p1.clone().add(side), D = p0.clone().add(side);
      const ua = u0 + (u1 - u0) * (i / (pts.length - 1)), ub = u0 + (u1 - u0) * ((i + 1) / (pts.length - 1));
      _n.subVectors(B, A).cross(_c.subVectors(D, A)).normalize();
      if (_n.y < 0) _n.negate();
      const n = _n.clone(), nb = n.clone().negate();
      // Oberseite: Patronen quer zum Band (v über die Breite)
      this._vert(A, n, ua, v0, 1); this._vert(D, n, ua, v1, 1); this._vert(C, n, ub, v1, 1);
      this._vert(A, n, ua, v0, 1); this._vert(C, n, ub, v1, 1); this._vert(B, n, ub, v0, 1);
      this._vert(A, nb, bu0, bv0, 0.8); this._vert(C, nb, bu1, bv1, 0.8); this._vert(D, nb, bu0, bv1, 0.8);
      this._vert(A, nb, bu0, bv0, 0.8); this._vert(B, nb, bu1, bv0, 0.8); this._vert(C, nb, bu1, bv1, 0.8);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/* =========================================================================== Bauteile */

/** Europalette 1,2 × 0,8 m (lange Seite x) bei (x, z); → Deckhöhe. */
function pallet(k, x, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const t = 0.74;
  for (const lz of [-0.35, 0, 0.35]) { const [px, pz] = P(0, lz); k.box(px, 0, pz, 1.2, 0.1, 0.1, 'wood', { ry, tint: t * 0.86 }); }
  const boards = k.low ? [-0.3275, 0, 0.3275] : [-0.3275, -0.16375, 0, 0.16375, 0.3275];
  boards.forEach((lz, i) => { const [px, pz] = P(0, lz); k.box(px, 0.1, pz, 1.2, 0.022, k.low ? 0.2 : i % 2 ? 0.1 : 0.145, 'wood', { ry, tint: t * (0.95 + (i % 3) * 0.04) }); });
  return 0.122;
}

/**
 * Munitionskiste (lange Achse x): Korpus, Stirnleisten, Seilgriffe, Verschlüsse. label: Region der Längsseiten.
 */
function crate(k, x, y, z, L, H, D, label, o = {}) {
  const ry = o.ry || 0, tint = o.tint ?? 1;
  k.box(x, y, z, L - 0.05, H, D, { side: label, end: 'crateEnd', top: 'crateTop', bottom: 'crateEnd' }, { ry, tint });
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  // Stirnleisten (umlaufend, 2 cm stärker) an beiden Enden
  for (const e of [-1, 1]) { const [px, pz] = P(e * (L / 2 - 0.03), 0); k.box(px, y - 0.004, pz, 0.05, H + 0.008, D + 0.024, { all: 'crateEnd', top: 'crateEnd' }, { ry, tint: tint * 0.9, bottom: false }); }
  if (k.low) return;
  // Seilgriffe an den Stirnseiten und Verschlüsse an der Längsseite
  for (const e of [-1, 1]) { const [px, pz] = P(e * (L / 2 + 0.012), 0); k.box(px, y + H * 0.42, pz, 0.03, 0.035, Math.min(0.16, D * 0.5), 'rope', { ry, tint: 0.95 }); }
  if (o.latch !== false) for (const lx of [-L * 0.28, L * 0.28]) { const [px, pz] = P(lx, D / 2 + 0.004); k.box(px, y + H - 0.07, pz, 0.05, 0.05, 0.012, 'metal', { ry, tint: 0.9 }); }
}

/** Munitionsdose (Blech) mit Tragegriff, lange Achse x. */
function ammoCan(k, x, y, z, ry = 0, o = {}) {
  const L = o.L ?? 0.29, H = o.H ?? 0.19, D = o.D ?? 0.15;
  k.box(x, y, z, L, H, D, { side: o.label || 'can', end: 'canTop', top: 'canTop', bottom: 'canTop' }, { ry, tint: o.tint ?? 1 });
  if (!k.low) k.box(x, y + H, z, L * 0.42, 0.016, 0.03, 'black', { ry, bottom: false });
}

/** Kraftstoffkanister 20 l (stehend, Breite x), drei Griffe als Leiste oben. */
function jerrycan(k, x, y, z, ry = 0, tint = 1) {
  k.box(x, y, z, 0.165, 0.43, 0.345, { side: 'olive', px: 'jerry', nx: 'jerry', top: 'olive' }, { ry: ry + Math.PI / 2, tint });
  if (!k.low) {
    k.box(x, y + 0.43, z, 0.05, 0.035, 0.24, 'olive', { ry: ry + Math.PI / 2, tint: tint * 0.9, bottom: false });
    const c = Math.cos(ry), s = Math.sin(ry);
    k.cyl(x + 0.13 * c, y + 0.4, z - 0.13 * s, 0.025, 0.05, 6, 'olive', 'olive', { tint: tint * 0.8 });
  }
}

/** Pfosten mit Schild und Wimpel; → Leuchtenpunkt (lokal) oben am Pfosten. */
function signPost(k, x, z, sign, pennant, o = {}) {
  const H = o.H ?? 1.85, ry = o.ry || 0;
  const c = Math.cos(ry), s = Math.sin(ry);
  k.box(x, 0, z, 0.06, H, 0.06, { all: 'wood', top: 'wood' }, { ry, tint: 0.42 });
  // Schild vor dem Pfosten (lokal +z), beidseitig beschriftet
  const sx = x + 0.04 * s, sz = z + 0.04 * c;
  k.box(sx, o.signY ?? 1.02, sz, 0.66, 0.11, 0.018, { side: sign, end: 'black', top: 'black', bottom: 'black' }, { ry });
  if (!k.low) k.box(sx, (o.signY ?? 1.02) - 0.01, sz, 0.7, 0.012, 0.022, 'black', { ry, tint: 0.8 });
  if (pennant) k.flag(x + 0.03 * c, H - 0.32, z - 0.03 * s, o.pL ?? 0.46, o.pH ?? 0.22, pennant, { ry, taper: o.taper ?? 0.85, amp: 0.05 });
  return new THREE.Vector3(x, H + 0.035, z);
}

/* =========================================================================== Stationen */

function buildMunition(low) {
  const k = new Kit(low);
  // Palette mit Kistenstapel: unten 2 × 2, oben 2 (Längsseiten mit Aufschrift nach vorn/hinten)
  const top = pallet(k, 0, -0.2);
  for (const [lx, lz, lab, t] of [[-0.295, -0.01, 'crateA', 0.96], [0.295, -0.01, 'crateB', 1.02], [-0.295, -0.39, 'crateB', 0.92], [0.295, -0.39, 'crateA', 0.98]]) crate(k, lx, top, lz, 0.58, 0.24, 0.36, lab, { ry: (lx * 0.07), tint: t });
  crate(k, -0.28, top + 0.24, -0.16, 0.58, 0.24, 0.36, 'crateB', { ry: 0.05, tint: 1.04 });
  crate(k, 0.31, top + 0.24, -0.22, 0.58, 0.24, 0.36, 'crateA', { ry: -0.08 });
  // offene Kiste vorn (Wände, Boden, aufgeklappter Deckel hinten), Magazine und Gurt
  const ox = -0.05, oz = 0.62, ory = 0.12, W = 0.74, D = 0.38, H = 0.26, T = 0.022;
  const c = Math.cos(ory), s = Math.sin(ory);
  const P = (lx, lz) => [ox + lx * c + lz * s, oz - lx * s + lz * c];
  k.box(ox, 0, oz, W, T, D, 'wood', { ry: ory, tint: 0.7 });
  for (const e of [-1, 1]) { const [px, pz] = P(0, e * (D / 2 - T / 2)); k.box(px, 0, pz, W, H, T, { pz: e > 0 ? 'crateA' : 'wood', nz: e > 0 ? 'wood' : 'crateB', top: 'crateEnd' }, { ry: ory, tint: e > 0 ? 0.98 : 0.9 }); }
  for (const e of [-1, 1]) { const [px, pz] = P(e * (W / 2 - T / 2), 0); k.box(px, 0, pz, T, H, D - 2 * T, { all: 'crateEnd', pz: 'wood', nz: 'wood' }, { ry: ory, tint: 0.85 }); }
  // Deckel an den hinteren Scharnieren hochgeklappt, leicht nach hinten gelehnt (innen rohes Holz)
  { const [px, pz] = P(0, -D / 2 - T / 2); k.box(px, H, pz, W + 0.02, D, T, { pz: 'wood', nz: 'crateTop', all: 'crateEnd' }, { ry: ory, rx: -0.28, tint: 0.72 }); }
  if (!low) {
    for (let i = 0; i < 6; i++) { const [px, pz] = P(-0.26 + i * 0.075, -0.06 + (i % 2) * 0.02); k.box(px, T, pz, 0.026, 0.17 - (i % 3) * 0.01, 0.07, { all: 'mag', top: 'black' }, { ry: ory + Math.PI / 2, rz: (i - 2.5) * 0.04 }); }
    const belt = [[0.12, 0.06, 0.07], [0.2, 0.2, 0.09], [0.28, H + 0.03, 0.15], [0.3, H + 0.02, 0.22], [0.33, 0.12, 0.28], [0.37, 0.012, 0.36], [0.5, 0.012, 0.44]].map(([lx, y, lz]) => { const [px, pz] = P(lx, lz); return [px, y, pz]; });
    k.ribbon(belt, 0.085, 'belt');
  }
  // Munitionsdosen rechts neben der Palette
  ammoCan(k, 0.86, 0, -0.05, Math.PI / 2 + 0.1);
  ammoCan(k, 0.84, 0.19, -0.03, Math.PI / 2 - 0.2);
  if (!low) ammoCan(k, 0.62, 0, 0.55, 0.35);
  const lamp = signPost(k, -0.8, -0.66, 'signMun', 'red', { ry: 0.2 });
  return { geo: k.geometry(), lamp };
}

function buildSani(low) {
  const k = new Kit(low);
  // Krankentrage auf zwei Böcken (lange Achse x)
  const ty = 0.46, tz = -0.18;
  for (const lx of [-0.6, 0.6]) {
    // Bock: zwei schräge Beine (unten breit), Querholz oben
    for (const e of [-1, 1]) k.box(lx, 0, tz + e * 0.26, 0.05, ty - 0.03, 0.05, 'olive', { rx: -e * 0.2, tint: 0.7 });
    k.box(lx, ty - 0.04, tz, 0.08, 0.04, 0.62, 'wood', { tint: 0.75 });
  }
  for (const e of [-1, 1]) k.box(0, ty, tz + e * 0.27, 2.2, 0.036, 0.036, { all: 'olive', end: 'black' }, { tint: 0.85 });
  k.box(0, ty + 0.006, tz, 1.86, 0.014, 0.52, { all: 'khaki', top: 'khaki' }, { tint: 1 });
  if (!low) for (const lx of [-0.7, 0.7]) for (const e of [-1, 1]) k.box(lx, ty - 0.1, tz + e * 0.27, 0.03, 0.1, 0.05, 'metal', { tint: 0.9 });
  // zusammengelegte Wolldecke am Kopfende
  k.box(-0.55, ty + 0.02, tz, 0.5, 0.07, 0.44, { all: 'blanket', top: 'blanket' }, { ry: 0.06, tint: 0.95 });
  // Sanitätstasche (Kreuz auf beiden Längsseiten), Deckelklappe, Trageriemen
  k.box(0.42, 0, 0.5, 0.44, 0.24, 0.24, { side: 'bag', end: 'cloth', top: 'cloth' }, { ry: -0.35 });
  if (!low) {
    k.box(0.42, 0.24, 0.5, 0.45, 0.02, 0.25, 'cloth', { ry: -0.35, tint: 0.85, bottom: false });
    for (const lx of [-0.1, 0.1]) { const c = Math.cos(-0.35), s = Math.sin(-0.35); k.box(0.42 + lx * c, 0.0, 0.5 - lx * s, 0.035, 0.262, 0.255, 'black', { ry: -0.35, tint: 1.1, bottom: false }); }
  }
  // Sanitätskiste (oliv) mit weißem Feld und rotem Kreuz vorn und auf dem Deckel
  { const kx = -0.62, kz = 0.52, kr = 0.12, c = Math.cos(kr), s = Math.sin(kr);
    const P = (lx, lz) => [kx + lx * c + lz * s, kz - lx * s + lz * c];
    k.box(kx, 0, kz, 0.52, 0.3, 0.34, { all: 'olive', top: 'canTop' }, { ry: kr, tint: 1.02 });
    let [px, pz] = P(0, 0.172);
    k.box(px, 0.05, pz, 0.22, 0.2, 0.006, { pz: 'cross', all: 'white' }, { ry: kr, bottom: false });
    [px, pz] = P(0, 0.1);
    k.box(px, 0.3, pz, 0.22, 0.2, 0.004, { pz: 'cross', all: 'white' }, { ry: kr, rx: -Math.PI / 2, bottom: false });
    if (!low) { [px, pz] = P(0, -0.12); k.box(px, 0.3, pz, 0.16, 0.02, 0.03, 'black', { ry: kr, bottom: false }); } }
  // Fahne mit rotem Kreuz
  k.box(-1.3, 0, -0.72, 0.045, 2.2, 0.045, { all: 'metal' }, { tint: 0.8 });
  k.flag(-1.28, 1.62, -0.72, 0.58, 0.42, 'cross', { ry: 0.25, taper: 0, amp: 0.06 });
  return { geo: k.geometry(), lamp: new THREE.Vector3(-1.3, 2.235, -0.72) };
}

function buildDepot(low) {
  const k = new Kit(low);
  // Palette 1: lange Granatkisten in zwei Lagen
  const t1 = pallet(k, -1.25, 0);
  for (const [lz, lab] of [[-0.21, 'shellA'], [0.21, 'shellB']]) crate(k, -1.25, t1, lz, 1.18, 0.28, 0.4, lab, { tint: 0.96 });
  // (alle Stufen gleich voll: die Kollision – STATION_SOLIDS – ist überall dieselbe)
  crate(k, -1.25, t1 + 0.28, -0.18, 1.18, 0.28, 0.4, 'shellB', { ry: 0.03, tint: 1.03 });
  crate(k, -1.23, t1 + 0.28, 0.24, 1.18, 0.28, 0.4, 'shellA', { ry: -0.04 });
  // Palette 2: Kraftstoffkanister 3 × 2
  const t2 = pallet(k, 0.15, 0.05, 0.04);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) jerrycan(k, -0.3 + i * 0.36 + 0.05, t2, 0.05 + (j - 0.5) * 0.36, 0.04 + (i - 1) * 0.03, 0.92 + ((i + j) % 3) * 0.05);
  // MG-Gurtkästen gestapelt
  ammoCan(k, 1.2, 0, 0.42, 0.06, { L: 0.36, H: 0.22, D: 0.18 });
  ammoCan(k, 1.2, 0, 0.18, -0.04, { L: 0.36, H: 0.22, D: 0.18, tint: 0.95 });
  ammoCan(k, 1.18, 0.22, 0.3, 0.12, { L: 0.36, H: 0.22, D: 0.18, tint: 1.05 });
  if (!low) ammoCan(k, 1.24, 0, -0.1, 0.02, { L: 0.36, H: 0.22, D: 0.18 });
  // zwei lose Granatkisten vorn, eine davon angebrochen
  crate(k, -0.4, 0, 0.82, 1.18, 0.28, 0.4, 'shellA', { ry: -0.12, tint: 0.98 });
  const lamp = signPost(k, 1.55, -0.62, 'signVer', 'yellow', { ry: -0.15, H: 2.0, signY: 1.1, pL: 0.5, pH: 0.24 });
  return { geo: k.geometry(), lamp };
}

const BUILDERS = { munition: buildMunition, sani: buildSani, depot: buildDepot };

/**
 * Kollision der Stationen (Prüfung 22.10.: Kistenstapel sahen wie Deckung aus, Soldaten standen darin und Kugeln gingen
 * hindurch): Quader [x, y, z, halbe Breite, halbe Höhe, halbe Tiefe, Drehung] im Stationsraum (Front +z, wie das Modell)
 * für die festen Teile – Kistenstapel, Paletten, Trage, Kisten; Schild, Fahne, Dosen und Kleinkram bleiben durchlässig.
 * Für alle Qualitätsstufen gleich (mappoints.js meldet sie über building.js addSolid an; surface für Treffer/Löcher).
 */
export const STATION_SOLIDS = Object.freeze({
  munition: [
    { surface: 'wood', box: [0, 0.181, -0.2, 0.6, 0.181, 0.4, 0] },        // Palette + untere Kistenlage
    { surface: 'wood', box: [0.015, 0.482, -0.19, 0.585, 0.12, 0.21, 0] }, // obere Kistenlage
    { surface: 'wood', box: [-0.05, 0.13, 0.62, 0.37, 0.13, 0.19, 0.12] },  // offene Kiste vorn
  ],
  sani: [
    { surface: 'metal', box: [0, 0.25, -0.18, 1.1, 0.25, 0.3, 0] },        // Trage auf Böcken
    { surface: 'wood', box: [-0.62, 0.15, 0.52, 0.26, 0.15, 0.17, 0.12] }, // Sanitätskiste
  ],
  depot: [
    { surface: 'wood', box: [-1.25, 0.201, 0, 0.6, 0.201, 0.41, 0] },      // Palette 1 + untere Granatkisten
    { surface: 'wood', box: [-1.24, 0.542, 0.03, 0.6, 0.14, 0.42, 0] },    // obere Granatkisten
    { surface: 'metal', box: [0.15, 0.3, 0.05, 0.6, 0.3, 0.4, 0.04] },     // Palette 2 mit Kanistern
    { surface: 'metal', box: [1.2, 0.22, 0.3, 0.19, 0.22, 0.21, 0] },      // MG-Gurtkästen
    { surface: 'wood', box: [-0.4, 0.14, 0.82, 0.59, 0.14, 0.2, -0.12] },  // lose Granatkiste vorn
  ],
});

/** Gibt es ein eigenes Modell für diese Punktart? */
export const hasStationModel = (kind) => !!BUILDERS[kind];

/** Material der Signalleuchte je Farbe (geteilt). */
export function lampMaterial(color) {
  const S = shared();
  let m = S.lampMat.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, roughness: 0.4 }); m.name = 'versorgung-leuchte'; S.lampMat.set(color, m); }
  return m;
}

/**
 * Station als Gruppe (Ursprung am Boden, Front +z). → { group, lamp (Mesh, pulsiert), tris }
 * quality: 'low' lässt Kleinteile weg; castShadow ab 'medium'.
 */
export function createStation(kind, { quality = 'high', color = 0xc8a64a, yaw = 0 } = {}) {
  const S = shared();
  const low = quality === 'low';
  const key = `${kind}|${low ? 'l' : 'h'}`;
  let e = S.geo.get(key);
  if (!e) { e = BUILDERS[kind](low); S.geo.set(key, e); }
  const g = new THREE.Group();
  g.rotation.y = yaw;
  const body = new THREE.Mesh(e.geo, S.body);
  body.name = `versorgung-${kind}`;
  body.castShadow = !low;
  body.receiveShadow = true;
  const lamp = new THREE.Mesh(S.lamp, lampMaterial(color));
  lamp.position.copy(e.lamp);
  g.add(body, lamp);
  return { group: g, lamp, tris: e.geo.attributes.position.count / 3 };
}
