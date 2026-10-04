// NULLPUNKT – Ego-Ansicht (Viewmodel): Waffe + Handschuh-Arme mit prozeduraler Animation.
// Hüfte/Anschlag (Visier exakt in Bildmitte), Atmen, Blick-Nachlauf, Achter-Wippen beim Gehen/Sprinten,
// Ducken, Sprung/Landung, federgedämpfter Rückstoß, Mündungsfeuer + Licht, Hülsen, Nachladen (taktisch/leer,
// Patrone für Patrone, Gurt, Magazin oben), Repetieren, Ziehen/Wegstecken, Messer, Granatwurf, Inspizieren.
//
// API (Vertrag §7, Erweiterungen siehe docs/ARCHITECTURE.md Changelog):
//   new ViewModel(G)          G.viewmodel.{scene,camera} (werden angelegt, falls nicht vorhanden)
//   setWeapon(weaponId, def?) update(dt, s) onShot(strength?, info?) playReload(empty) playMelee()
//   playGrenade(type?, opts?) releaseGrenade() playInspect() cancelAction() getMuzzleWorldPosition(out)
//   setVisible(bool) setLighting(lighting) showScopeOverlay warmup(renderer) dispose()
import * as THREE from 'three';
import { createWeaponModel } from './models.js';
import { WEAPONS } from '../../shared/weapons.data.js';
import { Arms, gripTransform, getPose, mixPose, newPose, copyPose, PROP_SHAPES } from './gunsmith/arms.js';
import { ID_TO_MODEL, handlingFor } from './gunsmith/handling.js';
import { MuzzleFlash, ShellPool, SmokeWisps } from './gunsmith/fx.js';
import { Spring, Spring3, curve, windowW, clamp, damp, smooth, easeOut, easeInOut, easeOutBack } from './gunsmith/anim.js';

