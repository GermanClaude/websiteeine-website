// NULLPUNKT — Verletzungen (Wunschliste 10.10.): Treffer an Arm oder Bein, Blutung, Verband, Wiederbeleben.
//   • Armtreffer: Waffe zittert (mehr Rückstoß/Streuung), Nachladen langsamer – bis zum Verband (weapons/controller.js).
//   • Beintreffer: Humpeln (langsamer, kein Sprint) – bis zum Verband (player.js; Bots: limpUntil).
//   • Blutung: nach stärkeren Treffern verliert man langsam Leben (kann töten, zählt für den Schützen), unterbricht die
//     Regeneration. Stillen: Verband (Taste N, 2 je Leben, 2 s) oder Verbandskasten des Sanitäters.
//   • Wiederbeleben: Sanitäter (Verbandskasten) holen gefallene Teamkameraden zurück – Spieler mit F an der Leiche
//     (2 s), Sanitäter-Bots in der Nähe des gefallenen Spielers von selbst. Wiederbelebte stehen mit halbem Leben auf.
// Entscheidet offline bzw. der Host (Schaden läuft nur dort); Clients sehen das Ergebnis über Leben/Spawn.
import * as THREE from 'three';
import { issueCommand } from './bots/ai/orders.js';

const BLEED_RATE = { arcade: 1.6, realistisch: 2.6 };   // Leben je Sekunde
const BLEED_CHANCE = { arcade: 0.35, realistisch: 0.7 };
const BLEED_MAX = 30;            // s, danach gerinnt es von selbst
const BANDAGES = 2;
const BANDAGE_TIME = 2;
const REVIVE_TIME = 2;
const REVIVE_WINDOW = 9;         // s nach dem Tod
const REVIVE_RANGE = 2.2;        // m (Spieler an der Leiche)
const MEDIC_WAIT_RANGE = 45;     // m: so weit darf der nächste Sanitäter weg sein, damit man auf ihn warten kann
const MEDIC_WAIT = 16;           // s höchstens warten
const _v = new THREE.Vector3();

const isMedic = (a) => !!(a && a.gadget && a.gadget.id === 'medkit');

export class Injuries {
  constructor(G) {
    this.G = G;
    this.down = new Map();   // Gefallene, die noch wiederbelebt werden können: actor → { until, pos, yaw }
    this.near = null;        // { target, text } für die Einblendung (Spieler-Sanitäter)
    this._act = null;        // laufende Handlung des Spielers: { kind: 'verband'|'revive', t, dur, target }
    this._drip = 0;
    const on = (n, f) => G.events.on(n, f);
    this._off = [
      on('actor:hit', (e) => this._hit(e)),
      on('gadget:heal', (e) => { if (e.target) this.treat(e.target); }),
      on('kill', (e) => this._killed(e)),
      on('actor:spawn', (e) => { this.clear(e.actor); this.down.delete(e.actor); }),
    ];
  }

  get _host() { const m = this.G.match; return !!m && m.netRole !== 'client'; }
  _style() { return (this.G.match && this.G.match.style) === 'realistisch' ? 'realistisch' : 'arcade'; }

  /** Verletzungsstand eines Akteurs (legt ihn an). */
  of(a) {
    if (!a.injury) a.injury = { arm: false, leg: false, bleed: 0, bleedLeft: 0, by: null, wid: null, bandages: BANDAGES };
    return a.injury;
  }

  clear(a) {
    if (!a) return;
    a.injury = null;
    if (a === this.G.player) this._act = null;
  }

  /** Verband/Verbandskasten: Blutung gestillt, Arm/Bein versorgt. */
  treat(a) {
    const j = a && a.injury;
    if (!j) return;
    const had = j.bleed > 0 || j.arm || j.leg;
    j.bleed = 0; j.arm = false; j.leg = false;
    if (a.isBot) a.limpUntil = 0;
    if (had && a === this.G.player) this.G.events.emit('injury:notice', { text: 'Wunden versorgt.', tone: 'gold' });
  }

  _hit(e) {
    const a = e.target;
    if (!this._host || !a || e.killed || !(e.amount > 0) || e.weaponId === 'fall' || e.weaponId === 'world') return;
    const j = this.of(a);
    const G = this.G;
    let news = null;
    if (e.zone === 'limb' && e.amount >= 10) {
      const py = e.point ? e.point.y - a.position.y : Math.random() * 1.6;
      if (py >= 0.95) { if (!j.arm) news = 'Arm getroffen – Waffe zittert.'; j.arm = true; }
      else { if (!j.leg) news = 'Bein getroffen – du humpelst.'; j.leg = true; }
    }
    if (e.zone !== 'head' && e.amount >= 15 && Math.random() < BLEED_CHANCE[this._style()]) {
      if (!(j.bleed > 0)) news = news ? `${news} Du blutest!` : 'Du blutest!';
      j.bleed = BLEED_RATE[this._style()];
      j.bleedLeft = a.isBot ? 3 + Math.random() * 5 : BLEED_MAX; // Bots verbinden sich nach wenigen Sekunden selbst
      j.by = e.attacker || null;
      j.wid = e.weaponId || null;
    }
    if (a.isBot && j.leg) a.limpUntil = G.time.elapsed + 25;
    if (news && a === G.player) G.events.emit('injury:notice', { text: news, tone: 'dim', key: 'verband' });
  }

