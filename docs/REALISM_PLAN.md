# NULLPUNKT — Realismus-Plan („Bodycam-Niveau“ im Browser)

Stand: 2026-10-05 · Rolle: realism analyst · Status: **Plan, noch nichts davon umgesetzt** (außer wo „Ist“ steht).
Bezug: Wunsch des Nutzers, das Spiel „grafisch und physikalisch wie *Bodycam* (Steam)“ zu machen, mit
realistischeren Klängen, mehr Modi und Waffen, sehr guter Steuerung, PC-Spiel-Gefühl – aber weiterhin
auf dem Handy spielbar und ohne „extrem viel Grafikspeicher“.

Dieses Dokument ist die Arbeitsgrundlage für alle Modulbesitzer (siehe `docs/ARCHITECTURE.md` §1).
Es ändert keinen Vertrag; jede Umsetzung trägt ihre API-Änderungen wie gewohnt ins Changelog ein.

---

## 0. Kurzfassung

1. **Bodycam wirkt echt, weil es das Bild verschlechtert** (Fischauge, chromatische Aberration, Rauschen,
   Kompressionsspuren, ausgefressene Lichter, wackelnde Körperkamera) und weil es Fotoscan-Material (Megascans)
   mit HDRI-Licht und UE5-Lumen kombiniert ([80.lv][s-80lv-dev]). Die Verschlechterung ist für uns das
   **billigste Realismus-Werkzeug**. Ein einziger Nachbearbeitungs-Pass verdeckt geringe Polygon- und
   Texturauflösung und läuft auch auf Handys.
2. **Größter sichtbarer Sprung, in dieser Reihenfolge:** (a) fotografische PBR-Materialien und HDRI-Licht
   (Pipeline läuft schon, `assets/lib/`), (b) Bodycam-Objektiv-Pass mit AgX/LUT und automatischer
   Belichtung, (c) indirektes Licht und Himmelsverdeckung über ein beim Laden gebackenes Sonden-Gitter
   (Innenräume werden endlich dunkel), (d) Höhennebel, Lichtstrahlen und Staub.
3. **Größter Sprung im Spielgefühl:** Körperkamera-Bewegung mit Komfortregler, Waffenträgheit, Kollision der
   Waffe mit Wänden, Lehnen (Q/E), Überklettern, optional freies Zielen (Totzone), dazu überarbeiteter Rückstoß.
4. **Physik:** Rapier (WASM, Apache-2.0) **nur ab „medium“ und erst bei Bedarf nachgeladen**, für
   Ragdolls, Kleinkram-Requisiten, Glas und Türen. Spieler und Bots behalten die erprobte `CapsuleBody`.
   Hülsen und Magazine laufen auf allen Stufen über eine „Physik-lite“ mit BVH-Strahlen.
5. **Klang:** Die bereits gebaute CC0-Aufnahmebibliothek (`assets/lib/audio/`, 170 Dateien, 3,07 MB) wird mit
   der prozeduralen Engine kombiniert. Dazu kommen geometrische Frühreflexionen und Innen/Außen-Erkennung
   aus demselben Sonden-Gitter, Überschallknall, Ohrenklingeln und Ausrüstungsgeräusche.
6. **Inhalt:** 6 neue Modi (Stellung, Abschuss bestätigt, Infiziert, Suchen & Zerstören, Gunfight 2v2,
   Flaggenjagd) plus der Regelsatz „Realismus“ (Bodycam-artig: kein HUD, hoher Schaden). 13 neue Schusswaffen
   und eine neue Nahkampfwaffe ergeben **25 Waffen**. Dazu kommen ein Aufsatzsystem (≈ 48 Aufsätze), Blend- und
   Rauchgranate und eine neue dunkle Innenraumkarte „Nachtschicht“ mit Taschenlampen.
7. **Steuerung:** freie Tastenbelegung (Tastatur, Maus, Gamepad), Halten/Umschalten je Aktion, ADS-Empfindlichkeit
   je Zoomstufe, Gamepad-Kurven, Gyro-Zielen auf Handys, Editor für das Touch-Layout und eine „Erweitert“-Grafikseite
   mit Anzeige des Grafikspeichers, wie in PC-Spielen.
8. **Budgets** (§4): Handy ≤ 160 MB GPU und ≤ 12 MB Download fürs erste Match. Ultra ≤ 1 GB GPU und ≤ 55 MB.
   Zum Vergleich: Bodycam verlangt mindestens 8 GB VRAM und 50 GB Speicherplatz ([Steam][s-steam]).
9. **Ehrlich gesagt** (§3): Lumen, Nanite, virtuelle Schatten und Texturen, 8K-Scans, Motion-Capture und Wellen-Akustik
   gibt es in WebGL2 nicht. Wir kommen dem *Eindruck* nahe, besonders im Bodycam-Filter, aber nicht der
   Bildqualität eines UE5-Spiels in Standbildern aus der Nähe.

---

## 1. Was *Bodycam* ausmacht (Recherche)

> Quellenlage: Offizielle Angaben (Steam-Seite, Interview auf 80.lv, Wikipedia) sind verlässlich. Viele
> Detailangaben zu Patch v0.8, Steuerung und Waffen stammen aus Ratgeber- und News-Seiten Dritter und sind
> **nicht offiziell bestätigt**. Sie sind unten mit „(Dritte)“ markiert.

### 1.1 Eckdaten
- Entwickler: Reissad Studio (zwei französische Indie-Entwickler). Engine: **Unreal Engine 5**. Early Access seit
  7. Juni 2024. Begann als Test der UE5-Lichtfähigkeiten ([Wikipedia][s-wiki]).
- Mehrspieler-Taktik-Shooter **ohne Fadenkreuz, Munitionsanzeige und HUD** ([Steam][s-steam], [Wikipedia][s-wiki]).
- Hardware: **min. RTX 2070 / RX 5700 (8 GB)**, empfohlen RTX 3060 (12 GB) / RX 6600 XT, 16 GB RAM, **50 GB** SSD
  ([Steam][s-steam]).
- Ende 2025 Umstieg auf UE5.5: Rendering, Shader, Post-Processing und volumetrischer Nebel überarbeitet, ≈ 90 % der
  Texturen als Virtual Textures ([Wikipedia][s-wiki]).
- Update v0.8 „Locked & Loaded“ (Sept. 2026): Systeme „True Body“ und „Stress-Reloads“, Stolpern, neues
  Audio („Druckwellen“-Simulation), ≈ 400 Aufsätze, Drohnen ([Wikipedia][s-wiki], [Steam][s-steam],
  [2upskill (Dritte)][s-2up]).

### 1.2 Bildwirkung (Grafik)
| Merkmal | Beleg | Bedeutung für uns |
|---|---|---|
| Fischauge über ein Post-Process-Material, das die Bildränder verzerrt | [80.lv][s-80lv-dev], [Wikipedia][s-wiki] | Ein Vollbild-Pass, billig |
| Schwarze Ränder als Bild vor der Kamera, das auf Wackeln und Licht reagiert | [80.lv][s-80lv-dev] | Gehäusemaske im Objektiv-Pass |
| Chromatische Aberration und Rauschen | [80.lv][s-80lv-dev] | Im selben Pass |
| **„Bild verschlechtern und Asset-Maps überladen“ überfordert das Gehirn mit Information** | [80.lv][s-80lv-dev] | Kernerkenntnis: Detaildichte + Degradation |
| Lumen + echte HDRIs als Licht; „Lichtarten verbesserten den Realismus stark“ | [80.lv][s-80lv-dev] | HDRI-IBL + gebackenes indirektes Licht |
| Quixel Megascans + Marketplace-Assets (Fotoscans) | [80.lv][s-80lv-dev] | Poly Haven / ambientCG (CC0) |
| Gesichter der Figuren verpixelt | [Wikipedia][s-wiki] | Gesichter verdecken (Sturmhaube, Maske) |
| Volumetrischer Nebel (UE5.5) | [Wikipedia][s-wiki] | Höhennebel + Lichtstrahlen |

Typische Körperkamera-Artefakte, die Bodycam-artige Spiele und Vorlagen nachbilden: Fischauge, Brustkamera-Bewegung,
Kopfwippen, Sensorrauschen, Videokompression, harte Belichtungsanpassung, Schmutz-/Schärfemaske, Zeitstempel
([Unreal-Forum: Bodycam-Kamerasystem][s-ue-cam]).

### 1.3 Bewegung, Waffenhandhabung, Physik
- **Prozeduraler Rückstoß**: Die Waffe bewegt sich unabhängig von der Sichtlinie (freies Zielen) und ist physikalisch
  träge ([Wikipedia][s-wiki]). Rennt man zu schnell, schwankt die Waffe stark ([Superjump][s-superjump]).
- **„True Body“**: Arme, Rumpf, Beine, Waffe und Kamera sind physikalisch verbunden ([Steam][s-steam]). Lehnen und
  Schritte laufen über dieselbe Körpersimulation ([2upskill (Dritte)][s-2up]).
- **Stress-Reloads**: Nachladeanimationen in den Zuständen „ruhig“ und „gestresst“, mit Fehlern unter Druck
  ([Steam][s-steam]).
- **Ragdoll-Stolpern**: Aufpralle und Explosionen bringen Figuren je nach Richtung und Kraft aus dem Gleichgewicht ([Steam][s-steam]).
- Ballistik: Kugeln fliegen aus dem Lauf, haben Flugzeit und eine sichtbare „Rauchspur“. Einschläge und Klänge
  hängen vom Material ab. Kopfschüsse töten, Gliedmaßentreffer lassen bluten ([80.lv][s-80lv-dev]).

### 1.4 Modi, Waffen, Aufsätze, Karten
- **Modi** (Stand Steam-Seite): Wingman (2v2 Suchen & Zerstören), Body Bomb (5v5, Bombe legen/entschärfen),
  Team-Deathmatch, Deathmatch, Hardpoint, Gun Game, Koop-Zombies, dazu „Versus“ ([Steam][s-steam],
  [Wikipedia][s-wiki]). Laut Patchberichten Dritter wurden mit v0.8 Zombies vorerst abgeschaltet, und auch Body Bomb
  soll pausieren ([jeu.video (Dritte)][s-jeu]). Die Steam-Seite listet beide Modi weiterhin, die Angaben widersprechen sich also.
- **Waffen** (Dritte): AKM-, M4A1-, Glock-, Desert-Eagle-, UMP- und Uzi-Muster, Remington 870. v0.8 brachte ein
  Repetier-Scharfschützengewehr, mehrere Reihenfeuerpistolen, eine weitere Schrotflinte und eine Pistole
  ([PowerUp Gaming (Dritte)][s-powerup]).
