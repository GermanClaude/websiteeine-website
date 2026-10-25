# Waffen-Realismus – Umbauplan (Wunsch 13.10.2026)

**Ziel (Nutzer, 13.10.2026, mit Vergleichsbild AKS-74U):** Jede Waffe sieht aus wie das reale Vorbild, „haargenau
nachgebaut“: Proportionen, Bauteile, Schalter, Knöpfe, Oberflächen, Texturen, Glanz und Spiegelung so echt, dass es
wie ein Foto wirkt – realistischer als alles andere im Spiel. Danach (ab Do 15.10., 17:10) zieht der Rest des Spiels
grafisch nach (Charaktere, Umgebung, Licht, Texturen, Gegenstände; Waffen ausgenommen, die sind dann schon fertig).

**Was der erste Versuch gezeigt hat (13.10., Fassung 20261013165335):** Zusatzteile an den bestehenden Modellen
(Seitenschiene, Stifte, Hebel …) reichen nicht. Die Grundformen stimmen nicht (zu kastig, falsche Proportionen,
flache Flächen ohne Stanz-/Schmiedemerkmale), und die Materialien sind einheitlich statt gealtert. → **Jede Waffe wird
neu gebaut**, nicht ergänzt.

## Vorgehen je Waffe (eine Waffe pro Arbeitsrunde, Vorher/Nachher-Bilder an den Nutzer)

1. **Vorbild festlegen** (Tabelle unten) und Maße sammeln: Gesamtlänge, Lauflänge, Gehäuselänge/-höhe,
   Griffwinkel, Magazinkrümmung – aus Maßzeichnungen/Datenblättern; Fotos von beiden Seiten, oben, Mündung, Detail.
2. **Zerlegen in Baugruppen** wie beim Original (z. B. AK: gestanztes Gehäuse mit vorderem/hinterem Trunnion,
   Verschlussdeckel, Visierblock, Gasblock + Gasrohr, Handschutz oben/unten, Halteband, Pistolengriff, Abzugsbügel,
   Magazin, Schaft, Mündungsgerät, Putzstock). Jede Baugruppe mit echtem Querschnitt (`front`/`side`/`lathe` mit
   vielen Punkten, Fasen), nicht als Kasten.
3. **Oberflächenmerkmale modellieren**: Stanzsicken, Nietköpfe, Schweißpunkte, Gussnähte, Fräskanten, Rändel,
   Prägungen/Seriennummern, Rillen, Bohrungen – in Ego-Detailstufe echt geometrisch, in der Bot-Stufe ≤ 600 Dreiecke.
4. **Eigene Texturen je Waffe** (gunsmith/textures.js bzw. KTX2 aus assets/lib): Grundfarbe mit Kantenabrieb
   (Krümmungsmaske aus der Geometrie), Rauheitsvariation, Normal-Map für Stanzstruktur/Maserung/Bakelit,
   Brünierung/Parkerisierung/Eloxal; Holz mit Lackglanz (Clearcoat), Bakelit mit leichtem Glanz.
5. **Licht/Spiegelung der Ego-Waffe**: eigene Umgebungs-Map (HDRI aus assets/lib) für Reflexe, Clearcoat für Holz
   und Lack, Spitzlichter an Kanten; im Waffenlabor (dev/weapons.html) und im Spiel gegen Foto vergleichen.
6. **Aufsätze anpassen** (Optiken, Mündung, Unterlauf, Trommel) an die neue Geometrie; Anker (Hände, Mündung,
   Magazin, Ladehebel) neu setzen, Animationen prüfen.
7. **Prüfen**: tools/weapon-parts-test.mjs (keine schwebenden Teile), attach-test, smoke, Dreiecks-/Speicherbudget,
   Vorher/Nachher-Bogen (tools/out/wsheet.mjs + montage.mjs) an den Nutzer.

## Vorbilder (Zuordnung im Spiel → reales Vorbild)

