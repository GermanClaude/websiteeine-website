// NULLPUNKT — Spielstart, Spielschleife und Match-Lebenszyklus (§2).
//
// Lebenszyklus (ohne Neuladen der Seite, ohne Lecks):
//   boot → lobby → loading → countdown → playing ⇄ paused → ended → (Revanche → loading …) | (Lobby → lobby)
// Einmal beim Start konstruiert: Renderer, Input, Player, Combat, AudioEngine, WeaponSystem, Effects,
//   BotManager, HUD, Menus. Pro Match: attach(G) … detach() (in umgekehrter Reihenfolge), Modus neu erzeugen.
//   Die Welt bleibt bei einer Revanche auf derselben Karte erhalten (nur dynamischer Zustand wird
//   zurückgesetzt), sonst wird sie entsorgt. Alles, was nach detach() noch in G.scene hängt und im Match
//   hinzukam, wird entfernt und entsorgt.
//
// Die Subsysteme werden parallel dynamisch geladen (Fortschrittsbalken); spielen.html lädt den ganzen
// Modulgraphen per <link rel="modulepreload"> vor (Liste: node tools/preload.mjs). Fehlt ein Pflichtmodul,
// erscheint das Fehlerpanel („Neu laden“, „Zurück zur Website“); fehlt nur das Audiomodul, läuft das Spiel stumm.

import * as THREE from 'three';
import { settings } from '../shared/settings.js';
import { profile } from '../shared/profile.js';
import * as weaponsData from '../shared/weapons.data.js';
import * as modesData from '../shared/modes.data.js';
import * as mapsData from '../shared/maps.data.js';
import * as classesData from '../shared/classes.data.js'; // core-mechanics: Klassen, Panzerung, Spielstile
import { EventBus } from './engine/events.js';
import { createRenderer, QUALITY_LEVELS, resolveQuality } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { separateActors } from './engine/physics.js';
import { DynamicResolution } from './engine/dynres.js';
import { renderScaleValue, fpsLimitValue } from '../shared/graphics.data.js'; // Erweitert-Grafik (S9, ui-controls)
import { Player } from './player.js';
import { Combat } from './combat.js';

const VERSION = '1.1.0';

// key: [Pfad relativ zu main.js, Pflichtexporte]
const MODULES = {
  textures: ['./engine/textures.js', ['getMaterial', 'boxUV']],
  models: ['./weapons/models.js', ['createWeaponModel']],
  viewmodel: ['./weapons/viewmodel.js', ['ViewModel']],
  world: ['./world/index.js', ['loadWorld']],
  audio: ['./engine/audio.js', ['AudioEngine']],
  weapons: ['./weapons/index.js', ['WeaponSystem']],
  effects: ['./engine/effects.js', ['Effects']],
  bots: ['./bots/manager.js', ['BotManager']],
  vehicles: ['./vehicles/index.js', ['VehicleSystem']], // vehicles: Fahrzeuge (G.vehicles)
  // nur für die Vorarbeit im Ladebildschirm/Leerlauf (matchAssetJobs) – fehlende Exporte: Schritt entfällt
  soldiers: ['./bots/character.js', []],
  fxtex: ['./weapons/ballistics/fxtex.js', []],
  modes: ['./modes/index.js', ['createMode']],
  hud: ['./ui/hud.js', ['HUD']],
  menus: ['./ui/menus.js', ['Menus']],
};
/** Ohne diese Module bleibt das Spiel spielbar (stummer Ersatz). */
const OPTIONAL = new Set(['audio']);

/** Stummer Ersatz für die AudioEngine, falls das Audiomodul nicht lädt oder nicht startet. */
const SILENT_AUDIO = Object.freeze({
  silent: true,
  unlock: () => Promise.resolve(false),
  attach() {}, detach() {}, update() {}, ui() {}, setVolumes() {},
  play: () => null,
  startAmbience() {}, stopAmbience() {},
});

const TIPS = [
  'Sprinte und drücke Ducken, um zu rutschen – ideal, um um Ecken zu kommen.',
  'Gesundheit regeneriert sich nach 3,5 Sekunden ohne Treffer.',
  'Kopftreffer verursachen deutlich mehr Schaden.',
  'Im Anschlag streut jede Waffe viel weniger.',
  'Dünne Deckung aus Holz, Blech oder Glas lässt sich durchschießen.',
  'Halte die Granatentaste nicht zu lange – Splittergranaten zünden nach 2,8 Sekunden.',
  'Auf dem Touchscreen: Joystick ganz nach oben schieben sperrt den Sprint.',
  'Schüsse verraten deine Position auf der Minikarte der Gegner.',
  'Rückwärts läufst du langsamer als vorwärts – Angriff ist schneller als Rückzug.',
];

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const AUTOSTART = params.get('autostart') === '1';
const QUALITY_OVERRIDE = QUALITY_LEVELS.includes(params.get('quality')) ? params.get('quality') : null;
const clampTimeScale = (v) => Math.min(4, Math.max(0.05, Number(v) || 1));
// Test-/Entwicklerparameter wirken nur zusammen mit debug=1 (und machen das Match „ungewertet“)
const DEV_GOD = DEBUG && params.get('god') === '1';
const DEV_TIMESCALE = DEBUG && params.has('timescale') ? clampTimeScale(params.get('timescale')) : null;
// Hochformat-Sperre wie in game.css (#rotate-overlay): gespielt wird auf allen Touch-Geräten nur quer
// (Telefone sehen den Hinweis immer, Tablets nur im Match – Lobby/Menüs bleiben dort hochkant bedienbar)
const PORTRAIT_QUERY = '(orientation: portrait) and (pointer: coarse)';

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
    startedAt: null, startedReal: null, countdown: 0, ffa: false, timeLimit: null, scoreLimit: null, pausedFrom: null, endedAt: null, result: null,
    unranked: false, awaitingLock: false,
    // core-mechanics: Spielstil-Flags, Panzerung an/aus, Online-Deckel der Hilfen, Respawn-Halt, Ausrüstung ab nächstem Spawn
    style: 'arcade', styleFlags: classesData.styleFlags('arcade'), armor: false, assistCap: null, respawnHold: false, pendingLoadout: null,
  },
  time: { dt: 0, elapsed: 0, frame: 0, real: 0 },
  timeScale: 1,
  params,
  debug: DEBUG,
  // Reine Daten (weapons/modes/maps.data.js) – statisch importiert, keine Ersatzkopien
  // weapons.data zuletzt: G.data.CLASS_ORDER bleibt die Waffenklassen-Reihenfolge (modes.data exportiert gleichnamig die Soldatenklassen)
  data: { ...modesData, ...mapsData, ...weaponsData, SOLDIER_CLASS_ORDER: classesData.SOLDIER_CLASS_ORDER },
  modules: {},
  moduleStatus: {},
  lastConfig: null,
  lastResult: null,
  lastProgression: null,
  matchCount: 0,
  debugApi: null,
  spawnActor: null,
  perf: null,
};
G.scene.name = 'main';
G.viewmodel.scene.name = 'viewmodel';
window.__game = G;

const portraitMQ = window.matchMedia ? window.matchMedia(PORTRAIT_QUERY) : { matches: false };

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

/** Deutsches Fehlerpanel mit „Neu laden“ und „Zurück zur Website“ (kind: 'webgl' | 'module' | 'error' | 'match'). */
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
    if (kind === 'module') {
      title.textContent = 'Spieldaten konnten nicht geladen werden';
      text.textContent = 'Ein Teil des Spiels ließ sich nicht laden – meist wegen einer kurz unterbrochenen Verbindung. Lade die Seite neu.';
    } else {
      title.textContent = kind === 'match' ? 'Das Match konnte nicht gestartet werden' : 'Beim Laden ist ein Fehler aufgetreten';
      text.textContent = 'Lade die Seite neu. Tritt der Fehler erneut auf, hilft die Meldung unten bei der Fehlersuche.';
    }
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

/**
 * Renderer auf der Spielleinwand erzeugen; `null`, wenn kein WebGL-2-Kontext entsteht. Kein
 * Wegwerf-Kontext als Vorprüfung (kostete beim Start eine zusätzliche GPU-Kontexterzeugung und hielt
 * bis zur Speicherbereinigung einen weiteren Kontext offen – Android begrenzt die Zahl). Scheitert
 * der Kontext, bleiben die three.js-Konsolenfehler dazu aus: das Fehlerpanel „WebGL ist nicht
 * verfügbar“ erklärt es. Andere Meldungen beim Erzeugen werden unverändert weitergereicht.
 */
