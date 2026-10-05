// NULLPUNKT — Wegfolge: NavGraph-Pfade (über die Pfad-Warteschlange des Managers, Budget pro Bild),
// Wegpunkte nur mit passender Höhe abhaken (|dy| < 0,6 m – Treppenpodeste), Abkürzen vorbeigelaufener
// Punkte, Absprünge, lokales Ausweichen (Verbündete, Wände), Festhänge-Erkennung mit gestufter
// Erholung (Springen + Seitschritt → neu planen → Ziel verwerfen → zum nächsten Knoten → unsichtbar versetzen).
import * as THREE from 'three';

const _d = new THREE.Vector3();
const _s = new THREE.Vector3();

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
  }

  /** Neues Ziel (behält den Pfad, wenn sich das Ziel kaum ändert). */
  goTo(pos, { tolerance = 0.8, repath = 1.5, force = false } = {}) {
    this.tolerance = tolerance;
    if (!force && this.dest && this.dest.distanceToSquared(pos) < repath * repath && (this.path.length || this.pending)) return;
    if (!this.dest) this.dest = new THREE.Vector3();
    this.dest.copy(pos);
    this.arrived = false;
    this.failed = false;
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
    if (!nav) { this.path = [this.dest.clone()]; this.idx = 0; this.pending = false; return; }
    this.pending = true;
    this.requestedAt = bot.G.time.elapsed;
    bot.manager.requestPath(bot, this.dest);
  }

  /** Vom Manager: Ergebnis der Pfadsuche. */
  onPath(path) {
    this.pending = false;
    if (!path || !path.length) {
      // kein Weg: direkt versuchen, wenn nah, sonst als fehlgeschlagen melden
      if (this.dest && this.dest.distanceTo(this.bot.position) < 6) { this.path = [this.dest.clone()]; this.idx = 0; }
      else { this.path = []; this.failed = true; }
      return;
    }
    this.path = path;
    this.idx = 0;
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
      // vorbeigelaufen (in Laufrichtung hinter dem Punkt, gleiche Höhe)
      if (!last && dh < 1.6 && Math.abs(dy) < 0.5) {
        const n = path[this.idx + 1];
        _d.set(n.x - p.x, 0, n.z - p.z);
        const along = (pos.x - p.x) * _d.x + (pos.z - p.z) * _d.z;
        if (along > 0.05 && Math.abs(n.y - pos.y) < 0.6) { this.idx++; continue; }
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
        this.path = [node.position.clone()];
        this.idx = 0;
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
