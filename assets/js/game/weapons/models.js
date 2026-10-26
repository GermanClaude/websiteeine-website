// NULLPUNKT – prozedurale Waffenmodelle (Ego-Ansicht, Bots, Arsenal-Vitrine der Website).
// Eigenständig nutzbar mit reinem three.js (keine Abhängigkeit von G oder der Spiel-Laufzeit).
//
// createWeaponModel(key, { lod: 'first' | 'third' | 'showcase', camo }) → THREE.Group (camo = Muster-Id aus CAMOS)
//   Koordinaten: Meter, +Y oben, Lauf zeigt nach −Z, Ursprung = Mitte des Pistolengriffs (rechte Hand).
//   'showcase': zentriert im Ursprung, längste Kante = 1 Einheit (für Drehteller).
//   group.userData = {
//     key, lod, muzzle, ejection, magazine, sight, leftHandGrip, rightHandGrip, adsOffset (Vector3),
//     magFill, rounds, follower (Magazininhalt, siehe gunsmith/magfill.js setMagRounds),
//     parts: { mag, bolt, charge, pump, slide, boltHandle, hammer, cover, belt, pin, spoon, … } (nur vorhandene),
//     anchors: { chargeGrab, magGrab, magWell, trigger, … }, info: { sight, kind, triangles, meshes, size, axis,
//       contactQuant (Raster des Kontaktgitters, b.meta) }
//   }
//   adsOffset = Position der Gruppe im Kameraraum (Kamera im Ursprung, Blick −Z), bei der das Visier exakt
//   auf der optischen Achse liegt (inkl. Augenabstand der Visierung).
import * as THREE from 'three';
import { Builder, DETAIL, clearPartCache, setWeaponDetail as setDetail } from './gunsmith/builder.js';
import { sk14 } from './gunsmith/guns-ar.js';
import { kv47 } from './gunsmith/guns-kv47.js';
import { m17 } from './gunsmith/guns-m17.js';
import { hm60 } from './gunsmith/guns-auto.js';
import { vp9 } from './gunsmith/guns-vp9.js';   // VP-9 nach Foto (24.10.)
import { qx90 } from './gunsmith/guns-qx90.js';   // QX-90 nach Foto (25.10.)
import { brecher, bulldog } from './gunsmith/guns-long.js';
import { zwilling } from './gunsmith/guns-zwilling.js';   // ZW-12 Zwilling (Doppelflinte mit Kipplauf, 26.10.)
import { p9 } from './gunsmith/guns-pistol.js';
import { adler } from './gunsmith/guns-adler.js';   // Adler nach Foto (25.10.)
import { knife, frag, semtex } from './gunsmith/gear.js';
import { k36, bx20, g7, wespe, keiler, lm8 } from './gunsmith/guns-wave2.js';
import { titan, hagel, kobra, donner, rocket, hammer, trommel } from './gunsmith/guns-heavy.js';
import { karambit, machete, tomahawk, kampfaxt, schlagstock, kampfstock, spaten, flash, smoke, impact, molotov, plate } from './gunsmith/gear2.js';
import { applyCamo, disposeCamos, disposeCamosFor } from './gunsmith/camos.js';
export { setMagRounds } from './gunsmith/magfill.js';
import { disposeMaterials, freeAtlasMaterials } from './gunsmith/materials.js';
import { disposeTextures } from './gunsmith/textures.js';
import { magFillFor, attachMagFill, disposeMagFill } from './gunsmith/magfill.js';
import { attachToBuilder, attachToRoot } from './gunsmith/attach.js';
import { OPTIC_TYPE } from './gunsmith/parts.js';
import { attKey } from '../../shared/attachments.data.js';
import { ursprung, funke, erstlicht } from './gunsmith/guns-og.js';

const BUILDERS = {
  zwilling, // neue Waffe (26.10.): ZW-12 Zwilling
  kv47, m17, vp9, qx90, hm60, sk14, brecher, bulldog, p9, adler, knife, frag, semtex,
  k36, bx20, g7, wespe, keiler, lm8, titan, hagel, kobra, donner, hammer, trommel,
  karambit, machete, tomahawk, kampfaxt, schlagstock, kampfstock, spaten, flash, smoke, impact, molotov, plate, rocket,
  ursprung, funke, erstlicht, // Waffen der ersten Stunde (guns-og.js)
};

