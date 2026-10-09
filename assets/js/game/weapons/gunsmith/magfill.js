// NULLPUNKT – Magazininhalt: sichtbare Patronen, die mit jedem Schuss weniger werden (der Zubringer steigt nach).
//
// Jede Waffe mit Magazin beschreibt im Bauplan (guns-*.js) per magRounds(b, spec) die Lage ihrer Patronen.
// models.js rechnet daraus feste Plätze (Platz 0 = oberste Patrone an den Zuführlippen) und hängt in der Ego-/
// Vitrinen-Detailstufe EIN InstancedMesh an das Magazin-Teil, dazu einen Zubringer. Pro Schuss ändern sich nur
// mesh.count und die Zubringer-Matrix – keine Allokationen, ein Draw Call für alle Patronen.
// Doppelreihe: die oberste Patrone wechselt mit jedem Schuss die Seite (das Mesh wird an der Magazinmitte gespiegelt).
//
//   spec = {
//     part   Teil, an dem die Patronen hängen ('mag', 'belt', 'cylinder')
//     cal    Kaliber (Schlüssel aus CAL), fit = größte Länge (Patrone wird auf die Magazintiefe gestaucht)
//     path   [[x, v, u], …] Mittellinie der Patronenmitten von den Zuführlippen bis zur untersten Patrone (voll)
//     axis   'u' (Patrone quer zur Bahn, Geschoss nach vorn) | 'x' (seitlich, QX-90)
//     width  Innenbreite (begrenzt das Versetzen der Doppelreihe), depth Innentiefe (Zubringer)
//     pitch  fester Abstand (sonst aus Bahnlänge und Kapazität), spread = n Plätze gleichmäßig auf der Bahn (Gurt)
//     show   'all' (durchsichtig: Rauch-Polymer, Trommelfenster, Gurt) | n oberste Plätze (Stahl: nur an den Lippen)
//     follower false = kein Zubringer, fol = [Breite, Höhe, Tiefe] (sonst aus width/depth)
//     drum   { c: [x, v, u], r0, dr, rmin, a0 } Spirale in der Trommel (Patronen seitlich, Böden zum Fenster)
//     cyl    { c: [x, v, u], R, n, F, u } Revolvertrommel: Geschossspitzen in den Kammern, Platz 0 unter dem Hahn
//     link   Gurtglied je Patrone, neck = Plätze im Trommelhals, stagger false = einreihig (Gurt)
//   }
//
// API: magRounds(b, spec) · magFillFor(b, key) → fill · attachMagFill(root, fill) · setMagRounds(model, n, turn)
//      dropRounds(fill) → { mesh(), set(mesh, n) } (Weltmagazin, Sammelmaterial der Bots, ohne Instanzen)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMat } from './materials.js';
import { WEAPONS } from '../../../shared/weapons.data.js';

// Patronenmaße (m): r = Hülsenboden, len = Gesamtlänge, cl = Hülsenlänge, rn = Hals, rb = Geschoss
export const CAL = {
  r556: { r: 0.0048, len: 0.057, cl: 0.0448, rn: 0.0031, rb: 0.0028, kind: 'bottle' },
  r762k: { r: 0.0056, len: 0.056, cl: 0.0388, rn: 0.0043, rb: 0.0039, kind: 'bottle' },     // 7,62×39
  r308: { r: 0.006, len: 0.071, cl: 0.0512, rn: 0.0044, rb: 0.0039, kind: 'bottle' },
  r338: { r: 0.0074, len: 0.093, cl: 0.0693, rn: 0.0049, rb: 0.0043, kind: 'bottle' },
  r50: { r: 0.0102, len: 0.138, cl: 0.099, rn: 0.0071, rb: 0.0065, kind: 'bottle' },
  p9: { r: 0.0049, len: 0.0295, cl: 0.0192, rn: 0.0048, rb: 0.0045, kind: 'straight' },
  p45: { r: 0.006, len: 0.032, cl: 0.0228, rn: 0.006, rb: 0.0057, kind: 'straight' },
  p57: { r: 0.004, len: 0.0405, cl: 0.0285, rn: 0.0029, rb: 0.0028, kind: 'bottle' },         // 5,7×28
  p50: { r: 0.0068, len: 0.04, cl: 0.0326, rn: 0.0068, rb: 0.0064, kind: 'straight' },
  g12: { r: 0.0105, len: 0.062, cl: 0.062, rn: 0.0105, rb: 0.0105, kind: 'shell' },
  nose357: { r: 0.0046, len: 0.0027, cl: 0, rn: 0.0042, rb: 0.0042, kind: 'nose' },
};
const COL = { brass: 0xc09a45, copper: 0xb8703f, hull: 0x8f1f17, link: 0x3f4146, follower: 0x6b3a1e };

