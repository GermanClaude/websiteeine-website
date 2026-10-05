// NULLPUNKT — BotManager (§8): erzeugt/entfernt Bots, taktet Wahrnehmung/Entscheidungen gestaffelt,
// verteilt Budgets (Sichtlinien-Strahlen und Pfadsuchen pro Bild), leitet Geräusche weiter (Schüsse,
// Schritte, Explosionen, Einschläge in der Nähe), führt Team-Funkmeldungen, verteilt Ziele/Deckung,
// steuert Namensschilder, Detailstufen, Animationsrate, Sichtbarkeit (Frustum) und Schattenwurf.
//
// API: new BotManager(G); attach(G); detach(); spawnBots({ allies, enemies, ffa, difficulty, modeId }) → Bot[];
//      removeAll(); update(dt); bots; handlesStreaks (= true: Bots setzen Serienprämien selbst ein)
import * as THREE from 'three';
import { Bot } from './bot.js';
import { difficultyProfile } from './difficulty.js';
import { pickNames } from './names.js';
import { Nameplate } from './nameplates.js';
import { VARIANTS, schemeForTeam, ffaSchemes } from './character.js';
import { upgradeSoldierMaterials } from './soldier/materials.js';
import { analyze } from './ai/tactics.js';

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _cam = new THREE.Vector3();

const LOS_BASE = 48, LOS_BASE_LOW = 26; // Sichtstrahlen pro Bild (Grundbudget)
const LOS_PER_SENSE = 10; // geschätzte Strahlen je Wahrnehmungsschritt eines Bots (≈ 6 Gegner im Blick, teils Kopfstrahl)

const SNIPER_LOADOUT = { id: 'praezision', primary: 'sr_brecher', secondary: 'pi_p9', lethal: 'frag' };

