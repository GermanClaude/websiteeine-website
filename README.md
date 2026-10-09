# NULLPUNKT.

Ein Ego-Shooter im Browser im Stil von *Call of Duty: Mobile*, gespielt gegen Bots, dazu eine minimale, interaktive Website. Er läuft auf dem Rechner, dem Handy und dem Tablet, ohne Download und ohne Konto.

- **Website** (`index.html`): ein Schriftmusterbuch, das zurückschießt (Konzept „Durchschuss“). Die Seite zeigt keine Fotos und keine Kästen, nur Typografie, feine Linien und einen orangen Zielpunkt. Die Breite der Schrift steht für Reichweite, ihre Stärke für Schaden.
- **Spiel** (`spielen.html`): schnelle Matches gegen Bots in fünf Modi auf vier Karten, mit zehn Waffen, einem Messer und Granaten. Dazu kommen Abschussserien, Medaillen, Erfahrungspunkte (EP) mit einem Rangsystem bis Stufe 55 und Touch-Steuerung wie in COD Mobile.

Alles ist statisch, aus HTML, CSS und JavaScript (ES-Module), ohne Build-Schritt. Es gibt keinen Server, keine Datenbank, keine Cookies, kein Tracking und keine externen Skripte oder Schriften. Grafik, Texturen, Modelle und Klänge entstehen beim Laden im Browser.

## Spielen

1. Website öffnen und auf **Sofort spielen.** tippen. Wer Modus, Karte, Schwierigkeit und Teamgröße selbst wählen will, nimmt **Einsatz zusammenstellen**.
2. In der Lobby die Ausrüstung wählen (Primärwaffe, Sekundärwaffe, Granate) und **Einsatz starten**.

### Modi

| Modus | Ziel |
|---|---|
| Team-Deathmatch | 6 gegen 6, wer zuerst 40 Abschüsse hat, gewinnt (10 Minuten) |
| Jeder gegen jeden | 8 Spieler, zuerst 25 Abschüsse |
| Herrschaft | drei Flaggen A, B und C erobern und halten, zuerst 150 Punkte |
| Waffenspiel | 18 Waffenstufen, jeder Abschuss bringt die nächste Waffe; ein Messerabschuss wirft das Opfer zurück |
| Schießstand | Training mit Klappzielen, Trefferstatistik und Parcours auf Zeit |

**Abschussserien:** *Aufklärer* (4 Abschüsse) zeigt Gegner auf der Minikarte. *FPV-Drohne* (5) ist eine kleine Kamikaze-Drohne, die man selbst steuert: Der Körper bleibt verwundbar stehen, die Sicht wechselt in die Drohne (Akku 25 Sekunden, Reichweite 150 m); Feuern sprengt sie, Interagieren bricht ab. *Präzisionsschlag* (6) ist ein Luftschlag auf einen Punkt, den man auf der Karte wählt. *Wachgeschütz* (8) ist ein automatisches Geschütz für 45 Sekunden. Online gibt es vorerst nur die FPV-Drohne; der Host bestätigt Einsatz und Sprengung.

**Schwierigkeit der Bots:** Rekrut, Regulär, Veteran, Elite.

### Karten

- **Hafen**: Containerterminal zur goldenen Stunde, mit Kran, Lagerhalle und Kaikante
- **Altstadt**: Mittelmeer-Altstadt am Mittag, mit Markt, Brunnenplatz, Kirche, Glockenturm und Dachterrassen
- **Werk**: stillgelegtes Walzwerk in der Dämmerung, mit Halle, Laufstegen, Kran, LKW-Hof und Kesselhaus
- **Schießstand**: Trainingsanlage mit Bahnen von 10 bis 100 m

### Waffen

KV-47 und M-17 Falke (Sturmgewehre), VP-9 Viper und QX-90 (MPs), HM-60 Hammer (LMG), SK-14 (Präzisionsgewehr), Brecher .338 (Scharfschützengewehr), Bulldog 12 (Schrotflinte), P-9 Kompakt und Adler .50 (Pistolen), Kampfmesser, Splitter- und Haftgranate. Manche Waffen werden erst mit höherer Stufe freigeschaltet. Alle Namen sind erfunden.

### Steuerung

| Aktion | Tastatur und Maus | Gamepad |
|---|---|---|
| Laufen | W A S D / Pfeiltasten | linker Stick |
| Umsehen | Maus (Zeiger wird gesperrt; Klick ins Bild) | rechter Stick |
| Feuern | linke Maustaste | rechter Trigger |
| Zielen (über Kimme und Korn) | rechte Maustaste | linker Trigger |
| Nachladen | R | X / □ |
| Springen | Leertaste | A / ✕ |
| Ducken, im Sprint: Rutschen | C | B / ○ |
| Sprinten | Umschalt | linker Stick drücken |
| Messer | V oder Maustaste 4 | RB / R1 oder rechten Stick drücken |
| Granate (halten zum Kochen) | G oder Q | LB / L1 |
| Waffe wechseln | 1 / 2, Mausrad oder Maustaste 5 | Y / △ |
| Abschussserien | 3 / 4 / 5 / 6 (Drohne) | Steuerkreuz ▲ ◀ ▶, LT + ▼ (Drohne) |
| Drohne fliegen | Maus = Blick, W A S D, Leertaste steigen, C sinken, Umschalt Schub, Feuern sprengt, F bricht ab | Sticks, A steigen, B sinken, L3 Schub, RT sprengt, X bricht ab |
| Atem anhalten (Zielfernrohr) | Umschalt beim Zielen | linker Stick drücken |
| Punktetabelle | Tab | Ansicht / Share |
| Pause | Esc | Menü / Options |

