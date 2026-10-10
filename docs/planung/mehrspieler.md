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
  **Scorestreaks online aus** (Stufe 2). **Fahrzeuge online** über die Raum-Einstellung „Fahrzeuge“ (Standard
  `VEHICLES_ONLINE_DEFAULT` in `net/index.js`; aus = wie früher, Host spawnt keine) – Host simuliert, Clients führen ein
  Abbild (§14).
  **Scorestreaks online:** **Aufklärer, FPV-Drohne, Präzisionsschlag** (10.10., `ONLINE_STREAKS`; Host setzt ein, verteilt 'sv' mit Restdauer r bzw. Ziel p, Client legt den Aufklärer-Eintrag an und schickt beim Schlag sein Kartenziel t), s. §4 „Serienprämien“; noch offline:
  Wachgeschütz folgen in Stufe 2. **Fahrzeuge online aus** (Host spawnt keine).
- **Karten:** alle; Weltgeometrie ist über `def.seed` deterministisch, Wetter/Tageszeit löst der Host auf und schickt sie mit.
  Bewegungskollision ist auf jeder Grafikstufe und mit/ohne Asset-Bibliothek gleich (Großkarte: Bäume/Felsen immer mit voller
  Dichte, nur Büsche/Schilf/Gras dünnen aus; Bibliotheksmodelle kollidieren nur über feste Quader) – Prüfung:
  `node tools/collision-hash.mjs --qualities=low,medium,high,ultra,low-nolib` (alle fünf Karten gleich, 09.10.).

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
  roster      // [{ id, name, team, isHost, isBot:false, level, ping, ready, cls, loadout, kd, device }] – nur Menschen;
              // device 'pc' | 'mobile' (Touch) | 'vr' (VR-Sitzung) – Symbol in Spielerliste/Punktetabelle (DEVICES)
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
  localDevice()                 // eigenes Gerät: 'vr' bei G.xr.presenting, 'mobile' bei G.input.mode 'touch', sonst 'pc'
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

Gerät (09.10.): NetSystem hört auf `xr:start`/`xr:end`/`input:mode`; ändert sich `localDevice()`, setzt der Host seinen
Roster-Eintrag (→ 'roster' an alle), ein Client schickt 'dev' (§4) und der Host verteilt das Roster. Beim Beitritt trägt
'join' das Gerät (`dev`). Ausdauer-Regel (§6): `match:state` → `_applyMatchRules()` auf Host und Clients.

## 4. Nachrichten (zuverlässig, JSON, Feld `t`)

Client → Host
- `join` {name, level, kd, ver, build, cls, loadout, dev} – direkt nach Verbindungsaufbau (`dev` = Gerät, Roster-Feld `device`)
- `ready` {} – Welt geladen, bereit zum Spawnen
- `loadout` {cls, loadout} – Ausrüstung geändert (gilt ab nächstem Spawn)
- `hit` {target, zone, dmg, weapon, dist, origin:[x,y,z], point:[x,y,z], serial, pellet} – Treffermeldung
- `melee` {target, weapon, serial}
- `throw` {kind:'grenade'|'rocket', type, origin, dir, vel, cook} – Host erzeugt das Geschoss
- `dev` {d:'pc'|'mobile'|'vr'} – Gerät gewechselt (VR-Sitzung beginnt/endet, Touch ↔ Maus); Host setzt `device` im Roster
- `cheat` {on} – Nur Messer: Cheat-Menü aktiv (mindestens ein Schalter, `cheats.js`); Host setzt `cheat` im Roster (Symbol in
  der Punktetabelle), bei Matchstart/-ende für alle zurück; nie weitergeleitet (RESERVED)
- `hold` {on, p} – Wiedereinstieg anhalten („Ausrüsten“ im Todesbildschirm, p = Restzeit steht) bzw. freigeben („Einsatz“);
  der Host hält die Puppe höchstens 30 s an
- `streak` {id, p:[x,y,z], y, pi, t:[x,y,z]} – Serienprämie einsetzen (online uav/drohne/strike; t = Ziel des Präzisionsschlags; p/y/pi = vorgeschlagener Startpunkt und Blick
  der Drohne). Antwort 'ev' sa (s. u.)
- `ability` {id} – Klassen-Fähigkeit eingesetzt (Taste J): der Host prüft Klasse der Puppe und Abklingzeit (Echtzeit, 10 % Spielraum)
  und heilt bei „Regeneration“ die Puppe; Kampfrausch, Nachschub und Aufklärungspuls wirken nur beim Client.
- `point` {i} – Heilung an Kartenpunkt i (mappoints.js, Sanitätsstation/Brunnen): Host prüft Abstand und Abklingzeit, heilt die Puppe.
- `drone` {a, d, …} – eigene FPV-Drohne (d = Netz-Id aus 'sa'): a 'p' Lage {p:[x,y,z], y, pi} 15 Hz, 'x' Sprengung {p},
  'e' Ende {why: abbruch|aufprall|akku|signal}; a 'h' Treffer auf eine fremde Drohne {d, w (Waffe), dmg, s (Schussnummer)}
- `plate` {chain} | {cancel:true} – Panzerplatte einsetzen (chain = mehrere nacheinander) bzw. abbrechen; der Host setzt sie
  an der Puppe ein (`combat.insertPlate`/`cancelPlate`), das Ergebnis kommt als 'hit' `ar` bzw. 'ev' `ap` zurück
- `leave` {}

Host → Client
- `welcome` {id, team, room, roster, cfg|null} – cfg ≠ null, wenn ein Spiel läuft (Einstieg ins laufende Spiel)
- `room` {room} / `roster` {roster}
- `start` {cfg} – Spiel starten (alle laden dieselbe Karte)
- `actors` {list:[{id, n, t, h, c, lo, v?, sc?}]} – Akteursliste (Identität, kein Zustand): id = netId, n Name, t Team
  ('A'|'B'|null), h 1 = Mensch, c Klasse, lo Ausrüstung, bei KI-Bots v Körpervariante und sc Tarnschema. Bei Änderung an alle
  (dieselbe Liste wird nicht wiederholt), vollständig an einen Client, sobald er bereit ist ('ready'/Einstieg), und an alle
  vor dem 'spawn' eines nachgefüllten Bots; fehlt ein Akteur in der neuen Liste, entfernt der Client seine Puppe
