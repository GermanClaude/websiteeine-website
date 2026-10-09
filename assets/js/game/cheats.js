// NULLPUNKT — Nur Messer: Cheat-Menü (Wunsch des Entwicklers: „damit es für manche Leute ein bisschen fairer ist“).
//
// Nur im Modus „Nur Messer“ (modes/knife.js erzeugt das System je Match), nur für den eigenen Spieler – Bots bekommen
// nichts davon. Freischalten (ui/cheat-menu.js): Ziffernblock 1 → 2 → 3 → 4 (KeyboardEvent.code) innerhalb von 3 s während
// des Matches, dann Code „NULLPUNKT“ (Großbuchstaben, ohne Punkt). Danach öffnet dieselbe Folge das Menü ohne Code – bis zum
// Matchende. Touch/VR: kein Ziffernblock, nichts zu tun.
//
// Schalter (Standard aus, je Match zurückgesetzt):
//   aimbot      Blick sehr schnell auf den nächsten sichtbaren Gegner (Brust, sonst Kopf; ≤ 35 m, Sichtkegel 75°)
//   spinbot     sichtbare Gierung dreht sich (player.spinYaw → bots/bot.js netPoseOf: Schnappschuss des Hosts bzw. Zustand des
//               Clients); Kamera, Laufrichtung und Treffer bleiben unberührt
//   automesser  sticht über die normale Nahkampf-Aktion, sobald ein Gegner knapp unter der Messer-Reichweite (melee.range der
//               Waffendefinition × 0,95) in Sicht ist – vorher genau ausrichten; online prüft der Host wie immer (anticheat.js)
//   ausweichen  zielt ein Gegner (Bot oder Puppe) auf dich (≤ 6° + Körperbreite, Sichtlinie, < 30 m): kurzer Seitschritt über
//               die normale Bewegungseingabe (input.move, |v| ≤ 1), mitunter mit Sprung – kein Teleport, kein Zusatztempo
//   markieren   alle Gegner mit Raute und Entfernung, auch durch Wände (HUD-Projektion wie die Ziel-Marker)
//   bunnyhop    Sprungtaste gehalten: bei jeder Landung sofort wieder springen
// Kein Gottmodus, kein Schaden-/Tempo-Bonus, kein Teleport.
//
// Transparenz: Raum-Einstellung cheatMenu (Host, Standard erlaubt; offline immer erlaubt; verbietet der Host es mitten im
// Match, gehen alle Schalter aus). Wer mindestens einen Schalter an hat, trägt in der Punktetabelle ein Symbol („Cheat-Menü
// aktiv“) – online meldet der eigene Spieler das dem Host (net/index.js setCheat → 'cheat' {on}), der es im Roster vermerkt
// und an alle verteilt.
//
// Ablauf je Bild: main.js ruft mode.preUpdate(dt) nach der Eingabe und vor dem Spieler (Blick, Bewegung, Nahkampf dieses
// Bildes), mode.update(dt) danach (Markierungen). Matchende/Lobby/Revanche: Schalter aus, Meldung zurück, Listener ab.

import * as THREE from 'three';
import { CheatMenu } from './ui/cheat-menu.js';

/** Schalter in Menü-Reihenfolge (Standard aus). */
export const CHEATS = Object.freeze([
  { id: 'aimbot', label: 'Aimbot', sub: 'Blick rastet auf den nächsten sichtbaren Gegner ein (bis 35 m)' },
  { id: 'spinbot', label: 'Spinbot', sub: 'Dein Körper dreht sich für andere im Kreis – deine Sicht bleibt normal' },
  { id: 'automesser', label: 'Auto-Messer', sub: 'Sticht selbst zu, sobald ein Gegner in optimaler Reichweite ist' },
  { id: 'ausweichen', label: 'Ausweichen', sub: 'Zielt ein Gegner auf dich, weichst du seitlich aus' },
  { id: 'markieren', label: 'Gegner markieren', sub: 'Alle Gegner mit Entfernung, auch durch Wände' },
  { id: 'bunnyhop', label: 'Auto-Sprung', sub: 'Sprungtaste halten: bei jeder Landung sofort wieder springen' },
]);
export const CHEAT_IDS = Object.freeze(CHEATS.map((c) => c.id));
/** Freischalt-Code (genau so, Großbuchstaben, ohne Punkt). */
export const CHEAT_CODE = 'NULLPUNKT';