export const MODEL_KEYS = Object.keys(BUILDERS);
export const GUN_KEYS = ['kv47', 'm17', 'vp9', 'qx90', 'hm60', 'sk14', 'brecher', 'bulldog', 'p9', 'adler',
  'k36', 'bx20', 'g7', 'wespe', 'keiler', 'lm8', 'titan', 'hagel', 'kobra', 'donner', 'hammer', 'trommel', 'ursprung', 'funke'];
GUN_KEYS.push('zwilling');   // neue Waffe (26.10.)
export const MELEE_KEYS = ['knife', 'karambit', 'machete', 'tomahawk', 'kampfaxt', 'schlagstock', 'kampfstock', 'spaten', 'erstlicht'];
export const THROWABLE_KEYS = ['frag', 'semtex', 'impact', 'molotov', 'flash', 'smoke'];
export { applyCamo };

const REF_NAMES = ['muzzle', 'ejection', 'sight', 'leftHandGrip', 'rightHandGrip'];
const ANCHOR_NAMES = ['chargeGrab', 'magGrab', 'magWell', 'trigger', 'pumpGrab', 'boltGrab', 'pinGrab', 'shellPort', 'slideGrab', 'boltCatch',
  'loaderGrab', 'cylGrab', 'ejectorGrab', 'rocketGrab', 'boltFace',
  'muzzle2', 'barrelGrab', 'chamberR', 'chamberL'];   // Kipplauf (26.10.): zweite Mündung, Vorderschaft, Patronenlager
const PART_NAMES = ['selector', 'dustCover', 'mag', 'bolt', 'charge', 'pump', 'slide', 'boltHandle', 'hammer', 'cover', 'belt', 'lid', 'pin', 'spoon', 'blade', 'shell', 'led',
  'crane', 'cylinder', 'ejector', 'loader', 'rocket',
  'barrels', 'toplever', 'extractor', 'shellR', 'shellL'];   // Kipplauf (26.10.): Läufe, Oberhebel, Auszieher, zwei Patronen

const cache = new Map();

/**
 * 24.10. (Vorarbeit V1): Detailstufe der Ego-Fassungen – 'max' (PC hoch/ultra), 'std' (PC niedrig/mittel), 'lite' (Touch);
 * Teil des Vorlagen-Schlüssels. Gehört vor jeden Vorbau (main.js: Start, Lobby-Leerlauf, Ladebildschirm) und zu jedem
 * Qualitätswechsel (main.js, Viewmodel) – bisher setzte sie erst das Viewmodel, ein PC auf niedrig/mittel baute M-17/P-9 davor
 * zusätzlich in max (≈ 5 s, ≈ 61 MB). → true bei Wechsel
 */
export function weaponDetailTier() { return DETAIL.max ? 'max' : DETAIL.lite ? 'lite' : 'std'; }
export function setWeaponDetail(quality) {
  const was = weaponDetailTier();
  setDetail(quality);
  return weaponDetailTier() !== was;
}

// 24.10. (V2): stufenunabhängige Metadaten je Modell – in allen Stufen gleich (geprüft für alle MODEL_KEYS: Bot-Stufe, max, std,
// lite; info.dustCover hängt an der Stufe und fehlt deshalb). Gefüllt aus der ersten Vorlage ohne Aufsätze, egal welcher Stufe.
const META_FIELDS = ['sight', 'kind', 'axis', 'leftGrip', 'selector'];
const metaCache = new Map();

