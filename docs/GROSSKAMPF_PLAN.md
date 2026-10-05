# NULLPUNKT — Großkampf-Plan (große Karten, Fahrzeuge, 32 gegen 32)

Stand: 2026-10-05 · Rolle: Chefarchitekt (Zusammenführung von drei unabhängigen Vorschlägen) ·
Status: **verbindlicher Plan, noch nichts davon umgesetzt**.

Grundlage: `docs/ARCHITECTURE.md` (Vertrag und Changelog) und `docs/REALISM_PLAN.md` (genehmigt, Welle 1 läuft).
Dieses Dokument ändert keinen Vertrag. Jede Umsetzung trägt ihre API-Erweiterungen wie gewohnt **additiv** ins
Changelog ein (§12). Wo es Werte oder Prioritäten aus dem REALISM_PLAN berührt, steht das ausdrücklich in §13, mit der Item-ID.

> **Nutzerwunsch (2026-10-05):** „Macht die Maps noch größer, dass man da auch Panzer und sowas spielen kann,
> Flugzeuge theoretisch auch noch … wie Battlefield … grafisch einfach nochmal kranker als Battlefield … mehr Waffen,
> bessere Spielmechaniken, ein paar Easter Eggs, mehr Granaten, mehr Messer, mehr Skins, mit mehr Bots spielen,
> bis zu 32 auf beiden Seiten.“

**Begriffe:**

| Begriff | Bedeutung |
|---|---|
| **Arena-Karte** | die heutigen Karten mit ≈ 100 m (Hafen, Altstadt, Werk, Schießstand, geplant Nachtschicht) |
| **Großkarte** | neue Kartenklasse mit Höhenfeld-Gelände (Grenzland 0,5 km, Talsperre 1,2 km) |
| **Ortschaft (POI)** | bebauter Bereich einer Großkarte (Dorf, Kraftwerk, Staudamm …), gebaut vom vorhandenen `MapBuilder` |
| **S0 / S1 / S2** | Simulationsstufen der Bots: voll, reduziert, strategisch (§7.1) |
| **VAT** | Animation als Textur gebacken, auf der GPU abgespielt (Masse vieler Soldaten in 1 Draw Call) |
| **Impostor** | Bild-Ersatz eines 3D-Objekts in großer Entfernung |
| **HLOD** | ein vereinfachtes Ersatzmodell für eine ganze Ortschaft |
| **PVS** | vorberechnete Tabelle, welche Kartenzelle welche andere sehen kann |
| **CDLOD** | Gelände-Verfahren: ein Gitterstück wird je nach Entfernung in Stufen instanziert und weich überblendet |
| **HQ** | nicht einnehmbare Basis eines Teams |
| **Agententag** | Aufwandseinheit wie im REALISM_PLAN §13 (S ≤ 1, M 2–4, L ≥ 5) |

---

## 0. Kurzfassung

1. **Battlefield fühlt sich nicht wegen der Kartengröße so an**, sondern wegen eines Kreislaufs: Flaggen nehmen →
   sterben → beim Trupp wieder einsteigen → Fahrzeug nehmen → zerstören → wiederbeleben. Dieser Kreislauf wird zuerst
   gebaut. Die Reihenfolge ist: Fundament und Messung, dann Eroberung zu Fuß auf der mittleren Karte **„Grenzland“**
   (0,5 km), dann Bodenfahrzeuge auf der Großkarte **„Talsperre“** (1,2 × 1,0 km), dann Hubschrauber, zuletzt Jets.
2. **32 gegen 32** bedeutet 63 Bots plus Spieler. Das ist der **Standard am PC**. Auf Handys ist **12 gegen 12** voreingestellt.
   Der Regler geht auch dort bis 32 gegen 32, mit zwei Warnstufen. Möglich wird das durch drei KI-Stufen (S0/S1/S2) und
   eine instanzierte Soldaten-Masse. **Harte Vorbedingung:** 63 Bots auf Hafen in ≤ 2,5 ms je Bild. Heute sind es
   Ø 2,5–4,7 ms, mit Spitzen bis 284 ms.
3. **Welt:** Höhenfeld mit CDLOD (1 Draw Call), gebackenes Licht im Gelände, instanzierte Vegetation mit Impostoren,
   Ortschaften aus dem vorhandenen `MapBuilder` mit HLOD, Sichtbarkeitstabelle (PVS). Die World-API bleibt eine Fassade:
   `raycast`, `lineOfSight`, `groundHeight`, `collider` und `nav` behalten ihre Signaturen.
4. **Fahrzeuge:** 8 Typen plus 2 Stellungen: Quad, Geländewagen, Schützenpanzer, Kampfpanzer, Flakpanzer,
   Transporthubschrauber, Kampfhubschrauber, Jet. Dazu kommt ein Spaß-Traktor als Easter Egg. Die Physik ist eine
   **eigene, schlanke JS-Fahrzeugsimulation auf allen Stufen**, ohne Rapier. Damit bleibt REALISM_PLAN §9.2
   („low lädt Rapier nie“) gültig.
5. **Bessere Spielmechaniken:** Eroberung mit Tickets, 4er-Trupps, Einsatzbildschirm, 4 Klassen mit 16 Gadgets,
   Zustand „am Boden“ mit Wiederbelebung, Markieren und Kommando-Rad, Niederhalten, Fernballistik mit Flugzeit und
   **„Visier-Nullpunkt“**, Hinlegen, Fallschirm, Kampfgebietsgrenze, Teilzerstörung, Killcam, Messer-Takedowns.
6. **Inhalte:** **33 Schusswaffen** (10 mehr als REALISM_PLAN §11.2), 5 Werfer, **8 Nahkampfwaffen**, **10 Wurfmittel**,
   **60 Waffentarnungen**, 24 Operator-Outfits, 12 Fahrzeugtarnungen, 16 Anhänger, Tages- und Wochen-Herausforderungen,
   Meisterschaft und **12 Easter Eggs**.
7. **Budgets:** Die harten GPU-Grenzen aus REALISM_PLAN §4.1 (160/320/600/1000 MB) gelten auch für Großkarten
   **unverändert**. Nur der Download der ersten Großkarte bekommt eine benannte Ausnahme (§3.5, low ≤ 10 MB statt 7 MB).
8. **Ehrlich:** „Grafisch kranker als Battlefield“ ist nur **aus der Nähe und als eigener Look** erreichbar. In der Ferne
   tragen Nebel und Impostoren das Bild. Auf dem Handy ist es deutlich einfacher. Jets wirken auf 1,2 km eng.
   Gespielt wird gegen Bots, nicht gegen Menschen online (§1).
9. **Aufwand:** ≈ 110–145 Agententage in 5 Wellen plus einer parallelen Inhaltswelle. Früh sichtbar werden
   **mehr Bots auf den Arena-Karten (bis 12 gegen 12)** sowie neue Messer, Granaten und Tarnungen.

---

## 1. Ehrlicher Rahmen: was im Browser nicht wie Battlefield wird

| Battlefield (6 / 2042) | NULLPUNKT im Browser | Folge für den Spieler |
|---|---|---|
| 64 Menschen online, 2042 bis 128 | **offline gegen Bots**: GitHub Pages hat keinen Server, kein Online-Modus in diesem Plan | Das Gefühl hängt an der Bot-KI (Trupps, Teamhirn, Fahrzeug-KI, §7) |
| große Karten 1,5–2,5 km lang (Bandar Desert in BF3: ≈ 1,9 km zwischen den Basen) | 1,2 × 1,0 km spielbar, Kulisse bis 3,2 km, Luftraum für Jets 2,4 km | Für Panzer und Hubschrauber reicht das. Jets queren die Karte in 6–10 s und wirken eng |
| Frostbite: GPU-getriebenes Rendering, Virtual Texturing, dynamisches Licht, große Zerstörung | WebGL2/three r186: keine Compute-Shader, gebackenes Licht, Impostoren, **vorgefertigte Teilzerstörung** | Die Ferne wirkt einfacher. Große Gebäude stürzen nicht ein |
| Sicht über mehrere km, dichte Vegetation bis zum Horizont | Sicht 350 m (Handy) bis 1,5 km (Ultra), Höhennebel und Luftperspektive verdecken die Schnittebene | Fernsicht „im Dunst“; Gras nur in der Nähe |
| 8–16 GB Grafikspeicher | 160 MB (Handy) bis 1 GB (Ultra), REALISM_PLAN §4.1 | Texturen 512–2048, wenige Ortschaften in voller Auflösung gleichzeitig |
| Profi-Fahrzeugmodelle, Motion-Capture | prozedurale Modelle mit CC0-Fotoscan-Materialien, prozedurale Animation | aus der Nähe „sauber“ statt verschmutzt-komplex |
| native Fahrzeugsimulation | Arcade-Physik mit Federstrahlen, Hubschrauber und Jets mit Zielführung („Instruktor“) | kein Simulator, aber auf Touch fliegbar |

**Was wir besser machen können als Battlefield:** den Bodycam-Look (Objektiv, Körnung, automatische Belichtung,
REALISM_PLAN R2–R4), Fotoscan-Materialien in der Nähe (M1), echte Klangaufnahmen mit Schalllaufzeit und einem
Klangteppich der fernen Schlacht (§9). Dazu kommt: Es läuft sofort im Browser, ohne Installation, auch auf dem Handy.

**Aussage zu „grafisch kranker“:** Aus der Nähe und in Bewegung erreicht NULLPUNKT einen eigenen, sehr echten Look.
In Standbildern aus der Ferne kommt er nicht an Frostbite heran. Das Ziel heißt „anders echt“, nicht „mehr Pixel als
Battlefield“. Das muss dem Nutzer vor der Umsetzung so gesagt werden (Antworttext unten).

---

## 2. Messbasis heute

Gemessen wurde in headless Chromium (SwiftShader) auf einer geteilten Container-CPU (2,1 GHz Xeon). Die CPU-Werte
zeigen nur die Verhältnisse, die GPU-Werte sagen nichts aus. Die Skripte liegen in `tools/out/design/`
(`botcost.mjs`, `drawcalls.mjs`, `worldstats.mjs`). Zusätzliche Bots kamen über `G.debugApi.spawnBots(48)`.

| Größe | Wert |
|---|---|
| Arena-Karte | 96–104 m, 120–195 k Dreiecke, 33–44 Meshes, Navigation 3 616–4 075 Knoten / 25–29 k Kanten (1,5-m-Raster) |
| Laden | 6–8 s, Welt-Worker 3,0–4,8 s, JS-Heap 123–199 MB |
| `BotManager.update`, 15 Bots | Ø 0,9–1,7 ms, p99 9–13 ms |
| `BotManager.update`, 63 Bots | **Ø 2,5–4,7 ms, p99 9–53 ms, Ausreißer 138–284 ms**; Sichtstrahlen 39–55 je Bild, durch das Budget gedeckelt (Wahrnehmung verhungert) |
| Draw Calls, alle Bots im Bild | low 142 → 341, high 237–244 → 438–444, also **≈ +4,2 je Soldat** |

Ein anderer Vorschlag maß ≈ 0,2 ms für 11 Bots, ohne Animation und ohne Rendern. Die Werte weichen also je nach Skript
ab. Verbindlich wird der neue Prüfstand `tools/perf.mjs` (GK-0.1).

**Folgerungen:**
1. Die erste Grenze ist die Hauptthread-CPU, nicht die GPU. Ein voll simulierter Bot kostet am Desktop ≈ 0,1 ms,
   auf einem Mittelklasse-Handy 2–4× so viel.
2. Die Draw Calls der Soldaten wachsen linear mit ihrer Zahl. 63 voll gerenderte Soldaten passen in kein Handy-Budget.
3. Ein 1,5-m-Navigationsraster ergäbe auf 1,28 km² ≈ 0,55–0,7 Mio. Knoten und ≈ 4–5 Mio. Kanten. Der Kapsel-Octree aus
   `THREE.Triangle`-Objekten (≈ 200 B je Dreieck) skaliert ebenfalls nicht. **Jedes System braucht eine Hierarchie und
   Typed Arrays.**
4. Die Ausreißer über 100 ms müssen vor jeder Skalierung gefunden werden. Verdacht: synchrones A* bis zum Ende auf
   einem Graphen mit 4 k Knoten, `hostilesOf` mit O(n²), Speicherbereinigung durch Allokationen je Bild, Aufbau beim Respawn.

---

## 3. Zielwerte

### 3.1 Kartenklassen

`MAPS[id].scale = 'arena' | 'gross'` (neu, additiv).

| Karte | Klasse | spielbare Fläche | Höhenfeld | Kulisse | Flaggen | Teams max | Fahrzeuge | Welle |
|---|---|---|---|---|---|---|---|---|
| Hafen, Altstadt, Werk, Nachtschicht | arena | ≈ 100 m | – | – | `dom` 3 | **12 v 12** (heute 8 v 8) | keine | GK-0 |
| **Grenzland** (`grenzland`) | gross | 0,48 × 0,48 km | 513² Punkte, 1 m Abstand | Ring bis 1,5 km | 5 | 32 v 32 (empfohlen 16 v 16) | ab GK-2: Floh, Steppe, Igel | GK-1 |
| **Talsperre** (`talsperre`) | gross | **1,2 × 1,0 km** in 1,28 × 1,28 km Gelände | 1025² Punkte, 1,25 m Abstand | Ring bis 3,2 km (16-m-Raster) | 7 + 2 HQ | 32 v 32 | alle | GK-2 |
| **Nordküste** (`nordkueste`) | gross | 1,2 × 1,2 km | wie Talsperre | wie Talsperre | 7 + 2 HQ | 32 v 32 | alle, Boote optional | GK-4 |

- **Talsperre** besteht aus Staudamm, Dorf, Kraftwerk, Steinbruch, Brücke, Funkturm, Gutshof und bewaldeten Graten.
  Die Ränder sind Gebirge und Stausee als natürliche Grenze.
- **Grenzland** entsteht aus Ortsteilen der Arena-Karten (Hafenkante, Altstadt-Gassen, Werkshalle) auf Hügelgelände.
- **Fläche je Spieler:** Talsperre 1,2 km² / 64 ≈ 1,9 ha. Battlefield-Großkarten liegen eher bei 3–6 ha. Wir bleiben
  bewusst dichter: Gefechte sind häufiger, und Bots auf langen Wegen kosten weniger.
- **Luftraum für Jets** (GK-4): 2,4 × 2,4 km, Decke 600 m über dem Kulissenring. Wer ihn verlässt, bekommt eine Warnung,
  nach 5 s wendet der Autopilot.

### 3.2 Teamgrößen je Gerätestufe

Neue reine Funktion `limitsFor(modeId, mapId, tier) → { allies:[min,max], enemies:[min,max], recommended:{allies,enemies}, warn:{yellow,red} }`
in `shared/modes.data.js` (ui). Lobby und Website nutzen sie (`allies` zählt ohne Spieler).

| Stufe | Großkarte: Standard | Großkarte: Maximum | gelbe Warnung ab | rote Warnung („experimentell“) ab | Arena-Karten max |
|---|---|---|---|---|---|
| **low** (Handy) | 12 v 12 | **32 v 32** | 16 v 16 | 24 v 24 | 12 v 12 (gelb ab 9 v 9) |
| **medium** | 16 v 16 (Touch) / 24 v 24 (Desktop) | 32 v 32 | 24 v 24 | – | 12 v 12 |
| **high** | **32 v 32** | 32 v 32 | – | – | 12 v 12 |
| **ultra** | **32 v 32** | 32 v 32 | – | – | 12 v 12 |

