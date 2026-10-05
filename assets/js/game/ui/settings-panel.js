// NULLPUNKT — Einstellungen wie in einem PC-Spiel: Reiter Steuerung · Belegung · Grafik · Erweitert · Audio · HUD ·
// Profil · Spiel. Jede Änderung wirkt sofort (settings.set), synchron mit anderen Tabs/der Website. Die Seiten liegen
// in ui/settings/ (je Reiter ein Modul); dieses Modul baut Reiter, Fußzeile („Standard für …“, Hinweise mit „Rückgängig“) und reicht
// Änderungen an die offene Seite weiter. Bedienbar per Touch (667 × 375), Maus, Tastatur und Gamepad (menus.js:
// LB/RB = Reiter, Steuerkreuz = Fokus, links/rechts = Werte).

import { esc } from './dom.js';
import { ICON } from './icons.js';
import { controlsPage } from './settings/controls-page.js';
import { bindingsPage } from './settings/bindings-page.js';
import { displayPage } from './settings/display-page.js';
import { graphicsPage } from './settings/graphics-page.js';
import { hudPage } from './settings/hud-page.js';
import { schemaPage } from './settings/schema-page.js';

const TABS = [
  ['steuerung', 'Steuerung', ICON.sliders, controlsPage],
  ['belegung', 'Belegung', ICON.keyboard, bindingsPage],
  ['grafik', 'Grafik', ICON.eye, displayPage],
  ['erweitert', 'Erweitert', ICON.chip, graphicsPage],
  ['audio', 'Audio', ICON.sound, schemaPage('audio')],
  ['hud', 'HUD', ICON.crosshair, hudPage],
  ['profil', 'Profil', ICON.user, schemaPage('profil')],
  ['spiel', 'Spiel', ICON.bot, schemaPage('spiel')],
];
const TOAST_LIFE = 7000;

export class SettingsPanel {
  constructor(G) {
    this.G = G;
    this.root = null;
    this.group = 'steuerung';
    /** Menüs (für Touch-Editor und Gamepad-Sperre während der Tastenerfassung) – setzt menus.js. */
    this.menus = null;
    this.page = null;
    this._off = null;
    this._state = {}; // Seitenzustand über Neuaufbauten hinweg (z. B. gewähltes Gerät in „Belegung“)
    this._scroll = {};
    this._toastT = 0;
    this._lastPointer = 'mouse';
  }

