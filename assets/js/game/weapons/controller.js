// NULLPUNKT — WeaponController (§7): eine Instanz pro Akteur (Spieler und Bots, gleiche Regeln).
//
// Magazin/Reserve, taktisches vs. leeres Nachladen (Zeiten aus den Daten, Abbruch durch Sprint/Wechsel,
// Schrot Patrone für Patrone – durch Schießen unterbrechbar), Sprint-zu-Feuer, Ziehen/Wechseln, ADS mit
// adsTime, Streuung (Hüfte/ADS, Laufen/Springen/Ducken/Rutschen, Aufblühen pro Schuss mit Erholung),
// Rückstoß (Muster + Zufall + Erstschuss-Faktor) über actor.addRecoil, Hitscan pro Kugel über
// G.combat.fireHitscan (Durchschlag/Schadensabfall in combat.js), Leuchtspuren, Feuermodi
// auto/semi/burst/bolt/pump, Messer (Ausfallschritt, Rückenstich, Einschlag an Wänden), Granaten
// (Splint, Vorkochen mit HUD-Timer, Explosion in der Hand), Zielfernrohr-Schwanken + Atem anhalten.
// Für den Spieler treibt er den Gunsmith-ViewModel (Waffe, Animationen, Anschlag, Overlay).

import * as THREE from 'three';
import { WEAPONS as DATA_WEAPONS, EQUIPMENT as DATA_EQUIPMENT, effectiveRange, weaponHandling } from '../../shared/weapons.data.js';
import { clamp, damp, smooth01, easeInOut, wrapAngle, samplePellet, sampleCone, patternAt } from './ballistics/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muz = new THREE.Vector3();
const _to = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _org = new THREE.Vector3();

const MOVE_REF = 5.4; // Gehtempo (m/s) – Bezug für Laufstreuung
const SWITCH_LOWER = 0.2; // Wegstecken (passend zum ViewModel)
const GRENADE = { pin: 0.3, hold: 0.47, release: 0.66, end: 0.96 }; // Zeitpunkte (s), passend zur Wurfanimation
const SHOT_STRENGTH = { sniper: 2.2, shotgun: 2.0, marksman: 1.5, lmg: 1.15, pistol: 1.05 };
// Auto-Feuer (Touch, „einfacher Modus“): sinnvolle Reichweite je Klasse
const AUTO_RANGE = { shotgun: 13, smg: 30, pistol: 28, ar: 48, lmg: 52, marksman: 70, sniper: 120, melee: 2.6 };
const BREATH_HOLD = 4.5; // s Atem anhalten
const BREATH_RECOVER = 2.8; // s bis voll erholt
const EXHAUST = 1.6; // s außer Atem
// Wandkollision (F3): ab diesem Anteil (0..1, wie weit die Waffe angezogen ist) kein Anschlag bzw. kein Schuss –
// mit Hysterese, damit es an der Grenze nicht flackert
const OBSTRUCT_ADS = [0.45, 0.3];
const OBSTRUCT_FIRE = [0.72, 0.55];
// Rückstoß 2.0: kurzer Kamera-Ruck schwerer Waffen (Trauma für player.shake, nur Optik, Komfort über core)
const SHOT_SHAKE = { sniper: 0.22, shotgun: 0.2, marksman: 0.1, lmg: 0.025 };

const FALLBACK = {
  id: 'ar_m17', name: 'M-17 Falke', cls: 'ar', slot: 'primary', model: 'm17', damage: { max: 25, min: 19, rangeStart: 22, rangeEnd: 45 },
  headMult: 1.35, limbMult: 0.9, pellets: 1, rpm: 700, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 120, reloadTime: 2.1,
  reloadEmptyTime: 2.7, equipTime: 0.55, adsTime: 0.22, adsZoom: 1.35, sprintToFire: 0.18, moveSpeedMult: 0.95, adsMoveMult: 0.62,
  hipSpread: 0.045, adsSpread: 0.0022, moveSpreadMult: 1.45, jumpSpreadMult: 2.5, recoil: { vertical: 0.0078, horizontal: 0.0028, recovery: 10, firstShotMult: 1.1 },
  range: 110, penetration: 0.55, sound: { profile: 'ar', pitch: 1 },
};
const KNIFE_FALLBACK = { range: 2.4, lungeRange: 4.5, lungeSpeed: 10, arc: 0.6, swingTime: 0.75, hitDelay: 0.14 };

/** Lehnen des Akteurs (core: player.lean −1…1, − = links), sonst 0. */
function actorLean(actor) {
  const l = actor && actor.lean;
  return Number.isFinite(l) ? l : 0;
}
/** Freies Zielen (core: player.aimOffset {x, y} rad, Lauf relativ zur Sicht, x > 0 rechts, y > 0 oben) oder null. */
function actorFreeAim(actor) {
  const o = actor && actor.aimOffset;
  return o && (o.x || o.y) ? o : null;
}

export class WeaponController {
  /**
   * @param {import('./index.js').WeaponSystem} system
   * @param {object} actor  Player oder Bot (Actor-Schnittstelle §5)
   * @param {{primary, secondary, lethal}} loadout
   */
  constructor(system, actor, loadout = {}) {
    this.system = system;
    this.G = system.G;
    this.actor = actor;
    this.slots = [];
    this.index = 0;
    this.equipment = { lethal: { id: null, count: 0 }, tactical: { id: null, count: 0 } };
    this.meleeId = 'knife';      // Nahkampfwaffe (loadout.melee)
    this.isPlating = false;      // Schutzplatte wird eingesetzt (plateInsert)
    this.isInspecting = false;   // Inspizieren läuft (nur Spieler, PC)
    this.handlesInspect = true;  // player.js: Controller wertet it.inspect selbst aus (kein doppeltes playInspect)
    this._plate = null;

    // Öffentlicher Zustand (HUD, Bots, Spieler, Audio lesen ihn)
    this.adsProgress = 0;
    this.ads = false;
    this.spread = 0.04;
    this.fireSpread = 0.04;
    this.isReloading = false;
    this.reloadProgress = 0;
    this.reloadEmpty = false;
    this.reloadPhase = null;
    this.isSwitching = false;
    this.switchProgress = 1;
    this.canSprint = true;
    this.lastShotTime = -1e9;
    this.shotIndex = 0;
    this.isFiring = false;
    this.isMeleeing = false;
    this.isThrowing = false;
    this.cooking = false;
    this.cookTime = 0;
    this.fuseLeft = Infinity;
    this.scoped = false;
    this.holdingBreath = false;
    this.breath = 1;
    this.autoFireRange = 48;
    this.autoFireReady = true;
    this.idealRange = 20;
    this.maxRange = 100;
    this.viewModel = null;
    this.obstructed = 0;  // Wandkollision 0..1 (Spieler; 1 = Waffe ganz angezogen)
    this.winded = 0;      // Atemnot nach dem Sprint 0..1 (Spieler; mehr Schwanken, schnellerer Atem)

    // Intern
    this._cooldown = 0;
    this._sprintRecover = 0;
    this._fireBuffer = 0;
    this._burstLeft = 0;
    this._dryAt = -1e9;
    this._autoReloadAt = Infinity;
    this._bloomHip = 0;
    this._bloomAds = 0;
    this._reload = null;
    this._switch = null;
    this._melee = null;
    this._throw = null;
    this._adsOn = false;
    this._adsHeldT = 0;
    this._exhausted = 0;
    this._steady = 1;
    this._swayT = Math.random() * 10;
    this._swayX = 0;
    this._swayY = 0;
    this._shotSerial = 0;
    this._obsSample = [Infinity, Infinity];
    this._obsK = 0;
    this._obsAds = false;
    this._obsFire = false;
    this._sprintT = 0;
    this._driftT = Math.random() * 20;
    this._disposed = false;

    if (actor && actor.isPlayer) this._createViewModel();
    this.setLoadout(loadout);
  }

  /* ================================================================ Zugriff */

