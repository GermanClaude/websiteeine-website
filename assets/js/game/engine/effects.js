// NULLPUNKT — Effekte (§7): gepoolte GPU-Partikel (instanzierte Billboards, alpha + additiv, gestreckte Funken,
// animierte Feuerball-Sprites), Leuchtspuren, Einschläge je Oberfläche (Beton-Staub + Splitter, Metallfunken,
// Holzsplitter, Erd-/Sandwolken, Wasserspritzer, Glas), Einschusslöcher (instanziert, polygonOffset,
// verblassend, ≤ preset.decals), stilisierter Blutnebel, Explosionen (Blitz, Feuerball, Glut, Trümmer,
// Rauchsäule, Staubring, Brandfleck, kurzes Punktlicht, Kamerawackeln nach Distanz), Mündungsfeuer + Hülsen
// der Bots, Zielfernrohr-Glanz gegnerischer Scharfschützen. Respektiert preset.particleScale/decals.
// Drei Draw Calls für alle Partikel, einer für Leuchtspuren, einer für Einschusslöcher.
// Realismus (weapons-feel): Hülsen und Magazine als Physik-lite in der Welt (weapons/ballistics/debris.js, alle
// Stufen, Klang über `shell:land`), Einschusslöcher ab medium mit Normalen-Atlas (Kraterränder fangen Licht),
// Splitter prallen am Boden ab, feiner Staub bleibt stehen, Mündungslicht in der Welt (high/ultra, dasselbe
// Punktlicht wie Explosionen → konstante Lichterzahl), Pulvergas eigener Schüsse, Rauchfäden aus heißen Läufen.

import * as THREE from 'three';
import { ParticleLayer, TracerLayer, DecalLayer, PF } from '../weapons/ballistics/fxlayers.js';
import { getParticleAtlas, getDecalAtlas, getDecalNormalAtlas, CELL, DECAL } from '../weapons/ballistics/fxtex.js';
import { Debris } from '../weapons/ballistics/debris.js';
import { handlingFor } from '../weapons/gunsmith/handling.js';

const ALPHA_CAP = 900;
const ADD_CAP = 640;
const DECAL_CAP = 120;
const TRACER_CAP = 56;
const PENDING_CAP = 24;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** sRGB-Hex → lineare RGB-Werte */
function lin(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }

// Oberflächen: Staubfarbe, Splitterfarbe, Einschuss-Zellen, Lochgröße (m), Art
const SURF = {
  concrete: { dust: lin('#aaa499'), chip: lin('#5d5952'), decal: [DECAL.CONCRETE, DECAL.CONCRETE_B], size: 0.2, kind: 'hard' },
  tile: { dust: lin('#d4ccbe'), chip: lin('#9c907f'), decal: [DECAL.PLASTER], size: 0.18, kind: 'hard' },
  plaster: { dust: lin('#e8decd'), chip: lin('#c9bca6'), decal: [DECAL.PLASTER], size: 0.2, kind: 'hard' },
  metal: { dust: lin('#8b8b88'), chip: lin('#55585d'), decal: [DECAL.METAL], size: 0.12, kind: 'metal' },
  wood: { dust: lin('#b39672'), chip: lin('#6c4d30'), decal: [DECAL.WOOD], size: 0.15, kind: 'wood' },
  dirt: { dust: lin('#86705a'), chip: lin('#46372a'), decal: [DECAL.SOFT], size: 0.24, kind: 'soft' },
  grass: { dust: lin('#7a7556'), chip: lin('#3d4729'), decal: [DECAL.SOFT], size: 0.22, kind: 'soft' },
  sand: { dust: lin('#e6d6b4'), chip: lin('#b39b72'), decal: [DECAL.SOFT], size: 0.26, kind: 'sand' },
  glass: { dust: lin('#e9f1f5'), chip: lin('#d4e7f1'), decal: [DECAL.GLASS], size: 0.26, kind: 'glass' },
  water: { dust: lin('#e8f1f7'), chip: lin('#dcebf4'), decal: null, size: 0, kind: 'water' },
  fabric: { dust: lin('#9a907d'), chip: lin('#5e5443'), decal: [DECAL.WOOD], size: 0.12, kind: 'fabric' },
};
// Dunklere Staubvariante für Explosionsringe (Kontrast zum gleichfarbigen Boden)
for (const k in SURF) { const d = SURF[k].dust; SURF[k].dustDark = [d[0] * 0.62, d[1] * 0.6, d[2] * 0.58]; }

const C = {
  spark: [1.0, 0.62, 0.26], sparkHot: [1.0, 0.85, 0.55], flash: [1.0, 0.78, 0.5], muzzle: [1.0, 0.66, 0.32],
  blood: lin('#a3160f'), bloodDark: lin('#640a07'), smoke: lin('#4c4945'), smokeLight: lin('#7d7770'), smokeDark: lin('#211d1a'),
  ember: [1.0, 0.45, 0.12], brass: lin('#c9a24a'), glint: [0.85, 0.95, 1.0], debris: lin('#3a342e'),
};

export class Effects {
  constructor(G) {
    this.G = G;
    this._subs = null;
    this._built = false;
    this._time = 0;
    this._pending = [];
    for (let i = 0; i < PENDING_CAP; i++) this._pending.push({ on: false, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, cell: 0, size: 0.1, life: 25, frame: 0 });
    this._camPos = new THREE.Vector3();
    this._camFwd = new THREE.Vector3(0, 0, -1);
    this._glintLos = new Map();
    this._lightLife = 0;
    this._lightPeak = 0;
    this._lightDur = 0.32;
    this._lightPrio = 0;
    this._light = null;
    this._delayed = [];
    this.stats = { impacts: 0, decals: 0, explosions: 0, tracers: 0, blood: 0, muzzle: 0 };
  }

  _build() {
    if (this._built) return;
    this._built = true;
    const atlas = getParticleAtlas();
    this.alpha = new ParticleLayer({ capacity: ALPHA_CAP, additive: false, texture: atlas, name: 'fx-alpha' });
    this.add = new ParticleLayer({ capacity: ADD_CAP, additive: true, texture: atlas, name: 'fx-add' });
    this.fire = new ParticleLayer({ capacity: 96, additive: false, lit: false, texture: atlas, name: 'fx-fire' });
    this.fire.mesh.renderOrder = 11;
    this.glints = new ParticleLayer({ capacity: 24, additive: true, texture: atlas, name: 'fx-glint' });
    this.glints.mesh.renderOrder = 14;
    this.tracers = new TracerLayer(TRACER_CAP);
    this.decals = new DecalLayer(getDecalAtlas(), DECAL_CAP, { normalMap: getDecalNormalAtlas });
    // Hülsen + Magazine in der Welt (Physik-lite gegen die Kugel-BVH, P4)
    this.debris = new Debris({ events: this.G && this.G.events });
    // Schwebestaub im Sonnenlicht (R6, medium+): eigene additive Schicht, je Staubkorn 1 Sonnenstrahl beim Entstehen
    this.motes = new ParticleLayer({ capacity: 128, additive: true, texture: atlas, name: 'fx-motes' });
    this.motes.mesh.renderOrder = 12;
  }

  get preset() { return (this.G.renderer && this.G.renderer.preset) || { particleScale: 1, decals: 120, id: 'high' }; }
  get scale() { const s = this.preset.particleScale; return Number.isFinite(s) ? s : 1; }

