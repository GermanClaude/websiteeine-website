# NULLPUNKT – Panzer mehrspielertauglich (verbindliche Spezifikation, 09.10.)

Wunsch des Spielers: „Mach die Panzer nochmal mehrspieler tauglicher. Die sollen bessere Motorleistung haben, Gangschaltung
wie in Squad44 und mehrere sichten“ + Nachtrag: beide Teams haben Panzer, Motoren schaffen größere Hügel bei gutem Fahren,
so realistisch wie möglich, manuelles Nachladen (umschaltbar in den Host-Einstellungen), detailliertere Modelle.

Diese Datei ist der Vertrag für vier parallele Umsetzer im selben Arbeitsbaum:
**A Antrieb** · **B Besatzung/Sichten/Nachladen** · **C Netz** · **D Modell**.
Pfade ohne Präfix: `assets/js/game/…`. „MUSS“ = Abnahmebedingung, „SOLL“ = nach dem Kern, „KANN“ = nur bei Zeit.

---------------------------------------------------------------------------------------------------------------------------
## 0. Zeitplan, Freigabe, Grundregeln

| Uhrzeit (UTC) | Meilenstein |
|---|---|
| bis 13:30 | Alle: Stubs/Haken laut §2.3 angelegt (Dateien existieren, Spiel lädt fehlerfrei) |
| bis 15:30 | A, B, D: Kern fertig + eigene schnelle Prüfungen grün. C: Host-Sim + Abbild + Sitzanfragen laufen (Hafen) |
| bis 16:45 | C: `tools/mp-vehicle-test.mjs` grün; A/B/D: Feinschliff, Bilder |
| 17:00 | Entscheidung Orchestrator: `VEHICLES_ONLINE_DEFAULT` (net/index.js) `true` nur, wenn mp-vehicle-test 2× grün |
| bis 18:15 | Gesamt-Regression (§F), Korrekturen |
| 18:30 | fertig geprüft (Veröffentlichung 21 Uhr Ortszeit) |

Freigabe-Schalter: Raumeinstellung **„Fahrzeuge“** (`room.settings.vehicles`, Standard = Konstante
`VEHICLES_ONLINE_DEFAULT` in `net/index.js`). Ist sie aus, verhält sich das Online-Spiel exakt wie heute (keine Fahrzeuge,
kein Fahrzeugverkehr), nur `NET_VERSION` ist 2. Alle Offline-Verbesserungen (A, B, D) müssen allein lauffähig sein.

Regeln für alle Umsetzer:
1. Nur eigene Dateien bzw. eigene Abschnitte geteilter Dateien ändern (§2). Geteilte Dateien: **vor jedem Edit neu lesen**,
   kleine abschnittsweise Edits (Edit-Werkzeug), **nie** die ganze Datei mit Write überschreiben, keine Umformatierung
   fremder Abschnitte. Schlägt ein Edit fehl (Datei geändert), neu lesen und erneut versuchen.
2. Gegen die Schnittstellen in §3 programmieren, fremde Teile defensiv nutzen (`?.`, Standardwerte), nie auf andere warten.
3. Deutsch in Kommentaren/UI, Stil des umgebenden Codes. Keine Modellnamen in Code/Doku. Kein git commit/push.
4. Nicht anfassen: `dev/zielbild*`, `world/terrain/vegetation.js`, `world/terrain/splat.js`, `world/atlas.js`, Kartendaten
   (`world/maps/*.js`: `vehicles`-Einträge setzen Sperrflächen für Bewuchs → Kollision würde sich ändern!).
5. Weltkollision bleibt auf allen Stufen identisch (Fahrzeuge sind dynamisch, nicht Teil der Weltkollision).
6. Schwere Browser-Läufe: vorher `/proc/loadavg` prüfen (> 6 → 60 s warten, wie `tools/puppet-test.mjs` waitForLoad),
   immer mit `timeout`, `quality=low`, kleine Fenster (640×360). Höchstens ein eigener Browser gleichzeitig.
7. Neue Module: `node tools/preload.mjs` (ohne `--check`) aktualisiert die Preload-Liste; am Ende `--check` grün.
8. Jeder liefert am Ende: geänderte Dateien, Prüfergebnisse, offene Punkte (kurz, als Antwort – keine Berichtsdateien).

---------------------------------------------------------------------------------------------------------------------------
## 1. Befunde, die den Entwurf bestimmen (geprüft im Code)

- Online sind Fahrzeuge aus (`main.js` ~989 `if (!netCfg) …attach`). Fahrzeug-Ids `${type}-${++SERIAL}` sind nicht stabil.
- Ausstattung hängt von der Grafikstufe ab (`CAP` index.js:24) → online entscheidet allein der Host.
- Auf Clients würde die Fahrzeuglogik selbst rechnen (Physik, Schaden, Brand, Spawns, `_onImpact`, `_onExplosion` –
  'ex'-Ereignisse kommen als lokale 'explosion' an!). → Clients betreiben ein **Abbild** ohne Sim/Schaden/Spawns.
- Bots fahren heute nie (keine Bot-KI nutzt Fahrzeuge); Bot-API nur in `dev/vehicles.js`. `bot.js:1220` liest
  `v.body.velocity` (gibt es nicht, richtig: `v.body.vel`).
- Gemessenes Ist-Tempo KP-1: 30,5 km/h vorwärts, 30°-Hang unmöglich, „Motorbremse“ stoppt in 2 s. Geländewagen 63,5 km/h.
- `VEHICLE_GRAVITY = 13` (statt 9,81) bleibt (Federung darauf abgestimmt) → alle Kräfte/Steigungen rechnen mit 13
  (Gewichtskraft KP-1 = 676 kN). Folge und Ausgleich siehe §A.1.
- Gamepad X = reload **und** interact (im Fahrzeug: Nachladen + Aussteigen zugleich). Pad hat keinen Weg zu Sitz 0/1.
- `world.surfaceAt(p)` existiert (Bigworld + Standardwelt) → Oberflächen-Reibwerte möglich.
- `G.input.simulate.{press,release,tap,move,look,code}` existiert (Tests).
- Grenzland: je Team 2 Panzer + 3 Geländewagen an den HQ-Stellplätzen (symmetrisch, Reihum-Anmeldung auch bei CAP 6).
  Andere Karten: `autoSpawns()` = je Team 1 Panzer + 1 Geländewagen (bei `?vehicles=1` bzw. `G.match.vehicles`).
- Dreiecke heute (high, LOD0/1/2): KP-1 9324/3524/864, GW-4 7912/2128/1248; low: KP-1 4936/2784/864, GW-4 3088/2020/1248.

---------------------------------------------------------------------------------------------------------------------------
## 2. Dateizuständigkeit

### 2.1 Eigene Dateien
| Umsetzer | Eigene Dateien (allein) |
|---|---|
| **A Antrieb** | `vehicles/sim.js`, **neu** `vehicles/drivetrain.js`, **neu** `vehicles/drive-input.js`, **neu** `vehicles/hud-drive.js`, `vehicles/audio.js`, `vehicles/autopilot.js`, `shared/bindings.data.js`, `shared/settings.js`, `dev/vehicles.js` + `dev/vehicles.html` (Statuszeile, DevInput, Hilfetext), **neu** `tools/tank-drive-test.mjs` |
| **B Besatzung/Sichten** | `vehicles/camera.js`, `vehicles/controls.js` (außer Fahrblock, §2.3), `vehicles/hud.js` (außer 3 Haken von A), **neu** `vehicles/views.js` (Sichtdaten-Helfer, Overlays/Strichplatte), **neu** `vehicles/crew.js` (Hauptkanone/Nachladen/Sitzwechsel-Logik), `bots/bot.js` (nur Zeile ~1220), `modes/conquest.js` (nur falls nötig), **neu** `tools/tank-crew-test.mjs` |
| **C Netz** | `net/*.js` (protocol, sync-host, sync-client, sync-common, index, anticheat, recommend), **neu** `vehicles/net.js`, `vehicles/projectiles.js`, `ui/net-menus.js`, `main.js` (Fahrzeug-Anschluss), `tools/net-proto-test.mjs`, `tools/net-room-test.mjs`, **neu** `tools/mp-vehicle-test.mjs`, `docs/planung/mehrspieler.md` (neuer Abschnitt §14 Fahrzeuge), `bots/manager.js` (nur `_vehiclesExpected`), `dev/fake-client.html` (nur falls Dekodierung bricht) |
| **D Modell** | `vehicles/models.js`, `vehicles/materials.js`, **neu** `tools/tank-model-test.mjs` |

### 2.2 Geteilte Dateien – Abschnitte
| Datei | A | B | C |
|---|---|---|---|
| `vehicles/data.js` | `engine`-Blöcke beider Fahrzeuge, `grip`, `drag` | `VEHICLE_WEAPONS` (mbt_*), `seats` (inkl. `views`), neu `crew`, `ammo`, `interior`, `hatches`, `gunLimits/traverse/elevate` | – |
| `vehicles/vehicle.js` | `update()`: Blöcke „Fahrer → Steuerung“ + „Komponenten → Fahrleistung“ (heute Z. 466–493), `destroy()` Steuerungs-Reset (Z. 457–458) | alles andere: `newIntent`, Konstruktor-Sitze, Abfragen, Bot-API, Lafetten, `_aimSeat`, `_updateWeapons`, Block „Lafetten + Waffen“ in `update()`, Hauptkanone, `sync()`-Zusätze (Luken/Innenraum) | Konstruktor `this.netId = null`; erste Zeile in `update()`: Abbild-Weiche (§C.2) |
| `vehicles/index.js` | – | Sitze (`enter`, `_seat`, `_unseat`, `exit`, `removeFromSeat`, `switchSeat`, `_findExit`, `_playerEnter`, `_playerExit`), `updateOccupant`, `_pinOccupants`, `_updatePlayer`, `_nearestEnterable`, neue `request*`, `setSeatView`, `rules`, `viewPref` | `attach/detach` (Abbild-Modus, `remote`), `_setupSpawns`/`registerSpawn`/`_spawnAt`/`spawnVehicle`/`removeVehicle`, `update()` (live/Abbild-Zweig), `_collideActors`/`_collideVehicles` (Abbild-Zweige), `fire()`, `_onImpact`/`_onExplosion`/`_onKill` (Abbild-Wachen), `stats` |
| `vehicles/hud.js` | 3 Haken: Import + `this.drive = new DriveHUD(this)` im Konstruktor, `this.drive?.update(dt, s)` in `update()`, `this.drive?.dispose()` in `dispose()` | alles andere | – |
| `vehicles/controls.js` | Fahrblock (heute Z. 47–61) wird durch einen Aufruf `readDriveControls(…)` ersetzt (A, sofort) | alles andere | – |