- `spawn` {id, pos:[x,y,z], yaw, cls, loadout, hp, st} – Akteur (auch der lokale Spieler) spawnt (st = Host-Zeit)
- `hit` {target, attacker, dmg, zone, hp, weapon, dir:[x,y,z], point, exp, killed, ar?, st?} – Schaden (Treffermarker, Blut,
  eigene Lebenspunkte; `ar` [Westen-LP, Helm-LP, Reserveplatten] bei Panzerung, `st` Host-Zeit, wenn ein Mensch getroffen ist)
- `kill` {victim, killer, assister, weapon, zone, head, pen, streak} – Abschuss
- `mode` {s} – Modus-Zustand (`mode.netState()`), bei Änderung und spätestens jede Sekunde
- `ev` {e, …} – Effekte/Ereignisse zum Nachspielen: gr/gb Granate geworfen/gezündet, rk/rb/rd Rakete, ex Explosion; nur an den
  betroffenen Client: sc Punkte, md Medaille, ap Panzerung nach Aufnahme/Platte. Serienprämien (09.10.): sk {k, rd, er} eigener
  Fortschritt (Abschüsse im Leben, bereit, verdient), sa {id, ok, d, p, pi, bt} Antwort auf 'streak' (d = Netz-Id der Drohne,
  bt = Akku s), sv {o, id} Prämie eines anderen (Hinweis/Klang); an alle: dr {l:[[d, o, x, y, z, yaw, pitch], …]} Lage aller
  Drohnen (12 Hz, solange welche fliegen), de {d, o, why, b, p} Ende einer Drohne (b = Schütze bei 'abschuss')
- `end` {result, summary} – Spielende (summary = playerSummary für genau diesen Client)
- `kick` {reason} / `host-away` {away:bool} / `correct` {pos:[x,y,z]} (Anti-Cheat-Rücksetzung)

### Serienprämien online: FPV-Drohne (09.10.)

- Fortschritt läuft nur auf dem Host (`mode.streaks` mit `only: ONLINE_STREAKS`); der Client führt `mode.streaks` als Abbild
  (`replica`): Stand aus 'ev' sk, Taste 6 / Touch → 'streak' an den Host, der `activate(puppe, 'drohne')` prüft (bereit, lebt,
  Startpunkt ≤ 4 m vor dem Kopf mit freier Sicht) und mit 'ev' sa antwortet. Erst dann fliegt die Drohne beim Client (lokal,
  flüssig), Lage 15 Hz an den Host ('drone' p; Weg-Budget Schub 26 m/s × 1,5, höchstens ≈ 47 m angespart, Reichweite 160 m –
  sonst verworfen + Anti-Cheat 'drohne'). Weg durch eine Wand (Strahl hin und zurück, Hindernis > 0,12 m stark): Lage bleibt
  0,3 m davor stehen, kein Verstoß; hängt sie 1,5 s fest (Grenzfall Ecke), gilt die Meldung wieder.
- Sprengung ('drone' x): Host prüft (Echtzeit) Drohne aktiv, Zeit seit Start ≤ Akku × 2,2 + 3 s (`netTimeFactor`; auf
  langsamen Geräten läuft die Spielzeit und damit der Akku langsamer), Punkt ≤ Schub × Zeit seit der letzten angenommenen Lage
  (höchstens 1 s – Lage zurückhalten bringt keinen Sprung) × 1,25 + 4 m entfernt, ≤ Reichweite + 5 m vom Startpunkt →
  `combat.explode` (Angreifer = Puppe, Ursache 'drohne'; Abschuss/Punkte wie jeder Treffer), keine Wand zwischen letzter Lage
  und Sprengpunkt. Sonst Ende 'abgelehnt' ohne Wirkung + Anti-Cheat 'drohne' (nicht bei 'akku': sehr langsame Geräte; nicht
  bei 'wand'). Der Client hat die Drohne beim Sprengen schon beendet; 'ev' de 'abgelehnt' reicht den Hinweis nach.
- Treffer auf Drohnen: Host/Bots direkt (world.raycast, Explosionen); Clients melden eigene Treffer ('drone' h), der Host prüft
  Waffe (Ausrüstung), Feuerrate (je Schuss höchstens `pellets`), Reichweite (Nahkampf: Klinge + 1,75 m) und Sicht zu einer
  Lage der letzten 0,6 s, rechnet den Schaden selbst (Abfall, höchstens die Meldung). 40 LP → Ende 'abschuss', Punkte
  'drone' für den Schützen. Anti-Cheat 'ausruestung' nur bei unbekannter bzw. nicht getragener Waffe (Projektile: kein Verstoß).
- Darstellung: Host sendet alle Drohnen (auch eigene/Bots) als 'ev' dr, Clients zeigen fremde als geglättetes Abbild
  (`Drone` Rolle 'replica'), eigene nie doppelt. Ende immer als 'ev' de.

## 5. Binärpakete (schnell, `net/protocol.js`)

Alle Zahlen little-endian. Winkel als Int16 = rad × 10000. Geschwindigkeiten Int16 in cm/s.

**Snapshot (Host → Client, 20 Hz)**: `u8 typ=1, u32 tick, f32 serverTime, u16 n`, dann n × Akteur:
`u16 id, f32 x, f32 y, f32 z, i16 yaw, i16 pitch, i16 vx, i16 vy, i16 vz, u16 flags, u8 weapon, u8 hp, i8 lean, u8 shots, u8 proneBlend(0–255)`
Flags: bit0 alive, 1 crouch, 2 prone, 3 sprint, 4 ads, 5 reloading, 6 onGround, 7 sliding, 8 throwing, 9 meleeing, 10 swimming,
11 **vr** (Spieler in einer VR-Sitzung – ein VR-Zusatzblock folgt, s. u.; `encode` setzt/löscht das Bit selbst nach `vr`).
`weapon` = Index in `WEAPON_INDEX` (aus weapons.data.js, stabil sortiert nach id). `shots` zählt Schüsse modulo 256 (Puppe feuert, wenn sich der Wert ändert).

