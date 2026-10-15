# Grafik nach Video-Vorlage (Start: Donnerstag, 15.10.2026, 17:10 Uhr)

Auftrag (Nutzer, 12.10.): Das von ihm mit Gemini erzeugte 10-Sekunden-Video ist die Vorlage für das Spiel
(`docs/planung/vorlage-video/vorlage-gemini.mp4` + Schlüsselbilder `bild-*.jpg`). Ziel:
- Grafik so nah wie im Browser möglich an das Video bringen,
- Third Person (Schulterkamera) für Spieler, mit allen Animationen,
- Soldaten-Skins wie im Video (am besten gleich),
- Texturen wie im Video,
- das Ganze auf **jeder Karte**.

## Präzisierung des Nutzers (12.10., verbindlich)
- **Zuerst der Computer.** Das Handy darf im Notfall ungefähr so bleiben, wie es jetzt ist.
- **Auch schwächere PCs mit älteren Grafikkarten** sollen es schaffen: Die neue Grafik muss auf einer eigenen, gut
  optimierten PC-Stufe flüssig laufen (Messung auf „mittel/hoch“, nicht nur auf „ultra“); teure Effekte gestaffelt.
- **Grafik und Texturen vom Video 1:1 übernehmen** – nicht den Inhalt/Aufbau der Szenen, sondern den Look: Materialien,
  Texturen, Farben, Licht, Schatten, Soldaten-Skin.
- **Karten, die im Video nicht vorkommen** (Altstadt, Bibliothek, Niemandsland, Schießstand; vom Grenzland nur der Dorfplatz – Nutzer 15.10.: der Platz im Video ist der leere Grenzland-Dorfplatz, nicht die Altstadt):
  so umsetzen, wie das Video sie zeigen würde – dieselbe Material- und Lichtbehandlung, dieselben Farbtöne, dieselbe
  Sauberkeit. **Keine eigene, abweichende Stilidee**, sondern strikt aus den Bildern ableiten. Vor jeder Karte festhalten,
  welches Videobild als Bezug dient (z. B. Ziegel der Werk-Gasse → Ziegel in Altstadt/Bibliothek-Mauern,
  Beton/Wellblech des Hafens → Industrie im Grenzland, Platz-Kopfsteinpflaster → Dorfstraßen).

- **Keine alten Texturen mehr** (so weit möglich): alle Oberflächen bekommen komplett neue Texturen im Stil des Videos,
  statt die bisherigen Fotoscan-Sätze nur nachzufärben. Der Stil ist deutlich **„3D-mäßig“**: saubere, leicht
  stilisierte Oberflächen mit echter Tiefe – gefaste/abgerundete Kanten, Wellblech/Ziegel/Pflaster mit plastischer
  Struktur (kräftige Normal- und AO-Karten, wo sinnvoll echte Geometrie), wenig Fotorauschen, klare Materialtrennung.
- **Jeder Gegenstand in diesem Stil:** Requisiten (Kisten, Paletten, Fässer, Container, Möbel, Zäune, Lampen …),
  Gebäude, Fahrzeuge, Waffen, Soldaten – nichts im alten Look stehen lassen. Vorgehen: Inventar aller Materialien und
  Requisiten anlegen (Liste), dann abhaken.
- **Auch alles, was im Video nicht zu sehen ist** (Nutzer 13.10.): z. B. Dächer, Dachaufbauten, Rückseiten, Innenräume,
  Böden, Unterseiten, Fahrzeuginnenräume – so gestalten, wie sie in diesem Stil aussehen würden (Material, Farbe, Licht,
  Kantenbehandlung aus dem nächstverwandten Videobild übertragen), und ebenfalls komplett neu machen. Nichts bleibt im
  alten Look, nur weil es im Video nicht vorkommt. Leitfrage je Fläche: „Wie sähe das im Video aus, wenn die Kamera hinschaute?“
- Weg zu den Texturen: eigene prozedurale Texturen (world/texgen) im Video-Stil und/oder passende freie Quellen, die
  auf den Look gebracht werden; optional schreibt Claude dem Nutzer Prompts, mit denen er nahtlose Texturen in Gemini
  erzeugt (dann Herkunft in CREDITS festhalten).

