// Arsenal-Bühne (lazy): ein WebGLRenderer, Rendern nur bei Bedarf, ≤ 3 Modelle im Cache (LRU),
// eigene Orbit-Steuerung mit Trägheit, Mündungsblitz, Anschlag (FOV), Auflösen (Klarfarbe Papier → Dunkelgrau).
// Ausschnitt: in Ruhe auf die Glyphenfläche der Maske gesetzt, beim Ziehen ganz im Bild (jede Drehung).
import * as THREE from 'three';
import { createWeaponModel } from '../game/weapons/models.js';
import { loop } from './loop.js';
import { reduced } from './motion.js';

const INK = new THREE.Color('#E9E6DF');
// Aufgelöst (Ziehen): dunkles Grau statt Seitenschwarz, damit schwarzes Polymer sich abhebt (--np-black-3)
const DARK = new THREE.Color('#191C20');
const BASE_YAW = -0.42;
const BASE_PITCH = 0.1;
const PITCH_MAX = 0.44;
const FOV = 24;
const TAN_V = Math.tan((FOV * Math.PI) / 360);
/** In den Buchstaben höchstens so weit über die volle Länge hinaus vergrößern (Enden dürfen angeschnitten werden). */
const ZOOM_MAX = 2.4;
/** Anteil der Glyphenhöhe, den das Modell in Ruhe mindestens überdecken soll. */
const FILL_H = 0.95;
/** Länge des Modells in Ruhe relativ zur Breite der Glyphenfläche (> 1: Lauf- und Schaftenden in den Randbuchstaben angeschnitten). */
const FILL_W = 1.15;

/**
 * Ausdehnung der Modellbox in Kamerarichtungen (Bildschirm rechts = −Z, oben = +Y, Tiefe = X) für eine Pose.
 * @returns {{ w: number, h: number, d: number }}
 */
const _c = new THREE.Vector3();
const _e = new THREE.Euler();
function extents(box, yaw, pitch) {
  _e.set(pitch, yaw, 0, 'YXZ');
  let w0 = Infinity; let w1 = -Infinity; let h0 = Infinity; let h1 = -Infinity; let d0 = Infinity; let d1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    _c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyEuler(_e);
    w0 = Math.min(w0, _c.z); w1 = Math.max(w1, _c.z);
    h0 = Math.min(h0, _c.y); h1 = Math.max(h1, _c.y);
    d0 = Math.min(d0, _c.x); d1 = Math.max(d1, _c.x);
  }
  return { w: w1 - w0, h: h1 - h0, d: d1 - d0 };
}

