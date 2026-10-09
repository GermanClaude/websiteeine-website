// Zielbild – Aufbau + Einzelbild-Render. Aufruf über dev/zielbild.html; window.zielbild.render() → PNG-DataURL.
import * as THREE from 'three';
import { container, ground, water, crane, farStuff, stacks, sky as makeSky, clutter, mbox } from './set.js';
import { buildRifle } from './rifle.js';
import { buildHand, buildSleeve } from './hand.js';
import { buildPost, installSoftShadows, packShadow } from './post.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') || 1920), H = Number(q.get('h') || 1080);
const log = (...a) => { console.log('[zielbild]', ...a); const el = document.getElementById('log'); if (el) el.textContent += a.join(' ') + '\n'; };
const T0 = performance.now();
const lap = (l) => log(l, Math.round(performance.now() - T0) + ' ms');

installSoftShadows({ sunTan: 0.0095, samples: 24 });

const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = Number(q.get('exp') || 0.8);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

/* ------------------------------------------------------------------ Sonne / Kamera */
const sunAz = THREE.MathUtils.degToRad(Number(q.get('az') || -25)), sunEl = THREE.MathUtils.degToRad(Number(q.get('el') || 7));
const sunDir = new THREE.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl)).normalize();
const sunCol = new THREE.Color(1.0, 0.62, 0.36);
const hazeCol = new THREE.Color(q.get('haze') || '#c99a74').multiplyScalar(Number(q.get('hazek') || 1));

const camera = new THREE.PerspectiveCamera(Number(q.get('fov') || 56), W / H, 0.03, 4000);
camera.position.set(0, 1.62, 0);
camera.rotation.order = 'YXZ';
camera.rotation.set(THREE.MathUtils.degToRad(Number(q.get('pitch') || 5)), THREE.MathUtils.degToRad(Number(q.get('yaw') || 0)), 0);
camera.updateMatrixWorld();

/* ------------------------------------------------------------------ Welt */
const scene = new THREE.Scene();
const world = new THREE.Group(); world.name = 'welt'; scene.add(world);
const reflRT = new THREE.WebGLRenderTarget(Math.round(W / 2), Math.round(H / 2), { type: THREE.HalfFloatType });
const env = { refl: { value: reflRT.texture }, res: { value: new THREE.Vector2(W, H) } };

const sky = makeSky(sunDir); world.add(sky);

// Umgebungslicht: Himmel ohne Sonnenscheibe + dunkler Boden
const pmrem = new THREE.PMREMGenerator(renderer);
{
  const es = new THREE.Scene();
  const s2 = makeSky(sunDir); s2.material.uniforms.showSunDisc.value = 0; es.add(s2);
  const g = new THREE.Mesh(new THREE.CircleGeometry(2000, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.075, 0.062, 0.05) }));
  g.rotation.x = -Math.PI / 2; g.position.y = -2; es.add(g);
  scene.environment = pmrem.fromScene(es, 0.0, 0.1, 5000).texture;
  scene.environmentIntensity = Number(q.get('envk') || 0.5);
}
lap('Himmel/IBL');

const sun = new THREE.DirectionalLight(sunCol, Number(q.get('sun') || 6));
const focus = new THREE.Vector3(-8, 0, -40);
sun.position.copy(focus).addScaledVector(sunDir, 200);
sun.target.position.copy(focus);
sun.castShadow = true;
const SM = Number(q.get('sm') || 4096);
sun.shadow.mapSize.set(SM, SM);
const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 50; sc.far = 400;
sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.03;
sun.shadow.radius = packShadow(140, 350);
world.add(sun, sun.target);

const ground0 = ground(env); world.add(ground0);
const quay = new THREE.Mesh(mbox(400, 1.8, 1.2), new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9 }));
quay.position.set(0, -0.9, -104.6); quay.receiveShadow = true; world.add(quay);
const water0 = water(env); world.add(water0);
lap('Boden/Wasser');