### 2.3 Sofort-Stubs (bis 13:30, damit niemand wartet)
- **A** legt `drivetrain.js`, `drive-input.js` (enthält zunächst den bisherigen Fahrblock 1:1), `hud-drive.js` (leere
  `DriveHUD`) an, ersetzt den Fahrblock in `controls.js` durch `readDriveControls(input, vehicle, seat, dt)` und setzt die
  drei Haken in `hud.js`. Spiel lädt fehlerfrei.
- **B** ergänzt `newIntent()` um alle Felder aus §3.2 (Standardwerte) und die Sitzfelder aus §3.3; legt `views.js`/`crew.js`
  an; ergänzt die `request*`-Methoden (§3.6) in `index.js` (mit `this.remote`-Weiche).
- **C** ergänzt `this.netId = null` in `vehicle.js` und legt `vehicles/net.js` an. Abbild-Weiche bevorzugt im Abbild-Zweig
  von `VehicleSystem.update()` (statt `v.update()` → `this.net.tickReplica(v, dt)`), dann bleibt `vehicle.update()` unberührt.
- **D** liefert die API-Funktionen aus §D.2 sofort als No-ops (`setHatch`, `setInterior`, …) im Modellobjekt.

---------------------------------------------------------------------------------------------------------------------------
## 3. Schnittstellen (verbindlich)

### 3.1 Triebwerkszustand `vehicle.body.drive` (A schreibt; Abbild: C schreibt; HUD/Klang lesen)
```js
body.drivetrain   // Drivetrain-Instanz (A), auch im Abbild vorhanden (wird dort nicht gerechnet)
body.drive = {    // === body.drivetrain.state
  gear: 0,          // eingelegter Gang: −2 … 5 (KP-1), −1 … 4 (GW-4); 0 = N
  targetGear: 0,    // Ziel während des Schaltens (sonst = gear)
  shifting: false,  // Kupplung offen (Zugkraftunterbrechung)
  rpm: 0,           // Motordrehzahl 1/min (0 = Motor aus/unbesetzt)
  rpmNorm: 0,       // (rpm − idle) / (rated − idle), 0 … ~1,06 (Klang, Netz)
  throttle: 0,      // wirksame Motorlast 0 … 1 (nach Regler)
  gearbox: 'auto',  // 'hold' (Gang halten) | 'auto'
  lugging: false,   // Drehzahl unter dem Drehmomentband bei Last (HUD-Hinweis „runterschalten“)
  slip: 0,          // Kettenschlupf/Durchdrehen 0 … 1
}
gearName(def, g) → 'R2' | 'R1' | 'N' | '1' … (export aus drivetrain.js)
gearList(def)    → z. B. [-2, -1, 0, 1, 2, 3, 4, 5]
```
`body.speed` (m/s vorwärts) und `body.trackSpeed[2]` bleiben; `body.rpm` (0…1) bleibt als Alias von `rpmNorm` für alten Code.

### 3.2 Sitz-Absicht `seat.intent` (newIntent, B pflegt die Funktion; Felder je Bereich)
```js
// Fahren (A liest/schreibt): bisherige Felder throttle, steer, brake, handbrake, moveTo/path/… bleiben
throttle: 0,        // 'auto': −1 … 1 wie bisher; 'hold': 0 … 1 = Vollgas-Anteil in Fahrtrichtung des Gangs
gearbox: 'auto',    // 'hold' | 'auto' (Spieler aus Einstellung, Bots/Autopilot immer 'auto')
shiftUp: 0,         // Anzahl ausstehender Hochschaltungen (Flanken; true zählt als 1), A setzt nach Verbrauch auf 0
shiftDown: 0,       // dito runter
// Schützen (B): aimDir, aimAt, fire, firePressed, weapon, cycleWeapon, reload, fireWhenAligned bleiben
view: 0,            // gewünschter Sichtindex (Netz/Host), B wendet über sys.setSeatView an
```
### 3.3 Sitzobjekt (B) – neue Felder
```js
seat.view = 0;          // Index in seat.def.views
seat.hatchOpen = false; // Luke offen (Host/Offline aus der Sicht; Abbild aus dem Netz)
seat.hatchT = 0;        // Lukenstellung 0 … 1 (Darstellung, geglättet)
seat.readyAt = 0;       // G.time.elapsed, ab dem der Sitz nach einem Wechsel bedienbar ist
seat.aimWant = new THREE.Vector3(); // gewünschte Weltrichtung der Lafette (aus _aimSeat, inkl. Ballistik in 3P) – C sendet sie
seat.proxy = null;      // Bot-Fahrer, der stellvertretend diesen leeren Schützensitz bedient (§B.8)
```
### 3.4 Hauptkanone `vehicle.gun` (B; nur Fahrzeuge mit Waffe kind 'shell'; Abbild: C schreibt)
```js
vehicle.gun = {
  loaded: 'mbt_ap',      // null | 'mbt_ap' | 'mbt_he' (Fahrzeug startet geladen mit PG)
  breechOpen: false,
  held: null,            // Granate in den Händen des Ladeschützen: null | 'mbt_ap' | 'mbt_he'
  step: 'geladen',       // 'leer' | 'gegriffen' | 'eingeschoben' | 'geladen'
  busy: 0,               // Restzeit der laufenden Handlung (s)
  busyKind: null,        // 'greifen' | 'einschieben' | 'schliessen' | 'auto'
  select: 'mbt_ap',      // Munitionswahl des Ladeschützen
  rack: { mbt_ap: 22, mbt_he: 18 },
  auto: false,           // Automatik-Nachladen aktiv (Regel/Bot)
  autoT: 0,              // Restzeit Automatik
}
vehicle.loadAction(seat, action, ammo?) → { ok:boolean, why?:string }   // action: 'greifen'|'einschieben'|'schliessen'|'munition'
```
### 3.5 Sichten `seat.def.views` (B, data.js) – Format
```js
{ id, label, space: 'hull'|'turret'|'gun'|'cupola'|'mg', pos: [x,y,z],      // Kameraanker im Raum
  look: 'mount'|'rel'|'relTurret', yaw: [min,max], pitch: [min,max],         // Blickgrenzen (rel*: relativ)
  zoom: [z0, z1?, z2?],          // z0 = Grundvergrößerung der Sicht, z1 = Zielen (ads), z2 = Zielen + Waffe wechseln
  overlay: null|'slit'|'optic'|'wide'|'peri'|'binocular'|'loader',
  exposed: false, hatch: null|'driver'|'commander'|'loader', pin: [x,y,z] (Füße bei offener Luke, im Raum `space`),
  interior: false,               // Innenraum des Turms sichtbar (Ladeschütze)
  tp: { dist, height, pivot } }  // nur für id 'aussen' (Außenansicht 3P)
```
### 3.6 Anfragen über das System (B implementiert, C hängt sich ein)
```js
sys.remote = null;                       // C setzt auf Clients einen Vermittler (vehicles/net.js), sonst null
sys.requestEnter(actor, v, seatIdx=null) // offline/Host: enter(); Client: remote.enter(v, seatIdx) → −1 (ausstehend)
sys.requestExit(actor)                   // offline/Host: exit(); Client: remote.exit()
sys.requestSeat(actor, idx)              // offline/Host: switchSeat() mit Wechselzeit; Client: remote.seat(idx)
sys.requestLoad(actor, v, action, ammo)  // offline/Host: v.loadAction(); Client: remote.load(action, ammo)
sys.setSeatView(actor, viewIndex)        // lokal sofort (Kamera); Host übernimmt die Sicht des Clients aus dem Netz
sys.placeInSeat(actor, v, idx, {net:true}) // nur Buchhaltung (keine Regeln/Teleport), für das Abbild (C ruft)
sys.clearSeat(actor, {net:true})           // dito
sys.allowedViews(seat) → Index-Liste      // beachtet sys.rules.thirdPerson
sys.rules        // Getter (B): { thirdPerson, reload: 'manuell'|'automatisch' } – online aus G.match.net, sonst Einstellungen
sys.replica = false;                       // C: true auf Clients (Abbild)
```
Alle Spieler-Auslöser (Einsteigen, Aussteigen, Sitzwechsel, Ladeschritte) gehen **ausschließlich** über `request*`.

### 3.7 Modell-API (D liefert, B nutzt; immer mit `?.` aufrufen)
```js
model.hatches = { driver, commander, loader }   // Object3D-Drehpunkte (Scharnier) oder fehlt beim Geländewagen
model.setHatch(id, t)        // t 0 = zu … 1 = offen
model.interior               // Group im Turm (unsichtbar), nur für den lokalen Insassen sichtbar
model.setInterior(on)
model.setBreech(t)           // Verschlusskeil 0 = zu … 1 = offen (Teil des Rohrs, folgt gunPitch)
model.setRack({ mbt_ap, mbt_he })  // sichtbare Granaten im Gestell (Anzahl, ab Kapazität gekappt)
model.setHeld(type|null)     // Granate in den Händen (vor der Ladeschützen-Kamera, Turmraum)
```
### 3.8 Netz-Id
`vehicle.netId` (u8, 1…255) vergibt **nur der Host** beim Erscheinen (C). Offline `null`.

### 3.9 Ereignisse (neu)
`vehicle:gear` {vehicle, gear} (A) · `vehicle:view` {vehicle, seat, actor, view} (B) · `vehicle:load` {vehicle, actor, step, ammo} (B) ·
`vehicle:loaded` {vehicle, ammo} (B) · alle bisherigen bleiben. Abbild-Ereignisse tragen `net: true`.

---------------------------------------------------------------------------------------------------------------------------
## A. Triebwerk und Getriebe (Umsetzer A)

### A.1 Realismus-Zahlen und Begründung
Bezug: öffentlich bekannte Größenordnungen westlicher Kampfpanzer der 50–60-t-Klasse (z. B. Leopard 2: 1100 kW bei
2600/min, max. Drehmoment ~4700 Nm bei ~1600–1700/min, Wandlergetriebe mit 4 Vorwärts-/2 Rückwärtsgängen, Spitze
~68–72 km/h, rückwärts ~31 km/h, Steigfähigkeit 60 %, 0→32 km/h in ~6–7 s; Turmdrehung ~360° in ~9 s; Rohr +20°/−9°).
Wir nehmen **5 Vorwärtsgänge** (feinere Stufen fürs Spiel, Wunsch „R2 R1 N 1…5“).

Wegen `VEHICLE_GRAVITY = 13` ist jede Steigung im Spiel 1,33× „schwerer“ als real. Ausgleich **nicht** über mehr
Leistung, sondern über den Wandler (Drehmomentwandlung beim Anfahren) und einen kurzen 1. Gang; die Zielwerte (A.10)
sind mit g = 13 nachgerechnet (Längsmodell, siehe A.3). Ergebnis Längsmodell (Ebene/Steigung, Kette auf Erde µ 0,85):

