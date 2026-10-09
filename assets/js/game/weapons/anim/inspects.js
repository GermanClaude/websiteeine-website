// NULLPUNKT – Ego-Ansicht: Inspizieren, vier Varianten je Waffenmechanik (Animationen 09.10., Wunsch des Besitzers).
//
//  Gewehr/MP (Magazin + Spannhebel)  magazin · kammer (Press-Check am Spannhebel) · seite · optik
//  Pistole                           magazin · kammer (Schlitten wie bei SCP: Secret Laboratory ein Stück zurück) · seite · visier
//  Repetierer                        kammer (Kammerstängel auf, ins Lager schauen, zu) · magazin · optik · seite
//  Vorderschaftrepetierer (Flinte)   kammer (Pumpe halb zurück) · roehre (Ladeöffnung) · seite · visier
//  MG mit Gurt                       deckel (Zuführdeckel lüften, Gurt) · kasten · kammer · seite
//  MG mit Trommel                    trommel (Sichtfenster) · kammer · seite · optik
//  Revolver                          trommel (ausschwenken, drehen, einklappen) · kammern · seite · visier
//  Panzerfaust, Messer               eigene (2 bzw. 3)
// Reihenfolge = Durchlauf beim wiederholten Drücken; nach 8 s Pause beginnt er wieder vorn – die erste Variante ist
// immer die, die den Munitionsstand zeigt (Spielstil Realistisch: Munition nur durch Inspizieren, ui/hud.js).
//
// Ablesen (this.readout): sobald die Patronen sichtbar sind, setzt die Animation eine ehrliche Schätzung
// { kind: 'mag'|'chamber'|'cylinder'|'belt'|'tube'|'drum', rounds, cap, chambered, reserve, seq } – das HUD macht Text
// daraus. Kammer-Check: eine Patrone liegt sichtbar im Auswurffenster, wenn eine im Lager ist (anim: _chamberShow).
import * as THREE from 'three';
import { curve, windowW, clamp, smooth } from '../gunsmith/anim.js';
import { roundMesh, CAL } from '../gunsmith/magfill.js';
import { magWellOf, magOffset } from './magwell.js';
import { req, COSMETIC } from './reloads.js';

const Z3 = [0, 0, 0];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _f = [0, 0, 0, 0, 0, 0];

/** Mechanik einer Handhabung (gunsmith/handling.js) für die Inspektionsliste. */
export function inspectMech(h) {
  if (h.action === 'knife') return 'knife';
  if (h.reload === 'rocket') return 'launcher';
  if (h.action === 'revolver') return 'revolver';
  if (h.action === 'pistol') return 'pistol';
  if (h.action === 'bolt') return 'bolt';
  if (h.action === 'pump') return 'pump';
  if (h.reload === 'belt') return 'belt';
  if (h.reload === 'drum') return 'drum';
  return 'rifle';
}

// Varianten je Mechanik: Name + Dauerfaktor (× handling.inspect)
export const INSPECTS = {
  rifle: [['magazin', 1.0], ['kammer', 0.85], ['seite', 1.0], ['optik', 0.9]],
  pistol: [['magazin', 1.05], ['kammer', 0.9], ['seite', 1.0], ['visier', 0.9]],
  bolt: [['kammer', 1.0], ['magazin', 1.0], ['optik', 0.9], ['seite', 1.0]],
  pump: [['kammer', 0.9], ['roehre', 0.95], ['seite', 1.0], ['visier', 0.9]],
  belt: [['deckel', 1.0], ['kasten', 0.9], ['kammer', 0.85], ['seite', 1.0]],
  drum: [['trommel', 0.95], ['kammer', 0.85], ['seite', 1.0], ['optik', 0.9]],
  revolver: [['trommel', 1.0], ['kammern', 1.0], ['seite', 1.0], ['visier', 0.9]],
  launcher: [['rohr', 1.0], ['seite', 0.9]],
  knife: [['drehen', 1.0], ['klinge', 0.9], ['wirbel', 0.85]],
};

// Waffenlagen (r: Nicken + = Mündung hoch, Gieren + = Mündung links, Rollen + = rechte Seite hoch; p: Kameraraum).
// Die Kamera sieht die Hüftwaffe von links hinten: für die RECHTE Seite (Auswurffenster, Spannhebel rechts) dreht die
// Mündung nach rechts (Gieren −) und die Waffe rollt etwas auf, für die linke Seite rollt sie im Uhrzeigersinn.
const RIGHT_R = [0.15, -1.12, 0.32], RIGHT_P = [-0.12, 0.055, 0.02];
const LEFT_R = [0.2, -0.12, -0.62], LEFT_P = [-0.05, 0.035, 0.04];

