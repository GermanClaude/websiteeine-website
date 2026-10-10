// NULLPUNKT — Interaktionspunkte der Karten (Taste F bzw. Antippen der Aufforderung im HUD, ui/hud.js _updatePrompt).
// Jede Karte hat eigene Punkte: Munitionskiste und Sanitätsstation an beiden Startbereichen, dazu je Karte Besonderes an
// den Flaggenplätzen (Werk: Werkssirene + Leitstand, Hafen: Hafenradar + Nebelhorn, Altstadt: Glockenseil + Brunnen,
// Grenzland: Funkstation + Beobachtungsposten). Wirkungen: Munition auffüllen, heilen, Gegner markieren (Minikarte,
// player.spottedUntil/spottedBy), Glocke läuten (world.glocke). Jeder Punkt hat je Spieler eine Abklingzeit.
// Online: Munition und Markierung wirken beim Client selbst; Heilen meldet er dem Host ('point' {i}), der die Puppe heilt
// (netUse, prüft Abstand und Abklingzeit). Die Punkte sind reine Optik (keine Kollision) und liegen in G.scene
// (teardownMatch räumt sie mit weg; Geometrie und Materialien werden über Matches hinweg wiederverwendet).
import * as THREE from 'three';
import { MAPS } from '../shared/maps.data.js';
import { EQUIPMENT } from '../shared/weapons.data.js';

export const POINT_KINDS = Object.freeze({
  munition: { name: 'Munitionskiste', act: 'Munition auffüllen', effect: 'ammo', cooldown: 30, color: 0xc8a64a },
  sani: { name: 'Sanitätsstation', act: 'Heilen', effect: 'heal', cooldown: 25, color: 0xe8e8e0 },
  sirene: { name: 'Werkssirene', act: 'Sirene auslösen', effect: 'mark', radius: 45, duration: 6, cooldown: 60, color: 0xd8432c, sound: 'uav' },
  leitstand: { name: 'Leitstand', act: 'Kameras prüfen', effect: 'mark', radius: 400, duration: 5, cooldown: 90, color: 0x3d7fe0, sound: 'uav' },
  radar: { name: 'Hafenradar', act: 'Radar abfragen', effect: 'mark', radius: 400, duration: 6, cooldown: 90, color: 0x3d7fe0, sound: 'uav' },
  nebelhorn: { name: 'Nebelhorn', act: 'Horn blasen', effect: 'mark', radius: 50, duration: 6, cooldown: 60, color: 0xd8432c, sound: 'streak_ready' },
  glocke: { name: 'Glockenseil', act: 'Glocke läuten', effect: 'bell', radius: 40, duration: 6, cooldown: 75, color: 0xc8a64a },
  brunnen: { name: 'Brunnen', act: 'Trinken (heilen)', effect: 'heal', cooldown: 25, color: 0x5ab0e0 },
  funk: { name: 'Funkstation', act: 'Aufklärung anfordern', effect: 'mark', radius: 600, duration: 8, cooldown: 90, color: 0x7e9b5a, sound: 'uav' },
  fernglas: { name: 'Beobachtungsposten', act: 'Gelände absuchen', effect: 'mark', radius: 150, duration: 6, cooldown: 45, color: 0x7e9b5a, sound: 'toggle' },
});

// [Art, Bezug (sA/sB = Startbereich, fA/fB/fC = Flagge laut maps.data.js), Versatz x, Versatz z]
const BASE = [['munition', 'sA', 4, -3], ['sani', 'sA', -4, -3], ['munition', 'sB', 4, 3], ['sani', 'sB', -4, 3]];
export const POINT_LAYOUT = Object.freeze({
  werk: [...BASE, ['sirene', 'fB', 3, 0], ['leitstand', 'fA', 3, 0], ['leitstand', 'fC', 3, 0]],
  hafen: [...BASE, ['radar', 'fB', 3, 0], ['nebelhorn', 'fA', 3, 0], ['nebelhorn', 'fC', 3, 0]],
  altstadt: [...BASE, ['glocke', 'fB', 3, 0], ['brunnen', 'fA', 3, 0], ['brunnen', 'fC', 3, 0]],
  grenzland: [...BASE, ['funk', 'fB', 3, 0], ['fernglas', 'fA', 3, 0], ['fernglas', 'fC', 3, 0]],
  range: [['munition', 'sA', 4, -3], ['sani', 'sA', -4, -3]],
});