| KP-1 | Ergebnis Modell |
|---|---|
| Spitze vorwärts (5. Gang) | 69,6 km/h |
| rückwärts (R2) | 29,7 km/h |
| 0→20 / 0→30 km/h (Automatik) | 3,5 s / 6,8 s |
| 31° (60 %) im 1. Gang | steigt mit ~4 km/h |
| 31° im 2. Gang | bleibt stehen (rollt zurück) |
| 25° im 3. Gang | rollt zurück; 10° im 5. Gang: bleibt stehen |
| Grenze im 1. Gang | ~37° (Reibung Gras µ 0,7 begrenzt bei ~33°) |

| GW-4 | Ergebnis Modell |
|---|---|
| Spitze | ~112 km/h, rückwärts ~31 km/h, 0→40 km/h 2,9 s |

### A.2 Datenblock (`data.js`, A)
```js
// KP-1 Mammut
engine: {
  idleRpm: 700, ratedRpm: 2600, cutRpm: 2750, cruiseRpm: 2300,     // Leerlauf, Nenn-, Abregel-, Marschdrehzahl
  torque: [[600, 2200], [700, 2700], [1000, 3800], [1400, 4550], [1700, 4700], [2000, 4600], [2300, 4350], [2600, 4040], [2750, 0]], // Nm
  gears: { '-2': 2.55, '-1': 5.9, 1: 6.4, 2: 4.1, 3: 2.6, 4: 1.65, 5: 1.05 }, // Getriebe (Betrag), Richtung aus dem Vorzeichen des Gangs
  finalDrive: 4.4, sprocketR: 0.32, efficiency: 0.75, rotInertia: 1.15, // Achs-/Seitenvorgelege, Triebradradius (m), η, Drehmassenzuschlag
  converter: { stallRpm: 1450, mult: 1.75, coupleRpm: 1400 },         // Wandler: Festbremsdrehzahl, Wandlung, Überbrückung
  torqueLag: 0.25, shiftTime: 0.5, autoUp: 2450, autoDown: 1250,      // Ladedruck-Verzug (s), Schaltpause (s), Automatik
  engineBrake: [300, 0.4],            // Schleppmoment Nm = a + b·(rpm − idle), nur bei Last 0
  rollRes: { concrete: 0.03, tile: 0.03, wood: 0.035, metal: 0.03, dirt: 0.045, grass: 0.05, sand: 0.08, default: 0.04 },
  traction: { concrete: 0.75, tile: 0.7, wood: 0.6, metal: 0.55, dirt: 0.85, grass: 0.7, sand: 0.6, default: 0.8 }, // µ längs
  airRes: 4.0,                        // ½·ρ·cw·A (N/(m/s)²)
  brake: 330000, turnRate: 0.8, turnRateMoving: 0.62, latAccMax: 4.5,
  maxSpeed: 18.9, reverseSpeed: 7.8,  // Kennwerte (Autopilot, HUD) – aus den Übersetzungen bei Nenndrehzahl
},
// GW-4 Steppe (Automatik, Allrad)
engine: {
  idleRpm: 800, ratedRpm: 5000, cutRpm: 5400, cruiseRpm: 4200,
  torque: [[700, 160], [800, 190], [1500, 250], [2500, 290], [3500, 280], [4500, 230], [5000, 190], [5400, 0]],
  gears: { '-1': 5.6, 1: 5.28, 2: 3.42, 3: 2.22, 4: 1.44 },
  finalDrive: 5.0, sprocketR: 0.42 /* Radradius */, efficiency: 0.85, rotInertia: 1.08,
  converter: { stallRpm: 2000, mult: 1.9, coupleRpm: 1800 }, torqueLag: 0.15, shiftTime: 0.25, autoUp: 4700, autoDown: 2000,
  engineBrake: [25, 0.012],
  rollRes: { concrete: 0.015, tile: 0.015, wood: 0.02, metal: 0.015, dirt: 0.035, grass: 0.045, sand: 0.09, default: 0.025 },
  traction: { concrete: 1.0, tile: 0.95, wood: 0.85, metal: 0.8, dirt: 0.8, grass: 0.7, sand: 0.6, default: 0.9 }, // Faktor auf grip.long
  airRes: 1.6, brake: 30000, maxSpeed: 30.5, reverseSpeed: 8.6,
},
```
`force`/alte Felder entfallen; `maxSpeed`/`reverseSpeed` bleiben als Kennwerte. A darf `efficiency`, `rotInertia`,
`converter.mult`, Reibwerte in ±15 % nachstimmen, um A.10 in der echten 3D-Sim zu treffen (Werte in A.10 sind maßgeblich).

### A.3 Formeln (je Simulationsschritt h = 1/60 in `VehicleBody.step`, A)
```
dir = sign(gear) (N: 0) ; i = gears[|gear|]·finalDrive ; r = sprocketR
nWheel = max(0, vF·dir) · i / r · 60/2π                       // Drehzahl aus der Fahrt (1/min)
Wandler: nWheel < coupleRpm →  rpm = max(nWheel, idle + (stall − idle)·thr) ;  k = 1 + (mult − 1)·(1 − nWheel/coupleRpm)
         sonst                 rpm = nWheel ; k = 1
         (N oder Schaltpause: rpm → idle + (cut − idle)·thr·0.9 mit Zeitkonstante 0,3 s, k = 0)
Te  += (T(rpm)·thr·dmg.torque − Te) · min(1, h / torqueLag)        // T(rpm) aus der Kurve linear, oberhalb cutRpm 0
F    = dir · min(Te·k·i·η / r, µ(surface)·N_ges)                  // Zugkraft, durch Reibung begrenzt (Rad-Reibungskreis bleibt)
Last 0 und rpm > idle: F −= dir · (a + b·(rpm − idle))·i/(η·r)    // Motorbremse über den Gang (nicht in N)
Rollwiderstand je Rad/Rolle: −sign(vLong)·crr(surface)·N  (ersetzt −vLong·0.015·N)
Luft: −airRes·v·|v| entlang der Fahrt (ersetzt vel/(1+drag·…), vertikal nicht mehr dämpfen)
Trägheit: Antriebskraft wird durch rotInertia geteilt (F_eff = F / rotInertia)
```
- `µ(surface)`/`crr(surface)`: `world.surfaceAt(origin)` höchstens alle 0,25 s je Fahrzeug, Ergebnis zwischenspeichern;
  fehlt `surfaceAt` → `default`. Rad (GW-4): `traction` ist Faktor auf `grip.long`.
- Kettenschlupf: Reibungskreis wie bisher; `drive.slip = max(slip, Überschreitung)`.
- Antriebskraft verteilt auf Räder mit Kontakt wie bisher (`drivePer`).
- Alte Sonderfälle (`cap`, `(1−r³)`, Rad-erst-bremsen, Ketten-Gegenschub, Motorbremse 1.4·mEff, `rpm`-Heuristik) entfallen.
- Bergab im Gang: Motorbremse wirkt; über `cutRpm` zusätzlich starkes Schleppmoment (×3) – der Gang hält das Tempo.

### A.4 Getriebelogik (`drivetrain.js`)
**Gang halten (`gearbox 'hold'`, Standard Panzer):**
- `shift(+n)`/`shift(−n)`: `targetGear` ± n innerhalb `gearList`; **Richtungssperre**: in einen Gang gegen die
  Fahrtrichtung nur bei |vF| < 1,5 m/s (sonst bleibt N, Meldung „Erst anhalten“ über `vehicle:gear` mit `blocked`).
- Jeder Schaltvorgang: `shifting = true`, `shiftT = shiftTime` (neu gestartet bei weiterem Tippen), keine Zugkraft,
  Drehzahl läuft zur neuen Synchrondrehzahl (bzw. Leerlauf); danach `gear = targetGear`. Ereignis `vehicle:gear`.
- Drehzahlregler: Solldrehzahl `cruiseRpm` (ohne Taste) bzw. `cutRpm` bei Vollgas (`controls.throttle` > 0);
  `thr = clamp(max(controls.throttle, (nSoll − rpm)/200), 0, 1)`. Ohne Taste fährt der Panzer also das Marschtempo des
  Gangs (KP-1 bei 2300/min: 1. ~9,8 · 2. ~15,4 · 3. ~24 · 4. ~38 · 5. ~60 km/h) und hält es ohne gedrückte Taste.
- **Kein automatisches Runterschalten.** Fällt rpm unter 1200 bei thr > 0,8 und gear ≥ 2 → `lugging = true` (HUD-Hinweis).
- Bremse (`controls.brake` > 0) setzt den Regler aus (thr = 0) und bremst mit `brake`.
- **Neutrallenkung:** in N mit Lenkung dreht der Panzer auf der Stelle (`turnRate` 0,8 rad/s ≈ 360° in 8 s), Motor geht auf
  ~1600/min (Klang). In Fahrt: Gier-Regler wie bisher, Rate `min(turnRateMoving, latAccMax/|vF|)`.
- Unbesetzter Fahrersitz bzw. Sitzwechsel des Fahrers: `setGear(0)` + Handbremse, Motor aus (rpm 0) erst nach 2 s ohne Fahrer.

**Automatik (`'auto'`, Standard GW-4, immer für Bots/Autopilot):**
- `controls.throttle` −1 … 1 wie bisher. Stand (|vF| < 0,8) + Gas vorwärts → 1. Gang, + Gas rückwärts → R1.
  Gas gegen die Fahrtrichtung → Bremse (`brake = |throttle|`) bis |vF| < 0,8, dann Richtungswechsel.
- Hochschalten bei rpm ≥ `autoUp`, runter bei rpm ≤ `autoDown` (nur wenn nWheel ≥ 0,6·coupleRpm); Kickdown bei
  thr > 0,9 und rpm < 1500 → einen Gang runter. Throttle 0 → Gang bleibt, kein Kriechen (Te = 0).

**Schlaf (sim.js):** nur wenn `gear === 0`, |throttle| < 0,01, |steer| < 0,01 (wie bisher) – im eingelegten Gang mit Regler
schläft das Fahrzeug nicht. Aufwecken zusätzlich bei `shiftUp/shiftDown`.

### A.5 Eingabe (`drive-input.js`, Einstellungen, Bindungen)
`readDriveControls(input, vehicle, seat, dt)` schreibt nur Fahrfelder der Absicht (§3.2):
- Einstellung `vehGearbox` (`shared/settings.js`, Gruppe `'steuerung'`, enum `['halten','automatik']`, Labels
  „Gang halten (wie Squad 44)“ / „Automatik (W/S halten)“, Standard `'halten'`). Gilt für Kettenfahrzeuge;
  GW-4 immer `'auto'`. Bots/Autopilot: `'auto'`.
