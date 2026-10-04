// Sprünge im Dokument: Erst alle Abschnitte bis zum Ziel aufbauen, dann scrollen und
// während der Bewegung nachführen, falls sich darüber noch etwas setzt. Eine Nutzereingabe
// (Rad, Berührung, Taste) beendet das Nachführen sofort.
import { reduced } from './motion.js';

let setReady;
const ready = new Promise((r) => { setReady = r; });
let token = 0;
/** Bis main.js gestartet ist, warten Sprünge auf den Aufbau der Abschnitte (höchstens 4 s). */
const ensureUpTo = async (el) => {
  const fn = await Promise.race([ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
  if (fn) await fn(el);
};

/** main.js meldet hier, wie Abschnitte bis zu einem Element aufgebaut werden. */
export function setEnsureUpTo(fn) { setReady(fn); }

const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

function focusTarget(el) {
  const sec = el.matches('section') ? el : null;
  const f = sec ? sec.querySelector('h1, h2') : el;
  if (!f) return;
  if (!f.matches('a, button, input, select, textarea, [tabindex]')) f.setAttribute('tabindex', '-1');
  try { f.focus({ preventScroll: true }); } catch { /* egal */ }
}

/**
 * Springt zu #id. smooth: weiches Scrollen (aus bei reduzierter Bewegung).
 * focus: Fokus auf die Überschrift des Ziels setzen (wie ein echter Ankersprung mit Tastatur).
 */
export async function jumpTo(id, { smooth = true, focus = true, hash = true } = {}) {
  const el = document.getElementById(id);
  if (!el) return false;
  const my = ++token;
  await ensureUpTo(el);
  await frames(2);
  if (my !== token) return false;
  const behavior = smooth && !reduced() ? 'smooth' : 'auto';
  let cancelled = false;
  const stop = () => { cancelled = true; };
  const opts = { passive: true, capture: true };
  for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.addEventListener(t, stop, opts);
  const align = (b) => { if (!cancelled && my === token) el.scrollIntoView({ behavior: b, block: 'start' }); };
  align(behavior);
  if (focus) focusTarget(el);
  if (hash) { try { history.replaceState(null, '', `#${id}`); } catch { /* egal */ } }
  // Nachführen: Wächst etwas oberhalb des Ziels (Schriften, Pläne, Bilder), Ziel erneut ansteuern.
  const main = document.getElementById('main') || document.body;
  let lastTop = null;
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
    if (cancelled || my !== token) return;
    const top = el.getBoundingClientRect().top;
    if (lastTop !== null && Math.abs(top - lastTop) < 1) return;
    lastTop = top;
    align(behavior);
  }) : null;
  ro?.observe(main);
  await new Promise((r) => setTimeout(r, behavior === 'smooth' ? 1500 : 400));
  ro?.disconnect();
  for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.removeEventListener(t, stop, opts);
  // Letzte Kontrolle: liegt das Ziel nicht an seiner Stelle, ohne Bewegung korrigieren.
  if (!cancelled && my === token) {
    const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const off = el.getBoundingClientRect().top - pad;
    const atEnd = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1;
    if (Math.abs(off) > 3 && !(off > 0 && atEnd)) el.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  return true;
}

/** Ein Klickhandler für alle Anker im Dokument (Index, Dialog, untere Leiste, Hero, Fuß). */
export function initJumps() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!id || !document.getElementById(id)) return;
    e.preventDefault();
    jumpTo(id);
  });
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && document.getElementById(id)) jumpTo(id, { smooth: false, hash: false });
  });
}
