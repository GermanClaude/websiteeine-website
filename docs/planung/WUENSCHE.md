# Offene Nutzerwünsche (für Welle 2 / Abschluss)
- Budget: ~50 % übrig (Stand 2026-10-05 abends). Sparsam arbeiten. Gestrichenes (Jets, Karte „Nachtschicht“, volles Aufsatzsystem, weitere Modi) nur bei Restbudget; sonst ab Donnerstag (Guthaben füllt sich auf) weitermachen.
- Großkampf: große Karte, Eroberung, Panzer/Jeep (+Heli), 32v32, mehr Waffen/Granaten/Messer/Skins, Easter Eggs.
- NEU: Bots im Team wie echtes Militär (nur in schwierigen Stufen Veteran/Elite): Feuerteams/Trupps, Feuer und Bewegung (bounding overwatch), Niederhalten + Flankieren, Kreuzfeuer, Rauch als Deckung, gemeinsames Stürmen/Räumen von Räumen, Rückendeckung, Sammeln/Regruppieren. Leichte Stufen: einfache Bots, aber zielgerichtet laufen, nie gegen Wände.
- NEU: Screenshots schicken, wenn fertig: Bot-/Soldatenmodelle, Panzer, (Flugzeuge/Heli), Karte Grenzland, neue Waffen.
- NEU: Soldaten je Klasse unterschiedliches Aussehen (Sturm/Sanitäter/Pionier/Aufklärer o. ä.: Rüstung, Helme, Ausrüstung) – gilt für Bots und Spieler-Arme.
- NEU: Rüstungs-/Panzerungssystem (Westen-Platten, die Schaden absorbieren, nachlegbar wie in Warzone/COD Mobile; Stufen leicht/mittel/schwer mit Gewicht/Tempo-Abzug; Helm reduziert Kopfschuss; HUD-Anzeige; Bots nutzen es; Klassen-Standardausrüstung).
- NEU: Spielstil wählbar: „Arcade“ (bisheriges Spiel) und „Realistisch“ (Gegner werden nicht angezeigt: keine Namensschilder/Minikarten-Punkte/Markierungen, minimales HUD, höherer Schaden, kein Fadenkreuz optional) – in Lobby + Website.
- NEU: Zielhilfe und Auto-Feuer („Triggerbot“) einzeln in der Stärke einstellbar: von leichtem Assist bis kompletter Aimbot (Einrasten); Auto-Feuer mit Stärke/Verzögerung/Reichweite. Gilt Touch + optional Maus/Gamepad.
- NEU: Hinlegen (liegen) für Spieler und Bots (Taste, Touch-Knopf, Animation, Trefferzonen, Kamera).
- REIHENFOLGE: Erst gesamtes Projekt fertig + auf FreeGames-Website veröffentlichen (spielbar). Weitere Karten GANZ ZULETZT, nur bei Restbudget, sonst ab Donnerstag.
- NEU: Detailliertere Waffenmodelle + ultra-realistische, je Waffe unterschiedliche Nachlade- und Inspektionsanimationen (taktisch/leer, Bolt/Pumpe/Gurt etc.). Inspizieren NUR am PC (Taste I, frei belegbar), auf Touch nicht.
- NEU: Waffen/Ausrüstung im Match wechselbar: im Pausemenü „Ausrüstung“ (gilt ab nächstem Spawn bzw. sofort am Spawn), und nach dem Tod: während des ~3-s-Respawn-Timers „Ausrüsten“ öffnen → Respawn-Timer pausiert, Waffen in Ruhe tauschen, dann „Einsatz“/Respawn. Tastenbelegung frei (bereits von core-input umgesetzt – prüfen, dass Inspizieren/Ausrüsten dabei sind).
- KLARSTELLUNG: „Bodycam“ = das Steam-Spiel als Realismus-Vorbild, NICHT ein aufgesetzter Bodycam-Filter. → Standard-Preset „Realistisch“ (dezent: leichte Verzeichnung, feines Korn, Auto-Belichtung, AgX) – der starke Fischaugen-Bodycam-Filter nur als wählbares Preset. Ziel: so realistisch wie möglich im Rahmen des Machbaren.
- NEU: Realistische Bewegungsanimationen wie im Spiel Bodycam: Körper/Kamera schwankt beim Rennen seitlich, Kopfbewegung, Waffe wippt mit Schritten, Gewichtsverlagerung beim Anlaufen/Stoppen/Seitwärtslaufen, Landen, Atmen; Komfortregler. (core-input/weapons-feel Grundlage existiert → im Abschluss-Tuning verstärken/feinjustieren, Vorher-Nachher-Video/Bildfolge prüfen.)
- XP-Kurve steigt bereits je Stufe (Stufe 2: 300 EP, 2→3: 450, 54→55: 13 850 EP). Optional später: Prestige nach Stufe 55.
- NEU: Mit Freunden spielen, trotzdem auf GitHub Pages: WebRTC Peer-to-Peer (Host = Browser eines Spielers, simuliert Welt+Bots; Clients senden Eingaben, Host sendet Zustände), Raumcode über öffentlichen Signalisierungsdienst (z. B. PeerJS-Broker) + Fallback manueller Code-Austausch; Google-STUN; Hinweis Datenschutz (IP sichtbar für Mitspieler, Broker Dritter). Koop gegen Bots + PvP, 2–8 Spieler, zuerst kleine Karten. PRIORITÄT: nach der Hauptveröffentlichung, VOR weiteren Karten; sonst ab Donnerstag.
- Mehrspieler mit Raumcode bestätigt („finde ich sehr gut“). Auch die große Karte Grenzland mit Fahrzeugen im Mehrspieler verfügbar machen (Fahrzeugzustand über Host synchronisieren).
- NEU Online-Paket (nach Hauptveröffentlichung, vor weiteren Karten; sonst ab Donnerstag):
  * Host-Menü im Raum: Spieler kicken, Team wechseln/zuweisen, Spieler gegen Spieler + Bots (Bots füllen auf) oder alle gegen Bots.
  * Host-Feineinstellungen: Bot-Anzahl/Schwierigkeit, Karte, Tageszeit, Modus, Punkte-/Zeitlimit, Waffen sperren, Fahrzeuge sperren (Battlefield-Portal-artig), Spielstil Arcade/Realistisch.
  * Zufalls-Matchmaking mit Warteschlange ohne eigenen Server: serverlose WebRTC-Rooms über öffentliche Signalisierung (z. B. Trystero via Nostr/MQTT/Torrent-Tracker oder PeerJS), deterministischer Leader bildet Matches; Level-/Skill-Brackets (z. B. 1–10, 11–25, 26–40, 41–55; nach Wartezeit Bracket erweitern), Bots füllen auf.
  * Online: Zielhilfe gedeckelt (nur leicht, individuell innerhalb der Grenze einstellbar), Auto-Feuer/„Triggerbot“ in PvP aus bzw. stark begrenzt.
  * Ehrliche Grenzen: kein Anti-Cheat möglich (Host ist Autorität), Host verlässt = Match endet (optional Host-Migration), strenge NATs ohne TURN, öffentliche Signalisierung = Drittanbieter (Datenschutzhinweis).
