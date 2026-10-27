# Modi-Plan (Spur M) – Umsetzung

Nutzerwunsch 26.10.: „Kannst du noch mehr Modi einfügen …“. Gesamtplan: Arbeitsplan Modi · Karten · Texturen (§3 Spur M).
Je Etappe ein Abschnitt; diese Datei gehört nur der Spur M (keine gemeinsame Plan-Datei, keine Konflikte).

---

## M1 – Stellung (`hp`) + Daten-Grundlagen B6/B7 (26.10.)

### Was gebaut ist
- **Modus Stellung** (`game/modes/hp.js`, Unterklasse von `DomMode`): genau eine aktive Zone, die in fester Reihenfolge
  wandert (Standard alle 60 s, Einstellung 45/60/90 s). 10 s vor dem Wechsel erscheint die nächste Zone gedimmt
  (`objectives[1].next`). Keine Einnahmezeit: allein drin = gehalten (1 Teampunkt je Sekunde), beide Teams drin =
  umkämpft (keine Punkte, Besitz bleibt stehen), niemand drin = nach 3 s Nachlauf neutral (im Nachlauf keine Punkte).
  250 Punkte zum Sieg (Einstellung 150/250/350),
  10 min, Verlängerung wie Basis.
- **Punkte/Medaillen/Herausforderung** (`shared/modes.data.js`): `hold` +50 je 5 s in der gehaltenen Zone,
  `hpcapture` +100 (wer im Team zuerst drin war, wenn das Team sie allein hält – je Zone nur beim ersten Halten seit dem
  Wechsel oder bei Übernahme vom Gegner, nicht nach Räumen und Wiederbetreten), `hpdefend`/`hpassault` +25 für
  Abschüsse an der Zone; Medaillen Bollwerk (30 s halten ohne zu fallen), Stellungskämpfer (5 Abschüsse an der Zone in
  einem Leben), Vorhut (Erster in einer neuen Zone, das Team nimmt sie); Herausforderung „Halte die Stellung insgesamt
  {n} Sekunden“ (`hpTime`, Zähler je Spieler). Tabelle: Spalte „Haltezeit“, Endbildschirm: Feld „Haltezeit“.
- **B6 Modus-Daten**: `MODES[id].online` / `.onlineVehicles` / `.maxTeam` ersetzen die doppelten Listen
  (`ONLINE_MODE_IDS`, `VEHICLE_MODE_IDS`, `maxTeamOf()` – `net/index.js` und `ui/net-menus.js` lesen dieselbe Quelle).
  `MODES[id].options` (z. B. Stellung: Zonenwechsel, Punkteziel) baut ein gemeinsamer Regler-Baustein
  (`ui/mode-options.js`) in der Lobby (Einsatz-Reiter, gemerkt in `settings.modeOptions`) und im Raum-Menü
  (`room.settings.modeOpts` → `cfg.net.modeOpts`). Optionen mit `limit: 'scoreLimit'` lässt das Raum-Menü weg, weil
  dort der allgemeine Punkteziel-Regler steht; `normalizeSettings` nimmt sie gar nicht erst in `modeOpts` auf, und der
  Modus beachtet online nur das Punkteziel des Raums (sonst galt ein in der Lobby gewähltes Ziel versteckt).
  Prüfwerkzeuge: `?mopt=wechsel:45`.
  `main.js` bleibt unberührt: Offline liest der Modus die Lobby-Wahl aus den Einstellungen, online aus `cfg.net`.
- **B7 Zieldaten** in eigener Datei `world/maps/modus-ziele.js` (`{ karte: { hp: [...] } }`); `world/index.js` mischt
  sie mit drei Zeilen nach `world.objectives.hp` (Bodenhöhe aus dem Welt-Worker wie bei den Flaggen, keine Kollision →
  Kollisions-Hash unverändert). Prüfstand `dev/world.html` → Knopf „Modus-Ziele“ (Ring, Höhenband, Nummer, Minikarte).