**Touch (Handy, Tablet):** Gespielt wird im Querformat. Links liegt ein schwebender Joystick; wer ihn bis an den Rand schiebt, sprintet dauerhaft. Rechts wischen zum Umsehen. Der große Feuerknopf rechts erlaubt gleichzeitig Wischen zum Zielen, links gibt es einen zweiten Feuerknopf. Dazu kommen Knöpfe für Zielen, Nachladen, Springen, Ducken, Granate, Messer, Waffenwechsel, Abschussserien und Pause. In den Einstellungen lassen sich Zielhilfe und Automatisches Feuern einschalten (Feuer, sobald ein Gegner im Fadenkreuz ist).

## Einstellungen und Daten

Einstellungen (Empfindlichkeit, Sichtfeld, Grafikqualität, Lautstärken, Fadenkreuz, Name, Touch-Hilfen) gelten auf der Website und im Spiel gleichermaßen. Fortschritt, Statistiken und Match-Verlauf liegen nur im lokalen Speicher des Browsers (Schlüssel beginnen mit `nullpunkt:`). Auf der Website lassen sie sich unter **Über → Lokale Daten löschen** entfernen. Es werden keine Daten übertragen. Beim Hosting auf GitHub Pages verarbeitet GitHub technisch notwendige Zugriffsdaten.

Die Grafikqualität wählt sich auf „Automatisch“ selbst: niedrig auf Handys, hoch auf starken Rechnern. Bricht die Bildrate ein, senkt das Spiel die Auflösung.

## Veröffentlichen mit GitHub Pages

1. Im Repository unter *Settings → Pages* bei *Build and deployment* als Quelle „Deploy from a branch“ wählen, den Branch (z. B. `main`) und den Ordner `/ (root)` einstellen, *Save*.
2. Nach ein bis zwei Minuten ist die Seite unter `https://<benutzername>.github.io/<repository>/` erreichbar.
3. Link-Vorschauen (Messenger, soziale Netze) brauchen absolute Adressen: In `index.html` stehen `canonical`, `og:url`, `og:image` und `twitter:image` auf `https://germanclaude.github.io/websiteeine-website/`. Bei anderem Konto, Repository oder eigener Domain diese vier Adressen anpassen.

Alle Pfade sind relativ, die Seite funktioniert also auch in einem Unterordner. Weil das Spiel ES-Module nutzt, genügt lokal kein Doppelklick auf `index.html`. Nötig ist ein kleiner Webserver, zum Beispiel:

```sh
npx http-server -p 8765 -c-1 .
# dann http://localhost:8765/ öffnen
```

## Impressum

Ob ein Impressum nötig ist, hängt vom Angebot ab (§ 5 DDG, § 18 MStV). Im Zweifel rechtlich beraten lassen. Die Angaben stehen in `assets/js/site/config.js`. Solange dort kein Name eingetragen ist, bleibt der Impressum-Block auf der Website ausgeblendet.

## Aufbau

```
index.html                     Website
spielen.html                   Spiel
assets/css/                    fonts.css, tokens.css (gemeinsam), site.css, game.css
assets/fonts/                  Archivo, JetBrains Mono, Rajdhani (SIL Open Font License)
assets/img/                    Favicon, Vorschaubild, Kartenbilder
assets/vendor/three/           Three.js r186 (MIT) mit Zusatzmodulen
assets/js/shared/              Daten und Speicher, die Website und Spiel teilen:
                               weapons.data.js, modes.data.js, maps.data.js, settings.js, profile.js
assets/js/site/                Website-Module
assets/js/game/main.js         Spielstart, Spielschleife, Match-Ablauf
assets/js/game/engine/         Renderer, Eingabe (inkl. Touch), Physik, Ereignisse, Texturen, Effekte, Audio
assets/js/game/world/          Kartenbau, Karten, Kollision, Wegenetz, Licht, Minikarte
assets/js/game/weapons/        Waffenlogik, Granaten, 3D-Modelle, Arme und Animationen
assets/js/game/bots/           Soldatenmodelle, Animation, KI
assets/js/game/modes/          Spielmodi und Abschussserien
assets/js/game/ui/             HUD, Minikarte, Menüs, Endbildschirm
dev/                           Testseiten für einzelne Module (Karten, Waffen, Bots, Klang, Effekte)
tools/                         Entwicklungswerkzeuge (Screenshot, Smoke-Test, Match-Simulation, Syntaxprüfung)
docs/ARCHITECTURE.md           Technischer Aufbau und Schnittstellen aller Module
docs/SITE_DESIGN.md            Gestaltungskonzept der Website
```

## Entwicklung

```sh
npx http-server -p 8765 -s -c-1 .            # Server
sh tools/check.sh                            # Syntaxprüfung aller Module
node tools/smoke.mjs --params="map=hafen&mode=tdm" --seconds=20 --end      # Spiel-Smoke-Test (Headless-Chromium)
node tools/smoke.mjs --mobile --params="map=altstadt&mode=dom" --end       # dasselbe als Touch-Gerät
node tools/sim.mjs --map=werk --mode=tdm --seconds=120                     # schnelle Match-Simulation ohne Rendern
node tools/shot.mjs http://localhost:8765/index.html tools/out/site.png --mobile   # Screenshot
```

`spielen.html` versteht URL-Parameter für Tests und Direktlinks: `mode`, `map`, `diff`, `allies`, `enemies`, `autostart=1`, `quality`, `time`, `score`, `primary`, `secondary`, `lethal`, `debug=1`.

## Lizenzen

- Three.js: MIT-Lizenz (`assets/vendor/three/LICENSE`)
- Schriften Archivo, JetBrains Mono, Rajdhani: SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`)
