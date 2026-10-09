// NULLPUNKT – Ego-Ansicht: Nachladen mit Varianten (Animationen 09.10.). Wird in viewmodel.js in ViewModel.prototype
// gemischt (wie gunsmith/actions2.js) und ersetzt die alten Einzel-Choreografien der Magazinwaffen.
//
// Grundsätze
//  • Dauer = Spielzeit: der Controller schiebt die Aktion über reloadProgress (b.t = Fortschritt × Dauer), die Dauer
//    kommt aus den Waffendaten (reloadTime / reloadEmptyTime). Das neue Magazin sitzt VOR dem Zeitpunkt, an dem der
//    Controller die Munition gutschreibt (taktisch 76 %, leer 64 % – controller.js insertAt).
//  • Varianten sind rein optisch und werden je Client zufällig gewählt (nie zweimal dieselbe hintereinander);
//    Spielzeit, Munition und Abbruch sind für Host und Clients identisch.
//  • Magazin als harter Körper (anim/magwell.js): im Schacht bewegt es sich nur entlang der Einführachse; erst nach
//    dem Freigang darf die Hand es kippen oder seitlich führen – beim Einsetzen ist es vor dem Schacht ausgerichtet.
//  • Patronen im Magazin (gunsmith/magfill.js): bis zum Ablegen zeigt das Teil den alten Füllstand, ab dem
//    Ausblenden (altes Magazin in der Welt bzw. in der Tasche) den des neuen (A.magNew, wie der Controller rechnet).
//
// Ausgaben wie die Basisaktionen: out.p/out.r (Waffe, Kameraraum), out.left/out.right (Handanfragen),
// out.parts (Teilversätze [dx, dy, dz, rx, ry, rz] im Elternraum, _vis), out.frame (Arbeitsstelle ins Bild).
import * as THREE from 'three';
import { curve, windowW, clamp, smooth } from '../gunsmith/anim.js';
import { magWellOf, magOffset } from './magwell.js';

const Z3 = [0, 0, 0];
const _f = [0, 0, 0, 0, 0, 0];
const _v3 = new THREE.Vector3();

/** Kosmetische Aktionen (anim/moves.js): zählen nicht als „beschäftigt“, jede echte Aktion ersetzt sie. */
export const COSMETIC = new Set(['ready', 'fidget']);

// Handanfrage anhängen (wie viewmodel.js req)
export function req(list, w, o) {
  if (w <= 0 || list.n >= list.items.length) return;
  const r = list.items[list.n++];
  r.w = w; r.anchor = o.anchor || null; r.style = o.style || null; r.data = o.data || null;
  r.part = o.part || null; r.offset = o.offset || null; r.free = o.free || null; r.dy = o.dy || 0;
}
const vis = (out) => out.parts._vis || (out.parts._vis = {});

// Stützhand an der Magazintasche (Kameraraum, knapp unter dem Bildrand): Position, Fingerrichtung, Handrücken
const POUCH = [[-0.12, -0.34, -0.27], [0.25, 0.75, -0.6], [-0.75, 0.3, 0.35], 'relaxed'];

/**
 * Magazinwechsel-Varianten je Nachladestil. Zeiten in m (0..1 des Magazin-Teils; beim Leer-Nachladen endet er bei k,
 * danach folgt das Durchladen). Felder:
 *   r, p    Waffenlage (Schlüsselbilder)   frame  Fenster „Arbeitsstelle ins Bild“
 *   mode    'pull' = Hand zieht das Magazin und lässt es außen fallen | 'fall' = Magazin fällt frei (Daumen am Halter),
 *           die Hand holt währenddessen das neue aus der Tasche
 *   grab    Hand am Magazin [a, b] (Anfang der Rampe)    out [o0, o1] Herausziehen bis zum Freigang
 *   away    Ende der Ausholbewegung (Magazin fällt dort in die Welt)   back  neues Magazin sichtbar (unten, aus der Tasche)
 *   align   ausgerichtet unter dem Schacht   seat  sitzt (Ruck)   rel  Hand zurück am Stützgriff (Ende)
 *   fAway/fNew  freie Lage (Modellraum: x rechts, y oben, z zum Schützen) beim Wegwerfen bzw. Holen
 */
