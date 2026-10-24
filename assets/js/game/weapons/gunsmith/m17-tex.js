// M-17: Oberflächen nach dem Referenzfoto (m17-ref.js). Schaft + Griff teilen einen Atlas (Seitenprojektion, beide
// Seiten gleich): Würfelmuster der Griffschale, Gummikappe mit Rippen, Riemenschlitze, eingeformte Schrift.
// Gravuren (Wahlhebelstellungen, Typ, Nummer, Schienenzahlen) sind Schriftfelder in einer gemeinsamen Schrift-Textur
// der Waffe (schrift.js, 24.10.) – so stehen sie auf jeder Seite lesbar.
import { canvas, toTexture, cached, heightToNormal, fbm, bilinear } from './textures.js';
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
const PAD = [222, 990, 266, 1500];          // Gummikappe (Seite), Naht bei x = 266
export const SLOTS = [[388, 1222, 577, 1243], [356, 1254, 372, 1323], [359, 1373, 375, 1402]];   // Riemenschlitze (durch)
// Eigene Felder außerhalb der Teile (Fotopixel): Blankfeld für Ober-/Unter-/Stirnflächen, Kappe von hinten
const PLAIN = [300, 1000, 1000, 1100], PADR = [1010, 970, 1340, 1290];
const PAD_U = (PAD[2] + 4 - R.XG) / R.PPM, STOCK_TOP = R.V(990), STOCK_BOT = R.V(1500);
const at = (px, py) => [(px - F.x0) / (F.x1 - F.x0), 1 - (py - F.y0) / (F.y1 - F.y0)];
/** Atlas-UV je Dreieck nach Flächenrichtung: Seiten aus dem Foto, Ober-/Unterseiten und Stirnflächen ins Blankfeld
 *  (statt verschmierter Seitenprojektion), Kappe hinten ins Gummifeld. */
export function furnUV3(x, v, u, nx, ny, nz) {
  if (Math.abs(nx) > 0.6) return furnUV(x, v, u);
  if (Math.abs(nz) > 0.55 && u < PAD_U) return at(PADR[0] + (x + 0.034) / 0.068 * (PADR[2] - PADR[0]), PADR[1] + (STOCK_TOP - v) / (STOCK_TOP - STOCK_BOT) * (PADR[3] - PADR[1]));
  const fx = (x + 0.034) / 0.068 * (PLAIN[3] - PLAIN[1]);
  if (Math.abs(ny) >= Math.abs(nz)) { const px = photoX(u); return at(px > PLAIN[2] ? PLAIN[0] + (px - 940) : Math.max(PLAIN[0], px), PLAIN[1] + fx); }
  const t = ((STOCK_TOP - v) * R.PPM * 0.9) % 1360, tri = 680 - Math.abs(t - 680);   // gespiegelt wiederholt, bleibt im Blankfeld
  return at(PLAIN[0] + 10 + tri, PLAIN[1] + fx);
}

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
  // Gummikappe (Seite): glatter, matter Gummi, punktierte Naht vorn
  const rub = { h: grey(0.5), r: grey(0.9), a: grey(0.86) }[kind];
  const [px0, py0, px1, py1] = PAD;
  g.fillStyle = rub; g.fillRect(px0 - 4, py0 - 4, px1 - px0 + 4, py1 - py0 + 8);
  g.fillStyle = lo; for (let y = py0 + 30; y < py1 - 20; y += 5) g.fillRect(px1 - 3, y, 1.6, 2.6);
  // Kappe von hinten (eigenes Feld): Gummi mit Querrillen und umlaufendem Rand
  const [qx0, qy0, qx1, qy1] = PADR;
  g.fillStyle = rub; g.fillRect(qx0, qy0, qx1 - qx0, qy1 - qy0);
  for (let y = qy0 + 14; y < qy1 - 12; y += 7) { g.fillStyle = lo; g.fillRect(qx0 + 10, y, qx1 - qx0 - 20, 2.4); }
  // Batterieröhren-Deckel: runde Fuge hinten am Rohr
  g.strokeStyle = lo; g.lineWidth = 2; g.beginPath(); g.arc(296, 1149, 40, -Math.PI / 2, Math.PI / 2); g.stroke();
  // Riemenschlitze (Wände dunkel), eingeformte Schrift im Feld
  const deep = { h: grey(0.2), r: grey(0.9), a: grey(0.25) }[kind];
  for (const [x0, y0, x1, y1] of SLOTS) { g.fillStyle = deep; g.beginPath(); g.roundRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4, Math.min(x1 - x0, y1 - y0) / 2); g.fill(); }
  g.fillStyle = lo; g.font = '600 10px Arial, Helvetica, sans-serif';
  g.fillText('NULLPUNKT  M-17', 420, 1260); g.fillText('PAT. ANGEMELDET', 426, 1273);
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
