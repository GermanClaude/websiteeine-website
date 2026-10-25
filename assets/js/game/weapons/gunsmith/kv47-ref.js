// KV-47: Maße und Umrisse vom Referenzfoto – polnisches AKM (Radom 1971, Armémuseum AM.016072), Foto Torkel Edenborg /
// Swedish Army Museum, CC BY 4.0 (verändert: nur Maße und Umrisse abgeleitet, das Foto selbst ist nicht enthalten).
// Rechte Seite: https://commons.wikimedia.org/wiki/File:Polish_AKM_1971,_AM.016072,_01.jpg (Mündung rechts)
// Linke Seite:  https://commons.wikimedia.org/wiki/File:Polish_AKM_1971,_AM.016072,_02.jpg (Mündung links)
// Gegenprobe der Proportionen: https://commons.wikimedia.org/wiki/File:AKM_automatkarbin_-_7,62x39mm.jpg (gemeinfrei)
//
// Entzerrung (25.10.): Beide Studiofotos sind NICHT perspektivfrei – die Kamera war um die Hochachse gekippt, die linke
// Bildhälfte ist größer abgebildet (Visierlinie im Rohfoto 01 = 0,40 der Gesamtlänge statt 0,43, im Foto 02 = 0,45).
// Modell: Bildpunkt (x, y) der 3840-px-Fassung → X = (x − 1920)/(1 − k(x − 1920)), Y = (y − 920)/(1 − k(x − 1920)),
// k = 3,15·10⁻⁵/px. k aus dem Spiegel-Abgleich der Silhouetten beider Seiten (gleiche Waffe, gleiche Kamera), Horizont
// y = 920 so, dass der Lauf waagrecht bleibt (Restneigung < 0,1°). Alle Fotopixel unten sind im ENTZERRTEN Bild (Versatz
// +1800/+960): x_e = X + 1800, y_e = Y + 960. Drehung: keine (Lauf, Deckel und Gasrohr nach der Entzerrung waagrecht).
// Kalibrierung: Gesamtlänge AKM 880 mm (Schaftkappe → Mündungsbremse) = 3634 px → 4129,5 px/m; Prüfmaß Visierlinie
// (Kimmenblatt → Kornmitte) 1550,9 px = 375,6 mm (Soll 378 mm, −0,6 %); Höhen geprüft an Foto 3 (Korn über Laufachse
// zu Visierlinie 0,1357 ↔ 0,1348). Breiten (quer) nicht aus dem Foto, sondern aus Datenblatt/Schrägansichten 03/04.
// Bezug wie das bisherige Modell (Haltung, Anschlag, Hände bleiben): Griffmitte x = 1240 ↔ u = 0 in Handflächenhöhe,
// Laufachse y = 987 ↔ v = 0,072 (Visierlinie y = 788 ↔ v = 0,1202; bisher 0,1195).
// Linke Seite (Foto 02, entzerrt mit demselben k): Fotopixel (x2, y2) → rechts-Koordinaten über L2R (Mündung links,
// Maßstab 0,9629 aus den durchgehenden Nieten beider Seiten, Restfehler ≤ 3 px).
// Umrisse: tools/ref/kontur.mjs (Regeln mit Holz-/Stahlfarbe), Unterkanten von Schaft und unterem Handschutz
// spaltenweise (Lack spiegelt den hellen Tisch); Kleinteile, Nieten (Hough-Kreissuche), Kanten von Hand aus Ausschnitten.
export const PPM = 4129.5, XG = 1240, YB = 987, AXIS = 0.072;
export const U = (x) => (x - XG) / PPM;
export const V = (y) => AXIS + (YB - y) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);
/** Linke Seite: Fotopixel aus Foto 02 (entzerrt) → Fotopixel der rechten Seite (gleiche Waffe, Mündung links). */
export const L2R = (x2, y2) => [3760.2 - 0.9629 * x2, -6.2 + 0.9629 * y2];
export const ML = (pts) => pts.map(([x, y]) => { const [a, b] = L2R(x, y); return [U(a), V(b)]; });