// Container nah: rechter Doppelstapel, linker Langcontainer
const near = [];
const add = (c, x, y, z, ry) => { c.position.set(x, y, z); c.rotation.y = ry; world.add(c); near.push(c); return c; };
add(container({ color: '#1f3d64', seed: 3, ppm: 230, age: 0.55 }), 3.85, 0, -12.2, -Math.PI / 2);          // blau unten
add(container({ color: '#b5541f', seed: 7, ppm: 210, age: 0.6 }), 3.85, 2.6, -12.25, -Math.PI / 2);        // orange oben
add(container({ color: '#b4b0a6', seed: 12, ppm: 150, age: 0.5 }), 6.45, 0, -12.1, -Math.PI / 2);         // weiß unten
add(container({ color: '#8f2a1c', seed: 14, ppm: 150, age: 0.65 }), 6.45, 2.6, -12.15, -Math.PI / 2);      // rot oben
add(container({ color: '#93331f', seed: 21, ppm: 170, age: 0.7 }), -9.9, 0, -14.2, 0.02);                 // links lang
add(container({ color: '#c18a1e', seed: 25, ppm: 90, age: 0.5, L: 6.058 }), 9.0, 0, -22, Math.PI / 2 + 0.05);
add(container({ color: '#5d6a52', seed: 27, ppm: 80, age: 0.6 }), -12.5, 0, -33.5, 0.15);
lap('Container nah');
world.add(stacks([
  { x: 12.5, z: -32, nx: 6, nz: 3, h0: 2, h1: 3, ppm: 40 },
  { x: -4, z: -66, nx: 9, nz: 1, h0: 1, h1: 3, ppm: 40, rot: 0 },
  { x: -30, z: -84, nx: 5, nz: 2, h0: 1, h1: 2, ppm: 32 },
]));
lap('Stapel');
const cr = crane({ x0: -45, z0: -80 }); world.add(cr);
world.add(farStuff());
world.add(clutter());
lap('Kran/Ferne');

// Soldaten (Spielmodell, nur gelesen)
try {
  const { createSoldier } = await import('../../assets/js/game/bots/character.js');
  let createWeaponModel = null;
  try { ({ createWeaponModel } = await import('../../assets/js/game/weapons/models.js')); } catch { /* optional */ }
  const mk = (pos, yaw, params, camo) => {
    const s = createSoldier({ team: 'B', camo, quality: 'high' });
    if (createWeaponModel) { try { s.setWeaponModel(createWeaponModel('kv47', { lod: 'third' })); } catch (e) { log('waffe', e.message); } }
    s.place(pos, yaw);
    for (let i = 0; i < 90; i++) s.animate(1 / 60, { ...params, position: pos });
    s.updateLod(4); s.updateLod(4);
    s.setShadows(true);
    s.root.visible = true;
    s.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    world.add(s.root);
    (window.__sold ||= []).push(s);
    return s;
  };
  mk(new THREE.Vector3(0.6, 0, -23), -1.2, { speed: 5.2, sprint: false, aimYaw: -0.9, aimPitch: 0.0 }, 'urban');
  mk(new THREE.Vector3(-5.2, 0, -37), 0.5, { speed: 0, crouch: 1, aimYaw: 0.35, aimPitch: 0.04, ads: 1 }, 'wald');
  lap('Soldaten');
} catch (e) { log('Soldaten-Fehler', e.message); }

