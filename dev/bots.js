// NULLPUNKT — Bot-Prüfstand: Galerie (alle Ausrüstungsvarianten × Schemata × Animationen, Nahaufnahmen)
// und Sandkasten (Bots auf einer echten Karte mit Debug-Anzeige: Pfade, Sichtkegel, Zustände, Deckung).
// URL: ?view=gallery|sandbox &scheme=A &weapon=ar_m17 &anim=run &cam=close &focus=0 &lod=0 &t=1.3 (Zeit einfrieren)
//      ?view=sandbox &map=hafen &mode=tdm &diff=regulaer &bots=10 &ts=1
// Testhaken: window.__bots
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSoldier, VARIANTS, SCHEMES } from '../assets/js/game/bots/character.js';
import { createWeaponModel, preloadWeaponModels } from '../assets/js/game/weapons/models.js';
import { WEAPONS } from '../assets/js/shared/weapons.data.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 600);

const state = {
  view: params.get('view') || 'gallery',
  frozen: params.has('t') ? Number(params.get('t')) : null,
  timeScale: 1,
};

/* ================================================================ Kamera (eigene Orbit-Steuerung) */

const orbit = { target: new THREE.Vector3(0, 1, 0), dist: 6, yaw: 0, pitch: 0.12, fly: false };
function applyOrbit() {
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    orbit.target.y + Math.sin(orbit.pitch) * orbit.dist,
    orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist,
  );
  camera.lookAt(orbit.target);
}
{
  const ptrs = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button }); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointerup', (e) => { ptrs.delete(e.pointerId); pinch = 0; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) orbit.dist = Math.max(0.6, Math.min(400, orbit.dist * (pinch / d)));
      pinch = d;
    } else if (p.b === 2 || e.shiftKey) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      orbit.target.addScaledVector(right, -dx * orbit.dist * 0.0015).addScaledVector(up, dy * orbit.dist * 0.0015);
    } else {
      orbit.yaw -= dx * 0.006;
      orbit.pitch = Math.max(-1.3, Math.min(1.45, orbit.pitch + dy * 0.005));
    }
    state.follow = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(0.6, Math.min(400, orbit.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
}
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
function flyKeys(dt) {
  if (!keys.size) return;
  const f = new THREE.Vector3(-Math.sin(orbit.yaw), 0, -Math.cos(orbit.yaw));
  const r = new THREE.Vector3(Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw));
  const s = (keys.has('ShiftLeft') ? 30 : 10) * dt;
  if (keys.has('KeyW')) orbit.target.addScaledVector(f, s);
  if (keys.has('KeyS')) orbit.target.addScaledVector(f, -s);
  if (keys.has('KeyD')) orbit.target.addScaledVector(r, s);
  if (keys.has('KeyA')) orbit.target.addScaledVector(r, -s);
  if (keys.has('KeyE')) orbit.target.y += s;
  if (keys.has('KeyQ')) orbit.target.y -= s;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/* ================================================================ Galerie */

const gal = { scene: null, soldiers: [], weaponId: params.get('weapon') || 'ar_m17', scheme: params.get('scheme') || 'A', anim: params.get('anim') || 'idle', lod: params.get('lod') ?? 'auto', t: 0, cam: params.get('cam') || 'row', focus: Number(params.get('focus') || 0) };
const ANIMS = {
  idle: 'Stehen', ads: 'Anschlag', fire: 'Feuern', walk: 'Gehen', run: 'Laufen', sprint: 'Sprint', strafeR: 'Seitwärts rechts',
  strafeL: 'Seitwärts links', back: 'Rückwärts', diag: 'Diagonal', crouch: 'Hocke', crouchwalk: 'Schleichen', air: 'Sprung',
  turn: 'Drehen im Stand', aimUp: 'Ziel hoch', aimDown: 'Ziel tief', reload: 'Nachladen', reloadEmpty: 'Nachladen (leer)',
  throw: 'Granatwurf', melee: 'Nahkampf', hit: 'Treffer', death: 'Tod (Ragdoll)',
};
const flatWorld = { groundHeight: () => 0, raycast: () => null };

function buildGallery() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d21);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const hemi = new THREE.HemisphereLight(0xcfd8e0, 0x3a332c, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1df, 2.6);
  sun.position.set(4, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -7; sun.shadow.camera.right = 7; sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
  rim.position.set(-5, 3, -6);
  scene.add(rim);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(28, 56, 0x3d444c, 0x30363c);
  grid.position.y = 0.002;
  scene.add(grid);
  gal.scene = scene;
  respawnGallery();
}

function respawnGallery() {
  for (const s of gal.soldiers) s.dispose();
  gal.soldiers = [];
  const n = VARIANTS.length;
  for (let i = 0; i < n; i++) {
    const s = createSoldier({ team: gal.scheme === 'A' ? 'A' : gal.scheme === 'B' ? 'B' : null, camo: gal.scheme, variant: i, quality: 'high', models: { createWeaponModel }, name: VARIANTS[i].name });
    s.setShadows(true);
    const def = WEAPONS[gal.weaponId] || WEAPONS.ar_m17;
    s.setWeaponModel(createWeaponModel(def.model, { lod: 'third' }), def);
    const x = (i - (n - 1) / 2) * 1.15;
    s.reset(new THREE.Vector3(x, 0, 0), 0);
    s.home = new THREE.Vector3(x, 0, 0);
    gal.scene.add(s.root);
    gal.soldiers.push(s);
  }
  setGalleryCamera();
}

