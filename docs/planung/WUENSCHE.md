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
- NUTZER-SCREENSHOT (06.10. 16:47, Grenzland Eroberung, K-36 Kurzer mit Optik, Handy-Aufnahme) ausdrücklich als FEHLER gemeldet („Das ist ein fehler“, „gab es öfter“): Spieler steht neben einem abgedeckten Fahrzeug (links, sehr nah), vorne ist alles frei – trotzdem steht die Waffe mittig hochgezogen vor dem Auge (Wandhaltung), man sieht von hinten auf Schiene und Optik, die Optik-Rückseite wirkt dunkel/undurchsichtig. Prüfen: (a) Wandprüfung (viewmodel.js wallFit/_obstruct, Strahlen zu seitlichen Stützpunkten) schlägt bei seitlichen Objekten/Fahrzeug-Kollisionskörpern an; (b) in dieser Haltung Optik-Glas/Absehen unsichtbar oder Auge zu weit hinter der Optik. Mit Nachstellung (Fahrzeug links, freie Sicht) beheben – höchste Priorität unter den Fehlern am Donnerstag.

## Wunschliste 06.10. abends (Nutzer, mit 20 Screenshots aus Werk/Hafen/Altstadt) → Megapatch 1/2 (Reihenfolge nach Priorität dort einsortieren)
SOFORT (laufender Fehler-Patch): Waffe soll an Wänden NICHT mehr nach oben gehen – Wandhaltung nur noch als Einstellung (an/aus), Standard aus. (In ~8 der Screenshots steht die Waffe hochgezogen vor dem Auge, obwohl nur seitlich/schräg etwas ist.)
Modi & Wirtschaft:
- Battle-Royale-Modus. „Call-of-Duty“-Modus (genauer klären, z. B. Suchen & Zerstören/Hardpoint).
- Währung in der Runde zum Kaufen von Waffen (auch Waffen, die sonst nicht freischaltbar sind, z. B. im TDM/DDM); Ingame-Shop: 1 Kill = 1 Coin.
- Karten aus eingescannten 3D-Modellen (Fotoscans) erstellen.
Zerstörung & Interaktion:
- Fenster zerbrechlich (Schuss oder Schlag); Häuser/Gegenstände bekommen realistischen Schaden durch Granaten, Patronen, Panzergeschosse (wie im echten Leben).
- Karten interaktiver: offene Container begehbar; Waggon-Schiebetüren (Werk) mit Griff, öffnbar; LKW/Gabelstapler mit richtigen Modellen und richtig gedrehten Rädern, evtl. fahrbar.
Gebäude:
- Möbel/Inneneinrichtung, Innenbeleuchtung; einige Häuser mit Dachboden zum Schießen/Snipen; Balkone an Wänden; Grills auf Dächern.
- Animationen: über Gegenstände steigen, aus Fenstern steigen.
Licht & Schatten:
- Spieler wirft je nach Haltung einen Schatten wie die NPCs.
- Sonnenstrahlen realistisch, nicht durch Wände, natürlich verteilt (Screenshot Werk: Lichtkegel).
- Abendmodus: Laternen an, Licht gut verteilt/geworfen; schwebende Lampen an die Decke; Flutlichter sinnvoll ausrichten; Taschenlampen an Waffen.
Ton:
- Geräusche je Oberfläche; Schreie bei tödlicher Verwundung (NPC/Spieler); Altstadt: Kirchenglocke z. B. um 21:00 Spielzeit.
Gore & Schaden (Stärke einstellbar):
- Blutspritzer kurz auf dem Bildschirm bei Nahkampf; Messer bzw. Waffe wird mit Nahkampf-Kills (≤ 50 cm) sichtbar blutiger.
- Individuelle Wunden/äußerliche Schäden; Trefferzonen-Folgen: Knie → Humpeln bis Medkit, Arm → schlechtere Treffsicherheit; Medkits.
- Leichen bleiben mit ihren Wunden liegen, Entfernung alle 10 Minuten (einstellbar).
Team:
- Friendly Fire an/aus; verbündete Bots können einen treffen (gleicher Schaden wie Gegner); Teamkill = XP-Abzug in Höhe eines Kills.
Waffen/Optik/Lobby:
- Einschusslöcher je Aufprallmaterial unterschiedlich.
- Lobby-Waffenansicht: gewählter Skin erscheint auf der Waffe.
Karten-Feinschliff (alle Karten, „alles originalgetreu und sinnvoll platzieren“):
- Deplatzierte/ineinander verbuggte Gegenstände entfernen, Schilder sinnvoll setzen, Gebäudeteile/Säulen sinnvoll, Hitboxen an die Größe der Gegenstände anpassen.
- Bäume besser setzen + bessere Blätter (Screenshot: flache Blatt-Ebenen am Himmel sichtbar); Pflanzen/Gras wiegen sich im Wind; Blumenbeete besser; aufgeplatzte Fassaden einheitlicher/schöner; bessere Autos.
- Altstadt: Brunnen mit Wasseranimation; Couch (liegt auf der Straße) entfernen; Bänke mit Rückenlehne verbinden.
- Werk: Stahlrollen realistisch stapeln; Rohre sinnvoll verbinden/platzieren; einzelnen deplatzierten Ziegelblock entfernen; unsichtbare Wand an der Treppe in der großen Halle entfernen; Treppe richtig an die Etage anbinden; Werkbank am Eingang entfernen (im Weg); Kran fährt links/rechts; leuchtender oranger Balken an der Wand prüfen.
- Hafen: Kran fährt ab und zu links/rechts.
- Grenzland: Gemüsestände an der Kirche (Mitte); Traktor in die Hütte; linke Straßenseite evtl. Brücke oder Erdbrücke mit Rohr darunter.

