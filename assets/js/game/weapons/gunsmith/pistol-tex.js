// Pistolen-Baukasten, Texturteil (25.10.2026, Plan „Gemeinsame Baukästen“ G6): Zeichenhilfen für Foto-Atlanten von Pistolen
// (entstanden mit der Adler .50, gedacht für Sperber, P-9A, Kobra): schräge Griffrillen, Gravur, Kieselstruktur von Griffschalen,
// Kantenabrieb und Kratzer, Höhe → Normalen, Rauschen. Gezeichnet wird in Fotopixeln auf Leinwänden, deren Transformation den
// Fotoausschnitt auf den Atlas abbildet (siehe adler-tex.js). Nur textures.js als Import (materials.js lädt die Atlanten –
// kein Modulkreis über Builder/sdfkit).
import { canvas, toTexture, fbm, rng } from './textures.js';

export const CPU = { willReadFrequently: true };   // Hilfsleinwände im Hauptspeicher (GPU↔CPU-Kopien kosten im Software-GL viel)
export const grey = (h) => { const k = Math.max(0, Math.min(255, Math.round(h * 255))); return `rgb(${k},${k},${k})`; };
export const path = (g, pts) => { g.beginPath(); subPath(g, pts); };
/** Umriss an den aktuellen Pfad anhängen (ohne beginPath) – mehrere Umrisse in einem Pfad (z. B. ein gemeinsamer Clip). */
export const subPath = (g, pts) => { pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };

/**
 * Schräge Griffrillen (Schlitten): n Rillen, unten bei x0 + i·pitch auf Höhe bottom, um ang (Grad gegen die Senkrechte, nach
 * vorn = +x) geneigt bis top; Breite w (Fotopixel), runde Enden (Fräser). kind: 'h' Höhe (tief), 'a' Albedo (Schatten in der
 * Rille, helle Kante), 'r' Rauheit (Rille matt). skip(x, y) → true: Rille dort unterbrechen (z. B. Mulde der Sicherung).
 */
export function slantGrooves(g, kind, { x0, n, pitch, ang, top, bottom, w }, skip = null) {
  const t = Math.tan(ang * Math.PI / 180);
  g.save(); g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const xb = x0 + i * pitch, xt = xb + (bottom - top) * t;
    // Rille in kurzen Stücken, damit sie an Aussparungen enden kann
    const segs = []; let run = null;
    for (let s = 0; s <= 40; s++) {
      const f = s / 40, x = xb + (xt - xb) * f, y = bottom + (top - bottom) * f;
      const ok = !skip || !skip(x, y);
      if (ok) { if (!run) segs.push(run = []); run.push([x, y]); } else run = null;
    }
    for (const sg of segs) {
      if (sg.length < 2) continue;
      const stroke = (style, lw, dx = 0) => { g.strokeStyle = style; g.lineWidth = lw; g.beginPath(); sg.forEach(([x, y], k) => (k ? g.lineTo(x + dx, y) : g.moveTo(x + dx, y))); g.stroke(); };
      if (kind === 'h') { stroke(grey(0.36), w); stroke(grey(0.2), w * 0.5); }
      else if (kind === 'a') { stroke('rgba(30,32,36,0.42)', w); stroke('rgba(12,13,15,0.5)', w * 0.35); stroke('rgba(235,238,242,0.35)', w * 0.22, w * 0.55); }
      else { stroke(grey(0.62), w); }
    }
  }
  g.restore();
}

/**
 * Gravur (eigene Beschriftung): Höhe tiefer, Albedo dunkler/matt, Rauheit höher. x = linke Kante im Atlas; mirror: spiegelbildlich
 * zeichnen – für Flächen, deren Atlas-Richtung beim Ansehen nach links zeigt (linke Waffenseite bei Projektion längs u).
 */