// ---------------------------------------------------------------- Umrisse (Fotopixel, entzerrtes Foto 01)
// Nachbesserung nach der Prüfung (25.10.): STOCK hinten unter der Kappe nach Zeilenscan (Kappe gewölbt, Holz 3 px innen),
// Unterkante nach Spaltenscan – die Kontursuche hatte unten den Schlagschatten und den Riemenbügel mitgenommen
// ([483,1346] … [266,1392]); GRIP oben bis in das Gehäuse (vorher 1–1,5 mm Spalt); MAG ohne die Stufe am Magazinhalter
// (Rippen knickten dort) und ohne die Spitze vorn oben.
export const STOCK = [[131,1330],[128,1270],[129,1200],[132,1135],[135,1085],[139,1045],[144,1025],[151,1012],[162,1004],[180,1001],[189,1000],[263,1002],[305,1002],[365,1002],[711,998],[743,1000],[754,1004],[758,1007],[758,1014],[761,1016],[764,1016],[764,1009],[766,1008],[803,1018],[838,1018],[866,1014],[875,1010],[897,1006],[901,1004],[914,1002],[920,998],[932,998],[976,982],[1048,966],[1050,964],[1064,962],[1066,960],[1076,962],[1076,1170],[1023,1180],[1001,1180],[1000,1185],[995,1188],[970,1192],[935,1202],[898,1210],[892,1214],[890,1212],[889,1214],[857,1222],[853,1224],[814,1234],[802,1238],[800,1238],[772,1248],[697,1268],[696,1270],[681,1274],[674,1278],[654,1282],[598,1298],[592,1302],[566,1308],[520,1316],[480,1320],[400,1339],[300,1362],[250,1377],[230,1383],[200,1388],[170,1390],[154,1386],[143,1380],[136,1368]];
export const GRIP = [[1240,1108],[1366,1108],[1369,1121],[1371,1127],[1367,1133],[1371,1135],[1373,1139],[1375,1203],[1367,1215],[1361,1215],[1359,1217],[1355,1215],[1351,1219],[1337,1225],[1329,1237],[1329,1243],[1333,1245],[1333,1249],[1329,1253],[1327,1267],[1323,1269],[1319,1289],[1317,1295],[1313,1299],[1313,1305],[1309,1313],[1311,1315],[1311,1321],[1305,1329],[1303,1341],[1299,1345],[1297,1351],[1295,1375],[1291,1377],[1291,1383],[1287,1389],[1287,1395],[1283,1399],[1283,1407],[1281,1411],[1279,1407],[1275,1413],[1279,1419],[1279,1423],[1275,1427],[1275,1433],[1273,1437],[1271,1435],[1267,1437],[1269,1445],[1267,1447],[1267,1455],[1263,1459],[1263,1507],[1265,1509],[1265,1521],[1263,1525],[1261,1525],[1255,1533],[1247,1533],[1243,1539],[1239,1541],[1237,1539],[1235,1541],[1233,1539],[1227,1541],[1205,1541],[1195,1537],[1187,1537],[1185,1535],[1183,1537],[1171,1531],[1165,1531],[1135,1521],[1111,1507],[1097,1491],[1097,1469],[1099,1467],[1099,1459],[1103,1451],[1103,1445],[1109,1427],[1113,1421],[1113,1415],[1117,1409],[1117,1401],[1121,1395],[1123,1383],[1129,1365],[1133,1359],[1139,1335],[1143,1329],[1143,1323],[1147,1315],[1147,1309],[1153,1291],[1159,1279],[1159,1273],[1163,1265],[1163,1257],[1169,1243],[1169,1235],[1173,1233],[1173,1219],[1175,1217],[1173,1215],[1173,1199],[1169,1195],[1167,1185],[1159,1175],[1153,1163],[1153,1159],[1147,1151],[1147,1135],[1149,1131],[1155,1129],[1157,1125],[1171,1125],[1181,1112],[1229,1108]];
export const HG_LOW = [[2258,1124],[2142,1124],[2142,932],[2146,923],[2149,920],[2157,916],[2237,916],[2323,920],[2327,922],[2384,922],[2413,926],[2459,928],[2494,926],[2523,922],[2555,920],[2591,920],[2624,926],[2700,928],[2717,920],[2764,920],[2775,920],[2778,925],[2780,963],[2782,966],[2782,988],[2782,1073],[2780,1072],[2778,1074],[2775,1072],[2772,1078],[2759,1078],[2756,1080],[2752,1078],[2750,1080],[2748,1080],[2747,1082],[2741,1082],[2740,1086],[2737,1084],[2729,1090],[2721,1094],[2666,1102],[2660,1102],[2632,1104],[2621,1104],[2619,1102],[2611,1104],[2595,1104],[2564,1106],[2533,1106],[2530,1108],[2503,1106],[2496,1108],[2492,1106],[2481,1110],[2425,1108],[2369,1112],[2352,1110],[2342,1112],[2340,1114],[2301,1116]];
export const HG_UP = [[2365,819],[2371,821],[2373,819],[2375,821],[2377,819],[2379,821],[2389,821],[2391,819],[2395,821],[2397,819],[2399,821],[2401,819],[2419,819],[2421,821],[2519,821],[2521,823],[2523,821],[2527,823],[2561,823],[2563,821],[2577,823],[2579,821],[2589,821],[2591,823],[2667,823],[2669,825],[2671,823],[2677,823],[2679,825],[2713,825],[2715,827],[2719,825],[2723,827],[2751,827],[2753,825],[2757,829],[2761,829],[2771,843],[2771,851],[2775,859],[2775,885],[2769,885],[2767,887],[2771,889],[2771,897],[2769,899],[2771,905],[2769,903],[2767,905],[2751,905],[2743,905],[2741,907],[2735,907],[2733,905],[2715,905],[2709,901],[2709,899],[2713,897],[2709,893],[2697,895],[2695,899],[2691,897],[2673,897],[2671,895],[2653,895],[2651,897],[2639,897],[2637,895],[2631,897],[2627,895],[2623,897],[2621,895],[2615,895],[2613,897],[2605,897],[2599,901],[2593,901],[2583,905],[2581,903],[2579,905],[2575,903],[2573,905],[2569,903],[2521,903],[2519,901],[2511,901],[2511,897],[2507,893],[2499,893],[2497,895],[2389,895],[2383,893],[2381,895],[2381,901],[2369,901],[2367,903],[2363,901],[2365,899],[2365,887],[2359,869],[2359,847],[2357,845],[2359,839],[2357,837],[2357,823],[2355,821]];
export const MAG = [[1703,1117],[1940,1117],[1939,1133],[1947,1165],[1953,1179],[1953,1185],[1973,1241],[2013,1325],[2037,1365],[2093,1441],[2157,1509],[2211,1555],[2263,1593],[2287,1607],[2287,1613],[2281,1617],[2281,1623],[2261,1649],[2259,1657],[2255,1659],[2251,1669],[2241,1683],[2221,1719],[2213,1729],[2215,1733],[2219,1729],[2219,1731],[2187,1785],[2177,1801],[2173,1803],[2171,1809],[2167,1813],[2159,1815],[2151,1811],[2147,1813],[2135,1807],[2131,1801],[2111,1789],[2065,1755],[2015,1713],[1951,1651],[1907,1601],[1867,1549],[1811,1463],[1761,1365],[1733,1295],[1725,1267],[1716,1232],[1709,1178]];
export const REC_SIL = [[2013,781],[2023,785],[2025,789],[2025,801],[2027,803],[2045,803],[2049,801],[2055,787],[2061,783],[2075,783],[2079,785],[2083,789],[2085,799],[2087,801],[2149,799],[2149,919],[2145,921],[2141,931],[2141,937],[2145,943],[2143,947],[2143,957],[2141,959],[2143,961],[2143,967],[2141,969],[2143,971],[2141,973],[2143,975],[2141,979],[2143,981],[2141,983],[2143,985],[2141,1009],[2143,1011],[2143,1019],[2145,1021],[2145,1031],[2143,1033],[2143,1039],[2145,1041],[2145,1059],[2149,1063],[2145,1067],[2145,1071],[2149,1075],[2149,1117],[2095,1117],[2093,1115],[2061,1115],[2059,1113],[2055,1115],[1999,1115],[1997,1117],[1367,1117],[1365,1115],[1357,1115],[1355,1113],[1289,1113],[1287,1115],[1285,1113],[1283,1115],[1267,1115],[1229,1115],[1227,1117],[1075,1117],[1077,1113],[1077,1081],[1075,1079],[1075,1071],[1073,1069],[1075,1061],[1073,1059],[1073,1047],[1071,1045],[1073,1041],[1073,1037],[1071,1035],[1071,1029],[1073,1027],[1073,1019],[1071,1017],[1073,1013],[1073,1009],[1071,1007],[1071,989],[1073,987],[1073,973],[1079,967],[1079,963],[1077,961],[1083,961],[1089,955],[1093,955],[1095,953],[1095,947],[1099,939],[1111,925],[1111,919],[1123,905],[1129,905],[1141,895],[1153,891],[1185,859],[1201,849],[1215,847],[1217,845],[1309,845],[1311,843],[1313,845],[1319,845],[1321,843],[1325,843],[1327,845],[1401,845],[1405,843],[1407,845],[1419,845],[1421,847],[1451,847],[1453,845],[1459,845],[1461,847],[1465,847],[1467,845],[1471,845],[1473,847],[1475,845],[1479,847],[1481,845],[1485,847],[1487,845],[1627,845],[1629,847],[1665,847],[1667,845],[1681,845],[1683,847],[1719,847],[1721,845],[1897,845],[1899,847],[1937,847],[1939,845],[1953,845],[1955,847],[1993,847],[1995,845],[1991,843],[2005,843],[2007,841],[2003,837],[1999,811],[2001,809],[2003,799],[2007,793],[2009,783]];
export const FRONT_SIL = [[3569,775],[3587,775],[3589,777],[3595,777],[3605,785],[3603,827],[3605,829],[3607,861],[3609,863],[3609,879],[3611,881],[3611,895],[3613,897],[3615,933],[3619,939],[3619,947],[3621,949],[3629,949],[3631,951],[3695,951],[3703,955],[3707,959],[3711,967],[3711,971],[3723,985],[3725,985],[3733,991],[3737,991],[3759,1007],[3753,1013],[3745,1017],[3739,1017],[3737,1019],[3703,1019],[3701,1017],[3695,1017],[3693,1019],[3631,1019],[3627,1023],[3627,1029],[3623,1035],[3619,1037],[3607,1037],[3605,1039],[3601,1037],[3599,1039],[3599,1043],[3593,1049],[3573,1049],[3571,1051],[3563,1051],[3561,1049],[3557,1051],[3549,1047],[3543,1047],[3541,1049],[3533,1045],[3489,1045],[3487,1047],[3485,1045],[3483,1047],[3461,1047],[3459,1045],[3457,1047],[3455,1045],[3453,1047],[3429,1047],[3427,1045],[3419,1045],[3417,1047],[3413,1047],[3411,1045],[3403,1045],[3401,1047],[3399,1045],[3395,1047],[3391,1047],[3389,1045],[3353,1045],[3351,1047],[3227,1047],[3225,1049],[3225,1055],[3223,1053],[3195,1053],[3189,1057],[3185,1057],[3183,1059],[3185,1061],[3205,1063],[3193,1063],[3191,1065],[3179,1065],[3177,1063],[3175,1065],[3173,1063],[3171,1065],[3165,1065],[3165,1055],[3167,1053],[3165,1049],[3089,1049],[3087,1051],[2951,1051],[2949,1053],[2881,1053],[2849,1053],[2847,1055],[2799,1055],[2789,1065],[2785,1067],[2785,831],[2793,841],[2795,847],[2803,851],[2807,849],[2805,847],[2831,847],[2833,845],[2839,851],[2867,851],[2869,849],[2871,851],[2975,851],[2977,849],[2979,851],[2987,851],[2989,849],[2991,851],[2993,849],[2995,851],[3003,851],[3005,849],[3003,847],[2997,847],[2995,845],[2999,843],[3001,845],[3017,845],[3019,847],[3099,847],[3103,849],[3111,857],[3111,859],[3115,863],[3119,871],[3125,877],[3133,891],[3139,897],[3139,899],[3145,905],[3145,907],[3151,913],[3151,915],[3161,925],[3163,925],[3169,931],[3185,939],[3197,941],[3199,943],[3205,943],[3207,945],[3217,945],[3233,957],[3439,957],[3441,955],[3491,955],[3493,953],[3493,935],[3495,933],[3497,905],[3499,903],[3499,891],[3501,889],[3503,859],[3505,857],[3505,847],[3507,845],[3507,835],[3509,833],[3509,827],[3507,825],[3507,809],[3511,801],[3519,795],[3525,795],[3527,793],[3539,793],[3545,789],[3549,789],[3551,791],[3553,789],[3553,783],[3557,779],[3561,777]];
export const GUARD = [[1379,1117],[1699,1117],[1699,1253],[1689,1253],[1687,1251],[1683,1251],[1675,1245],[1667,1243],[1663,1239],[1653,1233],[1651,1235],[1649,1247],[1647,1249],[1647,1257],[1645,1259],[1645,1265],[1643,1267],[1641,1277],[1637,1275],[1639,1271],[1639,1249],[1633,1241],[1633,1239],[1629,1235],[1621,1231],[1605,1231],[1601,1233],[1593,1249],[1589,1251],[1587,1249],[1585,1253],[1585,1249],[1587,1247],[1585,1245],[1581,1247],[1581,1253],[1581,1249],[1579,1247],[1575,1249],[1577,1251],[1573,1249],[1565,1249],[1563,1251],[1525,1251],[1523,1253],[1493,1253],[1489,1257],[1485,1255],[1457,1255],[1455,1257],[1419,1257],[1417,1255],[1405,1253],[1397,1249],[1381,1233],[1379,1229]];
export const GUARD_OPEN = [[1533,1141],[1535,1143],[1539,1143],[1541,1141],[1575,1141],[1581,1145],[1585,1141],[1585,1153],[1587,1155],[1587,1185],[1589,1187],[1589,1217],[1591,1219],[1591,1229],[1589,1233],[1579,1241],[1575,1241],[1573,1243],[1557,1243],[1555,1245],[1523,1245],[1521,1247],[1489,1247],[1487,1249],[1447,1249],[1445,1251],[1421,1251],[1419,1249],[1413,1249],[1401,1243],[1393,1237],[1389,1229],[1389,1225],[1387,1223],[1387,1217],[1385,1215],[1387,1209],[1387,1193],[1387,1205],[1391,1209],[1399,1213],[1403,1211],[1405,1215],[1407,1213],[1407,1209],[1409,1207],[1407,1203],[1409,1203],[1411,1199],[1419,1195],[1413,1191],[1413,1185],[1425,1161],[1429,1177],[1437,1193],[1443,1199],[1443,1201],[1461,1219],[1481,1229],[1487,1229],[1489,1231],[1495,1227],[1493,1221],[1489,1217],[1481,1215],[1467,1207],[1455,1193],[1455,1189],[1451,1181],[1451,1157],[1455,1149],[1461,1143],[1463,1145],[1467,1145],[1469,1143],[1471,1145],[1473,1143],[1475,1145],[1509,1145],[1511,1143]];

