// NULLPUNKT — Befehlsrad (wie in Helldivers/Truppspielen): Taste „Befehlsrad“ halten (Tastatur Z, Gamepad LT + ▲,
// Touch: Knopf oben rechts) → Rad in der Bildmitte, Richtung mit Maus/rechtem Stick bzw. durch Ziehen am Knopf wählen,
// Loslassen bestätigt (Feuertaste ebenso; Mitte = abbrechen). Kurz antippen statt halten: das Rad bleibt offen (Maus/Stick
// wählen, Klick bzw. erneutes Drücken bestätigt); auf Touch werden die Felder dann direkt angetippt.
// Das Spiel läuft weiter (keine Zeitlupe: veränderte Spielgeschwindigkeit wertet das Match ab).
// Befehle (bots/ai/orders.js): Mir folgen, Angreifen, Ausschwärmen, Verteidigen, Position halten, Sammeln, Formation
// (wechselt bei jeder Wahl Reihe → Keil → Kreis), Frei handeln. Angreifen/Verteidigen/Ausschwärmen nehmen den Punkt unter
// dem Fadenkreuz (bzw. den Gegner im Fadenkreuz) und setzen eine Markierung in die Welt.
// Offline/Host: G.bots.issueOrder; Client: Nachricht { t: 'order', order, point, target, formation } an den Host
// (net/sync-host.js wendet sie auf Bots um die eigene Puppe an). Rückmeldung: Klick-/Bestätigungston, Hinweis
// „Befehl: Mir folgen (3 Bots)“, die Bots drehen sich kurz zum Spieler.
// VR: noch ohne Rad (die Seite ist in der Brille nicht sichtbar) – das Rad bleibt dort geschlossen.

import * as THREE from 'three';
import { el, esc, setStyle, setText, toggle, meters, clamp } from './dom.js';
import { ORDER_DEFS, FORMATIONS, FORMATION_LABELS, ORDER_RADIUS } from '../bots/ai/orders.js';

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Symbole je Befehl (24er-Raster, Strich = currentColor). */
const ICONS = {
  follow: svg('<circle cx="17" cy="5" r="2.3"/><path d="M17 8v5.5l-2.2 6.5M17 13.5l2.2 6.5M15 10.5l-2.5 2"/><path d="M2.5 12.5h7M6.5 9l3 3.5-3 3.5"/>'),
  attack: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  spread: svg('<path d="M12 21V10M12 21L5 10M12 21l7-11"/><path d="M9.5 12.5L12 10l2.5 2.5M3.5 13l1.5-3 3.2.3M20.5 13L19 10l-3.2.3"/><path d="M5 4.5h.01M12 3.5h.01M19 4.5h.01" stroke-width="2.6"/>'),
  defend: svg('<path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>'),
  hold: svg('<path d="M12 21.5s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><path d="M9.5 10.5h5"/>'),
  regroup: svg('<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M3.5 3.5l5 5M8.5 4.5v4h-4M20.5 3.5l-5 5M15.5 4.5v4h4M3.5 20.5l5-5M8.5 19.5v-4h-4M20.5 20.5l-5-5M15.5 19.5v-4h4"/>'),
  formation: svg('<circle cx="12" cy="5.5" r="2"/><circle cx="7.5" cy="11.5" r="2"/><circle cx="16.5" cy="11.5" r="2"/><circle cx="3.8" cy="17.8" r="1.8"/><circle cx="20.2" cy="17.8" r="1.8"/>'),
  free: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.7 8.7l6.6 6.6M15.3 8.7l-6.6 6.6"/>'),
};
/** Anordnung im Uhrzeigersinn ab oben: Bewegung mit dem Spieler links, Punktbefehle rechts, Halten unten. */
const WHEEL = ['follow', 'attack', 'spread', 'defend', 'hold', 'regroup', 'formation', 'free'];
const SEG = (Math.PI * 2) / WHEEL.length;
const DEAD = 0.34; // Zeigerausschlag unter diesem Wert = Mitte (abbrechen)
const TAP_MS = 320; // kürzer gehalten (ohne Ziehen) = Touch-Antippen → Rad bleibt zum Antippen offen
const MARK_TONE = { attack: 'enemy', defend: 'ally', spread: 'signal' };
const MARK_TEXT = { attack: 'Angriff', defend: 'Verteidigen', spread: 'Ausschwärmen' };

