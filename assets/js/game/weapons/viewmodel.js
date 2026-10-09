// NULLPUNKT – Ego-Ansicht (Viewmodel): Waffe + Handschuh-Arme mit prozeduraler Animation.
// Hüfte/Anschlag (Visier exakt in Bildmitte), Atmen, Blick-Nachlauf, Achter-Wippen beim Gehen/Sprinten,
// Ducken, Sprung/Landung, federgedämpfter Rückstoß, Mündungsfeuer + Licht, Hülsen, Nachladen (taktisch/leer,
// Patrone für Patrone, Gurt, Magazin oben), Repetieren, Ziehen/Wegstecken, Messer, Granatwurf, Inspizieren.
// Realismus (weapons-feel): Masse und Trägheit je Waffe (Nachlauf hinter der Kameradrehung, Bewegungsnachlauf,
// Fersenstoß, Atemnot), Haltung Standard ↔ Körperkamera, Wandkollision (anziehen → tiefe Bereitschaft),
// Rückstoß 2.0 (sichtbarer Stoß je Waffe + Hochklettern), Lehnen/freies Zielen/Überklettern (core), Hülsen und
// Magazine fallen in die Welt, Rauchfäden und Hitzeflimmern über heißen Läufen.
//
// API (Vertrag §7, Erweiterungen siehe docs/ARCHITECTURE.md Changelog):
//   new ViewModel(G)          G.viewmodel.{scene,camera} (werden angelegt, falls nicht vorhanden)
//   setWeapon(weaponId, def?) update(dt, s) onShot(strength?, info?) playReload(empty, variant?) playMelee(opts?)
//   playGrenade(type?, opts?) releaseGrenade() playInspect(variant?) playReady() playFidget() cancelAction()
//   getMuzzleWorldPosition(out) setVisible(bool) setLighting(lighting) showScopeOverlay warmup(renderer) dispose()
//   readout   letzte Munitions-Ablesung beim Inspizieren { kind, rounds, cap, chambered, reserve, seq } (ui/hud.js)
// Animationen 09.10. (anim/): Nachlade-Varianten mit Magazin entlang der Schachtachse (magwell.js, reloads.js), vier
// Inspektionen je Mechanik + Kammer-Patrone (inspects.js), Ziehen je Klasse, Bereitmachen, Gesten, Posen (moves.js).
import * as THREE from 'three';
import { createWeaponModel, setMagRounds } from './models.js';
import { WEAPONS, weaponHandling } from '../../shared/weapons.data.js';
import { Arms, gripTransform, getPose, mixPose, newPose, copyPose, PROP_SHAPES } from './gunsmith/arms.js';
import { ID_TO_MODEL, handlingFor, poseFor, KNIFE_MELEE, MELEE_STYLES } from './gunsmith/handling.js';
import { EXTRA_ACTIONS } from './gunsmith/actions2.js';
import { RELOAD_ACTIONS } from './anim/reloads.js';
import { INSPECT_ACTIONS } from './anim/inspects.js';
import { MOVE_ACTIONS, GRENADE_LOW } from './anim/moves.js';
import { COSMETIC } from './anim/reloads.js';
import { magWellOf } from './anim/magwell.js';
import { GunCollider, MultiCollider } from './gunsmith/contact.js';
import { applyCamo } from './gunsmith/camos.js';
import { CLASS_LOOKS, SKIN_TIERS, classLookId } from '../../shared/weapons.data.js';
import { MuzzleFlash, ShellPool, SmokeWisps, HeatHaze } from './gunsmith/fx.js';
import { SCHEMES, schemeForTeam } from '../bots/soldier/materials.js';
import { Spring, Spring3, curve, windowW, clamp, damp, smooth, easeOut, easeInOut, easeOutBack } from './gunsmith/anim.js';
import { camoMap, fabricNormal, tapeMap, watchFaceTexture, flashMap, smokeMap } from './gunsmith/textures.js';

const V3 = () => new THREE.Vector3();
const _v = V3(), _v2 = V3(), _v3 = V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _s1 = V3();
const _a3 = [0, 0, 0], _b3 = [0, 0, 0], _c3 = [0, 0, 0];
const ZERO3 = [0, 0, 0];
// Handanfragen, bei denen die Finger den Gegenstand umschließen (Kontaktlöser legt sie an die Oberfläche)
// 'ball' (Granate) fehlt absichtlich (hands-v3): die Ballhaltung ist schon an die Granatenkugel gelöst; „Greifen“ bog
// Ring-/Kleinfinger sonst gegen die Waffe statt gegen die Requisite bis zum Anschlag – durch die Granate (29 mm)
const GRIP_STYLES = new Set(['mag', 'magTop', 'under', 'flat', 'pump', 'post', 'pistol', 'pistolGrip', 'knife', 'wrap']);
// Erwärmung des Laufs je Schuss (0..1; Rauchfahne/Hitzeflimmern nach Feuerstößen), abklingend ≈ 0,12/s
const HEAT_PER_SHOT = { auto: 0.022, semi: 0.03, bolt: 0.08, pump: 0.07, pistol: 0.02 };

// Umgebungssonde fürs Viewmodel-Licht: Sonnen-Startpunkte im Kameraraum (Kopf, Waffe, Stützhand) und
// Himmelsrichtungen [x, y, z, Gewicht] (Zenit + Kranz in ~50° Höhe); Reihenfolge der Strahlen je Bild.
const PROBE_SUN_OFF = [[0, 0, 0], [0.2, -0.2, -0.2], [-0.16, -0.24, -0.2]];
const PROBE_SKY = [[0, 1, 0, 2], ...[0, 1, 2, 3, 4].map(i => {
  const a = i * Math.PI * 2 / 5 + 0.3, c = Math.cos(0.87), s = Math.sin(0.87);
  return [Math.cos(a) * c, s, Math.sin(a) * c, 1];
})];
const PROBE_SKY_W = PROBE_SKY.reduce((n, d) => n + d[3], 0);
const PROBE_SEQ = [0, 3, 1, 4, 2, 5, 6, 7, 8];
const _pv = new THREE.Vector3(), _pv2 = new THREE.Vector3();
let _e2q = null;

// Hand-Ziel: Position + Ausrichtung (Kameraraum) + Fingerpose
class HandTarget {
  constructor() { this.pos = V3(); this.quat = new THREE.Quaternion(); this.pose = newPose(); }
  copy(o) { this.pos.copy(o.pos); this.quat.copy(o.quat); copyPose(o.pose, this.pose); return this; }
  lerp(o, w) {
    if (w <= 0) return this;
    if (w >= 1) return this.copy(o);
    this.pos.lerp(o.pos, w); this.quat.slerp(o.quat, w); mixPose(this.pose, o.pose, w, this.pose);
    return this;
  }
}
function reqList() { return { n: 0, items: Array.from({ length: 6 }, () => ({})) }; }
// Handanfrage anhängen: { anchor, style, data } | { part, style, offset } | { free: [pos, F, B, pose] } (+ dy)
function req(list, w, o) {
  if (w <= 0 || list.n >= list.items.length) return;
  const r = list.items[list.n++];
  r.w = w; r.anchor = o.anchor || null; r.style = o.style || null; r.data = o.data || null;
  r.part = o.part || null; r.offset = o.offset || null; r.free = o.free || null; r.dy = o.dy || 0;
}

/**
 * Ärmel-Palette (5 Farben, siehe gunsmith/textures.js) aus dem Soldaten-Farbschema, das die Bots desselben
 * Teams auf dieser Karte tragen (schemeForTeam: helle Karten → dunklere Variante). FFA/kein Team: neutral.
 */
function sleeveCamo(schemeId) {
  const sc = schemeId ? SCHEMES[schemeId] : null;
  if (!sc || !Array.isArray(sc.camo) || sc.camo.length < 4) return 'neutral';
  const [base, dark, light, accent] = sc.camo;
  const deep = '#' + [1, 3, 5].map(i => Math.round(parseInt(dark.slice(i, i + 2), 16) * 0.72).toString(16).padStart(2, '0')).join('');
  return [base, dark, accent, deep, light];
}

/**
 * Ladebildschirm-Vorarbeit (core, G18): die einmaligen Texturen, die das erste `new ViewModel()` sonst in
 * einem Block erzeugt (Ärmel-Grundmuster + Tarnmuster des Teams je 512², Stoff-Normalen, Tape, Uhr,
 * Mündungsfeuer, Rauch), als einzelne Schritte. Texturen sind gecacht → das Viewmodel baut danach nur
 * noch Geometrie. team wie `G.player.team` ('A' | null = FFA), world für das Kartenschema.
 */
export function viewModelWarmupSteps({ team = 'A', world = null } = {}) {
  return [
    () => camoMap('arid'),
    () => camoMap(sleeveCamo(schemeForTeam(team, world) || null)),
    () => fabricNormal(),
    () => { tapeMap(); watchFaceTexture(); },
    () => { flashMap('star'); flashMap('side'); smokeMap(); },
  ];
}

function basis(F, B, out) {
  const z = _v.set(-F[0], -F[1], -F[2]).normalize();
  const y = _v2.set(B[0], B[1], B[2]);
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = _v3.crossVectors(y, z);
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}

export class ViewModel {
  constructor(G = {}) {
    this.G = G;
    if (!G.viewmodel) G.viewmodel = {};
    this.scene = G.viewmodel.scene || (G.viewmodel.scene = new THREE.Scene());
    this.camera = G.viewmodel.camera || (G.viewmodel.camera = new THREE.PerspectiveCamera(ViewModel.FOV, 16 / 9, 0.01, 20));
    this.showScopeOverlay = false;
    this.weaponId = null;
    this.def = null;
    this.onGrenadeRelease = null;   // optionaler Rückruf beim Loslassen der Granate
    this.onMeleeHit = null;         // optionaler Rückruf im Treffermoment des Messerhiebs

    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.scene.add(this.root);
    this.gun = new THREE.Group();
    this.gun.name = 'waffe';
    this.root.add(this.gun);
    // Ärmel im Tarnmuster des eigenen Teams (wie die Mitspieler-Bots); Jeder gegen jeden: neutral
    this._team = G.player ? G.player.team ?? null : 'A';
    this._scheme = schemeForTeam(this._team, G.world) || null;
    this.arms = new Arms({ camo: sleeveCamo(this._scheme), quality: G.renderer?.quality || 'high' });
    this.root.add(this.arms.group);

    // Licht (folgt der Weltbeleuchtung relativ zur Blickrichtung)
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.target.position.set(0, 0, 0);
    this.hemi = new THREE.HemisphereLight(0xc8d6ea, 0x4a4036, 0.9);
    this.rim = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    this.rim.position.set(-0.6, 0.4, -1);
    this.root.add(this.sun, this.sun.target, this.hemi, this.rim, this.rim.target);
    this.flash = new MuzzleFlash();
    this.root.add(this.flash.light);
    this.smoke = new SmokeWisps(8);
    this.root.add(this.smoke.group);
    this.shells = new ShellPool(14);
    this.root.add(this.shells.group);
    this.haze = new HeatHaze();
    this.root.add(this.haze.mesh);
    // Hülsen fliegen kurz im Viewmodel (vor der Waffe sichtbar) und landen dann als Welt-Hülsen auf dem Boden
    this.shells.onHandover = (type, pos, vel, q) => this._casingToWorld(type, pos, vel, q);
    this._lighting = null;
    this._ownEnv = null;
    // Sonne sichtbar / Himmel offen (0..1), siehe _updateProbe
    this._probe = { sun: 1, sky: 1, k: 0, reset: true, eye: V3(), last: V3(), sunHits: [1, 1, 1], skyHits: PROBE_SKY.map(() => 1) };
    // Qualitätsstufe: auf 'low' entfällt das Kantenlicht (ein Licht weniger je Pixel), Hülsen-Pool kleiner
    this._applyQuality(G.renderer?.quality || 'high');
    if (typeof G.renderer?.onQualityChange === 'function') this._offQuality = G.renderer.onQualityChange(q => this._applyQuality(q));

    // Requisiten in der Hand: Messer (für Nahkampf mit Schusswaffe), Granaten
    this.props = {
      knife: this._prop(createWeaponModel('knife', { lod: 'first' })),
      frag: this._prop(createWeaponModel('frag', { lod: 'first' })),
      semtex: this._prop(createWeaponModel('semtex', { lod: 'first' })),
      impact: this._prop(createWeaponModel('impact', { lod: 'first' })),
      molotov: this._prop(createWeaponModel('molotov', { lod: 'first' })),
      flash: this._prop(createWeaponModel('flash', { lod: 'first' })),
      smoke: this._prop(createWeaponModel('smoke', { lod: 'first' })),
      plate: this._prop(createWeaponModel('plate', { lod: 'first' })),
    };
    this._meleeKey = 'knife';
    this._meleeId = 'knife';
    this._camos = new Map();      // weaponId → Tarnmuster-Id
    this._accessories = [];
    this._lookId = null;
    this.setLook('standard');

    // Animationszustand
    this._models = new Map();
    this.cur = null;
    this._pending = null;
    this._equipT = 1; this._lowerT = 0; this._lowering = false;
    this.action = null;
    this._ads = 0; this._adsRaw = 0; this._sprint = 0; this._crouch = 0; this._move = 0; this._air = 0;
    this._phase = 0; this._time = 0; this._wasGround = true; this._airTime = 0;
    // Trägheit (F2): Nachlauf hinter der Kameradrehung (Gier/Nicken, rad), Bewegungsnachlauf (m), Federn je Masse
    this._lagYaw = new Spring(170, 16);
    this._lagPitch = new Spring(170, 16);
    this._moveLag = new Spring3(81, 13);
    this._strafeRoll = 0;
    this._lean = 0;
    this._obstruct = 0;
    this._obsPose = 'raise'; // Ausweichhaltung der laufenden Überblendung ('raise' | 'tuck')
    this._mantle = 0;
    this._breathPh = Math.random() * 6;
    this._stepIdx = 0;
    this._climb = 0;
    this._heat = 0;
    this._eyeQ = new THREE.Quaternion();
    // Haltung (F9): 0 = Standard (CoD-Mobile-Hüfte), 1 = Körperkamera; weich überblendet
    this.pose = this._wantPose();
    this._poseW = this.pose === 'bodycam' ? 1 : 0;
    this._recoilPos = new Spring3(210, 20);
    this._recoilRot = new Spring3(170, 17);
    this._land = new Spring(90, 11);
    this._jolt = new Spring3(260, 22);
    this._boltT = 1; this._slideLocked = false; this._hammerT = 1;
    this._ctrlReload = false;
    this._visible = true;
    this._vrOn = false; // VR (engine/xr): Wurzel in der Hand, siehe _xrRoot()
    this._shotCount = 0;
    this._led = 0;

    this._hR = new HandTarget(); this._hL = new HandTarget(); this._tmpT = new HandTarget();
    this._rootInv = new THREE.Matrix4();
    this._gunPos = V3(); this._gunRot = V3();
    this._mainQuat = new THREE.Quaternion();

    this.setLighting(G.world?.lighting || null);
  }

