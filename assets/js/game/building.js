// NULLPUNKT — Bauen im Gefecht (Taste K, Touch-Knopf): Sandsackwall und Schützenloch für alle Klassen, dazu für den
// Pionier MG-Nest (benutzbar wie die MG-Stellungen der Karten, mappoints.js) und kleiner Bunker. Der Pionier baut doppelt
// so schnell (Pioniershammer). Ablauf: K öffnet den Baumodus mit Vorschau (grün = passt, rot = nicht), K wechselt das
// Bauwerk, Linksklick setzt, F bricht ab. Das Bauwerk wächst über die Bauzeit (Hammerschläge) und ist danach fest:
// Kollision für Spieler/Bots (zusätzliche Dreiecke im world.collider), hält Kugeln auf (world.raycast/lineOfSight),
// Explosionen beschädigen es bis zur Zerstörung. Höchstens MAX_PER_OWNER Bauwerke je Spieler (das älteste fällt weg).
// Online entscheidet der Host: Client → 'build' {k, p, ry}; Host prüft (Klasse, Abstand, Untergrund) und verteilt
// 'ev' bs {id, k, p, ry, o, d} an alle (auch nachträglich an neue Clients) bzw. 'ev' bd {id} beim Abriss/Zerstören.
import * as THREE from 'three';

export const BUILDS = Object.freeze({
  sandsack: { id: 'sandsack', name: 'Sandsackwall', time: 3, hp: 260, cls: null, surface: 'sand' },
  mulde: { id: 'mulde', name: 'Schützenloch', time: 4, hp: 320, cls: null, surface: 'dirt' },
  mgnest: { id: 'mgnest', name: 'MG-Nest', time: 8, hp: 700, cls: 'pionier', surface: 'sand' },
  bunker: { id: 'bunker', name: 'Kleiner Bunker', time: 14, hp: 1400, cls: 'pionier', surface: 'concrete' },
});
export const BUILD_ORDER = Object.freeze(['sandsack', 'mulde', 'mgnest', 'bunker']);
const MAX_PER_OWNER = 5;
const PLACE_DIST = 3.2; // m vor dem Spieler
const BUILD_REACH = 7; // Host: höchstens so weit von der Puppe
const SPEED_PIONIER = 2;

/** Teile (lokal, Feuerrichtung +z): [x, y, z, halbe Breite, halbe Höhe, halbe Tiefe, Drehung] je Bauwerk. */
function partsOf(k) {
  if (k === 'sandsack') return [[0, 0.45, 0, 1.2, 0.45, 0.3, 0]];
  if (k === 'mulde' || k === 'mgnest') {
    const ring = k === 'mulde' ? { r: 1.1, h: 0.35, n: 6, a: 2.6, t: 0.28 } : { r: 1.5, h: 0.45, n: 5, a: 1.95, t: 0.28 };
    const out = [];
    for (let i = 0; i < ring.n; i++) {
      const a = -ring.a + ((2 * ring.a) * (i + 0.5)) / ring.n;
      const seg = (2 * ring.a * ring.r) / ring.n;
      out.push([Math.sin(a) * ring.r, ring.h, Math.cos(a) * ring.r, seg / 2 + 0.06, ring.h, ring.t, a]);
    }
    return out;
  }
  if (k === 'bunker') return [
    [-1.45, 1.15, 0, 0.15, 1.15, 1.5, 0], [1.45, 1.15, 0, 0.15, 1.15, 1.5, 0],
    [0, 0.575, 1.35, 1.3, 0.575, 0.15, 0], [0, 1.925, 1.35, 1.3, 0.375, 0.15, 0],
    [-0.875, 1.15, -1.35, 0.425, 1.15, 0.15, 0], [0.875, 1.15, -1.35, 0.425, 1.15, 0.15, 0],
    [0, 2.425, 0, 1.6, 0.125, 1.5, 0],
  ];
  return [];
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.03, 0.03, 1, 8),
    sand: new THREE.MeshStandardMaterial({ color: 0x9a8a62, roughness: 0.95 }),
    sand2: new THREE.MeshStandardMaterial({ color: 0x86784f, roughness: 0.95 }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x5e4d36, roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.7 }),
    ghostOk: new THREE.MeshBasicMaterial({ color: 0x44dd66, transparent: true, opacity: 0.35, depthWrite: false }),
    ghostBad: new THREE.MeshBasicMaterial({ color: 0xdd4433, transparent: true, opacity: 0.35, depthWrite: false }),
  };
  return SHARED;
}