function buildTemplate(key, lod, att = null, tier = null) {
  const make = BUILDERS[key];
  if (!make) throw new Error(`Unbekanntes Waffenmodell: ${key}`);
  const b = new Builder(lod === 'third' ? 'third' : 'first', lod === 'third' ? null : tier);
  b.key = key;   // Bauteil-Cache (b.shared): teure Netze je Modell × Stufe nur einmal, in allen Aufsatz-Varianten geteilt
  b.att = att;
  make(b);
  const leftGrip = (b.anchors.find((a) => a.name === 'leftHandGrip') || {}).data?.style || null;
  if (att) {
    const iron = !b._opticDone && att.optik && (b.meta.sight === 'iron' || b.meta.sight === 'none');
    attachToBuilder(b, att, iron ? mountFor(key, lod) : null);
    if (att.optik && b._opticDone) b.meta.sight = OPTIC_TYPE[att.optik] || b.meta.sight;
  }
  const root = b.build(key);
  if (att) attachToRoot(root, att, lod);
  // Magazininhalt (magfill.js): Patronen + Zubringer nur in Ego/Vitrine; die Plätze reisen in den Metadaten mit
  // (Weltmagazine der Bot-Detailstufe zeigen damit die obersten Patronen bzw. den leeren Zubringer)
  const magFill = magFillFor(b, key);
  if (magFill && lod !== 'third' && !(att && att.magazin === 'trommel')) attachMagFill(root, magFill); // Trommel: undurchsichtig
  // Fehlende Pflicht-Anker im Ursprung ergänzen (Messer/Granaten haben z. B. keine Mündung)
  for (const n of REF_NAMES) if (!root.getObjectByName(n)) { const o = new THREE.Object3D(); o.name = n; root.add(o); }
  for (const n of b.meta.hidden || []) { const o = root.getObjectByName(n); if (o) o.visible = false; }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const sight = root.getObjectByName('sight');
  const sp = sight.getWorldPosition(new THREE.Vector3());
  const eye = sight.userData.eyeRelief ?? 0.2;
  const meta = {
    key, lod,
    parts: PART_NAMES.filter(n => root.getObjectByName(n)),
    anchors: ANCHOR_NAMES.filter(n => root.getObjectByName(n)),
    adsOffset: [-sp.x, -sp.y, -eye - sp.z],
    magFill,
    info: {
      sight: b.meta.sight || 'none', kind: b.meta.kind || 'gear', axis: b.meta.axis ?? 0, leftGrip, selector: b.meta.selector || null, dustCover: b.meta.dustCover || null, contactQuant: b.meta.contactQuant || null,
      triangles: root.userData.stats.triangles, meshes: root.userData.stats.meshes,
      size: size.toArray(), center: box.getCenter(new THREE.Vector3()).toArray(), min: box.min.toArray(), max: box.max.toArray(),
    },
  };
  root.userData = { __meta: meta };
  return root;
}

function bindUserData(obj, meta, lookupRoot = obj) {
  const find = n => lookupRoot.getObjectByName(n);
  const ud = { key: meta.key, lod: meta.lod };
  for (const n of REF_NAMES) ud[n] = find(n);
  ud.magazine = find('mag') || find('shell') || find('blade') || lookupRoot;
  ud.adsOffset = new THREE.Vector3().fromArray(meta.adsOffset);
  ud.parts = {};
  for (const n of meta.parts) ud.parts[n] = find(n);
  ud.anchors = {};
  for (const n of meta.anchors) ud.anchors[n] = find(n);
  ud.info = { ...meta.info };
  ud.tpl = meta.tpl || null; // Vorlagen-Schlüssel (24.10., V5)
  // Magazininhalt: setMagRounds(model, n) zeigt n Patronen (magfill.js)
  if (meta.magFill) { ud.magFill = meta.magFill; ud.rounds = find('rounds') || null; ud.follower = find('follower') || null; }
  obj.userData = ud;
  return obj;
}

function cloneTemplate(tpl) {
  const meta = tpl.userData.__meta;
  tpl.userData = {};
  const c = tpl.clone(true);
  tpl.userData = { __meta: meta };
  return bindUserData(c, meta);
}

// Detailstufe einer Ego-Vorlage: fest vorgegeben ('max' | 'std' | 'lite', 24.10. V4) oder nach DETAIL (Grafikstufe)
const tierOf = (tier) => tier || weaponDetailTier();
const tplKey = (key, lod, ak, tier) => key + ':' + lod + (lod !== 'third' ? ({ max: ':max', lite: ':lite' }[tierOf(tier)] || '') : '') + (ak ? '|' + ak : '');

