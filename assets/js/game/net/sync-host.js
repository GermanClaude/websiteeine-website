// NULLPUNKT – Mehrspieler: Synchronisation auf dem Host (Vertrag docs/planung/mehrspieler.md §2, §4, §5, §7, §8).
//
// Der Host simuliert das Match wie offline (Bots, Schaden, Modus, Respawns). Jeder Client ist hier eine Puppe
// (BotManager.spawnPuppet, isRemoteHuman) in G.actors – Bots greifen sie an wie jeden anderen Akteur, combat.damage, Modus
// und Punkte wirken unverändert. HostSync verbindet das mit dem Netz:
//   • Netz-Ids: Host-Spieler 1, Clients ihre Roster-Id, Bots ab 1000 (beim Spawn bzw. addBot vergeben).
//   • Clients: 'ready' → Puppe anlegen + einsetzen (Spielstart wie Einstieg ins laufende Spiel); Austritt/Kick → Puppe weg;
//     Bots je Team so auffüllen/abbauen, dass Bots + Menschen = teamSize (botFill).
//   • Eingang: PKT_STATE (Anti-Cheat checkState → puppet.netPose), 'hit'/'melee' (checkHit → combat.damage mit der Puppe als
//     Angreifer), 'throw' (echte Granate/Rakete aus der Puppe), 'loadout' (gilt ab dem nächsten Spawn), 'order' (Befehlsrad:
//     Befehl an die Bots seines Teams um seine Puppe, BotManager.issueOrder).
//   • Ausgang: PKT_SNAPSHOT 20 Hz mit allen Akteuren (auch der eigenen Puppe des Empfängers – Lebenspunkte), Ereignisse
//     'hit', 'kill', 'spawn', 'ev' (Granaten, Raketen, Explosionen, Punkte, Medaillen), 'mode' (mode.netState(), bei Änderung
//     und spätestens jede Sekunde), 'actors' (Akteursliste mit Namen/Team/Aussehen), 'end' je Client mit eigener Zusammenfassung.
//   • Positionsverlauf (G.net.history) jedes Bild für die Trefferprüfung.
//   • VR: Zustände eines VR-Clients tragen den VR-Zusatz (Kopf/Hände/Schussrichtung, protocol.js) → puppet.netPose.vr und
//     unverändert in die Schnappschüsse; der Host-Spieler in VR schickt seinen eigenen (sync-common vrPoseOf).
//   • Fahrzeuge (Raum-Einstellung „Fahrzeuge“, panzer-mp.md §C): G.vehicles.net (vehicles/net.js) – Liste bei Änderung,
//     Block-Anhang je Empfänger im Schnappschuss, Sitz-Absicht aus dem Zustand; eine sitzende Puppe prüft der Anti-Cheat
//     nicht (der Host heftet sie an den Sitz).
//   • Serienprämien (online nur die FPV-Drohne, modes/streaks.js): Fortschritt jedes Clients läuft hier (Puppe), der Client
//     bekommt ihn als 'ev' sk; Anfrage 'streak' {id, p, y, pi} → mode.streaks.activate (Host bestätigt) → 'ev' sa an ihn,
//     'ev' sv an alle anderen. Drohne eines Clients: 'drone' {a:'p'} Lage (geprüft: Weg-Budget, Reichweite), {a:'x'}
//     Sprengung (geprüft: aktiv, Akku, erreichbar, Reichweite → combat.explode mit der Puppe als Angreifer), {a:'e'} Ende,
//     {a:'h'} Treffer eines Clients auf eine Drohne (Waffe, Feuerrate, Reichweite, Sicht). Alle Drohnen gehen mit 12 Hz als
//     'ev' dr an alle, ihr Ende als 'ev' de.
import * as THREE from 'three';
import { WEAPONS, EQUIPMENT } from '../../shared/weapons.data.js';
import { ABILITIES } from '../../shared/classes.data.js';
import { MOUNT_WEAPON } from '../mappoints.js';
import { netPoseOf } from '../bots/bot.js';
import { PKT_STATE, decodeState, encodeSnapshot, packetType, FLAGS } from './protocol.js';
import { HOST_ID, FIRST_BOT_ID, sanitizeLoadout, loadoutWeapons } from './index.js';
import { SNAPSHOT_HZ, MODE_MIN_GAP, MODE_MAX_GAP, rnd, arr3, vec3, dist3, loadoutOf, identityOf, vrPoseOf, newVrPose } from './sync-common.js';

const nowSec = () => performance.now() / 1000;
const DOWN = new THREE.Vector3(0, -1, 0);
const _eye = new THREE.Vector3();
const _v = new THREE.Vector3();
/** Panzerungszustand für den Client: [Westen-LP, Helm-LP, Reserveplatten]. */
const armorOf = (a) => [rnd(a.armor.hp, 1), rnd(a.armor.helmetHp, 1), a.armor.carry | 0];
const THROW_GAP = 0.3; // s zwischen zwei Würfen eines Clients
const ORDER_GAP = 0.4; // s zwischen zwei Befehlen eines Clients (Befehlsrad)
const STREAK_GAP = 0.5; // s zwischen zwei Prämien-Anfragen eines Clients
const DRONE_HZ = 12; // Weitergabe der Drohnenlagen ('ev' dr)
const ENV_GAP = 0.4; // s zwischen zwei Sturz-/Weltmeldungen
const HOLD_MAX = 30; // s: so lange hält der Host den Wiedereinstieg eines Clients höchstens an (Ausrüsten)
const EXTRAPOLATE_OWN = 0.05; // s: Puppe eines Clients zwischen zwei Zuständen höchstens so weit fortschreiben
// Interessenfilter der Schnappschüsse (je Empfänger): Akteure weiter als FAR_DIST vom eigenen Körper und Tote nur jeden
// FAR_EVERY-ten Takt (20 Hz → 5 Hz, je Akteur versetzt); der eigene Eintrag immer. Erst ab INTEREST_MIN Akteuren.
const FAR_DIST = 60;
const FAR_EVERY = 4;
const INTEREST_MIN = 12;

