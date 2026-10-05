# Asset-Pipeline (Texturen · HDRIs · Modelle)

Erzeugt die fotorealistische, komprimierte Asset-Bibliothek unter `assets/lib/` aus frei lizenzierten
Quellen (Poly Haven, ambientCG — ausschließlich **CC0**). Ziel: Look à la „Bodycam“ (rau, realistisch,
verlassene Industrie-/Stadträume) bei wenig Grafikspeicher und kleinen Downloads fürs Handy.

## Einrichten

```sh
sh tools/assets/setup.sh        # npm-Werkzeuge nach tools/out/npm (gitignored) + Symlink tools/assets/node_modules
```

Benötigt Node ≥ 20 und `unzip`. Keine Abhängigkeit landet im Repo oder in `package.json`.

## Ablauf

```sh
node tools/assets/resolve.mjs           # Autor/URL/Größen aus den Quell-APIs in sources.json ergänzen
node tools/assets/build.mjs --jobs=2    # alles bauen (überspringt aktuelle Assets), danach Manifest + CREDITS.md
node tools/assets/build.mjs --only=textures concrete_floor_worn   # einzelne Assets
node tools/assets/build.mjs --force ...                            # neu bauen
node tools/assets/manifest.mjs          # nur assets/lib/manifest.json + CREDITS.md neu schreiben
node tools/assets/shots.mjs [--only=…] [--mobile]   # Screenshots von dev/assets.html (Server: npx http-server -p 8765 -s -c-1 .)
```

| Datei | Aufgabe |
|---|---|
| `sources.json` | **Die Quellenliste** (id, source, sourceId, license, url, author, Stufen, Spiel-Zuordnung). Hier kuratieren. |
| `resolve.mjs` | ergänzt `author`, `url`, `sizeM` (reale Kachelgröße), `polycount` aus Poly-Haven-/ambientCG-API, setzt Lizenz |
| `textures.mjs` | PBR-Sätze → KTX2: `albedo` (sRGB), `normal` (OpenGL-Konvention), `orm` (R = AO, G = Rauheit, B = Metall) |
| `hdri.mjs` | HDRIs → `.hdr` 512×256 / 1024×512 (Beleuchtung, PMREM) + vorab getonemappter Himmel als KTX2 (1024 / 2048) + Sonnenrichtung |
| `models.mjs` | glTF → `.glb`: dedup/prune/weld, LOD0-Budget, LOD1/LOD2, Texturen → KTX2, Meshopt + Quantisierung |
| `manifest.mjs` | `assets/lib/manifest.json` (alle Stufen mit Pfad, Bytes, GPU-Schätzung, Lizenz) + `CREDITS.md` + Kartenbudgets |
| `build.mjs` | Orchestrierung, je Asset ein Kindprozess (`nice`), `--jobs=N` |
| `shots.mjs` | Sichtprüfung über `dev/assets.html` (Playwright) |
| `contact-sheet.mjs`, `hdri-probe.mjs` | Kuratierung: Vorschau-Kontaktbögen, HDRI-Sonnenstand prüfen |
| `codec-bench.mjs`, `ktx-sheet.mjs` | Kodier-Profile vergleichen (Größe/Fehler), KTX2-Ausgaben als PNG ansehen |
| `lib/` | `common` (Pfade, Netz, Budgets), `ktx` (Encoder-Profile, sharp), `hdr` (RGBE lesen/schreiben, Analyse, ACES), `sources` (Downloads), `decode` (KTX2 im Node dekodieren — Qualitätsmessung) |
| `build-meta/` | Build-Ergebnis je Asset (Rezept-Hash, Dateien, Größen) — klein, versioniert; daraus entsteht das Manifest |

Rohdaten und API-Antworten liegen im Cache `tools/out/assets-cache/` (gitignored, beliebig löschbar).

## Formate und Stufen

| Qualität | Texturensätze | Modelle (Requisiten) | HDRI-Licht (.hdr → PMREM) | Himmel (KTX2) |
|---|---|---|---|---|
| low (Handy) | 512² | 512er Stufe (ohne volle Geometrie, s. u.) | 512×256 | 1024×512 |
| medium | 1024² | 512er Stufe | 512×256 | 2048×1024 |
| high | 1024² | 1024er Stufe | 1024×512 | 2048×1024 |
| ultra | 2048² nur „Helden“ (`hero`), sonst 1024² | 1024er; 2048er nur Waffen | 1024×512 | 2048×1024 |

