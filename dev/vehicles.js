// NULLPUNKT — Fahrzeug-Prüfstand (dev/vehicles.html): Testgelände mit Rampe, Hang, Hügel, Mauer, Blöcken und
// Bordsteinen; echte VehicleSystem/Combat-Klassen, schlanke Ersatz-Eingabe (Tastatur/Maus, Pointer-Lock),
// Zielpuppen (feindliche Akteure) und Skript-Hooks (window.__dev) für automatisierte Fahrtests.
// URL: ?type=mbt|jeep&cam=tp|fp&quality=high&seat=0&auto=1&dummies=1&enemy=1
import * as THREE from 'three';
import { EventBus } from '../assets/js/game/engine/events.js';
import { CapsuleBody } from '../assets/js/game/engine/physics.js';
import { Combat, raycastHumanoid } from '../assets/js/game/combat.js';
import { TriangleBVH } from '../assets/js/game/world/bvh.js';
import { buildColliderOctree } from '../assets/js/game/world/collider.js';
import { getMaterial, boxUV } from '../assets/js/game/engine/textures.js';
import { settings } from '../assets/js/shared/settings.js';
import { DEFAULT_BINDINGS, codeLabel } from '../assets/js/shared/bindings.data.js';
import * as WD from '../assets/js/shared/weapons.data.js';
import { VehicleSystem } from '../assets/js/game/vehicles/index.js';
import { vehicleTriangles } from '../assets/js/game/vehicles/models.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const LITE = params.get('lite') === '1'; // Tests: halbe Auflösung, ohne Schatten
renderer.setPixelRatio(LITE ? 0.5 : Math.min(1.5, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c6);
scene.fog = new THREE.Fog(0x9fb4c6, 120, 420);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new (class extends THREE.Scene {
  constructor() {
    super();
    const g = new THREE.SphereGeometry(50, 16, 8);
    const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true });
    const c = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 50; const t = Math.max(0, y); c.push(0.55 + 0.35 * t, 0.62 + 0.3 * t, 0.7 + 0.28 * t); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    this.add(new THREE.Mesh(g, m));
  }
})(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x5a5040, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.set(40, 70, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

/* ------------------------------------------------------------------ Gelände */
const tris = [];
const groups = new Map();
function addGeom(g, matName) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) tris.push(p.getX(i), p.getY(i), p.getZ(i));
  if (!groups.has(matName)) groups.set(matName, []);
  groups.get(matName).push(g);
}
function boxAt(w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  addGeom(g, mat);
}
// Boden
{ const g = new THREE.PlaneGeometry(320, 320, 8, 8); g.rotateX(-Math.PI / 2); addGeom(g, 'asphalt'); }
// Hügel
{
  const g = new THREE.PlaneGeometry(56, 56, 28, 28); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 5.5 * Math.exp(-(x * x + z * z) / 220) - 0.02); }
  g.translate(55, 0, -45);
  addGeom(g, 'grass');
}
// Keil (Seitenprofil z/y, Breite w in X): Rampe von zA (Boden) nach zB (Höhe h)
function wedge(x, w, zA, zB, h, mat) {
  const sh = new THREE.Shape([new THREE.Vector2(zA, 0), new THREE.Vector2(zB, 0), new THREE.Vector2(zB, h)]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1)); // Profil-u → z, Tiefe → −x (det +1, Wicklung bleibt)
  g.translate(x, 0, 0);
  addGeom(g, mat);
}
// Rampe (≈ 11°) + Plateau 3 m + Abfahrt
wedge(-40, 9, 18, 3, 3, 'concrete');
boxAt(9, 3.0, 12, -40, 1.5, -3, 'concrete');
wedge(-40, 9, -24, -9, 3, 'concrete');
// 25°-Hang
boxAt(14, 1, 26, 30, 2.4, 40, 'dirt', 0.42, 0, 0);
// Mauer, Blöcke, Bordsteine
boxAt(36, 3.2, 1.0, -10, 1.6, -60, 'concrete');
for (let i = 0; i < 7; i++) boxAt(2, 2, 2, -24 + i * 8, 1, -35 + (i % 2) * 6, 'concrete', 0, i * 0.4, 0);
for (let i = 0; i < 5; i++) boxAt(18, 0.22, 0.5, 6, 0.11, 2 - i * 7, 'concrete');
// Container-Reihe als Deckung
for (let i = 0; i < 3; i++) boxAt(2.4, 2.6, 6, 70 + i * 3.2, 1.3, 20, 'container_green');

