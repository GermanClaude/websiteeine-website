// NULLPUNKT — Einsatzbildschirm (Eroberung: Karte mit HQ, eigenen Flaggen, Truppkameraden und Fahrzeugen; Trupp-Befehle)
// und „Ausrüsten“ nach dem Tod (alle Modi außer Infiziert/Schießstand): Ausrüstung wechseln, Wiedereinstieg angehalten,
// „Einsatz“ setzt ein. Touch zuerst (große Ziele), Maus (Desktop: Zeigersperre wird für den Bildschirm gelöst),
// Tastatur (Pfeile, Eingabe, L) und Gamepad (Steuerkreuz, A, Y, LB/RB, B zurück, Start = Einsatz).
// Wird von der HUD erzeugt und je Bild aktualisiert: new DeployScreen(G); attach(G); update(dt); detach().

import { el, esc, secs } from './dom.js';
import { ICON } from './icons.js';
import { LoadoutPanel } from './loadout-panel.js';

const OPEN_DELAY = 1.1; // s Todeskamera, bevor die Einsatzkarte erscheint (Eroberung)
const AUTO_GRACE = 2.5; // s nach Ablauf ohne Eingabe → automatisch einsetzen

export class DeployScreen {
  constructor(G) {
    this.G = G;
    this.root = null;
    this.btn = null;
    this.isOpen = false;
    this.kind = null; // 'deploy' | 'equip'
    this.tab = 'map';
    this.panel = new LoadoutPanel(G);
    this.sel = null;
    this.armed = false;
    this.interacted = false;
    this.changed = false;
    this._subs = null;
    this._lockPrev = null;
    this._readyAt = null;
    this._mkT = 0;
    this._pts = [];
    this._padPrev = [];
    this._padDir = null;
    this._padRep = 0;
    this._onKey = (e) => this._key(e);
    this.panel.onChange = () => { this.changed = true; this.interacted = true; };
  }

  /* ------------------------------------------------------------ Lebenszyklus */

  attach(G) {
    this.G = G;
    this.detach();
    const host = document.getElementById('hud-top') || document.getElementById('game-root') || document.body;
    this.root = el('div', 'dp-root');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Einsatz');
    host.appendChild(this.root);
    this.root.addEventListener('click', (e) => this._click(e));
    this.btn = el('button', 'dp-equip');
    this.btn.type = 'button';
    this.btn.hidden = true;
    this.btn.innerHTML = `${ICON.target}<span>Ausrüsten</span><kbd></kbd>`;
    this.btn.addEventListener('click', (e) => { e.preventDefault(); this.open('equip'); });
    host.appendChild(this.btn);
    const s = (this._subs = G.events.scope());
    s.on('actor:spawn', ({ actor }) => { if (actor === G.player) this.close(false); });
    s.on('match:state', ({ state }) => { if (state === 'ended' || state === 'lobby' || state === 'loading') this.close(false); });
    s.on('objective:update', () => { if (this.isOpen && this.kind === 'deploy') this._mkT = 0; });
    window.addEventListener('keydown', this._onKey, true);
    this.sel = null;
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    window.removeEventListener('keydown', this._onKey, true);
    this.close(false);
    this.panel.unmount();
    if (this.root) this.root.remove();
    if (this.btn) this.btn.remove();
    this.root = null;
    this.btn = null;
  }

  get mode() { return this.G.mode; }

  /** Modus erlaubt Ausrüsten/Einsatzkarte? */
  _canEquip() {
    const m = this.mode;
    return !!m && !m.lockLoadout && m.id !== 'training' && !m.isOver;
  }

  _isDeployMode() {
    const m = this.mode;
    return !!(m && m.def && m.def.deploy && typeof m.deployPoints === 'function');
  }

  /* ------------------------------------------------------------ Öffnen / Schließen */

