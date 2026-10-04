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
