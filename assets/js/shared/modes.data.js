/* NULLPUNKT — Spielmodi, Serienprämien, Schwierigkeitsgrade, Medaillen, Erfahrungspunkte (reine Daten).
 * Begriff für Spieler: „EP“ (Erfahrungspunkte) – in Spiel und Website; im Code heißen sie xp / XP_RULES.
 * Keine Imports, kein three.js, kein DOM: wird von Spiel UND Website geladen.
 *
 * Konventionen:
 *  - scoreLimit / timeLimit = 0 bedeutet „kein Limit“ (Schießstand). timeLimit in Sekunden.
 *  - defaultAllies/defaultEnemies = Bot-Anzahl (der Spieler zählt nicht mit).
 *    limits.allies/enemies = [min, max] für die Lobby-Regler.
 *  - Icons: Inline-SVG-Strings, viewBox 0 0 24 24, stroke=currentColor (per innerHTML einsetzbar).
 */

const icon = (body) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/* ------------------------------------------------------------------ Modi */

export const MODE_ORDER = ['tdm', 'dom', 'ffa', 'gun', 'training'];

export const MODES = {
  tdm: {
    id: 'tdm',
    name: 'Team-Deathmatch',
    short: 'TDM',
    tagline: 'Sechs gegen sechs. Wer zuerst 40 erreicht, gewinnt.',
    description:
      'Zwei Teams, eine Rechnung: Jeder Abschuss zählt, jeder Tod kostet. Schnelle Wiedereinstiege halten das Tempo hoch – Flanken, Deckung und Serienprämien entscheiden das Match.',
    sizeRule: '{team} gegen {enemies} – {mates}',
    rules: [
      '6 gegen 6 – du und fünf Verbündete',
      'Erstes Team mit 40 Abschüssen gewinnt',
      'Zeitlimit: 10 Minuten',
      'Wiedereinstieg nach 3 Sekunden',
      'Serienprämien aktiv',
    ],
    hudObjective: 'Schalte das gegnerische Team aus',
    scoreUnit: 'Abschüsse',
    scoreLimit: 40,
    timeLimit: 600,
    teams: true,
    defaultAllies: 5,
    defaultEnemies: 6,
    limits: { allies: [0, 7], enemies: [1, 8] },
    respawnDelay: 3,
    streaks: true,
    lethals: true,
    recommendedMaps: ['hafen', 'altstadt', 'werk'],
    icon: icon('<path d="M3 6l6.5 6L3 18"/><path d="M21 6l-6.5 6 6.5 6"/><path d="M12 4v3M12 17v3"/>'),
  },

  ffa: {
    id: 'ffa',
    name: 'Jeder gegen jeden',
    short: 'FFA',
    tagline: 'Acht Spieler. Keine Freunde. 25 Abschüsse.',
    description:
      'Kein Team, kein Rückhalt – jedes Gesicht auf der Karte ist ein Ziel. Wer zuerst 25 Gegner ausschaltet, gewinnt; wer unter die besten drei kommt, verlässt das Feld als Sieger.',
    sizeRule: '{players} Spieler, jeder für sich',
    rules: [
      '8 Spieler, jeder für sich',
      'Erster mit 25 Abschüssen gewinnt',
      'Platz 1 bis 3 zählt als Sieg',
      'Zeitlimit: 10 Minuten',
      'Wiedereinstieg nach 2 Sekunden',
    ],
    hudObjective: 'Sei der Erste mit 25 Abschüssen',
    scoreUnit: 'Abschüsse',
    scoreLimit: 25,
    timeLimit: 600,
    teams: false,
    defaultAllies: 0,
    defaultEnemies: 7,
    limits: { allies: [0, 0], enemies: [1, 11] },
    winPlaces: 3,
    respawnDelay: 2,
    streaks: true,
    lethals: true,
    recommendedMaps: ['altstadt', 'werk', 'hafen'],
    icon: icon('<circle cx="12" cy="12" r="7"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r="1"/>'),
  },

  dom: {
    id: 'dom',
    name: 'Herrschaft',
    short: 'DOM',
    tagline: 'Drei Flaggen. Halte zwei, und die Uhr arbeitet für dich.',
    description:
      'Erobere die Flaggen A, B und C und halte sie gegen den Druck des Gegners. Jede gehaltene Flagge bringt Punkte – wer zuerst 150 erreicht, gewinnt. Abschüsse sind Mittel zum Zweck.',
    sizeRule: '{team} gegen {enemies} um drei Flaggen',
    rules: [
      '6 gegen 6 um drei Flaggen',
      'Flagge einnehmen: im Kreis bleiben, bis der Balken voll ist',
      'Mehr Verbündete im Kreis = schneller einnehmen',
      'Jede gehaltene Flagge: 1 Punkt alle 4 Sekunden',
      'Erstes Team mit 150 Punkten gewinnt',
      'Zeitlimit: 10 Minuten',
    ],
    hudObjective: 'Erobere und halte die Flaggen',
    scoreUnit: 'Punkte',
    scoreLimit: 150,
    timeLimit: 600,
    teams: true,
    defaultAllies: 5,
    defaultEnemies: 6,
    limits: { allies: [0, 7], enemies: [1, 8] },
    respawnDelay: 4,
    streaks: true,
    lethals: true,
    // Flaggenlogik: captureTime (s, allein, neutral → eigene; gegnerische Flagge: erst neutralisieren,
    // gleiche Dauer), +captureRateBonus je weiterem Verbündeten (max. maxCapturers), umkämpft = Pause.
    objective: {
      flags: ['A', 'B', 'C'],
      captureTime: 5,
      captureRateBonus: 0.5,
      maxCapturers: 3,
      tickInterval: 4,
      pointsPerTick: 1,
    },
    recommendedMaps: ['werk', 'hafen', 'altstadt'],
    icon: icon('<path d="M6 21V3.5"/><path d="M6 4.5h11l-2.5 3.75L17 12H6"/>'),
  },

  gun: {
    id: 'gun',
    name: 'Waffenspiel',
    short: 'GUN',
    tagline: '18 Stufen, ein Messer. Jeder Abschuss lädt nach.',
    description:
      'Jeder Abschuss befördert dich zur nächsten Waffe – von der MP über das Scharfschützengewehr bis zum Kampfmesser. Wer mit der letzten Stufe trifft, gewinnt. Ein Messerabschuss wirft das Opfer eine Stufe zurück.',
    sizeRule: '{players} Spieler, jeder für sich',
    rules: [
      '8 Spieler, jeder für sich',
      '18 Waffenstufen – jeder Abschuss = nächste Stufe',
      'Letzte Stufe: Kampfmesser',
      'Messerabschuss stuft das Opfer eine Stufe zurück',
      'Keine Serienprämien, keine Granaten',
      'Zeitlimit: 10 Minuten',
    ],
    hudObjective: 'Arbeite dich bis zum Messer vor',
    scoreUnit: 'Stufen',
    scoreLimit: 18, // = GUN_GAME_STEPS.length (weapons.data.js)
    timeLimit: 600,
    teams: false,
    defaultAllies: 0,
    defaultEnemies: 7,
    limits: { allies: [0, 0], enemies: [1, 11] },
    respawnDelay: 2,
    streaks: false,
    lethals: false,
    demoteOnMelee: true,
    recommendedMaps: ['altstadt', 'werk', 'hafen'],
    icon: icon('<path d="M3 20h4.5v-4.5H12V11h4.5V6.5H21"/><path d="M16.5 3H21v4.5"/>'),
  },

  training: {
    id: 'training',
    name: 'Schießstand',
    short: 'TRN',
    tagline: 'Kein Druck, kein Limit. Nur du und die Ziele.',
    description:
      'Teste jede Waffe in Ruhe: Klappziele auf verschiedenen Distanzen, unbegrenzte Reservemunition und eine Trefferstatistik, die nicht lügt. Hier wird Rückstoß zur Gewohnheit.',
    rules: [
      'Kein Zeit- und kein Punktelimit',
      'Klappziele auf verschiedenen Distanzen',
      'Unbegrenzte Reservemunition',
      'Ideal zum Einschießen neuer Waffen',
    ],
    hudObjective: 'Triff die Klappziele',
    scoreUnit: 'Treffer',
    scoreLimit: 0,
    timeLimit: 0,
    teams: false,
    defaultAllies: 0,
    defaultEnemies: 0,
    limits: { allies: [0, 0], enemies: [0, 0] },
    respawnDelay: 1,
    streaks: false,
    lethals: true,
    infiniteAmmo: true,
    recommendedMaps: ['range'],
    icon: icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>'),
  },
};

