# NULLPUNKT – Mehrspieler Stufe 1 (Vertrag)

Stand: 08.10.2026, Ziel: live bis Samstag 10.10., 12 Uhr. Dieses Dokument ist der verbindliche Vertrag für alle, die am
Mehrspieler bauen. Code-Landkarte mit Datei/Zeilen-Verweisen: `docs/planung/mehrspieler-landkarte.json`.

## 1. Grundentscheidungen

- **Stern-Topologie, Host = ein Spieler-Browser.** Vermittlung über öffentliche Nostr-Relays (Port 443, ohne Konto),
  Verbindungsangebote Ende-zu-Ende-verschlüsselt (fertig: `net/crypto.js`, `net/nostr.js`, `net/signal.js`, `net/peer.js`,
  getestet mit `tools/net-test.mjs`). Kein TURN in Stufe 1 (ehrlich kommunizieren: manche Netze/Mobilfunk scheitern).
- **Host ist maßgeblich für:** Schaden, Lebenspunkte, Tod, Abschüsse, Punkte, Spielmodus/Ziele, Bots (KI), Spawns, Granaten-/Raketen-Explosionen, Spielende.
- **Clients sind maßgeblich für ihre eigene Bewegung** (Position/Blick/Haltung) – der Host prüft auf Plausibilität (Anti-Cheat).
- **Treffer: „was du siehst, triffst du“.** Der Client prüft seine Schüsse lokal gegen die Puppen (Soldier-Hitboxen),
  schickt eine **Treffermeldung** an den Host; der Host prüft (Feuerrate, Schaden, Position, Sicht) und wendet den Schaden an.
- **Puppen:** Jeder Akteur, der nicht lokal simuliert wird, ist ein `Bot` mit `puppet = true` (kein KI-/Physik-/Waffen-Update,
  nur Zustand aus dem Netz + `_animate`). Auf dem Host: Puppen für entfernte Menschen. Auf Clients: Puppen für alle
  anderen (Bots des Hosts, Host-Spieler, andere Clients).
- **Stufe 1 Modi:** `tdm`, `ffa`, `dom`, `kc`. Nicht online (ausgegraut, „folgt in Stufe 2“): `cq` (Fahrzeuge), `gun`, `inf`, `training`.
  **Scorestreaks online aus** (Stufe 2). **Fahrzeuge online aus** (Host spawnt keine).
- **Karten:** alle; Weltgeometrie ist über `def.seed` deterministisch, Wetter/Tageszeit löst der Host auf und schickt sie mit.

## 2. Netz-IDs

- Jeder Akteur bekommt `actor.netId` (Ganzzahl 1…65535). Host vergibt: Host-Spieler = 1, Menschen ab 2 in Beitrittsreihenfolge,
  Bots ab 1000. Der Host schickt die Zuordnung im Roster. Clients nutzen `G.net.actorById(netId)`.
- `actor.isRemoteHuman = true` an Puppen, die einen Menschen darstellen. `actor.isHuman` = `isPlayer || isRemoteHuman`.

## 3. Schnittstelle `G.net` (NetSystem, `assets/js/game/net/index.js`)

```js
class NetSystem {
  constructor(G)
  // Zustand
  online      // bool – Sitzung aktiv (Host oder Client)
  role        // 'host' | 'client' | null
  selfId      // eigene netId (Host 1)
  room        // { code, public, state: 'lobby'|'match', settings, hostName }
  roster      // [{ id, name, team, isHost, isBot:false, level, ping, ready, cls, loadout, kd }] – nur Menschen
  // Lobby / Sitzung (UI ruft das auf)
  async host(settings)          // Raum öffnen → {code}; settings siehe §6
  async join(code, {name})      // beitreten → wirft Error mit .code ('kein-relay'|'kein-host'|'keine-antwort'|'abgelehnt:voll'|'abgelehnt:version'|'abgelehnt:gekickt'|'verbindung-fehlgeschlagen')
  leave(reason)
  kick(id, reason)              // nur Host
  setTeam(id, team)             // nur Host ('A'|'B')
  updateSettings(partial)       // nur Host, verteilt an alle
  startMatch()                  // nur Host: baut cfg (§6), schickt 'start', startet selbst
  watchPublic(cb) → stop()      // öffentliche Spiele beobachten
  async quickPlay({name})       // bestes öffentliches Spiel beitreten oder null
  recommendation()              // {max, reason, upload, fps, cores, memory, measured:bool}
  // Nachrichten (für sync-Module)
  send(to, msg)                 // to: netId | 'all' | 'others'; msg: {t:'…', …} zuverlässig (JSON)
  sendFast(to, arrayBuffer)     // schnell/unzuverlässig
  on(type, fn(msg, fromId))     // Abo je Nachrichtentyp → Abmeldefunktion
  onFast(fn(buf, fromId))
  peerRtt(id)                   // ms
  serverTime()                  // Host-Zeit in s (Clients: geschätzt über Ping), für Interpolation
  // Spiel-Hooks (main.js ruft auf)
  preUpdate(dt)  postUpdate(dt)  onMatchStart(cfg)  onMatchEnd(result)  onTeardown()
  actorById(netId)
}
```