  get current() { return this.slots[this.index] || null; }
  get currentDef() { const s = this.slots[this.index]; return s ? s.def : null; }
  /** { mag, reserve, magSize } der aktuellen Waffe (HUD-Komfort). */
  get ammo() { const s = this.current; return s ? { mag: s.mag, reserve: s.reserve, magSize: s.def.mag || 0 } : null; }
  get infiniteAmmo() { const m = this.G.mode; return !!(this.actor.isBot || (m && m.def && m.def.infiniteAmmo)); }
  /** Außer Atem nach dem Atemanhalten im Zielfernrohr (HUD-Anzeige). */
  get exhausted() { return this._exhausted > 0; }

  _weapons() { return (this.G.data && this.G.data.WEAPONS) || DATA_WEAPONS; }
  _equipmentDefs() { return (this.G.data && this.G.data.EQUIPMENT) || DATA_EQUIPMENT; }
  _def(id) { const W = this._weapons(); return (id && W[id]) || null; }
  _knife() {
    const cur = this.currentDef;
    // Nahkampfwaffe als Hauptwaffe (Gun Game, Messer in der Hand): diese; sonst die ausgerüstete Nahkampfwaffe
    const k = (cur && cur.cls === 'melee' ? cur : this._def(this.meleeId)) || this._def('knife');
    return { def: k, spec: (k && k.melee) || KNIFE_FALLBACK };
  }

  /* ================================================================ Viewmodel */

  _createViewModel() {
    const G = this.G;
    const VM = G.modules && G.modules.viewmodel && G.modules.viewmodel.ViewModel;
    if (!VM || !G.viewmodel) return;
    try {
      this.viewModel = new VM(G);
      G.viewmodel.rig = this.viewModel;
    } catch (err) {
      console.error('[NULLPUNKT] ViewModel konnte nicht erzeugt werden:', err);
      this.viewModel = null;
    }
  }

  _vm(fn, ...args) {
    const vm = this.viewModel;
    if (!vm || typeof vm[fn] !== 'function') return undefined;
    try { return vm[fn](...args); } catch (err) { this._vmError(fn, err); return undefined; }
  }

  _vmError(fn, err) {
    if (this._vmErrors && this._vmErrors.has(fn)) return;
    (this._vmErrors || (this._vmErrors = new Set())).add(fn);
    console.error(`[NULLPUNKT] ViewModel.${fn}:`, err);
  }

  /** Shader/Grifflösungen der Ausrüstung vorab (Ladebildschirm, kein Ruckeln beim ersten Wechsel). */
  warmup() {
    const vm = this.viewModel;
    const r = this.G.renderer && this.G.renderer.renderer;
    if (!vm || typeof vm.warmup !== 'function' || !r) return;
    const mode = this.G.match && this.G.match.modeId;
    const ids = mode === 'gun' || mode === 'training' ? Object.keys(this._weapons()) : this.slots.map((s) => s.id);
    try { vm.warmup(r, ids.filter((id) => this._def(id))); } catch (err) { this._vmError('warmup', err); }
  }

  /* ================================================================ Ausrüstung */

  /** Ausrüstung setzen (Match-Start, Gun Game, Schießstand). Gleiche Waffen behalten ihren Munitionsstand. */
  setLoadout(loadout = {}) {
    const W = this._weapons();
    const prevId = this.currentDef ? this.currentDef.id : null;
    const old = new Map(this.slots.map((s) => [s.id, s]));
    const primary = this._def(loadout.primary) || this._def('ar_m17') || FALLBACK;
    let secondary = null;
    if (loadout.secondary !== null) {
      const sid = loadout.secondary === undefined ? 'pi_p9' : loadout.secondary;
      const d = this._def(sid);
      if (d && d.id !== primary.id && d.cls !== 'melee') secondary = d;
    }
    const mk = (def) => old.get(def.id) || { id: def.id, def, mag: def.mag || 0, reserve: def.reserve || 0 };
    this.slots = secondary ? [mk(primary), mk(secondary)] : [mk(primary)];
    // Ausrüstung
    const EQ = this._equipmentDefs();
    const lethal = loadout.lethal === null ? null : loadout.lethal === undefined ? (this.equipment.lethal.id || 'frag') : loadout.lethal;
    if (!lethal || !EQ[lethal]) this.equipment.lethal = { id: null, count: 0 };
    else if (this.equipment.lethal.id !== lethal) this.equipment.lethal = { id: lethal, count: EQ[lethal].count || 1 };
    // Taktisch (Blend/Rauch; Taste „Taktisch“) – Standard Rauch
    const tac = loadout.tactical === null ? null : loadout.tactical === undefined ? (this.equipment.tactical.id || 'smoke') : loadout.tactical;
    if (!tac || !EQ[tac]) this.equipment.tactical = { id: null, count: 0 };
    else if (this.equipment.tactical.id !== tac) this.equipment.tactical = { id: tac, count: EQ[tac].count || 1 };
    // Nahkampfwaffe
    const md = loadout.melee ? this._def(loadout.melee) : null;
    if (md && md.cls === 'melee') this.meleeId = md.id;
    // Aussehen (nur Spieler-Viewmodel): Tarnmuster je Waffe, Klassen-Arme
    if (this.viewModel) this._applyCosmetics(loadout);
    // Aktive Aktionen beenden (gezogene Granate fällt vor die Füße)
    this._abortActions(false, true);
    // Gleiche Waffe behalten; sonst denselben Slot (z. B. neue Pistole, während die alte in der Hand war)
    const keepIdx = prevId ? this.slots.findIndex((s) => s.id === prevId) : -1;
    const prevIndex = this.index;
    this.index = keepIdx >= 0 ? keepIdx : prevIndex < this.slots.length ? prevIndex : 0;
    this._burstLeft = 0;
    this.shotIndex = 0;
    this._bloomHip = this._bloomAds = 0;
    this._refreshStatic();
    const def = this.currentDef;
    if (def.id !== prevId) {
      this._vm('setWeapon', def.id, def);
      // Ziehen: kurz gesperrt (bei Spielbeginn ohne Verzögerung)
      if (prevId) this._switch = { t: SWITCH_LOWER, lower: SWITCH_LOWER, raise: Math.max(0.15, def.equipTime || 0.5), to: this.index, swapped: true, from: prevId };
      this.G.events.emit('weapon:switch', { actor: this.actor, weaponId: def.id, from: prevId, slot: this.index });
    }
    void W;
  }

  /**
   * Tarnmuster/Klassen-Aussehen aus dem Loadout (Spieler): camo { [weaponId]: camoId } bzw. camos, oder camo als Id für alle,
   * Rückfall Einstellung `weaponCamos` (falls vorhanden); look/classId/class → Klassen-Arme.
   */
  _applyCosmetics(loadout = {}) {
    const vm = this.viewModel;
    let stored = null;
    try { stored = this.G.settings && typeof this.G.settings.get === 'function' ? this.G.settings.get('weaponCamos') : null; } catch { stored = null; }
    // loadout.camo: { [weaponId]: camoId } (Lobby/modes-ui) oder eine Id für alle; loadout.camos wie die Objektform
    const map = loadout.camos || (loadout.camo && typeof loadout.camo === 'object' ? loadout.camo : null);
    const all = typeof loadout.camo === 'string' ? loadout.camo : null;
    const camoFor = (id) => (map && map[id]) || all || (stored && typeof stored === 'object' ? stored[id] : null) || null;
    for (const s of this.slots) this._vm('setCamo', s.id, camoFor(s.id));
    this._vm('setCamo', this.meleeId, camoFor(this.meleeId));
    this._vm('setMelee', this.meleeId);
    // Klassen-Arme: loadout.skin ('klasse:stufe', modes-ui) > look/classId/cls > Akteur-Klasse
    const [skCls, skTier] = typeof loadout.skin === 'string' ? loadout.skin.split(':') : [];
    const look = skCls || loadout.look || loadout.classId || loadout.cls || loadout.class || (this.actor && (this.actor.cls || this.actor.classLook));
    if (look || !this._lookSet) { this._lookSet = true; this._vm('setLook', look || 'standard', skTier || 'standard'); }
    void vm;
  }