// 24.10. (V5): Aufsätze, die nur Werte ändern (Munition, Schaft, Schnellwechsel-Magazin), teilen sich die Vorlage ohne sie – vorher
// ein Komplettbau je Kombination (P-9 max + Hohlspitz = weitere 190 k Dreiecke). null = ganzer Platz. Zeichnet ein Bauplan oder
// attach.js einen davon einmal sichtbar, hier streichen. (Geprüft nach dem Bauteil-Cache V3: Baupläne/attach.js lesen nur optik,
// muendung, unterlauf, taktisch und magazin erweitert/trommel; der geteilte Block 'schaft' der M-17 ist der Werksschaft.)
const STAT_ONLY = { munition: null, schaft: null, magazin: new Set(['schnell']) };
function modelAtt(att) {
  if (!att) return att;
  let out = null;
  for (const [slot, vals] of Object.entries(STAT_ONLY)) {
    if (att[slot] && (vals === null || vals.has(att[slot]))) { out = out || { ...att }; delete out[slot]; }
  }
  if (!out) return att;
  return attKey(out) ? out : null;
}

function getTemplate(key, lod, att = null, tier = null) {
  att = modelAtt(att);
  const ak = attKey(att);
  const k = tplKey(key, lod, ak, tier);
  let t = cache.get(k);
  if (!t) {
    const t0 = performance.now();
    t = buildTemplate(key, lod, ak ? att : null, tier);
    t.userData.__meta.ms = performance.now() - t0; // Bauzeit (Hintergrund-Bau im Viewmodel schätzt damit, V5)
    t.userData.__meta.tpl = k; // Klone derselben Vorlage teilen ihr Kontaktgitter (viewmodel _entryCollider)
    cache.set(k, t);
    if (!ak && !metaCache.has(key)) { const i = t.userData.__meta.info, m = {}; for (const f of META_FIELDS) m[f] = i[f] ?? null; metaCache.set(key, m); }
  }
  return t;
}

/** Leichte Ego-Stufe des Geräts ('lite' am Handy, sonst 'std') – Vorbau ohne volle Fassung (Schießstand, Waffenspiel). */
export function lightTier() { return DETAIL.lite ? 'lite' : 'std'; }

/**
 * Ist die Vorlage schon gebaut (kein Bau-Hänger, createWeaponModel kostet nur einen Klon)? Optionen wie bei createWeaponModel;
 * Ego ohne tier: in der aktuellen Stufe. Nur-Werte-Aufsätze zählen nicht (STAT_ONLY, gleiche Vorlage).
 */
export function hasWeaponModel(key, { lod = 'first', att = null, tier = null } = {}) {
  return cache.has(tplKey(key, lod === 'third' ? 'third' : 'first', attKey(modelAtt(att)), tier));
}

// Optik-Montage für Waffen mit Kimme und Korn: vor der Kimme, Oberseite des Werksmodells per Strahl von oben abgetastet
// (Kornsäule/Kimme über der Visierlinie zählen nicht). { u0, base (Oberkante Waffe), railTop (Optikschiene) }
// 24.10. (V2): Bot-Fassungen tasten ihre eigene Vorlage ab – vorher baute jeder Bot mit Optik auf einer Kimme-Korn-Waffe die
// volle Ego-Fassung mit (Lage der Optik gemessen: bei 10 von 11 Kimme-Korn-Waffen gleich, KM-7 Wespe 1,7 mm höher).
const mounts = new Map();
const _rc = new THREE.Raycaster();
function mountFor(key, lod = 'first') {
  const third = lod === 'third';
  const mk = third ? key + ':third' : key;
  if (mounts.has(mk)) return mounts.get(mk);
  const tpl = getTemplate(key, third ? 'third' : 'first');
  tpl.updateMatrixWorld(true);
  const sp = tpl.getObjectByName('sight').getWorldPosition(new THREE.Vector3());
  const u0 = -sp.z + 0.03;
  const tops = [];
  for (let u = u0; u <= u0 + 0.16; u += 0.02) {
    _rc.set(new THREE.Vector3(0, sp.y + 0.3, -u), new THREE.Vector3(0, -1, 0));
    const hit = _rc.intersectObject(tpl, true).find((h) => h.object.isMesh && h.point.y < sp.y + 0.004);
    if (hit) tops.push(hit.point.y);
  }
  const top = tops.length ? Math.max(...tops) : sp.y - 0.02;
  const m = { u0, base: Math.max(top - 0.004, sp.y - 0.06), railTop: Math.max(top, sp.y - 0.012) + 0.004 };
  mounts.set(mk, m);
  return m;
}

