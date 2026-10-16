// Fasst sources.json + build-meta/** zu assets/lib/manifest.json zusammen und schreibt CREDITS.md.
// Enthält je Asset alle Stufen (Dateipfade relativ zu assets/lib/, Bytes, geschätzter GPU-Speicher),
// Lizenz/Quelle/Autor sowie Kartenvorschläge mit Budget je Qualitätsstufe.
// Aufruf: node tools/assets/manifest.mjs
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmtBytes, loadSources, log, META, OUT, PIPELINE_VERSION, readJSON, ROOT, writeJSON } from './lib/common.mjs';

const src = loadSources();
// Muss zu assets/lib/loader.js passen (QUALITY_TIER / MODEL_TIER / HDRI_TIER / SKY_TIER) — REALISM_PLAN §4.2/4.3:
// Requisiten auf medium mit 512er-Texturen, HDRI-Licht bis medium 512 (diffus genügt), Himmel ab medium 2048×1024.
const QUALITY_TIER = { low: 512, medium: 1024, high: 1024, ultra: 2048 };
const MODEL_TIER = { low: 512, medium: 512, high: 1024, ultra: 2048 };
const HDRI_TIER = { low: 512, medium: 512, high: 1024, ultra: 1024 };
const SKY_TIER = { low: 512, medium: 1024, high: 1024, ultra: 1024 };

const licenseInfo = (e) => ({ license: e.license, source: e.source, sourceId: e.sourceId, url: e.url, author: e.author });
const fix2 = (s) => (s && s.length === 2 ? (s[0] && s[1] ? s : [s[0] || s[1], s[0] || s[1]]) : null);

const manifest = {
  $comment: 'Generiert von tools/assets/manifest.mjs — nicht von Hand bearbeiten. Pfade relativ zu dieser Datei.',
  version: 1,
  pipeline: PIPELINE_VERSION,
  generated: new Date().toISOString(),
  qualityTiers: QUALITY_TIER,
  modelTiers: MODEL_TIER,
  hdriTiers: HDRI_TIER,
  skyTiers: SKY_TIER,
  gpuNote: 'Schätzung inkl. Mipmaps. gpu.desktop: ETC1S → BC1 (0,5 B/px; loader.js schaltet BC7 ab), mit Alpha BC3 (1 B/px). gpu.mobile: ETC1S → ETC2/ETC1 (0,5 B/px), mit Alpha ETC2-RGBA/ASTC (1 B/px). gpu.rgba8: Rückfall ohne Kompressionsformat (4 B/px). Modelle inkl. dekodierter (quantisierter) Geometrie; HDRIs = PMREM-Ziel (RGBA16F) + Himmel (KTX2, ohne Mipmaps).',
  budgetNote: 'maps.*.budget: Summe der vorgeschlagenen Texturen, Modelle und des HDRIs je Qualität (geteilte Dateien einmal) — ohne Spielcode, Audio und prozedurale Welt-Geometrie.',
  textures: {}, hdris: {}, models: {}, maps: {}, totals: {},
};
const missing = [];

for (const e of src.textures) {
  const m = readJSON(join(META, 'textures', `${e.id}.json`), null);
  if (!m) { missing.push('texture:' + e.id); continue; }
  const tiers = {};
  for (const [tier, t] of Object.entries(m.tiers)) {
    tiers[tier] = { albedo: t.files.albedo.path, normal: t.files.normal.path, orm: t.files.orm.path, sizes: { albedo: t.files.albedo.bytes, normal: t.files.normal.bytes, orm: t.files.orm.bytes }, gpuFiles: { albedo: t.files.albedo.gpu, normal: t.files.normal.gpu, orm: t.files.orm.gpu }, bytes: t.bytes, gpu: t.gpu };
    if (t.files.normal.shared) tiers[tier].shared = { normal: t.files.normal.shared, orm: t.files.orm.shared };
  }
  let sizeM = fix2(e.sizeM) || [2, 2];
  if (m.detailRepeat) sizeM = sizeM.map((v) => +(v * m.detailRepeat).toFixed(2));
  manifest.textures[e.id] = {
    type: 'texture', name: e.name || e.id, category: e.category, surface: e.surface, replaces: e.replaces || [],
    sizeM, tintable: !!e.tintable, alpha: !!e.alpha, hero: !!e.hero, ...(m.detailRepeat ? { detailRepeat: m.detailRepeat } : {}),
    // Korrektur unplausibler Quellwerte (Gras/Kunststoff zu glänzend, Jute mit Metallanteil) — Faktor auf die ORM-Karte
    ...(e.roughnessScale != null ? { roughnessScale: e.roughnessScale } : {}), ...(e.metalnessScale != null ? { metalnessScale: e.metalnessScale } : {}),
    stats: m.stats, tiers, ...licenseInfo(e),
  };
}

