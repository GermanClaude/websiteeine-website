// Eine gemeinsame rAF-Schleife für die ganze Seite. Schläft, wenn nichts zu tun ist
// oder der Tab verborgen ist.
// Wächter: Ist die mittlere Bildzeit während kinetischer Arbeit über 1 s > 24 ms, wird stufenweise
// gedämpft – zuerst nur die Schusswellen der Bühne (Stufe 1), erst bei weiterer Last die ganze
// bewegte Schrift (Stufe 2, html.static-type). Bilder, in denen die 3D-Bühne gezeichnet hat, zählen
// nicht mit (die Last gehört der Bühne, nicht der Schrift). Nach 5 s ruhiger Bilder (< 20 ms) geht
// es eine Stufe zurück.

const tasks = new Map(); // fn → { kinetic, heavy }
let raf = 0;
let last = 0;
let winStart = 0;
let winSum = 0;
let winFrames = 0;
let goodMs = 0;
let level = 0;
const staticListeners = new Set();
const bootAt = performance.now();
const disabled = /[?&]nowatchdog=1/.test(location.search);

function schedule() {
  if (!raf && tasks.size && !document.hidden) {
    raf = requestAnimationFrame(frame);
    last = 0;
  }
}

function frame(t) {
  raf = 0;
  const raw = last ? (t - last) / 1000 : 1 / 60;
  last = t;
  const dt = Math.min(raw, 0.1);
  let kinetic = false;
  let heavy = false;
  for (const [fn, o] of [...tasks]) {
    let keep;
    try { keep = fn(dt, t); } catch (err) { keep = false; console.error('[NULLPUNKT] Schleife:', err); }
    if (keep === false) tasks.delete(fn);
    if (o.kinetic) kinetic = true;
    if (o.heavy) heavy = true;
  }
  watchdog(raw * 1000, t, kinetic, heavy);
  if (tasks.size && !document.hidden) raf = requestAnimationFrame(frame);
}

function setLevel(n) {
  n = Math.max(0, Math.min(2, n));
  if (n === level) return;
  level = n;
  const html = document.documentElement;
  html.classList.toggle('calm-waves', level >= 1);
  html.classList.toggle('static-type', level >= 2);
  for (const fn of staticListeners) { try { fn(level); } catch { /* egal */ } }
}

function watchdog(ms, t, kinetic, heavy) {
  if (disabled || t - bootAt < 2500 || ms > 250) { winStart = 0; return; }
  // Erholung: ruhige Bilder sammeln (gleich welcher Art)
  if (level > 0) {
    if (ms < 20) goodMs += ms; else goodMs = 0;
    if (goodMs >= 5000) { goodMs = 0; setLevel(level - 1); }
  }
  if (!kinetic || heavy || level >= 2) { if (heavy) return; winStart = 0; return; }
  if (!winStart) { winStart = t; winSum = 0; winFrames = 0; return; }
  winSum += ms;
  winFrames++;
  if (t - winStart >= 1000) {
    const mean = winSum / Math.max(1, winFrames);
    winStart = 0;
    if (winFrames >= 10 && mean > 24) { goodMs = 0; setLevel(level + 1); }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else schedule();
});

export const loop = {
  /**
   * fn(dt, t) → false beendet die Aufgabe. Gibt eine Abmeldefunktion zurück.
   * kinetic: bewegte Schrift (zählt für den Wächter); heavy: zeichnet WebGL (Bild zählt nicht).
   */
  add(fn, { kinetic = false, heavy = false } = {}) {
    tasks.set(fn, { kinetic, heavy });
    schedule();
    return () => tasks.delete(fn);
  },
  has(fn) { return tasks.has(fn); },
  get size() { return tasks.size; },
  /** 0 = alles, 1 = keine Schusswellen, 2 = ruhige Schrift */
  get level() { return level; },
  get static() { return level >= 2; },
  onStatic(fn) { staticListeners.add(fn); return () => staticListeners.delete(fn); },
};
