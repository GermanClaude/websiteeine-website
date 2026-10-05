// NULLPUNKT — Entscheidungen eines Bots (gestaffelt, mehrmals pro Sekunde). Bewertet die Lage und setzt
// ein Ziel (bot.goal): ausweichen (Granate) › kämpfen › Deckung/Rückzug (verletzt, Nachladen) ›
// verfolgen/flankieren/Granate (Ziel verloren) › Herrschaftsflaggen › Hinweisen nachgehen (Team, Geräusche,
// Aufklärer) › Gebiet absuchen (Spuren, Machtpositionen, erhöhte Posten halten). Setzt außerdem
// Serienprämien ein.
import * as THREE from 'three';
import { analyze, pickRoamGoal, flankPoint, findCover, retreatPoint, isPerch, perchNear } from './tactics.js';

const _v = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const CHASE_PERCH = 0.4; // Anteil vorsichtiger Verfolgungen über einen erhöhten Posten

export const GOALS = ['roam', 'engage', 'cover', 'retreat', 'chase', 'hunt', 'flank', 'objective', 'evade', 'heal', 'grenade'];

/** Anzeigenamen (Prüfstand). */
export const GOAL_LABELS = {
  roam: 'Suchen', engage: 'Gefecht', cover: 'Deckung', retreat: 'Rückzug', chase: 'Verfolgen', hunt: 'Jagen',
  flank: 'Flanke', objective: 'Flagge', evade: 'Ausweichen', heal: 'Heilen', grenade: 'Granate', idle: 'Warten',
};

export function newGoal() {
  return { kind: 'idle', move: new THREE.Vector3(), hasMove: false, tolerance: 1, speed: 'run', look: 'move', lookAt: new THREE.Vector3(), hasLook: false, since: 0, until: 0, crouch: false, data: null };
}

