// QX-90: Maße und Umrisse vom Referenzfoto – FN P90 Standard (Ringvisier), Herstellerfotos von FN Herstal auf Wikimedia
// Commons, CC BY-SA 2.0 (Fotograf laut EXIF der Seitenansichten: Stéphane Moureaux, studioimage.be; verändert: nur Maße
// und Umrisse abgeleitet, die Fotos selbst sind nicht enthalten).
// Rechte Seite: https://commons.wikimedia.org/wiki/File:FN_P90_Standard_Submachine_Gun_Right_Side.jpg (Mündung rechts, 2127 px)
// Linke Seite:  https://commons.wikimedia.org/wiki/File:FN_P90_Submachine_Gun_Left_Side.jpg (Mündung links, 2127 px)
// Schrägansicht vorn (Visierfenster, Mündung, Breiten): https://commons.wikimedia.org/wiki/File:FN_P90_Standard_Muzzle_End.jpg
// Gegenprobe ohne Magazin (Magazinauflage, Halter, Bügel als Bogen): https://commons.wikimedia.org/wiki/File:FN_P90_PDW.jpg (CC0, DickClarkMises)
// Gegenprobe Feuerdämpfer, Abzug, geladenes Magazin: https://commons.wikimedia.org/wiki/File:FN_P90_01.jpg (CC BY-SA 4.0, Gabon100)
//
// Geraderichten: keine Drehung nötig (Oberkante Schaft/Magazin y 459 über 1050 px waagrecht, Laufachse y 592 an Laufmutter
// und Feuerdämpfer gleich). Perspektive: die gespiegelte linke Seite deckt die rechte nach einheitlicher Skalierung
// (Faktor 1,00979) auf ±2 px (Daumenloch, Abzugsschlaufe, Visierfenster, Spalt über dem Magazin) – kein Kippen der Kamera
// wie bei den AKM-Fotos, die Studiofotos sind praktisch perspektivfrei.
// Kalibrierung: Gesamtlänge 505 mm (FNH USA, Datenblatt P90 Standard) = 1858 px (Schaftkappe x 149 → Feuerdämpfer x 2006)
// → 3679,2 px/m. Prüfmaß Höhe: 736 px = 200 mm (Jane's nennt 210 mm – vermutlich mit Riemenöse/über alles gemessen; die
// Länge stimmt dagegen mit 500 mm (Jane's) auf 1 %). Breiten (quer) nicht aus dem Foto, sondern aus dem Datenblatt
// (55 mm über die Spannhebelknöpfe) und der Schrägansicht geschätzt (siehe HW unten).
// Bezug (Haltung, Anschlag): Griffanker x 1180 ↔ u = 0 – Mitte des schrägen Griffstegs unter dem Daumenloch (die Finger
// umgreifen seine Vorderkante 1290/835 → 1180/945, 45° geneigt), Laufachse y 592 ↔ v = 0,069 (v = 0 bei y 846).
// Linke Seite: Fotopixel (x2, y2) des linken Fotos → Fotopixel der rechten Seite über L2R (gespiegelt, gleicher Maßstab).
// Umrisse: tools/ref/kontur.mjs (Silhouette, Löcher), Bauteilgrenzen und Kleinteile von Hand aus vergrößerten Ausschnitten
// mit Koordinatenraster, Schraubenköpfe per Kreissuche (Hough) auf beiden Seiten.
export const PPM = 3679.2, XG = 1180, YB = 592, AXIS = 0.069;
export const U = (x) => (x - XG) / PPM;
export const V = (y) => AXIS + (YB - y) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);
/** Linke Seite: Fotopixel aus dem linken Foto → Fotopixel der rechten Seite (gleiche Waffe, Mündung links). */
export const L2R = (x2, y2) => [2140.3 - 1.00979 * x2, 80.5 + 1.00979 * y2 - (2140.3 - 1.00979 * x2 - 1824) * 0.0063];   // linkes Foto um 0,36° verdreht

