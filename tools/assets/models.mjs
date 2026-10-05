// Poly-Haven-Modelle (glTF) → optimierte .glb je Stufe (512 / 1024 / 2048 Texturen).
// Schritte: dedup → prune → weld → (LOD0 auf Dreiecksbudget vereinfachen) → LOD1/LOD2 als Geschwisterknoten
// (Szene: LOD0, LOD1, LOD2 — loader.js baut daraus ein THREE.LOD) → Texturen verkleinern + KTX2 (KHR_texture_basisu)
// → Meshopt (Umsortieren, Quantisierung KHR_mesh_quantization, EXT_meshopt_compression) → GLB.
// Baukästen (kit: true) behalten ihre benannten Teile ohne LOD-Kette.
// Aufruf: node tools/assets/models.mjs [ids…] [--force]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, getBounds, meshopt, prune, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { ensureDir, fileSize, gpuBytes, hash, loadSources, log, META, OUT, parseArgs, PIPELINE_VERSION, readJSON, rel, writeFileAtomic, writeJSON } from './lib/common.mjs';
import { encodeKTX2, ktx2Info, loadRGBA, renormalize } from './lib/ktx.mjs';
import { fetchModel } from './lib/sources.mjs';
import sharp from 'sharp';

const args = parseArgs();
const src = loadSources();
const byId = Object.fromEntries(src.models.map((t) => [t.id, t]));
const ids = args._.length ? args._ : src.models.map((t) => t.id);
// Handy-Stufe (512) ohne die volle Geometrie: LOD1/LOD2 rücken auf (gilt nicht für Waffen und Baukästen)
const shiftLow = (e) => !e.kit && !e.weapon;
const recipe = (e) => hash({ v: PIPELINE_VERSION, e: { id: e.id, s: e.sourceId, tiers: e.tiers, b: e.lod0Tris, kit: e.kit, ...(shiftLow(e) ? { low: 1 } : {}) }, k: 'm3' });

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const LOD_RATIOS = [0.4, 0.14];   // LOD1, LOD2 relativ zu LOD0
const LOD_ERRORS = [0.01, 0.04];  // erlaubter Fehler relativ zur Ausdehnung

const triCount = (doc) => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return Math.round(n);
};
const meshTris = (mesh) => Math.round(mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0));

/** Mesh kopieren (Primitive klonen) und vereinfachen. */
function simplifiedMesh(doc, mesh, ratio, error) {
  const out = doc.createMesh(mesh.getName() + '_lod');
  for (const prim of mesh.listPrimitives()) {
    const p = prim.clone();
    simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
    out.addPrimitive(p);
  }
  return out;
}

function cloneTree(doc, node, ratio, error, suffix) {
  const n = doc.createNode(node.getName() + suffix).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
  const mesh = node.getMesh();
  if (mesh) n.setMesh(simplifiedMesh(doc, mesh, ratio, error));
  for (const c of node.listChildren()) n.addChild(cloneTree(doc, c, ratio, error, suffix));
  return n;
}

/** Welche Rolle hat eine Textur? albedo | normal | orm */
function textureRoles(doc) {
  const roles = new Map();
  for (const m of doc.getRoot().listMaterials()) {
    const set = (t, r) => { if (t) roles.set(t, roles.get(t) === 'albedo' ? 'albedo' : r); };
    set(m.getBaseColorTexture(), 'albedo');
    set(m.getEmissiveTexture(), 'albedo');
    set(m.getNormalTexture(), 'normal');
    set(m.getMetallicRoughnessTexture(), 'orm');
    set(m.getOcclusionTexture(), 'orm');
  }
  return roles;
}

