// NULLPUNKT — Wegfolge: NavGraph-Pfade (über die Pfad-Warteschlange des Managers, Budget pro Bild),
// Wegpunkte nur mit passender Höhe abhaken (|dy| < 0,6 m – Treppenpodeste), vorbeigelaufene Punkte nur
// auf gleicher Ebene oder auf (fast) gerader Strecke abkürzen (Kehren/Podeste nie), Absprünge, lokales
// Ausweichen (Verbündete, Wände), Festhänge-Erkennung mit gestufter Erholung (Springen + Seitschritt →
// neu planen → Ziel verwerfen → zum nächsten Knoten → unsichtbar versetzen) und Fortschrittswächter
// (Restweg sinkt in 6 s nicht um 1 m → neu planen + `failed`, damit die Entscheidung ein anderes Ziel wählt).
import * as THREE from 'three';

const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const PROGRESS_WINDOW = 6; // s ohne 1 m Fortschritt auf dem Restweg → Wächter greift
const LEVEL_DY = 0.2; // m: „gleiche Ebene“ für das Abkürzen vorbeigelaufener Wegpunkte
const SHORTCUT_COS = 0.5; // Abkürzen mit Höhenänderung nur bei Knick < 60°
const WALK_CHECK = 6; // m der direkten Strecke, deren Boden beim Abkürzen geprüft wird

export class Navigator {
  constructor(bot) {
    this.bot = bot;
    this.dest = null;
    this.path = [];
    this.idx = 0;
    this.tolerance = 0.8;
    this.pending = false;
    this.requestedAt = -1e9;
    this.failed = false;
    this.arrived = false;
    this.dir = new THREE.Vector3();
    this.stuck = { t: 0, last: new THREE.Vector3(), level: 0, sideUntil: 0, side: new THREE.Vector3(), total: 0 };
    this.jump = false;
    this.resume = false;
    this.start = new THREE.Vector3(); // Standort bei Pfadübernahme (Vorgänger des ersten Wegpunkts)
    this._rem = new Float64Array(16); // Restweglänge ab Wegpunkt i (Fortschrittswächter)
    this.progress = { best: Infinity, at: 0 };
    this.noProgress = 0; // Anzahl Wächter-Auslösungen (Diagnose)
    this._skipIdx = -1; // zuletzt abgelehnte Abkürzung (Wegpunkt) …
    this._skipAt = 0; // … und frühester Zeitpunkt der nächsten Prüfung
    // bots-scale: Wandkontakt (Laufrichtung gegen die Wand, kaum Tempo) → an der Wand entlang ausweichen, nach 3× neu planen
    this._wallT = 0;
    this._wallHits = 0;
    this.wallSlides = 0;
    this._sdir = new THREE.Vector3(); // geglättete Laufrichtung (kein Zittern an Ecken)
  }

  reset() {
    this.resume = false;
    this.dest = null;
    this.path = [];
    this.idx = 0;
    this.pending = false;
    this.failed = false;
    this.arrived = false;
    this.dir.set(0, 0, 0);
    this.stuck.t = 0;
    this.stuck.level = 0;
    this.stuck.total = 0;
    this.stuck.last.copy(this.bot.position);
    this.progress.best = Infinity;
    this.progress.at = this.bot.G.time.elapsed;
  }

  /** Neues Ziel (behält den Pfad, wenn sich das Ziel kaum ändert). */
  goTo(pos, { tolerance = 0.8, repath = 1.5, force = false } = {}) {
    this.tolerance = tolerance;
    if (!force && this.dest && this.dest.distanceToSquared(pos) < repath * repath && (this.path.length || this.pending)) return;
    if (!this.dest) this.dest = new THREE.Vector3();
    this.dest.copy(pos);
    this.arrived = false;
    this.failed = false;
    this.progress.best = Infinity;
    this.progress.at = this.bot.G.time.elapsed;
    this._request();
  }

  stop() {
    this.dest = null;
    this.path = [];
    this.idx = 0;
    this.pending = false;
    this.arrived = false;
    this.dir.set(0, 0, 0);
  }

