// NULLPUNKT — Waffenaufsätze (Wunschliste: „so viele Aufsätze wie möglich“). Sieben Plätze je Waffe: Optik, Mündung,
// Unterlauf, Magazin, Taktisch, Munition, Schaft. Ein Aufsatz ändert Werte (abgeleitete Waffendefinition mit baseId,
// gleiche id – Statistik, Abschussmeldung und Netz bleiben bei der Grundwaffe) und meist auch das Modell
// (game/weapons/gunsmith/attach.js baut Optik, Schalldämpfer, Griff, Zweibein, Laser, Magazin sichtbar an).
// Auswahl gespeichert je Waffe im Browser (Schlüssel STORE_KEY); offline, Host und Clients rechnen gleich.

export const STORE_KEY = 'nullpunkt.aufsaetze';

export const ATT_SLOTS = [
  { id: 'optik', name: 'Optik' },
  { id: 'muendung', name: 'Mündung' },
  { id: 'unterlauf', name: 'Unterlauf' },
  { id: 'magazin', name: 'Magazin' },
  { id: 'taktisch', name: 'Taktisch' },
  { id: 'munition', name: 'Munition' },
  { id: 'schaft', name: 'Schaft' },
];

const NO_ATT = new Set(['launcher', 'melee']);
const LONG = new Set(['ar', 'smg', 'lmg', 'marksman', 'sniper', 'shotgun']);
const isRevolver = (d) => d.id === 'pi_kobra' || (d.reloadType === 'revolver');

/**
 * Aufsätze: slot, name, kurz (Wirkung in Worten), ok(def, info) – passt er? (info = Modell-Metadaten: leftGrip),
 * apply(d) – verändert die (bereits kopierte) Definition.
 */
