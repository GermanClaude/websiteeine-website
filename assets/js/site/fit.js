// Breitenblocksatz: Jede Zeile mit [data-fit] füllt ihren Container über die Breitenachse (wdth 62–125).
// Reicht die Achse nicht, wächst (bis zur Obergrenze) oder schrumpft die Schriftgröße.
// Messung über zwei unsichtbare Klone je Einheit (62 und 125), erst alle lesen, dann alle schreiben.
//
// Optionen (data-Attribute oder el.fitOpts):
//   data-fit-max="420"     Obergrenze der Schriftgröße in px
//   data-fit-wdth="125"    feste Breite, gelöst wird die Schriftgröße (auch auf .fl-Zeilen)
//   .fl-Kinder mit display:block werden einzeln gesetzt (Zeilenmodus)

const all = new Set();
const lastW = new WeakMap();
const models = new WeakMap(); // Einheit → { b: [px pro wdth-Einheit je Glyphe], wdth, fs }
const queue = new Set();
let scheduled = false;
let fontsOk = false;
const ro = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    const w = Math.round(e.contentRect.width * 2) / 2;
    if (!w) continue;
    if (Math.abs((lastW.get(el) || 0) - w) >= 1) { queue.add(el); }
  }
  schedule();
}) : null;

const STRIP_ROOT = ['--wdth', 'font-size', '--sv', '--dc', 'transform', 'width'];
const STRIP_G = ['--dw', '--dg', '--ww', '--wg', 'transform', 'opacity', 'color', '--dc'];

function schedule() {
  if (scheduled || !fontsOk) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; flush(); });
}

/** Schriften bereit → wartende Elemente setzen. */
export function fontsReady() {
  fontsOk = true;
  flush();
}

/** Element (erneut) setzen. `now` setzt synchron (nur nach fontsReady sinnvoll). */
export function fit(el, { now = false } = {}) {
  if (!el) return;
  if (!all.has(el)) { all.add(el); ro?.observe(el); }
  queue.add(el);
  if (now && fontsOk) flush(); else schedule();
}

/** Alle [data-fit] unterhalb von root registrieren und setzen. */
export function fitAll(root = document, opts) {
  for (const el of root.querySelectorAll('[data-fit]')) fit(el, { now: false });
  if (opts?.now && fontsOk) flush();
}

export function unfit(el) { all.delete(el); ro?.unobserve(el); queue.delete(el); }

/** Lineares Breitenmodell der Glyphen einer Einheit (für Breitenausgleich). */
export function glyphModel(unit) { return models.get(unit) || null; }

function maxFor(el) {
  const o = el.fitOpts || {};
  if (typeof o.max === 'function') return o.max();
  if (o.max) return o.max;
  const d = Number(el.dataset.fitMax);
  return Number.isFinite(d) && d > 0 ? d : 320;
}
function fixedFor(el) {
  const v = Number(el.dataset.fitWdth ?? el.fitOpts?.wdth);
  return Number.isFinite(v) ? v : null;
}

function makeClone(unit, wdth, root) {
  const c = unit.cloneNode(true);
  c.removeAttribute('id');
  c.classList.remove('pre', 'entering', 'dissolve');
  for (const p of STRIP_ROOT) c.style.removeProperty(p);
  if (unit !== root) c.style.removeProperty('font-size');
  for (const g of c.querySelectorAll('.g')) for (const p of STRIP_G) g.style.removeProperty(p);
  for (const n of c.querySelectorAll('[id]')) n.removeAttribute('id');
  c.setAttribute('aria-hidden', 'true');
  c.style.setProperty('--wdth', String(wdth));
  c.style.position = 'absolute';
  c.style.visibility = 'hidden';
  c.style.left = '0';
  c.style.top = '0';
  c.style.width = 'max-content';
  c.style.display = 'inline-block';
  c.style.whiteSpace = 'nowrap';
  c.style.contain = 'none';
  c.style.pointerEvents = 'none';
  c.dataset.clone = '1';
  delete c.dataset.fit;
  return c;
}