// ---------------------------------------------------------------- Silhouette und Durchbrüche (kontur.mjs, Fotopixel)
export const SIL = [[1417,235],[1737,235],[1739,237],[1739,299],[1741,301],[1813,301],[1815,305],[1825,353],[1834,401],[1839,455],[1841,459],[1841,561],[1843,563],[1847,561],[1847,553],[1873,553],[1873,557],[1875,559],[1879,559],[1881,557],[1881,553],[1895,553],[1895,561],[1897,563],[1903,563],[1905,561],[1923,561],[1925,559],[1925,553],[1933,553],[1941,559],[1949,559],[1951,557],[1955,557],[1959,553],[1989,553],[1991,555],[1991,559],[1997,573],[1997,579],[1999,581],[1999,589],[2001,591],[2001,599],[2003,601],[2003,609],[2005,611],[2005,629],[2003,631],[1959,631],[1951,625],[1941,625],[1931,631],[1907,631],[1907,623],[1905,621],[1897,621],[1895,623],[1895,631],[1883,631],[1879,627],[1875,627],[1873,631],[1817,631],[1815,633],[1817,639],[1823,645],[1827,653],[1845,677],[1843,719],[1841,721],[1841,739],[1839,741],[1839,759],[1837,761],[1837,775],[1835,777],[1835,795],[1833,797],[1833,813],[1831,815],[1831,821],[1829,823],[1791,823],[1785,817],[1783,813],[1783,765],[1771,749],[1759,743],[1695,743],[1679,753],[1669,769],[1669,799],[1667,801],[1667,817],[1665,819],[1665,827],[1663,829],[1663,835],[1661,837],[1657,853],[1641,885],[1635,891],[1631,899],[1601,929],[1581,943],[1553,957],[1549,957],[1541,961],[1535,961],[1525,965],[1517,965],[1515,967],[1499,967],[1497,969],[1387,969],[1383,967],[1377,961],[1377,945],[1379,943],[1379,935],[1381,933],[1385,911],[1389,903],[1389,897],[1391,895],[1391,889],[1393,887],[1393,881],[1397,871],[1395,869],[1397,867],[1395,865],[1395,855],[1393,851],[1381,839],[1365,833],[1343,833],[1341,835],[1339,833],[1337,835],[1315,833],[1313,835],[1305,835],[1293,841],[1247,887],[1203,919],[1161,941],[1157,941],[1151,945],[1147,945],[1141,949],[1137,949],[1123,955],[1117,955],[1115,957],[1095,961],[1093,963],[1069,965],[1067,967],[1047,967],[1045,969],[895,969],[893,965],[885,953],[885,949],[879,945],[867,943],[847,935],[841,935],[815,925],[809,925],[783,915],[777,915],[745,903],[739,903],[737,901],[733,901],[713,893],[707,893],[681,883],[675,883],[667,879],[633,879],[625,885],[625,889],[621,897],[545,897],[543,895],[541,897],[539,895],[491,895],[489,897],[481,897],[479,895],[477,897],[237,897],[235,899],[197,899],[193,897],[191,901],[181,901],[179,899],[155,899],[151,895],[149,887],[151,885],[151,875],[153,873],[153,847],[155,845],[155,827],[157,825],[157,807],[155,803],[159,795],[159,763],[161,761],[161,615],[159,613],[159,565],[157,563],[157,539],[155,537],[155,515],[153,513],[153,495],[151,493],[149,465],[153,461],[157,461],[159,459],[177,459],[179,455],[181,457],[189,457],[193,461],[199,461],[201,459],[687,459],[689,457],[693,457],[695,459],[697,457],[703,457],[711,461],[729,461],[731,459],[1205,459],[1209,455],[1213,446],[1278,304],[1281,301],[1311,301],[1313,299],[1313,295],[1327,295],[1329,293],[1335,293],[1337,295],[1339,293],[1371,293],[1373,291],[1377,293],[1381,291],[1383,293],[1397,293],[1401,291],[1415,275],[1415,271],[1417,269]];
// 25.10. (Prüfung): Stirn des Gehäuses (x 1813–1841, y 301–459) und Rückseite der Brücke (x 1209–1281, y 301–455) von Hand
// begradigt – die Kontursuche lieferte dort 2-px-Treppen, die sich trotz Glättung als waagrechte Riefen abzeichneten (die
// Stirn ist im Foto leicht gewölbt: drei Punkte, die Brückenrückseite gerade).
// Daumenloch (Schusshand), Abzugsschlaufe (Abzug hinten, Stützhand vorn), Visierfenster im Brückenträger, Spalt über dem
// Magazin unter dem Träger, Fenster vor der Magazinkappe, Riemenschlitz unten in der Schaftkappe
export const THUMB = [[971,669],[1099,669],[1101,671],[1107,671],[1109,673],[1113,673],[1121,677],[1127,683],[1129,683],[1139,695],[1147,711],[1147,719],[1149,721],[1149,737],[1147,739],[1145,751],[1139,763],[1123,779],[1121,779],[1117,783],[1109,787],[1105,787],[1065,807],[1057,811],[1053,811],[1013,831],[1009,831],[1001,835],[993,835],[991,837],[969,837],[967,835],[953,833],[947,829],[939,827],[935,823],[927,819],[915,807],[915,805],[907,795],[901,783],[899,771],[897,769],[897,737],[899,735],[901,723],[913,701],[927,687],[949,675],[953,675],[961,671]];
// Abzugsschlaufe: hinten bis an die Rückwand der Abzugsöffnung (der Abzug steht darin, x 1330–1410)
export const GUARD = [[1457,675],[1467,675],[1477,675],[1485,677],[1501,685],[1509,691],[1513,699],[1521,707],[1531,711],[1545,723],[1555,741],[1557,749],[1557,769],[1553,783],[1547,792],[1535,805],[1521,813],[1513,815],[1487,815],[1467,805],[1453,791],[1449,781],[1439,781],[1435,777],[1400,777],[1340,777],[1334,770],[1332,700],[1338,672],[1360,664],[1395,664],[1420,690],[1431,685],[1441,679],[1447,677]];
export const SIGHT_WIN = [[1317,355],[1389,355],[1391,357],[1391,381],[1281,381],[1279,379],[1279,359],[1281,357]];
export const GAP = [[1377,407],[1409,409],[1433,413],[1453,417],[1475,421],[1497,425],[1525,429],[1557,433],[1587,437],[1611,441],[1639,445],[1649,449],[1659,457],[1645,457],[1635,455],[1357,455],[1361,443],[1369,425],[1375,411]];
export const FRONT_WIN = [[1705,459],[1711,461],[1715,467],[1717,477],[1713,487],[1707,493],[1707,529],[1705,533]];
export const SLING_SLOT = [237, 865, 329, 873];

