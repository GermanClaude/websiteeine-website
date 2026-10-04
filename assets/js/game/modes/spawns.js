// NULLPUNKT — Sichere Spawnwahl (§9): bewertet jeden Kandidaten nach Abstand und Sichtlinie zu Gegnern,
// Nähe zu Mitspielern, Belegung, kürzlicher Nutzung, gegnerischen Geschützen und Luftschlag-Zonen.
// Teammodi nutzen zuerst die eigenen Teampunkte, weichen bei Druck aber auf neutrale/gegnerische aus.

import * as THREE from 'three';

const _eye = new THREE.Vector3();
const _sp = new THREE.Vector3();
const EYE = 1.6;

/**
 * Wählt einen Spawnpunkt für `actor`.
 * opts: { teams, recent: Map(spawn → zeit), threats: [{ position, radius, team, owner }],
 *         zones: [{ position, radius }] (Luftschlag), attract: [{ position, weight }] (z. B. eigene Flaggen) }
 * → { position: Vector3, yaw, source }
 */
export function chooseSpawn(G, actor, opts = {}) {
  const w = G.world;
  const sp = w && w.spawns ? w.spawns : null;
  const teams = !!opts.teams && actor.team != null;
  const now = G.time ? G.time.elapsed : 0;
  const cands = [];
  const push = (list, bonus, source) => { for (const s of list || []) if (s && s.position) cands.push({ s, bonus, source }); };
  if (sp) {
    if (teams) {
      push(sp[actor.team], 30, 'team');
      push(sp.ffa, 0, 'ffa');
      push(sp[actor.team === 'A' ? 'B' : 'A'], -25, 'enemy');
    } else {
      push(sp.ffa, 10, 'ffa');
      push(sp.A, 0, 'A');
      push(sp.B, 0, 'B');
    }
  }
  if (!cands.length) return { position: new THREE.Vector3(), yaw: 0, source: 'none' };

  const hostiles = [];
  const mates = [];
  for (const a of G.actors) {
    if (!a.alive || a === actor) continue;
    if (G.combat && G.combat.isHostile(actor, a)) hostiles.push(a); else mates.push(a);
  }
  const recent = opts.recent;
  const threats = opts.threats || [];
  const zones = opts.zones || [];
  const attract = opts.attract || [];
  let best = null;
  let bestScore = -Infinity;
  let losBudget = 220; // Sichtlinien-Abfragen pro Entscheidung begrenzen

  for (const c of cands) {
    const p = c.s.position;
    let score = c.bonus + Math.random() * 10;
    let minD = Infinity;
    for (const h of hostiles) {
      const d = h.position.distanceTo(p);
      if (d < minD) minD = d;
      if (d < 9) score -= 120;
      else if (d < 55 && losBudget > 0 && w && w.lineOfSight) {
        losBudget--;
        if (h.getEyePosition) h.getEyePosition(_eye); else _eye.copy(h.position).setY(h.position.y + EYE);
        _sp.copy(p); _sp.y += EYE;
        if (w.lineOfSight(_eye, _sp)) score -= 45 + 55 * (1 - d / 55);
      }
    }
    score += Math.min(minD, 45) * 1.1;
    if (teams && mates.length) {
      let near = Infinity;
      for (const m of mates) near = Math.min(near, m.position.distanceTo(p));
      if (near > 4 && near < 26) score += 14;
    }
    for (const a of G.actors) if (a.alive && a !== actor && a.position.distanceTo(p) < 1.4) score -= 220;
    if (recent) {
      const t = recent.get(c.s);
      if (t != null && now - t < 9) score -= 40 * (1 - (now - t) / 9);
    }
    for (const t of threats) {
      if (!t.alive || (t.owner === actor) || (t.team != null && t.team === actor.team && teams)) continue;
      const d = t.position.distanceTo(p);
      if (d < (t.radius || 40)) {
        score -= 30;
        if (losBudget > 0 && w && w.lineOfSight) {
          losBudget--;
          _eye.copy(t.position); _eye.y += 1.1;
          _sp.copy(p); _sp.y += EYE;
          if (w.lineOfSight(_eye, _sp)) score -= 80;
        }
      }
    }
    for (const z of zones) if (z.position.distanceTo(p) < (z.radius || 8) + 6) score -= 200;
    for (const a of attract) {
      const d = a.position.distanceTo(p);
      score += (a.weight || 10) * Math.max(0, 1 - d / 45);
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (recent) recent.set(best.s, now);
  return { position: best.s.position.clone(), yaw: Number.isFinite(best.s.yaw) ? best.s.yaw : 0, source: best.source };
}
