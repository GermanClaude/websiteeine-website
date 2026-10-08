# Mehrspieler – API-Notizen der Bausteine (Schritt 1, 08.10.)

## netcore

## net/index.js

**Exports:** `NetSystem`, `NET_VERSION=1`, `ONLINE_MODES=['tdm','ffa','dom','kc']`, `HOST_ID=1`, `FIRST_CLIENT_ID=2`, `FIRST_BOT_ID=1000`, `MAX_PLAYERS=32`, `NET_ERROR_TEXT` (code → German text), `DEFAULT_ROOM`, `normalizeSettings(partial, base, hostName)`, `sanitizeLoadout(lo)`, `loadoutWeapons(lo)` (returns null if the loadout is incomplete), `mapsForMode(mode)`, `netError(code, text)`.

### Construction
- `new NetSystem(G)` opens no connection. It subscribes to `G.events` `match:state`; when the state becomes `lobby` on the host, the room goes back to `lobby`.
- Fields:
  - `online`, `role`, `selfId`, `room {code, public, state, settings, hostName}`, `roster [{id, name, team, isHost, isBot:false, level, ping, ready, cls, loadout, kd}]`.
  - `sync = null`: preUpdate, postUpdate, onMatchStart, onMatchEnd and onTeardown are delegated to it.
  - `startGame = null`: the start function. If null, `G.menus.onStart(cfg)` (= main.startMatch) is used.
  - `build` (BUILD from shared/build.js), `anticheat` (AntiCheat, host only after `host()`), `history` (PositionHistory, host).
  - `relays`: `relaysFromUrl()` or the defaults. `ice = []` when every URL relay is local.
  - `relayStatus {open, total}`, `joinTimeout`.

### Session
- `await host(settings)` → `{code}`. Throws `.code` `'kein-relay'`.
- `await join(code, {name})` → `{id, team, room}`. Throws `.code` in `kein-relay`, `kein-host`, `keine-antwort`, `abgelehnt:voll`, `abgelehnt:version`, `abgelehnt:gekickt`, `abgelehnt:fehler`, `verbindung-fehlgeschlagen`, `abgebrochen`. Join failures are only thrown, never emitted as `net:error`.
- `leave(reason)`; `kick(id, reason)`; `setTeam(id, 'A'|'B')` (refuses B in coop); `updateSettings(partial)` → new settings.
- `startMatch()` → host cfg.
- `setLoadout({cls, loadout})`: a client sends `'loadout'`; on the host it updates its own entry.
- `watchPublic(cb)` → `stop()`. Each entry is `{code, name, map, mode, players, max, level, ver, state, pvp, host, compatible, full, seen}`.
- `await quickPlay({name, mode?, filter?, timeout=4000})` → join result or null.
- `recommendation()` → `{max, reason, upload, fps, cores, memory, measured}`.
- `markReady()`, `allReady()`, `rosterEntry(id)`, `loadoutWeapons(id)`, `dispose()`.

### Messages
- `send(to, msg, except?)` with `to` = netId | `'all'` | `'others'` | `'host'`; returns the number of recipients.
  - Host: `'others'` means all clients except `except`.
  - Client: `to=1` or `'host'` goes direct. Other targets are forwarded by the host, but only for types not in the reserved set (join, ready, loadout, hit, melee, throw, leave, welcome, room, roster, start, spawn, kill, mode, ev, end, kick, host-away, correct, reject). **Clients must send hit/melee/throw with `send(1, …)`.**
  - The host drops host-only types coming from clients.
- `sendFast(to, arrayBuffer, except?)`: a client always sends to the host. Packet types ≥ 200 are reserved and never routed.
- `on(type | '*', fn(msg, fromId))` → off; `onFast(fn(buf, fromId))` → off.
- Room-level types are processed first, then also routed to `on()` handlers: join (after welcome), ready, loadout (sanitized), leave, room, roster, start, kick, host-away.

### Time
- `peerRtt(id)` in ms.
- `serverTime()`: host seconds since the room opened; clients estimate it via `_ts`/`_tr` every 2 s using the minimum-RTT sample (measured < 1 ms deviation locally).
- `timeSynced` getter.

