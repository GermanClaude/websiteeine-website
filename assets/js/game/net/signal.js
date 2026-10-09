// NULLPUNKT – Mehrspieler: Vermittlung über Nostr-Relays.
// Ablauf privater Raum (Raumcode):
//   Host:   legt ein gespeichertes Lebenszeichen ins Raum-Thema (ersetzbares Ereignis mit Ablaufzeit, verschlüsselt mit
//           dem Raumcode-Schlüssel) und erneuert es alle BEACON_MS – selten genug, dass öffentliche Relays den Host
//           nicht drosseln/sperren (alle 2,5 s führte nach ~10 s zu „rate-limited“ und Sperren → neue Spieler bekamen
//           keine Antwort mehr). Ein neuer Client bekommt das gespeicherte Lebenszeichen sofort beim Abonnieren.
//   Client: liest das Lebenszeichen, findet so den Schlüssel des Hosts, schickt sein Verbindungsangebot
//           (verschlüsselt nur für den Host, ECDH) und erhält die Antwort (verschlüsselt nur für ihn). Kommt keine
//           Antwort, wird das Angebot wiederholt (gleiche Kennung n – der Host beantwortet es nur einmal und schickt
//           bei Wiederholungen dieselbe Antwort erneut).
// Öffentliche Spiele: Der Host legt zusätzlich einen Eintrag in die öffentliche Spieleliste (ersetzbares Ereignis
// mit Ablaufzeit), den jeder lesen kann – inkl. Raumcode, damit man beitreten kann.
// Das Raum-Thema ist ein Hash des Codes: Wer den Code nicht kennt, sieht nur zufällige Zeichen.
import { newKeys, signEvent, sharedKey, roomKey, seal, unseal, sha256, hex, randomBytes } from './crypto.js';
import { RelayPool } from './nostr.js';

export const PROTOCOL = 1;
export const KIND_SIGNAL = 25050;   // kurzlebig (wird von Relays nicht gespeichert)
export const KIND_LOBBY = 30650;    // ersetzbar je Host-Sitzung (d-Tag), mit Ablaufzeit
export const KIND_ROOM = 30651;     // Lebenszeichen privater Räume: ersetzbar je Raum-Thema (d-Tag), mit Ablaufzeit
export const LOBBY_TOPIC = 'nullpunkt-lobby-v1';
const BEACON_MS = 30000;
const BEACON_TTL = 120;
const LISTING_MS = 45000;
const LISTING_TTL = 150;
const META_MIN_MS = 8000;   // Meta-Änderungen (Spielerzahl …) höchstens so oft veröffentlichen (Relay-Drosselung)
const OFFER_RETRY_MS = 6000;

/** Öffentliche Relays (Port 443, ohne Konto). Reihenfolge = Vorrang. */
// Geprüft 09.10.2026 (Live-Test mit mehreren Beitritten über 4 Minuten): nehmen kurzlebige (25050) und ersetzbare
// Ereignisse (30650/30651 mit Ablaufzeit) an und liefern sie aus. offchain.pub entfernt (lehnt unbekannte Schlüssel ab,
// „web of trust“); relay.damus.io drosselt/sperrt bei hoher Rate (deshalb seltene Lebenszeichen) und steht hinten.
export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.snort.social',
  'wss://nostr.oxtr.dev',
  'wss://nostr.bitcoiner.social',
  'wss://relay.damus.io',
];

/** Relays aus der Adresse (?relays=ws://…,ws://…) – für Tests mit lokalem Relay. */
export function relaysFromUrl(search = globalThis.location ? location.search : '') {
  const v = new URLSearchParams(search).get('relays');
  return v ? v.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\//.test(s)) : null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I, O, 0, 1 (Verwechslungsgefahr)
export const CODE_LENGTH = 6;

export function newRoomCode() {
  const r = randomBytes(CODE_LENGTH);
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[r[i] % CODE_ALPHABET.length];
  return s;
}

/** Normalisiert Eingaben („ab-c d2“ → „ABCD2“): Großbuchstaben, nur Zeichen aus dem Code-Alphabet, höchstens 6. */
export function normCode(text) {
  return [...String(text || '').toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, CODE_LENGTH);
}

export const isValidCode = (code) => code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));

