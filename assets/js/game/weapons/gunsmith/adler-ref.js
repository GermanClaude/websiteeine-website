// Adler .50: Maße und Umrisse vom Referenzfoto (25.10.2026, Nutzerwunsch 24.10. „nimm echte Bilder aus dem Internet und mach sie
// danach … ultra realistischer Detailgrad“). Vorbild: IMI Desert Eagle Mark XIX, .50 AE, 6-Zoll-Lauf – fester Lauf mit Oberschiene
// und vertieften Seitenflächen, Gasdrucklader mit Drehkopfverschluss im kurzen Schlitten, Rahmen bis unter die Mündung,
// außenliegender Hahn, beidseitige Sicherung am Schlitten, Wickelgriff, Magazin mit breitem Boden (7 Schuss).
// Umriss: „Desert-Eagle-p1030134.jpg“ (Rama, CC BY-SA 2.0 fr), rechte Seite, Mündung rechts, freigestellt, 2340 × 1425 px.
//   https://commons.wikimedia.org/wiki/File:Desert-Eagle-p1030134.jpg
// Linke Seite (Schlittenfang, Laufriegel-Knopf, Magazinknopf, linke Gravur): „Desert-Eagle-p1030133.jpg“ (Rama, CC BY-SA 2.0 fr);
//   Laufquerschnitt, Mündung, Schiene: „Desert Eagle Chrome.JPG“ (DeepThunder, CC BY-SA 3.0) und „DesertEagle 50AE.jpg“
//   (Bobbfwed, CC BY-SA 3.0); offener Schlitten (Lauf/Patronenlager, Hub): „Desert Eagle beside a box of Speer 325 Grain HP.jpg“
//   (DeepThunder, CC BY-SA 3.0). Fotos nicht im Repo, nur abgeleitete Maße (verändert: nur Maße/Umrisse übernommen), CREDITS.md.
// Gerade gestellt um −0,4° (tools/ref/rotimg.mjs): Schienenoberkante x 1100…2000 danach waagrecht (y 172–173), Bild 2350 × 1442.
// Umrisse: tools/ref/kontur.mjs (Silhouette L < 238, Griffschale L < 95), Douglas-Peucker 1,0–1,2 px; Bauteile durch Schnitt der
//   Silhouette an den Trennfugen (Schlitten/Lauf ↔ Rahmen y 373, Magazinboden y 1134); Kleinteile von Hand aus 3–5-fach vergrößerten
//   Ausschnitten (1 px ≈ 0,13 mm); linke Seite aus p1030133 über Mündung/Griffsporn (× 1,06) und Schiene/Boden (× 1,09) übertragen.
// Kalibrierung: Gesamtlänge Griffsporn → Mündung 2150 px = 273,1 mm (Mark XIX 6″) → 7873 px/m. Prüfmaße: Lauf vor dem Schlitten
//   1231 px = 156,4 mm (Nennmaß 6″ = 152,4 mm, +2,6 %), Höhe Kimme → Magazinboden 1221 px = 155,1 mm (Soll 158,8 mm, −2,3 %);
//   die Abweichungen > 1 % kommen von leichter Perspektive (Kamera nah) – Waagrechte und Lauflinien sind danach gerade.
// Breiten (quer) nicht aus dem Foto: Datenblatt 31,8 mm über alles (Sicherungsflügel), Schlitten 29 mm, Lauf 28,4 mm, Rahmen 27 mm,
//   Griff 33 mm (Schätzung nach Fotoschrägansichten).
// Bezug: Griffmitte in Handhöhe x 550, y 860 ↔ u = −0,02, v = −0,018 (Anker der rechten Hand wie beim alten Modell – Hüfthaltung
//   bleibt), Laufachse y 286 (Bohrung Ø 12,7 mm in der Stirn zwischen Schienenfuß und Laufunterkante) → AXIS.
export const PPM = 7873, XA = 550, YA = 860, UA = -0.02, VA = -0.018;
export const U = (x) => UA + (x - XA) / PPM;
export const V = (y) => VA + (YA - y) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);
export const AXIS_Y = 286, AXIS = V(AXIS_Y);
// Visierlinie: Kimmengrund = Kornoberkante (parallel zur Laufachse). Foto: Korn nur ≈ 1,8 mm über der Schiene (verschattet bzw.
// Höhe für Treffpunktlage); hier 5 mm (übliche Mark-XIX-Kornhöhe), damit Kimme und Korn auf einer Linie liegen (Bauanleitung 4.3).
export const SIGHT_Y = 134;

