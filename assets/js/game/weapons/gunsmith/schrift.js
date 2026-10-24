// Gravuren und Schriftfelder einer Waffe in EINER Schrift-Textur (24.10.2026, Vorarbeit V6): Bisher bekam jedes
// Schriftfeld ein eigenes Material mit eigener Textur (M-17 am PC: 47 transparente Netze = 47 Draw Calls). Jetzt
// liegen alle Texte einer Waffe in einem Atlas (Skyline-Packung, 8 px Rand gegen Überlaufen der Mipmaps) und teilen
// ein Material – der Builder fasst sie je Teil zu einem Netz zusammen. Gezeichnet wird jeder Text genau wie zuvor
// (gleiche Schrift, Größe, Ränder, Pixelraster), die Fläche bildet nur noch auf ihr Rechteck im Atlas ab. Senkrechte
// Felder werden wie bisher gezeichnet und pixelgenau um 90° gedreht abgelegt (lange Stempel sonst = hohe Spalte).
// Der Atlas wächst bei Bedarf nach unten (neue Texte einer anderen Detailstufe); die UVs der Netze beziehen sich
// auf eine feste virtuelle Höhe, die Textur gleicht das über ihre Wiederholung (repeat.y) aus.
import * as THREE from 'three';
import { canvas, toTexture, cached } from './textures.js';
import { defineMat } from './materials.js';

const W = 1024, VH = 8192, PAD = 8, ALIGN = 8;
const FONT = 'Arial, Helvetica, sans-serif';
let probeCtx = null;
const probe = () => (probeCtx ??= canvas(8, 8).getContext('2d'));

/** Maße eines Schriftfelds in Texturpixeln (wie die früheren Einzeltexturen). */
function measure(text, px, weight) {
  const g = probe();
  g.font = `${weight} ${px}px ${FONT}`;
  return { w: Math.ceil(g.measureText(text).width) + 8, h: Math.ceil(px * 1.2) };
}

// Zustand je Waffe im Textur-Cache (disposeTextures gibt ihn mit frei)
function atlasOf(key) {
  return cached('schrift:' + key, () => ({
    key, cells: new Map(), order: [], sky: [[0, W, 0]], H: 0, c: null, tex: null,
    dispose() { this.tex?.dispose(); this.tex = null; this.c = null; },
  }));
}

// Skyline-Packung: Platz mit der niedrigsten Oberkante suchen ([[x0, x1, y], …] von links nach rechts)
function place(A, cw, ch) {
  const w = Math.ceil((cw + PAD) / ALIGN) * ALIGN, h = Math.ceil((ch + PAD) / ALIGN) * ALIGN;
  let best = null;
  for (let i = 0; i < A.sky.length; i++) {
    const x = A.sky[i][0];
    if (x + w > W) break;
    let y = 0, j = i;
    while (j < A.sky.length && A.sky[j][0] < x + w) { y = Math.max(y, A.sky[j][2]); j++; }
    if (!best || y < best.y) best = { x, y };
  }
  if (!best) return null;
  const { x, y } = best, x1 = x + w, top = y + h, next = [];
  for (const s of A.sky) {
    if (s[1] <= x || s[0] >= x1) next.push(s);
    else { if (s[0] < x) next.push([s[0], x, s[2]]); if (s[1] > x1) next.push([x1, s[1], s[2]]); }
  }
  next.push([x, x1, top]);
  next.sort((a, b) => a[0] - b[0]);
  A.sky = next;
  return { ox: x + PAD / 2, oy: y + PAD / 2 };
}

function draw(g, cell) {
  const { text, px, weight, vertical, w, h, ox, oy, cw, ch } = cell;
  if (vertical) {
    // wie die frühere Einzeltextur (cw × ch, Schrift um −90° gedreht) zeichnen, dann um +90° gedreht in den Atlas
    // legen (ch × cw): Pixel (x, y) → (ch − 1 − y, x). drawImage mit ganzzahligem Versatz kopiert dabei pixelgenau
    // (geprüft) und ohne Rücklesen von der Grafikkarte (getImageData kostete je Feld einen Abgleich, M-17 ≈ 0,3 s)
    const tc = canvas(cw, ch), t = tc.getContext('2d');
    t.font = `${weight} ${px}px ${FONT}`; t.fillStyle = '#fff'; t.textBaseline = 'middle';
    t.translate(h / 2, w / 2); t.rotate(-Math.PI / 2); t.fillText(text, -w / 2 + 4, 0);
    g.save(); g.translate(ox + ch, oy); g.rotate(Math.PI / 2); g.drawImage(tc, 0, 0); g.restore();
    return;
  }
  g.save();
  g.beginPath(); g.rect(ox, oy, cw, ch); g.clip();
  g.translate(ox, oy);
  g.font = `${weight} ${px}px ${FONT}`; g.fillStyle = '#fff'; g.textBaseline = 'middle';
  g.fillText(text, 4, h / 2);
  g.restore();
}

