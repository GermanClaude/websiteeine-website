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

export const MODE_ORDER = ['tdm', 'dom', 'cq', 'kc', 'ffa', 'inf', 'messer', 'gun', 'training'];

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
    limits: { allies: [0, 11], enemies: [1, 12] },
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
    limits: { allies: [0, 11], enemies: [1, 12] },
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
  cq: {
    id: 'cq',
    name: 'Eroberung',
    short: 'EROB',
    tagline: 'Fünf Flaggen, zwei Armeen, ein Ticketkonto.',
    description:
      'Großkampf auf weiter Karte: Nehmt die Flaggen A bis E ein, haltet sie und lasst den Gegner ausbluten. Jeder Wiedereinstieg kostet ein Ticket, wer mehr Flaggen hält, zieht dem Gegner laufend Tickets ab. Trupps zu viert, Einsatzkarte mit HQ-, Flaggen- und Truppspawns, Panzer und Geländewagen.',
    sizeRule: '{team} gegen {enemies} um fünf Flaggen',
    rules: [
      '12 gegen 12 um fünf Flaggen',
      'Jeder Wiedereinstieg kostet ein Ticket',
      'Mehr Flaggen = der Gegner blutet Tickets aus',
      'Wiedereinstieg am HQ, an eigenen Flaggen oder beim Trupp',
      'Panzer und Geländewagen am HQ',
      'Team ohne Tickets verliert',
    ],
    hudObjective: 'Erobere und halte die Flaggen',
    scoreUnit: 'Tickets',
    scoreLimit: 0,
    timeLimit: 2400,
    teams: true,
    defaultAllies: 11,
    defaultEnemies: 12,
    limits: { allies: [0, 31], enemies: [1, 32] },
    respawnDelay: 8,
    streaks: false,
    lethals: true,
    squads: true,
    deploy: true,
    vehicles: true,
    scales: ['gross'],
    // Tickets je Seite nach Teamgröße (≤ 8 / ≤ 16 / ≤ 24 / ≤ 32), × Matchlänge; Ausbluten: 1 Ticket alle
    // bleedInterval / Flaggendifferenz Sekunden, alle Flaggen → 1 je Sekunde. Einnehmen wie Herrschaft (12 s allein).
    objective: {
      flags: ['A', 'B', 'C', 'D', 'E'],
      captureTime: 12,
      captureRateBonus: 0.5,
      maxCapturers: 5,
      tickets: [[8, 150], [16, 250], [24, 320], [32, 400]],
      bleedInterval: 6,
      hqWarning: 10,
      hqRadius: 34,
      points: { capture: 200, neutralize: 100, defend: 50 },
    },
    matchLengths: { kurz: 0.6, standard: 1, lang: 1.7 },
    recommendedMaps: ['grenzland'],
    icon: icon('<path d="M4 21V4"/><path d="M4 5h8l-2 3 2 3H4"/><path d="M14 21V10"/><path d="M14 11h6l-1.5 2.25L20 15.5h-6"/>'),
  },

  kc: {
    id: 'kc',
    name: 'Abschuss bestätigt',
    short: 'KB',
    tagline: 'Ein Abschuss zählt erst, wenn die Marke eingesammelt ist.',
    description:
      'Jeder Ausgeschaltete verliert seine Erkennungsmarke. Sammle die Marken der Gegner ein, um Abschüsse zu bestätigen – und schnapp dir die Marken deiner Kameraden, bevor der Gegner es tut. Wer nur aus der Ferne schießt, punktet nicht.',
    sizeRule: '{team} gegen {enemies} – {mates}',
    rules: [
      '6 gegen 6 – du und fünf Verbündete',
      'Gegnerische Marke einsammeln = Abschuss bestätigt',
      'Eigene Marke einsammeln = Abschuss verweigert',
      'Erstes Team mit 50 Bestätigungen gewinnt',
      'Zeitlimit: 10 Minuten',
    ],
    hudObjective: 'Sammle die Erkennungsmarken ein',
    scoreUnit: 'Bestätigungen',
    scoreLimit: 50,
    timeLimit: 600,
    teams: true,
    defaultAllies: 5,
    defaultEnemies: 6,
    limits: { allies: [0, 11], enemies: [1, 12] },
    respawnDelay: 3,
    streaks: true,
    lethals: true,
    objective: { tagLife: 30, pickupRadius: 1.7 },
    recommendedMaps: ['altstadt', 'hafen', 'werk'],
    icon: icon('<path d="M8 3h8l1 4v11a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V7z"/><circle cx="12" cy="7" r="1.2"/><path d="M9.5 12h5M9.5 15h3.5"/>'),
  },

  inf: {
    id: 'inf',
    name: 'Infiziert',
    short: 'INF',
    tagline: 'Einer fängt an. Wer fällt, läuft über.',
    description:
      'Ein Infizierter mit Messer und Haftgranate jagt alle anderen. Jeder ausgeschaltete Überlebende wechselt die Seite. Überlebende bekommen zufällige Waffen und müssen drei Minuten durchhalten – die Infizierten gewinnen, sobald niemand mehr übrig ist.',
    sizeRule: '{players} Spieler, einer beginnt infiziert',
    rules: [
      '12 Spieler, einer beginnt infiziert',
      'Infizierte: Messer, Haftgranate, schneller zurück',
      'Ausgeschaltete Überlebende werden infiziert',
      'Überlebende: zufällige Waffen, 3 Minuten durchhalten',
      'Keine Serienprämien',
    ],
    hudObjective: 'Überlebe – oder infiziere alle',
    scoreUnit: 'Spieler',
    scoreLimit: 0,
    timeLimit: 180,
    teams: true,
    defaultAllies: 10,
    defaultEnemies: 1,
    limits: { allies: [1, 15], enemies: [1, 1] },
    respawnDelay: 2,
    streaks: false,
    lethals: true,
    teamNames: { A: 'Überlebende', B: 'Infizierte' },
    objective: { surviveTick: 20, infectedLoadout: { primary: 'knife', secondary: null, lethal: 'semtex' } },
    recommendedMaps: ['werk', 'altstadt', 'hafen'],
    icon: icon('<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
  },

  messer: {
    id: 'messer',
    name: 'Nur Messer',
    short: 'MES',
    tagline: 'Keine Waffen. Nur Klingen. Wer zuerst 30 erreicht, gewinnt.',
    description:
      'Zwei Teams, nur Messer: keine Schusswaffen, keine Granaten, keine Serienprämien. Wer schneller um die Ecke ist, gewinnt das Duell – Flanken und Überraschung entscheiden.',
    sizeRule: '{team} gegen {enemies} – {mates}',
    rules: [
      'Alle tragen nur das Messer',
      'Keine Schusswaffen, Granaten oder Serienprämien',
      'Erstes Team mit 30 Abschüssen gewinnt',
      'Zeitlimit: 8 Minuten',
      'Wiedereinstieg nach 2 Sekunden',
    ],
    hudObjective: 'Nur Messer – schalte das gegnerische Team aus',
    scoreUnit: 'Abschüsse',
    scoreLimit: 30,
    timeLimit: 480,
    teams: true,
    defaultAllies: 5,
    defaultEnemies: 6,
    limits: { allies: [0, 11], enemies: [1, 12] },
    respawnDelay: 2,
    streaks: false,
    lethals: false,
    objective: { loadout: { primary: 'knife', secondary: null, lethal: null, tactical: null } },
    recommendedMaps: ['werk', 'altstadt', 'hafen'],
    icon: icon('<path d="M4 20l7.5-7.5"/><path d="M11.5 12.5L19.5 4.5c.6 2.8-.2 5.6-2.6 8l-2.4 2.4"/><path d="M9.5 10.5l4 4"/>'),
  },

};

