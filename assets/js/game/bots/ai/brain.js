// NULLPUNKT — Entscheidungen eines Bots (gestaffelt, mehrmals pro Sekunde). Bewertet die Lage und setzt
// ein Ziel (bot.goal): ausweichen (Granate) › kämpfen › Deckung/Rückzug (verletzt, Nachladen) ›
// verfolgen/flankieren/Granate (Ziel verloren) › Herrschaftsflaggen › Hinweisen nachgehen (Team, Geräusche,
// Aufklärer) › Gebiet absuchen (Spuren, Machtpositionen, erhöhte Posten halten). Setzt außerdem
// Serienprämien ein. Befehle des Spielers (Befehlsrad, ai/orders.js) haben Vorrang vor Truppbefehlen, Flaggen und
// Suchen; Ausweichen, Zurückschießen und Deckung bleiben dem Hirn.
import * as THREE from 'three';
import { analyze, pickRoamGoal, flankPoint, findCover, retreatPoint, isPerch, perchNear } from './tactics.js';
import { commandFor, commandStep, isAnchored } from './orders.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const CHASE_PERCH = 0.4; // Anteil vorsichtiger Verfolgungen über einen erhöhten Posten (FFA: halb so oft)
const HUNT_PERCH = 0.35; // Anteil der Anmärsche zu Gefechtslärm über einen erhöhten Posten (FFA: halb so oft)

export const GOALS = ['roam', 'engage', 'cover', 'retreat', 'chase', 'hunt', 'flank', 'objective', 'evade', 'heal', 'grenade', 'squad', 'check', 'command'];

/** Anzeigenamen (Prüfstand). */
export const GOAL_LABELS = {
  roam: 'Suchen', engage: 'Gefecht', cover: 'Deckung', retreat: 'Rückzug', chase: 'Verfolgen', hunt: 'Jagen',
  flank: 'Flanke', objective: 'Flagge', evade: 'Ausweichen', heal: 'Heilen', grenade: 'Granate', idle: 'Warten', squad: 'Trupp', check: 'Prüfen',
  command: 'Befehl',
};
/** Truppbefehle (bots-scale, ai/squad.js), die auch bei Feindsicht weiterlaufen (Bot feuert dabei). */
const MOVE_UNDER_FIRE = new Set(['fallback', 'medic']);

export function newGoal() {
  return { kind: 'idle', move: new THREE.Vector3(), hasMove: false, tolerance: 1, speed: 'run', look: 'move', lookAt: new THREE.Vector3(), hasLook: false, since: 0, until: 0, crouch: false, data: null, hold: false, sub: null, repath: 1.5 };
}

