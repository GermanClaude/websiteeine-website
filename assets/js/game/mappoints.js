// NULLPUNKT — Interaktionspunkte der Karten (Taste F bzw. Antippen der Aufforderung im HUD, ui/hud.js _updatePrompt).
// Jede Karte hat eigene Punkte: Munitionsausgabe und Sanitätsstation an beiden Startbereichen, dazu je Karte Besonderes an
// den Flaggenplätzen (Werk: Werkssirene + Leitstand, Hafen: Hafenradar + Nebelhorn, Altstadt: Glockenseil + Brunnen,
// Grenzland: Funkstation + Beobachtungsposten). Wirkungen: Munition auffüllen, heilen, Gegner markieren (Minikarte,
// player.spottedUntil/spottedBy), Glocke läuten (world.glocke). Jeder Punkt hat je Spieler eine Abklingzeit.
// Online: Munition und Markierung wirken beim Client selbst; Heilen meldet er dem Host ('point' {i}), der die Puppe heilt
// (netUse, prüft Abstand und Abklingzeit). Die Punkte liegen in G.scene (teardownMatch räumt sie mit weg; Geometrie und
// Materialien werden über Matches hinweg wiederverwendet). Die festen Teile der Stationen (Kistenstapel, Paletten, Trage)
// haben Kollision und halten Kugeln auf (mappoints-models.js STATION_SOLIDS → building.js addSolid, auf allen Geräten
// gleich; Teile über einem Spawnpunkt entfallen); Signalkappen der übrigen Punkte bleiben reine Optik.
// 21.10. (Nutzer): Munition, Sanität und Fahrzeug-Versorgung als glaubwürdige Stationen (mappoints-models.js). Auf großen
// Karten prüft der Aufbau je Munitionspunkt, ob ein Fahrzeug daneben auf offenem Feld halten kann (vehicleStand: Platz für
// die Wanne auf ebenem Boden, freier Himmel, nach zwei Seiten offen) – solche Punkte füllen auch Panzer und Geländewagen
// auf (vehicles/resupply.js). Je Gruppe von Panzer-Stellplätzen eines Teams entsteht dazu ein Versorgungsdepot im Freien.
// Nur wenn im Match Militärfahrzeuge unterwegs sind (nicht bei „Panzer & Fahrzeuge: Aus“, ?vehicles=0, Raum „Fahrzeuge
// aus“ – Host und Clients haben dieselbe Einstellung); Halteplätze und Depots halten Abstand zu allen Spawnpunkten.
import * as THREE from 'three';
import { MAPS, militaryVehiclesAllowed } from '../shared/maps.data.js';
import { EQUIPMENT, WEAPONS, CAMOS, killAmmoFor } from '../shared/weapons.data.js';
import { ATTACHMENTS } from '../shared/attachments.data.js';
import { stepDrop } from './bots/character.js';
import { collisionRay } from './engine/physics.js';
import { createStation, hasStationModel, STATION_SOLIDS } from './mappoints-models.js';
import { worldPartsFrom } from './building.js';