/** Deterministischer Zufall je Bauwerk (gleiches Aussehen auf allen Geräten). */
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function addBox(g, mat, x, y, z, w, h, d, ry = 0) {
  const m = new THREE.Mesh(shared().box, mat);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

/** Sandsäcke in einem Teil (Reihen versetzt, leicht unregelmäßig). */
function bags(g, p, r) {
  const S = shared();
  const [x, y, z, hx, hy, hz, ry] = p;
  const rows = Math.max(1, Math.round((hy * 2) / 0.28));
  const n = Math.max(1, Math.round((hx * 2) / 0.55));
  const c = Math.cos(ry), s = Math.sin(ry);
  for (let i = 0; i < rows; i++) {
    const off = i % 2 ? 0.275 : 0;
    for (let j = 0; j < n; j++) {
      const lx = -hx + 0.275 + j * ((hx * 2 - 0.55) / Math.max(1, n - 1)) + (off && j === n - 1 ? -0.1 : off * 0.5);
      const ly = y - hy + 0.14 + i * ((hy * 2 - 0.28) / Math.max(1, rows - 1 || 1));
      addBox(g, r() < 0.5 ? S.sand : S.sand2, x + lx * c, ly, z - lx * s, 0.56 + r() * 0.04, 0.27, hz * 2 * (0.92 + r() * 0.08), ry + (r() - 0.5) * 0.08);
    }
  }
}

function buildMesh(k, seed) {
  const S = shared();
  const g = new THREE.Group();
  const r = rng(seed);
  const parts = partsOf(k);
  if (k === 'bunker') {
    for (const p of parts) addBox(g, p[1] > 2.3 ? S.concrete : S.concrete, p[0], p[1], p[2], p[3] * 2, p[4] * 2, p[5] * 2);
    // Balken über der Öffnung, Sandsäcke auf dem Dach
    addBox(g, S.wood, 0, 2.2, -1.35, 0.95, 0.16, 0.32);
    for (let i = 0; i < 6; i++) addBox(g, r() < 0.5 ? S.sand : S.sand2, -1.2 + i * 0.48, 2.68, 1.25, 0.5, 0.24, 0.42, (r() - 0.5) * 0.1);
  } else {
    if (k === 'mulde') addBox(g, S.dirt, 0, 0.04, 0, 2.6, 0.08, 2.6); // aufgeworfene Erde
    for (const p of parts) bags(g, p, r);
  }
  if (k === 'mgnest') {
    // MG auf Dreibein (Feuerrichtung +z)
    addBox(g, S.metal, 0, 1.0, 0.85, 0.11, 0.13, 0.55);
    const barrel = new THREE.Mesh(S.cyl, S.metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.scale.set(1.3, 0.75, 1.3);
    barrel.position.set(0, 1.01, 1.45);
    g.add(barrel);
    addBox(g, S.wood, 0, 0.94, 0.4, 0.06, 0.12, 0.3);
    for (const [lx, lz] of [[0, 1.3], [-0.4, 0.45], [0.4, 0.45]]) {
      const leg = new THREE.Mesh(S.cyl, S.metal);
      const dx = lx, dz = lz - 0.85, L = Math.hypot(dx, 0.9, dz);
      leg.scale.set(0.6, L, 0.6);
      leg.position.set(lx / 2, 0.45, (lz + 0.85) / 2);
      leg.lookAt(lx, 0, lz);
      leg.rotateX(Math.PI / 2);
      g.add(leg);
    }
  }
  return g;
}

function ghostMesh(k) {
  const g = new THREE.Group();
  for (const p of partsOf(k)) addBox(g, shared().ghostOk, p[0], p[1], p[2], p[3] * 2, p[4] * 2, p[5] * 2, p[6]).castShadow = false;
  return g;
}

function worldParts(k, x, y, z, ry) { return worldPartsFrom(partsOf(k), x, y, z, ry); }

/**
 * Teile [x, y, z, hx, hy, hz, ry] (lokal) in Weltlage: Mittelpunkt, Drehung (cos/sin), halbe Maße, AABB, Dreiecke
 * (außen gegen den Uhrzeigersinn). Auch für Türen und Tore (doors.js).
 */
export function worldPartsFrom(list, x, y, z, ry) {
  const c0 = Math.cos(ry), s0 = Math.sin(ry);
  const out = [];
  for (const [px, py, pz, hx, hy, hz, pry] of list) {
    const cx = x + px * c0 + pz * s0, cz = z - px * s0 + pz * c0, cy = y + py;
    const R = ry + pry, c = Math.cos(R), s = Math.sin(R);
    const corner = (sx, sy, sz) => new THREE.Vector3(cx + sx * hx * c + sz * hz * s, cy + sy * hy, cz - sx * hx * s + sz * hz * c);
    const q = (a, b, cc, d) => [new THREE.Triangle(corner(...a), corner(...b), corner(...cc)), new THREE.Triangle(corner(...a), corner(...cc), corner(...d))];
    const tris = [
      ...q([1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]), ...q([-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]),
      ...q([-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]), ...q([-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]),
      ...q([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]), ...q([-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]),
    ];
    const box = new THREE.Box3();
    for (const t of tris) { box.expandByPoint(t.a); box.expandByPoint(t.b); box.expandByPoint(t.c); }
    out.push({ cx, cy, cz, c, s, hx, hy, hz, box, tris });
  }
  return out;
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

/** Strahl gegen gedrehten Quader → Abstand oder −1 (Normalen in Welt über n). */
function rayPart(pt, ox, oy, oz, dx, dy, dz, max, n) {
  const ex = ox - pt.cx, ez = oz - pt.cz;
  const lo = [ex * pt.c - ez * pt.s, oy - pt.cy, ex * pt.s + ez * pt.c];
  const ld = [dx * pt.c - dz * pt.s, dy, dx * pt.s + dz * pt.c];
  const h = [pt.hx, pt.hy, pt.hz];
  let t0 = 0, t1 = max, axis = -1, sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < -h[i] || lo[i] > h[i]) return -1; continue; }
    let a = (-h[i] - lo[i]) / ld[i], b = (h[i] - lo[i]) / ld[i], sg = -1;
    if (a > b) { const t = a; a = b; b = t; sg = 1; }
    if (a > t0) { t0 = a; axis = i; sign = sg; }
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  if (axis < 0) return -1; // Start im Quader
  if (n) {
    const l = [0, 0, 0];
    l[axis] = sign;
    n.set(l[0] * pt.c + l[2] * pt.s, l[1], -l[0] * pt.s + l[2] * pt.c);
  }
  return t0;
}

export class Building {
  constructor(G) {
    this.G = G;
    this.list = []; // { id, k, owner (netId|Actor), x, y, z, ry, hp, progress, done, mesh, parts }
    this.mode = null; // Baumodus: { k, ghost, ok, pos, ry }
    this.extra = []; // weitere bewegliche Festkörper (Türen, Tore: doors.js) – { parts, def: { surface }, mesh, onHit? }
    this._nextId = 1;
    this._hammerAt = 0;
    this.group = new THREE.Group();
    this.group.name = 'bauwerke';
    if (G.scene) G.scene.add(this.group);
    this._patch();
    this._offs = [G.events.on('explosion', (e) => this._onExplosion(e))];
  }

  get replica() { return this.G.match && this.G.match.netRole === 'client'; }
  get online() { return !!(this.G.match && this.G.match.netRole); }

  /** Welt-Abfragen um die fertigen Bauwerke erweitern (beim Abbau zurückgesetzt). */
  _patch() {
    const W = this.G.world;
    if (!W || !W.collider) return;
    const col = W.collider;
    const solids = () => this._solids();
    const orig = { get: col.getCapsuleTriangles, cap: col.capsuleIntersect, ray: W.raycast, los: W.lineOfSight, ground: W.groundHeight };
    this._orig = orig;
    if (typeof orig.get === 'function') {
      col.getCapsuleTriangles = function (capsule, out) {
        const r = orig.get.call(this, capsule, out);
        const list = solids();
        if (list.length) {
          _box.makeEmpty().expandByPoint(capsule.start).expandByPoint(capsule.end).expandByScalar(capsule.radius);
          for (const s of list) for (const p of s.parts) if (p.box.intersectsBox(_box)) for (const t of p.tris) out.push(t);
        }
        return r;
      };
    }
    if (typeof orig.cap === 'function') {
      col.capsuleIntersect = function (capsule) {
        let res = orig.cap.call(this, capsule);
        const list = solids();
        if (!list.length || typeof this.triangleCapsuleIntersect !== 'function') return res;
        _box.makeEmpty().expandByPoint(capsule.start).expandByPoint(capsule.end).expandByScalar(capsule.radius);
        for (const s of list) for (const p of s.parts) {
          if (!p.box.intersectsBox(_box)) continue;
          for (const t of p.tris) { const h = this.triangleCapsuleIntersect(capsule, t); if (h && (!res || h.depth > res.depth)) res = h; }
        }
        return res;
      };
    }
    const self = this;
    if (typeof orig.ray === 'function') {
      W.raycast = function (origin, dir, maxDist = 1000) {
        const best = orig.ray.call(this, origin, dir, maxDist);
        const hit = self._rayAll(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, best ? best.distance : maxDist);
        if (!hit) return best;
        return { distance: hit.t, point: new THREE.Vector3(origin.x + dir.x * hit.t, origin.y + dir.y * hit.t, origin.z + dir.z * hit.t), normal: hit.n, surface: hit.s.def.surface, object: hit.s.mesh, structure: hit.s.id, solid: hit.s };
      };
    }
    if (typeof orig.los === 'function') {
      W.lineOfSight = function (a, b) {
        if (!orig.los.call(this, a, b)) return false;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz);
        return l < 1e-4 || !self._rayAll(a.x, a.y, a.z, dx / l, dy / l, dz / l, l - 0.02, true);
      };
    }
    if (typeof orig.ground === 'function') {
      // Boden unter einem Punkt: auch auf Bauwerken (Bots, Platzierung, Kartenpunkte)
      W.groundHeight = function (x, z, yFrom = 30) {
        const g = orig.ground.call(this, x, z, yFrom);
        const hit = self._rayAll(x, yFrom, z, 0, -1, 0, g == null ? yFrom + 20 : yFrom - g, true);
        return hit ? yFrom - hit.t : g;
      };
    }
  }

  _unpatch() {
    const W = this.G.world, o = this._orig;
    if (!W || !o) return;
    const col = W.collider;
    if (col) { col.getCapsuleTriangles = o.get; col.capsuleIntersect = o.cap; }
    W.raycast = o.ray; W.lineOfSight = o.los; W.groundHeight = o.ground;
    // eigene (überschriebene) Methoden wieder vom Objekt entfernen, wenn sie vom Prototyp kamen
    if (col && Object.getPrototypeOf(col).getCapsuleTriangles === o.get) delete col.getCapsuleTriangles;
    if (col && Object.getPrototypeOf(col).capsuleIntersect === o.cap) delete col.capsuleIntersect;
    this._orig = null;
  }

  _solids() {
    const out = [];
    for (const s of this.list) if (s.done) out.push(s);
    for (const e of this.extra) if (e.parts && e.parts.length) out.push(e);
    return out;
  }

  addSolid(e) { if (!this.extra.includes(e)) this.extra.push(e); }
  removeSolid(e) { const i = this.extra.indexOf(e); if (i >= 0) this.extra.splice(i, 1); }

  _rayAll(ox, oy, oz, dx, dy, dz, max, any = false) {
    let best = null;
    for (const s of this._solids()) {
      for (const p of s.parts) {
        const t = rayPart(p, ox, oy, oz, dx, dy, dz, best ? best.t : max, any ? null : _v);
        if (t >= 0 && (!best || t < best.t)) {
          best = { t, s, n: any ? null : _v.clone() };
          if (any) return best;
        }
      }
    }
    return best;
  }

  /** Darf der Spieler/Puppe dieses Bauwerk bauen? */
  allowed(actor, k) {
    const d = BUILDS[k];
    const M = this.G.match;
    if (!d || !actor || (M && (M.modeId === 'training' || M.modeId === 'messer'))) return false;
    const cls = actor.cls || (actor.loadout && actor.loadout.cls);
    return !d.cls || d.cls === cls;
  }

  kindsFor(actor) { return BUILD_ORDER.filter((k) => this.allowed(actor, k)); }

  /* ---------------------------------------------------------------- Spieler: Baumodus */

  update(dt) {
    const G = this.G;
    const P = G.player;
    const input = G.input;
    const now = G.time.elapsed;
    // Baufortschritt (alle Geräte gleich: Zeit ab Baubeginn)
    for (const s of this.list) {
      if (s.done) continue;
      s.progress = Math.min(1, s.progress + dt / (s.def.time / s.speed));
      s.mesh.scale.y = 0.15 + 0.85 * s.progress;
      if (s.progress >= 1) this._finish(s);
      else if (now >= this._hammerAt && P && s.ownerActor === P) { this._hammerAt = now + 0.45; this._sound('melee_hit', s, 0.5); }
    }
    if (!P) return;
    const can = P.alive && !P.vehicle && !P.piloting && !P.mounted && G.match.state === 'playing' && this.kindsFor(P).length > 0;
    if (!can) { if (this.mode) this.close(); return; }
    if (input && input.pressed('bauen')) this._cycle();
    if (!this.mode) return;
    if (input.pressed('interact')) { input.consume('interact'); this.close(); return; }
    this._placeGhost();
    if (input.pressed('fire')) this.place();
  }

  _cycle() {
    const P = this.G.player;
    const kinds = this.kindsFor(P);
    const i = this.mode ? kinds.indexOf(this.mode.k) + 1 : 0;
    if (i >= kinds.length) { this.close(); return; }
    this.open(kinds[i]);
  }

  open(k) {
    this.close();
    const ghost = ghostMesh(k);
    this.group.add(ghost);
    this.mode = { k, name: BUILDS[k].name, ghost, ok: false, pos: new THREE.Vector3(), ry: 0 };
    this.G.player.building = true;
    this.G.events.emit('build:mode', { actor: this.G.player, kind: k, name: BUILDS[k].name });
  }

  close() {
    if (this.mode) { this.group.remove(this.mode.ghost); this.mode = null; }
    if (this.G.player) this.G.player.building = false;
  }

  _placeGhost() {
    const G = this.G;
    const P = G.player;
    const m = this.mode;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const x = P.position.x + fx * PLACE_DIST, z = P.position.z + fz * PLACE_DIST;
    const W = G.world;
    const gy = W && typeof W.groundHeight === 'function' ? W.groundHeight(x, z, P.position.y + 1.6) : null;
    m.ry = P.yaw + Math.PI;
    m.pos.set(x, gy == null ? P.position.y : gy, z);
    m.ok = this._valid(m.k, m.pos, P);
    m.ghost.position.copy(m.pos);
    m.ghost.rotation.y = m.ry;
    const mat = m.ok ? shared().ghostOk : shared().ghostBad;
    for (const c of m.ghost.children) c.material = mat;
  }

  /** Untergrund gefunden, ungefähr auf Spielerhöhe, frei von anderen Bauwerken und von Wänden. */
  _valid(k, pos, actor) {
    const W = this.G.world;
    if (!W || !actor) return false;
    if (Math.abs(pos.y - actor.position.y) > 1.3) return false;
    const rad = k === 'bunker' ? 2.2 : k === 'mgnest' ? 1.8 : 1.3;
    for (const s of this.list) if (Math.hypot(s.x - pos.x, s.z - pos.z) < rad + (s.k === 'bunker' ? 2.2 : 1.3)) return false;
    const col = W.collider;
    if (col && this._orig && typeof this._orig.cap === 'function') {
      const cap = this._probe || (this._probe = { start: new THREE.Vector3(), end: new THREE.Vector3(), radius: 0.45 });
      cap.start.set(pos.x, pos.y + 0.7, pos.z);
      cap.end.set(pos.x, pos.y + 1.4, pos.z);
      const hit = this._orig.cap.call(col, cap);
      if (hit && hit.depth > 0.05) return false;
    }
    return true;
  }

  /** Bauwerk setzen (Klick im Baumodus). Offline/Host sofort, Client fragt den Host. */
  place() {
    const G = this.G;
    const P = G.player;
    const m = this.mode;
    if (!m) return false;
    if (!m.ok) { G.events.emit('build:denied', { actor: P, reason: 'platz' }); return false; }
    const p = m.pos.clone();
    if (this.replica) {
      const sync = G.net && G.net.sync;
      if (sync && typeof sync.sendBuild === 'function') sync.sendBuild(m.k, p, m.ry);
    } else {
      this.spawn({ k: m.k, x: p.x, y: p.y, z: p.z, ry: m.ry, owner: P });
    }
    this.close();
    return true;
  }

  /* ---------------------------------------------------------------- Bauwerke */

  /** Offline/Host: Bauwerk anlegen (+ an Clients verteilen). owner = Akteur. → Bauwerk */
  spawn({ k, x, y, z, ry, owner }) {
    const G = this.G;
    const mine = this.list.filter((s) => s.ownerActor === owner);
    if (mine.length >= MAX_PER_OWNER) this.remove(mine[0].id);
    const id = this._nextId++;
    const s = this._create({ id, k, x, y, z, ry, owner, done: false });
    const sync = G.net && G.net.sync;
    if (this.online && sync && typeof sync.relayBuild === 'function') sync.relayBuild(this._msg(s));
    G.events.emit('build:start', { actor: owner, id, kind: k, name: s.def.name });
    return s;
  }

  _msg(s) {
    const r2 = (v) => Math.round(v * 100) / 100;
    return { id: s.id, k: s.k, p: [r2(s.x), r2(s.y), r2(s.z)], ry: Math.round(s.ry * 1000) / 1000, o: s.ownerActor && Number.isInteger(s.ownerActor.netId) ? s.ownerActor.netId : -1, d: s.done ? 1 : 0, pr: Math.round(s.progress * 100) / 100 };
  }

  /** Alle Bauwerke (für einen nachträglich beigetretenen Client). */
  snapshot() { return this.list.map((s) => this._msg(s)); }

  _create({ id, k, x, y, z, ry, owner, done, progress = 0 }) {
    const def = BUILDS[k];
    const mesh = buildMesh(k, id * 7919 + Math.round(x * 13) + Math.round(z * 17));
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    this.group.add(mesh);
    const cls = owner && (owner.cls || (owner.loadout && owner.loadout.cls));
    const s = { id, k, def, ownerActor: owner || null, x, y, z, ry, hp: def.hp, progress: done ? 1 : progress, done: false, mesh, parts: worldParts(k, x, y, z, ry), speed: cls === 'pionier' ? SPEED_PIONIER : 1, emp: null };
    this.list.push(s);
    if (done) this._finish(s, true);
    else mesh.scale.y = 0.15 + 0.85 * s.progress;
    return s;
  }

  _finish(s, quiet = false) {
    s.done = true;
    s.progress = 1;
    s.mesh.scale.y = 1;
    if (s.k === 'mgnest') {
      // benutzbar wie die MG-Stellungen der Karte (mappoints.js mount, Anti-Cheat des Hosts)
      const c = Math.cos(s.ry), sn = Math.sin(s.ry);
      const W = this.G.world;
      s.emp = { kind: 'mg', built: s.id, x: s.x + -0.25 * sn, y: s.y, z: s.z + -0.25 * c, gx: s.x + 0.85 * sn, gz: s.z + 0.85 * c, gunY: s.y + 1.0, dx: sn, dz: c, arc: (250 * Math.PI) / 180 };
      if (W) (W.emplacements || (W.emplacements = [])).push(s.emp);
    }
    // wer drinsteht, wird von der Physik hinausgeschoben (Kollision ab jetzt aktiv)
    if (!quiet) { this._sound('equip', s, 0.8); this.G.events.emit('build:done', { actor: s.ownerActor, id: s.id, kind: s.k, name: s.def.name }); }
  }

  remove(id, reason = 'abriss') {
    const i = this.list.findIndex((s) => s.id === id);
    if (i < 0) return;
    const s = this.list[i];
    this.list.splice(i, 1);
    this.group.remove(s.mesh);
    if (s.emp) {
      const W = this.G.world;
      const em = W && W.emplacements;
      if (em) { const j = em.indexOf(s.emp); if (j >= 0) em.splice(j, 1); }
      const P = this.G.player;
      if (P && P.mounted && P.mounted.emp === s.emp && this.G.points) this.G.points.unmount();
    }
    const sync = this.G.net && this.G.net.sync;
    if (!this.replica && this.online && sync && typeof sync.relayBuildEnd === 'function') sync.relayBuildEnd(id);
    if (reason === 'zerstört') this.G.events.emit('build:destroyed', { id, kind: s.k, name: s.def.name, owner: s.ownerActor });
  }

  /** Explosionen beschädigen Bauwerke (offline/Host; Clients bekommen den Abriss vom Host). */
  _onExplosion(e) {
    if (!e || e.net || e.nonLethal || this.replica || !e.position) return;
    const r = (e.radius || 4) + 1.5;
    for (const s of [...this.list]) {
      const d = Math.hypot(s.x - e.position.x, s.y + 1 - e.position.y, s.z - e.position.z);
      if (d > r + 1.5) continue;
      const dmg = (e.type === 'tank' || e.weaponId === 'mbt_he' ? 900 : 320) * Math.max(0.2, 1 - d / (r + 1.5));
      s.hp -= dmg;
      if (s.hp <= 0) this.remove(s.id, 'zerstört');
    }
  }

  /* ---------------------------------------------------------------- Netz */

  /** Client: Bauwerk vom Host ('ev' bs). */
  applyNet(m, byNetId) {
    if (!m || !BUILDS[m.k] || !Array.isArray(m.p) || this.list.some((s) => s.id === m.id)) return;
    const owner = typeof byNetId === 'function' ? byNetId(m.o) : null;
    this._create({ id: m.id, k: m.k, x: +m.p[0], y: +m.p[1], z: +m.p[2], ry: +m.ry || 0, owner, done: !!m.d, progress: Math.max(0, Math.min(1, +m.pr || 0)) });
  }

  /** Host: Bauwunsch eines Clients ('build' {k, p, ry}). */
  netRequest(actor, m) {
    if (!actor || !actor.alive || !m || !this.allowed(actor, m.k) || !Array.isArray(m.p)) return false;
    const x = +m.p[0], y = +m.p[1], z = +m.p[2];
    if (![x, y, z].every(Number.isFinite) || Math.hypot(x - actor.position.x, z - actor.position.z) > BUILD_REACH) return false;
    if (!this._valid(m.k, new THREE.Vector3(x, y, z), actor)) return false;
    this.spawn({ k: m.k, x, y, z, ry: Number.isFinite(+m.ry) ? +m.ry : 0, owner: actor });
    return true;
  }

  _sound(name, s, volume = 0.8) {
    const au = this.G.audio;
    if (au && typeof au.play === 'function') { try { au.play(name, { position: new THREE.Vector3(s.x, s.y + 0.6, s.z), volume }); } catch { /* Klang ist Beiwerk */ } }
  }

  dispose() {
    this.close();
    for (const off of this._offs) off();
    this._offs.length = 0;
    const W = this.G.world;
    if (W && W.emplacements) W.emplacements = W.emplacements.filter((e) => !e.built);
    this.list.length = 0;
    this.extra.length = 0;
    this._unpatch();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
