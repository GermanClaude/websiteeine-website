// NULLPUNKT — Canvas-Atlanten: Decals (Flecken, Pfützen, Markierungen), Schilder (fiktive Beschriftung),
// Foliage (Büsche, Gräser, Palmwedel, Blüten) als instanzierte Karten mit Wind (Owner: world)
import * as THREE from 'three';

const FONT = '"Archivo NP", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono NP", "Courier New", monospace';

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' && !(typeof document !== 'undefined') ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Atlasgröße je Qualitätsstufe: low halbiert (¼ Speicher), sonst volle Auflösung. */
export function atlasScale(quality) { return quality === 'low' ? 0.5 : 1; }

// Lebende Canvas-Atlanten: Nach dem GPU-Upload wird die Canvas freigegeben (sonst hält die CanvasTexture
// ihren Pixelspeicher dauerhaft); bei WebGL-Kontextverlust zeichnet restoreAtlases() sie neu.
const liveAtlases = new Set();

/**
 * CanvasTexture, deren Canvas nach dem Hochladen freigegeben wird.
 * draw(ctx, w, h) zeichnet den Inhalt (auch erneut nach Kontextverlust).
 */
function atlasTexture(w, h, draw, { anisotropy = 4, name = 'atlas' } = {}) {
  const tex = new THREE.CanvasTexture(canvas(1, 1));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.name = name;
  const entry = {
    tex,
    redraw() {
      const cv = canvas(w, h);
      draw(cv.getContext('2d'), w, h);
      tex.image = cv;
      tex.needsUpdate = true;
    },
  };
  tex.onUpdate = () => { const cv = tex.image; if (cv && cv.width > 1) { cv.width = 1; cv.height = 1; } };
  const dispose = tex.dispose.bind(tex);
  tex.dispose = () => { liveAtlases.delete(entry); dispose(); };
  liveAtlases.add(entry);
  entry.redraw();
  return tex;
}

/** Nach WebGL-Kontextwiederherstellung: alle lebenden Atlanten neu zeichnen und hochladen. */
export function restoreAtlases() { for (const a of liveAtlases) a.redraw(); }

// ---------------------------------------------------------------------------
// Decals
// ---------------------------------------------------------------------------
export const DECAL_CELLS = {
  oil: 0, stain: 1, cracks: 2, puddle: 3, manhole: 4, drain: 5, arrow: 6, hatch: 7,
  leaves: 8, tire: 9, drip: 10, soot: 11, paper: 12, sanddrift: 13, moss: 14, line: 15,
  // Putzschäden für Wände (werden vom MapBuilder weltweit verstreut statt in die Kacheltextur gebacken)
  chip_stone: 16, chip_brick: 17, plaster_patch: 18, damp: 19,
};
/** Zeilen des Decal-Atlas (je 4 Zellen à 256 px in 1024er-Koordinaten). */
export const DECAL_ROWS = 5;

let decalAtlas = null, decalMats = null, decalSize = 0;