/* ------------------------------------------------------- Serienprämien */

/**
 * Plätze der Serienprämien = Tasten streak1…streak4 (3/4/5/6, Steuerkreuz ▲ ◀ ▶, LT + ▼, Touch-Knöpfe von links). Die
 * Reihenfolge ist fest (neue Prämien kommen hinten dazu, damit gewohnte Tasten bleiben); HUD und Fortschritt ordnen nach
 * Abschüssen (kills).
 */
export const STREAK_ORDER = ['uav', 'strike', 'sentry', 'drohne'];
/** Online verfügbare Prämien (Mehrspieler Stufe 1: nur die FPV-Drohne – Einsatz, Lage und Sprengung prüft der Host). */
export const ONLINE_STREAKS = ['drohne'];

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
  drohne: {
    id: 'drohne',
    name: 'FPV-Drohne',
    description: 'Du steuerst eine kleine Kamikaze-Drohne aus der Ich-Sicht: Feuern sprengt sie, Interagieren bricht ab. Dein Körper bleibt so lange stehen und ist verwundbar.',
    kills: 5,
    cost: 5,
    duration: 25,
    sound: 'drohne',
    // speed/boost m/s (Schub boostTime s, lädt mit boostRecharge/s nach), climb m/s, accel/brake 1/s (Trägheit),
    // battery s, range m (Signal ab signalFade schwächer), Sprengung radius/innerRadius m, maxDamage/minDamage,
    // health LP (kleine Trefferkugel hitRadius m), crashSpeed m/s (härterer Aufprall = Absturz ohne Sprengung).
    params: {
      speed: 18, boost: 26, boostTime: 2.2, boostRecharge: 0.35, climb: 7, accel: 2.6, brake: 2.2, battery: 25, range: 150, signalFade: 110,
      radius: 4.5, innerRadius: 1.2, maxDamage: 180, minDamage: 25, health: 40, hitRadius: 0.36, crashSpeed: 8,
    },
    icon: icon('<path d="M9 9l6 6M15 9l-6 6"/><circle cx="6.5" cy="6.5" r="2.6"/><circle cx="17.5" cy="6.5" r="2.6"/><circle cx="6.5" cy="17.5" r="2.6"/><circle cx="17.5" cy="17.5" r="2.6"/><rect x="10" y="10" width="4" height="4" rx="1"/>'),
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
  abwehr: { id: 'abwehr', label: 'Abwehr', description: 'Ein gegnerisches Wachgeschütz oder eine gegnerische FPV-Drohne zerstört.', xp: 50, tier: 'bronze' },
  panzerknacker: { id: 'panzerknacker', label: 'Panzerknacker', description: 'Ein gegnerisches Fahrzeug zerstört.', xp: 100, tier: 'silber' },
  flaggenstuermer: { id: 'flaggenstuermer', label: 'Flaggenstürmer', description: 'Drei Flaggen in einem Leben eingenommen.', xp: 150, tier: 'gold' },
  truppfuehrer: { id: 'truppfuehrer', label: 'Truppführer', description: 'Dein Trupp hat deinen Befehl ausgeführt.', xp: 75, tier: 'silber' },
  markensammler: { id: 'markensammler', label: 'Markensammler', description: 'Fünf Erkennungsmarken in einem Leben eingesammelt.', xp: 100, tier: 'silber' },
  ueberlebender: { id: 'ueberlebender', label: 'Überlebender', description: 'Bis zum Schluss nicht infiziert.', xp: 200, tier: 'gold' },
  patientnull: { id: 'patientnull', label: 'Patient null', description: 'Als erster Infizierter drei Überlebende erwischt.', xp: 150, tier: 'silber' },
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
  drone: 50, // gegnerische FPV-Drohne abgeschossen
  vehicle: 200, // gegnerisches Fahrzeug zerstört (Eroberung: je Typ VEHICLE_POINTS)
  squad: 50, // Trupp-Befehl erfüllt
  confirm: 100, // Erkennungsmarke eines Gegners eingesammelt (Abschuss bestätigt)
  deny: 50, // Marke eines Kameraden gesichert
  infect: 100, // Überlebenden infiziert
  survive: 50, // Infiziert: je Überlebens-Takt
};

