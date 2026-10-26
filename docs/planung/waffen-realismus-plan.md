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
| ZW-12 Zwilling (neu, 26.10.) | Stoeger Coach Gun (Proportionen, 20″) + Baikal IZH-43E (Basküle, Details) | neu |
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
  **Nachbesserung nach Prüfung (25.10.):** Bot-Stufe war unvollständig – `simplifyPoly` lässt bei geschlossenen Ringen den letzten
  Punkt fallen (Schlitten 21 mm, Magazinboden 14,5 mm, Bügelöffnung 13 mm zu kurz); neu `simplifyRing` in `sdf.js` (`simplifyPoly`
  bleibt, sonst ändern sich M-17/P-9). Atlas je Dreieck (`atlasUVTri`: Bereich nach der Dreiecksmitte statt je Ecke → keine Naht
  links), Stirn-/Ober-/Unterflächen in isotropen Feldern (BLANK gebürstet, MATT = Rahmenoberfläche, INNER dunkle Innenwände) statt
  gestreckter Seitenstreifen, linke Bänder nur noch für Gravur und Nummer; Rahmen-, Bügel-, Griff- und Magazinboden-Umriss mit
  Douglas-Peucker 0,3 mm geglättet (2-px-Treppen spiegelten als Wellenbänder). Bügelöffnung nach Foto: Außenwände bis zum Bogen
  offen, Mittelsteg flach (±10,4 mm), vor dem Magazin tief (±5,2 mm), Abzugsschlitz nur vor dem Magazin; Rahmen eine Breite
  (27 mm), Sporn 22,4 mm über den Fotobogen `TANG_LINE` weich angesetzt (keine Risskante, keine Stufe am Griffrand), Griffumriss
  ohne Spalt, Magazinhalter auf der neuen Rahmenfläche. Sicherung nach Detailfoto: ovale Nabenplatte, schlanker Tropfenhebel
  (2,4 mm, rund gefast), erhabene runde Rippen statt schwarzer Kerben (`raisedRibs`, auch Laufriegel; die Kerben-Riffelung ist
  aus dem Baukasten entfernt), roter Punkt auf dem Hebel; Kimmenfuß im Schwalbenschwanz (Nut im Schlitten), Hahn mit gerundetem
  Sporn und 7 Zahnstegen. Mündung: Scheibe zeigt nach vorn (Kreisscheiben zeigen sonst nach hinten und sind nur mit DoubleSide
  sichtbar), Bohrung 8 mm tief – `muzzle-bore-test` prüft die Adler jetzt mit den echten Materialseiten (`--seiten` für alle).
  Magazinboden-Bohrungen bündig auf ihrer Fläche. Handy: Normalenkarte halbe Auflösung (Texturspeicher 5,8 → 3,8 MB).
  Kosten (mess.mjs, Last ≈ 8 durch parallele Läufe – Zeiten etwa doppelt so hoch wie bei Last 3,5): max 117,9 k Dreiecke/
  19 Netze/2,1–2,7 s, Kontakt 18,7 k; std 51,5 k/19/1,06–1,45 s (Texturen 18,5 MB); lite 26,3 k/17/0,80–1,10 s (3,8 MB); Bots
  228/3/19 ms; P-9 in denselben Läufen std 1,6–2,1 s, lite 1,9–3,1 s. Abwechselnd gegen den Stand vor der Nachbesserung gemessen
  (gleiche Last): std 1,08–1,14 → 1,13–1,16 s, lite 0,66–0,88 → 0,92–1,08 s, max 2,0–2,5 → 2,3–2,7 s – kaum Mehrkosten; bei
  Last 4–7 (Zwischenstand) std 0,91–0,98 s, lite 0,49–0,71 s. Bei ruhigem Rechner nicht nachgemessen.
  Anschlag-Verdeckung bleibt 18 % (Augenabstand 0,36): 0,40 → 20 %, ab 0,44 sind die Arme am Ende ihrer Reichweite; P-9-Griffdaten
  oder tieferer Griffanker kippen die Handlösung (Daumen über dem Visier, 39–47 %). Die P-9 hat dieselbe Visierhöhe über dem
  Griffanker (91 mm), die Ursache ist also nicht die Höhe allein – nicht abschließend geklärt, offen.