  // ---------------------------------------------------------------- Waffe

  _prop(model) {
    model.visible = false;
    model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    this.root.add(model);
    return model;
  }

  _defFor(id) {
    return this.G?.data?.WEAPONS?.[id] || WEAPONS[id] || null;
  }

  _getModel(id, key) {
    let entry = this._models.get(id);
    if (entry) return entry;
    const model = createWeaponModel(key, { lod: 'first' });
    model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    if (this._camos.get(id)) applyCamo(model, this._camos.get(id));
    const ud = model.userData;
    model.updateMatrixWorld(true);
    const rg = ud.rightHandGrip, trg = ud.anchors.trigger;
    if (rg && trg && !rg.userData.trigger) rg.userData.trigger = rg.worldToLocal(trg.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0, -0.0045)).toArray().map(v => Math.round(v * 1e4) / 1e4);   // Vorderseite des Abzugs
    const rest = new Map();
    for (const [n, p] of Object.entries(ud.parts)) rest.set(n, { pos: p.position.clone(), quat: p.quaternion.clone(), vis: p.visible });
    entry = { id, key, model, ud, rest };
    // Arbeitsstelle der Stützhand beim Nachladen (Modellraum, Ruhelage) für _frameWork
    const h0 = handlingFor(key), an = ud.anchors;
    const work = h0.reload === 'revolver' ? an.cylGrab : h0.reload === 'rocket' ? (an.rocketGrab || ud.muzzle) : h0.reload === 'shell' ? an.shellPort : (an.magGrab || ud.magazine);
    if (work) entry.workRest = model.worldToLocal(work.getWorldPosition(new THREE.Vector3()));
    // Kontaktgitter (hands): Hände legen sich an die echte Oberfläche statt in die Waffe (Arm.contact)
    try { entry.collider = new GunCollider(model); } catch (err) { console.warn('[gunsmith] Kontaktgitter', err); entry.collider = null; }
    entry.contactMemo = new Map();
    this._models.set(id, entry);
    this._prepareGrips(entry);
    magWellOf(entry);   // Schachtachse + Freigang vorab (anim/magwell.js, wenige ms je Modell)
    return entry;
  }

  // Alle Griffe einer Waffe vorab lösen (je ~2 ms, gecacht) – kein Ruckeln mitten im Nachladen
  _prepareGrips(entry) {
    const ud = entry.ud, h = handlingFor(entry.key), A = ud.anchors;
    const solve = (style, data, side) => { try { gripTransform(style, data || {}, side); } catch (err) { console.warn('[gunsmith] Griff', style, err); } };
    solve(h.action === 'knife' ? 'knife' : 'pistolGrip', ud.rightHandGrip?.userData, 1);
    if (h.leftGrip !== 'none' && ud.leftHandGrip) solve(ud.leftHandGrip.userData.style || h.leftGrip, ud.leftHandGrip.userData, -1);
    if (A.magGrab) solve(h.reload === 'top' ? 'magTop' : 'mag', A.magGrab.userData, -1);
    if (A.chargeGrab) {
      const st = A.chargeGrab.userData.style;
      if (st === 'release') solve('slapSide', null, -1);
      else solve(st === 'right' ? 'pinchRight' : 'pinchSide', null, st === 'right' ? 1 : -1);
    }
    if (A.boltGrab) solve('boltKnob', null, 1);
    if (h.reload === 'shell' || h.reload === 'belt') { solve('mag', null, -1); solve('pinchSide', null, -1); }
  }

  /** Waffe wechseln: Wegstecken der aktuellen, dann Ziehen der neuen. */
  setWeapon(weaponId, def) {
    if (!weaponId) return;
    const d = def || this._defFor(weaponId);
    if (this.cur && this.cur.id === weaponId && !this._pending) { this.def = d || this.def; return; }
    this._pending = { id: weaponId, def: d };
    if (!this.cur || this._equipT < 0.35) this._swapNow();
    else { this._lowering = true; this.action = null; }
  }

  _swapNow() {
    const { id, def } = this._pending;
    this._pending = null;
    this._lowering = false; this._lowerT = 0;
    const key = def?.model || ID_TO_MODEL[id] || id;
    const entry = this._getModel(id, key);
    if (this.cur) this.gun.remove(this.cur.model);
    this.cur = entry;
    this.def = def;
    this.weaponId = id;
    this.h = handlingFor(key);
    this.gun.add(entry.model);
    this._resetParts();
    const muzzle = entry.ud.muzzle;
    muzzle.add(this.flash.group);
    this.flash.hide();
    this.action = null;
    this._equipT = 0;
    this._equipDur = def?.equipTime ?? this.h.equipTime;
    this._slideLocked = false;
    this._boltLocked = false;
    this._boltT = 1;
    this.arms.right.shoulder.fromArray(this.h.shoulderR); this.arms.left.shoulder.fromArray(this.h.shoulderL);
    this.arms.right.pole.fromArray(this.h.poleR); this.arms.left.pole.fromArray(this.h.poleL);
    this._sightType = entry.ud.info.sight;
    this._scopeOverlay = def?.scope?.overlay || (this._sightType === 'sniper' ? 'sniper' : null);
  }

  _resetParts() {
    if (!this.cur) return;
    for (const [n, r] of this.cur.rest) {
      const p = this.cur.ud.parts[n];
      p.position.copy(r.pos); p.quaternion.copy(r.quat); p.visible = r.vis;
    }
  }

  // ---------------------------------------------------------------- Aktionen

  _start(type, dur, extra = {}) {
    this.action = { type, t: 0, dur: Math.max(0.05, dur), fade: 1, cancel: false, ...extra };
    return this.action;
  }

  /**
   * Nachladen starten. empty = Magazin leer (inkl. Durchladen). variant = optische Variante (Standard: zufällig, nie
   * zweimal dieselbe hintereinander – anim/reloads.js); Dauer und Munition bleiben die der Waffendaten.
   */
  playReload(empty = false, variant) {
    if (!this.cur || this.h.reload === 'none') return;
    const d = this.def;
    const style = this.h.reload;
    const v = this._pickVariant('reload:' + style + (empty ? ':leer' : ''), this._reloadVariants(style, empty), variant);
    if (style === 'shell') {
      const timing = d?.shellTiming || { start: 0.3, insert: 0.48, end: 0.42 };
      const mag = d?.mag ?? 6;
      this._start('shells', 1e9, { empty, timing, shells: empty ? mag : Math.max(1, Math.round(mag / 2)), phase: 'start', pt: 0, inserted: 0, variant: v });
      return;
    }
    const dur = empty ? (d?.reloadEmptyTime ?? this.h.emptyTime) : (d?.reloadTime ?? this.h.reloadTime);
    this._start('reload', dur, { empty, style, variant: v });
  }

  /**
   * Nahkampf. opts: { style ('slash'|'hook'|'chop'|'overhead'|'stab'|'backhand'), backstab, duration, variant } – Standard
   * aus der Nahkampfwaffe. Optische Varianten (zufällig, Treffermoment gleich): mit Schusswaffe 0 = Hieb der Klinge,
   * 1 = Stich, 2 = Stoß mit der Waffe selbst; Messer als Hauptwaffe 0 = Hieb der Klinge, 1 = Rückhand, 2 = Stich.
   */
  playMelee(opts = {}) {
    if (!this.cur) return;
    const knife = this.h.action === 'knife';
    const md = knife ? this.def : this._defFor(this._meleeId);
    const spec = md?.melee || WEAPONS.knife?.melee || {};
    const dur = opts.duration ?? spec.swingTime ?? 0.75;
    const v = opts.backstab || opts.style ? 0 : this._pickVariant(knife ? 'slash' : 'melee', 3, opts.variant);
    let style = opts.backstab ? 'stab' : opts.style || spec.style || 'slash';
    if (v === 1) style = knife ? 'backhand' : 'stab';
    else if (v === 2 && knife) style = 'stab';
    const type = knife ? 'slash' : v === 2 ? 'strike' : 'melee';
    this._start(type, dur, { hit: false, style, variant: v });
  }

  /** Nahkampfwaffe für Hiebe mit Schusswaffe in der Hand (Requisit der linken Hand). */
  setMelee(weaponId) {
    const d = this._defFor(weaponId);
    if (!d || d.cls !== 'melee') return;
    this._meleeId = weaponId;
    const key = d.model || ID_TO_MODEL[weaponId] || 'knife';
    if (key === this._meleeKey) return;
    const old = this.props.knife;
    old.removeFromParent();
    this.props.knife = this._prop(createWeaponModel(key, { lod: 'first' }));
    if (this._camos.get(weaponId)) applyCamo(this.props.knife, this._camos.get(weaponId));
    this._meleeKey = key;
  }

  /** Tarnmuster einer Waffe setzen (gilt für vorhandene und spätere Modelle; null/'werk' = Werkszustand). */
  setCamo(weaponId, camoId) {
    if (!weaponId) return;
    this._camos.set(weaponId, camoId || null);
    const e = this._models.get(weaponId);
    if (e) applyCamo(e.model, camoId || null);
    if (weaponId === this._meleeId) applyCamo(this.props.knife, camoId || null);
  }

  /**
   * Klassen-Aussehen der Arme (CLASS_LOOKS: Handschuhfarbe, Ärmeltönung/-muster, Zubehör wie Rotkreuz-Binde).
   * id = Klassen-/Look-Id (sturm, sanitaeter, pionier, aufklaerer, unterstuetzung; Aliasse englisch) oder 'standard';
   * tier = Outfit-Stufe (SKIN_TIERS: standard | veteran | elite, aus loadout.skin 'klasse:stufe').
   */
  setLook(id, tier = 'standard') {
    const lookId = classLookId(id);
    const look = CLASS_LOOKS[lookId] || CLASS_LOOKS.standard;
    const T = SKIN_TIERS[tier] || SKIN_TIERS.standard;
    const m = this.arms.mats;
    this.arms.setGlove(T.glove || look.glove || '#ffffff');   // taktischer Mittelton (nie fast schwarz), siehe arms.js gloveTone
    m.sleeve.color.set(T.sleeve || look.sleeve || '#ffffff');
    this.arms.setCamo(look.sleeveCamo || sleeveCamo(this._scheme));
    const key = lookId + ':' + (T.id || 'standard');
    if (key === this._lookKey) return;
    this._lookKey = key;
    this._lookId = lookId;
    for (const a of this._accessories) { a.removeFromParent(); a.geometry.dispose(); }
    this._accessories.length = 0;
    const ring = (arm, part, z, r, len, mat) => {
      const g = new THREE.CylinderGeometry(r, r, len, 18, 1, true);
      g.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.z = z;
      // hands-v3: dem ovalen Ärmelprofil folgen (Außenmaß + Faltenhöhe), statt kreisrund abzustehen
      const fit = arm[part].geometry.userData.fit?.(z);
      if (fit) mesh.scale.set((fit.rx + 0.0045) / r, (fit.ry + 0.0045) / r, 1);
      mesh.frustumCulled = false;
      arm[part].add(mesh);
      this._accessories.push(mesh);
    };
    const M = accessoryMats();
    if (look.accessory === 'armband') ring(this.arms.left, 'upper', -0.16, 0.0585, 0.06, M.armband);
    else if (look.accessory === 'cuffs') { ring(this.arms.left, 'fore', -0.215, 0.0405, 0.05, M.leather); ring(this.arms.right, 'fore', -0.215, 0.0405, 0.05, M.leather); }
    else if (look.accessory === 'wraps') { for (const z of [-0.1, -0.16]) ring(this.arms.left, 'fore', z, 0.046, 0.022, M.wrap); ring(this.arms.right, 'fore', -0.12, 0.046, 0.026, M.wrap); }
    else if (look.accessory === 'pads') ring(this.arms.left, 'fore', -0.222, 0.039, 0.03, M.band);
    if (T.extra === 'wrap') ring(this.arms.right, 'fore', -0.2, 0.0425, 0.034, M.leather);
    else if (T.extra === 'gold') { ring(this.arms.right, 'fore', -0.226, 0.0372, 0.008, M.gold); ring(this.arms.left, 'fore', -0.226, 0.0372, 0.008, M.gold); }
  }

  /** Granatwurf. type: 'frag' | 'semtex'. opts.hold = true hält nach dem Abziehen (Vorkochen) bis releaseGrenade(). */
  playGrenade(type = 'frag', opts = {}) {
    if (!this.cur) return;
    // Variante: über Kopf (0) bzw. von unten (1) – aus der Hocke/im Liegen automatisch von unten (anim/moves.js)
    const low = opts.variant != null ? opts.variant === 1 : this._crouch > 0.5 || (this._prone || 0) > 0.4;
    this._start('grenade', 1.0, { gtype: this.props[type] ? type : 'frag', hold: !!opts.hold, released: false, low, variant: low ? 1 : 0 });
  }

  releaseGrenade() { if (this.action?.type === 'grenade') this.action.hold = false; }

  /** Schutzplatte einsetzen (Rüstung): Dauer in s (Standard 1,6). Bricht laufende Aktionen ab. */
  playPlate(duration = 1.6) {
    if (!this.cur) return;
    this._start('plate', duration, { seated: false });
  }

  /** Laufende Aktion weich abbrechen (z. B. Nachladen beim Waffenwechsel). */
  cancelAction() {
    if (this.action && !this.action.cancel) { this.action.cancel = true; }
  }

  // Kosmetische Aktionen (Bereitmachen, Leerlauf-Geste) blockieren nichts (anim/moves.js)
  get isBusy() { return (!!this.action && !COSMETIC.has(this.action.type)) || this._equipT < 1 || this._lowering; }
  get actionName() { return this.action ? this.action.type : null; }

  /**
   * Schuss: Rückstoß, Mündungsfeuer, Verschluss/Schlitten, Hülse, ggf. Repetieren.
   * info: { empty, suppressed, visual (Stärke des sichtbaren Stoßes, def.recoil.visual × Aufsätze),
   *         yaw (tatsächlicher seitlicher Zielrückstoß dieses Schusses, rad – der Stoß folgt seiner Richtung) }
   * Rückstoß 2.0 (F7): schneller Federstoß (Rückwärts, Hochschlag, Mündung kippt, Rollen) mit Federn je Masse,
   * dazu ein langsames Hochklettern im Dauerfeuer, das sich nach dem Feuerstoß setzt. Im Anschlag bleibt
   * vor allem der Rückwärtsstoß (Visierbild springt und kehrt zurück), Kippen und Klettern sind gedämpft.
   */
  onShot(strength = 1, info = {}) {
    if (!this.cur) return;
    const h = this.h, k = h.kick, ads = this._ads;
    if (h.action === 'knife') { this.playMelee(); return; }
    const vis = Number.isFinite(info.visual) ? clamp(info.visual, 0, 3) : 1;
    // Stärke je Klasse (Controller: Scharfschütze 2,2, Schrot 2,0 …) gedämpft, sonst überschlagen schwere Waffen
    const adsMul = 1 - 0.45 * ads, s = Math.pow(Math.max(0, strength), 0.6) * vis;
    const rnd = (Math.random() - 0.5) * 2;
    // Seitlicher Stoß in Richtung des Zielrückstoßes (sonst zufällig); kleiner Zufallsanteil bleibt
    const side = Number.isFinite(info.yaw) && Math.abs(info.yaw) > 1e-6 ? Math.sign(info.yaw) * (0.55 + 0.45 * Math.random()) : rnd;
    // Gewünschte Ausschläge (m, rad) → Anfangsgeschwindigkeit der Federn (Spitze ≈ 0,478·v₀/ω bei ζ ≈ 0,65).
    // Schwerere Waffen bewegen sich weniger und langsamer (ω sinkt mit der Masse, siehe update()).
    const massK = Math.sqrt(clamp(this._handlingData().mass, 0.3, 12) / 3.3);
    const mk = Math.pow(1 / massK, 0.35);
    const wP = 14.5 / Math.sqrt(massK), wR = 13 / Math.sqrt(massK);
    const toV = (peak, w) => (peak * w) / 0.478;
    const back = k.back * 0.4 * s * mk;                         // z. B. M-17 ≈ 10 mm, Bulldog ≈ 26 mm
    const lift = k.up * 0.08 * s * mk * (1 - 0.5 * ads);
    const up = (k.up + k.kickRot) * 0.43 * s * mk * (1 - 0.65 * ads);   // Mündung kippt: M-17 ≈ 1,6°, Adler ≈ 6°
    this._recoilPos.kick(toV(side * k.side * 0.25 * s * mk * adsMul, wP), toV(lift, wP), toV(back, wP));
    this._recoilRot.kick(toV(up, wR), toV(-side * k.side * 0.6 * s * mk * (1 - 0.6 * ads), wR), toV(rnd * k.roll * 0.3 * s * mk * (1 - 0.6 * ads), wR));
    this._climb = Math.min(0.09, this._climb + k.up * 0.22 * s * (0.4 + 0.6 * Math.max(0.5, this._motionScale())));
    this._heat = Math.min(1, this._heat + (h.heat ?? HEAT_PER_SHOT[h.action] ?? 0.02));
    this._shotCount++;
    const suppressed = info.suppressed ?? this.def?.suppressed;
    if (!this.showScopeOverlay) this.flash.fire(h.flash, h.flashLen, { suppressed });
    if (!suppressed) {
      this.cur.ud.muzzle.getWorldPosition(_v);
      this.root.worldToLocal(_v);
      _v2.set(0, 0.2, -1).applyQuaternion(this.gun.quaternion);
      this.smoke.puff(_v, _v2, h.flash > 1.2 ? 1.2 : 0.8);
    }
    this._boltT = 0;
    this._hammerT = 0;
    if (info.empty && h.action === 'pistol') this._slideLocked = true;
    if (h.action === 'revolver') this._cylTarget = (this._cylTarget || 0) + Math.PI / 3;
    if (info.empty && (h.action === 'auto' || h.action === 'semi')) this._boltLocked = true;
    if (h.action === 'bolt') this._start('boltCycle', Math.max(0.6, Math.min(1.0, (this.def ? 60 / this.def.rpm : 1.3) - 0.35)), { delay: 0.12, ejected: false, variant: this._pickVariant('bolt', 2) });
    else if (h.action === 'pump') this._start('pumpCycle', Math.max(0.42, Math.min(0.6, (this.def ? 60 / this.def.rpm : 0.8) - 0.25)), { delay: 0.1, ejected: false });
    else this._eject();
  }

  _eject() {
    const ej = this.cur?.ud.ejection;
    if (!ej || this.h.shell === 'none') return;
    ej.updateWorldMatrix(true, false);
    ej.getWorldPosition(_v);
    this.root.worldToLocal(_v);
    // Auswurfrichtung = lokale +X des Ankers, dazu nach oben/hinten, im Kameraraum
    ej.getWorldQuaternion(_q);
    this.root.getWorldQuaternion(_q2);
    _q.premultiply(_q2.invert());
    _v2.set(1, 0, 0).applyQuaternion(_q);
    const up = this.h.shell === 'pistol' ? 1.4 : 1.1;
    _v3.copy(_v2).multiplyScalar(1.5 + Math.random() * 0.7).add(_s1.set(0, up + Math.random() * 0.6, 0.35 + Math.random() * 0.4));
    // Übergabe an die Welt, sobald die Hülse die Waffe verlassen hat (ohne Effekte/Welt: bleibt im Viewmodel)
    const world = this._worldFx() ? 0.1 + Math.random() * 0.05 : Infinity;
    this.shells.spawn(this.h.shell, _v, _v3, _q, world);
  }

  /** Effekte der Welt (Hülsen/Magazine) vorhanden? */
  _worldFx() {
    const fx = this.G?.effects;
    return !!(fx && typeof fx.dropCasing === 'function' && this.G.camera && this.G.world);
  }

  /**
   * Punkt im Viewmodel-Raum (Wurzel = Viewmodel-Kamera) → Weltpunkt der Hauptszene mit gleicher Bildposition
   * und Tiefe (wie getMuzzleWorldPosition). Richtungen drehen nur mit der Hauptkamera.
   */
  _vmToWorld(local, out) {
    const main = this.G.camera, vm = this.camera;
    _pv.copy(local);
    this.root.localToWorld(_pv);
    if (this._vrOn) return out.copy(_pv); // VR: die Wurzel liegt schon in Weltkoordinaten
    _pv.applyMatrix4(vm.matrixWorldInverse);
    const depth = Math.max(0.05, -_pv.z);
    _pv.applyMatrix4(vm.projectionMatrix);
    const tan = Math.tan(THREE.MathUtils.degToRad(main.fov) / 2) / (main.zoom || 1);
    return out.set(_pv.x * depth * tan * main.aspect, _pv.y * depth * tan, -depth).applyMatrix4(main.matrixWorld);
  }

  _casingToWorld(type, pos, vel, q) {
    const fx = this.G?.effects, main = this.G?.camera;
    if (!fx || !main || typeof fx.dropCasing !== 'function') return;
    const wp = this._vmToWorld(pos, _pv2.set(0, 0, 0));
    if (this._vrOn) this.root.getWorldQuaternion(_q); else main.getWorldQuaternion(_q);
    const wv = _s1.copy(vel).applyQuaternion(_q);
    const bv = this.G.player?.body?.velocity;
    if (bv) wv.add(bv);
    _q2.copy(_q).multiply(q);
    try { fx.dropCasing(type, wp.clone(), wv.clone(), _q2.clone(), { actor: this.G.player || null }); } catch { /* Welt im Abbau */ }
  }

  /**
   * Magazin fällt (Nachladen): Weltmagazin an der Stelle des Viewmodel-Magazins, mit der Bewegung des Spielers.
   * Das Viewmodel-Magazin wird bis zum Einsetzen des neuen ausgeblendet (siehe _actReload*).
   */
  _dropMag() {
    if (!this._worldFx() || typeof this.G.effects.dropMagazine !== 'function' || !this.cur) return;
    const part = this._part('mag') || (this.h.reload === 'belt' ? this._part('belt') : null);
    if (!part) return;
    part.updateWorldMatrix(true, false);
    part.getWorldPosition(_v);
    this.root.worldToLocal(_v);
    const wp = this._vmToWorld(_v, _pv2.set(0, 0, 0)).clone();
    const main = this.G.camera;
    if (this._vrOn) this.root.getWorldQuaternion(_q); else main.getWorldQuaternion(_q);
    const wv = _s1.set((Math.random() - 0.5) * 0.4, -0.9 - Math.random() * 0.3, 0.1).applyQuaternion(_q);
    const bv = this.G.player?.body?.velocity;
    if (bv) wv.add(bv);
    part.getWorldQuaternion(_q2);
    this.root.getWorldQuaternion(_e2q || (_e2q = new THREE.Quaternion()));
    _q2.premultiply(_e2q.invert()).premultiply(_q);
    // Weltmagazin mit dem alten Füllstand (leer bleibt leer, angebrochen zeigt die obersten Patronen)
    try { this.G.effects.dropMagazine(this.cur.key, wp, wv.clone(), _q2.clone(), { actor: this.G.player || null, rounds: this._magRaw ?? 0 }); } catch { /* Welt im Abbau */ }
  }

  // ---------------------------------------------------------------- Licht

  /** Weltlicht übernehmen (late binding, wenn G.world beim Erzeugen noch fehlte). */
  setLighting(lighting) {
    this._lighting = lighting || null;
    const L = lighting;
    if (L) {
      this.sun.color.copy(L.sunColor ?? new THREE.Color(0xfff1dc));
      this.hemi.color.copy(L.hemiSky ?? new THREE.Color(0xc8d6ea));
      this.hemi.groundColor.copy(L.hemiGround ?? new THREE.Color(0x4a4036));
      this.scene.environment = L.envMap || this._ownEnv || null;
      this._sunDir = (L.sunDirection ? L.sunDirection.clone() : new THREE.Vector3(0.4, 0.8, 0.3)).normalize();
      if (this._sunDir.y < 0) this._sunDir.negate();
    } else {
      this.sun.color.set(0xfff1dc);
      this.hemi.color.set(0xc8d6ea); this.hemi.groundColor.set(0x4a4036);
      this._sunDir = new THREE.Vector3(0.5, 0.75, 0.35).normalize();
      this._ensureOwnEnv();
    }
    // Neue Karte/Beleuchtung: Sonde beim nächsten Bild sofort vollständig messen
    this._probe.reset = true;
    this._applyIntensities();
    this._syncCamo();
  }

  /** Ärmel-Tarnung an Team + Karte angleichen (wie die Bots desselben Teams); ohne Spieler (Waffenlabor) Team A. */
  _syncCamo() {
    const player = this.G?.player;
    this._team = player ? player.team ?? null : 'A';
    const scheme = schemeForTeam(this._team, this.G?.world) || null;
    if (scheme === this._scheme) return;
    this._scheme = scheme;
    this.arms.setCamo(CLASS_LOOKS[this._lookId]?.sleeveCamo || sleeveCamo(scheme));
  }

  /**
   * Intensitäten aus der Weltbeleuchtung × Umgebungssonde. Grundwerte werden jedes Bild aus
   * world.lighting gelesen, damit Anpassungen der Kartenbeleuchtung sofort ankommen.
   */
  _applyIntensities() {
    const L = this._lighting, pr = this._probe;
    const sunBase = L ? (L.sunIntensity ?? 2.5) * 0.85 : 2.3;
    const hemiBase = L ? (L.hemiIntensity ?? 0.9) * 1.1 : 1.0;
    const envBase = L ? (L.envIntensity ?? 0.8) * 1.05 : 0.9;
    // Im Schatten bleibt nur ein Rest Streulicht der Sonne; drinnen (Himmel verdeckt) wird das
    // Himmels-/Umgebungslicht ähnlich stark gedämpft wie das gebackene Innenraumlicht der Karte.
    this.sun.intensity = sunBase * (0.07 + 0.93 * pr.sun);
    // atmosphere-weather: mit Sonden-Gitter (world.probes) Himmelssicht + Rückprall an der Augenposition wie die
    // Welt (V ≈ 0,05–0,2 in Hallen) → Waffe/Arme dunkeln drinnen natürlich ab; Untergrenzen 0,16 (Himmel) bzw.
    // 0,22 (Umgebung/Glanz). Draußen (V ≈ 1) unverändert – der Glanz der Waffe bleibt.
    const W = this.G?.world;
    const g = W?.probes && pr.eye && this._lighting ? W.probes.light(pr.eye.x, pr.eye.y, pr.eye.z, this._gridLight || (this._gridLight = { sky: 1, sun: 1, bounce: [0, 0, 0] })) : null;
    if (g && Number.isFinite(g.sky)) {
      const sky = Math.min(1, Math.max(0, g.sky) * 1.1);
      const b = g.bounce ? (g.bounce[0] + g.bounce[1] + g.bounce[2]) / 3 : 0;
      const fill = Math.min(0.35, b * sunBase * 0.6); // Sonnenrückprall hellt drinnen auf (Fenster, Tore)
      this.hemi.intensity = hemiBase * (0.16 + 0.84 * sky) + fill;
      this.scene.environmentIntensity = envBase * (0.22 + 0.78 * sky) + fill * 0.5;
      this.rim.intensity = 0.6 * (0.3 + 0.7 * sky);
      return;
    }
    this.hemi.intensity = hemiBase * (0.5 + 0.5 * pr.sky);
    this.scene.environmentIntensity = envBase * (0.42 + 0.58 * pr.sky);
    this.rim.intensity = 0.6 * (0.45 + 0.55 * pr.sky);
  }

  /**
   * Umgebungssonde: Sonne sichtbar? Himmel offen? Je Bild höchstens ein Strahl gegen die Kugel-BVH
   * (world.lineOfSight), reihum über 3 Sonnen- und 6 Himmelsrichtungen; Ergebnis weich geglättet.
   * Bei Sprüngen der Kamera (Respawn, Teleport) wird sofort vollständig gemessen.
   */
  _updateProbe(dt, cam) {
    const pr = this._probe;
    const W = this.G?.world;
    if (!this._lighting || !W || typeof W.lineOfSight !== 'function' || !cam) {
      pr.sun = pr.sky = 1;
      pr.reset = true;
      return;
    }
    cam.getWorldPosition(pr.eye);
    const jump = pr.reset || pr.eye.distanceToSquared(pr.last) > 4;
    pr.last.copy(pr.eye);
    const n = PROBE_SEQ.length;
    if (jump) {
      for (let i = 0; i < n; i++) this._probeSample(W, PROBE_SEQ[i]);
      pr.reset = false;
    } else {
      this._probeSample(W, PROBE_SEQ[pr.k]);
      pr.k = (pr.k + 1) % n;
    }
    let sun = 0, sky = 0;
    for (let i = 0; i < 3; i++) sun += pr.sunHits[i];
    for (let i = 0; i < PROBE_SKY.length; i++) sky += pr.skyHits[i] * PROBE_SKY[i][3];
    sun /= 3;
    sky /= PROBE_SKY_W;
    if (jump) { pr.sun = sun; pr.sky = sky; return; }
    pr.sun += (sun - pr.sun) * (1 - Math.exp(-6 * dt));
    pr.sky += (sky - pr.sky) * (1 - Math.exp(-3 * dt));
  }

  _probeSample(W, idx) {
    const pr = this._probe;
    const o = _pv.copy(pr.eye);
    if (idx < 3) {
      // Sonnenstrahlen von Kopf, Waffe (rechts unten) und Stützhand (links unten): weicher Halbschatten
      o.add(_pv2.fromArray(PROBE_SUN_OFF[idx]).applyQuaternion(this._mainQuat));
      _pv2.copy(o).addScaledVector(this._sunDir, 150);
      pr.sunHits[idx] = W.lineOfSight(o, _pv2) ? 1 : 0;
    } else {
      const d = PROBE_SKY[idx - 3];
      _pv2.set(o.x + d[0] * 24, o.y + d[1] * 24, o.z + d[2] * 24);
      pr.skyHits[idx - 3] = W.lineOfSight(o, _pv2) ? 1 : 0;
    }
  }

  _applyQuality(q) {
    this.quality = q;
    this.arms?.setQuality?.(q);   // Handschuh-/Ärmeltexturen 256² (low) … 1024² (high/ultra)
    this.rim.visible = q !== 'low';
    this.shells.limit = q === 'low' ? 6 : 14;
    // Hitzeflimmern nur auf high/ultra (Bildkopie + ein Billboard)
    if (this.haze) this.haze.enabled = q === 'high' || q === 'ultra';
  }

  _ensureOwnEnv() {
    if (this._lighting?.envMap) return;
    if (this._ownEnv) { this.scene.environment = this._ownEnv; return; }
    const r = this.G?.renderer?.renderer || (this.G?.renderer?.isWebGLRenderer ? this.G.renderer : null);
    if (!r) return;
    // Neutrale Studio-Umgebung (einmalig), falls die Welt keine liefert
    import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      if (this._disposed || this._ownEnv || this._lighting?.envMap) return;
      const pmrem = new THREE.PMREMGenerator(r);
      const env = new RoomEnvironment();
      this._ownEnv = pmrem.fromScene(env, 0.04).texture;
      env.dispose?.();
      pmrem.dispose();
      if (!this._lighting?.envMap) this.scene.environment = this._ownEnv;
    }).catch(() => {});
  }

  _updateLights(dt) {
    // Hauptkamera-Drehung → Licht-/Umgebungsrichtung im Kameraraum (VR: die Wurzel liegt in Weltkoordinaten in der
    // Hand – Lichter relativ zur Wurzel drehen, Umgebung ohne Drehung)
    const cam = this.G?.camera;
    const q = this._mainQuat;
    const vr = this._vrOn;
    if (vr) this.root.getWorldQuaternion(q);
    else if (cam) cam.getWorldQuaternion(q); else q.identity();
    // Schatten/Innenraum: Licht der Umgebung folgen (sonst wirken Arme und Waffe wie aufgeklebt)
    this._updateProbe(dt, cam);
    this._applyIntensities();
    const inv = _q.copy(q).invert();
    _v.copy(this._sunDir).applyQuaternion(inv);
    this.sun.position.copy(_v).multiplyScalar(5);
    this.hemi.position.set(0, 1, 0).applyQuaternion(inv);
    if (this.scene.environment) {
      if (vr) this.scene.environmentRotation.set(0, 0, 0);
      else {
        _e.setFromQuaternion(q, 'XYZ');
        this.scene.environmentRotation.set(-_e.x, -_e.y, -_e.z, 'XYZ');
      }
    }
  }

  // ---------------------------------------------------------------- VR (engine/xr)

  /** VR aktiv und Haupthand verfolgt: Wurzel = Griff (Position) + Zielstrahl (Drehung) in Weltkoordinaten. */
  _xrRoot() {
    const xr = this.G?.xr;
    this._vrOn = !!(xr && xr.presenting && typeof xr.gunPose === 'function' && xr.gunPose(this.root.position, this.root.quaternion));
    return this._vrOn;
  }

  /** Lage des Pistolengriffs (rightHandGrip) im Raum der Waffengruppe – je Modell einmal. */
  _gripOffset(entry) {
    if (entry.xrGrip) return entry.xrGrip;
    const out = new THREE.Vector3();
    const rg = entry.ud.rightHandGrip;
    if (rg) {
      const m = new THREE.Matrix4();
      for (let o = rg; o && o !== this.gun; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
      out.setFromMatrixPosition(m);
    }
    entry.xrGrip = out;
    return out;
  }

  /**
   * VR-Pose der Waffe (Kameraraum = Raum der Hand): Pistolengriff in der Handfläche, Lauf entlang des Zielstrahls.
   * Rückstoß (Federn + Hochklettern), Ziehen/Wegstecken (halb so weit) und Aktionen (Nachladen, Nahkampf …) bleiben.
   */
  _xrGunPose(P, R, rp, rr, act, eq) {
    const g = this._gripOffset(this.cur);
    P.set(-g.x, -g.y, -g.z);
    R.set(0, 0, 0);
    P.x += rp.x; P.y += rp.y; P.z += rp.z + this._climb * 0.03;
    R.x += rr.x + this._climb * 0.5; R.y += rr.y; R.z += rr.z;
    if (eq > 0) { P.y -= 0.12 * eq; P.z += 0.04 * eq; R.x -= 0.6 * eq; R.z += 0.3 * eq; }
    if (act) { P.x += act.p[0]; P.y += act.p[1]; P.z += act.p[2]; R.x += act.r[0]; R.y += act.r[1]; R.z += act.r[2]; }
  }

  /** VR, Simulation steht (Pause, Matchende): Waffe der Hand nachführen, ohne Animationen fortzuschreiben. */
  syncXr() {
    if (!this.cur || !this._xrRoot()) return;
    this.root.updateMatrixWorld(true);
    this._rootInv.copy(this.root.matrixWorld).invert();
  }

  // ---------------------------------------------------------------- Haltung, Handhabung, Komfort

  /** Waffengefühl der aktuellen Waffe (Masse, Trägheit, Ausschlag; weapons.data.js), je Definition gecacht. */
  _handlingData() {
    const d = this.def;
    if (this._hdDef !== d || !this._hd) { this._hdDef = d; this._hd = weaponHandling(d || { cls: this.h?.action === 'pistol' ? 'pistol' : 'ar' }); }
    return this._hd;
  }

  /** Bewegungsfaktor 0..1: Einstellung „Waffenträgheit“ (weaponSway), bei „Bewegung reduzieren“ höchstens 0,35. */
  _motionScale() {
    const st = this.G?.settings;
    let k = st && typeof st.get === 'function' ? st.get('weaponSway') : undefined;
    k = Number.isFinite(k) ? clamp(k, 0, 1) : 1;
    let reduced = !!(st && typeof st.get === 'function' && st.get('reducedMotion'));
    if (!reduced && typeof matchMedia === 'function') {
      if (!this._rmq) { try { this._rmq = matchMedia('(prefers-reduced-motion: reduce)'); } catch { this._rmq = { matches: false }; } }
      reduced = !!this._rmq.matches;
    }
    return reduced ? Math.min(k, 0.35) : k;
  }

  /**
   * Gewünschte Haltung aus der Einstellung „Waffenhaltung“ (weaponPose): 'standard' | 'bodycam' | 'auto'
   * (auto: Körperkamera mit Maus/Controller, CoD-Mobile-Hüfte auf Touch). setPose() überschreibt (Waffenlabor).
   */
  _wantPose() {
    if (this._forcedPose) return this._forcedPose;
    const st = this.G?.settings;
    const v = st && typeof st.get === 'function' ? st.get('weaponPose') : undefined;
    if (v === 'standard' || v === 'bodycam') return v;
    if (v === 'auto') return this.G?.input?.mode === 'touch' ? 'standard' : 'bodycam';
    return 'standard';
  }

  /**
   * Einstellung „Waffe an Wänden und Hindernissen“ (weaponObstruction): 'overlay' (Standard: Waffe bleibt in Haltung,
   * über der Welt gezeichnet) | 'raise' (hochnehmen) | 'tuck' (an den Körper ziehen) | 'clip' (keine Anpassung, gegen
   * die Welttiefe gezeichnet – renderer). setObstruction() überschreibt (Prüfseiten).
   */
  _obstructionMode() {
    if (this._forcedObstruction) return this._forcedObstruction;
    const st = this.G?.settings;
    const v = st && typeof st.get === 'function' ? st.get('weaponObstruction') : undefined;
    return v === 'raise' || v === 'tuck' || v === 'clip' ? v : 'overlay';
  }

  /** Verhalten an Hindernissen erzwingen ('overlay' | 'raise' | 'tuck' | 'clip' | null = Einstellung). */
  setObstruction(mode) {
    this._forcedObstruction = mode === 'overlay' || mode === 'raise' || mode === 'tuck' || mode === 'clip' ? mode : null;
  }

  /** Haltung erzwingen ('standard' | 'bodycam' | null = Einstellung). instant = ohne Überblendung. */
  setPose(pose, instant = true) {
    this._forcedPose = pose === 'standard' || pose === 'bodycam' ? pose : null;
    this.pose = this._wantPose();
    if (instant) this._poseW = this.pose === 'bodycam' ? 1 : 0;
  }

  /** Haltungsdaten der aktuellen Waffe, zwischen Standard und Körperkamera nach _poseW überblendet. */
  _blendPose() {
    const key = this.cur.key;
    const std = poseFor(key, 'standard');
    const w = this.h.action === 'knife' ? 0 : this._poseW;
    if (w <= 1e-3) return std;
    const bc = poseFor(key, 'bodycam');
    if (w >= 0.999) return bc;
    const o = this._poseMix || (this._poseMix = { hip: [0, 0, 0], hipRot: [0, 0, 0], sprintPos: [0, 0, 0], sprintRot: [0, 0, 0], crouchPos: [0, 0, 0], crouchRot: [0, 0, 0] });
    for (const f in o) for (let i = 0; i < 3; i++) o[f][i] = std[f][i] + (bc[f][i] - std[f][i]) * w;
    return o;
  }

  // ---------------------------------------------------------------- Hauptschleife

  update(dt, s = {}) {
    this._magNow = s.mag ?? 1;
    this._magRaw = typeof s.mag === 'number' ? s.mag : null;   // Magazininhalt (ohne Controller: voll)
    const player = this.G?.player;
    if (player && (player.team ?? null) !== this._team) this._syncCamo();
    if (!this.G?.world?.lighting && !this._lighting) this._ensureOwnEnv();
    else if (this.G?.world?.lighting && this.G.world.lighting !== this._lighting) this.setLighting(this.G.world.lighting);
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    this._time += dt;
    // Wurzel folgt der Viewmodel-Kamera – in VR (engine/xr) dem Griff der Haupthand (Welt, Lauf entlang des Zielstrahls)
    const vr = this._xrRoot();
    if (!vr) {
      this.camera.updateMatrixWorld();
      this.camera.matrixWorld.decompose(this.root.position, this.root.quaternion, _s1);
    }
    if (vr !== !!this._armsHiddenVr) { this._armsHiddenVr = vr; this.arms.group.visible = !vr; } // VR: die echten Hände halten die Waffe
    if (this._pending && (!this.cur || !this._lowering)) this._swapNow();
    if (!this.cur) return;
    const h = this.h;

    // ---- Wechsel: Wegstecken / Ziehen
    if (this._lowering) {
      this._lowerT = Math.min(1, this._lowerT + dt / 0.2);
      if (this._lowerT >= 1) this._swapNow();
    } else if (this._equipT < 1) {
      this._equipT = Math.min(1, this._equipT + dt / Math.max(0.15, this._equipDur));
    }

    // ---- Nachladen mit dem Controller synchronisieren
    if (s.reloading === true) {
      const a = this.action;
      if (!a || (a.type !== 'reload' && a.type !== 'shells')) { if (this._equipT >= 1 && !this._lowering) this.playReload(!!s.reloadEmpty); }
      this._ctrlReload = true;
      const b = this.action;
      if (b && b.type === 'reload' && typeof s.reloadProgress === 'number') b.t = clamp(s.reloadProgress, 0, 1) * b.dur;
    } else if (s.reloading === false && this._ctrlReload) {
      this._ctrlReload = false;
      const a = this.action;
      if (a && a.type === 'reload' && a.t / a.dur < 0.86) a.cancel = true;
      if (a && a.type === 'shells') a.stop = true;
    }
    const inReload = this.action && this.action.type === 'reload';
    if (typeof s.mag === 'number' && h.action === 'pistol') this._slideLocked = s.mag === 0 && !inReload;
    if (typeof s.mag === 'number' && (h.action === 'auto' || h.action === 'semi') && !inReload) this._boltLocked = s.mag === 0;

    // ---- Zustände glätten
    const busy = this.action && ['reload', 'shells', 'melee', 'strike', 'grenade', 'slash', 'inspect'].includes(this.action.type);
    if (typeof s.adsProgress === 'number') this._ads = clamp(s.adsProgress, 0, 1);
    else {
      const adsTime = this.def?.adsTime ?? 0.25;
      const want = s.ads && !busy && h.action !== 'knife' ? 1 : 0;
      this._adsRaw = clamp(this._adsRaw + (want ? 1 : -1) * dt / Math.max(0.08, adsTime), 0, 1);
      this._ads = easeInOut(this._adsRaw);
    }
    const a = this._ads;
    const na = 1 - a;
    const sprintWant = s.sprinting && a < 0.2 && !(this.action && ['reload', 'shells', 'grenade', 'melee', 'strike', 'slash'].includes(this.action.type)) ? 1 : 0;
    this._sprint = damp(this._sprint, sprintWant, sprintWant ? 7 : 10, dt);
    this._crouch = damp(this._crouch, s.crouching ? 1 : 0, 8, dt);
    const onGround = s.onGround !== false;
    const speed = s.speed ?? (s.moving ? 5.4 : 0);
    const speedN = clamp(speed / 5.4, 0, 1.7);
    this._move = damp(this._move, onGround ? speedN : 0, 10, dt);
    this._air = damp(this._air, onGround ? 0 : 1, 8, dt);
    const sp = this._sprint;

    // ---- Handhabung: Masse/Trägheit der Waffe (Daten) × Komfort (Einstellung „Waffenträgheit“, Bewegung reduzieren)
    const hd = this._handlingData();
    const massK = Math.sqrt(clamp(hd.mass, 0.3, 12) / 3.3);   // 1 = Sturmgewehr; Pistole ≈ 0,5, LMG ≈ 1,6
    const comfort = this._motionScale();
    const swayK = hd.swayScale * comfort;
    const winded = clamp(s.winded || 0, 0, 1);
    const exh = s.exhausted ? 1 : 0;

    // ---- Sprung / Landung
    if (!onGround) this._airTime += dt;
    if (this._wasGround && !onGround) { this._land.kick(0.55 * comfort); this._jolt.kick(0, 0, 0); }
    if (!this._wasGround && onGround) {
      const k = clamp(this._airTime / 0.6, 0.3, 1.4) * (0.6 + 0.4 * massK) * comfort;
      this._land.kick(-1.6 * k);
      this._jolt.kick(-0.6 * k, 0, 0);
      this._airTime = 0;
    }
    this._wasGround = onGround;

    // Körperkamera (core): bewegt sich die Kamera schon selbst (Atmung, Schritte), bleibt der Waffe nur die
    // Bewegung der Arme relativ zur Brust – eigene Wipp-/Atemanteile entsprechend kleiner, Takt von der Kamera
    const camM = Number.isFinite(s.cameraMotion) ? clamp(s.cameraMotion / 0.6, 0, 1) : 0;
    const relK = 1 - 0.45 * camM;

    // ---- Schritte (Takt wie die Kamera des Spielers: ein Schritt je Schrittlänge) + Fersenstoß
    const stride = sp > 0.5 ? 2.7 : this._crouch > 0.5 ? 1.5 : 2.1;
    if (Number.isFinite(s.stepPhase)) this._phase = s.stepPhase;
    else if (onGround && speed > 0.6) this._phase += (speed * dt / stride) * Math.PI;
    const stepIdx = Math.floor(this._phase / Math.PI);
    if (stepIdx !== this._stepIdx) {
      this._stepIdx = stepIdx;
      if (onGround && speed > 0.6) {
        const hit = (0.035 + 0.05 * sp) * Math.sqrt(massK) * swayK * (1 - 0.8 * a);
        this._moveLag.kick(0, -hit, 0);
        this._jolt.kick(-0.35 * hit / 0.05, 0, 0);
      }
    }
    const ph = this._phase;
    const bobAmp = this._move * (1 - 0.88 * a) * swayK * relK;
    const rotK = Math.pow(massK, 0.35);
    const bobX = Math.sin(ph) * (0.0065 + 0.013 * sp) * bobAmp;
    const bobY = (Math.sin(ph * 2) * (0.0045 + 0.007 * sp) - 0.002 * sp) * bobAmp;
    const bobRZ = Math.sin(ph) * (0.012 + 0.05 * sp) * bobAmp * rotK;
    const bobRX = Math.sin(ph * 2) * (0.008 + 0.02 * sp) * bobAmp * rotK;
    const bobRY = Math.cos(ph) * (0.006 + 0.03 * sp) * bobAmp * rotK;

    // ---- Atmung: ruhig ≈ 16/min, nach dem Sprint (winded) schneller und tiefer, nach dem Atemanhalten außer Atem
    const bRate = 0.25 + 0.33 * winded + 0.3 * exh;
    if (Number.isFinite(s.breathPhase)) this._breathPh = s.breathPhase + 0.9;   // Arme folgen der Brust leicht verzögert
    else this._breathPh += dt * Math.PI * 2 * bRate;
    const bAmp = (1 + 1.6 * winded + 1.0 * exh) * (1 - 0.75 * a) * (1 - this._move * 0.5) * Math.min(1, comfort * 1.5) * relK;
    const breath = Math.sin(this._breathPh) * bAmp;
    const breath2 = Math.sin(this._breathPh * 0.5 + 1.3) * bAmp;

    // ---- Nachlauf hinter der Kameradrehung: die Waffe bleibt kurz in der Welt stehen und federt nach
    //      (Federfrequenz sinkt mit der Masse: Pistole ≈ 27 rad/s, Sturmgewehr 13, LMG 8; leicht unterdämpft)
    const lagW = 13 / massK, lagZ = 0.62;
    for (const sp1 of [this._lagYaw, this._lagPitch]) { sp1.k = lagW * lagW; sp1.c = 2 * lagZ * lagW; }
    const lagGain = 0.35 * hd.inertia * comfort * (1 - 0.8 * a);
    const lagMax = (0.085 - 0.07 * a) * comfort;
    this._lagYaw.x = clamp(this._lagYaw.x + (s.lookDX || 0) * lagGain, -lagMax, lagMax);
    this._lagPitch.x = clamp(this._lagPitch.x + (s.lookDY || 0) * lagGain, -lagMax, lagMax);
    const lagY = this._lagYaw.update(dt, 0);
    const lagP = this._lagPitch.update(dt, 0);

    // ---- Bewegungsnachlauf (Kameraraum: x rechts, y oben, z vorwärts) + Kanten beim Seitwärtslaufen
    const vel = s.vel;
    const vx = vel ? vel.x || 0 : 0, vy = vel ? vel.y || 0 : 0, vz = vel ? vel.z || 0 : speed;
    const mW = 9 / massK, mZ = 0.75;
    for (const sp1 of this._moveLag.s) { sp1.k = mW * mW; sp1.c = 2 * mZ * mW; }
    const mk = swayK * (1 - 0.85 * a);
    const mv = this._moveLag.update(dt, -vx * 0.0032 * mk, -clamp(vy, -12, 12) * 0.0022 * mk, vz * 0.0035 * mk);
    this._strafeRoll = damp(this._strafeRoll, -vx * 0.008 * swayK * (1 - 0.7 * a), 6 / massK, dt);

    // ---- Ruhiges Zielwandern an der Hüfte (Rauschen aus inkommensurablen Sinus); im Anschlag wandert
    //      stattdessen der Blick selbst (Controller, aimDrift) – das Visier bleibt exakt mittig.
    const t = this._time;
    const dn = (0.0035 + hd.aimDrift * 2) * swayK * (1 + 1.5 * winded + exh) * na;
    const driftX = (Math.sin(t * 0.37 + 1.1) * 0.6 + Math.sin(t * 0.83 + 0.4) * 0.3 + Math.sin(t * 1.91) * 0.1) * dn;
    const driftY = (Math.sin(t * 0.29 + 2.3) * 0.6 + Math.sin(t * 0.71 + 1.7) * 0.3 + Math.sin(t * 1.63 + 0.5) * 0.1) * dn;

    // ---- Rückstoß, Landung, Stöße (Federn je Masse: leichte Waffen schnappen, schwere setzen sich langsamer)
    const rW = 14.5 / Math.sqrt(massK), rWr = 13 / Math.sqrt(massK);
    for (const sp1 of this._recoilPos.s) { sp1.k = rW * rW; sp1.c = 2 * 0.68 * rW; }
    for (const sp1 of this._recoilRot.s) { sp1.k = rWr * rWr; sp1.c = 2 * 0.64 * rWr; }
    const rp = this._recoilPos.update(dt, 0, 0, 0);
    const rr = this._recoilRot.update(dt, 0, 0, 0);
    this._climb *= Math.exp(-(s.firing ? 2.2 : 6.5) * dt);
    this._heat = Math.max(0, this._heat - dt * (s.firing ? 0.04 : 0.12));
    const land = this._land.update(dt, 0);
    const jolt = this._jolt.update(dt, 0, 0, 0);

    // ---- Grundpose: Hüfte ↔ Anschlag (Haltung Standard ↔ Körperkamera weich überblendet)
    const want = this._wantPose();
    if (want !== this.pose) this.pose = want;
    this._poseW = damp(this._poseW, this.pose === 'bodycam' ? 1 : 0, 5, dt);
    const ps = this._blendPose();
    const ads3 = this.cur.ud.adsOffset;
    const hip = ps.hip, hr = ps.hipRot;
    // Seitenverhältnis: auf breiten Telefonen etwas weiter nach außen, auf 4:3-Tablets weiter zur Mitte
    const asp = clamp(((this.camera.aspect || 1.78) - 1.78) * 0.3, -0.15, 0.2);
    const hx = hip[0] * (1 + asp);
    const P = this._gunPos.set(hx + (ads3.x - hx) * a, hip[1] + (ads3.y - hip[1]) * a, hip[2] + (ads3.z - hip[2]) * a);
    const R = this._gunRot.set(hr[0] * na, hr[1] * na, hr[2] * na);
    P.x += ps.sprintPos[0] * sp * na + ps.crouchPos[0] * this._crouch * na;
    P.y += ps.sprintPos[1] * sp * na + ps.crouchPos[1] * this._crouch * na;
    P.z += ps.sprintPos[2] * sp * na + ps.crouchPos[2] * this._crouch * na;
    R.x += ps.sprintRot[0] * sp * na + ps.crouchRot[0] * this._crouch * na;
    R.y += ps.sprintRot[1] * sp * na + ps.crouchRot[1] * this._crouch * na;
    R.z += ps.sprintRot[2] * sp * na + ps.crouchRot[2] * this._crouch * na;
    // Wippen + Atmen + Nachlauf + Zielwandern
    const lagL = na;   // an der Hüfte dreht die Waffe um den Griff, im Anschlag um das Auge (s. u.)
    P.x += bobX + mv.x + lagY * 0.1 * lagL;
    P.y += bobY + mv.y + breath * 0.0011 + land * 0.035 * comfort - this._air * 0.012 * na - lagP * 0.06 * lagL;
    P.z += mv.z * na + breath2 * 0.0006;
    R.x += bobRX + breath * 0.004 + land * 0.05 * comfort + jolt.x * 0.05 + this._air * 0.03 * na + lagP * lagL + driftY;
    R.y += bobRY + lagY * lagL + driftX - vx * 0.004 * swayK * na;
    R.z += bobRZ - lagY * 0.55 * lagL + this._strafeRoll;
    // Rückstoß: Federstoß + Hochklettern im Dauerfeuer
    P.x += rp.x; P.y += rp.y + this._climb * 0.04 * na; P.z += rp.z + this._climb * 0.06;
    R.x += rr.x + this._climb * (0.12 + 0.88 * na); R.y += rr.y; R.z += rr.z;
    // Liegen (hands): Waffe angehoben, näher und leicht gekantet – Magazin/Hand tauchen nicht in den nahen Boden
    this._prone = damp(this._prone || 0, clamp(this.G?.player?.proneBlend ?? 0, 0, 1), 6, dt);
    if (this._prone > 1e-3) {
      const pr = smooth(this._prone) * na;
      P.x -= 0.018 * pr; P.y += 0.058 * pr; P.z += 0.035 * pr;
      R.x += 0.04 * pr; R.z += 0.14 * pr;
    }
    // Lehnen: Waffe folgt mit leichtem Verzug zur Seite und kantet etwas mehr (nur an der Hüfte)
    this._lean = damp(this._lean, clamp(s.lean || 0, -1, 1), 9, dt);
    P.x += this._lean * 0.012 * na;
    R.z -= this._lean * 0.07 * na;
    // Überklettern (core, F6): Waffe kurz gesenkt und zur Seite gekippt, die Hand ist am Hindernis
    this._mantle = damp(this._mantle, s.mantling ? 1 : 0, s.mantling ? 12 : 7, dt);
    if (this._mantle > 1e-3) {
      const m = smooth(this._mantle);
      P.x += 0.03 * m; P.y -= 0.13 * m; P.z += 0.04 * m;
      R.x -= 0.55 * m; R.y += 0.15 * m; R.z += 0.35 * m;
    }
    // Ziehen / Wegstecken je Waffenklasse (anim/moves.js); eq bleibt für VR (halb so weit, _xrGunPose)
    const eq = this._lowering ? 1 - smooth(1 - this._lowerT) : 1 - easeOut(this._equipT);
    if (!vr) this._drawPose(P, R);
    // Rutschen, Hinlegen-Übergang, Ducken-Ruck, Bereitmachen nach dem Spawn, Leerlauf-Gesten
    this._moveExtras(P, R, s, dt, na);

    // ---- Aktion (Nachladen, Nahkampf, Granate …)
    const act = this._evalAction(dt, s);
    if (act) {
      P.x += act.p[0]; P.y += act.p[1]; P.z += act.p[2];
      R.x += act.r[0]; R.y += act.r[1]; R.z += act.r[2];
    }

    // Waffe an Wänden und Hindernissen (F3, Einstellung weaponObstruction): `s.obstruct` (Controller, Strahlen entlang
    // der Laufrichtung bis zur Waffenlänge – nur was wirklich vor der Mündung steht, nicht Fahrzeug/Container daneben).
    // 'overlay' (Standard, wie die meisten Shooter) und 'clip': Waffe bleibt in Haltung (über der Welt bzw. gegen die
    // Welttiefe gezeichnet, renderer). 'raise'/'tuck': feste Ausweichhaltung, weich überblendet – erst zurückziehen
    // (o1), dann hochnehmen bzw. flach an den Oberkörper (o2). Die Waffe wird immer über der Welt gezeichnet, ragt
    // also auch auf dem Weg dorthin nicht sichtbar in die Wand.
    const wm = this._obstructionMode(), adapt = wm === 'raise' || wm === 'tuck';
    const obT = adapt && h.action !== 'knife' ? clamp(s.obstruct || 0, 0, 1) : 0;
    this._obstruct = damp(this._obstruct, obT, obT > this._obstruct ? 14 : 7, dt);
    if (this._obstruct < 1e-4) this._obstruct = 0;
    const ob = smooth(this._obstruct);
    if (ob > 1e-3 && h.action !== 'knife') {
      // Pose der laufenden Ausweichhaltung merken: Umschalten im Spiel blendet in der begonnenen Haltung aus
      if (adapt) this._obsPose = wm;
      const pistol = h.action === 'pistol';
      const o1 = clamp(ob / 0.5, 0, 1) * na, o2 = smooth(clamp((ob - 0.3) / 0.7, 0, 1)) * na;
      if (this._obsPose === 'raise') {
        // Hochnehmen: Mündung schräg nach oben um die Griffhand, zurück und etwas tiefer – Verschluss/Optik bleiben
        // unten rechts im Bild statt vor das Auge zu schwenken
        if (pistol) {
          P.z += 0.08 * o1; P.y -= 0.02 * o1;
          R.x += 0.65 * o2; R.y += 0.12 * o2; P.y -= 0.03 * o2; P.x -= 0.01 * o2;
        } else {
          P.z += 0.1 * o1; P.y -= 0.03 * o1;
          R.x += 0.7 * o2; R.y += 0.15 * o2; R.z -= 0.1 * o2; P.y -= 0.07 * o2; P.x += 0.02 * o2;
        }
      } else if (pistol) {
        // An den Körper: Pistole kompakt vor die Brust (Compressed Ready), Mündung leicht ab, nach innen gekantet
        P.z += 0.1 * o1; P.y -= 0.03 * o1;
        R.x -= 0.2 * o2; R.y += 0.5 * o2; R.z += 0.5 * o2; P.x -= 0.06 * o2; P.y -= 0.04 * o2;
      } else {
        // An den Körper: Gewehr flach vor den Oberkörper – eingedreht, Mündung leicht ab, nach innen gekantet, tiefer
        P.z += 0.12 * o1; P.y -= 0.04 * o1;
        R.x -= 0.22 * o2; R.y += 0.75 * o2; R.z += 0.45 * o2; P.x -= 0.05 * o2; P.y -= 0.06 * o2; P.z += 0.03 * o2;
      }
    }
    // Nachladen einrahmen (hands): die Arbeitsstelle der Stützhand (Magazinschacht, Ladeöffnung, Trommel, Rohrmündung)
    // wird während der Aktion ins untere Bilddrittel gehoben/geschoben – wie bei echten Ego-Shootern dreht und hebt
    // man die Waffe zur Kamera, statt unter dem Bildrand zu hantieren. Nur anheben/wegschieben, höchstens 0,22 m.
    if (act && act.frame > 1e-3 && this.cur.workRest && !vr) this._frameWork(P, R, act.frame);
    // VR: Hand = Waffe – statt Hüft-/Anschlagpose, Wippen, Nachlauf und Ausweichen nur Rückstoß, Ziehen und Aktionen
    if (vr) this._xrGunPose(P, R, rp, rr, act, eq);
    this.gun.position.copy(P);
    this.gun.rotation.set(R.x, R.y, R.z, 'YXZ');
    // Drehung um das Auge: freies Zielen (Waffe zeigt in die Laufrichtung, Visierlinie bleibt am Auge) und der
    // Nachlauf im Anschlag – so wandert das ganze Visierbild, statt dass Kimme und Korn auseinanderlaufen.
    const fa = vr ? null : s.freeAim;
    let faX = 0, faY = 0;
    if (fa && (fa.x || fa.y)) {
      // gleicher Bildpunkt wie das Fadenkreuz (projizierter Laufpunkt der Hauptkamera): Winkel ins Viewmodel-FOV umrechnen
      const main = this.G?.camera;
      const kf = main && main.fov ? Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(main.fov) / 2) : 1;
      faX = Math.atan(Math.tan(fa.x || 0) * kf);
      faY = Math.atan(Math.tan(fa.y || 0) * kf);
    }
    const eyeYaw = vr ? 0 : -faX + lagY * a, eyePitch = vr ? 0 : faY + lagP * a;
    if (eyeYaw || eyePitch) {
      this._eyeQ.setFromEuler(_e.set(eyePitch, eyeYaw, 0, 'YXZ'));
      this.gun.position.applyQuaternion(this._eyeQ);
      this.gun.quaternion.premultiply(this._eyeQ);
    }

    // ---- Bewegliche Teile: Verschluss/Schlitten/Hahn
    this._animParts(dt, act);

    // ---- Zielfernrohr: voll im Anschlag → Overlay, Waffe ausblenden (nicht in VR: dort gibt es kein Bildschirm-Overlay)
    const scoped = !vr && this._scopeOverlay === 'sniper' && a > 0.96 && (!this.action || this.action.type === 'boltCycle');
    this.showScopeOverlay = scoped;
    this.root.visible = this._visible && !scoped;
    if (scoped) this.flash.hide();

    // ---- Hände
    this.root.updateMatrixWorld(true);
    this._rootInv.copy(this.root.matrixWorld).invert();
    this._solveHands(act || this._mantleAct());

    // ---- Effekte
    this.cur.ud.muzzle.getWorldPosition(_v);
    this.flash.light.position.copy(this.root.worldToLocal(_v));
    this.flash.update(dt);
    this.smoke.update(dt);
    // Hitzeflimmern über dem Lauf (high/ultra): ab ~⅓ Erwärmung, im Anschlag halb so stark
    {
      const hz = smooth(clamp((this._heat - 0.3) / 0.6, 0, 1)) * (1 - 0.5 * a);
      if (hz > 0.01 && this.haze.enabled && !vr && !this.showScopeOverlay && this._visible) { // VR: kein Hitzeflimmern (Bildkopie)
        const mz = this.cur.ud.muzzle;
        mz.getWorldPosition(_s1);
        this.root.worldToLocal(_s1);
        _v2.set(0, 0, 1).applyQuaternion(this.gun.quaternion);   // zum Schützen hin (entlang des Laufs)
        _s1.addScaledVector(_v2, h.action === 'pistol' ? 0.05 : 0.13).add(_v3.set(0, h.action === 'pistol' ? 0.04 : 0.065, 0));
        this.haze.update(dt, _s1, h.action === 'pistol' ? 0.1 : 0.17, h.action === 'pistol' ? 0.12 : 0.2, hz);
      } else this.haze.update(dt, _s1, 0, 0, 0);
    }
    // Heißer Lauf nach Feuerstößen: dünne Rauchfäden steigen aus der Mündung (in der Welt – bleiben beim Drehen stehen)
    if (this._heat > 0.18 && (s.timeSinceShot ?? 9) > 0.15 && h.flash > 0 && !this.showScopeOverlay && this._visible && this._worldFx() && typeof this.G.effects.wisp === 'function') {
      this._wispT = (this._wispT ?? 0) - dt;
      if (this._wispT <= 0) {
        this._wispT = 0.1 + 0.2 * (1 - this._heat);
        try { this.G.effects.wisp(this.getMuzzleWorldPosition(_pv2), { strength: this._heat }); } catch { /* Welt im Abbau */ }
      }
    }
    this.shells.setGravity(_v.set(0, -7.5, 0).applyQuaternion(_q.copy(this._mainQuat).invert()));
    this.shells.update(dt);
    this.arms.update(dt);
    this._updateLights(dt);
  }

  _frameWork(P, R, w) {
    const cam = this.camera;
    _q.setFromEuler(_e.set(R.x, R.y, R.z, 'YXZ'));
    const p = _v.copy(this.cur.workRest).applyMatrix4(this.cur.model.matrix).applyQuaternion(_q).add(P);
    const d = Math.max(0.3, -p.z);
    const tanV = Math.tan(((cam.fov || 54) * Math.PI) / 360), tanH = tanV * (cam.aspect || 1.78);
    const tx = clamp(p.x, -0.3 * d * tanH, 0.2 * d * tanH), ty = -0.42 * d * tanV;
    const dx = tx - p.x, dy = Math.max(0, ty - p.y), dz = Math.min(0, -d - p.z);
    const l = Math.hypot(dx, dy, dz), k = l > 0.22 ? 0.22 / l : 1;
    P.x += dx * k * w; P.y += dy * k * w; P.z += dz * k * w;
  }

  // Anker → Handziel im Kameraraum
  _anchorTarget(anchor, style, data, out, side = 1) {
    _m.multiplyMatrices(this._rootInv, anchor.matrixWorld);
    _m.decompose(_v, _q, _s1);
    const g = gripTransform(style, data || anchor.userData, side, _v2, _q2);
    out.quat.copy(_q).multiply(g.quat);
    out.pos.copy(g.pos).applyQuaternion(_q).add(_v);
    copyPose(g.pose, out.pose);
    return out;
  }

  _freeTarget(pos, F, B, poseName, out) {
    out.pos.fromArray(pos);
    basis(F, B, out.quat);
    copyPose(getPose(poseName), out.pose);
    return out;
  }

  _solveHands(act) {
    const ud = this.cur.ud, h = this.h;
    const R = this._hR, L = this._hL;
    this._contactFrame = (this._contactFrame || 0) + 1;
    // Rechte Hand: Pistolengriff (Messer: Faustgriff)
    const rStyle = h.action === 'knife' ? 'knife' : 'pistolGrip';
    this._anchorTarget(ud.rightHandGrip, rStyle, ud.rightHandGrip.userData, R, 1);
    let busyR = act ? this._applyRequests(act.right, R, 1) : 0;
    // Bewegte Teile unter der Schusshand (Schlitten zurück, Verschluss/Trommel in Bewegung): je Bild statt gemerkt
    if (busyR <= 1e-3 && (this._slideLocked || this._boltLocked || this._boltT < 1 || (act && (act.parts.slide || act.parts.boltHandle || act.parts.crane || act.parts.cylinder)))) { busyR = 2e-3; this._reqStyle = rStyle; }
    // Abzugsfinger beim Patronenladen gestreckt längs des Gehäuses (hands-v3): die Patrone läuft vor dem Abzugsbügel
    // in die Ladeöffnung und ging sonst durch die Zeigefingerkuppe (Bulldog/Hagel 9–11 mm)
    const disc = this._idxDisc = clamp((this._idxDisc || 0) + (act && act.parts && act.parts.shell ? 0.12 : -0.12), 0, 1);
    if (disc > 0 && rStyle === 'pistolGrip' && busyR < 0.5) {
      const f0 = R.pose.f[0], k = smooth(disc);
      f0[0] += (0.12 - f0[0]) * k; f0[1] += (0.06 - f0[1]) * k; f0[2] += (0.04 - f0[2]) * k; f0[3] += (0.1 - f0[3]) * k;
      // je Bild lösen, solange Patronen laufen (hv3: der gemerkte Ruhegriff kannte die bewegte Patrone nicht – Bulldog
      // reload t 0,46 Zeigefinger 7–9 mm in der Patrone); im Übergang ohnehin (gemerkter Griff hätte den alten Finger)
      if (disc < 0.98 || (act && act.parts && act.parts.shell)) busyR = Math.max(busyR, 2e-3);
    }
    this.arms.right.applyPose(R.pose);
    this._contact(this.arms.right, R, busyR, 'R:' + rStyle + (disc > 0.5 ? ':disc' : ''), { grip: busyR < 0.5 || GRIP_STYLES.has(this._reqStyle), skipIndex: rStyle === 'pistolGrip' && busyR < 0.5 && disc < 0.5 });
    this.arms.right.solve(R.pos, R.quat);
    // Requisiten in der rechten Hand (Granate) für den Splint-Griff aktualisieren
    this.arms.right.handBone.updateWorldMatrix(true, true);
    // Linke Hand: Stützgriff
    const lg = ud.leftHandGrip, style = lg.userData.style || h.leftGrip;
    if (h.leftGrip === 'none') this._freeTarget([-0.12, -0.34, -0.22], [0.3, 0.6, -0.8], [-0.6, 0.2, 0.3], 'relaxed', L);
    else this._anchorTarget(lg, style, lg.userData, L, -1);
    const busyL = act ? this._applyRequests(act.left, L, -1) : 0;
    this.arms.left.applyPose(L.pose);
    const gripL = busyL < 0.5 ? h.leftGrip !== 'none' : GRIP_STYLES.has(this._reqStyle);
    this._contact(this.arms.left, L, h.leftGrip === 'none' && busyL < 1e-3 ? -1 : busyL, 'L:' + style, { grip: gripL, layThumb: busyL < 0.5 && h.leftGrip !== 'none' });
    this.arms.left.solve(L.pos, L.quat);
  }

  /**
   * Hand an die Waffenoberfläche (hands): ohne Handanfrage (Hüfte/Anschlag/Sprint, Hand am Grundgriff) wird die
   * Korrektur einmal je Waffe+Griff gelöst und gemerkt (Versatz im Handraum + Fingerknochen); während Aktionen
   * (Nachladen, Inspizieren, Übergänge) läuft der Löser je Bild. busy < 0: Hand frei (kein Kontakt nötig).
   */
  _contact(arm, T, busy, key, opts) {
    let col = this.cur.collider;
    if (!col || busy < 0) return;
    if (col.frame !== this._contactFrame) { col.sync(); col.frame = this._contactFrame; }
    // Sichtbare Requisiten (Granate, Messer, Platte): fremde zählen wie die Waffe, das eigene nur für die Finger
    let own = null, other = null;
    for (const p of Object.values(this.props)) {
      if (!p.visible || !p.parent) continue;
      const c = p.userData.__col || (p.userData.__col = new GunCollider(p));
      if (c.frame !== this._contactFrame) { c.sync(); c.frame = this._contactFrame; }
      if (p.parent === arm.handBone) own = c; else (other || (other = [])).push(c);
    }
    if (other) { col = (this._multiCol || (this._multiCol = new MultiCollider())).set([col, ...other]); busy = Math.max(busy, 2e-3); }
    if (own) { busy = Math.max(busy, 2e-3); opts.own = own; }
    const memo = this.cur.contactMemo;
    if (busy <= 1e-3) {
      const m = memo.get(key);
      // hands 2: einmal nach 12 Ruhebildern neu lösen – das erste Lösen fällt oft ins Ende des Ziehens (Teile/Waffe
      // noch in Bewegung), das Ergebnis hing dann von der Reihenfolge der Waffenwechsel ab
      if (m && ++m.uses !== 12) {
        T.pos.add(_v.fromArray(m.d).applyQuaternion(T.quat));
        for (let i = 0; i < m.bones.length; i++) m.bones[i].quaternion.fromArray(m.q, i * 4);
        return;
      }
      _v3.copy(T.pos);
      opts.rest = true;   // gemerkter Ruhegriff: Finger zusätzlich über Abspreizen anlegen (hands 2)
      arm.contact(col, T, opts);
      const bones = [...arm.fingers.flat(), ...arm.thumb];
      const q = new Float32Array(bones.length * 4);
      bones.forEach((b, i) => b.quaternion.toArray(q, i * 4));
      memo.set(key, { d: _v.subVectors(T.pos, _v3).applyQuaternion(_q.copy(T.quat).invert()).toArray(), bones, q, uses: m ? m.uses : 0 });
      return;
    }
    // Während Aktionen je Bild lösen; auf low nur jedes 3., auf medium jedes 2. Bild (dazwischen letzte Korrektur im Handraum)
    const every = this.quality === 'low' ? 3 : this.quality === 'medium' ? 2 : 1;
    const lc = arm._lastContact || (arm._lastContact = { d: new THREE.Vector3(), q: new Float32Array(60), bones: [...arm.fingers.flat(), ...arm.thumb], n: 0, frame: -9 });
    if (every > 1 && this._contactFrame - lc.frame < every && !own && !other) {
      T.pos.add(_v.copy(lc.d).applyQuaternion(T.quat));
      for (let i = 0; i < lc.bones.length; i++) lc.bones[i].quaternion.fromArray(lc.q, i * 4);
      // hands 2: die alte Korrektur gilt nur, solange sie noch passt – beim schnellen Griff zum Magazin steckten
      // die Finger auf low sonst 1–3 cm in der Waffe; Schnellprüfung, bei Eindringen doch lösen
      if (arm.quickPen(col, T) <= 0.0015) return;
      T.pos.sub(_v);
      arm.applyPose(T.pose);
    }
    _v3.copy(T.pos);
    arm.contact(col, T, opts);
    lc.frame = this._contactFrame;
    lc.d.subVectors(T.pos, _v3).applyQuaternion(_q.copy(T.quat).invert());
    lc.bones.forEach((b, i) => b.quaternion.toArray(lc.q, i * 4));
  }

  // Handanfragen einer Aktion der Reihe nach einmischen; Rückgabe: größtes Gewicht (Stil in this._reqStyle)
  _applyRequests(list, target, side) {
    let wMax = 0;
    this._reqStyle = null;
    for (let i = 0; i < list.n; i++) {
      const r = list.items[i];
      if (r.w <= 0) continue;
      const t = this._tmpT;
      if (r.free) this._freeTarget(r.free[0], r.free[1], r.free[2], r.free[3], t);
      else if (r.part) this._partTarget(r.part, r.style, t, r.offset, side);
      else if (r.anchor) { r.anchor.updateWorldMatrix(true, false); this._anchorTarget(r.anchor, r.style, r.data || null, t, side); }
      else continue;
      if (r.dy) t.pos.y += r.dy;
      target.lerp(t, r.w);
      // Übergang im Bogen (hands): zwischen zwei Griffen hebt sich die Hand über den Handrücken von der Waffe ab,
      // statt auf der Geraden durch Gehäuse/Schlitten zu gleiten (Spitze 4,5 cm bei halber Überblendung)
      if (!r.free && r.w < 1) target.pos.add(_v.set(0, 0.18 * r.w * (1 - r.w), 0).applyQuaternion(target.quat));
      if (r.w > wMax) { wMax = r.w; this._reqStyle = r.free ? r.free[3] : r.style; }
    }
    return wMax;
  }

  _part(name) { return this.cur?.ud.parts[name] || null; }

  _setPartOffset(name, dx, dy, dz, rx = 0, ry = 0, rz = 0) {
    const p = this._part(name);
    if (!p) return;
    const r = this.cur.rest.get(name);
    p.position.set(r.pos.x + dx, r.pos.y + dy, r.pos.z + dz);
    p.quaternion.copy(r.quat);
    if (rx || ry || rz) p.quaternion.multiply(_q.setFromEuler(_e.set(rx, ry, rz)));
  }

  _animParts(dt, act) {
    const h = this.h;
    this._resetParts();
    // Verschluss / Schlitten: schneller Hub beim Schuss
    this._boltT = Math.min(1, this._boltT + dt / 0.075);
    const pulse = this._boltT < 0.3 ? smooth(this._boltT / 0.3) : smooth(1 - (this._boltT - 0.3) / 0.7);
    if (h.action === 'pistol') {
      const travel = this.cur.ud.anchors.slideGrab?.userData.travel?.[2] ?? 0.03;
      const back = this._slideLocked ? 1 : pulse;
      this._setPartOffset('slide', 0, 0, travel * back);
      // Hahn fällt nach vorn und wird vom Schlitten wieder gespannt
      if (this._part('hammer')) this._setPartOffset('hammer', 0, 0, 0, -0.7 * (this._slideLocked ? 0 : pulse));
    } else if (h.action === 'revolver') {
      // Double-Action: Hahn spannt und fällt, Trommel dreht um eine Kammer weiter
      this._cylAngle = (this._cylAngle || 0) + ((this._cylTarget || 0) - (this._cylAngle || 0)) * Math.min(1, dt * 30);
      this._setPartOffset('cylinder', 0, 0, 0, 0, 0, this._cylAngle);
      if (this._part('hammer')) this._setPartOffset('hammer', 0, 0, 0, -0.55 * pulse);
    } else if (h.action === 'launcher') {
      const r = this._part('rocket');
      if (r) r.visible = (this._magNow ?? 1) > 0;
    } else if (this._part('bolt') && h.action !== 'bolt' && h.action !== 'pump') {
      this._setPartOffset('bolt', 0, 0, h.boltTravel * (this._boltLocked ? 1 : pulse));
    }
    // Aktionsteile (Magazin, Ladehebel, Pumpe, Kammerstängel, Deckel …)
    if (act && act.parts) for (const [n, o] of Object.entries(act.parts)) {
      if (n === '_vis') continue;
      this._setPartOffset(n, o[0] || 0, o[1] || 0, o[2] || 0, o[3] || 0, o[4] || 0, o[5] || 0);
    }
    if (act && act.parts && act.parts._vis) for (const [n, v] of Object.entries(act.parts._vis)) { const p = this._part(n); if (p) p.visible = v; }
    this._updateMagFill();
    // Semtex-LED in der Hand blinkt
    this._led += dt;
    const led = this.props.semtex.userData.parts.led;
    if (led) led.visible = (this._led % 0.5) < 0.25;
  }

  // ---------------------------------------------------------------- Aktions-Choreografie

  _evalAction(dt, s) {
    const A = this.action;
    if (!A) { this._hideProps(); return null; }
    if (A.delay > 0) { A.delay -= dt; return null; }
    A.t += dt;
    if (A.cancel) {
      A.fade -= dt / 0.2;
      if (A.fade <= 0) { this.action = null; this._hideProps(); return null; }
    }
    const out = this._act || (this._act = { p: [0, 0, 0], r: [0, 0, 0], left: reqList(), right: reqList(), parts: {} });
    out.p[0] = out.p[1] = out.p[2] = 0; out.r[0] = out.r[1] = out.r[2] = 0;
    out.left.n = 0; out.right.n = 0; out.frame = 0;
    for (const k in out.parts) delete out.parts[k];
    let done = false;
    switch (A.type) {
      case 'reload': done = this._actReload(A, out); break;
      case 'shells': done = this._actShells(A, out, dt); break;
      case 'boltCycle': done = this._actBolt(A, out); break;
      case 'pumpCycle': done = this._actPump(A, out); break;
      case 'melee': done = this._actMelee(A, out); break;
      case 'slash': done = this._actSlash(A, out); break;
      case 'grenade': done = this._actGrenade(A, out); break;
      case 'inspect': done = this._actInspectV(A, out); break;
      case 'plate': done = this._actPlate(A, out); break;
      case 'ready': done = this._actReady(A, out); break;
      case 'fidget': done = this._actFidget(A, out); break;
      case 'strike': done = this._actGunStrike(A, out); break;
      default: done = true;
    }
    const f = A.cancel ? Math.max(0, A.fade) : 1;
    if (f < 1) {
      for (let i = 0; i < 3; i++) { out.p[i] *= f; out.r[i] *= f; }
      out.frame *= f;
      for (let i = 0; i < out.left.n; i++) out.left.items[i].w *= f;
      for (let i = 0; i < out.right.n; i++) out.right.items[i].w *= f;
      for (const k in out.parts) if (k !== '_vis') out.parts[k] = out.parts[k].map(v => v * f);
    }
    if (done) { this.action = null; this._hideProps(); }
    return out;
  }

  _hideProps() {
    for (const p of Object.values(this.props)) p.visible = false;
    const ch = this.cur?.chamber;
    if (ch) ch.mesh.visible = false;   // Kammer-Patrone (Inspizieren, anim/inspects.js)
  }

  /** Füllstand des neuen Magazins – wie WeaponController._addAmmo (reicht der Vorrat nicht, ist es nicht voll). */
  _freshMag() {
    const cap = this.def?.mag ?? 0;
    const w = this.G?.player?.weapon, st = w && w.viewModel === this ? w.current : null;
    if (!st || this._magRaw == null || w.infiniteAmmo) return cap;
    return Math.min(cap, st.mag + Math.max(0, st.reserve || 0));
  }

  /**
   * Magazininhalt (gunsmith/magfill.js): Patronen im Magazin-Teil = Munitionsstand des Controllers, während des
   * Nachladens ab dem Herausziehen das neue Magazin (A.magNew); Revolver: Trommelstellung dreht die Kammern mit.
   * Ändert sich nichts, kostet es nichts (setMagRounds vergleicht den letzten Stand).
   */
  _updateMagFill() {
    const A = this.action;
    let n = this._magRaw ?? this.def?.mag ?? 0;
    if (A && A.magNew != null && !A.cancel && (A.type === 'reload' || A.type === 'shells')) n = A.magNew;
    setMagRounds(this.cur.model, n, this._cylTarget || 0);
  }

  /**
   * Kammerstängel: hoch, zurück (Hülse fliegt), vor, runter. flick (Repetieren, Variante 2): kürzerer Griff, Waffe
   * kräftiger gekantet und kurz abgesenkt – der Stängel wird mit Schwung „durchgeschlagen“ (gleiche Dauer).
   */
  _boltMotion(c, out, inReload, flick = false) {
    const bg = this.cur.ud.anchors.boltGrab;
    if (!bg) return;
    const rot = bg.userData.rot ?? 1.05, travel = bg.userData.travel?.[2] ?? 0.09;
    const up = flick ? curve(c, [[0.22, 0], [0.3, 1], [0.6, 1], [0.68, 0]]) : curve(c, [[0.18, 0], [0.3, 1], [0.66, 1], [0.78, 0]]);
    const back = flick ? curve(c, [[0.3, 0], [0.4, 1], [0.46, 1], [0.58, 0]]) : curve(c, [[0.3, 0], [0.45, 1], [0.52, 1], [0.66, 0]]);
    out.parts.boltHandle = [0, 0, travel * back, 0, 0, rot * up];
    const w = flick ? windowW(c, 0.06, 0.2, 0.7, 0.86) : windowW(c, 0.02, 0.17, 0.8, 0.96);
    if (w > 0) req(out.right, w, { anchor: bg, style: 'boltKnob' });
    const rc = flick ? windowW(c, 0.0, 0.22, 0.62, 0.92) : windowW(c, 0.0, 0.18, 0.8, 1.0);
    if (flick) { out.r[2] += 0.32 * rc; out.r[0] -= 0.04 * rc; out.r[1] += 0.1 * rc; out.p[1] += -0.03 * rc; out.p[0] -= 0.01 * rc; }
    else { out.r[2] += 0.16 * rc; out.r[0] += 0.05 * rc; out.r[1] += 0.06 * rc; out.p[1] += -0.015 * rc; }
    if (flick && c > 0.58 && this.action && !this.action.flicked) { this.action.flicked = true; this._jolt.kick(0.6, 0.3, 0); }
    if (!inReload && c > 0.47 && this.action && !this.action.ejected) { this.action.ejected = true; this._eject(); }
  }

  _actBolt(A, out) {
    const c = clamp(A.t / A.dur, 0, 1);
    this._boltMotion(c, out, false, A.variant === 1);
    return c >= 1;
  }

  _actPump(A, out) {
    const c = clamp(A.t / A.dur, 0, 1);
    const pg = this.cur.ud.anchors.pumpGrab;
    const travel = pg?.userData.travel?.[2] ?? 0.085;
    const back = curve(c, [[0.05, 0], [0.38, 1], [0.48, 1], [0.8, 0]]);
    out.parts.pump = [0, 0, travel * back];
    const rc = windowW(c, 0.0, 0.3, 0.6, 1.0);
    out.r[0] += 0.06 * rc; out.r[2] += 0.05 * rc; out.p[2] += 0.012 * rc;
    if (c > 0.4 && !A.ejected) { A.ejected = true; this._eject(); this._jolt.kick(0.5, 0, 0); }
    return c >= 1;
  }

  // Zielhand an einem Teil (Patrone, Magazin) ausrichten
  _partTarget(part, style, out, offset, side = -1) {
    const p = this._part(part);
    if (!p) return out;
    p.updateWorldMatrix(true, false);
    const tmp = this._tmpAnchor || (this._tmpAnchor = new THREE.Object3D());
    p.add(tmp);
    tmp.position.fromArray(offset || ZERO3);
    tmp.updateWorldMatrix(false, false);
    this._anchorTarget(tmp, style, null, out, side);
    p.remove(tmp);
    return out;
  }

  _actMelee(A, out) {
    // Schneller Messerhieb mit der linken Hand quer durchs Bild; die Waffe weicht nach rechts unten aus
    const u = clamp(A.t / A.dur, 0, 1);
    const gw = windowW(u, 0.0, 0.12, 0.6, 0.9);
    out.p[0] = 0.06 * gw; out.p[1] = -0.1 * gw; out.p[2] = 0.05 * gw;
    out.r[0] = -0.3 * gw; out.r[1] = -0.35 * gw; out.r[2] = -0.35 * gw;
    const knife = this.props.knife;
    const w = windowW(u, 0.0, 0.08, 0.52, 0.74);
    // Schlüsselbilder: Ausholen links oben → Schnitt durch die Mitte → Durchschwung rechts unten → zurück
    const K = (A.style && MELEE_STYLES[A.style]) || KNIFE_MELEE;
    const pos = curve(u, K.pos, _a3);
    const F = curve(u, K.F, _b3);
    const B = curve(u, K.B, _c3);
    req(out.left, w, { free: [pos, F, B, 'knife'] });
    this._attachProp(knife, this.arms.left.handBone, 'knife', -1);
    knife.visible = u > 0.02 && u < 0.7;
    if (u > 0.2 && !A.hit) { A.hit = true; this.onMeleeHit?.(); this._jolt.kick(0.7, 0.6, 0); }
    return u >= 1;
  }

  _actSlash(A, out) {
    if (A.style && A.style !== 'slash') { const r = this._actSlashStyle(A, out, A.style); if (r !== null) return r; }
    // Messer als Hauptwaffe: Hieb mit der rechten Hand von rechts oben nach links unten
    const u = clamp(A.t / A.dur, 0, 1);
    curve(u, [[0, ZERO3], [0.08, [0.05, 0.07, 0.05]], [0.24, [-0.24, -0.08, -0.1]], [0.4, [-0.2, -0.12, -0.04]], [0.85, ZERO3]], out.p);
    curve(u, [[0, ZERO3], [0.08, [0.35, -0.5, -0.5]], [0.24, [-0.25, 0.75, 0.9]], [0.4, [-0.3, 0.7, 0.8]], [0.85, ZERO3]], out.r);
    if (u > 0.18 && !A.hit) { A.hit = true; this.onMeleeHit?.(); this._jolt.kick(0.5, -0.6, 0); }
    return u >= 1;
  }

  _actGrenade(A, out) {
    let u = A.t / A.dur;
    // Vorkochen: nach dem Abziehen festhalten
    if (A.hold && u > 0.47) { A.t = 0.47 * A.dur; u = 0.47; }
    u = clamp(u, 0, 1);
    const g = this.props[A.gtype];
    // Waffe aus dem Bild
    const gw = windowW(u, 0.0, 0.16, 0.8, 1.0);
    out.p[0] = 0.04 * gw; out.p[1] = -0.32 * gw; out.p[2] = 0.1 * gw;
    out.r[0] = -0.85 * gw; out.r[1] = 0.2 * gw; out.r[2] = 0.35 * gw;
    // Rechte Hand: Granate halten, ausholen, werfen
    const rw = windowW(u, 0.05, 0.2, 0.8, 0.96);
    let rp, rF, rB;
    if (A.low) {
      // von unten: tief nach hinten ausholen, flach nach vorn oben loslassen (gleiche Zeitpunkte)
      rp = curve(u, GRENADE_LOW.pos); rF = curve(u, GRENADE_LOW.F); rB = curve(u, GRENADE_LOW.B);
    } else {
      rp = curve(u, [[0.05, [0.2, -0.4, -0.2]], [0.2, [0.09, -0.12, -0.3]], [0.47, [0.07, -0.1, -0.29]], [0.58, [0.22, -0.02, -0.2]], [0.68, [0.03, 0.04, -0.48]], [0.8, [-0.06, -0.32, -0.36]], [0.96, [0.0, -0.45, -0.25]]]);
      rF = curve(u, [[0.05, [-0.4, 0.6, -0.6]], [0.2, [-0.45, 0.55, -0.55]], [0.47, [-0.45, 0.55, -0.55]], [0.58, [-0.1, 0.9, 0.2]], [0.68, [0.0, 0.3, -0.95]], [0.8, [-0.1, -0.6, -0.7]]]);
      rB = [0.75, 0.2, 0.45];
    }
    req(out.right, rw, { free: [rp, rF, rB, 'ball'] });
    this._attachProp(g, this.arms.right.handBone, 'grenade', 1);
    g.visible = u > 0.06 && u < 0.67;
    // Linke Hand: Splint ziehen
    const lw = windowW(u, 0.14, 0.26, 0.5, 0.64);
    if (lw > 0) {
      const pinGrab = g.userData.anchors.pinGrab;
      if (u < 0.36 && pinGrab) req(out.left, lw, { anchor: pinGrab, style: 'pinchSide' });
      else req(out.left, lw, { free: [curve(u, [[0.36, [-0.02, -0.12, -0.32]], [0.46, [-0.14, -0.14, -0.3]], [0.64, [-0.2, -0.36, -0.22]]]), [0.3, 0.4, -0.85], [-0.4, 0.8, 0.3], 'pinch'] });
    }
    // Splint folgt der linken Hand nach dem Ziehen
    const pin = g.userData.parts.pin;
    if (pin) {
      const r = g.userData.__pinRest || (g.userData.__pinRest = pin.position.clone());
      const pulled = clamp((u - 0.36) / 0.1, 0, 1);
      pin.position.copy(r).add(_v.set(-0.06 * pulled, 0.02 * pulled, 0));
      pin.visible = u < 0.52;
    }
    if (u >= 0.66 && !A.released) { A.released = true; this.onGrenadeRelease?.(A.gtype); }
    return u >= 1;
  }

  // Requisit an einen Handknochen hängen (Messer/Granate)
  _attachProp(prop, bone, kind, side) {
    if (prop.parent !== bone) bone.add(prop);
    if (kind === 'knife') {
      // Hammergriff wie beim Messer als Hauptwaffe (GRIPS.knife): Klinge aus der Faust zur Daumenseite,
      // Schneide in Fingerrichtung (−Z der Hand), Klingenfläche zum Handrücken – zeigt der Handrücken
      // zur Kamera, ist auch die Klinge flächig zu sehen. Basis-Spalten = Messerachsen X, Y, Z im Handraum.
      const k = PROP_SHAPES.knife.pos;
      prop.position.set(k[0] * side, k[1], k[2]);
      _m.makeBasis(_v.set(0, side, 0), _v2.set(0, 0, 1), _v3.set(side, 0, 0));
      prop.quaternion.setFromRotationMatrix(_m);
    } else if (kind === 'plate') {
      // Platte an der Oberkante gegriffen: Kante liegt in den gekrümmten Fingern, Platte hängt darunter, Fläche zur
      // Kamera (hands-v3: vorher Mitte unter der Handfläche → Oberkante 11 cm über dem Handrücken, Finger steckten darin)
      prop.position.set(0.0, -0.162, -0.112);
      prop.rotation.set(-0.12, 0, 0);
    } else {
      const g = PROP_SHAPES.grenade.pos;
      prop.position.set(g[0] * side, g[1], g[2]);
      prop.rotation.set(0.3, 0, 0);
    }
  }

  // ---------------------------------------------------------------- Abfragen & Verwaltung

  /** Mündung in Weltkoordinaten der Hauptszene (für Leuchtspuren). */
  getMuzzleWorldPosition(out = new THREE.Vector3()) {
    const main = this.G?.camera;
    if (!this.cur) return main ? main.getWorldPosition(out) : out.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.cur.ud.muzzle.getWorldPosition(out);
    if (!main || this._vrOn) return out; // VR: Viewmodel liegt in Weltkoordinaten (Hand)
    // Bildschirmposition im Viewmodel → gleiche Bildposition + Tiefe in der Hauptkamera
    const vm = this.camera;
    vm.updateMatrixWorld();
    _v.copy(out).applyMatrix4(vm.matrixWorldInverse);
    const depth = Math.max(0.05, -_v.z);
    _v2.copy(out).project(vm);
    main.updateMatrixWorld();
    const tan = Math.tan(THREE.MathUtils.degToRad(main.fov) / 2) / (main.zoom || 1);
    out.set(_v2.x * depth * tan * main.aspect, _v2.y * depth * tan, -depth).applyMatrix4(main.matrixWorld);
    return out;
  }

  setVisible(v) {
    this._visible = !!v;
    this.root.visible = this._visible && !this.showScopeOverlay;
    if (!v) { this.flash.hide(); this.shells.clear(); this.smoke.clear(); }
  }

  /** Alle Waffenmodelle vorbauen und Shader kompilieren (z. B. im Ladebildschirm) – auch die der Effekte
   *  (Mündungsfeuer, Rauch, Hülsen je Art), damit der erste Schuss kein Programm mehr linkt. */
  warmup(renderer, ids = Object.keys(ID_TO_MODEL)) {
    const prev = this.cur;
    const holder = new THREE.Group();
    const shells = new Set();
    for (const id of ids) {
      const e = this._getModel(id, (this._defFor(id)?.model) || ID_TO_MODEL[id] || id);
      shells.add(handlingFor(e.key).shell);
      if (e !== prev) holder.add(e.model);
    }
    this.shells.prepare(shells);
    if (!this.flash.group.parent) holder.add(this.flash.group);   // noch keine Waffe gezogen
    const hazeVis = this.haze.mesh.visible;
    this.haze.mesh.visible = this.haze.enabled;                    // Shader des Hitzeflimmerns mit übersetzen
    this.root.add(holder);
    for (const p of Object.values(this.props)) p.visible = true;
    try { renderer?.compile?.(this.scene, this.camera); } catch { /* optional */ }
    for (const p of Object.values(this.props)) p.visible = false;
    this.haze.mesh.visible = hazeVis;
    for (const c of [...holder.children]) holder.remove(c);
    this.root.remove(holder);
  }

  dispose() {
    this._disposed = true;
    this._offQuality?.();
    this.scene.remove(this.root);
    this.flash.group.removeFromParent();
    // Requisiten teilen Geometrien mit dem Modell-Cache: vor dem Entsorgen der Arme abhängen
    for (const p of Object.values(this.props)) p.removeFromParent();
    this.flash.dispose();
    this.smoke.dispose();
    this.shells.dispose();
    this.haze.dispose();
    this.arms.dispose();
    this.sun.dispose(); this.hemi.dispose(); this.rim.dispose();
    if (this._ownEnv) { if (this.scene.environment === this._ownEnv) this.scene.environment = null; this._ownEnv.dispose(); }
    this._models.clear();
    if (this.G?.viewmodel?.rig === this) this.G.viewmodel.rig = null;
  }
}