Die Zuordnung steht gleichlautend in `loader.js` (`QUALITY_TIER`, `MODEL_TIER`, `HDRI_TIER`, `SKY_TIER`) und
`manifest.mjs` (REALISM_PLAN §4.2/4.3).

* **KTX2 / Basis Universal ETC1S** für Albedo, Normalen, ORM und Himmel. Der Browser transkodiert passend zur
  GPU (Desktop BC1/BC3, Android ETC2/ETC1, iOS ETC2/ASTC/PVRTC). Gemessen (`lib/decode.mjs`, 1024²): Albedo q160
  ≈ 40 dB PSNR; Normalen q255 ≈ 1,4° mittlerer Winkelfehler — so gut wie UASTC+RDO λ1 (1,1°) bei einem
  Drittel der Größe und halbem Handy-Speicher (ETC1 0,5 B/px). UASTC wurde für 2048er-Normalen verworfen
  (3–4 MB je Karte).
* **Ausrichtung:** Texturensätze werden zeilengespiegelt kodiert (`isYFlip`). Komprimierte Texturen kennen kein
  `flipY`; so liegt v = 0 wie bei `TextureLoader`-Texturen unten, Laufspuren/Rost zeigen nach unten und die
  OpenGL-Normalen (`nor_gl`) stimmen mit `normalScale (1, 1)`. Prüfansicht: `dev/assets.html?tab=textures&id=brick_factory&check=normal`
  (Licht von oben: Fugen oben dunkel, unten hell). Modelle bleiben glTF-konform (Ursprung oben links, `GLTFLoader`
  dreht `normalScale.y` selbst).
* **ORM** = AO/Rauheit/Metall in einer Textur (three.js: `aoMap`, `roughnessMap`, `metalnessMap` zeigen auf
  dieselbe Textur; Kanäle R/G/B). Poly Haven liefert „ARM“ direkt, ambientCG wird gepackt.
* **Einfärbbar** (`tintable`): Lack-/Grundfarbe neutralisiert (`recolor`, Farbtonbereich → Grau), damit
  `material.color` die Farbe bestimmt (Container in 5 Farben aus einem Satz, lackiertes Metall, Plane, Uniform).
* **Tarnmuster** (`camo_*`) sind prozedural erzeugt (kachelbar, keine realen Muster) und teilen Normal/ORM
  mit `fabric_uniform` (`detailRepeat` 8).
* **Alpha-Sätze** (`chainlink`, `metal_grate`): dichte Gitter mit `alphaTest` 0,5; dünner Maschendraht (Deckung
  < 45 %, `stats.coverage`) wird geblendet — mit `alphaTest` verschwände er in den kleinen Mip-Stufen.
* **Modelle** (`models.mjs`):
  * Requisiten werden zu **einem Draw Call je Material** verschmolzen (`flatten` + `join`; Waffen, Baukästen und
    `keepParts` behalten ihre Teile).
  * **LOD0** auf `lod0Tris` vereinfacht, **LOD1** ≈ 40 %, **LOD2** ≈ 14 % als Szenenknoten `LOD0/LOD1/LOD2`
    (der Loader baut `THREE.LOD`, Abstände im Manifest `lodDistances`). Vereinfachung mit absolutem Fehler bezogen
    auf das ganze Modell (Kleinteile fallen weg, `Prune`), gestaffelt: Fehlergrenze ×2,5 → über UV-/Normalen-Nähte
    hinweg (`Permissive`, attributgewichtet) → `sloppy` nur für LOD2. Stufen mit < 20 % Ersparnis entfallen.
  * Die **512er-Stufe** verwirft bei Requisiten die volle Geometrie (LOD1 → LOD0, `lodShift`).
  * **Texeldichte:** Kleinteile (größte Kante < 0,5 m) haben keine 1024er-Stufe (512² sind dort schon > 1000 px/m),
    **ORM** in halber Kantenlänge (außer Waffen).
  * **Alpha-Rettung:** Poly Havens JPG-glTF verliert Deckkraftkarten (Maschendraht, Lüftergitter, Glas, Blätter);
    `<präfix>_alpha|_opacity` wird aus der Dateiliste nachgeladen und als Alphakanal gepackt (MASK, dünner Draht
    und Glas BLEND). BLEND/MASK ohne echte Transparenz → OPAQUE.
  * Maßstabsfehler der Quelle per `scale` in `sources.json` (z. B. `steel_frame_shelves_01` ×0,1).
  * Baukästen (`kit`) behalten ihre benannten Teile (`parts`) ohne LOD-Kette. Geometrie: `EXT_meshopt_compression`
    + `KHR_mesh_quantization`.
