// NULLPUNKT — Gedächtnis eines Bots: letzte bekannte Positionen von Gegnern (gesehen, gehört,
// getroffen, Teamfunk, Aufklärer), Entdeckungsgrad (spot 0..1) und Zeitstempel. Vergisst nach Ablauf.
import * as THREE from 'three';

export class Memory {
  constructor() {
    this.map = new Map();
  }

  _rec(actor) {
    let r = this.map.get(actor);
    if (!r) {
      r = {
        actor, pos: new THREE.Vector3().copy(actor.position), vel: new THREE.Vector3(), time: -1e9, seenAt: -1e9,
        visible: false, visibleSince: -1e9, spot: 0, acquiredAt: -1e9, source: 'none', accuracy: 99, hurtMe: -1e9, partial: false,
      };
      this.map.set(actor, r);
    }
    return r;
  }

  get(actor) { return this.map.get(actor) || null; }

  /** Sichtkontakt (Position exakt). */
  see(actor, now, dt) {
    const r = this._rec(actor);
    if (r.visible && dt > 0 && now - r.seenAt < 0.6) {
      // Geschwindigkeit glätten (für Vorhalten/Verfolgen)
      const k = Math.min(1, dt * 6);
      r.vel.x += ((actor.position.x - r.pos.x) / dt - r.vel.x) * k;
      r.vel.z += ((actor.position.z - r.pos.z) / dt - r.vel.z) * k;
      if (r.vel.lengthSq() > 144) r.vel.setLength(12);
    } else if (!r.visible) {
      r.visibleSince = now;
    }
    r.pos.copy(actor.position);
    r.time = now;
    r.seenAt = now;
    r.visible = true;
    r.source = 'sight';
    r.accuracy = 0;
    return r;
  }

  lost(actor) {
    const r = this.map.get(actor);
    if (r) r.visible = false;
  }

  /** Geräusch/Funk: ungefähre Position mit Fehler (m). */
  hear(actor, pos, now, error = 2, source = 'sound') {
    const r = this._rec(actor);
    if (r.visible && now - r.seenAt < 0.5) return r;
    // nur übernehmen, wenn neuer bzw. genauer als bisher
    if (now - r.time < 0.8 && r.accuracy < error) return r;
    const a = Math.random() * Math.PI * 2, e = Math.random() * error;
    r.pos.set(pos.x + Math.cos(a) * e, pos.y, pos.z + Math.sin(a) * e);
    r.vel.set(0, 0, 0);
    r.time = now;
    r.accuracy = error;
    r.source = source;
    return r;
  }

  /** Getroffen: Schütze grob bekannt. */
  damaged(actor, now) {
    const r = this.hear(actor, actor.position, now, 1.5, 'damage');
    r.hurtMe = now;
    r.spot = Math.max(r.spot, 0.6);
    return r;
  }

  forget(now, horizon = 14) {
    for (const [a, r] of this.map) {
      if (!a.alive || now - r.time > horizon) this.map.delete(a);
    }
  }

  remove(actor) { this.map.delete(actor); }
  clear() { this.map.clear(); }

  /** Frischester nicht sichtbarer Eintrag (für Verfolgen/Jagen). */
  freshestUnseen(now, maxAge = 10) {
    let best = null;
    for (const r of this.map.values()) {
      if (r.visible || !r.actor.alive || now - r.time > maxAge) continue;
      if (!best || r.time > best.time) best = r;
    }
    return best;
  }
}