- NEU Anti-Cheat (Online-Paket):
  * Host-Autorität: Host berechnet Leben/Schaden/Munition/Treffer (Client sendet nur Eingaben + Schussrichtung) → unendlich Leben/Munition, Speed-/Teleport-Hacks clientseitig unmöglich.
  * Plausibilitätsprüfungen beim Host: Feuerrate, Bewegungsgeschwindigkeit, Positionssprünge, Schuss durch Wände, Nachladezeiten, Sichtlinie; Zielverhalten-Heuristik (übermenschliche Schnapp-Winkel, Reaktionszeit, Kopfschussquote, Tracking durch Wände).
  * Einstellungs-Rahmen: Online-Grenzen für Zielhilfe/Auto-Feuer; Client meldet Einstellungen signiert/obfuskiert, Host prüft gegen erlaubten Rahmen und beobachtetes Verhalten → Verstoß = automatischer Kick (mit Grund).
  * Netz-/Anti-Cheat-Code minifiziert/obfuskiert (erschwert Manipulation, ehrlich: im Browser nie 100 % verhinderbar; Host selbst könnte cheaten → Gegenprüfung durch Clients, Abstimmung „Host verlassen/melden“).
- NEU Host-Verteilung im Matchmaking: Warteschlange zählt Spieler, Lobby-Größe z. B. 8 → benötigte Hosts = ceil(N/8); zuerst Freiwillige, sonst automatische Auswahl nach Gerätestärke (Desktop bevorzugt, Benchmark, Verbindungsqualität); sobald ein Host bereit ist, treten automatisch bis zu 7 Wartende (passendes Level-Bracket) bei; Bots füllen.
- NEU (Feedback zu Grafik-Bildern: „sieht echt gut aus, Glanz auf der Waffe cool“, ABER Texturen stören): Texturen deutlich detaillierter/realistischer: höhere Texeldichte (kleinere Kachelung), 2048er-Stufe für mehr Materialien auf High/Ultra, Detail-Normalmaps (Mikrodetail), Anti-Kachel (stochastisch) + Makro-Variation, Schmutz/Risse/Leck-Decals, Kanten-Abnutzung, Parallax auf Ultra; Arme/Ärmel/Handschuhe mit fotorealen Stoff-/Leder-Texturen + Normalmaps; Waffen mit fotorealen Metall-/Polymer-Materialien (Kratzer, Kantenabrieb). Ziel: gesamtes Spiel so realistisch wie möglich, Budget beachten (Handy-Stufen bleiben klein). Termin: gern morgen, darf aber auch ein paar Tage dauern – Hauptsache Budget reicht.

