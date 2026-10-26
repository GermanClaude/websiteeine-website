// NULLPUNKT – Ego-Ansicht: Kipplauf-Baustein (26.10., ZW-12 Zwilling; wiederverwendbar für Kipplauf-Flinten und -Werfer wie
// Stummel oder Hammer). Wird in viewmodel.js in ViewModel.prototype gemischt (wie anim/reloads.js).
//
// Modellvertrag (Bauplan): Teil „barrels“ (Läufe samt Vorderschaft, Drehpunkt = Scharnierstift, öffnet um −x), optional
// „toplever“ (Oberhebel, dreht um die Hochachse), „extractor“ (Auszieher in „barrels“, fährt nach hinten), Patronen „shellR“ /
// „shellL“ im Auszieher (Ruhelage im Lager, standardmäßig verborgen), Anker „leftHandGrip“ im Teil „barrels“ (die Stützhand folgt
// den Läufen beim Öffnen). Öffnungswinkel aus handling.breakOpen (Standard −0,62 rad ≈ 35°).
//
// Nachladen (Stil 'break'; Dauer = Spielzeit, taktisch 2,0 s = eine Patrone, leer 2,5 s = zwei; der Controller schreibt bei 76 % bzw.
// 64 % gut – die Patronen sitzen bei 62 %):
//   0,00–0,10 Waffe kippen (Basküle zur Kamera) · 0,06–0,12 Daumen drückt den Oberhebel · 0,10–0,20 Läufe klappen ab (Ruck)
//   · Auszieher hebt die Patronen an den Öffnungswinkel gekoppelt
//   taktisch (V1 „Auszieher“) 0,24–0,40: Stützhand zieht die leere Hülse rechts heraus und wirft sie weg (Hülse fällt in die Welt)
//   leer (V2 „Schwung“) 0,22–0,30: Waffe ruckt mit der Mündung nach oben, beide Hülsen fliegen über die Schulter (Spielerkniff)
//   0,40–0,50 Hand zur Tasche · 0,50–0,62 Patrone(n) entlang der Laufachse einschieben, Daumen drückt nach · 0,62–0,70 Hand zurück
//   · 0,70–0,78 Läufe hochklappen, satter Schnapp bei 0,76, Oberhebel springt zurück · 0,78–0,95 zurück in die Ruhelage.
// Abbruch durch Sprint: die Teilversätze werden mit A.fade auf 0 gezogen – die Läufe schließen von selbst.
import * as THREE from 'three';
import { curve, windowW, clamp, smooth } from '../gunsmith/anim.js';
import { req } from './reloads.js';

const Z3 = [0, 0, 0];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _qAxis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);   // Hülsenachse (lokal Y) → Laufachse
const vis = (out) => out.parts._vis || (out.parts._vis = {});
// Stützhand an der Patronentasche (Kameraraum, unter dem Bildrand), Finger spitz (zwei Patronen zwischen den Fingern)
const POUCH = [[-0.13, -0.33, -0.28], [0.2, 0.75, -0.62], [-0.7, 0.3, 0.35], 'pinch'];

/** Auszieher-Hub (0…1) aus dem Öffnungswinkel a (≤ 0): ab 0,35 rad heben, voll bei 0,6 rad. */
export const extractorLift = (a) => smooth(clamp((-a - 0.35) / 0.25, 0, 1));