- **Warntexte:**
  - gelb: „Für dieses Gerät empfohlen: 12 gegen 12. Mehr Bots können ruckeln und das Gerät warm machen.“
  - rot: „Experimentell: Bei so vielen Bots kann die Bildrate auf diesem Gerät unter 30 FPS fallen.“
- **Harte Grenze** nur bei `navigator.deviceMemory ≤ 2`: höchstens 16 v 16, weil sonst der Tab abstürzen kann.
  iOS meldet `deviceMemory` nicht. Dort sichert der Speicherprüfer `tools/budget.mjs` die Grenzen ab (§15).
- Fällt Spike GK-0.7 auf echten Handys durch, gilt auf low dauerhaft 16 v 16 als Maximum. Das wird dem Nutzer offen gesagt.
- **Arena-Karten:** Die Grenze steigt von 8 v 8 auf 12 v 12 erst, wenn GK-0.2 und GK-0.3 bestanden sind. Die Standardwerte
  der Modi bleiben (`tdm` 6 v 6). Über 10 v 10 prüft `modes/spawns.js` mit größerem Sicherheitsabstand, ob Spawnpunkte frei sind.

### 3.3 CPU-Bildzeit (Hauptthread, Durchschnitt; p99 ≤ 2 × Durchschnitt)

| Posten | high @ 60 (16,7 ms) | low @ 30 (33,3 ms) |
|---|---|---|
| Eingabe, Spieler, Waffen, Kampf, Projektile | 1,2 | 2,5 |
| **Bots aller Stufen** inkl. CPU-Animation | **2,5** | **4,0** |
| Fahrzeuge (fester 60-Hz-Schritt) | 0,6 | 1,2 |
| Welt (Culling, LOD-Buckets, Gelände-Quadtree, Vegetation) | 1,0 | 2,0 |
| Modus, Effekte, HUD, Audio | 1,5 | 3,0 |
| Render-Submit | 5,0 | 8,0 |
| Reserve (Speicherbereinigung, Uploads ≤ 2 ms, Wärmedrosselung) | 4,9 | 12,6 |

medium folgt auf Touch der low-Spalte, am Desktop der high-Spalte.

### 3.4 GPU und Darstellung je Stufe (Großkarte)

| | low | medium | high | ultra |
|---|---|---|---|---|
| Draw Calls (alle Pässe inkl. Schatten) | ≤ 220 | ≤ 350 | ≤ 600 | ≤ 700 |
| Dreiecke inkl. Schatten | ≤ 0,5 M | ≤ 1,2 M | ≤ 2,5 M | ≤ 4 M |
| GPU-Zeit | ≤ 20 ms | ≤ 20 ms (Touch) / 13 ms | ≤ 13 ms | ≤ 13 ms |
| Sichtweite (Nebelkante) | 350 m | 600 m | 1 000 m | 1 500 m |
| Gras-Radius | 12 m (abschaltbar) | 25 m | 40 m | 60 m |
| Bäume: Vollmodell / Einfachmodell / Impostor | 30 / 80 m / Nebel | 50 / 120 m | 60 / 150 m | 80 / 200 m |
| Schatten | 1 × 1024², 0–25 m, alle 2–4 Bilder + gebacken | 2 × 1024² (0–20 m jedes Bild, 20–80 m jedes 2.) + gebacken | 3 × 2048²: 0–25 m jedes Bild, 25–90 m jedes 2., 90–350 m nur Statik zwischengespeichert | wie high + PCSS nah |
| Soldaten voll (SkinnedMesh) / S0-Bots | 6 / 6 | 10 / 10 | 16 / 16 | 24 / 20 |
| Fahrzeuge gleichzeitig | ≤ 8, keine Jets | ≤ 12, Jets nur Desktop | ≤ 20 | ≤ 20 |
| Gelände-Patch / Splat-Schichten | 16² / 4 | 32² / 6 | 32² / 8 | 32² / 8 + Triplanar-Fels |
| Wolken | Kuppel | Kuppel | Kuppel + Wolkenschatten-Textur | volumetrisch (¼ Auflösung) |

**GPU-Zeit high:** Schatten 2 ms, Gelände 2 ms, Ortschaften 3 ms, Vegetation 2,5 ms, Akteure und Fahrzeuge 1,5 ms,
Nachbearbeitung nach REALISM_PLAN §5.1 2 ms.

**Arena-Karten:** Für sie bleibt die Regel „Draw Calls < 400 auf high“ (Vertrag §11) unverändert.

### 3.5 Speicher und Download (Talsperre)

**GPU-Speicher in MB.** Die Budgets aus REALISM_PLAN §4.1 gelten **unverändert**.

| Posten | low | medium | high | ultra |
|---|---|---|---|---|
| Gelände (Höhe RG8, Normalen, Splat, Makro-Albedo, Lichtkarte, Schichten) | 10 | 25 | 57 | 80 |
| Vegetation (Meshes, Impostor-Atlanten, Gras) | 3 | 10 | 23 | 35 |
| Ortschaften (instanzierte Baukästen, HLOD, 1–2 Ortschaften in voller Auflösung) | 45 | 80 | 150 | 230 |
| Soldaten inkl. VAT | 8 | 10 | 14 | 20 |
| Fahrzeuge | 8 | 15 | 30 | 45 |
| Waffen und Viewmodel | 4 | 10 | 15 | 40 |
| Schatten, Render-Ziele, Effekte, PMREM | 30 | 70 | 156 | 270 |
| **Summe (Schätzung)** | **≈ 108** | **≈ 220** | **≈ 445** | **≈ 720** |
| **Budget REALISM_PLAN §4.1 (hart)** | 160 | 320 | 600 | 1 000 |

**JS-Heap:** low ≤ 250 MB, medium ≤ 320 MB, high ≤ 450 MB, ultra ≤ 550 MB. Auf iOS darf der ganze Tab ≈ 1 GB nicht
überschreiten (REALISM_PLAN §4.2). Daraus folgt: Navigation und BVH als Typed Arrays, **kein three-`Octree` auf Großkarten**.

**Download der ersten Großkarte in MB**, inklusive gemeinsamem Fahrzeug-Paket:

| Posten | low | high |
|---|---|---|
| Höhenfeld (16 bit, gzip) | 1,2 | 1,2 |
| Splat, Makro-Albedo, Lichtkarte | 1,2 | 4,0 |
| Navigation, Routen, PVS | 0,7 | 0,7 |
| HLOD und Impostor-Atlanten | 2,0 | 5,0 |
| Gelände-Schichten (KTX2) | 1,0 | 4,0 |
| Ortschafts-Baukästen (Texturen, Requisiten) | 1,5 | 6,0 |
| Fahrzeug-Paket (Materialien, Klänge; Modelle sind Code) | 1,8 | 3,5 |
| **Summe** | **≈ 9,4** | **≈ 24,4** |

- **Ausnahme GK-A1 zu REALISM_PLAN §4.1, Spalte „jede weitere Karte“:** Für Großkarten gelten
  low ≤ 10 MB, medium ≤ 18 MB, high ≤ 28 MB, ultra ≤ 40 MB statt 7/15/22/32 MB.
  - Das Fahrzeug-Paket wird einmal geladen und vom Service Worker zwischengespeichert. Jede weitere Großkarte liegt
    deshalb ≈ 2 MB darunter.
  - Grenzland bleibt im normalen Kartenbudget.
  - Der Service Worker aus REALISM_PLAN §4.3 (core/site) ist Voraussetzung für Großkarten (GK-1).
- **Laden:** Ziel 6 s am Desktop und 12 s am Handy. Abnahmegrenze ≤ 10 s bzw. ≤ 20 s.

### 3.6 Laufzeitschutz

- **Lastabwurf:** Hängt die dynamische Auflösung (`dynres.js`) 15 s lang am Boden, wird Last abgeworfen, in dieser
  Reihenfolge:
  1. S0-Grenze −2
  2. Gras-Radius × 0,5
  3. Schattenkaskade C1 aus
  4. Sichtweite −25 %
  5. Impostor-Entfernung −25 %

  **Bots und Fahrzeuge werden nie mitten im Match entfernt.**
- **Stufe bleibt fest:** Die Qualitätsstufe wechselt weiter nur zwischen Matches (Vertrag §11a).

---

## 4. Großwelt (Besitzer world)

Neue Module unter `assets/js/game/world/terrain/`:

| Modul | Aufgabe |
|---|---|
| `heightfield.js` | Höhenfeld: `heightAt`, `normalAt`, Max-Mip-Pyramide für Strahlen |
| `cdlod.js` | Gelände-Darstellung |
| `splat.js` | Gelände-Material |
| `vegetation.js` | Bäume, Büsche, Gras |
| `tiles.js` | Strukturen und BVHs je 128-m-Kachel |
| `pvs.js` | Sichtbarkeitstabelle |
| `composite.js` | Fassade für `collider`, `raycast` und `lineOfSight` |
| `bigmap.js` | Laden der gebackenen Daten |

Die Kartenmodule beschreiben `terrain: { size, res, seed, stamps, roads, rivers, biomes, pois }`. **Alles lädt per `import()`
nur auf Großkarten.**

### 4.1 Gelände

- **Daten:**
  - CPU: `Uint16Array` (Höhe = min + v · Δ, Δ = 2,5 mm).
  - GPU: **RG8** mit hohem und niedrigem Byte, bilineare Filterung von Hand im Vertex-Shader über 4 × `texelFetch`.
    Gründe: R16F verliert über 128 m Höhe 6–12 cm Genauigkeit, lineare Float-Filterung ist auf Handys nicht garantiert,
    und `EXT_texture_norm16` gibt es nicht überall.
  - Normalen als RG8.
- **CDLOD:**
  - Ein `InstancedMesh` aus Gitterstücken (32², low 16²) über die Quadtree-Knoten des Bildes (40 m … 1 280 m),
    Überblendung im Vertex-Shader.
  - Kosten: **1 Draw Call + 1 je Schattenkaskade**. Sichtbare Dreiecke: Desktop 160–300 k, Handy 40–75 k.
  - Der Kulissenring (3,2 km) ist ein eigenes grobes Mesh (1 Draw Call, keine Kollision; für Luftfahrzeuge reicht eine
    Höhenabfrage im Grobraster).
- **Splat:**
  - KTX2 als `CompressedArrayTexture`. Geprüft: Der vendorte `KTX2Loader` (r186) erzeugt sie bei `layerCount > 1`.
    **Spike:** Kann die vorhandene Asset-Pipeline geschichtete ETC1S-Dateien schreiben (`basisu -tex_array`)?
    Rückfall: einzelne Texturen je Schicht (low 4, innerhalb der Sampler-Grenze).
  - Kontrollkarten: RGBA8 512² auf low (4 Schichten), 2 × 1024² auf high (8 Schichten). Die Schichten kommen aus
    `assets/lib` (REALISM_PLAN M1).
  - Gegen-Kachelung (REALISM_PLAN M2) wird für Gelände ab medium Pflicht. low mischt nur Makro × Detail.
- **Makro-Albedo und gebackene Lichtkarte:** RG8 (R = Sonnensicht, G = Himmelsverdeckung), 1024² auf low, 2048² auf high.
  Ferne Schatten kosten so nichts. Das Sonden-Gitter (R5) gibt es nur in Ortschafts-Volumen.
- **Kollision:**
  - `world.collider` wird eine Fassade mit genau den drei Methoden, die `physics.js` nutzt
    (`capsuleIntersect`, `getCapsuleTriangles`, `triangleCapsuleIntersect`).
  - Das Höhenfeld liefert die 2–8 Dreiecke unter der Kapsel auf Abruf. Dazu kommen gekachelte BVHs je 128 m
    (Typed Arrays, `TriangleBVH`). Es gibt **keine `THREE.Triangle`-Objekte und keinen three-`Octree`** auf Großkarten.
  - Die Arena-Karten bleiben unverändert.
- **Strahlen:**
  - `raycast` und `lineOfSight` nehmen das Minimum aus dem Höhenfeld-Marsch (DDA über die Max-Mip-Pyramide,
    ≈ 1–3 µs je Strahl) und den Kachel-BVHs.
  - Laub verdeckt **nur die Bot-Wahrnehmung**, keine Kugeln. Dafür gibt es Laubvolumen je 64-m-Zelle.
- **Grenze:** `world.bounds` bleibt die spielbare Fläche. Neu ist `world.inBounds(pos) → 'in'|'warn'|'out'` (§5.7).

### 4.2 Vegetation

- **Arten und Menge:** 4–6 Arten (Fichte, Kiefer, Birke, Buche, Busch, Fels), auf Talsperre ≈ 10 k Instanzen in 64-m-Zellen.
- **Bäume sind prozedural** (verzweigter Baukasten) mit CC0-Rinden- und Blatttexturen aus `assets/lib`.
  Ehrlich gesagt: Gute CC0-Bäume sind selten.
- **Drei Darstellungen:**
  1. Vollmodell mit 3–6 k Dreiecken
  2. Einfachmodell mit 300–800 Dreiecken
  3. **oktaedrischer Impostor** bis zur Nebelkante: Atlas mit 8 × 8 Ansichten zu 128 px am Desktop, 6 × 6 zu 64 px am Handy,
     offline gebacken

  Entfernungen siehe §3.4.
- **Ein `InstancedMesh` je (Art, LOD):** ≈ 25–35 Draw Calls am Desktop, ≈ 12 am Handy.
- **LOD-Buckets werden schrittweise neu gebaut:** nahe Zellen jedes Bild, sonst ≈ 2 k Instanzen je Bild im Wechsel,
  komplett nach 4 m Kamerabewegung.
- **Gras:** Büschel im Ring um die Kamera aus der Splat-Karte, ≤ 120 k Dreiecke am Desktop, ≈ 20 k am Handy.
  Wind im Shader. Gras empfängt Schatten, wirft aber keine.
- **Instancing:** `InstancedMesh` ist das sichere Mittel. `BatchedMesh` nur bei `WEBGL_multi_draw`, weil r186 sonst
  einen Draw Call je Instanz absetzt.

### 4.3 Ortschaften, HLOD, Culling

- **Baukästen werden instanziert, nicht verschmolzen.** Die Geometrie wird geteilt, die Attribute quantisiert
  (REALISM_PLAN G5, ≈ −40 %).
- **Drei Darstellungen je Ortschaft:**
  1. volles Detail bis 150 m (Handy 100 m)
  2. **HLOD-Hülle**: 8–15 k Dreiecke, 1 Draw Call, Atlas mit gebackenem Licht, offline mit meshoptimizer gebaut
  3. **Innenräume** nur, wenn die Kamera drinnen oder näher als 25 m ist
- **Culling-Kette:**
  1. AABBs der 64-m-Zellen gegen den Sichtkegel (≈ 10 µs)
  2. Entfernungstabelle je Objektklasse und Stufe
  3. Objekte unter 2 px auf dem Bildschirm entfallen
  4. **PVS**: 32-m-Zellen, auf Talsperre 40 × 40 = 1 600 Zellen, Bit-Tabelle ≈ 320 KB roh (≈ 60–120 KB gzip),
     Augenhöhen 1,7 m und 12 m. Ab 20 m Flughöhe aus.
- **Dieselbe PVS steuert** auch die Hochstufung der Bots (§7.1) und die Klangverdeckung (§9).
- **Kartengestaltung:** Grate und Täler sind die billigste Verdeckung. Die Talsperre wird bewusst so geformt.
- **GPU-Occlusion-Queries** gibt es in WebGL2, three stellt sie aber nicht bereit. Nur Desktop, Welle GK-4.

### 4.4 Licht, Atmosphäre, Tiefe