- **Aufsätze**: ≈ 400 Teile in Kategorien wie Optiken (Rotpunkt, vergrößernd, schräg montiert), Griffe, Mündung
  (Schalldämpfer, Kompensator), Läufe, Magazine, Schäfte, Laser und Waffenlichter. Jeder Aufsatz hat Vor- und
  Nachteile bei Rückstoß, Handhabung und ADS ([Steam][s-steam], [2upskill (Dritte)][s-2up]).
- **Karten** (Dritte): u. a. Rome, Logistics, Oil Rig, Tumblewood, Trenches, Village, Nachbauten von Dust 2 und Nuketown
  ([mp1st][s-mp1st], [PowerUp (Dritte)][s-powerup]).

### 1.5 Klang
- Räumlicher Klang mit Ausbreitung in Echtzeit und realistischer Verdeckung ([Steam][s-steam]). Schüsse klingen
  je nach umgebender Geometrie anders, Schritte verraten die Richtung ([games.gg][s-gamesgg]).
- „Die Waffen klingen, als würde im Raum geschossen, der Hall ist fast ohrenbetäubend“ ([Superjump][s-superjump]).
- v0.8: „lokale Schalldruckwellen“-Simulation ([Wikipedia][s-wiki]). Spieler beklagen zu lange Echofahnen und
  draußen „Bunkerklang“ ([PixelNitro (Dritte)][s-pixel-audio]). **Lehre:** Realismus beim Hall braucht Grenzen.

### 1.6 Steuerung (Dritte, [dtgre][s-dtgre])
WASD · Umschalt Sprint · Strg Ducken · Z Hinlegen · Leertaste Springen/Überklettern · **Q/E Lehnen** · LMT Feuer ·
RMT Zielen · R Nachladen · V Nahkampf · G Granate · F Interagieren · Tab Taktik-Tablet · M Karte. Das horizontale
Sichtfeld ist fest. Freie Tastenbelegung wurde mit v0.8 flexibler, Gamepads werden unterstützt. Empfohlen werden
Lehnen „halten“ und Sprint „halten“.

### 1.7 Schwächen und Kritik
- **Reiseübelkeit** durch Kamerawackeln und Waffenschwanken ([Superjump][s-superjump]) → wir brauchen von Anfang an Komfortregler.
- **Freund und Feind schwer zu unterscheiden** ([Superjump][s-superjump]) → Teamfarben und Namensschilder behalten (optional reduziert).
- Hall und Echo in v0.8 überzogen ([PixelNitro (Dritte)][s-pixel-audio]) → Hall-Länge begrenzen, Außenräume trocken halten.
- Sehr hohe Hardware-Anforderungen (8 GB VRAM, 50 GB) → genau das wollen wir **nicht** übernehmen.

### 1.8 Was wir daraus lernen
1. **Degradation statt Detail:** Objektivfehler, Rauschen, Kompression, harte Belichtung und Bewegungsunschärfe
   verdecken, was WebGL nicht kann. Das kostet 1–2 Vollbild-Pässe.
2. **Licht ist wichtiger als Polygone:** HDRI-Umgebungslicht, korrekte Belichtung und dunkle Innenräume
   (Verdeckung) bringen mehr als dichtere Geometrie.
3. **Fotoscans:** Echte, rauere Materialien mit Schmutz und Abnutzung (CC0) statt prozeduraler Muster, wo es geht.
4. **Gefühl kommt aus Trägheit:** Waffe und Kamera als gefederte Massen. Dazu Lehnen, Überklettern und Kollision der Waffe.
5. **Klang trägt den Realismus mindestens zur Hälfte:** Echte Aufnahmen plus raumabhängiger Hall.
6. **Alles regelbar:** Bodycam selbst zeigt, dass zu viel davon übel macht oder unfair wirkt.

---

## 2. Ist-Zustand NULLPUNKT (Stand Changelog 2026-10-05)

| Bereich | Heute | Lücke zum Bodycam-Eindruck |
|---|---|---|
| Renderer (`engine/renderer.js`, core) | WebGLRenderer, three r186; low = direktes Rendern mit MSAA, ab medium EffectComposer: Welt → [GTAO nur ultra] → Viewmodel (Tiefe gelöscht) → SoftBloom → [SMAA] → Farblook/Vignette → OutputPass (**ACES**) → [FXAA]; dynamische Auflösung (`dynres.js`) | keine automatische Belichtung, kein Objektiv-Pass, kein LUT, keine Bewegungsunschärfe, kein Nebel- oder Lichtstrahlen-Pass, GTAO braucht einen zweiten Szenenpass |
| Licht (`world/lighting.js`, world) | eine Sonne mit **einer** Schattenkaskade, die der Kamera folgt (PCF; low 1024², alle 4 Bilder), Himmel prozedural (Sky), PMREM-Umgebung, Hemisphärenlicht | kein indirektes Licht, Innenräume zu hell und flach, keine kaskadierten Schatten, keine Taschenlampe |
| Materialien (`engine/textures.js`, `world/texgen.js`, world) | prozedurale Canvas-PBR-Texturen (Albedo/Normal/Rauheit), Decal-Atlanten (Schäden, Lichtkegel) | wirken „gezeichnet“; **Abhilfe läuft:** `tools/assets/` + `assets/lib/loader.js` (KTX2/ETC1S, 71 Texturquellen, 8 HDRIs, 59 Modelle, alle CC0; Build in Arbeit, Manifest mit GPU-Schätzung je Stufe) |
| Karten | Hafen, Altstadt, Werk, Schießstand (prozeduraler `MapBuilder`, Worker-BVH) | keine dunkle Innenraumkarte; Manifest plant schon `innenraum` (HDRI burnt_warehouse, 19 Texturen, 14 Modelle) |
| Figuren (`bots/soldier/*`, bots) | prozeduraler Soldat, 1 SkinnedMesh/1 Material je LOD, prozedurale Animation (IK), Verlet-Ragdoll mit 13 Partikeln | kein Fotoscan-Material, Gesichter sichtbar, kein Stolpern |
| Spielergefühl (`player.js`, `physics.js`, core; `viewmodel.js`, gunsmith) | schwebende Kapsel (Stufen, Schrägen), Kopfwippen, Neigung, Rutschen; Viewmodel mit Feder-Sway, Atem und Landestoß; `addRecoil` | kein Lehnen, kein Überklettern, kein freies Zielen, keine Waffenkollision mit Wänden, keine Körperkamera-Charakteristik |
| Ballistik (`weapons/*`, `effects.js`, ballistics) | Hitscan mit Abfall und Durchschuss, 10 Schusswaffen, Messer, 2 Granaten, Einschuss-Decals, Partikel, Leuchtspuren | keine Aufsätze, keine taktischen Granaten, Leuchtspuren eher arcadig |
| Klang (`engine/audio*`, audio) | vollständig prozedural (≈ 260 Puffer im Worker), HRTF, Faltungshall je Karte, Slap-back, Verdeckung über `lineOfSight`; **CC0-Aufnahmen gebaut, aber noch nicht eingebunden** (`assets/lib/audio`, 170 Dateien, 3,07 MB, dekodiert 60 MB) | Schüsse noch synthetisch; keine Frühreflexionen nach Geometrie, kein Ohrenklingeln |
| Modi (`modes/*`, ui) | tdm, ffa, dom, gun, training + 3 Abschussserien | keine Rundenmodi, keine Bombe, kein CTF, kein Infiziert, kein Hardpoint |
| Steuerung (`engine/input.js`, core) | feste Belegung (Q = Granate, E/F = interact), `unadjustedMovement`-Pointer-Lock, Gamepad, Touch im COD-Mobile-Stil mit Zielhilfe und Auto-Feuer | keine freie Belegung, kein Lehnen, kein Gyro, kein Layout-Editor, keine ADS-Empfindlichkeit je Zoom |
| Download (gemessen) | Spielcode + three + Addons ≈ 2,7 MB roh / **≈ 1,2 MB gzip**; Basis-Transcoder 0,53 MB roh | Asset-Bibliothek kommt hinzu (§4) |

Parallel laufende Arbeit, die dieser Plan voraussetzt: Asset-Pipeline (Aufgaben 90/91), Hüftpose im COD-Mobile-Stil
(G12/G23), Aufteilung des ersten Matchstarts (G18). Der Plan baut darauf auf und ersetzt nichts davon.

---

## 3. Grenzen: Was ein Browserspiel nicht erreicht (ehrlich)

| UE5 / Bodycam | WebGL2 / three.js r186 | Unser Ersatz | Restabstand |
|---|---|---|---|
| **Lumen** (dynamisches GI und Spiegelungen) | kein GI, keine Compute-Shader | gebackenes Sonden-Gitter (Himmelsverdeckung + 1 Lichtsprung, Lichtgruppen), PMREM, SSR nur ultra | statisch, kein GI aus der Taschenlampe, Licht von Mündungsfeuer prallt nicht ab |
| **Nanite** (Milliarden Dreiecke) | Draw-Call- und Vertex-gebunden | LODs, Instancing/BatchedMesh, verschmolzene Geometrie, Normal-Maps | Nahaufnahmen von Kanten und Silhouetten bleiben kantig |
| **Virtual Shadow Maps** | Schattenkarten pro Licht | 2–4 Kaskaden, statische Fernkaskade im Zwischenspeicher, PCSS nur ultra | weichere oder flimmernde Schattenränder, Abstand < 30 m |
| **Virtual Textures, 8K-Scans** | feste Texturen, ETC1S/BC | KTX2 512–2048, Detailtexturen, Gegen-Kachelung | aus der Nähe matschiger, Blockartefakte von ETC1S |
| **Motion-Capture + „True Body“-IK** | wir haben prozedurale Animation | IK verfeinern, Körper in der Ego-Sicht, Stolper-Reaktionen, Gesichter verdecken | Bewegungen wirken aus der Nähe synthetisch |
| **Schallausbreitung als Welle** | WebAudio, Faltung | Frühreflexionen per Strahl, Beugung über das Navigationsnetz, Innen/Außen-Gitter | keine echte Beugung und Interferenz |
| **Echte Mitspieler** | offline gegen Bots | bessere Bot-KI (Lehnen, Lampen, Rollen) | Bots bleiben Bots |
| 8 GB VRAM, 50 GB | Handy: ≈ 1–1,5 GB Speicher je Tab (iOS beendet Tabs darüber), thermisches Drosseln | Budgets in §4, dynamische Auflösung + FSR1-Hochskalierung | Handy-Bild bleibt deutlich einfacher, mit **Bodycam-Look**, aber ohne Ultra-Licht |
| ein natives Programm | ein JS-Hauptthread, Garbage Collection, Shader-Kompilierung | Worker (Welt, Audio), Vorkompilieren, Objekt-Pools | gelegentliche Ruckler beim ersten Auftreten eines Effekts |