// ---------------------------------------------------------------- Schlitten (beweglich, nur hinterer Block)
// Heck schräg (≈ 19° gegen die Senkrechte), Oberseite y 141, vorn oben die Nase über dem Patronenlager bis x 1021, darunter schräge
// Stirn (parallel zu den Griffrillen) bis x 940 an der Unterkante y 373.
export const SLIDE = [[320, 373], [343, 300], [360, 250], [377, 200], [387, 175], [393, 160], [400, 150], [410, 143], [420, 141], [1005, 141],
  [1013, 143], [1018, 150], [1020, 160], [1021, 175], [1015, 183], [1005, 192], [997, 200], [940, 373]];
export const SLIDE_TOP_Y = 141, SLIDE_BOTTOM_Y = 373, SLIDE_FRONT_X = 1021;   // Stirn vorn (Nase über dem Lauf)
// Griffrillen: 14 schmale Rillen (≈ 0,9 mm, rund auslaufend), unten bei x0 + i·Teilung (y 370), 20,5° nach vorn geneigt bis y 192
export const SERR = { x0: 367, n: 14, pitch: 40.6, ang: 20.5, top: 192, bottom: 370, w: 7 };
// Auswurffenster oben rechts (seitlich nur bis y 152 sichtbar), dahinter Patronenlager/Laufhaube
export const PORT = [762, 1005, 152];
// Sicherung (beidseitig): ovale Nabenplatte mit Schlitzschraube, schlanker, gewölbter Daumenhebel (Tropfen: unten schmal am roten
// Punkt, oben breit) mit erhabenen, blanken Querrippen, eng anliegende Mulde im Schlitten (25.10., Prüfung: vorher breite flache
// Platte mit schwarzen Kerben und eckiger, zu großer Mulde) – aus 3-fach vergrößertem Ausschnitt verfolgt
export const SAFETY_HUB = [517, 210, 44], SAFETY_SCREW = [515, 207, 26];
export const SAFETY_PLATE = [[453, 210], [458, 186], [474, 168], [500, 159], [540, 157], [597, 159], [620, 168], [632, 185], [630, 210], [622, 235],
  [600, 250], [560, 258], [520, 261], [488, 257], [466, 246], [456, 230]];
export const SAFETY_LEVER = [[600, 284], [596, 270], [603, 252], [612, 233], [622, 205], [637, 170], [650, 156], [672, 150], [690, 157], [694, 172],
  [687, 190], [673, 206], [663, 222], [653, 238], [638, 255], [622, 272], [610, 285]];
export const SAFETY_RIBS = [161, 167, 173, 179, 185, 191, 197];   // Querrippen (y), je über die Hebelbreite
export const SAFETY_RECESS = [[447, 212], [452, 185], [470, 165], [500, 152], [560, 148], [640, 146], [690, 150], [705, 165], [708, 200], [703, 235],
  [690, 262], [670, 282], [640, 290], [600, 292], [560, 282], [500, 275], [465, 262], [450, 240]];
export const SAFETY_DOT = [601, 278, 6];
export const SAFETY_PIN = [657, 276, 9];
// Kimme (schwarz, im Schwalbenschwanz): Seitenumriss
export const RSIGHT = [[499, 141], [499, 123], [505, 119], [545, 120], [557, 124], [573, 133], [584, 141]];
// Schwalbenschwanz der Kimme (25.10.): Nut quer durch die Schlittenoberseite bis y 160 (Unterkante der 45°-Fasen), der schwarze
// Kimmenfuß füllt sie – im Foto unter der Oberkante sichtbar
export const RSIGHT_DOVE = [497, 579, 160];

// ---------------------------------------------------------------- Lauf (fest) mit Schiene, Schrägen, vertiefter Seitenfläche
export const BARREL = [[760, 173], [2207, 173], [2210, 185], [2211, 205], [2215, 219], [2245, 257], [2245, 340], [2237, 355], [2229, 369], [2227, 372], [760, 372]];
export const RIB = { top: 173, base: 205, x0: 1018, x1: 2207 };   // Schiene: Oberkante, Fuß (Schwalbenschwanz-Kerbe), Enden
export const SHOULDER_Y = 250;                                  // Schräge → senkrechte Seitenfläche
export const LAUF_BOTTOM_Y = 372;
// Übergang der Schrägen in den runden Patronenlager-Teil (Kurve im Foto, hinten oben an der Schiene beginnend)
export const RAMP = [[1290, 175], [1310, 205], [1330, 230], [1360, 243], [1400, 249]];
// vertiefte Seitenfläche (beidseitig, Gravurfeld): hinten rund, vorn schräg
export const PANEL_L = [[1060, 252], [1998, 252], [2004, 256], [2013, 362], [1045, 362], [1040, 350], [1040, 268], [1046, 256]];
export const FSIGHT = [[2104, 173], [2108, 134], [2121, 134], [2152, 173]];   // Korn (Rampe), Fuß auf der Schiene
export const MUZZLE_X = 2245;
// Gravuren (Fantasie-Beschriftung statt Herstellerzeichen): rechts zwei Zeilen am Lauf, links zwei Zeilen, Nummer rechts am Rahmen
export const MARKS = { laufR: [1170, 300, 1660, 360], laufL: [1170, 300, 1660, 360], nummer: [630, 425, 845, 452] };