### Hooks
- `preUpdate(dt)` also measures fps; `postUpdate(dt)`.
- `onMatchStart(cfg)` calls `markReady()` (client sends `'ready'`, host marks itself ready), then `sync.onMatchStart`.
- `onMatchEnd(result)` calls `sync.onMatchEnd` first, then the host sets the room back to `'lobby'`.
- `onTeardown()`; `actorById(netId)` looks up `actor.netId` in `G.actors` (cached, rebuilt each frame or on a miss).

### Anticheat helpers (host)
- `checkState(id, state, ctx)` runs `anticheat.onState` and automatically sends `'correct' {pos}`.
- `checkHit(id, claim, ctx)` fills in now, rtt, weapons, history, ffa and the roster loadout weapons. If `claim.t === 'melee'` it calls `validateMelee`.

### Events (G.events)
- `net:status {online, role, relays:{open, total}, state}`, `net:roster {roster}`, `net:room {room}`.
- `net:error {code, text}`: `code 'host-weg'` when the link drops, or when the host closes the room (text then says the host closed it).
- `net:kicked {reason}`, `net:peer {id, name, joined, reason?}`, `net:recommend {…}` (host).
- **Extra, not in the contract:** `net:host-away {away}`.

### cfg from startMatch / 'start' / welcome.cfg
- Fields: `{modeId, mapId, difficulty, allies, enemies, style, matchLength:'standard', timeOfDay, weather, timeLimit?, scoreLimit?, loadout?, crosshair, net}`.
- `weather` is a concrete id and `timeOfDay` is a concrete time or `'standard'`; never `'zufall'`. They are resolved with `resolveConditions` (G.modules.world or a lazy import of world/weather.js) and `Math.random` on the host.
- `allies` = bots on team A and `enemies` = bots on team B (absolute teams):
  - pvp: teamSize − humans per team.
  - coop: allies = teamSize − all humans, enemies = teamSize.
  - ffa: enemies = 2×teamSize − humans.
  - botFill false: 0 (in coop, enemies stays teamSize).
- `net = {role, selfId, team, roomCode, teamSize, pvp, botFill, maxPlayers, botsA, botsB, humans:{A,B}, ffa, conditions:{weather, time}, startedAt}`.
- On receipt, a client replaces `loadout` and `crosshair` with its own local values.

## protocol.js
- Packet types: `PKT_SNAPSHOT=1`, `PKT_STATE=2`, `PKT_INTERNAL_MIN=200`.
- Weapons: `WEAPON_INDEX` (sorted WEAPON_IDS), `NO_WEAPON=255`, `weaponIndexOf(id)`, `weaponByIndex(i)`.
- Flags: `FLAGS {ALIVE, CROUCH, PRONE, SPRINT, ADS, RELOADING, ON_GROUND, SLIDING, THROWING, MELEEING, SWIMMING}`, `packFlags(obj | num)`, `unpackFlags(n)`.
- `encodeSnapshot(tick, serverTime, entities)` / `decodeSnapshot(buf)` → `{type, tick, serverTime, entities}` or null.
- `encodeState(seq, clientTime, entity)` / `decodeState(buf)` → `{type, seq, clientTime, entity}` or null.
- Entity fields: `{id, x, y, z, yaw, pitch, vx, vy, vz, flags, weapon (index or id string), hp, lean (−1..1, i8×100), shots (mod 256), proneBlend (0..1)}`. Decoding adds `weaponId`.
- `packetType(buf)`. Sizes: 31 bytes per snapshot entity (11-byte header), 37 bytes per state.

## anticheat.js
- `new AntiCheat({onKick(peer, reason, text), threshold=20, damageMult, …})`.
- `onSpawn` / `onTeleport(peer, pos, now)`, `onCorrect(peer, pos, now)`.
- `onState(peer, {x, y, z, flags} | {pos}, now, {alive})` → `{ok, reason, correct?, kick}`.
- `onShot(peer, def, now)` → bool.
- `validateHit(peer, claim, ctx)` → `{ok, dmg, reason, kick}`.
- `validateMelee(peer, claim, ctx)`.
  - `ctx` = `{now, ffa, rtt, damageMult, weaponDef(id) | weapons, shooter:{alive, team, pos, weapons}, target:{alive, team, pos?}, history: fn(id, t0, t1) | PositionHistory, los?(o, p)}`.