export const INSPECT_ACTIONS = {
  /** Inspizieren starten: variant = Index der Liste (sonst Durchlauf; nach 8 s Pause wieder die erste). */
  playInspect(variant) {
    if (!this.cur || (this.action && !COSMETIC.has(this.action.type))) return;
    const mech = inspectMech(this.h);
    const list = INSPECTS[mech];
    let i;
    if (Number.isFinite(variant)) i = ((variant % list.length) + list.length) % list.length;
    else {
      const st = this._inspCycle || (this._inspCycle = new Map());
      const prev = st.get(this.weaponId);
      i = prev && this._time - prev.t < 8 ? (prev.i + 1) % list.length : 0;
    }
    (this._inspCycle || (this._inspCycle = new Map())).set(this.weaponId, { i, t: this._time });
    const [name, k] = list[i];
    // Fensterboden für die Kammer-Patrone in Ruhelage suchen (einmal je Modell)
    if (name === 'kammer' && this.cur.chamber === undefined) this.cur.chamber = this._chamberProbe(this.cur);
    this._start('inspect', (this.h.inspect || 3) * k, { mech, name, variant: i });
  },

  /** Inspektions-Choreografie (Dispatcher). */
  _actInspectV(A, out) {
    const u = clamp(A.t / A.dur, 0, 1);
    const n = A.name;
    let done;
    switch (A.mech) {
      case 'knife': done = n === 'drehen' ? this._actInspectStyle(A, out, 'knife') : this._inspKnife(A, out, u, n); break;
      case 'launcher': done = n === 'rohr' ? this._actInspectStyle(A, out, 'launcher') : this._inspSide(A, out, u, 0.8); break;
      case 'revolver':
        if (n === 'trommel') { done = this._actInspectStyle(A, out, 'revolver'); if (u > 0.3) this._setReadout(A, 'cylinder'); }
        else if (n === 'kammern') done = this._inspCylinderLook(A, out, u);
        else if (n === 'seite') done = this._inspSide(A, out, u, 0.85);
        else done = this._inspSights(A, out, u, true);
        break;
      default:
        if (n === 'magazin') done = this._inspMag(A, out, u);
        else if (n === 'kammer') done = this._inspChamber(A, out, u);
        else if (n === 'seite') done = this._inspSide(A, out, u, A.mech === 'pistol' ? 0.85 : 1);
        else if (n === 'optik' || n === 'visier') done = this._inspSights(A, out, u, A.mech === 'pistol');
        else if (n === 'roehre') done = this._inspTube(A, out, u);
        else if (n === 'deckel') done = this._inspCover(A, out, u);
        else if (n === 'kasten') done = this._inspBox(A, out, u);
        else if (n === 'trommel') done = this._inspDrum(A, out, u);
        else done = u >= 1;
    }
    // Kammer-Patrone nur im Kammer-Check sichtbar
    if (n !== 'kammer') this._chamberShow(0);
    return done;
  },

  // ---------------------------------------------------------------- Ablesen

  /** Munitionsstand für das HUD festhalten (einmal je Inspektion und Art). */
  _setReadout(A, kind) {
    const key = 'ro:' + kind;
    if (A[key]) return;
    A[key] = true;
    const w = this.G?.player?.weapon, st = w && w.viewModel === this ? w.current : null;
    const rounds = this._magRaw ?? this.def?.mag ?? 0, cap = this.def?.mag ?? 0;
    this._readoutSeq = (this._readoutSeq || 0) + 1;
    this.readout = {
      kind, rounds, cap, seq: this._readoutSeq, weaponId: this.weaponId, at: this._time,
      chambered: rounds > 0, reserve: st ? st.reserve : null, infinite: !!(w && w.infiniteAmmo),
      perShell: !!this.def?.perShellReload, belt: this.h.reload === 'belt', cylinder: this.h.action === 'revolver',
    };
  },

  // ---------------------------------------------------------------- Bausteine

  /** Seite zeigen: links (Waffe im Uhrzeigersinn gerollt), dann rechts mit Auswurffenster. k = Ausschlag. */
  _inspSide(A, out, u, k = 1) {
    const pist = this.h.action === 'pistol' || this.h.action === 'revolver';
    const L = pist ? [0.2, 0.1, -0.75] : LEFT_R, Rr = pist ? [0.3, -0.95, 0.3] : [0.12, -1.05, 0.3];
    const PL = pist ? [-0.04, 0.05, 0.06] : LEFT_P, PR = pist ? [-0.08, 0.06, 0.05] : [-0.11, 0.05, 0.02];
    const sc = (a) => a.map(v => v * k);
    curve(u, [[0, Z3], [0.14, sc(L)], [0.42, sc(L.map((v, i) => v * (i === 2 ? 1.06 : 1.1)))], [0.58, sc(Rr)], [0.84, sc(Rr.map(v => v * 1.06))], [1, Z3]], out.r);
    curve(u, [[0, Z3], [0.14, PL], [0.42, PL], [0.58, PR], [0.84, PR], [1, Z3]], out.p);
    // Pistole/Revolver: Stützhand lässt los (sonst schiebt sich der Unterarm quer durchs Bild), einhändig drehen
    if (pist) req(out.left, windowW(u, 0.04, 0.16, 0.84, 0.96), { free: [[-0.13, -0.33, -0.27], [0.25, 0.75, -0.6], [-0.75, 0.3, 0.35], 'relaxed'] });
    // Stützhand fasst in der ersten Hälfte das Magazin (Gewehre)
    const mg = this.cur.ud.anchors.magGrab;
    const wm = windowW(u, 0.04, 0.16, 0.4, 0.54);
    if (!pist && mg && wm > 0 && this.h.reload !== 'top' && this.h.reload !== 'belt' && this.h.reload !== 'drum' && this.h.reload !== 'rocket') req(out.left, wm, { anchor: mg, style: 'mag' });
    return u >= 1;
  },

  /**
   * Magazin-Check: Stützhand zieht das Magazin entlang der Schachtachse heraus (über den Freigang, damit die
   * Patronen an den Lippen sichtbar werden), kippt es zur Kamera, setzt es entlang der Achse wieder ein (Ruck).
   * QX-90 (oben, durchsichtig): Waffe kippen und ins Magazin schauen; Trommel: _inspDrum.
   */
  _inspMag(A, out, u) {
    const ud = this.cur.ud, an = ud.anchors, style = this.h.reload;
    const pist = style === 'pistol' || style === 'gripmag';
    if (style === 'top') {
      curve(u, [[0, Z3], [0.16, [0.42, 0.3, 0.55]], [0.7, [0.46, 0.34, 0.6]], [0.88, Z3]], out.r);
      curve(u, [[0, Z3], [0.16, [-0.05, -0.02, 0.06]], [0.7, [-0.05, -0.02, 0.06]], [0.88, Z3]], out.p);
      const w = windowW(u, 0.14, 0.26, 0.6, 0.72);
      if (w > 0 && an.magGrab) req(out.left, w, { anchor: an.magGrab, style: 'magTop' });
      if (u > 0.35) this._setReadout(A, 'mag');
      return u >= 1;
    }
    const mw = magWellOf(this.cur);
    const R = pist ? [0.34, 0.2, -0.4] : [0.18, 0.18, -0.48], P = pist ? [-0.035, 0.06, 0.04] : [-0.045, 0.045, 0.05];
    curve(u, [[0, Z3], [0.13, R], [0.72, R.map(v => v * 1.06)], [0.9, Z3]], out.r);
    curve(u, [[0, Z3], [0.13, P], [0.72, P], [0.9, Z3]], out.p);
    out.frame = windowW(u, 0.06, 0.18, 0.68, 0.84);
    const clear = mw ? mw.clear : 0.03;
    const s = curve(u, [[0.22, 0], [0.33, clear + 0.008], [0.38, clear + 0.025], [0.58, clear + 0.025], [0.64, clear + 0.008], [0.74, 0]]);
    // nach dem Freigang: Oberkante zur Kamera kippen
    const tw = windowW(u, 0.33, 0.42, 0.54, 0.62);
    for (let i = 0; i < 6; i++) _f[i] = 0;
    _f[3] = 0.55 * tw; _f[5] = -0.25 * tw; _f[0] = -0.01 * tw;
    out.parts.mag = magOffset(mw, s, _f, A._mo || (A._mo = [0, 0, 0, 0, 0, 0]));
    if (u > 0.74 && !A.slapped) { A.slapped = true; this._jolt.kick(1.0, 0, 0); this._recoilPos.kick(0, 0.003, 0); }
    const wm = windowW(u, 0.08, 0.2, 0.74, 0.84);
    if (wm > 0) req(out.left, wm, an.magGrab ? { anchor: an.magGrab, style: 'mag' } : { part: 'mag', style: 'mag' });
    if (u > 0.42) this._setReadout(A, 'mag');
    return u >= 1;
  },

  /**
   * Kammer-Check: Spannhebel/Schlitten/Kammerstängel/Pumpe ein Stück zurück, Auswurffenster zur Kamera – liegt eine
   * Patrone im Lager, ist sie im Fenster zu sehen (_chamberShow); loslassen, Verschluss läuft vor (Ruck).
   */
  _inspChamber(A, out, u) {
    const ud = this.cur.ud, an = ud.anchors, h = this.h;
    const open = curve(u, [[0.24, 0], [0.34, 1], [0.58, 1], [0.66, 0]]);
    let R = RIGHT_R, P = RIGHT_P;
    if (h.action === 'pistol') { R = [0.55, -0.55, 0.35]; P = [-0.08, 0.07, 0.05]; }   // Mündung hoch: Oberseite + rechts zur Kamera
    else if (h.action === 'pump') { R = [0.3, -0.5, 1.15]; P = [-0.09, 0.05, 0.03]; }   // aufgerollt: Stützhand bleibt an der Pumpe
    else if (h.action === 'bolt') { R = [0.35, -0.2, 1.3]; P = [-0.07, 0.05, 0.02]; }   // Mündung bleibt vorn: Stützhand am Vorderschaft
    else if (h.reload === 'top') { R = [0.5, 0.1, -1.6]; P = [-0.05, 0.03, -0.08]; }  // QX-90: Auswurf unten → Unterseite zur Kamera
    curve(u, [[0, Z3], [0.16, R], [0.74, R.map(v => v * 1.05)], [0.9, Z3]], out.r);
    curve(u, [[0, Z3], [0.16, P], [0.74, P], [0.9, Z3]], out.p);
    if (h.action === 'pistol' && an.slideGrab) {
      const travel = an.slideGrab.userData.travel?.[2] ?? 0.03;
      out.parts.slide = [0, 0, travel * 0.4 * open];
      const w = windowW(u, 0.12, 0.24, 0.6, 0.72);
      if (w > 0) req(out.left, w, { anchor: an.slideGrab, style: 'pinchSide' });
    } else if (h.action === 'bolt' && an.boltGrab) {
      const bg = an.boltGrab, rot = bg.userData.rot ?? 1.05, travel = bg.userData.travel?.[2] ?? 0.09;
      const up = curve(u, [[0.2, 0], [0.28, 1], [0.62, 1], [0.7, 0]]), back = curve(u, [[0.28, 0], [0.36, 0.3], [0.56, 0.3], [0.62, 0]]);
      out.parts.boltHandle = [0, 0, travel * back, 0, 0, rot * up];
      const w = windowW(u, 0.1, 0.2, 0.68, 0.78);
      if (w > 0) req(out.right, w, { anchor: bg, style: 'boltKnob' });
    } else if (h.action === 'pump' && an.pumpGrab) {
      const travel = an.pumpGrab.userData.travel?.[2] ?? 0.085;
      out.parts.pump = [0, 0, travel * 0.32 * open];
    } else if (an.chargeGrab) {
      const ch = an.chargeGrab, st = ch.userData.style || 'pull', travel = ch.userData.travel || [0, 0, 0.06];
      const name = ch.parent?.name || 'charge';
      const k = 0.4 * open;
      out.parts[name] = [travel[0] * k, travel[1] * k, travel[2] * k, 0, 0, 0];
      if (name !== 'bolt' && this._part('bolt') && h.action !== 'bolt') out.parts.bolt = [0, 0, (h.boltTravel || 0.03) * open];
      const right = st === 'right';
      const w = windowW(u, 0.12, 0.24, 0.62, 0.74);
      if (w > 0) req(right ? out.right : out.left, w, { anchor: ch, style: right ? 'pinchRight' : 'pinchSide' });
      this._chargeReach(out, w);
    }
    this._chamberShow(open);
    if (u > 0.66 && !A.slapped) { A.slapped = true; this._jolt.kick(0.7, 0.2, 0); }
    if (u > 0.4) this._setReadout(A, 'chamber');
    return u >= 1;
  },

  /** Visier/Optik ansehen: Waffe nah ans Gesicht, schräg von der Seite auf die Visierung, dann über die Oberseite. */
  _inspSights(A, out, u, pistol) {
    const R1 = pistol ? [0.5, 0.25, -0.3] : [0.34, 0.22, -0.28], R2 = pistol ? [-0.1, 0.55, 0.45] : [-0.12, 0.5, 0.4];
    const P1 = pistol ? [-0.07, 0.07, 0.09] : [-0.07, 0.06, 0.1], P2 = pistol ? [-0.06, 0.05, 0.07] : [-0.08, 0.04, 0.08];
    curve(u, [[0, Z3], [0.18, R1], [0.42, R1.map(v => v * 1.08)], [0.62, R2], [0.84, R2.map(v => v * 1.05)], [1, Z3]], out.r);
    curve(u, [[0, Z3], [0.18, P1], [0.42, P1], [0.62, P2], [0.84, P2], [1, Z3]], out.p);
    return u >= 1;
  },

  /**
   * Flinte (Röhrenmagazin): Waffe gekantet und angehoben, Stützhand gleitet von der Pumpe nach vorn an die Kappe des
   * Röhrenmagazins und prüft die Federspannung (Schätzung „Röhre: …“), dann zurück an die Pumpe.
   */
  _inspTube(A, out, u) {
    curve(u, [[0, Z3], [0.18, [0.22, 0.2, -0.55]], [0.7, [0.24, 0.22, -0.6]], [0.9, Z3]], out.r);
    curve(u, [[0, Z3], [0.18, [-0.04, 0.04, 0.0]], [0.7, [-0.04, 0.04, 0.0]], [0.9, Z3]], out.p);
    const cap = this._tubeCap();
    const w = windowW(u, 0.14, 0.3, 0.6, 0.76);
    if (w > 0 && cap) req(out.left, w, { anchor: cap, style: 'under', data: cap.userData });
    if (u > 0.42 && !A.tapped) { A.tapped = true; this._jolt.kick(0.35, 0, 0); }
    if (u > 0.4) this._setReadout(A, 'tube');
    return u >= 1;
  },

  /** Anker an der Kappe des Röhrenmagazins (vorderes Ende unter dem Lauf, aus Mündung und Pumpengriff abgeleitet). */
  _tubeCap() {
    const e = this.cur;
    if (e.tubeCap !== undefined) return e.tubeCap;
    const an = e.ud.anchors, mz = e.ud.muzzle, pg = an.pumpGrab;
    if (!pg || !mz) return (e.tubeCap = null);
    e.model.updateMatrixWorld(true);
    const inv = _m.copy(e.model.matrixWorld).invert();
    const m = mz.getWorldPosition(_v).applyMatrix4(inv), p = pg.getWorldPosition(_v2).applyMatrix4(inv);
    const o = new THREE.Object3D();
    o.name = 'tubeCap';
    // Röhre: Mitte zwischen Lauf und Pumpengriff, Kappe 6 cm hinter der Mündung; Anker an der Unterseite (Griff 'under')
    o.position.set(0, p.y + (m.y - p.y) * 0.45 - 0.0125, m.z + 0.06);
    o.userData = { r: 0.0125 };
    e.model.add(o);
    return (e.tubeCap = o);
  },

  /** MG: Zuführdeckel mit der Schusshand lüften (Gurt sichtbar), schließen (Ruck); Waffe zur Kamera gedreht. */
  _inspCover(A, out, u) {
    curve(u, [[0, Z3], [0.14, [0.16, 0.42, 0.3]], [0.66, [0.18, 0.44, 0.32]], [0.86, Z3]], out.r);
    curve(u, [[0, Z3], [0.14, [-0.01, -0.03, -0.02]], [0.66, [-0.01, -0.03, -0.02]], [0.86, Z3]], out.p);
    out.parts.cover = [0, 0, 0, curve(u, [[0.2, 0], [0.3, -0.6], [0.5, -0.6], [0.58, 0]]), 0, 0];
    if (u > 0.58 && !A.slapped) { A.slapped = true; this._jolt.kick(1.0, 0, 0); }
    const w = windowW(u, 0.1, 0.2, 0.56, 0.66);
    if (w > 0 && this._part('cover')) req(out.right, w, { part: 'cover', style: 'boltKnob', offset: [0.004, 0.03, 0.236] });
    if (u > 0.32) this._setReadout(A, 'belt');
    return u >= 1;
  },

  /** MG-Gurtkasten: Waffe gekippt, Stützhand hebt den Kasten an (Gewicht schätzen) und klopft dagegen. */
  _inspBox(A, out, u) {
    const ud = this.cur.ud, an = ud.anchors, mw = magWellOf(this.cur);
    curve(u, [[0, Z3], [0.16, [0.14, -0.2, -0.55]], [0.72, [0.16, -0.22, -0.6]], [0.9, Z3]], out.r);
    curve(u, [[0, Z3], [0.16, [-0.04, 0.05, 0.05]], [0.72, [-0.04, 0.05, 0.05]], [0.9, Z3]], out.p);
    out.frame = 0.7 * windowW(u, 0.1, 0.22, 0.66, 0.84);
    // Anheben bleibt unter dem Freigang (Kasten hängt an der Halterung)
    const lift = (mw ? Math.min(mw.clear * 0.5, 0.005) : 0.004) * (windowW(u, 0.3, 0.36, 0.4, 0.46) - 0.6 * windowW(u, 0.48, 0.52, 0.54, 0.58));
    out.parts.mag = magOffset(mw, Math.max(0, -lift), null, A._mo || (A._mo = [0, 0, 0, 0, 0, 0]));
    const w = windowW(u, 0.1, 0.22, 0.64, 0.76);
    if (w > 0 && an.magGrab) req(out.left, w, { anchor: an.magGrab, style: 'mag' });
    if (u > 0.53 && !A.tapped) { A.tapped = true; this._jolt.kick(0.4, 0, 0); }
    if (u > 0.4) this._setReadout(A, 'belt');
    return u >= 1;
  },

  /** Trommelmagazin: Waffe auf die Seite, Sichtfenster der Trommel zur Kamera, Hand klopft auf die Trommel. */
  _inspDrum(A, out, u) {
    const an = this.cur.ud.anchors;
    curve(u, [[0, Z3], [0.16, [0.24, 0.05, -0.6]], [0.7, [0.26, 0.06, -0.64]], [0.88, Z3]], out.r);
    curve(u, [[0, Z3], [0.16, [-0.04, 0.05, 0.05]], [0.7, [-0.04, 0.05, 0.05]], [0.88, Z3]], out.p);
    out.frame = windowW(u, 0.1, 0.22, 0.66, 0.84);
    const w = windowW(u, 0.12, 0.24, 0.62, 0.74);
    if (w > 0 && an.magGrab) req(out.left, w, { anchor: an.magGrab, style: 'mag' });
    if (u > 0.5 && !A.tapped) { A.tapped = true; this._jolt.kick(0.5, 0, 0); }
    if (u > 0.36) this._setReadout(A, 'drum');
    return u >= 1;
  },

  /** Revolver: Trommel ausschwenken, Mündung hoch und von hinten in die Kammern schauen, mit der Hand einklappen. */
  _inspCylinderLook(A, out, u) {
    const an = this.cur.ud.anchors;
    const swing = curve(u, [[0.12, 0], [0.2, 1], [0.7, 1], [0.8, 0]]);
    curve(u, [[0, Z3], [0.12, [0.15, 0.2, 0.45]], [0.3, [0.85, 0.15, 0.2]], [0.6, [0.9, 0.18, 0.22]], [0.76, [0.15, 0.2, 0.45]], [0.92, Z3]], out.r);
    curve(u, [[0, Z3], [0.12, [-0.02, 0.05, 0.05]], [0.3, [-0.04, 0.0, 0.08]], [0.6, [-0.04, 0.0, 0.08]], [0.76, [-0.02, 0.05, 0.05]], [0.92, Z3]], out.p);
    out.parts.crane = [-0.012 * swing, -0.006 * swing, 0, 0, 0, 1.55 * swing];
    const w1 = windowW(u, 0.04, 0.1, 0.18, 0.26), w2 = windowW(u, 0.66, 0.72, 0.8, 0.88);
    if (an.cylGrab) { if (w1 > 0) req(out.left, w1, { anchor: an.cylGrab, style: 'pinchSide' }); if (w2 > 0) req(out.left, w2, { anchor: an.cylGrab, style: 'boltKnob' }); }
    if (u > 0.8 && !A.closed) { A.closed = true; this._jolt.kick(0.9, 0.3, 0); }
    if (u > 0.34) this._setReadout(A, 'cylinder');
    return u >= 1;
  },

  /** Messer: Klinge zur Kamera kanten (Schneide prüfen) bzw. in der Hand wirbeln. */
  _inspKnife(A, out, u, name) {
    if (name === 'klinge') {
      curve(u, [[0, Z3], [0.2, [-0.35, 0.5, 0.9]], [0.5, [-0.4, 0.55, 1.0]], [0.7, [0.2, 0.25, 1.4]], [0.88, [0.22, 0.25, 1.45]], [1, Z3]], out.r);
      curve(u, [[0, Z3], [0.2, [-0.07, 0.07, 0.07]], [0.88, [-0.07, 0.08, 0.07]], [1, Z3]], out.p);
    } else {
      // Wirbel: eine volle Drehung um die Längsachse der Klinge (Rollen im Modellraum), abgefangen
      const spin = curve(u, [[0.15, 0], [0.55, Math.PI * 2]]);
      curve(u, [[0, Z3], [0.12, [0.2, 0.2, 0.4]], [0.6, [0.2, 0.2, 0.4]], [0.85, [0.1, 0.1, 0.2]], [1, Z3]], out.r);
      curve(u, [[0, Z3], [0.12, [-0.05, 0.06, 0.05]], [0.85, [-0.04, 0.05, 0.04]], [1, Z3]], out.p);
      out.r[2] += spin;
      if (u > 0.55 && !A.caught) { A.caught = true; this._jolt.kick(0.5, 0.2, 0); }
    }
    return u >= 1;
  },

  // ---------------------------------------------------------------- Patrone im Lager

  /**
   * Patrone im Auswurffenster (Kammer-Check): einmal je Modell den Fensterboden suchen (Strahl vom Auswurf-Anker
   * zurück auf die Waffe), dort liegt eine Patrone des Kalibers längs der Laufachse, zur Hälfte im Gehäuse versenkt –
   * sichtbar nur, solange der Verschluss offen ist (open > 0,35) UND eine Patrone geladen ist.
   */
  _chamberShow(open) {
    const e = this.cur;
    if (!e) return;
    const c = e.chamber;
    if (!c) return;
    const loaded = (this._magRaw ?? 1) > 0;
    const k = smooth(clamp((open - 0.35) / 0.4, 0, 1));
    c.mesh.visible = loaded && k > 0.01;
    if (c.mesh.visible) c.mesh.scale.set(1, 1, 0.35 + 0.65 * k);
  },

  _chamberProbe(entry) {
    try {
      const { model, ud } = entry, ej = ud.ejection;
      if (!ej) return null;
      model.updateMatrixWorld(true);
      const inv = _m.copy(model.matrixWorld).invert();
      const p = ej.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      model.getWorldQuaternion(_q).invert();
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(ej.getWorldQuaternion(new THREE.Quaternion()).premultiply(_q)).normalize();
      // Strahl von außen auf das Fenster (Modellraum → Weltraum für den Raycaster)
      const from = p.clone().addScaledVector(dir, 0.04).applyMatrix4(model.matrixWorld);
      const to = p.clone().addScaledVector(dir, -0.03).applyMatrix4(model.matrixWorld);
      const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, from.distanceTo(to));
      const hits = ray.intersectObject(model, true).filter(h => h.object.isMesh && !h.object.isInstancedMesh && !h.object.userData.noContact);
      const hit = hits.find(h => /cavity/.test(h.object.name)) || null;
      if (!hit) return null;
      const H = hit.point.clone().applyMatrix4(inv);
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inv).normalize();
      const fill = ud.magFill;
      const cal = fill && fill.cal && fill.cal.kind !== 'nose' ? fill.cal : CAL[this.h.shell === 'shotgun' ? 'g12' : this.h.shell === 'pistol' ? 'p9' : 'r556'];
      const mesh = roundMesh(cal);
      const r = cal.r || 0.005;
      mesh.position.copy(H).addScaledVector(n, -r * 0.45);
      mesh.visible = false;
      model.add(mesh);
      return { mesh };
    } catch (err) {
      console.warn('[anim] Kammer-Patrone', err);
      return null;
    }
  },
};