  /** Volle Munition + Granaten (Respawn). */
  refill() {
    for (const s of this.slots) { s.mag = s.def.mag || 0; s.reserve = s.def.reserve || 0; }
    const eq = this.equipment.lethal;
    if (eq.id) { const d = this._equipmentDefs()[eq.id]; eq.count = d ? d.count || 1 : 1; }
    const tq = this.equipment.tactical;
    if (tq && tq.id) { const d = this._equipmentDefs()[tq.id]; tq.count = d ? d.count || 1 : 1; }
    this._plate = null;
    this.isPlating = false;
    this._abortActions(false);
    this.adsProgress = 0;
    this.ads = this._adsOn = false;
    this._cooldown = 0;
    this._sprintRecover = 0;
    this._fireBuffer = 0;
    this._burstLeft = 0;
    this.shotIndex = 0;
    this._bloomHip = this._bloomAds = 0;
    this.breath = 1;
    this._exhausted = 0;
    this._steady = 1;
    this._swayX = this._swayY = this._swayAmp = 0;
    this.holdingBreath = false;
    this.obstructed = 0;
    this._obsSample[0] = this._obsSample[1] = Infinity;
    this._obsAds = this._obsFire = false;
    this.winded = 0;
    this._sprintT = 0;
    this._autoReloadAt = Infinity;
    this.lastShotTime = -1e9;
    if (this.index !== 0) {
      this.index = 0;
      this._vm('setWeapon', this.currentDef.id, this.currentDef);
      this.G.events.emit('weapon:switch', { actor: this.actor, weaponId: this.currentDef.id, from: null, slot: 0 });
    }
    this._refreshStatic();
  }

  _refreshStatic() {
    const def = this.currentDef;
    if (!def) return;
    this.autoFireRange = def.autoFireRange || AUTO_RANGE[def.cls] || 45;
    // Für Bots: Entfernung, bis zu der die Nahbereichs-Schusszahl hält, und maximale Trefferdistanz
    this.idealRange = def.cls === 'melee' ? 2.4 : Math.max(4, Math.min(def.range || 100, effectiveRange(def) || 20));
    this.maxRange = def.range || 100;
    this.spread = this.fireSpread = def.hipSpread || 0.04;
  }

  _abortActions(emit = true, dropGrenade = false) {
    if (this._reload) this._finishReload(true, emit);
    if (dropGrenade && this._throw && this._throw.pinned && !this._throw.thrown && this.actor.alive !== false) {
      // Splint gezogen, aber nicht geworfen (z. B. Gun-Game-Wechsel): Granate fällt vor die Füße
      this._dropCookedGrenade();
    }
    this._switch = null;
    this._melee = null;
    this._throw = null;
    this._plate = null;
    this.cooking = false;
    this.cookTime = 0;
    this.fuseLeft = Infinity;
    this.isReloading = this.isSwitching = this.isMeleeing = this.isThrowing = this.isPlating = false;
    this.reloadProgress = 0;
    this.switchProgress = 1;
  }

  /* ================================================================ Schutzplatte + Inspizieren */

  /**
   * Schutzplatte einsetzen (Rüstung, core-mechanics): sperrt Feuern/Anschlag/Nachladen für `duration` s und spielt
   * die Ego-Animation. Laufendes Nachladen wird abgebrochen. → bool
   */
  plateInsert(duration = 1.6) {
    if (this._plate || this._throw || this._melee || this.actor.alive === false) return false;
    if (this._reload) this._finishReload(true);
    this._burstLeft = 0;
    this._fireBuffer = 0;
    this._plate = { t: 0, dur: Math.max(0.3, duration) };
    this.isPlating = true;
    this._vm('playPlate', this._plate.dur);
    return true;
  }

  /** Platteneinsatz abbrechen (z. B. Sprint, Treffer – Entscheidung bei core-mechanics). */
  cancelPlate() {
    if (!this._plate) return;
    this._plate = null;
    this.isPlating = false;
    if (this.viewModel && this.viewModel.actionName === 'plate') this._vm('cancelAction');
  }

  /** Waffe inspizieren (nur Spieler; die Taste wertet update() am PC aus). → bool */
  inspect() {
    if (!this.viewModel || this._reload || this._switch || this._melee || this._throw || this._plate || this.ads) return false;
    if (this.viewModel.isBusy) return false;
    this._vm('playInspect');
    return true;
  }

  /* ================================================================ Hauptschleife */

  /**
   * @param {number} dt
   * @param {object} it Intent (siehe Kopf/Changelog)
   */
  update(dt, it) {
    if (this._disposed) return;
    const st = this.current;
    if (!st) return;
    const G = this.G;
    const now = G.time.elapsed;
    const actor = this.actor;

    // Zeitgeber
    this._cooldown = Math.max(-0.05, this._cooldown - dt);
    this._fireBuffer = Math.max(0, this._fireBuffer - dt);
    if (it.sprinting) this._sprintRecover = st.def.sprintToFire || 0.2;
    else this._sprintRecover = Math.max(0, this._sprintRecover - dt);
    if (now - this.lastShotTime > 0.07) {
      const k = Math.exp(-6.5 * dt);
      this._bloomHip *= k;
      this._bloomAds *= k;
    }

    if (this._plate) {
      this._plate.t += dt;
      if (this._plate.t >= this._plate.dur) { this._plate = null; this.isPlating = false; }
    }
    // Inspizieren (PC, Taste „inspect“; Touch nicht) – jede Kampfeingabe bricht es ab
    if (actor.isPlayer && this.viewModel) {
      const insp = this.viewModel.actionName === 'inspect';
      if (insp && (it.fire || it.firePressed || it.ads || it.reload || it.sprinting || it.grenade || it.tactical || it.melee || it.swap)) this._vm('cancelAction');
      else if (!it.frozen && !insp && (it.inspect || (G.input && G.input.mode !== 'touch' && typeof G.input.pressed === 'function' && G.input.pressed('inspect')))) this.inspect();
      this.isInspecting = this.viewModel.actionName === 'inspect';
    }
    if (!it.frozen) {
      this._inputMelee(it);
      this._updateThrow(dt, it);
      this._updateSwitch(dt, it);
      this._updateReload(dt, it);
      this._updateMelee(dt);
    }
    const def = this.currentDef; // kann sich durch Wechsel geändert haben
    const cur = this.current;

    // ---- Wandkollision + Atemnot (nur Spieler)
    if (actor.isPlayer) {
      this._updateObstruct(dt, def);
      this._updateWinded(dt, it);
    }

    // ---- Anschlag
    const blocked = it.frozen || it.sprinting || !!this._switch || !!this._melee || !!this._throw || !!this._reload || !!this._plate || def.cls === 'melee' || this._obsAds || !!it.mantling;
    const wantAds = !!it.ads && !blocked;
    if (wantAds !== this._adsOn) {
      this._adsOn = wantAds;
      G.events.emit('weapon:ads', { actor, on: wantAds, weaponId: def.id });
    }
    this.ads = wantAds;
    const adsTime = Math.max(0.08, def.adsTime || 0.25);
    this.adsProgress = clamp(this.adsProgress + (wantAds ? 1 / adsTime : -1.35 / adsTime) * dt, 0, 1);
    const a = smooth01(this.adsProgress);

    // ---- Streuung
    this._updateSpread(dt, it, def, a);

    // ---- Feuern
    if (!it.frozen && !this._plate) this._updateFire(it, def, cur);

    // ---- Zielfernrohr-Schwanken + Atem (nur Spieler)
    if (actor.isPlayer) this._updateSway(dt, it, def, a);

    // ---- Öffentlicher Zustand
    this.isReloading = !!this._reload;
    this.isSwitching = !!this._switch;
    this.isMeleeing = !!this._melee;
    this.isThrowing = !!this._throw;
    this.isFiring = now - this.lastShotTime < 0.12;
    this.canSprint = !this._reload && !this._melee && !this._throw && !this._plate;
    this.autoFireReady = !this._reload && !this._switch && !this._melee && !this._throw && !this._obsFire && (def.cls === 'melee' || cur.mag > 0) &&
      (def.cls !== 'sniper' || this.adsProgress > 0.85);
    if (this._switch) {
      const s = this._switch;
      this.switchProgress = clamp(s.t / (s.lower + s.raise), 0, 1);
    } else this.switchProgress = 1;

    // ---- Viewmodel
    const vm = this.viewModel;
    if (vm) {
      const s = this._vmState || (this._vmState = {});
      s.ads = wantAds;
      s.adsProgress = easeInOut(this.adsProgress);
      s.moving = !!it.moving;
      s.speed = it.speed || 0;
      s.sprinting = !!it.sprinting;
      s.crouching = !!it.crouching;
      s.onGround = it.onGround !== false && !it.airborne;
      s.lookDX = it.lookDX || 0;
      s.lookDY = it.lookDY || 0;
      s.reloading = this.isReloading;
      s.reloadProgress = this.reloadProgress;
      s.reloadEmpty = this.reloadEmpty;
      s.firing = this.isFiring;
      s.timeSinceShot = now - this.lastShotTime;
      s.mag = def.cls === 'melee' ? 1 : cur.mag;
      // Waffengefühl: Geschwindigkeit im Blickraum (x rechts, y oben, z vorwärts), Wandkollision, Atemnot,
      // Lehnen und freies Zielen (core, sobald vorhanden)
      const v = s.vel || (s.vel = { x: 0, y: 0, z: 0 });
      const bv = actor.body && actor.body.velocity;
      if (bv && Number.isFinite(actor.yaw)) {
        const cy = Math.cos(actor.yaw), sy = Math.sin(actor.yaw);
        v.x = bv.x * cy - bv.z * sy; v.y = bv.y; v.z = -bv.x * sy - bv.z * cy;
      } else { v.x = 0; v.y = 0; v.z = it.speed || 0; }
      s.obstruct = this.obstructed;
      s.winded = this.winded;
      s.exhausted = this._exhausted > 0;
      s.holdingBreath = this.holdingBreath;
      s.lean = actorLean(actor);
      s.freeAim = actorFreeAim(actor);
      s.mantling = !!(it.mantling || actor.mantling);
      // Körperkamera (core): Schritt- und Atemphase der Kamera, damit Waffe und Kamera im selben Takt schwingen
      s.stepPhase = Number.isFinite(actor.stepPhase) ? actor.stepPhase : Number.isFinite(actor._bobPhase) ? actor._bobPhase : undefined;
      s.breathPhase = Number.isFinite(actor.breathPhase) ? actor.breathPhase : Number.isFinite(actor._breathPh) ? actor._breathPh : undefined;
      s.cameraMotion = Number.isFinite(actor.cameraMotion) ? actor.cameraMotion : undefined;
      try { vm.update(dt, s); } catch (err) { this._vmError('update', err); }
      this.scoped = !!vm.showScopeOverlay;
    } else {
      this.scoped = !!(def.scope && def.scope.overlay === 'sniper' && this.adsProgress > 0.96);
    }
  }

