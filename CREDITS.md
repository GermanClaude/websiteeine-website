# Danksagungen & Lizenzen

Seit 16.10. sind alle Texturen, Himmel (Umgebungslicht) und Requisiten-Modelle von NULLPUNKT **selbst erzeugt**:
Texturen über eigene Generatoren (Höhenfeld → Albedo/Normalen/ORM, kachelbar), Himmel über einen eigenen
Atmosphären- und Wolkenrechner (je Tageszeit × Wetterlage), Modelle aus eigenen Grundkörpern mit eigenen Texturen.
Die früher genutzten Fremd-Assets (Poly Haven, ambientCG) sind vollständig ersetzt und nicht mehr im Spiel.
Die Dateien in `assets/lib/` sind KTX2/Basis Universal kodiert, Modelle mit Meshopt und LOD-Stufen.
Liste mit Generator-Schlüsseln: `tools/assets/sources.json`, Pipeline: `tools/assets/`.

## Texturen (92)

| ID | Herkunft | Werkzeug |
|---|---|---|
| `concrete_floor_worn` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `concrete_wall_dark` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `concrete_panels` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `concrete_dirty` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `concrete_painted_peeling` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `concrete_epoxy` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `rubble` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `plaster_beige` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `plaster_white` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `plaster_white_peeling` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `plaster_damaged_brick` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `plaster_worn_patched` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `plaster_blue_weathered` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `plaster_painted` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wallpaper_stained` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `sandstone_blocks` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `brick_factory` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `brick_dark` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `cobblestone` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `paving_flagstone` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `roof_clay_tiles` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `tiles_terracotta` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `tiles_worn` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `tiles_checker` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `tiles_white_wall` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `linoleum` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `carpet_dirty` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `ceiling_office` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `rubber_floor` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `asphalt_cracked` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `gravel` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `sand` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `dirt` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `mud` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `ground_dry_cracked` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `grass` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wood_planks` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wood_planks_weathered` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wood_planks_dark` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wood_crate` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `osb` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wood_floor_old` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wood_peeling_paint` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `bark_palm` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `cardboard` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_painted` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_rust_painted` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_corrugated` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_corrugated_rusty` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_cladding_green` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_shutter` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_galvanized` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_tread` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `metal_grate` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `chainlink` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `hazard_stripes` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `container` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `burlap` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `canvas` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `awning_stripes` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `felt_panel` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `fabric_uniform` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `camo_woodland` | eigener Generator (abgeleitet) | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `camo_desert` | eigener Generator (abgeleitet) | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `camo_urban` | eigener Generator (abgeleitet) | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `gunmetal_worn` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `polymer_black` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `wood_stock` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `rubber` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `v_container` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `v_concrete_slab` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `v_cladding` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `v_brick` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `v_setts` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `v_roof` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `v_plaster` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |
| `vh_wand` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_blau_seite` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_rost_tuer` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_rost_seite` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_rot_seite` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_gruen_seite` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_grau_seite` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_blau_tuer` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_rot_tuer` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_gruen_tuer` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_ctr_grau_tuer` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vh_kai` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vp_pflaster` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vw_ziegel` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `vw_blau` | eigene Video-Vorlage (entzerrt) | `tools/assets/video_material.py` |
| `ctr_lack` | eigener Generator | `tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs` |

## Himmel (20)

| ID | Herkunft | Werkzeug |
|---|---|---|
| `np_sky_morgen_klar` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_morgen_dunst` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_morgen_morgennebel` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_morgen_bewoelkt` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_vormittag_klar` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_vormittag_dunst` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_vormittag_morgennebel` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_vormittag_bewoelkt` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_mittag_klar` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_mittag_dunst` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_mittag_morgennebel` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_mittag_bewoelkt` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_nachmittag_klar` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_nachmittag_dunst` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_nachmittag_morgennebel` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_nachmittag_bewoelkt` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_abend_klar` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_abend_dunst` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_abend_morgennebel` | eigener Generator | `tools/assets/skygen.py` |
| `np_sky_abend_bewoelkt` | eigener Generator | `tools/assets/skygen.py` |

## Modelle (34)