const pos = new Float32Array(tris);
const bvh = new TriangleBVH(pos);
const collider = buildColliderOctree(pos);
const worldGroup = new THREE.Group();
for (const [name, list] of groups) {
  for (const g of list) {
    boxUV(g, 2);
    const mesh = new THREE.Mesh(g, getMaterial(name));
    mesh.receiveShadow = true;
    mesh.castShadow = name !== 'asphalt';
    worldGroup.add(mesh);
  }
}
scene.add(worldGroup);
const hitOut = {};
const world = {
  id: 'dev-vehicles', name: 'Fahrzeug-Prüfstand',
  group: worldGroup, collider, collisionBVH: bvh,
  bounds: new THREE.Box3(new THREE.Vector3(-155, -5, -155), new THREE.Vector3(155, 60, 155)),
  debugData: { colliderBVH: bvh, bulletBVH: bvh },
  spawns: { A: [{ position: new THREE.Vector3(0, 0, 40), yaw: 0 }], B: [{ position: new THREE.Vector3(0, 0, -90), yaw: Math.PI }], ffa: [] },
  raycast(o, d, max = 1000) {
    if (!bvh.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, hitOut)) return null;
    return { distance: hitOut.t, point: new THREE.Vector3(o.x + d.x * hitOut.t, o.y + d.y * hitOut.t, o.z + d.z * hitOut.t), normal: new THREE.Vector3(hitOut.nx, hitOut.ny, hitOut.nz), surface: 'concrete', object: null };
  },
  lineOfSight(a, b) { const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz); return l < 1e-4 || !bvh.occluded(a.x, a.y, a.z, dx / l, dy / l, dz / l, l - 0.02); },
  groundHeight(x, z, yFrom = 30) { return bvh.raycast(x, yFrom, z, 0, -1, 0, yFrom + 20, hitOut) ? yFrom - hitOut.t : null; },
  surfaceAt() { return 'concrete'; },
  update() {},
};

