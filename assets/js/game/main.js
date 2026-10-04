// NULLPUNKT — Spielstart, Spielschleife und Match-Lebenszyklus (§2, §10a).
//
// Lebenszyklus (ohne Neuladen der Seite, ohne Lecks):
//   boot → lobby → loading → countdown → playing ⇄ paused → ended → (Revanche → loading …) | (Lobby → lobby)
// Einmal beim Start konstruiert: Renderer, Input, Player, Combat, AudioEngine, WeaponSystem, Effects,
//   BotManager, HUD, Menus. Pro Match: attach(G) … detach() (in umgekehrter Reihenfolge), Welt laden/entsorgen,
//   Modus neu erzeugen. Alles, was nach detach() noch in G.scene hängt und im Match hinzukam, wird entfernt
//   und entsorgt.
//
// Nicht-Kernmodule werden über importOr(echt, Stub) geladen; ?stubs=all oder ?stubs=world,audio erzwingt Stubs.

import * as THREE from 'three';
import { settings } from '../shared/settings.js';
import { profile } from '../shared/profile.js';
import { EventBus } from './engine/events.js';
import { createRenderer, QUALITY_LEVELS } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { separateActors } from './engine/physics.js';
import { Player } from './player.js';
import { Combat } from './combat.js';

const VERSION = '1.0.0';

// key: [echter Pfad, Stub-Pfad, Pflichtexporte]
const MODULES = {
  textures: ['./engine/textures.js', './stubs/textures.js', ['getMaterial', 'boxUV']],
  models: ['./weapons/models.js', './stubs/models.js', ['createWeaponModel']],
  viewmodel: ['./weapons/viewmodel.js', './stubs/viewmodel.js', ['ViewModel']],
  world: ['./world/index.js', './stubs/world.js', ['loadWorld']],
  audio: ['./engine/audio.js', './stubs/audio.js', ['AudioEngine']],
  weapons: ['./weapons/index.js', './stubs/weapons.js', ['WeaponSystem']],
  effects: ['./engine/effects.js', './stubs/effects.js', ['Effects']],
  bots: ['./bots/manager.js', './stubs/bots.js', ['BotManager']],
  modes: ['./modes/index.js', './stubs/modes.js', ['createMode']],
  hud: ['./ui/hud.js', './stubs/hud.js', ['HUD']],
  menus: ['./ui/menus.js', './stubs/menus.js', ['Menus']],
};
// Reine Datenmodule: echte Exporte überschreiben die Ersatzdaten aus stubs/data.js.
const DATA_MODULES = {
  weaponsData: '../shared/weapons.data.js',
  modesData: '../shared/modes.data.js',
  mapsData: '../shared/maps.data.js',
};

const TIPS = [
  'Sprinte und drücke Ducken, um zu rutschen – ideal, um um Ecken zu kommen.',
  'Gesundheit regeneriert sich nach 3,5 Sekunden ohne Treffer.',
  'Kopftreffer verursachen deutlich mehr Schaden.',
  'Im Anschlag streut jede Waffe viel weniger.',
  'Dünne Deckung aus Holz, Blech oder Glas lässt sich durchschießen.',
  'Halte die Granatentaste nicht zu lange – Splittergranaten zünden nach 2,8 Sekunden.',
  'Auf dem Touchscreen: Joystick ganz nach oben schieben sperrt den Sprint.',
  'Schüsse verraten deine Position auf der Minikarte der Gegner.',
];

const params = new URLSearchParams(location.search);
const STUBS = parseStubParam(params.get('stubs'));
const DEBUG = params.get('debug') === '1';
const AUTOSTART = params.get('autostart') === '1';
const QUALITY_OVERRIDE = QUALITY_LEVELS.includes(params.get('quality')) ? params.get('quality') : null;

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');

/* ===================================================================== G */

const G = {
  THREE,
  version: VERSION,
  canvas,
  renderer: null,
  scene: new THREE.Scene(),
  camera: null,
  viewmodel: { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 30), rig: null },
  events: new EventBus(),
  settings,
  profile,
  input: null,
  audio: null,
  effects: null,
  combat: null,
  world: null,
  player: null,
  bots: null,
  weapons: null,
  mode: null,
  hud: null,
  menus: null,
  actors: [],
  match: {
    state: 'boot', modeId: null, mapId: null, difficulty: null, allies: 0, enemies: 0, loadout: null,
    startedAt: null, countdown: 0, ffa: false, timeLimit: null, scoreLimit: null, pausedFrom: null, endedAt: null, result: null,
  },
  time: { dt: 0, elapsed: 0, frame: 0, real: 0 },
  timeScale: 1,
  params,
  debug: DEBUG,
  data: {},
  modules: {},
  moduleStatus: {},
  lastConfig: null,
  lastResult: null,
  lastProgression: null,
  matchCount: 0,
  debugApi: null,
  spawnActor: null,
};
G.scene.name = 'main';
G.viewmodel.scene.name = 'viewmodel';
window.__game = G;

/* ===================================================== Boot-Bildschirm */

const bootUi = {
  el: $('boot'),
  bar: $('boot-bar'),
  status: $('boot-status'),
  tip: $('boot-tip'),
  tipTimer: null,
};

