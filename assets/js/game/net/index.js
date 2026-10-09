// NULLPUNKT – Mehrspieler: NetSystem (G.net) – Sitzung, Raum, Roster, Nachrichten-Routing, Zeitabgleich,
// Spielstart und Empfehlung (Vertrag docs/planung/mehrspieler.md §3, §4, §6, §9).
//
// Stern-Topologie: Der Host-Browser hält zu jedem Client eine WebRTC-Verbindung (peer.js); gefunden wird er über
// Nostr-Relays (signal.js). Der Konstruktor baut KEINE Verbindung auf – erst host(), join(), watchPublic() und
// quickPlay() verbinden sich mit den Relays.
//
// Zuverlässige Nachrichten (JSON, Feld t): Raum-Nachrichten (join/welcome/room/roster/start/kick/leave/ready/loadout/
// reject/host-away) verarbeitet NetSystem selbst und reicht sie danach an on(t)-Abos weiter; Spiel-Nachrichten
// (hit/kill/spawn/mode/ev/end/correct/throw/melee …) werden nur weitergereicht – ihre Bedeutung liegt in den
// sync-Modulen (G.net.sync). Interne Typen beginnen mit „_“ (_ts/_tr Zeitabgleich, _fw Weiterleitung) und werden nie
// weitergereicht. Schnelle Pakete (ArrayBuffer, protocol.js) gehen an onFast-Abos; Typen ≥ 200 sind reserviert.
//
// Spielstart: startMatch() (Host) baut die Konfiguration (§6), schickt 'start' {cfg} an alle Clients und startet
// selbst über this.startGame(cfg) – Standard: G.menus.onStart(cfg) (= main.startMatch). Clients starten bei 'start'
// bzw. beim Einstieg ins laufende Spiel (welcome.cfg) genauso. cfg.net = {role, roomCode, selfId, team, teamSize, pvp,
// botFill, maxPlayers, botsA, botsB, humans:{A,B}, stamina, vehicles, thirdPerson, vehReload}; Wetter/Zeit sind aufgelöst
// (nie 'zufall'/'echtzeit'). stamina false (Raum-Einstellung „Ausdauer“ aus) = unbegrenzte Ausdauer für alle: beim
// Matchstart (match:state) setzt NetSystem G.match.styleFlags.staminaMult = 0 (stamina.js: 0 = unbegrenzt).
// vehicles (Raum-Einstellung „Fahrzeuge“, Standard VEHICLES_ONLINE_DEFAULT): Host simuliert die Fahrzeuge, Clients führen
// ein Abbild (vehicles/net.js); thirdPerson = Außenansicht in Fahrzeugen erlaubt; vehReload 'manuell' | 'automatisch'.
import { HostSignal, joinRoom, watchLobby, relaysFromUrl, DEFAULT_RELAYS, newRoomCode, normCode, isValidCode } from './signal.js';
import { PeerLink, ICE_SERVERS } from './peer.js';
import { hex, randomBytes } from './crypto.js';
import { BUILD } from '../../shared/build.js';
import { MAPS, MAP_ORDER } from '../../shared/maps.data.js';
import { MODES, DIFFICULTY_ORDER } from '../../shared/modes.data.js';
import { GAME_STYLES, CLASSES, ARMOR_TIERS, HELMETS } from '../../shared/classes.data.js';
import { WEAPONS, EQUIPMENT, CAMOS } from '../../shared/weapons.data.js';
import { AntiCheat, PositionHistory } from './anticheat.js';
import { recommend, UploadMeter } from './recommend.js';
import { PKT_INTERNAL_MIN, packetType } from './protocol.js';

/** Spielprotokoll (Nachrichten/Pakete). Muss bei Host und Client gleich sein – zusätzlich zur Fassung (BUILD).
 *  2: Fahrzeuge online (Snapshot-Anhang, Fahrzeug-Absicht, 'veh'/'vhit'/'vehicles' – panzer-mp.md §C). */
export const NET_VERSION = 2;
/** Stufe 1: nur diese Modi online (cq/gun/inf/training folgen in Stufe 2). */
export const ONLINE_MODES = Object.freeze(['tdm', 'ffa', 'dom', 'kc']);
export const HOST_ID = 1;
export const FIRST_CLIENT_ID = 2;
export const FIRST_BOT_ID = 1000;
export const MAX_PLAYERS = 32;

/** Fehlertexte zu den Fehlercodes (Error.code bzw. net:error {code}). */
export const NET_ERROR_TEXT = Object.freeze({
  'kein-relay': 'Keine Verbindung zu den Vermittlungsservern (Relays).',
  'kein-host': 'Kein offener Raum mit diesem Code gefunden.',
  'keine-antwort': 'Der Host antwortet nicht.',
  'keine-begruessung': 'Verbunden, aber der Host hat den Beitritt nicht bestätigt.',
  'abgelehnt:voll': 'Der Raum ist voll.',
  'abgelehnt:version': 'Anderer Spielstand – bitte beide die Seite neu laden.',
  'abgelehnt:gekickt': 'Du wurdest aus diesem Raum entfernt.',
  'abgelehnt:fehler': 'Der Host konnte die Anfrage nicht annehmen.',
  'verbindung-fehlgeschlagen': 'Direkte Verbindung fehlgeschlagen (Netzwerk, Firewall oder Mobilfunk).',
  'host-weg': 'Verbindung zum Host verloren.',
  'host-beendet': 'Der Host hat den Raum geschlossen.',
  abgebrochen: 'Beitritt abgebrochen.',
});

/**
 * Fahrzeuge online (panzer-mp.md §C.1): Standard der Raum-Einstellung „Fahrzeuge“. Freigabe-Schalter – false: online
 * verhält sich alles wie ohne Fahrzeuge (Host kann sie je Raum trotzdem einschalten).
 */
export const VEHICLES_ONLINE_DEFAULT = true;

/** Raum-Einstellungen (§6) – Standardwerte. */
export const DEFAULT_ROOM = Object.freeze({
  name: '', mode: 'tdm', map: 'hafen', time: 'standard', weather: 'standard', difficulty: 'regulaer',
  maxPlayers: 8, botFill: true, teamSize: 6, pvp: 'pvp', public: false, style: 'arcade', scoreLimit: null, timeLimit: null,
  stamina: true, // Ausdauer an (aus = unbegrenzte Ausdauer für alle)
  // Fahrzeuge (Panzer + Geländewagen für beide Teams), Außenansicht in Fahrzeugen, Nachladen der Panzerkanone
  vehicles: VEHICLES_ONLINE_DEFAULT, thirdPerson: true, vehReload: 'manuell',
});

const TIME_SYNC_MS = 2000;
const TICK_MS = 1000;
const ROSTER_PING_EVERY = 3; // Sekunden-Takte
const OPEN_WAIT_MS = 16000;
// Beitritt: ein beschäftigter Host (Kartenaufbau beim Matchstart, langsames Gerät) antwortet erst nach seinem langen Bild –
// 'welcome' darf daher 20 s dauern; der Host wartet ab seiner Antwort 25 s auf 'join' (Kanäle öffnen ≤ 16 s + Zustellung)
const WELCOME_WAIT_MS = 20000;
const HELLO_WAIT_MS = 25000;
const FLOOD_PER_SEC = 400;
const BYTE_OVERHEAD = 60; // grobe Kopfdaten je Paket (IP/UDP/DTLS/SCTP) für die Upload-Messung
const LOCAL_RELAY = /^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;

/** Typen, die NetSystem selbst kennt: Clients dürfen sie nicht an andere Clients weiterleiten lassen ('order': Befehlsrad
 *  eines Clients an die Bots um seine Puppe – nur der Host wertet ihn aus, net/sync-host.js; 'veh'/'vhit': Fahrzeug-
 *  Anfragen und -Treffer an den Host, 'actors'/'vehicles': Listen des Hosts). */
const RESERVED = new Set([
  'join', 'ready', 'loadout', 'hit', 'melee', 'throw', 'leave', 'hold', 'plate', 'dev', 'order', 'veh', 'vhit',
  'welcome', 'room', 'roster', 'start', 'spawn', 'kill', 'mode', 'ev', 'end', 'kick', 'host-away', 'correct', 'reject', 'actors', 'vehicles',
]);
/** Nur der Host darf sie senden (der Host verwirft sie von Clients). */
const HOST_ONLY = new Set(['welcome', 'room', 'roster', 'start', 'spawn', 'kill', 'mode', 'ev', 'end', 'kick', 'host-away', 'correct', 'reject', 'actors', 'vehicles']);

/** Gerät eines Menschen im Roster (Symbol in Punktetabelle und Spielerliste): PC, Handy/Tablet (Touch), VR-Brille. */
export const DEVICES = Object.freeze(['pc', 'mobile', 'vr']);
const normDevice = (d) => (DEVICES.includes(d) ? d : 'pc');

const nowSec = () => performance.now() / 1000;
const clampInt = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; };
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/** Fehler mit Code (Vertrag: join wirft Error mit .code). */
export function netError(code, text) {
  const e = new Error(text || NET_ERROR_TEXT[code] || code);
  e.code = code;
  e.text = e.message;
  return e;
}