export class HostSync {
  /**
   * @param {object} G
   * @param {import('./index.js').NetSystem} net
   * @param {object} cfg cfg.net des Matches (role 'host', teamSize, botFill, pvp, ffa …)
   */
  constructor(G, net, cfg = {}) {
    this.G = G;
    this.net = net;
    this.role = 'host';
    this.cfg = cfg || {};
    this.roomCode = this.cfg.roomCode || null;
    this.active = false;
    this.ended = false;
    this._nextBotId = FIRST_BOT_ID;
    this._ready = new Set(); // Clients mit Welt geladen (bekommen Schnappschüsse)
    this._pendingReady = new Set(); // 'ready' vor dem eigenen Matchstart
    this._lastThrow = new Map();
    this._lastOrder = new Map();
    this._lastStreak = new Map();
    this._abilityAt = new Map(); // Client → nächste erlaubte Klassen-Fähigkeit (Echtzeit)
    this._regens = new Map(); // Client → {until, rate}: Regeneration der Puppe (Klassen-Fähigkeit)
    this._droneAt = 0;
    this._lastEnv = new Map();
    this._hitSerial = new Map(); // Client → letzte Schussnummer mit Treffer (Trefferstatistik)
    this._holds = new Map(); // Client → {pause, since}: Wiedereinstieg angehalten (Ausrüsten im Todesbildschirm)
    this._lastDir = new WeakMap(); // Opfer → Richtung des letzten Treffers (Ragdoll auf den Clients)
    this._snapAt = 0;
    this._tick = 0;
    this._modeAt = 0;
    this._modeKey = '';
    this._actorsKey = '';
    this._actorsDirty = true;
    this._rebalanceAt = 0;
    this._pose = {};
    this._scope = null;
    /** Interessenfilter an (Prüfläufe: ?netinterest=0 schaltet ihn ab – Vergleichsmessung). */
    this.interest = !(G.params && typeof G.params.get === 'function' && G.params.get('netinterest') === '0');
    this.snapStats = { sent: 0, bytes: 0, ents: 0, full: 0 };
    this._offs = [
      net.on('ready', (m, from) => this._onReady(from)),
      net.on('loadout', (m, from) => this._onLoadout(m, from)),
      net.on('hit', (m, from) => this._onHit(m, from)),
      net.on('melee', (m, from) => this._onMelee(m, from)),
      net.on('throw', (m, from) => this._onThrow(m, from)),
      net.on('plate', (m, from) => this._onPlate(m, from)),
      net.on('hold', (m, from) => this._onHold(m, from)),
      net.on('order', (m, from) => this._onOrder(m, from)),
      net.on('streak', (m, from) => this._onStreak(m, from)),
      net.on('ability', (m, from) => this._onAbility(m, from)),
      net.on('loot', (m, from) => this._onLoot(m, from)),
      net.on('door', (m, from) => { const p = this._puppet(from); if (this.active && !this.ended && p && this.G.doors) this.G.doors.netRequest(p, m); }),
      net.on('build', (m, from) => { const p = this._puppet(from); if (this.active && !this.ended && p && this.G.building) this.G.building.netRequest(p, m); }),
      net.on('point', (m, from) => { const p = this._puppet(from); if (this.active && !this.ended && p && m && this.G.points) this.G.points.netUse(p, m.i, from); }),
      net.on('drone', (m, from) => this._onDrone(m, from)),
      net.onFast((buf, from) => this._onFast(buf, from)),
    ];
    if (G.events) {
      this._offs.push(G.events.on('net:peer', (e) => { if (e && e.joined === false) this._drop(e.id); }));
      this._offs.push(G.events.on('net:roster', () => { this._rebalanceAt = 0; this._actorsDirty = true; }));
    }
  }

  /* ================================================================ Lebenszyklus */

  /** main.js (über NetSystem.onMatchStart): Welt + Akteure stehen, vor dem Countdown. */
  onMatchStart() {
    const G = this.G;
    this.active = true;
    this.ended = false;
    G.player.netId = HOST_ID;
    for (const b of G.bots.bots) if (!Number.isInteger(b.netId)) b.netId = this._nextBotId++;
    this._subscribe();
    // Clients, die schon bereit sind (schneller geladen als der Host)
    for (const r of this.net.roster) if (r.id !== HOST_ID && r.ready) this._pendingReady.add(r.id);
    for (const id of [...this._pendingReady]) this._admit(id);
    this._pendingReady.clear();
    this._actorsDirty = true;
  }

  /** Spielende (main.endMatch → NetSystem.onMatchEnd): jedem Client Ergebnis + eigene Zusammenfassung. */
  onMatchEnd(result) {
    if (!this.active || this.ended) return;
    this.ended = true;
    this._sendMode(true);
    const G = this.G;
    const mode = G.mode;
    for (const r of this.net.roster) {
      if (r.id === HOST_ID) continue;
      const p = this._puppet(r.id);
      let res = null;
      try { res = p && mode && typeof mode.resultFor === 'function' ? mode.resultFor(p, result) : null; } catch (err) { console.error('[net] Ergebnis für Client', err); }
      if (!res) { this.net.send(r.id, { t: 'end', aborted: true, result: null, summary: null }); continue; } // noch nicht im Match
      const summary = res.playerSummary || null;
      delete res.playerSummary;
      this.net.send(r.id, { t: 'end', result: res, summary });
    }
  }

  /** Match wird abgebaut (Lobby, Revanche): laufendes Match → Clients zurück in den Raum ('end' aborted). */
  onTeardown() {
    if (this.active && !this.ended && this.net.online) this.net.send('all', { t: 'end', aborted: true, result: null, summary: null });
    this.active = false;
    this._unsubscribe();
    this._ready.clear();
    this._pendingReady.clear();
    this._holds.clear();
  }

  dispose() {
    this.onTeardown();
    for (const off of this._offs) { try { off(); } catch { /* */ } }
    this._offs = [];
  }

  _subscribe() {
    const G = this.G;
    this._unsubscribe();
    const s = (this._scope = G.events.scope());
    s.on('actor:hit', (e) => this._relayHit(e));
    s.on('kill', (e) => this._relayKill(e));
    s.on('team:change', () => { this._actorsDirty = true; }); // Infiziert: neues Team an alle (identityOf.t)
    s.on('actor:spawn', (e) => this._relaySpawn(e));
    s.on('explosion', (e) => this._relayExplosion(e));
    s.on('grenade:throw', (e) => this._relayGrenade(e));
    s.on('grenade:explode', (e) => this._relayGrenadeBoom(e));
    s.on('projectile:launch', (e) => this._relayRocket(e));
    s.on('projectile:detonate', (e) => this._relayRocketEnd(e, false));
    s.on('projectile:dud', (e) => this._relayRocketEnd(e, true));
    s.on('score', (e) => { if (e && e.actor && e.actor.isRemoteHuman) this._toActor(e.actor, { t: 'ev', e: 'sc', p: e.points, r: e.reason }); });
    s.on('medal', (e) => { if (e && e.actor && e.actor.isRemoteHuman) this._toActor(e.actor, { t: 'ev', e: 'md', id: e.id, label: e.label, tier: e.tier }); });
    s.on('actor:remove', () => { this._actorsDirty = true; });
    // Panzerung (Großkarten): Reserveplatte nach Abschuss an den betroffenen Client
    s.on('armor:pickup', (e) => { if (e && e.actor && e.actor.isRemoteHuman && e.actor.armor) this._toActor(e.actor, { t: 'ev', e: 'ap', ar: armorOf(e.actor) }); });
    s.on('armor:plate', (e) => { if (e && e.actor && e.actor.isRemoteHuman && e.phase === 'end' && e.actor.armor) this._toActor(e.actor, { t: 'ev', e: 'ap', ar: armorOf(e.actor) }); });
    // Serienprämien (FPV-Drohne): Fortschritt an den Client, Einsatz/Ende an alle
    s.on('streak:progress', (e) => this._sendStreakState(e && e.actor));
    s.on('streak:ready', (e) => this._sendStreakState(e && e.actor));
    s.on('streak:activate', (e) => this._relayStreak(e));
    s.on('drone:end', (e) => this._relayDroneEnd(e));
  }

  _unsubscribe() {
    if (this._scope) this._scope.dispose();
    this._scope = null;
  }

  /* ================================================================ Bild */