function setBoot(p, text) {
  if (bootUi.bar) bootUi.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
  if (bootUi.status && text) bootUi.status.textContent = `${text} ${Math.round(p * 100)} %`;
  if (bootUi.el) bootUi.el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
}

function startTips() {
  if (!bootUi.tip) return;
  let i = Math.floor(Math.random() * TIPS.length);
  const show = () => { bootUi.tip.textContent = `Tipp: ${TIPS[i % TIPS.length]}`; i++; };
  show();
  bootUi.tipTimer = setInterval(show, 3800);
}

function hideBoot() {
  if (bootUi.tipTimer) clearInterval(bootUi.tipTimer);
  if (bootUi.el) {
    bootUi.el.classList.add('is-done');
    setTimeout(() => { bootUi.el.hidden = true; }, 450);
  }
}

/** Deutsches Fehlerpanel mit „Neu laden“ (kind: 'webgl' | 'error' | 'match'). */
function showFatal(kind, err) {
  const panel = $('fatal');
  if (!panel) return;
  if (bootUi.tipTimer) clearInterval(bootUi.tipTimer);
  if (bootUi.el) bootUi.el.hidden = true;
  const title = panel.querySelector('[data-fatal-title]');
  const text = panel.querySelector('[data-fatal-text]');
  const detail = panel.querySelector('[data-fatal-detail]');
  const reload = panel.querySelector('[data-fatal-reload]');
  if (kind === 'webgl') {
    title.textContent = 'WebGL ist nicht verfügbar';
    text.textContent = 'Dein Browser oder Gerät unterstützt kein WebGL 2 – oder es ist deaktiviert. Aktiviere die Hardwarebeschleunigung oder versuche es mit einem aktuellen Browser.';
    detail.hidden = true;
    reload.hidden = true;
  } else {
    title.textContent = kind === 'match' ? 'Das Match konnte nicht gestartet werden' : 'Beim Laden ist ein Fehler aufgetreten';
    text.textContent = 'Lade die Seite neu. Tritt der Fehler erneut auf, hilft die Meldung unten bei der Fehlersuche.';
    const msg = err ? `${err.name || 'Fehler'}: ${err.message || String(err)}${err.stack ? `\n\n${String(err.stack).split('\n').slice(0, 6).join('\n')}` : ''}` : 'Unbekannter Fehler';
    detail.textContent = msg;
    detail.hidden = false;
    reload.hidden = false;
  }
  panel.hidden = false;
  document.body.dataset.matchState = 'error';
  if (err) console.error('[NULLPUNKT]', err);
  try { if (G.input) G.input.exitLock(); } catch { /* ignore */ }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/* ===================================================== Module laden */

function parseStubParam(v) {
  if (!v) return new Set();
  if (v === 'all' || v === '1') return 'all';
  return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
}

const fallbacks = [];

/**
 * Lädt das echte Modul oder fällt auf den Stub zurück (§10a).
 * → { mod, real, reason }
 */
export async function importOr(key, realPath, stubPath, required = []) {
  const forced = STUBS === 'all' || (STUBS instanceof Set && STUBS.has(key));
  if (!forced && realPath) {
    try {
      const mod = await import(new URL(realPath, import.meta.url).href);
      const missing = required.filter((n) => !(n in mod));
      if (!missing.length) return { mod, real: true, reason: null };
      const reason = `Exporte fehlen: ${missing.join(', ')}`;
      fallbacks.push({ key, reason, level: 'warn' });
    } catch (err) {
      const notFound = err instanceof TypeError && /fetch|import|Failed|load/i.test(err.message);
      fallbacks.push({ key, reason: notFound ? 'nicht vorhanden' : `Fehler beim Laden – ${err.message}`, level: notFound ? 'info' : 'warn', error: notFound ? null : err });
    }
  } else if (forced) {
    fallbacks.push({ key, reason: 'per URL erzwungen', level: 'info' });
  }
  if (!stubPath) return { mod: null, real: false, reason: 'kein Stub' };
  const mod = await import(new URL(stubPath, import.meta.url).href);
  return { mod, real: false, reason: fallbacks.length ? fallbacks[fallbacks.length - 1].reason : null };
}

async function loadModules(onProgress) {
  const keys = Object.keys(MODULES);
  const dataKeys = Object.keys(DATA_MODULES);
  const total = keys.length + dataKeys.length + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);

  const stubData = await import('./stubs/data.js');
  tick();
  const data = { ...stubData };
  const dataStatus = {};
  await Promise.all(dataKeys.map(async (k) => {
    const forced = STUBS === 'all' || (STUBS instanceof Set && STUBS.has('data'));
    if (!forced) {
      try {
        const mod = await import(new URL(DATA_MODULES[k], import.meta.url).href);
        for (const [name, value] of Object.entries(mod)) if (value != null) data[name] = value;
        dataStatus[k] = 'real';
      } catch (err) {
        dataStatus[k] = 'stub';
        const notFound = err instanceof TypeError;
        fallbacks.push({ key: k, reason: notFound ? 'nicht vorhanden' : `Fehler – ${err.message}`, level: notFound ? 'info' : 'warn', error: notFound ? null : err });
      }
    } else dataStatus[k] = 'stub';
    tick();
  }));
  G.data = data;

  await Promise.all(keys.map(async (k) => {
    const [real, stub, req] = MODULES[k];
    const res = await importOr(k, real, stub, req);
    G.modules[k] = res.mod;
    G.moduleStatus[k] = res.real ? 'real' : 'stub';
    tick();
  }));
  Object.assign(G.moduleStatus, dataStatus);

  // Einmal gesammelt melden (Konsole bleibt im Normalbetrieb ruhig)
  if (fallbacks.length) {
    const warn = fallbacks.filter((f) => f.level === 'warn');
    const list = fallbacks.map((f) => `${f.key} (${f.reason})`).join(', ');
    if (warn.length) {
      console.warn(`[NULLPUNKT] Stubs aktiv: ${list}`);
      for (const f of warn) if (f.error) console.warn(`[NULLPUNKT] ${f.key}:`, f.error);
    } else {
      console.info(`[NULLPUNKT] Stubs aktiv: ${list}`);
    }
  }
}