for (const e of src.hdris) {
  const m = readJSON(join(META, 'hdris', `${e.id}.json`), null);
  if (!m) { missing.push('hdri:' + e.id); continue; }
  const tiers = {};
  for (const [tier, t] of Object.entries(m.tiers)) tiers[tier] = { hdr: t.hdr.path, background: t.background.path, sizes: { hdr: t.hdr.bytes, background: t.background.bytes }, gpuParts: { pmrem: { desktop: t.gpu.desktop - t.background.gpu.desktop, mobile: t.gpu.mobile - t.background.gpu.mobile, rgba8: t.gpu.rgba8 - t.background.gpu.rgba8 }, background: t.background.gpu }, bytes: t.bytes, gpu: t.gpu, size: [t.hdr.width, t.hdr.height], backgroundSize: [t.background.width, t.background.height] };
  manifest.hdris[e.id] = { type: 'hdri', name: e.name || e.id, kind: e.kind, mood: e.mood, maps: e.maps || [], sun: m.stats.sun, luminance: { avg: m.stats.avgLuminance, sky: m.stats.skyLuminance, skyGeo: m.stats.skyGeoLuminance }, backgroundExposure: m.stats.backgroundExposure, exposure: m.stats.backgroundExposure, tiers, ...licenseInfo(e) };
}

for (const e of src.models) {
  const m = readJSON(join(META, 'models', `${e.id}.json`), null);
  if (!m) { missing.push('model:' + e.id); continue; }
  const tiers = {};
  for (const [tier, t] of Object.entries(m.tiers)) tiers[tier] = { glb: t.path, bytes: t.bytes, gpu: t.gpu, tris: t.lods.map((l) => l.tris), textures: t.textures.length, ...(t.lodDistances !== undefined ? { lodDistances: t.lodDistances } : {}), ...(t.lodShift ? { lodShift: true } : {}) };
  const any = Object.values(m.tiers)[0];
  manifest.models[e.id] = {
    type: 'model', name: e.name || e.id, category: e.category, kit: !!e.kit, weapon: !!e.weapon,
    size: m.size, radius: m.radius, lodDistances: m.lodDistances, parts: any.parts, sourceTris: any.srcTris,
    materials: any.materials, tiers, ...licenseInfo(e),
  };
}

