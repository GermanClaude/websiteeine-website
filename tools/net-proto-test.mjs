// NULLPUNKT – Prüft die reine Mehrspieler-Logik ohne Browser: Binärpakete (protocol.js), Anti-Cheat (anticheat.js)
// und Spielerzahl-Empfehlung (recommend.js).
// Aufruf: node tools/net-proto-test.mjs
import {
  encodeSnapshot, decodeSnapshot, encodeState, decodeState, packetType, WEAPON_INDEX, weaponIndexOf, weaponByIndex,
  NO_WEAPON, FLAGS, packFlags, unpackFlags, PKT_SNAPSHOT, PKT_STATE, SNAPSHOT_HEADER, SNAPSHOT_ENTITY, STATE_SIZE,
  VR_BLOCK, VR_REACH, VEH_TAG, VEH_BLOCK, VEH_INPUT,
} from '../assets/js/game/net/protocol.js';
import { AntiCheat, PositionHistory, AC_TEXT } from '../assets/js/game/net/anticheat.js';
import { recommend, bandwidthFor, maxPlayersForUpload, clientBytes, UploadMeter, UNMEASURED_MAX, INTEREST_MIN, INTEREST_SHARE, RELIABLE_BASE, RELIABLE_PER_HUMAN, RELIABLE_PER_ACTOR } from '../assets/js/game/net/recommend.js';
import { WEAPONS, WEAPON_IDS } from '../assets/js/shared/weapons.data.js';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// sync-common.js (VR-Helfer) importiert 'three' – in Node auf die mitgelieferte Datei abbilden (wie die Import-Map der Seite)
const THREE_URL = pathToFileURL(new URL('../assets/vendor/three/three.module.min.js', import.meta.url).pathname).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : n(s, c); }`), import.meta.url);
const { vrPoseOf, newVrPose, lerpVrPose } = await import('../assets/js/game/net/sync-common.js');

let fail = 0;
let count = 0;
const check = (ok, text) => { count++; if (!ok) { fail++; console.log('FEHL ' + text); } else console.log('OK   ' + text); };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------ protocol */
check(WEAPON_INDEX.length === WEAPON_IDS.length && WEAPON_INDEX.every((id, i) => i === 0 || WEAPON_INDEX[i - 1] < id), 'WEAPON_INDEX vollständig und nach id sortiert');
check(WEAPON_IDS.every((id) => weaponByIndex(weaponIndexOf(id)) === id), 'weaponIndexOf/weaponByIndex umkehrbar');
check(weaponIndexOf('gibtsnicht') === NO_WEAPON && weaponByIndex(NO_WEAPON) === null && weaponByIndex(-1) === null, 'unbekannte Waffe → 255/null');
check(Object.isFrozen(WEAPON_INDEX), 'WEAPON_INDEX unveränderlich');
const fl = packFlags({ alive: true, sprint: true, onGround: true, swimming: true });
check(fl === (FLAGS.ALIVE | FLAGS.SPRINT | FLAGS.ON_GROUND | FLAGS.SWIMMING) && unpackFlags(fl).swimming && !unpackFlags(fl).crouch, 'Flags packen/entpacken');
check(FLAGS.SWIMMING === 1024 && FLAGS.MELEEING === 512 && FLAGS.THROWING === 256, 'Flag-Bits laut Vertrag');

const ents = [
  { id: 1, x: 12.345, y: 1.5, z: -88.25, yaw: 1.2345, pitch: -0.4321, vx: 5.43, vy: -2.1, vz: 0.07, flags: FLAGS.ALIVE | FLAGS.ADS, weapon: 'ar_m17', hp: 87, lean: -0.5, shots: 300, proneBlend: 0.5 },
  { id: 1000, x: 0, y: 0, z: 0, yaw: 3 * Math.PI, pitch: 2, vx: 900, vy: -900, vz: 0, flags: { alive: true, prone: true }, weapon: 7, hp: 400, lean: 3, shots: 255, proneBlend: 2 },
  { id: 65535, x: NaN, y: Infinity, z: 1e9, yaw: -4, pitch: -9, vx: NaN, vy: 0, vz: 0, flags: 0, weapon: 'unbekannt', hp: -5, lean: -2, shots: -1, proneBlend: -1 },
];
const snap = encodeSnapshot(4294967295 + 5, 1234.5678, ents);
check(snap instanceof ArrayBuffer && snap.byteLength === SNAPSHOT_HEADER + 3 * SNAPSHOT_ENTITY, `Snapshot-Größe ${snap.byteLength} Byte (31 je Akteur)`);
check(packetType(snap) === PKT_SNAPSHOT, 'Pakettyp Snapshot = 1');
const ds = decodeSnapshot(snap);
check(ds && ds.entities.length === 3 && ds.tick === 4 && near(ds.serverTime, 1234.5678, 1e-3), 'Snapshot-Kopf (tick u32 umgebrochen, serverTime f32)');
const a = ds.entities[0];
check(a.id === 1 && near(a.x, 12.345, 1e-4) && near(a.y, 1.5, 1e-6) && near(a.z, -88.25, 1e-6), 'Position f32');
check(near(a.yaw, 1.2345, 1e-4) && near(a.pitch, -0.4321, 1e-4), 'Winkel rad×10000');
check(near(a.vx, 5.43, 0.01) && near(a.vy, -2.1, 0.01) && near(a.vz, 0.07, 0.01), 'Geschwindigkeit cm/s');
check(a.flags === (FLAGS.ALIVE | FLAGS.ADS) && a.weaponId === 'ar_m17' && a.weapon === weaponIndexOf('ar_m17'), 'Flags + Waffe');
check(a.hp === 87 && near(a.lean, -0.5, 0.01) && a.shots === 300 % 256 && near(a.proneBlend, 128 / 255, 1e-6), 'hp/lean/shots (mod 256)/proneBlend');
const b = ds.entities[1];
check(near(Math.abs(b.yaw), Math.PI, 1e-3) && near(b.pitch, 2, 1e-4), 'Gierwinkel umgebrochen auf ±π');
check(near(b.vx, 327.67, 0.01) && near(b.vy, -327.68, 0.01), 'Geschwindigkeit auf Int16 begrenzt');
check(b.hp === 255 && near(b.lean, 1.27, 1e-6) && b.shots === 255 && near(b.proneBlend, 1, 1e-6) && b.weapon === 7, 'u8/i8 begrenzt');
check(b.flags === (FLAGS.ALIVE | FLAGS.PRONE), 'Flags aus Objekt');
const c = ds.entities[2];
check(c.id === 65535 && c.x === 0 && c.y === 0 && near(c.z, 1e9, 64), 'NaN/Infinity → 0, große Werte als f32');
check(near(c.yaw, -4 + 2 * Math.PI, 1e-3) && near(c.pitch, -3.2768, 1e-4) && c.vx === 0, 'negativer Winkel umgebrochen, Neigung begrenzt');
check(c.weapon === NO_WEAPON && c.weaponId === null && c.hp === 0 && near(c.lean, -1.27, 1e-6) && c.shots === 255 && c.proneBlend === 0, 'unbekannte Waffe/negative Werte');
check(decodeSnapshot(snap.slice(0, 5)) === null && decodeSnapshot(new ArrayBuffer(0)) === null, 'zu kurzer Snapshot → null');
const trunc = decodeSnapshot(snap.slice(0, SNAPSHOT_HEADER + SNAPSHOT_ENTITY + 4));
check(trunc && trunc.entities.length === 1, 'abgeschnittener Snapshot → nur vollständige Akteure');
check(decodeState(snap) === null, 'Snapshot ist kein Zustand');
const empty = decodeSnapshot(encodeSnapshot(1, 0, []));
check(empty && empty.entities.length === 0, 'leerer Snapshot');
// Uint8Array-Sicht auf einen größeren Puffer
const big = new Uint8Array(snap.byteLength + 8);
big.set(new Uint8Array(snap), 4);
const dsv = decodeSnapshot(big.subarray(4, 4 + snap.byteLength));
check(dsv && dsv.entities.length === 3 && dsv.entities[0].id === 1, 'Dekodieren aus Uint8Array-Ausschnitt');

const st = encodeState(77, 12.25, { x: 1, y: 2, z: 3, yaw: -1, pitch: 0.5, vx: 1, vy: 0, vz: -1, flags: FLAGS.ALIVE | FLAGS.CROUCH, weapon: 'smg_vp9', lean: 0.25, shots: 9, proneBlend: 0, hp: 50, id: 9 });
check(st.byteLength === STATE_SIZE && STATE_SIZE === 37 && packetType(st) === PKT_STATE, 'Zustand 37 Byte, Typ 2');
const dst = decodeState(st);
check(dst && dst.seq === 77 && near(dst.clientTime, 12.25, 1e-6), 'Zustand-Kopf');
const e = dst.entity;
check(e.x === 1 && e.y === 2 && e.z === 3 && near(e.yaw, -1, 1e-4) && near(e.pitch, 0.5, 1e-4) && e.weaponId === 'smg_vp9' && near(e.lean, 0.25, 0.01) && e.shots === 9, 'Zustand-Akteur');
check(e.hp === undefined && e.id === undefined, 'Zustand ohne id/hp');
check(decodeState(st.slice(0, 20)) === null, 'zu kurzer Zustand → null');
check(snap.byteLength / 3 < 40, `≤ 40 Byte je Akteur (Bandbreitenformel §9)`);

/* ------------------------------------------------------------------ VR-Zusatz (Kopf/Hände/Schussrichtung) */
const vrA = { aimYaw: 0.75, aimPitch: -0.3, main: [0.21, -0.35, 0.42], off: [-0.18, -0.4, 0.55] };
const vrEnts = [
  { ...ents[0], id: 2, flags: FLAGS.ALIVE | FLAGS.ON_GROUND, vr: vrA },
  { ...ents[0], id: 1000, flags: FLAGS.ALIVE | FLAGS.VR }, // VR-Bit ohne Zusatz → wird gelöscht
  { ...ents[0], id: 3, flags: FLAGS.ALIVE, vr: { aimYaw: 4, aimPitch: 3, main: [2, -2, 0.004], off: null } },
  { ...ents[0], id: 4, flags: FLAGS.ALIVE, vr: { aimYaw: NaN, aimPitch: 0, main: [0, 0, 0] } }, // ungültig → kein VR
];
const vsnap = encodeSnapshot(9, 50, vrEnts);
check(vsnap.byteLength === SNAPSHOT_HEADER + 4 * SNAPSHOT_ENTITY + 2 * VR_BLOCK && VR_BLOCK === 11, `Snapshot mit 2 VR-Spielern: ${vsnap.byteLength} Byte (+${VR_BLOCK} je VR-Spieler)`);
const vds = decodeSnapshot(vsnap);
const [v0, v1, v2, v3] = vds.entities;
check(v0.vr && (v0.flags & FLAGS.VR) && near(v0.vr.aimYaw, 0.75, 1e-4) && near(v0.vr.aimPitch, -0.3, 1e-4), 'VR: Schussrichtung rad×10000');
check(v0.vr.main.every((x, i) => near(x, vrA.main[i], 0.0051)) && v0.vr.off.every((x, i) => near(x, vrA.off[i], 0.0051)), 'VR: Hände relativ zum Kopf auf 1 cm');
check(v1.vr === null && !(v1.flags & FLAGS.VR) && v3.vr === null && !(v3.flags & FLAGS.VR), 'VR-Bit nur mit gültigem Zusatz (sonst gelöscht)');
check(v2.vr && near(v2.vr.aimYaw, 4 - 2 * Math.PI, 1e-3) && near(v2.vr.aimPitch, Math.PI / 2, 1e-3) && v2.vr.off === null, 'VR: Gierung umgebrochen, Neigung auf ±90° begrenzt, fehlende Nebenhand → null');
check(near(v2.vr.main[0], VR_REACH, 1e-9) && near(v2.vr.main[1], -VR_REACH, 1e-9) && v2.vr.main[2] === 0, `VR: Hand auf ±${VR_REACH} m begrenzt`);
check(v0.x === ds.entities[0].x && v0.hp === 87 && v0.weaponId === 'ar_m17' && near(v0.lean, -0.5, 0.01), 'VR: übrige Felder unverändert');
// ohne VR Byte für Byte wie vorher; ältere Dekodierer (feste 31 Byte) lesen VR-Pakete richtig und übergehen den Anhang
const plain = encodeSnapshot(4294967295 + 5, 1234.5678, ents);
check(new Uint8Array(plain).every((b, i) => b === new Uint8Array(snap)[i]) && ds.entities.every((x) => x.vr === null), 'ohne VR-Spieler: Paket unverändert, vr = null');
const legacyN = Math.min(new DataView(vsnap).getUint16(9, true), Math.floor((vsnap.byteLength - SNAPSHOT_HEADER) / SNAPSHOT_ENTITY));
check(legacyN === 4, 'alter Dekodierer: Akteurzahl trotz Anhang richtig (n = 4)');
const vtr = decodeSnapshot(vsnap.slice(0, vsnap.byteLength - 3));
check(vtr && vtr.entities.length === 4 && vtr.entities[0].vr && vtr.entities[2].vr === null, 'abgeschnittener VR-Anhang: vollständige Blöcke gelten, der Rest ohne vr');
const vst = encodeState(5, 1.5, { ...ents[0], vr: vrA });
check(vst.byteLength === STATE_SIZE + VR_BLOCK && packetType(vst) === PKT_STATE, `Zustand mit VR: ${vst.byteLength} Byte`);
const vdst = decodeState(vst);
check(vdst.entity.vr && near(vdst.entity.vr.main[2], 0.42, 0.0051) && (vdst.entity.flags & FLAGS.VR), 'Zustand: VR-Zusatz dekodiert');
check(decodeState(vst.slice(0, STATE_SIZE)).entity.vr === null, 'Zustand: VR-Bit ohne Block → vr null');
check(decodeState(st).entity.vr === null && encodeState(77, 12.25, { ...e, vr: null }).byteLength === STATE_SIZE, 'Zustand ohne VR: 37 Byte, vr null');
check(unpackFlags(FLAGS.VR).vr && packFlags({ vr: true }) === 2048, 'Flag-Bit 11 = VR');
// Ende-zu-Ende: vrPoseOf (eigener Spieler, G.xr) → Zustand → Puppe setzt die Hand wieder in die Welt
{
  const V = (x, y, z) => ({ x, y, z });
  const yaw = 2.1;
  const eye = V(10, 1.6, -4);
  const gripW = V(10.35, 1.2, -4.5);
  const offW = V(9.8, 1.25, -4.45);
  const aimDir = V(-Math.sin(1.4) * Math.cos(-0.2), Math.sin(-0.2), -Math.cos(1.4) * Math.cos(-0.2));
  const G = { xr: { presenting: true, ready: true, eye, aimDir, headFwd: V(0, 0, -1), hands: { main: { gripW: { ok: true, pos: gripW }, rayW: { ok: true, pos: gripW } }, off: { gripW: { ok: true, pos: offW }, rayW: { ok: false } } } } };
  const pl = { isPlayer: true, alive: true, yaw };
  const vp = vrPoseOf(G, pl, newVrPose());
  check(vp && near(vp.aimYaw, 1.4, 1e-9) && near(vp.aimPitch, -0.2, 1e-9), 'vrPoseOf: Schussrichtung aus G.xr.aimDir');
  const rt = decodeState(encodeState(1, 0, { ...ents[0], yaw, vr: vp })).entity;
  // Puppe: Auge + R(yaw)·(x rechts, y oben, z vorn)
  const back = (o) => [eye.x + o[0] * Math.cos(yaw) - o[2] * Math.sin(yaw), eye.y + o[1], eye.z - o[0] * Math.sin(yaw) - o[2] * Math.cos(yaw)];
  const hm = back(rt.vr.main), ho = back(rt.vr.off);
  check(Math.hypot(hm[0] - gripW.x, hm[1] - gripW.y, hm[2] - gripW.z) < 0.012 && Math.hypot(ho[0] - offW.x, ho[1] - offW.y, ho[2] - offW.z) < 0.012,
    `Hände über das Netz zurück in die Welt: Abweichung ${(Math.hypot(hm[0] - gripW.x, hm[1] - gripW.y, hm[2] - gripW.z) * 100).toFixed(2)} cm`);
  check(vrPoseOf(G, { ...pl, alive: false }) === null && vrPoseOf({ xr: { ...G.xr, presenting: false } }, pl) === null && vrPoseOf(G, { alive: true, isBot: true }) === null, 'vrPoseOf: ohne Sitzung/tot/Bot → null');
  const puppet = { puppet: true, alive: true, netPose: { vr: rt.vr } };
  check(vrPoseOf(G, puppet) === rt.vr && vrPoseOf(G, { puppet: true, alive: true, netPose: {} }) === null, 'vrPoseOf: Puppe reicht ihren Zusatz weiter (Host → andere Clients)');
  G.xr.hands.main.gripW.ok = false; G.xr.hands.main.rayW.ok = false;
  check(vrPoseOf(G, pl, newVrPose()).main === null, 'vrPoseOf: Haupthand verloren → main null');
  // Interpolation
  const A1 = { aimYaw: 3.0, aimPitch: 0, main: [0, 0, 0.4], off: null };
  const B1 = { aimYaw: -3.0, aimPitch: 0.2, main: [0.2, 0, 0.4], off: [0, 0, 0.3] };
  const li = lerpVrPose(A1, B1, 0.4, newVrPose());
  check(near(li.aimYaw, 3 + (2 * Math.PI - 6) * 0.4, 1e-9) && near(li.aimPitch, 0.08, 1e-9) && near(li.main[0], 0.08, 1e-9) && li.off === null, 'lerpVrPose: Gierung über ±π, Hände linear, fehlende Hand vom näheren Eintrag');
  check(lerpVrPose(null, B1, 0.3) === null && lerpVrPose(null, B1, 0.7).main[0] === 0.2 && lerpVrPose(A1, null, 0.2).aimYaw === 3 && lerpVrPose(null, null, 0.5) === null, 'lerpVrPose: VR beginnt/endet zwischen zwei Einträgen → näherer Eintrag');
}

/* ------------------------------------------------------------------ Fahrzeuge (panzer-mp.md §C.4/§C.5) */
{
  check(VEH_TAG === 0x56 && VEH_BLOCK === 60 && VEH_INPUT === 16 && FLAGS.VEHICLE === 1 << 12, 'Fahrzeug-Konstanten (0x56, 60, 16, Bit 12)');
  // Quaternion: 30° um Y + leichte Neigung, absichtlich mit qw < 0 (muss negiert werden)
  const qy = Math.sin(Math.PI / 12), qw0 = Math.cos(Math.PI / 12);
  const qx0 = 0.05, ql = Math.hypot(qx0, qy, qw0);
  const q = [-qx0 / ql, -qy / ql, 0, -qw0 / ql];
  const veh = (vid, over = {}) => ({
    vid, kind: 0 | (1 << 4), bits: 0b10101001, seats: 0b00100101, x: 1234.567, y: -12.25, z: 98765.4321, qx: q[0], qy: q[1], qz: q[2], qw: q[3],
    vx: 18.93, vy: -0.42, vz: -7.77, wy: 0.765, a: [3.0, -0.157, -2.5, 0.85], hp: 873.6, zones: [255, 12, 200], gear: -2, rpm: 1.06, drive: 0b10111011,
    shots: [3, 260, 0, 255], gun: 1 | (2 << 2) | (2 << 4) | 128, busy: 0.5, rackAP: 21, rackHE: 18, mag0: 200, mag1: 99, sel: 0b11010110, aux: 2 | (20 << 2), ...over,
  });
  const vs = [veh(7), veh(255, { kind: 1 | (2 << 4), qx: 0, qy: 0, qz: 0, qw: 0, a: [Math.PI * 3, 0, 0, 0], gear: 4, rpm: 0, hp: 70000 })];
  // 3 Akteure, einer davon mit VR-Block, dazu 2 Fahrzeuge
  const ents3 = [
    { id: 1, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, flags: FLAGS.ALIVE | FLAGS.VEHICLE, weapon: 'ar_m17', hp: 100, lean: 0, shots: 0, proneBlend: 0 },
    { id: 2, x: 4, y: 5, z: 6, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, flags: FLAGS.ALIVE, weapon: 'ar_m17', hp: 50, lean: 0, shots: 0, proneBlend: 0, vr: { aimYaw: 0.5, aimPitch: 0.1, main: [0.2, -0.3, 0.4], off: null } },
    { id: 1001, x: 7, y: 8, z: 9, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, flags: FLAGS.ALIVE, weapon: 'ar_m17', hp: 20, lean: 0, shots: 0, proneBlend: 0 },
  ];
  const sv = encodeSnapshot(9, 77.5, ents3, vs);
  check(sv.byteLength === SNAPSHOT_HEADER + 3 * SNAPSHOT_ENTITY + VR_BLOCK + 2 + 2 * VEH_BLOCK, `Snapshot mit Fahrzeugen ${sv.byteLength} B = 11 + n·31 + nvr·11 + 2 + nv·60`);
  const plain = encodeSnapshot(9, 77.5, ents3);
  const plainNull = encodeSnapshot(9, 77.5, ents3, []);
  check(plain.byteLength === SNAPSHOT_HEADER + 3 * SNAPSHOT_ENTITY + VR_BLOCK && plainNull.byteLength === plain.byteLength
    && Buffer.compare(Buffer.from(plain), Buffer.from(plainNull)) === 0, 'ohne Fahrzeuge (null/leer): kein Anhang, Byte für Byte gleich');
  check(Buffer.compare(Buffer.from(plain), Buffer.from(sv.slice(0, plain.byteLength))) === 0, 'Anhang verändert die Akteursbytes nicht');
  const dsv = decodeSnapshot(sv);
  check(dsv && dsv.entities.length === 3 && dsv.vehicles.length === 2 && dsv.entities[1].vr && near(dsv.entities[1].vr.aimYaw, 0.5, 1e-4), 'Dekodierung: Akteure + VR + 2 Fahrzeuge');
  check((dsv.entities[0].flags & FLAGS.VEHICLE) === 0, 'Fahrzeug-Bit im Snapshot gelöscht (nur im Zustand)');
  check(Array.isArray(decodeSnapshot(plain).vehicles) && decodeSnapshot(plain).vehicles.length === 0, 'Paket ohne Anhang → vehicles: []');
  const V = dsv.vehicles[0], src = vs[0];
  check(V.vid === 7 && V.kind === src.kind && V.bits === src.bits && V.seats === src.seats, 'vid/kind/bits/seats');
  check(V.x === Math.fround(src.x) && V.y === Math.fround(src.y) && V.z === Math.fround(src.z), 'Position exakt f32');
  const qn = [-q[0], -q[1], -q[2], -q[3]]; // qw ≥ 0
  check(V.qw >= 0 && near(V.qx, qn[0], 2e-4) && near(V.qy, qn[1], 2e-4) && near(V.qz, qn[2], 2e-4) && near(V.qw, qn[3], 2e-4), 'Quaternion ≤ 2e-4 (qw ≥ 0, Vorzeichen gedreht)');
  check(near(Math.hypot(V.qx, V.qy, V.qz, V.qw), 1, 1e-9), 'Quaternion beim Lesen normiert');
  check(near(V.vx, src.vx, 0.0051) && near(V.vy, src.vy, 0.0051) && near(V.vz, src.vz, 0.0051), 'Geschwindigkeit 1 cm/s');
  check(near(V.wy, src.wy, 5e-4), 'Gierrate rad/s ×1000');
  check(V.a.every((x, i) => near(x, src.a[i], 1e-4)), 'Lafettenwinkel ≤ 1e-4');
  check(V.hp === 874 && V.zones.join() === '255,12,200' && V.gear === -2 && near(V.rpm, 1.06, 0.005) && V.drive === src.drive, 'hp gerundet, Zonen, Gang i8, rpm ×200, drive');
  check(V.shots.join() === '3,4,0,255' && V.gun === src.gun && near(V.busy, 0.5, 0.003) && V.rackAP === 21 && V.rackHE === 18, 'Schusszähler mod 256, Kanone, Fortschritt, Gestell');
  check(V.mag0 === 200 && V.mag1 === 99 && V.sel === src.sel && V.aux === src.aux, 'Magazine, sel, aux');
  const V2 = dsv.vehicles[1];
  check(V2.vid === 255 && V2.qw === 1 && V2.qx === 0 && near(Math.abs(V2.a[0]), Math.PI, 1e-3) && V2.hp === 65535 && V2.rpm === 0 && V2.gear === 4, 'Nullquaternion → Einheit, Winkel umgebrochen, hp u16 begrenzt');
  // abgeschnitten: 1,5 Fahrzeugblöcke → nur der vollständige
  const cut = decodeSnapshot(sv.slice(0, sv.byteLength - 30));
  check(cut && cut.vehicles.length === 1 && cut.vehicles[0].vid === 7 && cut.entities.length === 3, 'abgeschnittener Anhang → nur vollständige Blöcke');
  const cut2 = decodeSnapshot(sv.slice(0, SNAPSHOT_HEADER + 3 * SNAPSHOT_ENTITY + VR_BLOCK + 1));
  check(cut2 && cut2.vehicles.length === 0, 'nur das Kennbyte → keine Fahrzeuge');
  const cut3 = decodeSnapshot(sv.slice(0, SNAPSHOT_HEADER + 3 * SNAPSHOT_ENTITY + 5));
  check(cut3 && cut3.vehicles.length === 0 && cut3.entities[1].vr === null, 'VR-Block abgeschnitten → kein Anhang gelesen');
  // 0 Akteure, nur Fahrzeuge
  const only = encodeSnapshot(1, 1, [], [vs[0]]);
  check(only.byteLength === SNAPSHOT_HEADER + 2 + VEH_BLOCK && decodeSnapshot(only).vehicles.length === 1, 'nur Fahrzeuge (0 Akteure)');

  // Zustand + Fahrzeug-Absicht (mit und ohne VR)
  const base = { x: 1, y: 2, z: 3, yaw: 0.3, pitch: 0.1, vx: 0, vy: 0, vz: 0, flags: FLAGS.ALIVE, weapon: 'ar_m17', lean: 0, shots: 4, proneBlend: 0 };
  const vin = { vid: 12, seat: 3, throttle: -0.5, steer: 1.4, bits: 0b10110, shift: 3 | (9 << 4), fireSeq: 257, act: 5 | (15 << 4), weapon: 2, view: 1, aimYaw: -2.9, aimPitch: 0.3, lookYaw: 3.1 };
  const st0 = encodeState(1, 2, base);
  const st1 = encodeState(1, 2, { ...base, veh: vin });
  const st2 = encodeState(1, 2, { ...base, veh: vin, vr: { aimYaw: 0.2, aimPitch: 0, main: null, off: null } });
  check(st0.byteLength === STATE_SIZE && st1.byteLength === STATE_SIZE + VEH_INPUT && st2.byteLength === STATE_SIZE + VR_BLOCK + VEH_INPUT, `Zustand 37 / 37+16 / 37+11+16 Byte (${st0.byteLength}/${st1.byteLength}/${st2.byteLength})`);
  const ds0 = decodeState(st0), ds1 = decodeState(st1), ds2 = decodeState(st2);
  check(ds0.entity.veh === null && (ds0.entity.flags & FLAGS.VEHICLE) === 0, 'ohne Fahrzeug: kein Bit, veh null');
  const e1 = ds1.entity.veh;
  check(e1 && (ds1.entity.flags & FLAGS.VEHICLE) && e1.vid === 12 && e1.seat === 3 && near(e1.throttle, -0.5, 0.005) && near(e1.steer, 1, 1e-9), 'Absicht: vid/seat/throttle/steer (begrenzt)');
  check(e1.bits === vin.bits && e1.shift === vin.shift && e1.fireSeq === 1 && e1.act === vin.act && e1.weapon === 2 && e1.view === 1, 'Absicht: Bits, Zähler (mod 256), Waffe, Sicht');
  check(near(e1.aimYaw, -2.9, 1e-4) && near(e1.aimPitch, 0.3, 1e-4) && near(e1.lookYaw, 3.1, 1e-4), 'Absicht: Winkel ≤ 1e-4');
  check(ds2.entity.vr && near(ds2.entity.vr.aimYaw, 0.2, 1e-4) && ds2.entity.veh && ds2.entity.veh.vid === 12 && near(ds2.entity.veh.lookYaw, 3.1, 1e-4), 'VR-Block + Absicht dahinter');
  check(decodeState(st1.slice(0, STATE_SIZE + 8)).entity.veh === null, 'abgeschnittene Absicht → null');
  check(encodeState(1, 2, { ...base, veh: { vid: 0 } }).byteLength === STATE_SIZE && encodeState(1, 2, { ...base, veh: { vid: 300 } }).byteLength === STATE_SIZE, 'ungültige vid → keine Absicht');
  const nw = decodeState(encodeState(1, 2, { ...base, veh: { ...vin, weapon: null } })).entity.veh;
  check(nw.weapon === 255, 'keine Waffenwahl → 255');
}

/* ------------------------------------------------------------------ anticheat */
const kicks = [];
const ac = new AntiCheat({ onKick: (peer, reason) => kicks.push([peer, reason]) });
const ALIVE = FLAGS.ALIVE | FLAGS.ON_GROUND;
// legales Gehen 30 Hz mit Paketbündelung
let t = 0;
ac.onSpawn(2, [0, 0, 0], t);
let okAll = true;
let x = 0;
for (let i = 1; i <= 90; i++) {
  x += 5.4 / 30;
  // jede 6. Sendung bündelt 3 Pakete (Latenzschwankung)
  const arrive = i % 6 === 0 ? t + 3 / 30 : t + 1 / 30;
  t = arrive;
  const r = ac.onState(2, { x, y: 0, z: 0, flags: ALIVE }, t);
  if (!r.ok) okAll = false;
}
check(okAll && ac.score(2, t) === 0, 'legales Gehen (mit Schwankungen) ohne Verstoß');
// Sprint + Rutschen
let sOk = true;
for (let i = 0; i < 30; i++) { x += 11 / 30; t += 1 / 30; if (!ac.onState(2, { x, y: 0, z: 0, flags: ALIVE | FLAGS.SLIDING }, t).ok) sOk = false; }
check(sOk, 'Rutschen (11 m/s) erlaubt');
// Burst nach 0,8 s Aussetzer: Strecke über 0,8 s Sprint kommt auf einmal
t += 0.8;
x += 8.2 * 0.8;
check(ac.onState(2, { x, y: 0, z: 0, flags: ALIVE | FLAGS.SPRINT }, t).ok, 'Aussetzer 0,8 s Sprint aufgeholt → erlaubt');
// Tempo-Hack: doppeltes Sprinttempo – das angesparte Budget verzögert die Erkennung um wenige Sekunden
let hack = null;
let hackT = t;
for (let i = 0; i < 150 && !hack; i++) { x += 16.4 / 30; t += 1 / 30; const r = ac.onState(2, { x, y: 0, z: 0, flags: ALIVE | FLAGS.SPRINT }, t); if (!r.ok) hack = r; }
check(hack && hack.reason === 'tempo' && Array.isArray(hack.correct) && t - hackT < 4, `Tempo-Hack (2× Sprint) nach ${(t - hackT).toFixed(1)} s erkannt → Rücksetzung`);
const acFast = new AntiCheat();
acFast.onSpawn(7, [0, 0, 0], 0);
let fastT = null;
for (let i = 1; i <= 60 && fastT == null; i++) if (!acFast.onState(7, { x: i * 25 / 30, y: 0, z: 0, flags: ALIVE | FLAGS.SPRINT }, i / 30).ok) fastT = i / 30;
check(fastT != null && fastT < 1.5, `Tempo-Hack (3× Sprint) nach ${fastT && fastT.toFixed(2)} s erkannt`);
const back = hack.correct;
// Client übernimmt die Rücksetzung
t += 0.1;
check(ac.onState(2, { x: 99, y: 0, z: 0, flags: ALIVE }, t).reason === 'korrektur', 'während der Rücksetzung: weitere Abweichung still verworfen');
t += 0.05;
const corr = ac.onState(2, { x: back[0], y: back[1], z: back[2], flags: ALIVE }, t);
check(corr.ok && corr.reason === 'korrigiert', 'Rücksetzung übernommen');
// Teleport
t += 1 / 30;
const tp = ac.onState(2, { x: back[0] + 30, y: 0, z: 0, flags: ALIVE }, t);
check(!tp.ok && tp.reason === 'teleport' && near(tp.correct[0], back[0], 1e-9), 'Teleport > 6 m → teleport + correct');
// Spawn erlaubt Sprung + alte Pakete still verwerfen
t += 0.5;
ac.onSpawn(2, [200, 0, 200], t);
t += 0.05;
check(ac.onState(2, { x: back[0], y: 0, z: 0, flags: ALIVE }, t).reason === 'veraltet', 'nach Spawn: Zustand des vorigen Lebens verworfen');
t += 0.05;
check(ac.onState(2, { x: 200.1, y: 0, z: 200, flags: ALIVE }, t).ok, 'Zustand am Spawnpunkt angenommen');
// Steigen/Fallen
t += 1 / 30;
check(!ac.onState(2, { x: 200.1, y: 12, z: 200, flags: ALIVE }, t).ok, 'Fliegen (12 m nach oben) erkannt');
const ac2 = new AntiCheat();
ac2.onSpawn(3, [0, 30, 0], 0);
let fallOk = true;
let y = 30;
let vy = 0;
for (let i = 1; i <= 45; i++) { vy += 24 / 30; y = Math.max(0, y - vy / 30); if (!ac2.onState(3, { x: 0, y, z: 0, flags: FLAGS.ALIVE }, i / 30).ok) fallOk = false; }
check(fallOk, 'freier Fall aus 30 m erlaubt');
check(ac2.onState(3, { x: 0, y: 0, z: 0 }, 2, { alive: false }).reason === 'tot', 'tote Spieler werden nicht geprüft');

// Härtetest Bewegung (§13): legale Grenzfälle ohne Verstoß, einzelne Sprünge > 6–8 m werden zurückgesetzt.
// Pakete 30 Hz mit Ankunftsschwankung (±60 ms, gebündelt), 5 % Verlust; Tempi aus player.js/slide.js mit allen Zuschlägen.
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
/** Bewegung simulieren: path(tc) → {x, y, z, flags} je 1/30 s Client-Zeit; Ankunft mit Schwankung/Verlust. → Verstoß-Gründe */
function simulate(acX, id, t0, dur, path, { jitter = 0.06, loss = 0.05, stall = null } = {}) {
  const bad = [];
  let last = t0;
  const sent = [];
  for (let k = 1; k <= Math.round(dur * 30); k++) {
    const tc = t0 + k / 30;
    if (rand() < loss) continue;
    let arrive = tc + 0.15 + rand() * jitter;
    if (stall && tc > stall[0] && tc < stall[0] + stall[1]) arrive = stall[0] + stall[1] + 0.15; // Host hängt: alles kommt gebündelt
    sent.push({ k, tc, arrive, s: path(tc - t0) });
  }
  sent.sort((a, b) => a.arrive - b.arrive);
  let seq = -1;
  for (const m of sent) {
    if (m.k <= seq) continue; // überholte Pakete verwirft sync-host (seq)
    seq = m.k;
    last = Math.max(last, m.arrive);
    const r = acX.onState(id, m.s, last, { alive: true, rtt: 0.3 });
    if (!r.ok) bad.push(`${r.reason}@${(m.tc - t0).toFixed(2)}`);
  }
  return { bad, end: last };
}
const GROUND = FLAGS.ALIVE | FLAGS.ON_GROUND;
const acL = new AntiCheat();
acL.onSpawn(40, [0, 0, 0], 100);
// Sprint mit allen Zuschlägen: 8,2 × 1,07 (Waffe) × 1,12 (Adrenalin) × 1,06 (bergab) ≈ 10,4 m/s, 3 s
let simR = simulate(acL, 40, 100, 3, (s) => ({ x: s * 10.4, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }));
// Rutschen aus vollem Sprint: 13,3 m/s, Reibung bis 3,4 m/s (0,9 s), dann Rutschsprung (Schwung bleibt in der Luft)
let x0 = 31.2;
let simR2 = simulate(acL, 40, simR.end, 0.9, (s) => ({ x: x0 + 13.3 * s - 4.5 * s * s, y: 0, z: 0, flags: GROUND | FLAGS.SLIDING }));
x0 += 13.3 * 0.9 - 4.5 * 0.81;
let simR3 = simulate(acL, 40, simR2.end, 0.6, (s) => ({ x: x0 + 11 * s, y: Math.max(0, 7.27 * s - 12 * s * s), z: 0, flags: FLAGS.ALIVE }));
check(!simR.bad.length && !simR2.bad.length && !simR3.bad.length && acL.score(40, simR3.end) === 0,
  `Sprint 10,4 m/s + Rutschen 13,3 m/s + Rutschsprung 11 m/s (Schwankung ±60 ms, 5 % Verlust) ohne Verstoß ${[...simR.bad, ...simR2.bad, ...simR3.bad].join(' ')}`);
// Hangrutschen (Grenzland): 11,8 m/s waagerecht 4 s bergab (y fällt 0,35 m je m) + Sprungserie im Sprint
const acS = new AntiCheat();
acS.onSpawn(41, [0, 80, 0], 0);
simR = simulate(acS, 41, 0, 4, (s) => ({ x: s * 11.8, y: 80 - s * 11.8 * 0.35, z: 0, flags: GROUND | FLAGS.SLIDING }));
simR2 = simulate(acS, 41, simR.end, 3, (s) => ({ x: 47.2 + s * 10.4, y: 63.5 + Math.max(0, 7.27 * (s % 0.6) - 12 * (s % 0.6) ** 2), z: 0, flags: (s % 0.6) < 0.05 ? GROUND | FLAGS.SPRINT : FLAGS.ALIVE | FLAGS.SPRINT }));
check(!simR.bad.length && !simR2.bad.length && acS.score(41, simR2.end) === 0, `Hangrutschen 11,8 m/s + Sprungserie im Sprint ohne Verstoß ${[...simR.bad, ...simR2.bad].join(' ')}`);
// Spawn in 40 m Höhe (Host setzt ihn dort ein) → freier Fall (bis 44 m/s) mit 8 m/s seitwärts
const acF = new AntiCheat();
acF.onSpawn(42, [0, 40, 0], 0);
simR = simulate(acF, 42, 0, 2.2, (s) => ({ x: s * 8, y: Math.max(0, 40 - 12 * s * s), z: 0, flags: s * s * 12 >= 40 ? GROUND : FLAGS.ALIVE }));
check(!simR.bad.length && acF.score(42, simR.end) === 0, `Spawn in 40 m Höhe + freier Fall ohne Verstoß ${simR.bad.join(' ')}`);
// Host hängt 1 s (Bildrate): 30 Pakete kommen auf einmal; danach Funkloch 0,7 s (Pakete verloren) im Sprint
const acH = new AntiCheat();
acH.onSpawn(43, [0, 0, 0], 0);
simR = simulate(acH, 43, 0, 4, (s) => ({ x: s * 10.4, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }), { stall: [1, 1] });
let tH = simR.end + 0.7;
const afterGap = acH.onState(43, { x: 4 * 10.4 + 0.7 * 10.4, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, tH, { alive: true });
check(!simR.bad.length && afterGap.ok && acH.score(43, tH) === 0, `Host hängt 1 s (gebündelt) + 0,7 s Funkloch (7,3 m Schritt) ohne Verstoß ${simR.bad.join(' ')}`);
// Host mit 0,4 FPS (Bilder bis 2,5 s, Lasttest): Zustände kommen nur alle 2,5 s gebündelt an – Sprint ohne Verstoß
const acB = new AntiCheat();
acB.onSpawn(48, [0, 0, 0], 0);
let badB = 0;
for (let k = 1; k <= 30 * 12; k++) {
  const tc = k / 30;
  const b = Math.ceil(tc / 2.5 - 1e-9);
  const arrive = b * 2.5 + (tc - (b - 1) * 2.5) * 0.001; // gebündelt am Ende jedes Bildes, in Sendereihenfolge
  if (!acB.onState(48, { x: tc * 10.4, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, arrive, { alive: true }).ok) badB++;
}
check(badB === 0 && acB.score(48, 13) === 0, `Host hängt je 2,5 s (Zustände gebündelt), Sprint 10,4 m/s über 12 s: ${badB} Verstöße`);
// Bilder bis 3 s (Lasttest: längstes Bild 2,98 s): Lücke wird bis burstWindow nachgefüllt – Sprint ohne Verstoß
const acB3 = new AntiCheat();
acB3.onSpawn(50, [0, 0, 0], 0);
let badB3 = 0;
for (let k = 1; k <= 30 * 12; k++) {
  const tc = k / 30;
  const b = Math.ceil(tc / 2.95 - 1e-9);
  const arrive = b * 2.95 + (tc - (b - 1) * 2.95) * 0.001;
  if (!acB3.onState(50, { x: tc * 10.4, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, arrive, { alive: true }).ok) badB3++;
}
check(badB3 === 0 && acB3.score(50, 13) === 0, `Host hängt je 2,95 s (Zustände gebündelt), Sprint 10,4 m/s über 12 s: ${badB3} Verstöße`);
// Host hängt 9 s (Lasttest: neue Puppen beim Beitritt unter Fremdlast) – Zustände kommen danach auf einmal: mit gemeldeter
// Host-Lücke (ctx.hostGap) ohne Verstoß; schweigt dagegen der Client selbst 9 s (Lag-Switch, Host läuft), zählen nur 3 s
const stallRun = (withGap) => {
  const ac = new AntiCheat();
  ac.onSpawn(51, [3, 0, 0], 0);
  let bad = 0;
  let frameAt = 0;
  for (let k = 1; k <= 30 * 20; k++) {
    const tc = k / 30;
    const a = (tc * 4.2) / 3;
    // Host-Bilder 0,5 s, ab 5 s ein Bild von 9 s; Zustände werden nach dem Bild zugestellt, in dem sie ankamen
    const frames = [];
    for (let t = 0; t < 30; ) { const d = t >= 5 && t < 5.4 ? 9 : 0.5; frames.push([t, t + d]); t += d; }
    const f = frames.find(([s0, s1]) => tc > s0 && tc <= s1) || [tc, tc];
    frameAt = f[0];
    const at = f[1] + k * 1e-5;
    const r = ac.onState(51, { x: 3 * Math.cos(a), y: 0, z: 3 * Math.sin(a), flags: GROUND }, at, { alive: true, rtt: 0.05, hostGap: withGap ? at - frameAt : 0 });
    if (!r.ok) bad++;
  }
  return bad;
};
const stallOk = stallRun(true);
const stallSilent = stallRun(false);
check(stallOk === 0 && stallSilent > 0, `Host hängt 9 s: mit Host-Lücke ${stallOk} Verstöße; dieselbe Lücke ohne Host-Lücke (Client schweigt) → ${stallSilent} (höchstens 3 s gutgeschrieben)`);
// Stau außerhalb des Host-Bildes (Lasttest unter Fremdlast: Netz/Sender hängen ≈ 7 s, Host läuft weiter, hostGap klein):
// die Zustände kommen gebündelt – mit Sendestempeln (ctx.ct) ohne Verstoß, ohne Stempel (nur Host-Zeit) mit Verstößen
const delayRun = (withCt) => {
  const ac = new AntiCheat();
  ac.onSpawn(52, [3, 0, 0], 0);
  let bad = 0;
  for (let k = 1; k <= 30 * 20; k++) {
    const tc = k / 30;
    const a = (tc * 4.2) / 3;
    const sent = tc;
    // normal 50 ms unterwegs, zwischen 5 s und 12 s gesendete Zustände kommen erst bei 12,05 s an (Host bearbeitet sofort)
    const arrive = sent >= 5 && sent < 12 ? 12.05 + k * 1e-5 : sent + 0.05;
    const r = ac.onState(52, { x: 3 * Math.cos(a), y: 0, z: 3 * Math.sin(a), flags: GROUND }, arrive, { alive: true, rtt: 0.1, hostGap: 0.02, ct: withCt ? sent : undefined });
    if (!r.ok) bad++;
  }
  return bad;
};
const delayCt = delayRun(true);
const delayHost = delayRun(false);
check(delayCt === 0 && delayHost > 0, `Stau 7 s unterwegs (Host läuft): mit Sendestempeln ${delayCt} Verstöße, nur Host-Zeit ${delayHost}`);
// Tempo-Hack mit ehrlichen Stempeln (2× Sprint) und mit „schnellen“ Stempeln (Client-Uhr läuft doppelt) – beides erkannt
const hackRun = (stampRate) => {
  const ac = new AntiCheat();
  ac.onSpawn(53, [0, 0, 0], 0);
  let first = null;
  for (let k = 1; k <= 30 * 6; k++) {
    const t = k / 30;
    const r = ac.onState(53, { x: t * 20.8, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, t + 0.05, { alive: true, rtt: 0.1, ct: t * stampRate });
    if (!r.ok && first == null) first = t;
  }
  return first;
};
const hackHonest = hackRun(1);
const hackFast = hackRun(2);
check(hackHonest != null && hackHonest < 3 && hackFast != null && hackFast < 3,
  `Tempo-Hack 2× Sprint mit Stempeln erkannt nach ${hackHonest && hackHonest.toFixed(2)} s, mit doppelt laufender Client-Uhr nach ${hackFast && hackFast.toFixed(2)} s`);
// Zeit „ansparen“: Client steht 20 s und lässt die Stempel halb so schnell laufen, dann Sprint-Sprung nach vorn mit großen
// Stempel-Schritten – gutgeschrieben wird höchstens lagMax (8 s) Rückstand: der Vorstoß endet vor 8 s × Sprinttempo + Puffer
{
  const ac = new AntiCheat();
  ac.onSpawn(54, [0, 0, 0], 0);
  let t = 0;
  let ct = 0;
  for (let k = 0; k < 600; k++) { t += 1 / 30; ct += 0.5 / 30; ac.onState(54, { x: 0, y: 0, z: 0, flags: GROUND }, t, { alive: true, rtt: 0.1, ct }); }
  let x = 0;
  let caught = null;
  for (let k = 0; k < 60 && caught == null; k++) {
    t += 1 / 30; ct += 2; x += 14;
    const r = ac.onState(54, { x, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, t, { alive: true, rtt: 0.1, ct });
    if (!r.ok) caught = x;
  }
  const bound = 8 * 8.2 * 1.25 * 1.35 + 2 * 15;
  check(caught != null && caught <= bound, `angesparte Zeit: Vorstoß mit 14 m je Zustand gestoppt bei ${caught} m (Grenze lagMax × Sprint + Puffer ≈ ${Math.round(bound)} m)`);
}
// Langsamer Client (ein Zustand alle 2 s): 20 m Sprung bleibt ein Teleport (Schrittgrenze ≤ 1 s × vMax)
const acSlow = new AntiCheat();
acSlow.onSpawn(49, [0, 0, 0], 0);
const slow1 = acSlow.onState(49, { x: 0.5, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, 2, { alive: true });
const slow2 = acSlow.onState(49, { x: 20.5, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, 4, { alive: true });
check(slow1.ok && !slow2.ok && slow2.reason === 'teleport', 'langsamer Client (Zustand alle 2 s): 20 m in einem Schritt → teleport');
// Einzelne Sprünge: 7 m (Gehen, volles Budget) und 14 m (früher erlaubt) → teleport + Rücksetzung
const acT = new AntiCheat();
acT.onSpawn(44, [0, 0, 0], 0);
simR = simulate(acT, 44, 0, 2, (s) => ({ x: s * 4, y: 0, z: 0, flags: GROUND }), { loss: 0, jitter: 0 });
tH = simR.end + 1 / 30;
const tp7 = acT.onState(44, { x: 8 + 7, y: 0, z: 0, flags: GROUND | FLAGS.SPRINT }, tH, { alive: true });
check(!tp7.ok && tp7.reason === 'teleport' && near(tp7.correct[0], 8, 0.2), `Sprung 7 m in einem Paket (volles Budget) → teleport, zurück auf x=${tp7.correct && tp7.correct[0].toFixed(1)}`);
acT.onState(44, { x: tp7.correct[0], y: 0, z: 0, flags: GROUND }, tH + 0.2, { alive: true });
const tp14 = acT.onState(44, { x: tp7.correct[0] + 14, y: 0, z: 0, flags: GROUND }, tH + 1.2, { alive: true });
check(!tp14.ok && tp14.reason === 'teleport', 'Sprung 14 m nach 1 s Pause im Gehen → teleport (früher im Budget)');
// 5 m senkrecht nach oben in einem Paket → steigen; Klettern 1,3 m in 0,25 s erlaubt
const acU = new AntiCheat();
acU.onSpawn(45, [0, 0, 0], 0);
const mantle = [0.4, 0.8, 1.1, 1.3, 1.3].map((yy, i) => acU.onState(45, { x: 0.2 * i, y: yy, z: 0, flags: FLAGS.ALIVE }, 1 + (i + 1) / 30, { alive: true }).ok);
const up5 = acU.onState(45, { x: 1, y: 6.3, z: 0, flags: GROUND }, 1.3, { alive: true });
check(mantle.every(Boolean) && !up5.ok && up5.reason === 'steigen', 'Klettern 1,3 m erlaubt, 5 m senkrecht in einem Paket → steigen');
// Spawn unterwegs: Client meldet noch „tot“ (Puppe lebt beim Host) → Anker bleibt; kein Neuanker per tot/lebendig
const acD = new AntiCheat();
acD.onSpawn(46, [50, 0, 50], 0);
check(acD.onState(46, { x: 10, y: 0, z: 10, flags: FLAGS.ON_GROUND }, 0.3, { alive: true, clientAlive: false }).reason === 'tot-client', 'Client noch tot, Puppe lebt (Spawn unterwegs) → verworfen');
check(acD.onState(46, { x: 50.2, y: 0, z: 50, flags: GROUND }, 0.6, { alive: true, clientAlive: true }).ok, 'danach am Spawnpunkt angenommen');
acD.onState(46, { x: 50.4, y: 0, z: 50, flags: FLAGS.ON_GROUND }, 0.7, { alive: true, clientAlive: false });
const exploit = acD.onState(46, { x: 90, y: 0, z: 50, flags: GROUND }, 0.75, { alive: true, clientAlive: true });
check(!exploit.ok && exploit.reason === 'teleport', '„tot“ melden + 40 m weiter lebendig → teleport (kein neuer Anker)');
// Spawn mit hoher Laufzeit (rtt 0,8 s): Zustände des vorigen Lebens kommen bis 1,7 s später noch an → still verworfen
const acR = new AntiCheat();
acR.onSpawn(47, [0, 0, 0], 0);
acR.onState(47, { x: 0.1, y: 0, z: 0, flags: GROUND }, 0.1, { alive: true });
acR.onSpawn(47, [120, 0, 0], 1);
const stale = acR.onState(47, { x: 0.3, y: 0, z: 0, flags: GROUND }, 2.6, { alive: true, rtt: 0.8 });
const fresh = acR.onState(47, { x: 120.2, y: 0, z: 0, flags: GROUND }, 2.7, { alive: true, rtt: 0.8 });
check(stale.reason === 'veraltet' && fresh.ok && acR.score(47, 3) === 0, 'Spawn bei rtt 0,8 s: altes Leben nach 1,6 s still verworfen, neuer Ort angenommen');
// Feuerrate
const m17 = WEAPONS.ar_m17; // 700 rpm
const ac3 = new AntiCheat();
let shotsOk = 0;
for (let i = 0; i < 70; i++) if (ac3.onShot(4, m17, i * (60 / 700))) shotsOk++;
check(shotsOk === 70 && ac3.score(4, 6) === 0, 'Feuerrate 700 rpm erlaubt');
let rejected = 0;
for (let i = 0; i < 70; i++) if (!ac3.onShot(4, m17, 10 + i * (60 / 700) * 0.6)) rejected++;
check(rejected > 10, `Schnellfeuer (+67 %) abgelehnt (${rejected} von 70)`);
const burstOk = [0, 0, 0, 0].map((_, i) => ac3.onShot(5, m17, 1 + i * 0.001)).filter(Boolean).length;
check(burstOk === 3, 'Paketbündelung: 3 Schüsse gleichzeitig erlaubt, der vierte nicht');
check(!ac3.onShot(5, null, 2), 'Schuss mit unbekannter Waffe abgelehnt');

// Treffer: Ziel läuft mit 10 m/s von x=20 (t=10) nach x=30 (t=11) und steht dann bis t=14
const hist = new PositionHistory(5);
for (let i = 0; i <= 120; i++) { const tt = 10 + i / 30; hist.record(10, tt, Math.min(30, 20 + (tt - 10) * 10), 0, 0); }
const ac4 = new AntiCheat({ onKick: (peer, reason) => kicks.push([peer, reason]) });
let hitNow = 11.5;
const ctxBase = (o = {}) => ({
  now: (hitNow += 0.1), ffa: false, weapons: WEAPONS, history: hist, interp: 0,
  shooter: { alive: true, team: 'A', pos: [10, 0, 0], weapons: ['ar_m17', 'pi_p9', 'knife'] },
  target: { alive: true, team: 'B' }, ...o,
});
const claim = (o = {}) => ({ target: 10, zone: 'body', dmg: 25, weapon: 'ar_m17', dist: 19.9, origin: [10, 1.6, 0], point: [29.9, 1.2, 0], serial: 1, pellet: 0, ...o });
let r = ac4.validateHit(2, claim(), ctxBase());
check(r.ok && near(r.dmg, 25, 0.6), `gültiger Treffer → Schaden ${r.dmg.toFixed(1)}`);
r = ac4.validateHit(2, claim({ serial: 2, zone: 'head', dmg: 25 * 1.35 }), ctxBase());
check(r.ok && r.dmg > 30, 'Kopftreffer mit Kopf-Multiplikator');
r = ac4.validateHit(20, claim({ serial: 3, point: [26, 1.2, 0] }), ctxBase({ now: 11.05 }));
check(r.ok, 'Ziel war vor 450 ms am Trefferpunkt (Zeitfenster 400 ms + Lücke)');
r = ac4.validateHit(21, claim({ serial: 31, point: [22, 1.2, 0] }), ctxBase({ now: 11.06 }));
check(!r.ok && r.reason === 'position', 'Ziel war vor 800 ms dort – zu alt → position');
r = ac4.validateHit(22, claim({ serial: 32, point: [22, 1.2, 0] }), ctxBase({ now: 11.07, rtt: 0.5 }));
check(r.ok, 'hohe Laufzeit des Schützen verlängert das Zeitfenster');
r = ac4.validateHit(23, claim({ serial: 33, point: [22, 1.2, 0] }), ctxBase({ now: 11.08, interp: 0.4 }));
check(r.ok, 'Interpolation des Schützen (0,4 s) verlängert das Zeitfenster (400 ms + rtt + Interpolation)');
r = ac4.validateHit(24, claim({ serial: 34, point: [22, 1.2, 0] }), ctxBase({ now: 11.09, interp: undefined }));
check(r.ok, 'ohne Angabe: Standard-Interpolation 0,45 s eingerechnet');
r = ac4.validateHit(25, claim({ serial: 35, point: [20.5, 1.2, 0] }), ctxBase({ now: 13.5, rtt: 1, interp: 1 }));
check(!r.ok && r.reason === 'position', 'höchstens 2 s zurück (maxRewind), auch bei rtt 1 s + Interpolation 1 s');
r = ac4.validateHit(2, claim({ serial: 4, point: [15, 1.2, 0] }), ctxBase());
check(!r.ok && r.reason === 'position', 'Ziel nie in 2,5 m vom Trefferpunkt → position');
r = ac4.validateHit(2, claim({ serial: 1 }), ctxBase());
check(!r.ok && r.reason === 'doppelt', 'doppelte Treffermeldung');
r = ac4.validateHit(2, claim({ serial: 5, dmg: 80 }), ctxBase());
check(!r.ok && r.reason === 'schaden', 'Schaden über Maximum × Kopf → schaden');
r = ac4.validateHit(2, claim({ serial: 6, dmg: 33 }), ctxBase());
check(r.ok && r.dmg <= 25 * 1.03, `zu hoher Körperschaden wird auf Waffenschaden gekappt (${r.dmg.toFixed(1)})`);
r = ac4.validateHit(2, claim({ serial: 61, dmg: 25, origin: [0, 1.6, 0] }), ctxBase({ shooter: { alive: true, team: 'A', pos: [0, 0, 0], weapons: ['ar_m17'] } }));
check(r.ok && r.dmg < 24.5, `Schadensabfall mit der Entfernung (29,9 m → ${r.dmg.toFixed(1)})`);
r = ac4.validateHit(2, claim({ serial: 7, weapon: 'sr_brecher', dmg: 100 }), ctxBase());
check(!r.ok && r.reason === 'ausruestung', 'Waffe nicht in der Ausrüstung');
r = ac4.validateHit(2, claim({ serial: 8, weapon: 'laser' }), ctxBase());
check(!r.ok && r.reason === 'waffe', 'unbekannte Waffe');
r = ac4.validateHit(2, claim({ serial: 9 }), ctxBase({ target: { alive: true, team: 'A' } }));
check(!r.ok && r.reason === 'team', 'Treffer auf eigenes Team');
r = ac4.validateHit(2, claim({ serial: 10 }), ctxBase({ ffa: true, target: { alive: true, team: 'A' } }));
check(r.ok, 'FFA: gleiches „Team“ erlaubt');
r = ac4.validateHit(2, claim({ serial: 11 }), ctxBase({ target: { alive: false, team: 'B' } }));
check(!r.ok && r.reason === 'ziel-tot', 'totes Ziel abgelehnt');
r = ac4.validateHit(2, claim({ serial: 12, origin: [10, 1.6, 300] }), ctxBase({ shooter: { alive: true, team: 'A', pos: [10, 0, 300], weapons: ['ar_m17'] } }));
check(!r.ok && r.reason === 'reichweite', 'Entfernung > Reichweite');
r = ac4.validateHit(2, claim({ serial: 13, origin: [25, 1.6, 0] }), ctxBase());
check(!r.ok && r.reason === 'herkunft', 'Schuss nicht von der eigenen Position');
// VR: Schüsse starten am (gelehnten/seitlich versetzten) Auge, die Richtung kommt von der Hand und weicht vom Blick ab –
// der Anti-Cheat prüft Ursprung ↔ Körper und Ziel ↔ Trefferpunkt, keine Blickrichtung
r = ac4.validateHit(2, claim({ serial: 15, origin: [10.45, 1.35, 0.4], dist: 19.5 }), ctxBase());
check(r.ok, 'VR: Schuss vom gelehnten Auge (0,6 m neben der Körperachse), Richtung ≠ Blick → gültig');
r = ac4.validateHit(2, claim({ serial: 16, origin: [10.3, 0.55, -0.2], dist: 19.6 }), ctxBase());
check(r.ok, 'VR: Schuss aus der Hocke/liegend (Auge 0,55 m) → gültig');
{
  const acV = new AntiCheat();
  acV.onSpawn(9, [0, 0, 0], 0);
  let vOk = true;
  for (let i = 1; i <= 60; i++) if (!acV.onState(9, { x: i * 3.1 / 30, y: 0, z: 0, flags: FLAGS.ALIVE | FLAGS.ON_GROUND | FLAGS.VR }, i / 30).ok) vOk = false;
  check(vOk && acV.score(9, 2) === 0, 'VR-Bit in den Zuständen ändert die Bewegungsprüfung nicht (Gehen 3,1 m/s)');
}
const sg = { shooter: { alive: true, team: 'A', pos: [25, 0, 0], weapons: ['sg_bulldog'] } };
r = ac4.validateHit(2, claim({ serial: 14, weapon: 'sg_bulldog', pellet: 7, dmg: 18, origin: [25, 1.6, 0] }), ctxBase(sg));
check(r.ok, 'Schrotkugel 8 von 8');
r = ac4.validateHit(2, claim({ serial: 14, weapon: 'sg_bulldog', pellet: 8, dmg: 18, origin: [25, 1.6, 0] }), ctxBase(sg));
check(!r.ok && r.reason === 'ungueltig', 'Schrotkugel-Index außerhalb');
let rapid = 0;
for (let i = 0; i < 20; i++) if (ac4.validateHit(3, claim({ serial: 500 + i }), { ...ctxBase(), now: 13 + i * 0.01 }).reason === 'feuerrate') rapid++;
check(rapid > 10, `Treffer mit neuen Schussnummern schneller als rpm → feuerrate (${rapid}×)`);
check(ac4.log.length > 5 && ac4.log.every((l) => typeof l.t === 'number' && [2, 3, 21, 25].includes(l.peer) && AC_TEXT[l.reason]), `Protokoll mit ${ac4.log.length} Einträgen {t, peer, reason}`);
// Nahkampf
r = ac4.validateMelee(2, { target: 10, weapon: 'knife', serial: 50 }, ctxBase({ shooter: { alive: true, team: 'A', pos: [29, 0, 0], weapons: ['knife'] } }));
check(r.ok && r.dmg === 135, 'Nahkampf in Reichweite');
r = ac4.validateMelee(2, { target: 10, weapon: 'knife', serial: 51 }, ctxBase({ shooter: { alive: true, team: 'A', pos: [12, 0, 0], weapons: ['knife'] } }));
check(!r.ok && r.reason === 'reichweite', 'Nahkampf aus 18 m abgelehnt');
// Weiche Sichtprüfung
const ac5 = new AntiCheat();
let losStrike = false;
for (let i = 0; i < 12; i++) {
  const hr = ac5.validateHit(6, claim({ serial: 100 + i }), ctxBase({ los: () => false }));
  if (hr.reason === 'sicht') losStrike = true;
}
check(losStrike && ac5.log.some((l) => l.reason === 'sicht'), 'gehäufte Treffer ohne Sicht → weicher Verstoß');
const ac6 = new AntiCheat();
let losFalse = false;
for (let i = 0; i < 12; i++) if (ac6.validateHit(6, claim({ serial: 200 + i }), ctxBase({ los: () => i % 4 !== 0 })).reason === 'sicht') losFalse = true;
check(!losFalse, 'vereinzelte Treffer ohne Sicht (Vegetation) zählen nicht');
// Schwelle → Kick genau einmal
const ac7 = new AntiCheat({ onKick: (peer, reason) => kicks.push([peer, reason]) });
let kickRes = null;
for (let i = 0; i < 10 && !kickRes; i++) {
  const hr = ac7.validateHit(9, claim({ serial: 300 + i, dmg: 500 }), ctxBase({ now: 20 + i }));
  if (hr.kick) kickRes = hr;
}
check(kickRes && kickRes.kick === 'schaden' && kicks.filter((k) => k[0] === 9).length === 1, `Schwelle erreicht → Kick (${kicks.filter((k) => k[0] === 9).length}×)`);
for (let i = 0; i < 5; i++) ac7.validateHit(9, claim({ serial: 400 + i, dmg: 500 }), ctxBase({ now: 40 + i }));
check(kicks.filter((k) => k[0] === 9).length === 1, 'Kick wird nur einmal ausgelöst');
// Abklingen
const ac8 = new AntiCheat();
ac8.strike(1, 'tempo', 0);
ac8.strike(1, 'tempo', 0.1); // innerhalb minGap: zählt nicht
check(near(ac8.score(1, 0.1), 2, 0.01), 'gleicher Verstoß innerhalb 0,5 s zählt einmal');
check(near(ac8.score(1, 20), 1, 1e-9), 'Verstöße klingen ab (0,05/s)');

/* ------------------------------------------------------------------ recommend */
const perClient = (a, h = a) => 20 * (11 + 60 + a * 31 * (a >= INTEREST_MIN ? INTEREST_SHARE : 1)) + RELIABLE_BASE + RELIABLE_PER_HUMAN * h + RELIABLE_PER_ACTOR * a;
check(near(bandwidthFor(8), 7 * perClient(8), 1e-6) && bandwidthFor(1) === 0,
  `Bandbreite 8 Menschen ohne Bots: (n−1) × [20 Hz × (71 + n × 31) + ${RELIABLE_BASE} + ${RELIABLE_PER_HUMAN}·n + ${RELIABLE_PER_ACTOR}·n] = ${Math.round(bandwidthFor(8))} B/s`);
check(near(bandwidthFor(13, { actors: 32 }), 12 * perClient(32, 13), 1e-6) && near(clientBytes(32, { humans: 13 }), perClient(32, 13), 1e-6) && clientBytes(32) > clientBytes(32, { humans: 13 }),
  `13 Menschen + Bots (32 Akteure, Interessenfilter ${INTEREST_SHARE}): je Client ${(clientBytes(32, { humans: 13 }) / 1024).toFixed(1)} KB/s, gesamt ${(bandwidthFor(13, { actors: 32 }) / 1024).toFixed(0)} KB/s`);
// Lasttest (§13, auf 20 Hz hochgerechnet, 32 Akteure, 13 Menschen): Schnappschuss Ø 436 B (Anteil 0,43) → 9920 B/s bzw.
// Ø 538 B (Anteil 0,53) → 11 960 B/s; + Modus/Roster 1109 bzw. 876 B/s + Kampf (Bot-Runde) 2188 B/s = 13 217 bzw.
// 15 024 B/s je Client. Die Formel deckt beide, aber höchstens +25 % über dem kleineren
{
  const f = clientBytes(32, { humans: 13 });
  check(f >= 15024 && f <= 13217 * 1.25, `Formel deckt die Lasttests (13 217 / 15 024 B/s je Client): ${Math.round(f)} B/s`);
}
check(maxPlayersForUpload(bandwidthFor(10, { actors: 24 }) / 0.8, { actors: 24 }) === 10, 'Spieler je Upload mit Bot-Auffüllung (24 Akteure)');
check(maxPlayersForUpload(bandwidthFor(10) / 0.8) === 10 && maxPlayersForUpload(0) === 2 && maxPlayersForUpload(1e9) === 32, 'Spieler je Upload');
let rec = recommend({ cores: 8, memory: 8, fps: 120, upload: null });
check(rec.max === UNMEASURED_MAX && rec.measured === false && /nicht gemessen/.test(rec.reason), `ohne Messung: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 2, memory: 8, fps: null });
check(rec.max === 6 && /Prozessorkerne/.test(rec.reason), `2 Kerne: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 16, memory: 16, fps: 144, upload: { rate: 400000, congested: false, measured: true, players: 8 } });
check(rec.max === maxPlayersForUpload(800000) && rec.max >= 24 && rec.measured && rec.upload === 400000, `starker Rechner, 400 KB/s ohne Stau: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 16, memory: 16, fps: 144, upload: { rate: 40000, congested: true, measured: true, players: 8 } });
check(rec.max === maxPlayersForUpload(40000) && rec.max < 8 && /ausgelastet/.test(rec.reason), `Stau bei 40 KB/s: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 16, memory: 16, fps: 144, upload: { rate: 6000, congested: false, measured: true, players: 2 } });
check(rec.max === UNMEASURED_MAX && rec.measured, `wenig Verkehr ohne Stau senkt die Empfehlung nicht (${rec.max})`);
rec = recommend({ cores: 16, memory: 16, fps: 144, upload: { rate: 80000, congested: false, measured: true, players: 8 } });
check(rec.max === maxPlayersForUpload(160000) && rec.max > 8, `80 KB/s ohne Stau → hochgerechnet ${rec.max}`);
rec = recommend({ cores: 8, memory: 2, fps: 25, upload: { rate: 1e6, congested: false, measured: true } });
check(rec.max === 8 && rec.fps === 25, `2 GB / 25 FPS: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 8, memory: 8, upload: { rate: 1e6, measured: true }, connection: { effectiveType: '3g' } });
check(rec.max === 4, 'langsame Mobilfunkverbindung → 4');
const um = new UploadMeter({ minSamples: 3 });
let tt = 0;
um.sample(0, tt);
for (let i = 0; i < 4; i++) { um.add(50000); tt += 1; um.sample(1000, tt, 6); }
check(um.measured && near(um.state().rate, 50000, 2000) && !um.congested && um.players === 6, `Upload-Messung ${Math.round(um.state().rate)} B/s ohne Stau`);
for (let i = 0; i < 3; i++) { um.add(50000); tt += 1; um.sample(100000 + i * 40000, tt, 6); }
check(um.congested && um.state().rate < 50000, `wachsender Sendepuffer → Stau, Abfluss ${Math.round(um.state().rate)} B/s`);
// Bündel aus langen Bildern (1,6 FPS-Host): 3 s Verkehr kommen in 0,3 s an, dann 2,7 s nichts – Bestwert über ≥ 3 s
const bursty = new UploadMeter({ minSamples: 2 });
let tb = 0;
bursty.sample(0, tb);
for (let i = 0; i < 6; i++) { bursty.add(138000); tb += 0.3; bursty.sample(0, tb, 13); tb += 2.7; bursty.sample(0, tb, 13); }
check(bursty.measured && bursty.state().rate < 60000, `Upload in Bündeln (46 KB/s im Mittel): gemessen ${Math.round(bursty.state().rate)} B/s statt ${Math.round(138000 / 0.3)} B/s Spitze`);
const quiet = new UploadMeter();
quiet.sample(0, 0);
for (let i = 1; i < 10; i++) { quiet.add(500); quiet.sample(0, i); }
check(!quiet.measured, 'Lobby-Verkehr (500 B/s) zählt nicht als Messung');

console.log(fail ? `${fail} von ${count} Prüfungen fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
