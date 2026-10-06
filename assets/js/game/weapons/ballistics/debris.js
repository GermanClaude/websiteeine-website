// NULLPUNKT — „Physik-lite“ für Hülsen und Magazine (Realismus-Plan P4, alle Qualitätsstufen, ohne Rapier).
//
// Ballistische Teilchen in Weltkoordinaten: Schwerkraft, Luftwiderstand, je Bild ein kurzer Strahl entlang der
// Bewegung gegen die Kugel-Geometrie (world.raycast, BVH) → Abprall mit Stoßzahl/Reibung je Oberfläche, Taumeln,
// Liegenbleiben (Hülse quer auf der Fläche, Magazin flach auf der breiten Seite). Wasser schluckt sie.
// Erster Aufschlag meldet `shell:land` (Klang je Oberfläche, audio).
// Hülsen bleiben bis Matchende liegen (Obergrenze je Stufe; ist sie voll, verschwindet die älteste – bevorzugt
// weit weg oder außer Sicht). Liegende Hülsen kosten je Bild nichts: nur fliegende stehen in einer kleinen
// Aktivliste, Instanz-Matrizen werden nur bei Änderung (Teilbereiche) hochgeladen, Abkühlen und Wegtreten laufen
// über die Liegereihenfolge bzw. ein Raster um die Füße. Ein InstancedMesh je Art (rifle | pistol | big | shotgun).
// Magazine: kleiner Pool aus Klonen der 3rd-Person-Magazine (bereits kompilierte Materialien der Bots), blenden
// nach `rest` s aus.
// Keine Allokationen pro Bild außer world.raycast-Treffern (selten: nur beim Aufschlag).
import * as THREE from 'three';
import { casingGeometry } from '../gunsmith/fx.js';
import { createWeaponModel } from '../models.js';

export const CASING_TYPES = ['rifle', 'pistol', 'big', 'shotgun'];
// Je Qualitätsstufe: liegende Hülsen gesamt, Magazine, Liegezeit der Magazine (s), Strahlen je Bild,
// Schatten auf Hülsen (empfangen; werfen nie – 1 cm Messing wirft keinen sichtbaren Schatten)
export const DEBRIS_TIERS = {
  low: { shells: 150, mags: 3, rest: 8, rays: 10, shadows: false },
  medium: { shells: 400, mags: 4, rest: 12, rays: 16, shadows: false },
  high: { shells: 1000, mags: 6, rest: 16, rays: 28, shadows: true },
  ultra: { shells: 2000, mags: 8, rest: 20, rays: 40, shadows: true },
};
// Plätze je Art = größte Stufe (eine Waffe allein kann die ganze Obergrenze füllen); count deckt nur genutzte
const CAP_PER_TYPE = Math.max(...Object.values(DEBRIS_TIERS).map((t) => t.shells));
const MAG_CAP = 8;
const GRAVITY = 9.81;
const FADE = 0.6;          // s Ausblenden am Ende (Magazine)
const MAX_FLIGHT = 5;      // s – danach auf den Boden darunter legen
// Oberflächen: Stoßzahl e, Reibung mu (tangential pro Aufschlag), weich = kaum Abprall
const SURF = {
  concrete: [0.4, 0.25], tile: [0.42, 0.22], plaster: [0.38, 0.25], metal: [0.45, 0.2], glass: [0.42, 0.2],
  wood: [0.32, 0.35], dirt: [0.12, 0.7], grass: [0.1, 0.75], sand: [0.08, 0.8], fabric: [0.1, 0.7], flesh: [0.1, 0.7],
};
// Halber Durchmesser der Hülsen (Abstand zur Fläche im Liegen) und Gewicht für den Klang
const CASE_R = { rifle: 0.0057, pistol: 0.0049, big: 0.0074, shotgun: 0.0108 };
// Abkühlen: frisch ausgeworfen heller/wärmer, nach t s Liegen stufenweise matter (Staub, angelaufen).
// Farbe multipliziert die Vertexfarbe (Messing bzw. rote Hülle der Schrotpatrone).
const HOT = [1.14, 0.98, 0.84];
const COOL = [
  { t: 3, c: [1.06, 0.97, 0.9] },
  { t: 12, c: [0.96, 0.92, 0.88] },
  { t: 40, c: [0.86, 0.83, 0.79] },
];
// Wegtreten: Radius um die Füße (m), höchstens so viele je Bild
const KICK_R = 0.3;
const KICK_MAX = 6;
// Verdrängen: zuerst Hülsen weiter als EVICT_FAR m oder außerhalb des Blickkegels (unter den ältesten EVICT_SCAN)
const EVICT_FAR = 18;
const EVICT_SCAN = 32;

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _o = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), DOWN = new THREE.Vector3(0, -1, 0);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