async function roomTopic(code) {
  return 'np1-' + hex(await sha256('nullpunkt/v1/thema/' + code)).slice(0, 32);
}

const now = () => Math.floor(Date.now() / 1000);

/**
 * Host-Seite der Vermittlung.
 * onOffer(clientPk, hello, offerSdp) muss {sdp} (Antwort) oder {reject: 'grund'} liefern.
 */
export class HostSignal {
  constructor({ relays, code, meta, onOffer, onStatus }) {
    this.keys = newKeys();
    this.code = code;
    this.meta = meta || {};
    this.onOffer = onOffer;
    this.pool = new RelayPool(relays || DEFAULT_RELAYS, { onStatus });
    this.session = hex(randomBytes(8));
    this.listing = null;
    this.handled = new Set();
    this.replies = new Map(); // `${clientPk}:${n}` → Promise<Antwort-Inhalt> (Wiederholungen nur einmal beantworten)
    this.timers = [];
    this.sub = null;
    this._lastMeta = 0;
  }

  async start() {
    this.topic = await roomTopic(this.code);
    this.rkey = await roomKey(this.code);
    this.sub = this.pool.subscribe(
      // since großzügig: kurzlebige Ereignisse speichert ohnehin kein Relay; knapp bemessen würde es Clients mit
      // nachgehender Uhr aussperren
      [{ kinds: [KIND_SIGNAL], '#t': [this.topic], '#p': [this.keys.pk], since: now() - 3600 }],
      (ev) => this._onEvent(ev));
    const beacon = () => this._beacon();
    beacon();
    this.timers.push(setInterval(beacon, BEACON_MS));
    return this.pool.waitOpen();
  }

  async _beacon(ended = false) {
    const content = await seal(this.rkey, { t: 'host', v: PROTOCOL, s: this.session, meta: this.meta, ended });
    const ev = await signEvent(this.keys, KIND_ROOM,
      [['d', this.topic], ['t', this.topic], ['expiration', String(now() + (ended ? 1 : BEACON_TTL))]], content);
    this.pool.publish(ev);
  }

  /** Meta-Daten (Spielerzahl, Karte …) für Lebenszeichen und öffentliche Liste aktualisieren – gebündelt, höchstens
   *  alle META_MIN_MS (sonst drosseln/sperren öffentliche Relays den Host). */
  setMeta(meta) {
    this.meta = { ...this.meta, ...meta };
    if (this._metaTimer) return;
    const wait = Math.max(0, this._lastMeta + META_MIN_MS - Date.now());
    this._metaTimer = setTimeout(() => {
      this._metaTimer = null;
      this._lastMeta = Date.now();
      this._beacon();
      if (this.listing) this._publishListing();
    }, wait);
  }

  /** Öffentliche Spieleliste an/aus. info: frei lesbare Angaben (Name, Karte, Modus, Spieler …). */
  setPublic(on) {
    clearInterval(this.listingTimer);
    this.listing = on ? true : null;
    if (on) {
      this._publishListing();
      this.listingTimer = setInterval(() => this._publishListing(), LISTING_MS);
    } else {
      // Eintrag sofort als beendet überschreiben (Ablaufzeit in der Vergangenheit).
      this._publishListing(true);
    }
  }

  async _publishListing(ended = false) {
    const content = JSON.stringify({ v: PROTOCOL, code: this.code, ended, ...this.meta });
    const ev = await signEvent(this.keys, KIND_LOBBY,
      [['d', this.session], ['t', LOBBY_TOPIC], ['expiration', String(now() + (ended ? 1 : LISTING_TTL))]], content);
    this.pool.publish(ev);
  }