// vehicle: Punktart kann Fahrzeuge versorgen (wenn sie auf offenem Feld liegt, s. vehicleStand); reach: Griffweite (m)
export const POINT_KINDS = Object.freeze({
  munition: { name: 'Munitionsausgabe', act: 'Munition auffüllen', effect: 'ammo', cooldown: 30, color: 0xffb23a, vehicle: true, reach: 2.2 },
  sani: { name: 'Sanitätsstation', act: 'Heilen', effect: 'heal', cooldown: 25, color: 0x56e07e, reach: 2.2 },
  depot: { name: 'Fahrzeug-Versorgung', act: 'Munition auffüllen', effect: 'ammo', cooldown: 30, color: 0xffc23d, vehicle: true, reach: 2.8 },
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
  niemandsland: [...BASE],
  brandwald: [...BASE],
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
    this.quality = (G.renderer && G.renderer.quality) || 'high';
    // Stationen blicken zur Kartenmitte (Startbereiche) bzw. zum Halteplatz der Fahrzeuge (Depot)
    const fl = data.flags || [];
    const mid = fl.length ? fl.reduce((a, f) => [a[0] + f.x / fl.length, a[1] + f.z / fl.length], [0, 0]) : [0, 0];
    for (const [kind, ref, dx, dz] of layout) {
      const def = POINT_KINDS[kind];
      let bx = null, bz = null;
      if (ref[0] === 's') { const s = data.spawns && data.spawns[ref[1]]; if (s) { bx = s[0]; bz = s[1]; } }
      else { const f = (data.flags || []).find((x) => x.id === ref[1]); if (f) { bx = f.x; bz = f.z; } }
      if (bx == null || !def) continue;
      const x = bx + dx, z = bz + dz;
      const pos = new THREE.Vector3(x, floorAt(world, x, z), z);
      // Team: Startbereich A/B gehört dem Team (Fahrzeug-Versorgung nur für eigene Fahrzeuge), Flaggenpunkte neutral
      this._add(kind, pos, ref[0] === 's' ? ref[1] : null, Math.atan2(mid[0] - x, mid[1] - z));
    }
    // Fahrzeuge (nur große Karten, nur mit Militärfahrzeugen im Match – main.js meldet G.vehicles vorher an):
    // Munitionspunkte auf offenem Feld versorgen auch Fahrzeuge; je Stellplatzgruppe ein Depot
    this.military = militaryVehiclesAllowed(mapId) && militaryActive(G);
    if (this.military && world) {
      const t0 = performance.now();
      const ray = rayFn(G);
      const avoid = spawnPositions(world);
      for (const p of this.points) if (p.def.vehicle) p.stand = vehicleStand(world, p.position, ray, avoid);
      this._depots(world, ray, avoid);
      this.buildMs = Math.round(performance.now() - t0);
    }
    // feste Teile der Stationen (Kollision/Kugeln): Anmeldung im ersten update(), G.building entsteht nach den Punkten
    this._solids = world ? this._stationSolids(world) : [];
    this._solidsOn = false;
    if (G.scene) G.scene.add(this.group);
    // Beute an Gefallenen: Munition (Spielstil Realistisch statt Munition pro Abschuss) und Waffe (Einstellung „Waffen von Leichen“)
    this.loot = [];
    this._offKill = G.events.on('kill', (e) => this._onKill(e));
  }

  _add(kind, pos, team, yaw, extra = null) {
    const def = POINT_KINDS[kind];
    const p = { i: this.points.length, kind, def, position: pos, team: team || null, yaw, readyAt: 0, stand: null, mesh: this._mesh(def, pos, kind, yaw), ...(extra || {}) };
    this.points.push(p);
    this.group.add(p.mesh);
    return p;
  }

  /**
   * Fahrzeug-Versorgungsdepots: je Team die Panzer-/Geländewagen-Stellplätze (world.vehicleSpawns) zu Gruppen (≤ 45 m)
   * zusammenfassen und neben jeder Gruppe einen freien Platz im Freien suchen – hinter/neben den Stellplätzen (nicht in
   * der Ausfahrt), ≥ 9 m von jedem Stellplatz, ebener Boden für die Paletten, Halteplatz für eine Wanne daneben.
   * Feste Reihenfolge (gleiches Ergebnis auf Host und Clients).
   */
  _depots(world, ray, spawnPts = spawnPositions(world)) {
    const pads = (world.vehicleSpawns || []).filter((e) => e && (e.team === 'A' || e.team === 'B') && e.position);
    if (!pads.length) return;
    const groups = [];
    for (const e of pads) {
      const g = groups.find((x) => x.team === e.team && x.pads.some((q) => Math.hypot(q.position.x - e.position.x, q.position.z - e.position.z) < 45));
      if (g) g.pads.push(e); else groups.push({ team: e.team, pads: [e] });
    }
    const b = world.bounds;
    for (const g of groups) {
      // Bezug: die Panzer der Gruppe (Geländewagen sind wendig und nehmen jeden Punkt mit)
      const tanks = g.pads.filter((e) => e.type !== 'jeep');
      const A = tanks.length ? tanks : g.pads, n = A.length;
      const cx = A.reduce((a, e) => a + e.position.x, 0) / n, cz = A.reduce((a, e) => a + e.position.z, 0) / n;
      const cy = A.reduce((a, e) => a + e.position.y, 0) / n;
      // Ausfahrtrichtung der Gruppe (Gier 0 = Blick nach −z): dorthin kein Depot
      let fx = 0, fz = 0;
      for (const e of A) { fx -= Math.sin(e.yaw || 0); fz -= Math.cos(e.yaw || 0); }
      const fn = Math.hypot(fx, fz) || 1;
      fx /= fn; fz /= fn;
      const spread = A.reduce((a, e) => Math.max(a, Math.hypot(e.position.x - cx, e.position.z - cz)), 0);
      const cands = [];
      for (const d of [spread + 9, spread + 13, spread + 18, spread + 24]) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
          cands.push({ x: cx + dx * d, z: cz + dz * d, score: d * 0.12 + (1 + dx * fx + dz * fz) * 2.2 + k * 1e-4 });
        }
      }
      cands.sort((p, q) => p.score - q.score);
      let found = null;
      for (const c of cands) {
        if (b && (c.x < b.min.x + 8 || c.x > b.max.x - 8 || c.z < b.min.z + 8 || c.z > b.max.z - 8)) continue;
        if (pads.some((e) => Math.hypot(e.position.x - c.x, e.position.z - c.z) < 9)) continue;
        if (spawnPts.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 3.5)) continue;
        const y = floorAt(world, c.x, c.z);
        if (!Number.isFinite(y) || Math.abs(y - cy) > 4) continue;
        const pos = new THREE.Vector3(c.x, y, c.z);
        if (!depotFloor(world, pos, ray)) continue;
        const stand = vehicleStand(world, pos, ray, spawnPts);
        // Zufahrt: von jedem Panzer-Stellplatz der Gruppe geradeaus zum Halteplatz frei (keine Mauer, kein abgestellter
        // Wagen im Weg, keine Geländekante)
        if (stand && A.every((e) => approachClear(world, e.position, stand, pads, e))) { found = { pos, stand }; break; }
      }
      if (!found) continue;
      const { pos, stand } = found;
      this._add('depot', pos, g.team, Math.atan2(stand.x - pos.x, stand.z - pos.z), { stand });
    }
  }

  /**
   * Feste Teile aller Stationen in Weltlage (STATION_SOLIDS) – je Teil ein Festkörper { id, def: { surface }, mesh,
   * static, parts }. Teile, unter/in denen ein Spawnpunkt liegt (+ Körperradius), entfallen (niemand erscheint in Kisten).
   */
  _stationSolids(world) {
    const out = [];
    const spawns = spawnPositions(world);
    for (const p of this.points) {
      const list = STATION_SOLIDS[p.kind];
      if (!list) continue;
      const body = p.mesh.children.find((c) => c.isMesh) || p.mesh;
      list.forEach((e, k) => {
        const part = worldPartsFrom([e.box], p.position.x, p.position.y, p.position.z, p.yaw || 0)[0];
        const b = part.box;
        if (spawns.some((q) => q.x > b.min.x - 0.45 && q.x < b.max.x + 0.45 && q.z > b.min.z - 0.45 && q.z < b.max.z + 0.45 && Math.abs(q.y - p.position.y) < 2)) return;
        out.push({ id: `station${p.i}-${k}`, def: { surface: e.surface }, mesh: body, static: true, parts: [part] });
      });
    }
    return out;
  }

  /** Fahrzeugtaugliche Versorgungspunkte (offenes Feld) für ein Team (undefined = alle; neutrale Punkte immer). */
  vehiclePoints(team = undefined) {
    return this.points.filter((p) => p.stand && (team === undefined || team == null || p.team == null || p.team === team));
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
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      if (l.until <= now || l.victim === v) { this._dropGone(l); this.loot.splice(i, 1); }
    }
    // Waffe wie in der Hand: Aufsätze (def.att) und Tarnung des Gefallenen; das Modell fällt aus der Hand (character.js)
    // und wird hier übernommen, sobald es losgelassen ist (_tickLoot) – es bleibt liegen, bis es jemand aufhebt
    // Liegende Waffe bleibt so lange wie die Leichen (Einstellung „Leichen“, höchstens 40 Stück), Munition 2 min
    let life = LOOT_LIFE;
    try { if (weapon && G.bots && G.bots.corpses) life = Math.max(LOOT_LIFE, G.bots.corpses.life()); } catch { /* Standard */ }
    const { att, camo } = weapon ? looksOf(v, weapon) : { att: null, camo: null };
    this.loot.push({ victim: v, soldier: weapon ? v.soldier || null : null, drop: null, netId: v.netId, name: v.name || 'Gefallener', position: v.position.clone(), body: v.position.clone(), ammo, weapon, att, camo, until: now + life });
    if (this.loot.length > 40) this._dropGone(this.loot.shift());
  }

  /** Liegende Waffen: vom Körper übernehmen, fallen lassen, Beute-Stelle mitführen; Abgelaufenes wegräumen. */
  _tickLoot() {
    const G = this.G;
    const now = G.time.elapsed;
    const dt = Math.min(0.05, (G.time && G.time.dt) || 0.016);
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      if (l.until <= now) { this._dropGone(l); this.loot.splice(i, 1); continue; }
      if (!l.weapon) continue;
      if (!l.drop && l.soldier && typeof l.soldier.releaseDrop === 'function') { l.drop = l.soldier.releaseDrop(); if (l.drop) l.soldier = null; }
      if (l.drop) { stepDrop(l.drop, dt, G.world); if (!l.ammo) l.position.copy(l.drop.gun.position); }
    }
  }

  /**
   * Online: jemand anderes hat die Waffe des Gefallenen (Netz-Id) aufgehoben ('ev' lt) – vom Boden nehmen, damit sie
   * niemand ein zweites Mal aufhebt. → Aussehen der liegenden Waffe { att, camo } | null
   */
  takenByNet(victimNetId, weaponId) {
    const i = this.loot.findIndex((l) => l.netId === victimNetId && l.weapon === weaponId);
    if (i < 0) return null;
    const l = this.loot[i];
    const looks = { att: l.att || null, camo: l.camo || null };
    if (l.ammo) l.weapon = null; // Munition bleibt liegen
    else { this._dropGone(l); this.loot.splice(i, 1); }
    if (l.drop) this._dropGone(l);
    return looks;
  }

  _dropGone(l) {
    if (!l) return;
    if (l.drop && l.drop.gun) l.drop.gun.removeFromParent();
    l.drop = null;
    l.soldier = null;
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
      // genau die Waffe vom Boden: Aufsätze und Tarnung des Gefallenen – gehört einem bis zum eigenen Tod (main.js spawnActor)
      w.setLoadout({ ...lo, pickup: { id: def.id, att: l.att || null, camo: l.camo || null }, keepPickups: true });
      this._dropGone(l);
      const idx = w.slots.findIndex((s) => s.id === def.id);
      if (idx >= 0 && idx !== w.index && typeof w.switchTo === 'function') w.switchTo(idx);
      const sync = G.net && G.net.sync;
      if (sync && typeof sync.sendLoot === 'function') sync.sendLoot(def.id, l.netId, { att: l.att || null, camo: l.camo || null });
      G.events.emit('loot:take', { actor: P, kind: 'weapon', weaponId: def.id, dropped: was, name: l.name });
      this._sound('equip', l);
      this.loot.splice(this.loot.indexOf(l), 1);
      return true;
    }
    return false;
  }

  _mesh(def, pos, kind = null, yaw = 0) {
    if (kind && hasStationModel(kind)) {
      const st = createStation(kind, { quality: this.quality, color: def.color, yaw });
      st.group.position.copy(pos);
      st.group.name = `punkt-${kind}`;
      st.group.userData.cap = st.lamp;
      return st.group;
    }
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
    if (!this._solidsOn && G.building && this._solids) { for (const s of this._solids) G.building.addSolid(s); this._solidsOn = true; }
    this._tickLoot();
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
    // Reichweite je Art (größere Stationen: man steht neben den Kisten, nicht in der Mitte)
    let best = null, bd = 1;
    for (const p of this.points) {
      const d = Math.hypot(p.position.x - P.position.x, p.position.z - P.position.z) / (p.def.reach || REACH);
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
        const extra = [...Object.values(bl.att || {}).map((id) => ATTACHMENTS[id] && ATTACHMENTS[id].name), bl.camo && CAMOS[bl.camo] && CAMOS[bl.camo].name].filter(Boolean);
        this.near = { loot: bl, left: 0, text: bl.ammo ? `Munition aufnehmen · ${bl.name}` : `${(WEAPONS[bl.weapon] || {}).name || bl.weapon} aufheben${extra.length ? ` · ${extra.slice(0, 3).join(', ')}${extra.length > 3 ? ' …' : ''}` : ''}` };
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
    if (Math.hypot(p.position.x - actor.position.x, p.position.z - actor.position.z) > (p.def.reach || REACH) + 1.5) return false;
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
    for (const l of this.loot) this._dropGone(l);
    this.loot.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this._solidsOn && this.G.building) for (const s of this._solids) this.G.building.removeSolid(s);
    this._solids = [];
    this._solidsOn = false;
    this.points.length = 0;
    this.near = null;
  }
}

