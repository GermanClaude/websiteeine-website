// PS-41 Wirbel (neue Waffe 26.10.): Maße und Umrisse vom Referenzfoto einer PPSch-41 mit 71er-Trommel (linke Seite, Mündung
// links, dunkler Verlaufsgrund). Das Foto wurde um +0,6° gedreht (Mantelober- und -unterkante waagerecht, Restneigung < 1 px auf
// 750 px); alle Werte in Pixeln dieses gedrehten Fotos (3840 × 2560).
// Kalibrierung: Gesamtlänge 843 mm (Mündungsnase x 196 … Kolbenkappe x 3632) → PPM = 3436 / 0,843 = 4076 px/m. Prüfmaße: Mantel
// Ø 150 px = 36,8 mm, Trommel Ø 601 px = 147 mm (zweites Foto, Museum Edinburgh, rechte Seite: 141 mm ± 5 %), Visierhöhe über der
// Laufachse 32 mm. Kein zweites Datenblattmaß im Foto sichtbar (Lauf 269 mm steckt im Mantel) – Abweichung im Bericht genannt.
// Quelle: https://commons.wikimedia.org/wiki/File:PPSh_41-07450-IMG_7476-gradient.jpg – Rama, CC BY-SA 3.0 FR; rechte Seite
// (Spannhebel, Sicherung, Magazinhalter, Trommelstirn): https://commons.wikimedia.org/wiki/File:PPsh-41_at_the_National_Museum_of_Scotland.jpg
// – 501ghost, CC0 (siehe CREDITS.md). Fotos nicht im Repo, nur abgeleitete Maße.
// Umriss: Maske (Sättigung > 14 oder Helligkeit > 18 über einem Polynom-Hintergrund 4. Grades), geschlossen, größte Komponente,
// Spaltenprofile je 25 px; Schaft und Bauteilgrenzen daraus von Hand gesetzt (Holz/Metall-Grenze, Kolbenkappe im Gegenlicht).
// Ohne Hoheitszeichen, Werksstempel und Nummern (Entscheidung 24.10.: historische Waffen ohne Hoheitszeichen).

export const PPM = 4076, XG = 2600, YG = 1236;              // Griffpunkt der rechten Hand (Mitte Kolbenhals)
export const U = (x) => (XG - x) / PPM;
export const V = (y) => (YG - y) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);
export const AXIS_Y = 1073, AXIS = V(AXIS_Y);                 // Laufachse = Mantelmitte (998 … 1148)
export const MANTEL_R = 75 / PPM;                             // Laufmantel/Gehäusedeckel außen (Blech ≈ 1 mm)
export const SIGHT_Y = 944;                                   // Visierlinie: Kornspitze 942, Kimmenschultern 945

// Laufmantel: schräg abgeschnittene Stirn (Mündungsbremse/Kompensator), oben weiter vorn; Länge bis zum Scharnier
export const MANTEL = { x0: 205, y0: 996, x1: 268, y1: 1150, end: 1500 };   // Stirnlinie (x0,y0) → (x1,y1)
export const frontX = (y) => MANTEL.x0 + (y - MANTEL.y0) * (MANTEL.x1 - MANTEL.x0) / (MANTEL.y1 - MANTEL.y0);
// Kühlschlitze je Seite (Langlöcher, Mitte auf Achshöhe), Seitenfenster der Bremse (abgerundetes Rechteck)
export const SLOTS = [[420, 630], [680, 880], [930, 1125], [1170, 1365]];
export const SLOT_Y = [1040, 1115];
export const PORT = [255, 370, 1035, 1115];
export const SWIVEL = [892, 922, 1020, 1140];                // vorderer Riemenbügel (links)
export const BARREL = { muzzle: 560, breech: 1640 };          // Lauf im Mantel (Mündung unter dem Korn, 269 mm mit Lager)
// Korn: Sockel (Dreiecksblech mit Fenster) und Säule mit Kopf
export const FS_BASE = [[440, 1003], [532, 966], [578, 966], [669, 1003]];
export const FS_HOLE = [[536, 972], [574, 972], [570, 995], [540, 995]];
export const FS_POST = [555, 966, 942];
// Kimme: Visierfuß (U-Profil) mit Blattfeder und Kippkimme hinten (Kimmenschultern bei y 945)
export const RS_BODY = [[1900, 1001], [1900, 955], [1910, 951], [2150, 952], [2152, 1001]];
export const RS_LEAF = [[2148, 984], [2151, 946], [2160, 940], [2192, 940], [2205, 948], [2201, 984]];
// Gehäusedeckel hinten (Kappe mit Riegel) – Seitenprofil
export const CAP = [[2215, 1077], [2215, 972], [2232, 962], [2271, 963], [2346, 968], [2396, 971], [2421, 983], [2446, 988],
  [2471, 1001], [2490, 1020], [2500, 1045], [2497, 1066], [2488, 1077]];
