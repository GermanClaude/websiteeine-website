/* NULLPUNKT — Waffen- und Ausrüstungsdaten (reine Daten + reine Hilfsfunktionen).
 * Keine Imports, kein three.js, kein DOM: wird von Spiel UND Website geladen.
 *
 * Einheiten: Meter, Sekunden, Radiant. Gesundheit = 100 (MAX_HEALTH).
 *
 * Feld-Semantik (über §7 des Vertrags hinaus präzisiert):
 *  damage        { max, min, rangeStart, rangeEnd } – Schaden PRO KUGEL (bei Schrot pro Schrotkugel)
 *                in Zone „body“. Bis rangeStart = max, ab rangeEnd = min, dazwischen linear.
 *                Jenseits von `range` (maximale Trefferdistanz) = 0. → damageAt()
 *  headMult/limbMult  Zonenmultiplikatoren (Kopf / Arme+Beine). „body“ = Torso = ×1.
 *  pellets       Kugeln pro Schuss (Schrot: 8). Jede Kugel streut im aktuellen Streukegel.
 *  rpm           Maximale Kadenz. Bei 'bolt'/'pump' inklusive Repetierbewegung.
 *  burstCount / burstDelay  nur für fireMode 'burst' (Pause zwischen Feuerstößen in s).
 *  reloadTime / reloadEmptyTime  taktisch (Patrone im Lauf) vs. leer (inkl. Durchladen).
 *  perShellReload  true = Patrone für Patrone (Schrot). Dann gilt `shellTiming`
 *                { start, insert, end } in s; reloadTime = eine Patrone, reloadEmptyTime = volles Magazin.
 *  equipTime     Ziehen/Bereitmachen. adsTime: Zeit bis voll im Anschlag. sprintToFire: Sprint → Schuss.
 *  adsZoom       Vergrößerung im Anschlag; adsFov = Kamera-FOV im Anschlag bei Basis-FOV 80°
 *                (für andere FOV-Einstellungen: adsFovFor(def, settingsFov)).
 *  sight         'iron'|'holo'|'reddot'|'acog'|'sniper'|'none'; scope = null (Kimme/Korn) oder
 *                { zoom, overlay } für optische Visiere (overlay steuert das HUD/Visierbild).
 *  hipSpread/adsSpread  Halber Öffnungswinkel des Streukegels (rad). × moveSpreadMult beim Laufen,
 *                × jumpSpreadMult in der Luft. Schrot: Kegel, in dem die Schrotkugeln verteilt werden.
 *  recoil        vertical/horizontal: Kamerarückstoß pro Schuss (rad). Pro Schussindex i gilt
 *                  pitch = vertical × pattern[i][1] (× firstShotMult beim ersten Schuss)
 *                  yaw   = horizontal × (pattern[i][0] + Zufall(−0,35…0,35))
 *                pattern optional; nach dem Ende werden die letzten 4 Einträge wiederholt.
 *                recovery: Rückführrate (1/s, exponentiell) zum Ausgangspunkt nach dem Feuern.
 *  penetration   0–1: Anteil des Schadens, der dünne Deckung (Holz, Blech, Glas) durchschlägt.
 *  sound         { profile, pitch } – profile ist ein Audio-Profil aus §7.
 *  stats         0–100-Balken für Website/Lobby, abgeleitet per computeStats() (Formel unten).
 *  icon          SVG-Strichzeichnung (viewBox 0 0 96 32, stroke=currentColor) – Fallback ohne WebGL,
 *                Killfeed, Lobby.
 */

export const MAX_HEALTH = 100;
export const BASE_FOV = 80;

export const WEAPON_CLASSES = {
  ar: 'Sturmgewehr',
  smg: 'MP',
  lmg: 'LMG',
  sniper: 'Scharfschützengewehr',
  marksman: 'Präzisionsgewehr',
  shotgun: 'Schrotflinte',
  pistol: 'Pistole',
  melee: 'Nahkampf',
};

/** Anzeige-Reihenfolge der Klassen (Lobby, Website). */
export const CLASS_ORDER = ['ar', 'smg', 'lmg', 'marksman', 'sniper', 'shotgun', 'pistol', 'melee'];

/** Kurzbeschreibung pro Klasse (Website/Lobby-Tooltips). */
export const CLASS_INFO = {
  ar: { short: 'SG', role: 'Allrounder für mittlere Distanz – verlässlich, vielseitig, kontrollierbar.' },
  smg: { short: 'MP', role: 'Schnell im Anschlag, tödlich auf kurze Wege, schwach auf weite Sicht.' },
  lmg: { short: 'LMG', role: 'Große Magazine und Reichweite – träge, aber kaum aufzuhalten.' },
  marksman: { short: 'PG', role: 'Halbautomatische Präzision: zwei bis drei Treffer bis weit über 50 Meter.' },
  sniper: { short: 'SSG', role: 'Ein Schuss, ein Abschuss – wenn Kopf oder Torso getroffen werden.' },
  shotgun: { short: 'SF', role: 'Endgültig auf Armlänge, nutzlos über die Straße.' },
  pistol: { short: 'P', role: 'Zweitwaffe für Notfälle: blitzschnell gezogen, leicht geführt.' },
  melee: { short: 'NK', role: 'Lautlos, immer dabei, ein Treffer genügt.' },
};

export const FIRE_MODES = {
  auto: 'Vollautomatisch',
  semi: 'Halbautomatisch',
  burst: 'Feuerstoß',
  bolt: 'Repetierer',
  pump: 'Vorderschaftrepetierer',
};

