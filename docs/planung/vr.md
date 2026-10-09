# VR-Modus (Beta) – Stufe A

Stand: 09.10.2026 · Zielgerät Meta Quest 3 · Technik WebXR („immersive-vr“) mit three.js r186 (`renderer.xr`).
Wünsche dazu: `WUENSCHE.md` → „VR-MODUS (Nutzer 07.10.)“, „VR-MODUS JETZT MIT DEM MEHRSPIELER-RELEASE“, „VR-ERGÄNZUNG“.

Für alle, die VR nicht einschalten, ändert sich nichts: jeder Haken ist an die Einstellung `vrEnabled` bzw. an eine
laufende XR-Sitzung gebunden.

## So startet man VR

### A) Direkt im Quest-Browser (überall, ohne PC)
1. In der Brille den **Meta-Quest-Browser** öffnen und die Spielseite aufrufen (HTTPS, z. B. GitHub Pages).
2. **Einstellungen → Steuerung → VR (Beta) → „VR-Modus (Beta)“ einschalten.** Danach die Seite einmal **neu laden**
   (erst dann ist die Kantenglättung für VR aktiv; ohne Neuladen läuft VR, flimmert aber stärker).
3. Lobby wie gewohnt (2D-Fenster, Controller als Zeiger), Match starten.
4. Im Match unten in der Mitte **„VR starten“** antippen (auch im Pausenmenü). Die Brille fragt evtl. nach der Erlaubnis.
5. Beim Start **kurz gerade hinstellen** (die Kopfhöhe wird nach 0,4 s gemessen und als „Stehen“ gespeichert).

Grafik auf der Quest: automatisch Stufe „Niedrig“, Auflösung 80 %, Foveated Rendering (Einstellungen „VR-Grafik“ und
„VR-Auflösung“). Ziel 72–90 Bilder/s.

### B) Über den PC mit Air Link oder Link-Kabel (volle Grafik)
1. Meta-Quest-Link-App am PC installieren, in der App unter *Allgemein* „OpenXR-Laufzeit: Meta Quest Link“ aktivieren.
2. Quest per **Air Link** (WLAN) oder **Link-Kabel** verbinden.
3. Am PC die Spielseite in **Chrome oder Edge** öffnen, VR-Modus wie oben einschalten, neu laden, Match starten.
4. **Esc → Pausenmenü → „VR starten“** (mit gesperrtem Mauszeiger ist der Knopf im Bild nicht klickbar).
   Der PC rendert; Grafik „wie am Bildschirm“ (Stufe bleibt), Auflösung 100 %, Nachbearbeitung in VR aus.

Ohne VR-fähigen Browser zeigt der Abschnitt „VR (Beta)“ nur einen Hinweis statt des Schalters.

## Steuerung (Standard, frei belegbar unter Belegung → VR-Controller)

H = Haupthand (Waffe; Einstellung „Haupthand“, Standard rechts), N = Nebenhand.

| Aktion | Taste |
|---|---|
| Feuern | H Abzug |
| Zielen (Anlegen) | H Griff halten – **oder Waffe ans Auge heben** (Strahl ≤ 7 cm am Kopf vorbei, < 25° zur Blickrichtung) |
| Springen / Überklettern | H A/X (untere Taste) |
| Ducken (halten: Hinlegen) | H B/Y (obere Taste) |
| Nahkampf | H Stick drücken |
| Waffe wechseln | H Stick hoch |
| Panzerplatte | H Stick runter |
| Drehen | H Stick links/rechts (Schritte 15/30/45° oder flüssig) |
| Laufen | N Stick (Blick- oder Controller-Richtung) |
| Sprinten | N Stick drücken |
| Granate | N Abzug |
| Taktische Granate | N Griff |
| Nachladen / Interagieren | N A/X |
| **VR-Menü** | N B/Y (rechtshändig: Y links) |

Mit dem Körper: in die Hocke gehen = ducken (< 78 % der Stehhöhe), ganz runter = hinlegen (< 42 %), Kopf zur Seite
schieben oder neigen = lehnen (an Wänden begrenzt wie das normale Lehnen), echtes Gehen im Raum bewegt die Spielfigur
(mit Kollision). „Sitzend spielen“ schaltet echtes Ducken/Hinlegen ab (Sitzhöhe = Stehen).

VR-Menü in der Brille (Zeigen mit der Haupthand + Abzug, oder Stick hoch/runter + A): Weiter · Vignette an/aus ·
Drehen Schritt/flüssig · Höhe kalibrieren · VR beenden. Lobby, Endbildschirm und alle Einstellungen bleiben 2D: am
Matchende zeigt die Brille 4 s das Ergebnis, dann endet VR automatisch.

