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
        this._request();
      }
    } else if (!wantMove) pr.at = now;
    if (now < st.sideUntil) this.dir.lerp(st.side, 0.85).normalize();
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
      if (node) {
        // erst zum nächsten Knoten, danach neu planen
        this._setPath([node.position.clone()]);
        this.resume = true;
      }
      if (lvl >= 6 && node && bot.manager.canTeleport(bot)) {
        bot.body.teleport(node.position);
        st.level = 0;
        if (this.dest) this._request();
      }
    }
  }
}