const REACH = 1.9; // m vom Punkt (waagerecht)
let SHARED = null; // Geometrie/Materialien (einmal je Seite)
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    crate: new THREE.BoxGeometry(0.9, 0.55, 0.6),
    strip: new THREE.BoxGeometry(0.92, 0.12, 0.62),
    pole: new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6),
    cap: new THREE.SphereGeometry(0.09, 10, 8),
    body: new THREE.MeshStandardMaterial({ color: 0x3b3f35, roughness: 0.8, metalness: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.5, metalness: 0.7 }),
    glow: new Map(),
  };
  return SHARED;
}
function glowMat(color) {
  const S = shared();
  let m = S.glow.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 }); S.glow.set(color, m); }
  return m;
}

export class MapPoints {
  constructor(G, mapId) {
    this.G = G;
    this.mapId = mapId;
    this.points = [];
    this.near = null; // { point, left } – nächster Punkt in Reichweite (HUD-Aufforderung)
    this.group = new THREE.Group();
    this.group.name = 'kartenpunkte';
    const data = MAPS[mapId];
    const layout = POINT_LAYOUT[mapId] || [];
    if (!data) return;
    const world = G.world;
    for (const [kind, ref, dx, dz] of layout) {
      const def = POINT_KINDS[kind];
      let bx = null, bz = null;
      if (ref[0] === 's') { const s = data.spawns && data.spawns[ref[1]]; if (s) { bx = s[0]; bz = s[1]; } }
      else { const f = (data.flags || []).find((x) => x.id === ref[1]); if (f) { bx = f.x; bz = f.z; } }
      if (bx == null || !def) continue;
      const x = bx + dx, z = bz + dz;
      const gy = world && typeof world.groundHeight === 'function' ? world.groundHeight(x, z, 60) : null;
      const pos = new THREE.Vector3(x, Number.isFinite(gy) ? gy : 0, z);
      const p = { i: this.points.length, kind, def, position: pos, readyAt: 0, mesh: this._mesh(def, pos) };
      this.points.push(p);
      this.group.add(p.mesh);
    }
    if (G.scene) G.scene.add(this.group);
  }

  _mesh(def, pos) {
    const S = shared();
    const g = new THREE.Group();
    g.position.copy(pos);
    const crate = new THREE.Mesh(S.crate, S.body);
    crate.position.y = 0.275;
    const strip = new THREE.Mesh(S.strip, glowMat(def.color));
    strip.position.y = 0.4;
    const pole = new THREE.Mesh(S.pole, S.metal);
    pole.position.set(0.38, 1.0, 0.22);
    const cap = new THREE.Mesh(S.cap, glowMat(def.color));
    cap.position.set(0.38, 1.78, 0.22);
    g.add(crate, strip, pole, cap);
    g.userData.cap = cap;
    return g;
  }

  update() {
    const G = this.G;
    const P = G.player;
    const now = G.time.elapsed;
    // Leuchtkappe pulsiert (bereit) bzw. steht still (Abklingzeit)
    for (const p of this.points) {
      const c = p.mesh.userData.cap;
      const s = now < p.readyAt ? 0.6 : 1 + 0.25 * Math.sin(now * 4 + p.i);
      c.scale.setScalar(s);
    }
    this.near = null;
    if (!P || !P.alive || P.vehicle || P.piloting || G.match.state !== 'playing') return;
    let best = null, bd = REACH;
    for (const p of this.points) {
      const d = Math.hypot(p.position.x - P.position.x, p.position.z - P.position.z);
      if (d < bd && Math.abs(p.position.y - P.position.y) < 2.5) { bd = d; best = p; }
    }
    if (!best) return;
    this.near = { point: best, left: Math.max(0, Math.ceil(best.readyAt - now)) };
    if (G.input && G.input.pressed('interact') && !(G.mode && G.mode.id === 'training')) this.use();
  }

