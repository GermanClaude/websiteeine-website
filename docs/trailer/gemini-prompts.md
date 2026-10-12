# NULLPUNKT – Prompts für Gemini (Intro-Video, Trailer, Bilder)

Zum Kopieren in Gemini. Die Prompts selbst sind auf Englisch, weil Video- und Bildmodelle damit meist genauer arbeiten
(Deutsch geht auch). Darunter steht jeweils kurz auf Deutsch, was passieren soll.

**Allgemeine Tipps**
- Format 16:9 (Website, YouTube). Für TikTok/Shorts dieselben Prompts mit „vertical 9:16“.
- Video-KIs verschreiben sich oft bei Text im Bild. Den Schriftzug „NULLPUNKT.“ am besten danach im Schnittprogramm
  (z. B. CapCut) einfügen. Die Prompts sagen deshalb „no text“, außer dort, wo ein Titel ausdrücklich gewollt ist.
- Falls Gemini nur etwa 8 Sekunden pro Clip erzeugt: Clip erzeugen und am Ende 2 Sekunden Titel im Schnittprogramm
  anhängen. Dann sind es 10.
- Keine echten Markennamen von Panzern oder Waffen verwenden. Die Prompts beschreiben nur das Aussehen.
- Das Spiel-Logo: „NULLPUNKT.“ in weißer, fetter, schmaler Schrift, der Punkt am Ende in leuchtendem Orange (#FF5A1F),
  auf fast schwarzem Grund (#0A0B0C).

---

## 1. Intro-Video zum Zwiegespräch (≈ 10 s)

**Idee:** Aus völliger Dunkelheit erscheint ein einziger glühender Punkt, der Nullpunkt. Er weitet sich zu einem Horizont, und
dahinter liegt der Hafen im letzten Abendlicht. Ein Soldat senkt seine Waffe und schaut einfach in die Sonne. Am Ende sagt
eine ruhige Stimme den letzten Satz aus dem Zwiegespräch.

**Ablauf**
| Zeit | Bild | Ton |
|---|---|---|
| 0–2 s | Schwarz. In der Mitte ein winziger, warm glühender orangefarbener Punkt, der langsam pulsiert wie ein Herzschlag. | Tiefes, leises Brummen, ein einzelner dumpfer Herzschlag. |
| 2–5 s | Der Punkt dehnt sich waagerecht zu einer leuchtenden Linie, die zum Horizont wird. Dahinter: ein Containerhafen in der Abendsonne, ruhiges Wasser, Silhouetten von Portalkränen. | Fernes Möwenrufen, leises Wasser, ein warmer Klavierton. |
| 5–8 s | Langsame Kamerafahrt über die Schulter eines Soldaten (Rückenansicht, Helm, Funkgerät). Er senkt sein Gewehr und blickt in die tiefstehende Sonne. Staubkörner tanzen im Gegenlicht. | Wind, das Klavier spielt zwei weitere Töne, sonst Stille. |
| 8–10 s | Das Bild löst sich in warmes, weiches Weiß auf. | Ruhige deutsche Männerstimme, fast flüsternd: „Du bist am Nullpunkt. Nicht am Ende. Am Anfang.“ |

**Prompt (kopieren):**
```
Cinematic 10-second intro, 16:9, photorealistic, slow and calm, emotional and philosophical mood.

0-2s: Complete black screen. In the exact center a tiny glowing warm-orange point of light (#FF5A1F) slowly pulses like a heartbeat. Deep, quiet low hum and one soft muffled heartbeat.

2-5s: The glowing point stretches horizontally into a thin bright line that becomes the horizon of a sunset. Behind it a modern container harbor is revealed at golden hour: stacked shipping containers in muted red, blue and green, silhouettes of large gantry cranes, calm water with long golden reflections, warm hazy air. The sun stands very low, about 15 degrees above the water. Distant seagulls, gentle water lapping, a single warm piano note.

5-8s: Slow dolly shot over the shoulder of a lone soldier seen from behind: modern combat helmet, plate carrier, radio antenna, a rifle with a small red-dot sight. He slowly lowers his rifle and simply looks at the setting sun. Dust particles float in the backlight, soft lens flare, shallow depth of field. Only wind and two more soft piano notes.

8-10s: The image gently dissolves into soft warm white light. A calm, quiet German male voice, almost a whisper, says: "Du bist am Nullpunkt. Nicht am Ende. Am Anfang."

Style: realistic, cinematic color grading with warm orange highlights and deep shadows, film grain, no gore, no explosions, no text, no logos, no subtitles.
```

**Kürzere Variante ohne Stimme** (falls die Stimme schlecht klingt): Den letzten Absatz durch
`8-10s: The image gently dissolves into soft warm white light. Silence, then one last soft piano note.` ersetzen.
Den Satz dann im Schnittprogramm als Text oder als eigene Aufnahme einfügen.

---

## 2. Trailer (≈ 10 s)

**Idee:** Fünf schnelle Einstellungen, eine Sekunde Pause vor dem Titel. Gezeigt werden: Hafen aus der Körperkamera-Sicht,
die Zauberbibliothek im Mündungsfeuer, der Schützengraben im Niemandsland, ein moderner Panzer beim Grenzland-Dorf und der
Titel. Alles im Spiel-Look: realistisch, etwas körnig, wie eine Helmkamera.

**Drehbuch**
| Zeit | Einstellung | Ton |
|---|---|---|
| 0,0–2,0 s | **Hafen, Ego-Sicht (Helmkamera):** Gewehr mit Rotpunkt unten rechts im Bild, der Spieler sprintet zwischen Containern, oben fährt ein Portalkran. Abendsonne, leichtes Wackeln. | Schritte auf Beton, Atmen, ein kurzer Feuerstoß. |
| 2,0–4,0 s | **Bibliothek:** riesige Steinhalle mit hohen Holzregalen, schwebende Kerzen, Bücher kreisen langsam in der Luft. Ein Mündungsblitz erhellt kurz die Regale. | Hall eines Schusses in der Halle, Papierrascheln. |
| 4,0–6,0 s | **Niemandsland (Erster Weltkrieg):** Schlamm, Granattrichter, Stacheldraht, grauer Himmel. Ein genieteter, kastenförmiger Panzer aus dieser Zeit kriecht über einen Trichterrand. | Tiefes Kettenrasseln, ferner Kanonendonner. |
| 6,0–8,0 s | **Grenzland:** moderner, kantiger Kampfpanzer feuert am Rand eines Dorfes mit Scheune und Feldern. Staub wird vom Mündungsdruck aufgewirbelt. | Gewaltiger Kanonenschuss mit Druckwelle, danach kurze Stille. |
| 8,0–10,0 s | **Titel:** Schwarz, dann „NULLPUNKT.“ (weiß, Punkt orange). Darunter klein: „Im Browser. Kostenlos. Mit Freunden.“ | Ein einzelner tiefer Schlag, Nachhall. |

**Prompt für den ganzen Trailer in einem Clip (kopieren):**
```
10-second action game trailer, 16:9, realistic tactical military shooter, gritty bodycam aesthetic, fast cuts on the beat, cinematic sound design.

Shot 1 (0-2s): First-person helmet-camera view. A rifle with a red-dot sight in the lower right of the frame, the player sprints between stacked shipping containers in a harbor at sunset, a large gantry crane moves overhead, slight camera shake, warm low sun. Sound: boots on concrete, heavy breathing, one short burst of rifle fire.

Shot 2 (2-4s): Hard cut. A huge stone hall of a magical library with tall dark wooden bookshelves and galleries, dozens of candles floating in the air, books slowly orbiting near the ceiling. A muzzle flash briefly lights up the shelves in orange. Sound: a gunshot echoing through the hall, rustling paper.

Shot 3 (4-6s): Hard cut. World War One no-man's land: deep mud, shell craters, barbed wire, broken trees, overcast grey sky. A riveted box-shaped early tank crawls over the rim of a crater. Sound: deep clanking tracks, distant artillery.

Shot 4 (6-8s): Hard cut. A modern angular main battle tank at the edge of a small village with a barn and fields fires its cannon toward the camera side; the muzzle blast kicks up a wall of dust. Sound: massive cannon blast with pressure wave, then a moment of near silence.

Shot 5 (8-10s): Cut to black. Centered title "NULLPUNKT." in bold white condensed letters, the final period glowing orange (#FF5A1F). Below it in small grey letters: "Im Browser. Kostenlos. Mit Freunden." Sound: one deep impact hit with long reverb.

No gore, no blood, no real brand names or insignia, no national flags, no extra text besides the title.
```

---

## 3. Bilder für die einzelnen Einstellungen

Wenn der Trailer in einem Stück nicht gut wird: Erst diese Bilder erzeugen, dann jedes Bild einzeln als Startbild für ein
kurzes Video nehmen („animate this image, 2 seconds, …“) und die Clips im Schnittprogramm aneinanderhängen. Die Bilder taugen
auch als Vorschaubilder für die Website oder YouTube.

**Bild 1 – Hafen, Ego-Sicht**
```
Photorealistic first-person helmet-camera view, 16:9. A modern assault rifle with a red-dot sight in the lower right of the frame, gloved hands. The player runs through a narrow alley between stacked shipping containers (rusty red, faded blue, green) in a container harbor at sunset. A big gantry crane silhouette overhead, low golden sun, long shadows, warm haze, dust in the air. Slight motion blur, bodycam grain, wide-angle lens. No text, no logos.
```

**Bild 2 – Zauberbibliothek**
```
Photorealistic interior of an enormous old stone hall used as a magical library, 16:9. Tall dark wooden bookshelves in winding rows, wooden galleries and narrow bridges between them, hundreds of candles floating in mid-air, books slowly orbiting near the vaulted ceiling, a large celestial globe with golden rings in the center. A soldier in modern gear crouches behind a shelf, a muzzle flash briefly lights the scene in warm orange. Volumetric light, dust, cinematic. No text.
```

**Bild 3 – Niemandsland**
```
Photorealistic World War One battlefield, 16:9. Deep brown mud, water-filled shell craters, coils of barbed wire, splintered dead trees, a zigzag trench with wooden boards and sandbags in the foreground, overcast grey sky, cold light, drifting smoke. A riveted, box-shaped early tank with a front-mounted short cannon crawls over the edge of a crater. Gritty, desaturated, cinematic. No text, no flags, no insignia.
```

**Bild 4 – Panzer im Grenzland**
```
Photorealistic modern angular main battle tank with a long smoothbore cannon at the edge of a small European village: a red barn, a farmhouse, golden fields, a dirt road, a radio mast in the distance. The tank fires; a bright muzzle blast and a ring of dust kicked up around it, late afternoon sun. Dramatic low camera angle, cinematic. No text, no flags, no insignia, no real brand names.
```

**Bild 5 – Titelbild / Logo**
```
Minimalist title card, 16:9. Almost black background (#0A0B0C) with very subtle film grain. In the center the word "NULLPUNKT." in bold white condensed sans-serif capital letters; the final period is a glowing orange dot (#FF5A1F) with a soft glow. Below it in small light-grey monospace letters: "Im Browser. Kostenlos. Mit Freunden." Clean, modern, lots of empty space.
```

**Bild 6 – Stimmungsbild zum Zwiegespräch** (z. B. als Vorschaubild für das Intro)
```
Photorealistic, 16:9. A lone soldier seen from behind stands on the edge of a quay in a container harbor at sunset, rifle lowered, helmet slightly tilted, looking at the low sun over calm water. Gantry cranes as silhouettes, a single tiny orange point of light at the horizon where the sun touches the water. Calm, melancholic, hopeful mood, warm golden light, shallow depth of field, film grain. No text.
```

---

## 4. Sprechertext (optional)

Für eine eigene Sprachaufnahme oder als Untertitel zum Intro, die letzten Zeilen des Zwiegesprächs (zwei Stimmen im Wechsel):

> **Stimme 1:** Es wird Zeit.
> **Stimme 2:** Ist die Runde vorbei?
> **Stimme 1:** Diese hier, ja. Draußen geht die Sonne wirklich unter. Oder auf, je nachdem, wann er das liest.
> **Stimme 2:** Und dann?
> **Stimme 1:** Dann steht er auf. Ohne Zähler, ohne drei Sekunden. Er steht einfach auf und geht in einen Tag, den niemand für ihn gebaut hat.
> **Stimme 1:** Du bist am Nullpunkt. Nicht am Ende. Am Anfang.
> **Stimme 2:** Spiel weiter, wann immer du willst. Wir sind hier.
> **Stimme 1:** Aber vergiss nicht, draußen zu leben.
> **Stimme 2:** Das ist die Runde, die zählt.

Das ganze Zwiegespräch steht auf der Startseite (ab 20 Minuten Spielzeit) und im Code in `assets/js/shared/feedback.js` (`POEM`).