Anzeigen in VR: Handgelenk der Nebenhand (Leben, Platten, Munition, Granaten, Stand, Zeit, letzte 3 Abschüsse,
Trefferrahmen; 10×/s), Zielpunkt an der Stelle, auf die der Lauf zeigt (färbt sich bei Treffer/Kopf/Abschuss),
roter Rand bei Treffern (zur Quelle hin stärker) + Vibration, Abdunkeln beim Tod, Vibration beim Schießen/Treffen.

## Technik (Dateien)

| Datei | Inhalt |
|---|---|
| `assets/js/game/engine/xr/index.js` | `XRSystem` (G.xr): Sitzung, Rig, Kalibrierung, Drehen, Laufrichtung, Raumbewegung, Lehnen, Haltung, Zielstrahl, Menü, Haptik, Knopf „VR starten“ |
| `engine/xr/overlay.js` | Vignette + Trefferrand + Abblende in einem Pass (Kugel um den Kopf, Winkel je Auge → kein Stereo-Widerspruch) |
| `engine/xr/wrist.js` | Handgelenk-Anzeige (CanvasTexture 512 × 320, nur bei Änderung neu gezeichnet) |
| `engine/xr/menu.js` | Menü/Ergebnistafel in der Brille (CanvasTexture, Strahl-Auswahl) |
| `engine/renderer.js` | `_renderXr`: in VR ohne Nachbearbeitung direkt, Waffe gegen Welttiefe; `resize` ruht in VR; MSAA-Kontext bei `vrEnabled` |
| `main.js` | `renderer.setAnimationLoop` während der Sitzung (`frame(t, 'xr', xrFrame)`), rAF-Schleife setzt dann aus; Pause/Fortsetzen ohne Zeiger-Sperre |
| `engine/input.js` | Gerät `xr`: Tasten 0–6 je Hand, Stick-Codes, Laufen (N-Stick), `xr.turn` (H-Stick), Quelle `xrpose` (Zielen am Auge) |
| `shared/bindings.data.js` | Gerät `xr`, Codes `XrH0…6`, `XrN0…6`, `XrHUp/Down`, Standardbelegung, Pause in VR belegbar |
| `player.js` | Haken: `getEyePosition`/`getAimDirection` (Kopf bzw. Auge→Zielpunkt + Rückstoß), `xrLean`, `poseCamera` am Ende von `_updateCamera`, Hinlegen per langem Ducken auch mit `xr` |
| `weapons/viewmodel.js` | Wurzel = Griff der Haupthand, Lauf entlang des Zielstrahls, Pistolengriff in der Hand; nur Rückstoß/Ziehen/Aktionen; Arme aus; Lichter/Hülsen/Magazine in Weltkoordinaten; kein Zielfernrohr-Overlay/Hitzeflimmern |
| `ui/hud.js` | DOM-HUD in VR nur 10×/s (unsichtbar in der Brille) |
| `ui/menus.js`, `ui/settings/vr-section.js`, `controls-page.js`, `bindings-page.js` | Knopf im Pausenmenü, Abschnitt „VR (Beta)“, Reiter „VR-Controller“ (Auswahlliste statt Tastenerfassung) |
| `shared/settings.js` | `vrEnabled, vrHand, vrTurn, vrTurnStep, vrTurnSpeed, vrMoveDir, vrVignette, vrVignetteStrength, vrSeated, vrPhysical, vrHeight, vrQuality, vrScale, vrLaser` (Gruppe `vr`) |

Räume: `rig.position = Füße + (0, vOff, 0) − R(rigYaw)·c`, also `Kopf_Welt = Füße + R·(h − c) + vOff` mit
`vOff = 1,65 − kalibrierte Kopfhöhe + virtuelles Ducken + Stufenglättung`. Der Kopf hält 12 cm Abstand zu Wänden (das
Rig weicht aus, kein Blick durch Wände). Kugeln starten weiter am Auge (Anti-Cheat/Netz unverändert), die Richtung zeigt
auf den Punkt, den der Lauf trifft – so treffen sie, wohin die Waffe zeigt. Rückstoß kippt nur diese Richtung und stößt
das Waffenmodell, die Kamera bleibt ruhig.