/** Schusswaffe eines Gefallenen (Bot/Puppe: gehaltene Waffe, sonst Hauptwaffe der Ausrüstung) – keine Nahkampfwaffen/Werfer. */
/**
 * Aussehen der Waffe weaponId in der Hand von v: online aufgehoben (Puppe: _carry), sonst Aufsätze der aktuellen Waffe
 * und Tarnung aus der Ausrüstung. → { att, camo }
 */
export function looksOf(v, weaponId) {
  const carry = v && v._carry && v._carry[weaponId];
  if (carry) return { att: carry.att ? { ...carry.att } : null, camo: carry.camo || null };
  const pk = v && v.weapon && v.weapon._pickups && v.weapon._pickups[weaponId]; // Spieler: selbst aufgehoben
  const cur = v && v.weapon && v.weapon.currentDef;
  const att = cur && (cur.baseId || cur.id) === weaponId && cur.att ? { ...cur.att } : pk && pk.att ? { ...pk.att } : null;
  const camo = pk ? pk.camo || null : v && v.loadout && v.loadout.camo && typeof v.loadout.camo[weaponId] === 'string' ? v.loadout.camo[weaponId] : null;
  return { att, camo };
}

/** Waffe, die v beim Tod in der Hand hatte (Schusswaffe; Werfer in der Hand → zuletzt die Hauptwaffe). */
function victimWeapon(v) {
  const ids = [v.weapon && v.weapon.currentDef && v.weapon.currentDef.id, v.weaponId, v.loadout && v.loadout.primary];
  for (const id of ids) {
    const d = id && WEAPONS[id];
    if (d && (d.slot === 'primary' || d.slot === 'secondary') && d.cls !== 'melee' && d.cls !== 'launcher') return id;
  }
  return null;
}