## Was das Video zeigt (Schnitte bei 1,5 s · 3,0 s · 7,5 s)
| Zeit | Inhalt | Merkmale |
|---|---|---|
| 0–1,5 s | Hafen/Lagerhallen, Ego-Sicht, Gewehr mit Rotpunkt, HUD-Munition „30“ unten rechts | Wellblech-Hallen, Rolltor offen, Paletten, Container rot/grün, klare Tagessonne, leichte Wolken |
| 1,5–3 s | Containergasse am Kai, Ego-Sicht | Container mit Beschriftung/Nummern, Portalkräne, rissiger Beton, harte, klare Schatten |
| 3–7,5 s | Werkhalle innen: Laufstege mit gelben Geländern, Kessel/Rohre, Lichtstrahlen durch Fenster; Third Person hinter Soldat an Ziegelwand mit Tür; enge Gasse zwischen Ziegel- und Blechwand | Volumetrisches Licht, starke Umgebungsverdeckung in Ecken, saubere Ziegeltextur |
| 7,5–10 s | Altstadt-Platz, Third Person, Mündungsfeuer; Titel „NULLPUNKT.“ (Punkt orange glühend) | Kopfsteinpflaster, Häuser mit roten Ziegeldächern, Brunnen, grüner Container, Bäume, blauer Himmel mit Cumulus |

**Soldat im Video:** Helm mit Tarnbezug, Plattenträger mit Taschen, Rucksack, Handschuhe, grünes
Splitter-/Waldtarnmuster in kantigen Flächen (Grün, Oliv, Braun, Schwarz), Gewehr im M4-Stil mit Rotpunkt.
Ego-Arme: Ärmel im gleichen Tarnmuster, dunkle Handschuhe.

## Ehrliche Einordnung (dem Nutzer am 12.10. so gesagt)
Das Video ist von einer KI gerendert, ohne Rücksicht auf Bildrate. Im Browser (WebGL2, three.js) ist der **Stil** gut
erreichbar: klare Sonne, weiche Schatten, Umgebungsverdeckung, Lichtstrahlen, scharfe PBR-Texturen, bessere Soldaten,
Third Person. Nicht 1:1 erreichbar: Lichtqualität wie vorberechnet bei 60 Bildern/s auf jedem Gerät. Auf PCs mit guter
Grafikkarte kommt man nah heran, auf Handys bleibt „niedrig“ deutlich einfacher.

## Stand am 12.10.
- GTAO nur auf „ultra“ (`engine/post/pipeline.js`, `preset.ssao`), Lichtstrahlen/Staub vorhanden (`world/atmos.js`),
  Fotoscan-Texturen (Poly Haven/ambientCG, KTX2), Kaskadenschatten, Sonden-Licht.
- Third Person nur in Fahrzeugen (Raum-Einstellung `thirdPerson` = „Außenansicht (Fahrzeuge)“).
- Soldaten: `bots/character.js` + `bots/soldier/materials.js` (Ausrüstungsvarianten, Teamfarben).

## Reihenfolge (Etappen, vom Nutzer am 12.10. festgelegt)
Jede Etappe einzeln fertigstellen, testen und hochladen. Reicht das Limit nicht, an der nächsten Etappe weitermachen,
sobald wieder Limit da ist. Vergleichsbilder neben dem Video zeigen (tools/out/sheet.mjs).