Leistung (Quest 3, nicht messbar im Container – Entscheidungen): keine Nachbearbeitung, Stufe „Niedrig“ (Schatten 1024,
nur jedes 4. Bild), Bildpuffer 80 %, Foveation 1, MSAA 4× über den XR-Puffer, keine zusätzlichen Lichter (Overlay/
Anzeigen ohne Beleuchtung), je Bild ein Welt- + ein Akteur-Strahl für den Zielpunkt, Handgelenk-/Menü-Textur nur bei
Änderung, DOM-HUD gedrosselt, Hitzeflimmern (Bildkopie) aus. Leinwände für Handgelenk/Menü entstehen erst beim ersten
VR-Start. Der erste VR-Frame kompiliert Shader neu (andere Tonwertkurve als die Nachbearbeitung) – die Abblende zu
Beginn verdeckt das.

## Testen ohne Brille (Emulator)

```sh
npm i --prefix tools/out/vr iwer esbuild     # einmalig; tools/out ist nicht im Repo
node tools/vr-test.mjs --map=hafen           # Server auf :8765 muss laufen (NP_BASE/--base)
```

`tools/vr-iwer-entry.mjs` wird beim ersten Lauf mit esbuild zu `tools/out/vr/iwer.iife.js` gebündelt und per
`page.addInitScript` eingespritzt (IWER von Meta, MIT, `installRuntime({ forceInstall: true })` – Chromium hat ein
eigenes leeres `navigator.xr`). Nie unter `assets/` ausliefern.

Geprüft (alles mit niedriger Qualität, 800 × 450): Unterstützung erkannt → Knopf → XR-Sitzung (local-floor) und Bilder
ohne Konsolenfehler · linker Stick läuft · Schrittdrehung genau −30° · Abzug → `weapon:fire` · Handgelenk zeigt und
aktualisiert die Munition · Headset 0,95 m → Ducken, zurück → Stehen · Kopf 30 cm seitlich bzw. 30° geneigt → Lehnen ·
Treffer → roter Rand · Tod → Abblenden, Wiedereinstieg → Aufblenden mit Blick in Spawnrichtung · Y → Pause + VR-Menü ·
Stick + A „VR beenden“ → Sitzung zu, 2D-Pausenmenü, Stufe wie vorher, normale Schleife zeichnet wieder · zweite
Sitzung: Matchende → Ergebnistafel in der Brille, VR endet von selbst, Endbildschirm 2D.
Bildschirmfotos: `tools/out/vr/vr-ansicht.png`, `vr-feuer.png`, `vr-menue.png`, `nach-vr.png`, `vr-ergebnis.png`.
Optionen: `--quality=medium --vrq=wie` (Aussehen mit Bildschirmstufe), `--aa` (VR-Modus schon beim Laden an → MSAA-Kontext).
Bisherige Läufe: Hafen low, Altstadt medium (+ `--aa`, mit und ohne `--vrq=wie`) – alle Prüfungen grün.

Grenzen der Emulation: keine echte Bildrate/Wärme, kein echtes Handgefühl (Ausrichtung Lauf ↔ Controller), keine
Projektions-Ebenen (IWER nutzt XRWebGLLayer), kein Systemmenü. **Der echte Test ist Nathanaels Quest 3.**

## Bitte am Freitag an der Quest prüfen

1. Bildrate (Meta-Leistungsanzeige oder Gefühl): ruckelt es? Sonst „VR-Auflösung“ 70 % probieren.
2. Liegt die Waffe richtig in der Hand und zeigt der Lauf dorthin, wohin der Controller zeigt? (Konstante: Pose = Griff
   + Zielstrahl in `engine/xr/index.js` `gunPose`.)
3. Kopfhöhe: Ducken/Hinlegen zu früh oder zu spät? (Schwellen `STANCE` in `engine/xr/index.js`; sonst „Höhe kalibrieren“.)
4. Komfort: Vignette angenehm? Schrittdrehen 30°?
5. Menü-Taste Y, Ergebnistafel am Matchende, Rückkehr in 2D.

## Bekannte Grenzen / später (Stufe B)

- Mehrspieler-Darstellung für andere (Kopf, Handrichtung, Geräte-Symbol PC/Handy/VR) – nächster Schritt (VR-Mehrspieler).
- Keine Hände/Arme sichtbar (nur die Waffe); Messer/Granate in der Hand beim Nahkampf/Wurf unsichtbar.
- Hüftfeuer-Streuung wie am Bildschirm (Zielen = Griff halten oder Waffe ans Auge); evtl. eigene VR-Streuung.
- Granate fliegt in Zielrichtung der Waffe (kein Wurf aus der Hand), Nachladen per Taste (keine Handbewegung).
- Hand-Tracking ohne Controller: keine Tasten → Controller nötig.
- Fahrzeuge (nur offline, große Karten) in VR nicht angepasst.
- Volles Einstellungsmenü in der Brille kommt später; jetzt nur das kleine VR-Menü.
