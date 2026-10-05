// Waffenlabor (dev/weapons.html): Modellgalerie (LOD, Drehteller, Drahtgitter, Dreiecke), Übersicht
// und Ego-Prüfung des Viewmodels (Feuer, Anschlag, Nachladen, Wechsel, Sprint, Sprung, Messer, Granate, Inspizieren).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createWeaponModel, MODEL_KEYS, getWeaponModelInfo } from '../../assets/js/game/weapons/models.js';
import { WEAPONS, WEAPON_IDS } from '../../assets/js/shared/weapons.data.js';
import { createFpBench } from './bench-fp.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const NAMES = {
  kv47: 'KV-47', m17: 'M-17 Falke', vp9: 'VP-9 Viper', qx90: 'QX-90', hm60: 'HM-60 Hammer', sk14: 'SK-14',
  brecher: 'Brecher .338', bulldog: 'Bulldog 12', p9: 'P-9 Kompakt', adler: 'Adler .50', knife: 'Kampfmesser',
  frag: 'Splittergranate', semtex: 'Haftgranate',
};

// ---------- Galerie-Szene ----------
const gScene = new THREE.Scene();
gScene.environment = envMap;
gScene.background = new THREE.Color(0x0d0f12);
const gCam = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
const key = new THREE.DirectionalLight(0xfff1de, 2.2); key.position.set(2, 3, 2);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4); rim.position.set(-3, 1.5, -2);
gScene.add(key, rim, new THREE.HemisphereLight(0xcfd8e6, 0x2a2622, 0.5));
const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0x0f1114, roughness: 0.95, metalness: 0 }));
floor.rotation.x = -Math.PI / 2;
gScene.add(floor);
gScene.fog = new THREE.Fog(0x0d0f12, 2.5, 6);

const state = {
  view: params.get('view') || 'models',
  model: params.get('model') || 'm17',
  lod: params.get('lod') || 'first',
  wire: params.get('wire') === '1',
  spin: params.get('spin') !== '0',
  yaw: params.has('yaw') ? +params.get('yaw') * Math.PI / 180 : -0.6,
  pitch: params.has('pitch') ? +params.get('pitch') * Math.PI / 180 : 0.2,
  dist: params.has('dist') ? +params.get('dist') : 0,
  target: new THREE.Vector3(),
};

let current = null;
const gridGroup = new THREE.Group();
gScene.add(gridGroup);

function setWire(obj, on) {
  obj.traverse(o => {
    if (!o.isMesh) return;
    if (!o.userData.origMat) o.userData.origMat = o.material;
    o.material = on ? wireMat(o.userData.origMat) : o.userData.origMat;
  });
}
const wireCache = new Map();
function wireMat(m) {
  if (!wireCache.has(m)) wireCache.set(m, new THREE.MeshBasicMaterial({ color: m.transparent ? 0x38b6ff : 0xff5b1f, wireframe: true }));
  return wireCache.get(m);
}

function showModel() {
  if (current) { gScene.remove(current); current = null; }
  current = createWeaponModel(state.model, { lod: state.lod });
  const info = current.userData.info;
  const size = state.lod === 'showcase' ? 1 : Math.max(...info.size);
  if (state.lod === 'showcase') current.position.y = 0.0;
  else current.position.set(-info.center[0], -info.center[1], -info.center[2]);
  const holder = new THREE.Group();
  holder.add(current);
  holder.position.y = state.lod === 'showcase' ? 0.35 : size * 0.4 + 0.05;
  current = holder;
  gScene.add(holder);
  state.target.set(0, holder.position.y, 0);
  if (!params.has('dist') || state._distSet) state.dist = size * 2.1 + 0.15;
  state._distSet = true;
  setWire(holder, state.wire);
  updateInfo();
}