// ---------------------------------------------------------------- Rahmen (fest): Staubschutz bis vorn, Abzugsbügel, Griffrahmen, Sporn
export const FRAME = [
  [2227, 373], [2219, 409], [2213, 423], [2213, 429], [2207, 441], [2203, 457], [2195, 471], [2195, 475], [2191, 479], [2189, 487], [2175, 503], [2161, 505],
  [2159, 507], [2085, 507], [2083, 509], [2035, 509], [2033, 511], [1759, 513], [1757, 515], [1567, 515], [1565, 517], [1563, 515], [1561, 517], [1435, 517],
  [1433, 519], [1427, 519], [1425, 517], [1391, 517], [1389, 519], [1369, 521], [1367, 523], [1355, 525], [1353, 527], [1325, 535], [1319, 539], [1315, 539],
  [1309, 545], [1301, 549], [1291, 559], [1285, 561], [1269, 577], [1267, 577], [1251, 595], [1235, 627], [1235, 651], [1237, 653], [1237, 665], [1239, 667],
  [1241, 687], [1243, 689], [1243, 713], [1245, 715], [1243, 727], [1241, 729], [1243, 731], [1243, 745], [1235, 757], [1225, 763], [1197, 763], [1195, 765],
  [1193, 763], [1191, 765], [1145, 765], [1143, 767], [1057, 767], [1055, 769], [1053, 767], [1049, 767], [1047, 769], [1043, 769], [1041, 767], [1035, 767],
  [1033, 769], [1029, 767], [1025, 767], [1023, 769], [1011, 769], [1007, 767], [1005, 769], [1001, 769], [999, 767], [973, 767], [971, 765], [959, 765],
  [949, 761], [919, 761], [909, 765], [897, 765], [895, 767], [889, 767], [887, 769], [877, 771], [861, 781], [853, 789], [845, 805], [845, 811],
  [841, 821], [841, 829], [839, 831], [839, 837], [837, 839], [837, 845], [833, 855], [829, 883], [825, 891], [823, 909], [819, 919], [819, 927],
  [817, 929], [817, 935], [815, 937], [815, 943], [813, 945], [813, 951], [811, 953], [805, 983], [801, 991], [801, 999], [795, 1015], [793, 1031],
  [789, 1039], [789, 1045], [785, 1055], [785, 1063], [781, 1071], [781, 1079], [779, 1081], [777, 1095], [775, 1097], [771, 1117], [765, 1134], [149, 1134],
  [149, 1129], [151, 1127], [151, 1111], [153, 1109], [153, 1099], [155, 1097], [155, 1089], [157, 1087], [157, 1075], [161, 1065], [161, 1057], [165, 1047],
  [165, 1039], [197, 975], [203, 969], [213, 951], [221, 941], [223, 935], [239, 913], [243, 903], [253, 889], [263, 867], [287, 831], [291, 823],
  [291, 819], [295, 813], [295, 809], [315, 769], [319, 765], [331, 739], [335, 735], [339, 725], [343, 721], [347, 711], [353, 703], [353, 699],
  [365, 677], [367, 665], [371, 659], [371, 655], [383, 639], [383, 633], [381, 631], [383, 625], [381, 623], [381, 609], [375, 597], [351, 575],
  [319, 559], [297, 557], [295, 555], [221, 555], [219, 557], [217, 555], [205, 555], [203, 557], [201, 555], [195, 555], [193, 557], [187, 557],
  [185, 555], [135, 555], [131, 553], [127, 545], [127, 539], [121, 527], [119, 517], [113, 507], [109, 493], [97, 471], [97, 461], [115, 447],
  [167, 421], [171, 421], [179, 417], [185, 417], [187, 415], [193, 415], [195, 413], [213, 411], [215, 409], [235, 409], [237, 407], [255, 407],
  [257, 405], [263, 405], [265, 403], [275, 401], [295, 391], [303, 385], [313, 373],
];
// Bügelöffnung: GUARD_OPEN = Durchblick (weißer Grund im Foto, auch hinter dem Abzug), durch die ganze Breite offen.
// OPEN_OUT (25.10., Prüfung) = Öffnung der Außenwände: blanke Kante der Seitenwand in allen drei Fotos (p1030134, p1030133 links,
// „Desert Eagle Chrome“) – Bogen oben bei y ≈ 450 (≈ 11 mm über dem Durchblick), Vorderkante senkrecht bei x ≈ 1195, hinten bis
// 2 mm vor den Griff (x ≈ 836) und um das Auge des Magazinhalters herum. Dazwischen sieht man die Innenfläche des Bügels: ein
// schmaler Mittelsteg (± 5,2 mm) mit dem Abzugsschlitz, zur Außenwand hin ausgerundet.
export const GUARD_OPEN = [[1012, 545], [1020, 558], [1103, 561], [1123, 565], [1150, 578], [1180, 605], [1197, 630], [1200, 655], [1192, 672], [1180, 678],
  [1050, 680], [960, 681], [930, 676], [910, 662], [897, 640], [885, 615], [880, 590], [882, 565], [892, 545]];
