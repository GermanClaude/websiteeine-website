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
- 25.10.: **KV-47 (AKM) nach Foto neu gebaut** (Wunsch 24.10.: übrige Waffen auf M-17/P-9-Niveau, echte Fotos als
  Vorlage). Vorlage polnisches AKM 1971 (Armémuseum, CC BY 4.0, rechts + links), Gegenprobe gemeinfreies AKM-Foto.
  Die Studiofotos waren perspektivisch verzerrt (Kamera um die Hochachse gekippt) – vor dem Abnehmen entzerrt
  (k aus dem Spiegelabgleich beider Seiten), kalibriert über 880 mm Gesamtlänge, Visierlinie 375,6 mm (Soll 378).
  Neu: `kv47-ref.js` (Umrisse/Lagen in Fotopixeln, Quellen im Kopf), `holz-tex.js` (Baukasten G1: Lackholz,
  Pressstoff, Fischhaut), `kv47-tex.js` (Holzatlas 2048 × 512, Gehäuseatlas 1024 × 1024, Handy je halbe Kante),
  `ak-parts.js` (Baukasten G3 für alle AK-Abkömmlinge: Blech-U-Gehäuse, Deckel, Träger mit Ladehebel, Sicherungshebel,
  Visier, Lauf/Gasblock/Bremse, Gasrohr mit oberem Handschutz, unterer Handschutz, Schaft, Griff, Abzugsgruppe,
  Rippenmagazin, Bot-Stufe), `guns-kv47.js`. Bewegliche Teile: Träger + Ladehebel (Teil bolt, Hub 82 mm), Wahlhebel
  (Teil selector, D/E −13,6°/−20,5°), Magazin (Teil mag, Patronen über magfill). Eigene Prägungen statt Werkszeichen.
  Dreiecke max 208 000 / Standard 84 000 / Handy ≈ 44 000 / Bots ≈ 350, 12–13 Netze, Atlanten zusammen 35 MB (M-17 42 MB).
  Bauzeit im Container stark lastabhängig (gleicher Lauf: KV-47 Standard ≈ 1,5× M-17 Standard) – größter Posten sind die
  gezeichneten Atlanten (≈ 0,4–0,8 s, einmal je Sitzung). Vergleich Modell ↔ Foto: `tools/ref/vergleich.mjs` (Umrisse
  decken), Bilder vorher/nachher im Bericht.
- 25.10. (Nachbesserung nach der Prüfung, KV-47): **Anschlag** – die Visierlinie lag auf dem Kerbengrund, das Korn
  verschwand hinter dem Kimmenblatt; jetzt Kornspitze = Blattoberkante (y 780), U-Kerbe 3,6 × 3 mm, Korn 2,4 mm,
  Kornschutz oben offen, Visierfuß-Buckel/Knöpfe unter der Linie, Augenabstand 0,32 → Korn mittig in der Kerbe,
  Verdeckung 22 %. **Geometrie nach Foto**: Gehäuseheck unter dem Deckel, vorderes Verschlussstück als Platte mit
  flachem Niet, Visierfuß bis aufs Gehäuse, Gasblock mit Arm, Laufring und Lücke + Bajonetthalter mit Stiften,
  Korntrommel gefast und vorstehend, Kornfenster gerundet, Schaftkappe bündig (Distanzfeld nach Zeilenscan) mit Klappe,
  Schaftunterkante nach Spaltenscan (die alte Kontur hatte Schatten und Riemenbügel mitgenommen), Riemenbügel 340–470,
  Griff und Abzugsbügel-Platte oben ans Gehäuse, Magazin ohne Stufe, 4 Rippen als flach gewölbte Wülste (≈ 5 mm) +
  Feldstufe statt Nut, Gasrohr mit 8 gerundeten Sicken, Hülsen um die Enden des oberen Handschutzes in Holzgröße,
  Handschutz-Schwellung weich auslaufend, Visiermarken bündig, Hebelarm dicker, Schlüsselloch, links Prägungen V/X/V,
  Bot-Stufe mit Gasblock und offenem Bügel. **Holz**: oberer Handschutz zylindrisch abgebildet (glatte Normalen,
  Hirnholz an den Stirnflächen), Schaft oben/unten ohne Naht, Ton dunkler/brauner mit Flammung und Randabdunklung,
  Dellen dunkel statt erhaben, Grundglanz unter dem Lack schwach (sonst rosa Schleier). **Bauzeit**: Foto-Atlanten
  werden im Hintergrund in 6-ms-Scheiben gezeichnet (`textures.js` `scheduleAtlas`, Platzhalter sofort; Fotostudio und
  Prüfwerkzeuge warten mit `atlasesReady`), Netzweiten gröber. Messung (`tools/ref/mess.mjs`): Dreiecke max 224 486 /
  Standard 87 080 / Handy 42 830 / Bots 336, 12 Netze (Bots 3), Bau max 1,19 s / Standard 0,83 s / Handy 0,69 s / Bots
  23 ms (Container, Last ≈ 3; M-17 Standard im selben Lauf 1,29 s), davon Atlanten nur noch ≈ 20 ms im Bau (Rest ≈ 1 s in
  Scheiben), Kontaktgitter max 42 307 Dreiecke / 231 ms (Magazinrippen nur als sichtbarer Bogen), Texturen PC 30,7 MB,
  Handy eigene Atlanten 4,0 MB ohne Rauheitskarten (mit Mipmaps und den geteilten Stahl-/Magazinkacheln 8 MB).
  `tools/vorbau-test.mjs` prüft die KV-47 jetzt als Foto-Waffe (Platzhalter-Fall).