/** Karten, auf denen ein Modus online gespielt werden kann (ohne Schießstand). */
export function mapsForMode(mode) {
  const ids = MAP_ORDER.filter((id) => MAPS[id] && id !== 'range');
  const list = ids.filter((id) => Array.isArray(MAPS[id].modes) && MAPS[id].modes.includes(mode));
  return list.length ? list : ids;
}

/** Raum-Einstellungen prüfen/vervollständigen (§6). base = bisherige Einstellungen (Rückfall). */
export function normalizeSettings(partial = {}, base = DEFAULT_ROOM, hostName = 'Host') {
  const p = partial || {};
  const b = { ...DEFAULT_ROOM, ...(base || {}) };
  const pick = (k) => (p[k] !== undefined ? p[k] : b[k]);
  const mode = ONLINE_MODES.includes(pick('mode')) ? pick('mode') : ONLINE_MODES.includes(b.mode) ? b.mode : 'tdm';
  const maps = mapsForMode(mode);
  const rec = (MODES[mode] && MODES[mode].recommendedMaps) || [];
  const map = [pick('map'), b.map, ...rec, maps[0]].find((id) => id && maps.includes(id)) || 'hafen';
  const meta = MAPS[map] || {};
  const times = (Array.isArray(meta.times) ? meta.times : []).map((t) => t.id);
  const weathers = Array.isArray(meta.weathers) ? meta.weathers : [];
  const time = pick('time');
  const weather = pick('weather');
  const limit = (v, lo, hi) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Math.min(hi, Math.max(lo, Number(v))));
  return {
    name: str(pick('name'), 24) || `${str(hostName, 16) || 'Host'}s Raum`,
    mode,
    map,
    time: time === 'zufall' || time === 'echtzeit' || times.includes(time) ? time : 'standard',
    weather: weather === 'zufall' || weathers.includes(weather) ? weather : 'standard',
    difficulty: DIFFICULTY_ORDER.includes(pick('difficulty')) ? pick('difficulty') : DIFFICULTY_ORDER.includes(b.difficulty) ? b.difficulty : 'regulaer',
    maxPlayers: clampInt(pick('maxPlayers'), 2, MAX_PLAYERS, 8),
    botFill: pick('botFill') !== false,
    teamSize: clampInt(pick('teamSize'), 1, 16, 6),
    pvp: pick('pvp') === 'coop' ? 'coop' : 'pvp',
    public: pick('public') === true,
    style: GAME_STYLES[pick('style')] ? pick('style') : 'arcade',
    scoreLimit: limit(pick('scoreLimit'), 1, 9999),
    timeLimit: limit(pick('timeLimit'), 30, 7200),
    stamina: pick('stamina') !== false,
    // Fahrzeuge: fehlt der Wert (alter Raum) → Standard; Außenansicht nur ausdrücklich aus; Nachladen 'manuell' | 'automatisch'
    vehicles: pick('vehicles') === true,
    thirdPerson: pick('thirdPerson') !== false,
    vehReload: pick('vehReload') === 'automatisch' ? 'automatisch' : 'manuell',
  };
}

/** Ausrüstung eines Clients prüfen: nur bekannte Waffen im richtigen Platz, unbekannte Felder fallen weg. */
export function sanitizeLoadout(lo) {
  if (!lo || typeof lo !== 'object') return null;
  const out = {};
  const w = (id, slot) => (typeof id === 'string' && WEAPONS[id] && WEAPONS[id].slot === slot ? id : undefined);
  const eq = (id, kind) => (typeof id === 'string' && EQUIPMENT[id] && EQUIPMENT[id].kind === kind ? id : undefined);
  const set = (k, v) => { if (v !== undefined) out[k] = v; };
  set('primary', w(lo.primary, 'primary'));
  set('secondary', w(lo.secondary, 'secondary'));
  set('melee', w(lo.melee, 'melee'));
  set('lethal', eq(lo.lethal, 'lethal'));
  set('tactical', eq(lo.tactical, 'tactical'));
  set('cls', typeof lo.cls === 'string' && CLASSES[lo.cls] ? lo.cls : undefined);
  set('armor', typeof lo.armor === 'string' && ARMOR_TIERS[lo.armor] ? lo.armor : undefined);
  set('helmet', typeof lo.helmet === 'string' && HELMETS[lo.helmet] ? lo.helmet : undefined);
  if (typeof lo.skin === 'string') out.skin = str(lo.skin, 48);
  if (lo.camo && typeof lo.camo === 'object') {
    const camo = {};
    for (const [k, v] of Object.entries(lo.camo).slice(0, 8)) if (WEAPONS[k] && typeof v === 'string' && CAMOS[v]) camo[k] = v;
    if (Object.keys(camo).length) out.camo = camo;
  }
  return out;
}

/**
 * Waffen-ids, die ein Spieler mit dieser Ausrüstung tragen darf (für die Trefferprüfung). null = unbekannt (keine
 * Haupt-/Zweitwaffe gemeldet – der Client ergänzt dann Standardwaffen; sync-host kennt sie aus 'spawn').
 */
export function loadoutWeapons(lo) {
  if (!lo || (!lo.primary && !lo.secondary)) return null;
  const out = new Set(['knife']);
  for (const k of ['primary', 'secondary', 'melee']) if (typeof lo[k] === 'string' && WEAPONS[lo[k]]) out.add(lo[k]);
  return [...out];
}

/** Sitzungskennung dieses Tabs (bleibt beim Neuladen, für Kick-Sperren und Wiederverbindung). */
function tabPid() {
  const K = 'nullpunkt:net-pid';
  try {
    let v = sessionStorage.getItem(K);
    if (!v || !/^[0-9a-f]{16}$/.test(v)) { v = hex(randomBytes(8)); sessionStorage.setItem(K, v); }
    return v;
  } catch {
    return hex(randomBytes(8));
  }
}

function sendJson(link, json) {
  if (link && link._chaos) return link._chaos.sendJson(json);
  const ch = link && link.rel;
  if (!ch || ch.readyState !== 'open') return false;
  try { ch.send(json); return true; } catch { return false; }
}

/**
 * Netz-Chaos für Prüfläufe: ?netlag=<ms>&netjitter=<ms>&netloss=<%> (alle eigenen Sendungen dieser Seite). Ohne Parameter
 * null – dann bleibt jede Verbindung unverändert (kein Aufwand im echten Spiel).
 */
export function chaosFromUrl(search = typeof location !== 'undefined' ? location.search : '') {
  let q;
  try { q = new URLSearchParams(search || ''); } catch { return null; }
  const n = (k, max) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? Math.min(max, v) : 0; };
  const lag = n('netlag', 5000);
  const jitter = n('netjitter', 5000);
  const loss = n('netloss', 90) / 100;
  return lag || jitter || loss ? { lag, jitter, loss } : null;
}

/**
 * Chaos auf einer Verbindung (PeerLink): ersetzt sendRel/sendFast/close der Instanz.
 *   • zuverlässig: Laufzeit lag ± jitter, Reihenfolge bleibt; „Verlust“ = Wiederholung (+ max(200 ms, 2 × lag)),
 *     alle folgenden Nachrichten warten (Head-of-Line wie SCTP) – nie verworfen. Auch Ping/Pong und Zeitabgleich.
 *   • schnell: Laufzeit lag ± jitter je Paket (Reihenfolge darf kippen), Anteil loss wird verworfen.
 *   • close wartet, bis die zuverlässige Warteschlange gesendet ist (Kick/Abschied kommen noch an).
 * Abgearbeitet per Zeitgeber und zusätzlich jedes Bild (NetSystem.preUpdate – Zeitgeber ruhen in verborgenen Tabs).
 */
class LinkChaos {
  constructor(link, opts, onDone) {
    this.link = link;
    this.o = opts;
    this.rel = [];
    this.fast = [];
    this.relAt = 0;
    this.timer = null;
    this.timerAt = Infinity;
    this.closing = null;
    this.onDone = onDone;
    this._fast = link.sendFast.bind(link);
    this._close = link.close.bind(link);
    link._chaos = this;
    link.sendRel = (obj) => { let json; try { json = JSON.stringify(obj); } catch { return false; } return this.sendJson(json); };
    link.sendFast = (buf) => this.sendFast(buf);
    link.close = (reason) => this.close(reason);
  }

  _delay() {
    const j = this.o.jitter;
    return Math.max(0, this.o.lag + (j ? (Math.random() * 2 - 1) * j : 0));
  }

  sendJson(json) {
    const ch = this.link.rel;
    if (!ch || ch.readyState !== 'open' || this.closing != null) return false;
    let at = performance.now() + this._delay();
    if (this.o.loss && Math.random() < this.o.loss) at += Math.max(200, 2 * this.o.lag);
    at = Math.max(at, this.relAt);
    this.relAt = at;
    this.rel.push({ at, json });
    this._arm(at);
    return true;
  }

  sendFast(buf) {
    const ch = this.link.fast;
    if (!ch || ch.readyState !== 'open' || this.closing != null) return false;
    if (this.o.loss && Math.random() < this.o.loss) return true; // unterwegs verloren
    const at = performance.now() + this._delay();
    let i = this.fast.length;
    while (i > 0 && this.fast[i - 1].at > at) i--;
    this.fast.splice(i, 0, { at, buf });
    this._arm(at);
    return true;
  }

