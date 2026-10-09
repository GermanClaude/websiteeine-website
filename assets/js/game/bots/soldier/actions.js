// NULLPUNKT — Waffenhandhabung der Soldaten in der Drittperson (Bots + Mehrspieler-Puppen).
//
//  • Vermessen (Animator.setWeapon): bewegliche Teile der Bot-Detailstufe – Magazin, Schlitten, Ladehebel, Kammerstängel,
//    Pumpe, Gurtdeckel, Revolvertrommel, Schrotpatrone – mit Ruhelage, Magazinachse (Richtung „heraus“) und Freigang
//    (Länge des Magazins im Schacht).
//  • Nachladen je Waffenart als Zeitplan über den Fortschritt 0..1. Die Länge ist die Nachladezeit der Waffe aus
//    weapons.data.js (Spiel-Zeitgeber, für Host und Clients gleich) – die Animation passt sich an, nicht umgekehrt.
//    – Magazin: fährt exakt entlang der Schachtachse heraus und hinein („harter Block“, nichts gleitet durch die Waffe);
//      dazwischen sitzt es fest in der Hand – die Hand folgt dem Magazin, nicht umgekehrt (keine Lücke, kein Versatz).
//    – das alte Magazin fällt im Augenblick des Welt-Magazins aus effects.js (0,38 s, Pistole 0,2 s) – nahtloser Wechsel.
//    – Zeitpunkte passend zum Ton (audio.js): Magazin heraus 12 %, hinein 55 %, Verschluss 78 % (MG 6/22/58/82 %).
//    – Waffenarten: Stangenmagazin (Sturmgewehr, MP, Präzision, Scharfschütze, Trommel, Bullpup, Magazin oben),
//      Pistole (Magazin fällt frei, Schlitten übergreifen), Revolver (Trommel aus, Hülsen, Schnelllader), Gurt-MG (Deckel,
//      Kasten, Gurt einlegen), Pumpflinte (Patrone für Patrone im Takt der Waffe, Patrone sichtbar), Panzerfaust.
//  • Varianten (rein optisch, je Client zufällig – kein Einfluss auf Spielzeit oder Netz): Magazintasche (Brust links,
//    Brust Mitte, Hüfte), Haltung (Standard, hoch zum Gesicht, tief gekippt), leer: Ladehebel ziehen oder Fanghebel
//    schlagen, Pistole: Schlitten übergreifen oder Schlittenfang.
//  • Nach dem Schuss: Kammerstängel (Drehen + Zurückziehen) und Pumpe bewegen sich mit der Hand mit.
//
// Alle Rechnungen im Modellraum des Soldaten (Füße im Ursprung, Blick −Z); Teile werden im Waffenraum gesetzt.
import * as THREE from 'three';
import { BONE } from './rig.js';
import { clamp, smooth, ramp, qrot, quatFromXY } from './ik.js';

const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
const _a = V(), _b = V(), _c = V(), _d = V();
const _q = Q(), _q2 = Q(), _qi = Q();
const _box = new THREE.Box3();
const _corner = V();
// Pose des Magazins (Modellraum): Drehpunkt + Orientierung + sichtbar
const M_CUR = { pos: V(), q: Q(), vis: true };
const M_REF = { pos: V(), q: Q(), vis: true };
const M_REF2 = { pos: V(), q: Q(), vis: true };
const S_FG = V(), S_P1 = V(), S_P2 = V(), S_P3 = V(), S_CH = V();
const Z_AX = V().set(0, 0, 1);
const X_AX = V().set(1, 0, 0);
// Linke Hand am Magazin (Magazinraum): Handfläche zeigt nach +X (liegt links am Magazin), Handgelenk unten hinten
const HOLD = quatFromXY(Q(), V().set(1, 0, 0), V().set(-0.35, -0.55, 0.75).normalize());
// Patrone zwischen Daumen und Fingern: Handfläche nach oben/innen
const HOLD_SHELL = quatFromXY(Q(), V().set(0.6, 0.8, 0).normalize(), V().set(-0.6, -0.2, 0.75).normalize());
// Ein-/Ausblendfenster: ein a→b, aus c→d
const win = (r, a, b, c, d) => ramp(r, a, b) * (1 - ramp(r, c, d));
// kurzer Stoß um t (Anstieg a, Abklingen b)
const bump = (r, t, a, b) => ramp(r, t - a, t) * (1 - ramp(r, t, t + b));
// Taschen (Knochenraum; Oberkante, an der das Magazin steckt): Brust links/Mitte (Weste), Hüfte links (Gürtel)
const POUCH = {
  chestL: { bone: BONE.chest, p: [-0.088, 0.0, -0.195] },
  chestC: { bone: BONE.chest, p: [0.0, 0.0, -0.195] },
  hipL: { bone: BONE.hips, p: [-0.172, 0.06, 0.03] },
  hipBox: { bone: BONE.hips, p: [-0.235, 0.02, 0.04] },
  shells: { bone: BONE.hips, p: [-0.15, 0.045, -0.1] },
  back: { bone: BONE.hips, p: [-0.16, 0.1, 0.16] },
};
const VARIANTS = 3;

function partRec(o) {
  return o ? { obj: o, p0: o.position.clone(), q0: o.quaternion.clone(), vis: o.visible, travel: V(), rot: 0 } : null;
}

/** Anker relativ zum Drehpunkt seines Teils (Ruhelage des Teils, Waffe in Grundstellung). */
function relTo(part, anchorPos) {
  _qi.copy(part.q0).invert();
  return qrot(V().subVectors(anchorPos, part.p0), _qi);
}

export class Handling {
  /** Prüfstand (dev/bots.html, tools/anim-soldier.mjs): feste Variante statt Zufall; null = zufällig. */
  static force = null;

  constructor(anim) {
    this.a = anim;
    this.rig = null;
    this.on = false; // Nachladen läuft (Spielzustand)
    this.r = 0; // Fortschritt 0..1 (beim Abbruch eingefroren)
    this.T = 2;
    this.empty = false;
    this.v = 0;
    this.tl = null;
    this.shellT = 0;
    this.shellEnd = 0;
    // linke Hand (Ergebnis je Bild): Ziel + Orientierung, Gewicht, Anteil „am Griff“ / „hält Teil“
    this.lw = 0; this.lgrip = 1; this.lhold = 0;
    this.lq = Q();
    // rechte Hand (Ladehebel rechts, Kammerstängel): Ziel + Gewicht
    this.rw = 0;
    this.rTarget = V();
    // Blick (Kopf/Hals) und Waffenhaltung (additiv, im Anschlagrahmen)
    this.lookY = 0; this.lookP = 0;
    this.g = { rx: 0, ry: 0, rz: 0, x: 0, y: 0, z: 0 };
    // Zustand bewegter Teile (Waffenraum)
    this.mag = { pos: V(), q: Q(), vis: true, moved: false };
    this.shell = { pos: V(), q: Q(), vis: false };
    this.slideK = 0; this.chargeK = 0; this.coverA = 0; this.craneK = 0; this.ejectK = 0; this.boltU = -1; this.pumpK = 0;
  }