const D2R = Math.PI / 180;
const AIM_RANGE = 35; // m
const AIM_CONE = 75 * D2R; // halber Öffnungswinkel um die Laufrichtung
const AIM_RATE = 30; // 1/s: Annäherung an das Ziel (≈ 40 % je Bild bei 60 Hz – nach 0,15 s praktisch drauf)
const CHEST = 0.62; // Anteil der Körperhöhe (wie der Ausfallschritt des Messers)
const HEAD = 0.9;
const SPIN_RATE = 4 * Math.PI; // rad/s – zwei Umdrehungen je Sekunde
const KNIFE_REACH = 0.95; // Anteil der Messer-Reichweite: knapp unter dem Maximum
const STAB_GAP = 0.15; // s zwischen zwei Auslösungen (der Hieb selbst sperrt ohnehin bis zum Ende)
const DODGE_RANGE = 30; // m
const DODGE_CONE = 6 * D2R;
const DODGE_TIME = 0.42; // s Seitschritt
const DODGE_PAUSE = 0.18; // s bis zum nächsten
const DODGE_JUMP = 0.3; // Anteil der Seitschritte mit Sprung
const LOS_TTL = 0.08; // s: Sichtprüfung je Akteur zwischengespeichert

const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _best = new THREE.Vector3();
const _me = new THREE.Vector3();
const _oe = new THREE.Vector3();
const _od = new THREE.Vector3();
const _ray = new THREE.Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Tastendruck nur für dieses Bild (Flanke wie ein echter Druck; input.endFrame löscht ihn). Ist die Taste schon gehalten
 * (Auto-Sprung bei gehaltener Leertaste), zählt nur die Flanke.
 */
function tap(input, action) {
  if (input.down(action)) { if (input._pressed) input._pressed.add(action); } else input.simulate.tap(action);
}

export class CheatSystem {
  constructor(G, mode) {
    this.G = G;
    this.mode = mode;
    /** Code eingegeben (gilt für dieses Match). */
    this.unlocked = false;
    this.on = Object.fromEntries(CHEAT_IDS.map((id) => [id, false]));
    /** Aktuelles Ziel von Aimbot/Auto-Messer bzw. der Gegner, vor dem zuletzt ausgewichen wurde (Tests, Anzeige). */
    this.target = null;
    this.threat = null;
    this.stats = { stabs: 0, dodges: 0 };
    this._reported = false; // online gemeldeter Zustand („Cheat-Menü aktiv“)
    this._spin = 0;
    this._stabAt = -1;
    this._dodge = { t: 0, cool: 0, dx: 0, dz: 0, side: 0 };
    this._los = new Map(); // Akteur → { t, v }
    this._marks = [];
    this.list = CHEATS;
    this.ui = new CheatMenu(this);
  }

  /** Mindestens ein Schalter an. */
  get active() {
    for (const id of CHEAT_IDS) if (this.on[id]) return true;
    return false;
  }

  attach(scope) {
    this.ui.attach(scope);
    scope.on('match:state', ({ state }) => { if (state === 'ended') this.reset(); });
  }

  /** Alle Schalter aus, Meldung zurücknehmen, Oberfläche und Listener weg (KnifeMode.onDetach). */
  dispose() {
    this.reset();
    this.ui.dispose();
    this._los.clear();
  }

  /** Alle Schalter aus (Matchende, Host verbietet) – das Freischalten bleibt für dieses Match. */
  reset() {
    for (const id of CHEAT_IDS) this.on[id] = false;
    this._afterChange();
  }

  /**
   * Darf das Menü geöffnet werden? Offline immer; online laut Raum-Einstellung des Hosts (aktuell aus G.net.room, sonst
   * aus der Match-Konfiguration). → { ok, reason }
   */
  allowed() {
    const G = this.G;
    if (!G.match || !G.match.netRole) return { ok: true, reason: null };
    const s = G.net && G.net.room && G.net.room.settings;
    const on = s && typeof s.cheatMenu === 'boolean' ? s.cheatMenu : !(G.match.net && G.match.net.cheatMenu === false);
    return on ? { ok: true, reason: null } : { ok: false, reason: 'host' };
  }

