// NULLPUNKT — Bot-Sandkasten: echte Karte, echter Modus, echte Waffen, nur Bots (kein Spieler).
// Debug-Anzeige: Pfade, Sichtkegel, Zustände (+ Leben, Waffe), Deckungspunkte, Navigationsgraph,
// Trefferzonen; Zeitraffer, Kamera folgt einem Bot. Wird von dev/bots.js nachgeladen.
import * as THREE from 'three';
import { EventBus } from '../assets/js/game/engine/events.js';
import { separateActors } from '../assets/js/game/engine/physics.js';
import { Combat } from '../assets/js/game/combat.js';
import { loadWorld } from '../assets/js/game/world/index.js';
import { WeaponSystem } from '../assets/js/game/weapons/index.js';
import * as models from '../assets/js/game/weapons/models.js';
import { createMode } from '../assets/js/game/modes/index.js';
import { BotManager } from '../assets/js/game/bots/manager.js';
import { GOAL_LABELS } from '../assets/js/game/bots/ai/brain.js';
import * as weaponsData from '../assets/js/shared/weapons.data.js';
import * as modesData from '../assets/js/shared/modes.data.js';
import * as mapsData from '../assets/js/shared/maps.data.js';

const TEAM_COL = { A: 0x38b6ff, B: 0xff3b3b, null: 0xffb020 };
const GOAL_COL = { engage: '#ff5b5b', cover: '#7cf29a', retreat: '#7cf29a', heal: '#7cf29a', chase: '#ffb020', hunt: '#ffd36b', flank: '#d68bff', objective: '#38b6ff', roam: '#c9d1d9', evade: '#ff8a3d', grenade: '#ff8a3d', idle: '#7d8790' };

