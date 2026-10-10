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
 *  scopeSway     optional: Schwanken des Zielfernrohrs im Anschlag (rad, Achterfigur); Atem anhalten
 *                (Shift / Touch automatisch) beruhigt es für einige Sekunden.
 *                Optional (Rückstoß 2.0): visual – Stärke des sichtbaren Waffen-/Kamerastoßes relativ zum
 *                Zielrückstoß (Standard 1); firstShotSpread – Faktor auf den Streukegel des ersten Schusses
 *                (aus der Ruhe, Standard 1 = wie jeder andere Schuss).
 *  handling      Waffengefühl (Ego-Ansicht, Wandkollision, Zielwandern) – fehlt es (neue Waffe, abgeleitete
 *                Definition), liefert weaponHandling(def) Klassenwerte:
 *                  mass      Masse in kg (Trägheit, Nachlauf und Federfrequenz der Waffe)
 *                  inertia   Nachlauf der Waffe hinter der Kameradrehung (1 = Sturmgewehr)
 *                  swayScale Ausschlag von Wippen/Schwanken (1 = Sturmgewehr)
 *                  aimDrift  Zielwandern im Anschlag im Stand (rad, Rauschen; × Atemnot nach dem Sprint)
 *                  reach     Tiefe der vordersten Waffenkante vor dem Auge in Metern (Hüfte/Anschlag, gemessen am
 *                            Modell; Wandkollision: ab dieser Wandtiefe wird die Waffe angezogen bzw. abgesenkt)
 *  sound         { profile, pitch } – profile ist ein Audio-Profil aus §7.
 *  killAmmo      optional: Schuss je Abschuss (Raum-/Spieleinstellung „Munition pro Abschuss“, weapons/index.js).
 *                Fehlt der Wert, gilt die Standardregel aus killAmmoFor(def): ein Magazin; Gurt-/Trommel-MGs (lmg,
 *                mag ≥ 60) 20 Schuss direkt in Gurt/Trommel (Rest in den Vorrat); Werfer und Nahkampf 0 (dann geht
 *                die Munition an die gehaltene bzw. erste Schusswaffe). Vorrat höchstens reserve + mag.
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
  launcher: 'Raketenwerfer',
};

/** Anzeige-Reihenfolge der Klassen (Lobby, Website). */
export const CLASS_ORDER = ['ar', 'smg', 'lmg', 'marksman', 'sniper', 'shotgun', 'pistol', 'launcher', 'melee'];

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
  launcher: { short: 'RW', role: 'Panzerabwehr für Pioniere: knackt Fahrzeuge, räumt Stellungen – langsam nachgeladen.' },
};

