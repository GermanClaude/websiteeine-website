// NULLPUNKT – Mehrspieler: Synchronisation auf einem Client (Vertrag docs/planung/mehrspieler.md §1, §4, §5, §7).
//
// Der Client simuliert nur seinen eigenen Spieler. Alles andere sind Puppen (BotManager.spawnPuppet) aus der Akteursliste
// ('actors') und den Schnappschüssen des Hosts; der Modus läuft als Abbild (mode.applyNetState). ClientSync:
//   • Schnappschüsse puffern und je Puppe interpolieren (puppet.netPose vor G.bots.update). Wiedergabe-Uhr aus den
//     Zeitstempeln der Schnappschüsse selbst (nicht aus serverTime – die Laufzeit Host → Client steckt so nicht im Puffer):
//     rt = jetzt + max(Stempel − Ankunft) − Puffer, Puffer = 1,25 × Paketabstand + 2,5 × Ankunftsschwankung + 20 ms
//     (0,1…0,4 s), die Uhr läuft mit ±12 % nach. Höchstens 0,25 s fortschreiben; Sprünge in der Rohposition (Korrektur
//     nach dem Fortschreiben) glättet ein abklingender Versatz (≈ 0,1 s), ab 3 m wird gesetzt (Spawn/Teleport).
//     Eigener Eintrag → maßgebliche Lebenspunkte. Tod/Spawn kommen als 'kill'/'spawn'; Einträge nach dem ersten toten
//     Eintrag gehören zum nächsten Leben und gelten erst nach dessen Spawn; fehlt eine Meldung, gleicht der
//     Lebend-Zustand der Schnappschüsse ab (nach 0,35 s + Laufzeit).
//   • Eigener Spieler: wartet bis 'spawn' (G.spawnActor mit vorgegebenem Ort), schickt 30 Hz PKT_STATE (in VR mit
//     VR-Zusatz: Schussrichtung der Hand, Hände relativ zum Kopf), folgt 'correct'. Puppen von VR-Spielern: der Zusatz wird
//     wie die Pose interpoliert (netPose.vr → bots/bot.js Kopf, Waffe, Arme).
//   • Schaden: combat.damage ruft claimDamage – eigene Treffer auf Puppen → 'hit'/'melee' an den Host + vorhergesagte
//     Trefferanzeige; Sturz/Welt → Meldung an sich selbst; alles andere wirkt nicht (der Host entscheidet).
//   • Würfe/Raketen: localThrow/localRocket → 'throw' an den Host + Darstellungs-Geschoss; Zündung kommt als 'ev'.
//   • 'hit'/'kill' → lokale Ereignisse (Blut, Trefferrichtung, Abschussliste, Todesbildschirm), 'ev' → Granaten, Raketen,
//     Explosionen, eigene Punkte/Medaillen; 'end' → Endbildschirm mit Ergebnis + Zusammenfassung des Hosts.
//   • Fahrzeuge (panzer-mp.md §C): Fahrzeug-Anhang der Schnappschüsse → G.vehicles.net (Abbild, gleiche Abspieluhr),
//     eigene Sitz-Absicht als Anhang des Zustands; die Liste 'vehicles' wird gepuffert, bis das Abbild steht.
//   • Serienprämien (online nur die FPV-Drohne; mode.streaks als Abbild, modes/streaks.js): 'ev' sk eigener Fortschritt,
//     sa Antwort auf die eigene Anfrage (sendStreak), sv Prämie eines anderen, dr Lage fremder Drohnen, de Ende einer Drohne;
//     die eigene Drohne fliegt lokal und meldet Lage/Sprengung/Ende über sendDrone.
import * as THREE from 'three';
import { WEAPONS } from '../../shared/weapons.data.js';
import { netPoseOf } from '../bots/bot.js';
import { PKT_SNAPSHOT, decodeSnapshot, encodeState, packetType, FLAGS } from './protocol.js';
import { HOST_ID } from './index.js';
import { STATE_HZ, INTERP_MIN, INTERP_MAX, STALE_SEC, rnd, arr3, vec3, wrapAngle, vrPoseOf, newVrPose, lerpVrPose } from './sync-common.js';

const nowSec = () => performance.now() / 1000;
const ENV_GAP = 0.4;
const MAX_SAMPLES = 40;
const EXTRAPOLATE = 0.25; // s über den letzten Schnappschuss hinaus fortschreiben
const RECONCILE = 0.35; // s (+ Laufzeit): so lange muss der Lebend-Zustand der Schnappschüsse abweichen, bevor er gilt
const OFF_DECAY = 0.02; // s/s: Zeitbezug gibt langsam nach (Laufzeit wächst) – schnellere Pakete heben ihn sofort
const CLOCK_STEER = 0.12; // Wiedergabe-Uhr läuft höchstens ±12 % schneller/langsamer, um aufzuholen
const SMOOTH_K = 10; // 1/s: Abklingen des Glättungsversatzes
const SMOOTH_MIN = 0.04; // m: kleinere Abweichungen von der erwarteten Bewegung sind Bewegung, keine Korrektur
const SNAP = 3; // m: darüber wird gesetzt statt geglättet (Spawn, Rücksetzung)
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();

const lerp = (a, b, t) => a + (b - a) * t;