export const OPEN_OUT = [[897, 650], [886, 628], [874, 608], [856, 598], [842, 582], [836, 558], [838, 530], [848, 505], [866, 486], [892, 471], [930, 459],
  [980, 452], [1040, 449], [1100, 450], [1140, 456], [1166, 468], [1184, 488], [1194, 512], [1197, 545], [1198, 600], [1200, 655], [1192, 672], [1180, 678],
  [1050, 680], [960, 681], [930, 676], [910, 662]];
export const TRIGGER_SLOT = [905, 490, 1012, 548];
export const FRAME_TOP_Y = 373, RAIL_LINE_Y = 398;             // Oberkante (Schlitten/Lauf liegen auf), Absatz der Führungsleiste
// Grenze Griffsporn ↔ Rahmen (25.10.): Bogen der Trennkante im Foto (links schmaler Sporn, rechts Rahmenseite), unten senkrecht
export const TANG_LINE = [[285, 400], [300, 418], [340, 435], [370, 458], [395, 490], [410, 522], [420, 560], [425, 600], [427, 640]];
export const GUARD_Y = 545, GRIP_X1 = 900, DUST_X0 = 1240;    // Bereichsgrenzen: Bügel unter GUARD_Y, Griff hinter GRIP_X1
export const FRONT_SEAM_X = 2128, GUIDE_HOLE = [2142, 404, 16];   // Vorderstück mit Bohrung der Führungsstange
export const PINS = [[942, 443, 10]];                          // Abzugsstift rechts
export const MAG_SCREW = [860, 630, 22];                       // Magazinhalter rechts (Schlitzkopf), links Druckknopf
// Laufriegel rechts: geriffelte Platte in der Rahmennut + Arm zur Achse (Inbus), links Druckknopf über der Achse
export const LEVER_PLATE = [1092, 400, 1225, 428];
export const LEVER_ARM = [[1212, 398], [1240, 394], [1252, 408], [1236, 468], [1214, 480], [1198, 470], [1205, 430]];
export const LEVER_PIVOT = [1195, 463, 20], LEVER_BUTTON_L = [1204, 403, 14];
// Schlittenfang links (lange Leiste über dem Griff, Daumenstück vorn)
export const SLIDE_STOP = [[640, 402], [905, 398], [935, 400], [948, 410], [946, 425], [930, 432], [905, 428], [650, 424]];
export const SLIDE_STOP_PAD = [928, 415, 16];
// Abzug (Sichel, Vorderseite hohl) und Hahn (gespannt, Sporn geriffelt), Achse des Hahns im Rahmen
export const TRIGGER = [[1005, 495], [990, 493], [960, 500], [935, 510], [918, 525], [910, 545], [905, 580], [905, 610], [910, 635], [920, 655],
  [940, 670], [965, 678], [990, 680], [1003, 676], [1000, 670], [985, 655], [972, 630], [965, 600], [962, 570], [965, 545], [980, 515], [1005, 500]];
export const HAMMER = [[323, 373], [318, 353], [307, 330], [288, 303], [277, 277], [272, 263], [273, 250], [280, 243], [298, 242], [376, 249], [378, 262], [352, 373]];
export const HAMMER_PIVOT = [338, 392], HAMMER_TEETH = [300, 368, 7];   // Zähne auf der Spornoberkante (x von–bis, Anzahl)