Ereignisse auf `G.events`: `net:status` {online, role, relays, state}, `net:roster` {roster}, `net:room` {room},
`net:error` {code, text}, `net:kicked` {reason}, `net:peer` {id, name, joined:bool}, `net:recommend` {…}.

## 4. Nachrichten (zuverlässig, JSON, Feld `t`)

Client → Host
- `join` {name, level, kd, ver, build, cls, loadout} – direkt nach Verbindungsaufbau
- `ready` {} – Welt geladen, bereit zum Spawnen
- `loadout` {cls, loadout} – Ausrüstung geändert (gilt ab nächstem Spawn)
- `hit` {target, zone, dmg, weapon, dist, origin:[x,y,z], point:[x,y,z], serial, pellet} – Treffermeldung
- `melee` {target, weapon, serial}
- `throw` {kind:'grenade'|'rocket', type, origin, dir, vel, cook} – Host erzeugt das Geschoss
- `leave` {}

Host → Client
- `welcome` {id, team, room, roster, cfg|null} – cfg ≠ null, wenn ein Spiel läuft (Einstieg ins laufende Spiel)
- `room` {room} / `roster` {roster}
- `start` {cfg} – Spiel starten (alle laden dieselbe Karte)
- `spawn` {id, pos:[x,y,z], yaw, cls, loadout, hp} – Akteur (auch der lokale Spieler) spawnt
- `hit` {target, attacker, dmg, zone, hp, armor, weapon, dir:[x,y,z]} – Schaden (Treffermarker, Blut, eigene Lebenspunkte)
- `kill` {victim, killer, assister, weapon, zone, head, pen, streak} – Abschuss
- `mode` {s} – Modus-Zustand (`mode.netState()`), bei Änderung und spätestens jede Sekunde
- `ev` {e:'explosion'|'grenade'|'rocket'|'impact'|'medal'|…, …} – Effekte/Ereignisse zum Nachspielen
- `end` {result, summary} – Spielende (summary = playerSummary für genau diesen Client)
- `kick` {reason} / `host-away` {away:bool} / `correct` {pos:[x,y,z]} (Anti-Cheat-Rücksetzung)

## 5. Binärpakete (schnell, `net/protocol.js`)

Alle Zahlen little-endian. Winkel als Int16 = rad × 10000. Geschwindigkeiten Int16 in cm/s.

**Snapshot (Host → Client, 20 Hz)**: `u8 typ=1, u32 tick, f32 serverTime, u16 n`, dann n × Akteur:
`u16 id, f32 x, f32 y, f32 z, i16 yaw, i16 pitch, i16 vx, i16 vy, i16 vz, u16 flags, u8 weapon, u8 hp, i8 lean, u8 shots, u8 proneBlend(0–255)`
Flags: bit0 alive, 1 crouch, 2 prone, 3 sprint, 4 ads, 5 reloading, 6 onGround, 7 sliding, 8 throwing, 9 meleeing, 10 swimming.
`weapon` = Index in `WEAPON_INDEX` (aus weapons.data.js, stabil sortiert nach id). `shots` zählt Schüsse modulo 256 (Puppe feuert, wenn sich der Wert ändert).

**Zustand (Client → Host, 30 Hz)**: `u8 typ=2, u32 seq, f32 clientTime`, dann ein Akteur-Block wie oben (ohne id/hp).

## 6. Raum-Einstellungen und Spielkonfiguration

`room.settings` = { name, mode, map, time, weather, difficulty, maxPlayers (2–32), botFill (bool), teamSize (je Team inkl.
Menschen, 1–16), pvp ('pvp' = Menschen auf beide Teams verteilt | 'coop' = alle Menschen Team A gegen Bots), public (bool),
style, scoreLimit, timeLimit }.
`startMatch()` erzeugt cfg = Lobby-Konfiguration + { net:{role, roomCode}, weather/time aufgelöst (keine 'zufall'),
allies/enemies so, dass Bots + Menschen = teamSize }.

## 7. Spielablauf

