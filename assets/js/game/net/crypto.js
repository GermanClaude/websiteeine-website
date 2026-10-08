// NULLPUNKT – Mehrspieler: Krypto-Hilfen für die Vermittlung (Signaling).
// Schlüsselpaare (secp256k1/Schnorr wie bei Nostr), Ereignis-Signaturen (NIP-01), Schlüsselaustausch (ECDH)
// und AES-GCM-Verschlüsselung der Verbindungsdaten. Grund: Die Vermittlung läuft über öffentliche Relays –
// ohne Verschlüsselung könnte jeder dort die IP-Adressen in den Verbindungsangeboten mitlesen.
import * as secp from '../../../vendor/noble/secp256k1.min.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const hex = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
};

export const unhex = (s) => {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};

export const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};

export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function sha256(data) {
  return new Uint8Array(await subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}

/** Neues Sitzungs-Schlüsselpaar. pk = 32-Byte-x-Koordinate als Hex (Nostr-Format). */
export function newKeys() {
  const sk = secp.utils.randomSecretKey();
  return { sk, pk: hex(secp.schnorr.getPublicKey(sk)) };
}

/** Signiertes Nostr-Ereignis (NIP-01). */
export async function signEvent(keys, kind, tags, content, createdAt = Math.floor(Date.now() / 1000)) {
  const ev = { pubkey: keys.pk, created_at: createdAt, kind, tags, content };
  const id = await sha256(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
  ev.id = hex(id);
  ev.sig = hex(await secp.schnorr.signAsync(id, keys.sk));
  return ev;
}

/** Prüft ID und Signatur eines fremden Ereignisses. */
export async function verifyEvent(ev) {
  try {
    if (!ev || typeof ev.id !== 'string' || typeof ev.sig !== 'string' || typeof ev.pubkey !== 'string') return false;
    const id = hex(await sha256(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])));
    if (id !== ev.id) return false;
    return await secp.schnorr.verifyAsync(unhex(ev.sig), unhex(ev.id), unhex(ev.pubkey));
  } catch {
    return false;
  }
}

async function hkdfKey(secret, info) {
  const base = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('nullpunkt-v1'), info: enc.encode(info) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Gemeinsamer Schlüssel zweier Teilnehmer (ECDH über die x-only-Schlüssel, nur die x-Koordinate zählt). */
export function sharedKey(keys, peerPk) {
  const point = secp.getSharedSecret(keys.sk, unhex('02' + peerPk));
  return hkdfKey(point.slice(1, 33), 'signal');
}

/** Schlüssel, den nur kennt, wer den Raumcode kennt (für das Host-Signal privater Räume). */
export async function roomKey(code) {
  return hkdfKey(await sha256('nullpunkt/v1/raum/' + code), 'room');
}

/** Verschlüsselt ein JSON-Objekt → "iv.ciphertext" (Base64). */
export async function seal(key, obj) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return b64(iv) + '.' + b64(ct);
}

/** Entschlüsselt "iv.ciphertext" → Objekt, oder null bei falschem Schlüssel/Manipulation. */
export async function unseal(key, text) {
  try {
    const [iv, ct] = String(text).split('.');
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
    return JSON.parse(dec.decode(plain));
  } catch {
    return null;
  }
}