  _killed(e) {
    const v = e.victim;
    if (!this._host || !v || !v.team) return;
    if (e.weaponId === 'world') return;
    const now = this.G.time.elapsed;
    this.down.set(v, { until: now + REVIVE_WINDOW, pos: v.position.clone(), yaw: v.yaw || 0, at: now });
    // Spieler-Sanitäter in der Nähe: gefallener Bot wartet mit dem Respawn auf die Wiederbelebung
    const P = this.G.player;
    if (v.isBot && isMedic(P) && P.alive && P.team === v.team && P.position.distanceTo(v.position) < 20 && v.respawnAt != null) {
      v.respawnAt = Math.max(v.respawnAt, now + REVIVE_WINDOW);
    }
    // gefallener Spieler, Sanitäter-Bot in Reichweite: er läuft her und holt dich zurück – warten oder aufgeben (F)
    if (v === P) {
      const medic = this._botMedicNear(v);
      if (medic && v.respawnAt != null) {
        const d = this.down.get(v);
        d.medic = medic; d.base = v.respawnAt; d.until = now + MEDIC_WAIT;
        v.respawnAt = Math.max(v.respawnAt, d.until);
        try { issueCommand(this.G, [medic], medic, 'attack', { point: d.pos.clone() }, now); } catch { /* Bot ohne Befehlsschicht */ }
        this.G.events.emit('injury:notice', { text: `${medic.name || 'Sanitäter'} kommt (${Math.round(medic.position.distanceTo(d.pos))} m) – warten oder aufgeben`, tone: 'gold', key: 'interact' });
      }
    }
    this.clear(v);
  }

