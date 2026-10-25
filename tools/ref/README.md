# Werkzeuge für Waffen nach Referenzfoto (`tools/ref/`)

Ablauf und Regeln: Bauanleitung (Foto → Ref-Modul → Bauplan → Stufen → Messen). Kurz:

1. Foto mit freier Lizenz besorgen (Commons: PD-USGov, CC0, CC BY/BY-SA, OGL). **Das Foto kommt nie ins Repo** – nur in
   einen Arbeitsordner außerhalb. Quelle/Urheber/Lizenz in den Kopf der `<name>-ref.js` und in `CREDITS.md`
   (Abschnitt „Waffen-Referenzfotos“).
2. Gerade stellen: Winkel einer langen Kante messen (`crop.mjs`), dann `rotimg.mjs`.
3. Kalibrieren: Endpunkte bekannter Maße mit `edge.mjs` auf ±1 px ablesen → px/m.
4. Umrisse verfolgen: `kontur.mjs` mit einer Regeldatei (Beispiel `regeln-m17-beispiel.mjs`), Kontrolle mit `ueberlagern.mjs`.
5. Modell gegen Foto: `vergleich.mjs` (Fotostudio, gleiche Ansicht und gleicher Maßstab).
6. Messen je Detailstufe: `mess.mjs`, alle Waffen einer Stufe: `alle.mjs`, Vorbau-Stufe im Spiel: `vorbau.mjs`.

| Datei | Zweck | Aufruf |
|---|---|---|
| `rotimg.mjs` | Foto drehen (Grad gegen den Uhrzeigersinn) | `node tools/ref/rotimg.mjs in.jpg out.png <grad>` |
| `crop.mjs` | Ausschnitt vergrößern | `node tools/ref/crop.mjs in.jpg out.png x y w h [3]` |
| `edge.mjs` | Ober-/Unterkanten dunkler Läufe je Spalte | `node tools/ref/edge.mjs bild x0 x1 schritt y0 y1 [200]` |
| `kontur.mjs` | Umrisse je Bauteil (Bereichsregel + dunkel) → JSON in Fotopixeln | `node tools/ref/kontur.mjs foto.png regeln.mjs umrisse.json` |
| `ueberlagern.mjs` | Umrisse farbig über das Foto zeichnen | `node tools/ref/ueberlagern.mjs foto.png umrisse.json\|ref.js out.png [x0 y0 w h s]` |
| `vergleich.mjs` | Modell im Fotostudio gegen das Foto (Paar + 50 % überblendet) | `[TIER=std] node tools/ref/vergleich.mjs <key> foto.png <ref.js> x0 y0 w h [0.5] [tag]` |
| `mess.mjs` | Dreiecke, Draw Calls, Bauzeit, Geometrie-/Texturspeicher, Kontaktgitter je Stufe | `node tools/ref/mess.mjs m17,p9 max,std,lite,third [--att='{"optik":"rotpunkt"}']` |
| `alle.mjs` | alle Waffen einer Stufe (Dreiecke, Meshes, Bauzeit) | `node tools/ref/alle.mjs third` |
| `vorbau.mjs` | baut der Vorbau bei Grafikstufe „niedrig“ unnötig die max-Fassung? | `node tools/ref/vorbau.mjs` |

Voraussetzungen: Playwright (siehe `tools/pw.mjs`) und für `vergleich`/`mess`/`alle`/`vorbau` ein laufender Server
(`npx http-server -p 8765 -s -c-1 .`, Adresse über `NP_BASE`). Bilder schreiben die Werkzeuge in den aktuellen Ordner.
Das Fotostudio (`dev/fotostudio.html`) nimmt `&tier=max|std|lite|third` für die Detailstufe; ohne zeigt es am PC die
volle Fassung.
