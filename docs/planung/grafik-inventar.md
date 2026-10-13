# Grafik-Inventar zum Abhaken (Etappe 0, Stand 13.10.2026)

Gehört zu `grafik-vorlage-plan.md`. Alles, was im neuen Video-Look neu gemacht werden muss. Spalte **Bezug** = welches
Videobild (`docs/planung/vorlage-video/bild-*.jpg`) als Vorlage dient; „abgeleitet“ = im Video nicht zu sehen, strikt aus
dem genannten Bild übertragen (keine eigene Stilidee). Haken setzen, wenn der Satz/das Modell im neuen Stil im Spiel ist.

Vergleichsbilder: `node tools/vergleich-video.mjs [--tag=nachher]` → `tools/out/vergleich/<tag>-bogen.png` (Video | Spiel).

## 1. Oberflächen (Materialschlüssel)
Heute zwei Schichten: Fotoscan-Sätze (KTX2, `world/library.js` LIB_MATERIALS → `assets/lib/textures/*`, 66 Sätze) und
prozedurale Ersatztexturen (`world/texgen.js` TEX, Handy/Fallback). **Beide** werden ersetzt.

| Gruppe | Schlüssel | Bezug |
|---|---|---|
| Beton | `[ ]` concrete · `[ ]` concrete_dark · `[ ]` concrete_panel · `[ ]` concrete_dirty · `[ ]` concrete_painted · `[ ]` epoxy · `[ ]` epoxy_blue · `[ ]` panel_wall | bild-2_0s (rissiger Kaibeton), bild-0_3s (Hallenboden) |
| Asphalt | `[ ]` asphalt | bild-2_0s |
| Putz | `[ ]` plaster_warm · `[ ]` plaster_white · `[ ]` plaster_peeling · `[ ]` plaster_blue · `[ ]` plaster_damaged · `[ ]` plaster_patched | bild-7_8s (Häuser am Platz) |
| Ziegel/Stein | `[ ]` brick · `[ ]` brick_dark · `[ ]` stone_wall | bild-5_0s, bild-6_5s (Werk-Ziegel) |
| Pflaster | `[ ]` cobble · `[ ]` paving | bild-7_8s |
| Dach | `[ ]` roof_tiles | bild-7_8s (rote Ziegeldächer) |
| Holz | `[ ]` wood_planks · `[ ]` wood_dark · `[ ]` wood_crate · `[ ]` wood_weathered · `[ ]` wood_peeling · `[ ]` wood_floor · `[ ]` wood_paint · `[ ]` wood_stock · `[ ]` osb | bild-0_3s (Paletten); Böden/Möbel abgeleitet |
| Metall | `[ ]` metal_painted · `[ ]` car_paint · `[ ]` metal_rust · `[ ]` metal_galvanized · `[ ]` metal_tread · `[ ]` metal_grate · `[ ]` gunmetal · `[ ]` hazard | bild-3_5s (gelbe Geländer, Laufstege, Kessel) |
| Blech | `[ ]` metal_corrugated · `[ ]` metal_corrugated_rust · `[ ]` metal_cladding · `[ ]` metal_shutter · `[ ]` chainlink | bild-0_3s (Hallen, Rolltor), bild-6_5s (Blechwand) |
| Container | `[ ]` container · `[ ]` container_red/blue/green/orange/gray | bild-0_3s, bild-2_0s (Beschriftung/Nummern) |
| Boden natur | `[ ]` grass · `[ ]` dirt · `[ ]` mud · `[ ]` ground_dry · `[ ]` sand · `[ ]` gravel · `[ ]` rubble | bild-7_8s (Beete, Bäume); Grenzland/Niemandsland abgeleitet |
| Fliesen/innen | `[ ]` tiles · `[ ]` tiles_terracotta · `[ ]` tiles_pattern · `[ ]` tiles_white · `[ ]` linoleum · `[ ]` rubber_floor | abgeleitet aus bild-3_5s (Sauberkeit, Kanten) |
| Stoff/Kunststoff | `[ ]` tarp · `[ ]` awning · `[ ]` sandbag · `[ ]` rubber · `[ ]` polymer · `[ ]` fabric_camo_a/b · `[ ]` cardboard | bild-5_0s (Soldat: Stoff, Gurte) |
| Natur | `[ ]` bark · `[ ]` bark_palm · Laub/Gras-Atlas (`world/atlas.js`) | bild-7_8s (Bäume) |
| Sonstiges | `[ ]` glass · `[ ]` water · `[ ]` white · `[ ]` skin | abgeleitet |