function setGalleryCamera() {
  const n = gal.soldiers.length;
  const f = gal.soldiers[Math.min(n - 1, Math.max(0, gal.focus))];
  const fx = f ? f.home.x : 0;
  // Soldaten blicken nach −Z → Kamera von vorn: yaw = π
  const F = Math.PI;
  if (gal.cam === 'row') { orbit.target.set(0, 0.95, 0); orbit.dist = 9.5; orbit.yaw = F; orbit.pitch = 0.08; }
  else if (gal.cam === 'close') { orbit.target.set(fx, 1.15, 0); orbit.dist = 2.6; orbit.yaw = F - 0.45; orbit.pitch = 0.08; }
  else if (gal.cam === 'side') { orbit.target.set(fx, 1.0, 0); orbit.dist = 3.3; orbit.yaw = F - Math.PI / 2; orbit.pitch = 0.05; }
  else if (gal.cam === 'back') { orbit.target.set(fx, 1.1, 0); orbit.dist = 2.8; orbit.yaw = 0.5; orbit.pitch = 0.12; }
  else if (gal.cam === 'top') { orbit.target.set(fx, 1.0, 0); orbit.dist = 3.4; orbit.yaw = F - 0.6; orbit.pitch = 0.9; }
  else if (gal.cam === 'face') { orbit.target.set(fx, 1.62, 0); orbit.dist = 0.95; orbit.yaw = F - 0.35; orbit.pitch = 0.02; }
}

const _vel = new THREE.Vector3();
function galleryParams(s, i, t, dt) {
  const def = s.def || WEAPONS.ar_m17;
  const a = gal.anim;
  const p = { velocity: _vel.set(0, 0, 0), aimYaw: 0, aimPitch: 0, crouch: false, sprint: false, ads: 0, onGround: true, idleLook: false };
  const fwd = (v) => p.velocity.set(0, 0, -v);
  switch (a) {
    case 'idle': p.idleLook = true; break;
    case 'ads': p.ads = 1; break;
    case 'fire': {
      p.ads = 1;
      const interval = 60 / Math.max(60, def.rpm || 600);
      const k = Math.floor(t / interval), k0 = Math.floor((t - dt) / interval);
      p.firing = (t % 2.2) < 1.1 && k !== k0;
      break;
    }
    case 'walk': fwd(1.7); break;
    case 'run': fwd(5.2); break;
    case 'sprint': fwd(8.0); p.sprint = true; break;
    case 'strafeR': p.velocity.set(4.4, 0, 0); break;
    case 'strafeL': p.velocity.set(-4.4, 0, 0); break;
    case 'back': p.velocity.set(0, 0, 3.6); break;
    case 'diag': p.velocity.set(3.2, 0, -3.2); break;
    case 'crouch': p.crouch = true; break;
    case 'crouchwalk': p.crouch = true; fwd(2.5); break;
    case 'air': p.onGround = (t % 1.6) > 0.8; fwd(4); break;
    case 'turn': p.aimYaw = Math.sin(t * 0.6) * 2.2; break;
    case 'aimUp': p.aimPitch = 0.75; p.ads = 1; break;
    case 'aimDown': p.aimPitch = -0.6; p.ads = 1; break;
    case 'reload': case 'reloadEmpty': {
      const dur = (a === 'reload' ? def.reloadTime : def.reloadEmptyTime) || 2.4;
      const cyc = dur + 0.8;
      const r = (t % cyc) / dur;
      p.reloading = r < 1;
      p.reloadProgress = Math.min(1, r);
      p.reloadEmpty = a === 'reloadEmpty';
      p.perShell = !!def.perShellReload;
      break;
    }
    case 'throw': { const c = t % 1.8; p.throwing = c < 0.96; break; }
    case 'melee': { const c = t % 1.4; p.meleeing = c < 0.75; break; }
    case 'hit': if (Math.floor(t / 0.9) !== Math.floor((t - dt) / 0.9)) s.playHit(new THREE.Vector3(Math.sin(t * 3 + i), 0, Math.cos(t * 3 + i)), i % 3 === 0 ? 'head' : 'body', 30); break;
    default: break;
  }
  p.position = s.home;
  return p;
}