- 25.10.: **QX-90 (FN P90) nach Foto neu gebaut**. Vorlage: FN-Herstal-Studiofotos P90 Standard rechts/links + Mündungsseite
  (CC BY-SA 2.0), Gegenprobe gemeinfreies P90-Foto ohne Magazin. Die Fotos sind praktisch perspektivfrei (gespiegelte linke
  Seite deckt die rechte nach Skalierung 1,00979 auf ±2 px); kalibriert über 505 mm Gesamtlänge (3679 px/m), Prüfmaß
  Höhe 200 mm. Breiten aus Datenblatt (55 mm über die Spannhebelknöpfe) und Schrägansicht geschätzt.
  Neu: `qx90-ref.js` (Umrisse/Lagen in Fotopixeln, Quellen im Kopf), `polymer-parts.js` (Baukasten G12 für
  Kunststoffwaffen – Keiler, Wespe, K-36, BX-20: Innensechskantschraube, Taschen/Erhebungen/Langlöcher als Feld,
  durchscheinender Magazinkasten, Schmalband-Raster `gridBand` für Fotosilhouetten), `poly-tex.js` (Spritzguss-
  Oberflächen: Wolkigkeit, eingeformte Schrift, Kantenabrieb, Kratzer, Ringnuten), `qx90-tex.js` (Rahmenatlas
  2048 × 1024, Gehäuseatlas 1024 × 512, Handy halbe Kante), `guns-qx90.js`. Rahmen aus Schaftschale/Oberrahmen und
  schmalerem Griffmodul (Stufe wie am Original), Daumenloch und Abzugsschlaufe gerundet, Schaftkappe gestippelt; Lauf-
  und Visiergruppe als Guss mit Brücke über dem Magazin, Seitenschienen mit Schrauben, Knopf rechts/Wulst links;
  Ringvisier mit Fenster, Glas, Ringabsehen, Lichtsensor; Magazin (Teil mag) als Rauch-Polymer mit 50 quer liegenden
  Patronen in zwei Reihen (magfill), Zuführblock, Kappe, Teilstrichen; Spannhebel beidseitig (Teil charge, Hub 60 mm);
  Drehwahlschalter unter dem Abzug (Teil selector, Achse senkrecht → `meta.selector.axis: 'v'`, viewmodel.js dreht
  dann um die Hochachse); Feuerdämpfer mit Schrägschnitt und vier Schlitzen. Eigene Beschriftung statt Werkszeichen.
  Pixeltreppen der Kontursuche werden vor dem Distanzfeld begradigt (Douglas-Peucker 1,6 px) – sonst waagrechte Riefen
  auf Stirn und Schaft. Magazinschacht (anim/magwell.js): hinter dem Magazin steht der Halteblock des Schafts so hoch wie
  das Magazin; die Achse steigt jetzt 10° nach hinten (Freigang 141 statt 427 mm, das Magazin zog vorher durch den ganzen
  Schaft). Kontaktgitter je Waffe einstellbar (`b.meta.contactQuant`, Standard 3 mm; QX-90 3,5 mm → 41 000 statt
  53 000 Dreiecke). Augenabstand 0,2 (Verdeckung 35 % wie K-36/M-17), Reichweite 0,67 m (Mündung 227 statt 305 mm vor
  dem Griff). Bots: alle QX-90-Materialien mit Farbe in LOD_META (sonst baute die Bot-Stufe Alu-/Stahl-Kacheln nur zum
  Farbablesen, 135 → 9 ms). Messung (`tools/ref/mess.mjs`, Container, Last ≈ 2): Dreiecke max 198 854 / Standard
  77 478 / Handy 38 002 / Bots 360, 20/20/19/3 Netze, Bau max 1,6 s / Standard 0,9 s / Handy 0,7 s / Bots 9 ms (M-17 im
  selben Lauf 4,8 / 1,5 / 3,3 s / 28 ms), Kontaktgitter max 41 161 Dreiecke / 221 ms, Texturen PC 28,1 MB, Handy
  10,8 MB (mit geteilten Kacheln).