| Spiel | Vorbild | Priorität |
|---|---|---|
| KV-47 | AK-47/AKM (bzw. AK-74-Familie, Nutzer zeigte AKS-74U) | 1 |
| M-17 Falke | HK416 / M4A1 (AR-15-Familie) | 1 |
| P-9 Kompakt | Glock 17/19 | 1 |
| Adler .50 | Desert Eagle | 2 |
| VP-9 Viper | HK MP5 | 2 |
| QX-90 | FN P90 | 2 |
| K-36 Kurzer | HK G36C | 2 |
| SK-14 | M14 / Mk 14 EBR | 3 |
| Brecher .338 | AWM / AXMC | 3 |
| Bulldog 12 | Remington 870 | 3 |
| HM-60 Hammer | M60 | 3 |
| BX-20 Stier | Steyr AUG | 3 |
| G-7 Wächter | HK G3 | 3 |
| KM-7 Wespe, SM-45 Keiler | Vector / UMP45 (im Bauplan prüfen) | 3 |
| LM-8 Bär | RPK / PKM (im Bauplan prüfen) | 3 |
| Titan .50 | Barrett M82 | 3 |
| HF-12 Hagel | Saiga-12 | 3 |
| R-6 Kobra | Revolver (S&W/Colt-Typ) | 3 |
| Werfer (RW-90, GW-40, GW-6) | Panzerfaust-/M79-/MGL-Typ | 4 |
| Messer, Beile, Granaten | jeweilige Vorbilder (KA-BAR, Karambit, M67 …) | 4 |
| UR-1, P-0, Erstlicht | eigene Entwürfe (AR-15 / Glock / Dolch als Basis) | nach Basis |

## Bewährtes Verfahren (P-9, 13.10. abends – Nutzer: „wenn die Waffe so aussieht … Respekt“)
1. **Seitenfoto** mit freier Lizenz (Wikimedia Commons, Studiofoto auf Weiß, genau seitlich) laden.
2. **Kalibrieren** über ein bekanntes Maß (Schlittenlänge 186 mm → px/m) und einen Bezugspunkt (Vorderkante,
   Oberkante Rahmen) – `p9-ref.js` rechnet Fotopixel → Modellmaße.
3. **Umrisse automatisch verfolgen** (`tools/out/refpoly.mjs`: Silhouette, Rand verfolgen, vereinfachen), Kleinteile
   (Abzug, Hebel, Stifte, Schriftfelder) aus vergrößerten Ausschnitten ablesen.
4. **Form aus Distanzfeldern** (`sdf.js`): Profil extrudiert mit Rundung, Bereiche mit eigener Breite (Rahmen, Bügel,
   Griff mit 22°-Linie) weich vereinigt, Nuten/Schlitze/Mulden abgezogen; Profile einmal als 2D-Raster vorgerechnet.
5. **Eigene Texturatlanten** (`p9-tex.js`) in Fotopixeln gezeichnet: Höhe → Normal-Map (Rillen, Raster, Gravur),
   Rauheit, Albedo; UVs je Dreieck per Seitenprojektion (`atlasUV`), Tarnmuster über `camoRepeat` angepasst.
6. **Prüfen durch Überblendung** mit dem Foto in gleicher Ansicht und gleichem Maßstab (`tools/out/cmp.mjs`,
   Fotostudio `bg/floor/fov/mu/mv`) – Kanten müssen deckungsgleich sein.
Kosten P-9: ≈ 72 000 Dreiecke (Ego), 328 (Bots), Bau ≈ 0,5 s + Texturen ≈ 0,45 s einmalig beim Laden.

## Stand
- 13.10.: Plan erstellt; erste Ergänzungen an KV-47/AR-Unterteil/P-9 sind live, ersetzen aber nicht den Neubau.
- 13.10. abends: **P-9 fertig nach Foto** (Glock 17 Gen 4) – Verfahren oben. Mündungsbohrung mit heller Krone an
  allen Waffen (`b.bore`, Test `tools/muzzle-bore-test.mjs`).
- 13.10. spät: **M-17 fertig nach Foto** (PEO-Foto M4-Karabiner mit RAS, gemeinfrei, um −14° gedreht;
  `m17-ref.js`, `m17-tex.js`, `guns-m17.js`). Schaft/Griff/Unter-/Oberteil/Kornträger als Distanzfelder, Handschutz
  und Magazin als Profil-Extrusion; ≈ 102 000 Dreiecke (Ego), 584 (Bots), Bau ≈ 0,37 s. Magazin jetzt deckend
  grau wie im Foto (Füllstand nur noch an der Öffnung sichtbar).
- Metall aus der Nähe: Fleckenrauschen bilinear statt blockig, feines Strahlkorn je Pixel, keine Anisotropie mehr
  (die Schlieren wirkten aus der Nähe falsch); Metallteile des M-17 mit fein wiederholten Rauheits-/Kornkarten.
