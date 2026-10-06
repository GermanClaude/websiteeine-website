// NULLPUNKT — Rutschen mit Hangabtrieb (Spieler): auf ebenem Boden wie bisher (Schub, Reibung, ≤ SLIDE_TIME,
// Ende unter 3,4 m/s), am Hang wirkt der Schwerkraftanteil entlang der Bodennormalen (body.groundNormal aus der
// Bodensonde, auf Grenzland das Geländedreieck): bergab beschleunigt das Rutschen (bis SLOPE_MAX) und hält, solange
// das Gefälle reicht – der Zeitzähler ruht dort und der Auslauf unten ist so lang wie ein normales Rutschen –,
// bergauf bremst es deutlich stärker. Quer zum Hang zieht die Schwerkraft die Bahn sanft nach unten, Lenken bleibt
// begrenzt. Kurze Luftphasen über Buckeln (≤ AIR_GRACE s) beenden ein Hangrutschen nicht. Steilere Flächen als
// maxSlope sind kein Boden (physics.js) → nach AIR_GRACE fällt man normal. Wände nehmen die Geschwindigkeit über
// die Kollision (Kopf voran → Ende). Tunneln verhindern die Unterschritte von CapsuleBody.step (≤ halber Radius).
// Auf Stufen/Treppen ist die Normale waagerecht → Verhalten wie bisher. Keine Allokationen pro Bild.

import { Vector3, Object3D } from 'three';

const SLIDE_END = 3.4; // m/s: darunter endet jedes Rutschen (wie bisher)
const SLIDE_END_SLOPE = 5; // m/s: am Hang endet ein langes Rutschen schon darunter (kein Schleichen bergab)
const SLOPE_GAIN = 0.75; // Anteil des Hangabtriebs (kontrollierbar statt Rodelbahn)
const SLOPE_KEEP = 0.12; // Gefälle (tan ≈ 7°): ab hier ruht der Zeitzähler
const SLOPE_FREE = 0.27; // Gefälle (tan ≈ 15°): Reibung fast ganz vom Hangabtrieb überwunden
const SLOPE_MAX = 11.8; // m/s waagerecht: Höchsttempo durch Hangabtrieb
const AIR_GRACE = 0.35; // s Luft (Buckel) beim Hangrutschen
const AIR_FLAT = 0.15; // s: auf ebenem Boden endet das Rutschen in der Luft nach dieser Zeit (wie bisher)
const MAX_TIME = 12; // s Obergrenze eines Rutschens (Sicherheitsnetz)
// Rutschen ohne vollen Sprint: bergab aus dem Laufen bzw. Ducken in Bewegung an steilen Hängen
const START_RUN_GRADE = 0.176; // tan 10°
const START_RUN_SPEED = 3.6;
const START_STEEP_GRADE = 0.3; // tan ≈ 17°
const START_STEEP_SPEED = 1.5;

const _up = Object3D.DEFAULT_UP;
const _d = new Vector3();

/** Gefälle (tan) entlang der waagerechten Richtung (dx, dz) auf der Bodennormalen n: > 0 bergab, < 0 bergauf. */
export function slopeGrade(n, dx, dz) {
  if (!n || n.y <= 0.3 || n.y >= 0.9999) return 0;
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) return 0;
  return (n.x * dx + n.z * dz) / l / n.y;
}

/**
 * Darf aus dem aktuellen Tempo gerutscht werden? Voller Sprint wie bisher (> 5 m/s), bergab auch aus dem
 * Laufen bzw. an steilen Hängen aus jeder Bewegung. Ausdauer und Abklingzeit prüft der Aufrufer.
 */
export function slideAllowed(p, hSpeed) {
  const body = p.body;
  if (!body.onGround) return false;
  if (p.sprinting && hSpeed > 5) return true;
  if (hSpeed < START_STEEP_SPEED) return false;
  const v = body.velocity;
  const g = slopeGrade(body.groundNormal, v.x, v.z);
  return (g >= START_RUN_GRADE && hSpeed > START_RUN_SPEED) || g >= START_STEEP_GRADE;
}