export const SIGHTS = {
  iron: { name: 'Kimme und Korn', overlay: null },
  holo: { name: 'Holo-Visier', overlay: 'holo' },
  reddot: { name: 'Rotpunktvisier', overlay: 'reddot' },
  acog: { name: 'Kompaktzielfernrohr 2,4×', overlay: 'acog' },
  sniper: { name: 'Zielfernrohr 5,5×', overlay: 'sniper' },
  none: { name: '—', overlay: null },
};

/* ------------------------------------------------------------------ Icons */

const SVG_OPEN = (vb) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`;
const gunIcon = (d, extra = '') => `${SVG_OPEN('0 0 96 32')}<path d="${d}"/>${extra}</svg>`;
const smallIcon = (body) => `${SVG_OPEN('0 0 24 24')}${body}</svg>`;

const ICONS = {
  kv47: gunIcon(
    'M4 15L22 11.5V17.5L6 22Z M22 11H52V17H22Z M30 17L28 24H32L34 17 M38 17Q38 24 44 28L48 26Q43.5 22 44 17 ' +
    'M52 11.5H68V16H52Z M52 10H70 M68 13.75H86 M80 13.75V10.5 M86 12.5V15'),
  m17: gunIcon(
    'M5 11H17V18H8L5 16Z M17 13H24 M24 10H50V17H24Z M26 8H64 M34 8V4.5H44V8 M37 6.25H41 M30 17L28 24H32L34 17 ' +
    'M38 17L37 26H43L44 17 M50 10H66V17H50Z M62 8V6 M66 13.5H84 M84 12H88V15H84'),
  vp9: gunIcon(
    'M6 12H20 M6 12V20H10L20 16 M20 10H52V16H20Z M24 10V7.5 M28 16L26 24H30L32 16 ' +
    'M40 16Q41 23 45 27L48 25.5Q44 22 44 16 M52 11Q62 11 64 13V16H52 M60 11V7.5 M64 13.5H74 M74 12V15'),
  qx90: gunIcon(
    'M8 20Q7 12 16 12H62Q70 12 72 17V20H54Q52 26 46 26H40Q40 22 40 20Z M30 20Q32 15 40 15 ' +
    'M18 12V9H60V12 M44 9V5.5H52V9 M47 7.25H49 M72 16H84 M84 14.5V17.5'),
  hm60: gunIcon(
    'M4 13H18V19H8L4 17Z M18 10H54V18H18Z M22 10L26 7H50L54 10 M30 18L28 25H32L34 18 M38 18V26H50V18 ' +
    'M54 11H74V16H54Z M58 13.5H59 M62 13.5H63 M66 13.5H67 M70 13.5H71 M74 13.5H90 M90 12V15 M80 14L76 27 M80 14L85 27'),
  sk14: gunIcon(
    'M4 12H22V18L12 20H4Z M8 12V10H18V12 M22 11H52V17H22Z M28 8H50 M32 8V5H46V8 M28 8V11 M50 8V11 ' +
    'M32 17L30 24H34L36 17 M40 17V23H47V17 M52 11.5H70V16.5H52Z M70 14H89 M89 12H93V16H89Z'),
  brecher: gunIcon(
    'M4 12H26V18H18L14 24H6L4 20Z M14 18Q16 15 20 15 M26 12H52V17H26Z M28 9H52 M28 6H52V9H28Z ' +
    'M52 5.5L58 4.5V10.5L52 9.5 M28 6L23 5.5V9.5L28 9 M33 9V12 M47 9V12 M36 17V22H44V17 M30 17Q30 21 34 21 ' +
    'M50 15L53 19 M52 13.5H86 M86 12H92V15H86Z',
    '<circle cx="53.6" cy="19.8" r="1.1"/>'),
  bulldog: gunIcon(
    'M4 14L22 11V17L6 21.5Z M22 11H44V17H22Z M28 17Q28 21 32 21H34 M44 11.5H88V14H44 M44 15.5H76V17.5 ' +
    'M54 14.5H70V19H54Z M58 15V18.5 M62 15V18.5 M66 15V18.5 M86 11.5V10'),
  p9: gunIcon(
    'M26 8H70V14H26Z M30 9V13 M33 9V13 M36 9V13 M34 14H66V16H46 M28 14L25 27H34L36 17 ' +
    'M37 16Q38 21 44 21Q46 21 46 16 M67 8V6.5 M29 8V6.5'),
  adler: gunIcon(
    'M22 7H76V14H22Z M60 10.5H68 M26 8.5V12.5 M29 8.5V12.5 M30 14H60V16H48 M24 14L21 28H31L34 17 ' +
    'M35 16Q36 22 42 22Q46 22 47 16 M73 7V5.5 M25 7V5.5'),
  knife: gunIcon(
    'M10 14H34Q36 14 36 16V18Q36 20 34 20H10Q8 20 8 17Q8 14 10 14Z M16 14V20 M22 14V20 M28 14V20 ' +
    'M36 11V23 M36 13.5H72L88 16.5L76 20H36 M40 16.5H68'),
  frag: smallIcon(
    '<circle cx="12" cy="14.5" r="6.5"/><path d="M9.5 8V5.5H14.5V8 M14.5 6Q18 6 18.5 10 M6.3 12.5H17.7 M6.3 16.5H17.7 M10 8.5V20.5 M14 8.5V20.5"/>' +
    '<circle cx="7.5" cy="4.5" r="1.8"/>'),
  semtex: smallIcon(
    '<rect x="4.5" y="8.5" width="15" height="8.5" rx="2"/><path d="M8 8.5V6.5H16V8.5 M7.5 19.5V21 M12 19.5V21 M16.5 19.5V21"/>' +
    '<circle cx="12" cy="12.75" r="1.5"/>'),
};

/* ------------------------------------------------------------ Hilfsfunktionen */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Normalisiert v linear auf 0..1 zwischen a und b (geclampt). */
const norm = (v, a, b) => clamp01((v - a) / (b - a));
const round = (v, digits = 0) => { const f = 10 ** digits; return Math.round(v * f) / f; };

/** Vertikales Kamera-FOV (Grad) für eine Vergrößerung relativ zu baseFov. */
export function fovForZoom(zoom, baseFov = BASE_FOV) {
  const half = (baseFov * Math.PI) / 360;
  return (Math.atan(Math.tan(half) / Math.max(zoom, 1e-3)) * 360) / Math.PI;
}

/** ADS-FOV einer Waffe für die aktuelle FOV-Einstellung (Standard 80°). */
export function adsFovFor(def, baseFov = BASE_FOV) {
  return fovForZoom(def.adsZoom || 1, baseFov);
}

/** Zeit zwischen zwei Schüssen in Sekunden (aus rpm). */
export function shotInterval(def) {
  return def.rpm > 0 ? 60 / def.rpm : Infinity;
}

/** Schaden PRO KUGEL (Zone body) auf `distance` Meter. 0 jenseits von def.range. */
export function damageAt(def, distance) {
  if (!def || distance > def.range) return 0;
  const { max, min, rangeStart, rangeEnd } = def.damage;
  if (distance <= rangeStart) return max;
  if (distance >= rangeEnd) return min;
  const t = (distance - rangeStart) / (rangeEnd - rangeStart);
  return max + (min - max) * t;
}

/** Zonenmultiplikator für 'head' | 'body' | 'limb'. */
export function zoneMult(def, zone = 'body') {
  return zone === 'head' ? def.headMult : zone === 'limb' ? def.limbMult : 1;
}

/**
 * Schüsse bis zum Abschuss (100 HP) auf `distance`. Annahme: jeder Schuss trifft die Zone,
 * bei Schrot treffen `pelletsHit` Kugeln (Standard: alle). Infinity, wenn kein Schaden ankommt.
 */
export function shotsToKill(def, distance, zone = 'body', pelletsHit = def ? def.pellets : 1) {
  const perShot = damageAt(def, distance) * zoneMult(def, zone) * Math.min(pelletsHit, def.pellets || 1);
  if (perShot <= 0) return Infinity;
  return Math.max(1, Math.ceil(MAX_HEALTH / perShot - 1e-9));
}

/** Zeitpunkt (s) des Schusses Nr. `index` (0-basiert) ab dem ersten Schuss – berücksichtigt Feuerstöße. */
export function shotTime(def, index) {
  const iv = shotInterval(def);
  if (def.fireMode === 'burst' && def.burstCount > 1) {
    const burst = Math.floor(index / def.burstCount);
    const within = index % def.burstCount;
    return burst * ((def.burstCount - 1) * iv + (def.burstDelay || iv)) + within * iv;
  }
  return index * iv;
}

/**
 * Time-to-kill in Millisekunden gegen 100 HP mit Torsotreffern (erster Schuss bei t = 0).
 * Berücksichtigt rpm, Feuerstoß-Pausen und Repetierzeit (bolt/pump stecken im rpm).
 * Muss nachgeladen werden (Magazin zu klein), kommt die taktische Nachladezeit dazu.
 */
export function ttk(def, distance, zone = 'body') {
  const n = shotsToKill(def, distance, zone);
  if (!Number.isFinite(n)) return Infinity;
  let t = shotTime(def, n - 1);
  if (def.mag > 0 && n > def.mag) t += Math.floor((n - 1) / def.mag) * (def.perShellReload ? def.reloadEmptyTime : def.reloadTime);
  return Math.round(t * 1000);
}

/** Kompaktes Profil für Tabellen: [{ distance, damage, shots, ttk }]. */
export function killProfile(def, distances = [5, 15, 30, 50]) {
  return distances.map((d) => ({
    distance: d,
    damage: round(damageAt(def, d) * (def.pellets || 1), 1),
    shots: shotsToKill(def, d),
    headShots: shotsToKill(def, d, 'head'),
    ttk: ttk(def, d),
  }));
}

/** Entfernung (m), bis zu der die Nahbereichs-Schusszahl hält (Reichweite der „besten“ TTK). */
export function effectiveRange(def) {
  const base = shotsToKill(def, 0);
  if (!Number.isFinite(base)) return 0;
  let lo = 0;
  let hi = def.range;
  if (shotsToKill(def, hi) <= base) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (shotsToKill(def, mid) <= base) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Leitet die 0–100-Balken aus den Rohwerten ab (dokumentierte Formel, monoton in jedem Wert):
 *  damage   = 100 · min(1, Schaden pro Schuss (alle Kugeln, Nahbereich) / 100)^0,6
 *  fireRate = 100 · min(1, rpm / 1000)
 *  range    = 100 · ( 0,45 · min(1, effectiveRange / 50)              // wie weit die Nah-TTK hält
 *                   + 0,35 · min(1, (rangeStart + rangeEnd) / 2 / 70)  // Lage der Abfallkurve
 *                   + 0,20 · min / max )                              // Restschaden
 *  accuracy = 100 · ( 0,85 · (1 − norm(adsSpread + 0,0025 / adsZoom, 0,0005, 0,009))
 *                   + 0,15 · (1 − norm(hipSpread, 0,02, 0,13)) )
 *             (0,0025 / adsZoom = menschlicher Zielfehler, den die Vergrößerung verkleinert)
 *  mobility = 100 · ( 0,45 · norm(moveSpeedMult, 0,82, 1,07)
 *                   + 0,25 · (1 − norm(adsTime, 0,1, 0,55))
 *                   + 0,20 · (1 − norm(sprintToFire, 0,05, 0,42))
 *                   + 0,10 · (1 − norm(equipTime, 0,25, 1,0)) )
 *  control  = 100 · (1 − 0,65 · norm(Dauerlast, 0, 0,2) − 0,35 · norm(Einzelkick, 0, 0,05))
 *             Einzelkick = vertical · firstShotMult + 0,6 · horizontal   (rad pro Schuss)
 *             Dauerlast  = (vertical + 0,6 · horizontal) · min(rpm, 900) / 60 · (1 − 0,3 · norm(recovery, 4, 14))
 *                          (≈ Radiant Kamerawanderung pro Sekunde Dauerfeuer)
 *  norm(v, a, b) = (v − a) / (b − a), auf 0…1 begrenzt. Nahkampf: feste Werte.
 * Jeder Balken wird gerundet und auf 4…100 begrenzt, damit kein Balken komplett leer ist.
 */
export function computeStats(def) {
  const bar = (v) => Math.max(4, Math.min(100, Math.round(v * 100)));
  if (def.cls === 'melee') {
    return { damage: 100, fireRate: bar(def.rpm / 1000), range: 4, accuracy: 100, mobility: 100, control: 100 };
  }
  const perShot = def.damage.max * (def.pellets || 1);
  const damage = Math.pow(Math.min(1, perShot / MAX_HEALTH), 0.6);
  const fireRate = Math.min(1, def.rpm / 1000);
  const range =
    0.45 * Math.min(1, effectiveRange(def) / 50) +
    0.35 * Math.min(1, (def.damage.rangeStart + def.damage.rangeEnd) / 2 / 70) +
    0.2 * (def.damage.min / def.damage.max);
  const precision = def.adsSpread + 0.0025 / (def.adsZoom || 1);
  const accuracy = 0.85 * (1 - norm(precision, 0.0005, 0.009)) + 0.15 * (1 - norm(def.hipSpread, 0.02, 0.13));
  const mobility =
    0.45 * norm(def.moveSpeedMult, 0.82, 1.07) +
    0.25 * (1 - norm(def.adsTime, 0.1, 0.55)) +
    0.2 * (1 - norm(def.sprintToFire, 0.05, 0.42)) +
    0.1 * (1 - norm(def.equipTime, 0.25, 1.0));
  const r = def.recoil;
  const kick = r.vertical * (r.firstShotMult || 1) + 0.6 * r.horizontal;
  const load = (r.vertical + 0.6 * r.horizontal) * (Math.min(def.rpm, 900) / 60) * (1 - 0.3 * norm(r.recovery, 4, 14));
  const control = 1 - 0.65 * norm(load, 0, 0.2) - 0.35 * norm(kick, 0, 0.05);
  return { damage: bar(damage), fireRate: bar(fireRate), range: bar(range), accuracy: bar(accuracy), mobility: bar(mobility), control: bar(control) };
}

/* ------------------------------------------------------------------ Waffen */

// Rückstoßmuster [horizontal, vertikal] je Schuss (Multiplikatoren, siehe Kopfkommentar).
const PATTERN = {
  kv47: [[0, 1], [0.2, 1.05], [0.45, 1.1], [0.6, 1.1], [0.4, 1.05], [0.1, 1], [-0.3, 0.95], [-0.6, 0.9], [-0.45, 0.9], [0, 0.95], [0.4, 0.95], [0.2, 0.9]],
  m17: [[0, 1], [0.1, 1], [0.15, 1], [0.05, 0.95], [-0.1, 0.95], [-0.2, 0.9], [-0.1, 0.9], [0.1, 0.9]],
  vp9: [[0, 1], [-0.1, 1], [-0.2, 0.95], [0, 0.9], [0.2, 0.9], [0.25, 0.85], [0, 0.85], [-0.2, 0.85]],
  qx90: [[0, 1], [0.4, 0.9], [-0.3, 0.9], [0.5, 0.85], [-0.5, 0.85], [0.3, 0.8], [-0.2, 0.8], [0.4, 0.8]],
  hm60: [[0, 1.4], [0.1, 1.3], [0.3, 1.1], [0.5, 1], [0.3, 0.9], [-0.1, 0.8], [-0.4, 0.75], [-0.2, 0.7], [0.2, 0.7], [0.3, 0.7]],
};

const RAW = {
  ar_kv47: {
    id: 'ar_kv47', name: 'KV-47', cls: 'ar', slot: 'primary', unlockLevel: 2,
    description: 'Schwerer Rückstoß, ehrlicher Treffer: Das KV-47 schlägt mit jeder Kugel hart zu und verliert auch über lange Achsen kaum an Wucht. Wer die Mündung bändigt, gewinnt fast jedes Duell auf mittlere Distanz.',
    damage: { max: 33, min: 25, rangeStart: 24, rangeEnd: 48 }, headMult: 1.4, limbMult: 0.9, pellets: 1,
    rpm: 560, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 120,
    reloadTime: 2.35, reloadEmptyTime: 3.05, perShellReload: false,
    equipTime: 0.6, adsTime: 0.26, adsZoom: 1.25, sight: 'iron', scope: null, sprintToFire: 0.2,
    moveSpeedMult: 0.95, adsMoveMult: 0.6, hipSpread: 0.052, adsSpread: 0.0034, moveSpreadMult: 1.5, jumpSpreadMult: 2.6,
    recoil: { vertical: 0.0105, horizontal: 0.0048, recovery: 8, firstShotMult: 1.25, pattern: PATTERN.kv47 },
    range: 115, penetration: 0.7, suppressed: false, sound: { profile: 'ar_heavy', pitch: 0.96 }, model: 'kv47',
  },
  ar_m17: {
    id: 'ar_m17', name: 'M-17 Falke', cls: 'ar', slot: 'primary', unlockLevel: 1,
    description: 'Leicht, präzise und auf jeder Distanz zu Hause – der Falke trifft zuerst und verzeiht viel. Holo-Visier ab Werk, sanfter Rückstoß, kurze Anschlagzeit.',
    damage: { max: 25, min: 19, rangeStart: 22, rangeEnd: 45 }, headMult: 1.35, limbMult: 0.9, pellets: 1,
    rpm: 700, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 120,
    reloadTime: 2.1, reloadEmptyTime: 2.7, perShellReload: false,
    equipTime: 0.55, adsTime: 0.22, adsZoom: 1.35, sight: 'holo', scope: { zoom: 1.35, overlay: 'holo' }, sprintToFire: 0.18,
    moveSpeedMult: 0.95, adsMoveMult: 0.62, hipSpread: 0.045, adsSpread: 0.0022, moveSpreadMult: 1.45, jumpSpreadMult: 2.5,
    recoil: { vertical: 0.0078, horizontal: 0.0028, recovery: 10, firstShotMult: 1.1, pattern: PATTERN.m17 },
    range: 110, penetration: 0.55, suppressed: false, sound: { profile: 'ar', pitch: 1.0 }, model: 'm17',
  },
  smg_vp9: {
    id: 'smg_vp9', name: 'VP-9 Viper', cls: 'smg', slot: 'primary', unlockLevel: 1,
    description: 'Kompakt, ruhig im Dauerfeuer und schneller im Anschlag als jeder Gegner, der um die Ecke kommt. Die Viper beißt zu, bevor das Gegenüber blinzelt – und bleibt bis in die Hofmitte gefährlich.',
    damage: { max: 26, min: 17, rangeStart: 14, rangeEnd: 28 }, headMult: 1.3, limbMult: 0.9, pellets: 1,
    rpm: 820, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 150,
    reloadTime: 1.95, reloadEmptyTime: 2.5, perShellReload: false,
    equipTime: 0.45, adsTime: 0.17, adsZoom: 1.2, sight: 'iron', scope: null, sprintToFire: 0.12,
    moveSpeedMult: 1.0, adsMoveMult: 0.75, hipSpread: 0.03, adsSpread: 0.0034, moveSpreadMult: 1.25, jumpSpreadMult: 2.0,
    recoil: { vertical: 0.0058, horizontal: 0.0032, recovery: 12, firstShotMult: 1.0, pattern: PATTERN.vp9 },
    range: 90, penetration: 0.35, suppressed: false, sound: { profile: 'smg', pitch: 1.0 }, model: 'vp9',
  },
  smg_qx90: {
    id: 'smg_qx90', name: 'QX-90', cls: 'smg', slot: 'primary', unlockLevel: 4,
    description: 'Bullpup mit 50-Schuss-Magazin, das quer über dem Lauf liegt. Auf Türrahmen-Distanz die schnellste Waffe im Arsenal – dahinter verpufft ihre Wirkung rasch.',
    damage: { max: 25, min: 14, rangeStart: 10, rangeEnd: 22 }, headMult: 1.25, limbMult: 0.9, pellets: 1,
    rpm: 920, fireMode: 'auto', burstCount: 1, mag: 50, reserve: 150,
    reloadTime: 2.75, reloadEmptyTime: 3.35, perShellReload: false,
    equipTime: 0.5, adsTime: 0.18, adsZoom: 1.25, sight: 'reddot', scope: { zoom: 1.25, overlay: 'reddot' }, sprintToFire: 0.13,
    moveSpeedMult: 1.0, adsMoveMult: 0.75, hipSpread: 0.034, adsSpread: 0.0045, moveSpreadMult: 1.2, jumpSpreadMult: 2.0,
    recoil: { vertical: 0.0052, horizontal: 0.0045, recovery: 12, firstShotMult: 1.0, pattern: PATTERN.qx90 },
    range: 90, penetration: 0.45, suppressed: false, sound: { profile: 'smg', pitch: 1.12 }, model: 'qx90',
  },
  lmg_hm60: {
    id: 'lmg_hm60', name: 'HM-60 Hammer', cls: 'lmg', slot: 'primary', unlockLevel: 12,
    description: 'Gurtgespeist, mit Zweibein und hundert Schuss Geduld. Der Hammer hält ganze Korridore dicht – solange ihn niemand beim langsamen Anlegen überrascht.',
    damage: { max: 28, min: 25, rangeStart: 32, rangeEnd: 65 }, headMult: 1.35, limbMult: 0.9, pellets: 1,
    rpm: 600, fireMode: 'auto', burstCount: 1, mag: 100, reserve: 200,
    reloadTime: 6.2, reloadEmptyTime: 7.4, perShellReload: false,
    equipTime: 0.95, adsTime: 0.45, adsZoom: 1.3, sight: 'iron', scope: null, sprintToFire: 0.38,
    moveSpeedMult: 0.85, adsMoveMult: 0.45, hipSpread: 0.075, adsSpread: 0.003, moveSpreadMult: 1.7, jumpSpreadMult: 3.0,
    recoil: { vertical: 0.0088, horizontal: 0.0052, recovery: 7, firstShotMult: 1.5, pattern: PATTERN.hm60 },
    range: 120, penetration: 0.8, suppressed: false, sound: { profile: 'lmg', pitch: 1.0 }, model: 'hm60',
  },
  mr_sk14: {
    id: 'mr_sk14', name: 'SK-14', cls: 'marksman', slot: 'primary', unlockLevel: 5,
    description: 'Halbautomatisches Präzisionsgewehr mit 2,4-fachem Kompaktzielfernrohr. Zwei saubere Treffer bis gut 40 Meter, ein dritter auf weite Sicht – mehr braucht es nicht.',
    damage: { max: 52, min: 38, rangeStart: 35, rangeEnd: 75 }, headMult: 1.6, limbMult: 0.85, pellets: 1,
    rpm: 250, fireMode: 'semi', burstCount: 1, mag: 12, reserve: 48,
    reloadTime: 2.3, reloadEmptyTime: 3.0, perShellReload: false,
    equipTime: 0.65, adsTime: 0.32, adsZoom: 2.4, sight: 'acog', scope: { zoom: 2.4, overlay: 'acog' }, sprintToFire: 0.25,
    moveSpeedMult: 0.92, adsMoveMult: 0.55, hipSpread: 0.07, adsSpread: 0.0008, moveSpreadMult: 1.8, jumpSpreadMult: 2.8,
    recoil: { vertical: 0.024, horizontal: 0.006, recovery: 9, firstShotMult: 1.0 },
    range: 130, penetration: 0.75, suppressed: false, sound: { profile: 'ar_heavy', pitch: 1.1 }, model: 'sk14',
  },
  sr_brecher: {
    id: 'sr_brecher', name: 'Brecher .338', cls: 'sniper', slot: 'primary', unlockLevel: 20,
    description: 'Repetierbüchse im Kaliber .338: Ein Treffer in Kopf oder Torso, und das Duell ist entschieden. Langsam im Anschlag, gnadenlos im Ergebnis.',
    damage: { max: 130, min: 105, rangeStart: 45, rangeEnd: 110 }, headMult: 1.5, limbMult: 0.7, pellets: 1,
    rpm: 46, fireMode: 'bolt', burstCount: 1, mag: 5, reserve: 25,
    reloadTime: 3.0, reloadEmptyTime: 3.9, perShellReload: false,
    equipTime: 0.85, adsTime: 0.48, adsZoom: 5.5, sight: 'sniper', scope: { zoom: 5.5, overlay: 'sniper' }, sprintToFire: 0.32,
    moveSpeedMult: 0.88, adsMoveMult: 0.4, hipSpread: 0.12, adsSpread: 0.0003, moveSpreadMult: 2.4, jumpSpreadMult: 3.5,
    recoil: { vertical: 0.05, horizontal: 0.01, recovery: 5, firstShotMult: 1.0 },
    range: 160, penetration: 0.95, suppressed: false, sound: { profile: 'sniper', pitch: 1.0 }, model: 'brecher',
  },
  sg_bulldog: {
    id: 'sg_bulldog', name: 'Bulldog 12', cls: 'shotgun', slot: 'primary', unlockLevel: 3,
    description: 'Vorderschaftrepetierer mit acht Schrotkugeln pro Patrone. Auf Armlänge endgültig, jenseits von fünfzehn Metern nur noch laut.',
    damage: { max: 16, min: 3.5, rangeStart: 3.5, rangeEnd: 18 }, headMult: 1.15, limbMult: 0.9, pellets: 8,
    rpm: 75, fireMode: 'pump', burstCount: 1, mag: 6, reserve: 30,
    reloadTime: 1.2, reloadEmptyTime: 3.6, perShellReload: true, shellTiming: { start: 0.3, insert: 0.48, end: 0.42 },
    equipTime: 0.6, adsTime: 0.24, adsZoom: 1.15, sight: 'iron', scope: null, sprintToFire: 0.16,
    moveSpeedMult: 0.97, adsMoveMult: 0.7, hipSpread: 0.06, adsSpread: 0.045, moveSpreadMult: 1.1, jumpSpreadMult: 1.6,
    recoil: { vertical: 0.04, horizontal: 0.012, recovery: 6, firstShotMult: 1.0 },
    range: 35, penetration: 0.15, suppressed: false, sound: { profile: 'shotgun', pitch: 1.0 }, model: 'bulldog',
  },
  pi_p9: {
    id: 'pi_p9', name: 'P-9 Kompakt', cls: 'pistol', slot: 'secondary', unlockLevel: 1,
    description: 'Fünfzehn Schuss, kaum Gewicht, blitzschnell gezogen. Die P-9 ist die verlässliche Antwort, wenn das Hauptmagazin leer ist.',
    damage: { max: 26, min: 18, rangeStart: 12, rangeEnd: 28 }, headMult: 1.4, limbMult: 0.9, pellets: 1,
    rpm: 420, fireMode: 'semi', burstCount: 1, mag: 15, reserve: 60,
    reloadTime: 1.45, reloadEmptyTime: 1.85, perShellReload: false,
    equipTime: 0.32, adsTime: 0.14, adsZoom: 1.15, sight: 'iron', scope: null, sprintToFire: 0.09,
    moveSpeedMult: 1.05, adsMoveMult: 0.85, hipSpread: 0.026, adsSpread: 0.003, moveSpreadMult: 1.15, jumpSpreadMult: 1.8,
    recoil: { vertical: 0.011, horizontal: 0.004, recovery: 13, firstShotMult: 1.0 },
    range: 70, penetration: 0.3, suppressed: false, sound: { profile: 'pistol', pitch: 1.04 }, model: 'p9',
  },
  pi_adler: {
    id: 'pi_adler', name: 'Adler .50', cls: 'pistol', slot: 'secondary', unlockLevel: 7,
    description: 'Großkalibrige Pistole mit sieben Patronen und spürbarem Hochschlag. Drei Treffer genügen auf kurze Distanz – zwei, wenn der erste den Kopf findet.',
    damage: { max: 42, min: 28, rangeStart: 10, rangeEnd: 30 }, headMult: 1.5, limbMult: 0.9, pellets: 1,
    rpm: 240, fireMode: 'semi', burstCount: 1, mag: 7, reserve: 35,
    reloadTime: 1.9, reloadEmptyTime: 2.35, perShellReload: false,
    equipTime: 0.42, adsTime: 0.17, adsZoom: 1.15, sight: 'iron', scope: null, sprintToFire: 0.11,
    moveSpeedMult: 1.05, adsMoveMult: 0.8, hipSpread: 0.034, adsSpread: 0.0035, moveSpreadMult: 1.25, jumpSpreadMult: 2.0,
    recoil: { vertical: 0.03, horizontal: 0.009, recovery: 8, firstShotMult: 1.0 },
    range: 80, penetration: 0.55, suppressed: false, sound: { profile: 'pistol_heavy', pitch: 0.95 }, model: 'adler',
  },
  knife: {
    id: 'knife', name: 'Kampfmesser', cls: 'melee', slot: 'melee', unlockLevel: 1,
    description: 'Immer dabei, nie leer. Ein Stoß aus nächster Nähe beendet jedes Gefecht – lautlos und endgültig.',
    damage: { max: 135, min: 135, rangeStart: 0, rangeEnd: 2.4 }, headMult: 1, limbMult: 1, pellets: 1,
    rpm: 80, fireMode: 'semi', burstCount: 1, mag: 0, reserve: 0,
    reloadTime: 0, reloadEmptyTime: 0, perShellReload: false,
    equipTime: 0.25, adsTime: 0, adsZoom: 1, sight: 'none', scope: null, sprintToFire: 0.05,
    moveSpeedMult: 1.07, adsMoveMult: 1, hipSpread: 0, adsSpread: 0, moveSpreadMult: 1, jumpSpreadMult: 1,
    recoil: { vertical: 0, horizontal: 0, recovery: 10, firstShotMult: 1 },
    // Nahkampf: Treffer im Kegel `arc` (rad) bis `range`; Ausfallschritt bis `lungeRange` mit `lungeSpeed` m/s.
    melee: { range: 2.4, lungeRange: 4.5, lungeSpeed: 10, arc: 0.6, swingTime: 0.75, hitDelay: 0.14 },
    range: 2.4, penetration: 0, suppressed: true, sound: { profile: 'melee_swing', pitch: 1.0 }, model: 'knife',
  },
};

/** Reihenfolge = Roster-Tabelle des Vertrags. */
export const WEAPON_IDS = ['ar_kv47', 'ar_m17', 'smg_vp9', 'smg_qx90', 'lmg_hm60', 'mr_sk14', 'sr_brecher', 'sg_bulldog', 'pi_p9', 'pi_adler', 'knife'];

export const WEAPONS = {};
for (const id of WEAPON_IDS) {
  const def = RAW[id];
  def.adsFov = round(adsFovFor(def), 1);
  def.icon = ICONS[def.model];
  def.stats = computeStats(def);
  WEAPONS[id] = def;
}

/* -------------------------------------------------------------- Ausrüstung */

/**
 * Explosionsschaden: bis innerRadius = maxDamage, linear bis radius auf minDamage, außerhalb 0
 * (→ explosionDamageAt). Physik: throwSpeed m/s, Wurf leicht nach oben (throwPitch rad),
 * bounciness/friction für Abpraller; sticky = haftet am ersten Kontakt (auch an Actors).
 * cookable: Zünder läuft ab Abziehen des Splints (Halten verkürzt die Restzeit).
 */
export const EQUIPMENT = {
  frag: {
    id: 'frag', name: 'Splittergranate', short: 'Splitter', kind: 'lethal', unlockLevel: 1,
    description: 'Klassische Splittergranate mit 2,8 Sekunden Zündverzögerung. Kurz halten, um sie vorzukochen – oder über die Kante rollen lassen und Deckungen räumen.',
    count: 1, fuse: 2.8, cookable: true, radius: 6.5, innerRadius: 1.5, maxDamage: 150, minDamage: 20,
    throwSpeed: 18, throwPitch: 0.18, bounciness: 0.38, friction: 0.55, sticky: false,
    model: 'frag', sound: 'explosion', icon: ICONS.frag,
  },
  semtex: {
    id: 'semtex', name: 'Haftgranate', short: 'Haft', kind: 'lethal', unlockLevel: 9,
    description: 'Haftet an jeder Oberfläche – und an jedem Gegner. Kürzere Zündzeit, kleinerer Radius, keine zweite Chance.',
    count: 1, fuse: 2.2, cookable: false, radius: 5.5, innerRadius: 1.5, maxDamage: 160, minDamage: 25,
    throwSpeed: 16, throwPitch: 0.15, bounciness: 0, friction: 1, sticky: true,
    model: 'semtex', sound: 'explosion', icon: ICONS.semtex,
  },
};

export const EQUIPMENT_IDS = ['frag', 'semtex'];

/** Explosionsschaden auf `distance` Meter (ohne Deckungsprüfung). */
export function explosionDamageAt(eq, distance) {
  if (distance >= eq.radius) return 0;
  if (distance <= eq.innerRadius) return eq.maxDamage;
  const t = (distance - eq.innerRadius) / (eq.radius - eq.innerRadius);
  return eq.maxDamage + (eq.minDamage - eq.maxDamage) * t;
}

/** Radius (m), in dem eine Explosion 100 HP sicher ausschaltet. */
export function explosionKillRadius(eq) {
  if (eq.maxDamage < MAX_HEALTH) return 0;
  const t = (eq.maxDamage - MAX_HEALTH) / (eq.maxDamage - eq.minDamage);
  return eq.innerRadius + t * (eq.radius - eq.innerRadius);
}

/* ---------------------------------------------------------------- Loadouts */

export const DEFAULT_LOADOUTS = [
  { id: 'sturm', name: 'Sturm', primary: 'ar_m17', secondary: 'pi_p9', lethal: 'frag',
    description: 'Ausgewogen nach vorn: Der Falke hält jede Distanz, die P-9 rettet den Rest.' },
  { id: 'schatten', name: 'Schatten', primary: 'smg_vp9', secondary: 'pi_p9', lethal: 'frag',
    description: 'Flanken, Hintereingänge, kurze Wege – auftauchen, zuschlagen, verschwinden.' },
  { id: 'allrounder', name: 'Allrounder', primary: 'ar_kv47', secondary: 'pi_p9', lethal: 'frag',
    description: 'Wucht auf jede Entfernung. Wer den Rückstoß beherrscht, braucht nichts anderes.' },
  { id: 'nahkampf', name: 'Nahkampf', primary: 'sg_bulldog', secondary: 'pi_p9', lethal: 'frag',
    description: 'Für Gebäude, Treppen und enge Gassen. Ein Schuss pro Raum.' },
  { id: 'blitz', name: 'Blitz', primary: 'smg_qx90', secondary: 'pi_p9', lethal: 'frag',
    description: 'Fünfzig Schuss Vollgas. Kein Plan, nur Tempo.' },
  { id: 'schuetze', name: 'Schütze', primary: 'mr_sk14', secondary: 'pi_p9', lethal: 'frag',
    description: 'Lange Achsen kontrollieren, zwei Treffer setzen, Position wechseln.' },
  { id: 'unterstuetzung', name: 'Unterstützung', primary: 'lmg_hm60', secondary: 'pi_adler', lethal: 'semtex',
    description: 'Hundert Schuss Sperrfeuer, um dem Team den Weg freizuhalten.' },
  { id: 'praezision', name: 'Präzision', primary: 'sr_brecher', secondary: 'pi_p9', lethal: 'semtex',
    description: 'Ein Schuss, ein Abschuss. Für Geduldige mit ruhiger Hand.' },
];
for (const l of DEFAULT_LOADOUTS) {
  l.unlockLevel = Math.max(RAW[l.primary].unlockLevel, RAW[l.secondary].unlockLevel, EQUIPMENT[l.lethal].unlockLevel);
}

/** Gun-Game-Stufen (§7 des Vertrags): 18 Stufen, letzte = Messer. */
export const GUN_GAME_STEPS = [
  'smg_vp9', 'smg_qx90', 'ar_m17', 'ar_kv47', 'lmg_hm60', 'mr_sk14', 'sg_bulldog', 'sr_brecher', 'pi_adler', 'pi_p9',
  'smg_vp9', 'ar_m17', 'ar_kv47', 'sg_bulldog', 'mr_sk14', 'sr_brecher', 'pi_adler', 'knife',
];

/* ------------------------------------------------------------ Abfragen */

export function getWeapon(id) {
  return WEAPONS[id] || null;
}

export function getEquipment(id) {
  return EQUIPMENT[id] || null;
}

export function getLoadout(id) {
  return DEFAULT_LOADOUTS.find((l) => l.id === id) || null;
}

/** [{ cls, name, weapons: [def…] }] in CLASS_ORDER; leere Klassen entfallen. */
export function listByClass() {
  return CLASS_ORDER.map((cls) => ({
    cls,
    name: WEAPON_CLASSES[cls],
    weapons: WEAPON_IDS.map((id) => WEAPONS[id]).filter((w) => w.cls === cls),
  })).filter((g) => g.weapons.length > 0);
}

/** Alle Waffen eines Slots ('primary' | 'secondary' | 'melee'). */
export function listBySlot(slot) {
  return WEAPON_IDS.map((id) => WEAPONS[id]).filter((w) => w.slot === slot);
}

/** Freischaltungen nach Level: [{ level, id, kind: 'weapon'|'equipment', name }] aufsteigend. */
export const UNLOCKS = [
  ...WEAPON_IDS.map((id) => ({ level: WEAPONS[id].unlockLevel, id, kind: 'weapon', name: WEAPONS[id].name })),
  ...EQUIPMENT_IDS.map((id) => ({ level: EQUIPMENT[id].unlockLevel, id, kind: 'equipment', name: EQUIPMENT[id].name })),
].sort((a, b) => a.level - b.level);

/** Ids, die beim Aufstieg von levelBefore auf levelAfter neu freigeschaltet werden. */
export function unlocksBetween(levelBefore, levelAfter) {
  return UNLOCKS.filter((u) => u.level > levelBefore && u.level <= levelAfter).map((u) => u.id);
}

/** Ist eine Waffe/Ausrüstung auf `level` verfügbar? */
export function isUnlocked(id, level) {
  const def = WEAPONS[id] || EQUIPMENT[id];
  return !!def && def.unlockLevel <= level;
}
