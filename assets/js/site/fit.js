// Breitenblocksatz: Jede Zeile mit [data-fit] füllt ihren Container über die Breitenachse (wdth 62–125).
// Reicht die Achse nicht, wächst (bis zur Obergrenze) oder schrumpft die Schriftgröße.
// Messung über zwei unsichtbare Klone je Einheit (62 und 125), erst alle lesen, dann alle schreiben.
//
// Optionen (data-Attribute oder el.fitOpts):
//   data-fit-max="420"     Obergrenze der Schriftgröße in px
//   data-fit-wdth="125"    feste Breite, gelöst wird die Schriftgröße (auch auf .fl-Zeilen)
//   data-fit-grow="0"      nie größer als die CSS-Schriftgröße (nur Breite anpassen, notfalls schrumpfen)
//   fitOpts.weight = true  zusätzlich messen, wie stark jede Glyphe mit der Stärke wächst (für Breitenausgleich)
//   data-fit-slots         jede Glyphe bekommt ihre Ruhebreite als feste Box: bewegte Schnitte (Eintritt, Stauchung,
//                          Wellen) verändern dann nur die Zeichnung in der Box, nie die Lage der Nachbarn (kein CLS).
//                          Die Boxen sind gemessen (nicht aus dem linearen Modell: die Breitenachse ist nicht linear,
//                          Vorschübe werden je Glyphe gerundet) und ergeben zusammen nie mehr als die Zeilenbreite;
//                          das Modell trägt dazu je Glyphe Box, Wachstum bis 125/900 und den Platz bis zum Rand
//                          (kinetic.js hält bewegte Zeichnungen damit in der Zeile).
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
const STRIP_G = ['--dw', '--dg', '--ww', '--wg', 'transform', 'opacity', 'color', '--dc', 'width'];

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

/**
 * Breite der Clip-Box in Bruchteilen von px: clientWidth rundet (966,6 → 967) – eine so berechnete Zeile stünde
 * um den Rundungsrest über. Ohne Transformation (Abweichung < 1 px) gilt der kleinere der beiden Werte.
 */
