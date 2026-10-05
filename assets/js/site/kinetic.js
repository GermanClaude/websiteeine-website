// Kinetische Glyphen: Zerlegung in <span class="g">, Federn je Glyphe (Breite/Stärke),
// Wellen, Zeitleisten, Breitenausgleich (Zeile bleibt gleich breit) und ein globales Limit
// von 80 gleichzeitig bewegten Glyphen.
import { loop } from './loop.js';
import { glyphModel } from './fit.js';
import { stepSpring, impulseFor, SPRINGS, calm } from './motion.js';

const MAX_LIVE = 80;
const instances = new Set();

/**
 * Zerlegt el in eine Screenreader-Zeile und eine sichtbare Glyphenschicht.
 * .fl-Kinder bleiben als Zeilen erhalten; Kind-Elemente geben ihre Klassen an die Glyphen weiter.
 */
export function split(el, { sr } = {}) {
  if (el.querySelector(':scope > .vis')) return [...el.querySelectorAll('.vis .g')];
  const text = sr ?? el.dataset.sr ?? el.textContent.replace(/\s+/g, ' ').trim();
  const lines = [...el.querySelectorAll(':scope > .fl')];
  const vis = document.createElement('span');
  vis.className = 'vis';
  vis.setAttribute('aria-hidden', 'true');
  let i = 0;
  const build = (src, into) => {
    const walk = (node, cls) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) {
          for (const ch of n.textContent.replace(/\s+/g, ' ')) {
            if (!ch.trim() && !into.childNodes.length) continue;
            const g = document.createElement('span');
            g.className = cls ? `g ${cls}` : 'g';
            g.textContent = ch === ' ' ? ' ' : ch;
            g.style.setProperty('--i', i++);
            into.appendChild(g);
          }
        } else if (n.nodeType === 1) walk(n, n.className || cls);
      }
    };
    walk(src, '');
    // Leerzeichen am Ende entfernen
    while (into.lastChild && into.lastChild.textContent === ' ') into.lastChild.remove();
  };
  if (lines.length) {
    for (const fl of lines) {
      const nl = document.createElement('span');
      nl.className = fl.className;
      for (const a of fl.getAttributeNames()) if (a.startsWith('data-')) nl.setAttribute(a, fl.getAttribute(a));
      build(fl, nl);
      vis.appendChild(nl);
    }
  } else build(el, vis);
  const s = document.createElement('span');
  s.className = 'sr-only';
  s.textContent = text;
  el.textContent = '';
  el.append(s, vis);
  return [...vis.querySelectorAll('.g')];
}

/** Setzt den Text einer zerlegten Zeile neu (gleiche Struktur). */
export function resplit(el, text, { lines = null, sr = null } = {}) {
  el.textContent = '';
  if (lines) {
    for (const l of lines) {
      const fl = document.createElement('span');
      fl.className = 'fl';
      fl.textContent = l;
      el.appendChild(fl);
    }
  } else el.textContent = text;
  return split(el, { sr: sr ?? text });
}

function liveTotal(except) {
  let n = 0;
  for (const k of instances) if (k !== except) n += k.live;
  return n;
}

export class Kinetic {
  /**
   * @param el       zerlegtes Element (split)
   * @param conserve Breitenausgleich je Zeile (.fl) bzw. für die ganze Zeile
   * @param limit    () → Breite in px, die eine Zeile in Bewegung nie überschreiten darf
   *                 (Standard: die gesetzte Zeilenbreite). Reicht der Ausgleich nicht, werden alle
   *                 Ausschläge gemeinsam so weit gedämpft, dass die Zeile hineinpasst.
   */
  constructor(el, { conserve = false, limit = null } = {}) {
    this.el = el;
    this.conserve = conserve;
    this.limit = limit;
    this.live = 0;
    this.started = 0;
    this.pending = [];
    this.custom = null;
    this.running = false;
    this.refresh();
    this._tick = (dt, t) => this.step(dt, t);
    instances.add(this);
  }