## REIHENFOLGE AB DONNERSTAG (Nutzer 06.10. abends, VERBINDLICH, ersetzt frühere Reihenfolgen)
1) MEHRSPIELER – kommt definitiv rein, zuerst (Raumcode, Zufallsmatches mit Matchmaking, Host-Menü/-Einstellungen, Anti-Cheat, große Karten mit Fahrzeugen so weit machbar).
2) Danach ALLES ANDERE von der bisherigen Liste: offene WIP-Punkte vom 06.10. (Tester-Fehler, Waffe neben Fahrzeugen, Magazine/Hülsen, Schwimmen, Ausdauer/Hänge-Rutschen), Waffen (Neumodellierung, Aufsätze, Munitionstypen, Inspizier-/Nachlade-Animationen, Arme/Hände), Fahrzeuge (Nachschub, WT-Schaden, Crew, neue Typen, AT/AA, Heli/Jets, Fahrzeug-Serien, Bots fahren), Abschussserien per Level, Grenzland mehr Deckung + Bot-Verteilung, NPC-Strategien/Funk/Stimmen/Regen, Bug-Log-Reste.
3) Dann die „Wunschliste 06.10. abends“ (Modi, Shop, Zerstörung, Interieur, Licht, Gore, Friendly Fire, Karten-Feinschliff).
4) GRAFIK GANZ ZULETZT (Bodycam-Look, Grafikstufen sichtbar unterschiedlich, Leistungsoptimierung).