- 13.10. nachts: **M-17 von allen Seiten** – linke Seite nach zweitem Foto (Colt M4, gemeinfrei): Trennfuge an der
  echten Stelle, Gehäusewulst, Verschlussfang mit Lageraugen, drehbarer Wahlhebel, gewölbte Stiftköpfe inkl. Hammer-/
  Abzugsstift, Gravuren; Schaft mit Batterieröhren, Steg (Rand, Felder, Rippe, Bolzen), durchgehende Riemenschlitze,
  Hebel + Riemenzapfen, Gummikappe mit Querrillen; Ladehebel mit Klinke, Klappkimme mit Trommel, A2-Feuerdämpfer mit
  echten Schlitzen, Magazinboden; Ober-/Unter-/Stirnflächen mit eigener Projektion (keine Schlieren). Flache Teile als
  Profil-Extrusion aus 2D-Konturen (`contours2D` in sdf.js). ≈ 117 000 Dreiecke.
- Feuermodi je Waffe nach Vorbild (`FIRE_SELECT` in weapons.data.js, Taste M, Touch-Knopf), Test tools/firemode-test.mjs.
- 13.10. spät: **PC-Detailstufe** (`DETAIL.max`, Handy leicht): Gebrauchsspuren-Shader `wearPatch` (materials.js) für
  M-17 und P-9 – vorzeichenbehaftete Krümmung aus Bildschirm-Ableitungen (außen fleckiger Abrieb, innen Schmutz und
  verdecktes Umgebungslicht), Unebenheiten als Normalenstörung im Bauteil-Raum, fleckige Rauheit, Farbschwankung des
  Eloxals; wenige flache Mikrokratzer statt Linienmuster. M-17 links: Trägerwulst in Originalmaß (≈ 29 mm, Schattenkante),
  Freischnitt über dem Verschlussfang, Magazinhalter-Arm in Fräsung, Prüfstempel; Schacht mit ausgestelltem Rand,
  Bügel-Lageraugen mit Stiften, runder Verschlussträger mit Rastkerben und Verschlusskopf im Auswurffenster,
  Magazinprägung.
- 14.10.: **Auswurffenster der M-17 nach Original** (Nutzer: „Hülsen-Teil zu unrealistisch“): Fenster ≈ 66 × 17 mm
  mit runden Ecken/Fase im runden Trägergehäuse (beidseitig r 14,3 mm), gewölbter Staubschutzdeckel als Distanzfeld
  (Scharnieraugen, Riegelnase, Stange, Drehfeder, Sicherungsring), Verschlussträger in voller Länge mit Rastkerben,
  Verschlusskopf mit sieben Warzen und Auszieher, Laufverlängerung mit Zuführrampen und Patronenlager, hohler
  Trägerkanal. Ablauf: Träger 82 mm Hub, Deckel schlägt in ≈ 20 ms auf, Hülse (5,56×45 nach Maß mit Zündhütchen,
  Lackring, berußtem Hals) startet an der Verschlussstirn (Anker `boltFace`), Mündung voran, Drall um die Hochachse,
  ≈ 4 Uhr; Rauch aus dem Fenster. Prüfen: `tools/out/eject-seq.mjs` (Bild-für-Bild-Bogen im Waffenlabor).