export function think(bot, now) {
  const G = bot.G;
  const D = bot.diff;
  const mem = bot.memory;
  const gunner = bot.gunner;
  const goal = bot.goal;
  const A = analyze(G.world);
  const adapt = bot.manager.adapt && bot.manager.adapt.on(bot) ? bot.manager.adapt : null; // ai-adapt
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
  // Befehl des Spielers (Befehlsrad): verdrängt Truppbefehle (bot.order bleibt dann leer)
  const cmd = commandFor(bot, now);
  // Truppbefehl (bots-scale): gilt bis order.until
  let ord = !cmd && bot.order && bot.order.kind && now < bot.order.until ? bot.order : null;
  // Weg zum Befehlsziel gescheitert (Fortschrittswächter/Festhängen) → Befehl fallen lassen, 8 s selbst entscheiden
  if (ord && ord.hasPos && goal.kind === 'squad' && bot.nav.failed) { bot._orderBan = now + 8; ord.kind = null; ord = null; }

  // --- Ziel wählen
  const rec = gunner.selectTarget(now);
  if (rec) gunner.engage(rec, now); else if (gunner.rec && (!gunner.rec.visible || !gunner.rec.actor.alive)) gunner.clear();
  const hp = bot.health;
  const w = bot.weapon;
  const objective = objectiveFor(bot, now);

  if (rec) {
    // Spielerbefehl: feuernd zum Platz/zur Stellung, aus der Stellung kämpfen (sonst normales Gefecht, siehe orders.js)
    if (cmd && commandStep(bot, cmd, now, rec, set)) return;
    // Ausweichen/Sanitäter: weiterlaufen und dabei feuern
    if (ord && MOVE_UNDER_FIRE.has(ord.kind)) { applyOrder(bot, ord, now, rec); return; }
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
    // Stellung aus dem Truppbefehl halten (Feuerbasis, Sichern, Stapel): von dort kämpfen statt vorzugehen
    if (ord && ord.hold && ord.hasPos && d > 18) { bot.coverNode = null; goal.move.copy(ord.pos); goal.hasMove = true; goal.tolerance = 0.8; goal.hold = true; }
    // Granate auf Gruppe
    maybeGrenade(bot, now, rec, true);
    return;
  }

  // --- kein sichtbares Ziel
  if (w && w.current && w.current.def && w.current.def.mag && !w.isReloading && w.current.mag < w.current.def.mag * 0.55) bot.wantReload = true;
  const fresh = mem.freshestUnseen(now, D.chaseTime);
  if (hp < D.retreatHealth + 20 && fresh && now - bot.lastDamageTime < 3 && !isAnchored(cmd)) {
    // heilen in Deckung
    const c = findCover(bot, fresh.pos, 10, bot.manager.coverClaims(bot));
    set(goal, 'heal', now, { move: c ? c.position : bot.position, speed: 'run', look: 'point', lookAt: fresh.pos, tolerance: 0.6, crouch: !!(c && !c.coverHigh) });
    if (c) bot.coverNode = c;
    return;
  }
  // Spielerbefehl (folgen, halten, sammeln, angreifen …)
  if (cmd && commandStep(bot, cmd, now, null, set)) return;
  // Truppbefehl (Vorgehen, Sichern, Niederhalten, Flanke, Sammeln, Stapel …)
  if (ord) { applyOrder(bot, ord, now, null); return; }
  // Erhöhter Posten (aus Umherziehen/Verfolgen/Jagen/Verteidigen): hingehen, dann eine Weile halten
  if (perchStep(bot, now, A, fresh)) return;
  // Herrschaft: Flaggen haben Vorrang vor weitem Verfolgen
  if (objective && fresh && !objective.inside) {
    const near = fresh.pos.distanceTo(bot.position) < 14 && now - fresh.time < 3;
    if (!near) {
      // eigene Flagge: gelegentlich von einem erhöhten Posten mit Sicht darauf sichern
      if (objective.kind === 'defend' && defendFromPerch(bot, now, A, objective)) return;
      set(goal, 'objective', now, { move: objective.position, speed: 'sprint', look: 'move', tolerance: Math.min(2, objective.radius * 0.4) });
      return;
    }
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
    // ai-adapt: gegen einen Nahkämpfer lieber einen Winkel halten (Posten/Deckung mit Sicht) statt nachzurennen
    const holdA = !!(adapt && now > (bot._perchTryAt || 0) && adapt.holdRoll(bot, fresh));
    const cautious = age > 2 || fresh.source === 'sound' || holdA;
    // vorsichtig verfolgen: gelegentlich über einen erhöhten Posten mit Sicht auf die letzte Position
    if (cautious && now > (bot._perchTryAt || 0) && fresh.pos.distanceTo(bot.position) > 10) {
      bot._perchTryAt = now + rnd(3, 6);
      let n = holdA || Math.random() < CHASE_PERCH * (bot.team ? 1 : 0.5) ? perchNear(bot, A, fresh.pos, 22, { tests: 10, minDist: 6, maxFromBot: fresh.pos.distanceTo(bot.position) + 6 }) : null;
      if (!n && holdA) n = findCover(bot, fresh.pos, 10, bot.manager.coverClaims(bot));
      if (n) {
        set(goal, 'chase', now, { move: n.position, speed: 'run', look: 'point', lookAt: fresh.pos, tolerance: 0.8 });
        goal.data = perchData(n, fresh.actor, fresh.pos, rnd(4, 7) * (holdA ? 1.6 : 1));
        if (holdA) adapt.note(bot, 'hold_angle');
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
        const perch = Math.random() < HUNT_PERCH * (ffa ? 0.5 : 1) ? perchNear(bot, A, act.pos, 18) : null;
        const p = perch ? perch.position : _v.copy(act.pos).add(_v2.set(rnd(-5, 5), 0, rnd(-5, 5)));
        set(goal, 'hunt', now, { move: p, speed: 'sprint', look: 'move', tolerance: perch ? 0.8 : 4 });
        goal.data = perch ? perchData(perch, act.actor, act.pos, rnd(5, 10)) : act.actor;
        return;
      }
    }
  }
  // --- Umherziehen (erhöhte Posten werden über perchStep eine Weile gehalten)
  if (goal.kind !== 'roam' || bot.nav.arrived || bot.nav.failed || now - goal.since > 35) {
    // ai-adapt: gelernte Lieblingsplätze des Spielers kontrollieren (überwachen bzw. von hinten anlaufen, dann halten)
    const chk = adapt && adapt.checkGoal(bot, now, A);
    if (chk) {
      set(goal, 'check', now, { move: chk.move, speed: chk.speed, look: 'point', lookAt: chk.watch, tolerance: 0.9 });
      goal.data = perchData(chk.node, null, chk.watch, chk.hold);
      return;
    }
    // ai-adapt (Verbündete lernen mit): Erfolgs-Positionen des Spielers besetzen und in seine Schussrichtung sichern
    const ad = !adapt && bot.manager.adapt;
    const ally = ad && ad.allyOn(bot) ? ad.allyGoal(bot, now, A) : null;
    if (ally) {
      set(goal, 'check', now, { move: ally.move, speed: 'run', look: 'point', lookAt: ally.watch, tolerance: 0.9 });
      goal.data = perchData(ally.node, null, ally.watch, ally.hold);
      return;
    }
    const node = pickRoamGoal(bot, A, bot.manager.roamClaims(bot));
    if (node) {
      bot.lastGoal = node.position.clone();
      const perch = isPerch(A, node);
      set(goal, 'roam', now, { move: node.position, speed: 'sprint', look: 'move', tolerance: perch ? 0.8 : 2 });
      goal.data = perch ? perchData(node, null, null, rnd(6, 12)) : null;
    } else if (A && A.nodes.length) {
      // immer ein Ziel (bots-scale): notfalls ein zufälliger erreichbarer Knoten statt Herumstehen
      const n = A.nodes[(Math.random() * A.nodes.length) | 0];
      set(goal, 'roam', now, { move: n.position, speed: 'run', look: 'move', tolerance: 2 });
    } else set(goal, 'idle', now, {});
  }
}

