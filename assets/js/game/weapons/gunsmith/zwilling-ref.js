// ZW-12 Zwilling (Doppelflinte mit Kipplauf, 26.10.): Maße und Umrisse von Referenzfotos – nur Zahlen, die Fotos selbst sind
// nicht enthalten.
//   Hauptbild (Basküle, Läufe, Vorderschaft, Abzüge, Oberhebel, Schaftkopf): Baikal IZH-43E, linke Seite –
//     „ИЖ-43Е (1).jpg“, ViktorJulin, CC BY-SA 4.0, https://commons.wikimedia.org/wiki/File:%D0%98%D0%96-43%D0%95_(1).jpg
//     (verändert: nur Maße und Umrisse abgeleitet). Zerlegt (Laufhaken, Auszieher, Vorderschafteisen): „ИЖ-43Е (2).jpg“,
//     gleicher Urheber und Lizenz.
//   Proportionen und Kolben (gerader Schaftrücken statt Monte-Carlo, kurze 20″-Läufe): „CoachGun.JPG“ (Commander Zulu,
//     englische Wikipedia, Namensnennung), Gegenprobe „Stoeger-Coach-Gun.jpg“ (Picanox, CC BY-SA 4.0).
//
// Gerade gestellt: Hauptbild (3840-px-Fassung) um +0,54° gedreht (tools/ref/rotimg.mjs) – danach Laufober- und -unterkante
// waagrecht (377 ± 1 bzw. 465 ± 1 px über x 380…1180). Alle Fotopixel unten im gedrehten Bild (3851 × 1178).
// Kalibrierung: Lauflänge IZH-43 725 mm (Mündung x 177 → Stoßboden x 2530 = 2353 px) → 3,25 px/mm. Prüfmaß: Lauf-Ø an der
// Mündung 66 px = 20,3 mm (12/76: 20–21 mm) ✓. Der Zwilling hat 508-mm-Läufe (Coach Gun 20″) → Mündung bei x = 879.
// Bezug: Griffanker (Handwurzel am Pistolengriff, 23 mm hinter der Griffvorderkante) x = 2940 / y = 585 ↔ (u, v) = (0, 0); Laufachse y = 409,5. Mündung im Foto LINKS → u
// wächst nach links. Die Kamera sah die linke Seite; das Modell ist quer (x) symmetrisch bis auf Abzüge/Hebel.
// Kolben: Länge nach Coach Gun (Schaftlänge vorderer Abzug → Kappe ≈ 368 mm, 14½″), Rücken gerade von der Nase zur Ferse
// (Senkung an der Nase 38 mm, an der Ferse 71 mm unter der Laufschiene, aus CoachGun.JPG mit 1,247 px/mm), Kappe 131 mm hoch;
// Pistolengriff und Hals wie IZH-43E.
export const PPM = 3250, XG = 2940, YB = 585;
export const U = (x) => (XG - x) / PPM;
export const V = (y) => (YB - y) / PPM;
export const M = (pts) => pts.map(([x, y]) => [U(x), V(y)]);
export const AXIS_Y = 409.5;
export const AXIS = V(AXIS_Y);

// ---------------------------------------------------------------- Läufe
export const MUZZLE_X = 879, BREECH_X = 2530;
export const LEN = (BREECH_X - MUZZLE_X) / PPM;                  // 0,508 m
/** Außenradius über Abstand d vom Stoßboden (m): Patronenlager, Übergang, konischer Lauf (IZH: Oberkante ab 415 mm waagrecht). */
export const BARREL_R = [[0, 0.0118], [0.068, 0.0118], [0.092, 0.0111], [0.25, 0.0104], [LEN, 0.0101]];
/** Halber Achsabstand am Stoßboden bzw. an der Mündung (die Läufe laufen leicht zusammen und berühren sich). */
export const BX0 = 0.0114, BX1 = 0.0101;
export const BORE = 0.0092;                                       // Bohrung 18,4 mm
export const CHAMBER = 0.0103, RIM = 0.0112;                      // Patronenlager / Randaussparung
/** Laufschiene oben: Höhe der Oberkante über der Achse (Foto: 360 px am Stoßboden → 377 px ab 415 mm). */
export const RIB_H = (d) => 0.01545 - 0.00545 * Math.min(1, d / 0.415);
export const RIB_LOW = 0.01708;                                   // Unterkante der unteren Schiene unter der Achse (465 px)
export const BEAD_D = LEN - 0.011;                                // Perlkorn 11 mm hinter der Mündung
// Scharnierstift (Kopfstück der Basküle), Öffnungswinkel der Läufe
export const PIVOT = [2362, 502];
export const OPEN = -0.62;

