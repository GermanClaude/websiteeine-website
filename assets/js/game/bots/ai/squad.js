// NULLPUNKT — Trupptaktik der Bots (bots-scale). Je Seite Trupps zu acht = zwei Feuerteams à vier mit Rollen
// (Truppführer, MG-Schütze, Schütze, Pionier mit Panzerabwehr, Sanitäter, Aufklärer). Nur ab Veteran
// (`diff.teamTactics`) gibt der Trupp Befehle (`bot.order`), die das Bot-Hirn ausführt:
//   • Vorgehen im Wechsel („bounding overwatch“): ein Feuerteam springt von Deckung zu Deckung, das andere sichert
//     (hockend/liegend, Blick zum Ziel), dann Wechsel.
//   • Niederhalten + Flanke: Feuerbasis (Team mit MG) hält die letzte bekannte Feindposition nieder, das andere
//     Team geht über einen weiten Umweg in die Flanke (L-förmiges Kreuzfeuer); offenes Gelände wird vorher eingenebelt.
//   • Raum räumen: am Eingang sammeln (Stapel), Blend-/Splittergranate hinein, gestaffelt eintreten, Sektoren über Kreuz.
//   • Ausweichen bei Unterzahl (mit Rauch), Sammeln beim Führer nach Verlusten/Zerstreuung, Sanitäter zum Verwundeten
//     (Rauch, wenn der Verwundete unter Feuer liegt).
// Rekrut/Regulär: Trupps nur für Rollen/Ausrüstung, keine Befehle (einfache, aber zielgerichtete Bots).
// Jede Maßnahme meldet `bot:tactic { type, squad, team, … }` (type: bound, overwatch, suppress, flank, crossfire,
// smoke, stack, clear_grenade, enter, fallback, regroup, medic, heal, spot, at, prone).
import * as THREE from 'three';
import { analyze } from './tactics.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _c = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

/** Rollen je Feuerteam in Auffüllreihenfolge (kleine Teams bekommen zuerst Führer, Sanitäter bzw. Pionier). */
export const FT_ROLES = [
  ['leader', 'medic', 'mg', 'rifleman'],
  ['leader', 'grenadier', 'marksman', 'rifleman'],
];
/** Befehle, bei denen der Bot seine Stellung hält und aus ihr kämpft. */
/** Kleine Trupps (≤ 6, Arena-Teamgrößen): zweites Feuerteam ohne eigenen Führer – sonst gäbe es keine Schützen
 *  und jeder dritte Bot wäre „Führer“ (Funkgerät-Aussehen). */
export const FT_ROLES_SMALL = ['rifleman', 'grenadier', 'marksman'];
export const HOLD_ORDERS = new Set(['overwatch', 'suppress', 'hold', 'stack', 'regroup_hold']);

/** Rollenplan für n Bots einer Seite → [{ squad, ft, role }] (Trupps möglichst gleich groß, höchstens 8). */
export function planRoles(n) {
  const out = [];
  const squads = Math.max(1, Math.ceil(n / 8));
  let left = n;
  for (let s = 0; s < squads; s++) {
    const size = Math.ceil(left / (squads - s));
    left -= size;
    const a = Math.ceil(size / 2), b = size - a;
    for (let i = 0; i < a; i++) out.push({ squad: s, ft: 0, role: FT_ROLES[0][i] || 'rifleman' });
    const r1 = size <= 6 ? FT_ROLES_SMALL : FT_ROLES[1];
    for (let i = 0; i < b; i++) out.push({ squad: s, ft: 1, role: r1[i] || 'rifleman' });
  }
  return out;
}

