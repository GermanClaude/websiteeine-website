// Waffengefühl-Labor (dev/feel.html): echter WeaponController + ViewModel + Effects (Hülsen, Magazine,
// Einschläge, Mündungslicht) in einem kleinen Prüfraum mit verschiedenen Oberflächen und einer nahen Wand.
// Prüft Trägheit (F2), Körperkamera-Haltung (F9), Wandkollision (F3), Rückstoß 2.0 (F7), Physik-lite (P4).
// Testhaken: window.__feel = { G, ctrl, vm, actor, step(s), setWeapon(id), setQuality(q), setPose(p), hold(a, on),
//   walk(x, y), look(dx, dy), toWall(), state() }
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EventBus } from '../../assets/js/game/engine/events.js';
import { Effects } from '../../assets/js/game/engine/effects.js';
import { ViewModel } from '../../assets/js/game/weapons/viewmodel.js';
import { WeaponController } from '../../assets/js/game/weapons/controller.js';
import { WEAPONS, WEAPON_IDS, EQUIPMENT, weaponHandling } from '../../assets/js/shared/weapons.data.js';
import { DEFAULTS } from '../../assets/js/shared/settings.js';

const params = new URLSearchParams(location.search);
const fixed = params.has('fixed');
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

/* ------------------------------------------------------------ Prüfraum */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa6bf);
scene.fog = new THREE.Fog(0x8fa6bf, 30, 120);
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
scene.environment = envMap;
scene.environmentIntensity = 0.55;
const sunDir = new THREE.Vector3(0.45, 0.8, 0.3).normalize();
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
sun.position.copy(sunDir).multiplyScalar(40);
scene.add(sun, new THREE.HemisphereLight(0xbcd0ea, 0x5a4c3e, 0.7));

function noiseTex(base, spots = 3000, seed = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < spots; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.07})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 5, 1 + r() * 5); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const solids = [];
function slab(w, h, d, x, y, z, color, surface, rough = 0.9, metal = 0, rep = 2) {
  const tex = noiseTex(color, 2500, (x * 31 + z * 7 + 99) | 0);
  tex.repeat.set(rep, rep);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: metal }));
  m.position.set(x, y, z);
  m.userData.surface = surface;
  scene.add(m);
  solids.push(m);
  return m;
}
// Boden in Streifen: Beton, Metall, Holz, Erde, Fliesen, Wasser
slab(40, 0.2, 40, 0, -0.1, 0, '#8d8a84', 'concrete', 0.95, 0, 10);
slab(2.4, 0.04, 6, -3, 0.02, -3, '#6f7378', 'metal', 0.45, 0.8, 2);
slab(2.4, 0.04, 6, -0.4, 0.02, -3, '#8a6a46', 'wood', 0.8, 0, 2);
slab(2.4, 0.04, 6, 2.2, 0.02, -3, '#6b5a45', 'dirt', 1, 0, 2);
slab(2.4, 0.04, 6, 4.8, 0.02, -3, '#c9c3b6', 'tile', 0.6, 0, 3);
const water = slab(3, 0.02, 3, 8, 0.01, 2, '#3b5c6e', 'water', 0.08, 0, 1);
water.material.transparent = true; water.material.opacity = 0.85;
// Wände: nah (Kollision), Putz, Metallplatte, Holzwand, Kisten
slab(8, 3, 0.3, 0, 1.5, -9, '#d9d1c2', 'plaster', 0.95, 0, 3);
slab(0.3, 3, 8, -7, 1.5, -2, '#7d8085', 'concrete', 0.9, 0, 3);
slab(2, 2, 0.1, 4, 1, -8.7, '#5b6168', 'metal', 0.4, 0.85, 1);
slab(0.2, 2.2, 3, 7, 1.1, -4, '#7a5a3a', 'wood', 0.75, 0, 2);
slab(1.2, 1.2, 1.2, -3, 0.6, 3, '#7b5b3a', 'wood', 0.8, 0, 1);
slab(1, 1.6, 1, 3, 0.8, 4, '#6e7177', 'metal', 0.5, 0.7, 1);