- `strike()`, `score()`, `reset()`, `remove()`, and `log [{t, peer, reason, text, weight, score}]`.
- Also exports `PositionHistory(seconds)` with `.record(id, t, x, y, z)` and `.range(id, t0, t1)`, plus `AC_TEXT` and `AC_WEIGHTS`.
- The host's `onKick` calls `kick(id, 'Anti-Cheat: <text>')`. `startMatch` sets `anticheat.opts.damageMult` from the style's bulletMult.

## recommend.js
- `bandwidthFor`, `maxPlayersForUpload`, `maxPlayersForDevice`, `recommend()`, `UploadMeter`, `UNMEASURED_MAX=8`.
- The host measures every 1 s from the bytes it sends and the channels' bufferedAmount.
- Measurement counts only after 5 s at ≥ 3 KB/s. Without congestion the value never drops below 8.

## puppets

bots/bot.js (exports: Bot, blankStats, NET_FLAGS, netPoseOf); re-exported from bots/manager.js, so also reachable as G.modules.bots.netPoseOf / G.modules.bots.NET_FLAGS.

NET_FLAGS = {alive:1, crouch:2, prone:4, sprint:8, ads:16, reloading:32, onGround:64, sliding:128, throwing:256, meleeing:512, swimming:1024} (contract §5).

bot.netPose — written by the sync module every frame before G.bots.update; values already interpolated. Shape:
  { pos:[x,y,z] | {x,y,z},
    vel:[x,y,z],
    yaw, pitch,
    flags,
    weapon,        // id string | numeric index into G.data.WEAPON_INDEX (fallback: G.bots.weaponIndex() = Object.keys(WEAPONS).sort()) | def object
    lean,          // -1..1
    shots,         // counter mod 256
    proneBlend?,   // 0..1, optional
    hp?,           // omit on the host -> the puppet regenerates locally like the player
    ads?,          // 0..1, optional
    reloadEmpty?, cooking? }
  - Missing fields are tolerated; missing flags count as alive|onGround.
  - Reuse one object per puppet or assign a new one; both work.
  - Life and death are NOT taken from flags:
    - death: call bot.onDeath({dir, killer, weaponId, headshot, explosive}) or let combat.damage do it on the host;
    - spawn: bot.respawn({position: Vector3, yaw}) or G.spawnActor(bot) on the host. respawn() sets bot.netPose = null, so write a fresh pose afterwards.
  - The first shots value after spawn or join only initialises the counter (no backfire). A jump of more than 64 counts as a reset.

bot fields:
  bot.puppet (bool), bot.netId, bot.isRemoteHuman, bot.isHuman (getter = isPlayer || isRemoteHuman; setter sets isRemoteHuman), bot.netFlags (last applied flags), bot.manualPlates (true for puppets).

bot methods:
  - bot.setNetWeapon(ref, {silent}) → bool. Equips the weapon. If it is not in the loadout, it replaces the primary or secondary slot. Updates the third-person gun. Emits weapon:switch {cosmetic:true} unless silent.
  - bot.setNetLoadout({cls, primary, secondary, lethal, tactical}) — new loadout/class (e.g. when a spawn message carries a changed loadout). The Soldier look is not changed.
  - bot.setPuppet(on) — prefer G.bots.setPuppet(bot, on), which also leaves the squad.
  - bot.netState(out) = netPoseOf(bot, out).

netPoseOf(actor, out={}) → {pos:[3], vel:[3], yaw, pitch, flags, weapon (id), hp, lean, shots, proneBlend}
  - Works for Bot, Player and puppets.
  - shots = actor._shotSerial & 255 (combat increments it on every weapon:fire). Puppets pass their netPose shots and flags straight through.
  - The host uses it to build snapshots; a client uses it for its own state.

Puppets emit these events themselves — the sync module must NOT emit them for puppets; it only writes netPose. All carry cosmetic:true.
  - weapon:fire — exact payload of WeaponController._fire: {actor, weaponId, origin, dir, suppressed, muzzle, pellets, shotIndex, ads, cosmetic:true}
  - tracer — {from, to, actor, weaponId, hit, cosmetic}
  - impact — {point, normal, surface, weaponId, actor, cosmetic}, NO shooter field
  - bullet:whiz
  - weapon:reload — phases start / insert / end
  - weapon:switch
  - weapon:melee — phase 'swing'
  - grenade:pin