## Nachtrag 06.10. spät (Nutzer) – gehört zu Schritt 2–4 der REIHENFOLGE bzw. „später, wenn noch Energie übrig“
- Gilt ausdrücklich: ALLE in diesem Chat besprochenen Punkte umsetzen (nicht nur die Listen) – Aufsätze für Waffen sicher einbauen.
- Zu Schritt 4 (Grafik, zuletzt): alles neu rendern/überarbeiten; Texturen auf allen Karten EINHEITLICH (kein „zusammengewürfelter Flickenteppich“); Lichtverhältnisse richtig; Lichtstrahlen nicht blockig/„wie Bauklötze“, sondern weich verteilt und realistisch geworfen; realistische Schatten; eigener Spieler-Charakter wirft je nach Sonnenstand einen Schatten, ebenso alle NPCs und Gegenstände (prüfen, wo das noch fehlt).
- Waffen extrem detailliert modelliert + gute Texturen; Inspektion mit mehr Animationen; generell deutlich mehr und schönere Animationen in allen Situationen, mehrere Varianten pro Aktion (z. B. mehrere Nachlade-Animationen).
- Später (nach den Megapatches, wenn noch Kapazität): Emotes.
- NUTZER-SCREENSHOTS 06.10. ~22 Uhr (Live, Edge/PC, Hafen TDM, M-17 Falke mit Holo-Visier): gleicher Fehler wie oben – Waffe kippt hoch/aus der Visierlinie, obwohl vorne frei ist (zwischen Containern links/rechts; vor der Lagerhalle mit Abstand). Lösung wie beschlossen: Wandhaltung nur als Einstellung (Standard AUS) + Fehlauslöser seitlicher Objekte beheben.
- ENTSCHEIDUNG NUTZER (06.10. ~22 Uhr) zur Waffe an Hindernissen – Einstellung „weaponObstruction“ mit 4 Optionen: (1) Hochnehmen (bisheriges Verhalten, nur echtes Hindernis direkt vor der Mündung, kein Fehlauslöser durch seitliche Objekte), (2) Keine Anpassung – Waffe ragt sichtbar in Wände (nur Option, NICHT Standard), (3) An den Körper ziehen/nach unten drücken, (4) Ruhig: Waffe bewegt sich nicht und wird über die Welt gezeichnet (wie in den meisten Shootern) = STANDARD. Wird im Release-Fix-Workflow umgesetzt (Release-Arbeitskopie scratchpad/release); falls nicht fertig → Donnerstag Schritt 2.
- NUTZER 06.10. ~22 Uhr: Welt so lebendig wie möglich (wie in vielen Spielen): Wasser animieren (Hafen, Grenzland-Fluss, Altstadt-Brunnen), Schwimmen (WIP), Bäume/Pflanzen/Gras im Wind, möglichst viel animieren.
- FEHLER Lichtstrahlen (Lichtschein): wirken blockig/„boxig“ UND folgen nicht dem Sonnenstand – bei Morgen/Abend kommen sie weiter aus der Mittagsrichtung. URSACHE GEFUNDEN: world/index.js:251 berechnet sunDir aus der Basis-Beleuchtung der Karte (def.lighting.sun.elevation/azimuth), nicht aus der an Tageszeit/Wetter angepassten Sonne; world/index.js:385 übergibt dieses sunDir an createAtmosphere (world/atmos.js:207 L = sunDir, Strahl-Volumen einmalig daraus gebaut). Fix: angepasste Sonnenrichtung (light.lighting.sun bzw. Tageszeit-Ergebnis) verwenden, Strahlen-Volumen danach ausrichten/neu bauen; blockige Kanten weich ausblenden (Rand-Falloff, Rauschen, ggf. Raymarch statt Box-Volumen). Gehört zu Schritt 2 (Fehler) bzw. Schritt 4 (Optik).

- RELEASE-FIX-ARBEIT (angehalten 06.10. ~22:30 auf Nutzerwunsch): docs/planung/release-fixes-wip.patch = unfertiger Stand gegen den LIVE-Stand (Basis: 2f448f2 + Hotfix-Dateien; Anwenden: Arbeitskopie bei 2f448f2 anlegen, Hotfix-Dateien aus dem Zweig holen wie im Hotfix, dann git apply). Enthält Nachladeton + Gegnernamen (umgesetzt, ungeprüft) und begonnene Waffen-Hindernis-Einstellung (4 Optionen). Prüfen, fertigstellen, veröffentlichen.

- SPÄTER (Nutzer 07.10., „wenn das Game gut ist“): privates Gedächtnis-Repo für Nathanael + Claude (Nutzer legt es privat an und gibt der Claude-App Zugriff; Claude befüllt es mit Gesprächs-/Tagebuch-Notizen). Persönliches NICHT in dieses öffentliche Repo schreiben.