function showGrid() {
  gridGroup.clear();
  // Echte Größenverhältnisse: Langwaffen links/rechts, Pistolen & Ausrüstung unten
  const layout = [
    ['kv47', -0.95, 1.75], ['m17', 0.0, 1.75], ['hm60', 1.05, 1.75],
    ['sk14', -0.95, 1.38], ['brecher', 0.05, 1.38], ['vp9', 1.0, 1.38],
    ['bulldog', -0.95, 1.0], ['qx90', 0.0, 1.0], ['p9', 0.62, 1.0], ['adler', 0.95, 1.0],
    ['knife', -0.5, 0.7], ['frag', 0.05, 0.7], ['semtex', 0.4, 0.7],
  ];
  for (const [k, x, y] of layout) {
    const m = createWeaponModel(k, { lod: state.lod === 'third' ? 'third' : 'first' });
    const inf = m.userData.info;
    m.position.set(-inf.center[0], -inf.center[1], -inf.center[2]);
    const h = new THREE.Group();
    h.add(m);
    h.rotation.y = -Math.PI / 2;
    h.position.set(x, y, 0);
    gridGroup.add(h);
    setWire(h, state.wire);
  }
  state.target.set(0.05, 1.22, 0);
  // Abstand so, dass die ganze Übersicht ins Bild passt (auch im Hochformat)
  const fit = Math.max(3.6 / gCam.aspect, 1.7) / (2 * Math.tan(THREE.MathUtils.degToRad(gCam.fov / 2)));
  state.dist = fit * 1.12;
  if (!params.has('yaw')) { state.yaw = 0; state.pitch = 0.06; state.spin = false; syncButtons(); }
}

function updateInfo() {
  const el = document.getElementById('info');
  if (state.view === 'grid') {
    const rows = MODEL_KEYS.map(k => {
      const a = getWeaponModelInfo(k, 'first'), b = getWeaponModelInfo(k, 'third');
      return `${(NAMES[k] || k).padEnd(15)} ${String(a.triangles).padStart(5)} / ${String(b.triangles).padStart(4)}`;
    });
    el.textContent = `Dreiecke Ego / Bot\n${rows.join('\n')}`;
    return;
  }
  if (!current) return;
  const model = current.children[0];
  const ud = model.userData;
  const info = ud.info;
  const r = renderer.info.render;
  el.textContent = [
    `${NAMES[state.model] || state.model}  (${state.model})`,
    `LOD: ${state.lod}`,
    `Dreiecke: ${info.triangles}`,
    `Meshes: ${info.meshes}   Draw Calls: ${r.calls}`,
    `Maße (m): ${info.size.map(v => v.toFixed(3)).join(' × ')}`,
    `Visier: ${info.sight}   Art: ${info.kind}`,
    `Teile: ${Object.keys(ud.parts).join(', ') || '–'}`,
    `Anker: ${Object.keys(ud.anchors).join(', ') || '–'}`,
    `ADS-Versatz: ${ud.adsOffset.toArray().map(v => v.toFixed(3)).join(', ')}`,
  ].join('\n');
}

// ---------- Orbit-Steuerung ----------
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (state.view === 'bench') return;
  drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan) {
    const right = new THREE.Vector3().setFromMatrixColumn(gCam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(gCam.matrixWorld, 1);
    state.target.addScaledVector(right, -dx * state.dist * 0.0015).addScaledVector(up, dy * state.dist * 0.0015);
  } else {
    state.yaw -= dx * 0.008;
    state.pitch = THREE.MathUtils.clamp(state.pitch + dy * 0.006, -1.3, 1.3);
    state.spin = false;
    syncButtons();
  }
});
canvas.addEventListener('pointerup', () => { drag = null; });