/** Baut eine Subsystem-Instanz; scheitert das echte Modul, wird der Stub verwendet. */
async function construct(key, exportName, ...args) {
  const mod = G.modules[key];
  try {
    return new mod[exportName](...args);
  } catch (err) {
    if (G.moduleStatus[key] !== 'real') throw err;
    console.error(`[NULLPUNKT] ${key}: Konstruktor fehlgeschlagen – Stub wird verwendet.`, err);
    const stub = await import(new URL(MODULES[key][1], import.meta.url).href);
    G.modules[key] = stub;
    G.moduleStatus[key] = 'stub';
    return new stub[exportName](...args);
  }
}

/* ===================================================== Zustände */

function setState(state) {
  const prev = G.match.state;
  if (prev === state) return;
  G.match.state = state;
  document.body.dataset.matchState = state;
  if (G.input) G.input.setEnabled(state === 'playing' || state === 'countdown');
  G.events.emit('match:state', { state, prev });
  updateLockHint();
}

const errorKeys = new Set();
function step(key, fn) {
  try {
    fn();
  } catch (err) {
    const k = `${key}:${err && err.message}`;
    if (!errorKeys.has(k)) {
      errorKeys.add(k);
      console.error(`[NULLPUNKT] Fehler in ${key}.update:`, err);
    }
  }
}

function safe(key, fn) {
  try { return fn(); } catch (err) { console.error(`[NULLPUNKT] ${key}:`, err); return undefined; }
}

/* ===================================================== Match-Konfiguration */