If the host also replays bullet impacts via 'ev', set G.bots.puppetFx.impacts = false. G.bots.puppetFx.whiz controls the near-miss whiz.

BotManager (G.bots):
  - spawnPuppet({netId, name, team:'A'|'B'|null, cls, loadout:{primary, secondary, lethal, tactical, melee}, variant (index|id), scheme, isHuman, spawn:{position:Vector3|[x,y,z], yaw}}) → Bot
    - Pushed into bots and G.actors; nameplate acquired.
    - id = 'net_'+netId (made unique if taken).
    - isBot = !isHuman.
    - Not alive until respawn, unless spawn is given.
    - Default variant is deterministic from cls + netId. Default scheme: schemeForTeam(team), or for FFA ffaSchemes[netId % n].
    - Send variant/scheme of host bots in the roster (bot.variant, bot.scheme) so clients match.
  - removeBot(bot) → bool. Safe mid-match. Disposes figures, corpses and gun; removes the bot from bots, G.actors, nameplates, its squad (empty squads deleted), path queue, intel/activity, other bots' memory/targets/orders. Emits 'actor:remove' {actor}.
  - addBot({team:'A'|'B'|null, difficulty?, modeId?}) → Bot. One AI bot exactly like spawnBots (role via planRoles(k+1), class, loadout, look, lane of existing squad mates, tactics.register). The caller then does G.spawnActor(bot) and assigns bot.netId.
  - puppetFired(bot, count) → n (max 4 per call) — called by the puppet itself. Exposed only for special cases.
  - setPuppet(bot, on) — AI bot ↔ puppet.
  - byNetId(id), puppets(), isPuppet(actor), weaponIndex().
  - stats() now also has a puppets count.

LOD and learning:
  - Puppets update every frame, with no sim-LOD skipping.
  - AI sim tier 0 when the bot's target is any human seen within 3 s (isPlayer || isRemoteHuman). Tier distances use the nearest human.
  - canTeleport also refuses when a remote-human puppet is within 18 m of the bot or its target point, or has line of sight to it within 220 m.
  - BotAdapt (learning bots) is deactivated whenever G.net && G.net.online (spawnBots, addBot and every update).

Nameplate pool max is 40.

Test page dev/puppet.html: ?auto=1&map=&mode=&quality=&ts= ; hook window.__puppet {phase, phaseB, proneReady, playing, done, ok, checks, results, errors, hold(on), heldFor, shotMode(on), run()}.

## ui

MENUS (ui/menus.js):
- menus.net = new NetMenus(menus), created in the constructor. It reads G.net lazily, so G.net may be created before or after the menus.
- menus.openJoin(code, {auto=true}): shows Lobby → Mehrspieler, fills the code and joins automatically. Use it for spielen.html?raum=CODE (pass G.params.get('raum')). If G.net is not there yet, the join is retried for up to 10 s.
- menus.openRoom(): room screen if G.net.online, otherwise the Mehrspieler tab.
- menus.showLobby(opts={}): opts.tab picks a tab ('deploy'|'loadout'|'progress'|'online').
  - If G.net.online && G.net.room it shows the room screen instead of the lobby, unless opts.room === false.
  - So main's toLobby() after a match automatically returns online players to the room.
- New screen names: 'room' and 'roomequip'. Esc / gamepad B are handled for both.
- showPause() online:
  - adds the online note, the room line and the host player list with kick;
  - hides "Neu starten";
  - "Match verlassen": a client calls G.net.leave('verlassen') and then onQuit(); the host only calls onQuit(), so the session stays open and the host lands back in the room.
- showEnd() online: "restart" → onQuit() (back to the room); "lobby" / "exit" → G.net.leave() then onQuit() / onExit(). Button labels are patched; endscreen.js is untouched.
- showEquip() online: also calls G.net.setLoadout({cls, loadout}) if that function exists.

NET-MENUS (ui/net-menus.js) exports:
- NetMenus class
- ONLINE_MODES, CODE_LENGTH
- NET_UI_ERRORS, netErrorText(code, fallback): '' for 'abgebrochen'
- parseRoomCode(text) → {code, bad, noCode, link}
- roomLink(code): absolute spielen.html?raum=CODE, carries over ?relays= if present
- pingTone(ms) → 'good' | 'ok' | 'bad' | 'none'