  preUpdate() {
    // Zustände der Clients werden bei Ankunft übernommen (_onFast); hier die Bot-Netz-Ids nachziehen (addBot von außen) und
    // die Puppen der Clients zwischen zwei Zuständen kurz fortschreiben (30 Hz-Zustände, Ankunft schwankt – sonst ruckeln
    // sie im Bild des Hosts und in den Schnappschüssen): höchstens EXTRAPOLATE_OWN s mit der gemeldeten Geschwindigkeit
    if (!this.active) return;
    const G = this.G;
    const now = nowSec();
    this._frameAt = now; // Bildbeginn: danach eintreffende Zustände wissen, wie lange der Host hing (Anti-Cheat-Bündel)
    for (const b of G.bots.bots) {
      if (!Number.isInteger(b.netId) && !b.isRemoteHuman) { b.netId = this._nextBotId++; this._actorsDirty = true; }
      const raw = b._ownRaw;
      if (!raw || b.netPose !== b._ownPose || !b.alive) continue;
      const age = Math.min(EXTRAPOLATE_OWN, Math.max(0, now - b._ownAt));
      const np = b._ownPose;
      np.pos[0] = raw.pos[0] + raw.vel[0] * age;
      np.pos[1] = raw.pos[1] + ((raw.flags & FLAGS.ON_GROUND) ? 0 : raw.vel[1] * age);
      np.pos[2] = raw.pos[2] + raw.vel[2] * age;
    }
  }

  postUpdate() {
    if (!this.active || !this.net.online) return;
    const G = this.G;
    const net = this.net;
    const t = net.serverTime();
    // Positionsverlauf für die Trefferprüfung (Anti-Cheat)
    if (net.history) for (const a of G.actors) if (Number.isInteger(a.netId) && a.position) net.history.record(a.netId, t, a.position.x, a.position.y, a.position.z);
    const now = nowSec();
    if (this._holds.size) this._tickHolds(now);
    if (this._regens.size) this._tickRegens();
    if (now >= this._rebalanceAt) { this._rebalanceAt = now + 2; this._rebalance(); }
    if (this._actorsDirty) this._sendActors();
    const vn = this._vn();
    if (vn) vn.hostTick();
    this._sendMode(false);
    this._relayDrones(now);
    if (now - this._snapAt >= 1 / SNAPSHOT_HZ - 0.002 && this._ready.size) {
      this._snapAt = now;
      this._sendSnapshot(t);
    }
  }

  /** Fahrzeug-Vermittler des Hosts (vehicles/net.js) oder null (keine Fahrzeuge in diesem Match). */
  _vn() {
    const V = this.G.vehicles;
    return V && V.attached && V.net && V.net.host ? V.net : null;
  }

  _sendSnapshot(t) {
    const G = this.G;
    const ents = [];
    const p = this._pose;
    const vrSelf = this._vrSelf || (this._vrSelf = newVrPose());
    for (const a of G.actors) {
      if (!Number.isInteger(a.netId)) continue;
      netPoseOf(a, p);
      ents.push({
        id: a.netId, x: p.pos[0], y: p.pos[1], z: p.pos[2], yaw: p.yaw, pitch: p.pitch, vx: p.vel[0], vy: p.vel[1], vz: p.vel[2],
        flags: p.flags, weapon: p.weapon, hp: Math.max(0, Math.min(255, Math.round(p.hp))), lean: p.lean, shots: p.shots, proneBlend: p.proneBlend,
        // VR-Körpersprache: Host-Spieler in VR bzw. weitergereicht vom VR-Client (Puppe); sonst null (kein Zusatzblock)
        vr: vrPoseOf(G, a, vrSelf),
      });
    }
    const tick = ++this._tick;
    const st = this.snapStats;
    // Fahrzeugblöcke (einmal je Takt gebaut; Rate je Empfänger unabhängig von INTEREST_MIN – vehicles/net.js blocksFor)
    const vn = this._vn();
    const vall = vn ? vn.blocks(tick) : null;
    if (!this.interest || (ents.length < INTEREST_MIN && !vall)) {
      const buf = encodeSnapshot(tick, t, ents, vall);
      const vb = vall ? 2 + vall.length * 60 : 0;
      for (const id of this._ready) if (this.net.sendFast(id, buf)) { st.sent++; st.bytes += buf.byteLength; st.ents += ents.length; st.full++; st.vbytes = (st.vbytes || 0) + vb; }
      return;
    }
    // Interessenfilter je Empfänger: nah + eigener Eintrag jeden Takt, fern/tot nur im eigenen Fünftel-Takt
    const far2 = FAR_DIST * FAR_DIST;
    const list = [];
    const filter = ents.length >= INTEREST_MIN;
    for (const id of this._ready) {
      const me = this._puppet(id);
      const mp = me && me.position;
      list.length = 0;
      for (const e of ents) {
        if (!filter || e.id === id || !mp || (tick + e.id) % FAR_EVERY === 0) { list.push(e); continue; }
        if ((e.flags & FLAGS.ALIVE) === 0) continue;
        const dx = e.x - mp.x, dz = e.z - mp.z;
        if (dx * dx + dz * dz <= far2) list.push(e);
      }
      const vl = vall ? vn.blocksFor(id, me, tick, vall, this.interest) : null;
      const buf = encodeSnapshot(tick, t, list, vl);
      if (this.net.sendFast(id, buf)) {
        st.sent++; st.bytes += buf.byteLength; st.ents += list.length; if (list.length === ents.length) st.full++;
        if (vl) { st.vbytes = (st.vbytes || 0) + 2 + vl.length * 60; st.vblocks = (st.vblocks || 0) + vl.length; }
      }
    }
  }

  _sendMode(force) {
    const G = this.G;
    const mode = G.mode;
    if (!mode || typeof mode.netState !== 'function') return;
    const now = nowSec();
    const gap = now - this._modeAt;
    if (!force && gap < MODE_MIN_GAP) return;
    let s;
    try { s = mode.netState(); } catch (err) { this.net._logOnce && this.net._logOnce('mode.netState', err); return; }
    const key = JSON.stringify({ ...s, tl: 0 });
    if (!force && key === this._modeKey && gap < MODE_MAX_GAP) return;
    this._modeKey = key;
    this._modeAt = now;
    this.net.send('all', { t: 'mode', s, st: rnd(this.net.serverTime(), 3) });
  }

  _sendActors(to = null) {
    const G = this.G;
    const list = [];
    for (const a of G.actors) if (Number.isInteger(a.netId) && !a.isStreakEntity) list.push(identityOf(a));
    const key = JSON.stringify(list);
    if (to != null) { this.net.send(to, { t: 'actors', list }); return; }
    this._actorsDirty = false;
    if (key === this._actorsKey) return;
    this._actorsKey = key;
    this.net.send('all', { t: 'actors', list });
  }

  /* ================================================================ Clients im Match */

  _puppet(id) {
    const b = this.G.bots && this.G.bots.byNetId(id);
    return b && b.isRemoteHuman ? b : null;
  }

  _toActor(actor, msg) {
    if (actor && Number.isInteger(actor.netId) && actor.netId !== HOST_ID) this.net.send(actor.netId, msg);
  }

  _onReady(from) {
    if (from === HOST_ID) return;
    if (!this.active) { this._pendingReady.add(from); return; }
    this._admit(from);
  }

