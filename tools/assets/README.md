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
node tools/assets/shots.mjs             # Screenshots von dev/assets.html (Server: npx http-server -p 8765 -s -c-1 .)
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

| Stufe | Qualität | Texturen | Modelle | HDRI-Beleuchtung | Himmel |
|---|---|---|---|---|---|
| 512 | low (Handy) | 512² | 512er Texturen | 512×256 | 1024×512 |
| 1024 | medium / high | 1024² | 1024er Texturen | 1024×512 | 2048×1024 |
| 2048 | ultra | 2048² nur „Helden“-Materialien (`hero`) | Waffen (`weapon`) | 1024×512 | 2048×1024 |

* **KTX2 / Basis Universal ETC1S** für Albedo, Normalen, ORM und Himmel. Der Browser transkodiert passend zur
  GPU (Desktop BC7/BC1, Android ETC1/ETC2, iOS ASTC/PVRTC). Gemessen (`lib/decode.mjs`, 1024²): Albedo q160
  ≈ 40 dB PSNR; Normalen q255 ≈ 1,4° mittlerer Winkelfehler — so gut wie UASTC+RDO λ1 (1,1°) bei einem
  Drittel der Größe und halbem Handy-Speicher (ETC1 0,5 B/px). UASTC wurde für 2048er-Normalen verworfen
  (3–4 MB je Karte).
* **ORM** = AO/Rauheit/Metall in einer Textur (three.js: `aoMap`, `roughnessMap`, `metalnessMap` zeigen auf
  dieselbe Textur; Kanäle R/G/B). Poly Haven liefert „ARM“ direkt, ambientCG wird gepackt.
* **Einfärbbar** (`tintable`): Lack-/Grundfarbe neutralisiert (`recolor`, Farbtonbereich → Grau), damit
  `material.color` die Farbe bestimmt (Container in 5 Farben aus einem Satz, lackiertes Metall, Plane, Uniform).
* **Tarnmuster** (`camo_*`) sind prozedural erzeugt (kachelbar, keine realen Muster) und teilen Normal/ORM
  mit `fabric_uniform` (`detailRepeat` 8).
* **Modelle**: LOD0 auf `lod0Tris` vereinfacht (meshoptimizer), LOD1 ≈ 40 %, LOD2 ≈ 14 % als Szenenknoten
  `LOD0/LOD1/LOD2` (der Loader baut `THREE.LOD`, Abstände im Manifest `lodDistances`). Baukästen (`kit`)
  behalten ihre benannten Teile (`parts`). Geometrie: `EXT_meshopt_compression` + `KHR_mesh_quantization`.
* **HDRIs**: `.hdr` (RGBE, RLE) für `PMREMGenerator`; der Himmel als KTX2 ist bereits mit dem Spiel-ACES und
  `backgroundExposure` belichtet, ohne Mipmaps und zeilengespiegelt (v = 1 oben). Anzeigen über
  `createSky()` (Kuppel, ~2,7 MB GPU) statt `scene.background` (three würde in eine unkomprimierte
  Würfelkarte ≈ 25 MB umrechnen). `sun.dir` ist die Richtung zur Sonne in three.js-Koordinaten.

GPU-Schätzungen im Manifest (`gpu.desktop` / `gpu.mobile` / `gpu.rgba8`) gelten inkl. Mipmaps:
Desktop 1 B/px (BC7), Handy 0,5 B/px (ETC1S → ETC1/ETC2 RGB) bzw. 1 B/px mit Alpha, Rückfall ohne
Kompressionsformat 4 B/px. HDRIs: PMREM-Ziel (≈ 6 MB, RGBA16F) + Himmel.

## Laufzeit (`assets/lib/loader.js`)

```js
import { assets, tierFor } from '../assets/lib/loader.js';   // braucht die Import-Map ("three", "three/addons/")
assets.setRenderer(renderer).setQuality('high');            // low → 512, medium/high → 1024, ultra → 2048
const mat = await assets.createMaterial('concrete_floor_worn');           // MeshStandardMaterial, userData.surface
const env = await assets.loadHDRI('freight_station', renderer);           // env.envMap, env.sunDirection
scene.environment = env.envMap; scene.add(env.createSky());
const barrel = await assets.loadModel('barrel_01');                       // THREE.LOD, Klone teilen GPU-Daten
const pipe = await assets.loadModel('modular_industrial_pipes_01', undefined, { part: 'modular_industrial_pipes_01_elbow' });
console.log(assets.budget());   // { downloadedBytes, gpu: {desktop, mobile, rgba8}, assets: […] }
await assets.disposeAll();      // Kartenwechsel
```

UVs: Texturen sind kachelbar; `sizeM` im Manifest ist die reale Größe einer Kachel in Metern (für
weltskalierte UVs, z. B. `boxUV(geometry, sizeM[0])` in `engine/textures.js`). `replaces` nennt die
`getMaterial()`-Namen des Spiels, die der Satz ersetzen kann.

## Neue Assets aufnehmen

1. Nur **CC0** (bevorzugt) oder CC-BY mit exakter Namensnennung — nichts mit NC/ND/Weitergabeverbot.
2. Eintrag in `sources.json` (Muster der vorhandenen), dann `node tools/assets/resolve.mjs`.
3. `node tools/assets/build.mjs <id>` — prüfen in `dev/assets.html`, Budget im Manifest ansehen.
4. `CREDITS.md` wird automatisch neu geschrieben.