- **HUD**: Flaggenleiste mit aktiver und (gedimmt, gestrichelt) nächster Zone, darunter Zonenname und „Wechsel in 0:42“
  bzw. „→ Kesselhaus in 0:08“; Weltmarker der nächsten Zone gedimmt; Zonenkreis auf der Minikarte; Balken in der Zone
  „Gehalten · +1 Punkt/s“ / „Umkämpft – keine Punkte“ mit Restzeit an diesem Ort (Haken `mode.captureView`).
  `hud._syncObjectives` baut Marker und Leiste jetzt auch bei gleicher Anzahl, aber anderen Ids neu.
- **Bots**: `objectiveFor` liefert die aktive Zone (fast immer „einnehmen“ = drinstehen und Deckung im Kreis suchen,
  ein Viertel der Halter sichert von außen). In der Vorschau setzt ein fester Anteil (34 %) jedes Teams schon zur
  nächsten Zone um. Beim Wechsel fragen alle Bots sofort neu ab. Wiedereinstieg: weich weg von der Zone
  (`spawnAttract`) und hart ≥ 25 m (`spawnAvoid`, neuer Haken in `BaseMode.chooseSpawn` wie eine Luftschlag-Zone).
- **Online**: sofort freigegeben. Zustand über `netExtra` (`hp` = [Zone, Besitzer, umkämpft, Anwesende A/B, s bis
  Wechsel, Vorschau, Wechselzähler], `hh` = Haltezeiten je netId). Keine neue Nachricht, kein `NET_VERSION`.

### Zonen je Karte (geprüft im Prüfstand, siehe `tools/hp-test.mjs --part=welt`)
| Karte | Wanderung |
|---|---|
| Werk | Walzhalle (−9, 0, Band nur Hallenboden) → Halle 9 → Kesselhaus (beide Ebenen) → Lkw-Hof Nord → Lkw-Hof Süd |
| Altstadt | Brunnenplatz (Ost, 10, 0) → Kirche → Torhaus → Werkstatt → Ölbaumplatz |
| Hafen | Kranplatz → Lagerhalle 3 → Kaikante (unter „Grete“) → Schuppen 4 |
| Bibliothek | Rotunde → Westgalerie (y 4,4) → Lesesaal Ost → Ostgalerie (y 4,4) → Lesesaal West |

Abweichungen vom Vorschlag (modi-neu §3), jeweils aus dem Prüfstand:
- Werk Walzhalle von (0, 0) nach (−9, 0) und Lkw-Hof von (−37, ±27) nach (−39, ±17): Werkssirene bzw. Leitstand lagen in
  der Zone (Regel: Kartenpunkte ≥ 4 m außerhalb des Kreises).
- Altstadt Brunnenplatz von (−6, 0) nach (10, 0): Glockenseil lag in der Zone.
- Hafen Kranplatz von (−14, −1) nach (−24, 0): Hafenradar lag in der Zone.
- Altstadt Ölbaumplatz von (58, 0) nach (56, 0): der Mittelpunkt lag im Ölbaum.
- Bibliothek: Brücken (z ±11) ersetzt – nur 14 m über einem Startbereich, nur 9 Navigationsknoten.

### Prüfungen
- `node tools/hp-test.mjs` (daten · welt · spiel), `node tools/modes-online-test.mjs --only=hp`, Bot-Matches mit
  `tools/sim.mjs --mode=hp` je Karte (Messwerte unten), `sh tools/check.sh`, `node tools/preload.mjs --check`,
  Rauchtests `tools/smoke.mjs`.
- Stand 27.10. (nach der Nachbesserung): hp-test daten+logik 59/59 (neu: Nachlauf, Randtanz, Rückeroberung,
  Online-Punkteziel, Raum-Optionen, Vorausgeher je Team), welt 29/29 (alle vier Karten, 26.10.), spiel 14/14 (Werk,
  mit Nachlauf statt sofort neutral); Rauchtests Hafen hoch 240 s (27.10.) und Altstadt niedrig Handy 150 s
  (26.10. abends, Spielcode seitdem unverändert) im Modus Stellung ohne Fehler außer abgebrochenen Ladeanfragen;
  check.sh, preload grün.