/** Empfohlenes vertikales Sichtfeld der Viewmodel-Kamera (Positionen sind darauf abgestimmt). */
ViewModel.FOV = 54;

// Welle 2 (Arsenal): zusätzliche Choreografien (Nachladen je Mechanik, Inspizieren je Klasse, Platte, Klingenhiebe);
// Animationen 09.10.: Nachladen mit Varianten, Magazin entlang der Schachtachse (anim/reloads.js, anim/magwell.js),
// vier Inspektionen je Mechanik mit Munitionsschätzung (anim/inspects.js), Ziehen je Klasse, Bereitmachen,
// Leerlauf-Gesten, Bewegungsposen, Nahkampf-/Wurfvarianten (anim/moves.js)
Object.assign(ViewModel.prototype, EXTRA_ACTIONS, RELOAD_ACTIONS, INSPECT_ACTIONS, MOVE_ACTIONS);

// Zubehör der Klassen-Arme (Binde, Stulpen, Wickel, Band) – Materialien modulweit, überdauern Matches
let _accMats = null;
function accessoryMats() {
  if (_accMats) return _accMats;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e6e0'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#c62424';
  for (const x of [16, 80]) { g.fillRect(x + 8, 6, 8, 20); g.fillRect(x + 2, 12, 20, 8); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _accMats = {
    armband: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, name: 'vm:armband' }),
    leather: new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, name: 'vm:leather' }),
    wrap: new THREE.MeshStandardMaterial({ color: 0x4d5a3a, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, name: 'vm:wrap' }),
    band: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, name: 'vm:band' }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a94a, roughness: 0.3, metalness: 1, side: THREE.DoubleSide, name: 'vm:gold' }),
  };
  return _accMats;
}