/* ---------------------------------------------------------------- Fahrzeugtauglichkeit (offenes Feld) */

const HULL = [1.95, 3.85]; // halbe Breite/Länge einer Wanne (größter Panzer + Rand)
const UP = new THREE.Vector3(0, 1, 0);
const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _rh = {};

/**
 * Militärfahrzeuge im Match? VehicleSystem angemeldet und nicht nur zivil (kleine Karte, Lobby/Raum „aus“); offline
 * schaltet ?vehicles=0 alle Stellplätze ab (vehicles/index.js _setupSpawns). Online zählt nur die Raum-Einstellung –
 * Host und Clients bauen dieselben Depots (deren Kollision muss überall gleich sein).
 */
function militaryActive(G) {
  if (!(G.vehicles && G.vehicles.attached && !G.vehicles.civilOnly)) return false;
  const param = G.params && typeof G.params.get === 'function' ? G.params.get('vehicles') : null;
  return !(param === '0' && !(G.match && G.match.netRole));
}

/** Alle Spawnpunkte der Welt (Teams, frei für alle, Hauptquartiere) als Positionen. */
function spawnPositions(world) {
  const sp = (world && world.spawns) || {};
  return [...(sp.A || []), ...(sp.B || []), ...(sp.ffa || []), ...((sp.hq && sp.hq.A) || []), ...((sp.hq && sp.hq.B) || [])].map((s) => s && s.position).filter(Boolean);
}