function createRendererOrNull(opts) {
  if (typeof WebGL2RenderingContext === 'undefined') return null;
  let contextFailed = false;
  const onCreationError = () => { contextFailed = true; };
  const held = [];
  const prevConsole = THREE.getConsoleFunction();
  canvas.addEventListener('webglcontextcreationerror', onCreationError);
  THREE.setConsoleFunction((type, ...args) => held.push([type, args]));
  let renderer = null;
  try {
    renderer = createRenderer(canvas, opts);
  } catch (err) {
    if (!(contextFailed || /WebGL context/i.test(String(err && err.message)))) throw err;
    contextFailed = true;
  } finally {
    THREE.setConsoleFunction(prevConsole);
    canvas.removeEventListener('webglcontextcreationerror', onCreationError);
    if (!contextFailed) {
      for (const [type, args] of held) {
        if (prevConsole) prevConsole(type, ...args);
        else (console[type] || console.log)(...args);
      }
    }
  }
  return renderer;
}

/* ===================================================== Module laden */

const isFetchError = (err) => err instanceof TypeError && /fetch|load|import/i.test(String(err.message));

/** Dynamischer Import mit einer Wiederholung (Cache umgehen) bei Netzfehlern; prüft Pflichtexporte. */
async function importModule(path, required) {
  const url = new URL(path, import.meta.url).href;
  let mod;
  try {
    mod = await import(url);
  } catch (err) {
    if (!isFetchError(err)) throw err;
    mod = await import(`${url}?retry=${Date.now()}`);
  }
  const missing = required.filter((n) => typeof mod[n] === 'undefined');
  if (missing.length) throw new Error(`${path}: Exporte fehlen (${missing.join(', ')})`);
  return mod;
}

async function loadModules(onProgress) {
  const keys = Object.keys(MODULES);
  let done = 0;
  await Promise.all(keys.map(async (key) => {
    const [path, required] = MODULES[key];
    try {
      G.modules[key] = await importModule(path, required);
      G.moduleStatus[key] = 'real';
    } catch (err) {
      if (!OPTIONAL.has(key)) {
        const e = new Error(`Modul „${path.replace('./', 'assets/js/game/')}“ nicht ladbar – ${err && err.message ? err.message : err}`);
        e.cause = err;
        e.moduleKey = key;
        throw e;
      }
      G.modules[key] = null;
      G.moduleStatus[key] = 'missing';
      console.warn(`[NULLPUNKT] ${key}: Modul nicht ladbar – Spiel läuft ohne Ton.`, err);
    } finally {
      onProgress(++done / keys.length);
    }
  }));
}

function createAudio() {
  const mod = G.modules.audio;
  if (!mod) return SILENT_AUDIO;
  try {
    return new mod.AudioEngine(G);
  } catch (err) {
    G.moduleStatus.audio = 'missing';
    console.warn('[NULLPUNKT] Audio konnte nicht gestartet werden – Spiel läuft ohne Ton.', err);
    return SILENT_AUDIO;
  }
}

/* ===================================================== Zustände */