- Online `--only=hp`: **12/12 grün** (Einstellung, gleiche Zonen, Halten beim Host, Abbild beim Client mit Haltezeit,
  Vorschau, Wechsel mit Hinweis, Anti-Cheat, Seitenfehler). Die Testmaßnahmen bleiben: Abfragefristen, Client im
  eigenen Browser, Bibliothek ohne Bots, und eine abgestürzte Seite lässt den Test sofort scheitern
  (`page.on('crash')`), statt dass Playwright endlos wartet.
- Online `--only=inf,gun` (Regression der geänderten Abfragefunktion): **nicht nachgewiesen.** Auf dem Prüfrechner
  teilen sich alle Prüfläufe eine Speichergrenze von 14,3 GB, und eine Spielseite braucht beim Laden 2,5–3,5 GB. Alle
  Läufe (sieben mit inf, zwei davon auch mit gun; Werk und, mit neuem `--map=bibliothek`, die kleinere Bibliothek)
  endeten beim Laden oder kurz danach, weil der Kernel einen der beiden Renderer beendete (laut `dmesg` jeweils
  „Memory cgroup out of memory: Killed process … headless_shell“). Bis dahin waren alle Prüfungen grün. Im besten
  Lauf (26.10.) waren es 7 von inf: Raum, Beitritt, Matchstart, ein Infizierter zu Beginn, Team und Waffe des Clients,
  Infektion beim Host, Teamwechsel beim Client. Es fehlten Messer nach dem Wiedereinstieg, Anti-Cheat und
  Seitenfehler. Die Szenarien selbst sind unverändert. Die Abfragefunktion bekam nur eine Frist je Abfrage (30 s),
  eine Absturz-Erkennung und seltenere Abfragen beim Matchstart. Sie kann dadurch unter Last eher scheitern, aber
  nichts fälschlich bestehen lassen. Auf ruhiger Maschine nachholen: `node tools/modes-online-test.mjs --only=inf,gun`
  (Werk) bzw. mit `--map=bibliothek`.

### Messwerte (Nachbesserung 26./27.10., Bot gegen Bot 5:5, je Karte 14 Läufe à 360 s)
Messaufbau: `node tools/sim.mjs --mode=hp --player=off --extra="allies=5&enemies=5&botlearn=off" --seconds=360`.
Der Spieler ist Zuschauer außerhalb der Karte (`--player=off`), die lernenden Bots sind aus. Bei der ersten Messung
(Spieler untätig und unverwundbar am Start, Lernen an) war die Stärke nicht gleich: Der Spieler band Gegner, die
Gegner passten sich an sein Modell an, die Verbündeten wuchsen mit.

| Karte | Anteil A an der Haltezeit je Lauf (%) | Median | Summe | Quartile | außerhalb 30–70 % |
|---|---|---|---|---|---|
| Werk | 46 · 27 · 76 · 42 · 53 · 63 · 41 · 46 · 19 · 47 · 53 · 73 · 58 · 20 | 47 % | 48 % | 38–59 % | 5 (2 A, 3 B) |
| Altstadt | 52 · 59 · 51 · 60 · 68 · 69 · 50 · 55 · 27 · 51 · 46 · 54 · 42 · 78 | 53 % | 54 % | 49–62 % | 2 (1 A, 1 B) |
| Hafen | 40 · 57 · 47 · 50 · 56 · 27 · 54 · 37 · 60 · 23 · 25 · 62 · 35 · 48 | 48 % | 44 % | 33–56 % | 3 (B) |
| Bibliothek | 62 · 82 · 40 · 63 · 58 · 25 · 66 · 57 · 29 · 28 · 76 · 46 · 29 · 37 | 51 % | 50 % | 29–64 % | 6 (2 A, 4 B) |

Kriterium „kein Team > 70 % Haltezeit bei gleicher Stärke“: Im Median und in der Summe erfüllen es alle vier Karten
(44–54 %), über alle 56 Läufe liegt A 29-mal vorn. Einzelne 6-min-Läufe streuen dagegen stark (Standardabweichung
12–19 Prozentpunkte), 16 von 56 liegen außerhalb 30–70 %, und zwar für beide Teams. Das ist das Aufschaukeln reiner
Bot-Matches mit nur sechs Wechseln: Wer die erste Zone zuerst besetzt, steht oft auch an der nächsten früher. Ein
fester Vorteil eines Teams ist es nicht; ein echtes Match dauert 10 min bzw. bis 250 Punkte.

