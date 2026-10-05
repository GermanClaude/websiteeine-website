# NULLPUNKT — Architecture & Module Contract

This document is the binding contract between all modules. Every developer (human or agent)
works against these interfaces. If you must deviate, keep the documented API working
(add, don't break) and note the change in the "Changelog" section at the bottom.

## 0. Product

**NULLPUNKT** is (1) a minimal, distinctive, interactive website and (2) a browser
first‑person shooter in the spirit of *Call of Duty: Mobile* (fast TDM matches, bots,
scorestreaks, ADS, killfeed, minimap, mobile touch controls) — playable against bots.

- Everything static: plain HTML/CSS/JS, native ES modules, **no build step**, no CDN,
  no tracking, no cookies. Hosted on GitHub Pages. Only `localStorage` (keys prefixed `nullpunkt:`).
- Three.js r186 is vendored: `assets/vendor/three/three.module.min.js` and addons under
  `assets/vendor/three/addons/` (postprocessing, shaders, environments, utils, math (Octree,
  Capsule, SimplexNoise), objects (Sky), geometries, csm, capabilities, lines, curves, misc,
  modifiers, animation). Pages declare this import map **verbatim**:

```html
<script type="importmap">{"imports":{"three":"./assets/vendor/three/three.module.min.js","three/addons/":"./assets/vendor/three/addons/"}}</script>
```

- Language of all user-facing text: **German** (proper umlauts ä ö ü ß, „Anführungszeichen“).
  Code identifiers English; comments short (German or English).
- Fonts (self-hosted, `assets/css/fonts.css`): `Archivo NP` (variable: weight 100–900,
  width/`font-stretch` 62%–125% — use it kinetically), `JetBrains Mono NP` (variable 100–800),
  `Rajdhani NP` (500/600/700 — game HUD). Shared tokens in `assets/css/tokens.css`
  (`--np-black`, `--np-ink`, `--np-signal` #FF5B1F accent, `--np-ally` #38B6FF,
  `--np-enemy` #FF3B3B, `--np-gold`, fonts, easings). Both site and game link
  `fonts.css` + `tokens.css` first.
- Units: 1 unit = 1 meter, Y up, right-handed (three.js default). Yaw 0 looks toward −Z.

## 1. File layout & ownership

| Path | Owner | Purpose |
|---|---|---|
| `index.html`, `assets/css/site.css`, `assets/js/site/**` | site | The website |
| `spielen.html` | core | Game page shell |
| `assets/css/game.css` | ui (core creates base) | All game DOM styling (HUD, menus, touch UI) |
| `assets/js/shared/settings.js` | core | Settings store (shared site+game) |
| `assets/js/shared/profile.js` | core | Player profile, XP/levels, match history |
| `assets/js/shared/weapons.data.js` | ballistics (first version: data agent) | Weapon/equipment definitions (pure data) |
| `assets/js/shared/maps.data.js` | world | Map meta (pure data) |
| `assets/js/shared/modes.data.js` | ui (first version: data agent) | Game-mode + scorestreak meta (pure data) |
| `assets/js/game/stubs/**` | core | Temporary stubs (see §10a), removed at integration |
| `assets/js/game/main.js` | core | Bootstrap, game loop, match lifecycle wiring |
| `assets/js/game/engine/events.js` | core | EventBus |
| `assets/js/game/engine/renderer.js` | core | Renderer, quality presets, post-processing, viewmodel pass |
| `assets/js/game/engine/input.js` | core | Keyboard/mouse/pointer-lock/gamepad + **touch UI** |
| `assets/js/game/engine/physics.js` | core | `CapsuleBody` (shared by player + bots) |
| `assets/js/game/engine/audio.js` | audio | Procedural WebAudio SFX + ambience |
| `assets/js/game/engine/textures.js` | world | Procedural PBR materials |
| `assets/js/game/engine/effects.js` | ballistics | Particles, tracers, decals, explosions, muzzle flash (3rd person) |
| `assets/js/game/world/**` | world | Map builder, maps, collision, nav graph, lighting/sky |
| `assets/js/game/player.js` | core | First-person controller (Actor) |
| `assets/js/game/combat.js` | core | Hitscan resolution, damage, deaths, explosions |
| `assets/js/game/weapons/index.js`, `controller.js`, `grenades.js` | ballistics | Weapon logic |
| `assets/js/game/weapons/models.js`, `viewmodel.js` | gunsmith | Weapon 3D models (1st+3rd person, site viewer), arms + animations |
| `assets/js/game/bots/**` | bots | Soldier model, animation, AI, BotManager |
| `assets/js/game/modes/**` | ui | Mode logic + scorestreaks |
| `assets/js/game/ui/**` | ui | HUD, minimap, scoreboard, menus (lobby, pause, settings, end screen) |
| `tools/` | anyone | Dev tooling (`tools/shot.mjs` screenshot + console-error capture) |
| `dev/*.html` | anyone | Optional isolated dev harness pages (keep them working; small) |

Rule: edit files you own. If you need a change in another owner's file, make the
smallest possible surgical edit, re-read the file right before editing (others may be
editing concurrently), and mention it in the Changelog. Never rewrite another owner's file.
Never `git commit`/`push` — the coordinator does that.

## 2. Runtime overview

`spielen.html` loads `assets/js/game/main.js` (module). Flow:

1. Boot: settings, profile, renderer (on `#game-canvas`), input, audio, EventBus, HUD/menus.
2. **Lobby** (`ui/menus.js`): choose mode, map, difficulty, team sizes, loadout
   (primary, secondary, lethal). Pre-filled from URL params and last choice.
   The "Einsatz starten" button is the user gesture → `audio.unlock()` + `input.requestLock()`.
3. Load match: `loadWorld(G, mapId)` → spawn player + bots → mode.start() →
   3‑2‑1 countdown (`G.match.state = 'countdown'`) → `'playing'`.
4. Match end (score/time limit) → `'ended'`: end screen (result, scoreboard, XP,
   level progress, medals) → `profile.recordMatch()` → "Revanche" / "Lobby" / "Zur Website".
5. Pause (Esc / pointer-lock lost / pause button on touch) → `'paused'` menu
   (Fortsetzen, Einstellungen, Steuerung, Match verlassen). Bots are frozen while paused.

URL params of `spielen.html`: `mode` (tdm|ffa|dom|gun|training), `map` (hafen|altstadt|werk|range),
`diff` (rekrut|regulaer|veteran|elite), `allies`, `enemies` (bot counts),
`autostart=1` (skip lobby; used by tests; pointer lock optional), `debug=1` (stats overlay),
`quality` (low|medium|high|ultra) overrides setting for this session.

### 2.1 The game context `G`

`main.js` creates one object and exposes it as `window.__game` (always — used by tests):

```js
G = {
  THREE,                       // the three namespace
  canvas, renderer,            // renderer = object from createRenderer()
  scene,                       // main THREE.Scene
  camera,                      // == G.player.camera (PerspectiveCamera)
  viewmodel: { scene, camera },// separate scene+camera rendered on top (depth cleared); gunsmith fills it
  events,                      // EventBus
  settings, profile,           // shared stores
  input, audio, effects, combat,
  world,                       // World (after load) — see §6
  player,                      // Player (Actor)
  bots,                        // BotManager
  weapons,                     // WeaponSystem
  mode,                        // Mode instance (after start)
  hud, menus,
  actors: [],                  // all Actors (player + bots), maintained by main/BotManager
  match: { state: 'boot'|'lobby'|'loading'|'countdown'|'playing'|'paused'|'ended',
           modeId, mapId, difficulty, allies, enemies, loadout, startedAt, countdown },
  time:  { dt, elapsed, frame },// seconds; dt clamped to ≤ 1/20
  params,                      // URLSearchParams snapshot
  debug: false,
}
```

Frame order (in `main.js`), only while `state` is `countdown` or `playing`
(countdown: everything renders, but movement/firing are blocked):

```
input.update(dt)
player.update(dt)            // movement + its WeaponController (via weapons)
bots.update(dt)              // AI + their WeaponControllers
weapons.update(dt)           // projectiles/grenades
mode.update(dt)
world.update(dt, camera)
effects.update(dt)
hud.update(dt)
audio.update(dt)             // listener follows camera
renderer.render(scene, camera, viewmodel.scene, viewmodel.camera)
input.endFrame()
```

When paused/lobby/ended the loop keeps rendering (cheap) but skips simulation.

## 3. EventBus (`engine/events.js`)

```js
export class EventBus { on(name, fn) /* returns unsubscribe fn */; once(name, fn); off(name, fn); emit(name, payload); clear(); }
```

Canonical events (payload fields). Emitters in brackets.

| Event | Payload | Emitter |
|---|---|---|
| `match:state` | `{ state, prev }` | main |
| `match:countdown` | `{ value }` (3,2,1,0) | main |
| `match:start` | `{ modeId, mapId }` | main |
| `match:end` | `{ result }` (see §9) | mode → main |
| `actor:spawn` | `{ actor }` | main/mode |
| `actor:hit` | `{ target, attacker, amount, zone, dir, point, weaponId, explosive, killed }` | combat |
| `kill` | `{ victim, killer, weaponId, headshot, explosive, assisters, streak, firstBlood, longshot, revenge }` | combat |
| `score` | `{ actor, points, reason }` reason: 'kill','headshot','assist','capture','defend','streak','firstblood','longshot','revenge' | mode |
| `weapon:fire` | `{ actor, weaponId, origin, dir, suppressed }` | weapons |
| `weapon:dryfire` | `{ actor, weaponId }` | weapons |
| `weapon:reload` | `{ actor, weaponId, phase: 'start'|'insert'|'end', empty }` | weapons |
| `weapon:switch` | `{ actor, weaponId }` | weapons |
| `weapon:ads` | `{ actor, on }` | weapons |
| `impact` | `{ point, normal, surface, shooter, weaponId }` (world hit) | combat |
| `tracer` | `{ from, to, actor, weaponId }` | weapons |
| `grenade:throw` | `{ actor, position, velocity, type }` | weapons |
| `grenade:bounce` | `{ position, speed }` | weapons |
| `explosion` | `{ position, radius, attacker, type }` | combat |
| `footstep` | `{ actor, surface, sprint, crouch, position }` | player/bots |
| `player:jump` / `player:land` | `{ velocity }` | player |
| `player:damaged` | `{ amount, dir, attacker }` | combat |
| `player:regen` | `{ health }` | player |
| `streak:progress` | `{ actor, value }` | modes |
| `streak:ready` | `{ actor, streakId }` | modes |
| `streak:activate` | `{ actor, streakId }` | modes |
| `uav:state` | `{ team, active, until }` | modes |
| `objective:update` | `{ objectives }` | modes |
| `medal` | `{ actor, id, label }` | modes |
| `settings:change` | `{ key, value }` | settings (re-emitted by main) |
| `ui:sound` | `{ name }` | ui → audio |

Subsystems subscribe in their `attach(G)` method; they must also `detach()` cleanly
(unsubscribe) because matches are restarted without page reload.

## 4. Shared stores

### `shared/settings.js`
```js
export const DEFAULTS = {
  playerName: 'Operator', sensitivity: 1.0, adsSensitivity: 0.85, touchSensitivity: 1.0,
  invertY: false, fov: 80, quality: 'auto' /* auto|low|medium|high|ultra */,
  masterVolume: 0.8, sfxVolume: 1.0, musicVolume: 0.5, uiVolume: 0.7,
  crosshairStyle: 'cross' /* cross|dot|circle */, crosshairColor: '#ffffff',
  showFps: false, aimAssist: true /* touch only */, autoFire: false /* touch: fire when crosshair on enemy, COD-Mobile "simple mode" */,
  difficulty: 'regulaer', lastMode: 'tdm', lastMap: 'hafen', lastLoadout: null, reducedMotion: false,
};
export const settings = { get(k), set(k, v), patch(obj), all(), reset(), onChange(fn) /* returns unsubscribe */ };
// localStorage 'nullpunkt:settings'; tolerant to missing storage; also syncs via 'storage' event.
```

### `shared/profile.js`
```js
export const profile = {
  get(),                 // { name, xp, level, matches, wins, losses, draws, kills, deaths, assists, headshots,
                         //   shotsFired, shotsHit, playtime, bestStreak, longestKill, weaponStats:{[id]:{kills,shots,hits,headshots}},
                         //   modeStats:{[modeId]:{matches,wins}}, medals:{[id]:count}, history:[≤25 most recent match summaries] }
  recordMatch(summary),  // summary = §9 playerSummary → returns { xpGained, levelBefore, levelAfter, xpBefore, xpAfter, unlocked:[ids] }
  levelFor(xp), xpForLevel(level), maxLevel /* 55 */, reset(), onChange(fn)
};
// localStorage 'nullpunkt:profile'
```

## 5. Engine (core)

### `engine/renderer.js`
```js
export function createRenderer(canvas, { quality }) → {
  renderer /* THREE.WebGLRenderer */, quality, preset,
  setQuality(q), resize(), render(scene, camera, vmScene, vmCamera), info() /* {fps, drawCalls, triangles} */, dispose()
}
```
Quality presets (`auto` → low on touch devices/low-memory, else high):
low: pixelRatio ≤1, no shadows or 1024 shadow map, no post (or FXAA only).
medium: pixelRatio ≤1.25, PCF shadows 2048, bloom.
high: pixelRatio ≤1.5, PCFSoft 2048, bloom + SMAA + vignette/color grade.
ultra: pixelRatio ≤2, 4096 shadows, bloom + SMAA + GTAO/SSAO.
ACES filmic tone mapping, sRGB output. Viewmodel rendered in the same composer after the
world pass with depth cleared (weapons never clip into walls). `preset` exposes
`{ shadows, shadowMapSize, bloom, ssao, maxBotsVisibleShadows, particleScale, decals }`
so others can scale their work (e.g. effects use `preset.particleScale`).

### `engine/input.js`
```js
export class Input {
  constructor(G)               // creates touch overlay inside #touch-ui when touch is used
  mode                          // 'desktop' | 'touch' (switches on first touch / mouse use)
  move                          // {x, y} in -1..1 (y = forward), normalized
  look                          // {dx, dy} radians to apply this frame (sensitivity/FOV-scaled, invertY applied)
  down(action) / pressed(action) / released(action)
  // actions: fire, ads, reload, jump, crouch, sprint, melee, grenade, swap, slot1, slot2,
  //          streak1, streak2, streak3, scoreboard, pause, interact
  requestLock(); exitLock(); locked
  setEnabled(bool); update(dt); endFrame(); attach(G); detach()
}
```
Desktop: WASD, mouse look (pointer lock), LMB fire, RMB ADS (hold), R reload,
Space jump, C/Ctrl crouch (tap) / slide when sprinting, Shift sprint (toggle-on-hold), V/Mouse4 melee,
G/Q grenade, 1/2/mouse-wheel weapon swap, 3/4/5 scorestreaks, Tab scoreboard, Esc pause.
Gamepad (standard mapping) supported.
Touch (COD-Mobile style): floating left joystick (push to top edge → auto-sprint lock),
right half = look drag, big right FIRE button + small left FIRE button, ADS, reload, jump,
crouch, grenade, weapon swap, scorestreak buttons, pause, scoreboard. Buttons are DOM
elements styled in `game.css` (class prefix `tc-`). `settings.autoFire` and `aimAssist`
(slight slowdown/magnetism near enemies; uses `G.actors`) apply only in touch mode.

### `engine/physics.js`
```js
export class CapsuleBody {
  constructor({ radius = 0.35, height = 1.8 })   // position = feet
  position: Vector3; velocity: Vector3; onGround: bool; groundNormal: Vector3; crouchHeight
  setHeight(h)                                    // crouch: shrink capsule (check headroom before standing)
  canStand(world) → bool
  step(dt, world, { gravity = 24, stepHeight = 0.45 }) // collide against world.collider (Octree) incl. small step-up
  teleport(pos)
}
```

### `combat.js`
```js
export class Combat {
  constructor(G); attach(G); detach()
  fireHitscan({ shooter, origin, dir, range, weapon /* def */, pelletIndex }) → { hit: 'actor'|'world'|null, point, distance, target, zone }
  // raycasts world (G.world.raycast) and every hostile, alive actor's hitboxes (actor.raycastHitboxes),
  // nearest wins; damage = falloff(distance) × zoneMult; emits impact/actor:hit/kill.
  damage(target, { amount, attacker, weaponId, zone, dir, point, explosive })
  explode({ position, radius, maxDamage, attacker, weaponId, type }) // LOS-checked falloff, self-damage on, team-damage off
  isHostile(a, b) → bool // FFA: everyone else; teams: different team
}
```
Damage zones: `head` (×weapon.headMult), `body` (×1), `limb` (×weapon.limbMult).
Assists: any attacker who dealt ≥ 25 damage to the victim within 6 s who is not the killer.

### Actor interface (Player and Bot)
```js
actor = {
  id, name, team /* 'A' (player side) | 'B' | null for FFA */, isPlayer, isBot,
  alive, health, maxHealth /* 100 */, body /* CapsuleBody */, position /* = body.position, feet */,
  yaw, pitch, loadout, weapon /* WeaponController */, lastDamageTime,
  stats: { kills, deaths, assists, score, shotsFired, shotsHit, headshots, streak, bestStreak, damage, captures },
  getEyePosition(out), getAimDirection(out),
  raycastHitboxes(ray /* THREE.Ray */, maxDist) → { distance, point, normal, zone } | null,
  onDamaged(info), onDeath(info), respawn(spawn /* {position, yaw} */),
  visible /* for minimap/UAV: set by modes/HUD */, lastFiredTime /* minimap red dot when firing */
}
```
Player height standing 1.8 (eye 1.65), crouched 1.15 (eye 1.0). Player speed ~5.4 m/s walk,
8.2 sprint, 2.6 crouch, × weapon `moveSpeedMult`, × `adsMoveMult` while aiming. Jump ~1.1 m.
Health 100; COD-style regen: 3.5 s after last damage, +55 hp/s. Bots use the same body and rules.

## 6. World (`world/`, owner: world)

```js
// world/index.js
export async function loadWorld(G, mapId, { onProgress }) → World
World {
  id, name, meta /* from maps.data.js */,
  group,                        // THREE.Group added to G.scene by loadWorld
  collider,                     // Octree of all solid geometry (players/bots/grenades)
  bounds,                       // THREE.Box3 playable area (kill/clamp anything outside)
  raycast(origin, dir, maxDist) → { distance, point, normal, surface, object } | null   // bullets
  lineOfSight(fromVec3, toVec3) → bool
  spawns: { A: [{position, yaw}], B: [...], ffa: [...] }   // ≥ 8 each, A/B on opposite sides
  objectives: { dom: [{ id: 'A'|'B'|'C', position, radius }] }
  nav,                          // NavGraph (below)
  lighting: { sunDirection, sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity, envMap, fogColor },
  minimap: { canvas /* top-down drawn, north-up */, worldToMap(x, z) → {u, v} /* 0..1 */, size: {x, z}, center: {x, z} },
  ambience,                     // 'harbor' | 'desert' | 'industrial' | 'range'
  surfaceAt(point) → surface,
  update(dt, camera),           // shadow camera follows camera, animated props (cranes, flags, water)
  dispose()
}
NavGraph {
  nodes: [{ id, position: Vector3, links: [id], cover: bool, coverDir?: Vector3 }],
  nearest(pos) → node, findPath(fromVec3, toVec3) → Vector3[] /* A*, includes final point */,
  randomNode(filter?), coverNear(pos, threatPos, radius) → node | null, nodesInRadius(pos, r)
}
```
Surfaces: `concrete`, `metal`, `wood`, `dirt`, `sand`, `grass`, `glass`, `water`, `tile`,
`fabric`, `flesh` (actors). Materials carry `material.userData.surface`.

Maps (all original, each with distinct lighting & mood, 3-lane COD-style layout, power positions,
cover everywhere, sightlines of varied length, ≤ ~110 m across):
- `hafen` — Container port at golden hour: stacked shipping containers, gantry crane,
  warehouse interior, dock edge with water, forklifts, pallets.
- `altstadt` — Mediterranean/desert old town at bright midday: plastered houses with
  enterable interiors and rooftops, narrow alleys, market with awnings, central plaza with well.
- `werk` — Abandoned factory under overcast dusk: large hall with catwalks and machines,
  pipes, loading bays, outer yard with trucks; lamps and emissive lights.
- `range` — Small training range (Schießstand) with lanes, distance markers, pop-up target
  dummies (used by mode `training`).

`engine/textures.js` (world): `getMaterial(name, opts)` returns cached `MeshStandardMaterial`s with
procedural canvas textures (albedo + normal + roughness), e.g. `concrete`, `concrete_dark`,
`plaster_warm`, `plaster_white`, `brick`, `metal_painted`, `metal_rust`, `metal_corrugated`,
`container_red|blue|green|orange|gray`, `wood_crate`, `wood_planks`, `asphalt`, `sand`, `dirt`,
`grass`, `tiles`, `glass`, `sandbag`, `tarp`, `rubber`, `gunmetal`, `polymer`, `wood_stock`,
`fabric_camo_a`, `fabric_camo_b`, `skin`. Plus `boxUV(geometry, scale)` for world-scaled UVs.

`shared/maps.data.js` (pure data, site uses it):
```js
export const MAPS = { hafen: { id, name: 'Hafen', subtitle, description, size: 'mittel', timeOfDay, modes: [...], palette: [...], layout: [[x,z,w,d,kind],...] /* simplified top-down blocks for the site's map preview */ }, ... }
```

## 7. Weapons

### `shared/weapons.data.js` (ballistics, pure data, site uses it)
```js
export const WEAPON_CLASSES = { ar: 'Sturmgewehr', smg: 'MP', lmg: 'LMG', sniper: 'Scharfschützengewehr', marksman: 'Präzisionsgewehr', shotgun: 'Schrotflinte', pistol: 'Pistole', melee: 'Nahkampf' };
export const WEAPONS = {
  [id]: {
    id, name, cls, slot: 'primary'|'secondary', description, unlockLevel,
    damage: { max, min, rangeStart, rangeEnd }, headMult, limbMult, pellets /*1*/,
    rpm, fireMode: 'auto'|'semi'|'burst'|'bolt'|'pump', burstCount, mag, reserve,
    reloadTime, reloadEmptyTime, perShellReload /*shotgun*/, equipTime, adsTime, adsFov /* camera fov while ADS */,
    scope: null | { zoom, overlay: 'sniper'|'reddot'|'holo'|'acog' }, sprintToFire,
    moveSpeedMult, adsMoveMult, hipSpread, adsSpread, moveSpreadMult, jumpSpreadMult,
    recoil: { vertical, horizontal, recovery, firstShotMult, pattern? },
    range, penetration, sound: { profile: 'ar'|'ar_heavy'|'smg'|'lmg'|'sniper'|'shotgun'|'pistol'|'pistol_heavy', pitch },
    model /* key for gunsmith models.js */, stats: { damage, fireRate, range, accuracy, mobility, control } /* 0-100, site bars */
  }
};
export const EQUIPMENT = { frag: { id, name: 'Splittergranate', count: 1, fuse: 2.8, radius: 6.5, maxDamage: 150, ... }, ... };
export const DEFAULT_LOADOUTS = [{ id, name, primary, secondary, lethal }, ...];
```
All names fictional (no real brand/trademark names). **Fixed roster** (ids, names and model
keys are binding for ballistics, gunsmith, audio, site, ui):

| id | name | cls | slot | model key | sight | sound profile |
|---|---|---|---|---|---|---|
| `ar_kv47` | KV-47 | ar | primary | `kv47` (AK-style, wood furniture) | iron | `ar_heavy` |
| `ar_m17` | M-17 Falke | ar | primary | `m17` (M4-style, rails) | holo | `ar` |
| `smg_vp9` | VP-9 Viper | smg | primary | `vp9` (MP5-style) | iron | `smg` |
| `smg_qx90` | QX-90 | smg | primary | `qx90` (P90-style bullpup) | reddot | `smg` |
| `lmg_hm60` | HM-60 Hammer | lmg | primary | `hm60` (belt-fed, bipod) | iron | `lmg` |
| `mr_sk14` | SK-14 | marksman | primary | `sk14` (DMR) | acog | `ar_heavy` |
| `sr_brecher` | Brecher .338 | sniper | primary | `brecher` (bolt-action) | sniper | `sniper` |
| `sg_bulldog` | Bulldog 12 | shotgun | primary | `bulldog` (pump) | iron | `shotgun` |
| `pi_p9` | P-9 Kompakt | pistol | secondary | `p9` | iron | `pistol` |
| `pi_adler` | Adler .50 | pistol | secondary | `adler` (heavy) | iron | `pistol_heavy` |
| `knife` | Kampfmesser | melee | (melee action, always carried) | `knife` | — | — |
| equipment `frag` | Splittergranate | lethal | — | `frag` | — | explosion |
| equipment `semtex` | Haftgranate | lethal | — | `semtex` | — | explosion |

Gun Game (`gun`) cycles through these 18 steps (ids may repeat): smg_vp9, smg_qx90, ar_m17,
ar_kv47, lmg_hm60, mr_sk14, sg_bulldog, sr_brecher, pi_adler, pi_p9, then the same order
for smg_vp9, ar_m17, ar_kv47, sg_bulldog, mr_sk14, sr_brecher, pi_adler, knife (final kill = knife).

Audio sound profiles (audio implements all): weapons `ar`, `ar_heavy`, `smg`, `lmg`, `sniper`,
`shotgun`, `pistol`, `pistol_heavy` (+ distant/indoor variants via filtering), `dryfire`,
`reload_mag_out`, `reload_mag_in`, `reload_bolt`, `reload_shell`, `pump`, `bolt`, `equip`, `ads_in`,
`ads_out`, `melee_swing`, `melee_hit`, `grenade_pin`, `grenade_bounce`, `explosion`, footsteps per
surface, `land`, `jump`, `hit_flesh`, `hit_helmet`, `bullet_whiz`, impacts per surface,
`hitmarker`, `hitmarker_kill`, `headshot`, `death`, `pain`, `heartbeat` (low health), UI: `hover`,
`click`, `confirm`, `back`, `countdown`, `go`, `win`, `lose`, `levelup`, `medal`, `streak_ready`,
`uav`, `airstrike`, `sentry`, `capture`, plus per-map ambience loops.

### Audio API (`engine/audio.js`, owner: audio)
```js
export class AudioEngine {
  constructor(G /* may be a minimal {settings, events} */)
  unlock()                                   // call from a user gesture; safe to call repeatedly
  attach(G); detach()                        // subscribes to the events in §3 and plays sounds itself
  play(name, { position /* Vector3|null = 2D */, volume = 1, pitch = 1, actor } = {})
  ui(name)                                   // UI sounds (also used by the website)
  startAmbience(ambienceId); stopAmbience()
  update(dt)                                 // listener = G.camera; occlusion via world.lineOfSight (cheap, throttled)
  setVolumes({ master, sfx, music, ui })     // also follows settings changes automatically
}
```
The player's own gunshots are loud/close and dry; enemy shots are positional with distance
filtering, slap-back echo outdoors and reverb indoors.

### `weapons/index.js` (ballistics)
```js
export class WeaponSystem {
  constructor(G); attach(G); detach()
  createController(actor, loadout) → WeaponController
  update(dt)                       // grenades/projectiles
}
WeaponController {
  actor, slots: [primaryState, secondaryState], current /* state */, currentDef, equipment: { lethal: {id, count} },
  // state = { id, def, mag, reserve }
  update(dt, intent /* { fire, firePressed, ads, reload, swap, slot, grenade, melee, sprinting, moving, airborne, crouching } */),
  adsProgress /* 0..1 */, spread /* current cone in radians, for HUD crosshair */, isReloading, reloadProgress,
  isSwitching, canSprint, lastShotTime, refill(), setLoadout(loadout)
}
```
Player recoil applied via `actor.addRecoil(pitch, yaw)` (Player implements; Bot may ignore or use for aim punch).
For the player only, the controller drives the gunsmith `ViewModel` (below) and sets camera FOV during ADS.
Gun Game uses `setLoadout()` to change weapons on the fly.

### `weapons/models.js` + `weapons/viewmodel.js` (gunsmith)
```js
// models.js — usable standalone by the website (Arsenal 3D viewer) with plain three.js
export function createWeaponModel(modelKey, { lod: 'first'|'third'|'showcase' }) → THREE.Group
//   group.userData = { muzzle: Object3D, ejection: Object3D, magazine: Object3D, sight: Object3D, leftHandGrip: Object3D, adsOffset: Vector3 }
// viewmodel.js
export class ViewModel {
  constructor(G)                  // builds arms (gloves + sleeves), adds to G.viewmodel.scene, sets up lights matching world.lighting
  setWeapon(weaponId)             // raise/equip animation
  update(dt, s /* { ads, moving, speed, sprinting, crouching, onGround, lookDX, lookDY, reloading, reloadProgress, reloadEmpty, firing, timeSinceShot } */)
  onShot(strength)                // kick + muzzle flash + shell eject
  playReload(empty), playMelee(), playGrenade(), playInspect()
  getMuzzleWorldPosition(out)     // in MAIN-scene world coords (for tracers)
  setVisible(bool); showScopeOverlay /* bool: sniper full-ADS → HUD shows scope overlay, viewmodel hidden */
  dispose()
}
```

### `engine/effects.js` (ballistics)
`export class Effects { constructor(G); attach(G); detach(); update(dt); }` — listens to
`impact`, `actor:hit`, `explosion`, `tracer`, `weapon:fire` (3rd-person muzzle flash for non-player
actors), `kill`. Pooled particles (sparks, dust, wood chips, blood mist), bullet-hole decals
(pooled quads, polygonOffset, ≤ 120), tracers, explosion (fireball, smoke, debris, light flash,
`G.player.shake(intensity)` if near), shell casings. Respect `renderer.preset.particleScale`.

## 8. Bots (`bots/`, owner: bots)
```js
// bots/character.js
export function createSoldier({ team, variant, camo }) → Soldier {
  root /* Group, add to scene */, setWeaponModel(group), hitboxes /* for raycastHitboxes */,
  animate(dt, { speed, crouch, aimPitch, aimYaw, firing, reloading, strafe, airborne }), playHit(dir), playDeath(dir), reset(), dispose()
}
// bots/manager.js
export class BotManager {
  constructor(G); attach(G); detach()
  spawnBots({ allies, enemies, ffa, difficulty, modeId }) → Bot[]; removeAll(); update(dt); bots
}
```
AI: perception (view cone + `world.lineOfSight` + hearing `weapon:fire`/`footstep`),
navigation via `world.nav`, states (roam/objective → engage → strafe/crouch/peek → seek cover
when hurt → reload behind cover → chase last known position → grenade at clusters/cover),
difficulty presets `rekrut|regulaer|veteran|elite` (reaction time, aim error, tracking speed,
burst length, grenade use). Bots use the same WeaponController + combat as the player.
Domination: bots capture/defend flags. Team colors visible (ally blue nameplate/outline, enemy red).

## 9. Modes, scorestreaks, UI (owner: ui)

`shared/modes.data.js`: `MODES` (`tdm` Team-Deathmatch 6v6 first to 40 kills / 10 min; `ffa`
Jeder gegen jeden 8 players first to 25 / 10 min; `dom` Herrschaft 3 flags first to 150 / 10 min;
`gun` Waffenspiel 18 weapon steps / 10 min; `training` Schießstand, no limit) and `STREAKS`
(`uav` Aufklärer 4 kills: enemies on minimap 30 s; `strike` Präzisionsschlag 6 kills: targeted
airstrike; `sentry` Wachgeschütz 8 kills: auto turret 45 s) — each with icon (inline SVG string),
name, description, cost.

```js
// modes/index.js
export function createMode(G, modeId, opts) → Mode {
  id, def, attach(G), detach(), start(), update(dt),
  chooseSpawn(actor) → { position, yaw },  // safe spawn: far from visible enemies
  respawnDelay /* s */, timeLeft, scores /* {A,B} or per-actor */, isOver,
  scoreboard() → rows [{ actor, name, team, score, kills, deaths, assists, ping? }],
  result /* filled when over: see below */
}
// match:end result:
// { modeId, mapId, winner: 'A'|'B'|actorId|'draw', playerWon, draw, duration, teamScores,
//   scoreboard, mvp: actorId, playerSummary: { modeId, mapId, result: 'win'|'loss'|'draw',
//   kills, deaths, assists, headshots, score, shotsFired, shotsHit, bestStreak, longestKill,
//   damage, captures, medals: {id: count}, weaponStats: {id: {kills, shots, hits, headshots}}, duration } }
```

`ui/hud.js` `export class HUD { constructor(G); attach(G); detach(); update(dt); show(); hide(); }` inside
`#hud`: dynamic crosshair (spread), hitmarkers (white / red on kill / headshot variant), damage
direction indicators, low-health red vignette, ammo + weapon name + reserve + lethal count,
health bar, team scores + timer + mode objective bar, killfeed (with weapon names, headshot icon),
minimap (rotating, north indicator, teammates, enemies when firing or UAV, objectives),
compass strip, "+100" score popups + medal toasts, scorestreak progress & ready icons,
reload/swap hints, sniper scope overlay, scoreboard (Tab), FPS overlay (setting), spectator/
respawn countdown with killer name ("Ausgeschaltet von …").

`ui/menus.js` `export class Menus { constructor(G); showLobby(); showLoading(p); showPause(); showSettings(); showEnd(result, progression); hideAll(); }`
inside `#menu-root`. Emits intents via callbacks provided by main:
`G.menus.onStart(config)`, `onResume()`, `onRestart()`, `onQuit()`.

## 10. Website (owner: site)

`index.html` + `assets/css/site.css` + `assets/js/site/*.js`. Minimal yet unlike any other site;
interactive; imports pure data from `assets/js/shared/*.data.js`, `settings.js`, `profile.js` and the
weapon models from `assets/js/game/weapons/models.js` (3D Arsenal viewer). Must link to
`spielen.html?...` with the chosen mode/map. Sections (names may vary): hero, play CTA,
Modi, Karten, Arsenal, Profil/Statistiken (from profile), Einstellungen (shared settings),
Steuerung (desktop/touch/gamepad), Über/Impressum-hint. Responsive (360 px → 4K), keyboard
accessible, `prefers-reduced-motion` respected, works without WebGL (graceful fallback).

## 10a. Stubs during parallel development

Modules are written concurrently. `main.js` imports every non-core module through
`importOr(realPath, stubPath)`: it tries the real module and falls back to a minimal stub in
`assets/js/game/stubs/` (owned by core). URL param `stubs=all` or `stubs=world,audio,...`
forces stubs (keys: `world, audio, textures, models, viewmodel, weapons, effects, bots, modes, hud, menus`).
Core never writes at another owner's path. The integration step removes `stubs/` and
`importOr` once every real module exists.

Every module owner provides an isolated dev harness page under `dev/` (e.g. `dev/world.html`
free-fly camera through each map, `dev/weapons.html` model + viewmodel animation viewer,
`dev/audio.html` sound board, `dev/bots.html` bot sandbox) so it can be checked without the
full game. Harness pages use the same import map.

## 11. Quality bar

- No console errors or warnings in normal use. Test with `node tools/shot.mjs <url> <png> …`
  against `http://localhost:8765/` (start: `npx http-server -p 8765 -s -c-1 /home/user/websiteeine-website &`).
- Performance targets: desktop high ≥ 60 fps; mobile low ≥ 30 fps. Static map geometry merged
  per material (BufferGeometryUtils.mergeGeometries) or instanced; draw calls < 400 on high.
- Dispose GPU resources on match restart; no leaks across 5 consecutive matches.
- Everything must also work when served from a sub-path (GitHub Pages `/<repo>/`): only
  relative URLs.

### 11a. Mobile is a first-class target (user requirement)

The user explicitly requires that the website **and** the game are fully usable and playable
on phones and tablets (iOS Safari + Android Chrome), not only desktop:
- Website: mobile-first layouts from 360 px, touch-friendly targets (≥ 44 px), no hover-only
  features (every hover effect has a tap/scroll equivalent), the 3D arsenal viewer rotates by
  touch drag, no horizontal scroll, fast on mid-range phones.
- Game: touch controls are the primary input on touch devices (COD-Mobile layout, §5), HUD
  scaled and positioned for thumbs and safe areas (`env(safe-area-inset-*)`, notches),
  landscape play (portrait shows a rotate hint), fullscreen where possible, `quality: auto`
  picks `low`/`medium` on phones, dynamic resolution if fps drops (< 40 for 3 s → lower
  pixel ratio), lobby/menus/end screen fully operable by touch (big targets, no keyboard
  needed, no Esc-only actions), text readable at phone size, iOS audio unlock on first touch,
  no 300 ms delays, no accidental text selection / callouts / zoom.
- Test every feature with Playwright mobile emulation (`hasTouch`, `isMobile`, landscape
  915×412 and portrait 412×915) in addition to desktop.

## Changelog
- (append entries: date — owner — what changed and why)
- 2026-10-04 — data — weapons.data.js/modes.data.js v1 (nur additiv): Schaden = pro Kugel, linear max→min zwischen rangeStart/rangeEnd, 0 jenseits `range`; Schrot verteilt `pellets` im aktuellen Streukegel (hip/adsSpread); recoil.pattern = [[h,v],…] Multiplikatoren je Schuss, recovery = 1/s; adsFov gilt für FOV 80 (`adsFovFor(def, fov)`); Zusatzfelder je Waffe: sight, adsZoom, icon (SVG 96×32), suppressed, shellTiming {start,insert,end} (Schrot), melee {range,lungeRange,lungeSpeed,arc,swingTime,hitDelay} (Messer: slot 'melee', mag/reserve 0, sound.profile 'melee_swing'); EQUIPMENT + innerRadius/minDamage/cookable/throwPitch/bounciness/friction/icon; Helfer damageAt, shotsToKill, ttk, killProfile, effectiveRange, computeStats, explosionDamageAt/KillRadius, listByClass/BySlot, UNLOCKS/unlocksBetween/isUnlocked. modes.data.js: MODE_ORDER, limits{allies,enemies}, streaks/lethals-Flags, dom.objective, gun.demoteOnMelee, training.infiniteAmmo, STREAKS[].params, DIFFICULTIES (+headshotChance/viewDistance/fov), 28 MEDALS + MEDAL_RULES (multiKillMedal, isLongshot je Klasse), SCORE_RULES (score-Event-Punkte), XP_RULES (an profile.js angeglichen), medalXp()/matchBonusXp(). Hinweis an core: profile.js gibt pauschal 50 XP je Medaille und wendet DIFFICULTIES[].xpMult nicht an — medalXp(s.medals) bzw. xpMult wären die Daten dafür. Prüfseite: dev/data.html.
- 2026-10-04 — audio — `engine/audio.js` + `engine/audio/*` (dsp, catalog, sfx-weapons, sfx-foley, sfx-ui, ambience, music, space, ui-sounds) vollständig prozedural, keine Audiodateien. **API (additiv zu §7):** `new AudioEngine(G, { context?, autoUnlock = true, autoMusic = true, maxVoices? })` (G darf minimal `{settings, events}` sein; AudioContext entsteht erst in `unlock()` → keine Autoplay-Warnung; erste Geste pointerdown/keydown/touchend entsperrt automatisch); `unlock() → Promise` (startet Vorrendern aller ~260 Puffer in Leerlauf-Häppchen); `attach(G)/detach()`; `play(name, { position, volume, pitch, actor, player, surface, sprint, crouch, suppressed, delay, priority, pan, lowpass, env, indoor, variant, loop }) → voice|null` — `name` = Katalogname (siehe `SOUND_NAMES`/`SOUND_GROUPS`) oder Waffenprofil `ar|ar_heavy|smg|lmg|sniper|shotgun|pistol|pistol_heavy` (Spieler/ohne Position = 2D trocken stereo; sonst positional mit Nah/Fern-Überblendung, Luftdämpfung, Schalllaufzeit) oder `footstep`/`impact` (+`surface`) / `explosion`; `ui(name)`; `loop(name, opts) → { setPosition, setVolume, setPitch, stop }`; `startAmbience(id)` (harbor|desert|industrial|range oder Karten-ID hafen|altstadt|werk|range), `fadeAmbience(level, s)`, `stopAmbience(fade)`; **`startMusic()` / `stopMusic(fade)`** (Lobbymusik 100 BPM, 7 Stems, Arrangement; vor `unlock()` vorgemerkt); `setVolumes({ master, sfx, music, ui, ambience })` (folgt sonst `settings.onChange` + `settings:change` live); `setEnvironment('auto'|'indoor'|'outdoor')`, `setSpace(mapOrAmbienceId)`, `concuss(0..1)`, `stopAll()`, `prerender(names?) → Promise`, `getAnalyser()`, `info()`, `dispose()`, Getter `ready`, `musicPlaying`, `ambienceId`. Exporte zusätzlich: `createUiSounds(settings)` (auch leichtgewichtig direkt aus `engine/audio/ui-sounds.js` für die Website: `{ play, hover, click, confirm, back, toggle, unlock, setEnabled, dispose, ready }`, Kontext erst bei Nutzergeste), `renderOffline(setup, { seconds, sampleRate, camera, THREE, settings }) → { peakDb, rmsDb, … }` (Tests), `SOUND_NAMES`, `SOUND_GROUPS`, `GUN_PROFILES`, `SURFACES`. **Verhalten:** `match:state` wird dauerhaft (auch im detach-Zustand der Lobby) abonniert: lobby → Musik an + Atmo aus, countdown/playing → Musik aus, paused → Welt gedämpft; `match:end` → Sieg/Niederlage/Unentschieden-Stinger, Musik nach ~4 s. Abonniert sonst alle §3-Ereignisse inkl. optional `weapon:melee {actor}`; liest `WEAPONS[id].sound.{profile,pitch}`, `fireMode` (pump/bolt-Repetiergeräusch), `perShellReload`, `reloadTime/reloadEmptyTime` (Nachlade-Choreografie), `MEDALS[id].tier` (Tonhöhe) defensiv per dynamic import. Vorbeiflug-Pfeifen/Überschallknall aus `weapon:fire` origin/dir vs. Hörer (mit world.raycast-Prüfung); Verdeckung via `world.lineOfSight` (gecacht 0,25 s, ≤ 8 Abfragen/16 ms); innen/außen über `world.raycast` nach oben (Hörer + Quelle). Mix: Busse sfx/amb/fb (Feedback, ungedämpft)/ui/music → Glue-Kompressor → Limiter → Softclip (nie > 0 dBFS; gemessen Stresstest −0,6 dBFS). Prüfstand: `dev/audio.html` (Klanglabor: alle Klänge/Profile nah/fern/gedämpft, Ereignisse über den Bus, kreisende 3D-Quelle, Atmo/Musik, Lautstärken, Pegelmessung offline).
- 2026-10-04 — core — **main.js / G / Lebenszyklus:** `G` zusätzlich: `version`, `timeScale` (Simulationsfaktor), `data` (alle Exporte aus weapons/modes/maps.data.js, Ersatz aus `stubs/data.js`), `modules` + `moduleStatus` ({key: 'real'|'stub'}), `lastConfig`, `lastResult`, `lastProgression`, `matchCount`, `spawnActor(actor)`, `time.real` (ungeskalierte Sekunden), `match.{ffa, timeLimit, scoreLimit, pausedFrom, endedAt, result}`; `body[data-match-state]` spiegelt den Zustand. **Respawn macht main:** auf `kill` setzt main `victim.diedAt` und `victim.respawnAt = elapsed + mode.respawnDelay (Standard 3)`; jedes `playing`-Frame ruft es `spawnActor(a)` für fällige Tote (überspringt, wenn `mode.canRespawn?.(a) === false`) → `mode.chooseSpawn(actor)` (Rückfall `world.spawns[team|ffa]`) → `actor.respawn(spawn)` → `actor:spawn`. Bots/Modi respawnen nicht selbst. Matchende: main emittiert `match:end {result: mode.result}`, sobald `mode.isOver` (Modus darf `match:end` auch selbst senden); main ruft `profile.recordMatch({difficulty, ...result.playerSummary})`, zeigt das Banner (`#match-banner`) und nach 1,6 s `menus.showEnd(result, progression)`. Nach `bots.update` trennt main lebende Akteure weich (`separateActors`). Fällt `loadWorld` der echten Welt aus, lädt main das Testgelände (Stub) statt abzubrechen.
- 2026-10-04 — core — **URL-Parameter spielen.html (zusätzlich zu §2):** `stubs=all|world,audio,…` (§10a), `time=<s>` / `score=<n>` (Zeit-/Punktelimit → `createMode(G, id, {timeLimit, scoreLimit, time, score, difficulty, allies, enemies, mapId})`), `primary`/`secondary`/`lethal` (Ausrüstung), `god=1` (Spieler unverwundbar), `timescale=0.05…4`, `quality=` (schaltet auch die dynamische Auflösung ab). Menü-Intents (`G.menus.onStart(cfg)`): `cfg = { modeId, mapId, difficulty, allies, enemies, loadout: {primary, secondary, lethal}, timeLimit?, scoreLimit? }` (main validiert/klemmt per `MODES[id].limits`); außerdem `onResume`, `onRestart`, `onQuit` (→ Lobby), `onExit` (→ index.html). `ui:sound`-Ereignisse spielt main über `audio.ui()` ab, solange kein Match läuft.
- 2026-10-04 — core — **G.debugApi** (Tests/Konsole): `teleport(x,y,z)`, `godMode(on)`, `giveWeapon(id)`, `killAllEnemies()`, `setTimeScale(s)`, `endMatch()` (ruft `mode.forceEnd?.()`/`mode.end?.()`), `spawnBots(n)`, `lookAt(x,y,z)`, dazu `start(cfg)`, `restart()`, `pause()`, `resume()`, `toLobby()`, `setQuality(q)`, `state()` (Zustand, FPS, Draw Calls, Akteure, Spielerwerte, Listener-Anzahl). `G.input.simulate.{look(dxPx,dyPx), press(a), release(a), tap(a), move(x,y|null), clear()}` simuliert Eingaben. Smoke-Test: `node tools/smoke.mjs --params="stubs=all&time=60&score=5" [--seconds=20] [--mobile] [--shots=4] [--end] [--restarts=N] [--lobby] [--quality=low] [--warn-fail]` → JSON, Exit 1 bei Konsolenfehlern/fehlgeschlagenen Prüfungen (Header in der Datei).
- 2026-10-04 — core — **Player (Actor) für ballistics/gunsmith/ui:** `addRecoil(pitch, yaw, recovery?)` (Radiant; pitch>0 = hoch, yaw>0 = rechts; 30 % bleiben, 70 % federn mit `recovery` 1/s zurück, sichtbarer Kamerakick zusätzlich), `shake(trauma 0..1)`, `onDamaged(info)` (Zucken + Wackeln), `onDeath(info)` (Todeskamera zum Schützen), `respawn(spawn)`, `resetForMatch({team, loadout, name})` (erzeugt `weapon = G.weapons.createController(this, loadout)`), Felder `sprinting/crouching/sliding/godMode/baseFov/camera/stats/weaponStats/diedAt/respawnAt/killer`. **Der Spieler setzt das Kamera-FOV selbst** (`settings.fov` = horizontales 4:3-FOV → vertikal; Sprint/Rutsch-Kick; ADS über `weapon.adsProgress` und `def.adsZoom` → `scope.zoom` → `adsFov` (bei FOV 80)) — der WeaponController setzt **kein** FOV, er liefert nur `adsProgress`. Pro Frame ruft der Spieler `weapon.update(dt, intent)` mit `intent = { fire, firePressed, ads, reload, swap, slot (1|2|null), grenade (gedrückt), grenadeHeld, melee, sprinting, moving, airborne, onGround, crouching, sliding, speed, lookDX, lookDY, frozen (Countdown/Pause: nur animieren) }`; er liest `weapon.canSprint`, `weapon.currentDef.{moveSpeedMult, adsMoveMult}`, `weapon.refill()`, `weapon.dispose?.()`. Der **Controller des Spielers erzeugt den ViewModel** (`new G.modules.viewmodel.ViewModel(G)`, setzt `G.viewmodel.rig`) und ruft `viewModel.update(dt, s)`/`onShot`/`setWeapon` (siehe `stubs/weapons.js` als Referenz). Ereignisse: `player:slide {velocity, phase:'start'|'end', position}`, `player:regen {health, phase}`. Exporte: `hfovToVfov`, `zoomFov`, `blankStats()`.
- 2026-10-04 — core — **combat.js (Ergänzungen):** Exporte `raycastHumanoid(actor, ray, maxDist)` (Standard-Trefferzonen Kopf/Torso/Beine nach `body.height`, für Bots ohne eigenes Skelett), `HUMANOID`, `raySphere`, `rayCapsule`, `falloff(def, distance)`; `fireHitscan({..., damageScale = 1})` → zusätzlich `{normal, surface, damage, penetrated}`; `damage(target, info)` gibt den verrechneten Schaden zurück, respektiert `target.godMode/invulnerable`; `killCount`. **Statistik-Zuständigkeit:** combat zählt kills/deaths/assists/headshots/streak/bestStreak/damage/shotsHit/longestKill und `actor.weaponStats[id]`, `shotsFired` über `weapon:fire` (→ **weapon:fire genau einmal pro Schuss vor den Pellet-`fireHitscan`-Aufrufen senden**, Treffer zählen dann einmal pro Schuss); `stats.score`/`captures` zählt der Modus. `kill` zusätzlich `{distance, suicide}`, `impact` ggf. `{penetrated: true}`, neues Ereignis `bullet:whiz {position, shooter, distance}` (Kugel nahe am Spielerkopf).
- 2026-10-04 — core — **engine/physics.js neu (schwebende Kapsel):** Kollisionskapsel beginnt `stepHeight` (0,45) über den Füßen und berührt nur Wände/Decken; Boden über senkrechte Sonden (Mitte + Ring) → Stufen/Bordsteine ≤ 0,45 m werden automatisch erstiegen, Treppen abwärts haften, Schrägen ≤ 50° begehbar ohne Abrutschen, steilere wirken als Wand; im Fall werden Kanten bis 0,45 m über den Füßen gefangen (Sprung auf 1,2-m-Kisten möglich). Zusätzliche Felder: `landed`/`landSpeed` (im Landeschritt), `groundY`, `stepOffset`, `wallNormal`, `outOfWorld`, `capsule` (volle Körperkapsel), `collisionCapsule`; Export `separateActors(actors)`. Kosten ≈ 4 µs pro `step()`. Hinweis an world: three.js-`Octree` verliert Dreiecke, die exakt auf der Oberkante seines Würfels liegen (höchste Flächen der Karte) – ggf. Kollisionsgeometrie etwas höher reichen lassen.
- 2026-10-04 — core — **engine/input.js (Ergänzungen):** Export `ACTIONS`; Felder `aimTarget` (Feind unter dem Fadenkreuz, für HUD-Rot-Färbung), `lastDevice` ('keyboard'|'mouse'|'gamepad'|'touch'), `adsToggled`, `sprintLock`, `everLocked`, `allowUnlockedMouse`; Methoden `cancelAds()`, `releaseAll()`, `vibrate(ms)`; Ereignisse `input:lock {locked, error}`, `input:mode {mode}`; `body[data-input-mode="desktop|touch"]`. Touch-UI (in `#touch-ui`, nur sichtbar bei `body[data-input-mode=touch][data-match-state=playing|countdown]`): `.tc-stick` (+`.tc-stick-base/-knob/-lock`, `.is-locking/.is-locked`), `.tc-btn` mit `data-action` (`.tc-fire-r` groß – Ziehen darauf dreht die Ansicht –, `.tc-fire-l`, `.tc-ads` (Umschalter, `.is-active`), `.tc-reload` (`.is-alert` bei ≤ 25 % Magazin), `.tc-jump`, `.tc-crouch` (Rutschen beim Sprint), `.tc-grenade` (`.tc-badge`, `.is-empty`), `.tc-melee`, `.tc-swap` (`.tc-swap-name`), `.tc-streak` ×3 (`data-streak`, `.is-ready` über `streak:ready`/`streak:activate`, Icons aus `STREAKS[].icon`), `.tc-score`, `.tc-pause`), Größeneinheit `--tc-u`, `.is-down` beim Drücken. Zielhilfe (Verlangsamung + Magnetismus) für Touch und Gamepad, Auto-Feuer nur Touch. Vollbild + Querformat-Sperre beim Matchstart/Fortsetzen und bei Berührung im Spiel.
- 2026-10-04 — core — **renderer.js / Mobil:** `createRenderer()` liefert zusätzlich `setResolutionScale(0,5…1)`, `resolutionScale`, `setPost({exposure, contrast, saturation, vignette, damage (roter Rand 0..1), desaturate})` + Getter `post`, `onQualityChange(fn)`, `onContextChange(fn('lost'|'restored'))`, `info() → {fps, frameMs, drawCalls, triangles, geometries, textures, programs, quality, pixelRatio, resolutionScale, width, height}`; Exporte `QUALITY_LEVELS`, `QUALITY_PRESETS`, `resolveQuality`, `isLowEndDevice`; `preset` zusätzlich `{id, pixelRatio, smaa, fxaa, grade, post, decals, anisotropy}`. low = direktes Rendern (MSAA, keine Schatten, CSS-Vignette über `body.np-css-vignette`), ab medium Composer. **Dynamische Auflösung:** < 40 FPS für 3 s → `resolutionScale −0,15` (bis 0,55), danach bei `quality:'auto'` eine Stufe tiefer; > 56 FPS für 8 s → +0,1 (aus bei `?quality=`). `body[data-quality]`. Hochformat auf Touch → `#rotate-overlay` „Bitte Gerät drehen“ + Pause; `visibilitychange`, Pointer-Lock-Verlust und Kontextverlust pausieren. `spielen.html` fängt nicht ladbare Module vor main.js ab (Fehlerpanel `#fatal`).
- 2026-10-04 — core — **Stubs (§10a):** `importOr` prüft Pflichtexporte (`MODULES` in main.js); fehlt ein Modul, wird `stubs/<key>.js` geladen (Konsole: eine `info`-Zeile, bei Ladefehlern `warn`); wirft ein echter Konstruktor, wird der Stub-Konstruktor verwendet. Stubs folgen exakt den Vertrags-APIs und sind lauffähige Referenzimplementierungen: `stubs/weapons.js` (alle Feuermodi, Schrot, Nachladen inkl. Patrone für Patrone, Granaten, Messer), `stubs/bots.js` (Nav-Patrouille, Wahrnehmung, Feuerstöße, Deckung), `stubs/modes.js` (tdm/ffa/dom/gun/training mit `result`/`playerSummary`), `stubs/hud.js`, `stubs/menus.js`, `stubs/world.js` (Testgelände mit Treppe/Rampe/Gebäude), `stubs/data.js` (Ersatzdaten). Neu: `assets/img/favicon.svg` (fehlte für index.html + spielen.html).
- 2026-10-04 — core — Nachträge: Fallschaden ab ≈ 4 m (`combat.damage(player, {weaponId: 'fall', attacker: null})` → `kill` mit `killer: null, weaponId: 'fall'`; Tod außerhalb der Karte: `weaponId: 'world'` – HUD-Killfeed bitte als „Sturz“/„Umgebung“ anzeigen); Haptik nur noch bei Treffern/Abschüssen des Spielers, erlittenem Schaden und nahen Explosionen; im Pause-/Endzustand rendert main nur ~4 Bilder/s (Akku); `tools/smoke.mjs --natural` wartet auf das echte Matchende (Zeit-/Punktelimit) statt `endMatch()` zu erzwingen.
- 2026-10-04 — core — Hinweis an ui: `input.js` unterdrückt `touchmove` (kein Zoom/Pull-to-refresh); scrollbare Menübereiche brauchen `data-scrollable` oder Klasse `.np-scroll` (game.css gibt ihnen `overflow-y:auto; touch-action:pan-y; overscroll-behavior:contain`). Startknopf der Lobby: `[data-act="start"]` (bzw. `[data-action="start"]`/`button.primary`) – `tools/smoke.mjs --lobby` klickt ihn; Fortsetzen: `[data-act="resume"]`.
- 2026-10-04 — core — Präzisierung dynamische Auflösung: bei `quality:'auto'` erst bis `resolutionScale 0,72`, dann eine Stufe tiefer (Skala 0,9), erst auf `low` bis 0,55; Zeitbasis Echtzeit (`G.match.startedReal`). `resolveQuality('auto')`: Touch → low (≥ 8 GB + ≥ 8 Kerne → medium), schwache Desktops (≤ 4 GB oder ≤ 2 Kerne) → medium, sonst high.
- 2026-10-04 — ui — **Vorab-API der Modi für bots (G.mode, wird gerade gebaut, Felder bleiben stabil):** `G.mode.id`, `.teams` (bool), `.def`; `G.mode.objectives` = `[{ id:'A'|'B'|'C', position:Vector3, radius, owner:'A'|'B'|null, capturingTeam:'A'|'B'|null, progress 0..1, contested:bool, counts:{A,B} }]` (nur `dom`, sonst `[]`; jedes Frame aktuell, `objective:update {objectives}` bei Besitz-/Umkämpft-Wechsel); `G.mode.objectiveFor(bot)` → `{ id, position, radius, kind:'capture'|'defend' } | null` (Empfehlung, verteilt Bots auf Flaggen); `G.mode.canRespawn(actor)`. **Serienprämien (`G.mode.streaks`, `null` in gun/training):** `progress(actor)` → `{ kills, nextId, nextKills, ready:[ids] }`, `ready(actor)` → `[streakId]`, `activate(actor, streakId, { target?: Vector3 })` → bool (Bots: `strike` ohne target zielt automatisch), `suggestStrikeTarget(actor)` → Vector3|null, `uavActive(teamOrActor)` → bool (diese Seite hat einen aktiven Aufklärer), `isRevealed(actor)` → bool (actor wird gerade von einem gegnerischen Aufklärer gezeigt – Bots dürfen dann seine Position kennen), `entities` → `[{ kind:'sentry', id, owner, team, position, alive, health, maxHealth, isStreakEntity:true, getAimPoint(out) }]` (Wachgeschütze: Bots dürfen sie als Ziel wählen; Kugeln treffen sie über `world.raycast`, das der Modus solange um das Geschütz erweitert – Treffer erzeugen `impact` mit `surface:'metal'`). Serienkills: `kill.weaponId` = `'strike'` | `'sentry'`; beim Geschütz ist `kill.killer` die Geschütz-Entität (`isStreakEntity`, `owner` = Besitzer, `name` „Wachgeschütz“). Streak-Abschüsse zählen nicht für weitere Serienprämien (klassisch). Ereignisse zusätzlich: `streak:progress {actor, value, next}`, `streak:destroyed {streakId, owner, by}`, `uav:state {team, active, until, owner}` (FFA: `team` = Besitzer-Id). Bitte keine eigenen Respawns/Punkte in bots – das machen main/Modus.
- 2026-10-04 — world — **World-API (additiv zu §6):** `world.targets` (nur `range`: `[{ id, lane, distance, isUp, hitboxes:[{object,min,max,zone}], hittable(), raise(), drop(), update(dt) }]`, `world.raycast` liefert bei Zieltreffern zusätzlich `targetId` + `zone`), `world.groundHeight(x, z, yFrom=30) → y|null` (Kollisionsboden), `world.setQuality(preset)` (Schatten nach Qualitätswechsel), `world.stats` (Meshes, Dreiecke, Lade-/Aufbauzeit, Nav-Statistik), `world.debugData` (Footprints, Kollisions-/Kugel-BVH für Prüfseiten), `world.lighting` zusätzlich `{ envIntensity, exposure, sun, hemi, sky }`. Karten mit eigener Belichtung (`werk` Dämmerung 1,22, `altstadt` Mittag 0,94) setzen beim Laden `G.renderer.setPost({ exposure })` und stellen sie bei `dispose()` zurück. NavGraph zusätzlich: `nearestReachable(pos)`, `findPath(from, to, { smooth })`, Knoten `{ coverDirs:[Vector3], coverHigh:bool, drop:[ids] }` (einseitige Absprünge vom Dach/Laufsteg), `nav.stats`, `nav.report` (nur `?debug=1`: Inseln, Spawns/Flaggen ohne Knoten). Startpunkte werden aus 0,4 m Höhe auf den Boden gesetzt (nie auf Zimmerdecken). `maps.data.js`: je Karte `bounds`, `layout` (aus den echten Karten exportiert; Blöcke `[x,z,b,t,art,rot?]`, Arten u. a. house/wall/cover/container/truck/market/catwalk/stairs/water/lane + Wahrzeichen kirche/turm/well/kesselhaus/ofen/tank …), `flags [{id,x,z}]`, `spawns {A:[x,z],B:[x,z]}`, `dimensions`. Texturen: `cobble` jetzt 1,5 m Kachel. Prüfseite `dev/world.html` (Freiflug, Kartenwahl, Kollision/Nav/Spawns/Flaggen/Minikarte, Laufen, Draw Calls, Ladezeiten, `__dev.exportLayout()`).
- 2026-10-04 — gunsmith — **weapons/models.js (additiv zu §7):** `createWeaponModel(key, { lod })` für alle 13 Schlüssel (`MODEL_KEYS`; `GUN_KEYS` = 10 Schusswaffen) – Koordinaten: Meter, Lauf −Z, Ursprung = Griffpunkt der rechten Hand; Ergebnisse je Schlüssel+LOD gecacht, Rückgabe ist ein günstiger Klon (geteilte Geometrien/Materialien – Aufrufer bitte nur den Klon entfernen, Geometrien nicht disposen; falls doch, lädt three.js sie neu hoch). `lod:'first'` (1,2–5,6 k Dreiecke, statische Teile je Material zusammengeführt, bewegliche Teile separat), `'third'` (Bots: ≤ ~640 Dreiecke, **2–4 Draw Calls**: alles in 2 Vertex-Farb-Materialien Metall/Matt, Magazin-Baugruppe separat; ohne Glas/Absehen/Leuchtteile), `'showcase'` (Hülle zentriert, längste Kante = 1, `userData.model` = innere Waffe, `userData.scale`). `group.userData` = `{ key, lod, muzzle, ejection, magazine, sight, leftHandGrip, rightHandGrip, adsOffset, parts: {mag, bolt, charge, pump, slide, boltHandle, hammer, cover, belt, pin, spoon, blade, shell, led – nur vorhandene}, anchors: {chargeGrab, magGrab, magWell, trigger, pumpGrab, boltGrab, pinGrab, shellPort, slideGrab, boltCatch}, info: {sight, kind, triangles, meshes, size, center, min, max, axis} }`; `sight.userData = { type: 'iron'|'holo'|'reddot'|'acog'|'sniper', eyeRelief }`, `leftHandGrip.userData.style` ('under'|'flat'|'pump'|'post'|'pistol'). Weitere Exporte: `getWeaponModelInfo(key, lod)`, `preloadWeaponModels(keys?, lods?)` (Ladebildschirm), `disposeWeaponModels()`. Optiken: Holo/Rotpunkt/ACOG sind durchsichtig (klare Linse, leuchtendes Absehen, ACOG mit Tunnel + Chevron), Scharfschützenglas dunkel (Vollanschlag → Overlay). Hilfsmodule unter `weapons/gunsmith/` (builder, parts, materials, textures, guns-*, gear, arms, anim, handling, fx, bench*). Waffenlabor: `dev/weapons.html` (Modelle/LOD/Drahtgitter/Dreiecke, Übersicht, Ego-Prüfung aller Animationen; `?view=bench&weapon=<id>`, Testhaken `window.__bench.{pause, step, fp}`).
- 2026-10-04 — gunsmith — **weapons/viewmodel.js `ViewModel` (additiv zu §7):** `new ViewModel(G)` legt `G.viewmodel.{scene,camera}` an, falls nicht vorhanden; empfohlene Viewmodel-Kamera **`ViewModel.FOV = 54`** (vertikal; Hüftpositionen darauf abgestimmt, Seitenverhältnis-Ausgleich für 2,2:1-Telefone und 4:3-Tablets eingebaut). `setWeapon(weaponId, def?)` (Wegstecken → Ziehen, `def.equipTime`), `update(dt, s)` mit `s = { ads, adsProgress? (0..1, überschreibt die eigene Glättung – bitte vom Controller liefern), moving, speed (m/s), sprinting, crouching, onGround, lookDX, lookDY, reloading, reloadProgress (0..1, synchronisiert Magazin-Nachladen), reloadEmpty, firing, timeSinceShot, mag? (0 → Verschluss/Schlitten bleibt offen) }`; `onShot(strength = 1, { empty, suppressed })` (Federrückstoß mit Rollen, Mündungsfeuer + Punktlicht, Rauch, gepoolte Hülsen; Repetierer/Flinte starten danach selbst Kammerstängel-/Pumpzyklus); `playReload(empty)` (Stile je Waffe: Magazin, Pistole, Magazin oben, Gurt, Patrone für Patrone + Pumpe, leer: Verschlussfang/Spannhebel/HK-Schlag/Kammerstängel), `playMelee()` (Messer mit links; Messer als Hauptwaffe: Hieb), `playGrenade(type = 'frag'|'semtex', { hold })` + `releaseGrenade()` (Vorkochen), `playInspect()`, `cancelAction()`, Getter `isBusy`, `actionName`; Rückrufe `onMeleeHit()` (Treffermoment ≈ 20 % des Hiebs), `onGrenadeRelease(type)` (Abwurfmoment ≈ 66 %); `getMuzzleWorldPosition(out)` (Weltkoordinaten der Hauptszene), `setVisible(bool)`, `showScopeOverlay` (Scharfschütze voll im Anschlag → Viewmodel aus, HUD-Overlay an), `setLighting(world.lighting)` (Late Binding; `update()` übernimmt `G.world.lighting` auch selbst, sonst eigene Studio-Umgebung), `warmup(renderer, ids?)` (alle Waffen bauen + Shader kompilieren), `dispose()`. Qualität: folgt `G.renderer.quality`/`onQualityChange` (auf 'low' ohne Kantenlicht, kleinerer Hülsen-Pool). Hände: Griff-Löser (Finger legen sich an Griffkörper an, Zeigefinger am Abzug, Daumen gesucht), Unterarm folgt der Handachse.
- 2026-10-04 — world — Ergänzungen: `range`-Klappziele melden Treffer selbst, solange kein Trainingsmodus läuft (`world.targetsAuto = true`; bei `G.mode.id === 'training'` steuert modes/training.js Klappen/Trefferpunkte allein) → Ereignis `target:hit { target, targetId, lane, distance, zone, point, shooter }`, Ziel klappt weg und nach 2,5 s wieder hoch. Kollision: `world.collider` ist weiterhin ein `three/addons` **Octree** (gleiche Abfrage-API), wird aber über `world/collider.js` (`buildColliderOctree`) mit begrenzter Tiefe gebaut (vorher bis 11 s Ladezeit bei dichter Geometrie, jetzt < 1 s). NavGraph: Verbindungen in beide Richtungen geprüft, zusätzlicher Strahl knapp über Stufenhöhe (0,5 m), max. begehbare Neigung 45°, keine Knoten auf Brüstungen/Fensterbänken; per Kapsel-Lauftest (engine/physics.js folgt A*-Pfaden, alle Karten fehlerfrei) geprüft. Hinweis an bots: Wegpunkt erst als erreicht werten, wenn auch die Höhe passt (|dy| < 0,6 m) – sonst schneiden Bots an Treppenpodesten Ecken ab. Karten `altstadt` + `werk` fertig (Wahrzeichen, Dachrouten, Laufstege, Innenräume); `world.stats` zusätzlich `colliderMs`, `lightMs`.
- 2026-10-04 — ballistics — **Vorab-API WeaponController/WeaponSystem (weapons/index.js, controller.js, grenades.js; stabil, wird gerade gebaut):** `G.weapons.createController(actor, loadout)` → Controller. **Intent** (Spieler wie Bots, §7 + player.js): `{ fire, firePressed, ads, reload, swap, slot (1|2|null), grenade (gedrückt), grenadeHeld, melee, sprinting, moving, airborne, onGround, crouching, sliding, speed, lookDX, lookDY, frozen }`, optional für Bots `grenadeCook` (s vorkochen), `holdBreath`. **Felder (nur lesen):** `slots [{id, def, mag, reserve}]`, `index`, `current`, `currentDef`, `equipment.lethal {id, count}`, `adsProgress` (0..1 linear), `ads` (Anschlag gewünscht), `spread` (halber Kegel, rad – HUD-Fadenkreuz), `isReloading`, `reloadProgress` (0..1), `reloadEmpty`, `isSwitching`, `switchProgress`, `canSprint`, `lastShotTime`, `shotIndex`, `isFiring`, `isMeleeing`, `isThrowing`, `cooking` (Splint gezogen, kochbar), `cookTime` (s seit Splint), `fuseLeft` (s bis Explosion in der Hand), `scoped` (Scharfschützen-Overlay aktiv; Quelle wie bisher `G.viewmodel.rig.showScopeOverlay`), `holdingBreath`, `breath` (0..1 Atem), `autoFireRange` (m), `autoFireReady` (bool), `viewModel` (nur Spieler). **Methoden:** `update(dt, intent)`, `refill()`, `setLoadout({primary, secondary|null, lethal|null})` (Gun Game/Schießstand; Messer als primary erlaubt), `reload()`, `cancelReload()`, `getMuzzlePosition(out)`, `dispose()`. Bots: Reserve läuft nie leer, Schaden × `actor.damageScale`, Mündung aus `actor.getMuzzlePosition(out)` falls vorhanden, Rückstoß über `actor.addRecoil?.(pitch, yaw)`. **WeaponSystem:** `grenades` (aktive: `{type, actor, position, velocity, fuse, radius, stuckTo}` – Bots können ausweichen), `dangerAt(pos, margin=1) → {grenade, distance}|null`, `grenadeAim(actor, targetVec3, type='frag') → {yaw, pitch, reachable, flightTime}` (Wurfwinkel für Bots), `throwGrenade(actor, type, {cook})`. **Ereignisse zusätzlich:** `weapon:fire` + `{muzzle, pellets, shotIndex, ads}` (genau 1× pro Schuss, Magazin bereits dekrementiert), `weapon:reload` + `{interrupted}`, `weapon:switch` + `{from, slot}`, `weapon:melee {actor, phase:'swing', lunge, target}` (1× pro Hieb), `weapon:meleeHit {actor, target, backstab, killed}`, `tracer {from, to, actor, weaponId, hit}` (nur Leuchtspur-Kugeln), `grenade:pin {actor, type}`, `grenade:throw` + `{cooked}`, `grenade:bounce` + `{surface, type}`, `grenade:stick {actor, type, position, target}`.
- 2026-10-04 — ui — **modes/ (fertig):** `createMode(G, id, opts)` → `TdmMode|FfaMode|DomMode|GunMode|TrainingMode` (gemeinsame Basis `modes/base.js`). Felder: `id, def, teams, scores ({A,B} bzw. {actorId: n}), scoreLimit, timeLimit, timeLeft, elapsed (nur playing), overtime, isOver, result, endReason, respawnDelay, objectives, streaks, medals`. Methoden: `attach/detach/start/update/forceEnd/end(reason)/chooseSpawn/canRespawn/scoreboard()/placementOf(actor)/award(actor, reason, points?)/leader()`; FFA/Gun zusätzlich `standing(actor)`; Gun `levelOf(actor)`, `weaponFor(level)`, `steps`; Dom `objectiveFor(bot)`, `tickIn`; Training `targets`, `summary()`, `parcours`, `interact()`, `startParcours()`, `abortParcours()`, `bestTime(weaponId?)`, `setWeapon(slot, id)`. Punkte nach `SCORE_RULES` (+ neu `neutralize`, `destroy`; Anzeigetexte `SCORE_LABELS`, Teamnamen `TEAM_NAMES`, Medaillen zusätzlich `mvp`, `abwehr` in modes.data.js – nur additiv). **Respawn:** Modus korrigiert `victim.respawnAt` nach mains Kill-Handler (kleineres Team −0,35 s/Spieler, größeres +0,6 s/Spieler) und setzt `victim.respawnDelay` (HUD-Balken). **Ende/Verlängerung:** Gleichstand bei Zeitende → 60 s Verlängerung (`mode:overtime`), nächste Führung entscheidet, sonst Unentschieden; FFA Platz 1–3 = Sieg; Schießstand endet nur über „Training beenden“ (Pause) → `result.training`, `draw:true`. **result** zusätzlich `{ modeName, mapName, teams, winnerName, reason ('score'|'time'|'overtime'|'forced'|'finished'), overtime, placement, players, scoreLimit, timeLimit, scoreUnit, mvpName, teamMvp:{A,B}, extra }`, Tabellenzeilen `{…, captures, extra:{label,value}, isBot, mvp, teamMvp}`, `playerSummary.placement/players`. **Ereignisse** zusätzlich: `mode:overtime`, `mode:tick {scores, held}` (Herrschaft), `objective:captured {objective, team, prev}`, `objective:neutral {objective, by, prev}`, `gun:promote {actor, level, weaponId, final}`, `gun:demote {actor, by, level}`, `training:hit {target, point, zone, damage, distance, killed, ttk}`, `training:parcours {phase:'countdown'|'start'|'progress'|'done'|'abort', …}`, `training:weapon`, `streak:denied {actor, streakId, need}`, `streak:hit {entity, attacker, amount, destroyed}`, `streak:expired`. Waffenspiel setzt Loadouts im nächsten Modus-Takt (nicht mitten im Schuss): `weapon.setLoadout({primary, secondary:null, lethal:null})`. Schießstand hüllt `world.raycast` (Zieltreffer), Serienprämien hüllen es für Wachgeschütze – beide stellen das Original bei `detach()` wieder her. Bots ohne eigene Serienlogik nutzen Prämien automatisch; ein BotManager kann das mit `handlesStreaks = true` abschalten und `G.mode.streaks.activate(bot, id, {target})` selbst aufrufen.
- 2026-10-04 — ui — **ui/ (fertig):** `HUD` (`ui/hud.js` + `minimap.js`, `killfeed.js`, `scoreboard.js`, `strike-target.js`) mit `openStrikeTargeting({radius, spacing, onConfirm(Vector3), onCancel})` / `closeStrikeTargeting()` (Zielkarte; Eingabe ist solange per `input.setEnabled(false)` gesperrt); interaktive HUD-Teile (Parcours-Knopf, Punktetabelle, Zielkarte) liegen in der neuen Ebene **`#hud-top`** (z-index 25: über `#touch-ui`, unter `#menu-root`), die das HUD selbst in `#game-root` anlegt. HUD-Zeitgeber laufen in Echtzeit (`G.time.real`). HUD setzt bei Waffenfeuer `actor._suppressedShot` (Minikarte) und nutzt bei mittlerer+ Qualität `renderer.setPost({desaturate})` bei wenig Leben (beim detach zurückgesetzt). Touch-Serienknöpfe `.tc-streak` bekommen `--sp` (Fortschritt 0..1) und `data-left` (fehlende Abschüsse). `Menus` (`ui/menus.js` + `lobby.js`, `preview3d.js`, `settings-panel.js`, `controls-help.js`, `endscreen.js`, `mapart.js`): zusätzlich `showControls(from)`, `showArmory()` (Schießstand), `sound(name)`, `preview` (3D-Waffenvorschau der Lobby; zeichnet nur in der Lobby direkt mit `G.renderer.renderer` auf den Spiel-Canvas, kein zweiter WebGL-Kontext), `lobby.config()`. Lobby liest beim ersten Aufruf `G.params` (mode, map, diff, allies, enemies, primary, secondary, lethal). `#match-banner` erhält eine Unterzeile `[data-banner-sub]` (Teamstand/Platz; Schießstand: „Training beendet“). Tastatur: Pfeile = räumliche Navigation, Esc = zurück/fortsetzen; Gamepad in allen Menüs: Steuerkreuz/Stick, A wählen, B zurück, LB/RB Reiter, Start fortsetzen (Aktionen beim Loslassen, damit nichts ins Spiel durchschlägt). `body[data-menu]` spiegelt den offenen Bildschirm. Hinweis an world/site: Kartenvorschau nutzt `MAPS[id].layout/flags/palette` und nach dem ersten Match der Sitzung die echte Minikarte.
- 2026-10-05 — ballistics — **weapons/ (fertig, ersetzt stubs/weapons.js):** Vorab-API oben gilt unverändert; zusätzlich Controller-Felder `fireSpread` (tatsächlicher Kegel des nächsten Schusses), `reloadPhase` ('start'|'insert'|'end'|null), `idealRange` (m, bis dahin hält die Nahbereichs-Schusszahl – für Bots), `maxRange` (= def.range), Getter `ammo {mag, reserve, magSize}`, `infiniteAmmo` (Bots + `G.mode.def.infiniteAmmo`), Methoden `melee()`, `switchTo(index)`, `onDeath()` (vom System bei `kill`: gezogene Granate fällt), `warmup()` (Spieler: Viewmodel-Shader der Ausrüstung bzw. aller Waffen in gun/training vorkompiliert). Verhalten: Feuermodi auto/semi/burst/bolt/pump mit Kadenz-Übertrag, Eingabepuffer 0,16 s (+ sprintToFire), Sprint → `sprintToFire`-Sperre; Nachladen taktisch/leer mit `insert` bei 76 %/64 % (Munition dann schon drin), Schrot Patrone für Patrone (Schuss bricht ab, sobald ≥ 1 Patrone drin), Abbruch durch Wechsel/Messer/Granate und beim Spieler durch erneutes Sprint-Drücken (`canSprint=false` während Nachladen/Messer/Wurf); leeres Magazin → automatisches Nachladen; ADS gesperrt bei Sprint/Wechsel/Nachladen/Messer/Wurf; Streuung Hüfte↔ADS × Laufen/Springen/Ducken/Rutschen + Aufblühen (erholt sich nach 70 ms); Rückstoß Muster + Zufall + firstShotMult × (ADS 0,82, Ducken 0,85, Luft 1,2, **Touch 0,72**) → `actor.addRecoil(pitch, yaw, recovery)`; Schrot im Sonnenblumenmuster (verlässliche Schusszahlen); Leuchtspur: Spieler jede 3. Kugel (Einzelfeuer jede), Bots jede 2., Schrot 2 Kugeln. Messer: Ziel im Kegel `arc` mit Sicht, Ausfallschritt bis `lungeRange` (Körper wird gezogen, Blick rastet ein), 135 Schaden (Rückenstich ×2), daneben → `impact {melee:true}`. Granaten: Splint bei 0,3 s (`grenade:pin`), Halten friert die Wurfanimation ein und kocht (nur `cookable`), Loslassen → Abwurf bei 0,66 s; zu lange gekocht → Explosion in der Hand; Physik mit Strahl-Sweep gegen `world.raycast` (Oberfläche je Abpraller), Reibung/Rollen, Wasser schluckt Granaten, Haftgranate klebt an Flächen und feindlichen Akteuren (fällt ab, wenn der Träger stirbt), Schwerkraft `GRENADE_GRAVITY = 16`. Spieler: Zielfernrohr-Schwanken (Achterfigur, `def.scopeSway`), Atem anhalten mit Shift (Gamepad: Sprint), auf Touch automatisch nach 0,35 s im Anschlag; 4,5 s Atem, danach 1,6 s außer Atem (`weapon:breath {actor, on, exhausted}`). Viewmodel bekommt `adsProgress` (eased), `reloadProgress`, `mag`, `onShot(strength, {empty, suppressed})`, `playGrenade(type, {hold:true})` + `releaseGrenade()`, `playMelee()` (beim Ausfallschritt passend zum Eintreffen), `cancelAction()`. Hilfsdateien: `weapons/ballistics/math.js`, `fxtex.js`, `fxlayers.js`, `lab.js`.
- 2026-10-05 — ballistics — **engine/effects.js (fertig, ersetzt stubs/effects.js):** 5 Draw Calls (Alpha-Partikel beleuchtet, Feuer unbeleuchtet alpha, additiv, Leuchtspur-Bänder mit Mindestbreite ~1,3 px, Glanz) + 1 instanzierter Einschusslöcher-Mesh (Lambert, polygonOffset, ≤ `preset.decals`, verblassen nach 28–45 s; Klappziele des Schießstands bekommen keine Löcher – `training:hit`/`target:hit` streicht sie). Hört auf `impact` (Normale wird zum Schützen gedreht), `actor:hit` (stilisierter Nebel, nie beim Spieler), `explosion` (Wasser → Fontäne), `tracer`, `weapon:fire` (Mündungsfeuer + Hülsen nur für Nicht-Spieler, z. B. Bots/Wachgeschütz; nutzt `muzzle` aus dem Ereignis), `kill` (Staub beim Aufschlag), `grenade:bounce`. Öffentlich: `impact(point, normal, surface, opts)`, `blood(point, dir, {headshot, killed, melee})`, `explosion(pos, radius, opts)`, `muzzleFlash(pos, dir, {cls, actor, scale})`, `tracer(from, to, {speed, seg, width, intensity, skip})`, `smoke(pos, {count, size, life, color, rise, alpha})`, `clear()`, `stats`. Explosion: Blitz, Feuerball (8-Phasen-Sprite-Sheet), Glut, Trümmer mit Bodenabprall, dunkler Qualm + Rauchsäule, Staubring, Brandfleck, Punktlicht nur ab „high“ (konstante Lichterzahl), `G.player.shake()` nach Distanz. Zielfernrohr-Glanz: gegnerische Akteure mit `def.scope.overlay === 'sniper'`, `adsProgress > 0,35`, Blick auf den Spieler (≤ 12,8°) und Sichtlinie. Mengen × `preset.particleScale`, Distanz-LOD, nichts hinter der Kamera; keine Allokationen pro Frame. Prüfseite `dev/ballistics.html` (Einschläge per Klick je Oberfläche, Sperrfeuer, Schrot, Scharfschütze, Explosionen Land/Wasser/Luftschlag, Glanz, Qualitätsstufen, TTK-Tabelle).
- 2026-10-05 — ballistics — **weapons.data.js (Balance, Exporte unverändert):** neues optionales Feld `scopeSway` (rad; SK-14 0,0016, Brecher 0,007); Rückstoß vertikal ~15–20 % niedriger (KV-47 0,0088, M-17 0,0064, VP-9 0,0049, QX-90 0,0044, HM-60 0,0074); KV-47 `damage.min` 24 bis 50 m (5 Treffer auf Distanz), HM-60 `min` 24; Bulldog 18→4 Schaden je Schrotkugel zwischen 5 und 20 m, Streuung 0,056/0,04 (Ein-Schuss-Abschuss bis ~10 m bei vollem Treffer); Wurfgeschwindigkeit Splitter 20, Haft 18,5 m/s. TTK Körper (Nahbereich): KV-47 4×/321 ms, M-17 4×/257, VP-9 4×/220, QX-90 4×/196, HM-60 4×/300, SK-14 2×/240, Brecher 1×, Bulldog 1×, P-9 4×/429, Adler 3×/500. **Chirurgische Änderung an engine/input.js (core):** Touch-Auto-Feuer feuert nur, wenn `player.weapon.autoFireReady !== false` und das Ziel innerhalb `weapon.autoFireRange` liegt (Schrot 13 m, MP 30, SG 48 …; Scharfschütze erst im Anschlag).
- 2026-10-05 — ui — Nachträge: `G.mode.streaks.isRevealed(actor, by?)` – optional `by` (Team 'A'|'B', Akteur oder Akteur-Id) prüft nur den Aufklärer dieser Seite (FFA: nicht der eines Dritten; ohne `by` wie bisher „irgendein gegnerischer“); Lobby übernimmt `time`/`score` aus der URL in `onStart(cfg)` (nur solange der URL-Modus gewählt bleibt); HUD: Atem-Anzeige im Scharfschützen-Zielfernrohr (liest `weapon.breath`/`holdingBreath`, Hinweis „Umschalt/L3 halten“), „… bereit.“-Hinweis verschwindet beim Einsatz der Prämie; Endbildschirm-Kopf bricht auf Telefonen um. Geprüft mit echtem `bots/manager.js` (objectiveFor, streaks.ready/activate/suggestStrikeTarget/uavActive/entities, getAimPoint) – keine Konsolenfehler. **Hinweis an core:** `input.js` ruft `_maybeFullscreen()` in `pointerdown` (Touch) auf – dort gibt es noch keine Nutzeraktivierung (erst `pointerup`/`touchend`/`click`), Chrome warnt „requestFullscreen … user gesture“ und Vollbild greift erst über main (Start/Fortsetzen-Klick).
- 2026-10-05 — bots — **bots/ (fertig, ersetzt stubs/bots.js; main lädt `bots/manager.js` automatisch):** **`createSoldier({ team, variant, camo, quality, models, name })`** (`bots/character.js`) → `Soldier` mit `root`, `bones`, `skeleton`, `meshes[3]` (eine SkinnedMesh je Detailstufe: alle Teile starr gewichtet in EINER Geometrie + EINEM Material → 1 Draw Call + Waffe), `setWeaponModel(group, def)`, `hitboxes` (Getter, Welt: `[{name, zone:'head'|'body'|'limb', a, b|null, r}]`, folgen der Pose), `raycast(ray, maxDist)` → `{distance, point, normal, zone, part}`, `animate(dt, { velocity (Welt) | speed+strafe, aimYaw, aimPitch, crouch, sprint, ads, onGround|airborne, firing, shotStrength, reloading, reloadProgress, reloadEmpty, perShell, throwing, cooking, meleeing, idleLook, position })` → Körper-Gierung, `playHit(dir, zone, amount)`, `playDeath(dir, { velocity, zone, strength, explosive, scene })` (Verlet-Ragdoll, 13 Partikel, Boden über `world.groundHeight`, Wände über `world.raycast`; Waffe fällt als eigenes Objekt; ab 4,5 s Auflösen per Shader, dann `state:'hidden'`), `updateDead(dt, world)`, `updateLod(dist, quality)`, `setShadows(on)`, `getMuzzlePosition(out)`, `getHeadPosition(out)`, `joint(boneIndex|'head'|'hipL'|'hipR', out)`, `reset(position, yaw)`, `hide()`, `dispose()`; Exporte `VARIANTS` (8: Sturm, Späher, Funker, Grenadier, Schatten, Bastion, Kundschafter, Pionier), `SCHEMES` (A „Nordwind“ grau-grün/blau, B „Wüstenfuchs“ sand/rotbraun/rot, FFA urban/wald/nacht/schnee/sand), `HITBOXES`. Teile: `soldier/rig.js` (17 Knochen), `soldier/gear.js` (Geometrie-Cache Variante×Schema×LOD: 6,2–8,7k / 2,3–2,9k / 0,6–0,9k Dreiecke), `soldier/materials.js` (prozedurale Tarn-/Gewebetexturen, Attribut `aNp` = Tarnanteil/Gewebe/Leuchten/Glanz, Randlicht, `uDissolve`), `soldier/animator.js` (Fuß-IK synchron zur Bodengeschwindigkeit, Hüftdrehung beim Seit-/Rückwärtslaufen, Zwei-Knochen-IK beider Hände an `rightHandGrip`/`leftHandGrip` inkl. Griffstil, Anschlag/Sprint/Nachladen mit Magazinwechsel/Ladehebel, Patrone für Patrone, Repetieren, Granatwurf mit Kochen, Messerstoß, Treffer-Zucken, Rückstoß-Federn), `soldier/ragdoll.js`, `soldier/ik.js`. **`BotManager`** (§8) zusätzlich: `handlesStreaks = true` (Bots setzen Aufklärer/Präzisionsschlag (`suggestStrikeTarget`)/Wachgeschütz selbst ein und nutzen `uavActive`/`isRevealed(actor, by)`; feindliche `streaks.entities` sind Ziele), `stats()` → `{bots, alive, states, ms, losPerFrame, pathQueue}`, `makeGun(def)`, Budgets pro Bild (Sichtstrahlen 48/26 bei low, Pfadsuchen 3/2), gestaffelte Wahrnehmung/Entscheidung, Frustum-Culling + Animationsrate nach Abstand (1/2/3, unsichtbar 1/6 – Trefferzonen bleiben aktuell), Schatten nur für die nächsten `preset.maxBotsVisibleShadows`, Namensschilder (Canvas-Sprites konstanter Größe, Verbündete blau immer bis 60 m, Gegner rot nur unter dem Fadenkreuz (`input.aimTarget`) oder < 7 m mit Sicht, Überlappungen werden entflochten). **Bot (Actor)** zusätzlich: `diff` (Profil aus `DIFFICULTIES` + abgeleitete Werte, `bots/difficulty.js`), `damageScale` (0,6/0,78/0,9/1,0), `memory`, `nav`, `gunner`, `goal {kind:'roam'|'engage'|'cover'|'retreat'|'heal'|'chase'|'hunt'|'flank'|'objective'|'evade'|'grenade'|'idle', …}`, `ai.target`/`ai.state` (nur lesen), `soldier`, `lane`, `alert(pos, now)`, `getMuzzlePosition`, `addRecoil` (mit Kompensation je Stufe); emittiert `footstep` synchron zum Aufsetzen der Füße. Hört `weapon:fire` (75 m, schallgedämpft 14 m), `footstep` (Sprint 20/Gehen 10/Ducken 3 m), `explosion`, `impact` (Kugeln < 2,5 m), `actor:hit`/`kill` (Teamfunk). Ziel- und Feuer-Modell: Reaktionszeit (Augenwinkel länger), Feder-Drehung mit `trackingSpeed`-Grenze, Zielfehler `aimError × (1 + accuracyFalloff·d)`, der im Gefecht auf ~35 % abklingt (Bewegung/Seitwärtslauf des Ziels/Treffer erhöhen ihn), Feuerstöße `burstMin..Max`, Einzelfeuer-Takt, Repetierer nur voll im Anschlag und ruhig, kein Feuer durch Verbündete, Granaten auf Gruppen/hinter Deckung mit `grenadeAim` (+ Kochen ab Veteran), Ausweichen vor `dangerAt`. Wegfolge: Wegpunkt erst bei |dy| < 0,6 m erreicht, Festhänge-Erholung in Stufen (Sprung+Seitschritt → neu planen → Ziel verwerfen → nächster Knoten → unsichtbar versetzen). Prüfstand **`dev/bots.html`** (+ `dev/bots.js`, `dev/bots-sandbox.js`): Galerie (alle Varianten × Schemata × Waffen, 22 Animationen, LOD-Wahl, Kameras inkl. Gesicht; `?view=gallery&scheme=B&weapon=knife&anim=reload&cam=close&focus=2&t=1.2`) und Sandkasten (echte Karte/Modus/Waffen nur mit Bots; Pfade, Sichtkegel, Zustände, Deckung, Navigation, Trefferzonen, Zeitraffer, Folgen; `?view=sandbox&map=werk&mode=dom&diff=elite&bots=12&dbg=paths,states`). Testwerkzeuge unter `tools/out/bots/` (`sim.mjs` simuliert Matches ohne Rendern ~25× schneller, `match.mjs`, `hit.mjs`, `leak.mjs`, `gal.mjs`). Hinweis an core: `stubs/bots.js` kann bei der Integration entfallen.
- 2026-10-05 — ballistics — Nachtrag: `setLoadout()` behält die gehaltene Waffe; fällt sie weg, bleibt der Slot aktiv (neue Pistole aus der Waffenkammer wird direkt gezogen), sonst Slot 0. Bots-Integration geprüft (echte BotManager-Bots: `grenadeAim`/`dangerAt`/`grenadeCook`/`cancelReload`/`getMuzzlePosition`/`damageScale`). Prüfwerkzeuge: `tools/out/bal-lab.mjs` (Spiel anhalten und deterministisch takten, Bilder per Canvas), `tools/out/bal-func.mjs` (alle Waffen: Kadenz, Nachladen, ADS, Wechsel, Sprint-zu-Feuer, Messer, Granaten), `tools/out/bal-prof.mjs` (Laufzeit je Subsystem im echten Match).
- 2026-10-05 — ui — **Schießstand-Spawn:** `TrainingMode.chooseSpawn()` setzt den Spieler (Start, Respawn, „Neu starten“) an die Feuerlinie der mittleren Bahn, Blick die Bahn hinunter (Gierwinkel 0). Abgeleitet aus `world.targets`: Bahnmitte = mittleres x der Ziele einer Bahn, Feuerlinie = max(Ziel-z + `distance`), Standplatz 2 m dahinter, Höhe über `world.groundHeight`. Ohne Ziele wie bisher `chooseSpawn` aus spawns.js.
- 2026-10-05 — ui — **modes/** ohne Ersatztabellen: base/medals/streaks/gun/dom/training/index importieren `MODES`, `SCORE_RULES`, `MEDALS`, `MEDAL_RULES`, `multiKillMedal`, `isLongshot`, `STREAKS`, `STREAK_ORDER` (modes.data.js) und `WEAPONS`, `EQUIPMENT`, `GUN_GAME_STEPS` (weapons.data.js) direkt statt `G.data … || FALLBACK`. Medaille „Kollateral“ zählt Schüsse selbst über `weapon:fire` (kein Lesen von `actor._shotSerial` aus combat.js mehr).
- 2026-10-05 — ui — **Ergebnis FFA/Waffenspiel je Spieler:** `result.winner` bleibt `'draw'` bei Gleichstand an der Spitze, aber `result.draw` und `playerSummary.result === 'draw'` gelten nur für die punktgleichen Führenden; alle anderen: Platz ≤ `def.winPlaces` → `'win'`, sonst `'loss'` (Profil/Matchbonus, Banner, Endbildschirm „Gleichstand“ statt „Platz n“). Chirurgisch in engine/audio.js: Sieg/Niederlage/Unentschieden-Stinger richtet sich nur nach `r.draw`/`r.playerWon`.
- 2026-10-05 — ui — **Punktetabelle ohne Ping:** `mode.scoreboard()`-Zeilen haben kein Feld `ping` mehr, `scoreboardHtml()` keine Option `showPing`/Spalte `.sb-ping` (das Spiel läuft offline gegen Bots).
- 2026-10-05 — ui/ballistics — chirurgisch in weapons/controller.js: öffentlicher Getter **`exhausted`** (bool, „außer Atem“ nach dem Atemanhalten); das HUD liest ihn statt `_exhausted`.
- 2026-10-05 — ui — **modes.data.js (additiv):** `MODES[id].sizeRule` (Vorlage der Besetzungszeile `rules[0]`: `{team}`, `{enemies}`, `{players}`, `{mates}`) und `rulesFor(modeId, { allies, enemies })` → Regelliste mit passender Besetzungszeile („1 gegen 8 – du allein“); ohne Angaben identisch mit `rules`.
- 2026-10-05 — ui — **Lobby:** Regeln folgen den gewählten Teamgrößen (`rulesFor`), der Profil-Chip aktualisiert sich bei `settings` `playerName` und `profile.onChange` (Abmeldung in `unmount()`), `time`/`score` aus der URL übernimmt die Lobby nur noch mit `debug=1` (`G.debug`). Begriff „EP“ statt „XP“ in Lobby und Endbildschirm (wie auf der Website). Kopfzeile passt ab 640 px Breite (`.lb` Spalte `minmax(0,1fr)`, unter 760 px nur Dienstgradabzeichen, unter 700 px kleinere Marke); bei ≤ 430 px Höhe stehen die Vorlagen neben den Slot-Reitern (Waffenliste ≈ 186 px statt 128 px).
- 2026-10-05 — ui — **Endbildschirm:** `[data-xp-count]` enthält von Anfang an den Endwert („+240 EP“, auch für Tests und Screenreader); das Hochzählen ist nur eine optische Ebene (`.is-counting` + `data-shown` → CSS `::after`, für Hilfsmittel leer), ohne Animation bei reduzierter Bewegung oder verborgenem Tab. Lange Zellbeschriftungen tragen einen weichen Trennstrich (U+00AD, z. B. in „Unterstützung“), damit sie in schmalen Zellen sauber umbrechen.
- 2026-10-05 — ui — **Touch-HUD (game.css + hud.js):** `--tc-u` ist jetzt an `#game-root` definiert (nicht mehr an `#touch-ui`), damit `#hud` sie erbt; das HUD setzt `body[data-player-dead="1"]`, solange der Spieler tot ist → Touch-Steuerung außer Pause/Tabelle ausgeblendet. Touch-Layout: Leben klein unter der Minikarte und nur unter vollem Wert (`.h-health.is-full`), Abschussmeldungen unter der Minikarte rechts neben dem linken Feuerknopf (bis zur Bildmitte, 3 Zeilen bei ≤ 430 px Höhe, sonst 4), Schießstand-Panel oben rechts unter Pause/Tabelle (doppelte Zeilen ausgeblendet; `dt`/`dd` tragen `data-k`), Punktetabelle bleibt in `#hud-top`, lässt aber Berührungen durch (`pointer-events: none`), `.h-top` auf 0,9 skaliert mit 12,5-px-Beschriftungen, Flaggenmarker weichen Touch-Knöpfen, ruhendem Stick und Munitionsanzeige aus (Rechtecke alle 2 s bzw. nach Größen-/Moduswechsel). Chirurgisch an der Touch-Regel `.tc-stick[data-idle="1"]`: Deckkraft 0,5 → 0,3. Todesbildschirm ohne Halbbreiten-Schrumpfung (Infozeile bricht nur zwischen Angaben um).
- 2026-10-05 — ui — Kleinigkeiten: Schießstand-Startbanner ohne großen Titel (das Panel nennt den Modus); „Keine Munition“ verweist ohne einsatzfähige Zweitwaffe (Waffenspiel) auf das Messer statt auf den Wechsel; Einstellungen „Steuerung“ nach Eingabeart sortiert (Touch zuerst bzw. Maus zuerst, Rest unter Zwischenüberschrift); Tastenhinweise (`.m-btn kbd`) auf Touch ausgeblendet; Lobby-Waffenvorschau mit kühlem Gegenlicht und Lichthof hinter dem Modell (Waffe füllt ≈ 90 % der Bühnenbreite); Minikarte setzt `ctx.font` nur noch bei Änderung (keine erzwungene Stilberechnung je Bild).
- 2026-10-05 — core — **Tastenbelegung (input.js, endgültig; für site/ui-Steuerungsübersichten):** Desktop: WASD/Pfeiltasten laufen, Maus zielen (Pointer-Lock), LMT feuern, RMT zielen (halten), R nachladen, Leertaste springen, **C ducken (Tippen) / rutschen beim Sprinten – Strg ist nicht mehr belegt** (Strg+W/T/N sind Browser-Kürzel, die eine Seite nicht abfangen kann), Umschalt sprinten, V/Maus-Seitentaste 4 Messer, G/Q Granate, 1/2/Mausrad/Maus-Seitentaste 5 Waffe, 3/4/5 Serienprämien, Tab Punktetabelle, E/F Interaktion, Esc Pause. Gamepad unverändert. Touch unverändert; Vollbild wird nach Verlassen beim nächsten Loslassen eines Fingers (pointerup = Nutzeraktivierung) wiederhergestellt statt bei pointerdown.
- 2026-10-05 — site — Rückkehr per bfcache: `assets/js/site/main.js` schickt bei `pageshow` mit `persisted` ein synthetisches `storage`-Ereignis (`key: null`, `storageArea: localStorage`); `settings.js`/`profile.js`/Website-Speicher lesen über ihre vorhandenen Tab-Sync-Handler neu (keine API-Änderung an den Stores; ein zusätzlicher eigener `pageshow`-Handler in core wäre unschädlich).
- 2026-10-05 — site — Neue Dateien im Wurzelordner: `manifest.webmanifest` (Start `spielen.html`, `display: fullscreen`, `orientation: landscape`, Symbole 192/512 inkl. maskierbar) und `404.html` (in sich geschlossen); Symbole `assets/img/{apple-touch-icon,favicon-32,icon-192,icon-512}.png`. **Kreuz-Änderungen:** `spielen.html` (core) bekommt im `<head>` drei Zeilen (`rel=manifest`, `rel=apple-touch-icon`, PNG-Favicon); `README.md`: Steuerungstabelle wie `input.js` (nur C duckt, Steuerkreuz ▲ ◀ ▶, R3 = Messer, Menü = Pause) und Hinweis auf die absoluten Vorschau-Adressen (`canonical`/`og:url`/`og:image` in `index.html`).
- 2026-10-05 — site — Steuerung der Website spiegelt `engine/input.js`: `controls-view.js` exportiert `KEYS`, `PAD`, `TOUCH` (gemessene Touch-Knopflagen); `node tools/out/fix-site/bindings.mjs` vergleicht sie in beide Richtungen mit `KEY_ACTIONS`/`MOVE_KEYS`/`MOUSE_ACTIONS`/`PAD_ACTIONS` (Bitte an core: nach Belegungsänderungen ausführen; ein kleines reines Datenmodul mit den Tabellen könnte die Website direkt importieren – `input.js` selbst zieht three.js nach).
- 2026-10-05 — site — Website-interne Ergänzungen: `stage3d.frame({x0,x1,y0,y1})` + Getter `view`; `ballistics.js` `shotsNeeded(def,d,zone)`, `hitTtk`, `rankForSightlines(dists)`, `rankAt()`-Zeilen mit `fired` (Duellzeit mit erwarteter Trefferquote aus `adsSpread`, Zielfehler 0,0025/`adsZoom` und verbleibendem Rückstoß); `plan.castVisibility()` liefert zusätzlich `dists` (360 Sichtweiten, sortiert); `fmt.js` `TERMS` + `count(n, key)` (Begriffe/Numerus wie im Spiel: XP, Unterstützungen …); `fit.js`-Messabzüge `position: fixed`.