// Leinwand (neu) anlegen bzw. vergrößern und alle bzw. die neuen Felder zeichnen
function paint(A) {
  const need = Math.max(64, Math.ceil(A.H / 64) * 64);
  if (!A.c || A.c.height < need) {
    const c = canvas(W, need), g = c.getContext('2d');
    for (const cell of A.order) draw(g, cell);
    A.c = c;
    if (A.tex) { A.tex.dispose(); A.tex.image = c; A.tex.needsUpdate = true; }
  } else {
    const g = A.c.getContext('2d');
    for (const cell of A.order) if (!cell.drawn) draw(g, cell);
    if (A.tex) A.tex.needsUpdate = true;
  }
  for (const cell of A.order) cell.drawn = true;
  if (A.tex) A.tex.repeat.set(1, VH / A.c.height);
}

/** Rechteck eines Texts im Atlas der Waffe (legt ihn bei Bedarf an). */
function cellOf(A, text, { vertical = false, px = 64, weight = '600' } = {}) {
  const id = text + '|' + (vertical ? 'v' : 'h') + '|' + px + '|' + weight;
  let cell = A.cells.get(id);
  if (cell) return cell;
  const { w, h } = measure(text, px, weight);
  const cw = vertical ? h : w, ch = vertical ? w : h;   // Maße der früheren Einzeltextur
  const at = place(A, w, h);                              // abgelegt immer waagrecht (w × h)
  if (!at) throw new Error(`Schrift-Atlas ${A.key} voll („${text}“)`);
  cell = { text, px, weight, vertical, w, h, cw, ch, ox: at.ox, oy: at.oy, drawn: false };
  A.H = Math.max(A.H, at.oy + h + PAD / 2);
  A.cells.set(id, cell); A.order.push(cell);
  if (A.c) paint(A);   // Material besteht schon: sofort nachzeichnen
  return cell;
}

/** Materialschlüssel der Schrift einer Waffe (helle, gravierte Schrift auf transparentem Grund, wie bisher). */
export function schriftMat(key) {
  const mk = 'schrift:' + key;
  defineMat(mk, () => {
    const A = atlasOf(key);
    paint(A);
    const t = toTexture(A.c, { srgb: true, repeat: false, aniso: 8 });
    t.flipY = false;                      // v zählt von oben (Leinwand wächst nach unten)
    t.repeat.set(1, VH / A.c.height);
    A.tex = t;
    return new THREE.MeshStandardMaterial({ map: t, color: 0xb9bcc0, metalness: 0.6, roughness: 0.45, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  });
  return mk;
}

/**
 * Schrift-Helfer einer Waffe: const { mark, markTop, railNumbers } = schrift('m17').
 * o.lite: Schriftfelder auch auf dem Handy (Standard nein – eine Textur ist billiger als viele Flächen, aber Text
 * ist dort kaum lesbar; M-17 behält sie, damit sie unverändert bleibt).
 */
export function schrift(key, { lite = false } = {}) {
  const mat = schriftMat(key);
  // Fläche mit UVs auf das Atlas-Rechteck (PlaneGeometry: u 0…1 links→rechts, v 1…0 oben→unten)
  const plane = (b, text, wM, hM, o) => {
    const A = atlasOf(key), cell = cellOf(A, text, o);
    const geo = new THREE.PlaneGeometry(wM, hM), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const s = uv.getX(i), t = uv.getY(i);
      // Texel der früheren Einzeltextur: (s · cw, (1 − t) · ch); senkrecht gedreht abgelegt: (t · ch, s · cw)
      if (cell.vertical) uv.setXY(i, (cell.ox + t * cell.ch) / W, (cell.oy + s * cell.cw) / VH);
      else uv.setXY(i, (cell.ox + s * cell.cw) / W, (cell.oy + (1 - t) * cell.ch) / VH);
    }
    return geo;
  };
  const aspect = (text, o = {}) => { const { w, h } = measure(text, o.px ?? 64, o.weight ?? '600'); return o.vertical ? h / w : w / h; };
  /** Schriftfeld auf einer Seitenfläche (x > 0 rechts, x < 0 links); h = Schrifthöhe in m. */
  const mark = (b, text, x, v, u, h, o = {}) => {
    if (!b.hi || (b.lite && !lite)) return;
    const asp = aspect(text, o);
    const geo = plane(b, text, o.vertical ? h : h * asp, o.vertical ? h / asp : h, o);
    const side = Math.sign(x) || 1;
    geo.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (o.rx) geo.rotateX(o.rx);
    b._push(geo, mat, { x, v, u, part: o.part }, true);
  };
  /** Schriftfeld oben auf einer Fläche (von hinten lesbar), z. B. Schienennummern – nur PC hoch/ultra. */
  const markTop = (b, text, x, v, u, h, o = {}) => {
    if (!b.max) return;
    const asp = aspect(text, o);
    const geo = plane(b, text, h * asp, h, o);
    geo.rotateX(-Math.PI / 2);
    b._push(geo, mat, { x, v, u }, true);
  };
  /** Nummern auf jedem zweiten Zahn einer Picatinny-Schiene (wie b.picatinny verteilt). */
  const railNumbers = (b, x, top, u0, u1, first, prefix = '') => {
    const len = u1 - u0, n = Math.max(1, Math.floor((len + 0.0052) / 0.01)), start = u0 + (len - (n * 0.01 - 0.0052)) / 2;
    for (let i = 0; i < n; i += 2) markTop(b, prefix + (first + i), x, top + 0.00008, start + i * 0.01 + 0.0024, 0.0024, { px: 48 });
  };
  return { mat, aspect, mark, markTop, railNumbers };
}