// ---------------------------------------------------------------------------------------------
// Kartenvorschläge (Verwendung durch world/** ist Sache der Welt-Entwickler) + Budget je Qualität
// ---------------------------------------------------------------------------------------------
const MAPS = {
  hafen: { hdri: 'np_sky_nachmittag_klar', textures: ['concrete_floor_worn', 'asphalt_cracked', 'concrete_wall_dark', 'concrete_panels', 'plaster_white', 'metal_painted', 'metal_corrugated', 'metal_corrugated_rusty', 'metal_galvanized', 'metal_tread', 'metal_grate', 'hazard_stripes', 'container', 'wood_planks', 'wood_crate', 'rubber', 'grass', 'gravel', 'concrete_epoxy', 'tiles_worn', 'chainlink', 'wood_planks_weathered'], models: ['barrel_01', 'barrel_02', 'barrel_03', 'old_tyre', 'wooden_military_crate', 'old_military_crate', 'metal_jerrycan', 'concrete_road_barrier', 'hand_truck', 'metal_trash_can', 'exterior_aircon_unit', 'power_box_01', 'utility_box_01', 'covered_car', 'cardboard_box_01', 'propane_tank', 'fire_hydrant'] },
  altstadt: { hdri: 'np_sky_mittag_klar', textures: ['sandstone_blocks', 'plaster_white', 'plaster_white_peeling', 'plaster_beige', 'plaster_blue_weathered', 'cobblestone', 'paving_flagstone', 'roof_clay_tiles', 'tiles_terracotta', 'tiles_checker', 'wood_planks', 'wood_planks_dark', 'wood_peeling_paint', 'metal_painted', 'metal_galvanized', 'canvas', 'awning_stripes', 'sand', 'dirt', 'grass', 'bark_palm', 'rubber', 'cardboard'], models: ['planter_pot_clay', 'plastic_monobloc_chair_01', 'cement_bag', 'metal_jerrycan_green', 'wooden_military_crate', 'cardboard_box_01', 'trashbag', 'exterior_aircon_unit', 'metal_trash_can', 'rock_07', 'covered_car', 'fire_hydrant'] },
  werk: { hdri: 'np_sky_nachmittag_klar', textures: ['brick_factory', 'brick_dark', 'concrete_floor_worn', 'concrete_dirty', 'concrete_painted_peeling', 'concrete_wall_dark', 'metal_painted', 'metal_rust_painted', 'metal_corrugated', 'metal_corrugated_rusty', 'metal_cladding_green', 'metal_galvanized', 'metal_tread', 'metal_grate', 'hazard_stripes', 'gravel', 'asphalt_cracked', 'wood_planks', 'rubber_floor', 'tiles_white_wall', 'rubble', 'osb', 'plaster_damaged_brick'], models: ['hanging_industrial_lamp', 'metal_tool_chest', 'tool_cart', 'portable_generator', 'hand_truck', 'barrel_01', 'barrel_03', 'industrial_pastic_container', 'steel_frame_shelves_01', 'worn_metal_rack', 'metal_office_desk', 'schoolchair_01', 'old_tyre', 'power_box_01', 'wetfloorsign_01'] },
  range: { hdri: 'np_sky_morgen_klar', textures: ['concrete_floor_worn', 'concrete_panels', 'gravel', 'grass', 'dirt', 'sand', 'wood_planks', 'wood_planks_dark', 'metal_painted', 'metal_galvanized', 'metal_tread', 'felt_panel', 'concrete_epoxy', 'burlap', 'rubber_floor', 'mud', 'ground_dry_cracked', 'chainlink'], models: ['ammo_box', 'wooden_military_crate', 'old_military_crate', 'metal_jerrycan_green', 'concrete_road_barrier', 'old_tyre', 'hanging_industrial_lamp', 'dead_tree_trunk_02', 'rock_07'] },
  innenraum: { planned: true, hdri: 'np_sky_mittag_bewoelkt', textures: ['concrete_dirty', 'concrete_painted_peeling', 'plaster_damaged_brick', 'plaster_worn_patched', 'plaster_painted', 'wallpaper_stained', 'tiles_worn', 'tiles_white_wall', 'tiles_checker', 'linoleum', 'carpet_dirty', 'ceiling_office', 'wood_floor_old', 'wood_peeling_paint', 'osb', 'metal_shutter', 'brick_dark', 'rubble', 'metal_rust_painted'], models: ['metal_office_desk', 'schoolchair_01', 'steel_frame_shelves_01', 'wetfloorsign_01', 'hanging_industrial_lamp', 'cardboard_box_01', 'trashbag', 'plastic_monobloc_chair_01', 'old_military_crate'] },
  // Charakter-/Waffenmaterialien (Viewmodel + Bots), unabhängig von der Karte geladen
  ausruestung: { shared: true, textures: ['gunmetal_worn', 'polymer_black', 'wood_stock', 'rubber', 'fabric_uniform', 'camo_woodland', 'camo_desert', 'camo_urban'], models: [] },
};

function pickTier(tiers, want) {
  const avail = Object.keys(tiers).map(Number).sort((a, b) => a - b);
  let best = avail[0];
  for (const t of avail) if (t <= want) best = t;
  return String(best);
}