// ---------------------------------------------------------------- Umrisse (Fotopixel)
// Basküle (Seitenansicht): Stoßboden mit Fenstern (Rundungen hinter den Patronenlagern), Oberkante unter dem Oberhebel, Kurve zum
// Schaftkopf, Abzugsblech, Unterkante bis zum runden Kopfstück am Scharnier, Auflage der Laufflachen (476 px)
// Unterkante nach Spaltenscan (edge.mjs, Schwelle 185): 2380 → 528, 2500 → 540, 2580 → 549, 2620 → 557
export const ACTION = [[2530, 358], [2548, 361], [2568, 370], [2588, 383], [2606, 394], [2628, 401], [2650, 405], [2625, 412], [2607, 428],
  [2599, 455], [2600, 488], [2612, 516], [2632, 545], [2622, 556], [2580, 549], [2500, 540], [2420, 532], [2380, 528], [2353, 524], [2341, 514],
  [2337, 500], [2341, 486], [2352, 476], [2530, 476]];
export const BAR_TOP_Y = 476;                                     // Oberkante Baskülenbahn = Laufflachen
// Vorderschaft (Holz) mit Rundung hinten am Kopfstück
// Unterkante (mit Vorderschafteisen) nach Spaltenscan: 1700 → 488, 1900 → 502, 2100 → 515, 2300 → 530
export const FORE = [[1662, 428], [2335, 423], [2352, 430], [2360, 445], [2362, 470], [2357, 500], [2345, 522], [2300, 530], [2100, 515], [1900, 502],
  [1700, 488], [1664, 484], [1659, 470], [1659, 440]];
export const FORE_BOTTOM = (x) => 488 + (x - 1700) * (530 - 488) / (2300 - 1700);
export const FORE_IRON = [1880, 2296];                            // Vorderschafteisen unten (x von … bis)
export const FORE_LATCH = [2205, 2245, 516];                      // Verschlusshebel des Vorderschafts
// Laufhaken unter den Läufen (sichtbar bei offener Waffe): Kopfstück-Haken vorn um den Stift, hinterer Haken mit Rast
export const LUMPS = [[2378, 476], [2512, 476], [2512, 494], [2494, 506], [2452, 509], [2440, 500], [2410, 500], [2398, 512], [2382, 512], [2373, 500]];
// Schaft (Holz): Kopf und Hals nach IZH-43E, Kolben nach Coach Gun (gerader Rücken), Kappe als eigenes Teil ab x 3808
export const STOCK = [[2650, 405], [2705, 425], [2760, 440], [2800, 455], [2850, 470], [2900, 484], [2950, 490], [3000, 487], [3040, 484],
  [3830, 588], [3833, 700], [3828, 850], [3814, 1008], [3135, 750], [3110, 744], [3060, 760], [3010, 772], [2983, 775], [2968, 752], [2956, 718],
  [2940, 675], [2918, 632], [2892, 600], [2860, 585], [2800, 580], [2760, 575], [2700, 562], [2650, 553], [2632, 545], [2612, 516], [2600, 488],
  [2599, 455], [2607, 428], [2625, 412]];
export const BUTT_X = 3806;                                       // Holz endet, dahinter Schaftkappe (Kunststoff, 8 mm)
export const GRIP_CAP = [[2983, 775], [3010, 772], [3060, 760], [3110, 744], [3114, 754], [3064, 772], [3012, 784], [2986, 786]];
/** Halbe Schaftbreite über u (Kopf = Baskülenbreite, Hals 33 mm, Kolben 41 mm). */
export const STOCK_HW = [[U(2600), 0.0229], [U(2700), 0.021], [U(2850), 0.0172], [U(2960), 0.0165], [U(3150), 0.0178], [U(3830), 0.0205]];
// Fischhaut (Holz-Atlas): Pistolengriff (beidseitig) und Vorderschaft (Raute wie IZH-43E)
export const GRIP_CHECK = [[2872, 560], [2950, 538], [3010, 598], [3036, 690], [3016, 742], [2988, 752], [2960, 704], [2930, 646], [2896, 600]];
export const FORE_CHECK = [[1846, 456], [1902, 434], [2140, 432], [2204, 448], [2150, 478], [1902, 482]];

// ---------------------------------------------------------------- Bedienteile
export const TOPLEVER = { pivot: [2612, 397], tail: 2702, top: 393, bot: 406 };   // Oberhebel (dreht um die Hochachse)
export const TANG = [[2650, 405], [2792, 447]];                    // Oberes Schaftblech (Sicherungsschieber darauf)
export const SAFETY = [2734, 433];
// Abzugsbügel (Mittellinie des Bügels) und Abzüge (vorn rechter Lauf, hinten linker Lauf)
export const GUARD = [[2554, 552], [2547, 588], [2559, 626], [2598, 646], [2660, 650], [2716, 636], [2745, 606], [2755, 585], [2770, 577]];
export const GUARD_STRAP = [2770, 2845, 584];
export const TRIG_F = [[2606, 541], [2611, 575], [2621, 606], [2639, 632]];
export const TRIG_R = [[2666, 553], [2676, 583], [2691, 605], [2711, 620]];
export const SWIVEL_F = [1640, 465];                               // Riemenbügel vorn (untere Schiene)
export const SWIVEL_R = [3400, 846];                               // Riemenbügel hinten (Kolbenunterseite)
