// NULLPUNKT – Prüft die reine Mehrspieler-Logik ohne Browser: Binärpakete (protocol.js), Anti-Cheat (anticheat.js)
// und Spielerzahl-Empfehlung (recommend.js).
// Aufruf: node tools/net-proto-test.mjs
import {
  encodeSnapshot, decodeSnapshot, encodeState, decodeState, packetType, WEAPON_INDEX, weaponIndexOf, weaponByIndex,
  NO_WEAPON, FLAGS, packFlags, unpackFlags, PKT_SNAPSHOT, PKT_STATE, SNAPSHOT_HEADER, SNAPSHOT_ENTITY, STATE_SIZE,
} from '../assets/js/game/net/protocol.js';
import { AntiCheat, PositionHistory, AC_TEXT } from '../assets/js/game/net/anticheat.js';
import { recommend, bandwidthFor, maxPlayersForUpload, UploadMeter, UNMEASURED_MAX } from '../assets/js/game/net/recommend.js';
import { WEAPONS, WEAPON_IDS } from '../assets/js/shared/weapons.data.js';

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
  now: (hitNow += 0.1), ffa: false, weapons: WEAPONS, history: hist,
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
const sg = { shooter: { alive: true, team: 'A', pos: [25, 0, 0], weapons: ['sg_bulldog'] } };
r = ac4.validateHit(2, claim({ serial: 14, weapon: 'sg_bulldog', pellet: 7, dmg: 18, origin: [25, 1.6, 0] }), ctxBase(sg));
check(r.ok, 'Schrotkugel 8 von 8');
r = ac4.validateHit(2, claim({ serial: 14, weapon: 'sg_bulldog', pellet: 8, dmg: 18, origin: [25, 1.6, 0] }), ctxBase(sg));
check(!r.ok && r.reason === 'ungueltig', 'Schrotkugel-Index außerhalb');
let rapid = 0;
for (let i = 0; i < 20; i++) if (ac4.validateHit(3, claim({ serial: 500 + i }), { ...ctxBase(), now: 13 + i * 0.01 }).reason === 'feuerrate') rapid++;
check(rapid > 10, `Treffer mit neuen Schussnummern schneller als rpm → feuerrate (${rapid}×)`);
check(ac4.log.length > 5 && ac4.log.every((l) => typeof l.t === 'number' && [2, 3, 21].includes(l.peer) && AC_TEXT[l.reason]), `Protokoll mit ${ac4.log.length} Einträgen {t, peer, reason}`);
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
check(bandwidthFor(8) === 20 * 7 * 8 * 40 && bandwidthFor(1) === 0, 'Bandbreitenformel 20 Hz × (n−1) × n × 40 Byte');
check(maxPlayersForUpload(bandwidthFor(10) / 0.8) === 10 && maxPlayersForUpload(0) === 2 && maxPlayersForUpload(1e9) === 32, 'Spieler je Upload');
let rec = recommend({ cores: 8, memory: 8, fps: 120, upload: null });
check(rec.max === UNMEASURED_MAX && rec.measured === false && /nicht gemessen/.test(rec.reason), `ohne Messung: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 2, memory: 8, fps: null });
check(rec.max === 6 && /Prozessorkerne/.test(rec.reason), `2 Kerne: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 16, memory: 16, fps: 144, upload: { rate: 400000, congested: false, measured: true, players: 8 } });
check(rec.max === maxPlayersForUpload(800000) && rec.max >= 24 && rec.measured && rec.upload === 400000, `starker Rechner, 400 KB/s ohne Stau: ${rec.max} („${rec.reason}“)`);
rec = recommend({ cores: 16, memory: 16, fps: 144, upload: { rate: 40000, congested: true, measured: true, players: 8 } });
check(rec.max === maxPlayersForUpload(40000) && rec.max < 8 && /ausgelastet/.test(rec.reason), `Stau bei 40 KB/s: ${rec.max} („${rec.reason}“)`);
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
const quiet = new UploadMeter();
quiet.sample(0, 0);
for (let i = 1; i < 10; i++) { quiet.add(500); quiet.sample(0, i); }
check(!quiet.measured, 'Lobby-Verkehr (500 B/s) zählt nicht als Messung');

console.log(fail ? `${fail} von ${count} Prüfungen fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
process.exit(fail ? 1 : 0);
