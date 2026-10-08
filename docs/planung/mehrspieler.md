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
pro Spielerzahl n ≈ 20 Hz × (n−1) × n × 40 Byte. Anzeige: „Empfehlung: bis N Spieler“ + Grund; über der Empfehlung Warnung.

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