0. **Vorbereitung (kurz):** Vergleichsbilder der Video-Blickwinkel im jetzigen Spiel; Inventar aller Materialien,
   Requisiten und Modelle als Liste (zum Abhaken); Licht/Nachbearbeitung im Video-Look als Grundlage (GTAO ab „hoch“,
   weichere Schatten, neutrales Tageslicht), weil alles Weitere darauf beurteilt wird.
   *Stand 13.10. (vorgezogen):* Inventar fertig → `grafik-inventar.md`; Vergleichswerkzeug `tools/vergleich-video.mjs`
   (Video | Spiel aus fünf Video-Blickwinkeln, `--tag=nachher` für spätere Etappen), Vorher-Bilder gemacht.
   Offen für Do: Licht/Nachbearbeitung (Umgebungsverdeckung kostet einen zweiten Szenendurchlauf → nur mit Messung).
   Befund Vorher-Bilder: Spiel deutlich wärmer/gesättigter (Beige-Orange), Video kühl-neutral grau mit sattem Blau im
   Himmel; Werkhalle im Spiel dunkel ohne Lichtstrahlen (Video: helle Fensterbahnen, Staub); Altstadt-Pflaster zu
   orange (Video: graues Kopfsteinpflaster); Video-Oberflächen sauberer, kräftigere Struktur, weniger Fotorauschen.
   Blickwinkel `hafen-container` und `werk-halle` stehen zu nah an Containern/Presse → vor dem Nachher-Bild nachjustieren.
   *Stand 15.10. abends – Etappe 0 fertig:* Vergleichswerkzeug rendert jetzt durch die echte Bildkette (`--page=post`:
   Belichtungsautomatik eingeschwungen, Farbstufe, AO, Strahlen); Blickwinkel Containergasse/Querbrücke neu. Licht:
   Hafen Nachmittag (Sonne 34°, neutral-weiß, grauer Dunst, Wolkenhimmel prozedural, HDRI zwartkops), Werk Tag statt
   Dämmerung (Sonne 38°, Rückprall 2,6, kräftige Fensterstrahlen), Altstadt ohne Sandstich (Pflaster grau); Stimmungen
   `grade.js` neutral (keine Goldene Stunde/Dämmerung mehr, Abend bleibt als Tageszeit wählbar); Belichtungsreferenzen
   neu gemessen; Schattenkanten weicher (`shadow.radius 2,8`). AO ab „hoch“ in halber Auflösung mit 8 Proben
   (`aoScale`), „ultra“ voll. Lichtbalken nur noch vom Hellen ins Dunkle (Sonden-Himmelssicht), keine Schlitze in
   Werk-Gassen. Bilder: `tools/out/vergleich/vorher-post-bogen.png` ↔ `nachher-bogen.png`.
   Nutzer danach: „nicht mal annähernd wie das Video“ → Videobilder ausgemessen (HSL-Sättigung Video 0,10–0,14, Spiel
   0,29–0,37; Video grünlich-grau) → gemeinsame Farbstufe `VIDEO_LUT` (Sättigung ≈ 0,46, Grünstich, angehobene
   Schwärzen), Containerlack gedeckt (`videoTone` in props.js), Hafen-Terminal Beton statt Asphalt. Veröffentlicht als
   Fassung 20261015164134. **Größter Rest-Abstand: Texturen/Modelle** (Container ohne Rippen-Details/Beschriftung,
   Hallenwände, Ziegel, Boden) → Etappe 2 als Nächstes, danach Soldaten (Etappe 1).
   Nutzer danach: Grau gefällt, aber zu trist als einziger Look → **Einstellung „Farbstimmung“** (Grafik/Bild):
   „Natürlich“ (Standard, Sättigung ≈ 0,86) oder „Video-Look“ (VIDEO_LUT); Wetter/Tageszeit wirken relativ auf beide
   (satMul/contrastAdd/blackAdd). Wetter/Tageszeiten weiter in der Lobby wählbar (geprüft: Abend, Bewölkt).
