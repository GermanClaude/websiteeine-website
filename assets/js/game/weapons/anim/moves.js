// NULLPUNKT – Ego-Ansicht: Ziehen/Wegstecken je Waffenklasse, „Bereitmachen“ beim ersten Ziehen nach dem Spawn,
// Leerlauf-Gesten, Bewegungsposen (Rutschen, Hinlegen, Ducken, Überklettern mit Hand am Hindernis) sowie Varianten
// für Nahkampf (Messerhieb, Stich, Schlag mit der Waffe) und Granatwurf (über Kopf, aus der Hocke/im Liegen von unten).
// Alles rein optisch: Spielzeiten (Ziehen = equipTime, Nahkampf = swingTime, Wurf = controller GRENADE) bleiben gleich.
// Bereitmachen und Leerlauf-Gesten sind kosmetisch (COSMETIC): sie blockieren nichts und brechen bei jeder Aktion ab.
import { curve, windowW, clamp, smooth, damp, easeOutBack } from '../gunsmith/anim.js';
import { req, COSMETIC } from './reloads.js';
import { inspectMech } from './inspects.js';

const Z3 = [0, 0, 0];

// Ziehen/Wegstecken: Ablage relativ zur Haltung (Kameraraum) je Klasse – Gewehr kommt von rechts unten hoch, Pistole
// aus dem Holster (Mündung zuerst nach unten), schwere Waffen tiefer und träger, Messer aus der Scheide links
const DRAW = {
  rifle: { p: [0.03, -0.3, 0.08], r: [-0.95, 0.3, 0.6], back: 1.25 },
  heavy: { p: [0.0, -0.34, 0.12], r: [-0.78, 0.35, 0.85], back: 1.1 },
  pistol: { p: [0.05, -0.27, 0.1], r: [-1.25, -0.15, 0.25], back: 1.5 },
  knife: { p: [-0.03, -0.26, 0.08], r: [0.55, 0.2, -0.75], back: 1.4 },
};

function drawClass(h, hd) {
  if (h.action === 'knife') return 'knife';
  if (h.action === 'pistol' || h.action === 'revolver') return 'pistol';
  return (hd && hd.mass >= 6) || h.reload === 'belt' || h.reload === 'rocket' ? 'heavy' : 'rifle';
}