export class ClientSync {
  /**
   * @param {object} G
   * @param {import('./index.js').NetSystem} net
   * @param {object} cfg cfg.net des Matches (role 'client', selfId, team …)
   */
  constructor(G, net, cfg = {}) {
    this.G = G;
    this.net = net;
    this.role = 'client';
    this.cfg = cfg || {};
    this.roomCode = this.cfg.roomCode || null;
    this.selfId = Number.isInteger(this.cfg.selfId) ? this.cfg.selfId : net.selfId;
    this.active = false;
    this.ended = false;
    /** true, sobald der Host 'playing' meldet (Countdown des Clients wartet darauf). */
    this.hostPlaying = false;
    this.ids = new Map(); // netId → Identität aus 'actors'
    this.buf = new Map(); // netId → [{t, e}] Schnappschuss-Einträge (aufsteigend)
    this.seen = new Map(); // netId → nowSec() des letzten Schnappschusses mit diesem Akteur
    this.spawnSt = new Map(); // netId → Host-Zeit des letzten 'spawn'
    this.killSt = new Map(); // netId → Host-Zeit des letzten 'kill'
    this.pendingSpawns = new Map(); // netId → 'spawn' (Puppe/Spieler noch nicht bereit)
    this.modeState = null;
    this.self = null; // letzter eigener Schnappschuss-Eintrag {t, e}
    this._mismatch = new Map(); // netId → seit wann der Lebend-Zustand abweicht
    this._smooth = new Map(); // netId → Glättung {x,y,z Versatz, rx,ry,rz letzte Rohposition}
    /** Wiedergabe-Uhr: off = max(Stempel − Ankunft), jit = Ankunftsschwankung, buf = Puffer, rt = Wiedergabezeit (Host-Zeit). */
    this.clock = { off: null, jit: 0.005, buf: INTERP_MIN, rt: null, lastArr: 0, lastNow: null };
    this._snapGap = 0.05;
    this._lastSnapT = null;
    this._snapAt = 0;
    this._seq = 0;
    this._sendAt = 0;
    this._cid = 0;
    this._meleeSerial = 0;
    this._envAt = 0;
    this._state = {};
    this._pose = {};
    this._offs = [
      net.on('actors', (m) => this._onActors(m)),
      net.on('spawn', (m) => this._onSpawn(m)),
      net.on('hit', (m) => this._onHit(m)),
      net.on('kill', (m) => this._onKill(m)),
      net.on('mode', (m) => this._onMode(m)),
      net.on('ev', (m) => this._onEv(m)),
      net.on('end', (m) => this._onEnd(m)),
      net.on('correct', (m) => this._onCorrect(m)),
      // Fahrzeugliste (vehicles/net.js wertet sie aus; vor dem Anschluss des Abbilds hier gepuffert)
      net.on('vehicles', (m, from) => { if (from === HOST_ID && m && Array.isArray(m.list)) this.lastVehicles = m; }),
      net.onFast((buf) => this._onFast(buf)),
    ];
    // Wiedereinstieg anhalten („Ausrüsten“ im Todesbildschirm) bzw. „Einsatz“: der Host hält die Puppe genauso an
    if (G.events) this._offs.push(G.events.on('respawn:hold', (e) => {
      if (!this.active || this.ended || !e) return;
      this.net.send(HOST_ID, { t: 'hold', on: !!e.on, p: G.match.respawnHoldPause !== false });
    }));
    // Ausrüstung im Match gewechselt (Todesbildschirm, Pausenmenü): dem Host melden – gilt dort ab dem nächsten Spawn
    if (G.events) this._offs.push(G.events.on('loadout:change', (e) => {
      if (!this.active || this.ended || !e || e.actor !== G.player || !e.loadout) return;
      const lo = { ...e.loadout };
      const key = JSON.stringify(lo);
      if (key === this._loKey) return;
      this._loKey = key;
      if (typeof this.net.setLoadout === 'function') this.net.setLoadout({ cls: lo.cls || null, loadout: lo });
    }));
    // Panzerung: eigenes Platteneinsetzen an den Host melden (dort wirkt es; Ergebnis kommt mit 'hit'/'ev' ap zurück)
    if (G.events) this._offs.push(G.events.on('armor:plate', (e) => {
      if (!this.active || !e || e.actor !== G.player || e.net) return;
      if (e.phase === 'start') this.net.send(HOST_ID, { t: 'plate', chain: !!(e.actor.armor && e.actor.armor.inserting && e.actor.armor.inserting.chain) });
      else if (e.phase === 'cancel') this.net.send(HOST_ID, { t: 'plate', cancel: true });
    }));
  }

  /* ================================================================ Lebenszyklus */

  /** main.js (über NetSystem.onMatchStart): Welt geladen – gepufferte Akteure/Spawns/Zustände anwenden. */
  onMatchStart() {
    const G = this.G;
    this.active = true;
    this.ended = false;
    this.selfId = this.net.selfId || this.selfId;
    G.player.netId = this.selfId;
    for (const id of this.ids.keys()) if (id !== this.selfId) this._ensurePuppet(id);
    if (this.modeState) this._applyMode(this.modeState);
    const own = this.pendingSpawns.get(this.selfId);
    for (const [id, m] of [...this.pendingSpawns]) if (id !== this.selfId) this._onSpawn(m);
    if (own) this._onSpawn(own);
  }

  onMatchEnd() {}

  onTeardown() {
    this.active = false;
    this.buf.clear();
    this.seen.clear();
    this._mismatch.clear();
    this._smooth.clear();
  }

  dispose() {
    this.onTeardown();
    for (const off of this._offs) { try { off(); } catch { /* */ } }
    this._offs = [];
  }

  /* ================================================================ Bild */

  /** Wiedergabezeit (Host-Zeit) dieses Bildes: Zeitbezug der Schnappschüsse − Puffer, sanft nachgeführt. */
  _playout(now) {
    const c = this.clock;
    const dt = c.lastNow == null ? 0 : Math.max(0, Math.min(1, now - c.lastNow));
    c.lastNow = now;
    if (c.off == null) return null;
    const want = Math.min(INTERP_MAX, Math.max(INTERP_MIN, this._snapGap * 1.25 + c.jit * 2.5 + 0.02));
    c.buf += (want - c.buf) * Math.min(1, dt * 2);
    const target = now + c.off - c.buf;
    if (c.rt == null || Math.abs(target - c.rt) > 0.5) c.rt = target;
    else {
      c.rt += dt;
      const err = target - c.rt;
      c.rt += Math.max(-CLOCK_STEER * dt, Math.min(CLOCK_STEER * dt, err));
    }
    return c.rt;
  }

  /** Darstellungsverzug (s): wie weit die Puppen hinter der Host-Zeit stehen (Treffermeldung → Prüffenster des Hosts). */
  viewDelay() {
    const c = this.clock;
    if (c.rt == null || !this.net.timeSynced) return null;
    return Math.max(0, Math.min(1, this.net.serverTime() - c.rt));
  }

