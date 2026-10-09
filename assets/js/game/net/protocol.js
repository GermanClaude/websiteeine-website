// NULLPUNKT – Mehrspieler: Binärpakete für den schnellen Kanal (Vertrag §5).
// Alle Zahlen little-endian. Winkel als Int16 = rad × 10000 (±3,2767 rad), Geschwindigkeiten Int16 in cm/s
// (±327 m/s), Lehnen Int8 = Wert × 100 (−1,27…1,27), Haltungsübergang (proneBlend) 0…1 → 0…255.
//
// Snapshot (Host → Client, 20 Hz):  u8 typ=1, u32 tick, f32 serverTime, u16 n, n × Akteur (31 Byte):
//   u16 id, f32 x, f32 y, f32 z, i16 yaw, i16 pitch, i16 vx, i16 vy, i16 vz, u16 flags, u8 weapon, u8 hp,
//   i8 lean, u8 shots, u8 proneBlend
// Zustand (Client → Host, 30 Hz):   u8 typ=2, u32 seq, f32 clientTime, ein Akteur-Block ohne id/hp (28 Byte).
//
// VR-Zusatz (nur für Spieler in einer VR-Sitzung, Flag-Bit 11 FLAGS.VR), je VR-Akteur VR_BLOCK = 11 Byte:
//   u8 bits (bit0 Haupthand verfolgt, bit1 Nebenhand verfolgt), i16 aimYaw, i16 aimPitch (Schussrichtung = Auge → Punkt, auf
//   den der Lauf zeigt; rad × 10000), i8 hx, hy, hz (Griff der Haupthand), i8 ox, oy, oz (Nebenhand) – Hände relativ zum
//   Auge im Blickrahmen (Gierung = yaw des Akteurs; x rechts, y oben, z vorn) in cm, ±1,27 m.
//   Snapshot: die Blöcke stehen hinter dem letzten Akteur, in der Reihenfolge der Akteure mit gesetztem VR-Bit (ohne id).
//   Zustand: der Block folgt direkt auf die 37 Byte. Ohne VR-Spieler sind die Pakete Byte für Byte wie vorher; ältere
//   Dekodierer lesen die festen 31/37 Byte und übergehen den Anhang (Bit 11 kennen sie nicht).
//
// Akteur-Objekt (encode/decode): { id, x, y, z, yaw, pitch, vx, vy, vz, flags, weapon, hp, lean, shots, proneBlend, vr }
//   weapon: Index in WEAPON_INDEX (Zahl) oder Waffen-id (Text) – decode liefert Index (weapon) und id (weaponId).
//   flags:  Bitmaske (FLAGS) oder Objekt mit Wahrheitswerten ({alive, crouch, …}, siehe packFlags). Das VR-Bit setzt bzw.
//           löscht encode selbst (nach vr).
//   vr:     null | { aimYaw, aimPitch, main: [x,y,z] | null, off: [x,y,z] | null } (decode liefert immer das Feld vr).
// Pure Logik ohne DOM/three.js – läuft auch in Node (tools/net-proto-test.mjs).
import { WEAPON_IDS } from '../../shared/weapons.data.js';

export const PKT_SNAPSHOT = 1;
export const PKT_STATE = 2;
/** Reserviert: Pakettypen ab 200 verarbeitet NetSystem selbst (werden nicht an onFast weitergereicht). */
export const PKT_INTERNAL_MIN = 200;

/** Waffen-Indexliste: alle Waffen-ids, stabil sortiert nach id (gleich auf Host und Clients derselben Fassung). */
export const WEAPON_INDEX = Object.freeze([...WEAPON_IDS].sort());
/** Wert für „keine/unbekannte Waffe“. */
export const NO_WEAPON = 255;
const WEAPON_POS = new Map(WEAPON_INDEX.map((id, i) => [id, i]));

/** Index einer Waffen-id (NO_WEAPON = unbekannt). */
export function weaponIndexOf(id) {
  const i = WEAPON_POS.get(id);
  return i === undefined ? NO_WEAPON : i;
}