**WebGPU** (three r186 `WebGPURenderer` + TSL bringt SSGI, TRAA, Bewegungsunschärfe, GTAO und Lichtstrahlen als Nodes;
Safari 26 und Chrome für Android liefern WebGPU aus) wäre der Weg zu mehr. Der Umstieg verlangt, alle eigenen Shader und
`onBeforeCompile`-Stellen nach TSL zu portieren und den Composer zu ersetzen. **Empfehlung: jetzt nicht.** Nach
Phase C neu bewerten (§13, P3), zunächst als zusätzlicher Pfad „Ultra+“ mit Rückfall auf WebGL2.

---

## 4. Leitlinien und Budgets

### 4.1 Qualitätsstufen

| Stufe | Zielgeräte | interne Auflösung (vor Hochskalierung) | Ziel-FPS | **GPU-Speicher (Budget, hart)** | **Download erstes Match** | jede weitere Karte |
|---|---|---|---|---|---|---|
| **low (Handy)** | Android-Mittelklasse (Adreno 610–650, Mali-G57/G68), iPhone 11–13 | 0,5–0,85 MP (DPR ≤ 1,5 × dynres 0,55–1) | 30 | **≤ 160 MB** | **≤ 12 MB** | ≤ 7 MB |
| **medium** | starke Handys und Tablets, Laptops mit iGPU | 0,9–1,4 MP | 30 (Touch) / 60 | **≤ 320 MB** | **≤ 25 MB** | ≤ 15 MB |
| **high** | Desktop mit dGPU / Apple M | 1,4–2,1 MP | 60 | **≤ 600 MB** | **≤ 32 MB** | ≤ 22 MB |
| **ultra** | Desktop ≥ 6 GB VRAM | 2,1–3,7 MP | 60 | **≤ 1 GB** | **≤ 55 MB** | ≤ 32 MB |

### 4.2 GPU-Speicher je Posten (Schätzung, inkl. Mipmaps, ohne Treiber-Overhead)

Annahmen: ≈ 22 Texturensätze (Albedo/Normal/ORM) je Karte, ≈ 15 Requisitentypen. ETC1S wird auf dem Handy zu
ETC1/ETC2 transkodiert (0,5 B/px), auf dem Desktop zu BC7 (1 B/px). Werte aus `assets/lib/manifest.json` hochgerechnet.

| Posten | low | medium | high | ultra |
|---|---|---|---|---|
| Welt-Texturen | 512²: ≈ 12 MB | 1024²: ≈ 46 MB (Handy) / 92 MB (Desktop) | 1024²: ≈ 92 MB | 6 Heldensätze 2048² + Rest 1024²: ≈ 170 MB |
| Requisiten (Texturen + Geometrie) | 512: ≈ 10 MB | **512: ≈ 12 MB** (Empfehlung) | 1024: ≈ 65 MB | 1024: ≈ 65 MB |
| Waffen + Arme (Viewmodel) | ≈ 4 MB | ≈ 10 MB | ≈ 15 MB | 2048: ≈ 40 MB |
| Figuren (geteilter Satz + Tarnmuster) | ≈ 6 MB | ≈ 10 MB | ≈ 14 MB | ≈ 20 MB |
| Welt-Geometrie (verschmolzen) | ≈ 20 MB | ≈ 30 MB | ≈ 40 MB | ≈ 50 MB |
| PMREM + Himmelskuppel | ≈ 3 MB (PMREM 128) | ≈ 9 MB | ≈ 9 MB | ≈ 9 MB |
| Sonden-Gitter (Licht + Akustik) | 0,3 MB | 0,5 MB | 1 MB | 2 MB |
| Schattenkarten | 1 × 1024² + Lampe 256² ≈ 4 MB | 2 × 1024² + 512² ≈ 9 MB | 3 × 2048² + 1024² ≈ 54 MB | 4 × 2048² + 1024² ≈ 71 MB |
| Render-Ziele | ≈ 15 MB (HDR 8 B + Tiefe + LDR, ohne MSAA) | ≈ 42 MB (+ Bloom) | ≈ 70 MB (+ AO halbe Auflösung) | ≈ 180 MB (+ TAA-Verlauf, Volumetrik, 3,7 MP) |
| Effekte, Decals, Atlanten | ≈ 4 MB | ≈ 8 MB | ≈ 12 MB | ≈ 16 MB |
| **Summe** | **≈ 80 MB** | **≈ 180 MB (Handy) / 225 MB (Desktop)** | **≈ 370 MB** | **≈ 620 MB** |

Die Spanne zwischen Summe und Budget ist Reserve für Treiber, Shader und Fragmentierung. Auf iOS darf die
Seite nicht über ≈ 1 GB Gesamtspeicher kommen; JS-Heap und dekodiertes Audio zählen dazu.

### 4.3 Download je Stufe (gemessen bzw. aus dem Manifest hochgerechnet)
Texturensatz 512 ≈ 0,07–0,2 MB, 1024 ≈ 0,28–0,65 MB, 2048 ≈ 1,9–2,9 MB. HDRI-Licht 512 ≈ 0,5 MB, 1024 ≈ 1,9 MB.
Prop 512 ≈ 0,2 MB, 1024 ≈ 0,6 MB. Code ≈ 1,5 MB gzip inkl. Transcoder. Rapier ≈ 1,2 MB gzip (GitHub Pages
komprimiert `application/wasm` mit gzip, an threejs.org geprüft).

| | low | medium | high | ultra |
|---|---|---|---|---|
| Code | 1,5 | 1,5 + Rapier 1,2 | 2,7 | 2,7 |
| Audio | ≈ 1,6 (Auswahl) | 3,1 | 3,1 | 3,1 |
| Welt-Texturen | ≈ 2,9 | ≈ 10,3 | ≈ 10,3 | ≈ 21 |
| Requisiten | ≈ 3,1 | ≈ 3,1 (512) | ≈ 8,9 | ≈ 8,9 |
| HDRI | 0,5 | **0,5** (512 genügt für diffuses Licht) | 1,9 | 1,9 |
| Waffen, Figuren, LUTs | ≈ 1 | ≈ 2 | ≈ 2 | ≈ 8 |
| **Summe** | **≈ 10,6 MB** | **≈ 21,7 MB** | **≈ 28,9 MB** | **≈ 45,6 MB** |

**Zeit bis zum Spielen klein halten:** Jede Stufe startet mit den 512er-Texturen und lädt nach dem Spawn die
höhere Stufe im Hintergrund nach (Streaming light, §6 M3). Ein **Service Worker** mit versioniertem Cache (core/site)
macht Revanchen und weitere Besuche ohne erneuten Download möglich. GitHub Pages cacht nur 10 Minuten.

### 4.4 Speicher sparen (gilt für alle Punkte)
1. KTX2/ETC1S überall (Pipeline). **Desktop-Option:** ETC1S für Albedo/ORM als **BC1** (0,5 B/px) statt BC7
   transkodieren (KTX2Loader-Priorität). Das halbiert den Desktop-Texturspeicher bei kaum sichtbarem Verlust, weil die
   ETC1S-Quelle ohnehin auf BC1-Niveau liegt. Normal-Maps bleiben BC7.
2. Requisiten teilen sich Trim-Sheets und Atlanten. Höchstens ≈ 12–15 Requisitentypen mit eigenen Texturen je Karte.
3. HDR-Render-Ziele als **R11G11B10F** (4 B/px statt 8, `RGBFormat` + `UnsignedInt101111Type`, braucht
   `EXT_color_buffer_float`) mit Rückfall auf RGBA16F. Vorab per Spike prüfen, ob three r186 das als Render-Ziel annimmt.
4. AO, Nebel, Lichtstrahlen und Volumetrik in halber oder viertel Auflösung, bilateral hochgerechnet. Ping-Pong-Ziele wiederverwenden.
5. Schatten im Zwischenspeicher statt größerer Karten (statische Fernkaskade einmal rendern).
6. Dynamische Auflösung + **FSR1-Hochskalierung** (EASU + RCAS, MIT-Lizenz von AMD) statt hoher nativer DPR.
7. Quantisierte Vertex-Attribute (Normalen Int8, UVs Uint16/Float16) in der verschmolzenen Welt-Geometrie: ≈ −40 % Vertexspeicher.
8. Neues `renderer.memoryEstimate()` (core) summiert Texturen, Ziele und Geometrien. **Erweiterte Grafikeinstellungen
   zeigen die Schätzung live an** („≈ 340 MB Grafikspeicher“), wie in PC-Spielen.

---

## 5. Rendering-Pipeline (Grafik)

### 5.1 Ziel-Kette

```
Welt-RenderPass → HDR-Ziel (R11G11B10F|RGBA16F) + DepthTexture (geteilt)
  ├─ [AO halbe Auflösung, nur Tiefe, high/ultra]
  ├─ [Lichtstrahlen / Volumetrik, ¼-Auflösung, medium+ / ultra]
  ├─ [Kamera-Bewegungsunschärfe, high/ultra]           ← Viewmodel noch nicht im Bild
Viewmodel-RenderPass (Tiefe löschen)                    ← wie heute
Luminanz 64² → 1×1 → Belichtungsanpassung (GPU, ohne Rücklesen)
Bloom (+ Linsenschmutz)
[TAA (ultra) | SMAA (high) | –]
„Grade“-Pass: Belichtung × → Tonemapping (AgX / ACES) → LUT 32³ → Vignette, Schaden, Unterdrückung → LDR RGBA8
„Objektiv“-Pass: Tonnenverzeichnung + CA (+ EASU bei Skala < 1) → Schärfen (RCAS) → Körnung, Chroma-Unterabtastung,
                 Gehäusemaske, Dither → Bildschirm
```
low-lite: Welt → **ein** Pass (Belichtung, Tonemapping, LUT, Verzeichnung ohne CA, Körnung, FXAA-lite).

### 5.2 Maßnahmen

Spalten: Wirkung (★ = gering … ★★★★★ = sehr groß) · Kosten Handy (Schätzung bei 0,85 MP, Mittelklasse; **messen**) ·
Besitzer/Modul · Prio (P0 = zuerst).

