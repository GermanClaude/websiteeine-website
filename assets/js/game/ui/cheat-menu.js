// NULLPUNKT — Nur Messer: Oberfläche des Cheat-Menüs (Logik: ../cheats.js).
//
// • Tastenfolge Ziffernblock 1 → 2 → 3 → 4 (KeyboardEvent.code, auch ohne Num-Lock) innerhalb von 3 s, nur im laufenden
//   Match. Online prüft sie zuerst die Raum-Einstellung des Hosts („vom Host deaktiviert“).
// • Code-Feld: Zeiger-Sperre lösen (G.holdUi: der Verlust pausiert dann nicht, das Spiel läuft weiter), Eingabe genau
//   „NULLPUNKT“ → Menü; falsch → kurze Meldung, Feld zu. Esc oder ein Klick ins Spiel (holt die Sperre zurück) schließt.
// • Menü: Schalter im Stil des HUD; erneutes Öffnen mit derselben Folge ohne Code (bis zum Matchende).
// • Gegner-Markierungen: Raute + Entfernung über jedem Gegner, auch durch Wände – Abbildung wie die Ziel-Marker des HUD
//   (camera.project + renderer.lens.toScreen, Fischauge der Körperkamera).
// Eigene Styles (einmal je Seite eingefügt), damit game.css unberührt bleibt; dazu das Symbol der Punktetabelle (.sb-cheat,
// Zeile .is-cheat kürzt den Namen).

import * as THREE from 'three';
import { esc } from './dom.js';
import { ICON } from './icons.js';

const SEQ = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];
const SEQ_MS = 3000;
const NOTICE_LIFE = 2.4;
const MARK_MARGIN = 14; // px Rand: Markierungen außerhalb werden ausgeblendet
const MARK_LIFT = 10; // px über dem Ankerpunkt: das Namensschild des Gegners (Kopf + 0,36 m, bots/manager.js) bleibt lesbar

const _w = new THREE.Vector3();
const _v = new THREE.Vector3();

const CSS = `
/* Markierungen unter dem HUD (#hud z-index 10): Kompass, Punktestand und Meldungen liegen darüber */
.cm-layer { position: absolute; inset: 0; z-index: 9; pointer-events: none; overflow: hidden; font-family: var(--font-hud); }
.cm-mk { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--np-enemy); font: 700 12px/1 var(--font-hud); letter-spacing: .04em; text-shadow: 0 1px 2px rgba(0, 0, 0, .85); will-change: transform; }
.cm-mk i { display: block; width: 10px; height: 10px; border: 2px solid currentColor; background: rgba(255, 59, 59, .28); transform: rotate(45deg); box-shadow: 0 0 6px rgba(255, 59, 59, .55); }
.cm-mk span { color: #ffd2cd; font-variant-numeric: tabular-nums; }
.cm-dlg { position: absolute; z-index: 28; right: max(16px, env(safe-area-inset-right)); top: 50%; transform: translateY(-50%); width: min(400px, calc(100vw - 32px)); max-height: calc(100% - 24px); overflow: auto; padding: 11px 14px; border: 1px solid var(--np-line-strong); border-left: 3px solid var(--np-signal); background: rgba(10, 11, 13, .92); color: var(--np-ink); font-family: var(--font-hud); pointer-events: auto; box-shadow: 0 8px 28px rgba(0, 0, 0, .45); animation: cm-in .22s var(--ease-out); user-select: none; -webkit-user-select: none; }
@keyframes cm-in { from { opacity: 0; transform: translate(8px, -50%); } }
.cm-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
.cm-head > div { flex: 1; min-width: 0; }
.cm-head b { display: block; font: 700 19px/1.1 var(--font-display); letter-spacing: .02em; text-transform: uppercase; }
.cm-head b em { color: var(--np-signal); font-style: normal; }
.cm-head small { display: block; margin-top: 3px; color: var(--np-ink-2); font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
.cm-x { flex: none; width: 30px; height: 30px; padding: 6px; border: 1px solid var(--np-line-strong); background: transparent; color: var(--np-ink-2); cursor: pointer; }
.cm-x:hover, .cm-x:focus-visible { color: var(--np-ink); border-color: var(--np-ink); outline: none; }
.cm-x svg { display: block; width: 100%; height: 100%; }
.cm-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; border-top: 1px solid var(--np-line); }
.cm-row > span { flex: 1; min-width: 0; }
.cm-row b { display: block; font: 700 16px/1.15 var(--font-hud); letter-spacing: .04em; }
.cm-row small { display: block; color: var(--np-ink-2); font: 500 13px/1.2 var(--font-hud); }
.cm-sw { flex: none; appearance: none; position: relative; width: 46px; height: 26px; border: 1px solid var(--np-line-strong); border-radius: 13px; background: rgba(233, 230, 223, .06); cursor: pointer; }
.cm-sw i { position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--np-ink-2); transition: transform .16s var(--ease-out), background-color .16s; }
.cm-sw[aria-checked="true"] { background: var(--np-signal-soft); border-color: var(--np-signal); }
.cm-sw[aria-checked="true"] i { transform: translateX(20px); background: var(--np-signal); }
.cm-sw:focus-visible { outline: 2px solid var(--np-ink); outline-offset: 2px; }
.cm-note { display: flex; gap: 7px; align-items: flex-start; margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--np-line); color: var(--np-ink-2); font: 500 13px/1.3 var(--font-hud); }
.cm-note svg { flex: none; width: 15px; height: 15px; margin-top: 1px; color: var(--np-gold); }
.cm-code input { display: block; width: 100%; margin: 4px 0 6px; padding: 9px 11px; border: 1px solid var(--np-line-strong); background: rgba(233, 230, 223, .05); color: var(--np-ink); font: 700 20px/1.1 var(--font-mono); letter-spacing: .18em; outline: none; user-select: text; -webkit-user-select: text; }
.cm-code input:focus { border-color: var(--np-signal); }
.cm-caps { min-height: 1.2em; margin: 0; color: var(--np-dim); font: 600 12px var(--font-hud); letter-spacing: .08em; text-transform: uppercase; }
.cm-caps.is-on { color: var(--np-ok); }
@media (max-height: 480px) { .cm-row small { display: none; } .cm-row { padding: 4px 0; } }
@media (max-height: 360px) { .cm-note { display: none; } }
.sb-cheat { display: inline-block; width: 13px; height: 13px; margin-left: 5px; vertical-align: -2px; color: var(--np-gold); }
.sb-cheat svg { display: block; width: 100%; height: 100%; }
/* Zeile mit Symbol: Name kürzen (…), damit Symbol und Abzeichen in schmalen Tabellen nicht über die Punkte-Spalte ragen –
   mindestens drei Zeichen bleiben lesbar */
.sb-row.is-cheat .sb-n { max-width: max(36px, min(140px, calc(100% - 80px))); }
`;