export const MOVE_ACTIONS = {
  /**
   * Ziehen/Wegstecken je Klasse (statt einer Kurve für alle): beim Ziehen schwingt die Waffe leicht über die Haltung
   * hinaus und setzt sich (easeOutBack), beim Wegstecken fällt sie beschleunigt weg.
   */
  _drawPose(P, R) {
    const D = DRAW[drawClass(this.h, this._handlingData())];
    let e;
    if (this._lowering) e = smooth(this._lowerT);
    else if (this._equipT < 1) e = 1 - easeOutBack(this._equipT, D.back * 0.6);
    else return 0;
    if (Math.abs(e) < 1e-4) return 0;
    P.x += D.p[0] * e; P.y += D.p[1] * e; P.z += D.p[2] * e;
    R.x += D.r[0] * e; R.y += D.r[1] * e; R.z += D.r[2] * e;
    return e;
  },

  /**
   * Bereitmachen beim ersten Ziehen nach dem Spawn (rein optisch, abbrechbar): Gewehr/MP/MG Spannhebel ganz durch,
   * Pistole Schlitten überhand, Repetierer Kammer, Flinte Pumpe, Revolver Trommel kurz auf und zuschnippen, Messer drehen.
   */
  playReady(variant) {
    if (!this.cur || (this.action && !COSMETIC.has(this.action.type))) return false;
    const mech = inspectMech(this.h);
    if (mech === 'launcher') return false;
    const dur = { pistol: 0.95, revolver: 1.0, bolt: 1.0, pump: 0.85, knife: 0.8, belt: 1.25 }[mech] ?? 1.1;
    this._start('ready', dur, { mech, variant: variant ?? 0 });
    return true;
  },

  _actReady(A, out) {
    const u = clamp(A.t / A.dur, 0, 1), an = this.cur.ud.anchors;
    switch (A.mech) {
      case 'pistol': {
        // Überhand: Stützhand greift das Schlittenende von oben, zieht ganz durch, lässt los
        const sg = an.slideGrab;
        const travel = sg?.userData.travel?.[2] ?? 0.03;
        const back = curve(u, [[0.3, 0], [0.48, 1], [0.54, 1], [0.6, 0]]);
        if (sg) { out.parts.slide = [0, 0, travel * back]; req(out.left, windowW(u, 0.05, 0.28, 0.56, 0.8), { anchor: sg, style: 'rack', dy: 0.006 }); }
        // Pistole zur Mitte, Mündung hoch und nach innen gekantet: die Hand greift kurz über, statt dass der Unterarm
        // quer durchs Bild läuft
        const rc = windowW(u, 0.0, 0.25, 0.6, 0.95);
        out.r[2] += 0.7 * rc; out.r[0] += 0.35 * rc; out.r[1] -= 0.15 * rc; out.p[0] -= 0.06 * rc; out.p[1] += 0.03 * rc; out.p[2] += 0.03 * rc;
        if (u > 0.58 && !A.charged) { A.charged = true; this._jolt.kick(1.0, 0.25, 0); }
        break;
      }
      case 'bolt': this._boltMotion(clamp(u * 1.05, 0, 1), out, true); break;
      case 'pump': {
        const travel = an.pumpGrab?.userData.travel?.[2] ?? 0.085;
        out.parts.pump = [0, 0, travel * curve(u, [[0.15, 0], [0.42, 1], [0.5, 1], [0.75, 0]])];
        const rc = windowW(u, 0.0, 0.25, 0.65, 1.0);
        out.r[0] += 0.1 * rc; out.r[2] += 0.12 * rc; out.p[2] += 0.015 * rc;
        if (u > 0.45 && !A.charged) { A.charged = true; this._jolt.kick(0.7, 0, 0); }
        break;
      }
      case 'revolver': {
        const swing = curve(u, [[0.15, 0], [0.3, 0.75], [0.52, 0.75], [0.6, 0]]);
        out.parts.crane = [-0.012 * swing, -0.006 * swing, 0, 0, 0, 1.55 * swing];
        const rc = windowW(u, 0.0, 0.2, 0.55, 0.9);
        out.r[2] += 0.45 * rc; out.r[0] += 0.1 * rc;
        if (an.cylGrab) req(out.left, windowW(u, 0.05, 0.16, 0.26, 0.4), { anchor: an.cylGrab, style: 'pinchSide' });
        // zuschnippen: Ruck aus dem Handgelenk
        if (u > 0.58 && !A.charged) { A.charged = true; this._jolt.kick(1.2, 0.5, 0); }
        break;
      }
      case 'knife': return this._inspKnife(A, out, u, 'wirbel');
      default: this._chargeCycle(A, out, u); this._chargeReach(out, windowW(u, 0.0, 0.2, 0.62, 0.95));
    }
    return u >= 1;
  },

  /** Leerlauf-Geste (nach längerem Stillstand, rein optisch): Griff nachfassen, Waffe zurechtrücken, Visier prüfen. */
  playFidget(variant) {
    if (!this.cur || this.action) return false;
    const v = this._pickVariant('fidget', 3, variant);
    this._start('fidget', [1.5, 1.7, 1.4][v], { variant: v });
    return true;
  },

  _actFidget(A, out) {
    const u = clamp(A.t / A.dur, 0, 1), h = this.h, pist = h.action === 'pistol' || h.action === 'revolver';
    if (h.action === 'knife') return this._inspKnife(A, out, u, A.variant === 1 ? 'klinge' : 'wirbel');
    if (A.variant === 0) {
      // Griff nachfassen: Stützhand löst sich, Waffe sackt minimal, Hand fasst etwas weiter vorn wieder zu
      const w = windowW(u, 0.1, 0.3, 0.55, 0.8);
      out.p[1] -= 0.008 * w; out.r[0] -= 0.03 * w; out.r[2] += 0.04 * w;
      if (h.leftGrip !== 'none') req(out.left, w * 0.9, { free: pist ? [[-0.1, -0.24, -0.26], [0.3, 0.7, -0.65], [-0.7, 0.35, 0.3], 'relaxed'] : [[-0.07, -0.2, -0.42], [0.45, 0.55, -0.7], [-0.6, -0.6, -0.2], 'open'] });
    } else if (A.variant === 1) {
      // Waffe zurechtrücken (Riemen/Schulter): kurz anheben und eindrehen, zurück
      curve(u, [[0, Z3], [0.25, [0.06, 0.08, -0.12]], [0.45, [0.04, -0.04, 0.08]], [0.7, [0.02, 0.02, -0.03]], [1, Z3]], out.r);
      curve(u, [[0, Z3], [0.25, [-0.01, 0.012, 0.01]], [0.45, [0.004, -0.006, 0]], [1, Z3]], out.p);
    } else {
      // Visier prüfen: Waffe etwas anheben und zur Kamera kanten
      curve(u, [[0, Z3], [0.3, [0.1, 0.12, -0.2]], [0.7, [0.11, 0.13, -0.22]], [1, Z3]], out.r);
      curve(u, [[0, Z3], [0.3, [-0.02, 0.025, 0.02]], [0.7, [-0.02, 0.026, 0.02]], [1, Z3]], out.p);
    }
    return u >= 1;
  },

  /**
   * Bewegungsposen + kosmetische Auslöser (je Bild aus update): Rutschen (gekantet, tiefer), Hinlegen (Waffe schwingt
   * beim Übergang ab und kommt wieder), Ducken (kurzer Federruck beim Wechsel), Spawn → Bereitmachen, Leerlauf → Geste.
   * Kosmetische Aktionen enden bei Schuss, Anschlag, Sprint oder Bewegung.
   */
  _moveExtras(P, R, s, dt, na) {
    const pl = this.G?.player;
    // Rutschen
    this._slide = damp(this._slide || 0, pl && pl.sliding ? 1 : 0, pl && pl.sliding ? 10 : 6, dt);
    if (this._slide > 1e-3) {
      const sl = smooth(this._slide) * na;
      P.x -= 0.02 * sl; P.y -= 0.035 * sl; P.z += 0.03 * sl;
      R.x += 0.06 * sl; R.y += 0.08 * sl; R.z += 0.32 * sl;
    }
    // Hinlegen/Aufstehen: Bogen während des Übergangs (Waffe senkt sich, Hand stützt ab)
    const pb = clamp(pl?.proneBlend ?? 0, 0, 1);
    const arc = 4 * pb * (1 - pb);
    if (arc > 1e-3) { P.y -= 0.07 * arc * na; P.x += 0.02 * arc * na; R.x -= 0.35 * arc * na; R.z += 0.25 * arc * na; }
    // Ducken: kurzer Federruck beim Wechsel
    const cr = !!s.crouching;
    if (this._wasCrouch !== undefined && cr !== this._wasCrouch && !(pl && pl.sliding)) this._land.kick((cr ? -0.55 : 0.4) * this._motionScale());
    this._wasCrouch = cr;
    // Spawn → Bereitmachen nach dem Ziehen (einmal je Leben)
    const spawn = pl && Number.isFinite(pl.spawnTime) ? pl.spawnTime : null;
    if (spawn !== null && spawn !== this._spawnSeen) { this._spawnSeen = spawn; this._readyPending = pl.alive !== false; }
    const a = this.action;
    const calm = !s.firing && !s.ads && !s.sprinting && !s.reloading && (s.timeSinceShot ?? 9) > 0.1;
    const idle = calm && (s.speed ?? 0) < 0.6 && s.onGround !== false;
    // Bereitmachen läuft auch im Gehen weiter; die Leerlauf-Geste endet bei jeder Bewegung
    if (a && !a.cancel && ((a.type === 'ready' && !calm) || (a.type === 'fidget' && !idle))) a.cancel = true;
    if (this._readyPending && !this.action && this._equipT >= 1 && !this._lowering) {
      this._readyPending = false;
      if (calm) this.playReady();
    }
    // Leerlauf-Geste nach 14–22 s Stillstand ohne Eingabe (Blick bewegen zählt als Eingabe)
    const look = Math.abs(s.lookDX || 0) + Math.abs(s.lookDY || 0);
    if (!idle || this.action || look > 0.002 || this._ads > 0.05) this._idleT = 0;
    else {
      this._idleT = (this._idleT || 0) + dt;
      if (this._idleT > (this._idleNext || (this._idleNext = 14 + Math.random() * 8))) { this._idleT = 0; this._idleNext = 14 + Math.random() * 8; this.playFidget(); }
    }
  },

  /**
   * Überklettern ohne laufende Aktion: Stützhand greift nach vorn unten auf das Hindernis (Handfläche nach unten).
   * Liefert eine Ersatz-Aktion nur mit der Handanfrage (oder null).
   */
  _mantleAct() {
    if (this._mantle < 0.02 || this.h.leftGrip === 'none') return null;
    const o = this._mantleOut || (this._mantleOut = { p: [0, 0, 0], r: [0, 0, 0], left: { n: 0, items: Array.from({ length: 2 }, () => ({})) }, right: { n: 0, items: [] }, parts: {}, frame: 0 });
    o.left.n = 0;
    req(o.left, smooth(clamp(this._mantle * 1.2, 0, 1)), { free: [[-0.17, -0.2, -0.44], [0.1, -0.35, -0.93], [0.05, 0.95, -0.3], 'flat'] });
    return o;
  },

  // ---------------------------------------------------------------- Nahkampf mit Schusswaffe: Schlag mit der Waffe

  /** Stoß mit der Waffe (Gewehr: Mündungsstoß nach vorn oben; Pistole: Schlag mit dem Griffstück schräg nach unten). */
  _actGunStrike(A, out) {
    const u = clamp(A.t / A.dur, 0, 1);
    const pist = this.h.action === 'pistol' || this.h.action === 'revolver';
    if (pist) {
      curve(u, [[0, Z3], [0.12, [0.04, 0.08, 0.06]], [0.24, [-0.12, -0.04, -0.1]], [0.38, [-0.1, -0.06, -0.06]], [0.85, Z3]], out.p);
      curve(u, [[0, Z3], [0.12, [0.6, -0.3, -0.4]], [0.24, [-0.7, 0.5, 0.9]], [0.38, [-0.65, 0.45, 0.85]], [0.85, Z3]], out.r);
    } else {
      curve(u, [[0, Z3], [0.12, [0.02, -0.03, 0.08]], [0.24, [-0.05, 0.05, -0.17]], [0.38, [-0.04, 0.04, -0.14]], [0.85, Z3]], out.p);
      curve(u, [[0, Z3], [0.12, [-0.15, -0.2, 0.25]], [0.24, [0.2, 0.15, -0.35]], [0.38, [0.18, 0.12, -0.3]], [0.85, Z3]], out.r);
    }
    if (u > 0.2 && !A.hit) { A.hit = true; this.onMeleeHit?.(); this._jolt.kick(1.2, 0.3, 0); this._recoilPos.kick(0, 0, 0.12); }
    return u >= 1;
  },
};