- 25.10.: **Etappe 1 zusammengeführt** (Zweig waffen-int: Bahn 1 KV-47/QX-90 + Bahn 2 VP-9/Adler). Konflikte nur in den
  Registern (models.js `PHOTO_MODELS` = m17, p9, kv47, vp9, qx90, adler; materials.js `LITE`/`ATLAS`/`LOD_META`, camos.js,
  CREDITS.md, FEEL-Reichweiten, Vorladeliste neu erzeugt); guns-auto.js enthält nur noch den HM-60. Der Merge selbst ändert kein
  Modell (Geometrie-Hash aller vier Waffen × vier Stufen gleich den Bahnen, Bilder pixelgleich; M-17/P-9 bitgleich, 45 Studio-
  und 18 Ego-Bilder pixelgleich). Beim Zusammenführen nachgezogen: Bot-Umrisse von KV-47 (AK-Baukasten) und VP-9 mit
  `simplifyRing` statt `simplifyPoly` (Befund der Adler-Prüfung: der letzte Ringpunkt fiel weg – KV-47 Schaft 9 mm, VP-9
  Schacht 29 mm/Kornträger 25 mm neben dem Fotoumriss); Bots jetzt 344 bzw. 380 Dreiecke, Anker gleich. Der M-17-Bot hat
  denselben Fehler (Oberteil 5,7 mm, Schaft 3,4 mm) und bleibt bewusst unverändert. Messung (mess.mjs, Last ≈ 3,5–4):
  KV-47 224 486 / 87 080 / 42 830 / 344, VP-9 241 804 / 84 984 / 41 444 / 380, QX-90 199 552 / 76 500 / 38 194 / 360,
  Adler 117 906 / 51 516 / 26 264 / 228 Dreiecke (max/std/lite/Bots); Bau std 0,72–1,13 s (QX-90 knapp über 1,0 s), lite
  0,50–0,68 s. Schießstand mittel: Laden 35 s (vorher 28 s), Heap 217 MB (188); Waffenspiel hoch: 69 s (53 s), Heap 612 MB
  (510) – die Leiter wird in max vorgebaut; für weitere Etappen dort nur die nächsten Stufen in max (Folgepunkt).
- 26.10. (Vorab Etappe 2): **Waffenspiel und Schießstand bauen nicht mehr alles im Ladebildschirm** (Folgepunkt aus Etappe 1:
  mit jeder Foto-Waffe länger und größer). Waffenspiel: Ladebildschirm nur die aktuelle und die nächsten zwei Stufen
  (`LADDER_AHEAD`, `weapons/hintergrundbau.js`), der Spieler startet gleich mit der Stufe-1-Waffe (vorher baute er die nie gezeigte
  Lobby-Ausrüstung mit); den Rest bauen Plan-Aufträge (`planWeapons`, main.js `planModeWeapons`) im Leerlauf (Countdown,
  Todesbildschirm, Pausenmenü) nach – die nächsten Stufen zuerst und dringlich, die Stufen hinter dem Spieler zuletzt. Fehlt beim
  Aufstieg die Fassung doch (Serie ohne Leerlauf), gilt die Platzhalter-Regel wie beim Aufheben. Online-Host: weiter die ganze
  Leiter im Ladebildschirm (seine Simulation läuft auch in seinem Leerlauf für alle weiter); VR: im Spiel keine schweren
  Plan-Schritte. Schießstand: nur die Ausrüstung, die übrigen Waffen im Leerlauf in der leichten Stufe (PC hoch: Vorlage + Shader,
  die volle Fassung beim Ausrüsten); die in der Waffenkammer gewählte Waffe entsteht noch im Pausenmenü voll. Leerlauf: Bauzeit wird
  auf Countdown bzw. Wiedereinstieg angerechnet (der Leerlauf wird genutzt, nicht länger), schwere Schritte nicht dringender Aufträge
  nur bei ≥ 0,75 s Rest, im Pausenmenü getaktet; Hintergrund-Schritte jetzt Vorlage → Shader/Texturen → Griffe → Kontaktgitter
  (kommt eine Waffe mitten aus ihrem Auftrag in die Hand, fehlt höchstens das Gitter). Hülsenarten aller Modus-Waffen weiter im
  Ladebildschirm (Schrot-Shader). Gemessen (Container, Software-GL, Last 5–12, je zwei Läufe gegen 3f13ab0): Waffenspiel PC hoch bis
  Spielbeginn 69/112 s → 56/48 s, JS-Heap 612 → 563/564 MB, Ego-Vorlagen im Ladebildschirm 1,54 M → 0,98 M Dreiecke (KV-47 entsteht
  im Countdown, Adler/P-9 in den folgenden Leerläufen); Schießstand PC mittel 36/56 s → 25/21 s, 218 → 194/181 MB; PC hoch 44 → 33 s,
  315 → 296 MB; Handy: Waffenspiel 225 → 210 MB, Schießstand 148 → 132 MB. Aufstieg: Fenster-Waffen 0–1 ms im Wechsel, gleiche
  GPU-Arbeit im Wechselbild wie vorher; nicht fertige Foto-Waffe ≈ 10 ms Platzhalter, alte Bauweise wie bisher sofort (≈ 50 ms).
  Prüfen: `tools/vorbau-test.mjs` (Abschnitte Waffenspiel/Schießstand).
