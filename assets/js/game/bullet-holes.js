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
import { CUTS, CUT_MAX, CUT_STRIDE, CUT_K, CUT_GLSL, setCutCount } from './world/shading.js';

const MAX = 700;
// Durchblick: kleine Ansichten aus Durchschüssen (Atlas 4 × 4 Felder), was hinter der Wand liegt – mit Gegnern
const VIEW_GRID = 4, VIEW_FOV = 104, VIEW_RANGE = 14;
const BACK_PROBE = 1.6; // höchste messbare Wanddicke (m); dicker = „massiv“
// Darstellungsart je Oberfläche: 0 Holz, 1 Beton, 2 Putz, 3 Metall, 4 Glas, 5 Erde, 6 Stoff, 7 Ziegel
const STYLE = { wood: 0, concrete: 1, tile: 7, plaster: 2, metal: 3, vehicle: 3, glass: 4, dirt: 5, grass: 5, sand: 5, fabric: 6, brick: 7 };
// Lochradius-Faktor (× Kaliberradius), Kraterradius (× Lochradius, + Anteil der Energie), Breitenzuwachs je Treffer
// dc: Kratertiefe (× Kraterradius) – Abplatztrichter vor dem eigentlichen Lochkanal
const SHAPE = [
  { hole: 1.15, crater: 2.3, craterE: 0.005, grow: 0.55, dig: 0.55, dc: 0.07 }, // Holz: Fasern reißen, wächst schnell
  { hole: 1.0,  crater: 3.0, craterE: 0.012, grow: 0.35, dig: 0.5,  dc: 0.36 }, // Beton: Abplatzkrater
  { hole: 1.2,  crater: 3.4, craterE: 0.012, grow: 0.5,  dig: 0.6,  dc: 0.3 },  // Putz
  { hole: 1.0,  crater: 1.9, craterE: 0.003, grow: 0.15, dig: 0.4,  dc: 0.07 }, // Metall: sauberes Loch, Delle, Glanzring
  { hole: 1.1,  crater: 9.0, craterE: 0.02,  grow: 0.3,  dig: 1,    dc: 0 },    // Glas: Sprünge weit hinaus
  { hole: 1.6,  crater: 2.6, craterE: 0.01,  grow: 0.45, dig: 0.55, dc: 0.7 },  // Erde/Sand: Trichter
  { hole: 1.3,  crater: 1.8, craterE: 0.002, grow: 0.4,  dig: 1,    dc: 0 },    // Stoff
  { hole: 1.0,  crater: 3.0, craterE: 0.012, grow: 0.4,  dig: 0.5,  dc: 0.38 }, // Ziegel
];
// Höchstmaße je Stil [Lochradius, Kraterradius] (m): Holzbohle reißt nicht metergroß auf, Blech nur begrenzt
const MAXR = [[0.06, 0.13], [0.09, 0.3], [0.09, 0.26], [0.07, 0.1], [0.12, 0.4], [0.1, 0.3], [0.08, 0.12], [0.09, 0.3]];
// Wandfarbe (linear), wenn das Kugel-Dreieck keine kennt (Gelände, Requisiten)
const ALBEDO = [[0.25, 0.17, 0.1], [0.3, 0.3, 0.28], [0.6, 0.58, 0.55], [0.3, 0.3, 0.3], [0.6, 0.62, 0.64], [0.12, 0.1, 0.08], [0.2, 0.2, 0.19], [0.3, 0.12, 0.07]];

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _tx = new THREE.Vector3(), _ty = new THREE.Vector3();
// eigene Hilfsvektoren der Durchbruch-Abfragen (laufen auch innerhalb von world.raycast anderer Aufrufer)
const _cv = new THREE.Vector3(), _ctx = new THREE.Vector3(), _cty = new THREE.Vector3(), _ro = new THREE.Vector3(), _tn = new THREE.Vector3();
// Dicke einzelner Platten ohne Rückseite (Glasscheiben, Blechtafeln, Karosserie, Stoff, dünne Bretter) in m
const SHEET = { glass: 0.006, metal: 0.003, vehicle: 0.0015, fabric: 0.003, wood: 0.025, plaster: 0.015, tile: 0.012 };
// Querschläger unterhalb dieses Einfallskosinus (Stil → cos): Beton/Ziegel ~76°, Metall ~71° von der Normalen
const RICOCHET = { 1: 0.24, 7: 0.24, 3: 0.32 };
// Wanddurchbruch (Dauerfeuer): Kante eines Brockens, den eine Kugel (5,56 mm) am Rand eines Durchschusses herausschlägt (m)
const CHUNK = [0.035, 0.03, 0.06, 0.012, 0, 0, 0.02, 0.055];
// Größter Durchbruch je Stil (× Grundmaß nach Wanddicke): Beton hält mehr aus, Blech reißt nur begrenzt
const BREACH_K = [1, 0.7, 1.1, 0.5, 0, 0, 0, 1];
// Zacken des Durchbruchrands je Stil (gleich im Welt- und im Lochshader)
const JAG = [0.14, 0.1, 0.12, 0.05, 0.12, 0.1, 0.1, 0.12];
// Aufweitung zur Rückseite (Austritt bricht weiter aus): Holz splittert, Mauerwerk platzt, Blech kaum
const KB = [1.25, 1.15, 1.15, 1.0, 1.0, 1.0, 1.0, 1.18];
// Explosionen: Ladung relativ zur Splittergranate (Druck auf nahe Flächen) und Zahl der Splitter, die Wände pocken
const BLAST_Q = { frag: 1, semtex: 1.5, impact: 0.8, rocket: 2.6, shell_he: 3.2, shell_ap: 1.2, drone: 1.1, strike: 3, c4: 3.5, sentry: 0.15 };
const FRAG_N = { frag: 16, impact: 9, semtex: 6, rocket: 10, shell_he: 18, drone: 7, strike: 12, sentry: 2 };
// Widerstand gegen Druck je Stil (Holz, Beton, Putz, Blech, Glas, Erde, Stoff, Ziegel): Putzwand bricht, Beton kaum
const RESIST = [0.4, 1, 0.45, 2.5, 0, 0.6, 0.3, 0.85];
/** Zufallsfolge aus dem Explosionsort: alle Geräte rechnen dieselbe Bruchform. */
function rngAt(p) {
  let st = ((Math.floor(p.x * 97) * 73856093) ^ (Math.floor(p.y * 97) * 19349663) ^ (Math.floor(p.z * 97) * 83492791)) >>> 0;
  return () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const CUT_MIN_R = 0.03; // ab diesem Lochradius wird die Wand wirklich ausgeschnitten (echter Durchblick)
const jag = (th, seed, amp) => 1 + amp * (0.55 * Math.sin(3 * th + seed * 1.7) + 0.3 * Math.sin(5 * th + seed * 2.9) + 0.15 * Math.sin(9 * th + seed * 4.3));

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
    mat.defines = { NP_STEPS: q === 'low' ? 6 : 12, NP_PASS: 0 };
    // Durchblick-Atlas (ab mittlerer Stufe): Lochgrund zeigt die Welt hinter der Wand
    const rr = G.renderer?.renderer || null;
    // nur ab hoch (Handys: Lichtfarbe statt eigener Ansicht – jede Ansicht ist ein volles Szenenbild)
    this._viewOn = !!(rr && (q === 'high' || q === 'ultra'));
    this._viewRefresh = q === 'high' ? 0.8 : 0.4; // s bis zur Auffrischung (bewegte Gegner)
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
    this._probeQ = [];
    this._nextSlot = 0;
    mat.onBeforeCompile = (sh) => { sh.uniforms.npView = this._uView; sh.uniforms.npViewTan = this._uTan; sh.uniforms.npCut = CUTS.npCut; sh.uniforms.npCutN = CUTS.npCutN; holeShader(sh); };
    mat.customProgramCacheKey = () => 'np-holes-4';
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
    this.aHole7 = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); // Durchbruch: Achsen des Wandausschnitts im Quad (sonst 0)
    for (const a of [this.aHole, this.aHole2, this.aHole3, this.aHole4, this.aHole5, this.aHole6, this.aHole7]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHole', this.aHole);
    geo.setAttribute('aHole2', this.aHole2);
    geo.setAttribute('aHole3', this.aHole3);
    geo.setAttribute('aHole4', this.aHole4);
    geo.setAttribute('aHole5', this.aHole5);
    geo.setAttribute('aHole6', this.aHole6);
    geo.setAttribute('aHole7', this.aHole7);
    // zweiter Durchgang: nur die Öffnungen (Lochkanal), über allen Rändern – überlappende Löcher verdecken sich nicht
    const mat2 = mat.clone();
    mat2.defines = { ...mat.defines, NP_PASS: 1 };
    mat2.onBeforeCompile = mat.onBeforeCompile;
    mat2.customProgramCacheKey = () => 'np-holes-4-p1';
    this.mesh2 = new THREE.InstancedMesh(geo, mat2, MAX);
    this.mesh2.instanceMatrix = this.mesh.instanceMatrix;
    this.mesh2.name = 'einschussloecher-oeffnung';
    this.mesh2.count = 0;
    this.mesh2.frustumCulled = false;
    this.mesh2.renderOrder = 4;
    if (G.scene) { G.scene.add(this.mesh); G.scene.add(this.mesh2); }
    // Wanddurchbrüche: echte Ausschnitte im Weltshader (die nächsten CUT_MAX), Kugeln und Sicht gehen hindurch
    this._cutT = 0;
    this._cutDirty = false;
    this._cutOn = [];
    this._cutList = []; // alle Durchbrüche (für Strahlen und Kollision)
    setCutCount(0);
    const W = G.world;
    if (W && typeof W.lineOfSight === 'function' && typeof W.raycast === 'function') {
      const los0 = W.lineOfSight, self = this;
      this._los0 = los0;
      this._los = function (a, b2) {
        if (los0.call(this, a, b2)) return true;
        return G.holes === self && self._openLine(a, b2);
      };
      W.lineOfSight = this._los;
    }
    this._fragQ = []; // Splitter unterwegs: { t (Ankunft), f (Treffer), dir, vals }
    this._wrapWorld();
    this._offs = G.events && typeof G.events.on === 'function' ? [G.events.on('explosion', (e) => this.blast(e)), G.events.on('dig', (e) => this._dug(e))] : [];
  }

  // --- Explosionen ---------------------------------------------------------------------------------------------

  /**
   * Explosion: Druck auf die nächsten Flächen ringsum (Fußpunkt auf jeder Wand-/Bodenebene) – Krater, bei dünnen oder
   * schwachen Wänden ein Durchbruch (Haftgranate an der Wand, Rakete) –, dazu Splitter, die Wände pocken. Jedes Gerät
   * rechnet aus demselben 'explosion'-Ereignis mit derselben Zufallsfolge.
   */
  blast(e) {
    if (!e || !e.position || e.nonLethal) return;
    const W = this.G.world;
    if (!W || typeof W.raycast !== 'function') return;
    const Q = BLAST_Q[e.type] ?? BLAST_Q[e.weaponId] ?? Math.max(0.3, (e.radius || 4) / 6);
    const o = e.position.clone(); o.y += 0.12;
    const rnd = rngAt(o);
    const reach = 0.6 + Q * 0.9;
    const planes = [];
    const dir = new THREE.Vector3();
    const N = 14;
    for (let k = 0; k < N + 2; k++) {
      if (k < N) { const a = (k / N) * Math.PI * 2 + rnd() * 0.3; dir.set(Math.cos(a), k % 2 ? 0.3 : -0.12, Math.sin(a)).normalize(); }
      else dir.set(0, k === N ? -1 : 1, 0);
      const f = W.raycast(o, dir, reach);
      if (!f || f.solid || f.targetId != null) continue;
      const n = f.normal.clone(); if (n.dot(dir) > 0) n.negate();
      const dp = _v.copy(o).sub(f.point).dot(n);
      if (dp < -0.05) continue;
      if (planes.some((q) => q.n.dot(n) > 0.95 && Math.abs(q.n.dot(f.point) - q.n.dot(q.p)) < 0.06)) continue;
      planes.push({ n, p: f.point.clone(), d: Math.max(0, dp), f });
    }
    for (const pl of planes) {
      // Fußpunkt: gerade auf die Fläche zu (nächste Stelle, stärkster Druck)
      const back = pl.n.clone().negate();
      const g = W.raycast(o, back, pl.d + 0.12);
      const hit = g && !g.solid && g.targetId == null && Math.abs(g.distance - pl.d) < 0.06 ? g : pl.f;
      const dist = hit === g ? g.distance : o.distanceTo(pl.f.point);
      this._blastHit(hit, back, Q / (dist + 0.25) ** 2, rnd, Q);
    }
    // Splitter: sichtbar als glühende Streifen vom Sprengpunkt weg; wo sie einschlagen (beim Eintreffen) Pocken + Staub.
    // Die Hälfte fliegt nur sichtbar ins Freie (keine Strahlprüfung).
    const nf = FRAG_N[e.type] ?? FRAG_N[e.weaponId] ?? 0;
    const fx = this.G.effects;
    for (let k = 0; k < nf * 2; k++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      dir.set(r * Math.cos(a), u * 0.75 + 0.08, r * Math.sin(a)).normalize();
      const speed = 150 + rnd() * 150, seg = 0.3 + rnd() * 0.45, width = 0.007 + rnd() * 0.007, inten = 0.5 + rnd() * 0.45;
      const vals = [rnd(), rnd(), rnd()];
      const f = k < nf ? W.raycast(o, dir, 9) : null;
      const end = f ? f.point : o.clone().addScaledVector(dir, 3 + vals[0] * 9);
      if (fx && typeof fx.tracer === 'function') fx.tracer(o, end, { speed, seg, width: width * 1.6, intensity: inten * 1.5, skip: 0.25 });
      if (fx && typeof fx.fragment === 'function') fx.fragment(o, dir, o.distanceTo(end), { speed: 60 + vals[1] * 50 });
      if (f && !f.solid && f.targetId == null) this._fragQ.push({ t: this._time + f.distance / speed, f, dir: dir.clone(), vals });
    }
    this.stats.holes = this.holes.length;
  }

  /**
   * Explosionstrichter im Gelände (digging.js 'dig' mit crater): aufgewühlte, angesengte Erde als gebogenes Quad in
   * der Mulde; flache Brandflecken darüber (lägen in der Luft) blendet der Effekt-Layer aus.
   */
  _dug(e) {
    if (!e || !e.crater || !Number.isFinite(e.x) || !Number.isFinite(e.z)) return;
    const W = this.G.world, r = e.r || 1, d = e.dy || 0.3;
    const at = (x, z) => (W && typeof W.heightAt === 'function' ? W.heightAt(x, z) : NaN);
    const dec = this.G.effects && this.G.effects.decals;
    if (dec && typeof dec.hideAbove === 'function') dec.hideAbove(e.x, e.z, r * 1.6, at);
    const y = at(e.x, e.z);
    if (!Number.isFinite(y)) return;
    // ein Trichter je Stelle: frühere Erdflecken hier ersetzen
    this.removeWhere((h) => h.scorch && Math.hypot(h.pos.x - e.x, h.pos.z - e.z) < r * 0.6);
    const h = this._make(new THREE.Vector3(e.x, y, e.z), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), 'dirt', 5, Infinity, false, [0.07, 0.055, 0.04]);
    if (!h) return;
    h.scorch = true; h.r = 0.002; h.rc = r * 1.08; h.depth = 0.003; h.cos = 1; h.slope = [0, 0];
    // Mulde: Quad biegt sich zum Rand hin hoch (Tiefe d über Radius r)
    h.kx = h.ky = (-2 * d) / (r * r) * 0.9;
    h.clip = [9, 9, 9, 9]; h.probed = 99;
    this._write(h);
    this.stats.holes = this.holes.length;
  }

  /** Druck s (≈ Ladung / Abstand²) auf eine Fläche: Krater, ggf. Durchbruch mit zerrissenem Umriss. */
  _blastHit(hit, dir, s, rnd, Q = 1) {
    const surface = hit.surface || 'concrete', style = STYLE[surface];
    if (style === undefined || style === 4) return;
    const n = hit.normal.clone(); if (n.dot(dir) > 0) n.negate();
    const flat = Math.abs(n.y) > 0.7;
    // Erdboden der Geländekarten: Trichter macht digging.js (echte Höhenänderung)
    if (n.y > 0.7 && style === 5 && this.G.digging && this.G.digging.active) return;
    if (this._cutAt(hit.point, 1)) return;
    const thick = this._thickness(hit.point, dir, surface, hit);
    const backN = this._backN;
    const res = RESIST[style] || 1;
    const pen = (0.05 * s) / res;
    const rcB = Math.min(1.2, 0.04 + (0.11 * Math.sqrt(s)) / Math.sqrt(res));
    let h = this._near(hit.point, n, surface, rcB, null);
    if (!h) {
      const alb = (hit.tri != null && this.G.world?.albedoAt?.(hit.tri, [0, 0, 0])) || ALBEDO[style];
      h = this._make(hit.point, n, dir, surface, style, thick, false, alb);
      if (!h) return;
      h.cos = 1; h.slope = [0, 0];
      if (hit.object && hit.object.name) h.objName = hit.object.name;
      h.r = 0.004; h.rc = rcB; h.depth = Math.min(thick, Math.max(0.006, pen * 0.6));
    } else {
      h.hits++;
      if (!h.cut) h.rc = Math.max(h.rc, rcB);
      h.depth = Math.min(thick, h.depth + pen * 0.6);
    }
    if (backN && !h.backN) h.backN = backN;
    if (!flat && thick !== Infinity && pen >= thick) {
      const rb = Math.min(1.2, 0.06 + 0.16 * Math.sqrt(s / res));
      h.depth = thick;
      if (!h.through) { h.through = true; this.stats.through++; h.behind = this._behind(h.pos.clone().addScaledVector(dir, thick + 0.02), dir); }
      if (!h.exitHole) this._newExit(h, dir, n, thick, surface, style, null);
      if (this._cutOk(h)) {
        if (!h.cut) { h.r = Math.max(h.r, CUT_MIN_R); this._makeCut(h); }
        // zerrissener Umriss: Kernloch um den Fußpunkt + ausgebrochene Lappen; Sprengung reißt weiter auf als Beschuss
        // schwere Ladungen (Rakete, Panzergranate) reißen auch Mauerwerk mannshoch auf
        const cap = Math.min(1.3, this._breachCap(h) * 1.7 + 0.1 * Q), c = this._cutLocal(h, hit.point);
        this._addDisc(h, c.x, c.y, rb * 0.7, cap);
        for (let k = 0; k < 7; k++) {
          const a = rnd() * Math.PI * 2, d = rb * (0.25 + 0.5 * rnd());
          this._addDisc(h, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, rb * (0.2 + 0.35 * rnd()), cap);
        }
        // kein glatter Kreis, auch wenn die Grenze greift: jede Richtung bricht anders weit aus
        for (let k = 0; k < CUT_K; k++) h.prof[k] = Math.max(CUT_MIN_R, h.prof[k] * (0.72 + 0.32 * rnd()));
        this._sizeCut(h);
        this._cutDirty = true;
        this._absorb(h);
      } else {
        h.r = Math.max(h.r, Math.min(MAXR[style][0] * 1.5, rb * 0.5));
        h.rc = Math.max(h.rc, h.r * 1.5);
      }
    }
    this._queueProbe(h);
    if (h.exitHole) { this._syncExit(h); this._write(h.exitHole); }
    this._write(h);
  }

  /** Splitter: kleiner, flacher Einschlag (schräg gestreckt). vals: drei Zufallswerte (gleich auf allen Geräten). */
  _pock(f, dir, vals) {
    let vi = 0;
    const rnd = () => vals[vi++ % vals.length];
    const surface = f.surface || 'concrete', style = STYLE[surface];
    if (style === undefined || style === 4 || this._cutAt(f.point, 1)) return;
    const n = f.normal.clone(); if (n.dot(dir) > 0) n.negate();
    const alb = (f.tri != null && this.G.world?.albedoAt?.(f.tri, [0, 0, 0])) || ALBEDO[style];
    const h = this._make(f.point, n, dir, surface, style, Infinity, false, alb);
    if (!h) return;
    this._slope(h, dir);
    h.r = 0.0015 + rnd() * 0.002;
    h.rc = 0.008 + rnd() * 0.012;
    h.depth = 0.004 + rnd() * 0.01;
    if (f.object && f.object.name) h.objName = f.object.name;
    this._queueProbe(h);
    this._write(h);
  }

  /** Austrittsloch auf der Rückseite anlegen (größerer Ausbruch). */
  _newExit(h, dir, n, thick, surface, style, att) {
    const ep = h.pos.clone().addScaledVector(dir, thick);
    // Austrittsfläche: gemessene Rückseite (Stamm, schräge Wand), sonst parallel zur Eintrittsfläche
    const exN = h.backN || n.clone().negate();
    const ex = this._make(ep, exN, dir.clone().negate(), surface, style, thick, true, h.alb);
    if (!ex) return null;
    this._slope(ex, dir.clone().negate());
    if (att) ex.att = att;
    ex.r = Math.min(MAXR[style][0] * 1.2, h.r * (style === 3 ? 1.15 : 1.5));
    ex.rc = Math.min(MAXR[style][1] * 1.3, h.rc * (style === 0 || style === 1 || style === 7 ? 1.7 : 1.15));
    ex.depth = thick; ex.through = true; ex.behind = this._behind(h.pos.clone().addScaledVector(dir, -0.02), dir.clone().negate());
    this._queueProbe(ex);
    h.exitHole = ex;
    this._write(ex);
    return ex;
  }

  // --- Wanddurchbrüche -----------------------------------------------------------------------------------------
  // Ein Durchbruch hat einen Umriss aus CUT_K Radien (um seine Mitte auf der Vorderfläche). Jeder Treffer am Rand
  // bricht dort einen Brocken heraus (Vereinigung mit einer Scheibe um den Trefferpunkt) – das Loch wächst so, wie
  // die Garbe liegt (MG mit Rückstoß → unregelmäßig, nach oben gezogen), nicht als gemittelter Kreis.

  /** Taugt das Loch zum Durchbruch (glatte, ebene Wand mit paralleler Rückseite, kein Stamm/Objekt)? */
  _cutOk(h) {
    if (!h.through || h.exit || h.att || h.nick || h.ricochet || !(BREACH_K[h.style] > 0) || h.thick === Infinity) return false;
    if (h.objName === 'totholz' || (h.kx || 0) > 2 || (h.ky || 0) > 2) return false;
    if (h.backN && h.backN.dot(h.n) > -0.94) return false;
    return h.thick * Math.min(1, Math.max(0.2, h.cos ?? 1)) <= 0.8;
  }

  /** Größter Radius eines Durchbruchs (m): dünne Wände reißen weit auf, dicke kaum. */
  _breachCap(h) {
    const T = h.tn ?? h.thick * Math.min(1, Math.max(0.2, h.cos ?? 1));
    return Math.min(0.9, Math.max(0.2, 1.1 - T * 2.2)) * BREACH_K[h.style];
  }

  /** Loch wird Wandausschnitt: gerader Kanal entlang der Normalen, Austritt genau dahinter. */
  _makeCut(h) {
    h.cut = true;
    this._cutList.push(h);
    h.tn = Math.max(0.003, h.thick * Math.min(1, Math.max(0.2, h.cos ?? 1)));
    h.kb = KB[h.style];
    h.slope = [0, 0];
    h.prof = new Float32Array(CUT_K).fill(h.r);
    this._sizeCut(h);
    this._cutDirty = true;
  }

  /** Lochmaße aus dem Umriss (h.r = größter Radius, Krater als Saum darum) + Austritt nachziehen. */
  _sizeCut(h) {
    let m = 0;
    for (const r of h.prof) m = Math.max(m, r);
    h.r = m;
    h.rc = m * (1 + JAG[h.style]) * 1.12 + 0.08;
    this._syncExit(h);
  }

  _syncExit(h) {
    const ex = h.exitHole;
    if (!ex) return;
    if (h.cut) {
      ex.pos.copy(h.pos).addScaledVector(h.n, -h.tn);
      ex.n.copy(h.n).negate();
      ex.dir.copy(h.n);
      ex.slope = [0, 0];
      ex.seed = h.seed;
      ex.entry = h;
      ex.r = h.r * h.kb;
      ex.rc = ex.r * (1 + JAG[h.style]) * 1.12 + 0.08;
    } else ex.pos.copy(h.pos).addScaledVector(h.dir, h.thick === Infinity ? 0 : h.thick);
  }

  /** Radius (m) des Ausschnitts von h in Richtung (x, y) der Ausschnittachsen bei relativer Tiefe f (wie npCutRAt). */
  _cutR(h, x, y, f = 0) {
    const th = Math.atan2(y, x);
    const u = ((th < 0 ? th + Math.PI * 2 : th) * CUT_K) / (Math.PI * 2);
    const k0 = Math.floor(u) % CUT_K, k1 = (k0 + 1) % CUT_K;
    let t = u - Math.floor(u); t = t * t * (3 - 2 * t);
    return (h.prof[k0] + (h.prof[k1] - h.prof[k0]) * t) * jag(th, h.seed, JAG[h.style]) * (1 + (h.kb - 1) * f);
  }

  /** Punkt p relativ zum Durchbruch h: { x, y } in den Ausschnittachsen, hh Abstand vor der Vorderfläche. */
  _cutLocal(h, p) {
    _cv.copy(p).sub(h.pos);
    const hh = _cv.dot(h.n);
    this._frame(h.n, _ctx, _cty);
    return { x: _cv.dot(_ctx), y: _cv.dot(_cty), hh };
  }

  /** Umriss um eine Scheibe (Mitte x, y in den Ausschnittachsen, Radius c) erweitern – höchstens bis cap. */
  _addDisc(h, x, y, c, cap) {
    const d2 = x * x + y * y, d = Math.sqrt(d2), phi = Math.atan2(y, x);
    for (let k = 0; k < CUT_K; k++) {
      const th = (k / CUT_K) * Math.PI * 2, ux = Math.cos(th), uy = Math.sin(th);
      const b = x * ux + y * uy, disc = c * c - (d2 - b * b);
      let far = disc >= 0 ? b + Math.sqrt(disc) : 0;
      // zwischen zwei Stützstrahlen: Nachbarn anteilig mitnehmen (schmale Brocken gehen nicht verloren)
      let dth = Math.abs(th - phi); if (dth > Math.PI) dth = Math.PI * 2 - dth;
      const half = Math.PI / CUT_K + Math.atan2(c, Math.max(d, 1e-3));
      if (dth < half) far = Math.max(far, (d + c * 0.5) * Math.cos(dth) * (1 - (dth / half) * 0.35));
      if (far > h.prof[k]) h.prof[k] = Math.min(cap, far);
    }
  }

  /**
   * Durchbruch/großes Loch h räumt Löcher auf, die nun in oder an seiner Öffnung lägen (sonst schweben sie in der
   * Luft): gleiche Wand, beide Seiten. Nahe Löcher derselben Seite vergrößern den Durchbruch um ihre Fläche.
   */
  _absorb(h) {
    const gone = new Set();
    const cap = h.cut ? this._breachCap(h) : 0;
    const tn = h.cut ? h.tn : (h.thick === Infinity ? 0.05 : h.thick);
    let grew = false;
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      for (const o of this.holes) {
        if (o === h || o === h.exitHole || o.dead || o.scorch || gone.has(o) || o.att || Math.abs(o.n.dot(h.n)) < 0.9) continue;
        if (o.entry === h) continue;
        _v.copy(o.pos).sub(h.pos);
        const hh = _v.dot(h.n);
        if (hh > 0.06 || hh < -tn - 0.06) continue;
        this._frame(h.n, _tx, _ty);
        const x = _v.dot(_tx), y = _v.dot(_ty), d = Math.hypot(x, y);
        const f = h.cut ? Math.min(1, Math.max(0, -hh / Math.max(h.tn, 1e-3))) : 0;
        const R = h.cut ? this._cutR(h, x, y, f) : hh < -0.06 && h.exitHole ? h.exitHole.r : h.r;
        const front = Math.abs(hh) < 0.06 && !o.exit && o.n.dot(h.n) > 0;
        if (d > R * 1.02 + o.rc * (o.cut ? 1 : front && h.cut ? 0.8 : 0.4)) continue;
        // eigenes Gegenstück mitnehmen (Austritt bzw. Eintritt auf der anderen Seite)
        gone.add(o);
        if (o.exitHole) gone.add(o.exitHole);
        if (o.exit && o.entry) gone.add(o.entry);
        // zwei Durchbrüche wachsen zu einem zusammen (die Wand dazwischen bricht weg)
        if (h.cut && front && !o.nick) { this._addDisc(h, x, y, o.r * (o.through ? 1 : 0.6), o.cut ? Math.max(cap, d + o.r * 1.05) : cap); grew = any = true; }
        h.hits += o.hits || 0;
      }
      if (!any) break;
      this._sizeCut(h);
    }
    if (!gone.size) return;
    this.removeWhere((o) => gone.has(o));
    if (grew || h.cut) this._cutDirty = true;
  }

  /** Liegt p im Ausschnitt eines Durchbruchs? → Loch oder null (inner: Anteil des Radius). */
  _cutAt(p, inner = 0.9) {
    for (const h of this._cutList) {
      if (h.dead) continue;
      const c = this._cutLocal(h, p);
      if (c.hh > 0.03 || c.hh < -h.tn - 0.03) continue;
      const d2 = c.x * c.x + c.y * c.y;
      if (d2 > h.r * h.r * 2) continue;
      const R = this._cutR(h, c.x, c.y, Math.min(1, Math.max(0, -c.hh / h.tn))) * inner;
      if (d2 < R * R) return h;
    }
    return null;
  }

  /** Sichtlinie: Wände, die nur an Durchbrüchen getroffen werden, verdecken nicht. */
  _openLine(a, b2) {
    if (!this._cutList.length) return false;
    const d = b2.clone().sub(a);
    const L = d.length();
    if (L < 1e-4) return true;
    // world.raycast lässt Durchbrüche schon aus (_wrapWorld)
    return !this.G.world.raycast(a, d.divideScalar(L), L - 0.02);
  }

  /** Strahl-Weiterführung hinter einem Durchbruch: Abstand ab Trefferpunkt bis hinter die Wand. */
  _cutExit(h, point, dir) {
    const dn = dir.dot(h.n), hh = _cv.copy(point).sub(h.pos).dot(h.n);
    const t = Math.abs(dn) < 0.05 ? 0.3 : dn < 0 ? (hh + h.tn + 0.03) / -dn : (0.04 - hh) / dn;
    return Math.min(2, Math.max(0.01, t));
  }

  /**
   * Keine unsichtbare Wand in Durchbrüchen: world.raycast (Kugeln, Granaten, Sicht, Hülsen …) läuft durch
   * ausgeschnittene Stellen weiter; die Kapsel-Kollision (Spieler, Bots) ignoriert die Wandfläche, wenn der ganze
   * Körper durch die Öffnung passt. Eigene Messungen (Dicke, Flächenabtastung) nutzen den ursprünglichen Strahl.
   */
  _wrapWorld() {
    const W = this.G.world, self = this;
    if (!W) return;
    if (typeof W.raycast === 'function') {
      const ray0 = W.raycast;
      this._rayW0 = ray0;
      this._ray0 = (o, d, m) => ray0.call(W, o, d, m);
      this._ray = function (origin, dir, max, ...rest) {
        let hit = ray0.call(this, origin, dir, max, ...rest);
        if (!hit || hit.solid || !self._cutList.length || self.G.holes !== self) return hit;
        _ro.copy(origin);
        let base = 0;
        for (let i = 0; i < 4 && hit && !hit.solid; i++) {
          const h = self._cutAt(hit.point, 0.95);
          if (!h) break;
          const step = hit.distance + self._cutExit(h, hit.point, dir);
          base += step;
          if (base >= max) return null;
          _ro.addScaledVector(dir, step);
          hit = ray0.call(this, _ro, dir, max - base, ...rest);
          if (hit) hit.distance += base;
        }
        return hit;
      };
      W.raycast = this._ray;
    }
    const col = W.collider;
    if (col && typeof col.triangleCapsuleIntersect === 'function') {
      const own = Object.prototype.hasOwnProperty.call(col, 'triangleCapsuleIntersect');
      const tci0 = col.triangleCapsuleIntersect;
      this._tci = { col, own, tci0 };
      this._tciW = function (capsule, tri) {
        const hit = tci0.call(this, capsule, tri);
        if (!hit || !self._cutList.length || self.G.holes !== self) return hit;
        return self._capsuleFits(capsule, tri) ? false : hit;
      };
      col.triangleCapsuleIntersect = this._tciW;
    }
  }

  /** Passt die Kapsel ganz durch einen Durchbruch in der Ebene dieses Dreiecks? */
  _capsuleFits(capsule, tri) {
    tri.getNormal(_tn);
    for (const h of this._cutList) {
      if (h.dead || Math.abs(_tn.dot(h.n)) < 0.9) continue;
      const hh = _cv.copy(tri.a).sub(h.pos).dot(h.n);
      if (hh > 0.04 || hh < -h.tn - 0.04) continue;
      const r = capsule.radius, s0 = capsule.start, s1 = capsule.end;
      let ok = true;
      // Achse in Schritten + Kuppen oben/unten; Querschnitt der Kapsel (Radius r) muss in den Umriss passen
      for (let k = -1; k <= 6 && ok; k++) {
        const t = k < 0 ? 0 : k > 5 ? 1 : k / 5;
        _ro.lerpVectors(s0, s1, t);
        let rr = r;
        if (k < 0 || k > 5) { _ro.y += k < 0 ? -r * 0.9 : r * 0.9; rr = r * 0.3; }
        const c = this._cutLocal(h, _ro);
        const d = Math.hypot(c.x, c.y);
        ok = d + rr < this._cutR(h, c.x, c.y, 0.5) * 0.92;
      }
      if (ok) return true;
    }
    return false;
  }

  /** Nächste CUT_MAX Durchbrüche (zur Kamera) in die Shader-Uniforms; Löcher außerhalb zeigen weiter die Lichtfarbe. */
  _uploadCuts() {
    const cp = this.G.camera?.position;
    const list = this.holes.filter((h) => h.cut && !h.dead);
    if (cp) list.sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp));
    const on = list.slice(0, CUT_MAX);
    const A = CUTS.npCut.value;
    on.forEach((h, i) => {
      this._frame(h.n, _tx, _ty);
      const o = i * CUT_STRIDE * 4, J = JAG[h.style];
      A[o] = h.pos.x; A[o + 1] = h.pos.y; A[o + 2] = h.pos.z; A[o + 3] = h.tn;
      A[o + 4] = h.n.x; A[o + 5] = h.n.y; A[o + 6] = h.n.z; A[o + 7] = h.kb;
      A[o + 8] = _tx.x; A[o + 9] = _tx.y; A[o + 10] = _tx.z; A[o + 11] = h.seed;
      A[o + 12] = J; A[o + 13] = h.r * h.kb * (1 + J) + 0.01; A[o + 14] = 0; A[o + 15] = 0;
      for (let k = 0; k < CUT_K; k++) A[o + 16 + k] = h.prof[k];
    });
    setCutCount(on.length);
    const was = new Set(this._cutOn);
    on.forEach((h, i) => {
      const changed = !h.cutOn || h.cutSlot !== i;
      h.cutOn = true; h.cutSlot = i;
      if (h.viewSlot != null) { this._slots[h.viewSlot] = null; h.viewSlot = null; }
      if (changed) { this._write(h); if (h.exitHole) this._write(h.exitHole); }
    });
    for (const h of was) {
      if (on.includes(h)) continue;
      h.cutOn = false; h.cutSlot = -1;
      if (!h.dead) { this._write(h); if (h.exitHole) this._write(h.exitHole); }
    }
    this._cutOn = on;
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
    const f = this._ray0 ? this._ray0(_v, dir, BACK_PROBE) : W.raycast(_v, dir, BACK_PROBE); // ohne Durchbruch-Lücken
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
    h.kx = h.ky = 0; h.clip = [1, 1, 1, 1]; h.probed = Math.max(0.03, Math.min(h.cut || (h.entry && h.entry.cut) ? 1.2 : 0.25, h.rc * this._elong(h) * 1.3));
    if (!W || typeof W.raycast !== 'function') return;
    const n = h.n, tx = new THREE.Vector3(), ty = new THREE.Vector3();
    this._frame(n, tx, ty);
    const d = h.probed, back = n.clone().negate(), o = new THREE.Vector3();
    const ks = [[], []];
    [[tx, 1, 0], [tx, -1, 1], [ty, 1, 2], [ty, -1, 3]].forEach(([ax, sg, ci]) => {
      for (let i = 1; i <= 3; i++) {
        const x = (d * i) / 3;
        o.copy(h.pos).addScaledVector(ax, x * sg).addScaledVector(n, 0.25);
        const f = this._ray0 ? this._ray0(o, back, 0.31) : W.raycast(o, back, 0.31);
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
    // gestreckt höchstens um ~10 cm über den Krater hinaus (große, zusammengeschossene Löcher werden runder)
    return Math.min(4.2, 1 + 0.1 / Math.max(h.rc || 0.02, 0.01), Math.sqrt(1 + s[0] * s[0] + s[1] * s[1]));
  }

  /** Lage eines angehefteten Lochs im Objektraum merken (Tür dreht sich → Loch wandert mit). */
  _attach(h) {
    const o = h.att;
    o.updateMatrixWorld(true);
    _m.copy(o.matrixWorld).invert();
    h.lp = h.pos.clone().applyMatrix4(_m);
    // Blatt (Tür) hängt schief, Kollision gerade: Loch auf die sichtbare Fläche legen
    const sz = o.userData && o.userData.snapZ;
    if (sz && Math.abs(h.lp.z) < sz * 4 + 0.1) h.lp.z = (h.lp.z < 0 ? -1 : 1) * sz;
    h.ln = h.n.clone().transformDirection(_m);
    h.ld = h.dir.clone().transformDirection(_m);
    h._attKey = this._objKey(o);
  }

  _objKey(o) { const e = o.matrixWorld.elements; return e[0] + e[2] * 3 + e[5] * 7 + e[8] * 11 + e[12] * 13 + e[13] * 17 + e[14] * 19; }

  /** Flächenabtastung später (update: nur nahe Löcher, wenige je Bild) – viele Schüsse kosten so kaum Strahlen. */
  _queueProbe(h) {
    if (!h._pq) { h._pq = true; this._probeQ.push(h); }
  }

  /** Loch an p (gleiche Fläche) oder null. */
  _near(p, n, surface, rcNew = 0.02, att = null) {
    // gleiche Fläche, Krater überlappen deutlich → dasselbe (wachsende) Loch; weiter auseinander → eigenes Loch
    let best = null, bd = Infinity;
    for (const h of this.holes) {
      if (h.dead || h.ricochet || h.nick || h.scorch || h.surface !== surface || (h.att || null) !== att) continue;
      if (h.exit) continue;
      // Durchbruch (beide Seiten): Treffer im Bruchsaum gehören dazu – der Rand bricht dort weiter aus
      if (h.cut) {
        const c = this._cutLocal(h, p);
        if (c.hh > 0.06 || c.hh < -h.tn - 0.06) continue;
        const d = Math.hypot(c.x, c.y);
        const R = this._cutR(h, c.x, c.y, Math.min(1, Math.max(0, -c.hh / h.tn)));
        if (d < R + (h.rc - h.r) * 0.5 + 0.06 && d * d < bd) { best = h; bd = d * d; }
        continue;
      }
      const d2 = h.pos.distanceToSquared(p);
      const lim = Math.max(h.r * 1.3, 0.45 * (h.rc + rcNew), 0.008);
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
    // Durchbruch: die Kugel trifft eine ausgeschnittene Stelle – sie fliegt ungehindert weiter (kein Einschlag)
    if (!hit.solid && hit.targetId == null) {
      const op = this._cutAt(hit.point, 0.9);
      if (op) {
        const dn = dir.dot(op.n), hh = _v.copy(hit.point).sub(op.pos).dot(op.n);
        const t = Math.abs(dn) < 0.05 ? 0.3 : dn < 0 ? (hh + op.tn + 0.03) / -dn : (0.04 - hh) / dn;
        const len = Math.min(2, Math.max(0.01, t));
        return { passed: true, open: true, energyLeft: 0.99, thick: len, exitPoint: hit.point.clone().addScaledVector(dir, len) };
      }
    }
    const pen = penetrationDepth(def, surface, distance) * energy * (0.55 + 0.45 * cosI);
    if (pen <= 0) return null;
    // Türen u. ä. (bewegliche Festkörper mit attach): Löcher haften am Objekt und wandern mit; Dicke bekannt
    const att = hit.solid && hit.solid.attach ? hit.solid.attach : null;
    let thick = att && hit.solid.thick ? hit.solid.thick : this._thickness(hit.point, dir, surface, hit);
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
        this._queueProbe(g);
        this._write(g);
      }
      return { passed: false, energyLeft: 0, thick, ricochet: true };
    }
    // bewegliche Festkörper (Türen): kein Loch (es würde nicht mitwandern), aber Durchschlag nach Dicke
    if ((hit.solid && !hit.solid.static && !att) || hit.targetId != null) {
      const passed = thick !== Infinity && pen >= thick;
      return { passed, energyLeft: passed ? Math.max(0.15, 1 - thick / pen) : 0, thick, exitPoint: passed ? hit.point.clone().addScaledVector(dir, thick) : null };
    }
    const rCal = (cal.d / 2000) * S.hole;
    const rcNew = rCal * S.crater + S.craterE * Math.sqrt(cal.E / 1000) * (1 - cal.frag * 0.3) + cal.frag * 0.006;
    let h = this._near(hit.point, n, surface, rcNew, att);
    const alb = h ? null : (hit.tri != null && this.G.world?.albedoAt?.(hit.tri, [0, 0, 0])) || ALBEDO[style];
    // Dicke eines bestehenden Lochs: kleinste Messung gilt (Folgetreffer liegen leicht versetzt)
    if (h) { thick = Math.min(h.thick, thick); h.thick = thick; }
    const before = h ? h.depth : 0;
    const rest = thick - before;
    // durch ein offenes Loch fliegt jede Kugel (nahe der Lochmitte), sonst entscheidet die Restdicke
    const inOpen = !!(h && h.through && h.pos.distanceTo(hit.point) < h.r * 0.85);
    const passed = inOpen || (thick !== Infinity && pen >= rest - 0.002);
    if (!h) {
      h = this._make(hit.point, n, dir, surface, style, thick, false, alb);
      if (h) this._slope(h, dir);
      if (h && att) h.att = att;
      if (h && hit.object && hit.object.name) h.objName = hit.object.name;
      if (!h) return passed ? { passed, energyLeft: Math.max(0.15, 1 - rest / pen), thick, exitPoint: hit.point.clone().addScaledVector(dir, thick) } : { passed: false, energyLeft: 0, thick };
      h.r = rCal;
      h.rc = Math.min(MAXR[style][1], rcNew);
      h.depth = Math.min(thick, pen * (0.75 + Math.random() * 0.25));
    } else {
      // weitere Kugel in dasselbe Loch: gräbt weiter (Splitter, Zerlegen → breiter statt tiefer), Loch wird breiter
      h.hits++;
      // je tiefer der Kanal im Verhältnis zur eigenen Eindringtiefe, desto weniger gräbt die nächste Kugel (sie trifft
      // die Kanalwand, verformt sich). Treffer auf dieselbe Stelle (30-cm-Hauswand): .50 BMG 1–2, 7,62 × 51 ≈ 8,
      // 5,56 ≈ 25, 9 mm ≈ 200 (Beton) bzw. ≈ 65 (Ziegel 25 cm), Gipswand 2; Holzstamm 50 cm mit 9 mm ≈ 15
      const ratio = h.depth / Math.max(pen, 1e-3);
      const gain = 1 / (1 + (style === 0 ? 0.7 : 0.25) * ratio);
      h.depth = Math.min(thick, h.depth + pen * S.dig * (1 - cal.frag * 0.5) * gain);
      // Vereinigung: die Lochflächen addieren sich (Rand reißt mit: × Wachstum je Werkstoff), die Mitte wandert zum
      // Flächenschwerpunkt, der Krater umschließt alten und neuen Einschlag – gezieltes Dauerfeuer frisst ein großes,
      // zerfetztes Loch statt vieler Ringe übereinander
      // Brocken, den die Kugel am Rand eines Durchschusses herausschlägt (Ziegel, Putz, Bretter): Dauerfeuer frisst die Wand
      const chunk = CHUNK[style] * Math.min(2.2, Math.max(0.5, (cal.E / 1800) ** 0.4)) * (0.7 + 0.6 * Math.random());
      if (h.cut) {
        // Durchbruch: Umriss wächst genau dort, wo die Kugel einschlägt (Garbe → Lochform)
        const c = this._cutLocal(h, hit.point);
        this._addDisc(h, c.x, c.y, Math.max(chunk, rCal * 2.5), this._breachCap(h));
        this._sizeCut(h);
        this._cutDirty = true;
      } else {
        let [mr, mrc] = MAXR[style];
        const dd = h.pos.distanceTo(hit.point);
        let a1 = (rCal * (1 + S.grow * 1.6 * (1 + cal.frag))) ** 2;
        if (this._cutOk(h)) {
          if (dd > h.r * 0.5) a1 = Math.max(a1, chunk * chunk);
          mr = Math.max(mr, this._breachCap(h));
        }
        const a0 = h.r * h.r;
        const w = a1 / (a0 + a1);
        const rcOld = h.rc;
        if (dd > 1e-4) {
          h.pos.lerp(hit.point, w);
          this._syncExit(h);
        }
        h.r = Math.min(mr, Math.sqrt(a0 + a1));
        h.rc = Math.min(mrc, Math.max(rcOld + dd * w, rcNew + dd * (1 - w), h.r * S.crater * 0.75));
      }
    }
    if (passed) h.depth = thick;
    if (backN && !h.backN) h.backN = backN;
    // Holz aus einem Baumstamm: entfernten Querschnitt (Lochbreite × Tiefe) an treefall.js melden
    if (style === 0 && this.G.trees && hit.object && hit.object.name === 'totholz') {
      const rem = 2 * h.r * Math.min(h.depth, thick === Infinity ? h.depth : thick);
      const d = rem - (h._rem || 0);
      h._rem = rem;
      if (d > 0) this.G.trees.onBullet(hit, dir, d * (1 + 0.6 * cal.frag));
    }
    if (h.probed === undefined || h.rc * this._elong(h) > h.probed * 1.4) this._queueProbe(h);
    const wasThrough = h.through;
    h.through = wasThrough || h.depth >= thick - 0.002;
    if (h.through && !wasThrough) {
      this.stats.through++;
      h.behind = this._behind(h.pos.clone().addScaledVector(dir, thick + 0.02), dir);
      // Austrittsloch: auf der Rückseite, größerer Ausbruch (Holz reißt Spreißel heraus, Beton platzt ab)
      this._newExit(h, dir, n, thick, surface, style, att);
    } else if (h.exitHole && h.cut) {
      this._syncExit(h);
      if (h.exitHole.probed === undefined || h.exitHole.rc > h.exitHole.probed * 1.4) this._queueProbe(h.exitHole);
      this._write(h.exitHole);
    } else if (h.exitHole) {
      h.exitHole.r = Math.min(MAXR[style][0] * 1.2, Math.max(h.exitHole.r, h.r * 1.5));
      h.exitHole.rc = Math.min(MAXR[style][1] * 1.3, Math.max(h.exitHole.rc, h.rc * 1.4));
      if (h.exitHole.probed === undefined || h.exitHole.rc * this._elong(h.exitHole) > h.exitHole.probed * 1.4) this._queueProbe(h.exitHole);
      this._write(h.exitHole);
    }
    if (h.att) this._attach(h);
    if (h.exitHole && h.exitHole.att) this._attach(h.exitHole);
    if (!h.cut && h.r >= CUT_MIN_R && this._cutOk(h)) { this._makeCut(h); this._queueProbe(h); }
    // große Löcher/Durchbrüche: Löcher in oder an der Öffnung schweben sonst in der Luft
    if (h.cut || (h.through && h.r >= 0.012 && !h.att)) { this._absorb(h); if (h.exitHole) this._write(h.exitHole); }
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
    if (this._free.length) slot = this._free.pop();
    else if (this.holes.length >= MAX) {
      // ältestes Nicht-Durchschuss-Loch wiederverwenden
      const i = this.holes.findIndex((h) => !h.through);
      const old = this.holes.splice(i >= 0 ? i : 0, 1)[0];
      slot = old.slot;
      if (old.viewSlot != null) this._slots[old.viewSlot] = null;
      old.dead = true;
      if (old.cut) { this._cutDirty = true; this._cutList = this._cutList.filter((h) => !h.dead); }
    } else slot = this._nextSlot++;
    const h = { pos: point.clone(), n: n.clone(), dir: dir.clone(), surface, style, r: 0.005, rc: 0.02, depth: 0.005, thick, through: false, hits: 1, slot, exit, seed: Math.random() * 100, behind: [0.02, 0.02, 0.02], exitHole: null, alb: alb.slice(0, 3) };
    this.holes.push(h);
    if (this.mesh.count < slot + 1) this.mesh.count = this.mesh2.count = slot + 1;
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
    const sl0 = h.slope || [0, 0], sm = Math.hypot(sl0[0], sl0[1]);
    const sk = sm > 1e-5 ? Math.sqrt(Math.max(0, el * el - 1)) / sm : 0; // Schräge passend zur begrenzten Streckung
    const sl = [sl0[0] * sk, sl0[1] * sk];
    // w: Querschläger −2, sonst Durchblick-Feld (−1 = keins → Lichtfarbe)
    g[k * 4] = sl[0]; g[k * 4 + 1] = sl[1]; g[k * 4 + 2] = (h.seed * 7.31) % 1; g[k * 4 + 3] = h.ricochet ? -2 : (h.viewSlot ?? -1);
    // Durchbruch aktiv (Wand im Weltshader ausgeschnitten): Feld in npCut + Seite (0 vorn, 1 Austritt), sonst −1
    const t7 = this.aHole7.array, cutH = h.exit ? h.entry : h;
    const on = !!(cutH && cutH.cutOn && !cutH.dead && cutH.cutSlot >= 0);
    t7[k * 4] = on ? cutH.cutSlot : -1; t7[k * 4 + 1] = h.exit ? 1 : 0; t7[k * 4 + 2] = 0; t7[k * 4 + 3] = 0;
    for (const [attr, w] of [[this.mesh.instanceMatrix, 16], [this.aHole, 4], [this.aHole2, 4], [this.aHole3, 4], [this.aHole4, 4], [this.aHole5, 2], [this.aHole6, 4], [this.aHole7, 4]]) {
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
    // Splitter kommen an: Pocke + kleiner Einschlag (Staub/Funke je Werkstoff)
    if (this._fragQ.length) {
      const fx = this.G.effects;
      for (let i = 0; i < this._fragQ.length; i++) {
        const q = this._fragQ[i];
        if (q.t > this._time) continue;
        this._fragQ.splice(i--, 1);
        this._pock(q.f, q.dir, q.vals);
        if (fx && typeof fx.impact === 'function') {
          const n = q.f.normal.clone(); if (n.dot(q.dir) > 0) n.negate();
          try { fx.impact(q.f.point, n, q.f.surface || 'concrete', { scale: 0.45, hole: true }); } catch { /* Beiwerk */ }
        }
      }
      this.stats.holes = this.holes.length;
    }
    // angeheftete Löcher (Türen) folgen ihrem Objekt; verschwindet es, verschwinden sie mit
    let gone = false;
    for (const h of this.holes) {
      if (!h.att || !h.lp) continue;
      if (!h.att.visible || !h.att.parent) { gone = true; continue; }
      const key = this._objKey(h.att);
      if (key === h._attKey) continue;
      h._attKey = key;
      h.pos.copy(h.lp).applyMatrix4(h.att.matrixWorld);
      h.n.copy(h.ln).transformDirection(h.att.matrixWorld);
      h.dir.copy(h.ld).transformDirection(h.att.matrixWorld);
      this._write(h);
    }
    if (gone) this.removeWhere((h) => h.att && (!h.att.visible || !h.att.parent));
    // Durchbrüche: Auswahl der nächsten alle 0,3 s bzw. sofort bei Änderung
    this._cutT -= dt;
    if (this._cutDirty || (this._cutT <= 0 && this._cutList.length)) { this._cutDirty = false; this._cutT = 0.3; this._uploadCuts(); }
    // Flächenabtastung: bis zu 3 Löcher je Bild, nur im Umkreis von 35 m (ferne bleiben vorgemerkt)
    if (this._probeQ.length) {
      const cp = this.G.camera?.position;
      let done = 0;
      for (let i = 0; i < this._probeQ.length && done < 3; i++) {
        const h = this._probeQ[i];
        if (!h || h.dead) { this._probeQ.splice(i--, 1); continue; }
        if (cp && h.pos.distanceToSquared(cp) > 35 * 35) continue;
        this._probeQ.splice(i--, 1);
        h._pq = false;
        this._probe(h);
        this._write(h);
        done++;
      }
    }
    if (!this._viewOn || !this.view) return;
    this._viewT -= dt;
    if (this._viewT > 0) return;
    const cam = this.G.camera;
    if (!cam) return;
    const cp = cam.position;
    let best = null, bestScore = Infinity;
    for (const h of this.holes) {
      if (!h.through || h.r < 0.005 || h.cutOn || (h.exit && h.entry && h.entry.cutOn)) continue;
      const dx = cp.x - h.pos.x, dy = cp.y - h.pos.y, dz = cp.z - h.pos.z;
      const d = Math.hypot(dx, dy, dz);
      h._camD = d;
      if (h.r / Math.max(d, 0.1) < 0.0016) continue; // auf dem Schirm zu klein für einen Durchblick
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
    this._viewT = 0.22;
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
    const vis = this.mesh.visible, vis2 = this.mesh2.visible;
    try {
      this.mesh.visible = this.mesh2.visible = false; // keine Rückkopplung (Löcher lesen den Atlas)
      sm.autoUpdate = false; sm.needsUpdate = false; // Schattenkarten der Hauptkamera weiterverwenden
      r.autoClear = true;
      r.setRenderTarget(this.view);
      r.render(scene, cam);
    } catch (err) {
      this._viewOn = false; console.warn('[NULLPUNKT] Durchblick aus:', err);
    } finally {
      this.mesh.visible = vis; this.mesh2.visible = vis2;
      sm.autoUpdate = prevAU; sm.needsUpdate = prevNU;
      r.autoClear = prevClear;
      r.setRenderTarget(prevRT);
    }
  }

  /**
   * Messer/Kolben gegen eine Fläche: flache, längliche Kerbe (Holz: Macke mit gestauchten Fasern, Putz/Stein: Abplatzer,
   * Blech: Kratzer, Erde: Schnitt). Rein optisch; Türen (attach) nehmen die Kerbe mit.
   */
  nick(hit, dir, def) {
    if (!hit || !hit.point || hit.targetId != null) return null;
    const surface = hit.surface || 'concrete';
    const style = STYLE[surface];
    if (style === undefined || style === 4) return null;
    const att = hit.solid && hit.solid.attach ? hit.solid.attach : null;
    if (hit.solid && !hit.solid.static && !att) return null;
    const n = _v.copy(hit.normal || dir).normalize().clone();
    if (n.dot(dir) > 0) n.negate();
    const alb = (hit.tri != null && this.G.world?.albedoAt?.(hit.tri, [0, 0, 0])) || ALBEDO[style];
    const h = this._make(hit.point, n, dir, surface, style, (att && hit.solid.thick) || 1, false, alb);
    if (!h) return null;
    const heavy = !!(def && (def.id === 'axt' || def.id === 'machete' || def.id === 'spaten'));
    h.nick = true;
    h.r = 0.0012;
    h.rc = [0.012, 0.007, 0.009, 0.006, 0.006, 0.014, 0.01, 0.007][style] * (heavy ? 1.6 : 1) * (0.85 + Math.random() * 0.3);
    h.depth = [0.006, 0.0015, 0.004, 0.0004, 0, 0.012, 0.003, 0.0018][style] * (heavy ? 1.8 : 1);
    // Schnitt quer zur Klinge: meist waagrecht über die Fläche, etwas schräg
    const phi = (Math.random() - 0.5) * 0.9 + (Math.random() < 0.25 ? Math.PI / 2 : 0);
    const S = heavy ? 3.6 : 3;
    h.slope = [Math.cos(phi) * S, Math.sin(phi) * S];
    h.cos = 0.6;
    if (att) { h.att = att; this._attach(h); }
    this._queueProbe(h);
    this._write(h);
    this.stats.holes = this.holes.length;
    return h;
  }

  /** Löcher entfernen (z. B. am fallenden Stamm, treefall.js): pred(h) → true = weg. */
  removeWhere(pred) {
    const keep = [];
    for (const h of this.holes) {
      if (!pred(h)) { keep.push(h); continue; }
      h.dead = true;
      if (h.cut) this._cutDirty = true;
      if (h.viewSlot != null) this._slots[h.viewSlot] = null;
      _m.makeScale(0, 0, 0).toArray(this.mesh.instanceMatrix.array, h.slot * 16);
      this.mesh.instanceMatrix.addUpdateRange(h.slot * 16, 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this._free.push(h.slot);
    }
    this.holes = keep;
    this.stats.holes = keep.length;
    if (this._cutList.some((h) => h.dead)) this._cutList = this._cutList.filter((h) => !h.dead);
  }

  /** Durchgehendes Loch an dieser Stelle? → Loch oder null. */
  at(p) {
    for (const h of this.holes) if (h.through && !h.exit && h.pos.distanceToSquared(p) < (h.r + 0.02) ** 2) return h;
    return null;
  }

  dispose() {
    for (const off of this._offs || []) off();
    this._offs = [];
    this.holes.length = 0;
    setCutCount(0);
    const W = this.G.world;
    if (W && this._los && W.lineOfSight === this._los) W.lineOfSight = this._los0;
    if (W && this._ray && W.raycast === this._ray) W.raycast = this._rayW0;
    if (this._tci && this._tci.col.triangleCapsuleIntersect === this._tciW) {
      if (this._tci.own) this._tci.col.triangleCapsuleIntersect = this._tci.tci0; else delete this._tci.col.triangleCapsuleIntersect;
    }
    this._cutList = [];
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this.mesh2.parent) this.mesh2.parent.remove(this.mesh2);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh2.material.dispose();
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
attribute vec4 aHole7;
varying vec4 vHole6;
varying vec4 vHole7;
varying vec3 vWX;
varying vec3 vWY;
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
    vClip = aHole4; vK = aHole5; vHole6 = aHole6; vHole7 = aHole7;
    mat4 npIM = modelMatrix * instanceMatrix;
    vWX = npIM[ 0 ].xyz; vWY = npIM[ 1 ].xyz; // Quad-Achsen in der Welt (× Quadgröße) – Durchbruch-Umriss
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
varying vec4 vHole7;
varying vec3 vWX;
varying vec3 vWY;
varying vec3 vPosL;
varying vec3 vCamL;
varying vec3 vTx;
varying vec3 vTy;
varying vec3 vTz;
${CUT_GLSL}
// Durchbruch: Wand ist im Weltshader ausgeschnitten (gleicher Umriss npCutRAt) → Öffnung zeigt die echte Welt
bool npIsCut = false; int npCutI = 0; float npCutF = 0.0, npQ = 1.0;
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
  if ( npIsCut ) return npCutRAt( npCutI, normalize( vWX * u.x + vWY * u.y ), npCutF ) / npQ;
  float jag = ( npSt == 3 ? 0.06 : npSt == 0 ? 0.4 : npSt == 5 ? 0.15 : 0.28 ) * ( 0.7 + 0.6 * npVar );
  vec2 q = npSt == 0 ? vec2( u.x * 0.6, u.y * 2.6 ) : u * 2.2;
  return npR * ( 1.0 + jag * ( npN2( q + npSeed ) - 0.5 ) * 2.0 + jag * 0.7 * ( npN2( u * 7.0 + npSeed * 1.7 ) - 0.5 ) );
}
// Außenkante des Abplatzkraters (0..1 des Quads)
float npEdge( vec2 u ) {
  if ( npIsCut ) return min( 0.97, npHoleR( u ) * 1.1 + ( 0.03 + 0.035 * npN2( u * 3.0 + npSeed * 2.3 ) ) / npQ );
  float e = 0.5 + 0.34 * npN2( u * 1.7 + npSeed * 2.3 ) + 0.14 * npN2( u * 5.0 + npSeed * 0.7 );
  if ( npSt == 0 ) e = npExit ? e : min( mix( npR * 1.3, e, 0.15 ), 0.95 ); // Holz: Eintritt fast sauber, Austritt reißt aus
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
    npIsCut = vHole7.x > -0.5;
    if ( npIsCut ) { npCutI = int( vHole7.x + 0.5 ); npCutF = vHole7.y; npQ = length( vWX ); npS = vec2( 0.0 ); npVar = 0.5; npE = 1.0; npA = vec2( 1.0, 0.0 ); }
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
    bool npDone = false;
#if NP_PASS == 1
    if ( d0 < 1e2 ) discard; // Durchgang 2: nur die Öffnung
    if ( npIsCut ) {
      // Durchbruch: Blickstrahl durch den Kanal (Querschnitt = Umriss, nach hinten aufgeweitet). Kommt er hinten
      // heraus, bleibt die Stelle frei – dort zeigt sich die echte Welt (Wand ausgeschnitten) –, sonst die Bruchwand.
      vec3 dirC = normalize( vPosL - vCamL );
      vec2 dxyC = dirC.xy / max( -dirC.z, 0.08 );
      float zIn = 0.0, zOut = -1.0;
      for ( int i = 1; i <= 14; i++ ) {
        float z = D * float( i ) / 14.0;
        vec2 u = p0 + dxyC * z; float L = length( u );
        float R = L > 1e-5 ? npCutRAt( npCutI, normalize( vWX * u.x + vWY * u.y ), npExit ? 1.0 - z / D : z / D ) / npQ : 1.0;
        if ( L > R ) { zOut = z; break; }
        zIn = z;
      }
      if ( zOut < 0.0 ) discard;
      for ( int j = 0; j < 4; j++ ) {
        float zm = 0.5 * ( zIn + zOut );
        vec2 u = p0 + dxyC * zm; float L = length( u );
        float R = L > 1e-5 ? npCutRAt( npCutI, normalize( vWX * u.x + vWY * u.y ), npExit ? 1.0 - zm / D : zm / D ) / npQ : 1.0;
        if ( L > R ) zOut = zm; else zIn = zm;
      }
      vec2 uw = p0 + dxyC * zOut;
      float k = clamp( zOut / D, 0.0, 1.0 );
      float stri = 0.8 + 0.4 * npN2( vec2( atan( uw.y, uw.x ) * 4.0, zOut * 30.0 ) + npSeed );
      vec3 cc = npCell( uw * 9.0 + vec2( zOut * 11.0 ) + npSeed );
      col = fresh * mix( 0.9, 0.35, k ) * stri * ( 0.85 + 0.3 * cc.y );
      npAO = mix( 0.6, 0.1, k );
      npSun = 0.0;
      npHoleN = vec3( -uw / max( length( uw ), 1e-4 ), 0.25 );
      a = 1.0;
      npDone = true;
    }
#else
    if ( d0 >= 1e2 ) discard; // Durchgang 1: Krater und Rand (Öffnung zeichnet Durchgang 2 darüber)
#endif
    if ( npDone ) {
    } else if ( d0 > 0.0 ) {
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
        if ( npSt == 0 ) col *= mix( 0.55, 0.95, 1.0 - cav ); // Holz: gestauchte, dunkle Fasern, zum Loch hin heller aufgerissen
        // Blech: Delle bleibt lackiert, nur ein schmaler Saum am Loch ist blank abgeplatzt
        if ( npSt == 3 ) {
          float bare = 1.0 - smoothstep( npR * 1.06, npR * 1.45, length( npC( q ) ) );
          col = mix( vHole3.rgb * mix( 0.8, 1.0, cav ), col, bare );
        }
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
          if ( thr > 0.5 && !npIsCut ) npHoleEmit = npThrough( vec3( 0.0, 0.0, -1.0 ) ) * 0.3 * pow( k, 3.0 ); // Licht vom anderen Ende auf der Kanalwand
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
        float dust = ( 1.0 - smoothstep( 0.0, 1.0, rel ) ) * ( 0.35 + 0.65 * n1 ) * ( npSt == 2 ? 0.35 : 0.18 );
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
        // Blech außen: nur feiner Schmauch/Abrieb, kein Ring (die Delle trägt den Lack weiter)
        float soot = ( 1.0 - smoothstep( 0.0, 0.8, rel ) ) * 0.22 * n1;
        a = soot;
        col = vec3( npL * 0.25 );
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
