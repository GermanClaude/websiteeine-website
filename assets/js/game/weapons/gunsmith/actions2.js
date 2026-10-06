// Ego-Ansicht – zusätzliche Choreografien (Welle 2, Arsenal): Nachladen je Mechanik (Magazin im Griff, Bullpup,
// Trommelmagazin, Revolver mit Schnelllader, vorn geladene Rakete), Inspizieren je Waffenklasse, Schutzplatte
// einsetzen und Messerhiebe je Klinge (als Hauptwaffe). Wird in viewmodel.js in ViewModel.prototype gemischt;
// alle Methoden arbeiten mit denselben Ausgaben wie die Basisaktionen: out.p/out.r (Waffe, Kameraraum),
// out.left/out.right (Handanfragen), out.parts (Teilversätze [dx, dy, dz, rx, ry, rz] im Elternraum, _vis).
import * as THREE from 'three';
import { curve, windowW, clamp, smooth } from './anim.js';

const ZERO3 = [0, 0, 0];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

// Handanfrage anhängen (wie viewmodel.js req)
function req(list, w, o) {
  if (w <= 0 || list.n >= list.items.length) return;
  const r = list.items[list.n++];
  r.w = w; r.anchor = o.anchor || null; r.style = o.style || null; r.data = o.data || null;
  r.part = o.part || null; r.offset = o.offset || null; r.free = o.free || null; r.dy = o.dy || 0;
}
const vis = (out) => out.parts._vis || (out.parts._vis = {});

