// NULLPUNKT — Wahrnehmung: Sichtkegel + Sichtweite (je Schwierigkeit), Sichtlinie über world.lineOfSight
// (Brust, dann Kopf – mit globalem Strahlenbudget pro Bild), Entdeckungsgrad abhängig von Abstand,
// Blickzentrum, Bewegung, Mündungsfeuer und Haltung. Keine Sicht durch Wände, kein Allwissen.
// Reicht das Strahlenbudget nicht, wird der Durchgang im nächsten Bild an derselben Stelle fortgesetzt
// (Startpunkt rotiert, niemand wird bevorzugt) und noch sichtbare Einträge gelten bis dahin als
// unbestätigt (kein Feuer auf möglicherweise verdeckte Ziele).
import * as THREE from 'three';

const _eye = new THREE.Vector3();
const _p = new THREE.Vector3();
const _h = new THREE.Vector3();

/** Zielpunkte eines Akteurs/Geschützes: Brust (out) und Kopf (head). */
export function targetPoints(a, chest, head) {
  if (a.isStreakEntity && typeof a.getAimPoint === 'function') {
    a.getAimPoint(chest);
    head.copy(chest);
    head.y += 0.25;
    return;
  }
  const h = a.body ? a.body.height : 1.8;
  chest.set(a.position.x, a.position.y + h * 0.62, a.position.z);
  head.set(a.position.x, a.position.y + h - 0.16, a.position.z);
  // Lehnen (core-input, F5): Kopf und Oberkörper wandern mit (wie combat.raycastHumanoid)
  const lo = a.leanOffset;
  if (lo && (lo.x || lo.z)) { chest.x += lo.x * 0.55; chest.z += lo.z * 0.55; head.x += lo.x; head.z += lo.z; head.y += Math.min(0, lo.y || 0); }
}

/**
 * Ein Wahrnehmungsschritt (gestaffelt aufgerufen). dt = Zeit seit dem letzten Schritt.
 */
export function sense(bot, now, dt) {
  const G = bot.G;
  const mgr = bot.manager;
  const D = bot.diff;
  const mem = bot.memory;
  const world = G.world;
  bot.getEyePosition(_eye);
  const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
  const cosHalf = Math.cos(D.fov / 2);
  const cosWide = Math.cos(Math.min(Math.PI * 0.95, D.fov / 2 + 0.6));
  const list = mgr.hostilesOf(bot);
  const n = list.length;
  const st = bot._sense || (bot._sense = { next: 0, remain: 0, carry: 0 });
  if (!n) { st.remain = 0; return; }
  // Geblendet (Blendgranate): sieht nichts – bekannte Ziele verblassen, Hören läuft weiter (manager)
  if (bot.flashedUntil > now) {
    const L = mem.list;
    for (let i = 0; i < L.length; i++) { const r = L[i]; if (r.visible) r.visible = false; r.spot = Math.max(0, r.spot - dt * 0.6); }
    st.remain = 0;
    return;
  }
  // Rauch (Arsenal: G.weapons.smokes/smokeVisibility): dichte Wolken verdecken, dünne erschweren das Entdecken
  const WS = G.weapons;
  const smoke = WS && WS.smokes && WS.smokes.length && typeof WS.smokeVisibility === 'function' ? WS : null;
  // unterbrochener Durchgang → dort fortsetzen (Zeit seit der letzten Prüfung dieser Einträge mitzählen)
  const start = st.next % n;
  const count = st.remain > 0 ? Math.min(n, st.remain) : n;
  if (st.remain > 0) dt += st.carry;
  st.remain = 0;
  for (let k = 0; k < count; k++) {
    const i = (start + k) % n;
    const a = list[i];
    if (!a.alive) continue;
    targetPoints(a, _p, _h);
    const dx = _p.x - _eye.x, dy = _p.y - _eye.y, dz = _p.z - _eye.z;
    const d = Math.hypot(dx, dy, dz) || 1e-3;
    let rec = mem.get(a);
    const firing = now - (a.lastFiredTime || -1e9) < 0.8;
    const maxD = D.viewDistance * (firing ? 1.3 : 1);
    if (d > maxD) { if (rec) { rec.visible = false; rec.spot = Math.max(0, rec.spot - dt * 0.5); } continue; }
    const cos = (dx * fx + dz * fz) / Math.max(1e-3, Math.hypot(dx, dz));
    const tracked = rec && rec.visible;
    const hurt = rec && now - rec.hurtMe < 1.6;
    const inCone = cos > cosHalf || d < 3.2 || (tracked && cos > cosWide) || (hurt && cos > -0.3);
    if (!inCone) { if (rec) { rec.visible = false; rec.spot = Math.max(0, rec.spot - dt * 0.4); } continue; }
    // Sichtlinie (Budget): erschöpft → im nächsten Bild hier weitermachen, bis dahin unbestätigt
    if (!mgr.takeLos()) {
      st.next = i;
      st.remain = count - k;
      st.carry = dt;
      bot._senseT = 0;
      for (let j = k; j < count; j++) {
        const r = mem.get(list[(start + j) % n]);
        if (r && r.visible) r.unverified = true;
      }
      return;
    }
    let vis = !world || !world.lineOfSight || world.lineOfSight(_eye, _p);
    let partial = false;
    if (!vis && mgr.takeLos()) { vis = world.lineOfSight(_eye, _h); partial = vis; }
    let haze = 1;
    if (vis && smoke) {
      haze = smoke.smokeVisibility(_eye, partial ? _h : _p);
      if (haze < 0.3) vis = false;
    }
    if (!vis) {
      if (rec && rec.visible) rec.visible = false;
      if (rec) rec.spot = Math.max(0, rec.spot - dt * 0.35);
      continue;
    }
    rec = mem.see(a, now, dt);
    rec.partial = partial;
    // Entdeckung
    if (rec.spot < 1) {
      const sp = a.body ? Math.hypot(a.body.velocity.x, a.body.velocity.z) : 0;
      let rate = D.spotRate;
      rate *= Math.max(0.22, Math.min(1.6, 1.6 - d / 42));
      rate *= cos > 0.96 ? 1.45 : cos > cosHalf ? 0.85 : 0.5;
      rate *= sp > 3 ? 1.3 : sp < 0.5 ? 0.72 : 1;
      if (firing) rate *= 2.3;
      if (a.body && a.body.height < 1.5) rate *= 0.75;
      if (partial) rate *= 0.7;
      if (hurt) rate *= 2.5;
      if (d < 6) rate *= 4;
      if (a.isStreakEntity) rate *= 1.5;
      rate *= haze; // Dunst/Rauchrand
      rec.spot = Math.min(1, rec.spot + rate * dt);
      if (rec.spot >= 1) {
        rec.acquiredAt = now;
        mgr.callout(bot, a, rec.pos, now);
      }
    }
  }
  st.next = (start + 1) % n; // nächster Durchgang beginnt beim nächsten Gegner (reihum)
}
