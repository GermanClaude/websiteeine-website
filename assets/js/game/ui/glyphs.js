// NULLPUNKT — Schrift-Sprites für Canvas-Karten (Minikarte, Zielkarte des Präzisionsschlags).
// fillText()/measureText() auf einer eingehängten Canvas lösen in Chrome jedes Mal eine synchrone Stilberechnung des
// Dokuments aus (Schrift und Schreibrichtung hängen am Element) – mitten im Bild, nachdem das HUD schon Stile geändert
// hat. Buchstaben werden daher einmal auf eine nicht eingehängte Canvas gezeichnet und danach per drawImage kopiert.
// Der Zwischenspeicher leert sich, sobald Webfonts fertig geladen sind (vorher gezeichnete Sprites nutzen die Ersatzschrift).

const cache = new Map();
let hooked = false;

function fontSet() {
  return typeof document !== 'undefined' ? document.fonts : null;
}

function hook() {
  if (hooked) return;
  hooked = true;
  const fonts = fontSet();
  if (fonts && typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', () => cache.clear());
}

/** Sprite { canvas, w, h } für `text` in `font` (CSS-Kurzform mit px-Größe) und `color`; Ursprung = Mitte. */
export function glyph(text, font, color) {
  hook();
  const key = `${font}|${color}|${text}`;
  let g = cache.get(key);
  if (g) return g;
  const fonts = fontSet();
  try {
    if (fonts && typeof fonts.check === 'function' && !fonts.check(font, text)) fonts.load(font, text).catch(() => {});
  } catch { /* ungültige Schriftangabe: Ersatzschrift */ }
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const px = Number((/(\d+(?:\.\d+)?)px/.exec(font) || [])[1]) || 12;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + px * 0.5) + 2;
  const h = Math.ceil(px * 1.6) + 2;
  c.width = w;
  c.height = h; // setzt den Kontextzustand zurück
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  g = { canvas: c, w, h };
  cache.set(key, g);
  return g;
}

/** Zeichnet `text` zentriert bei (x, y) – wie fillText mit textAlign center / textBaseline middle, ohne Stilberechnung. */
export function drawGlyph(ctx, text, font, color, x, y) {
  const g = glyph(text, font, color);
  ctx.drawImage(g.canvas, Math.round(x - g.w / 2), Math.round(y - g.h / 2));
}
