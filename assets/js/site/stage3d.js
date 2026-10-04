// Arsenal-Bühne (lazy): ein WebGLRenderer, Rendern nur bei Bedarf, ≤ 3 Modelle im Cache (LRU),
// eigene Orbit-Steuerung mit Trägheit, Mündungsblitz, Anschlag (FOV), Auflösen (Klarfarbe Papier → Schwarz).
import * as THREE from 'three';
import { createWeaponModel } from '../game/weapons/models.js';
import { loop } from './loop.js';

const INK = new THREE.Color('#E9E6DF');
const BLACK = new THREE.Color('#0A0B0D');
const BASE_YAW = -0.42;
const BASE_PITCH = 0.1;
const FOV = 24;

function muzzleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,240,200,1)');
  r.addColorStop(0.25, 'rgba(255,170,60,.95)');
  r.addColorStop(0.6, 'rgba(255,91,31,.45)');
  r.addColorStop(1, 'rgba(255,91,31,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function disposeObject(o) {
  o.traverse((n) => {
    if (n.isMesh || n.isSprite) {
      n.geometry?.dispose?.();
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (!m) continue;
        for (const k of Object.keys(m)) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
        m.dispose?.();
      }
    }
  });
}

/** Nur Geometrien freigeben: Materialien und Texturen teilt models.js zwischen allen Waffen. */
function disposeGeometry(o) {
  o.traverse((n) => { if (n.isMesh) n.geometry?.dispose?.(); });
}

/**
 * @param canvas  <canvas> der Bühne
 * @param opts    { coarse, quality: () => string, onLost: () => void }
 */