// ---------- Ego-Prüfung: Eingaben ----------
let fp = null;
const fpDrag = { on: false, x: 0, y: 0 };
canvas.addEventListener('pointerdown', e => {
  if (state.view !== 'bench' || !fp) return;
  if (e.button === 2) { fp.sim.ads = !fp.sim.ads; syncBench(); return; }
  if (document.pointerLockElement === canvas) { fp.setFiring(true); return; }
  fpDrag.on = true; fpDrag.x = e.clientX; fpDrag.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (state.view !== 'bench' || !fp) return;
  if (document.pointerLockElement === canvas) { fp.look(e.movementX * 0.0022, e.movementY * 0.0022); return; }
  if (!fpDrag.on) return;
  fp.look((e.clientX - fpDrag.x) * 0.004, (e.clientY - fpDrag.y) * 0.004);
  fpDrag.x = e.clientX; fpDrag.y = e.clientY;
});
canvas.addEventListener('pointerup', () => { fpDrag.on = false; if (fp) fp.setFiring(false); });
canvas.addEventListener('dblclick', () => { if (state.view === 'bench') canvas.requestPointerLock?.(); });
const KEYS = {
  KeyR: () => fp.reload(false), KeyT: () => fp.reload(true), KeyQ: () => fp.next(), KeyV: () => fp.melee(),
  KeyG: () => fp.grenade('frag'), KeyH: () => fp.grenade('semtex'), KeyI: () => fp.inspect(), Space: () => fp.jump(),
  KeyC: () => { fp.sim.crouch = !fp.sim.crouch; }, ShiftLeft: () => { fp.sim.sprint = !fp.sim.sprint; },
  KeyW: () => { fp.sim.walk = !fp.sim.walk; }, KeyE: () => { fp.sim.ads = !fp.sim.ads; }, KeyX: () => { fp.sim.autoFire = !fp.sim.autoFire; },
};
addEventListener('keydown', e => {
  if (state.view !== 'bench' || !fp || e.repeat) return;
  if (e.code === 'KeyF') { fp.setFiring(true); return; }
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) { const i = (+digit[1] + 9) % 10; if (WEAPON_IDS[i]) fp.equip(WEAPON_IDS[i]); syncBench(); return; }
  const f = KEYS[e.code];
  if (f) { f(); e.preventDefault(); syncBench(); }
});
addEventListener('keyup', e => { if (e.code === 'KeyF' && fp) fp.setFiring(false); });

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { if (state.view === 'bench') return; state.dist = THREE.MathUtils.clamp(state.dist * Math.exp(e.deltaY * 0.001), 0.08, 12); e.preventDefault(); }, { passive: false });

// ---------- UI ----------
const side = document.getElementById('side');
const controls = document.getElementById('controls');

function btn(label, onClick, attrs = {}) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  Object.assign(b.dataset, attrs);
  return b;
}

function buildSide() {
  side.innerHTML = '';
  if (state.view === 'bench') {
    const g = document.createElement('div'); g.className = 'grp'; g.textContent = 'Waffen (1–0, Q)';
    side.append(g);
    WEAPON_IDS.forEach((id, i) => side.append(btn(`${(i + 1) % 10 === 0 && i < 10 ? 0 : i + 1 > 10 ? '–' : i + 1}  ${WEAPONS[id].name}`, () => { fp.equip(id); syncBench(); }, { weapon: id })));
    const h = document.createElement('div'); h.className = 'hint';
    h.textContent = 'Ziehen = Umsehen · Doppelklick = Maus fangen · Rechtsklick = Anschlag';
    side.append(h);
    return;
  }
  const g = document.createElement('div'); g.className = 'grp'; g.textContent = 'Modelle';
  side.append(g);
  for (const k of MODEL_KEYS) side.append(btn(NAMES[k] || k, () => { state.model = k; state.view = 'models'; applyView(); }, { model: k }));
}

function buildControls() {
  controls.innerHTML = '';
  if (state.view === 'bench') {
    const hold = (label, on, off) => { const b = btn(label, () => {}); b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); return b; };
    controls.append(hold('Feuer (F)', () => fp.setFiring(true), () => fp.setFiring(false)));
    const tog = (label, key) => btn(label, () => { fp.sim[key] = !fp.sim[key]; syncBench(); }, { simToggle: key });
    controls.append(tog('Dauerfeuer (X)', 'autoFire'), tog('Anschlag (E)', 'ads'), tog('Gehen (W)', 'walk'), tog('Sprint (⇧)', 'sprint'), tog('Ducken (C)', 'crouch'));
    controls.append(btn('Springen (␣)', () => fp.jump()), btn('Nachladen (R)', () => fp.reload(false)), btn('Leer nachladen (T)', () => fp.reload(true)));
    controls.append(btn('Wechseln (Q)', () => { fp.next(); syncBench(); }), btn('Messer (V)', () => fp.melee()), btn('Granate (G)', () => fp.grenade('frag')), btn('Haftgranate (H)', () => fp.grenade('semtex')), btn('Inspizieren (I)', () => fp.inspect()));
    return;
  }
  for (const [l, v] of [['Ego', 'first'], ['Bot', 'third'], ['Vitrine', 'showcase']]) controls.append(btn(`LOD: ${l}`, () => { state.lod = v; applyView(); }, { lod: v }));
  controls.append(btn('Drahtgitter', () => { state.wire = !state.wire; applyView(); }, { toggle: 'wire' }));
  controls.append(btn('Drehen', () => { state.spin = !state.spin; syncButtons(); }, { toggle: 'spin' }));
  controls.append(btn('Ansicht zurücksetzen', () => { state.yaw = -0.6; state.pitch = 0.2; state._distSet = true; applyView(); }));
}