/** Punkte für zerstörte Fahrzeuge je Typ (Eroberung; unbekannte Typen: SCORE_RULES.vehicle). */
export const VEHICLE_POINTS = { mbt: 400, jeep: 150, tractor: 100 };

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
  drone: 'Drohne abgeschossen',
  vehicle: 'Fahrzeug zerstört',
  squad: 'Befehl ausgeführt',
  confirm: 'Abschuss bestätigt',
  deny: 'Abschuss verweigert',
  infect: 'Infiziert',
  survive: 'Überlebt',
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

/* ===================================================================== Großkampf, Spielstil, Klassen (modes-ui)
 * Alles rein: Lobby, Spiel und Website nutzen dieselben Tabellen. Siehe docs/ARCHITECTURE.md (Changelog modes-ui). */

/**
 * Spielstil und Klassen stehen in `shared/classes.data.js` (core-mechanics: GAME_STYLES, styleFlags, CLASSES …).
 * `styleRules()` liefert nur die Lobby-Abweichungen (Fadenkreuz-Schalter, Wiedereinstieg), die
 * `styleFlags(style, { rules })` über die Stil-Flags legt.
 */
export const STYLE_RESPAWN = { arcade: null, realistisch: 6 };
export function styleRules(style, { crosshair } = {}) {
  const r = {};
  if (crosshair === true || crosshair === false) r.crosshair = crosshair;
  if (STYLE_RESPAWN[style]) r.respawnDelay = STYLE_RESPAWN[style];
  return r;
}

