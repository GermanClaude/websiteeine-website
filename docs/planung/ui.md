# Bughunt ui-small (2026-10-06)

Format: [Schwere] Ort — Repro — Status

## Bekannte Punkte
- [hoch] Touch-HUD 20:9 (Screenshot Grenzland dom 780×360 + Notch links): Munitionsanzeige halb unter Knopf „Panzerplatte“ (def 54/76 %). — in Arbeit
- [hoch] Touch-HUD: Abschussmeldungen links neben linkem Feuerknopf überdecken das SPRINT-Einrast-Symbol des Sticks (Stick-Ruhelage 26 %/63 %, Symbol 112u darüber). — in Arbeit
- [mittel] Touch-HUD: Leben/Westenplatten (--col-t, .h-armor top col-t+14) liegen auf kurzen Telefonen (≤ 412 px Höhe) über dem linken Feuerknopf (top 32 %). Im Screenshot sichtbar (blaue Plattenbalken unter dem Knopf). — in Arbeit
- [mittel] Lobby-Kopf läuft über (768×1024 91 px, 568×320 31 px, „Zur Website“ zwischen ~601–760 px weg). — offen
- [mittel] „Als App installieren“ nur im Vollbild-Ratgeber erreichbar. — offen
- [gering] engine/input.js: unbenutztes Feld _fsTriedAt. — offen

## Erledigt (Schritt 1)
- [hoch] Munition verdeckt → behoben: shared/bindings.data.js def der Ausrüstungsknöpfe als Spalte x 65 % (Lampe 28 %, Klassen-Ausrüstung 42 %, Platte 56 %, Taktische 70 %), Zielen+Feuern 57/62, Lehnen y 62, Hinlegen x 85,5 (4:3 überlappte Ducken um 7 px). Eigene Layouts (custom[aspect]) bleiben unverändert (nur Standardlagen). Gemessen 780×360, 915×412, 1024×768: keine Überdeckung HUD×Knopf.
- [hoch] Killfeed über SPRINT-Symbol → behoben: game.css Touch-.h-feed oben rechts neben der Minikarte bis vor den Punktestand (--top-w neu aus hud.js ResizeObserver), kompakte Zeilen ≤ 430 px Höhe, Namen kürzen per Ellipse; Spiegel-Layout entsprechend; hud.js Touch-Zeilen 3 bis 520 px Höhe.
- [mittel] Leben/Platten unter linkem Feuerknopf → behoben: .tc-fire-l top = max(32 %, Minikarte + 40 px).
- [gering] input.js _fsTriedAt entfernt.
- [mittel] Lobby-Kopf → behoben (game.css, Ende des Telefon-Blocks): flex-wrap als Netz, Stufen ≤ 980 / 700 / 560 (Reiter nur Symbol, Name bleibt für Vorleser) / 420 px (Reiter eigene Zeile) / 360 px. Gemessen touch 320–915 px und Desktop 320–1280 px: kein Überlauf, kein Knopf außerhalb. Profil-Knopf blendet sich (wie vorher) aus, wenn kein Platz ist.
- [mittel] „Als App installieren“ → behoben: Pausenmenü-Eintrag (ui/menus.js, nur wenn G.fullscreen.installAvailable), Symbol ICON.install (ui/icons.js).
- [mittel] Lobby Einsatz-Seite auf Telefonen (740×360) waagerecht scrollbar: Feldgruppe „Wetter“ (bis 7 Felder) 110 px breiter als ihre Spalte (.lb-extra .m-seg, grid-auto-flow column). → behoben (game.css: .lb-extra .m-seg umbrechend). Sweep aller Modus/Karten-Paare mit Höchst-Teamgrößen (Grenzland 32/31, FFA 23, INF 1/15) auf 740×360 touch: kein Überlauf, keine Fehler.
- [mittel] Eroberung Touch: „Befehl“-Knopf (.ht-order, fest 170 px) lag nach dem Absenken des linken Feuerknopfs auf 780×360 darüber (selbst verursacht, sofort behoben): top jetzt = Feuerknopf-Unterkante + 8 px; Lehnen-Standard y 76 % (unter „Befehl“). Gemessen Grenzland cq 780×360 mit allen Zusatzknöpfen: keine Überdeckung.
- [gering] HUD „Realismus“ Touch: Killfeed blieb neben der (ausgeblendeten) Minikarte eingerückt → behoben (--feed-l = pad-l, Spiegel rechts bündig).
- Geprüft ohne Befund: Pausenmenü, alle 8 Einstellungsreiter (Desktop 1280×720 + Telefon 915×412: rendern, kein waagerechter Überlauf, keine Konsolenfehler), Ausrüstung im Match, Punktetabelle, Endbildschirm (EP, Medaillen, Lern-Bots-Zeile) TDM Hafen/Dom Grenzland, Installationsknopf mit simuliertem beforeinstallprompt (erscheint, verschwindet nach Nutzung).

## Offen für Donnerstag
- [mittel] Weltmarker (Flaggen A–E) überlappen sich bei Flaggen in gleicher Blickrichtung samt Entfernungen („391 m“/„146 m“ übereinander, Grenzland cq/dom) – Marker-De-Overlap in hud.js (wie Namensschilder in Lens-Raum) nötig. Donnerstag.
- [mittel] Minikarten-Bild fest 512 px (world/index.js createMinimap size 512) – auf Grenzland (Großkarte) < 1 px/m, im HUD-Ausschnitt (36–42 m Radius) ~2× hochskaliert und unscharf; Größe nach Kartenausdehnung (z. B. clamp(extent·1,5, 512, 2048)) – world-Datei. Donnerstag.
- [gering] Touch-Layout: Standardlagen sind nur je Knopf (def), nicht je Seitenverhältnis – für 4:3/16:10-Tablets wäre eine eigene Vorlage je Klasse sauberer (Datenmodell resolveTouchLayout + input.js measure/apply). Donnerstag.
- [gering] vehicles/hud.js blendet beim Fahren .tc-plate/.tc-gadget/.tc-prone nicht aus (Liste in vehicles/hud.js Z. 64) – Besitzer vehicles prüfen.
- [gering] Profil-Knopf im Lobby-Kopf verschwindet bei 700–980 px (kein Platz); erreichbar nur über Fortschritt? – evtl. Symbolknopf statt Ausblenden. Donnerstag.
- [gering] Endbildschirm: debugApi.endMatch nach 1 s gibt +240 EP Unentschieden-Bonus (nur Testpfad; im Spiel nicht erreichbar) – Mindestspielzeit für Matchbonus erwägen.