| # | Maßnahme | Wirkung | Kosten Handy | Besitzer / Modul | Prio |
|---|---|---|---|---|---|
| R1 | **HDRI-IBL** statt prozeduralem Himmel: `assets.loadHDRI()` → `scene.environment`, Himmel als KTX2-Kuppel (`createSky()`), Sonnenrichtung aus dem Manifest übernehmen | ★★★★★ | PMREM 128 auf low ≈ 1,5 MB; 0 ms | world (`world/lighting.js`), Assets: `assets/lib/loader.js` | P0 |
| R2 | **Objektiv-Pass „Bodycam“** (Verzeichnung, CA, Schärfen, Körnung, Kompression, Gehäusemaske, Vignette) | ★★★★★ | 0,6–1,5 ms, 1 Ziel | core (`engine/renderer.js` + neu `engine/post/lens.js`) | P0 |
| R3 | **Tonemapping AgX** (three r186 eingebaut) oder ACES behalten, dazu **LUT** je Karte (32³, PNG-Streifen ≈ 20–40 KB, selbst erzeugt) | ★★★★ | 1 Textur-Tap | core (Pass) + world (LUT je Karte in `maps.data`/Kartenmodul) | P0 |
| R4 | **Automatische Belichtung** (GPU-Luminanz, mittenbetont, schnell heller / langsam dunkler, Grenzen je Karte); low: CPU-Variante aus der Himmels-/Sonnensonde des Viewmodels (F35) | ★★★★★ | GPU-Variante ≈ 0,2 ms; low 0 ms | core (`engine/post/exposure.js`) + world (Grenzen) + gunsmith (Sonde freigeben) | P0 |
| R5 | **Sonden-Gitter** (2 m, low 3 m): Himmelsverdeckung, 1 Sonnenrückprall mit Material-Durchschnittsfarbe (`stats.avgColor` im Manifest), bis zu 4 **Lichtgruppen** (Leuchtstoffröhren, Notlicht → Flackern zur Laufzeit gratis). Backen im Welt-Worker über die vorhandene BVH, 16–32 Strahlen je Zelle, ≈ 0,5–1,5 s. Shader: `onBeforeCompile` multipliziert indirektes Diffus- und Spiegellicht mit 1 Abfrage einer 3D-Textur | ★★★★★ (Innenräume!) | 1 Abfrage einer 3D-Textur, ≈ 0,3 MB | world (`world/probes.js` neu, `worldgen.worker.js`) + world/textures (Material-Hook) | P0 |
| R6 | **Höhennebel** mit Sonnen-Inscattering (Material-Chunk, ersetzt `Fog`) + **Staubpartikel** in Lichtkegeln | ★★★★ | ≈ 0 ms (im Material), Partikel ≈ 0,2 ms | world (Nebel) + ballistics (`effects.js`, Staub) | P1 |
| R7 | **Lichtstrahlen** (radiale Unschärfe aus Sonnen- bzw. Fensterrichtung mit Tiefenmaske, ¼-Auflösung) | ★★★ | medium+: ≈ 0,5 ms; low aus | core (Pass) | P1 |
| R8 | **Kaskadierte Schatten** (CSM-Addon aus three r186 nachrüsten oder eigene 2–4 Kaskaden). **Fernkaskade nur statische Geometrie, einmal beim Laden bzw. bei großer Bewegung gerendert**, Nahkaskade (15–20 m) jedes Bild. PCSS (Halbschatten wird mit Abstand weicher) nur ultra | ★★★★ | low unverändert (1 Kaskade, alle 4 Bilder); medium 2 × 1024² | world (`world/lighting.js`) + core (Shader-Chunk) | P1 |
| R9 | **Taschenlampe** (SpotLight mit Muster-Textur `light.map`, Schatten 512–1024²; Handy 256², alle 2 Bilder) + **fester Lichter-Pool** (sonst kompiliert three bei wechselnder Lichtanzahl die Shader neu) für Bot-Lampen (max. 3, ohne Schatten) und Mündungsfeuer | ★★★★★ (dunkle Karte) | 1 kleiner Schattenpass ≈ 0,5–1 ms | core (Pool im Renderer) + gunsmith (Waffenlicht) + bots (Bot-Lampen) | P1 |
| R10 | **Bewegungsunschärfe der Kamera** (Rückprojektion über Tiefe und vorige ViewProj, 6–8 Samples, Viewmodel ausgenommen, Komfortregler) | ★★★ | Handy aus; Desktop ≈ 0,5 ms | core | P2 |
| R11 | **AO aus der Tiefe** (halbe Auflösung, Normalen aus der Tiefe rekonstruiert) statt GTAOPass mit zweitem Szenenpass. Alternative: N8AO (ISC-Lizenz) | ★★★ | Handy aus (Sonden-Gitter liefert grobe Verdeckung) | core | P2 |
| R12 | **FSR1-Hochskalierung** (EASU + RCAS), sobald `resolutionScale < 1`; hält das Bild auf Handys scharf | ★★★★ (Handy) | ≈ 0,5 ms, steckt im Objektiv-Pass | core (`engine/post/lens.js`, `dynres.js`) | P1 |
| R13 | **TAA** mit Rückprojektion und Nachbarschafts-Clamp (ultra; high optional) → ruhiges Bild ohne Glanzflimmern, dazu Schärfen | ★★★ | Handy aus | core | P2 |
| R14 | **Spekulares Anti-Aliasing** (Rauheit aus Normalen-Ableitungen anheben) + Mip-Bias für Normalen | ★★★ | ≈ 0 ms | world/textures (Material-Hook) | P1 |
| R15 | **Volumetrische Lichtkegel** (Raymarch durch Schattenkarten, ¼-Auflösung, 16–24 Schritte) für Taschenlampe und Fenster | ★★★★ | nur ultra (high optional) | core | P2 |
| R16 | **Decals 2.0**: Einschusslöcher mit Normal- und Rauheitsatlas (KTX2), Blutspuren an Wand und Boden (Einstellung `blood`), Brandflecken nach Explosionen | ★★★ | Atlas ≈ 1 MB | ballistics (`effects.js`) + world (Atlas) | P1 |
| R17 | **Nass und Schmutz**: Schmutz in Weltkoordinaten (Rauschen und Höhe über dem Boden) im Material, Pfützen über eine Rauheitsmaske (Hafen, Nachtschicht), SSR nur ultra | ★★★ | Rauschen ≈ 0 ms; SSR nur ultra | world | P2 |
| R18 | **Unterdrückung/Stress**: Vignette, leichte Entsättigung und Unschärfe am Rand bei `bullet:whiz` oder wenig Leben (über `setPost`) | ★★★ | 0 ms | core (Renderer) + ui | P1 |
| R19 | **Zielfernrohr als Bild-im-Bild** (zweite Kamera, 512², high/ultra); Handy behält die Vollbild-Überlagerung | ★★ | Handy aus | gunsmith + core | P3 |

### 5.3 Objektiv-Pass im Detail (R2/R3)
- **Sichtfeld:** Bodycam-Stil „Breit“ = vertikal 62–68° (≈ 100–105° horizontal bei 16:9). Bei 2,2:1-Handys wird
  die Verzeichnung mit dem Seitenverhältnis skaliert. `settings.fov` bleibt; der Objektiv-Stil setzt nur Vorgaben.
- **Verzeichnung:** Brown-Conrady `uv' = c + (uv − c)·(1 + k1·r² + k2·r⁴)·s` mit k1 ≈ 0,12–0,2, Zuschnitt `s`, damit
  keine schwarzen Ecken entstehen. Die Bildmitte bleibt unverzerrt, das Zielen stimmt also. **HUD-Projektionen**
  (Namensschilder, Zielmarker, Schadensrichtung, Treffermarker abseits der Mitte) brauchen die gleiche Abbildung:
  `renderer.lens.toScreen(ndc)` (2–3 Newton-Schritte in JS). Gilt für ui (`hud.js`) und bots (`nameplates.js`).
- **Chromatische Aberration:** radial, ∝ r², max. 0,0015–0,003 UV, 3 Taps (R/G/B).
- **Körnung:** luma-abhängig, in Schatten stärker (σ ≈ 0,015–0,035 in sRGB), neues Muster nur 24–30-mal pro Sekunde (wirkt wie Video).
- **Kompression:** Chroma in halber Auflösung abtasten (4:2:0-Eindruck), in dunklen Bereichen bei schneller Bewegung
  leichte 8×8-Blöcke. Zurückhaltend dosieren, Regler `lensArtifacts`.
- **Schärfen:** CAS/RCAS mit 0,3–0,5 (Bodycams überschärfen), zugleich Ausgleich zu FXAA/TAA.
- **Gehäusemaske:** abgerundete, unscharfe Ränder, bewegt sich minimal mit dem Kamerawackeln (wie bei Bodycam:
  „Bild vor der Kamera“). Optional **Zeitstempel und Geräte-ID** als HUD-Element (ui, ausgedachte Bezeichnung, z. B. „NP-K2“).
- **Belichtung:** harte Schulter im LUT, Lichter dürfen ausbrennen; Bloom mit Linsenschmutz-Maske (prozedural, kein Fremdasset).
- **Rolling Shutter** (Zeilen verschieben ∝ Gier-Geschwindigkeit): **Standard aus**, weil er Übelkeit fördert.
- **Einstellungen** (core, `shared/settings.js`, additiv): `lensStyle: 'bodycam'|'neutral'`, `lensStrength 0..1`,
  `grain 0..1`, `lensArtifacts 0..1`, `motionBlur bool`, `cameraMotion 0..1` (Komfort), `hudStyle: 'voll'|'reduziert'|'aus'`,
  `blood bool`. Bei `reducedMotion` gilt `cameraMotion` ≤ 0,15 und Bewegungsunschärfe aus.

### 5.4 Automatische Belichtung im Detail (R4)
Szene → 64² log-Luminanz (R16F, mittenbetont) → Mip-Kette oder 3 Reduktionen bis 1×1 → 1×1-Ping-Pong:
`L ← L + (Lziel − L)·(1 − e^(−dt·τ))`, τ heller ≈ 3/s, dunkler ≈ 1/s → Belichtung = `key / L`, begrenzt auf
`[evMin, evMax]` je Karte. Der Grade-Pass liest die 1×1-Textur direkt, **kein `readPixels`** (das würde die GPU
anhalten). So entsteht der typische Bodycam-Moment: Aus dem dunklen Flur ins Freie brennt das Bild kurz aus.
low: Zielbelichtung auf der CPU aus Himmelssicht und Sonnentreffern der vorhandenen Viewmodel-Sonde (F35) und den
Werten der Karte für innen und außen.

---

## 6. Materialien und Texturen

