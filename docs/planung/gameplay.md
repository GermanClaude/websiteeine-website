# Bughunt gameplay (2026-10-06, Rolle gameplay-hunt)

Format: [Schwere] Ort – Repro – Status (fixed / Donnerstag)

## G1 [KRITISCH] weapons/controller.js `_updateMelee` – TDZ-Fehler `spec` vor `const spec`
- Repro: `node tools/out/bughunt/gp-modes.mjs --map=hafen --modes=inf` → 6× `ReferenceError: Cannot access 'spec' before initialization at _updateMelee (controller.js:940)` (Infizierte mit Messer-Ausfallschritt). Jeder Messerangriff mit Ausfallschritt (animAt > 0, Spieler UND Bots) warf jedes Bild, bevor `m.t >= m.end` den Angriff beendet → Waffe des Akteurs hing dauerhaft (Bot: Rest der Bot-Schleife des Bildes übersprungen).
- Fix: `const spec = m.spec` vor die erste Verwendung gezogen. Status: **fixed** (Nachtest unten).

## G2 [MITTEL] bots/ai/tactics.js `pickRoamGoal` – erhöhte Posten gewinnen 84 % aller Umherzieh-Ziele → Werk-Außenlager (TDM) nie Ziel
- Repro: `node tools/out/bughunt/gp-werkwest.mjs --seconds=150` (Werk TDM 6v6 Regulär). Vorher: Ziel-Herkunft nachgebaut 300 Runden → Posten 253, Spur-West 1; `pickRoamGoal` mit Spur 0/1/2 → 0 % Ziele im Außenlager (x < −53, 857 Nav-Knoten, Pfade vorhanden, kein Posten dort); Bot-Anwesenheit dort 0,1–0,3 % (1 Besucher, nur über engage/chase).
- Ursache: Posten-Kandidaten (22 % je Versuch) mit +1,1 Bonus (+0,6 Deckung) konkurrierten in derselben Runde mit Spur-Kandidaten → Spurwahl praktisch wirkungslos, alle Ziele zu den Posten im Werkszentrum (x≈20).
- Fix: Posten-Runde wird vorab gewürfelt (`PERCH_GOAL` 0,35, FFA 0,175), sonst Boden-Kandidaten ohne Postenbonus. Nachher: Spur 0 → 15–16 % Ziele im Außenlager, Spur 1/2 → 2–3 %; Anwesenheit 4,5 % / 10,1 % aller Bot-Proben, 5–7 Bots besuchen es je 150 s. Status: **fixed**.

## G3 [MITTEL] modes/conquest.js `_besideMate` – Trupp-Spawn ohne Bodenhöhe → Spawn im Gelände (Grenzland-Hang)
- Repro: `node tools/out/bughunt/gp-cq.mjs --seconds=150` (Grenzland cq 32v32): Spawn B bei (65.8, 0.9, −54.8), Boden 1.7 m, Kapsel 0,36 m im Gelände. `_besideMate` setzte den Punkt 1,4 m hinter den Kameraden auf DESSEN Höhe, prüfte nur Sichtlinie.
- Fix: Bodenhöhe am Punkt (`groundHeight`), Stufe > 0,6 m oder keine Sicht → an der Stelle des Kameraden. Nachher 0 Problem-Spawns (≈ 220 Spawns, 300 s). Status: **fixed**.

## G4 [GROSS → Donnerstag] Bots benutzen keine Fahrzeuge
- Repro: gp-cq.mjs, 32v32 Eroberung 300 s: `botsInVeh 0`, `vehicle:enter` nur durch den Spieler; 6 Fahrzeuge (2× mbt + 1 jeep je Seite) schlafen die ganze Runde. Autopilot (`vehicles/autopilot.js`, `Vehicle.driveTo/followPath/aimAt`) existiert, aber keine Bot-Entscheidung „Fahrzeug nehmen/fahren/Schütze“. Pioniere schießen nur auf besetzte Fahrzeuge → Panzerabwehr spielt ohne Spieler im Fahrzeug keine Rolle. Status: **Donnerstag** (Feature: Fahrer-/Schützen-Rolle in brain/squad, Einsatzkarte `vehicle`-Punkt für Bots).

## Beobachtungen ohne Befund (Grenzland cq)
- Tickets 400/400 → ≈ 290 nach 300 s (Abschüsse + Ausbluten), Flaggen wechseln (6–8 Eroberungen), HQ-Spawns ok, Spieler steigt in mbt/jeep ein, fährt (16/12 m in 5 s per Autopilot), steigt ohne Eindringen aus (Tiefe 0). Fahrzeug zerstört → `vehicle:spawn` später, nach 300 s wieder 6/6. Keine Fehler.
- Panzer rollt nach dem Aussteigen weiter (4,5 m/s 0,1 s nach dem Aussteigen; Jeep 0,01) – vermutlich Auslaufen, nicht weiter geprüft.