const DIFFS = ['rekrut', 'regulaer', 'veteran', 'elite'];
const intParam = (v, d, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const numParam = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function isFfaMode(modeId) {
  const def = G.data.MODES && G.data.MODES[modeId];
  if (modeId === 'ffa' || modeId === 'gun') return true;
  return !!def && def.teams === false;
}

function modeCounts(modeId) {
  const def = (G.data.MODES && G.data.MODES[modeId]) || {};
  const ffa = isFfaMode(modeId);
  const lim = def.limits || {};
  const pick = (...vals) => vals.find((v) => Number.isFinite(v));
  const allies = ffa ? 0 : pick(def.defaultAllies, def.allies, def.teamSize ? def.teamSize - 1 : undefined, 5);
  const enemies = pick(def.defaultEnemies, def.enemies, ffa && def.players ? def.players - 1 : undefined, ffa ? 7 : 6);
  return {
    allies, enemies,
    alliesRange: Array.isArray(lim.allies) ? lim.allies : [0, ffa ? 0 : 11],
    enemiesRange: Array.isArray(lim.enemies) ? lim.enemies : [0, 15],
  };
}

/** Vervollständigt/validiert eine Match-Konfiguration (Lobby oder URL). */
function normalizeConfig(cfg = {}) {
  const MODES = G.data.MODES || {};
  const MAPS = G.data.MAPS || {};
  const W = G.data.WEAPONS || {};
  const EQ = G.data.EQUIPMENT || {};
  const modeId = MODES[cfg.modeId] ? cfg.modeId : MODES[settings.get('lastMode')] ? settings.get('lastMode') : 'tdm';
  let mapId = MAPS[cfg.mapId] ? cfg.mapId : null;
  if (!mapId) mapId = modeId === 'training' && MAPS.range ? 'range' : MAPS[settings.get('lastMap')] ? settings.get('lastMap') : Object.keys(MAPS)[0] || 'hafen';
  const difficulty = DIFFS.includes(cfg.difficulty) ? cfg.difficulty : settings.get('difficulty');
  const counts = modeCounts(modeId);
  const ffa = isFfaMode(modeId);
  const allies = ffa ? 0 : intParam(cfg.allies, counts.allies, counts.alliesRange[0], Math.max(counts.alliesRange[1], 0));
  const enemies = intParam(cfg.enemies, counts.enemies, counts.enemiesRange[0], Math.max(counts.enemiesRange[1], 0));
  const def = (G.data.DEFAULT_LOADOUTS && G.data.DEFAULT_LOADOUTS[0]) || { primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag' };
  const lo = cfg.loadout || {};
  const last = settings.get('lastLoadout') || {};
  const pick = (id, fallbackId, table) => (table[id] ? id : table[fallbackId] ? fallbackId : null);
  const loadout = {
    primary: pick(lo.primary, last.primary, W) || def.primary,
    secondary: pick(lo.secondary, last.secondary, W) || def.secondary,
    lethal: pick(lo.lethal, last.lethal, EQ) || def.lethal,
  };
  return {
    modeId, mapId, difficulty, allies, enemies, loadout, ffa,
    timeLimit: numParam(cfg.timeLimit), scoreLimit: numParam(cfg.scoreLimit),
  };
}

function configFromParams() {
  return {
    modeId: params.get('mode'), mapId: params.get('map'), difficulty: params.get('diff'),
    allies: params.get('allies'), enemies: params.get('enemies'),
    loadout: { primary: params.get('primary'), secondary: params.get('secondary'), lethal: params.get('lethal') },
    timeLimit: params.get('time'), scoreLimit: params.get('score'),
  };
}

/* ===================================================== Match */

let sceneKeep = null;
let vmKeep = null;
let audioAttached = false;

function spawnActor(actor) {
  const mode = G.mode;
  let spawn = null;
  if (mode && typeof mode.chooseSpawn === 'function') spawn = safe('mode.chooseSpawn', () => mode.chooseSpawn(actor));
  if (!spawn && G.world && G.world.spawns) {
    const list = (actor.team && G.world.spawns[actor.team]) || G.world.spawns.ffa || G.world.spawns.A || [];
    const s = list[(Math.random() * list.length) | 0];
    if (s) spawn = { position: s.position.clone(), yaw: s.yaw || 0 };
  }
  if (!spawn) spawn = { position: new THREE.Vector3(), yaw: 0 };
  actor.respawn(spawn);
  actor.respawnAt = null;
  actor.diedAt = null;
  G.events.emit('actor:spawn', { actor });
}
G.spawnActor = spawnActor;

async function startMatch(config) {
  if (G._starting) return;
  G._starting = true;
  // Wird direkt aus dem Klick-Handler aufgerufen → Nutzergeste für Audio + Pointer-Lock
  safe('audio.unlock', () => { const p = G.audio.unlock(); if (p && typeof p.catch === 'function') p.catch(() => {}); });
  if (G.input.mode === 'desktop' && !AUTOSTART) G.input.requestLock();
  else if (G.input.mode === 'touch') requestFullscreen();
  try {
    if (G.world || G.mode) await teardownMatch();
    const cfg = normalizeConfig(config);
    G.lastConfig = cfg;
    Object.assign(G.match, {
      modeId: cfg.modeId, mapId: cfg.mapId, difficulty: cfg.difficulty, allies: cfg.allies, enemies: cfg.enemies,
      loadout: { ...cfg.loadout }, ffa: cfg.ffa, timeLimit: cfg.timeLimit, scoreLimit: cfg.scoreLimit,
      startedAt: null, countdown: 0, pausedFrom: null, endedAt: null, result: null,
    });
    settings.patch({ lastMode: cfg.modeId, lastMap: cfg.mapId, difficulty: cfg.difficulty, lastLoadout: cfg.loadout });
    setState('loading');
    G.menus.showLoading(0);
    safe('hud.hide', () => G.hud.hide());

    sceneKeep = new Set(G.scene.children);
    vmKeep = new Set(G.viewmodel.scene.children);

    const onProgress = (p) => safe('menus', () => G.menus.showLoading(Math.min(0.85, p * 0.85)));
    let world = null;
    try {
      world = await G.modules.world.loadWorld(G, cfg.mapId, { onProgress });
      if (!world) throw new Error(`loadWorld(${cfg.mapId}) lieferte keine Welt`);
    } catch (err) {
      // Während der parallelen Entwicklung: echte Welt defekt → Testgelände (§10a)
      if (G.moduleStatus.world !== 'real') throw err;
      console.error(`[NULLPUNKT] Karte „${cfg.mapId}“ konnte nicht geladen werden – Testgelände wird verwendet.`, err);
      sweep(G.scene, sceneKeep);
      const stub = await import(new URL(MODULES.world[1], import.meta.url).href);
      world = await stub.loadWorld(G, cfg.mapId, { onProgress });
    }
    G.world = world;
    if (world.group && !world.group.parent) G.scene.add(world.group);

    G.combat.attach(G);
    G.weapons.attach(G);
    G.effects.attach(G);
    G.audio.attach(G);
    audioAttached = true;

    const opts = {
      timeLimit: cfg.timeLimit ?? undefined, scoreLimit: cfg.scoreLimit ?? undefined,
      time: cfg.timeLimit ?? undefined, score: cfg.scoreLimit ?? undefined,
      difficulty: cfg.difficulty, allies: cfg.allies, enemies: cfg.enemies, mapId: cfg.mapId,
    };
    G.mode = G.modules.modes.createMode(G, cfg.modeId, opts);
    G.mode.attach(G);

    G.player.resetForMatch({ team: cfg.ffa ? null : 'A', loadout: cfg.loadout, name: settings.get('playerName') });
    G.player.godMode = params.get('god') === '1';
    if (params.has('timescale')) G.timeScale = Math.min(4, Math.max(0.05, Number(params.get('timescale')) || 1));
    G.camera = G.player.camera;
    G.actors.length = 0;
    G.actors.push(G.player);

    G.bots.attach(G);
    const bots = G.bots.spawnBots({ allies: cfg.allies, enemies: cfg.enemies, ffa: cfg.ffa, difficulty: cfg.difficulty, modeId: cfg.modeId }) || [];
    for (const b of bots) if (!G.actors.includes(b)) G.actors.push(b);
    for (const a of G.actors) spawnActor(a);

    G.hud.attach(G);
    safe('audio.startAmbience', () => G.audio.startAmbience(world.ambience));
    G.mode.start();
    G.menus.showLoading(0.9);
    await warmUp();
    G.menus.showLoading(1);
    G.matchCount += 1;
    G.menus.hideAll();
    G.hud.show();
    beginCountdown();
  } catch (err) {
    showFatal('match', err);
  } finally {
    G._starting = false;
  }
}

/** Shader vorkompilieren, damit der erste Schuss nicht ruckelt. */
async function warmUp() {
  const r = G.renderer.renderer;
  try {
    G.player._updateCamera(0);
    // compileAsync nur mit KHR_parallel_shader_compile (sonst warnt three.js) – sonst synchron
    if (typeof r.compileAsync === 'function' && r.extensions && r.extensions.has('KHR_parallel_shader_compile')) {
      const jobs = [r.compileAsync(G.scene, G.camera), r.compileAsync(G.viewmodel.scene, G.viewmodel.camera)];
      await Promise.race([Promise.all(jobs), new Promise((res) => setTimeout(res, 4000))]);
    } else {
      r.compile(G.scene, G.camera);
      r.compile(G.viewmodel.scene, G.viewmodel.camera);
    }
    G.renderer.render(G.scene, G.camera, G.viewmodel.scene, G.viewmodel.camera);
  } catch (err) {
    console.warn('[NULLPUNKT] Shader-Vorbereitung:', err);
  }
}

function beginCountdown() {
  G.match.countdown = 3;
  G._countShown = 3;
  setState('countdown');
  G.events.emit('match:countdown', { value: 3 });
}

function tickCountdown(dt) {
  G.match.countdown -= dt;
  const v = Math.max(0, Math.ceil(G.match.countdown));
  if (v < G._countShown) {
    G._countShown = v;
    G.events.emit('match:countdown', { value: v });
  }
  if (G.match.countdown <= 0) {
    setState('playing');
    G.match.startedAt = G.time.elapsed;
    G.events.emit('match:start', { modeId: G.match.modeId, mapId: G.match.mapId });
  }
}

function endMatch(result) {
  const st = G.match.state;
  if (st === 'ended' || !G.mode || (st !== 'playing' && st !== 'countdown' && st !== 'paused')) return;
  const res = result || G.mode.result || null;
  G.match.result = res;
  G.match.endedAt = G.time.elapsed;
  setState('ended');
  G.input.exitLock();
  let progression = null;
  try {
    if (res && res.playerSummary) progression = profile.recordMatch({ difficulty: G.match.difficulty, ...res.playerSummary });
  } catch (err) {
    console.error('[NULLPUNKT] profile.recordMatch:', err);
  }
  G.lastResult = res;
  G.lastProgression = progression;
  safe('hud.hide', () => G.hud.hide());
  // Kurzes Ergebnis-Banner, dann Endbildschirm
  const banner = $('match-banner');
  const outcome = !res ? 'draw' : res.draw ? 'draw' : res.playerWon ? 'win' : 'loss';
  if (banner) {
    banner.dataset.result = outcome;
    banner.querySelector('[data-banner-text]').textContent = { win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden' }[outcome];
    banner.hidden = false;
  }
  G._endScreenAt = G.time.real + (AUTOSTART ? 0.6 : 1.6);
}

function showEndScreen() {
  G._endScreenAt = null;
  const banner = $('match-banner');
  if (banner) banner.hidden = true;
  safe('menus.showEnd', () => G.menus.showEnd(G.lastResult, G.lastProgression));
}

async function teardownMatch() {
  G._endScreenAt = null;
  const banner = $('match-banner');
  if (banner) banner.hidden = true;
  safe('input', () => G.input.releaseAll());
  safe('hud', () => { G.hud.hide(); G.hud.detach(); });
  safe('mode', () => { if (G.mode) G.mode.detach(); });
  G.mode = null;
  safe('bots', () => { G.bots.removeAll(); G.bots.detach(); });
  safe('player', () => G.player.endMatch());
  safe('audio', () => { G.audio.stopAmbience(); G.audio.detach(); });
  audioAttached = false;
  safe('effects', () => G.effects.detach());
  safe('weapons', () => G.weapons.detach());
  safe('combat', () => G.combat.detach());
  safe('world', () => {
    if (!G.world) return;
    const grp = G.world.group;
    G.world.dispose();
    if (grp && grp.parent) grp.parent.remove(grp);
  });
  G.world = null;
  G.actors.length = 0;
  if (sceneKeep) sweep(G.scene, sceneKeep);
  if (vmKeep) sweep(G.viewmodel.scene, vmKeep);
  G.scene.environment = null;
  G.scene.background = null;
  G.scene.fog = null;
  G.viewmodel.scene.environment = null;
  G.viewmodel.scene.visible = true;
  G.viewmodel.rig = null;
  safe('renderLists', () => G.renderer.renderer.renderLists.dispose());
}

/** Entfernt und entsorgt alles, was im Match hinzugekommen ist und nach detach() noch hängt. */
function sweep(scene, keep) {
  for (const child of [...scene.children]) {
    if (keep.has(child)) continue;
    scene.remove(child);
    disposeTree(child);
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture && !v.isRenderTargetTexture) v.dispose();
      m.dispose();
    }
    if (o.isLight && typeof o.dispose === 'function') o.dispose();
    if (o.isInstancedMesh || o.isSkinnedMesh) safe('dispose', () => o.dispose());
  });
}