function setState(state) {
  const prev = G.match.state;
  if (prev === state) return;
  G.match.state = state;
  document.body.dataset.matchState = state;
  if (state !== 'paused') setAwaitingLock(false);
  if (G.input) G.input.setEnabled(state === 'playing' || state === 'countdown');
  if (dynres) dynres.clearSamples();
  G.events.emit('match:state', { state, prev });
  updateLockHint();
  if (state === 'lobby') scheduleLobbyPrewarm();
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

/** Karten, auf denen ein Modus spielbar ist (wie Lobby.mapsFor: maps.data.js `modes`). */
function mapsForMode(modeId) {
  const MAPS = G.data.MAPS || {};
  const ids = (G.data.MAP_ORDER || Object.keys(MAPS)).filter((id) => MAPS[id]);
  const list = ids.filter((id) => Array.isArray(MAPS[id].modes) && MAPS[id].modes.includes(modeId));
  if (list.length) return list;
  return modeId === 'training' ? ids.filter((id) => id === 'range') : ids.filter((id) => id !== 'range');
}

/** Vervollständigt/validiert eine Match-Konfiguration (Lobby oder URL): Modus↔Karte, Freischaltungen, Teamgrößen. */
function normalizeConfig(cfg = {}) {
  const MODES = G.data.MODES || {};
  const W = G.data.WEAPONS || {};
  const EQ = G.data.EQUIPMENT || {};
  const modeId = MODES[cfg.modeId] ? cfg.modeId : MODES[settings.get('lastMode')] ? settings.get('lastMode') : 'tdm';
  const maps = mapsForMode(modeId);
  const rec = (MODES[modeId] && MODES[modeId].recommendedMaps) || [];
  const mapId = [cfg.mapId, settings.get('lastMap'), ...rec, maps[0]].find((id) => id && maps.includes(id)) || 'hafen';
  const difficulty = DIFFS.includes(cfg.difficulty) ? cfg.difficulty : DIFFS.includes(settings.get('difficulty')) ? settings.get('difficulty') : 'regulaer';
  const counts = modeCounts(modeId);
  // modes-ui: Teamgrößen je Karte und Gerät (limitsFor, GROSSKAMPF §3.2: Arena 12 v 12, Großkarte 32 v 32)
  if (typeof G.data.limitsFor === 'function') {
    const L = safe('limitsFor', () => G.data.limitsFor(modeId, (G.data.MAPS || {})[mapId] || mapId, {
      tier: (G.renderer && G.renderer.quality) || 'high', touch: !!(G.input && G.input.mode === 'touch'), deviceMemory: navigator.deviceMemory ?? null,
    }));
    if (L) Object.assign(counts, { alliesRange: L.allies, enemiesRange: L.enemies, allies: L.recommended.allies, enemies: L.recommended.enemies });
  }
  const ffa = isFfaMode(modeId);
  const allies = ffa ? 0 : intParam(cfg.allies, counts.allies, counts.alliesRange[0], Math.max(counts.alliesRange[1], 0));
  const enemies = intParam(cfg.enemies, counts.enemies, counts.enemiesRange[0], Math.max(counts.enemiesRange[1], 0));
  const def = (G.data.DEFAULT_LOADOUTS && G.data.DEFAULT_LOADOUTS[0]) || { primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag' };
  const lo = cfg.loadout || {};
  const last = settings.get('lastLoadout') || {};
  // Freischaltungen gelten auch für URL-Starts; nur mit debug=1 ist alles erlaubt (Match dann ungewertet)
  const unlocked = (id) => DEBUG || profile.isUnlocked(id);
  const okW = (id, slot) => !!(id && W[id] && W[id].slot === slot && unlocked(id));
  const okEq = (id) => !!(id && EQ[id] && unlocked(id));
  const loadout = {
    primary: [lo.primary, last.primary].find((id) => okW(id, 'primary')) || def.primary,
    secondary: [lo.secondary, last.secondary].find((id) => okW(id, 'secondary')) || def.secondary,
    lethal: [lo.lethal, last.lethal].find(okEq) || def.lethal,
  };
  // modes-ui: Klasse, Tarnungen, Outfit, Spielstil, Matchlänge, Tageszeit (Lobby bzw. URL style=/cls=)
  const CL = G.data.CLASSES || {};
  if (lo.cls && CL[lo.cls]) loadout.cls = lo.cls;
  if (lo.camo && typeof lo.camo === 'object') loadout.camo = { ...lo.camo };
  if (typeof lo.skin === 'string') loadout.skin = lo.skin;
  const STY = G.data.GAME_STYLES || {};
  const style = STY[cfg.style] ? cfg.style : STY[settings.get('gameStyle')] ? settings.get('gameStyle') : 'arcade'; // core-mechanics: Einstellung als Rückfall
  // core-mechanics: Klasse/Weste/Helm vervollständigen; eine Klasse ohne Waffenwahl (URL cls=) bringt ihre Standardwaffen mit
  const extra = {};
  if (loadout.camo) extra.camo = loadout.camo;
  if (loadout.skin) extra.skin = loadout.skin;
  const src = loadout.cls && !lo.primary && !lo.secondary ? { cls: loadout.cls } : { ...loadout, cls: loadout.cls || settings.get('lastClass') };
  const full = cleanLoadout({ ...src, armor: lo.armor, helmet: lo.helmet });
  for (const k of Object.keys(loadout)) delete loadout[k];
  Object.assign(loadout, full, extra);
  return {
    modeId, mapId, difficulty, allies, enemies, loadout, ffa, armor: armorFor(cfg, mapId, modeId),
    style, crosshair: typeof cfg.crosshair === 'boolean' ? cfg.crosshair : null,
    matchLength: ['kurz', 'standard', 'lang'].includes(cfg.matchLength) ? cfg.matchLength : 'standard',
    timeOfDay: typeof cfg.timeOfDay === 'string' ? cfg.timeOfDay : null,
    timeLimit: numParam(cfg.timeLimit), scoreLimit: numParam(cfg.scoreLimit),
  };
}

/**
 * Ungewertet (keine EP/Statistik): verkürzte Limits gegenüber dem Modus-Standard (URL time/score – sonst ließe
 * sich mit ?autostart=1&score=1 EP „farmen“) und gesperrte Waffen (nur mit debug=1 erlaubt). Gottmodus,
 * Zeitraffer und Debug-Hilfen setzen G.match.unranked zusätzlich während des Matches.
 */
function isUnranked(cfg) {
  const def = (G.data.MODES && G.data.MODES[cfg.modeId]) || {};
  const shorter = (v, std) => v != null && Number.isFinite(std) && std > 0 && v < std;
  if (cfg.modeId !== 'training' && (shorter(cfg.scoreLimit, def.scoreLimit) || shorter(cfg.timeLimit, def.timeLimit))) return true;
  return !!cfg.loadout && ['primary', 'secondary', 'lethal'].some((k) => cfg.loadout[k] && !profile.isUnlocked(cfg.loadout[k]));
}

function configFromParams() {
  return {
    modeId: params.get('mode'), mapId: params.get('map'), difficulty: params.get('diff'),
    allies: params.get('allies'), enemies: params.get('enemies'),
    loadout: { primary: params.get('primary'), secondary: params.get('secondary'), lethal: params.get('lethal'), cls: params.get('cls'), armor: params.get('vest'), helmet: params.get('helmet') },
    timeLimit: params.get('time'), scoreLimit: params.get('score'), style: params.get('style'), armor: params.get('armor'),
  };
}

/* ===================================================== Match */

let sceneBase = null; // Szeneninhalt ohne Welt/Match (vor dem Kartenaufbau erfasst)
let vmBase = null;
let audioAttached = false;
let matchGen = 0; // jeder Start/Abbruch erhöht; laufende Starts prüfen nach jedem await
let startTask = null; // Promise des laufenden Starts
let queuedConfig = null; // Start, der während eines laufenden Starts angefordert wurde
let startingKey = null; // normalisierte Konfiguration des laufenden Starts
const configKey = (cfg) => { try { return JSON.stringify(normalizeConfig(cfg)); } catch { return String(Math.random()); } };

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
  // core-mechanics: vorgemerkte Ausrüstung (Pausemenü/Todesbildschirm) gilt ab diesem Spawn; Klasse + Panzerung ausgeben
  if (actor === G.player && G.match.pendingLoadout) {
    const lo = G.match.pendingLoadout;
    G.match.pendingLoadout = null;
    actor.loadout = { ...lo };
    if (actor.weapon && typeof actor.weapon.setLoadout === 'function') safe('weapon.setLoadout', () => actor.weapon.setLoadout(actor.loadout));
  }
  if (actor === G.player) G.match.respawnHold = false;
  safe('equipActor', () => equipActor(actor));
  actor.respawn(spawn);
  actor.respawnAt = null;
  actor.diedAt = null;
  G.events.emit('actor:spawn', { actor });
}
G.spawnActor = spawnActor;

/* ===================================================== Klassen, Panzerung, Ausrüstung im Match (core-mechanics) */

const SPAWN_GRACE = 5; // s nach dem Spawn, in denen eine neue Ausrüstung sofort gilt (solange noch nicht geschossen)

/** Spielstil + Panzerung des Matches aus der normalisierten Konfiguration. */
function applyStyle(cfg) {
  const style = cfg.style === 'realistisch' ? 'realistisch' : 'arcade';
  const rules = typeof G.data.styleRules === 'function' ? safe('styleRules', () => G.data.styleRules(style, { crosshair: cfg.crosshair })) : null;
  G.match.style = style;
  G.match.styleFlags = classesData.styleFlags(style, { realisticCrosshair: settings.get('realisticCrosshair'), rules });
  G.match.armor = cfg.armor;
  G.match.respawnHold = false;
  G.match.pendingLoadout = null;
}

/** Panzerung an? URL/Lobby `armor` (1/0, an/aus, true/false) > Modus (`MODES[id].armor`) > Großkarte bzw. Eroberung. */
function armorFor(cfg, mapId, modeId) {
  const v = cfg.armor;
  if (v === true || v === 1 || v === '1' || v === 'an' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'aus' || v === 'false') return false;
  const mode = (G.data.MODES || {})[modeId];
  if (mode && typeof mode.armor === 'boolean') return mode.armor;
  const map = (G.data.MAPS || {})[mapId];
  return !!(map && map.scale === 'gross') || modeId === 'cq';
}

/** Ausrüstung bereinigen: Klasse, Waffen (freigeschaltet), Weste/Helm; fehlende Waffen aus der Klassen-Standardausrüstung. */
function cleanLoadout(lo = {}, fallback = {}) {
  const W = G.data.WEAPONS || {};
  const EQ = G.data.EQUIPMENT || {};
  const unlocked = (id) => DEBUG || profile.isUnlocked(id);
  const cls = classesData.CLASSES[lo.cls] ? lo.cls : classesData.CLASSES[fallback.cls] ? fallback.cls : classesData.DEFAULT_CLASS;
  const base = { ...fallback, ...Object.fromEntries(Object.entries(lo).filter(([, v]) => v != null)) };
  const r = classesData.resolveClassLoadout(cls, { weapons: W, equipment: EQ, isUnlocked: unlocked, base });
  const out = { ...base, cls, primary: r.primary, secondary: r.secondary, lethal: r.lethal, armor: r.armor, helmet: r.helmet };
  if (r.launcher) out.launcher = r.launcher;
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

/** Klasse, Weste und Helm eines Akteurs am Spawn (Bots ohne Klasse bekommen eine gewichtete Zufallsklasse). */
function equipActor(actor) {
  actor.cls = (actor.loadout && classesData.CLASSES[actor.loadout.cls] && actor.loadout.cls) || (classesData.CLASSES[actor.cls] && actor.cls) ||
    (actor.isPlayer ? classesData.DEFAULT_CLASS : classesData.pickBotClass());
  const c = classesData.classDef(actor.cls);
  actor.classDef = c;
  const lo = actor.loadout || {};
  if (G.match.armor) G.combat.equipArmor(actor, classesData.ARMOR_TIERS[lo.armor] ? lo.armor : c.armor, classesData.HELMETS[lo.helmet] ? lo.helmet : c.helmet);
  else actor.armor = null;
}

/**
 * Ausrüstung im Match wechseln (Pausemenü „Ausrüstung“, Todesbildschirm „Ausrüsten“).
 * Gilt sofort, wenn der Spieler tot ist (nächster Spawn) bzw. ≤ 5 s nach dem Spawn noch nicht geschossen hat; sonst ab dem nächsten Spawn.
 * → { ok, when: 'now'|'next', loadout, reason? }
 */
function requestLoadout(loadout) {
  const p = G.player;
  if (!p || !loadout || typeof loadout !== 'object') return { ok: false, reason: 'ungueltig' };
  const st = G.match.state;
  if (st !== 'playing' && st !== 'countdown' && st !== 'paused') return { ok: false, reason: 'kein-match' };
  const lo = cleanLoadout(loadout, p.loadout || G.match.loadout || {});
  if (!lo.primary && !lo.secondary) return { ok: false, reason: 'ungueltig' };
  const now = G.time.elapsed;
  const fresh = p.alive && (st === 'countdown' || (now - (p.spawnTime || 0) <= SPAWN_GRACE && (p.lastFiredTime || -1e9) < (p.spawnTime || 0)));
  if (fresh) {
    applyLoadoutNow(p, lo);
    G.match.pendingLoadout = null;
  } else G.match.pendingLoadout = lo;
  G.match.loadout = { ...lo };
  settings.patch({ lastLoadout: lo, lastClass: lo.cls });
  const when = fresh ? 'now' : 'next';
  G.events.emit('loadout:change', { actor: p, loadout: { ...lo }, when });
  return { ok: true, when, loadout: { ...lo } };
}

function applyLoadoutNow(p, lo) {
  p.loadout = { ...lo };
  p.cls = lo.cls;
  if (p.weapon && typeof p.weapon.setLoadout === 'function') safe('weapon.setLoadout', () => p.weapon.setLoadout(p.loadout));
  else if (G.weapons) p.weapon = G.weapons.createController(p, p.loadout);
  equipActor(p);
  safe('player.applyClass', () => p.applyClass && p.applyClass());
}

/** Respawn-Zeit anhalten (Ausrüsten-Menü offen) bzw. weiterlaufen lassen. */
function holdRespawn(on = true) {
  on = !!on;
  if (G.match.respawnHold === on) return on;
  G.match.respawnHold = on;
  G.events.emit('respawn:hold', { on, remaining: respawnRemaining() });
  return on;
}

/** Restzeit bis zum Respawn des Spielers (s; 0 = jetzt möglich, null = lebt). */
function respawnRemaining() {
  const p = G.player;
  if (!p || p.alive || p.respawnAt == null) return null;
  return Math.max(0, p.respawnAt - G.time.elapsed);
}

/** „Einsatz“: Halten beenden und sofort spawnen (wenn der Modus es erlaubt), sonst läuft die Restzeit weiter. */
function deploy() {
  const p = G.player;
  holdRespawn(false);
  if (!p || p.alive || G.match.state !== 'playing' || p.respawnAt == null) return false;
  const mode = G.mode;
  if (mode && typeof mode.canRespawn === 'function' && mode.canRespawn(p) === false) return false;
  // Mindestwartezeit des Modus bleibt (kein Überspringen des Timers durch Menü-Klicks): nur nach Ablauf sofort
  if (G.time.elapsed < p.respawnAt) return false;
  spawnActor(p);
  return true;
}

G.requestLoadout = requestLoadout;
G.holdRespawn = holdRespawn;
G.deploy = deploy;
G.respawnRemaining = respawnRemaining;

/* ===================================================== Matchstart in Schritten (G18) */

// Der Aufbau nach dem Laden der Karte (Viewmodel, Bots, HUD, Shader) lief als ein einziger Block
// (erstes Match ≈ 1,3 s Hauptthread-CPU am Desktop, auf Telefonen sekundenlang stehender Ladebalken).
// Jetzt füllen matchAssetJobs()/runJobs() die Caches der Modelle/Soldaten in kleinen Schritten – parallel
// zum Kartenaufbau, dessen Worker-Phasen den Hauptthread frei lassen –, runStart() trennt die übrigen
// Phasen durch Bildpausen und warmUp() kompiliert die Shader teilbaumweise.

const yieldPort = typeof MessageChannel === 'function' ? new MessageChannel() : null;
const yieldQueue = [];
if (yieldPort) yieldPort.port1.onmessage = () => { const resolve = yieldQueue.shift(); if (resolve) resolve(); };

/** Weiter in einer neuen Aufgabe der Ereignisschleife (ungedrosselt, auch im verborgenen Tab). */
function nextTask() {
  return new Promise((resolve) => {
    if (!yieldPort) { setTimeout(resolve, 0); return; }
    yieldQueue.push(resolve);
    yieldPort.port2.postMessage(0);
  });
}

/** Weiter nach dem nächsten gezeichneten Bild (Ladebalken bewegt sich); im verborgenen Tab ruht rAF → nextTask(). */
function nextFrame() {
  if (document.hidden) return nextTask();
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 100); // Tab wird gerade verborgen
  });
}