| # | Maßnahme | Wirkung | Kosten Handy | Besitzer | Prio |
|---|---|---|---|---|---|
| M1 | **KTX2-PBR-Sätze einbinden** (`assets.createMaterial(id)`, ORM in einer Textur, `replaces` ordnet die alten `getMaterial()`-Namen zu); Weltkoordinaten-UVs über `sizeM` (`boxUV`) | ★★★★★ | 512er-Stufe: ≈ 12 MB | world (`engine/textures.js`, `world/builder.js`), Assets | P0 (läuft) |
| M2 | **Gegen-Kachelung** (Hex-/stochastisches Kacheln, 3 Abfragen) für Böden und große Wände; Detail-Normal-Map in der Nähe | ★★★ | nur high/ultra | world | P2 |
| M3 | **Streaming light:** zuerst 512er, nach dem Spawn 1024er nachladen und Texturen austauschen (gleiche Materialinstanz, `needsUpdate`) | ★★ (Ladezeit!) | Download verteilt | world + Assets (`loader.js`) | P1 |
| M4 | **Material-Variation** über Vertexfarbe bzw. Instanzfarbe (Lack, Verblassen) und tönbare Sätze (`tintable`: Container in 5 Farben aus einem Satz) | ★★★ | 0 | world | P1 |
| M5 | **Hülle- und Waffen-Materialien** (gunmetal_worn, polymer_black, wood_stock, rubber in 1024/2048) für Viewmodel und 3rd-Person | ★★★★ | ≈ 4 MB auf low | gunsmith (`gunsmith/materials.js`) | P0 |
| M6 | **Figuren-Materialien** (fabric_uniform + camo_* mit geteilten Normal-/ORM-Karten, `detailRepeat`) | ★★★ | ≈ 2 MB | bots (`soldier/materials.js`) | P1 |
| M7 | **Parallax Occlusion** nur für Kopfsteinpflaster und Ziegel auf ultra | ★★ | aus | world | P3 |
| M8 | Transkodier-Option **BC1 auf dem Desktop** (§4.4) | Speicher −50 % | – | Assets (`loader.js`) | P1 |

---

## 7. Geometrie, Requisiten, Karten-Bau

| # | Maßnahme | Wirkung | Kosten Handy | Besitzer | Prio |
|---|---|---|---|---|---|
| G1 | **CC0-glTF-Requisiten** aus der Pipeline (Fässer, Kisten, Kanister, Reifen, Absperrungen, Lampen, Klimageräte, Rolltore, Leitungs-Baukästen …), platziert vom `MapBuilder` an bestehenden Deckungsstellen | ★★★★★ | LOD-Kette (Manifest `lodDistances`), 512er-Stufe | world (`world/props.js`, Kartenmodule) | P0 |
| G2 | **Instancing**: je Requisitentyp und LOD ein `InstancedMesh` oder `BatchedMesh` mit `setGeometryIdAt` als LOD-Wechsel je Instanz (r186 hat in BatchedMesh kein eingebautes LOD) | Draw Calls | spart CPU | world | P0 |
| G3 | **Kleinteil-Dichte** („Asset-Maps überladen“): Müll, Papier, Kabel, Scherben, Laub als Decal-Karten und Instanzen, nur bis 25–40 m sichtbar | ★★★★ | Instanzen ≈ 0,3 ms | world | P1 |
| G4 | **Fassaden-Trims**: Fensterrahmen, Bänke, Regenrinnen (Baukasten `modular_metal_gutter`), Feuerleitern (`modular_fire_escape`), Rolltore als Modelle an prozeduralen Wänden; Kanten fasen (Bevel), damit Glanzlichter entstehen | ★★★★ | wenig | world (`world/arch.js`, `builder.js`) | P1 |
| G5 | **Vertex-Quantisierung** der Welt (§4.4 Nr. 7) | Speicher | – | world | P2 |
| G6 | **Karten-Varianten bei Nacht** (z. B. „Hafen – Nacht“ mit HDRI `cobblestone_street_night`, Natriumlampen in der Lichtgruppe, Taschenlampen) | ★★★★ (wenig Aufwand) | wie Karte | world + ui (Lobby) | P2 |

---

## 8. Figuren (Upgrade-Pfad)

| Stufe | Inhalt | Wirkung | Kosten | Besitzer | Prio |
|---|---|---|---|---|---|
| C1 | Fotoscan-Stoffe und Ausrüstung (M6), **Gesicht verdeckt** (Sturmhaube, Gasmaske, Helm mit Schutzbrille; Bodycam verpixelt Gesichter, wir verdecken sie, das umgeht das „Uncanny Valley“) | ★★★★ | ≈ 0 | bots (`soldier/gear.js`, `materials.js`) | P1 |
| C2 | **Stolpern und Treffer-Reaktionen** (Impuls je Trefferzone und Richtung in die vorhandenen IK-Federn, Taumeln bei Explosionen, Schritt zur Seite) | ★★★★ | CPU gering | bots (`soldier/animator.js`, `ik.js`) | P1 |
| C3 | **Ragdoll 2.0**: Verlet-Ragdoll bekommt Kugelimpuls und BVH-Kollision (alle Stufen); ab medium mit Rapier: Kapseln und Gelenke, max. 6 aktiv auf dem Desktop, 2 auf dem Handy | ★★★★ | low: CPU | bots (`soldier/ragdoll.js`) + core (`engine/rigid.js`) | P2 |
| C4 | **Eigener Körper in der Ego-Sicht** („True Body“-light): Soldatenmodell ohne Kopf, Beine beim Blick nach unten, eigener Schatten | ★★★ | 1 SkinnedMesh | gunsmith + bots | P2 |
| C5 | **Neues Basis-Mesh** aus **MakeHuman** (Exporte und Basis-Assets CC0; Lizenz jeder Kleidung einzeln prüfen, nur CC0 oder CC-BY), auf das vorhandene Skelett gewichtet, LOD0 8–12k Dreiecke Desktop, 3–4k Handy. Animationen bleiben prozedural. Fremde Mocap-Daten nur mit CC0 oder CC-BY (z. B. CMU nicht: keine CC-Lizenz) | ★★★★ | +0,5–1,5 MB Download | bots + Assets (Pipeline) | P2 |
| C6 | **Bot-Taktik** passend zum Realismus: Lehnen statt Seitwärtsschritt an Deckung (`nav.coverDir`), Lampe an und aus, Reaktion auf Blendgranaten, Sicht durch Rauch blockiert, Rollen in Rundenmodi | ★★★★ (Gefühl) | CPU | bots (`bots/ai/*`) | P1–P2 |

---

## 9. Physik und Bewegungsgefühl

### 9.1 Spieler-Controller und Waffe

| # | Maßnahme | Wirkung | Kosten | Besitzer / Modul | Prio |
|---|---|---|---|---|---|
| F1 | **Körperkamera-Bewegung**: Federsystem für Translation mit Schrittimpulsen (Fersenaufsatz), Atmung 0,25 Hz, Sprintwippen, Landestauchung, kleines Rollen. Alles mal `cameraMotion` (Standard Desktop 0,6, Touch 0,4) | ★★★★★ | 0 | core (`player.js`) | P0 |
| F2 | **Waffenträgheit**: Masse und Griffsteifigkeit je Waffe (neues Datenfeld `handling: { mass, inertia, swayScale, aimDrift }`), Rotationsverzug gegenüber der Kameradrehung, Versatz beim Seitwärtslaufen, leichtes Zielwandern im Stand (Rauschen), nach dem Sprint Atemnot und mehr Schwanken (`exhausted` existiert) | ★★★★★ | 0 | gunsmith (`viewmodel.js`, `gunsmith/handling.js`) + ballistics (`weapons.data.js`) | P0 |
| F3 | **Waffe kollidiert mit der Wand**: 1 Strahl je Bild (`world.raycast`, Waffenlänge aus den Daten) → Waffe wird angezogen bzw. hochgenommen, ADS gesperrt, Feuern im angezogenen Zustand gesperrt | ★★★★ | ≈ 5 µs | gunsmith + ballistics (`controller.js`) | P1 |
| F4 | **Freies Zielen** (Option, nur Maus und Gamepad): Totzone aus / leicht 2° / stark 5°. Die Kamera dreht erst am Rand der Totzone. **Schuss aus der Laufrichtung**, Fadenkreuz folgt dem projizierten Laufpunkt (inkl. Objektiv-Abbildung). Beim ADS schrumpft die Totzone über `adsTime`. Touch: aus (verträgt sich nicht mit Zielhilfe) | ★★★★ | 0 | core (`player.js`, `input.js`) + ballistics (Schussrichtung) + gunsmith (Waffe drehen) + ui (Fadenkreuz) | P2 |
| F5 | **Lehnen Q/E**: 14°, seitlich 0,38 m (geduckt 0,30), 0,18 s; Kollision über Strahl bzw. Kugelprüfung zur Kopfposition; **Trefferzonen** des Spielers verschoben (`raycastHitboxes` + `leanOffset`); Halten oder Umschalten. Touch: 2 optionale Knöpfe, später „Auto-Peek“ beim ADS an Deckungskanten | ★★★★ | 0 | core (`player.js`, `input.js`, `combat.js`) + ui (Touch-Knöpfe) + bots (Lehnen der KI, C6) | P1 |
| F6 | **Überklettern** (0,5–1,3 m): Kantensuche über 2 Strahlen beim Sprung gegen ein Hindernis, Kopffreiheit prüfen, 0,35–0,5 s Kurve, Waffe senken; Bots über neuen Nav-Link-Typ `mantle` | ★★★ | 0 | core (`player.js`, `physics.js`) + world (`navbuild.js`) + bots | P2 |
| F7 | **Rückstoß 2.0**: (a) bleibende Kameraänderung (vorhanden), (b) sichtbarer Waffenstoß am Viewmodel, bei freiem Zielen innerhalb der Totzone, (c) Erholung, (d) Streuung des ersten Schusses, (e) Modifikatoren durch Aufsätze (§11.3) | ★★★★ | 0 | ballistics + gunsmith | P1 |
| F8 | **Unterdrückung und Stress** (R18) + optionale **Stress-Nachladung** (unter Beschuss oder bei wenig Leben schneller, aber mit kleiner Wahrscheinlichkeit für einen Fehlgriff +0,3 s, nur im Regelsatz „Realismus“) | ★★★ | 0 | ballistics + gunsmith + core | P3 |
| F9 | **Bodycam-Haltung** als zweites Viewmodel-Preset (tiefer, mittiger, „verdeckt nicht das halbe Bild“), neben der COD-Mobile-Hüftpose (G12/G23 bleibt Standard auf Touch) | ★★★★ | 0 | gunsmith (`viewmodel.js`) | P1 |
| F10 | **Hinlegen** (Z): Kapsel 0,6 m, liegende Trefferzonen, Bot-Animationen | ★★ | – | core + bots | P3 |

### 9.2 Starrkörperphysik

**Empfehlung:** **Rapier 0.21** (`@dimforge/rapier3d`, Apache-2.0) **einmalig** mit esbuild (in `tools/out/npm`) zu einem
ESM-Modul bündeln und unter `assets/vendor/rapier/` ablegen. Das WASM (3,08 MB roh / 1,17 MB gzip) wird separat
per `instantiateStreaming` geladen (`__wbg_set_wasm`). Die Variante „compat“ (WASM als Base64 im JS, 4,3 MB roh /
1,65 MB gzip) ist größer. Grund für das Bündeln: Die npm-Fassung importiert ohne Dateiendung und `.wasm` als
ESM-Modul, das funktioniert im Browser nicht nativ. Lizenz und `NOTICE` in den Vendor-Ordner, Eintrag in `CREDITS.md`.