### Beobachtung grafik-hafen.png (für Textur-Pass)
- Container-Wellblech wirkt pixelig/niedrig aufgelöst (Streifen-Artefakte, harte Treppen) → vermutlich prozedurale Canvas-Textur statt Bibliotheks-PBR; auf Hoch/Ultra durch KTX2-Metall-Wellblech + Normal/Rough + Rost/Schmutz-Decals ersetzen.
- Boden (Beton) zu flach/hell, kaum Detail → Detail-Normal + Makrovariation + Fugen/Flecken.
- Arm-Ärmel Camo ok, aber Stofffalten/Nähte fehlen; Handschuh glatt → Leder/Textil-Material mit Normal-Map.
- Waffe: Glanz gut (beibehalten!), Rail-Detail ok; Kunststoff-/Metall-Mikrodetail ergänzen.

## Vollbild (Nutzerbericht 05.10.)
- Mindestens eine Person konnte nicht in den Vollbildmodus. Ziel: JEDER kann Vollbild, Gefühl wie ein echtes PC-/Handy-Game, nicht wie ein Browser-Game.
- Befund: Desktop hat gar keinen Vollbild-Weg (nur F11 des Browsers); Touch nur unpräfixiert (iPhone hat keine Element-Fullscreen-API → braucht „Zum Home-Bildschirm“/PWA; alte iPads nur webkit-Präfix); In-App-Browser/iframes ohne Erlaubnis nicht abgefangen.
- Fix auch in die veröffentlichte v1 (FreeGames-Website) zurückportieren.
- Altstadt: Sandsäcke = Low-Poly-Blobs mit viel zu grobem Wellen-Normalmuster (Maßstab falsch) → Jute-Material, richtiger Maßstab, bessere Form/Modell.
- Werk: Ziegelwand verrauscht/niedrig aufgelöst, Fugen kaum lesbar → Ziegel-PBR aus Bibliothek mit korrektem Maßstab + Detail-Normal; Betonboden flach.

