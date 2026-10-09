// NULLPUNKT – Ego-Ansicht: Magazinschacht als harter Körper (Animationen 09.10.).
//
// Je Waffenmodell wird aus den Modelldaten bestimmt, entlang welcher Achse das Magazin im Schacht sitzt und wie weit
// es herausgezogen werden muss, bis seine Oberkante den Schacht (Gehäuse, Griff, Schaft) vollständig verlassen hat:
//   axis  Einführachse im Modellraum (Einheitsvektor, zeigt AUS dem Schacht) – aus der Patronenbahn an den Lippen
//         (magfill.js f.axis), sonst nach unten; Sonderfälle mit Begründung in OVERRIDE
//   clear Freigang (m): Weg entlang der Achse, ab dem kein Teil des Magazins mehr im Schacht steckt – aus den
//         Dreiecken des Gehäuses, die um den Querschnitt des Magazins liegen (tiefster Punkt des Schachts)
// magOffset() setzt daraus den Teilversatz zusammen: bis zum Freigang NUR Bewegung entlang der Achse (kein Kippen,
// kein seitliches Gleiten durch die Schachtwände), danach darf die Hand das Magazin frei führen. Gleiches beim
// Einsetzen: die Ausrichtung ist abgeschlossen, bevor die Oberkante den Schacht erreicht.
import * as THREE from 'three';
import { clamp, smooth } from '../gunsmith/anim.js';

// Sonderfälle (Modellraum): Achse, zusätzlicher Freigang
const OVERRIDE = {
  // QX-90: Magazin liegt quer oben auf dem Gehäuse UNTER der Visierbrücke – es kann nicht senkrecht abgehoben werden,
  // sondern gleitet erst nach hinten, bis seine Vorderkante hinter der Brücke liegt (Freigang aus der Geometrie)
  qx90: { axis: [0, 0, 1], margin: [0.004, 0.004, -0.003, 0.004] },
  // HM-60: Gurtkasten hängt seitlich an der Halterung links unter dem Gehäuse – nach unten abziehen
  hm60: { axis: [0, -1, 0] },
};
const _cache = new Map();
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** Schachtdaten eines Modell-Eintrags (viewmodel _getModel: { key, model, ud }) – je Modellschlüssel einmal berechnet. */
export function magWellOf(entry) {
  if (!entry) return null;
  if (entry.mw !== undefined) return entry.mw;
  let mw = _cache.get(entry.key);
  if (mw === undefined) {
    try { mw = compute(entry); } catch (err) { console.warn('[anim] Magazinschacht', entry.key, err); mw = null; }
    _cache.set(entry.key, mw);
  }
  entry.mw = mw;
  return mw;
}

function meshVerts(root, filter, inv, out, stride = 1) {
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.noContact || !filter(o)) return;
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i += stride) out.push(_v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
}