// ---------------------------------------------------------------- Bauteilgrenzen (von Hand, Fotopixel)
// Schaftkappe (Gummi) hinten bis x 188 (Fuge), Schaftschale bis zum Griffmodul (Stufe x 651, Oberkante Griffmodul y 657 –
// das Oberteil des Rahmens steht seitlich über, im Foto ein dunkler Schattenstreif)
export const BUTT_X = 188, PANEL_X = 651, PANEL_Y = 657, PANEL_R = 22;
export const CREASE_Y = 650;            // weiche Längskante am Schaft (Ober-/Unterfläche, Licht wechselt)
// Gehäuse (Lauf- und Visiergruppe, schwarz, gegossen): Bereich über dem Rahmen (Rahmenoberkante y 592 unter der
// Magazinbrücke, y 637 weiter vorn) ohne Magazin; Brücke hinten (umgreift das Magazin), Träger oben, Frontblock, Unterteil
export const HOUSING = [[1192, 446], [1268, 284], [1852, 284], [1862, 637], [1330, 637], [1330, 592], [1196, 592]];
export const MAG_ZONE = [[1328, 457], [1702, 457], [1702, 547], [1328, 547]];      // Magazin + Spalt vor der Brücke
export const STRAP = [[1205, 459], [1213, 443], [1243, 398], [1376, 405], [1336, 466], [1330, 592], [1205, 592]];   // Bügelplatte (glatt) über dem Magazin
export const STRAP_FRONT = [[1376, 404], [1336, 466], [1330, 592]];                  // Vorderkante der Brücke (schräg)
export const BEAM_LOW = [[1376, 405], [1450, 418], [1550, 432], [1640, 446], [1660, 457]];   // Unterkante des Trägers
export const FRONT_X = 1660, LOWER_Y = 545, HOUSING_BOT = 637, BARREL_X0 = 1817;      // Frontblock ab x 1660; Unterteil ab y 545
// Dicker Teil des Frontblocks (Fotokante: senkrecht bei x 1722 ab y 427 abwärts) – darüber sind Träger und Front gleich
// breit (Prüfung 25.10.: der Breitensprung bei x 1660 über die ganze Höhe ergab eine Fuge, die es im Foto nicht gibt)
export const FRONT_BLOCK = [1722, 427];
// Schlüsselloch vorn (Mündungsseiten-Foto): Hals unter dem Visierfenster (halbe Breite, Tiefe m), U-Kanal des
// Notvisiers im Gehäuse vor der Optik (halbe Breite m, Unterkante y), Rundloch hinten im Kanal (y, Radius m) –
// links und rechts des Kanals bleiben die „Ohren“ des Gehäuses stehen
export const KEYHOLE = { neck: 0.0034, depth: 0.007, chW: 0.0054, chBot: 336, hole: [323, 0.0026] };
// Magazin herausnehmen wie am Original: hinten anheben (Drehung um die Vorderkante unten, rad), dann schräg nach hinten
// ziehen (anim/magwell.js) – Bügel und Träger sind innen hohl genug dafür (Foto ohne Magazin: Bügel = Bogen)
export const MAG_TILT = 0.105;
// Ringvisier (Optik, eloxiert): Block über dem Gehäuse; Fenster (Visierlinie y 262), Rundung hinten unten in das Gehäuse
export const OPTIC = [1418, 235, 1740, 300], OPTIC_FILLET = 16, SIGHT_Y = 262;
export const OPTIC_WIN = { h: 0.0128, w: 0.019, r: 0.004 };     // Fensteröffnung vorn/hinten (Höhe, Breite, Eckradius, m)
export const OPTIC_DOT = [1606, 291, 5];                          // Stift/Markierung seitlich
// Seitenschiene (beidseitig, mit 2 Innensechskantschrauben), runder Knopf rechts vorn (Rand gezahnt), Bogenwulst links
export const RAIL = [1415, 328, 1700, 405], RAIL_TEETH = [1480, 1640], RAIL_SCREWS = [[1446, 366], [1668, 368]];
export const KNOB_R = [1749, 357, 37, 27];                       // x, y, Rand, Kappe (px)
export const BOSS_L = [1778, 352, 24];                           // links: runder Wulst mit Punkt (Foto links)
export const SLOT_R = [1802, 348, 1826, 396];                    // rechts: gerundeter Schlitz neben dem Knopf
export const RECESS = [1733, 467, 1832, 545, 9];                 // vertiefte Fläche vorn am Frontblock (Eckradius px)
export const SIGHT_REAR = [1338, 288, 1392, 296];                // flache Erhöhung hinten auf dem Träger (Notkimme)
export const SERIAL_L = [1732, 438, 1812, 452];                  // Schriftfeld Nummer links (Foto links, gespiegelt)
// Magazin (Rauch-Polymer, 50 Patronen quer, zwei Reihen): Körper, hinterer Block mit Zuführung, Kappe vorn mit Haltenase,
// Bodenleiste; Strichskala (Fotos: Striche alle ≈ 65 px), Drehpunkt hinten oben
export const MAG = { x0: 733, x1: 1690, top: 458, bot: 537, rear: 790, foot: 529, cap: [1679, 1706, 452, 546] };
export const MAG_TICKS = [900, 945, 1010, 1075, 1140, 1205, 1270, 1335, 1400, 1462, 1525, 1590];
export const MAG_ARROW = [1585, 497, 1625, 512];                  // Pfeilmarke vorn (Einführrichtung)
// Magazinhalter hinten (beidseitig): Tasche im Rahmen und geriffelte Taste; runder Sockel darunter (Zuführung)
export const CATCH_POCKET = [633, 492, 735, 545], CATCH_TAB = [676, 492, 735, 545];
export const LUG = [740, 545, 846, 591, 7];                       // x0, y0, x1, y1, Eckradius (px); unten flacher Bogen
export const LUG_ARC = 9;                                          // Pfeilhöhe des Bogens unten (px, Mitte tiefer als die Ecken)
// Spannhebel (beidseitig, Teil charge): Stahlstange im Kanal unter dem Magazin, Knopf vorn mit Bügel und Stift
export const ROD = [1330, 594, 1640, 636], CH_KNOB = [1632, 583, 1730, 648], CH_PIN = [1655, 616, 8], CH_LOOP = [1690, 600, 1716, 629];
// Lauf und Feuerdämpfer (Radien m): Laufmutter, Bund, Rille, Bund, Hals, Dämpfer mit schrägem Stirnschnitt und 4 Schlitzen
export const BARREL = [[1817, 0.0095], [1850, 0.0095], [1850, 0.0109], [1872, 0.0109], [1872, 0.0093], [1883, 0.0093], [1883, 0.0109], [1898, 0.0109], [1898, 0.0083], [1910, 0.0083], [1910, 0.0109]];
// Feuerdämpfer (Fotos rechts und FN_P90_01, Mündungsseite): Käfig – hinten Ring, eingeschnürte Taille (Radius −1,7 mm
// zwischen x 1928 und 1968), vier große Fenster (≈ 4,6 × 16 mm, gerundete Ecken) unter 78°/168°/258°/348° (rechts
// gesehen: oben als Kerbe in der Kontur, eins knapp unter der Mitte), vorn dicker Ring mit Schrägschnitt; Innenraum weit
// (r 6,6 mm), hinten Laufbohrung
export const HIDER = { x0: 1910, top: 1990, bot: 2006, r: 0.0109, slots: [1921, 1980], slotW: 0.0046, slotR: 0.0014, bore: 0.0042, inner: 0.0066,
  waist: [1928, 1950, 1968, 0.0017], angles: [78, 168, 258, 348] };