  attach(G) {
    this.G = G;
    this.detach();
    this._build();
    const scene = G.scene;
    scene.add(this.decals.mesh, this.alpha.mesh, this.fire.mesh, this.add.mesh, this.tracers.mesh, this.glints.mesh, this.debris.group, this.motes.mesh);
    // sichtbar lassen, bis main die Shader vorkompiliert hat (leere Schichten blenden sich im ersten update aus)
    for (const L of [this.alpha, this.fire, this.add, this.tracers, this.glints, this.motes]) L.mesh.visible = true;
    this.debris.events = G.events;
    this.debris.showForCompile();
    this.debris.setQuality(this.preset.id || G.renderer?.quality || 'high');
    // Decals 2.0: ab medium beleuchtete Einschusslöcher mit Normalen (zwischen Matches, Shader im Ladebildschirm)
    this.decals.setDetail((this.preset.id || G.renderer?.quality) !== 'low');
    this.decals.setLimit(this.preset.decals || 120);
    // Punktlicht nur ab „high“ (konstante Lichterzahl → kein Shader-Neukompilieren im Match)
    const id = this.preset.id || G.renderer?.quality;
    if (id === 'high' || id === 'ultra') {
      if (!this._light) { this._light = new THREE.PointLight(0xffa456, 0, 16, 2); this._light.name = 'fx-explosion-light'; }
      this._light.intensity = 0;
      scene.add(this._light);
    }
    this._updateLight();
    // Qualitätswechsel im Match (dynamische Auflösung): Lochanzahl anpassen
    if (G.renderer && typeof G.renderer.onQualityChange === 'function') {
      this._offQuality = G.renderer.onQualityChange((q) => {
        if (!this._built) return;
        this.decals.setLimit(this.preset.decals || 40);
        this.debris.setQuality(this.preset.id || q || 'high');
      });
    }
    const s = (this._subs = G.events.scope());
    s.on('impact', (e) => this._onImpact(e));
    s.on('actor:hit', (e) => this._onHit(e));
    s.on('explosion', (e) => { if (e && e.position) this.explosion(e.position, e.radius || 6, e); });
    s.on('tracer', (e) => this._onTracer(e));
    s.on('weapon:fire', (e) => this._onFire(e));
    s.on('kill', (e) => this._onKill(e));
    s.on('grenade:bounce', (e) => this._onBounce(e));
    s.on('weapon:reload', (e) => this._onReload(e));
    s.on('training:hit', (e) => this._cancelDecal(e && e.point));
    s.on('target:hit', (e) => this._cancelDecal(e && e.point));
    s.on('match:start', () => { this._updateLight(); });
  }

  detach() {
    if (this._subs) this._subs.dispose();
    this._subs = null;
    if (this._offQuality) { this._offQuality(); this._offQuality = null; }
    if (!this._built) return;
    for (const o of [this.decals.mesh, this.alpha.mesh, this.fire.mesh, this.add.mesh, this.tracers.mesh, this.glints.mesh, this.debris.group, this.motes.mesh]) o.removeFromParent();
    if (this._light) { this._light.removeFromParent(); this._light.intensity = 0; }
    this.clear();
  }

  /** Alle laufenden Effekte und Einschusslöcher entfernen. */
  clear() {
    if (!this._built) return;
    this.alpha.clear();
    this.fire.clear();
    this.add.clear();
    this.glints.clear();
    this.tracers.clear();
    this.decals.clear();
    this.debris.clear();
    this.motes.clear();
    this._delayed.length = 0;
    for (const p of this._pending) p.on = false;
    this._lightLife = 0;
    this._glintLos.clear();
  }

  /** Umgebungslicht für Staub/Rauch aus der Kartenbeleuchtung. */
  _updateLight() {
    if (!this._built) return;
    const L = this.G.world && this.G.world.lighting;
    const out = this.alpha.light;
    if (!L) { out.setRGB(1, 1, 1); return; }
    const si = (L.sunIntensity ?? 2.5) * 0.12;
    const hi = (L.hemiIntensity ?? 0.8) * 0.3;
    const ei = (L.envIntensity ?? 0.7) * 0.25;
    const sc = L.sunColor || { r: 1, g: 1, b: 1 };
    const hc = L.hemiSky || { r: 1, g: 1, b: 1 };
    out.setRGB(
      clamp(0.35 + sc.r * si + hc.r * hi + ei, 0.5, 1.3),
      clamp(0.35 + sc.g * si + hc.g * hi + ei, 0.5, 1.3),
      clamp(0.35 + sc.b * si + hc.b * hi + ei, 0.5, 1.3),
    );
  }

  /* ================================================================ Hilfen */

