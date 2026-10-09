// NULLPUNKT — Menüs (§9) in #menu-root: Lobby, Ladebildschirm, Pause (Fortsetzen, Einstellungen, Steuerung,
// Waffenkammer im Schießstand, Match verlassen mit Rückfrage), Einstellungen, Steuerung, Endbildschirm.
// Vollständig per Touch, Maus, Tastatur (Pfeile = räumliche Navigation, Esc = zurück) und Gamepad
// (Steuerkreuz/Stick, A wählen, B zurück, Start fortsetzen) bedienbar. Absichten an main über
// onStart(cfg) · onResume() · onRestart() · onQuit() · onExit().
// Mehrspieler (ui/net-menus.js, this.net): Lobby-Reiter, Raum-Bildschirm ('room', 'roomequip'), Online-Teil von
// Pause und Endbildschirm. Einstiege für Deep-Links: openJoin(code) · openRoom().

import { el, esc, clock } from './dom.js';
import { ICON } from './icons.js';
import { Lobby } from './lobby.js';
import { WeaponPreview } from './preview3d.js';
import { SettingsPanel } from './settings-panel.js';
import { TouchEditor } from './touch-editor.js';
import { controlsHtml, bindControls } from './controls-help.js';
import { EndScreen } from './endscreen.js';
import { LoadoutPanel } from './loadout-panel.js';
import { drawMapArt, rememberMinimap } from './mapart.js';
import { NetMenus } from './net-menus.js';

// VR-Brille (Knopf „VR starten“ im Pausenmenü; Symbole in icons.js gehören zu einem anderen Bereich)
const VR_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M6 16h36v16a3 3 0 0 1-3 3H31l-4-6h-6l-4 6H9a3 3 0 0 1-3-3z"/><circle cx="16" cy="24" r="3"/><circle cx="32" cy="24" r="3"/></svg>';

const TIPS = [
  'Sprinte und ducke dich, um zu rutschen. Ideal für Ecken und Türen.',
  'Gesundheit kehrt nach 3,5 Sekunden ohne Treffer zurück.',
  'Kopftreffer verkürzen jedes Duell.',
  'Dünne Deckung aus Holz, Blech oder Glas hält keine Kugel auf.',
  'Halte die Splittergranate kurz, um sie vorzukochen. Nach 2,8 Sekunden ist Schluss.',
  'Auf dem Touchscreen sperrt ein Joystick ganz oben den Sprint.',
  'Wer feuert, erscheint auf der Minikarte der Gegner.',
  'Vier Abschüsse ohne Tod: Aufklärer. Sechs: Präzisionsschlag. Acht: Wachgeschütz.',
  'In Herrschaft zählen Flaggen, nicht Abschüsse. Mehr Verbündete im Kreis nehmen schneller ein.',
  'Im Waffenspiel wirft dich ein Messerabschuss eine Stufe zurück.',
  'Im Schießstand ist jede Waffe frei. Der Parcours misst deine Bestzeit.',
  'Das kleinere Team kehrt schneller ins Gefecht zurück.',
];