export function think(bot, now) {
  const G = bot.G;
  const D = bot.diff;
  const mem = bot.memory;
  const gunner = bot.gunner;
  const goal = bot.goal;
  const A = analyze(G.world);
  mem.forget(now, 16);

  // Aufklärer: gegnerische Positionen bekannt (wie der Spieler auf seiner Minikarte)
  intelFromStreaks(bot, now);

  // --- Granate in der Nähe → weg da
  const danger = grenadeThreat(bot);
  if (danger) {
    const g = danger.grenade;
    _v.subVectors(bot.position, g.position).setY(0);
    if (_v.lengthSq() < 1e-3) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _v.normalize().multiplyScalar(g.radius + 2.5).add(bot.position);
    set(goal, 'evade', now, { move: _v, speed: 'sprint', look: gunner.rec && gunner.rec.visible ? 'target' : 'move', tolerance: 1.2 });
    goal.until = now + 1.2;
    return;
  }
  if (goal.kind === 'evade' && now < goal.until) return;
  if (goal.kind === 'grenade' && bot.throwPlan) return;

  // --- Ziel wählen
  const rec = gunner.selectTarget(now);
  if (rec) gunner.engage(rec, now); else if (gunner.rec && (!gunner.rec.visible || !gunner.rec.actor.alive)) gunner.clear();
  const hp = bot.health;
  const w = bot.weapon;
  const objective = objectiveFor(bot, now);

  if (rec) {
    const d = rec.pos.distanceTo(bot.position);
    // Verletzt → Deckung / Rückzug
    if (hp < D.retreatHealth + (d < 8 ? -10 : 0) && Math.random() < D.cover + 0.2 && !(objective && objective.inside)) {
      const c = findCover(bot, rec.pos, 12, bot.manager.coverClaims(bot));
      if (c) { bot.coverNode = c; set(goal, 'cover', now, { move: c.position, speed: 'sprint', look: 'target', tolerance: 0.5 }); return; }
      const r = retreatPoint(bot, rec.pos);
      if (r) { set(goal, 'retreat', now, { move: r, speed: 'sprint', look: 'target', tolerance: 1 }); return; }
    }
    // Nachladen unter Beschuss → kurz in Deckung
    if (w && w.isReloading && d > 7 && Math.random() < D.cover) {
      const c = bot.coverNode && bot.coverNode.position.distanceTo(bot.position) < 6 ? bot.coverNode : findCover(bot, rec.pos, 7, bot.manager.coverClaims(bot));
      if (c) { bot.coverNode = c; set(goal, 'cover', now, { move: c.position, speed: 'run', look: 'target', tolerance: 0.5 }); return; }
    }
    // Kämpfen; ab und zu Deckung in Reichweite beziehen
    if (goal.kind !== 'engage') {
      bot.coverNode = null;
      if (Math.random() < D.cover * 0.5 && d > 12) {
        const c = findCover(bot, rec.pos, 5, bot.manager.coverClaims(bot));
        if (c && c.position.distanceTo(rec.pos) > 8) bot.coverNode = c;
      }
    }
    set(goal, 'engage', now, { look: 'target' });
    if (bot.coverNode) { goal.move.copy(bot.coverNode.position); goal.hasMove = true; goal.tolerance = 0.5; }
    // Granate auf Gruppe
    maybeGrenade(bot, now, rec, true);
    return;
  }

  // --- kein sichtbares Ziel
  if (w && w.current && w.current.def && w.current.def.mag && !w.isReloading && w.current.mag < w.current.def.mag * 0.55) bot.wantReload = true;
  const fresh = mem.freshestUnseen(now, D.chaseTime);
  if (hp < D.retreatHealth + 20 && fresh && now - bot.lastDamageTime < 3) {
    // heilen in Deckung
    const c = findCover(bot, fresh.pos, 10, bot.manager.coverClaims(bot));
    set(goal, 'heal', now, { move: c ? c.position : bot.position, speed: 'run', look: 'point', lookAt: fresh.pos, tolerance: 0.6, crouch: !!(c && !c.coverHigh) });
    if (c) bot.coverNode = c;
    return;
  }
  // Erhöhten Posten halten: bleiben und beobachten (zu Hinweisen schauen), außer der Gegner ist nah
  if (holdingPerch(bot, now) && !(fresh && fresh.pos.distanceTo(bot.position) < 12)) {
    overwatch(bot, now, A, fresh ? fresh.pos : null);
    return;
  }
  // Herrschaft: Flaggen haben Vorrang vor weitem Verfolgen
  if (objective && fresh && !objective.inside) {
    const near = fresh.pos.distanceTo(bot.position) < 14 && now - fresh.time < 3;
    if (!near) { set(goal, 'objective', now, { move: objective.position, speed: 'sprint', look: 'move', tolerance: Math.min(2, objective.radius * 0.4) }); return; }
  }
  if (fresh) {
    const age = now - fresh.time;
    // Granate hinter Deckung
    if (fresh.source === 'sight' && age < 3.5 && maybeGrenade(bot, now, fresh, false)) return;
    // in der Flagge bleiben
    if (objective && objective.inside && objective.kind === 'capture') { holdObjective(bot, now, objective, fresh.pos); return; }
    // Flanke, wenn Kameraden schon dran sind
    if (goal.kind !== 'flank' && fresh.source !== 'sound' && Math.random() < D.flank && bot.manager.targetCount(fresh.actor, bot) > 0) {
      const f = flankPoint(bot, A, fresh.pos);
      if (f) { set(goal, 'flank', now, { move: f, speed: 'run', look: 'point', lookAt: fresh.pos, tolerance: 1.5 }); goal.until = now + 9; return; }
    }
    if (goal.kind === 'flank' && now < goal.until && !bot.nav.arrived && !bot.nav.failed) return;
    const cautious = age > 2 || fresh.source === 'sound';
    // vorsichtig verfolgen: gelegentlich über einen erhöhten Posten mit Sicht auf die letzte Position
    const pd = goal.kind === 'chase' ? goal.data : null;
    if (pd && pd.perch && pd.actor === fresh.actor && !bot.nav.failed && fresh.pos.distanceTo(bot.position) >= 12) {
      if (!bot.nav.arrived) { goal.lookAt.copy(fresh.pos); return; } // unterwegs zum Posten
      if (!pd.holdUntil) { pd.watch = fresh.pos.clone(); startHold(bot, now, A, pd, rnd(4, 8)); }
      if (now < pd.holdUntil) { overwatch(bot, now, A, fresh.pos); return; }
    } else if (cautious && !(pd && pd.perch) && now > (bot._perchTryAt || 0) && fresh.pos.distanceTo(bot.position) > 10) {
      bot._perchTryAt = now + rnd(3, 6);
      const n = Math.random() < CHASE_PERCH ? perchNear(bot, A, fresh.pos, 18, { minDist: 6, maxFromBot: 35 }) : null;
      if (n) {
        set(goal, 'chase', now, { move: n.position, speed: 'run', look: 'point', lookAt: fresh.pos, tolerance: 0.8 });
        goal.data = { perch: true, actor: fresh.actor, node: n, watch: null, holdUntil: 0, baseYaw: 0, lookAt: 0 };
        return;
      }
    }
    set(goal, 'chase', now, { move: predicted(fresh, age), speed: cautious ? 'walk' : 'run', look: 'point', lookAt: fresh.pos, tolerance: 1.5 });
    goal.data = null;
    if (bot.nav.arrived && goal.since < now - 1) { mem.remove(fresh.actor); }
    return;
  }

  // --- Herrschaft
  if (objective) {
    if (objective.kind === 'defend' && defendFromPerch(bot, now, A, objective)) return;
    if (objective.inside) holdObjective(bot, now, objective, null);
    else set(goal, 'objective', now, { move: objective.position, speed: 'sprint', look: 'move', tolerance: Math.min(2, objective.radius * 0.4) });
    return;
  }

  // --- Hinweisen nachgehen (Teamfunk)
  const intel = bot.manager.intelFor(bot, now, 50);
  if (intel && (goal.kind !== 'hunt' || goal.data !== intel.actor || bot.nav.arrived)) {
    if (!(goal.kind === 'hunt' && bot.nav.arrived)) {
      set(goal, 'hunt', now, { move: intel.pos, speed: 'run', look: 'move', tolerance: 3 });
      goal.data = intel.actor;
      return;
    }
  }
  if (goal.kind === 'hunt' && !bot.nav.arrived && !bot.nav.failed && now - goal.since < 20) return;

  // --- Gefechtslärm in der Ferne (FFA/Waffenspiel häufig, Teams gelegentlich)
  if (goal.kind !== 'hunt' || bot.nav.arrived || bot.nav.failed) {
    const ffa = !bot.team;
    if (Math.random() < (ffa ? 0.55 : 0.2)) {
      const act = bot.manager.activityFor(bot, now, ffa ? 20 : 12, ffa ? 95 : 55);
      if (act) {
        // gelegentlich über einen erhöhten Posten mit Sicht auf den Gefechtsort anrücken
        const perch = Math.random() < 0.35 ? perchNear(bot, A, act.pos, 16) : null;
        const p = perch ? perch.position.clone() : act.pos.clone().add(new THREE.Vector3(rnd(-5, 5), 0, rnd(-5, 5)));
        set(goal, 'hunt', now, { move: p, speed: 'sprint', look: 'move', tolerance: perch ? 1 : 4 });
        goal.data = act.actor;
        return;
      }
    }
  }
  // --- Umherziehen (erhöhte Posten werden eine Weile gehalten)
  if (goal.kind === 'roam' && goal.data && goal.data.perch && bot.nav.arrived && !bot.nav.failed) {
    if (!goal.data.holdUntil) startHold(bot, now, A, goal.data, rnd(7, 15));
    if (now < goal.data.holdUntil) { overwatch(bot, now, A, null); return; }
  }
  if (goal.kind !== 'roam' || bot.nav.arrived || bot.nav.failed || now - goal.since > 35) {
    const node = pickRoamGoal(bot, A, bot.manager.roamClaims(bot));
    if (node) {
      bot.lastGoal = node.position.clone();
      const perch = isPerch(A, node);
      set(goal, 'roam', now, { move: node.position, speed: 'sprint', look: 'move', tolerance: perch ? 0.8 : 2 });
      goal.data = perch ? { perch: true, node, holdUntil: 0, baseYaw: 0, lookAt: 0 } : null;
    } else set(goal, 'idle', now, {});
  }
}