/** Bauplan-Hilfe: Lage der Patronen festhalten (eigenes Feld – b.meta wird am Ende jedes Bauplans ersetzt). */
export function magRounds(b, spec) {
  b.magFill = { part: 'mag', ...spec };
}

// ---------------------------------------------------------------- Geometrie

function calFor(spec) {
  const c = { ...(CAL[spec.cal] || CAL.r556) };
  if (spec.fit && c.len > spec.fit) {
    const k = spec.fit / c.len;
    c.len *= k; c.cl *= k;
    const kr = Math.max(0.8, k);
    c.r *= kr; c.rn *= kr; c.rb *= kr;
  }
  return c;
}

function colored(geo, hex) {
  const col = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

const lathe = (pts, seg, hex) => colored(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg), hex);

const _geoCache = new Map();
/** Eine Patrone (Geschoss zeigt nach −Z, Mitte der Länge im Ursprung; Spitze 'nose': Boden im Ursprung). */
function roundGeometry(c, seg, link) {
  const key = [c.kind, c.r, c.len, c.cl, c.rn, c.rb, seg, link ? 1 : 0].map(v => typeof v === 'number' ? v.toFixed(5) : v).join('|');
  let g = _geoCache.get(key);
  if (g) return g;
  const L = c.len, y0 = -L / 2, parts = [];
  if (c.kind === 'nose') {
    parts.push(lathe([[0, 0], [c.rb, 0], [c.rb, 0.0012], [c.rb * 0.75, 0.0021], [c.rb * 0.35, 0.0026], [0, L]], seg, COL.copper));
  } else if (c.kind === 'shell') {
    // Schrotpatrone: Messingboden mit Rand, rote Hülle, Faltverschluss
    const hb = Math.min(0.012, L * 0.2);
    parts.push(lathe([[0, y0], [c.r * 1.05, y0], [c.r * 1.05, y0 + 0.0016], [c.r, y0 + 0.002], [c.r, y0 + hb]], seg, COL.brass));
    parts.push(lathe([[c.r * 0.99, y0 + hb - 0.0005], [c.r * 0.99, y0 + L - 0.003], [c.r * 0.8, y0 + L - 0.0006], [c.r * 0.3, y0 + L], [0, y0 + L - 0.0012]], seg, COL.hull));
  } else {
    // Hülse: Boden, Auszieherrille, Körper (Flasche: Schulter + Hals), Geschoss mit Ogive
    const cl = c.cl, bottle = c.kind === 'bottle';
    const body = bottle
      ? [[c.r * 0.97, y0 + cl * 0.78], [c.rn, y0 + cl * 0.88], [c.rn, y0 + cl]]
      : [[c.r * 0.985, y0 + cl]];
    parts.push(lathe([[0, y0], [c.r * 0.98, y0], [c.r * 0.98, y0 + 0.0009], [c.r * 0.84, y0 + 0.0013], [c.r * 0.84, y0 + 0.0021], [c.r, y0 + 0.0027], ...body, [c.rb, y0 + cl]], seg, COL.brass));
    const bl = L - cl, b0 = y0 + cl;
    const ogive = bottle
      ? [[c.rb, b0 + bl * 0.3], [c.rb * 0.84, b0 + bl * 0.62], [c.rb * 0.48, b0 + bl * 0.88], [c.rb * 0.12, y0 + L]]
      : [[c.rb, b0 + bl * 0.22], [c.rb * 0.86, b0 + bl * 0.6], [c.rb * 0.5, b0 + bl * 0.9], [c.rb * 0.15, y0 + L]];
    parts.push(lathe([[c.rb * 0.98, b0 - 0.001], ...ogive, [0, y0 + L]], seg, COL.copper));
  }
  for (const p of parts) p.rotateX(-Math.PI / 2);       // +Y (Spitze) → −Z
  if (link) {
    // Gurtglied: Stahlband um die Hülse, Steg zur nächsten Patrone (lokal +X = Gurtseite)
    const lk = colored(new THREE.BoxGeometry(c.r * 0.7, c.r * 2.3, c.len * 0.22), COL.link);
    lk.translate(c.r * 0.9, 0, c.len * 0.18);
    parts.push(lk);
  }
  g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  _geoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- Plätze

const _T = new THREE.Vector3(), _A = new THREE.Vector3(), _D = new THREE.Vector3(), _P = new THREE.Vector3();
const _X = new THREE.Vector3(), _Yv = new THREE.Vector3(), _Z = new THREE.Vector3(), _M = new THREE.Matrix4();
const FWD = new THREE.Vector3(0, 0, -1);

// Matrix einer Patrone: Geschoss entlang A, „oben“ (lokal +Y) möglichst entlang up
function frame(out, i, pos, A, up) {
  _Z.copy(A).negate();
  _Yv.copy(up).addScaledVector(_Z, -up.dot(_Z));
  if (_Yv.lengthSq() < 1e-10) _Yv.set(0, 1, 0).addScaledVector(_Z, -_Z.y);
  _Yv.normalize();
  _X.crossVectors(_Yv, _Z);
  _M.makeBasis(_X, _Yv, _Z).setPosition(pos);
  _M.toArray(out, i * 16);
}

function pathAt(P, cum, s, outP, outT) {
  let k = 0;
  while (k < P.length - 2 && s > cum[k + 1]) k++;
  outT.subVectors(P[k + 1], P[k]).normalize();
  return outP.copy(P[k]).addScaledVector(outT, s - cum[k]);
}

/** Bauplan + Waffendaten → Plätze (Matrizen im Raum des Teils) und Zubringer-Lagen. */
function computeFill(spec, pivot, cap) {
  const c = calFor(spec), d = 2 * c.r;
  const mats = [], fol = [];
  const f = { part: spec.part, cal: c, cap, slots: 0, mats: null, fol: null, folDims: null, mirror: false, step: 0, link: !!spec.link, shell: c.kind === 'shell' };
  const toLocal = ([x, v, u]) => new THREE.Vector3(x, v, -u).sub(pivot);
  const push = (pos, A, up) => { const a = new Float32Array(16); frame(a, 0, pos, A, up); mats.push(a); };

  if (spec.cyl) {
    // Revolver: Kammern im Kreis, Platz i = Kammer, die nach i weiteren Schüssen unter dem Hahn steht
    const { c: cc, R, n, F, u } = spec.cyl, ctr = toLocal([cc[0], cc[1], u]);
    f.step = Math.PI * 2 / n;
    for (let i = 0; i < Math.min(n, cap); i++) {
      const a = F - i * f.step;
      _P.set(ctr.x + Math.cos(a) * R, ctr.y + Math.sin(a) * R, ctr.z);
      push(_P.clone(), FWD, _D.set(Math.cos(a), Math.sin(a), 0));
    }
  } else {
    const P = spec.path.map(toLocal), cum = [0];
    for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + P[k].distanceTo(P[k - 1]));
    // Einführachse (anim/magwell.js): Richtung der Patronenbahn an den Lippen = Achse, entlang der das Magazin im
    // Schacht sitzt (Teilraum, zeigt aus dem Schacht heraus); along = Magazin quer (QX-90, Bahn längs der Waffe)
    if (P.length > 1) { f.axis = new THREE.Vector3().subVectors(P[1], P[0]).normalize().toArray(); f.top = P[0].toArray(); f.along = spec.axis === 'x'; }
    const total = cum[cum.length - 1];
    const nPath = spec.drum ? Math.min(spec.neck ?? 2, cap) : cap;
    let p = spec.pitch ?? (spec.spread ? total / Math.max(1, spec.spread - 1) : nPath > 1 ? Math.min(d, total / (nPath - 1)) : d);
    if (spec.drum) p = spec.pitch ?? d * 0.62;
    let stag = p < d * 0.999 ? Math.sqrt(d * d - p * p) / 2 * 1.02 : 0;
    if (spec.width) stag = Math.min(stag, Math.max(0, spec.width / 2 - c.r));
    if (spec.stagger === false) stag = 0;
    const show = spec.show === 'all' || spec.drum ? nPath : Math.min(nPath, spec.show ?? spec.spread ?? 3);
    let mirror = stag > 0;
    for (let i = 0; i < show; i++) {
      pathAt(P, cum, i * p, _P, _T);
      if (spec.axis === 'x') _A.set(spec.dir ?? 1, 0, 0);
      else _A.copy(FWD).addScaledVector(_T, -FWD.dot(_T)).normalize();
      _D.crossVectors(_T, _A).normalize();
      if (Math.abs(_D.x) < 0.95 || Math.abs(_P.x) > 1e-4) mirror = false;
      _P.addScaledVector(_D, (i % 2 ? 1 : -1) * stag);
      push(_P.clone(), _A, _Yv.copy(_T).negate());
    }
    f.mirror = mirror && !spec.drum;      // Trommel: Spirale nicht spiegeln (Böden zum Fenster)
    // Zubringer: Oberkante unter der untersten Patrone (n = 0: an den Lippen)
    if (spec.follower !== false && !spec.drum) {
      const fh = spec.fol?.[1] ?? 0.007;
      f.folDims = spec.fol || [Math.max(d * 1.4, (spec.width ?? d * 1.8) - 0.002), fh, Math.max(c.len * 0.8, (spec.depth ?? c.len) - 0.004)];
      for (let n = 0; n <= show; n++) {
        pathAt(P, cum, (n - 1) * p + c.r + fh / 2, _P, _T);
        if (spec.axis === 'x') _A.set(spec.dir ?? 1, 0, 0);
        else _A.copy(FWD).addScaledVector(_T, -FWD.dot(_T)).normalize();
        const a = new Float32Array(16);
        frame(a, 0, _P, _A, _Yv.copy(_T).negate());
        fol.push(a);
      }
    }
    if (spec.drum && cap > show) {
      // Trommel: Spirale von außen (am Hals) nach innen, Patronen seitlich (Boden zum Fenster links, −x)
      const { c: cc, r0, dr, rmin, a0 } = spec.drum, ctr = toLocal(cc);
      let a = a0, R = r0;
      while (mats.length < cap && R >= rmin) {
        _P.set(ctr.x, ctr.y + Math.sin(a) * R, ctr.z - Math.cos(a) * R);
        push(_P.clone(), _A.set(1, 0, 0), _D.set(0, Math.sin(a), -Math.cos(a)));
        a += (d * 1.04) / R;
        R = r0 - dr * (a - a0) / (Math.PI * 2);
      }
    }
  }
  f.slots = mats.length;
  f.mats = new Float32Array(f.slots * 16);
  mats.forEach((m, i) => f.mats.set(m, i * 16));
  if (fol.length) { f.fol = new Float32Array(fol.length * 16); fol.forEach((m, i) => f.fol.set(m, i * 16)); }
  return f;
}

