// P-9A (Ableitung der P-9, 26.10.): Maße und Umrisse vom Referenzfoto einer Pistole des Typs Glock 18C (3. Generation, linke
// Seite, Mündung links, 19er-Magazin mit verlängertem Boden, Wahlschalter auf Einzelfeuer). Alle Werte in Fotopixeln dieses
// Fotos (2310 × 1764), die Umrechnung legt sie in das Maßsystem der P-9 (p9-ref.js, „P-9-Kalibrierung übernehmen“):
//   Schlitten 186 mm vorn x = 89 ↔ P-9-Foto 171, hinten x = 2110 ↔ 1579, Oberkante y = 85 ↔ 297 → 1 P-9-Fotopixel = 1,4354 px hier,
//   PPM = 7553 · 1,4354 = 10 841 px/m. Prüfmaß: Höhe Kimme bis Griffboden 1403 px = 129,4 mm (P-9: 130,8 mm, Gen 3 ≈ 1 % flacher).
// Quelle: https://commons.wikimedia.org/wiki/File:Glock_18C.jpg – „AmmuNation“, CC BY-SA 4.0 (siehe CREDITS.md). Foto nicht im
// Repo, nur abgeleitete Maße. Umrisse: Maske dunkel < 200, größte Komponente, Moore-Randverfolgung, Douglas-Peucker 2 px (Rahmen)
// bzw. 1,4 px; Griffrücken vorher geschlossen (11 px) – die Querrillen liegen als Textur/Normalen im Atlas, nicht im Umriss.
// Was das Seitenfoto NICHT zeigt (frei nach Hersteller-Angaben, im Bericht genannt): Kompensatorfenster oben im Schlitten und vier
// Bohrungen im Lauf (Glock-Begleitblatt G18/G18C: „vier Bohrungen im Lauf und ein Fenster im Schlitten“), rechte Seite, 33er-Magazin.
// Abweichung zur P-9 bewusst beibehalten: Die Schlittenunterkante liegt im 18C-Foto 1,3 mm tiefer (Gen 3/Aufnahme) – die P-9A behält
// den P-9-Schlitten (gleiche Mechanik, Hände, Animation), die Bedienteile des Rahmens sitzen wie im Foto (≈ 1,6 mm tiefer als bei der P-9).

export const PPM = 7553 * 2021 / 1408, X0 = 89, U0 = 0.1462, Y0 = 85, V0 = 0.0518 + 153 / 7553;
export const U = (x) => U0 - (x - X0) / PPM;
export const V = (y) => V0 - (y - Y0) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);
/** Modellmaße → Fotopixel (Atlas p9a-tex.js). */
export const photoX = (u) => X0 + (U0 - u) * PPM;
export const photoY = (v) => Y0 + (V0 - v) * PPM;