**Zustand (Client → Host, 30 Hz)**: `u8 typ=2, u32 seq, f32 clientTime`, dann ein Akteur-Block wie oben (ohne id/hp) = 37 Byte.

**VR-Zusatz** (09.10., `VR_BLOCK` = 11 Byte je Akteur mit Bit 11): `u8 bits` (bit0 Haupthand verfolgt, bit1 Nebenhand verfolgt),
`i16 aimYaw, i16 aimPitch` (Schussrichtung Auge → Punkt, auf den der Lauf zeigt; rad × 10000), `i8 hx, hy, hz` (Griff der
Haupthand), `i8 ox, oy, oz` (Nebenhand) – Hände relativ zum Auge im Blickrahmen (Gierung = yaw des Akteurs; x rechts, y oben,
z vorn) in cm, höchstens ±1,27 m (`VR_REACH`). Im Schnappschuss stehen die Blöcke hinter dem letzten Akteur, in der Reihenfolge
der Akteure mit gesetztem VR-Bit (ohne id); im Zustand folgt der Block direkt auf die 37 Byte. Ohne VR-Spieler sind die Pakete
Byte für Byte wie vorher; ältere Dekodierer lesen die festen 31/37 Byte und übergehen den Anhang. Akteur-Objekt
(`encode`/`decode`): Feld `vr` = null | {aimYaw, aimPitch, main:[x,y,z]|null, off:[x,y,z]|null}. Der Host übernimmt den
Zusatz eines VR-Clients in `puppet.netPose.vr` und unverändert in die Schnappschüsse (der Host-Spieler in VR schickt seinen
eigenen, `sync-common vrPoseOf`); Clients interpolieren ihn wie die Pose (Kopf, Waffe, Arme der Puppe).

## 6. Raum-Einstellungen und Spielkonfiguration

`room.settings` = { name, mode, map, time, weather, difficulty, maxPlayers (2–32), botFill (bool), teamSize (je Team inkl.
Menschen, 1–16), pvp ('pvp' = Menschen auf beide Teams verteilt | 'coop' = alle Menschen Team A gegen Bots), public (bool),
style, scoreLimit, timeLimit, stamina (bool, Standard true), killAmmo (bool, Standard true), cheatMenu (bool, Standard true) }.
- `time`: 'standard' (Kartenzeit) | 'zufall' | **'echtzeit'** | eine Tageszeit der Karte (`MAPS[map].times`); `weather`:
  'standard' | 'zufall' | ein Wetter der Karte.
- `stamina` („Ausdauer“, 09.10.): false = unbegrenzte Ausdauer für alle (Spieler und Bots, auf Host und Clients).
- `killAmmo` („Munition pro Abschuss“, 09.10.): true = jeder Abschuss bringt dem Schützen Munition (ein Magazin, MG 20 Schuss
  direkt in den Gurt; Regeln `killAmmoFor` in shared/weapons.data.js). Munition ist Zustand des jeweiligen Geräts: der Host
  schreibt sie nur seinem eigenen Spieler gut (`combat.js` 'kill'), jeder Client sich selbst beim 'kill' des Hosts mit ihm als
  Schützen (`net/sync-client.js` → 'kill' → `weapons/index.js _killAmmo`); Puppen und Bots nie, kein neues Netzpaket.
- `cheatMenu` („Cheat-Menü (Nur Messer)“, 09.10., Host-Schalter nur bei Modus 'messer' sichtbar): false = das Cheat-Menü des
  Modus öffnet sich bei niemandem („vom Host deaktiviert“); mitten im Match verboten → alle Schalter aus (`cheats.js` liest
  `G.net.room.settings`, sonst `cfg.net.cheatMenu`). Nur Messer ist online noch nicht wählbar (`ONLINE_MODES`).

`startMatch()` erzeugt cfg = Lobby-Konfiguration + { allies/enemies so, dass Bots + Menschen = teamSize, `timeOfDay`/`weather`
aufgelöst } und je Empfänger `cfg.net` = { role, roomCode, selfId, team, teamSize, pvp, botFill, maxPlayers, botsA, botsB,
humans:{A,B}, ffa, conditions:{weather, time}, startedAt, stamina, killAmmo, cheatMenu }.
- **Wetter/Zeit löst nur der Host auf** (`world.resolveConditions`): nie 'zufall' oder 'echtzeit' in cfg. **'echtzeit'**
  nimmt die Tageszeit der Karte (Kartenzeit oder eine aus `times`), die der **Uhr des Hosts** am nächsten liegt
  (`weather.js realTimePreset`, Stunden aus `TIME_HOURS`: Morgen 7, Vormittag 10, Mittag 12,5, Nachmittag 15,5, Abend 19 Uhr;
  nachts über Mitternacht gerechnet) – alle Clients spielen dieselbe Zeit, egal in welcher Zeitzone. `cfg.timeOfDay` ist dann
  die aufgelöste Zeit (oder 'standard'), `cfg.net.conditions` das Ergebnis.