- **Host:** `runStart` wie offline; nach `player.resetForMatch` Puppen für alle bereiten Clients (`bots.spawnPuppet`) einfügen,
  Bots je Team um die Menschen reduzieren. Beitritt im laufenden Spiel: Puppe anlegen, einen Bot desselben Teams entfernen
  (`bots.removeBot`); Austritt: Puppe entfernen, ggf. Bot nachfüllen (`bots.addBot`).
- **Client:** `runStart` mit cfg.net.role='client': Karte laden, Modus anlegen (Replik: kein `mode.update`, Zustand per `mode`-Nachricht),
  keine `spawnBots`, keine `updateRespawns`; Puppen aus dem Roster/Snapshot; eigener Spieler spawnt erst bei `spawn` vom Host.
- **Pause online:** Simulation läuft weiter (Pausenmenü nur als Überlagerung, Eingabe aus). Host-Tab im Hintergrund → `host-away`.
- **Ende:** nur durch Host (`end`); Clients zeigen Endbildschirm, „Revanche“ = zurück in den Raum.

## 8. Anti-Cheat (Host, `net/anticheat.js`)

Pro Client: Bewegung (max. Tempo je Zustand + 35 % Toleranz, Teleport > 6 m ohne Spawn → `correct` + Verstoß), Feuerrate
(rpm der Waffe + 20 %), Treffermeldungen (Ziel lebt und ist feindlich, Schaden ≤ Maximalschaden der Waffe × Kopf-Multiplikator,
Ziel war in den letzten 400 ms innerhalb 2,5 m vom gemeldeten Punkt, Entfernung ≤ Reichweite, Waffe in der Ausrüstung).
Sichtprüfung nur „weich“ (Zählung, Vegetation kann je Grafikstufe abweichen). Verstöße gewichtet; ab Schwelle Kick mit Grund,
Host sieht ein Protokoll im Host-Menü.

## 9. Empfehlungswert maximale Spieler

`recommendation()`: aus Kernen (`navigator.hardwareConcurrency`), Speicher (`deviceMemory`, wenn vorhanden), gemessener
Bildrate und gemessenem Upload (gesendete Bytes/s vs. Stau im Sendepuffer; vor der ersten Messung konservativ 8). Bandbreite
pro Spielerzahl n: kalibriert nach dem Lasttest, siehe §13 (früher ≈ 20 Hz × (n−1) × n × 40 Byte – unterschätzte, weil die
Bots in jedem Schnappschuss stehen). Anzeige: „Empfehlung: bis N Spieler“ + Grund; über der Empfehlung Warnung.

## 10. Dateizuständigkeit (Parallelbau)

| Bereich | Dateien |
|---|---|
| Netz-Kern | `net/index.js`, `net/protocol.js`, `net/anticheat.js`, `net/recommend.js` (neu); `net/signal.js`/`peer.js` nur bei Fehlern |
| Puppen | `bots/bot.js` (puppet-Zweig), `bots/manager.js` (`spawnPuppet`, `removeBot`, `addBot`, LOD für Menschen), `bots/nameplates.js` |
| Oberfläche | `ui/lobby.js` (Reiter „Mehrspieler“), `ui/net-menus.js` (neu), `ui/menus.js`, `ui/scoreboard.js`, `assets/css/game.css` |
| Altlasten (WIP) | `release-fixes-wip.patch` einarbeiten (weaponObstruction), `engine/audio.js`-Wächter, Preload-Liste |
| Synchronisation | `net/sync-host.js`, `net/sync-client.js` (neu), `main.js`, `combat.js`, `modes/*` (netState), `player.js`, `weapons/grenades.js`, `weapons/ballistics/rockets.js` |

## 11. Budget (Nutzer 08.10. ~18:30)
- Mehrspieler Stufe 1 komplett (inkl. Tests und Veröffentlichung) mit höchstens **40–50 % des Wochenlimits**. Stand beim Start: ~3 % Woche / ~6 % Tag.
- Rest bleibt als Puffer für Fehler im Mehrspieler und für Logik-/Kartenfehler. Deshalb: gezielte Agenten statt breiter Fächer, mittlere Denkstufe für mechanische Arbeit, Tests wiederverwenden statt neu bauen.

## 12. Umsetzung Synchronisation (Schritt 2, 08.10.)

