// NULLPUNKT — Touch-Layout-Editor (Realismus-Plan S7, ui-Teil): die echten Knöpfe aus #touch-ui frei verschieben
// (Ziehen, Raster und Ausrichtungslinien, Sicherheitsränder), Größe und Deckkraft je Knopf (Regler oder zwei Finger),
// Knöpfe aus- und einblenden (verborgene erscheinen hier halbtransparent), Stick fest oder schwebend, Zurücksetzen.
// Gespeichert wird je Seitenverhältnis in settings.touchLayout (shared/bindings.data.js); „Abbrechen“ verwirft alles.
// Daten und Anwendung kommen von engine/input.js (applyTouchLayout/measureTouch); dieses Modul ist nur die Oberfläche.
// Bedienung: Touch, Maus, Tastatur (Pfeile verschieben, +/− Größe, Tab nächster Knopf, Esc abbrechen) und
// Gamepad (LB/RB Knopf wählen, Steuerkreuz/Stick verschieben, LT/RT Größe, A ein/aus, Y fertig, B abbrechen).

import { TOUCH_BUTTONS, sanitizeTouchLayout, resolveTouchLayout } from '../../shared/bindings.data.js';
import { esc, el } from './dom.js';
import { ICON } from './icons.js';
import { touchAspect, seedAspect, editTouch } from './settings/keys.js';

const GRID = 2.5; // Raster in % der Fläche
const SNAP = 0.9; // Einrasten an anderen Knöpfen (%)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ITEMS = TOUCH_BUTTONS.filter((b) => b.id !== 'pause'); // Pause bleibt immer erreichbar (nicht verschieb- oder ausblendbar)
const NO_HIDE = new Set(['fire', 'stick', 'pause']);

export class TouchEditor {
  constructor(G) {
    this.G = G;
    this.open = false;
    this.layer = null;
    this.layout = null;
    this.aspect = '16:9';
    this.sel = null;
    this.grid = false;
    this._drag = null;
    this._pinch = null;
    this._pointers = new Map();
    this._raf = 0;
    this._pending = false;
    this._listeners = [];
    this._onClose = null;
    this._dirty = false;
    this._padPrev = [];
    this._padRepeat = 0;
    this._padDir = null;
  }

  get input() { return this.G.input; }
  get ui() { return document.getElementById('touch-ui'); }