- Maßstab für alle weiteren Waffen (Nutzer 13.10.): P-9 und M-17 + KI-Video; Rest ab Do 15.10. 17:10.
- 24.10.: **Vorarbeiten für alle weiteren Foto-Waffen** (Nutzer: übrige Waffen auf M-17/P-9-Niveau, ohne Ruckler
  und Speicherhunger; M-17/P-9 optisch unverändert, je Stufe per Bildvergleich belegt):
  Baukasten `sdfkit.js` (sdfMesh, sideFurn, field2, cutWindow, fase …); Werkzeuge in `tools/ref/` (README); Gravuren
  je Waffe in einem Atlas (`schrift.js`, M-17 69 → 26 Netze; zu breite Texte kleiner gezeichnet); Bauteil-Cache
  `b.shared(id, fn)` – Aufsatz-Varianten teilen die Distanzfeld-Netze (M-17 je Variante 3–5 s/61 MB
  → < 0,15 s/< 2 MB); Atlas je Stufe (Handy halber Atlas `key@lite`, Bots ohne Atlas über `LOD_META`); Freigabe je
  Waffe (`holdWeaponModel` je Waffe und Stufe, `freeIdleWeaponModels` beim Matchstart und nach einem Stufenwechsel in
  der Lobby); Bots, Waffensteuerung und Lobby lesen für Aufsätze nur Metadaten (`getWeaponModelMeta`, höchstens
  Bot-Fassung – vorher je Bot-Waffe die volle Ego-Fassung samt Atlas); Detailstufe vor jedem Vorbau nach der
  Grafikstufe (`setWeaponDetail`, main.js `syncWeaponDetail` – vorher baute ein PC auf niedrig/mittel M-17/P-9
  zusätzlich in max); Schießstand baut nur die Ausrüstung voll vor, den Rest leicht (`lightTier`, `hasWeaponModel`,
  `preloadWeaponModels(keys, lods, tier)`) – die volle Fassung einer nicht ausgerüsteten Waffe entsteht beim Ausrüsten
  (Foto-Waffen am PC ≈ 1–5 s); Waffenspiel baut die ganze Leiter voll (Aufstieg ohne Bau mitten im Match), sonst
  nichts. M-17 Bots 580 Dreiecke; P-9 Handy bleibt beim Standard-Raster (gröberes Raster war im Bildvergleich
  sichtbar) und spart über den halben Atlas.
  Prüfen: `tools/waffen-cache-test.mjs`. Neue Foto-Waffe: Distanzfeld-Abschnitte in `b.shared`, Schrift über
  `schrift(key)`, Atlas-Material als `key`/`key@lite` (halber Atlas über `halfMaps`, `userData.texKey`) in
  `LITE`/`ATLAS` bzw. `defineMat(key, make, { lite, atlas })`, dazu ein Eintrag in `LOD_META` (Bot-Farbe) und in
  `PHOTO_MODELS` (models.js: gilt beim Aufheben als teuer, bevor eine Messung vorliegt).
- 24.10. (Vorarbeiten V1/V2/V5, zusammengeführt mit den obigen): Aufheben ohne Hänger (`weapons/hintergrundbau.js`) –
  Vorrat der Waffen, die Bots/Mitspieler tragen, im Ladebildschirm und im Leerlauf (Budget je Stufe); fehlt die Ego-Fassung
  einer Foto-Waffe, kommt ein Platzhalter in die Hand (Ego-Grundfassung bzw. Bot-Fassung), der Bau läuft nur im Leerlauf
  (tot, Pause, Countdown), der Tausch in Ruhe; Nur-Werte-Aufsätze (Munition, Schaft, Schnellmagazin) teilen Vorlage und
  Kontaktgitter (`STAT_ONLY`); Grafikstufe im Match → Waffen im Hintergrund in der neuen Stufe (`_retier`). Schießstand ohne
  Platzhalter (dort baut das Ausrüsten). Freigabe auf EINEM Weg (models.js `releaseTemplates`): `freeIdleWeaponModels`
  (Matchstart, Lobby), `releaseEgoTemplates` (andere Stufen nach `_retier`), `releaseWeaponTemplate` (ungenutzter Vorrat) –
  Halter je Viewmodel-Eintrag und Vorschau, Geometrie nur ohne weitere Nutzer (Bauteil-Cache), Bauteil-Cache und Atlas
  erst ohne Vorlage. Prüfen: `tools/vorbau-test.mjs`.