function pause() {
  const st = G.match.state;
  if (st !== 'playing' && st !== 'countdown') return;
  G.match.pausedFrom = st;
  setState('paused');
  G.input.exitLock();
  safe('menus.showPause', () => G.menus.showPause());
}

function resume() {
  if (G.match.state !== 'paused') return;
  safe('menus.hideAll', () => G.menus.hideAll());
  setState(G.match.pausedFrom || 'playing');
  if (G.input.mode === 'desktop' && !AUTOSTART) G.input.requestLock();
  else if (G.input.mode === 'touch') requestFullscreen();
}

/** Vollbild + Querformat-Sperre (nur aus einer Nutzergeste heraus wirksam; Fehler werden ignoriert). */
function requestFullscreen() {
  const el = document.documentElement;
  try {
    if (document.fullscreenElement || !document.fullscreenEnabled || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation && screen.orientation.lock ? screen.orientation.lock('landscape').catch(() => {}) : null))
      .catch(() => {});
  } catch { /* nicht unterstützt (z. B. iOS-Safari auf dem iPhone) */ }
}

async function toLobby() {
  await teardownMatch();
  setState('lobby');
  safe('menus.showLobby', () => G.menus.showLobby());
}

function restart() {
  const cfg = G.lastConfig;
  startMatch(cfg ? { ...cfg, loadout: { ...cfg.loadout } } : configFromParams());
}

