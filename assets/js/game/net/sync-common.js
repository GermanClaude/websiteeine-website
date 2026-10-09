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

/* ---------------------------------------------------------------- VR-Körpersprache (protocol.js VR-Zusatz) */

/** Leerer VR-Zusatz zum Wiederverwenden ({aimYaw, aimPitch, main, off}; main/off zeigen auf _m/_o oder sind null). */
export function newVrPose() {
  return { aimYaw: 0, aimPitch: 0, main: null, off: null, _m: [0, 0, 0], _o: [0, 0, 0] };
}

/** Weltpunkt p relativ zum Auge e im Blickrahmen (Gierung yaw: x rechts, y oben, z vorn) → out. */
function toHeadFrame(p, e, cy, sy, out) {
  const dx = p.x - e.x, dz = p.z - e.z;
  out[0] = dx * cy - dz * sy;
  out[1] = p.y - e.y;
  out[2] = -dx * sy - dz * cy;
  return out;
}

/**
 * VR-Zusatz eines Akteurs für Schnappschuss/Zustand oder null (kein VR).
 *   • eigener Spieler in einer laufenden VR-Sitzung (G.xr): Schussrichtung (Auge → Punkt, auf den der Lauf zeigt, wie
 *     player.getAimDirection ohne Rückstoß), Griff der Haupthand und Nebenhand relativ zum Auge im Blickrahmen (Gierung =
 *     actor.yaw = Kopf). Nicht verfolgte Hand → null.
 *   • Puppe: der Zusatz aus ihrem Netz-Zustand (der Host reicht den eines VR-Clients so an alle anderen weiter).
 * out (newVrPose) wird für den eigenen Spieler gefüllt; bei Puppen kommt deren Objekt zurück.
 */
export function vrPoseOf(G, actor, out) {
  if (!actor || !actor.alive) return null;
  if (actor.puppet) {
    const np = actor.netPose;
    return np && np.vr ? np.vr : null;
  }
  if (!actor.isPlayer) return null;
  const xr = G && G.xr;
  if (!xr || !xr.presenting || !xr.ready || !xr.eye || !xr.hands) return null;
  const o = out || newVrPose();
  const d = xr.aimDir || xr.headFwd;
  if (!d || !num(d.x) || !num(d.y) || !num(d.z)) return null;
  o.aimYaw = Math.atan2(-d.x, -d.z);
  o.aimPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const yaw = num(actor.yaw) ? actor.yaw : 0;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const M = xr.hands.main, O = xr.hands.off;
  const mp = M && M.gripW && M.gripW.ok ? M.gripW.pos : M && M.rayW && M.rayW.ok ? M.rayW.pos : null;
  const op = O && O.gripW && O.gripW.ok ? O.gripW.pos : O && O.rayW && O.rayW.ok ? O.rayW.pos : null;
  o.main = mp ? toHeadFrame(mp, xr.eye, cy, sy, o._m || (o._m = [0, 0, 0])) : null;
  o.off = op ? toHeadFrame(op, xr.eye, cy, sy, o._o || (o._o = [0, 0, 0])) : null;
  return o;
}

const lerpN = (a, b, t) => a + (b - a) * t;

/**
 * VR-Zusatz zwischen zwei Schnappschuss-Einträgen (Anteil f) → out (newVrPose) oder null. Fehlt er auf einer Seite (VR
 * beginnt/endet, Hand verloren), gilt der nähere Eintrag.
 */
export function lerpVrPose(a, b, f, out) {
  if (!a && !b) return null;
  const o = out || newVrPose();
  const n = !a ? b : !b ? a : null; // nur eine Seite
  if (n) {
    if (!a ? f < 0.5 : f >= 0.5) return null;
    o.aimYaw = n.aimYaw; o.aimPitch = n.aimPitch;
    o.main = n.main ? copy3(n.main, o._m) : null;
    o.off = n.off ? copy3(n.off, o._o) : null;
    return o;
  }
  o.aimYaw = a.aimYaw + wrapAngle(b.aimYaw - a.aimYaw) * f;
  o.aimPitch = lerpN(a.aimPitch, b.aimPitch, f);
  o.main = hand3(a.main, b.main, f, o._m);
  o.off = hand3(a.off, b.off, f, o._o);
  return o;
}

function copy3(s, d) { d[0] = s[0]; d[1] = s[1]; d[2] = s[2]; return d; }
function hand3(a, b, f, d) {
  if (a && b) { d[0] = lerpN(a[0], b[0], f); d[1] = lerpN(a[1], b[1], f); d[2] = lerpN(a[2], b[2], f); return d; }
  const n = f < 0.5 ? a : b;
  return n ? copy3(n, d) : null;
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
