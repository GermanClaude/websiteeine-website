// Bewegungsregeln: reduzierte Bewegung (System ODER Einstellung ODER Wächter), Federn, FLIP, Sichtbarkeit.
import { loop } from './loop.js';

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let settingRM = false;
const fns = new Set();

function apply() {
  const on = reduced();
  document.documentElement.classList.toggle('rm', on);
  for (const fn of fns) { try { fn(on); } catch { /* egal */ } }
}
mq.addEventListener?.('change', apply);
loop.onStatic(apply);

/** Reduzierte Bewegung aktiv? */
export function reduced() { return mq.matches || settingRM || loop.static; }
/** Nur „ruhige Schrift“ (Wächter) – Wellen und Akte aus, aber Zustandsübergänge erlaubt. */
export function calm() { return reduced() || loop.static; }
export function setSettingReduced(v) { settingRM = !!v; apply(); }
export function onReducedChange(fn) { fns.add(fn); return () => fns.delete(fn); }
apply();

export const pointerFine = () => window.matchMedia('(pointer: fine)').matches;
export const pointerCoarse = () => window.matchMedia('(pointer: coarse)').matches;

/* Federn (semi-implizites Euler, Teilschritte ≤ 1/60 s) */
export const SPRINGS = {
  impulse: { k: 220, z: 1 },
  einschuss: { k: 260, z: 0.55 },
  settle: { k: 120, z: 1 },
};
/** Schritt einer Feder {x, v} Richtung 0. Gibt true zurück, solange sie sich bewegt. */
export function stepSpring(s, dt, { k, z }) {
  const c = 2 * z * Math.sqrt(k);
  let left = Math.min(dt, 1 / 30);
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 120);
    s.v += (-k * s.x - c * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(s.x) < 0.02 && Math.abs(s.v) < 0.05) { s.x = 0; s.v = 0; return false; }
  return true;
}
/** Anfangsgeschwindigkeit, mit der eine kritisch gedämpfte Feder ihr Maximum bei `peak` erreicht. */
export function impulseFor(peak, { k }) { return peak * Math.sqrt(k) * Math.E; }

export const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  linear: (t) => t,
};

/** Kleine Zeitleiste: ruft fn(p) über `ms` auf (p = 0…1, geglättet). */
export function tween(ms, fn, easing = ease.out, { kinetic = true } = {}) {
  let t = 0;
  let stopped = false;
  return new Promise((resolve) => {
    if (ms <= 0 || reduced()) { fn(1); resolve(); return; }
    loop.add((dt) => {
      if (stopped) { resolve(); return false; }
      t += dt * 1000;
      const p = Math.min(1, t / ms);
      fn(easing(p));
      if (p >= 1) { resolve(); return false; }
      return true;
    }, { kinetic });
  });
}

/** FLIP-Umsortierung per WAAPI: misst, ruft mutate() auf, animiert die Verschiebung. */
export function flip(container, mutate, { ms = 240 } = {}) {
  const kids = [...container.children];
  const before = new Map(kids.map((el) => [el, el.getBoundingClientRect().top]));
  mutate();
  if (reduced()) return;
  for (const el of container.children) {
    const b = before.get(el);
    if (b === undefined) continue;
    const dy = b - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) continue;
    el.getAnimations?.().forEach((a) => a.cancel());
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
}

/** Einmaliger Beobachter: ruft fn(entry) auf, sobald el sichtbar wird. */
export function whenVisible(el, fn, opts = {}) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.disconnect(); fn(e); return; }
  }, opts);
  io.observe(el);
  return () => io.disconnect();
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
