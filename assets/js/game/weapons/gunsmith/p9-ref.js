// P-9: Maße und Umrisse vom Referenzfoto abgenommen (Pistole des Typs Glock 17, 4. Generation, linke Seite,
// Mündung links; Wikimedia Commons „GLOCK 17 Gen 4 Pistol MOD 45160305.jpg“, auf 1920 px Breite verkleinert).
// Nutzer 13.10.2026: „Originalbilder nehmen und exakt eins zu eins nachbauen“. Die Umrisse wurden aus der Silhouette
// des Fotos verfolgt (tools/out/refpoly.mjs, Rastersprünge geglättet); Einzelteile (Abzug, Hebel, Stifte, Schrift-
// felder) sind aus vergrößerten Ausschnitten abgelesen. Alles in Fotopixeln, Umrechnung über die Kalibrierung:
// Schlittenlänge 186 mm = 1405 px → 7553 px/m; Schlittenvorderkante x = 171 ↔ u = 0,1462; Unterkante des Schlittens
// y = 450 ↔ v = 0,0518 (Oberkante des Rahmens, wie beim bisherigen Modell).

export const PPM = 7553, X0 = 171, U0 = 0.1462, Y0 = 450, V0 = 0.0518;
export const U = (x) => U0 - (x - X0) / PPM;
export const V = (y) => V0 - (y - Y0) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);