/** Maße eines Modells, einmal je Modell: Ruhepose und die größte Ausdehnung über alle erlaubten Drehungen. */
const frames = new WeakMap();
function measure(m) {
  let f = frames.get(m);
  if (f) return f;
  // Im eigenen Raum messen (frisch erzeugt, noch ohne Eltern): sonst zählten Drehung und Rückstoß mit
  const parent = m.parent;
  parent?.remove(m);
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  parent?.add(m);
  const rest = extents(box, BASE_YAW, BASE_PITCH);
  const poses = [];
  for (let yi = 0; yi < 24; yi++) {
    for (const pitch of [-PITCH_MAX, -PITCH_MAX / 2, 0, PITCH_MAX / 2, PITCH_MAX]) poses.push(extents(box, (yi / 24) * Math.PI * 2, pitch));
  }
  f = { rest, poses };
  frames.set(m, f);
  return f;
}

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
  const hemi = new THREE.HemisphereLight(0xf4efe6, 0x2a2622, 1.25);
  scene.add(hemi);
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
    homing: false,
  };
  // Glyphenfläche der Maske in Anteilen der Bühne (arsenal-view.js meldet sie nach jedem Setzen des Namens)
  let region = { x0: 0.06, x1: 0.94, y0: 0.25, y1: 0.75 };
  let running = false;
  let lost = false;
  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const clear = new THREE.Color();

  /**
   * Bildausschnitt: In Ruhe (Maske) füllt das Modell die Glyphenfläche – Mitte auf ihrer Mitte, die volle Länge
   * über ihre Breite, und so groß, dass es mindestens FILL_H ihrer Höhe deckt (Enden dürfen in den Buchstaben
   * angeschnitten sein). Aufgelöst (Ziehen) passt es in jeder erlaubten Drehung ganz ins Bild.
   * Liefert sichtbare Höhe V (Welt, in der Modellebene) und den Schwenk (Ursprung → Bildpunkt).
   */
  const pan = new THREE.Vector3();
  function framing() {
    const f = current ? measure(current) : { rest: { w: 1, h: 0.4, d: 0.1 }, poses: [{ w: 1, h: 0.8, d: 1 }] };
    const a = st.aspect;
    const fx = Math.max(0.2, region.x1 - region.x0);
    const fy = Math.max(0.15, region.y1 - region.y0);
    const vLen = f.rest.w / (fx * a * FILL_W);
    const vH = f.rest.h / (fy * FILL_H);
    const vMask = Math.max(vLen / ZOOM_MAX, Math.min(vLen, vH));
    const t = st.dissolve;
    let v = vMask;
    if (t > 0) {
      // Ganz im Bild (86 %): größte Ausdehnung über alle erlaubten Drehungen samt Perspektive – das nahe Ende
      // einer zur Kamera gedrehten Waffe wirkt größer. Zwei Durchgänge genügen (der Abstand hängt von V ab).
      let vFit = 0;
      for (const p of f.poses) vFit = Math.max(vFit, p.h, p.w / a);
      for (let it = 0; it < 2; it++) {
        const dist = vFit / 0.86 / (2 * TAN_V);
        let need = 0;
        for (const p of f.poses) need = Math.max(need, Math.max(p.h, p.w / a) * dist / Math.max(0.1, dist - p.d / 2));
        vFit = need;
      }
      v += (vFit / 0.86 - vMask) * t;
    }
    st.dist = v / (2 * TAN_V);
    // Ursprung auf die Mitte der Glyphenfläche (Bildschirm rechts = −Z → z = nx · halbe sichtbare Breite)
    const nx = (region.x0 + region.x1) - 1;
    const ny = 1 - (region.y0 + region.y1);
    pan.set(0, -ny * (v / 2) * (1 - t), nx * (v / 2) * a * (1 - t));
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
    request();
  }

  function apply() {
    pivot.rotation.set(st.pitch, st.yaw, 0, 'YXZ');
    kick.position.set(0, 0, st.kz);
    kick.rotation.set(st.kp, 0, 0);
    framing();
    // Anschlag: Blick wandert zum Visier, FOV wird enger
    const a = st.ads;
    const zoom = 1 + (Math.min(st.adsZoom, 1.6) - 1) * a;
    camera.fov = FOV / zoom;
    look.copy(pan);
    const sight = current?.userData?.sight;
    if (sight && a > 0) {
      sight.getWorldPosition(tmp);
      look.lerp(tmp, a * 0.85);
    }
    // Schwenk als Parallelverschiebung (keine Verzerrung durch Drehen der Kamera)
    camera.position.set(st.dist, 0.02 + look.y, look.z);
    camera.lookAt(st.dist - 1, 0.02 + look.y, look.z);
    camera.updateProjectionMatrix();
    renderer.setClearColor(clear.copy(INK).lerp(DARK, st.dissolve), 1);
    // Aufgelöst: mehr Himmels- und Kantenlicht, damit dunkle Teile auf Grau lesbar bleiben
    hemi.intensity = 1.25 + 0.75 * st.dissolve;
    rim.intensity = 1.6 + 1.4 * st.dissolve;
  }

  function tick(dt, t) {
    if (lost) { running = false; return false; }
    let active = false;
    if (st.homing && !st.dragging) {
      // Neue Waffe: Drehung weich in die Grundpose zurück (kürzester Weg)
      const f = 1 - Math.exp(-10 * dt);
      st.yaw += (BASE_YAW - st.yaw) * f;
      st.pitch += (BASE_PITCH - st.pitch) * f;
      if (Math.abs(BASE_YAW - st.yaw) < 1e-3 && Math.abs(BASE_PITCH - st.pitch) < 1e-3) { st.yaw = BASE_YAW; st.pitch = BASE_PITCH; st.homing = false; }
      active = true;
    } else if (!st.dragging && (Math.abs(st.vy) > 1e-4 || Math.abs(st.vp) > 1e-4)) {
      st.yaw += st.vy * dt;
      st.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, st.pitch + st.vp * dt));
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
    if (!running) { running = true; loop.add(tick, { heavy: true }); }
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
    measure(m);
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

  function poseHome(instant) {
    st.vy = 0;
    st.vp = 0;
    // Auf den nächstgelegenen Vollkreis der Grundpose, damit nicht mehrfach herumgedreht wird
    st.yaw = BASE_YAW + Math.atan2(Math.sin(st.yaw - BASE_YAW), Math.cos(st.yaw - BASE_YAW));
    if (instant) { st.yaw = BASE_YAW; st.pitch = BASE_PITCH; st.homing = false; } else st.homing = st.yaw !== BASE_YAW || st.pitch !== BASE_PITCH;
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
      try {
        const parallel = renderer.extensions?.has?.('KHR_parallel_shader_compile');
        if (parallel && renderer.compileAsync) await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
      } catch { /* erstes Bild kompiliert dann */ }
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
      // Pose zurücksetzen: Drehung der vorigen Waffe nicht übernehmen (bei reduzierter Bewegung sofort)
      poseHome(reduced());
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
    rotate(dx, dy) { st.homing = false; st.yaw += dx; st.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, st.pitch + dy)); request(); },
    drag(on) { st.dragging = on; if (on) { st.vy = 0; st.vp = 0; st.homing = false; } request(); },
    fling(vy, vp) { st.vy = vy; st.vp = vp; request(); },
    reset() { poseHome(true); request(); },
    /** Glyphenfläche der Maske in Anteilen der Bühne { x0, x1, y0, y1 } (0 = links/oben). */
    frame(r) {
      if (!r || !(r.x1 > r.x0) || !(r.y1 > r.y0)) return;
      region = { x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 };
      request();
    },
    /** Für Prüfungen: aktueller Ausschnitt (sichtbare Höhe, Abstand, Schwenk) und die Pose. */
    get view() { return { dist: st.dist, v: st.dist * 2 * TAN_V, pan: pan.toArray(), yaw: st.yaw, pitch: st.pitch, dissolve: st.dissolve, region: { ...region } }; },
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