  /** Editor öffnen. screen = Menübildschirm (Hintergrund), onClose(saved) beim Schließen. */
  start(screen, { onClose } = {}) {
    const ui = this.ui;
    const input = this.input;
    if (!ui || !input || typeof input.applyTouchLayout !== 'function') { if (onClose) onClose(false); return; }
    this.open = true;
    this._onClose = onClose || null;
    this._dirty = false;
    document.body.dataset.touchEdit = '1';
    this.aspect = touchAspect();
    this.original = this.G.settings.get('touchLayout');
    this.layout = seedAspect(this.original, this.aspect);
    // Hintergrund: Bildschirmumriss mit HUD-Schema, Raster, Sicherheitsränder, Ausrichtungslinien
    screen.innerHTML = `
      <div class="te-back" data-grid="0">
        <div class="te-gridlines"></div>
        <div class="te-safe" aria-hidden="true"></div>
        <div class="te-hud" aria-hidden="true"><i class="te-h-mm">Minikarte</i><i class="te-h-top">Punktestand</i><i class="te-h-ammo">Munition</i><i class="te-h-x"></i></div>
        <i class="te-guide te-gx" hidden></i><i class="te-guide te-gy" hidden></i>
      </div>`;
    this.back = screen.querySelector('.te-back');
    // Werkzeuge über den Knöpfen
    const root = document.getElementById('game-root') || document.body;
    const layer = el('div', 'te-layer');
    layer.innerHTML = `
      <header class="te-bar" role="toolbar" aria-label="Touch-Layout">
        <button type="button" class="m-btn m-ghost te-cancel" data-te="cancel">${ICON.close}<span>Abbrechen</span></button>
        <div class="te-title"><b>Touch-Layout</b><small>${esc(this.aspect)} · ${esc(this._presetLabel())}</small></div>
        <button type="button" class="m-icon te-grid" data-te="grid" aria-pressed="false" aria-label="Raster">${ICON.grid}</button>
        <button type="button" class="m-icon" data-te="reset" aria-label="Alles zurücksetzen">${ICON.restart}</button>
        <button type="button" class="m-btn m-primary te-done" data-te="done">${ICON.check}<span>Fertig</span></button>
      </header>
      <p class="te-help">Knopf ziehen zum Verschieben · antippen für Größe und Deckkraft · zwei Finger ändern die Größe</p>
      <section class="te-panel" hidden aria-live="polite">
        <div class="te-ph"><b class="te-name"></b><button type="button" class="m-icon te-x" data-te="deselect" aria-label="Auswahl aufheben">${ICON.close}</button></div>
        <label class="te-sl"><span>Größe</span><input type="range" min="0.6" max="1.8" step="0.05" data-te-r="s" aria-label="Größe"><output></output></label>
        <label class="te-sl"><span>Deckkraft</span><input type="range" min="0.15" max="1" step="0.05" data-te-r="o" aria-label="Deckkraft"><output></output></label>
        <div class="te-row">
          <button type="button" class="m-btn te-vis" data-te="vis">${ICON.eye}<span>Sichtbar</span></button>
          <button type="button" class="m-btn te-stick" data-te="stick" hidden>${ICON.move}<span>Schwebend</span></button>
          <button type="button" class="m-btn m-ghost" data-te="item-reset">${ICON.undo}<span>Standard</span></button>
        </div>
        <p class="te-warn" hidden></p>
      </section>
      <div class="te-toast" hidden role="status"></div>`;
    root.appendChild(layer);
    this.layer = layer;
    this.panel = layer.querySelector('.te-panel');
    this._on(layer, 'click', (e) => this._onTool(e));
    this._on(layer, 'input', (e) => this._onSlider(e));
    this._on(ui, 'pointerdown', (e) => this._down(e), { capture: true, passive: false });
    this._on(window, 'pointermove', (e) => this._move(e), { passive: false });
    this._on(window, 'pointerup', (e) => this._up(e));
    this._on(window, 'pointercancel', (e) => this._up(e));
    this._on(window, 'keydown', (e) => this._key(e), { capture: true });
    this._on(window, 'resize', () => { this.aspect = touchAspect(); this._apply(); });
    this._apply();
    setTimeout(() => { if (this.layer) this.layer.classList.add('is-idle'); }, 4500);
    this._focus(layer.querySelector('[data-te="done"]'));
  }

  /** Schließen; save = übernehmen. */
  stop(save = false) {
    if (!this.open) return;
    this.open = false;
    cancelAnimationFrame(this._raf);
    while (this._listeners.length) this._listeners.pop()();
    this._pointers.clear();
    this._drag = this._pinch = null;
    const S = this.G.settings;
    if (save && this._dirty) S.set('touchLayout', this.layout);
    if (this.layer) this.layer.remove();
    this.layer = null;
    delete document.body.dataset.touchEdit;
    const ui = this.ui;
    if (ui) ui.querySelectorAll('.te-ghost, .te-sel, .te-overlap').forEach((n) => n.classList.remove('te-ghost', 'te-sel', 'te-overlap'));
    // Gespeichertes Layout (oder unverändert das alte) wieder anwenden
    if (this.input && this.input.applyTouchLayout) this.input.applyTouchLayout();
    const cb = this._onClose;
    this._onClose = null;
    this.G.events.emit('ui:sound', { name: save ? 'confirm' : 'back' });
    if (cb) cb(save);
  }

  _on(t, type, fn, opts) {
    t.addEventListener(type, fn, opts);
    this._listeners.push(() => t.removeEventListener(type, fn, opts));
  }

  _focus(n) { if (n) try { n.focus({ preventScroll: true }); } catch { /* */ } }