function budget(def, q) {
  // Dateien (und ihr GPU-Anteil) zählen einmal, auch wenn Sätze sie teilen (Tarnmuster ↔ fabric_uniform)
  const seen = new Set();
  let bytes = 0, gpu = { desktop: 0, mobile: 0, rgba8: 0 };
  const add = (path, b, g) => { if (!path || seen.has(path)) return; seen.add(path); bytes += b || 0; if (g) { gpu.desktop += g.desktop; gpu.mobile += g.mobile; gpu.rgba8 += g.rgba8; } };
  for (const id of def.textures) {
    const t = manifest.textures[id]; if (!t) continue;
    const tr = t.tiers[pickTier(t.tiers, QUALITY_TIER[q])];
    for (const k of ['albedo', 'normal', 'orm']) add(tr[k], tr.sizes[k], tr.gpuFiles[k]);
  }
  for (const id of def.models) {
    const m = manifest.models[id]; if (!m) continue;
    const tr = m.tiers[pickTier(m.tiers, MODEL_TIER[q])];
    add(tr.glb, tr.bytes, tr.gpu);
  }
  if (def.hdri && manifest.hdris[def.hdri]) {
    const tiers = manifest.hdris[def.hdri].tiers;
    const h = tiers[pickTier(tiers, HDRI_TIER[q])], hb = tiers[pickTier(tiers, SKY_TIER[q])];
    add(h.hdr, h.sizes.hdr, h.gpuParts.pmrem); add(hb.background, hb.sizes.background, hb.gpuParts.background);
  }
  return { bytes, gpu };
}
for (const [id, def] of Object.entries(MAPS)) {
  manifest.maps[id] = { ...def, budget: Object.fromEntries(Object.keys(QUALITY_TIER).map((q) => [q, budget(def, q)])) };
}
// Kartenvorschlag je Asset (Umkehrung von MAPS) + Prüfung, dass jede Liste nur vorhandene Assets nennt
for (const [mapId, def] of Object.entries(MAPS)) {
  for (const [kind, list] of [['textures', def.textures], ['models', def.models], ['hdris', def.hdri ? [def.hdri] : []]]) {
    for (const id of list) {
      const e = manifest[kind][id];
      if (!e) { missing.push(`map:${mapId}:${kind}:${id}`); continue; }
      if (kind !== 'hdris') (e.maps ||= []).push(mapId);
    }
  }
}
for (const kind of ['textures', 'models']) for (const e of Object.values(manifest[kind])) e.maps ||= [];

// Summen über die Dateien auf der Platte
function walk(dir) { let n = 0, b = 0; for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) { const r = walk(p); n += r.n; b += r.b; } else { n++; b += statSync(p).size; } } return { n, b }; }
for (const sub of ['textures', 'hdri', 'models']) { const d = join(OUT, sub); manifest.totals[sub] = existsSync(d) ? { files: walk(d).n, bytes: walk(d).b } : { files: 0, bytes: 0 }; }
manifest.totals.all = Object.values(manifest.totals).reduce((a, t) => ({ files: a.files + t.files, bytes: a.bytes + t.bytes }), { files: 0, bytes: 0 });
// Bytes je Stufe über die ganze Bibliothek (Texturen: Dateien je Stufe, geteilte einmal; Modelle: .glb; HDRIs: .hdr + Himmel)
{
  const byTier = {};
  const seen = new Set();
  const add = (tier, path, b) => { if (seen.has(path)) return; seen.add(path); byTier[tier] = (byTier[tier] || 0) + (b || 0); };
  for (const e of Object.values(manifest.textures)) for (const [t, v] of Object.entries(e.tiers)) for (const k of ['albedo', 'normal', 'orm']) add(t, v[k], v.sizes[k]);
  for (const e of Object.values(manifest.models)) for (const [t, v] of Object.entries(e.tiers)) add(t, v.glb, v.bytes);
  for (const e of Object.values(manifest.hdris)) for (const [t, v] of Object.entries(e.tiers)) { add(t, v.hdr, v.sizes.hdr); add(t, v.background, v.sizes.background); }
  manifest.totals.byTier = byTier;
}
manifest.totals.counts = { textures: Object.keys(manifest.textures).length, hdris: Object.keys(manifest.hdris).length, models: Object.keys(manifest.models).length };
if (missing.length) manifest.missing = missing;

writeJSON(join(OUT, 'manifest.json'), manifest, 1);

