// NULLPUNKT — Vollbild-Oberfläche: Umschalter im Lobby-Kopf (.lb-tools) und im Pausenmenü (.ps-menu), Knopf im
// Drehen-Hinweis und die Anleitung „Als App spielen“ (.np-fsg) für Plattformen ohne Element-Vollbild (iPhone,
// App-Browser, eingebettet, abgelehnt). Wird per MutationObserver in #menu-root eingesetzt – lobby.js/menus.js
// bleiben unberührt; Klicks laufen über einen eigenen Listener (data-fs). Logik: engine/fullscreen.js (G.fullscreen) oder,
// falls dieses Modul nicht geladen werden konnte, der kleine Ersatz aus main.js (opts.fs; nur Umschalter, keine Anleitung).

import { codeLabel } from '../../shared/bindings.data.js';

const GUIDE_FLAG = 'nullpunkt:fullscreenGuide';

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IC = {
  expand: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  compress: svg('<path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  share: svg('<path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M7 11H5.5v9.5h13V11H17"/>'),
  addHome: svg('<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  dots: svg('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.5"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>'),
  install: svg('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>'),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pageUrl = () => location.href.split('#')[0];

export class FullscreenUI {
  /** opts.autoShow: Anleitung beim ersten Lobby-Besuch einmal zeigen (nicht in Testläufen). opts.fs: Ersatz statt G.fullscreen. */
  constructor(G, { autoShow = true, fs = null } = {}) {
    this.G = G;
    this.fs = G.fullscreen || fs;
    this.root = document.getElementById('menu-root');
    this.guide = null;
    this._prevFocus = null;
    this._off = [];
    if (!this.fs) return;
    this._mo = new MutationObserver(() => this._inject());
    if (this.root) this._mo.observe(this.root, { childList: true, subtree: true });
    const onClick = (e) => this._click(e);
    document.addEventListener('click', onClick);
    this._off.push(() => document.removeEventListener('click', onClick));
    const ev = G.events;
    const upd = () => this.refresh();
    // Automatik scheitert wiederholt (z. B. Android-App-Browser, eingebettet): Anleitung einmal von selbst zeigen –
    // nicht mitten ins laufende Match, sondern bei der nächsten Pause bzw. in der Lobby.
    const onErr = ({ user, blocked } = {}) => {
      if (user) { this.openGuide(); return; }
      this.refresh();
      if (blocked && autoShow) this._autoShowIdle();
    };
    ev.on('fullscreen:change', upd);
    ev.on('fullscreen:error', onErr);
    ev.on('input:mode', upd);
    this._off.push(() => { ev.off('fullscreen:change', upd); ev.off('fullscreen:error', onErr); ev.off('input:mode', upd); });
    this._off.push(this.fs.onInstallChange(() => { this.refresh(); if (this.guide) this._fillGuide(); }));
    if (autoShow) {
      const tryShow = ({ state } = {}) => {
        if (state !== 'lobby') return;
        ev.off('match:state', tryShow);
        setTimeout(() => this._autoShow(), 450); // nach dem Fokus der Lobby
      };
      if (G.match && G.match.state === 'lobby') tryShow({ state: 'lobby' });
      else ev.on('match:state', tryShow);
      this._off.push(() => ev.off('match:state', tryShow));
    }
    this._inject();
  }

  /** 'toggle' (Vollbild per API) | 'guide' (Anleitung) | null (als App gestartet: nichts nötig). */
  get variant() {
    const fs = this.fs;
    if (fs.supported && !fs.blocked && !(fs.standalone && this._touch())) return 'toggle';
    return fs.needsGuide ? 'guide' : null;
  }

  refresh() {
    document.querySelectorAll('[data-fs]').forEach((b) => this._render(b));
    this._inject();
  }

  dispose() {
    if (this._mo) this._mo.disconnect();
    this._off.forEach((f) => f());
    this._off = [];
    this.closeGuide();
  }

  /* ------------------------------------------------------------ Knöpfe */

  _touch() { return this.G.input ? this.G.input.mode === 'touch' : false; }

  _keyLabel() {
    const k = this.fs.keys[0];
    return k ? codeLabel(k) : 'Alt + Eingabe';
  }

  _inject() {
    const v = this.variant;
    const tools = document.querySelector('#menu-root .lb-tools');
    if (tools && !tools.querySelector('[data-fs]') && v) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-icon np-fs-btn';
      b.dataset.fsv = 'icon';
      tools.insertBefore(b, tools.querySelector('[data-act="exit"]') || null); // vor „Zur Website“: Einstellungen bleiben vorn
      this._render(b);
    }
    const menu = document.querySelector('#menu-root .ps-menu');
    if (menu && !menu.querySelector('[data-fs]') && v) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-btn np-fs-btn';
      b.dataset.fsv = 'menu';
      const resume = menu.querySelector('[data-act="resume"]');
      menu.insertBefore(b, resume ? resume.nextSibling : menu.firstChild);
      this._render(b);
    }
    // Drehen-Hinweis: dort, wo es kein Vollbild + Ausrichtungssperre gibt (iPhone), zur Anleitung führen
    const rot = document.querySelector('#rotate-overlay .rotate-actions');
    if (rot && !rot.querySelector('[data-fs]') && v === 'guide') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'np-btn np-fs-rot';
      b.dataset.fsv = 'rotate';
      rot.insertBefore(b, rot.querySelector('a') || null);
      this._render(b);
    }
  }

  _render(b) {
    const v = this.variant;
    if (!v) { b.remove(); return; }
    if (b.dataset.fsv === 'rotate' && v !== 'guide') { b.remove(); return; }
    const on = this.fs.active;
    b.dataset.fs = v;
    const key = this._keyLabel();
    if (v === 'toggle') {
      const label = on ? 'Vollbild beenden' : 'Vollbild';
      b.setAttribute('aria-pressed', String(on));
      b.title = this._touch() ? label : `${label} (${key})`;
      if (b.dataset.fsv === 'icon') {
        b.setAttribute('aria-label', b.title);
        b.innerHTML = on ? IC.compress : IC.expand;
      } else {
        b.removeAttribute('aria-label');
        b.innerHTML = `${on ? IC.compress : IC.expand}<span>${label}</span><kbd>${esc(key)}</kbd>`;
      }
    } else {
      const r = this.fs.reason;
      const label = r === 'in-app' ? 'Vollbild: im Browser öffnen' : r === 'iframe' ? 'Vollbild: in neuem Tab öffnen' : 'Vollbild einrichten';
      b.removeAttribute('aria-pressed');
      b.title = label;
      if (b.dataset.fsv === 'icon') { b.setAttribute('aria-label', label); b.innerHTML = IC.phone; }
      else if (b.dataset.fsv === 'menu') { b.removeAttribute('aria-label'); b.innerHTML = `${IC.phone}<span>${esc(label)}</span>`; }
      else { b.removeAttribute('aria-label'); b.textContent = label; }
    }
  }

  _click(e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-fs]') : null;
    if (!b) return;
    e.preventDefault();
    if (b.dataset.fs === 'toggle') {
      const was = this.fs.active || this.fs.pending;
      const ok = this.fs.toggle();
      if (!was && !ok) this.openGuide();
      this.G.events.emit('ui:sound', { name: 'click' });
    } else {
      this.G.events.emit('ui:sound', { name: 'click' });
      this.openGuide();
    }
  }

  /* ------------------------------------------------------------ Anleitung */

  _autoShowIdle() {
    const ev = this.G.events;
    const idle = (st) => st === 'lobby' || st === 'paused';
    if (idle(this.G.match && this.G.match.state)) { this._autoShow(); return; }
    if (this._idleWait) return;
    this._idleWait = ({ state } = {}) => {
      if (!idle(state)) return;
      ev.off('match:state', this._idleWait);
      this._idleWait = null;
      setTimeout(() => this._autoShow(), 300);
    };
    ev.on('match:state', this._idleWait);
    this._off.push(() => { if (this._idleWait) ev.off('match:state', this._idleWait); });
  }

  _autoShow() {
    if (!this.fs.needsGuide || this.fs.reason === 'blocked' || this.guide) return;
    let seen = false;
    try { seen = localStorage.getItem(GUIDE_FLAG) === '1'; } catch { /* privat/gesperrt */ }
    if (seen) return;
    try { localStorage.setItem(GUIDE_FLAG, '1'); } catch { /* */ }
    this.openGuide();
  }

  get guideOpen() { return !!this.guide; }

  openGuide() {
    if (this.guide) { this._fillGuide(); return; }
    const host = document.getElementById('game-root') || document.body;
    const g = document.createElement('div');
    g.className = 'np-fsg';
    g.setAttribute('role', 'dialog');
    g.setAttribute('aria-modal', 'true');
    g.setAttribute('aria-labelledby', 'np-fsg-title');
    g.innerHTML = '<div class="np-fsg-card" data-scrollable></div>';
    this._prevFocus = document.activeElement;
    host.appendChild(g);
    this.guide = g;
    if (this.G.input && this.G.input.locked) this.G.input.exitLock();
    g.addEventListener('click', (e) => this._guideClick(e));
    this._onKey = (e) => this._guideKey(e);
    window.addEventListener('keydown', this._onKey, true);
    this._fillGuide();
    const f = g.querySelector('[data-fsg="close"]');
    if (f) try { f.focus({ preventScroll: true }); } catch { /* */ }
  }

  closeGuide() {
    if (!this.guide) return;
    window.removeEventListener('keydown', this._onKey, true);
    this.guide.remove();
    this.guide = null;
    const p = this._prevFocus;
    this._prevFocus = null;
    if (p && p.isConnected && typeof p.focus === 'function') try { p.focus({ preventScroll: true }); } catch { /* */ }
  }

  _fillGuide() {
    const card = this.guide && this.guide.querySelector('.np-fsg-card');
    if (!card) return;
    const fs = this.fs;
    const P = fs.platform;
    const reason = fs.reason || 'none';
    const url = pageUrl();
    const share = `„Teilen“ ${IC.share}`;
    let kicker = 'Vollbild';
    let title = 'Vollbild nicht verfügbar';
    let lead = '';
    let steps = [];
    let note = '';
    const actions = [];
    if (fs.installAvailable) actions.push(`<button type="button" class="m-btn m-primary" data-fsg="install">${IC.install}<span>Als App installieren</span></button>`);

    if (reason === 'ios-no-api') {
      kicker = P.iPad ? 'iPad' : 'iPhone';
      title = 'Als App spielen';
      lead = `${P.iPad ? 'Dieses iPad erlaubt Webseiten kein Vollbild.' : 'Auf dem iPhone erlaubt iOS Webseiten kein Vollbild.'} Vom Home-Bildschirm gestartet läuft NULLPUNKT aber ohne Browserleisten – wie ein richtiges Spiel.`;
      if (P.iosBrowser === 'safari') {
        steps = [
          `Tippe auf ${share} – unten in der Leiste oder neben der Adresse; in neueren iOS-Versionen erst auf „…“ ${IC.dots}.`,
          `Wähle „Zum Home-Bildschirm“ ${IC.addHome} und tippe auf „Hinzufügen“. „Als Web-App öffnen“ bleibt eingeschaltet.`,
          'Starte NULLPUNKT über das neue Symbol auf dem Home-Bildschirm und halte das Gerät quer.',
        ];
      } else {
        steps = [
          `Tippe auf ${share} – je nach Browser in der Adressleiste oder im Menü ${IC.dots}.`,
          `Wähle „Zum Home-Bildschirm“ ${IC.addHome} (ab iOS 16.4). Fehlt der Eintrag: Link kopieren und in Safari öffnen.`,
          'Starte NULLPUNKT über das neue Symbol auf dem Home-Bildschirm und halte das Gerät quer.',
        ];
      }
      note = 'Ohne Home-Bildschirm geht es auch: einfach quer halten – nur die Browserleisten bleiben sichtbar.';
      actions.push(`<button type="button" class="m-btn" data-fsg="copy">${IC.copy}<span>Link kopieren</span></button>`);
    } else if (reason === 'in-app') {
      title = 'Im Browser öffnen';
      lead = 'Der Browser dieser App (z. B. Instagram, TikTok, Facebook) erlaubt kein Vollbild.';
      steps = P.ios ? [
        `Tippe auf „…“ ${IC.dots} oder ${share} der App.`,
        'Wähle „In Safari öffnen“ bzw. „Im Browser öffnen“.',
        `In Safari: ${share} → „Zum Home-Bildschirm“ – so läuft NULLPUNKT im Vollbild.`,
      ] : [
        `Tippe auf „⋮“ bzw. „…“ ${IC.dots} oben rechts.`,
        'Wähle „Im Browser öffnen“ bzw. „In Chrome öffnen“.',
        'Im Browser geht NULLPUNKT beim Tippen auf „Einsatz starten“ ins Vollbild.',
      ];
      if (P.android) {
        const u = new URL(url);
        const intent = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
        actions.unshift(`<a class="m-btn m-primary" data-fsg="intent" href="${esc(intent)}">${IC.external}<span>In Chrome öffnen</span></a>`);
      }
      actions.push(`<button type="button" class="m-btn" data-fsg="copy">${IC.copy}<span>Link kopieren</span></button>`);
    } else if (reason === 'iframe') {
      title = 'In eigenem Tab spielen';
      lead = 'NULLPUNKT ist hier in eine andere Seite eingebettet, die kein Vollbild erlaubt. Im eigenen Tab geht das Spiel mit „Einsatz starten“ ins Vollbild.';
      actions.unshift(`<a class="m-btn m-primary" href="${esc(url)}" target="_blank" rel="noopener">${IC.external}<span>In neuem Tab öffnen</span></a>`);
    } else {
      lead = reason === 'blocked' ? 'Dein Browser hat das Vollbild abgelehnt.' : 'Dieser Browser unterstützt kein Vollbild für Webseiten.';
      steps = this._touch() || P.ios || P.android
        ? ['Öffne NULLPUNKT in Chrome, Safari, Firefox, Edge oder Samsung Internet.']
        : [`Nutze das Vollbild des Browsers: ${P.mac ? '„ctrl + cmd + F“' : '„F11“'}.`];
      if (fs.installAvailable) steps.push('Oder installiere NULLPUNKT als App – sie startet randlos im Querformat.');
      actions.push(`<button type="button" class="m-btn" data-fsg="copy">${IC.copy}<span>Link kopieren</span></button>`);
    }
    actions.push(`<button type="button" class="m-btn${actions.some((a) => a.includes('m-primary')) ? '' : ' m-primary'}" data-fsg="close">${IC.check}<span>Verstanden</span></button>`);
    const hasCopy = actions.some((a) => a.includes('data-fsg="copy"'));
    card.innerHTML = `
      <div class="np-fsg-a">
        <div class="m-kicker">${esc(kicker)}</div>
        <h2 class="np-fsg-title" id="np-fsg-title">${esc(title)}<em>.</em></h2>
        <p class="np-fsg-lead">${esc(lead)}</p>
        ${note ? `<p class="np-fsg-note">${esc(note)}</p>` : ''}
      </div>
      <div class="np-fsg-b">
        ${steps.length ? `<ol class="np-fsg-steps">${steps.map((s) => `<li><span>${s}</span></li>`).join('')}</ol>` : ''}
        ${hasCopy ? `<input class="m-input np-fsg-url" type="text" readonly value="${esc(url)}" aria-label="Adresse des Spiels">` : ''}
        <div class="np-fsg-actions">${actions.join('')}</div>
      </div>`;
  }

  _guideClick(e) {
    if (e.target === this.guide) { this.closeGuide(); return; } // Klick auf den Hintergrund
    const b = e.target.closest && e.target.closest('[data-fsg]');
    if (!b) return;
    const act = b.dataset.fsg;
    if (act === 'close') { this.G.events.emit('ui:sound', { name: 'back' }); this.closeGuide(); }
    else if (act === 'copy') this._copy(b);
    else if (act === 'install') {
      this.fs.install().then((r) => {
        if (r === 'accepted') this.closeGuide();
        else if (this.guide) this._fillGuide();
      });
    }
  }

  _copy(b) {
    const url = pageUrl();
    const done = (ok) => {
      const s = b.querySelector('span');
      if (s) s.textContent = ok ? 'Link kopiert' : 'Bitte Adresse kopieren';
      if (!ok) { const f = this.guide && this.guide.querySelector('.np-fsg-url'); if (f) { f.focus(); f.select(); } }
    };
    const fallback = () => {
      const f = this.guide && this.guide.querySelector('.np-fsg-url');
      let ok = false;
      if (f) { try { f.focus(); f.select(); ok = document.execCommand('copy'); } catch { ok = false; } }
      done(ok);
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(url).then(() => done(true), fallback);
        return;
      }
    } catch { /* */ }
    fallback();
  }

  _guideKey(e) {
    if (!this.guide) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeGuide();
      return;
    }
    if (e.key === 'Tab') { // Fokus im Dialog halten
      const f = [...this.guide.querySelectorAll('button, a[href], input')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
  }
}
