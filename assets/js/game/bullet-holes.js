// NULLPUNKT — Einschusslöcher mit Tiefe (22.10., ersetzt wallholes.js). Jeder Treffer auf feste Kartengeometrie
// hinterlässt ein Loch nach Kaliber (shared/calibers.js) und Oberfläche; Treffer an derselben Stelle graben tiefer und
// machen es breiter, bis die Restdicke durchschlagen ist (dann Austrittsloch auf der Rückseite, combat.js lässt die
// Kugel mit dem Energierest weiterfliegen). Darstellung: ein Quad je Loch mit „Blick ins Loch“ (Innenraum-Abbildung
// eines Zylinders im Shader: Lochwand dunkelt mit der Tiefe ab, Grund dunkel bzw. beim Durchschuss das Licht von
// hinten) und einem Rand je Werkstoff – Holz splittert (Fasern, Spreißel), Beton/Ziegel platzt kraterförmig ab
// (frischer, hellerer Bruch), Putz mit weißem Staubring, Blech glatt mit blankem Ring, Glas mit Sprüngen, Erde weich.
// Jedes Gerät rechnet seine Löcher selbst aus den eigenen und gemeldeten Schüssen (Optik + Durchschuss).
import * as THREE from 'three';
import { caliberOf, penetrationDepth } from '../shared/calibers.js';
import { hdrTarget } from './engine/post/common.js';

const MAX = 700;
// Durchblick: kleine Ansichten aus Durchschüssen (Atlas 4 × 4 Felder), was hinter der Wand liegt – mit Gegnern
const VIEW_GRID = 4, VIEW_FOV = 104, VIEW_RANGE = 14;
const BACK_PROBE = 1.6; // höchste messbare Wanddicke (m); dicker = „massiv“
// Darstellungsart je Oberfläche: 0 Holz, 1 Beton, 2 Putz, 3 Metall, 4 Glas, 5 Erde, 6 Stoff, 7 Ziegel
const STYLE = { wood: 0, concrete: 1, tile: 7, plaster: 2, metal: 3, vehicle: 3, glass: 4, dirt: 5, grass: 5, sand: 5, fabric: 6, brick: 7 };
// Lochradius-Faktor (× Kaliberradius), Kraterradius (× Lochradius, + Anteil der Energie), Breitenzuwachs je Treffer
// dc: Kratertiefe (× Kraterradius) – Abplatztrichter vor dem eigentlichen Lochkanal
const SHAPE = [
  { hole: 1.15, crater: 2.6, craterE: 0.006, grow: 0.55, dig: 0.55, dc: 0.12 }, // Holz: Fasern reißen, wächst schnell
  { hole: 1.0,  crater: 3.0, craterE: 0.012, grow: 0.35, dig: 0.5,  dc: 0.36 }, // Beton: Abplatzkrater
  { hole: 1.2,  crater: 3.4, craterE: 0.012, grow: 0.5,  dig: 0.6,  dc: 0.3 },  // Putz
  { hole: 1.0,  crater: 1.9, craterE: 0.003, grow: 0.15, dig: 0.4,  dc: 0.07 }, // Metall: sauberes Loch, Delle, Glanzring
  { hole: 1.1,  crater: 9.0, craterE: 0.02,  grow: 0.3,  dig: 1,    dc: 0 },    // Glas: Sprünge weit hinaus
  { hole: 1.6,  crater: 2.6, craterE: 0.01,  grow: 0.45, dig: 0.55, dc: 0.7 },  // Erde/Sand: Trichter
  { hole: 1.3,  crater: 1.8, craterE: 0.002, grow: 0.4,  dig: 1,    dc: 0 },    // Stoff
  { hole: 1.0,  crater: 3.0, craterE: 0.012, grow: 0.4,  dig: 0.5,  dc: 0.38 }, // Ziegel
];
// Wandfarbe (linear), wenn das Kugel-Dreieck keine kennt (Gelände, Requisiten)
const ALBEDO = [[0.25, 0.17, 0.1], [0.3, 0.3, 0.28], [0.6, 0.58, 0.55], [0.3, 0.3, 0.3], [0.6, 0.62, 0.64], [0.12, 0.1, 0.08], [0.2, 0.2, 0.19], [0.3, 0.12, 0.07]];

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _tx = new THREE.Vector3(), _ty = new THREE.Vector3();
// Dicke einzelner Platten ohne Rückseite (Glasscheiben, Blechtafeln, Karosserie, Stoff, dünne Bretter) in m
const SHEET = { glass: 0.006, metal: 0.003, vehicle: 0.0015, fabric: 0.003, wood: 0.025, plaster: 0.015, tile: 0.012 };
// Querschläger unterhalb dieses Einfallskosinus (Stil → cos): Beton/Ziegel ~76°, Metall ~71° von der Normalen
const RICOCHET = { 1: 0.24, 7: 0.24, 3: 0.32 };