/** SVG-Pfad eines Ringsegments (viewBox −100…100, Winkel 0 = oben, im Uhrzeigersinn). */
function sector(i, r0, r1, gap = 0.035) {
  const a0 = i * SEG - SEG / 2 + gap, a1 = i * SEG + SEG / 2 - gap;
  const p = (r, a) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  return `M${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

export class CommandWheel {
  /**
   * @param {object} G
   * @param {HTMLElement} layer #hud-top (interaktive HUD-Ebene über der Touch-Steuerung)
   * @param {{ notice?: (text: string, tone?: string) => void }} hooks Hinweis im HUD
   */
  constructor(G, layer, hooks = {}) {
    this.G = G;
    this.layer = layer;
    this.hooks = hooks;
    this.isOpen = false;
    this.sel = -1; // Index in WHEEL
    this.sticky = false; // kurz angetippt: Rad bleibt offen
    this.tap = false; // Touch: Felder antippen
    this._formIdx = 1; // nächste Form (Keil)
    this.tapMs = TAP_MS; // Antippen-Schwelle (Prüfläufe unter Last setzen sie höher)
    this._openAt = 0;
    this._marks = [];
    this._build();
  }

  _build() {
    const r = el('div', 'cw-root');
    r.hidden = true;
    r.setAttribute('role', 'menu');
    r.setAttribute('aria-label', 'Befehlsrad');
    const segs = WHEEL.map((id, i) => `<path class="cw-seg" data-i="${i}" d="${sector(i, 41, 97)}"/>`).join('');
    r.innerHTML = `
      <svg class="cw-ring" viewBox="-100 -100 200 200" aria-hidden="true">
        <circle class="cw-back" r="98"/>${segs}
        <circle class="cw-hub" r="38"/>
        <path class="cw-ptr" d="M-5 -41L0 -49L5 -41Z"/>
      </svg>
      ${WHEEL.map((id, i) => {
        const a = i * SEG;
        const x = 50 + Math.sin(a) * 34.5, y = 50 - Math.cos(a) * 34.5;
        return `<button type="button" class="cw-item" data-i="${i}" role="menuitem" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">${ICONS[id]}<span>${esc(ORDER_DEFS[id].label)}</span></button>`;
      }).join('')}
      <button type="button" class="cw-center" aria-label="Schließen">
        <b class="cw-title">Befehl</b><span class="cw-hint"></span><span class="cw-count"></span>
      </button>
      <div class="cw-foot"></div>`;
    this.layer.appendChild(r);
    this.root = r;
    this.ptr = r.querySelector('.cw-ptr');
    this.segs = [...r.querySelectorAll('.cw-seg')];
    this.items = [...r.querySelectorAll('.cw-item')];
    this.titleEl = r.querySelector('.cw-title');
    this.hintEl = r.querySelector('.cw-hint');
    this.countEl = r.querySelector('.cw-count');
    this.footEl = r.querySelector('.cw-foot');
    this.formLabel = this.items[WHEEL.indexOf('formation')].querySelector('span');
    // Touch (Antippen): Feld → Befehl, Mitte → schließen
    const pick = (e) => {
      if (!this.isOpen) return;
      const b = e.target.closest('[data-i]');
      e.preventDefault();
      e.stopPropagation();
      if (b) this._confirm(Number(b.dataset.i));
      else if (e.target.closest('.cw-center')) this.close(false);
    };
    r.addEventListener('pointerdown', pick);
    this.marks = el('div', 'cw-marks');
    this.layer.appendChild(this.marks);
  }

  /** Neues Match: Markierungen weg, Rad zu. */
  attach(G) {
    this.G = G;
    this.close(false, true);
    this.clearMarks();
    this._formIdx = 1;
  }

  detach() {
    this.close(false, true);
    this.clearMarks();
  }

  /** Kann gerade befohlen werden? (Teammodus, lebend, Match läuft, nicht in VR) */
  available() {
    const G = this.G;
    const p = G.player;
    if (!p || !p.alive || !p.team || !G.mode || !G.mode.teams) return false;
    if (G.match.state !== 'playing' || (G.xr && G.xr.presenting)) return false;
    if (G.hud && G.hud.targeting && G.hud.targeting.open) return false;
    return true;
  }

  /** Je Bild (HUD.update). */
  update(dt) {
    const G = this.G;
    const input = G.input;
    if (!input) return;
    const W = input.wheel;
    if (this.isOpen && (!this.available() || !input.enabled || W.cancel)) this.close(false);
    if (!this.isOpen) {
      if (input.pressed('befehl') && this.available() && input.enabled) this.open();
    } else {
      const touch = input.mode === 'touch';
      if (!this.tap) {
        // Richtung → Feld
        const m = Math.hypot(W.x, W.y);
        let sel = -1;
        if (m > DEAD) sel = (Math.round(Math.atan2(W.x, -W.y) / SEG) + WHEEL.length) % WHEEL.length;
        if (sel !== this.sel) this._select(sel);
        setStyle(this.ptr, 'transform', m > 0.12 ? `rotate(${((Math.atan2(W.x, -W.y) * 180) / Math.PI).toFixed(1)}deg)` : '');
        toggle(this.ptr, 'is-on', m > 0.12);
      }
      if (W.click) {
        // Feuertaste: Auswahl bestätigen, ohne Auswahl abbrechen
        W.click = false;
        if (this.sel >= 0) this._confirm(this.sel); else this.close(false);
      } else if (this.sticky) {
        if (input.pressed('befehl')) { if (this.sel >= 0) this._confirm(this.sel); else this.close(false); }
      } else if (input.released('befehl') || !input.down('befehl')) {
        // Loslassen: Auswahl bestätigen; kurz angetippt ohne Auswahl → offen lassen
        const quick = performance.now() - this._openAt < this.tapMs;
        if (quick && !W.drag && this.sel < 0) this._setSticky(touch);
        else if (this.sel >= 0) this._confirm(this.sel);
        else this.close(false);
      }
      if (this.isOpen) this._updateCount();
    }
    this._updateMarks(dt);
  }

  open() {
    const G = this.G;
    this.isOpen = true;
    this.tap = false;
    this.sticky = false;
    this._openAt = performance.now();
    G.input.openWheel();
    this.root.hidden = false;
    toggle(this.root, 'is-tap', false);
    this.formLabel.textContent = `Formation · ${FORMATION_LABELS[FORMATIONS[this._formIdx]]}`;
    const dev = G.input.mode === 'touch' ? 'touch' : G.input.lastDevice === 'gamepad' ? 'pad' : 'kb';
    setText(this.footEl, dev === 'touch' ? 'Ziehen und loslassen – oder antippen.' : dev === 'pad' ? 'Rechter Stick wählt, loslassen bestätigt.' : 'Maus wählt, loslassen oder Klick bestätigt.');
    this._select(-1);
    this._countAt = 0;
    this._updateCount();
    G.events.emit('ui:sound', { name: 'toggle' });
  }

  /** Schließen (confirm: nur intern). silent: ohne Ton (Matchwechsel). */
  close(confirm = false, silent = false) {
    if (!this.isOpen) { if (this.root) this.root.hidden = true; return; }
    this.isOpen = false;
    this.tap = false;
    this.sticky = false;
    this.root.hidden = true;
    if (this.G.input) this.G.input.closeWheel();
    if (!confirm && !silent) this.G.events.emit('ui:sound', { name: 'back' });
  }

  /** Kurz angetippt: offen lassen. Touch: Felder antippen (Zeiger aus); sonst Maus/Stick + Klick bzw. Taste. */
  _setSticky(touch) {
    this.sticky = true;
    this.tap = !!touch;
    toggle(this.root, 'is-tap', this.tap);
    this._select(-1);
    if (this.tap) toggle(this.ptr, 'is-on', false);
    const key = this.G.input.label('befehl');
    setText(this.footEl, this.tap ? 'Befehl antippen. Mitte schließt.' : `Wählen, Klick${key ? ` oder ${key}` : ''} bestätigt.`);
  }

  _select(i) {
    if (i === this.sel) return;
    if (this.sel >= 0) { this.segs[this.sel].classList.remove('is-sel'); this.items[this.sel].classList.remove('is-sel'); }
    this.sel = i;
    if (i >= 0) {
      this.segs[i].classList.add('is-sel');
      this.items[i].classList.add('is-sel');
      const id = WHEEL[i];
      setText(this.titleEl, id === 'formation' ? `Formation ${FORMATION_LABELS[FORMATIONS[this._formIdx]]}` : ORDER_DEFS[id].label);
      setText(this.hintEl, ORDER_DEFS[id].hint);
      this.G.events.emit('ui:sound', { name: 'hover' });
    } else {
      setText(this.titleEl, 'Befehl');
      setText(this.hintEl, 'Mitte: abbrechen');
    }
  }

  _updateCount() {
    const now = performance.now();
    if (now - (this._countAt || 0) < 250) return;
    this._countAt = now;
    const n = this._allies().length;
    setText(this.countEl, n ? `${n} ${n === 1 ? 'Bot' : 'Bots'} in Reichweite` : 'Keine Bots in Reichweite');
    toggle(this.countEl, 'is-none', !n);
  }

  /** Verbündete Bots in Reichweite (offline/Host: KI-Bots, Client: Puppen der Host-Bots) plus bereits befehligte. */
  _allies() {
    const G = this.G;
    const p = G.player;
    if (!p) return [];
    if (G.bots && typeof G.bots.orderableNear === 'function' && !this._client()) {
      const set = new Set(G.bots.orderableNear(p, ORDER_RADIUS));
      for (const b of G.bots.commandedBy(p)) set.add(b);
      return [...set];
    }
    const r2 = ORDER_RADIUS * ORDER_RADIUS;
    return G.actors.filter((a) => a !== p && a.isBot && a.alive && a.team === p.team && a.position.distanceToSquared(p.position) <= r2);
  }

  _client() {
    const N = this.G.net;
    return !!(N && N.online && N.role === 'client');
  }

  _confirm(i) {
    const id = WHEEL[i];
    this.close(true);
    this.issue(id);
  }

  /**
   * Befehl erteilen (auch für Tests): id = Befehl, opts.formation erzwingt eine Form, opts.point/target ersetzen das
   * Fadenkreuz. → Anzahl der Bots (Client: geschätzt aus den Verbündeten in Reichweite).
   */
  issue(id, opts = {}) {
    const G = this.G;
    const p = G.player;
    const def = ORDER_DEFS[id];
    if (!def || !p || !p.team) return 0;
    let formation = null;
    if (id === 'formation') {
      formation = FORMATIONS.includes(opts.formation) ? opts.formation : FORMATIONS[this._formIdx];
      this._formIdx = (FORMATIONS.indexOf(formation) + 1) % FORMATIONS.length;
    }
    let point = opts.point || null;
    let target = opts.target || null;
    if (def.point && !point && !target) ({ point, target } = this._aim());
    let n = 0;
    if (this._client()) {
      const pt = point || (target ? target.position : null);
      G.net.send(1, {
        t: 'order', order: id, formation,
        point: pt ? [Math.round(pt.x * 100) / 100, Math.round(pt.y * 100) / 100, Math.round(pt.z * 100) / 100] : null,
        target: target && Number.isInteger(target.netId) ? target.netId : 0,
      });
      n = this._allies().length;
    } else if (G.bots && typeof G.bots.issueOrder === 'function') {
      n = G.bots.issueOrder({ leader: p, order: id, point, target, formation });
    }
    const label = id === 'formation' ? `Formation ${FORMATION_LABELS[formation]}` : def.label;
    if (n > 0) {
      this._notify(`Befehl: ${label} (${n} ${n === 1 ? 'Bot' : 'Bots'})`, id === 'free' ? 'dim' : 'ally');
      G.events.emit('ui:sound', { name: 'confirm' });
      if (MARK_TEXT[id]) this._mark(id, target || null, point || (target ? target.position : null), def.dur);
      else if (id === 'free' || id === 'hold' || LEADER_ORDERS.has(id)) this.clearMarks(); // neue Befehle ersetzen Markierungen
      if (G.input) G.input.vibrate(14);
    } else {
      this._notify('Keine verbündeten Bots in Reichweite.', 'dim');
      G.events.emit('ui:sound', { name: 'error' });
    }
    return n;
  }

  _notify(text, tone) {
    if (typeof this.hooks.notice === 'function') this.hooks.notice(text, tone);
  }

  /**
   * Punkt unter dem Fadenkreuz (Weltstrahl aus dem Auge) und Gegner im Fadenkreuz (Zielhilfe bzw. nächster Feind am
   * Strahl vor der ersten Wand, ≤ 1,4 m daneben). → { point, target }
   */
  _aim() {
    const G = this.G;
    const p = G.player;
    p.getEyePosition(_eye);
    if (typeof p.getAimDirection === 'function') p.getAimDirection(_dir); else _dir.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    _dir.normalize();
    const hit = G.world && typeof G.world.raycast === 'function' ? G.world.raycast(_eye, _dir, 250) : null;
    const far = hit ? hit.distance : 120;
    let target = null;
    const aimT = G.input && G.input.aimTarget;
    if (aimT && aimT.alive && G.combat && G.combat.isHostile(p, aimT)) target = aimT;
    if (!target && G.combat) {
      let best = Infinity;
      for (const a of G.actors) {
        if (!a.alive || a === p || a.isStreakEntity || !G.combat.isHostile(p, a)) continue;
        _v.copy(a.position); _v.y += 1.1;
        const t = _w.subVectors(_v, _eye).dot(_dir);
        if (t < 2 || t > far + 1) continue;
        const off = _w.copy(_dir).multiplyScalar(t).add(_eye).distanceTo(_v);
        if (off < 1.4 + t * 0.01 && off < best) { best = off; target = a; }
      }
    }
    let point;
    if (hit) point = hit.point.clone().addScaledVector(hit.normal, 0.4);
    else point = _eye.clone().addScaledVector(_dir, 60).setY(p.position.y);
    return { point, target };
  }

  /* ------------------------------------------------------------ Markierungen */

  _mark(kind, target, point, life) {
    this.clearMarks();
    if (!point && !target) return;
    const n = el('div', `cw-mark is-${MARK_TONE[kind]}`, `<div class="cw-mark-d">${ICONS[kind]}</div><span></span>`);
    this.marks.appendChild(n);
    this._marks.push({ n, d: n.querySelector('span'), kind, target, pos: (point || target.position).clone(), t: Math.min(life || 60, 300), x: null, y: null, dist: null });
  }

  clearMarks() {
    for (const m of this._marks) m.n.remove();
    this._marks.length = 0;
  }

  _updateMarks(dt) {
    if (!this._marks.length) return;
    const G = this.G;
    const cam = G.camera;
    const p = G.player;
    const vw = window.innerWidth, vh = window.innerHeight;
    const lens = G.renderer && G.renderer.lens;
    for (let i = this._marks.length - 1; i >= 0; i--) {
      const m = this._marks[i];
      m.t -= dt;
      // Ende: abgelaufen, Ziel tot, offline keine Bots mehr mit diesem Befehl
      let done = m.t <= 0 || (m.target && !m.target.alive) || !cam || !p;
      if (!done && !this._client() && G.bots && typeof G.bots.commandedBy === 'function' && (this._chkAt = (this._chkAt || 0) + dt) > 0.5) {
        this._chkAt = 0;
        done = !G.bots.commandedBy(p).some((b) => b.command && b.command.kind === m.kind);
      }
      if (done) { m.n.remove(); this._marks.splice(i, 1); continue; }
      if (m.target) m.pos.copy(m.target.position);
      _v.copy(m.pos); _v.y += 1.6;
      _w.copy(_v).applyMatrix4(cam.matrixWorldInverse);
      const behind = _w.z > 0;
      _v.project(cam);
      if (!behind && lens && typeof lens.toScreen === 'function') lens.toScreen(_v);
      let x = (_v.x * 0.5 + 0.5) * vw, y = (-_v.y * 0.5 + 0.5) * vh;
      if (behind) { x = vw - x; y = vh - 60; }
      const edge = behind || x < 40 || x > vw - 40 || y < 70 || y > vh - 50;
      x = Math.round(clamp(x, 40, vw - 40));
      y = Math.round(clamp(y, 70, vh - 50));
      if (m.x !== x || m.y !== y) { m.x = x; m.y = y; setStyle(m.n, 'transform', `translate(${x}px, ${y}px)`); }
      toggle(m.n, 'is-edge', edge);
      const d = Math.round(p.position.distanceTo(m.pos));
      if (d !== m.dist) { m.dist = d; setText(m.d, `${MARK_TEXT[m.kind]} · ${meters(d)}`); }
    }
  }
}

const LEADER_ORDERS = new Set(['follow', 'regroup', 'formation']);