## Hände + Clipping (Nutzerwunsch 05.10., nach Arsenal-Agent einplanen)
- Hände greifen die Waffen nicht wirklich: Finger liegen nicht an / schließen nicht um Griff, Handschutz, Magazin. → pro Waffe echte Griffposen (Finger-Curl bis Kontakt, Daumen, Abzugsfinger am Abzug/neben dem Abzugsbügel), KEINE Durchdringung Hand↔Waffe, in ALLEN Animationen (Idle, ADS, Sprint, Nachladen leer/taktisch, Inspizieren, Ziehen, Messer, Granate, Kammer/Pump/Bolt). Automatisch messen (Fingerknochen vs. Waffen-Mesh-Abstand) + Nahaufnahmen jeder Waffe in Schlüsselbildern.
- Wände sind echte Wände: nicht durchlaufen, keine Körperteile/Waffe/Kamera in Wänden (Lehnen, Hinlegen, Ducken, Rutschen, Klettern, Ecken, Türen, Fahrzeuge), Bots: Waffen/Gliedmaßen/Ragdolls nicht durch Wände; Kamera-Near-Plane nie in Geometrie.
- Ziel: „so perfekt, dass man nicht merkt, dass es von einer KI gemacht wurde“ → Gesamtpolitur, systematisch mit Tests verifiziert.
- Fahrzeuge (grafik-grenzland.png): Panzer KP-1/Jeep wirken kastenförmig/low-detail neben der restlichen Grafik → detailliertere Modelle (Wanne-Schrägen, Laufwerk mit Rädern/Ketten-Segmenten, Turmdetails, Werkzeug, Tarnnetz), PBR-Material mit Schmutz/Kanten-Abnutzung. Grenzland-Gras/Boden noch flach → Textur-Pass.
- Waffenmodelle (gallery-wave2.png): Formen ok, aber Detail/Material schlicht → im Textur-Pass Materialien (Parkerisierung, Polymer-Textur, Holzmaserung, Abnutzung) + Fasen.
- Arsenal-Hinweis für bots-scale: Bot-Wahrnehmung muss world.visibility (Rauch) + actor.flashedUntil (Blendgranate) nutzen statt nur world.lineOfSight.

## Lichtschein + Wetter (Nutzerwunsch 05.10. spät)
- Nutzer findet Beleuchtung gut/„beeindruckend“. Wunsch: „Lichtschein“ (God-Rays/volumetrische Lichtkegel) in manchen Karten und Wetterlagen.
- JETZT (günstig, nach world-lighting, im Textur-/Licht-Feinschliff): Lichtschein pro Karte gezielt abstimmen (post/shafts.js + Höhennebel-Inscatter + Staub): Werk = Lichtkegel durch Hallenfenster/Dachluken mit Staub; Altstadt = Strahlen in Gassen/Kirche; Hafen = Sonnenuntergang über Wasser/zwischen Containern; Grenzland = Morgennebel im Wald/Tal. Wetter-Varianten ohne Niederschlag: Klar / Dunst / Morgennebel / Bewölkt (Lobby-Option neben Tageszeit), jeweils mit passendem Lichtschein.
- SPÄTER (ab Do., mit Mehrspieler-Budget): echtes Wetter mit Regen/Gewitter (nasse Oberflächen, Pfützen-Reflexe, Tropfen, Blitz, Regen-Sound), evtl. Schnee.

## Nachschub, Fahrzeug-Crews, mehr Fahrzeugtypen, Funk/Stimmen (Nutzerwunsch 05.10. spät; „eher am Schluss, sonst Donnerstag“)
- Heilung: Selbstregeneration BLEIBT; keine Medkits nötig; nur Sanitäter heilt (ist so umgesetzt: Gadget medkit). Nichts ändern.
- Nachschubpunkte an eroberten Flaggen (wie Battlefield/„Warfare“): Infanterie füllt Munition (+ Granaten/Platten?) an eigenen Flaggen auf; Fahrzeuge (Panzer, Jeep) ebenso. Fahrzeuge haben ausreichend, aber endliche Munition → müssen ggf. nachfüllen. (günstig → möglichst noch in dieses Update)
- Crew-System wie Squad/Squad 44: 1 Person KANN einen Panzer bedienen, muss aber zwischen Fahrer, Richtschütze, Bug-/Hüllenschütze (MG), Kommandant wechseln (Fahrer kann Hauptgeschütz nicht feuern usw.); optimal 2–3 Personen. (günstig → möglichst noch in dieses Update)
- Mehrere Panzertypen pro Fraktion (z. B. Kampfpanzer, Schützenpanzer, Spähpanzer, Flakpanzer), mehrere Hubschrauber- (Transport, Kampf) und Flugzeugtypen (Jet/Erdkampf). (groß → ab Do.)
- Bots steuern Fahrzeuge, Können je Schwierigkeitsgrad — „als Letzteres“.
- Funk/Markieren: Ping-/Markiersystem (Feind gesichtet, hierhin, brauche Munition/Sanitäter, Fahrzeug), Funkrad, Funksprüche; mehrere wählbare Stimmen; Bots sprechen Textbausteine. Natürliche Stimmen, KEINE merklichen KI-Stimmen → Plan: offene deutsche Stimmen (z. B. Thorsten-Voice CC0 / Piper-Stimmen mit passender Lizenz) vorab als Audio erzeugen, mit Funkfilter (Bandpass, Rauschen, Squelch) — kaschiert Synthese-Artefakte; ehrlich kommunizieren: nah an natürlich, aber keine Studiosprecher. (mittel-groß → ab Do., falls Budget früher reicht)