- **Kaskadenschatten R8** sind auf Großkarten **Pflicht** (Stufen §3.4):
  - Die ferne Kaskade enthält nur Statik und wird nach 30 m Kamerabewegung über 4 Bilder verteilt neu gerendert.
  - Dahinter gilt die gebackene Lichtkarte.
  - Soldaten und Fahrzeuge bekommen ab 45 m **Blob-Schatten** (1 instanzierter Decal-Batch).
- **Atmosphäre:**
  - Luftperspektive über den Höhennebel mit Sonnen-Inscattering (R6) trägt die Fernwirkung fast kostenlos.
  - Himmel als HDRI (R1), die Sonnenrichtung stimmt mit dem Bake der Lichtkarte überein.
- **Tiefe:**
  - `camera.far` richtet sich nach `meta.viewDistance`.
  - Mit `EXT_clip_control` nutzen wir `reversedDepthBuffer` (in r186 vorhanden). Sonst gilt near 0,1 m und far ≤ 1 500 m, plus Nebel.
  - Im Fahrzeug liegt das Cockpit bzw. der Turm-Innenraum in der Viewmodel-Szene. Die Hauptkamera kann dort mit near = 0,5 m rendern.
- **„Kranker“-Momente, die wenig kosten:**
  - Staubfahnen hinter Fahrzeugen
  - Rauchsäulen nach Explosionen, als Impostor-Sprites bis 1 km sichtbar
  - Kettenspuren als Decals (R16)
  - Hitzeflimmern über Motoren (high+)
  - Lichtstrahlen durch Wald (R7)
  - Mündungsfeuer in der Dämmerung (R9-Pool)

### 4.5 Navigation (world und bots)

- **Infanterie:**
  - Der feine Graph (`navbuild.js`, 1,5 m) entsteht nur in Ortschaften, je ≈ 4 k Knoten.
  - Im freien Gelände gilt ein **implizites 4-m-Kostengitter** (`Uint8Array`, Talsperre 320² ≈ 100 KB) mit **HPA\*** über
    64-m-Cluster. Portale verbinden das Gitter mit den Ortschafts-Graphen.
- **Fahrzeuge:**
  - Straßengraph mit Knoten alle 10 m, dazu dasselbe Gitter mit Kosten je Klasse (Rad ≤ 25°, Kette ≤ 35°) und einem
    2-m-Distanzfeld zu Gebäuden in Ortschaften.
  - Hinterhangstellungen für Panzer werden aus dem Höhenfeld vorberechnet.
- **Luft:** kein Netz. Die Höhe kommt aus der Max-Mip-Abfrage, dazu eine Liste hoher Hindernisse (Funkturm, Staumauer, Kräne).
- **Vorberechnete Routen** zwischen allen Flaggen und HQs je Agentenklasse (Talsperre: 36 Paare × 3 Klassen = 108 Routen).
  Bots in S2 bewegen sich nur auf ihnen.
- **Nav-Worker:**
  - Auf Großkarten bleibt `worldgen.worker.js` am Leben und hält die Navigation als Typed Arrays.
  - `nav.findPathAsync(from, to, { agent: 'infantry'|'wheeled'|'tracked' }) → Promise<Vector3[]>` liefert nach 1–2 Bildern.
  - Kein `SharedArrayBuffer`: GitHub Pages kann keine COOP/COEP-Header setzen. Es gibt nur `postMessage` mit Transferables.
  - Der synchrone `findPath` bleibt für Arena-Karten und Wege unter 60 m in Ortschaften, dann **inkrementell**
    (höchstens N Knotenerweiterungen je Bild, im nächsten Bild fortgesetzt).

### 4.6 Bake-Pipeline `tools/bigmap/` (world)

- **Aufruf:** `node tools/bigmap/bake.mjs <mapId>` erzeugt `assets/maps/<id>/`.
- **Gelände-Erzeugung:** fBm- und Kammrauschen (`SimplexNoise`), Tropfen-Erosion, Stempel für Plateaus,
  Flussbett und Randgebirge. Straßen als Catmull-Rom-Splines, die das Gelände planieren.
- **Ausgaben:**
  - `height.bin.gz`, `light.bin.gz`, `pvs.bin.gz`, `nav.bin.gz` (Kostengitter, Cluster, Portale, Routen, Straßen)
  - Splat und Makro als KTX2
  - `hlod/*.glb` (meshopt)
  - Impostor-Atlanten als KTX2
  - `hillshade.webp` (Minikarte 2048², ≈ 0,6 m/px)
  - `meta.json` mit Hashes
- **Deterministisch:** Gleicher Seed ergibt die gleichen Bytes. Eine Prüfung in `tools/check.sh` vergleicht die Hashes.
- **Laufzeit:**
  - Dekodiert wird im Welt-Worker über `DecompressionStream('gzip')`. Nur die Kachel-BVHs der Ortschaften werden zur
    Laufzeit gebaut.
  - Fehlt `DecompressionStream` (Safari < 16.4), zeigt die Lobby „Großkarten brauchen einen neueren Browser“.
  - Uploads bleiben ≤ 2 ms je Bild (vorhandene `initTexture`-Zeitscheiben).
  - Handys streamen zur Laufzeit nichts. Desktop high/ultra lädt 1024/2048-Sätze naher Ortschaften nach
    (≤ 250 m laden, > 400 m freigeben, REALISM_PLAN M3).
  - Im Jet ist das Streaming eingefroren.

### 4.7 Zerstörung-lite (world und ballistics)

| Stufe | Inhalt | Welle |
|---|---|---|
| 1 | Deckung und Kleinteile (Sandsäcke, Holzwände, Zäune, Kisten; 150–600 HP) werden gegen Trümmer-Meshes getauscht | GK-2 |
| 2 | markierte Wandfelder (2–3 m, 400–1 200 HP) wechseln zur Variante mit Loch | GK-2 |
| 3 | Hütten und Schuppen stürzen als Ganzes ein (Tausch gegen ein Schuttmodell) | GK-2 |
| 4 | Bäume fallen, wenn ein Panzer sie rammt (die Instanz wird getauscht) | GK-2 |
| 5 | Krater: Decal plus Delle im Höhenfeld (≤ 0,5 m, `texSubImage2D` + CPU-Array), höchstens 150 | GK-4 |

**Technik:**
- Die statische BVH bleibt unverändert. Zerstörbares liegt in einer **dynamischen Schicht** (Quader bzw. kleine BVHs im
  16-m-Raster), die `raycast`, `lineOfSight` und `CapsuleBody` zusätzlich prüfen.
- Nav-Kanten tragen `blockers: [pieceId]`. Wege durch Löcher werden vorab berechnet und erst nach der Zerstörung freigeschaltet.
- Das Sonden-Gitter wird nicht neu gebacken.
- **Budgets:** ≤ 600 Teile je Großkarte. Trümmer über Rapier höchstens 40 am Desktop und 12 auf medium, auf low nur
  Partikel (REALISM_PLAN P1/P2 unverändert).
- **Große Gebäude bleiben stehen.**

---

## 5. Modi und Spielmechaniken

### 5.1 Eroberung `cq` (ui; KI: bots)

- **Flaggen:** 5 (Grenzland) bzw. 7 (Talsperre), dazu je Team ein HQ.
  - Radius 12–30 m, in Gebäuden mit Höhenband.
  - Die Logik von `modes/dom.js` wird wiederverwendet (`captureTime`, `captureRateBonus`, `maxCapturers`).
  - Werte für `cq`: Neutralisieren 12 s plus Einnehmen 12 s für eine Person. Tempo × (1 + 0,5 · (Überzahl − 1)),
    höchstens × 3. Bei Gleichstand steht der Fortschritt.
- **Tickets:**

  | Spieler je Seite | ≤ 8 | ≤ 16 | ≤ 24 | ≤ 32 |
  |---|---|---|---|---|
  | Tickets | 150 | 250 | 320 | 400 |

  - Matchlänge „Kurz / Standard / Lang“ als Faktor × 0,6 / 1 / 1,7. Zur Sicherheit gilt ein Zeitlimit von 40 min
    (Standard); dann gewinnt, wer mehr Tickets hat.
  - Jeder Respawn kostet 1 Ticket, eine Wiederbelebung kostet nichts.
  - **Ausbluten:** Wer mehr Flaggen hält, zieht dem Gegner 1 Ticket alle 6 s / Flaggendifferenz ab. Hält ein Team alle
    Flaggen, verliert der Gegner 1 Ticket je Sekunde.
- **HQ:** Gegner im HQ bekommen 10 s Warnung, dann scheiden sie aus. So gibt es kein Basis-Camping.
- **Punkte** (`score.reason` additiv):

  | Grund | Punkte |
  |---|---|
  | Einnehmen | 200 |
  | Neutralisieren | 100 |
  | Verteidigen | 50 |
  | Wiederbelebung | 50 |
  | Fahrzeug zerstört | 100–400 (nach Typ) |
  | Reparatur | 10 je 10 % |
  | Versorgen | 10 |
  | Markierungs-Assist | 20 |
  | Trupp-Befehl erfüllt | +50 |
- **Medaillen (neu):** „Flaggenstürmer“, „Sanitäter“, „Panzerknacker“, „Mechaniker“, „Rammbock“, „Luftabwehr“, „Truppführer“.

### 5.2 Weitere Modi auf Großkarten

- **Durchbruch `bt` (GK-3):** Angreifer gegen Verteidiger. Sektoren aus je 2 Flaggen, begrenzte Angreifer-Tickets
  (+ 75 je genommenem Sektor). Die Verteidiger ziehen sich zurück.
- **Sektoren (GK-1):** `MAPS[id].sectors = { dorf: { bounds, spawns, objectives } }`. Damit laufen `tdm`, `dom`, `gun` und
  `hp` (REALISM_PLAN §11.1) auf Teilbereichen der Großkarte. Das bringt viel Abwechslung für wenig Aufwand.
- **Serienprämien** sind auf Großkarten standardmäßig **aus**, Fahrzeuge ersetzen sie. Ein Lobby-Schalter schaltet sie
  ein; dann ruft man sie über das Kommando-Rad ab (§10).
- **Regelsatz „Realismus“** (REALISM_PLAN §11.1) gibt es in v1 nicht für `cq` und `bt`: Ohne Minikarte und Markierungen
  ist eine 1-km-Karte gegen Bots unspielbar. Er bleibt für die Infanteriemodi.

### 5.3 Trupps, Einsatzbildschirm, Spawn (ui; KI: bots)

- **Trupps:**
  - 4 Mitglieder, bei 32 v 32 also 8 je Seite: **Anton, Berta, Cäsar, Dora, Emil, Friedrich, Gustav, Heinrich**.
  - Der Spieler führt seinen Trupp und kann die Führung abgeben. Die Punktetabelle zeigt die Truppkennung („Berta-2“).
- **Einsatzbildschirm** (Taste M bzw. nach dem Tod): große Karte, Touch zuerst, Tippen genügt. 10 s Wartezeit.
  Spawnpunkte:
  - HQ und eigene Flaggen
  - **Truppmitglied**, wenn es seit 5 s keinen Schaden genommen hat und kein bekannter Gegner es innerhalb von 25 m mit Sicht sieht
  - **Funkbake** des Aufklärers (5 Spawns)
  - **freier Sitz** in einem Truppfahrzeug (Igel, Libelle)

  Spawnschutz 1,5 s.
- **Rufnamen:** `CALLSIGNS` plus Präfixe in `bots/names.js` reichen heute schon für 63 Bots ohne Dubletten. Die Liste
  wird auf ≥ 80 Grundnamen ergänzt.

### 5.4 Klassen und Gadgets (nur `cq`, `bt` und Sektoren)

Alle Waffen stehen allen Klassen offen (wie in Battlefield 6). **Signaturwaffen** bekommen −10 % Anschlagzeit und
−10 % Rückstoß-Erholungszeit. Jede Klasse hat ein festes Gadget A und ein wählbares Gadget B.

| Klasse | Signatur | Gadget A (fest) | Gadget B (Wahl) | Eigenschaft |
|---|---|---|---|---|
| **Sturm** | Sturmgewehr, Karabiner | Adrenalinspritze (+50 HP, +15 % Tempo für 8 s) | UG-40 Klopfer (Unterlauf-Granatwerfer, 4 Granaten) · Sprengladung SL-2 (2 Stück, 400 Schaden) | +10 % Sprint für 5 s nach einem Abschuss |
| **Pionier** | MP (inkl. PDW), Schrotflinte | Reparaturbrenner RB-1 | PF-3 Faust · LR-2 Degen · FA-7 Wespe · Panzermine PM-4 „Teller“ (3 Stück) | eigener Explosionsschaden −20 %, Reparatur +25 % |
| **Versorger** | LMG | Defibrillator DF-1 | Munitionskiste · Verbandskiste · Nebelwerfer NW-3 | Wiederbelebung von Hand 3 s statt 5 s, Ziehen +30 % |
| **Aufklärer** | Präzisionsgewehr, Scharfschützengewehr | Funkbake FB-2 | Bewegungsmelder BM-1 · Splittermine SM-2 · Leuchtpistole LP-1 | Markierung hält 8 s statt 5 s, Visier-Nullpunkt bis 800 m |

Zusammen sind das **16 Gadgets**. `EQUIPMENT[id].kind` wird um `'gadget'` erweitert. Die Ausrüstung bekommt
`loadout.cls`, `loadout.gadgetB` und `loadout.melee` (additiv). Die Daten liegen in `shared/classes.data.js` (ui).

### 5.5 Am Boden und Wiederbelebung (core + ui; KI: bots)

- **Wer zu Boden geht:** jeder tödlich Getroffene, außer bei einem Kopfschuss mit Scharfschützengewehr, Explosionsschaden
  ≥ 150 oder Fahrzeugzerstörung. Er blutet 15 s aus und kann rufen bzw. pingen.
- **Wer wiederbelebt:**
  - Truppkameraden ziehen ihn mit 1,5 m/s und beleben ihn in 5 s wieder (Versorger von Hand 3 s, mit Defibrillator 1,5 s).
  - Danach hat er 40 HP und regeneriert normal.
  - „Aufgeben“ kostet sofort ein Ticket.
- **Bots** beleben nur wieder, wenn kein bekannter Gegner innerhalb von 15 m Sicht auf sie hat.
- **Ereignisse:** `actor:downed`, `actor:revived`. `kill` wird erst beim Ausbluten bzw. Aufgeben gemeldet, der Killfeed
  zeigt das Niederstrecken sofort.

### 5.6 Markieren und Kommando-Rad (ui + core; KI: bots)

- **Bedienung:** Kurz `ping` (B oder mittlere Maustaste) markiert, gedrückt halten öffnet das Rad. Auf Touch gibt es einen
  Ping-Knopf an der Minikarte, langes Drücken öffnet das Rad.
- **Wirkung:**
  - Ping auf einen Gegner: 5 s Markierung auf Minikarte und als roter 3D-Marker (Aufklärer 8 s).
  - Ping auf einen Ort: Marker für 10 s.
  - Höchstens 3 Pings je 5 s.
- **Rad-Befehle:** „Angreifen / Verteidigen [Flagge]“, „Brauche Sanitäter / Munition / Reparatur“, „Steig ein“, „Danke“,
  „Rückzug“, dazu Serienprämien, falls eingeschaltet.
- **Bots** befolgen die Befehle ihres Truppführers und markieren selbst. Das Ereignis `spot` geht an die Minikarte.

### 5.7 Weitere Mechaniken

