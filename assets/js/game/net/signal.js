// NULLPUNKT – Mehrspieler: Vermittlung über Nostr-Relays.
// Ablauf privater Raum (Raumcode):
//   Host:   veröffentlicht alle BEACON_MS ein Lebenszeichen im Raum-Thema (verschlüsselt mit dem Raumcode-Schlüssel)
//   Client: hört das Raum-Thema ab, findet so den Schlüssel des Hosts, schickt sein Verbindungsangebot
//           (verschlüsselt nur für den Host, ECDH) und erhält die Antwort (verschlüsselt nur für ihn).
// Öffentliche Spiele: Der Host legt zusätzlich einen Eintrag in die öffentliche Spieleliste (ersetzbares Ereignis
// mit Ablaufzeit), den jeder lesen kann – inkl. Raumcode, damit man beitreten kann.
// Das Raum-Thema ist ein Hash des Codes: Wer den Code nicht kennt, sieht nur zufällige Zeichen.
import { newKeys, signEvent, sharedKey, roomKey, seal, unseal, sha256, hex, randomBytes } from './crypto.js';
import { RelayPool } from './nostr.js';

export const PROTOCOL = 1;
export const KIND_SIGNAL = 25050;   // kurzlebig (wird von Relays nicht gespeichert)
export const KIND_LOBBY = 30650;    // ersetzbar je Host-Sitzung (d-Tag), mit Ablaufzeit
export const LOBBY_TOPIC = 'nullpunkt-lobby-v1';
const BEACON_MS = 2500;
const LISTING_MS = 15000;
const LISTING_TTL = 60;

/** Öffentliche Relays (Port 443, ohne Konto). Reihenfolge = Vorrang. */
// Geprüft 08.10.2026: nehmen kurzlebige (25050) und ersetzbare Ereignisse (30650 mit Ablaufzeit) an und liefern sie aus.
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://nostr.mom',
  'wss://nostr-pub.wellorder.net',
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
    this.timers = [];
    this.sub = null;
  }

  async start() {
    this.topic = await roomTopic(this.code);
    this.rkey = await roomKey(this.code);
    this.sub = this.pool.subscribe(
      [{ kinds: [KIND_SIGNAL], '#t': [this.topic], '#p': [this.keys.pk], since: now() - 30 }],
      (ev) => this._onEvent(ev));
    const beacon = () => this._beacon();
    beacon();
    this.timers.push(setInterval(beacon, BEACON_MS));
    return this.pool.waitOpen();
  }

  async _beacon() {
    const content = await seal(this.rkey, { t: 'host', v: PROTOCOL, s: this.session, meta: this.meta });
    const ev = await signEvent(this.keys, KIND_SIGNAL, [['t', this.topic]], content);
    this.pool.publish(ev);
  }

  /** Meta-Daten (Spielerzahl, Karte …) für Lebenszeichen und öffentliche Liste aktualisieren. */
  setMeta(meta) {
    this.meta = { ...this.meta, ...meta };
    if (this.listing) this._publishListing();
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
    let reply;
    try {
      reply = msg.v !== PROTOCOL ? { reject: 'version' } : await this.onOffer(ev.pubkey, msg.hello || {}, msg.sdp);
    } catch (err) {
      console.warn('[net] Angebot konnte nicht beantwortet werden', err);
      reply = { reject: 'fehler' };
    }
    const content = await seal(key, { t: 'answer', v: PROTOCOL, n: msg.n, ...reply });
    const out = await signEvent(this.keys, KIND_SIGNAL, [['t', this.topic], ['p', ev.pubkey]], content);
    this.pool.publish(out);
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    clearInterval(this.listingTimer);
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
    // 1) Host-Lebenszeichen abwarten
    const host = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { sub.close(); reject(fail('kein-host')); }, timeout);
      const sub = pool.subscribe([{ kinds: [KIND_SIGNAL], '#t': [topic], since: now() - 10 }], async (ev) => {
        const msg = await unseal(rkey, ev.content);
        if (!msg || msg.t !== 'host') return;
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
      const timer = setTimeout(() => { sub.close(); reject(fail('keine-antwort')); }, timeout);
      const sub = pool.subscribe([{ kinds: [KIND_SIGNAL], '#t': [topic], '#p': [keys.pk], authors: [host.pk], since: now() - 10 }], async (ev) => {
        const msg = await unseal(key, ev.content);
        if (!msg || msg.t !== 'answer' || msg.n !== nonce) return;
        clearTimeout(timer);
        sub.close();
        resolve(msg);
      });
      seal(key, { t: 'offer', v: PROTOCOL, n: nonce, hello, sdp })
        .then((content) => signEvent(keys, KIND_SIGNAL, [['t', topic], ['p', host.pk]], content))
        .then((ev) => pool.publish(ev));
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