  /* ================================================================ Streuung */

  _updateSpread(dt, it, def, a) {
    const hip = def.hipSpread ?? 0.045;
    const adsS = def.adsSpread ?? 0.003;
    const base = hip + (adsS - hip) * a;
    const sp = clamp((it.speed || (it.moving ? MOVE_REF : 0)) / MOVE_REF, 0, 1.5);
    let mult = 1 + ((def.moveSpreadMult ?? 1.4) - 1) * Math.min(1, sp) * (1 - 0.7 * a);
    if (it.airborne) mult *= 1 + ((def.jumpSpreadMult ?? 2.5) - 1) * (1 - 0.5 * a);
    if (it.sliding) mult *= 1 + 0.25 * (1 - a);
    else if (it.crouching && sp < 0.35) mult *= 0.8 + 0.12 * a;
    if (it.sprinting) mult *= 1.35;
    const target = base * mult + this._bloomHip * (1 - a) + this._bloomAds * a;
    this.fireSpread = target;
    // HUD: schnell auf, sanft zurück
    this.spread += (target - this.spread) * damp(target > this.spread ? 40 : 12, dt);
  }

  /* ================================================================ Feuern */

  _updateFire(it, def, st) {
    if (def.cls === 'melee') {
      if (it.firePressed || (it.fire && !this._melee)) this.melee();
      return;
    }
    const mode = def.fireMode || 'auto';
    if (it.firePressed) this._fireBuffer = Math.max(this._fireBuffer, 0.16 + (it.sprinting || this._sprintRecover > 0 ? (def.sprintToFire || 0.2) : 0));
    const trigger = mode === 'auto' ? (it.fire || this._fireBuffer > 0) : (this._fireBuffer > 0 || this._burstLeft > 0);
    // Automatisch nachladen, wenn leer (nach dem letzten Schuss)
    if (!trigger) {
      if (st.mag <= 0 && !this._reload && !this._switch && !this._melee && !this._throw && this.G.time.elapsed >= this._autoReloadAt) {
        this._autoReloadAt = Infinity;
        this.reload();
      }
      return;
    }
    if (this._switch || this._throw || this._melee || it.sprinting || this._sprintRecover > 0) return;
    // Waffe an der Wand angezogen: kein Schuss (Eingabepuffer verfällt von selbst)
    if (this._obsFire || it.mantling) return;
    if (this._reload) {
      // Schrot: Schießen unterbricht das Nachladen, sobald eine Patrone drin ist
      if (this._reload.shells && st.mag > 0) this._finishReload(true);
      else return;
    }
    if (st.mag <= 0) {
      const now = this.G.time.elapsed;
      if ((it.firePressed || this._fireBuffer > 0) && now - this._dryAt > 0.3) {
        this._dryAt = now;
        this.G.events.emit('weapon:dryfire', { actor: this.actor, weaponId: def.id });
      }
      this._fireBuffer = 0;
      this._burstLeft = 0;
      if (st.reserve > 0 || this.infiniteAmmo) this.reload();
      return;
    }
    if (mode === 'burst' && this._burstLeft <= 0) {
      if (this._cooldown > 0) return;
      this._burstLeft = Math.max(1, def.burstCount || 3);
    }
    let shots = 0;
    while (this._cooldown <= 0 && st.mag > 0 && shots < 3) {
      this._fire(it, def, st, mode);
      shots++;
      if (mode === 'auto') {
        this._fireBuffer = 0;
        if (!it.fire) break;
      } else if (mode === 'burst') {
        this._burstLeft -= 1;
        if (this._burstLeft <= 0) {
          this._fireBuffer = 0;
          this._cooldown += Math.max(0, (def.burstDelay || 0.25) - 60 / Math.max(1, def.rpm || 600));
          break;
        }
      } else {
        this._fireBuffer = 0;
        break;
      }
    }
  }