  /** LOD-Faktor nach Kameradistanz/Blickrichtung (0 = nicht zeichnen). */
  _lod(x, y, z) {
    const c = this._camPos;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 140 * 140) return 0;
    const f = this._camFwd;
    if (dx * f.x + dy * f.y + dz * f.z < -3) return 0; // hinter der Kamera
    const d = Math.sqrt(d2);
    return (d < 22 ? 1 : d < 55 ? 0.65 : 0.35) * this.scale;
  }

  _count(base, lod) {
    const n = base * lod;
    return Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
  }

  _syncCamera() {
    const cam = this.G.camera;
    if (!cam) return;
    cam.getWorldPosition(this._camPos);
    cam.getWorldDirection(this._camFwd);
  }

  /** Rauch-/Staubwolke (alpha). */
  _puff(x, y, z, vx, vy, vz, life, s0, s1, col, alpha, drag = 2.2, rise = 0.2, cell) {
    const L = this.alpha;
    const i = L.spawn(x, y, z, vx, vy, vz, life, s0, s1, col[0], col[1], col[2], alpha, cell ?? (Math.random() < 0.5 ? CELL.SMOKE_A : CELL.SMOKE_B));
    L.drag[i] = drag;
    L.grav[i] = -rise;
    L.rv[i] = rnd(-0.6, 0.6);
    L.fadeIn[i] = 0.08;
    L.fadePow[i] = 1.3;
    return i;
  }

  /** Splitter/Trümmer mit Schwerkraft (alpha). */
  _chip(x, y, z, vx, vy, vz, life, size, col, grav = 14, floor = null) {
    const L = this.alpha;
    const i = L.spawn(x, y, z, vx, vy, vz, life, size, size * 0.8, col[0], col[1], col[2], 1, CELL.CHIP);
    L.grav[i] = grav;
    L.drag[i] = 0.4;
    L.rv[i] = rnd(-14, 14);
    L.fadePow[i] = 0.35;
    if (floor !== null) { L.floorY[i] = floor; L.flags[i] |= PF.BOUNCE; }
    return i;
  }

  /** Funke, entlang der Geschwindigkeit gestreckt (additiv). */
  _spark(x, y, z, vx, vy, vz, life, size, col, intensity = 2.5, grav = 9, stretch = 0.022) {
    const L = this.add;
    const i = L.spawn(x, y, z, vx, vy, vz, life, size, size * 0.6, col[0] * intensity, col[1] * intensity, col[2] * intensity, 1, CELL.SPARK);
    L.grav[i] = grav;
    L.drag[i] = 1.2;
    L.stretch[i] = stretch;
    L.fadePow[i] = 0.8;
    return i;
  }

  /** Kurzer Blitz (additiv). */
  _flash(x, y, z, size, life, col, intensity, cell = CELL.SOFT) {
    const L = this.add;
    const i = L.spawn(x, y, z, 0, 0, 0, life, size, size * 1.15, col[0] * intensity, col[1] * intensity, col[2] * intensity, 1, cell);
    L.fadePow[i] = 1.6;
    return i;
  }

  /** Zufällige Richtung um die Normale (Halbkugel, gebündelt). */
  _scatter(nx, ny, nz, spread, out) {
    out.set(nx + rnd(-spread, spread), ny + rnd(-spread, spread), nz + rnd(-spread, spread));
    if (out.x * nx + out.y * ny + out.z * nz < 0.1) out.set(nx, ny, nz);
    return out.normalize();
  }

  /* ================================================================ Einschläge */

  _onImpact(e) {
    if (!e || !e.point || !e.normal) return;
    // Normale zum Schützen drehen (doppelseitige Flächen liefern sie teils abgewandt)
    const sh = e.shooter;
    let n = e.normal;
    if (sh && typeof sh.getEyePosition === 'function') {
      sh.getEyePosition(_t2).sub(e.point);
      if (_t2.dot(n) < 0) n = _n.copy(n).negate();
    }
    this.impact(e.point, n, e.surface || 'concrete', e);
  }

  /**
   * Einschlag auf einer Oberfläche (öffentlich).
   * opts: { melee (kein Loch), penetrated, weaponId, scale }
   */
  impact(point, normal, surface = 'concrete', opts = {}) {
    if (!this._built || !this._subs) return;
    this.stats.impacts++;
    const S = SURF[surface] || SURF.concrete;
    const px = point.x, py = point.y, pz = point.z;
    let nx = normal.x, ny = normal.y, nz = normal.z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // Einschussloch (verzögert: Schießstand-Klappziele melden sich im selben Ereignis)
    if (S.decal && !opts.melee && surface !== 'flesh') this._queueDecal(px, py, pz, nx, ny, nz, S, opts);
    const lod = this._lod(px, py, pz);
    if (lod <= 0) return;
    const k = opts.melee ? 0.5 : 1;
    // Ferne Einschläge größer (Lesbarkeit wie in COD Mobile)
    const c = this._camPos;
    const d = Math.hypot(px - c.x, py - c.y, pz - c.z);
    const g = (1 + Math.min(1.6, d / 28)) * (opts.scale || 1) * (opts.melee ? 0.6 : 1);
    const ox = px + nx * 0.03, oy = py + ny * 0.03, oz = pz + nz * 0.03;
    switch (S.kind) {
      case 'metal': this._impactMetal(ox, oy, oz, nx, ny, nz, S, lod * k, g); break;
      case 'wood': this._impactWood(ox, oy, oz, nx, ny, nz, S, lod * k, g); break;
      case 'soft': case 'sand': this._impactSoft(ox, oy, oz, nx, ny, nz, S, lod * k, g, S.kind === 'sand'); break;
      case 'water': this._impactWater(ox, oy, oz, nx, ny, nz, S, lod * k, g); break;
      case 'glass': this._impactGlass(ox, oy, oz, nx, ny, nz, S, lod * k, g); break;
      case 'fabric': this._impactFabric(ox, oy, oz, nx, ny, nz, S, lod * k, g); break;
      default: this._impactHard(ox, oy, oz, nx, ny, nz, S, lod * k, g);
    }
  }

  /** Bodenhöhe unter einem Einschlag (Splitter prallen dort ab statt durch den Boden zu fallen) oder null. */
  _floorY(x, y, z, ny) {
    if (ny > 0.7) return y - 0.02;
    const w = this.G.world;
    if (!w || typeof w.groundHeight !== 'function') return null;
    try { const g = w.groundHeight(x, z, y + 0.05); return g === null || g === undefined || y - g > 6 ? null : g + 0.02; } catch { return null; }
  }

  _impactHard(x, y, z, nx, ny, nz, S, lod, g) {
    // Aufschlag-Blitz: kurzer Funke (≈ 1–2 Bilder, Kugeln auf Beton glühen kaum) + schwacher Schein
    this._flash(x, y, z, 0.13 * g, 0.035, C.sparkHot, 2.4, CELL.STAR);
    this._flash(x, y, z, 0.26 * g, 0.05, C.flash, 1.3);
    // schneller heller Stoß + dunklerer Kern (auf hellem Putz sichtbar) + stehende Staubwolke
    this._puff(x, y, z, nx * 2.6, ny * 2.6 + 0.2, nz * 2.6, 0.38, 0.13 * g, 0.8 * g, S.dust, 0.9, 6, 0, CELL.SMOKE_A);
    this._puff(x, y, z, nx * 1.6, ny * 1.6 + 0.1, nz * 1.6, 0.5, 0.08 * g, 0.42 * g, S.dustDark, 0.6, 5, 0, CELL.SMOKE_B);
    const puffs = Math.max(1, this._count(3.6, lod));
    for (let i = 0; i < puffs; i++) {
      this._scatter(nx, ny, nz, 0.5, _v);
      const sp = rnd(0.7, 1.8);
      this._puff(x, y, z, _v.x * sp, _v.y * sp + 0.15, _v.z * sp, rnd(0.9, 1.4), 0.16 * g, rnd(0.9, 1.3) * g, S.dust, 0.68, 2.5, 0.15);
    }
    // Feiner Staub, der noch einige Sekunden in der Luft steht (realistisch: Beton- und Putzmehl)
    if (lod > 0.5) {
      const j = this._puff(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * 0.35, 0.06, nz * 0.35, rnd(1.8, 2.6), 0.16 * g, rnd(0.7, 0.95) * Math.min(g, 1.6), S.dust, 0.2, 1.4, 0.04, CELL.SMOKE_B);
      this.alpha.fadeIn[j] = 0.12;
      this.alpha.fadePow[j] = 1.1;
    }
    const chips = this._count(6, lod);
    const floor = chips ? this._floorY(x, y, z, ny) : null;
    for (let i = 0; i < chips; i++) {
      this._scatter(nx, ny, nz, 0.85, _v);
      const sp = rnd(3, 6.5);
      this._chip(x, y, z, _v.x * sp, _v.y * sp + 1, _v.z * sp, rnd(0.6, 1.1), rnd(0.024, 0.045) * Math.min(g, 1.5), S.chip, 14, floor);
    }
    // gelegentlich ein Funke (Stahlkern/Kies)
    if (Math.random() < 0.15 * lod) {
      this._scatter(nx, ny, nz, 0.9, _v);
      this._spark(x, y, z, _v.x * 7, _v.y * 7 + 1, _v.z * 7, rnd(0.12, 0.25), 0.02, C.sparkHot, 3, 9, 0.02);
    }
  }

  _impactMetal(x, y, z, nx, ny, nz, S, lod, g) {
    this._flash(x, y, z, 0.42 * g, 0.05, C.sparkHot, 3.6, CELL.STAR);
    this._flash(x, y, z, 0.55 * g, 0.08, C.spark, 1.1);
    const n = Math.max(3, this._count(12, lod));
    const sg = Math.min(g, 1.6);
    for (let i = 0; i < n; i++) {
      this._scatter(nx, ny, nz, 0.95, _v);
      const sp = rnd(5, 13);
      this._spark(x, y, z, _v.x * sp, _v.y * sp + 1.5, _v.z * sp, rnd(0.2, 0.5), rnd(0.024, 0.04) * sg, i % 3 ? C.spark : C.sparkHot, 4, 9, 0.028);
    }
    if (Math.random() < lod) this._puff(x, y, z, nx * 0.7, ny * 0.7 + 0.25, nz * 0.7, 0.8, 0.08 * g, 0.5 * g, S.dust, 0.5);
  }

  _impactWood(x, y, z, nx, ny, nz, S, lod, g) {
    this._flash(x, y, z, 0.22 * g, 0.05, C.flash, 1.0);
    const n = this._count(7, lod);
    const floor = n ? this._floorY(x, y, z, ny) : null;
    for (let i = 0; i < n; i++) {
      this._scatter(nx, ny, nz, 0.8, _v);
      const sp = rnd(3, 6.5);
      const j = this._chip(x, y, z, _v.x * sp, _v.y * sp + 1, _v.z * sp, rnd(0.7, 1.2), rnd(0.016, 0.026) * Math.min(g, 1.5), S.chip, 12, floor);
      this.alpha.stretch[j] = 0.035; // Splitter: länglich
    }
    this._puff(x, y, z, nx * 2.2, ny * 2.2 + 0.2, nz * 2.2, 0.35, 0.08 * g, 0.5 * g, S.dust, 0.8, 6, 0, CELL.SMOKE_A);
    const puffs = Math.max(1, this._count(1.8, lod));
    for (let i = 0; i < puffs; i++) {
      this._scatter(nx, ny, nz, 0.45, _v);
      this._puff(x, y, z, _v.x * 1.2, _v.y * 1.2 + 0.1, _v.z * 1.2, rnd(0.7, 1.1), 0.1 * g, rnd(0.5, 0.75) * g, S.dust, 0.6);
    }
  }

  _impactSoft(x, y, z, nx, ny, nz, S, lod, g, sand) {
    // Fontäne nach oben + breite Wolke
    this._puff(x, y, z, nx * 1.2, 3.2 + ny, nz * 1.2, 0.45, 0.12 * g, 0.8 * g, S.dust, 0.85, 5, 0, CELL.SMOKE_B);
    const puffs = Math.max(1, this._count(sand ? 4 : 3, lod));
    for (let i = 0; i < puffs; i++) {
      this._scatter(nx, ny, nz, 0.55, _v);
      const sp = rnd(0.8, 2.4);
      this._puff(x, y, z, _v.x * sp, _v.y * sp + 0.7, _v.z * sp, rnd(1.0, sand ? 1.7 : 1.35), 0.14 * g, rnd(0.8, sand ? 1.35 : 1.1) * g, S.dust, sand ? 0.66 : 0.74, 2.6, 0.05);
    }
    const clods = this._count(sand ? 7 : 5, lod);
    for (let i = 0; i < clods; i++) {
      this._scatter(nx, ny, nz, 0.6, _v);
      const sp = rnd(3, 6);
      const j = this._chip(x, y, z, _v.x * sp, _v.y * sp + 2.2, _v.z * sp, rnd(0.55, 0.9), (sand ? rnd(0.016, 0.026) : rnd(0.026, 0.045)) * Math.min(g, 1.5), S.chip, 14);
      if (sand) this.alpha.cell[j] = CELL.DROP;
    }
  }

  _impactWater(x, y, z, nx, ny, nz, S, lod, g) {
    const n = Math.max(4, this._count(11, lod));
    for (let i = 0; i < n; i++) {
      const sp = rnd(3, 7);
      const j = this._chip(x, y, z, rnd(-1.4, 1.4), sp, rnd(-1.4, 1.4), rnd(0.45, 0.85), rnd(0.035, 0.065) * Math.min(g, 1.5), S.chip, 13);
      this.alpha.cell[j] = CELL.DROP;
      this.alpha.a[j] = 0.85;
      this.alpha.stretch[j] = 0.035;
      this.alpha.rv[j] = 0;
    }
    // Wassersäule + Gischt
    const j = this.alpha.spawn(x, y, z, 0, 6, 0, 0.45, 0.1 * g, 0.18 * g, S.chip[0], S.chip[1], S.chip[2], 0.75, CELL.DROP);
    this.alpha.grav[j] = 14;
    this.alpha.stretch[j] = 0.14;
    this._puff(x, y + 0.05, z, 0, 0.8, 0, rnd(0.7, 1.0), 0.12 * g, 0.8 * g, S.dust, 0.55, 2, 0);
  }

  _impactGlass(x, y, z, nx, ny, nz, S, lod, g) {
    this._flash(x, y, z, 0.3 * g, 0.05, C.glint, 1.6, CELL.STAR);
    const n = this._count(9, lod);
    const floor = n ? this._floorY(x, y, z, ny) : null;
    for (let i = 0; i < n; i++) {
      this._scatter(nx, ny, nz, 0.95, _v);
      const sp = rnd(1.5, 5);
      const j = this._chip(x, y, z, _v.x * sp, _v.y * sp + 0.5, _v.z * sp, rnd(0.8, 1.3), rnd(0.018, 0.034) * Math.min(g, 1.5), S.chip, 13, floor);
      this.alpha.a[j] = 0.85;
    }
    for (let i = 0; i < 4; i++) {
      this._scatter(nx, ny, nz, 1, _v);
      this._spark(x, y, z, _v.x * 3, _v.y * 3 + 1, _v.z * 3, rnd(0.25, 0.5), 0.016, C.glint, 3, 12, 0.006);
    }
    this._puff(x, y, z, nx * 0.6, ny * 0.6, nz * 0.6, 0.7, 0.08 * g, 0.45 * g, S.dust, 0.45);
  }

  _impactFabric(x, y, z, nx, ny, nz, S, lod, g) {
    this._puff(x, y, z, nx * 1.8, ny * 1.8, nz * 1.8, 0.35, 0.06 * g, 0.4 * g, S.dust, 0.7, 6, 0, CELL.SMOKE_A);
    const puffs = Math.max(1, this._count(2, lod));
    for (let i = 0; i < puffs; i++) {
      this._scatter(nx, ny, nz, 0.5, _v);
      this._puff(x, y, z, _v.x * 0.9, _v.y * 0.9, _v.z * 0.9, rnd(0.6, 0.9), 0.08 * g, 0.45 * g, S.dust, 0.55);
    }
    const n = this._count(3, lod);
    for (let i = 0; i < n; i++) {
      this._scatter(nx, ny, nz, 0.8, _v);
      const j = this._chip(x, y, z, _v.x * 2.5, _v.y * 2.5 + 0.5, _v.z * 2.5, rnd(0.4, 0.7), 0.014, S.chip, 6);
      this.alpha.stretch[j] = 0.02;
    }
  }

  /* ================================================================ Einschusslöcher */

  _queueDecal(x, y, z, nx, ny, nz, S, opts) {
    // Ferne Löcher sind unsichtbar – Pool nicht verschwenden
    const c = this._camPos;
    const d2 = (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2;
    if (d2 > 75 * 75) return;
    let slot = null;
    for (const p of this._pending) if (!p.on) { slot = p; break; }
    if (!slot) return;
    slot.on = true;
    slot.x = x; slot.y = y; slot.z = z;
    slot.nx = nx; slot.ny = ny; slot.nz = nz;
    slot.cell = S.decal[(Math.random() * S.decal.length) | 0];
    slot.size = S.size * rnd(0.85, 1.2) * (opts.scale || 1);
    slot.life = S.kind === 'glass' ? 40 : 28;
  }

  _cancelDecal(point) {
    if (!point) return;
    for (const p of this._pending) {
      if (!p.on) continue;
      const d2 = (p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (p.z - point.z) ** 2;
      if (d2 < 0.2 * 0.2) p.on = false;
    }
  }

  _flushDecals() {
    if (!(this.preset.decals > 0)) { for (const p of this._pending) p.on = false; return; }
    for (const p of this._pending) {
      if (!p.on) continue;
      p.on = false;
      _t1.set(p.x, p.y, p.z);
      _n.set(p.nx, p.ny, p.nz);
      this.decals.add(p.cell, _t1, _n, p.size, p.life, this._time);
      this.stats.decals++;
    }
  }

  /* ================================================================ Treffer am Körper */

  _onHit(e) {
    if (!e || e.explosive || !e.point || !e.target) return;
    if (e.target.isPlayer) return; // nie Blut vor der eigenen Kamera
    this.blood(e.point, e.dir, { headshot: e.zone === 'head', killed: !!e.killed, melee: e.weaponId === 'knife' });
  }

  /** Stilisierter Treffernebel (nicht drastisch: dunkelrot, schnell verflogen). */
  blood(point, dir, { headshot = false, killed = false, melee = false } = {}) {
    if (!this._built || !this._subs) return;
    const lod = this._lod(point.x, point.y, point.z);
    if (lod <= 0) return;
    this.stats.blood++;
    let dx = dir ? dir.x : 0, dy = dir ? dir.y : 0, dz = dir ? dir.z : 0;
    if (!dir) { const c = this._camPos; dx = point.x - c.x; dy = point.y - c.y; dz = point.z - c.z; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
    const big = headshot ? 1.4 : melee ? 1.2 : 1;
    // Eintritt: etwas vor dem Körper (sonst verdeckt), Nebel weht zum Schützen zurück
    const ex = point.x - dx * 0.14, ey = point.y - dy * 0.14, ez = point.z - dz * 0.14;
    const k = this._puff(ex, ey, ez, -dx * 0.5, 0.15, -dz * 0.5, 0.22, 0.14 * big, 0.5 * big, C.blood, 0.55, 6, 0, CELL.SOFT);
    this.alpha.fadePow[k] = 1.4;
    const puffs = Math.max(1, this._count(headshot ? 3 : 2, Math.max(0.7, lod)));
    for (let i = 0; i < puffs; i++) {
      const sp = rnd(0.3, 0.9);
      const j = this._puff(ex, ey, ez, -dx * sp + rnd(-0.5, 0.5), rnd(0, 0.6), -dz * sp + rnd(-0.5, 0.5),
        rnd(0.28, 0.4) * big, 0.1 * big, rnd(0.36, 0.52) * big, i % 2 ? C.blood : C.bloodDark, 0.9, 4.5, 0, CELL.SMOKE_A);
      this.alpha.fadePow[j] = 1.5;
    }
    // Austritt hinter dem Ziel
    const xx = point.x + dx * 0.42, xy = point.y + dy * 0.42, xz = point.z + dz * 0.42;
    const j = this._puff(xx, xy, xz, dx * 1.6, dy * 1.6 + 0.2, dz * 1.6, rnd(0.3, 0.45) * big, 0.12 * big, 0.6 * big, C.bloodDark, 0.8, 4, 0, CELL.SMOKE_B);
    this.alpha.fadePow[j] = 1.5;
    const drops = this._count(headshot ? 8 : 5, lod);
    for (let i = 0; i < drops; i++) {
      const back = i % 2 === 0;
      const sp = rnd(1.2, 3);
      const sx = back ? xx : ex, sy = back ? xy : ey, sz = back ? xz : ez;
      const sgn = back ? 1 : -0.5;
      const q = this._chip(sx, sy, sz, dx * sp * sgn + rnd(-1, 1), dy * sp * sgn + rnd(0.3, 1.8), dz * sp * sgn + rnd(-1, 1), rnd(0.3, 0.5), rnd(0.016, 0.028), C.bloodDark, 12);
      this.alpha.cell[q] = CELL.DROP;
      this.alpha.rv[q] = 0;
      this.alpha.stretch[q] = 0.02;
    }
    if (killed && headshot) this._flash(ex, ey, ez, 0.3, 0.06, C.flash, 0.7);
  }

  _onKill(e) {
    // Leichter Staub beim Aufschlagen des Körpers
    const v = e && e.victim;
    if (!v || !v.position || v.isPlayer || e.explosive) return;
    const lod = this._lod(v.position.x, v.position.y, v.position.z);
    if (lod <= 0) return;
    const surf = SURF[this.G.world && this.G.world.surfaceAt ? this.G.world.surfaceAt(v.position) : 'concrete'] || SURF.concrete;
    if (surf.kind === 'water') return;
    const n = Math.max(1, this._count(3, lod));
    for (let i = 0; i < n; i++) {
      const j = this._puff(v.position.x + rnd(-0.4, 0.4), v.position.y + 0.1, v.position.z + rnd(-0.4, 0.4), rnd(-0.6, 0.6), 0.25, rnd(-0.6, 0.6), rnd(0.9, 1.3), 0.2, 0.8, surf.dust, 0.35, 2, 0.05);
      this.alpha.delay[j] = 0.45 + Math.random() * 0.15;
    }
  }

  _onBounce(e) {
    if (!e || !e.position || !(e.speed > 3)) return;
    const S = SURF[e.surface] || SURF.concrete;
    const p = e.position;
    const lod = this._lod(p.x, p.y, p.z);
    if (lod <= 0) return;
    if (S.kind === 'water') { this._impactWater(p.x, p.y, p.z, 0, 1, 0, S, lod * 0.6); return; }
    if (S.kind === 'metal' && e.speed > 6) this._spark(p.x, p.y, p.z, rnd(-2, 2), 2, rnd(-2, 2), 0.2, 0.012, C.spark, 2.5);
    this._puff(p.x, p.y, p.z, 0, 0.3, 0, 0.6, 0.05, 0.3, S.dust, 0.35);
  }

  /* ================================================================ Leuchtspuren + Mündungsfeuer */

  _onTracer(e) {
    if (!e || !e.from || !e.to || !this._built) return;
    const a = e.actor;
    const W = this.G.data && this.G.data.WEAPONS;
    const def = W && e.weaponId ? W[e.weaponId] : null;
    const cls = def ? def.cls : 'ar';
    const player = !!(a && a.isPlayer);
    let speed = 430, seg = 7, width = player ? 0.016 : 0.022, intensity = player ? 0.85 : 1.15;
    if (cls === 'sniper') { speed = 650; seg = 16; width = 0.03; intensity = 1.6; }
    else if (cls === 'marksman') { speed = 560; seg = 11; width = 0.024; intensity = 1.3; }
    else if (cls === 'shotgun') { speed = 340; seg = 3; width = 0.012; intensity = 0.7; }
    else if (cls === 'pistol') { seg = 5; intensity *= 0.85; }
    this.tracers.add(e.from.x, e.from.y, e.from.z, e.to.x, e.to.y, e.to.z, { speed, seg, width, intensity, skip: player ? 0.8 : 0.25 });
    this.stats.tracers++;
  }

  _onFire(e) {
    if (!e || !e.actor || e.suppressed) return;
    const W = this.G.data && this.G.data.WEAPONS;
    const def = W && e.weaponId ? W[e.weaponId] : null;
    if (def && def.cls === 'melee') return;
    if (e.actor.isPlayer) { this._playerShot(e, def); return; }
    let pos = e.muzzle;
    if (!pos && e.origin && e.dir) pos = _t2.copy(e.origin).addScaledVector(e.dir, 0.65);
    if (!pos || !e.dir) return;
    this.muzzleFlash(pos, e.dir, { cls: def ? def.cls : 'ar', actor: e.actor, def });
  }

  /**
   * Eigener Schuss (Mündungsfeuer selbst zeichnet das Viewmodel): kurzes Mündungslicht in der Welt (high/ultra,
   * gleiches Punktlicht wie Explosionen → konstante Lichterzahl), Pulvergas als kleine Wolke vor der Mündung,
   * bei schweren Waffen größer und länger stehend.
   */
  _playerShot(e, def) {
    const pos = e.muzzle;
    if (!pos || !e.dir || !this._built) return;
    const cls = def ? def.cls : 'ar';
    const big = cls === 'shotgun' ? 1.9 : cls === 'sniper' ? 1.6 : cls === 'lmg' ? 1.3 : cls === 'marksman' ? 1.2 : cls === 'pistol' ? 0.7 : cls === 'smg' ? 0.8 : 1;
    this.muzzleLight(pos, 13 * big, 2, 0.045, 7);
    // Pulvergas in der Welt nur bei schweren Waffen (Flinte, Scharfschütze, LMG, PG) und nicht auf low: die Wolke
    // entsteht vor der Mündung und bleibt klein im Bild (große Sprites direkt vor der Kamera kosten Füllrate)
    const sc = this.scale;
    if (big < 1.2 || sc < 0.5) return;
    const d = e.dir;
    const fw = 0.25 + 0.1 * big;
    const k = this._puff(pos.x + d.x * fw, pos.y + d.y * fw, pos.z + d.z * fw, d.x * 1.6, d.y * 1.6 + 0.05, d.z * 1.6, 0.3 + 0.1 * big, 0.03 * big, 0.14 * big, C.smokeLight, 0.1 + 0.03 * big, 5.5, 0.05, CELL.SMOKE_A);
    this.alpha.fadeIn[k] = 0.02;
    if (big >= 1.5 && (this._pShot = ((this._pShot || 0) + 1) % 2) === 0) {
      // Flinte/Scharfschütze: stehende Wolke ein Stück vor der Mündung
      const sp = rnd(0.5, 1.1);
      this._puff(pos.x + d.x * 0.6, pos.y + d.y * 0.6, pos.z + d.z * 0.6, d.x * sp + rnd(-0.15, 0.15), d.y * sp + rnd(0.05, 0.2), d.z * sp + rnd(-0.15, 0.15),
        rnd(1.0, 1.6), 0.06 * big, rnd(0.28, 0.4) * big, C.smokeLight, 0.08 + 0.02 * big, 1.8, 0.2);
    }
  }

  /**
   * Kurzes Licht an einer Mündung (nur mit Punktlicht, d. h. high/ultra). prio: Explosion 3 > Spieler 2 > Bot 1.
   */
  muzzleLight(pos, peak = 13, prio = 1, dur = 0.045, distance = 7) {
    const L = this._light;
    if (!L || !pos) return;
    if (this._lightLife > 0 && prio < this._lightPrio) return;
    L.position.set(pos.x, pos.y, pos.z);
    L.color.setHex(0xffb066);
    L.distance = distance;
    this._lightLife = this._lightDur = dur;
    this._lightPeak = peak;
    this._lightPrio = prio;
    L.intensity = peak;
  }

  /**
   * Rauchfaden aus dem heißen Lauf (Viewmodel meldet ihn nach Feuerstößen): dünn, langsam steigend, lange stehend.
   * opts: { strength 0..1 }
   */
  wisp(pos, opts = {}) {
    if (!this._built || !this._subs || !pos) return;
    const st = clamp(opts.strength ?? 0.5, 0, 1);
    if (Math.random() > Math.max(0.35, this.scale)) return;
    const j = this._puff(pos.x + rnd(-0.01, 0.01), pos.y + 0.01, pos.z + rnd(-0.01, 0.01), rnd(-0.04, 0.04), 0.0, rnd(-0.04, 0.04),
      rnd(1.2, 2.0), 0.01, rnd(0.05, 0.09) * (0.7 + 0.5 * st), C.smokeLight, 0.06 + 0.12 * st, 0.8, rnd(0.25, 0.4), CELL.SMOKE_B);
    this.alpha.fadeIn[j] = 0.15;
    this.alpha.fadePow[j] = 1.1;
    this.alpha.rv[j] = rnd(-0.8, 0.8);
  }

  /** Mündungsfeuer (dritte Person). opts: { cls, actor, scale } */
  muzzleFlash(pos, dir, opts = {}) {
    if (!this._built || !this._subs) return;
    const c = this._camPos;
    const d = Math.hypot(pos.x - c.x, pos.y - c.y, pos.z - c.z);
    if (d > 160) return;
    const f = this._camFwd;
    if ((pos.x - c.x) * f.x + (pos.y - c.y) * f.y + (pos.z - c.z) * f.z < -2) return;
    this.stats.muzzle++;
    const cls = opts.cls || 'ar';
    const big = (cls === 'shotgun' || cls === 'sniper' || cls === 'lmg' ? 1.35 : cls === 'smg' || cls === 'pistol' ? 0.8 : 1) * (opts.scale || 1);
    // Ferne Mündungsfeuer etwas größer (Lesbarkeit wie COD)
    const far = 1 + Math.min(1.6, d / 45);
    // Jedes Mündungsfeuer anders (Größe, Länge der Zunge, manchmal Seitenstrahlen) – sehr kurz, wie auf Video
    const vary = rnd(0.75, 1.25);
    const s = 0.22 * big * far * vary;
    if (d < 30) this.muzzleLight(pos, 10 * big * vary, 1, 0.04, 6);
    const j = this._flash(pos.x, pos.y, pos.z, s, rnd(0.03, 0.05), C.muzzle, 2.6, CELL.STAR);
    this.add.s1[j] = s * 0.7;
    // Flammenzunge nach vorn
    const L = this.add;
    const tongue = rnd(0.6, 1.3);
    const k = L.spawn(pos.x + dir.x * 0.05, pos.y + dir.y * 0.05, pos.z + dir.z * 0.05, dir.x, dir.y, dir.z, 0.045,
      0.09 * big * Math.min(far, 1.6) * tongue, 0.07 * big, C.muzzle[0] * 2.4, C.muzzle[1] * 2.4, C.muzzle[2] * 2.4, 1, CELL.FLAME);
    L.stretch[k] = 0.32 * big * tongue;
    L.fadePow[k] = 1.2;
    // Seitenstrahlen (Mündungsbremse/Feuerdämpfer-Schlitze) nicht bei jedem Schuss
    if (d < 60 && Math.random() < 0.55) {
      _v.crossVectors(dir, UP);
      if (_v.lengthSq() > 1e-6) {
        _v.normalize();
        for (const sg of [-1, 1]) {
          const q = L.spawn(pos.x, pos.y, pos.z, _v.x * sg, rnd(-0.2, 0.2), _v.z * sg, 0.03, 0.05 * big * Math.min(far, 1.6), 0.03 * big,
            C.muzzle[0] * 1.8, C.muzzle[1] * 1.8, C.muzzle[2] * 1.8, 1, CELL.FLAME);
          L.stretch[q] = 0.12 * big * rnd(0.6, 1.2);
          L.fadePow[q] = 1.4;
        }
      }
    }
    if (d < 40 && this.scale > 0.4) {
      this._puff(pos.x, pos.y, pos.z, dir.x * 0.8, dir.y * 0.8 + 0.2, dir.z * 0.8, rnd(0.5, 0.8), 0.04, 0.3 * big, C.smokeLight, 0.18, 2.5, 0.25);
    }
    // Hülse (nahe Bots): echte Hülse in der Welt (Physik-lite), Repetierer/Flinte erst beim Durchladen
    const a = opts.actor;
    if (a && d < 24 && Math.random() < Math.max(0.35, this.scale)) {
      const def = opts.def;
      const type = def ? handlingFor(def.model || def.id).shell : (cls === 'shotgun' ? 'shotgun' : cls === 'pistol' || cls === 'smg' ? 'pistol' : cls === 'sniper' ? 'big' : 'rifle');
      if (type && type !== 'none') {
        _v.crossVectors(dir, UP);
        if (_v.lengthSq() > 1e-6) {
          _v.normalize();
          const delay = def && (def.fireMode === 'bolt' || def.fireMode === 'pump') ? (def.fireMode === 'bolt' ? 0.55 : 0.32) : 0;
          _t1.set(pos.x - dir.x * 0.42, pos.y - dir.y * 0.42 + 0.03, pos.z - dir.z * 0.42);
          const bv = a.body && a.body.velocity;
          _w.set(_v.x * rnd(1.6, 2.6) + (bv ? bv.x : 0), rnd(1.3, 2.2) + (bv ? bv.y * 0.5 : 0), _v.z * rnd(1.6, 2.6) + (bv ? bv.z : 0));
          this.dropCasing(type, _t1, _w, null, { actor: a, delay });
        }
      }
    }
  }

  /**
   * Hülse in die Welt werfen (Physik-lite, Klang über `shell:land`). type: rifle | pistol | big | shotgun.
   * opts: { actor, delay (s) }
   */
  dropCasing(type, pos, vel, quat, opts = {}) {
    if (!this._built || !this._subs || !type || type === 'none') return;
    if (opts.delay > 0) {
      if (this._delayed.length < 32) this._delayed.push({ at: this._time + opts.delay, type, pos: pos.clone(), vel: vel.clone(), actor: opts.actor || null });
      return;
    }
    this.debris.casing(type, pos, vel, quat, opts);
  }

  /** Magazin fallen lassen (3rd-Person-Modell `key` = def.model). opts: { actor, delay (s) } */
  dropMagazine(key, pos, vel, quat, opts = {}) {
    if (!this._built || !this._subs || !key) return;
    this.debris.magazine(key, pos, vel, quat, opts);
  }

  /** Bots: beim Nachladen fällt das leere bzw. angebrochene Magazin (Spieler: Viewmodel, passend zur Animation). */
  _onReload(e) {
    if (!e || e.phase !== 'start' || !e.actor || e.actor.isPlayer || !this._built) return;
    const a = e.actor;
    const W = this.G.data && this.G.data.WEAPONS;
    const def = W && e.weaponId ? W[e.weaponId] : null;
    if (!def || def.perShellReload || def.cls === 'melee' || !a.position) return;
    const c = this._camPos;
    if (Math.hypot(a.position.x - c.x, a.position.y - c.y, a.position.z - c.z) > 26) return;
    if (typeof a.getMuzzlePosition === 'function') a.getMuzzlePosition(_t1);
    else { a.getEyePosition(_t1); _t1.y -= 0.3; }
    a.getAimDirection(_dir);
    _t1.addScaledVector(_dir, -0.42);
    _t1.y -= 0.12;
    const bv = a.body && a.body.velocity;
    _w.set((bv ? bv.x : 0) + rnd(-0.3, 0.3), -0.6, (bv ? bv.z : 0) + rnd(-0.3, 0.3));
    this.debris.magazine(def.model || def.id, _t1, _w, null, { actor: a, delay: def.cls === 'pistol' ? 0.2 : 0.38 });
  }

  /** Leuchtspur (öffentlich). */
  tracer(from, to, opts) {
    if (!this._built) return;
    this.tracers.add(from.x, from.y, from.z, to.x, to.y, to.z, opts || {});
  }

  /* ================================================================ Explosionen */

  /**
   * Explosion (öffentlich): Blitz, Feuerball, Glut, Trümmer, Rauchsäule, Staubring, Brandfleck,
   * Punktlicht, Kamerawackeln. opts: { type }
   */
  explosion(position, radius = 6, opts = {}) {
    if (!this._built || !this._subs) return;
    this.stats.explosions++;
    const G = this.G;
    const x = position.x, y = position.y, z = position.z;
    const R = clamp(radius / 6.5, 0.5, 2.2);
    const sc = Math.max(0.35, this.scale);
    // Boden darunter (Brandfleck, Staubfarbe, Wasser)
    let ground = null;
    const w = G.world;
    if (w && typeof w.raycast === 'function') {
      _t1.set(x, y + 0.3, z);
      ground = w.raycast(_t1, _down, 2.4);
    }
    const surf = ground ? SURF[ground.surface] || SURF.concrete : SURF.concrete;
    const gy = ground ? ground.point.y : y - 0.1;
    const water = surf.kind === 'water';

    // Kamerawackeln + Licht
    const p = G.player;
    if (p && p.alive && typeof p.shake === 'function') {
      const d = p.position.distanceTo(position);
      const k = clamp(1.15 - d / (radius * 2.8), 0, 1);
      if (k > 0) p.shake(0.95 * k * k + 0.05);
    }
    if (this._light) {
      this._light.position.set(x, y + 0.8, z);
      this._light.color.setHex(0xffa456);
      this._light.distance = 16;
      this._lightLife = this._lightDur = 0.32;
      this._lightPeak = 70 * R;
      this._lightPrio = 3;
      this._light.intensity = this._lightPeak;
    }

    // Blitz
    this._flash(x, y + 0.4, z, 5 * R, 0.14, C.flash, 4);
    this._flash(x, y + 0.4, z, 3.2 * R, 0.09, C.sparkHot, 5, CELL.STAR);

    if (water) {
      // Wasserfontäne statt Feuer
      const n = Math.round(26 * sc);
      for (let i = 0; i < n; i++) {
        const j = this._chip(x + rnd(-0.6, 0.6), gy + 0.1, z + rnd(-0.6, 0.6), rnd(-2.5, 2.5) * R, rnd(7, 15) * R, rnd(-2.5, 2.5) * R, rnd(0.9, 1.5), rnd(0.05, 0.1) * R, surf.chip, 14);
        this.alpha.cell[j] = CELL.DROP;
        this.alpha.stretch[j] = 0.05;
        this.alpha.a[j] = 0.85;
        this.alpha.rv[j] = 0;
      }
      for (let i = 0; i < Math.round(8 * sc); i++) {
        this._puff(x + rnd(-1, 1), gy + rnd(0.2, 2.5), z + rnd(-1, 1), rnd(-1.5, 1.5), rnd(1, 4), rnd(-1.5, 1.5), rnd(1.2, 2), 0.6 * R, 2.6 * R, surf.dust, 0.5, 1.5, 0.3);
      }
      return;
    }

    // Feuerball: alpha-geblendet (Kontrast auch vor hellem Himmel) + additiver Kern (Bloom)
    const fires = Math.max(5, Math.round(10 * sc));
    for (let i = 0; i < fires; i++) {
      const L = this.fire;
      const j = L.spawn(x + rnd(-0.6, 0.6) * R, y + rnd(0.2, 1.1) * R, z + rnd(-0.6, 0.6) * R,
        rnd(-4.5, 4.5) * R, rnd(2, 6.5) * R, rnd(-4.5, 4.5) * R, rnd(0.55, 0.95), rnd(1.4, 2.1) * R, rnd(3.4, 4.8) * R, 3.2, 2.1, 1.3, 1, CELL.FIRE);
      L.flags[j] |= PF.ANIM;
      L.frames[j] = CELL.FIRE_FRAMES;
      L.drag[j] = 3.4;
      L.grav[j] = -3;
      L.rv[j] = rnd(-1.4, 1.4);
      L.fadePow[j] = 0.6;
    }
    for (let i = 0; i < Math.max(2, Math.round(4 * sc)); i++) {
      const L = this.add;
      const j = L.spawn(x + rnd(-0.4, 0.4) * R, y + rnd(0.3, 0.9) * R, z + rnd(-0.4, 0.4) * R, rnd(-2, 2), rnd(1, 3), rnd(-2, 2),
        rnd(0.3, 0.45), 1.6 * R, 3.2 * R, 1.8, 1.0, 0.45, 1, CELL.FIRE);
      L.flags[j] |= PF.ANIM;
      L.frames[j] = CELL.FIRE_FRAMES;
      L.drag[j] = 3;
      L.fadePow[j] = 1.2;
    }
    // Glut / Funken
    const embers = Math.round(30 * sc);
    for (let i = 0; i < embers; i++) {
      _v.set(rnd(-1, 1), rnd(0.15, 1.2), rnd(-1, 1)).normalize();
      const sp = rnd(9, 24) * Math.sqrt(R);
      this._spark(x, y + 0.2, z, _v.x * sp, _v.y * sp, _v.z * sp, rnd(0.45, 1.2), rnd(0.03, 0.05), i % 2 ? C.ember : C.spark, 3.5, 9, 0.03);
    }
    // Trümmer
    const debris = Math.round(18 * sc);
    for (let i = 0; i < debris; i++) {
      _v.set(rnd(-1, 1), rnd(0.4, 1.5), rnd(-1, 1)).normalize();
      const sp = rnd(5, 14) * Math.sqrt(R);
      this._chip(x, y + 0.2, z, _v.x * sp, _v.y * sp, _v.z * sp, rnd(1.1, 1.8), rnd(0.05, 0.11) * R, i % 3 ? C.debris : surf.chip, 18, gy + 0.03);
    }
    // Dunkler Qualm im Feuer, dann Rauchsäule
    const dark = Math.max(3, Math.round(7 * sc));
    for (let i = 0; i < dark; i++) {
      const j = this._puff(x + rnd(-0.7, 0.7) * R, y + rnd(0.4, 1.5) * R, z + rnd(-0.7, 0.7) * R, rnd(-1.5, 1.5), rnd(1.5, 3.5) * R, rnd(-1.5, 1.5),
        rnd(1.6, 2.6), 1.3 * R, rnd(3.2, 4.4) * R, C.smokeDark, 0.82, 1.6, 0.6);
      this.alpha.delay[j] = rnd(0.04, 0.14);
      this.alpha.fadeIn[j] = 0.06;
    }
    const smokes = Math.max(4, Math.round(12 * sc));
    for (let i = 0; i < smokes; i++) {
      const j = this._puff(x + rnd(-0.9, 0.9) * R, y + rnd(0.3, 1.6) * R, z + rnd(-0.9, 0.9) * R,
        rnd(-0.8, 0.8), rnd(1.4, 3.4) * R, rnd(-0.8, 0.8), rnd(3.5, 6), rnd(1.3, 1.9) * R, rnd(5, 7.5) * R,
        i % 3 ? C.smoke : C.smokeLight, rnd(0.62, 0.8), 1.0, 0.45);
      this.alpha.delay[j] = rnd(0.12, 0.45);
      this.alpha.fadeIn[j] = 0.1;
      this.alpha.fadePow[j] = 0.9;
      this.alpha.rv[j] = rnd(-0.3, 0.3);
    }
    // Staubring am Boden
    if (ground) {
      const ring = Math.max(6, Math.round(14 * sc));
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2 + rnd(-0.2, 0.2);
        const sp = rnd(6, 10) * R;
        this._puff(x + Math.cos(a) * 0.6, gy + 0.3, z + Math.sin(a) * 0.6, Math.cos(a) * sp, rnd(0.4, 1.2), Math.sin(a) * sp,
          rnd(1.6, 2.8), 0.7 * R, rnd(2.8, 4.2) * R, surf.dustDark || surf.dust, 0.8, 2.6, 0.12);
      }
      // Brandfleck
      if (this.preset.decals > 0 && ground.normal.y > 0.5) {
        _t1.copy(ground.point);
        this.decals.add(DECAL.SCORCH, _t1, ground.normal, rnd(2.8, 3.6) * R, 45, this._time, 0.95);
      }
    }
  }

  /** Rauchwolke (öffentlich). opts: { count, size, life, color, rise, alpha } */
  smoke(position, opts = {}) {
    if (!this._built) return;
    const n = Math.max(1, Math.round((opts.count || 4) * this.scale));
    const col = opts.color ? lin(opts.color) : C.smokeLight;
    for (let i = 0; i < n; i++) {
      this._puff(position.x + rnd(-0.3, 0.3), position.y + rnd(0, 0.3), position.z + rnd(-0.3, 0.3), rnd(-0.4, 0.4), opts.rise ?? 0.8, rnd(-0.4, 0.4),
        (opts.life || 2.5) * rnd(0.8, 1.2), (opts.size || 1) * 0.3, (opts.size || 1) * rnd(1.2, 1.8), col, opts.alpha ?? 0.5, 1.2, 0.3);
    }
  }

  /* ================================================================ Zielfernrohr-Glanz */

  _updateGlints() {
    const G = this.G;
    const p = G.player;
    this.glints.clear();
    if (!p || !p.alive || !G.combat) return;
    const eye = p.getEyePosition(_t1);
    for (const a of G.actors) {
      if (!a || a === p || !a.alive || !a.weapon || !G.combat.isHostile(a, p)) continue;
      const w = a.weapon;
      const def = w.currentDef;
      if (!def || !def.scope || def.scope.overlay !== 'sniper' || !(w.adsProgress > 0.35)) continue;
      a.getEyePosition(_t2);
      _dir.subVectors(eye, _t2);
      const dist = _dir.length();
      if (dist < 8 || dist > 200) continue;
      _dir.divideScalar(dist);
      a.getAimDirection(_w);
      const dot = _w.dot(_dir);
      if (dot < 0.975) continue; // ≈ 12,8°
      // Sicht (gedrosselt)
      const now = this._time;
      let c = this._glintLos.get(a);
      if (!c || now - c.t > 0.25) {
        const vis = !G.world || !G.world.lineOfSight || G.world.lineOfSight(eye, _t2);
        if (!c) { c = { t: now, v: vis }; this._glintLos.set(a, c); } else { c.t = now; c.v = vis; }
      }
      if (!c.v) continue;
      const k = clamp((dot - 0.975) / 0.022, 0, 1) * clamp((w.adsProgress - 0.35) / 0.5, 0, 1);
      const pulse = 0.75 + 0.25 * Math.sin(now * 9 + (typeof a.id === 'number' ? a.id : String(a.id).length));
      const size = (0.2 + dist * 0.032) * (0.65 + 0.35 * k);
      const x = _t2.x + _w.x * 0.32, y = _t2.y + _w.y * 0.32 + 0.03, z = _t2.z + _w.z * 0.32;
      const I = 6 * k * pulse;
      const L = this.glints;
      L.spawn(x, y, z, 0, 0, 0, 1, size * 1.3, size * 1.3, C.glint[0] * I, C.glint[1] * I, C.glint[2] * I, 1, CELL.STAR);
      L.spawn(x, y, z, 0, 0, 0, 1, size * 0.5, size * 0.5, 3 * I, 3 * I, 3 * I, 1, CELL.SOFT);
      L.spawn(x, y, z, 0, 0, 0, 1, size * 1.9, size * 1.9, 0.5 * I, 0.6 * I, 0.75 * I, 0.6, CELL.SOFT);
      // waagerechter Lichtstreif (anamorph)
      _v.crossVectors(_dir, UP);
      if (_v.lengthSq() > 1e-6) {
        _v.normalize();
        const len = size * 2.2;
        const j = L.spawn(x + _v.x * len * 0.5, y, z + _v.z * len * 0.5, _v.x, 0, _v.z, 1, size * 0.16, size * 0.16, 0.7 * I, 0.8 * I, I, 0.8, CELL.SOFT);
        L.stretch[j] = len;
      }
    }
    if (this._glintLos.size > 48) this._glintLos.clear();
  }

  /* ================================================================ Schwebestaub (R6) */

  /**
   * Feiner Staub, der nur im direkten Sonnenlicht glitzert (Lichtkegel durch Fenster, Hallentore): Körner entstehen
   * zufällig vor der Kamera; je Korn prüft EIN Strahl (world.lineOfSight) zur Sonne – liegt es im Schatten, wird es
   * verworfen. Helligkeit je Bild aus der Vorwärtsstreuung (Blick gegen die Sonne leuchtet stärker). medium 36,
   * high 70, ultra 110 Körner; low keine (eine Schicht = ein Draw Call, Simulation ≈ 0,05 ms).
   */
  _updateMotes(dt) {
    const M = this.motes;
    const id = this.preset.id;
    const want = id === 'ultra' ? 110 : id === 'high' ? 70 : id === 'medium' ? 36 : 0;
    const w = this.G.world;
    const L = w && w.lighting;
    if (!want || !L || !L.sunDirection || typeof w.lineOfSight !== 'function') { if (M.n) M.clear(); return; }
    const sd = _t2.copy(L.sunDirection).normalize();
    if (sd.y < 0) sd.negate();
    const c = this._camPos, f = this._camFwd;
    const sunI = clamp((L.sunIntensity ?? 2.5) / 2.5, 0.2, 2);
    const fwdScatter = Math.max(0, f.x * sd.x + f.y * sd.y + f.z * sd.z);
    const glow = (0.35 + 2.4 * Math.pow(fwdScatter, 6)) * sunI;
    // neue Körner (gedrosselt: höchstens 4 Strahlen je Bild)
    let tries = 4;
    _v.crossVectors(f, UP);
    if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0); else _v.normalize();
    while (M.n < want && tries-- > 0) {
      const dist = rnd(0.5, 6);
      const x = c.x + f.x * dist + _v.x * rnd(-2.6, 2.6), y = c.y + f.y * dist + rnd(-1.3, 1.6), z = c.z + f.z * dist + _v.z * rnd(-2.6, 2.6);
      _t1.set(x, y, z);
      _w.set(x + sd.x * 80, y + sd.y * 80, z + sd.z * 80);
      if (!w.lineOfSight(_t1, _w)) continue;
      const i = M.spawn(x, y, z, rnd(-0.03, 0.03), rnd(-0.015, 0.025), rnd(-0.03, 0.03), rnd(3, 6.5), rnd(0.005, 0.011), rnd(0.005, 0.011), 1, 1, 1, 1, CELL.SOFT);
      M.fadeIn[i] = 0.25;
      M.fadePow[i] = 0.5;
      M.drag[i] = 0.2;
      M.rot[i] = Math.random() * 6.283; // Funkelphase
    }
    // Helligkeit je Bild (Blickrichtung zur Sonne), leichtes Funkeln, Sonnenfarbe
    const sc = L.sunColor || { r: 1, g: 0.95, b: 0.85 };
    const t = this._time;
    for (let i = 0; i < M.n; i++) {
      const dx = M.px[i] - c.x, dy = M.py[i] - c.y, dz = M.pz[i] - c.z;
      // aus dem Blickfeld/zu weit gewandert → bald ersetzen
      if (dx * f.x + dy * f.y + dz * f.z < 0.2 || dx * dx + dy * dy + dz * dz > 64) M.life[i] = Math.min(M.life[i], 0.2);
      const tw = 0.6 + 0.4 * Math.sin(t * 3.1 + M.rot[i] * 7);
      const I = glow * tw * 1.6;
      M.r[i] = sc.r * I; M.g[i] = sc.g * I; M.b[i] = sc.b * I;
    }
  }

  /* ================================================================ Takt */

  update(dt) {
    if (!this._built || !this._subs) return;
    this._time += dt;
    this._syncCamera();
    this._flushDecals();
    this.alpha.update(dt);
    this.fire.update(dt);
    this.add.update(dt);
    this._updateGlints();
    this.glints.update(0);
    // Leuchtspur-Mindestbreite: ~1,3 px in Kameradistanz
    const cam = this.G.camera;
    // Größe aus dem Renderer-Cache (ResizeObserver) – clientHeight je Bild erzwänge ein Layout nach den HUD-Schreibzugriffen
    const h = (this.G.renderer && this.G.renderer.height > 1 && this.G.renderer.height) || window.innerHeight || 720;
    const px = cam ? (2 * Math.tan((cam.fov * Math.PI) / 360)) / h * 1.3 : 0.002;
    this.tracers.update(dt, px);
    this.decals.update(dt, this._time);
    if (this._delayed.length) {
      for (let i = this._delayed.length - 1; i >= 0; i--) {
        const d = this._delayed[i];
        if (d.at > this._time) continue;
        this._delayed.splice(i, 1);
        this.debris.casing(d.type, d.pos, d.vel, null, { actor: d.actor });
      }
    }
    this.debris.update(dt, this.G.world);
    this._updateMotes(dt);
    this.motes.update(dt);
    if (this._light && this._lightLife > 0) {
      this._lightLife -= dt;
      const k = Math.max(0, this._lightLife / this._lightDur);
      this._light.intensity = this._lightPeak * k * k;
      if (this._lightLife <= 0) this._lightPrio = 0;
    } else if (this._light) { this._light.intensity = 0; this._lightPrio = 0; }
  }

  dispose() {
    this.detach();
    if (!this._built) return;
    this.alpha.dispose();
    this.fire.dispose();
    this.add.dispose();
    this.glints.dispose();
    this.tracers.dispose();
    this.decals.dispose();
    this.debris.dispose();
    this.motes.dispose();
    if (this._light) { this._light.dispose(); this._light = null; }
    this._built = false;
  }
}