/** Liegt q in der Wanne bei (cx, cz) mit Gier yaw (plus Rand m)? */
function inHull(q, cx, cy, cz, yaw, m) {
  if (Math.abs(q.y - cy) > 3) return false;
  const dx = q.x - cx, dz = q.z - cz, c = Math.cos(yaw), s = Math.sin(yaw);
  return Math.abs(dx * c - dz * s) <= HULL[0] + m && Math.abs(dx * s + dz * c) <= HULL[1] + m;
}

/** Strahl gegen die Welt ohne Fahrzeughülle (gleiches Ergebnis auf Host und Clients, egal welche Fahrzeuge schon stehen). */
function rayFn(G) {
  const w = G.world, rc = G.vehicles && G.vehicles._rc;
  if (rc && rc.w === w) return (o, d, m) => rc.orig.call(w, o, d, m);
  return w && typeof w.raycast === 'function' ? (o, d, m) => w.raycast(o, d, m) : null;
}
/** Freier Himmel über (x, y, z)? (sichtbare Geometrie: Dächer, Hallen, Baumkronen) */
const skyFree = (ray, x, y, z) => !ray || !ray(_o.set(x, y, z), UP, 60);
const groundAt = (world, x, z, y0) => { const h = world.groundHeight(x, z, y0 + 3.5); return Number.isFinite(h) ? h : null; };