let _caps = null;
function dataCap(key) {
  if (!_caps) { _caps = new Map(); for (const d of Object.values(WEAPONS)) if (d && d.model && d.mag > 0 && !_caps.has(d.model)) _caps.set(d.model, d.mag); }
  return _caps.get(key);
}

/** Plätze für den Bauplan b (nach b.build) – null ohne magRounds. Kapazität aus den Waffendaten (def.mag). */
export function magFillFor(b, key) {
  const spec = b.magFill;
  if (!spec) return null;
  const part = b.parts.get(spec.part);
  return computeFill(spec, part ? part.pivot : new THREE.Vector3(), spec.cap ?? dataCap(key) ?? 30);
}

/** Ego/Vitrine: Patronen (InstancedMesh 'rounds') + Zubringer ('follower') an das Teil hängen, voll geladen. */
export function attachMagFill(root, fill) {
  const host = root.getObjectByName(fill.part) || root;
  const mesh = new THREE.InstancedMesh(roundGeometry(fill.cal, 10, fill.link), getMat(fill.shell ? 'roundsShell' : 'rounds'), fill.slots);
  mesh.name = 'rounds';
  mesh.instanceMatrix.array.set(fill.mats);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.noContact = true;    // contact.js: Hände greifen das Magazin, nicht die Patronen
  host.add(mesh);
  if (fill.fol) {
    const fo = new THREE.Mesh(new THREE.BoxGeometry(...fill.folDims), getMat('follower'));
    fo.name = 'follower';
    fo.matrixAutoUpdate = false;
    fo.matrix.fromArray(fill.fol, fill.slots * 16);
    fo.visible = fill.slots >= fill.cap;
    fo.castShadow = false;
    fo.userData.noContact = true;
    host.add(fo);
  }
}

