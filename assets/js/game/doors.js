// NULLPUNKT — Bewegliche Türen und Tore (Daten aus dem Kartenbau: world.doors aus arch.js, world.gates z. B. die Rolltore
// der Hafen-Lagerhalle). Türen: F öffnet/schließt; geschlossen hält sie Gehende auf, wer im Sprint dagegenläuft, rammt
// sie auf; Bots öffnen sie im Vorbeigehen; Schüsse gehen durch (Holz, combat.js Durchschlag) und zerlegen sie nach
// genug Treffern; Explosionen reißen sie heraus. Tore: Schaltpult innen und außen (F) fährt das Tor hoch bzw. runter.
// Kollision/Kugeln über die beweglichen Festkörper von building.js (addSolid). Online entscheidet der Host:
// Client → 'door' {i, a: 't' (umschalten) | 'k' (auframmen) | 'h' (Treffer), d}; Host → 'ev' dr {i, s, b, k} an alle.
import * as THREE from 'three';
import { worldPartsFrom } from './building.js';

const DOOR_HP = 140;
const DOOR_T = 0.06;
const OPEN_TIME = 0.55, KICK_TIME = 0.14, GATE_TIME = 3.2;
const USE_REACH = 1.6, PANEL_REACH = 1.4;

let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }),
    gate: new THREE.MeshStandardMaterial({ color: 0xc9cdc9, roughness: 0.55, metalness: 0.45 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.4 }),
    green: new THREE.MeshStandardMaterial({ color: 0x2fae4a, emissive: 0x2fae4a, emissiveIntensity: 0.8 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8352a, emissive: 0xc8352a, emissiveIntensity: 0.8 }),
    box: new THREE.BoxGeometry(1, 1, 1),
    tints: new Map(),
  };
  return MATS;
}
function woodMat(tint) {
  if (!tint) return mats().wood;
  let m = MATS.tints.get(tint);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint), roughness: 0.75 }); MATS.tints.set(tint, m); }
  return m;
}
const ang = (d) => Math.atan2(-d[1], d[0]); // Richtung (x, z) → rotation.y (lokal +x zeigt dorthin)
const lerpAng = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };

export class Doors {
  constructor(G) {
    this.G = G;
    this.items = []; // Türen dann Tore (gleiche Indizes auf allen Geräten)
    this.near = null;
    this.group = new THREE.Group();
    this.group.name = 'tueren';
    const W = G.world;
    const M = mats();
    for (const d of (W && W.doors) || []) {
      const pivot = new THREE.Group();
      pivot.position.set(d.hx, d.y, d.hz);
      const leaf = new THREE.Mesh(M.box, woodMat(d.tint));
      leaf.scale.set(d.w, d.h, DOOR_T);
      leaf.position.set(d.w / 2, d.h / 2, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      pivot.add(leaf);
      // Klinke
      const knob = new THREE.Mesh(M.box, M.panel);
      knob.scale.set(0.12, 0.03, 0.14);
      knob.position.set(d.w - 0.1, 1.0, 0);
      pivot.add(knob);
      this.group.add(pivot);
      const it = { type: 'door', d, mesh: pivot, t: d.open ? 1 : 0, target: d.open ? 1 : 0, speed: 1 / OPEN_TIME, hp: DOOR_HP, broken: false, solid: null };
      it.solid = { id: `door${this.items.length}`, def: { surface: 'wood' }, mesh: pivot, parts: [], onHit: (dmg, by) => this._hit(it, dmg, by) };
      this.items.push(it);
    }
    for (const g of (W && W.gates) || []) {
      const mesh = new THREE.Mesh(M.box, M.gate);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      const lamps = [];
      for (const [px, pz, pry] of g.panels || []) {
        const post = new THREE.Group();
        post.position.set(px, g.y, pz);
        post.rotation.y = pry;
        const box = new THREE.Mesh(M.box, M.panel);
        box.scale.set(0.32, 0.45, 0.14);
        box.position.set(0, 1.25, 0);
        const pole = new THREE.Mesh(M.box, M.panel);
        pole.scale.set(0.08, 1.05, 0.08);
        pole.position.set(0, 0.52, 0);
        const lamp = new THREE.Mesh(M.box, M.green);
        lamp.scale.set(0.08, 0.08, 0.04);
        lamp.position.set(0, 1.32, 0.08);
        post.add(box, pole, lamp);
        this.group.add(post);
        lamps.push(lamp);
      }
      const top = g.y + g.h;
      const it = { type: 'gate', d: g, mesh, lamps, bottom: g.bottom ?? 0, target: g.bottom ?? 0, open: (g.bottom ?? 0) > 1, solid: null };
      it.solid = { id: `gate${this.items.length}`, def: { surface: 'metal' }, mesh, parts: [] };
      it.top = top;
      this.items.push(it);
    }
    if (G.scene) G.scene.add(this.group);
    for (const it of this.items) { this._pose(it); if (G.building) G.building.addSolid(it.solid); }
    this._offs = [G.events.on('explosion', (e) => this._onExplosion(e))];
  }

  get replica() { return this.G.match && this.G.match.netRole === 'client'; }

  /** Lage der Tür bzw. des Tors + Kollisionsteile. */
  _pose(it) {
    if (it.type === 'door') {
      const d = it.d;
      const a = lerpAng(ang(d.dc), ang(d.dopen), it.t);
      it.mesh.rotation.y = a;
      it.solid.parts = it.broken ? [] : worldPartsFrom([[d.w / 2, d.h / 2, 0, d.w / 2, d.h / 2, DOOR_T / 2, 0]], d.hx, d.y, d.hz, a);
    } else {
      const g = it.d;
      const h = Math.max(0.02, it.top - (g.y + it.bottom));
      const along = g.axis === 'z';
      it.mesh.scale.set(along ? g.t : g.w, h, along ? g.w : g.t);
      it.mesh.position.set(g.x, g.y + it.bottom + h / 2, g.z);
      it.solid.parts = h > 0.15 ? worldPartsFrom([[0, it.bottom + h / 2, 0, (along ? g.t : g.w) / 2, h / 2, (along ? g.w : g.t) / 2, 0]], g.x, g.y, g.z, 0) : [];
      const M = mats();
      for (const l of it.lamps) l.material = it.target > 1 ? M.green : M.red;
    }
  }

  update(dt) {
    const G = this.G;
    const P = G.player;
    for (const it of this.items) {
      if (it.type === 'door') {
        if (it.t !== it.target) {
          const step = dt * it.speed;
          it.t = it.t < it.target ? Math.min(it.target, it.t + step) : Math.max(it.target, it.t - step);
          this._pose(it);
        }
      } else if (it.bottom !== it.target) {
        const step = dt * (it.d.h / GATE_TIME);
        it.bottom = it.bottom < it.target ? Math.min(it.target, it.bottom + step) : Math.max(it.target, it.bottom - step);
        this._pose(it);
      }
    }
    if (!this.replica) this._botsOpen();
    this.near = null;
    if (!P || !P.alive || P.vehicle || P.piloting || P.mounted || P.building || G.match.state !== 'playing') return;
    // im Sprint gegen eine geschlossene Tür: auframmen
    if (P.sprinting) {
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (it.type !== 'door' || it.broken || it.target > 0 || it.t > 0.05) continue;
        if (this._doorDist(it, P.position) < 0.75 && Math.abs(P.position.y - it.d.y) < 1.2) { this.request(i, 'k'); break; }
      }
    }
    // F: nächste Tür bzw. nächstes Schaltpult
    if (G.points && G.points.near) return;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.broken) continue;
      let dd = Infinity;
      if (it.type === 'door') { if (Math.abs(P.position.y - it.d.y) < 1.2) dd = this._doorDist(it, P.position) - USE_REACH; }
      else for (const [px, pz] of it.d.panels || []) dd = Math.min(dd, Math.hypot(px - P.position.x, pz - P.position.z) - PANEL_REACH);
      if (dd < 0 && dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) return;
    const it = this.items[best];
    this.near = { i: best, text: it.type === 'door' ? (it.target > 0.5 ? 'Tür schließen' : 'Tür öffnen') : (it.target > 1 ? 'Tor schließen (Schaltpult)' : 'Tor öffnen (Schaltpult)') };
    if (G.input && G.input.pressed('interact') && !(G.mode && G.mode.id === 'training')) { G.input.consume('interact'); this.request(best, 't'); }
  }

  /** waagerechter Abstand eines Punkts zur Türfläche (Mitte des Blatts). */
  _doorDist(it, p) {
    const d = it.d;
    const a = it.mesh.rotation.y, dx = Math.cos(a), dz = -Math.sin(a);
    const px = p.x - d.hx, pz = p.z - d.hz;
    const along = Math.max(0, Math.min(d.w, px * dx + pz * dz));
    return Math.hypot(px - dx * along, pz - dz * along);
  }

  /** Bots (offline/Host) öffnen Türen und Tore, vor denen sie stehen. */
  _botsOpen() {
    const G = this.G;
    this._botT = (this._botT || 0) + 1;
    if (this._botT % 10) return;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.broken) continue;
      const closed = it.type === 'door' ? it.target < 0.5 && it.t < 0.5 : it.target < 1 && it.bottom < 2;
      if (!closed) continue;
      for (const a of G.actors) {
        if (!a.alive || !a.isBot || a.isRemoteHuman) continue;
        const near = it.type === 'door'
          ? this._doorDist(it, a.position) < 0.9 && Math.abs(a.position.y - it.d.y) < 1.2
          : Math.abs(a.position.x - it.d.x) < (it.d.axis === 'z' ? 1.3 : it.d.w / 2) && Math.abs(a.position.z - it.d.z) < (it.d.axis === 'z' ? it.d.w / 2 : 1.3);
        if (near) { this._apply(i, it.type === 'door' ? 1 : 2, false); break; }
      }
    }
  }

  /** Spieler-Aktion: offline/Host sofort, Client fragt den Host. */
  request(i, a, dmg = 0) {
    const it = this.items[i];
    if (!it) return;
    if (this.replica) {
      const sync = this.G.net && this.G.net.sync;
      const now = this.G.time.elapsed;
      if (a !== 'h' && now - (it._reqAt || -1) < 0.6) return; // nicht jedes Bild erneut anfragen
      it._reqAt = now;
      if (sync && typeof sync.sendDoor === 'function') sync.sendDoor(i, a, dmg);
      return;
    }
    this.act(i, a, this.G.player, dmg);
  }

  /** Offline/Host: Aktion ausführen (actor für Abstandsprüfung online). → bool */
  act(i, a, actor, dmg = 0) {
    const it = this.items[i];
    if (!it || it.broken) return false;
    if (a === 'h') { this._hit(it, dmg, actor); return true; }
    if (actor && actor.position) {
      const far = it.type === 'door' ? this._doorDist(it, actor.position) > USE_REACH + 1 : !(it.d.panels || []).some(([px, pz]) => Math.hypot(px - actor.position.x, pz - actor.position.z) < PANEL_REACH + 1.5);
      if (far) return false;
    }
    if (it.type === 'gate') return this._apply(i, it.target > 1 ? 0 : it.top - it.d.y - 0.3, false);
    if (a === 'k') return this._apply(i, 1, true);
    return this._apply(i, it.target > 0.5 ? 0 : 1, false);
  }

  /** Zustand setzen (+ an Clients verteilen). door: s 0/1, gate: s = Unterkante. */
  _apply(i, s, kick, broken = false, fromNet = false) {
    const it = this.items[i];
    if (!it) return false;
    if (it.type === 'door') {
      it.target = s;
      it.speed = 1 / (kick ? KICK_TIME : OPEN_TIME);
      if (kick) this._kickFx(it);
      else this._sound(it, 'gear', 0.5);
      if (broken && !it.broken) this._break(it);
    } else {
      it.target = s;
      this._sound(it, 'toggle', 0.9);
      this._pose(it);
    }
    const sync = this.G.net && this.G.net.sync;
    if (!fromNet && !this.replica && sync && typeof sync.relayDoor === 'function') sync.relayDoor(this._msg(i, kick));
    return true;
  }

  _msg(i, kick = false) {
    const it = this.items[i];
    return { i, s: Math.round((it.type === 'door' ? it.target : it.target) * 100) / 100, b: it.broken ? 1 : 0, k: kick ? 1 : 0 };
  }

  /** Abweichungen vom Kartenstand (für nachträglich beigetretene Clients). */
  snapshot() {
    const out = [];
    this.items.forEach((it, i) => {
      const def = it.type === 'door' ? (it.d.open ? 1 : 0) : it.d.bottom ?? 0;
      if (it.broken || it.target !== def) out.push(this._msg(i));
    });
    return out;
  }

  /** Client: Zustand vom Host ('ev' dr). */
  applyNet(m) {
    const it = this.items[m && m.i];
    if (!it) return;
    if (m.b && !it.broken) this._break(it);
    if (!it.broken) this._apply(m.i, Number(m.s) || 0, !!m.k, false, true);
  }

  /** Host: Wunsch eines Clients ('door' {i, a, d}). */
  netRequest(actor, m) {
    if (!actor || !actor.alive || !m || !Number.isInteger(m.i)) return;
    const a = m.a === 'k' || m.a === 'h' ? m.a : 't';
    const dmg = a === 'h' ? Math.max(0, Math.min(200, Number(m.d) || 0)) : 0;
    this.act(m.i, a, actor, dmg);
  }

  /** Treffer (Kugel, combat.js onHit): Splitter, ab 0 Leben zerbricht die Tür. */
  _hit(it, dmg, by) {
    if (it.broken || !(dmg > 0)) return;
    if (this.replica) {
      // Client: Treffer an den Host melden (gebündelt)
      if (by === this.G.player) this.request(this.items.indexOf(it), 'h', dmg);
      return;
    }
    it.hp -= dmg;
    if (it.hp <= 0) {
      this._break(it);
      const sync = this.G.net && this.G.net.sync;
      if (sync && typeof sync.relayDoor === 'function') sync.relayDoor(this._msg(this.items.indexOf(it)));
    }
  }

  _break(it) {
    it.broken = true;
    it.hp = 0;
    it.mesh.visible = false;
    it.solid.parts = [];
    if (this.G.building) this.G.building.removeSolid(it.solid);
    // Splitter (Einschläge rund um die Türmitte)
    const d = it.d;
    const a = it.mesh.rotation.y, dx = Math.cos(a), dz = -Math.sin(a);
    for (let k = 0; k < 5; k++) {
      const s = 0.15 + (k / 4) * (d.w - 0.3);
      const p = new THREE.Vector3(d.hx + dx * s, d.y + 0.4 + (k % 3) * 0.6, d.hz + dz * s);
      this.G.events.emit('impact', { point: p, normal: new THREE.Vector3(-dz, 0, dx), surface: 'wood', shooter: null, weaponId: null });
    }
    this._sound(it, 'impact_metal', 1);
    this.G.events.emit('door:broken', { door: it });
  }

  _kickFx(it) {
    this._sound(it, 'melee_hit', 1);
    this.G.events.emit('door:kick', { door: it });
  }

  _onExplosion(e) {
    if (!e || e.net || e.nonLethal || this.replica || !e.position) return;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.type !== 'door' || it.broken) continue;
      if (Math.hypot(it.d.hx - e.position.x, it.d.y + 1 - e.position.y, it.d.hz - e.position.z) < (e.radius || 4) * 0.8 + 1) this._hit(it, 999, e.attacker);
    }
  }

  _sound(it, name, volume) {
    const au = this.G.audio;
    const p = it.type === 'door' ? new THREE.Vector3(it.d.hx, it.d.y + 1, it.d.hz) : new THREE.Vector3(it.d.x, it.d.y + 1.5, it.d.z);
    if (au && typeof au.play === 'function') { try { au.play(name, { position: p, volume }); } catch { /* Klang ist Beiwerk */ } }
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    if (this.G.building) for (const it of this.items) this.G.building.removeSolid(it.solid);
    this.items.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