/** Truppbefehl als Ziel übernehmen (Warten auf den Einsatz: stehen bleiben, hocken). */
function applyOrder(bot, ord, now, rec) {
  const goal = bot.goal;
  const wait = ord.startAt && now < ord.startAt;
  set(goal, 'squad', now, {
    move: ord.hasPos && !wait ? ord.pos : null, speed: ord.speed, look: ord.hasLook ? 'point' : rec ? 'target' : 'move',
    lookAt: ord.hasLook ? ord.look : null, tolerance: ord.tol, crouch: ord.stance === 'crouch' || wait,
  });
  goal.sub = ord.kind;
  goal.hold = ord.hold;
  goal.repath = ord.repath || 1.5;
}

/* -------------------------------------------------------------------- Erhöhte Posten */

const PERCH_TRAVEL = 25; // s: länger unterwegs → Posten aufgeben

/** Zieldaten für einen erhöhten Posten (goal.data). watch: Ort, den der Posten überblicken soll. */
function perchData(node, actor, watch, holdFor) {
  return { perch: true, node, actor, watch: watch ? watch.clone() : null, holdFor, holdUntil: 0, baseYaw: 0, lookAt: 0 };
}

/**
 * Erhöhten Posten anlaufen und halten (gilt für jedes Ziel mit goal.data.perch). → true, solange der
 * Posten das Verhalten bestimmt. Aufgegeben bei Fehlschlag der Wegfolge, zu langer Anreise, nahem
 * Gegner (< 12 m) oder nach Ablauf der Haltezeit. Sichtbare Gegner (Gefecht) beenden ihn ohnehin.
 */
function perchStep(bot, now, A, fresh) {
  const goal = bot.goal, d = goal.data;
  if (!d || !d.perch) return false;
  const drop = () => { goal.data = null; bot._perchTryAt = now + rnd(4, 8); return false; };
  if (bot.nav.failed) return drop();
  if (fresh && fresh.pos.distanceTo(bot.position) < 12) return drop();
  if (!bot.nav.arrived) {
    if (now - goal.since > PERCH_TRAVEL) return drop();
    if (fresh && goal.look === 'point') goal.lookAt.copy(fresh.pos);
    return true; // unterwegs
  }
  if (!d.holdUntil) startHold(bot, now, A, d, d.holdFor);
  if (now < d.holdUntil) { overwatch(bot, now, A, fresh ? fresh.pos : null); return true; }
  return drop();
}

/** Haltezeit beginnen; Grundblickrichtung: überwachter Ort, sonst Gegnerseite (FFA: Kartenmitte). */
function startHold(bot, now, A, d, duration) {
  d.holdUntil = now + duration * (bot.team ? 1 : 0.6); // Jeder gegen jeden: kürzer halten (Tempo)
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
  if (now < (bot._perchAt || 0)) return false;
  bot._perchAt = now + rnd(5, 9);
  if (Math.random() > 0.5) return false;
  const n = perchNear(bot, A, o.center, o.radius + 14, { minDist: 3 });
  if (!n) return false;
  set(bot.goal, 'objective', now, { move: n.position, speed: 'run', look: 'move', tolerance: 0.8 });
  bot.goal.data = perchData(n, null, o.center, rnd(12, 20));
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
  goal.hold = false;
  goal.sub = null;
  goal.repath = 1.5;
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
  // ai-adapt: gegen einen campenden Spieler (eigene Wahrnehmung) öfter
  const adapt = bot.manager.adapt && bot.manager.adapt.on(bot) ? bot.manager.adapt : null;
  const campMul = adapt ? adapt.nadeMul(bot, rec) : 1;
  let chance = D.grenadeChance * campMul;
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
  if (campMul > 1) adapt.note(bot, 'nade_camper', { kind: type });
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
      // FPV-Drohne: Autopilot zum nächsten Gegner (modes/drone.js) – nur mit einem Gegner in Reichweite, nicht im Feuergefecht
      else if (id === 'drohne' && !fighting && typeof st.droneTargetFor === 'function' && st.droneTargetFor(bot)) { if (st.activate(bot, 'drohne')) return; }
    } catch (err) { /* Modus lehnt ab → später erneut */ void err; }
  }
}