// ---------------------------------------------------------------- Gehäuse und Deckel (von Hand, Fotopixel)
// Gehäuse (Stanzblech): hinten an der Schaftzunge, vorn am unteren Handschutz, Unterkante, Magazinschacht
export const REC = { x0: 1076, x1: 2143, bottom: 1113, top: 905, wellX0: 1700, wellX1: 1946 };
// Unterkante des Deckels (rechts sichtbar): hinten tief, Stufe am Sicherungshebel, vorn hoch über dem Auswurffenster
export const DC_EDGE = [[1078, 958], [1395, 958], [1440, 917], [1712, 917], [1735, 890], [1760, 868], [2006, 868]];
// Deckel hinten: gerundetes Ende, Knopf der Schließfederführung ragt durch
export const DC_REAR = [[1078, 958], [1092, 938], [1110, 915], [1135, 895], [1165, 878], [1185, 860], [1200, 850], [1215, 846.5]], DC_TOP = 846.5, DC_X1 = 2006;
// Links (Foto 02 über L2R): Unterkante gerade bis vor den Schacht, vorn höher über dem Schriftfeld; das Deckelende
// reicht links weiter nach vorn (neben dem Visierfuß sichtbar, rechts verdeckt der Ladehebel die Stelle)
export const DC_EDGE_L = [[1078, 958], [1100, 948], [1863, 948], [1883, 903], [2058, 903]], DC_X1_L = 2058;
export const SPRING_BUTTON = [1081, 905, 1100, 935];
// Vorderes Verschlussstück unter dem Visierfuß (beidseitig sichtbar, Foto 01/02): Platte mit Niet, oben schräg
export const TRUNNION_F = [[2065, 945], [2065, 888], [2088, 886], [2135, 902], [2141, 912], [2141, 945]], TRUNNION_RIVET = [2104, 925, 13];
// Längssicke am Deckel (rechts), Querrippen auf dem Deckel (Schrägansicht 03; im Umriss oben als 1,5–2 px hohe Buckel)
export const DC_RIB = [[1140, 922], [1330, 922]], DC_TOP_RIBS = [1405, 1672, 1945], DC_RIB_W = 15;
// Auswurffenster mit Verschlussträger dahinter (rechts) und Ladehebel vorn
export const PORT = [1740, 868, 2000, 947], CARRIER_STEP = 903, CARRIER_SEAM = 1877;   // Fenster zwischen Deckelkante und Gehäusewand
export const CHARGE = { stem: [2012, 2032, 900, 942], knob: [2045, 882], knobR: 0.0068, out: 0.022 };   // Hebel schräg: unten 2022/938, Knopf 2047/880
export const CARRIER_STOP_X = 1706;    // Knopf im hinteren Anschlag (Hub 339 px = 82 mm, Ladehebel an der Stufe der Deckelkante)
// Sicherungshebel (rechts, Stahlblech 2 mm): Nabe und Arm mit Lasche vorn (in Stellung SICHER, wie im Foto)
export const LEVER_HUB = [1327, 1001, 26], LEVER_AXLE_R = 19;
// Vorn die breite Platte, die in SICHER den Ladehebel-Schlitz abdeckt und den Träger sperrt (Bohrung, Kante bis an
// den Deckel); Unterkante als abgekantete, geriffelte Daumenleiste (LEVER_EDGE)
export const LEVER = [[1345, 1012], [1447, 991], [1575, 963], [1640, 950], [1672, 943], [1674, 918], [1740, 917], [1745, 935], [1744, 950], [1700, 958], [1640, 971], [1572, 988], [1447, 1019], [1332, 1047], [1318, 1028]];
export const LEVER_EDGE = [[1642, 970], [1743, 951]], LEVER_HOLE = [1692, 945, 6];
// Rastungen/Markierungen des Hebels (eigene Zeichen statt der polnischen C/P): Strich + Buchstabe
export const SEL_MARKS = { dauer: [1700, 1031], einzel: [1700, 1077] };
// Nieten (gewölbt) rechts, Hebelachse, eingeprägte Ringe (Hough-Kreissuche), Magazinführungs-Prägung
export const RIVETS_R = [[1144, 974, 14], [1247, 1027, 14], [1657, 1027, 15], [1902, 1045, 14], [2029, 974, 15], [2100, 974, 14]];
export const RINGS_R = [[1526, 1000, 10], [1561, 1017, 11], [1609, 974, 9], [1634, 994, 11], [1584, 1054, 8], [1774, 1002, 9], [1826, 1000, 9], [1426, 1087, 10]];
export const PINS_R = [[1645, 1095, 9], [1610, 1092, 8]];
export const MAG_GUIDE = [1765, 1045, 1855, 1095];    // ovale Prägung über dem Schacht (Magazinführung)
// Linke Seite (Foto 02): Nieten, Ringe, X-förmige Prägungen um die Stiftköpfe, Schriftfeld am vorderen Verschlussstück,
// Seitenschiene (Zielfernrohr-Aufnahme) fehlt an diesem Exemplar – Längssicke am Deckel
export const RIVETS_L = [[1725, 1018, 16], [1797, 1018, 16], [1930, 1094, 14], [2608, 1071, 15], [2717, 1015, 15]];
export const RINGS_L = [[2001, 1044, 9], [2046, 1047, 9], [2176, 1040, 11], [2244, 1041, 12], [2300, 1041, 12], [2349, 1040, 11], [2521, 1047, 8]];
export const XPINS_L = [[2195, 1121, 14, 'V'], [2257, 1103, 15, 'X'], [2425, 1134, 14, 'V']];   // [x, y, r, Lappen: X vier, V nur oben]
export const MARK_L = [1700, 958, 1990, 985];           // Schriftfeld (Werk, Jahr, Nummer) → eigene Beschriftung
export const MAG_GUIDE_L = [1985, 1075, 2070, 1112];    // ovale Prägung links
export const DC_RIB_L = [[2010, 962], [2700, 962]];