  /** Schalter setzen (Menü, Tests). → neuer Zustand */
  set(id, value) {
    if (!CHEAT_IDS.includes(id)) return false;
    const v = !!value && this.unlocked && this.allowed().ok;
    if (this.on[id] === v) return v;
    this.on[id] = v;
    this._afterChange();
    return v;
  }

  toggle(id) { return this.set(id, !this.on[id]); }

  /** Code-Feld: genau CHEAT_CODE (Groß-/Kleinschreibung zählt, keine Leerzeichen). */
  checkCode(value) { return String(value) === CHEAT_CODE; }

  _afterChange() {
    const G = this.G;
    const p = G.player;
    if (!this.on.spinbot && p && p.spinYaw != null) p.spinYaw = null;
    if (!this.on.aimbot && !this.on.automesser) this.target = null;
    if (!this.on.ausweichen) { this.threat = null; this._dodge.t = 0; }
    if (!this.on.markieren) this.ui.hideMarkers();
    this.ui.sync();
    // Online: „Cheat-Menü aktiv“ an den Host (der vermerkt es im Roster und verteilt es)
    const active = this.active;
    const net = G.net;
    if (active !== this._reported) {
      const online = !!(net && net.online && G.match && G.match.netRole && typeof net.setCheat === 'function');
      if (online) { try { net.setCheat(active); } catch (err) { console.warn('[NULLPUNKT] Cheat-Menü melden:', err); } }
      this._reported = online ? active : false;
    }
  }

  /* ------------------------------------------------------------ je Bild */

  /** Vor dem Spieler: Spinbot, Ausrichten (Aimbot/Auto-Messer), Nahkampf, Ausweichen, Auto-Sprung. */
  preUpdate(dt) {
    if (!this.active) return;
    const G = this.G;
    const p = G.player;
    const input = G.input;
    if (!p || !input) return;
    if (this.on.spinbot && p.alive) {
      this._spin = wrap(this._spin + SPIN_RATE * dt);
      p.spinYaw = this._spin;
    }
    const live = G.match.state === 'playing' || !!G.match.netLive;
    if (!live || !p.alive || p.piloting || p.vehicle || p.mantling || (G.xr && G.xr.presenting) || !G.combat) {
      this._dodge.t = 0;
      this.target = null;
      return;
    }
    // Pausenmenü online (Simulation läuft weiter): keine Eingaben – nur der Spinbot dreht weiter
    if (!input.enabled) return;
    const now = G.time.elapsed;
    p.getEyePosition(_eye);
    p.getAimDirection(_aim);

    // Auto-Messer hat Vorrang beim Ausrichten (genau, in einem Bild); sonst der Aimbot (schnell, aber nachgeführt)
    const stab = this.on.automesser ? this._stabTarget(p, now) : null;
    const aim = stab || (this.on.aimbot ? this._aimTarget(p, now) : null);
    this.target = aim ? aim.actor : null;
    if (aim) this._lookAt(p, aim.point, stab ? 1 : 1 - Math.exp(-AIM_RATE * dt));
    if (stab && now - this._stabAt >= STAB_GAP) {
      this._stabAt = now;
      this.stats.stabs++;
      tap(input, 'melee');
    }

    if (this.on.ausweichen) this._evade(p, input, dt, now);
    if (this.on.bunnyhop && input.down('jump') && !input.pressed('jump') && p.body && p.body.onGround && !p.prone) tap(input, 'jump');
  }

  /** Nach dem Spieler (Kamera dieses Bildes steht): Markierungen; Host-Verbot während des Matches. */
  update() {
    const G = this.G;
    if ((this.active || this.ui.view) && !this.allowed().ok) {
      this.reset();
      this.ui.close();
      this.ui.notice('Cheat-Menü vom Host deaktiviert', 'enemy');
    }
    if (!this.on.markieren) return;
    const p = G.player;
    const live = G.match.state === 'playing' || !!G.match.netLive;
    if (!p || !live || !G.camera || !G.combat || (G.xr && G.xr.presenting)) { this.ui.hideMarkers(); return; }
    const list = this._marks;
    list.length = 0;
    for (const a of G.actors) {
      if (!this._hostile(p, a)) continue;
      list.push(a);
    }
    this.ui.updateMarkers(list, p);
  }

