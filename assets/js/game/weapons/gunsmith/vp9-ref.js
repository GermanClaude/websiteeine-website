// VP-9 Viper: Maße und Umrisse vom Referenzfoto (24.10.2026, Nutzerwunsch „nach echten Bildern“). Vorbild MP5A5 = MP5A3
// (Einschiebeschaft, schlanker Handschutz) mit Feuerstoß-Griffstück (Sicher – Einzel – Feuerstoß – Dauer).
// Umriss: „HK MP5 noBG.png“ (Dybdal / Mattes, CC BY-SA 3.0; freigestellt aus „MP5A3.jpg“, User:Mattes, gemeinfrei),
//   rechte Seite, Mündung rechts, 1250 × 550 px, Schaft ausgezogen.
//   https://commons.wikimedia.org/wiki/File:HK_MP5_noBG.png – https://commons.wikimedia.org/wiki/File:MP5A3.jpg
// Einzelheiten (linke Seite, Feuerstoß-Griffstück, Spannhebel, Visier, Prägung): „HK MP5 of PASKAL.JPG“ (Rizuan, CC BY-SA 4.0),
//   Piktogramme/Wahlhebel: „HK MP5 (6110432280).jpg“ (Andre Gustavo Stumpf Filho, CC BY 2.0), Zielbild: „Visierlinie.jpg“
//   (User:Mattes, gemeinfrei). Fotos nicht im Repo, nur abgeleitete Maße (verändert: nur Maße/Umrisse übernommen).
// Gerade gestellt: nicht nötig – Schaftstrebe 0,17°, Gehäuseoberkante x 580…960 auf 0,3 px waagrecht (0°).
// Umrisse: Silhouette aus dem Alphakanal (deckend > 50 %), tools/ref/kontur.mjs je Bauteil (Bereichsregel), Douglas-Peucker
//   0,8–1,0 px; Trennfugen/Kleinteile von Hand aus vergrößerten Ausschnitten (1 px ≈ 0,6 mm).
// Kalibrierung: Visierlinie (Trommelmitte x 560 → Kornmitte x 1122) = 340 mm = 562 px → 1653 px/m; Prüfmaß Gesamtlänge mit
//   ausgezogenem Schaft 1146 px = 693 mm (Soll 700 mm, −1,0 %), Magazintiefe quer 53 px = 32 mm (9×19-Doppelreihe ≈ 32–33 mm).
//   Gegenprobe am PASKAL-Foto (3697 px, A5-Griffstück, links; Nachbesserung 25.10.): dort über dieselbe Visierlinie kalibriert
//   (≈ 6,0 px/mm, leichte Perspektive ±2 %) – Abstand der Griffstück-Haltebolzen 968 px ≈ 161 mm (hier 267 px = 161,5 mm),
//   Griffstückhöhe 294 px ≈ 49 mm (hier 81 px = 49 mm). Kleinteile des Griffstücks (Wahlhebel, Piktogramme) von dort übertragen
//   (das Hauptfoto hat nur 1250 px, 1 px ≈ 0,6 mm).
// Bezug: Griffmitte an der Griffstück-Unterkante x = 580 ↔ u = 0, Laufachse y = 163 ↔ v = AXIS (wie das alte Modell: Ursprung =
//   rechte Hand oben am Griff, Achse 60 mm darüber – Haltung/Anschlag bleiben).
export const PPM = 1653, XG = 580, YB = 163, AXIS = 0.06;
export const U = (x) => (x - XG) / PPM;
export const V = (y) => AXIS + (YB - y) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);