const BASE_PULL = {
  mode: 'pull', grab: [0.14, 0.25], out: [0.27, 0.34], away: 0.41, back: 0.47, align: 0.58, seat: 0.665, rel: [0.68, 0.8],
  fAway: [-0.05, -0.12, 0.05, 0.35, 0, 0.1], fNew: [-0.06, -0.12, 0.04, 0.3, 0, 0.12], sAway: 0.07,
};
const BASE_FALL = {
  mode: 'fall', press: 0.16, out: [0.17, 0.26], away: 0.27, back: 0.36, align: 0.52, seat: 0.6, rel: [0.62, 0.76],
  hand: [0.06, 0.18], take: [0.3, 0.38], fAway: [0.0, -0.06, 0.02, 0.25, 0, -0.15], fNew: [-0.07, -0.14, 0.05, 0.35, 0, 0.15], sAway: 0.1,
};
export const MAG_RELOADS = {
  mag: [
    { ...BASE_PULL, name: 'ziehen',
      r: [[0, Z3], [0.13, [0.16, 0.2, -0.46]], [0.8, [0.18, 0.22, -0.5]], [0.95, Z3]],
      p: [[0, Z3], [0.13, [-0.045, 0.045, 0.05]], [0.8, [-0.045, 0.05, 0.05]], [0.95, Z3]], frame: [0.08, 0.22, 0.7, 0.86] },
    { ...BASE_FALL, name: 'fallen',
      r: [[0, Z3], [0.11, [0.3, 0.1, -0.3]], [0.7, [0.32, 0.12, -0.34]], [0.9, Z3]],
      p: [[0, Z3], [0.11, [-0.03, 0.04, 0.06]], [0.7, [-0.032, 0.045, 0.06]], [0.9, Z3]], frame: [0.06, 0.18, 0.64, 0.8] },
  ],
  bullpup: [
    { ...BASE_PULL, name: 'ziehen',
      r: [[0, Z3], [0.14, [0.34, 0.62, -0.34]], [0.82, [0.36, 0.64, -0.36]], [0.96, Z3]],
      p: [[0, Z3], [0.14, [-0.02, 0.07, -0.08]], [0.82, [-0.02, 0.072, -0.08]], [0.96, Z3]], frame: [0.06, 0.18, 0.72, 0.88],
      fAway: [-0.04, -0.12, 0.06, 0.3, 0, 0.1], fNew: [-0.05, -0.12, 0.05, 0.25, 0, 0.12] },
    { ...BASE_FALL, name: 'fallen',
      r: [[0, Z3], [0.12, [0.42, 0.5, -0.2]], [0.72, [0.44, 0.52, -0.22]], [0.92, Z3]],
      p: [[0, Z3], [0.12, [-0.03, 0.08, -0.06]], [0.72, [-0.03, 0.082, -0.06]], [0.92, Z3]], frame: [0.06, 0.18, 0.66, 0.82] },
  ],
  drum: [
    { ...BASE_PULL, name: 'ziehen', grab: [0.1, 0.2], out: [0.24, 0.33], away: 0.41, back: 0.48, align: 0.6, seat: 0.69, rel: [0.72, 0.84],
      r: [[0, Z3], [0.1, [0.1, 0.22, -0.4]], [0.84, [0.12, 0.24, -0.42]], [0.96, Z3]],
      p: [[0, Z3], [0.1, [-0.03, 0.03, 0.06]], [0.84, [-0.03, 0.032, 0.06]], [0.96, Z3]], frame: [0.06, 0.16, 0.74, 0.9],
      fAway: [-0.06, -0.12, 0.04, 0.2, 0, 0.1], fNew: [-0.07, -0.13, 0.04, 0.2, 0, 0.12] },
    { ...BASE_PULL, name: 'pruefen', grab: [0.1, 0.2], out: [0.24, 0.33], away: 0.4, back: 0.47, align: 0.6, seat: 0.69, rel: [0.72, 0.84],
      r: [[0, Z3], [0.12, [0.22, 0.05, -0.55]], [0.84, [0.24, 0.06, -0.58]], [0.96, Z3]],
      p: [[0, Z3], [0.12, [-0.04, 0.05, 0.05]], [0.84, [-0.04, 0.052, 0.05]], [0.96, Z3]], frame: [0.06, 0.16, 0.74, 0.9],
      // neue Trommel vor dem Einsetzen kurz zum Fenster drehen (Füllstand prüfen)
      fAway: [-0.05, -0.12, 0.05, 0.25, 0, 0.1], fNew: [-0.06, -0.1, 0.06, 0.1, 0.6, 0.1] },
  ],
  gripmag: [
    { ...BASE_PULL, name: 'ziehen', grab: [0.1, 0.2], out: [0.2, 0.3], away: 0.33, back: 0.39, align: 0.5, seat: 0.6, rel: [0.64, 0.8],
      r: [[0, Z3], [0.12, [0.32, 0.24, -0.34]], [0.8, [0.34, 0.26, -0.36]], [0.95, Z3]],
      p: [[0, Z3], [0.12, [-0.03, 0.045, -0.02]], [0.8, [-0.03, 0.046, -0.02]], [0.95, Z3]], frame: [0.06, 0.16, 0.66, 0.84],
      fAway: [-0.03, -0.1, 0.04, 0.3, 0, 0.1], fNew: [-0.04, -0.1, 0.03, 0.3, 0, 0.1] },
    { ...BASE_FALL, name: 'fallen', press: 0.12, out: [0.13, 0.22], away: 0.24, back: 0.32, align: 0.46, seat: 0.56, rel: [0.6, 0.76], hand: [0.04, 0.14], take: [0.26, 0.34],
      r: [[0, Z3], [0.1, [0.4, 0.1, -0.2]], [0.76, [0.42, 0.12, -0.22]], [0.92, Z3]],
      p: [[0, Z3], [0.1, [-0.025, 0.05, -0.02]], [0.76, [-0.025, 0.052, -0.02]], [0.92, Z3]], frame: [0.05, 0.14, 0.62, 0.8],
      fAway: [0, -0.06, 0.02, 0.2, 0, 0], fNew: [-0.04, -0.1, 0.04, 0.3, 0, 0.1] },
  ],
  pistol: [
    { ...BASE_PULL, name: 'ziehen', grab: [0.1, 0.2], out: [0.18, 0.28], away: 0.3, back: 0.36, align: 0.47, seat: 0.58, rel: [0.62, 0.8],
      r: [[0, Z3], [0.12, [0.36, 0.22, -0.42]], [0.8, [0.38, 0.24, -0.45]], [0.95, Z3]],
      p: [[0, Z3], [0.12, [-0.035, 0.055, 0.0]], [0.8, [-0.035, 0.056, 0.0]], [0.95, Z3]], frame: [0.06, 0.16, 0.66, 0.84],
      fAway: [-0.03, -0.08, 0.03, 0.3, 0, 0.1], fNew: [-0.05, -0.1, 0.03, 0.35, 0, 0.12] },
    { ...BASE_FALL, name: 'fallen', press: 0.1, out: [0.11, 0.2], away: 0.22, back: 0.3, align: 0.44, seat: 0.54, rel: [0.58, 0.76], hand: [0.04, 0.12], take: [0.24, 0.32],
      r: [[0, Z3], [0.1, [0.5, 0.06, -0.12]], [0.76, [0.52, 0.08, -0.14]], [0.92, Z3]],
      p: [[0, Z3], [0.1, [-0.04, 0.06, 0.0]], [0.76, [-0.04, 0.062, 0.0]], [0.92, Z3]], frame: [0.05, 0.14, 0.62, 0.8],
      fAway: [0, -0.05, 0.02, 0.15, 0, 0], fNew: [-0.05, -0.1, 0.04, 0.35, 0, 0.12] },
  ],
  top: [
    // QX-90: Magazin nach hinten aus der Visierbrücke schieben (Achse), dann hoch und weg; neues hinten auflegen,
    // nach vorn unter die Brücke schieben und einrasten
    { ...BASE_PULL, name: 'schieben', grab: [0.12, 0.22], out: [0.24, 0.36], away: 0.41, back: 0.47, align: 0.56, seat: 0.67, rel: [0.7, 0.82], sAway: 0.04,
      r: [[0, Z3], [0.14, [0.1, 0.24, 0.42]], [0.8, [0.1, 0.24, 0.44]], [0.95, Z3]],
      p: [[0, Z3], [0.14, [-0.01, -0.05, -0.1]], [0.8, [-0.01, -0.05, -0.1]], [0.95, Z3]], frame: [0.08, 0.22, 0.72, 0.88],
      fAway: [-0.12, 0.08, 0.02, 0, 0, 0.4], fNew: [-0.12, 0.1, 0.0, 0, 0, 0.35] },
    { ...BASE_PULL, name: 'kippen', grab: [0.12, 0.22], out: [0.24, 0.36], away: 0.41, back: 0.47, align: 0.56, seat: 0.67, rel: [0.7, 0.82], sAway: 0.04,
      r: [[0, Z3], [0.14, [0.3, 0.36, 0.2]], [0.8, [0.32, 0.38, 0.22]], [0.95, Z3]],
      p: [[0, Z3], [0.14, [-0.03, -0.03, -0.09]], [0.8, [-0.03, -0.03, -0.09]], [0.95, Z3]], frame: [0.08, 0.22, 0.72, 0.88],
      fAway: [-0.1, 0.1, 0.03, 0.3, 0, 0.3], fNew: [-0.11, 0.12, 0.02, 0.25, 0, 0.3] },
  ],
};
// Leer-Nachladen: Anteil des Magazin-Teils (Rest = Durchladen)
const EMPTY_K = { mag: 0.74, bullpup: 0.76, drum: 0.8, gripmag: 0.72, pistol: 0.78, top: 0.78 };