/* ===================================================== Schleife */

let lastNow = 0;
let idleRenderAt = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const raw = lastNow ? Math.max(0, (now - lastNow) / 1000) : 0;
  lastNow = now;
  G.time.real += raw;
  const dt = Math.min(raw, 1 / 20) * G.timeScale;
  G.time.dt = dt;
  G.time.frame += 1;
  const st = G.match.state;
  const sim = st === 'countdown' || st === 'playing';

  if (sim) {
    G.time.elapsed += dt;
    if (st === 'countdown') tickCountdown(Math.min(raw, 0.25) * G.timeScale); // Echtzeit, nicht Simulationszeit
    step('input', () => G.input.update(dt));
    if (G.input.pressed('pause') && G.match.state !== 'paused') pause();
    step('player', () => G.player.update(dt));
    step('bots', () => G.bots.update(dt));
    if (st === 'playing') step('separate', () => separateActors(G.actors));
    step('weapons', () => G.weapons.update(dt));
    step('mode', () => { if (G.mode) G.mode.update(dt); });
    if (G.match.state === 'playing') step('respawn', updateRespawns);
    step('world', () => { if (G.world) G.world.update(dt, G.camera); });
    step('effects', () => G.effects.update(dt));
    step('hud', () => G.hud.update(dt));
    step('audio', () => G.audio.update(dt));
    if (G.mode && G.mode.isOver && G.match.state === 'playing') G.events.emit('match:end', { result: G.mode.result });
  }
  if (G._endScreenAt && G.time.real >= G._endScreenAt) showEndScreen();

  // Pausiert/Ende: Bild steht still → nur ~4×/s neu zeichnen (Akku auf Mobilgeräten)
  if (G.world && G.camera && st !== 'loading' && (sim || now - idleRenderAt > 250)) {
    idleRenderAt = now;
    step('render', () => G.renderer.render(G.scene, G.camera, G.viewmodel.scene, G.viewmodel.camera));
  }
  if (sim) G.input.endFrame();
  updateStats(now);
  if (st === 'playing') adaptPerformance(now);
}

function updateRespawns() {
  const mode = G.mode;
  const now = G.time.elapsed;
  for (const a of G.actors) {
    if (a.alive || a.respawnAt == null || now < a.respawnAt) continue;
    if (mode && typeof mode.canRespawn === 'function' && mode.canRespawn(a) === false) continue;
    spawnActor(a);
  }
}

/**
 * Leistungsregelung (§11a): < 40 FPS für 3 s → Pixelverhältnis um 15 % senken (bis 0,55);
 * ist das ausgereizt und Qualität = 'auto', eine Stufe tiefer. > 56 FPS für 8 s → Auflösung zurück.
 * Abgeschaltet, wenn ?quality=… die Stufe für Tests festlegt.
 */