/* -------------------------------------------------------------------- Erhöhte Posten */

/** Hält der Bot gerade einen erhöhten Posten (angekommen, Haltezeit läuft)? */
function holdingPerch(bot, now) {
  const d = bot.goal.data;
  return !!(d && d.perch && d.holdUntil && now < d.holdUntil && bot.nav.arrived && !bot.nav.failed);
}

/** Haltezeit beginnen; Grundblickrichtung: Flagge, sonst Gegnerseite (FFA: Kartenmitte). */
function startHold(bot, now, A, d, duration) {
  d.holdUntil = now + duration;
  const p = bot.position;
  const to = d.watch || (bot.team === 'A' ? A.sb : bot.team === 'B' ? A.sa : A.center);
  d.baseYaw = Math.atan2(-(to.x - p.x), -(to.z - p.z));
  d.lookAt = 0;
}

/** Vom Posten aus beobachten: Blick schwenkt um die Grundrichtung oder folgt einem Hinweis. */
function overwatch(bot, now, A, threat) {
  const goal = bot.goal, d = goal.data;
  goal.look = 'point';
  goal.hasLook = true;
  if (threat) { goal.lookAt.copy(threat); goal.lookAt.y += 1.2; return; }
  if (now < d.lookAt) return;
  d.lookAt = now + rnd(1.8, 3.6);
  const yaw = d.baseYaw + rnd(-0.7, 0.7);
  const p = bot.position;
  goal.lookAt.set(p.x - Math.sin(yaw) * 20, (d.watch ? d.watch.y : A.ground) + 1.2, p.z - Math.cos(yaw) * 20);
}