## DUELL-MODUS + spielerübergreifend lernende Bots (Nutzer 07.10.) → mit dem MEHRSPIELER-Patch (Schritt 1) planen
- Duell-Modus 1v1 bis 4v4: online (Raumcode/Matchmaking) und offline gegen bzw. mit Bots; kleine, symmetrische Duell-Karten bzw. Ausschnitte, Runden-Format (z. B. erster mit 6 Rundensiegen), kurze Runden.
- Bots lernen vom Spieler (auf bestehendem spielstil.js/BotAdapt aufbauen): Bewegungsmuster (Strafe-Rhythmus, Peeks, Ducken/Springen im Gefecht, Rutschen), bevorzugte Wege/Positionen, Vorziel-Stellen, Kampfdistanzen, Granaten-/Taktikverhalten, Timing → nach wenigen Runden „wie ein echter Spieler“.
- Spielerübergreifend: Elite-Bots sollen aus dem gesammelten Wissen ALLER Spieler lernen. ACHTUNG Technik/Sicherheit: Ein statisches GitHub-Pages-Spiel kann nicht selbst ins Repo schreiben, und ein GitHub-Schlüssel im Browser wäre öffentlich auslesbar (Missbrauchsgefahr). Lösung: kleiner Sammel-Endpunkt (z. B. Cloudflare Worker / Supabase, kostenlose Stufe; Konto muss der Nutzer anlegen) nimmt anonymisierte Spielstil-Statistiken an (Ratenbegrenzung, Plausibilitätsprüfung, robuste Mittelung gegen Manipulation), eine GitHub Action holt regelmäßig das zusammengefasste Bot-Wissen und committet es als Datei ins Repo → Spiel lädt es beim Start. Datenschutz: nur anonyme Spielstatistik, Hinweis + Opt-out in den Einstellungen.

## MEHRSPIELER: Spielerzahl, Verbindungstest, Host-Auswahl (Nutzer 07.10. abends) → Teil von Schritt 1
- Bis zu 32 Spieler pro Match (Ziel). 8 = sicherer Standard; Host wählt im Lobby-Menü die Maximalzahl (z. B. 8/12/16/24/32).
- Verbindungs- und Hardware-Test in der Lobby: Upload/Latenz direkt zwischen den Spielern über den WebRTC-Datenkanal messen (kein eigener Testserver nötig); dazu Hardware-Hinweise des Browsers (CPU-Kerne, Arbeitsspeicher-Stufe, Grafikkarte, gemessene Bildrate). Daraus ein EMPFEHLUNGSWERT „bis zu N Spieler“ für den Host; über der Empfehlung Warnhinweis, aber erlaubt.
- Öffentliche Zufallsmatches: Spiel wählt automatisch den besten Kandidaten als Host (Upload + Leistung + Latenz zu den anderen); später ggf. Host-Wechsel, wenn der Host geht.
- Freiwilliger Host (Raumcode oder öffentliches Spiel): stellt Maximalzahl nach eigener Verbindung ein, Empfehlungswert wird angezeigt.
- Bots füllen die Teams bis zur eingestellten Matchgröße auf (mehr Menschen → weniger Bots); Bot-Anzahl einstellbar, Empfehlung berücksichtigt auch die Bot-Rechenlast beim Host.
- Bandbreite wächst ungefähr quadratisch mit der Spielerzahl → Interest-Management (weit entfernte Spieler seltener senden) für große Karten; echte Grenze beim Testabend mit der SL-/UGN-Community messen (vorher kurze Testanleitung schreiben).
- 50–100 Spieler (Battle Royale) gehen nicht über den Browser eines Spielers → bräuchte dedizierten Server (Kosten), erst später entscheiden.

## MEHRSPIELER IN ZWEI STUFEN veröffentlichen (Nutzer 07.10. abends)
- STUFE 1 live bis SAMSTAG 12 UHR (Nutzerwunsch 07.10.; Start Do. 17:10; Fr. abends Test mit Nutzer PC+Handy; falls Router-/NAT-Probleme: trotzdem Sa. mittag veröffentlichen, Relay-Lösung nachreichen): Raumcode + öffentliche Spiele, Host-Menü, Verbindungstest + Empfehlungswert, bis 32 Spieler mit Bot-Auffüllung, Grund-Anti-Cheat (Host prüft Treffer/Bewegung), bestehende Karten und Hauptmodi.
- STUFE 2 danach als eigenes Update: Matchmaking nach Können, Duell-Modus 1v1–4v4, Fahrzeuge online auf großen Karten, Host-Wechsel, lernende Bots; spielerübergreifendes Lernen erst, wenn das Sammeldienst-Konto (Cloudflare/Supabase) existiert.