  /** Glyphenliste neu einlesen (nach resplit). */
  refresh() {
    this.glyphs = [...this.el.querySelectorAll('.vis .g')];
    this.lines = [...this.el.querySelectorAll('.vis > .fl')];
    if (!this.lines.length) this.lines = [this.el];
    this.lineOf = this.glyphs.map((g) => Math.max(0, this.lines.findIndex((l) => l === this.el || l.contains(g))));
    const seen = this.lines.map(() => 0);
    this.off = this.lineOf.map((li) => seen[li]++);
    this.s = this.glyphs.map(() => ({ bw: 0, bg: 0, sw: { x: 0, v: 0 }, sg: { x: 0, v: 0 }, spr: SPRINGS.impulse, tw: null, ty: 0, lw: 0, lg: 0, lt: 0 }));
    this.pending = [];
    this.custom = null;
  }

  get n() { return this.glyphs.length; }

  wake() {
    this.started = performance.now();
    if (!this.running) { this.running = true; loop.add(this._tick, { kinetic: true }); }
  }

  /** Vor neuen Effekten: Platz im globalen Glyphenbudget schaffen (älteste Effekte zuerst beruhigen). */
  budget(n = this.n) {
    let total = liveTotal(this) + n;
    if (total <= MAX_LIVE) return;
    const others = [...instances].filter((k) => k !== this && k.live > 0).sort((a, b) => a.started - b.started);
    for (const k of others) {
      if (total <= MAX_LIVE) break;
      total -= k.live;
      k.settle();
    }
  }

  /** Federstoß auf Glyphe i (peak-Werte in wdth/wght-Einheiten). */
  impulse(i, dw, dg, spr = SPRINGS.impulse) {
    if (calm() || !this.s[i]) return;
    const s = this.s[i];
    s.spr = spr;
    s.sw.v += impulseFor(dw, spr);
    s.sg.v += impulseFor(dg, spr);
    this.wake();
  }

  /** Welle von links: Glyphe i erhält den Stoß bei t + stagger·i. */
  wave(dw, dg, { stagger = 6, spr = SPRINGS.impulse, from = 0 } = {}) {
    if (calm()) return;
    this.budget();
    const now = performance.now();
    for (let i = from; i < this.n; i++) this.pending.push({ at: now + (i - from) * stagger, i, dw, dg, spr });
    this.wake();
  }

  /**
   * Basisversatz (wdth/wght relativ zum Ruheschnitt) per Zeitleiste ändern.
   * which: 'all' | Index | Array; delay: Zahl oder (i, k) → ms
   */
  to(which, { w = null, g = null }, dur = 240, easing = (t) => 1 - Math.pow(1 - t, 3), delay = 0) {
    const idx = which === 'all' ? this.s.map((_, i) => i) : Array.isArray(which) ? which : [which];
    const now = performance.now();
    if (calm() && dur > 0) dur = 0;
    idx.forEach((i, k) => {
      const s = this.s[i];
      if (!s) return;
      const vw = typeof w === 'function' ? w(i) : w;
      const vg = typeof g === 'function' ? g(i) : g;
      const tw = {
        fw: s.bw, fg: s.bg, tw: vw === null ? s.bw : vw, tg: vg === null ? s.bg : vg,
        t0: now + (typeof delay === 'function' ? delay(i, k) : delay), dur, easing,
      };
      if (dur <= 0 && (typeof delay !== 'function' && !delay)) { s.bw = tw.tw; s.bg = tw.tg; s.tw = null; }
      else s.tw = tw;
    });
    this.write(true);
    this.wake();
  }

  /** Eigene Zeitleiste (für Modus-Akte). fn(ms, kin) → false beendet. */
  run(fn) {
    if (calm()) return;
    this.budget();
    this.custom = fn;
    this.customT0 = performance.now();
    this.wake();
  }

  /** Glyphe direkt stylen (Akte). */
  set(i, { ty, color, opacity } = {}) {
    const g = this.glyphs[i];
    if (!g) return;
    if (ty !== undefined) { this.s[i].ty = ty; g.style.transform = ty ? `translateY(${ty.toFixed(3)}em)` : ''; }
    if (color !== undefined) g.style.color = color || '';
    if (opacity !== undefined) g.style.opacity = opacity === 1 || opacity === null ? '' : String(opacity);
  }
  setOffset(i, w, g) { const s = this.s[i]; if (!s) return; s.bw = w; s.bg = g; s.tw = null; }

