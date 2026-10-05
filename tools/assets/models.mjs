// Poly-Haven-Modelle (glTF) → optimierte .glb je Stufe (512 / 1024 / 2048 Texturen).
// Schritte: dedup → prune → weld → (Maßstab korrigieren) → Requisiten: flatten + join (ein Draw Call je Material)
// → LOD0 auf Dreiecksbudget vereinfachen → LOD1/LOD2 als Geschwisterknoten (Szene: LOD0, LOD1, LOD2 — loader.js
// baut daraus ein THREE.LOD) → Texturen verkleinern + KTX2 (KHR_texture_basisu; ORM in halber Größe)
// → Meshopt (Umsortieren, Quantisierung KHR_mesh_quantization, EXT_meshopt_compression) → GLB.
// Baukästen (kit: true) behalten ihre benannten Teile ohne LOD-Kette, Waffen (weapon: true) ihre Teile mit LODs.
// Aufruf: node tools/assets/models.mjs [ids…] [--force]
import { existsSync, readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, flatten, getBounds, join, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { download, ensureDir, gpuBytes, hash, loadSources, log, META, OUT, parseArgs, PIPELINE_VERSION, readJSON, rel, SRC, writeFileAtomic, writeJSON } from './lib/common.mjs';
import { encodeKTX2, ktx2Info, loadRGBA, renormalize } from './lib/ktx.mjs';
import { fetchModel, phFiles } from './lib/sources.mjs';
import sharp from 'sharp';

const args = parseArgs();
const src = loadSources();
const byId = Object.fromEntries(src.models.map((t) => [t.id, t]));
const ids = args._.length ? args._ : src.models.map((t) => t.id);

// Handy-Stufe (512) ohne die volle Geometrie: LOD1/LOD2 rücken auf (gilt nicht für Waffen und Baukästen)
const shiftLow = (e) => !e.kit && !e.weapon;
// Requisiten zu einem Draw Call je Material verschmelzen (Teilenamen entfallen); Waffen/Baukästen/keepParts nicht
const joinParts = (e) => !e.kit && !e.weapon && !e.keepParts;
// Texeldichte: Kleinteile (größte Kante < 0,5 m) haben schon bei 512² > 1000 px/m — keine 1024er-Stufe.
// Die 2048er-Stufe gibt es nur für Waffen (Viewmodel, Ultra).
const MIN_DIM_1024 = 0.5;
function tiersFor(e) {
  const dim = Math.max(...(e.dimensionsM || [1]));
  return e.tiers.filter((t) => t <= 512 || (t <= 1024 ? e.weapon || e.kit || dim >= MIN_DIM_1024 : e.weapon));
}
// ORM (AO/Rauheit/Metall) ist niederfrequent → halbe Kantenlänge (¼ Speicher), außer bei Waffen (Nahansicht)
const ormSize = (e, tier) => (e.weapon ? tier : tier / 2);

const recipe = (e, matfix, vcol) => hash({ v: PIPELINE_VERSION, e: { id: e.id, s: e.sourceId, tiers: tiersFor(e), b: e.lod0Tris, kit: e.kit, w: e.weapon, sc: e.scale, kp: e.keepParts, ...(matfix ? { matfix: 4 } : {}), ...(vcol ? { vcol: 1 } : {}) }, k: 'm5' });
// Materialien, die three.js sonst als teures MeshPhysicalMaterial (+ Transmissions-Durchgang) anlegt, bzw. mit Alpha
const MATFIX_RE = /KHR_materials_(transmission|ior|specular|volume)|"BLEND"|"MASK"/;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const S = MeshoptSimplifier;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const LOD_RATIOS = [0.4, 0.14];   // LOD1, LOD2 relativ zu LOD0
const LOD_ERRORS = [0.01, 0.04];  // erlaubter Fehler relativ zur Ausdehnung des Modells (Baukästen: des Teils)
const LOD_MIN_GAIN = 0.8;         // eine LOD-Stufe muss ≤ 80 % der vorigen haben, sonst entfällt sie
const TARGET_SLACK = 1.35;        // Ziel gilt als erreicht bei ≤ 135 % der Wunschzahl

const primTris = (p) => Math.round((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3);
const meshTris = (mesh) => mesh.listPrimitives().reduce((s, p) => s + primTris(p), 0);
const treeTris = (node) => { let t = 0; node.traverse((n) => { if (n.getMesh()) t += meshTris(n.getMesh()); }); return t; };
const sceneTris = (scene) => scene.listChildren().reduce((s, n) => s + treeTris(n), 0);

/** Größter Maßstab der Weltmatrix eines Knotens. */
function worldScale(node) {
  const m = node.getWorldMatrix();
  return Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])) || 1;
}