const warmed = new Set(); // erledigte Vorarbeiten ('m:<Modell>:<LOD>', 's:<Schema>:<Variante>:<Qualität>')
const mapSchemes = new Map(); // mapId → { B, ffa }: Tarnschemata der Bots auf dieser Karte (nach dem ersten Laden bekannt)

/**
 * Vorarbeiten für ein Match als kleine Einzelschritte (je ein Waffen-Template bzw. ein Soldat aus
 * Variante × Schema mit allen Detailstufen, Material und Tarntextur). Nur öffentliche APIs:
 * `models.preloadWeaponModels([key], [lod])` (Ego-Modelle der Ausrüstung – in gun/training aller Waffen –
 * sowie Messer/Granaten; Drittperson-Modelle der Bot-Ausrüstungen) und `createSoldier(...).dispose()`
 * (bots/character.js; Geometrie-, Material- und Textur-Caches bleiben). Die Tarnschemata der Gegner bzw.
 * im FFA hängen von der Karte ab (helle Karten): ohne `world` nur, wenn die Karte schon einmal geladen war.
 */
function matchAssetJobs(cfg, world) {
  const jobs = [];
  const W = G.data.WEAPONS || {};
  const EQ = G.data.EQUIPMENT || {};
  const models = G.modules.models;
  const soldiers = G.modules.soldiers;
  const modelOf = (id) => (W[id] && W[id].model) || (EQ[id] && EQ[id].model) || null;
  const seen = new Set();
  const add = (k, fn) => {
    if (warmed.has(k) || seen.has(k)) return;
    seen.add(k);
    jobs.push(() => { fn(); warmed.add(k); });
  };
  const addModel = (key, lod) => {
    if (key && models && typeof models.preloadWeaponModels === 'function') add(`m:${key}:${lod}`, () => models.preloadWeaponModels([key], [lod]));
  };
  const allWeapons = cfg.modeId === 'gun' || cfg.modeId === 'training';
  // Ego: Ausrüstung (gun/training: alle Waffen, siehe WeaponController.warmup) + Requisiten des Viewmodels
  const own = allWeapons ? Object.keys(W) : [cfg.loadout.primary, cfg.loadout.secondary];
  for (const id of [...own, 'knife', 'frag', 'semtex']) addModel(modelOf(id), 'first');
  // Ego: einmalige Viewmodel-Texturen (Ärmel-Tarnmuster des Teams, Stoff, Mündungsfeuer …), weapons/viewmodel.js
  const vm = G.modules.viewmodel;
  if (vm && typeof vm.viewModelWarmupSteps === 'function') {
    const team = cfg.ffa ? null : 'A';
    vm.viewModelWarmupSteps({ team, world }).forEach((fn, i) => add(`v:${team || 'ffa'}:${i}`, fn));
  }
  // Bots: Drittperson-Modelle ihrer Ausrüstungen (gun: alle Stufen) + Requisiten (Granate, Messer)
  const bots = (cfg.allies | 0) + (cfg.enemies | 0);
  if (bots > 0) {
    const ids = new Set(['knife', 'frag']);
    if (allWeapons) for (const id of Object.keys(W)) ids.add(id);
    else {
      for (const l of G.data.DEFAULT_LOADOUTS || []) { ids.add(l.primary); ids.add(l.secondary); ids.add(l.lethal); }
      for (const id of Object.keys(W)) if (W[id].cls === 'sniper') ids.add(id); // ein Scharfschütze je Seite
    }
    for (const id of ids) addModel(modelOf(id), 'third');
  }
  // Effekte: Partikel- und Einschuss-Atlas (erstes Effects.attach)
  const fx = G.modules.fxtex;
  if (fx && typeof fx.getParticleAtlas === 'function') add('fx:particles', () => fx.getParticleAtlas());
  if (fx && typeof fx.getDecalAtlas === 'function') add('fx:decals', () => fx.getDecalAtlas());
  // Soldaten je Schema × Variante (alle Varianten: welche ein Team bekommt, entscheidet BotManager zufällig;
  // je Kombination ≈ 1,7 MB Geometrie). FFA auf 'low' (Telefone): 4–5 Schemata × 8 wären ≈ 60 MB → je Schema
  // nur eine Variante (Tarntextur + Material, der teure Teil); die übrigen Geometrien baut spawnBots.
  const soldierApi = soldiers && typeof soldiers.createSoldier === 'function' && Array.isArray(soldiers.VARIANTS) &&
    typeof soldiers.schemeForTeam === 'function' && typeof soldiers.ffaSchemes === 'function';
  if (bots > 0 && soldierApi) {
    let map = mapSchemes.get(cfg.mapId);
    if (world) mapSchemes.set(cfg.mapId, (map = { B: soldiers.schemeForTeam('B', world), ffa: soldiers.ffaSchemes(world) }));
    const schemes = [];
    if (cfg.ffa) { if (map) schemes.push(...map.ffa); }
    else {
      if (cfg.allies > 0) schemes.push(soldiers.schemeForTeam('A', world));
      if (cfg.enemies > 0 && map) schemes.push(map.B);
    }
    const quality = G.renderer.quality === 'low' ? 'low' : 'high';
    const n = soldiers.VARIANTS.length;
    const lean = cfg.ffa && quality === 'low';
    schemes.forEach((scheme, i) => {
      for (let v = lean ? i % n : 0; v < (lean ? (i % n) + 1 : n); v++) {
        add(`s:${scheme}:${v}:${quality}`, () => soldiers.createSoldier({ team: scheme === 'A' ? 'A' : 'B', variant: v, camo: scheme, quality }).dispose());
      }
    });
  }
  return jobs;
}

/**
 * Führt Vorarbeiten in Zeitscheiben aus (≈ 8 ms, dann ein Bild Pause). Bricht ab, sobald der Start
 * nicht mehr aktuell ist. Fehler einzelner Schritte werden gemeldet; der Matchaufbau baut dann selbst.
 */
async function runJobs(jobs, live) {
  let t = performance.now();
  for (const job of jobs) {
    if (!live()) return;
    safe('prepareMatchAssets', job);
    if (performance.now() - t > 8) {
      await nextFrame();
      t = performance.now();
    }
  }
}

// Lobby: dieselben Vorarbeiten im Leerlauf – für die wahrscheinliche Konfiguration (URL-Parameter bzw.
// letzte Wahl, damit ist die Lobby vorbelegt), je Leerlauf-Rückruf ein Schritt und nur, solange seit 1,5 s
// keine Eingabe kam (ein Schritt kann ein Bild verzögern). Was übrig bleibt, erledigt der Ladebildschirm.
let lastInputAt = 0;
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(type, () => { lastInputAt = performance.now(); }, { passive: true, capture: true });
}
const onIdle = typeof requestIdleCallback === 'function'
  ? (fn) => requestIdleCallback(fn)
  : (fn) => setTimeout(() => fn({ timeRemaining: () => 10 }), 250);
