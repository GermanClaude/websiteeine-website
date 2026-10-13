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
- Nächster Schritt: KV-47 nach demselben Verfahren (Seitenfoto AKM/AK-74), dann M-17.