/* ------------------------------------------------------- Serienprämien */

export const STREAK_ORDER = ['uav', 'strike', 'sentry'];

export const STREAKS = {
  uav: {
    id: 'uav',
    name: 'Aufklärer',
    description: 'Eine Drohne kreist über der Karte und zeigt 30 Sekunden lang alle Gegner auf der Minikarte.',
    kills: 4,
    cost: 4,
    duration: 30,
    sound: 'uav',
    // Radar-Sweep: Gegnerpositionen werden alle sweepInterval Sekunden aktualisiert.
    params: { sweepInterval: 2 },
    icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 12l6.4-6.4"/><path d="M12 7a5 5 0 0 1 5 5"/><circle cx="8.5" cy="14.5" r="0.9"/><circle cx="14.5" cy="16" r="0.9"/>'),
  },
  strike: {
    id: 'strike',
    name: 'Präzisionsschlag',
    description: 'Markiere einen Punkt auf der Karte – Sekunden später schlagen drei Raketen in einer Linie ein.',
    kills: 6,
    cost: 6,
    duration: 0,
    sound: 'airstrike',
    // delay: Markieren → erster Einschlag (s); impacts im Abstand spacing (m) und interval (s).
    params: { delay: 2.5, impacts: 3, spacing: 6, interval: 0.35, radius: 7, maxDamage: 200, minDamage: 30, targetRange: 120 },
    icon: icon('<path d="M12 3v10"/><path d="M8.5 9.5L12 13l3.5-3.5"/><path d="M4 20h16"/><path d="M6.5 16.5l1.5 1.5M17.5 16.5L16 18"/>'),
  },
  sentry: {
    id: 'sentry',
    name: 'Wachgeschütz',
    description: 'Ein automatisches Geschütz bewacht 45 Sekunden lang deine Position und feuert auf jeden Gegner in Sichtweite.',
    kills: 8,
    cost: 8,
    duration: 45,
    sound: 'sentry',
    // range (m), Kadenz (rpm), Schaden pro Kugel, Lebenspunkte, Drehgeschwindigkeit (rad/s), Zielfehler (rad).
    params: { range: 45, rpm: 540, damage: 20, health: 350, turnSpeed: 3.5, aimError: 0.02, reactionTime: 0.4 },
    icon: icon('<rect x="6" y="8" width="9" height="5.5" rx="1"/><path d="M15 10.75h6"/><path d="M10.5 13.5v3"/><path d="M6 21l4.5-4.5L15 21"/><path d="M8 8V6h5v2"/>'),
  },
};