  /** Client hat geladen: Puppe anlegen und einsetzen, Akteursliste + Modus schicken, Bots ausgleichen. */
  _admit(id) {
    const G = this.G;
    const entry = this.net.rosterEntry(id);
    if (!entry || this.ended) return;
    let p = this._puppet(id);
    if (!p) {
      const ffa = !!(this.cfg.ffa || (G.match && G.match.ffa));
      p = G.bots.spawnPuppet({
        netId: id, name: entry.name, team: ffa ? null : entry.team === 'B' ? 'B' : 'A', cls: entry.cls,
        loadout: entry.loadout || null, isHuman: true,
      });
      p.respawnAt = null;
      this._actorsDirty = true;
    }
    this._ready.add(id);
    this._sendActors(id);
    this._sendActors();
    const vn = this._vn();
    if (vn) vn.onAdmit(id); // volle Fahrzeugliste + 1 s alle Blöcke
    this._rebalance();
    if (!p.alive && p.respawnAt == null) G.spawnActor(p);
    this._modeKey = '';
    this._sendMode(true);
    this._sendStreakState(p);
    // Bauwerke (building.js) des laufenden Matches nachreichen
    if (G.building) for (const b of G.building.snapshot()) this.net.send(id, { t: 'ev', e: 'bs', ...b });
    if (G.doors) for (const d of G.doors.snapshot()) this.net.send(id, { t: 'ev', e: 'dr', ...d }); // Türen/Tore (doors.js)
  }

  /** Bauwerk an alle Clients ('ev' bs, building.js spawn). */
  relayBuild(msg) { if (this.active && this.net.online) this.net.send('all', { t: 'ev', e: 'bs', ...msg }); }

  /** Tür/Tor geändert ('ev' dr, doors.js). */
  relayDoor(msg) { if (this.active && this.net.online) this.net.send('all', { t: 'ev', e: 'dr', ...msg }); }

  /** Bauwerk entfernt/zerstört ('ev' bd). */
  relayBuildEnd(id) { if (this.active && this.net.online) this.net.send('all', { t: 'ev', e: 'bd', id }); }

  /** Mensch hat den Raum verlassen (Austritt, Kick, Verbindungsabbruch): Puppe entfernen, Bots ausgleichen. */
  _drop(id) {
    this._ready.delete(id);
    this._holds.delete(id);
    this._pendingReady.delete(id);
    this._lastThrow.delete(id);
    this._lastOrder.delete(id);
    this._lastStreak.delete(id);
    this._lastEnv.delete(id);
    this._hitSerial.delete(id);
    const vn = this._vn();
    if (vn) vn.onDrop(id);
    if (!this.active) return;
    const p = this._puppet(id);
    if (p) {
      this.G.bots.removeBot(p);
      this._actorsDirty = true;
    }
    this._rebalance();
  }

  _onLoadout(m, from) {
    const p = this._puppet(from);
    if (!p) return;
    const lo = sanitizeLoadout(m && m.loadout) || {};
    if (m && typeof m.cls === 'string') lo.cls = m.cls;
    if (!lo.primary && !lo.secondary && !lo.cls) return;
    // Kurz nach dem Spawn (noch nicht geschossen) gilt sie sofort – wie beim Spieler (main.requestLoadout), sonst ab dem nächsten Spawn
    const fresh = p.alive && this.G.time.elapsed - (p.spawnTime || 0) <= 6;
    if (fresh) { p.setNetLoadout(lo); this._actorsDirty = true; } else p.pendingNetLoadout = lo;
  }

  /**
   * Wiedereinstieg anhalten/freigeben ('hold' {on, p}): der Client hat „Ausrüsten“ im Todesbildschirm offen (p = Restzeit
   * steht still) bzw. drückt „Einsatz“ (on = false → Einsatz, sobald die Wartezeit um ist). Wie offline über
   * mode.holdRespawn; höchstens HOLD_MAX s.
   */
  _onHold(m, from) {
    const G = this.G;
    const p = this._puppet(from);
    if (!this.active || this.ended || !p || !G.mode || typeof G.mode.holdRespawn !== 'function') return;
    if (m && m.on && !p.alive) {
      if (!this._holds.has(from)) this._holds.set(from, { pause: m.p !== false, since: nowSec() });
      else this._holds.get(from).pause = m.p !== false;
      G.mode.holdRespawn(p, true);
    } else if (this._holds.delete(from)) G.mode.holdRespawn(p, false);
  }

  _tickHolds(now) {
    const G = this.G;
    for (const [id, h] of this._holds) {
      const p = this._puppet(id);
      const over = now - h.since > HOLD_MAX;
      if (!p || p.alive || over) {
        this._holds.delete(id);
        if (p && G.mode && typeof G.mode.holdRespawn === 'function') G.mode.holdRespawn(p, false);
        continue;
      }
      if (h.pause && p.respawnAt != null) p.respawnAt += G.time.dt; // Restzeit steht still (wie der Spieler offline)
    }
  }

  /** main.spawnActor: vorgemerkte Ausrüstung eines Menschen übernehmen. */
  beforeSpawn(actor) {
    if (actor && actor.isRemoteHuman && this._holds.delete(actor.netId) && this.G.mode) this.G.mode.holdRespawn(actor, false);
    if (actor && actor.isRemoteHuman && actor.pendingNetLoadout) {
      actor.setNetLoadout(actor.pendingNetLoadout);
      actor.pendingNetLoadout = null;
      this._actorsDirty = true;
    }
  }

  /**
   * Bots je Team so auffüllen bzw. abbauen, dass Bots + Menschen = teamSize (botFill; Koop: Team B nur Bots; FFA: insgesamt
   * 2 × teamSize). Menschen = Roster (auch noch ladende). Abgebaut werden zuerst tote Bots.
   */
  _rebalance() {
    const G = this.G;
    if (!this.active || this.ended || !G.bots || !G.mode || !this.net.online) return;
    const c = this.cfg;
    const size = Math.max(1, c.teamSize | 0 || 6);
    const fill = c.botFill !== false;
    const roster = this.net.roster;
    const ffa = !!(c.ffa || (G.match && G.match.ffa));
    // Teamwechsel-Modi (Infiziert): nur die Gesamtzahl auffüllen – die Teams verwaltet der Modus (neue Bots: Überlebende)
    if (G.mode.netTeamShift) {
      const total = fill ? Math.max(2 * size, roster.length) : roster.length;
      const bots = G.bots.bots.filter((b) => !b.isRemoteHuman);
      let extra = bots.length - Math.max(0, total - roster.length);
      if (extra > 0) {
        const order = [...bots].sort((x, y) => (x.alive ? 1 : 0) - (y.alive ? 1 : 0) || (x.team === 'B' ? 1 : 0) - (y.team === 'B' ? 1 : 0));
        for (const b of order) { if (extra <= 0) break; G.bots.removeBot(b); extra--; this._actorsDirty = true; }
      } else if (extra < 0 && !G.mode.started) {
        for (let i = 0; i < -extra; i++) {
          const b = G.bots.addBot({ team: 'A' });
          if (!b) break;
          b.netId = this._nextBotId++;
          this._actorsDirty = true;
          this._sendActors();
          G.spawnActor(b);
        }
      }
      return;
    }
    const want = new Map();
    if (ffa) want.set(null, fill ? Math.max(0, 2 * size - roster.length) : 0);
    else if (c.pvp === 'coop') { want.set('A', fill ? Math.max(0, size - roster.length) : 0); want.set('B', size); }
    else {
      let a = 0, b = 0;
      for (const r of roster) { if (r.team === 'B') b++; else a++; }
      want.set('A', fill ? Math.max(0, size - a) : 0);
      want.set('B', fill ? Math.max(0, size - b) : 0);
    }
    let changed = false;
    for (const [team, n] of want) {
      const bots = G.bots.bots.filter((b) => !b.isRemoteHuman && (ffa ? true : b.team === team));
      let extra = bots.length - n;
      if (extra > 0) {
        const order = [...bots].sort((x, y) => (x.alive ? 1 : 0) - (y.alive ? 1 : 0));
        for (const b of order) { if (extra <= 0) break; G.bots.removeBot(b); extra--; changed = true; }
      } else if (extra < 0) {
        for (let i = 0; i < -extra; i++) {
          const b = G.bots.addBot({ team: ffa ? null : team });
          if (!b) break;
          b.netId = this._nextBotId++;
          changed = true;
          this._actorsDirty = true;
          this._sendActors(); // Identität vor dem 'spawn' bei den Clients
          G.spawnActor(b);
        }
      }
    }
    if (changed) {
      this._actorsDirty = true;
      // Respawn-Ausgleich des Modus (kleineres Team kommt schneller zurück) auf die neue Besetzung
      const ts = G.mode._teamSize;
      if (ts) { ts.A = 0; ts.B = 0; for (const a of G.actors) if (a.team === 'A' || a.team === 'B') ts[a.team] += 1; }
    }
  }