  _botMedicNear(v) {
    let best = null, bd = MEDIC_WAIT_RANGE;
    for (const a of this.G.actors) {
      if (!a.isBot || a.puppet || !a.alive || a.team !== v.team || !isMedic(a)) continue;
      const d = a.position.distanceTo(v.position);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** Gefallener Spieler wartet auf einen Sanitäter: { name, dist } für Todesbildschirm/Einsatzkarte, sonst null. */
  medicInfo() {
    const P = this.G.player, d = P && !P.alive ? this.down.get(P) : null;
    if (!d || !d.medic || !d.medic.alive) return null;
    return { name: d.medic.name || 'Sanitäter', dist: Math.round(d.medic.position.distanceTo(d.pos)) };
  }

  /** Nicht mehr warten: normaler Wiedereinstieg (Wartezeit wie ohne Sanitäter). */
  giveUp() {
    const P = this.G.player, d = P ? this.down.get(P) : null;
    if (!d || !d.medic) return false;
    try { issueCommand(this.G, [d.medic], d.medic, 'free', {}, this.G.time.elapsed); } catch { /* */ }
    this.down.delete(P);
    if (P.respawnAt != null) P.respawnAt = Math.max(this.G.time.elapsed, d.base ?? this.G.time.elapsed);
    return true;
  }

  /** Spieler drückt den Verband (Taste N / Touch). */
  bandage() {
    const P = this.G.player, j = P && P.injury;
    if (!P || !P.alive || this._act) return false;
    if (!j || !(j.bleed > 0 || j.arm || j.leg)) { this.G.events.emit('injury:notice', { text: 'Du bist nicht verwundet.', tone: 'dim' }); return false; }
    if (j.bandages <= 0) { this.G.events.emit('injury:notice', { text: 'Keine Verbände mehr.', tone: 'dim' }); return false; }
    this._act = { kind: 'verband', t: 0, dur: BANDAGE_TIME };
    P._busyUntil = Math.max(P._busyUntil || 0, this.G.time.elapsed + BANDAGE_TIME);
    if (this.G.input && this.G.input.cancelAds) this.G.input.cancelAds();
    this.G.events.emit('injury:notice', { text: 'Verband anlegen …', tone: 'gold' });
    return true;
  }

  /** Spieler-Sanitäter: Wiederbelebung an der nächsten Leiche starten (Taste F). */
  revive() {
    const n = this.near, P = this.G.player;
    if (!n || !P || !P.alive || this._act) return false;
    this._act = { kind: 'revive', t: 0, dur: REVIVE_TIME, target: n.target };
    P._busyUntil = Math.max(P._busyUntil || 0, this.G.time.elapsed + REVIVE_TIME);
    return true;
  }

  _revive(v, medic) {
    const d = this.down.get(v);
    if (!d || v.alive) return false;
    this.down.delete(v);
    const old = v.isBot ? v.soldier : null;
    if (typeof this.G.spawnActor === 'function') this.G.spawnActor(v, { position: d.pos.clone(), yaw: d.yaw });
    if (!v.alive) return false;
    v.health = Math.round(v.maxHealth * 0.5);
    v.lastDamageTime = this.G.time.elapsed; // Regeneration erst nach der üblichen Pause
    // Bot: die alte Leiche verschwindet (er ist ja wieder aufgestanden)
    if (old && old !== v.soldier && old.state === 'dead') old.hide();
    if (medic && medic.isBot && medic.command) { try { issueCommand(this.G, [medic], medic, 'free', {}, this.G.time.elapsed); } catch { /* */ } }
    if (medic && medic.stats) medic.stats.score = (medic.stats.score || 0) + 50;
    this.G.events.emit('injury:revive', { actor: v, medic });
    if (medic === this.G.player) this.G.events.emit('injury:notice', { text: `${v.name || 'Kamerad'} wiederbelebt. +50`, tone: 'gold' });
    if (v === this.G.player) this.G.events.emit('injury:notice', { text: 'Wiederbelebt!', tone: 'gold' });
    return true;
  }

  update(dt) {
    const G = this.G;
    if (!G.match || G.match.state !== 'playing') return;
    const now = G.time.elapsed;
    const P = G.player;
    if (this._host) {
      // Blutung
      this._drip -= dt;
      const drip = this._drip <= 0;
      if (drip) this._drip = 0.8;
      for (const a of G.actors) {
        const j = a.injury;
        if (!j || !(j.bleed > 0) || !a.alive) continue;
        j.bleedLeft -= dt;
        if (j.bleedLeft <= 0) { j.bleed = 0; continue; }
        a.health -= j.bleed * dt;
        a.lastDamageTime = now; // keine Regeneration, solange es blutet
        if (drip && a !== P && G.effects && typeof G.effects.blood === 'function') G.effects.blood(_v.copy(a.position).setY(a.position.y + 0.9), { x: 0, y: -1, z: 0 }, {});
        if (a.health <= 0 && G.combat) {
          a.health = 0;
          G.combat._kill(a, { attacker: j.by && j.by !== a ? j.by : null, weaponId: j.wid || 'bleed', zone: 'body' });
        }
      }
      // Wiederbeleben: abgelaufene vergessen, Sanitäter-Bots holen den Spieler zurück
      for (const [v, d] of this.down) {
        if (v.alive || now > d.until) { this.down.delete(v); continue; }
        if (d.medic && v === P) {
          if (!d.medic.alive) { this.giveUp(); this.G.events.emit('injury:notice', { text: 'Der Sanitäter ist gefallen.', tone: 'dim' }); continue; }
          if (v.respawnAt != null) v.respawnAt = Math.max(v.respawnAt, d.until); // Respawn wartet
          const dist = d.medic.position.distanceTo(d.pos);
          // angekommen (oder nah genug und schon lange unterwegs): wiederbeleben
          if (now - d.at > 1.5 && (dist < 2.6 || (dist < 7 && now - d.at > 9))) this._revive(v, d.medic);
        }
      }
    }
    // Spieler: Tasten (N = Verband, F = Wiederbeleben), Einblendung „Wiederbeleben“ und laufende Handlungen
    const inp = G.input;
    if (inp && P && !P.alive && typeof inp.pressed === 'function' && this.medicInfo() && inp.pressed('interact')) this.giveUp();
    if (inp && P && P.alive && typeof inp.pressed === 'function') {
      if (inp.pressed('verband')) this.bandage();
      if (this.near && inp.pressed('interact')) this.revive();
    }
    this.near = null;
    if (P && P.alive && isMedic(P) && this._host) {
      let best = null, bd = REVIVE_RANGE;
      for (const [v, d] of this.down) {
        if (v === P || v.team !== P.team) continue;
        const dist = P.position.distanceTo(d.pos);
        if (dist < bd) { bd = dist; best = v; }
      }
      if (best) this.near = { target: best, text: `${best.name || 'Kamerad'} wiederbeleben` };
    }
    const act = this._act;
    if (act) {
      if (!P || !P.alive) { this._act = null; return; }
      act.t += dt;
      if (act.kind === 'revive') {
        const d = this.down.get(act.target);
        if (!d || P.position.distanceTo(d.pos) > REVIVE_RANGE + 0.8) { this._act = null; return; }
        if (act.t >= act.dur) { this._act = null; this._revive(act.target, P); }
      } else if (act.t >= act.dur) {
        this._act = null;
        const j = P.injury;
        if (j) { j.bandages -= 1; this.treat(P); }
      }
    }
  }

  /** Fortschritt der laufenden Handlung (HUD), 0..1 oder null. */
  progress() { const a = this._act; return a ? { kind: a.kind, p: Math.min(1, a.t / a.dur) } : null; }

  dispose() {
    for (const f of this._off) f();
    this._off = [];
    this.down.clear();
    for (const a of this.G.actors || []) a.injury = null;
  }
}