/**
 * Zeit für die Waffenlage beim Leer-Nachladen: bis zum vorletzten Schlüsselbild (Haltepose) wie m, dann gehalten;
 * der Rückweg zur Ruhelage (letztes Schlüsselbild) läuft erst am Ende der ganzen Aktion (u).
 */
function poseTime(keys, m, u) {
  const n = keys.length, hold = keys[n - 2][0], end = keys[n - 1][0], ret = end - hold;
  const u0 = 1 - ret - 0.03;
  if (u < u0) return Math.min(m, hold);
  return hold + ret * clamp((u - u0) / ret, 0, 1);
}

export const RELOAD_ACTIONS = {
  /** Anzahl optischer Varianten je Nachladestil (empty: Leer-Nachladen). */
  _reloadVariants(style, empty) {
    if (MAG_RELOADS[style]) return MAG_RELOADS[style].length;
    if (style === 'belt' || style === 'shell') return 2;
    return 1;
  },

  /** Variante wählen: vorgegeben (0..n−1) oder zufällig, nie zweimal dieselbe hintereinander. */
  _pickVariant(key, n, want) {
    if (n <= 1) return 0;
    if (Number.isFinite(want)) return ((want % n) + n) % n;
    const last = (this._lastVariant || (this._lastVariant = {}))[key];
    let v = Math.floor(Math.random() * n);
    if (v === last) v = (v + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this._lastVariant[key] = v;
    return v;
  },

  _actReload(A, out) {
    const u = clamp(A.t / A.dur, 0, 1);
    const style = A.style;
    if (MAG_RELOADS[style]) return this._magReload(A, out, u, style);
    if (style === 'revolver') return this._actReloadRevolver(A, out, u);
    if (style === 'rocket') return this._actReloadRocket(A, out, u);
    if (style === 'belt') return this._actReloadBelt(A, out, u);
    return u >= 1;
  },

  /**
   * Magazinwechsel (alle Kastenmagazine): Waffe kippen, Magazin entlang der Schachtachse heraus, wegwerfen/fallen
   * lassen, neues holen, ausrichten, entlang der Achse einsetzen (Ruck), Hand zurück; leer: danach durchladen.
   */
  _magReload(A, out, u, style) {
    const ud = this.cur.ud, an = ud.anchors;
    const V = MAG_RELOADS[style][A.variant % MAG_RELOADS[style].length];
    const empty = A.empty;
    const k = empty ? (EMPTY_K[style] ?? 0.75) : 1;
    const m = u / k;
    const mw = magWellOf(this.cur);
    // Waffe: leer bleibt sie nach dem Magazin gekippt, bis durchgeladen ist (Rückweg wie taktisch am Ende)
    const mp = empty ? poseTime(V.r, m, u) : m;
    curve(mp, V.r, out.r);
    curve(mp, V.p, out.p);
    out.frame = empty ? Math.max(windowW(m, V.frame[0], V.frame[1], 2, 3) * (1 - smooth(clamp((u - 0.86) / 0.12, 0, 1))), 0) : windowW(m, ...V.frame);
    // Bolzen-zuerst (Repetierer, Variante 2 leer): Kammer vor dem Magazinwechsel öffnen, am Ende schließen
    const boltFirst = empty && this.h.action === 'bolt' && A.variant === 1;
    if (boltFirst) this._boltOpenHold(A, out, u);
    // HK-Spannhebel (Variante 2 leer): Hebel zuerst zurück und oben einrasten, am Ende herunterschlagen
    const hkLock = empty && A.variant === 1 && an.chargeGrab?.userData.style === 'hkslap';
    if (hkLock) this._hkLock(A, out, u, k);
    // Magazin: Weg s entlang der Achse + freie Lage nach dem Freigang
    const clear = mw ? mw.clear : 0.03;
    const sOut = clear + V.sAway;
    let s = 0;
    const free = _f;
    for (let i = 0; i < 6; i++) free[i] = 0;
    const fA = V.fAway, fN = V.fNew, dip = V.dip ?? 0.14;
    let hidden = false;
    if (m < V.out[0]) s = 0;
    else if (m < V.out[1]) {
      const c = (m - V.out[0]) / (V.out[1] - V.out[0]);
      // gezogen: gleichmäßig bis knapp nach dem Freigang; gefallen: beschleunigt (Schwerkraft) bis 4 cm darunter
      s = V.mode === 'fall' ? (clear + 0.04) * c * c : (clear + 0.012) * smooth(c);
    } else if (V.mode === 'fall' && m < V.back) {
      hidden = true;
      s = sOut;
    } else if (V.mode === 'pull' && m < V.away) {
      const c = smooth((m - V.out[1]) / Math.max(1e-3, V.away - V.out[1]));
      s = clear + 0.012 + (sOut - clear - 0.012) * c;
      for (let i = 0; i < 6; i++) free[i] = fA[i] * c;
    } else if (m < V.back) {
      // ausgeblendet (altes Magazin liegt in der Welt): Hand taucht zur Tasche ab – das unsichtbare Teil führt sie
      // stetig von der Wurflage bis zur Tasche unter dem Bildrand, dort erscheint das neue Magazin
      hidden = true;
      const c = smooth((m - V.away) / (V.back - V.away));
      s = sOut + 0.015 * c;
      for (let i = 0; i < 6; i++) free[i] = fA[i] + (fN[i] - fA[i]) * c;
      free[1] -= dip * c; free[2] += dip * 0.4 * c;
    } else if (m < V.align) {
      // neues Magazin: aus der Tasche (unter dem Bildrand) heran, unter dem Schacht ausgerichtet (Freigang + 15 mm)
      const c = smooth((m - V.back) / (V.align - V.back));
      s = clear + 0.015 + (sOut - clear) * (1 - c);
      for (let i = 0; i < 6; i++) free[i] = fN[i] * (1 - c);
      free[1] -= dip * (1 - c); free[2] += dip * 0.4 * (1 - c);
    } else if (m < V.seat) {
      const c = (m - V.align) / (V.seat - V.align);
      s = (clear + 0.015) * (1 - smooth(c));
    } else s = 0;
    out.parts.mag = magOffset(mw, s, free, A._mo || (A._mo = [0, 0, 0, 0, 0, 0]));
    if (hidden) vis(out).mag = false;
    // Altes Magazin in die Welt (einmal) – ab dann zeigt das Teil den Füllstand des neuen
    const dropAt = V.mode === 'fall' ? V.out[1] : V.away;
    if (m >= dropAt && !A.dropped && !A.cancel) { A.dropped = true; this._dropMag(); }
    if (m >= dropAt && A.magNew == null && !A.cancel) A.magNew = this._freshMag();
    if (m >= dropAt && m < V.back) vis(out).mag = false;
    // Ruck beim Einrasten
    if (m >= V.seat && !A.slapped) { A.slapped = true; this._jolt.kick(style === 'drum' ? 1.6 : 1.25, 0, 0); this._recoilPos.kick(0, 0.004, 0); }
    if (V.mode === 'fall' && m >= V.press && !A.pressed) { A.pressed = true; this._jolt.kick(0.35, 0, 0); }
    // Stützhand
    const grabStyle = style === 'top' ? 'magTop' : 'mag';
    const grab = an.magGrab ? { anchor: an.magGrab, style: grabStyle } : { part: 'mag', style: grabStyle };
    if (V.mode === 'pull') {
      const w = windowW(m, V.grab[0], V.grab[1], V.rel[0], V.rel[1]);
      if (w > 0) req(out.left, w, grab);
    } else {
      // Tasche (frei) → neues Magazin (Teil) → Handballen schlägt es ein → Stützgriff
      const wP = windowW(m, V.hand[0], V.hand[1], V.take[0], V.take[1]);
      if (wP > 0) req(out.left, wP, { free: POUCH });
      const wM = windowW(m, V.take[0], V.take[1], V.rel[0], V.rel[1]);
      if (wM > 0) req(out.left, wM, grab);
    }
    // Pistolen: Schlitten bleibt beim Leer-Nachladen hinten; Variante 1 löst ihn mit dem Fanghebel, Variante 2 mit Überhandgriff
    if (style === 'pistol') {
      if (empty) this._pistolSlide(A, out, u, k);
      return u >= 1;
    }
    if (empty && !boltFirst) {
      const c = (u - k) / (1 - k);
      if (this.h.action === 'bolt') { if (c > 0) this._boltMotion(c, out, true); }
      else if (hkLock) { /* Hebel wurde vorn verriegelt, _hkLock schlägt ihn herunter */ }
      else this._emptyCharge(A, out, c);
    }
    return u >= 1;
  },

  /**
   * Durchladen nach dem Leer-Nachladen (c = 0..1). Verschlussfang (AR): Variante 1 Handballen auf den Fanghebel,
   * Variante 2 Spannhebel hinten ziehen. Sonst Spannhebel (Seite/rechts/oben), Variante 2 mit stärker gekanteter Waffe.
   */
  _emptyCharge(A, out, c) {
    const an = this.cur.ud.anchors, ch = an.chargeGrab;
    if (!ch || c < -0.05) return;
    const st = ch.userData.style || 'pull';
    if (st === 'release' && an.boltCatch && A.variant !== 1) {
      const wC = windowW(c, 0.0, 0.32, 0.55, 0.85);
      if (wC > 0) req(out.left, wC, { anchor: an.boltCatch, style: 'slapSide' });
      if (c > 0.45 && !A.charged) { A.charged = true; this._boltLocked = false; this._boltT = 0.3; this._jolt.kick(0.9, 0.25, 0); }
      const rc = windowW(c, 0.0, 0.25, 0.55, 0.95);
      out.r[2] += 0.12 * rc; out.r[1] += 0.06 * rc;
      return;
    }
    if (st === 'release') {
      // T-Spannhebel hinten oben: Zeige-/Mittelfinger ziehen ihn zurück, Waffe leicht angehoben und zur Kamera gedreht
      const travel = ch.userData.travel || [0, 0, 0.065];
      const pull = curve(c, [[0.22, 0], [0.44, 1], [0.52, 1], [0.57, 0]]);
      out.parts[ch.parent?.name || 'charge'] = [travel[0] * pull, travel[1] * pull, travel[2] * pull, 0, 0, 0];
      const wC = windowW(c, 0.0, 0.2, 0.6, 0.86);
      if (wC > 0) req(out.left, wC, { anchor: ch, style: 'pinchSide' });
      const rc = windowW(c, 0.0, 0.2, 0.62, 0.95);
      out.r[0] += 0.16 * rc; out.r[1] += 0.12 * rc; out.r[2] += 0.06 * rc; out.p[1] += 0.015 * rc;
      if (c > 0.55 && !A.charged) { A.charged = true; this._boltLocked = false; this._boltT = 0.3; this._jolt.kick(0.8, 0.3, 0); }
      return;
    }
    this._chargeCycle(A, out, c);
    this._chargeReach(out, windowW(c, 0.0, 0.2, 0.62, 0.95));
    if (A.variant === 1) {
      // Variante 2: kräftiger gekantet (Hebelseite steiler zur Kamera), kurzer Ruck nach dem Loslassen
      const rc = windowW(c, 0.0, 0.2, 0.62, 0.95);
      out.r[2] += (st === 'right' ? 0.16 : 0.12) * rc; out.r[0] += 0.04 * rc; out.p[1] += 0.01 * rc;
    }
  },

  /**
   * Liegt der Spannhebel hinter dem Pistolengriff (KM-7, QX-90 …), greift die Hand dicht vor der Kamera – die Waffe
   * wird dafür nach vorn unten geschoben (w = Gewicht des Griffs zum Hebel).
   */
  _chargeReach(out, w) {
    if (w <= 0) return;
    const ch = this.cur.ud.anchors.chargeGrab;
    if (!ch) return;
    const z = this.cur.chargeZ ?? (this.cur.chargeZ = this.cur.model.worldToLocal(ch.getWorldPosition(_v3)).z);
    const k = clamp((z + 0.06) / 0.1, 0, 1) * w;   // ab 6 cm vor dem Griff zunehmend
    if (k <= 0) return;
    out.p[2] -= 0.1 * k; out.p[1] -= 0.02 * k; out.p[0] -= 0.02 * k;
  },

  /** HK-Spannhebel (Variante 2 leer): zuerst zurückziehen und oben einrasten, nach dem Magazin herunterschlagen. */
  _hkLock(A, out, u, k) {
    const ch = this.cur.ud.anchors.chargeGrab;
    const travel = ch.userData.travel || [0, 0, 0.075], name = ch.parent?.name || 'charge';
    // 0,02–0,12: ziehen + hochdrehen; gehalten bis zum Schlag (k + 0,45 · Rest)
    const tS = k + (1 - k) * 0.4;
    const back = curve(u, [[0.03, 0], [0.09, 1], [tS - 0.01, 1], [tS + 0.03, 0]]);
    const lift = curve(u, [[0.08, 0], [0.12, 1], [tS - 0.02, 1], [tS, 0]]);
    out.parts[name] = [travel[0] * back, travel[1] * back, travel[2] * back, 0, 0, -0.6 * lift];
    const w1 = windowW(u, 0.0, 0.04, 0.11, 0.16);
    if (w1 > 0) req(out.left, w1, { anchor: ch, style: 'pinchSide' });
    const w2 = windowW(u, tS - 0.12, tS - 0.02, tS + 0.03, tS + 0.12);
    if (w2 > 0) req(out.left, w2, { anchor: ch, style: 'slapSide', dy: 0.012 });
    const rc = windowW(u, tS - 0.14, tS - 0.04, tS + 0.04, tS + 0.16);
    out.r[2] += 0.16 * rc; out.r[1] += 0.08 * rc;
    if (u >= tS && !A.charged) { A.charged = true; this._boltLocked = false; this._boltT = 0.3; this._jolt.kick(1.0, 0.3, 0); }
  },

  /** Repetierer, leer, Variante 2: Kammerstängel öffnen und hinten halten, Magazin wechseln, Kammer schließen. */
  _boltOpenHold(A, out, u) {
    const bg = this.cur.ud.anchors.boltGrab;
    if (!bg) return;
    const rot = bg.userData.rot ?? 1.05, travel = bg.userData.travel?.[2] ?? 0.09;
    const up = curve(u, [[0.03, 0], [0.09, 1], [0.86, 1], [0.92, 0]]);
    const back = curve(u, [[0.09, 0], [0.14, 1], [0.8, 1], [0.86, 0]]);
    out.parts.boltHandle = [0, 0, travel * back, 0, 0, rot * up];
    const w1 = windowW(u, 0.0, 0.04, 0.13, 0.19), w2 = windowW(u, 0.74, 0.79, 0.92, 0.98);
    if (w1 > 0) req(out.right, w1, { anchor: bg, style: 'boltKnob' });
    if (w2 > 0) req(out.right, w2, { anchor: bg, style: 'boltKnob' });
    const rc = Math.max(windowW(u, 0.0, 0.06, 0.12, 0.2), windowW(u, 0.72, 0.8, 0.9, 1.0));
    out.r[2] += 0.12 * rc; out.r[1] += 0.05 * rc;
    if (u > 0.86 && !A.charged) { A.charged = true; this._jolt.kick(0.7, 0.2, 0); }
  },

  /** Pistole leer: Variante 1 Fanghebel (Daumen, Schlitten schnellt vor), Variante 2 Schlitten überhand zurückziehen. */
  _pistolSlide(A, out, u, k) {
    const sg = this.cur.ud.anchors.slideGrab;
    if (A.variant !== 1 || !sg) {
      if (u < k + (1 - k) * 0.2) this._slideLocked = true;
      else if (this._slideLocked) { this._slideLocked = false; this._boltT = 0.3; this._jolt.kick(0.9, 0.2, 0); }
      return;
    }
    const c = (u - k) / (1 - k);
    if (c < 0.42) this._slideLocked = true;
    else if (this._slideLocked) { this._slideLocked = false; this._boltT = 0.3; this._jolt.kick(1.0, 0.25, 0); }
    // Überhand: Stützhand umfasst das Schlittenende von oben, zieht minimal nach (Schlitten ist schon hinten) und lässt los
    const w = windowW(c, 0.0, 0.25, 0.42, 0.62);
    if (w > 0) req(out.left, w, { anchor: sg, style: 'rack', dy: 0.006 });
    const rc = windowW(c, 0.0, 0.22, 0.45, 0.8);
    out.r[2] += 0.55 * rc; out.r[0] += 0.2 * rc; out.r[1] -= 0.12 * rc; out.p[0] -= 0.05 * rc; out.p[1] += 0.02 * rc; out.p[2] += 0.03 * rc;
  },

  /**
   * Gurtwechsel (HM-60): Deckel auf, Gurt aus der Zuführung heben, Kasten ab (Achse nach unten, dann weg), neuer
   * Kasten, Gurt einlegen, Deckel zu (Ruck), leer: durchladen. Die Schusshand klappt den Deckel, die Stützhand wechselt
   * den Kasten; Variante 2 zusätzlich mit Gurt einlegen und weiter zur Kamera gedrehter Waffe.
   * Leer läuft der Wechsel gestaucht (Deckel zu vor 64 % = Munition gutgeschrieben), danach der Spannhebel.
   */
  _actReloadBelt(A, out, u) {
    const ud = this.cur.ud, empty = A.empty, v2 = A.variant === 1;
    const k = empty ? 0.84 : 1, m = u / k;
    const mw = magWellOf(this.cur);
    const R = v2 ? [0.16, 0.42, 0.3] : [0.1, 0.32, 0.38], P = v2 ? [-0.01, -0.03, -0.02] : [0.0, -0.035, -0.02];
    const keysR = [[0, Z3], [0.08, R], [0.86, R], [0.97, Z3]], keysP = [[0, Z3], [0.08, P], [0.86, P], [0.97, Z3]];
    const mp = empty ? poseTime(keysR, m, u) : m;
    curve(mp, keysR, out.r);
    curve(mp, keysP, out.p);
    // Deckel: angehoben 0,1–0,14 (Hand am Riegel), schwingt bis 0,19 allein auf; zu: Hand fängt ihn halb offen ab
    // (0,66) und drückt ihn zu (0,74) – die Hand folgt dem Deckel nie ganz nach oben (sonst Unterarm vor der Kamera)
    const cover = curve(m, [[0.1, 0], [0.14, -0.45], [0.19, -1.15], [0.62, -1.15], [0.67, -0.5], [0.74, 0]]);
    out.parts.cover = [0, 0, 0, cover, 0, 0];
    if (m > 0.735 && !A.slapped) { A.slapped = true; this._jolt.kick(1.5, 0, 0); }
    // Gurt: bei offenem Deckel aus der Zuführung nach oben/links heben (nicht durch das Gehäuse), dann mit dem Kasten
    // ausgeblendet; neuer Gurt liegt angehoben über der Zuführung und wird eingelegt
    const lift = curve(m, [[0.19, 0], [0.25, 1], [0.27, 1]]) * (m < 0.3 ? 1 : 0) + curve(m, [[0.58, 1], [0.66, 0]]) * (m >= 0.58 ? 1 : 0);
    out.parts.belt = [-0.02 * lift, 0.035 * lift, 0, 0, 0, 0];
    const beltHidden = m > 0.27 && m < 0.58;
    // Kasten: Achse (11 mm nach unten von der Halterung), dann nach links unten weg; neuer Kasten von unten links
    const clear = mw ? mw.clear : 0.012;
    let s = 0;
    const free = _f;
    for (let i = 0; i < 6; i++) free[i] = 0;
    let hidden = false;
    if (m >= 0.28 && m < 0.33) s = (clear + 0.01) * smooth((m - 0.28) / 0.05);
    else if (m >= 0.33 && m < 0.42) {
      const c = smooth((m - 0.33) / 0.09);
      s = clear + 0.01 + 0.1 * c;
      free[0] = -0.08 * c; free[2] = 0.04 * c; free[3] = 0.2 * c;
    } else if (m >= 0.42 && m < 0.48) {
      hidden = true;
      const c = smooth((m - 0.42) / 0.06);
      s = clear + 0.11 + 0.08 * c; free[0] = -0.08 - 0.02 * c; free[2] = 0.04; free[3] = 0.2;
    } else if (m >= 0.48 && m < 0.56) {
      const c = smooth((m - 0.48) / 0.08);
      s = clear + 0.01 + 0.18 * (1 - c); free[0] = -0.1 * (1 - c); free[2] = 0.04 * (1 - c); free[3] = 0.2 * (1 - c);
    } else if (m >= 0.56 && m < 0.6) s = (clear + 0.01) * (1 - smooth((m - 0.56) / 0.04));
    out.parts.mag = magOffset(mw, s, free, A._mo || (A._mo = [0, 0, 0, 0, 0, 0]));
    const vv = vis(out);
    vv.belt = !beltHidden;
    if (hidden) vv.mag = false;
    if (m >= 0.42 && !A.dropped && !A.cancel) { A.dropped = true; this._dropMag(); }
    if (m >= 0.42 && A.magNew == null && !A.cancel) A.magNew = this._freshMag();
    out.frame = windowW(m, 0.06, 0.16, 0.8, 0.94);
    // Hände
    const coverR = { part: 'cover', style: 'boltKnob', offset: [0.004, 0.03, 0.15] };
    const box = ud.anchors.magGrab ? { anchor: ud.anchors.magGrab, style: 'mag' } : null;
    if (v2) {
      // Schusshand: Deckel auf (0,06–0,22) und zu (0,62–0,8); Stützhand: Gurt + Kasten (0,16–0,7)
      const wR = Math.max(windowW(m, 0.04, 0.1, 0.13, 0.17), windowW(m, 0.63, 0.67, 0.75, 0.82));
      if (wR > 0) req(out.right, wR, coverR);
      if (box) req(out.left, windowW(m, 0.16, 0.26, 0.6, 0.7), box);
      if (m > 0.55 && m < 0.72) req(out.left, windowW(m, 0.55, 0.6, 0.64, 0.72), { part: 'belt', style: 'pinchSide', offset: [0, 0.01, 0] });
    } else {
      // Variante 1: Deckel ebenfalls mit der Schusshand (die Stützhand am Deckel führte den Unterarm quer vor die
      // Kamera), Stützhand nur am Kasten; Waffe flacher gekippt
      const wR = Math.max(windowW(m, 0.05, 0.1, 0.13, 0.17), windowW(m, 0.63, 0.67, 0.75, 0.82));
      if (wR > 0) req(out.right, wR, coverR);
      if (box) req(out.left, windowW(m, 0.2, 0.28, 0.58, 0.66), box);
    }
    if (empty) {
      const c = (u - 0.86) / 0.14;
      const ch = ud.anchors.chargeGrab;
      if (ch && c > -0.05) {
        const travel = ch.userData.travel || [0, 0, 0.1];
        out.parts.charge = [0, 0, travel[2] * curve(c, [[0.2, 0], [0.45, 1], [0.55, 1], [0.62, 0]])];
        const wC = windowW(c, 0.0, 0.2, 0.62, 0.9);
        if (wC > 0) req(out.right, wC, { anchor: ch, style: 'pinchRight' });
        const rc = windowW(c, 0.0, 0.2, 0.62, 0.95);
        out.r[2] += 0.2 * rc; out.r[1] += 0.08 * rc;
        if (c > 0.55 && !A.charged) { A.charged = true; this._boltLocked = false; this._boltT = 0.3; this._jolt.kick(0.9, 0.3, 0); }
      }
    }
    return u >= 1;
  },

  /**
   * Patrone für Patrone (Bulldog): Phasen start → insert × n → end; die Zeiten kommen aus den Waffendaten
   * (shellTiming), der Controller schreibt je Einschub eine Patrone gut. Variante 1: Waffe gekippt, Patronen von unten
   * in die Ladeöffnung. Variante 2 taktisch: Waffe auf die Seite gerollt (Ladeöffnung zur Kamera); Variante 2 leer:
   * Port-Load – Pumpe hinten, die erste Patrone direkt durchs Auswurffenster ins Lager, Pumpe vor, dann die Röhre.
   */
  _actShells(A, out, dt) {
    const T = A.timing, ud = this.cur.ud;
    const v2 = A.variant === 1, port = v2 && A.empty;
    A.pt += dt;
    if (A.phase === 'start' && A.pt >= T.start) { A.phase = 'insert'; A.pt = 0; }
    else if (A.phase === 'insert' && A.pt >= T.insert) {
      A.inserted++; A.pt = 0;
      const ctrl = this._ctrlReload;
      if (A.stop || (!ctrl && A.inserted >= A.shells)) { A.phase = 'end'; }
    } else if (A.phase === 'end' && A.pt >= T.end + (A.empty ? 0.45 : 0)) return true;
    if (A.phase === 'insert' && A.stop) { A.phase = 'end'; A.pt = 0; }
    // Kippen: Ladeöffnung zur Stützhand (Port-Load: erst Auswurffenster nach oben zur Kamera)
    let tilt;
    if (A.phase === 'start') tilt = smooth(clamp(A.pt / T.start, 0, 1));
    else if (A.phase === 'insert') tilt = 1;
    else tilt = 1 - smooth(clamp(A.pt / T.end, 0, 1));
    const portPhase = port && (A.phase === 'start' || (A.phase === 'insert' && A.inserted === 0));
    const pw = port ? (A.phase === 'start' ? smooth(clamp(A.pt / T.start, 0, 1)) : A.phase === 'insert' && A.inserted === 0 ? 1 - smooth(clamp((A.pt / T.insert - 0.75) / 0.25, 0, 1)) : 0) : 0;
    const R = v2 && !port ? [0.12, 0.2, -0.95] : [0.18, 0.12, -0.42];
    const RP = [0.2, -0.1, 1.35];   // Port-Load: Waffe nach links gerollt, Auswurffenster (rechts) zeigt nach oben zur Kamera
    for (let i = 0; i < 3; i++) out.r[i] = (R[i] * (1 - pw) + RP[i] * pw) * tilt;
    out.p[0] = (-0.03 * (1 - pw) - 0.07 * pw) * tilt; out.p[1] = (0.03 + 0.02 * pw) * tilt; out.p[2] = 0.02 * tilt;
    out.frame = 0.8 * tilt;
    const sp = ud.anchors.shellPort;
    const travel = ud.anchors.pumpGrab?.userData.travel?.[2] ?? 0.085;
    if (portPhase) {
      // Pumpe zurück (Schusshand hält, Stützhand zieht) und offen halten; Patrone ins Auswurffenster, Pumpe vor
      const c = A.phase === 'start' ? 0 : clamp(A.pt / T.insert, 0, 1);
      const back = A.phase === 'start' ? smooth(clamp(A.pt / T.start, 0, 1)) : 1 - smooth(clamp((c - 0.72) / 0.14, 0, 1));
      out.parts.pump = [0, 0, travel * back];
      const ej = this._shellToPort || (this._shellToPort = new Map());
      let d = ej.get(this.cur.key);
      if (!d) {
        const e = ud.ejection, sh = this._part('shell');
        d = e && sh ? [e.position.x - sh.position.x, e.position.y - sh.position.y, e.position.z - sh.position.z] : [0.034, 0.046, 0.005];
        ej.set(this.cur.key, d);
      }
      if (A.phase === 'insert') {
        // von rechts außen (4 cm vor dem Fenster) hinein bis in die Laufachse
        const inX = curve(c, [[0, 0.07], [0.32, 0.03], [0.5, 0.0], [0.6, -d[0] + 0.004]]);
        out.parts.shell = [d[0] + inX - 0.004, d[1] + 0.002, d[2], 0, 0, 0];
        vis(out).shell = c < 0.62;
        req(out.left, windowW(c, 0.0, 0.08, 0.5, 0.62), { part: 'shell', style: 'pinchSide', offset: [0.012, 0.004, 0.0] });
        if (c > 0.55 && !A.portDrop) { A.portDrop = true; this._jolt.kick(0.4, 0, 0); }
        // Stützhand zurück an die Pumpe und schließen
        if (ud.anchors.pumpGrab) req(out.left, windowW(c, 0.58, 0.68, 0.9, 1.0), { anchor: ud.anchors.pumpGrab, style: 'pump' });
        if (c > 0.86 && !A.portClosed) { A.portClosed = true; this._jolt.kick(0.8, 0, 0); }
      } else if (ud.anchors.pumpGrab) req(out.left, 1, { anchor: ud.anchors.pumpGrab, style: 'pump' });
      return false;
    }
    if (A.phase === 'insert' && sp) {
      const c = clamp(A.pt / T.insert, 0, 1);
      const shellOff = curve(c, [[0, [-0.05, -0.18, 0.05]], [0.45, [0, -0.045, 0.02]], [0.62, [0, -0.012, 0.004]], [0.78, [0, 0.008, -0.03]]]);
      out.parts.shell = [shellOff[0], shellOff[1], shellOff[2], 0.3 * (1 - c), 0, 0];
      vis(out).shell = c < 0.8;
      req(out.left, 1, { part: 'shell', style: 'mag', offset: [0, -0.012, 0.02] });
      if (c > 0.62 && c < 0.7 && !A.pushed) { A.pushed = true; this._jolt.kick(0.6, 0, 0); }
      if (c < 0.1) A.pushed = false;
    } else {
      const w = A.phase === 'start' ? smooth(clamp(A.pt / T.start, 0, 1)) : A.phase === 'end' ? 1 - smooth(clamp(A.pt / Math.max(0.1, T.end * 0.6), 0, 1)) : 1;
      if (w > 0 && sp) req(out.left, w * 0.85, { anchor: sp, style: 'mag', dy: -0.12 * (1 - w) });
      // Pumpen nach Leer-Nachladen (Port-Load: schon geschlossen)
      if (A.phase === 'end' && A.empty && !port) {
        const c = clamp((A.pt - T.end * 0.5) / 0.45, 0, 1);
        out.parts.pump = [0, 0, travel * curve(c, [[0, 0], [0.4, 1], [0.5, 1], [0.85, 0]])];
      }
    }
    return false;
  },
};