  _presetLabel() {
    const L = sanitizeTouchLayout(this.layout || this.original);
    return { standard: 'Standard', klaue: 'Klaue', links: 'Linkshänder' }[L.preset] || 'Standard';
  }

  /* ------------------------------------------------------------ Anwenden */

  /** Layout auf die echten Knöpfe anwenden (Vorschau, ohne Speichern) und verborgene als „Geist“ zeigen. */
  _apply() {
    const input = this.input;
    if (!input || !this.open) return;
    input.applyTouchLayout(this.layout);
    const ui = this.ui;
    for (const b of TOUCH_BUTTONS) {
      const n = ui.querySelector(b.sel);
      if (!n) continue;
      const hidden = n.style.display === 'none';
      if (hidden) n.style.removeProperty('display');
      // Verborgen = eigene Angabe, optional ohne Angabe oder automatisch ohne Funktion
      n.classList.toggle('te-ghost', hidden);
      n.classList.toggle('te-sel', this.sel === b.id);
      n.dataset.teId = b.id;
    }
    this._markOverlaps();
    this._syncPanel();
    // HUD-Schema folgt dem Linkshänder-Layout (Minikarte rechts)
    const R = resolveTouchLayout(this.layout, this.aspect);
    if (this.back) this.back.classList.toggle('is-mirror', !!R.mirror);
  }

  _schedule() {
    if (this._pending) return;
    this._pending = true;
    this._raf = requestAnimationFrame(() => { this._pending = false; this._apply(); });
  }