  open(kind) {
    const G = this.G;
    const p = G.player;
    const m = this.mode;
    if (!this.root || !p || p.alive || !m || G.match.state !== 'playing') return;
    if (kind === 'equip' && !this._canEquip()) return;
    if (this.isOpen && this.kind === 'deploy' && kind === 'equip') { this._setTab('loadout'); return; }
    this.kind = kind;
    this.isOpen = true;
    this.armed = false;
    this.interacted = kind === 'equip';
    this.changed = false;
    this._readyAt = null;
    this.tab = kind === 'equip' ? 'loadout' : 'map';
    // Einsatzkarte: Wartezeit läuft weiter (nur Wiedereinstieg gesperrt); Ausrüsten: Zeit pausiert
    if (typeof m.holdRespawn === 'function') m.holdRespawn(p, true, { pause: kind === 'equip' });
    if (kind === 'deploy' && !this.sel) this.sel = (m.deployChoice && { ...m.deployChoice }) || { kind: 'hq', id: 'hq' };
    this._unlockPointer();
    this.root.hidden = false; // vor dem Aufbau sichtbar: die Karte misst ihre Größe
    this._render();
    document.body.dataset.deploy = kind;
    G.events.emit('ui:sound', { name: 'open' });
    requestAnimationFrame(() => this._focus());
  }

  /** deploy = true: Auswahl übernehmen und einsetzen. */
  close(deploy = false, gesture = false) {
    const G = this.G;
    const m = this.mode;
    const p = G.player;
    if (!this.isOpen) { if (this.btn) this.btn.hidden = true; return; }
    if (deploy && m && p) {
      if (this.changed && this.panel.host) {
        const lo = this.panel.value();
        this.panel.save();
        const when = typeof m.setLoadout === 'function' ? m.setLoadout(lo) : 'next';
        G.events.emit('loadout:change', { actor: p, loadout: lo, when });
      }
      if (this.kind === 'deploy' && typeof m.setDeploy === 'function') m.setDeploy(this.sel);
      if (typeof m.deployNow === 'function') m.deployNow(p);
    } else if (m && p && typeof m.holdRespawn === 'function') {
      // Abbrechen (Ausrüsten → zurück zum Todesbildschirm): Zeit läuft weiter
      if (!p.alive && this.kind === 'equip') m.holdRespawn(p, false);
      else if (p.alive) m.holdRespawn(p, false);
    }
    this.isOpen = false;
    this.kind = null;
    this.panel.unmount();
    if (this.root) { this.root.hidden = true; this.root.innerHTML = ''; }
    delete document.body.dataset.deploy;
    this._restorePointer(gesture);
  }