export class BulletHoles {
  constructor(G) {
    this.G = G;
    this.holes = [];   // { pos, n, dir, surface, style, r, rc, depth, thick, through, hits, slot, exit, seed, behind }
    this._free = [];
    this.stats = { holes: 0, through: 0 };
    const geo = new THREE.PlaneGeometry(2, 2, 8, 8); // unterteilt: folgt gekrümmten Flächen (Stämme, Rohre)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, name: 'einschussloch' });
    mat.userData.surface = 'concrete';
    // Schritte der Kratersuche: Handy/niedrig 6, sonst 12
    const q = G.renderer?.quality || 'high';
    mat.defines = { NP_STEPS: q === 'low' ? 6 : 12 };
    // Durchblick-Atlas (ab mittlerer Stufe): Lochgrund zeigt die Welt hinter der Wand
    const rr = G.renderer?.renderer || null;
    this._viewOn = !!(rr && q !== 'low');
    this._viewRefresh = q === 'medium' ? 4 : q === 'high' ? 0.6 : 0.35; // s bis zur Auffrischung (bewegte Gegner)
    this.view = null;
    if (this._viewOn) {
      this._vres = q === 'ultra' ? 224 : q === 'high' ? 176 : 128; // Feldgröße (px)
      try { this.view = hdrTarget(rr, VIEW_GRID * this._vres, VIEW_GRID * this._vres, { depth: true }); this.view.texture.name = 'np:durchblick'; this.view.scissorTest = true; } catch { this._viewOn = false; }
    }
    if (!this.view) { this._blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this._blank.needsUpdate = true; }
    this._uView = { value: this.view ? this.view.texture : this._blank };
    this._uTan = { value: Math.tan((VIEW_FOV * Math.PI) / 360) };
    this._slots = new Array(VIEW_GRID * VIEW_GRID).fill(null);
    this._viewCam = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.03, 600);
    this._viewT = 0;
    this._time = 0;
    mat.onBeforeCompile = (sh) => { sh.uniforms.npView = this._uView; sh.uniforms.npViewTan = this._uTan; holeShader(sh); };
    mat.customProgramCacheKey = () => 'np-holes-3';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.name = 'einschussloecher';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.aHole = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.aHole2 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.aHole3 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.aHole4 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); // Ränder der Fläche (+x, −x, +y, −y)
    this.aHole5 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2); // Krümmung (x, y)
    this.aHole6 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); // Kanal-Schräge (x, y), Formvariante, Querschläger
    for (const a of [this.aHole, this.aHole2, this.aHole3, this.aHole4, this.aHole5, this.aHole6]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHole', this.aHole);
    geo.setAttribute('aHole2', this.aHole2);
    geo.setAttribute('aHole3', this.aHole3);
    geo.setAttribute('aHole4', this.aHole4);
    geo.setAttribute('aHole5', this.aHole5);
    geo.setAttribute('aHole6', this.aHole6);
    if (G.scene) G.scene.add(this.mesh);
  }

  /**
   * Wanddicke an einem Treffer entlang der Schussrichtung → m oder Infinity (massiv/Gelände). Vorwärts bis zur
   * nächsten Fläche: zeigt deren Normale vom Schützen weg, ist es die Rückseite desselben Körpers (Dicke = Abstand);
   * zeigt sie zum Schützen oder kommt nichts, war die getroffene Fläche eine einzelne Platte → Dicke nach Werkstoff.
   */
  _thickness(point, dir, surface, entry = null) {
    const W = this.G.world;
    const sheet = SHEET[surface];
    if (!W || typeof W.raycast !== 'function') return sheet ?? Infinity;
    _v.copy(point).addScaledVector(dir, 0.003);
    const f = W.raycast(_v, dir, BACK_PROBE);
    // world.raycast dreht die Normale zum Schützen; f.back sagt, ob die Fläche vom Strahl weg zeigt. Rückseite desselben
    // Körpers = entgegengesetzte Ausrichtung zur Eintrittsfläche (auch bei Modellen mit umgekehrter Windung) und dasselbe Objekt
    const entryBack = !!(entry && entry.back);
    const sameObj = !entry || !entry.object || !f || !f.object || f.object === entry.object;
    this._backN = null;
    if (f && f.back !== undefined && f.back !== entryBack && sameObj) {
      this._backN = f.normal.clone().negate(); // nach außen (vom Schützen weg)
      return Math.max(0.003, f.distance + 0.003);
    }
    return sheet ?? Infinity;
  }

  /** Achsen des Lochs in der Fläche: x waagrecht (Holzmaserung), y = n × x. */
  _frame(n, tx, ty) {
    if (Math.abs(n.y) > 0.9) tx.set(1, 0, 0).addScaledVector(n, -n.x).normalize();
    else tx.crossVectors(_up, n).normalize();
    ty.crossVectors(n, tx);
  }

  /**
   * Fläche um das Loch abtasten (je Achsrichtung drei Strahlen gegen die Normale): Krümmung (Baumstamm, Rohr: Fläche
   * fällt nach außen quadratisch ab) und Kanten (Fläche endet / springt) → h.kx, h.ky (1/m), h.clip [+x, −x, +y, −y] (m).
   */
  _probe(h) {
    const W = this.G.world;
    h.kx = h.ky = 0; h.clip = [1, 1, 1, 1]; h.probed = Math.max(0.03, Math.min(0.25, h.rc * this._elong(h) * 1.3));
    if (!W || typeof W.raycast !== 'function') return;
    const n = h.n, tx = new THREE.Vector3(), ty = new THREE.Vector3();
    this._frame(n, tx, ty);
    const d = h.probed, back = n.clone().negate(), o = new THREE.Vector3();
    const ks = [[], []];
    [[tx, 1, 0], [tx, -1, 1], [ty, 1, 2], [ty, -1, 3]].forEach(([ax, sg, ci]) => {
      for (let i = 1; i <= 3; i++) {
        const x = (d * i) / 3;
        o.copy(h.pos).addScaledVector(ax, x * sg).addScaledVector(n, 0.25);
        const f = W.raycast(o, back, 0.31);
        const dev = f ? f.distance - 0.25 : Infinity;
        if (!f || dev > 0.035 || dev < -0.006 || f.normal.dot(n) < 0.5) { h.clip[ci] = Math.max(0.004, x - d / 3); break; }
        if (i === 3 && dev > 0.0015) ks[ci >> 1].push((2 * dev) / (x * x));
      }
    });
    // nur symmetrisch gekrümmte Achsen biegen (Stamm), einseitige Abweichung ist eine Kante
    if (ks[0].length === 2) h.kx = Math.min(20, (ks[0][0] + ks[0][1]) / 2);
    if (ks[1].length === 2) h.ky = Math.min(20, (ks[1][0] + ks[1][1]) / 2);
  }

  /**
   * Schräglage des Lochkanals: into = Richtung in den Werkstoff (Eintritt: Schussrichtung, Austritt: entgegen).
   * → h.slope [sx, sy] = seitlicher Versatz des Kanals je Meter Tiefe in den Lochachsen, h.cos = Einfallskosinus.
   */
  _slope(h, into, minCos = 0.3) {
    this._frame(h.n, _tx, _ty);
    const c = Math.max(minCos, -into.dot(h.n));
    h.cos = Math.max(0.05, -into.dot(h.n));
    h.slope = [into.dot(_tx) / c, into.dot(_ty) / c];
  }

  /** Streckung des Kraters entlang der Schussrichtung (1 = senkrecht getroffen). */
  _elong(h) {
    const s = h.slope || [0, 0];
    return Math.min(4.2, Math.sqrt(1 + s[0] * s[0] + s[1] * s[1]));
  }

  /** Loch an p (gleiche Fläche) oder null. */
  _near(p, n, surface) {
    let best = null, bd = Infinity;
    for (const h of this.holes) {
      if (h.exit || h.surface !== surface) continue;
      const d2 = h.pos.distanceToSquared(p);
      const lim = Math.max(h.r * 1.6, 0.03);
      if (d2 < lim * lim && d2 < bd && h.n.dot(n) > 0.7) { best = h; bd = d2; }
    }
    return best;
  }

  /**
   * Treffer auf feste Geometrie. hit: { point, normal, surface, solid? }, def: Waffe, dir: Schussrichtung,
   * distance: Flugweg bis hier, energy: Energierest (0..1, nach vorigen Durchschüssen).
   * → { passed, energyLeft, thick, exitPoint } (passed: Kugel geht durch) oder null (Oberfläche ohne Loch).
   */
  hit(hit, def, dir, distance = 0, energy = 1) {
    if (!hit || !hit.point || !def || !def.damage) return null;
    const surface = hit.surface || 'concrete';
    const style = STYLE[surface];
    if (style === undefined) return null;
    const n = _v.copy(hit.normal || dir).normalize().clone();
    if (n.dot(dir) > 0) n.negate();
    // Einfallswinkel: schräg getroffen verliert die Kugel Eindringtiefe (sie kippt, lenkt ab); die Wanddicke entlang der
    // Flugbahn wächst ohnehin (Messung entlang dir)
    const cosI = Math.min(1, Math.max(0, -dir.dot(n)));
    const pen = penetrationDepth(def, surface, distance) * energy * (0.55 + 0.45 * cosI);
    if (pen <= 0) return null;
    let thick = this._thickness(hit.point, dir, surface, hit);
    const backN = this._backN;
    const cal = caliberOf(def), S = SHAPE[style];
    // Querschläger: sehr flacher Treffer auf Stein/Metall – die Kugel prallt ab und hinterlässt eine lange Schleifspur
    const rico = RICOCHET[style];
    if (rico && !hit.solid && hit.targetId == null && cosI < rico * (def.antiMateriel ? 0.45 : 1) * (cal.d > 10 ? 0.8 : 1) && !this._near(hit.point, n, surface)) {
      const alb = (hit.tri != null && this.G.world?.albedoAt?.(hit.tri, [0, 0, 0])) || ALBEDO[style];
      const g = this._make(hit.point, n, dir, surface, style, thick, false, alb);
      if (g) {
        this._slope(g, dir, 0.22);
        const rCal = (cal.d / 2000) * S.hole * 0.7;
        g.r = rCal; g.rc = rCal * S.crater * 0.8 + S.craterE * 0.5 * Math.sqrt(cal.E / 1000);
        g.depth = Math.min(0.008, pen * 0.08); g.ricochet = true;
        this._probe(g);
        this._write(g);
      }
      return { passed: false, energyLeft: 0, thick, ricochet: true };
    }
    // bewegliche Festkörper (Türen): kein Loch (es würde nicht mitwandern), aber Durchschlag nach Dicke
    if (hit.solid || hit.targetId != null) {
      const passed = thick !== Infinity && pen >= thick;
      return { passed, energyLeft: passed ? Math.max(0.15, 1 - thick / pen) : 0, thick, exitPoint: passed ? hit.point.clone().addScaledVector(dir, thick) : null };
    }
    let h = this._near(hit.point, n, surface);
    const alb = h ? null : (hit.tri != null && this.G.world?.albedoAt?.(hit.tri, [0, 0, 0])) || ALBEDO[style];
    // Dicke eines bestehenden Lochs: kleinste Messung gilt (Folgetreffer liegen leicht versetzt)
    if (h) { thick = Math.min(h.thick, thick); h.thick = thick; }
    const before = h ? h.depth : 0;
    const rest = thick - before;
    // durch ein offenes Loch fliegt jede Kugel (nahe der Lochmitte), sonst entscheidet die Restdicke
    const inOpen = !!(h && h.through && h.pos.distanceTo(hit.point) < h.r * 0.85);
    const passed = inOpen || (thick !== Infinity && pen >= rest - 0.002);
    const rCal = (cal.d / 2000) * S.hole;
    if (!h) {
      h = this._make(hit.point, n, dir, surface, style, thick, false, alb);
      if (h) this._slope(h, dir);
      if (!h) return passed ? { passed, energyLeft: Math.max(0.15, 1 - rest / pen), thick, exitPoint: hit.point.clone().addScaledVector(dir, thick) } : { passed: false, energyLeft: 0, thick };
      h.r = rCal;
      h.rc = rCal * S.crater + S.craterE * Math.sqrt(cal.E / 1000) * (1 - cal.frag * 0.3) + cal.frag * 0.006;
      h.depth = Math.min(thick, pen * (0.75 + Math.random() * 0.25));
    } else {
      // weitere Kugel in dasselbe Loch: gräbt weiter (Splitter, Zerlegen → breiter statt tiefer), Loch wird breiter
      h.hits++;
      // je tiefer der Kanal im Verhältnis zur eigenen Eindringtiefe, desto weniger gräbt die nächste Kugel (sie trifft
      // die Kanalwand, verformt sich): 9 mm bohrt sich durch eine Bohle, braucht für einen 50-cm-Stamm aber ~20 Schuss
      const ratio = h.depth / Math.max(pen, 1e-3);
      const gain = 1 / (1 + 0.6 * Math.pow(ratio, 1.5));
      h.depth = Math.min(thick, h.depth + pen * S.dig * (1 - cal.frag * 0.5) * gain);
      h.r = Math.min(0.09, h.r + rCal * S.grow * (1 + cal.frag));
      h.rc = Math.max(h.rc, Math.min(0.32, h.r * S.crater * 0.8 + h.rc * 0.15 + S.craterE * 0.25));
    }
    if (passed) h.depth = thick;
    if (backN && !h.backN) h.backN = backN;
    if (h.probed === undefined || h.rc * this._elong(h) > h.probed * 1.4) this._probe(h);
    const wasThrough = h.through;
    h.through = wasThrough || h.depth >= thick - 0.002;
    if (h.through && !wasThrough) {
      this.stats.through++;
      h.behind = this._behind(h.pos.clone().addScaledVector(dir, thick + 0.02), dir);
      // Austrittsloch: auf der Rückseite, größerer Ausbruch (Holz reißt Spreißel heraus, Beton platzt ab)
      const ep = h.pos.clone().addScaledVector(dir, thick);
      // Austrittsfläche: gemessene Rückseite (Stamm, schräge Wand), sonst parallel zur Eintrittsfläche
      const exN = h.backN || n.clone().negate();
      const ex = this._make(ep, exN, dir.clone().negate(), surface, style, thick, true, h.alb);
      if (ex) {
        this._slope(ex, dir.clone().negate());
        ex.r = h.r * (style === 3 ? 1.15 : 1.5);
        ex.rc = h.rc * (style === 0 || style === 1 || style === 7 ? 1.7 : 1.15);
        ex.depth = thick; ex.through = true; ex.behind = this._behind(h.pos.clone().addScaledVector(dir, -0.02), dir.clone().negate());
        this._probe(ex);
        h.exitHole = ex;
        this._write(ex);
      }
    } else if (h.exitHole) {
      h.exitHole.r = Math.max(h.exitHole.r, h.r * 1.5); h.exitHole.rc = Math.max(h.exitHole.rc, h.rc * 1.4);
      if (h.exitHole.rc * this._elong(h.exitHole) > h.exitHole.probed * 1.4) this._probe(h.exitHole);
      this._write(h.exitHole);
    }
    this._write(h);
    this.stats.holes = this.holes.length;
    const res = { passed, energyLeft: passed ? (inOpen ? 0.92 : Math.max(0.15, 1 - Math.max(0, rest) / pen)) : 0, thick };
    if (passed) res.exitPoint = hit.point.clone().addScaledVector(dir, Math.max(0.004, thick));
    return res;
  }

  /** Lichtfarbe hinter einem Durchschuss: offen (Himmel/Nebel) hell, sonst dunkel. */
  _behind(from, dir) {
    const W = this.G.world;
    const fog = this.G.scene?.fog?.color || this.G.scene?.background;
    // Startpunkt im Erdreich (Grabenverschalung, Brustwehr) → dunkel
    const hf = typeof W?.heightAt === 'function' ? W.heightAt(from.x, from.z) : null;
    if (hf != null && Number.isFinite(hf) && from.y < hf - 0.01) return [0.02, 0.018, 0.016];
    const open = !(W && typeof W.raycast === 'function' && W.raycast(from, dir, 25));
    if (!open) return [0.02, 0.018, 0.016];
    const c = fog && fog.isColor ? fog : new THREE.Color(0.7, 0.72, 0.74);
    return [c.r * 1.1, c.g * 1.1, c.b * 1.1];
  }

  _make(point, n, dir, surface, style, thick, exit = false, alb = ALBEDO[style]) {
    let slot;
    if (this.holes.length >= MAX) {
      // ältestes Nicht-Durchschuss-Loch wiederverwenden
      const i = this.holes.findIndex((h) => !h.through);
      const old = this.holes.splice(i >= 0 ? i : 0, 1)[0];
      slot = old.slot;
      if (old.viewSlot != null) this._slots[old.viewSlot] = null;
    } else slot = this.holes.length;
    const h = { pos: point.clone(), n: n.clone(), dir: dir.clone(), surface, style, r: 0.005, rc: 0.02, depth: 0.005, thick, through: false, hits: 1, slot, exit, seed: Math.random() * 100, behind: [0.02, 0.02, 0.02], exitHole: null, alb: alb.slice(0, 3) };
    this.holes.push(h);
    if (this.mesh.count < this.holes.length) this.mesh.count = this.holes.length;
    return h;
  }

  _write(h) {
    const k = h.slot;
    // Ausrichtung: x waagrecht in der Fläche (Holzmaserung läuft bei Brettern meist waagrecht), sonst zufällig gedreht
    // Ausrichtung fest (keine Zufallsdrehung): Krümmung und Kanten sind entlang x/y gemessen
    const n = h.n;
    this._frame(n, _tx, _ty);
    _m.makeBasis(_tx, _ty, n);
    _q.setFromRotationMatrix(_m);
    // Quad = Krater × Streckung (schräger Treffer: länglich entlang der Schussrichtung); Tiefen senkrecht zur Fläche
    const el = this._elong(h), Q = h.rc * el, cz = Math.max(0.24, h.cos ?? 1);
    _s.setScalar(Q);
    _m.compose(_v.copy(h.pos).addScaledVector(n, 0.0015), _q, _s);
    _m.toArray(this.mesh.instanceMatrix.array, k * 16);
    const a = this.aHole.array, b = this.aHole2.array, c = this.aHole3.array, g = this.aHole6.array;
    const hr = Math.min(0.95, h.r / h.rc);
    const D = ((h.thick === Infinity ? Math.max(h.depth, 0.01) : h.depth) * cz) / Q;
    a[k * 4] = hr; a[k * 4 + 1] = D; a[k * 4 + 2] = h.through ? 1 : 0; a[k * 4 + 3] = h.style + (h.exit ? 10 : 0);
    b[k * 4] = h.seed; b[k * 4 + 1] = h.behind[0]; b[k * 4 + 2] = h.behind[1]; b[k * 4 + 3] = h.behind[2];
    // Kratertiefe: je Werkstoff, Austritt tiefer ausgebrochen, nie tiefer als das Loch selbst
    const S = SHAPE[h.style];
    const dc = S.dc * (h.exit ? 1.6 : 1) * (h.hits > 1 ? 1.15 : 1);
    c[k * 4] = h.alb[0]; c[k * 4 + 1] = h.alb[1]; c[k * 4 + 2] = h.alb[2]; c[k * 4 + 3] = Math.min(dc / el, D * 0.85);
    const e = this.aHole4.array, f = this.aHole5.array, cl = h.clip || [1, 1, 1, 1];
    for (let i = 0; i < 4; i++) e[k * 4 + i] = Math.min(4, cl[i] / Q);
    f[k * 2] = (h.kx || 0) * Q; f[k * 2 + 1] = (h.ky || 0) * Q;
    // Kanal-Versatz je Tiefeneinheit + Formvarianten (Seitenverhältnis, Zacken) aus dem Zufallswert
    const sl = h.slope || [0, 0];
    // w: Querschläger −2, sonst Durchblick-Feld (−1 = keins → Lichtfarbe)
    g[k * 4] = sl[0]; g[k * 4 + 1] = sl[1]; g[k * 4 + 2] = (h.seed * 7.31) % 1; g[k * 4 + 3] = h.ricochet ? -2 : (h.viewSlot ?? -1);
    for (const [attr, w] of [[this.mesh.instanceMatrix, 16], [this.aHole, 4], [this.aHole2, 4], [this.aHole3, 4], [this.aHole4, 4], [this.aHole5, 2], [this.aHole6, 4]]) {
      attr.addUpdateRange(k * w, w);
      attr.needsUpdate = true;
    }
  }

  /**
   * Je Bild: höchstens eine Durchblick-Ansicht rendern (≈ 8/s), für nahe, zur Kamera zeigende Durchschüsse – neue zuerst,
   * dann die am längsten nicht aufgefrischte. Felder gehen an nähere Löcher über.
   */
  update(dt) {
    this._time += dt;
    if (!this._viewOn || !this.view) return;
    this._viewT -= dt;
    if (this._viewT > 0) return;
    const cam = this.G.camera;
    if (!cam) return;
    const cp = cam.position;
    let best = null, bestScore = Infinity;
    for (const h of this.holes) {
      if (!h.through) continue;
      const dx = cp.x - h.pos.x, dy = cp.y - h.pos.y, dz = cp.z - h.pos.z;
      const d = Math.hypot(dx, dy, dz);
      h._camD = d;
      if (d > VIEW_RANGE || dx * h.n.x + dy * h.n.y + dz * h.n.z < 0.02 * d) continue;
      const fresh = h.viewSlot == null ? -100 : this._time - (h.viewAt || 0);
      if (h.viewSlot != null && fresh < this._viewRefresh) continue;
      const score = d + (h.viewSlot == null ? -50 : -fresh * 2);
      if (score < bestScore) { bestScore = score; best = h; }
    }
    if (!best) return;
    let slot = best.viewSlot;
    if (slot == null) {
      slot = this._slots.indexOf(null);
      if (slot < 0) {
        // fernstes (oder nicht mehr sichtbares) Loch gibt sein Feld ab
        let far = -1, fd = best._camD;
        this._slots.forEach((o, i) => { const od = o._camD ?? Infinity; if (od > fd) { fd = od; far = i; } });
        if (far < 0) return;
        const old = this._slots[far];
        old.viewSlot = null; this._write(old);
        slot = far;
      }
      this._slots[slot] = best;
      best.viewSlot = slot;
      this._write(best);
    }
    this._renderView(best, slot);
    best.viewAt = this._time;
    this._viewT = 0.12;
  }

  /** Ansicht aus dem Loch: Kamera knapp hinter der Austrittsseite, Blick gegen die Lochnormale (Achsen = Lochachsen). */
  _renderView(h, slot) {
    const r = this.G.renderer?.renderer, scene = this.G.scene;
    if (!r || !scene) return;
    const cam = this._viewCam;
    this._frame(h.n, _tx, _ty);
    _m.makeBasis(_tx, _ty, h.n);
    cam.quaternion.setFromRotationMatrix(_m);
    const t = h.thick === Infinity ? 0.3 : h.thick;
    cam.position.copy(h.pos).addScaledVector(h.dir, t + 0.04);
    if (this.G.camera) { cam.far = this.G.camera.far; cam.layers.mask = this.G.camera.layers.mask; }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const R = this._vres, x = (slot % VIEW_GRID) * R, y = Math.floor(slot / VIEW_GRID) * R;
    this.view.viewport.set(x, y, R, R);
    this.view.scissor.set(x, y, R, R);
    const prevRT = r.getRenderTarget(), prevClear = r.autoClear, sm = r.shadowMap, prevAU = sm.autoUpdate, prevNU = sm.needsUpdate;
    const vis = this.mesh.visible;
    try {
      this.mesh.visible = false;         // keine Rückkopplung (Löcher lesen den Atlas)
      sm.autoUpdate = false; sm.needsUpdate = false; // Schattenkarten der Hauptkamera weiterverwenden
      r.autoClear = true;
      r.setRenderTarget(this.view);
      r.render(scene, cam);
    } catch (err) {
      this._viewOn = false; console.warn('[NULLPUNKT] Durchblick aus:', err);
    } finally {
      this.mesh.visible = vis;
      sm.autoUpdate = prevAU; sm.needsUpdate = prevNU;
      r.autoClear = prevClear;
      r.setRenderTarget(prevRT);
    }
  }

  /** Durchgehendes Loch an dieser Stelle? → Loch oder null. */
  at(p) {
    for (const h of this.holes) if (h.through && !h.exit && h.pos.distanceToSquared(p) < (h.r + 0.02) ** 2) return h;
    return null;
  }

  dispose() {
    this.holes.length = 0;
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this.view) this.view.dispose();
    if (this._blank) this._blank.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Shader: Strahlverfolgung im Krater (Höhenfeld: Abplatz-Trichter mit gezacktem Rand) und im Lochkanal (Zylinder bis
// zur Tiefe D, beim Durchschuss Licht von hinten), Farbe = frischer Bruch aus der Wandfarbe, Rand je Werkstoff.
// Ortsraum des Quads: Kraterradius 1, +z zeigt aus der Wand.
// ---------------------------------------------------------------------------------------------------------------
function holeShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec4 aHole;
attribute vec4 aHole2;
attribute vec4 aHole3;
attribute vec4 aHole4;
attribute vec2 aHole5;
attribute vec4 aHole6;
varying vec4 vHole6;
varying vec4 vHole;
varying vec4 vHole2;
varying vec4 vHole3;
varying vec4 vClip;
varying vec2 vK;
varying vec3 vPosL;
varying vec3 vCamL;
varying vec3 vTx;
varying vec3 vTy;
varying vec3 vTz;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    // der Fläche folgen: gekrümmt (Stamm) nach hinten biegen
    transformed.z -= 0.5 * ( aHole5.x * transformed.x * transformed.x + aHole5.y * transformed.y * transformed.y );
    vClip = aHole4; vK = aHole5; vHole6 = aHole6;
    mat4 npIM = modelMatrix * instanceMatrix;
    vPosL = transformed;
    vCamL = ( inverse( npIM ) * vec4( cameraPosition, 1.0 ) ).xyz;
    vHole = aHole; vHole2 = aHole2; vHole3 = aHole3;
    mat3 npR = mat3( viewMatrix ) * mat3( npIM );
    vTx = normalize( npR[ 0 ] ); vTy = normalize( npR[ 1 ] ); vTz = normalize( npR[ 2 ] );
  }`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec4 vHole;
varying vec4 vHole2;
varying vec4 vHole3;
varying vec4 vClip;
varying vec2 vK;
varying vec4 vHole6;
varying vec3 vPosL;
varying vec3 vCamL;
varying vec3 vTx;
varying vec3 vTy;
varying vec3 vTz;
vec3 npHoleN = vec3( 0.0, 0.0, 1.0 );
vec3 npHoleEmit = vec3( 0.0 );
uniform sampler2D npView;
uniform float npViewTan;
// Durchblick: Welt hinter der Wand aus dem Atlas (Feld = vHole6.w), sonst gespeicherte Lichtfarbe
vec3 npThrough( vec3 dirL ) {
  float slot = vHole6.w;
  if ( slot < -0.5 ) return vHole2.yzw;
  vec2 ndc = clamp( dirL.xy / max( -dirL.z, 0.05 ) / npViewTan, -0.96, 0.96 );
  vec2 cell = vec2( mod( slot, 4.0 ), floor( slot / 4.0 ) );
  return texture2D( npView, ( cell + ndc * 0.5 + 0.5 ) / 4.0 ).rgb;
}
float npAO = 1.0;  // Umgebungslicht, das in Krater/Kanal hineinreicht
float npSun = 1.0; // Sonne: fällt sie (Einfallswinkel) bis an diese Stelle im Loch?
float npR, npDc, npSeed, npVar, npE; int npSt; bool npExit;
vec2 npS, npA; // Kanal-Versatz je Tiefe (Schräge) und Streckachse
// Kraterraum: schräger Treffer → Krater/Loch entlang der Schussrichtung gestreckt; dort Einheitskreis = Kraterrand
vec2 npC( vec2 p ) { return vec2( dot( p, npA ), dot( p, vec2( -npA.y, npA.x ) ) * npE * ( 0.9 + 0.2 * npVar ) ); }
float npH2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float npN2( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( npH2( i ), npH2( i + vec2( 1.0, 0.0 ) ), f.x ), mix( npH2( i + vec2( 0.0, 1.0 ) ), npH2( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// Zellen (Abplatzer, Splitterkörner): x Abstand zur Mitte, y Zufall, z Abstand zur Nachbarkante (F2 − F1)
vec3 npCell( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 r = g + vec2( npH2( i + g ), npH2( i + g + 17.3 ) ) - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; id = npH2( i + g + 3.7 ); } else if ( d < d2 ) d2 = d;
  }
  return vec3( sqrt( d1 ), id, sqrt( d2 ) - sqrt( d1 ) );
}
// Lochrand (gezackt; Holz entlang der Faser x gestreckt, Metall rund) in Richtung u
float npHoleR( vec2 u ) {
  float jag = ( npSt == 3 ? 0.06 : npSt == 0 ? 0.4 : npSt == 5 ? 0.15 : 0.28 ) * ( 0.7 + 0.6 * npVar );
  vec2 q = npSt == 0 ? vec2( u.x * 0.6, u.y * 2.6 ) : u * 2.2;
  return npR * ( 1.0 + jag * ( npN2( q + npSeed ) - 0.5 ) * 2.0 + jag * 0.7 * ( npN2( u * 7.0 + npSeed * 1.7 ) - 0.5 ) );
}
// Außenkante des Abplatzkraters (0..1 des Quads)
float npEdge( vec2 u ) {
  float e = 0.5 + 0.34 * npN2( u * 1.7 + npSeed * 2.3 ) + 0.14 * npN2( u * 5.0 + npSeed * 0.7 );
  if ( npSt == 0 ) e = npExit ? e : mix( npR * 1.6, e, 0.35 );
  if ( npSt == 3 ) e = min( 0.95, npR * 2.4 + 0.12 * npN2( u * 3.0 + npSeed ) );
  return e;
}
// Tiefe unter der Oberfläche (Quad-Einheiten); im Lochkanal 1e3
float npDepth( vec2 p ) {
  vec2 cp = npC( p );
  float rho = length( cp ); vec2 u = cp / max( rho, 1e-4 );
  if ( rho < npHoleR( u ) ) return 1e3;
  if ( npDc <= 0.0 ) return 0.0;
  float hr = npHoleR( u ), e = npEdge( u );
  if ( rho >= e ) return 0.0;
  float x = clamp( ( rho - hr ) / max( e - hr, 1e-3 ), 0.0, 1.0 );
  float prof = npSt == 5 ? 1.0 - smoothstep( 0.0, 1.0, x ) : npSt == 3 ? ( 1.0 - x ) * ( 1.0 - x ) : pow( 1.0 - x, 0.65 );
  // schräg: in Schussrichtung tiefer ausgebrochen, auf der Anflugseite flacher
  prof *= 1.0 + 0.45 * ( 1.0 - 1.0 / npE ) * clamp( cp.x, -1.0, 1.0 );
  // Stufen im Bruch (Schalen, die abgeplatzt sind)
  float terr = npSt == 5 ? 0.9 + 0.2 * npN2( p * 6.0 + npSeed ) : 0.78 + 0.44 * npN2( p * 7.0 + npSeed * 3.1 );
  return npDc * prof * terr;
}
// Farben relativ zur Wandfarbe (Karten sind unterschiedlich hell abgestimmt; die Belichtung gleicht das aus)
float npL;
vec3 npFreshCol( vec3 alb ) {
  float L = max( dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.004 ); npL = L;
  if ( npSt == 0 ) return vec3( 1.0, 0.7, 0.42 ) * clamp( L * 2.4, 0.05, 0.32 ); // Holz: frische helle Fasern (auch unter Kohle)
  if ( npSt == 1 ) return mix( alb, vec3( L ), 0.3 ) * 1.9;                      // Beton: heller Bruch
  if ( npSt == 2 ) return min( mix( alb, vec3( L ), 0.6 ) * 1.3, vec3( 0.85 ) ); // Putz/Gips: weiß
  if ( npSt == 3 ) return vec3( clamp( L * 2.5, 0.08, 0.55 ) );                  // Blech: blank
  if ( npSt == 4 ) return vec3( 0.8, 0.85, 0.88 );                               // Glas: zerstoßen
  if ( npSt == 5 ) return alb * 0.6;                                             // Erde: feucht, dunkler
  if ( npSt == 6 ) return alb * 0.5;                                             // Stoff
  return alb * vec3( 2.2, 1.85, 1.6 );                                           // Ziegel: frisch, orangerot
}`)
    .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