  flush(now = performance.now()) {
    const ch = this.link.rel;
    while (this.rel.length && this.rel[0].at <= now) {
      const m = this.rel.shift();
      if (ch && ch.readyState === 'open') { try { ch.send(m.json); } catch { /* Kanal zu */ } }
    }
    while (this.fast.length && this.fast[0].at <= now) this._fast(this.fast.shift().buf);
    if (this.closing != null && !this.rel.length) { const r = this.closing; this.closing = null; this._finish(r); return; }
    const next = Math.min(this.rel.length ? this.rel[0].at : Infinity, this.fast.length ? this.fast[0].at : Infinity);
    if (next < Infinity) this._arm(next);
  }

  _arm(at) {
    if (this.timer && this.timerAt <= at) return;
    clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => { this.timer = null; this.timerAt = Infinity; this.flush(); }, Math.max(0, at - performance.now()));
  }

  close(reason) {
    if (this.link.closed) return;
    const ch = this.link.rel;
    if (this.rel.length && ch && ch.readyState === 'open') { if (this.closing == null) this.closing = reason; return; }
    this._finish(reason);
  }

  _finish(reason) {
    clearTimeout(this.timer);
    this.timer = null;
    this.rel.length = 0;
    this.fast.length = 0;
    if (this.onDone) this.onDone(this);
    this._close(reason);
  }
}