export const ATTACHMENTS = {
  // ---------------------------------------------------------------- Optik
  rotpunkt: { slot: 'optik', name: 'Rotpunkt', kurz: 'Leuchtpunkt, freies Sichtfeld, schneller Anschlag',
    ok: (d) => LONG.has(d.cls), apply: (d) => optic(d, 'reddot', 1.25, 0.96) },
  ring: { slot: 'optik', name: 'Ringvisier', kurz: 'offener Ring, schnellster Anschlag mit Optik',
    ok: (d) => LONG.has(d.cls), apply: (d) => optic(d, 'reddot', 1.2, 0.93) },
  holo: { slot: 'optik', name: 'Holo-Visier', kurz: 'Ringabsehen, leicht vergrößert',
    ok: (d) => LONG.has(d.cls), apply: (d) => optic(d, 'holo', 1.35, 1.0) },
  acog: { slot: 'optik', name: 'Kampfvisier 2,4×', kurz: 'Vergrößerung für mittlere Distanz, langsamerer Anschlag',
    ok: (d) => LONG.has(d.cls) && d.cls !== 'shotgun', apply: (d) => optic(d, 'acog', 2.4, 1.15) },
  zielfernrohr: { slot: 'optik', name: 'Zielfernrohr 5,5×', kurz: 'Fernkampf, Schwanken im Anschlag, langsam',
    ok: (d) => LONG.has(d.cls) && d.cls !== 'shotgun' && d.cls !== 'smg', apply: (d) => optic(d, 'sniper', 5.5, 1.35) },
  // ---------------------------------------------------------------- Mündung
  daempfer: { slot: 'muendung', name: 'Schalldämpfer', kurz: 'leise, kein Mündungsfeuer; etwas weniger Reichweite',
    ok: (d) => !NO_ATT.has(d.cls) && !isRevolver(d),
    apply: (d) => { d.suppressed = true; scaleRange(d, 0.85); mulRecoil(d, 0.95, 0.95); d.adsTime *= 1.05; } },
  kompensator: { slot: 'muendung', name: 'Kompensator', kurz: 'deutlich weniger seitlicher Rückstoß',
    ok: (d) => !NO_ATT.has(d.cls) && d.cls !== 'shotgun', apply: (d) => mulRecoil(d, 0.92, 0.68) },
  bremse: { slot: 'muendung', name: 'Mündungsbremse', kurz: 'weniger Hochschlag, etwas langsamer im Anschlag',
    ok: (d) => !NO_ATT.has(d.cls), apply: (d) => { mulRecoil(d, 0.78, 0.95); d.adsTime *= 1.03; } },
  feuerdaempfer: { slot: 'muendung', name: 'Mündungsfeuerdämpfer', kurz: 'kleines Mündungsfeuer, ruhigerer Schuss',
    ok: (d) => !NO_ATT.has(d.cls) && d.cls !== 'pistol', apply: (d) => { d.flashScale = 0.45; mulRecoil(d, 0.95, 0.95); } },
  // ---------------------------------------------------------------- Unterlauf
  griff: { slot: 'unterlauf', name: 'Vordergriff', kurz: 'weniger Hochschlag im Dauerfeuer',
    ok: (d, i) => LONG.has(d.cls) && underOk(i, true), apply: (d) => { mulRecoil(d, 0.84, 0.9); d.adsTime *= 1.04; } },
  winkel: { slot: 'unterlauf', name: 'Winkelgriff', kurz: 'schnellerer Anschlag, etwas ruhiger',
    ok: (d, i) => LONG.has(d.cls) && underOk(i, true), apply: (d) => { d.adsTime *= 0.88; mulRecoil(d, 0.95, 0.95); } },
  zweibein: { slot: 'unterlauf', name: 'Zweibein', kurz: 'geduckt/liegend fast ohne Rückstoß',
    ok: (d, i) => ['ar', 'lmg', 'marksman', 'sniper'].includes(d.cls) && underOk(i, false), apply: (d) => { d.bipod = 0.5; d.adsTime *= 1.08; d.moveSpeedMult *= 0.98; } },
  handstopp: { slot: 'unterlauf', name: 'Handstopp', kurz: 'genauer aus der Hüfte, schneller aus dem Sprint',
    ok: (d, i) => LONG.has(d.cls) && underOk(i, false), apply: (d) => { d.hipSpread *= 0.9; d.sprintToFire *= 0.88; } },
  // ---------------------------------------------------------------- Magazin
  erweitert: { slot: 'magazin', name: 'Erweitertes Magazin', kurz: '+50 % Patronen, langsamer nachladen',
    ok: (d) => magOk(d), apply: (d) => { d.mag = Math.round(d.mag * 1.5); d.reserve = Math.round(d.reserve * 1.25); mulReload(d, 1.1); d.adsTime *= 1.04; } },
  trommel: { slot: 'magazin', name: 'Trommelmagazin', kurz: 'doppelte Patronen, schwer und langsam',
    ok: (d) => magOk(d) && ['ar', 'smg', 'shotgun'].includes(d.cls) && d.mag <= 40,
    apply: (d) => { d.mag = d.mag * 2; d.reserve = Math.round(d.reserve * 1.5); mulReload(d, 1.3); d.adsTime *= 1.12; d.moveSpeedMult *= 0.96; } },
  schnell: { slot: 'magazin', name: 'Schnellwechsel-Magazin', kurz: 'Nachladen 20 % schneller',
    ok: (d) => magOk(d) || d.perShellReload, apply: (d) => mulReload(d, 0.8) },
  // ---------------------------------------------------------------- Taktisch
  laser: { slot: 'taktisch', name: 'Laser-Modul', kurz: 'aus der Hüfte deutlich genauer',
    ok: (d) => !NO_ATT.has(d.cls), apply: (d) => { d.hipSpread *= 0.75; d.laser = true; } },
  // ---------------------------------------------------------------- Munition
  vollmantel: { slot: 'munition', name: 'Vollmantel', kurz: 'mehr Durchschlag durch Wände, etwas weniger Schaden',
    ok: (d) => !NO_ATT.has(d.cls) && d.cls !== 'shotgun', apply: (d) => { d.penetration = Math.min(1, (d.penetration || 0) + 0.2); mulDamage(d, 0.95); } },
  hohlspitz: { slot: 'munition', name: 'Hohlspitz', kurz: '+10 % Schaden, kaum Durchschlag',
    ok: (d) => !NO_ATT.has(d.cls) && d.cls !== 'shotgun', apply: (d) => { mulDamage(d, 1.1); d.penetration = (d.penetration || 0) * 0.4; } },
  unterschall: { slot: 'munition', name: 'Unterschall', kurz: 'mit Dämpfer fast lautlos; weniger Reichweite',
    ok: (d) => !NO_ATT.has(d.cls) && d.cls !== 'shotgun', apply: (d) => { d.subsonic = true; scaleRange(d, 0.7); mulRecoil(d, 0.9, 0.9); } },
  flintenlaufgeschoss: { slot: 'munition', name: 'Flintenlaufgeschoss', kurz: 'ein schweres Geschoss statt Schrot – trifft weit',
    ok: (d) => d.cls === 'shotgun',
    apply: (d) => { const p = Math.max(1, d.pellets || 1); d.damage = { ...d.damage, max: Math.round(d.damage.max * p * 0.55), min: Math.round(d.damage.min * p * 0.5), rangeStart: d.damage.rangeStart * 2.5, rangeEnd: d.damage.rangeEnd * 3 }; d.pellets = 1; d.hipSpread *= 0.6; d.adsSpread = Math.min(d.adsSpread, 0.004); d.range = (d.range || 40) * 2.5; d.penetration = Math.max(d.penetration || 0, 0.6); } },
  // ---------------------------------------------------------------- Schaft
  leicht: { slot: 'schaft', name: 'Leichter Schaft', kurz: 'schneller im Anschlag und Laufen, mehr Rückstoß',
    ok: (d) => LONG.has(d.cls), apply: (d) => { d.adsTime *= 0.88; d.adsMoveMult = Math.min(1, d.adsMoveMult * 1.1); d.moveSpeedMult *= 1.02; mulRecoil(d, 1.12, 1.12); } },
  schwer: { slot: 'schaft', name: 'Schwerer Schaft', kurz: 'ruhiger beim Zielen, langsamer im Anschlag',
    ok: (d) => LONG.has(d.cls), apply: (d) => { mulRecoil(d, 0.88, 0.85); d.adsTime *= 1.1; if (d.scopeSway) d.scopeSway *= 0.75; } },
};