/** Herrschaft (Verteidigen): gelegentlich von einem erhöhten Posten mit Sicht auf die Flagge sichern. */
function defendFromPerch(bot, now, A, o) {
  const goal = bot.goal;
  const d = goal.data;
  if (goal.kind === 'objective' && d && d.perch && d.flag === o.id) {
    if (bot.nav.failed || (now - goal.since > 25 && !d.holdUntil)) { goal.data = null; bot._perchAt = now + rnd(8, 14); return false; }
    if (!bot.nav.arrived) return true; // unterwegs
    if (!d.holdUntil) startHold(bot, now, A, d, rnd(12, 20));
    if (now < d.holdUntil) { overwatch(bot, now, A, null); return true; }
    goal.data = null;
    bot._perchAt = now + rnd(6, 12);
    return false;
  }
  if (now < (bot._perchAt || 0)) return false;
  bot._perchAt = now + rnd(5, 9);
  if (Math.random() > 0.5) return false;
  const n = perchNear(bot, A, o.center, o.radius + 14, { minDist: 3 });
  if (!n) return false;
  set(goal, 'objective', now, { move: n.position, speed: 'run', look: 'move', tolerance: 0.8 });
  goal.data = { perch: true, flag: o.id, node: n, watch: o.center.clone(), holdUntil: 0, baseYaw: 0, lookAt: 0 };
  return true;
}

/**
 * Gefährlichste Granate im Wirkbereich (+1,2 m) → { grenade, distance } | null. Granaten von
 * Verbündeten zählen nicht (kein Teambeschuss); die eigene erst, wenn sie liegt/älter als 0,5 s ist
 * oder auf den Bot zurückkommt (nicht direkt nach dem Wurf weglaufen).
 */