// ---------------------------------------------------------------- Visier
// Kimme: Blatt hinten (senkrecht, Kimmenkerbe oben), Visierklappe, Schieber mit gerändelten Knöpfen; Visierfuß
// Prüfung 25.10.: Knöpfe/Schieber/Buckel lagen auf oder über der Visierlinie und füllten im Anschlag die Kerbe – jetzt nach
// Foto (Knopf r 16 px bei 2067/803); der Buckel mit Schlüsselloch (Foto oben 784) 8 px tiefer, sonst füllt er im Anschlag
// die untere Kerbenhälfte; der Fuß reicht links bis auf das Gehäuse (905), davor nur Ladehebel und Träger
export const RS_BLADE = [1998, 780, 2025, 842], RS_LEAF = [2025, 799, 2182, 814], RS_SLIDER = [2045, 796, 2083, 822], RS_KNOB = [2067, 803, 16];
export const RS_KEYHOLE = [2229, 802, 4, 812];          // Schlüsselloch im Klappenbuckel: Kreis [x, y, r] + Schlitz bis y
export const RS_BLOCK = [[2045, 905], [2045, 821], [2155, 818], [2166, 802], [2182, 797], [2212, 796], [2218, 793], [2240, 792], [2248, 797], [2258, 800], [2300, 797], [2312, 812], [2312, 905]];
export const RS_LEVER = { head: [2283, 808, 22], arm: [[2265, 820], [2205, 880], [2190, 900], [2215, 905], [2290, 828]] };
// Visierlinie (24.10./Prüfung 25.10.): Kornspitze auf Höhe der Kimmenblatt-Oberkante (AK-Visierbild: Korn mittig in der
// Kerbe, Spitze bündig mit den Kerbenschultern). Bisher lag sie auf dem Kerbengrund (788) – das Korn verschwand hinter
// dem Blatt. Kerbe spielgerecht vergrößert (Vorbild ≈ 2 × 1,5 mm, im Anschlag bei 720p nur 4 px): U-Kerbe 3,6 mm breit,
// 3 mm tief; Korn 2,4 mm breit (Vorbild ≈ 2 mm); Augenabstand 0,32 (vorher 0,38) – Kerbe ≈ 8 px, Korn ≈ 2,5 px bei 720p.
export const SIGHT_Y = 780, NOTCH_W = 0.0036, NOTCH_D = 0.003, POST_W = 0.0024;
// Korn: Schutzohren (Haube) mit Fenster, Kornträger um den Lauf, Trommel der Höhenverstellung
export const FS = [[3497, 945], [3505, 880], [3515, 812], [3530, 790], [3545, 778], [3600, 778], [3606, 790], [3604, 945], [3620, 945], [3620, 1037], [3600, 1042], [3600, 1050], [3535, 1050], [3520, 1040], [3520, 948]];
// Fenster (Prüfung 25.10.): gerundet nach dem Außenrand des Lochs (≈ 11 × 10 mm, vorher 6 × 6 mm eckig); Höhentrommel
// r 25 px, ragt seitlich 0,6 mm aus dem Turm (runder Buckel im Foto)
export const FS_WINDOW = { c: [3573, 913], r: [23, 21] }, FS_POST_X = 3565, FS_DRUM = [3572, 843, 25];