Stand der Synchronisation (Host ↔ Clients) – Code in `net/sync-host.js`, `net/sync-client.js`, `net/sync-common.js`;
Anschlüsse in `main.js`, `combat.js`, `modes/*`, `weapons/*`, `engine/physics.js`, `ui/endscreen.js`.
Ende-zu-Ende-Prüfung: `node tools/mp-test.mjs` (Host + 2 Clients, lokales Relay, SwiftShader; 61 Prüfungen: Beitritt,
Puppen/Positionen, Schuss-/Granaten-/Messertreffer, Schaden/Tod/Respawn, Sturz, Anti-Cheat-Teleport, Austritt + Bot-Auffüllen,
Matchende, Herrschaft-Ziele, Einstieg ins laufende Match, Kick, Host-Abbruch, Marke bestätigen, FFA-Wertung, Online-Pause,
verborgener Host-Tab; ≈ 13 min).

**main.js**
- `MODULES`: `net` (NetSystem), `netHost` (HostSync), `netClient` (ClientSync) – alle optional; fehlt `net`, bleibt `G.net = null`
  und der Einzelspieler läuft unverändert. `G.net` entsteht nach `G.menus`. `spielen.html?raum=CODE` → `G.menus.openJoin(code)`.
- `runStart`: cfg mit `net` (und aktiver Sitzung derselben Rolle) → `G.net.sync = new HostSync|ClientSync(G, net, cfg.net)`
  (je Match neu, vor dem ersten `await` – Nachrichten während des Ladens werden gepuffert). `G.match.net/netRole` gelten bis zum
  Abbau. Online: Bots je Team = `cfg.net.botsA/botsB` (absolute Teams, ohne `limitsFor`), Spielerteam = `cfg.net.team`,
  `opts.streaks = false`, keine Fahrzeuge, `lastMode/lastMap` der Einzelspieler-Lobby bleiben. Client: Modus als Abbild
  (`opts.replica`), keine `spawnBots`, Spieler wartet ohne Körper an einem Teamspawn (`placeSpectator`). Nach `warmUp`:
  Client meldet seine tatsächliche Ausrüstung (`G.net.setLoadout`), dann `G.net.onMatchStart(cfg)` (Client → 'ready').
- Bild: `G.net.preUpdate` nach Eingabe/Pausenprüfung, vor Spieler/Bots; `G.net.postUpdate` nach den Respawns. Respawns nur
  auf dem Host. **Pause online**: Zustand 'paused' (Menü, Eingabe aus), die Simulation läuft weiter (`G.match.netLive`; Bots,
  Modus, Respawns, Countdown). Client-Countdown wartet am Ende, bis der Host 'playing' meldet (höchstens 15 s).
  **Host-Tab verborgen**: rAF ruht → ein Worker-Zeitgeber (20 Hz) ruft `frame(now, bg=true)` (Simulation ohne Zeichnen),
  solange der Host verborgen in einem Online-Match ist (`updateBackgroundTicker`, bei Sichtbarkeit/Zustandswechsel).
- `spawnActor(actor, fixed)`: fester Ort (Client-Spawn vom Host); Host ruft vorher `sync.beforeSpawn` (gemeldete Ausrüstung).
  `deploy()` auf Clients wirkungslos (Host setzt ein). `endMatch` → `G.net.onMatchEnd(result)`; `teardownMatch` →
  `G.net.onTeardown()` zuerst. **Verlassen bei Sitzungsverlust** gehört der Oberfläche (net-menus ruft `onQuit` nach
  `net:kicked`/`net:error`); die Sync ruft `onQuit` nur bei 'end' mit `aborted` (Host hat das Match abgebrochen).

**Host (HostSync)** – Netz-Ids: Host 1, Clients Roster-Id, Bots ab 1000 (auch `addBot`/`debugApi.spawnBots`).
- 'ready' → Puppe (`spawnPuppet`, isHuman) + `G.spawnActor`; vor dem eigenen Matchstart gepuffert. Bots je Team so, dass
  Bots + Menschen = teamSize (Koop: B nur Bots; FFA 2 × teamSize) – beim Einstieg, Austritt, Kick und alle 2 s.
- PKT_STATE → `checkState` (Anti-Cheat, 'correct') → `puppet.netPose` nur bei gültigem Zustand (lebend, nicht veraltet).
- 'hit' → `checkHit` (Waffenliste aus Roster/Puppe/gemeldeter Ausrüstung) → `combat.damage(target, {attacker: Puppe})` –
  Abschüsse, Unterstützung, Modus, Medaillen laufen unverändert; Sturz/Welt ('fall'/'world', target = selbst) direkt.
  'melee' → `validateMelee`. 'throw' → echte Granate/Rakete aus der Puppe (Ursprung ≤ 3,5 m, 0,3 s Abstand).