// Rahmen (Gen 3): Staubschutz mit Schiene, gerippte Abzugsbügel-Front, Fingermulden, schmalerer Griffrücken als Gen 4, Griffboden
// gerade (Magazin ragt heraus). Oberkante = Rahmenoberkante der P-9 (y 309), dahinter der Schwanz unter dem Schlittenheck.
export const LOWER = [
  [91, 309], [2108, 309], [2109, 323], [2111, 331], [2118, 331], [2128, 359], [2125, 382], [2118, 396], [2107, 406], [2092, 413],
  [2053, 417], [2030, 426], [2001, 446], [1978, 473], [1964, 499], [1954, 527], [1953, 581], [1967, 645], [1980, 687], [1984, 713],
  [2006, 779], [2028, 830], [2029, 841], [2041, 857], [2053, 883], [2066, 915], [2080, 939], [2094, 964], [2110, 988], [2124, 1013],
  [2139, 1037], [2166, 1086], [2179, 1111], [2191, 1136], [2202, 1161], [2211, 1178], [2220, 1214], [2227, 1235], [2240, 1284],
  [2245, 1339], [2243, 1357], [2231, 1380], [2202, 1410], [2182, 1423], [2162, 1428], [2102, 1433], [1697, 1433], [1692, 1423],
  [1653, 1382], [1632, 1346], [1630, 1326], [1635, 1303], [1634, 1288], [1624, 1261], [1619, 1235], [1603, 1203], [1600, 1189],
  [1584, 1171], [1556, 1157], [1544, 1143], [1543, 1128], [1549, 1111], [1552, 1085], [1551, 1062], [1544, 1055], [1541, 1038],
  [1534, 1031], [1531, 1016], [1511, 995], [1487, 984], [1475, 971], [1474, 957], [1481, 937], [1483, 916], [1482, 888], [1473, 882],
  [1471, 862], [1462, 853], [1462, 839], [1453, 832], [1443, 808], [1422, 784], [1402, 776], [1380, 775], [1355, 783], [1303, 810],
  [1253, 819], [866, 810], [859, 806], [851, 794], [848, 779], [854, 764], [859, 762], [859, 747], [861, 739], [865, 737], [865, 715],
  [870, 713], [867, 696], [868, 689], [872, 687], [872, 677], [869, 675], [868, 664], [872, 662], [872, 651], [868, 649], [868, 638],
  [872, 636], [872, 626], [868, 624], [868, 611], [871, 610], [871, 600], [867, 598], [868, 573], [851, 538], [825, 513], [799, 501],
  [749, 497], [598, 498], [433, 494], [393, 489], [382, 482], [372, 482], [364, 489], [158, 482], [132, 469], [121, 458], [113, 443],
  [104, 414], [97, 368], [98, 331], [97, 326], [92, 324],
];
// Griffprofil der Bot-Stufe: Griffrücken unter dem Biberschwanz bis Griffvorderseite am Bügel, dazu Bügelecke und Schwanzansatz
export const BOT_GRIP = { from: [1953, 581], to: [1422, 784], extra: [[1363, 507], [1954, 458]] };
// Verlängerter Magazinboden des 19er-Magazins (+2), sichtbar unter dem Griffboden, mit Halteloch
export const MAG19 = [
  [1697, 1434], [2103, 1434], [2110, 1443], [2130, 1447], [2136, 1454], [2141, 1472], [2137, 1515], [2136, 1571], [2130, 1581],
  [2117, 1587], [1869, 1670], [1838, 1676], [1803, 1676], [1778, 1669], [1763, 1660], [1754, 1650], [1733, 1618], [1730, 1607],
  [1730, 1538],
];
export const MAG19_HOLE = [1815, 1530, 5];
export const FRAME_BOTTOM_Y = 1433;
// Schlitten: Seitenumriss der P-9 (gleicher Schlitten, gleiche Mechanik), aber mit der eckigeren Nase des Fotos (Stirn senkrecht,
// Radius oben ≈ 2,8 mm statt der runden P-9-Nase) – Werte in Fotopixeln, Unterkante wie P-9 (y 306 = P-9-Foto 451)
export const SLIDE_NOSE = [[91, 306], [90.5, 280], [89, 250], [87, 200], [86, 130], [86.5, 118], [88.5, 108], [92, 100], [96, 94], [100, 90], [105, 87], [114, 85]];
// Visierung (kleineres Korn weiter vorn, Kimme 3,3 mm weiter vorn als bei der P-9)
export const FRONT_SIGHT = [[140, 85], [225, 85], [221, 80], [209, 47], [172, 47], [145, 80]];
export const REAR_SIGHT = [[1912, 93], [2018, 93], [2018, 85], [1997, 37], [1936, 37], [1912, 85]];
// Wahlschalter hinten links am Schlitten: Deckscheibe (Mitte, Radius), Hebel mit Schwanzende und Pfeilspitze (Stellung Einzelfeuer),
// Markierung 1 Punkt (Einzel, oben) und 2 Punkte (Dauer, unten) als erhabene Punkte im Schlitten
export const SELECTOR = { c: [1926, 221], r: 70, tail: [1867, 118], tip: [1938, 288] };
export const SEL_DOTS = [[1827, 125, 6], [1770, 290, 6], [1797, 291, 6]];
// Öffnung des Abzugsbügels (Gen 3: rundere Ecken, Oberkante fällt nach hinten ab; hinter dem Abzug bis zur Rückwand)
export const OPEN = [[1018, 506], [1061, 509], [1107, 517], [1230, 531], [1305, 537], [1330, 560], [1347, 595], [1357, 635], [1357, 662], [1354, 677],
  [1346, 696], [1328, 723], [1290, 752], [1265, 762], [1221, 760], [1033, 756], [1003, 751], [980, 741], [956, 720], [939, 689], [934, 665],
  [934, 589], [940, 566], [960, 534], [975, 522], [991, 513], [1010, 507]];