export class Menus {
  constructor(G) {
    this.G = G;
    this.root = document.getElementById('menu-root') || document.body;
    this.current = null;
    this.parent = null;
    this.onStart = null;
    this.onResume = null;
    this.onRestart = null;
    this.onQuit = null;
    this.onExit = null;
    this.preview = new WeaponPreview(G);
    this.lobby = new Lobby(this);
    this.net = new NetMenus(this);
    this.endScreen = new EndScreen(G);
    this.settingsPanel = new SettingsPanel(G);
    this.settingsPanel.menus = this;
    this.touchEditor = new TouchEditor(G);
    this._padMute = 0;
    this._tipT = null;
    this._padPrev = [];
    this._padRepeat = 0;
    this._raf = 0;
    this._listeners = [];
    this._busy = false;

    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); this._listeners.push(() => t.removeEventListener(type, fn, o)); };
    on(window, 'keydown', (e) => this._onKey(e));
    on(this.root, 'pointerover', (e) => {
      const b = e.target.closest && e.target.closest('button:not([disabled])');
      if (b && b !== this._hoverBtn && e.pointerType === 'mouse') { this._hoverBtn = b; this.sound('hover'); }
    });
    // Ergebnis-Banner (Element von core) mit Unterzeile ergänzen – nach main (Mikroaufgabe)
    this._offs = [
      G.events.on('match:end', ({ result } = {}) => queueMicrotask(() => this._banner(result))),
      G.events.on('match:state', ({ state }) => this._onState(state)),
      G.events.on('match:start', () => { if (G.world && !G.world.isStub) rememberMinimap(G.match.mapId, G.world); }),
    ];
  }

  /* ================================================================ Grundgerüst */

  sound(name) {
    this.G.events.emit('ui:sound', { name });
  }

  _screen(name, cls, html) {
    this._leave();
    const s = el('div', `m-screen ${cls || ''}`);
    s.dataset.screen = name;
    s.innerHTML = html;
    this.root.replaceChildren(s);
    this.current = name;
    document.body.dataset.menu = name;
    this._startPad();
    return s;
  }

  /** Aufräumen des bisherigen Bildschirms. */
  _leave() {
    if (this.current === 'lobby') { this.preview.stop(); this.lobby.unmount(); }
    if (this.current === 'settings') this.settingsPanel.unmount();
    if (this.current === 'touchedit' && this.touchEditor.open) this.touchEditor.stop(false);
    if (this.current === 'end') this.endScreen.stop();
    if (this.current === 'room') this.net.unmountRoom();
    if (this.current === 'roomequip' && this.net._equipPanel) this.net._equipPanel.unmount();
    if (this._tipT) { clearInterval(this._tipT); this._tipT = null; }
  }

  hideAll() {
    this._leave();
    if (this.current === 'lobby' || this.current === 'loading') this.preview.clearCanvas();
    this.root.replaceChildren();
    this.current = null;
    delete document.body.dataset.menu;
    this._stopPad();
  }

  _focusFirst(s, sel = '.m-primary') {
    const b = s.querySelector(sel) || s.querySelector('button:not([disabled])');
    if (b) try { b.focus({ preventScroll: true }); } catch { /* */ }
  }

  _onState(state) {
    if (state === 'loading' && this.current === 'lobby') this.preview.stop();
  }

  /* ================================================================ Lobby */

  /**
   * Lobby. opts.tab: Reiter vorwählen ('deploy'|'loadout'|'progress'|'online'). Ist eine Mehrspieler-Sitzung aktiv
   * (Rückkehr aus dem Match, Revanche), geht es in den Raum statt in die Lobby – außer opts.room === false.
   */
  showLobby(opts = {}) {
    if (opts.room !== false && this.net.inRoom()) { this.net.showRoom(); return; }
    if (opts.tab) this.lobby.tab = opts.tab;
    const s = this._screen('lobby', 'm-lobby', '');
    this.lobby.mount(s);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'start') this._start(b);
      else if (act === 'net-host') this.net.createRoom({}, b);
      else if (act === 'settings') this.showSettings('lobby');
      else if (act === 'profile') { this.settingsPanel.group = 'profil'; this.showSettings('lobby'); }
      else if (act === 'controls') this.showControls('lobby');
      else if (act === 'exit') { this.sound('back'); if (this.onExit) this.onExit(); }
    });
    const stage = s.querySelector('.lb-stage');
    this.preview.start(stage);
    this.lobby._showView();
    this._focusFirst(s, '.lb-start');
  }

  /** Deep-Link spielen.html?raum=CODE: Lobby → Mehrspieler, Code eintragen und (auto) beitreten. */
  openJoin(code, { auto = true } = {}) {
    if (this.net.inRoom()) { this.net.showRoom(); return; }
    this.showLobby({ tab: 'online', room: false });
    this.net.prefillJoin(code, { auto });
  }

  /** Raum-Bildschirm (aktive Sitzung), sonst Lobby im Mehrspieler-Reiter. */
  openRoom() {
    if (this.net.inRoom()) this.net.showRoom();
    else this.showLobby({ tab: 'online', room: false });
  }

  _start(btn) {
    if (this._busy || !this.onStart) return;
    this._busy = true;
    setTimeout(() => { this._busy = false; }, 1500);
    btn.classList.add('is-go');
    this.sound('confirm');
    this.lobby.saveClassLoadout();
    this.onStart(this.lobby.config());
  }

  /* ================================================================ Laden */

  showLoading(p = 0) {
    const G = this.G;
    if (this.current !== 'loading') {
      const D = G.data || {};
      const map = (D.MAPS || {})[G.match.mapId] || null;
      const mode = (D.MODES || {})[G.match.modeId] || null;
      const prep = { hafen: 'im', altstadt: 'in der', werk: 'im', range: 'am' }[G.match.mapId] || 'auf';
      // atmosphere-weather: aufgelöstes Wetter + Tageszeit („Bewölkt · Mittag“), sonst die Kartenzeit
      let cond = map && map.timeOfDay ? map.timeOfDay : '';
      try { if (G.match.conditions && G.modules?.world?.conditionsLabel) cond = G.modules.world.conditionsLabel(G.match.conditions, map, D.WEATHERS); } catch { /* Kartenzeit */ }
      const s = this._screen('loading', 'm-loading', `
        <canvas class="ld-art" aria-hidden="true"></canvas>
        <div class="ld-inner">
          <div class="m-kicker">${esc(mode ? mode.name : 'Einsatz')} ${esc(prep)} ${esc(map ? map.name : 'Testgelände')}</div>
          <h1 class="ld-title">${esc(map ? map.name : 'Testgelände')}<em>.</em></h1>
          <div class="ld-sub">${esc([map ? map.subtitle : '', cond].filter(Boolean).join(' · '))}</div>
          ${mode ? `<p class="ld-obj"><span class="ld-ico">${mode.icon || ''}</span>${esc(mode.hudObjective || mode.tagline || '')}</p>` : ''}
          <div class="ld-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <div class="ld-row"><span class="ld-pct">0 %</span><span class="ld-state">Einsatzgebiet wird aufgebaut</span></div>
          <p class="ld-tip"></p>
        </div>`);
      const cv = s.querySelector('.ld-art');
      requestAnimationFrame(() => { if (cv.isConnected) drawMapArt(cv, map, { flags: false }); });
      const tip = s.querySelector('.ld-tip');
      let i = (Math.random() * TIPS.length) | 0;
      const show = () => { tip.textContent = `Tipp: ${TIPS[i++ % TIPS.length]}`; };
      show();
      this._tipT = setInterval(show, 4200);
    }
    const v = Math.max(0, Math.min(1, p));
    const bar = this.root.querySelector('.ld-bar i');
    const pct = this.root.querySelector('.ld-pct');
    const st = this.root.querySelector('.ld-state');
    if (bar) bar.style.transform = `scaleX(${v.toFixed(3)})`;
    if (pct) pct.textContent = `${Math.round(v * 100)} %`;
    if (st) st.textContent = v < 0.85 ? 'Einsatzgebiet wird aufgebaut' : v < 1 ? 'Truppen beziehen Stellung' : 'Bereit.';
    const pb = this.root.querySelector('.ld-bar');
    if (pb) pb.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }

  /* ================================================================ Pause */

  showPause() {
    const G = this.G;
    const mode = G.mode;
    const def = mode ? mode.def : {};
    const training = mode && mode.id === 'training';
    const names = G.data.TEAM_NAMES || { A: 'A', B: 'B' };
    // Mehrspieler: das Spiel läuft weiter; kein „Neu starten“, Verlassen erklärt die Folgen
    const online = !!(G.net && G.net.online);
    const host = online && G.net.role === 'host';
    const quitText = !online ? 'Match wirklich verlassen? Punkte und Fortschritt dieses Matches verfallen.'
      : host ? 'Match verlassen? Als Host beendest du das Match für alle – ihr landet wieder im Raum.'
        : 'Match verlassen? Du verlässt damit auch den Raum.';
    let score = '';
    if (mode && mode.teams) {
      const mine = G.player && G.player.team === 'B' ? 'B' : 'A';
      const other = mine === 'A' ? 'B' : 'A';
      score = `<div class="ps-score"><span class="a"><small>${esc(names[mine])}</small><b>${mode.scores[mine] || 0}</b></span><i>:</i><span class="b"><b>${mode.scores[other] || 0}</b><small>${esc(names[other])}</small></span></div>`;
    } else if (mode && mode.standing) {
      const st = mode.standing(G.player);
      score = `<div class="ps-score ps-ffa"><b>Platz ${st.place}</b><small>von ${st.total}</small></div>`;
    } else if (training && mode.summary) {
      const t = mode.summary();
      score = `<div class="ps-score ps-ffa"><b>${t.down}</b><small>Ziele · ${t.shots ? Math.round(t.accuracy * 100) : 0} % Treffer</small></div>`;
    }
    const s = this._screen('pause', 'm-pause', `
      <div class="ps${online ? ' ps-net-on' : ''}">
        <div class="ps-info">
          <div class="m-kicker">${esc(def.name || '')} · ${esc(G.world ? G.world.name : '')}${mode && Number.isFinite(mode.timeLeft) ? ` · ${clock(mode.timeLeft)}` : ''}</div>
          <h1 class="m-title">${online ? 'Menü' : 'Pause'}<em>.</em></h1>
          ${score}
          ${online ? this.net.pauseHtml() : ''}
        </div>
        <nav class="ps-menu" aria-label="Pausenmenü">
          <button type="button" class="m-btn m-primary" data-act="resume">${ICON.play}<span>Fortsetzen</span><kbd>Esc</kbd></button>
          ${G.xr && G.xr.available && !G.xr.presenting ? `<button type="button" class="m-btn" data-act="vr">${VR_ICON}<span>VR starten</span></button>` : ''}
          ${training ? `<button type="button" class="m-btn" data-act="armory">${ICON.target}<span>Waffenkammer</span></button>` : ''}
          ${!training && mode && !mode.lockLoadout ? `<button type="button" class="m-btn" data-act="equip">${ICON.target}<span>Ausrüstung</span></button>` : ''}
          <button type="button" class="m-btn" data-act="settings">${ICON.gear}<span>Einstellungen</span></button>
          <button type="button" class="m-btn" data-act="controls">${ICON.pad}<span>Steuerung</span></button>
          ${G.fullscreen && G.fullscreen.installAvailable ? `<button type="button" class="m-btn" data-act="install">${ICON.install}<span>Als App installieren</span></button>` : ''}
          ${training ? `<button type="button" class="m-btn" data-act="finish">${ICON.check}<span>Training beenden</span></button>` : online ? '' : `<button type="button" class="m-btn" data-act="restart">${ICON.restart}<span>Neu starten</span></button>`}
          <button type="button" class="m-btn m-danger" data-act="quit">${ICON.exit}<span>Match verlassen</span></button>
          <div class="ps-confirm" hidden>
            <p>${esc(quitText)}</p>
            <div class="m-actions"><button type="button" class="m-btn m-danger" data-act="quit-yes">${ICON.exit}<span>Verlassen</span></button><button type="button" class="m-btn" data-act="quit-no">${ICON.back}<span>Weiterspielen</span></button></div>
          </div>
        </nav>
      </div>`);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'resume') { this.sound('confirm'); this._resume(); }
      else if (act === 'vr') {
        // VR (engine/xr): direkt in der Klick-Geste starten; läuft die Sitzung, setzt main das Match fort
        this.sound('confirm');
        b.disabled = true;
        G.xr.start().then((ok) => { if (!ok && this.current === 'pause' && G.match.state === 'paused') this.showPause(); });
      }
      else if (act === 'settings') this.showSettings('pause');
      else if (act === 'controls') this.showControls('pause');
      else if (act === 'install') {
        // Chromium/Edge: das Angebot (beforeinstallprompt) war bisher nur im Vollbild-Ratgeber erreichbar
        this.sound('confirm');
        b.disabled = true;
        (G.fullscreen ? G.fullscreen.install() : Promise.resolve('unavailable')).then(() => { if (this.current === 'pause' && G.match.state === 'paused') this.showPause(); });
      }
      else if (act === 'armory') this.showArmory();
      else if (act === 'equip') this.showEquip();
      else if (act === 'restart') { this.sound('confirm'); if (this.onRestart) this.onRestart(); }
      else if (act === 'finish') this._finishTraining();
      else if (act === 'quit') {
        s.querySelector('.ps-confirm').hidden = false;
        this.sound('click');
        this._focusFirst(s, '[data-act="quit-no"]');
      } else if (act === 'quit-yes') {
        this.sound('back');
        // Client: Match verlassen = Raum verlassen. Host: zurück in den Raum (Sitzung bleibt offen).
        if (G.net && G.net.online && G.net.role === 'client') { try { G.net.leave('verlassen'); } catch { /* */ } }
        if (this.onQuit) this.onQuit();
      } else if (act === 'quit-no') { s.querySelector('.ps-confirm').hidden = true; this._focusFirst(s); }
    });
    if (online) this.net.bindPause(s);
    this._focusFirst(s);
  }

  _resume() {
    if (this.onResume) this.onResume();
  }

  _finishTraining() {
    const G = this.G;
    const m = G.mode;
    if (!m || m.isOver) return;
    m.end('finished');
    this.sound('confirm');
    this.hideAll();
    G.events.emit('match:end', { result: m.result });
  }

  /* ================================================================ Waffenkammer (Schießstand) */

  showArmory() {
    const G = this.G;
    const D = G.data || {};
    const W = D.WEAPONS || {};
    const p = G.player;
    const cur = (p && p.loadout) || {};
    const lvl = G.profile.get().level || 1;
    const block = (slot, title) => {
      const list = Object.values(W).filter((w) => w.slot === slot);
      return `<section><h2 class="m-h2">${title}</h2><div class="ar-grid">${list.map((w) => `
        <button type="button" class="ar-item${cur[slot] === w.id ? ' is-on' : ''}" data-w="${esc(w.id)}" data-slot="${slot}">
          <span class="ico">${w.icon || ''}</span><b>${esc(w.name)}</b><small>${esc((D.WEAPON_CLASSES || {})[w.cls] || '')}${w.unlockLevel > lvl ? ' · Probe' : ''}</small></button>`).join('')}</div></section>`;
    };
    const s = this._screen('armory', 'm-sub', `
      <div class="sub">
        <header class="sub-head"><button type="button" class="m-icon" data-act="back" aria-label="Zurück">${ICON.back}</button><div><div class="m-kicker">Schießstand</div><h1 class="m-title">Waffenkammer<em>.</em></h1></div></header>
        <p class="sub-lead">Jede Waffe ist hier frei – auch noch gesperrte zum Probeschießen. Reserve unbegrenzt.</p>
        <div class="sub-body m-scroll" data-scrollable>${block('primary', 'Primärwaffe')}${block('secondary', 'Sekundärwaffe')}</div>
      </div>`);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'back') { this.sound('back'); this.showPause(); return; }
      if (b.dataset.w && G.mode && G.mode.setWeapon) {
        G.mode.setWeapon(b.dataset.slot, b.dataset.w);
        s.querySelectorAll(`.ar-item[data-slot="${b.dataset.slot}"]`).forEach((x) => x.classList.toggle('is-on', x === b));
        this.sound('confirm');
      }
    });
    this.parent = 'pause';
    this._focusFirst(s, '.ar-item.is-on');
  }

  /* ================================================================ Ausrüstung im Match (Pausemenü) */

  /** Klasse/Waffen/Tarnung wechseln: sofort, wenn gerade gespawnt, sonst ab dem nächsten Einsatz. */
  showEquip() {
    const G = this.G;
    const s = this._screen('equip', 'm-sub', `
      <div class="sub sub-wide">
        <header class="sub-head"><button type="button" class="m-icon" data-act="back" aria-label="Zurück">${ICON.back}</button><div><div class="m-kicker">Pause</div><h1 class="m-title">Ausrüstung<em>.</em></h1></div></header>
        <p class="sub-lead">Gilt sofort, wenn du gerade erst eingesetzt wurdest – sonst ab dem nächsten Einsatz.</p>
        <div class="sub-body m-scroll eq-host" data-scrollable></div>
        <div class="m-actions eq-actions"><button type="button" class="m-btn m-primary" data-act="apply">${ICON.check}<span>Übernehmen</span></button><button type="button" class="m-btn" data-act="back">${ICON.back}<span>Abbrechen</span></button></div>
      </div>`);
    const panel = (this._equipPanel = this._equipPanel || new LoadoutPanel(G));
    panel.mount(s.querySelector('.eq-host'));
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'back') { panel.unmount(); this._back(); return; }
      if (b.dataset.act === 'apply') {
        const lo = panel.value();
        panel.save();
        const when = G.mode && typeof G.mode.setLoadout === 'function' ? G.mode.setLoadout(lo) : 'next';
        G.events.emit('loadout:change', { actor: G.player, loadout: lo, when });
        // Mehrspieler: Ausrüstung dem Host melden (gilt ab dem nächsten Einsatz)
        if (G.net && G.net.online && typeof G.net.setLoadout === 'function') { try { G.net.setLoadout({ cls: lo.cls, loadout: lo }); } catch { /* */ } }
        this.sound('confirm');
        panel.unmount();
        this.showPause();
        const n = this.root.querySelector('.ps-info');
        if (n) n.insertAdjacentHTML('beforeend', `<p class="ps-note">${when === 'now' ? 'Ausrüstung übernommen.' : 'Ausrüstung gilt ab dem nächsten Einsatz.'}</p>`);
      }
    });
    this.parent = 'pause';
    this._focusFirst(s, '.lp-cls[aria-pressed="true"]');
  }

  /* ================================================================ Einstellungen / Steuerung */

  showSettings(from) {
    const back = from || (this.current === 'lobby' ? 'lobby' : 'pause');
    const s = this._screen('settings', 'm-sub', `
      <div class="sub sub-wide">
        <header class="sub-head"><button type="button" class="m-icon" data-act="back" aria-label="Zurück">${ICON.back}</button><div><div class="m-kicker">${back === 'lobby' ? 'Lobby' : 'Pause'}</div><h1 class="m-title">Einstellungen<em>.</em></h1></div></header>
        <div class="sub-host"></div>
      </div>`);
    this.parent = back;
    this.settingsPanel.mount(s.querySelector('.sub-host'));
    s.querySelector('[data-act="back"]').addEventListener('click', () => this._back());
    this._focusFirst(s, '.m-tab[aria-selected="true"]');
  }

  showControls(from) {
    const back = from || (this.current === 'lobby' ? 'lobby' : 'pause');
    const touch = this.G.input && this.G.input.mode === 'touch';
    const pad = this.G.input && this.G.input.lastDevice === 'gamepad';
    const s = this._screen('controls', 'm-sub', `
      <div class="sub sub-wide">
        <header class="sub-head"><button type="button" class="m-icon" data-act="back" aria-label="Zurück">${ICON.back}</button><div><div class="m-kicker">${back === 'lobby' ? 'Lobby' : 'Pause'}</div><h1 class="m-title">Steuerung<em>.</em></h1></div></header>
        ${controlsHtml(touch ? 'touch' : pad ? 'pad' : 'keys', this.G)}
      </div>`);
    this.parent = back;
    bindControls(s, (dev) => {
      // „Belegung ändern“: Einstellungen → Belegung mit diesem Gerät; Touch direkt in den Layout-Editor
      if (dev === 'touch') { this.showTouchEditor(); return; }
      this.settingsPanel.group = 'belegung';
      this.settingsPanel._state.belegung = { device: dev };
      this.sound('click');
      this.showSettings(back);
    });
    s.querySelector('[data-act="back"]').addEventListener('click', () => this._back());
    this._focusFirst(s, '.m-tab[aria-selected="true"]');
  }

  /**
   * Touch-Layout-Editor (aus Einstellungen → Steuerung/Belegung). Schließen kehrt in die Einstellungen zurück
   * (gleicher Reiter, gleiche Scrollposition).
   */
  showTouchEditor() {
    const back = this.parent || (this.G.match.state === 'paused' ? 'pause' : 'lobby');
    const s = this._screen('touchedit', 'm-touchedit', '');
    this.parent = back;
    this.touchEditor.start(s, { onClose: () => { if (this.current === 'touchedit') this.showSettings(back); } });
  }

  /** Gamepad-Eingaben im Menü kurz ignorieren (nach einer Tastenerfassung: das Loslassen gehört noch dazu). */
  mutePad(ms = 250) {
    this._padMute = Math.max(this._padMute, performance.now() + ms);
  }

  _back() {
    this.sound('back');
    if (this.parent === 'lobby') this.showLobby();
    else if (this.G.match.state === 'paused') this.showPause();
    else if (this.G.match.state === 'ended' && this.G.lastResult) this.showEnd(this.G.lastResult, this.G.lastProgression);
    else this.showLobby();
  }

  /* ================================================================ Ende */

  showEnd(result, progression) {
    const G = this.G;
    const s = this._screen('end', 'm-end', this.endScreen.html(result, progression));
    // Mehrspieler: „Revanche“ = zurück in den Raum (der Host startet neu), „Lobby“ = Raum verlassen
    const online = () => !!(G.net && G.net.online);
    if (online()) {
      const r = s.querySelector('[data-act="restart"] span');
      const l = s.querySelector('[data-act="lobby"] span');
      if (r) r.textContent = 'Zurück in den Raum';
      if (l) l.textContent = 'Raum verlassen';
    }
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'restart') {
        this.sound('confirm');
        if (online()) { if (this.onQuit) this.onQuit(); } else if (this.onRestart) this.onRestart();
      } else if (act === 'lobby') {
        this.sound('back');
        if (online()) { try { G.net.leave('verlassen'); } catch { /* */ } }
        if (this.onQuit) this.onQuit();
      } else if (act === 'exit') {
        this.sound('back');
        if (online()) { try { G.net.leave('verlassen'); } catch { /* */ } }
        if (this.onExit) this.onExit();
      }
    });
    this.endScreen.animate(s, progression);
    this._focusFirst(s);
  }

  _banner(result) {
    const b = document.getElementById('match-banner');
    if (!b || !result) return;
    const G = this.G;
    let sub = b.querySelector('[data-banner-sub]');
    if (!sub) {
      sub = el('small');
      sub.dataset.bannerSub = '';
      b.appendChild(sub);
    }
    const names = G.data.TEAM_NAMES || { A: 'A', B: 'B' };
    let text = '';
    if (result.training || result.modeId === 'training') {
      const t = b.querySelector('[data-banner-text]');
      if (t) t.textContent = 'Training beendet';
      b.dataset.result = 'draw';
      text = 'Schießstand';
    } else if (result.teams && result.teamScores) {
      const mine = G.player && G.player.team === 'B' ? 'B' : 'A';
      const other = mine === 'A' ? 'B' : 'A';
      text = `${names[mine]} ${result.teamScores[mine]} : ${result.teamScores[other]} ${names[other]}`;
    } else if (result.placement) {
      text = `Platz ${result.placement} von ${result.players}${result.winnerName && result.placement !== 1 ? ` · Sieger: ${result.winnerName}` : ''}`;
    }
    sub.textContent = text;
  }

  /* ================================================================ Tastatur / Gamepad */

  _onKey(e) {
    if (!this.current) return;
    const t = e.target;
    const typing = t && t.matches && t.matches('input[type="text"], textarea');
    if (e.code === 'Escape') {
      // Esc gehalten (z. B. beim Verlassen von Vollbild/Pointer-Lock): Wiederholungen schalten nicht Pause/Fortsetzen hin und her
      if (e.repeat) return;
      if (this.current === 'pause') {
        const c = this.root.querySelector('.ps-confirm');
        if (c && !c.hidden) { c.hidden = true; e.preventDefault(); return; }
        e.preventDefault();
        this._resume();
      } else if (['settings', 'controls', 'armory', 'equip'].includes(this.current)) { e.preventDefault(); if (this._equipPanel) this._equipPanel.unmount(); this._back(); }
      else if (this.current === 'room') { e.preventDefault(); if (typing) t.blur(); else this.net.back(); }
      else if (this.current === 'roomequip') { e.preventDefault(); this.net.backFromEquip(); }
      return;
    }
    if (typing) return;
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.code];
    if (dir) {
      if (t && t.matches && t.matches('input[type="range"]') && (dir === 'left' || dir === 'right')) return;
      e.preventDefault();
      this._move(dir);
    }
  }

  _startPad() {
    if (this._raf) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this._pollPad();
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stopPad() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._padPrev = [];
  }

  _pollPad() {
    if (!this.current || typeof navigator.getGamepads !== 'function') return;
    let pad = null;
    for (const p of navigator.getGamepads() || []) if (p && p.connected) { pad = p; break; }
    if (!pad) return;
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const prev = this._padPrev;
    const now = performance.now();
    // Tastenerfassung („Taste drücken …“) fragt selbst ab; danach kurz stumm, sonst wirkt das Loslassen im Menü
    const capturing = !!(this.G.input && this.G.input.capturing);
    if (capturing) this._padMute = now + 250;
    if (capturing || now < this._padMute) { for (let i = 0; i < pad.buttons.length; i++) prev[i] = btn(i); this._padDir = null; return; }
    if (this.current === 'touchedit') { this.touchEditor.pollPad(pad); return; }
    const released = (i) => prev[i] && !btn(i);
    // Richtung (Steuerkreuz oder Stick, mit Wiederholung)
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    let dir = null;
    if (btn(12) || ay < -0.6) dir = 'up';
    else if (btn(13) || ay > 0.6) dir = 'down';
    else if (btn(14) || ax < -0.6) dir = 'left';
    else if (btn(15) || ax > 0.6) dir = 'right';
    if (dir) {
      if (dir !== this._padDir || now > this._padRepeat) {
        const a = document.activeElement;
        if (a && a.matches && a.matches('input[type="range"]') && (dir === 'left' || dir === 'right')) {
          const st = Number(a.step) || 0.01;
          a.value = String(Number(a.value) + (dir === 'right' ? st : -st) * 2);
          a.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (a && a.matches && a.matches('.sp-step') && (dir === 'left' || dir === 'right')) {
          // Wähler ‹ Wert › (Einstellungen): links/rechts ändert den Wert
          a.dispatchEvent(new CustomEvent('np-step', { bubbles: true, detail: { d: dir === 'right' ? 1 : -1 } }));
        } else this._move(dir);
        this._padRepeat = now + (dir === this._padDir ? 120 : 380);
        this._padDir = dir;
      }
    } else this._padDir = null;
    // Aktionen beim Loslassen (sonst feuert der Knopf nach dem Fortsetzen im Spiel)
    if (released(0)) {
      const a = document.activeElement;
      if (a && this.root.contains(a) && typeof a.click === 'function') a.click();
      else this._focusFirst(this.root);
    }
    if (released(1)) {
      if (this.current === 'pause') this._resume();
      else if (['settings', 'controls', 'armory', 'equip'].includes(this.current)) { if (this._equipPanel) this._equipPanel.unmount(); this._back(); }
      else if (this.current === 'room') this.net.back();
      else if (this.current === 'roomequip') this.net.backFromEquip();
    }
    if (released(9) && this.current === 'pause') this._resume();
    if (released(4) || released(5)) this._cycleTabs(released(5) ? 1 : -1);
    for (let i = 0; i < pad.buttons.length; i++) prev[i] = btn(i);
  }

  /** LB/RB: Reiter wechseln (Lobby, Einstellungen, Steuerung). */
  _cycleTabs(d) {
    const tabs = [...this.root.querySelectorAll('.m-tabs')].find((t) => t.offsetParent);
    if (!tabs) return;
    const list = [...tabs.querySelectorAll('.m-tab')];
    const i = list.findIndex((x) => x.getAttribute('aria-selected') === 'true');
    const next = list[(i + d + list.length) % list.length];
    if (next) { next.click(); next.focus({ preventScroll: true }); this.sound('click'); }
  }

  /** Räumliche Fokus-Navigation. */
  _move(dir) {
    const items = [...this.root.querySelectorAll('button:not([disabled]), input:not([disabled]), select, [tabindex="0"]')].filter((n) => n.tabIndex !== -1 && n.offsetParent !== null && !n.closest('[hidden]'));
    if (!items.length) return;
    const a = document.activeElement;
    if (!a || !this.root.contains(a) || !items.includes(a)) { items[0].focus({ preventScroll: false }); return; }
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
      let main;
      let off;
      if (dir === 'up') { main = -y; off = Math.abs(x); }
      else if (dir === 'down') { main = y; off = Math.abs(x); }
      else if (dir === 'left') { main = -x; off = Math.abs(y); }
      else { main = x; off = Math.abs(y); }
      if (main <= 4) continue;
      const sc = main + off * 2.2;
      if (sc < bestS) { bestS = sc; best = n; }
    }
    if (best) {
      best.focus({ preventScroll: false });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      this.sound('hover');
    }
  }

  dispose() {
    this.hideAll();
    this.net.dispose();
    while (this._listeners.length) this._listeners.pop()();
    for (const off of this._offs) off();
    this.preview.dispose();
  }
}

