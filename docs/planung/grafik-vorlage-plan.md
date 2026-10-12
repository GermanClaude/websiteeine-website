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
- **Karten, die im Video nicht vorkommen** (Grenzland, Bibliothek, Niemandsland, Schießstand; Altstadt nur der Platz):
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

## Reihenfolge
1. **Vergleichsbilder:** dieselben Blickwinkel wie im Video im Spiel aufnehmen (Hafen Containergasse, Werkhalle innen
   mit Laufsteg, Ziegelwand mit Tür, Gasse, Altstadt-Platz) → Seite-an-Seite mit `bild-*.jpg` (tools/out/sheet.mjs).
2. **Licht & Nachbearbeitung:** GTAO ab „hoch“ (halbe Auflösung), weichere Schattenkanten/Kontaktschatten, neutrales
   Tageslicht wie im Video (heller, weniger orange), leichte Filmkörnung, Lichtstrahlen in Hallen kräftiger.
3. **Materialien/Texturen:** höher aufgelöste Sätze auf „hoch/ultra“ für Wellblech, Ziegel, Beton, Kopfsteinpflaster,
   Container (mit Beschriftungs-Decals: Nummern, Warnschilder), Paletten; Rolltore, Laufstege mit gelben Geländern.
4. **Soldaten-Skin wie im Video:** Helm mit Bezug, Plattenträger, Taschen, Rucksack, Handschuhe, kantiges Splittertarn
   (Grün/Oliv/Braun/Schwarz) für beide Teams (Unterscheidung über Armbinde/Abzeichen + Namensschild), Ego-Arme passend.
5. **Third Person für Spieler:** Einstellung + Taste (V) + Touch-Knopf, Schulterkamera mit Kollision (nicht in Wände),
   Schulter wechseln, Fadenkreuz-Strahl von der Kamera + Mündungskorrektur, Ganzkörper-Animationen (Laufen, Sprinten,
   Ducken, Liegen, Zielen, Nachladen, Werfen, Lehnen, Messer), Zielen (ADS) wechselt in die Ego-Optik.
   Online: Host-Schalter „Third Person erlaubt“ (Standard an?) – Netzprotokoll prüfen (NET_VERSION).
6. **Je Karte nachziehen:** Hafen, Werk, Altstadt, Grenzland, Bibliothek, Niemandsland, Schießstand.
7. **Leistung:** Budgets je Stufe messen (Bildrate, Speicher). Ziel: flüssig auch auf älteren PC-Grafikkarten (eigene
   Stufe mit dem Video-Look ohne die teuersten Effekte). Handy darf bleiben wie es ist, aber nicht langsamer werden.
8. **Tests:** Vergleichsbilder vorher/nachher, smoke.mjs (Desktop + Handy), check.sh, preload, Kollisions-Hash,
   Third-Person-Test (Kamera kollidiert nicht, Treffer gehen dorthin, wo das Fadenkreuz zeigt).