function compute(entry) {
  const { model, ud, key } = entry;
  const mag = ud.parts && ud.parts.mag;
  if (!mag) return null;
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const ov = OVERRIDE[key] || {};
  const f = ud.magFill;
  const axL = ov.axis || (f && f.part === 'mag' && f.axis && !f.along ? f.axis : [0, -1, 0]);
  // Achse im Modellraum (Teil in Ruhelage; Teile hängen am Modell oder an einem Teil ohne Drehung)
  const qm = new THREE.Quaternion();
  mag.updateWorldMatrix(true, false);
  new THREE.Matrix4().multiplyMatrices(inv, mag.matrixWorld).decompose(_v, qm, _a);
  const axis = new THREE.Vector3().fromArray(axL).applyQuaternion(ov.axis ? new THREE.Quaternion() : qm).normalize();
  // Querschnitt-Basis
  const e1 = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  e1.addScaledVector(axis, -e1.dot(axis)).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  // Magazinpunkte (ohne Gurt – der hängt beim HM-60 als eigenes Teil am Kasten und wird beim Wechsel ausgeblendet)
  const mv = [];
  const belt = ud.parts.belt || null;
  const underBelt = (o) => { for (let p = o; p && p !== mag; p = p.parent) if (p === belt) return true; return false; };
  meshVerts(mag, o => !underBelt(o), inv, mv);
  if (!mv.length) return null;
  let top = Infinity;
  for (const p of mv) top = Math.min(top, p.dot(axis));
  // Querschnitt der oberen 35 mm (der Teil, der im Schacht steckt), 4 mm Rand für die Schachtwände
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of mv) {
    if (p.dot(axis) > top + 0.035) continue;
    const s = p.dot(e1), t = p.dot(e2);
    a0 = Math.min(a0, s); a1 = Math.max(a1, s); b0 = Math.min(b0, t); b1 = Math.max(b1, t);
  }
  // (QX-90: unten kein Rand – das Magazin liegt AUF dem Gehäuse und gleitet darauf, nur die Brücke darüber zählt)
  const M = ov.margin || [0.004, 0.004, 0.004, 0.004];
  a0 -= M[0]; a1 += M[1]; b0 -= M[2]; b1 += M[3];
  // Gehäuse-Dreiecke (statisch) abtasten: tiefster Punkt des Schachts innerhalb des Querschnitts
  let bottom = top;
  model.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.parent !== model || o.userData.noContact) return;
    const mat = o.material;
    if (!mat || mat.transparent || mat.visible === false) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      _a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      _b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      _c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      // Grobtest: Dreieck neben dem Querschnitt oder ganz über der Magazinoberkante
      const sa = _a.dot(e1), sb = _b.dot(e1), sc = _c.dot(e1), ta = _a.dot(e2), tb = _b.dot(e2), tc = _c.dot(e2);
      if (Math.max(sa, sb, sc) < a0 || Math.min(sa, sb, sc) > a1 || Math.max(ta, tb, tc) < b0 || Math.min(ta, tb, tc) > b1) continue;
      const pa = _a.dot(axis), pb = _b.dot(axis), pc = _c.dot(axis);
      if (Math.max(pa, pb, pc) <= bottom) continue;
      const len = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
      const k = clamp(Math.ceil(len / 0.003), 1, 24);
      for (let u = 0; u <= k; u++) for (let w = 0; w <= k - u; w++) {
        const x = u / k, y = w / k, z = 1 - x - y;
        const s = sa * x + sb * y + sc * z, t = ta * x + tb * y + tc * z;
        if (s < a0 || s > a1 || t < b0 || t > b1) continue;
        const p = pa * x + pb * y + pc * z;
        if (p > bottom) bottom = p;
      }
    }
  });
  const clear = Math.max(0.008, bottom - top + 0.004);
  return { axis, clear, depth: bottom - top, key };
}

/**
 * Teilversatz [dx, dy, dz, rx, ry, rz] des Magazins (Elternraum = Modellraum): s = Weg entlang der Achse (m, ≥ 0 =
 * heraus). free = freie Führung nach dem Freigang (Versatz + Drehung um den Drehpunkt des Teils), wird erst ab
 * s ≥ clear eingeblendet (12 mm Übergang) – im Schacht bleibt nur die Achsbewegung.
 */
export function magOffset(mw, s, free, out = [0, 0, 0, 0, 0, 0]) {
  const ax = mw ? mw.axis : null;
  s = Math.max(0, s);
  const g = mw && free ? smooth(clamp((s - mw.clear) / 0.012, 0, 1)) : free ? 1 : 0;
  out[0] = (ax ? ax.x * s : 0) + (free ? free[0] * g : 0);
  out[1] = (ax ? ax.y * s : -s) + (free ? free[1] * g : 0);
  out[2] = (ax ? ax.z * s : 0) + (free ? free[2] * g : 0);
  out[3] = free ? (free[3] || 0) * g : 0;
  out[4] = free ? (free[4] || 0) * g : 0;
  out[5] = free ? (free[5] || 0) * g : 0;
  return out;
}