  _fire(it, def, st, mode) {
    const G = this.G;
    const actor = this.actor;
    const now = G.time.elapsed;
    const infinite = this.infiniteAmmo;
    st.mag -= 1;
    const interval = 60 / Math.max(1, def.rpm || 600);
    if (now - this.lastShotTime > interval * 1.6) this._cooldown = Math.max(this._cooldown, 0);
    this._cooldown += interval;
    this.shotIndex = now - this.lastShotTime > Math.max(0.28, interval * 2.2) ? 0 : this.shotIndex + 1;
    this.lastShotTime = now;
    actor.lastFiredTime = now;
    this._shotSerial++;

    actor.getEyePosition(_eye);
    actor.getAimDirection(_aim);
    this.getMuzzlePosition(_muz);

    const pellets = Math.max(1, def.pellets || 1);
    G.events.emit('weapon:fire', {
      actor, weaponId: def.id, origin: _eye.clone(), dir: _aim.clone(), suppressed: !!def.suppressed,
      muzzle: _muz.clone(), pellets, shotIndex: this.shotIndex, ads: this.adsProgress,
    });

    // Kugeln
    const combat = G.combat;
    const r = def.recoil || FALLBACK.recoil;
    // Erster Schuss aus der Ruhe: eigener Streufaktor (Rückstoß 2.0, Daten recoil.firstShotSpread)
    const spread = this.fireSpread * (this.shotIndex === 0 && Number.isFinite(r.firstShotSpread) ? r.firstShotSpread : 1);
    const rot = Math.random() * Math.PI * 2;
    const scale = Number.isFinite(actor.damageScale) ? actor.damageScale : 1;
    const range = def.range || 100;
    const semi = mode !== 'auto' && mode !== 'burst';
    let from = null;
    if (def.projectile) {
      // Rakete (Panzerabwehr): Projektil statt Strahl – Flug, Fahrzeug-/Akteurtreffer, Splitter (ballistics/rockets.js)
      sampleCone(_aim, spread, _dir);
      if (this.system && typeof this.system.fireProjectile === 'function') this.system.fireProjectile(actor, def, _muz, _dir, scale);
    }
    for (let i = 0; i < (def.projectile ? 0 : pellets); i++) {
      if (pellets > 1) samplePellet(_aim, spread, i, pellets, rot, _dir);
      else sampleCone(_aim, spread, _dir);
      const res = combat ? combat.fireHitscan({ shooter: actor, origin: _eye, dir: _dir, range, weapon: def, pelletIndex: i, damageScale: scale }) : null;
      if (!res) continue;
      // Leuchtspur: Spieler jede 3. Kugel (Einzelfeuer jede), Bots jede 2., Schrot 2 Kugeln
      const tracer = pellets > 1 ? i < 2 : semi ? true : actor.isPlayer ? this.shotIndex % 3 === 0 : this.shotIndex % 2 === 0;
      if (tracer && res.point) {
        if (!from) from = _muz.clone();
        G.events.emit('tracer', { from, to: res.point, actor, weaponId: def.id, hit: res.hit });
      }
    }

    // Rückstoß
    const e = patternAt(r.pattern, this.shotIndex);
    const first = this.shotIndex === 0 ? (r.firstShotMult || 1) : 1;
    const a = smooth01(this.adsProgress);
    let k = 1 - 0.18 * a;
    if (it.crouching && !it.moving) k *= 0.85;
    if (it.airborne) k *= 1.2;
    if (actor.isPlayer && G.input && G.input.mode === 'touch') k *= 0.72; // Touch: wie COD Mobile deutlich ruhiger
    const pitch = r.vertical * e[1] * first * k * (0.94 + Math.random() * 0.12);
    const yaw = r.horizontal * (e[0] + (Math.random() * 0.7 - 0.35)) * k;
    // Freies Zielen (core, nur an der Hüfte): ein Teil des Stoßes bewegt den Lauf innerhalb der Totzone statt der
    // Sicht – die Waffe springt im Bild, die Kamera folgt erst am Rand (Überlauf übernimmt player._applyLook)
    let camP = pitch, camY = yaw;
    const fa = actor.isPlayer ? actor.aimOffset : null;
    if (fa && actor.freeAimRadius > 1e-4) {
      const kf = 0.45 * (1 - a);
      fa.y += pitch * kf;
      fa.x += yaw * kf;
      camP *= 1 - kf;
      camY *= 1 - kf;
    }
    if (typeof actor.addRecoil === 'function') actor.addRecoil(camP, camY, r.recovery);

    // Aufblühen
    const hip = def.hipSpread || 0.04;
    const adsS = def.adsSpread || 0.003;
    const auto = !semi;
    this._bloomHip = Math.min(hip * 0.85, this._bloomHip + hip * (auto ? 0.14 : 0.3));
    this._bloomAds = Math.min(adsS * 1.2 + 0.0012, this._bloomAds + (adsS * 0.3 + 0.0002) * (auto ? 1 : 1.4));
    this.spread = Math.max(this.spread, this.fireSpread + this._bloomHip * (1 - a));

    // Sichtbarer Stoß (Rückstoß 2.0): Charakter je Waffe (recoil.visual) × Verhältnis zum Grundrückstoß der Waffe
    // (Aufsätze, die den Rückstoß ändern, ändern auch den sichtbaren Stoß); seitlich in Richtung des Zielrückstoßes
    if (actor.isPlayer) {
      const base = DATA_WEAPONS[def.baseId || def.id];
      const ratio = base && base.recoil && base.recoil.vertical > 0 ? clamp(r.vertical / base.recoil.vertical, 0.5, 1.6) : 1;
      const visual = (Number.isFinite(r.visual) ? r.visual : 1) * ratio;
      if (this.viewModel) this._vm('onShot', SHOT_STRENGTH[def.cls] || (def.id === 'pi_adler' ? 1.6 : 1), { empty: st.mag === 0, suppressed: !!def.suppressed, visual, yaw, pitch });
      const sh = (SHOT_SHAKE[def.cls] || (def.sound && def.sound.profile === 'pistol_heavy' ? 0.1 : 0)) * visual * (1 - 0.3 * a);
      if (sh > 0 && typeof actor.shake === 'function') actor.shake(sh);
    }

    // Munition: Bots/Training nie leer
    if (infinite && st.reserve < (def.mag || 1)) st.reserve = def.reserve || (def.mag || 1) * 4;
    if (st.mag === 0) this._autoReloadAt = now + Math.max(0.22, Math.min(interval, 0.6));
  }