/** Ist der Ort überdacht (Innenraum)? Ein Strahl nach oben, gerastert gecacht. */
function indoor(world, p, cache) {
  if (!world || typeof world.lineOfSight !== 'function') return false;
  const key = `${Math.round(p.x)}|${Math.round(p.y)}|${Math.round(p.z)}`;
  let v = cache.get(key);
  if (v === undefined) {
    _a.set(p.x, p.y + 0.8, p.z);
    _b.set(p.x, p.y + 7, p.z);
    v = !world.lineOfSight(_a, _b);
    if (cache.size > 4000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

function newOrder() {
  return { kind: null, pos: new THREE.Vector3(), hasPos: false, look: new THREE.Vector3(), hasLook: false, stance: null, speed: 'run', tol: 1, until: 0, hold: false, suppress: false, supPos: new THREE.Vector3(), target: null, startAt: 0, repath: 2, id: 0 };
}

export class TeamTactics {
  constructor(mgr) {
    this.mgr = mgr;
    this.squads = [];
    this._byKey = new Map();
    this._indoor = new Map();
    this.counts = {};
    this._alive = [];
  }

  clear() {
    for (const sq of this.squads) for (const m of sq.members) { m.tsquad = null; if (m.order) m.order.kind = null; }
    this.squads.length = 0;
    this._byKey.clear();
    this._indoor.clear();
    this.counts = {};
  }

  /** Bot einem Trupp zuordnen (beim Erzeugen; plan aus planRoles). */
  register(bot, plan) {
    const key = `${bot.team}:${plan.squad}`;
    let sq = this._byKey.get(key);
    if (!sq) {
      sq = {
        id: key, team: bot.team, index: plan.squad, members: [], ft: [[], []], lead: null, state: 'move', since: 0, nextAt: Math.random() * 0.5,
        contact: new THREE.Vector3(), contactAt: -1e9, seenAt: -1e9, enemies: 0, dest: new THREE.Vector3(), hasDest: false, destAt: -1e9,
        bound: { active: false, mover: 1, until: 0, target: new THREE.Vector3(), started: 0 },
        plan: null, room: null, fallbackAt: -1e9, regroupAt: -1e9, aliveAtContact: 0, lastAlive: 0, crossAt: -1e9, medicAt: 0,
      };
      this._byKey.set(key, sq);
      this.squads.push(sq);
    }
    sq.members.push(bot);
    sq.ft[plan.ft].push(bot);
    bot.tsquad = sq;
    bot.ft = plan.ft;
    bot.role = plan.role;
    if (!bot.order) bot.order = newOrder();
    sq.lastAlive = sq.members.length;
  }

  emit(sq, type, extra = null) {
    this.counts[type] = (this.counts[type] || 0) + 1;
    const e = { type, squad: sq ? sq.id : null, team: sq ? sq.team : null };
    if (extra) Object.assign(e, extra);
    this.mgr.G.events.emit('bot:tactic', e);
  }

  update(dt, now) {
    for (let i = 0; i < this.squads.length; i++) {
      const sq = this.squads[i];
      if (now < sq.nextAt) continue;
      const lead = sq.members[0];
      const hard = !!(lead && lead.diff && lead.diff.teamTactics);
      sq.nextAt = now + (hard ? 0.5 : 1.5) * rnd(0.9, 1.1);
      this._eval(sq, now, hard);
    }
  }

  /* ================================================================ Lage */

  _eval(sq, now, hard) {
    const alive = this._alive;
    alive.length = 0;
    for (const m of sq.members) if (m.alive) alive.push(m);
    // Führer: Truppführer, sonst Teamführer, sonst irgendwer
    let lead = null;
    for (const m of alive) if (m.role === 'leader' && m.ft === 0) { lead = m; break; }
    if (!lead) for (const m of alive) if (m.role === 'leader') { lead = m; break; }
    if (!lead) lead = alive[0] || null;
    sq.lead = lead;
    if (!lead || !hard) { for (const m of sq.members) if (m.order) m.order.kind = null; return; }
    const G = this.mgr.G;
    // Ziel des Trupps (vom Führer, solange er frei entscheidet)
    if (!lead.order || !lead.order.kind) {
      const g = lead.goal;
      if (g && g.hasMove && (g.kind === 'objective' || g.kind === 'roam' || g.kind === 'hunt' || g.kind === 'chase')) { sq.dest.copy(g.move); sq.hasDest = true; sq.destAt = now; }
    }
    // Feindlage: frischester, nächster bekannter Gegner aller Mitglieder (gesehen bzw. gemeldet < 6 s)
    let best = null, bd = Infinity, n = 0;
    for (const m of alive) {
      const L = m.memory.list;
      for (let i = 0; i < L.length; i++) {
        const r = L[i];
        if (!r.actor.alive || now - r.time > 6 || r.actor.isStreakEntity) continue;
        // nur Sicht/Funk/Treffer zählen als Feindkontakt (Gefechtslärm allein untersucht jeder Bot selbst)
        if (!r.visible && r.source === 'sound' && now - (r.hurtMe || -1e9) > 3) continue;
        const d = r.pos.distanceTo(lead.position);
        if (d > 90) continue;
        n++;
        if (r.seenAt && r.seenAt > sq.seenAt) sq.seenAt = r.seenAt;
        const s = d + (now - r.time) * 6 - (r.visible ? 10 : 0);
        if (s < bd) { bd = s; best = r; }
      }
    }
    if (best) {
      if (sq.state !== 'contact' && sq.state !== 'fallback' && sq.state !== 'room') { sq.aliveAtContact = alive.length; }
      sq.contact.copy(best.pos);
      sq.contactAt = now;
      // grob: verschiedene Gegner nahe der Kontaktstelle (Mehrfachmeldungen zählen einfach)
      let k = 0;
      const seen = this._seen || (this._seen = new Set());
      seen.clear();
      for (const m of alive) for (const r of m.memory.list) if (r.actor.alive && now - r.time < 6 && !seen.has(r.actor) && r.pos.distanceTo(best.pos) < 25) { seen.add(r.actor); k++; }
      sq.enemies = k;
    }
    void n;
    const medicBusy = this._medic(sq, alive, now);
    const contactAge = now - sq.contactAt;

    // Raum räumen läuft
    if (sq.room && this._room(sq, alive, now, medicBusy)) return;
    // Ausweichen läuft
    if (sq.state === 'fallback' && now < sq.fallbackUntil) { this._keepOrders(alive, medicBusy); return; }
    if (contactAge < 5) {
      // Unterzahl → ausweichen (mit Rauch)
      const out = sq.enemies >= Math.max(3, Math.ceil(alive.length * 1.6)) || (alive.length <= 2 && sq.aliveAtContact >= 4);
      if (out && now - sq.fallbackAt > 25) { this._fallback(sq, alive, now, medicBusy); return; }
      // Gegner im Gebäude, Trupp draußen → Raum räumen
      if (!sq.room && now > (sq.roomCd || 0) && this._startRoom(sq, alive, now)) return;
      this._contact(sq, alive, now, medicBusy);
      return;
    }
    if (sq.state === 'contact' || sq.state === 'fallback' || sq.state === 'room') {
      sq.state = 'consolidate';
      sq.since = now;
      sq.plan = null;
    }
    // Sammeln nach Verlusten oder Zerstreuung (ohne Feindkontakt)
    let far = 0;
    for (const m of alive) if (m !== lead && m.position.distanceTo(lead.position) > 32) far++;
    const lost = alive.length < sq.lastAlive;
    if ((sq.state === 'consolidate' && lost) || (far >= Math.max(2, alive.length / 2) && now - sq.regroupAt > 20)) {
      if (now - sq.regroupAt > 12) {
        sq.regroupAt = now;
        sq.state = 'regroup';
        sq.since = now;
        this.emit(sq, 'regroup', { alive: alive.length });
      }
    }
    sq.lastAlive = alive.length;
    if (sq.state === 'regroup') {
      if (now - sq.since > 12 || far === 0) { sq.state = 'move'; sq.since = now; }
      else { this._regroup(sq, alive, now, medicBusy); return; }
    }
    if (sq.state === 'consolidate' && now - sq.since > 4) { sq.state = 'move'; sq.since = now; }
    this._move(sq, alive, now, medicBusy);
  }

  _keepOrders(alive, medicBusy) { void alive; void medicBusy; }

  /* ================================================================ Befehle */

  _order(bot, kind, now, o) {
    const ord = bot.order || (bot.order = newOrder());
    // Weg dorthin zuletzt gescheitert → eine Weile selbst entscheiden lassen
    if (now < (bot._orderBan || 0) && o.pos) { ord.kind = null; return ord; }
    const changed = ord.kind !== kind;
    ord.kind = kind;
    ord.hasPos = !!o.pos;
    if (o.pos) ord.pos.copy(o.pos);
    ord.hasLook = !!o.look;
    if (o.look) ord.look.copy(o.look);
    ord.stance = o.stance || null;
    ord.speed = o.speed || 'run';
    ord.tol = o.tol ?? 1.2;
    ord.until = now + (o.dur ?? 4);
    ord.hold = HOLD_ORDERS.has(kind);
    ord.suppress = !!o.suppress;
    if (o.suppress) ord.supPos.copy(o.suppress);
    ord.target = o.target || null;
    ord.startAt = o.startAt || 0;
    ord.repath = o.repath ?? 2;
    if (changed) { ord.id++; bot._thinkT = Math.min(bot._thinkT, 0.05); }
    return ord;
  }

  _release(bot) { if (bot.order) bot.order.kind = null; }

  _nav() { const W = this.mgr.G.world; return W && W.nav; }

  /** Deckungspunkt nahe p gegen eine Bedrohung (oder nächster Knoten), nicht von claims belegt. */
  _spot(p, threat, radius, claims) {
    const nav = this._nav();
    if (!nav) return p.clone();
    let n = null;
    if (threat && nav.coverNear) {
      n = nav.coverNear(p, threat, radius);
      if (n && claims) for (const c of claims) if (c.distanceToSquared(n.position) < 2.2) { n = null; break; }
    }
    if (!n) n = nav.nearest(p);
    return n ? n.position.clone() : p.clone();
  }

  /** Einen Rauch/Blend/Splitter werfen lassen (Bot mit passender Ausrüstung). → true, wenn geplant. */
  _throw(bot, target, kinds, now) {
    const w = bot.weapon;
    const G = this.mgr.G;
    if (!w || !w.equipment || bot.throwPlan || w.isThrowing || !G.weapons || !G.weapons.grenadeAim) return false;
    let slot = null, type = null;
    for (const k of kinds) {
      for (const s of ['tactical', 'lethal']) {
        const e = w.equipment[s];
        if (e && e.id === k && e.count > 0) { slot = s; type = k; break; }
      }
      if (slot) break;
    }
    if (!slot) return false;
    const aim = G.weapons.grenadeAim(bot, target, type);
    if (!aim || !aim.reachable) return false;
    const eq = G.data && G.data.EQUIPMENT && G.data.EQUIPMENT[type];
    const cook = eq && eq.cookable && bot.diff.grenadeCook ? Math.max(0, (eq.fuse || 2) - aim.flightTime - 0.6) : 0;
    bot.throwPlan = { yaw: aim.yaw, pitch: aim.pitch, cook, started: false, at: now, target: target.clone(), slot, type };
    const g = bot.goal;
    g.kind = 'grenade'; g.since = now; g.hasMove = false; g.look = 'point'; g.hasLook = true; g.lookAt.copy(target);
    return true;
  }

  _centroid(list, out) {
    out.set(0, 0, 0);
    let n = 0;
    for (const m of list) if (m.alive) { out.add(m.position); n++; }
    return n ? out.multiplyScalar(1 / n) : null;
  }

  /* ---------------------------------------------------------------- Marsch */

  _move(sq, alive, now, medicBusy) {
    sq.state = 'move';
    const lead = sq.lead;
    if (!sq.hasDest || now - sq.destAt > 40) { for (const m of alive) if (m !== medicBusy) this._release(m); sq.bound.active = false; return; }
    const dist = lead.position.distanceTo(sq.dest);
    const recent = now - sq.contactAt < 20;
    // Gefahr am Ziel: kürzlicher Kontakt, frische Teamhinweise in der Nähe oder Feindflagge – nur auf den letzten 90 m
    const intel = this.mgr.intelFor(lead, now, 60);
    const danger = dist < 90 && (recent || !!intel || this._enemyFlagNear(sq));
    const both = sq.ft[0].some((m) => m.alive) && sq.ft[1].some((m) => m.alive);
    if (dist < 22 || alive.length < 2) { for (const m of alive) if (m !== medicBusy) this._release(m); sq.bound.active = false; return; }
    if (danger && both && this._cohesive(sq, medicBusy)) { this._bound(sq, alive, now, medicBusy); return; }
    sq.bound.active = false;
    // Reisemarsch: Keil hinter dem Führer (Führer entscheidet selbst)
    this._release(lead);
    const v = lead.body.velocity;
    const sp = Math.hypot(v.x, v.z);
    if (sp < 1) { for (const m of alive) if (m !== lead && m !== medicBusy && m.order && m.order.kind === 'follow') this._release(m); return; }
    const hx = v.x / sp, hz = v.z / sp;
    let k0 = 0, k1 = 0;
    for (const m of alive) {
      if (m === lead || m === medicBusy) continue;
      const side = m.ft === 0 ? -1 : 1;
      const j = m.ft === 0 ? ++k0 : ++k1;
      const back = 2.5 + j * 2.4, lat = side * (1.6 + j * 1.3);
      _v.set(lead.position.x - hx * back - hz * lat, lead.position.y, lead.position.z - hz * back + hx * lat);
      if (m.position.distanceTo(_v) < 2.5 && m.order && m.order.kind === 'follow') { m.order.until = now + 2; continue; }
      const nn = this._nav() && this._nav().nearest(_v);
      if (nn && nn.position.distanceTo(_v) < 4) _v.copy(nn.position); // begehbarer Punkt (nicht in/hinter einer Wand)
      this._order(m, 'follow', now, { pos: _v, speed: m.position.distanceTo(_v) > 8 ? 'sprint' : 'run', tol: 2.2, dur: 2.2, repath: 6 });
    }
  }

  /** Trupp beisammen? Beide Feuerteams nahe ihrem Schwerpunkt (≤ 22 m) und nahe beieinander (≤ 30 m). */
  _cohesive(sq, medicBusy) {
    const c0 = this._centroid(sq.ft[0], _a), c1 = this._centroid(sq.ft[1], _b);
    if (!c0 || !c1 || c0.distanceTo(c1) > 30) return false;
    for (const m of sq.members) {
      if (!m.alive || m === medicBusy) continue;
      if (m.position.distanceTo(m.ft === 0 ? c0 : c1) > 22) return false;
    }
    return true;
  }

  /** Größte Entfernung eines Teammitglieds vom Teamschwerpunkt c. */
  _spread(team, c, medicBusy) {
    let s = 0;
    for (const m of team) if (m.alive && m !== medicBusy) s = Math.max(s, m.position.distanceTo(c));
    return s;
  }

  _enemyFlagNear(sq) {
    const mode = this.mgr.G.mode;
    const obj = mode && mode.objectives;
    if (!obj || !obj.length) return false;
    for (const f of obj) if (f.owner && f.owner !== sq.team && f.position.distanceTo(sq.dest) < 40) return true;
    return false;
  }

  /** Vorgehen im Wechsel: Team `mover` springt ~20 m von Deckung zu Deckung, das andere sichert. */
  _bound(sq, alive, now, medicBusy) {
    const b = sq.bound;
    const mover = sq.ft[b.mover];
    let arrived = 0, moving = 0;
    for (const m of mover) {
      if (!m.alive || m === medicBusy) continue;
      moving++;
      if (m.order && m.order.kind === 'bound' && m.position.distanceTo(m.order.pos) < 2.2) arrived++;
    }
    // angekommen: kurz in Stellung gehen (das andere Team sichert weiter), erst dann wechseln
    if (b.active && moving && arrived >= moving && !b.settled) b.settled = now;
    if (!b.active || now > b.until || (b.settled && now - b.settled > 2.5)) {
      b.settled = 0;
      // Wechsel (zu Beginn bewegt sich das Team mit dem Führer zuerst)
      b.mover = b.active ? 1 - b.mover : (sq.lead.ft === 0 ? 0 : 1);
      b.active = true;
      b.started = now;
      b.until = now + 11;
      const team = sq.ft[b.mover];
      const c = this._centroid(team, _c);
      if (!c) { b.active = false; return; }
      _u.subVectors(sq.dest, c).setY(0);
      const d = _u.length();
      _u.multiplyScalar(1 / Math.max(1e-3, d));
      const step = Math.min(d, rnd(18, 26));
      b.target.copy(c).addScaledVector(_u, step);
      const claims = [];
      let k = 0;
      for (const m of team) {
        if (!m.alive || m === medicBusy) continue;
        const off = (k - 1) * 3.2;
        _v.set(b.target.x - _u.z * off, b.target.y, b.target.z + _u.x * off);
        const spot = this._spot(_v, sq.dest, 6, claims);
        claims.push(spot);
        this._order(m, 'bound', now, { pos: spot, look: sq.dest, speed: 'sprint', tol: 0.9, dur: 12, stance: 'crouch', repath: 1.5 });
        k++;
      }
      const watch = sq.ft[1 - b.mover];
      for (const m of watch) {
        if (!m.alive || m === medicBusy) continue;
        const spot = this._spot(m.position, sq.dest, 4, claims);
        claims.push(spot);
        const lying = m.diff.prone >= 1 && (m.role === 'mg' || m.role === 'marksman');
        this._order(m, 'overwatch', now, { pos: spot, look: _w.copy(sq.dest).setY(sq.dest.y + 1.2), stance: lying ? 'prone' : 'crouch', tol: 1.2, dur: 12 });
      }
      this.emit(sq, 'bound', { ft: b.mover, step: Math.round(step) });
      this.emit(sq, 'overwatch', { ft: 1 - b.mover });
    } else {
      for (const m of alive) if (m.order && m.order.kind) m.order.until = Math.max(m.order.until, now + 1.5);
    }
  }

  /* ---------------------------------------------------------------- Gefecht */

  _contact(sq, alive, now, medicBusy) {
    sq.state = 'contact';
    const contact = sq.contact;
    // Seit 3 s sieht niemand den Feind → Feuerbasis rückt selbst nach (Verfolgen/Absuchen); ein laufendes Flankenmanöver
    // wird zu Ende geführt (es soll den Feind ja gerade aus einer neuen Richtung finden)
    const lost = now - sq.seenAt > 3;
    const run = sq.plan;
    const flanking = !!run && now - run.made < 16 && !(run.heldAt && now - run.heldAt > 6);
    if (lost && !flanking) {
      for (const m of alive) if (m !== medicBusy && m.order && m.order.kind && m.order.kind !== 'fallback') this._release(m);
      if (sq.plan && now - sq.plan.made > 8) sq.plan = null;
      return;
    }
    // Feuerbasis = Team mit MG (sonst das nähere), Manöver = das andere
    let base = -1;
    for (const m of alive) if (m.role === 'mg') { base = m.ft; break; }
    const c0 = this._centroid(sq.ft[0], _a), c1 = this._centroid(sq.ft[1], _b);
    if (!c0 || !c1) {
      // nur ein Feuerteam übrig: alle halten und halten nieder
      for (const m of alive) if (m !== medicBusy) this._suppressOrder(sq, m, now);
      return;
    }
    if (base < 0) base = c0.distanceTo(contact) <= c1.distanceTo(contact) ? 0 : 1;
    let p = sq.plan;
    if (!lost && (!p || (p.contact.distanceTo(contact) > 20 && now - p.made > 8) || now > p.until)) {
      p = sq.plan = this._flankPlan(sq, base, contact, now, medicBusy);
      if (!p) {
        // Manöverteam zu weit weg oder verstreut: erst an der Feuerbasis sammeln (Flanke danach), Basis hält nieder
        const man = sq.ft[1 - base];
        const cb = this._centroid(sq.ft[base], new THREE.Vector3());
        const claims = [];
        for (const m of alive) {
          if (m === medicBusy) continue;
          if (m.ft === base || !cb || m.position.distanceTo(cb) < 16) { this._suppressOrder(sq, m, now); continue; }
          _v.copy(cb).addScaledVector(_u.subVectors(m.position, cb).setY(0).normalize(), 6);
          const spot = this._spot(_v, contact, 6, claims);
          claims.push(spot);
          this._order(m, 'follow', now, { pos: spot, look: _w.copy(contact).setY(contact.y + 1.2), speed: m.position.distanceTo(spot) > 12 ? 'sprint' : 'run', tol: 2.5, dur: 3, repath: 5 });
        }
        void man;
        return;
      }
    }
    if (!p) return;
    for (const m of sq.ft[p.base]) {
      if (!m.alive || m === medicBusy) continue;
      if (lost) this._release(m); else this._suppressOrder(sq, m, now);
    }
    // Manöver: erst weit ausholen (via), dann in die Flanke
    const man = sq.ft[1 - p.base];
    const cm = this._centroid(man, _c);
    if (cm && p.phase === 'via') {
      let at = 0, cnt = 0;
      for (const m of man) if (m.alive && m !== medicBusy) { cnt++; if (m.position.distanceTo(p.via) < 7) at++; }
      if (cm.distanceTo(p.via) < 6 || (cnt && at * 2 >= cnt)) p.phase = 'flank';
    }
    let k = 0;
    for (const m of man) {
      if (!m.alive || m === medicBusy) continue;
      const dst = p.phase === 'via' ? p.via : p.flank;
      const off = (k - 1) * 2.6;
      _v.set(dst.x - p.u.z * off * 0.4 + p.u.x * off * 0.4, dst.y, dst.z + p.u.x * off * 0.4 + p.u.z * off * 0.4);
      const atFlank = p.phase === 'flank' && m.position.distanceTo(p.flank) < 4;
      if (atFlank && !p.heldAt) p.heldAt = now;
      // in der Flanke angekommen: kurz halten (Kreuzfeuer), dann selbstständig nachstoßen
      if (p.heldAt && now - p.heldAt > 6) this._release(m);
      else if (atFlank) this._order(m, 'hold', now, { pos: m.position, look: _w.copy(contact).setY(contact.y + 1.2), stance: 'crouch', tol: 1.5, dur: 4 });
      else this._order(m, 'flank', now, { pos: _v, look: _w.copy(contact).setY(contact.y + 1.2), speed: 'run', tol: 2, dur: 4, repath: 3 });
      k++;
    }
    // Kreuzfeuer: beide Teams sehen Gegner nahe der Kontaktstelle aus deutlich verschiedenen Richtungen
    if (now - sq.crossAt > 20) {
      let sa = null, sb = null;
      for (const m of alive) {
        const r = m.gunner.rec;
        if (!r || !r.visible || r.pos.distanceTo(contact) > 18) continue;
        if (m.ft === p.base) sa = sa || m; else sb = sb || m;
      }
      if (sa && sb) {
        _v.subVectors(contact, sa.position).setY(0).normalize();
        _w.subVectors(contact, sb.position).setY(0).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, _v.dot(_w))));
        if (ang > 0.85) { sq.crossAt = now; this.emit(sq, 'crossfire', { angle: Math.round((ang * 180) / Math.PI) }); }
      }
    }
  }

  _suppressOrder(sq, m, now) {
    const contact = sq.contact;
    const d = m.position.distanceTo(contact);
    const prev = m.order && m.order.kind === 'suppress';
    const pos = prev && m.order.pos.distanceTo(m.position) < 6 ? m.order.pos : this._spot(m.position, contact, 5, null);
    const lying = m.diff.prone >= 1 && d > 40 && (m.role === 'mg' || m.role === 'marksman');
    _w.copy(contact).setY(contact.y + 1.1);
    this._order(m, 'suppress', now, { pos, look: _w, suppress: _w, stance: lying ? 'prone' : prev ? m.order.stance || 'crouch' : 'crouch', tol: 1.3, dur: 3 });
    if (!prev) this.emit(sq, 'suppress', { role: m.role, d: Math.round(d) });
  }

  /** Flankenplan (L-Form): Punkt seitlich der Kontaktstelle, rechtwinklig zur Linie Feuerbasis → Feind. */
  _flankPlan(sq, base, contact, now, medicBusy = null) {
    const nav = this._nav();
    const cb = this._centroid(sq.ft[base], new THREE.Vector3());
    const cm = this._centroid(sq.ft[1 - base], new THREE.Vector3());
    if (!nav || !cb || !cm) return null;
    const u = new THREE.Vector3().subVectors(contact, cb).setY(0);
    const dist = u.length();
    if (dist < 8 || dist > 85) return null;
    // Manöverteam muss beisammen und in Reichweite sein (sonst nur Ereignisse ohne Ausführung)
    if (cm.distanceTo(contact) > 80 || cm.distanceTo(cb) > 40 || this._spread(sq.ft[1 - base], cm, medicBusy) > 20) return null;
    u.multiplyScalar(1 / dist);
    const R = Math.max(14, Math.min(26, dist * 0.6));
    let best = null, bs = Infinity;
    for (const s of [-1, 1]) {
      _v.set(contact.x - u.z * s * R - u.x * R * 0.25, contact.y, contact.z + u.x * s * R - u.z * R * 0.25);
      const n = nav.nearest(_v);
      if (!n || n.position.distanceTo(_v) > 8 || n.position.distanceTo(contact) < 9) continue;
      const score = n.position.distanceTo(cm) + Math.random() * 4;
      if (score < bs) { bs = score; best = { s, flank: n.position.clone() }; }
    }
    if (!best) return null;
    const s = best.s;
    // weit ausholen: seitlich der eigenen Linie, gut ein Drittel des Wegs nach vorn
    _v.set(cm.x - u.z * s * R * 0.85 + u.x * dist * 0.3, cm.y, cm.z + u.x * s * R * 0.85 + u.z * dist * 0.3);
    const nv = nav.nearest(_v);
    const via = nv && nv.position.distanceTo(_v) < 10 ? nv.position.clone() : best.flank.clone();
    if (best.flank.distanceTo(cm) > 75) return null;
    const plan = { contact: contact.clone(), base, u, side: s, flank: best.flank, via, phase: 'via', until: now + 30, smoked: false, made: now, heldAt: 0 };
    this.emit(sq, 'flank', { side: s, R: Math.round(R) });
    // Offenes Gelände bis zum Umweg (vom Feind aus einsehbar) → vorher einnebeln
    const W = this.mgr.G.world;
    if (W && W.lineOfSight) {
      _a.copy(contact).setY(contact.y + 1.5);
      _b.copy(via).setY(via.y + 1.2);
      if (W.lineOfSight(_a, _b)) {
        _v.copy(contact).lerp(via, 0.55);
        for (const m of sq.ft[1 - base]) {
          if (m.alive && m.position.distanceTo(_v) < 32 && this._throw(m, _v, ['smoke'], now)) { plan.smoked = true; this.emit(sq, 'smoke', { reason: 'flank' }); break; }
        }
      }
    }
    return plan;
  }

  /* ---------------------------------------------------------------- Ausweichen / Sammeln */

  _fallback(sq, alive, now, medicBusy) {
    const nav = this._nav();
    const A = analyze(this.mgr.G.world);
    const home = A ? (sq.team === 'B' ? A.sb : A.sa) : null;
    const c = this._centroid(alive, _c);
    if (!nav || !home || !c) return;
    _u.subVectors(home, sq.contact).setY(0).normalize();
    _v.copy(c).addScaledVector(_u, 30);
    const p = this._spot(_v, sq.contact, 10, null);
    sq.state = 'fallback';
    sq.fallbackAt = now;
    sq.fallbackUntil = now + 10;
    let k = 0;
    for (const m of alive) {
      if (m === medicBusy) continue;
      _w.set(p.x + (k % 3 - 1) * 2.5, p.y, p.z + (Math.floor(k / 3) - 0.5) * 2.5);
      this._order(m, 'fallback', now, { pos: _w, look: _a.copy(sq.contact).setY(sq.contact.y + 1.2), speed: 'sprint', tol: 2, dur: 10 });
      k++;
    }
    // Rauch zwischen Feind und Trupp
    _v.copy(sq.contact).lerp(c, 0.65);
    for (const m of alive) if (this._throw(m, _v, ['smoke'], now)) { this.emit(sq, 'smoke', { reason: 'fallback' }); break; }
    this.emit(sq, 'fallback', { enemies: sq.enemies, alive: alive.length });
  }

  _regroup(sq, alive, now, medicBusy) {
    const lead = sq.lead;
    const spot = this._spot(lead.position, sq.contactAt > now - 30 ? sq.contact : null, 4, null);
    this._order(lead, 'hold', now, { pos: spot, look: sq.hasDest ? sq.dest : null, stance: 'crouch', tol: 1.5, dur: 3 });
    let k = 0;
    for (const m of alive) {
      if (m === lead || m === medicBusy) continue;
      const a = (k / Math.max(1, alive.length - 1)) * Math.PI * 2;
      _v.set(spot.x + Math.cos(a) * 2.6, spot.y, spot.z + Math.sin(a) * 2.6);
      this._order(m, 'regroup', now, { pos: _v, speed: 'sprint', tol: 2, dur: 3, repath: 4 });
      k++;
    }
  }

  /* ---------------------------------------------------------------- Sanitäter */

  /** Sanitäter → nächster Verwundeter (Leben < 60, ≤ 45 m); Rauch, wenn der Verwundete unter Feuer liegt. → Sanitäter oder null */
  _medic(sq, alive, now) {
    let medic = null;
    for (const m of alive) if (m.role === 'medic' && m.gadget && m.gadget.id === 'medkit' && m.gadget.charges > 0) { medic = m; break; }
    if (!medic) return null;
    let hurt = null, hd = Infinity;
    for (const m of alive) {
      if (m === medic || m.health >= 60) continue;
      const d = m.position.distanceTo(medic.position);
      if (d < 45 && d < hd) { hd = d; hurt = m; }
    }
    if (!hurt) { if (medic.order && medic.order.kind === 'medic') this._release(medic); return null; }
    const fresh = !medic.order || medic.order.kind !== 'medic' || medic.order.target !== hurt;
    this._order(medic, 'medic', now, { pos: hurt.position, look: null, speed: hd > 6 ? 'sprint' : 'run', tol: 1.8, dur: 3, target: hurt, repath: 2 });
    if (fresh) {
      this.emit(sq, 'medic', { d: Math.round(hd), hp: Math.round(hurt.health) });
      if (now - sq.contactAt < 4 && hurt.position.distanceTo(sq.contact) < 35 && now - sq.medicAt > 12) {
        _v.copy(sq.contact).lerp(hurt.position, 0.75);
        if (this._throw(medic, _v, ['smoke'], now) || this._throwAny(sq, _v, now)) { sq.medicAt = now; this.emit(sq, 'smoke', { reason: 'wounded' }); }
      }
    }
    return medic;
  }

  _throwAny(sq, target, now) {
    for (const m of sq.members) if (m.alive && m.position.distanceTo(target) < 30 && this._throw(m, target, ['smoke'], now)) return true;
    return false;
  }

  /* ---------------------------------------------------------------- Raum räumen */

  _startRoom(sq, alive, now) {
    const W = this.mgr.G.world;
    const nav = this._nav();
    const lead = sq.lead;
    if (!W || !nav || alive.length < 2) return false;
    const contact = sq.contact;
    if (lead.position.distanceTo(contact) > 40) return false;
    if (!indoor(W, contact, this._indoor) || indoor(W, lead.position, this._indoor)) return false;
    // niemand sieht den Gegner (er sitzt drinnen)
    for (const m of alive) if (m.gunner.rec && m.gunner.rec.visible && m.gunner.rec.pos.distanceTo(contact) < 6) return false;
    sq.roomCd = now + 25;
    // Sturmteam: Team mit Blend-/Splittergranaten und den meisten Lebenden
    let ft = 0, bestN = -1;
    for (let f = 0; f < 2; f++) {
      let n = 0;
      for (const m of sq.ft[f]) if (m.alive) n += 1 + (hasNade(m, 'flash') ? 1 : 0);
      if (n > bestN) { bestN = n; ft = f; }
    }
    const team = sq.ft[ft].filter((m) => m.alive);
    if (!team.length) return false;
    const c = this._centroid(team, new THREE.Vector3());
    let path = [];
    try { path = nav.findPath(c, contact, { smooth: false }) || []; } catch { path = []; }
    if (path.length < 2) return false;
    let door = -1;
    for (let i = 0; i < path.length && i < 60; i++) if (indoor(W, path[i], this._indoor)) { door = i; break; }
    if (door < 1) return false;
    const doorP = path[door].clone();
    const prev = path[door - 1].clone();
    const dir = new THREE.Vector3().subVectors(doorP, prev).setY(0);
    if (dir.lengthSq() < 1e-4) return false;
    dir.normalize();
    const stack = doorP.clone().addScaledVector(dir, -2.2);
    const sn = nav.nearest(stack);
    if (sn && sn.position.distanceTo(stack) < 2.5) stack.copy(sn.position);
    sq.room = { ft, team, door: doorP, dir, stack, phase: 'stack', at: now, bangAt: 0, entered: 0 };
    sq.state = 'room';
    const perp = _v.set(-dir.z, 0, dir.x);
    team.forEach((m, k) => {
      _w.copy(stack).addScaledVector(dir, -0.85 * k).addScaledVector(perp, 0.55);
      this._order(m, 'stack', now, { pos: _w, look: doorP, stance: 'crouch', speed: 'run', tol: 0.8, dur: 10, repath: 1 });
    });
    // das andere Team sichert den Eingang
    for (const m of sq.ft[1 - ft]) if (m.alive) this._order(m, 'overwatch', now, { pos: this._spot(m.position, contact, 5, null), look: _a.copy(doorP).setY(doorP.y + 1.2), stance: 'crouch', tol: 1.2, dur: 10 });
    this.emit(sq, 'stack', { members: team.length });
    return true;
  }

  /** Raum räumen fortsetzen. → true, solange es läuft. */
  _room(sq, alive, now, medicBusy) {
    void alive; void medicBusy;
    const r = sq.room;
    const team = r.team.filter((m) => m.alive);
    if (!team.length || now - r.at > 22) { sq.room = null; sq.state = 'contact'; return false; }
    const perp = _u.set(-r.dir.z, 0, r.dir.x);
    if (r.phase === 'stack') {
      let at = 0;
      for (const m of team) if (m.order && m.order.kind === 'stack' && m.position.distanceTo(m.order.pos) < 1.4) at++;
      if (at >= Math.min(2, team.length) || now - r.at > 9) {
        // Granate hinein: Blend bevorzugt, sonst Splitter
        _v.copy(r.door).addScaledVector(r.dir, 3.2);
        let thrown = null;
        for (const m of team) {
          if (this._throw(m, _v, ['flash'], now)) { thrown = 'flash'; break; }
        }
        if (!thrown) for (const m of team) if (this._throw(m, _v, ['frag', 'semtex'], now)) { thrown = 'frag'; break; }
        r.phase = 'bang';
        r.bangAt = now;
        if (thrown) this.emit(sq, 'clear_grenade', { grenade: thrown });
      } else {
        for (const m of team) if (m.order) m.order.until = now + 2;
      }
      return true;
    }
    if (r.phase === 'bang') {
      for (const m of team) if (m.order) m.order.until = now + 2;
      if (now - r.bangAt > 1.6) {
        r.phase = 'enter';
        team.forEach((m, k) => {
          // gestaffelt eintreten, Ecken über Kreuz (erster links, zweiter rechts …), Blick in den Gegensektor
          const side = k % 2 ? 1 : -1;
          _v.copy(r.door).addScaledVector(r.dir, 1.8 + k * 0.55).addScaledVector(perp, side * (k ? 1.4 : 0.5));
          _w.copy(r.door).addScaledVector(r.dir, 5).addScaledVector(perp, -side * 3.5).setY(r.door.y + 1.2);
          this._order(m, 'enter', now, { pos: _v, look: _w, speed: 'run', tol: 0.8, dur: 8, startAt: now + k * 0.6, repath: 1 });
          this.emit(sq, 'enter', { k });
        });
      }
      return true;
    }
    if (r.phase === 'enter' && now - r.bangAt > 9) { sq.room = null; sq.state = 'contact'; return false; }
    return true;
  }
}

function hasNade(m, id) {
  const w = m.weapon;
  if (!w || !w.equipment) return false;
  return (w.equipment.tactical && w.equipment.tactical.id === id && w.equipment.tactical.count > 0) || (w.equipment.lethal && w.equipment.lethal.id === id && w.equipment.lethal.count > 0);
}