- Sendet: Schnappschuss 20 Hz an bereite Clients (alle Akteure inkl. eigener Puppe), 'actors' (Name/Team/Mensch/Klasse/
  Ausrüstung, Bot-Variante/Tarnschema) bei Änderung, 'spawn' {+st Host-Zeit}, 'hit', 'kill' {+resp Wartezeit, dir, st},
  'mode' {s} (bei Änderung ≤ 5 Hz, sonst 1 Hz), 'ev' (gr/gb Granate geworfen/gezündet, rk/rb/rd Rakete, ex Explosion,
  sc/md Punkte/Medaille nur an den betroffenen Client), 'end' je Client (`mode.resultFor`: Sieg/Platz/Zeilen aus seiner Sicht +
  `summaryFor` = playerSummary). Abbau eines laufenden Matches → 'end' {aborted}.

**Client (ClientSync)**
- Puppen aus 'actors' + Schnappschüssen, Interpolation `max(0,1 s, 2,2 × Paketabstand)` (≤ 0,4 s) hinter `serverTime()`,
  0,25 s Fortschreiben; Einträge vor dem letzten Spawn und tote Einträge zählen nicht. Fehlende 'spawn'/'kill' gleicht der
  Lebend-Zustand der Schnappschüsse nach 0,35 s aus (z. B. Bots, die vor dem Beitritt gespawnt sind). Puppen fehlen > 3 s
  (während andere Schnappschüsse kommen) → entfernt.
- Eigene Lebenspunkte aus dem eigenen Schnappschuss-Eintrag und 'hit'; 'hit' → `actor:hit`/`player:damaged`/`onDamaged`;
  'kill' → `onDeath` + lokales 'kill' (Abschussliste, Todesbildschirm, Wartezeit des Hosts); 'spawn' → `G.spawnActor(player,
  fixed)` bzw. `puppet.respawn`; 'correct' → Teleport; 'mode' → `mode.applyNetState`; 'end' → `match:end` mit Ergebnis +
  Zusammenfassung (Profil wie offline über `endMatch`), Endbildschirm-Knöpfe führen in den Raum.
- `combat.damage` auf Clients → `sync.claimDamage`: eigene Treffer auf Puppen → 'hit'/'melee' + vorhergesagtes `actor:hit`
  (Trefferanzeige/Blut), Sturz/Welt → Meldung an sich selbst, sonst 0. Eigene Würfe/Raketen (`WeaponSystem.throwGrenade/
  explodeInHand/fireProjectile`) → 'throw' + Darstellungs-Geschoss (`remote`, zündet nicht selbst; übernimmt per `cid` die
  Id des Hosts). Fremde Granaten/Raketen als Darstellung, Zündung über `remoteBoom` (Explosion/Blendung/Rauch/Brand lokal,
  Schaden ohnehin nur beim Host).

**Modi**: `BaseMode.replica` (kein `_onKill`/Punkte/Ende, Restzeit zählt zwischen den Zuständen weiter), `netState()`/
`applyNetState()` (Restzeit, Verlängerung, Phase, Teampunkte bzw. FFA je netId, Wertung je Akteur), Dom (`ob`, `ti`;
Besitzwechsel → `objective:captured/neutral` auf dem Client), Kc (`tg` Marken mit Alter; Aufsammeln nur beim Host).
`count()` und Medaillen 'unaufhaltsam'/'mvp' zählen auch für entfernte Menschen; Ergebniszeilen tragen `netId`/`isHuman`
(Ping-Spalte im Endbildschirm über `netRows`).

**Kleine Anpassungen außerhalb der Sync**: `bots/bot.js` (Bots denken im Host-Pausenmenü weiter: `netLive`),
`engine/physics.js` (Puppen werden nicht geschoben, der andere Akteur weicht ganz aus), `rockets.js` (ohne aktives
Fahrzeugsystem eigene Spur gegen Welt + Akteure – vorher flogen Raketen online durch alles).

**Panzerung (Großkarten)**: Der Host rechnet Weste/Helm in `combat.damage`; 'hit' trägt `ar` [Westen-LP, Helm-LP,
Reserveplatten] für den getroffenen Client, 'ev' `ap` nach Plattenaufnahme/-einsatz. Der Client meldet sein Platteneinsetzen
('plate' {chain} bzw. {cancel}), der Host setzt die Platte an der Puppe ein.

**Offen (Stufe 1 → 2)**: ~~Respawn-Halt/„Einsatz“ der Clients~~ (erledigt, §13); eine beim Tod gezogene Granate eines Clients fällt nicht (die Puppe
ist beim Host schon tot); Streuungs-/Rückstoß-Zufall nicht synchron (Treffer zählen so, wie der Schütze sie sieht, Prüfung
durch den Anti-Cheat); Teamwechsel im laufenden Match gilt erst im nächsten Match; Bots fügen sich beim Einstieg sofort ein,
die Clients sehen ihre ersten Spawns über den Lebend-Abgleich (≈ 0,35 s).