let styleEl = null;
function ensureStyle() {
  if (styleEl && styleEl.isConnected) return;
  styleEl = document.createElement('style');
  styleEl.id = 'np-cheat-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
}

export class CheatMenu {
  constructor(sys) {
    this.sys = sys;
    this.G = sys.G;
    /** null | 'code' | 'menu' – was gerade offen ist. */
    this.view = null;
    this.layer = null;
    this.dlg = null;
    this._seq = null; // { n, t0 }
    this._marks = []; // Pool { n, d, dist, x, y }
    this._onKey = (e) => this._key(e);
  }

  attach(scope) {
    ensureStyle();
    window.addEventListener('keydown', this._onKey, true);
    // Klick ins Spiel holt die Zeiger-Sperre zurück → Fenster zu; Pause/Ende/Lobby → zu
    scope.on('input:lock', ({ locked }) => { if (locked && this.view) this.close(false); });
    scope.on('match:state', ({ state }) => {
      if (state === 'playing') return;
      if (this.view) this.close(false);
      if (!this.G.match.netLive) this.hideMarkers(); // online läuft das Match im Pausenmenü weiter
    });
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    this.close(false);
    if (this.layer) this.layer.remove();
    this.layer = null;
    this._marks.length = 0;
  }

  /* ------------------------------------------------------------ Tastenfolge */

  _key(e) {
    if (e.repeat) return;
    const G = this.G;
    if (this.view && e.code === 'Escape') {
      e.preventDefault();
      if (G.input && typeof G.input.consume === 'function') G.input.consume('pause'); // Esc schließt nur das Fenster
      this.close(true);
      return;
    }
    const i = SEQ.indexOf(e.code);
    if (i < 0) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    // Zeitpunkt des Tastendrucks selbst (nicht der Verarbeitung): auf langsamen Geräten kommen die Ereignisse verspätet an
    const now = e.timeStamp > 0 ? e.timeStamp : performance.now();
    if (i === 0) this._seq = { n: 1, t0: now };
    else if (this._seq && this._seq.n === i && now - this._seq.t0 <= SEQ_MS) this._seq.n++;
    else this._seq = null;
    if (!this._seq || this._seq.n < SEQ.length) return;
    this._seq = null;
    e.preventDefault();
    this.request();
  }