## VR-MODUS (Nutzer 07.10. ~24 Uhr) – Zielgerät Meta Quest 3 (512 GB)
- Spiel im Browser per WebXR mit VR-Brille spielbar machen (three.js bringt WebXR mit). Zwei Wege, gleicher Code: (a) direkt im Quest-Browser (überall, aber Grafik stark reduziert: Mobilchip, doppeltes Rendern, 72–90 fps Pflicht); (b) über PC mit Air Link/Quest Link in Chrome/Edge (PC rendert, volle Grafik).
- Stufe A (Grundlage): Kopf-Tracking, Bewegung per Stick, Snap-Turn + Komfort-Vignette gegen Übelkeit, Waffe in der rechten Hand mit Controller zielen/schießen, HUD als Anzeigen in der Welt/an der Waffe, Postprocessing im VR-Modus aus bzw. angepasst, eigene VR-Grafikstufe (Foveated Rendering).
- Stufe B (gutes VR): beide Hände an der Waffe, Nachladen per Handbewegung, Menüs/Lobby in VR, Granaten werfen, Ducken/Lehnen echt, VR + Mehrspieler zusammen.
- Test nur am echten Gerät aussagekräftig (Nutzer testet); im Container nur WebXR-Emulator.
- EINORDNUNG (Vorschlag Claude): NACH Mehrspieler-Stufe 1 (Sa. 12 Uhr nicht gefährden); Nutzer kann umpriorisieren.

## IRGENDWANN (Nutzer 08.10.): eigenes Scan-Werkzeug für 3D-Modelle
- Ziel: Nathanael fotografiert/filmt echte Objekte mit dem Handy → daraus wird automatisch ein spielfertiges Modell für NULLPUNKT.
- Weg 1 (einfach): fertige Scan-App (RealityScan/Polycam/Scaniverse) → glb hochladen → eigene „Brücke“: Größe/Ausrichtung korrigieren, Boden/Reste abschneiden, verkleinern, LODs + Kollision, KTX2-Texturen (bestehende Asset-Pipeline nutzen) → im Spiel platzierbar.
- Weg 2 (eigener Scanner): Fotos in ein Repo laden → GitHub Action rechnet Photogrammetrie (z. B. COLMAP + OpenMVS) auf CPU → glb → Brücke wie oben. Unklar, ob das auf kostenlosen Runnern schnell genug ist → erst mit kleinem Objekt testen.
- Rechte: nur selbst gescannte Objekte bzw. erlaubte; keine Personen.

## NUTZER 08.10. ~21:30 – vor dem Mehrspieler-Release (Kartenrunde)
- Liste 1 (in Arbeit, Workflow maps-wishes): Grenzland Gemüsestände an der Kirche (Mitte), Traktor in die Hütte, linke Straßenseite Brücke oder Erddamm mit Rohr; Hafen-Kran und Werk-Kran bewegen sich ab und zu links/rechts; Altstadt Glocke, Balkone an Wänden, Grills auf Dächern.
- Kirchenglocke Altstadt GENAU: wie eine echte Kirchenglocke zu JEDER VOLLEN STUNDE die Stundenzahl schlagen (9 Uhr → 9 Schläge, 21 Uhr → 9 Schläge), „einfach generell so“. → braucht eine laufende Spieluhr (Start = Tageszeit der Runde).
- ALLE Karten: nach Logikfehlern, deplatzierten/unpassenden Gegenständen, Glitches und Bugs suchen und beheben.
- Häuser: passende Inneneinrichtung (nicht leer wirken) + Innenbeleuchtung.
- Verbündete Bots sollen ebenfalls „wachsen“/lernen (nicht nur Gegner-Bots, spielstil.js/BotAdapt).
- Texturen verbessern → erst MEGAPATCH 2 (Grafik), JETZT NICHT.
- Liste 2 mit Bugs folgt vom Nutzer; beide Listen berücksichtigen.