  /** Alles sofort in den Endzustand (Federn auf 0, Zeitleisten ans Ende). */
  settle() {
    for (const s of this.s) {
      s.sw.x = s.sw.v = s.sg.x = s.sg.v = 0;
      if (s.tw) { s.bw = s.tw.tw; s.bg = s.tw.tg; s.tw = null; }
    }
    this.pending = [];
    if (this.custom) { try { this.custom(Infinity, this); } catch { /* egal */ } this.custom = null; }
    this.write(true);
    this.live = 0;
  }

  /** Zurück zum Ruheschnitt. */
  reset() {
    for (let i = 0; i < this.n; i++) { this.setOffset(i, 0, 0); this.set(i, { ty: 0, color: '', opacity: 1 }); }
    this.settle();
  }

  write(force = false) {
    const perLine = this.conserve && this.lines.length > 1 && this.lines[0] !== this.el && !!glyphModel(this.lines[0]);
    const n = this.n;
    const dw = new Array(n);
    const dg = new Array(n);
    for (let i = 0; i < n; i++) { const s = this.s[i]; dw[i] = s.bw + s.sw.x; dg[i] = s.bg + s.sg.x; }
    const dcOf = new Map(); // Zeile → Ausgleich (wdth-Einheiten)
    if (this.conserve) {
      const groups = perLine ? this.lines.map((l, li) => ({ unit: l, idx: [] })) : [{ unit: this.el, idx: [] }];
      for (let i = 0; i < n; i++) groups[perLine ? this.lineOf[i] : 0].idx.push(i);
      const B = typeof this.limit === 'function' ? this.limit() : null;
      for (const g of groups) {
        const m = glyphModel(g.unit) || glyphModel(this.el);
        let dc = 0;
        let scale = 1;
        if (m) {
          const off = (i) => (glyphModel(g.unit) ? this.off[i] : i);
          const W0 = m.wdth;
          const rw = m.rw ?? 0;
          let sb = 0;
          let push = 0;
          const rest = (i) => (m.a?.[off(i)] ?? 0) + (m.b[off(i)] ?? 1) * (W0 - 62);
          const cw = (i) => {
            const c = m.c?.[off(i)];
            if (!c) return 0;
            const a62 = m.a?.[off(i)] || 1;
            return c * (rest(i) / a62);
          };
          for (const i of g.idx) {
            const b = m.b[off(i)] ?? 1;
            sb += b;
            push += b * this.s[i].sw.x + cw(i) * Math.max(0, this.s[i].sg.x);
          }
          dc = sb ? -push / sb : 0;
          // Vorhersage: Breite der Zeile mit allen Ausschlägen (inkl. Achsengrenzen und Stärke)
          if (m.a) {
            const width = (k) => {
              let w = 0;
              for (const i of g.idx) {
                const b = m.b[off(i)] ?? 1;
                const e = Math.max(62, Math.min(125, W0 + k * (dw[i] + dc)));
                const gg = Math.max(100, Math.min(900, rw + k * dg[i])) - rw;
                w += (m.a[off(i)] ?? 0) + b * (e - 62) + (rw ? cw(i) * gg : 0);
              }
              return w;
            };
            const R = width(0);
            const box = Math.max(R, B ?? m.W ?? R);
            const P = width(1);
            if (P > box + 0.5 && P - R > 1e-3) {
              // gemeinsam dämpfen (zweimal nachgemessen, weil die Achsengrenzen nicht linear sind)
              scale = Math.max(0, Math.min(1, (box - R) / (P - R)));
              for (let it = 0; it < 2; it++) {
                const Pk = width(scale);
                if (Pk <= box + 0.5) break;
                scale *= Math.max(0, (box - R) / Math.max(1e-3, Pk - R));
              }
            }
          }
        }
        for (const i of g.idx) { dw[i] *= scale; dg[i] *= scale; }
        dcOf.set(g.unit, dc * scale);
      }
    }
    this.contain(dw, dg, dcOf);
    for (let i = 0; i < n; i++) {
      const s = this.s[i];
      const g = this.glyphs[i];
      if (force || Math.abs(dw[i] - s.lw) > 0.05) { g.style.setProperty('--dw', dw[i].toFixed(2)); s.lw = dw[i]; }
      if (force || Math.abs(dg[i] - s.lg) > 0.5) { g.style.setProperty('--dg', dg[i].toFixed(1)); s.lg = dg[i]; }
    }
    if (!this.conserve) return;
    for (const [unit, dc] of dcOf) unit.style.setProperty('--dc', Math.abs(dc) < 0.01 ? '0' : dc.toFixed(2));
    if (perLine) this.el.style.removeProperty('--dc');
    else for (const l of this.lines) if (l !== this.el) l.style.removeProperty('--dc');
  }