  /* ================================================================ Eingang */

  _onFast(buf, from) {
    if (!this.active || packetType(buf) !== PKT_STATE) return;
    const p = this._puppet(from);
    if (!p) return;
    const d = decodeState(buf);
    if (!d) return;
    // veraltete (überholte) Pakete verwerfen
    if (p._netSeq != null && ((d.seq - p._netSeq) | 0) <= 0) return;
    p._netSeq = d.seq;
    const e = d.entity;
    const clientAlive = (e.flags & FLAGS.ALIVE) !== 0;
    // Fahrzeug: Sitz-Absicht übernehmen (nur wenn die Puppe dort sitzt); sitzend prüft der Anti-Cheat die Lage nicht –
    // der Host heftet die Puppe an den Sitz (Aussteigen setzt den Anker neu: vehicles/net.js 'vo')
    if (p.vehicle) {
      const vn = this._vn();
      if (vn && e.veh) vn.applyInput(p, e.veh);
    }
    // Anker nur bei Tod der Puppe neu setzen – meldet der Client „tot“, während sie lebt (Spawn unterwegs), bleibt er
    const r = p.vehicle ? { ok: true, reason: 'fahrzeug' } : this.net.checkState(from, { x: e.x, y: e.y, z: e.z, flags: e.flags }, {
      alive: p.alive, clientAlive, rtt: this.net.peerRtt(from) / 1000, hostGap: this._frameAt != null ? nowSec() - this._frameAt : 0, ct: d.clientTime,
      carry: this._carrySpeed(p),
    });
    if (!p.alive || !clientAlive || !r || !r.ok) return; // Rücksetzung/veraltet: Puppe bleibt an der letzten gültigen Stelle
    const np = p._ownPose || (p._ownPose = { pos: [0, 0, 0], vel: [0, 0, 0] });
    const raw = p._ownRaw || (p._ownRaw = { pos: [0, 0, 0], vel: [0, 0, 0], flags: 0 });
    raw.pos[0] = np.pos[0] = e.x; raw.pos[1] = np.pos[1] = e.y; raw.pos[2] = np.pos[2] = e.z;
    raw.vel[0] = np.vel[0] = e.vx; raw.vel[1] = np.vel[1] = e.vy; raw.vel[2] = np.vel[2] = e.vz;
    raw.flags = e.flags;
    p._ownAt = nowSec();
    np.yaw = e.yaw; np.pitch = e.pitch; np.flags = e.flags;
    np.weapon = e.weaponId || null; np.lean = e.lean; np.shots = e.shots; np.proneBlend = e.proneBlend;
    // VR-Zusatz (rein darstellend, durch die Kodierung begrenzt: Hände ≤ 1,27 m vom Kopf) – geht so an alle Clients weiter
    np.vr = e.vr || null;
    p.netPose = np;
  }

  /**
   * Zusatztempo auf/neben fahrenden Fahrzeugen (Deck, ≤ 4 m von der Wanne): Fahrzeugtempo (m/s) – wer mitfährt, bewegt
   * sich schneller als zu Fuß (Anti-Cheat ctx.carry). 0 ohne Fahrzeuge.
   */
  _carrySpeed(p) {
    const V = this.G.vehicles;
    if (!V || !V.attached || !V.list.length || !p.position) return 0;
    let best = 0;
    for (const v of V.list) {
      const sp = v.body.vel.length();
      if (sp < 0.5 || sp <= best) continue;
      if (v.body.pos.distanceToSquared(p.position) > 100) continue;
      if (typeof V._boxDistance === 'function' && V._boxDistance(v, p.position, 0.9) > 4) continue;
      best = sp;
    }
    return best;
  }

  /** Waffen, die der Mensch hinter der Puppe tragen darf (Roster, gemeldete/aktuelle Ausrüstung, Messer). */
  _weaponsOf(p, id) {
    const out = new Set(['knife']);
    const add = (lo) => { for (const k of ['primary', 'secondary', 'melee', 'launcher']) if (lo && typeof lo[k] === 'string' && WEAPONS[lo[k]]) out.add(lo[k]); };
    add(p.loadout);
    add(p.pendingNetLoadout);
    const lw = loadoutWeapons(this.net.rosterEntry(id) && this.net.rosterEntry(id).loadout);
    if (lw) for (const w of lw) out.add(w);
    if (p.weapon && Array.isArray(p.weapon.slots)) for (const s of p.weapon.slots) if (s && s.id) out.add(s.id);
    if (p._lootWeapons) for (const w of p._lootWeapons) out.add(w); // von Leichen aufgehoben (_onLoot)
    // an einer MG-Stellung (mappoints.js mount): deren Waffe
    const em = this.G.world && this.G.world.emplacements;
    if (em && p.position && em.some((e) => Math.hypot(e.x - p.position.x, e.z - p.position.z) < 3)) out.add(MOUNT_WEAPON);
    for (const id2 of Object.keys(WEAPONS)) if (WEAPONS[id2].cls === 'melee') out.add(id2); // Nahkampfwaffe gehört zur Klasse
    // Modus-Ausrüstung mit Übergang (Waffenspiel: Nachbarstufen, solange der Client die neue Stufe noch nicht hat)
    const mode = this.G.mode;
    if (mode && typeof mode.netWeaponsOf === 'function') { try { for (const w of mode.netWeaponsOf(p)) if (WEAPONS[w]) out.add(w); } catch { /* */ } }
    return [...out];
  }

  _shooterPos(p) {
    const raw = p._ownRaw;
    if (raw && p.netPose === p._ownPose && nowSec() - (p._ownAt || 0) < 1) return raw.pos.slice();
    return [p.position.x, p.position.y, p.position.z];
  }