/** Waffen-id zu einem Index (null = unbekannt/keine). */
export function weaponByIndex(i) {
  return Number.isInteger(i) && i >= 0 && i < WEAPON_INDEX.length ? WEAPON_INDEX[i] : null;
}

/** Zustandsbits (u16). */
export const FLAGS = Object.freeze({
  ALIVE: 1 << 0,
  CROUCH: 1 << 1,
  PRONE: 1 << 2,
  SPRINT: 1 << 3,
  ADS: 1 << 4,
  RELOADING: 1 << 5,
  ON_GROUND: 1 << 6,
  SLIDING: 1 << 7,
  THROWING: 1 << 8,
  MELEEING: 1 << 9,
  SWIMMING: 1 << 10,
  /** Spieler in einer VR-Sitzung – ein VR-Zusatzblock folgt (siehe oben). */
  VR: 1 << 11,
});
const FLAG_KEYS = [
  ['alive', FLAGS.ALIVE], ['crouch', FLAGS.CROUCH], ['prone', FLAGS.PRONE], ['sprint', FLAGS.SPRINT], ['ads', FLAGS.ADS],
  ['reloading', FLAGS.RELOADING], ['onGround', FLAGS.ON_GROUND], ['sliding', FLAGS.SLIDING], ['throwing', FLAGS.THROWING],
  ['meleeing', FLAGS.MELEEING], ['swimming', FLAGS.SWIMMING], ['vr', FLAGS.VR],
];

/** {alive, crouch, prone, sprint, ads, reloading, onGround, sliding, throwing, meleeing, swimming, vr} → Bitmaske. */
export function packFlags(o) {
  if (typeof o === 'number') return o & 0xffff;
  let f = 0;
  if (o) for (const [k, bit] of FLAG_KEYS) if (o[k]) f |= bit;
  return f;
}

/** Bitmaske → Objekt mit Wahrheitswerten (Schlüssel wie packFlags). */
export function unpackFlags(f) {
  const o = {};
  for (const [k, bit] of FLAG_KEYS) o[k] = (f & bit) !== 0;
  return o;
}

export const SNAPSHOT_HEADER = 11;
export const SNAPSHOT_ENTITY = 31;
export const STATE_SIZE = 9 + 28;
/** VR-Zusatzblock je VR-Akteur (Byte). */
export const VR_BLOCK = 11;
/** Hände relativ zum Auge: höchstens so weit (m) – i8 in cm. */
export const VR_REACH = 1.27;
/** Höchstzahl Akteure je Snapshot (hält ein Paket unter ~16 KB, sicher für SCTP ohne Fragmentierungsprobleme). */
export const MAX_ENTITIES = 500;

const ANGLE = 10000;
const TWO_PI = Math.PI * 2;
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const i16 = (v) => clampInt(Math.round(fin(v)), -32768, 32767);
const u8 = (v) => clampInt(Math.round(fin(v)), 0, 255);
/** Winkel auf (−π, π] bringen und in Int16 (rad × 10000) wandeln. */
function angle16(a) {
  let v = fin(a);
  if (v > Math.PI || v < -Math.PI) v -= TWO_PI * Math.round(v / TWO_PI);
  return i16(v * ANGLE);
}
/** Neigung (pitch) wird nicht umgebrochen, nur begrenzt. */
const pitch16 = (a) => i16(fin(a) * ANGLE);
const vel16 = (v) => i16(fin(v) * 100);
const lean8 = (v) => clampInt(Math.round(fin(v) * 100), -127, 127);
const blend8 = (v) => u8(fin(v) * 255);
const weapon8 = (w) => (typeof w === 'string' ? weaponIndexOf(w) : Number.isInteger(w) && w >= 0 && w <= 255 ? w : NO_WEAPON);
const f32 = (v) => Math.fround(fin(v));