- **Gang halten:** Flanke von `move.y` (Schwelle ±0,75, Rückstellung unter 0,35; gilt für Tastatur, Pad-Stick, VR-Stick)
  → `shiftUp`/`shiftDown` += 1; zusätzlich Aktionen `gear_up`/`gear_down` und Touch `v_gear_up`/`v_gear_down`.
  Touch-Stick: **keine** Schaltflanken (nur Lenken), dort nur die Knöpfe. Halten in Fahrtrichtung des Gangs ≥ 0,25 s
  (W bei Vorwärtsgang, S bei R-Gang, Pad-Stick ≥ 0,9) bzw. `v_gas` bzw. Pad RT (analog) = Vollgas (`throttle`).
- **Automatik:** wie bisher (`move.y`, `v_gas`/`v_brake`, Pad RT/LT bei Sitz ohne Waffen).
- Bremse: `jump` (Leertaste / Pad A / VR A) und Touch `v_brake` (Gang halten) bzw. LT (Pad, Sitz ohne Waffen) →
  `brake = 1` (Kette) bzw. `handbrake` (GW-4 wie bisher). Lenken `move.x`.
- Neue Aktionen in `shared/bindings.data.js` (A), neue Gruppe `fahrzeug: 'Fahrzeug'` in `ACTION_GROUPS`
  (vorher `grep -rn ACTION_GROUPS` – UI/Website, die Gruppen fest aufzählen, nachziehen):

| Aktion | Label | kb | pad | xr | Anteil (ALLOWED_SHARES) |
|---|---|---|---|---|---|
| `gear_up` | Hochschalten (Panzer) | [] (W tippen) | `Pad5` (RB) | [] | mit `tactical` |
| `gear_down` | Herunterschalten (Panzer) | [] (S tippen) | `Pad4` (LB) | [] | mit `grenade` |
| `seat_next` | Nächster Sitz (Fahrzeug) | [] | `Pad15` (▶) | `XrH3` | mit `streak3` bzw. `melee` |
| `seat_prev` | Vorheriger Sitz (Fahrzeug) | [] | `Pad14` (◀) | [] | mit `streak2` |

  `findConflicts` muss mit den Standardbelegungen leer bleiben.

### A.6 HUD Antrieb (`hud-drive.js`, A)
`class DriveHUD { constructor(vehicleHud); update(dt, s); dispose() }` – eigenes CSS (id `vehicle-drive-css`), eigenes
Element in `vehicleHud.el.panel` (unter dem Kopf): Gangleiste `R2 R1 N 1 2 3 4 5` (aktueller Gang hervorgehoben, Zielgang
blinkt beim Schalten, GW-4 mit „A“), Drehzahlbalken 0…cutRpm mit grünem Drehmomentband (1400–2400) und rotem Bereich
(> ratedRpm), Zahl 1/min, Modus „Gang halten“/„Automatik“, Hinweis „Drehzahl zu niedrig – runterschalten“ bei `lugging`.
Nur im Fahrersitz (`s.seat.def.drive`). km/h bleibt im Kopf (hud.js). Touch: Knöpfe `vc-gear-up` (`v_gear_up`, „Gang +“)
und `vc-gear-down` (`v_gear_down`, „Gang −“), nur sichtbar bei `body[data-vehicle="mbt"][data-vehicle-drive="1"]`
(A setzt `data-vehicle-drive` im eigenen update), Lage im CSS von hud-drive.js (nicht über vc-gas/vc-brake legen).
Schreibzugriffe nur bei Änderung (wie `VehicleHUD._set`). Tastenhinweise im Fahrersitz (Gang halten):
„W/S tippen: schalten · W halten: Vollgas · Leertaste: Bremse · N + A/D: drehen“.

### A.7 Klang (`audio.js`, A)
`EngineVoice.set`: Grundfrequenz aus `drive.rpmNorm` (Leerlauf hörbar, f = base + span·rpmNorm), Last aus `drive.throttle`
(Filter/Rauschen), kurzer Einbruch beim Schalten (`drive.shifting`), Kettenklappern weiter aus `trackSpeed`. Funktioniert
unverändert auf Abbildern (C schreibt dieselben Felder). Fallback auf `body.rpm`, falls `drive` fehlt.

### A.8 Autopilot und Bots
`autopilot.js`: `def.engine.maxSpeed` bleibt Kennwert (jetzt 18,9 bzw. 30,5 m/s); schreibt weiter throttle/steer/brake,
der Fahrersitz eines Bots nutzt `'auto'`. Prüfen, dass `dev/vehicles.js` `autopilotLap` die Runde schafft.

### A.9 Schaden → Leistung (A, `vehicle.update` Block „Komponenten → Fahrleistung“)
`body.mods = { torque: 1, maxGear: 5, immobile: false, turnMult: 1, cutRpm: null }`:
Motor zerstört → `torque × 0,5`, `cutRpm 2000` („Notlauf“) · Ketten zerstört → bis `trackDownUntil` `immobile`, danach
`torque × 0,6`, `maxGear 2` · `disabled` (< 20 % HP) → `torque × 0,35` · tot → `immobile`. `speedMult` entfällt.

### A.10 Abnahme A (in der echten 3D-Sim, `tools/tank-drive-test.mjs`, Node, ohne Browser)
Test: wie `tools/net-proto-test.mjs` 'three' (und `three/addons/…`) auf `assets/vendor/three/…` abbilden; Welt-Stub
`{ heightAt, normalAt, surfaceAt }` (eben bzw. Hang entlang −Z); `VehicleBody` + `Drivetrain` direkt takten.
| Prüfung | Soll |
|---|---|
| KP-1 Spitze eben (Automatik) | 62–72 km/h |
| KP-1 rückwärts (R2) | 24–32 km/h |
| KP-1 0→30 km/h (Automatik) | 5,0–8,0 s |
| KP-1 31° Hang, 1. Gang, Erde (dirt) | erreicht ≥ 2,5 km/h bergauf |
| KP-1 31° Hang, 3. Gang | schafft ihn nicht (≤ 0,5 km/h oder rückwärts) |
| KP-1 10° Hang, 5. Gang aus dem Stand | ≤ 2 km/h (zu hoher Gang) |
| Gang halten: 3. Gang, keine Taste | hält 20–28 km/h auf der Ebene ±1 km/h über 10 s |
| Neutrallenkung (N + Lenken) | Gierrate 0,6–0,9 rad/s, Vorwärtsfahrt < 0,5 m/s |
| Schalten | Schaltpause 0,4–0,6 s ohne Zugkraft, Drehzahl springt plausibel (Hochschalten fällt) |
| GW-4 Spitze / 0→40 | 95–120 km/h / ≤ 4 s |
| Ausrollen KP-1 in N von 30 km/h | steht nach 3–12 s (kein 2-s-Stopp mehr) |
| Bremse KP-1 von 40 km/h | steht nach ≤ 4 s |
| Schlaf | unbesetzt in N schläft nach ≤ 2 s; im Gang mit Regler nicht |
Zusätzlich im Browser (dev/vehicles.html, kurz): Statuszeile zeigt Gang/Drehzahl, Autopilot-Runde fertig.

---------------------------------------------------------------------------------------------------------------------------
## B. Besatzung, Sichten, manuelles Nachladen (Umsetzer B)

### B.1 Sitze KP-1 (`data.js` `seats`, Reihenfolge verbindlich)
| Idx | id | label | Waffen | mount | Sichten (Reihenfolge) |
|---|---|---|---|---|---|
| 0 | `driver` | Fahrer | – (`drive: true`) | – | `spiegel`, `luke`, `aussen` |
| 1 | `gunner` | Richtschütze | `mbt_ap`, `mbt_he`, `mbt_coax` | `gun` | `optik`, `weit`, `aussen` |
| 2 | `commander` | Kommandant | `mbt_cmg` | `cmg` | `periskop`, `luke`, `aussen` |
| 3 | `loader` | Ladeschütze | – (`loader: true`) | – | `innen`, `luke`, `aussen` |
Erster freier Sitz beim Einsteigen = Fahrer (wie bisher). GW-4: Sitze bleiben; Sichten aus den bisherigen `fp`/`tp`:
Fahrer/Beifahrer/Rücksitz `sitz` (space hull, pos = fp.pos, look rel, yaw ±2.1, pitch −0.7…0.75, zoom [1], exposed)
+ `aussen`; Schütze `mg` (space mg, pos = fp.pos, look mount, zoom [1, 2], overlay null, exposed) + `aussen`.

Sichtdaten KP-1 (Raum: `hull` = Wannenraum; `turret` = Turmraum um `turretPivot`; `gun` = Position im Turmraum,
Ausrichtung Turm + Rohrerhöhung (= heutiges fp.space 'turret'); `cupola` = relativ zu `cmgPivot`, gedreht mit
turretYaw + cmgYaw (= heutiges fp.space 'cmg'); `mg` = heutiges fp.space 'mg'):
| Sitz/Sicht | space | pos | look / Grenzen | zoom | overlay | exposed | pin (Füße) |
|---|---|---|---|---|---|---|---|
| Fahrer `spiegel` | hull | [-0.55, 1.72, -2.62] | rel, yaw ±0.55, pitch −0.2…0.25 | [1.25] | slit | nein | – |
| Fahrer `luke` | hull | [-0.55, 2.2, -2.3] | rel, yaw ±2.6, pitch −0.6…0.8 | [1, 1.8] | – | ja (hatch driver) | hull [-0.55, 0.95, -2.35] |
| Richtschütze `optik` | gun | [0.48, 0.66, -1.3] (wie bisher) | mount | [3, 8, 12] | optic | nein | – |
| Richtschütze `weit` | gun | [0.48, 0.66, -1.3] | mount | [1.2, 2.5] | wide | nein | – |
| Kommandant `periskop` | cupola | [0, 0.32, 0.55] (wie bisher) | mount | [1.5, 4, 8] | peri | nein | – |
| Kommandant `luke` | turret | [-0.62, 1.45, 0.75] | mount | [1, 4, 7] | binocular ab 1,5× | ja (hatch commander) | turret [-0.62, 0.27, 0.62] |
| Ladeschütze `innen` | turret | [0.55, 0.62, 0.35] | relTurret, yaw ±π, pitch −0.9…0.5 | [1] | loader | nein (`interior: true`) | – |
| Ladeschütze `luke` | turret | [0.6, 1.35, 0.55] | relTurret, yaw ±π, pitch −0.6…0.8 | [1, 2] | – | ja (hatch loader) | turret [0.6, 0.08, 0.55] |
| alle `aussen` | – | tp {dist 11, height 4.7, pivot 2.6} (Kommandant 10/4.8/2.8) | wie Sitz | [1, Optik bei ads] | TP-Kreuz | wie letzte 1P-Sicht | wie letzte 1P-Sicht |