  _unlockPointer() {
    const G = this.G;
    const inp = G.input;
    if (!inp || inp.mode !== 'desktop') return;
    if (this._lockPrev == null) this._lockPrev = !!inp.allowUnlockedMouse;
    inp.allowUnlockedMouse = true;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* */ }
  }

  _restorePointer(gesture) {
    const inp = this.G.input;
    if (this._lockPrev == null || !inp) return;
    inp.allowUnlockedMouse = this._lockPrev;
    this._lockPrev = null;
    if (gesture && inp.mode === 'desktop' && !inp.allowUnlockedMouse && this.G.match.state === 'playing') {
      try { inp.requestLock(); } catch { /* */ }
    }
  }

  /* ------------------------------------------------------------ Darstellung */

  _render() {
    if (!this.root) return;
    const G = this.G;
    const m = this.mode;
    const deploy = this.kind === 'deploy';
    const sq = G.squads && G.player ? G.squads.of(G.player) : null;
    const tabs = deploy ? `<div class="dp-tabs m-tabs" role="tablist">
        <button type="button" class="m-tab" role="tab" data-dtab="map" aria-selected="${this.tab === 'map'}">${ICON.map}<span>Karte</span></button>
        <button type="button" class="m-tab" role="tab" data-dtab="loadout" aria-selected="${this.tab === 'loadout'}"${this._canEquip() ? '' : ' disabled'}>${ICON.target}<span>Ausrüstung</span></button></div>` : '';
    this.root.innerHTML = `
      <div class="dp" data-kind="${this.kind}" data-tab="${this.tab}">
        <header class="dp-head">
          <div class="dp-title"><small>${esc(m && m.def ? m.def.name : '')}${sq ? ` · Trupp ${esc(sq.name)}` : ''}</small><b>${deploy ? 'Einsatz' : 'Ausrüsten'}<em>.</em></b></div>
          ${tabs}
        </header>
        <div class="dp-body">
          ${deploy ? `<div class="dp-map" data-pane="map"${this.tab === 'map' ? '' : ' hidden'}><canvas class="dp-canvas"></canvas><div class="dp-marks"></div></div>
          <aside class="dp-side m-scroll" data-scrollable data-pane="map"${this.tab === 'map' ? '' : ' hidden'}><h3 class="m-h2">Einsatzpunkt</h3><div class="dp-list"></div>
            ${sq ? `<h3 class="m-h2">Trupp-Befehl</h3><div class="dp-orders"></div><p class="dp-order-now"></p>` : ''}</aside>` : ''}
          <div class="dp-lo" data-pane="loadout"${this.tab === 'loadout' ? '' : ' hidden'}></div>
        </div>
        <footer class="dp-foot">
          <span class="dp-info"></span>
          ${deploy ? '' : '<button type="button" class="m-btn dp-back" data-dact="back">' + ICON.back + '<span>Zurück</span></button>'}
          <button type="button" class="m-btn m-primary dp-go" data-dact="go">${ICON.play}<span>Einsatz</span><kbd></kbd></button>
        </footer>
      </div>`;
    this.el = {
      dp: this.root.querySelector('.dp'), canvas: this.root.querySelector('.dp-canvas'), marks: this.root.querySelector('.dp-marks'),
      list: this.root.querySelector('.dp-list'), orders: this.root.querySelector('.dp-orders'), orderNow: this.root.querySelector('.dp-order-now'),
      lo: this.root.querySelector('.dp-lo'), info: this.root.querySelector('.dp-info'), go: this.root.querySelector('.dp-go'),
    };
    if (this.tab === 'loadout') this.panel.mount(this.el.lo);
    if (deploy) { this._drawMap(); this._renderPoints(); }
    this._updateFoot();
  }

  _setTab(t) {
    if (!this.isOpen || t === this.tab) return;
    if (t === 'loadout' && !this._canEquip()) return;
    this.tab = t;
    this.interacted = true;
    const dp = this.el && this.el.dp;
    if (!dp) return;
    dp.dataset.tab = t;
    this.root.querySelectorAll('[data-dtab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dtab === t)));
    this.root.querySelectorAll('[data-pane]').forEach((n) => { n.hidden = n.dataset.pane !== t; });
    if (t === 'loadout' && !this.panel.host) this.panel.mount(this.el.lo);
    if (t === 'map') requestAnimationFrame(() => { this._drawMap(); this._renderPoints(); });
    this.G.events.emit('ui:sound', { name: 'click' });
    requestAnimationFrame(() => this._focus());
  }

  /** Kartenbild (Minikarte der Welt) einpassen; Umrechnung Welt → Pixel merken. */
  _drawMap() {
    const cv = this.el && this.el.canvas;
    const w = this.G.world;
    if (!cv || !cv.offsetParent) return;
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(8, Math.round(r.width * dpr));
    cv.height = Math.max(8, Math.round(r.height * dpr));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#101214';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const mm = w && w.minimap;
    const img = mm && mm.canvas;
    this._map = null;
    if (!img || !img.width || typeof mm.worldToMap !== 'function') return;
    const s = Math.min(cv.width / img.width, cv.height / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    const ox = (cv.width - dw) / 2;
    const oy = (cv.height - dh) / 2;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(img, ox, oy, dw, dh);
    ctx.globalAlpha = 1;
    this._map = { ox: ox / dpr, oy: oy / dpr, w: dw / dpr, h: dh / dpr, mm };
  }

  _toPx(pos) {
    const M = this._map;
    if (!M || !pos) return null;
    const uv = M.mm.worldToMap(pos.x, pos.z);
    return { x: M.ox + uv.u * M.w, y: M.oy + uv.v * M.h };
  }

  _renderPoints() {
    const G = this.G;
    const m = this.mode;
    if (!m || !this.el || !this.el.list) return;
    const pts = (this._pts = m.deployPoints(G.player));
    if (this.sel && !pts.find((p) => p.kind === this.sel.kind && String(p.id) === String(this.sel.id) && p.available)) this.sel = { kind: 'hq', id: 'hq' };
    const team = G.player.team;
    const key = (p) => `${p.kind}:${p.id}`;
    const isSel = (p) => this.sel && p.kind === this.sel.kind && String(p.id) === String(this.sel.id);
    const icon = (p) => (p.kind === 'hq' ? ICON.hq : p.kind === 'squad' ? ICON.user : p.kind === 'vehicle' ? ICON.tank : '');
    const side = (p) => (p.kind !== 'flag' ? 'a' : p.owner == null ? 'n' : p.owner === team ? 'a' : 'e');
    // Liste
    this.el.list.innerHTML = pts.map((p) => `<button type="button" class="dp-pt${isSel(p) ? ' is-sel' : ''}" data-pt="${esc(key(p))}" data-side="${side(p)}" aria-pressed="${isSel(p)}"${p.available ? '' : ' aria-disabled="true"'}>
        <i>${p.kind === 'flag' ? `<b>${esc(p.label)}</b>` : icon(p)}</i><span><b>${esc(p.kind === 'flag' ? p.sub : p.label)}</b><small>${esc(p.available ? (p.kind === 'flag' ? 'Eigene Flagge' : p.sub || '') : p.reason || 'Nicht verfügbar')}</small></span></button>`).join('');
    // Kartenmarker
    if (this.el.marks) {
      this.el.marks.innerHTML = pts.map((p) => {
        const px = this._toPx(p.position);
        if (!px) return '';
        return `<button type="button" class="dp-mk${isSel(p) ? ' is-sel' : ''}${p.available ? '' : ' is-off'}" data-kind="${p.kind}" data-side="${side(p)}" data-pt="${esc(key(p))}" style="left:${px.x.toFixed(1)}px;top:${px.y.toFixed(1)}px" aria-label="${esc(`${p.label} ${p.sub || ''}`)}" tabindex="-1">${p.kind === 'flag' ? `<b>${esc(p.label)}</b>` : icon(p)}</button>`;
      }).join('');
    }
    // Befehle
    if (this.el.orders && m.objectives) {
      const sq = G.squads && G.squads.of(G.player);
      const cur = sq && sq.order;
      this.el.orders.innerHTML = m.objectives.map((f) => `<button type="button" class="dp-ord${cur && cur.objectiveId === f.id ? ' is-on' : ''}" data-order="${esc(f.id)}" data-side="${f.owner == null ? 'n' : f.owner === team ? 'a' : 'e'}" title="${esc(f.name || f.id)}">${esc(f.id)}</button>`).join('');
      this.el.orderNow.textContent = cur ? `${cur.kind === 'defend' ? 'Verteidigt' : 'Angriff auf'} ${cur.objectiveId}${(m.objectives.find((f) => f.id === cur.objectiveId) || {}).name ? ` – ${m.objectives.find((f) => f.id === cur.objectiveId).name}` : ''}` : 'Kein Befehl – der Trupp folgt dem Teamplan.';
    }
  }

  _updateFoot() {
    const G = this.G;
    const m = this.mode;
    const p = G.player;
    if (!this.el || !m || !p) return;
    const left = typeof m.respawnLeft === 'function' ? m.respawnLeft(p) : 0;
    const deploy = this.kind === 'deploy';
    let info;
    if (deploy) {
      const sel = this._pts.find((x) => this.sel && x.kind === this.sel.kind && String(x.id) === String(this.sel.id));
      const where = sel ? (sel.kind === 'flag' ? `Flagge ${sel.label} – ${sel.sub}` : sel.label) : 'HQ';
      info = left > 0.05 ? `${esc(where)} · bereit in <b>${secs(left)}</b>` : `${esc(where)} · <b>bereit</b>`;
      if (this.armed && left > 0.05) info += ' · Einsatz vorgemerkt';
    } else info = left > 0.05 ? `Wiedereinstieg angehalten · <b>${secs(left)}</b> Rest` : 'Bereit zum Einsatz';
    if (this._infoHtml !== info) { this._infoHtml = info; this.el.info.innerHTML = info; }
    const k = this.el.go.querySelector('kbd');
    const touch = G.input && G.input.mode === 'touch';
    const kt = touch ? '' : G.input && G.input.lastDevice === 'gamepad' ? 'Start' : 'Enter';
    if (k && k.textContent !== kt) k.textContent = kt;
    this.el.go.classList.toggle('is-wait', deploy && left > 0.05);
  }

  _focus() {
    if (!this.root || this.root.hidden) return;
    const a = document.activeElement;
    if (a && this.root.contains(a)) return;
    const t = this.root.querySelector(this.tab === 'map' ? '.dp-pt.is-sel' : '.lp-cls[aria-pressed="true"]') || this.root.querySelector('.dp-go');
    if (t) try { t.focus({ preventScroll: true }); } catch { /* */ }
  }

  /* ------------------------------------------------------------ Eingaben */

  _click(e) {
    const b = e.target.closest('button');
    if (!b || !this.root.contains(b) || b.closest('.lp')) return;
    const ds = b.dataset;
    const G = this.G;
    if (ds.dtab) { this._setTab(ds.dtab); return; }
    if (ds.dact === 'go') { this._go(true); return; }
    if (ds.dact === 'back') { G.events.emit('ui:sound', { name: 'back' }); this.close(false, true); return; }
    if (ds.pt) {
      const [kind, ...rest] = ds.pt.split(':');
      const id = rest.join(':');
      const p = this._pts.find((x) => x.kind === kind && String(x.id) === id);
      this.interacted = true;
      if (p && p.available) { this.sel = { kind, id: p.id }; G.events.emit('ui:sound', { name: 'click' }); this._renderPoints(); this._updateFoot(); }
      else if (p && kind === 'flag') this._order(p.id);
      else G.events.emit('ui:sound', { name: 'error' });
      return;
    }
    if (ds.order) this._order(ds.order);
  }

  _order(id) {
    const m = this.mode;
    if (!m || typeof m.squadOrder !== 'function') return;
    const o = m.squadOrder(id, this.G.player);
    this.interacted = true;
    if (o) this.G.events.emit('ui:sound', { name: 'confirm' });
    this._renderPoints();
  }

  /** „Einsatz“: sofort, sobald die Wartezeit um ist (Eroberung: vormerken). */
  _go(gesture) {
    const m = this.mode;
    const p = this.G.player;
    if (!m || !p) return;
    const left = typeof m.respawnLeft === 'function' ? m.respawnLeft(p) : 0;
    if (this.kind === 'deploy' && left > 0.05) {
      this.armed = true;
      this.interacted = true;
      this._gesture = gesture;
      this.G.events.emit('ui:sound', { name: 'click' });
      this._updateFoot();
      return;
    }
    this.G.events.emit('ui:sound', { name: 'confirm' });
    this.close(true, gesture);
  }

  _key(e) {
    if (!this.isOpen || !this.root) return;
    const t = e.target;
    if (t && t.matches && t.matches('input[type="text"]')) return;
    const G = this.G;
    if (G.match.state !== 'playing') return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const a = document.activeElement;
      if (a && this.root.contains(a) && a.tagName === 'BUTTON' && !a.classList.contains('dp-go')) return; // Knopf selbst
      e.preventDefault();
      this._go(true);
      return;
    }
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.code];
    if (dir) { e.preventDefault(); e.stopPropagation(); this._move(dir); return; }
    if (e.code === 'KeyL') { // Ausrüsten-Taste (Standardbelegung): Karte ↔ Ausrüstung
      e.preventDefault();
      if (this.kind === 'deploy') this._setTab(this.tab === 'map' ? 'loadout' : 'map');
    }
  }

  _move(dir) {
    const items = [...this.root.querySelectorAll('button:not([disabled])')].filter((n) => n.tabIndex !== -1 && n.offsetParent !== null && !n.closest('[hidden]'));
    if (!items.length) return;
    const a = document.activeElement;
    if (!a || !items.includes(a)) { items[0].focus({ preventScroll: false }); return; }
    const r = a.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best = null;
    let bestS = Infinity;
    for (const n of items) {
      if (n === a) continue;
      const q = n.getBoundingClientRect();
      const x = q.left + q.width / 2 - cx;
      const y = q.top + q.height / 2 - cy;
      const main = dir === 'up' ? -y : dir === 'down' ? y : dir === 'left' ? -x : x;
      const off = dir === 'up' || dir === 'down' ? Math.abs(x) : Math.abs(y);
      if (main <= 4) continue;
      const sc = main + off * 2.2;
      if (sc < bestS) { bestS = sc; best = n; }
    }
    if (best) { best.focus({ preventScroll: false }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); this.G.events.emit('ui:sound', { name: 'hover' }); }
  }

  _pollPad() {
    if (typeof navigator.getGamepads !== 'function') return;
    let pad = null;
    for (const p of navigator.getGamepads() || []) if (p && p.connected) { pad = p; break; }
    if (!pad) return;
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const prev = this._padPrev;
    const rel = (i) => prev[i] && !btn(i);
    const now = performance.now();
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    let dir = null;
    if (btn(12) || ay < -0.6) dir = 'up';
    else if (btn(13) || ay > 0.6) dir = 'down';
    else if (btn(14) || ax < -0.6) dir = 'left';
    else if (btn(15) || ax > 0.6) dir = 'right';
    if (dir) {
      if (dir !== this._padDir || now > this._padRep) { this._move(dir); this._padRep = now + (dir === this._padDir ? 140 : 380); this._padDir = dir; }
    } else this._padDir = null;
    if (rel(0)) { const a = document.activeElement; if (a && this.root.contains(a)) a.click(); else this._focus(); }
    if (rel(9)) this._go(true);
    if (rel(3) && this.kind === 'deploy') this._setTab(this.tab === 'map' ? 'loadout' : 'map');
    if ((rel(4) || rel(5)) && this.kind === 'deploy') this._setTab(this.tab === 'map' ? 'loadout' : 'map');
    if (rel(1) && this.kind === 'equip') this.close(false, true);
    for (let i = 0; i < pad.buttons.length; i++) prev[i] = btn(i);
  }

  /* ------------------------------------------------------------ Bild */

  update(dt) {
    const G = this.G;
    const p = G.player;
    const m = this.mode;
    if (!this.root || !p || !m) return;
    const playing = G.match.state === 'playing';
    const dead = !p.alive && playing;
    // Eroberung: Einsatzkarte nach kurzer Todeskamera
    if (dead && !this.isOpen && this._isDeployMode() && p.diedAt != null && G.time.elapsed - p.diedAt > OPEN_DELAY) this.open('deploy');
    // Andere Modi: „Ausrüsten“ (Knopf + Taste L / Y)
    const canBtn = dead && !this.isOpen && !this._isDeployMode() && this._canEquip();
    if (this.btn.hidden === canBtn) this.btn.hidden = !canBtn;
    if (canBtn) {
      const k = this.btn.querySelector('kbd');
      const kt = G.input && G.input.mode !== 'touch' && typeof G.input.label === 'function' ? G.input.label('loadout') || '' : '';
      if (k && k.textContent !== kt) k.textContent = kt;
      if (G.input && typeof G.input.pressed === 'function' && G.input.pressed('loadout')) this.open('equip');
    }
    if (!this.isOpen) return;
    if (!dead) { if (p.alive) this.close(false); return; }
    this._pollPad();
    this._mkT -= dt;
    if (this.kind === 'deploy' && this.tab === 'map' && this._mkT <= 0) {
      this._mkT = 0.5;
      if (!this._map) this._drawMap();
      this._renderPoints();
    }
    this._updateFoot();
    if (this.kind === 'deploy') {
      const left = typeof m.respawnLeft === 'function' ? m.respawnLeft(p) : 0;
      if (left <= 0.05) {
        if (this._readyAt == null) this._readyAt = G.time.elapsed;
        if (this.armed) this.close(true, !!this._gesture);
        else if (!this.interacted && G.time.elapsed - this._readyAt > AUTO_GRACE) this.close(true, false);
      }
    }
  }

  /** Größe geändert: Karte neu einpassen. */
  resize() {
    if (this.isOpen && this.kind === 'deploy' && this.tab === 'map') { this._drawMap(); this._renderPoints(); }
  }
}