// Abzug: breites, gewölbtes Blatt, das die hintere Mulde der Schlaufe füllt (Foto: Rückseite folgt der Öffnung, vorn
// hohl geschwungene Fingerfläche). Drehwahlschalter unter dem Abzug: Scheibe (Achse senkrecht), vorn/hinten abgeflacht –
// sichtbar sind die Laschen beidseitig (Foto rechts: x 1349–1438, Riffel 1400–1438), vorn endet sie bei x ≈ 1440
export const TRIGGER = [[1329, 722], [1332, 702], [1339, 687], [1350, 675], [1366, 668], [1395, 665], [1420, 672], [1430, 678], [1420, 688], [1413, 702], [1410, 720], [1410, 744], [1412, 762], [1413, 775], [1345, 776], [1335, 769], [1330, 752]];
export const SELECTOR = { c: [1393, 790], r: 0.0223, flat: [1349, 1440], h: 0.0062, tab: [1350, 778, 1452, 802], ribs: [1407, 1440] };
// Schrauben (Innensechskant, beidseitig gleich – die Schalen sind durchgeschraubt; Kreissuche auf beiden Fotos)
export const SCREWS = [[228, 564], [350, 850], [452, 544], [622, 820], [930, 892], [1148, 874], [1224, 702], [1496, 892], [1646, 700], [1824, 702]];
export const SCREW_R = 12;
export const PIN_HOLE = [855, 703, 4];                            // kleine Bohrung (Rastbolzen) am Griffmodul
export const EJECT = [770, 905, 862, 932];                        // Auswurföffnung unten hinter dem Griff (Lage geschätzt)
// Beschriftung links am Rahmen (Foto links, gespiegelt: Werksname des Vorbilds → eigene Beschriftung im Atlas)
export const TEXT_L = [855, 578, 1165, 600];
// S / 1 / A auf der Oberseite der rechten Lasche der Wahlscheibe (Foto FN_P90_01: weiß/orange auf der Scheibe)
export const SEL_MARKS = { s: -0.42, e: 0, a: 0.42 };            // Winkel um die Scheibenachse (rad, 0 = rechts quer)
// Breiten (halbe, m) – geschätzt aus Datenblatt (55 mm) und Schrägansicht
export const HW = { stock: 0.0255, upper: 0.0245, grip: 0.019, loop: 0.0165, hook: 0.0145, butt: 0.0258, strap: 0.026, beam: 0.0255,
  front: 0.024, lower: 0.0215, optic: 0.0135, mag: 0.0225, rod: 0.0236, knob: 0.0275 };
