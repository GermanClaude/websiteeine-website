// NULLPUNKT — Ballistiklabor (dev/ballistics.html): Effekte isoliert prüfen (Einschläge je Oberfläche,
// Einschusslöcher, Leuchtspuren, Mündungsfeuer, Treffernebel, Explosionen an Land/Wasser, Zielfernrohr-Glanz)
// und die Waffenbalance als TTK-Tabelle. Läuft ohne Spiel mit einem minimalen G.
import * as THREE from 'three';
import { Effects } from '../../engine/effects.js';
import { EventBus } from '../../engine/events.js';
import { QUALITY_PRESETS } from '../../engine/renderer.js';
import { WEAPONS, WEAPON_IDS, killProfile, effectiveRange, EQUIPMENT, explosionKillRadius } from '../../../shared/weapons.data.js';

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfdae3');
scene.fog = new THREE.Fog('#cfdae3', 60, 220);
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 400);

// Licht
const hemi = new THREE.HemisphereLight('#dfe8f2', '#8a7a62', 0.9);
const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
sun.position.set(12, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
scene.add(hemi, sun);

// Testgelände: Wände aus allen Oberflächen
const meshes = [];
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
function add(geo, material, surface, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  m.userData.surface = surface;
  scene.add(m);
  meshes.push(m);
  return m;
}
add(new THREE.BoxGeometry(60, 0.2, 60), mat('#d8c49c'), 'sand', 0, -0.1, 0);
add(new THREE.BoxGeometry(6, 0.02, 6), mat('#6e5b45'), 'dirt', -7, 0.01, 3);
add(new THREE.BoxGeometry(6, 0.02, 6), mat('#5d7240'), 'grass', 7, 0.01, 3);
const water = add(new THREE.BoxGeometry(7, 0.05, 5), mat('#2f5f78', { roughness: 0.1, metalness: 0.2 }), 'water', 0, 0.02, 9);
water.receiveShadow = false;
const walls = [['concrete', '#a6a29a'], ['metal', '#5e6670', { metalness: 0.7, roughness: 0.45 }], ['wood', '#8a6440'], ['glass', '#b8d8e8', { transparent: true, opacity: 0.35, roughness: 0.05 }], ['fabric', '#7c7564'], ['tile', '#d8d0c2']];
walls.forEach(([surface, color, extra], i) => add(new THREE.BoxGeometry(3.2, 3, 0.3), mat(color, extra || {}), surface, -8 + i * 3.25, 1.5, -6));
const dummy = add(new THREE.CylinderGeometry(0.28, 0.28, 1.8, 16), mat('#4d5a3a'), 'flesh', 9, 0.9, -1);

// Minimal-G für Effects
const G = {
  THREE, scene, camera, canvas, events: new EventBus(),
  renderer: { renderer, quality: 'high', preset: QUALITY_PRESETS.high },
  data: { WEAPONS }, actors: [], combat: { isHostile: () => true }, time: { elapsed: 0, dt: 0 },
  world: {
    lighting: { sunColor: sun.color, sunIntensity: sun.intensity, hemiSky: hemi.color, hemiIntensity: hemi.intensity, envIntensity: 0.6 },
    raycast(origin, dir, max = 1000) {
      ray.set(origin, dir);
      ray.far = max;
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit) return null;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      return { distance: hit.distance, point: hit.point.clone(), normal: n, surface: hit.object.userData.surface, object: hit.object };
    },
    surfaceAt() { return 'sand'; },
    lineOfSight() { return true; },
  },
  player: null,
};
const ray = new THREE.Raycaster();
G.player = {
  alive: true, isPlayer: true, position: new THREE.Vector3(), shake(v) { shake = Math.min(1, shake + v); },
  getEyePosition(out) { return out.copy(camera.position); },
};
G.actors.push(G.player);
const fx = new Effects(G);
fx.attach(G);

