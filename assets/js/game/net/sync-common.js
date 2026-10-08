// NULLPUNKT – Mehrspieler: gemeinsame Helfer der Synchronisation (sync-host.js / sync-client.js).
// Reine Hilfsfunktionen ohne Zustand: Vektoren ↔ Arrays, Rundung, Identität eines Akteurs für die Akteursliste ('actors').
import * as THREE from 'three';

/** Schnappschüsse des Hosts je Sekunde (Vertrag §5). */
export const SNAPSHOT_HZ = 20;
/** Zustände des Clients je Sekunde (Vertrag §5). */
export const STATE_HZ = 30;
/** Modus-Zustand: höchstens so oft bei Änderung, spätestens alle MODE_MAX_GAP s (Vertrag §4 'mode'). */
export const MODE_MIN_GAP = 0.2;
export const MODE_MAX_GAP = 1;
/** Interpolation der Puppen auf dem Client: so weit hinter der Host-Zeit (mindestens, wächst mit dem Paketabstand). */
export const INTERP_MIN = 0.1;
export const INTERP_MAX = 0.4;
/** Puppe ohne Schnappschuss so lange → entfernen. */
export const STALE_SEC = 3;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Gerundete Zahl (Nachkommastellen d) – kleinere JSON-Nachrichten. */
export function rnd(v, d = 2) {
  if (!num(v)) return 0;
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

/** Vector3 | {x,y,z} → [x, y, z] (gerundet auf cm) bzw. null. */
export function arr3(v, d = 2) {
  if (!v) return null;
  if (Array.isArray(v)) return v.length >= 3 && num(v[0]) && num(v[1]) && num(v[2]) ? [rnd(v[0], d), rnd(v[1], d), rnd(v[2], d)] : null;
  return num(v.x) && num(v.y) && num(v.z) ? [rnd(v.x, d), rnd(v.y, d), rnd(v.z, d)] : null;
}

/** [x, y, z] → neuer THREE.Vector3 (oder null bei ungültigen Werten). */
export function vec3(a) {
  if (!Array.isArray(a) || a.length < 3 || !num(a[0]) || !num(a[1]) || !num(a[2])) return null;
  return new THREE.Vector3(a[0], a[1], a[2]);
}

/** Abstand zweier [x,y,z]. */
export function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Winkel auf (−π, π]. */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Kurzform der Ausrüstung für Nachrichten (nur Waffen/Ausrüstung, keine Tarnung). */
export function loadoutOf(actor) {
  const lo = (actor && actor.loadout) || {};
  const out = {};
  for (const k of ['cls', 'primary', 'secondary', 'lethal', 'tactical', 'melee', 'launcher']) if (typeof lo[k] === 'string') out[k] = lo[k];
  if (!out.cls && actor && typeof actor.cls === 'string') out.cls = actor.cls;
  return out;
}

/**
 * Eintrag der Akteursliste ('actors' {list}): Netz-Id, Name, Team, Mensch, Klasse, Ausrüstung, Aussehen (Variante/Tarnschema;
 * fehlt es, rechnen alle Clients dasselbe aus Klasse + Netz-Id aus – BotManager._lookForNet).
 */
export function identityOf(actor) {
  const e = {
    id: actor.netId, n: String(actor.name || ''), t: actor.team === 'A' || actor.team === 'B' ? actor.team : null,
    h: actor.isPlayer || actor.isRemoteHuman ? 1 : 0, c: actor.cls || (actor.loadout && actor.loadout.cls) || null, lo: loadoutOf(actor),
  };
  if (actor.isBot && !actor.isRemoteHuman) {
    if (actor.variant !== undefined && actor.variant !== null) e.v = actor.variant;
    if (actor.scheme) e.sc = actor.scheme;
  }
  return e;
}
