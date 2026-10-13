// M-17: Oberflächen nach dem Referenzfoto (m17-ref.js). Schaft + Griff teilen einen Atlas (Seitenprojektion, beide
// Seiten gleich): Würfelmuster der Griffschale, Gummikappe mit Rippen, Riemenschlitze, eingeformte Schrift.
// Gravuren (Wahlhebelstellungen, Typ, Nummer, Schienenzahlen) sind kleine Schriftfelder (Abziehbilder) direkt auf der
// Fläche – so stehen sie auf jeder Seite lesbar.
import * as THREE from 'three';
import { canvas, toTexture, cached, heightToNormal, fbm, bilinear } from './textures.js';
import { defineMat } from './materials.js';
import * as R from './m17-ref.js';

// ---------------------------------------------------------------- Atlas Schaft + Griff
const F = { W: 2048, H: 1024, x0: 200, x1: 1360, y0: 960, y1: 1760 };
const photoX = (u) => R.XG + u * R.PPM;
const photoY = (v) => R.YB - (v - R.AXIS) * R.PPM;
/** Atlas-UV für Schaft/Griff (Projektion entlang x). */
export function furnUV(x, v, u) {
  return [(photoX(u) - F.x0) / (F.x1 - F.x0), 1 - (photoY(v) - F.y0) / (F.y1 - F.y0)];
}
export const FURN_CAMO_REPEAT = [(F.x1 - F.x0) / R.PPM / 0.2, (F.y1 - F.y0) / R.PPM / 0.2];

const grey = (h) => { const k = Math.max(0, Math.min(255, Math.round(h * 255))); return `rgb(${k},${k},${k})`; };
function ctxIn(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const sx = c.width / (F.x1 - F.x0), sy = c.height / (F.y1 - F.y0);
  g.setTransform(sx, 0, 0, sy, -F.x0 * sx, -F.y0 * sy);
  return g;
}
const path = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
// Griffschale: Rautenfeld schräg entlang der Griffachse (aus dem Foto)
const STIPPLE = [[1142, 1386], [1222, 1420], [1124, 1636], [1000, 1608]];
const PAD = [228, 990, 282, 1500];          // Gummikappe
const SLOT1 = [386, 1262, 560, 1288];        // Riemenschlitz quer
const SLOT2 = [358, 1268, 372, 1400];        // Riemenschlitz längs

function drawFurn(g, kind) {
  const lo = { h: grey(0.3), r: grey(0.75), a: grey(0.45) }[kind], hi = { h: grey(0.64), r: grey(0.52), a: grey(1) }[kind];
  // Rautenmuster der Griffschale
  g.save(); path(g, STIPPLE); g.clip();
  const P = 7.5;
  for (let y = 1370; y < 1650; y += P) for (let x = 990; x < 1240; x += P) {
    const ox = ((y / P) | 0) % 2 ? P / 2 : 0;
    g.fillStyle = lo; g.fillRect(x + ox - 0.9, y - 0.9, 5.8, 5.8);
    g.fillStyle = hi; g.beginPath(); g.moveTo(x + ox + 2, y - 0.6); g.lineTo(x + ox + 4.6, y + 2); g.lineTo(x + ox + 2, y + 4.6); g.lineTo(x + ox - 0.6, y + 2); g.closePath(); g.fill();
  }
  g.restore();
  // Rahmen um das Feld (Formkante)
  g.strokeStyle = lo; g.lineWidth = 1.6; path(g, STIPPLE); g.stroke();
  // Gummikappe: senkrechte Rippen
  const [px0, py0, px1, py1] = PAD;
  g.fillStyle = { h: grey(0.5), r: grey(0.86), a: grey(0.82) }[kind]; g.fillRect(px0, py0, px1 - px0, py1 - py0);
  for (let x = px0 + 6; x < px1 - 4; x += 7) { g.fillStyle = lo; g.fillRect(x, py0 + 8, 2.2, py1 - py0 - 16); }
  // Riemenschlitze (durchgehend: tief und dunkel)
  const deep = { h: grey(0.05), r: grey(0.9), a: grey(0.08) }[kind];
  for (const [x0, y0, x1, y1] of [SLOT1, SLOT2]) {
    g.fillStyle = deep; g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(x1 - x0, y1 - y0) / 2); g.fill();
  }
  // Eingeformte Schrift auf dem Schaftfuß + Kante der Wangenauflage
  g.fillStyle = lo; g.font = '600 15px Arial, Helvetica, sans-serif';
  g.fillText('NULLPUNKT  M-17', 432, 1276); g.fillText('VERSTELLSCHAFT', 440, 1300);
  g.strokeStyle = lo; g.lineWidth = 1.4; g.beginPath(); g.moveTo(300, 1232); g.lineTo(980, 1232); g.stroke();
}

