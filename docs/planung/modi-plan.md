# Modi-Plan (Spur M) – Umsetzung

Nutzerwunsch 26.10.: „Kannst du noch mehr Modi einfügen …“. Gesamtplan: Arbeitsplan Modi · Karten · Texturen (§3 Spur M).
Je Etappe ein Abschnitt; diese Datei gehört nur der Spur M (keine gemeinsame Plan-Datei, keine Konflikte).

---

## M1 – Stellung (`hp`) + Daten-Grundlagen B6/B7 (26.10.)

### Was gebaut ist
- **Modus Stellung** (`game/modes/hp.js`, Unterklasse von `DomMode`): genau eine aktive Zone, die in fester Reihenfolge
  wandert (Standard alle 60 s, Einstellung 45/60/90 s). 10 s vor dem Wechsel erscheint die nächste Zone gedimmt
  (`objectives[1].next`). Keine Einnahmezeit: allein drin = gehalten (1 Teampunkt je Sekunde), beide Teams drin =
  umkämpft (keine Punkte, Besitz bleibt stehen), niemand drin = neutral. 250 Punkte zum Sieg (Einstellung 150/250/350),
  10 min, Verlängerung wie Basis.
- **Punkte/Medaillen/Herausforderung** (`shared/modes.data.js`): `hold` +50 je 5 s in der gehaltenen Zone,
  `hpcapture` +100 (wer im Team zuerst drin war, wenn das Team sie allein hält), `hpdefend`/`hpassault` +25 für
  Abschüsse an der Zone; Medaillen Bollwerk (30 s halten ohne zu fallen), Stellungskämpfer (5 Abschüsse an der Zone in
  einem Leben), Vorhut (Erster in einer neuen Zone, das Team nimmt sie); Herausforderung „Halte die Stellung insgesamt
  {n} Sekunden“ (`hpTime`, Zähler je Spieler). Tabelle: Spalte „Haltezeit“, Endbildschirm: Feld „Haltezeit“.
- **B6 Modus-Daten**: `MODES[id].online` / `.onlineVehicles` / `.maxTeam` ersetzen die doppelten Listen
  (`ONLINE_MODE_IDS`, `VEHICLE_MODE_IDS`, `maxTeamOf()` – `net/index.js` und `ui/net-menus.js` lesen dieselbe Quelle).
  `MODES[id].options` (z. B. Stellung: Zonenwechsel, Punkteziel) baut ein gemeinsamer Regler-Baustein
  (`ui/mode-options.js`) in der Lobby (Einsatz-Reiter, gemerkt in `settings.modeOptions`) und im Raum-Menü
  (`room.settings.modeOpts` → `cfg.net.modeOpts`). Optionen mit `limit: 'scoreLimit'` lässt das Raum-Menü weg, weil
  dort der allgemeine Punkteziel-Regler steht. Prüfwerkzeuge: `?mopt=wechsel:45`.
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
- Stand 26.10.: hp-test daten+logik 53/53, welt 29/29 (alle vier Karten), spiel 14/14 (Werk); Rauchtests Hafen hoch
  120 s und Altstadt niedrig Handy 150 s (Stellung) ohne Fehler außer abgebrochenen Ladeanfragen; check.sh, preload grün.
  Online-Szenario: Einstellung, Zonen, Vorschau, Wechsel mit Hinweis und Anti-Cheat beim Client bestätigt; die Halte-
  Prüfungen und ein kompletter Lauf scheiterten auf dem Prüfrechner an Last (≈ 1 FPS) bzw. am Speicherlimit (Browser
  vom OOM-Killer beendet) – Test daher mit Abfragefristen, Client im eigenen Browser, Bibliothek, ohne Bots.

### Messwerte (26.10., Bot-Matches 5 gegen 5, Spieler untätig am Start, Software-GL)
| Karte | Laufzeit | Haltezeit A : B | Anteil A |
|---|---|---|---|
| Werk | 360 s + 600 s | 58 : 206 · 177 : 254 | 34 % |
| Altstadt | 360 s | 180 : 114 | 61 % |
| Hafen | 360 s | 182 : 87 | 68 % |
| Bibliothek | 360 s + 600 s | 224 : 34 · 226 : 168 | 69 % |

Kein Team über 70 % (Summe der Läufe). Einzelne 6-min-Läufe schwanken stark (Bibliothek 87 %, Werk B 78 %) – mit nur
sechs Wechseln entscheidet oft, wer die erste Zone zuerst erreicht. Die Zonen liegen auf der Spiegelachse, die Wege
beider Teams sind gleich lang (Werk 301/299 m).

### Offen / Risiken
- Zonen sind in der Welt nicht markiert (nur Weltmarker, Minikarte, Balken in der Zone). Ein Bodenring wäre ein kleiner
  Nachtrag, falls die Grenze im Spiel schwer zu lesen ist.
- `guard` (Posten mit Sicht auf die nächste Zone) kommt mit B4 (M4a); bis dahin gehen die vorausgehenden Bots in die
  nächste Zone hinein.
- Granaten-Massaker in Innenräumen (Kesselhaus, Torhaus, Bibliothek) erst im echten Spiel bewerten.
- Neue Herausforderung im Pool verschiebt die Tages-/Wochenauswahl einmalig (wie bei früheren Modi).