/** Wanne bei (cx, cy, cz) mit Gier yaw: ebener Boden (±0,55 m), Rumpfraum frei, Himmel frei. */
function hullClear(world, ray, cx, cy, cz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const toW = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const ring = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [lx, lz] of [[0, 0], ...ring]) {
    const [x, z] = toW(lx * HULL[0], lz * HULL[1]);
    const g = groundAt(world, x, z, cy);
    if (g == null || Math.abs(g - cy) > 0.55) return false;
  }
  for (const y of [0.7, 1.6, 2.5]) {
    for (const [lx, lz] of ring) {
      const [x, z] = toW(lx * HULL[0], lz * HULL[1]);
      _o.set(cx, cy + y, cz);
      _dir.set(x - cx, 0, z - cz);
      const len = _dir.length();
      if (collisionRay(world, _o, _dir.multiplyScalar(1 / len), len, _rh)) return false;
    }
  }
  if (!skyFree(ray, cx, cy + 2.8, cz)) return false;
  for (const lz of [-1, 1]) { const [x, z] = toW(0, lz * HULL[1]); if (!skyFree(ray, x, cy + 2.8, z)) return false; }
  return true;
}

/** „Offenes Feld“: von der Wanne aus in mindestens zwei von vier Richtungen 14 m frei (kein Hinterhof, keine Halle). */
function openSides(world, cx, cy, cz, yaw) {
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const a = yaw + (k * Math.PI) / 2;
    if (!collisionRay(world, _o.set(cx, cy + 1.5, cz), _dir.set(-Math.sin(a), 0, -Math.cos(a)), 14, _rh)) n++;
  }
  return n >= 2;
}