export function engrave(g, kind, str, x, yBase, px, { weight = '600', family = 'Arial, Helvetica, sans-serif', stretch = 1, mirror = false } = {}) {
  g.save();
  g.fillStyle = { h: grey(0.24), a: 'rgba(48,50,54,0.78)', r: grey(0.7) }[kind];
  g.translate(x, yBase);
  if (mirror) g.scale(-1, 1);
  g.scale(stretch, 1);
  g.font = `${weight} ${px}px ${family}`; g.textBaseline = 'alphabetic';
  g.fillText(str, mirror ? -g.measureText(str).width : 0, 0);
  g.restore();
}

/**
 * Kieselstruktur (gespritzte Griffschale, „Pebble“): Kachel mit zufälligen, flach gerundeten Buckeln als Muster. kind wie oben:
 * Höhe hell = erhaben, Albedo Kuppen etwas heller (abgegriffen), Rauheit Kuppen glatter. size = Kachel in Fotopixeln, scale =
 * Texel je Fotopixel (Leinwandauflösung der Kachel), r0/r1 = Buckelradius in Fotopixeln.
 */
export function pebblePattern(g, kind, { size = 160, scale = 1, r0 = 2.2, r1 = 4.2, n = 900, seed = 5 } = {}) {
  const S = Math.max(16, Math.round(size * scale)), c = canvas(S, S), x = c.getContext('2d', CPU), r = rng(seed);
  x.fillStyle = { h: grey(0.42), a: 'rgb(26,27,29)', r: grey(0.9) }[kind]; x.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) {
    const px = r() * S, py = r() * S, rad = (r0 + r() * (r1 - r0)) * scale, e = 0.65 + r() * 0.7, rot = r() * Math.PI;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const cx = px + ox, cy = py + oy;
      if (cx < -rad * 2 || cy < -rad * 2 || cx > S + rad * 2 || cy > S + rad * 2) continue;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      if (kind === 'h') { gr.addColorStop(0, grey(0.78)); gr.addColorStop(0.7, grey(0.6)); gr.addColorStop(1, 'rgba(107,107,107,0)'); }
      else if (kind === 'a') { gr.addColorStop(0, 'rgba(58,59,63,0.9)'); gr.addColorStop(1, 'rgba(26,27,29,0)'); }
      else { gr.addColorStop(0, grey(0.62)); gr.addColorStop(1, 'rgba(230,230,230,0)'); }
      x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(1, e); x.translate(-cx, -cy);
      x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill(); x.restore();
    }
  }
  const pat = g.createPattern(c, 'repeat');
  if (pat && pat.setTransform && typeof DOMMatrix === 'function') pat.setTransform(new DOMMatrix().scale(1 / scale, 1 / scale));
  return pat;
}

/** Unterbrochener Kantenabrieb (blank gerieben): Streifen zwischen xa und xb auf Höhe y (Fotopixel); col(a) → Farbe. */
export function streak(g, rnd, xa, xb, y, h, a, col, { len = [6, 60], gap = 26 } = {}) {
  for (let x = xa; x < xb;) {
    const l = len[0] + rnd() * (len[1] - len[0]);
    if (rnd() > 0.25) { g.fillStyle = col(a * (0.4 + 0.6 * rnd())); g.fillRect(x, y, Math.min(l, xb - x), h); }
    x += l + rnd() * gap;
  }
}

/** Feine Kratzer im Rechteck [x0, y0, x1, y1] (Fotopixel). */
export function scratches(g, rnd, [x0, y0, x1, y1], n, col, { len = [3, 30], spread = 0.6, lw = [0.3, 0.8] } = {}) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), l = len[0] + rnd() * (len[1] - len[0]), a = (rnd() - 0.5) * spread;
    g.strokeStyle = col(rnd()); g.lineWidth = lw[0] + rnd() * (lw[1] - lw[0]);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}