/** Ausführungen der Klassen-Outfits (loadout.skin = `${klasse}:${id}`; Darstellung: bots/gunsmith). */
export const OPERATOR_TIERS = [
  { id: 'standard', name: 'Standard', level: 1, text: 'Dienstausführung' },
  { id: 'veteran', name: 'Veteran', level: 20, text: 'Getragen, mit Abzeichen' },
  { id: 'elite', name: 'Elite', level: 40, text: 'Dunkel, Goldrand' },
];

/** Trupp-Rufnamen (Eroberung): 4 Mitglieder je Trupp. */
export const SQUAD_NAMES = ['Anton', 'Berta', 'Cäsar', 'Dora', 'Emil', 'Friedrich', 'Gustav', 'Heinrich'];
export const SQUAD_SIZE = 4;

/* ------------------------------------------------------------ Teamgrößen je Karte und Gerät (GROSSKAMPF §3.2) */

const BIG_MAPS = new Set(['grenzland', 'talsperre', 'nordkueste']);
export function mapScaleOf(map) {
  if (map && typeof map === 'object') return map.scale === 'gross' ? 'gross' : 'arena';
  return BIG_MAPS.has(map) ? 'gross' : 'arena';
}

/**
 * limitsFor(modeId, map (MAPS-Eintrag oder Id), { tier: 'low'|'medium'|'high'|'ultra', touch, deviceMemory })
 * → { allies:[min,max], enemies:[min,max], recommended:{allies,enemies}, warn:{yellow,red} (Teamgröße inkl. Spieler), scale }
 * `allies` zählt ohne Spieler. Arena-Karten höchstens 12 v 12, Großkarten 32 v 32 (deviceMemory ≤ 2: 16 v 16).
 */
export function limitsFor(modeId, map, { tier = 'high', touch = false, deviceMemory = null } = {}) {
  const m = MODES[modeId] || MODES.tdm;
  const scale = mapScaleOf(map);
  const teams = m.teams !== false;
  const base = m.limits || { allies: [0, 11], enemies: [1, 12] };
  let allies = base.allies.slice();
  let enemies = base.enemies.slice();
  let rec = { allies: teams ? m.defaultAllies ?? 5 : 0, enemies: m.defaultEnemies ?? 6 };
  const warn = { yellow: null, red: null };
  if (modeId === 'training' || modeId === 'inf') return { allies, enemies, recommended: rec, warn, scale };
  if (scale === 'gross') {
    const side = deviceMemory != null && deviceMemory <= 2 ? 16 : 32;
    if (teams) { allies = [0, side - 1]; enemies = [1, side]; } else enemies = [1, Math.min(23, side * 2 - 1)];
    if (modeId === 'cq') {
      const n = tier === 'low' ? 12 : tier === 'medium' ? (touch ? 16 : 24) : 32;
      rec = { allies: Math.min(n, side) - 1, enemies: Math.min(n, side) };
    }
    if (tier === 'low') { warn.yellow = 16; warn.red = 24; } else if (tier === 'medium') warn.yellow = 24;
  } else if (tier === 'low') warn.yellow = teams ? 9 : 10;
  return { allies, enemies, recommended: rec, warn, scale };
}

