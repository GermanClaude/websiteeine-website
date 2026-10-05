// NULLPUNKT — Zielwahl für den Präzisionsschlag: große Karte (Norden oben) über dem Spiel. Touch/Maus: Punkt
// antippen, „Schlag anfordern.“ bestätigt (oder zweites Tippen auf die Markierung). Mit Pointer-Lock steuert
// die Maus einen virtuellen Cursor (Linksklick setzt/bestätigt, Rechtsklick bricht ab), Gamepad: linker Stick,
// A bestätigt, B bricht ab. Tastatur: Enter bestätigt, Rücktaste/Q bricht ab.

import { el } from './dom.js';
import { ICON } from './icons.js';
import { drawGlyph } from './glyphs.js';

const COL = { ally: '#38b6ff', enemy: '#ff3b3b', me: '#ffffff', signal: '#ff5b1f', neutral: '#e9e6df' };

export class StrikeTargeting {
  constructor(G, layer) {
    this.G = G;
    this.layer = layer;
    this.open = false;
    this.root = null;
    this.target = null; // { x, z } Welt
    this.cursor = { u: 0.5, v: 0.5 };
    this._listeners = [];
    this._padPrev = [];
  }

  /** opts: { radius, spacing, onConfirm(Vector3), onCancel() } → bool */
  show(opts) {
    const G = this.G;
    const mm = G.world && G.world.minimap;
    if (!mm || !mm.canvas) return false;
    this.close(true);
    this.opts = opts;
    this.open = true;
    this.target = null;
    const p = G.player;
    const uv = mm.worldToMap(p.position.x, p.position.z);
    this.cursor = { u: uv.u, v: uv.v };
    const touch = G.input && G.input.mode === 'touch';
    const r = el('div', 'st-overlay');
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Präzisionsschlag: Ziel wählen');
    r.innerHTML = `
      <div class="st-panel">
        <div class="st-head">
          <div><div class="st-kicker">Serienprämie</div><div class="st-title">Präzisionsschlag<em>.</em></div></div>
          <div class="st-hint">${touch ? 'Ziel auf der Karte antippen.' : 'Ziel mit der Maus wählen. Klick setzt, zweiter Klick bestätigt.'}</div>
        </div>
        <div class="st-map"><canvas></canvas><div class="st-cursor" aria-hidden="true">${ICON.crosshair}</div></div>
        <div class="st-actions">
          <button type="button" class="m-btn" data-st="cancel">${ICON.close}<span>Abbrechen</span>${touch ? '' : '<kbd>Rechtsklick</kbd>'}</button>
          <button type="button" class="m-btn m-primary" data-st="confirm" disabled>${ICON.target}<span>Schlag anfordern.</span>${touch ? '' : '<kbd>Enter</kbd>'}</button>
        </div>
      </div>`;
    this.layer.appendChild(r);
    this.root = r;
    this.canvas = r.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.cursorEl = r.querySelector('.st-cursor');
    this.confirmBtn = r.querySelector('[data-st="confirm"]');
    this.mapBox = r.querySelector('.st-map');
    this._size();

    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); this._listeners.push(() => t.removeEventListener(type, fn, o)); };
    on(r, 'click', (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      if (b.dataset.st === 'cancel') this.cancel();
      else this.confirm();
    });
    on(this.canvas, 'pointerdown', (e) => {
      if (document.pointerLockElement) return;
      e.preventDefault();
      const rc = this.canvas.getBoundingClientRect();
      this._pick((e.clientX - rc.left) / rc.width, (e.clientY - rc.top) / rc.height, true);
    });
    // Pointer-Lock: virtueller Cursor
    on(document, 'mousemove', (e) => {
      if (!document.pointerLockElement) return;
      const rc = this.canvas.getBoundingClientRect();
      this.cursor.u = clamp01(this.cursor.u + (e.movementX || 0) / rc.width);
      this.cursor.v = clamp01(this.cursor.v + (e.movementY || 0) / rc.height);
      this._draw();
    });
    on(document, 'mousedown', (e) => {
      if (!document.pointerLockElement) return;
      e.preventDefault();
      if (e.button === 2) this.cancel();
      else if (e.button === 0) this._pick(this.cursor.u, this.cursor.v, true);
    }, true);
    on(window, 'keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { e.preventDefault(); this.confirm(); }
      else if (e.code === 'Backspace' || e.code === 'KeyQ') { e.preventDefault(); this.cancel(); }
    });
    on(window, 'resize', () => this._size());
    this._draw();
    G.events.emit('ui:sound', { name: 'confirm' });
    return true;
  }

  _size() {
    if (!this.root) return;
    const box = this.mapBox.getBoundingClientRect();
    const mm = this.G.world.minimap;
    const aspect = mm.canvas.width / mm.canvas.height || 1;
    let w = box.width;
    let h = w / aspect;
    if (h > box.height) { h = box.height; w = h * aspect; }
    const d = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = `${Math.round(w)}px`;
    this.canvas.style.height = `${Math.round(h)}px`;
    this.canvas.width = Math.round(w * d);
    this.canvas.height = Math.round(h * d);
    this._draw();
  }

  /** u/v in 0..1 der Karte → Ziel setzen (zweites Tippen nahe der Markierung bestätigt). */
  _pick(u, v, allowConfirm) {
    const mm = this.G.world.minimap;
    const x = (u - 0.5) * mm.size.x + mm.center.x;
    const z = (v - 0.5) * (mm.size.z || mm.size.x) + mm.center.z;
    const b = this.G.world.bounds;
    const cx = b ? Math.min(b.max.x - 1, Math.max(b.min.x + 1, x)) : x;
    const cz = b ? Math.min(b.max.z - 1, Math.max(b.min.z + 1, z)) : z;
    if (allowConfirm && this.target) {
      const tu = mm.worldToMap(this.target.x, this.target.z);
      const rc = this.canvas.getBoundingClientRect();
      if (Math.hypot((tu.u - u) * rc.width, (tu.v - v) * rc.height) < 26) { this.confirm(); return; }
    }
    this.target = { x: cx, z: cz };
    this.cursor.u = u;
    this.cursor.v = v;
    this.confirmBtn.disabled = false;
    this.G.events.emit('ui:sound', { name: 'click' });
    this._draw();
  }

  confirm() {
    if (!this.open || !this.target) return;
    const { x, z } = this.target;
    const cb = this.opts && this.opts.onConfirm;
    this.close(true);
    if (cb) cb(new this.G.THREE.Vector3(x, 0, z));
  }

  cancel() {
    if (!this.open) return;
    const cb = this.opts && this.opts.onCancel;
    this.close(true);
    this.G.events.emit('ui:sound', { name: 'back' });
    if (cb) cb();
  }

  /** Schließt ohne Rückruf (silent) bzw. mit Abbruch-Rückruf. */
  close(silent = false) {
    if (!this.open) return;
    this.open = false;
    while (this._listeners.length) this._listeners.pop()();
    if (this.root) this.root.remove();
    this.root = null;
    if (!silent && this.opts && this.opts.onCancel) this.opts.onCancel();
  }

  update(dt) {
    if (!this.open) return;
    // Gamepad
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads || []) if (p && p.connected) { pad = p; break; }
    if (pad) {
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.18) {
        this.cursor.u = clamp01(this.cursor.u + ax * dt * 0.45);
        this.cursor.v = clamp01(this.cursor.v + ay * dt * 0.45);
        this._draw();
      }
      const a = !!(pad.buttons[0] && pad.buttons[0].pressed);
      const b = !!(pad.buttons[1] && pad.buttons[1].pressed);
      if (a && !this._padPrev[0]) this._pick(this.cursor.u, this.cursor.v, true);
      if (b && !this._padPrev[1]) this.cancel();
      this._padPrev[0] = a;
      this._padPrev[1] = b;
    }
    this._t = (this._t || 0) + dt;
    if (this.target) this._draw();
  }

  _draw() {
    if (!this.open || !this.ctx) return;
    const G = this.G;
    const mm = G.world.minimap;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const d = W / (parseFloat(this.canvas.style.width) || W);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(mm.canvas, 0, 0, W, H);
    ctx.fillStyle = 'rgba(10,11,13,.18)';
    ctx.fillRect(0, 0, W, H);
    const pxPerM = W / mm.size.x;
    const S = (x, z) => { const uv = mm.worldToMap(x, z); return [uv.u * W, uv.v * H]; };
    const p = G.player;
    const mode = G.mode;
    // Flaggen
    for (const f of (mode && mode.objectives) || []) {
      const [x, y] = S(f.position.x, f.position.z);
      const col = f.owner == null ? COL.neutral : f.owner === p.team ? COL.ally : COL.enemy;
      ctx.beginPath();
      ctx.arc(x, y, 11 * d, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,11,13,.85)';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * d;
      ctx.stroke();
      drawGlyph(ctx, String(f.id), `700 ${Math.round(13 * d)}px "Rajdhani NP", sans-serif`, col, x, y + d); // ohne Stilberechnung je Bild
    }
    // Mitspieler + bekannte Gegner
    const streaks = mode && mode.streaks;
    const uav = streaks ? streaks.uavInfo(p) : null;
    const now = G.time.elapsed;
    for (const a of G.actors) {
      if (!a.alive || a === p) continue;
      const hostile = G.combat ? G.combat.isHostile(p, a) : a.team !== p.team;
      if (hostile && now - (a.lastFiredTime ?? -1e9) > 2) continue;
      const [x, y] = S(a.position.x, a.position.z);
      ctx.beginPath();
      ctx.arc(x, y, (hostile ? 5 : 4.5) * d, 0, Math.PI * 2);
      ctx.fillStyle = hostile ? COL.enemy : COL.ally;
      ctx.fill();
    }
    if (uav && uav.own) {
      for (const b of uav.own.blips) {
        const [x, y] = S(b.x, b.z);
        ctx.beginPath();
        ctx.arc(x, y, 5 * d, 0, Math.PI * 2);
        ctx.fillStyle = COL.enemy;
        ctx.fill();
      }
    }
    // Spieler
    {
      const [x, y] = S(p.position.x, p.position.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-p.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -9 * d);
      ctx.lineTo(6.5 * d, 7 * d);
      ctx.lineTo(0, 3.5 * d);
      ctx.lineTo(-6.5 * d, 7 * d);
      ctx.closePath();
      ctx.fillStyle = COL.me;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5 * d;
      ctx.stroke();
      ctx.restore();
    }
    // Ziel: Wirkradius + Einschlagslinie (Flugrichtung = Spieler → Ziel)
    if (this.target) {
      const [x, y] = S(this.target.x, this.target.z);
      const r = ((this.opts && this.opts.radius) || 7) * pxPerM;
      const sp = ((this.opts && this.opts.spacing) || 6) * pxPerM;
      const [px, py] = S(p.position.x, p.position.z);
      let dx = x - px;
      let dy = y - py;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const pulse = 1 + Math.sin((this._t || 0) * 8) * 0.05;
      ctx.setLineDash([6 * d, 6 * d]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(255,91,31,.55)';
      ctx.lineWidth = 1.5 * d;
      ctx.stroke();
      ctx.setLineDash([]);
      for (const k of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.arc(x + dx * sp * k, y + dy * sp * k, r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,91,31,.12)';
        ctx.fill();
        ctx.strokeStyle = COL.signal;
        ctx.lineWidth = 2 * d;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * d, 0, Math.PI * 2);
      ctx.fillStyle = COL.signal;
      ctx.fill();
    }
    // virtueller Cursor
    const showCursor = !!document.pointerLockElement || this._padPrev.length > 0;
    this.cursorEl.style.display = showCursor ? 'block' : 'none';
    if (showCursor) {
      const cw = parseFloat(this.canvas.style.width) || 0;
      const ch = parseFloat(this.canvas.style.height) || 0;
      const box = this.mapBox.getBoundingClientRect();
      const cr = this.canvas.getBoundingClientRect();
      this.cursorEl.style.transform = `translate(${cr.left - box.left + this.cursor.u * cw}px, ${cr.top - box.top + this.cursor.v * ch}px)`;
    }
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