  preUpdate() {
    if (!this.active) return;
    const G = this.G;
    const now = nowSec();
    const dtReal = this.clock.lastNow == null ? 0 : Math.max(0, Math.min(1, now - this.clock.lastNow));
    const rt = this._playout(now);
    const resync = Math.max(0, (this.net.peerRtt(HOST_ID) || 0) / 1000);
    for (const [id, list] of this.buf) {
      if (id === this.selfId || !list.length) continue;
      const a = this._ensurePuppet(id);
      if (!a) continue;
      this._reconcile(id, a, list, now, resync);
      if (!a.alive || rt == null) continue;
      const np = a._netPoseObj || (a._netPoseObj = { pos: [0, 0, 0], vel: [0, 0, 0] });
      if (this._puppetPose(id, list, rt, dtReal, np)) a.netPose = np;
    }
    // Ausrüsten im Todesbildschirm: die Restzeit steht still – beim Host ebenso ('hold'), hier nur die Anzeige
    const pl = G.player;
    if (G.match.respawnHold && G.match.respawnHoldPause !== false && pl && !pl.alive && pl.respawnAt != null) pl.respawnAt += G.time.dt;
    // Puppen, die in den Schnappschüssen fehlen, während andere weiter ankommen (Host hat sie entfernt): nach STALE_SEC weg
    if (now - this._snapAt < 1) {
      for (const [id, at] of this.seen) if (now - at >= STALE_SEC) this._removePuppet(id);
    }
    this._applySelf(now);
    void G;
  }

  postUpdate() {
    if (!this.active || !this.net.online) return;
    const now = nowSec();
    if (now - this._sendAt < 1 / STATE_HZ - 0.002) return;
    this._sendAt = now;
    const p = this.G.player;
    const np = netPoseOf(p, this._pose);
    const s = this._state;
    s.x = np.pos[0]; s.y = np.pos[1]; s.z = np.pos[2];
    s.vx = np.vel[0]; s.vy = np.vel[1]; s.vz = np.vel[2];
    s.yaw = np.yaw; s.pitch = np.pitch; s.flags = np.flags; s.weapon = np.weapon;
    s.lean = np.lean; s.shots = np.shots; s.proneBlend = np.proneBlend;
    // VR: Kopf/Hände/Schussrichtung als Zusatzblock (sonst null – Paket wie ohne VR)
    s.vr = vrPoseOf(this.G, p, this._vr || (this._vr = newVrPose()));
    // Fahrzeug: eigene Sitz-Absicht (sonst null – Paket wie ohne Fahrzeug)
    const vn = this._vn();
    s.veh = vn ? vn.inputState() : null;
    this.net.sendFast(HOST_ID, encodeState(++this._seq, this.net.serverTime(), s));
  }

  /** Fahrzeug-Abbild (vehicles/net.js) oder null. */
  _vn() {
    const V = this.G.vehicles;
    return V && V.attached && V.net && V.net.replica ? V.net : null;
  }

  /* ================================================================ Schnappschüsse */

  _onFast(buf) {
    if (packetType(buf) !== PKT_SNAPSHOT) return;
    const d = decodeSnapshot(buf);
    if (!d) return;
    const t = d.serverTime;
    if (this._lastSnapT != null) {
      const gap = t - this._lastSnapT;
      if (gap > 0 && gap < 2) this._snapGap = this._snapGap * 0.85 + gap * 0.15;
      if (gap <= 0) return; // überholtes Paket
    }
    this._lastSnapT = t;
    const now = nowSec();
    this._snapAt = now;
    // Zeitbezug: das am wenigsten verspätete Paket bestimmt ihn (gibt langsam nach), Abstand dazu = Schwankung
    const c = this.clock;
    const o = t - now;
    if (c.off == null || !Number.isFinite(c.off)) { c.off = o; c.rt = null; }
    else {
      c.off -= OFF_DECAY * Math.max(0, Math.min(5, now - c.lastArr));
      if (o > c.off) c.off = o;
      c.jit = c.jit * 0.92 + Math.min(0.5, c.off - o) * 0.08;
    }
    c.lastArr = now;
    if (d.vehicles && d.vehicles.length) { const vn = this._vn(); if (vn) vn.onSnapshot(t, d.vehicles); }
    for (const e of d.entities) {
      if (e.id === this.selfId) { this.self = { t, e }; continue; }
      let list = this.buf.get(e.id);
      if (!list) this.buf.set(e.id, (list = []));
      // Abstand der Einträge je Akteur (ferne Akteure kommen seltener – Interessenfilter des Hosts)
      if (list.length) { const g = t - list[list.length - 1].t; if (g > 0 && g < 2) list.gap = list.gap ? list.gap * 0.7 + g * 0.3 : g; }
      list.push({ t, e });
      if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
      this.seen.set(e.id, now);
    }
  }

  /** Pose einer Puppe für dieses Bild (Wiedergabezeit rt, reale Bildzeit dt) → out; false = nichts Gültiges im Puffer. */
  _puppetPose(id, list, rt, dt, out) {
    // seltener gesendete (ferne) Akteure etwas weiter zurück, damit auch sie zwischen zwei Einträgen liegen. Der Zusatz
    // ändert sich stetig und höchstens mit CLOCK_STEER (wie die Wiedergabe-Uhr) – sprang er vorher an einer Schwelle um bis
    // zu 0,4 s, lief die Puppe bei unregelmäßigen Schnappschüssen (Host < 2 Hz) kurz rückwärts
    const want = Math.min(0.4, Math.max(0, (list.gap || 0) - this._snapGap) * 1.1);
    if (list.extra == null) list.extra = want;
    else {
      const step = CLOCK_STEER * Math.max(0, dt);
      list.extra += Math.max(-step, Math.min(step, want - list.extra));
    }
    const rtA = rt - list.extra;
    if (!this._sample(list, rtA, out, this.spawnSt.get(id))) return false;
    this._smoothPose(id, out, dt);
    return true;
  }