- **`cfg.net.stamina`**: false → NetSystem setzt bei jedem `match:state` `G.match.styleFlags.staminaMult = 0` (`stamina.js`:
  0 = unbegrenzt; idempotent, weil `main.applyStyle` die Stil-Flags vor 'loading' neu setzt).

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
  `opts.streakIds = ONLINE_STREAKS` (nur die FPV-Drohne), keine Fahrzeuge, `lastMode/lastMap` der Einzelspieler-Lobby bleiben. Client: Modus als Abbild
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
   füllt für dieses Bündel die ganze Lücke nach (höchstens 3 s; meldet der Host seine eigene Lücke – `ctx.hostGap`, Zeit seit
   seinem letzten Bildbeginn – bis 15 s; die Schrittgrenze bleibt bei 1 s; vorher 8 falsche 'tempo' im Lasttest, im Endlauf noch 3
   nach einem ≈ 9-s-Hänger beim Beitritt neuer Clients unter Fremdlast; ein Client, der selbst schweigt, bekommt nur 3 s
   gutgeschrieben); (f) Schussursprung gegen den zuletzt gemeldeten Zustand statt gegen den Puppenkörper (der ein Bild
   nachhinkt – vorher 12 falsche 'herkunft' im Lasttest); (g) Stau *außerhalb* des Host-Bildes (Lasttest bei Last 12,6:
   Netz/Sender hängen mehrere Sekunden, der Host läuft weiter – 24 falsche 'tempo' bei `hostGap` 0,4–1,6 s): das Budget
   rechnet jetzt mit den Sendestempeln der Zustände (Client-Zeit zwischen zwei Zuständen, gebündelte Zustände liegen 33 ms
   auseinander). Die Client-Uhr darf der Host-Zeit insgesamt höchstens 0,25 s vorauslaufen (sonst gilt Host-Zeit – „Zeit
   erschreiben“ wirkt nicht: Tempo-Hack mit doppelt laufender Uhr nach 2,4 s erkannt) und höchstens 8 s zurückliegen
   (angesparte Zeit: ein Vorstoß nach 20 s Stillstand mit lahmen Stempeln endet nach 70 m); die erhöhte Budget-Obergrenze
   gilt weiter nur für Lücken, die der Host selbst sah.
4. *„Ausrüsten“/„Einsatz“ auf Clients wirkungslos*: Client meldet den Halt jetzt ('hold'), der Host hält die Puppe wie offline an
   (Restzeit steht auf beiden Seiten, höchstens 30 s), „Einsatz“ gibt frei; die im Todesbildschirm gewählte Ausrüstung geht als
   'loadout' an den Host (vorher spawnte die Puppe mit der alten Klasse/Ausrüstung).
5. *Beitritt bei langsamem Host*: der Client schloss seine Verbindung 15 s nach dem Angebot, der Beitritt wartete 20 s – kam die
   Antwort dazwischen (Lasttest: 4 von 12 Beitritten bei 0,9 FPS), scheiterte `accept` mit DOMException 11, und die Zahl landete
   als Fehlercode in der Oberfläche. Jetzt 45 s fürs Angebot, 15 s ab Antwort, nur Text-Codes, offenes Angebot wird geschlossen;
   'welcome' darf 20 s dauern (vorher 12 s – ein unter Fremdlast blockierter Host ließ einen Beitritt mit 'keine-antwort'
   scheitern), der Host wartet 25 s auf 'join'.
6. *Hintergrund-Takt des Hosts*: der Worker tickt mit 20 Hz; dauert ein Bild länger, stauten sich die Takte ohne Ende (Latenz
   wuchs im Prüflauf auf Minuten). Aufgestaute Takte verfallen jetzt (`main.js`, nur online-Host).
7. *Upload-Messung*: ein langes Bild schickt viel auf einmal, das kurze Messintervall danach ergab 529 KB/s statt 46 KB/s –
   jetzt nur Fenster ≥ 3 s.
8. Kleinere: eigene Lebenspunkte flackerten (älterer Schnappschuss nach 'hit' setzte sie zurück – 'hit' trägt jetzt `st`);
   Restzeit des Modus um die Laufzeit korrigiert ('mode' trägt `st`); Puppen der Clients im Bild des Hosts zwischen zwei
   30-Hz-Zuständen bis 50 ms fortgeschrieben (kein Treppchen-Ruckeln); Empfehlung rechnete mit n statt mit allen Akteuren.
9. *Puppe lief kurz rückwärts, wenn der Host langsamer als Echtzeit läuft* (mp-test ideal: Host 1,5 Bilder/s, je Bild ≤ 50 ms
   Spielzeit = Zeitlupe): die Schnappschüsse melden das Spieltempo (4,5 m/s), die Positionen kommen aber nur mit 0,34 m/s
   Host-Zeit voran – das Fortschreiben (bis 0,25 s) lief über das nächste Paket hinaus, die Glättung zog zurück. Jetzt
   skaliert der Client Fortschreiben und erwartete Bewegung mit (Tempo laut Positionen ÷ gemeldetes Tempo, ≤ 1). Prüfstand:
   „Host-Zeitlupe“ vorher 533 Rückwärtsschritte, jetzt 0. Außerdem ändert sich der Zusatzverzug seltener gesendeter Akteure
   (Interessenfilter) stetig mit höchstens 12 % statt an einer Schwelle um bis zu 0,4 s zu springen.

**Interessenfilter** (`sync-host.js`, ab 12 Akteuren): je Empfänger nah (≤ 60 m vom eigenen Körper) + eigener Eintrag mit 20 Hz,
ferne und tote Akteure mit 5 Hz (je Akteur versetzt). Der Client legt seltener gesendete Akteure entsprechend weiter zurück.

**Interpolation, deterministisch** (`node tools/net-interp-test.mjs`, `dev/net-interp.html`: echter ClientSync-Code, virtuelle
Uhr, 20-Hz-Schnappschüsse einer bekannten Bahn, Client 60 Bilder/s; Kennzahlen neu | alt – „alt“ = alte Wiedergabezeit
`serverTime − max(0,1, 2,2 × Paketabstand)` ohne Glättung, mit derselben Abtastung):

| Fall | Darstellungsverzug | Schwankung des Verzugs | Rückwärtsschritte | größte Abweichung je Bild |
|---|---|---|---|---|
| ideal | 100 ms \| 110 ms | 0 \| 0 ms | 0 \| 0 | 0 \| 0 cm |
| 150 ± 30 ms, 5 % Verlust | 264 \| 115 ms | 27 \| 30 ms | **0 \| 1** | **2 \| 15 cm** |
| 300 ms, 15 % Verlust | 401 \| 124 ms | 11 \| 56 ms | 0 \| 0 | **1 \| 24 cm** |
| 150 ± 60 ms, 5 % | 295 \| 143 ms | 54 \| 79 ms | **0 \| 5** | **2 \| 20 cm** |
| Host 10 Hz, 150 ± 30 ms | 326 \| 220 ms | 53 \| 70 ms | **0 \| 3** | **2 \| 30 cm** |
| Wende bei 8 m/s, 150 ± 30 ms | 266 \| 111 ms | 27 \| 29 ms | 0 \| 0 | 4 \| 36 cm, Überschwingen **0 \| 18 cm** |
| Host ≈ 1,5 Hz unregelmäßig (Abstände 0,2–1,6 s) | 553 \| 400 ms | 792 \| 862 ms | 0 \| 0 | 414 \| 432 cm (Stillstand nach 0,25 s Fortschreiben) |
| Host-Zeitlupe (Positionen 0,45 m/s, gemeldet 4,5 m/s) | 453 \| 400 ms | 336 \| 219 ms | **0** \| 0 (vor Korrektur 9: **533**) | 4 \| 13 cm |