Nicht mehr gebraucht, sobald alles ersetzt ist: die 66 Fotoscan-Ordner in `assets/lib/textures/` (Größe sparen, CREDITS anpassen).

## 2. Requisiten aus Code (`world/props.js`)
`[ ]` container · `[ ]` crate/crateStack · `[ ]` barrel/barrelGroup · `[ ]` pallet/palletStack · `[ ]` sandbags · `[ ]` jersey ·
`[ ]` bollard · `[ ]` cone · `[ ]` car · `[ ]` van · `[ ]` truck · `[ ]` forklift · `[ ]` acUnit · `[ ]` roofVent · `[ ]` pipe ·
`[ ]` cable · `[ ]` lampPost · `[ ]` floodMast · `[ ]` fence · `[ ]` dumpster · `[ ]` tires · `[ ]` cableReel · `[ ]` gasBottles ·
`[ ]` electricBox · `[ ]` bench · `[ ]` cafeTable · `[ ]` chair · `[ ]` parasol · `[ ]` awning · `[ ]` marketStall · `[ ]` palm ·
`[ ]` tree · `[ ]` pot · `[ ]` laundry · `[ ]` rack · `[ ]` workbench · `[ ]` lockers · `[ ]` tank ·
dazu Bauteile aus `world/arch.js` (`[ ]` building · `[ ]` wall · `[ ]` stairs · `[ ]` railing · `[ ]` catwalk), Portalkran
(`crane-anim.js`), Rolltore/Türen (`game/doors.js`), Glocke (Altstadt), Brunnen, Clawd (bleibt orange, nur Licht anpassen).

## 3. Fertige Modelle (`assets/lib/models/`, 57 Stück, Poly Haven)
Im Video-Stil neu (eigene Geometrie mit gefasten Kanten) oder auf den Look gebracht:
`[ ]` ammo_box · `[ ]` barrel_01–03 · `[ ]` cardboard_box_01 · `[ ]` cement_bag · `[ ]` concrete_road_barrier · `[ ]` covered_car ·
`[ ]` dead_tree_trunk_02 · `[ ]` exterior_aircon_unit · `[ ]` fire_hydrant · `[ ]` hand_truck · `[ ]` hanging_industrial_lamp ·
`[ ]` industrial_pastic_container · `[ ]` industrial_wall_lamp · `[ ]` metal_jerrycan (+green) · `[ ]` metal_office_desk ·
`[ ]` metal_tool_chest · `[ ]` metal_trash_can · `[ ]` modular_airduct (rund, eckig) · `[ ]` modular_chainlink_fence ·
`[ ]` modular_electricity_poles · `[ ]` modular_fire_escape · `[ ]` modular_industrial_pipes_01 · `[ ]` modular_metal_gutter ·
`[ ]` mounted_fluorescent_lights · `[ ]` old_bed_frame · `[ ]` old_military_crate · `[ ]` old_tyre · `[ ]` planter_pot_clay ·
`[ ]` plastic_monobloc_chair_01 · `[ ]` portable_generator · `[ ]` potted_plant_02 · `[ ]` power_box_01 · `[ ]` propane_tank ·
`[ ]` rock_07 · `[ ]` rollershutter_door · `[ ]` schoolchair_01 · `[ ]` security_camera_01 · `[ ]` shrub_04 · `[ ]` sofa_01 ·
`[ ]` steel_frame_shelves_01 · `[ ]` street_lamp_01 · `[ ]` television_01 · `[ ]` tool_cart · `[ ]` trashbag · `[ ]` utility_box_01 ·
`[ ]` water_manhole_cover · `[ ]` weed_plant_02 · `[ ]` wooden_bookshelf_worn · `[ ]` wooden_military_crate · `[ ]` worn_metal_rack ·
(`bolt_action_rifle_7_62`, `service_pistol`: nur Arsenal-Vorlage, siehe Waffen)