  /**
   * Pose zur Zeit rt aus dem Puffer (lineare Interpolation; nach dem letzten Eintrag kurz fortgeschrieben). Einträge vor dem
   * letzten Spawn (Host-Zeit) und tote Einträge zählen nicht. → true, wenn out gefüllt wurde.
   */
  _sample(list, rt, out, spawnSt) {
    let i = list.length - 1;
    const minT = Number.isFinite(spawnSt) ? spawnSt - 0.02 : -Infinity;
    // Leben abgrenzen: ab dem ersten toten Eintrag nach dem Spawn beginnt das nächste Leben (gilt erst nach dessen
    // Spawn) – sonst gleitet die Puppe vor dem verspäteten 'kill' quer über die Karte zum neuen Spawnpunkt
    let deadT = Infinity;
    for (let k = 0; k < list.length; k++) if (list[k].t >= minT && (list[k].e.flags & FLAGS.ALIVE) === 0) { deadT = list[k].t; break; }
    const ok = (s) => s.t >= minT && s.t < deadT && (s.e.flags & FLAGS.ALIVE) !== 0;
    while (i >= 0 && list[i].t > rt) i--;
    let ia = i;
    let a = i >= 0 ? list[i] : null;
    let b = i + 1 < list.length ? list[i + 1] : null;
    if (a && !ok(a)) a = null;
    if (b && !ok(b)) b = null;
    if (!a && !b) {
      // nichts Gültiges um rt: jüngsten gültigen Eintrag nehmen
      for (let k = list.length - 1; k >= 0; k--) if (ok(list[k])) { a = list[k]; ia = k; break; }
      if (!a) return false;
    }
    let e0 = a ? a.e : b.e;
    let e1 = e0;
    let f = 0;
    if (a && b) {
      e1 = b.e;
      f = Math.max(0, Math.min(1, (rt - a.t) / Math.max(1e-3, b.t - a.t)));
    }
    // Tempo laut Positionen (Host-Zeit) ÷ gemeldetes Tempo, höchstens 1: läuft der Host langsamer als Echtzeit (< 20 Bilder/s,
    // je Bild ≤ 50 ms Spielzeit), kommen die Positionen langsamer voran als vx/vz angeben – das Fortschreiben lief dann über
    // das nächste Paket hinaus und die Puppe sprang zurück (mp-test, Host 1,5 Bilder/s). Sonst ≈ 1.
    let vs = 1;
    let s0 = a && b ? a : null;
    if (a && !b) for (let k = ia - 1; k >= 0; k--) if (ok(list[k])) { s0 = list[k]; break; }
    const s1 = a && b ? b : a;
    if (s0 && s1 && s1 !== s0 && s1.t - s0.t > 1e-3 && s1.t - s0.t < 2) {
      const rep = (Math.hypot(s0.e.vx, s0.e.vz) + Math.hypot(s1.e.vx, s1.e.vz)) / 2;
      if (rep > 0.5) vs = Math.min(1, Math.hypot(s1.e.x - s0.e.x, s1.e.z - s0.e.z) / (s1.t - s0.t) / rep);
    }
    let dx = 0, dy = 0, dz = 0;
    if (a && !b) {
      // fortschreiben (höchstens EXTRAPOLATE s)
      const ex = Math.max(0, Math.min(EXTRAPOLATE, rt - a.t));
      dx = e0.vx * ex * vs; dz = e0.vz * ex * vs;
      dy = (e0.flags & FLAGS.ON_GROUND) !== 0 ? 0 : e0.vy * ex;
    } else if (!a) e0 = e1 = b.e;
    out.pos[0] = lerp(e0.x, e1.x, f) + dx;
    out.pos[1] = lerp(e0.y, e1.y, f) + dy;
    out.pos[2] = lerp(e0.z, e1.z, f) + dz;
    out.vel[0] = lerp(e0.vx, e1.vx, f) * vs; out.vel[1] = lerp(e0.vy, e1.vy, f); out.vel[2] = lerp(e0.vz, e1.vz, f) * vs;
    out.yaw = e0.yaw + wrapAngle(e1.yaw - e0.yaw) * f;
    out.pitch = lerp(e0.pitch, e1.pitch, f);
    out.flags = (f < 0.5 ? e0 : e1).flags;
    out.weapon = (f < 0.5 ? e0 : e1).weaponId || null;
    out.lean = lerp(e0.lean, e1.lean, f);
    out.proneBlend = lerp(e0.proneBlend, e1.proneBlend, f);
    out.shots = e0.shots; // Schüsse erst, wenn die Puppe an der Stelle ist
    // VR-Körpersprache (Zielrichtung der Hand, Hände relativ zum Kopf) – nur bei VR-Spielern
    out.vr = e0.vr || e1.vr ? lerpVrPose(e0.vr, e1.vr, f, out._vr || (out._vr = newVrPose())) : null;
    const last = list[list.length - 1].e;
    out.hp = last.hp;
    return true;
  }

  /**
   * Glättung: die Rohposition darf sich wie erwartet bewegen (Geschwindigkeit × dt); was davon abweicht (Korrektur nach
   * dem Fortschreiben, verspätetes Paket), wandert in einen Versatz, der mit SMOOTH_K abklingt. Ab SNAP wird gesetzt.
   */
  _smoothPose(id, np, dt) {
    const p = np.pos;
    let sm = this._smooth.get(id);
    if (!sm) { this._smooth.set(id, (sm = { x: 0, y: 0, z: 0, rx: p[0], ry: p[1], rz: p[2] })); return; }
    const dx = p[0] - sm.rx - np.vel[0] * dt;
    const dy = p[1] - sm.ry - np.vel[1] * dt;
    const dz = p[2] - sm.rz - np.vel[2] * dt;
    sm.rx = p[0]; sm.ry = p[1]; sm.rz = p[2];
    const dev = Math.hypot(dx, dy, dz);
    if (dev > SNAP) { sm.x = sm.y = sm.z = 0; return; }
    if (dev > SMOOTH_MIN) { sm.x -= dx; sm.y -= dy; sm.z -= dz; }
    const k = Math.exp(-SMOOTH_K * dt);
    sm.x *= k; sm.y *= k; sm.z *= k;
    if (Math.hypot(sm.x, sm.y, sm.z) > SNAP) { sm.x = sm.y = sm.z = 0; return; }
    p[0] += sm.x; p[1] += sm.y; p[2] += sm.z;
  }