Wie stark sieben Läufe täuschen können: Die ersten sieben Läufe auf Bibliothek ergaben Median 62 % (5 von 7 für A),
die nächsten sieben mit gleichem Spielverhalten 37 %. Auf Altstadt lagen die ersten sieben alle bei A ≥ 50 %
(Median 59 %), die nächsten sieben bei Median 51 %. Ein Median aus sieben Läufen schwankt also um etwa ±10 Punkte.

Gefundene Schieflage: Welche Bots in der Vorschau vorausgehen (34 %) und welche außen sichern (25 %), hing am Hash
des zufälligen Bot-Namens. In einem Match hatte dann oft ein Team 0 Vorausgeher und das andere 3, und dieses Team
war an jeder neuen Zone zuerst. Jetzt zählt der Rang im eigenen Team (`_teamRank`), also gleich viele je Team.
Vorher (ohne Lernen, Zuschauer, je 1 Lauf): Werk 24 %, Altstadt 32 %, Hafen 20 %, Bibliothek 52 %.

Geprüft und verworfen:
- Bibliothek (Prüfauftrag „Rotunde nur 25 m vom Start“): Die Karte ist punktsymmetrisch (Startreihen A z = +24,8,
  B z = −24,8 mit denselben x-Werten, Flaggen (−18, 6) / (18, −6)). Die Zonen liegen auf z = 0, Galerien und
  Lesesäle paarweise bei ±x, jedes Paar kommt in der Wanderung einmal vor. Wege laut Prüfstand: Rotunde A 27 m /
  B 25 m, die übrigen Zonen gleich (± 1 m). Die Sperrzone (25 m um die aktive Zone) trifft beide Startreihen gleich:
  bei der Rotunde je den mittleren Startpunkt (24,8 m), bei den Lesesälen je zwei.
- Freie Wiedereinstiegspunkte: Auf der Altstadt liegen 14 FFA-Punkte auf der Seite von A (davon 6 näher als 20 m an
  der Mittellinie) und 11 bei B (2). Teammodi könnten sie nutzen (`modes/spawns.js`), in der Stellung geschieht das
  aber praktisch nie: Bei 4 gezählten Läufen (je Karte einer) kamen 479 von 482 Wiedereinstiegen aus den eigenen
  Startreihen (+30 Vorrang, die Zone stößt ab), 1 von einem FFA-Punkt, 2 aus der Reihe des Gegners. Ein Versuch, nur spiegelgleiche FFA-Punkte zuzulassen, änderte
  deshalb nichts und ist wieder entfernt. Für andere Teammodi ist die Asymmetrie ein Hinweis an die Karten-Spur.
- Herrschaft auf Altstadt im selben Aufbau (3 Läufe: 49 · 31 · 44 % für A) zeigt keinen Vorteil der Karte für A.

### Offen / Risiken
- Zonen sind in der Welt nicht markiert (nur Weltmarker, Minikarte, Balken in der Zone). Ein Bodenring wäre ein kleiner
  Nachtrag, falls die Grenze im Spiel schwer zu lesen ist.
- `guard` (Posten mit Sicht auf die nächste Zone) kommt mit B4 (M4a); bis dahin gehen die vorausgehenden Bots in die
  nächste Zone hinein.
- Granaten-Massaker in Innenräumen (Kesselhaus, Torhaus, Bibliothek) erst im echten Spiel bewerten.
- Neue Herausforderung im Pool verschiebt die Tages-/Wochenauswahl einmalig (wie bei früheren Modi).
- Online-Regression inf/gun auf ruhiger Maschine nachholen (siehe Prüfungen).
- Bot-Matches streuen je Lauf stark (Aufschaukeln). Mit echten Spielern nachmessen, ob einzelne Matches ebenso kippen;
  falls ja, wäre ein Ausgleich denkbar (z. B. Wiedereinstieg des führenden Teams etwas weiter weg).
- Altstadt: FFA-Punkte nicht gespiegelt (A 14, B 11). Für die Stellung ohne Wirkung, für andere Teammodi ein Hinweis
  an die Karten-Spur.