  /* ------------------------------------------------------------ Hilfen */

  _hostile(p, a) {
    return !!(a && a !== p && a.alive && !a.isStreakEntity && a.position && this.G.combat.isHostile(p, a));
  }

  /** Sichtbarer Zielpunkt eines Akteurs von `eye` aus (Brust, sonst Kopf) → out oder null. Sicht je Akteur kurz zwischengespeichert. */
  _visiblePoint(a, eye, now, out) {
    const h = a.body ? a.body.height : 1.8;
    const c = this._los.get(a);
    const fresh = c && now - c.t < LOS_TTL;
    const w = this.G.world;
    out.copy(a.position);
    out.y += h * CHEST;
    if (fresh) {
      if (c.v === 0) return null;
      if (c.v === 2) out.y = a.position.y + h * HEAD;
      return out;
    }
    let v = 1;
    if (w && w.lineOfSight && !w.lineOfSight(eye, out)) {
      out.y = a.position.y + h * HEAD;
      v = w.lineOfSight(eye, out) ? 2 : 0;
    }
    this._los.set(a, { t: now, v });
    if (this._los.size > 64) this._los.clear();
    return v ? out : null;
  }

  /** Aimbot: nächster sichtbarer Gegner im Kegel (Abstand × Winkel; das bisherige Ziel wird bevorzugt). */
  _aimTarget(p, now) {
    const G = this.G;
    let best = null;
    let bestScore = Infinity;
    for (const a of G.actors) {
      if (!this._hostile(p, a)) continue;
      const h = a.body ? a.body.height : 1.8;
      _to.copy(a.position);
      _to.y += h * CHEST;
      _to.sub(_eye);
      const d = _to.length();
      if (d > AIM_RANGE || d < 0.3) continue;
      const ang = Math.acos(clamp(_to.dot(_aim) / d, -1, 1));
      if (ang > AIM_CONE) continue;
      let score = d * (1 + 2 * ang);
      if (a === this.target) score *= 0.6; // nicht zwischen zwei Gegnern hin und her springen
      if (score >= bestScore) continue;
      if (!this._visiblePoint(a, _eye, now, _pt)) continue;
      best = a;
      bestScore = score;
      _best.copy(_pt);
    }
    return best ? { actor: best, point: _best } : null;
  }

  /** Auto-Messer: nächster sichtbarer Gegner knapp unter der Messer-Reichweite (Abstand wie weapons/controller.js). */
  _stabTarget(p, now) {
    const w = p.weapon;
    const def = w && w.currentDef;
    if (!def || def.cls !== 'melee' || w.isMeleeing || w.isSwitching || w.isThrowing) return null;
    const spec = def.melee || {};
    const reach = (spec.range || def.range || 2.4) * KNIFE_REACH;
    let best = null;
    let bestD = reach;
    for (const a of this.G.actors) {
      if (!this._hostile(p, a)) continue;
      const h = a.body ? a.body.height : 1.8;
      _to.copy(a.position);
      _to.y += h * 0.6;
      const d = _to.distanceTo(_eye);
      if (d > bestD) continue;
      if (!this._visiblePoint(a, _eye, now, _pt)) continue;
      best = a;
      bestD = d;
      _best.copy(_pt);
    }
    return best ? { actor: best, point: _best } : null;
  }