- **Niederhalten:**
  - `bullet:whiz` (combat.js) füttert einen Wert S (0–1): +0,08 je Kugel, +0,15 bei LMG oder Scharfschützengewehr.
    Nach 1,5 s fällt S um 0,35/s.
  - Spieler: Vignette, Entsättigung und mehr Schwanken über R18, die Streuung bleibt gleich.
  - Bots: Zielfehler × (1 + 1,5 · S). Ab S > 0,5 suchen sie Deckung und spähen seltener.
  - So bekommt das LMG eine echte Aufgabe.
- **Fernballistik:**
  - Auf Großkarten werden Gewehrkugeln jenseits von 120 m zu **Projektilen** mit Flugzeit und Fall (`weapons/projectiles.js`, §6.6).
  - Innerhalb von 120 m und auf Arena-Karten bleibt alles beim heutigen Hitscan.
  - **„Visier-Nullpunkt“** (Einschießentfernung 100/200/300/500/800 m) für Optiken ab 4×, mit Mausrad bzw. Steuerkreuz.
    Der Spielname wird zur Spielmechanik.
- **Hinlegen** (REALISM_PLAN F10) wird für Großkarten **auf GK-2 vorgezogen**: Kapsel 0,6 m, liegende Trefferzonen, VAT-Clip.
- **Fallschirm:** Wer über 15 m Höhe aus einem Luftfahrzeug aussteigt, fällt frei. Leertaste öffnet den Schirm, unter 8 m
  öffnet er sich automatisch.
- **Kampfgebiet:** Bei `world.inBounds(pos) === 'warn'` steht „Zurück ins Kampfgebiet!“ mit 10 s Countdown, dann scheidet
  man aus. Fahrzeuge bekommen die gleiche Regel.
- **Killcam:**
  - v1 (GK-1): Die vorhandene Todeskamera fährt zum Schützen, dazu eine Karte mit Waffe bzw. Fahrzeug und Restleben.
  - v2 (GK-3): Ein Ringpuffer speichert alle Akteure 4 s lang mit 15 Hz (`engine/replay.js`, ≈ 40 KB) und spielt eine
    rekonstruierte Wiederholung von 2,5 s ab.
- **Messer-Takedown:**
  - Von hinten, 1,6 s, mit 3P-Kamera. Er bringt eine **Erkennungsmarke** des Opfers (Sammlung im Profil, als Anhänger tragbar).
  - Bots machen Takedowns selten, ab Stufe Veteran.
  - Unterbrechbar durch Schaden. Kein Gore.

---

## 6. Fahrzeuge (neuer Besitzer „vehicles“; Modelle: gunsmith)

### 6.1 Bestand

Die Namen sind erfunden und **bewusst ohne Überschneidung** mit den Bot-Rufnamen (`bots/names.js` enthält schon
Luchs, Dachs, Keiler, Sperber, Kranich, Hornisse), damit der Killfeed eindeutig bleibt.

| id | Name | Rolle | Sitze | HP | v max | Bewaffnung | Welle |
|---|---|---|---|---|---|---|---|
| `quad` | **Q-2 Floh** | Späher | 2 (Fahrer; Beifahrer offen, mit eigener Waffe) | 150 | 25 m/s | – | GK-2 |
| `jeep` | **GW-4 Steppe** | Transport | 4 (Fahrer; MG-Schütze offen; 2 offen) | 350 | 28 m/s | schweres MG | GK-2 |
| `ifv` | **SP-30 Igel** | Schützenpanzer, Trupp-Spawn | 6 (Fahrer = Richtschütze; 5 geschützt) | 800 | 16 m/s | 30-mm-Maschinenkanone, Panzerabwehr-Lenkrakete, Nebelwurf | GK-2 |
| `mbt` | **KP-1 Mammut** | Kampfpanzer | 2 (Fahrer = Richtschütze; Kommandant mit fernbedientem MG) | 1 000 | 13 m/s | 120 mm (Panzer- und Sprenggranate), Koax-MG, Nebelwurf | GK-2 |
| `spaa` | **FP-35 Distel** | Flakpanzer | 1 | 700 | 14 m/s | Zwillings-35 mm, 4 IR-Raketen | GK-3 |
| `heli_t` | **TH-8 Libelle** | Transporthubschrauber, Trupp-Spawn | 6 (Pilot; 2 Türschützen; 3) | 800 | 50 m/s | 2 Tür-MGs, Täuschkörper | GK-3 |
| `heli_a` | **KH-2 Skorpion** | Kampfhubschrauber | 2 (Pilot: Raketen; Schütze: 30 mm + Lenkflugkörper) | 700 | 60 m/s | s. links, Täuschkörper | GK-3 |
| `jet` | **JB-9 Komet** | Mehrzweck-Jet | 1 | 600 | 55–180 m/s | Kanone, 2 IR-Raketen, Täuschkörper | GK-4 |
| `at_post` | PAK-Stellung | statisch | 1 | 500 | – | Lenkrakete | GK-2 |
| `aa_post` | Flakstellung | statisch | 1 | 500 | – | Zwillings-MG | GK-3 |
| `tractor` | **Traktor „Gertrud“** (Easter Egg) | Spaß | 2 | 300 | 8 m/s | Hupe mit Melodie | GK-2 |

Die beiden Stellungen nutzen den Wachgeschütz-Code aus `modes/sentry.js` über die neue Entity-Registry (§12.2).

### 6.2 Anzahl je Teamgröße und Stufe

- **Je Seite, Talsperre, 24–32 Spieler:**
  - 1 Mammut, 1 Igel, 2 Steppe, 2 Floh
  - ab GK-3: 1 Distel, 1 Libelle, 1 Skorpion
  - ab GK-4 auf medium-Desktop/high/ultra: 1 Komet
- **12–23 Spieler je Seite:** 1 Panzer (Mammut und Igel im Wechsel), 1 Steppe, 1 Floh, 1 Libelle. Kein Skorpion, kein Komet.
- **Grenzland:** je Seite 1 Igel, 1 Steppe, 2 Floh.
- **Wiedererscheinen:** leicht 30 s, Panzer 90 s, Luft 120 s.
- **Stufen-Obergrenze für gleichzeitig existierende Fahrzeuge:** §3.4. Auf low gibt es keinen Jet.

### 6.3 Physik: `vehicles/sim.js`

Eigene JS-Simulation, ≈ 700–900 Zeilen, **gleich auf allen Stufen**.

- **Grundlage:** Starrkörper mit 6 Freiheitsgraden (Quader-Trägheit), **fester 60-Hz-Schritt mit Interpolation**,
  ab 20 m/s 2 Teilschritte.
- **Räder:**
  - Ein Federstrahl je Rad gegen das Höhenfeld und die Kachel-BVHs (Brücken, Straßen in Ortschaften).
  - Längs- und Querreibung mit Schlupfbegrenzung.
  - Handbremse für Floh und Steppe.
- **Ketten:** 2 × 5 Strahlräder, Differentialschub plus Giermoment, beim Drehen weniger Seitenreibung, Drehen auf der Stelle.
- **Kollision:**
  - Wannen-Stichproben (8 Ecken + 12 Kantenmitten) gegen die BVH.
  - OBB gegen OBB (SAT) zwischen Fahrzeugen.
  - Fahrzeuge sind **dynamische Hindernisse** für `CapsuleBody` (`world.dynamicObstacles`, die Kapsel wird hinausgeschoben).
  - Überfahren ab 5 m/s, Schaden ∝ Masse · v², `damageType: 'collision'`, `kill.roadkill`.
- **Hubschrauber:** Arcade-Kräfte (Kollektiv, Lage über PID-Sollwert, Bodeneffekt, Schwebehilfe).
- **Jet:** Auftrieb ∝ v², Strömungsabriss unter 55 m/s, automatisches Ausleveln.
- **Instruktor (Zielführung, wie in War Thunder):** Der Spieler zeigt mit der Kamera, ein PID-Regler fliegt. Dieselbe
  Logik dient Touch, Gamepad, Maus-Assistenz **und Bot-Piloten**. Mit Tastatur und Maus gibt es optional „direkt“.
- **Kosten:** 15–40 µs je Fahrzeug und Schritt am Desktop.
- **Warum nicht Rapier:**
  - low lädt Rapier nie (REALISM_PLAN §9.2).
  - Bots brauchen ein billiges, vorhersagbares Modell.
  - Das Verhalten muss auf allen Stufen gleich sein.

  Rapier bleibt für Trümmer und Ragdolls auf medium+ (E-1).
- **Rückfall:** Fällt Spike GK-0.6 durch, übernimmt auf medium+ `DynamicRayCastVehicleController`
  (`@dimforge/rapier3d` 0.21) die Räder. low bekommt dann ein vereinfachtes eigenes Modell. Das wäre eine ausdrückliche
  Planänderung und muss mit dem Nutzer abgestimmt werden.

### 6.4 Schadensmodell (`vehicles/damage.js`)

- **Trefferzonen:**

  | Zone | vorn | Seite | hinten | oben |
  |---|---|---|---|---|
  | Faktor | × 0,6 | × 1,0 | × 2,0 | × 1,6 |

  Bei einem Auftreffwinkel über 70° prallen Raketen und Granaten ab (0 Schaden, Klang „Abpraller“).
- **Kleinwaffen:**

  | Ziel | Faktor |
  |---|---|
  | Floh, Steppe | × 0,4 |
  | Hubschrauber, Jet | × 0,15 |
  | Igel, Mammut, Distel | 0 (Funken, „Ping“) |

  **Amboss .50:** leicht × 1, Luft × 0,6, Igel × 0,15, Mammut 0.
- **Waffen gegen Fahrzeuge:**
  - Faust 250, Degen 220 (drahtgelenkt), Wespe 350 (nur Luft)
  - Panzermine 450 + Kette
  - Sprengladung 400
  - Panzerhandgranate 180
  - Mammut-Hauptkanone 300
  - Igel-Lenkrakete 280

  Damit braucht der Mammut **7 Faust-Treffer von vorn, 4 seitlich, 2 von hinten**.
- **Komponenten:**
  - **Kette/Antrieb:** 6 s bewegungsunfähig bzw. 30 % Tempo
  - **Turmkranz:** Schwenken −50 %
  - **Motor:** Tempo −40 %
- **Kampfunfähig** unter 20 %: Das Fahrzeug brennt (−5 HP/s) und fährt mit 30 % Tempo, Meldung „Aussteigen!“.
  Wird es zerstört, sterben geschützte Insassen. Offene Sitze haben eigene Trefferzonen.
- **Reparaturbrenner:** 50 HP/s, überhitzt nach 6 s, kühlt 3 s ab.
- **Selbstreparatur:** Gepanzerte Fahrzeuge regenerieren nach 10 s ohne Treffer bis 40 %.

### 6.5 Sitze, Kameras, Linse

- **Ein- und Aussteigen:**
  - `interact` (F) innerhalb von 3 m. Sitzwechsel mit **1–6** (1 s). **Nicht F1–F6**: F5 ist schon in `RESERVED_CODES`,
    F1/F3/F6 lösen Browserfunktionen aus.
  - Beim Aussteigen wird die Kapsel an den Ausstiegspunkten geprüft.
- **Im Sitz** überspringt `player.update` den `CapsuleBody`. Bodycam-Bewegung (F1), freies Zielen (F4) und Lehnen (F5) sind aus.
- **Kameras:**
  - **1P:** Cockpit bzw. Turm in der Viewmodel-Szene
  - **3P:** Federarm mit 3 Kollisionsstrahlen
  - **Richtschützen-Optik:** 2× und 8×, Entfernungsmesser, SVG-Strichplatte
  - **Wärmebild** als Fahrzeug-Upgrade (GK-3, Uniform `uThermal` in Soldaten- und Fahrzeugmaterialien)
- **Linse:** `renderer.lens.setStyle('bodycam'|'optic'|'neutral')` erweitert R2 und die Einstellung `lensStyle`
  (REALISM_PLAN §5.3). 3P ist `neutral`, Optiken sind `optic` (ohne Fischauge, Körnung bleibt), 1P folgt der Einstellung
  des Spielers. HUD-Projektionen laufen weiter über `lens.toScreen`.

### 6.6 Projektile und Lenkwaffen (`weapons/projectiles.js`, ballistics)

- **Pool:** bis 128 Projektile (Handy 64) mit Schwerkraft, Luftwiderstand und Teilschritt-Strahlen.
- **Lenkarten:**
  - `none`: Faust 150 m/s, Panzergranate 900 m/s
  - `saclos`: Degen und Igel-Rakete folgen dem Fadenkreuz mit 120 m/s
  - `ir`: Wespe, Distel, Komet, Skorpion. Aufschalten 1,5 s. Täuschkörper brechen die Aufschaltung mit 80 %
    Wahrscheinlichkeit, wenn sie innerhalb von 2 s nach der Warnung fallen. Abklingzeit 12 s.
- **Splash** über das vorhandene `combat.explode`.
- **Ereignisse:** `projectile:launch|hit`, `lock:start|acquired|lost`, `countermeasure`.

### 6.7 Modelle (gunsmith)

- **Bauweise:** prozedural im Baukasten-Stil der Waffen (`vehicles/models/*.js`, Aufruf
  `createVehicleModel(key, { lod: 0|1|2|'showcase' })`). Fotoscan-Materialien `metal_painted`, `rubber`, `tarp` aus
  `assets/lib`, ein 1024er-Materialsatz je Fahrzeug (Ultra 2048).
- **Dreiecke:**

  | LOD0 Desktop | LOD0 Handy | LOD1 | LOD2 | Impostor |
  |---|---|---|---|---|
  | 15–25 k | 6 k | 3 k | 800 | ab 300 m (Handy ab 200 m) |
- **Tarnungen** laufen über denselben Material-Hook wie die Waffentarnungen. Die Teamkennung (Balken und Rundmarke)
  bleibt immer sichtbar.
- **Ehrlich:** Fotorealistische CC0-Militärfahrzeuge gibt es kaum. Unsere wirken aus der Nähe „sauber“. Staub, Schlamm-Decals
  und die Bodycam-Linse gleichen das teilweise aus.

---

## 7. Bots bei 32 gegen 32 (bots)

### 7.1 Simulationsstufen (`bots/ai/lod.js`)

| Stufe | Wer | Was läuft | Kosten je Bot (Desktop / Handy) |
|---|---|---|---|
| **S0 voll** | ≤ 60 m (Handy 40 m), schießt auf den Spieler oder wird von ihm anvisiert, **im Zielfernrohr-Kegel** (Schwellen × Zoom, wie `updateLod` schon nach FOV skaliert), Fahrzeugbesatzungen nahe dem Spieler. Höchstens 6/10/16/20 je Stufe | heutige KI (Wahrnehmung, Gehirn, `CapsuleBody`, IK, `WeaponController`) jedes Bild | 0,1 / 0,3 ms |
| **S1 reduziert** | ≤ 300 m (Handy 200 m) oder laut PVS in Sicht des Spielers, solange der Spieler in seiner Waffenreichweite ist | Denken und Wahrnehmen mit 3 Hz, Sichtstrahlen nur gegen Kandidaten aus dem Raum-Hash, Bewegung rastet auf dem Nav-Pfad ein (keine Kapsel), VAT-Animation, Waffe tickt nur im Gefecht. **Echte Strahlen, Leuchtspuren und Klänge** | 0,025 / 0,075 ms |
| **S2 strategisch** | alle anderen | Trupp-Ebene mit 1 Hz, Position interpoliert auf vorberechneten Routen. Gefechte **zwischen S2-Akteuren** je 64-m-Sektor 1× je Sekunde statistisch entschieden (Stufe, Waffen-TTK bei der Distanz, Deckung, Überzahl). Schaden über `combat.damage`, also echte `kill`-Ereignisse | 0,004 / 0,012 ms |