// Kamera (ziehen = drehen, Rad/Pinch = Abstand)
let yaw = 0.25, pitch = 0.32, dist = 16, shake = 0;
const target = new THREE.Vector3(0, 1.2, -1);
function placeCamera(t) {
  const sx = shake * shake * (Math.sin(t * 41) * 0.06), sy = shake * shake * (Math.sin(t * 37 + 1) * 0.05);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
  camera.position.x += sx; camera.position.y += sy;
  G.player.position.copy(camera.position).setY(0);
}
const pointers = new Map();
let dragged = 0;
canvas.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged = 0; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    p.x = e.clientX; p.y = e.clientY;
    const [c, d] = [...pointers.values()];
    dist = THREE.MathUtils.clamp(dist * before / Math.max(1, Math.hypot(c.x - d.x, c.y - d.y)), 4, 60);
    dragged += 10;
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  dragged += Math.abs(dx) + Math.abs(dy);
  yaw -= dx * 0.005; pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, 0.05, 1.3);
  p.x = e.clientX; p.y = e.clientY;
});
const up = (e) => {
  const was = pointers.size;
  pointers.delete(e.pointerId);
  if (was === 1 && dragged < 6) shootAt(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
canvas.addEventListener('wheel', (e) => { dist = THREE.MathUtils.clamp(dist * (e.deltaY > 0 ? 1.1 : 0.9), 4, 60); e.preventDefault(); }, { passive: false });

const ndc = new THREE.Vector2();
const muzzle = new THREE.Vector3(9, 1.5, 6);
function impactRay(origin, dir, opts = {}) {
  const hit = G.world.raycast(origin, dir, 200);
  if (!hit) return null;
  if (hit.surface === 'flesh') { fx.blood(hit.point, dir, { headshot: Math.random() < 0.3 }); return hit; }
  G.events.emit('impact', { point: hit.point, normal: hit.normal, surface: hit.surface, shooter: opts.shooter || null, weaponId: 'ar_m17' });
  return hit;
}
function shootAt(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  impactRay(ray.ray.origin.clone(), ray.ray.direction.clone(), { shooter: G.player });
}

// Aktionen
const queue = [];
const later = (t, fn) => queue.push({ t: G.time.elapsed + t, fn });
const dirTo = (from, to) => to.clone().sub(from).normalize();
const randomWallPoint = () => new THREE.Vector3(-8 + Math.random() * 16.5, 0.3 + Math.random() * 2.5, -6);
const actions = {
  'Sperrfeuer': () => {
    for (let i = 0; i < 24; i++) later(i * 0.06, () => {
      const to = randomWallPoint();
      const d = dirTo(muzzle, to);
      fx.muzzleFlash(muzzle, d, { cls: 'ar' });
      const hit = impactRay(muzzle.clone(), d);
      if (hit && i % 2 === 0) G.events.emit('tracer', { from: muzzle.clone(), to: hit.point, actor: { isPlayer: false }, weaponId: 'ar_kv47' });
    });
  },
  'Scharfschütze': () => {
    const to = randomWallPoint();
    const d = dirTo(muzzle, to);
    fx.muzzleFlash(muzzle, d, { cls: 'sniper' });
    const hit = impactRay(muzzle.clone(), d);
    if (hit) G.events.emit('tracer', { from: muzzle.clone(), to: hit.point, actor: { isPlayer: false }, weaponId: 'sr_brecher' });
  },
  'Schrot': () => {
    const to = randomWallPoint();
    const d0 = dirTo(muzzle, to);
    fx.muzzleFlash(muzzle, d0, { cls: 'shotgun' });
    for (let i = 0; i < 8; i++) {
      const d = d0.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.09, (Math.random() - 0.5) * 0.09, (Math.random() - 0.5) * 0.09)).normalize();
      const hit = impactRay(muzzle.clone(), d);
      if (hit && i < 2) G.events.emit('tracer', { from: muzzle.clone(), to: hit.point, actor: { isPlayer: false }, weaponId: 'sg_bulldog' });
    }
  },
  'Treffer': () => {
    for (let i = 0; i < 6; i++) later(i * 0.12, () => {
      const p = dummy.position.clone().add(new THREE.Vector3(0, 0.2 + Math.random() * 0.7, 0.28));
      fx.blood(p, dirTo(camera.position, p), { headshot: i === 5, killed: i === 5 });
    });
  },
  'Splittergranate': () => G.events.emit('explosion', { position: new THREE.Vector3(-1.5, 0.08, 2), radius: EQUIPMENT.frag.radius, type: 'frag' }),
  'Haftgranate': () => G.events.emit('explosion', { position: new THREE.Vector3(1.5, 1.2, -5.8), radius: EQUIPMENT.semtex.radius, type: 'semtex' }),
  'Wasser': () => G.events.emit('explosion', { position: new THREE.Vector3(0, 0.1, 9), radius: 6.5, type: 'frag' }),
  'Luftschlag': () => { for (let i = 0; i < 5; i++) later(i * 0.22, () => G.events.emit('explosion', { position: new THREE.Vector3(-10 + i * 5, 0.1, 15), radius: 9, type: 'strike' })); },
  'Glanz': () => { glintOn = !glintOn; },
  'Leeren': () => fx.clear(),
};
let glintOn = false;
const sniper = {
  id: 'lab-sniper', alive: true, team: 'B', yaw: 0, position: new THREE.Vector3(0, 0, -40),
  weapon: { currentDef: WEAPONS.sr_brecher, adsProgress: 1 },
  getEyePosition(out) { return out.set(0, 3.2, -40); },
  getAimDirection(out) { return out.copy(camera.position).sub(new THREE.Vector3(0, 3.2, -40)).normalize(); },
};
const controls = document.getElementById('controls');
for (const [name, fn] of Object.entries(actions)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.addEventListener('click', () => { fn(); if (name === 'Glanz') b.classList.toggle('on', glintOn); });
  controls.appendChild(b);
}