export const EXTRA_ACTIONS = {
  /** Ladehebel ziehen (gemeinsam für Leer-Nachladen der neuen Stile). c = 0..1 Teilfortschritt. */
  _chargeCycle(A, out, c, side = 'left') {
    const ch = this.cur.ud.anchors.chargeGrab;
    if (!ch || c < -0.05) return;
    const st = ch.userData.style || 'pull';
    const travel = ch.userData.travel || [0, 0, 0.06];
    const pull = curve(c, [[0.2, 0], [0.42, 1], [0.52, 1], [0.58, 0]]);
    const partName = ch.parent?.name || 'charge';
    out.parts[partName] = [travel[0] * pull, travel[1] * pull, travel[2] * pull, 0, 0, st === 'hkslap' ? -0.6 * windowW(c, 0.3, 0.42, 0.5, 0.56) : 0];
    const right = st === 'right' || side === 'right';
    const wC = windowW(c, 0.0, 0.18, 0.62, 0.86);
    if (wC > 0) req(right ? out.right : out.left, wC, { anchor: ch, style: right ? 'pinchRight' : 'pinchSide' });
    const rc = windowW(c, 0.0, 0.2, 0.62, 0.95);
    out.r[2] += (right ? 0.36 : 0.18) * rc; out.r[0] += 0.07 * rc; out.r[1] += 0.1 * rc;
    out.p[0] += -0.02 * rc;
    if (c > 0.55 && !A.charged) { A.charged = true; this._boltLocked = false; this._boltT = 0.3; this._jolt.kick(0.8, 0.3, 0); }
  },

  /** Magazin im Pistolengriff (KM-7 Wespe): Waffe gekippt, Magazin fällt entlang der Griffachse, Spannhebel oben. */
  _actReloadGripMag(A, out, u) {
    const ud = this.cur.ud, k = A.empty ? 0.72 : 1, m = u / k;
    curve(m, [[0, ZERO3], [0.12, [0.32, 0.24, -0.34]], [0.8, [0.34, 0.26, -0.36]], [0.95, ZERO3]], out.r);
    curve(m, [[0, ZERO3], [0.12, [-0.03, 0.055, 0.04]], [0.8, [-0.03, 0.056, 0.04]], [0.95, ZERO3]], out.p);
    const mag = curve(m, [[0.12, ZERO3], [0.2, [0, -0.06, 0.012]], [0.3, [0.02, -0.5, 0.12]], [0.31, [-0.08, -0.22, 0.06]], [0.44, [-0.02, -0.08, 0.02]], [0.56, [0, -0.012, 0.003]], [0.62, ZERO3]]);
    out.parts.mag = [mag[0], mag[1], mag[2]];
    this._magWindow(A, out, m, 0.17, 0.305);
    out.frame = windowW(m, 0.06, 0.16, 0.66, 0.84);
    if (m > 0.6 && !A.slapped) { A.slapped = true; this._jolt.kick(1.3, 0, 0); this._recoilPos.kick(0, 0.005, 0); }
    const wAway = windowW(m, 0.1, 0.22, 0.66, 0.82);
    if (wAway > 0) {
      if (m < 0.3) req(out.left, wAway, { free: [[-0.11, -0.25, -0.27], [0.4, 0.5, -0.7], [-0.7, 0.4, 0.2], 'relaxed'] });
      else req(out.left, wAway, { anchor: ud.anchors.magGrab || ud.magazine, style: 'mag' });
    }
    if (A.empty) this._chargeCycle(A, out, (u - 0.72) / 0.28);
    return u >= 1;
  },

  /** Bullpup (BX-20): Magazin hinter dem Griff – Waffe hoch und nah an die Brust, Stützhand greift weit nach hinten. */
  _actReloadBullpup(A, out, u) {
    const ud = this.cur.ud, k = A.empty ? 0.76 : 1, m = u / k;
    // hands: Waffe vom Körper weg nach vorn/oben und gegen den Uhrzeigersinn gedreht – der Schacht hinter dem Griff
    // kommt ins Bild (früher 10 cm zur Brust gezogen: Hand und Magazin lagen 60 % des Nachladens unter dem Bildrand)
    curve(m, [[0, ZERO3], [0.14, [0.34, 0.62, -0.34]], [0.82, [0.36, 0.64, -0.36]], [0.96, ZERO3]], out.r);
    curve(m, [[0, ZERO3], [0.14, [-0.02, 0.07, -0.08]], [0.82, [-0.02, 0.072, -0.08]], [0.96, ZERO3]], out.p);
    const mag = curve(m, [[0.24, ZERO3], [0.33, [0, -0.08, 0.02]], [0.42, [-0.07, -0.2, 0.07]], [0.43, [-0.065, -0.19, 0.065]], [0.56, [0, -0.09, 0.02]], [0.64, [0, -0.012, 0.003]], [0.67, ZERO3]]);
    const magRot = curve(m, [[0.24, 0], [0.38, 0.22], [0.43, 0.22], [0.56, 0.1], [0.67, 0]]);
    out.parts.mag = [mag[0], mag[1], mag[2], magRot, 0, 0];
    this._magWindow(A, out, m, 0.3, 0.425);
    out.frame = windowW(m, 0.06, 0.18, 0.72, 0.88);
    if (m > 0.66 && !A.slapped) { A.slapped = true; this._jolt.kick(1.25, 0, 0); this._recoilPos.kick(0, 0.004, 0); }
    const wMag = windowW(m, 0.14, 0.24, 0.68, 0.8);
    if (wMag > 0 && ud.anchors.magGrab) req(out.left, wMag, { anchor: ud.anchors.magGrab, style: 'mag' });
    if (A.empty) this._chargeCycle(A, out, (u - 0.76) / 0.24);
    return u >= 1;
  },

  /** Trommelmagazin (LM-8): schwer – nach vorn abkippen und herausziehen, neue Trommel vorn einhängen, hinten einrasten. */
  _actReloadDrum(A, out, u) {
    const ud = this.cur.ud, k = A.empty ? 0.8 : 1, m = u / k;
    curve(m, [[0, ZERO3], [0.1, [0.1, 0.22, -0.4]], [0.84, [0.12, 0.24, -0.42]], [0.96, ZERO3]], out.r);
    curve(m, [[0, ZERO3], [0.1, [-0.03, 0.03, 0.06]], [0.84, [-0.03, 0.032, 0.06]], [0.96, ZERO3]], out.p);
    // Abkippen (Vorderkante zuerst), dann heraus nach unten, neue Trommel: vorn ansetzen, hinten hochschwenken
    const mag = curve(m, [[0.2, ZERO3], [0.28, [0, -0.012, -0.006]], [0.36, [0, -0.06, 0.0]], [0.435, [-0.09, -0.22, 0.06]], [0.445, [-0.085, -0.21, 0.0]], [0.58, [0, -0.06, -0.012]], [0.66, [0, -0.014, -0.004]], [0.7, ZERO3]]);
    const rock = curve(m, [[0.2, 0], [0.28, -0.22], [0.36, -0.3], [0.445, -0.3], [0.58, -0.28], [0.66, -0.14], [0.7, 0]]);
    out.parts.mag = [mag[0], mag[1], mag[2], rock, 0, 0];
    this._magWindow(A, out, m, 0.36, 0.44);
    out.frame = windowW(m, 0.06, 0.16, 0.74, 0.9);
    if (m > 0.28 && m < 0.3 && !A.unlatched) { A.unlatched = true; this._jolt.kick(0.6, 0, 0); }
    if (m > 0.69 && !A.slapped) { A.slapped = true; this._jolt.kick(1.6, 0, 0); this._recoilPos.kick(0, 0.006, 0); }
    const wMag = windowW(m, 0.1, 0.2, 0.72, 0.84);
    if (wMag > 0 && ud.anchors.magGrab) req(out.left, wMag, { anchor: ud.anchors.magGrab, style: 'mag' });
    if (A.empty) this._chargeCycle(A, out, (u - 0.8) / 0.2, 'right');
    return u >= 1;
  },

  /**
   * Revolver (R-6 Kobra): Trommel ausschwenken → Mündung hoch, Ausstoßer drücken (Hülsen fallen) → Mündung runter,
   * Schnelllader einsetzen und drehen → Lader weg, Trommel einschwenken (Ruck) → Stützgriff.
   */
  _actReloadRevolver(A, out, u) {
    const ud = this.cur.ud;
    const swing = curve(u, [[0.08, 0], [0.16, 1], [0.7, 1], [0.76, 0]]);
    const up = windowW(u, 0.16, 0.24, 0.34, 0.42);
    const down = windowW(u, 0.38, 0.46, 0.66, 0.74);
    out.r[0] = 0.2 * swing + 0.95 * up - 0.55 * down;
    out.r[1] = 0.25 * swing;
    out.r[2] = 0.55 * swing - 0.25 * up;
    // hands: Waffe bleibt auf Armlänge (früher 5–9 cm zur Kamera → Hände füllten ¼ des Bildes)
    out.p[0] = -0.03 * swing; out.p[1] = 0.03 * swing + 0.03 * up - 0.02 * down; out.p[2] = -0.04 * swing + 0.01 * up;
    out.parts.crane = [-0.012 * swing, -0.006 * swing, 0, 0, 0, 1.55 * swing];
    // Ausstoßer: Stern fährt nach hinten, Hülsen fallen (einmal)
    const ej = windowW(u, 0.26, 0.29, 0.31, 0.34);
    out.parts.ejector = [0, 0, 0.022 * ej];
    // Magazininhalt: Kammern leer ab dem Ausstoßen, voll (bzw. Vorrat) sobald der Schnelllader sitzt
    if (u > 0.29 && !A.ejected && !A.cancel) { A.ejected = true; A.magNew = 0; this._revolverBrass(); }
    // Schnelllader: von unten hinten an die Trommel, eindrehen, abziehen
    const lu = curve(u, [[0.42, [0.0, -0.2, 0.18]], [0.54, [0.0, -0.02, 0.08]], [0.6, [0, 0, 0.004]], [0.62, ZERO3], [0.66, ZERO3], [0.7, [0, -0.04, 0.12]], [0.74, [0.02, -0.2, 0.18]]]);
    out.frame = 0.6 * swing;
    const twist = windowW(u, 0.6, 0.63, 0.66, 0.7) * 0.5;
    out.parts.loader = [lu[0], lu[1], lu[2], 0, 0, twist];
    vis(out).loader = u > 0.42 && u < 0.74;
    if (u > 0.62 && !A.seated) { A.seated = true; if (!A.cancel) A.magNew = this._freshMag(); this._jolt.kick(0.5, 0, 0); }
    if (u > 0.755 && !A.closed) { A.closed = true; this._jolt.kick(1.2, 0.4, 0); this._recoilPos.kick(0, 0.004, 0); }
    // Trommel dreht beim Einschwenken nach
    out.parts.cylinder = [0, 0, 0, 0, 0, curve(u, [[0.74, 0], [0.8, 0.9], [0.84, Math.PI / 3]])];
    // Linke Hand: Trommel ausdrücken → Ausstoßer → Lader holen → einschwenken → Stützgriff
    if (u < 0.22) req(out.left, windowW(u, 0.02, 0.08, 0.18, 0.24), { anchor: ud.anchors.cylGrab, style: 'pinchSide' });
    // hands-v3: Ausstoßer mit Daumen/Zeigefinger drücken und Trommel mit gekrümmten Fingern zuschieben (vorher flache,
    // offene Hand – das „Winken“ beim Wechsel Trommel → Ausstoßer → Lader)
    else if (u < 0.38) req(out.left, windowW(u, 0.2, 0.25, 0.33, 0.38), { anchor: ud.anchors.ejectorGrab, style: 'pinchSide' });
    else if (u < 0.74) {
      const w = windowW(u, 0.36, 0.42, 0.68, 0.74);
      if (u < 0.44) req(out.left, w, { free: [[-0.13, -0.27, -0.33], [0.2, 0.6, -0.7], [-0.6, 0.3, 0.3], 'pinch'] });
      else req(out.left, w, { part: 'loader', style: 'pinchSide', offset: [0, 0, 0.02] });
    } else req(out.left, windowW(u, 0.72, 0.75, 0.8, 0.88), { anchor: ud.anchors.cylGrab, style: 'boltKnob' });
    return u >= 1;
  },

  /** Sechs Hülsen aus der Trommel fallen lassen (Revolver). */
  _revolverBrass() {
    const cyl = this._part('cylinder');
    if (!cyl) return;
    cyl.updateWorldMatrix(true, false);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      _v.set(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0.035).applyMatrix4(cyl.matrixWorld);
      this.root.worldToLocal(_v);
      _v2.set((Math.random() - 0.5) * 0.4, -0.8 - Math.random() * 0.5, 0.3 + Math.random() * 0.3);
      _q.identity();
      this.shells.spawn('big', _v, _v2, _q, this._worldFx() ? 0.12 + i * 0.01 : Infinity);
    }
  },

  /** Rakete vorn laden (Donnerkeil): Rohr kippen, Stützhand holt den Gefechtskopf, schiebt ihn ein, rastet ein. */
  _actReloadRocket(A, out, u) {
    const ud = this.cur.ud;
    curve(u, [[0, ZERO3], [0.12, [0.34, 0.38, 0.18]], [0.78, [0.36, 0.4, 0.2]], [0.92, ZERO3]], out.r);
    curve(u, [[0, ZERO3], [0.12, [-0.04, -0.07, 0.07]], [0.78, [-0.04, -0.07, 0.07]], [0.92, ZERO3]], out.p);
    const rk = curve(u, [[0.3, [-0.1, -0.28, -0.1]], [0.46, [0.0, -0.02, -0.22]], [0.54, [0, 0, -0.19]], [0.64, [0, 0, -0.01]], [0.66, ZERO3]]);
    out.parts.rocket = [rk[0], rk[1], rk[2], curve(u, [[0.3, 0.6], [0.46, 0.05], [0.54, 0]]), 0, 0];
    vis(out).rocket = u > 0.3;
    out.frame = windowW(u, 0.08, 0.2, 0.7, 0.86);
    if (u > 0.655 && !A.slapped) { A.slapped = true; this._jolt.kick(1.4, 0, 0); this._recoilPos.kick(0, 0.003, 0.004); }
    const wAway = windowW(u, 0.06, 0.14, 0.7, 0.86);
    if (wAway > 0) {
      if (u < 0.3) req(out.left, wAway, { free: [[-0.15, -0.29, -0.3], [0.3, 0.7, -0.6], [-0.6, 0.3, 0.3], 'relaxed'] });
      else req(out.left, wAway, { part: 'rocket', style: 'under', offset: [0, -0.022, -0.06] });
    }
    return u >= 1;
  },

  /** Inspizieren je Waffenklasse (handling.inspectStyle); 'rifle' bleibt die Basisaktion. */
  _actInspectStyle(A, out, style) {
    const u = clamp(A.t / A.dur, 0, 1), ud = this.cur.ud, an = ud.anchors;
    switch (style) {
      case 'magcheck': {
        curve(u, [[0, ZERO3], [0.12, [0.16, 0.14, -0.42]], [0.5, [0.18, 0.18, -0.46]], [0.62, [0.0, -0.2, 0.55]], [0.86, [-0.02, -0.24, 0.6]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.12, [-0.04, 0.04, 0.05]], [0.5, [-0.04, 0.045, 0.05]], [0.62, [-0.06, 0.03, 0.03]], [0.86, [-0.06, 0.03, 0.03]], [1, ZERO3]], out.p);
        const drop = curve(u, [[0.18, 0], [0.26, 1], [0.44, 1], [0.52, 0]]);
        out.parts.mag = [0, -0.035 * drop, 0.006 * drop, 0.12 * drop, 0, 0];
        if (u > 0.52 && !A.slapped) { A.slapped = true; this._jolt.kick(1.0, 0, 0); }
        const wm = windowW(u, 0.06, 0.16, 0.52, 0.62);
        if (an.magGrab && wm > 0) req(out.left, wm, { anchor: an.magGrab, style: this.h.reload === 'gripmag' ? 'mag' : 'mag' });
        return u >= 1;
      }
      case 'pistol': {
        curve(u, [[0, ZERO3], [0.15, [0.12, -0.3, 0.7]], [0.45, [0.14, -0.32, 0.74]], [0.6, [0.02, 0.45, -0.6]], [0.86, [0.02, 0.48, -0.64]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.15, [-0.04, 0.05, 0.06]], [0.86, [-0.04, 0.05, 0.06]], [1, ZERO3]], out.p);
        const press = curve(u, [[0.22, 0], [0.3, 1], [0.38, 1], [0.44, 0]]);
        const travel = an.slideGrab?.userData.travel?.[2] ?? 0.03;
        if (this._part('slide')) out.parts.slide = [0, 0, travel * 0.38 * press];
        const w = windowW(u, 0.16, 0.22, 0.42, 0.5);
        if (w > 0 && an.slideGrab) req(out.left, w, { anchor: an.slideGrab, style: 'pinchSide' });
        return u >= 1;
      }
      case 'bolt': {
        curve(u, [[0, ZERO3], [0.15, [0.1, 0.12, 0.3]], [0.6, [0.12, 0.14, 0.34]], [0.72, [0.05, -0.15, -0.5]], [0.9, [0.05, -0.16, -0.52]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.15, [-0.03, 0.03, 0.04]], [0.9, [-0.03, 0.03, 0.04]], [1, ZERO3]], out.p);
        const bg = an.boltGrab;
        if (bg) {
          const lift = curve(u, [[0.18, 0], [0.26, 1], [0.5, 1], [0.58, 0]]), back = curve(u, [[0.26, 0], [0.32, 0.3], [0.44, 0.3], [0.5, 0]]);
          out.parts.boltHandle = [0, 0, (bg.userData.travel?.[2] ?? 0.09) * back, 0, 0, (bg.userData.rot ?? 1.05) * lift];
          const w = windowW(u, 0.1, 0.18, 0.58, 0.66);
          if (w > 0) req(out.right, w, { anchor: bg, style: 'boltKnob' });
        }
        return u >= 1;
      }
      case 'pump': {
        curve(u, [[0, ZERO3], [0.14, [0.08, 0.1, -0.45]], [0.5, [0.1, 0.12, -0.48]], [0.64, [0.02, -0.1, 0.5]], [0.88, [0.02, -0.12, 0.52]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.14, [-0.03, 0.03, 0.04]], [0.88, [-0.03, 0.03, 0.04]], [1, ZERO3]], out.p);
        const travel = an.pumpGrab?.userData.travel?.[2] ?? 0.085;
        out.parts.pump = [0, 0, travel * 0.35 * curve(u, [[0.2, 0], [0.28, 1], [0.44, 1], [0.5, 0]])];
        if (u > 0.5 && !A.slapped) { A.slapped = true; this._jolt.kick(0.7, 0, 0); }
        return u >= 1;
      }
      case 'belt': {
        curve(u, [[0, ZERO3], [0.12, [0.08, 0.26, 0.3]], [0.62, [0.1, 0.28, 0.34]], [0.74, [0.02, -0.12, -0.36]], [0.9, [0.02, -0.12, -0.38]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.12, [0, -0.03, -0.01]], [0.9, [0, -0.03, -0.01]], [1, ZERO3]], out.p);
        out.parts.cover = [0, 0, 0, curve(u, [[0.2, 0], [0.3, -0.55], [0.5, -0.55], [0.58, 0]]), 0, 0];
        if (u > 0.58 && !A.slapped) { A.slapped = true; this._jolt.kick(1.0, 0, 0); }
        const w = windowW(u, 0.12, 0.2, 0.56, 0.64);
        if (w > 0 && this._part('cover')) req(out.left, w, { part: 'cover', style: 'pinchSide', offset: [-0.028, 0.02, 0.232] });
        return u >= 1;
      }
      case 'revolver': {
        curve(u, [[0, ZERO3], [0.12, [0.15, 0.2, 0.45]], [0.66, [0.18, 0.22, 0.5]], [0.76, [0.02, -0.25, -0.4]], [0.9, [0.02, -0.26, -0.42]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.12, [-0.02, 0.05, 0.05]], [0.9, [-0.02, 0.05, 0.05]], [1, ZERO3]], out.p);
        const swing = curve(u, [[0.14, 0], [0.22, 1], [0.6, 1], [0.64, 0]]);
        out.parts.crane = [-0.012 * swing, -0.006 * swing, 0, 0, 0, 1.55 * swing];
        // Trommel drehen (schnell, ausrollend)
        const spin = curve(u, [[0.26, 0], [0.32, 2.2], [0.46, 5.2], [0.58, 6.28]]);
        out.parts.cylinder = [0, 0, 0, 0, 0, spin];
        if (u > 0.64 && !A.closed) { A.closed = true; this._jolt.kick(1.1, 0.4, 0); }
        if (u < 0.36) { const w = windowW(u, 0.08, 0.14, 0.26, 0.34); if (w > 0 && an.cylGrab) req(out.left, w, { anchor: an.cylGrab, style: 'pinchSide' }); }
        return u >= 1;
      }
      case 'launcher': {
        curve(u, [[0, ZERO3], [0.16, [0.25, 0.4, 0.25]], [0.5, [0.27, 0.42, 0.28]], [0.66, [-0.05, -0.2, -0.25]], [0.88, [-0.05, -0.22, -0.26]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.16, [-0.05, -0.04, 0.08]], [0.88, [-0.05, -0.04, 0.08]], [1, ZERO3]], out.p);
        const w = windowW(u, 0.16, 0.26, 0.48, 0.58);
        if (w > 0 && an.rocketGrab && (this._magNow ?? 1) > 0) req(out.left, w, { anchor: an.rocketGrab, style: 'under', data: { r: 0.042 } });
        return u >= 1;
      }
      case 'knife': {
        // Klinge in der Hand drehen: Fläche, Rücken, Schneide – dann zurück
        curve(u, [[0, ZERO3], [0.18, [0.25, 0.35, 1.1]], [0.4, [0.3, 0.4, 1.35]], [0.58, [-0.25, -0.35, -0.9]], [0.82, [-0.25, -0.38, -0.95]], [1, ZERO3]], out.r);
        curve(u, [[0, ZERO3], [0.18, [-0.06, 0.06, 0.06]], [0.82, [-0.06, 0.06, 0.06]], [1, ZERO3]], out.p);
        return u >= 1;
      }
      default: return u >= 1;
    }
  },

  /** Messer als Hauptwaffe: Hieb je Klinge (Karambit-Haken, Machete schräg, Beil von oben, Stich). */
  _actSlashStyle(A, out, style) {
    const u = clamp(A.t / A.dur, 0, 1);
    const K = {
      hook: { p: [[0, ZERO3], [0.08, [0.08, 0.02, 0.04]], [0.22, [-0.26, -0.06, -0.12]], [0.38, [-0.2, -0.1, -0.05]], [0.8, ZERO3]], r: [[0, ZERO3], [0.08, [0.1, -0.7, -0.3]], [0.22, [-0.1, 0.9, 0.5]], [0.38, [-0.15, 0.85, 0.45]], [0.8, ZERO3]], hit: 0.16 },
      chop: { p: [[0, ZERO3], [0.12, [0.06, 0.12, 0.06]], [0.28, [-0.22, -0.14, -0.12]], [0.44, [-0.18, -0.16, -0.05]], [0.86, ZERO3]], r: [[0, ZERO3], [0.12, [0.6, -0.45, -0.6]], [0.28, [-0.5, 0.7, 0.95]], [0.44, [-0.55, 0.65, 0.9]], [0.86, ZERO3]], hit: 0.22 },
      overhead: { p: [[0, ZERO3], [0.14, [0.0, 0.16, 0.08]], [0.3, [-0.08, -0.16, -0.14]], [0.46, [-0.08, -0.18, -0.06]], [0.88, ZERO3]], r: [[0, ZERO3], [0.14, [1.0, -0.1, -0.2]], [0.3, [-0.9, 0.15, 0.2]], [0.46, [-0.95, 0.1, 0.2]], [0.88, ZERO3]], hit: 0.26 },
      stab: { p: [[0, ZERO3], [0.12, [-0.02, -0.02, 0.06]], [0.26, [-0.08, 0.0, -0.2]], [0.4, [-0.07, 0.0, -0.18]], [0.8, ZERO3]], r: [[0, ZERO3], [0.12, [-0.3, 0.2, 0.0]], [0.26, [-0.55, 0.3, 0.1]], [0.4, [-0.55, 0.3, 0.1]], [0.8, ZERO3]], hit: 0.22 },
    }[style];
    if (!K) return null;
    curve(u, K.p, out.p);
    curve(u, K.r, out.r);
    if (u > K.hit && !A.hit) { A.hit = true; this.onMeleeHit?.(); this._jolt.kick(style === 'overhead' ? 1.0 : 0.6, style === 'hook' ? 0.7 : -0.5, 0); }
    return u >= 1;
  },

  /**
   * Schutzplatte einsetzen (Rüstung, core-mechanics): Waffe nach rechts unten weg, linke Hand holt die Platte aus
   * der Tasche, führt sie vor die Brust und schiebt sie nach unten in die Weste (Klettverschluss-Ruck).
   */
  _actPlate(A, out) {
    const u = clamp(A.t / A.dur, 0, 1);
    const gw = windowW(u, 0.0, 0.14, 0.8, 1.0);
    out.p[0] = 0.07 * gw; out.p[1] = -0.26 * gw; out.p[2] = 0.08 * gw;
    out.r[0] = -0.7 * gw; out.r[1] = 0.25 * gw; out.r[2] = 0.3 * gw;
    const w = windowW(u, 0.04, 0.16, 0.8, 0.94);
    // hands-v3: Hand höher (die Platte hängt jetzt unter den Fingern statt quer durch die Hand)
    const pos = curve(u, [[0.04, [-0.3, -0.42, -0.18]], [0.24, [-0.13, -0.05, -0.38]], [0.46, [-0.07, -0.08, -0.36]], [0.66, [-0.04, -0.3, -0.16]], [0.8, [-0.06, -0.5, -0.08]]]);
    const F = curve(u, [[0.04, [0.3, 0.9, -0.3]], [0.24, [0.15, 0.95, -0.25]], [0.46, [0.1, 0.9, -0.4]], [0.66, [0.05, 0.4, -0.9]], [0.8, [0.05, 0.3, -0.95]]]);
    req(out.left, w, { free: [pos, F, [0.1, 0.25, 0.96], 'wrap'] });
    const plate = this.props.plate;
    if (plate) {
      this._attachProp(plate, this.arms.left.handBone, 'plate', -1);
      plate.visible = u > 0.05 && u < 0.78;
    }
    if (u > 0.64 && !A.seated) { A.seated = true; this._jolt.kick(1.1, 0, 0); this.G?.player?.shake?.(0.05); }
    return u >= 1;
  },
};