  /** Folge erkannt: Code-Feld bzw. (schon freigeschaltet) Menü öffnen – nur im laufenden Match, online nur mit Erlaubnis. */
  request() {
    const G = this.G;
    if (G.match.state !== 'playing' || !G.mode || G.mode.cheats !== this.sys || (G.xr && G.xr.presenting)) return false;
    if (!this.sys.allowed().ok) { this.notice('Cheat-Menü vom Host deaktiviert', 'enemy'); return false; }
    if (this.view === 'menu') { this.close(true); return true; }
    this.open(this.sys.unlocked ? 'menu' : 'code');
    return true;
  }

  /* ------------------------------------------------------------ Fenster */

  _root() {
    const host = document.getElementById('game-root') || document.body;
    if (!this.layer || !this.layer.isConnected) {
      this.layer = document.createElement('div');
      this.layer.className = 'cm-layer';
      this.layer.setAttribute('aria-hidden', 'true');
      host.appendChild(this.layer);
    }
    return host;
  }

  open(view) {
    const G = this.G;
    const host = this._root();
    if (this.dlg) this.dlg.remove();
    const d = (this.dlg = document.createElement('div'));
    d.className = `cm-dlg ${view === 'code' ? 'cm-code' : 'cm-menu'}`;
    d.setAttribute('role', 'dialog');
    d.dataset.cheat = view;
    if (view === 'code') {
      d.setAttribute('aria-label', 'Code eingeben');
      d.innerHTML = `<div class="cm-head"><div><b>Code<em>.</em></b><small>Nur Messer · Cheat-Menü</small></div>` +
        `<button type="button" class="cm-x" data-cm-close aria-label="Schließen">${ICON.close}</button></div>` +
        '<input type="text" data-cm-code maxlength="16" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Code">' +
        '<p class="cm-caps" data-cm-caps>Eingabe bestätigen · Esc bricht ab</p>';
    } else {
      d.setAttribute('aria-label', 'Cheat-Menü');
      d.innerHTML = `<div class="cm-head"><div><b>Cheat-Menü<em>.</em></b><small>Nur Messer · gilt für dieses Match</small></div>` +
        `<button type="button" class="cm-x" data-cm-close aria-label="Schließen">${ICON.close}</button></div>` +
        this.sys.list.map((c) => `<div class="cm-row"><span><b>${esc(c.label)}</b><small>${esc(c.sub)}</small></span>` +
          `<button type="button" class="cm-sw" role="switch" data-cheat-id="${esc(c.id)}" aria-checked="${!!this.sys.on[c.id]}" aria-label="${esc(c.label)}"><i></i></button></div>`).join('') +
        `<p class="cm-note">${ICON.crosshair}<span>Aktive Schalter sehen alle als Symbol in der Punktetabelle. Esc oder ein Klick ins Spiel schließt.</span></p>`;
    }
    d.addEventListener('click', (e) => this._click(e));
    d.addEventListener('mousedown', (e) => e.stopPropagation()); // Klicks im Fenster sind keine Schüsse/Stiche
    host.appendChild(d);
    this.view = view;
    if (typeof G.holdUi === 'function') G.holdUi(true);
    if (G.input) G.input.exitLock();
    const inp = d.querySelector('[data-cm-code]');
    if (inp) {
      inp.addEventListener('keydown', (e) => this._codeKey(e, inp));
      inp.addEventListener('keyup', (e) => this._caps(e));
      setTimeout(() => { if (this.dlg === d) inp.focus({ preventScroll: true }); }, 0);
    } else {
      const first = d.querySelector('.cm-sw');
      if (first) setTimeout(() => { if (this.dlg === d) first.focus({ preventScroll: true }); }, 0);
    }
    if (G.events) G.events.emit('ui:sound', { name: 'confirm' });
  }

  /**
   * Fenster schließen. relock: Zeiger-Sperre zurückholen (in der Geste von Eingabe/Klick; Esc ist keine Geste – lehnt der
   * Browser ab, kommt 'input:lock' mit error: keine Pause, nur „Klicken, um weiterzuspielen“, das Match läuft weiter).
   */
  close(relock = false) {
    const G = this.G;
    const was = this.view;
    if (this.dlg) this.dlg.remove();
    this.dlg = null;
    this.view = null;
    if (!was) return;
    if (typeof G.holdUi === 'function') G.holdUi(false);
    else if (G.match) G.match.uiHold = false;
    if (relock && G.input && G.match.state === 'playing') { try { G.input.requestLock(); } catch { /* ohne Geste abgelehnt */ } }
  }