/**
 * Granate von unten (aus der Hocke/im Liegen): gleiche Zeitpunkte wie über Kopf (Splint 0,3–0,36, Halten 0,47,
 * Loslassen 0,66 – controller GRENADE), die Hand schwingt tief nach hinten und wirft flach nach vorn oben.
 */
export const GRENADE_LOW = {
  pos: [[0.05, [0.2, -0.4, -0.2]], [0.2, [0.1, -0.16, -0.3]], [0.47, [0.08, -0.15, -0.29]], [0.58, [0.16, -0.36, -0.14]], [0.68, [0.04, -0.14, -0.46]], [0.8, [-0.02, -0.12, -0.42]], [0.96, [0.0, -0.45, -0.25]]],
  F: [[0.05, [-0.4, 0.6, -0.6]], [0.2, [-0.45, 0.55, -0.55]], [0.47, [-0.45, 0.55, -0.55]], [0.58, [-0.1, -0.7, 0.4]], [0.68, [0.0, 0.2, -0.98]], [0.8, [-0.05, 0.6, -0.8]]],
  B: [[0.05, [0.75, 0.2, 0.45]], [0.47, [0.75, 0.2, 0.45]], [0.58, [0.6, 0.2, 0.75]], [0.68, [0.3, -0.85, 0.1]], [0.8, [0.6, -0.4, 0.5]]],
};