const perf = { lowSince: null, highSince: null, lastChange: 0 };
function adaptPerformance(now) {
  if (QUALITY_OVERRIDE || G.match.startedAt == null || G.time.elapsed - G.match.startedAt < 3) return;
  const R = G.renderer;
  const fps = R.info().fps;
  if (!fps) return;
  if (fps < 40) { perf.highSince = null; if (perf.lowSince == null) perf.lowSince = now; }
  else if (fps > 56) { perf.lowSince = null; if (perf.highSince == null) perf.highSince = now; }
  else { perf.lowSince = null; perf.highSince = null; }
  if (now - perf.lastChange < 2500) return;
  if (perf.lowSince != null && now - perf.lowSince > 3000) {
    perf.lastChange = now;
    perf.lowSince = now;
    if (R.resolutionScale > 0.56) {
      R.setResolutionScale(R.resolutionScale - 0.15);
    } else if (settings.get('quality') === 'auto') {
      const idx = QUALITY_LEVELS.indexOf(R.quality);
      if (idx > 0) {
        const next = QUALITY_LEVELS[idx - 1];
        console.info(`[NULLPUNKT] Automatische Qualität: ${R.quality} → ${next} (${fps} FPS)`);
        R.setQuality(next);
        R.setResolutionScale(0.85);
        applyQualityClasses();
      }
    }
  } else if (perf.highSince != null && now - perf.highSince > 8000 && R.resolutionScale < 1) {
    perf.lastChange = now;
    perf.highSince = now;
    R.setResolutionScale(R.resolutionScale + 0.1);
  }
}

/* ===================================================== FPS-/Debug-Anzeige */

let statsEl = null;
let statsAt = 0;
function updateStats(now) {
  const show = DEBUG || settings.get('showFps');
  if (!show) { if (statsEl) statsEl.hidden = true; return; }
  if (!statsEl) {
    statsEl = document.createElement('div');
    statsEl.id = 'np-stats';
    statsEl.setAttribute('aria-hidden', 'true');
    ($('game-root') || document.body).appendChild(statsEl);
  }
  statsEl.hidden = false;
  if (now - statsAt < 250) return;
  statsAt = now;
  const i = G.renderer.info();
  let text = `${i.fps} FPS · ${String(i.frameMs).replace('.', ',')} ms`;
  if (DEBUG) {
    const stubs = Object.entries(G.moduleStatus).filter(([, v]) => v !== 'real').map(([k]) => k);
    text += `\n${i.drawCalls} Draw Calls · ${(i.triangles / 1000).toFixed(1).replace('.', ',')}k Dreiecke\n${i.quality} · ${i.width}×${i.height} @${i.pixelRatio}\n` +
      `${G.match.state} · ${G.actors.length} Akteure · Geo ${i.geometries} · Tex ${i.textures}` +
      (stubs.length ? `\nStubs: ${stubs.join(', ')}` : '');
  }
  statsEl.textContent = text;
}

function applyQualityClasses() {
  document.body.classList.toggle('np-css-vignette', !G.renderer.preset.grade);
  document.body.dataset.quality = G.renderer.quality;
}

function updateLockHint() {
  const el = $('lock-hint');
  if (!el || !G.input) return;
  const st = G.match.state;
  const need = G.input.mode === 'desktop' && (st === 'playing' || st === 'countdown') && !G.input.locked && G.input.everLocked && !AUTOSTART;
  el.hidden = !need;
}

/* ===================================================== Debug-API */

G.debugApi = {
  teleport(x, y, z) { G.player.body.teleport(new THREE.Vector3(x, y, z)); },
  godMode(on = true) { G.player.godMode = !!on; return G.player.godMode; },
  giveWeapon(id) {
    const def = G.data.WEAPONS && G.data.WEAPONS[id];
    const w = G.player.weapon;
    if (!def || !w) return false;
    const lo = { ...(G.player.loadout || {}) };
    if (def.slot === 'secondary') lo.secondary = id; else lo.primary = id;
    G.player.loadout = lo;
    w.setLoadout(lo);
    return true;
  },
  killAllEnemies() {
    let n = 0;
    for (const a of [...G.actors]) {
      if (a.alive && a !== G.player && G.combat.isHostile(G.player, a)) {
        G.combat.damage(a, { amount: 9999, attacker: G.player, weaponId: G.player.weapon ? G.player.weapon.currentDef.id : null, zone: 'body', dir: new THREE.Vector3(0, 0, -1) });
        n++;
      }
    }
    return n;
  },
  setTimeScale(s) { G.timeScale = Math.min(4, Math.max(0.05, Number(s) || 1)); return G.timeScale; },
  endMatch() {
    const m = G.mode;
    if (!m) return false;
    if (typeof m.forceEnd === 'function') m.forceEnd();
    else if (typeof m.end === 'function') m.end();
    else { m.timeLeft = 0; return true; }
    if (!m.isOver || G.match.state !== 'ended') endMatch(m.result);
    return true;
  },
  spawnBots(n = 1) {
    const bots = G.bots.spawnBots({ allies: 0, enemies: Math.max(1, n | 0), ffa: G.match.ffa, difficulty: G.match.difficulty, modeId: G.match.modeId }) || [];
    for (const b of bots) { if (!G.actors.includes(b)) G.actors.push(b); spawnActor(b); }
    return bots.length;
  },
  lookAt(x, y, z) {
    const p = G.player;
    const eye = p.getEyePosition(new THREE.Vector3());
    const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  },
  // Zusätzliche Hilfen für Tests/Automatisierung
  start(cfg) { return startMatch(cfg || configFromParams()); },
  restart,
  pause,
  resume,
  toLobby,
  setQuality(q) { G.renderer.setQuality(q); applyQualityClasses(); return G.renderer.quality; },
  state() {
    const p = G.player;
    const i = G.renderer ? G.renderer.info() : {};
    return {
      state: G.match.state, modeId: G.match.modeId, mapId: G.match.mapId, matchCount: G.matchCount,
      fps: i.fps, drawCalls: i.drawCalls, geometries: i.geometries, textures: i.textures, quality: i.quality,
      actors: G.actors.length, alive: G.actors.filter((a) => a.alive).length,
      kills: G.combat ? G.combat.killCount : 0,
      player: p ? { alive: p.alive, health: Math.round(p.health), kills: p.stats.kills, deaths: p.stats.deaths, score: p.stats.score, weapon: p.weapon && p.weapon.currentDef ? p.weapon.currentDef.id : null, mag: p.weapon && p.weapon.current ? p.weapon.current.mag : null } : null,
      scores: G.mode ? G.mode.scores : null, timeLeft: G.mode ? G.mode.timeLeft : null,
      modules: { ...G.moduleStatus }, listeners: G.events.count(),
    };
  },
};