export const FIRE_MODES = {
  auto: 'Vollautomatisch',
  semi: 'Halbautomatisch',
  burst: 'Feuerstoß',
  bolt: 'Repetierer',
  pump: 'Vorderschaftrepetierer',
  single: 'Einzellader',
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
  k36: gunIcon(
    'M8 12H18V18H11L8 16Z M18 13H24 M24 10H48V17H24Z M26 8H58 M33 8V4.5H41V8 M30 17L28 24H32L34 17 ' +
    'M37 17L36 25H42L43 17 M48 10.5H62V16.5H48Z M62 13.5H74 M74 12V15'),
  bx20: gunIcon(
    'M6 12H12V20H6Z M12 11H56V19H12Z M20 19L19 27H26L27 19 M40 19L38 26H42L44 19 M34 19Q34 23 38 23 ' +
    'M22 11V6H46V11 M28 6V4H40V6 M56 12.5H76V17H56Z M76 14.5H88 M88 13V16'),
  g7: gunIcon(
    'M4 12L20 11V18L6 21Z M20 10H52V17H20Z M24 10V7.5 M28 17L26 24H30L32 17 M36 17V25H44V17 ' +
    'M52 10.5H72V16H52Z M72 13H90 M90 11.5V14.5 M62 10.5V7 M24 7.5H28'),
  wespe: gunIcon(
    'M14 11H20V14H14 M20 9H54V16H20Z M30 16L28 28H36L38 16 M30 21H37 M42 16Q43 21 48 21V16 ' +
    'M54 10.5H66V14.5H54Z M66 12.5H72 M24 9V6.5H34V9 M8 12H14'),
  keiler: gunIcon(
    'M6 11H18V18H8L6 16Z M18 12H22 M22 9H58V18H22Z M30 18L28 25H33L35 18 M42 18L41 28H48L49 18 ' +
    'M58 10H72V17H58Z M72 13.5H80 M80 12V15 M30 9V5.5H42V9'),
  lm8: gunIcon(
    'M4 13L20 11V18L6 21Z M20 10H54V17H20Z M28 17L26 24H30L32 17 M38 21A6 6 0 1 0 50 21A6 6 0 1 0 38 21 ' +
    'M54 11H74V16H54Z M74 13.5H90 M90 12V15 M78 14L74 26 M78 14L83 26 M24 10V7.5'),
  titan: gunIcon(
    'M4 13H24V19H16L12 25H6L4 21Z M24 11H58V18H24Z M28 8H56 M28 5H56V8H28Z M56 4.5L62 3.5V9.5L56 8.5 ' +
    'M34 18V23H42V18 M44 18V24H52V18 M58 12H86V16H58Z M86 11H94V17H86Z M66 16L62 27 M66 16L71 27'),
  hagel: gunIcon(
    'M4 13L22 11V17L6 21Z M22 10H50V17H22Z M28 17L26 24H30L32 17 M36 17V27H46V17 M50 11H80V15H50 ' +
    'M50 16H74V17.5 M80 10.5V9 M30 10V8H42V10'),
  kobra: gunIcon(
    'M24 15L20 28H30L33 18 M30 18Q31 22 36 22Q39 22 40 18 M30 10H40V18H30Z M32 11.5H38 M32 16.5H38 ' +
    'M40 11H76V15H40Z M40 15H64V17H40 M74 11V9 M26 12L22 10 M30 10L28 7'),
  donner: gunIcon(
    'M4 13H70V18H4Z M70 11.5L80 9V22L70 19.5 M80 10L92 15.5L80 21 M26 18L24 27H30L32 18 M46 18L45 26H50L51 18 ' +
    'M34 13V8H42V13 M12 12V19'),
  karambit: gunIcon(
    'M30 13H52Q55 13 55 16V18Q55 20 52 20H30Q27 20 27 17Q27 13 30 13Z M25 16.5A3.5 3.5 0 1 0 25 16.6 ' +
    'M55 12V21 M55 15Q70 12 76 20Q71 18 62 19Q58 19 55 18'),
  machete: gunIcon(
    'M8 14H30Q32 14 32 16V18Q32 20 30 20H8Q6 20 6 17Q6 14 8 14Z M32 12V22 M32 14H80Q90 14 92 18Q86 21 78 21H32'),
  tomahawk: gunIcon(
    'M8 16H66V19H8Z M8 15V20 M66 10Q70 6 74 6V29Q70 29 66 25Z M62 11L66 13 M62 24L66 22 M66 15H58V20H66'),
  impact: smallIcon(
    '<rect x="7" y="9" width="10" height="12" rx="2"/><path d="M9 9V6H15V9 M7 13H17 M7 17H17 M12 21V23 M9 23H15"/>'),
  molotov: smallIcon(
    '<path d="M9 22H15Q17 22 17 20V13Q17 11 14.5 10V7H9.5V10Q7 11 7 13V20Q7 22 9 22Z M10 7Q9 4 12 2Q11 5 14 5"/>' +
    '<path d="M7 15H17" opacity=".6"/>'),
  flash: smallIcon(
    '<rect x="7.5" y="8" width="9" height="13" rx="1.5"/><path d="M9.5 8V5.5H14.5V8 M7.5 11H16.5 M7.5 18H16.5 M10 13.5V15.5 M14 13.5V15.5 ' +
    'M3 6L5 7.5 M21 6L19 7.5 M2 13H4.5 M22 13H19.5"/>'),
  smoke: smallIcon(
    '<rect x="7.5" y="9" width="9" height="13" rx="1.5"/><path d="M9.5 9V6.5H14.5V9 M7.5 12H16.5 M7.5 19H16.5"/>' +
    '<path d="M14 5Q17 2 20 4Q23 3 22 7Q20 9 17 7" opacity=".7"/>'),
  netz: smallIcon(
    '<path d="M3 20Q12 2 21 20 M6 14H18 M4.5 17H19.5 M8.5 9.5H15.5 M12 4V20 M8 7L5 20 M16 7L19 20"/>' +
    '<circle cx="3" cy="20" r="1.2"/><circle cx="21" cy="20" r="1.2"/><circle cx="12" cy="21" r="1.2"/>'),
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

/**
 * Waffengefühl je Klasse (Rückfall für Waffen ohne eigenes `handling`, z. B. neue oder abgeleitete Definitionen).
 * Felder siehe Kopfkommentar.
 */
export const HANDLING_BY_CLASS = {
  ar: { mass: 3.5, inertia: 1.0, swayScale: 1.0, aimDrift: 0.0005, reach: 1.0 },
  smg: { mass: 2.8, inertia: 0.8, swayScale: 0.9, aimDrift: 0.0004, reach: 0.8 },
  lmg: { mass: 8.0, inertia: 1.55, swayScale: 1.2, aimDrift: 0.0009, reach: 1.25 },
  marksman: { mass: 4.5, inertia: 1.2, swayScale: 1.1, aimDrift: 0.0005, reach: 1.1 },
  sniper: { mass: 6.2, inertia: 1.4, swayScale: 1.15, aimDrift: 0.0005, reach: 1.35 },
  shotgun: { mass: 3.6, inertia: 1.1, swayScale: 1.05, aimDrift: 0.0005, reach: 1.1 },
  pistol: { mass: 1.0, inertia: 0.6, swayScale: 0.85, aimDrift: 0.0006, reach: 0.62 },
  melee: { mass: 0.3, inertia: 0.4, swayScale: 0.7, aimDrift: 0, reach: 0 },
};

/** Waffengefühl einer Definition: eigenes `handling`, sonst Klassenwerte (immer vollständig). */
export function weaponHandling(def) {
  const base = HANDLING_BY_CLASS[def && def.cls] || HANDLING_BY_CLASS.ar;
  const h = def && def.handling;
  return h ? { ...base, ...h } : base;
}

/** Munition pro Abschuss: Schuss für Gurt-/Trommel-MGs (lmg, mag ≥ 60), wenn die Waffe kein eigenes killAmmo hat. */
export const KILL_AMMO_BELT = 20;

/**
 * Munition pro Abschuss einer Waffe (Feld killAmmo, sonst Standardregel – siehe Kopfkommentar).
 * → { amount (Schuss, 0 = keine), belt (zuerst direkt in Gurt/Trommel), cap (Obergrenze des Vorrats) }
 */
export function killAmmoFor(def) {
  if (!def || def.cls === 'melee' || !(def.mag > 0)) return { amount: 0, belt: false, cap: 0 };
  const belt = def.cls === 'lmg' && def.mag >= 60;
  const own = Number.isFinite(def.killAmmo) ? Math.max(0, Math.round(def.killAmmo)) : null;
  const amount = own != null ? own : def.cls === 'launcher' ? 0 : belt ? KILL_AMMO_BELT : def.mag;
  return { amount, belt, cap: (def.reserve || 0) + def.mag };
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
  k36: [[0, 1], [0.15, 1], [0.3, 0.95], [0.1, 0.95], [-0.2, 0.9], [-0.35, 0.9], [-0.1, 0.85], [0.2, 0.85]],
  bx20: [[0, 1], [0.05, 1], [-0.1, 0.95], [-0.2, 0.95], [-0.05, 0.9], [0.15, 0.9], [0.25, 0.85], [0.05, 0.85]],
  g7: [[0, 1.1], [0.25, 1.1], [0.5, 1.05], [0.35, 1], [0, 1], [-0.4, 0.95], [-0.55, 0.95], [-0.2, 0.9], [0.3, 0.9]],
  wespe: [[0, 1], [0.5, 0.9], [-0.4, 0.9], [0.6, 0.85], [-0.6, 0.85], [0.4, 0.8], [-0.3, 0.8], [0.5, 0.8]],
  keiler: [[0, 1.1], [-0.2, 1.05], [-0.35, 1], [-0.1, 0.95], [0.25, 0.9], [0.35, 0.9], [0.1, 0.85], [-0.2, 0.85]],
  lm8: [[0, 1.3], [0.2, 1.2], [0.4, 1.05], [0.3, 0.95], [-0.1, 0.85], [-0.35, 0.8], [-0.15, 0.75], [0.25, 0.75]],
};

// Waffengefühl je Waffe (siehe Kopfkommentar „handling“; Massen etwa realer Vorbilder mit Optik und Magazin)
// und Charakter des Rückstoßes (recoil.visual: sichtbarer Stoß relativ zum Zielrückstoß, recoil.firstShotSpread).
const FEEL = {
  ar_kv47: { handling: { mass: 3.9, inertia: 1.05, swayScale: 1.05, aimDrift: 0.00055, reach: 1.14 }, recoil: { visual: 1.15, firstShotSpread: 0.8 } },
  ar_m17: { handling: { mass: 3.3, inertia: 0.95, swayScale: 1.0, aimDrift: 0.00045, reach: 0.95 }, recoil: { visual: 0.95, firstShotSpread: 0.7 } },
  smg_vp9: { handling: { mass: 2.9, inertia: 0.82, swayScale: 0.9, aimDrift: 0.0004, reach: 0.88 }, recoil: { visual: 0.9, firstShotSpread: 0.8 } },
  smg_qx90: { handling: { mass: 2.8, inertia: 0.75, swayScale: 0.9, aimDrift: 0.0004, reach: 0.75 }, recoil: { visual: 0.85, firstShotSpread: 0.85 } },
  lmg_hm60: { handling: { mass: 8.6, inertia: 1.6, swayScale: 1.25, aimDrift: 0.0009, reach: 1.39 }, recoil: { visual: 1.1, firstShotSpread: 0.85 } },
  mr_sk14: { handling: { mass: 4.6, inertia: 1.2, swayScale: 1.1, aimDrift: 0, reach: 1.08 }, recoil: { visual: 1.0, firstShotSpread: 0.6 } },
  sr_brecher: { handling: { mass: 6.4, inertia: 1.4, swayScale: 1.15, aimDrift: 0, reach: 1.34 }, recoil: { visual: 1.0, firstShotSpread: 1 } },
  sg_bulldog: { handling: { mass: 3.6, inertia: 1.1, swayScale: 1.05, aimDrift: 0.0005, reach: 1.06 }, recoil: { visual: 1.1, firstShotSpread: 1 } },
  pi_p9: { handling: { mass: 0.75, inertia: 0.55, swayScale: 0.8, aimDrift: 0.0006, reach: 0.56 }, recoil: { visual: 1.0, firstShotSpread: 0.75 } },
  pi_adler: { handling: { mass: 2.0, inertia: 0.7, swayScale: 0.9, aimDrift: 0.0007, reach: 0.66 }, recoil: { visual: 1.2, firstShotSpread: 0.75 } },
  knife: { handling: { mass: 0.3, inertia: 0.4, swayScale: 0.7, aimDrift: 0, reach: 0 } },
  ar_k36: { handling: { mass: 2.9, inertia: 0.88, swayScale: 0.95, aimDrift: 0.00045, reach: 0.84 }, recoil: { visual: 0.95, firstShotSpread: 0.75 } },
  ar_bx20: { handling: { mass: 3.7, inertia: 0.92, swayScale: 0.95, aimDrift: 0.0004, reach: 0.92 }, recoil: { visual: 0.9, firstShotSpread: 0.7 } },
  ar_g7: { handling: { mass: 4.6, inertia: 1.15, swayScale: 1.1, aimDrift: 0.0006, reach: 1.1 }, recoil: { visual: 1.25, firstShotSpread: 0.75 } },
  smg_wespe: { handling: { mass: 2.1, inertia: 0.65, swayScale: 0.85, aimDrift: 0.00045, reach: 0.65 }, recoil: { visual: 0.8, firstShotSpread: 0.9 } },
  smg_keiler: { handling: { mass: 3.0, inertia: 0.85, swayScale: 0.92, aimDrift: 0.0004, reach: 0.81 }, recoil: { visual: 1.0, firstShotSpread: 0.8 } },
  lmg_lm8: { handling: { mass: 6.2, inertia: 1.35, swayScale: 1.15, aimDrift: 0.0008, reach: 1.09 }, recoil: { visual: 1.05, firstShotSpread: 0.85 } },
  sr_titan: { handling: { mass: 12.5, inertia: 1.75, swayScale: 1.3, aimDrift: 0, reach: 1.35 }, recoil: { visual: 1.0, firstShotSpread: 1 } },
  sg_hagel: { handling: { mass: 3.9, inertia: 1.1, swayScale: 1.05, aimDrift: 0.0005, reach: 1.17 }, recoil: { visual: 1.05, firstShotSpread: 1 } },
  pi_kobra: { handling: { mass: 1.3, inertia: 0.65, swayScale: 0.88, aimDrift: 0.0007, reach: 0.64 }, recoil: { visual: 1.25, firstShotSpread: 0.75 } },
  at_donner: { handling: { mass: 7.0, inertia: 1.45, swayScale: 1.2, aimDrift: 0.0008, reach: 1.26 }, recoil: { visual: 1.0, firstShotSpread: 1 } },
  karambit: { handling: { mass: 0.2, inertia: 0.35, swayScale: 0.65, aimDrift: 0, reach: 0 } },
  machete: { handling: { mass: 0.6, inertia: 0.5, swayScale: 0.75, aimDrift: 0, reach: 0 } },
  tomahawk: { handling: { mass: 0.7, inertia: 0.55, swayScale: 0.78, aimDrift: 0, reach: 0 } },
};

const RAW = {
  ar_kv47: {
    id: 'ar_kv47', name: 'KV-47', cls: 'ar', slot: 'primary', unlockLevel: 2,
    description: 'Schwerer Rückstoß, ehrlicher Treffer: Das KV-47 schlägt mit jeder Kugel hart zu und verliert auch über lange Achsen kaum an Wucht. Wer die Mündung bändigt, gewinnt fast jedes Duell auf mittlere Distanz.',
    damage: { max: 33, min: 24, rangeStart: 24, rangeEnd: 50 }, headMult: 1.4, limbMult: 0.9, pellets: 1,
    rpm: 560, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 120,
    reloadTime: 2.35, reloadEmptyTime: 3.05, perShellReload: false,
    equipTime: 0.6, adsTime: 0.26, adsZoom: 1.25, sight: 'iron', scope: null, sprintToFire: 0.2,
    moveSpeedMult: 0.95, adsMoveMult: 0.6, hipSpread: 0.052, adsSpread: 0.0034, moveSpreadMult: 1.5, jumpSpreadMult: 2.6,
    recoil: { vertical: 0.0088, horizontal: 0.0044, recovery: 8, firstShotMult: 1.25, pattern: PATTERN.kv47 },
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
    recoil: { vertical: 0.0064, horizontal: 0.0026, recovery: 10, firstShotMult: 1.1, pattern: PATTERN.m17 },
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
    recoil: { vertical: 0.0049, horizontal: 0.003, recovery: 12, firstShotMult: 1.0, pattern: PATTERN.vp9 },
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
    recoil: { vertical: 0.0044, horizontal: 0.0042, recovery: 12, firstShotMult: 1.0, pattern: PATTERN.qx90 },
    range: 90, penetration: 0.45, suppressed: false, sound: { profile: 'smg', pitch: 1.12 }, model: 'qx90',
  },
  lmg_hm60: {
    id: 'lmg_hm60', name: 'HM-60 Hammer', cls: 'lmg', slot: 'primary', unlockLevel: 12,
    description: 'Gurtgespeist, mit Zweibein und hundert Schuss Geduld. Der Hammer hält ganze Korridore dicht – solange ihn niemand beim langsamen Anlegen überrascht.',
    damage: { max: 28, min: 24, rangeStart: 32, rangeEnd: 65 }, headMult: 1.35, limbMult: 0.9, pellets: 1,
    rpm: 600, fireMode: 'auto', burstCount: 1, mag: 100, reserve: 200, killAmmo: 20,
    reloadTime: 6.2, reloadEmptyTime: 7.4, perShellReload: false,
    equipTime: 0.95, adsTime: 0.45, adsZoom: 1.3, sight: 'iron', scope: null, sprintToFire: 0.38,
    moveSpeedMult: 0.85, adsMoveMult: 0.45, hipSpread: 0.075, adsSpread: 0.003, moveSpreadMult: 1.7, jumpSpreadMult: 3.0,
    recoil: { vertical: 0.0074, horizontal: 0.0048, recovery: 7, firstShotMult: 1.5, pattern: PATTERN.hm60 },
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
    recoil: { vertical: 0.024, horizontal: 0.006, recovery: 9, firstShotMult: 1.0 }, scopeSway: 0.0016,
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
    recoil: { vertical: 0.05, horizontal: 0.01, recovery: 5, firstShotMult: 1.0 }, scopeSway: 0.007,
    range: 160, penetration: 0.95, suppressed: false, sound: { profile: 'sniper', pitch: 1.0 }, model: 'brecher',
  },
  sg_bulldog: {
    id: 'sg_bulldog', name: 'Bulldog 12', cls: 'shotgun', slot: 'primary', unlockLevel: 3,
    description: 'Vorderschaftrepetierer mit acht Schrotkugeln pro Patrone. Auf Armlänge endgültig, jenseits von fünfzehn Metern nur noch laut.',
    damage: { max: 18, min: 4, rangeStart: 5, rangeEnd: 20 }, headMult: 1.15, limbMult: 0.9, pellets: 8,
    rpm: 75, fireMode: 'pump', burstCount: 1, mag: 6, reserve: 30,
    reloadTime: 1.2, reloadEmptyTime: 3.6, perShellReload: true, shellTiming: { start: 0.3, insert: 0.48, end: 0.42 },
    equipTime: 0.6, adsTime: 0.24, adsZoom: 1.15, sight: 'iron', scope: null, sprintToFire: 0.16,
    moveSpeedMult: 0.97, adsMoveMult: 0.7, hipSpread: 0.056, adsSpread: 0.04, moveSpreadMult: 1.1, jumpSpreadMult: 1.6,
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
    description: 'Immer dabei, nie leer. Zwei Stiche beenden jedes Gefecht, von hinten reicht einer – lautlos.',
    damage: { max: 60, min: 60, rangeStart: 0, rangeEnd: 2.4 }, headMult: 1, limbMult: 1, pellets: 1,
    rpm: 80, fireMode: 'semi', burstCount: 1, mag: 0, reserve: 0,
    reloadTime: 0, reloadEmptyTime: 0, perShellReload: false,
    equipTime: 0.25, adsTime: 0, adsZoom: 1, sight: 'none', scope: null, sprintToFire: 0.05,
    moveSpeedMult: 1.07, adsMoveMult: 1, hipSpread: 0, adsSpread: 0, moveSpreadMult: 1, jumpSpreadMult: 1,
    recoil: { vertical: 0, horizontal: 0, recovery: 10, firstShotMult: 1 },
    // Nahkampf: Treffer im Kegel `arc` (rad) bis `range`; Ausfallschritt bis `lungeRange` mit `lungeSpeed` m/s.
    melee: { range: 2.4, lungeRange: 4.5, lungeSpeed: 10, arc: 0.6, swingTime: 0.75, hitDelay: 0.14, style: 'slash' },
    range: 2.4, penetration: 0, suppressed: true, sound: { profile: 'melee_swing', pitch: 1.0 }, model: 'knife',
  },
  // ------------------------------------------------------------ Welle 2 (Arsenal)
  ar_k36: {
    id: 'ar_k36', name: 'K-36 Kurzer', cls: 'ar', slot: 'primary', unlockLevel: 6,
    description: 'Karabiner mit kurzem Lauf und Rotpunkt: schneller im Anschlag als jedes Sturmgewehr, ruhig im Dauerfeuer – auf lange Achsen verliert er dafür früher an Wucht.',
    damage: { max: 24, min: 17, rangeStart: 18, rangeEnd: 38 }, headMult: 1.35, limbMult: 0.9, pellets: 1,
    rpm: 780, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 120,
    reloadTime: 1.95, reloadEmptyTime: 2.5, perShellReload: false,
    equipTime: 0.48, adsTime: 0.19, adsZoom: 1.3, sight: 'reddot', scope: { zoom: 1.3, overlay: 'reddot' }, sprintToFire: 0.15,
    moveSpeedMult: 0.98, adsMoveMult: 0.68, hipSpread: 0.04, adsSpread: 0.0028, moveSpreadMult: 1.35, jumpSpreadMult: 2.3,
    recoil: { vertical: 0.0058, horizontal: 0.0032, recovery: 11, firstShotMult: 1.05, pattern: PATTERN.k36 },
    range: 95, penetration: 0.5, suppressed: false, sound: { profile: 'ar', pitch: 1.07 }, model: 'k36',
  },
  ar_bx20: {
    id: 'ar_bx20', name: 'BX-20 Stier', cls: 'ar', slot: 'primary', unlockLevel: 14,
    description: 'Bullpup mit integrierter 1,6-fach-Optik: voller Gewehrlauf in kompaktem Gehäuse, präzise bis weit über die Platzmitte. Das Magazin sitzt hinter dem Griff – der Wechsel dauert.',
    damage: { max: 28, min: 21, rangeStart: 26, rangeEnd: 52 }, headMult: 1.35, limbMult: 0.9, pellets: 1,
    rpm: 650, fireMode: 'auto', burstCount: 1, mag: 30, reserve: 120,
    reloadTime: 2.6, reloadEmptyTime: 3.2, perShellReload: false,
    equipTime: 0.6, adsTime: 0.25, adsZoom: 1.6, sight: 'acog', scope: { zoom: 1.6, overlay: 'acog' }, sprintToFire: 0.19,
    moveSpeedMult: 0.95, adsMoveMult: 0.6, hipSpread: 0.045, adsSpread: 0.0024, moveSpreadMult: 1.45, jumpSpreadMult: 2.5,
    recoil: { vertical: 0.0066, horizontal: 0.0028, recovery: 10, firstShotMult: 1.1, pattern: PATTERN.bx20 },
    range: 115, penetration: 0.6, suppressed: false, sound: { profile: 'ar', pitch: 0.95 }, model: 'bx20',
  },
  ar_g7: {
    id: 'ar_g7', name: 'G-7 Wächter', cls: 'ar', slot: 'primary', unlockLevel: 18,
    description: 'Kampfgewehr im großen Kaliber: vier Treffer auf jede Distanz, durchschlägt Deckung, die andere aufhält. Zwanzig Schuss und ein Rückstoß, der Respekt verlangt.',
    damage: { max: 40, min: 32, rangeStart: 30, rangeEnd: 60 }, headMult: 1.45, limbMult: 0.9, pellets: 1,
    rpm: 450, fireMode: 'auto', burstCount: 1, mag: 20, reserve: 100,
    reloadTime: 2.5, reloadEmptyTime: 3.1, perShellReload: false,
    equipTime: 0.7, adsTime: 0.3, adsZoom: 1.3, sight: 'iron', scope: null, sprintToFire: 0.24,
    moveSpeedMult: 0.93, adsMoveMult: 0.55, hipSpread: 0.06, adsSpread: 0.003, moveSpreadMult: 1.6, jumpSpreadMult: 2.8,
    recoil: { vertical: 0.0125, horizontal: 0.0055, recovery: 7, firstShotMult: 1.3, pattern: PATTERN.g7 },
    range: 140, penetration: 0.85, suppressed: false, sound: { profile: 'ar_heavy', pitch: 0.88 }, model: 'g7',
  },
  smg_wespe: {
    id: 'smg_wespe', name: 'KM-7 Wespe', cls: 'smg', slot: 'primary', unlockLevel: 8,
    description: 'Winzige Maschinenpistole mit Magazin im Griff und über tausend Schuss pro Minute. Auf Türrahmen-Distanz ein Sturm – auf der Straße nur noch ein Summen.',
    damage: { max: 22, min: 13, rangeStart: 9, rangeEnd: 20 }, headMult: 1.25, limbMult: 0.9, pellets: 1,
    rpm: 1050, fireMode: 'auto', burstCount: 1, mag: 32, reserve: 160,
    reloadTime: 1.8, reloadEmptyTime: 2.3, perShellReload: false,
    equipTime: 0.38, adsTime: 0.15, adsZoom: 1.15, sight: 'iron', scope: null, sprintToFire: 0.1,
    moveSpeedMult: 1.03, adsMoveMult: 0.8, hipSpread: 0.034, adsSpread: 0.005, moveSpreadMult: 1.15, jumpSpreadMult: 1.9,
    recoil: { vertical: 0.0042, horizontal: 0.0046, recovery: 13, firstShotMult: 1.0, pattern: PATTERN.wespe },
    range: 70, penetration: 0.3, suppressed: false, sound: { profile: 'smg', pitch: 1.2 }, model: 'wespe',
  },
  smg_keiler: {
    id: 'smg_keiler', name: 'SM-45 Keiler', cls: 'smg', slot: 'primary', unlockLevel: 16,
    description: 'Schwere Maschinenpistole im Kaliber .45: langsamer Takt, dicke Treffer, kaum Mündungsfeuer. Vier Kugeln genügen bis in die Hofmitte.',
    damage: { max: 34, min: 22, rangeStart: 12, rangeEnd: 26 }, headMult: 1.3, limbMult: 0.9, pellets: 1,
    rpm: 560, fireMode: 'auto', burstCount: 1, mag: 25, reserve: 125,
    reloadTime: 2.1, reloadEmptyTime: 2.6, perShellReload: false,
    equipTime: 0.5, adsTime: 0.2, adsZoom: 1.25, sight: 'reddot', scope: { zoom: 1.25, overlay: 'reddot' }, sprintToFire: 0.13,
    moveSpeedMult: 0.99, adsMoveMult: 0.72, hipSpread: 0.036, adsSpread: 0.0035, moveSpreadMult: 1.25, jumpSpreadMult: 2.0,
    recoil: { vertical: 0.0068, horizontal: 0.0036, recovery: 11, firstShotMult: 1.15, pattern: PATTERN.keiler },
    range: 85, penetration: 0.4, suppressed: false, sound: { profile: 'smg', pitch: 0.84 }, model: 'keiler',
  },
  lmg_lm8: {
    id: 'lmg_lm8', name: 'LM-8 Bär', cls: 'lmg', slot: 'primary', unlockLevel: 24,
    description: 'Leichtes MG mit 75-Schuss-Trommel und schwerem Lauf: schneller angelegt als der Hammer, schneller nachgeladen – und trotzdem genug Atem für einen ganzen Korridor.',
    damage: { max: 30, min: 23, rangeStart: 28, rangeEnd: 58 }, headMult: 1.35, limbMult: 0.9, pellets: 1,
    rpm: 650, fireMode: 'auto', burstCount: 1, mag: 75, reserve: 225,
    reloadTime: 4.4, reloadEmptyTime: 5.2, perShellReload: false,
    equipTime: 0.8, adsTime: 0.36, adsZoom: 1.3, sight: 'iron', scope: null, sprintToFire: 0.3,
    moveSpeedMult: 0.89, adsMoveMult: 0.5, hipSpread: 0.065, adsSpread: 0.0032, moveSpreadMult: 1.6, jumpSpreadMult: 2.8,
    recoil: { vertical: 0.0078, horizontal: 0.0044, recovery: 7.5, firstShotMult: 1.35, pattern: PATTERN.lm8 },
    range: 120, penetration: 0.75, suppressed: false, sound: { profile: 'lmg', pitch: 1.08 }, model: 'lm8',
  },
  sr_titan: {
    id: 'sr_titan', name: 'Titan .50', cls: 'sniper', slot: 'primary', unlockLevel: 32,
    description: 'Halbautomatisches Anti-Material-Gewehr: zerreißt Deckung, Westen und leichte Fahrzeuge auf jede Entfernung. Dreizehn Kilo, ein Schlag wie ein Vorschlaghammer.',
    damage: { max: 160, min: 140, rangeStart: 60, rangeEnd: 150 }, headMult: 1.5, limbMult: 0.85, pellets: 1,
    rpm: 75, fireMode: 'semi', burstCount: 1, mag: 5, reserve: 20,
    reloadTime: 3.6, reloadEmptyTime: 4.4, perShellReload: false,
    equipTime: 1.0, adsTime: 0.55, adsZoom: 6, sight: 'sniper', scope: { zoom: 6, overlay: 'sniper' }, sprintToFire: 0.38,
    moveSpeedMult: 0.84, adsMoveMult: 0.35, hipSpread: 0.14, adsSpread: 0.00025, moveSpreadMult: 2.6, jumpSpreadMult: 3.8,
    recoil: { vertical: 0.07, horizontal: 0.012, recovery: 4.5, firstShotMult: 1.0 }, scopeSway: 0.008,
    // antiMateriel: Fahrzeuge nehmen Kugelschaden auch durch Panzerung (vehicles: ≥ 0,15 × Schaden)
    range: 200, penetration: 1.0, antiMateriel: true, suppressed: false, sound: { profile: 'sniper', pitch: 0.78 }, model: 'titan',
  },
  sg_hagel: {
    id: 'sg_hagel', name: 'HF-12 Hagel', cls: 'shotgun', slot: 'primary', unlockLevel: 11,
    description: 'Selbstladeflinte mit Kastenmagazin: so schnell, wie der Finger zieht. Weniger Wucht pro Schuss als die Bulldog – dafür folgt der zweite sofort.',
    damage: { max: 12, min: 3, rangeStart: 3, rangeEnd: 14 }, headMult: 1.1, limbMult: 0.9, pellets: 8,
    rpm: 220, fireMode: 'semi', burstCount: 1, mag: 8, reserve: 32,
    reloadTime: 2.4, reloadEmptyTime: 3.0, perShellReload: false,
    equipTime: 0.62, adsTime: 0.26, adsZoom: 1.15, sight: 'iron', scope: null, sprintToFire: 0.17,
    moveSpeedMult: 0.95, adsMoveMult: 0.68, hipSpread: 0.06, adsSpread: 0.045, moveSpreadMult: 1.1, jumpSpreadMult: 1.6,
    recoil: { vertical: 0.032, horizontal: 0.012, recovery: 7, firstShotMult: 1.0 },
    range: 30, penetration: 0.15, suppressed: false, sound: { profile: 'shotgun', pitch: 1.1 }, model: 'hagel',
  },
  pi_kobra: {
    id: 'pi_kobra', name: 'R-6 Kobra', cls: 'pistol', slot: 'secondary', unlockLevel: 13,
    description: 'Sechsschüssiger Revolver mit Schnelllader: zwei Treffer auf kurze Distanz, ein Kopftreffer genügt fast immer. Nachladen ist Handarbeit – Trommel raus, Hülsen raus, Lader rein.',
    damage: { max: 55, min: 36, rangeStart: 12, rangeEnd: 32 }, headMult: 1.6, limbMult: 0.9, pellets: 1,
    rpm: 150, fireMode: 'semi', burstCount: 1, mag: 6, reserve: 30,
    reloadTime: 2.6, reloadEmptyTime: 2.4, perShellReload: false,
    equipTime: 0.45, adsTime: 0.18, adsZoom: 1.2, sight: 'iron', scope: null, sprintToFire: 0.12,
    moveSpeedMult: 1.04, adsMoveMult: 0.78, hipSpread: 0.036, adsSpread: 0.0032, moveSpreadMult: 1.25, jumpSpreadMult: 2.0,
    recoil: { vertical: 0.038, horizontal: 0.008, recovery: 7, firstShotMult: 1.0 },
    range: 85, penetration: 0.6, suppressed: false, sound: { profile: 'pistol_heavy', pitch: 1.08 }, model: 'kobra',
  },
  at_donner: {
    id: 'at_donner', name: 'RW-90 Donnerkeil', cls: 'launcher', slot: 'secondary', unlockLevel: 10,
    description: 'Panzerabwehr-Rohr der Pioniere: Raketengranate mit Hohlladung. Knackt Geländewagen mit einem Treffer in die Flanke, Kampfpanzer mit zweien ins Heck – und räumt jede Stellung.',
    // damage = Volltreffer auf Infanterie (für Werte/Website); Wirkung: projectile.* (Rakete, kein Treffer per Strahl)
    damage: { max: 160, min: 160, rangeStart: 0, rangeEnd: 220 }, headMult: 1, limbMult: 1, pellets: 1,
    rpm: 30, fireMode: 'single', burstCount: 1, mag: 1, reserve: 3,
    reloadTime: 3.4, reloadEmptyTime: 3.4, perShellReload: false,
    equipTime: 0.9, adsTime: 0.42, adsZoom: 1.6, sight: 'iron', scope: null, sprintToFire: 0.4,
    moveSpeedMult: 0.9, adsMoveMult: 0.45, hipSpread: 0.05, adsSpread: 0.004, moveSpreadMult: 1.6, jumpSpreadMult: 3.0,
    recoil: { vertical: 0.03, horizontal: 0.008, recovery: 4, firstShotMult: 1.0 },
    // Rakete: Startgeschwindigkeit → Marschfahrt (m/s), Schwerkraft (m/s²), Lebensdauer (s), Fahrzeugschaden (× Trefferseite),
    // Volltreffer Akteur, Splitterwirkung (wie Granaten), Rückstrahl hinter dem Schützen (Schaden für Verbündete aus, Feinde ja)
    projectile: {
      kind: 'rocket', speed: 70, cruise: 150, boost: 0.45, gravity: 4.5, life: 4.5, armDistance: 6,
      vehicleDamage: 300, actorDamage: 160, splash: { radius: 4.5, innerRadius: 1.2, maxDamage: 130, minDamage: 20 },
      backblast: { length: 4, damage: 35 },
    },
    range: 300, penetration: 0, suppressed: false, sound: { profile: 'sniper', pitch: 0.55, alt: 'launcher' }, model: 'donner',
  },
  karambit: {
    id: 'karambit', name: 'Karambit Kralle', cls: 'melee', slot: 'melee', unlockLevel: 9,
    description: 'Gebogene Klinge mit Fingerring: der schnellste Hieb im Arsenal (zwei Treffer, von hinten einer). Spezial „Flink“: 12 % schneller unterwegs. Wer nah genug ist, ist zu nah.',
    damage: { max: 55, min: 55, rangeStart: 0, rangeEnd: 2.2 }, headMult: 1, limbMult: 1, pellets: 1,
    rpm: 140, special: 'flink', fireMode: 'semi', burstCount: 1, mag: 0, reserve: 0,
    reloadTime: 0, reloadEmptyTime: 0, perShellReload: false,
    equipTime: 0.2, adsTime: 0, adsZoom: 1, sight: 'none', scope: null, sprintToFire: 0.04,
    moveSpeedMult: 1.12, adsMoveMult: 1, hipSpread: 0, adsSpread: 0, moveSpreadMult: 1, jumpSpreadMult: 1,
    recoil: { vertical: 0, horizontal: 0, recovery: 10, firstShotMult: 1 },
    melee: { range: 2.2, lungeRange: 4.2, lungeSpeed: 11, arc: 0.55, swingTime: 0.42, hitDelay: 0.09, style: 'hook' },
    range: 2.2, penetration: 0, suppressed: true, sound: { profile: 'melee_swing', pitch: 1.12 }, model: 'karambit',
  },
  machete: {
    id: 'machete', name: 'Machete Schnitter', cls: 'melee', slot: 'melee', unlockLevel: 21,
    description: 'Lange Klinge, weiter Bogen, ein Treffer genügt. Spezial „Spaltschlag“: trifft jeden Gegner im Bogen, nicht nur einen. Langsamer, aber mit Reichweite.',
    damage: { max: 110, min: 110, rangeStart: 0, rangeEnd: 2.8 }, headMult: 1, limbMult: 1, pellets: 1,
    rpm: 66, special: 'spaltschlag', fireMode: 'semi', burstCount: 1, mag: 0, reserve: 0,
    reloadTime: 0, reloadEmptyTime: 0, perShellReload: false,
    equipTime: 0.3, adsTime: 0, adsZoom: 1, sight: 'none', scope: null, sprintToFire: 0.06,
    moveSpeedMult: 1.05, adsMoveMult: 1, hipSpread: 0, adsSpread: 0, moveSpreadMult: 1, jumpSpreadMult: 1,
    recoil: { vertical: 0, horizontal: 0, recovery: 10, firstShotMult: 1 },
    melee: { range: 2.8, lungeRange: 4.8, lungeSpeed: 9.5, arc: 0.8, swingTime: 0.9, hitDelay: 0.2, style: 'chop', cleave: true },
    range: 2.8, penetration: 0, suppressed: true, sound: { profile: 'melee_swing', pitch: 0.86 }, model: 'machete',
  },
  tomahawk: {
    id: 'tomahawk', name: 'Kampfbeil Grauwolf', cls: 'melee', slot: 'melee', unlockLevel: 36,
    description: 'Taktisches Beil mit Dornrücken: ein Schlag von oben, der jede Weste vergisst. Spezial „Sprung“: weitester Ausfallschritt (6,5 m). Schwer in der Hand, endgültig im Ergebnis.',
    damage: { max: 150, min: 150, rangeStart: 0, rangeEnd: 2.5 }, headMult: 1, limbMult: 1, pellets: 1,
    rpm: 70, special: 'sprung', fireMode: 'semi', burstCount: 1, mag: 0, reserve: 0,
    reloadTime: 0, reloadEmptyTime: 0, perShellReload: false,
    equipTime: 0.3, adsTime: 0, adsZoom: 1, sight: 'none', scope: null, sprintToFire: 0.06,
    moveSpeedMult: 1.05, adsMoveMult: 1, hipSpread: 0, adsSpread: 0, moveSpreadMult: 1, jumpSpreadMult: 1,
    recoil: { vertical: 0, horizontal: 0, recovery: 10, firstShotMult: 1 },
    melee: { range: 2.5, lungeRange: 6.5, lungeSpeed: 13, arc: 0.6, swingTime: 0.85, hitDelay: 0.22, style: 'overhead' },
    range: 2.5, penetration: 0, suppressed: true, sound: { profile: 'melee_swing', pitch: 0.78 }, model: 'tomahawk',
  },
};

/** Reihenfolge = Roster-Tabelle des Vertrags. */
export const WEAPON_IDS = [
  'ar_kv47', 'ar_m17', 'smg_vp9', 'smg_qx90', 'lmg_hm60', 'mr_sk14', 'sr_brecher', 'sg_bulldog', 'pi_p9', 'pi_adler', 'knife',
  // Welle 2 (Arsenal): Karabiner, Bullpup, Kampfgewehr, Kompakt-/Schwere MP, Trommel-LMG, Anti-Material, Selbstlade-Flinte,
  // Revolver, Panzerabwehr (Pionier) + Nahkampfwaffen
  'ar_k36', 'ar_bx20', 'ar_g7', 'smg_wespe', 'smg_keiler', 'lmg_lm8', 'sr_titan', 'sg_hagel', 'pi_kobra', 'at_donner',
  'karambit', 'machete', 'tomahawk',
];
/** Nahkampfwaffen (Slot „melee“, Ausrüstung `loadout.melee`; 'knife' ist der Standard). */
export const MELEE_IDS = ['knife', 'karambit', 'machete', 'tomahawk'];

export const WEAPONS = {};
for (const id of WEAPON_IDS) {
  const def = RAW[id];
  const feel = FEEL[id];
  if (feel) {
    if (feel.handling && !def.handling) def.handling = { ...HANDLING_BY_CLASS[def.cls], ...feel.handling };
    if (feel.recoil) def.recoil = { ...feel.recoil, ...def.recoil };
  }
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
    throwSpeed: 20, throwPitch: 0.18, bounciness: 0.38, friction: 0.55, sticky: false,
    model: 'frag', sound: 'explosion', icon: ICONS.frag,
  },
  semtex: {
    id: 'semtex', name: 'Haftgranate', short: 'Haft', kind: 'lethal', unlockLevel: 9,
    description: 'Haftet an jeder Oberfläche – und an jedem Gegner. Kürzere Zündzeit, kleinerer Radius, keine zweite Chance.',
    count: 1, fuse: 2.2, cookable: false, radius: 5.5, innerRadius: 1.5, maxDamage: 160, minDamage: 25,
    throwSpeed: 18.5, throwPitch: 0.15, bounciness: 0, friction: 1, sticky: true,
    model: 'semtex', sound: 'explosion', icon: ICONS.semtex,
  },
  impact: {
    id: 'impact', name: 'Aufschlaggranate', short: 'Aufschlag', kind: 'lethal', unlockLevel: 15,
    description: 'Zündet beim ersten Aufprall – kein Abprallen, kein Warten. Kleinerer Radius, dafür genau dort, wo sie landet.',
    count: 1, fuse: 6, cookable: false, impact: true, armTime: 0.1, radius: 5, innerRadius: 1.2, maxDamage: 130, minDamage: 20,
    throwSpeed: 21, throwPitch: 0.14, bounciness: 0, friction: 1, sticky: false,
    model: 'impact', sound: 'explosion', icon: ICONS.impact,
  },
  molotov: {
    id: 'molotov', name: 'Brandsatz', short: 'Brand', kind: 'lethal', unlockLevel: 19,
    description: 'Glasflasche mit Brandmasse: zerbricht beim Aufprall und setzt den Boden für sieben Sekunden in Flammen. Sperrt Türen, Treppen und Fahrzeugdecks.',
    // fire: brennende Fläche (Radius m, Dauer s, Schaden pro Sekunde für Akteure darin; Fahrzeuge × vehicleMult)
    count: 1, fuse: 6, cookable: false, impact: true, armTime: 0.05, radius: 3.2, innerRadius: 0, maxDamage: 0, minDamage: 0,
    fire: { radius: 3.2, duration: 7, dps: 34, vehicleMult: 0.35 },
    throwSpeed: 17, throwPitch: 0.2, bounciness: 0, friction: 1, sticky: false,
    model: 'molotov', sound: 'fire', icon: ICONS.molotov,
  },
  flash: {
    id: 'flash', name: 'Blendgranate', short: 'Blend', kind: 'tactical', unlockLevel: 4,
    description: 'Greller Blitz und ohrenbetäubender Knall: Wer hinsieht, ist für Sekunden blind und hört nur noch Pfeifen. Schadet niemandem – außer dem Plan des Gegners.',
    // flash: Wirkradius (m) und maximale Blenddauer (s); abgewandt/verdeckt deutlich schwächer
    count: 2, fuse: 1.6, cookable: true, radius: 0.6, innerRadius: 0, maxDamage: 0, minDamage: 0, nonLethal: true,
    flash: { radius: 16, duration: 4.5, minDuration: 0.6 },
    throwSpeed: 19, throwPitch: 0.17, bounciness: 0.42, friction: 0.5, sticky: false,
    model: 'flash', sound: 'flashbang', icon: ICONS.flash,
  },
  smoke: {
    id: 'smoke', name: 'Rauchgranate', short: 'Rauch', kind: 'tactical', unlockLevel: 1,
    description: 'Dichte Nebelwand für sechzehn Sekunden: Deckung zum Überqueren, Vorrücken, Bergen. Bots sehen nicht hindurch – du auch nicht.',
    // smoke: Endradius der Wolke (m), Dauer (s), Aufbauzeit (s); Sichtdämpfung je Meter Rauch (1/m)
    count: 1, fuse: 1.4, cookable: false, radius: 0.6, innerRadius: 0, maxDamage: 0, minDamage: 0, nonLethal: true,
    smoke: { radius: 5.5, duration: 16, grow: 2.6, density: 0.9 },
    throwSpeed: 18, throwPitch: 0.17, bounciness: 0.3, friction: 0.7, sticky: false,
    model: 'smoke', sound: 'smoke_hiss', icon: ICONS.smoke,
  },
  netz: {
    id: 'netz', name: 'Wurfnetz', short: 'Netz', kind: 'tactical', unlockLevel: 1,
    description: 'Kanister mit Fangnetz: Beim Aufschlag spannt sich ein beschwertes Netz über drei Meter. Wer darunter steht, kommt vier Sekunden kaum vom Fleck – kein Sprint, kein Sprung.',
    // net: Radius (m), Dauer (s), Tempo-Anteil im Netz; trifft nur Gegner des Werfers
    count: 1, fuse: 3, cookable: false, impact: true, armTime: 0.05, radius: 0.6, innerRadius: 0, maxDamage: 0, minDamage: 0, nonLethal: true,
    net: { radius: 3.2, duration: 4, slow: 0.15 },
    throwSpeed: 17, throwPitch: 0.2, bounciness: 0, friction: 1, sticky: false,
    model: 'smoke', sound: 'smoke_hiss', icon: ICONS.netz,
  },
};