const raycaster = new THREE.Raycaster();
const world = {
  lighting: {
    sunDirection: sunDir.clone(), sunColor: new THREE.Color(0xfff0dc), sunIntensity: 2.4, hemiSky: new THREE.Color(0xbcd0ea),
    hemiGround: new THREE.Color(0x5a4c3e), hemiIntensity: 0.7, envMap, envIntensity: 0.55, fogColor: scene.fog.color,
  },
  bounds: new THREE.Box3(new THREE.Vector3(-20, -3, -20), new THREE.Vector3(20, 20, 20)),
  raycast(origin, dir, maxDist = 1000) {
    raycaster.set(origin, dir);
    raycaster.far = maxDist;
    const h = raycaster.intersectObjects(solids, false)[0];
    if (!h) return null;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { distance: h.distance, point: h.point, normal: n, surface: h.object.userData.surface || 'concrete', object: h.object };
  },
  lineOfSight(a, b) {
    const d = new THREE.Vector3().subVectors(b, a); const l = d.length();
    return !this.raycast(a, d.divideScalar(l), l - 0.02);
  },
  groundHeight(x, z, yFrom = 30) { const h = this.raycast(new THREE.Vector3(x, yFrom, z), new THREE.Vector3(0, -1, 0), yFrom + 20); return h ? h.point.y : null; },
  surfaceAt(p) { const h = this.raycast(new THREE.Vector3(p.x, p.y + 0.3, p.z), new THREE.Vector3(0, -1, 0), 2.5); return h ? h.surface : 'concrete'; },
};

/* ------------------------------------------------------------ Spielkontext (Ausschnitt von G) */
const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.05, 400);
camera.rotation.order = 'YXZ';
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(ViewModel.FOV, 16 / 9, 0.01, 20);
const values = { ...DEFAULTS, weaponPose: params.get('pose') || 'bodycam', weaponSway: 1 };
const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; return v; } };
const PRESETS = { low: { id: 'low', particleScale: 0.45, decals: 40 }, medium: { id: 'medium', particleScale: 0.7, decals: 80 }, high: { id: 'high', particleScale: 1, decals: 120 }, ultra: { id: 'ultra', particleScale: 1.25, decals: 120 } };
const qListeners = new Set();
const held = new Set(), pressed = new Set();
const input = {
  mode: 'desktop',
  down: (a) => held.has(a), pressed: (a) => pressed.has(a), active: (a) => held.has(a),
};
const G = {
  THREE, scene, camera, events: new EventBus(), settings, input, world,
  viewmodel: { scene: vmScene, camera: vmCamera, rig: null },
  renderer: {
    renderer, quality: params.get('quality') || 'high', get preset() { return PRESETS[this.quality]; }, height: innerHeight,
    onQualityChange(fn) { qListeners.add(fn); return () => qListeners.delete(fn); },
  },
  data: { WEAPONS, EQUIPMENT }, modules: { viewmodel: { ViewModel } },
  time: { dt: 0, elapsed: 0 }, match: { state: 'playing', modeId: 'training' }, actors: [],
};
// Mini-Kampf: Kugeln treffen die Welt (Einschläge), keine Akteure
G.combat = {
  isHostile: () => false,
  fireHitscan({ shooter, origin, dir, range, weapon }) {
    const h = world.raycast(origin, dir, range || 100);
    if (!h) return { hit: null, point: origin.clone().addScaledVector(dir, range || 100) };
    G.events.emit('impact', { point: h.point, normal: h.normal, surface: h.surface, shooter, weaponId: weapon.id });
    return { hit: 'world', point: h.point, distance: h.distance, normal: h.normal, surface: h.surface };
  },
};
G.events.scope = G.events.scope || (() => { const offs = []; return { on: (n, f) => offs.push(G.events.on(n, f)), dispose: () => offs.splice(0).forEach((o) => o()) }; });