async function processTier(e, tier) {
  const res = tier >= 2048 ? '2k' : '1k';
  const gltfPath = await fetchModel(e, res);
  const doc = await io.read(gltfPath);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  await doc.transform(dedup(), prune(), weld());
  const srcTris = triCount(doc);

  // LOD0-Budget
  let lod0Ratio = 1;
  if (e.lod0Tris && srcTris > e.lod0Tris) {
    lod0Ratio = e.lod0Tris / srcTris;
    const err = lod0Ratio < 0.15 ? 0.02 : lod0Ratio < 0.4 ? 0.008 : 0.003;
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: lod0Ratio, error: err, lockBorder: false });
  }
  const lod0Tris = triCount(doc);
  const parts = [];
  const lods = [{ tris: lod0Tris }];
  const children = scene.listChildren();
  if (!e.kit) {
    const lod0 = doc.createNode('LOD0');
    for (const c of children) { scene.removeChild(c); lod0.addChild(c); }
    scene.addChild(lod0);
    LOD_RATIOS.forEach((ratio, i) => {
      const lod = doc.createNode(`LOD${i + 1}`);
      for (const c of lod0.listChildren()) lod.addChild(cloneTree(doc, c, ratio, LOD_ERRORS[i], `_LOD${i + 1}`));
      scene.addChild(lod);
      let t = 0; lod.traverse((n) => { if (n.getMesh()) t += meshTris(n.getMesh()); });
      lods.push({ tris: t });
    });
    for (const c of lod0.listChildren()) parts.push(c.getName());
    if (tier <= 512 && shiftLow(e)) {
      // volle Geometrie verwerfen, LOD1 → LOD0, LOD2 → LOD1 (Teilenamen bleiben über das Suffix auffindbar)
      scene.removeChild(lod0);
      lod0.dispose();
      const rest = scene.listChildren().filter((n) => /^LOD\d$/.test(n.getName()));
      rest.forEach((n, i) => n.setName(`LOD${i}`));
      lods.shift();
      lods.shifted = true;
    }
  } else {
    for (const c of children) parts.push(c.getName());
  }

  // AO: Poly Haven packt ARM (AO/Rauheit/Metall) in eine Textur, verweist aber nur als metallicRoughness darauf
  for (const m of root.listMaterials()) {
    const mr = m.getMetallicRoughnessTexture();
    if (mr && !m.getOcclusionTexture() && /_arm(_|\.)/.test(mr.getURI() || mr.getName() || '')) {
      m.setOcclusionTexture(mr);
      m.getOcclusionTextureInfo().setTexCoord(m.getMetallicRoughnessTextureInfo().getTexCoord());
    }
  }

  // Texturen → KTX2
  const roles = textureRoles(doc);
  const texMeta = [];
  for (const tex of root.listTextures()) {
    const role = roles.get(tex) || 'albedo';
    const img = tex.getImage();
    const meta = await sharp(img).metadata();
    const size = Math.min(tier, meta.width || tier);
    const h = Math.round(size * (meta.height || size) / (meta.width || size));
    let rgba = await loadRGBA(img, size, h);
    if (role === 'normal') rgba = renormalize(rgba);
    const hasAlpha = role === 'albedo' && meta.hasAlpha && root.listMaterials().some((m) => m.getBaseColorTexture() === tex && m.getAlphaMode() !== 'OPAQUE');
    if (!hasAlpha) for (let i = 3; i < rgba.data.length; i += 4) rgba.data[i] = 255;
    const bytes = await encodeKTX2(rgba, role, tier);
    const info = ktx2Info(bytes);
    tex.setImage(bytes).setMimeType('image/ktx2').setURI((tex.getURI() || 'tex').replace(/\.(jpe?g|png)$/i, '.ktx2').split('/').pop());
    texMeta.push({ name: tex.getURI(), role, width: info.width, height: info.height, codec: info.codec, bytes: bytes.length, gpu: gpuBytes(info.width, info.height, { codec: info.codec, alpha: hasAlpha }) });
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);

  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));

  // Geometrie-Speicher (dekodiert = quantisierte Accessoren)
  let geomBytes = 0;
  for (const a of root.listAccessors()) geomBytes += a.getArray()?.byteLength || 0;
  const b = getBounds(scene);
  const glb = await io.writeBinary(doc);
  const file = join(ensureDir(join(OUT, 'models', e.id)), `${e.id}_${tier}.glb`);
  writeFileAtomic(file, glb);
  const gpu = texMeta.reduce((g, t) => ({ desktop: g.desktop + t.gpu.desktop, mobile: g.mobile + t.gpu.mobile, rgba8: g.rgba8 + t.gpu.rgba8 }), { desktop: geomBytes, mobile: geomBytes, rgba8: geomBytes });
  return {
    path: rel(file).replace(/^assets\/lib\//, ''), bytes: glb.length, srcTris, lods, parts, lodShift: !!lods.shifted,
    bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) },
    textures: texMeta, geometryBytes: geomBytes, gpu,
    materials: root.listMaterials().map((m) => ({ name: m.getName(), alphaMode: m.getAlphaMode(), doubleSided: m.getDoubleSided() })),
  };
}

async function build(e) {
  const metaFile = join(META, 'models', `${e.id}.json`);
  const r = recipe(e);
  const old = readJSON(metaFile, null);
  if (!args.force && old?.recipe === r && Object.values(old.tiers).every((t) => existsSync(join(OUT, t.path)))) { log('✓', e.id, '(aktuell)'); return; }
  const t0 = Date.now();
  const tiers = {};
  for (const tier of e.tiers) tiers[tier] = await processTier(e, tier);
  const any = tiers[e.tiers[0]];
  const size = any.bounds.max.map((v, i) => +(v - any.bounds.min[i]).toFixed(3));
  const radius = Math.hypot(...size) / 2;
  const lodDistances = e.kit ? null : [0, +Math.max(6, radius * 14).toFixed(1), +Math.max(16, radius * 40).toFixed(1)];
  // verschobene Handy-Stufe: ihr LOD1 (= früheres LOD2) erst ab dem LOD2-Abstand
  for (const t of Object.values(tiers)) t.lodDistances = e.kit ? null : t.lodShift ? [0, lodDistances[2]] : lodDistances;
  writeJSON(metaFile, { id: e.id, recipe: r, size, radius: +radius.toFixed(3), lodDistances, tiers });
  log('✔', e.id, `${any.srcTris}→${any.lods.map((l) => l.tris).join('/')} tris`, Object.entries(tiers).map(([k, v]) => `${k}:${(v.bytes / 1024).toFixed(0)}K`).join(' '), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

for (const id of ids) {
  const e = byId[id];
  if (!e) { log('unbekannt', id); continue; }
  try { await build(e); } catch (err) { log('✗', id, err.stack || err.message); process.exitCode = 1; }
}