- **Fairnessregel (verbindlich):**
  - Alles, was dem Spieler oder einem für ihn sichtbaren Akteur schaden kann, ist S0 oder S1 und schießt mit echten Strahlen.
  - S2 schadet dem Spieler nie.
  - **Jeder Bot ist für Kugeln des Spielers treffbar.** Nicht-skinned Stufen nutzen Trefferzonen nach Haltungsklasse
    (stehend, geduckt, liegend).
- **Wechsel zwischen Stufen** mit Hysterese (S0 hinein bei 60 m, hinaus bei 75 m). Ein S2-Bot, der hochgestuft wird,
  rastet auf den nächsten Nav-Knoten ein, solange er Impostor oder ausgeblendet ist. So springt niemand sichtbar.
- **Erwartete Kosten:**
  - Desktop, 64 Akteure: 16 × 0,1 + 25 × 0,025 + 22 × 0,004 ≈ **2,3 ms**
  - Handy, 24 Akteure: 6 × 0,3 + 10 × 0,075 + 7 × 0,012 ≈ **2,6 ms**
  - Handy, 64 Akteure: ≈ **3,7 ms**

  Darum ist 32 v 32 auf dem Handy erlaubt, aber mit Warnung (Wärme, GPU).
- **Gilt nur auf Großkarten.** Auf Arena-Karten bleibt das Verhalten gleich, nur die Spitzenbehebung (§7.3) wirkt überall.

### 7.2 Darstellung vieler Soldaten (`bots/crowd.js`)

| Entfernung (Desktop / Handy) | Darstellung | Kosten |
|---|---|---|
| ≤ 36 / 24 m, höchstens 16 / 6 (Stufen §3.4) | vorhandene SkinnedMesh LOD0/1 mit voller IK | ≈ 3–4 Draw Calls je Soldat |
| ≤ 120 / 60 m | **VAT-Masse**: LOD2 (0,6–0,9 k Dreiecke), Third-Person-Waffe an den Handknochen gebacken (4 Silhouetten: Gewehr, MP, LMG, Pistole/Scharfschütze). 12 Clips × 17 Knochen, **beim Laden aus dem vorhandenen prozeduralen Animator gebacken** (≈ 0,1–0,5 MB). Zielneigung aus 3 gebackenen Posen, Teamschema als Textur-Array-Schicht | **1 Draw Call je Team**, kein CPU-Skinning |
| bis zur Nebelkante | **Impostor-Sprites**: 8 Richtungen × Laufen/Stehen/Ducken/Liegen, beim Laden in Häppchen aus dem VAT-Mesh gerendert (≈ 100 ms) | 1 Draw Call |

- **Namensschilder** werden statt eines Canvas-Sprites je Bot ein instanzierter Quad-Batch mit Namensatlas.
  Die Regeln aus G06 bleiben.
- **Draw Calls bei 64 Soldaten im Bild:** ≈ 52 am Desktop und ≈ 28 am Handy statt ≈ 270.
- **Ragdolls:** höchstens 6 aktiv am Desktop und 2 am Handy (wie REALISM_PLAN C3). Ältere wechseln in einen gebackenen Todes-Clip.
- **Gesichter** bleiben verdeckt (C1). Die Farbfamilien „Nordwind“ und „Wüstenfuchs“ bleiben in allen Stufen erhalten.

### 7.3 Spitzen beheben, bevor skaliert wird (bots + core + world)

1. **Profil der Ausreißer** (138–284 ms) mit `tools/perf.mjs` und Ursachen-Bericht.
2. **Raum-Hash** `engine/spatial.js` (core) mit 16-m-Zellen. Kandidaten für `hostilesOf`, Hitscan, Explosionen und Klang.
   Damit endet O(n²).
3. **Inkrementelles A\*** mit Knotenbudget je Bild, fortsetzbar.
4. **Nav-Worker** (§4.5) für Wege über 60 m.
5. **Keine Allokationen je Bild** in Wahrnehmung und Gehirn: Vektor-Pools, Ergebnisobjekte wiederverwenden.
6. **Sichtstrahl-Budget** nach Stufe verteilen statt gleichmäßig. S0 bekommt immer ≥ 5 Hz Wahrnehmung.

### 7.4 Teamhirn und Trupp-KI

- **Teamhirn** (`bots/ai/commander.js`):
  - Alle 3 s eine Nutzwertrechnung über Flaggenwert, Bedrohung, Entfernung und Ticketstand.
  - Es verteilt die Trupps und hält immer mindestens einen Trupp in der Verteidigung.
  - Die Schnittstelle `mode.objectiveFor(bot)` (heute in `brain.js` genutzt) bleibt. Der Modus fragt das Teamhirn.
- **Trupp-KI** (`bots/ai/squad.js`):
  - Folgen dem Führer im Abstand von 4–8 m, Feuerschutz, Wiederbeleben, Spawn beim Trupp.
  - Antworten auf Pings und Befehle des Spielers, wenn er Truppführer ist.
  - Fahrzeug nehmen, wenn das Ziel > 150 m entfernt ist.
  - Klassenverhalten:
    - Versorger: wiederbeleben und Munition
    - Pionier: Fahrzeuge priorisieren, Seiten- und Heckpanzerung anvisieren, Minen auf Fahrzeugwegen
    - Aufklärer: Funkbake hinter der Front, Hochpositionen
- **REALISM_PLAN C6** (Lehnen an Deckung, Lampen, Rauch) gilt auch hier, nur in S0.

### 7.5 Fahrzeug-KI (`bots/ai/{driver,crew,pilot}.js`)

- **Fahrer:**
  - Pure Pursuit auf dem Fahrzeug-Nav (§4.5) mit einem Fächer aus 5 Hindernisstrahlen.
  - Feststecken: nach 3 s zurücksetzen und neu planen.
  - Panzer suchen Hinterhangstellungen. Unter 40 % ziehen sie sich zum Reparieren zurück.
- **Richtschützen** nutzen das vorhandene Zielmodell mit Vorhalt. Die Schwierigkeitsstufe skaliert den Zielfehler.
- **Piloten:**
  - Gesteuert über den Instruktor.
  - Libelle fliegt Wegpunkte 40–80 m über Grund und landet an Flaggen.
  - Skorpion kreist 60–120 m über dem Ziel und fliegt Angriffe.
  - Täuschkörper bei Aufschaltwarnung.
  - Komet (GK-4): Platzrunde und Verfolgung mit Vorhalt.
- **Fahrzeuge in S2** fahren „auf Schienen“ entlang der Routen.

---

## 8. Inhalte (parallel ab GK-0, Welle GK-C)

Alle Namen sind erfunden: keine echten Marken, Modellnummern oder fremde Musik.

### 8.1 Schusswaffen: von 23 (REALISM_PLAN §11.2) auf **33**

| neu | id | Name | Klasse | Muster | Klangprofil | Freischaltung |
|---|---|---|---|---|---|---|
| 1 | `cb_k4` | **K-4 Kurz** | Karabiner (neue Klasse `carbine`) | kurzer 5,56-Karabiner | `ar` | Stufe 6 |
| 2 | `cb_lx300` | **LX-300 Leise** | Karabiner | integrierter Schalldämpfer, Unterschall | `ar` + `gunsup_*` | Stufe 21 |
| 3 | `ar_bx20` | **BX-20 Brandung** | Sturmgewehr | Bullpup | `ar` | Stufe 14 |
| 4 | `lmg_mg7` | **MG-7 Mahlwerk** | LMG | Gurt, 7,62, Zweibein | `lmg` | Stufe 24 |
| 5 | `lmg_rk12` | **RK-12 Trommel** | LMG | Trommelmagazin, 5,56 | `lmg` | Stufe 11 |
| 6 | `mr_tk9` | **TK-9 Taiga** | Präzisionsgewehr | 7,62, halbautomatisch | `ar_heavy` | Stufe 17 |
| 7 | `sr_amboss` | **Amboss .50** | Scharfschützengewehr (`antiMateriel: true`) | Anti-Material, wirkt gegen leichte Fahrzeuge und Luft | `sniper_heavy` (neu) | Stufe 35 |
| 8 | `smg_pw4` | **PW-4 Schwarm** | MP (PDW) | Kompakt-PDW, hohe Kadenz | `smg` | Stufe 9 |
| 9 | `pi_flint9` | **Flint 9** | Pistole | Polymer, 17 Schuss | `pistol` | Stufe 4 |
| 10 | `sg_hagel` | **Hagel 12** | Schrotflinte | vollautomatisch, Trommel | `shotgun` | Stufe 28 |

- **Klasse `carbine`** heißt „Karabiner“ und kommt additiv in `WEAPON_CLASSES`, `CLASS_ORDER` und `CLASS_INFO`.
  Der KV-74K aus dem REALISM_PLAN bleibt Klasse `ar`.
- **Aufwand je Waffe** auf Basis des Aufsatzsystems (D-2) und des Gunsmith-Baukastens: ≈ 0,5–1 Agententag für Daten,
  Modell und Klangprofil.
- **Abnahme:** Jede Waffe liegt im TTK-Band ihrer Klasse (Balance-Simulation `tools/sim.mjs`).
- **Waffenspiel:** `GUN_GAME_STEPS` wird nicht verlängert; eine optionale Variante „Waffenspiel lang“ (33 Stufen) kommt später.

### 8.2 Werfer (Gadget-Platz, nicht in den 33 gezählt)

| id | Name | Art | Klasse |
|---|---|---|---|
| `l_faust` | **PF-3 Faust** | ungelenkt, Panzerabwehr | Pionier |
| `l_degen` | **LR-2 Degen** | drahtgelenkt (saclos) | Pionier |
| `l_wespe` | **FA-7 Wespe** | IR-Fliegerfaust | Pionier |
| `l_klopfer` | **UG-40 Klopfer** | Unterlauf-Granatwerfer (montiert an Sturmgewehr bzw. Karabiner) | Sturm |
| `l_leucht` | **LP-1 Leuchtpistole** | markiert Gegner in 15 m für 10 s | Aufklärer |

### 8.3 Granaten und Wurfmittel: von 2 (heute) bzw. 4 (REALISM_PLAN) auf **10**

| Platz | id | Name | Wirkung | Status |
|---|---|---|---|---|
| tödlich | `frag` | Splittergranate | wie heute | vorhanden |
| tödlich | `semtex` | Haftgranate | wie heute | vorhanden |
| tödlich | `incendiary` | **Brandsatz** | Feuerfläche 6 m, 8 s, 25 HP/s, Rauchsäule, sperrt Nav-Kanten für Bots | neu |
| tödlich | `impact` | **Aufschlaggranate** | explodiert beim Aufprall, Radius 4 m | neu |
| tödlich | `at_grenade` | **Panzerhandgranate** | 180 gegen Fahrzeuge, kleiner Splitterradius | neu |
| tödlich | `throwing_knife` | **Wurfmesser** | ein Treffer am Kopf tödlich, aufsammelbar | neu |
| taktisch | `flash` | Blendgranate | REALISM_PLAN §11.2 (R4, A6) | geplant |
| taktisch | `smoke` | Rauchgranate | REALISM_PLAN §11.2 | geplant |
| taktisch | `concussion` | **Erschütterungsgranate** | Schwanken, langsamer, Hörsturz über A6 | neu |
| taktisch | `sensor` | **Späher** (Sensorgranate) | markiert Gegner in 10 m für 6 s | neu |

Dazu kommen die Klassen-Sprengmittel aus §5.4: Sprengladung, Panzermine, Splittermine, Bewegungsmelder.

### 8.4 Nahkampf: von 2 (REALISM_PLAN) auf **8**

Neuer Ausrüstungsplatz `melee`; die Nahkampf-Aktion bleibt V. Jede Waffe hat ≥ 2 Schlagvarianten, Takedowns je
Familie (Klinge / Hieb / Spaß).

| id | Name | Familie | Besonderheit | Status |
|---|---|---|---|---|
| `knife` | Kampfmesser | Klinge | wie heute | vorhanden |
| `melee_beil` | Kampfbeil | Hieb | REALISM_PLAN D-3 | geplant |
| `melee_kralle` | **Kralle** (Karambit) | Klinge | schnellste Ziehzeit | neu |
| `melee_busch` | **Buschmesser** (Machete) | Hieb | größte Reichweite | neu |
| `melee_dolch` | **Grabendolch** | Klinge | Schlagring-Griff, Takedown 1,3 s | neu |
| `melee_spaten` | **Klappspaten** | Hieb | Stich und Schlag | neu |
| `melee_bajonett` | **Bajonett** | Klinge | sitzt am Gewehr; Ausfallschritt ohne Waffenwechsel | neu |
| `melee_pfanne` | **Pfanne** | Spaß | Easter-Egg-Belohnung (§8.7), wehrt von hinten 1 Kugel ab | neu |

### 8.5 Skins (`shared/cosmetics.data.js`, ui; Material-Hook: gunsmith, bots, vehicles)

**Waffentarnungen (60):** Projektion im Objektraum über einen Material-Hook, prozedural, **0 Download**.

| Gruppe | Anzahl | Inhalt |
|---|---|---|
| Muster | 36 | 6 Familien (Wald, Digital, Tiger, Stadt, Wüste, Schnee) × 6 Farbvarianten |
| Meisterschaft und Material | 12 | Brüniert, Kupfer, Patina, Karbon, Elfenbein, Damast, Bronze, Silber, **Gold**, Obsidian, **Glut**, **Nullpunkt** |
| Animiert | 8 | Polarlicht, Datenstrom, Funkenflug, Gewitter, Tiefsee, Signal, Puls, Lava |
| Geheim | 4 | Funkstille, Website, Quietsch, Dampf |

Animierte Tarnungen brauchen nur ein Zeit-Uniform und emissive Adern, also ≈ 0 ms.

**Weitere Skins:**
- **Operator-Outfits (24):** die 8 vorhandenen Varianten (Sturm, Späher, Funker, Grenadier, Schatten, Bastion, Kundschafter,
  Pionier) × 3 Ausführungen (Standard, Veteran, Elite). Jedes Outfit gibt es in beiden Team-Farbfamilien, das Gesicht
  bleibt verdeckt (C1).
- **Fahrzeugtarnungen (12):** Fleck, Splitter, Wald, Wüste, Winter, Stadtgrau, Nacht, Rost, Digital, Tiger, Gold, 8-Bit (Geheim).
- **Anhänger (16):** Erkennungsmarke, Würfel, Ente, Zwerg, Kompass, Patrone, Stern, Schlüssel, Nullkreis, Glocke, Funkgerät, Panzer, Hubschrauber, Wolf, Flamme, Herz.

**Teamlesbarkeit geht vor** (Lehre aus der Bodycam-Kritik, REALISM_PLAN §1.7):
- Outfits bleiben in den Farbfamilien „Nordwind“ und „Wüstenfuchs“. Ärmel- und Helmband in Teamfarbe ist fest.
- Umriss und Namensschild bleiben.
- Tarnungen gibt es nur an Waffen und Fahrzeugen, nie als Ganzkörper-Gegnerfarbe.

### 8.6 Fortschritt und Herausforderungen (core `shared/profile.js`, ui, `shared/challenges.data.js`)