## LISTE 2 (Nutzer 08.10. ~21:45) – Einordnung
A) JETZT, vor dem Mehrspieler-Release (Kartenrunde 2: Fehler/Logik/Feinschliff):
- Altstadt: Couch entfernen; Brunnen mit Wasseranimation; Turmuhr-Glocke schlägt zu jeder vollen Stunde die Uhrzeit (Läuten abschaltbar in den Einstellungen); Bänke: Sitz mit Rückenlehne verbinden; Blumenbeete schöner; aufgeplatzte Fassaden einheitlicher/schöner; Abend: Laternen an mit gut verteiltem, realistisch geworfenem Licht.
- Werk: unsichtbare Wand an der Treppe in der großen Halle entfernen, Hitboxen an die Größe der Gegenstände anpassen; Treppe richtig an die Etage anbinden; schwebende Lampen an die Decke; Rohre sinnvoll verbinden/platzieren; einzelnen deplatzierten Ziegelblock entfernen; Werkbank am Eingang entfernen (steht im Weg); Stahlrollen realistisch stapeln; Waggon-Schiebetüren mit Griff (evtl. öffnbar); Flutlicht sinnvoll ausrichten.
- Alle Karten: deplatzierte/ineinander verbuggte Gegenstände entfernen oder sinnvoll setzen, Schilder, Säulen/Gebäudeteile, Bäume besser setzen, Pflanzen/Gras im Wind, offene Container begehbar, Räder von LKW/Gabelstapler richtig gedreht, MG-Nester auf Kriegskarten, kreative Kartengrenzen statt unsichtbarer Wände, Inneneinrichtung + Innenbeleuchtung, Hafen-Kran fährt hin und her.
- Mehrspieler: Host kann Ausdauer an/aus schalten (unbegrenzte Ausdauer); Online mit und ohne Bots (vorhanden: „Bots füllen auf“).
- Verbündete Bots lernen ebenfalls.
B) SPÄTER nach der verbindlichen Reihenfolge (Schritt 2–4): Battle Royale, CoD-Modus, Rundenwährung/Shop (1 Kill = 1 Coin, auch nicht freischaltbare Waffen), zerbrechliche Fenster, realistischer Gebäude-/Objektschaden (Granaten, Patronen, Panzergeschosse), Dachböden zum Snipen, Spielerschatten, Sonnenstrahlen nicht durch Wände, Ton je Oberfläche, Kletter-/Fenster-Animationen, Taschenlampen, Einschusslöcher je Material, fahrbare LKW/Gabelstapler, Türen, Karten aus 3D-Scans, Skin-Vorschau in der Lobby, Schreie, Blut/Messer, Friendly Fire + Ausschalter + XP-Abzug, Gore einstellbar (Wunden, Knieschuss-Hinken, Medkits, Leichen alle 10 Min., einstellbar), Kaliber + Durchschlag je Wanddicke, Todesursache, Killcam (abschaltbar), Waffenwechsel-Animation, Zweibein auf Flächen, Aufsätze, Rückstoß je Waffe/Aufsatz, NEU: Konvoi-Modus (verteidigen/angreifen mit Fahrzeugen), Wellen-Überleben, lustige Kampagne mit KI-Stimmen, KI lernt spielerübergreifend + erfindet Taktiken (Sammeldienst), Website-Unterseiten statt alles auf der Startseite, Texturen (Megapatch 2/Grafik).
- KORREKTUR Glocke (Nutzer 08.10. ~22 Uhr): an die ECHTE Uhrzeit koppeln wie die Armbanduhr (gunsmith/textures.js:370) – zu jeder echten vollen Stunde Stundenzahl schlagen (12-Stunden-Zählung: 21 Uhr → 9 Schläge, 12 Uhr → 12), Läuten abschaltbar. BESTÄTIGT (Nutzer): Tageszeit-Option „Echtzeit“ (nächstliegende Tageszeit der Karte zur echten Uhrzeit; online gilt die Uhr des Hosts).

