// Waffenlabor – Ego-Prüfung: eigene Kamera + Kulisse, Viewmodel darüber gerendert (Tiefe gelöscht),
// einfacher Waffen-Controller (Kadenz, Magazin, Nachladen) zum Testen aller Animationen.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ViewModel } from '../../assets/js/game/weapons/viewmodel.js';
import { WEAPONS, WEAPON_IDS } from '../../assets/js/shared/weapons.data.js';

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5d5a54'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 2 + Math.random() * 6); }
  g.strokeStyle = 'rgba(20,20,20,.55)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function createFpBench(renderer, params) {
  // ---------- Kulisse (Schießstand bei Abendsonne) ----------
  const scene = new THREE.Scene();
  const fogCol = new THREE.Color(0xc9b49a);
  scene.background = fogCol;
  scene.fog = new THREE.Fog(fogCol, 25, 140);
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.05, 400);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x5f86b8) }, mid: { value: new THREE.Color(0xe7c9a3) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6,0.0,1.0); gl_FragColor = vec4(mix(mid, top, pow(h,0.7)), 1.0); }',
  }));
  scene.add(sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x7b5b3a, roughness: 0.8 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.9 });
  const tgtMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.7 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xff5b1f, roughness: 0.6 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, r = 12 + (i % 5) * 7;
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2 + (i % 3) * 0.6, 1.2), i % 4 ? boxMat : wallMat);
    b.position.set(Math.cos(a) * r, b.geometry.parameters.height / 2, Math.sin(a) * r);
    b.rotation.y = a * 2.3;
    scene.add(b);
  }
  for (let i = 0; i < 6; i++) {
    const t = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.05), tgtMat);
    board.position.y = 1.3;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 32), ringMat);
    ring.position.set(0, 1.45, 0.03);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), wallMat);
    post.position.y = 0.3;
    t.add(board, ring, post);
    t.position.set(-10 + i * 4, 0, -18 - (i % 2) * 8);
    scene.add(t);
  }
  const sunDir = new THREE.Vector3(0.55, 0.42, -0.35).normalize();
  const sun = new THREE.DirectionalLight(0xffd7a8, 2.6);
  sun.position.copy(sunDir).multiplyScalar(50);
  scene.add(sun, new THREE.HemisphereLight(0xa9c2e6, 0x5a4a3a, 0.8));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.6;
  const lighting = {
    sunDirection: sunDir.clone(), sunColor: new THREE.Color(0xffd7a8), sunIntensity: 2.6,
    hemiSky: new THREE.Color(0xa9c2e6), hemiGround: new THREE.Color(0x5a4a3a), hemiIntensity: 0.8,
    envMap, envIntensity: 0.8, fogColor: fogCol,
  };

  // ---------- Viewmodel ----------
  const vmScene = new THREE.Scene();
  const vmCamera = new THREE.PerspectiveCamera(ViewModel.FOV, 16 / 9, 0.01, 20);
  const G = { camera, viewmodel: { scene: vmScene, camera: vmCamera }, world: { lighting }, renderer: { renderer } };
  const vm = new ViewModel(G);

  // ---------- Simulierter Controller ----------
  const sim = {
    id: WEAPONS[params.get('weapon')] ? params.get('weapon') : 'ar_m17',
    mag: 0, ads: params.get('ads') === '1', sprint: params.get('sprint') === '1', walk: params.get('walk') === '1', crouch: false,
    firing: false, autoFire: false, cooldown: 0, onGround: true, vy: 0, height: 0,
    yaw: 0, pitch: 0, lookDX: 0, lookDY: 0, pendingLook: [0, 0], recoilPitch: 0, pos: new THREE.Vector3(0, 0, 6),
    reloadPending: false, firePressed: false, lethal: 'frag', time: 0,
  };
  const def = () => WEAPONS[sim.id];
  function equip(id) {
    if (!WEAPONS[id]) return;
    sim.id = id;
    vm.setWeapon(id);
    sim.mag = WEAPONS[id].mag;
    sim.cooldown = 0.2;
  }
  // Arsenal: ?camo=<id> (Tarnmuster für alle Waffen), ?look=<klasse> (Klassen-Arme), ?melee=<id> (Nahkampfwaffe)
  if (params.get('camo')) for (const id of WEAPON_IDS) vm.setCamo(id, params.get('camo'));
  if (params.get('look')) vm.setLook(params.get('look'));
  if (params.get('melee')) vm.setMelee(params.get('melee'));
  equip(sim.id);

  function shoot() {
    const d = def();
    if (d.cls === 'melee') { vm.playMelee(); sim.cooldown = d.melee?.swingTime ?? 0.75; return; }
    if (sim.mag <= 0) { if (!vm.isBusy) reload(true); return; }
    sim.mag--;
    vm.onShot(1, { empty: sim.mag === 0 });
    sim.cooldown = 60 / d.rpm;
    sim.recoilPitch += d.recoil.vertical * (vm._ads > 0.5 ? 0.6 : 1) * 0.6;
    sim.yaw += (Math.random() - 0.5) * d.recoil.horizontal * 0.6;
  }
  function reload(empty) {
    const d = def();
    if (d.cls === 'melee' || vm.isBusy) return;
    vm.playReload(empty ?? sim.mag === 0);
    sim.reloadPending = true;
  }

  const api = {
    vm, sim, G, scene, camera, vmScene, vmCamera,
    equip, reload, shoot,
    next() { const i = WEAPON_IDS.indexOf(sim.id); equip(WEAPON_IDS[(i + 1) % WEAPON_IDS.length]); },
    melee() { if (!vm.isBusy || vm.actionName === 'inspect') vm.playMelee(); },
    grenade(type) { if (!vm.isBusy || vm.actionName === 'inspect') vm.playGrenade(type || sim.lethal); },
    inspect() { vm.playInspect(); },
    plate(d = 1.2) { vm.playPlate(d); },
    jump() { if (sim.onGround) { sim.vy = 5.2; sim.onGround = false; } },
    look(dx, dy) { sim.pendingLook[0] += dx; sim.pendingLook[1] += dy; },
    setFiring(on) { sim.firing = on; if (on) sim.firePressed = true; },

    update(dt) {
      sim.time += dt;
      const d = def();
      // Blick
      sim.lookDX = sim.pendingLook[0]; sim.lookDY = sim.pendingLook[1];
      sim.pendingLook[0] = sim.pendingLook[1] = 0;
      sim.yaw -= sim.lookDX; sim.pitch = THREE.MathUtils.clamp(sim.pitch - sim.lookDY, -1.3, 1.3);
      sim.recoilPitch *= Math.exp(-6 * dt);
      // Bewegung (Kreisbahn durch die Kulisse)
      const speed = sim.walk || sim.sprint ? (sim.sprint && !sim.ads ? 8.2 : sim.crouch ? 2.6 : 5.4) * (sim.ads ? 0.75 : 1) : 0;
      const fwd = new THREE.Vector3(-Math.sin(sim.yaw), 0, -Math.cos(sim.yaw));
      sim.pos.addScaledVector(fwd, speed * dt);
      if (sim.pos.length() > 30) sim.pos.multiplyScalar(-0.95);
      // Sprung
      if (!sim.onGround) { sim.vy -= 16 * dt; sim.height += sim.vy * dt; if (sim.height <= 0) { sim.height = 0; sim.onGround = true; sim.vy = 0; } }
      const eye = 1.65 - (sim.crouch ? 0.6 : 0) + sim.height;
      camera.position.set(sim.pos.x, eye, sim.pos.z);
      camera.rotation.set(sim.pitch + sim.recoilPitch, sim.yaw, 0, 'YXZ');
      // Feuer / Nachladen
      sim.cooldown -= dt;
      const auto = d.fireMode === 'auto';
      const wantFire = sim.firing || sim.autoFire;
      if (wantFire && sim.cooldown <= 0 && (!vm.isBusy || vm.actionName === 'inspect') && !(sim.sprint && sim.walk && !sim.ads) && (auto || sim.firePressed || sim.autoFire)) shoot();
      sim.firePressed = false;
      if (sim.reloadPending && !vm.isBusy) { sim.reloadPending = false; sim.mag = d.mag; }
      // Anschlag-Zoom der Hauptkamera (Sichtfeld macht „die Kamera“)
      const zoom = d.scope?.zoom || d.adsZoom || 1;
      camera.fov = 65 / (1 + (zoom - 1) * vm._ads);
      camera.updateProjectionMatrix();
      vm.update(dt, {
        ads: sim.ads, moving: speed > 0, speed, sprinting: sim.sprint && sim.walk, crouching: sim.crouch, onGround: sim.onGround,
        lookDX: sim.lookDX, lookDY: sim.lookDY, firing: wantFire, mag: sim.mag,
      });
    },

    // Außenansicht des Rigs (Fehlersuche): Orbit um die Waffe im Viewmodel-Raum
    debugCam: null,
    debugView(yawDeg = 90, pitchDeg = 10, dist = 0.7, target = [0.1, -0.15, -0.45]) {
      if (yawDeg === null) { api.debugCam = null; return; }
      const c = api.debugCam || (api.debugCam = new THREE.PerspectiveCamera(40, vmCamera.aspect, 0.01, 20));
      const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(pitchDeg);
      const t = new THREE.Vector3().fromArray(target);
      c.position.set(t.x + Math.sin(y) * Math.cos(p) * dist, t.y + Math.sin(p) * dist, t.z + Math.cos(y) * Math.cos(p) * dist);
      c.lookAt(t);
      c.aspect = vmCamera.aspect; c.updateProjectionMatrix();
    },

    render() {
      if (api.debugCam) {
        renderer.setClearColor(0x2a2d33, 1);
        renderer.autoClear = true;
        const bg = vmScene.background;
        vmScene.background = new THREE.Color(0x2a2d33);
        renderer.render(vmScene, api.debugCam);
        vmScene.background = bg;
        return;
      }
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(vmScene, vmCamera);
      renderer.autoClear = true;
    },

    resize(w, h) {
      camera.aspect = vmCamera.aspect = w / h;
      camera.updateProjectionMatrix(); vmCamera.updateProjectionMatrix();
    },
  };
  return api;
}