  /** Mündungsposition in Weltkoordinaten (Leuchtspur-Ursprung). */
  getMuzzlePosition(out = new THREE.Vector3()) {
    const actor = this.actor;
    if (this.viewModel && typeof this.viewModel.getMuzzleWorldPosition === 'function' && actor.isPlayer) {
      try { return this.viewModel.getMuzzleWorldPosition(out); } catch (err) { this._vmError('getMuzzleWorldPosition', err); }
    }
    if (typeof actor.getMuzzlePosition === 'function') {
      try { return actor.getMuzzlePosition(out); } catch { /* Rückfall unten */ }
    }
    actor.getEyePosition(out);
    actor.getAimDirection(_fwd);
    _side.crossVectors(_fwd, UP);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0); else _side.normalize();
    return out.addScaledVector(_fwd, 0.62).addScaledVector(_side, 0.16).addScaledVector(UP, -0.2);
  }

  /* ================================================================ Nachladen */

  /** Nachladen starten (falls sinnvoll). → bool */
  reload() {
    const st = this.current;
    if (!st || this._reload || this._switch || this._melee || this._throw || this._plate) return false;
    const def = st.def;
    if (def.cls === 'melee' || !def.mag || st.mag >= def.mag) return false;
    if (st.reserve <= 0 && !this.infiniteAmmo) return false;
    const empty = st.mag === 0;
    this._burstLeft = 0;
    this._fireBuffer = 0;
    if (def.perShellReload) {
      const tm = def.shellTiming || { start: 0.3, insert: 0.48, end: 0.42 };
      const need = Math.min(def.mag - st.mag, this.infiniteAmmo ? def.mag : st.reserve);
      this._reload = {
        shells: true, empty, phase: 'start', t: 0, pt: 0, timing: tm, inserted: false,
        total: tm.start + tm.insert * need + tm.end + (empty ? 0.45 : 0),
      };
    } else {
      const dur = empty ? (def.reloadEmptyTime || 2.6) : (def.reloadTime || 2);
      this._reload = { shells: false, empty, t: 0, dur, insertAt: dur * (empty ? 0.64 : 0.76), inserted: false };
    }
    this.reloadEmpty = empty;
    this.reloadProgress = 0;
    this.reloadPhase = 'start';
    this.isReloading = true;
    this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def.id, phase: 'start', empty });
    this._vm('playReload', empty);
    return true;
  }

  /** Nachladen abbrechen (bereits eingesetzte Munition bleibt). */
  cancelReload() {
    if (this._reload) this._finishReload(true);
  }

  _updateReload(dt, it) {
    const st = this.current;
    const def = st.def;
    if (!this._reload) {
      if (it.reload) this.reload();
      this.reloadProgress = 0;
      this.reloadPhase = null;
      return;
    }
    // Sprint (bewusst ausgelöst) bricht das Nachladen ab
    if (this._sprintCancel(it)) { this._finishReload(true); return; }
    const r = this._reload;
    r.t += dt;
    if (!r.shells) {
      this.reloadProgress = clamp(r.t / r.dur, 0, 1);
      if (!r.inserted && r.t >= r.insertAt) {
        r.inserted = true;
        this._addAmmo(st, def.mag - st.mag);
        this.reloadPhase = 'insert';
        this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def.id, phase: 'insert', empty: r.empty });
      }
      if (r.t >= r.dur) this._finishReload(false);
      return;
    }
    // Patrone für Patrone
    const tm = r.timing;
    r.pt += dt;
    if (r.phase === 'start' && r.pt >= tm.start) { r.phase = 'insert'; r.pt = 0; }
    else if (r.phase === 'insert' && r.pt >= tm.insert) {
      r.pt -= tm.insert;
      this._addAmmo(st, 1);
      r.inserted = true;
      this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def.id, phase: 'insert', empty: r.empty, shell: true });
      if (st.mag >= def.mag || (st.reserve <= 0 && !this.infiniteAmmo)) { r.phase = 'end'; r.pt = 0; }
    } else if (r.phase === 'end' && r.pt >= tm.end + (r.empty ? 0.45 : 0)) {
      this._finishReload(false);
      return;
    }
    this.reloadPhase = r.phase;
    this.reloadProgress = clamp(r.t / Math.max(0.1, r.total), 0, 0.99);
  }

  _addAmmo(st, n) {
    const add = this.infiniteAmmo ? n : Math.min(n, st.reserve);
    st.mag += add;
    if (!this.infiniteAmmo) st.reserve -= add;
    else if (st.reserve < (st.def.mag || 1)) st.reserve = st.def.reserve || st.reserve;
  }

  _finishReload(interrupted, emit = true) {
    const r = this._reload;
    if (!r) return;
    this._reload = null;
    this.isReloading = false;
    this.reloadProgress = 0;
    this.reloadPhase = null;
    const def = this.currentDef;
    if (interrupted && this.viewModel && !r.shells) this._vm('cancelAction');
    if (emit) this.G.events.emit('weapon:reload', { actor: this.actor, weaponId: def ? def.id : null, phase: 'end', empty: r.empty, interrupted: !!interrupted });
  }

  /** Spieler: erneutes Sprint-Drücken bricht Nachladen ab (Bots: intent.cancelReload). */
  _sprintCancel(it) {
    if (it.cancelReload) return true;
    if (!this.actor.isPlayer) return false;
    const input = this.G.input;
    if (!input || !input.pressed('sprint') || this.adsProgress > 0.1) return false;
    const r = this._reload;
    return r && (r.shells ? r.phase !== 'end' : r.t < r.dur * 0.9);
  }

  /* ================================================================ Wechsel */

  _updateSwitch(dt, it) {
    if (!this._switch && this.slots.length > 1 && !this._melee && !this._throw) {
      let to = null;
      if (it.swap) to = (this.index + 1) % this.slots.length;
      else if (it.slot && it.slot - 1 !== this.index && this.slots[it.slot - 1]) to = it.slot - 1;
      if (to !== null) this.switchTo(to);
    }
    const s = this._switch;
    if (!s) return;
    s.t += dt;
    if (!s.swapped && s.t >= s.lower) {
      s.swapped = true;
      const from = this.currentDef ? this.currentDef.id : null;
      this.index = s.to;
      this.shotIndex = 0;
      this._bloomHip = this._bloomAds = 0;
      this._refreshStatic();
      this._autoReloadAt = Infinity;
      this.G.events.emit('weapon:switch', { actor: this.actor, weaponId: this.currentDef.id, from, slot: this.index });
    }
    if (s.t >= s.lower + s.raise) this._switch = null;
  }

  /** Zu Slot-Index wechseln (0 = primär, 1 = sekundär). */
  switchTo(to) {
    if (to === this.index || !this.slots[to] || this._melee || this._throw) return false;
    if (this._switch) {
      // Schnelles Zurückwechseln während des Wegsteckens
      if (!this._switch.swapped) { this._switch.to = to; return true; }
      return false;
    }
    if (this._reload) this._finishReload(true);
    const next = this.slots[to].def;
    this._switch = { t: 0, to, swapped: false, lower: SWITCH_LOWER, raise: Math.max(0.15, next.equipTime || 0.5) };
    this._burstLeft = 0;
    this._fireBuffer = 0;
    this._vm('setWeapon', next.id, next);
    return true;
  }

  /* ================================================================ Messer */

  _inputMelee(it) {
    if (it.melee && !this._melee) this.melee();
  }

  /** Nahkampfangriff (Messer). Mit Ausfallschritt, wenn ein Gegner knapp außer Reichweite ist. */
  melee() {
    if (this._melee || this._throw || (this._switch && !this._switch.swapped)) return false;
    const G = this.G;
    const actor = this.actor;
    const { def: kdef, spec } = this._knife();
    if (this._reload) this._finishReload(true);
    this._burstLeft = 0;
    this._fireBuffer = 0;
    const target = this._findMeleeTarget(spec);
    let lunge = false;
    let dist = 0;
    if (target) {
      dist = this._meleeDistance(target);
      lunge = dist > (spec.range || 2.4) * 0.85;
    }
    const lungeSpeed = spec.lungeSpeed || 10;
    const travel = lunge ? Math.max(0, dist - (spec.range || 2.4) * 0.7) : 0;
    const arrive = lunge ? travel / lungeSpeed : 0;
    this._melee = {
      t: 0, target, lunge, hit: false, arrive, maxLunge: arrive + 0.18,
      hitAt: lunge ? arrive : spec.hitDelay || 0.14,
      animAt: lunge ? Math.max(0, arrive - (spec.swingTime || 0.75) * 0.2) : 0, anim: false,
      end: arrive + (spec.swingTime || 0.75), spec, def: kdef,
    };
    this._melee.backstab = !!(target && this._isBehind(target));
    if (this._melee.animAt <= 0) { this._melee.anim = true; this._vm('playMelee', { backstab: this._melee.backstab, duration: spec.swingTime }); }
    G.events.emit('weapon:melee', { actor, phase: 'swing', lunge, target: target || null });
    return true;
  }

  _meleeDistance(t) {
    this.actor.getEyePosition(_eye);
    _to.copy(t.position);
    _to.y += (t.body ? t.body.height : 1.8) * 0.6;
    return _to.distanceTo(_eye);
  }

  _findMeleeTarget(spec) {
    const G = this.G;
    const a = this.actor;
    if (!G.combat) return null;
    a.getEyePosition(_eye);
    a.getAimDirection(_aim);
    const reach = (spec.lungeRange || 4.5) + 0.35;
    let best = null;
    let bestScore = Infinity;
    for (const t of G.actors) {
      if (!t || !t.alive || t === a || !G.combat.isHostile(a, t)) continue;
      _to.copy(t.position);
      _to.y += (t.body ? t.body.height : 1.8) * 0.6;
      _to.sub(_eye);
      const d = _to.length();
      if (d > reach || d < 1e-3) continue;
      const ang = Math.acos(clamp(_to.dot(_aim) / d, -1, 1));
      const allow = (spec.arc || 0.6) + Math.atan(0.45 / Math.max(0.5, d));
      if (ang > allow) continue;
      _to.add(_eye);
      if (G.world && G.world.lineOfSight && !G.world.lineOfSight(_eye, _to)) continue;
      const score = d * (1 + ang);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  _updateMelee(dt) {
    const m = this._melee;
    if (!m) return;
    const G = this.G;
    const a = this.actor;
    m.t += dt;
    if (!m.anim && m.t >= m.animAt) { m.anim = true; this._vm('playMelee', { backstab: m.backstab, duration: spec.swingTime }); }
    const spec = m.spec;
    const range = spec.range || 2.4;
    // Ausfallschritt: auf das Ziel zu, Blick rastet ein
    if (m.lunge && !m.hit && m.target && m.target.alive) {
      const d = this._meleeDistance(m.target);
      _to.copy(m.target.position).sub(a.position);
      _to.y = 0;
      const h = _to.length();
      if (h > 1e-3 && a.body) {
        const sp = (spec.lungeSpeed || 10) * 1.2;
        a.body.velocity.x = (_to.x / h) * sp;
        a.body.velocity.z = (_to.z / h) * sp;
      }
      // Blick auf das Ziel ziehen (wie COD)
      a.getEyePosition(_eye);
      _to.copy(m.target.position);
      _to.y += (m.target.body ? m.target.body.height : 1.8) * 0.62;
      _to.sub(_eye);
      const wantYaw = Math.atan2(-_to.x, -_to.z);
      const wantPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
      const k = damp(16, dt);
      a.yaw += wrapAngle(wantYaw - a.yaw) * k;
      if (Number.isFinite(a.pitch)) a.pitch += (wantPitch - a.pitch) * k;
      if (d <= range * 0.8 || m.t >= m.maxLunge) m.hitAt = Math.min(m.hitAt, m.t);
    }
    if (!m.hit && m.t >= m.hitAt) {
      m.hit = true;
      if (!m.anim) { m.anim = true; this._vm('playMelee', { backstab: m.backstab, duration: spec.swingTime }); }
      if (m.lunge && a.body) { a.body.velocity.x *= 0.25; a.body.velocity.z *= 0.25; }
      this._resolveMelee(m);
    }
    if (m.t >= m.end) this._melee = null;
  }

  _resolveMelee(m) {
    const G = this.G;
    const a = this.actor;
    const spec = m.spec;
    const range = (spec.range || 2.4) + 0.45;
    let target = m.target && m.target.alive ? m.target : null;
    if (target && this._meleeDistance(target) > range) target = null;
    if (!target) target = this._findMeleeTarget({ ...spec, lungeRange: range - 0.35 });
    a.getEyePosition(_eye);
    a.getAimDirection(_aim);
    if (target) {
      // Rückenstich: Angreifer hinter dem Ziel (Blickrichtung des Ziels zeigt weg)
      const backstab = this._isBehind(target);
      // Schwierigkeit (Bots): gleicher Faktor wie bei Kugeln und Granaten → auf „Rekrut“ braucht das
      // Messer zwei Treffer, der Rückenstich tötet weiterhin sofort.
      const scale = Number.isFinite(a.damageScale) ? a.damageScale : 1;
      const dmg = ((m.def && m.def.damage && m.def.damage.max) || 135) * (backstab ? 2 : 1) * scale;
      const point = new THREE.Vector3().copy(target.position);
      point.y += (target.body ? target.body.height : 1.8) * 0.62;
      const dir = point.clone().sub(_eye).normalize();
      const wid = (m.def && m.def.id) || 'knife';
      const dealt = G.combat.damage(target, { amount: dmg, attacker: a, weaponId: wid, zone: 'body', dir, point, distance: point.distanceTo(_eye) });
      G.events.emit('weapon:meleeHit', { actor: a, target, backstab, killed: !target.alive, damage: dealt, weaponId: wid });
      return;
    }
    // Daneben: Einschlag an Wand/Ziel (Funken/Staub, Schießstand-Klappziele)
    const w = G.world;
    if (w && typeof w.raycast === 'function') {
      const hit = w.raycast(_eye, _aim, Math.min(2.0, range));
      if (hit) G.events.emit('impact', { point: hit.point, normal: hit.normal, surface: hit.surface || 'concrete', shooter: a, weaponId: (m.def && m.def.id) || 'knife', melee: true });
    }
  }

  /** Steht der Akteur hinter dem Ziel (Blickrichtung des Ziels zeigt weg)? */
  _isBehind(target) {
    const ty = Number.isFinite(target.yaw) ? target.yaw : 0;
    _fwd.set(-Math.sin(ty), 0, -Math.cos(ty));
    _to.copy(this.actor.position).sub(target.position);
    _to.y = 0;
    return _to.lengthSq() > 1e-4 && _fwd.dot(_to.normalize()) < -0.45;
  }

  /* ================================================================ Granaten */

  _updateThrow(dt, it) {
    const G = this.G;
    if (!this._throw && !this._melee && !this._plate && !(this._switch && !this._switch.swapped)) {
      // Tödlich (Taste Granate) hat Vorrang vor taktisch (Taste Taktisch)
      const slot = it.grenade ? 'lethal' : it.tactical ? 'tactical' : null;
      const eqs = slot ? this.equipment[slot] : null;
      if (eqs && eqs.id && eqs.count > 0) {
        const eq = this._equipmentDefs()[eqs.id];
        if (this._reload) this._finishReload(true);
        this._burstLeft = 0;
        this._fireBuffer = 0;
        this._throw = { t: 0, type: eqs.id, slot, eq, cookable: !!(eq && eq.cookable), pinned: false, released: false, thrown: false, cook: 0 };
        this._vm('playGrenade', eqs.id, { hold: true });
      }
    }
    const tr = this._throw;
    if (!tr) { this.cooking = false; this.cookTime = 0; this.fuseLeft = Infinity; return; }
    const lethal = this.equipment[tr.slot || 'lethal'] || this.equipment.lethal;
    tr.t += dt;
    if (!tr.pinned && tr.t >= GRENADE.pin) {
      tr.pinned = true;
      G.events.emit('grenade:pin', { actor: this.actor, type: tr.type });
    }
    // Halten (Spieler: Taste gedrückt; Bots: grenadeCook Sekunden)
    const heldKey = tr.slot === 'tactical' ? 'tacticalHeld' : 'grenadeHeld';
    const held = this.actor.isPlayer ? !!it[heldKey] : (it[heldKey] || (it.grenadeCook || tr.botCook || 0) > tr.cook);
    if (it.grenadeCook && !tr.botCook) tr.botCook = it.grenadeCook;
    if (!tr.released) {
      if (held && tr.t >= GRENADE.hold) {
        tr.t = GRENADE.hold;
        if (tr.cookable) tr.cook += dt;
        else tr.aim = (tr.aim || 0) + dt;
      } else if (!held && tr.t >= GRENADE.hold - 0.12) {
        tr.released = true;
        this._vm('releaseGrenade');
      }
    }
    const fuse = tr.eq ? tr.eq.fuse || 2.8 : 2.8;
    this.cooking = tr.cookable && tr.pinned && !tr.thrown;
    this.cookTime = tr.cookable ? tr.cook : 0;
    this.fuseLeft = tr.cookable && !tr.thrown ? Math.max(0, fuse - tr.cook) : Infinity;
    // Zu lange gekocht: Explosion in der Hand. Die Granate ist damit verbraucht – Zustand VOR der
    // Explosion abräumen: tötet sie den Werfer, ruft der kill-Handler onDeath() auf, und eine noch
    // „gezogene“ Granate würde dort fallen gelassen und sofort ein zweites Mal explodieren.
    if (tr.cookable && !tr.thrown && tr.cook >= fuse) {
      tr.thrown = true;
      this._throw = null;
      this.cooking = false;
      this.cookTime = 0;
      this.fuseLeft = Infinity;
      lethal.count = Math.max(0, lethal.count - 1);
      this._vm('cancelAction');
      this.system.explodeInHand(this.actor, tr.type);
      return;
    }
    if (!tr.thrown && tr.released && tr.t >= GRENADE.release) {
      tr.thrown = true;
      lethal.count = Math.max(0, lethal.count - 1);
      this.system.throwGrenade(this.actor, tr.type, { cook: tr.cookable ? tr.cook : 0 });
      this.cooking = false;
      this.cookTime = 0;
      this.fuseLeft = Infinity;
    }
    if (tr.thrown && tr.t >= GRENADE.end) this._throw = null;
  }

  /** Gezogene Granate fallen lassen (Abbruch nach Splint), damit nichts verloren geht. */
  _dropCookedGrenade() {
    const tr = this._throw;
    if (!tr || tr.thrown) return;
    tr.thrown = true;
    const lethal = this.equipment[tr.slot || 'lethal'] || this.equipment.lethal;
    lethal.count = Math.max(0, lethal.count - 1);
    try { this.system.throwGrenade(this.actor, tr.type, { cook: tr.cook || 0, drop: true }); } catch { /* Welt evtl. schon weg */ }
  }

  /* ================================================================ Wandkollision + Atemnot */

  /**
   * Wandkollision (F3, nur Spieler): je Bild EIN Strahl gegen die Kugel-Geometrie, abwechselnd entlang der
   * Laufrichtung ab dem Auge und ab der Waffenseite (rechts unten, nur an der Hüfte). Liegt die Wand näher als
   * die Reichweite der Waffe (`handling.reach`, Auge → Mündung), wird sie angezogen: `obstructed` 0..1.
   * Ab OBSTRUCT_ADS kein Anschlag, ab OBSTRUCT_FIRE kein Schuss (mit Hysterese).
   */
  _updateObstruct(dt, def) {
    const G = this.G;
    const actor = this.actor;
    const w = G.world;
    const reach = def.cls === 'melee' ? 0 : weaponHandling(def).reach || 0;
    let raw = 0;
    if (reach > 0 && w && typeof w.raycast === 'function' && actor.alive !== false) {
      const k = (this._obsK = (this._obsK + 1) % 2);
      actor.getEyePosition(_eye);
      actor.getAimDirection(_aim);
      _org.copy(_eye);
      let len = reach + 0.06;
      if (k === 1) {
        // Waffenseite: etwas rechts und unterhalb des Auges (im Anschlag liegt die Waffe auf der Visierlinie)
        const a = smooth01(this.adsProgress);
        _side.crossVectors(_aim, UP);
        if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0); else _side.normalize();
        _org.addScaledVector(_side, 0.1 * (1 - a)).addScaledVector(UP, -0.08 * (1 - a));
        len -= 0.06 * (1 - a);
      }
      let d = Infinity;
      try {
        const hit = w.raycast(_org, _aim, len);
        if (hit && Number.isFinite(hit.distance) && hit.targetId === undefined) d = hit.distance;
      } catch { /* Welt im Abbau */ }
      this._obsSample[k] = d;
      const dmin = Math.min(this._obsSample[0], this._obsSample[1]);
      raw = Number.isFinite(dmin) ? clamp((reach - dmin) / (reach * 0.55), 0, 1) : 0;
    } else {
      this._obsSample[0] = this._obsSample[1] = Infinity;
    }
    this.obstructed += (raw - this.obstructed) * damp(raw > this.obstructed ? 16 : 8, dt);
    if (this.obstructed < 1e-3) this.obstructed = 0;
    const o = this.obstructed;
    this._obsAds = this._obsAds ? o > OBSTRUCT_ADS[1] : o > OBSTRUCT_ADS[0];
    this._obsFire = this._obsFire ? o > OBSTRUCT_FIRE[1] : o > OBSTRUCT_FIRE[0];
  }

  /**
   * Atemnot nach dem Sprint (nur Spieler): steigt nach ~1,5 s Sprint binnen ~5 s auf 1, fällt danach in
   * ~4,5 s (geduckt schneller). Nutzt `exertion` des Spielers (core), sobald vorhanden.
   */
  _updateWinded(dt, it) {
    const ex = Number.isFinite(it.exertion) ? it.exertion : this.actor.exertion;
    if (Number.isFinite(ex)) { this.winded = clamp(ex, 0, 1); return; }
    if (it.sprinting) this._sprintT += dt; else this._sprintT = Math.max(0, this._sprintT - dt * 2);
    if (it.sprinting) {
      const target = clamp((this._sprintT - 1.5) / 5, 0, 1);
      if (target > this.winded) this.winded = Math.min(target, this.winded + dt / 5);
    } else {
      this.winded = Math.max(0, this.winded - dt / (it.crouching ? 3 : 4.5));
    }
  }

  /* ================================================================ Zielfernrohr */

  _updateSway(dt, it, def, a) {
    const amp0 = def.scopeSway || 0;
    const G = this.G;
    const actor = this.actor;
    const input = G.input;
    let holding = false;
    const active = amp0 > 0 && a > 0.5 && !it.frozen && actor.alive !== false;
    if (active) {
      this._adsHeldT += dt;
      const touch = input && input.mode === 'touch';
      const want = it.holdBreath || (touch ? this._adsHeldT > 0.35 : !!(input && input.down('sprint')));
      holding = want && this.breath > 0 && this._exhausted <= 0;
    } else this._adsHeldT = 0;
    if (holding) {
      this.breath = Math.max(0, this.breath - dt / BREATH_HOLD);
      if (this.breath <= 0) { this._exhausted = EXHAUST; holding = false; G.events.emit('weapon:breath', { actor, on: false, exhausted: true }); }
    } else {
      if (this._exhausted > 0) this._exhausted -= dt;
      else this.breath = Math.min(1, this.breath + dt / BREATH_RECOVER);
    }
    if (holding !== this.holdingBreath) {
      this.holdingBreath = holding;
      if (holding || this.breath > 0) G.events.emit('weapon:breath', { actor, on: holding, exhausted: false });
    }
    const steady = holding ? 0.1 : this._exhausted > 0 ? 1.9 : 1;
    this._steady += (steady - this._steady) * damp(holding ? 7 : 2.5, dt);
    let amp = 0;
    if (active) {
      const sp = clamp((it.speed || 0) / MOVE_REF, 0, 1);
      amp = amp0 * a * this._steady * (1 + 0.9 * sp) * (it.crouching ? 0.72 : 1);
    }
    this._swayAmp = (this._swayAmp || 0) + (amp - (this._swayAmp || 0)) * damp(5, dt);
    this._swayT += dt * (this._exhausted > 0 ? 1.5 : 1);
    const t = this._swayT;
    const w = (Math.PI * 2) / 3.3;
    const A = this._swayAmp;
    let x = (Math.sin(w * t) + 0.18 * Math.sin(2.7 * t + 0.4)) * A;
    let y = (0.55 * Math.sin(2 * w * t + 0.6) + 0.12 * Math.sin(1.9 * t + 1.1)) * A;
    // Zielwandern im Anschlag (F2, handling.aimDrift): ruhiges Rauschen statt Achterfigur, nach dem Sprint
    // (Atemnot) und außer Atem deutlich stärker, geduckt ruhiger; Atem anhalten beruhigt es ebenfalls.
    // Touch: nur ein Drittel (verträgt sich sonst schlecht mit der Zielhilfe).
    const drift0 = weaponHandling(def).aimDrift || 0;
    let dAmp = 0;
    if (drift0 > 0 && !amp0 && a > 0.3 && !it.frozen && actor.alive !== false) {
      const sp = clamp((it.speed || 0) / MOVE_REF, 0, 1);
      dAmp = drift0 * smooth01((a - 0.3) / 0.7) * (1 + 2 * this.winded + (this._exhausted > 0 ? 1.5 : 0)) *
        (it.crouching ? 0.6 : 1) * (1 + 0.6 * sp) * (input && input.mode === 'touch' ? 0.35 : 1);
    }
    this._driftAmp = (this._driftAmp || 0) + (dAmp - (this._driftAmp || 0)) * damp(3, dt);
    if (this._driftAmp > 1e-7) {
      this._driftT += dt * (1 + 0.8 * this.winded);
      const u = this._driftT;
      x += (Math.sin(u * 0.53 + 0.3) * 0.55 + Math.sin(u * 1.27 + 2.1) * 0.3 + Math.sin(u * 2.9 + 0.7) * 0.15) * this._driftAmp;
      y += (Math.sin(u * 0.41 + 1.7) * 0.55 + Math.sin(u * 1.13 + 0.2) * 0.3 + Math.sin(u * 2.3 + 2.6) * 0.15) * this._driftAmp;
    }
    if (Number.isFinite(actor.yaw)) actor.yaw -= x - this._swayX;
    if (Number.isFinite(actor.pitch)) actor.pitch += y - this._swayY;
    this._swayX = x;
    this._swayY = y;
  }

  /* ================================================================ Verwaltung */

  /** Vom WeaponSystem beim Tod des Akteurs: gezogene Granate fällt (COD), alles andere bricht ab. */
  onDeath() {
    if (this._throw && this._throw.pinned && !this._throw.thrown) this._dropCookedGrenade();
    this._throw = null;
    this._melee = null;
    this._plate = null;
    this.isPlating = false;
    if (this._reload) this._finishReload(true);
    this._switch = null;
    this.cooking = false;
    this.cookTime = 0;
    this.fuseLeft = Infinity;
    this.isReloading = this.isSwitching = this.isMeleeing = this.isThrowing = this.isFiring = false;
    this.ads = this._adsOn = false;
    this.holdingBreath = false;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._reload = this._switch = this._melee = this._throw = null;
    if (this.viewModel) {
      try { this.viewModel.dispose(); } catch (err) { console.error('[NULLPUNKT] ViewModel.dispose:', err); }
      if (this.G.viewmodel && this.G.viewmodel.rig === this.viewModel) this.G.viewmodel.rig = null;
      this.viewModel = null;
    }
    if (this.system && this.system.controllers) this.system.controllers.delete(this);
  }
}
