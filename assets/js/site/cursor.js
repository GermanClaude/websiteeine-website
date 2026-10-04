// Fadenkreuz als Mauszeiger (nur feine Zeiger), Streuung aus der Zeigergeschwindigkeit,
// Zielerkennung und Treffermarker (Maus und Touch).
import { loop } from './loop.js';

const TARGETS = 'a, button, [role=tab], [data-target], label.slot, input[type=range], summary, .sw, .enum label, .chk';
const fineMq = window.matchMedia('(pointer: fine)');
const forcedMq = window.matchMedia('(forced-colors: active)');

let el = null;
let svg = null;
let hm = null;
let style = 'cross';
let gap = 4;
let extra = 0;
let onTarget = false;
let shownGap = 4;
let lx = 0;
let ly = 0;
let lt = 0;
let px = -100;
let py = -100;
let running = false;
let enabled = false;

/** Aktuelle Streuung (px) – dieselbe nutzt das Einschießen im Hero. */
export function spread() { return enabled ? gap : 0; }
export function cursorEnabled() { return enabled; }

function draw() {
  const g = shownGap;
  const c = 32;
  if (style === 'dot') {
    svg.innerHTML = `<circle cx="${c}" cy="${c}" r="1.5" fill="currentColor"/><circle cx="${c}" cy="${c}" r="${(g + 4).toFixed(2)}" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/>`;
  } else if (style === 'circle') {
    svg.innerHTML = `<circle cx="${c}" cy="${c}" r="${Math.max(2, g + 2).toFixed(2)}" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="${c}" cy="${c}" r=".75" fill="currentColor"/>`;
  } else {
    const a = g;
    const b = g + 8;
    svg.innerHTML = `<g stroke="currentColor" stroke-width="1" shape-rendering="crispEdges">` +
      `<line x1="${c}" y1="${c - a}" x2="${c}" y2="${c - b}"/><line x1="${c}" y1="${c + a}" x2="${c}" y2="${c + b}"/>` +
      `<line x1="${c - a}" y1="${c}" x2="${c - b}" y2="${c}"/><line x1="${c + a}" y1="${c}" x2="${c + b}" y2="${c}"/></g>`;
  }
}

function tick(dt) {
  extra *= Math.exp(-dt / 0.09);
  if (extra < 0.05) extra = 0;
  gap = 4 + extra;
  const target = onTarget ? 2 : gap;
  shownGap += (target - shownGap) * Math.min(1, dt / 0.04);
  if (Math.abs(shownGap - target) < 0.05) shownGap = target;
  draw();
  if (!extra && shownGap === target) { running = false; return false; }
  return true;
}
function wake() { if (!running) { running = true; loop.add(tick); } }

function move(e) {
  if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
  const t = e.timeStamp || performance.now();
  const dt = lt ? Math.max(1, t - lt) : 16.7;
  const speed = Math.hypot(e.clientX - lx, e.clientY - ly) / (dt / 16.67);
  lx = e.clientX; ly = e.clientY; lt = t;
  px = e.clientX; py = e.clientY;
  el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
  const v = Math.min(24, speed * 0.6);
  if (v > extra) extra = v;
  if (!el.classList.contains('on')) el.classList.add('on');
  wake();
}

function over(e) {
  const t = e.target instanceof Element ? e.target : null;
  const inDialog = !!t?.closest('dialog');
  el.style.visibility = inDialog ? 'hidden' : '';
  const tg = !!t?.closest(TARGETS) && !t.closest('[aria-disabled="true"], :disabled');
  if (tg !== onTarget) { onTarget = tg; el.classList.toggle('tgt', tg); wake(); }
}

function makeHm() {
  const d = document.createElement('div');
  d.className = 'hm';
  d.setAttribute('aria-hidden', 'true');
  d.innerHTML = '<svg viewBox="0 0 28 28"><g stroke="currentColor" stroke-width="1.5"><line x1="5" y1="5" x2="10" y2="10"/><line x1="23" y1="5" x2="18" y2="10"/><line x1="5" y1="23" x2="10" y2="18"/><line x1="23" y1="23" x2="18" y2="18"/></g></svg>';
  document.body.appendChild(d);
  return d;
}

/** Treffermarker an (x, y); kind 'kill' = rote Variante (Primäraktionen). */
export function hit(kind = 'hit', x = px, y = py) {
  if (!hm) hm = makeHm();
  hm.classList.remove('go', 'kill');
  hm.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  void hm.offsetWidth;
  hm.classList.toggle('kill', kind === 'kill');
  hm.classList.add('go');
}

function onClick(e) {
  if (e.button !== 0 && e.button !== undefined) return;
  const t = e.target instanceof Element ? e.target : null;
  if (!t || t.closest('dialog')) return;
  const x = e.clientX || px;
  const y = e.clientY || py;
  if (!x && !y) return;
  const kill = !!t.closest('[data-kill]');
  if (kill || t.closest(TARGETS) || !enabled) hit(kill ? 'kill' : 'hit', x, y);
}

function enable(on) {
  enabled = on;
  document.documentElement.classList.toggle('cursor-on', on);
  if (!el) return;
  if (!on) el.classList.remove('on');
}

/** Startet Cursor und Treffermarker. settings: Store mit crosshairStyle/crosshairColor. */
export function initCursor(settings) {
  el = document.createElement('div');
  el.className = 'xhair';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<svg viewBox="0 0 64 64"></svg>';
  svg = el.firstChild;
  document.body.appendChild(el);
  const apply = () => {
    style = settings?.get?.('crosshairStyle') || 'cross';
    const c = settings?.get?.('crosshairColor') || '#ffffff';
    document.documentElement.style.setProperty('--cursor-color', /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff');
    draw();
  };
  apply();
  settings?.onChange?.((k) => { if (k === 'crosshairStyle' || k === 'crosshairColor') apply(); });
  const decide = () => enable(fineMq.matches && !forcedMq.matches);
  decide();
  fineMq.addEventListener?.('change', decide);
  forcedMq.addEventListener?.('change', decide);
  window.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerover', over, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => el.classList.remove('on'));
  document.addEventListener('mouseleave', () => el.classList.remove('on'));
  window.addEventListener('blur', () => el.classList.remove('on'));
  document.addEventListener('click', onClick, true);
  return { setStyle: apply };
}

/** Zum Aktualisieren der Vorschau (z. B. Einstellungs-Kachel). */
export function crosshairSvg(st, color, size = 64) {
  const c = size / 2;
  const g = 4;
  if (st === 'dot') return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="color:${color}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="1.5" fill="currentColor"/><circle cx="${c}" cy="${c}" r="${g + 4}" fill="none" stroke="currentColor" opacity=".55"/></svg>`;
  if (st === 'circle') return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="color:${color}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${g + 2}" fill="none" stroke="currentColor"/><circle cx="${c}" cy="${c}" r=".75" fill="currentColor"/></svg>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="color:${color}" aria-hidden="true"><g stroke="currentColor" shape-rendering="crispEdges"><line x1="${c}" y1="${c - g}" x2="${c}" y2="${c - g - 8}"/><line x1="${c}" y1="${c + g}" x2="${c}" y2="${c + g + 8}"/><line x1="${c - g}" y1="${c}" x2="${c - g - 8}" y2="${c}"/><line x1="${c + g}" y1="${c}" x2="${c + g + 8}" y2="${c}"/></g></svg>`;
}