- **Ebenen des Fortschritts:**
  - Spielerstufe bleibt 1–55 (Vertrag).
  - Waffenstufen kommen aus D-2.
  - **Klassenränge** 1–20 je Klasse schalten Gadgets und Outfits frei.
  - **Fahrzeug-Meisterschaft** 1–10 je Fahrzeug schaltet Seitwärts-Upgrades frei (Nebel+, Wärmebild, Täuschkörper+,
    Kettenpanzer) und Fahrzeugtarnungen.
- **Meisterschaft je Waffe:** 12 Muster → Gold. Alle Waffen einer Klasse in Gold → Glut. Alles → Nullpunkt.
- **Herausforderungen:**
  - **3 Tages- und 5 Wochen-Herausforderungen**, offline aus einem Datums-Seed gewürfelt (gleicher Tag ergibt gleiche Auswahl).
  - Pool von ≈ 60 Vorlagen, z. B. „Nimm 5 Flaggen ein“, „Belebe 10 Kameraden wieder“, „Zerstöre 2 Panzer mit der Faust“,
    „3 Messer-Takedowns“, „Fahre 5 km mit dem Floh“.
  - Dazu dauerhafte Meilensteine.
- **Profil v2:** Migration nach dem Muster von `cleanWeaponStats`, verlustfrei, Profil < 64 KB. Neue Felder:
  - `version: 2`
  - `cosmetics { owned, equipped: { weapon:{[id]:camo}, operator:{A,B}, vehicle:{[id]}, charm } }`
  - `challenges { daily, weekly, milestones }`
  - `classXp`
  - `weaponStats[id].xp` (D-2)
  - `vehicleStats { [id]: { kills, destroyed, timeS, distanceM, xp } }`
  - `secrets { [id]: true }`
  - `dogtags { [name]: count }`

  `recordMatch` wird additiv erweitert.

### 8.7 Easter Eggs (12; nur Kosmetik, kein Einfluss auf die Balance, kein Gore)

Die Karten melden `secrets: [{ id, position, trigger }]`. `modes/secrets.js` (ui) meldet `secret:found`, das Profil
speichert den Fund, die Website zeigt „x/12 Geheimnisse“.

| # | Ort | Auslöser | Belohnung |
|---|---|---|---|
| 1 | Talsperre | 7 versteckte Funkgeräte finden | prozeduraler „Nullpunkt-Marsch“ + Tarnung **Funkstille** (animiertes Rauschen) |
| 2 | Talsperre | Geheimraum hinter einer zerstörbaren Wand im Staudamm | Danke-Wand (Namen aus `CREDITS.md`) + spielbarer Arcade-Automat **„PANZERCHEN“** (2D-Panzerduell, Canvas → `CanvasTexture`, 3 Level, lokale Bestenliste) → Fahrzeugtarnung **8-Bit** |
| 3 | Talsperre | Traktor „Gertrud“ in der Scheune des Gutshofs | fahrbar; Hupe spielt ein Volkslied (gemeinfrei, prozedural) |
| 4 | Talsperre | Schafherde auf der Weide | flieht vor Fahrzeugen (unverwundbar); 3 min neben ihr stehen → Anhänger **Glocke** |
| 5 | Talsperre (Tag) | Mond durch das 8×-Visier ansehen | „0“-Krater sichtbar → Visitenkarten-Titel „Mondgucker“ |
| 6 | Hafen | 12 Gummienten finden | **Quietsch-Medaille** + Messertarnung **Quietsch** |
| 7 | Hafen | Kran „Grete“ ganz oben erklettern | Medaille **Höhenangst** |
| 8 | Altstadt | Kirchenglocke 3× treffen | Glocke spielt eine Melodie |
| 9 | Werk | 3 Dampfventile in der richtigen Reihenfolge anschießen | Dampfpfeife + Tarnung **Dampf** |
| 10 | alle Karten | je ein Gartenzwerg | alle gefunden → Anhänger **Zwerg** + Nahkampfwaffe **Pfanne** |
| 11 | Lobby | Konami-Code | Objektiv-Stil **„1942“** (Sepia, Filmkorn, Bildstand-Zittern; über den Objektiv-Pass R2) |
| 12 | Website | 10 × auf das 0-Logo klicken | Tarnung **Website**; selten (1 %) erscheint im Spiel der Bot **„Hauptgefreiter Nullpunkt“** mit goldenem Helm, Takedown → Medaille **Legende** |

---

## 9. Klang (audio)

- **Stimmenbudget:** höchstens 24 am Handy und 48 am Desktop (A9). Priorität = Klassengewicht × Lautheit / Distanz².
  Obergrenzen je Klasse:

  | Klasse | Desktop | Handy |
  |---|---|---|
  | nahe Schüsse | 12 | 6 |
  | Schritte (≤ 25 m) | 6 | 3 |
  | Motoren | 6 | 3 |
  | Explosionen | 6 | 6 |
- **Klangteppich der fernen Schlacht:**
  - Schüsse und Explosionen jenseits von 150 m werden nicht einzeln gespielt. Sie werden je 64-m-Sektor als
    Gefechtsintensität gesammelt (inklusive S1/S2-Gefechte).
  - Wiedergabe über 3 Schleifenschichten auf 4 positionierten Bett-Stimmen aus den Aufnahmen `gunfar_*` und `guntail_*`
    (A1), aus der passenden Richtung.
  - Das ergibt das Battlefield-Grollen, billig.
- **Fahrzeuge:**
  - Motor nach Drehzahl (Harmonische plus CC0-Aufnahmen), Kettenquietschen als Impulsfolge ∝ Tempo
  - Rotor mit 15–25 Hz Blattfolge, Turbine
  - Doppler per `detune`
  - Kanone mit langer Außenfahne und Ohrenklingeln (A6)
  - Fehlende Aufnahmen beschafft A10 (Motoren, Ketten, Rotor, Turbine), Lizenz CC0 und Eintrag in `docs/AUDIO_SOURCES.md`.
- **Schalllaufzeit** (vorhanden, A5) wird auf Großkarten spürbar: Ein Panzerschuss in 700 m ist ≈ 2 s später zu hören.
  Der Überschallknall kommt vor dem Mündungsknall.
- **Verdeckung:** zuerst die PVS (fast kostenlos), nur danach `lineOfSight` (≤ 8 je 16 ms, wie heute).
  HRTF nur für die 6 nächsten Quellen.
- **Hall:** Außen bleibt es trocken, Fahnen ≤ 1,5 s (A3). Das Raumgitter (A2) gibt es nur in Ortschaften.
- **Funk:** kurze prozedurale Funkmeldungen („Flagge Bravo verloren“, „Panzer gesichtet“) mit Band- und Rauschfilter,
  textgleich zum HUD. Abschaltbar.

---

## 10. Eingabe und Touch (core `input.js`, `shared/bindings.data.js`; ui Touch-Layout)

`bindings.data.js` bekommt **Kontexte** `infantry | ground | air` und analoge Achsen
`input.axis('throttle'|'steer'|'pitch'|'roll'|'yaw'|'collective')`. Der Touch-Layout-Editor (REALISM_PLAN S7) speichert
je Kontext.

**Neue Aktionen:**

| Aktion | Tastatur/Maus (Standard) | Gamepad | Bemerkung |
|---|---|---|---|
| `gadget_a`, `gadget_b` | 3, 4 | Steuerkreuz oben / links | **geteilt** mit `streak1`/`streak2` über `ALLOWED_SHARES` (`[['gadget_a','streak1'],['gadget_b','streak2'],['ping','streak3']]`): Auf Großkarten sind Serien aus oder liegen im Kommando-Rad |
| `ping` (kurz) / Kommando-Rad (halten) | B, mittlere Maustaste | Steuerkreuz rechts kurz / halten | geteilt mit `streak3` (Gamepad) |
| `map` | M | Back halten | Einsatzbildschirm; Back kurz bleibt Punktetabelle |
| `prone` | Z | B halten | F10 |
| `seat1…6` | 1–6 (nur im Fahrzeug) | Steuerkreuz | nicht F1–F6 (Browser) |
| `vweapon_next` | Mausrad, Q/E | Y | im Fahrzeug frei, weil Lehnen dort aus ist |
| `countermeasure` | X | LB | im Fahrzeug |
| `camera` | C | R3 | 1P/3P |
| `freelook` | V halten | L3 halten | |
| `zoom` | rechte Maustaste | LT | |
| Aussteigen | F (`interact`) | X | |
| Fallschirm | Leertaste | A | |

**Steuerung im Fahrzeug:**

| | Tastatur/Maus | Gamepad | Touch |
|---|---|---|---|
| **Boden** | W/S Gas und Bremse, A/D lenken, Leertaste Handbremse, Maus Turm, LMT Feuer, RMT Zoom | RT/LT Gas, linker Stick lenkt, rechter Stick Turm | schwebender Stick links (y = Gas, x = Lenken), rechts ziehen = Turm (+ Gyro S6), Knöpfe Feuer, Waffe, Zoom, Nebel, Sitz, Aussteigen, Kamera |
| **Luft** | Instruktor: Maus zeigt, W/S Schub bzw. Kollektiv, A/D gieren; „direkt“ optional | linker Stick Schub und Gieren, rechter Stick zeigt | Stick links Schub und Gieren, rechts ziehen (+ Gyro) zeigt, Knöpfe Feuer, Raketen, Täuschkörper, Aussteigen |

- **Infanterie auf Großkarten (Touch):** 2 Gadget-Knöpfe, ein Ping-Knopf an der Minikarte und ein Kartenknopf.
  Das Layout nach COD-Mobile-Art bleibt.
- **Jets auf Touch** gibt es nur mit vollem Instruktor und dem Schalter „experimentell“. Hubschrauber auf Touch haben die
  Schwebehilfe immer an. Das ist kein Simulator.

---

## 11. HUD, Minikarte, Menüs, Website

**HUD** (ui):
- **Flaggenleiste oben:** 5–7 Flaggen mit Fortschritt und beide Ticketzähler. Ausbluten wird animiert.
- **Fahrzeug-HUD** (`ui/hud-vehicle.js`):
  - Panzerdiagramm mit Zonenschaden, Turm relativ zur Wanne, Sitzbelegung, Nachladering, Überhitzung, Aufschaltwarnung.
  - Luft zusätzlich mit Fahrt, Höhe, künstlichem Horizont und Kursband.
- **Minikarte:**
  - Großkarten nutzen die gebackene Hillshade 2048².
  - Der Radius wächst mit dem Tempo: 60 m zu Fuß, 250 m am Boden, 600 m in der Luft.
  - Anzeige: markierte Gegner, Trupp (eigene Farbe), Fahrzeuge, Gefahrenzonen.
- **Punktetabelle für 64 Spieler:** 2 Spalten, nach Trupps gruppiert, scrollbar per Touch.
- **Killfeed bei 64 Akteuren:**
  - Gezeigt werden eigene Abschüsse, Trupp, Fahrzeuge und Abschüsse im Umkreis von 150 m.
  - Ferne Bot-gegen-Bot-Abschüsse werden zu „+3 Abschüsse an Flagge C“ zusammengefasst. Höchstens 6 Zeilen.
- **Weitere Elemente:** Kampfgebiet-Warnung, Am-Boden-Bildschirm (Ausbluten, Aufgeben, „Sanitäter unterwegs: 24 m“),
  Kommando-Rad.

**Menüs** (ui):
- **Lobby:**
  - Kartenklasse und Kartenvorschau mit Flaggen.
  - Regler bis 31 Verbündete und 32 Gegner mit den Warnstufen aus §3.2. Heute liegen die Grenzen bei `limits` 7/8.
  - Matchlänge, Serien-Schalter, Klassenwahl mit Gadgets, Nahkampfwaffe.
  - Tarnungsbildschirm mit 3D-Vorschau (Arsenal-Viewer wiederverwenden).
  - Herausforderungen.
- **Einsatzbildschirm:** große Karte, Spawnwahl, Klassen- und Ausrüstungswechsel.
- **Ende des Matches:** Tickets im Verlauf (kleine Kurve), Fahrzeugstatistik, Herausforderungsfortschritt.

**Website** (site):
- **Neuer Bereich „Fahrzeuge“:** 3D über `stage3d` und `createVehicleModel(key, { lod: 'showcase' })`, mit
  Werte-Balken aus `vehicles.data.js`.
- **Karten:** Hillshade mit Flaggen für Großkarten.
- **Modi:** Eroberung, Durchbruch.
- **Arsenal:** Karabiner, Werfer, Messer, Granaten, Tarnungen am Modell.
- **Profil:** Herausforderungen, Fahrzeugstatistik, „x/12 Geheimnisse“, Erkennungsmarken.
- **Spiel-Links:** `spielen.html?mode=cq&map=talsperre&allies=31&enemies=32`. Die Teamgrößen-Logik (G01/G02) nutzt
  `limitsFor` und kennt die Kartenklasse und die Geräteempfehlung.
- **Easter Egg 12** (Logo-Klicks) wird über `profile.secrets` gespeichert.
- Die Seite bleibt **ohne WebGL nutzbar** (Vertrag §10).

---

## 12. Architektur: neue Module, Besitzer, Vertragsergänzungen (alle additiv)

### 12.1 Neue Dateien und Besitzer

| Pfad | Besitzer | Zweck |
|---|---|---|
| `assets/js/game/vehicles/{index,vehicle,sim,seats,damage,vweapons,cameras,instructor}.js` | **vehicles (neu)** | `VehicleSystem`, Simulation, Sitze, Schaden, Fahrzeugwaffen (gleiches `intent`-Schema wie `WeaponController`), Kameras, Zielführung |
| `assets/js/game/vehicles/models/*.js` | gunsmith | Fahrzeugmodelle (auch für die Website) |
| `assets/js/shared/vehicles.data.js` | vehicles | reine Daten: `VEHICLES[id] = { id, name, cls, drive, seats[{role, weapons, cams, exposed}], hull{mass, size, armor}, health, components, weapons, countermeasures, respawn, model, sound, stats }` |
| `assets/js/game/world/terrain/*.js` | world | §4 |
| `tools/bigmap/*.mjs`, `assets/maps/<id>/*` | world | Bake und gebackene Daten |
| `assets/js/game/bots/{crowd.js, ai/lod.js, ai/commander.js, ai/squad.js, ai/driver.js, ai/crew.js, ai/pilot.js}` | bots | §7 |
| `assets/js/game/modes/{conquest,breakthrough,squads,revive,secrets}.js` | ui | §5 |
| `assets/js/game/ui/{hud-vehicle,deploy,command-wheel,cosmetics,challenges}.js` | ui | §11 |
| `assets/js/game/weapons/projectiles.js` | ballistics | §6.6 |
| `assets/js/game/engine/{spatial,replay}.js` | core | Raum-Hash, Killcam v2 |
| `assets/js/shared/{classes,cosmetics,challenges}.data.js` | ui | reine Daten (Website nutzt sie) |
| `tools/perf.mjs`, `tools/sim-cq.mjs` | jeder (core führt) | Prüfstand, Bot-Simulation der Eroberung |
| `dev/{terrain,vehicles,crowd}.html` | world / vehicles / bots | Prüfseiten |

### 12.2 API-Ergänzungen

- **`G`:**
  - `G.vehicles` (`VehicleSystem`; auf Arena-Karten ein No-Op-Objekt)
  - `G.squads`
  - `G.match.scale`, `G.match.cls`
- **Actor:**
  - `vehicle`, `seat`, `squad`, `cls`, `downed`, `spotUntil`
  - Bots zusätzlich `simTier`