## 13. Härtetest (Schritt 3, 08.10.)

Ziel: das, was im Idealfall (0 ms, lokales Relay) schon lief, unter schlechtem Netz und unter Last robust machen und belegen.
Alle Messungen auf dem Prüfrechner (4 Kerne, SwiftShader ohne GPU – die Spielseiten laufen dort mit ≈ 0,5–2 Bildern/s; echte
Rechner sind um Größenordnungen schneller, die Netz-Logik ist davon unabhängig geprüft).

**Netz-Chaos (nur Prüfläufe)**: `spielen.html?…&netlag=<ms>&netjitter=<ms>&netloss=<%>` – jede Seite verzögert ihre eigenen
Sendungen (also je Richtung lag ± jitter): zuverlässige Nachrichten in Reihenfolge, „Verlust“ als Wiederholung (+ max(200 ms,
2 × lag), alle folgenden warten wie bei SCTP), nie verworfen; schnelle Pakete einzeln verzögert (Reihenfolge darf kippen) und zu
`netloss` % verworfen. Gilt auch für Ping/Pong und den Zeitabgleich (Laufzeit, Ping-Spalte und serverTime sehen das Chaos).
Ohne Parameter: `NetSystem.chaos = null`, Verbindungen unverändert. Werkzeuge: `node tools/mp-test.mjs --params="…"`,
`node tools/mp-load-test.mjs [--params="…"]`.

**Gefundene Fehler und Korrekturen**
1. *Puppen liefen unter Laufzeit ständig fortgeschrieben*: die Wiedergabezeit war `serverTime() − 0,1 s`; schon bei 150 ms
   Laufzeit lag sie **vor** dem neuesten Schnappschuss → dauerndes Fortschreiben (bis 0,25 s), Überschwingen bei jedem
   Richtungswechsel und Zurückspringen. Jetzt Wiedergabe-Uhr aus den Zeitstempeln der Schnappschüsse selbst (Laufzeit egal),
   Puffer nach gemessenem Paketabstand + Ankunftsschwankung (0,1–0,4 s), Uhr läuft mit ±12 % nach, abklingender
   Glättungsversatz statt Sprüngen (ab 3 m wird gesetzt), höchstens 0,25 s Fortschreiben.
2. *Tod + Wiedereinstieg zwischen zwei Meldungen*: hingen 'kill'/'spawn' hinter einer Wiederholung, interpolierte die Puppe
   vom Todesort quer über die Karte zum neuen Spawnpunkt (beide Einträge „lebend“); ein verspätetes 'kill' tötete dann das neue
   Leben. Jetzt: Leben im Puffer abgegrenzt, Lebend-Abgleich nach 0,35 s + rtt (auch für Tod + Spawn dazwischen), verspätete
   'kill'/'spawn' eines schon nachgeholten Lebens ändern nichts mehr. Reihenfolge Tod → Spawn ist so auf allen Wegen garantiert.
3. *Anti-Cheat*: (a) ein einzelner Sprung von bis zu 14,6 m ging durch (Budget voll) – jetzt Schrittgrenze je Zustand
   `max(6 m, vMax × min(Δt, 1 s) + 0,75 m)` (Rutschen ≈ 7 m), nach oben `max(3,5 m, Steigtempo × min(Δt, 1 s) + 1,95 m)`; (b) Lücke:
   ein Client konnte „tot“ melden und lebendig an beliebiger Stelle wieder auftauchen (neuer Anker ohne Prüfung) – jetzt bleibt
   der Anker, solange die Puppe beim Host lebt; (c) Schonfristen nach Spawn/Rücksetzung + rtt; (d) Treffer: Zielverlauf
   `0,4 s + rtt + Darstellungsverzug des Schützen` (Client meldet ihn als `ip`, höchstens 2 s; Verlauf 2,5 s) – vorher fehlte
   die Interpolation des Schützen; (e) hängt der Host länger als 1 s (langes Bild), kommen die Zustände gebündelt – das Budget
   füllt für dieses Bündel die ganze Lücke nach (höchstens 3 s, die Schrittgrenze bleibt bei 1 s; vorher 8 falsche 'tempo' im Lasttest); (f) Schussursprung gegen den zuletzt
   gemeldeten Zustand statt gegen den Puppenkörper (der ein Bild nachhinkt – vorher 12 falsche 'herkunft' im Lasttest).