/** Warnstufe für eine Besetzung: { level: null|'yellow'|'red', text }. */
export function teamWarning(lim, allies, enemies, teams = true) {
  if (!lim || !lim.warn) return { level: null, text: '' };
  const size = teams ? Math.max((allies | 0) + 1, enemies | 0) : (enemies | 0) + 1;
  if (lim.warn.red && size >= lim.warn.red) return { level: 'red', text: 'Experimentell: Bei so vielen Bots kann die Bildrate auf diesem Gerät unter 30 FPS fallen.' };
  if (lim.warn.yellow && size >= lim.warn.yellow) {
    const r = lim.recommended || {};
    const rec = teams ? `${(r.allies ?? 5) + 1} gegen ${r.enemies ?? 6}` : `${(r.enemies ?? 7) + 1} Spieler`;
    return { level: 'yellow', text: `Für dieses Gerät empfohlen: ${rec}. Mehr Bots können ruckeln und das Gerät warm machen.` };
  }
  return { level: null, text: '' };
}

/** Eroberung: Tickets je Seite für eine Teamgröße (inkl. Spieler) und Matchlänge. */
export function ticketsFor(sideSize, length = 'standard') {
  const cq = MODES.cq.objective;
  let t = cq.tickets[cq.tickets.length - 1][1];
  for (const [max, n] of cq.tickets) if (sideSize <= max) { t = n; break; }
  return Math.round(t * (MODES.cq.matchLengths[length] || 1));
}

/* ------------------------------------------------------------ Herausforderungen (täglich, wöchentlich, dauerhaft) */

/**
 * Vorlagen: stat = Kennzahl aus dem Match (challengeStats), d/w = Ziel täglich/wöchentlich, max = höchster Wert
 * statt Summe. Texte mit {n}. Belohnung: EP (täglich 300–500, wöchentlich 1500–2500).
 */