function syncButtons() {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  document.querySelectorAll('[data-model]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.model === state.model && state.view === 'models')));
  document.querySelectorAll('[data-lod]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lod === state.lod)));
  document.querySelectorAll('[data-toggle]').forEach(b => b.setAttribute('aria-pressed', String(!!state[b.dataset.toggle])));
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; applyView(); }));

function syncBench() {
  if (!fp) return;
  document.querySelectorAll('[data-weapon]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.weapon === fp.sim.id)));
  document.querySelectorAll('[data-sim-toggle]').forEach(b => b.setAttribute('aria-pressed', String(!!fp.sim[b.dataset.simToggle])));
}

function applyView() {
  if (state.view === 'bench' && !fp) { fp = createFpBench(renderer, params); resize(); window.__bench.fp = fp; }
  buildSide(); buildControls(); syncBench();
  document.getElementById('cross').style.display = state.view === 'bench' ? 'block' : 'none';
  gridGroup.visible = state.view === 'grid';
  if (current) current.visible = state.view === 'models';
  if (state.view === 'models') showModel();
  else if (state.view === 'grid') { showGrid(); updateInfo(); }
  syncButtons();
}

// ---------- Schleife ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  gCam.aspect = w / h; gCam.updateProjectionMatrix();
  if (fp) fp.resize(w, h);
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Timer();
let infoTimer = 0;
const fixedStep = params.has('fixed') ? 1 / 60 : 0;
let paused = false;
function benchInfo() {
  const el = document.getElementById('info');
  const d = WEAPONS[fp.sim.id], vm = fp.vm, r = renderer.info.render;
  el.textContent = [
    `${d.name}  (${d.id})`,
    `Magazin: ${fp.sim.mag} / ${d.mag}`,
    `Aktion: ${vm.actionName || (vm.isBusy ? 'ziehen' : '–')}`,
    `Anschlag: ${(vm._ads * 100).toFixed(0)} %   Zielfernrohr: ${vm.showScopeOverlay ? 'ja' : 'nein'}`,
    `Draw Calls: ${r.calls}   Dreiecke: ${r.triangles}`,
  ].join('\n');
}

function frame() {
  clock.update();
  const dt = fixedStep || Math.min(clock.getDelta(), 0.05);
  if (state.view === 'bench' && fp) {
    if (!paused) fp.update(dt);
    fp.render();
    document.getElementById('scope').style.display = fp.vm.showScopeOverlay ? 'block' : 'none';
    if ((infoTimer += dt) > 0.25) { infoTimer = 0; benchInfo(); }
    requestAnimationFrame(frame);
    return;
  }
  document.getElementById('scope').style.display = 'none';
  if (state.spin && state.view !== 'bench') state.yaw += dt * 0.35;
  const cp = Math.cos(state.pitch);
  gCam.position.set(state.target.x + Math.sin(state.yaw) * cp * state.dist, state.target.y + Math.sin(state.pitch) * state.dist, state.target.z + Math.cos(state.yaw) * cp * state.dist);
  gCam.lookAt(state.target);
  renderer.render(gScene, gCam);
  if ((infoTimer += dt) > 0.5 && state.view === 'models') { infoTimer = 0; updateInfo(); }
  requestAnimationFrame(frame);
}

window.__bench = {
  state, applyView, renderer, scene: gScene, fp: null,
  // Für automatisierte Tests: Simulation anhalten und deterministisch vorspulen
  pause(on = true) { paused = on; },
  step(seconds, hz = 60) { if (!fp) return; const n = Math.round(seconds * hz); for (let i = 0; i < n; i++) fp.update(1 / hz); fp.render(); },
};
applyView();
requestAnimationFrame(frame);