Der neue Puffer zeigt die Puppen um die Laufzeit später (der alte schrieb diese Zeit ständig fort), dafür ohne Zurückspringen,
Ruckeln und Überschwingen. Die Treffermeldung trägt diesen Verzug (`ip`), der Host prüft entsprechend weit zurück.

**Anti-Cheat** (`node tools/net-proto-test.mjs`, 116 Prüfungen, davon 23 neu): ohne Verstoß – Sprint mit allen Zuschlägen
10,4 m/s, Rutschen 13,3 m/s, Rutschsprung 11 m/s (je mit ±60 ms Ankunftsschwankung und 5 % Verlust), Hangrutschen 11,8 m/s
4 s, Sprungserie im Sprint, Spawn in 40 m Höhe + freier Fall bis 44 m/s, Host hängt 1 s bzw. alle 2,5 s / 2,95 s (Bündel; mit der alten 2-s-Grenze 48 falsche Verstöße bei 2,95 s) bzw. einmal 9 s
(mit `hostGap` 0 Verstöße, ohne – Client schweigt – 12), 7 s Stau unterwegs bei laufendem Host (mit Sendestempeln 0), 0,7 s
Funkloch (7,3 m Schritt), Klettern 1,3 m, Spawn bei rtt 0,8 s; erkannt – 7 m und 14 m Sprung (vorher erlaubt), 20 m bei einem
Zustand alle 2 s, 5 m senkrecht, „tot melden + 40 m weiter auftauchen“, Tempo-Hack 2× Sprint nach 3,4 s, 3× nach 1,3 s.
Im echten Spiel (`mp-test`): Rutschen eines Clients (17 Zustände mit Rutsch-Bit) und Sturz aus 9 m nach Host-Spawn ohne
Verstoß, 20-m-Teleport → 'teleport' + 'correct'; Lasttest (12 Clients, Kreisbahn, 3 Tode + Wiedereinstiege): 0 Bewegungs-Verstöße.

**Lasttest** (`node tools/mp-load-test.mjs`: Host = echte Spielseite 480×270 niedrig, TDM Hafen teamSize 16; 12 Last-Clients
`dev/fake-client.html` in einem zweiten Browser, 30-Hz-Zustände im Kreis mit 4,2 m/s ab dem Spawnpunkt, ab und zu 1–3
Treffermeldungen auf den nächsten Gegner aus dem Schnappschuss):

| | ohne Interessenfilter | mit Filter (1. Lauf) | mit Filter, Lauf B | Endstand (alle Korrekturen) |
|---|---|---|---|---|
| Host allein (32 Akteure: Host + 31 Bots) | 1,8 FPS, Bildzeit Ø 551 / p95 900 ms | 1,6 FPS, Ø 643 / p95 1067 ms | 0,7 FPS, Ø 1505 / p95 2283 ms | 0,7 FPS, Ø 1476 / p95 3733 ms |
| Host mit 12 Clients (32 Akteure: 13 Menschen + 19 Bots) | 1,6 FPS, Ø 627 / p95 1750 ms | 1,4 FPS, Ø 707 / p95 1367 ms | 1,3 FPS, Ø 794 / p95 1567 / max 1700 ms | 0,5 FPS, Ø 1823 / p95 4167 ms |
| Last (loadavg) während der Messung | 6,3 | 5,9 | 9,9 | 14,1 |
| Schnappschuss je Client | 1003 Byte (32 Akteure) | 464 Byte (Ø 14,6 von 32 = 46 %) | 436 Byte (Ø 13,7 von 32 = 43 %) | 538 Byte (Ø 17,0 von 32 = 53 %) |
| Schnappschüsse je Client bei 20 Hz (+ 60 Byte Paketkopf) | 20,8 KB/s | 10,2 KB/s | 9,7 KB/s | 11,7 KB/s |
| zuverlässig je Client (gemessen, Echtzeit) | – | 2,1 KB/s | 1,7 KB/s: Modus 560, Roster 549, Treffer der Last-Clients 530, Abschüsse 109, Punkte/Medaillen 17 B/s | 1,2 KB/s: Modus 309, Roster 567, Treffer 284, Abschüsse 48, Punkte/Medaillen 8 B/s (Host 0,5 FPS) |
| Anti-Cheat | 0 Bewegung; 12 'herkunft' (Fehler 3f), 7 'sicht' | 0 Bewegung, 0 'herkunft'; 9 'sicht' | 0 Bewegung, 0 'herkunft'; 6 'sicht'; 'correct' 0 | 0 Bewegung (Zwischenläufe: 3 bzw. 24 falsche 'tempo' → Fehler 3e/3g), 1 'sicht'; 'correct' 0 |
| Treffermeldungen | 175 gesendet, 125 bestätigt | 146 gesendet, 134 bestätigt | 148 gesendet, 129 bestätigt | 59 gesendet, 54 bestätigt |
| Tod + Wiedereinstieg unter Last | – | – | 3 Clients abgeschossen, alle am neuen Spawnpunkt weiter, danach 0 Verstöße | ebenso |
| Roster/Bots | 13 Menschen (A 7/B 6), Bots 19 (9/10), 32 Akteure | gleich; 4 gehen → Bots 19 → 23 (11/12) | gleich; Matchende: alle 8 Clients 'end' | gleich; 4 gehen → Bots 19 → 23 (11/12), 32 Akteure; alle 8 'end' |
| Empfehlung | `measured: true`, bis 8 („Bildrate 2 FPS“) | `measured: true`, bis 8 („Bildrate 2 FPS“) | `measured: true`, bis 8 („Bildrate 1 FPS“) | `measured: true`, bis 8 („Bildrate 1 FPS“) |
| Seiten-/Konsolenfehler | 0 | 0 | 0 | 0 |