/* ------------------------------------------------------------------ Eingabe (Ersatz) */
class DevInput {
  constructor() {
    this.mode = 'desktop'; this.lastDevice = 'keyboard';
    this.move = { x: 0, y: 0 }; this.look = { dx: 0, dy: 0 };
    this._held = new Set(); this._pressed = new Set(); this._sim = new Set(); this._taps = new Set();
    this._mx = 0; this._my = 0; this._simMove = null;
    this.codes = new Map();
    for (const [a, list] of Object.entries(DEFAULT_BINDINGS.kb)) for (const c of list) { if (!this.codes.has(c)) this.codes.set(c, []); this.codes.get(c).push(a); }
    const press = (a) => { if (!this.down(a)) this._pressed.add(a); this._held.add(a); };
    const rel = (a) => this._held.delete(a);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') { document.getElementById('panel').classList.toggle('collapsed'); return; }
      const acts = this.codes.get(e.code); if (!acts) return; e.preventDefault(); if (!e.repeat) acts.forEach(press);
    });
    addEventListener('keyup', (e) => { const acts = this.codes.get(e.code); if (acts) acts.forEach(rel); });
    canvas.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      (this.codes.get(`Mouse${e.button}`) || []).forEach(press);
    });
    addEventListener('mouseup', (e) => (this.codes.get(`Mouse${e.button}`) || []).forEach(rel));
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { this._mx += e.movementX; this._my += e.movementY; } });
    addEventListener('wheel', (e) => { if (document.pointerLockElement === canvas) { this._pressed.add('swap'); } e.preventDefault?.(); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.simulate = {
      press: (a) => { if (!this.down(a)) this._pressed.add(a); this._sim.add(a); },
      release: (a) => this._sim.delete(a),
      tap: (a) => { this._pressed.add(a); this._sim.add(a); this._taps.add(a); },
      move: (x, y) => { this._simMove = x == null ? null : { x, y }; },
      look: (dx, dy) => { this._mx += dx; this._my += dy; },
      clear: () => { this._sim.clear(); this._simMove = null; },
    };
  }
  down(a) { return this._held.has(a) || this._sim.has(a); }
  pressed(a) { return this._pressed.has(a); }
  active(a) { return this.down(a); }
  update() {
    let x = (this.down('move_right') ? 1 : 0) - (this.down('move_left') ? 1 : 0);
    let y = (this.down('move_forward') ? 1 : 0) - (this.down('move_back') ? 1 : 0);
    if (this._simMove) { x = this._simMove.x; y = this._simMove.y; }
    this.move.x = x; this.move.y = y;
    const k = 0.0022 * (G.camera.fov / 70);
    this.look.dx = this._mx * k; this.look.dy = this._my * k;
    this._mx = this._my = 0;
  }
  endFrame() { this._pressed.clear(); for (const t of this._taps) this._sim.delete(t); this._taps.clear(); }
  label(a) { const c = (DEFAULT_BINDINGS.kb[a] || [])[0]; return c ? codeLabel(c) : null; }
  cancelAds() {} setActive() {} rumble() {}
}

/* ------------------------------------------------------------------ Akteure */
function blankStats() { return { kills: 0, deaths: 0, assists: 0, score: 0, shotsFired: 0, shotsHit: 0, headshots: 0, streak: 0, bestStreak: 0, damage: 0, captures: 0 }; }
class DevPlayer {
  constructor() {
    this.id = 'p'; this.name = 'Du'; this.team = 'A'; this.isPlayer = true; this.alive = true; this.health = this.maxHealth = 100;
    this.body = new CapsuleBody({ radius: 0.35, height: 1.8 });
    this.yaw = 0; this.pitch = 0; this.baseFov = 62; this.stats = blankStats(); this.weaponStats = {}; this.lastDamageTime = -1e9;
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 900);
  }
  get position() { return this.body.position; }
  getEyePosition(o = new THREE.Vector3()) { return o.copy(this.body.position).setY(this.body.position.y + 1.65); }
  getAimDirection(o = new THREE.Vector3()) { const c = Math.cos(this.pitch); return o.set(-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c); }
  raycastHitboxes(ray, max) { return raycastHumanoid(this, ray, max); }
  onDamaged() {} shake() {}
  onDeath() { this.alive = false; setTimeout(() => { this.alive = true; this.health = 100; this.body.teleport(new THREE.Vector3(0, 0, 40)); }, 2500); }
  update(dt) {
    this.yaw -= input.look.dx; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - input.look.dy));
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const v = f.multiplyScalar(input.move.y * 6).add(r.multiplyScalar(input.move.x * 6));
    this.body.velocity.x = v.x; this.body.velocity.z = v.z;
    if (input.pressed('jump') && this.body.onGround) this.body.velocity.y = 7;
    this.body.step(dt, world, { gravity: 24, stepHeight: 0.45 });
    this.camera.position.copy(this.getEyePosition());
    this.camera.lookAt(this.camera.position.clone().add(this.getAimDirection()));
    if (Math.abs(this.camera.fov - this.baseFov) > 0.01) { this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix(); }
  }
}
const dummyMat = new THREE.MeshStandardMaterial({ color: 0xb8442c, roughness: 0.7 });
const dummyGeo = new THREE.CapsuleGeometry(0.32, 1.1, 4, 10).translate(0, 0.87, 0);
class Dummy {
  constructor(i, p) {
    this.id = `d${i}`; this.name = `Zielpuppe ${i + 1}`; this.team = 'B'; this.isBot = true; this.alive = true; this.health = this.maxHealth = 100;
    this.home = p.clone();
    this.body = new CapsuleBody({ radius: 0.35, height: 1.8 }); this.body.teleport(p);
    this.yaw = 0; this.pitch = 0; this.stats = blankStats(); this.weaponStats = {}; this.lastDamageTime = -1e9;
    this.mesh = new THREE.Mesh(dummyGeo, dummyMat); this.mesh.castShadow = true; scene.add(this.mesh);
  }
  get position() { return this.body.position; }
  getEyePosition(o = new THREE.Vector3()) { return o.copy(this.body.position).setY(this.body.position.y + 1.65); }
  getAimDirection(o = new THREE.Vector3()) { return o.set(0, 0, -1); }
  raycastHitboxes(ray, max) { return raycastHumanoid(this, ray, max); }
  onDamaged() {}
  onDeath() { this.alive = false; this.mesh.rotation.x = -Math.PI / 2; setTimeout(() => { this.alive = true; this.health = 100; this.mesh.rotation.x = 0; this.body.teleport(this.home); }, 4000); }
  respawn() {}
  update(dt) { if (this.alive) this.body.step(dt, world, { gravity: 24, stepHeight: 0.45 }); this.mesh.position.copy(this.body.position); }
}