// ---------------------------------------------------------------------------------------------
// CREDITS.md
// ---------------------------------------------------------------------------------------------
const SRC_NAME = {
  procedural: 'eigener Generator', video: 'eigene Video-Vorlage (entzerrt)', derived: 'eigener Generator (abgeleitet)',
};
const GEN_FILE = { textures: '`tools/assets/lib/eigen-gen.mjs` / `vorlage-gen.mjs`', hdris: '`tools/assets/skygen.py`', models: '`tools/assets/lib/eigen-models.mjs`' };
const line = (kind) => (e) => `| \`${e.id}\` | ${SRC_NAME[e.source] || e.source} | ${e.source === 'video' ? '`tools/assets/video_material.py`' : GEN_FILE[kind]} |`;
const table = (rows) => ['| ID | Herkunft | Werkzeug |', '|---|---|---|', ...rows].join('\n');
const credits = `# Danksagungen & Lizenzen

Seit 16.10. sind alle Texturen, Himmel (Umgebungslicht) und Requisiten-Modelle von NULLPUNKT **selbst erzeugt**:
Texturen über eigene Generatoren (Höhenfeld → Albedo/Normalen/ORM, kachelbar), Himmel über einen eigenen
Atmosphären- und Wolkenrechner (je Tageszeit × Wetterlage), Modelle aus eigenen Grundkörpern mit eigenen Texturen.
Die früher genutzten Fremd-Assets (Poly Haven, ambientCG) sind vollständig ersetzt und nicht mehr im Spiel.
Die Dateien in \`assets/lib/\` sind KTX2/Basis Universal kodiert, Modelle mit Meshopt und LOD-Stufen.
Liste mit Generator-Schlüsseln: \`tools/assets/sources.json\`, Pipeline: \`tools/assets/\`.

## Texturen (${src.textures.length})

${table(src.textures.map(line('textures')))}

## Himmel (${src.hdris.length})

${table(src.hdris.map(line('hdris')))}

## Modelle (${src.models.length})

${table(src.models.map(line('models')))}

## Klänge

Die aufgenommenen Klänge unter \`assets/lib/audio/\` (ebenfalls CC0: The Free Firearm Sound Library, Freesound,
Kenney) sind mit Quelle, Urheber:in und Lizenz je Datei in [docs/AUDIO_SOURCES.md](docs/AUDIO_SOURCES.md) aufgeführt.

## Software

| Bibliothek | Verwendung | Lizenz |
|---|---|---|
| [three.js](https://threejs.org) r186 (inkl. GLTFLoader, KTX2Loader, HDRLoader) | Rendering, Laden | MIT |
| [Basis Universal](https://github.com/BinomialLLC/basis_universal) (Transcoder, \`assets/vendor/three/addons/libs/basis/\`) | KTX2-Transkodierung im Browser | Apache-2.0 |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) (Decoder) | Geometrie-Dekompression | MIT |
| [zstddec](https://github.com/donmccurdy/zstddec) / [ktx-parse](https://github.com/donmccurdy/ktx-parse) | KTX2-Superkompression / Container | MIT |
| [glTF Transform](https://gltf-transform.dev), [ktx2-encoder](https://github.com/gz65555/ktx2-encoder), [sharp](https://sharp.pixelplumbing.com) | nur Build-Pipeline (nicht ausgeliefert) | MIT / Apache-2.0 |
`;
writeFileSync(join(ROOT, 'CREDITS.md'), credits);

if (missing.length) log('fehlt:', missing.join(', '));
log(`je Stufe: ${Object.entries(manifest.totals.byTier).map(([t, b]) => `${t}: ${fmtBytes(b)}`).join(' · ')}`);
log(`manifest.json: ${manifest.totals.counts.textures} Texturen, ${manifest.totals.counts.hdris} HDRIs, ${manifest.totals.counts.models} Modelle — ${fmtBytes(manifest.totals.all.bytes)} in ${manifest.totals.all.files} Dateien${missing.length ? ` — fehlt: ${missing.length}` : ''}`);
for (const [id, m] of Object.entries(manifest.maps)) {
  log(`  ${id.padEnd(11)} ` + Object.entries(m.budget).map(([q, b]) => `${q}: ${fmtBytes(b.bytes)} / GPU ${fmtBytes(b.gpu.desktop)} (mobil ${fmtBytes(b.gpu.mobile)})`).join(' · '));
}
