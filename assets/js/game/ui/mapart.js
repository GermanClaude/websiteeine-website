// NULLPUNKT — Kartenvorschau für Lobby/Ladebildschirm: echte Minikarte (nach dem ersten Match dieser Sitzung
// zwischengespeichert), sonst vereinfachter Grundriss aus MAPS[id].layout, sonst Paletten-Grafik.

const cache = new Map(); // mapId → Canvas (Kopie der Minikarte)

/** Nach dem Laden einer Welt: Minikarte für spätere Vorschauen merken (verkleinert). */
export function rememberMinimap(mapId, world) {
  try {
    const src = world && world.minimap && world.minimap.canvas;
    if (!mapId || !src || src.width < 8 || cache.has(mapId)) return;
    const size = 256;
    const c = document.createElement('canvas');
    const aspect = src.width / src.height || 1;
    c.width = aspect >= 1 ? size : Math.round(size * aspect);
    c.height = aspect >= 1 ? Math.round(size / aspect) : size;
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    cache.set(mapId, c);
  } catch { /* Canvas nicht lesbar */ }
}

/**
 * Zeichnet die Vorschau in `canvas` (CSS-Größe wird übernommen). map = MAPS[id].
 */
export function drawMapArt(canvas, map, { flags = true } = {}) {
  const r = canvas.getBoundingClientRect();
  const d = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(8, Math.round((r.width || 240) * d));
  const H = Math.max(8, Math.round((r.height || 140) * d));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  const pal = (map && map.palette && map.palette.length ? map.palette : ['#3b3f44', '#2a2e33', '#ff5b1f', '#1f4a57', '#b9b5ac']);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Grund
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(pal[3] || pal[0], -0.55));
  g.addColorStop(1, shade(pal[0], -0.72));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const img = map ? cache.get(map.id) : null;
  if (img) {
    const s = Math.max(W / img.width, H / img.height) * 1.05;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    ctx.globalAlpha = 1;
  } else if (map && Array.isArray(map.layout) && map.layout.length) {
    drawLayout(ctx, map, W, H, pal, flags);
  } else {
    drawPalette(ctx, map, W, H, pal);
  }
  // Raster + Vignette
  ctx.strokeStyle = 'rgba(233,230,223,.06)';
  ctx.lineWidth = 1;
  const step = 16 * d;
  ctx.beginPath();
  for (let x = step; x < W; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
  for (let y = step; y < H; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke();
  const v = ctx.createLinearGradient(0, H * 0.45, 0, H);
  v.addColorStop(0, 'rgba(10,11,13,0)');
  v.addColorStop(1, 'rgba(10,11,13,.85)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function drawLayout(ctx, map, W, H, pal, flags) {
  const dim = map.dimensions || { x: 100, z: 100 };
  const s = Math.min(W / (dim.x + 8), H / (dim.z + 8)) * 1.25;
  // Mittelpunkt der Spielfläche (bounds) in die Bildmitte
  const b = map.bounds;
  const cx = b ? (b.minX + b.maxX) / 2 : 0;
  const cz = b ? (b.minZ + b.maxZ) / 2 : 0;
  ctx.save();
  ctx.translate(W / 2 - cx * s, H / 2 - cz * s);
  const build = shade(pal[0], -0.05);
  const land = shade(pal[2] || pal[0], 0.05);
  const colors = {
    building: build, house: build, werkstatt: build, torhaus: build, leitstand: build, bunker: shade(pal[1], -0.2),
    kirche: land, turm: land, loggia: land, well: land, kesselhaus: land, schornstein: land, ofen: land, tank: land,
    cover: shade(pal[4] || pal[1], -0.35), container: pal[1], wall: shade(pal[0], -0.35), water: '#173246',
    stairs: shade(pal[0], 0.1), vehicle: shade(pal[2] || pal[1], -0.2), truck: shade(pal[2] || pal[1], -0.2), car: shade(pal[2] || pal[1], -0.25),
    catwalk: shade(pal[4] || pal[0], -0.15), rollgang: shade(pal[4] || pal[0], -0.2), machine: shade(pal[3] || pal[1], -0.1),
    market: shade(pal[2] || pal[1], -0.05), zone: 'rgba(255,255,255,.05)', lane: 'rgba(255,255,255,.06)',
  };
  const order = (k) => (k === 'water' || k === 'zone' || k === 'lane' ? 0 : 1);
  const list = map.layout.slice().sort((a, c) => order(a[4]) - order(c[4]));
  for (const bl of list) {
    const [x, z, w, dd, kind, rot] = bl;
    ctx.fillStyle = colors[kind] || shade(pal[1], -0.2);
    ctx.globalAlpha = kind === 'zone' || kind === 'lane' ? 1 : 0.92;
    if (rot) {
      ctx.save();
      ctx.translate(x * s, z * s);
      ctx.rotate(-rot);
      ctx.fillRect((-w / 2) * s, (-dd / 2) * s, w * s, dd * s);
      ctx.restore();
    } else ctx.fillRect((x - w / 2) * s, (z - dd / 2) * s, w * s, dd * s);
  }
  ctx.globalAlpha = 1;
  if (flags && Array.isArray(map.flags)) {
    for (const f of map.flags) {
      const [x, z, id] = Array.isArray(f) ? f : [f.x, f.z, f.id];
      ctx.beginPath();
      ctx.arc(x * s, z * s, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,11,13,.85)';
      ctx.fill();
      ctx.strokeStyle = '#ff5b1f';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (id) {
        ctx.fillStyle = '#e9e6df';
        ctx.font = '700 10px "Rajdhani NP", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(id), x * s, z * s + 0.5);
      }
    }
  }
  ctx.restore();
}

function drawPalette(ctx, map, W, H, pal) {
  // Abstrakte Draufsicht: Blöcke aus der Palette, deterministisch aus der Karten-Id
  let seed = 0;
  for (const ch of String(map ? map.id : 'x')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cell = Math.max(W, H) / 14;
  for (let i = 0; i < 46; i++) {
    const w = cell * (0.6 + rnd() * 2.4);
    const h = cell * (0.5 + rnd() * 1.6);
    const x = rnd() * (W - w);
    const y = rnd() * (H - h);
    ctx.fillStyle = shade(pal[(i * 7) % pal.length], -0.25 - rnd() * 0.35);
    ctx.globalAlpha = 0.55 + rnd() * 0.35;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;
  // drei Gassen
  ctx.strokeStyle = 'rgba(233,230,223,.1)';
  ctx.lineWidth = Math.max(2, cell * 0.35);
  for (const k of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(W * k + (rnd() - 0.5) * cell, 0);
    ctx.bezierCurveTo(W * k + cell, H * 0.35, W * k - cell, H * 0.65, W * k + (rnd() - 0.5) * cell, H);
    ctx.stroke();
  }
}

/** Farbe aufhellen (+) / abdunkeln (−), Hex → rgb(). */
export function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0x3b3f44;
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = k < 0 ? 0 : 255;
  const f = Math.abs(k);
  r = Math.round(r + (t - r) * f);
  g = Math.round(g + (t - g) * f);
  b = Math.round(b + (t - b) * f);
  return `rgb(${r},${g},${b})`;
}
