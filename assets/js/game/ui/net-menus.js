// NULLPUNKT — Mehrspieler-Oberfläche (Vertrag docs/planung/mehrspieler.md §3): Lobby-Reiter „Mehrspieler“
// (Rufzeichen, Schnell spielen, Beitreten per Code oder Einladungslink, Liste öffentlicher Spiele), Raum-Bildschirm
// für Host und Mitspieler (Code + Link, Spielerliste mit Team/Stufe/Ping, Einstellungen des Hosts mit Empfehlung,
// Start/Verlassen), Ausrüstung im Raum, Online-Teil des Pausenmenüs und kurze Hinweise zu Netz-Ereignissen.
// Spricht nur mit G.net (NetSystem, net/index.js) und hört auf net:* – baut selbst keine Verbindung auf und lädt keine
// Netz-Module. Fehlt G.net (Modul nicht geladen), bleibt der Reiter mit einem Hinweis bedienbar.

import { esc, el } from './dom.js';
import { ICON, deviceOf } from './icons.js';
import { LoadoutPanel } from './loadout-panel.js';
import { CLASSES, GAME_STYLES, STYLE_ORDER } from '../../shared/classes.data.js';
import { WEATHERS } from '../../shared/maps.data.js';

/** Gerät eines Mitspielers (Roster device: PC/Handy/VR-Brille) – Abzeichen in der Raumliste bzw. Symbol vor dem Namen. */
const devBadge = (r) => { const d = deviceOf(r.device); return `<em class="nr-badge is-dev" data-dev="${esc(r.device || 'pc')}" title="${esc(d.label)}">${d.icon}${esc(d.short)}</em>`; };
const devIcon = (r) => { const d = deviceOf(r.device); return `<span class="sb-human" data-dev="${esc(r.device || 'pc')}" title="${esc(d.label)}">${d.icon}</span>`; };

/** Stufe 1: nur diese Modi online (Spiegel von net/index.js – ohne Import, damit die Lobby keine Netz-Module lädt). */
export const ONLINE_MODES = Object.freeze(['tdm', 'ffa', 'dom', 'kc']);
/** Raumcodes (= net/signal.js): 6 Zeichen ohne I, O, 0, 1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const MAX_PLAYERS = 32;
const MAX_TEAM = 16;
const DIFF_ORDER = ['rekrut', 'regulaer', 'veteran', 'elite'];
const IN_MATCH = ['loading', 'countdown', 'playing', 'paused'];
const TOAST_LIFE = 4.5;

const DIRECT_FAIL = 'Direkte Verbindung nicht möglich – manche Router oder Mobilfunknetze blockieren das. Versuch es mit WLAN oder einem anderen Netz.';

/** Fehlertexte zu den Codes aus G.net (join wirft Error.code, net:error {code}). */
export const NET_UI_ERRORS = Object.freeze({
  'kein-relay': 'Vermittlungsserver nicht erreichbar – Internetverbindung prüfen.',
  'kein-host': 'Kein Raum mit diesem Code gefunden. Code prüfen – vielleicht ist der Raum schon geschlossen.',
  'keine-antwort': 'Der Host antwortet nicht. Vielleicht ist sein Spiel gerade im Hintergrund – gleich noch einmal versuchen.',
  'abgelehnt:voll': 'Der Raum ist voll. Frag den Host, ob er mehr Plätze freigibt – oder such dir ein anderes Spiel.',
  'abgelehnt:version': 'Anderer Spielstand – Seite neu laden (beide Seiten brauchen dieselbe Fassung).',
  'abgelehnt:gekickt': 'Der Host hat dich aus diesem Raum entfernt.',
  'abgelehnt:fehler': 'Der Host konnte die Anfrage gerade nicht annehmen. Gleich noch einmal versuchen.',
  'verbindung-fehlgeschlagen': DIRECT_FAIL,
  zeitueberschreitung: DIRECT_FAIL,
  'host-weg': 'Der Host hat das Spiel verlassen.',
  'host-beendet': 'Der Host hat das Spiel verlassen.',
  gekickt: 'Du wurdest aus dem Raum entfernt.',
});

/** Text zu einem Fehlercode (leer für „abgebrochen“ – der Nutzer hat selbst abgebrochen). */
export function netErrorText(code, fallback = '') {
  if (!code || code === 'abgebrochen') return '';
  if (NET_UI_ERRORS[code]) return NET_UI_ERRORS[code];
  if (String(code).startsWith('abgelehnt:')) return 'Der Host hat den Beitritt abgelehnt.';
  return fallback || `Verbindung fehlgeschlagen (${code}).`;
}

/**
 * Raumcode aus Eingabe oder eingefügtem Link (…spielen.html?raum=K7M2QX bzw. #raum=…). Kleinbuchstaben, Leer- und
 * Bindestriche sind erlaubt. → {code, bad (I/O/0/1 getippt), noCode (Link ohne Raum), link}
 */