2. *Stand 15.10. abends – Etappe 2 begonnen:* eigene prozedurale Texturen im Video-Stil (`v_container`, `v_concrete_slab`,
   `v_cladding`, `v_brick`, je 512/1024/2048, Höhenfeld → Normalen + Hohlraum-AO) statt der Fotoscans für Container,
   Beton (Platten mit Fugen/Rissen), Trapezblech und Ziegel. Weiter: Asphalt, Putz, Holz/Paletten, Laufstege/Geländer
   (gelb wie im Video), Rolltore, Containerbeschriftung als Aufkleber/Schablone, dann alle übrigen Sätze laut Inventar.
   **Nutzer 15.10. abends:** „1:1 übertragen“ – Boden-/Wand-/Haustexturen aus dem Video kopieren (das Video hat er
   selbst erstellt, Rechte liegen bei ihm), Häuser außen wie im Video, Innenleben passend selbst bauen, Einrichtung
   ebenso. Befund: Video nur 1280 × 720 und stark komprimiert – Flächen sind beim Entzerren verwaschen (Ziegel ≈ 12 px
   hoch, Boden fast ohne Feinstruktur; Werkzeug `tools/assets/lib/video-tex.mjs`: Boden über Kameramodell, Wände über
   vier Ecken entzerren, Licht herausrechnen, kachelbar machen). Deshalb: Farben/Helligkeiten/Muster werden am Video
   **gemessen** (`tools/assets/vorlage-measure.mjs`, Video ↔ Spielbild je Ausschnitt) und scharf nachgebaut.
   Messung 1: Schatten im Video ≈ 1/5 der Sonnenseite und neutral grau (Spiel 1/16, blau) → Füllicht Hafen/Werk ×2,5,
   Altstadt ×1,8, HDRI-Füllicht entbläut (`env.hdriTint`); Boden in der Sonne wärmer (Beton #aba293); Ziegel heller und
   oranger; Hallenblech mittelgrau-grün statt weiß.
   **Später (Nutzer):** im Grenzland-Fluss schwimmen statt durchlaufen, mit Schwimmanimation – nach der Grafik.
   **Nutzer 15.10. (Dorfplatz):** Dorf dichter wie im Video, Häuser samt Einrichtung, Bäume im Hintergrund wie im Video,
   Blick vermutlich von der Kirche aus (Mülltonne rechts). Umgesetzt: 10 weitere eingerichtete Häuser (`verdichtung()` in
   grenzland.js, Möbel in grenzland-innen.js), Pflaster bis an die Häuser, Brunnen mit Säule/Schale/Figur, grüne
   Mülltonne am Platzrand; neuer Laubbaum (Krone aus 15 Blattbüscheln mit eigenem Blatt-Atlas, Stamm mit Hauptästen,
   Fernmodell im selben Umriss; `LAUBBAUM` in atlas.js) für alle Laubbäume im Grenzland + 13 feste Dorfbäume
   (`vegetation.trees`); AO-Vorpass ohne alpha-getestete Karten (sonst graue Rechtecke um Baumkronen am Himmel).
   Vergleichsblick `grenzland-kirche` in tools/vergleich-video.mjs.
1. **Soldatenmodelle zuerst:** Skin wie im Video (Helm mit Bezug, Plattenträger, Taschen, Rucksack, Handschuhe, kantiges
   grünes Splittertarn), beide Teams (Unterscheidung über Armbinde/Abzeichen + Namensschild), Ego-Arme passend,
   Bots und Puppen (Mehrspieler) gleich.
2. **Hafen und Werk** (die Standardkarten, im Video zu sehen): alle Texturen neu, jeder Gegenstand im 3D-Stil.
3. **Kleinere Karten:** Altstadt, Bibliothek, Schießstand (aus den Videobildern abgeleitet, siehe oben).
4. **Modelle und Animationen:** Panzer, Geländewagen, Waffen, Granaten, sonstige Modelle im neuen Stil; alle
   Waffenanimationen (Ego: Nachladen, Repetieren, Inspizieren, Ziehen, Sprinten …) und alle Animationen der Soldaten;
   **Third Person** für Spieler (Taste V + Touch-Knopf, Schulterkamera mit Kollision, Schulter wechseln, Treffer dort, wo
   das Fadenkreuz zeigt, Zielen wechselt in die Ego-Optik, Ganzkörper-Animationen; online Host-Schalter, NET_VERSION prüfen).
5. **Große Karten zuletzt:** Grenzland, Niemandsland.
6. **Leistung:** Budgets je Stufe messen, eigene PC-Stufe mit dem Video-Look, die auch auf älteren Grafikkarten flüssig
   läuft (teure Effekte gestaffelt); Handy darf bleiben, wie es ist, aber nicht langsamer werden.

**Tests je Etappe:** Vergleichsbilder vorher/nachher, smoke.mjs (Desktop + Handy), check.sh, preload, Kollisions-Hash,
vorhandene Tests (tank-model-test, gunsound-test, feedback-test …); ab Etappe 4 zusätzlich ein Third-Person-Test.

## Stand 15.10. abends: Texturen 1:1 aus dem Video, Hafen nach Einstellung 1 + 2

- **Werkzeug:** `tools/assets/video_tex.py` (Spezifikation `tools/assets/video-spec/<karte>.json`) verfolgt eine Fläche
  über viele Videobilder (SIFT + Homographie), entzerrt sie (Wand: Viereck, Boden: Kameramodell f ≈ 772 px, Augenhöhe
  1,7 m) und mittelt die schärfsten Bilder → `tools/out/video/rect/`. `tools/assets/video_material.py`
  (`video-spec/<karte>-mat.json`) macht daraus kachelbare Sätze (Licht heraus, Rippen/Risse/Steine aus dem Video) →
  `tools/assets/video-src/` (nicht im Repo, neu erzeugbar) → `textures.mjs` (Quelle `video`) → KTX2.
- **Hafen:** Hallen-Wellblech `vh_wand`, Container in fünf Farbfamilien mit Video-Türseite (`vh_ctr_*`), Rissbeton
  `vh_kai` (dunkel, kühl, Farbe am Video gemessen). Standardwetter „bewölkt“ wie Einstellung 1 (`weatherStandard`,
  Bezugsbeleuchtung bleibt klar). Kamera der Einstellungen aus Fluchtpunkt und Torkanten zurückgerechnet
  (`vergleich-video.mjs` hafen-halle / hafen-container); Container, Paletten und Stapler danach gestellt.
- **Halle 4/5 (Nutzer: zweite Halle begehbar):** Lagerhalle vor der Stirnseite von Halle 3 (Süd, wie im Video) und
  gespiegelt im Norden; Rolltor, Tür, Fensterband, Regale, Paletten.
- **Pflaster:** `vp_pflaster` aus echten Video-Steinen im Läuferverband (keine Kreuz-/X-Fugen), Steine ≈ 27 cm.
- **Offen:** Pflaster unregelmäßiger (Video: gewölbte, ungleich große Steine), Grenzland/Altstadt-Putz und Dächer aus
  dem Platzbild, Werk (Einstellungen 3–5), danach Licht für die übrigen Tageszeiten/Wetter.