`hatches`/`interior` in data.js (B schreibt sofort, D liest mit Rückfall auf diese Werte):
```js
hatches: {
  driver:    { space: 'hull',   pos: [-0.55, 1.65, -2.35], r: 0.34 },
  commander: { space: 'turret', pos: [-0.62, 1.03, 0.62],  r: 0.38 },
  loader:    { space: 'turret', pos: [0.6, 0.83, 0.55],    r: 0.3 },
},
interior: { breech: [0, 0.42, -0.55] /* Turmraum, gunPitch 0 */, rack: [0, 0.45, 1.55], loaderEye: [0.55, 0.62, 0.35] },
crew: { switchTime: 1.2, faceTol: 0.6 /* rad */ },
ammo: { mbt_ap: 22, mbt_he: 18 },
```

### B.2 Sitzwechsel
`switchSeat(actor, idx)`: Ziel frei → sofort umbuchen (alter Sitz frei, neuer belegt), `seat.readyAt = now + 1,2 s`.
Bis dahin ist der Sitz **inaktiv** (Absicht wirkungslos, keine Waffe, Fahrersitz = N + Bremse), Kamera: kurze
Abblende (0,25 s aus/ein) + Text „Wechsel zu: Richtschütze …“. Gilt auch für Bots. Tasten: 1–4 (`slot1`, `slot2`,
`streak1`, `streak2` → Sitz 0–3, nur Tastatur), Pad ◀/▶ (`seat_prev`/`seat_next`; auf dem Pad SEAT_ACTIONS ignorieren),
Touch `v_seat` (nächster freier), VR `seat_next`. Sperre zwischen Wechseln 0,4 s bleibt.

### B.3 Sichten
- Umschalten: `crouch` (C / Pad B / Touch „Sicht“ = `v_camera`, Beschriftung ändern) → nächste erlaubte Sicht des Sitzes
  (`sys.allowedViews`). `aussen` nur bei `sys.rules.thirdPerson` (offline immer; online Raumeinstellung).
- Gemerkt je Fahrzeugtyp+Sitz in `sys.viewPref` (Sitzung). Startsicht: gemerkte, sonst bei `sys.camMode === 'tp'` →
  `aussen` (falls erlaubt), sonst erste Sicht. Verträglichkeit mit `dev/vehicles.js` (gehört A): `sys.camMode` ('tp'|'fp')
  bleibt, und eine Zuweisung `sys.camera.mode = 'fp'|'tp'` (Setter in VehicleCamera) schaltet den aktuellen Sitz auf
  die erste 1P-Sicht bzw. `aussen`.
- Zoom: `zoom[0]` Grundvergrößerung der Sicht; `ads` (Halten/Umschalten gilt) → `zoom[1]`; `ads` + `swap` → `zoom[2]`
  (wie heute `_zoomHi`). In `aussen` mit Lafette: `ads` → vorübergehend erste Optik-Sicht des Sitzes (wie heute).
- Zielen: Optik-/1P-Sichten → `aimDir` = Blick (roh, Spieler nutzt Strichplatte); `aussen` → Bildmitte-Strahl → `aimAt`
  mit Ballistik (wie heute). `_aimSeat` schreibt die gewünschte Richtung in `seat.aimWant`.
- **Overlays** (DOM in hud.js/views.js, wie `vh-scope`): `slit` (dunkel, drei Spiegelfenster), `optic` (runder Ausschnitt +
  Strichplatte mit **Entfernungsmarken** für die geladene bzw. gewählte Munition: Marken 200/400/600/800/1000 m, Lage
  durch `projectToScreen` eines Punktes in Richtung „Blick um lobAngle(v, g, d, 0) angehoben“ → stimmt für jeden Zoom/
  Bildschirm/Objektiv; Beschriftung „2 4 6 8 10“, Munitionskürzel), `wide` (einfaches Kreuz), `peri` (rechteckige
  Vignette + Richtungsring: Turm- und Wannenrichtung relativ zum Blick), `binocular` (zwei Kreise), `loader` (Schrittanzeige
  §B.5). KANN: Laser-Entfernungsmesser im Richtschützensitz (`light`) → „E 437 m“ 4 s in der Optik.
- **VR** (`G.xr?.presenting`): Sicht fest `luke` (Fahrer/Kommandant/Ladeschütze), Richtschütze: Kopf über der Optik
  (Ersatz-Pin, Turm folgt dem Blick); Lafettensitze: `seat.look.yaw/pitch` aus `player.yaw/pitch` (setzt xr.preUpdate vor
  `updateOccupant`); kein 3P/Optik/Zoom; der Pin des Spielers wird so gesetzt, dass `poseCamera` den Kopf an die
  Sichtposition bringt. Keine Änderung in `engine/xr/*`.
- **Handy**: alle Sichten nutzbar; Overlays skalieren (CSS wie `.vh-ret` bei kleinen Bildschirmen); Touch-Knopf „Sicht“.

### B.4 Luke, Schutz, Insassen-Darstellung
- `setSeatView` setzt `seat.hatchOpen = view.exposed` (bzw. bei `aussen` den Zustand der letzten 1P-Sicht).
  Schutz wie heute `exposed`, aber **je Sicht**: offen → Hitboxen + verwundbar, Körperhöhe SEAT_H; zu → unverwundbar,
  `NULL_HITBOX`. Wirksam, sobald `hatchT ≥ 0,5` (Öffnen/Schließen 0,6 s, `model.setHatch(id, hatchT)` in `sync`).
- `_pinOccupants`: Pin = `view.pin` bei offener Luke (im Raum `space`, Turmraum dreht mit `turretYaw`), sonst `def.pos`;
  Puppen/Bots bei offener Luke geduckt (`crouching = true`), bei geschlossener Luke Soldatenmodell ausblenden (falls API
  vorhanden, sonst so lassen) und **nach** dem Pin `a.soldier?.place?.(pos, yaw)` aufrufen (kein Bild Verzug).
  Gilt auf Host, offline und im Abbild (dort kommt `hatchOpen` aus dem Netz).

### B.5 Hauptkanone und manuelles Nachladen (`crew.js` + `vehicle.js`, Host-autoritativ)
Regel (`sys.rules.reload`): online Raumeinstellung `vehReload` ('manuell' Standard | 'automatisch'), offline Einstellung
`vehReload` (A legt sie in settings.js an: Gruppe `'spiel'`, Label „Panzer nachladen“, enum `['manuell','automatisch']`,
Standard `'manuell'`). **Bots laden immer automatisch.**

Schuss: nur wenn `gun.step === 'geladen'` → feuert die geladene Munition (`gun.loaded`, egal welche PG/SG gewählt ist);
danach `loaded = null`, `breechOpen = true`, `step = 'leer'` (Halbautomatik öffnet den Keil, Hülsenstumpf fällt).
Waffenwahl PG/SG des Richtschützen = Munitionswunsch (HUD des Ladeschützen „Gefordert: SG“).

Zustandsautomat **manuell** (Ladeschütze, Sitz 3, Sicht `innen`; Blickprüfung nur über den Gierwinkel im Turmraum:
`abs(wrap(look.relYaw − Gier zum Punkt)) ≤ crew.faceTol` (0,6 rad) gegen `interior.rack` bzw. `interior.breech`, vom
Auge `interior.loaderEye` aus):

| Schritt | Bedingung | Taste PC / Pad / Touch / VR | Dauer | Ergebnis |
|---|---|---|---|---|
| 0 Munition wählen | nichts in der Hand | `swap` (Mausrad/Y) / Touch „PG/SG“ (`v_ammo`) | – | `select` wechselt (nur mit Bestand) |
| 1 Umdrehen zum Gestell | `step 'leer'` | Blick (Maus/Stick/Wischen/Kopf) | – | Hinweis-Pfeil |
| 2 Granate greifen | Blick aufs Gestell, `rack[select] > 0` | `reload` (R / X tippen / „Laden“ `v_load` / VR X) | 1,0 s | `held = select`, `rack−1`, `step 'gegriffen'` |
| 3 Umdrehen zum Verschluss | `held` | Blick | – | Hinweis-Pfeil |
| 4 Einschieben | Blick auf Verschluss | `fire` (LMT / RT / „Laden“ / VR Abzug) | 0,8 s | `loaded = held`, `held = null`, `step 'eingeschoben'` |
| 5 Verschluss schließen | `step 'eingeschoben'` | `reload` (R / X / „Laden“ / VR X) | 0,4 s | `breechOpen = false`, `step 'geladen'`, Meldung „Geladen – PG“ (HUD aller Insassen), Klick |
Touch „Laden“ (`v_load`) führt jeweils den nächsten fälligen Schritt aus. Falsche Reihenfolge/Blick → `{ok:false, why}`,
HUD zeigt kurz den Grund. Während `busy` keine weiteren Schritte. SOLL: Störung – erhält das Fahrzeug Schaden ≥ 60 oder
Wannenbeschleunigung > 9 m/s² während `gegriffen`/`busy`: Granate fällt (zurück ins Gestell, `step 'leer'`, „Granate
fallen gelassen“). Alleinfahrer müssen in Sitz 3 wechseln (Wechselzeit 1,2 s), das ist gewollt.

**Automatik** gilt, wenn `rules.reload === 'automatisch'` **oder** kein Mensch (`isPlayer`/`isRemoteHuman`) an Bord ist
**oder** ein Bot im Ladeschützensitz sitzt: nach dem Schuss `autoT` = 5,0 s, wenn Sitz 3 besetzt ist, sonst 8,0 s;
danach `loaded` = Wunsch des Richtschützen (sonst andere Sorte, sonst leer „Munition leer“). Sonst gilt „manuell“.

**Gestell**: Kapazität `ammo` (PG 22, SG 18). Auffüllen: Fahrzeug < 1 m/s und ≤ 25 m von einem Stellplatz des eigenen Teams
(`sys.spawns` mit `team === vehicle.team`) → +1 Granate je 2 s (abwechselnd bis voll), HUD „Munition wird aufgefüllt“.
MGs: Magazin + Nachladen wie bisher (R), unendlicher Vorrat.

Host-Prüfung bei Netz-Schritten: gleiche Funktion `loadAction` mit den Mindestzeiten (busy), Blickprüfung gegen den
gemeldeten `seat.look.relYaw` (Netz) – Toleranz +0,2 rad. Clients können nichts behaupten.

### B.6 Eingaben (B, controls.js) – Konflikte
- Pad/VR: **Aussteigen = `interact` 0,5 s halten** (HUD-Ring „Aussteigen…“); `reload` wirkt bei Pad/VR erst beim Loslassen,
  wenn kürzer als 0,35 s gehalten (kein Doppelauslösen). Tastatur: F tippen wie bisher.