/* ------------------------------------------------------------------ Spielkontext */
const input = new DevInput();
const player = new DevPlayer();
player.body.teleport(new THREE.Vector3(0, 0, 40));
const G = window.__game = {
  THREE, scene, renderer: { renderer, quality: params.get('quality') || 'high', width: innerWidth, height: innerHeight, lens: null },
  camera: player.camera, viewmodel: { scene: new THREE.Scene() }, events: new EventBus(), settings, input, audio: null, effects: {},
  world, player, actors: [player], match: { state: 'playing', ffa: false }, time: { dt: 0, elapsed: 0, frame: 0, real: 0 },
  params, data: { WEAPONS: WD.WEAPONS, EQUIPMENT: WD.EQUIPMENT },
};
G.combat = new Combat(G);
G.combat.attach(G);
// Ton (optional, erst nach Nutzergeste hörbar)
import('../assets/js/game/engine/audio.js').then((m) => { try { G.audio = new m.AudioEngine(G); G.audio.attach(G); } catch (e) { console.info('Audio aus', e && e.message); } }).catch(() => {});
const sys = new VehicleSystem(G);
G.vehicles = sys;
sys.attach(G);
const dummies = [];
function addDummies() {
  if (dummies.length) return;
  for (let i = 0; i < 8; i++) { const d = new Dummy(i, new THREE.Vector3(-14 + i * 4, 0, -12)); dummies.push(d); G.actors.push(d); }
}
G.events.on('kill', (e) => { if (e.victim && e.victim.onDeath && !e.victim.isPlayer) { /* onDeath ruft combat selbst */ } });

const startType = params.get('type') || 'mbt';
function spawn(type, at = new THREE.Vector3(0, 0, 28), yaw = 0, team = 'A') {
  return sys.spawnVehicle(type, at, yaw, team);
}
let main = spawn(startType, new THREE.Vector3(0, 0.05, 28), 0, 'A');
const other = spawn(startType === 'mbt' ? 'jeep' : 'mbt', new THREE.Vector3(9, 0.05, 30), 0, 'A');
if (params.get('dummies') === '1') addDummies();
let enemy = null;
function addEnemy() { if (!enemy) enemy = spawn('mbt', new THREE.Vector3(10, 0.05, -70), Math.PI, 'B'); return enemy; }
if (params.get('enemy') === '1') addEnemy();
if (params.get('enter') !== '0') {
  sys.enter(player, main, Number(params.get('seat') || 0));
  sys.camera.mode = sys.camMode = params.get('cam') === 'fp' ? 'fp' : 'tp';
}