/* ------------------------------------------------------------ Spieler (vereinfachter Akteur) */
const actor = {
  id: 'player', isPlayer: true, isBot: false, alive: true, team: 'A', health: 100,
  position: new THREE.Vector3(0, 0, 2), body: { velocity: new THREE.Vector3(), height: 1.8, onGround: true },
  yaw: 0, pitch: 0, lean: 0, aimOffset: { x: 0, y: 0 }, crouching: false, sprinting: false, eye: 1.65,
  recoilP: 0, recoilY: 0, kick: 0, trauma: 0,
  getEyePosition(out = new THREE.Vector3()) {
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return out.set(this.position.x, this.position.y + this.eye, this.position.z).addScaledVector(r, this.lean * 0.38);
  },
  getAimDirection(out = new THREE.Vector3()) {
    const yaw = this.yaw + this.recoilY - this.aimOffset.x, pitch = this.pitch + this.recoilP + this.aimOffset.y;
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  },
  addRecoil(p, y, recovery) {
    this.pitch += p * 0.3; this.yaw -= y * 0.3; this.recoilP += p * 0.7; this.recoilY -= y * 0.7;
    this._rate = recovery || 8; this._last = G.time.elapsed; this.kick += p * 14;
    graphPush(p, 0);
  },
  shake(t) { this.trauma = Math.min(1, this.trauma + t); },
};
G.player = actor;
G.actors.push(actor);

const effects = new Effects(G);
G.effects = effects;
const system = { G, controllers: new Set(), throwGrenade() {}, explodeInHand() {} };
let ctrl = new WeaponController(system, actor, { primary: WEAPONS[params.get('weapon')] ? params.get('weapon') : 'ar_m17', secondary: 'pi_p9', lethal: null });
effects.attach(G);
const vm = () => ctrl.viewModel;
let quality = G.renderer.quality;

/* ------------------------------------------------------------ Eingabe */
const move = { x: 0, y: 0 };
let look = { dx: 0, dy: 0 };
const keyAct = { KeyR: 'reload', ShiftLeft: 'sprint', KeyC: 'crouch', Space: 'jump' };
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (keyAct[e.code]) { held.add(keyAct[e.code]); pressed.add(keyAct[e.code]); }
  if (e.code === 'KeyQ') leanTarget = -1;
  if (e.code === 'KeyE') leanTarget = 1;
  if (e.code === 'KeyC') actor.crouching = !actor.crouching;
});
addEventListener('keyup', (e) => {
  if (keyAct[e.code]) held.delete(keyAct[e.code]);
  if (e.code === 'KeyQ' || e.code === 'KeyE') leanTarget = +document.getElementById('lean').value;
});
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('click', () => { if (!document.pointerLockElement && matchMedia('(pointer: fine)').matches) canvas.requestPointerLock?.(); });
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { look.dx += e.movementX * 0.0022; look.dy += e.movementY * 0.0022; } });
canvas.addEventListener('mousedown', (e) => { if (!document.pointerLockElement) return; if (e.button === 0) { held.add('fire'); pressed.add('fire'); } if (e.button === 2) held.add('ads'); });
addEventListener('mouseup', (e) => { if (e.button === 0) held.delete('fire'); if (e.button === 2) held.delete('ads'); });
addEventListener('contextmenu', (e) => e.preventDefault());
// Touch: Ziehen dreht, Knöpfe rechts
let tId = null, tx = 0, ty = 0;
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { input.mode = 'touch'; tId = e.pointerId; tx = e.clientX; ty = e.clientY; } });
canvas.addEventListener('pointermove', (e) => { if (e.pointerId === tId) { look.dx += (e.clientX - tx) * 0.004; look.dy += (e.clientY - ty) * 0.004; tx = e.clientX; ty = e.clientY; } });
canvas.addEventListener('pointerup', (e) => { if (e.pointerId === tId) tId = null; });
for (const b of document.querySelectorAll('#touch button')) {
  const a = b.dataset.t;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (a === 'ads') { held.has('ads') ? held.delete('ads') : held.add('ads'); b.classList.toggle('on', held.has('ads')); } else { held.add(a); pressed.add(a); } });
  b.addEventListener('pointerup', () => { if (a !== 'ads') held.delete(a); });
}