NetMenus methods:
- inRoom(), showRoom(), unmountRoom(), back(), askLeave(), leaveRoom()
- createRoom(extra, btn), roomDefaults(extra)
- startJoin(code), cancelJoin(), startQuick(), cancelQuick(), prefillJoin(code, {auto})
- mountPane(el) / unmountPane() (called by Lobby._syncTab)
- summaryHtml()
- pauseHtml(), bindPause(screen)
- toast(text, tone='info'|'ok'|'warn'|'error', lifeSec=4.5)
- dispose()

G.NET MEMBERS USED (contract §3, all called defensively):
- State: online, role, selfId, room {code, public, state, settings, hostName}, roster[{id, name, team, isHost, level, ping, ready, cls}]
- Session: host(settings) → {code}; join(code, {name}) throws Error.code; quickPlay({name}) → result | null; leave(reason)
- Host actions: kick(id, reason), setTeam(id, team), updateSettings(partial), startMatch() — must return a truthy cfg, otherwise the UI shows "Das Match konnte nicht gestartet werden".
- Other: watchPublic(cb) → stop, recommendation() → {max, reason}
- Optional extras: relayStatus {open, total}, setLoadout({cls, loadout}), peerRtt(1)

Room defaults passed to host(): {name:'', mode (lobby mode, or tdm if it is not online-capable), map, time, weather, difficulty, style, maxPlayers: min(8, recommendation().max), teamSize (bigger lobby side incl. player; FFA half the participants), botFill:true, pvp:'pvp', public:false | true for "Eigenes öffentliches Spiel"}.

EVENTS LISTENED TO:
- net:peer {id, name, joined, reason}: toast, unless reason is 'gekickt'
- net:kicked {reason}
- net:error {code:'host-weg'|'host-beendet'}: lobby notice. In a running client match: toast, then menus.onQuit() after 2.6 s, only if the match state is still loading/countdown/playing/paused and G.net is offline.
- net:host-away {away}: toast for clients
- net:roster, net:room, net:status (offline while in the room → lobby), net:recommend

SCOREBOARD (ui/scoreboard.js):
- scoreboardHtml(rows, opts): opts.online forces the ping column. Without it, the column appears automatically as soon as any row has a 'ping' key.
- Row fields used: ping (ms | null), isHost, isHuman. Bots show 'BOT'.
- New export netRows(G, rows): only acts while G.net.online. It fills ping/isHost from the roster via r.netId or r.actor.netId, isHuman from actor.isPlayer / isRemoteHuman / isHuman or the roster entry, and sets isBot=false for humans.
- liveRows(mode) applies netRows(mode.G, …) automatically, so the HUD needs no change.

