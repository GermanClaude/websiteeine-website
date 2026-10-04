// Eine höfliche Live-Region (#live). Doppelte Meldungen werden verworfen, andere im
// Abstand von ≥ 1 s ausgegeben – außer direkten Ergebnissen einer Nutzeraktion (now: true).

let region = null;
let lastText = '';
let lastAt = 0;
let pending = null;
let timer = 0;

function write(text) {
  if (!region) region = document.getElementById('live');
  if (!region) return;
  lastText = text;
  lastAt = performance.now();
  region.textContent = '';
  // Neuer Textknoten im nächsten Takt, damit Screenreader auch Wiederholungen hören.
  requestAnimationFrame(() => { region.textContent = text; });
}

/** Meldet `text` in der Live-Region. */
export function announce(text, { now = false } = {}) {
  if (!text) return;
  const t = performance.now();
  if (text === lastText && t - lastAt < 4000 && !now) return;
  if (now || t - lastAt >= 1000) {
    clearTimeout(timer);
    pending = null;
    write(text);
    return;
  }
  pending = text;
  clearTimeout(timer);
  timer = setTimeout(() => { if (pending) write(pending); pending = null; }, 1000 - (t - lastAt));
}

/** Entprellte Meldung: erst nach `ms` Ruhe. */
export function debounced(ms = 400) {
  let id = 0;
  return (text) => { clearTimeout(id); id = setTimeout(() => announce(text), ms); };
}