'sicht' sind erwartet: die Last-Clients kennen keine Welt und melden auch Treffer durch Wände (weiche Prüfung, Gewicht 2).
Die Bildrate des Hosts (0,7–1,8 FPS) hängt auf dem Prüfrechner an SwiftShader und an der Fremdlast (andere Prüfläufe
parallel, loadavg 6–10) – „vorher/nachher“ ist darum nur grob vergleichbar: die 12 Clients kosten den Host messbar wenig
(Netz + 12 Puppen; in Lauf B lag „mit Clients“ sogar über „allein“, weil die Fremdlast schwankte). Die Netzlast hängt am
Schnappschuss (ein Schnappschuss je Bild, höchstens 20/s) und ist auf 20 Hz hochgerechnet. Ohne Filter lag ein Client bei 32
Akteuren über 20 KB/s (20,8 KB/s nur Schnappschüsse) → Interessenfilter eingebaut (halbiert den Schnappschuss).

**Kampfverkehr** (`node tools/mp-fight-rate.mjs`): Treffer/Abschüsse/Spawns/Granaten gehen zuverlässig an jeden Client. Im
Lasttest läuft die Spielzeit nur mit ≈ 5 % Echtzeit (≤ 50 ms je Bild bei ≈ 1 Bild/s) – in 4,8 Spielsekunden gab es noch keinen
Bot-Kampf. Darum eigene Messung: Offline-Runde Hafen TDM (= Host-Runde ohne Netz), Zeichnen abgeschaltet, 94 Spielsekunden,
23 Bots + Zuschauer, hochgerechnet auf 32 kämpfende Akteure: „regulär“ 7,6 Treffer, 0,96 Abschüsse, 0,93 Spawns, 0,30
Granaten-/Raketen-Ereignisse je Sekunde × gemessene Nachrichtengrößen (Treffer 221, Abschuss 265, Spawn 230 Byte inkl.
Paketkopf, Ereignis ≈ 170 geschätzt) = **2,2 KB/s je Client**; „Veteran“ (vorsichtiger) 2,9 Treffer/s = 0,9 KB/s.

**Empfehlung (recommend.js, kalibriert)**: Upload des Hosts je Client bei A Akteuren, davon n Menschen:
`20 × (11 + 60 + A × 31 × anteil) + 570 + 44 × n + 70 × A` – anteil = 0,55 ab 12 Akteuren (gemessen 0,43–0,53), sonst 1;
570 B/s Modus (≈ 1 Hz), 44 B/s je Mensch (Roster), 70 B/s je Akteur (Kampf, 2,2 KB/s bei 32). Gesamt `(n − 1) ×` das,
A = 2 × teamSize bei Bot-Auffüllung (sonst n); höchstens 80 % des gemessenen Uploads. Beispiele: 13 Menschen, 32 Akteure: je
Client 12 332 + 3 382 = 15 714 B/s ≈ 15,3 KB/s, gesamt ≈ 184 KB/s (Lasttests hochgerechnet: 9 920 + 1 109 + 2 188 =
13 217 bzw. 11 960 + 876 + 2 188 = 15 024 B/s je Client – die Formel liegt 5–19 % darüber); 8 Menschen ohne Bots: ≈ 7,7 KB/s
je Client, gesamt ≈ 54 KB/s. Daraus bei
einer Upload-Grenze (Stau gemessen; ohne Stau rechnet recommend() das Gemessene × 2 hoch) von 100 000 B/s → 9 Menschen ohne
Bots / 6 bei 32 Akteuren; 200 000 B/s → 17 / 11; 400 000 B/s → 24 / 20 (1 KB = 1024 Byte). Die Upload-Messung nimmt nur Fenster ≥ 3 s (Bündel aus langen Bildern zählten vorher × 10).

**Läufe** (Prüfrechner, 4 Kerne, Fremdlast 6–14; ein mp-test-Lauf ≈ 13–18 min), Endstand mit allen Korrekturen:
- `mp-test` ideal: 66/66 – Positionen Anna→Host 0,00 m / Anna→Bert 0,22 m / Host→Bert 0,08 m, Puppe läuft nie rückwärts
  (Host 1,2 Bilder/s), Halt 3,00 → 3,00 s auf beiden Seiten, „Einsatz“ mit smg_vp9 auf beiden Seiten, 20-m-Teleport →
  'teleport' + 'correct' (0,0 m zurück), Sturz 9 m, Rutschen 5,6 m (17 Zustände mit Rutsch-Bit) ohne Verstoß, verborgener
  Host-Tab simuliert weiter, keine Seitenfehler. (Ein Vorlauf: 1× „rückwärts“ bei Host 1,5 Bilder/s → Korrektur 9.)
- `mp-test --params="netlag=150&netjitter=30&netloss=5"`: 66/66 – Positionen ≤ 0,22 m, nie rückwärts, Halt 3,00/2,93 s
  stabil, Teleport erkannt, Rutschen 5,6 m (16 Zustände) ohne Verstoß, Online-Pause: Zeit läuft weiter. Vorläufe: 2× je 1
  Fehlschlag im Prüfskript (das Rutschen begann, bevor der um die Laufzeit verspätete Host-Spawn in der Luft ankam – der Spawn
  brach es nach 0 m ab; Prüfung wartet jetzt auf den Spawn), 1× Abbruch beim Beitritt ('keine-antwort': Host unter
  Fremdlast > 12 s blockiert → 'welcome'-Frist 20 s, Prüfung versucht einmal neu).
- `mp-test --params="netlag=300&netloss=15"` (verschlechtert): 66/66 – Positionen 0,00 m, nie rückwärts (Host 1,5 Bilder/s), Halt
  2,95/2,85 s stabil, „Einsatz“ mit smg_vp9, Teleport erkannt, Sturz 9 m, Rutschen 5,6 m (15 Zustände) ohne Verstoß,
  Online-Pause; keine hängenden Zustände, keine Seitenfehler (ein Vorlauf blieb beim Matchstart hängen – Seiten unter
  Fremdlast 13 eingefroren, Prüfskript hing in `page.evaluate`; Wiederholung bestanden).