let lobbyWarm = null; // { jobs } solange die Lobby-Vorarbeit läuft

function scheduleLobbyPrewarm() {
  if (lobbyWarm) return;
  const run = (lobbyWarm = { jobs: null });
  const tick = (deadline) => {
    if (lobbyWarm !== run) return;
    if (G.match.state !== 'lobby') { lobbyWarm = null; return; }
    if (document.hidden || performance.now() - lastInputAt < 1500 || deadline.timeRemaining() < 10) {
      setTimeout(() => onIdle(tick), 300);
      return;
    }
    if (!run.jobs) run.jobs = safe('lobbyPrewarm', () => matchAssetJobs(normalizeConfig(configFromParams()), null)) || [];
    const job = run.jobs.shift();
    if (!job) { lobbyWarm = null; return; }
    safe('prepareMatchAssets', job);
    onIdle(tick);
  };
  setTimeout(() => onIdle(tick), 1500);
}

/**
 * Startet ein Match (Lobby „Einsatz starten“, Revanche, autostart). Läuft bereits ein Start, wird dieser
 * abgebrochen und danach mit der neuen Konfiguration begonnen (nichts geht verloren, nichts startet doppelt).
 */
function startMatch(config) {
  // Direkt aus dem Klick-Handler → Nutzergeste für Audio, Pointer-Lock bzw. Vollbild
  safe('audio.unlock', () => { const p = G.audio.unlock(); if (p && typeof p.catch === 'function') p.catch(() => {}); });
  if (G.input.mode === 'desktop' && !G.input.allowUnlockedMouse) G.input.requestLock();
  else if (G.input.mode === 'touch') enterLandscape();
  const key = configKey(config);
  if (startTask) {
    if (key === startingKey && !queuedConfig) return startTask; // derselbe Start läuft schon (Doppelklick)
    matchGen += 1;
    queuedConfig = config;
    return startTask;
  }
  matchGen += 1;
  startingKey = key;
  const gen = matchGen;
  startTask = runStart(config, gen).finally(() => {
    startTask = null;
    startingKey = null;
    if (queuedConfig) {
      const next = queuedConfig;
      queuedConfig = null;
      startMatch(next);
    }
  });
  return startTask;
}

async function runStart(config, gen) {
  const live = () => gen === matchGen;
  try {
    const cfg = normalizeConfig(config);
    const reuse = !!(G.world && G.world.id === cfg.mapId);
    await teardownMatch({ keepWorld: reuse });
    if (!live()) return;
    applyAutoTier();
    G.lastConfig = cfg;
    Object.assign(G.match, {
      modeId: cfg.modeId, mapId: cfg.mapId, difficulty: cfg.difficulty, allies: cfg.allies, enemies: cfg.enemies,
      loadout: { ...cfg.loadout }, ffa: cfg.ffa, timeLimit: cfg.timeLimit, scoreLimit: cfg.scoreLimit,
      startedAt: null, startedReal: null, countdown: 0, pausedFrom: null, endedAt: null, result: null,
      unranked: isUnranked(cfg),
      style: cfg.style, crosshair: cfg.crosshair, matchLength: cfg.matchLength, timeOfDay: cfg.timeOfDay, cls: cfg.loadout.cls || null, // modes-ui
    });
    settings.patch({ lastMode: cfg.modeId, lastMap: cfg.mapId, difficulty: cfg.difficulty, lastLoadout: cfg.loadout, lastClass: cfg.loadout.cls || 'sturm' });
    applyStyle(cfg); // core-mechanics: G.match.style/styleFlags/armor
    setState('loading');
    G.menus.showLoading(0);
    safe('hud.hide', () => G.hud.hide());

    vmBase = new Set(G.viewmodel.scene.children);
    const onProgress = (p) => { if (live()) safe('menus', () => G.menus.showLoading(Math.min(0.85, p * 0.85))); };
    const nextStep = async (p) => {
      await nextFrame();
      if (live()) safe('menus', () => G.menus.showLoading(p));
      return live();
    };
    if (reuse) {
      onProgress(1);
      if (dynres) dynres.reset();
    } else {
      sceneBase = new Set(G.scene.children);
      // Vorarbeiten ohne Kartenbezug laufen in den Pausen des Kartenaufbaus (Worker-Phasen) mit
      const early = runJobs(matchAssetJobs(cfg, null), live);
      const world = await G.modules.world.loadWorld(G, cfg.mapId, { onProgress });
      if (!world) throw new Error(`loadWorld(${cfg.mapId}) lieferte keine Welt`);
      G.world = world;
      safe('renderer.setMood', () => { G.renderer.setMood?.(world.grade || cfg.mapId); G.renderer.setSun?.(world.lighting); }); // core-render: LUT/Belichtung/Lichtstrahlen je Karte
      if (world.group && !world.group.parent) G.scene.add(world.group);
      if (dynres) { dynres.reset(); G.renderer.setResolutionScale(renderScaleValue(settings.get('renderScale')) || 1); }
      await early;
      // Abgebrochen (neuer Start/Lobby): Welt stehen lassen – der Nachfolger entscheidet (gleiche Karte → wiederverwenden)
      if (!live()) { await teardownMatch({ keepWorld: true }); return; }
    }
    // Restliche Vorarbeiten (Tarnschemata dieser Karte; bei einer Revanche meist nichts mehr)
    await runJobs(matchAssetJobs(cfg, G.world), live);
    if (!(await nextStep(0.86))) { await teardownMatch({ keepWorld: true }); return; }

    G.combat.attach(G);
    G.weapons.attach(G);
    G.effects.attach(G); // erstes Match: Partikel-/Decal-Schichten und ihre Texturen
    if (!(await nextStep(0.865))) { await teardownMatch({ keepWorld: true }); return; }
    G.audio.attach(G);
    audioAttached = true;

    const opts = {
      timeLimit: cfg.timeLimit ?? undefined, scoreLimit: cfg.scoreLimit ?? undefined,
      time: cfg.timeLimit ?? undefined, score: cfg.scoreLimit ?? undefined,
      difficulty: cfg.difficulty, allies: cfg.allies, enemies: cfg.enemies, mapId: cfg.mapId,
    };
    G.mode = G.modules.modes.createMode(G, cfg.modeId, opts);
    G.mode.attach(G);
    if (!(await nextStep(0.87))) { await teardownMatch({ keepWorld: true }); return; }

    // Spieler + Viewmodel (Arme, Waffen, Viewmodel-Shader)
    G.player.resetForMatch({ team: cfg.ffa ? null : 'A', loadout: cfg.loadout, name: settings.get('playerName') });
    G.player.godMode = DEV_GOD;
    if (DEV_TIMESCALE) G.timeScale = DEV_TIMESCALE;
    G.camera = G.player.camera;
    G.actors.length = 0;
    G.actors.push(G.player);
    if (!(await nextStep(0.88))) { await teardownMatch({ keepWorld: true }); return; }

    G.bots.attach(G);
    const bots = G.bots.spawnBots({ allies: cfg.allies, enemies: cfg.enemies, ffa: cfg.ffa, difficulty: cfg.difficulty, modeId: cfg.modeId }) || [];
    for (const b of bots) if (!G.actors.includes(b)) G.actors.push(b);
    for (const a of G.actors) spawnActor(a);
    if (!(await nextStep(0.9))) { await teardownMatch({ keepWorld: true }); return; }

    safe('vehicles.attach', () => G.vehicles.attach(G)); // vehicles: Spawns aus world.vehicleSpawns bzw. ?vehicles=1
    G.hud.attach(G);
    safe('audio.startAmbience', () => G.audio.startAmbience(G.world.ambience));
    G.mode.start();
    if (!(await nextStep(0.92))) { await teardownMatch({ keepWorld: true }); return; }
    await warmUp(live);
    if (!live()) { await teardownMatch({ keepWorld: true }); return; }
    G.menus.showLoading(1);
    G.matchCount += 1;
    G.menus.hideAll();
    G.hud.show();
    beginCountdown();
  } catch (err) {
    if (live()) showFatal(err && (err.moduleKey || isFetchError(err)) ? 'module' : 'match', err);
    else console.error('[NULLPUNKT] Abgebrochener Matchstart:', err);
  }
}

const isRenderable = (o) => !!(o.isMesh || o.isSprite || o.isPoints || o.isLine);

/**
 * Teilbäume zum einzelnen Kompilieren: ohne Lichtquelle (three.js zählt die Lichter eines kompilierten Teilbaums
 * sonst doppelt zu denen der Zielszene) und mit höchstens `max` Zeichenobjekten (feinere Zeitscheiben); größere
 * Gruppen werden in ihre Kinder zerlegt. Ein Zeichenobjekt mit Licht darunter bleibt für den Gesamtdurchlauf.
 */