- **World:**
  - `heightAt(x,z)`, `normalAt(x,z,out)`, `inBounds(pos)`
  - `terrain` (null auf Arena-Karten), `pvs.visible(cellA, cellB)`, `cells`, `sectors`, `roads`
  - `vehicleSpawns`, `objectives.cq [{id, name, position, radius, heightBand}]`, `spawns.hq {A, B}`
  - `secrets`, `dynamic` (Zerstörungsschicht), `dynamicObstacles`
  - `collider` als Fassade mit unveränderter Methoden-API
  - `nav.findPathAsync(from, to, {agent})`
- **combat:**
  - `registerEntity(e)` / `unregisterEntity(e)` mit `{ id, team, alive, kind, position, raycast(), onDamaged(info), armor }`.
    Das ersetzt den Kniff, mit dem das Wachgeschütz `world.raycast` überschreibt.
  - `damage(…, { damageType: 'bullet'|'explosive'|'at'|'fire'|'melee'|'collision' })`
  - Kandidaten über `engine/spatial.js`
- **BotManager:** `simTier(bot)`; `stats()` zusätzlich `{ tiers:{S0,S1,S2}, losPerFrame, astarExpanded }`.
- **renderer:**
  - `preset` zusätzlich `{ viewDistance, grassRadius, treeLod, impostorDistance, maxFullBots, maxSkinnedSoldiers, cascades, vehicleCap, terrainPatch, splatLayers }`
  - `lens.setStyle(style)`
- **Daten:**
  - `MAPS[id].scale`, `MAPS[id].sectors`, `MAPS[id].viewDistance`
  - `MODES.cq`, `MODES.bt`, `limitsFor(modeId, mapId, tier)`
  - `EQUIPMENT[id].kind` mit `'gadget'`
  - `WEAPON_CLASSES.carbine`
  - `loadout.{cls, gadgetB, melee, camo}`
- **Eingabe:** Kontexte und Achsen aus §10. `input.setContext('infantry'|'ground'|'air')`.

### 12.3 Neue Ereignisse

- `vehicle:spawn|enter|exit|damaged|disabled|destroyed|fire`
- `projectile:launch|hit`
- `lock:start|acquired|lost`, `countermeasure`
- `ticket {team, value, reason}`
- `squad:order`, `ping`, `spot`
- `actor:downed`, `actor:revived`
- `destruct {pieceId}`
- `secret:found {id}`
- `bounds {state}`
- `deploy {actor, spawn}`

`kill` bekommt zusätzlich `vehicleId`, `roadkill` und `damageType`. Flaggen laufen weiter über `objective:update`.

### 12.4 Bildreihenfolge (Ergänzung zu Vertrag §2.1)

```
input → player → bots (Absichten) → vehicles.update (Festschritt, Türme, Sitze) → Kameras der Sitzenden
      → weapons (Granaten, Projektile) → mode → world (Gelände-LOD, Vegetation, Streaming) → effects → hud → audio → render
```

### 12.5 Arena-Karten schützen

1. Code für Großkarten lädt **nur per `import()`**, wenn `MAPS[id].scale === 'gross'`. Das betrifft `vehicles/`,
   `world/terrain/`, `bots/crowd.js`, die Trupp-, Teamhirn- und Fahrzeug-KI sowie `modes/conquest.js`.
   - `tools/preload.mjs` bekommt eine Ausschlussliste für diese Pfade.
   - Schlägt das Laden fehl, kehrt das Spiel mit einer Meldung in die Lobby zurück. Es gibt kein Fatal-Panel.
2. World-API, Actor-Schnittstelle, Ereignisse und `intent` bleiben. Neues ist additiv und steht im Changelog.
3. Die KI-Stufen S1/S2 und die Masse greifen erst auf Großkarten. Auf Arena-Karten wirken nur die Spitzenbehebung (§7.3)
   und die höhere Teamgrenze.
4. **Jede Welle** wird erst abgenommen, wenn diese Prüfungen grün sind:
   - `tools/smoke.mjs` auf allen Arena-Karten
   - Arena-Bildzeit und Draw Calls ± 5 % bei Standard-Teamgrößen
   - `tools/stills.mjs` ohne Abweichung
   - 5 Revanchen ohne Speicherleck

---

## 13. Abgleich mit REALISM_PLAN (keine Widersprüche)

| REALISM-ID | Wirkung in diesem Plan |
|---|---|
| §4.1 Budgets | GPU-Grenzen **unverändert** auch für Großkarten. Download: **Ausnahme GK-A1** nur in der Spalte „jede weitere Karte“ für die Kartenklasse `gross` (§3.5) |
| §4.3 Service Worker | wird Voraussetzung für Großkarten (GK-1, core/site) |
| R1 HDRI | Großkarten-Himmel. Die Sonnenrichtung stimmt mit dem Lichtkarten-Bake überein |
| R2/R3 Objektiv, LUT | Fahrzeugkameras über `lens.setStyle` (Erweiterung von `lensStyle`, §6.5). Easter Egg 11 nutzt den Pass |
| R4 Belichtung | Grenzen je Großkarte, Cockpit-Innenräume (Übergang Turm → Optik) |
| R5 Sonden-Gitter, A2 Raumgitter | **nur in Ortschafts-Volumen**. Draußen übernimmt die gebackene Lichtkarte, akustisch gilt „offen“ |
| R6 Höhennebel | trägt die Fernwirkung (Luftperspektive). Auf Großkarten Pflicht |
| R8 Kaskadenschatten (A-7) | auf Großkarten **Pflicht**. Ist A-7 bei Start von GK-1 nicht fertig, setzt world es dort um |
| R9 Lichter-Pool | Mündungsfeuer, Scheinwerfer der Nachtvarianten (GK-4) |
| R12 FSR1 | unverändert, wichtig auf Handys mit Großkarten |
| R16 Decals 2.0 | Kettenspuren, Brandflecken, Krater |
| R18 Unterdrückung | wird durch das Niederhalten-System (§5.7) gespeist |
| M1/M3/M8 | Gelände-Schichten aus `assets/lib`. Streaming light für Ortschaften. BC1 am Desktop |
| M2 Gegen-Kachelung | für **Gelände** von P2 auf **GK-1 (medium+)** vorgezogen. Für Arena-Karten bleibt P2 |
| G2 Instancing, G5 Quantisierung | Grundlage für Vegetation, Baukästen und HLOD |
| C1 Gesichter, C3 Ragdoll | Outfits mit verdecktem Gesicht. Ragdoll-Grenzen 6 Desktop / 2 Handy übernommen |
| C6 Bot-Taktik | gilt in S0 |
| F1/F4/F5 | im Fahrzeugsitz aus |
| F6 Überklettern | wichtig für Ortschaften, keine Änderung |
| **F10 Hinlegen** | für Großkarten **von P3 auf GK-2 vorgezogen** (Scharfschützen auf 1 km) |
| §9.2 Rapier | **unverändert**: „low lädt Rapier nie“. Fahrzeuge laufen ohne Rapier. Trümmer und Ragdolls wie E-1 |
| A1/A3/A5/A6/A9/A10 | Klangteppich aus `gunfar_*`/`guntail_*`, trockene Außenfahnen, Schalllaufzeit, Ohrenklingeln bei Kanonen, Stimmengrenzen, Fahrzeugaufnahmen beschaffen |
| §11.1 Modi | `hp`, `kc`, `inf`, `sd`, `gf`, `ctf` bleiben Arena-Modi. `hp` läuft zusätzlich auf Sektoren. Neu sind `cq` und `bt`. Der Regelsatz „Realismus“ gilt nicht für `cq`/`bt` v1 |
| §11.2 Waffen (D-3) | Basis der 33. Blend- und Rauchgranate sowie Kampfbeil bleiben dort |
| §11.3 Aufsätze (D-2) | Voraussetzung für die 10 neuen Waffen. Fahrzeug-Upgrades folgen demselben Muster |
| S1/S2/S6/S7/S9 | Kontexte, neue Aktionen, Gyro für den Turm, Touch-Editor je Kontext. Die Grafikseite zeigt Sichtweite, Gras und Bot-Detail |
| §13 Fahrplan | GK-0 läuft **parallel** zu Welle 1. GK-1 beginnt erst, wenn A-2, A-3, B-1, B-3 und B-4 stabil sind. GK-C beginnt mit Waffen nach D-2/D-3, mit Messern, Granaten und Tarnungen schon nach der Taktik-Platz-Infrastruktur aus D-3 |
| §3 WebGPU | Neubewertung nach GK-2 als Pfad „Ultra+“ (Vegetation, Culling). Keine Vorab-Abhängigkeit |

---

## 14. Fahrplan

Aufwand in Agententagen. Die Besitzer stehen in Klammern. „Abh.“ nennt die Abhängigkeiten.

### GK-0 — Fundament und Messung (≈ 12–16 Tage, sofort, parallel zu Realismus-Welle 1)

Ändert weder `renderer.js` noch `player.js`.

| Nr | Arbeit | Besitzer | Abh. | Aufwand |
|---|---|---|---|---|
| 0.1 | `tools/perf.mjs`: Szenarien Bot-Stress (63 Bots Hafen), Infanterie, Gratblick, Hubschrauber, Jet. p50/p95/p99 je Subsystem, Draw Calls je Pass, Dreiecke, `memoryEstimate`, Heap, KI-Stufen, Strahlen und A*-Knoten je Bild. Dazu `debug=1`-Overlay | core | – | M |
| 0.2 | Spitzen-Ursachen, `engine/spatial.js`, inkrementelles A*, Allokationen entfernen, Sichtstrahl-Budget nach Stufe | bots, core | 0.1 | L |
| 0.3 | KI-Stufen S0/S1 (`ai/lod.js`), Trefferzonen nach Haltungsklasse | bots | 0.2 | M |
| 0.4 | `bots/crowd.js`: VAT-Masse, Impostoren, Namensschild-Batch, Waffen-Silhouetten | bots, gunsmith | 0.3 | M |
| 0.5 | `limitsFor`, Lobby-Regler mit Warnstufen, Arena bis 12 v 12, Spawnprüfung > 10 v 10, Website-Teamgrößen | ui, site | 0.2, 0.3 | S |
| 0.6 | Spike `dev/vehicles.html`: `vehicles/sim.js`-Kern, Steppe und Mammut auf Test-Höhenfeld, Bot fährt eine Route, Touch-Fahren | vehicles, core | – | M |
| 0.7 | Spike `dev/terrain.html` (1,28 km CDLOD, RG8-Höhen, KTX2-Array-Splat, Nebel, 3 000 Bäume) und `dev/crowd.html` (63 Bots auf echten Handys, 10 min) | world, bots | 0.4 | M |

**Go/No-Go nach GK-0** (Tests T0.x in §15):
- Fällt T0.5 (Gelände) auf Handys durch: low bekommt nur Grenzland.
- Fällt T0.7 durch: Handy-Maximum hart 16 v 16, dem Nutzer offen mitgeteilt.
- Fällt T0.6 durch: vereinfachen, dann Rapier-Rückfall nur nach ausdrücklicher Entscheidung (§6.3).

### GK-1 — Schlachtfeld-Kern zu Fuß auf „Grenzland“ (≈ 22–28 Tage)

Abh.: GK-0; REALISM A-2, A-3, B-1, B-3, B-4 stabil; R8.

| Arbeit | Besitzer | Aufwand |
|---|---|---|
| `world/terrain/*` (Höhenfeld, CDLOD, Splat, Fassade für Kollider und Strahlen, `inBounds`), PVS | world | L |
| `tools/bigmap/` (Bake, Determinismus-Prüfung) | world | M |
| Vegetation mit Impostoren und Gras | world | M |
| Karte Grenzland (5 Flaggen, Sektoren) | world | M |
| Hierarchische Navigation, Nav-Worker, `findPathAsync`, Routen | world, bots | L |
| `cq`, Tickets, HQ, Trupps, Einsatzbildschirm, Klassen v1 + Gadget-Platz (Funkbake, Defi, Munition/Verband, Adrenalin, Bewegungsmelder), Am Boden / Wiederbeleben | ui, core, ballistics | L |
| Ping, Kommando-Rad, Markieren | ui, core | M |
| S2, Teamhirn, Trupp-KI | bots | L |
| Niederhalten, Fernballistik (Projektile für Gewehre > 120 m), Visier-Nullpunkt, Killcam v1 | core, ballistics, gunsmith | M |
| Klangteppich, Stimmenbudget, PVS-Verdeckung, Funkmeldungen | audio | M |
| HUD für Großkarten (Flaggenleiste, große Karte, Tabelle für 64, Killfeed-Filter), Service Worker | ui, core/site | M |
| Website: Modus Eroberung, Karte Grenzland | site | S |

**Ab hier fühlt es sich nach Battlefield an, auch auf Handys.**

### GK-2 — Bodenfahrzeuge und „Talsperre“ (≈ 32–42 Tage)

Abh.: GK-1.

| Arbeit | Besitzer | Aufwand |
|---|---|---|
| `vehicles/*` (System, Sitze, Schaden, Fahrzeugwaffen, Kameras), Floh, Steppe, Igel, Mammut, PAK-Stellung, Traktor | vehicles | L |
| Fahrzeugmodelle (4 + Traktor + Stellung), 3 LODs + Schaukasten, Tarn-Hook | gunsmith | L |
| `projectiles.js` (none/saclos), Panzerung, Faust, Degen, Panzermine, Sprengladung, Reparaturbrenner, Entity-Registry | ballistics, core | M |
| Eingabe-Kontext „ground“, Touch-Fahrzeug-HUD, `lens.setStyle` | core, ui | M |
| Fahrzeug-HUD, Minikarte mit Tempo-Zoom | ui | M |
| Motor- und Kettenklang, Fahrzeugaufnahmen (A10) | audio | M |
| Fahrer- und Besatzungs-KI, Fahrzeug-Nav, Hinterhangstellungen, Pionier-Verhalten | bots, world | L |
| Karte Talsperre (7 Ortschaften, HLOD, PVS, Impostor-Bake, Streaming high/ultra) | world | L |
| Zerstörung-lite Stufen 1–4 | world, ballistics | M |
| Hinlegen (F10 vorgezogen) | core, bots | M |
| Website-Bereich „Fahrzeuge“ | site | M |

### GK-3 — Luft (≈ 16–20 Tage)

Abh.: GK-2.

- Libelle, Skorpion, Distel, Flakstellung, Wespe, IR-Lenkung und Täuschkörper (vehicles, gunsmith, ballistics)
- Instruktor für Touch, Gamepad und Maus (vehicles, core)
- Eingabe-Kontext „air“ mit Touch (core, ui)
- Piloten-KI (bots)
- Fallschirm (core)
- Rotor- und Turbinenklang (audio)
- Wärmebild-Upgrade (gunsmith, bots)
- Modus Durchbruch `bt` (ui, bots)
- Killcam v2 (core, ui)

### GK-4 — Jets und Ausbau (≈ 16–22 Tage)

Abh.: GK-3.

- Komet: Desktop als Standard, Touch nur mit dem Schalter „experimentell“ (vehicles, gunsmith, bots)
- Luftraum 2,4 km und Kulisse 3,2 km (world)
- Zweite Großkarte **Nordküste** (world)
- Nacht- und Wettervarianten (REALISM G6)
- Krater (Zerstörung Stufe 5)
- GPU-Occlusion-Queries am Desktop
- Boote optional
- WebGPU-Neubewertung (REALISM §3)

### GK-C — Inhalte (≈ 22–28 Tage, parallel ab GK-0)