/* ------------------------------------------------------------------ Ego-Waffe (eigene Szene + eigene Sonne) */
const vmScene = new THREE.Scene();
vmScene.environment = scene.environment;
vmScene.environmentIntensity = scene.environmentIntensity * 0.6;
const vm = new THREE.Group();
const rifle = buildRifle();
vm.add(rifle);
lap('Gewehr');
{
  // Griffrahmen im Waffenraum (s → −z)
  const top = new THREE.Vector3(0, -0.03, 0.033), bot = new THREE.Vector3(0, -0.13, 0.066);
  const a = bot.clone().sub(top).normalize();
  const r = new THREE.Vector3(1, 0, 0);
  const f = new THREE.Vector3().crossVectors(r, a).normalize(); // vorn (−z, leicht abwärts)
  if (f.z > 0) f.negate();
  const hand = buildHand({ origin: top, a, f, r });
  vm.add(hand);
  const wrist = top.clone().addScaledVector(a, 0.1).addScaledVector(f, -0.13).addScaledVector(r, 0.05);
  const elbow = wrist.clone().addScaledVector(a, 0.17).addScaledVector(f, -0.24).addScaledVector(r, 0.1);
  vm.add(buildSleeve(wrist, elbow, 0.031, 0.05));
}
lap('Hand/Ärmel');
vm.position.set(Number(q.get('vx') || 0.19), Number(q.get('vy') || -0.128), Number(q.get('vz') || -0.5));
vm.rotation.order = 'YXZ';
vm.rotation.set(Number(q.get('vp') || 0.07), Number(q.get('vyaw') || 0.09), Number(q.get('vr') || 0.22));
const vmPivot = new THREE.Group();
vmPivot.add(vm);
vmPivot.position.copy(camera.position); vmPivot.quaternion.copy(camera.quaternion);
vmScene.add(vmPivot);
vmPivot.updateMatrixWorld(true);
const vmCenter = new THREE.Vector3(0, 0.03, -0.1).applyMatrix4(vm.matrixWorld);
const vsun = new THREE.DirectionalLight(sunCol, sun.intensity);
vsun.position.copy(vmCenter).addScaledVector(sunDir, 2);
vsun.target.position.copy(vmCenter);
vsun.castShadow = true;
vsun.shadow.mapSize.set(4096, 4096);
Object.assign(vsun.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 1, far: 3 });
vsun.shadow.camera.updateProjectionMatrix();
vsun.shadow.bias = -0.0004; vsun.shadow.normalBias = 0.0006;
vsun.shadow.radius = packShadow(0.9, 2);
vmScene.add(vsun, vsun.target);

/* ------------------------------------------------------------------ Nachbearbeitung + Spiegelung */
const post = buildPost(renderer, { scene, vmScene, camera, sky, w: W, h: H, sunDir, sunCol, hazeCol });
post.haze.uniforms.uDensity.value = Number(q.get('fog') || 0.0045);
post.haze.uniforms.uRays.value = Number(q.get('rays') ?? 0.35);
post.bloom.strength = Number(q.get('bloom') ?? 0.05);
post.haze.uniforms.uDbg.value = Number(q.get('dbg') || 0);

function renderReflection() {
  // Welt an y = 0 spiegeln (Sonne/Himmel inklusive), Boden ausblenden
  const hide = [ground0, water0, quay];
  world.scale.y = -1; for (const o of hide) o.visible = false;
  world.updateMatrixWorld(true);
  renderer.setRenderTarget(reflRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  world.scale.y = 1; for (const o of hide) o.visible = true;
  world.updateMatrixWorld(true);
}

window.zielbild = {
  ready: true,
  async render() {
    const t = performance.now();
    renderReflection();
    lap('Spiegelung');
    post.update();
    if (q.get('raw')) {
      renderer.setRenderTarget(null); renderer.autoClear = true; renderer.render(scene, camera);
      renderer.autoClear = false; renderer.clearDepth(); renderer.render(vmScene, camera); renderer.autoClear = true;
    } else post.composer.render();
    lap('Bild');
    const gl = renderer.getContext(); gl.finish();
    return { ms: Math.round(performance.now() - t), url: canvas.toDataURL('image/png') };
  },
  info() { const S = (window.__sold || []).map((s) => ({ p: s.root.position.toArray(), lod: s.lod, vis: s.meshes.map((m) => m.visible), st: s.state, hips: s.bones[0].position.toArray() })); return { S, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, sunUV: post.haze.uniforms.uSunUV.value.toArray() }; },
};
lap('bereit');
document.title = 'Zielbild bereit';