/** Normalen + UV als Attributfeld für simplifyWithAttributes. */
function attrArray(prim) {
  const n = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
  const stride = (n ? 3 : 0) + (uv ? 2 : 0);
  if (!stride) return null;
  const count = prim.getAttribute('POSITION').getCount();
  const out = new Float32Array(count * stride), el = [];
  for (let i = 0; i < count; i++) {
    let o = i * stride;
    if (n) { n.getElement(i, el); out[o++] = el[0]; out[o++] = el[1]; out[o++] = el[2]; }
    if (uv) { uv.getElement(i, el); out[o++] = el[0]; out[o++] = el[1]; }
  }
  return { out, stride, weights: [...(n ? [0.5, 0.5, 0.5] : []), ...(uv ? [1, 1] : [])] };
}

/**
 * Primitive vereinfachen (in place). errAbs: erlaubter Fehler in lokalen Einheiten des Meshes. Stufen, bis das Ziel
 * (× TARGET_SLACK) erreicht ist: 1) Fehler ≤ errAbs, 2) ≤ 2,5·errAbs, 3) zusätzlich über Attributnähte hinweg
 * (Permissive; Normalen/UV gewichtet) — Scans und CAD-Modelle mit vielen UV-Inseln bleiben sonst hängen,
 * 4) „sloppy“ (nur wenn erlaubt, für ferne LODs). 'Prune' entfernt dabei Kleinteile unter der Fehlerschwelle.
 * → false, wenn vom Primitive nichts übrig bleibt
 */
function simplifyPrim(doc, prim, ratio, errAbs, { sloppy = false } = {}) {
  if (prim.getMode() !== 4) return true; // nur TRIANGLES
  const idx = prim.getIndices();
  const posAcc = prim.getAttribute('POSITION');
  if (!idx || !(posAcc.getArray() instanceof Float32Array)) return true;
  const pos = posAcc.getArray();
  const srcIdx = new Uint32Array(idx.getArray());
  const target = Math.max(3, Math.floor((ratio * srcIdx.length) / 3) * 3);
  if (target >= srcIdx.length) return true;
  const ok = target * TARGET_SLACK;
  const err = errAbs / (S.getScale(pos, 3) || 1);   // simplify() rechnet relativ zur Ausdehnung
  const flags = ['Prune'];
  let [dst] = S.simplify(srcIdx, pos, 3, target, err, flags);
  if (dst.length > ok) [dst] = S.simplify(srcIdx, pos, 3, target, err * 2.5, flags);
  if (dst.length > ok) {
    const a = attrArray(prim);
    if (a) { const [d] = S.simplifyWithAttributes(srcIdx, pos, 3, a.out, a.stride, a.weights, null, target, err * 2.5, [...flags, 'Permissive']); if (d.length < dst.length) dst = d; }
  }
  if (dst.length > ok && sloppy) { const [d] = S.simplifySloppy(srcIdx, pos, 3, null, target, err * 4); if (d.length && d.length < dst.length) dst = d; }
  if (!dst.length) return false;
  const acc = doc.createAccessor(idx.getName()).setType('SCALAR').setArray(dst).setBuffer(idx.getBuffer());
  prim.setIndices(acc);
  if (idx.listParents().length === 1) idx.dispose();
  compactPrimitive(prim);
  if (prim.getAttribute('POSITION').getCount() <= 65534) prim.getIndices().setArray(new Uint16Array(prim.getIndices().getArray()));
  return true;
}