| ID | Herkunft | Werkzeug |
|---|---|---|
| `ammo_box` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `old_military_crate` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `wooden_military_crate` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `metal_jerrycan` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `metal_jerrycan_green` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `barrel_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `barrel_02` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `barrel_03` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `old_tyre` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `cardboard_box_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `cement_bag` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `metal_trash_can` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `trashbag` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `industrial_pastic_container` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `propane_tank` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `exterior_aircon_unit` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `fire_hydrant` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `concrete_road_barrier` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `utility_box_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `power_box_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `hanging_industrial_lamp` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `hand_truck` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `metal_tool_chest` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `portable_generator` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `tool_cart` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `metal_office_desk` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `schoolchair_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `steel_frame_shelves_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `worn_metal_rack` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `plastic_monobloc_chair_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `wetfloorsign_01` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `dead_tree_trunk_02` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `rock_07` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |
| `planter_pot_clay` | eigener Generator | `tools/assets/lib/eigen-models.mjs` |

## Waffen-Referenzfotos (nur Maße abgeleitet, Fotos nicht enthalten)

Die Waffenmodelle sind selbst gebaut (Distanzfelder, Profile, eigene Texturen). Als Maßvorlage dienten frei lizenzierte
Fotos: Umrisse und Lagen wurden daraus abgenommen und als Zahlen in `assets/js/game/weapons/gunsmith/<name>-ref.js`
gespeichert. Die Fotos selbst sind weder im Spiel noch im Repository enthalten. Werkzeuge: `tools/ref/`.

| Waffe | Foto | Urheber | Lizenz |
|---|---|---|---|
| M-17 Falke (rechte Seite) | [PEO M4 Carbine RAS M68 CCO](https://commons.wikimedia.org/wiki/File:PEO_M4_Carbine_RAS_M68_CCO.jpg) | Photo Courtesy of PEO Soldier ([Flickr](https://www.flickr.com/photos/peosoldier/4639044647/)) | gemeinfrei (US Army, PD-USGov-Military-Army) |
| M-17 Falke (linke Seite) | [Carbine M4 1](https://commons.wikimedia.org/wiki/File:Carbine_M4_1.jpg) | US Army (tri.army.mil) | gemeinfrei (US Army, PD-USGov-Military-Army) |
| P-9 Kompakt | [GLOCK 17 Gen 4 Pistol MOD 45160305](https://commons.wikimedia.org/wiki/File:GLOCK_17_Gen_4_Pistol_MOD_45160305.jpg) | Photo: Steve Dock/MOD | [Open Government Licence v1.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/1/) |
| KV-47 (rechte Seite) | [Polish AKM 1971, AM.016072, 01](https://commons.wikimedia.org/wiki/File:Polish_AKM_1971,_AM.016072,_01.jpg) | Torkel Edenborg / Swedish Army Museum (Armémuseum) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) – verändert: nur Maße und Umrisse abgeleitet (perspektivisch entzerrt) |
| KV-47 (linke Seite) | [Polish AKM 1971, AM.016072, 02](https://commons.wikimedia.org/wiki/File:Polish_AKM_1971,_AM.016072,_02.jpg) | Torkel Edenborg / Swedish Army Museum (Armémuseum) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) – verändert: nur Lagen von Nieten, Prägungen, Deckelkante |
| QX-90 (rechte Seite) | [FN P90 Standard Submachine Gun Right Side](https://commons.wikimedia.org/wiki/File:FN_P90_Standard_Submachine_Gun_Right_Side.jpg) | FN Herstal (Foto: Stéphane Moureaux, studioimage.be; [Flickr](https://www.flickr.com/photos/15725582@N08/2768333091/)) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) – verändert: nur Maße und Umrisse abgeleitet |
| QX-90 (linke Seite) | [FN P90 Submachine Gun Left Side](https://commons.wikimedia.org/wiki/File:FN_P90_Submachine_Gun_Left_Side.jpg) | FN Herstal (Foto: Stéphane Moureaux, studioimage.be; [Flickr](https://www.flickr.com/photos/15725582@N08/2769180422/)) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) – verändert: nur Lagen von Schrift, Wulst, Breiten |
| QX-90 (Mündungsseite) | [FN P90 Standard Muzzle End](https://commons.wikimedia.org/wiki/File:FN_P90_Standard_Muzzle_End.jpg) | FN Herstal ([Flickr](https://www.flickr.com/photos/15725582@N08/2769180422/) – Commons nennt für diese Datei dieselbe Quelle wie für die linke Seite) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) – verändert: nur Visierfenster, Schlüsselloch, Feuerdämpfer, Breiten |
| QX-90 (Gegenprobe Dämpfer, Abzug, Magazin) | [FN P90 01](https://commons.wikimedia.org/wiki/File:FN_P90_01.jpg) | Gabon100 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) – verändert: nur Formen von Feuerdämpfer, Abzug und Magazin verglichen |
| QX-90 (ohne Magazin) | [FN P90 PDW](https://commons.wikimedia.org/wiki/File:FN_P90_PDW.jpg) | DickClarkMises | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) – Magazinauflage, Halter |
| KV-47 (Gegenprobe Proportionen) | [AKM automatkarbin – 7,62x39mm](https://commons.wikimedia.org/wiki/File:AKM_automatkarbin_-_7,62x39mm.jpg) | Armémuseum (The Swedish Army Museum) | gemeinfrei |

## Klänge

Die aufgenommenen Klänge unter `assets/lib/audio/` (ebenfalls CC0: The Free Firearm Sound Library, Freesound,
Kenney) sind mit Quelle, Urheber:in und Lizenz je Datei in [docs/AUDIO_SOURCES.md](docs/AUDIO_SOURCES.md) aufgeführt.

## Software

| Bibliothek | Verwendung | Lizenz |
|---|---|---|
| [three.js](https://threejs.org) r186 (inkl. GLTFLoader, KTX2Loader, HDRLoader) | Rendering, Laden | MIT |
| [Basis Universal](https://github.com/BinomialLLC/basis_universal) (Transcoder, `assets/vendor/three/addons/libs/basis/`) | KTX2-Transkodierung im Browser | Apache-2.0 |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) (Decoder) | Geometrie-Dekompression | MIT |
| [zstddec](https://github.com/donmccurdy/zstddec) / [ktx-parse](https://github.com/donmccurdy/ktx-parse) | KTX2-Superkompression / Container | MIT |
| [glTF Transform](https://gltf-transform.dev), [ktx2-encoder](https://github.com/gz65555/ktx2-encoder), [sharp](https://sharp.pixelplumbing.com) | nur Build-Pipeline (nicht ausgeliefert) | MIT / Apache-2.0 |