  /** Baut das Panel in `host`. */
  mount(host) {
    const S = this.G.settings;
    if (!TABS.find(([g]) => g === this.group)) this.group = 'steuerung';
    const root = document.createElement('div');
    root.className = 'sp';
    root.innerHTML = `
      <div class="m-tabs sp-tabs m-scroll-x" role="tablist" data-scrollable>${TABS.map(([g, label, icon]) => `<button type="button" class="m-tab" role="tab" data-g="${g}" aria-selected="${g === this.group}">${icon}<span>${esc(label)}</span></button>`).join('')}</div>
      <div class="sp-body m-scroll" data-scrollable><div class="sp-page"></div></div>
      <div class="sp-foot">
        <button type="button" class="m-btn m-ghost sp-reset">${ICON.restart}<span>Standard für „<b></b>“</span></button>
        <div class="sp-toast" role="status" aria-live="polite" hidden><span></span><button type="button" class="m-btn m-ghost sp-undo" hidden>${ICON.undo}<span>Rückgängig</span></button></div>
        <span class="sp-note">${S.persistent ? 'Wird auf diesem Gerät gespeichert.' : 'Speicher gesperrt: gilt nur bis zum Neuladen.'}</span>
      </div>`;
    host.appendChild(root);
    this.root = root;
    this.body = root.querySelector('.sp-body');
    this.host = root.querySelector('.sp-page');
    root.querySelector('.sp-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (b && b.dataset.g !== this.group) this.openTab(b.dataset.g);
    });
    // Randverlauf der Reiterleiste nur, solange rechts noch Reiter verborgen sind
    const tabs = root.querySelector('.sp-tabs');
    const edge = () => tabs.classList.toggle('is-end', tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 2);
    tabs.addEventListener('scroll', edge, { passive: true });
    requestAnimationFrame(edge);
    root.querySelector('.sp-reset').addEventListener('click', () => this._reset());
    root.querySelector('.sp-undo').addEventListener('click', () => {
      const u = this._undo;
      this._hideToast();
      if (u) { u(); this.G.events.emit('ui:sound', { name: 'back' }); }
    });
    root.addEventListener('pointerdown', (e) => { this._lastPointer = e.pointerType || 'mouse'; }, true);
    this._render();
    this._off = S.onChange((key) => { if (this.page && this.page.sync) this.page.sync(key); });
    return root;
  }

  unmount() {
    if (this._off) this._off();
    this._off = null;
    this._unmountPage();
    this._hideToast();
    if (this.root) this.root.remove();
    this.root = null;
  }

  /** Reiter wechseln (auch von Seiten aus, z. B. Grafik → Erweitert). */
  openTab(group) {
    if (!this.root || !TABS.find(([g]) => g === group)) return;
    this._scroll[this.group] = this.body.scrollTop;
    this.group = group;
    this.root.querySelectorAll('.sp-tabs [data-g]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.g === group)));
    const tab = this.root.querySelector(`.sp-tabs [data-g="${group}"]`);
    if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this._render();
    this.G.events.emit('ui:sound', { name: 'click' });
  }

  _ctx() {
    const G = this.G;
    return {
      G,
      settings: G.settings,
      schema: G.settings.schema,
      state: this._state,
      sound: (name) => G.events.emit('ui:sound', { name }),
      toast: (text, tone, undo) => this.toast(text, tone, undo),
      openTab: (g) => this.openTab(g),
      openTouchEditor: () => this._openTouchEditor(),
      refreshReset: () => this._syncResetLabel(),
      mutePad: (ms) => { if (this.menus && this.menus.mutePad) this.menus.mutePad(ms); },
      /** Zeigerart der letzten Berührung im Panel ('mouse' | 'touch' | 'pen'). */
      pointer: () => this._lastPointer,
    };
  }

  _unmountPage() {
    if (this.page && this.page.unmount) this.page.unmount();
    this.page = null;
  }

  _render() {
    this._unmountPage();
    const tab = TABS.find(([g]) => g === this.group) || TABS[0];
    const ctx = this._ctx();
    this.page = tab[3](ctx);
    this.host.replaceChildren();
    this.host.dataset.page = tab[0];
    this.page.mount(this.host);
    this._syncResetLabel();
    this.body.scrollTop = this._scroll[this.group] || 0;
  }

  _syncResetLabel() {
    const tab = TABS.find(([g]) => g === this.group);
    const label = (this.page && this.page.resetLabel) || (tab ? tab[1] : '');
    this.root.querySelector('.sp-reset b').textContent = label;
  }

  _reset() {
    const S = this.G.settings;
    const page = this.page;
    if (!page) return;
    if (typeof page.reset === 'function') page.reset();
    else {
      const patch = {};
      for (const k of page.keys || []) patch[k] = S.defaults[k];
      S.patch(patch);
    }
    this._syncResetLabel();
    this.G.events.emit('ui:sound', { name: 'back' });
  }

  _openTouchEditor() {
    this._scroll[this.group] = this.body ? this.body.scrollTop : 0;
    if (this.menus && typeof this.menus.showTouchEditor === 'function') this.menus.showTouchEditor();
  }

  /** Kurzer Hinweis in der Fußzeile, optional mit „Rückgängig“. tone: info | warn */
  toast(text, tone = 'info', undo = null) {
    if (!this.root) return;
    const t = this.root.querySelector('.sp-toast');
    t.hidden = false;
    t.dataset.tone = tone || 'info';
    t.querySelector('span').textContent = text;
    const u = t.querySelector('.sp-undo');
    u.hidden = typeof undo !== 'function';
    this._undo = typeof undo === 'function' ? undo : null;
    this.root.classList.add('has-toast');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this._hideToast(), TOAST_LIFE);
    this._syncResetLabel();
  }

  _hideToast() {
    clearTimeout(this._toastT);
    this._undo = null;
    if (!this.root) return;
    const t = this.root.querySelector('.sp-toast');
    if (t) t.hidden = true;
    this.root.classList.remove('has-toast');
  }
}