vec3 npSunL() {
#if NUM_DIR_LIGHTS > 0
  vec3 Lv = directionalLights[ 0 ].direction;
  return normalize( vec3( dot( Lv, vTx ), dot( Lv, vTy ), dot( Lv, vTz ) ) );
#else
  return vec3( 0.0, 0.0, 1.0 );
#endif
}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec2 p0 = vPosL.xy;
    float rho0 = length( p0 );
    npR = vHole.x; npSeed = vHole2.x; npDc = vHole3.w;
    npS = vHole6.xy; npVar = vHole6.z; npE = min( sqrt( 1.0 + dot( npS, npS ) ), 4.2 );
    npA = dot( npS, npS ) > 1e-6 ? normalize( npS ) : vec2( 1.0, 0.0 );
    // Kantenglättung: Breite eines Bildpunkts im Kraterraum (vor jedem discard, gleichförmiger Ablauf)
    vec2 cpS = npC( p0 );
    float crhoS = length( cpS );
    float npFw = max( fwidth( crhoS ), 1e-4 );
    if ( rho0 > 1.0 ) discard;
    // Kanten der Fläche und Flanken gekrümmter Flächen abschneiden (kein Überstehen)
    if ( p0.x > vClip.x || -p0.x > vClip.y || p0.y > vClip.z || -p0.y > vClip.w ) discard;
    if ( vK.x * abs( p0.x ) > 0.92 || vK.y * abs( p0.y ) > 0.92 ) discard;
    float D = max( vHole.y, 0.02 ), thr = vHole.z;
    float stf = vHole.w; npExit = stf > 9.5; npSt = int( mod( stf, 10.0 ) + 0.5 );
    vec3 fresh = npFreshCol( vHole3.rgb );
    vec3 col = fresh; float a = 0.0;
    float d0 = npDepth( p0 );
    if ( d0 > 0.0 ) {
      // --- in den Krater/Kanal hinein: Strahl in Tiefenschritten bis zum Kratergrund
      vec3 dir = normalize( vPosL - vCamL );
      float dz = max( -dir.z, 0.12 );
      vec2 dxy = dir.xy / dz;
      vec2 q = p0; float rd = 0.0; bool hitC = false;
      if ( npDc > 0.0 ) {
        float stepD = npDc / float( NP_STEPS ), prevF = d0 - 0.0, prevRd = 0.0;
        for ( int i = 1; i <= NP_STEPS; i++ ) {
          float r = stepD * float( i );
          vec2 qq = p0 + dxy * r;
          float sd = npDepth( qq );
          float f = sd - r;
          if ( f <= 0.0 ) { float k = prevF / max( prevF - f, 1e-4 ); rd = mix( prevRd, r, k ); q = p0 + dxy * rd; hitC = true; break; }
          prevF = min( f, 4.0 ); prevRd = r; q = qq; rd = r;
        }
      }
      if ( hitC ) {
        // Kraterwand: Neigung aus dem Höhenfeld, Abplatzer als Facetten, tiefer = dunkler
        float e = 0.012;
        float dc1 = npDc * 1.15;
        float gx = min( npDepth( q + vec2( e, 0.0 ) ), dc1 ) - min( npDepth( q - vec2( e, 0.0 ) ), dc1 );
        float gy = min( npDepth( q + vec2( 0.0, e ) ), dc1 ) - min( npDepth( q - vec2( 0.0, e ) ), dc1 );
        vec3 c = npCell( npC( q ) * ( npSt == 0 ? 5.0 : 11.0 ) + npSeed );
        vec2 facet = ( vec2( npH2( vec2( c.y, 1.3 ) ), npH2( vec2( c.y, 7.1 ) ) ) - 0.5 ) * ( npSt == 5 ? 0.2 : 0.32 )
          + ( vec2( npN2( q * 31.0 + npSeed ), npN2( q * 29.0 - npSeed ) ) - 0.5 ) * 0.35; // feine Körnung bricht das Zellmuster
        npHoleN = vec3( vec2( gx, gy ) / ( 2.0 * e ) * 0.8 + facet, 1.0 );
        float cav = mix( 1.0, 0.55, clamp( rd / max( npDc, 1e-3 ), 0.0, 1.0 ) );
        float grain = npSt == 0 ? 0.75 + 0.5 * npN2( vec2( q.x * 3.0, q.y * 40.0 ) + npSeed ) : 0.86 + 0.28 * c.y * ( 0.6 + 0.4 * npN2( q * 23.0 + npSeed ) );
        float crack = npSt == 5 || npSt == 3 ? 1.0 : mix( 0.8, 1.0, smoothstep( 0.0, 0.05, c.z ) * ( 0.6 + 0.4 * npN2( q * 13.0 + npSeed ) ) + 0.3 * step( 0.5, npN2( npC( q ) * 4.0 + npSeed * 2.0 ) ) );
        col = fresh * mix( 1.0, 0.75, 1.0 - cav ) * grain * crack;
        npAO = cav;
        // Sonne im Krater: Weg zur Oberfläche in Sonnenrichtung frei?
        vec3 Ll = npSunL();
        if ( Ll.z <= 0.03 ) npSun = 0.0;
        else {
          vec2 sl = Ll.xy / Ll.z;
          for ( int k = 1; k <= 4; k++ ) {
            float up = rd * float( k ) / 4.0;
            float dd = npDepth( q + sl * up );
            if ( dd < 1e2 && dd < rd - up - 0.01 ) { npSun = 0.0; break; }
          }
        }
        a = 1.0;
      } else {
        // Lochkanal: Zylinder (Lochradius) ab Kratertiefe bis D – Wand dunkelt mit der Tiefe, Grund: Kugel oder Licht
        // schräger Kanal: Mitte wandert mit der Tiefe um npS; im Kraterraum ist der Querschnitt ein Kreis (npR)
        float z0 = npDc > 0.0 ? rd : 0.0;
        vec2 cA = npC( dxy - npS ), cB = npC( q - npS * z0 );
        float A = dot( cA, cA ), B = 2.0 * dot( cB, cA ), C = dot( cB, cB ) - npR * npR;
        float s = A > 1e-6 ? ( -B + sqrt( max( B * B - 4.0 * A * C, 0.0 ) ) ) / ( 2.0 * A ) : 1e6;
        float wd = z0 + max( s, 0.0 );
        if ( wd >= D ) {
          vec2 qb = q + dxy * max( D - z0, 0.0 );
          vec2 qbc = qb - npS * D; // Grund relativ zur Kanalmitte
          if ( thr > 0.5 ) { col = vec3( 0.0 ); npHoleEmit = npThrough( dir ); npAO = 0.0; npSun = 0.0; }
          else {
            // Grund: die steckende Kugel (Kupfer/Blei, verformt) in einem dunklen Trichter
            float slug = 1.0 - smoothstep( npR * 0.35, npR * 0.62, length( npC( qbc ) ) + 0.1 * npR * npN2( qb * 30.0 + npSeed ) );
            float att = exp( -D * 0.9 );
            col = mix( fresh * 0.3, vec3( 1.0, 0.6, 0.36 ) * clamp( npL * 2.2, 0.02, 0.3 ), slug * 0.85 );
            npAO = mix( 0.06, 0.45, att );
            vec3 Ll = npSunL();
            npSun = Ll.z > 0.03 ? smoothstep( npR * 1.0, npR * 0.8, length( npC( qb + Ll.xy / Ll.z * ( D - z0 ) - npS * z0 ) ) ) : 0.0;
            npHoleN = vec3( qbc * 2.0, 1.0 );
          }
        } else {
          float k = clamp( ( wd - z0 ) / max( D - z0, 1e-3 ), 0.0, 1.0 );
          float att = exp( -( wd - z0 ) / max( npR * 2.2, 0.02 ) );
          vec2 rw = q + dxy * s, rc0 = rw - npS * wd; // Wandpunkt, relativ zur Kanalmitte in dieser Tiefe
          float stri = 0.8 + 0.4 * npN2( vec2( atan( rc0.y, rc0.x ) * 3.0, wd * 25.0 ) + npSeed );
          col = fresh * mix( 0.35, 0.8, att ) * stri;
          npAO = mix( 0.04, 0.5, att );
          // Sonnenfleck an der Kanalwand: Licht kommt durch die Öffnung bis hierher
          {
            vec3 Ll = npSunL();
            vec2 sl = Ll.z > 0.03 ? Ll.xy / Ll.z : vec2( 0.0 );
            // Weg zur Öffnung frei: halbe und volle Höhe im Kanal prüfen
            float h1 = length( npC( rw + sl * ( wd - z0 ) * 0.5 - npS * ( wd + z0 ) * 0.5 ) ), h2 = length( npC( rw + sl * ( wd - z0 ) - npS * z0 ) );
            npSun = Ll.z > 0.03 ? smoothstep( npR * 1.04, npR * 0.9, max( h1, h2 ) ) : 0.0;
          }
          if ( thr > 0.5 ) npHoleEmit = npThrough( vec3( 0.0, 0.0, -1.0 ) ) * 0.3 * pow( k, 3.0 ); // Licht vom anderen Ende auf der Kanalwand
          npHoleN = vec3( -rc0 / max( length( rc0 ), 1e-4 ), 0.15 );
        }
        a = 1.0;
      }
      // Kante zum Rand weich (1–1,5 Bildpunkte): Kraterfarbe geht in den Bruchsaum über – keine Treppenstufen
      {
        vec2 uS = cpS / max( crhoS, 1e-4 );
        float edgeR = npDc > 0.0 ? npEdge( uS ) : npHoleR( uS );
        float ea = smoothstep( 0.0, 1.5 * npFw, edgeR - crhoS );
        bool hard = npSt == 1 || npSt == 2 || npSt == 7;
        vec3 rimC = npSt == 0 ? fresh * 0.45 : hard ? fresh * 0.92 : col;
        float rimA = hard ? 0.75 : npSt == 0 ? 0.85 : 0.0;
        col = mix( rimC, col, ea );
        a = mix( rimA, a, ea );
        npHoleEmit *= ea; npAO = mix( 1.0, npAO, ea ); npSun = mix( 1.0, npSun, ea );
      }
    } else {
      // --- Oberfläche um den Krater: Staub, Splitter, Sprünge je Werkstoff
      vec2 cp0 = npC( p0 );
      float crho = length( cp0 );
      vec2 u = cp0 / max( crho, 1e-4 );
      float e = npDc > 0.0 ? npEdge( u ) : npHoleR( u );
      float rel = clamp( ( crho - e ) / max( 1.0 - e, 1e-3 ), 0.0, 1.0 );
      float n1 = npN2( p0 * 6.0 + npSeed * 1.7 ), n2 = npN2( p0 * 17.0 + npSeed * 5.3 );
      if ( npSt == 1 || npSt == 7 || npSt == 2 ) {
        // Bruchkante (schmaler heller Saum), feiner Staub, kleine Splitter-Narben drumherum
        float lip = ( 1.0 - smoothstep( 0.0, 0.03 + 0.06 * n2, rel ) ) * ( 0.55 + 0.45 * n1 );
        float dust = ( 1.0 - smoothstep( 0.0, 1.0, rel ) ) * ( 0.35 + 0.65 * n1 ) * ( npSt == 2 ? 0.55 : 0.3 );
        vec3 c = npCell( p0 * 13.0 + npSeed * 2.0 );
        float pit = ( 1.0 - smoothstep( 0.06, 0.12, c.x ) ) * step( 0.72, c.y ) * ( 1.0 - smoothstep( 0.2, 0.9, rel ) );
        a = max( max( lip * 0.9, dust ), pit * 0.95 );
        col = pit > 0.5 ? fresh * 0.35 : fresh * ( 0.92 + 0.16 * n2 );
        npHoleN = vec3( -u * lip * 0.6 + ( vec2( n1, n2 ) - 0.5 ) * 0.3, 1.0 );
      } else if ( npSt == 0 ) {
        // Holz: am Lochrand gestauchte, dunkle Fasern; entlang der Maserung (x) herausgerissene helle Spreißel –
        // am Austritt lang und zahlreich
        float crush = 1.0 - smoothstep( 0.0, 0.09, rel );
        vec3 c = npCell( vec2( p0.x * 1.4, p0.y * 10.0 ) + npSeed );
        float reach = ( npExit ? 0.95 : 0.42 ) * mix( 0.3, 1.0, abs( u.x ) );
        float spl = ( 1.0 - smoothstep( 0.16, 0.3, c.x ) ) * step( npExit ? 0.3 : 0.55, c.y ) * ( 1.0 - smoothstep( reach * 0.55, reach, rel ) );
        a = max( crush * 0.85, spl );
        col = crush > spl ? fresh * 0.45 : fresh * ( 0.9 + 0.3 * c.y );
        npHoleN = vec3( 0.0, ( c.y - 0.5 ) * 0.9 * spl, 1.0 );
      } else if ( npSt == 3 ) {
        // Blech: Lack abgeplatzt (blanker Ring), außen Schmauch
        float ring = 1.0 - smoothstep( 0.0, 0.18 + 0.12 * n1, rel );
        float soot = ( 1.0 - smoothstep( 0.1, 1.0, rel ) ) * 0.4 * n1;
        a = max( ring, soot );
        col = mix( vec3( npL * 0.25 ), fresh * ( 0.85 + 0.25 * n2 ), ring );
        npHoleN = vec3( -u * ring * 0.4, 1.0 );
      } else if ( npSt == 4 ) {
        // Glas: Spinnennetz – Strahlen + Ringe, weiß zerstoßen am Loch
        float ang = atan( p0.y, p0.x );
        float rays = 1.0 - smoothstep( 0.0, 0.035 + 0.02 * rel, abs( sin( ang * 7.0 + n1 * 3.0 + npSeed ) ) );
        float rings = ( 1.0 - smoothstep( 0.0, 0.03, abs( fract( rel * 3.0 + n2 * 0.3 ) - 0.5 ) ) ) * step( 0.12, rel );
        float crush = 1.0 - smoothstep( 0.0, 0.18, rel );
        a = max( max( rays * ( 1.0 - rel * 0.6 ), rings * 0.6 * ( 1.0 - rel ) ), crush * 0.9 );
        col = fresh;
        npHoleN = vec3( ( n1 - 0.5 ) * 0.6, ( n2 - 0.5 ) * 0.6, 1.0 );
      } else if ( npSt == 5 ) {
        // Erde: ausgeworfene Krumen, feucht dunkel
        float throwout = ( 1.0 - smoothstep( 0.0, 0.8, rel ) ) * smoothstep( 0.35, 0.7, n2 );
        a = max( ( 1.0 - smoothstep( 0.0, 0.3, rel ) ) * 0.7, throwout * 0.85 );
        col = fresh * ( 0.8 + 0.5 * n1 );
        npHoleN = vec3( ( vec2( n1, n2 ) - 0.5 ) * 0.8, 1.0 );
      } else {
        // Stoff: ausgefranster Rand
        a = ( 1.0 - smoothstep( 0.0, 0.25 + 0.4 * n2, rel ) ) * 0.9;
        col = fresh * ( 0.7 + 0.5 * n1 );
      }
      // Querschläger: Bleischmiere in Flugrichtung hinter der Schleifspur
      if ( vHole6.w < -1.5 ) {
        float smear = step( 0.0, cp0.x ) * ( 1.0 - smoothstep( 0.05, 0.3, abs( cp0.y ) / max( 1.0 - cp0.x * 0.6, 0.2 ) ) ) * ( 1.0 - smoothstep( 0.4, 1.0, cp0.x ) );
        a = max( a, smear * 0.55 );
        col = mix( col, vec3( npL * 0.35 ), smear );
      }
      a *= 1.0 - smoothstep( 0.92, 1.0, max( crho, rho0 ) );
      if ( a < 0.01 ) discard;
    }
    // Krümmung der Fläche in die Normale
    npHoleN = vec3( npHoleN.xy + vec2( vK.x * p0.x, vK.y * p0.y ) * npHoleN.z, npHoleN.z );
    diffuseColor.rgb = col;
    diffuseColor.a *= a;
  }`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize( vTx * npHoleN.x + vTy * npHoleN.y + vTz * npHoleN.z );`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += npHoleEmit;`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.directDiffuse *= npSun; reflectedLight.directSpecular *= npSun * npAO;
  reflectedLight.indirectDiffuse *= npAO; reflectedLight.indirectSpecular *= npAO * npAO;`);
}