// ---------------------------------------------------------------- Bauteile (Fotopixel), je mit eigener Breite
// Hinweis (25.10.): REC, HG, FSB, MUZZLE und RSIGHT sind die verfolgten Gesamtumrisse – der Bauplan nutzt daraus abgeleitete
// Teilumrisse (z. B. Kornträger ohne Laufbund, Lauf als Drehkörper); tools/ref/ueberlagern.mjs zeichnet alle Umrisse zur Kontrolle.
// Schulterstütze (Kappe mit Gummiauflage), Streben, Gehäuse-Endstück mit Schaftverriegelung
export const BUTT = [[85, 121], [89, 121], [91, 123], [95, 123], [103, 127], [109, 127], [111, 129], [117, 129], [119, 131], [133, 133], [133, 187], [129, 191], [127, 191], [113, 205], [113, 207], [109, 211], [109, 215], [105, 223], [105, 229], [103, 231], [103, 241], [101, 243], [101, 253], [99, 255], [99, 263], [97, 265], [95, 287], [93, 289], [93, 295], [87, 307], [87, 309], [81, 315], [77, 317], [67, 317], [63, 315], [63, 313], [57, 305], [57, 285], [63, 273], [63, 265], [65, 263], [65, 255], [67, 253], [67, 233], [69, 231], [69, 175], [67, 173], [67, 143], [65, 139], [67, 137], [67, 133], [73, 127], [75, 127], [79, 123]];
export const STRUT = [130, 151, 402, 185];                 // Strebe (Flachstahl, beidseitig), Ober-/Unterkante
export const CAP = [[451, 93], [493, 93], [497, 97], [497, 185], [457, 185], [401, 185], [397, 183], [397, 139], [413, 139], [417, 135], [435, 99], [439, 95]];
export const LATCH = [[399, 177], [451, 177], [451, 217], [439, 217], [425, 227], [415, 227], [409, 225], [405, 221], [405, 213], [403, 211], [403, 187], [399, 183]];
// Gehäuse (Blechprägung): Oberkante = Spannhebelrohr, Unterkante = Trennfuge zum Griffstück (y 185)
export const REC = [[497, 97], [843, 97], [847, 99], [884, 99], [884, 185], [497, 185]];
export const REC_BOTTOM_Y = 185;
// Griffstück (Kunststoff) mit Abzugsbügel und Pistolengriff; Bügelöffnung ohne den Abzug (der eigenes Teil ist)
export const HOUSING = [[453, 185], [751, 185], [751, 253], [725, 253], [723, 255], [723, 271], [717, 273], [707, 281], [703, 289], [703, 293], [699, 299], [697, 309], [691, 319], [691, 323], [683, 331], [679, 333], [657, 333], [623, 333], [621, 331], [617, 331], [613, 327], [605, 323], [593, 323], [581, 335], [551, 395], [551, 399], [545, 409], [545, 415], [547, 417], [547, 425], [545, 427], [537, 427], [535, 425], [531, 425], [519, 419], [515, 415], [505, 411], [501, 407], [495, 405], [491, 401], [485, 399], [481, 395], [467, 387], [463, 383], [463, 377], [465, 373], [469, 369], [477, 355], [483, 349], [483, 347], [491, 337], [493, 331], [497, 327], [497, 325], [517, 297], [525, 281], [529, 277], [529, 273], [533, 265], [533, 247], [531, 245], [531, 241], [519, 229], [515, 227], [509, 227], [507, 225], [499, 225], [489, 217], [453, 217]];
export const GUARD_OPEN = [[655, 269], [683, 269], [685, 271], [695, 271], [697, 273], [697, 277], [693, 285], [693, 291], [687, 303], [685, 313], [683, 317], [675, 325], [629, 325], [627, 323], [619, 323], [615, 319], [613, 319], [605, 313], [599, 307], [599, 297], [607, 281], [613, 273], [617, 271], [627, 271]];
export const GUARD_Y = 266;                                  // Unterkante Griffstück-Gehäuse (darunter Bügel/Griff)
export const GRIP_X1 = 600;                                  // Griff hinter dieser Linie (Bügel davor)
export const TRIGGER = [[613, 263], [663, 263], [663, 267], [655, 267], [653, 269], [649, 269], [643, 275], [643, 277], [639, 283], [639, 299], [641, 301], [643, 307], [649, 313], [649, 315], [651, 317], [649, 319], [647, 319], [645, 317], [639, 315], [639, 313], [633, 305], [633, 299], [631, 297], [631, 273], [627, 269], [617, 269], [615, 271], [613, 271]];
export const PADDLE = [[725, 255], [751, 255], [751, 265], [747, 265], [741, 269], [739, 279], [735, 283], [735, 291], [733, 291], [731, 293], [729, 293], [727, 291], [727, 285], [729, 283], [729, 279], [731, 277], [731, 273], [733, 271], [731, 269], [725, 271]];
// Magazinschacht (Stahl, am Gehäuse) und gebogenes 30er-Magazin
export const WELL = [[745, 185], [825, 185], [825, 197], [821, 197], [817, 201], [815, 201], [811, 207], [811, 229], [817, 237], [817, 239], [809, 245], [811, 247], [811, 257], [745, 257]];
export const MAG = [[753, 253], [811, 253], [813, 275], [815, 277], [815, 285], [817, 287], [817, 295], [819, 297], [821, 311], [823, 313], [823, 317], [825, 319], [825, 323], [827, 325], [827, 329], [829, 331], [829, 335], [831, 337], [831, 341], [833, 343], [837, 359], [841, 365], [843, 375], [853, 395], [853, 399], [857, 405], [857, 409], [873, 441], [877, 445], [885, 463], [889, 467], [897, 481], [889, 487], [885, 491], [883, 491], [879, 495], [877, 495], [857, 509], [853, 509], [849, 505], [849, 499], [843, 491], [841, 485], [833, 475], [813, 435], [813, 431], [801, 409], [801, 405], [793, 391], [793, 387], [787, 375], [787, 371], [785, 369], [785, 365], [781, 357], [781, 351], [777, 343], [777, 337], [775, 335], [775, 329], [771, 321], [771, 315], [769, 313], [769, 307], [767, 305], [767, 299], [765, 297], [765, 291], [763, 289], [761, 275], [759, 273], [759, 269], [755, 265], [753, 265]];
// Handschutz (schlank, gefeldert), Kornträger mit Haube, Lauf mit Dreifachwarze und Mündung
export const HG = [[873, 118], [1078, 118], [1084, 121], [1087, 127], [1087, 183], [1084, 188], [1078, 190], [875, 193], [873, 191]];
export const HG_PANELS = [[886, 127, 1080, 161], [886, 169, 1080, 187]];   // Fischhaut-Felder (Rechtecke x0, y0, x1, y1)
export const FSB = [[1115, 51], [1123, 51], [1127, 53], [1131, 57], [1135, 65], [1135, 73], [1137, 75], [1137, 93], [1139, 95], [1139, 99], [1145, 107], [1145, 113], [1147, 115], [1147, 125], [1141, 135], [1141, 149], [1143, 151], [1147, 147], [1149, 147], [1149, 175], [1143, 175], [1137, 181], [1133, 181], [1131, 183], [1115, 183], [1111, 187], [1109, 189], [1087, 189], [1087, 101], [1095, 101], [1097, 103], [1103, 103], [1107, 99], [1107, 85], [1105, 83], [1105, 59], [1109, 53]];
export const HOOD = [1121, 67, 16];                          // Kornhaube: Mitte x, y und Außenradius (Seitenansicht, px)
export const FSB_SEAM_X = 1120;                              // Trennfuge Kornträger: hinten Schelle (Handschutz), vorn Gussblock
export const FSB_PINS = [[1100, 138, 4], [1131, 148, 4]];   // Stifte rechts: Schellenstift (Ω-Kopf) und Querstift mit Bohrung
export const MUZZLE = [[1147, 147], [1149, 147], [1151, 149], [1159, 149], [1161, 151], [1185, 151], [1187, 153], [1197, 153], [1201, 157], [1201, 171], [1197, 175], [1195, 175], [1163, 175], [1161, 173], [1155, 173], [1153, 175], [1147, 175]];
// Lauf: [x, Radius m] aus dem Kornträger (Bund x 1141–1149 wie im Umriss FSB, beginnt 2 px in der Stirn x 1143) bis zur
// Mündung (Ober-/Unterkante gegen die Achse y 163; die Nocken der Dreifachwarze ragen oben bis y 147 = 9,7 mm)
export const BARREL = [[1141, 0.0085], [1149, 0.0085], [1149, 0.0080], [1161, 0.0080], [1161, 0.0066], [1163, 0.0066], [1163, 0.0073], [1186, 0.0073], [1187, 0.0068], [1198, 0.0068], [1201, 0.0056]];
// Trommeldiopter: Sockel (Umriss bis Oberkante Gehäuse), Trommel Mitte + Radius (px)
export const RSIGHT = [[547, 57], [551, 57], [553, 59], [559, 59], [561, 61], [563, 61], [569, 67], [573, 67], [573, 69], [569, 75], [569, 79], [567, 81], [567, 89], [573, 97], [511, 97], [513, 95], [513, 83], [515, 81], [515, 77], [517, 75], [519, 69], [521, 69], [527, 65], [541, 65], [545, 61]];
// Trommel (25.10. nachgemessen): Achsschraube bei x 556, y 68 = auf der Visierlinie; Umriss gerundetes Vierkant (Stellungen),
// über die Ecken Ø ≈ 18 mm (r 15 px), im Foto ≈ 21° verdreht; PASKAL-Foto: gerändelter Zylinder Ø ≈ 18 mm
export const DRUM = [556, 67, 15];
export const SIGHT_Y = 67;                                   // Visierlinie (Mitte Kornhaube = Kornspitze = Lochblende)