function grenadeThreat(bot) {
  const G = bot.G;
  const W = G.weapons;
  const list = W && W.grenades;
  if (!Array.isArray(list)) {
    const d = W && W.dangerAt ? W.dangerAt(bot.position, 1.2) : null;
    return d && d.grenade && !(d.grenade.actor === bot && d.distance > 4) ? d : null;
  }
  const combat = G.combat;
  const p = bot.position;
  let best = null, bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    const a = g.actor;
    if (a && a !== bot && combat && !combat.isHostile(bot, a)) continue;
    const d = g.position.distanceTo(p);
    if (d >= (g.radius || 6.5) + 1.2 || d >= bd) continue;
    if (a === bot && !(g.age > 0.5) && !g.rest) {
      const v = g.velocity;
      const toward = v ? v.x * (p.x - g.position.x) + v.y * (p.y - g.position.y) + v.z * (p.z - g.position.z) > 0 : false;
      if (!toward) continue;
    }
    bd = d;
    best = g;
  }
  if (!best) return null;
  const out = bot._danger || (bot._danger = { grenade: null, distance: 0 });
  out.grenade = best;
  out.distance = bd;
  return out;
}

function set(goal, kind, now, o) {
  if (goal.kind !== kind) { goal.since = now; goal.until = 0; goal.data = null; }
  goal.kind = kind;
  goal.hasMove = !!o.move;
  if (o.move) goal.move.copy(o.move);
  goal.tolerance = o.tolerance ?? 1;
  goal.speed = o.speed || 'run';
  goal.look = o.look || 'move';
  goal.hasLook = !!o.lookAt;
  if (o.lookAt) goal.lookAt.copy(o.lookAt);
  goal.crouch = !!o.crouch;
}

function predicted(rec, age) {
  const p = rec.pos.clone();
  if (rec.vel && age < 2.5) p.addScaledVector(rec.vel, Math.min(age, 1.5) * 0.6);
  return p;
}

/* -------------------------------------------------------------------- Herrschaft */

function objectiveFor(bot, now) {
  const mode = bot.G.mode;
  if (!mode || typeof mode.objectiveFor !== 'function' || !bot.team) return null;
  if (!bot._obj || now > bot._objAt) {
    bot._objAt = now + rnd(2.5, 4);
    let o = null;
    try { o = mode.objectiveFor(bot); } catch { o = null; }
    bot._obj = o ? { ...o, position: o.position.clone() } : null;
    if (bot._obj) {
      const flag = (mode.objectives || []).find((f) => f.id === o.id);
      bot._obj.center = flag ? flag.position.clone() : o.position.clone();
    }
  }
  const o = bot._obj;
  if (!o) return null;
  o.inside = bot.position.distanceTo(o.center) < o.radius * 0.95 && Math.abs(bot.position.y - o.center.y) < 2.5;
  return o;
}

function holdObjective(bot, now, o, threat) {
  const goal = bot.goal;
  if (goal.kind !== 'objective' || !goal.data || now > goal.until) {
    // Deckung im Flaggenradius suchen, sonst zufälliger Punkt im Kreis
    const nav = bot.G.world && bot.G.world.nav;
    let spot = null;
    if (nav) {
      const look = threat || awayFromOwnSpawn(bot, o.center);
      const c = nav.coverNear(o.center, look, o.radius * 0.9);
      if (c && c.position.distanceTo(o.center) < o.radius * 0.9) spot = c.position.clone();
    }
    if (!spot) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * o.radius * 0.6;
      spot = o.center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    set(goal, 'objective', now, { move: spot, speed: 'run', look: 'point', lookAt: threat || awayFromOwnSpawn(bot, o.center), tolerance: 0.8, crouch: Math.random() < 0.5 });
    goal.data = o.id;
    goal.until = now + rnd(4, 8);
  } else if (threat) {
    goal.lookAt.copy(threat);
    goal.hasLook = true;
    goal.look = 'point';
  }
}

function awayFromOwnSpawn(bot, center) {
  const A = analyze(bot.G.world);
  const own = bot.team === 'B' ? A.sb : A.sa;
  return _v.subVectors(center, own).setY(0).normalize().multiplyScalar(20).add(center).clone();
}

/* -------------------------------------------------------------------- Granaten */