// ---------------------------------------------------------------- Griff (Wickelgriff, Kunststoff) und Magazin
// 25.10. (Prüfung): Vorderkante ohne den Spalt der Verfolgung (sie lief an der Kieselgrenze wieder hoch und als Haarstreifen
// zurück – Netzfetzen an Griff und Rahmen); Grat bei y 830–880 geglättet (Lichtkante des Rahmens, nicht Griff).
export const PANEL = [
  [549, 401], [595, 401], [597, 403], [597, 423], [599, 425], [601, 419], [601, 429], [605, 437], [603, 441], [605, 447], [603, 449], [613, 455],
  [691, 455], [693, 457], [713, 457], [715, 459], [749, 461], [751, 463], [765, 463], [767, 465], [781, 465], [783, 467], [795, 467], [809, 471],
  [821, 471], [825, 477], [821, 509], [815, 527], [815, 537], [809, 553], [805, 577], [793, 593], [763, 623], [755, 635], [755, 641], [761, 647],
  [779, 653], [779, 661], [775, 675], [775, 687], [767, 705], [767, 715], [759, 737], [759, 743], [757, 745], [757, 751], [749, 775], [749, 781],
  [737, 823], [737, 831], [735, 841], [737, 853], [739, 869],
  [739, 885], [739, 903], [735, 913], [731, 927], [727, 957], [723, 970], [719, 986], [714, 1003], [709, 1015], [705, 1039], [700, 1050], [699, 1070],
  [698, 1090], [701, 1105], [701, 1123], [653, 1125], [239, 1125], [237, 1127], [221, 1127],
  [211, 1131], [191, 1133], [179, 1139], [151, 1139], [153, 1115], [155, 1113], [161, 1069], [167, 1051], [167, 1041], [185, 1003], [193, 991], [193, 987],
  [197, 983], [197, 979], [215, 955], [217, 949], [251, 897], [269, 861], [287, 835], [321, 763], [325, 759], [335, 737], [349, 715], [359, 695],
  [359, 691], [363, 687], [363, 683], [367, 679], [373, 657], [393, 629], [399, 625], [407, 627], [415, 619], [441, 567], [441, 563], [451, 545],
  [451, 541], [455, 537], [459, 523], [477, 487], [477, 483], [483, 473], [483, 469], [489, 459], [489, 455], [495, 445], [495, 441], [505, 419],
  [515, 411], [519, 411], [535, 403],
];
export const MEDALLION = [545, 758, 75];                       // rundes Feld beidseitig (eigenes Zeichen statt Herstellerlogo)
export const MAGPLATE = [
  [765, 1134], [765, 1153], [769, 1159], [769, 1165], [771, 1167], [775, 1183], [779, 1189], [781, 1203], [789, 1221], [789, 1229], [791, 1231], [791, 1239],
  [789, 1241], [793, 1249], [803, 1259], [807, 1267], [807, 1301], [805, 1303], [805, 1307], [801, 1311], [785, 1319], [781, 1319], [773, 1323], [767, 1323],
  [765, 1325], [745, 1325], [743, 1327], [733, 1327], [713, 1335], [683, 1335], [681, 1337], [565, 1337], [563, 1339], [559, 1337], [557, 1339], [555, 1337],
  [553, 1339], [551, 1337], [549, 1339], [543, 1339], [541, 1337], [539, 1339], [327, 1339], [313, 1327], [297, 1301], [289, 1293], [285, 1293], [283, 1291],
  [257, 1289], [255, 1287], [241, 1287], [239, 1285], [223, 1281], [211, 1275], [207, 1271], [197, 1267], [167, 1247], [157, 1235], [157, 1223], [149, 1205],
  [149, 1195], [151, 1193], [151, 1173], [147, 1167], [147, 1143], [149, 1141], [149, 1134],
];
export const MAG_PAD = [[285, 1222], [770, 1222], [780, 1232], [778, 1300], [768, 1312], [300, 1312], [287, 1300]];
export const MAG_HOLES = [[642, 1291, 9], [249, 1241, 8]];
// Schachtmündung (Mitte des 46 mm tiefen Magazins: Vorderwand ≈ 4 mm hinter der Griffvorderseite x 765) und Neigung der
// Magazinachse (Griffvorderseite 15–17°); oben liegt die erste Patrone damit unter dem Patronenlager (x ≈ 770, y ≈ 400)
export const MAG_PIVOT = [552, 1134], MAG_RAKE = 0.28;