/**
 * Erzeugt ein Waffenmodell. Gebaute Modelle werden pro Schlüssel + LOD gecacht;
 * Rückgabe ist ein günstiger Klon (geteilte Geometrien und Materialien).
 */
export function createWeaponModel(key, { lod = 'first', camo = null, att = null, tier = null } = {}) {
  if (camo && camo !== 'werk') return applyCamo(createWeaponModel(key, { lod, att, tier }), camo);
  if (att && attKey(att) && lod !== 'showcase') return cloneTemplate(getTemplate(key, lod === 'third' ? 'third' : 'first', att, tier));
  if (lod === 'showcase') {
    const inner = cloneTemplate(getTemplate(key, 'first'));
    const info = inner.userData.info;
    const holder = new THREE.Group();
    holder.name = `vitrine:${key}`;
    const s = 1 / Math.max(...info.size);
    inner.scale.setScalar(s);
    inner.position.set(-info.center[0] * s, -info.center[1] * s, -info.center[2] * s);
    holder.add(inner);
    bindUserData(holder, { ...getTemplate(key, 'first').userData.__meta, lod: 'showcase' }, inner);
    holder.userData.model = inner;
    holder.userData.scale = s;
    return holder;
  }
  return cloneTemplate(getTemplate(key, lod === 'third' ? 'third' : 'first', null, tier));
}

/** Metadaten ohne Instanz (Dreiecke, Größe, Visier, Art). Ohne lod: Ego-Fassung der aktuellen Stufe (baut sie ggf.!). */
export function getWeaponModelInfo(key, lod = 'first', att = null) {
  return { ...getTemplate(key, lod === 'third' ? 'third' : 'first', att).userData.__meta.info };
}

/**
 * 24.10. (Vorarbeit V2): stufenunabhängige Metadaten { sight, kind, axis, leftGrip, selector } – für Aufsatz-Prüfungen
 * (attachmentsFor/applyAttachments) von Bots, Waffensteuerung und Lobby. Liest eine vorhandene Vorlage, sonst baut sie höchstens
 * die Bot-Fassung (≤ 30 ms). Vorher baute getWeaponModelInfo(key) die volle Ego-Fassung jeder Waffe, die ein Bot trug – samt
 * Foto-Atlas, und mit der Freigabe je Waffe (V4) in jedem Match neu.
 */
export function getWeaponModelMeta(key) {
  if (!metaCache.has(key)) getTemplate(key, 'third');
  return { ...metaCache.get(key) };
}

// 24.10. (V5): Foto-Waffen (Distanzfeld-Netze, Atlas – Ego-Bau 0,3–7 s im Container) gelten als teuer, auch bevor eine Messung
// vorliegt: Aufheben zeigt dann einen Platzhalter statt im Bild zu bauen. Alle übrigen Waffen (alte Bauweise, 2–90 ms) baut das
// Aufheben ohne Messung sofort. NEUE FOTO-WAFFEN HIER EINTRAGEN (Integrationsschritt je Etappe, Bauanleitung §8.2).
const PHOTO_MODELS = new Set(['m17', 'p9', 'kv47', 'vp9', 'qx90', 'adler']);   // Etappe 1 (25.10.): KV-47, VP-9, QX-90, Adler
PHOTO_MODELS.add('zwilling');   // neue Waffe (26.10.)
export function isPhotoWeapon(key) { return PHOTO_MODELS.has(key); }