CSS: .nm-* (lobby tab), .nr-* (room), .ps-online / .ps-room / .ps-net / .ps-np (pause), .sb-online / .sb-ping / .sb-human / .sb-host (scoreboard), .nt / .nt-item (toasts in #game-root, z-index 34).
ICONS added: link, copy, swap, userX, userPlus, signal, bolt, door.

## wip

**Setting**
- `settings.get('weaponObstruction')` returns 'overlay' (default) | 'raise' | 'tuck' | 'clip'.
- Local client setting only; nothing to sync over the network.

**ViewModel** (weapons/viewmodel.js)
- `_obstructionMode()` returns the effective mode.
- `setObstruction(mode | null)` forces a mode (for test pages).
- The controller no longer passes `s.wallDist` / `s.wallHit` in the viewmodel state.

**Rendering** (engine/post/pipeline.js, engine/renderer.js)
- New export `renderViewmodel(r, vmScene, vmCamera, camera, worldDepth)`.
- `PostPipeline.vmWorldDepth` (bool) is set by renderer.render every frame. It is true only in 'clip' mode: then the viewmodel is drawn against world depth using the main camera's near/far. Otherwise depth is cleared first.

**WeaponController** (weapons/controller.js)
- Removed: `wallHit`, `_obsHit`, `_obsLatch`, wallNeed/wallAds feedback.
- `_updateObstruct` (player only) uses reach 0 unless the mode is raise/tuck. Ray hits count only if `|normal·ray| >= OBSTRUCT_FACING` (0.5).
- New `_safeMuzzle(eye, muz)`, called in `_fire` for every actor including bots. The `weapon:fire` event's `muzzle`, tracer start and rocket origin are pulled to 5 cm before any wall between eye and muzzle. Bullets still start at the eye.
- `weapon:reload` event shape is unchanged: `{actor, weaponId, phase: 'start'|'insert'|'end', empty, interrupted, cause: 'sprint'|null}`. Audio cuts reload sounds on `phase 'end'` with `interrupted: true`. For remote puppets, the sync layer must emit the same events so clients cut the sound too.

**AudioEngine._reload**
- Returns after the end handling if there is no AudioContext or audio is still locked.

**slide.js**
- New export `slopeNormal(p)`: the ground normal for the slope physics, or null on stairs. Result is cached per 0.25 m in `p._stairChk`; it does one `world.raycast` down per 0.25 m, and only on sloped ground.
- `slideAllowed`, `slideBegin` and `slideStep` use it.

**debris.js**
- Module-internal helper `flushRanges(attr, n, min, max, size)`. It merges update ranges three.js has not uploaded yet instead of discarding them.
- DEBRIS_TIERS unchanged: shells 150 / 400 / 1000 / 2000.


## Härtetest (Schritt 3, 08.10.) – Ergänzungen

**Netz-Chaos (nur Prüfläufe)** – `net/index.js`: `chaosFromUrl(search)` liest `?netlag=<ms>&netjitter=<ms>&netloss=<%>`;
`NetSystem.chaos` = `{lag, jitter, loss}` oder `null` (dann bleibt jede Verbindung unverändert). Mit Chaos ersetzt
`LinkChaos` an jeder PeerLink-Instanz `sendRel`/`sendFast`/`close` (auch Ping/Pong und Zeitabgleich):
zuverlässig = Laufzeit lag ± jitter, Reihenfolge bleibt, „Verlust“ = Wiederholung (+ max(200 ms, 2 × lag), alle folgenden
warten), nie verworfen; schnell = Laufzeit je Paket (Reihenfolge darf kippen), Anteil `loss` verworfen; `close` wartet auf
die Warteschlange. Abgearbeitet per Zeitgeber + jedes Bild (`preUpdate`). Prüfwerkzeuge: `tools/mp-test.mjs --params="…"`,
`tools/mp-load-test.mjs --params="…"`, `dev/fake-client.html?…&netlag=…`.

**Neue/erweiterte Nachrichten**
- Client → Host `hold` {on, p} – Wiedereinstieg anhalten („Ausrüsten“ im Todesbildschirm, p = Restzeit steht) bzw. freigeben
  („Einsatz“). Host: `mode.holdRespawn(puppe)`, höchstens 30 s, endet mit jedem Spawn. Client meldet es selbst über
  `respawn:hold`; Ausrüstungswechsel im Match (`loadout:change` des Spielers) gehen als `loadout` an den Host.
- `hit`/`melee` (Client → Host) tragen `ip` = Darstellungsverzug des Schützen in s (`ClientSync.viewDelay()` =
  serverTime − Wiedergabezeit); der Host prüft den Zielverlauf `hitWindow + rtt + ip` (≤ 2 s) zurück.
- `hit` (Host → Clients) trägt bei Menschen `st` (Host-Zeit): ältere Schnappschüsse setzen die eigenen Lebenspunkte nicht zurück.
- `mode` trägt `st` (Host-Zeit): der Client verkürzt die Restzeit um die Laufzeit.
- `hold` und `plate` sind reserviert (keine Weiterleitung an andere Clients).

**Anti-Cheat** – `onState(peer, state, now, ctx)`: ctx `{alive (Puppe beim Host), clientAlive (Client meldet lebt), rtt (s)}`.
Schrittgrenze je Zustand `max(teleport 6 m, vMax × min(Δt, stepWindow 1 s) + slack)` (vMax des schnelleren Zustands vorher/jetzt),
Budget-Nachfüllung nach einem hängenden Host für das ankommende Bündel bis `burstWindow` 3 s,
nach oben `max(teleportUp 3,5 m, Steigtempo × Δt + Stufe + slack)`, Budget wie bisher (Tempo-Hacks). `clientAlive === false`
bei lebender Puppe → `{ok:false, reason:'tot-client'}`, Anker bleibt. Schonfristen `spawnGrace` (1,5 s) und `correctGrace`
(0,75 s) jeweils + rtt. Treffer: `ctx.interp` (s, Standard 0,45), `opts.maxRewind` 2 s; `PositionHistory` des Hosts 2,5 s.

**HostSync** – Puppen der Clients werden zwischen zwei Zuständen höchstens 50 ms mit der gemeldeten Geschwindigkeit
fortgeschrieben. Interessenfilter der Schnappschüsse ab 12 Akteuren: je Empfänger nah (≤ 60 m vom eigenen Körper) + eigener
Eintrag jeden Takt, ferne und tote Akteure jeden 4. Takt (5 Hz, je Akteur versetzt); `?netinterest=0` schaltet ihn ab
(Vergleichsmessung). `sync.snapStats` {sent, bytes, ents, full}.

**ClientSync** – Wiedergabe-Uhr `clock` {off, jit, buf, rt}: off = max(Stempel − Ankunft) (gibt 0,02 s/s nach), Puffer
`clamp(1,25 × Paketabstand + 2,5 × Schwankung + 20 ms, 0,1, 0,4)`, rt folgt mit ±12 %. Je Akteur `list.gap`: seltener
gesendete Akteure um (gap − Paketabstand) × 1,1 weiter zurück. Glättungsversatz (klingt mit 10/s ab, ab 3 m gesetzt).
Leben im Puffer abgegrenzt (Einträge nach dem ersten toten gelten erst nach dem nächsten Spawn); Lebend-Abgleich nach
0,35 s + rtt, auch für Tod + Wiedereinstieg zwischen zwei Meldungen; verspätete `kill`/`spawn` eines schon nachgeholten
Lebens ändern nichts mehr (nur Abschussliste).

**recommend.js** – `clientBytes(actors)`, `bandwidthFor(n, {actors})`, `maxPlayersForUpload(rate, {actors})`,
`recommend({…, actors})`; Konstanten `SNAPSHOT_HEADER`, `ENTITY_BYTES`, `PACKET_OVERHEAD`, `INTEREST_MIN`, `INTEREST_SHARE`,
`RELIABLE_BYTES` (gemessen, §13). `NetSystem.recommendation()` rechnet mit 2 × teamSize Akteuren, wenn Bots auffüllen.

**Weitere Korrekturen** – `peer.js`: Angebot darf 45 s auf die Antwort warten (`OFFER_TIMEOUT`), danach 15 s bis offen;
`accept` auf geschlossener Verbindung → Code 'verbindung-fehlgeschlagen'. `signal.js joinRoom` schließt ein offenes Angebot bei
Fehlern. `NetSystem.join` gibt nur Text-Codes weiter; `WELCOME_WAIT_MS` 20 s (Client wartet auf 'welcome'), `HELLO_WAIT_MS` 25 s
(Host wartet auf 'join'). `HostSync._shooterPos(p)`: Schussursprung gegen den zuletzt gemeldeten
Zustand. `UploadMeter` (recommend.js): Rate/Bestwert nur über Fenster ≥ `peakWindow` 3 s. `main.js`: Hintergrund-Takt des
Hosts lässt aufgestaute Takte verfallen (≥ 40 ms Abstand).

**Prüfwerkzeuge** – `tools/mp-test.mjs [--params=…] [--size=…]` (zusätzlich: Glätte, „Ausrüsten“/„Einsatz“ + Ausrüstung beim
Host, Sturz nach Host-Spawn in der Luft, Rutschen ohne Verstoß, verborgener Host-Tab mit ruhendem rAF);
`tools/mp-load-test.mjs [--clients=12] [--mode=tdm|ffa] [--seconds=30] [--params=…]` → `tools/out/mp-load.json`;
`dev/fake-client.html` (`window.__fake`: join(code), leave(), stats()); `tools/net-interp-test.mjs` + `dev/net-interp.html`
(Interpolation mit virtueller Uhr, `window.__interp`). `ClientSync._puppetPose(id, list, rt, dt, out)` = Interpolation +
Glättung einer Puppe (für den Prüfstand herausgelöst).