/**
 * Füllstand zeigen: n Patronen im Magazin (mehr Plätze als n bleiben leer, der Zubringer steht unter der untersten).
 * turn = Trommelstellung des Revolvers (rad, wie der Hahn sie weiterdreht). Ohne Änderung keine Arbeit.
 */
export function setMagRounds(model, n, turn = 0) {
  const ud = model && model.userData, mesh = ud && ud.rounds;
  if (!mesh) return;
  const f = ud.magFill;
  if (f.step) mesh.rotation.z = -turn;
  n = n > 0 ? Math.floor(n) : 0;
  if (ud._fillN === n) return;
  ud._fillN = n;
  const k = Math.min(n, f.slots);
  mesh.count = k;
  mesh.visible = k > 0;
  if (f.mirror) mesh.scale.x = n & 1 ? -1 : 1;
  const fo = ud.follower;
  if (fo) {
    fo.visible = n < f.slots || f.slots >= f.cap;
    if (fo.visible) { fo.matrix.fromArray(f.fol, k * 16); fo.matrixWorldNeedsUpdate = true; }
  }
}

// ---------------------------------------------------------------- Weltmagazin (debris.js)

/**
 * Inhalt eines fallen gelassenen Magazins: ein Mesh mit dem Sammelmaterial der Bots (kein neues Programm) und
 * Geometrie-Varianten 0..K (K oberste Patronen; 0 = leerer Zubringer an den Lippen). → { mesh(), set(mesh, n) }
 */