  _request() {
    const bot = this.bot;
    const nav = bot.G.world && bot.G.world.nav;
    if (!nav) { this._setPath([this.dest.clone()]); this.pending = false; return; }
    this.pending = true;
    this.requestedAt = bot.G.time.elapsed;
    bot.manager.requestPath(bot, this.dest);
  }

  /** Vom Manager: Ergebnis der Pfadsuche. */
  onPath(path) {
    this.pending = false;
    if (!path || !path.length) {
      // kein Weg: direkt versuchen, wenn nah, sonst als fehlgeschlagen melden
      if (this.dest && this.dest.distanceTo(this.bot.position) < 6) this._setPath([this.dest.clone()]);
      else { this.path = []; this.failed = true; }
      return;
    }
    this._setPath(path);
    // Erster Wegpunkt steil über dem Bot (Bachbett unter der Brücke: nächster Knoten liegt auf der Fahrbahn) → erst
    // über eine begehbare Rampe zu einem Knoten der eigenen Ebene, von dort neu planen
    const pos = this.bot.position, p0 = path[0];
    const up = p0.y - pos.y;
    if (up > 1.6 && up > Math.hypot(p0.x - pos.x, p0.z - pos.z) * 0.6) this._escapeLevel();
  }

  /** Zu einem zu Fuß erreichbaren Knoten der eigenen Ebene ausweichen (statt senkrecht unter dem Zielknoten zu hängen). */
  _escapeLevel() {
    const q = this._levelEscape(this.bot.position);
    if (!q) return false;
    this._setPath([q.clone()]);
    this.resume = true;
    this.levelEscapes = (this.levelEscapes || 0) + 1;
    return true;
  }

  /** Nächster Knoten (≤ 26 m) auf ungefähr gleicher Höhe, zu dem eine begehbare Rampe führt. → Vector3 | null */
  _levelEscape(pos) {
    const nav = this.bot.G.world && this.bot.G.world.nav;
    if (!nav || typeof nav.nodesInRadius !== 'function') return null;
    const cands = nav.nodesInRadius(pos, 26);
    let tries = 0;
    for (const n of cands) {
      const q = n.position;
      const dy = q.y - pos.y;
      const h = Math.hypot(q.x - pos.x, q.z - pos.z);
      if (dy > 2.6 || dy < -1.2 || h < 1.2 || dy > h * 0.55 || !n.links || !n.links.length) continue;
      if (++tries > 12) break;
      if (this._rampOk(pos, q)) return q;
    }
    return null;
  }