/* ------------------------------------------------------------------ Autopilot-Runde (Bot-API) */
function autopilotLap(v = main) {
  const bot = { id: 'bot', name: 'Testfahrer', team: 'A', isBot: true, alive: true, health: 100, maxHealth: 100, yaw: 0, pitch: 0, stats: blankStats(), body: new CapsuleBody({ radius: 0.35, height: 1.8 }), raycastHitboxes: (r, m) => raycastHumanoid(bot, r, m) };
  Object.defineProperty(bot, 'position', { get: () => bot.body.position });
  if (player.vehicle === v) sys.exit(player);
  if (v.driver) return null;
  bot.body.teleport(v.position.clone().add(new THREE.Vector3(-3, 0, 0)));
  G.actors.push(bot);
  v.requestSeat(bot, 0);
  v.followPath(bot, [new THREE.Vector3(0, 0, -20), new THREE.Vector3(40, 0, -20), new THREE.Vector3(40, 0, 10), new THREE.Vector3(-10, 0, 25), new THREE.Vector3(0, 0, 28)], { arriveRadius: 5 });
  return bot;
}
if (params.get('auto') === '1') autopilotLap();

/* ------------------------------------------------------------------ UI */
document.querySelectorAll('[data-spawn]').forEach((b) => b.addEventListener('click', () => {
  if (player.vehicle) sys.exit(player);
  const v = sys.spawnNear(player, b.dataset.spawn, 'A');
  if (v) { main = v; sys.enter(player, v, 0); }
}));
document.getElementById('enter').onclick = () => { const v = sys.nearest(player.position, { maxDist: 30, free: true }); if (v) sys.enter(player, v, 0); };
document.getElementById('exit').onclick = () => sys.exit(player);
document.getElementById('dummies').onclick = addDummies;
document.getElementById('auto').onclick = () => autopilotLap(sys.nearest(player.position, { maxDist: 60 }) || main);
document.getElementById('enemy').onclick = addEnemy;
document.getElementById('quality').value = G.renderer.quality;
document.getElementById('quality').onchange = (e) => { const u = new URL(location.href); u.searchParams.set('quality', e.target.value); location.href = u.href; };
window.__dev = { G, sys, world, player, input, spawn, addDummies, addEnemy, autopilotLap, get main() { return main; }, get enemy() { return enemy; }, other, vehicleTriangles };

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  G.renderer.width = innerWidth; G.renderer.height = innerHeight;
  player.camera.aspect = innerWidth / innerHeight; player.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ Takt */
const statsEl = document.getElementById('stats');
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, statT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.25, (now - last) / 1000);
  last = now;
  const dt = Math.min(raw, 1 / 20);
  G.time.dt = dt; G.time.elapsed += dt; G.time.frame++; G.time.real += raw;
  input.update(dt);
  if (player.vehicle) sys.updateOccupant(player, dt); else if (player.alive) player.update(dt);
  for (const d of dummies) d.update(dt);
  sys.update(dt);
  sun.position.copy(G.camera.position).add(new THREE.Vector3(40, 70, 25));
  sun.target.position.copy(G.camera.position);
  renderer.render(scene, G.camera);
  input.endFrame();
  fpsAcc += raw; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  statT -= raw;
  if (statT <= 0) {
    statT = 0.25;
    const v = player.vehicle || main;
    const s = sys.stats();
    statsEl.textContent = `FPS ${fps.toFixed(0)} · Draw ${renderer.info.render.calls} · Tris ${(renderer.info.render.triangles / 1000).toFixed(1)}k\n`
      + `${v.name}: ${(Math.abs(v.body.speed) * 3.6).toFixed(0)} km/h · HP ${Math.ceil(v.health)}\n`
      + `Boden ${(v.body.grounded * 100).toFixed(0)} % · schläft ${v.body.sleeping ? 'ja' : 'nein'}\n`
      + `Fahrzeuge ${s.vehicles} · Granaten ${s.shells} · ${s.ms.toFixed(2)} ms`;
  }
}
requestAnimationFrame(frame);