function blob(ctx, r, cx, cy, rad, color, alpha, n = 7) {
  for (let i = 0; i < n; i++) {
    const x = cx + (r() - 0.5) * rad * 0.9, y = cy + (r() - 0.5) * rad * 0.9, rr = rad * (0.35 + r() * 0.5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(${color},${alpha})`);
    g.addColorStop(0.6, `rgba(${color},${alpha * 0.6})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }
}

function wear(ctx, r, x, y, w, h, count) { // ausgeblichene Stellen in Farbe radieren
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.2 + r() * 0.6;
    ctx.beginPath(); ctx.arc(x + r() * w, y + r() * h, 1 + r() * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawDecalAtlas(ctx, S) {
  ctx.scale(S / 1024, S / 1024); // gezeichnet wird in 1024er-Koordinaten
  const C = 256;
  const r = rng(1337);
  const cell = (i, fn) => { ctx.save(); ctx.translate((i % 4) * C, Math.floor(i / 4) * C); ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.clip(); fn(); ctx.restore(); };
  // 0 Ölfleck
  cell(0, () => { blob(ctx, r, 128, 128, 110, '20,18,16', 0.55, 9); blob(ctx, r, 128, 128, 50, '8,8,8', 0.7, 5); });
  // 1 Schmutzfleck
  cell(1, () => { blob(ctx, r, 128, 128, 120, '70,62,50', 0.35, 12); });
  // 2 Risse
  cell(2, () => {
    ctx.strokeStyle = 'rgba(20,18,16,0.85)'; ctx.lineCap = 'round';
    const crack = (x, y, a, len, w) => {
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y);
      for (let i = 0; i < len; i++) { a += (r() - 0.5) * 0.8; x += Math.cos(a) * 6; y += Math.sin(a) * 6; ctx.lineTo(x, y); if (r() < 0.08 && w > 0.8) { ctx.stroke(); crack(x, y, a + (r() - 0.5) * 2, len * 0.4, w * 0.6); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); } }
      ctx.stroke();
    };
    for (let k = 0; k < 3; k++) crack(128, 128, r() * Math.PI * 2, 20, 2.4);
  });
  // 3 Pfütze (Form; Farbe kommt vom Material)
  cell(3, () => { blob(ctx, r, 128, 128, 100, '255,255,255', 0.95, 10); });
  // 4 Kanaldeckel
  cell(4, () => {
    ctx.fillStyle = '#2b2b2c'; ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 5;
    for (let i = -100; i <= 100; i += 22) { ctx.beginPath(); ctx.moveTo(128 + i, 128 - Math.sqrt(Math.max(0, 105 * 105 - i * i))); ctx.lineTo(128 + i, 128 + Math.sqrt(Math.max(0, 105 * 105 - i * i))); ctx.stroke(); }
    ctx.fillStyle = '#3d3d3e'; ctx.fillRect(98, 116, 60, 24); ctx.fillStyle = '#1c1c1c'; ctx.font = `700 18px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('KANAL', 128, 134);
  });
  // 5 Ablaufgitter
  cell(5, () => {
    ctx.fillStyle = '#353536'; ctx.fillRect(28, 78, 200, 100); ctx.fillStyle = '#0b0b0b';
    for (let x = 40; x < 220; x += 16) ctx.fillRect(x, 88, 8, 80);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 4; ctx.strokeRect(28, 78, 200, 100);
  });
  // 6 Pfeil
  cell(6, () => {
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    ctx.moveTo(128, 14); ctx.lineTo(206, 100); ctx.lineTo(152, 100); ctx.lineTo(152, 242); ctx.lineTo(104, 242); ctx.lineTo(104, 100); ctx.lineTo(50, 100); ctx.closePath(); ctx.fill();
    wear(ctx, r, 40, 10, 180, 240, 260);
  });
  // 7 Sperrfläche (Schraffur)
  cell(7, () => {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 10; ctx.strokeRect(10, 10, 236, 236);
    ctx.save(); ctx.beginPath(); ctx.rect(10, 10, 236, 236); ctx.clip(); ctx.lineWidth = 18;
    for (let i = -256; i < 512; i += 52) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke(); }
    ctx.restore(); wear(ctx, r, 0, 0, 256, 256, 400);
  });
  // 8 Laub
  cell(8, () => {
    for (let i = 0; i < 70; i++) {
      const x = 20 + r() * 216, y = 20 + r() * 216, a = r() * Math.PI, s = 4 + r() * 7;
      const tone = r();
      ctx.fillStyle = tone < 0.4 ? `rgba(${110 + r() * 40},${80 + r() * 30},40,0.95)` : tone < 0.7 ? `rgba(${90 + r() * 30},${100 + r() * 20},50,0.95)` : `rgba(150,${110 + r() * 30},60,0.95)`;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  });
  // 9 Reifenspuren
  cell(9, () => {
    for (const x0 of [70, 170]) {
      for (let y = 0; y < 256; y += 3) {
        ctx.fillStyle = `rgba(15,15,15,${0.25 + r() * 0.3})`;
        ctx.fillRect(x0 - 14 + Math.sin(y * 0.02) * 6, y, 28, 2);
      }
    }
  });
  // 10 Laufspur (Rost/Wasser, für Wände)
  cell(10, () => {
    for (let i = 0; i < 26; i++) {
      const x = 60 + r() * 136, w = 2 + r() * 8, len = 80 + r() * 170;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(110,62,30,0.65)'); g.addColorStop(1, 'rgba(110,62,30,0)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, w, len);
    }
  });
  // 11 Ruß / Brandfleck
  cell(11, () => { blob(ctx, r, 128, 128, 120, '12,10,9', 0.6, 14); blob(ctx, r, 128, 128, 40, '5,5,5', 0.8, 4); });
  // 12 Papier/Abfall
  cell(12, () => {
    for (let i = 0; i < 22; i++) {
      const x = 20 + r() * 216, y = 20 + r() * 216, a = r() * Math.PI, w = 6 + r() * 18, h = 5 + r() * 12;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = r() < 0.6 ? `rgba(${220 + r() * 30},${215 + r() * 30},${200 + r() * 30},0.95)` : `rgba(${120 + r() * 80},${60 + r() * 40},40,0.9)`;
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
    }
  });
  // 13 Sandverwehung
  cell(13, () => { blob(ctx, r, 128, 128, 120, '196,170,124', 0.5, 14); });
  // 14 Moos
  cell(14, () => { blob(ctx, r, 128, 128, 110, '70,88,40', 0.55, 16); });
  // 15 Markierungslinie
  cell(15, () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 96, 256, 64); wear(ctx, r, 0, 96, 256, 64, 300); });

  // Ausgebrochene Putzstelle: unregelmäßiger Umriss, darin Mauerwerk, oben Schattenkante, ringsum heller Putzrand
  const chip = (masonry) => {
    const pts = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = 84 + (r() - 0.5) * 24 + Math.sin(a * 3 + r()) * 10;
      pts.push([128 + Math.cos(a) * rr * 1.18, 128 + Math.sin(a) * rr * 0.82]);
    }
    const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    // Putzkante (heller Rand, etwas größer)
    ctx.save(); ctx.translate(128, 128); ctx.scale(1.08, 1.1); ctx.translate(-128, -128); path(); ctx.fillStyle = 'rgba(236,230,218,0.95)'; ctx.fill(); ctx.restore();
    ctx.save(); path(); ctx.clip();
    masonry();
    // Schatten der oberen Putzkante + leichte Verschmutzung
    const g = ctx.createLinearGradient(0, 20, 0, 120);
    g.addColorStop(0, 'rgba(20,16,12,0.55)'); g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    blob(ctx, r, 128, 150, 90, '60,52,42', 0.18, 6);
    ctx.restore();
  };
  cell(16, () => chip(() => {
    ctx.fillStyle = '#6f675c'; ctx.fillRect(0, 0, 256, 256); // Mörtel
    for (let y = 18; y < 256; y += 30 + r() * 10) {
      for (let x = -20 + r() * 30; x < 256; x += 34 + r() * 22) {
        const w = 26 + r() * 22, h = 20 + r() * 9, v = 120 + r() * 60;
        ctx.fillStyle = `rgb(${v + 18},${v + 8},${v - 12})`;
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, (r() - 0.5) * 0.3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }));
  cell(17, () => chip(() => {
    ctx.fillStyle = '#8a8070'; ctx.fillRect(0, 0, 256, 256);
    for (let row = 0, y = 4; y < 256; row++, y += 26) {
      for (let x = (row % 2) * -28; x < 256; x += 56) {
        const v = r();
        ctx.fillStyle = `rgb(${150 + v * 40},${78 + v * 25},${56 + v * 18})`;
        ctx.fillRect(x + 2, y + 2, 52, 22);
      }
    }
  }));
  // Ausgebesserte Stelle (Farbe kommt vom Wandton)
  cell(18, () => {
    ctx.fillStyle = 'rgba(214,208,198,0.55)';
    ctx.beginPath();
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, rr = 92 + (r() - 0.5) * 30; ctx[i ? 'lineTo' : 'moveTo'](128 + Math.cos(a) * rr * 1.1, 128 + Math.sin(a) * rr * 0.85); }
    ctx.closePath(); ctx.fill();
    blob(ctx, r, 128, 128, 70, '120,112,100', 0.12, 6);
  });
  // Aufsteigende Feuchte (Unterkante dunkel, nach oben ausfransend)
  cell(19, () => {
    for (let i = 0; i < 26; i++) {
      const x = 10 + r() * 236, top = 70 + r() * 110, w = 20 + r() * 50;
      const g = ctx.createLinearGradient(0, 256, 0, top);
      g.addColorStop(0, 'rgba(58,48,36,0.42)'); g.addColorStop(1, 'rgba(58,48,36,0)');
      ctx.fillStyle = g; ctx.fillRect(x - w / 2, top, w, 256 - top);
    }
  });
}

/** Materialien für Decals (gemeinsamer Atlas; 1024² bzw. 512² auf low – Größenwechsel tauscht nur die Textur). */
export function createDecalMaterials(quality = 'high') {
  const S = Math.round(1024 * atlasScale(quality));
  if (decalMats && decalSize === S) return decalMats;
  const old = decalAtlas;
  decalAtlas = atlasTexture(S, Math.round(S * DECAL_ROWS / 4), (ctx, w) => drawDecalAtlas(ctx, w), { anisotropy: 4, name: 'decals' });
  decalSize = S;
  if (decalMats) {
    for (const m of Object.values(decalMats)) m.map = decalAtlas;
    old?.dispose();
    return decalMats;
  }
  const base = { map: decalAtlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, vertexColors: true };
  decalMats = {
    grime: new THREE.MeshStandardMaterial({ ...base, roughness: 0.92, metalness: 0 }),
    wet: new THREE.MeshStandardMaterial({ ...base, color: '#3a3f44', roughness: 0.04, metalness: 0.1, envMapIntensity: 1.4 }),
    paint: new THREE.MeshStandardMaterial({ ...base, roughness: 0.75, metalness: 0 }),
    // Lichtkegel am Boden (unbeleuchtet, additiv): Lampenpools ohne echte Punktlichter (auch auf low)
    light: new THREE.MeshBasicMaterial({ ...base, blending: THREE.AdditiveBlending }),
  };
  for (const [k, m] of Object.entries(decalMats)) { m.name = 'decal_' + k; m.userData.surface = 'concrete'; }
  return decalMats;
}

// ---------------------------------------------------------------------------
// Schilder
// ---------------------------------------------------------------------------
/** Standardschilder, die jede Karte nutzen kann (ohne eigene Definition). */
export const DEFAULT_SIGNS = {
  warn_volt: { style: 'warning', text: 'HOCHSPANNUNG', sub: 'Lebensgefahr' },
  warn_entry: { style: 'warning', text: 'BETRETEN VERBOTEN', sub: 'Eltern haften für ihre Kinder' },
  warn_forklift: { style: 'warning', text: 'STAPLERVERKEHR', sub: 'Vorsicht beim Queren' },
  warn_crane: { style: 'warning', text: 'KRANBETRIEB', sub: 'Nicht unter schwebende Lasten treten' },
  exit: { style: 'plate', text: 'NOTAUSGANG', bg: '#1f7a46', fg: '#ffffff' },
  no_smoking: { style: 'plate', text: 'RAUCHEN VERBOTEN', bg: '#f2f0ea', fg: '#c8302a' },
};
/**
 * entries: [{ key, text, sub, bg, fg, style: 'plate'|'stencil'|'warning'|'logo'|'number'|'neon'|'arrow', aspect, accent }]
 * opts: { quality ('low' → halbe Auflösung), anisotropy }
 * → { material, litMaterial, rects: { key: {u0,v0,u1,v1} }, texture, width, height }
 *
 * Regalpackung: Schilder nach Höhe sortiert, jedes Regal so hoch wie sein höchstes Schild, Atlas genau so hoch
 * wie belegt (WebGL2: NPOT mit Mipmaps). Gezeichnet wird in Basiseinheiten (Zeile 160 px) und skaliert.
 */
export function createSignAtlas(entries, { quality = 'high', anisotropy = 8 } = {}) {
  const k = atlasScale(quality);
  const BW = 2048, rowH = 160, gap = 4;
  // Größe je Schild in Basiseinheiten
  const items = entries.map(e => {
    const aspect = Math.max(0.5, Math.min(8, e.aspect || 4));
    const h = e.style === 'number' || aspect < 1.6 ? rowH * 2 : rowH;
    return { e, h, w: Math.min(BW, Math.round(h * aspect)) };
  });
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, shelfH = 0;
  const slots = [];
  for (const it of items) {
    if (x > 0 && x + it.w > BW) { x = 0; y += shelfH + gap; shelfH = 0; }
    slots.push({ e: it.e, x, y, w: it.w, h: it.h });
    x += it.w + gap;
    shelfH = Math.max(shelfH, it.h);
  }
  const BH = Math.max(rowH, y + shelfH);
  const fit = Math.min(1, 4096 / (BH * k)); // nur bei Überlänge senkrecht stauchen
  const W = Math.round(BW * k), H = Math.ceil((BH * k * fit) / 4) * 4;
  const ky = k * fit;
  const rects = {};
  for (const s of slots) {
    rects[s.e.key] = { u0: s.x / BW, u1: (s.x + s.w) / BW, v0: 1 - ((s.y + s.h) * ky) / H, v1: 1 - (s.y * ky) / H };
  }
  const tex = atlasTexture(W, H, (ctx) => {
    const r = rng(99);
    ctx.scale(k, ky);
    for (const s of slots) drawSign(ctx, s, r);
  }, { anisotropy, name: 'signs' });
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  material.name = 'signs'; material.userData.surface = 'metal';
  const litMaterial = material.clone();
  litMaterial.emissive.set('#ffffff'); litMaterial.emissiveMap = tex; litMaterial.emissiveIntensity = 1.4; litMaterial.name = 'signs_lit';
  return { material, litMaterial, rects, texture: tex, width: W, height: H };
}

function roundRect(ctx, x, y, w, h, rad) {
  ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
}

/** Größte Schriftgröße (size, size−2, …, ≥ 8), bei der text in maxW passt. Breite skaliert linear → Schätzung + Prüfung. */
function fitText(ctx, text, maxW, size, weight = 800, font = FONT, stretch = '') {
  const set = (px) => { ctx.font = `${stretch}${weight} ${px}px ${font}`; return ctx.measureText(text).width; };
  const w = set(size);
  if (w <= maxW || size <= 10) return size;
  let s = size - 2 * Math.max(1, Math.ceil((size - (size * maxW) / w) / 2));
  while (s > 10 && set(s) > maxW) s -= 2;
  s = Math.max(s, size - 2 * Math.floor((size - 9) / 2)); // kleinster Wert der Folge size, size−2, … über 8
  set(s);
  return s;
}

function grime(ctx, r, x, y, w, h, amount = 1) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let i = 0; i < 40 * amount; i++) {
    const gx = x + r() * w, gy = y + r() * h, rr = 4 + r() * 26;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
    g.addColorStop(0, `rgba(40,32,24,${0.08 + r() * 0.12})`); g.addColorStop(1, 'rgba(40,32,24,0)');
    ctx.fillStyle = g; ctx.fillRect(gx - rr, gy - rr, rr * 2, rr * 2);
  }
  // Laufspuren
  for (let i = 0; i < 6 * amount; i++) {
    const gx = x + r() * w, len = h * (0.2 + r() * 0.6);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(60,40,25,0.18)'); g.addColorStop(1, 'rgba(60,40,25,0)');
    ctx.fillStyle = g; ctx.fillRect(gx, y, 2 + r() * 3, len);
  }
  ctx.restore();
}

function drawSign(ctx, s, r) {
  const { e, x, y, w, h } = s;
  const bg = e.bg || '#1f3d5c', fg = e.fg || '#ffffff', st = e.style || 'plate';
  ctx.save();
  ctx.translate(x, y);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pad = Math.round(h * 0.1);
  if (st === 'stencil') {
    ctx.fillStyle = fg;
    const size = fitText(ctx, e.text, w - pad * 2, Math.round(h * (e.sub ? 0.58 : 0.78)), 900);
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.fillText(e.text, w / 2, e.sub ? h * 0.38 : h / 2 + size * 0.04);
    if (e.sub) { const s2 = fitText(ctx, e.sub, w - pad * 2, Math.round(h * 0.26), 700); ctx.font = `700 ${s2}px ${FONT}`; ctx.fillText(e.sub, w / 2, h * 0.78); }
    // Schablonenstege + Abrieb
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { ctx.globalAlpha = 0.3 + r() * 0.7; ctx.beginPath(); ctx.arc(r() * w, r() * h, 0.5 + r() * 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  } else if (st === 'warning') {
    ctx.fillStyle = '#f2c230'; roundRect(ctx, 2, 2, w - 4, h - 4, 10); ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = '#151515'; roundRect(ctx, 10, 10, w - 20, h - 20, 6); ctx.stroke();
    // Warndreieck
    const tH = h * 0.62, tx = pad + tH * 0.6, ty = h / 2;
    ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.moveTo(tx, ty - tH / 2); ctx.lineTo(tx + tH * 0.58, ty + tH / 2); ctx.lineTo(tx - tH * 0.58, ty + tH / 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2c230'; ctx.font = `900 ${Math.round(tH * 0.62)}px ${FONT}`; ctx.fillText('!', tx, ty + tH * 0.12);
    ctx.fillStyle = '#151515';
    const tx2 = tx + tH * 0.75, avail = w - tx2 - pad * 1.5;
    const size = fitText(ctx, e.text, avail, Math.round(h * (e.sub ? 0.34 : 0.42)), 900);
    ctx.font = `900 ${size}px ${FONT}`; ctx.textAlign = 'left';
    ctx.fillText(e.text, tx2, e.sub ? h * 0.38 : h / 2);
    if (e.sub) { const s2 = fitText(ctx, e.sub, avail, Math.round(h * 0.2), 700); ctx.font = `700 ${s2}px ${FONT}`; ctx.fillText(e.sub, tx2, h * 0.68); }
    grime(ctx, r, 0, 0, w, h, 0.6);
  } else if (st === 'number') {
    ctx.fillStyle = bg; roundRect(ctx, 2, 2, w - 4, h - 4, 14); ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = fg; roundRect(ctx, 14, 14, w - 28, h - 28, 8); ctx.stroke();
    ctx.fillStyle = fg;
    const size = fitText(ctx, e.text, w - pad * 3, Math.round(h * (e.sub ? 0.5 : 0.66)), 900);
    ctx.font = `900 ${size}px ${FONT}`; ctx.fillText(e.text, w / 2, e.sub ? h * 0.42 : h / 2 + size * 0.04);
    if (e.sub) { const s2 = fitText(ctx, e.sub, w - pad * 3, Math.round(h * 0.16), 700, MONO); ctx.font = `700 ${s2}px ${MONO}`; ctx.fillText(e.sub, w / 2, h * 0.76); }
    grime(ctx, r, 0, 0, w, h, 0.4);
  } else if (st === 'neon') {
    ctx.fillStyle = bg; roundRect(ctx, 2, 2, w - 4, h - 4, 12); ctx.fill();
    const size = fitText(ctx, e.text, w - pad * 3, Math.round(h * 0.6), 700, FONT);
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.shadowColor = fg; ctx.shadowBlur = 18; ctx.fillStyle = fg; ctx.fillText(e.text, w / 2, h / 2 + size * 0.05);
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.65; ctx.fillText(e.text, w / 2, h / 2 + size * 0.05); ctx.globalAlpha = 1;
  } else if (st === 'logo') {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const acc = e.accent || '#ff5b1f';
    // abstraktes Logo: Kreis + Keil
    const lx = pad + h * 0.38, ly = h / 2, lr = h * 0.32;
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(lx - lr * 0.2, ly - lr); ctx.lineTo(lx + lr, ly - lr); ctx.lineTo(lx + lr * 0.2, ly + lr); ctx.lineTo(lx - lr, ly + lr); ctx.closePath(); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = fg; ctx.textAlign = 'left';
    const tx = lx + lr + pad, avail = w - tx - pad;
    const size = fitText(ctx, e.text, avail, Math.round(h * (e.sub ? 0.46 : 0.6)), 900);
    ctx.font = `900 ${size}px ${FONT}`; ctx.fillText(e.text, tx, e.sub ? h * 0.4 : h / 2 + size * 0.04);
    if (e.sub) { const s2 = fitText(ctx, e.sub, avail, Math.round(h * 0.2), 600); ctx.font = `600 ${s2}px ${FONT}`; ctx.globalAlpha = 0.85; ctx.fillText(e.sub, tx, h * 0.74); ctx.globalAlpha = 1; }
    grime(ctx, r, 0, 0, w, h, 0.7);
  } else if (st === 'arrow') {
    ctx.fillStyle = bg; roundRect(ctx, 2, 2, w - 4, h - 4, 10); ctx.fill();
    ctx.fillStyle = fg;
    const ax = e.dir === 'left' ? pad + h * 0.35 : w - pad - h * 0.35, dir = e.dir === 'left' ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(ax + dir * h * 0.3, h / 2); ctx.lineTo(ax - dir * h * 0.05, h * 0.18); ctx.lineTo(ax - dir * h * 0.05, h * 0.36); ctx.lineTo(ax - dir * h * 0.35, h * 0.36);
    ctx.lineTo(ax - dir * h * 0.35, h * 0.64); ctx.lineTo(ax - dir * h * 0.05, h * 0.64); ctx.lineTo(ax - dir * h * 0.05, h * 0.82); ctx.closePath(); ctx.fill();
    const avail = w - h - pad * 3, size = fitText(ctx, e.text, avail, Math.round(h * 0.46), 800);
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillText(e.text, e.dir === 'left' ? (w + h * 0.7) / 2 : (w - h * 0.7) / 2, h / 2 + size * 0.04);
    grime(ctx, r, 0, 0, w, h, 0.4);
  } else { // plate
    ctx.fillStyle = bg; roundRect(ctx, 2, 2, w - 4, h - 4, Math.min(16, h * 0.08)); ctx.fill();
    if (e.border !== false) { ctx.lineWidth = Math.max(3, h * 0.03); ctx.strokeStyle = e.borderColor || fg; ctx.globalAlpha = 0.85; roundRect(ctx, h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14, Math.min(10, h * 0.05)); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = fg;
    const size = fitText(ctx, e.text, w - pad * 3, Math.round(h * (e.sub ? 0.42 : 0.56)), 800);
    ctx.font = `800 ${size}px ${FONT}`; ctx.fillText(e.text, w / 2, e.sub ? h * 0.4 : h / 2 + size * 0.04);
    if (e.sub) { const s2 = fitText(ctx, e.sub, w - pad * 3, Math.round(h * 0.2), 600); ctx.font = `600 ${s2}px ${FONT}`; ctx.globalAlpha = 0.9; ctx.fillText(e.sub, w / 2, h * 0.73); ctx.globalAlpha = 1; }
    // Schrauben
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const [bx, by] of [[h * 0.045, h * 0.045], [w - h * 0.045, h * 0.045], [h * 0.045, h * 0.955], [w - h * 0.045, h * 0.955]]) { ctx.beginPath(); ctx.arc(bx, by, Math.max(2, h * 0.018), 0, Math.PI * 2); ctx.fill(); }
    grime(ctx, r, 0, 0, w, h, e.grime ?? 0.5);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Foliage
// ---------------------------------------------------------------------------
let foliageTex = null, foliageSize = 0;
const foliageMats = new Map();
export const foliageUniforms = { uTime: { value: 0 } };

function drawFoliageAtlas(ctx, S) {
  ctx.scale(S / 1024, S / 1024); // gezeichnet wird in 1024er-Koordinaten
  const C = 512;
  const r = rng(4242);
  const leaf = (x, y, a, len, wid, col) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.5, -wid, len, 0); ctx.quadraticCurveTo(len * 0.5, wid, 0, 0); ctx.fill();
    ctx.restore();
  };
  const greens = () => { const g = 80 + r() * 70; return `rgb(${Math.round(g * 0.55 + r() * 20)},${Math.round(g + 10)},${Math.round(g * 0.35)})`; };
  // 0: Buschblätter (dicht, rundlich)
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.clip();
  for (let i = 0; i < 1400; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 220;
    const x = 256 + Math.cos(a) * d, y = 280 + Math.sin(a) * d * 0.85;
    const shade = 0.55 + (1 - d / 240) * 0.25 + (256 - y) / 900;
    const g = 90 + r() * 60;
    leaf(x, y, r() * Math.PI * 2, 18 + r() * 14, 6 + r() * 4, `rgb(${Math.round(g * 0.5 * shade + 10)},${Math.round(g * shade + 20)},${Math.round(g * 0.3 * shade)})`);
  }
  ctx.restore();
  // 1: Grasbüschel
  ctx.save(); ctx.translate(C, 0); ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.clip();
  for (let i = 0; i < 260; i++) {
    const bx = 60 + r() * 392, h = 180 + r() * 300, bend = (r() - 0.5) * 140, w = 3 + r() * 5;
    const g = 70 + r() * 80, dry = r() < 0.25;
    ctx.fillStyle = dry ? `rgb(${150 + r() * 40},${135 + r() * 30},${80})` : `rgb(${Math.round(g * 0.6)},${Math.round(g + 20)},${Math.round(g * 0.3)})`;
    ctx.beginPath(); ctx.moveTo(bx - w, C); ctx.quadraticCurveTo(bx + bend * 0.3, C - h * 0.6, bx + bend, C - h); ctx.quadraticCurveTo(bx + bend * 0.3 + w, C - h * 0.6, bx + w, C); ctx.fill();
  }
  ctx.restore();
  // 2: Palmwedel (Spitze nach rechts, Stiel links mittig)
  ctx.save(); ctx.translate(0, C); ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.clip();
  ctx.strokeStyle = '#6b6a3a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(4, 256); ctx.quadraticCurveTo(256, 230, 506, 262); ctx.stroke();
  for (let i = 0; i < 70; i++) {
    const t = i / 70, x = 10 + t * 490, y = 256 - Math.sin(t * Math.PI) * 18 + t * 8;
    const len = (1 - Math.abs(t - 0.35) * 1.1) * 210 + 30;
    for (const side of [-1, 1]) {
      const g = 90 + r() * 50;
      leaf(x, y, side * (1.0 + t * 0.4) + 0.15, len, 7, `rgb(${Math.round(g * 0.62)},${Math.round(g + 15)},${Math.round(g * 0.32)})`);
    }
  }
  ctx.restore();
  // 3: Blüten (Bougainvillea) – Blätter + Pink
  ctx.save(); ctx.translate(C, C); ctx.beginPath(); ctx.rect(0, 0, C, C); ctx.clip();
  for (let i = 0; i < 900; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 230, x = 256 + Math.cos(a) * d, y = 256 + Math.sin(a) * d;
    leaf(x, y, r() * Math.PI * 2, 16 + r() * 10, 6, greens());
  }
  for (let i = 0; i < 900; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 220, x = 256 + Math.cos(a) * d, y = 256 + Math.sin(a) * d;
    ctx.fillStyle = `rgb(${200 + r() * 55},${40 + r() * 50},${120 + r() * 60})`;
    ctx.beginPath(); ctx.arc(x, y, 3 + r() * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Foliage-Atlas in der Größe der Qualitätsstufe (1024² bzw. 512² auf low); Wechsel tauscht nur die Textur. */
function ensureFoliageAtlas(quality) {
  const S = Math.round(1024 * atlasScale(quality));
  if (foliageTex && foliageSize === S) return;
  const old = foliageTex;
  foliageTex = atlasTexture(S, S, (ctx, w) => drawFoliageAtlas(ctx, w), { anisotropy: 4, name: 'foliage' });
  foliageSize = S;
  for (const m of foliageMats.values()) m.map = foliageTex;
  old?.dispose();
}

function foliageMaterial(cast) {
  const key = cast ? 'c' : 'n';
  if (foliageMats.has(key)) return foliageMats.get(key);
  const m = new THREE.MeshStandardMaterial({ map: foliageTex, alphaTest: 0.45, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  m.name = 'foliage';
  m.userData.surface = 'grass';
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = foliageUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sw = max(0.0, position.y) * 0.045;
      transformed.x += sin(uTime * 1.6 + ip.x * 0.7 + ip.z * 0.3 + position.y) * sw;
      transformed.z += cos(uTime * 1.3 + ip.z * 0.6 + position.x) * sw * 0.7;`);
    // Rückseiten nicht abdunkeln: Normalen der Karte nach oben gemischt
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.55));`);
  };
  m.customProgramCacheKey = () => 'foliage-v1';
  foliageMats.set(key, m);
  return m;
}

/** Kreuzkarten-Geometrie für eine Atlaszelle. */
function crossGeom(cell, w, h, planes, yOff = 0, tiltTop = 0) {
  const u0 = (cell % 2) * 0.5, v0 = 0.5 - Math.floor(cell / 2) * 0.5;
  const P = [], U = [], N = [];
  for (let i = 0; i < planes; i++) {
    const a = (i / planes) * Math.PI;
    const cx = Math.cos(a), sz = Math.sin(a);
    const q = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
    const uv = [[u0 + 0.005, v0 + 0.005], [u0 + 0.495, v0 + 0.005], [u0 + 0.495, v0 + 0.495], [u0 + 0.005, v0 + 0.495]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [x, y] = q[k];
      const lean = y / h * tiltTop;
      P.push(x * cx + lean * sz, y + yOff, x * sz - lean * cx);
      U.push(uv[k][0], uv[k][1]);
      N.push(-sz, 0.3, cx);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}

/** Kugelige Krone aus Karten (Busch, Olivenbaum). */
function clusterGeom(cell, radius, count, seed, yC) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const g = crossGeom(cell, radius * 1.1, radius * 1.1, 2);
    const a = r() * Math.PI * 2, el = (r() - 0.3) * 1.2;
    const d = radius * 0.45;
    g.rotateY(r() * Math.PI);
    g.rotateX((r() - 0.5) * 0.8);
    g.translate(Math.cos(a) * d * Math.cos(el), yC + Math.sin(el) * d * 0.7 - radius * 0.5, Math.sin(a) * d * Math.cos(el));
    parts.push(g);
  }
  return mergeSimple(parts);
}

/** Palmkrone: hängende Wedel. */
function palmCrownGeom() {
  const parts = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
    const droop = 0.35 + (i % 3) * 0.18;
    // Wedel als 2 Segmente (geknickt)
    const P = [], U = [], N = [];
    const L = 3.4, W = 1.5;
    const pts = [[0, 0], [L * 0.5, 0.35 - droop * 0.4], [L, -droop * 1.5]];
    for (let s = 0; s < 2; s++) {
      const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
      const uA = 0.005 + (s / 2) * 0.49, uB = 0.005 + ((s + 1) / 2) * 0.49;
      const q = [[x0, y0, -W / 2, uA, 0.505], [x1, y1, -W / 2, uB, 0.505], [x1, y1, W / 2, uB, 0.995], [x0, y0, W / 2, uA, 0.995]];
      for (const k of [0, 1, 2, 0, 2, 3]) { const [x, y, z, u, v] = q[k]; P.push(x, y, z); U.push(u, v); N.push(0, 1, 0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.rotateX((i % 2 ? 0.25 : -0.25));
    g.rotateY(-a);
    parts.push(g);
  }
  return mergeSimple(parts);
}

function mergeSimple(geoms) {
  let n = 0; for (const g of geoms) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), U = new Float32Array(n * 2), N = new Float32Array(n * 3);
  let o = 0;
  for (const g of geoms) {
    P.set(g.attributes.position.array, o * 3); U.set(g.attributes.uv.array, o * 2); N.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}

const KINDS = {
  bush:    { geom: () => clusterGeom(0, 1.2, 7, 11, 0.9), cast: true, tint: ['#9fb27a', '#87a06a', '#b2b884'] },
  hedge:   { geom: () => clusterGeom(0, 1.0, 6, 12, 0.7), cast: true, tint: ['#7f9a5a', '#90a868'] },
  olive:   { geom: () => clusterGeom(0, 2.6, 14, 13, 3.6), cast: true, tint: ['#a9b391', '#9aa884', '#b6bb98'] },
  tree:    { geom: () => clusterGeom(0, 3.0, 16, 14, 4.6), cast: true, tint: ['#8ea866', '#7f9c5c', '#a0b070'] },
  grass:   { geom: () => crossGeom(1, 0.9, 0.7, 3), cast: false, tint: ['#c7c9a0', '#b9c08e', '#d6cfa0'] },
  weeds:   { geom: () => crossGeom(1, 0.7, 0.55, 2), cast: false, tint: ['#a8b07c', '#c4b98a', '#9aa070'] },
  reeds:   { geom: () => crossGeom(1, 1.0, 1.6, 3), cast: false, tint: ['#c2bc88', '#aab07a'] },
  palm:    { geom: () => palmCrownGeom(), cast: true, tint: ['#c4cf8f', '#b5c482', '#d0d49a'] },
  flowers: { geom: () => crossGeom(3, 1.4, 1.4, 1), cast: false, tint: ['#ffffff', '#f2e6ee'] },
  vine:    { geom: () => clusterGeom(3, 1.1, 5, 15, 0.6), cast: true, tint: ['#ffffff', '#efe2ea'] },
};

/**
 * Baut InstancedMeshes für alle Pflanzen. plants: [{ kind, x, y, z, s, ry, tint }]
 * @returns {{ meshes: THREE.InstancedMesh[] }}
 */
export function createFoliage(plants, quality = 'high') {
  if (plants.length) ensureFoliageAtlas(quality);
  const byKind = new Map();
  for (const p of plants) {
    if (!KINDS[p.kind]) continue;
    if (quality === 'low' && (p.kind === 'grass' || p.kind === 'weeds') && (Math.abs(p.x * 7 + p.z * 13) % 3) > 0.9) continue; // ausdünnen
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  const meshes = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const r = rng(7);
  for (const [kind, list] of byKind) {
    const def = KINDS[kind];
    const geom = def.geom();
    geom.computeBoundingSphere();
    const mesh = new THREE.InstancedMesh(geom, foliageMaterial(def.cast), list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.ry);
      s.setScalar(p.s);
      pos.set(p.x, p.y, p.z);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);
      c.set(p.tint || def.tint[Math.floor(r() * def.tint.length)]);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = def.cast; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = 'foliage-' + kind;
    meshes.push(mesh);
  }
  return { meshes };
}