function compileParts(root, out, max = 32) {
  for (const child of root.children) {
    let lit = false;
    let n = 0;
    child.traverse((o) => { if (o.isLight) lit = true; else if (isRenderable(o)) n++; });
    if (!n) continue;
    if (!lit && (n <= max || isRenderable(child) || !child.children.length)) out.push(child);
    else compileParts(child, out, max);
  }
  return out;
}

/**
 * Shader vorkompilieren, damit der erste Schuss nicht ruckelt – in Zeitscheiben: Teilbäume der Szene und des
 * Viewmodels einzeln (Lichter aus der jeweiligen Zielszene), dazwischen Bildpausen. Ohne
 * KHR_parallel_shader_compile werden die neuen Programme je Teilbaum fertig gelinkt (`getUniforms()` wartet
 * wie das erste Zeichnen auf den Linker), damit diese Wartezeiten nicht gesammelt im ersten Bild anfallen.
 * Danach ein Durchgang über die ganzen Szenen (nur noch Treffer im Programmcache; fängt Objekte unter einem
 * Licht ab) und ein Bild, das sichtbare Geometrien/Texturen hochlädt (Texturen nicht vorab: Atlanten der Welt
 * werden erst beim Hochladen gezeichnet – das bleibt bei dem Bild, das sie braucht).
 */
async function warmUp(live = () => true) {
  const r = G.renderer.renderer;
  const parallel = typeof r.compileAsync === 'function' && !!r.extensions && r.extensions.has('KHR_parallel_shader_compile');
  const settled = new Set();
  const settle = (materials) => {
    if (parallel) return;
    for (const m of materials) {
      if (settled.has(m)) continue;
      settled.add(m);
      const program = r.properties.get(m).currentProgram;
      if (program && typeof program.getUniforms === 'function') program.getUniforms();
    }
  };
  try {
    G.player._updateCamera(0);
    const passes = [[G.scene, G.camera], [G.viewmodel.scene, G.viewmodel.camera]];
    let t = performance.now();
    for (const [scene, camera] of passes) {
      for (const part of compileParts(scene, [])) {
        settle(r.compile(part, camera, scene));
        if (performance.now() - t > 12) {
          await nextFrame();
          if (!live()) return;
          t = performance.now();
        }
      }
    }
    // compileAsync nur mit KHR_parallel_shader_compile (sonst warnt three.js) – sonst synchron
    if (parallel) {
      const jobs = passes.map(([scene, camera]) => r.compileAsync(scene, camera));
      await Promise.race([Promise.all(jobs), new Promise((res) => setTimeout(res, 4000))]);
    } else {
      for (const [scene, camera] of passes) settle(r.compile(scene, camera));
    }
    await nextFrame();
    if (!live()) return;
    G.menus.showLoading(0.97);
    G.renderer.compilePost?.(); // core-render: Objektiv/Grade/Belichtung (auch EASU für spätere Skalen < 1)
    G.renderer.render(G.scene, G.camera, G.viewmodel.scene, G.viewmodel.camera);
  } catch (err) {
    console.warn('[NULLPUNKT] Shader-Vorbereitung:', err);
  }
}

/** Gerät hochkant (Telefon) oder Tab verborgen → Match darf nicht ungesehen weiterlaufen. */
const mustHold = () => document.hidden || portraitMQ.matches;

function beginCountdown() {
  G.match.countdown = 3;
  G._countShown = 3;
  setState('countdown');
  G.events.emit('match:countdown', { value: 3 });
  // Während des Ladens gedreht/versteckt: sofort pausieren (sonst läuft das Match hinter dem Hinweis)
  if (mustHold()) pause();
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
    G.match.startedReal = G.time.real;
    G.events.emit('match:start', { modeId: G.match.modeId, mapId: G.match.mapId });
  }
}

function endMatch(result) {
  const st = G.match.state;
  if (st === 'ended' || !G.mode || (st !== 'playing' && st !== 'countdown' && st !== 'paused')) return;
  const res = result || G.mode.result || null;
  G.match.result = res;
  G.match.endedAt = G.time.elapsed;
  if (G.player && G.player.godMode) G.match.unranked = true;
  setState('ended');
  G.input.exitLock();
  let progression = null;
  // Ungewertete Matches (Gottmodus, Zeitraffer, Debug-Hilfen) geben keine EP
  if (res && res.playerSummary && !G.match.unranked) {
    try {
      progression = profile.recordMatch({ difficulty: G.match.difficulty, ...res.playerSummary });
    } catch (err) {
      console.error('[NULLPUNKT] profile.recordMatch:', err);
    }
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

/**
 * Match abbauen. keepWorld: Welt (Geometrie, Kollision, Navigation, Licht) bleibt für eine Revanche auf
 * derselben Karte stehen – alles Match-Bezogene (Bots, Effekte, Modus, Granaten …) wird trotzdem entfernt.
 */
async function teardownMatch({ keepWorld = false } = {}) {
  G._endScreenAt = null;
  const banner = $('match-banner');
  if (banner) banner.hidden = true;
  safe('input', () => G.input.releaseAll());
  safe('hud', () => { G.hud.hide(); G.hud.detach(); });
  safe('mode', () => { if (G.mode) G.mode.detach(); });
  G.mode = null;
  safe('vehicles', () => G.vehicles.detach()); // vehicles: Insassen aussteigen lassen, vor Bots/Spieler/Welt
  safe('bots', () => { G.bots.removeAll(); G.bots.detach(); });
  safe('player', () => G.player.endMatch());
  safe('audio', () => { G.audio.stopAmbience(); G.audio.detach(); });
  audioAttached = false;
  safe('effects', () => G.effects.detach());
  safe('weapons', () => G.weapons.detach());
  safe('combat', () => G.combat.detach());
  if (G.world && !keepWorld) {
    const world = G.world;
    safe('world', () => {
      const grp = world.group;
      world.dispose();
      if (grp && grp.parent) grp.parent.remove(grp);
    });
    G.world = null;
  }
  G.actors.length = 0;
  if (sceneBase) {
    const keep = new Set(sceneBase);
    if (G.world && G.world.group) keep.add(G.world.group);
    sweep(G.scene, keep);
  }
  if (vmBase) sweep(G.viewmodel.scene, vmBase);
  if (!G.world) {
    G.scene.environment = null;
    G.scene.background = null;
    G.scene.fog = null;
  }
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
    if ((o.isInstancedMesh || o.isSkinnedMesh) && typeof o.dispose === 'function') safe('dispose', () => o.dispose());
  });
}

/**
 * WebGL-Kontextverlust: alle GPU-Ressourcen der Szenen jetzt freigeben. Auf einem verlorenen Kontext sind die
 * delete-Aufrufe stumme No-ops und lösen die three.js-Dispose-Listener vom alten Kontext; nach der
 * Wiederherstellung lädt three.js alles aus den CPU-Daten neu hoch. Ohne das würde ein späteres dispose()
 * (Matchende) hunderte „object does not belong to this context“-Warnungen erzeugen.
 */
function releaseLostContext() {
  const seen = new Set();
  const once = (x) => { if (!x || seen.has(x)) return false; seen.add(x); return true; };
  for (const scene of [G.scene, G.viewmodel.scene]) {
    scene.traverse((o) => {
      if (once(o.geometry) && typeof o.geometry.dispose === 'function') o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (!once(m)) continue;
        for (const v of Object.values(m)) if (v && v.isTexture && !v.isRenderTargetTexture && once(v)) v.dispose();
        m.dispose();
      }
      if (o.isInstancedMesh && typeof o.dispose === 'function') o.dispose();
      if (o.isSkinnedMesh && o.skeleton && once(o.skeleton)) o.skeleton.dispose();
      // Schattenkarten sind reine GPU-Ziele (Inhalt ohnehin verloren): freigeben, three.js legt sie neu an
      if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    });
    const bg = scene.background;
    if (bg && bg.isTexture && !bg.isRenderTargetTexture && once(bg)) bg.dispose();
  }
  safe('renderLists', () => G.renderer.renderer.renderLists.dispose());
}

function pause() {
  const st = G.match.state;
  if (st !== 'playing' && st !== 'countdown') return;
  G.match.pausedFrom = st;
  setState('paused');
  G.input.exitLock();
  safe('menus.showPause', () => G.menus.showPause());
}

/** Desktop braucht den Pointer-Lock zum Zielen: erst mit Sperre wird weitergespielt. */
const lockRequired = () => G.input.mode === 'desktop' && !G.input.allowUnlockedMouse && typeof G.canvas.requestPointerLock === 'function';

/**
 * Fortsetzen (Menü-Knopf, Esc im Pausenmenü, Gamepad). Auf dem Desktop bleibt das Match pausiert, bis der
 * Pointer-Lock wirklich sitzt: Chrome lehnt eine erneute Sperre kurz nach Esc bzw. ohne Nutzergeste ab.
 * Dann erscheint „Klicken, um weiterzuspielen“ – ein Klick holt die Sperre und setzt fort, Esc öffnet
 * wieder das Pausenmenü.
 */