4. *„Ausrüsten“/„Einsatz“ auf Clients wirkungslos*: Client meldet den Halt jetzt ('hold'), der Host hält die Puppe wie offline an
   (Restzeit steht auf beiden Seiten, höchstens 30 s), „Einsatz“ gibt frei; die im Todesbildschirm gewählte Ausrüstung geht als
   'loadout' an den Host (vorher spawnte die Puppe mit der alten Klasse/Ausrüstung).
5. *Beitritt bei langsamem Host*: der Client schloss seine Verbindung 15 s nach dem Angebot, der Beitritt wartete 20 s – kam die
   Antwort dazwischen (Lasttest: 4 von 12 Beitritten bei 0,9 FPS), scheiterte `accept` mit DOMException 11, und die Zahl landete
   als Fehlercode in der Oberfläche. Jetzt 45 s fürs Angebot, 15 s ab Antwort, nur Text-Codes, offenes Angebot wird geschlossen.
6. *Hintergrund-Takt des Hosts*: der Worker tickt mit 20 Hz; dauert ein Bild länger, stauten sich die Takte ohne Ende (Latenz
   wuchs im Prüflauf auf Minuten). Aufgestaute Takte verfallen jetzt (`main.js`, nur online-Host).
7. *Upload-Messung*: ein langes Bild schickt viel auf einmal, das kurze Messintervall danach ergab 529 KB/s statt 46 KB/s –
   jetzt nur Fenster ≥ 3 s.
8. Kleinere: eigene Lebenspunkte flackerten (älterer Schnappschuss nach 'hit' setzte sie zurück – 'hit' trägt jetzt `st`);
   Restzeit des Modus um die Laufzeit korrigiert ('mode' trägt `st`); Puppen der Clients im Bild des Hosts zwischen zwei
   30-Hz-Zuständen bis 50 ms fortgeschrieben (kein Treppchen-Ruckeln); Empfehlung rechnete mit n statt mit allen Akteuren.

**Interessenfilter** (`sync-host.js`, ab 12 Akteuren): je Empfänger nah (≤ 60 m vom eigenen Körper) + eigener Eintrag mit 20 Hz,
ferne und tote Akteure mit 5 Hz (je Akteur versetzt). Der Client legt seltener gesendete Akteure entsprechend weiter zurück.

**Interpolation, deterministisch** (`node tools/net-interp-test.mjs`, `dev/net-interp.html`: echter ClientSync-Code, virtuelle
Uhr, 20-Hz-Schnappschüsse einer bekannten Bahn, Client 60 Bilder/s; Kennzahlen neu | alt):

| Fall | Darstellungsverzug | Schwankung des Verzugs | Rückwärtsschritte | größte Abweichung je Bild |
|---|---|---|---|---|
| ideal | 100 ms \| 110 ms | 0 \| 0 ms | 0 \| 0 | 0 \| 0 cm |
| 150 ± 30 ms, 5 % Verlust | 264 \| 115 ms | 25 \| 30 ms | **0 \| 1** | **1 \| 15 cm** |
| 300 ms, 15 % Verlust | 400 \| 124 ms | 6 \| 56 ms | 0 \| 0 | **0 \| 24 cm** |
| 150 ± 60 ms, 5 % | 292 \| 143 ms | 49 \| 79 ms | **0 \| 5** | **1 \| 20 cm** |
| Host 10 Hz, 150 ± 30 ms | 325 \| 220 ms | 59 \| 70 ms | **0 \| 3** | **1 \| 30 cm** |
| Wende bei 8 m/s, 150 ± 30 ms | 266 \| 111 ms | 26 \| 29 ms | 0 \| 0 | 6 \| 36 cm, Überschwingen **0 \| 18 cm** |

Der neue Puffer zeigt die Puppen um die Laufzeit später (der alte schrieb diese Zeit ständig fort), dafür ohne Zurückspringen,
Ruckeln und Überschwingen. Die Treffermeldung trägt diesen Verzug (`ip`), der Host prüft entsprechend weit zurück.

**Anti-Cheat** (`node tools/net-proto-test.mjs`, 111 Prüfungen, davon 18 neu): ohne Verstoß – Sprint mit allen Zuschlägen
10,4 m/s, Rutschen 13,3 m/s, Rutschsprung 11 m/s (je mit ±60 ms Ankunftsschwankung und 5 % Verlust), Hangrutschen 11,8 m/s
4 s, Sprungserie im Sprint, Spawn in 40 m Höhe + freier Fall bis 44 m/s, Host hängt 1 s bzw. alle 2,5 s / 2,95 s (Bündel; mit der alten 2-s-Grenze 48 falsche Verstöße bei 2,95 s), 0,7 s
Funkloch (7,3 m Schritt), Klettern 1,3 m, Spawn bei rtt 0,8 s; erkannt – 7 m und 14 m Sprung (vorher erlaubt), 20 m bei einem
Zustand alle 2 s, 5 m senkrecht, „tot melden + 40 m weiter auftauchen“, Tempo-Hack 2× Sprint nach 3,4 s, 3× nach 1,3 s.
Im echten Spiel (`mp-test`): Rutschen eines Clients (17 Zustände mit Rutsch-Bit) und Sturz aus 9 m nach Host-Spawn ohne
Verstoß, 20-m-Teleport → 'teleport' + 'correct'; Lasttest (12 Clients, Kreisbahn, 3 Tode + Wiedereinstiege): 0 Bewegungs-Verstöße.