/* --------------------------------------------------- Schwierigkeitsgrade */

/*
 * KI-Kennzahlen (bots verwenden diese Werte):
 *  reactionTime     s vom ersten Sichtkontakt bis zum ersten Schuss
 *  aimError         rad, Grundzielfehler (Streuung des Zielpunkts)
 *  trackingSpeed    rad/s, maximale Nachführgeschwindigkeit der Zielrichtung
 *  burstMin/Max     Schüsse pro Feuerstoß bei Automatikwaffen
 *  accuracyFalloff  relativer Zuwachs des Zielfehlers je Meter: aimError · (1 + accuracyFalloff · d)
 *  grenadeChance    Wahrscheinlichkeit je Gelegenheit (≈ 1× pro Sekunde, Ziel in Deckung/Gruppe)
 *  strafeChance     Wahrscheinlichkeit, im Feuergefecht seitlich auszuweichen (je Entscheidung)
 *  peekChance       Wahrscheinlichkeit, aus Deckung zu spähen statt zu warten
 *  headshotChance   Anteil der Feuerstöße, die auf den Kopf zielen
 *  viewDistance     m, Sichtweite für Wahrnehmung; fov Sichtkegel (Grad)
 *  xpMult           XP-Multiplikator für den Spieler auf diesem Grad
 */