/* ------------------------------------------------------------ Bedienfeld */
const sel = document.getElementById('weapon');
for (const id of WEAPON_IDS) { const o = document.createElement('option'); o.value = id; o.textContent = WEAPONS[id].name; sel.append(o); }
sel.value = ctrl.currentDef.id;
sel.addEventListener('change', () => setWeapon(sel.value));
const mark = (attr, v) => document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.toggle('on', b.dataset[attr] === String(v)));
document.querySelectorAll('[data-pose]').forEach((b) => b.addEventListener('click', () => setPose(b.dataset.pose)));
document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => setQuality(b.dataset.q)));
document.querySelectorAll('[data-fa]').forEach((b) => b.addEventListener('click', () => { freeAim = +b.dataset.fa; mark('fa', b.dataset.fa); }));
const sway = document.getElementById('sway');
sway.addEventListener('input', () => { values.weaponSway = +sway.value; document.getElementById('swayV').textContent = `${Math.round(sway.value * 100)} %`; });
const leanEl = document.getElementById('lean');
let leanTarget = 0;
leanEl.addEventListener('input', () => { leanTarget = +leanEl.value; document.getElementById('leanV').textContent = (+leanEl.value).toFixed(2); });
let freeAim = 0;
document.getElementById('toWall').addEventListener('click', toWall);
document.getElementById('spray').addEventListener('click', () => { held.add('fire'); pressed.add('fire'); setTimeout(() => held.delete('fire'), 1500); });
document.getElementById('clear').addEventListener('click', () => effects.clear());
mark('pose', values.weaponPose); mark('q', quality); mark('fa', 0);

function setWeapon(id) { ctrl.setLoadout({ primary: id, secondary: null, lethal: null }); sel.value = id; }
function setPose(p) { values.weaponPose = p; mark('pose', p); }
function setQuality(q) { quality = G.renderer.quality = q; for (const fn of qListeners) fn(q); effects.detach(); effects.attach(G); mark('q', q); }
function toWall() { actor.position.set(0, 0, -8.45); actor.yaw = 0; actor.pitch = 0; }

/* ------------------------------------------------------------ Rückstoß-Graph */
const gc = document.getElementById('graph'), gx = gc.getContext('2d');
const hist = [];
function graphPush(p) { hist.push({ t: G.time.elapsed, p }); }
function drawGraph() {
  const W = gc.width, H = gc.height;
  gx.clearRect(0, 0, W, H);
  gx.fillStyle = 'rgba(255,255,255,.5)'; gx.font = '18px monospace';
  gx.fillText('Zielrückstoß (orange) · Waffenstoß (weiß)', 8, 22);
  const now = G.time.elapsed;
  while (hist.length && now - hist[0].t > 3) hist.shift();
  gx.strokeStyle = '#ff5b1f'; gx.lineWidth = 2; gx.beginPath();
  samples.forEach((s, i) => { const x = (i / 180) * W, y = H - 20 - s.aim * 2600; i ? gx.lineTo(x, y) : gx.moveTo(x, y); });
  gx.stroke();
  gx.strokeStyle = '#fff'; gx.beginPath();
  samples.forEach((s, i) => { const x = (i / 180) * W, y = H - 20 - s.vis * 900; i ? gx.lineTo(x, y) : gx.moveTo(x, y); });
  gx.stroke();
}
const samples = [];