function resume() {
  if (G.match.state !== 'paused' || portraitMQ.matches) return;
  if (G.input.mode === 'touch') enterLandscape();
  if (lockRequired() && !G.input.locked) {
    safe('menus.hideAll', () => G.menus.hideAll());
    setAwaitingLock(true);
    G.input.requestLock().then((locked) => { if (locked) finishResume(); });
    return;
  }
  finishResume();
}

function finishResume() {
  if (G.match.state !== 'paused') return;
  setAwaitingLock(false);
  safe('menus.hideAll', () => G.menus.hideAll());
  setState(G.match.pausedFrom || 'playing');
}

function setAwaitingLock(on) {
  on = !!on;
  if (G.match.awaitingLock === on) return;
  G.match.awaitingLock = on;
  document.body.classList.toggle('np-await-lock', on);
  updateLockHint();
}

/** Vollbild + Querformat-Sperre (nur aus einer Nutzergeste heraus wirksam; Fehler werden ignoriert). */
function enterLandscape() {
  const el = document.documentElement;
  const lock = () => {
    const o = screen.orientation;
    if (o && typeof o.lock === 'function') return o.lock('landscape').catch(() => {});
    return undefined;
  };
  try {
    if (document.fullscreenElement) { lock(); return; }
    if (!document.fullscreenEnabled || !el.requestFullscreen) return;
    // Ohne Nutzeraktivierung (z. B. autostart) lehnt der Browser mit Konsolenwarnung ab → gar nicht erst versuchen
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    el.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
  } catch { /* nicht unterstützt (z. B. iOS-Safari auf dem iPhone) */ }
}

async function toLobby() {
  matchGen += 1; // laufenden Start abbrechen
  queuedConfig = null;
  if (startTask) await startTask;
  await teardownMatch();
  setState('lobby');
  safe('menus.showLobby', () => G.menus.showLobby());
}

function restart() {
  const cfg = G.lastConfig;
  return startMatch(cfg ? { ...cfg, loadout: { ...cfg.loadout } } : configFromParams());
}

/* ===================================================== Qualität + dynamische Auflösung */

let dynres = null;
const stepUps = new Set(); // Stufen, auf die 'auto' in dieser Sitzung schon einmal zurückgekehrt ist

/** Qualitätswechsel (Einstellungen, Debug-API, automatisch zwischen Matches) – alle Wege enden hier. */
function applyQuality(q) {
  G.renderer.setQuality(q);
  return G.renderer.quality;
}

/**
 * Wird bei jedem Wechsel vom Renderer gerufen (auch für fremde Aufrufer von renderer.setQuality).
 * Die Welt abonniert onQualityChange selbst (world/index.js → world.setQuality: Sonnenschatten an/aus, Größe);
 * Viewmodel und Effekte ebenso.
 */
function onQualityChanged() {
  applyQualityClasses();
  setTimeout(prewarmShaders, 0); // nach den übrigen Abonnenten (Schattenzustand der Welt)
}

let prewarming = false;
/** Neue Shader im Hintergrund kompilieren (nur mit KHR_parallel_shader_compile; sonst beim nächsten Bild). */
function prewarmShaders() {
  const r = G.renderer.renderer;
  if (prewarming || !G.world || !G.camera || typeof r.compileAsync !== 'function' || !r.extensions || !r.extensions.has('KHR_parallel_shader_compile')) return;
  prewarming = true;
  Promise.all([r.compileAsync(G.scene, G.camera), r.compileAsync(G.viewmodel.scene, G.viewmodel.camera)])
    .catch(() => {})
    .finally(() => { prewarming = false; });
}

/**
 * quality 'auto': Stufenwechsel nur zwischen Matches (beim Laden kompilieren die Shader ohnehin).
 * Runter, wenn im letzten Match selbst die Mindestauflösung nicht reichte; einmal je Stufe wieder hoch,
 * wenn das letzte Match durchgehend Reserve hatte.
 */
function applyAutoTier() {
  if (!dynres) return;
  const R = G.renderer;
  if (QUALITY_OVERRIDE || settings.get('quality') !== 'auto') { dynres.wantTierDrop = false; return; }
  const idx = QUALITY_LEVELS.indexOf(R.quality);
  let next = null;
  if (dynres.wantTierDrop && idx > 0) next = QUALITY_LEVELS[idx - 1];
  else if (G.matchCount > 0 && idx < QUALITY_LEVELS.indexOf(resolveQuality('auto')) && dynres.stepUpOk() && !stepUps.has(QUALITY_LEVELS[idx + 1])) {
    next = QUALITY_LEVELS[idx + 1];
    stepUps.add(next);
  }
  dynres.wantTierDrop = false;
  if (!next) return;
  if (DEBUG) console.info(`[NULLPUNKT] Automatische Qualität: ${R.quality} → ${next}`);
  applyQuality(next);
  R.setResolutionScale(1);
}

function updatePerf(now, workMs, rawMs) {
  // Feste Auflösungsskala (Einstellung renderScale) statt dynamischer Auflösung
  const fixed = renderScaleValue(settings.get('renderScale'));
  if (fixed) { if (Math.abs(G.renderer.resolutionScale - fixed) > 1e-3) G.renderer.setResolutionScale(fixed); return; }
  if (!dynres || QUALITY_OVERRIDE || G.match.startedReal == null || G.time.real - G.match.startedReal < 3) return;
  const cap = fpsLimitValue(settings.get('fpsLimit'));
  dynres.touch = G.input.mode === 'touch' || (cap > 0 && cap <= 30); // Ziel 30 FPS auf Touch (bzw. bei 30er-Begrenzung), 60 auf Desktop
  dynres.frame(now, rawMs, workMs);
  const R = G.renderer;
  const auto = settings.get('quality') === 'auto';
  const idx = QUALITY_LEVELS.indexOf(R.quality);
  const canDropTier = auto && idx > 0;
  dynres.update(now, R, { floor: canDropTier ? 0.7 : 0.55, canDropTier });
}

/* ===================================================== Schleife */

let lastNow = 0;
let idleRenderAt = 0;

let capAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // Bildratenbegrenzung (Einstellung fpsLimit): Bilder auslassen; die Zeit läuft im nächsten Bild weiter
  const cap = fpsLimitValue(settings.get('fpsLimit'));
  if (cap) {
    if (now < capAt - 1.5) return;
    capAt += 1000 / cap; // Takt halten (bei 144 Hz und 60er-Grenze im Mittel 60 Bilder)
    if (capAt < now) capAt = now + 1000 / cap; // zurückgefallen (Pause, Hintergrund): neu ansetzen
  }
  const t0 = performance.now();
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
    if (G.timeScale !== 1 || (G.player && G.player.godMode)) G.match.unranked = true;
    if (st === 'countdown') tickCountdown(Math.min(raw, 0.25) * G.timeScale); // Echtzeit, nicht Simulationszeit
    step('input', () => G.input.update(dt));
    if (G.input.pressed('pause') && G.match.state !== 'paused') pause();
    step('player', () => (G.player.vehicle ? G.vehicles.updateOccupant(G.player, dt) : G.player.update(dt))); // vehicles: Sitz statt Laufen
    step('bots', () => G.bots.update(dt));
    if (st === 'playing') step('separate', () => separateActors(G.actors));
    step('vehicles', () => G.vehicles.update(dt));
    step('armor', () => G.combat.tickArmor(G.actors)); // core-mechanics: Platten fertig einsetzen, Bots setzen selbst ein
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
  if (st === 'playing' && G.match.state === 'playing') updatePerf(G.time.real, performance.now() - t0, raw * 1000);
}

function updateRespawns() {
  const mode = G.mode;
  const now = G.time.elapsed;
  // Respawn-Halt (Ausrüsten im Todesbildschirm): Restzeit des Spielers steht still
  const p = G.player;
  if (G.match.respawnHold && p && !p.alive && p.respawnAt != null) p.respawnAt += G.time.dt;
  for (const a of G.actors) {
    if (a.alive || a.respawnAt == null || now < a.respawnAt) continue;
    if (a === p && G.match.respawnHold) continue;
    if (mode && typeof mode.canRespawn === 'function' && mode.canRespawn(a) === false) continue;
    spawnActor(a);
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
    const missing = Object.entries(G.moduleStatus).filter(([, v]) => v !== 'real').map(([k]) => k);
    const p = dynres ? dynres.stats : null;
    text += `\n${i.drawCalls} Draw Calls · ${(i.triangles / 1000).toFixed(1).replace('.', ',')}k Dreiecke\n${i.quality} · ${i.width}×${i.height} @${i.pixelRatio} · Skala ${String(i.resolutionScale).replace('.', ',')}\n` +
      `${G.match.state} · ${G.actors.length} Akteure · Geo ${i.geometries} · Tex ${i.textures}` +
      (p && p.interval ? `\nArbeit ${String(p.work).replace('.', ',')} ms / ${String(p.interval).replace('.', ',')} ms${dynres.plateau ? ` · Plateau ${Math.round(dynres.plateau)}` : ''}` : '') +
      (i.post && i.post.mode !== 'direct' ? `\nBild ${i.post.style} · ${i.post.mode} · ${i.post.internal}→${i.post.output} (${i.post.upscaler}) · Pässe ${i.post.passes}${i.post.exposure != null ? ` · Bel. ×${String(i.post.exposure).replace('.', ',')}` : ''}` : '') +
      (missing.length ? `\nFehlt: ${missing.join(', ')}` : '');
  }
  statsEl.textContent = text;
}