export const DIFFICULTY_ORDER = ['rekrut', 'regulaer', 'veteran', 'elite'];

export const DIFFICULTIES = {
  rekrut: {
    id: 'rekrut',
    name: 'Rekrut',
    description: 'Gegner reagieren spät, zielen grob und werfen kaum Granaten. Zum Kennenlernen von Karten und Waffen.',
    reactionTime: 0.85, aimError: 0.07, trackingSpeed: 1.6,
    burstMin: 2, burstMax: 4, accuracyFalloff: 0.03,
    grenadeChance: 0.03, strafeChance: 0.15, peekChance: 0.25, headshotChance: 0.04,
    viewDistance: 45, fov: 100, xpMult: 0.8,
  },
  regulaer: {
    id: 'regulaer',
    name: 'Regulär',
    description: 'Solide Gegner, die Deckung nutzen und Fehler bestrafen. Die empfohlene Wahl.',
    reactionTime: 0.55, aimError: 0.04, trackingSpeed: 2.6,
    burstMin: 3, burstMax: 6, accuracyFalloff: 0.02,
    grenadeChance: 0.08, strafeChance: 0.35, peekChance: 0.4, headshotChance: 0.1,
    viewDistance: 60, fov: 110, xpMult: 1.0,
  },
  veteran: {
    id: 'veteran',
    name: 'Veteran',
    description: 'Schnelle Reaktionen, sichere Treffer, aggressive Flanken. Wer stehen bleibt, verliert.',
    reactionTime: 0.35, aimError: 0.022, trackingSpeed: 3.8,
    burstMin: 4, burstMax: 8, accuracyFalloff: 0.013,
    grenadeChance: 0.14, strafeChance: 0.55, peekChance: 0.6, headshotChance: 0.18,
    viewDistance: 80, fov: 120, xpMult: 1.25,
  },
  elite: {
    id: 'elite',
    name: 'Elite',
    description: 'Gegner, die kaum Fehler machen: Vorhalten, Granaten an jede Ecke, gnadenlose Duelle. Nur für die Besten.',
    reactionTime: 0.22, aimError: 0.012, trackingSpeed: 5.2,
    burstMin: 5, burstMax: 10, accuracyFalloff: 0.008,
    grenadeChance: 0.2, strafeChance: 0.7, peekChance: 0.75, headshotChance: 0.28,
    viewDistance: 100, fov: 130, xpMult: 1.5,
  },
};

/* ---------------------------------------------------------------- Medaillen */

/*
 * tier: 'bronze' | 'silber' | 'gold' (Farbe des Toasts). xp: Bonus pro Medaille.
 * Schwellen für die Vergabe stehen in MEDAL_RULES (modes/ui und combat können sie nutzen).
 */