export function createStage(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(INK, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.02, 20);
  scene.add(new THREE.HemisphereLight(0xf4efe6, 0x2a2622, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(1.4, 2.2, 1.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe0c8, 1.6);
  rim.position.set(-1.8, 0.8, -2.2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
  fill.position.set(2.5, -0.6, -0.4);
  scene.add(fill);

  const pivot = new THREE.Group();   // Drehung (Nutzer)
  const kick = new THREE.Group();    // Rückstoß (Position/Neigung)
  pivot.add(kick);
  scene.add(pivot);

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleTexture(), transparent: true, depthWrite: false, depthTest: false }));
  flash.visible = false;
  flash.scale.setScalar(0.16);
  scene.add(flash);

  const cache = new Map(); // key → Group (LRU in Einfügereihenfolge)
  let current = null;
  let currentKey = '';
  const st = {
    yaw: BASE_YAW, pitch: BASE_PITCH, vy: 0, vp: 0,
    kz: 0, kp: 0, recovery: 8,
    ads: 0, adsTarget: 0, adsZoom: 1.25, adsMs: 220,
    dissolve: 0, dissolveTarget: 0,
    flashUntil: 0, dragging: false, dist: 1.6, aspect: 16 / 9,
  };
  let running = false;
  let lost = false;
  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const clear = new THREE.Color();

  function frameDistance() {
    const vfov = (FOV * Math.PI) / 180;
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * st.aspect;
    const halfW = 0.56; // Modell: längste Kante = 1
    const halfH = 0.36;
    st.dist = Math.max(halfW / tanH, halfH / tanV);
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const q = typeof opts.quality === 'function' ? opts.quality() : 'auto';
    let dpr = Math.min(window.devicePixelRatio || 1, opts.coarse || q === 'low' ? 1 : 1.5);
    const maxPx = 1.0e6;
    if (w * h * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * h));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    st.aspect = w / h;
    camera.aspect = st.aspect;
    frameDistance();
    request();
  }

  function apply() {
    pivot.rotation.set(st.pitch, st.yaw, 0, 'YXZ');
    kick.position.set(0, 0, st.kz);
    kick.rotation.set(st.kp, 0, 0);
    // Anschlag: Blick wandert zum Visier, FOV wird enger
    const a = st.ads;
    const zoom = 1 + (Math.min(st.adsZoom, 1.6) - 1) * a;
    camera.fov = FOV / zoom;
    look.set(0, 0, 0);
    const sight = current?.userData?.sight;
    if (sight && a > 0) {
      sight.getWorldPosition(tmp);
      look.lerp(tmp, a * 0.85);
    }
    camera.position.set(st.dist, 0.02 + look.y, look.z);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    renderer.setClearColor(clear.copy(INK).lerp(BLACK, st.dissolve), 1);
  }

  function tick(dt, t) {
    if (lost) { running = false; return false; }
    let active = false;
    if (!st.dragging && (Math.abs(st.vy) > 1e-4 || Math.abs(st.vp) > 1e-4)) {
      st.yaw += st.vy * dt;
      st.pitch = Math.max(-0.44, Math.min(0.44, st.pitch + st.vp * dt));
      const f = Math.exp(-4 * dt);
      st.vy *= f;
      st.vp *= f;
      active = true;
    } else if (!st.dragging) { st.vy = 0; st.vp = 0; }
    if (Math.abs(st.kz) > 1e-5 || Math.abs(st.kp) > 1e-5) {
      const f = Math.exp(-st.recovery * dt);
      st.kz *= f;
      st.kp *= f;
      if (Math.abs(st.kz) < 1e-5) st.kz = 0;
      if (Math.abs(st.kp) < 1e-5) st.kp = 0;
      active = true;
    }
    if (st.ads !== st.adsTarget) {
      const step = dt * 1000 / Math.max(60, st.adsMs);
      st.ads = st.adsTarget > st.ads ? Math.min(st.adsTarget, st.ads + step) : Math.max(st.adsTarget, st.ads - step);
      active = true;
    }
    if (st.dissolve !== st.dissolveTarget) {
      const step = dt * 1000 / 240;
      st.dissolve = st.dissolveTarget > st.dissolve ? Math.min(st.dissolveTarget, st.dissolve + step) : Math.max(st.dissolveTarget, st.dissolve - step);
      active = true;
    }
    const now = performance.now();
    if (flash.visible) {
      if (now > st.flashUntil) flash.visible = false;
      else {
        current?.userData?.muzzle?.getWorldPosition(tmp);
        flash.position.copy(tmp);
        flash.material.opacity = Math.max(0, (st.flashUntil - now) / 40);
      }
      active = true;
    }
    apply();
    renderer.render(scene, camera);
    if (st.dragging) active = true;
    if (!active) { running = false; return false; }
    return true;
  }

  function request() {
    if (lost) return;
    if (!running) { running = true; loop.add(tick); }
  }

  function getModel(def) {
    const k = def.model || def.id;
    if (cache.has(k)) {
      const m = cache.get(k);
      cache.delete(k);
      cache.set(k, m);
      return m;
    }
    const m = createWeaponModel(k, { lod: 'showcase' });
    cache.set(k, m);
    while (cache.size > 3) {
      const [oldKey, old] = cache.entries().next().value;
      if (old === current) { cache.delete(oldKey); cache.set(oldKey, old); break; }
      cache.delete(oldKey);
      kick.remove(old);
      disposeGeometry(old);
    }
    return m;
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    opts.onLost?.();
  });

  const api = {
    renderer,
    /** Modell bauen und Shader vorbereiten, ohne schon zu zeichnen (kein Ruck beim ersten Bild). */
    async prepare(def) {
      if (lost) return;
      const m = getModel(def);
      const had = m.parent === kick;
      if (!had) kick.add(m);
      apply();
      try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch { /* erstes Bild kompiliert dann */ }
      if (!had && m !== current) kick.remove(m);
    },
    /** Waffe zeigen (Pose zurücksetzen). */
    show(def) {
      if (lost) return;
      const m = getModel(def);
      if (current && current !== m) kick.remove(current);
      current = m;
      currentKey = def.model;
      if (m.parent !== kick) kick.add(m);
      st.recovery = def.recoil?.recovery || 8;
      st.adsZoom = def.adsZoom || 1.25;
      st.adsMs = (def.adsTime || 0.22) * 1000;
      st.kz = 0;
      st.kp = 0;
      request();
    },
    /** Schuss: Rückstoß und Mündungsblitz. strength ~ vertical-Rückstoß. */
    shot(def) {
      if (lost || !current) return;
      const v = def.recoil?.vertical || 0.01;
      const strength = Math.min(1.6, v / 0.01);
      st.kz += 0.02 * strength;
      st.kp = Math.min(0.5, st.kp + v * 6);
      if (def.cls !== 'melee' && !def.suppressed) {
        current.userData.muzzle?.getWorldPosition(tmp);
        flash.position.copy(tmp);
        flash.material.rotation = Math.random() * Math.PI;
        flash.scale.setScalar(0.12 + Math.min(0.12, v * 2.5));
        flash.visible = true;
        st.flashUntil = performance.now() + 40;
      }
      request();
    },
    ads(on, ms) { st.adsTarget = on ? 1 : 0; st.adsMs = ms || st.adsMs; request(); },
    dissolve(on) { st.dissolveTarget = on ? 1 : 0; request(); },
    rotate(dx, dy) { st.yaw += dx; st.pitch = Math.max(-0.44, Math.min(0.44, st.pitch + dy)); request(); },
    drag(on) { st.dragging = on; if (on) { st.vy = 0; st.vp = 0; } request(); },
    fling(vy, vp) { st.vy = vy; st.vp = vp; request(); },
    reset() { st.yaw = BASE_YAW; st.pitch = BASE_PITCH; st.vy = 0; st.vp = 0; request(); },
    resize,
    request,
    get lost() { return lost; },
    get key() { return currentKey; },
    dispose() {
      lost = true;
      for (const m of cache.values()) disposeObject(m);
      cache.clear();
      flash.material.map?.dispose();
      flash.material.dispose();
      renderer.dispose();
    },
  };
  resize();
  return api;
}