  /* ================================================================ Vermessen */

  /** Waffe vermessen (die Waffe steht dabei in Grundstellung: Waffenraum = Weltraum). */
  setWeapon(gun, def, A) {
    this.restore();
    this.on = false;
    this.r = 0;
    const rig = (this.rig = { kind: 'none', mag: null, slide: null, charge: null, bolt: null, pump: null, cover: null, crane: null, shell: null, ejector: null, style: 'pull', chargeAt: null, catchAt: null, slideAt: null, boltAt: null, pumpAt: null, coverAt: null, cylAt: null, ejAt: null, port: null });
    if (!gun || !def) return;
    const ud = gun.userData || {};
    const parts = ud.parts || {};
    const an = ud.anchors || {};
    const wpos = (o) => o.getWorldPosition(V());
    const cls = def.cls;
    // Magazin (nur direkt an der Waffe hängende Teile – Ruhelage im Waffenraum = lokale Lage)
    const mo = parts.mag;
    if (mo && mo.parent === gun) {
      const m = partRec(mo);
      const rake = (ud.rightHandGrip && ud.rightHandGrip.userData && ud.rightHandGrip.userData.rake) || 0.3;
      // Achse: Schacht oben (Magazin auf dem Gehäuse), im Griff (Pistole/MP: entlang der Griffneigung), sonst senkrecht
      if (m.p0.y > 0.08) m.axis = V(0, 1, 0);
      else if (cls === 'pistol' || (Math.abs(m.p0.z) < 0.05 && m.p0.y < -0.03)) m.axis = V(0, -Math.cos(rake), Math.sin(rake));
      else m.axis = V(0, -1, 0);
      // Freigang: Länge oberhalb des Drehpunkts (steckt im Schacht) + Sicherheitsabstand; Länge außerhalb
      _box.setFromObject(mo);
      let inside = 0, outside = 0;
      for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).sub(m.p0);
        const d = _corner.dot(m.axis);
        inside = Math.max(inside, -d);
        outside = Math.max(outside, d);
      }
      m.clear = clamp(inside + 0.014, 0.025, 0.14);
      m.len = clamp(outside, 0.04, 0.4);
      // Griffpunkt: Ankerpunkt am Magazin, Handfläche links daneben (halbe Breite + Handschuh)
      const g = an.magGrab && an.magGrab.parent === mo ? wpos(an.magGrab).sub(m.p0) : m.axis.clone().multiplyScalar(m.len * 0.45);
      const w = (an.magGrab && an.magGrab.userData && an.magGrab.userData.w) || 0.012;
      m.grab = g.add(V(-(w + 0.013), 0, 0));
      m.top = m.axis.y > 0.5;
      rig.mag = m;
    }
    // Schrotpatrone (Pumpflinte: Teil 'shell' an der Ladeöffnung, sonst unsichtbar)
    if (parts.shell && parts.shell.parent === gun) { rig.shell = partRec(parts.shell); rig.shell.vis = false; parts.shell.visible = false; }
    if (an.shellPort) rig.port = wpos(an.shellPort);
    // Schlitten (Pistole)
    if (parts.slide && an.slideGrab) {
      rig.slide = partRec(parts.slide);
      const t = an.slideGrab.userData && an.slideGrab.userData.travel;
      rig.slide.travel.set(0, 0, t ? t[2] : 0.03);
      rig.slideAt = relTo(rig.slide, wpos(an.slideGrab));
    }
    // Ladehebel (Teil des Griffs: 'charge' oder Verschluss 'bolt')
    if (an.chargeGrab) {
      const host = an.chargeGrab.parent && an.chargeGrab.parent !== gun ? an.chargeGrab.parent : null;
      const d = an.chargeGrab.userData || {};
      rig.style = d.style || 'pull';
      if (host) {
        rig.charge = partRec(host);
        rig.charge.travel.set(0, 0, d.travel ? d.travel[2] : 0.07);
        rig.chargeAt = relTo(rig.charge, wpos(an.chargeGrab));
      } else rig.chargeAt = wpos(an.chargeGrab);
    }
    if (an.boltCatch) rig.catchAt = wpos(an.boltCatch);
    // Kammerstängel (Repetierer)
    if (parts.boltHandle && an.boltGrab) {
      rig.bolt = partRec(parts.boltHandle);
      const d = an.boltGrab.userData || {};
      rig.bolt.travel.set(0, 0, d.travel ? d.travel[2] : 0.1);
      rig.bolt.rot = d.rot || 1.05;
      rig.boltAt = relTo(rig.bolt, wpos(an.boltGrab));
    }
    // Pumpe
    if (parts.pump && parts.pump.parent === gun) {
      rig.pump = partRec(parts.pump);
      const d = (an.pumpGrab && an.pumpGrab.userData) || {};
      rig.pump.travel.set(0, 0, d.travel ? d.travel[2] : 0.085);
    }
    // Gurtdeckel (MG): Drehpunkt vorn, Riegel hinten oben
    if (parts.cover && parts.cover.parent === gun) {
      rig.cover = partRec(parts.cover);
      _box.setFromObject(parts.cover);
      rig.coverAt = relTo(rig.cover, V((_box.min.x + _box.max.x) / 2 - 0.012, _box.max.y + 0.01, _box.max.z - 0.012));
    }
    // Revolver: Kran (schwenkt aus), Trommel-Griff, Ausstoßer
    if (parts.crane && parts.crane.parent === gun) {
      rig.crane = partRec(parts.crane);
      if (an.cylGrab) rig.cylAt = relTo(rig.crane, wpos(an.cylGrab));
      if (an.ejectorGrab) rig.ejAt = relTo(rig.crane, wpos(an.ejectorGrab));
      if (parts.ejector) rig.ejector = partRec(parts.ejector);
    }
    // Art des Nachladens
    if (def.perShellReload) rig.kind = 'shell';
    else if (cls === 'pistol') rig.kind = rig.crane ? 'revolver' : rig.mag ? 'pistol' : 'none';
    else if (rig.cover && rig.mag) rig.kind = 'belt';
    else if (rig.mag) rig.kind = 'mag';
    else if (cls === 'launcher') rig.kind = 'rocket';
    else rig.kind = cls === 'melee' ? 'none' : 'generic';
    void A;
  }

  /** Alle bewegten Teile in Ruhelage (Waffenwechsel, Tod, Respawn, Ende eines abgebrochenen Nachladens). */
  restore() {
    const rig = this.rig;
    if (!rig) return;
    for (const k of ['mag', 'slide', 'charge', 'bolt', 'pump', 'cover', 'crane', 'ejector', 'shell']) {
      const p = rig[k];
      if (!p) continue;
      p.obj.position.copy(p.p0);
      p.obj.quaternion.copy(p.q0);
      p.obj.visible = p.vis;
    }
    this.mag.moved = false;
    this.shell.vis = false;
    this.slideK = this.chargeK = this.coverA = this.craneK = this.ejectK = this.pumpK = 0;
    this.boltU = -1;
  }

  /* ================================================================ Zeitplan */

  /**
   * Je Bild aus Animator.update: Zustand des Nachladens (Spiel) → Fortschritt, Zeitplan, Variante. Beim Abbruch bleibt der
   * letzte Fortschritt stehen; der Animator blendet über reloadW zurück in die Grundhaltung.
   */
  update(dt, reloading, progress, empty, phase) {
    const def = this.a.def;
    if (reloading && !this.on) {
      this.on = true;
      this.empty = !!empty;
      this.T = Math.max(0.6, (this.empty ? def && def.reloadEmptyTime : def && def.reloadTime) || 2);
      this.v = Handling.force != null ? Handling.force % VARIANTS : (Math.random() * VARIANTS) | 0;
      this.shellT = 0;
      this.shellEnd = 0;
      this.phaseEnd = false;
      this._timeline();
    }
    if (reloading) {
      this.r = clamp(progress || 0, 0, 1);
      this.shellT += dt;
      if (phase === 'end') this.phaseEnd = true;
    } else if (this.on) this.on = false;
  }

  _timeline() {
    const kind = this.rig ? this.rig.kind : 'none';
    const T = this.T, v = this.v, e = this.empty;
    const tl = (this.tl = { kind });
    if (kind === 'mag') {
      tl.g1 = 0.075; tl.g2 = 0.12; tl.gD = clamp(0.38 / T, tl.g2 + 0.012, 0.26);
      tl.pA = 0.25; tl.p0 = 0.29; tl.p1 = 0.365; tl.s0 = 0.468; tl.s1 = 0.55;
      tl.f0 = 0.6; tl.f1 = 0.76;
      tl.pouch = v === 1 ? POUCH.chestC : v === 2 ? POUCH.hipL : POUCH.chestL;
      if (e) {
        const rig = this.rig;
        const bolt = this.a.fireMode === 'bolt' && rig.bolt;
        const right = rig.style === 'right';
        // leer: Kammerstängel (rechts), Ladehebel rechts (rechte Hand), Fanghebel schlagen (Variante 1, falls vorhanden),
        // sonst Ladehebel mit links ziehen
        tl.charge = bolt ? 'bolt' : right && rig.chargeAt ? 'right' : v === 1 && rig.catchAt ? 'catch' : rig.chargeAt ? 'left' : rig.catchAt ? 'catch' : 'none';
        if (tl.charge === 'left') { tl.c1 = 0.69; tl.c2 = 0.775; tl.c3 = 0.8; tl.f1 = 0.92; }
        else if (tl.charge === 'catch') { tl.c1 = 0.73; tl.c2 = 0.78; tl.c3 = 0.8; tl.f1 = 0.9; }
        else { tl.f1 = 0.72; tl.c1 = 0.7; tl.c2 = 0.775; tl.c3 = 0.8; tl.c4 = 0.88; }
      }
    } else if (kind === 'belt') {
      // MG mit Gurtkasten: Kasten ab (Welt-Magazin bei 0,38 s), Deckel auf, neuer Kasten, Gurt einlegen, Deckel zu (82 %)
      tl.g1 = 0.035; tl.g2 = 0.05; tl.gD = clamp(0.38 / T, tl.g2 + 0.008, 0.2);
      tl.k0 = 0.1; tl.k1 = 0.15; tl.k2 = 0.21;
      tl.pA = 0.28; tl.p0 = 0.32; tl.p1 = 0.39; tl.s0 = 0.5; tl.s1 = 0.58;
      tl.f0 = 0.6; tl.b1 = 0.67; tl.k3 = 0.72; tl.k4 = 0.8; tl.f1 = 0.92;
      tl.pouch = POUCH.hipBox;
    } else if (kind === 'pistol') {
      tl.g1 = 0.05; tl.g2 = 0.11; tl.gD = clamp(0.2 / T, tl.g2 + 0.01, 0.2);
      tl.pA = 0.22; tl.p0 = 0.27; tl.p1 = 0.35; tl.s0 = 0.468; tl.s1 = 0.55;
      tl.f0 = 0.58; tl.f1 = 0.72;
      tl.pouch = POUCH.hipL;
      tl.over = e && v !== 1 && !!this.rig.slide; // leer: Schlitten übergreifen (sonst Schlittenfang mit dem Daumen)
      if (tl.over) { tl.c1 = 0.68; tl.c2 = 0.765; tl.c3 = 0.79; tl.f1 = 0.9; }
    }
  }

  /* ================================================================ Haltung (Waffe, Blick) */

  /** Zusätzliche Waffenhaltung + Blick des Nachladens (vor den Armen, aus _weaponPose). w = Überblendung. */
  gunPose(w) {
    const g = this.g;
    g.rx = g.ry = g.rz = g.x = g.y = g.z = 0;
    this.lookY = this.lookP = 0;
    const tl = this.tl;
    if (!tl || w <= 1e-3) return g;
    const r = this.r, v = this.v;
    const kind = tl.kind;
    if (kind === 'mag' || kind === 'belt') {
      const pres = win(r, 0, 0.1, 0.84, 0.97);
      const heavy = kind === 'belt' || this.a.cls === 'lmg';
      g.rz = -(v === 2 ? 0.5 : 0.32) * pres;
      g.ry = 0.1 * pres;
      if (v === 1) { g.y = 0.05 * pres; g.z = 0.07 * pres; g.rx = 0.16 * pres; }
      else if (v === 2) { g.y = -0.035 * pres; g.rx = -0.1 * pres; }
      if (heavy) { g.y -= 0.05 * pres; g.z += 0.05 * pres; g.rx -= 0.08 * pres; g.rz += 0.12 * pres; }
      // Magazin einsetzen: kurzer Stoß nach oben
      const b = bump(r, tl.s1, 0.025, 0.07);
      g.y += 0.016 * b; g.rx += 0.07 * b;
      // Ladehebel / Fanghebel: Waffe dreht sich zur Hand, Stoß beim Loslassen
      if (tl.c1) {
        const c = win(r, tl.c1 - 0.08, tl.c1, tl.c3, tl.c3 + 0.08);
        g.rz += 0.16 * c; g.ry -= 0.12 * c;
        const rel = bump(r, tl.c3, 0.012, 0.08);
        g.z += 0.012 * rel; g.rx += 0.05 * rel;
      }
      if (kind === 'belt') {
        // Deckel/Gurt: Waffe flacher, Blick auf das Gehäuse
        const k = win(r, tl.k0 - 0.05, tl.k0, tl.k2, tl.k2 + 0.04) + win(r, tl.f0, tl.b1, tl.k4, tl.k4 + 0.05);
        g.rz += 0.2 * k;
        const slam = bump(r, tl.k4, 0.01, 0.06);
        g.y -= 0.012 * slam;
      }
      this.lookP = -0.34 * pres;
      this.lookY = -0.22 * win(r, tl.gD, tl.p0, tl.p1, tl.s0);
      this.lookP -= 0.12 * win(r, tl.gD, tl.p0, tl.p1, tl.s0);
    } else if (kind === 'pistol') {
      const pres = win(r, 0, 0.08, 0.86, 0.97);
      g.rz = -0.36 * pres; g.rx = 0.22 * pres; g.z = 0.07 * pres; g.y = -0.015 * pres; g.ry = 0.08 * pres;
      if (v === 1) { g.y += 0.03 * pres; g.rx += 0.12 * pres; }
      const b = bump(r, tl.s1, 0.025, 0.07);
      g.y += 0.014 * b; g.rx += 0.08 * b;
      if (tl.over) {
        const c = win(r, tl.c1 - 0.08, tl.c1, tl.c3, tl.c3 + 0.07);
        g.ry += 0.3 * c; g.rz -= 0.15 * c; g.rx -= 0.12 * c;
      }
      // Schlitten schnellt vor: kleiner Ruck
      const rel = bump(r, 0.785, 0.01, 0.06);
      g.rx += 0.07 * rel;
      this.lookP = -0.3 * pres;
      this.lookY = -0.25 * win(r, 0.12, tl.p0, tl.p1, tl.s0);
    } else if (kind === 'revolver') {
      const swing = this._craneSwing(r);
      const up = win(r, 0.16, 0.24, 0.34, 0.42);
      const down = win(r, 0.38, 0.46, 0.66, 0.74);
      g.rx = 0.15 * swing + 0.85 * up - 0.45 * down;
      g.ry = 0.2 * swing;
      g.rz = 0.45 * swing - 0.2 * up;
      g.z = 0.08 * swing; g.y = 0.02 * up - 0.02 * down;
      this.lookP = -0.3 * swing + 0.1 * up;
      this.lookY = -0.2 * win(r, 0.34, 0.4, 0.44, 0.5);
    } else if (kind === 'shell') {
      const pres = this._shellPres();
      g.rz = -0.55 * pres; g.rx = 0.12 * pres; g.z = 0.06 * pres; g.y = -0.02 * pres; g.ry = 0.1 * pres;
      // Patrone hineindrücken: kleiner Ruck je Patrone
      const u = this._shellU();
      if (u >= 0) g.y += 0.006 * bump(u, 0.9, 0.06, 0.1);
      this.lookP = -0.3 * pres;
    } else if (kind === 'rocket') {
      const pres = win(r, 0, 0.12, 0.8, 0.95);
      g.rx = -0.3 * pres; g.rz = -0.25 * pres; g.y = -0.06 * pres; g.z = 0.05 * pres;
      this.lookP = -0.25 * pres;
    } else if (kind === 'generic') {
      const tilt = ramp(r, 0.05, 0.2) * (1 - ramp(r, 0.8, 0.96));
      g.rz = -0.25 * tilt;
      g.y = 0.02 * Math.sin(Math.PI * ramp(r, 0.7, 0.85));
    }
    g.rx *= w; g.ry *= w; g.rz *= w; g.x *= w; g.y *= w; g.z *= w;
    this.lookY *= w; this.lookP *= w;
    return g;
  }

  /* ================================================================ Hände */

  /**
   * Linke Hand während des Nachladens: Ziel (Modellraum) nach out, Orientierung nach this.lq; Rückgabe Gewicht 0..1.
   * Setzt this.lgrip (1 = Hand am Vordergriff, Griff-Orientierung) und this.lhold (1 = Hand hält Magazin/Patrone).
   * Aufruf nach _weaponPose (Waffe steht), vor dem IK.
   */
  left(out) {
    this.lgrip = 1; this.lhold = 0; this.rw = 0;
    const tl = this.tl;
    if (!tl) return 0;
    const a = this.a, r = this.r;
    const FG = a._gunToModel(a.anchors.left, S_FG);
    const kind = tl.kind;
    if (kind === 'mag' || kind === 'belt' || kind === 'pistol') return this._leftMag(out, FG, r, tl);
    if (kind === 'revolver') return this._leftRevolver(out, FG, r);
    if (kind === 'shell') return this._leftShell(out, FG);
    if (kind === 'rocket') return this._leftRocket(out, FG, r);
    if (kind === 'generic') return this._leftGeneric(out, FG, r);
    return 0;
  }

  _leftMag(out, FG, r, tl) {
    const a = this.a;
    const m = this.rig.mag;
    const pistol = tl.kind === 'pistol', belt = tl.kind === 'belt';
    // aktuelle Magazin-Pose (wird nach dem IK in die Waffe geschrieben)
    this._magAt(r, M_CUR);
    let w = 1;
    if (!pistol && r < tl.g1) {
      // Hand vom Vordergriff zum Magazin (Bullpup/Magazin hinten: unter dem Griff hindurch)
      const g = this._magGrab(this._magAt(tl.g1, M_REF), S_P1);
      const k = ramp(r, 0, tl.g1);
      this._path(out, FG, g, k, 'below');
      this.lgrip = 1 - ramp(r, 0, tl.g1 * 0.5);
      this.lhold = ramp(r, tl.g1 * 0.5, tl.g1);
    } else if (!pistol && r < tl.gD) {
      // hält das Magazin (Schacht → heraus → loslassen)
      this._magGrab(M_CUR, out); this.lgrip = 0; this.lhold = 1;
    } else if (r < tl.p0) {
      // frei: zur Tasche (Pistole: sofort vom Stützgriff)
      let from = pistol ? FG : this._magGrab(this._magAt(tl.gD - 1e-4, M_REF), S_P1);
      let t0 = pistol ? 0.02 : tl.gD;
      if (belt && r < tl.k2) {
        // MG: erst den Deckel öffnen (Hand an den Riegel, Deckel hochklappen)
        const latch = this._coverPoint(this._coverAngle(Math.max(r, tl.k1)), S_P2);
        if (r < tl.k1) out.copy(from).lerp(latch, ramp(r, tl.gD, tl.k1));
        else out.copy(latch);
        this.lgrip = 0;
        this.lhold = 1 - ramp(r, tl.gD, tl.gD + 0.03);
        this.lq.multiplyQuaternions(this._magAt(tl.gD - 1e-4, M_REF).q, HOLD);
        return w;
      }
      if (belt) { from = this._coverPoint(this._coverAngle(tl.k2), S_P1); t0 = tl.k2; }
      const above = this._pouchPoint(tl.pouch, 0.07, -0.06, S_P2);
      const into = this._magGrab(this._magAt(tl.p0, M_REF2), S_P3);
      if (r < tl.pA) out.copy(from).lerp(above, smooth((r - t0) / Math.max(1e-4, tl.pA - t0)));
      else out.copy(above).lerp(into, smooth((r - tl.pA) / Math.max(1e-4, tl.p0 - tl.pA)));
      this.lgrip = pistol ? 1 - ramp(r, 0.02, 0.08) : 0;
      this.lhold = pistol || belt ? ramp(r, tl.p0 - 0.05, tl.p0) : (1 - ramp(r, tl.gD, tl.gD + 0.04)) + ramp(r, tl.p0 - 0.04, tl.p0);
    } else if (r < tl.f0) {
      // neues Magazin: aus der Tasche, zum Schacht, entlang der Achse hinein
      this._magGrab(M_CUR, out); this.lgrip = 0; this.lhold = 1;
    } else if (belt) {
      // Gurt einlegen (Hand über das Gehäuse), Deckel schließen (Hand drückt den Riegel), zurück zum Vordergriff
      const mg = this._magGrab(this._magAt(tl.f0, M_REF), S_P1);
      const tray = a._gunToModel(_a.set(-0.03, 0.12, -0.12), S_P2);
      const latch = this._coverPoint(tl.k3 >= r ? this._coverAngle(tl.k3) : this._coverAngle(r), S_P3);
      if (r < tl.b1) out.copy(mg).lerp(tray, ramp(r, tl.f0, tl.b1));
      else if (r < tl.k3) out.copy(tray).lerp(latch, ramp(r, tl.b1, tl.k3));
      else if (r < tl.k4) out.copy(latch);
      else this._path(out, latch, FG, ramp(r, tl.k4, tl.f1), null);
      this.lhold = 1 - ramp(r, tl.f0, tl.f0 + 0.04);
      this.lgrip = ramp(r, tl.f1 - 0.05, tl.f1);
    } else if (!tl.c1 || tl.charge === 'right' || tl.charge === 'bolt' || (pistol && !tl.over)) {
      // taktisch (oder Ladehebel/Kammerstängel mit rechts, Schlittenfang): zurück zum Vordergriff
      const mg = this._magGrab(this._magAt(tl.f0, M_REF), S_P1);
      this._path(out, mg, FG, ramp(r, tl.f0, tl.f1), pistol ? null : 'below');
      this.lhold = 1 - ramp(r, tl.f0, tl.f0 + 0.05);
      this.lgrip = ramp(r, tl.f1 - 0.06, tl.f1);
      if (tl.charge === 'right' || tl.charge === 'bolt') this._rightCharge(r, tl);
    } else {
      // leer: Ladehebel / Fanghebel / Schlitten mit links
      const mg = this._magGrab(this._magAt(tl.f0, M_REF), S_P1);
      const at = this._chargePoint(r, tl, S_CH);
      if (r < tl.c1) this._path(out, mg, this._chargePoint(tl.c1, tl, S_P2), ramp(r, tl.f0, tl.c1), 'left');
      else if (r < tl.c3) out.copy(at);
      else {
        // loslassen: Hand weicht nach hinten oben aus, dann zum Vordergriff
        const off = _b.copy(this._chargePoint(tl.c3, tl, S_P2)).add(qrot(_c.set(-0.03, 0.04, 0.05), a.gunQuat));
        if (r < tl.c3 + 0.03) out.copy(S_P2).lerp(off, ramp(r, tl.c3, tl.c3 + 0.03));
        else this._path(out, off, FG, ramp(r, tl.c3 + 0.03, tl.f1), 'left');
      }
      this.lhold = 1 - ramp(r, tl.f0, tl.f0 + 0.05);
      this.lgrip = ramp(r, tl.f1 - 0.06, tl.f1);
    }
    if (this.lhold > 0) this.lq.multiplyQuaternions(M_CUR.vis ? M_CUR.q : this._magAt(r < (tl.gD + tl.p0) * 0.5 ? tl.gD - 1e-4 : tl.p0, M_REF).q, HOLD);
    return w;
  }

  /** Rechte Hand: Ladehebel rechts bzw. Kammerstängel nach dem leeren Nachladen. */
  _rightCharge(r, tl) {
    if (tl.charge === 'bolt') {
      // Kammerstängel: gleicher Ablauf wie nach dem Schuss (boltCycle), über 0,66..0,9
      const u = (r - 0.66) / 0.24;
      if (u > 0 && u < 1) this.boltU = u;
      return;
    }
    const a = this.a;
    const at = this._chargePoint(r, tl, S_CH);
    const k = r < tl.c1 ? ramp(r, tl.c1 - 0.07, tl.c1) : r < tl.c3 ? 1 : 1 - ramp(r, tl.c3 + 0.01, tl.c4);
    if (k <= 0) return;
    this.rTarget.copy(at);
    if (r >= tl.c3) this.rTarget.add(qrot(_c.set(0.03, 0.04, 0.05), a.gunQuat).multiplyScalar(ramp(r, tl.c3, tl.c3 + 0.03)));
    this.rw = k;
  }

  /** Griffpunkt am Ladehebel/Fanghebel/Schlitten (Modellraum), mit Teilebewegung. */
  _chargePoint(r, tl, out) {
    const a = this.a, rig = this.rig;
    if (tl.kind === 'pistol') {
      // Schlitten von oben greifen: Hand über dem Schlitten, Handfläche nach unten
      const s = rig.slide;
      const k = this._slideAt(r);
      _a.copy(rig.slideAt).add(_b.copy(s.travel).multiplyScalar(k)).add(s.p0).add(_c.set(-0.012, 0.03, 0.01));
      return a._gunToModel(_a, out);
    }
    if (tl.charge === 'catch') return a._gunToModel(_a.copy(rig.catchAt).add(_b.set(-0.03, 0.0, 0.01)), out);
    const c = rig.charge;
    if (c) {
      _a.copy(rig.chargeAt).add(_b.copy(c.travel).multiplyScalar(this._chargeAt(r, tl))).add(c.p0);
      _a.x += tl.charge === 'right' ? 0.02 : -0.02;
      return a._gunToModel(_a, out);
    }
    return a._gunToModel(_a.copy(rig.chargeAt || a.anchors.left), out);
  }

  /** Ladehebel-Weg 0..1 (zurück) über die Zeit. */
  _chargeAt(r, tl) {
    if (!tl.c1 || tl.charge === 'catch' || tl.charge === 'bolt') return 0;
    if (r < tl.c1) return 0;
    if (r < tl.c2) return smooth((r - tl.c1) / (tl.c2 - tl.c1));
    if (r < tl.c3) return 1;
    return 1 - clamp((r - tl.c3) / 0.025, 0, 1); // schnellt vor
  }

  /** Schlitten-Weg (Pistole) 0..1.15: leer = hinten gefangen bis zum Lösen bei 78 %. */
  _slideAt(r) {
    const tl = this.tl;
    if (!this.empty || !tl || tl.kind !== 'pistol') return 0;
    const lock = ramp(r, 0, 0.04);
    if (r < 0.78) {
      const pull = tl.over ? ramp(r, tl.c1, tl.c2) * 0.18 : 0;
      return lock * (1 + pull);
    }
    return Math.max(0, 1 - (r - 0.78) / 0.02) * (tl.over ? 1.18 : 1);
  }

  /**
   * Weg zwischen zwei Punkten (k 0..1, geglättet). via: 'below' = unter der Waffe hindurch (Bullpup: Magazin hinter dem
   * Griff), 'left' = links am Gehäuse vorbei (Ladehebel oben/links) – die Hand fährt nie durch die Waffe.
   */
  _path(out, A, B, k, via) {
    k = smooth(k);
    if (!via) return out.copy(A).lerp(B, k);
    const a = this.a;
    // Zwischenpunkt im Waffenraum
    _qi.copy(a.gunQuat).invert();
    const la = qrot(_a.copy(A).sub(a.gunPos), _qi);
    const lb = qrot(_b.copy(B).sub(a.gunPos), _qi);
    if (via === 'below') {
      // nur nötig, wenn der Weg am Pistolengriff vorbeiführt (z wechselt über den Griff)
      if (!((la.z < -0.02 && lb.z > 0.0) || (lb.z < -0.02 && la.z > 0.0))) return out.copy(A).lerp(B, k);
      _c.set(-0.05, Math.min(la.y, lb.y, -0.16), (la.z + lb.z) * 0.5);
    } else {
      _c.set(Math.min(la.x, lb.x, -0.075), (la.y + lb.y) * 0.5 + 0.02, (la.z + lb.z) * 0.5);
    }
    const mid = a._gunToModel(_c, _d);
    // quadratische Bézierkurve A → mid → B
    const u = 1 - k;
    out.copy(A).multiplyScalar(u * u).addScaledVector(mid, 2 * u * k).addScaledVector(B, k * k);
    return out;
  }

  /** Punkt an einer Tasche (Knochenraum) → Modellraum; dy/dz Versatz (oberhalb/vor der Tasche). */
  _pouchPoint(pouch, dy, dz, out) {
    const a = this.a;
    const P = pouch.p;
    return qrot(out.set(P[0], P[1] + dy, P[2] + dz), a.wq[pouch.bone]).add(a.wp[pouch.bone]);
  }

  /** Griffpunkt der Hand an einer Magazin-Pose (Modellraum). */
  _magGrab(M, out) {
    return qrot(out.copy(this.rig.mag.grab), M.q).add(M.pos);
  }

  /** Magazin in Ruhelage + Weg d entlang der Achse (Waffenraum) → Pose im Modellraum. */
  _magGun(o, d) {
    const a = this.a, m = this.rig.mag;
    o.pos.copy(m.p0).addScaledVector(m.axis, d);
    a._gunToModel(o.pos, o.pos);
    o.q.multiplyQuaternions(a.gunQuat, m.q0);
    o.vis = true;
    return o;
  }

  /** Magazin in der Tasche, depth = Weg nach oben (0 = Oberkante steckt in der Tasche). */
  _magPouch(o, depth) {
    const a = this.a, m = this.rig.mag, tl = this.tl;
    const pouch = tl.pouch;
    const bq = a.wq[pouch.bone];
    // Magazin aufrecht in der Tasche (Achse nach unten); Magazine oben (Achse +Y) liegen in der Tasche hochkant
    o.q.copy(bq);
    if (m.top) o.q.multiply(_q.setFromAxisAngle(X_AX, -Math.PI / 2));
    o.q.multiply(m.q0);
    const P = pouch.p;
    qrot(o.pos.set(P[0], P[1] - m.clear + depth, P[2]), bq).add(a.wp[pouch.bone]);
    // Magazin seitlich so, dass der Drehpunkt (Schacht) über der Taschenmitte liegt (MG-Kasten hängt seitlich)
    o.vis = true;
    return o;
  }

  /**
   * Pose des Magazins bei Fortschritt r (Modellraum, für Hand und Teil):
   * sitzt → fährt entlang der Achse heraus → in der Hand weg (Pistole: fällt frei) → unsichtbar (Welt-Magazin übernimmt) →
   * neues aus der Tasche → zum Schacht → entlang der Achse hinein (beschleunigt, sitzt bei s1).
   */
  _magAt(r, o) {
    const tl = this.tl, m = this.rig.mag, a = this.a;
    const pistol = tl.kind === 'pistol';
    if (r < tl.g1 || r >= tl.s1) return this._magGun(o, 0);
    if (r < tl.g2) {
      const k = (r - tl.g1) / (tl.g2 - tl.g1);
      return this._magGun(o, m.clear * (pistol ? k * k : smooth(k)));
    }
    if (r < tl.gD) {
      const k = (r - tl.g2) / Math.max(1e-4, tl.gD - tl.g2);
      if (pistol) {
        // freier Fall entlang der Achse, dann senkrecht (Modellraum)
        const t = k * (tl.gD - tl.g2) * this.T;
        this._magGun(o, m.clear * (1 + 0.6 * k));
        o.pos.y -= 4.9 * t * t;
        return o;
      }
      // Hand zieht das Magazin nach unten links weg und kippt es
      this._magGun(o, m.clear + 0.05 * k);
      o.pos.add(qrot(_a.set(-0.06 * k, -0.03 * k, 0.015 * k), a.gunQuat));
      o.q.multiply(_q.setFromAxisAngle(Z_AX, 0.35 * smooth(k)));
      return o;
    }
    if (r < tl.p0) { this._magPouch(o, 0); o.vis = false; return o; }
    if (r < tl.p1) return this._magPouch(o, smooth((r - tl.p0) / (tl.p1 - tl.p0)) * m.len * 0.85);
    const pre = m.clear + 0.035;
    if (r < tl.s0) {
      // von der Tasche zum Schacht (Bogen nach vorn, damit das Magazin nicht durch den Unterarm wandert)
      const k = smooth((r - tl.p1) / (tl.s0 - tl.p1));
      this._magPouch(M_REF2, m.len * 0.85);
      this._magGun(o, pre);
      if (m.top) o.pos.add(qrot(_a.set(-0.1, 0.0, 0), a.gunQuat).multiplyScalar(1 - k));
      _q2.copy(M_REF2.q).slerp(o.q, k);
      o.pos.lerp(M_REF2.pos, 1 - k);
      o.pos.add(qrot(_a.set(0, -0.03, -0.05), a.gunQuat).multiplyScalar(Math.sin(Math.PI * k)));
      o.q.copy(_q2);
      return o;
    }
    const k = (r - tl.s0) / (tl.s1 - tl.s0);
    return this._magGun(o, pre * (1 - k * k));
  }

  /* --------------------------------------------------------------- MG-Deckel */

  _coverAngle(r) {
    const tl = this.tl;
    if (!tl || tl.kind !== 'belt' || !this.rig.cover) return 0;
    return -1.15 * (ramp(r, tl.k1, tl.k2) * (1 - (r < tl.k3 ? 0 : clamp((r - tl.k3) / (tl.k4 - tl.k3), 0, 1) ** 2)));
  }

  _coverPoint(angle, out) {
    const rig = this.rig;
    _q.setFromAxisAngle(X_AX, angle).premultiply(rig.cover.q0);
    qrot(_a.copy(rig.coverAt), _q).add(rig.cover.p0);
    _a.y += 0.025; // Hand liegt auf dem Deckel
    return this.a._gunToModel(_a, out);
  }

  /* --------------------------------------------------------------- Revolver */

  _craneSwing(r) {
    return ramp(r, 0.08, 0.16) * (1 - ramp(r, 0.68, 0.76));
  }

  _leftRevolver(out, FG, r) {
    const a = this.a, rig = this.rig;
    const swing = this._craneSwing(r);
    this.craneK = swing;
    this.ejectK = win(r, 0.26, 0.29, 0.31, 0.34);
    const cyl = (k, o) => {
      // Trommel-Griffpunkt mit ausgeschwenktem Kran (Waffenraum → Modell)
      _q.setFromAxisAngle(Z_AX, 1.55 * k).premultiply(rig.crane.q0);
      qrot(_a.copy(rig.cylAt || _b.set(0, 0, 0)), _q).add(rig.crane.p0).add(_b.set(-0.012 * k - 0.02, -0.006 * k, 0));
      return a._gunToModel(_a, o);
    };
    const ej = (o) => {
      _q.setFromAxisAngle(Z_AX, 1.55 * swing).premultiply(rig.crane.q0);
      qrot(_a.copy(rig.ejAt || rig.cylAt || _b.set(0, 0, 0)), _q).add(rig.crane.p0).add(_b.set(-0.01, 0, 0.02 + 0.02 * this.ejectK));
      return a._gunToModel(_a, o);
    };
    const belt = this._pouchPoint(POUCH.hipL, 0.04, -0.03, S_P2);
    if (r < 0.1) cyl(0, S_P1), out.copy(FG).lerp(S_P1, ramp(r, 0.02, 0.1));
    else if (r < 0.18) cyl(swing, out);
    else if (r < 0.24) { cyl(swing, S_P1); ej(S_P3); out.copy(S_P1).lerp(S_P3, ramp(r, 0.18, 0.24)); }
    else if (r < 0.34) ej(out);
    else if (r < 0.46) { ej(S_P1); out.copy(S_P1).lerp(belt, ramp(r, 0.34, 0.44)); }
    else if (r < 0.62) {
      // Schnelllader von der Tasche an die Trommel (hinten), eindrehen
      cyl(swing, S_P3).add(qrot(_a.set(0.0, -0.01, 0.06), a.gunQuat));
      out.copy(belt).lerp(S_P3, ramp(r, 0.47, 0.6));
    } else if (r < 0.66) cyl(swing, out).add(qrot(_a.set(0.0, -0.01, 0.06 - 0.04 * ramp(r, 0.62, 0.65)), a.gunQuat));
    else if (r < 0.76) cyl(swing, out);
    else { cyl(0, S_P1); out.copy(S_P1).lerp(FG, ramp(r, 0.76, 0.88)); }
    this.lgrip = 1 - win(r, 0.02, 0.06, 0.82, 0.88);
    return 1;
  }

  /* --------------------------------------------------------------- Pumpflinte: Patrone für Patrone */

  _timing() {
    const d = this.a.def;
    return (d && d.shellTiming) || { start: 0.3, insert: 0.48, end: 0.42 };
  }

  /** Ende-Phase erreicht? (Bots: Zustand 'end'; Puppen: aus Fortschritt und Laufzeit geschätzt) */
  _shellEnding() {
    if (this.phaseEnd) return true;
    const tm = this._timing();
    if (this.r < 0.05) return false;
    const total = this.shellT / this.r;
    return this.shellT >= total - tm.end - (this.empty ? 0.45 : 0);
  }

  /** Fortschritt innerhalb einer Patrone 0..1 (−1 = Start-/Endphase). */
  _shellU() {
    const tm = this._timing();
    if (this.shellT < tm.start || this._shellEnding()) return -1;
    const c = (this.shellT - tm.start) / tm.insert;
    return c - Math.floor(c);
  }

  _shellPres() {
    const tm = this._timing();
    const k = clamp(this.shellT / tm.start, 0, 1);
    if (!this._shellEnding()) return smooth(k);
    if (!this.shellEnd) this.shellEnd = this.shellT;
    return 1 - smooth((this.shellT - this.shellEnd) / Math.max(0.15, tm.end * 0.8));
  }

  _leftShell(out, FG) {
    const a = this.a, rig = this.rig;
    const tm = this._timing();
    const belt = this._pouchPoint(POUCH.shells, 0.0, -0.02, S_P1);
    const port = a._gunToModel(_a.copy(rig.port || _b.set(0, 0, -0.09)).add(_b.set(-0.01, -0.035, 0.03)), S_P2);
    const sh = this.shell;
    sh.vis = false;
    if (this.shellT < tm.start && !this._shellEnding()) {
      out.copy(FG).lerp(belt, smooth(this.shellT / tm.start));
      this.lgrip = 1 - smooth(this.shellT / (tm.start * 0.5));
      return 1;
    }
    const u = this._shellU();
    if (u < 0) {
      // Ende: zurück zur Pumpe (vom Gürtel bzw. von der Ladeöffnung)
      if (!this.shellEnd) this.shellEnd = this.shellT;
      const k = smooth((this.shellT - this.shellEnd) / Math.max(0.15, tm.end * 0.7));
      out.copy(port).lerp(FG, k);
      this.lgrip = k;
      return 1;
    }
    // Patrone: aus der Gürtelschlaufe (0..0,3), zur Ladeöffnung (..0,72), hineindrücken (..0,95)
    if (u < 0.3) out.copy(belt).add(_a.set(0, 0.05 * smooth(u / 0.3), 0));
    else if (u < 0.72) { _c.copy(belt).add(_a.set(0, 0.05, 0)); out.copy(_c).lerp(port, smooth((u - 0.3) / 0.42)); }
    else {
      const k = smooth((u - 0.72) / 0.2);
      out.copy(port).add(qrot(_a.set(0.008, 0.03 * k, -0.035 * k), a.gunQuat));
    }
    sh.vis = !!rig.shell && u > 0.1 && u < 0.93;
    if (sh.vis) {
      // Patrone in der Hand (zwischen den Fingern), an der Öffnung waffenparallel
      const along = smooth((u - 0.45) / 0.27);
      sh.q.copy(a.wq[BONE.handL]).slerp(_q.multiplyQuaternions(a.gunQuat, rig.shell.q0), along);
      sh.pos.copy(out).add(qrot(_a.set(0.0, 0.025, -0.02), a.gunQuat));
    }
    this.lgrip = 0;
    this.lhold = 0.6;
    this.lq.multiplyQuaternions(a.gunQuat, HOLD_SHELL);
    return 1;
  }

  /* --------------------------------------------------------------- Panzerfaust, Allgemein */

  _leftRocket(out, FG, r) {
    const a = this.a;
    const back = this._pouchPoint(POUCH.back, 0.0, 0.0, S_P1);
    const front = a._gunToModel(_a.copy(this.a.anchors.muzzle).add(_b.set(-0.03, -0.04, 0.06)), S_P2);
    if (r < 0.3) out.copy(FG).lerp(back, ramp(r, 0.05, 0.28));
    else if (r < 0.55) out.copy(back).lerp(front, ramp(r, 0.32, 0.52));
    else if (r < 0.66) out.copy(front).add(qrot(_a.set(0, 0, 0.08 * ramp(r, 0.55, 0.64)), a.gunQuat));
    else { _c.copy(front).add(qrot(_a.set(0, 0, 0.08), a.gunQuat)); out.copy(_c).lerp(FG, ramp(r, 0.68, 0.84)); }
    this.lgrip = 1 - win(r, 0.03, 0.08, 0.78, 0.84);
    return 1;
  }

  _leftGeneric(out, FG, r) {
    const a = this.a;
    const well = a._gunToModel(_a.set(0, -0.06, -0.08), S_P1);
    const pouch = this._pouchPoint(POUCH.chestL, 0.02, -0.03, S_P2);
    const keys = [[0, FG], [0.12, well], [0.42, pouch], [0.56, pouch], [0.8, well], [0.95, FG], [1, FG]];
    a._keys(out, keys, r);
    this.lgrip = 1 - win(r, 0.02, 0.08, 0.9, 0.96);
    return 1;
  }

  /* ================================================================ Kammerstängel / Pumpe nach dem Schuss */

  /**
   * Kammerstängel-Zyklus u 0..1: hochdrehen (0..0,25), zurück (..0,5), vor (..0,75), runter (..1). Gibt den Griffpunkt
   * (Modellraum) zurück und merkt sich die Lage für parts().
   */
  boltPoint(u, out) {
    const rig = this.rig;
    if (!rig || !rig.bolt) return null;
    this.boltU = u;
    const b = rig.bolt;
    const rot = b.rot * (ramp(u, 0, 0.22) * (1 - ramp(u, 0.78, 1)));
    const back = ramp(u, 0.25, 0.48) * (1 - ramp(u, 0.52, 0.75));
    _q.setFromAxisAngle(Z_AX, rot).premultiply(b.q0);
    qrot(_a.copy(rig.boltAt), _q).add(b.p0).addScaledVector(b.travel, back);
    _a.x += 0.012; // Finger am Knauf (außen)
    return this.a._gunToModel(_a, out);
  }

  /* ================================================================ Teile schreiben */

  /** Nach dem IK: Teile der Waffe in ihre aktuelle Lage (Waffenraum) setzen. w = Nachlade-Überblendung. */
  parts(w) {
    const rig = this.rig, a = this.a;
    if (!rig) return;
    const tl = this.tl;
    const active = (this.on || w > 0.02) && tl;
    // Magazin
    const m = rig.mag;
    if (m) {
      if (active && (tl.kind === 'mag' || tl.kind === 'belt' || tl.kind === 'pistol')) {
        _qi.copy(a.gunQuat).invert();
        qrot(m.obj.position.copy(M_CUR.pos).sub(a.gunPos), _qi);
        m.obj.quaternion.multiplyQuaternions(_qi, M_CUR.q);
        m.obj.visible = M_CUR.vis && m.vis;
        // Abbruch (Spiel lädt nicht mehr): beim Ausblenden wieder einsetzen
        if (!this.on && w < 0.5) { m.obj.position.copy(m.p0); m.obj.quaternion.copy(m.q0); m.obj.visible = m.vis; }
        this.mag.moved = true;
      } else if (this.mag.moved) {
        m.obj.position.copy(m.p0); m.obj.quaternion.copy(m.q0); m.obj.visible = m.vis;
        this.mag.moved = false;
      }
    }
    // Schrotpatrone
    const s = rig.shell;
    if (s) {
      const vis = active && tl.kind === 'shell' && this.shell.vis;
      if (vis) {
        _qi.copy(a.gunQuat).invert();
        qrot(s.obj.position.copy(this.shell.pos).sub(a.gunPos), _qi);
        s.obj.quaternion.multiplyQuaternions(_qi, this.shell.q);
      }
      s.obj.visible = vis;
    }
    // Schlitten (Pistole leer: hinten gefangen, beim Lösen vor)
    if (rig.slide) {
      const k = active && tl.kind === 'pistol' ? this._slideAt(this.r) * Math.min(1, w * 2) : 0;
      if (k !== this.slideK) { rig.slide.obj.position.copy(rig.slide.p0).addScaledVector(rig.slide.travel, k); this.slideK = k; }
    }
    // Ladehebel
    if (rig.charge) {
      const k = active && tl.c1 ? this._chargeAt(this.r, tl) : 0;
      if (k !== this.chargeK) { rig.charge.obj.position.copy(rig.charge.p0).addScaledVector(rig.charge.travel, k); this.chargeK = k; }
    }
    // MG-Deckel
    if (rig.cover) {
      const ang = active ? this._coverAngle(this.r) : 0;
      if (ang !== this.coverA) { rig.cover.obj.quaternion.setFromAxisAngle(X_AX, ang).premultiply(rig.cover.q0); this.coverA = ang; }
    }
    // Revolver: Kran + Ausstoßer
    if (rig.crane) {
      const k = active && tl.kind === 'revolver' ? this.craneK : 0;
      const o = rig.crane.obj;
      o.quaternion.setFromAxisAngle(Z_AX, 1.55 * k).premultiply(rig.crane.q0);
      o.position.copy(rig.crane.p0).add(_a.set(-0.012 * k, -0.006 * k, 0));
      if (rig.ejector) rig.ejector.obj.position.copy(rig.ejector.p0).add(_a.set(0, 0, 0.022 * (active ? this.ejectK : 0)));
    }
    // Kammerstängel
    if (rig.bolt) {
      const u = this.boltU;
      const b = rig.bolt;
      if (u >= 0 && u <= 1) {
        const rot = b.rot * (ramp(u, 0, 0.22) * (1 - ramp(u, 0.78, 1)));
        const back = ramp(u, 0.25, 0.48) * (1 - ramp(u, 0.52, 0.75));
        b.obj.quaternion.setFromAxisAngle(Z_AX, rot).premultiply(b.q0);
        b.obj.position.copy(b.p0).addScaledVector(b.travel, back);
      } else { b.obj.quaternion.copy(b.q0); b.obj.position.copy(b.p0); }
      this.boltU = -1;
    }
    // Pumpe
    if (rig.pump) {
      const k = this.pumpK;
      rig.pump.obj.position.copy(rig.pump.p0).addScaledVector(rig.pump.travel, k);
    }
  }
}