/** Alle Meshes unter node vereinfachen. relErr bezogen auf extent (Modell) bzw. — bei perPart — auf jedes Primitive. */
function simplifyTree(doc, node, ratio, relErr, extent, { perPart = false, sloppy = false } = {}) {
  node.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    const ws = worldScale(n);
    for (const p of mesh.listPrimitives()) {
      const errAbs = perPart ? relErr * (S.getScale(p.getAttribute('POSITION').getArray(), 3) || 1) : (relErr * extent) / ws;
      if (!simplifyPrim(doc, p, ratio, errAbs, { sloppy })) { mesh.removePrimitive(p); p.dispose(); }
    }
    if (!mesh.listPrimitives().length) n.setMesh(null);
  });
}

/** Knoten samt Meshes (Primitive geklont) kopieren. */
function cloneTree(doc, node, suffix) {
  const n = doc.createNode(node.getName() + suffix).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
  const mesh = node.getMesh();
  if (mesh) {
    const m = doc.createMesh(mesh.getName() + suffix);
    for (const p of mesh.listPrimitives()) m.addPrimitive(p.clone());
    n.setMesh(m);
  }
  for (const c of node.listChildren()) n.addChild(cloneTree(doc, c, suffix));
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

/**
 * Alpha nachrüsten: Poly Havens glTF-Export (JPG) verliert Deckkraftkarten — Maschendraht, Lüftergitter, Glas und
 * Blätter kämen sonst als schwarze/undurchsichtige Flächen an. Die Karte <präfix>_alpha|_opacity aus der Dateiliste
 * wird als Alphakanal in die Grundfarbe gepackt (PNG → später KTX2 mit Alpha). Gitter/Blätter → MASK (alphaTest 0,5,
 * keine Sortierung), Glas und dünner Maschendraht (Deckung < 35 %) → BLEND. Fehlerfall des Exports „Deckkraft als Grundfarbe“ (exterior_aircon_unit):
 * Farbe aus <Materialname>_diff, Alpha aus dem bisherigen Bild. → Set der korrigierten Materialien
 */
async function applyAlphaMaps(doc, e, res) {
  const fixed = new Set();
  const files = await phFiles(e.sourceId);
  const strip = (str) => (str.toLowerCase().startsWith(e.sourceId.toLowerCase()) ? str.slice(e.sourceId.length).replace(/^_/, '') : str);
  const fetchMap = async (key) => {
    const f = files[key]?.[res]?.jpg || files[key]?.[res]?.png;
    if (!f) return null;
    const dir = ensureDir(pjoin(SRC, 'models', e.id, res, 'alpha'));
    return readFileSync(await download(f.url, pjoin(dir, f.url.split('/').pop()), { md5: f.md5 }));
  };
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getAlphaMode() === 'OPAQUE' || m.getExtension('KHR_materials_transmission')) continue;
    const tex = m.getBaseColorTexture();
    if (!tex || (await sharp(tex.getImage()).metadata()).hasAlpha) continue;
    const uri = (tex.getURI() || '').split('/').pop();
    const key = strip(uri.replace(/\.(jpe?g|png)$/i, '').replace(new RegExp(`_${res}$`), ''));   // wire_diff | 01_opacity | diff
    const prefix = key.replace(/_?(diff|opacity|alpha)$/, '');
    const k = (name) => (prefix ? `${prefix}_${name}` : name);
    let color = tex.getImage(), alpha;
    if (/(^|_)(opacity|alpha)$/.test(key)) {
      color = await fetchMap(`${strip(m.getName())}_diff`) || await fetchMap(k('diff'));
      alpha = tex.getImage();
      if (!color) { log('  ! Alpha:', e.id, m.getName(), 'keine Farbkarte'); continue; }
    } else {
      alpha = await fetchMap(k('alpha')) || await fetchMap(k('opacity'));
      if (!alpha) continue;
    }
    const { width, height } = await sharp(color).metadata();
    const rgb = await sharp(color).removeAlpha().toColourspace('srgb').raw().toBuffer();
    const a = await sharp(alpha).resize(width, height, { fit: 'fill' }).toColourspace('b-w').raw().toBuffer();
    const png = await sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(a, { raw: { width, height, channels: 1 } }).png().toBuffer();
    // eigene Textur (das Farbbild kann von undurchsichtigen Materialien mitbenutzt werden)
    const t2 = doc.createTexture(tex.getName()).setImage(png).setMimeType('image/png').setURI(uri.replace(/\.(jpe?g|png)$/i, '_rgba.png'));
    m.setBaseColorTexture(t2);
    // Dünne Strukturen (Maschendraht: wenig Deckung) verschwänden mit MASK in den kleineren Mip-Stufen (gemittelte
    // Deckkraft < Schwelle) — dort BLEND, das in der Ferne korrekt als feiner Schleier erscheint.
    let cover = 0; for (let i = 0; i < a.length; i++) cover += a[i];
    cover /= a.length * 255;
    const blend = /glass/i.test(m.getName()) || cover < 0.35;
    m.setAlphaMode(blend ? 'BLEND' : 'MASK');
    if (!blend) m.setAlphaCutoff(0.5);
    fixed.add(m);
  }
  return fixed;
}