  async _onEvent(ev) {
    if (ev.pubkey === this.keys.pk || this.handled.has(ev.id)) return;
    this.handled.add(ev.id);
    const key = await sharedKey(this.keys, ev.pubkey);
    const msg = await unseal(key, ev.content);
    if (!msg || msg.t !== 'offer' || typeof msg.sdp !== 'string') return;
    // Wiederholtes Angebot (gleiche Kennung): nicht erneut verbinden, nur dieselbe Antwort noch einmal senden
    const rk = ev.pubkey + ':' + String(msg.n);
    let reply = this.replies.get(rk);
    const repeat = !!reply;
    if (!reply) {
      reply = (async () => {
        try {
          return msg.v !== PROTOCOL ? { reject: 'version' } : await this.onOffer(ev.pubkey, msg.hello || {}, msg.sdp);
        } catch (err) {
          console.warn('[net] Angebot konnte nicht beantwortet werden', err);
          return { reject: 'fehler' };
        }
      })();
      this.replies.set(rk, reply);
      if (this.replies.size > 200) this.replies.delete(this.replies.keys().next().value);
    }
    const r = await reply;
    if (repeat && !r) return;
    const content = await seal(key, { t: 'answer', v: PROTOCOL, n: msg.n, ...r });
    const out = await signEvent(this.keys, KIND_SIGNAL, [['t', this.topic], ['p', ev.pubkey]], content);
    this.pool.publish(out);
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    clearInterval(this.listingTimer);
    clearTimeout(this._metaTimer);
    // Gespeichertes Lebenszeichen als beendet überschreiben (sonst fänden Clients bis zum Ablauf einen toten Raum)
    if (this.rkey) this._beacon(true);
    if (this.listing) this._publishListing(true);
    if (this.sub) this.sub.close();
    // Kurz warten, damit das „beendet“ noch rausgeht.
    setTimeout(() => this.pool.close(), 1500);
  }
}

/**
 * Client-Seite: Host im Raum finden und Angebot/Antwort austauschen.
 * makeOffer() → Promise<{sdp, link}>; Ergebnis von join(): {link, hostPk, meta} oder Fehler mit .code
 * ('kein-relay' | 'kein-host' | 'keine-antwort' | 'abgelehnt:<grund>').
 */
