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
import { EQUIPMENT, WEAPONS, killAmmoFor } from '../shared/weapons.data.js';

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
export const MOUNT_WEAPON = 'lmg_hm60'; // Waffe einer MG-Stellung (unendlich Munition, ruhiger Rückstoß)
const MOUNT_REACH = 1.5; // m vom Platz des Schützen
const LOOT_REACH = 2.3; // m von der Stelle, an der jemand gefallen ist (Körper rutscht/kippt etwas)
const LOOT_LIFE = 120; // s bleibt Beute liegen
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
      const pos = new THREE.Vector3(x, floorAt(world, x, z), z);
      const p = { i: this.points.length, kind, def, position: pos, readyAt: 0, mesh: this._mesh(def, pos) };
      this.points.push(p);
      this.group.add(p.mesh);
    }
    if (G.scene) G.scene.add(this.group);
    // Beute an Gefallenen: Munition (Spielstil Realistisch statt Munition pro Abschuss) und Waffe (Einstellung „Waffen von Leichen“)
    this.loot = [];
    this._offKill = G.events.on('kill', (e) => this._onKill(e));
  }

  /** Waffen von Leichen erlaubt? Online Raum-Einstellung des Hosts, offline Spieleinstellung (Standard an). */
  lootWeaponsAllowed() {
    const G = this.G;
    const M = G.match;
    if (!M || M.modeId === 'gun' || M.modeId === 'messer' || M.modeId === 'training') return false;
    if (M.net) return M.net.lootWeapons !== false;
    return !(G.settings && typeof G.settings.get === 'function' && G.settings.get('lootWeapons') === false);
  }

  _onKill(e) {
    const G = this.G;
    const v = e && e.victim;
    if (!v || v === G.player || !v.position || v.isStreakEntity || v.vehicle) return;
    const W = G.weapons;
    const ammo = !!(G.match && G.match.style === 'realistisch' && W && typeof W.killAmmoEnabled === 'function' && W.killAmmoEnabled());
    const wid = victimWeapon(v);
    const weapon = wid && this.lootWeaponsAllowed() ? wid : null;
    if (!ammo && !weapon) return;
    const now = G.time.elapsed;
    this.loot = this.loot.filter((l) => l.until > now && l.victim !== v);
    this.loot.push({ victim: v, netId: v.netId, name: v.name || 'Gefallener', position: v.position.clone(), ammo, weapon, until: now + LOOT_LIFE });
    if (this.loot.length > 40) this.loot.shift();
  }

  /** Beute aufnehmen: zuerst Munition (falls vorhanden), beim nächsten Druck die Waffe. → bool */
  _takeLoot(l) {
    const G = this.G;
    const P = G.player;
    const w = P.weapon;
    if (l.ammo) {
      l.ammo = false;
      let got = 0;
      for (const st of (w && w.slots) || []) {
        if (!st || !st.def || !(st.def.mag > 0) || st.def.cls === 'melee') continue;
        const k = killAmmoFor(st.def);
        const r = w.grantAmmo(st, k.amount, { belt: k.belt, cap: k.cap });
        if (r) got += r.mag + r.reserve;
      }
      const eq = w && w.equipment;
      if (eq && eq.lethal && eq.lethal.id && eq.lethal.count < 1) { eq.lethal.count = 1; got++; }
      G.events.emit('loot:take', { actor: P, kind: 'ammo', amount: got, name: l.name });
      if (got) this._sound('reload_mag_in', l);
      if (!l.weapon) this.loot.splice(this.loot.indexOf(l), 1);
      return true;
    }
    if (l.weapon) {
      const def = WEAPONS[l.weapon];
      if (!def || !w || typeof w.setLoadout !== 'function') return false;
      const cur = w.slots.map((s) => s.id);
      const lo = { primary: cur[0], secondary: cur[1] === undefined ? null : cur[1] };
      if (def.slot === 'secondary') lo.secondary = def.id;
      else lo.primary = def.id;
      if (lo.primary === lo.secondary) lo.secondary = null;
      const was = def.slot === 'secondary' ? cur[1] : cur[0];
      w.setLoadout(lo);
      const idx = w.slots.findIndex((s) => s.id === def.id);
      if (idx >= 0 && idx !== w.index && typeof w.switchTo === 'function') w.switchTo(idx);
      const sync = G.net && G.net.sync;
      if (sync && typeof sync.sendLoot === 'function') sync.sendLoot(def.id, l.netId);
      G.events.emit('loot:take', { actor: P, kind: 'weapon', weaponId: def.id, dropped: was, name: l.name });
      this._sound('equip', l);
      this.loot.splice(this.loot.indexOf(l), 1);
      return true;
    }
    return false;
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
    if (P && P.mounted) { this._updateMounted(P); return; }
    if (!P || !P.alive || P.vehicle || P.piloting || G.match.state !== 'playing') return;
    // MG-Stellung (world.emplacements): hinter der Waffe stehen → bedienen
    const em = (G.world && G.world.emplacements) || [];
    for (const e of em) {
      if (Math.hypot(e.x - P.position.x, e.z - P.position.z) > MOUNT_REACH || Math.abs(e.y - P.position.y) > 1.2) continue;
      if (G.actors.some((a) => a !== P && a.alive && a.mounted && a.mounted.emp === e)) continue;
      this.near = { mount: e, left: 0, text: 'MG bedienen (unendlich Munition, 250°)' };
      if (G.input && G.input.pressed('interact')) { G.input.consume && G.input.consume('interact'); this.mount(e); }
      return;
    }
    let best = null, bd = REACH;
    for (const p of this.points) {
      const d = Math.hypot(p.position.x - P.position.x, p.position.z - P.position.z);
      if (d < bd && Math.abs(p.position.y - P.position.y) < 2.5) { bd = d; best = p; }
    }
    if (!best && this.loot.length) {
      let bl = null, bld = LOOT_REACH;
      for (const l of this.loot) {
        if (l.until <= now) continue;
        const d = Math.hypot(l.position.x - P.position.x, l.position.z - P.position.z);
        if (d < bld && Math.abs(l.position.y - P.position.y) < 2) { bld = d; bl = l; }
      }
      if (bl) {
        this.near = { loot: bl, left: 0, text: bl.ammo ? `Munition aufnehmen · ${bl.name}` : `${(WEAPONS[bl.weapon] || {}).name || bl.weapon} aufheben` };
        if (G.input && G.input.pressed('interact') && !(G.mode && G.mode.id === 'training')) this.use();
        return;
      }
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
    if (n.loot) { const ok = this._takeLoot(n.loot); this.near = null; return ok; }
    if (n.mount) return this.mount(n.mount);
    if (n.unmount) { this.unmount(); return true; }
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

  /**
   * MG-Stellung bedienen: Spieler steht auf dem Platz des Schützen, Blick in Feuerrichtung, Drehbereich e.arc (250°),
   * Waffe MOUNT_WEAPON mit unendlich Munition (controller.infiniteAmmo liest player.mounted) und ruhigem Rückstoß.
   * Die eigene Ausrüstung samt Munitionsstand kommt beim Verlassen (F, Springen, Tod) zurück.
   */
  mount(e) {
    const G = this.G;
    const P = G.player;
    const w = P && P.weapon;
    if (!w || !P.alive || P.mounted || typeof w.setLoadout !== 'function') return false;
    const saved = {
      lo: { primary: w.slots[0] ? w.slots[0].id : null, secondary: w.slots[1] ? w.slots[1].id : null },
      ammo: w.slots.map((s) => ({ id: s.id, mag: s.mag, reserve: s.reserve })),
      index: w.index,
    };
    if (P.prone && typeof P._leaveProne === 'function') P._leaveProne('stand');
    P.crouching = false;
    P.mounted = { emp: e, yaw0: Math.atan2(-e.dx, -e.dz), arc: e.arc, saved };
    P.position.set(e.x, e.y, e.z);
    if (P.body && P.body.velocity) P.body.velocity.set(0, 0, 0);
    P.yaw = P.mounted.yaw0;
    P.pitch = 0;
    w.setLoadout({ primary: MOUNT_WEAPON, secondary: null });
    G.events.emit('mount:enter', { actor: P, emplacement: e });
    return true;
  }

  unmount() {
    const G = this.G;
    const P = G.player;
    const m = P && P.mounted;
    if (!m) return;
    P.mounted = null;
    const w = P.weapon;
    if (w && typeof w.setLoadout === 'function' && m.saved.lo.primary) {
      w.setLoadout(m.saved.lo);
      for (const a of m.saved.ammo) { const st = w.slots.find((s) => s.id === a.id); if (st) { st.mag = a.mag; st.reserve = a.reserve; } }
      if (m.saved.index < w.slots.length && m.saved.index !== w.index && typeof w.switchTo === 'function') w.switchTo(m.saved.index);
    }
    G.events.emit('mount:exit', { actor: P, emplacement: m.emp });
  }

  _updateMounted(P) {
    const G = this.G;
    const m = P.mounted;
    const e = m.emp;
    if (!P.alive || G.match.state !== 'playing') { this.unmount(); return; }
    // fest auf dem Platz (kein Laufen; Blickgrenzen in player.js)
    P.position.set(e.x, e.y, e.z);
    if (P.body && P.body.velocity) P.body.velocity.set(0, 0, 0);
    this.near = { unmount: true, left: 0, text: 'MG verlassen' };
    const input = G.input;
    if (input && (input.pressed('interact') || input.pressed('jump'))) { if (input.consume) { input.consume('interact'); input.consume('jump'); } this.unmount(); }
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
    if (!p || !p.position) return;
    const au = this.G.audio;
    if (au && typeof au.play === 'function') { try { au.play(name, { position: p.position, volume: 0.8 }); } catch { /* Klang ist Beiwerk */ } }
  }

  dispose() {
    if (this.G.player && this.G.player.mounted) this.G.player.mounted = null;
    if (this._offKill) { this._offKill(); this._offKill = null; }
    this.loot.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.points.length = 0;
    this.near = null;
  }
}

/** Schusswaffe eines Gefallenen (Bot/Puppe: gehaltene Waffe, sonst Hauptwaffe der Ausrüstung) – keine Nahkampfwaffen/Werfer. */
function victimWeapon(v) {
  const ids = [v.weapon && v.weapon.currentDef && v.weapon.currentDef.id, v.weaponId, v.loadout && v.loadout.primary];
  for (const id of ids) {
    const d = id && WEAPONS[id];
    if (d && (d.slot === 'primary' || d.slot === 'secondary') && d.cls !== 'melee' && d.cls !== 'launcher') return id;
  }
  return null;
}

/** Unterster begehbarer Boden unter (x, z): von oben nach unten durch Dächer/Stege bis zum Grund (Flaggen/Startbereiche liegen ebenerdig). */
function floorAt(world, x, z) {
  if (!world || typeof world.groundHeight !== 'function') return 0;
  let y = world.groundHeight(x, z, 60);
  if (!Number.isFinite(y)) return 0;
  let from = y - 0.05;
  for (let i = 0; i < 12; i++) {
    const h = world.groundHeight(x, z, from);
    if (!Number.isFinite(h)) break;
    if (h < y - 1) y = h; // tiefer liegender Boden (sonst Unterseite derselben Platte – darunter weitersuchen)
    from = h - 0.05;
  }
  return y;
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