  /** Überlappende Knöpfe markieren (nur sichtbare, Gruppe/Stick ausgenommen). */
  _markOverlaps() {
    const ui = this.ui;
    const rects = [];
    for (const b of ITEMS) {
      if (b.kind === 'stick' || b.kind === 'group') continue;
      const n = ui.querySelector(b.sel);
      if (!n || n.classList.contains('te-ghost')) { if (n) n.classList.remove('te-overlap'); continue; }
      const r = n.getBoundingClientRect();
      rects.push({ n, r, id: b.id });
    }
    const bad = new Set();
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r;
        const c = rects[j].r;
        const w = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (w <= 0 || h <= 0) continue;
        const area = Math.min(a.width * a.height, c.width * c.height) || 1;
        if ((w * h) / area > 0.12) { bad.add(rects[i].n); bad.add(rects[j].n); }
      }
    }
    for (const x of rects) x.n.classList.toggle('te-overlap', bad.has(x.n));
    this._overlaps = bad;
  }

  /* ------------------------------------------------------------ Auswahl + Panel */

  select(id) {
    if (this.sel === id) return;
    this.sel = id;
    this.ui.querySelectorAll('.te-sel').forEach((n) => n.classList.remove('te-sel'));
    if (id) {
      const b = TOUCH_BUTTONS.find((x) => x.id === id);
      const n = b && this.ui.querySelector(b.sel);
      if (n) n.classList.add('te-sel');
      this.G.events.emit('ui:sound', { name: 'hover' });
    }
    this._syncPanel();
  }

  _entry(id) {
    const R = resolveTouchLayout(this.layout, this.aspect);
    return R.buttons[id] || {};
  }

  _syncPanel() {
    const p = this.panel;
    if (!p) return;
    const id = this.sel;
    p.hidden = !id;
    if (!id) return;
    const b = TOUCH_BUTTONS.find((x) => x.id === id);
    const e = this._entry(id);
    const n = this.ui.querySelector(b.sel);
    p.querySelector('.te-name').textContent = b.label;
    const s = p.querySelector('[data-te-r="s"]');
    const o = p.querySelector('[data-te-r="o"]');
    const sv = e.s ?? 1;
    const ov = e.o ?? 1;
    if (document.activeElement !== s) s.value = String(sv);
    if (document.activeElement !== o) o.value = String(ov);
    s.nextElementSibling.textContent = `${Math.round(sv * 100)} %`;
    o.nextElementSibling.textContent = `${Math.round(ov * 100)} %`;
    for (const r of [s, o]) r.style.setProperty('--p', `${(((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100).toFixed(1)}%`);
    const ghost = !!(n && n.classList.contains('te-ghost'));
    const vis = p.querySelector('[data-te="vis"]');
    vis.hidden = NO_HIDE.has(id);
    vis.setAttribute('aria-pressed', String(!ghost));
    vis.innerHTML = `${ghost ? ICON.eyeOff : ICON.eye}<span>${ghost ? 'Ausgeblendet' : 'Sichtbar'}</span>`;
    const st = p.querySelector('[data-te="stick"]');
    st.hidden = id !== 'stick';
    if (id === 'stick') {
      const fixed = !!sanitizeTouchLayout(this.layout).stick.fixed;
      st.innerHTML = `${ICON.move}<span>${fixed ? 'Fest' : 'Schwebend'}</span>`;
      st.setAttribute('aria-pressed', String(fixed));
    }
    const warn = p.querySelector('.te-warn');
    const over = n && n.classList.contains('te-overlap');
    warn.hidden = !over && !(b.auto && ghost);
    warn.textContent = over ? 'Überlappt einen anderen Knopf.' : b.auto ? 'Erscheint im Spiel automatisch, sobald die Funktion verfügbar ist.' : '';
    // Panel auf die Seite gegenüber dem Knopf
    if (n) {
      const r = n.getBoundingClientRect();
      const left = r.left + r.width / 2 > window.innerWidth / 2;
      p.classList.toggle('is-left', left);
    }
  }

  _toast(text) {
    const t = this.layer && this.layer.querySelector('.te-toast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }

  _set(id, entry) {
    this.layout = editTouch(this.layout, this.aspect, id, entry);
    this._dirty = true;
  }

  /* ------------------------------------------------------------ Werkzeuge */

  _onTool(e) {
    const b = e.target.closest('[data-te]');
    if (!b) return;
    const what = b.dataset.te;
    if (what === 'cancel') this.stop(false);
    else if (what === 'done') this.stop(true);
    else if (what === 'grid') {
      this.grid = !this.grid;
      b.setAttribute('aria-pressed', String(this.grid));
      this.back.dataset.grid = this.grid ? '1' : '0';
      this.G.events.emit('ui:sound', { name: 'toggle' });
    } else if (what === 'reset') {
      const L = sanitizeTouchLayout(this.layout);
      delete L.custom[this.aspect];
      this.layout = L;
      this._dirty = true;
      this._apply();
      this._toast(`Alle Knöpfe für ${this.aspect} auf die Vorlage zurückgesetzt.`);
      this.G.events.emit('ui:sound', { name: 'back' });
    } else if (what === 'deselect') this.select(null);
    else if (what === 'vis' && this.sel) this._toggleVisible(this.sel);
    else if (what === 'stick') {
      const L = sanitizeTouchLayout(this.layout);
      L.stick = { ...L.stick, fixed: !L.stick.fixed };
      this.layout = L;
      this._dirty = true;
      this._apply();
      this.G.events.emit('ui:sound', { name: 'toggle' });
    } else if (what === 'item-reset' && this.sel) {
      this._set(this.sel, null);
      this._apply();
      this.G.events.emit('ui:sound', { name: 'back' });
    }
  }

  _toggleVisible(id) {
    if (NO_HIDE.has(id)) return;
    const b = TOUCH_BUTTONS.find((x) => x.id === id);
    const n = this.ui.querySelector(b.sel);
    const ghost = !!(n && n.classList.contains('te-ghost'));
    this._set(id, { h: !ghost });
    this._apply();
    this.G.events.emit('ui:sound', { name: 'toggle' });
  }

  _onSlider(e) {
    const r = e.target.closest('[data-te-r]');
    if (!r || !this.sel) return;
    this._set(this.sel, { [r.dataset.teR]: Number(r.value) });
    this._schedule();
  }

  /* ------------------------------------------------------------ Ziehen + Zwei-Finger-Größe */

  _itemAt(target) {
    if (!target || !target.closest) return null;
    const n = target.closest('.tc-streaks, .tc-stick-base, .tc-stick-knob, .tc-btn');
    if (!n) return null;
    if (n.closest('.tc-streaks')) return 'streaks';
    if (n.classList.contains('tc-stick-base') || n.classList.contains('tc-stick-knob')) return 'stick';
    for (const b of TOUCH_BUTTONS) if (n.matches(b.sel)) return b.id;
    return null;
  }

  /** Mitte und Größe eines Knopfs in % von #touch-ui. */
  _rect(id) {
    const ui = this.ui;
    const rr = ui.getBoundingClientRect();
    const b = TOUCH_BUTTONS.find((x) => x.id === id);
    const n = ui.querySelector(b.kind === 'stick' ? '.tc-stick-base' : b.sel);
    const r = n.getBoundingClientRect();
    return {
      x: ((r.left + r.width / 2 - rr.left) / rr.width) * 100,
      y: ((r.top + r.height / 2 - rr.top) / rr.height) * 100,
      hw: (r.width / rr.width) * 50,
      hh: (r.height / rr.height) * 50,
      rr,
    };
  }

  _down(e) {
    if (!this.open) return;
    e.preventDefault();
    e.stopPropagation();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Zweiter Finger: Größe des gewählten Knopfs
    if (this._pointers.size === 2 && this.sel) {
      const [a, b] = [...this._pointers.values()];
      this._pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: this._entry(this.sel).s ?? 1 };
      this._drag = null;
      return;
    }
    const id = this._itemAt(e.target);
    if (!id || id === 'pause') { this.select(null); return; } // leere Fläche: Auswahl aufheben
    this.select(id);
    const r = this._rect(id);
    this._drag = { id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, x0: r.x, y0: r.y, hw: r.hw, hh: r.hh, rr: r.rr, moved: false };
    try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch { /* */ }
  }

  _move(e) {
    if (!this.open || !this._pointers.has(e.pointerId)) return;
    e.preventDefault();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pinch && this._pointers.size >= 2 && this.sel) {
      const [a, b] = [...this._pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = clamp(Math.round((this._pinch.s0 * d) / this._pinch.d0 * 20) / 20, 0.6, 1.8);
      if (s !== (this._entry(this.sel).s ?? 1)) { this._set(this.sel, { s }); this._schedule(); }
      return;
    }
    const D = this._drag;
    if (!D || D.pid !== e.pointerId) return;
    const dx = e.clientX - D.sx;
    const dy = e.clientY - D.sy;
    if (!D.moved && Math.hypot(dx, dy) < 5) return;
    D.moved = true;
    let x = D.x0 + (dx / D.rr.width) * 100;
    let y = D.y0 + (dy / D.rr.height) * 100;
    // Einrasten: Raster, sonst an Mitten anderer Knöpfe bzw. der Bildmitte (mit Hilfslinien)
    let gx = null;
    let gy = null;
    if (this.grid) {
      x = Math.round(x / GRID) * GRID;
      y = Math.round(y / GRID) * GRID;
    } else {
      const cands = this._centers(D.id);
      for (const c of cands) {
        if (gx == null && Math.abs(c.x - x) < SNAP) { x = c.x; gx = c.x; }
        if (gy == null && Math.abs(c.y - y) < SNAP) { y = c.y; gy = c.y; }
      }
    }
    x = clamp(x, D.hw + 0.5, 100 - D.hw - 0.5);
    y = clamp(y, D.hh + 0.5, 100 - D.hh - 0.5);
    this._guides(gx, gy);
    this._set(D.id, { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    this._schedule();
  }

  _centers(except) {
    if (this._drag && this._drag.cands) return this._drag.cands;
    const out = [{ x: 50, y: -999 }];
    for (const b of ITEMS) {
      if (b.id === except) continue;
      const n = this.ui.querySelector(b.kind === 'stick' ? '.tc-stick-base' : b.sel);
      if (!n || n.classList.contains('te-ghost')) continue;
      const r = this._rect(b.id);
      out.push({ x: r.x, y: r.y });
    }
    if (this._drag) this._drag.cands = out;
    return out;
  }

  _guides(gx, gy) {
    const a = this.back.querySelector('.te-gx');
    const b = this.back.querySelector('.te-gy');
    a.hidden = gx == null;
    b.hidden = gy == null;
    if (gx != null) a.style.left = `${gx}%`;
    if (gy != null) b.style.top = `${gy}%`;
  }

  _up(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.delete(e.pointerId);
    if (this._pinch && this._pointers.size < 2) { this._pinch = null; this._apply(); }
    const D = this._drag;
    if (D && D.pid === e.pointerId) {
      this._drag = null;
      this._guides(null, null);
      if (D.moved) { this._apply(); this.G.events.emit('ui:sound', { name: 'click' }); }
    }
  }

  /* ------------------------------------------------------------ Tastatur + Gamepad */

  _cycle(d) {
    const list = ITEMS.map((b) => b.id);
    const i = list.indexOf(this.sel);
    this.select(list[(i + d + list.length) % list.length]);
    this._apply();
  }

  _nudge(dx, dy) {
    if (!this.sel) { this._cycle(1); return; }
    const r = this._rect(this.sel);
    const x = clamp(r.x + dx, r.hw + 0.5, 100 - r.hw - 0.5);
    const y = clamp(r.y + dy, r.hh + 0.5, 100 - r.hh - 0.5);
    this._set(this.sel, { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    this._schedule();
  }

  _resize(d) {
    if (!this.sel) return;
    const s = clamp(Math.round(((this._entry(this.sel).s ?? 1) + d) * 20) / 20, 0.6, 1.8);
    this._set(this.sel, { s });
    this._schedule();
  }

  _key(e) {
    if (!this.open) return;
    const t = e.target;
    if (t && t.matches && t.matches('input[type="range"]') && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
    const step = e.shiftKey ? GRID : 0.5;
    let used = true;
    switch (e.code) {
      case 'Escape': this.stop(false); break;
      case 'ArrowLeft': this._nudge(-step, 0); break;
      case 'ArrowRight': this._nudge(step, 0); break;
      case 'ArrowUp': this._nudge(0, -step); break;
      case 'ArrowDown': this._nudge(0, step); break;
      case 'BracketRight': case 'NumpadAdd': case 'Equal': this._resize(0.05); break;
      case 'BracketLeft': case 'NumpadSubtract': case 'Minus': case 'Slash': this._resize(-0.05); break;
      case 'KeyH': if (this.sel) this._toggleVisible(this.sel); break;
      case 'Tab': this._cycle(e.shiftKey ? -1 : 1); break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }

  /** Vom Menü-Gamepad-Takt (menus.js) aufgerufen. */
  pollPad(pad) {
    if (!this.open || !pad) return;
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const prev = this._padPrev;
    const released = (i) => prev[i] && !btn(i);
    const now = performance.now();
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    let dir = null;
    if (btn(12) || ay < -0.5) dir = [0, -1];
    else if (btn(13) || ay > 0.5) dir = [0, 1];
    else if (btn(14) || ax < -0.5) dir = [-1, 0];
    else if (btn(15) || ax > 0.5) dir = [1, 0];
    if (dir) {
      const key = dir.join();
      if (key !== this._padDir || now > this._padRepeat) {
        const fast = Math.hypot(ax, ay) > 0.92;
        this._nudge(dir[0] * (fast ? 1.5 : 0.5), dir[1] * (fast ? 1.5 : 0.5));
        this._padRepeat = now + (key === this._padDir ? 50 : 300);
        this._padDir = key;
      }
    } else this._padDir = null;
    if (released(4)) this._cycle(-1);
    if (released(5)) this._cycle(1);
    if (released(6)) this._resize(-0.05);
    if (released(7)) this._resize(0.05);
    if (released(0) && this.sel) this._toggleVisible(this.sel);
    if (released(3)) this.stop(true);
    else if (released(1)) this.stop(false);
    for (let i = 0; i < pad.buttons.length; i++) prev[i] = btn(i);
  }
}