  _ctxFor(p, from, target, m = null) {
    const G = this.G;
    const W = G.world;
    return {
      // Darstellungsverzug des Schützen (Interpolation + Laufzeit der Schnappschüsse), sonst Standard der Prüfung
      interp: m && Number.isFinite(m.ip) ? Math.max(0, Math.min(1, m.ip)) : undefined,
      // Schützenposition: zuletzt gemeldeter Zustand (die Puppe übernimmt ihn erst im nächsten Bild – bei langsamen Hosts
      // läge der Körper sonst ein ganzes Bild zurück), sonst der Körper
      shooter: { alive: p.alive, team: p.team, pos: this._shooterPos(p), weapons: this._weaponsOf(p, from) },
      target: { alive: target.alive, team: target.team, pos: [target.position.x, target.position.y, target.position.z] },
      los: W && typeof W.lineOfSight === 'function' ? (o, q) => W.lineOfSight(_eye.set(o[0], o[1], o[2]), _v.set(q[0], q[1], q[2])) : undefined,
    };
  }

  /** Treffermeldung eines Clients ('hit'): prüfen (Anti-Cheat) und Schaden mit der Puppe als Angreifer anwenden. */
  _onHit(m, from) {
    const G = this.G;
    if (!this.active || this.ended || !m) return;
    const p = this._puppet(from);
    if (!p) return;
    const tid = Number(m.target);
    // Eigener Umweltschaden (Sturz, außerhalb der Karte) – der Client meldet ihn an sich selbst
    if ((m.weapon === 'fall' || m.weapon === 'world') && tid === from) {
      if (!p.alive) return;
      const t = nowSec();
      if (t - (this._lastEnv.get(from) || 0) < ENV_GAP) return;
      this._lastEnv.set(from, t);
      const amount = m.weapon === 'world' ? 9999 : Math.max(0, Math.min(300, Number(m.dmg) || 0));
      if (amount > 0) G.combat.damage(p, { amount, attacker: null, weaponId: m.weapon, zone: 'body', dir: DOWN.clone() });
      return;
    }
    const target = this.net.actorById(tid);
    if (!target || target === p) return;
    const r = this.net.checkHit(from, m, this._ctxFor(p, from, target, m));
    if (!r || !r.ok || !(r.dmg > 0)) return;
    const def = WEAPONS[m.weapon];
    // Treffer je Schuss einmal zählen (Schrot) – wie combat.fireHitscan
    if (p.stats && Number.isFinite(m.serial) && this._hitSerial.get(from) !== m.serial) {
      this._hitSerial.set(from, m.serial);
      p.stats.shotsHit = (p.stats.shotsHit || 0) + 1;
      if (def) { const ws = p.weaponStats || (p.weaponStats = {}); const w = ws[def.id] || (ws[def.id] = { kills: 0, shots: 0, hits: 0, headshots: 0 }); w.hits += 1; }
    }
    const origin = vec3(m.origin);
    const point = vec3(m.point) || target.position.clone().setY(target.position.y + 1.2);
    const dir = origin ? point.clone().sub(origin).normalize() : null;
    const zone = m.zone === 'head' || m.zone === 'limb' ? m.zone : 'body';
    G.combat.damage(target, {
      amount: r.dmg, attacker: p, weaponId: def ? def.id : null, zone, dir, point,
      distance: Number.isFinite(m.dist) ? m.dist : origin ? origin.distanceTo(point) : 0, pelletIndex: m.pellet | 0,
    });
  }

  /** Nahkampfmeldung ('melee'): Reichweite/Waffe prüfen, Schaden anwenden. */
  _onMelee(m, from) {
    const G = this.G;
    if (!this.active || this.ended || !m) return;
    const p = this._puppet(from);
    const target = this.net.actorById(Number(m.target));
    if (!p || !target || target === p) return;
    const ctx = this._ctxFor(p, from, target, m);
    // Cheat-Menü „Messer ohne Abklingzeit“: bei erlaubtem Menü (Raum-Einstellung) und gemeldetem Cheat keine Feuerrate
    const room = this.net.room && this.net.room.settings;
    const entry = this.net.rosterEntry(from);
    if (!(room && room.cheatMenu === false) && entry && entry.cheat === true) { ctx.noRate = true; ctx.meleeReach = 2.6; }
    const r = this.net.checkHit(from, { ...m, t: 'melee' }, ctx);
    if (!r || !r.ok || !(r.dmg > 0)) return;
    p.getEyePosition(_eye);
    const point = target.position.clone();
    point.y += (target.body ? target.body.height : 1.8) * 0.62;
    const dir = point.clone().sub(_eye).normalize();
    const wid = WEAPONS[m.weapon] ? m.weapon : 'knife';
    const dealt = G.combat.damage(target, { amount: r.dmg, attacker: p, weaponId: wid, zone: 'body', dir, point, distance: point.distanceTo(_eye) });
    G.events.emit('weapon:meleeHit', { actor: p, target, backstab: false, killed: !target.alive, damage: dealt, weaponId: wid });
  }

  /** Platte einsetzen/abbrechen (Panzerung, Großkarten): der Host setzt sie an der Puppe ein, Ergebnis über 'hit'/'ev' ap. */
  _onPlate(m, from) {
    const G = this.G;
    const p = this._puppet(from);
    if (!this.active || !p || !p.alive || !p.armor || !G.combat) return;
    if (m && m.cancel) G.combat.cancelPlate(p);
    else G.combat.insertPlate(p, { chain: !!(m && m.chain) });
  }

  /**
   * Befehlsrad eines Clients ('order' { order, point: [x,y,z] | null, target: netId | 0, formation }): Befehl an die KI-Bots
   * seines Teams um seine Puppe (Anführer = Puppe; folgen/sammeln richten sich nach ihr). Prüfung (Befehl, Form, Gegner)
   * in BotManager.issueOrder; Punkte weiter als 300 m von der Puppe werden verworfen.
   */
  _onOrder(m, from) {
    const G = this.G;
    if (!this.active || this.ended || !m || typeof m.order !== 'string' || !G.bots || typeof G.bots.issueOrder !== 'function') return;
    const p = this._puppet(from);
    if (!p || !p.alive || !p.team) return;
    const t = nowSec();
    if (t - (this._lastOrder.get(from) || 0) < ORDER_GAP) return;
    this._lastOrder.set(from, t);
    let point = vec3(m.point);
    if (point && point.distanceTo(p.position) > 300) point = null;
    const target = Number.isInteger(m.target) && m.target > 0 ? this.net.actorById(m.target) : null;
    G.bots.issueOrder({ leader: p, order: m.order.slice(0, 16), point, target, formation: typeof m.formation === 'string' ? m.formation.slice(0, 8) : null });
  }