export const MEDALS = {
  doppelkill: { id: 'doppelkill', label: 'Doppelkill', description: 'Zwei Abschüsse innerhalb von vier Sekunden.', xp: 50, tier: 'bronze' },
  dreifachkill: { id: 'dreifachkill', label: 'Dreifachkill', description: 'Drei Abschüsse in schneller Folge.', xp: 100, tier: 'silber' },
  vierfachkill: { id: 'vierfachkill', label: 'Vierfachkill', description: 'Vier Abschüsse in schneller Folge.', xp: 175, tier: 'gold' },
  kahlschlag: { id: 'kahlschlag', label: 'Kahlschlag', description: 'Fünf oder mehr Abschüsse in schneller Folge.', xp: 300, tier: 'gold' },
  erstesblut: { id: 'erstesblut', label: 'Erstes Blut', description: 'Der erste Abschuss des Matches.', xp: 75, tier: 'silber' },
  kopftreffer: { id: 'kopftreffer', label: 'Kopftreffer', description: 'Abschuss mit einem Treffer in den Kopf.', xp: 25, tier: 'bronze' },
  kopfjaeger: { id: 'kopfjaeger', label: 'Kopfjäger', description: 'Drei Kopftreffer-Abschüsse in einem Leben.', xp: 125, tier: 'silber' },
  rache: { id: 'rache', label: 'Rache', description: 'Den Gegner ausgeschaltet, der dich zuletzt erwischt hat.', xp: 50, tier: 'bronze' },
  retter: { id: 'retter', label: 'Retter', description: 'Einen Gegner ausgeschaltet, der gerade einen Verbündeten verwundet hat.', xp: 50, tier: 'bronze' },
  weitschuss: { id: 'weitschuss', label: 'Weitschuss', description: 'Abschuss über eine für die Waffe ungewöhnlich große Distanz.', xp: 50, tier: 'bronze' },
  nahkampf: { id: 'nahkampf', label: 'Nahkampf', description: 'Abschuss mit dem Kampfmesser.', xp: 50, tier: 'bronze' },
  serie5: { id: 'serie5', label: 'Serie 5', description: 'Fünf Abschüsse, ohne zu sterben.', xp: 100, tier: 'bronze' },
  serie10: { id: 'serie10', label: 'Serie 10', description: 'Zehn Abschüsse, ohne zu sterben.', xp: 250, tier: 'silber' },
  serie15: { id: 'serie15', label: 'Serie 15', description: 'Fünfzehn Abschüsse, ohne zu sterben.', xp: 500, tier: 'gold' },
  kollateral: { id: 'kollateral', label: 'Kollateral', description: 'Zwei Gegner mit einer einzigen Kugel.', xp: 100, tier: 'silber' },
  granate: { id: 'granate', label: 'Granate', description: 'Abschuss mit einer Granate.', xp: 50, tier: 'bronze' },
  verteidiger: { id: 'verteidiger', label: 'Verteidiger', description: 'Einen Gegner auf oder an einer eigenen Flagge ausgeschaltet.', xp: 50, tier: 'bronze' },
  eroberer: { id: 'eroberer', label: 'Eroberer', description: 'Eine Flagge eingenommen.', xp: 25, tier: 'bronze' },
  vorherrschaft: { id: 'vorherrschaft', label: 'Vorherrschaft', description: 'Dein Team hält alle drei Flaggen gleichzeitig.', xp: 100, tier: 'silber' },
  rueckkehrer: { id: 'rueckkehrer', label: 'Rückkehrer', description: 'Nach drei Toden in Folge endlich wieder ein Abschuss.', xp: 50, tier: 'bronze' },
  siegtreffer: { id: 'siegtreffer', label: 'Siegtreffer', description: 'Der entscheidende letzte Abschuss des Matches.', xp: 100, tier: 'gold' },
  haaresbreite: { id: 'haaresbreite', label: 'Haaresbreite', description: 'Abschuss mit weniger als 15 Lebenspunkten.', xp: 50, tier: 'bronze' },
  serienbrecher: { id: 'serienbrecher', label: 'Serienbrecher', description: 'Einen Gegner mit einer Serie von fünf oder mehr gestoppt.', xp: 75, tier: 'silber' },
  huefte: { id: 'huefte', label: 'Aus der Hüfte', description: 'Abschuss, ohne anzulegen.', xp: 25, tier: 'bronze' },
  durchschlag: { id: 'durchschlag', label: 'Durchschlag', description: 'Abschuss durch eine Wand oder Deckung hindurch.', xp: 50, tier: 'bronze' },
  demuetigung: { id: 'demuetigung', label: 'Demütigung', description: 'Im Waffenspiel einen Gegner per Messer zurückgestuft.', xp: 50, tier: 'silber' },
  praemie: { id: 'praemie', label: 'Prämienjäger', description: 'Abschuss mit einer Serienprämie.', xp: 50, tier: 'bronze' },
  unaufhaltsam: { id: 'unaufhaltsam', label: 'Unaufhaltsam', description: 'Match ohne einen einzigen Tod beendet (mindestens fünf Abschüsse).', xp: 300, tier: 'gold' },
  mvp: { id: 'mvp', label: 'MVP', description: 'Die höchste Punktzahl des Matches.', xp: 150, tier: 'gold' },
  abwehr: { id: 'abwehr', label: 'Abwehr', description: 'Ein gegnerisches Wachgeschütz zerstört.', xp: 50, tier: 'bronze' },
};