export const CAP_BUTTON = [2397, 1045, 9];
// Auswurf oben (Deckelfenster) und Spannhebel rechts (Schlitz, Knauf in Ruhelage = Verschluss hinten)
export const PORT_TOP = [1650, 1880];
export const CHARGE = { x: 2140, y: 1050, slot: [1860, 2165] };
// Unteres Gehäuse: Scharnierblock vorn unter dem Mantel (Oberkante y 1140), ab dem Scharnier bis an den Schaft so breit wie der
// Deckel (Oberkante = Deckelunterkante y 1077), Trommelschacht mit Seitenfenstern für den Trommelrand
export const HOUSING = [[1430, 1140], [1271, 1140], [1271, 1150], [1296, 1159], [1321, 1169], [1346, 1177], [1371, 1179], [1471, 1181], [1490, 1192],
  [1503, 1215], [1506, 1250], [1515, 1267], [1913, 1267], [1913, 1062], [1500, 1062], [1480, 1085], [1455, 1105]];   // Oberkante 1062: 4 mm unter den Deckel (keine Fuge)
export const HOUSING_WIN = [1585, 1765, 1140];                // Fenster beidseitig, nach unten offen
export const HINGE = [1493, 1140, 33];                        // Scharnierbolzen (Kopf)
export const SCREW = [1400, 1133, 19];
export const CATCH = [[1780, 1267], [1930, 1267], [1942, 1284], [1934, 1299], [1902, 1304], [1802, 1290]];   // Magazinhalter
// Schaft (Birke, ein Stück): vorn unter dem Gehäuse, Kolbenhals mit Griffnase, Kolben mit Kamm
export const STOCK = [
  [1913, 1077], [2470, 1077], [2490, 1076], [2521, 1079], [2546, 1099], [2571, 1123], [2596, 1145], [2621, 1162], [2646, 1176],
  [2671, 1184], [2696, 1192], [2721, 1200], [2746, 1206], [2771, 1212], [2796, 1213], [2821, 1212], [2846, 1204], [2871, 1195],
  [2896, 1185], [2921, 1179], [2946, 1178], [2971, 1179], [3021, 1182], [3071, 1188], [3121, 1193], [3171, 1198], [3221, 1202],
  [3271, 1209], [3321, 1214], [3371, 1219], [3421, 1224], [3471, 1229], [3521, 1234], [3571, 1242], [3600, 1250], [3618, 1262],
  [3630, 1285], [3634, 1330], [3628, 1420], [3616, 1520], [3602, 1610], [3590, 1670], [3578, 1694], [3545, 1703], [3497, 1698],
  [3380, 1674], [3263, 1640], [3111, 1587], [2981, 1535], [2863, 1480], [2844, 1480], [2809, 1507], [2792, 1515], [2777, 1516],
  [2761, 1513], [2745, 1502], [2726, 1474], [2705, 1436], [2684, 1409], [2670, 1385], [2643, 1358], [2608, 1332], [2577, 1320],
  [2558, 1310], [2515, 1285], [2488, 1278], [2432, 1270], [2415, 1277], [2080, 1279], [2050, 1278], [2013, 1271], [1913, 1271],
];
export const STOCK_BOX = [1905, 3640, 1070, 1710];
export const BUTTPLATE = 3606;                                 // Kolbenkappe (Stahl) ab hier
export const SLING_PLATE = [2987, 3147, 1333, 1433];           // hintere Riemenöse (Platte mit zwei Schrauben, links)
// Abzugsbügel (Stahlband 10 mm breit, 2,5 mm stark), Abzug, Wahlhebel vor dem Abzug
export const GUARD = [[2087, 1271], [2091, 1340], [2095, 1390], [2112, 1402], [2380, 1402], [2398, 1392], [2405, 1360], [2408, 1310], [2412, 1271]];   // Enden 2 mm im Holz (keine Lichtfuge)
export const TRIGGER = [[2300, 1276], [2318, 1276], [2325, 1300], [2335, 1330], [2350, 1364], [2353, 1385], [2343, 1388], [2328, 1366],
  [2312, 1336], [2302, 1306]];
export const SELECTOR = [2187, 1279, 1347];
// Trommel (Achse parallel zum Lauf): Rand x 1500 … 1773 (67 mm, Deckel 1500 … 1590), Ø 601 px, Mitte y 1433; Deckelrand vorn, zwei Sicken, Riegel links
export const DRUM = { x0: 1500, x1: 1773, cy: 1433.5, r: 300.5, lid: 1590, ribs: [1613, 1700], neck: [1610, 1770], latch: [1567, 1413] };
export const ROUND_TOP = [1690, 1105];                         // oberste Patrone an den Lippen (Mitte)