export function dropRounds(fill) {
  const K = Math.min(2, fill.slots), geos = [];
  const one = roundGeometry(fill.cal, 6, fill.link);
  for (let k = 0; k <= K; k++) {
    const list = [];
    for (let i = 0; i < k; i++) list.push(one.clone().applyMatrix4(_M.fromArray(fill.mats, i * 16)));
    if (k === 0 && fill.fol) {
      const fo = colored(new THREE.BoxGeometry(...fill.folDims), COL.follower);
      list.push(fo.applyMatrix4(_M.fromArray(fill.fol, 0)));
    }
    const g = list.length ? (list.length === 1 ? list[0] : mergeGeometries(list, false)) : null;
    if (list.length > 1) list.forEach(x => x.dispose());
    if (g) g.computeBoundingSphere();
    geos.push(g);
  }
  return {
    mesh() {
      const m = new THREE.Mesh(geos[K] || geos[0] || one, getMat('lodMetal'));
      m.name = 'fx-rounds';
      m.castShadow = false;
      return m;
    },
    set(mesh, n) {
      if (!mesh) return;
      const g = geos[Math.min(K, Math.max(0, Math.floor(n) || 0))];
      mesh.visible = !!g;
      if (g) mesh.geometry = g;
    },
  };
}

/**
 * Eine einzelne Patrone als Mesh (anim/chamber.js: Patrone im Patronenlager, beim Kammer-Check im Auswurffenster
 * sichtbar). cal = Kaliber-Schlüssel aus CAL oder ein Kaliber-Objekt (fill.cal); Geschoss zeigt nach −Z.
 */
export function roundMesh(cal = 'r556') {
  const c = typeof cal === 'string' ? (CAL[cal] || CAL.r556) : cal;
  const m = new THREE.Mesh(roundGeometry(c, 12, false), getMat(c.kind === 'shell' ? 'roundsShell' : 'rounds'));
  m.name = 'chamber-round';
  m.castShadow = false; m.receiveShadow = false;
  m.userData.noContact = true;
  return m;
}

/** Gecachte Patronen-Geometrien freigeben (disposeWeaponModels). */
export function disposeMagFill() {
  for (const g of _geoCache.values()) g.dispose();
  _geoCache.clear();
}