export async function createSandbox({ renderer, camera, orbit, params, $, setProgress }) {
  const settings = { get: (k) => ({ fov: 80, quality: 'high', reducedMotion: false })[k], onChange: () => () => {} };
  const G = {
    THREE, scene: new THREE.Scene(), camera, events: new EventBus(), settings, actors: [], player: null, input: null, hud: null,
    match: { state: 'loading', modeId: 'tdm', mapId: 'hafen', difficulty: 'regulaer' }, time: { dt: 0, elapsed: 0, frame: 0, real: 0 },
    timeScale: 1, params: new URLSearchParams(), debug: false,
    data: { ...weaponsData, ...modesData, ...mapsData },
    modules: { models },
    renderer: {
      renderer, quality: 'high', post: { exposure: 1 },
      preset: { id: 'high', shadows: true, shadowMapSize: 2048, maxBotsVisibleShadows: 6, particleScale: 1, decals: true },
      setPost(p) { Object.assign(this.post, p); if (p.exposure) renderer.toneMappingExposure = p.exposure; },
      onQualityChange() { return () => {}; }, info: () => ({ fps: 0 }),
    },
  };
  G.scene.name = 'sandkasten';
  window.__sandbox = G;
  const sb = { G, world: null, debug: { paths: true, cones: false, states: true, cover: false, nav: false, hitboxes: false }, follow: null, ts: 1, groups: {} };

  // Effekte (falls vorhanden – Mündungsfeuer, Einschläge, Explosionen)
  let effects = null;
  try {
    const mod = await import('../assets/js/game/engine/effects.js');
    effects = new mod.Effects(G);
  } catch (err) { console.info('[sandkasten] ohne Effekte:', err.message); }

  async function start() {
    const mapId = $('map').value, modeId = $('mode').value, diff = $('diff').value;
    const count = Math.max(2, Math.min(18, Number($('count').value) || 10));
    setProgress('Lade Karte …');
    teardown();
    G.match.state = 'loading';
    G.match.modeId = modeId; G.match.mapId = mapId; G.match.difficulty = diff;
    const world = await loadWorld(G, mapId, { onProgress: (p) => setProgress(`Lade Karte … ${Math.round(p * 100)} %`) });
    G.world = world;
    sb.world = world;
    G.combat = new Combat(G); G.combat.attach(G);
    G.weapons = new WeaponSystem(G); G.weapons.attach(G);
    if (effects) try { effects.attach(G); } catch (err) { console.warn(err); effects = null; }
    G.mode = createMode(G, modeId, { difficulty: diff, timeLimit: 0, scoreLimit: 0 });
    G.mode.attach(G);
    G.bots = new BotManager(G);
    G.bots.attach(G);
    const ffa = modeId === 'ffa' || modeId === 'gun';
    const bots = G.bots.spawnBots({ allies: ffa ? 0 : Math.ceil(count / 2), enemies: ffa ? count : Math.floor(count / 2), ffa, difficulty: diff, modeId });
    for (const b of bots) if (!G.actors.includes(b)) G.actors.push(b);
    for (const a of G.actors) spawn(a);
    G.mode.start();
    G.match.state = 'playing';
    G.events.emit('match:start', { modeId, mapId });
    G.events.on('kill', ({ victim }) => { victim.respawnAt = G.time.elapsed + (G.mode.respawnDelay || 3); });
    buildStatic();
    const fol = $('follow');
    fol.innerHTML = '<option value="">Frei</option>';
    for (const b of G.bots.bots) fol.add(new Option(`${b.name} (${b.team || 'FFA'})`, b.id));
    fol.onchange = () => { sb.follow = G.bots.bots.find((b) => b.id === fol.value) || null; };
    const c = world.bounds.getCenter(new THREE.Vector3());
    orbit.target.set(c.x, 0, c.z); orbit.dist = 90; orbit.pitch = 1.0; orbit.yaw = 0.3;
    setProgress(null);
  }

  function spawn(a) {
    let s = G.mode && G.mode.chooseSpawn ? G.mode.chooseSpawn(a) : null;
    if (!s) { const list = (a.team && G.world.spawns[a.team]) || G.world.spawns.ffa; const p = list[(Math.random() * list.length) | 0]; s = { position: p.position.clone(), yaw: p.yaw }; }
    a.respawn(s);
    a.respawnAt = null;
    G.events.emit('actor:spawn', { actor: a });
  }

  function teardown() {
    if (G.mode) G.mode.detach();
    if (G.bots) { G.bots.removeAll(); G.bots.detach(); }
    if (effects) try { effects.detach(); } catch { /* egal */ }
    if (G.weapons) G.weapons.detach();
    if (G.combat) G.combat.detach();
    if (G.world) { G.world.dispose(); }
    for (const g of Object.values(sb.groups)) if (g) { g.removeFromParent(); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); if (o.material) o.material.dispose(); }); }
    sb.groups = {};
    G.events.clear();
    G.actors.length = 0;
    G.world = null; G.mode = null; G.bots = null;
  }

  /* ------------------------------------------------------------ Debug: statisch */

  function buildStatic() {
    const nav = G.world.nav;
    // Navigation
    const pos = [];
    for (const n of nav.nodes) for (const k of n.links) if (k > n.id) { const m = nav.nodes[k]; pos.push(n.position.x, n.position.y + 0.08, n.position.z, m.position.x, m.position.y + 0.08, m.position.z); }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sb.groups.nav = new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0x2f8f6a, transparent: true, opacity: 0.45 }));
    // Deckung
    const cp = [], cc = [];
    for (const n of nav.nodes) if (n.cover) { cp.push(n.position.x, n.position.y + 0.15, n.position.z); const c = new THREE.Color(n.coverHigh ? 0x7cf29a : 0xffd36b); cc.push(c.r, c.g, c.b); }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    sb.groups.cover = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.28, vertexColors: true }));
    // dynamisch
    const dyn = (n) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setDrawRange(0, 0); return g; };
    sb.groups.paths = new THREE.LineSegments(dyn(4096), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    sb.groups.cones = new THREE.LineSegments(dyn(4096), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
    sb.groups.hitboxes = new THREE.LineSegments(dyn(8192), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    sb.groups.states = new THREE.Group();
    for (const [k, g] of Object.entries(sb.groups)) { g.renderOrder = 30; g.visible = !!sb.debug[k]; G.scene.add(g); }
    sb.labels = new Map();
  }

  /* ------------------------------------------------------------ Debug: dynamisch */

  function writeLines(obj, fill) {
    const g = obj.geometry;
    const P = g.attributes.position.array, C = g.attributes.color.array;
    let i = 0;
    const max = P.length / 3;
    const push = (a, b, col) => {
      if (i + 2 > max) return;
      P[i * 3] = a.x; P[i * 3 + 1] = a.y; P[i * 3 + 2] = a.z; C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; i++;
      P[i * 3] = b.x; P[i * 3 + 1] = b.y; P[i * 3 + 2] = b.z; C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; i++;
    };
    fill(push);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, i);
  }

  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Color();
  function updateDebug() {
    const bots = G.bots ? G.bots.bots : [];
    if (sb.debug.paths) writeLines(sb.groups.paths, (push) => {
      for (const b of bots) {
        if (!b.alive) continue;
        const nav = b.nav;
        _c.set(GOAL_COL[b.goal.kind] || '#ffffff');
        _a.copy(b.position).setY(b.position.y + 0.25);
        for (let k = nav.idx; k < nav.path.length; k++) {
          _b.copy(nav.path[k]).setY(nav.path[k].y + 0.25);
          push(_a, _b, _c);
          _a.copy(_b);
        }
        // Blick zum Ziel
        if (b.gunner.rec && b.gunner.rec.visible) { _c.set('#ff3b3b'); push(b.getEyePosition(_a), _b.copy(b.gunner.lastSeenAim), _c); }
      }
    });
    if (sb.debug.cones) writeLines(sb.groups.cones, (push) => {
      for (const b of bots) {
        if (!b.alive) continue;
        _c.setHex(TEAM_COL[b.team] ?? 0xffffff);
        const eye = b.getEyePosition(new THREE.Vector3());
        const L = Math.min(18, b.diff.viewDistance * 0.3);
        for (const s of [-1, 1]) {
          const y = b.yaw + (s * b.diff.fov) / 2;
          push(eye, _b.set(eye.x - Math.sin(y) * L, eye.y, eye.z - Math.cos(y) * L), _c);
        }
        push(eye, _b.set(eye.x - Math.sin(b.yaw) * L * 0.6, eye.y, eye.z - Math.cos(b.yaw) * L * 0.6), _c.set('#ffffff'));
      }
    });
    if (sb.debug.hitboxes) writeLines(sb.groups.hitboxes, (push) => {
      for (const b of bots) {
        const s = b.soldier;
        if (!b.alive || !s) continue;
        for (const hb of s.hitboxes) {
          _c.set(hb.zone === 'head' ? '#ff3b3b' : hb.zone === 'body' ? '#ffb020' : '#38b6ff');
          if (hb.b) {
            push(hb.a, hb.b, _c);
            for (const o of [[hb.r, 0], [-hb.r, 0], [0, hb.r], [0, -hb.r]]) push(_a.copy(hb.a).add(_b.set(o[0], 0, o[1])), new THREE.Vector3().copy(hb.b).add(_b), _c);
          } else {
            for (let k = 0; k < 12; k++) {
              const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
              push(_a.set(hb.a.x + Math.cos(a0) * hb.r, hb.a.y + Math.sin(a0) * hb.r, hb.a.z), _b.set(hb.a.x + Math.cos(a1) * hb.r, hb.a.y + Math.sin(a1) * hb.r, hb.a.z), _c);
            }
          }
        }
      }
    });
    if (sb.debug.states) {
      for (const b of bots) {
        let l = sb.labels.get(b);
        if (!l) {
          const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
          const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
          sp.scale.set(0.16, 0.04, 1); sp.center.set(0.5, 0);
          sb.groups.states.add(sp);
          l = { cv, tex, sp, key: '' };
          sb.labels.set(b, l);
        }
        const w = b.weapon && b.weapon.currentDef ? b.weapon.currentDef.name : '';
        const perch = b.goal.data && b.goal.data.perch ? (b.goal.data.holdUntil ? ' ▲ hält' : ' ▲') : ''; // erhöhter Posten
        const key = `${b.alive}|${b.goal.kind}|${perch}|${Math.round(b.health / 10)}|${w}|${b.gunner.rec && b.gunner.rec.visible ? b.gunner.rec.actor.name : ''}`;
        if (key !== l.key) {
          l.key = key;
          const ctx = l.cv.getContext('2d');
          ctx.clearRect(0, 0, 256, 64);
          ctx.font = '600 22px "JetBrains Mono NP", monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(10, 4, 236, 56);
          ctx.fillStyle = b.alive ? GOAL_COL[b.goal.kind] || '#fff' : '#666';
          ctx.fillText(b.alive ? `${GOAL_LABELS[b.goal.kind] || b.goal.kind}${perch} · ${Math.round(b.health)}` : 'tot', 128, 28);
          ctx.fillStyle = '#c9d1d9'; ctx.font = '500 16px "JetBrains Mono NP", monospace';
          ctx.fillText(`${b.name} · ${w}${b.gunner.rec && b.gunner.rec.visible ? ' → ' + b.gunner.rec.actor.name : ''}`.slice(0, 30), 128, 52);
          l.tex.needsUpdate = true;
        }
        l.sp.position.set(b.position.x, b.position.y + 2.35, b.position.z);
        l.sp.visible = b.alive;
      }
    }
  }

  /* ------------------------------------------------------------ Schleife */

  const _f = new THREE.Vector3();
  function update(dt, fps) {
    if (!G.world || G.match.state !== 'playing') { renderer.render(G.scene, camera); return; }
    const sdt = Math.min(dt, 1 / 20) * sb.ts;
    G.time.dt = sdt; G.time.elapsed += sdt; G.time.real += dt; G.time.frame++;
    if (sdt > 0) {
      G.bots.update(sdt);
      separateActors(G.actors);
      G.weapons.update(sdt);
      G.mode.update(sdt);
      for (const a of G.actors) if (!a.alive && a.respawnAt != null && G.time.elapsed >= a.respawnAt) spawn(a);
      if (effects) try { effects.update(sdt); } catch { /* egal */ }
    }
    G.world.update(dt, camera);
    if (sb.follow) {
      const b = sb.follow;
      _f.set(b.position.x, b.position.y + 1.4, b.position.z);
      orbit.target.lerp(_f, Math.min(1, dt * 6));
      if (orbit.dist > 12) orbit.dist = 7;
    }
    updateDebug();
    renderer.render(G.scene, camera);
    const st = G.bots.stats();
    const sc = G.mode.scores ? Object.entries(G.mode.scores).map(([k, v]) => `${G.actors.find((a) => a.id === k)?.name || k}:${v}`).slice(0, 8).join(' ') : '';
    $('stats').textContent = `${fps} FPS · ${renderer.info.render.calls} Draw Calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k Dreiecke\n` +
      `Bots ${st.alive}/${st.bots} · KI ${st.ms} ms · Sichtstrahlen/Bild ${st.losPerFrame} · Pfade in Warteschlange ${st.pathQueue}\n` +
      `Abschüsse ${G.combat.killCount} · ${sc}\n${Object.entries(st.states).map(([k, v]) => `${GOAL_LABELS[k] || k} ${v}`).join(' · ')}`;
  }

  // UI
  $('go').onclick = () => start();
  for (const b of document.querySelectorAll('[data-dbg]')) {
    b.onclick = () => {
      const k = b.dataset.dbg;
      sb.debug[k] = !sb.debug[k];
      b.classList.toggle('on', sb.debug[k]);
      if (sb.groups[k]) sb.groups[k].visible = sb.debug[k];
    };
  }
  $('ts').oninput = () => { sb.ts = Number($('ts').value); $('tsv').textContent = `${sb.ts.toFixed(1).replace('.', ',')}×`; };
  if (params.get('map')) $('map').value = params.get('map');
  if (params.get('mode')) $('mode').value = params.get('mode');
  if (params.get('diff')) $('diff').value = params.get('diff');
  if (params.get('bots')) $('count').value = params.get('bots');
  if (params.get('ts')) { $('ts').value = params.get('ts'); $('ts').oninput(); }
  for (const k of (params.get('dbg') || '').split(',').filter(Boolean)) { sb.debug[k] = true; const b = document.querySelector(`[data-dbg="${k}"]`); if (b) b.classList.add('on'); }
  await start();
  sb.update = update;
  sb.start = start;
  return sb;
}