- 25.10.: **VP-9 Viper nach Foto neu gebaut** (HK MP5A5 mit Feuerstoß-Griffstück; Seitenfoto „HK MP5 noBG“ CC BY-SA 3.0,
  Detailfotos MP5A3 gemeinfrei, MP5 der PASKAL CC BY-SA 4.0, MP5 von A. G. Stumpf Filho CC BY 2.0 – siehe CREDITS.md;
  `vp9-ref.js` kalibriert über die Visierlinie 340 mm = 562 px). Blechgehäuse als Querschnitt Kasten + Spannhebelrohr
  mit Sicke, Auswurffenster mit Verschluss (Rollen, Auszieher, Anker `boltFace`), Nieten, Prägungen, Spannhebelschlitz
  mit Raste; Griffstück mit vertieftem Navy-Feld, Piktogrammen und Strahlkorn; Handschutz mit Fischhaut-Feldern;
  Kornhaube als Schnitt zweier Zylinder mit Fenstern, Trommelkimme (quer liegendes Rad mit Lochblenden); Schulterstütze
  mit Streben, Riegel und gerippter Gummikappe; Magazin gebogen mit Rippen und Patronen (`magRounds`). Neuer
  **HK-Baukasten** `hk-parts.js` (Querschnitt, Trommel, Kornhaube, Spannhebel, Haltestifte, Wahlhebel, Dreifach-Warzen)
  und `hk-tex.js` (Piktogramme) für G-7 (G3) und weitere HK-Waffen. Atlas-Lehre: Hilfsleinwände im Hauptspeicher
  (`willReadFrequently`) und Punktstrukturen als kleines Bild statt Tausender `fillRect` im Clip – Atlas PC 0,65 → 0,29 s,
  Handy 0,43 → 0,11 s (Software-GL). Kosten: max 222 k Dreiecke/19 Netze/≈ 1,3 s, std 84 k/17/0,85–1,0 s,
  lite 40 k/16/0,63 s, Bots 364/3; Kontaktgitter 43 k/0,22 s. Abweichungen vom Foto: Diopter Ø 7,8 mm statt ≈ 3 mm
  (sonst verdeckt die Trommel beim Zielen zu viel), Augenabstand 0,13, Oberfläche schwarz statt abgegriffen silbrig.
- 25.10.: **VP-9 nachgebessert (Prüfung)** – Loch unter dem Auswurffenster beseitigt (die Tasche hinter dem Fenster reicht
  nur noch über die Fensterhöhe; vorher schnitt die Längssicke durch die dünne Hohlraumwand, am Handy verschmolz alles zu
  einer Öffnung), Lauf beginnt im Kornträger mit Bund aus dem Fotoumriss (vorher 3–3,6 mm Luft), Wahlhebelachse vom Foto
  neu abgenommen ([557, 212] → [608, 225], ≈ 30 mm weiter vorn; PASKAL-Foto 3697 px als zweite Quelle, dort über dieselbe
  Visierlinie kalibriert: Bolzenabstand und Griffstückhöhe stimmen auf ≈ 1 %), Piktogramme in Originalgröße mit
  Spitzoval-Patronen und Doppelrahmen, Hebel 25 mm mit Flügel gegenüber dem Zeiger, Trommel Ø 18 mm mit Stellungsflächen,
  Kornträger als 3D-Gussform mit Stiften, Prägungen aus dem Foto (obere Rinne, Kante, Hülsenabweiser, Nietlasche, Mulde,
  Fenster mit runden Enden), Schachtlasche rechts, Halteplatte mit Schrauben links, Mulde um Magazinknopf, Endstück mit
  Fotomaß-Vertiefung, Schlitz, Riemenbügel; Fischhaut als erhabene Rauten; Navy-Feld entfernt (kein Fotobeleg); Lack
  glatter. Bauzeit: Atlas je Stufe (PC hoch 2048 × 640, PC niedrig/mittel 1536 × 480, Handy 1024 × 320 nur Albedo +
  Normalen ≈ 3,5 MB), Umrissfelder je Stufe gröber, Normalen ohne Modulo. Kosten (mess.mjs, Last ≈ 7): max 242 k
  Dreiecke/19 Netze/1,46 s, Kontakt 43 k/0,26 s; std 85 k/17/0,67 s; lite 41 k/16/0,49 s; Bots 364/3/14 ms. Erster Bau
  dreimal im selben Lauf mit P-9/M-17 (Last 6–7): VP-9 std 0,63–0,88 s, lite 0,45–0,96 s, max 1,8–2,6 s; P-9 std
  1,3–2,0 s, M-17 std 1,5–2,0 s (VP-9 std ≈ ½ P-9). Anschlag-Verdeckung 32 % (Augenabstand 0,14).