export const MEDAL_ORDER = Object.keys(MEDALS);

/** Schwellen für die Medaillenvergabe. */
export const MEDAL_RULES = {
  multiKillWindow: 4, // s zwischen zwei Abschüssen für Doppel-/Dreifachkill …
  headhunterCount: 3, // Kopftreffer-Abschüsse in einem Leben
  streaks: { 5: 'serie5', 10: 'serie10', 15: 'serie15' },
  comebackDeaths: 3, // Tode in Folge für „Rückkehrer“
  closeCallHealth: 15, // HP-Grenze für „Haaresbreite“
  saviorWindow: 3, // s: Opfer hat in diesem Fenster einen Verbündeten getroffen → „Retter“
  buzzkillStreak: 5, // Serie des Opfers für „Serienbrecher“
  flawlessMinKills: 5,
  defendRadius: 9, // m um eine eigene Flagge für „Verteidiger“
  // Weitschuss ab Distanz (m) je Waffenklasse
  longshotByClass: { ar: 40, smg: 25, lmg: 45, marksman: 50, sniper: 60, shotgun: 15, pistol: 25, melee: Infinity },
};

/** Medaillen-Id für eine Mehrfachabschuss-Kette der Länge n (≥ 2), sonst null. */
export function multiKillMedal(n) {
  if (n >= 5) return 'kahlschlag';
  return ({ 2: 'doppelkill', 3: 'dreifachkill', 4: 'vierfachkill' })[n] || null;
}

/** Ist ein Abschuss mit Waffenklasse `cls` auf `distance` Meter ein Weitschuss? */
export function isLongshot(cls, distance) {
  const min = MEDAL_RULES.longshotByClass[cls];
  return min !== undefined && distance >= min;
}

/* ------------------------------------------------------------ Punkte & XP */

/**
 * Spielpunkte im Match je `score`-Event-Reason (§3). Die Punktzahl wird nach dem Match 1:1 zu XP
 * (profile.recordMatch: XP = Punktzahl + Matchbonus + Medaillen).
 */
export const SCORE_RULES = {
  kill: 100,
  headshot: 25, // zusätzlich zum Abschuss
  assist: 50,
  capture: 150,
  defend: 75,
  streak: 50, // Serienprämie eingesetzt
  firstblood: 50,
  longshot: 25,
  revenge: 25,
  neutralize: 50, // gegnerische Flagge neutralisiert (Herrschaft)
  destroy: 50, // gegnerisches Wachgeschütz zerstört
};

/** Anzeigetexte der Punkte-Gründe (HUD-Einblendungen). */
export const SCORE_LABELS = {
  kill: 'Abschuss',
  headshot: 'Kopftreffer',
  assist: 'Unterstützung',
  capture: 'Flagge erobert',
  defend: 'Verteidigung',
  streak: 'Serienprämie',
  firstblood: 'Erstes Blut',
  longshot: 'Weitschuss',
  revenge: 'Rache',
  neutralize: 'Flagge neutralisiert',
  destroy: 'Geschütz zerstört',
};

/** Teamnamen aus Sicht des Spielers (Team A = eigene Seite). */
export const TEAM_NAMES = { A: 'Nordkorps', B: 'Ostbund' };