| # | Maßnahme | Wirkung | Kosten | Besitzer | Prio |
|---|---|---|---|---|---|
| P1 | `engine/rigid.js` (neu): **Laden bei Bedarf** (erst beim ersten Match auf medium+; **low lädt Rapier nie**), fester 60-Hz-Schritt mit Interpolation, Schlafen, Pools. Statische Welt als **Quader-Collider aus den `box()`-Aufrufen des Builders** + konvexe Hüllen für Treppen und Rampen (statt eines großen Trimeshs: viel weniger WASM-Speicher) | Grundlage | +1,2 MB Download, ≈ 5–15 MB WASM-Heap | core (+ world liefert Quader) | P2 |
| P2 | **Kleinteile mit Physik** (Dosen, Eimer, Kanister, Stühle, Kartons): Kugel- und Explosionsimpulse (`impact`/`explosion`-Ereignisse), Spieler schiebt sie weg. **Sie blockieren keine Bewegung und keine Kugeln** (Deckung bleibt statisch, `CapsuleBody` und BVH bleiben unverändert). Max. 40 aktiv auf dem Desktop, 12 auf dem Handy | ★★★★ | ≈ 0,5–1,5 ms CPU | core + world (Markierung `dynamic` in Requisiten) | P2 |
| P3 | **Ragdolls** über Rapier (C3) | ★★★★ | s. o. | bots + core | P2 |
| P4 | **Hülsen und Magazine** (alle Stufen, ohne Rapier): ballistische Partikel mit BVH-Strahl je Bild, Abprall, Liegenbleiben 8–20 s, **Klang je Oberfläche** (`shell_concrete_*` usw. vorhanden); fallengelassenes Magazin beim Nachladen | ★★★ | Instancing, ≈ 0,1 ms | gunsmith (`gunsmith/fx.js`) + ballistics (`effects.js`) + audio | P1 |
| P5 | **Zerbrechliches Glas** (Fensterscheiben als eigene kleine Liste vor dem BVH-Strahl: erst Riss-Decal, dann Splitterpartikel, Scheibe weg, `lineOfSight` frei), **Holzsplitter und Funken** bei Einschlägen | ★★★★ | gering | world (`world/index.js` raycast) + ballistics | P2 |
| P6 | **Türen** (Nachtschicht): Scharniergelenk mit Motor, Spieler drückt sie auf (F), Kugeln durchschlagen Holztüren; KI behandelt Türen als offene Nav-Links, `lineOfSight` prüft Türflächen extra | ★★★★ | 1 Gelenk je Tür | world + core + bots | P2 |
| P7 | **Granaten** bleiben im eigenen Modul (`grenades.js`: Abprall und Reibung funktionieren), dazu Rollen auf Schrägen und Treppen über den BVH-Normalen | ★★ | 0 | ballistics | P3 |

---

## 10. Klang

Grundlage: Prozedurale Engine (Worker-Bank, HRTF, Faltung, `SPACES`) **plus** CC0-Aufnahmen
(`assets/lib/audio/manifest.json`: Gruppen gun/handling/foley/step/impact/fx/amb, Lagen near/far/tail, gemessene Einsätze).

| # | Maßnahme | Wirkung | Kosten Handy | Besitzer | Prio |
|---|---|---|---|---|---|
| A1 | **Hybride Waffenstimmen**: Nah = Aufnahme (`gun_*`, 3–4 Varianten, ±3 % Tonhöhe), Mechanik-Schicht (`handling`) nur nah, Fern = `gunfar_*`, Hallfahne = `guntail_*` passend zu innen und außen, prozeduraler Tiefbass-„Punch“ für Kopfhörer; Schalldämpfer-Varianten (`gunsup_*`) | ★★★★★ | Dekodieren gestaffelt, low mono 22–32 kHz | audio (`engine/audio/sfx-weapons.js`, `bank.js`) | P0 |
| A2 | **Raumgitter** (aus demselben Bake wie R5): je Zelle Deckenhöhe, mittlere freie Weglänge, Offenheit → Wahl von Hall und Fahne für **Quelle und Hörer getrennt** (Schuss im Raum, Hörer draußen klingt anders als umgekehrt) | ★★★★★ | ≈ 0 (Tabellenabfrage) | audio + world (`world/probes.js`) | P0 |
| A3 | **Frühreflexionen**: je lautem Ereignis 4 Reflexionen aus den Wandabständen der Zelle → Mehrfach-Delay mit Panorama, dazu die vorhandene Faltungsfahne. **Fahne begrenzen** (Lehre aus Bodycam v0.8): Außen ≤ 1,5 s, Hallen ≤ 2,5 s | ★★★★ | wenige Knoten je Ereignis | audio (`engine/audio/space.js`, neu `reflect.js`) | P1 |
| A4 | **Beugung um Ecken**: verdeckte laute Quellen nehmen den Weg über den Nav-Graph (A* vorhanden, Ergebnis zwischenspeichern): scheinbare Richtung aus dem ersten Wegknoten, Zusatzstrecke für Verzögerung und Dämpfung, Tiefpass je Ecke | ★★★★ | gedrosselt, nur Schüsse und Explosionen | audio + world (`nav.findPath`) | P2 |
| A5 | **Überschallknall + Mündungsknall**: Gewehrkugeln am Kopf vorbei (`bullet:whiz`) → scharfer Knall zuerst, Mündungsknall verzögert um Abstand / 343 m/s (Schalllaufzeit gibt es schon) | ★★★★ | 0 | audio | P1 |
| A6 | **Ohrenklingeln**: nahe Explosion, Blendgranate oder Schüsse in engen Räumen → Tiefpass auf dem Master + 3,5–4-kHz-Ton mit langsamem Abklingen, Dosis-Modell; Option „Gehörschutz“ mildert | ★★★★ | 1 Filter | audio | P1 |
| A7 | **Foley**: Ausrüstungsklappern nach Tempo, Kleidungsrascheln bei schnellem Umsehen, Atmen nach dem Sprint, Schmerzatmung, Schritte über Aufnahmen (`step/*`, 25 Dateien) je Oberfläche, auch für Bots | ★★★★ | gering | audio (`sfx-foley.js`) | P1 |
| A8 | **Mischung**: Bus-Kompressor und Limiter, „HDR-Audio“ (laute Ereignisse ducken leise), Presets **Kopfhörer / Lautsprecher / Handy** (Handy: Hochpass 150 Hz + Präsenzanhebung, damit Schritte hörbar bleiben) | ★★★ | gering | audio + core (Einstellung `audioMix`) | P1 |
| A9 | **Speicher**: dekodiert ≤ 25 MB auf low (mono, nur Klänge der aktuellen Karte und Ausrüstung), ≤ 60 MB Desktop; Stimmen max. 24 Handy / 48 Desktop; HRTF nur Desktop (wie heute) | – | – | audio | P0 |
| A10 | **Fehlende CC0-Aufnahmen** beschaffen (gleiches Verfahren wie `docs/AUDIO_SOURCES.md`): Glasbruch, Tür, Blendgranate, Rauchgranate (Zischen), Erkennungsmarke (Klimpern), Treffer auf Schutzweste, Regen (optional); Bomben-Piepen prozedural | ★★★ | +0,5–1 MB | audio | P1–P2 |

---

## 11. Inhalte

### 11.1 Neue Spielmodi (owner ui: `modes/*`, `shared/modes.data.js`; KI: bots)

| id | Name | Regeln (Vorschlag) | Bodycam-Pendant | Aufwand | Prio |
|---|---|---|---|---|---|
| `hp` | **Stellung** | eine Zone gleichzeitig, wechselt alle 60 s, 1 Punkt/s, 250 Punkte; nutzt die Eroberungslogik von `dom` | Hardpoint | S | P1 |
| `kc` | **Abschuss bestätigt** | Erkennungsmarken fallen; Gegnermarke = bestätigt (Punkt), eigene = verweigert; 65 Bestätigungen | – | S–M | P1 |
| `inf` | **Infiziert** | Start mit 1 Infiziertem (Messer, Haftgranate, schneller); getötete Überlebende werden infiziert; Runden à 3 min; Überlebende bekommen zufällige Waffen | – | M | P1 |
| `sd` | **Suchen & Zerstören** | 5 gegen 5 (frei einstellbar), **Runden ohne Respawn**, Sprengsatz legen (5 s) an A/B, entschärfen (7 s), Zünder 40 s, Seitenwechsel zur Hälfte, Sieg mit 6 von 11; Zuschauerkamera bei Teamkameraden | Body Bomb / Wingman | L (Rundensystem, Zuschauer, KI-Rollen) | P2 |
| `gf` | **Gunfight 2v2** | kleine Arena (abgegrenzte Bereiche bestehender Karten oder kleine neue Karte), gleiche zufällige Ausrüstung für alle, alle 2 Runden neu; 40 s + Flagge in der Verlängerung; Sieg mit 6 Runden; nutzt das Rundensystem von `sd` | Wingman (2v2) | M (nach `sd`) | P2 |
| `ctf` | **Flaggenjagd** | je Team eine Flagge; nur mit eigener Flagge an der Basis einnehmen; 3 Eroberungen / 10 min | – | M–L (Träger-, Begleit-, Jäger-Rollen der KI) | P2 |
| Regelsatz | **„Realismus“** (Schalter in der Lobby, für tdm/ffa/hp/sd/gf) | kein Fadenkreuz, reduziertes HUD (keine Minikarte, keine Munitionszahl, Killfeed ohne Waffe), Schaden ×2,5 (Kopf immer tödlich), **keine Regeneration**, stattdessen Verband (3 s halten), Gliedmaßentreffer lassen bluten, Respawn 6 s | Kernerlebnis von Bodycam | S–M | **P1** |
| `wave` | **Belagerung** (optional) | Koop-Wellen gegen Bot-Trupps, Munitionskisten | Zombies (ohne Zombies) | M | P3 |

Rundensystem (`modes/rounds.js` neu): Rundenstatus, Kaufphase entfällt, Sieg nach Runden, Zuschauerkamera
(`player` + `hud`), `match:round`-Ereignis (additiv, im Changelog dokumentieren).

### 11.2 Waffen auf 25 erweitern (owner ballistics: `weapons.data.js`; Modelle: gunsmith; Klang: audio; Website-Arsenal: site)

Alle Namen sind erfunden (keine echten Marken und Modellnummern). Die Modelle entstehen prozedural im Gunsmith-Baukasten
(`guns-*.js`) mit Fotoscan-Materialien (M5). **Ehrlich gesagt:** Fotorealistische CC0-Waffenmodelle sind kaum zu bekommen
(Poly Haven: nur `bolt_action_rifle_7_62`, `service_pistol`, `stick_grenade`). Nahaufnahmen leben deshalb von Materialien,
Fasen und Normal-Map-Details.