  /**
   * Lebend-Zustand der Schnappschüsse ↔ Puppe (verpasste 'spawn'/'kill' nachholen, nach kurzer Wartezeit + Laufzeit –
   * 'kill'/'spawn' können hinter einer Wiederholung auf dem zuverlässigen Kanal warten).
   */
  _reconcile(id, a, list, now, extra = 0) {
    const last = list[list.length - 1];
    const alive = (last.e.flags & FLAGS.ALIVE) !== 0;
    const sp = this.spawnSt.get(id);
    const kl = this.killSt.get(id);
    const fresh = (!Number.isFinite(sp) || last.t > sp + 0.05) && (!Number.isFinite(kl) || last.t > kl + 0.05);
    // Tod + Wiedereinstieg ganz zwischen zwei Meldungen (beide noch unterwegs): lebt vorn und hinten, tot dazwischen
    let gap = false;
    if (alive && a.alive) {
      const minT = Number.isFinite(sp) ? sp - 0.02 : -Infinity;
      for (const e of list) if (e.t >= minT && (e.e.flags & FLAGS.ALIVE) === 0) { gap = true; break; }
    }
    if ((alive === !!a.alive && !gap) || !fresh) { this._mismatch.delete(id); return; }
    const since = this._mismatch.get(id);
    if (since == null) { this._mismatch.set(id, now); return; }
    if (now - since < RECONCILE + Math.min(1, extra)) return;
    this._mismatch.delete(id);
    const G = this.G;
    if (gap) { a.health = 0; a.onDeath({}); }
    // Beginn des neuen Zustands im Puffer (erster Eintrag nach dem letzten mit dem alten Zustand)
    let k = list.length - 1;
    while (k > 0 && ((list[k - 1].e.flags & FLAGS.ALIVE) !== 0) === alive) k--;
    const since0 = list[k];
    if (alive) {
      this.spawnSt.set(id, since0.t);
      this._smooth.delete(id);
      a.respawn({ position: new THREE.Vector3(last.e.x, last.e.y, last.e.z), yaw: last.e.yaw });
      a.health = last.e.hp;
      G.events.emit('actor:spawn', { actor: a, net: true });
    } else {
      this.killSt.set(id, since0.t);
      a.health = 0;
      a.onDeath({});
    }
  }

  /** Eigener Eintrag im Schnappschuss: Lebenspunkte des Hosts; verpasster Tod/Spawn wird nachgeholt. */
  _applySelf(now) {
    const s = this.self;
    const p = this.G.player;
    if (!s || !p) return;
    const sp = this.spawnSt.get(this.selfId);
    const kl = this.killSt.get(this.selfId);
    if (Number.isFinite(sp) && s.t < sp + 0.02) return;
    if (Number.isFinite(kl) && s.t < kl + 0.02) return;
    const alive = (s.e.flags & FLAGS.ALIVE) !== 0;
    if (alive && p.alive) {
      const older = Number.isFinite(this._selfHitSt) && s.t < this._selfHitSt;
      if (!older && Math.abs((p.health || 0) - s.e.hp) >= 1) p.health = Math.max(1, Math.min(p.maxHealth || 100, s.e.hp));
      this._mismatch.delete(this.selfId);
      return;
    }
    if (alive === !!p.alive || !Number.isFinite(sp)) { this._mismatch.delete(this.selfId); return; }
    const since = this._mismatch.get(this.selfId);
    if (since == null) { this._mismatch.set(this.selfId, now); return; }
    if (now - since < RECONCILE * 2 + Math.min(1, (this.net.peerRtt(HOST_ID) || 0) / 1000)) return;
    this._mismatch.delete(this.selfId);
    const G = this.G;
    if (alive) { this.spawnSt.set(this.selfId, s.t); G.spawnActor(p, { position: new THREE.Vector3(s.e.x, s.e.y, s.e.z), yaw: s.e.yaw }); }
    else { p.health = 0; p.onDeath({}); }
  }

  /* ================================================================ Akteure */

  _onActors(m) {
    if (!m || !Array.isArray(m.list)) return;
    const next = new Map();
    for (const e of m.list) if (e && Number.isInteger(e.id)) next.set(e.id, e);
    // Verschwundene Akteure (Austritt, Bot abgebaut)
    for (const id of this.ids.keys()) if (!next.has(id)) this._removePuppet(id);
    this.ids = next;
    if (!this.active) return;
    for (const [id, e] of next) {
      if (id === this.selfId) { this._syncTeam(this.G.player, e.t); continue; }
      const a = this._ensurePuppet(id);
      if (a && e.n && a.name !== e.n) a.name = e.n;
      if (a) this._syncTeam(a, e.t);
    }
  }

  /** Team laut Host übernehmen (Infiziert: Überlebende laufen über) und als 'team:change' melden. */
  _syncTeam(a, t) {
    if (!a || (t !== 'A' && t !== 'B') || a.team === t) return;
    const from = a.team;
    a.team = t;
    this.G.events.emit('team:change', { actor: a, from, to: t });
  }

  /** Puppe zu einer Netz-Id (anlegen, sobald die Identität bekannt ist). */
  _ensurePuppet(id) {
    const G = this.G;
    if (id === this.selfId || !G.bots) return null;
    let a = G.bots.byNetId(id);
    if (a) return a;
    const info = this.ids.get(id);
    if (!info || !this.active) return null;
    a = G.bots.spawnPuppet({
      netId: id, name: info.n, team: info.t, cls: info.c, loadout: info.lo || null,
      variant: info.v !== undefined ? info.v : null, scheme: info.sc || null, isHuman: !!info.h,
    });
    a.respawnAt = null;
    // Spawn, der vor der Identität ankam
    const sp = this.pendingSpawns.get(id);
    if (sp) { this.pendingSpawns.delete(id); this._spawnPuppet(a, sp); }
    return a;
  }

  _removePuppet(id) {
    const G = this.G;
    this.buf.delete(id);
    this.seen.delete(id);
    this._mismatch.delete(id);
    this._smooth.delete(id);
    this.pendingSpawns.delete(id);
    const a = G.bots && G.bots.byNetId(id);
    if (a && a.puppet) G.bots.removeBot(a);
  }

  /* ================================================================ Nachrichten */

  _onSpawn(m) {
    if (!m || !Number.isInteger(m.id)) return;
    // Schon nachgeholt (Lebend-Abgleich hat dieses Leben aus den Schnappschüssen übernommen): nicht noch einmal einsetzen
    const prev = this.spawnSt.get(m.id);
    const late = this.active && Number.isFinite(m.st) && Number.isFinite(prev) && m.st <= prev + 1e-3;
    if (Number.isFinite(m.st) && !late) this.spawnSt.set(m.id, m.st);
    if (!this.active) { this.pendingSpawns.set(m.id, m); return; }
    const G = this.G;
    if (m.id === this.selfId) {
      const pos = vec3(m.pos);
      if (!pos || (late && G.player.alive)) return;
      this._mismatch.delete(this.selfId);
      G.spawnActor(G.player, { position: pos, yaw: Number(m.yaw) || 0 });
      return;
    }
    if (late) { const a0 = G.bots && G.bots.byNetId(m.id); if (a0 && a0.alive) return; }
    const a = this._ensurePuppet(m.id);
    if (!a) { this.pendingSpawns.set(m.id, m); return; }
    this._spawnPuppet(a, m);
  }