function writeBody(dv, o, e, withHp) {
  dv.setFloat32(o, f32(e.x), true); dv.setFloat32(o + 4, f32(e.y), true); dv.setFloat32(o + 8, f32(e.z), true);
  dv.setInt16(o + 12, angle16(e.yaw), true);
  dv.setInt16(o + 14, pitch16(e.pitch), true);
  dv.setInt16(o + 16, vel16(e.vx), true); dv.setInt16(o + 18, vel16(e.vy), true); dv.setInt16(o + 20, vel16(e.vz), true);
  dv.setUint16(o + 22, flagsOf(e), true);
  dv.setUint8(o + 24, weapon8(e.weapon));
  let p = o + 25;
  if (withHp) dv.setUint8(p++, u8(e.hp));
  dv.setInt8(p++, lean8(e.lean));
  dv.setUint8(p++, (fin(e.shots) | 0) & 255);
  dv.setUint8(p++, blend8(e.proneBlend));
  return p;
}

/** VR-Zusatz gültig? (Objekt mit endlicher Zielrichtung) */
function hasVr(e) {
  const v = e && e.vr;
  return !!(v && typeof v === 'object' && Number.isFinite(v.aimYaw) && Number.isFinite(v.aimPitch));
}
/** [x,y,z] | {x,y,z} mit endlichen Werten → [x,y,z], sonst null. */
function vec(v) {
  if (!v) return null;
  const x = Array.isArray(v) ? v[0] : v.x, y = Array.isArray(v) ? v[1] : v.y, z = Array.isArray(v) ? v[2] : v.z;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null;
}
const cm8 = (v) => clampInt(Math.round(fin(v) * 100), -127, 127);
const HALF_PI = Math.PI / 2;

function writeVr(dv, o, v) {
  const m = vec(v.main), f = vec(v.off);
  dv.setUint8(o, (m ? 1 : 0) | (f ? 2 : 0));
  dv.setInt16(o + 1, angle16(v.aimYaw), true);
  dv.setInt16(o + 3, pitch16(Math.max(-HALF_PI, Math.min(HALF_PI, fin(v.aimPitch)))), true);
  for (let k = 0; k < 3; k++) {
    dv.setInt8(o + 5 + k, m ? cm8(m[k]) : 0);
    dv.setInt8(o + 8 + k, f ? cm8(f[k]) : 0);
  }
  return o + VR_BLOCK;
}

function readVr(dv, o) {
  const bits = dv.getUint8(o);
  const hand = (p) => [dv.getInt8(p) / 100, dv.getInt8(p + 1) / 100, dv.getInt8(p + 2) / 100];
  return {
    aimYaw: dv.getInt16(o + 1, true) / ANGLE,
    aimPitch: dv.getInt16(o + 3, true) / ANGLE,
    main: bits & 1 ? hand(o + 5) : null,
    off: bits & 2 ? hand(o + 8) : null,
  };
}

/** Bitmaske eines Akteurs mit VR-Bit passend zum Zusatz (gesetzt genau dann, wenn vr gültig ist). */
const flagsOf = (e) => (hasVr(e) ? packFlags(e.flags) | FLAGS.VR : packFlags(e.flags) & ~FLAGS.VR);

function readBody(dv, o, e, withHp) {
  e.x = dv.getFloat32(o, true); e.y = dv.getFloat32(o + 4, true); e.z = dv.getFloat32(o + 8, true);
  e.yaw = dv.getInt16(o + 12, true) / ANGLE;
  e.pitch = dv.getInt16(o + 14, true) / ANGLE;
  e.vx = dv.getInt16(o + 16, true) / 100; e.vy = dv.getInt16(o + 18, true) / 100; e.vz = dv.getInt16(o + 20, true) / 100;
  e.flags = dv.getUint16(o + 22, true);
  e.weapon = dv.getUint8(o + 24);
  e.weaponId = weaponByIndex(e.weapon);
  let p = o + 25;
  if (withHp) e.hp = dv.getUint8(p++);
  e.lean = dv.getInt8(p++) / 100;
  e.shots = dv.getUint8(p++);
  e.proneBlend = dv.getUint8(p++) / 255;
  return p;
}

/** Typ eines Pakets (erstes Byte) oder −1. */
export function packetType(buf) {
  const dv = toView(buf);
  return dv && dv.byteLength ? dv.getUint8(0) : -1;
}

/**
 * Snapshot kodieren. entities: Liste von Akteur-Objekten (siehe oben); mehr als MAX_ENTITIES werden abgeschnitten.
 * @returns {ArrayBuffer}
 */