let _shellMats = null;
function shellMaterials() {
  if (_shellMats) return _shellMats;
  // Welt-Hülsen: eigenes Material (Weltlicht, Nebel); überdauert Matches → Programm bleibt gelinkt
  _shellMats = {
    brass: new THREE.MeshStandardMaterial({ name: 'fx:brass', vertexColors: true, metalness: 0.85, roughness: 0.34 }),
    shot: new THREE.MeshStandardMaterial({ name: 'fx:shotshell', vertexColors: true, metalness: 0.3, roughness: 0.5 }),
  };
  return _shellMats;
}

/** Rasterzelle (1 m) für das Wegtreten: x/z → Ganzzahl-Schlüssel. */
const cellKey = (x, z) => ((Math.floor(x) + 32768) & 0xffff) * 65536 + ((Math.floor(z) + 32768) & 0xffff);

class Item {
  constructor() {
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.w = new THREE.Vector3();
    this.reset();
  }
  reset() {
    this.alive = false; this.flying = false; this.t = 0; this.restT = 0; this.acc = 0; this.bounces = 0; this.sounds = 0;
    this.scale = 1; this.actor = null; this.type = null; this.slot = -1; this.obj = null; this.r = 0.006; this.halfT = 0.006;
    this.thin = 0; this.mag = false; this.seq = 0;
    this.ai = -1;     // Index in der Aktivliste (fliegend) oder -1
    this.qid = 0;     // Kennung des aktuellen Eintrags in der Liegereihenfolge
    this.cell = -1;   // Rasterzelle (liegend) oder -1
    this.heat = 0;    // erreichte Abkühlstufe
  }
}

export class Debris {
  /** opts: { events } – Ereignisbus für `shell:land` (optional) */
  constructor(opts = {}) {
    this.events = opts.events || null;
    this.group = new THREE.Group();
    this.group.name = 'fx-debris';
    this.tier = DEBRIS_TIERS.high;
    this.stats = { shells: 0, mags: 0, flying: 0, rays: 0, resting: 0 };
    this._seq = 0;
    this._time = 0;
    this._cam = new THREE.Vector3();
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._hasCam = false;
    // Hülsen je Art
    const mats = shellMaterials();
    this.pools = {};
    for (const type of CASING_TYPES) {
      const mesh = new THREE.InstancedMesh(casingGeometry(type), type === 'shotgun' ? mats.shot : mats.brass, CAP_PER_TYPE);
      mesh.name = 'fx-casings-' + type;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Farbe je Hülse (Abkühlen) – von Anfang an vorhanden, sonst neues Programm beim ersten Schuss
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP_PER_TYPE * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      // Sichtprüfung über eine selbst gepflegte Hülle aller benutzten Plätze (wächst nur; computeBoundingSphere
      // ginge über alle Instanzen)
      mesh.frustumCulled = true;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      for (let i = 0; i < CAP_PER_TYPE; i++) mesh.setMatrixAt(i, ZERO_M);
      mesh.count = 0;
      this.group.add(mesh);
      const items = Array.from({ length: CAP_PER_TYPE }, () => new Item());
      this.pools[type] = {
        mesh, items, free: Array.from({ length: CAP_PER_TYPE }, (_, i) => CAP_PER_TYPE - 1 - i), used: 0,
        box: new THREE.Box3(), grow: false,
        // geänderte Plätze (Matrix/Farbe): Anzahl, kleinster/größter → Teil-Upload
        dn: 0, dmin: 0, dmax: 0, cn: 0, cmin: 0, cmax: 0,
      };
    }
    this.active = [];             // fliegende Hülsen (klein)
    // Liegereihenfolge (alle Arten): Hülse, Kennung, Zeitpunkt; ab _rqHead gültig (Einträge veralten lazy)
    this._rq = []; this._rqId = []; this._rqT = []; this._rqHead = 0; this._qid = 0;
    this._cool = COOL.map(() => 0); // Cursor je Abkühlstufe in _rq
    this._grid = new Map();       // Rasterzelle → liegende Hülsen (Wegtreten)
    // Magazine
    this._magProto = new Map();   // modelKey → { obj (Gruppe, Ursprung = Mitte), thin: Achse 0|1|2, half: [hx,hy,hz] }
    this.mags = [];
    this._magPool = [];
    this._pending = [];           // verzögerte Abwürfe (Bots): { at, key, pos, vel, quat, actor }
  }