  _spawnPuppet(a, m) {
    const pos = vec3(m.pos);
    if (!pos) return;
    const lo = m.loadout || {};
    const cur = a.loadout || {};
    if ((lo.primary && lo.primary !== cur.primary) || (lo.secondary && lo.secondary !== cur.secondary) || (lo.cls && lo.cls !== a.cls)) a.setNetLoadout(lo);
    a.respawn({ position: pos, yaw: Number(m.yaw) || 0 });
    if (Number.isFinite(m.hp)) a.health = m.hp;
    this._mismatch.delete(m.id);
    this._smooth.delete(m.id);
    // alte Schnappschüsse (vor dem Spawn) gelten nicht mehr
    const list = this.buf.get(m.id);
    if (list && Number.isFinite(m.st)) { let k = 0; while (k < list.length && list[k].t < m.st - 0.02) k++; if (k) list.splice(0, k); }
    this.G.events.emit('actor:spawn', { actor: a, net: true });
  }

  _actor(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    return this.net.actorById(id);
  }

  /** Schaden laut Host: eigene Lebenspunkte/Trefferrichtung, Blut und Trefferreaktion der Puppen. */
  _onHit(m) {
    if (!this.active || !m) return;
    const G = this.G;
    const target = this._actor(m.target);
    if (!target) return;
    const attacker = this._actor(m.attacker);
    const dir = vec3(m.dir);
    const point = vec3(m.point);
    const payload = {
      target, attacker, amount: Number(m.dmg) || 0, zone: m.zone || 'body', dir, point, weaponId: m.weapon || null,
      explosive: !!m.exp, killed: !!m.killed, armor: null, net: true,
    };
    const p = G.player;
    if (target === p) {
      // ältere Schnappschüsse (vor diesem Treffer) setzen die Lebenspunkte nicht mehr zurück
      if (Number.isFinite(m.st)) this._selfHitSt = Math.max(this._selfHitSt || 0, m.st);
      if (p.alive) {
        p.health = Math.max(0, Math.min(p.maxHealth || 100, Number(m.hp) || 0));
        p.lastDamageTime = G.time.elapsed;
        this._applyArmor(m.ar);
      }
      G.events.emit('actor:hit', payload);
      G.events.emit('player:damaged', { amount: payload.amount, dir, attacker });
      if (typeof p.onDamaged === 'function') p.onDamaged(payload);
      return;
    }
    if (target.alive && Number.isFinite(m.hp)) target.health = m.hp;
    target.lastDamageTime = G.time.elapsed;
    // eigene Treffer wurden schon vorhergesagt angezeigt (claimDamage) – nur die Körperreaktion fehlt noch; Treffer der
    // eigenen Fahrzeugwaffe (MG/Kanone, Überfahren) rechnet nur der Host → hier anzeigen
    const vehWeapon = !!(m.weapon && G.vehicles && typeof G.vehicles.weaponName === 'function' && G.vehicles.weaponName(m.weapon));
    if (attacker !== p || vehWeapon) G.events.emit('actor:hit', payload);
    if (typeof target.onDamaged === 'function' && target.alive) target.onDamaged(payload);
  }

  /** Abschuss laut Host: Tod (Ragdoll/Todeskamera), lokales 'kill' für Abschussliste, Medaillen-Hinweise, Respawn-Anzeige. */
  _onKill(m) {
    if (!m) return;
    if (Number.isFinite(m.st)) this.killSt.set(m.victim, Math.max(m.st, this.killSt.get(m.victim) ?? -Infinity));
    if (!this.active) return;
    const G = this.G;
    const v = this._actor(m.victim);
    if (!v) return;
    const k = this._actor(m.killer);
    const dir = vec3(m.dir);
    // Verspätetes 'kill' eines früheren Lebens (der Lebend-Abgleich hat Tod + Wiedereinstieg schon nachgeholt):
    // nur Abschussliste, das neue Leben bleibt
    const sp = this.spawnSt.get(m.victim);
    const stale = Number.isFinite(m.st) && Number.isFinite(sp) && sp > m.st && v.alive;
    if (!stale) this._mismatch.delete(m.victim);
    if (v.alive && !stale) {
      v.health = 0;
      if (typeof v.onDeath === 'function') v.onDeath({ killer: k, weaponId: m.weapon || null, headshot: !!m.head, explosive: !!m.exp, dir, distance: m.dist || 0 });
      v.alive = false;
    }
    const assisters = Array.isArray(m.assister) ? m.assister.map((id) => this._actor(id)).filter(Boolean) : [];
    G.events.emit('kill', {
      victim: v, killer: m.sui ? (k === v ? v : null) : k, weaponId: m.weapon || null, headshot: !!m.head, explosive: !!m.exp,
      assisters, streak: m.streak | 0, firstBlood: !!m.fb, longshot: !!m.ls, revenge: !!m.rv, distance: Number(m.dist) || 0,
      suicide: !!m.sui, net: true,
    });
    if (stale) return;
    // Wartezeit bis zum Wiedereinstieg (Host: Modus-Ausgleich) – main setzt sie im 'kill'-Hörer, hier der Wert des Hosts
    const resp = Number.isFinite(m.resp) ? m.resp : 3;
    v.diedAt = G.time.elapsed;
    v.respawnAt = G.time.elapsed + resp;
    v.respawnDelay = resp;
  }

  _onMode(m) {
    if (!m || !m.s) return;
    // Restzeit um die Laufzeit der Nachricht verkürzen (Host-Zeitstempel st)
    if (Number.isFinite(m.st) && Number.isFinite(m.s.tl) && m.s.tl > 0 && this.net.timeSynced) {
      const lag = Math.max(0, Math.min(1, this.net.serverTime() - m.st));
      if (lag > 0.005) m.s = { ...m.s, tl: Math.max(0, Math.round((m.s.tl - lag) * 100) / 100) };
    }
    this.modeState = m.s;
    if (m.s.ph === 1) this.hostPlaying = true;
    if (this.active) this._applyMode(m.s);
  }

  _applyMode(s) {
    const mode = this.G.mode;
    if (!mode || typeof mode.applyNetState !== 'function' || this.ended) return;
    try { mode.applyNetState(s, (id) => this.net.actorById(id)); } catch (err) { console.error('[net] Modus-Zustand', err); }
  }