export function encodeSnapshot(tick, serverTime, entities) {
  const list = entities || [];
  const n = Math.min(list.length, MAX_ENTITIES);
  let nvr = 0;
  for (let i = 0; i < n; i++) if (hasVr(list[i])) nvr++;
  const buf = new ArrayBuffer(SNAPSHOT_HEADER + n * SNAPSHOT_ENTITY + nvr * VR_BLOCK);
  const dv = new DataView(buf);
  dv.setUint8(0, PKT_SNAPSHOT);
  dv.setUint32(1, (fin(tick) >>> 0), true);
  dv.setFloat32(5, f32(serverTime), true);
  dv.setUint16(9, n, true);
  let o = SNAPSHOT_HEADER;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    dv.setUint16(o, clampInt(fin(e.id) | 0, 0, 65535), true);
    o = writeBody(dv, o + 2, e, true);
  }
  // VR-Anhang: Blöcke in der Reihenfolge der Akteure mit VR-Bit
  if (nvr) for (let i = 0; i < n; i++) if (hasVr(list[i])) o = writeVr(dv, o, list[i].vr);
  return buf;
}

/** Snapshot dekodieren → {type, tick, serverTime, entities:[…]} oder null (falscher Typ/zu kurz). */
export function decodeSnapshot(buf) {
  const dv = toView(buf);
  if (!dv || dv.byteLength < SNAPSHOT_HEADER || dv.getUint8(0) !== PKT_SNAPSHOT) return null;
  const tick = dv.getUint32(1, true);
  const serverTime = dv.getFloat32(5, true);
  const n = Math.min(dv.getUint16(9, true), Math.floor((dv.byteLength - SNAPSHOT_HEADER) / SNAPSHOT_ENTITY));
  const entities = new Array(n);
  let o = SNAPSHOT_HEADER;
  for (let i = 0; i < n; i++) {
    const e = { id: dv.getUint16(o, true) };
    o = readBody(dv, o + 2, e, true);
    e.vr = null;
    entities[i] = e;
  }
  // VR-Anhang (fehlt er – abgeschnittenes Paket –, bleibt vr null)
  for (let i = 0; i < n; i++) {
    const e = entities[i];
    if (!(e.flags & FLAGS.VR)) continue;
    if (o + VR_BLOCK > dv.byteLength) break;
    e.vr = readVr(dv, o);
    o += VR_BLOCK;
  }
  return { type: PKT_SNAPSHOT, tick, serverTime, entities };
}

/** Zustand des eigenen Spielers kodieren (Client → Host). entity ohne id/hp; mit entity.vr + VR-Block. @returns {ArrayBuffer} */
export function encodeState(seq, clientTime, entity) {
  const e = entity || {};
  const vr = hasVr(e);
  const buf = new ArrayBuffer(STATE_SIZE + (vr ? VR_BLOCK : 0));
  const dv = new DataView(buf);
  dv.setUint8(0, PKT_STATE);
  dv.setUint32(1, (fin(seq) >>> 0), true);
  dv.setFloat32(5, f32(clientTime), true);
  writeBody(dv, 9, e, false);
  if (vr) writeVr(dv, STATE_SIZE, e.vr);
  return buf;
}

/** Zustand dekodieren → {type, seq, clientTime, entity} oder null. */
export function decodeState(buf) {
  const dv = toView(buf);
  if (!dv || dv.byteLength < STATE_SIZE || dv.getUint8(0) !== PKT_STATE) return null;
  const entity = {};
  readBody(dv, 9, entity, false);
  entity.vr = (entity.flags & FLAGS.VR) && dv.byteLength >= STATE_SIZE + VR_BLOCK ? readVr(dv, STATE_SIZE) : null;
  return { type: PKT_STATE, seq: dv.getUint32(1, true), clientTime: dv.getFloat32(5, true), entity };
}

function toView(buf) {
  if (buf instanceof ArrayBuffer) return new DataView(buf);
  if (buf && buf.buffer instanceof ArrayBuffer) return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return null;
}