| Arbeit | Besitzer | Abh. | Aufwand |
|---|---|---|---|
| 6 neue Nahkampfwaffen, Platz `melee`, Takedown + Erkennungsmarken | ballistics, gunsmith, core, bots | D-3 (Beil) | M |
| 6 neue Wurfmittel (Brandsatz, Aufschlag, Panzerhand, Wurfmesser, Erschütterung, Späher) | ballistics, gunsmith, audio | D-3 (Taktik-Platz) | M |
| 10 neue Schusswaffen, Klasse `carbine`, Klangprofil `sniper_heavy` | ballistics, gunsmith, audio, site | D-2, D-3 | L |
| Tarn-Hook, 60 Waffentarnungen, 24 Outfits, 16 Anhänger, `cosmetics.data.js`, Tarnungsbildschirm | gunsmith, bots, ui | – | M |
| Profil v2, Herausforderungen, Meisterschaft, Klassenränge | core, ui | – | M |
| Easter Eggs 6–12 auf Arena-Karten, Lobby und Website (1–5 mit ihren Karten) | world, ui, site, audio | – | M |
| Website: Arsenal, Profil, Geheimnisse | site | – | M |

**Summe:** ≈ 120–156 Agententage brutto, ≈ 110–145 netto durch Parallelität.

**Reihenfolge-Begründung:**
- Zuerst die Messung, damit niemand auf Sand baut.
- Dann der Battlefield-Kreislauf zu Fuß, der auch auf Handys trägt.
- Dann Fahrzeuge, weil sie Gelände, Navigation und Kampf-Registry brauchen.
- Luft und Jets zuletzt, weil sie am teuersten sind und am wenigsten Geräte erreichen.
- Inhalte laufen parallel und sind für den Nutzer sofort sichtbar.

---

## 15. Abnahmetests

Werkzeuge: `tools/perf.mjs`, `tools/budget.mjs` (REALISM §14, neu `--scenario=bigmap`), `tools/smoke.mjs`,
`tools/stills.mjs`, `tools/sim.mjs`, neu `tools/sim-cq.mjs`.
Echte Geräte: Adreno 610/618/650, Mali-G57/G68, iPhone 11–13, dazu PCs mit GTX-1060-Klasse und Iris Xe.

**GK-0**
- **T0.1** `perf.mjs --scenario=bots63 --map=hafen` (headless, Referenzrechner): `BotManager` Ø ≤ 2,5 ms, p99 ≤ 5 ms,
  kein Bild > 30 ms in 3 min. Jeder S0-Bot nimmt mit ≥ 5 Hz wahr.
- **T0.2** 63 Soldaten im Bild: Soldaten-Draw-Calls ≤ 60 (high) bzw. ≤ 40 (low). Gesamt auf Hafen high ≤ 400.
- **T0.3** Trefferzonen nach Haltungsklasse gegen SkinnedMesh: Abweichung ≤ 5 cm bei 1 000 Zufallsstrahlen.
- **T0.4** Arena-Regression (§12.5 Nr. 4) grün, dazu 12 v 12 auf allen Arena-Karten 10 min ohne Konsolenfehler.
- **T0.5** Gelände-Spike: Adreno 6xx und iPhone 12 ≥ 30 FPS bei 350 m Sicht (Gelände-GPU ≤ 4 ms). Desktop ≥ 60 FPS bei 1 km.
- **T0.6** Fahrzeug-Spike:
  - 16 Fahrzeuge ≤ 1 ms Desktop und ≤ 2,5 ms Handy
  - kein Durchtunneln bei 30 m/s gegen eine 0,3-m-Wand (100 Läufe)
  - Touch-Fahren auf 2 echten Geräten
- **T0.7** Handy mit 63 Bots (S0-Grenze 6): Bots inklusive Animation ≤ 6 ms, gemessen in Minute 10.

**GK-1**
- **T1.1** `sim-cq.mjs`, Grenzland 16 v 16, 10 reine Bot-Matches (`timescale` 4):
  - ≥ 8 enden über Tickets nach 12–25 min
  - Flaggen wechseln ≥ 10 × je Match
  - kein Bot steckt > 15 s fest (Wachhund-Log)
- **T1.2** Desktop high, 32 v 32, 20 min: Median ≥ 60 FPS, 1 %-Tief ≥ 45. Keine Konsolenfehler, Heap ≤ 450 MB,
  Draw Calls ≤ 600.
- **T1.3** Handy low:
  - 12 v 12: Median ≥ 30 FPS, 1 %-Tief ≥ 24, in Minute 10 ≥ 30
  - 32 v 32 (rot gewarnt): läuft ohne Absturz, Median ≥ 22 FPS
  - GPU ≤ 160 MB, Heap ≤ 250 MB
- **T1.4** Laden ≤ 10 s Desktop, ≤ 20 s Handy. Download Grenzland im normalen Kartenbudget.
- **T1.5** Wiederbeleben, Trupp-Spawn, Ping und Einsatzbildschirm sind komplett per Touch bedienbar (Playwright-Touch + 1 echtes Gerät).
- **T1.6** Fairness: Das Protokoll zeigt 0 Spielerschaden durch S2-Bots. Zoom auf 400 m entfernte Bots zeigt kein Springen (Standbilder).

**GK-2**
- **T2.1** Bot-Mammut erreicht ≥ 9 von 10 Zufallszielen in höchstens 2 × (Weglänge / Tempo), ohne > 10 s festzustecken.
- **T2.2** Einheitentest `damage.js`: Mammut fällt nach 2 Faust-Treffern von hinten, 4 seitlich und 7 von vorn.
  Abpraller über 70°.
- **T2.3** Talsperre, Desktop high, 32 v 32 mit 10 Fahrzeugen: Median ≥ 60 FPS, Draw Calls ≤ 600, GPU ≤ 600 MB, Heap ≤ 450 MB.
- **T2.4** Talsperre, Handy low, 12 v 12 mit 8 Fahrzeugen:
  - Median ≥ 30 FPS, in Minute 10 ≥ 30
  - GPU ≤ 160 MB
  - Download ≤ 10 MB
- **T2.5** 8 Fahrzeuge kosten ≤ 2 ms CPU auf dem Handy.
- **T2.6** Neuling fährt den Touch-Parcours (Tor-Slalom + Turmziel) in ≤ 90 s, auf 2 Geräten.
- **T2.7** Eine zerstörte Wand öffnet die Nav-Kante: Ein Bot geht innerhalb von 5 s hindurch, `lineOfSight` ist frei.

**GK-3**
- **T3.1** Neuling landet die Libelle an einer Flagge in ≤ 2 min, mit Touch (Instruktor) und mit der Maus.
- **T3.2** Bot-Skorpion fliegt 5 × 10 min ohne Geländeabsturz. Täuschkörper brechen ≥ 70 % der Wespe-Aufschaltungen.
- **T3.3** Fallschirm aus 100 m landet sicher. Die Kampfgebietsgrenze wirkt auch in der Luft.
- **T3.4** Durchbruch-Simulation: Angreifer gewinnen 35–65 % von 10 Bot-Matches.

**GK-4**
- **T4.1** Komet bleibt 10 min im Luftraum. Auf Touch nur mit dem Schalter.
- **T4.2** Kein Z-Fighting bei 1 km, weder mit Reversed-Z noch im Rückfall (Standbilder).

**GK-C**
- **TC.1** Profil v1 → v2 verlustfrei, auch mit kaputten Daten (Einheitentest). Profil < 64 KB.
- **TC.2** Jede neue Waffe liegt im TTK-Band ihrer Klasse und erscheint im Arsenal der Website. Die Website läuft ohne WebGL.
- **TC.3** Jedes Easter Egg lässt sich per `debugApi`-Skript auslösen, meldet `secret:found` und ändert keine Balancewerte.
- **TC.4** Teamlesbarkeit: Standbilder mit allen Outfits und Tarnungen bei 20/50/100 m mit Bodycam-Linse.
  5 Testpersonen erkennen Freund und Feind zu ≥ 95 % richtig.
- **TC.5** Herausforderungen sind je Datum deterministisch und funktionieren offline.

---

## 16. Risiken und Gegenmaßnahmen

| # | Risiko | Gegenmaßnahme |
|---|---|---|
| 1 | **Bot-CPU** bleibt über 2,5 ms; dann trägt 32 v 32 nicht einmal am PC | GK-0 zuerst, Go/No-Go T0.1 vor jeder Gelände-Arbeit |
| 2 | Mittelklasse-Handys schaffen 32 v 32 nicht (CPU, Wärme) | Standard 12 v 12, Warnstufen, harte Grenze bei T0.7-Fehlschlag, offen kommunizieren |
| 3 | Die Erwartung „kranker als Battlefield“ wird enttäuscht | ehrliche Aussage vorab (§1), früh Standbilder aus GK-0.7 zeigen, Stärke in der Nähe ausspielen |
| 4 | Fahrzeug-KI verkeilt sich, Hubschrauber stürzen ab | eigene Tests T2.1/T3.2, Feststeck-Wachhund, Routen-Cache, „auf Schienen“ in S2 |
| 5 | iOS-Speichergrenze (≈ 1–1,5 GB) | Typed Arrays, kein Octree auf Großkarten, `budget.mjs` hart, low streamt nichts |
| 6 | Konflikt mit Realismus-Welle 1 in `renderer.js`, `player.js`, `input.js` | GK-0 berührt sie nicht. GK-1 erst nach A-2/A-3/B-1/B-3/B-4. Lazy-Loading schützt die Arena-Karten |
| 7 | Eigene Fahrzeugphysik: Tunneleffekte, instabile Federn | Teilschritte, analytische Federdämpfung, Spike T0.6, Rapier-Rückfall nur mit Entscheidung |
| 8 | Bake-Werkzeuge müssen gepflegt werden | deterministische Bakes mit Hash-Prüfung, Dokumentation in `tools/bigmap/README.md` |
| 9 | Teamlesbarkeit mit Skins, 64 Akteuren und Bodycam-Filter | feste Farbfamilien, Teamband, Umriss, Namensschild, Test TC.4 |
| 10 | Umfang (≈ 110–145 Tage) verdoppelt das Projekt | Wellen mit eigenem Nutzwert, Inhalte parallel, Jets als letzte, streichbare Stufe |
| 11 | Tiefengenauigkeit ohne `EXT_clip_control` | near 0,1 m und far ≤ 1 500 m plus Nebel, Cockpit im Viewmodel-Pass, Test T4.2 |
| 12 | Touch-Fliegen ohne Instruktor unspielbar | Instruktor ist Pflicht auf Touch, Jets dort nur experimentell |

---

## 17. Entscheidungen des Schiedsrichters (woher was stammt)

| Frage | Vorschlag 1 (Leistung zuerst) | Vorschlag 2 (Gefühl zuerst) | Vorschlag 3 (Architektur) | **Entscheidung** |
|---|---|---|---|---|
| Reihenfolge | Messung → Gelände → Fahrzeuge | Spikes → Kreislauf auf 0,5 km → Großkarte | Spikes → Großkarte → Boden → Luft | **Messung (1) + Kreislauf auf Grenzland (2) + Wellen (3)** |
| Kartengröße | 1,0 km | 1,2 × 1,0 km + 0,5 km | 1,2 × 1,2 km | **1,2 × 1,0 km im 1,28-km-Gelände + Grenzland 0,5 km**, 1,2 × 1,2 km erst für Nordküste |
| Fahrzeugphysik | eigene JS | eigene JS | Rapier auf allen Stufen | **eigene JS** (REALISM §9.2 bleibt, Bots, gleiches Verhalten). Rapier nur als Rückfall mit Entscheidung |
| Geländedaten | offline gebacken | prozedural zur Laufzeit | prozedural autoriert, offline gebacken | **prozedural autoriert, offline gebacken** (Ladezeit Handy, Determinismus) |
| Höhenformat | RG8 + Bilinear von Hand | R16 | R16-PNG | **RG8 + Bilinear von Hand** (Genauigkeit, Handy-Filterung) |
| Handy-Teamgröße | Standard 12 v 12, max 16 v 16 hart | Standard 12 v 12, bis 32 v 32 experimentell | Standard 12 v 12, Warnung ab 24 | **Standard 12 v 12, Regler bis 32 v 32 mit gelb/rot** (Nutzerwunsch); hart nur bei `deviceMemory ≤ 2` oder T0.7-Fehlschlag |
| GPU-Budget | innerhalb §4.1 | +35…200 MB | low +40 MB über §4.1 | **§4.1 unverändert** |
| Download | Ausnahme 8–10 / 20–25 MB | ≈ 6–10 MB | 20–60 MB | **Ausnahme GK-A1: 10/18/28/40 MB** |
| Navigation | 8-m-Knoten + Sektoren + Routen | 6 m + Cluster | 4-m-Kostengitter + HPA* | **4-m-Kostengitter + HPA* (3) + Routen-Cache (1)** |
| Klassen, Wiederbeleben, Trupps | – | ja | Trupps | **ja (2)** |
| Zerstörung | keine | Stufen 1–5 | Zäune und Mauern | **Stufen 1–4 in GK-2, Krater in GK-4** |
| Fernballistik | – | – | Projektile > 150 m | **Projektile > 120 m nur auf Großkarten + Visier-Nullpunkt** |
| Sitztasten | – | 1–6 | F1–F6 | **1–6** (F-Tasten sind im Browser belegt) |
| Fahrzeug- und Werfernamen | – | Floh, Steppe, Igel, Mammut, Libelle, Skorpion, Komet, Faust, Degen, Wespe | Luchs, Keiler, Dachs, Kranich, Hornisse, Sperber, Dorn, Lanze, Stachel | **Vorschlag 2 + Distel**, weil Vorschlag 3 mit Bot-Rufnamen kollidiert |
| Arena-Teamgröße | – | ≤ 10 v 10 | 8 v 8 | **12 v 12 nach GK-0** (Nutzerwunsch „mehr Bots“) |
| Serien auf Großkarten | – | – | aus | **aus, per Schalter an** |

---

## 18. Quellen

- [pcgamer] Battlefield 3, größte Karte (Bandar Desert): https://www.pcgamer.com/2012/07/16/battlefield-3s-biggest-map-re-discovering-the-classic-battlefield-say-dice/
- [EA] Battlefield 6, Klassenführer: https://help.ea.com/en/articles/battlefield/battlefield-6/class-guide/
- [mein-mmo] Battlefield 6, Modi-Überblick (Eroberung 32 v 32 mit Fahrzeugen): https://mein-mmo.de/en/all-modes-of-battlefield-6-overview,1518666
- [CDLOD] F. Strugar, Continuous Distance-Dependent Level of Detail: https://github.com/fstrugar/CDLOD
- [WT] War Thunder, „How the Instructor works“: https://wiki.warthunder.com/Instructor/How_the_instructor_works
- [rapier] `DynamicRayCastVehicleController`: https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html
  (lokal in `@dimforge/rapier3d` 0.21 vorhanden)
- [crowd] Massen-Instancing in three.js: https://discourse.threejs.org/t/one-draw-call-massive-crowd-performance-engineering-in-three-js/89928
- Lokal geprüft in der vendorten three r186:
  - `KTX2Loader` erzeugt `CompressedArrayTexture` bei `layerCount > 1`
  - `reversedDepthBuffer` und `EXT_clip_control` vorhanden
  - `WEBGL_multi_draw`-Pfad in `BatchedMesh`
- Projektintern:
  - `docs/ARCHITECTURE.md` (Vertrag §2–§11a, Changelog: Bots, Welt-Worker F52, Modi)
  - `docs/REALISM_PLAN.md`
  - `assets/js/shared/bindings.data.js` (`RESERVED_CODES`, `ALLOWED_SHARES`)
  - `assets/js/game/bots/names.js` (`CALLSIGNS`)
  - Messskripte `tools/out/design/{botcost,drawcalls,worldstats}.mjs`