  /** Stufe 'low' | 'medium' | 'high' | 'ultra' (Mengen, Liegezeit der Magazine, Strahlenbudget). */
  setQuality(q) {
    this.tier = DEBRIS_TIERS[q] || DEBRIS_TIERS.high;
    this._enforceCaps(true);
  }

  /**
   * Schatten auf liegenden Hülsen (empfangen). Nur zwischen Matches setzen (anderes Shader-Programm), nicht beim
   * Qualitätswechsel im Match.
   */
  setShadows(on) {
    for (const t of CASING_TYPES) this.pools[t].mesh.receiveShadow = !!on;
  }

  /** Sichtbar lassen, bis der Aufrufer die Shader kompiliert hat (leere Pools blenden sich im ersten update aus). */
  showForCompile() {
    for (const t of CASING_TYPES) {
      const m = this.pools[t].mesh;
      m.visible = true;
      // Kompilieren ohne Sichtprüfung: die leere Hülle (Radius −1) würde nichts verhindern, aber sicher ist sicher
      m.frustumCulled = false;
      this._compiling = true;
    }
  }

  /* ================================================================ Erzeugen */

  /**
   * Hülse auswerfen. type: rifle | pistol | big | shotgun; pos/vel (m, m/s) in Welt; quat optional (Achse = lokales Y).
   * opts: { actor, spin (rad/s) }
   */
  casing(type, pos, vel, quat, opts = {}) {
    const p = this.pools[type] || this.pools.rifle;
    if (!p) return null;
    if (!p.free.length || this.stats.shells >= this.tier.shells) this._evictShell();
    if (!p.free.length) return null;
    const slot = p.free.pop();
    const it = p.items[slot];
    it.reset();
    it.alive = true; it.flying = true; it.slot = slot; it.type = type in CASE_R ? type : 'rifle';
    it.r = CASE_R[it.type]; it.halfT = it.r;
    it.pos.copy(pos); it.vel.copy(vel);
    if (quat) it.q.copy(quat); else it.q.setFromAxisAngle(X, Math.PI / 2);
    const sp = opts.spin ?? 28;
    it.w.set((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp * 0.4, (Math.random() * 0.6 + 0.7) * sp);
    it.actor = opts.actor || null;
    it.seq = ++this._seq;
    it.ai = this.active.length;
    this.active.push(it);
    if (slot + 1 > p.used) { p.used = slot + 1; p.mesh.count = p.used; }
    p.mesh.visible = true;
    this.stats.shells++;
    this._write(p, it);
    this._color(p, it, HOT);
    return it;
  }

  /**
   * Magazin fallen lassen (3rd-Person-Magazin des Modells). key = Modellschlüssel (def.model), pos/vel Welt.
   * opts: { actor, delay (s) }
   */
  magazine(key, pos, vel, quat, opts = {}) {
    if (opts.delay > 0) {
      if (this._pending.length < 16) this._pending.push({ at: this._time + opts.delay, key, pos: pos.clone(), vel: vel.clone(), quat: quat ? quat.clone() : null, actor: opts.actor || null });
      return null;
    }
    const proto = this._proto(key);
    if (!proto) return null;
    const cap = Math.min(MAG_CAP, this.tier.mags);
    while (this.mags.length >= cap) this._removeMag(this._oldestMag());
    const it = this._magPool.pop() || new Item();
    it.reset();
    it.alive = true; it.flying = true; it.mag = true; it.type = key;
    it.obj = proto.take();
    it.thin = proto.thin; it.halfT = proto.half[proto.thin]; it.r = Math.max(0.015, it.halfT);
    it.pos.copy(pos); it.vel.copy(vel);
    if (quat) it.q.copy(quat); else it.q.identity();
    it.w.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 9);
    it.actor = opts.actor || null;
    it.seq = ++this._seq;
    it.obj.position.copy(it.pos);
    it.obj.quaternion.copy(it.q);
    it.obj.scale.setScalar(1);
    it.obj.visible = true;
    this.group.add(it.obj);
    this.mags.push(it);
    this.stats.mags = this.mags.length;
    return it;
  }