/** Zustand eines neuen Rutschens (von player._startSlide). */
export function slideBegin(p) {
  p._slideRun = 0;
  p._slideAir = 0;
  const v = p.body.velocity;
  p._slideGrade = p.body.onGround ? slopeGrade(p.body.groundNormal, v.x, v.z) : 0;
}

/**
 * Ein Rutsch-Schritt vor body.step: lenken, Hangabtrieb, Reibung, Tempo setzen. → true, wenn das Rutschen
 * endet (Aufrufer: _endSlide). gravity = Spielschwerkraft (m/s²), slideTime/friction = Flachwerte des Spielers.
 */
export function slideStep(p, dt, mx, gravity, slideTime, friction) {
  const body = p.body;
  const v = body.velocity;
  const d = p.slideDir;
  p.slideTime += dt;
  // leicht lenkbar
  const steer = mx * 0.9 * dt;
  if (steer) d.applyAxisAngle(_up, -steer).normalize();
  const cur = Math.hypot(v.x, v.z); // nach _startSlide() bereits mit Schub; Wände haben schon gebremst
  const ground = body.onGround;
  const n = body.groundNormal;
  let grade = p._slideGrade || 0;
  let sp;
  if (ground) {
    grade = slopeGrade(n, d.x, d.z);
    p._slideGrade = grade;
    p._slideAir = 0;
    // Reibung: bergab teils vom Hangabtrieb aufgehoben, bergauf/eben wie bisher
    const relief = grade > 0 ? Math.min(1, grade / SLOPE_FREE) * 0.85 : 0;
    sp = Math.max(0, cur * Math.exp(-friction * (1 - relief) * dt) - 0.6 * dt);
    if (n.y > 0.3 && n.y < 0.9999) {
      // Hangabtrieb (waagerechter Anteil der Schwerkraft in der Ebene: g · n.y · (n.x, n.z)) als Vektor:
      // längs bremst/beschleunigt er, quer dreht er die Bahn hangabwärts
      const k = SLOPE_GAIN * gravity * n.y * dt;
      _d.set(d.x * sp + n.x * k, 0, d.z * sp + n.z * k);
      const ns = Math.hypot(_d.x, _d.z);
      if (ns > 0.5) d.set(_d.x / ns, 0, _d.z / ns);
      // Obergrenze nur für den Zuwachs durch den Hang (Schub vom Start/Adrenalin bleibt erhalten)
      sp = ns > sp ? Math.min(ns, Math.max(SLOPE_MAX, sp)) : ns;
    }
  } else {
    p._slideAir = (p._slideAir || 0) + dt;
    sp = Math.max(0, cur * Math.exp(-friction * dt) - 0.6 * dt);
  }
  v.x = d.x * sp;
  v.z = d.z * sp;
  // Zeitzähler: ruht auf ausreichendem Gefälle, sonst läuft er (eben: genau wie früher slideTime)
  const downhill = grade >= SLOPE_KEEP;
  if (ground && downhill) p._slideRun = 0;
  else p._slideRun = (p._slideRun || 0) + dt;
  if (p.slideTime > MAX_TIME || p._slideRun > slideTime || sp < SLIDE_END) return true;
  if (ground && downhill && p.slideTime > slideTime && sp < SLIDE_END_SLOPE) return true;
  if (!ground) {
    // in der Luft: am Hang (zuletzt bergab) kurze Sprünge über Buckel erlaubt, sonst wie bisher
    if (p._slideAir > AIR_GRACE) return true;
    if (grade < 0.05 && p.slideTime > AIR_FLAT) return true;
  }
  // tiefes Wasser (Schwimmen, sobald vorhanden) beendet das Rutschen
  if (p.swimming || p.inWater) return true;
  return false;
}