// Qualität
document.getElementById('quality').addEventListener('change', (e) => {
  const q = e.target.value;
  G.renderer.quality = q;
  G.renderer.preset = QUALITY_PRESETS[q];
  fx.decals.setLimit(G.renderer.preset.decals);
});

// TTK-Tabelle
const ttkEl = document.getElementById('ttk');
document.getElementById('btn-ttk').addEventListener('click', (e) => {
  const on = ttkEl.style.display !== 'block';
  ttkEl.style.display = on ? 'block' : 'none';
  e.currentTarget.classList.toggle('on', on);
  if (!on || ttkEl.dataset.ready) return;
  ttkEl.dataset.ready = '1';
  const D = [3, 8, 15, 25, 40, 60];
  let html = `<table><thead><tr><th>Waffe</th><th>Modus</th><th>rpm</th>${D.map((d) => `<th>${d} m</th>`).join('')}<th>Kopf 15 m</th><th>eff. Reichw.</th></tr></thead><tbody>`;
  for (const id of WEAPON_IDS) {
    const w = WEAPONS[id];
    if (w.cls === 'melee') continue;
    const kp = killProfile(w, D);
    const head = killProfile(w, [15])[0].headShots;
    html += `<tr><td>${w.name}</td><td>${w.fireMode}</td><td>${w.rpm}</td>${kp.map((k) => `<td>${Number.isFinite(k.shots) ? `${k.shots}× · ${k.ttk} ms` : '–'}</td>`).join('')}<td class="k">${head}×</td><td>${Math.round(effectiveRange(w))} m</td></tr>`;
  }
  html += `</tbody></table><p>Messer: ${WEAPONS.knife.damage.max} Schaden (1 Treffer), Ausfallschritt bis ${WEAPONS.knife.melee.lungeRange} m. Splittergranate: sicherer Abschuss bis ${explosionKillRadius(EQUIPMENT.frag).toFixed(1).replace('.', ',')} m, Haftgranate bis ${explosionKillRadius(EQUIPMENT.semtex).toFixed(1).replace('.', ',')} m.</p>`;
  ttkEl.innerHTML = html;
});

// Schleife
const info = document.getElementById('info');
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, infoAt = 0;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.time.elapsed += dt;
  G.time.dt = dt;
  shake = Math.max(0, shake - dt * 1.6);
  placeCamera(G.time.elapsed);
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].t <= G.time.elapsed) { const q = queue.splice(i, 1)[0]; q.fn(); }
  const i = G.actors.indexOf(sniper);
  if (glintOn && i < 0) G.actors.push(sniper); else if (!glintOn && i >= 0) G.actors.splice(i, 1);
  fx.update(dt);
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (now - infoAt > 250) {
    infoAt = now;
    const r = renderer.info.render;
    info.textContent = `${fps} FPS · ${r.calls} Draw Calls\nPartikel: ${fx.alpha.n} Alpha · ${fx.fire.n} Feuer · ${fx.add.n} additiv\nLeuchtspuren: ${fx.tracers.n}\nLöcher: ${fx.decals.used}/${fx.decals.limit}\nQualität: ${G.renderer.quality} (Partikel ×${G.renderer.preset.particleScale})\nEinschläge: ${fx.stats.impacts} · Explosionen: ${fx.stats.explosions}`;
  }
}
requestAnimationFrame(frame);
window.__lab = {
  G, fx, actions, shootAt,
  /** Kamera setzen (Tests): Ziel, Abstand, Gier/Nick */
  view(x, y, z, d = dist, yw = yaw, pt = pitch) { target.set(x, y, z); dist = d; yaw = yw; pitch = pt; },
};