- Entfernte Menschen (Puppen mit `isRemoteHuman`) auf dem Host wie `isPlayer` behandeln: `fireWhenAligned = false`,
  Kanone nur auf `firePressed` (sonst feuert gehaltenes Feuer jede geladene Granate sofort).
- Sitzaktionen, Sichten, Zoom siehe B.2/B.3. Licht nur Fahrer.

### B.7 HUD (B, hud.js)
Waffenliste (Kanone: „geladen PG“ / „leer – Ladeschütze lädt“ / „leer – kein Ladeschütze (Sitz 4)“ / Automatik mit
Balken), Gestellbestand „PG 21 · SG 18“, Sitzliste mit Wechselstatus, Ladeschützen-Schrittanzeige (Schrittnummer, Taste
über `keyFor`, Richtungspfeil links/rechts, Fortschritt), Overlays B.3, Hinweise je Sitz/Sicht, `data-vehicle-arms` für
den Ladeschützen = '1' (Feuer-Knopf wird für „Einschieben“ gebraucht), Touch-Knöpfe `vc-load` („Laden“, `v_load`, nur
Ladeschütze), `vc-ammo` („PG/SG“, `v_ammo`), `vc-cam` beschriftet „Sicht“.

### B.8 Bots, Einzelbesatzung, Modi
- Bot-Regel: Sitzt ein **Bot** im Fahrersitz und ist der Richtschützensitz leer, bedient er ihn stellvertretend:
  `v.aimAt(bot, …)`/`intentFor` leiten Schützenfelder auf den Richtschützensitz um (`seat.proxy = bot`); `_aimSeat`/
  `_updateWeapons` laufen für Sitze mit `actor || proxy`; Schütze = `actor || proxy`; Nachladen automatisch. Menschen
  haben diese Regel **nicht**. Produktion nutzt es nicht (keine Bot-KI fährt), `dev/vehicles.js` autopilotLap/Tests schon.
- `bots/bot.js:~1220` `v.body.velocity` → `v.body.vel`. Panzerabwehr-Logik sonst unverändert.
- `modes/conquest.js` Einsatzpunkt „Fahrzeug“: `enter(actor, v)` → Fahrersitz; prüfen, dass Spawn+Einsteigen weiter geht.
- `sys.nearest(..., seatRole 'gunner')` sucht Sitz mit Waffen ohne `drive` → Richtschütze (passt).

### B.9 Waffenwerte (data.js, B)
`mbt_ap`: „120 mm Wuchtgeschoss (PG)“, speed **1650** m/s, life 1.6 · `mbt_he`: „120 mm Mehrzweckgranate (SG)“, speed
**1140** m/s, life 2.0 · `reload` 5.0 (Automatik mit Ladeschütze), neu `reloadNoLoader` 8.0 · `gunLimits` −9°…+20°,
`traverse` 40°/s, `elevate` 24°/s. Schaden/Splash unverändert. MGs unverändert.

### B.10 Abnahme B (`tools/tank-crew-test.mjs`, dev/vehicles.html, Browser)
Sitzwechsel dauert 1,2 s ±0,1 (Sitz inaktiv) · Fahrer hat keine Waffe, Richtschütze feuert, Fahrer kann nicht feuern ·
alle Sichten je Sitz schaltbar, `aussen` gesperrt bei `rules.thirdPerson = false` · Luke offen → Hitboxen aktiv, zu →
`NULL_HITBOX` · manuelles Nachladen: falsche Reihenfolge abgelehnt, richtige Folge lädt in ≥ 2,2 s Handlungszeit, Schuss
nur geladen · Automatik 5,0 s / 8,0 s · Gestell zählt runter, Auffüllen am Stellplatz · Bot-Einzelbesatzung zielt+feuert
(autopilotLap) · Bilder je Sicht (PC 1280×720 + Handy 844×390) nach `tools/out/panzer/` · VR-Rückfall per Stub geprüft
(`G.xr = { presenting: true }` → Sicht `luke`, Turm folgt `player.yaw`).

---------------------------------------------------------------------------------------------------------------------------
## C. Netz (Umsetzer C)

### C.1 Aktivierung und Raumeinstellungen
`net/index.js`: `export const VEHICLES_ONLINE_DEFAULT = true|false` (Start: `true`; Orchestrator schaltet ggf. um),
`DEFAULT_ROOM` + `normalizeSettings` + `_buildBaseCfg` (`cfg.net.vehicles`, `cfg.net.thirdPerson`, `cfg.net.vehReload`):
| Feld | Typ / Standard | UI (`ui/net-menus.js`) |
|---|---|---|
| `vehicles` | bool / `VEHICLES_ONLINE_DEFAULT` (fehlt der Wert → Standard) | Schalter „Fahrzeuge“ – „Panzer und Geländewagen für beide Teams“ |
| `thirdPerson` | bool / `true` | Schalter „Außenansicht (Fahrzeuge)“ – „3P-Kamera in Fahrzeugen erlaubt“ |
| `vehReload` | `'manuell'` \| `'automatisch'` / `'manuell'` | Segment „Panzer nachladen: Manuell / Automatisch“ |
Lesesicht ergänzen, Standard-an-Liste beim Umschalten (`botFill`, `stamina` + `thirdPerson`, `vehicles` falls Standard
an) anpassen. `main.js`: `G.match.vehicles = netCfg ? !!netCfg.vehicles : undefined` **vor** `spawnBots`; Anschluss:
offline unverändert; online nur bei `netCfg.vehicles`: Host `attach(G)`, Client `attach(G, { replica: true })`.
`bots/manager.js _vehiclesExpected`: online `G.match.vehicles === false` → keine Werfer-Pflicht.
`?vehicles`-Parameter wirkt online nur beim Host (Tests), nie beim Client.

### C.2 Rollen
- **Host** = heutige Sim (A/B-Code) + `vehicles/net.js` (Host-Teil): Netz-Ids, Liste, Schnappschuss-Anhang, Eingang der
  Client-Absichten und Anfragen, Ereignisse. `VehicleSystem.live = state==='playing' || G.match.netLive`.
- **Client** = Abbild: `sys.replica = true`, `sys.remote = <Vermittler>`; `attach` ohne `_setupSpawns` (Modelle für mbt/jeep
  und beide Teams vorbereiten + Materialien/Shader vorwärmen wie heute); `Vehicle.update` → `net.tickReplica(v, dt)`
  (keine Physik, Waffen, Schäden, Brand, Reparatur, Wrack-Zufall nur optisch); `update()` des Systems: keine Spawns, kein
  `removeVehicle` aus Wrackzeit (Entfernen nur per Liste), `_collideVehicles` aus, `_collideActors` nur lokaler Spieler
  ohne Überfahren/Schaden, `shells.update` nur Darstellung, `_onImpact` → SOLL `vhit`-Meldung statt Schaden,
  `_onExplosion` aus, `_onKill` nur Sitz-Buchhaltung, `fire()` wird nie aufgerufen. Sync, Pins, Kamera, HUD, Klang laufen.
- `VehicleSystem.fire`: `actor._shotSerial` **nicht** mehr erhöhen (sonst spielen Clients Infanterie-Schüsse der Puppe).

### C.3 Netz-Ids und Fahrzeugliste (zuverlässig)
Host vergibt `v.netId` (1…255, fortlaufend, belegte überspringen) bei `vehicle:spawn`. Liste:
`{ t: 'vehicles', list: [[vid, typeIdx, team(0 null|1 A|2 B), [netId|0 je Sitz]], …] }` – bei Änderung (Spawn, Entfernen,
Sitz) mit Schlüsselvergleich an alle, voll an Neue in `_admit`. Client: unbekannte vid → `spawnVehicle` im Abbild
(Modell nach Typ+Team, `netId`), fehlende → entfernen (`dispose`, Insassen per `clearSeat`), Sitze → `placeInSeat`/
`clearSeat` (eigener Spieler: `_playerEnter`/`_playerExit` laufen über B). typeIdx = Index in `VEHICLE_IDS`.

### C.4 Schnappschuss-Anhang (schnell, Host → Client)
Hinter Akteuren und VR-Blöcken: `u8 0x56 ('V')`, `u8 nv`, dann `nv × VEH_BLOCK (60 Byte)`, little-endian:
```
@0  u8  vid
@1  u8  kind   bits0–3 typeIdx, bits4–5 spawnTeam (0 –, 1 A, 2 B)
@2  u8  bits   0 alive, 1 wreck, 2 disabled/brennt, 3 lights, 4 sleeping, 5 Kette ab (immobil), 6 Motor zerstört, 7 Turm beschädigt
@3  u8  seats  bits0–3 Luke offen je Sitz 0–3, bits4–7 Sitzwechsel läuft je Sitz
@4  f32 x, f32 y, f32 z        body.pos (Schwerpunkt, Welt)
@16 i16 qx, qy, qz, qw         ×32767, qw ≥ 0 (sonst alle negieren), beim Lesen normieren
@24 i16 vx, vy, vz             cm/s
@30 i16 wy                     Gierrate rad/s ×1000
@32 i16 a0, a1, a2, a3         rad ×10000: KP-1 turretYaw, gunPitch, cmgYaw, cmgPitch · GW-4 mgYaw, mgPitch, 0, 0
@40 u16 health                 HP gerundet
@42 u8  engine, tracks, turret Zonen-HP ×255/max (3 Byte)
@45 i8  gear
@46 u8  rpmNorm ×200
@47 u8  drive  0 shifting, 1 Bremse, 2 lugging, 3 gearbox hold
@48 u8  shots[4]               MG-Schusszähler je Sitz (mod 256; Kanonenschüsse nur über 'ev' 'vs')
@52 u8  gun    bits0–1 loaded (0 –, 1 PG, 2 SG), bits2–3 held, bits4–6 step (0 leer,1 gegriffen,2 eingeschoben,3 geladen), bit7 breechOpen
@53 u8  busy   Fortschritt der laufenden Handlung 0…255
@54 u8  rackAP, @55 u8 rackHE
@56 u8  mag0 (Koax bzw. GW-4-MG), @57 u8 mag1 (Kommandanten-MG)
@58 u8  sel    bits0–1 Waffenindex Richtschütze, bits2–3 Waffenindex Kommandant, bit4 mag0 lädt, bit5 mag1 lädt, bit6 manuell
@59 u8  aux    bits0–1 select des Ladeschützen, bits2–7 autoT in 0,25-s-Schritten
```
`encodeSnapshot(tick, t, ents, vehicles = null)`; `decodeSnapshot` liefert zusätzlich `vehicles: []` (Anhang fehlt/
abgeschnitten → leer bzw. nur vollständige Blöcke). Ohne Fahrzeuge: Paket Byte für Byte wie heute.