export const BREAK_ACTIONS = {
  /** Öffnungswinkel der Läufe (rad, negativ) für das aktuelle Modell. */
  _breakMax() { return this.h.breakOpen ?? -0.62; },

  /** Läufe, Oberhebel und Auszieher für einen Öffnungsgrad k (0 = zu, 1 = ganz offen) setzen; liefert den Winkel. */
  _breakPose(out, k, lever = k) {
    const a = this._breakMax() * k;
    out.parts.barrels = [0, 0, 0, a, 0, 0];
    out.parts.toplever = [0, 0, 0, 0, 0.6 * clamp(lever, 0, 1), 0];
    out.parts.extractor = [0, 0, 0.009 * extractorLift(a), 0, 0, 0];
    return a;
  },

  /** Hülsen der Teile (Namen) in die Welt werfen: Lage/Richtung aus dem Teil, Geschwindigkeit im Kameraraum. */
  _breakBrass(names, vel) {
    for (const n of names) {
      const p = this._part(n);
      if (!p) continue;
      p.updateWorldMatrix(true, false);
      p.getWorldPosition(_v);
      this.root.worldToLocal(_v);
      p.getWorldQuaternion(_q);
      this.root.getWorldQuaternion(_q2);
      _q.premultiply(_q2.invert()).multiply(_qAxis);
      _v2.set(vel[0] + (Math.random() - 0.5) * 0.3, vel[1] + Math.random() * 0.4, vel[2] + Math.random() * 0.3);
      this.shells.spawn('shotgun', _v, _v2, _q, this._worldFx() ? 0.1 + Math.random() * 0.04 : Infinity);
    }
  },

  /** Freie Handlage (Kameraraum) knapp unter dem Patronenboden; pair: zwei Patronen (Hand zwischen beiden Lagern). */
  _breakHand(name, pair) {
    const p = this._part(name), o = this._breakFree || (this._breakFree = [[0, 0, 0], [0.15, 0.8, -0.58], [-0.75, 0.25, 0.3], 'pinch']);
    if (!p) return POUCH;
    p.updateWorldMatrix(true, false);
    p.getWorldPosition(_v);
    this.root.worldToLocal(_v);
    o[0][0] = _v.x + (pair ? 0.008 : -0.012); o[0][1] = _v.y - 0.035; o[0][2] = _v.z + 0.02;
    return o;
  },

  /** Nachladen Kipplauf (siehe Kopf). */
  _actReloadBreak(A, out, u) {
    const ud = this.cur.ud, an = ud.anchors, empty = A.empty;
    // Waffe kippen: Mündung nach links unten, Basküle zur Kamera; leer am Ende des Schwungs ein Ruck mit der Mündung nach oben
    const tilt = curve(u, [[0, 0], [0.1, 1], [0.78, 1], [0.95, 0]]);
    // (26.10., Prüfbild: Basküle tiefer und weiter weg – sonst verdeckt der Arm beim Einschieben die halbe Sicht)
    // Nicken negativ = Mündung nach unten (anim-Konvention: + = hoch); die Lager zeigen dann nach oben zum Auge
    out.r[0] = -0.28 * tilt; out.r[1] = 0.36 * tilt; out.r[2] = -0.35 * tilt;
    out.p[0] = 0.0; out.p[1] = -0.1 * tilt; out.p[2] = -0.09 * tilt;   // auf Armlänge (Arm verdeckt sonst die Sicht)
    if (empty) { const sw = windowW(u, 0.21, 0.245, 0.255, 0.3); out.r[0] += 0.5 * sw; out.p[1] += 0.04 * sw; out.p[2] -= 0.02 * sw; }
    out.frame = windowW(u, 0.06, 0.16, 0.7, 0.84);
    // Oberhebel 0,06–0,12, Läufe 0,10–0,20 auf / 0,70–0,76 zu, Hebel springt beim Schnapp zurück
    const lever = curve(u, [[0.06, 0], [0.12, 1], [0.755, 1], [0.765, 0]]);
    const k = curve(u, [[0.1, 0], [0.2, 1], [0.7, 1], [0.76, 0]]);
    this._breakPose(out, k, lever);
    if (u > 0.2 && !A.opened) { A.opened = true; this._jolt.kick(0.6, 0, 0); }
    if (u > 0.76 && !A.closed) { A.closed = true; this._jolt.kick(1.4, 0.3, 0); this._recoilPos.kick(0, 0.004, 0.005); }
    // Patronen: Ausgangslage (taktisch: rechts leer, links scharf; leer: beide leer) – sichtbar, sobald die Läufe offen stehen
    const open = k > 0.08, V = vis(out);
    let shR = Z3, shL = Z3, showR = open, showL = open;
    if (!empty) {
      // V1 „Auszieher“: Hand zieht die rechte Hülse 6 cm aus dem Lager und wirft sie weg; neue Patrone ab 0,44 aus der Tasche
      if (u < 0.4) shR = curve(u, [[0.28, Z3], [0.34, [0, 0, 0.035]], [0.4, [-0.05, -0.08, 0.06]]]);
      if (u >= 0.36 && !A.thrown) { A.thrown = true; this._breakBrass(['shellR'], [-0.6, -0.2, 0.4]); }
      if (u >= 0.36) shR = curve(u, [[0.44, [-0.04, -0.16, 0.16]], [0.52, [0, -0.01, 0.075]], [0.6, [0, 0, 0.004]], [0.62, Z3]]);
      showR = open && (u < 0.36 || u > 0.44);
    } else {
      // V2 „Schwung“: beide Hülsen rutschen heraus und fliegen über die Schulter; zwei neue zwischen den Fingern
      const fly = curve(u, [[0.235, 0], [0.27, 1]]);
      shR = shL = [0, 0.03 * fly, 0.09 * fly];
      if (u >= 0.27 && !A.thrown) { A.thrown = true; this._breakBrass(['shellR', 'shellL'], [0.15, 1.4, 1.1]); }
      if (u >= 0.27) shR = shL = curve(u, [[0.44, [-0.03, -0.16, 0.16]], [0.52, [0, -0.01, 0.075]], [0.6, [0, 0, 0.004]], [0.62, Z3]]);
      showR = showL = open && (u < 0.27 || u > 0.44);
    }
    out.parts.shellR = [shR[0], shR[1], shR[2], 0, 0, 0];
    out.parts.shellL = [shL[0], shL[1], shL[2], 0, 0, 0];
    V.shellR = showR; V.shellL = showL;
    if (u > 0.6 && !A.seated) { A.seated = true; this._jolt.kick(0.3, 0, 0); }
    // Stützhand: bleibt bis 0,22 am Vorderschaft (Anker im Teil „barrels“ – folgt den Läufen), zieht/holt, kehrt bei 0,66 zurück
    const wAway = windowW(u, 0.22, 0.27, 0.62, 0.68);
    if (wAway > 0) {
      // Finger an der Patrone als freie Lage im Kameraraum (Prüfbild 26.10.: ein Griff am Teil drehte den Ellbogen vor die Kamera)
      const atShell = !empty && u < 0.38 ? 'shellR' : u >= 0.45 ? (empty ? 'shellL' : 'shellR') : null;
      if (atShell) req(out.left, wAway, { free: this._breakHand(atShell, empty && u >= 0.45) });
      else req(out.left, wAway, { free: POUCH });
    }
    return u >= 1;
  },

  /** Inspizieren „Kipp“: Läufe halb öffnen, Waffe zur Kamera drehen (Patronenböden im Blick), schließen. */
  _inspBreak(A, out, u) {
    curve(u, [[0, Z3], [0.16, [-0.2, 0.5, -0.35]], [0.7, [-0.24, 0.55, -0.4]], [0.86, [0.02, 0, 0]], [1, Z3]], out.r);
    curve(u, [[0, Z3], [0.16, [-0.05, -0.02, 0.03]], [0.7, [-0.05, -0.02, 0.03]], [1, Z3]], out.p);
    const lever = curve(u, [[0.12, 0], [0.18, 1], [0.74, 1], [0.76, 0]]);
    const k = curve(u, [[0.16, 0], [0.28, 0.56], [0.66, 0.56], [0.75, 0]]);   // −0,35 rad: Böden sichtbar, Auszieher noch unten
    this._breakPose(out, k, lever);
    const V = vis(out); V.shellR = V.shellL = k > 0.08;
    out.frame = windowW(u, 0.14, 0.26, 0.66, 0.8);
    if (u > 0.3) this._setReadout(A, 'chamber');
    if (u > 0.75 && !A.closed) { A.closed = true; this._jolt.kick(1.1, 0.3, 0); }
    return u >= 1;
  },
};