/**
 * 24.10. (V5): Bauzeit (ms) und Dreiecke der Ego-Vorlage ohne Aufsätze in der aktuellen Stufe – geschätzt aus der teuersten
 * schon gebauten Ego-Vorlage dieses Modells (gleiche Stufe bevorzugt). null = noch keine gebaut (Kosten unbekannt).
 */
export function weaponBuildCost(key) {
  const tier = tplKey(key, 'first', '', null);
  const own = cache.get(tier);
  if (own) return { ms: own.userData.__meta.ms || 0, triangles: own.userData.__meta.info.triangles };
  let best = null, other = null;
  for (const [k, t] of cache) {
    if (!k.startsWith(key + ':first')) continue;
    const m = t.userData.__meta, c = { ms: m.ms || 0, triangles: m.info.triangles };
    if (k.split('|')[0] === tier) { if (!best || c.ms > best.ms) best = c; } else if (!other || c.ms > other.ms) other = c;
  }
  return best || other;
}

/** 24.10.: Übersicht der gebauten Vorlagen (Prüfwerkzeuge): [{ k, triangles, ms }] */
export function weaponTemplateStats() {
  return [...cache].map(([k, t]) => ({ k, triangles: t.userData.__meta.info.triangles, ms: Math.round(t.userData.__meta.ms || 0) }));
}

/** Baut alle Modelle vorab (z. B. während des Ladebildschirms), damit später keine Ruckler entstehen. tier: feste
 *  Ego-Stufe (z. B. lightTier() im Schießstand – die volle Fassung entsteht erst beim Ausrüsten). */
export function preloadWeaponModels(keys = MODEL_KEYS, lods = ['first', 'third'], tier = null) {
  for (const k of keys) for (const l of lods) getTemplate(k, l, null, tier);
}

// ---------------------------------------------------------------- Freigabe (24.10.2026, Vorarbeiten V1/V4/V5)
// Ego-Vorlagen blieben bisher die ganze Sitzung stehen (jede Waffe, jede Stufe, jede Aufsatz-Kombination, dazu die
// Foto-Atlanten). Halter (Viewmodel-Einträge, Lobby-Vorschau) melden ihre Waffe je Stufe an. EIN Freigabeweg (releaseTemplates)
// für drei Anlässe: freeIdleWeaponModels beim Matchstart und nach einem Stufenwechsel in der Lobby (alles, was niemand hält und
// das Match nicht braucht), releaseEgoTemplates nach einem Stufenwechsel im Match (andere Stufen, sobald das Viewmodel umgestellt
// hat) und releaseWeaponTemplate für eine einzelne Vorlage (ungenutzter Vorrat am Matchende).
const holds = new Map();   // 'Modell:Stufe' → Zahl der Halter

/**
 * Waffe als benutzt anmelden – in der Stufe, die der Halter zeigt (Standard: aktuelle Stufe, also direkt nach
 * createWeaponModel aufrufen); liefert die Abmeldung (mehrfacher Aufruf harmlos). Je Stufe (24.10.): sonst hielt eine
 * gezeigte Fassung auch alle anderen Stufen derselben Waffe (z. B. M-17 max nach „hoch“ → „niedrig“).
 */