**Lasttest** (`node tools/mp-load-test.mjs`: Host = echte Spielseite 480×270 niedrig, TDM Hafen teamSize 16; 12 Last-Clients
`dev/fake-client.html` in einem zweiten Browser, 30-Hz-Zustände im Kreis mit 4,2 m/s ab dem Spawnpunkt, ab und zu 1–3
Treffermeldungen auf den nächsten Gegner aus dem Schnappschuss):

| | ohne Interessenfilter | mit Interessenfilter |
|---|---|---|
| Host allein (32 Akteure: Host + 31 Bots) | 1,8 FPS, Bildzeit Ø 551 / p95 900 ms | 1,6 FPS, Ø 643 / p95 1067 ms |
| Host mit 12 Clients (32 Akteure: 13 Menschen + 19 Bots) | 1,6 FPS, Ø 627 / p95 1750 ms | 1,4 FPS, Ø 707 / p95 1367 ms |
| Schnappschuss je Client | 1003 Byte (32 Akteure) | 464 Byte (Ø 14,6 von 32 Akteuren = 46 %) |
| je Client bei 20 Hz (+ 60 Byte Paketkopf) | 21,3 KB/s + zuverlässig | 10,2 KB/s + zuverlässig |
| zuverlässig je Client (gemessen) | – | 2,1 KB/s (Treffer, Abschüsse, Modus, Akteursliste) |
| Anti-Cheat | 0 Bewegung; 12 'herkunft' (Fehler 3f), 7 'sicht' | 0 Bewegung, 0 'herkunft'; 9 'sicht' |
| Treffermeldungen | 175 gesendet, 125 bestätigt | 146 gesendet, 134 bestätigt |
| Roster/Bots | 13 Menschen (A 7/B 6), Bots 19 (9/10), 32 Akteure | gleich; 4 gehen → Bots 19 → 23 (11/12), 32 Akteure |
| Empfehlung | `measured: true`, bis 8 („Bildrate 2 FPS“) | `measured: true`, bis 8 („Bildrate 2 FPS“) |

'sicht' sind erwartet: die Last-Clients kennen keine Welt und melden auch Treffer durch Wände (weiche Prüfung, Gewicht 2).
Die SwiftShader-Bildrate (1–2 FPS) begrenzt den Host hier; die Netzlast hängt am Schnappschuss (ein Schnappschuss je Bild,
höchstens 20/s) und ist auf 20 Hz hochgerechnet. Ohne Filter lag ein Client bei 32 Akteuren über 20 KB/s → Filter eingebaut.

**Empfehlung (recommend.js, kalibriert)**: Upload je Client bei A Akteuren
`20 × (11 + 60 + A × 31 × anteil) + RELIABLE_BYTES` mit anteil = 0,5 ab 12 Akteuren (gemessen 0,46), sonst 1, und
RELIABLE_BYTES = {{RELIABLE}} Byte/s; gesamt `(n − 1) ×` das, A = 2 × teamSize bei Bot-Auffüllung (sonst n). Beispiel 13 Menschen,
32 Akteure: {{BEISPIEL}}. Die Upload-Messung nimmt nur Fenster ≥ 3 s (Bündel aus langen Bildern zählten vorher × 10).

**Läufe** (Prüfrechner, 4 Kerne; ein mp-test-Lauf ≈ 20–30 min): {{LAEUFE}}

**Offen**: SwiftShader-Seiten zeichnen auf dem Prüfrechner unter Last nur 0,1–2 Bilder/s – der Countdown zählt je Bild höchstens
0,25 s, daher dauert der Matchstart dort Minuten (kein Fehler des Spiels, mp-test wartet bis 10 min). Die Glätte im echten Spiel
lässt sich dort nur grob messen (Host schafft im Hintergrund-Takt dann < 8 Bilder/s → nur Info); die Interpolation selbst ist
deterministisch belegt (oben). Unter 300 ms / 15 % Verlust: siehe Läufe.