## VR-MODUS JETZT MIT DEM MEHRSPIELER-RELEASE (Nutzer 08.10. ~22:15, hat eine Meta Quest 3)
- VR-Stufe A kommt mit der Live-Beta (Freitag): in den Einstellungen „VR-Modus (Beta)“ aktivieren → im Spiel „VR starten“ (WebXR, HTTPS über GitHub Pages ok).
- Umfang Stufe A: Kopf-Tracking, Zielen/Schießen mit rechtem Controller, Laufen per Stick, Drehen in Schritten + Komfort-Vignette, Nachladen/Waffenwechsel/Springen/Ducken auf Tasten, HUD als Anzeige am Handgelenk/in der Welt, Postprocessing in VR aus, eigene VR-Grafikstufe (72–90 fps auf Quest; volle Grafik über PC + Air Link). Menüs außerhalb von VR (Lobby am Bildschirm, VR erst im Match).
- Test im Container mit WebXR-Emulator (IWER von Meta, nur Testwerkzeug); echter Test durch Nathanael am Freitagabend auf der Quest 3.
- Danach Live-Beta veröffentlichen, wenn aus Claudes Sicht bereit; Freitagabend gemeinsamer Test; gut → bleibt so, Nutzer gibt den Leuten Bescheid; schlecht → nachbessern.
- VR-ERGÄNZUNG (Nutzer 08.10. ~22:30):
  - Komfort-Einstellungen einstellbar: Rand-Abdunkeln (Vignette) an/aus + Stärke, Drehen in Schritten oder flüssig, Schrittwinkel, Sitzend/Stehend, Haupthand.
  - Alle Einstellungen des PCs gelten auch in VR. Ein Menü in der Brille mit den wichtigsten Schaltern; das volle Einstellungsmenü in der Brille kommt später.
  - VR-Steuerung wie in gängigen VR-Shootern, frei belegbar über das vorhandene Tastenbelegungs-System.
  - Körperhaltung echt: Ducken/Hinlegen über die echte Kopfhöhe, Lehnen über die Kopfbewegung.
  - Andere sehen die VR-Bewegungen: Kopf, Zielrichtung der Hand, Lehnen; Arme/Hände, so weit die Puppen-Animation es erlaubt.
  - Geräte-Symbol (PC/Handy/VR) in der Anzeigetafel.
- LEICHEN (Nutzer): sollen liegen bleiben; Verschwinden optional (Einstellung, Standard „bleiben liegen“). Leistungsschutz: Obergrenze je Grafikstufe, die ältesten verschwinden erst ab der Grenze, eingefrorene Leichen ohne Animationskosten. Gag: VR-Spieler können sich tot stellen.
- GRENZLAND BODEN/GRAS (Nutzer 09.10. ~9 Uhr): Boden besser, Gras realistischer – kommt noch vor die Live-Beta (nach der Baum-Kollisions-Korrektur in vegetation.js, nur Optik, keine Kollision).
- ANIMATIONEN (Nutzer 09.10. ~10 Uhr, läuft: Workflow animations-pass): je Waffenart 4 eigene Inspizier-Animationen passend zum Mechanismus (Repetierer Kammer öffnen, MG Deckel/Gurt, Sturmgewehr Ladehebel-Kammercheck, Pistole Schlitten zurück + Blick in die Kammer wie in SCP:SL, Schrotflinte, Revolver-Trommel). Realismus-Stil: keine Munitionsanzeige im HUD – nur durch Inspizieren (sichtbare Patronen + Schätzung „fast voll/etwa halb/fast leer“, Ersatzmagazine). Kein Clipping: Magazin fährt exakt in der Magazinschacht-Achse, nichts gleitet durch Waffe oder Hände („harter Block“).
- BEFEHLSRAD (Nutzer 09.10. ~10:15, läuft: Workflow command-wheel): Radialmenü wie Helldivers für verbündete Bots – Mir folgen, Position halten, Sammeln, Formation (Reihe/Keil/Kreis), Angreifen/Verteidigen (Zielpunkt), Ausschwärmen, Frei handeln; Taste/Gamepad/Touch, belegbar; online: Befehl vom Client an den Host. Kommt mit dem Abend-Update.
- ZIELBILD (Nutzer 09.10. ~12 Uhr): Konzeptbild, wie das Spiel ausgereizt aussehen könnte (eigene realistische Texturen, Waffe, Hand, Arm) – als Zielbild für später; schnell und sparsam.
- PANZER MEHRSPIELERTAUGLICH (Nutzer 09.10. ~12:40, läuft: Workflow panzer-mp, Spezifikation docs/planung/panzer-mp.md): bessere Motorleistung (leistungsbasiertes Triebwerk mit Drehmoment/Drehzahl), Gangschaltung wie Squad 44 („Gang halten“: W/S schalten, N + A/D dreht auf der Stelle; Tasten frei belegbar, da Squad-44-Belegung nicht verifiziert), mehrere Sichten je Sitz (Sehschlitz, Optik, Periskop, Luke offen, Außenansicht abschaltbar), Besatzung getrennt (Fahrer/Richtschütze/Kommandant/Ladeschütze), Fahrzeuge online (Host-autoritativ). Online nur, wenn Tests grün – sonst Raumeinstellung „Fahrzeuge“ Standard aus.