  _proto(key) {
    let p = this._magProto.get(key);
    if (p !== undefined) return p;
    p = null;
    try {
      const model = createWeaponModel(key, { lod: 'third' });
      const src = model.userData.parts && (model.userData.parts.mag || model.userData.parts.belt);
      if (src) {
        const base = src.clone(true);
        base.position.set(0, 0, 0); base.quaternion.identity(); base.scale.set(1, 1, 1);
        base.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(base);
        const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        base.position.copy(c).negate();
        base.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = true; } });
        const half = [size.x / 2, size.y / 2, size.z / 2];
        const thin = half[0] <= half[1] && half[0] <= half[2] ? 0 : half[1] <= half[2] ? 1 : 2;
        const spare = [];
        p = {
          half, thin,
          // Klon-Hülle (Ursprung = Mitte des Magazins); Geometrie/Material bleiben geteilt (Modell-Cache)
          take: () => { if (spare.length) return spare.pop(); const g = new THREE.Group(); g.name = 'fx-mag-' + key; g.add(base.clone(true)); return g; },
          give: (g) => { if (spare.length < MAG_CAP) spare.push(g); },
        };
      }
    } catch { p = null; }
    this._magProto.set(key, p);
    return p;
  }

  /* ================================================================ Takt */

  /**
   * world: { raycast, bounds } (darf fehlen – dann fallen Teile nur). camPos/camFwd (optional): Verdrängen
   * bevorzugt Hülsen außer Sicht bzw. weit weg.
   */
  update(dt, world, camPos, camFwd) {
    this._time += dt;
    if (camPos) { this._cam.copy(camPos); this._hasCam = true; }
    if (camFwd) this._fwd.copy(camFwd);
    if (this._compiling) {
      this._compiling = false;
      for (const t of CASING_TYPES) this.pools[t].mesh.frustumCulled = true;
    }
    if (this._pending.length) {
      for (let i = this._pending.length - 1; i >= 0; i--) {
        const d = this._pending[i];
        if (d.at > this._time) continue;
        this._pending.splice(i, 1);
        this.magazine(d.key, d.pos, d.vel, d.quat, { actor: d.actor });
      }
    }
    let budget = this.tier.rays;
    this.stats.rays = 0;
    // Fliegende Hülsen (rückwärts: Liegenbleiben/Entfernen tauscht mit dem letzten Eintrag)
    const act = this.active;
    for (let i = act.length - 1; i >= 0; i--) {
      const it = act[i];
      if (!it) continue;
      it.acc += dt;
      if (budget > 0 || it.acc > 0.1) {
        budget--;
        this._step(it, it.acc, world);
        it.acc = 0;
        if (it.alive) this._write(this.pools[it.type], it);
      }
    }
    let flying = act.length;
    this._updateCooling();
    for (const type of CASING_TYPES) this._flush(this.pools[type]);
    for (let i = this.mags.length - 1; i >= 0; i--) {
      const it = this.mags[i];
      if (it.flying) {
        flying++;
        it.acc += dt;
        if (budget > 0 || it.acc > 0.1) { budget--; this._step(it, it.acc, world); it.acc = 0; }
        if (!it.alive) continue;
      } else {
        it.restT += dt;
        const rest = this.tier.rest;
        if (it.restT > rest + 4) {
          it.scale = 1 - (it.restT - rest - 4) / FADE;
          if (it.scale <= 0) { this._removeMag(it); continue; }
        }
      }
      it.obj.position.copy(it.pos);
      it.obj.quaternion.copy(it.q);
      it.obj.scale.setScalar(Math.max(0.001, it.scale));
    }
    this.stats.flying = flying;
    this.stats.resting = this.stats.shells - act.length;
  }

  /**
   * Hülsen um die Füße wegtreten (Spieler läuft hindurch). feet: Fußpunkt, vel: Geschwindigkeit (m/s).
   * Kostet nur die 1–4 Rasterzellen unter den Füßen.
   */
  kick(feet, vel) {
    if (!this._grid.size || !feet || !vel) return;
    const sp2 = vel.x * vel.x + vel.z * vel.z;
    if (sp2 < 0.6) return;
    const sp = Math.sqrt(sp2);
    let n = 0;
    const x0 = Math.floor(feet.x - KICK_R), x1 = Math.floor(feet.x + KICK_R);
    const z0 = Math.floor(feet.z - KICK_R), z1 = Math.floor(feet.z + KICK_R);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this._grid.get(cellKey(cx + 0.5, cz + 0.5));
        if (!arr) continue;
        for (let i = arr.length - 1; i >= 0 && n < KICK_MAX; i--) {
          const it = arr[i];
          const dx = it.pos.x - feet.x, dz = it.pos.z - feet.z, dy = it.pos.y - feet.y;
          if (dx * dx + dz * dz > KICK_R * KICK_R || dy < -0.2 || dy > 0.25) continue;
          n++;
          this._ungrid(it);
          it.flying = true; it.t = 0; it.acc = 0; it.bounces = 0; it.sounds = 0;
          // in Laufrichtung und etwas zur Seite, wenig hoch – je schneller, desto weiter
          const k = Math.min(1, sp / 5);
          it.vel.set(vel.x * (0.25 + Math.random() * 0.35) + (Math.random() - 0.5) * 0.6, 0.25 + Math.random() * 0.6 * k, vel.z * (0.25 + Math.random() * 0.35) + (Math.random() - 0.5) * 0.6);
          it.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 30);
          it.pos.y += 0.004;
          it.ai = this.active.length;
          this.active.push(it);
        }
      }
    }
  }

  /** Ein Integrationsschritt mit Kollisionsstrahl (Halbschritte bei großem dt). */
  _step(it, dt, world) {
    it.t += dt;
    const n = dt > 0.034 ? Math.ceil(dt / 0.034) : 1;
    const h = dt / n;
    for (let k = 0; k < n && it.flying; k++) {
      it.vel.y -= GRAVITY * h;
      const drag = Math.exp(-(it.mag ? 0.05 : 0.18) * h);
      it.vel.multiplyScalar(drag);
      _d.copy(it.vel).multiplyScalar(h);
      const len = _d.length();
      let hit = null;
      if (len > 1e-6 && world && typeof world.raycast === 'function') {
        _v.copy(_d).divideScalar(len);
        this.stats.rays++;
        try { hit = world.raycast(it.pos, _v, len + it.r); } catch { hit = null; }
        if (hit && hit.targetId !== undefined) hit = null;
      }
      if (hit) this._bounce(it, hit, world);
      else it.pos.add(_d);
      if (!it.flying) break;
      // Taumeln
      _e.set(it.w.x * h, it.w.y * h, it.w.z * h);
      it.q.multiply(_q.setFromEuler(_e)).normalize();
    }
    if (it.alive && it.flying && (it.t > MAX_FLIGHT || (world && world.bounds && it.pos.y < world.bounds.min.y - 4))) {
      if (it.t > MAX_FLIGHT) this._land(it, world);
      else this._kill(it);
    }
  }

  _bounce(it, hit, world) {
    _n.copy(hit.normal);
    if (_n.dot(it.vel) > 0) _n.negate();
    const surf = hit.surface || 'concrete';
    if (surf === 'water') { this._emit(it, hit.point, surf, it.vel.length()); this._kill(it); return; }
    const [e0, mu0] = SURF[surf] || SURF.concrete;
    const e = it.mag ? e0 * 0.45 : e0, mu = it.mag ? Math.min(0.9, mu0 + 0.25) : mu0;
    const vn = it.vel.dot(_n);
    const speed = it.vel.length();
    it.pos.copy(hit.point).addScaledVector(_n, it.r);
    // Normal- und Tangentialanteil
    _t.copy(it.vel).addScaledVector(_n, -vn).multiplyScalar(1 - mu);
    it.vel.copy(_t).addScaledVector(_n, -vn * e * (0.85 + Math.random() * 0.3));
    it.w.multiplyScalar(0.55).add(_v.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 18).multiplyScalar(Math.min(1, -vn / 3)));
    it.bounces++;
    if (-vn > 0.45 && it.sounds < 3) this._emit(it, hit.point, surf, -vn);
    const settled = (it.vel.length() < 0.45 && _n.y > 0.55) || it.bounces >= 7 || (speed < 0.6 && _n.y > 0.3);
    if (!settled) return;
    // Auf einem Fahrzeug bleibt nichts liegen (es fährt weg): verschwindet. An Wand/Schräge: Boden darunter suchen.
    if (hit.vehicle) this._kill(it);
    else if (_n.y < 0.55) this._land(it, world);
    else this._settle(it, _n, hit.point);
  }

  /** Auf den Boden unter der aktuellen Lage legen (Strahl nach unten); ohne Boden/auf Wasser/Fahrzeug: entfernen. */
  _land(it, world) {
    let hit = null;
    if (world && typeof world.raycast === 'function') {
      _o.copy(it.pos); _o.y += 0.05;
      this.stats.rays++;
      try { hit = world.raycast(_o, DOWN, 3); } catch { hit = null; }
      if (hit && hit.targetId !== undefined) hit = null;
    }
    if (!hit || hit.vehicle || hit.surface === 'water') {
      if (hit && hit.surface === 'water') this._emit(it, hit.point, 'water', 1);
      this._kill(it);
      return;
    }
    _n.copy(hit.normal);
    if (_n.y < 0) _n.negate();
    if (_n.y < 0.3) { this._kill(it); return; }
    this._settle(it, _n, hit.point);
  }

  /** Liegenbleiben: Hülse quer zur Normalen (zufällige Richtung), Magazin mit der dünnsten Achse zur Normalen. */
  _settle(it, normal, point) {
    it.flying = false;
    it.restT = 0;
    it.vel.set(0, 0, 0);
    it.w.set(0, 0, 0);
    const n = _n.copy(normal).normalize();
    if (point) it.pos.copy(point);
    if (it.mag) {
      const axis = it.thin === 0 ? X : it.thin === 1 ? Y : _v.set(0, 0, 1);
      _q.setFromUnitVectors(axis, Math.random() < 0.5 ? n : _t.copy(n).negate());
      _q2.setFromAxisAngle(n, Math.random() * Math.PI * 2);
      it.q.copy(_q2).multiply(_q);
      it.pos.addScaledVector(n, it.halfT + 0.002);
      return;
    }
    // Achse (lokal Y) in die Fläche legen
    _t.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _t.addScaledVector(n, -_t.dot(n));
    if (_t.lengthSq() < 1e-6) _t.crossVectors(n, X);
    _t.normalize();
    _q.setFromUnitVectors(Y, _t);
    _q2.setFromAxisAngle(_t, Math.random() * Math.PI * 2);
    it.q.copy(_q2).multiply(_q);
    // Halbmesser über der Fläche (Rand der Bodenkappe etwas breiter → leicht schräg, nie eingesunken)
    it.pos.addScaledVector(n, it.r * 0.97);
    this._rest(it);
  }

  /** Liegende Hülse einreihen: aus der Aktivliste, in Liegereihenfolge + Raster, Matrix ein letztes Mal schreiben. */
  _rest(it) {
    this._unactive(it);
    it.actor = null; // keine Verweise auf Figuren über das Match halten
    it.qid = ++this._qid;
    this._rq.push(it); this._rqId.push(it.qid); this._rqT.push(this._time);
    const key = cellKey(it.pos.x, it.pos.z);
    let arr = this._grid.get(key);
    if (!arr) this._grid.set(key, (arr = []));
    arr.push(it);
    it.cell = key;
    this._write(this.pools[it.type], it);
    this._compactQueue();
    this._enforceCaps(false);
  }

  _emit(it, point, surface, speed) {
    it.sounds++;
    const ev = this.events;
    if (!ev) return;
    ev.emit('shell:land', {
      position: point.clone ? point.clone() : new THREE.Vector3(point.x, point.y, point.z), surface,
      kind: it.mag ? 'mag' : 'shell', type: it.type, speed, first: it.sounds === 1, actor: it.actor,
    });
  }

  /* ================================================================ Puffer */

  _write(p, it) {
    _s.setScalar(Math.max(0, it.scale));
    if (it.scale <= 0) p.mesh.setMatrixAt(it.slot, ZERO_M);
    else {
      p.mesh.setMatrixAt(it.slot, _m.compose(it.pos, it.q, _s));
      if (!p.box.containsPoint(it.pos)) { p.box.expandByPoint(it.pos); p.grow = true; }
    }
    this._mark(p, it.slot, false);
  }

  _color(p, it, c) {
    p.mesh.instanceColor.setXYZ(it.slot, c[0], c[1], c[2]);
    this._mark(p, it.slot, true);
  }

  /** Geänderten Platz vormerken: bis 8 Plätze einzeln hochladen, sonst einen Bereich kleinster…größter. */
  _mark(p, slot, color) {
    const attr = color ? p.mesh.instanceColor : p.mesh.instanceMatrix, size = color ? 3 : 16;
    if (color) {
      if (p.cn === 0 || slot < p.cmin) p.cmin = slot;
      if (p.cn === 0 || slot > p.cmax) p.cmax = slot;
      if (++p.cn <= 8) attr.addUpdateRange(slot * size, size);
    } else {
      if (p.dn === 0 || slot < p.dmin) p.dmin = slot;
      if (p.dn === 0 || slot > p.dmax) p.dmax = slot;
      if (++p.dn <= 8) attr.addUpdateRange(slot * size, size);
    }
  }

  /** Vorgemerkte Änderungen hochladen und die Hülle der Sichtprüfung nachführen. */
  _flush(p) {
    const m = p.mesh;
    if (p.dn) {
      const a = m.instanceMatrix;
      if (p.dn > 8) { a.clearUpdateRanges(); a.addUpdateRange(p.dmin * 16, (p.dmax - p.dmin + 1) * 16); }
      a.needsUpdate = true;
      p.dn = 0;
    }
    if (p.cn) {
      const a = m.instanceColor;
      if (p.cn > 8) { a.clearUpdateRanges(); a.addUpdateRange(p.cmin * 3, (p.cmax - p.cmin + 1) * 3); }
      a.needsUpdate = true;
      p.cn = 0;
    }
    if (p.grow) {
      p.grow = false;
      p.box.getBoundingSphere(m.boundingSphere);
      m.boundingSphere.radius += 0.06; // halbe Hülsenlänge + Rand
    }
    if (!p.used && m.visible) m.visible = false;
  }

  /** Abkühlen: je Stufe ein Cursor über die Liegereihenfolge (jeder Eintrag einmal je Stufe, kein Durchlauf aller). */
  _updateCooling() {
    const q = this._rq, ids = this._rqId, ts = this._rqT;
    for (let s = 0; s < COOL.length; s++) {
      let c = Math.max(this._cool[s], this._rqHead);
      const lim = this._time - COOL[s].t;
      let guard = 64; // Spitzen verteilen (z. B. nach langem Bild)
      while (c < q.length && ts[c] <= lim && guard-- > 0) {
        const it = q[c];
        if (it.alive && !it.flying && it.qid === ids[c] && it.heat <= s) { it.heat = s + 1; this._color(this.pools[it.type], it, COOL[s].c); }
        c++;
      }
      this._cool[s] = c;
    }
  }

  /* ================================================================ Verwaltung */

  _unactive(it) {
    const i = it.ai;
    if (i < 0) return;
    const act = this.active, last = act.pop();
    if (last !== it) { act[i] = last; last.ai = i; }
    it.ai = -1;
  }

  _ungrid(it) {
    if (it.cell < 0) return;
    const arr = this._grid.get(it.cell);
    if (arr) {
      const i = arr.indexOf(it);
      if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
      if (!arr.length) this._grid.delete(it.cell);
    }
    it.cell = -1;
  }

  _kill(it) {
    if (it.mag) { this._removeMag(it); return; }
    const p = this.pools[it.type];
    if (p) this._freeShell(p, it);
  }

  _freeShell(p, it) {
    this._unactive(it);
    this._ungrid(it);
    p.mesh.setMatrixAt(it.slot, ZERO_M);
    this._mark(p, it.slot, false);
    p.free.push(it.slot);
    it.alive = false;
    it.flying = false;
    this.stats.shells = Math.max(0, this.stats.shells - 1);
  }

  /** Gültiger Eintrag der Liegereihenfolge? (Hülse lebt, liegt noch und wurde seitdem nicht neu eingereiht) */
  _validQ(i) {
    const it = this._rq[i];
    return it.alive && !it.flying && it.qid === this._rqId[i];
  }

  /**
   * Platz schaffen: unter den ältesten liegenden Hülsen die erste weit weg bzw. außer Sicht, sonst die älteste;
   * liegt keine, die älteste fliegende.
   */
  _evictShell() {
    const q = this._rq;
    while (this._rqHead < q.length && !this._validQ(this._rqHead)) this._rqHead++;
    let pick = -1;
    if (this._rqHead < q.length) {
      pick = this._rqHead;
      if (this._hasCam) {
        const c = this._cam, f = this._fwd;
        for (let i = this._rqHead, seen = 0; i < q.length && seen < EVICT_SCAN; i++) {
          if (!this._validQ(i)) continue;
          seen++;
          const p = q[i].pos, dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, d2 = dx * dx + dy * dy + dz * dz;
          // weit weg oder außerhalb von ~55° um die Blickrichtung
          if (d2 > EVICT_FAR * EVICT_FAR || dx * f.x + dy * f.y + dz * f.z < 0.57 * Math.sqrt(d2)) { pick = i; break; }
        }
      }
      const it = q[pick];
      this._freeShell(this.pools[it.type], it);
      return true;
    }
    if (this.active.length) {
      let o = this.active[0];
      for (const it of this.active) if (it.seq < o.seq) o = it;
      this._freeShell(this.pools[o.type], o);
      return true;
    }
    return false;
  }

  /** Liegereihenfolge kurz halten: verbrauchten Anfang abschneiden bzw. bei vielen veralteten Einträgen verdichten. */
  _compactQueue() {
    const q = this._rq, ids = this._rqId, ts = this._rqT;
    const live = this.stats.shells;
    if (this._rqHead > 256 && this._rqHead * 2 > q.length) {
      const h = this._rqHead;
      q.splice(0, h); ids.splice(0, h); ts.splice(0, h);
      this._rqHead = 0;
      for (let s = 0; s < this._cool.length; s++) this._cool[s] = Math.max(0, this._cool[s] - h);
    } else if (q.length - this._rqHead > 2 * live + 512) {
      // viele veraltete Einträge in der Mitte (weggetreten, verdrängt): gültige behalten, Reihenfolge bleibt
      let j = 0;
      const cool = this._cool;
      const next = cool.map(() => 0); // selten (Verdichten), Allokation unkritisch
      for (let i = 0; i < q.length; i++) {
        if (i >= this._rqHead && this._validQ(i)) { q[j] = q[i]; ids[j] = ids[i]; ts[j] = ts[i]; j++; }
        // Cursor: Anzahl der behaltenen Einträge vor dem alten Cursor
        for (let s = 0; s < cool.length; s++) if (i < cool[s]) next[s] = j;
      }
      for (let s = 0; s < cool.length; s++) cool[s] = next[s];
      q.length = ids.length = ts.length = j;
      this._rqHead = 0;
    }
  }

  /** Obergrenze der Stufe durchsetzen (beim Liegenbleiben bzw. Stufenwechsel). */
  _enforceCaps(all) {
    let guard = 4096;
    while (this.stats.shells > this.tier.shells && guard-- > 0) if (!this._evictShell()) break;
    if (all) while (this.mags.length > this.tier.mags) this._removeMag(this._oldestMag());
  }

  _oldestMag() {
    let o = this.mags[0];
    for (const m of this.mags) if (m.seq < o.seq) o = m;
    return o;
  }

  _removeMag(it) {
    if (!it) return;
    const i = this.mags.indexOf(it);
    if (i >= 0) this.mags.splice(i, 1);
    if (it.obj) {
      it.obj.removeFromParent();
      const proto = this._magProto.get(it.type);
      if (proto) proto.give(it.obj);
    }
    it.reset();
    this._magPool.push(it);
    this.stats.mags = this.mags.length;
  }

  clear() {
    for (const type of CASING_TYPES) {
      const p = this.pools[type], m = p.mesh;
      for (let i = 0; i < p.used; i++) if (p.items[i].alive) { p.items[i].reset(); m.setMatrixAt(i, ZERO_M); }
      p.free.length = 0;
      for (let i = CAP_PER_TYPE - 1; i >= 0; i--) p.free.push(i);
      p.used = 0; m.count = 0; m.visible = false;
      // ganzer Puffer (keine Teilbereiche) – auch die Farben auf Weiß
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.needsUpdate = true;
      m.instanceColor.array.fill(1); m.instanceColor.clearUpdateRanges(); m.instanceColor.needsUpdate = true;
      p.dn = p.cn = 0;
      p.box.makeEmpty(); p.grow = false;
      m.boundingSphere.set(_o.set(0, 0, 0), -1);
    }
    this.active.length = 0;
    this._rq.length = this._rqId.length = this._rqT.length = 0;
    this._rqHead = 0;
    this._cool.fill(0);
    this._grid.clear();
    while (this.mags.length) this._removeMag(this.mags[this.mags.length - 1]);
    this._pending.length = 0;
    this._hasCam = false;
    this.stats.shells = this.stats.mags = this.stats.flying = this.stats.resting = 0;
  }

  dispose() {
    this.clear();
    for (const type of CASING_TYPES) { const m = this.pools[type].mesh; m.geometry.dispose(); m.dispose(); }
    this._magProto.clear();
    this.group.removeFromParent();
    // Materialien (fx:brass/fx:shotshell) bleiben für das nächste Match gelinkt (wie die Effektschichten)
  }
}