export class NetSystem {
  constructor(G) {
    this.G = G;
    // ---------------------------------------------------------------- Zustand (Vertrag §3)
    this.online = false;
    this.role = null;
    this.selfId = null;
    this.room = null;
    this.roster = [];
    /** Synchronisation (sync-host.js / sync-client.js) – Spiel-Hooks werden dorthin weitergereicht. */
    this.sync = null;
    /** Spielstart-Funktion (cfg) → Standard G.menus.onStart (= main.startMatch). Tests/sync dürfen sie ersetzen. */
    this.startGame = null;
    /** Fassungskennung für die Versionsprüfung (Tests dürfen sie ändern). */
    this.build = BUILD;
    /** Anti-Cheat (nur Host, ab host()), Positionsverlauf für Trefferprüfungen. */
    this.anticheat = null;
    this.history = null;
    const urlRelays = relaysFromUrl();
    this.relays = urlRelays || DEFAULT_RELAYS;
    // Lokales Test-Relay: Verbindungen nur im eigenen Rechner – kein STUN nötig
    this.ice = urlRelays && urlRelays.every((u) => LOCAL_RELAY.test(u)) ? [] : ICE_SERVERS;
    this.relayStatus = { open: 0, total: this.relays.length };
    this.joinTimeout = 20000;
    this._pid = tabPid();
    this._handlers = new Map();
    this._fastHandlers = new Set();
    // Seite wird geschlossen/verlassen: Austritt sofort melden – sonst merkt die Gegenseite es erst am Zeitlimit der
    // Verbindung (≈ 20 s; z. B. bliebe ein Fahrzeugsitz so lange belegt). Aus dem bfcache (persisted) kann sie zurückkehren.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', (e) => {
        if ((e && e.persisted) || !this.online) return;
        try { this.leave('verlassen'); } catch { /* Seite geht ohnehin */ }
      });
    }
    this._timers = [];
    this._signal = null;
    this._hostLink = null;
    this._peers = new Map(); // id → peer (Host)
    this._pending = new Set(); // verbunden, aber noch ohne 'join' (Host)
    this._kicked = new Set();
    this._nextId = FIRST_CLIENT_ID;
    this._epoch = performance.now();
    this._offset = 0;
    this._timeSynced = false;
    this._tsSamples = [];
    this._matchCfg = null;
    this._readySent = false;
    this._away = false;
    this._fps = null;
    this._fpsT0 = null;
    this._fpsN = 0;
    this._actorMap = new Map();
    this._actorMapValid = false;
    this._lastRec = null;
    this._metaTimer = null;
    this._errLogged = new Set();
    this.upload = new UploadMeter();
    /** Netz-Chaos für Prüfläufe (?netlag/netjitter/netloss) oder null. */
    this.chaos = chaosFromUrl();
    this._chaosLinks = new Set();
    if (this.chaos) console.info(`[net] Netz-Chaos (Prüflauf): Laufzeit ${this.chaos.lag} ± ${this.chaos.jitter} ms, Verlust ${Math.round(this.chaos.loss * 100)} %`);
    this._onVis = () => this._visibility();
    // Rückkehr in die Lobby beendet auf dem Host den Spielzustand des Raums (Revanche = zurück in den Raum)
    this._offState = G && G.events ? G.events.on('match:state', (e) => { if (e && e.state === 'lobby') this._matchOver(); else this._applyMatchRules(); }) : null;
    // Gerät (Roster-Feld device): VR-Sitzung beginnt/endet, Touch ↔ Maus/Tastatur
    this._device = null;
    if (G && G.events) for (const ev of ['xr:start', 'xr:end', 'input:mode']) G.events.on(ev, () => this._deviceChanged());
  }

  /** Eigenes Gerät: 'vr' während einer VR-Sitzung, 'mobile' bei Touch-Steuerung, sonst 'pc'. */
  localDevice() {
    const G = this.G || {};
    if (G.xr && G.xr.presenting) return 'vr';
    if (G.input && G.input.mode === 'touch') return 'mobile';
    return 'pc';
  }

  /** Gerät geändert → Host: eigener Roster-Eintrag; Client: 'dev' an den Host (der verteilt das Roster). */
  _deviceChanged() {
    const d = this.localDevice();
    if (d === this._device || !this.online) return;
    this._device = d;
    if (this.role === 'client') { this.send(HOST_ID, { t: 'dev', d }); return; }
    const me = this.role === 'host' ? this.roster.find((r) => r.id === HOST_ID) : null;
    if (me && me.device !== d) { me.device = d; this._rosterChanged(); }
  }

  /**
   * Raumregeln, die nicht über die Spielstil-Flags kommen, auf das laufende Match legen (Host und Clients gleich, aus
   * cfg.net = G.match.net). main.applyStyle setzt G.match.styleFlags vor setState('loading') neu – daher bei jedem
   * Zustandswechsel (idempotent). Ausdauer aus → staminaMult 0 (stamina.js: unbegrenzt, Spieler und Bots).
   */
  _applyMatchRules() {
    const M = this.G && this.G.match;
    if (!M || !M.net || !M.styleFlags) return;
    if (M.net.stamina === false && M.styleFlags.staminaMult !== 0) M.styleFlags.staminaMult = 0;
  }

  /* ================================================================ Status / Ereignisse */

  _emit(name, payload) {
    if (this.G && this.G.events) this.G.events.emit(name, payload);
  }

  _status() {
    this._emit('net:status', { online: this.online, role: this.role, relays: { ...this.relayStatus }, state: this.room ? this.room.state : null });
  }

  _relayStatus(open, total) {
    this.relayStatus = { open, total };
    this._status();
  }

  _identity() {
    const G = this.G || {};
    let name = 'Spieler';
    let level = 1;
    let kd = 0;
    try { name = str(G.settings && G.settings.get('playerName'), 16) || name; } catch { /* */ }
    try {
      const st = G.profile && typeof G.profile.stats === 'function' ? G.profile.stats() : null;
      if (st) { level = clampInt(st.level, 1, 99, 1); kd = Number.isFinite(st.kd) ? Math.round(st.kd * 100) / 100 : 0; }
      else if (G.profile && typeof G.profile.get === 'function') level = clampInt(G.profile.get().level, 1, 99, 1);
    } catch { /* */ }
    return { name, level, kd };
  }

  /** Eigene Ausrüstung (Lobby-Auswahl, sonst zuletzt benutzte) – ungeprüft, für den lokalen Start. */
  _localLoadout() {
    const G = this.G || {};
    try {
      const lobby = G.menus && G.menus.lobby;
      const c = lobby && typeof lobby.config === 'function' ? lobby.config() : null;
      if (c && c.loadout) return { ...c.loadout };
    } catch { /* Lobby noch nicht aufgebaut */ }
    try {
      const lo = G.settings && G.settings.get('lastLoadout');
      const cls = G.settings && G.settings.get('lastClass');
      if (lo || cls) return { ...(lo || {}), cls: (lo && lo.cls) || cls || undefined };
    } catch { /* */ }
    return null;
  }

  _localCrosshair(style) {
    try { return style === 'realistisch' ? !!this.G.settings.get('realisticCrosshair') : null; } catch { return null; }
  }

  /* ================================================================ Host */

  /** Raum öffnen → {code}. settings: §6 (unvollständige Angaben werden ergänzt). Fehler: Error.code 'kein-relay'. */
  async host(settings = {}) {
    if (this.role) this.leave('neuer-raum');
    const me = this._identity();
    const code = newRoomCode();
    const s = normalizeSettings(settings, DEFAULT_ROOM, me.name);
    const lo = this._localLoadout();
    this.role = 'host';
    this.selfId = HOST_ID;
    this._epoch = performance.now();
    this._nextId = FIRST_CLIENT_ID;
    this._kicked = new Set();
    this._matchCfg = null;
    this.room = { code, public: s.public, state: 'lobby', settings: s, hostName: me.name };
    this.roster = [{
      id: HOST_ID, name: me.name, team: 'A', isHost: true, isBot: false, level: me.level, ping: 0, ready: false,
      cls: (lo && lo.cls) || null, loadout: sanitizeLoadout(lo), kd: me.kd, device: (this._device = this.localDevice()),
    }];
    this.anticheat = new AntiCheat({ onKick: (id, reason, text) => this.kick(id, `Anti-Cheat: ${text}`) });
    this.history = new PositionHistory(2.5); // ≥ AntiCheat maxRewind (2 s)
    this.upload = new UploadMeter();
    this._loadWeather();
    const signal = new HostSignal({
      relays: this.relays, code, meta: this._meta(),
      onOffer: (pk, hello, sdp) => this._onOffer(pk, hello, sdp),
      onStatus: (o, n) => this._relayStatus(o, n),
    });
    this._signal = signal;
    let ok = false;
    try { ok = await signal.start(); } catch (err) { console.warn('[net] Host-Start', err); ok = false; }
    if (this._signal !== signal) throw netError('abgebrochen');
    if (!ok) {
      this._shutdown('kein-relay');
      throw netError('kein-relay');
    }
    this.online = true;
    if (s.public) signal.setPublic(true);
    this._every(TICK_MS, () => this._hostTick());
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVis);
    this._status();
    this._emit('net:room', { room: this.room });
    this._emit('net:roster', { roster: this.roster });
    this._checkRecommendation(true);
    return { code };
  }

  /** resolveConditions aus world/weather.js vorladen (im Spiel steht es schon in G.modules.world bereit). */
  _loadWeather() {
    if (this._resolveFn || (this.G && this.G.modules && this.G.modules.world && this.G.modules.world.resolveConditions)) return;
    import('../world/weather.js').then((m) => { this._resolveFn = m.resolveConditions; }).catch(() => { /* Rückfall unten */ });
  }

  _meta() {
    const s = this.room.settings;
    const lv = this.roster.length ? Math.round(this.roster.reduce((a, r) => a + (r.level || 1), 0) / this.roster.length) : 1;
    return {
      name: s.name, map: s.map, mode: s.mode, players: this.roster.length, max: s.maxPlayers, level: lv,
      ver: this.build, pv: NET_VERSION, state: this.room.state, pvp: s.pvp, host: this.room.hostName,
    };
  }

  /** Lebenszeichen/öffentliche Liste aktualisieren (gebündelt, Relays nicht fluten). */
  _metaChanged() {
    if (!this._signal || this._metaTimer) return;
    this._metaTimer = setTimeout(() => {
      this._metaTimer = null;
      if (this._signal && this.role === 'host') this._signal.setMeta(this._meta());
    }, 400);
  }

  async _onOffer(pk, hello, sdp) {
    if (this.role !== 'host' || !this.room) return { reject: 'fehler' };
    const h = hello && typeof hello === 'object' ? hello : {};
    const pid = typeof h.pid === 'string' ? h.pid.slice(0, 32) : null;
    if (this._kicked.has(pk) || (pid && this._kicked.has('pid:' + pid))) return { reject: 'gekickt' };
    if (h.build !== this.build || h.pv !== NET_VERSION) return { reject: 'version' };
    // Derselbe Tab verbindet sich neu (alte Verbindung hängt noch): alte Sitzung ersetzen
    if (pid) for (const peer of [...this._peers.values(), ...this._pending]) if (peer.pid === pid) this._dropPeer(peer, 'ersetzt');
    if (this.roster.length + this._pending.size >= this.room.settings.maxPlayers) return { reject: 'voll' };
    // Platz sofort belegen (die Antwort braucht bis zu 2,5 s ICE-Sammeln – gleichzeitige Angebote zählen mit)
    const peer = { id: 0, pk, pid, hello: h, link: null, joined: false, dropped: false, entry: null, msgWin: 0, msgCount: 0 };
    this._pending.add(peer);
    let res;
    try { res = await PeerLink.answer(sdp, this.ice); } catch (err) { this._pending.delete(peer); throw err; }
    if (peer.dropped || this.role !== 'host') { this._pending.delete(peer); res.link.close('abgebrochen'); return { reject: 'fehler' }; }
    const { link, sdp: answer } = res;
    this._applyChaos(link);
    peer.link = link;
    peer.helloTimer = setTimeout(() => { if (!peer.joined) this._dropPeer(peer, 'keine-anmeldung'); }, HELLO_WAIT_MS);
    link.on('message', (m) => this._hostMessage(peer, m));
    link.on('close', (reason) => this._dropPeer(peer, reason));
    return { sdp: answer };
  }

  _flood(peer) {
    const t = Math.floor(performance.now() / 1000);
    if (peer.msgWin !== t) { peer.msgWin = t; peer.msgCount = 0; }
    if (++peer.msgCount <= FLOOD_PER_SEC) return false;
    if (peer.msgCount === FLOOD_PER_SEC + 1 && peer.joined && this.anticheat) this.anticheat.strike(peer.id, 'flut', this.serverTime());
    return true;
  }

  _hostMessage(peer, m) {
    if (peer.dropped || this._flood(peer)) return;
    if (m instanceof ArrayBuffer) {
      if (!peer.joined || packetType(m) >= PKT_INTERNAL_MIN) return;
      this._dispatchFast(m, peer.id);
      return;
    }
    if (!m || typeof m.t !== 'string' || m.t.length > 32) return;
    if (!peer.joined) { if (m.t === 'join') this._hostJoin(peer, m); return; }
    const entry = peer.entry;
    switch (m.t) {
      case '_ts': sendJson(peer.link, JSON.stringify({ t: '_tr', c: m.c, h: this.serverTime() })); return;
      case '_fw': this._forward(peer, m); return;
      case 'join': return;
      case 'ready':
        if (!entry.ready) { entry.ready = true; this._rosterChanged(); }
        break;
      case 'dev': {
        const d = normDevice(m.d);
        if (entry.device !== d) { entry.device = d; this._rosterChanged(); }
        break;
      }
      case 'loadout': {
        const lo = sanitizeLoadout(m.loadout);
        entry.loadout = lo;
        entry.cls = (typeof m.cls === 'string' && CLASSES[m.cls] ? m.cls : lo && lo.cls) || entry.cls;
        this._rosterChanged();
        m = { t: 'loadout', cls: entry.cls, loadout: lo };
        break;
      }
      case 'leave':
        this._dispatch(m, peer.id);
        this._dropPeer(peer, 'verlassen');
        return;
      default:
        if (HOST_ONLY.has(m.t) || m.t[0] === '_') return; // Clients dürfen keine Host-Nachrichten erfinden
    }
    this._dispatch(m, peer.id);
  }

  _hostJoin(peer, m) {
    clearTimeout(peer.helloTimer);
    const reject = (reason) => {
      sendJson(peer.link, JSON.stringify({ t: 'reject', reason }));
      this._pending.delete(peer);
      peer.dropped = true;
      setTimeout(() => peer.link.close('abgelehnt'), 300);
    };
    if (this._kicked.has(peer.pk) || (peer.pid && this._kicked.has('pid:' + peer.pid))) return reject('gekickt');
    if (m.build !== this.build || m.ver !== NET_VERSION) return reject('version');
    if (this.roster.length >= this.room.settings.maxPlayers) return reject('voll');
    const id = this._allocId();
    const lo = sanitizeLoadout(m.loadout);
    const entry = {
      id, name: this._uniqueName(str(m.name || peer.hello.name, 16) || `Spieler ${id}`), team: this._balanceTeam(),
      isHost: false, isBot: false, level: clampInt(m.level, 1, 99, 1), ping: Math.round(peer.link.rtt || 0), ready: false,
      cls: (typeof m.cls === 'string' && CLASSES[m.cls] ? m.cls : lo && lo.cls) || null, loadout: lo,
      kd: Number.isFinite(Number(m.kd)) ? Math.round(Math.min(99, Math.max(0, Number(m.kd))) * 100) / 100 : 0,
      device: normDevice(m.dev),
    };
    peer.id = id;
    peer.joined = true;
    peer.entry = entry;
    this._pending.delete(peer);
    this._peers.set(id, peer);
    this.roster.push(entry);
    const cfg = this.room.state === 'match' && this._matchCfg ? this._cfgFor(id) : null;
    this._sendTo(peer, { t: 'welcome', id, team: entry.team, room: this.room, roster: this.roster, cfg });
    this._broadcast({ t: 'roster', roster: this.roster }, id);
    this._emit('net:roster', { roster: this.roster });
    this._emit('net:peer', { id, name: entry.name, joined: true });
    this._dispatch({ t: 'join', name: entry.name, level: entry.level, kd: entry.kd, cls: entry.cls, loadout: entry.loadout, team: entry.team }, id);
    this._metaChanged();
  }

  _allocId() {
    const used = new Set(this.roster.map((r) => r.id));
    if (this._nextId < FIRST_BOT_ID && !used.has(this._nextId)) return this._nextId++;
    for (let i = FIRST_CLIENT_ID; i < FIRST_BOT_ID; i++) if (!used.has(i)) { this._nextId = i + 1; return i; }
    return this._nextId++;
  }

  _uniqueName(name) {
    const taken = new Set(this.roster.map((r) => r.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 100; i++) {
      const n = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name;
  }

  /** Team für einen neuen Menschen: pvp → kleineres Team (Gleichstand A), coop → A. */
  _balanceTeam() {
    if (!this.room || this.room.settings.pvp === 'coop') return 'A';
    let a = 0;
    let b = 0;
    for (const r of this.roster) { if (r.team === 'B') b++; else a++; }
    return b < a ? 'B' : 'A';
  }

  _forward(peer, m) {
    const inner = m.m;
    if (!inner || typeof inner.t !== 'string' || inner.t[0] === '_' || RESERVED.has(inner.t)) return;
    const json = JSON.stringify({ t: '_fw', from: peer.id, m: inner });
    if (m.to === 'all' || m.to === 'others') {
      for (const [id, p] of this._peers) if (id !== peer.id) this._sendJsonTo(p, json);
      if (m.to === 'all') this._dispatch(inner, peer.id);
    } else if (m.to === HOST_ID) {
      this._dispatch(inner, peer.id);
    } else {
      const p = this._peers.get(m.to);
      if (p) this._sendJsonTo(p, json);
    }
  }

  /** Verbindung/Teilnehmer entfernen (Austritt, Kick, Abbruch). closeDelay: Zeit für letzte Nachrichten (ms). */
  _dropPeer(peer, reason = 'getrennt', closeDelay = 0) {
    if ((peer.dropped && !peer.joined) || !peer.link) { peer.dropped = true; this._pending.delete(peer); return; }
    const wasJoined = peer.joined && !peer.dropped;
    peer.dropped = true;
    clearTimeout(peer.helloTimer);
    this._pending.delete(peer);
    if (wasJoined) {
      if (this._peers.get(peer.id) === peer) this._peers.delete(peer.id);
      const i = this.roster.findIndex((r) => r.id === peer.id);
      if (i >= 0) this.roster.splice(i, 1);
      if (this.anticheat) this.anticheat.remove(peer.id);
      if (this.history) this.history.remove(peer.id);
      this._broadcast({ t: 'roster', roster: this.roster });
      this._emit('net:roster', { roster: this.roster });
      this._emit('net:peer', { id: peer.id, name: peer.entry ? peer.entry.name : '', joined: false, reason });
      this._metaChanged();
    }
    if (!peer.link.closed) {
      if (closeDelay > 0) setTimeout(() => peer.link.close(reason), closeDelay);
      else peer.link.close(reason);
    }
  }

  /** Teilnehmer entfernen (nur Host). Er kann diesem Raum danach nicht wieder beitreten. */
  kick(id, reason = 'Vom Host entfernt') {
    if (this.role !== 'host' || id === HOST_ID) return false;
    const peer = this._peers.get(id);
    if (!peer) return false;
    this._kicked.add(peer.pk);
    if (peer.pid) this._kicked.add('pid:' + peer.pid);
    this._sendTo(peer, { t: 'kick', reason: str(reason, 120) || 'Vom Host entfernt' });
    this._dropPeer(peer, 'gekickt', 300);
    return true;
  }

  /** Team eines Menschen setzen (nur Host). */
  setTeam(id, team) {
    if (this.role !== 'host' || (team !== 'A' && team !== 'B')) return false;
    if (team === 'B' && this.room.settings.pvp === 'coop') return false; // Koop: alle Menschen in Team A
    const r = this.roster.find((e) => e.id === id);
    if (!r || r.team === team) return !!r;
    r.team = team;
    this._rosterChanged();
    return true;
  }

  /** Raum-Einstellungen ändern (nur Host) und an alle verteilen. → neue Einstellungen. */
  updateSettings(partial = {}) {
    if (this.role !== 'host' || !this.room) return null;
    const prev = this.room.settings;
    const next = normalizeSettings({ ...prev, ...partial }, prev, this.room.hostName);
    this.room.settings = next;
    if (next.public !== this.room.public) {
      this.room.public = next.public;
      if (this._signal) this._signal.setPublic(next.public);
    }
    // Koop: alle Menschen in Team A; zurück auf PvP: abwechselnd verteilen
    if (next.pvp !== prev.pvp) {
      if (next.pvp === 'coop') for (const r of this.roster) r.team = 'A';
      else this.roster.forEach((r, i) => { r.team = i % 2 ? 'B' : 'A'; });
      this._rosterChanged();
    }
    this._roomChanged();
    return next;
  }

  _roomChanged() {
    this._broadcast({ t: 'room', room: this.room });
    this._emit('net:room', { room: this.room });
    this._metaChanged();
    this._status();
  }

  _rosterChanged() {
    if (this.role !== 'host') return;
    this._broadcast({ t: 'roster', roster: this.roster });
    this._emit('net:roster', { roster: this.roster });
    this._metaChanged();
  }

  /** Eigene Ausrüstung melden (Client → Host 'loadout'; Host: eigener Eintrag). Gilt ab dem nächsten Spawn. */
  setLoadout({ cls = null, loadout = null } = {}) {
    if (this.role === 'client') return this.send(HOST_ID, { t: 'loadout', cls, loadout }) > 0;
    if (this.role !== 'host') return false;
    const me = this.roster.find((r) => r.id === HOST_ID);
    if (!me) return false;
    me.loadout = sanitizeLoadout(loadout);
    me.cls = (typeof cls === 'string' && CLASSES[cls] ? cls : me.loadout && me.loadout.cls) || me.cls;
    this._rosterChanged();
    this._dispatch({ t: 'loadout', cls: me.cls, loadout: me.loadout }, HOST_ID);
    return true;
  }

  /* ================================================================ Spielstart (§6) */

  _resolveConditions(mapId, weather, time) {
    const meta = MAPS[mapId] || {};
    const req = { weather: weather === 'standard' ? null : weather, time };
    const fn = (this.G && this.G.modules && this.G.modules.world && this.G.modules.world.resolveConditions) || this._resolveFn;
    let cond = null;
    if (typeof fn === 'function') { try { cond = fn(meta, req, Math.random); } catch { cond = null; } }
    if (!cond) {
      // Rückfall ohne weather.js: Zufall selbst würfeln, sonst Vorgabe der Karte
      const ws = Array.isArray(meta.weathers) && meta.weathers.length ? meta.weathers : ['klar'];
      const ts = (Array.isArray(meta.times) ? meta.times : []).map((t) => t.id);
      const w = weather === 'zufall' ? ws[Math.floor(Math.random() * ws.length)] : ws.includes(weather) ? weather : meta.weatherDefault || ws[0];
      const pool = [null, ...ts];
      // ('echtzeit' ohne weather.js: Kartenzeit – der Normalfall löst über realTimePreset nach der Uhr des Hosts auf)
      const t = time === 'zufall' ? pool[Math.floor(Math.random() * pool.length)] : ts.includes(time) ? time : null;
      cond = { weather: w, time: t };
    }
    return { weather: cond.weather, time: cond.time || null };
  }

  /** Gemeinsame Match-Konfiguration aus den Raum-Einstellungen (ohne Empfängerteil). */
  _buildBaseCfg() {
    const s = this.room.settings;
    const cond = this._resolveConditions(s.map, s.weather, s.time);
    const humans = { A: 0, B: 0 };
    for (const r of this.roster) humans[r.team === 'B' ? 'B' : 'A']++;
    const n = this.roster.length;
    const ffa = !!(MODES[s.mode] && MODES[s.mode].teams === false);
    let botsA = 0;
    let botsB = 0;
    if (ffa) botsB = s.botFill ? Math.max(0, 2 * s.teamSize - n) : 0; // FFA: insgesamt 2 × teamSize Teilnehmer
    else if (s.pvp === 'coop') { botsA = s.botFill ? Math.max(0, s.teamSize - n) : 0; botsB = s.teamSize; }
    else { botsA = s.botFill ? Math.max(0, s.teamSize - humans.A) : 0; botsB = s.botFill ? Math.max(0, s.teamSize - humans.B) : 0; }
    const cfg = {
      modeId: s.mode, mapId: s.map, difficulty: s.difficulty, allies: botsA, enemies: botsB, style: s.style,
      matchLength: 'standard', timeOfDay: cond.time || 'standard', weather: cond.weather,
      net: {
        roomCode: this.room.code, teamSize: s.teamSize, pvp: s.pvp, botFill: s.botFill, maxPlayers: s.maxPlayers,
        botsA, botsB, humans, ffa, conditions: cond, startedAt: this.serverTime(),
        stamina: s.stamina !== false, // Raum-Einstellung „Ausdauer“ (aus = unbegrenzt für alle, _applyMatchRules)
        // Fahrzeuge (panzer-mp.md §C.1): an/aus, Außenansicht erlaubt, Nachladen der Panzerkanone
        vehicles: s.vehicles === true, thirdPerson: s.thirdPerson !== false, vehReload: s.vehReload === 'automatisch' ? 'automatisch' : 'manuell',
      },
    };
    if (s.timeLimit != null) cfg.timeLimit = s.timeLimit;
    if (s.scoreLimit != null) cfg.scoreLimit = s.scoreLimit;
    return cfg;
  }

  /** Konfiguration für einen Empfänger (Host oder Client): Rolle, eigene netId, Team und gemeldete Ausrüstung. */
  _cfgFor(id) {
    const base = this._matchCfg;
    const r = this.roster.find((e) => e.id === id);
    const cfg = { ...base, net: { ...base.net, role: id === HOST_ID ? 'host' : 'client', selfId: id, team: r ? r.team : 'A' } };
    if (r && r.loadout) cfg.loadout = { ...r.loadout };
    return cfg;
  }

  /**
   * Match starten (nur Host): cfg bauen (§6), 'start' {cfg} an alle Clients (bereit oder nicht), dann selbst starten.
   * → cfg des Hosts (oder null). Clients, die später beitreten, bekommen die cfg im welcome.
   */
  startMatch() {
    if (this.role !== 'host' || !this.room) return null;
    const me = this.roster.find((r) => r.id === HOST_ID);
    const lo = this._localLoadout();
    if (me && lo) { me.loadout = sanitizeLoadout(lo); me.cls = lo.cls || me.cls; }
    this._matchCfg = this._buildBaseCfg();
    this.room.state = 'match';
    this._readySent = false;
    for (const r of this.roster) r.ready = false;
    if (this.anticheat) {
      this.anticheat.reset();
      const st = GAME_STYLES[this.room.settings.style];
      this.anticheat.opts.damageMult = st && Number.isFinite(st.bulletMult) ? st.bulletMult : 1;
    }
    if (this.history) this.history.clear();
    this._roomChanged();
    this._rosterChanged();
    for (const [id, peer] of this._peers) this._sendTo(peer, { t: 'start', cfg: this._cfgFor(id) });
    const cfg = this._cfgFor(HOST_ID);
    if (lo) cfg.loadout = lo;
    cfg.crosshair = this._localCrosshair(cfg.style);
    this._startGame(cfg);
    return cfg;
  }

  _startGame(cfg) {
    const G = this.G || {};
    const fn = typeof this.startGame === 'function' ? this.startGame
      : G.menus && typeof G.menus.onStart === 'function' ? (c) => G.menus.onStart(c) : null;
    if (!fn) { console.warn('[net] Keine Startfunktion (G.menus.onStart / G.net.startGame) – Match nicht gestartet'); return; }
    try {
      const p = fn(cfg);
      if (p && typeof p.catch === 'function') p.catch((err) => console.error('[net] Matchstart', err));
    } catch (err) { console.error('[net] Matchstart', err); }
  }

  /** Client: Start aus 'start' bzw. welcome.cfg – eigene Ausrüstung und Fadenkreuz-Einstellung einsetzen. */
  _startLocal(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    this._matchCfg = cfg;
    this._readySent = false;
    if (this.room) this.room.state = 'match';
    const local = { ...cfg, net: { ...(cfg.net || {}), role: 'client', selfId: this.selfId } };
    const lo = this._localLoadout();
    if (lo) local.loadout = lo;
    local.crosshair = this._localCrosshair(cfg.style);
    this._startGame(local);
  }

  /** Spiel vorbei/zurück im Raum (Host): Raum wieder 'lobby', bereit-Markierungen zurücksetzen. */
  _matchOver() {
    if (this.role !== 'host' || !this.room || this.room.state !== 'match') return;
    this.room.state = 'lobby';
    this._matchCfg = null;
    for (const r of this.roster) r.ready = false;
    this._roomChanged();
    this._rosterChanged();
  }

  /** Client: Welt geladen, bereit zum Spawnen ('ready' an den Host). Wird von onMatchStart automatisch gerufen. */
  markReady() {
    if (this._readySent) return;
    this._readySent = true;
    if (this.role === 'client') this.send(HOST_ID, { t: 'ready' });
    else if (this.role === 'host') {
      const me = this.roster.find((r) => r.id === HOST_ID);
      if (me && !me.ready) { me.ready = true; this._rosterChanged(); }
    }
  }

  /* ================================================================ Client */

  /**
   * Raum beitreten → {id, team, room}. Fehler (Error.code): 'kein-relay' | 'kein-host' | 'keine-antwort' |
   * 'abgelehnt:voll' | 'abgelehnt:version' | 'abgelehnt:gekickt' | 'verbindung-fehlgeschlagen' | 'abgebrochen'.
   */
  async join(code, { name } = {}) {
    const c = normCode(code);
    if (!isValidCode(c)) throw netError('kein-host', 'Ungültiger Raumcode.');
    if (this.role) this.leave('neuer-raum');
    const me = this._identity();
    const nm = str(name, 16) || me.name;
    const token = {};
    this._joining = token;
    let res;
    try {
      res = await joinRoom({
        relays: this.relays, code: c, timeout: this.joinTimeout,
        hello: { name: nm, pid: this._pid, build: this.build, pv: NET_VERSION },
        makeOffer: () => PeerLink.offer(this.ice),
        onStatus: (o, n) => { if (this._joining === token) this._relayStatus(o, n); },
      });
    } catch (err) {
      if (this._joining === token) this._joining = null;
      // nur eigene Fehlercodes (Text) – DOMException trägt Zahlen (z. B. 11 = InvalidStateError)
      throw netError(err && typeof err.code === 'string' && err.code ? err.code : 'verbindung-fehlgeschlagen');
    }
    const link = res.link;
    this._applyChaos(link);
    if (this._joining !== token) { link.close('abgebrochen'); throw netError('abgebrochen'); }
    try {
      await this._waitOpen(link);
      if (this._joining !== token) throw netError('abgebrochen');
      const lo = this._localLoadout();
      return await new Promise((resolve, reject) => {
        const offs = [];
        const timer = setTimeout(() => done(netError('keine-begruessung')), WELCOME_WAIT_MS);
        const done = (err, m) => {
          clearTimeout(timer);
          while (offs.length) offs.pop()();
          if (err) { reject(err); return; }
          if (this._joining !== token) { reject(netError('abgebrochen')); return; }
          this._joining = null;
          resolve(this._beginClient(link, m, c));
        };
        offs.push(link.on('message', (m) => {
          if (!m || typeof m !== 'object' || m instanceof ArrayBuffer) return;
          if (m.t === 'welcome') done(null, m);
          else if (m.t === 'reject') done(netError('abgelehnt:' + (typeof m.reason === 'string' ? m.reason : 'fehler')));
          else if (m.t === 'kick') done(netError('abgelehnt:gekickt'));
        }));
        offs.push(link.on('close', () => done(netError('verbindung-fehlgeschlagen'))));
        this._device = this.localDevice();
        link.sendRel({
          t: 'join', name: nm, level: me.level, kd: me.kd, ver: NET_VERSION, build: this.build,
          cls: (lo && lo.cls) || null, loadout: sanitizeLoadout(lo), dev: this._device,
        });
      });
    } catch (err) {
      if (this._joining === token) this._joining = null;
      link.close('abgebrochen');
      throw err && typeof err.code === 'string' && err.code ? err : netError('verbindung-fehlgeschlagen');
    }
  }

  _waitOpen(link) {
    if (link.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const offs = [];
      const fin = (err) => { clearTimeout(t); while (offs.length) offs.pop()(); if (err) reject(err); else resolve(); };
      const t = setTimeout(() => fin(netError('verbindung-fehlgeschlagen')), OPEN_WAIT_MS);
      offs.push(link.on('open', () => fin()));
      offs.push(link.on('close', () => fin(netError('verbindung-fehlgeschlagen'))));
    });
  }

  /** welcome angekommen: Sitzung als Client aufbauen (synchron, damit keine Nachricht verloren geht). */
  _beginClient(link, w, code) {
    this.role = 'client';
    this.online = true;
    this.selfId = w.id;
    this.room = w.room || { code, public: false, state: 'lobby', settings: { ...DEFAULT_ROOM }, hostName: '' };
    this.roster = Array.isArray(w.roster) ? w.roster : [];
    this._hostLink = link;
    this._offset = 0;
    this._timeSynced = false;
    this._tsSamples = [];
    link.on('message', (m) => this._clientMessage(m));
    link.on('close', (reason) => this._clientClosed(link, reason));
    // Zeitabgleich: drei schnelle Proben, danach alle 2 s
    this._syncTime();
    setTimeout(() => this._syncTime(), 150);
    setTimeout(() => this._syncTime(), 400);
    this._every(TIME_SYNC_MS, () => this._syncTime());
    this._status();
    this._emit('net:room', { room: this.room });
    this._emit('net:roster', { roster: this.roster });
    if (w.cfg) this._startLocal(w.cfg);
    return { id: w.id, team: w.team, room: this.room };
  }

  _clientMessage(m) {
    if (this.role !== 'client') return;
    if (m instanceof ArrayBuffer) {
      if (packetType(m) >= PKT_INTERNAL_MIN) return;
      this._dispatchFast(m, HOST_ID);
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case '_tr': this._onTimeReply(m); return;
      case '_fw': {
        const inner = m.m;
        if (!inner || typeof inner.t !== 'string' || inner.t[0] === '_' || RESERVED.has(inner.t) || !Number.isInteger(m.from)) return;
        this._dispatch(inner, m.from);
        return;
      }
      case 'welcome': return;
      case 'room':
        if (m.room && typeof m.room === 'object') { this.room = m.room; this._emit('net:room', { room: this.room }); this._status(); }
        break;
      case 'roster':
        if (Array.isArray(m.roster)) { this.roster = m.roster; this._emit('net:roster', { roster: this.roster }); }
        break;
      case 'start':
        this._dispatch(m, HOST_ID);
        this._startLocal(m.cfg);
        return;
      case 'kick': {
        const reason = typeof m.reason === 'string' ? m.reason : 'Vom Host entfernt';
        this._dispatch(m, HOST_ID);
        this._shutdown('gekickt');
        this._emit('net:kicked', { reason });
        return;
      }
      case 'leave':
        this._dispatch(m, HOST_ID);
        this._shutdown('host-beendet');
        this._emit('net:error', { code: 'host-weg', text: NET_ERROR_TEXT['host-beendet'] });
        return;
      case 'host-away':
        this._emit('net:host-away', { away: !!m.away });
        break;
      default:
    }
    this._dispatch(m, HOST_ID);
  }

  _clientClosed(link, reason) {
    if (this.role !== 'client' || this._hostLink !== link) return;
    this._shutdown('host-weg');
    this._emit('net:error', { code: 'host-weg', text: NET_ERROR_TEXT['host-weg'], reason });
  }

  _syncTime() {
    if (this.role === 'client' && this._hostLink) this._hostLink.sendRel({ t: '_ts', c: nowSec() });
  }

  _onTimeReply(m) {
    const now = nowSec();
    const rtt = now - Number(m.c);
    if (!(rtt >= 0 && rtt < 5) || !Number.isFinite(m.h)) return;
    this._tsSamples.push({ rtt, offset: m.h + rtt / 2 - now });
    if (this._tsSamples.length > 8) this._tsSamples.shift();
    let best = this._tsSamples[0];
    for (const s of this._tsSamples) if (s.rtt < best.rtt) best = s;
    if (!this._timeSynced) { this._offset = best.offset; this._timeSynced = true; return; }
    const d = best.offset - this._offset;
    this._offset += Math.abs(d) > 0.25 ? d : d * 0.3;
  }

  /* ================================================================ Gemeinsam */

  /** Sitzung verlassen (Host: Raum schließen, alle Clients bekommen 'leave'). */
  leave(reason = 'verlassen') {
    this._joining = null;
    if (this.role === 'host') {
      const json = JSON.stringify({ t: 'leave', reason: 'host-beendet' });
      for (const peer of this._peers.values()) sendJson(peer.link, json);
      for (const peer of [...this._peers.values(), ...this._pending]) {
        peer.dropped = true;
        clearTimeout(peer.helloTimer);
        if (peer.link) setTimeout(() => peer.link.close('raum-geschlossen'), 250);
      }
    } else if (this.role === 'client' && this._hostLink) {
      const link = this._hostLink;
      link.sendRel({ t: 'leave' });
      this._hostLink = null;
      setTimeout(() => link.close('verlassen'), 150);
    }
    this._shutdown(reason);
  }

  _shutdown(reason) {
    const was = this.role;
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    clearTimeout(this._metaTimer);
    this._metaTimer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVis);
    if (this._signal) { try { this._signal.stop(); } catch { /* */ } this._signal = null; }
    if (this._hostLink) { const l = this._hostLink; this._hostLink = null; l.close(reason); }
    if (was === 'host') for (const peer of [...this._peers.values(), ...this._pending]) { peer.dropped = true; clearTimeout(peer.helloTimer); }
    this._peers.clear();
    this._pending.clear();
    this.online = false;
    this.role = null;
    this.selfId = null;
    this.room = null;
    this.roster = [];
    this._matchCfg = null;
    this._timeSynced = false;
    this._away = false;
    this.relayStatus = { open: 0, total: this.relays.length };
    if (was) this._status();
  }

  /** Prüflauf: Chaos auf eine neue Verbindung legen (ohne ?netlag/… nichts). */
  _applyChaos(link) {
    if (!this.chaos || !link || link._chaos) return;
    this._chaosLinks.add(new LinkChaos(link, this.chaos, (c) => this._chaosLinks.delete(c)));
  }

  _chaosFlush() {
    const now = performance.now();
    for (const c of this._chaosLinks) c.flush(now);
  }

  _every(ms, fn) {
    this._timers.push(setInterval(() => { try { fn(); } catch (err) { this._logOnce('timer', err); } }, ms));
  }

  _logOnce(key, err) {
    const k = key + ':' + (err && err.message);
    if (this._errLogged.has(k)) return;
    this._errLogged.add(k);
    console.error('[net]', key, err);
  }

  /** Host: einmal pro Sekunde – Ping ins Roster, Upload messen, Empfehlung aktualisieren. */
  _hostTick() {
    if (this.role !== 'host') return;
    this._tick = (this._tick || 0) + 1;
    let buffered = 0;
    for (const peer of this._peers.values()) buffered += peer.link.buffered || 0;
    this.upload.sample(buffered, nowSec(), this.roster.length);
    if (this._tick % ROSTER_PING_EVERY === 0 && this._peers.size) {
      let changed = false;
      for (const peer of this._peers.values()) {
        const rtt = peer.link.rtt || 0;
        const ping = rtt > 0 ? Math.max(1, Math.round(rtt)) : 0;
        if (peer.entry && peer.entry.ping !== ping && (Math.abs(peer.entry.ping - ping) >= 3 || !peer.entry.ping)) { peer.entry.ping = ping; changed = true; }
      }
      if (changed) this._rosterChanged();
    }
    this._checkRecommendation(false);
  }

  _checkRecommendation(force) {
    const r = this.recommendation();
    const key = `${r.max}|${r.measured}|${r.reason}`;
    if (!force && key === this._lastRec) return;
    this._lastRec = key;
    this._emit('net:recommend', r);
  }

  _visibility() {
    if (this.role !== 'host' || typeof document === 'undefined') return;
    const away = document.visibilityState === 'hidden';
    if (away === this._away) return;
    this._away = away;
    this.send('all', { t: 'host-away', away });
  }

  /* ---------------------------------------------------------------- Senden */

  _countBytes(n) {
    if (this.role === 'host') this.upload.add(n + BYTE_OVERHEAD);
  }

  _sendJsonTo(peer, json) {
    if (!peer || peer.dropped && !peer.joined) return false;
    const ok = sendJson(peer.link, json);
    if (ok) this._countBytes(json.length);
    return ok;
  }

  _sendTo(peer, msg) { return this._sendJsonTo(peer, JSON.stringify(msg)); }

  _broadcast(msg, except = null) {
    if (this.role !== 'host' || !this._peers.size) return 0;
    const json = JSON.stringify(msg);
    let n = 0;
    for (const [id, peer] of this._peers) if (id !== except && this._sendJsonTo(peer, json)) n++;
    return n;
  }

  /**
   * Zuverlässig senden (JSON). to: netId | 'all' | 'others' (Host: 'others' = alle Clients außer `except`).
   * Clients erreichen direkt nur den Host (to = 1 oder 'host'); andere Ziele leitet der Host weiter (nur eigene
   * Typen, keine Raum-/Spielnachrichten). → Anzahl der Empfänger.
   */
  send(to, msg, except = null) {
    if (!this.online || !msg || typeof msg.t !== 'string') return 0;
    if (to === this.selfId) { queueMicrotask(() => this._dispatch(msg, this.selfId)); return 1; }
    if (this.role === 'host') {
      if (to === 'all' || to === 'others') return this._broadcast(msg, to === 'others' ? except : null);
      const peer = this._peers.get(to);
      return peer && this._sendTo(peer, msg) ? 1 : 0;
    }
    const link = this._hostLink;
    if (!link) return 0;
    if (to === HOST_ID || to === 'host') return link.sendRel(msg) ? 1 : 0;
    if (msg.t[0] === '_' || RESERVED.has(msg.t)) return 0;
    return link.sendRel({ t: '_fw', to, m: msg }) ? 1 : 0;
  }

  /** Schnell/unzuverlässig senden (ArrayBuffer). Host: to wie send; Client: immer an den Host. → Anzahl Empfänger. */
  sendFast(to, buf, except = null) {
    if (!this.online || !(buf instanceof ArrayBuffer)) return 0;
    if (this.role === 'client') return this._hostLink && this._hostLink.sendFast(buf) ? 1 : 0;
    let n = 0;
    const one = (peer) => { if (peer.link.sendFast(buf)) { n++; this._countBytes(buf.byteLength); } };
    if (to === 'all' || to === 'others') { for (const [id, peer] of this._peers) if (!(to === 'others' && id === except)) one(peer); }
    else { const peer = this._peers.get(to); if (peer) one(peer); }
    return n;
  }

  /** Abo je Nachrichtentyp ('*' = alle): fn(msg, fromId). → Abmeldefunktion. */
  on(type, fn) {
    let set = this._handlers.get(type);
    if (!set) this._handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Abo auf schnelle Pakete: fn(arrayBuffer, fromId). → Abmeldefunktion. */
  onFast(fn) {
    this._fastHandlers.add(fn);
    return () => this._fastHandlers.delete(fn);
  }

  _dispatch(msg, from) {
    const call = (set) => {
      if (!set) return;
      for (const fn of [...set]) { try { fn(msg, from); } catch (err) { this._logOnce('on:' + msg.t, err); } }
    };
    call(this._handlers.get(msg.t));
    call(this._handlers.get('*'));
  }

  _dispatchFast(buf, from) {
    for (const fn of this._fastHandlers) { try { fn(buf, from); } catch (err) { this._logOnce('onFast', err); } }
  }

  /** Laufzeit (ms) zu einem Teilnehmer. Host: direkt gemessen; Client: zum Host gemessen, sonst Roster-Ping. */
  peerRtt(id) {
    if (this.role === 'host') {
      if (id === HOST_ID) return 0;
      const peer = this._peers.get(id);
      return peer ? peer.link.rtt || 0 : 0;
    }
    if (this.role === 'client') {
      if (id === HOST_ID || id === this.selfId) return this._hostLink ? this._hostLink.rtt || 0 : 0;
      const r = this.roster.find((e) => e.id === id);
      return r ? r.ping || 0 : 0;
    }
    return 0;
  }

  /** Host-Zeit in Sekunden (Host: seit Raumöffnung; Client: geschätzt über den Zeitabgleich). */
  serverTime() {
    if (this.role === 'client') return nowSec() + this._offset;
    return (performance.now() - this._epoch) / 1000;
  }

  /** true, sobald der Client die Host-Zeit kennt (erste Probe beantwortet). */
  get timeSynced() { return this.role === 'host' || this._timeSynced; }

  /* ---------------------------------------------------------------- Anti-Cheat-Helfer (Host) */

  /** Zustand eines Clients prüfen; bei Verstoß geht 'correct' {pos} automatisch an ihn. → Ergebnis von onState. */
  checkState(id, state, ctx = {}) {
    if (this.role !== 'host' || !this.anticheat) return { ok: true, reason: 'offline', kick: null };
    const r = this.anticheat.onState(id, state, this.serverTime(), ctx);
    if (r.correct) this.send(id, { t: 'correct', pos: r.correct });
    return r;
  }

  /** Treffermeldung prüfen (now/rtt/Waffen/Verlauf werden ergänzt). → {ok, dmg, reason, kick} */
  checkHit(id, claim, ctx = {}) {
    if (this.role !== 'host' || !this.anticheat) return { ok: true, dmg: claim ? claim.dmg || 0 : 0, reason: 'offline', kick: null };
    const r = this.roster.find((e) => e.id === id);
    const full = {
      now: this.serverTime(), rtt: this.peerRtt(id) / 1000, weapons: WEAPONS, history: this.history,
      ffa: !!(this._matchCfg && this._matchCfg.net && this._matchCfg.net.ffa), ...ctx,
    };
    const lw = r ? loadoutWeapons(r.loadout) : null;
    if (full.shooter && !full.shooter.weapons && lw) full.shooter = { ...full.shooter, weapons: lw };
    return claim && claim.t === 'melee' ? this.anticheat.validateMelee(id, claim, full) : this.anticheat.validateHit(id, claim, full);
  }

  /** Roster-Eintrag zu einer netId (oder null). */
  rosterEntry(id) {
    return this.roster.find((e) => e.id === id) || null;
  }

  /** true, wenn alle Menschen im Roster ihr 'ready' gemeldet haben (Host: Bereitschafts-Schranke vor dem Countdown). */
  allReady() {
    return this.roster.length > 0 && this.roster.every((e) => e.ready);
  }

  /** Waffen, die ein Teilnehmer laut Roster tragen darf (null = unbekannt). */
  loadoutWeapons(id) {
    const r = this.roster.find((e) => e.id === id);
    return loadoutWeapons(r && r.loadout);
  }

  /* ---------------------------------------------------------------- Öffentliche Spiele */

  /**
   * Öffentliche Spiele beobachten: cb(liste) mit [{code, name, map, mode, players, max, level, ver, state, pvp, host,
   * compatible, full, seen}]. → stop()
   */
  watchPublic(cb) {
    const own = () => (this.role === 'host' && this.room ? this.room.code : null);
    const w = watchLobby({
      relays: this.relays,
      onChange: (list) => {
        const out = [];
        for (const g of list) {
          if (g.code === own()) continue;
          const players = clampInt(g.players, 0, 64, 0);
          const max = clampInt(g.max, 2, MAX_PLAYERS, 8);
          out.push({
            code: g.code, name: str(g.name, 24) || 'Raum', map: str(g.map, 24), mode: str(g.mode, 12),
            players, max, level: clampInt(g.level, 1, 99, 1), ver: str(g.ver, 40), state: g.state === 'match' ? 'match' : 'lobby',
            pvp: g.pvp === 'coop' ? 'coop' : 'pvp', host: str(g.host, 16),
            compatible: g.ver === this.build && g.pv === NET_VERSION && ONLINE_MODES.includes(g.mode),
            full: players >= max, seen: g.created,
          });
        }
        try { cb(out); } catch (err) { this._logOnce('watchPublic', err); }
      },
    });
    let stopped = false;
    return () => { if (!stopped) { stopped = true; w.close(); } };
  }

  /**
   * Schnelles Spiel: öffentliche Spiele kurz beobachten, das beste passende (gleiche Fassung, nicht voll, ähnliches
   * Level, lieber schon gefüllt und in der Lobby) wählen und beitreten. → Ergebnis von join() oder null.
   * mode: nur diesen Modus · filter(spiel) → bool: eigene Auswahl (z. B. Tests).
   */
  async quickPlay({ name, mode = null, filter = null, timeout = 4000, settle = 1500 } = {}) {
    const fits = (g) => g.compatible && !g.full && (!mode || g.mode === mode) && (!filter || filter(g));
    const myLevel = this._identity().level;
    const games = await new Promise((resolve) => {
      let last = [];
      let settleTimer = null;
      const finish = () => { clearTimeout(hard); clearTimeout(settleTimer); stop(); resolve(last); };
      const hard = setTimeout(finish, timeout);
      const stop = this.watchPublic((list) => {
        last = list;
        if (list.some(fits) && !settleTimer) settleTimer = setTimeout(finish, settle);
      });
    });
    const score = (g) => (g.state === 'lobby' ? 3 : 0) + Math.min(g.players, g.max - 1) * 0.5 - Math.abs(g.level - myLevel) / 10;
    const list = games.filter(fits).sort((a, b) => score(b) - score(a));
    for (const g of list.slice(0, 3)) {
      try {
        return await this.join(g.code, { name });
      } catch (err) {
        if (err && err.code === 'abgebrochen') throw err;
        // nächsten Raum versuchen (voll, weg, Verbindung gescheitert …)
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- Empfehlung (§9) */

  /** {max, reason, upload, fps, cores, memory, measured} */
  recommendation() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const conn = nav.connection ? { effectiveType: nav.connection.effectiveType, saveData: !!nav.connection.saveData } : null;
    // Akteure im Match: mit Bot-Auffüllung 2 × teamSize (Schnappschüsse tragen auch die Bots), sonst nur die Menschen
    const st = this.room && this.room.settings ? this.room.settings : DEFAULT_ROOM;
    const actors = st.botFill !== false ? Math.min(MAX_PLAYERS, 2 * (st.teamSize || DEFAULT_ROOM.teamSize)) : 0;
    // Fahrzeuge der Karte (Grenzland: je Team 2 Panzer + 3 Geländewagen, sonst je Team 1 + 1)
    const vehicles = st.vehicles ? (st.map === 'grenzland' ? 10 : 4) : 0;
    return recommend({
      actors, vehicles,
      cores: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
      memory: Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null,
      fps: this._fps,
      upload: this.upload ? this.upload.state() : null,
      connection: conn,
    });
  }

  /* ================================================================ Spiel-Hooks (main.js) */

  _measureFps() {
    const now = performance.now();
    if (this._fpsT0 == null) { this._fpsT0 = now; this._fpsN = 0; return; }
    this._fpsN++;
    const el = now - this._fpsT0;
    if (el < 1000) return;
    if (el < 3000) { const f = (this._fpsN * 1000) / el; this._fps = this._fps ? this._fps * 0.7 + f * 0.3 : f; }
    this._fpsT0 = now;
    this._fpsN = 0;
  }

  preUpdate(dt) {
    this._actorMapValid = false;
    if (this.chaos) this._chaosFlush();
    this._measureFps();
    if (this.sync && typeof this.sync.preUpdate === 'function') this.sync.preUpdate(dt);
  }

  postUpdate(dt) {
    if (this.sync && typeof this.sync.postUpdate === 'function') this.sync.postUpdate(dt);
  }

  /** main.js: Match geladen (vor dem Countdown). Online: Client meldet 'ready', Host markiert sich bereit. */
  onMatchStart(cfg) {
    this._actorMapValid = false;
    if (this.online) this.markReady();
    if (this.sync && typeof this.sync.onMatchStart === 'function') this.sync.onMatchStart(cfg);
  }

  /** main.js: Match zu Ende. Erst sync (Host schickt 'end'), dann Raum zurück in die Lobby. */
  onMatchEnd(result) {
    if (this.sync && typeof this.sync.onMatchEnd === 'function') this.sync.onMatchEnd(result);
    this._matchOver();
  }

  onTeardown() {
    this._actorMap.clear();
    this._actorMapValid = false;
    if (this.sync && typeof this.sync.onTeardown === 'function') this.sync.onTeardown();
  }

  _rebuildActorMap() {
    this._actorMap.clear();
    const list = (this.G && this.G.actors) || [];
    for (const a of list) if (a && Number.isInteger(a.netId)) this._actorMap.set(a.netId, a);
    this._actorMapValid = true;
  }

  /** Akteur zu einer netId (G.actors) oder null. */
  actorById(netId) {
    if (!this._actorMapValid) this._rebuildActorMap();
    let a = this._actorMap.get(netId);
    if (!a || a.netId !== netId) { this._rebuildActorMap(); a = this._actorMap.get(netId); }
    return a || null;
  }

  /** Alles beenden (Seite verlassen). */
  dispose() {
    this.leave('beendet');
    if (this._offState) this._offState();
    this._handlers.clear();
    this._fastHandlers.clear();
  }
}