const extentOf = (b) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;

async function processTier(e, tier) {
  const res = tier >= 2048 ? '2k' : '1k';
  const gltfPath = await fetchModel(e, res);
  const doc = await io.read(gltfPath);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  // Scan-/Export-Reste: Vertexfarben (rock_07, weed_plant_02, television_01, old_bed_frame) würden die Grundfarbe
  // abdunkeln (three schaltet vertexColors ein) — bei texturierten Materialien entfernen. Spart zudem Speicher.
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    if (!p.getMaterial()?.getBaseColorTexture()) continue;
    for (const sem of p.listSemantics()) if (/^COLOR_\d+$/.test(sem)) p.setAttribute(sem, null);
  }
  await doc.transform(dedup(), prune(), weld());
  // Maßstabsfehler der Quelle (z. B. steel_frame_shelves_01: ×10) — als Knotentransformation
  if (e.scale && e.scale !== 1) for (const n of scene.listChildren()) n.setScale(n.getScale().map((s) => s * e.scale)).setTranslation(n.getTranslation().map((t) => t * e.scale));
  if (joinParts(e)) await doc.transform(flatten(), join(), prune());
  const srcTris = sceneTris(scene);
  const extent = extentOf(getBounds(scene));

  // LOD0-Budget
  if (e.lod0Tris && srcTris > e.lod0Tris) {
    const ratio = e.lod0Tris / srcTris;
    const err = ratio < 0.15 ? 0.02 : ratio < 0.4 ? 0.008 : 0.003;
    for (const n of scene.listChildren()) simplifyTree(doc, n, ratio, err, extent, { perPart: !!e.kit });
  }
  await doc.transform(prune());
  const lod0Tris = sceneTris(scene);
  const b0 = getBounds(scene);
  const radius = Math.hypot(b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]) / 2;
  const fullDist = [0, +Math.max(6, radius * 14).toFixed(1), +Math.max(16, radius * 40).toFixed(1)];
  let parts = [];
  let lods = [{ tris: lod0Tris, dist: 0, level: 0 }];
  let lodShift = false;
  const children = scene.listChildren();
  if (!e.kit) {
    const lod0 = doc.createNode('LOD0');
    for (const c of children) { scene.removeChild(c); lod0.addChild(c); }
    scene.addChild(lod0);
    const levels = [lod0];
    LOD_RATIOS.forEach((ratio, i) => {
      const lod = doc.createNode(`LOD${i + 1}`);
      for (const c of lod0.listChildren()) lod.addChild(cloneTree(doc, c, `_LOD${i + 1}`));
      simplifyTree(doc, lod, ratio, LOD_ERRORS[i], extent, { sloppy: i === LOD_RATIOS.length - 1 });
      scene.addChild(lod);
      levels.push(lod);
      lods.push({ tris: treeTris(lod), dist: fullDist[i + 1], level: i + 1 });
    });
    // Stufen ohne nennenswerte Ersparnis verwerfen (sonst lädt das Handy zweimal fast dieselbe Geometrie)
    for (let i = 1; i < levels.length; i++) {
      const prev = lods[i - 1];
      if (lods[i].tris > prev.tris * LOD_MIN_GAIN) {
        scene.removeChild(levels[i]); levels[i].traverse((n) => n.getMesh()?.dispose()); levels[i].dispose();
        levels.splice(i, 1); lods.splice(i, 1); i--;
      }
    }
    for (const c of lod0.listChildren()) parts.push(c.getName());
    if (tier <= 512 && shiftLow(e) && lods[1]?.level === 1) {
      // volle Geometrie verwerfen, LOD1 → LOD0, LOD2 → LOD1 (Teilenamen bleiben über das Suffix auffindbar).
      // Nur wenn LOD1 echt vereinfacht wurde — sonst sähe das Handy aus der Nähe das grobe LOD2.
      scene.removeChild(lod0);
      lod0.dispose();
      levels.shift();
      lods.shift();
      lods = lods.map((l, i) => ({ ...l, dist: i === 0 ? 0 : l.dist }));
      lodShift = true;
    }
    levels.forEach((n, i) => n.setName(`LOD${i}`));
  } else {
    for (const c of children) parts.push(c.getName());
  }
  await doc.transform(prune());

  // Spieltaugliche Materialien: Glas ohne Transmission (einfach transparent), keine IOR/Specular-Erweiterungen
  // (→ MeshStandardMaterial statt MeshPhysicalMaterial); BLEND ohne echte Transparenz (JPG ohne Alpha) → OPAQUE
  const alphaFixed = await applyAlphaMaps(doc, e, res);
  for (const m of root.listMaterials()) {
    if (alphaFixed.has(m)) continue;
    const glass = !!m.getExtension('KHR_materials_transmission');
    for (const ext of ['KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_volume']) m.setExtension(ext, null);
    const f = m.getBaseColorFactor();
    const bt = m.getBaseColorTexture();
    const texAlpha = !!bt && !!(await sharp(bt.getImage()).metadata()).hasAlpha;
    if (glass) { m.setAlphaMode('BLEND'); m.setBaseColorFactor([f[0], f[1], f[2], Math.min(f[3], 0.3)]); m.setRoughnessFactor(Math.min(m.getRoughnessFactor(), 0.15)); }
    // BLEND/MASK ohne echte Transparenz (JPG ohne Alpha, Faktor 1) → OPAQUE: kein Sortieren, kein discard (früher Z-Test)
    else if (m.getAlphaMode() !== 'OPAQUE' && f[3] >= 0.99 && !texAlpha) m.setAlphaMode('OPAQUE');
  }
  for (const ext of root.listExtensionsUsed()) if (/^KHR_materials_(transmission|ior|specular|volume)$/.test(ext.extensionName)) ext.dispose();

  // AO: Poly Haven packt ARM (AO/Rauheit/Metall) in eine Textur, verweist aber nur als metallicRoughness darauf.
  // Manche Modelle haben keine gebackene AO (R ≈ 0: Rinne, Lüftungsrohr, Feuerleiter, Mülltonne) — dort keine aoMap,
  // sonst wäre das Modell im reinen Umgebungslicht schwarz.
  for (const m of root.listMaterials()) {
    const mr = m.getMetallicRoughnessTexture();
    if (mr && !m.getOcclusionTexture() && /_arm(_|\.)/.test(mr.getURI() || mr.getName() || '') && (await sharp(mr.getImage()).stats()).channels[0].mean >= 25) {
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
    const want = role === 'orm' ? ormSize(e, tier) : tier;
    const size = Math.min(want, meta.width || want);
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
  const file = pjoin(ensureDir(pjoin(OUT, 'models', e.id)), `${e.id}_${tier}.glb`);
  writeFileAtomic(file, glb);
  const gpu = texMeta.reduce((g, t) => ({ desktop: g.desktop + t.gpu.desktop, mobile: g.mobile + t.gpu.mobile, rgba8: g.rgba8 + t.gpu.rgba8 }), { desktop: geomBytes, mobile: geomBytes, rgba8: geomBytes });
  return {
    path: rel(file).replace(/^assets\/lib\//, ''), bytes: glb.length, srcTris, lods: lods.map((l) => ({ tris: l.tris, level: l.level })), parts, lodShift,
    lodDistances: e.kit ? null : lods.map((l) => l.dist), fullLodDistances: fullDist,
    bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) },
    textures: texMeta, geometryBytes: geomBytes, gpu,
    materials: root.listMaterials().map((m) => ({ name: m.getName(), alphaMode: m.getAlphaMode(), doubleSided: m.getDoubleSided() })),
  };
}