function innerW(el) {
  const cw = el.clientWidth;
  const rw = el.getBoundingClientRect().width;
  return Math.abs(rw - cw) < 1 ? Math.min(rw, cw) : cw;
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
  c.style.fontStretch = `${wdth}%`; // der Klon verliert [data-fit] und damit die Achsenregel
  // fixed statt absolute: Messabzüge (bis 125 % Breite) dürfen die Seite nicht verbreitern – sonst vergrößern
  // mobile Browser für dieses Bild das Layout-Fenster (innerWidth/innerHeight springen, Messungen werden falsch).
  c.style.position = 'fixed';
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
    const W = innerW(el);
    lastW.set(el, Math.round(el.getBoundingClientRect().width * 2) / 2);
    if (!W) continue;
    if (lineMode) {
      for (const fl of lines) units.push({ el, unit: fl, W: innerW(fl) || W, fixed: fixedFor(fl), max: maxFor(el), line: true });
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
    if (u.el.fitOpts?.weight) {
      u.c900 = makeClone(u.unit, 62, u.el);
      u.c900.style.setProperty('--wght', '900');
      host.appendChild(u.c900);
    }
  }

  // 3) Lesen: Breiten bei 62 und 125
  for (const u of units) {
    u.base = parseFloat(getComputedStyle(u.c62).fontSize) || 16;
    if (u.el.dataset.fitGrow === '0') u.max = Math.min(u.max, u.base);
    u.w62 = u.c62.getBoundingClientRect().width;
    u.w125 = u.c125.getBoundingClientRect().width;
    const g62 = u.c62.querySelectorAll('.g');
    const g125 = u.c125.querySelectorAll('.g');
    u.gb = [];
    u.ga = [];
    for (let i = 0; i < g62.length; i++) {
      const w62 = g62[i].getBoundingClientRect().width;
      u.ga.push(w62);
      u.gb.push((g125[i].getBoundingClientRect().width - w62) / 63);
    }
    u.gc = null;
    if (u.c900) {
      u.rw = parseFloat(getComputedStyle(u.unit).getPropertyValue('--wght')) || parseFloat(getComputedStyle(u.unit).fontWeight) || 400;
      const g900 = u.c900.querySelectorAll('.g');
      const span = Math.max(1, 900 - u.rw);
      u.gc = u.ga.map((w, i) => Math.max(0, ((g900[i]?.getBoundingClientRect().width || w) - w) / span));
    }
  }

  // 4) Schreiben: Klone weg, Achse/Größe setzen
  for (const u of units) {
    u.c62.remove();
    u.c125.remove();
    u.c900?.remove();
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

  // 5) Korrektur über einen Klon im gelösten Schnitt (unabhängig von Eintritts-/Bewegungszuständen);
  //    Einheiten mit festen Glyphenboxen korrigiert Schritt 6 mit seinen eigenen Messungen
  const check = units.filter((u) => u.fixed === null && u.wd < 125 && u.wd > 62 && u.el.dataset.fitSlots === undefined);
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

  // 6) Feste Glyphenboxen: im gelösten Schnitt messen, bis die Zeile passt (Breitenachse, zuletzt Schriftgröße)
  const slotted = units.filter((u) => u.el.dataset.fitSlots !== undefined);
  if (slotted.length) measureSlots(slotted);

  for (const u of units) {
    if (u.slots) {
      u.unit.querySelectorAll('.g').forEach((g, i) => { if (u.slots[i] > 0) g.style.width = `${u.slots[i]}px`; });
    }
    models.set(u.unit, {
      b: u.gb.map((b) => b * u.scale), a: u.ga.map((a) => a * u.scale), c: u.gc ? u.gc.map((c) => c * u.scale) : null,
      rw: u.rw ?? null, wdth: u.wd, fs: u.fs, W: u.W,
      slots: u.slots ? { s: u.slots, up: u.up, wc: u.wc, room: u.room } : null,
    });
    u.unit.dataset.fitted = u.wd.toFixed(1);
  }
  const done = new Set(units.map((u) => u.el));
  for (const el of done) el.dispatchEvent(new CustomEvent('fitted', { bubbles: false }));
}

const LU = 64; // Layout-Einheiten je px (Chrome)

/**
 * Misst je Einheit die echten Glyphenvorschübe im gelösten Schnitt (Ruhe, wdth 125, wght 900) und stellt nach,
 * bis die Summe in die Zeile passt bzw. sie füllt: bis zu zwei Schritte über die Breitenachse, danach – nur bei
 * deutlichem Überstand – über die Schriftgröße. Was dann noch übersteht (Rundung der Vorschübe auf ganze px,
 * je Glyphe < 0,4 px), nehmen die Boxen vor der letzten Glyphe auf: Ihre Zeichnungen ragen unmerklich in die
 * Nachbarbox, die letzte Zeichnung endet spätestens am Zeilenende.
 * Ergebnis je Einheit: slots (Boxbreiten px), up (px je wdth-Einheit über der Ruhe), wc (px je wght-Einheit über
 * der Ruhe), room (px vom Ende der ruhenden Zeichnung bis zum Zeilenende).
 */
function measureSlots(list) {
  let todo = list;
  // Ruhestärke vorab lesen (ein Stilabgleich, nicht einer je Einheit zwischen den Klonen)
  for (const u of list) {
    if (u.rw == null) { const cs = getComputedStyle(u.unit); u.rw = parseFloat(cs.getPropertyValue('--wght')) || parseFloat(cs.fontWeight) || 400; }
  }
  for (let it = 0; it < 4 && todo.length; it++) {
    for (const u of todo) {
      const mk = (wd, wght) => {
        const c = makeClone(u.unit, wd, u.el);
        if (Math.abs(u.fs - u.base) > 0.25) c.style.fontSize = `${u.fs.toFixed(2)}px`;
        if (wght) c.style.setProperty('--wght', String(wght));
        u.unit.parentNode.appendChild(c);
        return c;
      };
      u.k = [mk(u.wd), mk(125), mk(u.wd, 900)];
    }
    const widths = (c) => [...c.querySelectorAll('.g')].map((g) => g.getBoundingClientRect().width);
    for (const u of todo) [u.mr, u.m125, u.m900] = u.k.map(widths);
    const next = [];
    for (const u of todo) {
      for (const c of u.k) c.remove();
      u.k = null;
      const n = u.mr.length;
      const total = u.mr.reduce((a, b) => a + b, 0);
      const over = total - u.W;
      const absorb = 0.4 * Math.max(1, n - 1); // so viel Überstand nehmen die Boxen unmerklich auf
      const short = over < -(1 + 0.002 * u.W); // sichtbare Lücke am Zeilenende
      if (it < 2 && u.fixed === null && (over > absorb ? u.wd > 62 : short && u.wd < 125)) {
        // Breitenachse nachstellen (Sekante zum jeweiligen Achsenende)
        const t62 = u.w62 * u.scale;
        const t125 = u.m125.reduce((a, b) => a + b, 0);
        const slope = over > 0 ? (total - t62) / Math.max(1e-3, u.wd - 62) : (t125 - total) / Math.max(1e-3, 125 - u.wd);
        u.wd = Math.max(62, Math.min(125, u.wd - (over + (over > 0 ? 0.25 : 0)) / Math.max(1e-3, slope)));
        u.unit.style.setProperty('--wdth', u.wd.toFixed(2));
        next.push(u);
        continue;
      }
      if (it < 3 && over > absorb) {
        // Achse am Ende (oder fest) und deutlich zu breit: Schriftgröße – Vorschübe skalieren mit ihr
        u.fs = Math.max(8, u.fs * (u.W - 0.25) / total);
        u.scale = u.fs / u.base;
        u.unit.style.fontSize = `${u.fs.toFixed(2)}px`;
        next.push(u);
        continue;
      }
      const slots = u.mr.map((w) => Math.floor(w * LU) / LU);
      if (over > 0 && n > 1) {
        const head = slots.slice(0, -1).reduce((a, b) => a + b, 0);
        const k = Math.max(0, 1 - (over + 1 / LU) / Math.max(1e-3, head));
        for (let i = 0; i < n - 1; i++) slots[i] = Math.floor(slots[i] * k * LU) / LU;
      }
      let left = 0;
      u.room = slots.map((w, i) => { const r = u.W - left - u.mr[i]; left += w; return Math.max(0, r); });
      u.up = u.mr.map((w, i) => (u.wd < 124.9 ? Math.max(0, ((u.m125[i] ?? w) - w) / (125 - u.wd)) : 0));
      u.wc = u.mr.map((w, i) => (u.rw < 899 ? Math.max(0, ((u.m900[i] ?? w) - w) / (900 - u.rw)) : 0));
      u.slots = slots;
    }
    todo = next;
  }
}