  /** Wurf/Raketenschuss eines Clients ('throw'): echtes Geschoss aus der Puppe (Wirkung auf dem Host), Darstellung über 'ev'. */
  _onThrow(m, from) {
    const G = this.G;
    if (!this.active || this.ended || !m || !G.weapons) return;
    const p = this._puppet(from);
    if (!p || !p.alive) return;
    const t = nowSec();
    if (t - (this._lastThrow.get(from) || 0) < THROW_GAP) return;
    this._lastThrow.set(from, t);
    p.getEyePosition(_eye);
    const eye = [_eye.x, _eye.y, _eye.z];
    let origin = vec3(m.origin);
    if (!origin || dist3(arr3(origin), eye) > 3.5) origin = _eye.clone();
    const dir = vec3(m.dir);
    if (dir) { if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1); else dir.normalize(); }
    const cid = Number.isFinite(m.cid) ? m.cid : null;
    if (m.kind === 'rocket') {
      const def = WEAPONS[m.type];
      if (!def || !def.projectile || !dir) return;
      const own = this._weaponsOf(p, from).includes(def.id) || p.cls === 'pionier';
      if (!own) { if (this.net.anticheat) this.net.anticheat.strike(from, 'ausruestung', this.net.serverTime(), def.id); return; }
      G.weapons.fireProjectile(p, def, origin, dir, 1, { cid });
      return;
    }
    const eq = EQUIPMENT[m.type];
    if (!eq) return;
    if (m.inHand) { G.weapons.explodeInHand(p, eq.id); return; }
    const cook = Math.max(0, Math.min(Number(m.cook) || 0, (eq.fuse || 3) - 0.05));
    G.weapons.throwGrenade(p, eq.id, { cook, drop: !!m.drop, origin, dir: dir || undefined, cid });
  }

  /**
   * Prämie anfragen ('streak' {id, p, y, pi}): der Host setzt sie für die Puppe ein, wenn sie bereit ist (Fortschritt läuft
   * hier) – Drohne mit dem vorgeschlagenen Startpunkt (geprüft in StreakManager._launchDrone). Antwort 'ev' sa an den Client.
   */
  _onStreak(m, from) {
    const G = this.G;
    if (!this.active || this.ended || !m || typeof m.id !== 'string') return;
    const p = this._puppet(from);
    const st = G.mode && G.mode.streaks;
    if (!p || !st) return;
    const t = nowSec();
    if (t - (this._lastStreak.get(from) || 0) < STREAK_GAP) return;
    this._lastStreak.set(from, t);
    let ok = false;
    let d = null;
    if (st.byId[m.id] && p.alive) {
      const opts = {};
      if (m.id === 'drohne') { opts.position = vec3(m.p); opts.yaw = Number(m.y); opts.pitch = Number(m.pi); }
      // Luftschlag: Ziel des Clients (Zielkarte), höchstens 500 m von der Puppe – sonst wählt der Host
      if (m.id === 'strike') { const tp = vec3(m.t); if (tp && tp.distanceTo(p.position) < 500) opts.target = tp; }
      try { ok = !!st.activate(p, m.id, opts); } catch (err) { ok = false; console.error('[net] Prämie', err); }
      if (ok && m.id === 'drohne') d = st.droneOf(p);
    }
    const uavLeft = ok && m.id === 'uav' ? this._uavLeft(p) : undefined;
    this.net.send(from, {
      t: 'ev', e: 'sa', id: m.id.slice(0, 16), ok: ok ? 1 : 0, d: d ? d.netId : 0, r: uavLeft,
      p: d ? arr3(d.position, 2) : undefined, pi: d ? rnd(d.pitch, 3) : undefined, bt: d ? rnd(d.battery, 2) : undefined,
    });
    if (!ok) this._sendStreakState(p);
  }

  /**
   * Klassen-Fähigkeit eines Clients ('ability' {id}): passt sie zur Klasse der Puppe und ist sie wieder bereit (Echtzeit,
   * 10 % Spielraum für langsame Geräte), heilt der Host die Puppe bei Regeneration (_tickRegens). Kampfrausch,
   * Nachschub und Aufklärungspuls wirken nur beim Client selbst (Nachladen, Rückstoß, Munition, eigene Minikarte).
   */
  _onAbility(m, from) {
    if (!this.active || this.ended || !m || typeof m.id !== 'string') return;
    const p = this._puppet(from);
    const ab = ABILITIES[m.id];
    if (!p || !p.alive || !ab || ab.cls !== (p.cls || (p.loadout && p.loadout.cls))) return;
    const t = nowSec();
    if (t < (this._abilityAt.get(from) || 0)) return;
    this._abilityAt.set(from, t + ab.cooldown * 0.9);
    if (ab.regen) this._regens.set(from, { until: this.G.time.elapsed + ab.duration, rate: ab.regen }); // Spielzeit (wie die Heilung)
  }

  /**
   * Waffe von einer Leiche ('loot' {w, v}): Raum erlaubt es, der Gefallene (Netz-Id v) ist tot, liegt höchstens 6 m
   * von der Puppe und trug diese Waffe → für die Puppe bis zu ihrem Tod erlaubt (_weaponsOf).
   */
  _onLoot(m, from) {
    const G = this.G;
    const p = this._puppet(from);
    if (!this.active || this.ended || !p || !p.alive || !m || typeof m.w !== 'string' || !WEAPONS[m.w]) return;
    if (this.net.room && this.net.room.settings && this.net.room.settings.lootWeapons === false) return;
    const v = G.actors.find((a) => a.netId === m.v);
    if (!v || v.alive || !v.position || v.position.distanceTo(p.position) > 6) return;
    const vw = [v.weapon && v.weapon.currentDef && v.weapon.currentDef.id, v.loadout && v.loadout.primary, v.loadout && v.loadout.secondary];
    if (!vw.includes(m.w)) return;
    if (!p._lootWeapons) p._lootWeapons = new Set();
    p._lootWeapons.add(m.w);
  }

  _tickRegens() {
    const { dt, elapsed } = this.G.time;
    for (const [id, r] of this._regens) {
      const p = this._puppet(id);
      if (!p || !p.alive || elapsed >= r.until) { this._regens.delete(id); continue; }
      if (p.health < p.maxHealth) p.health = Math.min(p.maxHealth, p.health + r.rate * dt);
    }
  }

  /** Drohne eines Clients ('drone' {a: 'p'|'x'|'e'|'h', d, …}): Prüfung und Wirkung in mode.streaks (net*-Methoden). */
  _onDrone(m, from) {
    const G = this.G;
    if (!this.active || this.ended || !m || typeof m.a !== 'string') return;
    const p = this._puppet(from);
    const st = G.mode && G.mode.streaks;
    if (!p || !st || typeof st.netPose !== 'function') return;
    const ac = this.net.anticheat;
    const t = this.net.serverTime();
    if (m.a === 'p') {
      const r = st.netPose(p, m);
      if (!r.ok && r.reason === 'tempo' && ac) ac.strike(from, 'drohne', t, { dist: r.dist });
    } else if (m.a === 'x') {
      const r = st.netDetonate(p, m);
      // 'akku' ist kein Verstoß: auf sehr langsamen Geräten läuft die Spielzeit (und damit der Akku) langsamer als die Echtzeit;
      // 'wand' (Sprengpunkt hinter einer Wand) auch nicht – Toleranz für Ecken, die Sprengung wirkt ohnehin nicht
      if (!r.ok && r.reason !== 'inaktiv' && r.reason !== 'akku' && r.reason !== 'wand' && ac) ac.strike(from, 'drohne', t, { why: r.reason, dist: r.dist });
      this.lastDroneCheck = { from, ok: r.ok, reason: r.reason || null };
    } else if (m.a === 'e') st.netEnd(p, m);
    else if (m.a === 'h') {
      const r = st.netHit(p, m, this._weaponsOf(p, from));
      if (!r.ok && r.reason === 'waffe' && ac) ac.strike(from, 'ausruestung', t, typeof m.w === 'string' ? m.w.slice(0, 24) : null);
    }
  }

  /** Fortschritt der Serienprämien an den Client hinter einer Puppe ('ev' sk). */
  _sendStreakState(actor) {
    const st = this.G.mode && this.G.mode.streaks;
    if (!actor || !actor.isRemoteHuman || !st || !this.net.online) return;
    const pr = st.progress(actor);
    this._toActor(actor, { t: 'ev', e: 'sk', k: pr.kills | 0, rd: pr.ready, er: pr.earned });
  }

  /** Prämie eingesetzt: Stand an den Auslöser (Client), Hinweis an alle anderen ('ev' sv). */
  _relayStreak(e) {
    const a = e && e.actor;
    if (!a || !Number.isInteger(a.netId) || !this.net.online || typeof e.streakId !== 'string') return;
    this._sendStreakState(a);
    const msg = { t: 'ev', e: 'sv', o: a.netId, id: e.streakId };
    if (e.streakId === 'uav') msg.r = this._uavLeft(a); // Aufklärer: Restdauer → Abbild zeigt die Gegner seiner Seite
    if (e.streakId === 'strike' && e.target) msg.p = arr3(e.target, 1);
    this.net.send('others', msg, a.isRemoteHuman ? a.netId : null);
  }

  /** Restdauer (s) des Aufklärers der Seite von a (Host-Zeit), sonst undefined. */
  _uavLeft(a) {
    const st = this.G.mode && this.G.mode.streaks;
    const u = st && st.uav ? st.uav.get(st._uavKey(a)) : null;
    return u ? rnd(Math.max(0, u.until - this.G.time.elapsed), 1) : undefined;
  }

  /** Ende einer Drohne an alle ('ev' de: Netz-Id, Besitzer, Grund, Schütze beim Abschuss). */
  _relayDroneEnd(e) {
    const d = e && e.drone;
    if (!d || !d.netId || !this.net.online) return;
    const o = d.owner && Number.isInteger(d.owner.netId) ? d.owner.netId : 0;
    const b = e.by && Number.isInteger(e.by.netId) ? e.by.netId : 0;
    this.net.send('all', { t: 'ev', e: 'de', d: d.netId, o, why: e.why || 'ende', b, p: arr3(d.position, 2) });
  }

  /** Lage aller Drohnen (12 Hz, nur solange welche fliegen). */
  _relayDrones(now) {
    const st = this.G.mode && this.G.mode.streaks;
    if (!st || typeof st.netDroneList !== 'function' || !this._ready.size || now - this._droneAt < 1 / DRONE_HZ - 0.002) return;
    const list = st.netDroneList();
    if (!list.length) return;
    this._droneAt = now;
    this.net.send('all', { t: 'ev', e: 'dr', l: list });
  }

  /* ================================================================ Ausgang: Ereignisse */

  _relayHit(e) {
    const t = e && e.target;
    if (!t || !Number.isInteger(t.netId) || !this.net.online) return;
    if (e.dir && e.killed) this._lastDir.set(t, e.dir);
    const a = e.attacker;
    this.net.send('all', {
      t: 'hit', target: t.netId, attacker: a && Number.isInteger(a.netId) ? a.netId : 0, dmg: rnd(e.amount, 1), zone: e.zone || 'body',
      hp: Math.max(0, Math.round(t.health)), weapon: e.weaponId || null, dir: arr3(e.dir, 3), point: arr3(e.point), exp: e.explosive ? 1 : 0,
      killed: e.killed ? 1 : 0, ar: t.armor ? armorOf(t) : undefined, st: t.isRemoteHuman ? rnd(this.net.serverTime(), 3) : undefined,
    });
  }

  _relayKill(e) {
    const v = e && e.victim;
    if (!v || !Number.isInteger(v.netId) || !this.net.online) return;
    const k = e.killer;
    const G = this.G;
    const resp = v.respawnAt != null ? Math.max(0, v.respawnAt - G.time.elapsed) : (G.mode && G.mode.respawnDelay) || 3;
    this.net.send('all', {
      t: 'kill', victim: v.netId, killer: k && Number.isInteger(k.netId) ? k.netId : 0,
      assister: (e.assisters || []).filter((a) => a && Number.isInteger(a.netId)).map((a) => a.netId),
      weapon: e.weaponId || null, zone: e.headshot ? 'head' : 'body', head: e.headshot ? 1 : 0, exp: e.explosive ? 1 : 0, streak: e.streak | 0,
      fb: e.firstBlood ? 1 : 0, ls: e.longshot ? 1 : 0, rv: e.revenge ? 1 : 0, dist: rnd(e.distance || 0, 1), sui: e.suicide ? 1 : 0,
      resp: rnd(resp, 2), dir: arr3(this._lastDir.get(v), 3), st: rnd(this.net.serverTime(), 3),
    });
  }

  _relaySpawn(e) {
    const a = e && e.actor;
    if (!a || !Number.isInteger(a.netId) || !this.net.online) return;
    const pos = [a.position.x, a.position.y, a.position.z];
    if (a.isRemoteHuman && this.net.anticheat) this.net.anticheat.onSpawn(a.netId, pos, this.net.serverTime());
    this.net.send('all', {
      t: 'spawn', id: a.netId, pos: arr3(pos), yaw: rnd(a.yaw || 0, 3), cls: a.cls || null, loadout: loadoutOf(a),
      hp: Math.round(a.health || 100), st: rnd(this.net.serverTime(), 3),
    });
  }

  _relayExplosion(e) {
    if (!e || e.source || !this.net.online || !e.position) return; // Granaten/Raketen: über ihre eigenen Ereignisse
    const a = e.attacker;
    this.net.send('all', { t: 'ev', e: 'ex', pos: arr3(e.position), r: rnd(e.radius || 6, 1), type: e.type || 'frag', w: e.weaponId || null, o: a && Number.isInteger(a.netId) ? a.netId : 0 });
  }

  _relayGrenade(e) {
    const g = e && e.grenade;
    if (!g || !this.net.online) return;
    const a = g.actor;
    this.net.send('all', {
      t: 'ev', e: 'gr', gid: g.id, o: a && Number.isInteger(a.netId) ? a.netId : 0, type: g.type, pos: arr3(g.position, 3), vel: arr3(g.velocity, 3),
      fuse: rnd(g.fuse, 2), cid: g.cid,
    });
  }

  _relayGrenadeBoom(e) {
    if (!e || !this.net.online || !e.position) return;
    const a = e.actor;
    this.net.send('all', { t: 'ev', e: 'gb', gid: e.grenade ? e.grenade.id : 0, type: e.type || 'frag', pos: arr3(e.position, 3), o: a && Number.isInteger(a.netId) ? a.netId : 0 });
  }

  _relayRocket(e) {
    const r = e && e.rocket;
    if (!r || !this.net.online) return;
    const a = r.actor;
    this.net.send('all', { t: 'ev', e: 'rk', rid: r.id, o: a && Number.isInteger(a.netId) ? a.netId : 0, w: r.def.id, pos: arr3(r.pos, 3), dir: arr3(r.dir, 4), cid: r.cid });
  }

  _relayRocketEnd(e, dud) {
    const r = e && e.rocket;
    if (!r || !this.net.online) return;
    const a = r.actor;
    this.net.send('all', { t: 'ev', e: dud ? 'rd' : 'rb', rid: r.id, w: r.def.id, pos: arr3(e.position, 3), n: arr3(e.normal, 3), o: a && Number.isInteger(a.netId) ? a.netId : 0 });
  }
}