## 4. Soldaten (Etappe 1) – Bezug bild-5_0s, bild-7_8s
`[ ]` Helm mit Tarnbezug · `[ ]` Plattenträger + Taschen · `[ ]` Rucksack · `[ ]` Handschuhe · `[ ]` kantiges grünes Splittertarn
(Grün/Oliv/Braun/Schwarz) · `[ ]` Teamunterscheidung (Armbinde/Abzeichen + Namensschild) · `[ ]` Gesicht/Maske ·
`[ ]` Ego-Arme (Ärmel gleiches Tarn, dunkle Handschuhe) · `[ ]` Puppen (Mehrspieler) · `[ ]` Leichen/Ragdoll-Material ·
`[ ]` Klassen-Ausrüstung (`bots/soldier/gear.js`) · `[ ]` LOD-Stufen.
Dateien: `bots/character.js`, `bots/soldier/{builder,gear,materials}.js`, `weapons/viewmodel.js` (Arme).

## 5. Fahrzeuge (Etappe 4)
`[ ]` mbt (moderner Kampfpanzer) · `[ ]` wk2 · `[ ]` wk2h · `[ ]` wk1 · `[ ]` wk1l · `[ ]` jeep · Innenräume · Tarnungen
(`vehicles/{models,materials,skins}.js`). Keine echten Panzernamen in öffentlichen Texten.

## 6. Waffen (Etappe 4) – Bezug bild-0_3s (Gewehr mit Rotpunkt)
Schusswaffen: `[ ]` ar_m17 · `[ ]` ar_kv47 · `[ ]` ar_k36 · `[ ]` ar_bx20 · `[ ]` ar_g7 · `[ ]` mr_sk14 · `[ ]` lmg_hm60 · `[ ]` lmg_lm8 ·
`[ ]` smg_vp9 · `[ ]` smg_qx90 · `[ ]` smg_wespe · `[ ]` smg_keiler · `[ ]` pi_p9 · `[ ]` pi_adler · `[ ]` pi_kobra · `[ ]` sr_brecher ·
`[ ]` sr_titan · `[ ]` sg_bulldog · `[ ]` sg_hagel · `[ ]` at_donner · `[ ]` gl_hammer · `[ ]` gl_trommel · Aufsätze/Visiere ·
Nahkampf: `[ ]` knife · `[ ]` karambit · `[ ]` machete · `[ ]` tomahawk · `[ ]` kampfaxt · `[ ]` schlagstock · `[ ]` kampfstock · `[ ]` spaten ·
Granaten/Wurfnetz/Drohne/Geschütz. Datei: `weapons/models.js`. Danach alle Ego-Animationen.

## 7. Licht, Himmel, Nachbearbeitung (Etappe 0/6)
HDRI-Himmel je Karte (`assets/lib/hdri/`: freight_station, burnt_warehouse, abandoned_slipway, zwartkops_straight_morning,
old_outdoor_theater, industrial_pipe_and_valve_01, debris_basement_corridor, cobblestone_street_night) → Video: klare
Tagessonne, blauer Himmel mit Cumulus (bild-7_8s), harte klare Schatten (bild-2_0s), Lichtstrahlen in Hallen (bild-3_5s).
`[ ]` Himmel/Wolken · `[ ]` Sonnenfarbe/-stärke · `[ ]` Schattenweichheit · `[ ]` Umgebungsverdeckung ab „hoch“ (heute nur per
Einstellung `gfxAO`/„ultra“, kostet einen zweiten Szenendurchlauf → erst messen) · `[ ]` Lichtstrahlen/Staub · `[ ]` Farbton (Grading).

## Karten-Bezug (für Etappen 2, 3, 5)
| Karte | Bezug |
|---|---|
| Hafen | bild-0_3s, bild-1_2s, bild-2_0s (direkt im Video) |
| Werk | bild-3_5s, bild-5_0s, bild-6_5s (direkt im Video) |
| Altstadt | bild-7_8s, bild-9_4s (nur der Platz; Gassen aus Putz/Pflaster/Dach desselben Bildes) |
| Bibliothek | Ziegel aus bild-5_0s, Innenraum-Sauberkeit/Licht aus bild-3_5s |
| Schießstand | Beton/Container aus bild-2_0s, Holz aus bild-0_3s |
| Grenzland | Industrie: Beton/Wellblech aus bild-0_3s/2_0s; Dorf: Putz/Dach/Pflaster aus bild-7_8s; Natur: Bäume/Beete aus bild-7_8s |
| Niemandsland | Holz aus bild-0_3s, Erde/Sandsäcke abgeleitet aus bild-7_8s (Beete) und Soldatenstoff bild-5_0s |