export function holdWeaponModel(key, tier = weaponDetailTier()) {
  const hk = key + ':' + tier;
  holds.set(hk, (holds.get(hk) || 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (holds.get(hk) || 1) - 1;
    if (n > 0) holds.set(hk, n); else holds.delete(hk);
  };
}

// Ego-Vorlagen-Schlüssel → { key, tier } (null für Bot-Vorlagen)
const egoOf = (k) => { const m = /^([^:]+):first(?::(max|lite))?(?:\||$)/.exec(k); return m ? { key: m[1], tier: m[2] || 'std' } : null; };

/**
 * Vorlagen ks freigeben. Geometrie nur entsorgen, wenn keine verbleibende Vorlage sie nutzt (der Bauteil-Cache V3 teilt Netze
 * zwischen den Aufsatz-Varianten eines Modells × Stufe; Patronen teilt magfill); den Bauteil-Cache eines Modells × Stufe erst
 * leeren, wenn keine Vorlage dieser Stufe mehr steht; danach Atlas-Materialien ohne Vorlage samt Texturen und Tarnklonen.
 * → Zahl der freigegebenen Vorlagen
 */
function releaseTemplates(ks) {
  const gone = [];
  for (const k of ks) { const t = cache.get(k); if (t) { cache.delete(k); gone.push([k, t]); } }
  if (!gone.length) return 0;
  const keepGeo = new Set(), used = new Set(), left = new Set();
  for (const [k, t] of cache) {
    const e = egoOf(k);
    if (e) left.add(e.key + ':' + e.tier);
    t.traverse((o) => { if (o.isMesh) { keepGeo.add(o.geometry); if (o.material && o.material.name) used.add(o.material.name.slice(3)); } });
  }
  for (const [, t] of gone) t.traverse((o) => { if (o.isMesh && o.name !== 'rounds' && !keepGeo.has(o.geometry)) o.geometry.dispose(); });
  // (Optik-Montagen bleiben: nur Zahlen – sonst baute ein Bot mit Optik auf einer Kimme-Korn-Waffe die Ego-Fassung jedes Match neu)
  for (const [k] of gone) {
    const e = egoOf(k);
    if (e && !left.has(e.key + ':' + e.tier)) { clearPartCache(e.key, e.tier); left.add(e.key + ':' + e.tier); }
  }
  disposeCamosFor(freeAtlasMaterials(used));
  return gone.length;
}

/**
 * Ego-Vorlagen freigeben, die niemand hält: Waffen außerhalb von keep ganz, Waffen in keep nur in Stufen, die das
 * Gerät gerade nicht nutzt (aktuelle Stufe bleibt, die leichte nur mit keepLight – Schießstand). → Zahl
 */
export function freeIdleWeaponModels(keep = [], { keepLight = true } = {}) {
  const want = new Set(keep.filter(Boolean)), cur = tierOf(null), light = keepLight ? lightTier() : cur;
  const ks = [];
  for (const k of cache.keys()) {
    const e = egoOf(k);
    if (!e || holds.has(e.key + ':' + e.tier) || (want.has(e.key) && (e.tier === cur || e.tier === light))) continue;
    ks.push(k);
  }
  return releaseTemplates(ks);
}

/**
 * 24.10. (V1): Ego-Vorlagen anderer Detailstufen freigeben, die niemand hält (Grafikstufe im Match gewechselt, das Viewmodel hat
 * seine Waffen umgestellt und die alten Einträge abgemeldet). → Zahl
 */
export function releaseEgoTemplates(keepTier = weaponDetailTier()) {
  const ks = [];
  for (const k of cache.keys()) {
    const e = egoOf(k);
    if (e && e.tier !== keepTier && !holds.has(e.key + ':' + e.tier)) ks.push(k);
  }
  return releaseTemplates(ks);
}

/**
 * 24.10. (V5): eine Ego-/Bot-Vorlage gezielt freigeben – der Aufrufer weiß, dass sie niemand zeigt (Vorrat am Matchende, der nie
 * in die Hand kam); Halter je Stufe gelten hier nicht (sie decken alle Aufsatz-Varianten einer Stufe ab). → true, wenn es sie gab
 */
export function releaseWeaponTemplate(key, lod = 'first', att = null) {
  return releaseTemplates([tplKey(key, lod === 'third' ? 'third' : 'first', attKey(modelAtt(att)), null)]) > 0;
}

/**
 * Drittpersonen-Modelle mit Aufsätzen freigeben (Matchende): Bots tragen jede Runde andere Kombinationen – ohne Aufräumen
 * wüchse der Zwischenspeicher von Runde zu Runde. Die Grundmodelle und Ego-Modelle bleiben.
 */
export function disposeAttachmentTemplates() {
  for (const [k, t] of cache) {
    if (!k.includes(':third|')) continue;
    t.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    cache.delete(k);
  }
}

/** Gibt alle gecachten Geometrien, Materialien und Texturen frei. */
export function disposeWeaponModels() {
  for (const t of cache.values()) t.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  cache.clear();
  mounts.clear();
  metaCache.clear();
  clearPartCache();
  disposeMagFill();
  disposeCamos();
  disposeMaterials();
  disposeTextures();
}