| neu | id (Vorschlag) | Name | Klasse | Muster | Klangprofil |
|---|---|---|---|---|---|
| 1 | `ar_kv74k` | KV-74K | Sturmgewehr (Karabiner) | kurzer AK-Karabiner | `ar` |
| 2 | `ar_st5` | ST-5 Stahl | Sturmgewehr | Polymer, Tragegriff-Optik | `ar` |
| 3 | `br_fl58` | FL-58 Wächter | Kampfgewehr (neu `br`) | 7,62, halbautomatisch und automatisch | `ar_heavy` |
| 4 | `smg_ux` | UX Biene | MP | kompakte Teleskopverschluss-MP | `smg` |
| 5 | `smg_kn45` | KN-45 | MP | Polymer, .45 | `smg` |
| 6 | `smg_vx10` | VX-10 Wirbel | MP | sehr hohe Kadenz | `smg` |
| 7 | `mp_p9a` | P-9A | Reihenfeuerpistole (sekundär) | automatische Pistole | `pistol` |
| 8 | `pi_baer` | Bär .357 | Pistole (Revolver) | Trommelrevolver | `pistol_heavy` |
| 9 | `sg_sturmbock` | Sturmbock 12 | Schrotflinte | halbautomatisch | `shotgun` |
| 10 | `sg_zwilling` | Zwilling | Schrotflinte | Doppelflinte | `shotgun` |
| 11 | `mr_dr7` | DR-7 Speer | Präzisionsgewehr | halbautomatisch, lange Optik | `ar_heavy` |
| 12 | `sr_elster` | Elster .308 | Scharfschützengewehr | leichtes Repetiergewehr | `sniper` |
| 13 | `lmg_lk5` | LK-5 Riegel | LMG | leichtes Gurt-/Magazin-MG | `lmg` |
| 14 | `melee_beil` | Kampfbeil | Nahkampf | – | `melee_swing` |

Zusammen mit dem Bestand (10 Schusswaffen + Kampfmesser) ergibt das **23 Schusswaffen + 2 Nahkampfwaffen = 25**.
Neuer Ausrüstungsplatz **`tactical`**: **Blendgranate** (Weißblende über die Belichtung R4, Ohrenklingeln A6, Bots
geblendet) und **Rauchgranate** (Partikelvolumen; `world.lineOfSight` und die Bot-Wahrnehmung prüfen Rauchkugeln).
Waffenspiel-Stufen und Freischaltungen (`UNLOCKS`) werden neu verteilt.

### 11.3 Aufsatzsystem (≈ 48 Aufsätze, 8 Plätze, max. 5 je Waffe wie in COD Mobile)

- **Daten:** neues reines Datenmodul `shared/attachments.data.js` (Website nutzt es):
  `ATTACHMENTS[id] = { id, name, slot: 'optic'|'muzzle'|'barrel'|'underbarrel'|'laser'|'light'|'magazine'|'stock', rails: ['picatinny'|'ak'|'mp'|…], classes, mods: { adsTime: ×, 'recoil.vertical': ×, hipSpread: ×, range: ×, moveSpeedMult: ×, mag: n, reloadTime: ×, suppressed, scope: {zoom, overlay} }, model, unlock: { weaponLevel } }` +
  reine Funktion **`applyAttachments(def, ids) → abgeleitete def`** (Controller, Bots und das Website-Arsenal rechnen gleich).
- **Plätze und Beispiele:** Optik (Reflexvisier, Holo, 2×, 3× Prisma, 4×, 6×, 8×, Schrägvisier), Mündung (Schalldämpfer leicht und
  schwer, Kompensator, Mündungsfeuerdämpfer, Mündungsbremse), Lauf (kurz, lang, schwer), Unterlauf (Vertikal-, Winkel-,
  Stummelgriff, Zweibein), Laser (sichtbar: Hüftstreuung −), Licht (Waffenlicht 500 / 1000 lm → R9), Magazin (erweitert,
  Schnellwechsel, Trommel), Schaft (ohne, leicht, schwer).
- **Modelle:** `createWeaponModel(key, { lod, attachments })`, `userData.mounts = { optic, muzzle, underbarrel, side, magazine, stock }`
  (gunsmith); Aufsätze als eigene kleine Modelle, gecacht.
- **Fortschritt:** Waffenstufen aus `profile.weaponStats` (neu `xp` je Waffe, core `shared/profile.js`), Ausrüstung
  `loadout.attachments: { [weaponId]: [ids] }`.
- **UI:** Waffenschmiede in der Lobby mit 3D-Vorschau (ui; Wiederverwendung des Arsenal-Viewers der Website) und Statusbalken vorher/nachher.
- **Klang:** gedämpfte Profile (`suppressed`, Aufnahmen `gunsup_*`), Mündungsbremse lauter und heller (Filter).

### 11.4 Neue dunkle Innenraumkarte „Nachtschicht“ (owner world; Manifest-Schlüssel heute `innenraum`)

- **Konzept:** verlassenes Verwaltungs- und Klinikgebäude bei Nacht, Strom teilweise ausgefallen. Flackernde
  Leuchtstoffröhren (Baukasten `mounted_fluorescent_lights`), rote Notbeleuchtung, Mondlicht durch Fenster, nasser Hof
  mit Natriumlampe. Material- und Requisitenliste steht schon im Manifest (Linoleum, Teppich, Bürodecke, Fliesen,
  Tapete, Schreibtische, Betten, Fernseher, Regale, „Rutschgefahr“-Schild …).
- **Aufbau:** ≈ 56 × 40 m, 2 Etagen + Keller, 3 Wege (Westflur, mittleres Treppenhaus/Atrium, Ostflügel mit Stationen),
  Türen (P6), Fenster (P5), viele kurze Sichtlinien, zwei lange Flure als Scharfschützen-Achsen.
- **Licht:** fast alles gebacken (R5 Lichtgruppen: Röhren, Notlicht, Mond), **dynamisch nur** Spielerlampe (mit
  Schatten) + max. 3 Bot-Lampen + Mündungsfeuer (R9-Pool) → läuft auch auf Handys. HDRI `burnt_warehouse` bzw.
  `debris_basement_corridor` für innen, `cobblestone_street_night` für draußen.
- **Modi:** tdm, ffa, hp, kc, sd, gf, inf. **Taschenlampe**: Taste T bzw. Touch-Knopf, startet an.
- **Bots:** Lampe an beim Suchen, aus beim Lauern (je nach Schwierigkeit), reagieren auf fremde Lichtkegel.

---

## 12. Steuerung

| # | Maßnahme | Wirkung | Besitzer | Prio |
|---|---|---|---|---|
| S1 | **Freie Belegung** für Tastatur, Maus und Gamepad: reines Datenmodul `shared/bindings.data.js` (Standards; vom Website-Bereich „Steuerung“ ausdrücklich gewünscht, siehe Changelog site), Überschreibungen in `settings.bindings`, Erfassen per „Taste drücken …“, Konflikte markiert, „Zurücksetzen“ | ★★★★★ | core (`input.js`) + ui (Einstellungen) + site (`controls-view.js`) | P1 |
| S2 | **Neue Standardbelegung** (Bodycam-nah): Q/E Lehnen, G Granate (Q entfällt), X Taktisch, T Lampe/Laser, F Interagieren/Tür, V Nahkampf, C Ducken, Z Hinlegen (später). Gamepad: Lehnen über Stick-Klick + Richtung oder Steuerkreuz (frei belegbar) | ★★★★ | core + site + ui (Hilfen) | P1 |
| S3 | **Halten / Umschalten** je Aktion: Zielen, Sprint, Ducken, Lehnen | ★★★★ | core + ui | P1 |
| S4 | **Empfindlichkeit**: Grundwert, **ADS je Zoombereich** (1×, 2–4×, ≥ 6×), Zoom-Koeffizient (Monitorabstand 0/75/100 %), Y-Faktor; Pointer-Lock mit `unadjustedMovement` ist schon da; zusätzlich `pointerrawupdate` (Chromium) und **Late-Latching** (Blick erst direkt vor dem Rendern anwenden) | ★★★★ | core (`input.js`, `player.js`) | P1 |
| S5 | **Gamepad**: innere und äußere Totzone, Kurve (linear / klassisch / dynamisch), Rumble über `vibrationActuator` bei Treffern, Zielhilfe-Stärke | ★★★ | core | P1 |
| S6 | **Gyro-Zielen** (Handy): `devicemotion` `rotationRate`, Modi aus / nur beim Zielen / immer, Empfindlichkeit X/Y, Ausrichtung über `screen.orientation.angle`, 1-Euro-Filter + kleine Totzone; iOS: `DeviceMotionEvent.requestPermission()` aus einer Nutzergeste | ★★★★ (Handy) | core (`input.js`) + ui | P1 |
| S7 | **Touch-Layout-Editor**: Knöpfe verschieben, skalieren, Deckkraft; Raster, Safe Areas; Presets „Standard“, „Klaue (3 Finger)“, „Linkshänder“; gespeichert je Seitenverhältnis (`settings.touchLayout`); zusätzlich Knöpfe Zielen+Feuern, Lehnen, Lampe | ★★★★★ (Handy) | ui (Editor, `game.css`) + core (Eingabe liest DOM-Positionen) | P1 |
| S8 | **Komfort und Zugänglichkeit**: Regler Kamerabewegung, Objektivstärke, Körnung, Bewegungsunschärfe, FOV; farbenblind-freundliche Gegnermarkierung | ★★★ | ui + core | P1 |
| S9 | **„Erweitert“-Grafikseite**: Schatten, Texturen, AO, Volumetrik, Bewegungsunschärfe, Objektiv, Auflösungsskala, Hochskalierer (aus/FSR1), Bildratenbegrenzung (30/60/frei), Sichtweite, Effekte, **Live-Anzeige des Grafikspeichers** (§4.4 Nr. 8) | ★★★★ („PC-Spiel“) | ui + core | P1 |

---

## 13. Fahrplan

Aufwand: S ≤ 1 Agententag, M 2–4, L ≥ 5. Abhängigkeiten in Klammern.

### Phase A – „Look“ (P0/P1, zuerst, größte Wirkung je Millisekunde)
1. **A-1** Asset-Integration: M1, M5, G1, G2, R1 (läuft: Pipeline) — world, gunsmith, Assets — L
2. **A-2** Objektiv-Pass + AgX/LUT + Einstellungen (R2, R3, §5.3) — core — M (danach ui/bots: `lens.toScreen` in HUD und Namensschildern, S)
3. **A-3** Automatische Belichtung (R4) — core + world — M
4. **A-4** Sonden-Gitter Licht + Akustik (R5, A2) — world (+ audio liest) — L
5. **A-5** Höhennebel, Staub, Spekular-AA, Unterdrückung (R6, R14, R18) — world, ballistics, core — M
6. **A-6** FSR1 bei dynamischer Auflösung (R12) — core — S–M
7. **A-7** Kaskadenschatten mit Zwischenspeicher (R8) — world + core — M