  /** Strecke ohne Wand (Knie/Brust) mit durchgehendem, nicht zu steilem Boden (≤ 0,42 m Anstieg je 0,6 m)? */
  _rampOk(from, to) {
    const world = this.bot.G.world;
    if (!world || typeof world.lineOfSight !== 'function') return true;
    _a.set(from.x, from.y + 0.7, from.z);
    _b.set(to.x, to.y + 0.7, to.z);
    if (!world.lineOfSight(_a, _b)) return false;
    _a.y = from.y + 1.4;
    _b.y = to.y + 1.4;
    if (!world.lineOfSight(_a, _b)) return false;
    if (typeof world.groundHeight !== 'function') return true;
    const dx = to.x - from.x, dz = to.z - from.z;
    const steps = Math.max(2, Math.ceil(Math.hypot(dx, dz) / 0.6));
    let prev = from.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const g = world.groundHeight(from.x + dx * t, from.z + dz * t, prev + 0.9);
      if (g === null || g - prev > 0.42 || prev - g > 1.2) return false;
      prev = g;
    }
    return Math.abs(prev - to.y) < 0.7;
  }

  /** Freie Strecke (m, ≤ max) entlang dir auf Knie- und Brusthöhe (Kollisionsgeometrie). */
  _free(pos, dir, max) {
    const W = this.bot.G.world;
    const ray = W && (W.collisionRaycast || W.raycast);
    if (!ray) return max;
    let d = max;
    for (const y of [0.55, 1.2]) {
      _a.set(pos.x, pos.y + y, pos.z);
      const h = ray.call(W, _a, dir, max);
      if (h && h.distance < d) d = h.distance;
    }
    return d;
  }

  /** Pfad übernehmen + Restweglängen (Suffixsummen) für den Fortschrittswächter. */
  _setPath(path) {
    this.path = path;
    this.idx = 0;
    this._skipIdx = -1;
    this.start.copy(this.bot.position);
    const n = path.length;
    if (this._rem.length < n + 1) this._rem = new Float64Array(Math.max(n + 1, this._rem.length * 2));
    const rem = this._rem;
    rem[n] = 0;
    if (n) rem[n - 1] = 0;
    for (let i = n - 2; i >= 0; i--) rem[i] = rem[i + 1] + path[i].distanceTo(path[i + 1]);
  }

  /**
   * Darf der (in Laufrichtung schon passierte) Wegpunkt idx übersprungen werden? Nur auf einer Ebene
   * oder auf fast gerader Strecke (nie an Kehren/Podesten mit Höhenänderung) – und nur, wenn die
   * direkte Strecke vom Standort zum nächsten Punkt begehbar ist.
   */
  _canSkip(idx, pos, dy, now) {
    const path = this.path;
    const p = path[idx], n = path[idx + 1];
    const ny = n.y - pos.y;
    const level = Math.abs(dy) < LEVEL_DY && Math.abs(ny) < LEVEL_DY;
    if (!level) {
      if (Math.abs(dy) >= 0.5 || Math.abs(ny) >= 0.6) return false;
      const q = idx > 0 ? path[idx - 1] : this.start;
      const ax = p.x - q.x, az = p.z - q.z, bx = n.x - p.x, bz = n.z - p.z;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 0.1 || lb < 0.1 || (ax * bx + az * bz) / (la * lb) <= SHORTCUT_COS) return false;
    }
    if (idx === this._skipIdx && now < this._skipAt) return false;
    if (this._walkable(pos, n)) return true;
    this._skipIdx = idx;
    this._skipAt = now + 0.3;
    return false;
  }

  /** Direkte Strecke begehbar? Keine Wand auf Knie-/Brusthöhe, durchgehender Boden (erste Meter). */
  _walkable(from, to) {
    const world = this.bot.G.world;
    if (!world || typeof world.lineOfSight !== 'function') return true;
    _a.set(from.x, from.y + 0.62, from.z);
    _b.set(to.x, to.y + 0.62, to.z);
    if (!world.lineOfSight(_a, _b)) return false;
    _a.y = from.y + 1.25;
    _b.y = to.y + 1.25;
    if (!world.lineOfSight(_a, _b)) return false;
    if (typeof world.groundHeight !== 'function') return true;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const hl = Math.hypot(dx, dz);
    if (hl < 0.3) return true;
    const reach = Math.min(hl, WALK_CHECK);
    const steps = Math.max(2, Math.ceil(reach / 0.7));
    let prev = from.y;
    for (let i = 1; i <= steps; i++) {
      const t = (reach * i) / steps / hl;
      const y = from.y + dy * t;
      const g = world.groundHeight(from.x + dx * t, from.z + dz * t, y + 0.6);
      if (g === null || Math.abs(g - y) > 0.5 || Math.abs(g - prev) > 0.46) return false;
      prev = g;
    }
    return true;
  }

  /** Pro Bild: Wunschrichtung (horizontal, normiert oder 0). */
  update(dt, now, wantMove = true) {
    const bot = this.bot;
    const pos = bot.position;
    this.dir.set(0, 0, 0);
    this.jump = false;
    if (!this.dest) return this.dir;
    // Wegpunkte abhaken
    const path = this.path;
    while (this.idx < path.length) {
      const p = path[this.idx];
      const dh = Math.hypot(p.x - pos.x, p.z - pos.z);
      const dy = p.y - pos.y;
      const last = this.idx === path.length - 1;
      const r = last ? this.tolerance : 0.6;
      if (dh < r && Math.abs(dy) < 0.6) { this.idx++; continue; }
      // vorbeigelaufen (in Laufrichtung hinter dem Punkt): nur gleiche Ebene oder gerade Strecke
      if (!last && dh < 1.6) {
        const n = path[this.idx + 1];
        _d.set(n.x - p.x, 0, n.z - p.z);
        const along = (pos.x - p.x) * _d.x + (pos.z - p.z) * _d.z;
        if (along > 0.05 && this._canSkip(this.idx, pos, dy, now)) { this.idx++; continue; }
      }
      // Absprung: Punkt tiefer, wir sind (fast) darüber → weiterlaufen lassen
      if (dy < -0.9 && dh < 0.5) { this.idx++; continue; }
      break;
    }
    if (this.idx >= path.length) {
      if (this.resume && this.dest && !this.pending) { this.resume = false; this._request(); return this.dir; }
      if (!this.pending) {
        const d = Math.hypot(this.dest.x - pos.x, this.dest.z - pos.z);
        this.arrived = d < this.tolerance + 0.6 || path.length > 0;
      }
      return this.dir;
    }
    const p = path[this.idx];
    this.dir.set(p.x - pos.x, 0, p.z - pos.z);
    const len = this.dir.length();
    if (len > 1e-4) this.dir.multiplyScalar(1 / len);
    // Festhängen
    const st = this.stuck;
    if (wantMove) {
      st.t += dt;
      if (st.t > 0.9) {
        const moved = Math.hypot(pos.x - st.last.x, pos.z - st.last.z) + Math.abs(pos.y - st.last.y) * 0.5;
        if (moved < 0.3) { st.level++; st.total += st.t; this._recover(now); }
        else { st.level = Math.max(0, st.level - 1); st.total = 0; }
        st.t = 0;
        st.last.copy(pos);
      }
    } else { st.t = 0; st.last.copy(pos); }
    // Fortschrittswächter: Bewegung ohne Annäherung (Rutschen, Kreisen auf Treppen) erkennen
    const pr = this.progress;
    if (wantMove && !this.pending) {
      const rem = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z) + this._rem[this.idx];
      if (rem < pr.best - 1) { pr.best = rem; pr.at = now; }
      else if (now - pr.at > PROGRESS_WINDOW) {
        pr.best = rem;
        pr.at = now;
        this.failed = true; // Entscheidung wählt ein anderes Ziel; bis dahin vom aktuellen Standort neu planen
        this.noProgress++;
        // bots-scale: wiederholt an derselben Stelle ohne Fortschritt (Grube, Kante, Verbindung durch eine Mauer) →
        // außerhalb der Sicht des Spielers zum nächsten Wegpunkt versetzen
        const np = this._np || (this._np = { pos: new THREE.Vector3(1e9, 0, 0), run: 0 });
        np.run = np.pos.distanceToSquared(pos) < 16 ? np.run + 1 : 1;
        np.pos.copy(pos);
        if (np.run >= 2 && bot.manager.canTeleport(bot, p)) {
          bot.body.teleport(p);
          np.run = 0;
          this.unstuck = (this.unstuck || 0) + 1;
        } else if (np.run >= 2) {
          bot.manager.penalizeNav(p);
          if (this._escapeLevel()) return this.dir;
        }
        this._request();
      }
    } else if (!wantMove) pr.at = now;
    // Gegen eine Wand laufen (bots-scale): Richtung zeigt in die Wand, Tempo bleibt aus → entlang der Wand zum Weg hin
    const wn = bot.body.wallNormal;
    if (wantMove && wn && this.dir.x * wn.x + this.dir.z * wn.z < -0.55) {
      const v = bot.body.velocity;
      this._wallT = Math.hypot(v.x, v.z) < 0.8 ? this._wallT + dt : 0;
      if (this._wallT > 0.3 && now >= st.sideUntil) {
        this._wallT = 0;
        const nx = path[Math.min(this.idx + 1, path.length - 1)];
        // Seite wählen, auf der wirklich Platz ist (Pfosten/Ecke): quer zur Wand und schräg nach vorn messen
        let bestSide = 1, bestScore = -Infinity;
        for (const sg of [1, -1]) {
          _s.set(-wn.z * sg, 0, wn.x * sg);
          const side = this._free(pos, _s, 2.2);
          _d.copy(_s).add(this.dir).setY(0).normalize();
          const diag = this._free(pos, _d, 2.2);
          const score = Math.min(side, 1.4) + diag * 1.5 + (_s.x * (nx.x - pos.x) + _s.z * (nx.z - pos.z) > 0 ? 0.6 : 0);
          if (score > bestScore) { bestScore = score; bestSide = sg; }
        }
        _s.set(-wn.z * bestSide, 0, wn.x * bestSide);
        if (this._wallHits % 2 === 1) { _s.multiplyScalar(-1); this.jump = true; } // zweiter Versuch: andere Richtung + Sprung (niedrige Mauer)
        st.side.copy(_s).addScaledVector(wn, 0.35).normalize();
        st.sideUntil = now + 0.5;
        this.wallSlides++;
        if (++this._wallHits >= 3) {
          this._wallHits = 0;
          // derselbe Wegpunkt scheitert erneut (Nav-Verbindung durch ein Hindernis) → unbemerkt versetzen, sonst neu planen
          const wp = this._wallPt || (this._wallPt = new THREE.Vector3(1e9, 0, 0));
          this._wallRun = wp.distanceToSquared(p) < 1 ? (this._wallRun || 0) + 1 : 1;
          wp.copy(p);
          // Knoten hinter der gescheiterten Verbindung für diesen Match verteuern: alle Bots lernen daraus, A* sucht
          // einen anderen Weg (Nav-Verbindung durch Geländer/Mauer, z. B. Grenzland 7824→7825)
          bot.manager.penalizeNav(p);
          if (this._wallRun >= 2 && bot.manager.canTeleport(bot, p)) { bot.body.teleport(p); this._wallRun = 0; this.unstuck = (this.unstuck || 0) + 1; }
          else if (this.dest && !this.pending) this._request();
        }
      }
    } else if (this._wallT > 0) this._wallT = Math.max(0, this._wallT - dt);
    if (now < st.sideUntil) this.dir.lerp(st.side, 0.85).normalize();
    // leicht glätten (Wegpunktwechsel, Seitschritt): Ecken ohne Zittern; scharfe Kehren sofort
    const sd = this._sdir;
    if (sd.lengthSq() < 0.5 || sd.dot(this.dir) < 0.2) sd.copy(this.dir);
    else sd.lerp(this.dir, 1 - Math.exp(-20 * dt)).normalize();
    this.dir.copy(sd);
    return this.dir;
  }

  _recover(now) {
    const st = this.stuck;
    const bot = this.bot;
    const lvl = st.level;
    // Seitschritt quer zur Laufrichtung
    _s.set(-this.dir.z, 0, this.dir.x);
    if (_s.lengthSq() < 0.1) _s.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _s.normalize().multiplyScalar(lvl % 2 ? 1 : -1);
    st.side.copy(_s);
    st.sideUntil = now + 0.45;
    if (lvl === 1) this.jump = true;
    else if (lvl === 2) { this.jump = true; if (this.dest) this._request(); }
    else if (lvl === 3) { this.failed = true; }
    else if (lvl >= 4) {
      const nav = bot.G.world && bot.G.world.nav;
      const node = nav && nav.nearestReachable ? nav.nearestReachable(bot.position) : nav && nav.nearest(bot.position);
      // nächster Knoten liegt auf einer anderen Ebene (über dem Bot) → erst über eine Rampe auf die eigene Ebene
      if ((!node || node.position.y - bot.position.y > 1.6) && this._escapeLevel()) return;
      if (node) {
        // erst zum nächsten Knoten, danach neu planen
        this._setPath([node.position.clone()]);
        this.resume = true;
      }
      if (lvl >= 6 && node && bot.manager.canTeleport(bot, node.position)) {
        bot.body.teleport(node.position);
        st.level = 0;
        if (this.dest) this._request();
      }
    }
  }
}