## G5 [KLEIN] weapons/ballistics/rockets.js `_impact` – Blindgänger (< armDistance 6 m) beschädigt eigene/verbündete Fahrzeuge
- Ursache: nicht scharfe Rakete ruft `applyDamage` mit `kind: 'collision'` – diese Art überspringt in `Vehicle.applyDamage` die Freund-Feind-Prüfung (gedacht für Unfälle) → bis ≈ 60 (Jeep, ×FACE_MULT mehr) Schaden am eigenen Fahrzeug, ohne Teambeschuss.
- Fix: Blindgänger gegen nicht feindliches Fahrzeug (`v.hostileTo(attacker)` false) → 0 Schaden (Abpraller-Effekt bleibt). Nachtest `gp-misc.mjs`: eigener Jeep 3,5 m → 0, feindlicher Jeep 3,5 m → 122 (Blindgänger), feindlich 14 m → 350 (zerstört). Status: **fixed**.

## Geprüft ohne Befund
- Alle 20 Schusswaffen (gp-weapons.mjs): Ausrüsten, Feuern (Schüsse = Magazinabnahme), Anschlag 1,0 (Ausnahmen nur während Auto-Nachladen nach leerem Magazin – erwartet), Nachladen = reloadTime, Auto-Nachladen bei leerem Magazin, Wechsel hin/zurück; 4 Nahkampfwaffen ohne Hänger (nach G1-Fix); 6 Wurfmittel geworfen, Splitter/Semtex/Aufschlag/Blend/Rauch detonieren.
- Lernende Bots: 5 kaputte Speicherstände (`{kaputt`, `null`, Karte null, falsche Typen, Teilfelder) → keine Fehler, Speicher wird gültig neu geschrieben; Einstellung aus → bei Revanche auf derselben Karte `active=false`, nichts gespeichert.
- Wetter/Zeit: Werk Morgennebel/Morgen, Altstadt Bewölkt/Abend, Hafen Dunst/Mittag, Grenzland Zufall → richtig aufgelöst, keine Fehler.
- Modi × Karten (gp-modes.mjs, Hafen/Altstadt/Werk alle 6 Modi, Zeit- und Punktlimits): Matchende per Punkte/Zeit/Verlängerung, Endbildschirm, Lobby → Neustart ×6 ohne Fehler, Listener in der Lobby konstant 28, keine Spawns in Geometrie/außerhalb/ohne Boden, Herrschaft-Flaggen mit Nav-Pfad von beiden Seiten erreichbar.

## Hinweise für andere Rollen
- [world] Grenzland-Nav-Warnung beim Laden: „Nicht erreichbare Fläche (15 Punkte) bei (52.8, 6.4, −18.0) und (52.8, 6.4, 10.5)“ (Dächer/Plattformen?) – **Donnerstag/world**.
- Lobby-Geometrien/Texturen wachsen je Match leicht (TDM Hafen ×5: Geo 94→114, Tex 144→153); Werk TDM ×8: Geo 100→114→119→125→130→130→130, Tex 144→149→149 → Plateau = Warm-Caches, **kein Leck**.

## G6 [KLEIN] modes/killconfirmed.js `_drop` – Marken-Knoten über `visible` vergeben → blinkende Marke verliert ihr Modell
- Ursache: freie Pool-Knoten wurden per `!x.visible` gesucht; Marken blinken in den letzten 5 s (`g.visible` zeitweise false) → eine neue Marke bekam den Knoten einer noch lebenden Marke (Modell springt zur neuen Stelle; beim Ablauf der alten wird die neue unsichtbar, bleibt aber aufsammelbar).
- Repro (Szenario in `kc.mjs`, Scratchpad): Marke 1 in Blinkphase bis unsichtbar, dann Marke 2 → vorher gleicher Knoten (Lesart des Codes: `find(!visible)` liefert Knoten 0 = Marke 1). Fix: Flag `userData.used` (setzen in `_drop`, löschen in `_remove`). Nachher `shared:false`, belegte Knoten = lebende Marken (6/6) nach 150 s Simulation. Status: **fixed**.
- Beobachtung (Balance, Donnerstag): Hafen KC 150 s: 51 Marken, 9 bestätigt, 28 verweigert, Rest abgelaufen – Bots verweigern 3× öfter als sie bestätigen (`objectiveFor` = nächste Marke ≤ 30 m ohne Teamgewichtung); KC-Matches enden fast immer über die Zeit (Punkte 7:2 nach 150 s bei Limit 50).