  /** Effekte/Ereignisse des Hosts: Granaten, Raketen, Explosionen, eigene Punkte und Medaillen. */
  _onEv(m) {
    if (!this.active || !m || typeof m.e !== 'string') return;
    const G = this.G;
    const W = G.weapons;
    const owner = this._actor(m.o);
    switch (m.e) {
      case 'bs': if (G.building) G.building.applyNet(m, (id) => (id === this.selfId ? G.player : this._actor(id))); return; // Bauwerk (building.js)
      case 'bd': if (G.building) G.building.remove(m.id); return;
      case 'dr': if (G.doors) G.doors.applyNet(m); return; // Tür/Tor (doors.js)
      case 'gr': {
        if (!W) return;
        const gs = W.grenadeSystem;
        // eigener Wurf: Darstellungs-Granate übernimmt die Id des Hosts
        if (m.o === this.selfId && Number.isFinite(m.cid)) {
          const g = gs.findNet(null, m.cid);
          if (g) { g.netId = m.gid; return; }
        }
        if (gs.findNet(m.gid)) return;
        const pos = vec3(m.pos);
        const vel = vec3(m.vel);
        if (!pos || !vel) return;
        gs.throw(owner, m.type, { pos, vel, fuse: Number(m.fuse) || 2.5, remote: true, netId: m.gid });
        return;
      }
      case 'gb': {
        const pos = vec3(m.pos);
        if (W && pos) W.grenadeSystem.remoteBoom(m.gid || null, m.type, pos, owner);
        return;
      }
      case 'rk': {
        if (!W) return;
        const rs = W.rocketSystem;
        if (m.o === this.selfId && Number.isFinite(m.cid)) {
          const r = rs.findNet(null, m.cid);
          if (r) { r.netId = m.rid; return; }
        }
        if (rs.findNet(m.rid)) return;
        const def = WEAPONS[m.w];
        const pos = vec3(m.pos);
        const dir = vec3(m.dir);
        if (!def || !pos || !dir) return;
        rs.fire(owner, def, pos, dir.normalize(), 1, { remote: true, netId: m.rid });
        return;
      }
      case 'rb':
      case 'rd': {
        const pos = vec3(m.pos);
        if (W && pos) W.rocketSystem.remoteBoom(m.rid, pos, { def: WEAPONS[m.w] || null, actor: owner, dud: m.e === 'rd', normal: vec3(m.n) });
        return;
      }
      case 'ex': {
        const pos = vec3(m.pos);
        if (pos) G.events.emit('explosion', { position: pos, radius: Number(m.r) || 6, attacker: owner, type: m.type || 'frag', weaponId: m.w || null, net: true });
        return;
      }
      case 'ap':
        this._applyArmor(m.ar);
        return;
      case 'sk': case 'sa': case 'sv': case 'dr': case 'de': {
        // Serienprämien/FPV-Drohne (mode.streaks läuft auf dem Client als Abbild)
        const st = G.mode && G.mode.streaks;
        if (!st || typeof st.applyNetProgress !== 'function') return;
        const find = (id) => this._actor(id);
        if (m.e === 'sk') st.applyNetProgress(m);
        else if (m.e === 'sa') st.applyNetActivate(m);
        else if (m.e === 'sv') st.applyNetOther(m, find);
        else if (m.e === 'dr') st.applyNetDrones(m.l, find);
        else st.applyNetDroneEnd(m, find);
        return;
      }
      case 'sc':
        if (Number.isFinite(m.p)) G.events.emit('score', { actor: G.player, points: m.p, reason: m.r || 'kill', net: true });
        return;
      case 'md':
        if (m.id) G.events.emit('medal', { actor: G.player, id: m.id, label: m.label || m.id, tier: m.tier || 'bronze', net: true });
        return;
      default:
    }
  }

  /** Spielende vom Host: Ergebnis + eigene Zusammenfassung → Endbildschirm (main.endMatch über 'match:end'). */
  _onEnd(m) {
    const G = this.G;
    if (!m) return;
    if (m.aborted || !m.result || !this.active) {
      // Host hat das Match abgebrochen (zurück in den Raum) bzw. es endete, bevor wir fertig geladen hatten
      if (this.ended) return;
      this.ended = true;
      const st = G.match ? G.match.state : 'lobby';
      if (['loading', 'countdown', 'playing', 'paused'].includes(st)) {
        try { if (G.menus && G.menus.net && typeof G.menus.net.toast === 'function') G.menus.net.toast('Der Host hat das Match beendet – zurück im Raum.', 'info'); } catch { /* */ }
        if (G.menus && typeof G.menus.onQuit === 'function') G.menus.onQuit();
      }
      return;
    }
    if (this.ended) return;
    this.ended = true;
    const mode = G.mode;
    const result = { ...m.result, playerSummary: m.summary || null };
    if (mode) {
      if (this.modeState) this._applyMode(this.modeState);
      mode.result = result;
      mode.isOver = true;
      mode.endReason = result.reason || null;
    }
    G.events.emit('match:end', { result });
  }

  /** Panzerung des eigenen Spielers laut Host ([Westen-LP, Helm-LP, Reserveplatten]). */
  _applyArmor(ar) {
    const st = this.G.player && this.G.player.armor;
    if (!st || !Array.isArray(ar)) return;
    if (Number.isFinite(ar[0])) st.hp = Math.max(0, Math.min(st.maxHp, ar[0]));
    if (Number.isFinite(ar[1])) st.helmetHp = Math.max(0, Math.min(st.helmetMax, ar[1]));
    if (Number.isFinite(ar[2])) st.carry = Math.max(0, Math.min(st.carryMax, ar[2]));
  }

  /** Anti-Cheat des Hosts setzt den Spieler zurück. */
  _onCorrect(m) {
    const p = this.G.player;
    const pos = vec3(m && m.pos);
    if (!p || !pos || !p.body) return;
    p.body.teleport(pos);
    if (p.body.velocity) p.body.velocity.set(0, 0, 0);
    this._sendAt = 0; // sofort melden
  }

  /* ================================================================ Lokale Aktionen (combat/weapons) */