// ---------------------------------------------------------------- Rauschen, Höhe → Normalen
/** Wolkiges Rauschen (kachelnd) als kleine Leinwand (wird weich skaliert aufgetragen). */
export function noiseCanvas(seed, w = 256, h = 128, period = 5) {
  const n = fbm(w, h, { seed, period, octaves: 4 }), c = canvas(w, h), g = c.getContext('2d', CPU), img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const k = Math.max(0, Math.min(255, n[i] * 255)); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
/** Bürstenstrich: Kachel mit waagrechten, unterschiedlich hellen Strichen (Edelstahl gebürstet), als Muster aufzutragen. */
export function brushCanvas(seed, w = 512, h = 128) {
  const c = canvas(w, h), g = c.getContext('2d', CPU), r = rng(seed), img = g.createImageData(w, h), d = img.data;
  const rows = new Float32Array(h);
  for (let y = 0; y < h; y++) rows[y] = 0.5 + (r() - 0.5) * 0.6;   // gedämpft: feiner Strich, keine Streifen
  for (let y = 0; y < h; y++) {
    let v = rows[y];
    for (let x = 0; x < w; x++) {
      if ((x & 31) === 0) v = rows[y] * 0.7 + r() * 0.3;
      const k = Math.round(255 * Math.max(0, Math.min(1, v + (r() - 0.5) * 0.12))), i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = k; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
/** Körnung (Strahlmattierung, Spritzguss) als Kachel. */
export function grainCanvas(seed, size = 128) {
  const c = canvas(size, size), g = c.getContext('2d', CPU), img = g.createImageData(size, size), r = rng(seed);
  for (let i = 0; i < size * size; i++) { const k = (r() * 255) | 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

export function readHeight(c) {
  const d = c.getContext('2d', CPU).getImageData(0, 0, c.width, c.height).data, h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
/** 3er-Kastenfilter in x und y (weiche Kanten der Prägungen). */
export function blur(h, w, H) {
  const t = new Float32Array(h.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (h[i - (x > 0)] + h[i] + h[i + (x < w - 1)]) / 3; }
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const i = y * w + x; h[i] = (t[i - (y > 0) * w] + t[i] + t[i + (y < H - 1) * w]) / 3; }
  return h;
}
/** Höhe → Normalen (Sobel, Randklemmung statt Kachelung – Atlanten kacheln nicht). s = Stärke. */
export function normalTex(h, W, H, s) {
  const c = canvas(W, H), g = c.getContext('2d', CPU), img = g.createImageData(W, H), d = img.data;
  // flache Bereiche (großteils ohne Relief) gleich als (0, 0, 1) = RGBA 128,128,255,255 – spart Wurzel und Einzelschreiben
  new Uint32Array(d.buffer, d.byteOffset, W * H).fill(new Uint32Array(new Uint8ClampedArray([128, 128, 255, 255]).buffer)[0]);
  for (let y = 0; y < H; y++) {
    const r0 = (y > 0 ? y - 1 : 0) * W, r1 = y * W, r2 = (y < H - 1 ? y + 1 : y) * W;
    for (let x = 0; x < W; x++) {
      const xl = x > 0 ? x - 1 : 0, xr = x < W - 1 ? x + 1 : x;
      const dx = (h[r0 + xr] + 2 * h[r1 + xr] + h[r2 + xr]) - (h[r0 + xl] + 2 * h[r1 + xl] + h[r2 + xl]);
      const dy = (h[r2 + xl] + 2 * h[r2 + x] + h[r2 + xr]) - (h[r0 + xl] + 2 * h[r0 + x] + h[r0 + xr]);
      if (dx === 0 && dy === 0) continue;
      const nx = -dx * s, ny = dy * s, il = 127.5 / Math.sqrt(nx * nx + ny * ny + 1), i = (r1 + x) * 4;
      d[i] = nx * il + 127.5; d[i + 1] = ny * il + 127.5; d[i + 2] = il + 127.5;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: false, aniso: 8 });
}