/**
 * Halteplatz für ein Fahrzeug neben dem Punkt pos (offenes Feld) oder null: der Punkt selbst unter freiem Himmel, daneben
 * (Breitseite 4,6 bzw. 6,4 m, Bug 6,4 m vom Punkt – die Station bleibt frei) Platz für die Wanne auf ebenem Boden,
 * freier Himmel, nach zwei Seiten offen; avoid: Spawnpunkte, die die Wanne (+ 2 m) nicht berühren darf (sonst erscheinen
 * Mitspieler im haltenden Panzer). Feste Suchreihenfolge. → { x, y, z, yaw }
 */
export function vehicleStand(world, pos, ray = null, avoid = null) {
  if (!world || typeof world.groundHeight !== 'function' || !pos) return null;
  if (!skyFree(ray, pos.x, pos.y + 2.2, pos.z)) return null;
  for (const [r, bow] of [[4.6, false], [6.4, false], [6.4, true]]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const cx = pos.x + Math.sin(a) * r, cz = pos.z + Math.cos(a) * r;
      const cy = groundAt(world, cx, cz, pos.y);
      if (cy == null || Math.abs(cy - pos.y) > 1.5) continue;
      const yaw = bow ? a : a + Math.PI / 2;
      if (avoid && avoid.some((q) => inHull(q, cx, cy, cz, yaw, 2))) continue;
      if (hullClear(world, ray, cx, cy, cz, yaw) && openSides(world, cx, cy, cz, yaw)) return { x: cx, y: cy, z: cz, yaw };
    }
  }
  return null;
}

/** Gerade Zufahrt von `from` (Stellplatz) zum Halteplatz `to`: Wannenbreite frei, keine anderen Stellplätze im Weg, sanftes Gelände. */
function approachClear(world, from, to, pads, self) {
  const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
  if (len < 1) return true;
  const ux = dx / len, uz = dz / len;
  for (const off of [-1.5, 0, 1.5]) {
    for (const h of [1.0, 2.0]) {
      _o.set(from.x - uz * off, from.y + h, from.z + ux * off);
      if (collisionRay(world, _o, _dir.set(ux, 0, uz), len, _rh)) return false;
    }
  }
  for (const e of pads) {
    if (e === self) continue;
    const px = e.position.x - from.x, pz = e.position.z - from.z;
    const t = Math.max(0, Math.min(len, px * ux + pz * uz));
    if (Math.hypot(px - ux * t, pz - uz * t) < 4.5) return false;
  }
  let last = from.y;
  for (let s = 3; s < len; s += 3) {
    const g = groundAt(world, from.x + ux * s, from.z + uz * s, last + 1);
    if (g == null || Math.abs(g - last) > 1.1) return false;
    last = g;
  }
  return true;
}

/** Depotfläche (4,2 × 2,6 m) eben, frei von Hindernissen, unter freiem Himmel. */
function depotFloor(world, pos, ray) {
  for (const [x, z] of [[-2.1, -1.3], [2.1, -1.3], [-2.1, 1.3], [2.1, 1.3]]) {
    const g = groundAt(world, pos.x + x, pos.z + z, pos.y);
    if (g == null || Math.abs(g - pos.y) > 0.45) return false;
    for (const y of [0.4, 1.3]) {
      _o.set(pos.x, pos.y + y, pos.z);
      _dir.set(x, 0, z);
      const len = _dir.length();
      if (collisionRay(world, _o, _dir.multiplyScalar(1 / len), len, _rh)) return false;
    }
  }
  return skyFree(ray, pos.x, pos.y + 2.4, pos.z);
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