/* ------------------------------------------------------------ Takt */
const intent = { fire: false, firePressed: false, ads: false, reload: false, swap: false, slot: null, grenade: false, grenadeHeld: false, melee: false, sprinting: false, moving: false, airborne: false, onGround: true, crouching: false, sliding: false, speed: 0, lookDX: 0, lookDY: 0, frozen: false };
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _wish = new THREE.Vector3();
let vy = 0;
function step(dt) {
  G.time.dt = dt; G.time.elapsed += dt;
  // Blick
  actor.yaw -= look.dx; actor.pitch = THREE.MathUtils.clamp(actor.pitch - look.dy, -1.45, 1.45);
  intent.lookDX = look.dx; intent.lookDY = look.dy; look = { dx: 0, dy: 0 };
  // Bewegung
  const mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + move.x;
  const my = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + move.y;
  actor.sprinting = held.has('sprint') && my > 0.3 && !held.has('ads') && !held.has('fire');
  const sp = actor.sprinting ? 8.2 : actor.crouching ? 2.6 : 5.4 * (1 - 0.4 * ctrl.adsProgress);
  _f.set(-Math.sin(actor.yaw), 0, -Math.cos(actor.yaw)); _r.set(Math.cos(actor.yaw), 0, -Math.sin(actor.yaw));
  _wish.set(0, 0, 0).addScaledVector(_f, my).addScaledVector(_r, mx);
  if (_wish.lengthSq() > 1) _wish.normalize();
  _wish.multiplyScalar(sp);
  const v = actor.body.velocity;
  const k = 1 - Math.exp(-12 * dt);
  v.x += (_wish.x - v.x) * k; v.z += (_wish.z - v.z) * k;
  if (pressed.has('jump') && actor.body.onGround) { vy = 5.1; actor.body.onGround = false; }
  vy -= 24 * dt;
  actor.position.addScaledVector(v, dt);
  actor.position.y += vy * dt;
  if (actor.position.y <= 0) { actor.position.y = 0; vy = 0; actor.body.onGround = true; }
  v.y = vy;
  actor.eye += ((actor.crouching ? 1.0 : 1.65) - actor.eye) * (1 - Math.exp(-14 * dt));
  actor.lean += (leanTarget - actor.lean) * (1 - Math.exp(-11 * dt));
  const fa = freeAim;
  actor.aimOffset.x += ((fa ? Math.sin(G.time.elapsed * 0.9) * fa : 0) - actor.aimOffset.x) * (1 - Math.exp(-6 * dt));
  actor.aimOffset.y += ((fa ? Math.sin(G.time.elapsed * 1.3) * fa * 0.6 : 0) - actor.aimOffset.y) * (1 - Math.exp(-6 * dt));
  // Rückstoß zurückführen
  if (G.time.elapsed - (actor._last || 0) > 0.09) { const r = Math.exp(-(actor._rate || 8) * dt); actor.recoilP *= r; actor.recoilY *= r; }
  actor.kick *= Math.exp(-12 * dt);
  actor.trauma = Math.max(0, actor.trauma - 1.5 * dt);
  // Waffe
  const hs = Math.hypot(v.x, v.z);
  Object.assign(intent, {
    fire: held.has('fire'), firePressed: pressed.has('fire'), ads: held.has('ads') && !actor.sprinting, reload: pressed.has('reload'),
    sprinting: actor.sprinting, moving: hs > 0.5, airborne: !actor.body.onGround, onGround: actor.body.onGround,
    crouching: actor.crouching, speed: hs, leaning: actor.lean,
  });
  ctrl.update(dt, intent);
  // Kamera (Lehnen: Versatz + Rollen)
  const eye = actor.getEyePosition(new THREE.Vector3());
  const sh = actor.trauma * actor.trauma, t = G.time.elapsed;
  camera.position.copy(eye);
  camera.rotation.set(actor.pitch + actor.recoilP + actor.kick * 0.02 + Math.sin(t * 37) * sh * 0.03, actor.yaw + actor.recoilY + Math.sin(t * 41) * sh * 0.03, -actor.lean * 0.24, 'YXZ');
  const def = ctrl.currentDef;
  const zoom = def.adsZoom || def.scope?.zoom || 1;
  camera.fov = 65 / (1 + (zoom - 1) * ctrl.adsProgress);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  effects.update(dt);
  pressed.clear();
  // Graph: Zielrückstoß (Kamera-Pitch-Anteil) und sichtbarer Waffenstoß (Viewmodel-Feder)
  const r = vm();
  samples.push({ aim: actor.recoilP, vis: r ? (r._recoilRot.value.x + r._climb) : 0 });
  if (samples.length > 180) samples.shift();
}