### Phase B – „Gefühl und Steuerung“ (parallel zu A ab A-2)
1. **B-1** Körperkamera, Waffenträgheit, Bodycam-Haltung (F1, F2, F9) — core, gunsmith, ballistics — M
2. **B-2** Waffenkollision, Rückstoß 2.0 (F3, F7) — gunsmith, ballistics — M
3. **B-3** Belegung, Halten/Umschalten, Empfindlichkeiten, Gamepad (S1–S5) — core, ui, site — M
4. **B-4** Lehnen (F5) inkl. Trefferzonen und Touch-Knöpfen — core, ui — M; Bot-Lehnen (C6) — bots — M
5. **B-5** Gyro und Touch-Layout-Editor, Erweitert-Grafikseite (S6, S7, S9) — core, ui — M

### Phase C – „Klang“ (parallel, eigener Besitzer)
1. **C-1** Hybride Waffenstimmen, Schritte, Speichergrenzen (A1, A7, A9) — audio — M
2. **C-2** Frühreflexionen, Überschallknall, Ohrenklingeln, Mischung (A3, A5, A6, A8; braucht A-4) — audio — M
3. **C-3** Beugung über den Nav-Graph, fehlende Aufnahmen (A4, A10) — audio — M

### Phase D – „Inhalt“
1. **D-1** Regelsatz „Realismus“, Stellung, Abschuss bestätigt (§11.1) — ui, bots — M
2. **D-2** Aufsatzsystem (Daten, Modelle, Waffenschmiede) (§11.3) — ballistics, gunsmith, ui, core (Profil), site — L
3. **D-3** 13 neue Waffen + Kampfbeil + Blend- und Rauchgranate (§11.2) — ballistics, gunsmith, audio, site — L
4. **D-4** Karte „Nachtschicht“ + Taschenlampen + Türen und Glas (§11.4, R9, P5, P6) — world, core, bots — L
5. **D-5** Infiziert; Rundensystem → Suchen & Zerstören → Gunfight; Flaggenjagd — ui, bots — L

### Phase E – „Physik und Figuren“ (P2)
1. **E-1** Rapier-Modul, Kleinteile, Ragdoll 2.0 (P1–P3, C3) — core, world, bots — L
2. **E-2** Hülsen und Magazine Physik-lite (P4; kann früher) — gunsmith, ballistics — S
3. **E-3** Figuren C1/C2 (P1), dann C4/C5 — bots, gunsmith, Assets — M/L
4. **E-4** Bewegungsunschärfe, AO aus der Tiefe, TAA, Volumetrik, Pfützen/SSR (R10, R11, R13, R15, R17) — core, world — L

### Phase F – Ausblick (P3)
Hinlegen, Stress-Nachladung, Zielfernrohr als Bild-im-Bild, Nachtvarianten weiterer Karten, „Belagerung“,
Parallax Occlusion, **WebGPU-Bewertung** (§3).

**Reihenfolge-Begründung:** Phase A und B ändern den Ersteindruck am stärksten und laufen auch auf Handys. C hat einen
eigenen Besitzer und kann parallel laufen. D bringt Umfang, braucht aber stabile Grundlagen (Aufsätze → Modelle → Waffen).
E ist teuer und auf Handys nur teilweise sichtbar.

**Vertragsregeln während der Umsetzung:** jede neue Datei in die modulepreload-Liste (`node tools/preload.mjs`);
neue Addons aus three@0.186.1 `examples/jsm/` an denselben Pfad kopieren (z. B. `csm/`, `postprocessing/LUTPass.js`,
`loaders/LUTCubeLoader.js`); jede API-Erweiterung **additiv** und im Changelog; Dev-Harness-Seiten unter `dev/`
(z. B. `dev/post.html` für Objektiv/Belichtung, `dev/physics.html` für Rapier).

---

## 14. Messung und Abnahme

- **Budgets automatisch prüfen:** neues `tools/budget.mjs` (Playwright, je Stufe und Karte): Download =
  Summe von `transferSize` aus Resource Timing inkl. dynamischer Importe; GPU = `renderer.memoryEstimate()`;
  Abbruch bei Überschreitung von §4. In `tools/smoke.mjs` als Option `--budget`.
- **Bildrate:** Desktop high ≥ 60 FPS, Handy low ≥ 30 FPS (Vertrag §11). Jede neue Funktion meldet ihre Kosten im
  `debug=1`-Overlay (GPU-Zeitmessung über `EXT_disjoint_timer_query_webgl2`, wo vorhanden).
- **Echte Geräte:** Playwright-Mobilemulation ersetzt keine Handy-GPU. Vor jeder Phase einmal auf einem
  Android-Mittelklassegerät (Adreno 6xx) und einem iPhone 11–13 messen: FPS, Wärme nach 10 min, Speicher (Safari Web Inspector).
- **Vergleichsbilder:** `tools/stills.mjs` mit festen Kamerapunkten je Karte, vorher/nachher, Stufe low und ultra.
- **Komfort:** jede Kamerabewegung hat einen Regler; `reducedMotion` wird respektiert; Testpersonen 15 min ohne Übelkeit.
- **Lizenzen:** nur CC0 (bevorzugt) oder CC-BY mit exakter Nennung in `CREDITS.md`; Code-Bibliotheken nur mit
  permissiver Lizenz (Rapier Apache-2.0, FSR1 MIT, N8AO ISC); nichts mit NC/ND.

---

## 15. Quellen

- [s-wiki]: https://en.wikipedia.org/wiki/Bodycam_(video_game) — Entwickler, UE5, Early Access, UE5.5-Umstieg, Fischauge, CA, verpixelte Gesichter, prozeduraler Rückstoß, Modi, v0.8.
- [s-steam]: https://store.steampowered.com/app/2406770 — Beschreibung, „True Body“, Stress-Reloads, Aufsätze, Ragdoll-Stolpern, Audio-Ausbreitung, Modi, Systemanforderungen.
- [s-80lv-dev]: https://80.lv/articles/developing-a-game-with-realistic-graphics-in-unreal-engine/ — Interview: Fischauge als Post-Process, Rand als Bild vor der Kamera, CA und Rauschen, Lumen + HDRIs, Megascans, „Bild verschlechtern“, Ballistik.
- [s-80lv-play]: https://80.lv/articles/bodycam-a-ue5-powered-fps-with-hyperrealistic-graphics-is-inviting-playtesters/ — Fischauge-Perspektive, Ragdoll.
- [s-superjump]: https://www.superjumpmagazine.com/bodycams-unique-perspective-demands-your-attention/ — Waffenschwanken, Klang, Reiseübelkeit, Freund und Feind.
- [s-gamesgg]: https://games.gg/bodycam/ — Ausbreitung und Verdeckung beim Klang.
- [s-mp1st]: https://mp1st.com/news/bodycam-trailer-for-upcoming-multiplayer-fps-features-maps-from-counter-strike-and-call-of-duty — Kartennachbauten.
- [s-2up]: https://2upskill.com/bodycam-v0-8-locked-and-loaded-patch-notes-massive-realism-overhaul-trenches-map-and-weapon-customization-guide/ — (Dritte) v0.8: True Body, Stress-Reloads, Stolpern, Audio, Aufsatzkategorien.
- [s-jeu]: https://jeu.video/en/article/bodycam-patch-notes-v0-8-7-makes-matches-longer-disables-zombie-mode — (Dritte) Modusänderungen in v0.8.
- [s-powerup]: https://powerupgaming.co.uk/2026/09/03/bodycam-best-new-weapons-locked-loaded/ — (Dritte) neue Waffen, Karten.
- [s-dtgre]: https://www.dtgre.com/2026/09/bodycam-controls-guide-2026-best-keybinds-sensitivity-combat-controls.html — (Dritte) Standardbelegung, Halten/Umschalten, festes FOV.
- [s-pixel-audio]: https://pixelnitro.com/?p=17306 — (Dritte) Hall- und Echo-Beschwerden nach v0.8.
- [s-ue-cam]: https://forums.unrealengine.com/t/distant-sky-bodycam-realistic-camera-system/2834265 — typische Bodycam-Kameraeffekte in UE-Vorlagen.
- Technik: three.js r186 (lokal geprüft: `AgXToneMapping`, `NeutralToneMapping`, `VSMShadowMap`, `examples/jsm/csm/CSM.js`,
  `postprocessing/LUTPass.js`, `loaders/LUTCubeLoader.js`, `UnsignedInt101111Type` → `R11F_G11F_B10F`, TSL-Nodes nur für WebGPU);
  Rapier 0.21 (`@dimforge/rapier3d`, Apache-2.0, WASM 3,08 MB / 1,17 MB gzip, lokal gemessen); GitHub Pages gzip für
  `application/wasm` (an `threejs.org`, GitHub Pages, geprüft); KTX2Loader-Prioritäten (ETC2 > ETC1 > BC7 > BC1, lokal geprüft).

[s-wiki]: https://en.wikipedia.org/wiki/Bodycam_(video_game)
[s-steam]: https://store.steampowered.com/app/2406770
[s-80lv-dev]: https://80.lv/articles/developing-a-game-with-realistic-graphics-in-unreal-engine/
[s-80lv-play]: https://80.lv/articles/bodycam-a-ue5-powered-fps-with-hyperrealistic-graphics-is-inviting-playtesters/
[s-superjump]: https://www.superjumpmagazine.com/bodycams-unique-perspective-demands-your-attention/
[s-gamesgg]: https://games.gg/bodycam/
[s-mp1st]: https://mp1st.com/news/bodycam-trailer-for-upcoming-multiplayer-fps-features-maps-from-counter-strike-and-call-of-duty
[s-2up]: https://2upskill.com/bodycam-v0-8-locked-and-loaded-patch-notes-massive-realism-overhaul-trenches-map-and-weapon-customization-guide/
[s-jeu]: https://jeu.video/en/article/bodycam-patch-notes-v0-8-7-makes-matches-longer-disables-zombie-mode
[s-powerup]: https://powerupgaming.co.uk/2026/09/03/bodycam-best-new-weapons-locked-loaded/
[s-dtgre]: https://www.dtgre.com/2026/09/bodycam-controls-guide-2026-best-keybinds-sensitivity-combat-controls.html
[s-pixel-audio]: https://pixelnitro.com/?p=17306
[s-ue-cam]: https://forums.unrealengine.com/t/distant-sky-bodycam-realistic-camera-system/2834265