  /**
   * Blick auf `point` ziehen (k = Anteil des Restfehlers, 1 = genau). Der Versatz zwischen Sicht und Laufrichtung
   * (Rückstoß, Zucken, freies Zielen) wird herausgerechnet – die Laufrichtung (getAimDirection) trifft den Punkt.
   */
  _lookAt(p, point, k) {
    _to.subVectors(point, _eye);
    const wantYaw = Math.atan2(-_to.x, -_to.z);
    const wantPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
    p.getAimDirection(_dir);
    const offYaw = wrap(Math.atan2(-_dir.x, -_dir.z) - p.yaw);
    const offPitch = Math.asin(clamp(_dir.y, -1, 1)) - p.pitch;
    p.yaw = wrap(p.yaw + wrap(wantYaw - offYaw - p.yaw) * k);
    p.pitch = clamp(p.pitch + (wantPitch - offPitch - p.pitch) * k, -1.45, 1.45);
  }

  /** Gegner, der gerade auf mich zielt (Laufrichtung ≤ 6° + Körperbreite an meiner Brust vorbei, Sichtlinie, < 30 m). */
  _threatOf(p, now) {
    const G = this.G;
    _me.copy(p.position);
    _me.y += (p.body ? p.body.height : 1.8) * 0.65;
    let best = null;
    let bestD = DODGE_RANGE;
    for (const a of G.actors) {
      if (!this._hostile(p, a) || typeof a.getAimDirection !== 'function' || typeof a.getEyePosition !== 'function') continue;
      a.getEyePosition(_oe);
      _to.subVectors(_me, _oe);
      const d = _to.length();
      if (d >= bestD || d < 0.5) continue;
      a.getAimDirection(_od);
      const ang = Math.acos(clamp(_to.dot(_od) / d, -1, 1));
      if (ang > DODGE_CONE + Math.atan(0.4 / d)) continue;
      // Sicht des Gegners auf mich (zwischengespeichert, eigener Schlüssel je Gegner)
      const key = a.id || a;
      const c = this._los.get(key);
      let v;
      if (c && now - c.t < LOS_TTL) v = c.v;
      else {
        v = !G.world || !G.world.lineOfSight || G.world.lineOfSight(_oe, _me) ? 1 : 0;
        this._los.set(key, { t: now, v });
      }
      if (!v) continue;
      best = a;
      bestD = d;
    }
    return best;
  }

  /** Freier Weg (m, höchstens 2) in Weltrichtung (dx, dz) auf Hüfthöhe – Kollisionsgeometrie. */
  _free(p, dx, dz) {
    const w = this.G.world;
    if (!w || typeof w.collisionRaycast !== 'function') return 2;
    _pt.copy(p.position);
    _pt.y += 0.9;
    _ray.set(dx, 0, dz);
    const hit = w.collisionRaycast(_pt, _ray, 2);
    return hit ? hit.distance : 2;
  }

  /** Ausweichen: Seitschritt quer zur Linie Gegner → ich über input.move (im eigenen Blickrahmen), mitunter mit Sprung. */
  _evade(p, input, dt, now) {
    const D = this._dodge;
    D.cool = Math.max(0, D.cool - dt);
    if (D.t <= 0 && D.cool <= 0) {
      const threat = this._threatOf(p, now);
      this.threat = threat;
      if (threat) {
        const lx = p.position.x - threat.position.x;
        const lz = p.position.z - threat.position.z;
        const l = Math.hypot(lx, lz) || 1;
        const px = -lz / l;
        const pz = lx / l;
        // abwechselnd (schwer vorherzusagen), aber zur deutlich freieren Seite
        let side = D.side ? -D.side : Math.random() < 0.5 ? 1 : -1;
        if (this._free(p, px * -side, pz * -side) > this._free(p, px * side, pz * side) + 0.4) side = -side;
        D.side = side;
        D.dx = px * side;
        D.dz = pz * side;
        D.t = DODGE_TIME;
        this.stats.dodges++;
        if (p.body && p.body.onGround && !p.prone && Math.random() < DODGE_JUMP) tap(input, 'jump');
      }
    }
    if (D.t <= 0) return;
    D.t -= dt;
    if (D.t <= 0) D.cool = DODGE_PAUSE;
    // Weltrichtung → Eingabe (x rechts, y vorwärts) im Blickrahmen dieses Bildes (Betrag 1 = normales Lauftempo)
    const s = Math.sin(p.yaw);
    const c = Math.cos(p.yaw);
    input.move.x = D.dx * c - D.dz * s;
    input.move.y = -D.dx * s - D.dz * c;
  }
}
