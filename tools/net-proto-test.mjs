// NULLPUNKT – Prüft die reine Mehrspieler-Logik ohne Browser: Binärpakete (protocol.js), Anti-Cheat (anticheat.js)
// und Spielerzahl-Empfehlung (recommend.js).
// Aufruf: node tools/net-proto-test.mjs
import {
  encodeSnapshot, decodeSnapshot, encodeState, decodeState, packetType, WEAPON_INDEX, weaponIndexOf, weaponByIndex,
  NO_WEAPON, FLAGS, packFlags, unpackFlags, PKT_SNAPSHOT, PKT_STATE, SNAPSHOT_HEADER, SNAPSHOT_ENTITY, STATE_SIZE,
} from '../assets/js/game/net/protocol.js';
import { AntiCheat, PositionHistory, AC_TEXT } from '../assets/js/game/net/anticheat.js';
import { recommend, bandwidthFor, maxPlayersForUpload, clientBytes, UploadMeter, UNMEASURED_MAX, INTEREST_MIN, INTEREST_SHARE, RELIABLE_BASE, RELIABLE_PER_HUMAN, RELIABLE_PER_ACTOR } from '../assets/js/game/net/recommend.js';
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
// Lasttest (§13, auf 20 Hz hochgerechnet): 32 Akteure, 13 Menschen – Schnappschuss Ø 436 B → (436 + 60) × 20 = 9920 B/s,
// Modus + Roster 1109 B/s, Kampf (Bot-Runde) 2188 B/s = 13 217 B/s je Client; die Formel liegt darüber, aber < +25 %
check(clientBytes(32, { humans: 13 }) >= 13217 && clientBytes(32, { humans: 13 }) <= 13217 * 1.25,
  `Formel deckt den Lasttest (13 217 B/s je Client): ${Math.round(clientBytes(32, { humans: 13 }))} B/s (+${Math.round((clientBytes(32, { humans: 13 }) / 13217 - 1) * 100)} %)`);
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