  /**
   * Feste Glyphenboxen (fit.js, data-fit-slots): eine Zeichnung darf über ihre Box hinaus wachsen (die Nachbarn
   * bleiben stehen), aber nie über das Zeilenende – dort schneidet overflow: clip. Begrenzt je Glyphe erst die
   * Stärke, dann die Breite auf den gemessenen Platz bis zum Rand (abzüglich Rundungsreserve). Schmaler/leichter
   * geht immer.
   */
  contain(dw, dg, dcOf) {
    const cache = new Map();
    const modelOf = (unit) => {
      if (!cache.has(unit)) cache.set(unit, glyphModel(unit)?.slots ? glyphModel(unit) : null);
      return cache.get(unit);
    };
    for (let i = 0; i < this.n; i++) {
      const line = this.lines[this.lineOf[i]];
      let m = line !== this.el ? modelOf(line) : null;
      let o = this.off[i];
      if (!m) { m = modelOf(this.el); o = i; }
      const sl = m?.slots;
      if (!sl || !(sl.s[o] > 0)) continue;
      const dc = dcOf.get(line) ?? dcOf.get(this.el) ?? 0;
      const allow = Math.max(0, sl.room[o] - (0.75 + 0.04 * sl.s[o]));
      const rw = m.rw ?? 400;
      let gw = Math.max(100, Math.min(900, rw + dg[i])) - rw;
      let wpx = gw > 0 ? sl.wc[o] * gw : 0;
      if (wpx > allow) {
        gw = sl.wc[o] > 0 ? allow / sl.wc[o] : 0;
        dg[i] = gw;
        wpx = sl.wc[o] * gw;
      }
      const e = Math.max(62, Math.min(125, m.wdth + dw[i] + dc)) - m.wdth;
      if (e > 0 && wpx + sl.up[o] * e > allow) dw[i] = (sl.up[o] > 0 ? Math.max(0, (allow - wpx) / sl.up[o]) : 0) - dc;
    }
  }

  step(dt, t) {
    let active = 0;
    if (this.pending.length) {
      const rest = [];
      for (const p of this.pending) {
        if (t >= p.at || performance.now() >= p.at) {
          const s = this.s[p.i];
          if (s) { s.spr = p.spr; s.sw.v += impulseFor(p.dw, p.spr); s.sg.v += impulseFor(p.dg, p.spr); }
        } else rest.push(p);
      }
      this.pending = rest;
      active += rest.length;
    }
    const now = performance.now();
    for (let i = 0; i < this.n; i++) {
      const s = this.s[i];
      let moving = false;
      if (s.tw) {
        const tw = s.tw;
        const p = tw.dur > 0 ? (now - tw.t0) / tw.dur : (now >= tw.t0 ? 1 : -1);
        if (p >= 1) { s.bw = tw.tw; s.bg = tw.tg; s.tw = null; }
        else if (p >= 0) { const e = tw.easing(p); s.bw = tw.fw + (tw.tw - tw.fw) * e; s.bg = tw.fg + (tw.tg - tw.fg) * e; moving = true; }
        else moving = true;
      }
      if (s.sw.x || s.sw.v) moving = stepSpring(s.sw, dt, s.spr) || moving;
      if (s.sg.x || s.sg.v) moving = stepSpring(s.sg, dt, s.spr) || moving;
      if (moving) active++;
    }
    if (this.custom) {
      let keep;
      try { keep = this.custom(now - this.customT0, this); } catch (err) { keep = false; console.error(err); }
      if (keep === false) this.custom = null; else active = Math.max(active, this.n);
    }
    this.write();
    this.live = active;
    if (!active && !this.pending.length) { this.running = false; return false; }
    return true;
  }

  destroy() { this.settle(); instances.delete(this); }
}