// ---------------------------------------------------------------- Gehäuse-Einzelheiten (rechte Seite, Fotopixel)
export const PORT = [707, 110, 774, 142], PORT_R = 9;        // Auswurffenster, Enden gerundet (r ≈ 9 px, Nachmessung 25.10.)
export const GROOVE = [497, 145, 772, 162];                  // Längssicke (Führung der Schaftstreben)
export const FLUTE = [507, 108, 669, 117];                   // obere Prägerinne unter dem Rohr (endet vor dem Fenster)
export const SEAM_Y = 121;                                   // Prägekante (kleine Stufe) unter der Rinne bis zum Fenster
export const DEFLECTOR = [786, 104, 832, 119];               // aufgeprägter Hülsenabweiser vor dem Fenster (rechts)
export const TUBE = [884, 1092];                             // freies Spannhebelrohr (Gehäuse → Kornträger), Ø ≈ 19 mm
export const TUBE_TOP_Y = 99;
export const BOSS = [803, 155, 6];                           // Prägebuckel vorn (Haltestift Handschutz/Laufhalter)
export const FRONT_PIN = [857, 175, 5];                      // Querstift vorn (Durchgangsloch)
export const DIMPLES = [688, 852, 1072];                     // Rastmulden der Klemmmontage oben (x)
export const RIVETS = [[660, 131, 3], [686, 131, 3]];        // Punktnieten der Verschlussführung auf einer Lasche
export const RIVET_PLATE = [[652, 137], [658, 128], [690, 128], [697, 137]];   // Lasche (Trapez) unter den Nieten
export const DIMPLE = [855, 133, 2.5];                       // kleine Prägemulde vorn oben
// Griffstück: Haltebolzen hinten/vorn, Magazinknopf rechts, Wahlhebel (Achse), Schaftstift
export const PINS = [[468, 198, 6], [735, 250, 5]];          // [x, y, r] Haltebolzen (Kopf) – hinten im Endstück, vorn am Griffstück
export const MAG_BUTTON = [735, 228, 6];
// Wahlhebel-Achse (beidseitig), Piktogramme relativ dazu (vp9-tex.js). 25.10.: von [557, 212] berichtigt – rechter Hebel im
// Hauptfoto mit der Nabe bei x ≈ 610, y ≈ 227; PASKAL: Nabe 507 px vor dem hinteren / 461 px hinter dem vorderen Haltebolzen
// (≈ 6,0 px/mm) → x 608, 24 mm unter der Griffstück-Oberkante → y 225
export const SELECTOR = [608, 225];
export const BUTTON_POCKET = [736, 214, 256, 7];             // Mulde um Magazinknopf und vorderen Bolzen rechts (x, y0, y1, halbe Breite)
// Magazinschacht: Lasche rechts (heller abgesetzt, Trapez) mit Niet; links Halteplatte mit Schrauben und Rastknopf (aus PASKAL)
export const WELL_PLATE_R = [[753, 196], [797, 196], [801, 200], [801, 225], [767, 237], [755, 236], [751, 232], [751, 200]];
export const WELL_RIVET_R = [793, 239, 3];
export const WELL_PLATE_L = [[766, 202], [818, 202], [821, 206], [821, 248], [804, 258], [770, 258], [766, 254]];
export const WELL_SCREWS_L = [[795, 220, 4], [779, 213, 2.5], [779, 230, 2.5]];
export const WELL_LATCH_L = [758, 225, 7, 6.5];             // Rastknopf links (Mitte x, y, halbe Breite/Höhe in px)
export const STOCK_PIN = [422, 160, 5];
export const CAP_RECESS = [456, 106, 491, 120], CAP_SLOT = [482, 112, 485, 128];   // Endstück: Vertiefung oben + senkrechter Schlitz
// Spannhebel links vorn in der Nut (Ruhelage), Knopf überragt das Rohr von oben gesehen bei x 955…990
export const CHARGE_X = 972, SLOT = [842, 990];              // Spannhebel-Ruhelage (Mitte), Nut im Rohr links (x0, x1)
export const NOTCH_X = 848;                                  // Rastkerbe hinten (Hebel dort eingehängt, „HK-Schlag“ löst ihn)
// Schriftfelder (Mitte x, y): links Kaliber am Schacht, Typ/Nummer am Gehäuse
export const MARKS = { kaliber: [784, 205], typ: [600, 172], nummer: [660, 172] };