function flush() {
  if (!fontsOk) return;
  const els = [...queue].filter((el) => el.isConnected);
  queue.clear();
  if (!els.length) return;

  // 1) Lesen: Einheiten und Zielbreiten bestimmen
  const units = [];
  for (const el of els) {
    const lines = [...el.querySelectorAll('.fl')];
    const lineMode = lines.length > 1 && getComputedStyle(lines[0]).display === 'block';
    const W = el.clientWidth;
    lastW.set(el, Math.round(el.getBoundingClientRect().width * 2) / 2);
    if (!W) continue;
    if (lineMode) {
      for (const fl of lines) units.push({ el, unit: fl, W: fl.clientWidth || W, fixed: fixedFor(fl), max: maxFor(el), line: true });
    } else {
      units.push({ el, unit: el, W, fixed: fixedFor(el), max: maxFor(el), line: false, lines });
    }
  }
  if (!units.length) return;

  // 2) Schreiben: Klone einhängen (Zeilenmodus: Ganzelement-Größen entfernen)
  for (const u of units) {
    if (u.line) { u.el.style.removeProperty('font-size'); u.el.style.removeProperty('--wdth'); }
    else for (const fl of u.lines) { fl.style.removeProperty('font-size'); fl.style.removeProperty('--wdth'); }
    const host = u.unit.parentNode;
    u.c62 = makeClone(u.unit, 62, u.el);
    u.c125 = makeClone(u.unit, 125, u.el);
    host.appendChild(u.c62);
    host.appendChild(u.c125);
  }

  // 3) Lesen: Breiten bei 62 und 125
  for (const u of units) {
    u.base = parseFloat(getComputedStyle(u.c62).fontSize) || 16;
    u.w62 = u.c62.getBoundingClientRect().width;
    u.w125 = u.c125.getBoundingClientRect().width;
    const g62 = u.c62.querySelectorAll('.g');
    const g125 = u.c125.querySelectorAll('.g');
    u.gb = [];
    for (let i = 0; i < g62.length; i++) {
      u.gb.push((g125[i].getBoundingClientRect().width - g62[i].getBoundingClientRect().width) / 63);
    }
  }

  // 4) Schreiben: Klone weg, Achse/Größe setzen
  for (const u of units) {
    u.c62.remove();
    u.c125.remove();
    const span = Math.max(1e-3, u.w125 - u.w62);
    let wd;
    let fs = u.base;
    if (u.fixed !== null) {
      wd = u.fixed;
      const wf = u.w62 + span * (wd - 62) / 63;
      fs = Math.min(u.max, u.base * (u.W / Math.max(1, wf)));
    } else {
      wd = 62 + 63 * (u.W - u.w62) / span;
      if (wd > 125) { wd = 125; fs = Math.min(u.max, u.base * (u.W / Math.max(1, u.w125))); if (fs < u.base) fs = u.base; }
      else if (wd < 62) { wd = 62; fs = u.base * (u.W / Math.max(1, u.w62)); }
      if (fs > u.max) fs = u.max;
    }
    fs = Math.max(8, fs);
    u.wd = wd;
    u.fs = fs;
    u.scale = fs / u.base;
    u.unit.style.setProperty('--wdth', wd.toFixed(2));
    if (Math.abs(fs - u.base) > 0.25) u.unit.style.fontSize = `${fs.toFixed(2)}px`;
    else u.unit.style.removeProperty('font-size');
  }

  // 5) Korrektur über einen Klon im gelösten Schnitt (unabhängig von Eintritts-/Bewegungszuständen)
  const check = units.filter((u) => u.fixed === null && u.wd < 125 && u.wd > 62);
  for (const u of check) {
    u.cx = makeClone(u.unit, u.wd, u.el);
    if (Math.abs(u.fs - u.base) > 0.25) u.cx.style.fontSize = `${u.fs.toFixed(2)}px`;
    u.unit.parentNode.appendChild(u.cx);
  }
  for (const u of check) u.actual = u.cx.getBoundingClientRect().width;
  for (const u of check) {
    u.cx.remove();
    const err = (u.W - u.actual) / u.W;
    if (Math.abs(err) > 0.005 && u.actual > 0) {
      const slope = Math.max(1e-3, (u.w125 - u.w62) * u.scale / 63);
      u.wd = Math.max(62, Math.min(125, u.wd + (u.W - u.actual) / slope));
      u.unit.style.setProperty('--wdth', u.wd.toFixed(2));
    }
  }

  for (const u of units) {
    models.set(u.unit, { b: u.gb.map((b) => b * u.scale), wdth: u.wd, fs: u.fs, W: u.W });
    u.unit.dataset.fitted = u.wd.toFixed(1);
  }
  const done = new Set(units.map((u) => u.el));
  for (const el of done) el.dispatchEvent(new CustomEvent('fitted', { bubbles: false }));
}