export const CHALLENGE_POOL = [
  { id: 'kills', text: 'Erziele {n} Abschüsse', stat: 'kills', d: 15, w: 75 },
  { id: 'headshots', text: '{n} Abschüsse per Kopftreffer', stat: 'headshots', d: 5, w: 30 },
  { id: 'assists', text: 'Sammle {n} Unterstützungen', stat: 'assists', d: 6, w: 30 },
  { id: 'captures', text: 'Nimm {n} Flaggen ein', stat: 'captures', d: 3, w: 15 },
  { id: 'wins', text: 'Gewinne {n} Matches', one: 'Gewinne ein Match', stat: 'wins', d: 2, w: 8 },
  { id: 'matches', text: 'Spiele {n} Matches zu Ende', stat: 'matches', d: 3, w: 12 },
  { id: 'score', text: 'Sammle {n} Punkte', stat: 'score', d: 3000, w: 15000 },
  { id: 'longshots', text: 'Gelingen dir {n} Weitschüsse', stat: 'longshots', d: 2, w: 10 },
  { id: 'knife', text: '{n} Abschüsse mit dem Messer', stat: 'knife', d: 2, w: 8 },
  { id: 'grenades', text: '{n} Abschüsse mit Granaten', stat: 'grenades', d: 2, w: 10 },
  { id: 'medals', text: 'Verdiene {n} Medaillen', stat: 'medals', d: 10, w: 50 },
  { id: 'streak', text: 'Erreiche eine Serie von {n} Abschüssen', stat: 'streak', d: 5, w: 10, max: true },
  { id: 'vehicles', text: 'Zerstöre {n} Fahrzeuge', one: 'Zerstöre ein Fahrzeug', stat: 'vehicles', d: 1, w: 5 },
  { id: 'confirms', text: 'Bestätige {n} Abschüsse (Abschuss bestätigt)', stat: 'confirms', d: 10, w: 40 },
  { id: 'denies', text: 'Verweigere {n} Abschüsse (Abschuss bestätigt)', stat: 'denies', d: 4, w: 15 },
  { id: 'infects', text: 'Infiziere {n} Überlebende', stat: 'infects', d: 3, w: 12 },
  { id: 'survivals', text: 'Überlebe {n}-mal bis zum Schluss (Infiziert)', one: 'Überlebe einmal bis zum Schluss (Infiziert)', stat: 'survivals', d: 1, w: 4 },
  { id: 'squad', text: 'Lass deinen Trupp {n} Befehle ausführen', stat: 'squad', d: 2, w: 10 },
  { id: 'playtime', text: 'Spiele {n} Minuten', stat: 'minutes', d: 20, w: 120 },
  { id: 'hardwins', text: 'Gewinne {n} Matches auf Veteran oder Elite', one: 'Gewinne ein Match auf Veteran oder Elite', stat: 'hardWins', d: 1, w: 3 },
  { id: 'realkills', text: '{n} Abschüsse im Spielstil Realistisch', stat: 'realKills', d: 10, w: 40 },
  { id: 'multi', text: '{n} Mehrfachabschüsse (Doppelkill oder mehr)', stat: 'multis', d: 2, w: 10 },
  { id: 'mvp', text: 'Werde {n}-mal MVP', one: 'Werde einmal MVP', stat: 'mvp', d: 1, w: 3 },
  { id: 'damage', text: 'Verursache {n} Schaden', stat: 'damage', d: 2500, w: 12000 },
];
export const CHALLENGE_COUNTS = { daily: 3, weekly: 5 };
export const CHALLENGE_XP = { daily: [300, 500], weekly: [1500, 2500] };

/** Dauerhafte Meilensteine (Stufen Bronze/Silber/Gold/Nullpunkt). */
export const MILESTONE_TIERS = ['Bronze', 'Silber', 'Gold', 'Nullpunkt'];
export const MILESTONE_XP = [250, 500, 1000, 2500];
export const MILESTONES = [
  { id: 'kills', text: 'Abschüsse', stat: 'kills', tiers: [100, 500, 2000, 10000] },
  { id: 'headshots', text: 'Kopftreffer-Abschüsse', stat: 'headshots', tiers: [50, 250, 1000, 5000] },
  { id: 'wins', text: 'Siege', stat: 'wins', tiers: [5, 25, 100, 500] },
  { id: 'captures', text: 'Eingenommene Flaggen', stat: 'captures', tiers: [10, 50, 200, 1000] },
  { id: 'vehicles', text: 'Zerstörte Fahrzeuge', stat: 'vehicles', tiers: [3, 15, 50, 200] },
  { id: 'confirms', text: 'Bestätigte Abschüsse', stat: 'confirms', tiers: [25, 100, 400, 1500] },
  { id: 'infects', text: 'Infizierte Überlebende', stat: 'infects', tiers: [10, 50, 200, 800] },
  { id: 'medals', text: 'Medaillen', stat: 'medals', tiers: [25, 100, 500, 2000] },
  { id: 'squad', text: 'Ausgeführte Trupp-Befehle', stat: 'squad', tiers: [5, 25, 100, 400] },
  { id: 'secrets', text: 'Gefundene Geheimnisse', stat: 'secrets', tiers: [1, 2, 4, 8] },
];