- 26.10. (Prüfung der Vorab-Arbeit, nachgebessert): **Waffen alter Bauweise der ganzen Leiter im Ladebildschirm** (`ladderPrebuild`,
  je wenige Millisekunden und ≈ 1 MB – sonst baute der Aufstieg in einer Serie jede davon im Bild, Container 40–100 ms); dem Leerlauf
  bleiben nur die Foto-Waffen. **Leerlauf zuerst für Foto-Waffen** – der Waffenspiel-Plan baut nach der
  aktuellen Stufe die Foto-Waffen der kommenden Stufen (die nächsten `LADDER_AHEAD` dringlich), danach die Waffen alter Bauweise
  (die baut der Aufstieg ohnehin in Millisekunden), die Stufen hinter dem Spieler zuletzt; vorher baute der eine Todesbildschirm
  einer Serie die SK-14, Adler und P-9 kamen als Bot-Fassung in die Hand (Probe `aufstieg.mjs`). Begonnene Plan-Aufträge machen ihre
  leichten Schritte (Shader/Texturen, Griffe) auch in Ruhe – sonst lud der Aufstieg auf eine gerade im Tod gebaute Waffe Atlanten
  und Programme erst im Wechselbild. **Schießstand** plant nur noch Vorlage + Shader/Texturen (`warmOnly`, auch in der aktuellen
  Stufe): fertige Einträge samt Kontaktgitter aller Waffen hielten nach einem längeren Pausenmenü 235 MB statt der 217 MB des
  früheren Vorbaus, jetzt 216 MB; Eintrag und Gitter der in der Waffenkammer gewählten Waffe entstehen weiter im Pausenmenü.
  **Pausenmenü/Ausrüstung im Tod**: solange bedient wird (Eingabe vor < 1,5 s oder seit dem letzten Schritt – bei langen Bildern), keine schweren Schritte – nach der Nachprüfung auch nicht für die in der Waffenkammer gewählte Waffe; gebaut wird die zuletzt gewählte, sobald die Bedienung ruht, Aufträge abgewählter Waffen entfallen auch begonnen (vorher baute jeder Klick seine Waffe am Stück, bis 1,7 s)
  (ein Bau hielte den Klick bis zu Sekunden auf). **VR-Modus an** (Einstellung): Waffenspiel baut die ganze Leiter im Ladebildschirm
  wie der Online-Host (in der Brille keine schweren Plan-Schritte). Gemessen gegen 3f13ab0 (Container, Last 7–15): Waffenspiel PC
  hoch bis Spielbeginn 93 → 63 s, JS-Heap 612 → 564 MB; Schießstand mittel 34 → 29–32 s, 218 → 181–193 MB nach dem Laden, 217 → 216 MB
  nach vollständigem Plan. Prüfen: `tools/vorbau-test.mjs` (Abschnitte Waffenspiel, Schießstand, VR-Modus).
- 26.10.: **Neue Waffe ZW-12 Zwilling** (Doppelflinte mit Kipplauf; Nutzer „mehr Waffen, unterschiedlichere Waffen“):
  `zwilling-ref.js` (IZH-43E-Foto um +0,54° gedreht, 3,25 px/mm, Prüfmaß Lauf-Ø 20,3 mm; Läufe 508 mm, Kolben nach Coach Gun),
  `zwilling-tex.js` (Walnuss-Atlas 2048 × 512 / Handy 1024 × 256, Fischhaut Griff + Vorderschaft), `guns-zwilling.js` (Läufe als
  Drehteile mit Schienen, Distanzfelder für Schaft, Vorderschaft, Basküle; Teile barrels/toplever/extractor/shellR/shellL).
  Neuer Nachladestil **Kipplauf** als Baustein `anim/break.js` (Ego) + Bot-Rig 'break' (für Stummel/Hammer wiederverwendbar),
  zwei Mündungen (muzzle/muzzle2), `burstRpm` (Doppelschuss), `attSlots`, `botWeight`. Messung: Ego hoch 184 k Dreiecke / 22 Meshes (Bau 2,0 s),
  niedrig/mittel 73 k / 19 (0,9 s), Handy 40 k / 19 (0,6 s), Bots 176 / 2. Fotovergleich (Bereich Basküle–Vorderschaft): Foto→Modell 0,7 mm im Mittel.