- 25.10.: **QX-90 Nachbesserung nach der Prüfung** (Urteil „nicht abnahmefähig“, 6 major / 10 minor). Atlas: die
  Zwischenleinwand fürs Zurücklesen der Höhe lag ohne `willReadFrequently` auf der Grafikkarte – ein Generator-Schritt
  blockierte 0,4–2,2 s; jetzt im Hauptspeicher und jede Ebene in Teilschritten (längster Schritt max/Standard/Handy
  28/38/11 ms statt bis 2,2 s). Magazinwechsel wie am Original: hinten anheben (6° um die Vorderkante unten), dann
  schräg nach hinten (`anim/magwell.js` OVERRIDE `tilt`/`tiltS`); Bügel und Träger sind innen hohl wie der Bogen am Foto
  ohne Magazin (`magClear`) – Kollisionsprüfung der Magazinhülle: vorher 500–2 600 von 17 564 Punkten im Gehäuse/Rahmen
  über den ganzen Weg, jetzt 0–3 Randpunkte. Werkstoff: Kratzer nur noch in Farbe/Rauheit (nicht im Höhenkanal), Korn
  und Normalenstärke ≈ ⅓, Grundtöne nach Foto (Fotostudio: Optik/Rahmen 0,89 statt 0,50, Foto 0,97; Brücke 0,78, Foto
  0,77; Frontblock 0,60, Foto 0,51); Schaftkappe glatt mit Fuge statt Spalt; Magazin dunkles Rauch-Polymer, Patronen mit
  eigenem gedämpftem Material (`magfill` `roundMat`/`seg`). Fotodetails: Feuerdämpfer als Käfig (Taille, vier Fenster
  78/168/258/348°, innen weit, Innenkanten gerundet), Schlüsselloch vorn (Fenster mit Hals, Notvisier-Kanal mit Rundloch
  zwischen den „Ohren“, Optik oben 3 mm gefast, Lichtsensor im Hals), Seitenschienen als Profil (4 Stege, 5 Nuten,
  Nutgrund dunkel), gewölbter Abzug, der die Mulde füllt, Wahlscheibe vorn/hinten abgeflacht mit S-1-A auf der Scheibe
  (`schrift.js` `markTop` mit `part`/`std`), Magazinheck aus Rauch-Polymer mit Drehrampe, Sockel unten im Bogen,
  Frontblock nur unten dicker (keine Fuge mehr), Stirn und Brückenrücken von Hand begradigt (Normalen konstant statt 7
  Facetten). Hülse 5,7 × 28 als eigene Art `p57`. Augenabstand 0,22 → Verdeckung 32 % (kleinere Werte verdecken mehr:
  0,18 → 38 %). Handy-Atlanten 768 × 384 / 512 × 256 mit halben Normalen (eigene ≈ 2,9 MB statt 4,9 MB). Messung (Last ≈
  3,5): Dreiecke max 199 552 / Standard 76 500 / Handy 38 194 / Bots 360, 22/22/19/3 Netze, Bau max 1,56 s / Standard
  0,70–1,04 s (4 Läufe, Median 0,81 s; der Prüfer maß am Erstbau 0,88–1,15 s) / Handy 0,51–0,59 s / Bots 8 ms,
  Kontaktgitter 40 985 Dreiecke / 0,20 s, Texturen PC 28,4 MB, Handy 8,5 MB mit geteilten Kacheln.