/* ===================================================== Globale Ereignisse */

function wireGlobal() {
  const menus = G.menus;
  menus.onStart = (cfg) => startMatch(cfg);
  menus.onResume = () => resume();
  menus.onRestart = () => restart();
  menus.onQuit = () => toLobby();
  menus.onExit = () => { location.href = 'index.html'; };

  G.events.on('match:end', ({ result } = {}) => endMatch(result));
  G.events.on('kill', ({ victim }) => {
    if (!victim) return;
    victim.diedAt = G.time.elapsed;
    const delay = G.mode && Number.isFinite(G.mode.respawnDelay) ? G.mode.respawnDelay : 3;
    victim.respawnAt = G.time.elapsed + delay;
  });
  G.events.on('ui:sound', ({ name } = {}) => { if (!audioAttached && name) safe('audio.ui', () => G.audio.ui(name)); });
  G.events.on('input:lock', ({ locked, error }) => {
    updateLockHint();
    // Nur ein echter Verlust der Sperre pausiert (nicht eine abgelehnte Anfrage, z. B. Chrome-Wartezeit nach Esc)
    const st = G.match.state;
    if (!locked && !error && G.input.everLocked && G.input.mode === 'desktop' && (st === 'playing' || st === 'countdown')) pause();
  });
  G.events.on('input:mode', () => updateLockHint());

  settings.onChange((key, value) => {
    G.events.emit('settings:change', { key, value });
    if (key === 'quality' && !QUALITY_OVERRIDE) { G.renderer.setQuality(value); applyQualityClasses(); }
    if (key === 'playerName' && G.player) G.player.name = value;
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
  const onPortrait = () => { if (portrait.matches) pause(); };
  if (portrait.addEventListener) portrait.addEventListener('change', onPortrait);
  window.addEventListener('beforeunload', (e) => {
    const st = G.match.state;
    if (st === 'playing' || st === 'paused' || st === 'countdown') { e.preventDefault(); e.returnValue = ''; }
  });
  G.renderer.onContextChange((kind) => {
    const el = $('context-lost');
    if (kind === 'lost') { pause(); if (el) el.hidden = false; } else if (el) el.hidden = true;
  });
  const fatalReload = document.querySelector('[data-fatal-reload]');
  if (fatalReload) fatalReload.addEventListener('click', () => location.reload());
}

/* ===================================================== Start */

async function bootstrap() {
  const onBootError = (e) => {
    if (G.match.state !== 'boot') return;
    showFatal('error', e.error || e.reason || new Error(e.message || 'Unbekannter Fehler'));
  };
  window.addEventListener('error', onBootError);
  window.addEventListener('unhandledrejection', onBootError);
  startTips();
  try {
    setBoot(0.02, 'Prüfe Grafik …');
    if (!webglAvailable()) { showFatal('webgl'); return; }
    G.renderer = createRenderer(canvas, { quality: QUALITY_OVERRIDE || settings.get('quality') });
    applyQualityClasses();

    setBoot(0.06, 'Lade Module …');
    await loadModules((p) => setBoot(0.06 + p * 0.66, 'Lade Module …'));

    setBoot(0.75, 'Starte Systeme …');
    G.player = new Player(G);
    G.camera = G.player.camera;
    G.input = new Input(G);
    G.input.allowUnlockedMouse = AUTOSTART;
    G.input.attach(G);
    G.combat = new Combat(G);
    G.audio = await construct('audio', 'AudioEngine', G);
    G.weapons = await construct('weapons', 'WeaponSystem', G);
    G.effects = await construct('effects', 'Effects', G);
    G.bots = await construct('bots', 'BotManager', G);
    G.hud = await construct('hud', 'HUD', G);
    G.menus = await construct('menus', 'Menus', G);
    wireGlobal();

    setBoot(0.92, 'Bereite Grafik vor …');
    requestAnimationFrame(frame);
    setBoot(1, 'Bereit.');
    window.removeEventListener('error', onBootError);
    window.removeEventListener('unhandledrejection', onBootError);
    setState('lobby');
    hideBoot();
    if (DEBUG) console.info('[NULLPUNKT] Module:', { ...G.moduleStatus });
    if (AUTOSTART) startMatch(configFromParams());
    else G.menus.showLobby();
  } catch (err) {
    showFatal('error', err);
  }
}

bootstrap();