## Vollbild – Stand 06.10. 03:30
- Dev fertig (engine/fullscreen.js, ui/fullscreen-ui.js), v1-Hotfix auf FreeGames-Website gepusht (68b0907).
- Offen für QA-Phase: FSV-3 „Als App installieren“ nur im Leitfaden erreichbar (Chrome/Edge sehen ihn nie) → Platz im Pause-Menü/Einstellungen; FSV-1b Lobby-Kopfzeile 601–647 px schiebt „Zur Website“ raus (Lobby-Header überläuft auf Touch-Tablets generell: 91 px bei 768×1024); unbenutztes input._fsTriedAt.
- QA-Hinweis: smoke.mjs „playerFired: keine Schüsse“ unter Last (1–3 FPS) ist Lastartefakt → QA mit quality=low, längeren --seconds, wenn Maschine ruhiger.

## Bots-scale – Stand 06.10. ~04:00: fertig (squad.js, Sim-LOD, Klassen-Looks, Prone, Wand-Check, Spawn-Spread CQ, Pit-Fix)
- QA MUSS prüfen: Schießen funktioniert wirklich (alle Smokes melden „keine Schüsse“ unter Last) → bei ruhiger Maschine smoke quality=low prüfen ODER direkter Test (G.input.simulate fire → Munition sinkt/Treffer).
- Offen: Bounding nach letzter Änderung ungemessen; F6 Rest (Elite drückt 1/5 an Geländer Grenzland).
- Bilder: tools/out/bots-scale/classes-back.png (Klassen-Looks von hinten), prone-side.png, tactic-stack.png.