## G7 [MITTEL → Donnerstag] Keine Munitionsaufnahme für den Spieler
- Befund: Spieler-Munition ist endlich (`infiniteAmmo` nur Bots + Training), es gibt keine Aufnahme (keine Kisten, kein Aufheben bei gefallenen Gegnern, kein Nachschub-Gadget) – `reserve` wird nur beim Spawn (`refill`) gesetzt. Sturmgewehr 30+120, Scharfschütze 5+20/25: wer lange überlebt (Serien, Eroberung 40 min), schießt sich leer. Repro: `grep -rn "reserve +=\|_addAmmo(" assets/js/game` → nur Nachladen aus der eigenen Reserve.
- Vorschlag: Munition von gefallenen Gegnern (Magazin-Beutel am Todesort, wie KC-Marken, 1 Magazin Primär + Sekundär), in Eroberung zusätzlich Nachschub an eigenen Flaggen/HQ. Status: **Donnerstag** (Feature).

## Geprüft ohne Befund (Klassen/Panzerung, gp-classes.mjs, Stil realistisch + armor)
- Sturm (Weste mittel 3×30, Helm 60): Treffer 45 → Weste 90→36, HP 87; Platte (1,2 s) → 60 (beschädigte Platte ersetzt, carry 3→2); Adrenalin 87→100 + Tempo; Kopftreffer 30 → Helm 60→44, HP 100→71.
- Sanitäter-Medikit: Verbündeter 40 → 85, Ladungen 3→2. Pionier-Reparatur: eigener Jeep 175 → 350 in 3 s. Aufklärer-Markieren: Gegner 7,6 s markiert. Panzerung ohne `armor` auf Arena-Karten aus (so gewollt, `armorFor`).
- Eingabe-Fuzz Spieler (gp-fuzz.mjs; Laufen/Sprint/Sprung/Ducken/Liegen/Rutschen/Lehnen/Anschlag/Feuer/Granate/Nahkampf zufällig, 240–300 s je Karte, Hafen/Altstadt/Werk/Grenzland realistisch, 2 Seeds): 0 Ausnahmen, 0 NaN, 0× außerhalb der Karte, 0× > 1 s in Geometrie.
- Bots-Simulation nach G2 (tools/sim.mjs Werk/Hafen TDM 120 s): Festhängen ≥ 3: 0, inWall 0, Wandlaufen 3/0.

- Erweiterte Viertel Hafen-Ost (x > 51) / Altstadt-Ost (x > 47), TDM 150 s nach G2 (`gp-werkwest.mjs --map=hafen --thr=51 --gt=1`): Bot-Anwesenheit 4,7 % / 7,5 %, 9 / 11 Besucher, Umherzieh-Ziele dort je Spur 5–34 % → werden genutzt.
- Panzer rollt nach dem Aussteigen nur aus (Sitz-Absicht wird in `_unseat` per `newIntent()` zurückgesetzt) – kein Befund.

- Eroberung Spieler-Tod/Einsatz/Ende (Grenzland 5v5, Scratchpad `cqend.mjs`): Tod → 8 s Wartezeit, Einsatzpunkte HQ + Trupp + Fahrzeuge (Flaggen ohne Besitz gesperrt), `G.deploy()` → lebt im HQ; Tickets werden beim Wiedereinstieg abgezogen (BF-Art, so gewollt); B auf 1 + Tod eines B-Bots → nach dessen Respawn 0 → `ended`, Grund `tickets`, Sieg. Kein Befund.

- Waffenspiel (Hafen, Scratchpad `gun.mjs`): 18 Abschüsse → Stufen smg_vp9 → … → knife, Ende `score`, Sieg; keine Fehler.

## Zusammenfassung (Stand Ende Sitzung)
- **fixed:** G1 Messer-TDZ (kritisch), G2 Bots ignorieren Werk-Außenlager/Posten-Übergewicht, G3 Trupp-Spawn im Hang, G5 Blindgänger-Teamschaden an Fahrzeugen, G6 KC-Marken-Knoten.
- **Donnerstag:** G4 Bots fahren keine Fahrzeuge (Fahrer/Schütze-KI), G7 keine Munitionsaufnahme, KC-Bot-Balance (Bestätigen vs. Verweigern), Grenzland-Nav-Warnung (world).
- Prüfstände: `tools/out/bughunt/gp-*.mjs` (modes, werkwest, cq, weapons, misc, fuzz, classes).