  _click(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-cm-close')) { this.close(true); return; }
    const id = t.dataset.cheatId;
    if (id) {
      this.sys.toggle(id);
      if (this.G.events) this.G.events.emit('ui:sound', { name: 'toggle' });
    }
  }

  _caps(e) {
    const el = this.dlg && this.dlg.querySelector('[data-cm-caps]');
    if (!el || typeof e.getModifierState !== 'function') return;
    const on = e.getModifierState('CapsLock');
    el.classList.toggle('is-on', on);
    el.textContent = on ? 'Feststelltaste an · Eingabe bestätigen' : 'Eingabe bestätigen · Esc bricht ab';
  }

  _codeKey(e, inp) {
    this._caps(e);
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    this.submit(inp.value);
  }

  /** Code prüfen (genau „NULLPUNKT“, cheats.js CHEAT_CODE). → true, wenn freigeschaltet. */
  submit(value) {
    if (!this.sys.checkCode(value)) {
      this.close(true);
      this.notice('Falscher Code', 'enemy');
      return false;
    }
    this.sys.unlocked = true;
    this.open('menu');
    this.notice('Cheat-Menü freigeschaltet', 'gold');
    return true;
  }

  /** Schalter im offenen Menü an den Zustand angleichen. */
  sync() {
    if (!this.dlg || this.view !== 'menu') return;
    for (const b of this.dlg.querySelectorAll('[data-cheat-id]')) b.setAttribute('aria-checked', String(!!this.sys.on[b.dataset.cheatId]));
  }

  /** Kurze Meldung über die Hinweiszeile des HUD. */
  notice(text, tone = '') {
    const h = this.G.hud;
    if (h && typeof h._notice === 'function') { try { h._notice(text, tone, null, NOTICE_LIFE, 'cheat'); } catch { /* HUD nicht bereit */ } }
  }

  /* ------------------------------------------------------------ Markierungen */

  hideMarkers() {
    for (const m of this._marks) if (!m.hidden) { m.hidden = true; m.n.hidden = true; }
  }

  /** Raute + Entfernung über jedem Akteur der Liste (Welt → Bildschirm wie hud._project). */
  updateMarkers(list, p) {
    const G = this.G;
    const cam = G.camera;
    this._root();
    if (!cam) { this.hideMarkers(); return; }
    cam.updateMatrixWorld();
    const lens = G.renderer && G.renderer.lens;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    let used = 0;
    for (const a of list) {
      const h = a.body ? a.body.height : 1.8;
      _v.copy(a.position);
      _v.y += h + 0.28;
      _w.copy(_v).applyMatrix4(cam.matrixWorldInverse);
      if (_w.z > 0) continue; // hinter der Kamera
      _v.project(cam);
      if (lens && typeof lens.toScreen === 'function') lens.toScreen(_v);
      let x = (_v.x * 0.5 + 0.5) * vw;
      let y = (-_v.y * 0.5 + 0.5) * vh;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < MARK_MARGIN || x > vw - MARK_MARGIN || y < MARK_MARGIN || y > vh - MARK_MARGIN) continue;
      let m = this._marks[used];
      if (!m) {
        const n = document.createElement('div');
        n.className = 'cm-mk';
        n.innerHTML = '<i></i><span></span>';
        this.layer.appendChild(n);
        m = this._marks[used] = { n, d: n.lastChild, dist: -1, x: null, y: null, hidden: false };
      }
      used++;
      if (m.hidden) { m.hidden = false; m.n.hidden = false; }
      x = Math.round(x * dpr) / dpr;
      y = Math.round(y * dpr) / dpr;
      if (m.x !== x || m.y !== y) { m.x = x; m.y = y; m.n.style.transform = `translate(${x}px, ${y - MARK_LIFT}px) translate(-50%, -100%)`; }
      const dist = Math.round(p.position.distanceTo(a.position));
      if (dist !== m.dist) { m.dist = dist; m.d.textContent = `${dist} m`; }
      m.n.dataset.actor = a.id || '';
    }
    for (let i = used; i < this._marks.length; i++) {
      const m = this._marks[i];
      if (!m.hidden) { m.hidden = true; m.n.hidden = true; }
    }
  }

  /** Sichtbare Markierungen (Tests): [{ id, x, y, text }]. */
  visibleMarkers() {
    return this._marks.filter((m) => !m.hidden).map((m) => ({ id: m.n.dataset.actor, x: m.x, y: m.y, text: m.d.textContent }));
  }
}