async function build(e) {
  const metaFile = pjoin(META, 'models', `${e.id}.json`);
  const gltfText = readFileSync(await fetchModel(e, '1k'), 'utf8');
  const r = recipe(e, MATFIX_RE.test(gltfText), /"COLOR_0"/.test(gltfText));
  const old = readJSON(metaFile, null);
  if (!args.force && old?.recipe === r && Object.values(old.tiers).every((t) => existsSync(pjoin(OUT, t.path)))) { log('✓', e.id, '(aktuell)'); return; }
  const t0 = Date.now();
  const tiers = {};
  for (const tier of tiersFor(e)) tiers[tier] = await processTier(e, tier);
  const any = tiers[tiersFor(e)[0]];
  const size = any.bounds.max.map((v, i) => +(v - any.bounds.min[i]).toFixed(3));
  const radius = Math.hypot(...size) / 2;
  const lodDistances = e.kit ? null : Object.values(tiers).find((t) => !t.lodShift)?.lodDistances || any.fullLodDistances;
  for (const t of Object.values(tiers)) delete t.fullLodDistances;
  // Dateien früherer Rezepte (z. B. entfallene Stufen) entfernen
  const { readdirSync, unlinkSync } = await import('node:fs');
  const keep = new Set(Object.values(tiers).map((t) => t.path.split('/').pop()));
  for (const f of readdirSync(pjoin(OUT, 'models', e.id))) if (!keep.has(f)) unlinkSync(pjoin(OUT, 'models', e.id, f));
  writeJSON(metaFile, { id: e.id, recipe: r, size, radius: +radius.toFixed(3), lodDistances, tiers });
  log('✔', e.id, `${any.srcTris}→${Object.entries(tiers).map(([k, v]) => `${k}:${v.lods.map((l) => l.tris).join('/')}`).join(' ')} tris`, Object.entries(tiers).map(([k, v]) => `${k}:${(v.bytes / 1024).toFixed(0)}K`).join(' '), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

for (const id of ids) {
  const e = byId[id];
  if (!e) { log('unbekannt', id); continue; }
  try { await build(e); } catch (err) { log('✗', id, err.stack || err.message); process.exitCode = 1; }
}
