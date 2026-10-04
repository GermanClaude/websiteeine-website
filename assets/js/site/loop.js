// Eine gemeinsame rAF-Schleife für die ganze Seite. Schläft, wenn nichts zu tun ist
// oder der Tab verborgen ist. Wächter: Ist die mittlere Bildzeit während kinetischer
// Arbeit über 1 s > 24 ms, wird für die Sitzung auf statische Schrift umgeschaltet.

const tasks = new Map(); // fn → { kinetic }
let raf = 0;
let last = 0;
let winStart = 0;
let winSum = 0;
let winFrames = 0;
let staticListeners = new Set();
const bootAt = performance.now();
let isStatic = false;

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
  for (const [fn, o] of [...tasks]) {
    let keep;
    try { keep = fn(dt, t); } catch (err) { keep = false; console.error('[NULLPUNKT] Schleife:', err); }
    if (keep === false) tasks.delete(fn);
    else if (o.kinetic) kinetic = true;
  }
  watchdog(raw * 1000, t, kinetic);
  if (tasks.size && !document.hidden) raf = requestAnimationFrame(frame);
}

function watchdog(ms, t, kinetic) {
  if (isStatic || !kinetic || t - bootAt < 2500 || ms > 250) { winStart = 0; return; }
  if (!winStart) { winStart = t; winSum = 0; winFrames = 0; return; }
  winSum += ms;
  winFrames++;
  if (t - winStart >= 1000) {
    const mean = winSum / Math.max(1, winFrames);
    winStart = 0;
    if (winFrames >= 10 && mean > 24 && !/[?&]nowatchdog=1/.test(location.search)) {
      isStatic = true;
      document.documentElement.classList.add('static-type');
      for (const fn of staticListeners) { try { fn(); } catch { /* egal */ } }
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else schedule();
});

export const loop = {
  /** fn(dt, t) → false beendet die Aufgabe. Gibt eine Abmeldefunktion zurück. */
  add(fn, { kinetic = false } = {}) {
    tasks.set(fn, { kinetic });
    schedule();
    return () => tasks.delete(fn);
  },
  has(fn) { return tasks.has(fn); },
  get size() { return tasks.size; },
  get static() { return isStatic; },
  onStatic(fn) { staticListeners.add(fn); return () => staticListeners.delete(fn); },
};