// Bot-Stufe: Umrisse aus denselben Bereichen gerastert und grob vereinfacht (Douglas-Peucker 6–7 px), Fotopixel
export const BOT_FRAME = [[189,457],[189,901],[621,897],[633,879],[668,879],[879,945],[895,969],[1045,969],[1124,955],[1181,931],[1305,835],[1366,833],[1393,851],[1397,867],[1377,961],[1387,969],[1497,969],[1580,944],[1631,899],[1663,835],[1669,769],[1695,743],[1770,748],[1783,765],[1784,816],[1829,823],[1845,677],[1815,638],[1330,638],[1329,593],[1196,593],[1194,545],[733,545],[732,459]];
export const BOT_THUMB = [[896,737],[928,685],[969,668],[1114,672],[1140,695],[1150,721],[1146,751],[1123,780],[991,838],[953,834],[914,807],[896,769]];
export const BOT_GUARD = [[1337,672],[1395,663],[1420,689],[1455,674],[1500,683],[1552,733],[1553,785],[1519,815],[1487,816],[1435,778],[1340,778],[1331,717]];
export const BOT_HOUSING = [[1192,459],[1196,592],[1329,592],[1330,637],[1815,637],[1813,301],[1418,300],[1417,284],[1398,293],[1281,301],[1209,455]];