// ---------------------------------------------------------------- Lauf, Gasrohr, Gasblock, Mündung (Radien in m)
export const BARREL = [[2780, 0.0084], [3205, 0.0084], [3215, 0.0070], [3625, 0.0070]];
export const GAS_TUBE = { x0: 2290, x1: 3010, y: 889.5, r: 0.0096, ribs: [2810, 3000], capX: [2290, 2357] };
// Gasblock (Prüfung 25.10.): Arm um das Gasrohr, darunter bis x 3088 offen (Lücke über dem Lauf wie im Foto), vorn der
// Laufring 3090–3240; Bajonetthalter darunter (unten schmaler), zwei Stifte
export const GAS_BLOCK = [[3000, 846], [3100, 846], [3130, 870], [3160, 912], [3195, 940], [3240, 957], [3240, 1018], [3093, 1018], [3089, 990], [3090, 957], [3084, 937], [3000, 937]];
export const GAS_RING = [3090, 3240], GAS_RING_R = 0.0121;
export const BAYONET_LUG = [[3160, 1012], [3236, 1012], [3236, 1046], [3230, 1062], [3206, 1062], [3200, 1050], [3160, 1050]], BAYONET_PINS = [[3181, 1010], [3222, 1010]];
export const BRAKE = { x0: 3620, x1: 3757, r: 0.0082, cutTop: [3700, 953], cutTip: [3757, 1003], ring: [3620, 3650] };
export const ROD = { x0: 2790, x1: 3560, y: 1038, r: 0.003, head: [3500, 3560] };
// Handschutz: vorderer Halter (Stahlband), hinterer Abschluss am Gehäuse, Riemenbügel vorn
export const HG_FERRULE = [2775, 2802], HG_FRONT_SWIVEL = [2745, 1095];
// Hülsen des Gasrohrs um die Enden des oberen Handschutzes (Foto: hinten x 2305–2359, vorn 2762–2802, oben bündig mit
// dem Holz, unten bis y 912) – Prüfung 25.10.
export const HG_CUP_REAR = [2305, 2359], HG_CUP_FRONT = [2762, 2802];
// Schaft: Schaftkappe (Stahl) mit Klappe, Riemenbügel unten; Pistolengriff mit Fischhautfeld
// Kappe (Prüfung 25.10.): gewölbte Rückfläche nach Zeilenscan (Foto: x je Zeile), Vorderkante 158 bündig auf dem Holz
export const BUTTPLATE = [124, 158];
export const BUTT_PROFILE = [[165, 1001], [158, 1003], [148, 1010], [143, 1018], [139, 1027], [136, 1045], [133, 1075], [131, 1105], [129, 1135], [127, 1185], [125, 1235], [124, 1265], [125, 1295], [127, 1325], [129, 1348], [131, 1365], [135, 1376], [142, 1384], [152, 1389], [165, 1391]];
// Riemenbügel unter dem Schaft (Foto 01/02): Platte 340–470 auf der Unterkante, Bügel daran nach hinten hängend
export const STOCK_SWIVEL = [[340, 1349], [470, 1322]], SWIVEL_LOOP = [[458, 1328], [318, 1352], 0.0062];
export const GRIP_PANEL = [[1150, 1200], [1290, 1200], [1265, 1505], [1125, 1505]];
// Abzug, Magazinhalter (Paddel vor dem Bügel)
export const TRIGGER = [[1428, 1114], [1427, 1128], [1430, 1150], [1436, 1170], [1445, 1192], [1458, 1210], [1476, 1222], [1494, 1227], [1492, 1222], [1486, 1218], [1468, 1205], [1453, 1189], [1444, 1172], [1442, 1152], [1447, 1135], [1456, 1124], [1460, 1114]];
export const MAG_CATCH = [[1598, 1117], [1662, 1117], [1662, 1197], [1668, 1212], [1660, 1222], [1650, 1240], [1645, 1262], [1641, 1278], [1637, 1276], [1636, 1250], [1633, 1230], [1622, 1219], [1598, 1219]];
// Abzugsbügel von Hand (25.10.; GUARD/GUARD_OPEN aus der Kontursuche schlossen den dunklen Abzug mit ein): Blechschleife
// außen, Öffnung innen – hinten unter der Abzugsplatte (Zunge unter dem Gehäuse), vorn bis an die Gehäuseunterkante
export const GUARD_OUT = [[1380, 1117], [1600, 1117], [1600, 1236], [1596, 1245], [1588, 1251], [1575, 1254], [1420, 1254], [1404, 1249], [1392, 1240], [1384, 1228], [1380, 1212]];
export const GUARD_IN = [[1389, 1125], [1589, 1125], [1589, 1232], [1586, 1239], [1578, 1244], [1424, 1245], [1408, 1241], [1397, 1232], [1390, 1220]];   // Oberplatte durchgehend (Prüfung 25.10.; der Abzug steht mittig in der Platte, der Schlitz ist von außen unsichtbar)
// Magazin: Drehpunkt an der Schachtmündung, Patronenbahn (Lippen → unten), Rippen parallel zur Vorderkante
export const MAG_PIVOT = [1822, 1113];
export const MAG_PATH = [[1828, 1078], [1840, 1200], [1880, 1350], [1950, 1500], [2040, 1640]];
export const MAG_GRAB = [1990, 1400];
// Längsrippen: [Anteil zwischen Hinter- und Vorderkante, unteres Ende y]; davor eine Längsnut (Stufe zum vorderen Feld);
// zwei kurze Schrägrippen vorn unten (Versteifung am Boden); Bodenplatte entlang MAG_FLOOR (hinten unten → vorn unten)
// Prüfung 25.10.: vier Rippen (gedrehter Fotoausschnitt, Enden über die Drehung zurückgerechnet), ≈ 5 mm breit, flach gewölbt
export const MAG_RIBS = [[0.2, 1712], [0.36, 1673], [0.525, 1645], [0.69, 1616]], MAG_GROOVE = [0.78, 1600], MAG_RIB_TOP = 1131;
export const MAG_FOOT_RIBS = [[[2108, 1732], [2197, 1623]], [[2142, 1768], [2240, 1640]]];
export const MAG_FLOOR = [[2130, 1806], [2287, 1609]];