  /**
   * combat.damage auf dem Client: eigener Treffer auf eine Puppe → Treffermeldung + vorhergesagte Anzeige (Rückgabe =
   * erwarteter Schaden); eigener Sturz-/Weltschaden → Meldung an sich selbst; sonst 0 (Wirkung entscheidet der Host).
   */
  claimDamage(target, info = {}) {
    const G = this.G;
    const net = this.net;
    const p = G.player;
    if (!net.online || !this.active || this.ended || !target) return 0;
    const wid = info.weaponId;
    if (target === p) {
      if ((wid === 'fall' || wid === 'world') && !info.attacker) {
        const t = nowSec();
        if (t - this._envAt < ENV_GAP) return 0;
        this._envAt = t;
        net.send(HOST_ID, { t: 'hit', target: this.selfId, weapon: wid, dmg: rnd(Number(info.amount) || 0, 1), zone: 'body' });
      }
      return 0;
    }
    if (info.attacker !== p || !target.puppet || !Number.isInteger(target.netId) || info.explosive || info.burn) return 0;
    const def = WEAPONS[wid];
    const amount = Number(info.amount) || 0;
    if (!def || amount <= 0 || !target.alive) return 0;
    const point = info.point || target.position;
    // Darstellungsverzug (s): so weit zurück sah der Schütze das Ziel – der Host prüft den Zielverlauf entsprechend
    const vd = this.viewDelay();
    const ip = vd == null ? undefined : rnd(vd, 3);
    if (def.cls === 'melee') {
      net.send(HOST_ID, { t: 'melee', target: target.netId, weapon: def.id, serial: ++this._meleeSerial, dmg: rnd(amount, 1), ip });
    } else {
      const origin = info.origin || p.getEyePosition(_eye);
      net.send(HOST_ID, {
        t: 'hit', target: target.netId, zone: info.zone || 'body', dmg: rnd(amount, 2), weapon: def.id, dist: rnd(Number(info.distance) || 0, 2),
        origin: arr3(origin), point: arr3(point), serial: p._shotSerial | 0, pellet: info.pelletIndex | 0, ip,
      });
    }
    // Vorhergesagter Treffer: Trefferanzeige + Blut sofort; Lebenspunkte bleiben beim Host
    const dir = info.dir ? (info.dir.clone ? info.dir.clone() : info.dir) : null;
    G.events.emit('actor:hit', {
      target, attacker: p, amount, zone: info.zone || 'body', dir, point: info.point || null, weaponId: def.id, explosive: false,
      killed: false, armor: null, predicted: true,
    });
    return amount;
  }

  /** Eigener Granatenwurf (WeaponSystem.throwGrenade/explodeInHand): Meldung an den Host + Darstellungs-Granate. */
  localThrow(actor, type, opts = {}) {
    const G = this.G;
    const cid = ++this._cid;
    actor.getEyePosition(_eye);
    const dir = opts.dir ? _aim.copy(opts.dir).normalize() : actor.getAimDirection(_aim);
    this.net.send(HOST_ID, {
      t: 'throw', kind: 'grenade', type, origin: arr3(opts.origin || _eye, 3), dir: arr3(dir, 4), cook: rnd(Number(opts.cook) || 0, 2),
      drop: !!opts.drop, inHand: !!opts.inHand, cid,
    });
    if (opts.inHand || !G.weapons) return null;
    return G.weapons.grenadeSystem.throw(actor, type, { ...opts, remote: true, cid });
  }

  /** Klassen-Fähigkeit eingesetzt ('ability' {id}): der Host überträgt die Regeneration auf die Leben der Puppe. */
  sendAbility(id) {
    if (!this.active || this.ended || typeof id !== 'string') return;
    this.net.send(HOST_ID, { t: 'ability', id: id.slice(0, 24) });
  }

  /** Tür/Tor ('door' {i, a: t|k|h, d}): der Host schaltet bzw. verrechnet den Treffer und verteilt 'ev' dr. */
  sendDoor(i, a, d = 0) {
    if (!this.active || this.ended || !Number.isInteger(i)) return;
    this.net.send(HOST_ID, { t: 'door', i, a: a === 'k' || a === 'h' ? a : 't', d: Math.round(d) });
  }

  /** Bauwunsch ('build' {k, p, ry}): der Host prüft und verteilt das Bauwerk ('ev' bs). */
  sendBuild(k, p, ry) {
    if (!this.active || this.ended || typeof k !== 'string' || !p) return;
    const r2 = (v) => Math.round(v * 100) / 100;
    this.net.send(HOST_ID, { t: 'build', k: k.slice(0, 16), p: [r2(p.x), r2(p.y), r2(p.z)], ry: Math.round(ry * 1000) / 1000 });
  }

  /** Waffe von einer Leiche aufgehoben ('loot' {w, v}): der Host erlaubt sie danach für die Puppe (Anti-Cheat). */
  sendLoot(w, v) {
    if (!this.active || this.ended || typeof w !== 'string') return;
    this.net.send(HOST_ID, { t: 'loot', w: w.slice(0, 24), v: Number.isInteger(v) ? v : -1 });
  }

  /** Heilung an einem Kartenpunkt ('point' {i}, mappoints.js): der Host heilt die Puppe. */
  sendPoint(i) {
    if (!this.active || this.ended || !Number.isInteger(i)) return;
    this.net.send(HOST_ID, { t: 'point', i });
  }

  /** Serienprämie beim Host anfragen ('streak' {id, p, y, pi}) – Antwort kommt als 'ev' sa. */
  sendStreak(msg) {
    if (!this.active || this.ended || !msg || typeof msg.id !== 'string') return;
    this.net.send(HOST_ID, { ...msg, t: 'streak' });
  }

  /** Eigene FPV-Drohne an den Host ('drone' {a: 'p' Lage | 'x' Sprengung | 'e' Ende | 'h' Treffer auf eine Drohne, d, …}). */
  sendDrone(msg) {
    if (!this.active || !msg || typeof msg.a !== 'string') return;
    this.net.send(HOST_ID, { ...msg, t: 'drone' });
  }

  /** Eigener Raketenschuss (WeaponSystem.fireProjectile): Meldung an den Host + Darstellungs-Rakete. */
  localRocket(actor, def, origin, dir) {
    const G = this.G;
    const cid = ++this._cid;
    this.net.send(HOST_ID, { t: 'throw', kind: 'rocket', type: def.id, origin: arr3(origin, 3), dir: arr3(dir, 4), cid });
    if (!G.weapons) return null;
    return G.weapons.rocketSystem.fire(actor, def, origin, dir, 1, { remote: true, cid });
  }
}