export async function joinRoom({ relays, code, hello, makeOffer, onStatus, timeout = 20000 }) {
  const pool = new RelayPool(relays || DEFAULT_RELAYS, { onStatus });
  const keys = newKeys();
  const topic = await roomTopic(code);
  const rkey = await roomKey(code);
  const fail = (codeName) => { const e = new Error(codeName); e.code = codeName; return e; };
  let offered = null;
  try {
    if (!(await pool.waitOpen())) throw fail('kein-relay');
    // 1) Host-Lebenszeichen: gespeichertes (KIND_ROOM, kommt sofort) oder kurzlebiges (ältere Hosts)
    const host = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { sub.close(); reject(fail('kein-host')); }, timeout);
      const sub = pool.subscribe([
        { kinds: [KIND_ROOM], '#d': [topic] },
        { kinds: [KIND_SIGNAL], '#t': [topic], since: now() - 10 },
      ], async (ev) => {
        if (ev.kind === KIND_ROOM) {
          // abgelaufen (eigene Uhr, 60 s Spielraum für Uhrabweichungen) → toter Raum
          const exp = Number((ev.tags.find((t) => t[0] === 'expiration') || [])[1] || 0);
          if (exp && exp + 60 < now()) return;
        }
        const msg = await unseal(rkey, ev.content);
        if (!msg || msg.t !== 'host' || msg.ended) return;
        clearTimeout(timer);
        sub.close();
        resolve({ pk: ev.pubkey, meta: msg.meta || {}, v: msg.v });
      });
    });
    if (host.v !== PROTOCOL) throw fail('abgelehnt:version');
    // 2) Angebot erzeugen und verschlüsselt an den Host schicken
    const { link, sdp } = await makeOffer(host.meta);
    offered = link;
    const key = await sharedKey(keys, host.pk);
    const nonce = hex(randomBytes(6));
    const answer = await new Promise((resolve, reject) => {
      let retry = null;
      const timer = setTimeout(() => { clearInterval(retry); sub.close(); reject(fail('keine-antwort')); }, timeout);
      // since großzügig (Uhrabweichung zwischen Geräten); Zuordnung über Absender, Empfänger und Kennung n
      const sub = pool.subscribe([{ kinds: [KIND_SIGNAL], '#t': [topic], '#p': [keys.pk], authors: [host.pk], since: now() - 600 }], async (ev) => {
        const msg = await unseal(key, ev.content);
        if (!msg || msg.t !== 'answer' || msg.n !== nonce) return;
        clearTimeout(timer);
        clearInterval(retry);
        sub.close();
        resolve(msg);
      });
      const send = () => seal(key, { t: 'offer', v: PROTOCOL, n: nonce, hello, sdp })
        .then((content) => signEvent(keys, KIND_SIGNAL, [['t', topic], ['p', host.pk]], content))
        .then((ev) => pool.publish(ev))
        .catch(() => { /* nächster Versuch */ });
      send();
      // Antwort verloren (Relay gedrosselt/getrennt)? Angebot wiederholen – der Host antwortet nur einmal je Kennung.
      retry = setInterval(send, OFFER_RETRY_MS);
    });
    if (answer.reject) { link.close('abgelehnt'); throw fail('abgelehnt:' + answer.reject); }
    try { await link.accept(answer.sdp); } catch { throw fail('verbindung-fehlgeschlagen'); }
    offered = null;
    return { link, hostPk: host.pk, meta: host.meta };
  } catch (err) {
    // Angebot ohne Antwort/Annahme: Verbindung schließen (sonst hängt sie bis zur Zeitüberschreitung)
    if (offered) offered.close('abgebrochen');
    throw err;
  } finally {
    // Die Vermittlung wird nach dem Austausch nicht mehr gebraucht.
    setTimeout(() => pool.close(), 1000);
  }
}

/**
 * Öffentliche Spieleliste beobachten. onChange(liste) mit [{code, meta…, pk, seen}], abgelaufene fallen heraus.
 * @returns {{close: () => void, refresh: () => void}}
 */
export function watchLobby({ relays, onChange, onStatus }) {
  const pool = new RelayPool(relays || DEFAULT_RELAYS, { onStatus });
  const games = new Map();
  const emit = () => {
    const t = now();
    for (const [k, g] of games) if (g.ended || g.expires < t) games.delete(k);
    onChange([...games.values()].sort((a, b) => b.created - a.created));
  };
  let sub = null;
  const open = () => {
    if (sub) sub.close();
    sub = pool.subscribe([{ kinds: [KIND_LOBBY], '#t': [LOBBY_TOPIC], since: now() - 90 }], (ev) => {
      let data;
      try { data = JSON.parse(ev.content); } catch { return; }
      if (!data || data.v !== PROTOCOL || !isValidCode(String(data.code || ''))) return;
      const exp = Number((ev.tags.find((t) => t[0] === 'expiration') || [])[1] || ev.created_at + LISTING_TTL);
      const d = (ev.tags.find((t) => t[0] === 'd') || [])[1] || ev.pubkey;
      const key = ev.pubkey + ':' + d;
      const old = games.get(key);
      if (old && old.created > ev.created_at) return;
      games.set(key, { ...data, pk: ev.pubkey, created: ev.created_at, expires: exp });
      emit();
    });
  };
  open();
  const timer = setInterval(emit, 5000);
  return {
    refresh: open,
    close: () => { clearInterval(timer); if (sub) sub.close(); pool.close(); },
  };
}