/** Reihenfolge der Namensschilder: höheres Ziel zuerst, dann näher. */
function plateOrder(a, b) { return (b._target - a._target) || (a._d - b._d); }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export class BotManager {
  constructor(G) {
    this.G = G;
    this.bots = [];
    this.handlesStreaks = true;
    this.scene = G.scene;
    this.models = null;
    this.quality = 'high'; // Material-/Budgetstufe der Soldaten: 'low' | 'high'
    this.tier = 'high'; // Qualitätsstufe des Renderers (Detailstufen-Schwellen): low | medium | high | ultra
    this._subs = null;
    this._plates = new Map();
    this._paths = new Map();
    this._intel = new Map();
    this._targetCount = new Map();
    this._hostileCache = new Map(); // Team bzw. Bot (FFA) → wiederverwendete Liste
    this._hostileFrame = new Map(); // … und Bildnummer, für die sie gilt
    this._pathQ = []; // Reihenfolge der Pfadanfragen (Ziele in _paths)
    this._placed = [];
    this._frame = 0;
    this._losLeft = 0;
    this._frustum = new THREE.Frustum();
    this._shadowT = 0;
    this._plateLos = new Map();
    this.activity = []; // jüngste Gefechtslärm-Positionen { pos, time, actor } (hörbar über die ganze Karte)
    this.debug = { los: 0, paths: 0, ms: 0, losUsed: 0, pathsUsed: 0 };
  }

  attach(G) {
    this.G = G;
    if (this._subs) this._subs.dispose();
    this.scene = G.scene;
    this.models = (G.modules && G.modules.models && G.modules.models.createWeaponModel) ? G.modules.models : null;
    const R = G.renderer;
    this.tier = R && typeof R.quality === 'string' && R.quality !== 'auto' ? R.quality : 'high';
    this.quality = this.tier === 'low' ? 'low' : 'high';
    // Fotoscan-Stoff der Soldaten im Hintergrund nachladen (einmalig; ohne Transcoder bleibt der prozedurale Stoff)
    if (R && R.renderer) upgradeSoldierMaterials(R.renderer, this.tier);
    this._intel.clear();
    this._paths.clear();
    this._pathQ.length = 0;
    this._hostileCache.clear();
    this._hostileFrame.clear();
    this.activity.length = 0;
    const s = (this._subs = G.events.scope());
    s.on('weapon:fire', (e) => this._onFire(e));
    s.on('footstep', (e) => this._onFootstep(e));
    s.on('explosion', (e) => this._onExplosion(e));
    s.on('impact', (e) => this._onImpact(e));
    s.on('actor:hit', (e) => this._onHit(e));
    s.on('kill', (e) => this._onKill(e));
  }

  detach() {
    this.removeAll();
    if (this._subs) this._subs.dispose();
    this._subs = null;
    this._intel.clear();
    this._paths.clear();
    this._pathQ.length = 0;
    this._hostileCache.clear();
    this._hostileFrame.clear();
  }

  /* ================================================================ Erzeugen */

  spawnBots({ allies = 0, enemies = 0, ffa = false, difficulty = 'regulaer', modeId = 'tdm' } = {}) {
    const G = this.G;
    if (!this._subs) this.attach(G);
    const diff = difficultyProfile(difficulty, G.data && G.data.DIFFICULTIES);
    const used = new Set(G.actors.map((a) => a.name));
    if (G.player && G.player.name) used.add(G.player.name);
    const total = ffa ? allies + enemies : allies + enemies;
    const names = pickNames(total, used);
    const created = [];
    const loadoutPool = (n) => {
      const W = (G.data && G.data.WEAPONS) || {};
      const all = ((G.data && G.data.DEFAULT_LOADOUTS) || [{ primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag' }]);
      const cls = (l) => (W[l.primary] ? W[l.primary].cls : 'ar');
      // Grundmix ohne Scharfschützen; Schrot höchstens jeder vierte
      const base = all.filter((l) => cls(l) !== 'sniper');
      const list = [];
      let shotguns = 0;
      while (list.length < n) {
        for (const l of shuffle(base.slice())) {
          if (list.length >= n) break;
          if (cls(l) === 'shotgun') { if (shotguns >= Math.max(1, Math.floor(n / 4))) continue; shotguns++; }
          list.push(l);
        }
        if (!base.length) list.push({ primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag' });
      }
      // genau ein Scharfschütze je Gruppe ab 4 Bots
      const sniper = all.find((l) => cls(l) === 'sniper') || (W.sr_brecher ? SNIPER_LOADOUT : null);
      if (n >= 4 && sniper) list[(Math.random() * n) | 0] = sniper;
      return shuffle(list);
    };
    const make = (team, i, lo, variant, scheme, lane) => {
      const bot = new Bot(this, {
        team, name: names.shift() || `Bot ${this.bots.length + 1}`, diff,
        loadout: { primary: lo.primary, secondary: lo.secondary, lethal: lo.lethal }, variant, scheme, modeId, lane,
      });
      this.bots.push(bot);
      if (!G.actors.includes(bot)) G.actors.push(bot);
      this._plate(bot);
      created.push(bot);
      return bot;
    };
    if (ffa) {
      const n = allies + enemies;
      const los = loadoutPool(n);
      const vars = shuffle(VARIANTS.map((_, i) => i));
      const schemes = ffaSchemes(G.world); // je Karte gut sichtbare Tarnschemata
      const off = (Math.random() * schemes.length) | 0;
      for (let i = 0; i < n; i++) make(null, i, los[i], vars[i % vars.length], schemes[(i + off) % schemes.length], (Math.random() * 3) | 0);
    } else {
      for (const [team, n] of [['A', allies], ['B', enemies]]) {
        if (n <= 0) continue;
        const los = loadoutPool(n);
        const vars = shuffle(VARIANTS.map((_, i) => i));
        const lanes = shuffle([0, 1, 2]);
        const scheme = schemeForTeam(team, G.world); // Gegner auf hellen Karten dunkler (Kontrast)
        for (let i = 0; i < n; i++) make(team, i, los[i], vars[i % vars.length], scheme, lanes[i % 3]);
      }
    }
    // Analyse der Karte vorab (Spuren/Machtpositionen)
    if (G.world) analyze(G.world);
    return created;
  }

  removeAll() {
    const G = this.G;
    for (const b of this.bots) {
      b.dispose();
      const i = G.actors.indexOf(b);
      if (i >= 0) G.actors.splice(i, 1);
    }
    // Schilder zurück in den Vorrat (Material/Textur bleiben → kein Neulinken in der Revanche)
    for (const p of this._plates.values()) p.release();
    this._plates.clear();
    this._plateLos.clear();
    this.bots = [];
    this._paths.clear();
    this._pathQ.length = 0;
    this._hostileCache.clear();
    this._hostileFrame.clear();
    this._targetCount.clear();
  }

  /** Drittpersonen-Waffenmodell (Klon) für eine Waffe. */
  makeGun(def) {
    const M = this.models || (this.G.modules && this.G.modules.models);
    if (!M || !M.createWeaponModel) return null;
    try { return M.createWeaponModel(def.model || 'm17', { lod: 'third' }); } catch (err) {
      if (!this._gunErr) { this._gunErr = true; console.warn('[NULLPUNKT] Bot-Waffenmodell:', err); }
      return null;
    }
  }

  /* ================================================================ Bild */

  update(dt) {
    const G = this.G;
    const t0 = performance.now();
    this._frame++;
    const low = this.quality === 'low';
    // Sichtstrahlen-Budget: Grundmenge je Qualität, mit dem Bedarf (Bots × Wahrnehmungsrate × dt)
    // wachsend – bei niedriger Bildrate fallen pro Bild mehr Wahrnehmungsschritte an
    const base = low ? LOS_BASE_LOW : LOS_BASE;
    let demand = 0;
    for (let i = 0; i < this.bots.length; i++) { const b = this.bots[i]; if (b.alive) demand += b.diff.senseHz; }
    this._losLeft = Math.min(base * 3, Math.max(base, Math.ceil(demand * dt * LOS_PER_SENSE)));
    const losStart = this._losLeft;
    const bots = this.bots;
    // Wer zielt worauf (für Zielverteilung) – Stand des letzten Bildes
    this._targetCount.clear();
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const r = b.alive && b.gunner.rec;
      if (r && r.visible) this._targetCount.set(r.actor, (this._targetCount.get(r.actor) || 0) + 1);
    }
    // Pfadsuchen (Budget, in Anfragereihenfolge)
    let pathsLeft = low ? 2 : 3;
    const nav = G.world && G.world.nav;
    const q = this._pathQ;
    while (pathsLeft > 0 && q.length) {
      const bot = q.shift();
      const dest = this._paths.get(bot);
      this._paths.delete(bot);
      if (!dest || !bot.alive) continue;
      let path = [];
      try { path = nav ? nav.findPath(bot.position, dest) : [dest.clone()]; } catch { path = []; }
      bot.nav.onPath(path);
      pathsLeft--;
    }
    // Kamera: Sichtbarkeit + Abstand
    const cam = G.camera;
    if (cam) {
      _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(_m);
      cam.getWorldPosition(_cam);
    }
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const s = b.soldier;
      const d = b.position.distanceTo(_cam);
      b.camDist = d;
      _sphere.center.set(b.position.x, b.position.y + 0.9, b.position.z);
      _sphere.radius = 1.5;
      const inView = !cam || this._frustum.intersectsSphere(_sphere);
      b.inView = inView;
      b.animEvery = !inView ? 6 : d < (low ? 16 : 26) ? 1 : d < (low ? 40 : 60) ? 2 : 3;
      if (s && b.alive && s.state === 'alive') {
        s.root.visible = inView;
        s.updateLod(d * (cam ? cam.fov / 60 : 1), this.tier);
      }
      for (let k = 0; k < b.soldiers.length; k++) {
        const o = b.soldiers[k];
        if (o && o.state === 'dead') {
          _sphere.center.copy(o.root.position); _sphere.center.y += 0.5; _sphere.radius = 3;
          o.root.visible = !cam || this._frustum.intersectsSphere(_sphere);
          o.updateLod(o.root.position.distanceTo(_cam) * (cam ? cam.fov / 60 : 1), this.tier);
        }
      }
    }
    // Bots
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      b.update(dt);
      if (b.alive) b.updateCorpsesOnly(dt);
    }
    // Schatten (nächste N sichtbare)
    this._shadowT -= dt;
    if (this._shadowT <= 0) { this._shadowT = 0.5; this._assignShadows(); }
    this._updatePlates(dt);
    this.debug.losUsed = losStart - this._losLeft;
    this.debug.ms = performance.now() - t0;
  }

  _assignShadows() {
    const preset = this.G.renderer && this.G.renderer.preset;
    const max = preset && preset.shadows ? (preset.maxBotsVisibleShadows ?? 6) : 0;
    const vis = this.bots.filter((b) => b.alive && b.inView).sort((a, b) => a.camDist - b.camDist);
    const on = new Set(vis.slice(0, max));
    for (const b of this.bots) for (const s of b.soldiers) if (s) s.setShadows(on.has(b) && s === b.soldier && b.camDist < 45);
  }

  /* ================================================================ Dienste für Bots */

  /** Sichtlinien-Budget (true = Strahl erlaubt). */
  takeLos() {
    if (this._losLeft <= 0) return false;
    this._losLeft--;
    this.debug.los++;
    return true;
  }

  /** Feindliche Akteure + Serienprämien-Einheiten (pro Bild gecacht je Team). */
  hostilesOf(bot) {
    const key = bot.team || bot;
    let list = this._hostileCache.get(key);
    if (list && this._hostileFrame.get(key) === this._frame) return list;
    if (!list) { list = []; this._hostileCache.set(key, list); }
    this._hostileFrame.set(key, this._frame);
    list.length = 0;
    const G = this.G;
    const actors = G.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a !== bot && a.alive && G.combat.isHostile(bot, a)) list.push(a);
    }
    const st = G.mode && G.mode.streaks;
    const ents = st && st.entities;
    if (ents) for (let i = 0; i < ents.length; i++) { const e = ents[i]; if (e.alive && e.owner !== bot && G.combat.isHostile(bot, e)) list.push(e); }
    return list;
  }

  requestPath(bot, dest) {
    let d = this._paths.get(bot);
    if (!d) { d = new THREE.Vector3(); this._paths.set(bot, d); }
    d.copy(dest);
    // ans Ende der Warteschlange
    const q = this._pathQ;
    const i = q.indexOf(bot);
    if (i >= 0) q.splice(i, 1);
    q.push(bot);
    this.debug.paths++;
  }

  /** Anzahl anderer Bots (gleiche Seite), die gerade auf actor zielen. */
  targetCount(actor, bot) {
    let n = this._targetCount.get(actor) || 0;
    if (bot.gunner.rec && bot.gunner.rec.actor === actor && bot.gunner.rec.visible) n--;
    return Math.max(0, n);
  }

  /** Funkmeldung: Gegner gesichtet (für Kameraden mit kurzer Verzögerung nutzbar). */
  callout(bot, enemy, pos, now) {
    if (!bot.team) return;
    let m = this._intel.get(bot.team);
    if (!m) { m = new Map(); this._intel.set(bot.team, m); }
    let e = m.get(enemy);
    if (!e) { e = { actor: enemy, pos: new THREE.Vector3(), time: 0 }; m.set(enemy, e); }
    e.pos.copy(pos);
    e.time = now + 0.8; // Funkverzögerung
  }

  /** Jüngster Teamhinweis in Reichweite (nicht bereits selbst bekannt). */
  intelFor(bot, now, maxDist = 50) {
    if (!bot.team) return null;
    const m = this._intel.get(bot.team);
    if (!m) return null;
    let best = null, bs = Infinity;
    for (const e of m.values()) {
      if (!e.actor.alive || now < e.time || now - e.time > 9) continue;
      const d = e.pos.distanceTo(bot.position);
      if (d > maxDist) continue;
      const s = d + (now - e.time) * 3;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  coverClaims(bot) {
    const out = [];
    for (const b of this.bots) if (b !== bot && b.alive && b.coverNode && b.team === bot.team) out.push(b.coverNode.position);
    return out;
  }

  roamClaims(bot) {
    const out = [];
    for (const b of this.bots) if (b !== bot && b.alive && b.team === bot.team && b.goal.hasMove && (b.goal.kind === 'roam' || b.goal.kind === 'hunt')) out.push(b.goal.move);
    return out;
  }

  /** Steht ein Verbündeter in der Schusslinie Auge → Ziel? */
  lineOfFireClear(bot, target) {
    if (!bot.team) return true;
    const eye = bot.getEyePosition(_v);
    const dir = _w.subVectors(target, eye);
    const len = dir.length();
    if (len < 0.5) return true;
    dir.multiplyScalar(1 / len);
    const actors = this.G.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a === bot || !a.alive || a.team !== bot.team) continue;
      const p = a.position;
      const h = a.body ? a.body.height : 1.8;
      // nächster Punkt auf dem Strahl zur Körperachse (vereinfacht: Mittelpunkt)
      const cx = p.x - eye.x, cy = p.y + h * 0.55 - eye.y, cz = p.z - eye.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t < 0.3 || t > len) continue;
      const qx = cx - dir.x * t, qy = cy - dir.y * t, qz = cz - dir.z * t;
      if (qx * qx + qz * qz < 0.36 && Math.abs(qy) < h * 0.6) return false;
    }
    return true;
  }

  /** Unsichtbar umsetzen erlaubt? (nicht im Blick des Spielers) */
  canTeleport(bot) {
    return !bot.inView && bot.camDist > 18;
  }

  footstep(bot) {
    const G = this.G;
    const sprint = bot.sprinting, crouch = bot.crouching;
    const surface = bot.camDist < 32 && G.world && G.world.surfaceAt ? G.world.surfaceAt(bot.position) : 'concrete';
    G.events.emit('footstep', { actor: bot, surface, sprint, crouch, position: bot.position.clone() });
  }

  onBotDeath(bot) {
    const p = this._plates.get(bot);
    if (p) p.alpha = Math.min(p.alpha, 0.3);
  }

  /* ================================================================ Hören */

  _hear(actor, range, err, now, source = 'sound', alert = true) {
    const G = this.G;
    const bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b.alive || b === actor || !G.combat.isHostile(b, actor)) continue;
      const d = b.position.distanceTo(actor.position);
      const r = range * b.diff.hearing;
      if (d > r) continue;
      const rec = b.memory.get(actor);
      if (rec && rec.visible) continue;
      b.memory.hear(actor, actor.position, now, err + d * 0.05, source);
      if (alert && (!b.gunner.rec || !b.gunner.rec.visible)) b.alert(actor.position, now);
    }
  }

  _onFire({ actor, suppressed } = {}) {
    if (!actor || !actor.position || actor.isStreakEntity) return;
    const now = this.G.time.elapsed;
    this._hear(actor, suppressed ? 14 : 75, 1.5, now);
    if (!suppressed && now - (actor._actT || -1e9) > 0.8) {
      actor._actT = now;
      const a = this.activity;
      let e = a.length >= 24 ? a.shift() : { pos: new THREE.Vector3(), time: 0, actor: null };
      e.pos.copy(actor.position); e.time = now; e.actor = actor;
      a.push(e);
    }
  }

  /** Jüngster Gefechtslärm in Reichweite (nicht vom Bot selbst/seinem Team). */
  activityFor(bot, now, maxAge = 18, maxDist = 90) {
    let best = null, bs = Infinity;
    for (const e of this.activity) {
      if (now - e.time > maxAge || e.actor === bot || (bot.team && e.actor && e.actor.team === bot.team)) continue;
      const d = e.pos.distanceTo(bot.position);
      if (d > maxDist || d < 8) continue;
      const s = d * 0.5 + (now - e.time) * 2 + Math.random() * 10;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  _onFootstep({ actor, sprint, crouch } = {}) {
    if (!actor || !actor.position) return;
    this._hear(actor, sprint ? 20 : crouch ? 3 : 10, 1, this.G.time.elapsed, 'sound', false);
  }

  _onExplosion({ position, attacker } = {}) {
    const now = this.G.time.elapsed;
    if (attacker && attacker.position && attacker.alive) this._hear(attacker, 45, 5, now);
    for (const b of this.bots) {
      if (!b.alive || !position) continue;
      if (b.position.distanceTo(position) < 9 && b.soldier) b.soldier.playHit(_v.subVectors(b.position, position).setY(0.2).normalize(), 'body', 25);
    }
  }

  _onImpact({ point, shooter } = {}) {
    if (!point || !shooter || !shooter.position || shooter.isStreakEntity) return;
    const now = this.G.time.elapsed;
    const bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b.alive || b === shooter || !this.G.combat.isHostile(b, shooter)) continue;
      if (b.position.distanceToSquared(point) > 6.25) continue;
      b.memory.hear(shooter, shooter.position, now, 3, 'sound');
      if (!b.gunner.rec || !b.gunner.rec.visible) b.alert(shooter.position, now);
    }
  }

  _onHit({ target, attacker } = {}) {
    if (!target || !attacker || !attacker.position || !target.team || attacker === target) return;
    const now = this.G.time.elapsed;
    const bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b.alive || b === target || b.team !== target.team || b.position.distanceTo(target.position) > 30) continue;
      if (!this.G.combat.isHostile(b, attacker)) continue;
      b.memory.hear(attacker, attacker.position, now, 5, 'team');
    }
  }

  _onKill({ victim, killer } = {}) {
    if (!victim) return;
    const now = this.G.time.elapsed;
    for (const b of this.bots) {
      b.memory.remove(victim);
      if (b.gunner.rec && b.gunner.rec.actor === victim) b.gunner.clear();
      if (!b.alive || !killer || !killer.position || killer === b || !victim.team || b.team !== victim.team) continue;
      if (b.position.distanceTo(victim.position) < 28 && this.G.combat.isHostile(b, killer)) b.memory.hear(killer, killer.position, now, 4, 'team');
    }
    for (const m of this._intel.values()) m.delete(victim);
  }

  /* ================================================================ Namensschilder */

  _plate(bot) {
    const p = Nameplate.acquire(bot.name, this._plateKind(bot));
    this.scene.add(p.sprite);
    this._plates.set(bot, p);
  }

  _plateKind(bot) {
    const pl = this.G.player;
    if (pl && pl.team && bot.team && pl.team === bot.team) return 'ally';
    return bot.team ? 'enemy' : 'ffa';
  }

  _updatePlates(dt) {
    const G = this.G;
    const cam = G.camera;
    if (!cam) return;
    // Zeichenflächengröße aus dem Renderer (gecacht, CSS-Pixel) – kein Layout-Lesen pro Bild
    const R = G.renderer;
    const viewH = R && R.height > 1 ? R.height : 720;
    const viewW = R && R.width > 1 ? R.width : 1280;
    const aimT = G.input && G.input.aimTarget;
    const lens = R && R.lens && typeof R.lens.toScreen === 'function' ? R.lens : null;
    const now = G.time.real || G.time.elapsed;
    const playerAlive = G.player && G.player.alive;
    cam.getWorldPosition(_cam); // Sichtstrahlen von der Kamera aus (das Schild wird aus ihrer Sicht gezeichnet)
    const list = this._plateList || (this._plateList = []);
    list.length = 0;
    const bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      const p = this._plates.get(bot);
      if (!p) continue;
      if (p.sprite.parent !== this.scene) this.scene.add(p.sprite);
      p.setKind(this._plateKind(bot));
      let target = 0;
      let fade = 6;
      const d = bot.camDist;
      const s = bot.soldier;
      const pos = p._pos || (p._pos = new THREE.Vector3());
      if (s && bot.alive) s.getHeadPosition(pos); else pos.copy(bot.position).setY(bot.position.y + 1.7);
      if (!bot.alive) fade = 16;
      else if (bot.inView) {
        if (p.kind === 'ally') target = d < 40 ? 1 : d < 60 ? (60 - d) / 20 : 0;
        else {
          // Gegner: unter dem Fadenkreuz oder sehr nah – und nur bei freier Sicht auf den Kopf. Schilder ohne
          // Tiefentest: ein (gedrosselter) Strahl je Schild entscheidet, solange es gewünscht oder noch sichtbar ist.
          const aimed = aimT === bot;
          const want = aimed || (d < 7 && playerAlive);
          if (want || p.alpha > 0.02) {
            if (this._plateSight(bot, pos, now, aimed ? 0.08 : 0.15)) target = want ? 1 : 0;
            else fade = 16;
          }
        }
      }
      pos.y += 0.36;
      p._target = target;
      p._fade = fade;
      p._d = d;
      p._size = 1;
      if (target > 0 || p.alpha > 0.02) {
        // Bildschirmposition für die Entflechtung – durch die Objektiv-Abbildung (Bodycam-Fischauge, R2): die Schilder
        // sind 3D-Sprites und werden mitverzerrt, ihre tatsächliche Lage ist lens.toScreen(camera.project(…)).
        _v.copy(pos).project(cam);
        if (lens && lens.active) {
          // örtlichen Maßstab ausgleichen (am Rand < 1), damit Schilder überall gleich groß und lesbar bleiben
          p._size = 1 / Math.max(0.5, lens.scaleAt(_v.x, _v.y));
          lens.toScreen(_v);
        }
        p._sx = _v.x * viewW * 0.5;
        p._sy = _v.y * viewH * 0.5;
        if (target > 0) list.push(p);
      }
    }
    // Überlappende Schilder: das nähere gewinnt (Ziel unter dem Fadenkreuz immer)
    // Einfügesortierung an Ort und Stelle (wenige Schilder, keine Allokation)
    for (let i = 1; i < list.length; i++) {
      const p = list[i];
      let k = i - 1;
      while (k >= 0 && plateOrder(list[k], p) > 0) { list[k + 1] = list[k]; k--; }
      list[k + 1] = p;
    }
    const placed = this._placed;
    placed.length = 0;
    const aimPlate = aimT ? this._plates.get(aimT) : null;
    const wPx = viewH < 500 ? 70 : 84, hPx = viewH < 500 ? 22 : 26;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      let hide = false;
      for (let k = 0; k < placed.length; k++) { const q = placed[k]; if (Math.abs(q._sx - p._sx) < wPx && Math.abs(q._sy - p._sy) < hPx) { hide = true; break; } }
      if (hide && p._target < 1.01 && aimPlate !== p) p._target = 0;
      else placed.push(p);
    }
    for (let i = 0; i < bots.length; i++) {
      const p = this._plates.get(bots[i]);
      if (p) p.update(p._pos, cam, viewH, p._target || 0, dt, p._fade || 6, p._size || 1);
    }
  }

  /** Freie Sicht Kamera → Kopf (`head`), je Bot höchstens alle `every` s neu geprüft (ein Strahl). */
  _plateSight(bot, head, now, every) {
    let c = this._plateLos.get(bot);
    if (!c) { c = { t: -1e9, v: false }; this._plateLos.set(bot, c); }
    if (now - c.t >= every || now < c.t) {
      c.t = now;
      const W = this.G.world;
      c.v = !W || !W.lineOfSight || W.lineOfSight(_cam, head);
    }
    return c.v;
  }

  /* ================================================================ Diagnose */

  stats() {
    const states = {};
    let broken = 0;
    for (const b of this.bots) {
      if (!b.alive) continue;
      states[b.goal.kind] = (states[b.goal.kind] || 0) + 1;
      if (!this._soldierSane(b)) broken++;
    }
    return { bots: this.bots.length, alive: this.bots.filter((b) => b.alive).length, states, ms: +this.debug.ms.toFixed(2), losPerFrame: this.debug.losUsed, pathQueue: this._paths.size, broken };
  }

  /** Diagnose: Pose/Trefferzonen eines lebenden Bots endlich und am Körper (≤ 3 m von den Füßen)? */
  _soldierSane(bot) {
    const s = bot.soldier;
    if (!s || s.state !== 'alive') return true;
    const p = bot.position;
    for (const hb of s.hitboxes) {
      for (const v of hb.b ? [hb.a, hb.b] : [hb.a]) {
        if (!Number.isFinite(v.x + v.y + v.z)) return false;
        if (Math.abs(v.x - p.x) + Math.abs(v.y - p.y) + Math.abs(v.z - p.z) > 3) return false;
      }
    }
    return Number.isFinite(s.getMuzzlePosition(_v).x) && _v.distanceTo(p) < 3;
  }
}