**Rate / Interessenfilter je Empfänger** (gilt unabhängig von INTEREST_MIN; `?netinterest=0` → alles jeden Takt):
eigenes Fahrzeug und alle ≤ 160 m (xz) zur Puppe: 20 Hz · übrige wache/besetzte: 5 Hz (`(tick+vid) % 4 === 0`) ·
schlafend + unbesetzt + lebend + nicht brennend: 1 Hz (`% 20`) · Wracks 2 Hz (`% 10`) · neuer Client nach `_admit`:
1 s lang alle jeden Takt.

**Budget** (§9/§13 von mehrspieler.md; §11 dort ist das Nutzungsbudget): Block 60 B. Grenzland 10 Fahrzeuge, typisch
2 nahe aktiv (2×60×20 = 2,4 KB/s) + 2 ferne aktiv (0,6 KB/s) + 6 parkend (0,36 KB/s) ≈ **3,4 KB/s je Client** zusätzlich
(+29 % zu 11,7 KB/s); ungünstigster Fall 10 nah aktiv = 12 KB/s. Hafen (4 Fahrzeuge) ≈ 1,5–2,5 KB/s. Zuverlässig: Liste
~150 B je Änderung, 'vs' ~120 B je Kanonenschuss. Aufwärts je sitzendem Client +16 B × 30 Hz = 0,5 KB/s.
`recommend.js`: Fahrzeugterm (`VEH_BYTES 60`, Anteil 0,5, 20 Hz × Fahrzeugzahl der Karte) ergänzen.

### C.5 Client-Absicht (schnell, Client → Host, Anhang am 30-Hz-Zustand)
`FLAGS.VEHICLE = 1 << 12` im Zustand → nach 37 B (und ggf. VR-Block) folgt `VEH_INPUT = 16 Byte`:
```
@0 u8 vid  @1 u8 seat  @2 i8 throttle ×127  @3 i8 steer ×127
@4 u8 bits   0 fire gehalten, 1 Bremse, 2 Handbremse, 3 Licht an (Fahrer), 4 gearbox hold
@5 u8 shift  bits0–3 Zähler hoch, bits4–7 Zähler runter (mod 16)
@6 u8 fireSeq (firePressed-Zähler)   @7 u8 act bits0–3 MG-Nachladen-Zähler, bits4–7 Waffenwechsel-Zähler
@8 u8 weapon (255 = keine Wahl)       @9 u8 view
@10 i16 aimYaw  @12 i16 aimPitch      gewünschte Lafettenrichtung (seat.aimWant, Welt, rad ×10000)
@14 i16 lookYaw                       seat.look.relYaw (Ladeschütze/Fahrer), rad ×10000
```
Client (net.js, postUpdate vor dem Senden): liest Sitz-Absicht des Spielers, wandelt Flanken in Zähler (und setzt
`shiftUp/shiftDown/firePressed/cycleWeapon/reload` lokal zurück), `aimWant` aus lokalem `_aimSeat`.
Host (`_onFast`): Puppe sitzt in `vid`/`seat` → Absicht schreiben (Zählerdifferenzen ≤ 7 → `shiftUp/Down`,
`firePressed`, `reload`, `cycleWeapon`), `aimDir` = Richtung, `aimAt = null`, `seat.look.relYaw = lookYaw`,
`sys.setSeatView(puppet, view)` bei Änderung, Fahrersitz: `gearbox`, `v.lights`. Werte begrenzen. Sitzt die Puppe nicht
dort: Anhang ignorieren. Feuerrate/Munition/Laden entscheidet die Host-Sim.

### C.6 Zuverlässige Nachrichten
| Typ | Richtung | Felder | Host-Prüfung / Wirkung |
|---|---|---|---|
| `veh` | C→H | `a:'enter', v, s` | Puppe lebt, sitzt nicht, Fahrzeug lebt, `_boxDistance(v, pos, 0,9) ≤ 1,7 + 1,0` (Verzug), Teamregel (`enter`), Sitz frei sonst erster freier, `live`; Abstand je Client 0,3 s → `sys.enter` |
| `veh` | C→H | `a:'exit'` | sitzt → `sys.exit`; blockiert → `vn` |
| `veh` | C→H | `a:'seat', s` | sitzt, Ziel frei → `sys.switchSeat` (Wechselzeit) |
| `veh` | C→H | `a:'load', k, am` | sitzt im Ladeschützensitz → `v.loadAction(seat, k, am)`; Ablehnung → `vn` |
| `vhit` (SOLL) | C→H | `v, w, z, d, sr, o, p` | Infanteriewaffe in der Ausrüstung, Ursprung ≤ 3,5 m vom Auge, Punkt ≤ Wanne+2 m (mit Verzug), Reichweite, Feuerrate über Schussnummer → Schaden wie `_onImpact` |
| `vehicles` | H→C | §C.3 | – |
| `ev` `vs` | H→alle | `v, s, w, o:[3], d:[3], sh` | Kanonenschuss: Darstellungsgranate (`shells.fire(…, {display:true})`), Mündungsfeuer/Rauch/Klang/Rückstoß, Wackeln im eigenen Fahrzeug |
| `ev` `vh` | H→Schütze | `v, d, z` | Treffermarker (`hud.hit()`) |
| `ev` `vn` | H→Anfragender | `why` ('besetzt','weit','feind','blockiert','tot','sperre','schritt','blick') | Meldung im HUD |
| `ev` `vo` | H→Aussteiger | `v, pos:[3], vel:[3]` | vor der Listenänderung senden; Client teleportiert sich |
Neue Typen in `RESERVED` (`veh`, `vhit`, `vehicles`) und `HOST_ONLY` (`vehicles`); dabei `actors` in beide aufnehmen
(Sicherheitslücke F8); Clients prüfen bei Host-Nachrichten `from === HOST_ID`.

### C.7 Interpolation und Darstellung (Client)
- Puffer je vid (≤ 40 Proben), gleiche Abspieluhr `rt` wie Puppen (inkl. `list.gap`-Zuschlag für seltene Fahrzeuge).
  Lage: lerp Position, slerp Quaternion (Vorzeichen angleichen), lerp vel/wy, Winkel über wrap; diskrete Felder aus der
  Probe ≤ rt. Fortschreiben ≤ 0,25 s mit vel/wy; Sprung > 5 m → direkt setzen. Schreibt `body.pos/quat`,
  `renderPos/renderQuat`, `vel`, `angVel.y`, `speed`, `trackSpeed` (vF ∓ wy·wheels.x), `drive.*`, `mount`, `health`,
  Zonen, `alive/wreck/disabled/lights`, `seat.hatchOpen`, `seat.readyAt` (aus Bits), `gun.*`, Magazine, Schusszähler.
- Eigener Sitz: Lafettenwinkel des eigenen Sitzes **nicht** aus dem Schnappschuss, sondern lokal per `_aimSeat`
  (sofortiges Folgen), weich zum Host-Wert, wenn Abweichung > 0,15 rad. KANN: eigenes Fahrzeug +min(0,1 s, Puffer)
  vorausberechnen (Dead Reckoning) für weniger Verzug beim Fahren.
- Zustandswechsel alive→tot: `model.setWreck(true)`, Turm-Versatz (Zufall nur optisch), Rauch wie Host. Explosion kommt
  als 'ex'. Wrack verschwindet, wenn die Liste es entfernt.
- MG: Zuwachs des MG-Schusszählers → Mündungsfeuer + Klang an `muzzle(seat, …, render)`, Leuchtspur jede `tracerEvery` zu einem
  lokalen Strahlpunkt (nur Darstellung). Kanone: nur über 'vs'.
- Insassen: Liste → Sitze; Pin/Pose macht B (`_pinOccupants` läuft auch im Abbild).

### C.8 Schaden, Abschüsse, Wrack, Wiedererscheinen
Alles auf dem Host (heutige Logik). Killfeed-Ursachen kommen per 'kill' mit `weapon` ∈ {mbt_ap, mbt_he, mbt_coax, mbt_cmg,
jeep_mg, roadkill, vehicle_explosion, vehicle_crash} – Clients beschriften über `G.vehicles.weaponName/weaponIcon`
(prüfen, dass `_onKill`/Killfeed diese Ids nicht verwirft). Punkte/Medaillen wie heute über 'ev' sc/md. Überfahren: Host
erkennt Puppen (netPose) wie heute. Wiedererscheinen: Host; neue vid in der Liste.

### C.9 Späteinstieg, Verlassen, Pause
`_admit`: volle Liste + 1 s alle Blöcke. `_drop` → `removeBot` → Sitz frei → Liste. Host-Pause (`netLive`): Fahrzeuge
fahren weiter. Matchende/Teardown: Abbild `detach` wie offline.

### C.10 Anti-Cheat
`_onFast`: sitzt die Puppe (`p.vehicle`) → `checkState` überspringen (Host pinnt). Beim Aussteigen
`anticheat.onTeleport(id, pos, now)` (Schonfrist wie 'correct'). SOLL: auf/neben fahrenden Fahrzeugen (Deck, ≤ 4 m)
Zusatztempo = Fahrzeugtempo in `ctx`. Sitzansprüche, Feuerrate, Munition, Ladezustand: nur Host-Sim.

### C.11 Protokoll
`NET_VERSION = 2`. `PKT_SNAPSHOT`/`PKT_STATE` bleiben; neue Konstanten `VEH_TAG 0x56`, `VEH_BLOCK 60`, `VEH_INPUT 16`,
`FLAGS.VEHICLE`. `dev/fake-client.html` muss weiter dekodieren (Anhang wird überlesen).

### C.12 Abnahme C
- `tools/net-proto-test.mjs`: Größen (11 + n·31 + nvr·11 + 2 + nv·60; Zustand 37 [+11] [+16]), Rundlauf aller Felder
  (Position exakt f32, Quaternion ≤ 2e-4, Winkel ≤ 1e-4, vel 1 cm/s), abgeschnittene Pakete, Pakete ohne Anhang.