* **HDRIs**: `.hdr` (RGBE, RLE) für `PMREMGenerator`; der Himmel als KTX2 ist bereits mit dem Spiel-ACES und
  `backgroundExposure` belichtet, ohne Mipmaps und zeilengespiegelt (v = 1 oben). Anzeigen über
  `createSky()` (Kuppel, ~1–3 MB GPU) statt `scene.background` (three würde in eine unkomprimierte
  Würfelkarte ≈ 25 MB umrechnen). `sun.dir` ist die Richtung zur Sonne in three.js-Koordinaten.

GPU-Schätzungen im Manifest (`gpu.desktop` / `gpu.mobile` / `gpu.rgba8`) gelten inkl. Mipmaps: ETC1S ohne
Alpha 0,5 B/px (Desktop BC1 — `loader.js` schaltet BC7 für die Bibliothek ab, ETC1S gewönne dadurch keine
Qualität —, Handy ETC1/ETC2), mit Alpha 1 B/px (BC3/ETC2-RGBA/ASTC); Rückfall ohne Kompressionsformat 4 B/px.
HDRIs: PMREM-Ziel (≈ 6 MB, RGBA16F) + Himmel. Modelle: Texturen + dekodierte (quantisierte) Geometrie.

## Laufzeit (`assets/lib/loader.js`)

```js
import { assets, tierFor } from '../assets/lib/loader.js';   // braucht die Import-Map ("three", "three/addons/")
assets.setRenderer(renderer).setQuality('high');            // Stufen je Art: tierFor('high', 'texture'|'model'|'hdri'|'sky')
const mat = await assets.createMaterial('concrete_floor_worn');           // MeshStandardMaterial, userData.surface
const env = await assets.loadHDRI('freight_station', renderer);           // env.envMap (PMREM), env.sunDirection
scene.environment = env.envMap; scene.add(env.createSky());
const barrel = await assets.loadModel('barrel_01');                       // THREE.LOD, Klone teilen GPU-Daten
const far = await assets.loadModel('barrel_01', 512, { lod: 1 });         // nur eine Stufe (z. B. für InstancedMesh)
const pipe = await assets.loadModel('modular_industrial_pipes_01', undefined, { part: 'modular_industrial_pipes_01_elbow' });
console.log(assets.budget(), assets.compressionSupport());   // { downloadedBytes, gpu: {desktop, mobile, rgba8}, … }, ['etc2', 'dxt', …]
await assets.estimate({ textures: [...], models: [...], hdri: 'freight_station' }, 'low');   // Budget vorab
await assets.disposeAll();      // Kartenwechsel
```

Der Basis-Transcoder wird relativ zum Modul gefunden (`../vendor/three/addons/libs/basis/`) und funktioniert auch
unter einem Unterpfad wie `/FreeGames-Website/` (geprüft mit einem Präfix-Server und `NP_BASE=…/FreeGames-Website/`).

UVs: Texturen sind kachelbar; `sizeM` im Manifest ist die reale Größe einer Kachel in Metern (für
weltskalierte UVs, z. B. `boxUV(geometry, sizeM[0])` in `engine/textures.js`). `replaces` nennt die
`getMaterial()`-Namen des Spiels, die der Satz ersetzen kann.

## Sichtprüfung (`dev/assets.html`)

Materialien auf Kugel/Boden/Wand unter einem HDRI, Modelle als Drehteller mit LOD-Umschaltung, Größen und
GPU-Speicher je Stufe, Kartenbudgets. URL-Parameter: `tab`, `id`, `tier`, `hdri`, `grid=1&cat=…` (Raster einer
Kategorie), `cmp=1` (alle LOD-Stufen nebeneinander), `lod=0|1|2`, `check=normal` (Normalen-Ausrichtung), `ui=0`,
`shot=1` (für `shots.mjs`, keine Dauerschleife). Die Infotafel zeigt die GPU-Kompressionsformate und das Format,
in das die Albedo-Textur transkodiert wurde.

## Neue Assets aufnehmen

1. Nur **CC0** (bevorzugt) oder CC-BY mit exakter Namensnennung — nichts mit NC/ND/Weitergabeverbot.
2. Eintrag in `sources.json` (Muster der vorhandenen), dann `node tools/assets/resolve.mjs`.
3. `node tools/assets/build.mjs <id>` — prüfen in `dev/assets.html`, Budget im Manifest ansehen.
4. `CREDITS.md` wird automatisch neu geschrieben.