function updateGallery(dt) {
  gal.t += dt;
  for (let i = 0; i < gal.soldiers.length; i++) {
    const s = gal.soldiers[i];
    if (gal.anim === 'death') {
      const cyc = gal.t % 6.5;
      if (s.state === 'alive' && cyc > 0.6 && cyc < 1) s.playDeath(new THREE.Vector3(Math.sin(i * 1.7), 0, Math.cos(i * 1.7)), { velocity: new THREE.Vector3(0, 0, -1.5), zone: i % 3 === 0 ? 'head' : 'body', strength: 1 + (i % 2) * 0.6, scene: gal.scene });
      else if (s.state !== 'alive' && cyc < 0.5) s.reset(s.home, 0);
      if (s.state === 'dead') { s.updateDead(dt, flatWorld); continue; }
      if (s.state === 'hidden') continue;
    }
    s.animate(dt, galleryParams(s, i, gal.t, dt));
    if (gal.lod === 'auto') s.updateLod(camera.position.distanceTo(s.root.position) * (camera.fov / 40), 'high');
    else { s.lod = -1; s.updateLod(0); for (let k = 0; k < 3; k++) s.meshes[k].visible = k === Number(gal.lod); s.lod = Number(gal.lod); }
  }
}

function galleryUi() {
  const sc = $('scheme');
  for (const [id, s] of Object.entries(SCHEMES)) sc.add(new Option(`${s.name} (${id})`, id));
  sc.value = gal.scheme;
  sc.onchange = () => { gal.scheme = sc.value; respawnGallery(); };
  const wp = $('weapon');
  for (const w of Object.values(WEAPONS)) wp.add(new Option(w.name, w.id));
  wp.value = gal.weaponId;
  wp.onchange = () => {
    gal.weaponId = wp.value;
    const def = WEAPONS[gal.weaponId];
    for (const s of gal.soldiers) s.setWeaponModel(createWeaponModel(def.model, { lod: 'third' }), def);
  };
  const an = $('anim');
  for (const [id, label] of Object.entries(ANIMS)) an.add(new Option(label, id));
  an.value = gal.anim;
  an.onchange = () => { gal.anim = an.value; gal.t = 0; for (const s of gal.soldiers) if (s.state !== 'alive') s.reset(s.home, 0); };
  $('lod').value = gal.lod;
  $('lod').onchange = () => { gal.lod = $('lod').value; };
  $('cam').value = gal.cam;
  $('cam').onchange = () => { gal.cam = $('cam').value; setGalleryCamera(); };
  $('shoot').onclick = () => { for (const s of gal.soldiers) s.anim.shot(1); };
  $('hit').onclick = () => { for (const s of gal.soldiers) s.playHit(new THREE.Vector3(0, 0, 1), 'body', 40); };
  $('die').onclick = () => { for (const s of gal.soldiers) s.playDeath(new THREE.Vector3(Math.random() - 0.5, 0, 1).normalize(), { scene: gal.scene }); };
  $('respawn').onclick = () => { for (const s of gal.soldiers) s.reset(s.home, 0); };
}

/* ================================================================ Sandkasten (wird von sandbox.js ergänzt) */

let sandbox = null;
async function enterSandbox() {
  if (!sandbox) {
    const mod = await import('./bots-sandbox.js');
    sandbox = await mod.createSandbox({ renderer, camera, orbit, params, $, setProgress });
  }
  return sandbox;
}

/* ================================================================ Rahmen */

function setProgress(text) {
  const el = $('progress');
  if (!text) { el.style.display = 'none'; return; }
  el.style.display = '';
  $('ptext').textContent = text;
}

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (state.frozen != null) dt = 0;
  flyKeys(dt || 1 / 60);
  if (state.view === 'gallery' && gal.scene) {
    updateGallery(dt);
    applyOrbit();
    renderer.render(gal.scene, camera);
    const tri = renderer.info.render.triangles;
    const s0 = gal.soldiers[0];
    $('stats').textContent = `${fps} FPS · ${renderer.info.render.calls} Draw Calls · ${(tri / 1000).toFixed(1)}k Dreiecke\n` +
      `LOD-Dreiecke: ${s0 ? s0.meshes.map((m) => m.geometry.userData.triangles).join(' / ') : '–'}\nVariante: ${VARIANTS[Math.min(VARIANTS.length - 1, gal.focus)].name}`;
  } else if (state.view === 'sandbox' && sandbox) {
    sandbox.update(dt, fps);
  }
}

async function setView(v) {
  state.view = v;
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === v);
  $('gal-ui').hidden = v !== 'gallery';
  $('sb-ui').hidden = v !== 'sandbox';
  if (v === 'sandbox') await enterSandbox();
  else setGalleryCamera();
}

async function main() {
  setProgress('Lade Modelle …');
  await new Promise((r) => setTimeout(r, 0));
  try { preloadWeaponModels(undefined, ['third']); } catch (err) { console.warn('[bots] Modelle:', err); }
  buildGallery();
  galleryUi();
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  $('collapse').onclick = () => $('panel').classList.toggle('collapsed');
  setProgress(null);
  if (state.frozen != null) {
    // eingefrorene Zeit: bis t vorspulen
    const steps = Math.round(state.frozen * 60);
    for (let i = 0; i < steps; i++) updateGallery(1 / 60);
  }
  await setView(state.view);
  requestAnimationFrame(frame);
}

window.__bots = { step: (dt) => updateGallery(dt), gal, state, renderer, camera, orbit, setView, respawnGallery, setGalleryCamera, get sandbox() { return sandbox; } };
main().catch((err) => { console.error(err); setProgress('Fehler: ' + err.message); });