const V3 = () => new THREE.Vector3();
const _v = V3(), _v2 = V3(), _v3 = V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const _s1 = V3();
const ZERO3 = [0, 0, 0];

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
    this.arms = new Arms();
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
    this._lighting = null;
    this._ownEnv = null;

    // Requisiten in der Hand: Messer (für Nahkampf mit Schusswaffe), Granaten
    this.props = {
      knife: this._prop(createWeaponModel('knife', { lod: 'first' })),
      frag: this._prop(createWeaponModel('frag', { lod: 'first' })),
      semtex: this._prop(createWeaponModel('semtex', { lod: 'first' })),
    };

    // Animationszustand
    this._models = new Map();
    this.cur = null;
    this._pending = null;
    this._equipT = 1; this._lowerT = 0; this._lowering = false;
    this.action = null;
    this._ads = 0; this._adsRaw = 0; this._sprint = 0; this._crouch = 0; this._move = 0; this._air = 0;
    this._phase = 0; this._time = 0; this._wasGround = true; this._airTime = 0;
    this._sway = new Spring3(110, 13);
    this._recoilPos = new Spring3(210, 20);
    this._recoilRot = new Spring3(170, 17);
    this._land = new Spring(90, 11);
    this._jolt = new Spring3(260, 22);
    this._boltT = 1; this._slideLocked = false; this._hammerT = 1;
    this._ctrlReload = false;
    this._visible = true;
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
    const ud = model.userData;
    model.updateMatrixWorld(true);
    const rg = ud.rightHandGrip, trg = ud.anchors.trigger;
    if (rg && trg && !rg.userData.trigger) rg.userData.trigger = rg.worldToLocal(trg.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0, -0.0045)).toArray().map(v => Math.round(v * 1e4) / 1e4);   // Vorderseite des Abzugs
    const rest = new Map();
    for (const [n, p] of Object.entries(ud.parts)) rest.set(n, { pos: p.position.clone(), quat: p.quaternion.clone(), vis: p.visible });
    entry = { id, key, model, ud, rest };
    this._models.set(id, entry);
    return entry;
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

  /** Nachladen starten. empty = Magazin leer (inkl. Durchladen). */
  playReload(empty = false) {
    if (!this.cur || this.h.reload === 'none') return;
    const d = this.def;
    if (this.h.reload === 'shell') {
      const timing = d?.shellTiming || { start: 0.3, insert: 0.48, end: 0.42 };
      const mag = d?.mag ?? 6;
      this._start('shells', 1e9, { empty, timing, shells: empty ? mag : Math.max(1, Math.round(mag / 2)), phase: 'start', pt: 0, inserted: 0 });
      return;
    }
    const dur = empty ? (d?.reloadEmptyTime ?? this.h.emptyTime) : (d?.reloadTime ?? this.h.reloadTime);
    this._start('reload', dur, { empty, style: this.h.reload });
  }

  playMelee() {
    if (!this.cur) return;
    const dur = WEAPONS.knife?.melee?.swingTime ?? 0.75;
    this._start(this.h.action === 'knife' ? 'slash' : 'melee', dur, { hit: false });
  }

  /** Granatwurf. type: 'frag' | 'semtex'. opts.hold = true hält nach dem Abziehen (Vorkochen) bis releaseGrenade(). */
  playGrenade(type = 'frag', opts = {}) {
    if (!this.cur) return;
    this._start('grenade', 1.0, { gtype: this.props[type] ? type : 'frag', hold: !!opts.hold, released: false });
  }

  releaseGrenade() { if (this.action?.type === 'grenade') this.action.hold = false; }

  playInspect() {
    if (!this.cur || this.action) return;
    this._start('inspect', this.h.inspect);
  }

  /** Laufende Aktion weich abbrechen (z. B. Nachladen beim Waffenwechsel). */
  cancelAction() {
    if (this.action && !this.action.cancel) { this.action.cancel = true; }
  }

  get isBusy() { return !!this.action || this._equipT < 1 || this._lowering; }
  get actionName() { return this.action ? this.action.type : null; }

  /** Schuss: Rückstoß, Mündungsfeuer, Verschluss/Schlitten, Hülse, ggf. Repetieren. */
  onShot(strength = 1, info = {}) {
    if (!this.cur) return;
    const h = this.h, k = h.kick, ads = this._ads;
    if (h.action === 'knife') { this.playMelee(); return; }
    const adsMul = 1 - 0.45 * ads, s = strength;
    const rnd = (Math.random() - 0.5) * 2;
    this._recoilPos.kick(rnd * k.side * 6 * adsMul * s, k.up * 1.4 * s * (1 - 0.5 * ads), k.back * 22 * s);
    this._recoilRot.kick(k.up * 22 * s * (1 - 0.35 * ads) + k.kickRot * 10 * s, rnd * k.side * 14 * adsMul * s, rnd * k.roll * 20 * adsMul * s);
    this._shotCount++;
    const suppressed = info.suppressed ?? this.def?.suppressed;
    if (!suppressed && !this.showScopeOverlay) this.flash.fire(h.flash, h.flashLen);
    if (!suppressed) {
      this.cur.ud.muzzle.getWorldPosition(_v);
      this.root.worldToLocal(_v);
      _v2.set(0, 0.2, -1).applyQuaternion(this.gun.quaternion);
      this.smoke.puff(_v, _v2, h.flash > 1.2 ? 1.2 : 0.8);
    }
    this._boltT = 0;
    this._hammerT = 0;
    if (info.empty && h.action === 'pistol') this._slideLocked = true;
    if (info.empty && (h.action === 'auto' || h.action === 'semi')) this._boltLocked = true;
    if (h.action === 'bolt') this._start('boltCycle', Math.max(0.6, Math.min(1.0, (this.def ? 60 / this.def.rpm : 1.3) - 0.35)), { delay: 0.12, ejected: false });
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
    this.shells.spawn(this.h.shell, _v, _v3, _q);
  }

  // ---------------------------------------------------------------- Licht

  /** Weltlicht übernehmen (late binding, wenn G.world beim Erzeugen noch fehlte). */
  setLighting(lighting) {
    this._lighting = lighting || null;
    const L = lighting;
    if (L) {
      this.sun.color.copy(L.sunColor ?? new THREE.Color(0xfff1dc));
      this.sun.intensity = (L.sunIntensity ?? 2.5) * 0.85;
      this.hemi.color.copy(L.hemiSky ?? new THREE.Color(0xc8d6ea));
      this.hemi.groundColor.copy(L.hemiGround ?? new THREE.Color(0x4a4036));
      this.hemi.intensity = (L.hemiIntensity ?? 0.9) * 1.1;
      this.scene.environment = L.envMap || this._ownEnv || null;
      this.scene.environmentIntensity = (L.envIntensity ?? 0.8) * 1.05;
      this._sunDir = (L.sunDirection ? L.sunDirection.clone() : new THREE.Vector3(0.4, 0.8, 0.3)).normalize();
      if (this._sunDir.y < 0) this._sunDir.negate();
    } else {
      this.sun.color.set(0xfff1dc); this.sun.intensity = 2.3;
      this.hemi.color.set(0xc8d6ea); this.hemi.groundColor.set(0x4a4036); this.hemi.intensity = 1.0;
      this._sunDir = new THREE.Vector3(0.5, 0.75, 0.35).normalize();
      this.scene.environmentIntensity = 0.9;
      this._ensureOwnEnv();
    }
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

  _updateLights() {
    // Hauptkamera-Drehung → Licht-/Umgebungsrichtung im Kameraraum
    const cam = this.G?.camera;
    const q = this._mainQuat;
    if (cam) cam.getWorldQuaternion(q); else q.identity();
    const inv = _q.copy(q).invert();
    _v.copy(this._sunDir).applyQuaternion(inv);
    this.sun.position.copy(_v).multiplyScalar(5);
    this.hemi.position.set(0, 1, 0).applyQuaternion(inv);
    if (this.scene.environment) {
      _e.setFromQuaternion(q, 'XYZ');
      this.scene.environmentRotation.set(-_e.x, -_e.y, -_e.z, 'XYZ');
    }
  }

  // ---------------------------------------------------------------- Hauptschleife

  update(dt, s = {}) {
    if (!this.G?.world?.lighting && !this._lighting) this._ensureOwnEnv();
    else if (this.G?.world?.lighting && this.G.world.lighting !== this._lighting) this.setLighting(this.G.world.lighting);
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    this._time += dt;
    // Wurzel folgt der Viewmodel-Kamera
    this.camera.updateMatrixWorld();
    this.camera.matrixWorld.decompose(this.root.position, this.root.quaternion, _s1);
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
    const busy = this.action && ['reload', 'shells', 'melee', 'grenade', 'slash', 'inspect'].includes(this.action.type);
    if (typeof s.adsProgress === 'number') this._ads = clamp(s.adsProgress, 0, 1);
    else {
      const adsTime = this.def?.adsTime ?? 0.25;
      const want = s.ads && !busy && h.action !== 'knife' ? 1 : 0;
      this._adsRaw = clamp(this._adsRaw + (want ? 1 : -1) * dt / Math.max(0.08, adsTime), 0, 1);
      this._ads = easeInOut(this._adsRaw);
    }
    const a = this._ads;
    const sprintWant = s.sprinting && a < 0.2 && !(this.action && ['reload', 'shells', 'grenade', 'melee', 'slash'].includes(this.action.type)) ? 1 : 0;
    this._sprint = damp(this._sprint, sprintWant, sprintWant ? 7 : 10, dt);
    this._crouch = damp(this._crouch, s.crouching ? 1 : 0, 8, dt);
    const onGround = s.onGround !== false;
    const speedN = clamp((s.speed ?? (s.moving ? 5.4 : 0)) / 5.4, 0, 1.7);
    this._move = damp(this._move, onGround ? speedN : 0, 10, dt);
    this._air = damp(this._air, onGround ? 0 : 1, 8, dt);

    // ---- Sprung / Landung
    if (!onGround) this._airTime += dt;
    if (this._wasGround && !onGround) { this._land.kick(0.55); this._jolt.kick(0, 0, 0); }
    if (!this._wasGround && onGround) {
      const k = clamp(this._airTime / 0.6, 0.3, 1.4);
      this._land.kick(-1.6 * k);
      this._jolt.kick(-0.6 * k, 0, 0);
      this._airTime = 0;
    }
    this._wasGround = onGround;

    // ---- Wippen (Achterfigur), Atmen, Blick-Nachlauf
    const weight = h.weight;
    const freq = (1.75 + 0.55 * this._sprint) * (0.75 + 0.25 * Math.min(1, speedN)) / Math.sqrt(weight);
    this._phase += dt * Math.PI * 2 * freq * (this._move > 0.02 ? 1 : 0);
    const bobAmp = this._move * (1 - 0.88 * a) * Math.sqrt(weight);
    const sp = this._sprint;
    const ph = this._phase;
    const bobX = Math.sin(ph) * (0.0065 + 0.013 * sp) * bobAmp;
    const bobY = (Math.sin(ph * 2) * (0.0045 + 0.007 * sp) - 0.002 * sp) * bobAmp;
    const bobRZ = Math.sin(ph) * (0.012 + 0.05 * sp) * bobAmp;
    const bobRX = Math.sin(ph * 2) * (0.008 + 0.02 * sp) * bobAmp;
    const bobRY = Math.cos(ph) * (0.006 + 0.03 * sp) * bobAmp;
    const breath = Math.sin(this._time * 1.35) * (1 - 0.75 * a) * (1 - this._move * 0.5);
    const lx = s.lookDX || 0, ly = s.lookDY || 0;
    const wx = clamp(-lx / Math.max(dt, 1 / 240) * 0.012, -0.055, 0.055) * (1 - 0.65 * a);
    const wy = clamp(-ly / Math.max(dt, 1 / 240) * 0.01, -0.045, 0.045) * (1 - 0.65 * a);
    const sw = this._sway.update(dt / Math.sqrt(weight), wx, wy, 0);

    // ---- Rückstoß, Landung, Stöße
    const rp = this._recoilPos.update(dt, 0, 0, 0);
    const rr = this._recoilRot.update(dt, 0, 0, 0);
    const land = this._land.update(dt, 0);
    const jolt = this._jolt.update(dt, 0, 0, 0);

    // ---- Grundpose: Hüfte ↔ Anschlag
    const ads3 = this.cur.ud.adsOffset;
    const hip = h.hip, hr = h.hipRot;
    const P = this._gunPos.set(hip[0] + (ads3.x - hip[0]) * a, hip[1] + (ads3.y - hip[1]) * a, hip[2] + (ads3.z - hip[2]) * a);
    const R = this._gunRot.set(hr[0] * (1 - a), hr[1] * (1 - a), hr[2] * (1 - a));
    const na = 1 - a;
    P.x += h.sprintPos[0] * sp * na + h.crouchPos[0] * this._crouch * na;
    P.y += h.sprintPos[1] * sp * na + h.crouchPos[1] * this._crouch * na;
    P.z += h.sprintPos[2] * sp * na + h.crouchPos[2] * this._crouch * na;
    R.x += h.sprintRot[0] * sp * na + h.crouchRot[0] * this._crouch * na;
    R.y += h.sprintRot[1] * sp * na + h.crouchRot[1] * this._crouch * na;
    R.z += h.sprintRot[2] * sp * na + h.crouchRot[2] * this._crouch * na;
    // Wippen + Atmen + Nachlauf
    P.x += bobX + sw.x * 0.16;
    P.y += bobY + breath * 0.0011 + sw.y * 0.12 + land * 0.035 - this._air * 0.012 * na;
    R.x += bobRX + breath * 0.004 + sw.y * 0.9 + land * 0.05 + jolt.x * 0.05 + this._air * 0.03 * na;
    R.y += bobRY + sw.x * 1.1;
    R.z += bobRZ + sw.x * 0.7;
    // Rückstoß
    P.x += rp.x * 0.01; P.y += rp.y * 0.01; P.z += rp.z * 0.01;
    R.x += rr.x * 0.01; R.y += rr.y * 0.01; R.z += rr.z * 0.01;
    // Ziehen / Wegstecken
    const eq = this._lowering ? 1 - smooth(1 - this._lowerT) : 1 - easeOut(this._equipT);
    if (eq > 0) {
      P.x += 0.02 * eq; P.y += -0.3 * eq; P.z += 0.08 * eq;
      R.x += -0.95 * eq; R.y += 0.25 * eq; R.z += 0.55 * eq;
    }

    // ---- Aktion (Nachladen, Nahkampf, Granate …)
    const act = this._evalAction(dt, s);
    if (act) {
      P.x += act.p[0]; P.y += act.p[1]; P.z += act.p[2];
      R.x += act.r[0]; R.y += act.r[1]; R.z += act.r[2];
    }

    this.gun.position.copy(P);
    this.gun.rotation.set(R.x, R.y, R.z, 'YXZ');

    // ---- Bewegliche Teile: Verschluss/Schlitten/Hahn
    this._animParts(dt, act);

    // ---- Zielfernrohr: voll im Anschlag → Overlay, Waffe ausblenden
    const scoped = this._scopeOverlay === 'sniper' && a > 0.96 && (!this.action || this.action.type === 'boltCycle');
    this.showScopeOverlay = scoped;
    this.root.visible = this._visible && !scoped;
    if (scoped) this.flash.hide();

    // ---- Hände
    this.root.updateMatrixWorld(true);
    this._rootInv.copy(this.root.matrixWorld).invert();
    this._solveHands(act);

    // ---- Effekte
    this.cur.ud.muzzle.getWorldPosition(_v);
    this.flash.light.position.copy(this.root.worldToLocal(_v));
    this.flash.update(dt);
    this.smoke.update(dt);
    this.shells.setGravity(_v.set(0, -7.5, 0).applyQuaternion(_q.copy(this._mainQuat).invert()));
    this.shells.update(dt);
    this.arms.update(dt);
    this._updateLights();
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
    // Rechte Hand: Pistolengriff (Messer: Faustgriff)
    this._anchorTarget(ud.rightHandGrip, h.action === 'knife' ? 'knife' : 'pistolGrip', ud.rightHandGrip.userData, R, 1);
    if (act) this._applyRequests(act.right, R, 1);
    this.arms.right.applyPose(R.pose);
    this.arms.right.solve(R.pos, R.quat);
    // Requisiten in der rechten Hand (Granate) für den Splint-Griff aktualisieren
    this.arms.right.handBone.updateWorldMatrix(true, true);
    // Linke Hand: Stützgriff
    const lg = ud.leftHandGrip, style = lg.userData.style || h.leftGrip;
    if (h.leftGrip === 'none') this._freeTarget([-0.12, -0.34, -0.22], [0.3, 0.6, -0.8], [-0.6, 0.2, 0.3], 'relaxed', L);
    else this._anchorTarget(lg, style, lg.userData, L, -1);
    if (act) this._applyRequests(act.left, L, -1);
    this.arms.left.applyPose(L.pose);
    this.arms.left.solve(L.pos, L.quat);
  }

  // Handanfragen einer Aktion der Reihe nach einmischen
  _applyRequests(list, target, side) {
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
    }
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
    } else if (this._part('bolt') && h.action !== 'bolt' && h.action !== 'pump') {
      this._setPartOffset('bolt', 0, 0, h.boltTravel * (this._boltLocked ? 1 : pulse));
    }
    // Aktionsteile (Magazin, Ladehebel, Pumpe, Kammerstängel, Deckel …)
    if (act && act.parts) for (const [n, o] of Object.entries(act.parts)) {
      if (n === '_vis') continue;
      this._setPartOffset(n, o[0] || 0, o[1] || 0, o[2] || 0, o[3] || 0, o[4] || 0, o[5] || 0);
    }
    if (act && act.parts && act.parts._vis) for (const [n, v] of Object.entries(act.parts._vis)) { const p = this._part(n); if (p) p.visible = v; }
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
    out.left.n = 0; out.right.n = 0;
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
      case 'inspect': done = this._actInspect(A, out); break;
      default: done = true;
    }
    const f = A.cancel ? Math.max(0, A.fade) : 1;
    if (f < 1) {
      for (let i = 0; i < 3; i++) { out.p[i] *= f; out.r[i] *= f; }
      for (let i = 0; i < out.left.n; i++) out.left.items[i].w *= f;
      for (let i = 0; i < out.right.n; i++) out.right.items[i].w *= f;
      for (const k in out.parts) if (k !== '_vis') out.parts[k] = out.parts[k].map(v => v * f);
    }
    if (done) { this.action = null; this._hideProps(); }
    return out;
  }

  _hideProps() {
    for (const p of Object.values(this.props)) p.visible = false;
  }

  _actReload(A, out) {
    const u = clamp(A.t / A.dur, 0, 1);
    const ud = this.cur.ud, style = A.style, empty = A.empty;
    const anchors = ud.anchors;
    if (style === 'pistol') return this._actReloadPistol(A, out, u);
    if (style === 'belt') return this._actReloadBelt(A, out, u);
    if (style === 'top') return this._actReloadTop(A, out, u);
    // Standard-Magazinwechsel (optional mit Durchladen am Ende)
    const k = empty ? 0.74 : 1;     // Magazin-Teil wird bei Leer-Nachladen gestaucht
    const m = u / k;
    // Waffe kippen
    // Waffe anheben, heranziehen und im Uhrzeigersinn rollen: Magazinschacht zur Stützhand
    curve(m, [[0, ZERO3], [0.13, [0.16, 0.2, -0.46]], [0.8, [0.18, 0.22, -0.5]], [0.95, ZERO3]], out.r);
    curve(m, [[0, ZERO3], [0.13, [-0.045, 0.045, 0.05]], [0.8, [-0.045, 0.05, 0.05]], [0.95, ZERO3]], out.p);
    // Magazin: raus nach unten, aus dem Bild, neues hinein
    const mag = curve(m, [[0.26, ZERO3], [0.36, [0, -0.07, 0.012]], [0.47, [-0.16, -0.5, 0.12]], [0.48, [-0.12, -0.45, 0.1]], [0.58, [0, -0.08, 0.014]], [0.65, [0, -0.01, 0.002]], [0.67, ZERO3]]);
    const magRot = curve(m, [[0.26, 0], [0.4, 0.25], [0.48, 0.25], [0.58, 0.12], [0.67, 0]]);
    out.parts.mag = [mag[0], mag[1], mag[2], magRot, 0, 0];
    if (m > 0.66 && m < 0.7 && !A.slapped) { A.slapped = true; this._jolt.kick(1.2, 0, 0); this._recoilPos.kick(0, 0.4, 0); }
    // Linke Hand: zum Magazin, mit ihm hinaus und zurück
    const wMag = windowW(m, 0.14, 0.25, 0.68, 0.8);
    if (wMag > 0 && ud.anchors.magGrab) req(out.left, wMag, { anchor: ud.anchors.magGrab, style: 'mag' });
    if (empty) {
      const c = (u - 0.74) / 0.26;   // 0..1 Durchladen
      const ch = anchors.chargeGrab;
      if (ch && ch.userData.style === 'release' && anchors.boltCatch && c > -0.05) {
        // Verschlussfang mit dem Handballen schlagen: Verschluss schnellt vor
        const wC = windowW(c, 0.0, 0.32, 0.55, 0.85);
        if (wC > 0) req(out.left, wC, { anchor: anchors.boltCatch, style: 'slapSide' });
        if (c > 0.45 && !A.charged) { A.charged = true; this._boltLocked = false; this._boltT = 0.3; this._jolt.kick(0.9, 0.25, 0); }
        const rc = windowW(c, 0.0, 0.25, 0.55, 0.95);
        out.r[2] += 0.12 * rc; out.r[1] += 0.06 * rc;
      } else if (ch && c > -0.05) {
        const st = ch.userData.style || 'pull';
        const travel = ch.userData.travel || [0, 0, 0.06];
        const pull = curve(c, [[0.2, 0], [0.42, 1], [0.52, 1], [0.56, 0]]);
        const partName = ch.parent?.name || 'charge';
        const lift = st === 'hkslap' ? -0.6 * windowW(c, 0.3, 0.42, 0.5, 0.56) : 0;
        out.parts[partName] = [travel[0] * pull, travel[1] * pull, travel[2] * pull, 0, 0, lift];
        const wC = windowW(c, 0.0, 0.18, 0.6, 0.85);
        // Ladehebel rechts (KV-47): die Schusshand verlässt kurz den Griff; sonst greift die Stützhand
        if (wC > 0) req(st === 'right' ? out.right : out.left, wC, { anchor: ch, style: st === 'right' ? 'pinchRight' : 'pinchSide' });
        // Waffe zum Durchladen drehen (Hebelseite zur Kamera)
        const rc = windowW(c, 0.0, 0.2, 0.62, 0.95);
        out.r[2] += (st === 'right' ? 0.38 : 0.18) * rc; out.r[0] += 0.08 * rc; out.r[1] += (st === 'right' ? 0.12 : 0.1) * rc;
        out.p[0] += (st === 'right' ? -0.03 : -0.02) * rc; out.p[1] += (st === 'right' ? 0.02 : 0) * rc;
        if (c > 0.55 && c < 0.6 && !A.charged) { A.charged = true; this._jolt.kick(0.8, 0.3, 0); }
      }
      // Repetierer: Kammerstängel nach dem Magazinwechsel
      if (this.h.action === 'bolt' && c > 0) this._boltMotion(c, out, true);
    }
    return u >= 1;
  }

  _boltMotion(c, out, inReload) {
    const bg = this.cur.ud.anchors.boltGrab;
    if (!bg) return;
    const rot = bg.userData.rot ?? 1.05, travel = bg.userData.travel?.[2] ?? 0.09;
    const up = curve(c, [[0.18, 0], [0.3, 1], [0.66, 1], [0.78, 0]]);
    const back = curve(c, [[0.3, 0], [0.45, 1], [0.52, 1], [0.66, 0]]);
    out.parts.boltHandle = [0, 0, travel * back, 0, 0, rot * up];
    const w = windowW(c, 0.02, 0.17, 0.8, 0.96);
    if (w > 0) req(out.right, w, { anchor: bg, style: 'boltKnob' });
    const rc = windowW(c, 0.0, 0.18, 0.8, 1.0);
    out.r[2] += 0.16 * rc; out.r[0] += 0.05 * rc; out.r[1] += 0.06 * rc; out.p[1] += -0.015 * rc;
    if (!inReload && c > 0.47 && this.action && !this.action.ejected) { this.action.ejected = true; this._eject(); }
  }

  _actBolt(A, out) {
    const c = clamp(A.t / A.dur, 0, 1);
    this._boltMotion(c, out, false);
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

  _actShells(A, out, dt) {
    const T = A.timing, ud = this.cur.ud;
    // Phasen: start → insert × n → end (Pumpe bei leer)
    A.pt += dt;
    if (A.phase === 'start' && A.pt >= T.start) { A.phase = 'insert'; A.pt = 0; }
    else if (A.phase === 'insert' && A.pt >= T.insert) {
      A.inserted++; A.pt = 0;
      const ctrl = this._ctrlReload;
      if (A.stop || (!ctrl && A.inserted >= A.shells)) { A.phase = 'end'; }
    } else if (A.phase === 'end' && A.pt >= T.end + (A.empty ? 0.45 : 0)) return true;
    if (A.phase === 'insert' && A.stop) { A.phase = 'end'; A.pt = 0; }
    // Kippen: Ladeöffnung zur linken Hand
    let tilt;
    if (A.phase === 'start') tilt = smooth(clamp(A.pt / T.start, 0, 1));
    else if (A.phase === 'insert') tilt = 1;
    else tilt = 1 - smooth(clamp(A.pt / T.end, 0, 1));
    out.r[0] = 0.18 * tilt; out.r[1] = 0.12 * tilt; out.r[2] = -0.42 * tilt;
    out.p[0] = -0.03 * tilt; out.p[1] = 0.03 * tilt; out.p[2] = 0.02 * tilt;
    // Linke Hand: Patrone holen und von unten einschieben
    const port = ud.anchors.shellPort;
    if (A.phase === 'insert' && port) {
      const c = clamp(A.pt / T.insert, 0, 1);
      const shellOff = curve(c, [[0, [-0.06, -0.3, 0.06]], [0.45, [0, -0.045, 0.02]], [0.62, [0, -0.012, 0.004]], [0.78, [0, 0.008, -0.03]]]);
      out.parts.shell = [shellOff[0], shellOff[1], shellOff[2], 0.3 * (1 - c), 0, 0];
      out.parts._vis = { shell: c < 0.8 };
      // Hand hält die Patrone (folgt dem Patronen-Teil)
      req(out.left, 1, { part: 'shell', style: 'mag', offset: [0, -0.012, 0.02] });
      if (c > 0.62 && c < 0.7 && !A.pushed) { A.pushed = true; this._jolt.kick(0.6, 0, 0); }
      if (c < 0.1) A.pushed = false;
    } else {
      const w = A.phase === 'start' ? smooth(clamp(A.pt / T.start, 0, 1)) : A.phase === 'end' ? 1 - smooth(clamp(A.pt / Math.max(0.1, T.end * 0.6), 0, 1)) : 1;
      if (w > 0 && port) req(out.left, w * 0.85, { anchor: port, style: 'mag', dy: -0.12 * (1 - w) });
      // Pumpen nach Leer-Nachladen
      if (A.phase === 'end' && A.empty) {
        const c = clamp((A.pt - T.end * 0.5) / 0.45, 0, 1);
        const travel = ud.anchors.pumpGrab?.userData.travel?.[2] ?? 0.085;
        out.parts.pump = [0, 0, travel * curve(c, [[0, 0], [0.4, 1], [0.5, 1], [0.85, 0]])];
      }
    }
    return false;
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

  _actReloadPistol(A, out, u) {
    const ud = this.cur.ud, empty = A.empty;
    curve(u, [[0, ZERO3], [0.12, [0.36, 0.22, -0.42]], [0.8, [0.38, 0.24, -0.45]], [0.95, ZERO3]], out.r);
    curve(u, [[0, ZERO3], [0.12, [-0.035, 0.06, 0.04]], [0.8, [-0.035, 0.062, 0.04]], [0.95, ZERO3]], out.p);
    // Magazin fällt entlang der Griffachse heraus, neues kommt von unten links
    const mag = curve(u, [[0.12, ZERO3], [0.2, [0, -0.07, 0.025]], [0.3, [0.02, -0.5, 0.15]], [0.31, [-0.12, -0.3, 0.1]], [0.48, [-0.02, -0.075, 0.03]], [0.58, [0, -0.012, 0.004]], [0.62, ZERO3]]);
    out.parts.mag = [mag[0], mag[1], mag[2]];
    if (u > 0.6 && !A.slapped) { A.slapped = true; this._jolt.kick(1.4, 0, 0); this._recoilPos.kick(0, 0.5, 0); }
    // Linke Hand verlässt den Stützgriff, holt das neue Magazin, setzt es ein
    const wAway = windowW(u, 0.1, 0.22, 0.66, 0.82);
    if (wAway > 0) {
      if (u < 0.3) req(out.left, wAway, { free: [[-0.1, -0.32, -0.22], [0.4, 0.5, -0.7], [-0.7, 0.4, 0.2], 'relaxed'] });
      else req(out.left, wAway, { anchor: ud.anchors.magGrab || ud.magazine, style: 'mag' });
    }
    // Schlittenfang lösen (leer): Schlitten schnellt vor
    if (empty) {
      if (u < 0.74) this._slideLocked = true;
      else if (this._slideLocked) { this._slideLocked = false; this._boltT = 0.3; this._jolt.kick(0.9, 0.2, 0); }
    }
    return u >= 1;
  }

  _actReloadTop(A, out, u) {
    // Magazin oben (QX-90): nach oben-hinten abziehen, neues von vorn auflegen und einrasten
    const ud = this.cur.ud, empty = A.empty;
    const k = empty ? 0.78 : 1, m = u / k;
    curve(m, [[0, ZERO3], [0.14, [0.1, 0.24, 0.42]], [0.8, [0.1, 0.24, 0.44]], [0.95, ZERO3]], out.r);
    curve(m, [[0, ZERO3], [0.14, [-0.01, -0.05, -0.03]], [0.8, [-0.01, -0.05, -0.03]], [0.95, ZERO3]], out.p);
    const mag = curve(m, [[0.25, ZERO3], [0.33, [0, 0.022, 0.03]], [0.45, [-0.2, -0.35, 0.15]], [0.46, [-0.2, -0.3, -0.05]], [0.58, [0, 0.03, -0.02]], [0.66, [0, 0.008, 0]], [0.69, ZERO3]]);
    const magRot = curve(m, [[0.25, 0], [0.33, -0.18], [0.46, -0.3], [0.58, -0.1], [0.69, 0]]);
    out.parts.mag = [mag[0], mag[1], mag[2], magRot, 0, 0];
    if (m > 0.68 && !A.slapped) { A.slapped = true; this._jolt.kick(1.3, 0, 0); }
    const wMag = windowW(m, 0.14, 0.25, 0.7, 0.82);
    if (wMag > 0 && ud.anchors.magGrab) req(out.left, wMag, { anchor: ud.anchors.magGrab, style: 'magTop' });
    if (empty) {
      const c = (u - 0.78) / 0.22;
      const ch = ud.anchors.chargeGrab;
      if (ch && c > -0.05) {
        const travel = ch.userData.travel || [0, 0, 0.06];
        const pull = curve(c, [[0.2, 0], [0.45, 1], [0.55, 1], [0.6, 0]]);
        out.parts.charge = [0, 0, travel[2] * pull];
        const wC = windowW(c, 0.0, 0.2, 0.62, 0.9);
        if (wC > 0) req(out.left, wC, { anchor: ch, style: 'pinchSide' });
        if (c > 0.58 && !A.charged) { A.charged = true; this._jolt.kick(0.8, 0.2, 0); }
      }
    }
    return u >= 1;
  }

  _actReloadBelt(A, out, u) {
    // Gurtwechsel (HM-60): Deckel auf, Kasten raus, neuer Kasten + Gurt, Deckel zu, ggf. durchladen
    const ud = this.cur.ud, empty = A.empty;
    curve(u, [[0, ZERO3], [0.08, [0.1, 0.3, 0.36]], [0.86, [0.1, 0.32, 0.38]], [0.97, ZERO3]], out.r);
    curve(u, [[0, ZERO3], [0.08, [0.0, -0.035, -0.02]], [0.86, [0.0, -0.035, -0.02]], [0.97, ZERO3]], out.p);
    const cover = curve(u, [[0.1, 0], [0.18, -1.15], [0.66, -1.15], [0.74, 0]]);
    out.parts.cover = [0, 0, 0, cover, 0, 0];
    if (u > 0.735 && !A.slapped) { A.slapped = true; this._jolt.kick(1.5, 0, 0); }
    const box = curve(u, [[0.26, ZERO3], [0.34, [-0.04, -0.08, 0.02]], [0.44, [-0.25, -0.5, 0.1]], [0.45, [-0.22, -0.45, 0.05]], [0.56, [-0.02, -0.06, 0.01]], [0.6, ZERO3]]);
    out.parts.mag = [box[0], box[1], box[2]];
    const belt = curve(u, [[0.58, [0, -0.02, 0]], [0.66, ZERO3]]);
    out.parts.belt = [belt[0], belt[1], belt[2]];
    out.parts._vis = { belt: !(u > 0.3 && u < 0.6) };
    // Hand: Deckel öffnen → Kasten → Gurt einlegen → Deckel schließen
    const coverReq = { part: 'cover', style: 'pinchSide', offset: [-0.028, 0.02, 0.232] };
    if (u < 0.24) req(out.left, windowW(u, 0.06, 0.12, 0.2, 0.26), coverReq);
    else if (u < 0.62) { if (ud.anchors.magGrab) req(out.left, windowW(u, 0.2, 0.28, 0.58, 0.64), { anchor: ud.anchors.magGrab, style: 'mag' }); }
    else if (u < 0.8) req(out.left, windowW(u, 0.6, 0.66, 0.74, 0.82), coverReq);
    if (empty) {
      const c = (u - 0.8) / 0.18;
      const ch = ud.anchors.chargeGrab;
      if (ch && c > -0.05) {
        const travel = ch.userData.travel || [0, 0, 0.1];
        out.parts.charge = [0, 0, travel[2] * curve(c, [[0.2, 0], [0.45, 1], [0.55, 1], [0.62, 0]])];
        const wC = windowW(c, 0.0, 0.2, 0.62, 0.9);
        if (wC > 0) req(out.right, wC, { anchor: ch, style: 'pinchRight' });
        const rc = windowW(c, 0.0, 0.2, 0.62, 0.95);
        out.r[2] += 0.2 * rc; out.r[1] += 0.08 * rc;
      }
    }
    return u >= 1;
  }

  _actMelee(A, out) {
    // Schnelles Messer mit der linken Hand, Waffe kippt nach rechts unten weg
    const u = clamp(A.t / A.dur, 0, 1);
    const gw = windowW(u, 0.0, 0.1, 0.55, 0.85);
    out.p[0] = 0.07 * gw; out.p[1] = -0.2 * gw; out.p[2] = 0.06 * gw;
    out.r[0] = -0.55 * gw; out.r[1] = -0.35 * gw; out.r[2] = -0.5 * gw;
    const knife = this.props.knife;
    const w = windowW(u, 0.0, 0.07, 0.5, 0.72);
    const pos = curve(u, [[0.0, [-0.2, -0.3, -0.18]], [0.07, [-0.2, 0.03, -0.27]], [0.16, [-0.02, -0.06, -0.4]], [0.26, [0.15, -0.2, -0.36]], [0.45, [0.16, -0.26, -0.3]], [0.72, [-0.1, -0.42, -0.2]]]);
    const F = curve(u, [[0.0, [0.2, 0.8, -0.5]], [0.07, [0.55, 0.65, -0.4]], [0.16, [0.75, -0.1, -0.65]], [0.26, [0.5, -0.6, -0.6]], [0.72, [0.3, -0.6, -0.6]]]);
    req(out.left, w, { free: [pos, F, [0.0, 0.3, 0.9], 'knife'] });
    this._attachProp(knife, this.arms.left.handBone, 'knife', -1);
    knife.visible = u > 0.02 && u < 0.7;
    if (u > 0.18 && !A.hit) { A.hit = true; this.onMeleeHit?.(); this._jolt.kick(0.6, 0.5, 0); }
    return u >= 1;
  }

  _actSlash(A, out) {
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
    const rp = curve(u, [[0.05, [0.2, -0.4, -0.2]], [0.2, [0.09, -0.12, -0.3]], [0.47, [0.07, -0.1, -0.29]], [0.58, [0.2, -0.02, -0.12]], [0.68, [0.03, 0.04, -0.48]], [0.8, [-0.06, -0.32, -0.36]], [0.96, [0.0, -0.45, -0.25]]]);
    const rF = curve(u, [[0.05, [-0.4, 0.6, -0.6]], [0.2, [-0.45, 0.55, -0.55]], [0.47, [-0.45, 0.55, -0.55]], [0.58, [-0.1, 0.9, 0.2]], [0.68, [0.0, 0.3, -0.95]], [0.8, [-0.1, -0.6, -0.7]]]);
    req(out.right, rw, { free: [rp, rF, [0.75, 0.2, 0.45], 'ball'] });
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

  _actInspect(A, out) {
    const u = clamp(A.t / A.dur, 0, 1);
    curve(u, [[0, ZERO3], [0.14, [-0.1, 0.045, 0.05]], [0.42, [-0.1, 0.05, 0.05]], [0.56, [-0.07, 0.03, 0.03]], [0.84, [-0.07, 0.035, 0.03]], [1, ZERO3]], out.p);
    curve(u, [[0, ZERO3], [0.14, [0.18, -0.55, -0.5]], [0.42, [0.22, -0.6, -0.55]], [0.56, [-0.05, 0.7, 0.75]], [0.84, [-0.08, 0.75, 0.8]], [1, ZERO3]], out.r);
    return u >= 1;
  }

  // Requisit an einen Handknochen hängen (Messer/Granate)
  _attachProp(prop, bone, kind, side) {
    if (prop.parent !== bone) bone.add(prop);
    if (kind === 'knife') {
      // Klinge zeigt aus der Faust zur Daumenseite, Schneide zu den Fingern
      const k = PROP_SHAPES.knife.pos;
      prop.position.set(k[0] * side, k[1], k[2]);
      prop.quaternion.setFromEuler(_e.set(0, side * Math.PI / 2, side > 0 ? Math.PI : 0));
      prop.rotateZ(Math.PI);
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
    if (!main) return out;
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

  /** Alle Waffenmodelle vorbauen und Shader kompilieren (z. B. im Ladebildschirm). */
  warmup(renderer, ids = Object.keys(ID_TO_MODEL)) {
    const prev = this.cur;
    const holder = new THREE.Group();
    for (const id of ids) {
      const e = this._getModel(id, (this._defFor(id)?.model) || ID_TO_MODEL[id] || id);
      if (e !== prev) holder.add(e.model);
    }
    this.root.add(holder);
    for (const p of Object.values(this.props)) p.visible = true;
    try { renderer?.compile?.(this.scene, this.camera); } catch { /* optional */ }
    for (const p of Object.values(this.props)) p.visible = false;
    for (const c of [...holder.children]) holder.remove(c);
    this.root.remove(holder);
  }

  dispose() {
    this._disposed = true;
    this.scene.remove(this.root);
    this.flash.group.removeFromParent();
    this.flash.dispose();
    this.smoke.dispose();
    this.shells.dispose();
    this.arms.dispose();
    this.sun.dispose(); this.hemi.dispose(); this.rim.dispose();
    if (this._ownEnv) { if (this.scene.environment === this._ownEnv) this.scene.environment = null; this._ownEnv.dispose(); }
    this._models.clear();
    if (this.G?.viewmodel?.rig === this) this.G.viewmodel.rig = null;
  }
}

/** Empfohlenes vertikales Sichtfeld der Viewmodel-Kamera (Positionen sind darauf abgestimmt). */
ViewModel.FOV = 54;