export function parseRoomCode(text) {
  const raw = String(text ?? '').trim();
  const m = raw.match(/[?&#]raum=([^&#\s]*)/i);
  let src = raw;
  if (m) { try { src = decodeURIComponent(m[1]); } catch { src = m[1]; } }
  else if (/^[a-z]+:\/\/|\/|\.html?\b/i.test(raw)) return { code: '', bad: false, noCode: true, link: true };
  let code = '';
  let bad = false;
  for (const c of src.toUpperCase()) {
    if (CODE_ALPHABET.includes(c)) code += c;
    else if (/[A-Z0-9]/.test(c)) bad = true;
  }
  return { code: code.slice(0, CODE_LENGTH), bad, noCode: false, link: !!m };
}

/** Einladungslink (absolut). Ein Test-Relay (?relays=…) wird mitgegeben, sonst fände der Link den Raum nicht. */
export function roomLink(code) {
  let url;
  try { url = new URL('spielen.html', location.href); } catch { return `spielen.html?raum=${code}`; }
  const q = new URLSearchParams();
  q.set('raum', code);
  try { const r = new URLSearchParams(location.search).get('relays'); if (r) q.set('relays', r); } catch { /* */ }
  url.search = `?${q.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%2F/gi, '/')}`;
  url.hash = '';
  return url.href;
}

const clampInt = (v, a, b) => { const n = Math.round(Number(v)); return Math.max(a, Math.min(b, Number.isFinite(n) ? n : a)); };

/** Ping-Stufe für die Farbe: gut < 80 ms, mittel < 150 ms, sonst schlecht. */
export function pingTone(ms) {
  if (!(ms > 0)) return 'none';
  return ms < 80 ? 'good' : ms < 150 ? 'ok' : 'bad';
}

/** Fokus über ein Neuzeichnen retten (Schlüssel data-fk; Texteingaben behalten Wert und Auswahl). */
function keepFocus(box, render) {
  const a = document.activeElement;
  const key = a && box.contains(a) && a.dataset ? a.dataset.fk : null;
  const isInput = key && a.tagName === 'INPUT';
  const val = isInput ? a.value : null;
  let sel = null;
  if (isInput) { try { sel = [a.selectionStart, a.selectionEnd]; } catch { sel = null; } }
  render();
  if (!key) return;
  const n = box.querySelector(`[data-fk="${CSS.escape(key)}"]`);
  if (!n) return;
  try { n.focus({ preventScroll: true }); } catch { /* */ }
  if (isInput) {
    n.value = val;
    if (sel) { try { n.setSelectionRange(sel[0], sel[1]); } catch { /* */ } }
  }
}

export class NetMenus {
  constructor(menus) {
    this.menus = menus;
    this.G = menus.G;
    this.pane = null; // Lobby-Reiter (Element)
    this.room = null; // Raum-Bildschirm {s, subs}
    this.notice = null; // {tone, text, code} – Hinweis für den Reiter (z. B. nach Kick)
    this.join = { busy: false, code: '', status: '', tone: '', token: 0, t: null, actions: '' };
    this.quick = { busy: false, status: '', tone: '', token: 0, t: null, offer: false };
    this.hosting = false;
    this.publicList = null; // null = noch keine Antwort
    this._stopPublic = null;
    this._publicT = null;
    this._kickAsk = null; // netId mit offener Rückfrage „Entfernen?“
    this._leaveAsk = false;
    this._starting = false;
    this._toastBox = null;
    this._toasts = [];
    this._toastRaf = 0;
    this._lostT = null;
    const ev = this.G.events;
    this._offs = [
      ev.on('net:peer', (e) => this._onPeer(e)),
      ev.on('net:kicked', (e) => this._onLost('gekickt', e && e.reason)),
      ev.on('net:error', (e) => { if (e && (e.code === 'host-weg' || e.code === 'host-beendet')) this._onLost(e.code); }),
      ev.on('net:host-away', (e) => { if (this.net && this.net.role === 'client') this.toast(e && e.away ? 'Der Host ist gerade nicht im Spiel – sein Tab ist im Hintergrund.' : 'Der Host ist zurück.', e && e.away ? 'warn' : 'ok'); }),
      ev.on('net:roster', () => this._onRoster()),
      ev.on('net:room', () => this._onRoom()),
      ev.on('net:status', () => this._onStatus()),
      ev.on('net:recommend', () => this._renderRec()),
    ];
  }

  /** NetSystem oder null (Modul fehlt). */
  get net() {
    return this.G.net || null;
  }

  /** Sitzung aktiv mit Raum (Host oder Client). */
  inRoom() {
    const n = this.net;
    return !!(n && n.online && n.room);
  }

  _data() {
    const D = this.G.data || {};
    return { MODES: D.MODES || {}, ORDER: D.MODE_ORDER || Object.keys(D.MODES || {}), MAPS: D.MAPS || {}, MAP_ORDER: D.MAP_ORDER || Object.keys(D.MAPS || {}), DIFF: D.DIFFICULTIES || {}, TEAMS: D.TEAM_NAMES || { A: 'Team A', B: 'Team B' } };
  }

  _isTeams(modeId) {
    const m = this._data().MODES[modeId];
    return !m || m.teams !== false;
  }

  _mapsFor(modeId) {
    const d = this._data();
    const ids = d.MAP_ORDER.filter((id) => d.MAPS[id] && id !== 'range');
    const list = ids.filter((id) => Array.isArray(d.MAPS[id].modes) && d.MAPS[id].modes.includes(modeId));
    return list.length ? list : ids;
  }

  _playerName() {
    try { return this.G.settings.get('playerName') || 'Operator'; } catch { return 'Operator'; }
  }

  _level() {
    try { return this.G.profile.get().level || 1; } catch { return 1; }
  }

  /** Rufzeichen aus dem Eingabefeld übernehmen (settings.playerName, max. 16 Zeichen). */
  _saveName() {
    const inp = this.pane && this.pane.querySelector('[data-net-name]');
    if (!inp) return this._playerName();
    const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 16);
    if (v && v !== this._playerName()) { try { this.G.settings.set('playerName', v); } catch { /* */ } }
    return this._playerName();
  }

  _lobby() {
    const l = this.menus.lobby;
    if (l && !l.cfg) { try { l._initCfg(); } catch { /* */ } }
    return l;
  }

  /* ================================================================ Lobby-Reiter */

  mountPane(pane) {
    if (this.pane === pane) { this.renderPane(); return; }
    this.unmountPane();
    this.pane = pane;
    pane.addEventListener('click', this._paneClick = (e) => this._onPaneClick(e));
    pane.addEventListener('input', this._paneInput = (e) => this._onPaneInput(e));
    pane.addEventListener('keydown', this._paneKey = (e) => this._onPaneKey(e));
    pane.addEventListener('change', this._paneChange = (e) => { if (e.target.matches('[data-net-name]')) { this._saveName(); this._renderMe(); } });
    this.renderPane();
    this._watchPublic();
    if (!this.net) this._waitNet();
  }

  /** G.net entsteht evtl. erst nach dem Menü (main.js): kurz nachsehen, dann Reiter (und Deep-Link) nachholen. */
  _waitNet() {
    clearInterval(this._netT);
    let n = 0;
    this._netT = setInterval(() => {
      if (!this.pane || ++n > 40) { clearInterval(this._netT); return; }
      if (!this.net) return;
      clearInterval(this._netT);
      this.renderPane();
      this._watchPublic();
      if (this.menus.lobby && this.menus.lobby.el) this.menus.lobby._renderStart();
      const code = this._pendingJoin;
      this._pendingJoin = null;
      if (code) this.startJoin(code);
    }, 250);
  }

  unmountPane() {
    if (!this.pane) return;
    const p = this.pane;
    p.removeEventListener('click', this._paneClick);
    p.removeEventListener('input', this._paneInput);
    p.removeEventListener('keydown', this._paneKey);
    p.removeEventListener('change', this._paneChange);
    // Rufzeichen auch ohne „change“ (Reiterwechsel per Gamepad) übernehmen
    const inp = p.querySelector('[data-net-name]');
    if (inp && inp.value.trim() && inp.value.trim() !== this._playerName()) this._saveName();
    this.pane = null;
    clearInterval(this._netT);
    this._unwatchPublic();
  }

  _watchPublic() {
    this._unwatchPublic();
    const net = this.net;
    this.publicList = null;
    if (!net || typeof net.watchPublic !== 'function') return;
    try {
      this._stopPublic = net.watchPublic((list) => {
        this.publicList = Array.isArray(list) ? list : [];
        this._renderList();
      });
    } catch (err) {
      console.warn('[net-ui] Öffentliche Spiele', err);
      this.publicList = [];
    }
    // Keine Antwort der Vermittlung: nach einer Weile „keine Spiele“ statt ewig „Suche …“
    this._publicT = setTimeout(() => { if (this.publicList == null) { this.publicList = []; this._renderList(); } }, 7000);
  }

  _unwatchPublic() {
    clearTimeout(this._publicT);
    this._publicT = null;
    if (this._stopPublic) { try { this._stopPublic(); } catch { /* */ } this._stopPublic = null; }
  }

  renderPane() {
    const p = this.pane;
    if (!p) return;
    const net = this.net;
    if (!net) {
      p.innerHTML = `<div class="nm"><div class="nm-off lb-warn is-yellow">${ICON.warn}<span>Mehrspieler ist gerade nicht verfügbar – das Netzmodul wurde nicht geladen. Seite neu laden und es noch einmal versuchen.</span></div></div>`;
      return;
    }
    p.innerHTML = `
      <div class="nm">
        <div class="nm-notice" data-net-notice></div>
        <section class="lb-sec nm-me">
          <h2 class="m-h2">Rufzeichen</h2>
          <div class="nm-name">
            <input type="text" class="m-input" data-net-name data-fk="name" maxlength="16" autocomplete="nickname" spellcheck="false" aria-label="Dein Name im Mehrspieler" value="${esc(this._playerName())}">
            <span class="nm-namehint" data-net-me></span>
          </div>
        </section>
        <section class="lb-sec nm-cards">
          <div class="nm-card nm-quick">
            <h3>${ICON.bolt}<span>Schnell spielen</span></h3>
            <p>Tritt dem passendsten öffentlichen Spiel bei – freie Plätze, ähnliche Stufe.</p>
            <div class="nm-quickrow" data-net-quickrow></div>
            <p class="nm-status" data-net-quick role="status" aria-live="polite"></p>
          </div>
          <div class="nm-card nm-join">
            <h3>${ICON.link}<span>Beitreten</span></h3>
            <p>Raumcode eingeben oder Einladungslink einfügen.</p>
            <div class="nm-joinrow">
              <input type="text" class="m-input nm-code" data-net-code data-fk="code" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="CODE" aria-label="Raumcode (6 Zeichen) oder Einladungslink" value="${esc(this.join.code)}">
              <span data-net-joinbtn></span>
            </div>
            <p class="nm-status" data-net-join role="status" aria-live="polite"></p>
          </div>
        </section>
        <section class="lb-sec nm-public">
          <h2 class="m-h2">Öffentliche Spiele <span class="nm-count" data-net-count></span></h2>
          <div class="nm-list" data-net-list role="list"></div>
        </section>
        <p class="lb-note nm-foot">${ICON.info}<span>Gespielt wird direkt von Browser zu Browser – der Raum läuft beim Host. „Raum erstellen“ übernimmt Modus, Karte und Gegnerstärke aus „Einsatz“.</span></p>
      </div>`;
    this._renderMe();
    this._renderNotice();
    this._renderQuick();
    this._renderJoin();
    this._renderList();
  }

  _renderMe() {
    const n = this.pane && this.pane.querySelector('[data-net-me]');
    if (n) n.textContent = `So sehen dich die anderen · Stufe ${this._level()}`;
  }

  _renderNotice() {
    const n = this.pane && this.pane.querySelector('[data-net-notice]');
    if (!n) return;
    const no = this.notice;
    n.innerHTML = no ? `<div class="lb-warn is-${no.tone === 'error' ? 'red' : 'yellow'} nm-alert" role="alert">${ICON.warn}<span>${esc(no.text)}</span><button type="button" class="m-icon nm-x" data-net="notice-x" aria-label="Hinweis schließen">${ICON.close}</button></div>` : '';
  }

  _renderQuick() {
    if (!this.pane) return;
    const row = this.pane.querySelector('[data-net-quickrow]');
    const st = this.pane.querySelector('[data-net-quick]');
    const q = this.quick;
    if (row) {
      keepFocus(row, () => {
        row.innerHTML = q.busy
          ? `<button type="button" class="m-btn" data-net="quick-cancel" data-fk="quick-cancel">${ICON.close}<span>Abbrechen</span></button>`
          : `<button type="button" class="m-btn m-primary" data-net="quick" data-fk="quick"${this.join.busy || this.hosting ? ' disabled' : ''}>${ICON.bolt}<span>Schnell spielen</span></button>
             ${q.offer ? `<button type="button" class="m-btn" data-net="host-public" data-fk="host-public"${this.hosting ? ' disabled' : ''}>${ICON.globe}<span>Eigenes öffentliches Spiel eröffnen</span></button>` : ''}`;
      });
    }
    if (st) {
      st.className = `nm-status${q.tone ? ` is-${q.tone}` : ''}`;
      st.innerHTML = q.status ? `${q.busy ? '<i class="nm-spin" aria-hidden="true"></i>' : ''}<span>${esc(q.status)}</span>` : '';
    }
  }

  _renderJoin() {
    if (!this.pane) return;
    const box = this.pane.querySelector('[data-net-joinbtn]');
    const st = this.pane.querySelector('[data-net-join]');
    const inp = this.pane.querySelector('[data-net-code]');
    const j = this.join;
    const valid = j.code.length === CODE_LENGTH;
    if (inp) { inp.disabled = j.busy; inp.classList.toggle('is-valid', valid); }
    if (box) {
      keepFocus(box, () => {
        box.innerHTML = j.busy
          ? `<button type="button" class="m-btn" data-net="join-cancel" data-fk="join-cancel">${ICON.close}<span>Abbrechen</span></button>`
          : `<button type="button" class="m-btn m-primary" data-net="join" data-fk="join"${valid && !this.quick.busy && !this.hosting ? '' : ' disabled'}>${ICON.play}<span>Beitreten</span></button>`;
      });
    }
    if (st) {
      st.className = `nm-status${j.tone ? ` is-${j.tone}` : ''}`;
      st.innerHTML = j.status ? `${j.busy ? '<i class="nm-spin" aria-hidden="true"></i>' : j.tone === 'error' ? ICON.warn : ''}<span>${esc(j.status)}</span>${j.actions || ''}` : '';
    }
  }

  _renderList() {
    if (!this.pane) return;
    const box = this.pane.querySelector('[data-net-list]');
    const cnt = this.pane.querySelector('[data-net-count]');
    if (!box) return;
    const list = this.publicList;
    if (cnt) cnt.textContent = list && list.length ? `(${list.length})` : '';
    const d = this._data();
    keepFocus(box, () => {
      if (list == null) {
        box.innerHTML = `<div class="nm-empty"><i class="nm-spin" aria-hidden="true"></i><span>Suche öffentliche Spiele …</span></div>`;
        return;
      }
      if (!list.length) {
        box.innerHTML = `<div class="nm-empty">${ICON.globe}<span>Gerade keine öffentlichen Spiele. Erstelle einen Raum und schalte „Öffentlich“ ein – dann finden ihn andere hier.</span></div>`;
        return;
      }
      const sorted = [...list].sort((a, b) => (b.compatible - a.compatible) || (a.full - b.full) || (b.players - a.players));
      const rows = sorted.slice(0, 40).map((g) => {
        const mode = d.MODES[g.mode] || {};
        const map = d.MAPS[g.map] || {};
        const why = !g.compatible ? 'Anderer Spielstand – Seite neu laden' : g.full ? 'Raum ist voll' : '';
        const code = String(g.code || '').replace(/[^A-Z0-9]/g, '');
        return `<div class="nm-row${g.compatible && !g.full ? '' : ' is-off'}" role="listitem">
          <span class="nm-mode" title="${esc(mode.name || g.mode)}">${mode.icon || ICON.globe}</span>
          <span class="nm-rname"><b>${esc(g.name || 'Raum')}</b><small><span>${esc(g.host ? `Host: ${g.host}` : 'Host unbekannt')}</span><span class="nm-rmeta">${esc(` · ${map.name || g.map} · ${mode.short || g.mode} · St. ${g.level}${g.state === 'match' ? ' · läuft' : ''}`)}</span></small></span>
          <span class="nm-cell nm-cmap">${esc(map.name || g.map || '–')}</span>
          <span class="nm-cell nm-cmode">${esc(mode.short || g.mode || '–')}${g.pvp === 'coop' ? ' <em>Koop</em>' : ''}</span>
          <span class="nm-cell nm-cpl"><b>${g.players}</b>/${g.max}</span>
          <span class="nm-cell nm-clv">St. ${g.level}</span>
          <span class="nm-cell nm-cst">${g.state === 'match' ? '<em class="nm-live">läuft</em>' : '<em>Lobby</em>'}</span>
          <button type="button" class="m-btn nm-rowjoin" data-net-join="${esc(code)}" data-fk="pj-${esc(code)}"${why || this.join.busy || this.quick.busy || this.hosting ? ' disabled' : ''}${why ? ` title="${esc(why)}"` : ''}>${why && g.full ? '<span>Voll</span>' : `${ICON.play}<span>Beitreten</span>`}</button>
        </div>`;
      }).join('');
      box.innerHTML = `<div class="nm-row nm-rhead" aria-hidden="true"><span></span><span>Name</span><span class="nm-cmap">Karte</span><span class="nm-cmode">Modus</span><span class="nm-cpl">Spieler</span><span class="nm-clv">Stufe</span><span class="nm-cst">Status</span><span></span></div>${rows}`;
    });
  }

  _onPaneInput(e) {
    const t = e.target;
    if (!t.matches('[data-net-code]')) return;
    const r = parseRoomCode(t.value);
    if (t.value !== r.code) {
      t.value = r.code;
      try { t.setSelectionRange(r.code.length, r.code.length); } catch { /* */ }
    }
    this.join.code = r.code;
    if (!this.join.busy) {
      if (r.noCode) this._setJoin('In diesem Link steckt kein Raumcode – er sieht so aus: …spielen.html?raum=K7M2QX', 'warn');
      else if (r.bad) this._setJoin('Raumcodes enthalten kein I, O, 0 und 1 – bitte den Code noch einmal prüfen.', 'warn');
      else if (r.link && r.code.length === CODE_LENGTH) this._setJoin(`Code ${r.code} aus dem Link übernommen.`, 'ok');
      else this._setJoin('', '');
    }
  }

  _onPaneKey(e) {
    if (e.key !== 'Enter') return;
    if (e.target.matches('[data-net-code]')) { e.preventDefault(); this.startJoin(); }
    else if (e.target.matches('[data-net-name]')) { e.preventDefault(); this._saveName(); this._renderMe(); e.target.blur(); }
  }

  _onPaneClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const a = b.dataset.net;
    if (b.dataset.netJoin) { this.join.code = b.dataset.netJoin; const inp = this.pane.querySelector('[data-net-code]'); if (inp) inp.value = this.join.code; this.startJoin(); return; }
    if (a === 'quick') this.startQuick();
    else if (a === 'quick-cancel') this.cancelQuick();
    else if (a === 'join') this.startJoin();
    else if (a === 'join-cancel') this.cancelJoin();
    else if (a === 'host-public') this.createRoom({ public: true }, b);
    else if (a === 'reload') location.reload();
    else if (a === 'notice-x') { this.notice = null; this._renderNotice(); this.menus.sound('click'); }
  }

  _setJoin(status, tone, actions = '') {
    Object.assign(this.join, { status, tone, actions });
    this._renderJoin();
  }

  _setQuick(status, tone, offer = this.quick.offer) {
    Object.assign(this.quick, { status, tone, offer });
    this._renderQuick();
  }

  /** Nach Beitritt/Eröffnen in den Raum – außer ein laufendes Spiel startet gerade (Einstieg ins Match). */
  _enterRoom() {
    const net = this.net;
    if (!net || !net.online) return;
    if (net.room && net.room.state === 'match' && net.role === 'client') return; // main lädt das Match
    if (this.G.match && IN_MATCH.includes(this.G.match.state)) return;
    this.showRoom();
  }

  /** Beitreten per Code (Feld oder Liste). */
  async startJoin(code = this.join.code) {
    const net = this.net;
    const r = parseRoomCode(code);
    if (!net || this.join.busy) return;
    if (r.code.length !== CODE_LENGTH) {
      this.menus.sound('error');
      this._setJoin(r.bad ? 'Raumcodes enthalten kein I, O, 0 und 1.' : `Der Raumcode hat ${CODE_LENGTH} Zeichen (Buchstaben und Ziffern).`, 'error');
      const inp = this.pane && this.pane.querySelector('[data-net-code]');
      if (inp) inp.focus();
      return;
    }
    this.join.code = r.code;
    const name = this._saveName();
    this.notice = null;
    this._renderNotice();
    const token = ++this.join.token;
    this.join.busy = true;
    this.menus.sound('confirm');
    this._setJoin('Suche Host …', 'busy');
    this._renderQuick();
    this._renderList();
    clearTimeout(this.join.t);
    // Phasen grob nach Zeit: der Host meldet sich meist binnen 1–2 s, danach läuft der Verbindungsaufbau
    this.join.t = setTimeout(() => { if (this.join.token === token && this.join.busy) this._setJoin('Verbinde …', 'busy'); }, 2600);
    try {
      await net.join(r.code, { name });
      if (this.join.token !== token) return;
      this._joinDone();
      this._setJoin('', '');
      this._enterRoom();
    } catch (err) {
      if (this.join.token !== token) return;
      this._joinDone();
      const c = err && err.code;
      const text = netErrorText(c, err && err.message);
      if (!text) { this._setJoin('', ''); return; }
      this.menus.sound('error');
      this._setJoin(text, 'error', c === 'abgelehnt:version' ? `<button type="button" class="m-btn nm-inline" data-net="reload">${ICON.restart}<span>Neu laden</span></button>` : '');
    }
  }

  _joinDone() {
    clearTimeout(this.join.t);
    this.join.busy = false;
    this._renderQuick();
    this._renderList();
  }

  cancelJoin() {
    if (!this.join.busy) return;
    this.join.token++;
    this._joinDone();
    try { if (this.net && !this.net.online) this.net.leave('abgebrochen'); } catch { /* */ }
    this.menus.sound('back');
    this._setJoin('Abgebrochen.', '');
  }

  /** Schnell spielen: G.net.quickPlay – nichts gefunden → eigenes öffentliches Spiel anbieten. */
  async startQuick() {
    const net = this.net;
    if (!net || this.quick.busy || typeof net.quickPlay !== 'function') return;
    const name = this._saveName();
    this.notice = null;
    this._renderNotice();
    const token = ++this.quick.token;
    this.quick.busy = true;
    this.menus.sound('confirm');
    this._setQuick('Suche öffentliche Spiele …', 'busy', false);
    this._renderJoin();
    this._renderList();
    clearTimeout(this.quick.t);
    this.quick.t = setTimeout(() => { if (this.quick.token === token && this.quick.busy) this._setQuick('Verbinde …', 'busy'); }, 4500);
    try {
      const res = await net.quickPlay({ name });
      if (this.quick.token !== token) return;
      this._quickDone();
      if (res) { this._setQuick('', '', false); this._enterRoom(); return; }
      this.menus.sound('error');
      this._setQuick('Kein passendes öffentliches Spiel gefunden. Eröffne selbst eins – andere finden es dann über „Schnell spielen“.', 'warn', true);
      const b = this.pane && this.pane.querySelector('[data-net="host-public"]');
      if (b) try { b.focus({ preventScroll: true }); } catch { /* */ }
    } catch (err) {
      if (this.quick.token !== token) return;
      this._quickDone();
      const text = netErrorText(err && err.code, err && err.message);
      if (!text) { this._setQuick('', '', false); return; }
      this.menus.sound('error');
      this._setQuick(text, 'error', err && err.code !== 'kein-relay');
    }
  }

  _quickDone() {
    clearTimeout(this.quick.t);
    this.quick.busy = false;
    this._renderJoin();
    this._renderList();
  }

  cancelQuick() {
    if (!this.quick.busy) return;
    this.quick.token++;
    this._quickDone();
    try { if (this.net && !this.net.online) this.net.leave('abgebrochen'); } catch { /* */ }
    this.menus.sound('back');
    this._setQuick('Abgebrochen.', '', false);
  }

  /** Deep-Link (spielen.html?raum=CODE): Feld füllen und – wenn auto – gleich beitreten. */
  prefillJoin(code, { auto = true } = {}) {
    const r = parseRoomCode(code);
    this.join.code = r.code;
    const inp = this.pane && this.pane.querySelector('[data-net-code]');
    if (inp) inp.value = r.code;
    if (r.code.length === CODE_LENGTH && auto && !this.net) this._pendingJoin = r.code; // nachholen, sobald G.net da ist
    else if (r.code.length === CODE_LENGTH && auto) this.startJoin(r.code);
    else {
      if (r.code) this._setJoin(r.bad ? 'Raumcodes enthalten kein I, O, 0 und 1.' : 'Der Code im Link ist unvollständig.', 'warn');
      this._renderJoin();
      if (inp) try { inp.focus({ preventScroll: true }); } catch { /* */ }
    }
  }

  /** Vorgaben für einen neuen Raum aus der Lobby (Einsatz-Reiter). */
  roomDefaults(extra = {}) {
    const l = this._lobby();
    const c = (l && l.cfg) || {};
    const mode = ONLINE_MODES.includes(c.modeId) ? c.modeId : 'tdm';
    const maps = this._mapsFor(mode);
    const teams = this._isTeams(mode);
    const humansGuess = 1;
    // Teamgröße: größere Seite der Lobby-Teams (inkl. Spieler), FFA: Hälfte der Teilnehmer
    let teamSize = teams ? Math.max((c.allies ?? 5) + humansGuess, c.enemies ?? 6) : Math.ceil(((c.enemies ?? 7) + 1) / 2);
    teamSize = clampInt(teamSize, 1, MAX_TEAM);
    let rec = 8;
    try { const r = this.net && this.net.recommendation ? this.net.recommendation() : null; if (r && r.max) rec = r.max; } catch { /* */ }
    return {
      name: '',
      mode,
      map: maps.includes(c.mapId) ? c.mapId : maps[0],
      time: c.timeOfDay || 'standard',
      weather: c.weather || 'standard',
      difficulty: DIFF_ORDER.includes(c.difficulty) ? c.difficulty : 'regulaer',
      style: GAME_STYLES[c.style] ? c.style : 'arcade',
      maxPlayers: clampInt(Math.min(8, rec), 2, MAX_PLAYERS),
      teamSize,
      botFill: true,
      pvp: 'pvp',
      public: false,
      ...extra,
    };
  }

  /** Raum eröffnen (Host) und in den Raum wechseln. btn: Knopf für die Fortschrittsanzeige. */
  async createRoom(extra = {}, btn = null) {
    const net = this.net;
    if (!net || this.hosting || typeof net.host !== 'function') return;
    this._saveName();
    this.notice = null;
    this._renderNotice();
    this.hosting = true;
    this.menus.sound('confirm');
    const label = btn && btn.querySelector('span');
    const before = label ? label.innerHTML : '';
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Eröffne Raum …';
    this._renderQuick();
    this._renderJoin();
    this._renderList();
    try {
      await net.host(this.roomDefaults(extra));
      this.hosting = false;
      this._leaveAsk = false;
      this._kickAsk = null;
      if (this.menus.current === 'lobby' || this.menus.current == null) this.showRoom();
    } catch (err) {
      this.hosting = false;
      if (btn && btn.isConnected) { btn.disabled = false; if (label) label.innerHTML = before; }
      const text = netErrorText(err && err.code, err && err.message);
      if (text) {
        this.menus.sound('error');
        this.notice = { tone: 'error', text: `Raum konnte nicht eröffnet werden: ${text}`, code: err && err.code };
        this._renderNotice();
      }
      this._renderQuick();
      this._renderJoin();
      this._renderList();
    }
  }

  /** Fußzeile der Lobby im Mehrspieler-Reiter: Zusammenfassung der Raum-Vorgaben. */
  summaryHtml() {
    const d = this._data();
    const s = this.roomDefaults();
    const m = d.MODES[s.mode] || {};
    const map = d.MAPS[s.map] || {};
    return `<small>Mehrspieler · Vorgaben aus „Einsatz“</small><b>Eigener Raum</b><span>${esc(m.short || s.mode)} · ${esc(map.name || s.map)} · ${esc((d.DIFF[s.difficulty] || {}).name || s.difficulty)}</span>`;
  }

  /* ================================================================ Raum-Bildschirm */

  showRoom() {
    const net = this.net;
    const menus = this.menus;
    if (!this.inRoom()) { menus.showLobby({ tab: 'online', room: false }); return; }
    this._starting = false;
    const s = menus._screen('room', 'm-sub m-room', `
      <div class="sub sub-wide nr" data-role="${esc(net.role)}">
        <header class="sub-head nr-head">
          <button type="button" class="m-icon" data-act="back" aria-label="Raum verlassen" title="Raum verlassen">${ICON.back}</button>
          <div class="nr-titles"><div class="m-kicker" data-room-kicker></div><h1 class="m-title" data-room-title></h1></div>
          <div class="nr-code">
            <div class="nr-codebox"><small>Raumcode</small><b data-room-code></b></div>
            <div class="nr-codeact">
              <button type="button" class="m-btn" data-act="copy-link" data-fk="copy-link">${ICON.link}<span>Link kopieren</span></button>
              ${typeof navigator.share === 'function' ? `<button type="button" class="m-icon" data-act="share" aria-label="Einladung teilen" title="Einladung teilen">${ICON.userPlus}</button>` : ''}
            </div>
          </div>
        </header>
        <p class="sub-lead nr-hint" data-room-hint></p>
        <div class="nr-body m-scroll" data-scrollable>
          <section class="nr-players"><h2 class="m-h2">Spieler <span class="nr-count" data-room-count></span></h2><div data-room-roster></div></section>
          <section class="nr-settings"><h2 class="m-h2" data-room-sethead>Einstellungen</h2><div data-room-settings></div></section>
        </div>
        <div class="nr-confirm" data-room-confirm hidden></div>
        <footer class="nr-foot">
          <button type="button" class="m-btn m-ghost nr-leave" data-act="leave" data-fk="leave">${ICON.door}<span>Verlassen</span></button>
          <button type="button" class="m-btn nr-equip" data-act="room-equip" data-fk="room-equip">${ICON.target}<span>Ausrüstung</span></button>
          <div class="lb-summary nr-sum" data-room-sum></div>
          <div class="nr-go" data-room-go></div>
        </footer>
      </div>`);
    this.room = { s };
    s.addEventListener('click', (e) => this._onRoomClick(e));
    s.addEventListener('change', (e) => this._onRoomChange(e));
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-room-name]')) { e.preventDefault(); e.target.blur(); } });
    menus.parent = 'lobby';
    this._renderRoomAll();
    menus._focusFirst(s, net.role === 'host' ? '[data-act="room-start"]' : '[data-act="copy-link"]');
  }

  /** menus._leave: Raum-Bildschirm wird ersetzt. */
  unmountRoom() {
    if (!this.room) return;
    clearTimeout(this._copyT);
    this.room = null;
    this._leaveAsk = false;
    this._kickAsk = null;
  }

  _q(sel) {
    return this.room && this.room.s ? this.room.s.querySelector(sel) : null;
  }

  _renderRoomAll() {
    this._renderRoomHead();
    this._renderRoster();
    this._renderSettings();
    this._renderFoot();
  }

  _renderRoomHead() {
    const net = this.net;
    if (!this.room || !net || !net.room) return;
    const r = net.room;
    const s = r.settings || {};
    const host = net.role === 'host';
    const k = this._q('[data-room-kicker]');
    const t = this._q('[data-room-title]');
    const c = this._q('[data-room-code]');
    const h = this._q('[data-room-hint]');
    if (k) k.textContent = `Mehrspieler · ${host ? 'Du bist Host' : `Host: ${r.hostName || '–'}`}${r.public ? ' · öffentlich' : ' · privat'}`;
    if (t) t.innerHTML = `${esc(s.name || 'Raum')}<em>.</em>`;
    if (c) c.textContent = r.code || '––––––';
    if (h) {
      const rs = net.relayStatus || null;
      const off = host && rs && rs.total && rs.open === 0;
      h.className = `sub-lead nr-hint${off ? ' is-warn' : ''}`;
      h.innerHTML = off
        ? `${ICON.warn}<span>Keine Verbindung zu den Vermittlungsservern – neue Spieler können gerade nicht beitreten. Internetverbindung prüfen.</span>`
        : `${ICON.info}<span>${host ? 'Schick Freunden den Link – oder sie geben den Code unter <b>Mehrspieler → Beitreten</b> ein.' : 'Der Host stellt das Spiel ein und startet es. Deine Ausrüstung kannst du hier schon wählen.'}${rs && rs.total ? ` <i class="nr-relay">Vermittlung ${rs.open}/${rs.total}</i>` : ''}</span>`;
    }
  }

  /** Spielerliste: nach Teams (PvP), alle in einem Team (Koop) oder eine Liste (FFA); Bots als Platzhalterzeile. */
  _renderRoster() {
    const net = this.net;
    const box = this._q('[data-room-roster]');
    if (!box || !net || !net.room) return;
    const d = this._data();
    const s = net.room.settings || {};
    const roster = Array.isArray(net.roster) ? net.roster : [];
    const host = net.role === 'host';
    const me = roster.find((r) => r.id === net.selfId) || null;
    const myTeam = me && me.team === 'B' ? 'B' : 'A';
    const teams = this._isTeams(s.mode);
    const coop = s.pvp === 'coop';
    const cnt = this._q('[data-room-count]');
    if (cnt) cnt.textContent = `${roster.length}/${s.maxPlayers || '–'}`;
    const size = clampInt(s.teamSize || 6, 1, MAX_TEAM);
    const row = (r) => {
      const self = r.id === net.selfId;
      const side = !teams ? 'ffa' : (r.team === 'B' ? 'B' : 'A') === myTeam ? 'ally' : 'enemy';
      const cls = r.cls && CLASSES[r.cls] ? CLASSES[r.cls].name : '';
      const ping = Number(r.ping) || 0;
      const pingTxt = ping > 0 ? `${ping} ms` : '–';
      const ask = host && this._kickAsk === r.id;
      let acts = '';
      if (host && ask) {
        acts = `<span class="nr-ask">${esc(r.name)} entfernen?</span>
          <button type="button" class="m-btn m-danger nr-mini" data-act="kick-yes" data-id="${r.id}" data-fk="ky-${r.id}">${ICON.userX}<span>Entfernen</span></button>
          <button type="button" class="m-btn nr-mini" data-act="kick-no" data-id="${r.id}" data-fk="kn-${r.id}">${ICON.close}<span>Nein</span></button>`;
      } else if (host) {
        if (teams && !coop) acts += `<button type="button" class="m-btn nr-mini" data-act="team" data-id="${r.id}" data-fk="t-${r.id}" title="Team wechseln" aria-label="${esc(r.name)}: Team wechseln">${ICON.swap}<span>Team wechseln</span></button>`;
        if (!self) acts += `<button type="button" class="m-btn nr-mini m-danger" data-act="kick" data-id="${r.id}" data-fk="k-${r.id}" title="Aus dem Raum entfernen" aria-label="${esc(r.name)} entfernen">${ICON.userX}<span>Entfernen</span></button>`;
      }
      return `<div class="nr-p is-${side}${self ? ' is-me' : ''}${ask ? ' is-ask' : ''}" data-id="${r.id}">
        <i class="nr-dot" aria-hidden="true"></i>
        <span class="nr-pname"><b>${esc(r.name)}</b>${devBadge(r)}${r.isHost ? `<em class="nr-badge is-host" title="Host">${ICON.crown}Host</em>` : ''}${self ? '<em class="nr-badge is-me">Du</em>' : ''}<small>Stufe ${clampInt(r.level || 1, 1, 99)}${cls ? ` · ${esc(cls)}` : ''}${r.ready && net.room.state === 'match' ? ' · bereit' : ''}</small></span>
        ${r.isHost ? '<span class="nr-ping is-none"></span>' : `<span class="nr-ping is-${pingTone(ping)}" title="Ping">${ICON.signal}<span>${pingTxt}</span></span>`}
        <span class="nr-acts">${acts}</span>
      </div>`;
    };
    const bots = (n, label) => (n > 0 ? `<div class="nr-p nr-bots"><i class="nr-dot" aria-hidden="true"></i><span class="nr-pname"><b>${ICON.bot}${n} ${n === 1 ? 'Bot' : 'Bots'}</b><small>${esc(label)}</small></span></div>` : '');
    const group = (title, side, list, botN, botLabel, extra = '') => `
      <div class="nr-team is-${side}">
        <div class="nr-thead"><b>${esc(title)}</b>${extra}<span>${list.length} ${list.length === 1 ? 'Mensch' : 'Menschen'}</span></div>
        ${list.map(row).join('')}${bots(botN, botLabel)}
        ${!list.length && !botN ? '<div class="nr-p nr-free"><span class="nr-pname"><small>Noch niemand</small></span></div>' : ''}
      </div>`;
    keepFocus(box, () => {
      if (!teams) {
        const total = size * 2;
        const botN = s.botFill ? Math.max(0, total - roster.length) : 0;
        box.innerHTML = `<div class="nr-teams nr-one">${group('Jeder gegen jeden', 'ffa', roster, botN, 'füllen bis ' + total + ' Teilnehmer auf', '')}</div>`;
        return;
      }
      const other = myTeam === 'A' ? 'B' : 'A';
      if (coop) {
        const botsA = s.botFill ? Math.max(0, size - roster.length) : 0;
        box.innerHTML = `<div class="nr-teams">
          ${group(d.TEAMS.A, 'ally', roster, botsA, 'Bots kämpfen an eurer Seite', '<em class="nr-tag">Ihr</em>')}
          ${group(d.TEAMS.B, 'enemy', [], size, `Gegner (${esc((d.DIFF[s.difficulty] || {}).name || s.difficulty || '')})`, '<em class="nr-tag">Bots</em>')}
        </div>`;
        return;
      }
      const by = (t) => roster.filter((r) => (r.team === 'B' ? 'B' : 'A') === t);
      const botsFor = (t) => (s.botFill ? Math.max(0, size - by(t).length) : 0);
      box.innerHTML = `<div class="nr-teams">
        ${group(d.TEAMS[myTeam], 'ally', by(myTeam), botsFor(myTeam), 'füllen freie Plätze auf', '<em class="nr-tag">Dein Team</em>')}
        ${group(d.TEAMS[other], 'enemy', by(other), botsFor(other), 'füllen freie Plätze auf', '')}
      </div>`;
    });
  }

  /** Einstellungen: Host bearbeitet, Mitspieler sehen sie nur. */
  _renderSettings() {
    const net = this.net;
    const box = this._q('[data-room-settings]');
    if (!box || !net || !net.room) return;
    const head = this._q('[data-room-sethead]');
    const host = net.role === 'host';
    if (head) head.innerHTML = host ? 'Einstellungen' : 'Einstellungen <small>vom Host</small>';
    keepFocus(box, () => { box.innerHTML = host ? this._settingsEditHtml() : this._settingsViewHtml(); });
    this._renderRec();
  }

  _labels(s) {
    const d = this._data();
    const mode = d.MODES[s.mode] || {};
    const map = d.MAPS[s.map] || {};
    const times = Array.isArray(map.times) ? map.times : [];
    const t = s.time === 'zufall' ? 'Zufall' : s.time === 'echtzeit' ? 'Echtzeit (Uhr des Hosts)' : s.time && s.time !== 'standard' ? (times.find((x) => x.id === s.time) || {}).name || s.time : `${map.timeOfDay || 'Standard'}`;
    const wd = WEATHERS[map.weatherDefault];
    const w = s.weather === 'zufall' ? 'Zufall' : s.weather && s.weather !== 'standard' ? (WEATHERS[s.weather] || {}).name || s.weather : `Standard${wd ? ` (${wd.name})` : ''}`;
    return { mode, map, time: t, weather: w, diff: (d.DIFF[s.difficulty] || {}).name || s.difficulty, style: (GAME_STYLES[s.style] || GAME_STYLES.arcade || {}).label || s.style };
  }

  _settingsViewHtml() {
    const s = this.net.room.settings || {};
    const L = this._labels(s);
    const teams = this._isTeams(s.mode);
    const size = clampInt(s.teamSize || 6, 1, MAX_TEAM);
    const item = (k, v) => `<div class="nr-ro-i"><small>${esc(k)}</small><b>${esc(v)}</b></div>`;
    return `<div class="nr-ro">
      ${item('Modus', L.mode.name || s.mode)}${item('Karte', L.map.name || s.map)}
      ${item('Tageszeit', L.time)}${item('Wetter', L.weather)}
      ${item('Gegnerstärke', L.diff)}${item('Spielstil', L.style)}
      ${teams ? item('Spielart', s.pvp === 'coop' ? 'Gemeinsam gegen Bots' : 'Gegeneinander') : ''}
      ${item(teams ? 'Teamgröße' : 'Teilnehmer', teams ? `${size} gegen ${size}` : `${size * 2}`)}
      ${item('Bots', s.botFill ? 'füllen auf' : 'keine')}${item('Max. Spieler', String(s.maxPlayers || '–'))}
      ${item('Ausdauer', s.stamina === false ? 'unbegrenzt' : 'normal')}
    </div>`;
  }

  _settingsEditHtml() {
    const d = this._data();
    const s = this.net.room.settings || {};
    const map = d.MAPS[s.map] || {};
    const teams = this._isTeams(s.mode);
    const size = clampInt(s.teamSize || 6, 1, MAX_TEAM);
    const seg = (key, opts, cur, label, cls = '') => `<div class="nr-field${cls}"><h3 class="nr-lab">${esc(label)}</h3><div class="m-seg nr-seg" role="radiogroup" aria-label="${esc(label)}">${opts.map(([v, l, t, off]) => `<button type="button" role="radio" data-set="${esc(key)}" data-v="${esc(v)}" data-fk="${esc(key)}-${esc(v)}" aria-checked="${String(v) === String(cur)}"${off ? ' aria-disabled="true"' : ''}${t ? ` title="${esc(t)}"` : ''}>${l}</button>`).join('')}</div></div>`;
    const modes = d.ORDER.filter((id) => d.MODES[id]).map((id) => {
      const m = d.MODES[id];
      const on = ONLINE_MODES.includes(id);
      return [id, `${m.icon ? `<i class="nr-mico">${m.icon}</i>` : ''}<span>${esc(m.short || id)}</span>`, on ? m.name : `${m.name} – folgt in Stufe 2`, !on];
    }).sort((a, b) => a[3] - b[3]);
    const maps = this._mapsFor(s.mode).map((id) => [id, esc(d.MAPS[id].name), d.MAPS[id].subtitle || '']);
    const times = [['standard', esc(map.timeOfDay || 'Standard'), 'Tageszeit der Karte'], ...(Array.isArray(map.times) ? map.times : []).map((t) => [t.id, esc(t.name || t.id), '']), ['echtzeit', 'Echtzeit', 'Passend zur echten Uhrzeit (Uhr des Hosts)'], ['zufall', 'Zufall', 'Der Host würfelt beim Start']];
    const wxs = [['standard', 'Standard', map.weather || 'Wetter der Karte'], ...(Array.isArray(map.weathers) ? map.weathers : []).filter((w) => WEATHERS[w]).map((w) => [w, esc(WEATHERS[w].name), WEATHERS[w].short || '']), ['zufall', 'Zufall', 'Der Host würfelt beim Start']];
    const diffs = DIFF_ORDER.map((id) => [id, esc((d.DIFF[id] || {}).name || id), (d.DIFF[id] || {}).description || '']);
    const styles = (STYLE_ORDER || ['arcade', 'realistisch']).map((id) => [id, esc((GAME_STYLES[id] || {}).label || id), (GAME_STYLES[id] || {}).desc || '']);
    const stepper = (k, label, v, min, max, shown = v) => `
      <div class="lb-step nr-step"><span>${esc(label)}</span>
        <button type="button" class="m-icon" data-step="${k}" data-d="-1" data-fk="${k}-m" aria-label="${esc(label)} verringern"${v <= min ? ' disabled' : ''}>${ICON.minus}</button>
        <b>${shown}</b>
        <button type="button" class="m-icon" data-step="${k}" data-d="1" data-fk="${k}-p" aria-label="${esc(label)} erhöhen"${v >= max ? ' disabled' : ''}>${ICON.plusSmall}</button></div>`;
    const sw = (k, label, sub, on) => `<div class="nr-switch"><span class="nr-lab2"><b>${esc(label)}</b><small>${esc(sub)}</small></span><button type="button" class="m-switch" role="switch" data-toggle="${k}" data-fk="sw-${k}" aria-checked="${!!on}" aria-label="${esc(label)}"><i></i></button></div>`;
    const humans = Array.isArray(this.net.roster) ? this.net.roster.length : 1;
    const teamNote = !teams
      ? `${size * 2} Teilnehmer, jeder für sich${s.botFill ? ' – Bots füllen freie Plätze auf.' : '.'}`
      : s.pvp === 'coop'
        ? `Ihr (${humans} ${humans === 1 ? 'Mensch' : 'Menschen'}${s.botFill && size > humans ? ` + ${size - humans} Bots` : ''}) gegen ${size} Bots.`
        : `${size} gegen ${size}${s.botFill ? ' – Bots füllen freie Plätze auf.' : ' – nur Menschen, keine Bots.'}`;
    return `
      <div class="nr-form">
        ${seg('mode', modes, s.mode, 'Modus', ' nr-modes')}
        <p class="nr-modehint" data-room-modehint hidden></p>
        ${seg('map', maps, s.map, 'Karte')}
        <div class="nr-two">
          ${seg('time', times, s.time || 'standard', 'Tageszeit')}
          ${seg('weather', wxs, s.weather || 'standard', 'Wetter')}
        </div>
        <div class="nr-two">
          ${seg('difficulty', diffs, s.difficulty, 'Gegnerstärke')}
          ${seg('style', styles, s.style || 'arcade', 'Spielstil')}
        </div>
        ${teams ? seg('pvp', [['pvp', 'Gegeneinander', 'Menschen auf beide Teams verteilt'], ['coop', 'Gemeinsam gegen Bots', 'Alle Menschen in einem Team']], s.pvp || 'pvp', 'Spielart') : ''}
        <div class="nr-two nr-counts">
          <div class="nr-field">
            <h3 class="nr-lab">Größe</h3>
            ${stepper('teamSize', teams ? 'Teamgröße' : 'Teilnehmer', size, 1, MAX_TEAM, teams ? size : size * 2)}
            <p class="lb-note">${esc(teamNote)}</p>
          </div>
          <div class="nr-field">
            <h3 class="nr-lab">Plätze für Menschen</h3>
            ${stepper('maxPlayers', 'Max. Spieler', clampInt(s.maxPlayers || 8, 2, MAX_PLAYERS), Math.max(2, humans), MAX_PLAYERS)}
            <div data-room-rec></div>
          </div>
        </div>
        <div class="nr-two">
          ${sw('botFill', 'Bots füllen auf', 'Freie Plätze bekommen Bots', s.botFill !== false)}
          ${sw('public', 'Öffentlich', 'In der Liste öffentlicher Spiele und für „Schnell spielen“', !!s.public)}
        </div>
        <div class="nr-two">
          ${sw('stamina', 'Ausdauer', s.stamina === false ? 'Aus: unbegrenzt sprinten, rutschen, springen – für alle' : 'Sprinten, Rutschen und Springen kosten Ausdauer', s.stamina !== false)}
        </div>
        <div class="nr-field nr-namefield">
          <h3 class="nr-lab">Raumname</h3>
          <input type="text" class="m-input" data-room-name data-fk="room-name" maxlength="24" spellcheck="false" aria-label="Raumname" value="${esc(s.name || '')}">
        </div>
      </div>`;
  }

  /** Empfehlung für die maximale Spielerzahl (G.net.recommendation) + Warnung darüber. */
  _renderRec() {
    const box = this._q('[data-room-rec]');
    const net = this.net;
    if (!box || !net || !net.room) return;
    let r = null;
    try { r = typeof net.recommendation === 'function' ? net.recommendation() : null; } catch { r = null; }
    if (!r || !r.max) { box.innerHTML = ''; return; }
    const max = clampInt(net.room.settings.maxPlayers || 8, 2, MAX_PLAYERS);
    const reason = r.reason ? ` (${r.reason})` : '';
    let warn = '';
    if (max > r.max) {
      const red = max > Math.max(r.max * 1.5, r.max + 6);
      warn = `<p class="lb-warn is-${red ? 'red' : 'yellow'}">${ICON.warn}<span>${red
        ? `Weit über der Empfehlung: Bei ${max} Spielern sind Ruckler und Verbindungsabbrüche wahrscheinlich.`
        : `Mehr als empfohlen: Bei ${max} Spielern kann dein Gerät oder deine Leitung an die Grenze kommen.`}</span></p>`;
    }
    box.innerHTML = `<p class="lb-note nr-rec">${ICON.signal}<span>Empfehlung: bis <b>${r.max}</b> Spieler${esc(reason)}</span></p>${warn}`;
  }

  _renderFoot() {
    const net = this.net;
    if (!this.room || !net || !net.room) return;
    const d = this._data();
    const s = net.room.settings || {};
    const host = net.role === 'host';
    const roster = Array.isArray(net.roster) ? net.roster : [];
    const sum = this._q('[data-room-sum]');
    const go = this._q('[data-room-go]');
    const m = d.MODES[s.mode] || {};
    const map = d.MAPS[s.map] || {};
    const size = clampInt(s.teamSize || 6, 1, MAX_TEAM);
    const teams = this._isTeams(s.mode);
    if (sum) sum.innerHTML = `<small>${esc(m.short || s.mode)} · ${esc(map.name || s.map)}</small><b>${esc(m.name || s.mode)}</b><span>${teams ? `${size} gegen ${size}` : `${size * 2} Teilnehmer`} · ${roster.length}/${s.maxPlayers} Spieler</span>`;
    if (go) {
      const starting = this._starting || net.room.state === 'match';
      keepFocus(go, () => {
        go.innerHTML = host
          ? `<button type="button" class="m-btn m-primary lb-start nr-start" data-act="room-start" data-fk="room-start"${starting ? ' disabled' : ''}>${ICON.play}<span>${starting ? 'Startet …' : 'Match starten'}<em>.</em></span></button>`
          : `<div class="nr-wait" role="status"><i class="nm-spin" aria-hidden="true"></i><span>${starting ? 'Match läuft beim Host …' : 'Warte auf den Host …'}</span></div>`;
      });
    }
  }

  _onRoomClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const net = this.net;
    if (b.getAttribute('aria-disabled') === 'true') {
      this.menus.sound('error');
      const hint = this._q('[data-room-modehint]');
      if (hint && b.dataset.set === 'mode') { hint.hidden = false; hint.textContent = `${b.title || 'Dieser Modus'}. Online gibt es vorerst Team-Deathmatch, Herrschaft, Kill Confirmed und Jeder gegen jeden.`; }
      return;
    }
    if (b.disabled || !net) return;
    const ds = b.dataset;
    const act = ds.act;
    const host = net.role === 'host';
    if (act === 'back' || act === 'leave') { this.askLeave(); return; }
    if (act === 'leave-yes') { this.leaveRoom(); return; }
    if (act === 'leave-no') { this._closeConfirm(); return; }
    if (act === 'copy-link') { this._copyLink(b); return; }
    if (act === 'share') { this._share(); return; }
    if (act === 'room-equip') { this.showRoomEquip(); return; }
    if (act === 'room-start' && host) { this._start(); return; }
    if (!host) return;
    const id = Number(ds.id);
    if (act === 'team') {
      const r = (net.roster || []).find((x) => x.id === id);
      if (r) { net.setTeam(id, r.team === 'B' ? 'A' : 'B'); this.menus.sound('click'); }
      return;
    }
    if (act === 'kick') { this._kickAsk = id; this.menus.sound('click'); this._renderRoster(); this._focusIn('[data-room-roster]', `[data-act="kick-no"][data-id="${id}"]`); return; }
    if (act === 'kick-no') { this._kickAsk = null; this.menus.sound('back'); this._renderRoster(); this._focusIn('[data-room-roster]', `[data-act="kick"][data-id="${id}"]`); return; }
    if (act === 'kick-yes') {
      this._kickAsk = null;
      const r = (net.roster || []).find((x) => x.id === id);
      net.kick(id, 'Vom Host entfernt');
      this.menus.sound('back');
      if (r) this.toast(`${r.name} wurde aus dem Raum entfernt.`, 'warn');
      this._renderRoster();
      return;
    }
    if (ds.set) { this._update({ [ds.set]: ds.v }); return; }
    if (ds.step) {
      const s = net.room.settings;
      const d = Number(ds.d) || 0;
      if (ds.step === 'maxPlayers') this._update({ maxPlayers: clampInt((s.maxPlayers || 8) + d, Math.max(2, (net.roster || []).length), MAX_PLAYERS) });
      else if (ds.step === 'teamSize') this._update({ teamSize: clampInt((s.teamSize || 6) + d, 1, MAX_TEAM) });
      return;
    }
    if (ds.toggle) {
      const s = net.room.settings;
      // Standard an (fehlt der Wert, gilt an): botFill, stamina
      this._update({ [ds.toggle]: ds.toggle === 'botFill' || ds.toggle === 'stamina' ? s[ds.toggle] === false : !s[ds.toggle] }, 'toggle');
    }
  }

  _onRoomChange(e) {
    const t = e.target;
    if (!t.matches('[data-room-name]') || !this.net || this.net.role !== 'host') return;
    const v = t.value.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (v !== (this.net.room.settings.name || '')) this._update({ name: v }, null);
  }

  _update(partial, sound = 'click') {
    const net = this.net;
    if (!net || net.role !== 'host' || typeof net.updateSettings !== 'function') return;
    const before = this._roomEvents;
    try { net.updateSettings(partial); } catch (err) { console.warn('[net-ui] Einstellungen', err); }
    if (sound) this.menus.sound(sound);
    // net:room zeichnet neu – meldet die Umsetzung nichts, trotzdem aktualisieren
    if (this._roomEvents === before) this._renderRoomAll();
  }

  _focusIn(boxSel, sel) {
    const n = this._q(boxSel) && this._q(boxSel).querySelector(sel);
    if (n) try { n.focus({ preventScroll: true }); } catch { /* */ }
  }

  _start() {
    const net = this.net;
    if (!net || net.role !== 'host' || this._starting) return;
    this._starting = true;
    this.menus.sound('confirm');
    const b = this._q('[data-act="room-start"]');
    if (b) b.classList.add('is-go');
    try { const l = this._lobby(); if (l) l.saveClassLoadout(); } catch { /* */ }
    this._renderFoot();
    let cfg = null;
    try { cfg = net.startMatch(); } catch (err) { console.error('[net-ui] Matchstart', err); }
    if (!cfg) {
      this._starting = false;
      this._renderFoot();
      this.toast('Das Match konnte nicht gestartet werden.', 'error');
    }
    // Rückfall: steht der Raum nach ein paar Sekunden noch, Knopf wieder freigeben
    setTimeout(() => { if (this._starting && this.menus.current === 'room') { this._starting = false; this._renderFoot(); } }, 6000);
  }

  /** Verlassen: Host mit Mitspielern fragt nach, sonst sofort. */
  askLeave() {
    const net = this.net;
    if (!net || !net.online) { this.menus.showLobby({ tab: 'online', room: false }); return; }
    const others = (net.roster || []).filter((r) => r.id !== net.selfId).length;
    if (net.role === 'host' && others > 0) {
      if (this._leaveAsk) { this._closeConfirm(); return; }
      this._leaveAsk = true;
      const c = this._q('[data-room-confirm]');
      if (c) {
        c.hidden = false;
        c.innerHTML = `<p>${ICON.warn}<span>Raum schließen? ${others === 1 ? 'Dein Mitspieler wird' : `Alle ${others} Mitspieler werden`} getrennt.</span></p>
          <div class="m-actions"><button type="button" class="m-btn m-danger" data-act="leave-yes">${ICON.door}<span>Raum schließen</span></button><button type="button" class="m-btn" data-act="leave-no">${ICON.back}<span>Bleiben</span></button></div>`;
        this.menus.sound('click');
        this.menus._focusFirst(c, '[data-act="leave-no"]');
      }
      return;
    }
    this.leaveRoom();
  }

  _closeConfirm() {
    this._leaveAsk = false;
    const c = this._q('[data-room-confirm]');
    if (c) { c.hidden = true; c.innerHTML = ''; }
    this.menus.sound('back');
    if (this.room) this.menus._focusFirst(this.room.s, '[data-act="leave"]');
  }

  /** Esc/B im Raum: offene Rückfrage schließen, sonst verlassen (mit Rückfrage). */
  back() {
    if (this._kickAsk != null) { this._kickAsk = null; this._renderRoster(); this.menus.sound('back'); return; }
    if (this._leaveAsk) { this._closeConfirm(); return; }
    this.askLeave();
  }

  leaveRoom() {
    const net = this.net;
    this._leaveAsk = false;
    try { if (net && net.online) net.leave('verlassen'); } catch (err) { console.warn('[net-ui] Verlassen', err); }
    this.menus.sound('back');
    this.menus.showLobby({ tab: 'online', room: false });
  }

  async _copyLink(btn) {
    const net = this.net;
    if (!net || !net.room) return;
    const url = roomLink(net.room.code);
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch { ok = false; }
    if (!ok) {
      // Rückfall ohne Clipboard-API (http, ältere Browser): unsichtbares Textfeld
      try {
        const ta = el('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch { ok = false; }
    }
    this.menus.sound(ok ? 'confirm' : 'error');
    const span = btn && btn.querySelector('span');
    if (span) {
      span.textContent = ok ? 'Kopiert!' : 'Nicht möglich';
      btn.classList.toggle('is-done', ok);
      clearTimeout(this._copyT);
      this._copyT = setTimeout(() => { if (btn.isConnected) { span.textContent = 'Link kopieren'; btn.classList.remove('is-done'); } }, 1800);
    }
    if (!ok) this.toast(`Link: ${url}`, 'info', 8);
  }

  _share() {
    const net = this.net;
    if (!net || !net.room || typeof navigator.share !== 'function') return;
    const url = roomLink(net.room.code);
    navigator.share({ title: 'NULLPUNKT – komm in meinen Raum', text: `Raumcode ${net.room.code}`, url }).catch(() => {});
  }

  /** Ausrüstung im Raum (gilt ab dem Matchstart; Client meldet sie dem Host, falls G.net.setLoadout vorhanden). */
  showRoomEquip() {
    const G = this.G;
    const menus = this.menus;
    const l = this._lobby();
    const c = (l && l.cfg) || {};
    const s = menus._screen('roomequip', 'm-sub', `
      <div class="sub sub-wide">
        <header class="sub-head"><button type="button" class="m-icon" data-act="back" aria-label="Zurück">${ICON.back}</button><div><div class="m-kicker">Raum</div><h1 class="m-title">Ausrüstung<em>.</em></h1></div></header>
        <p class="sub-lead">Gilt ab dem Start des Matches.</p>
        <div class="sub-body m-scroll eq-host" data-scrollable></div>
        <div class="m-actions eq-actions"><button type="button" class="m-btn m-primary" data-act="apply">${ICON.check}<span>Übernehmen</span></button><button type="button" class="m-btn" data-act="back">${ICON.back}<span>Abbrechen</span></button></div>
      </div>`);
    const panel = (this._equipPanel = this._equipPanel || new LoadoutPanel(G));
    panel.mount(s.querySelector('.eq-host'), { primary: c.primary, secondary: c.secondary, lethal: c.lethal, cls: c.cls });
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'back') { panel.unmount(); menus.sound('back'); this.showRoom(); return; }
      if (b.dataset.act === 'apply') {
        const lo = panel.value();
        panel.save();
        if (l && l.cfg) Object.assign(l.cfg, { primary: lo.primary, secondary: lo.secondary, lethal: lo.lethal, cls: lo.cls });
        const net = this.net;
        try { if (net && typeof net.setLoadout === 'function') net.setLoadout({ cls: lo.cls, loadout: lo }); } catch { /* */ }
        menus.sound('confirm');
        panel.unmount();
        this.showRoom();
      }
    });
    menus.parent = 'room';
    menus._focusFirst(s, '.lp-cls[aria-pressed="true"]');
  }

  /** Esc/B auf der Ausrüstungsseite des Raums. */
  backFromEquip() {
    if (this._equipPanel) this._equipPanel.unmount();
    this.menus.sound('back');
    this.showRoom();
  }

  /* ================================================================ Ereignisse */

  _onRoster() {
    if (this.room) { this._renderRoster(); this._renderFoot(); this._renderRec(); }
    if (this.menus.current === 'pause') this._renderPauseList();
  }

  _onRoom() {
    this._roomEvents = (this._roomEvents || 0) + 1;
    if (!this.room) return;
    const net = this.net;
    if (net && net.room && net.room.state === 'lobby') this._starting = false;
    this._renderRoomHead();
    // Host: eigene Änderungen zeichnet _update schon; Clients übernehmen die Einstellungen des Hosts
    this._renderSettings();
    this._renderRoster();
    this._renderFoot();
  }

  _onStatus() {
    const net = this.net;
    if (this.room) {
      if (!net || !net.online) {
        // Sitzung weg ohne eigenes Verlassen (z. B. Relay/Host) – Lobby mit Hinweis, falls _onLost nichts gesetzt hat
        if (this.menus.current === 'room' || this.menus.current === 'roomequip') this.menus.showLobby({ tab: 'online', room: false });
        return;
      }
      this._renderRoomHead();
    }
  }

  _onPeer(e) {
    const net = this.net;
    if (!e || !net || !net.online || e.id === net.selfId) return;
    const name = e.name || 'Ein Spieler';
    if (e.joined) this.toast(`${name} ist beigetreten.`, 'ok');
    else if (e.reason === 'gekickt') { /* Hinweis kam schon beim Entfernen */ }
    else this.toast(`${name} hat den Raum verlassen.`, 'info');
  }

  /** Sitzung verloren (Kick, Host weg): Hinweis, Raum/Match verlassen, im Reiter erklären. */
  _onLost(code, reason) {
    const text = code === 'gekickt'
      ? `Du wurdest aus dem Raum entfernt${reason && !/^vom host entfernt$/i.test(reason) ? ` (${reason})` : ''}.`
      : netErrorText(code);
    this.notice = { tone: code === 'gekickt' ? 'error' : 'warn', text, code };
    const menus = this.menus;
    const G = this.G;
    const st = G.match ? G.match.state : 'lobby';
    if (menus.current === 'room' || menus.current === 'roomequip') { menus.showLobby({ tab: 'online', room: false }); return; }
    if (menus.current === 'lobby') { if (menus.lobby) { menus.lobby.tab = 'online'; menus.lobby._syncTab(); } this._renderNotice(); return; }
    this.toast(text, code === 'gekickt' ? 'error' : 'warn', 6);
    if (menus.lobby) menus.lobby.tab = 'online';
    // Im laufenden Match (nicht auf dem Endbildschirm): kurz lesen lassen, dann zurück in die Lobby
    if (IN_MATCH.includes(st)) {
      clearTimeout(this._lostT);
      this._lostT = setTimeout(() => {
        if (IN_MATCH.includes(G.match.state) && !(this.net && this.net.online) && typeof menus.onQuit === 'function') menus.onQuit();
      }, 2600);
    }
  }

  /* ================================================================ Pausenmenü (online) */

  /** Zusatz für das Pausenmenü: Hinweis, Raumzeile, für den Host die Spielerliste mit Entfernen. */
  pauseHtml() {
    const net = this.net;
    if (!net || !net.online) return '';
    const host = net.role === 'host';
    const r = net.room || {};
    return `<div class="ps-online">${ICON.globe}<span><b>Online-Spiel</b> – das Spiel läuft weiter.</span></div>
      <div class="ps-room"><span>Raum <b>${esc(r.code || '–')}</b></span>${host ? '<span>Du bist Host</span>' : `<span>Host: ${esc(r.hostName || '–')}</span>`}</div>
      ${host ? '<div class="ps-net" data-pause-net></div>' : ''}`;
  }

  /** Nach dem Aufbau des Pausenmenüs: Liste zeichnen und Klicks (Entfernen mit Rückfrage) binden. */
  bindPause(screen) {
    this._pauseKick = null;
    this._renderPauseList();
    screen.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pk]');
      if (!b || !this.net) return;
      e.stopPropagation();
      const id = Number(b.dataset.id);
      if (b.dataset.pk === 'ask') { this._pauseKick = id; this.menus.sound('click'); }
      else if (b.dataset.pk === 'no') { this._pauseKick = null; this.menus.sound('back'); }
      else if (b.dataset.pk === 'yes') {
        const r = (this.net.roster || []).find((x) => x.id === id);
        this._pauseKick = null;
        this.net.kick(id, 'Vom Host entfernt');
        this.menus.sound('back');
        if (r) this.toast(`${r.name} wurde aus dem Raum entfernt.`, 'warn');
      }
      this._renderPauseList();
    });
  }

  _renderPauseList() {
    const box = this.menus.root.querySelector('[data-pause-net]');
    const net = this.net;
    if (!box || !net || net.role !== 'host') return;
    const roster = Array.isArray(net.roster) ? net.roster : [];
    const s = (net.room && net.room.settings) || {};
    const me = roster.find((r) => r.id === net.selfId);
    const myTeam = me && me.team === 'B' ? 'B' : 'A';
    const teams = this._isTeams(s.mode);
    keepFocus(box, () => {
      box.innerHTML = `<h2 class="m-h2">Spieler ${roster.length}/${s.maxPlayers || '–'}</h2>
        <div class="ps-net-list m-scroll" data-scrollable>${roster.map((r) => {
          const side = !teams ? 'ffa' : (r.team === 'B' ? 'B' : 'A') === myTeam ? 'ally' : 'enemy';
          const self = r.id === net.selfId;
          const ask = this._pauseKick === r.id;
          const ping = Number(r.ping) || 0;
          return `<div class="ps-np is-${side}${ask ? ' is-ask' : ''}">
            <i class="nr-dot" aria-hidden="true"></i><b>${devIcon(r)}${esc(r.name)}</b>${self ? '<em class="nr-badge is-me">Du</em>' : ''}
            <span class="nr-ping is-${r.isHost ? 'none' : pingTone(ping)}">${r.isHost ? '<em class="nr-badge is-host">Host</em>' : ping > 0 ? `${ping} ms` : '–'}</span>
            ${self ? '' : ask
              ? `<button type="button" class="m-btn m-danger nr-mini" data-pk="yes" data-id="${r.id}" data-fk="pk-y-${r.id}">${ICON.userX}<span>Entfernen</span></button><button type="button" class="m-btn nr-mini" data-pk="no" data-id="${r.id}" data-fk="pk-n-${r.id}">${ICON.close}<span>Nein</span></button>`
              : `<button type="button" class="m-icon nr-kick" data-pk="ask" data-id="${r.id}" data-fk="pk-${r.id}" aria-label="${esc(r.name)} entfernen" title="Entfernen">${ICON.userX}</button>`}
          </div>`;
        }).join('')}${roster.length <= 1 ? '<p class="lb-note">Noch keine Mitspieler – Raumcode teilen.</p>' : ''}</div>`;
    });
  }

  /* ================================================================ Hinweise (Toasts) */

  /** Kurzer Hinweis unten links (über HUD und Menüs). tone: ok | info | warn | error */
  toast(text, tone = 'info', life = TOAST_LIFE) {
    if (!text) return;
    let box = this._toastBox;
    if (!box || !box.isConnected) {
      box = this._toastBox = el('div', 'nt');
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      (document.getElementById('game-root') || document.body).appendChild(box);
    }
    const icon = tone === 'ok' ? ICON.userPlus : tone === 'error' || tone === 'warn' ? ICON.warn : ICON.globe;
    const n = el('div', `nt-item is-${tone}`, `${icon}<span>${esc(text)}</span>`);
    box.appendChild(n);
    this._toasts.push({ n, until: performance.now() + life * 1000 });
    while (this._toasts.length > 4) this._toasts.shift().n.remove();
    if (!this._toastRaf) this._toastTick();
  }

  _toastTick() {
    this._toastRaf = 0;
    const now = performance.now();
    for (let i = this._toasts.length - 1; i >= 0; i--) {
      const t = this._toasts[i];
      if (now > t.until + 400) { t.n.remove(); this._toasts.splice(i, 1); }
      else if (now > t.until) t.n.classList.add('is-out');
    }
    if (this._toasts.length) this._toastRaf = window.setTimeout(() => this._toastTick(), 200);
  }

  dispose() {
    this.unmountPane();
    this.unmountRoom();
    for (const off of this._offs) off();
    this._offs = [];
    clearTimeout(this._toastRaf);
    clearTimeout(this._lostT);
    clearInterval(this._netT);
    if (this._toastBox) this._toastBox.remove();
  }
}