// Wie im Spiel ab medium: Welt + Viewmodel in ein HDR-Ziel (Hitzeflimmern kopiert daraus), dann aufs Bild
const useRT = params.get('rt') !== '0';
let hdr = null;
const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tSrc;\nvarying vec2 vUv;\nvoid main() {\n  gl_FragColor = texture2D(tSrc, vUv);\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}',
  depthTest: false, depthWrite: false, toneMapped: true,
}));
blit.frustumCulled = false;
const blitScene = new THREE.Scene(); blitScene.add(blit);
const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
function render() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = vmCamera.aspect = w / h;
    vmCamera.updateProjectionMatrix();
    G.renderer.height = h;
    if (hdr) { hdr.dispose(); hdr = null; }
  }
  if (useRT && !hdr) {
    const b = renderer.getDrawingBufferSize(new THREE.Vector2());
    hdr = new THREE.WebGLRenderTarget(b.x, b.y, { type: THREE.HalfFloatType, depthBuffer: true });
  }
  renderer.setRenderTarget(useRT ? hdr : null);
  renderer.autoClear = true;
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(vmScene, vmCamera);
  renderer.autoClear = true;
  if (useRT) {
    renderer.setRenderTarget(null);
    blit.material.uniforms.tSrc.value = hdr.texture;
    renderer.render(blitScene, blitCam);
  }
}

const info = document.getElementById('info');
let last = performance.now(), acc = 0, frame = 0;
function loop(now) {
  const dt = fixed ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) step(dt);
  render();
  if (++frame % 6 === 0) {
    const d = effects.debris.stats, hd = weaponHandling(ctrl.currentDef);
    info.textContent = `${ctrl.currentDef.name} · ${hd.mass} kg · Reichweite ${hd.reach} m\n` +
      `Haltung: ${vm()?.pose === 'bodycam' ? 'Körperkamera' : 'Standard'}\n` +
      `Wandkollision: ${Math.round(ctrl.obstructed * 100)} %${ctrl.obstructed > 0.72 ? ' (Feuer gesperrt)' : ctrl.obstructed > 0.45 ? ' (kein Anschlag)' : ''}\n` +
      `Atemnot: ${Math.round(ctrl.winded * 100)} %\n` +
      `Laufhitze: ${Math.round((vm()?._heat || 0) * 100)} %${vm()?.haze?.mesh.visible ? ' · Flimmern' : ''}${vm()?.haze?.failed ? ' (nicht verfügbar)' : ''}\n` +
      `Hülsen: ${d.shells} · fliegend ${d.flying} · Magazine ${d.mags}\nStrahlen/Bild: ${d.rays}\n` +
      `Munition: ${ctrl.ammo.mag}/${ctrl.ammo.magSize}  Anschlag ${Math.round(ctrl.adsProgress * 100)} %\n` +
      `Draw Calls: ${renderer.info.render.calls}`;
    drawGraph();
  }
  requestAnimationFrame(loop);
}
let paused = false;
requestAnimationFrame(loop);

window.__feel = {
  G, get ctrl() { return ctrl; }, get vm() { return vm(); }, actor, effects, world,
  pause(on = true) { paused = on; },
  step(sec, hz = 60) { const n = Math.round(sec * hz); for (let i = 0; i < n; i++) step(1 / hz); render(); },
  setWeapon, setQuality, setPose, toWall,
  hold(a, on = true) { if (on) { held.add(a); pressed.add(a); } else held.delete(a); },
  walk(x, y) { move.x = x; move.y = y; },
  look(dx, dy) { look.dx += dx; look.dy += dy; },
  lean(v) { leanTarget = v; },
  freeAim(v) { freeAim = v; },
  state() { const v = vm(); return { obstructed: ctrl.obstructed, winded: ctrl.winded, ads: ctrl.adsProgress, debris: { ...effects.debris.stats }, pose: v?.pose, ammo: ctrl.ammo, heat: v?._heat, haze: v ? { on: v.haze.mesh.visible, failed: v.haze.failed, strength: v.haze.uniforms.uStrength.value } : null }; },
};