- `mp-load-test`: 13/13 (Tabelle oben, Endstand bei Last 14); `mp-fight-rate`: regulär 2,2 KB/s, Veteran 0,9 KB/s
  Kampfverkehr je Client.
- `net-proto-test` 116/116, `net-test`, `net-room-test` 60/60, `net-interp-test` 9/9, `check.sh`, `preload --check`,
  `smoke --quality=low --params="mode=tdm&map=hafen" --end --seconds=20` (offline, ohne Fehler, Endbildschirm).

**Offen**: SwiftShader-Seiten zeichnen auf dem Prüfrechner unter Last nur 0,1–2 Bilder/s – der Countdown zählt je Bild höchstens
0,25 s, daher dauert der Matchstart dort Minuten (kein Fehler des Spiels, mp-test wartet bis 10 min). Die Glätte im echten Spiel
lässt sich dort nur grob messen (Host schafft im Hintergrund-Takt dann < 8 Bilder/s → nur Info); die Interpolation selbst ist
deterministisch belegt (oben). Unter 300 ms / 15 % Verlust: siehe Läufe. Weitere offene Punkte: (1) Treffer/Abschüsse gehen
zuverlässig an alle Clients, auch ferne – bei 32 Akteuren ≈ 2,2 KB/s je Client (≈ 14 % des Uploads je Client); ferne Bot-gegen-Bot-
Treffer könnten entfallen oder gebündelt werden (Stufe 2). (2) Die Größe der Granaten-/Raketen-Ereignisse ist geschätzt
(≈ 170 Byte), ihr Anteil klein (0,3/s). (3) Die 12 Last-Clients sind reine Netz-Clients (kein WebGL); echte Client-Seiten
wurden mit höchstens 2 gleichzeitig geprüft (mp-test). (4) Bildrate des Hosts unter echten 12 Clients auf echter Hardware
ist ungemessen – recommend() begrenzt dort über die gemessene Bildrate (< 30 FPS → 8, < 45 → 12).

- Stand 09.10. ~9:30: 24 % Wochenlimit verbraucht (nach Mehrspieler, Härtetest, Kartenrunden 1+2, VR). Rest bis zur Grenze: Abschlusskorrekturen, Regressionstest, Grenzland-Gras, Veröffentlichung, Fehler aus dem Freitagabend-Test.
- Stand 09.10. ~13:20: 35 % Wochenlimit. Ab jetzt sparsam: Abschlusstest als Skript (keine großen Agenten), Veröffentlichung, danach nur noch Fehlerbehebung aus dem Abendtest. Ziel: unter 45 % bleiben.

## 14. Fahrzeuge online (09.10., Spezifikation `docs/planung/panzer-mp.md` §C)

**Schalter**: Raum-Einstellung „Fahrzeuge“ (`room.settings.vehicles`, Standard `VEHICLES_ONLINE_DEFAULT` in `net/index.js`),
dazu „Außenansicht (Fahrzeuge)“ (`thirdPerson`, Standard an) und „Panzer nachladen“ (`vehReload` `'manuell'` | `'automatisch'`).
Alle drei gehen mit `cfg.net` an Host und Clients (`G.match.net`, `G.vehicles.rules`). Aus = Online-Spiel exakt wie vorher
(kein `attach`, kein Fahrzeugverkehr; nur `NET_VERSION` ist 2). `G.match.vehicles` steht vor `spawnBots` (Werfer der Bots).

**Rollen** (`vehicles/net.js`, `VehicleNet`):
- **Host** = Offline-Sim (Physik, Getriebe, Schaden, Brand, Wrack, Wiedererscheinen, Granaten, Laden) + Vermittler: Netz-Ids
  1…255 beim `vehicle:spawn`, Liste `{t:'vehicles', list:[[vid, typ, team 0|1|2, [netId|0 je Sitz]]]}` bei Änderung an alle und
  voll an neue Clients (`_admit`, dazu 1 s lang alle Blöcke jeden Takt).
- **Client** = Abbild (`attach(G, {replica: true})`, `sys.replica`, `sys.remote = net`): keine Spawns/Physik/Waffen/Schäden;
  Liste → `spawnVehicle` (Modell nach Typ + Team) bzw. Entfernen, Sitze über `placeInSeat`/`clearSeat`; Lage und Zustand aus
  den Schnappschüssen (`tickReplica` statt `Vehicle.update`); `_collideActors` nur für den eigenen Spieler ohne Überfahren;
  Granaten nur Darstellung (`shells.fire(…, {display: true})`), Explosionen kommen als 'ex'. Modelle beider Teams werden beim
  Laden mitkompiliert (Vorwärmen, nach dem Countdown wieder entfernt).

**Schnappschuss-Anhang** (`protocol.js`): hinter Akteuren + VR-Blöcken `u8 0x56, u8 nv, nv × 60 Byte` (Lage f32, Quaternion
i16, Geschwindigkeit cm/s, Gierrate, 4 Lafettenwinkel, HP, Zonen, Gang, Drehzahl, Getriebe-Bits + Motorlast (bits 4–7 von
`drive`), MG-Schusszähler je Sitz, Kanone/Ladeschritt/Fortschritt, Gestell, Magazine, Waffenwahl, Automatik-Restzeit).
Ohne Fahrzeuge kein Anhang (Byte für Byte wie vorher). Rate je Empfänger (`blocksFor`, unabhängig von INTEREST_MIN):
eigenes Fahrzeug und ≤ 160 m jeden Takt (20 Hz), übrige 5 Hz, parkende unbesetzte 1 Hz, ruhende Wracks 2 Hz;
`?netinterest=0` → alles jeden Takt. **Client-Absicht**: `FLAGS.VEHICLE` (Bit 12) im 30-Hz-Zustand, 16 Byte (vid, Sitz, Gas,
Lenkung, Bits Feuer/Bremse/Handbremse/Licht/Gang halten, Zähler hoch/runter/Schuss/MG-Nachladen/Waffenwechsel, Sicht,
Zielrichtung aus `seat.aimWant`, Blick `look.relYaw`). Der Host übernimmt sie nur, wenn die Puppe in genau diesem Sitz sitzt;
Zählerdifferenzen ≤ 7; Werte begrenzt.