function applyQualityClasses() {
  document.body.classList.toggle('np-css-vignette', G.renderer.cssVignette ?? !G.renderer.preset.grade);
  document.body.dataset.quality = G.renderer.quality;
}

function updateLockHint() {
  const el = $('lock-hint');
  if (!el || !G.input) return;
  const st = G.match.state;
  const lost = G.input.mode === 'desktop' && (st === 'playing' || st === 'countdown') && !G.input.locked && G.input.everLocked && !G.input.allowUnlockedMouse;
  el.hidden = !(lost || (G.match.awaitingLock && st === 'paused'));
}

/* ===================================================== Debug-API */

G.debugApi = {
  teleport(x, y, z) { G.player.body.teleport(new THREE.Vector3(x, y, z)); },
  godMode(on = true) { G.player.godMode = !!on; if (on) G.match.unranked = true; return G.player.godMode; },
  giveWeapon(id) {
    const def = G.data.WEAPONS && G.data.WEAPONS[id];
    const w = G.player.weapon;
    if (!def || !w) return false;
    const lo = { ...(G.player.loadout || {}) };
    if (def.slot === 'secondary') lo.secondary = id; else lo.primary = id;
    G.player.loadout = lo;
    w.setLoadout(lo);
    G.match.unranked = true;
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
    if (n) G.match.unranked = true;
    return n;
  },
  setTimeScale(s) { G.timeScale = clampTimeScale(s); return G.timeScale; },
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
    if (bots.length) G.match.unranked = true;
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
  setQuality(q) { return applyQuality(q); },
  state() {
    const p = G.player;
    const i = G.renderer ? G.renderer.info() : {};
    return {
      state: G.match.state, modeId: G.match.modeId, mapId: G.match.mapId, matchCount: G.matchCount,
      fps: i.fps, drawCalls: i.drawCalls, geometries: i.geometries, textures: i.textures, quality: i.quality,
      resolutionScale: i.resolutionScale, perf: dynres ? { ...dynres.stats, plateau: dynres.plateau, probing: !!dynres.probe, wantTierDrop: dynres.wantTierDrop } : null,
      actors: G.actors.length, alive: G.actors.filter((a) => a.alive).length,
      kills: G.combat ? G.combat.killCount : 0,
      player: p ? { alive: p.alive, health: Math.round(p.health), kills: p.stats.kills, deaths: p.stats.deaths, score: p.stats.score, weapon: p.weapon && p.weapon.currentDef ? p.weapon.currentDef.id : null, mag: p.weapon && p.weapon.current ? p.weapon.current.mag : null } : null,
      scores: G.mode ? G.mode.scores : null, timeLeft: G.mode ? G.mode.timeLeft : null,
      unranked: G.match.unranked, awaitingLock: G.match.awaitingLock,
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
  // core-render (R18): Kugeln am Kopf vorbei / Treffer → Unterdrückung; nahe Explosion → kurzes Ausbrennen
  G.events.on('bullet:whiz', ({ distance } = {}) => G.renderer.suppress?.(0.18 + 0.22 * Math.max(0, 1 - (Number(distance) || 1) / 2.2)));
  G.events.on('player:damaged', ({ amount } = {}) => G.renderer.suppress?.(Math.min(0.5, 0.12 + (Number(amount) || 0) / 120)));
  G.events.on('explosion', ({ position, radius } = {}) => {
    if (!position || !G.camera || !G.renderer.flash) return;
    const d = G.camera.position.distanceTo(position), r = (Number(radius) || 6) * 1.6;
    if (d < r) G.renderer.flash(0.35 * (1 - d / r) ** 2);
  });
  G.events.on('input:lock', ({ locked, error }) => {
    updateLockHint();
    const st = G.match.state;
    if (locked && G.match.awaitingLock && st === 'paused') { finishResume(); return; }
    // Nur ein echter Verlust der Sperre pausiert (nicht eine abgelehnte Anfrage, z. B. Chrome-Wartezeit nach Esc)
    if (!locked && !error && G.input.everLocked && G.input.mode === 'desktop' && (st === 'playing' || st === 'countdown')) pause();
  });
  G.events.on('input:mode', () => {
    updateLockHint();
    // Wechsel zu Touch/Gamepad während „Klicken, um weiterzuspielen“: keine Sperre mehr nötig
    if (G.match.awaitingLock && !lockRequired()) finishResume();
  });
  // „Klicken, um weiterzuspielen“: jeder Klick holt die Sperre (Nutzergeste), Esc zurück ins Pausenmenü
  document.addEventListener('mousedown', (e) => {
    if (!G.match.awaitingLock || G.match.state !== 'paused' || e.button !== 0) return;
    e.preventDefault();
    G.input.requestLock();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.defaultPrevented || !G.match.awaitingLock || G.match.state !== 'paused') return;
    e.preventDefault();
    setAwaitingLock(false);
    safe('menus.showPause', () => G.menus.showPause());
  });

  settings.onChange((key, value) => {
    G.events.emit('settings:change', { key, value });
    if (key === 'quality' && !QUALITY_OVERRIDE) {
      if (dynres) dynres.wantTierDrop = false;
      stepUps.clear();
      applyQuality(value);
    }
    if (key === 'playerName' && G.player) G.player.name = value;
    if (key === 'renderScale' && G.renderer) { // Erweitert-Grafik: sofort (auch in der Pause), „Dynamisch“ übernimmt ab hier
      const f = renderScaleValue(value);
      if (f) G.renderer.setResolutionScale(f); else if (dynres) dynres.clearSamples();
    }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  const onPortrait = () => { if (portraitMQ.matches) pause(); };
  if (portraitMQ.addEventListener) portraitMQ.addEventListener('change', onPortrait);
  wireRotateOverlay();
  window.addEventListener('beforeunload', (e) => {
    const st = G.match.state;
    if (st === 'playing' || st === 'paused' || st === 'countdown') { e.preventDefault(); e.returnValue = ''; }
  });
  G.renderer.onContextChange((kind) => {
    const el = $('context-lost');
    if (kind === 'lost') {
      safe('context', releaseLostContext);
      pause();
      if (el) el.hidden = false;
    } else if (el) el.hidden = true;
  });
  const fatalReload = document.querySelector('[data-fatal-reload]');
  if (fatalReload) fatalReload.addEventListener('click', () => location.reload());
}

/** Hochformat-Hinweis: „Im Querformat spielen“ (Vollbild + Ausrichtungssperre), wo der Browser das kann. */
function wireRotateOverlay() {
  const btn = $('rotate-play');
  const hint = $('rotate-hint');
  const o = window.screen && screen.orientation;
  const canLock = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen && o && typeof o.lock === 'function');
  if (btn) {
    btn.hidden = !canLock;
    btn.addEventListener('click', () => enterLandscape());
  }
  if (hint) hint.hidden = canLock;
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
  let phase = 'error';
  try {
    setBoot(0.02, 'Prüfe Grafik …');
    G.renderer = createRendererOrNull({ quality: QUALITY_OVERRIDE || settings.get('quality'), settings });
    if (!G.renderer) { showFatal('webgl'); return; }
    G.renderer.onQualityChange(onQualityChanged);
    if (G.renderer.onStyleChange) G.renderer.onStyleChange(applyQualityClasses); // Bildstil (core-render)
    if (DEBUG && G.renderer.exposure) G.renderer.exposure.track = true;
    applyQualityClasses();
    G.perf = dynres = new DynamicResolution({ touch: window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false });

    setBoot(0.06, 'Lade Module …');
    phase = 'module';
    await loadModules((p) => setBoot(0.06 + p * 0.66, 'Lade Module …'));
    phase = 'error';

    setBoot(0.75, 'Starte Systeme …');
    G.player = new Player(G);
    G.camera = G.player.camera;
    G.input = new Input(G);
    G.input.allowUnlockedMouse = AUTOSTART;
    G.input.attach(G);
    G.combat = new Combat(G);
    G.audio = createAudio();
    G.weapons = new G.modules.weapons.WeaponSystem(G);
    G.effects = new G.modules.effects.Effects(G);
    G.bots = new G.modules.bots.BotManager(G);
    G.vehicles = new G.modules.vehicles.VehicleSystem(G);
    G.hud = new G.modules.hud.HUD(G);
    G.menus = new G.modules.menus.Menus(G);
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
    showFatal(phase, err);
  }
}

bootstrap();