function furnLayer(kind) {
  const c = canvas(F.W, F.H), g0 = c.getContext('2d', { willReadFrequently: true });
  g0.fillStyle = { h: grey(0.5), r: grey(0.6), a: grey(0.88) }[kind]; g0.fillRect(0, 0, F.W, F.H);
  if (kind !== 'h') {
    const n = fbm(256, 128, { seed: kind === 'a' ? 71 : 73, period: 5, octaves: 4 });
    const img = g0.getImageData(0, 0, F.W, F.H), d = img.data;
    for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) { const v = (bilinear(n, 256, 128, x / 8, y / 8) - 0.5) * (kind === 'a' ? 26 : 40), i = (y * F.W + x) * 4; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
    g0.putImageData(img, 0, 0);
  }
  drawFurn(ctxIn(c), kind);
  return c;
}
function readHeight(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
export function m17FurnMaps() {
  return cached('m17furn', () => {
    const h = readHeight(furnLayer('h'));
    const n = fbm(512, 256, { seed: 79, period: 64, octaves: 2 });
    for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) h[y * F.W + x] += (bilinear(n, 512, 256, x / 4, y / 4) - 0.5) * 0.04;
    return {
      map: toTexture(furnLayer('a'), { srgb: true, repeat: false, aniso: 8 }),
      normalMap: heightToNormal(h, F.W, F.H, 2.4),
      roughnessMap: toTexture(furnLayer('r'), { repeat: false, aniso: 8 }),
    };
  });
}

// ---------------------------------------------------------------- Gravuren als Schriftfelder
/** Schriftfeld-Material (helle, gravierte Schrift auf transparentem Grund); vertical: Schrift um 90° gedreht. */
export function markMat(text, { vertical = false, px = 64, weight = '600' } = {}) {
  const key = 'm17mark:' + text + (vertical ? ':v' : '');
  defineMat(key, () => {
    const t = cached('tex:' + key, () => {
      const probe = canvas(8, 8).getContext('2d');
      probe.font = `${weight} ${px}px Arial, Helvetica, sans-serif`;
      const w = Math.ceil(probe.measureText(text).width) + 8, h = Math.ceil(px * 1.2);
      const c = vertical ? canvas(h, w) : canvas(w, h), g = c.getContext('2d');
      g.font = probe.font; g.fillStyle = '#fff'; g.textBaseline = 'middle';
      if (vertical) { g.translate(h / 2, w / 2); g.rotate(-Math.PI / 2); g.fillText(text, -w / 2 + 4, 0); } else g.fillText(text, 4, h / 2);
      const tex = toTexture(c, { srgb: true, repeat: false, aniso: 8 });
      tex.userData = { aspect: c.width / c.height };
      return tex;
    });
    return new THREE.MeshStandardMaterial({ map: t, color: 0xb9bcc0, metalness: 0.6, roughness: 0.45, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  });
  return key;
}
/** Seitenverhältnis (Breite/Höhe) eines Schriftfelds. */
export function markAspect(text, o = {}) {
  const probe = canvas(8, 8).getContext('2d');
  const px = o.px ?? 64;
  probe.font = `${o.weight ?? '600'} ${px}px Arial, Helvetica, sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + 8, h = Math.ceil(px * 1.2);
  return o.vertical ? h / w : w / h;
}