- `tools/net-room-test.mjs`: Standardwerte/Normalisierung `vehicles`, `thirdPerson`, `vehReload`, `cfg.net.*`.
- **`tools/mp-vehicle-test.mjs`** (Host + 2 Clients „Anna“, „Bert“, Hafen, `vehicles: true`, Anna und Bert im selben Team –
  z. B. `pvp: 'coop'` –, `quality=low`, 640×360, Relay ws://127.0.0.1:7777, loadavg-Wartung):
  1. Host: 4 Fahrzeuge, je Team 1 Panzer (spawnTeam A und B, Teamfarbe), Clients sehen dieselben vid/Typ/Team ≤ 3 s.
  2. Anna steigt ein (`requestEnter`) → Fahrersitz bei allen; Bert → Richtschütze (Sitz 1).
  3. Anna fährt (simulate: Gang hoch, Vollgas) ≥ 20 m; nach dem Bremsen Lage bei Host/Anna/Bert ≤ 0,5 m gleich.
  4. Bert schießt auf den feindlichen Panzer → Treffer beim Host, `vh` bei Bert, HP bei allen gleich ≤ 1 s.
  5. Bert wechselt in Sitz 3 (≥ 1,1 s inaktiv), falsche Ladefolge → `vn`, richtige Folge → geladen (Host), Rückwechsel,
     zweiter Schuss.
  6. Zerstörung (Host setzt HP niedrig, Schuss) → Wrack bei allen, Killfeed-Ursache mbt_ap; Entfernen + Wiedererscheinen
     (Host verkürzt Zeiten) → neue vid bei allen, Team B.
  7. Anti-Cheat: Sitzanspruch auf besetzten Sitz → abgelehnt; Einsteigen aus 50 m → `vn weit`; Fahrt ohne Verstöße/
     'correct' für Anna; Aussteigen → Position = `vo` ±0,5 m, keine Verstöße.
  8. `thirdPerson: false` → Clients bieten keine Außenansicht an. Bert verlässt das Spiel im Panzer → Sitz frei ≤ 5 s.
- Regression: `tools/mp-test.mjs` (66 Prüfungen) mit Fahrzeugen an **und** aus, `tools/order-test.mjs` Online-Teil.
- `docs/planung/mehrspieler.md`: neuer Abschnitt „14. Fahrzeuge online“ (Kurzfassung von §C + Messwerte); §1 Satz
  „Fahrzeuge online aus“ anpassen.

---------------------------------------------------------------------------------------------------------------------------
## D. Modell (Umsetzer D)

### D.1 Detailplan KP-1 (aufbauend auf dem Bestehenden, `models.js`)
Wanne: geteiltes Glacis (oberer/unterer Bugkeil mit Fasen), Seitenkästen über den Ketten, Heckplatte mit Lüftergittern,
Auspuffgitter seitlich hinten, Kotflügel/Schmutzfänger, Fahrer-Winkelspiegel (3), Abschleppösen, Scheinwerferschutzbügel.
Laufwerk: 7 statt 5 sichtbare Laufrollen je Seite **nur optisch** (Federstrahlen bleiben 5!), Laufrollen mit Gummi-
bandage + Nabe, Stützrollen, Triebrad hinten mit Zahnkränzen, Leitrad vorn mit Speichen, Kette: Kettenglieder als
Profil (Endverbinder/Führungszähne entlang der Mittellinie, bewegt über den vorhandenen Texturlauf bzw. statisch),
Seitenschürzen in Segmenten mit Gummiunterkante. Turm: Pfeil-/Keilzusatzpanzerung vorn, Mantelblende, Wangenmodule,
Staukörbe hinten mit Gepäck, Rauchwurfbecher (2×4), Richtschützen-Optikkopf mit Klappen, Kommandanten-Rundblickperiskop
(PERI-ähnlich, dreht nicht), Kommandantenkuppel mit Winkelspiegelkranz, Ladeschützenluke mit MG-Lafette, Windsensor,
2 Antennen, Ersatzkettenglieder am Turmheck, Werkzeug/Seile. Rohr: Wärmeschutzhülle in Segmenten, Rauchabsauger,
Mündungsreferenz. Material (materials.js): Kantenabnutzung (helle Kanten über Krümmung/aVeh), Schmutz unten stärker,
Gummi, Optikglas; Wrack-Material wie bisher. GW-4: Überrollbügel, Reserverad, Kanister, Planenreste, Seilwinde schon da –
nur ergänzen, wo im Budget.

### D.2 Benannte Teile und API (verbindlich für B)
- Luken als eigene Objekte **außerhalb** der LOD-Stufen (einfach, ≤ 150 Dreiecke je Luke inkl. Winkelspiegel):
  `hatch:driver` (Kind der Wanne/root, Scharnier an der Lukenkante), `hatch:commander`, `hatch:loader` (Kinder von
  `turret`). Lage aus `VEHICLES.mbt.hatches` (Rückfall auf die Werte in §B.1). `model.hatches = { driver, commander, loader }`,
  `model.setHatch(id, t)` dreht um die Scharnierachse (offen ≈ 100–110°), keine Kollision.
- Innenraum `model.interior` (Kind von `turret`, `visible = false`, `castShadow false`): geschlossene Turmraum-Hülle
  (Innenseite, dunkles Material, verdeckt die Außenwelt aus der Ladeschützenkamera), Munitionsgestell im Heck an
  `interior.rack` mit einzeln sichtbaren Granaten (Spitzen farbig: PG schwarz/gold, SG oliv/gelb), Verschluss mit
  Keil `breech` als Kind von `gun` (folgt gunPitch; nur sichtbar mit Innenraum), Bodenplatte, Lampe (emissiv, kein Licht),
  Haltegriffe. `model.setInterior(on)`, `model.setBreech(t)`, `model.setRack({mbt_ap, mbt_he})`,
  `model.setHeld(type|null)` (Granate an fester Stelle vor `interior.loaderEye`, leicht nach unten).
- Bestehende Namen bleiben: `turret`, `gun`, `cmg`, `mg`, `wheel*`, `spin`; `trackMats`, `scrollTracks`, `setLights`,
  `setWreck` (Wrack: Luken zu, Innenraum aus).
- Bis die Teile stehen: API als No-ops vorhanden (B ruft immer mit `?.`).

### D.3 Budget
| | LOD0 | LOD1 | LOD2 | Luken+Innenraum |
|---|---|---|---|---|
| KP-1 low | **unverändert 4936** | 2784 | 864 | Luken ≤ 300, Innenraum ≤ 600 (einfach) |
| KP-1 medium | ≤ 11000 | ≤ 4000 | ≤ 1000 | ≤ 450 / ≤ 1500 |
| KP-1 high/ultra | ≤ 18000 | ≤ 5000 | ≤ 1000 | ≤ 450 / ≤ 3000 |
| GW-4 low | unverändert 3088 | 2020 | 1248 | – |
| GW-4 high/ultra | ≤ 10000 | ≤ 2500 | ≤ 1300 | – |
low: die LOD-Geometrie bleibt exakt gleich; die beweglichen Luken liegen als eigene Objekte 1–2 cm über den vorhandenen
Lukendeckeln (kein Z-Fighting); ab medium dürfen die festen Deckel entfallen.
Draw Calls je Fahrzeug: höchstens +4 gegenüber heute (Verschmelzen je Material wie bisher; Luken je 1 Netz). Innenraum
zählt nur für den lokalen Insassen. Keine neuen Texturen > 1024² (low 512²). Kollision/Trefferquader unverändert.

### D.4 Abnahme D (`tools/tank-model-test.mjs`, dev/vehicles.html)
`__dev.vehicleTriangles` je Stufe innerhalb D.3 (low exakt gleich) · Teile vorhanden (`hatches`, `interior`, `setHatch`
dreht, `setRack` zählt) · keine Konsolenfehler · Shader vorgewärmt (keine neuen Materialien ohne Aufnahme in die
Vorwärmliste: D exportiert `vehicleWarmMaterials()` aus materials.js (alle vorzuwärmenden Materialien inkl. Innenraum),
C nutzt sie in `index.js attach`, falls vorhanden, sonst die bisherige Liste) · Bilder vorher/nachher
(außen 3/4 vorn, 3/4 hinten, Laufwerk nah, Turm oben, Innenraum aus Ladeschützen-Sicht, GW-4) nach
`tools/out/panzer/` für low und high.

---------------------------------------------------------------------------------------------------------------------------
## E. Beide Teams haben Panzer (C prüft, keine Kartenänderung)

- Grenzland: `world.vehicleSpawns` = je Team 2 KP-1 + 3 GW-4 an den HQ-Stellplätzen, in allen Modi; Reihum-Anmeldung
  (`_setupSpawns`) hält die Symmetrie auch bei CAP low (6 Fahrzeuge reihum: A-P1, B-P1, A-P2, B-P2, A-J1, B-J1 → je Team
  2 KP-1 + 1 GW-4). **Keine** neuen Einträge in `world/maps/*.js` (Bewuchs-Sperrflächen → Kollision ändert sich).
- Andere Karten mit Raumeinstellung „Fahrzeuge“ an: `autoSpawns()` (je Team 1 KP-1 + 1 GW-4 nahe der Team-Basis, Lage
  per `findSpot`, deterministisch, nur Host).
- Teamfarben: Modell nach `spawnTeam` (A blau, B rot) – im Abbild aus `kind` bits4–5.
- Prüfung (C, in mp-vehicle-test Schritt 1 + kurzer Offline-Check im Browser): Grenzland low/high und Hafen mit
  `?vehicles=1`: je Team ≥ 1 KP-1, Anzahl je Team gleich.

---------------------------------------------------------------------------------------------------------------------------
## F. Gesamt-Testplan und Freigabe

| Wer | Schnell (immer) | Eigen | Regression |
|---|---|---|---|
| A | `sh tools/check.sh`, `node tools/preload.mjs --check` | `node tools/tank-drive-test.mjs` | dev/vehicles.html Autopilot-Runde |
| B | dito | `tools/tank-crew-test.mjs` | Offline-Rauchtest Grenzland Eroberung mit Fahrzeugen (`tools/smoke.mjs`, quality=low), Bots/Eroberung ohne Fehler |
| C | dito, `node tools/net-proto-test.mjs`, `node tools/net-room-test.mjs`, `node tools/net-interp-test.mjs` | `tools/mp-vehicle-test.mjs` | `tools/mp-test.mjs` (Fahrzeuge an und aus), `tools/order-test.mjs` |
| D | dito | `tools/tank-model-test.mjs` | Bilder low/high |
| Orchestrator | alles oben + `tools/collision-hash.mjs` (unverändert), `tools/puppet-test.mjs` | | Entscheidung `VEHICLES_ONLINE_DEFAULT` |

Reihenfolge Freigabe: (1) A/B/D offline grün → (2) C Abbild/Online grün → (3) mp-test grün mit Fahrzeugen aus und an →
(4) Standard „Fahrzeuge an“. Ist (2)/(3) bis 17:00 UTC nicht sicher grün: `VEHICLES_ONLINE_DEFAULT = false`, Code bleibt.

---------------------------------------------------------------------------------------------------------------------------
## G. Bewusst nicht enthalten (später)
Echte Handbewegung zum Laden in VR (vorerst Tasten), Bot-KI, die Fahrzeuge fährt, Bug-MG-Schütze, Innenräume für Fahrer/
Richtschütze, Feuerleitrechner mit automatischer Erhöhung, Vorhersage der eigenen Kanonengranate (`cid`), Nachschubpunkte
an Flaggen (nur Stellplätze füllen auf), Eroberung online.