## Look-Pass – Stand 06.10. ~07:00: fertig (env-look + atmosphere-weather + look-fix)
- Offen/Notiz: Panzer-Silhouette noch kastenförmig (Detail besser); Altstadt-Dachziegel sehr rot gesättigt; Gras-Halme untexturiert; Container-„Treppen“ vermutlich Schatten-Aliasing bei 15°-Sonne (Hafen) → im QA prüfen; High ~10 % langsamer (akzeptiert); Website-Kartenbilder (assets/img/maps/*.webp) mit tools/stills.mjs neu erzeugen (Website-Update).
- Bilder: tools/out/atmos/weather-high.png (sehr gut: Lichtschein/Nebel), tools/out/look/after-high-*.png, after-high-vehicles.png.

## Waffenmodelle „wie Klötze“ (Nutzer 06.10.) → ab Do. ERSTE Priorität (zusammen mit Hände-Feinschliff)
- Modelle sind aus Boxen (builder.js box/chamfer) zusammengesetzt → echte Silhouetten: Profil-Extrusionen mit Kurven (Griffe, Schäfte, Gehäuse), Drehteile (Läufe, Mündungen, Gasblöcke), Rundungen/Fasen, Details (Schrauben, Stifte, Griffstruktur/Stippling, Gravuren, Rillen am Handschutz), Materialien (parkerisiertes Metall, Polymer, Holzmaserung, Kantenabnutzung). Glanz beibehalten! Alle 21 Schusswaffen + Messer/Granaten; Bot-LOD mitziehen; Phone-Budget.

## Update 2 (Nutzer 06.10. ~10 Uhr, Nutzung „immer noch 89 %“)
- Texturen auf ALLEN Karten besser (wiederholt betont).
- Karten ein Viertel größer, mit mehr Hindernissen/Deckung, damit Spieler Platz/Deckung suchen können.
- NPC-KI soll vom Spieler lernen und ihren Stil anpassen.

## Nutzer-Screenshot Handy (06.10., Grenzland Herrschaft, 30 FPS)
- BUG „Schnur“ an Waffen (dünne gepunktete Linie vom Bildrand zur Waffe) → Fix-Agent läuft (schnur-bug).
- Touch-HUD überladen: Munitionsanzeige „8 / 3…“ wird vom Platten-Knopf verdeckt; Killfeed links überlappt linken Zielknopf/„SPRINT“-Hinweis; viele Knöpfe nah beieinander → Touch-Layout aufräumen (Munition sichtbar, Killfeed nach oben/rechts versetzen, neue Knöpfe Platte/Gadget/Taktisch/Hinlegen sinnvoll gruppieren).
- Positiv: 30 FPS auf dem Handy in Grenzland, Licht/Gegenlicht sieht gut aus.
- Nutzer präzisiert: Schnur hängt RECHTS an der Seite (der Waffe) → rechte Hand/rechte Waffenseite/Accessoires rechts prüfen.

## GRAFIK-ZIEL AB DONNERSTAG (Nutzer 06.10., höchste Priorität): Umgebung wie im Spiel „Bodycam“
- Referenzbilder (nur als Stil-Referenz, keine Assets übernehmen!): scratchpad/ref-bodycam/ref-1-wald.jpg (verbrannter Wald, Nebel, Stahlgerüst-Ruine, Pfützen), ref-2-graben.jpg (Schützengraben, Erdwände, tote Bäume, Strommast, harte Sonne), ref-3-graben-waffe.jpg (Graben mit Sandsack-/Erdwänden, Wurzeln, Schutt, sehr detaillierter Boden, Waffe hochdetailliert, schwarze Handschuhe).
- Wünsche: Texturen so realistisch wie irgend möglich, Beleuchtung, Design/Detailgrad der Umgebung so realistisch wie es geht.
- Plan: Fotoscan-Modelle (CC0, Poly Haven/ambientCG: tote Bäume, Stümpfe, Äste, Felsen, Schutt, Wurzeln), dichte Bodenstreuung (Zweige, Steine, Asche, Laub, Gras), echte Geometrie-Verschiebung des Bodens nahe der Kamera (Desktop hoch/ultra), Pfützen mit Spiegelung, Grabenwände (Erde, Sandsäcke, Holzverschalung), stärkere AO, bedeckter Himmel/entsättigte Abstimmung; Grenzland-Abschnitt „verbrannter Wald mit Grabenstellung“ als Vorzeige-Bereich; alle Karten mehr Kleindetail. Handy: leichtere Varianten. Ehrlich: 1:1 Unreal-5-Niveau (Nanite/Lumen) im Browser nicht machbar, aber deutlich näher.
- Danach Waffen-Neumodellierung + Hände (gehört zum Grafik-Paket).
- Präzisierung (06.10. Mittag): PC so nah wie irgend möglich an die Bodycam-Bilder, „fast 1:1“; Handy gleicher Stil, nur geringere Auflösung/etwas unschärfer. „Ultra hyper realistisch für ein Browser-Game … fast wie Unreal Engine 5“, „Pionier-Spiel im Browser“.
  Plan PC: eigenes hochauflösendes PC-Paket (2K/4K-Fotoscans, nur Desktop Hoch/Ultra, gestreamt), Boden-Verschiebung/Tessellierung nahe Kamera, dichte instanzierte Streuung, Pfützen mit SSR, TAA (temporales AA für ruhiges Feindetail), Kontaktschatten, bessere GTAO, volumetrischer Nebel; prüfen: optionaler WebGPU-Pfad (three WebGPURenderer: SSGI/SSR/TRAA) als „Ultra+“ für Chrome/Edge. Budget-Rahmen GitHub Pages: Seite ≤1 GB, Dateien <100 MB → PC-Paket ~200–300 MB, Handy-Paket klein.

## Anweisung 06.10. ~13:30
- Jetzt: kleinere Aufgaben + das ganze Spiel auf Bugs/Glitches testen, bis das Limit aufgebraucht ist; zwischendurch speichern. NICHTS veröffentlichen.
- Donnerstag: große Aufgaben (Fahrzeuge, Texturen, Grafik, Waffen usw.) und dann alles zusammen als MEGAPATCH veröffentlichen.
- Bug-Logs: tools/out/bughunt/*.md (offene Punkte für Donnerstag).

## Weitere Wünsche für Donnerstag (06.10. Mittag)
- Mehrspieler AM DONNERSTAG mitplanen: Online-Zufallsmatches, skill-basiertes Matchmaking (dazu Raumcode, Host-Menü, Anti-Cheat wie zuvor).
- NPC-Strategien + dynamische Intelligenz ausbauen (auf lernenden Bots + Trupp-Taktik aufbauen).
- „Überarbeitung, bessere Grafik“.
- Mehr freischaltbare Fähigkeiten/Abschussserien: Luftschlag, Artillerieschlag, Versorgungspaket (Munition/Rüstung/Ausrüstung) usw. – alle per STUFE (Level) freischaltbar („Alle mit lila. Freischaltbar“ = vermutlich „mit Level“).
- Nachschubpunkte: an Punkten/Flaggen Munition für Waffen UND Granaten auffüllen, ebenso Panzermunition.
- Panzer-Schaden realistisch wie in War Thunder: Panzerungsdicke/Winkel/Durchschlag, Module (Motor, Getriebe, Ketten, Turmring, Kanone/Verschluss, Munitionslager → Explosion), Besatzung einzeln ausschaltbar.
- Mehr Waffen gegen Panzer und Flugzeuge (AT-Werfer-Typen, Fliegerfaust/AA-Rakete mit Zielsuche, Panzerminen, ggf. Panzerbüchse).
- Fahrzeuge je nach Match-Einstellung: von Anfang an spawnbar ODER als Abschussserie nach X Kills freischaltbar (wie das Wachgeschütz).

## PRIORITÄT NEU (06.10. Mittag, verbindlich)
1) MEHRSPIELER-PATCH zuerst, als eigener Megapatch, Ziel: ca. SAMSTAG verfügbar (Raumcode, Online-Zufallsmatches mit skill-/stufenbasiertem Matchmaking, Host-Menü/-Einstellungen, Host-Verteilung, Anti-Cheat, PvP+Bots; große Karten mit Fahrzeugen online so weit machbar).
2) Danach MEGAPATCH 1: Grafik (Bodycam), Waffen, Hände, Fahrzeuge (Nachschub, WT-Schaden, neue Typen, AT/AA, Heli/Jets, Fahrzeug-Serien), Abschussserien/Freischaltungen per Level usw.
3) Wenn Limit reicht: MEGAPATCH 2 beginnen (NPC-Strategien/dyn. Intelligenz, Funk/Stimmen, Regen, Bug-Reste, Karten), beim nächsten Wochenlimit beenden.

## Waffen-Wünsche (06.10. Mittag) → MEGAPATCH 1 (Waffen-Teil) + Folgewochen
- Aufsätze: Zielfernrohre/Visiere (versch. Vergrößerungen), Mündungsdämpfer/Kompensator, Mündungsbremse, Mündungsfeuerdämpfer, Schalldämpfer/Unterdrücker, (Griffe, Laser, Magazine …) mit spürbaren Werten + sichtbar am Modell, Gunsmith-Menü.
- Munitionstypen je Klasse: z. B. panzerbrechend (AP) – durchschlägt leichte Fahrzeuge (Jeep, leichte Panzerung), Hohlspitz/Leuchtspur/Unterschall usw., abgestimmt mit dem War-Thunder-Schadensmodell.
- Insgesamt ca. 50–100 Waffen am Ende, alle gleich hochwertig gerendert (nach dem Grafik-/Waffen-Neumodellierungs-Paket) → schrittweise über mehrere Wochen ausbauen.
- Je Waffe ca. 4 verschiedene Inspizier-Animationen (auch für Granaten; Granaten mit Herstellungsdetails/Beschriftungen), mehrere Nachlade-Varianten pro Waffe (nicht immer dieselbe).
- Arme noch detaillierter. Gesamtziel: „so realistisch, dass man denkt, es ist real“.

## Hinweis zu den Bodycam-Referenzbildern
Die drei Referenzbilder des Nutzers (Spiel „Bodycam“, nur als Stil-Vorlage, NICHT ins Repo übernehmen) zeigen:
1. verbrannter Wald mit Nebel, kahle Stämme, Stahlgerüst-Ruine links, Pfützen auf dunklem Ascheboden, Zielfernrohr-Gewehr, schwarze Handschuhe, starke Fischauge-Vignette;
2. Schützengraben mit Erdwänden im harten Sonnenlicht, tote Kiefern, Strommast, Gras-/Wurzelreste, Waffe mit Schaft nah an der Kamera;
3. Graben mit Sandsack-/Erdwänden, Wurzeln, Schutt, sehr detaillierter Boden, hochdetailliertes Sturmgewehr (heller Schaft/Rail), schwarze taktische Handschuhe.
Liegen ggf. noch unter scratchpad/ref-bodycam/ (Container-temporär).

## Wünsche 06.10. abends → MEGAPATCH 1 (Karten-Teil)
- Grenzland (große Karte): deutlich mehr Hindernisse, Deckung, Gebäude usw. („wie gesagt beim Megapatch“) – mehr Weiler/Gehöfte/Ruinen, Mauern, Zäune, Hecken, Gräben, Fahrzeugwracks, Felsgruppen, Holzstapel, Bunker/Stellungen zwischen den Flaggen, damit offene Flächen Deckung bieten.
- Bots sollen sich über die ganze Grenzland-Karte verteilen (nicht nur an wenigen Flaggen/Wegen ballen): Spawn-/Ziel-Verteilung über alle Sektoren, Flanken-/Patrouillen-Rollen, Fahrzeugtrupps auf entfernte Flaggen.
- Heute (06.10.) zusätzlich im laufenden Patch: Vollbild ohne Tastensperre (Virenscanner-Blockade), Tester-Fehler (FPS-Text, Nachladeton, Gegnernamen im Realistisch-Stil, Wandhaltung flach an den Oberkörper, Grafikstufen sichtbar unterschiedlich), Waffe hebt sich neben Fahrzeugen fälschlich an, Magazine leeren sich sichtbar, Hülsen bleiben liegen, Schwimmen, Grafik-Leistung optimieren.

## STAND 06.10. ~17:15 – Wochenlimit (5 %) → alle Workflows angehalten. ZUERST am Donnerstag fertigstellen + prüfen + veröffentlichen
- LIVE (Hotfix 0fbc26f, Fassung 20261006151057): Vollbild-Modul nicht mehr Pflicht (dynamisch geladen, Ersatz in main.js), keine Tastensperre/kein Esc-Abfangen/kein Vollbild beim ersten beliebigen Klick (wirkte wie Browser-Locker → Virenscanner blockierte engine/fullscreen.js bei einem Opera/Windows-Tester), Fehlerpanel mit Virenscanner-/Blocker-Hinweis, FPS-Text „unten links“.
- IM ARBEITSZWEIG, UNFERTIG/UNGEPRÜFT (WIP-Commits bis 951f8ce+; NICHT ungeprüft veröffentlichen):
  - Tester-Feedback: Gegnernamen im Realistisch-Stil ausblenden (nameplates.js/manager.js/bot.js/hud.js – umgesetzt, Prüfung fehlt); Nachladeton bei Abbruch (Sprint/Wechsel/…) stoppen (controller.js/audio.js – in Arbeit); Wandhaltung: Waffe flach an den Oberkörper statt nach oben (viewmodel.js – in Arbeit); Grafikstufen sichtbar unterschiedlich + korrekt angewendet (nicht begonnen).
  - Waffe hebt sich neben Fahrzeugen/Objekten fälschlich in die Wandhaltung, obwohl vorne frei (Nutzer-Screenshot Grenzland, „gab es öfter“) – Ursache noch nicht gefunden (Wandprüfung in viewmodel.js wallFit/_obstruct, Fahrzeug-Kollision prüfen).
  - Magazine leeren sich sichtbar (neues gunsmith/magfill.js + guns-*.js/models.js/viewmodel.js) und Hülsen bleiben liegen (debris.js, Obergrenzen je Stufe) – in Arbeit.
  - Schwimmen (Planung fertig, Umsetzung begonnen), Ausdauer-System + Hänge runterrutschen (stamina.js, slide.js, player.js – Umsetzung begonnen).
  - Grafik-Leistung optimieren (Messen/Planen/Umsetzen, inkl. dynamischer Auflösung) – angehalten, neu starten.
  - Workflow-Skripte zum Fortsetzen: ~/.claude/projects/-home-user-websiteeine-website/eafff7d3-…/workflows/scripts/ (tester-feedback-patch, mag-rounds-and-casings, swimming, stamina-and-slope-slide, graphics-performance) – nur gültig, falls der Container noch existiert.