function optic(d, sight, zoom, ads) {
  d.sight = sight;
  d.adsZoom = zoom;
  d.scope = { zoom, overlay: sight === 'iron' ? null : sight };
  d.adsTime *= ads;
  if (sight === 'sniper') d.scopeSway = Math.max(d.scopeSway || 0, 0.0018);
  else d.scopeSway = 0;
}
function mulRecoil(d, v, h) { d.recoil = { ...d.recoil, vertical: d.recoil.vertical * v, horizontal: d.recoil.horizontal * h }; }
function mulReload(d, k) { d.reloadTime *= k; d.reloadEmptyTime = (d.reloadEmptyTime || d.reloadTime) * k; }
function mulDamage(d, k) { d.damage = { ...d.damage, max: Math.round(d.damage.max * k), min: Math.round(d.damage.min * k) }; }
function scaleRange(d, k) { d.damage = { ...d.damage, rangeStart: d.damage.rangeStart * k, rangeEnd: d.damage.rangeEnd * k }; d.range = (d.range || 100) * k; }
function magOk(d) { return !NO_ATT.has(d.cls) && !d.perShellReload && !isRevolver(d) && (d.mag || 0) > 1; }
function underOk(info, needsHand) {
  const g = info && info.leftGrip;
  if (!g) return !needsHand;
  if (g === 'pump' || g === 'pistol') return false;
  return needsHand ? g !== 'post' : true;
}

/** Passende Aufsätze je Platz für eine Waffe (info: getWeaponModelInfo, optional). */
export function attachmentsFor(def, info = null) {
  const out = {};
  if (!def || NO_ATT.has(def.cls)) return out;
  for (const s of ATT_SLOTS) {
    const list = Object.entries(ATTACHMENTS).filter(([, a]) => a.slot === s.id && a.ok(def, info)).map(([id]) => id);
    if (list.length) out[s.id] = list;
  }
  return out;
}

/** Bereinigt eine Auswahl { slot: id } (unbekannte/unpassende fallen weg). */
export function cleanAttachments(def, att, info = null) {
  const out = {};
  if (!def || !att || typeof att !== 'object') return out;
  for (const s of ATT_SLOTS) {
    const id = att[s.id];
    const a = typeof id === 'string' ? ATTACHMENTS[id] : null;
    if (a && a.slot === s.id && a.ok(def, info)) out[s.id] = id;
  }
  return out;
}

/** Eindeutiger Schlüssel einer Auswahl ('' = keine). */
export function attKey(att) {
  if (!att) return '';
  return ATT_SLOTS.map((s) => att[s.id]).filter(Boolean).join('+');
}

/** Abgeleitete Definition (Kopie) mit allen Aufsätzen; ohne Aufsätze die Grundwaffe selbst. */
export function applyAttachments(def, att, info = null) {
  const clean = cleanAttachments(def, att, info);
  const key = attKey(clean);
  if (!key) return def;
  const d = { ...def, damage: { ...def.damage }, recoil: { ...def.recoil }, baseId: def.baseId || def.id, att: clean, attKey: key };
  for (const s of ATT_SLOTS) if (clean[s.id]) ATTACHMENTS[clean[s.id]].apply(d);
  return d;
}

/** Gespeicherte Auswahl aller Waffen ({ [weaponId]: { slot: id } }). */
export function loadAttachments() {
  try { const v = JSON.parse(globalThis.localStorage.getItem(STORE_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** Einen Platz einer Waffe setzen (id null = leer). */
export function saveAttachment(weaponId, slot, id) {
  const all = loadAttachments();
  const cur = { ...(all[weaponId] || {}) };
  if (id) cur[slot] = id; else delete cur[slot];
  all[weaponId] = cur;
  try { globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* privates Fenster */ }
  return cur;
}