// Abzug mit Sicherungszüngel (Gen 3: Blatt weiter vorn und steiler als bei der P-9)
export const TRIGGER = [[1240, 522], [1262, 566], [1266, 612], [1252, 646], [1240, 690], [1236, 730], [1242, 750], [1265, 762], [1290, 752],
  [1315, 722], [1333, 690], [1343, 650], [1346, 618], [1338, 600], [1320, 560], [1305, 535]];
export const SAFETY = [[1262, 620], [1274, 620], [1286, 690], [1282, 735], [1272, 735], [1276, 690]];
// Lauf ragt 1,6 mm vor die Schlittenstirn (Foto x 70 … 89)
export const BARREL_PROUD = 0.0016;
// Schlittenfang Gen 3 (kleiner Hebel mit Querrillen) und Abweisleiste
export const SLIDE_STOP = [[1476, 340], [1580, 341], [1586, 348], [1586, 398], [1578, 405], [1478, 405], [1470, 398], [1470, 347]];
export const STOP_RIBS = [353, 366, 379, 392];
export const STOP_LEDGE = [[1432, 402], [1608, 400], [1612, 446], [1452, 450], [1434, 424]];
// Zerlegehebel im Buckel
export const TAKEDOWN_BOSS = [[985, 345], [1095, 340], [1125, 395], [1135, 470], [1115, 490], [1000, 492], [975, 460], [972, 380]];
export const TAKEDOWN = [[1018, 362], [1050, 358], [1076, 462], [1044, 470]];
// Querstifte [x, y, r]
export const PINS = [[1243, 372, 17], [1230, 452, 23]];
// Magazinhalter Gen 3 (klein, fünf Rippen längs der Griffachse)
export const MAG_RELEASE = [[1440, 680], [1500, 661], [1522, 752], [1465, 775]];
// Loch oben im Griffrücken (Achse der Abzugseinheit), Griffeld (Kieselstruktur), Zeichenfeld, Fingermulden-Rillenfelder, Rillen
// des Griffrückens (Band hinter der Kontur)
export const BACK_PIN = [1910, 620, 8];
export const PANEL = [
  [1560, 735], [1575, 703], [1610, 700], [1700, 706], [1760, 698], [1875, 686], [1910, 780], [1950, 880], [2000, 980], [2045, 1070],
  [2090, 1160], [2130, 1250], [2140, 1292], [1780, 1292], [1760, 1230], [1720, 1140], [1700, 1120], [1630, 930], [1590, 820],
];
export const EMBLEM = [1900, 1130, 2015, 1215];
export const FINGER_PATCHES = [
  [[1478, 840], [1530, 826], [1566, 930], [1512, 948]],
  [[1534, 1022], [1590, 1008], [1626, 1112], [1570, 1128]],
  [[1603, 1196], [1662, 1182], [1706, 1290], [1648, 1304]],
];
export const BACK_RIBS = { y0: 830, y1: 1330, pitch: 17, depth: 30 };
// Gravur links am Schlitten (eigene Beschriftung an den Stellen der Herstellerschrift)
export const MARKS = { logo: [212, 177, 332, 272], model: [410, 202, 502, 250], origin: [585, 212, 720, 240], cal: [991, 219, 1074, 248] };
// Griffrillen hinten am Schlitten wie P-9 (7 Sägezähne): in diesem Foto x 1645 … 2004
export const SERR = { x0: 1645, x1: 2004, n: 7 };