- 25.10.: **Adler .50 nach Foto neu gebaut** (IMI Desert Eagle Mark XIX .50 AE, 6″; Seitenfoto „Desert-Eagle-p1030134“ von
  Rama, CC BY-SA 2.0 fr, linke Seite „p1030133“ (Rama), Detailfotos „Desert Eagle Chrome“ und „Desert Eagle beside a box of Speer
  325 Grain HP“ (DeepThunder, CC BY-SA 3.0), „DesertEagle 50AE“ (Bobbfwed, CC BY-SA 3.0) – siehe CREDITS.md; `adler-ref.js`
  um −0,4° gerade gestellt, kalibriert über die Gesamtlänge 273,1 mm = 2150 px, Prüfmaße Lauf +2,6 %, Höhe −2,3 % wegen leichter
  Perspektive). Neuer Bauplan `guns-adler.js` (alte Funktion aus `guns-pistol.js` entfernt, P-9 unverändert): Schlitten als
  kurzer Block mit 45°-Fasen, Auswurffenster oben rechts mit Kanal zum Lager (Innenwände gestrahlt), Mulden der beidseitigen
  Sicherung, 14 schräge Griffrillen als Atlas-Normalen; Lauf + Rahmen als EIN Distanzfeld (Schiene mit Schwalbenschwanz-Kerbe
  und Querschlitzen, Schrägen zur Schulter, vertiefte Gravurfelder, Lager, Mündung mit 4,5 mm Bohrung und blanker Krone;
  Staubschutz bis unter die Mündung mit Trennfuge und Mulde der Führungsstange, eckiger Bügel, Sporn, Schlitze für Hahn und
  Abzug, unten offener Schacht, feine Fuge Lauf/Rahmen), Wickelgriff mit Kieselstruktur, glattem Rand und rundem Feld (eigenes
  Fadenkreuz-Null-Zeichen). Kleinteile: Kimme mit Rechteckkimme und Punkten, Korn mit Punkt, Sicherung (Nabe, Schlitzschraube,
  geriffelter Hebel, roter Punkt), gespannter Hahn mit geriffeltem Sporn, Abzug, Stifte, Schlittenfang links, Laufriegel rechts
  (Platte, Arm, Inbusachse) mit Knopf links, Magazinhalter (rechts Schlitzkopf, links Knopf); Magazin aus Edelstahl mit
  Zuführlippen, Sichtlöchern, breitem Boden nach Foto und `magRounds` (.50 AE). Gravuren als eigene Beschriftung (NULLPUNKT
  WAFFENWERK, Nummer), keine Herstellerzeichen. Atlas je Stufe 2048 × 1024 / 1536 × 768 / Handy 1024 × 512 ohne Rauheit; linke
  Seite in eigenem Band (keine Spiegelschrift). Neuer **Pistolen-Baukasten** (G6) `pistol-parts.js` (Kimme, Korn, Stiftköpfe,
  Schlitzschrauben, Inbusachsen, Druckknöpfe, Riffelung, Atlas-Profile, schnelles Umrissfeld `outlineField`) und `pistol-tex.js`
  (Gravur, Kieselmuster, Bürstenstrich, Körnung, Normalen) für Sperber, P-9A, Kobra. Bauzeit: erster Messlauf std 1,47 s (über
  Budget) – Profil: Umrissfelder (Rahmen 223, Griff 207 Punkte, Griff doppelt, exakter Rückfall außerhalb des Rasters),
  Detailkarten der Kleinteile, Normalen. Abhilfe: `outlineField` (exakt nur im Streifen um die Kante über Kanten-Fächer und
  Zeilen-Schnittpunkte – gleiche Werte, Rahmen PC 282 → 64 ms), Griff-Feld je Bau einmal, Schranken über/unter Rahmen und Lauf,
  Kleinteile mit den geteilten Strich-/Abriebkarten. Kosten (mess.mjs, Last ≈ 3,5): max 117 k Dreiecke/20 Netze/1,08–1,16 s,
  Kontakt 19 k/0,12 s; std 50,7 k/20/0,67–0,68 s; lite 26,3 k/17/0,46–0,50 s; Bots 198/3/18 ms (P-9 im selben Lauf: max 1,62 s,
  std 1,29 s, lite 1,41 s). Abweichungen vom Foto: Korn 5 mm statt
  1,8 mm hoch (Visierlinie parallel zur Laufachse), nur der hintere Schlittenblock bewegt sich (Schlittenarme unter dem Lauf
  fest am Rahmen), Verschlusskopf nicht gebaut (geschlossen vom Lager verdeckt), Griffanker wie alt (Hüfthaltung) bei echt
  maßstäblichem, 34 mm kürzerem Modell → `FEEL.reach` 0,66 → 0,6; Anschlag-Verdeckung 18 % bei Augenabstand 0,36 (Pistolenwert;
  Ziel 22–34 % – die Visierlinie liegt 92 mm über der Griffmitte, die Arme tiefer im Bild; 0,44 ergäbe 22 % bei winziger Kimme).