/**
 * XP-Regeln (Profil-Fortschritt), abgestimmt auf profile.js:
 *  - kill/assist/headshot/capture/defend …: XP je Ereignis (= SCORE_RULES, über die Punktzahl)
 *  - medal: Pauschale je Medaille; medalXp() liefert stattdessen die Einzelwerte aus MEDALS
 *  - matchComplete + win/draw: Matchbonus (Niederlage 500, Unentschieden 800, Sieg 1200),
 *    anteilig für Matches kürzer als fullBonusDuration Sekunden (mindestens minBonusFactor)
 *  - Schießstand: Punktzahl × trainingFactor, höchstens trainingMax
 *  - DIFFICULTIES[id].xpMult skaliert optional die Gesamt-XP
 */
export const XP_RULES = {
  ...SCORE_RULES,
  medal: 50,
  matchComplete: 500,
  win: 700,
  draw: 300,
  fullBonusDuration: 300,
  minBonusFactor: 0.3,
  trainingFactor: 0.25,
  trainingMax: 500,
};

/** Summe der Medaillen-XP für { [medalId]: count } (unbekannte Ids: XP_RULES.medal). */
export function medalXp(medals) {
  let sum = 0;
  for (const [id, count] of Object.entries(medals || {})) {
    sum += (MEDALS[id] ? MEDALS[id].xp : XP_RULES.medal) * (Number(count) || 0);
  }
  return sum;
}

/** Matchbonus-XP für 'win' | 'draw' | 'loss' und Matchdauer (s). */
export function matchBonusXp(result, duration = XP_RULES.fullBonusDuration) {
  const R = XP_RULES;
  const base = R.matchComplete + (result === 'win' ? R.win : result === 'draw' ? R.draw : 0);
  const factor = Math.min(1, Math.max(R.minBonusFactor, (Number(duration) || 0) / R.fullBonusDuration));
  return Math.round((base * factor) / 10) * 10;
}

/* ------------------------------------------------------------- Abfragen */

export function getMode(id) {
  return MODES[id] || null;
}

export function getDifficulty(id) {
  return DIFFICULTIES[id] || null;
}

export function getStreak(id) {
  return STREAKS[id] || null;
}

const COUNT_WORDS = ['keine', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht'];

/**
 * Regelliste für eine konkrete Besetzung (Lobby): Die erste Zeile (`rules[0]`, Besetzung) folgt dann
 * `sizeRule` – {team} eigene Seite inkl. Spieler, {enemies} Gegner, {players} alle, {mates} „du und fünf Verbündete“.
 * Ohne Angaben gelten defaultAllies/defaultEnemies (ergibt die statische Zeile).
 */
export function rulesFor(modeId, { allies, enemies } = {}) {
  const m = MODES[modeId];
  if (!m) return [];
  const rules = (m.rules || []).slice();
  if (!m.sizeRule || !rules.length) return rules;
  const a = m.teams === false ? 0 : Math.max(0, Number.isFinite(allies) ? allies : m.defaultAllies ?? 0);
  const e = Math.max(0, Number.isFinite(enemies) ? enemies : m.defaultEnemies ?? 0);
  const mates = a === 0 ? 'du allein' : a === 1 ? 'du und ein Verbündeter' : `du und ${COUNT_WORDS[a] || a} Verbündete`;
  rules[0] = m.sizeRule.replace('{team}', String(a + 1)).replace('{enemies}', String(e)).replace('{players}', String(a + e + 1)).replace('{mates}', mates);
  return rules;
}

/** Liste der Modi in Anzeige-Reihenfolge. */
export function listModes() {
  return MODE_ORDER.map((id) => MODES[id]);
}

/** „10 Minuten“, „kein Limit“ … für Lobby/Website. */
export function formatTimeLimit(seconds) {
  if (!seconds) return 'kein Limit';
  const m = Math.round(seconds / 60);
  return m === 1 ? '1 Minute' : `${m} Minuten`;
}