  /** Nächsten Punkt benutzen (Taste F, HUD-Knopf). → bool */
  use() {
    const G = this.G;
    const P = G.player;
    const n = this.near;
    if (!n || !P || !P.alive) return false;
    const p = n.point;
    const def = p.def;
    const now = G.time.elapsed;
    if (now < p.readyAt) { G.events.emit('point:denied', { actor: P, point: p, left: p.readyAt - now }); return false; }
    let count = 0;
    if (def.effect === 'ammo') {
      count = refillAmmo(P);
      if (!count) { G.events.emit('point:denied', { actor: P, point: p, reason: 'voll' }); return false; }
      this._sound('reload_mag_in', p);
    } else if (def.effect === 'heal') {
      if (P.health >= P.maxHealth) { G.events.emit('point:denied', { actor: P, point: p, reason: 'gesund' }); return false; }
      P.health = P.maxHealth;
      count = 1;
      const sync = G.net && G.net.sync;
      if (sync && typeof sync.sendPoint === 'function') sync.sendPoint(p.i);
      this._sound('confirm', p);
    } else if (def.effect === 'mark' || def.effect === 'bell') {
      count = markAround(G, P, p.position, def.radius, now + def.duration);
      if (def.effect === 'bell' && G.world && G.world.glocke && typeof G.world.glocke.test === 'function') G.world.glocke.test('laeuten');
      if (def.sound) this._sound(def.sound, p);
    }
    p.readyAt = now + def.cooldown;
    G.events.emit('point:use', { actor: P, point: p, kind: p.kind, name: def.name, count });
    return true;
  }

  /** Host: Heilung eines Clients an Punkt i (Abstand der Puppe ≤ Reichweite + 1,5 m, Abklingzeit je Client). → bool */
  netUse(actor, i, from) {
    const p = this.points[i | 0];
    if (!p || !actor || !actor.alive || p.def.effect !== 'heal') return false;
    if (Math.hypot(p.position.x - actor.position.x, p.position.z - actor.position.z) > REACH + 1.5) return false;
    const key = `${from}#${p.i}`;
    const t = performance.now() / 1000;
    this._netReady = this._netReady || new Map();
    if (t < (this._netReady.get(key) || 0)) return false;
    this._netReady.set(key, t + p.def.cooldown * 0.9);
    actor.health = actor.maxHealth;
    return true;
  }

  _sound(name, p) {
    const au = this.G.audio;
    if (au && typeof au.play === 'function') { try { au.play(name, { position: p.position, volume: 0.8 }); } catch { /* Klang ist Beiwerk */ } }
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.points.length = 0;
    this.near = null;
  }
}

/** Reservemunition aller Waffen und Granaten auffüllen. → Anzahl aufgefüllter Plätze */
export function refillAmmo(actor) {
  const w = actor && actor.weapon;
  let count = 0;
  for (const st of (w && w.slots) || []) {
    if (!st || !st.def || !(st.def.reserve > 0) || st.reserve >= st.def.reserve) continue;
    w.grantAmmo(st, st.def.reserve - st.reserve);
    count++;
  }
  const eq = w && w.equipment;
  for (const k of ['lethal', 'tactical']) {
    const e = eq && eq[k];
    const full = e && e.id && EQUIPMENT[e.id] ? EQUIPMENT[e.id].count || 1 : 0;
    if (full && e.count < full) { e.count = full; count++; }
  }
  return count;
}

/** Gegner von actor im Umkreis r um pos bis `until` markieren (Minikarte). → Anzahl */
export function markAround(G, actor, pos, r, until) {
  let count = 0;
  for (const a of G.actors || []) {
    if (a === actor || !a.alive || a.isStreakEntity || !G.combat || !G.combat.isHostile(actor, a)) continue;
    if (a.position.distanceTo(pos) > r) continue;
    a.spottedUntil = Math.max(a.spottedUntil || 0, until);
    a.spottedBy = actor.team ?? actor;
    count++;
  }
  return count;
}
