// NULLPUNKT — 3D-Waffenvorschau der Lobby. Nutzt den vorhandenen WebGL-Renderer des Spiels (kein zweiter
// Kontext) und zeichnet nur, solange die Lobby sichtbar ist: Drehteller mit Studiolicht, per Ziehen drehbar.
// Das Modell wird über setViewOffset in einen frei gelassenen DOM-Bereich (region) der Lobby gerückt.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class WeaponPreview {
  constructor(G) {
    this.G = G;
    this.scene = null;
    this.camera = null;
    this.pivot = null;
    this.model = null;
    this.modelId = null;
    this.region = null;
    this.running = false;
    this.yaw = -0.6;
    this.pitch = 0.12;
    this.spin = 0.35;
    this._raf = 0;
    this._last = 0;
    this._drag = null;
    this._env = null;
    this._listeners = [];
  }

  _init() {
    if (this.scene) return true;
    const R = this.G.renderer && this.G.renderer.renderer;
    if (!R) return false;
    const scene = new THREE.Scene();
    scene.name = 'lobby-preview';
    const cam = new THREE.PerspectiveCamera(26, 16 / 9, 0.05, 50);
    cam.position.set(0, 0.05, 3);
    const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x2a2420, 0.7);
    const key = new THREE.DirectionalLight(0xfff1de, 2.6);
    key.position.set(2.2, 2.8, 2.4);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.7);
    fill.position.set(-2.5, 0.6, 1.5);
    const rim = new THREE.DirectionalLight(0xff8a4a, 2.2);
    rim.position.set(-1.2, 1.4, -2.6);
    scene.add(hemi, key, fill, rim);
    try {
      const pm = new THREE.PMREMGenerator(R);
      const env = new RoomEnvironment();
      this._env = pm.fromScene(env, 0.04).texture;
      pm.dispose();
      env.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      scene.environment = this._env;
      scene.environmentIntensity = 0.55;
    } catch { /* ohne Umgebung */ }
    // weicher Schatten-/Bodenfleck
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,91,31,.22)');
    grd.addColorStop(0.5, 'rgba(255,91,31,.06)');
    grd.addColorStop(1, 'rgba(255,91,31,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    this._spotTex = new THREE.CanvasTexture(c);
    this._spotTex.colorSpace = THREE.SRGBColorSpace;
    this._spotMat = new THREE.MeshBasicMaterial({ map: this._spotTex, transparent: true, depthWrite: false, toneMapped: false });
    this._spotGeo = new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2);
    const spot = new THREE.Mesh(this._spotGeo, this._spotMat);
    spot.position.y = -0.32;
    scene.add(spot);
    this.pivot = new THREE.Group();
    scene.add(this.pivot);
    this.scene = scene;
    this.camera = cam;
    return true;
  }

  /** Waffe anzeigen (Waffen-Id aus WEAPONS). */
  setWeapon(id) {
    if (!this._init()) return;
    if (id === this.modelId && this.model) return;
    const G = this.G;
    const def = (G.data.WEAPONS && G.data.WEAPONS[id]) || (G.data.EQUIPMENT && G.data.EQUIPMENT[id]);
    const models = G.modules && G.modules.models;
    this._clearModel();
    this.modelId = id;
    if (!def || !models || typeof models.createWeaponModel !== 'function') return;
    let m = null;
    try { m = models.createWeaponModel(def.model, { lod: 'showcase' }); } catch { m = null; }
    if (!m) return;
    // auf längste Kante 1 normieren (Stub-Modelle sind nicht normiert)
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const s = 1 / Math.max(size.x, size.y, size.z, 1e-3);
    const center = box.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group();
    m.position.sub(center);
    wrap.add(m);
    wrap.scale.setScalar(s * (def.cls === 'pistol' ? 0.62 : def.cls === 'melee' ? 0.55 : !def.cls ? 0.36 : 1));
    // Lauf nach links (Seitenansicht)
    wrap.rotation.y = Math.PI / 2;
    this.pivot.add(wrap);
    this.model = wrap;
    this._ownedGeometry = G.moduleStatus && G.moduleStatus.models !== 'real';
    this._pop = 0;
    this.render();
  }

  _clearModel() {
    if (!this.model) return;
    this.model.removeFromParent();
    // echte Modelle teilen Geometrie/Material mit dem Cache von models.js → nicht entsorgen
    if (this._ownedGeometry) this.model.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.model = null;
  }

  /** Startet die Darstellung im Bereich `region` (DOM-Element, für Ziehen und Platzierung). */
  start(region) {
    if (!this._init()) return;
    this.region = region;
    this._bindRegion(region);
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this._last) / 1000);
      // Leerlauf: ~30 Bilder/s genügen
      if (!this._drag && now - this._last < 31) return;
      this._last = now;
      if (document.hidden) return;
      this._tick(dt);
      this.render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this._unbind();
  }

  _bindRegion(region) {
    this._unbind();
    if (!region) return;
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); this._listeners.push(() => t.removeEventListener(type, fn, o)); };
    on(region, 'pointerdown', (e) => {
      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vy: 0 };
      try { region.setPointerCapture(e.pointerId); } catch { /* */ }
    });
    on(region, 'pointermove', (e) => {
      const d = this._drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      this.yaw += dx * 0.012;
      this.pitch = Math.max(-0.6, Math.min(0.7, this.pitch + dy * 0.008));
      d.vy = dx * 0.012;
    });
    const end = (e) => {
      const d = this._drag;
      if (!d || d.id !== e.pointerId) return;
      this.spin = Math.max(-3, Math.min(3, d.vy * 30)) || 0.35;
      this._drag = null;
    };
    on(region, 'pointerup', end);
    on(region, 'pointercancel', end);
  }

  _unbind() {
    while (this._listeners.length) this._listeners.pop()();
    this._drag = null;
  }

  _tick(dt) {
    const reduced = this.G.settings && this.G.settings.get('reducedMotion');
    if (!this._drag) {
      this.spin += (0.35 * Math.sign(this.spin || 1) - this.spin) * Math.min(1, dt * 1.5);
      if (!reduced) this.yaw += this.spin * dt;
      this.pitch += (0.12 - this.pitch) * Math.min(1, dt * 0.8);
    }
    if (this._pop != null && this._pop < 1) this._pop = Math.min(1, this._pop + dt * 3.2);
  }

  render() {
    if (!this.scene || !this.region) return;
    const RR = this.G.renderer;
    const R = RR && RR.renderer;
    if (!R || RR.lost) return;
    RR.resize();
    const r = this.region.getBoundingClientRect();
    const W = RR.width;
    const H = RR.height;
    if (r.width < 20 || r.height < 20) { this._clear(R); return; }
    const cam = this.camera;
    cam.aspect = W / H;
    cam.clearViewOffset();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    cam.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    const target = Math.min(r.width * 0.86, r.height * 1.7);
    const vh = 2 * Math.tan((cam.fov * Math.PI) / 360);
    const dist = Math.max(1.1, Math.min(7, H / (vh * Math.max(60, target))));
    cam.position.set(0, 0.06 * dist, dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    const p = this._pop != null ? easeOutBack(this._pop) : 1;
    this.pivot.rotation.set(this.pitch, this.yaw, 0);
    this.pivot.scale.setScalar(0.7 + 0.3 * p);
    R.setRenderTarget(null);
    R.info.reset();
    R.render(this.scene, cam);
  }

  _clear(R) {
    R.setRenderTarget(null);
    R.clear();
  }

  /** Bild löschen (z. B. wenn die Lobby verlassen wird). */
  clearCanvas() {
    const R = this.G.renderer && this.G.renderer.renderer;
    if (R) this._clear(R);
  }

  dispose() {
    this.stop();
    this._clearModel();
    if (this._env) this._env.dispose();
    if (this._spotTex) this._spotTex.dispose();
    if (this._spotMat) this._spotMat.dispose();
    if (this._spotGeo) this._spotGeo.dispose();
    this.scene = null;
  }
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