// Rahmen unterhalb des Schlittens: Staubschutz mit Schiene, Abzugsbügel, Griff mit Fingermulden, Biberschwanz
export const LOWER = [
  [183, 453], [1579, 453], [1579, 465], [1587, 475], [1593, 489], [1595, 503], [1591, 513], [1585, 521], [1577, 525],
  [1551, 527], [1515, 541], [1489, 565], [1477, 583], [1469, 607], [1467, 643], [1479, 695], [1486, 712], [1499, 755],
  [1509, 784], [1521, 805], [1528, 827], [1541, 850], [1553, 877], [1565, 896], [1581, 921], [1591, 944], [1607, 964],
  [1617, 985], [1631, 1010], [1645, 1040], [1659, 1068], [1671, 1100], [1680, 1132], [1687, 1169], [1689, 1203],
  [1685, 1213], [1673, 1225], [1645, 1243], [1637, 1255], [1305, 1255], [1289, 1249], [1271, 1231], [1263, 1213],
  [1263, 1183], [1257, 1150], [1249, 1130], [1240, 1108], [1229, 1080], [1219, 1066], [1201, 1057], [1195, 1046],
  [1200, 1022], [1198, 1003], [1192, 986], [1188, 970], [1181, 956], [1173, 942], [1160, 932], [1146, 926],
  [1146, 908], [1151, 893], [1150, 875], [1145, 858], [1138, 843], [1131, 828], [1123, 806], [1107, 788], [1089, 778],
  [1062, 778], [1030, 795], [995, 805], [873, 803], [697, 793], [690, 783], [701, 751], [707, 721], [709, 637],
  [705, 620], [698, 606], [681, 588], [669, 583], [613, 583], [601, 579], [473, 579], [393, 575], [381, 571],
  [285, 571], [221, 565], [210, 560], [203, 553], [183, 521], [179, 503], [179, 481], [185, 461],
];
// Öffnung des Abzugsbügels (gerundetes Rechteck)
export const OPEN = [
  [757, 624], [759, 613], [766, 603], [776, 596], [787, 594], [1029, 594], [1040, 596], [1050, 603], [1057, 613],
  [1059, 624], [1059, 733], [1057, 744], [1050, 754], [1040, 761], [1029, 763], [787, 763], [776, 761], [766, 754],
  [759, 744], [757, 733],
];
// Schlitten (Seitenansicht ohne Visierung): vorn oben stark gerundet, hinten unten kleine Lippe
export const SLIDE = [
  [199, 297], [1553, 297], [1565, 301], [1571, 307], [1575, 319], [1575, 437], [1579, 439], [1579, 451], [181, 451],
  [181, 427], [175, 413], [172, 393], [171, 361], [173, 349], [176, 339], [180, 330], [185, 320], [190, 307], [194, 301],
];
export const PLATE = [
  [1305, 1259], [1593, 1259], [1594, 1267], [1605, 1283], [1612, 1292], [1617, 1305], [1617, 1313], [1609, 1323],
  [1340, 1320], [1321, 1313], [1311, 1302], [1306, 1287],
];
// Abzug (geschwungenes Blatt, Spitze nach vorn unten) und Sicherungszüngel
export const TRIGGER = [
  [966, 598], [991, 626], [1000, 658], [997, 689], [984, 720], [972, 745], [975, 761], [988, 763], [1000, 745],
  [1019, 714], [1034, 683], [1044, 651], [1043, 626], [1025, 608], [1019, 598],
];
export const SAFETY = [[990, 640], [1001, 662], [1002, 690], [994, 712], [1004, 712], [1012, 690], [1012, 662], [1003, 640]];
// Visierung: Korn (Trapez) und Kimme
export const FRONT_SIGHT = [[227, 297], [315, 297], [301, 278], [244, 276]];
export const REAR_SIGHT = [[1466, 305], [1540, 305], [1540, 272], [1530, 267], [1476, 267], [1466, 290]];
// Schlittenfang (Edelstahl, gerillt) mit Abweisleiste darunter, Zerlegehebel im Rahmenbuckel
export const SLIDE_STOP = [[1131, 457], [1196, 455], [1206, 466], [1204, 492], [1192, 503], [1140, 503], [1131, 494]];
export const STOP_LEDGE = [[1100, 504], [1234, 502], [1236, 532], [1226, 540], [1110, 540], [1100, 530]];
export const TAKEDOWN_BOSS = [[770, 474], [858, 464], [884, 486], [888, 540], [866, 560], [792, 561], [770, 530]];
export const TAKEDOWN = [[809, 481], [846, 479], [850, 545], [813, 546]];
// Querstifte [x, y, r] (Fotopixel), Mulde vorn am Abzugsbügel
export const PINS = [[972, 482, 11], [956, 536, 15]];
export const GUARD_DIMPLE = [737, 757, 17];
// Magazinhalter (groß, gerillt, parallel zur Griffachse)
export const MAG_RELEASE = [[1112, 698], [1194, 667], [1216, 733], [1134, 761]];
// Daumenauflage (flache Mulde links und rechts oberhalb des Griffs)
export const THUMB_REST = [1300, 612, 110, 52];   // Mitte x, y, Halbachsen (px)
// Kontaktlinie Griff/Abzugsbügel (Griffvorderseite, 22° Griffwinkel) und Breitenübergänge
export const GRIP_LINE = [[1059, 594], [1128, 820]];
// Griffstruktur (Würfelraster), Rückenteil-Fuge, Zierfeld, Rillenbänder
export const RTF = [
  [1205, 730], [1300, 712], [1420, 700], [1445, 760], [1480, 860], [1510, 950], [1540, 1050], [1565, 1150],
  [1315, 1152], [1285, 1110], [1260, 1030], [1240, 950], [1220, 850],
];
export const SEAM = [[1415, 582], [1430, 680], [1450, 750], [1500, 871], [1557, 1007], [1600, 1121], [1625, 1207], [1632, 1253]];
export const BACKSTRAP_PIN = [1437, 660, 9];
export const EMBLEM = [1432, 1021, 1529, 1093];
// Griffrillen hinten am Schlitten: 7 Sägezähne zwischen x = 1255 und 1505
export const SERR = { x0: 1255, x1: 1505, n: 7 };
// Achse des Laufs (Mitte der Mündung im Foto) und Außenradius des Laufs an der Mündung
export const BORE_Y = 375, BARREL_R = 0.006;
// Schriftfelder links am Schlitten
export const MARKS = { logo: [270, 352, 350, 415], model: [400, 367, 505, 400], origin: [553, 372, 660, 398], cal: [795, 375, 855, 398] };