export const EQUIPMENT_IDS = ['frag', 'semtex', 'impact', 'molotov', 'flash', 'smoke', 'netz'];
/** Tödliche Wurfmittel (Taste Granate) und taktische (Taste Taktisch, `loadout.tactical`). */
export const LETHAL_IDS = EQUIPMENT_IDS.filter((id) => EQUIPMENT[id].kind === 'lethal');
export const TACTICAL_IDS = EQUIPMENT_IDS.filter((id) => EQUIPMENT[id].kind === 'tactical');

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
  { id: 'pionier', name: 'Pionier', primary: 'smg_keiler', secondary: 'at_donner', lethal: 'impact', tactical: 'smoke',
    description: 'Panzerabwehr und Nahbereich: Rauch legen, Rohr anlegen, Fahrzeug knacken.' },
  { id: 'sturmtrupp', name: 'Sturmtrupp', primary: 'ar_k36', secondary: 'pi_kobra', lethal: 'frag', tactical: 'flash', melee: 'karambit',
    description: 'Blenden, eindringen, räumen – Raum für Raum.' },
];
for (const l of DEFAULT_LOADOUTS) {
  if (!l.tactical) l.tactical = 'smoke';
  if (!l.melee) l.melee = 'knife';
  l.unlockLevel = Math.max(RAW[l.primary].unlockLevel, RAW[l.secondary].unlockLevel, EQUIPMENT[l.lethal].unlockLevel,
    EQUIPMENT[l.tactical].unlockLevel, RAW[l.melee].unlockLevel);
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

/* ------------------------------------------------------------ Tarnmuster (Waffen-Skins) */

/**
 * Waffen-Tarnmuster: Materialvarianten für 1.- und 3.-Person-Modelle (gunsmith/camos.js erzeugt die Texturen).
 *  pattern  Generator: solid | blobs | flecks | digital | tiger | splinter | stripes | hex | carbon | damask |
 *           brushed | rust | aurora | marble
 *  colors   Farben (sRGB-Hex), Reihenfolge = Grund → Akzent; scale = Mustergröße (1 = Standard, größer = gröber)
 *  finish   { metalness, roughness } überschreiben die Oberfläche (Gold/Damast glänzen, Stoffmuster matt)
 *  rarity   'standard' | 'selten' | 'episch' | 'legendaer' (Anzeige: RARITY_NAMES)
 *  unlock   { type: 'default' } | { type: 'level', level } | { type: 'kills', count } (Abschüsse mit DIESER Waffe) |
 *           { type: 'headshots', count } (Kopftreffer-Abschüsse mit dieser Waffe) |
 *           { type: 'mastery', camos: [...] } (alle genannten Muster mit dieser Waffe freigeschaltet)
 * Profil/UI: isCamoUnlocked(camoId, { level, kills, headshots, unlocked }) – kills/headshots = Werte der Waffe,
 * unlocked = Menge bereits freier Muster dieser Waffe (für 'mastery').
 */
export const RARITY_NAMES = { standard: 'Standard', selten: 'Selten', episch: 'Episch', legendaer: 'Legendär' };

export const CAMOS = {
  werk: { id: 'werk', name: 'Werkszustand', pattern: 'solid', colors: [], rarity: 'standard', unlock: { type: 'default' } },
  oliv: { id: 'oliv', name: 'Oliv matt', pattern: 'solid', colors: ['#4b5134', '#3c412a'], finish: { roughness: 0.78 }, rarity: 'standard', unlock: { type: 'level', level: 3 } },
  sand: { id: 'sand', name: 'Sandfarben', pattern: 'solid', colors: ['#9a8562', '#857152'], finish: { roughness: 0.74 }, rarity: 'standard', unlock: { type: 'level', level: 5 } },
  wald: { id: 'wald', name: 'Waldtarn', pattern: 'blobs', colors: ['#4c5236', '#2f3524', '#6b5a3c', '#1d1f18'], rarity: 'standard', unlock: { type: 'level', level: 2 } },
  wueste: { id: 'wueste', name: 'Wüste', pattern: 'blobs', colors: ['#b49f78', '#8c7550', '#c9b893', '#6e5a3e'], scale: 1.3, rarity: 'standard', unlock: { type: 'level', level: 4 } },
  flecktarn: { id: 'flecktarn', name: 'Flecktarn', pattern: 'flecks', colors: ['#59613f', '#3a4129', '#6c5b3d', '#1e2117', '#7d8a55'], rarity: 'standard', unlock: { type: 'level', level: 6 } },
  schnee: { id: 'schnee', name: 'Schnee', pattern: 'blobs', colors: ['#d7dadb', '#a9afb2', '#ebedee', '#7d8488'], scale: 1.4, rarity: 'standard', unlock: { type: 'level', level: 8 } },
  urban: { id: 'urban', name: 'Urban', pattern: 'splinter', colors: ['#6d7073', '#45484b', '#909396', '#2a2c2e'], rarity: 'standard', unlock: { type: 'level', level: 10 } },
  digital: { id: 'digital', name: 'Digital', pattern: 'digital', colors: ['#56604a', '#3b4433', '#7a7a5c', '#262b21'], rarity: 'standard', unlock: { type: 'level', level: 12 } },
  digital_wueste: { id: 'digital_wueste', name: 'Digital Wüste', pattern: 'digital', colors: ['#a8946c', '#8a7450', '#c4b48f', '#6a5940'], rarity: 'standard', unlock: { type: 'level', level: 14 } },
  splitter: { id: 'splitter', name: 'Splittertarn', pattern: 'splinter', colors: ['#7d8461', '#4f5a3a', '#8c7651', '#3b4a33'], rarity: 'standard', unlock: { type: 'level', level: 16 } },
  nacht: { id: 'nacht', name: 'Nacht', pattern: 'digital', colors: ['#1f2633', '#141a24', '#2f394a', '#0b0e14'], finish: { roughness: 0.72 }, rarity: 'standard', unlock: { type: 'level', level: 18 } },
  mehrzweck: { id: 'mehrzweck', name: 'Mehrzweck', pattern: 'blobs', colors: ['#8a7d5c', '#5f6544', '#a89a74', '#4a3d2b', '#c1b38e'], scale: 0.8, rarity: 'standard', unlock: { type: 'level', level: 20 } },
  waben: { id: 'waben', name: 'Waben', pattern: 'hex', colors: ['#2b2e31', '#3d4246', '#55606a'], finish: { roughness: 0.55 }, rarity: 'selten', unlock: { type: 'level', level: 24 } },
  tiger: { id: 'tiger', name: 'Tiger', pattern: 'tiger', colors: ['#5d6a3e', '#1a1d14', '#7c7b4f'], rarity: 'selten', unlock: { type: 'kills', count: 50, kills: 50 } },
  kohle: { id: 'kohle', name: 'Kohlefaser', pattern: 'carbon', colors: ['#141517', '#2c2f33'], finish: { roughness: 0.32, metalness: 0.15 }, rarity: 'selten', unlock: { type: 'kills', count: 100, kills: 100 } },
  zebra: { id: 'zebra', name: 'Zebra', pattern: 'stripes', colors: ['#e6e3dc', '#16171a'], rarity: 'selten', unlock: { type: 'headshots', count: 25, headshots: 25 } },
  rost: { id: 'rost', name: 'Rost', pattern: 'rust', colors: ['#5a3a24', '#8a4f2a', '#3a2a20', '#a8683a'], finish: { roughness: 0.9, metalness: 0.25 }, rarity: 'selten', unlock: { type: 'kills', count: 150, kills: 150 } },
  kirsche: { id: 'kirsche', name: 'Kirschblüte', pattern: 'blobs', colors: ['#e7c6cf', '#c4728a', '#f3e3e6', '#7d2f45'], scale: 0.7, rarity: 'episch', unlock: { type: 'headshots', count: 50, headshots: 50 } },
  roter_tiger: { id: 'roter_tiger', name: 'Roter Tiger', pattern: 'tiger', colors: ['#8e2018', '#140c0b', '#c2462c'], rarity: 'episch', unlock: { type: 'kills', count: 250, kills: 250 } },
  marmor: { id: 'marmor', name: 'Marmor', pattern: 'marble', colors: ['#e9e6e0', '#9a958d', '#4b4843'], finish: { roughness: 0.22, metalness: 0.05 }, rarity: 'episch', unlock: { type: 'level', level: 40 } },
  obsidian: { id: 'obsidian', name: 'Obsidian', pattern: 'marble', colors: ['#0d0d10', '#2a2433', '#5a4a6e'], finish: { roughness: 0.12, metalness: 0.35 }, rarity: 'episch', unlock: { type: 'level', level: 50 } },
  damast: { id: 'damast', name: 'Damast', pattern: 'damask', colors: ['#8e9399', '#3f4348', '#c4c8cc'], finish: { roughness: 0.28, metalness: 1 }, rarity: 'legendaer', unlock: { type: 'headshots', count: 100, headshots: 100 } },
  polarlicht: { id: 'polarlicht', name: 'Polarlicht', pattern: 'aurora', colors: ['#0b1a2a', '#1fbf8f', '#7a4dd8', '#2fd1e6'], finish: { roughness: 0.25, metalness: 0.6 }, rarity: 'legendaer', unlock: { type: 'level', level: 55 } },
  gold: { id: 'gold', name: 'Gold', pattern: 'brushed', colors: ['#e0b453', '#b8862f', '#f6d98a'], finish: { roughness: 0.24, metalness: 1 }, rarity: 'legendaer',
    unlock: { type: 'mastery', camos: ['tiger', 'kohle', 'zebra', 'rost', 'kirsche', 'roter_tiger', 'damast'] } },
};
export const CAMO_IDS = Object.keys(CAMOS);

/** Beschreibung der Freischaltbedingung (deutsch, für Lobby/Profil). */
export function camoUnlockText(id) {
  const c = CAMOS[id];
  if (!c) return '';
  const u = c.unlock || { type: 'default' };
  if (u.type === 'level') return `Stufe ${u.level}`;
  if (u.type === 'kills') return `${u.count} Abschüsse mit dieser Waffe`;
  if (u.type === 'headshots') return `${u.count} Kopftreffer-Abschüsse mit dieser Waffe`;
  if (u.type === 'mastery') return `Alle seltenen Muster dieser Waffe: ${u.camos.map((k) => CAMOS[k] ? CAMOS[k].name : k).join(', ')}`;
  return 'Immer verfügbar';
}

/**
 * Ist ein Muster für eine Waffe frei? ctx = { level, kills, headshots, unlocked (Set/Array freier Muster-Ids) }.
 * Ohne Angaben gilt nur 'default'. Pure Funktion – Fortschritt speichert das Profil (ui/core).
 */
export function isCamoUnlocked(id, ctx = {}) {
  const c = CAMOS[id];
  if (!c) return false;
  const u = c.unlock || { type: 'default' };
  if (u.type === 'default') return true;
  if (u.type === 'level') return (ctx.level || 0) >= u.level;
  if (u.type === 'kills') return (ctx.kills || 0) >= u.count;
  if (u.type === 'headshots') return (ctx.headshots || 0) >= u.count;
  if (u.type === 'mastery') {
    const have = ctx.unlocked instanceof Set ? ctx.unlocked : new Set(ctx.unlocked || []);
    return u.camos.every((k) => have.has(k) || isCamoUnlocked(k, { ...ctx, unlocked: [] }));
  }
  return false;
}

/* ------------------------------------------------------------ Klassen-Aussehen (Ego-Arme) */

/**
 * Handschuhe/Ärmel der Ego-Arme je Klasse (Look-Ids wie die Klassen in classes/modes-Daten; Aliasse englisch).
 *  glove     Handschuhfarbe (sRGB, multipliziert die Handschuh-Schattierung)
 *  sleeve    Ärmeltönung (multipliziert das Team-Tarnmuster; '#ffffff' = unverändert)
 *  sleeveCamo optional eigenes Ärmelmuster ('arid' | 'wood' | 'neutral'), sonst Team-Muster
 *  accessory 'none' | 'armband' (Sanitäter: Rotkreuz-Binde) | 'cuffs' (Pionier: Lederstulpen) |
 *            'wraps' (Aufklärer: Tarnwickel) | 'pads' (Sturm: Knöchelschutz-Band)
 */
export const CLASS_LOOKS = {
  standard: { id: 'standard', name: 'Standard', glove: '#ffffff', sleeve: '#ffffff', accessory: 'none' },
  sturm: { id: 'sturm', name: 'Sturm', glove: '#5b5f63', sleeve: '#d8d8d8', accessory: 'pads' },
  sanitaeter: { id: 'sanitaeter', name: 'Sanitäter', glove: '#c9b48d', sleeve: '#ffffff', accessory: 'armband' },
  pionier: { id: 'pionier', name: 'Pionier', glove: '#7a5a3c', sleeve: '#c9c2b0', sleeveCamo: 'neutral', accessory: 'cuffs' },
  aufklaerer: { id: 'aufklaerer', name: 'Aufklärer', glove: '#59614a', sleeve: '#b9c4a6', sleeveCamo: 'wood', accessory: 'wraps' },
  unterstuetzung: { id: 'unterstuetzung', name: 'Unterstützung', glove: '#3f4434', sleeve: '#e0dccd', accessory: 'pads' },
};
/**
 * Outfit-Ausführungen (loadout.skin = `${klasse}:${stufe}`, Stufen wie modes.data.js OPERATOR_TIERS) – Darstellung der
 * Ego-Arme: glove/sleeve überschreiben die Klassenwerte, extra = zusätzliches Zubehör ('wrap' Lederwickel, 'gold' Goldrand).
 */
export const SKIN_TIERS = {
  standard: { id: 'standard', name: 'Standard' },
  veteran: { id: 'veteran', name: 'Veteran', sleeve: '#d6ccb4', extra: 'wrap' },
  elite: { id: 'elite', name: 'Elite', glove: '#242424', sleeve: '#8c8c8c', extra: 'gold' },
};
/** Kosmetik-Übersicht für UI/Profil: Tarnmuster, Klassen-Arme, Outfit-Stufen. */
export const SKINS = { camos: CAMOS, looks: CLASS_LOOKS, tiers: SKIN_TIERS };
/** loadout.skin ('pionier:elite') bzw. Klassen-Id → { look, tier }. */
export function parseSkin(skin, cls = null) {
  const [a, b] = String(skin || '').split(':');
  return { look: classLookId(a || cls), tier: SKIN_TIERS[b] ? b : 'standard' };
}
const LOOK_ALIASES = { assault: 'sturm', medic: 'sanitaeter', sani: 'sanitaeter', engineer: 'pionier', recon: 'aufklaerer', sniper: 'aufklaerer', support: 'unterstuetzung' };
/** Look-Id normalisieren (Klassen-Id, Alias oder unbekannt → 'standard'). */
export function classLookId(id) {
  const k = String(id || '').toLowerCase();
  return CLASS_LOOKS[k] ? k : LOOK_ALIASES[k] || 'standard';
}