const pad2 = (n) => String(n).padStart(2, '0');
/** Lokaler Tag „JJJJ-MM-TT“ (Tages-Herausforderungen wechseln um Mitternacht). */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** ISO-Woche „JJJJ-Www“ (Wochen-Herausforderungen wechseln montags). */
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${pad2(Math.ceil(((t - y0) / 86400000 + 1) / 7))}`;
}
function seeded(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Auswahl für 'daily' | 'weekly' und Schlüssel (gleicher Tag/gleiche Woche → gleiche Auswahl). */
export function challengeSet(kind, key = kind === 'weekly' ? weekKey() : dayKey()) {
  const rnd = seeded(`${kind}:${key}`);
  const pool = CHALLENGE_POOL.slice();
  const out = [];
  const n = CHALLENGE_COUNTS[kind] || 3;
  const [lo, hi] = CHALLENGE_XP[kind] || [300, 500];
  while (out.length < n && pool.length) {
    const t = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const target = kind === 'weekly' ? t.w : t.d;
    out.push({ id: t.id, kind, key, stat: t.stat, max: !!t.max, target, text: target === 1 && t.one ? t.one : t.text.replace('{n}', target.toLocaleString('de-DE')), xp: Math.round((lo + rnd() * (hi - lo)) / 50) * 50 });
  }
  return out;
}

/** Kennzahlen eines Matches (bereinigte playerSummary + counters) für Herausforderungen/Meilensteine. */
export function challengeStats(s = {}) {
  const md = s.medals || {};
  const c = s.counters || {};
  const won = s.result === 'win';
  return {
    kills: s.kills | 0, headshots: s.headshots | 0, assists: s.assists | 0, captures: s.captures | 0, wins: won ? 1 : 0,
    matches: s.modeId === 'training' ? 0 : 1, score: s.score | 0, longshots: md.weitschuss | 0, knife: md.nahkampf | 0,
    grenades: md.granate | 0, medals: Object.values(md).reduce((a, b) => a + (b | 0), 0), streak: s.bestStreak | 0,
    vehicles: c.vehicles | 0, confirms: c.confirms | 0, denies: c.denies | 0, infects: c.infects | 0, survivals: c.survivals | 0,
    squad: c.squad | 0, minutes: Math.floor((Number(s.duration) || 0) / 60), hardWins: won && (s.difficulty === 'veteran' || s.difficulty === 'elite') ? 1 : 0,
    realKills: s.style === 'realistisch' ? s.kills | 0 : 0, multis: (md.doppelkill | 0) + (md.dreifachkill | 0) + (md.vierfachkill | 0) + (md.kahlschlag | 0),
    mvp: md.mvp | 0, damage: s.damage | 0, secrets: c.secrets | 0,
  };
}

export function blankChallenges() {
  return { daily: { key: '', prog: {}, done: [] }, weekly: { key: '', prog: {}, done: [] }, totals: {}, claimed: {} };
}

/**
 * Verbucht ein Match in `store` (profile.challenges, wird verändert). `base` = Profilwerte für Meilensteine
 * ({kills, headshots, wins, medals}). → { store, completed: [{ id, kind, text, xp }] }
 */
export function applyChallenges(store, summary, { now = new Date(), base = {} } = {}) {
  const st = store && typeof store === 'object' ? store : blankChallenges();
  const stats = challengeStats(summary);
  const completed = [];
  for (const kind of ['daily', 'weekly']) {
    const key = kind === 'weekly' ? weekKey(now) : dayKey(now);
    let slot = st[kind];
    if (!slot || slot.key !== key) slot = st[kind] = { key, prog: {}, done: [] };
    for (const ch of challengeSet(kind, key)) {
      if (slot.done.includes(ch.id)) continue;
      const v = stats[ch.stat] || 0;
      const prev = slot.prog[ch.id] || 0;
      const next = ch.max ? Math.max(prev, v) : prev + v;
      slot.prog[ch.id] = Math.min(next, ch.target);
      if (next >= ch.target) { slot.done.push(ch.id); completed.push({ id: ch.id, kind, text: ch.text, xp: ch.xp }); }
    }
  }
  st.totals = st.totals || {};
  for (const [k, v] of Object.entries(stats)) if (v && k !== 'streak') st.totals[k] = (st.totals[k] || 0) + v;
  st.claimed = st.claimed || {};
  for (const ms of milestoneState(st, base)) {
    for (let t = (st.claimed[ms.id] || 0); t < ms.tier; t++) {
      completed.push({ id: `${ms.id}:${t + 1}`, kind: 'milestone', text: `${ms.text}: ${MILESTONE_TIERS[t]} (${ms.tiers[t].toLocaleString('de-DE')})`, xp: MILESTONE_XP[t] });
    }
    st.claimed[ms.id] = Math.max(st.claimed[ms.id] || 0, ms.tier);
  }
  return { store: st, completed };
}

/** Stand der Meilensteine: [{ id, text, value, tier (erreichte Stufen), next, tiers }]. */
export function milestoneState(store, base = {}) {
  const totals = (store && store.totals) || {};
  return MILESTONES.map((m) => {
    const value = Math.max(totals[m.stat] || 0, base[m.stat] || 0);
    let tier = 0;
    while (tier < m.tiers.length && value >= m.tiers[tier]) tier++;
    return { id: m.id, text: m.text, value, tier, next: m.tiers[tier] ?? null, tiers: m.tiers };
  });
}

/** Aktueller Stand der Tages-/Wochenauswahl für die Anzeige. */
export function challengeView(store, kind, now = new Date()) {
  const key = kind === 'weekly' ? weekKey(now) : dayKey(now);
  const slot = store && store[kind] && store[kind].key === key ? store[kind] : { prog: {}, done: [] };
  return challengeSet(kind, key).map((c) => ({ ...c, value: slot.prog[c.id] || 0, done: slot.done.includes(c.id) }));
}

/* ------------------------------------------------------------ Geheimnisse (Easter Eggs) */

/** Bekannte Geheimnisse (Karten melden `secret:found {id, name}`; unbekannte Ids erscheinen nach dem Fund). */
export const SECRETS = [
  { id: 'grenzland-zwerg', map: 'grenzland', name: 'Der Heuboden-Zwerg', hint: 'Grenzland: Wer sich duckt, findet mehr als Stroh.' },
  { id: 'grenzland-gertrud', map: 'grenzland', name: 'Gertrud', hint: 'Grenzland: Die Scheune hat einen Stammgast.' },
];

/* ------------------------------------------------------------ Kosmetik: Freischaltregeln (Daten: weapons.data.js CAMOS/SKINS) */

/**
 * Freischaltung einer Tarnung/eines Outfits. Akzeptiert `unlock: { level | kills | headshots | milestone+tier | secret | challenge }`
 * oder die Kurzformen `unlockLevel` / `kills`. ctx = { level, weaponStats, milestones: {id: tier}, secrets: {id: true}, weaponId }.
 * → { unlocked, text }
 */
export function cosmeticUnlock(item, ctx = {}) {
  if (!item) return { unlocked: false, text: '' };
  const u = item.unlock || {};
  const lvl = u.level ?? item.unlockLevel;
  const kills = u.kills ?? item.kills;
  const ws = ctx.weaponId && ctx.weaponStats ? ctx.weaponStats[ctx.weaponId] || {} : {};
  if (u.secret) return ctx.secrets && ctx.secrets[u.secret] ? { unlocked: true, text: 'Geheimnis gefunden' } : { unlocked: false, text: 'Geheim' };
  if (u.milestone) {
    const have = (ctx.milestones && ctx.milestones[u.milestone]) || 0;
    const m = MILESTONES.find((x) => x.id === u.milestone);
    const t = Math.max(1, u.tier || 1);
    return { unlocked: have >= t, text: `Meilenstein ${m ? m.text : u.milestone}: ${MILESTONE_TIERS[t - 1] || t}` };
  }
  if (Number.isFinite(kills) && kills > 0) {
    const have = ws.kills | 0;
    return { unlocked: have >= kills, text: `${kills} Abschüsse mit dieser Waffe (${Math.min(have, kills)}/${kills})` };
  }
  if (Number.isFinite(u.headshots) && u.headshots > 0) {
    const have = ws.headshots | 0;
    return { unlocked: have >= u.headshots, text: `${u.headshots} Kopftreffer mit dieser Waffe (${Math.min(have, u.headshots)}/${u.headshots})` };
  }
  if (Number.isFinite(lvl) && lvl > 1) return { unlocked: (ctx.level || 1) >= lvl, text: `Ab Stufe ${lvl}` };
  return { unlocked: true, text: 'Verfügbar' };
}