/** Granate werfen, wenn sinnvoll (Gruppe sichtbar oder Ziel hinter Deckung). → true, wenn geplant. */
function maybeGrenade(bot, now, rec, visible) {
  const G = bot.G;
  const D = bot.diff;
  const w = bot.weapon;
  if (!w || !w.equipment || !w.equipment.lethal || !w.equipment.lethal.id || w.equipment.lethal.count <= 0) return false;
  if (now < bot.nextGrenadeAt || w.isThrowing || w.isReloading || !G.weapons || !G.weapons.grenadeAim) return false;
  const d = rec.pos.distanceTo(bot.position);
  if (d < 8 || d > 30) return false;
  let chance = D.grenadeChance;
  // Gruppe: weitere Gegner nahe beim Ziel
  let cluster = 0;
  for (const r of bot.memory.list) if (r !== rec && r.actor.alive && now - r.time < 4 && r.pos.distanceTo(rec.pos) < 5) cluster++;
  if (cluster > 0) chance *= 2.5;
  if (!visible) chance *= 2.2; // hinter Deckung
  bot.nextGrenadeAt = now + rnd(2.5, 5);
  if (Math.random() > chance) return false;
  // keine Kameraden im Wirkbereich
  for (const a of G.actors) if (a !== bot && a.alive && a.team && a.team === bot.team && a.position.distanceTo(rec.pos) < 7) return false;
  const type = w.equipment.lethal.id;
  const target = rec.pos.clone();
  target.y += 0.2;
  const aim = G.weapons.grenadeAim(bot, target, type);
  if (!aim || !aim.reachable) return false;
  const eq = G.data && G.data.EQUIPMENT && G.data.EQUIPMENT[type];
  const fuse = eq ? eq.fuse || 2.8 : 2.8;
  const cook = D.grenadeCook && eq && eq.cookable ? Math.max(0, fuse - aim.flightTime - rnd(0.7, 1.1)) : 0;
  bot.throwPlan = { yaw: aim.yaw, pitch: aim.pitch, cook, started: false, at: now, target };
  bot.nextGrenadeAt = now + rnd(12, 22);
  set(bot.goal, 'grenade', now, { look: 'point', lookAt: target });
  return true;
}

/* -------------------------------------------------------------------- Serienprämien */

function intelFromStreaks(bot, now) {
  const st = bot.G.mode && bot.G.mode.streaks;
  if (!st || typeof st.uavActive !== 'function') return;
  if (now < (bot._uavAt || 0)) return;
  bot._uavAt = now + 2;
  let active = false;
  try { active = st.uavActive(bot.team || bot); } catch { active = false; }
  if (!active) return;
  for (const a of bot.G.actors) {
    if (!a.alive || a === bot || !bot.G.combat.isHostile(bot, a)) continue;
    let rev = false;
    try { rev = typeof st.isRevealed === 'function' ? st.isRevealed(a, bot.team || bot) : true; } catch { rev = false; }
    if (rev) bot.memory.hear(a, a.position, now, 3, 'uav');
  }
}

/** Bereite Serienprämien einsetzen (BotManager.handlesStreaks = true). */
export function useStreaks(bot, now) {
  const st = bot.G.mode && bot.G.mode.streaks;
  if (!st || typeof st.ready !== 'function' || !bot.alive) return;
  let ready = [];
  try { ready = st.ready(bot) || []; } catch { return; }
  if (!ready.length) return;
  const fighting = bot.gunner.rec && bot.gunner.rec.visible;
  for (const id of ready) {
    try {
      if (id === 'uav') { if (st.activate(bot, 'uav')) return; }
      else if (id === 'strike') {
        const t = typeof st.suggestStrikeTarget === 'function' ? st.suggestStrikeTarget(bot) : null;
        if (t && st.activate(bot, 'strike', { target: t })) return;
      } else if (id === 'sentry' && !fighting) { if (st.activate(bot, 'sentry')) return; }
    } catch (err) { /* Modus lehnt ab → später erneut */ void err; }
  }
}