**Anfragen** (zuverlässig, `veh` {a: enter | exit | seat | load}): Host prüft Leben, Abstand (`_boxDistance` ≤ 1,7 + 1,0 m),
Team, Sitz frei, 0,25 s Abstand je Client, Ladeschütze + Reihenfolge/Blick/Mindestzeiten (`loadAction(…, {net: true})`, Blick
zum Zeitpunkt der Handlung mitgeschickt). Antworten als 'ev': `vs` (Kanonenschuss → Darstellungsgranate, Mündungsfeuer,
Klang, Rückstoß bei allen), `vh` (Treffer an den Schützen), `vn` {why} (Ablehnung: besetzt, weit, feind, blockiert, tot,
sperre, schritt, blick, sitz), `vo` {pos, vel} (Ausstieg, vor der Liste; Client räumt den Sitz und setzt sich dorthin).
`vhit`: Infanterietreffer eines Clients auf ein Abbild-Fahrzeug (Waffe aus der Ausrüstung, Ursprung ≤ 3,5 m vom Auge, Punkt
≤ Wanne + 2 m, Reichweite, grobe Feuerrate) → Schaden wie offline. MG-Feuer läuft über die Schusszähler (Mündungsfeuer,
Klang, Leuchtspur lokal). `VehicleSystem.fire` zählt `_shotSerial` nicht mehr (sonst spielten Clients Infanterieschüsse).

**Anti-Cheat**: Sitzende Puppen prüft `checkState` nicht (der Host heftet sie an den Sitz); Aussteigen setzt den Anker neu
(`anticheat.onTeleport`, 'vo'). Auf/neben fahrenden Fahrzeugen (≤ 4 m) zählt deren Tempo als Zuschlag (`ctx.carry`). Sitze,
Feuerrate, Munition und Ladezustand entscheidet allein die Host-Sim. `actors`/`vehicles` sind jetzt Host-Nachrichten
(`RESERVED` + `HOST_ONLY`) – ein Client kann sie weder senden noch weiterleiten lassen.

**Beide Teams**: Grenzland je Team 2 KP-1 + 3 GW-4 (Kartendaten, unverändert); Reihum-Anmeldung, und ein Stellplatz, der
wegen der Stufen-Obergrenze nie ein Fahrzeug bekam, bleibt leer (low: je Team 2 Panzer + 1 Geländewagen, auch nach Wracks).
Andere Karten mit „Fahrzeuge“ an: `autoSpawns` je Team 1 KP-1 + 1 GW-4 (nur Host). Teamfarbe nach `spawnTeam` (Abbild aus
der Liste).

**Budget** (§9, `recommend.js`: + 20 Hz × (2 + V × 60 × 0,5) je Client, V = 10 Grenzland bzw. 4): typisch Grenzland ≈ 3,4 KB/s
je Client zusätzlich, höchstens ≈ 12 KB/s (10 Fahrzeuge nah und aktiv); Hafen (4) ≈ 1,5–2,5 KB/s. Liste ≈ 150 B je Änderung,
'vs' ≈ 120 B je Kanonenschuss; aufwärts je sitzendem Client 16 B × 30 Hz ≈ 0,5 KB/s.
**Gemessen** (`tools/mp-vehicle-test.mjs`, Hafen, 4 Fahrzeuge, 2 Clients, `snapStats`): 1827 Schnappschüsse, 505 KB, davon
Fahrzeug-Anhang 146 KB (29 %) = Ø 80 B bzw. 1,3 Blöcke je Schnappschuss → bei 20 Hz ≈ 1,6 KB/s je Client (Schätzung oben
1,5–2,5 KB/s). Liste: 12 Änderungen im ganzen Lauf.

**Prüfungen**: `net-proto-test` (Größen 11 + n·31 + nvr·11 + 2 + nv·60 bzw. 37 [+11] [+16], Rundlauf aller Felder,
abgeschnittene Pakete, ohne Anhang Byte für Byte gleich, Fahrzeugterm der Empfehlung), `net-room-test` (Standard/
Normalisierung `vehicles`/`thirdPerson`/`vehReload`, `cfg.net.*`), `mp-vehicle-test` (Host + Anna + Bert: beide Teams je ein
Panzer, Einsteigen/Sitzwechsel/Aussteigen über den Host, Fahren aus Annas Absicht ≥ 20 m und Lage danach gleich, Schuss → Treffer +
'vh' + gleiche HP, manuelles Nachladen über das Netz inkl. falscher Folge, Zerstörung mit Abschussliste `mbt_ap`, Wiedererscheinen
mit neuer vid, Anti-Cheat-Ablehnungen, Seite schließen → Sitz frei). Unter SwiftShader-Fremdlast (Last 8–16) läuft der Test mit
verborgenem Host (Worker-Takt) und Zeitfaktor 1,6 und braucht 25–35 min (`--limit`). Beim Schließen der Seite meldet ein Client
seinen Austritt jetzt über `pagehide` (sonst erst nach dem Verbindungs-Zeitlimit ≈ 20 s).
Stand 09.10. abends (Last 10–16): `mp-vehicle-test` 40/42 – die zwei Ausfälle waren Zeitmessung des Tests (Ablehnung
„schritt“ kam erst nach > 15 s an, Sitz frei 6,3 s ab dem Playwright-Aufruf); der Test wartet seitdem länger bzw. misst ab dem
Ereignis in der Seite (noch nicht erneut gelaufen). `mp-test` mit Fahrzeugen (Standard an): 66/67 – einzig „Puppe läuft nie
rückwärts“ (1 Rückschritt bei Host 1,2 Bilder/s, bekannte Unter-Last-Grenze, s. Korrektur 9); `net-proto-test` 175/175,
`net-room-test` 65/65, `net-interp-test` 9/9.
