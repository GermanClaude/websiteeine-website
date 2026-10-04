// NULLPUNKT — Stub für weapons/viewmodel.js (§7): Kastenarme + Kastenwaffe im Viewmodel-Szenengraph,
// Hüft-/Anschlagposition, Schwanken, Wippen, Sprinthaltung, Rückstoß, Nachladen, Mündungsfeuer.

import * as THREE from 'three';
import * as stubModels from './models.js';

const HIP = new THREE.Vector3(0.16, -0.19, -0.42);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class ViewModel {
  constructor(G) {
    this.G = G;
    this.scene = G.viewmodel.scene;
    this.camera = G.viewmodel.camera;
    this.showScopeOverlay = false;
    this.weaponId = null;
    this.def = null;
    this._visible = true;
    this._disposables = [];

    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.scene.add(this.root);
    this.gunHolder = new THREE.Group();
    this.root.add(this.gunHolder);

    // Licht passend zur Welt
    const L = G.world && G.world.lighting;
    this.hemi = new THREE.HemisphereLight(L ? L.hemiSky : 0xbcd4f2, L ? L.hemiGround : 0x6b5a48, (L ? L.hemiIntensity : 0.8) * 1.1);
    this.sun = new THREE.DirectionalLight(L ? L.sunColor : 0xfff0d8, (L ? L.sunIntensity : 2.5) * 0.8);
    this.sun.position.set(-0.6, 1.2, 0.8);
    this.scene.add(this.hemi, this.sun);
    if (L && L.envMap) this.scene.environment = L.envMap;

    // Arme (Ärmel + Handschuhe)
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4b5240, roughness: 0.95 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.8 });
    this._disposables.push(sleeve, glove);
    const arm = (w, h, d, m) => { const g = new THREE.BoxGeometry(w, h, d); this._disposables.push(g); return new THREE.Mesh(g, m); };
    this.rightArm = new THREE.Group();
    const ra = arm(0.07, 0.07, 0.42, sleeve); ra.position.set(0.03, -0.05, 0.25);
    const rh = arm(0.065, 0.075, 0.09, glove); rh.position.set(0, -0.03, 0.03);
    this.rightArm.add(ra, rh);
    this.leftArm = new THREE.Group();
    const la = arm(0.07, 0.07, 0.42, sleeve); la.position.set(-0.05, -0.06, 0.2); la.rotation.y = 0.35;
    const lh = arm(0.065, 0.06, 0.09, glove);
    this.leftArm.add(la, lh);
    this.gunHolder.add(this.rightArm, this.leftArm);

    // Mündungsfeuer
    const flashTex = makeFlashTexture();
    this._disposables.push(flashTex);
    this.flashMat = new THREE.SpriteMaterial({ map: flashTex, color: 0xffd28a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1 });
    this._disposables.push(this.flashMat);
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.scale.set(0.16, 0.16, 0.16);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb060, 0, 2.5, 2);

    this.model = null;
    this._muzzle = null;
    this._adsOffsetY = -0.09;
    // Animationszustand
    this._swayX = 0; this._swayY = 0;
    this._bob = 0;
    this._sprint = 0;
    this._kick = 0; this._kickV = 0;
    this._raise = 1;
    this._flashT = 0;
    this._action = null; // { type, t, dur }
    this._ads = 0;
  }

  setWeapon(weaponId) {
    const G = this.G;
    const def = (G.data && G.data.WEAPONS && G.data.WEAPONS[weaponId]) || null;
    if (this.model) {
      this.flash.removeFromParent();
      this.flashLight.removeFromParent();
      this.gunHolder.remove(this.model);
      disposeTree(this.model);
    }
    const models = G.modules && G.modules.models && G.modules.models.createWeaponModel ? G.modules.models : stubModels;
    let model;
    try { model = models.createWeaponModel(def ? def.model : weaponId, { lod: 'first' }); } catch { model = stubModels.createWeaponModel(def ? def.model : weaponId, { lod: 'first' }); }
    model.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    this.model = model;
    this.gunHolder.add(model);
    const ud = model.userData || {};
    this._muzzle = ud.muzzle || null;
    (this._muzzle || model).add(this.flash, this.flashLight);
    this._adsOffsetY = ud.adsOffset ? ud.adsOffset.y : -0.09;
    const grip = ud.leftHandGrip;
    if (grip) this.leftArm.position.copy(grip.position); else this.leftArm.position.set(-0.02, 0, -0.2);
    this.rightArm.position.set(0, -0.01, 0.02);
    this.weaponId = weaponId;
    this.def = def;
    this._raise = 0;
  }

  update(dt, s = {}) {
    // Rückstoßfeder
    this._kickV += (-this._kick * 260 - this._kickV * 2 * Math.sqrt(260)) * dt;
    this._kick += this._kickV * dt;
    this._raise = Math.min(1, this._raise + dt / 0.32);
    this._ads += ((s.ads ? 1 : 0) - this._ads) * damp(30, dt);
    const ads = s.adsProgress !== undefined ? s.adsProgress : this._ads;
    this._sprint += ((s.sprinting ? 1 : 0) - this._sprint) * damp(9, dt);
    // Schwanken (verzögert dem Blick folgend)
    this._swayX += (-(s.lookDX || 0) * 2.2 - this._swayX) * damp(10, dt);
    this._swayY += (-(s.lookDY || 0) * 2.2 - this._swayY) * damp(10, dt);
    const speed = s.onGround === false ? 0 : Math.min(1.6, (s.speed || 0) / 5.4);
    this._bob += dt * (6 + speed * 5) * (speed > 0.05 ? 1 : 0);
    const bobAmp = speed * (1 - 0.85 * ads);

    // Grundpose: Hüfte ↔ Anschlag
    const p = this.root.position;
    p.set(
      HIP.x * (1 - ads),
      HIP.y + (this._adsOffsetY - HIP.y) * ads,
      HIP.z + (-0.3 - HIP.z) * ads,
    );
    p.x += Math.sin(this._bob) * 0.012 * bobAmp + this._swayX * 0.02 + this._sprint * 0.03;
    p.y += -Math.abs(Math.cos(this._bob)) * 0.012 * bobAmp + this._swayY * 0.02 - this._sprint * 0.05 - (1 - this._raise) * 0.25;
    p.z += this._kick * 0.6 + (s.crouching ? 0.01 : 0);
    const r = this.root.rotation;
    r.set(this._kick * 1.6 + this._swayY * 0.6 * (1 - ads) - (1 - this._raise) * 0.8, this._swayX * 0.8 * (1 - ads) + this._sprint * 0.55, this._sprint * 0.35 + this._swayX * 0.3);

    // Aktionen (Nachladen über reloadProgress, sonst eigene Zeitachse)
    if (s.reloading) {
      const t = Math.sin(Math.min(1, Math.max(0, s.reloadProgress || 0)) * Math.PI);
      r.x -= 0.5 * t;
      r.z += 0.4 * t;
      p.y -= 0.08 * t;
    }
    if (this._action) {
      const a = this._action;
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      const w = Math.sin(u * Math.PI);
      if (a.type === 'melee') { p.z -= 0.18 * w; r.x -= 0.4 * w; p.x -= 0.08 * w; }
      else if (a.type === 'grenade') { p.y -= 0.3 * w; r.x -= 0.6 * w; }
      else if (a.type === 'inspect') { r.y += 0.9 * w; r.z += 0.5 * w; }
      else if (a.type === 'reload' && !s.reloading) { r.x -= 0.5 * w; p.y -= 0.08 * w; }
      if (u >= 1) this._action = null;
    }

    // Zielfernrohr (Scharfschütze voll im Anschlag): Waffe aus, HUD zeigt Overlay
    const scoped = !!(this.def && this.def.scope && this.def.scope.overlay === 'sniper' && ads > 0.92);
    this.showScopeOverlay = scoped;
    this.root.visible = this._visible && !scoped;

    // Mündungsfeuer
    if (this._flashT > 0) {
      this._flashT -= dt;
      this.flash.visible = this._flashT > 0;
      this.flashLight.intensity = this._flashT > 0 ? 6 : 0;
    }
  }

  onShot(strength = 1) {
    this._kickV += 1.4 * strength;
    if (this.def && this.def.cls === 'melee') return;
    if (this.def && this.def.suppressed) return;
    this._flashT = 0.045;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const sc = 0.12 + Math.random() * 0.08;
    this.flash.scale.set(sc, sc, sc);
  }

  playReload(empty) { this._action = { type: 'reload', t: 0, dur: empty ? 1.2 : 0.9 }; }
  playMelee() { this._action = { type: 'melee', t: 0, dur: 0.35 }; }
  playGrenade() { this._action = { type: 'grenade', t: 0, dur: 0.6 }; }
  playInspect() { this._action = { type: 'inspect', t: 0, dur: 1.6 }; }

  /** Mündung in Weltkoordinaten der Hauptszene (für Leuchtspuren). */
  getMuzzleWorldPosition(out = new THREE.Vector3()) {
    const cam = this.G.camera;
    if (!this._muzzle || !cam) return cam ? out.copy(cam.position) : out.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this._muzzle.getWorldPosition(out);
    // Viewmodel-Kamera sitzt im Ursprung ohne Drehung → Viewmodel-Welt = Kamera-Raum
    return out.applyMatrix4(cam.matrixWorld);
  }

  setVisible(v) {
    this._visible = !!v;
    this.root.visible = this._visible && !this.showScopeOverlay;
  }

  dispose() {
    if (this.model) disposeTree(this.model);
    this.flash.removeFromParent();
    this.flashLight.removeFromParent();
    this.scene.remove(this.root, this.hemi, this.sun);
    this.sun.dispose();
    this.hemi.dispose();
    this.flashLight.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables.length = 0;
    if (this.G.viewmodel && this.G.viewmodel.rig === this) this.G.viewmodel.rig = null;
  }
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.isMesh && o.geometry) o.geometry.dispose();
  });
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = i % 2 ? 12 : 32;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
