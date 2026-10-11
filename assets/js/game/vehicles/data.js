// NULLPUNKT — Fahrzeugdaten (reine Daten, ohne three; GROSSKAMPF_PLAN §6.1/§6.4).
//
// Koordinaten: Meter, Fahrzeug-Lokalraum X rechts, Y oben, −Z vorn (wie Kamera/Spieler: Gier 0 schaut nach −Z).
// Der Ursprung liegt am Boden unter der Wannenmitte (Federn in Ruhelage). `com` = Schwerpunkt im Lokalraum.
// Räder: `mountY` = Aufhängungspunkt; Ruhelage so gewählt, dass die Radunterkante bei statischer Last auf y = 0 steht
// (mountY = rest + radius − statische Einfederung).

const deg = (d) => (d * Math.PI) / 180;

/** Fahrzeugwaffen. Maschinengewehre sind Hitscan über combat.fireHitscan (gleiches Schema wie WEAPONS),
 *  Kanonen verschießen ballistische Granaten (Schwerkraft, Splash über combat.explode). */
export const VEHICLE_WEAPONS = {
  // Kanone (panzer-mp.md §B.9): Mündungsgeschwindigkeiten realer 120-mm-Munition (Wuchtgeschoss ~1650 m/s,
  // Mehrzweckgranate ~1140 m/s); reload = Automatik mit Ladeschütze, reloadNoLoader = ohne (Kommandant/Richtschütze lädt)
  mbt_ap: {
    id: 'mbt_ap', name: '120 mm Wuchtgeschoss (PG)', short: 'PG', kind: 'shell',
    speed: 1650, gravity: 9.81, reload: 5.0, reloadNoLoader: 8.0, mag: 1, life: 1.6,
    vehicleDamage: 300, actorDamage: 220, splash: { radius: 2.6, maxDamage: 95 },
    penetrating: true, shake: 0.55, icon: 'shell',
  },
  mbt_he: {
    id: 'mbt_he', name: '120 mm Mehrzweckgranate (SG)', short: 'SG', kind: 'shell',
    speed: 1140, gravity: 9.81, reload: 5.0, reloadNoLoader: 8.0, mag: 1, life: 2.0,
    vehicleDamage: 170, actorDamage: 200, splash: { radius: 7.5, maxDamage: 170, innerRadius: 1.6, minDamage: 25 },
    penetrating: false, shake: 0.5, icon: 'shell',
  },
  mbt_coax: {
    id: 'mbt_coax', name: 'Koaxial-MG', short: 'MG', kind: 'mg',
    rpm: 620, mag: 200, reload: 4.5, spread: 0.0045, range: 320, profile: 'lmg',
    damage: { max: 30, min: 22, rangeStart: 30, rangeEnd: 140 }, headMult: 1.6, limbMult: 0.9, penetration: 0.35,
    vehicleMult: 0.4, tracerEvery: 3, icon: 'mg',
  },
  mbt_cmg: {
    id: 'mbt_cmg', name: 'Fernbedientes MG .50', short: 'MG', kind: 'mg',
    rpm: 480, mag: 100, reload: 5.2, spread: 0.005, range: 360, profile: 'ar_heavy',
    damage: { max: 42, min: 30, rangeStart: 40, rangeEnd: 160 }, headMult: 1.5, limbMult: 0.9, penetration: 0.5,
    vehicleMult: 0.55, tracerEvery: 2, icon: 'mg',
  },
  jeep_mg: {
    id: 'jeep_mg', name: 'Schweres MG', short: 'MG', kind: 'mg',
    rpm: 520, mag: 100, reload: 5.0, spread: 0.0065, range: 340, profile: 'ar_heavy',
    damage: { max: 40, min: 28, rangeStart: 35, rangeEnd: 150 }, headMult: 1.5, limbMult: 0.9, penetration: 0.5,
    vehicleMult: 0.55, tracerEvery: 2, icon: 'mg',
  },
  // Panzergenerationen (Nutzer 11.10.): 2. Weltkrieg – schnelles Gurt-MG (Bug- und Koaxial-MG)
  wk2_mg: {
    id: 'wk2_mg', name: 'Bug-MG (Gurt)', short: 'MG', kind: 'mg',
    rpm: 900, mag: 150, reload: 6.0, spread: 0.0075, range: 300, profile: 'lmg',
    damage: { max: 31, min: 21, rangeStart: 25, rangeEnd: 120 }, headMult: 1.6, limbMult: 0.9, penetration: 0.35,
    vehicleMult: 0.35, tracerEvery: 4, icon: 'mg',
  },
  // 1. Weltkrieg – wassergekühltes MG im Kugelstand, langsam, langer Gurt
  wk1_mg: {
    id: 'wk1_mg', name: 'Wassergekühltes MG', short: 'MG', kind: 'mg',
    rpm: 450, mag: 250, reload: 8.0, spread: 0.009, range: 260, profile: 'lmg',
    damage: { max: 34, min: 22, rangeStart: 25, rangeEnd: 110 }, headMult: 1.5, limbMult: 0.9, penetration: 0.3,
    vehicleMult: 0.3, tracerEvery: 5, icon: 'mg',
  },
};

/** Sonder-Ursachen für Abschussmeldungen (Killfeed/Bezeichnungen). */
export const VEHICLE_CAUSES = {
  roadkill: 'Überfahren',
  vehicle_explosion: 'Fahrzeugexplosion',
  vehicle_crash: 'Zusammenstoß',
};

export const VEHICLES = {
  mbt: {
    id: 'mbt', name: 'KP-1 Mammut', cls: 'Kampfpanzer', drive: 'tracked', model: 'mbt', sound: 'tank',
    health: 1000, armored: true, respawn: 90, wreckTime: 22,
    smallArmsMult: 0, explosiveMult: 0.3, ramMult: 0.2,
    mass: 52000, com: [0, 0.82, 0.1],
    // Kollisions-/Trefferquader im Lokalraum: [cx, cy, cz, hx, hy, hz]
    hullBox: [0, 1.05, 0.05, 1.78, 0.62, 3.6],
    turretBox: [0, 0.4, 0.25, 1.32, 0.4, 1.75], // im Turmraum (Turmdrehpunkt)
    turretPivot: [0, 1.67, 0.15],
    gunPivot: [0, 0.42, -1.45], // im Turmraum
    muzzle: [0, 0, -5.55],      // im Rohrraum
    coax: [0.42, 0.02, -0.7],   // im Rohrraum
    cmgPivot: [-0.62, 1.12, 0.62], // im Turmraum (Kommandanten-MG, eigene Lafette)
    cmgMuzzle: [0, 0.08, -1.0],
    gunLimits: { min: deg(-9), max: deg(20) },
    traverse: deg(40), elevate: deg(24), // Turm ~360° in 9 s, Rohr −9°…+20° (50–60-t-Klasse)
    wheels: {
      radius: 0.36, rest: 0.44, stiffness: 430000, damping: 48000,
      x: 1.42, z: [-2.65, -1.32, 0, 1.32, 2.65],
    },
    // Triebwerk (drivetrain.js, panzer-mp.md §A.1/§A.2): 1100 kW bei 2600/min (Klasse 50–60 t), Wandler + 5/2 Gänge
    engine: {
      idleRpm: 700, ratedRpm: 2600, cutRpm: 2750, cruiseRpm: 2300, // Leerlauf, Nenn-, Abregel-, Marschdrehzahl
      torque: [[600, 2200], [700, 2700], [1000, 3800], [1400, 4550], [1700, 4700], [2000, 4600], [2300, 4350], [2600, 4040], [2750, 0]], // Nm
      gears: { '-2': 2.55, '-1': 5.9, 1: 6.4, 2: 4.1, 3: 2.6, 4: 1.65, 5: 1.05 }, // Getriebe (Betrag), Richtung aus dem Vorzeichen
      finalDrive: 4.4, sprocketR: 0.32, efficiency: 0.75, rotInertia: 1.15, // Achs-/Seitenvorgelege, Triebradradius (m), η, Drehmassen
      converter: { stallRpm: 1450, mult: 1.75, coupleRpm: 1400 },         // Wandler: Festbremsdrehzahl, Wandlung, Überbrückung
      torqueLag: 0.25, shiftTime: 0.5, autoUp: 2450, autoDown: 1250,      // Ladedruck-Verzug (s), Schaltpause (s), Automatik
      engineBrake: [300, 0.4],            // Schleppmoment Nm = a + b·(rpm − idle), nur ohne Last
      rollRes: { concrete: 0.03, tile: 0.03, wood: 0.035, metal: 0.03, dirt: 0.045, grass: 0.05, sand: 0.08, default: 0.04 },
      traction: { concrete: 0.75, tile: 0.7, wood: 0.6, metal: 0.55, dirt: 0.85, grass: 0.7, sand: 0.6, default: 0.8 }, // µ längs (Kette)
      airRes: 4.0,                        // ½·ρ·cw·A (N/(m/s)²)
      neutralDrag: 20000,                 // Schleppverluste Getriebe/Laufwerk ohne Kraftschluss (N, in N/Schaltpause)
      brake: 330000, turnRate: 0.8, turnRateMoving: 0.62, latAccMax: 4.5,
      maxSpeed: 18.9, reverseSpeed: 7.8,  // Kennwerte (Autopilot, HUD) – aus den Übersetzungen bei Nenndrehzahl
    },
    grip: { long: 1.0, lat: 0.95, latTurning: 0.55, rollInfluence: 0.25 },
    drag: 0.9, angularDamp: 2.2,
    zones: {
      hull: { label: 'Wanne', hp: 1000 },
      engine: { label: 'Motor', hp: 260 },
      tracks: { label: 'Ketten', hp: 220 },
      turret: { label: 'Turm', hp: 300 },
    },
    // Besatzung wie Squad 44 (panzer-mp.md §B.1, Reihenfolge verbindlich): pos = Füße bei geschlossener Luke (Wannenraum),
    // views = Sichten je Sitz (Format §3.5; Taste „Sicht“ schaltet durch, 'aussen' nur bei erlaubter Außenansicht)
    seats: [
      {
        id: 'driver', label: 'Fahrer', drive: true, weapons: [],
        pos: [-0.55, 0.55, -2.35], exit: [[-2.7, 0, -1.6], [2.7, 0, -1.6], [0, 0, -4.6], [0, 0, 4.6]],
        views: [
          { id: 'spiegel', label: 'Winkelspiegel', space: 'hull', pos: [-0.55, 1.72, -2.62], look: 'rel', yaw: [-0.55, 0.55], pitch: [-0.2, 0.25], zoom: [1.25], overlay: 'slit' },
          { id: 'luke', label: 'Luke offen', space: 'hull', pos: [-0.55, 2.2, -2.3], look: 'rel', yaw: [-2.6, 2.6], pitch: [-0.6, 0.8], zoom: [1, 1.8], exposed: true, hatch: 'driver', pin: [-0.55, 0.95, -2.35] },
          { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 11, height: 4.7, pivot: 2.6 } },
        ],
      },
      {
        id: 'gunner', label: 'Richtschütze', weapons: ['mbt_ap', 'mbt_he', 'mbt_coax'], mount: 'gun',
        pos: [0.45, 0.75, -0.35], exit: [[2.7, 0, -0.4], [-2.7, 0, -0.4], [0, 0, 4.6], [0, 0, -4.6]],
        views: [
          { id: 'optik', label: 'Hauptzieloptik', space: 'gun', pos: [0.48, 0.66, -1.3], look: 'mount', zoom: [3, 8, 12], overlay: 'optic' },
          { id: 'weit', label: 'Weitwinkel', space: 'gun', pos: [0.48, 0.66, -1.3], look: 'mount', zoom: [1.2, 2.5], overlay: 'wide' },
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [0.62, 0.6, -0.55], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 11, height: 4.7, pivot: 2.6 } },
        ],
      },
      {
        id: 'commander', label: 'Kommandant', weapons: ['mbt_cmg'], mount: 'cmg',
        pos: [-0.6, 0.95, 0.55], exit: [[-2.7, 0, 0.6], [2.7, 0, 0.6], [0, 0, 4.6]],
        views: [
          { id: 'periskop', label: 'Rundblickperiskop', space: 'cupola', pos: [0, 0.32, 0.55], look: 'mount', zoom: [1.5, 4, 8], overlay: 'peri' },
          { id: 'luke', label: 'Luke offen', space: 'turret', pos: [-0.62, 1.45, 0.75], look: 'mount', zoom: [1, 4, 7], overlay: 'binocular', exposed: true, hatch: 'commander', pin: [-0.62, 0.27, 0.62] },
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [-0.62, 0.62, 0.45], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 10, height: 4.8, pivot: 2.8 } },
        ],
      },
      {
        id: 'loader', label: 'Ladeschütze', loader: true, weapons: [],
        pos: [0.6, 0.8, 0.5], exit: [[2.7, 0, 0.6], [-2.7, 0, 0.6], [0, 0, 4.6]],
        views: [
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [0.55, 0.62, 0.35], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], overlay: 'loader', interior: true },
          { id: 'luke', label: 'Luke offen', space: 'turret', pos: [0.6, 1.35, 0.55], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.6, 0.8], zoom: [1, 2], exposed: true, hatch: 'loader', pin: [0.6, 0.08, 0.55] },
          { id: 'aussen', label: 'Außenansicht', look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 10, height: 4.8, pivot: 2.8 } },
        ],
      },
    ],
    // Luken (Scharnier-Lage für das Modell, Raum 'hull' bzw. 'turret'), Innenraum (Turmraum, gunPitch 0), Besatzung, Gestell
    hatches: {
      driver: { space: 'hull', pos: [-0.55, 1.65, -2.35], r: 0.34 },
      commander: { space: 'turret', pos: [-0.62, 1.03, 0.62], r: 0.38 },
      loader: { space: 'turret', pos: [0.6, 0.83, 0.55], r: 0.3 },
    },
    // Munitionsbunker im Turmheck hinter einer Schiebetür (Vorbild: moderne Kampfpanzer mit Sprengklappen)
    interior: { breech: [0, 0.42, -0.55], rack: [0, 0.45, 1.55], loaderEye: [0.55, 0.62, 0.35], blastDoor: true },
    crew: { switchTime: 1.2, faceTol: 0.6 /* rad */ },
    ammo: { mbt_ap: 22, mbt_he: 18 },
    lights: [[-1.25, 1.32, -3.62], [1.25, 1.32, -3.62]],
  },

  jeep: {
    id: 'jeep', name: 'GW-4 Steppe', cls: 'Geländewagen', drive: 'wheeled', model: 'jeep', sound: 'car',
    health: 350, armored: false, respawn: 30, wreckTime: 15,
    smallArmsMult: 0.4, explosiveMult: 1.0, ramMult: 1,
    mass: 2400, com: [0, 0.62, 0.05],
    hullBox: [0, 0.98, 0.05, 1.0, 0.5, 2.32],
    wheels: {
      radius: 0.42, rest: 0.38, stiffness: 62000, damping: 5600,
      x: 0.86, z: [-1.45, 1.38], steer: [true, false], drive: [true, true], maxSteer: deg(34),
    },
    // Triebwerk (drivetrain.js): Benziner mit Wandlerautomatik 4/1, Allrad; sprocketR = Radradius
    engine: {
      idleRpm: 800, ratedRpm: 5000, cutRpm: 5400, cruiseRpm: 4200,
      torque: [[700, 160], [800, 190], [1500, 250], [2500, 290], [3500, 280], [4500, 230], [5000, 190], [5400, 0]],
      gears: { '-1': 5.6, 1: 5.28, 2: 3.42, 3: 2.22, 4: 1.44 },
      finalDrive: 5.0, sprocketR: 0.42, efficiency: 0.85, rotInertia: 1.08,
      converter: { stallRpm: 2000, mult: 1.9, coupleRpm: 1800 }, torqueLag: 0.15, shiftTime: 0.25, autoUp: 4700, autoDown: 2000,
      engineBrake: [25, 0.012],
      rollRes: { concrete: 0.015, tile: 0.015, wood: 0.02, metal: 0.015, dirt: 0.035, grass: 0.045, sand: 0.09, default: 0.025 },
      traction: { concrete: 1.0, tile: 0.95, wood: 0.85, metal: 0.8, dirt: 0.8, grass: 0.7, sand: 0.6, default: 0.9 }, // Faktor auf grip.long
      airRes: 1.6, brake: 30000, maxSpeed: 30.5, reverseSpeed: 8.6,
    },
    grip: { long: 1.15, lat: 1.15, handbrakeLat: 0.32, rollInfluence: 0.18 },
    drag: 0.45, angularDamp: 1.4,
    mgPivot: [0, 1.88, 0.42],
    mgMuzzle: [0, 0.1, -1.15],
    mgLimits: { min: deg(-14), max: deg(42) },
    zones: {
      hull: { label: 'Karosserie', hp: 350 },
      engine: { label: 'Motor', hp: 140 },
      tracks: { label: 'Räder', hp: 160 },
    },
    seats: [
      {
        id: 'driver', label: 'Fahrer', drive: true, weapons: [], exposed: true, pos: [-0.46, 0.62, -0.1],
        exit: [[-2.0, 0, -0.1], [2.0, 0, -0.1], [0, 0, -3.4], [0, 0, 3.4]],
        views: [{ id: 'sitz', label: 'Sitz', space: 'hull', pos: [-0.46, 1.62, -0.05], look: 'rel', yaw: [-2.1, 2.1], pitch: [-0.7, 0.75], zoom: [1], exposed: true }, { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 8, height: 3.3, pivot: 1.6 } }],
      },
      {
        id: 'gunner', label: 'MG-Schütze', weapons: ['jeep_mg'], mount: 'mg', exposed: true, pos: [0, 0.98, 0.95],
        exit: [[2.0, 0, 0.9], [-2.0, 0, 0.9], [0, 0, 3.4]],
        views: [{ id: 'mg', label: 'MG', space: 'mg', pos: [0, 0.34, 0.62], look: 'mount', zoom: [1, 2], exposed: true }, { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 7.5, height: 3.6, pivot: 2.0 } }],
      },
      {
        id: 'passenger', label: 'Beifahrer', weapons: [], exposed: true, pos: [0.46, 0.62, -0.1],
        exit: [[2.0, 0, -0.1], [-2.0, 0, -0.1], [0, 0, -3.4]],
        views: [{ id: 'sitz', label: 'Sitz', space: 'hull', pos: [0.46, 1.62, -0.05], look: 'rel', yaw: [-2.1, 2.1], pitch: [-0.7, 0.75], zoom: [1], exposed: true }, { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 8, height: 3.3, pivot: 1.6 } }],
      },
      {
        id: 'rear', label: 'Rücksitz', weapons: [], exposed: true, pos: [0.52, 0.72, 1.5],
        exit: [[2.0, 0, 1.4], [-2.0, 0, 1.4], [0, 0, 3.4]],
        views: [{ id: 'sitz', label: 'Sitz', space: 'hull', pos: [0.52, 1.7, 1.55], look: 'rel', yaw: [-2.1, 2.1], pitch: [-0.7, 0.75], zoom: [1], exposed: true }, { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 8, height: 3.3, pivot: 1.6 } }],
      },
    ],
    lights: [[-0.66, 1.08, -2.3], [0.66, 1.08, -2.3]],
  },

  // Panzergenerationen (Nutzer 11.10.) – frei erfundene Fahrzeuge, Aufbau wie der KP-1 (Sitz-/Sichtformat, Ladeablauf).
  // Granaten heißen intern weiter mbt_ap/mbt_he (Sorte PG/SG); Kaliber und Werte je Panzer über weaponMods.
  // cmgHull: zweites MG sitzt in der Wanne (Kugelstand, Gier/Nicken mit cmgLimits) statt auf dem Turm.

  // 2. Weltkrieg, Team A: mittlerer Panzer nach amerikanischem Vorbild 1944 (~30 t, schräge Bugplatte, runder Gussturm,
  // Laufwerk mit drei Federböcken je Seite, kurze 75-mm-Kanone, Bug-MG rechts) mit fünf Mann; schnell, schnell geladen
  wk2: {
    id: 'wk2', name: 'MP-4 Bison', cls: 'Mittlerer Panzer', era: 'wk2', drive: 'tracked', model: 'wk2', sound: 'tank',
    health: 760, armored: true, respawn: 75, wreckTime: 20, noThermal: true,
    smallArmsMult: 0, explosiveMult: 0.45, ramMult: 0.25,
    mass: 26000, com: [0, 0.8, 0.15],
    hullBox: [0, 0.98, 0.05, 1.45, 0.56, 2.95],
    turretBox: [0, 0.4, 0.2, 0.98, 0.4, 1.2],
    turretPivot: [0, 1.54, -0.15],
    gunPivot: [0, 0.38, -1.05],
    muzzle: [0, 0, -3.4],
    coax: [0.3, 0.02, -0.5],
    cmgHull: true, cmgPivot: [0.62, 1.24, -2.5], cmgMuzzle: [0, 0, -0.62],
    cmgLimits: { yaw: [-0.45, 0.45], pitch: [-0.17, 0.3] },
    gunLimits: { min: deg(-8), max: deg(20) },
    traverse: deg(24), elevate: deg(12),
    wheels: { radius: 0.3, rest: 0.4, stiffness: 230000, damping: 26000, x: 1.12, z: [-2.1, -1.05, 0, 1.05, 2.1] },
    engine: {
      idleRpm: 600, ratedRpm: 3000, cutRpm: 3150, cruiseRpm: 2600,
      torque: [[500, 900], [600, 1050], [1000, 1350], [1600, 1500], [2200, 1500], [2600, 1420], [3000, 1300], [3150, 0]],
      gears: { '-2': 2.55, '-1': 5.9, 1: 6.4, 2: 4.1, 3: 2.6, 4: 1.65, 5: 1.05 },
      finalDrive: 8.1, sprocketR: 0.3, efficiency: 0.75, rotInertia: 1.15,
      converter: { stallRpm: 1500, mult: 1.6, coupleRpm: 1450 },
      torqueLag: 0.2, shiftTime: 0.6, autoUp: 2800, autoDown: 1400,
      engineBrake: [150, 0.2],
      rollRes: { concrete: 0.03, tile: 0.03, wood: 0.035, metal: 0.03, dirt: 0.045, grass: 0.05, sand: 0.08, default: 0.04 },
      traction: { concrete: 0.75, tile: 0.7, wood: 0.6, metal: 0.55, dirt: 0.85, grass: 0.7, sand: 0.6, default: 0.8 },
      airRes: 3.0, neutralDrag: 10000,
      brake: 170000, turnRate: 0.75, turnRateMoving: 0.58, latAccMax: 4.2,
      maxSpeed: 11.1, reverseSpeed: 4.6,
    },
    grip: { long: 1.0, lat: 0.95, latTurning: 0.55, rollInfluence: 0.25 },
    drag: 0.9, angularDamp: 2.2,
    zones: {
      hull: { label: 'Wanne', hp: 760 },
      engine: { label: 'Motor', hp: 200 },
      tracks: { label: 'Ketten', hp: 180 },
      turret: { label: 'Turm', hp: 230 },
    },
    seats: [
      {
        id: 'driver', label: 'Fahrer', drive: true, weapons: [],
        pos: [-0.5, 0.5, -1.95], exit: [[-2.4, 0, -1.4], [2.4, 0, -1.4], [0, 0, -3.9], [0, 0, 3.9]],
        views: [
          { id: 'sehklappe', label: 'Winkelspiegel', space: 'hull', pos: [-0.5, 1.5, -2.05], look: 'rel', yaw: [-0.45, 0.45], pitch: [-0.2, 0.2], zoom: [1.2], overlay: 'slit' },
          { id: 'luke', label: 'Luke offen', space: 'hull', pos: [-0.5, 2.0, -2.0], look: 'rel', yaw: [-2.6, 2.6], pitch: [-0.6, 0.8], zoom: [1, 1.8], exposed: true, hatch: 'driver', pin: [-0.5, 0.82, -2.0] },
          { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 9.5, height: 4.1, pivot: 2.3 } },
        ],
      },
      {
        id: 'gunner', label: 'Richtschütze', weapons: ['mbt_ap', 'mbt_he', 'wk2_mg'], mount: 'gun',
        pos: [0.4, 0.7, -0.3], exit: [[2.4, 0, -0.3], [-2.4, 0, -0.3], [0, 0, 3.9], [0, 0, -3.9]],
        views: [
          { id: 'optik', label: 'Zielfernrohr', space: 'gun', pos: [0.32, 0.44, -1.0], look: 'mount', zoom: [2.5, 5], overlay: 'optic' },
          { id: 'weit', label: 'Weitwinkel', space: 'gun', pos: [0.32, 0.44, -1.0], look: 'mount', zoom: [1.2], overlay: 'wide' },
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [0.4, 0.5, -0.6], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 9.5, height: 4.1, pivot: 2.3 } },
        ],
      },
      {
        id: 'funker', label: 'Funker (Bug-MG)', weapons: ['wk2_mg'], mount: 'cmg',
        pos: [0.55, 0.5, -1.95], exit: [[2.4, 0, -1.4], [-2.4, 0, -1.4], [0, 0, -3.9]],
        views: [
          { id: 'kugel', label: 'Kugelblende', space: 'cupola', pos: [0, 0.13, 0.42], look: 'mount', zoom: [1.4, 2.2], overlay: 'wide' },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 9, height: 3.8, pivot: 2.0 } },
        ],
      },
      {
        id: 'commander', label: 'Kommandant', weapons: [],
        pos: [-0.45, 0.85, 0.35], exit: [[-2.4, 0, 0.4], [2.4, 0, 0.4], [0, 0, 3.9]],
        views: [
          { id: 'kuppel', label: 'Kommandantenkuppel', space: 'turret', pos: [-0.45, 0.98, 0.45], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.35, 0.4], zoom: [1, 2], overlay: 'peri' },
          { id: 'luke', label: 'Luke offen', space: 'turret', pos: [-0.45, 1.45, 0.5], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.6, 0.8], zoom: [1, 4, 7], overlay: 'binocular', exposed: true, hatch: 'commander', pin: [-0.45, 0.3, 0.45] },
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [-0.45, 0.56, 0.45], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 9.5, height: 4.2, pivot: 2.4 } },
        ],
      },
      {
        id: 'loader', label: 'Ladeschütze', loader: true, weapons: [],
        pos: [0.5, 0.75, 0.35], exit: [[2.4, 0, 0.4], [-2.4, 0, 0.4], [0, 0, 3.9]],
        views: [
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [0.55, 0.58, 0.55], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], overlay: 'loader', interior: true },
          { id: 'luke', label: 'Luke offen', space: 'turret', pos: [0.5, 1.3, 0.45], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.6, 0.8], zoom: [1, 2], exposed: true, hatch: 'loader', pin: [0.5, 0.1, 0.45] },
          { id: 'aussen', label: 'Außenansicht', look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 9.5, height: 4.2, pivot: 2.4 } },
        ],
      },
    ],
    hatches: {
      driver: { space: 'hull', pos: [-0.5, 1.56, -2.0], r: 0.28 },
      commander: { space: 'turret', pos: [-0.45, 0.98, 0.45], r: 0.3 },
      loader: { space: 'turret', pos: [0.5, 0.82, 0.45], r: 0.27 },
    },
    // Innenraum: Aufbau des KP-1 (Lage im Turmraum um shift verschoben → Verschluss 0,7 m hinter dem Schildzapfen)
    // Munition im Wannenboden unter dem Turmkorb in wassergefüllten Behältern (Nasslagerung wie beim Vorbild), Spitzen nach oben
    interior: { shift: [0, -0.04, 0.2], breech: [0, 0.42, -0.55], loaderEye: [0.55, 0.62, 0.35], rack: [0.15, -0.3, 0.75], rackRot: [Math.PI / 2, 0], wet: true },
    crew: { switchTime: 1.3, faceTol: 0.6 },
    ammo: { mbt_ap: 30, mbt_he: 40 },
    lights: [[-0.95, 1.12, -2.98], [0.95, 1.12, -2.98]],
    weaponMods: {
      mbt_ap: { name: '75 mm Panzergranate (PG)', speed: 620, vehicleDamage: 195, actorDamage: 190, reload: 3.6, reloadNoLoader: 6.5, splash: { radius: 2.0, maxDamage: 80 }, shake: 0.4 },
      mbt_he: { name: '75 mm Sprenggranate (SG)', speed: 460, vehicleDamage: 120, actorDamage: 185, reload: 3.6, reloadNoLoader: 6.5, splash: { radius: 7.0, maxDamage: 160, innerRadius: 1.5, minDamage: 20 }, shake: 0.4 },
    },
  },

  // 1. Weltkrieg, Team B: schwerer Sturmpanzerwagen nach deutschem Vorbild 1918 (~30 t, Kastenaufbau, 57-mm-Bugkanone mit begrenztem Schwenkbereich,
  // MG im Kugelstand, Beobachtungsstand auf dem Dach) mit sechs Mann – inkl. Mechaniker (repariert schneller)
  wk1: {
    id: 'wk1', name: 'SK-18 Koloss', cls: 'Sturmpanzerwagen', era: 'wk1', drive: 'tracked', model: 'wk1', sound: 'tank',
    health: 820, armored: true, respawn: 75, wreckTime: 20, noThermal: true,
    smallArmsMult: 0, explosiveMult: 0.6, ramMult: 0.2,
    mass: 30000, com: [0, 1.0, 0.1],
    hullBox: [0, 1.4, 0, 1.55, 1.05, 3.6],
    turretBox: [0, 0, -0.18, 0.55, 0.45, 0.32], // Bugkanone mit Schild (der „Turm“ schwenkt nur ±40°)
    turretPivot: [0, 1.48, -3.48],
    turretLimits: [-0.7, 0.7],
    gunPivot: [0, 0, -0.12],
    muzzle: [0, 0, -1.55],
    coax: [0, 0, -0.6],
    cmgHull: true, cmgPivot: [-1.05, 1.7, -3.62], cmgMuzzle: [0, 0, -0.8],
    cmgLimits: { yaw: [-0.35, 1.5], pitch: [-0.22, 0.35] },
    gunLimits: { min: deg(-8), max: deg(14) },
    traverse: deg(18), elevate: deg(9),
    wheels: { radius: 0.24, rest: 0.34, stiffness: 330000, damping: 38000, x: 1.22, z: [-2.6, -1.3, 0, 1.3, 2.6] },
    engine: {
      idleRpm: 450, ratedRpm: 1400, cutRpm: 1500, cruiseRpm: 1250,
      torque: [[400, 1050], [450, 1200], [800, 1500], [1100, 1580], [1400, 1500], [1500, 0]],
      gears: { '-2': 2.6, '-1': 5.0, 1: 5.0, 2: 3.0, 3: 1.8 },
      finalDrive: 6.5, sprocketR: 0.35, efficiency: 0.7, rotInertia: 1.2,
      converter: { stallRpm: 900, mult: 1.5, coupleRpm: 850 },
      torqueLag: 0.3, shiftTime: 0.9, autoUp: 1300, autoDown: 700,
      engineBrake: [180, 0.3],
      rollRes: { concrete: 0.03, tile: 0.03, wood: 0.035, metal: 0.03, dirt: 0.045, grass: 0.05, sand: 0.08, default: 0.04 },
      traction: { concrete: 0.75, tile: 0.7, wood: 0.6, metal: 0.55, dirt: 0.85, grass: 0.7, sand: 0.6, default: 0.8 },
      airRes: 4.0, neutralDrag: 12000,
      brake: 200000, turnRate: 0.36, turnRateMoving: 0.3, latAccMax: 2.5,
      maxSpeed: 4.4, reverseSpeed: 3.0,
    },
    grip: { long: 1.0, lat: 0.95, latTurning: 0.6, rollInfluence: 0.3 },
    drag: 0.9, angularDamp: 2.4,
    zones: {
      hull: { label: 'Wanne', hp: 820 },
      engine: { label: 'Motor', hp: 220 },
      tracks: { label: 'Ketten', hp: 200 },
      turret: { label: 'Bugkanone', hp: 200 },
    },
    seats: [
      {
        id: 'driver', label: 'Fahrer', drive: true, weapons: [],
        pos: [-0.35, 1.7, -1.3], exit: [[-2.5, 0, -1.0], [2.5, 0, -1.0], [0, 0, -4.7], [0, 0, 4.7]],
        views: [
          { id: 'sehschlitz', label: 'Sehschlitz', space: 'hull', pos: [-0.35, 2.78, -1.45], look: 'rel', yaw: [-0.5, 0.5], pitch: [-0.25, 0.2], zoom: [1.1], overlay: 'slit' },
          { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 12, height: 5.4, pivot: 3.0 } },
        ],
      },
      {
        id: 'gunner', label: 'Richtschütze', weapons: ['mbt_ap', 'mbt_he'], mount: 'gun',
        pos: [0.3, 0.75, -2.75], exit: [[2.5, 0, -2.2], [-2.5, 0, -2.2], [0, 0, -4.7], [0, 0, 4.7]],
        views: [
          { id: 'optik', label: 'Zielfernrohr', space: 'gun', pos: [0.26, 0.16, 0.3], look: 'mount', zoom: [1.8, 3], overlay: 'optic' },
          { id: 'weit', label: 'Visier', space: 'gun', pos: [0.26, 0.16, 0.3], look: 'mount', zoom: [1.1], overlay: 'wide' },
          { id: 'innen', label: 'Kampfraum', space: 'turret', pos: [0.3, 0.12, 0.8], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 12, height: 5.4, pivot: 3.0 } },
        ],
      },
      {
        id: 'mg', label: 'MG-Schütze', weapons: ['wk1_mg'], mount: 'cmg',
        pos: [-1.0, 0.75, -2.9], exit: [[-2.5, 0, -2.2], [2.5, 0, -2.2], [0, 0, -4.7]],
        views: [
          { id: 'kugel', label: 'Kugelstand', space: 'cupola', pos: [0, 0.12, 0.48], look: 'mount', zoom: [1.1, 1.8], overlay: 'wide' },
          { id: 'innen', label: 'Kampfraum', space: 'turret', pos: [-0.85, 0.12, 0.65], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 11, height: 5.0, pivot: 2.8 } },
        ],
      },
      {
        id: 'loader', label: 'Ladeschütze', loader: true, weapons: [],
        pos: [0.5, 0.75, -2.4], exit: [[2.5, 0, -1.6], [-2.5, 0, -1.6], [0, 0, 4.7]],
        views: [
          { id: 'innen', label: 'Kampfraum', space: 'turret', pos: [0.55, 0.2, 1.33], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], overlay: 'loader', interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 12, height: 5.4, pivot: 3.0 } },
        ],
      },
      {
        id: 'commander', label: 'Kommandant', weapons: [],
        pos: [0.35, 1.7, -1.0], exit: [[2.5, 0, -0.6], [-2.5, 0, -0.6], [0, 0, 4.7]],
        views: [
          { id: 'stand', label: 'Beobachtungsstand', space: 'hull', pos: [0.35, 2.8, -1.2], look: 'rel', yaw: [-Math.PI, Math.PI], pitch: [-0.35, 0.35], zoom: [1, 2.5], overlay: 'peri' },
          { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 12, height: 5.4, pivot: 3.0 } },
        ],
      },
      {
        id: 'mechaniker', label: 'Mechaniker', mechanic: true, weapons: [],
        pos: [0, 0.75, 1.6], exit: [[2.5, 0, 1.6], [-2.5, 0, 1.6], [0, 0, 4.7]],
        views: [
          { id: 'sehschlitz', label: 'Sehschlitz', space: 'hull', pos: [0, 2.05, 2.2], look: 'rel', yaw: [-1.6, 1.6], pitch: [-0.3, 0.25], zoom: [1], overlay: 'slit' },
          { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 12, height: 5.4, pivot: 3.0 } },
        ],
      },
    ],
    hatches: {},
    // Innenraum: Aufbau des KP-1 hinter die Bugkanone verschoben (Verschluss 0,6 m hinter dem Schildzapfen)
    // Granatgestell an der linken Seitenwand des Kampfraums (1. WK)
    interior: { shift: [0, -0.42, 0.98], breech: [0, 0.42, -0.55], loaderEye: [0.55, 0.62, 0.35], rack: [-0.95, 0.45, 0.35], rackRot: [0, -Math.PI / 2] },
    crew: { switchTime: 1.6, faceTol: 0.6 },
    ammo: { mbt_ap: 20, mbt_he: 40 },
    lights: [[-0.75, 1.95, -3.62], [0.75, 1.95, -3.62]],
    weaponMods: {
      mbt_ap: { name: '57 mm Panzergranate (PG)', speed: 480, life: 2.4, vehicleDamage: 150, actorDamage: 170, reload: 4.5, reloadNoLoader: 8.0, splash: { radius: 1.8, maxDamage: 70 }, shake: 0.32 },
      mbt_he: { name: '57 mm Sprenggranate (SG)', speed: 400, life: 2.6, vehicleDamage: 90, actorDamage: 160, reload: 4.5, reloadNoLoader: 8.0, splash: { radius: 5.5, maxDamage: 130, innerRadius: 1.2, minDamage: 15 }, shake: 0.3 },
    },
  },

  // 2. Weltkrieg, Team B: schwerer Panzer nach deutschem Vorbild 1942 (~57 t): senkrechte, dicke Bugplatte, Schachtel-
  // laufwerk mit großen, verschachtelten Laufrollen, breite Ketten, hufeisenförmiger Turm mit Staukasten, lange 88-mm-Kanone
  // mit Doppelkammer-Mündungsbremse. Munition in den Seitenkästen der Wanne über den Ketten. Langsam, schwer, starker Schuss.
  wk2h: {
    id: 'wk2h', name: 'SP-6 Moloch', cls: 'Schwerer Panzer', era: 'wk2', drive: 'tracked', model: 'wk2h', sound: 'tank',
    health: 980, armored: true, respawn: 85, wreckTime: 20, noThermal: true,
    smallArmsMult: 0, explosiveMult: 0.35, ramMult: 0.18,
    mass: 52000, com: [0, 0.9, 0.1],
    hullBox: [0, 1.15, 0, 1.75, 0.7, 3.15],
    turretBox: [0, 0.44, 0.25, 1.1, 0.44, 1.4],
    turretPivot: [0, 1.86, -0.25],
    gunPivot: [0, 0.42, -1.05],
    muzzle: [0, 0, -4.3],
    coax: [0.28, 0.04, -0.4],
    cmgHull: true, cmgPivot: [0.62, 1.45, -3.16], cmgMuzzle: [0, 0, -0.62],
    cmgLimits: { yaw: [-0.4, 0.4], pitch: [-0.17, 0.26] },
    gunLimits: { min: deg(-8), max: deg(15) },
    traverse: deg(14), elevate: deg(8),
    wheels: { radius: 0.4, rest: 0.42, stiffness: 460000, damping: 52000, x: 1.32, z: [-2.3, -1.15, 0, 1.15, 2.3] },
    engine: {
      idleRpm: 600, ratedRpm: 3000, cutRpm: 3150, cruiseRpm: 2500,
      torque: [[500, 1450], [600, 1700], [1000, 2150], [1600, 2400], [2200, 2400], [2600, 2280], [3000, 2080], [3150, 0]],
      gears: { '-2': 2.55, '-1': 5.9, 1: 6.4, 2: 4.1, 3: 2.6, 4: 1.65, 5: 1.05 },
      finalDrive: 9.0, sprocketR: 0.3, efficiency: 0.72, rotInertia: 1.5,
      converter: { stallRpm: 1500, mult: 1.6, coupleRpm: 1450 },
      torqueLag: 0.25, shiftTime: 0.75, autoUp: 2800, autoDown: 1400,
      engineBrake: [300, 0.2],
      rollRes: { concrete: 0.03, tile: 0.03, wood: 0.035, metal: 0.03, dirt: 0.045, grass: 0.05, sand: 0.08, default: 0.04 },
      traction: { concrete: 0.75, tile: 0.7, wood: 0.6, metal: 0.55, dirt: 0.85, grass: 0.7, sand: 0.6, default: 0.8 },
      airRes: 3.6, neutralDrag: 20000,
      brake: 340000, turnRate: 0.55, turnRateMoving: 0.45, latAccMax: 3.6,
      maxSpeed: 10.0, reverseSpeed: 3.8,
    },
    grip: { long: 1.0, lat: 0.95, latTurning: 0.55, rollInfluence: 0.25 },
    drag: 0.9, angularDamp: 2.4,
    zones: {
      hull: { label: 'Wanne', hp: 980 },
      engine: { label: 'Motor', hp: 230 },
      tracks: { label: 'Ketten', hp: 230 },
      turret: { label: 'Turm', hp: 290 },
    },
    seats: [
      {
        id: 'driver', label: 'Fahrer', drive: true, weapons: [],
        pos: [-0.55, 0.62, -2.3], exit: [[-2.7, 0, -1.6], [2.7, 0, -1.6], [0, 0, -4.2], [0, 0, 4.2]],
        views: [
          { id: 'sehklappe', label: 'Fahrersehklappe', space: 'hull', pos: [-0.55, 1.62, -2.95], look: 'rel', yaw: [-0.45, 0.45], pitch: [-0.2, 0.2], zoom: [1.2], overlay: 'slit' },
          { id: 'luke', label: 'Luke offen', space: 'hull', pos: [-0.55, 2.38, -2.35], look: 'rel', yaw: [-2.6, 2.6], pitch: [-0.6, 0.8], zoom: [1, 1.8], exposed: true, hatch: 'driver', pin: [-0.55, 1.18, -2.35] },
          { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 11, height: 4.8, pivot: 2.7 } },
        ],
      },
      {
        id: 'gunner', label: 'Richtschütze', weapons: ['mbt_ap', 'mbt_he', 'wk2_mg'], mount: 'gun',
        pos: [-0.4, 0.95, -0.45], exit: [[-2.7, 0, -0.4], [2.7, 0, -0.4], [0, 0, 4.2], [0, 0, -4.2]],
        views: [
          { id: 'optik', label: 'Zielfernrohr (Knickfernrohr)', space: 'gun', pos: [-0.3, 0.46, -1.0], look: 'mount', zoom: [2.5, 5], overlay: 'optic' },
          { id: 'weit', label: 'Weitwinkel', space: 'gun', pos: [-0.3, 0.46, -1.0], look: 'mount', zoom: [1.2], overlay: 'wide' },
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [-0.4, 0.5, -0.6], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 11, height: 4.8, pivot: 2.7 } },
        ],
      },
      {
        id: 'funker', label: 'Funker (Bug-MG)', weapons: ['wk2_mg'], mount: 'cmg',
        pos: [0.6, 0.62, -2.3], exit: [[2.7, 0, -1.6], [-2.7, 0, -1.6], [0, 0, -4.2]],
        views: [
          { id: 'kugel', label: 'Kugelblende', space: 'cupola', pos: [0, 0.13, 0.42], look: 'mount', zoom: [1.4, 2.2], overlay: 'wide' },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 10.5, height: 4.4, pivot: 2.4 } },
        ],
      },
      {
        id: 'commander', label: 'Kommandant', weapons: [],
        pos: [-0.5, 1.15, 0.55], exit: [[-2.7, 0, 0.5], [2.7, 0, 0.5], [0, 0, 4.2]],
        views: [
          { id: 'kuppel', label: 'Kommandantenkuppel', space: 'turret', pos: [-0.5, 1.02, 0.7], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.35, 0.4], zoom: [1, 2], overlay: 'peri' },
          { id: 'luke', label: 'Luke offen', space: 'turret', pos: [-0.5, 1.5, 0.75], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.6, 0.8], zoom: [1, 4, 7], overlay: 'binocular', exposed: true, hatch: 'commander', pin: [-0.5, 0.32, 0.7] },
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [-0.45, 0.56, 0.45], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 11, height: 4.9, pivot: 2.8 } },
        ],
      },
      {
        id: 'loader', label: 'Ladeschütze', loader: true, weapons: [],
        pos: [0.5, 1.0, 0.35], exit: [[2.7, 0, 0.5], [-2.7, 0, 0.5], [0, 0, 4.2]],
        views: [
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [0.55, 0.58, 0.55], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], overlay: 'loader', interior: true },
          { id: 'luke', label: 'Luke offen', space: 'turret', pos: [0.5, 1.33, 0.3], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.6, 0.8], zoom: [1, 2], exposed: true, hatch: 'loader', pin: [0.5, 0.12, 0.3] },
          { id: 'aussen', label: 'Außenansicht', look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 11, height: 4.9, pivot: 2.8 } },
        ],
      },
    ],
    hatches: {
      driver: { space: 'hull', pos: [-0.55, 1.92, -2.35], r: 0.27 },
      commander: { space: 'turret', pos: [-0.5, 1.02, 0.7], r: 0.29 },
      loader: { space: 'turret', pos: [0.5, 0.85, 0.3], r: 0.26 },
    },
    // Munition vorn rechts in der Seitenkammer über der Kette: kleiner Behälter, Granaten längs liegend (Boden zum Ladeschützen),
    // tief unten – der Ladeschütze bückt sich nach vorn rechts hinunter
    interior: { shift: [0, 0, 0], breech: [0, 0.42, -0.55], loaderEye: [0.55, 0.62, 0.35], rack: [0.92, 0.3, -0.62], rackRot: [0, Math.PI], rackGrid: [4, 4] },
    crew: { switchTime: 1.4, faceTol: 0.6 },
    ammo: { mbt_ap: 40, mbt_he: 52 },
    lights: [[-1.1, 1.98, -3.05], [1.1, 1.98, -3.05]],
    weaponMods: {
      mbt_ap: { name: '88 mm Panzergranate (PG)', speed: 780, vehicleDamage: 265, actorDamage: 200, reload: 5.2, reloadNoLoader: 9.0, splash: { radius: 2.2, maxDamage: 90 }, shake: 0.5 },
      mbt_he: { name: '88 mm Sprenggranate (SG)', speed: 520, vehicleDamage: 140, actorDamage: 200, reload: 5.2, reloadNoLoader: 9.0, splash: { radius: 7.2, maxDamage: 170, innerRadius: 1.6, minDamage: 22 }, shake: 0.48 },
    },
  },

  // 1. Weltkrieg, Team A: leichter Panzer nach französischem Vorbild 1917 (~7 t) – erster Panzer mit voll drehbarem Turm:
  // hohes Leitrad vorn, Grabenschwanz hinten, genieteter Achteckturm mit Pilz-Lüfterhaube, kurze 37-mm-Kanone. Nur zwei Mann
  // (Fahrer + Kommandant, der selbst richtet und lädt). Munition in Körben am Wannenheck. Klein, wendig, verwundbar.
  wk1l: {
    id: 'wk1l', name: 'LK-17 Libelle', cls: 'Leichter Panzer', era: 'wk1', drive: 'tracked', model: 'wk1l', sound: 'tank',
    health: 520, armored: true, respawn: 50, wreckTime: 18, noThermal: true,
    smallArmsMult: 0, explosiveMult: 0.75, ramMult: 0.4,
    mass: 6500, com: [0, 0.75, 0.05],
    hullBox: [0, 0.95, 0.15, 0.87, 0.6, 2.3],
    turretBox: [0, 0.34, 0, 0.56, 0.34, 0.56],
    turretPivot: [0, 1.55, -0.35],
    gunPivot: [0, 0.3, -0.5],
    muzzle: [0, 0, -0.78],
    coax: [0, 0, -0.3],
    cmgHull: true, cmgPivot: [0, 1.0, -1.2], cmgMuzzle: [0, 0, -0.3],
    cmgLimits: { yaw: [0, 0], pitch: [0, 0] },
    gunLimits: { min: deg(-10), max: deg(20) },
    traverse: deg(30), elevate: deg(14),
    wheels: { radius: 0.2, rest: 0.3, stiffness: 62000, damping: 7500, x: 0.66, z: [-1.3, -0.65, 0, 0.65, 1.3] },
    engine: {
      idleRpm: 450, ratedRpm: 1400, cutRpm: 1500, cruiseRpm: 1250,
      torque: [[400, 300], [450, 340], [800, 420], [1100, 440], [1400, 420], [1500, 0]],
      gears: { '-2': 2.6, '-1': 5.0, 1: 5.0, 2: 3.0, 3: 1.8 },
      finalDrive: 5.1, sprocketR: 0.3, efficiency: 0.7, rotInertia: 0.5,
      converter: { stallRpm: 900, mult: 1.5, coupleRpm: 850 },
      torqueLag: 0.25, shiftTime: 0.8, autoUp: 1300, autoDown: 700,
      engineBrake: [60, 0.3],
      rollRes: { concrete: 0.03, tile: 0.03, wood: 0.035, metal: 0.03, dirt: 0.045, grass: 0.05, sand: 0.08, default: 0.04 },
      traction: { concrete: 0.75, tile: 0.7, wood: 0.6, metal: 0.55, dirt: 0.85, grass: 0.7, sand: 0.6, default: 0.8 },
      airRes: 1.2, neutralDrag: 2600,
      brake: 45000, turnRate: 0.8, turnRateMoving: 0.62, latAccMax: 3.0,
      maxSpeed: 4.8, reverseSpeed: 2.6,
    },
    grip: { long: 1.0, lat: 0.95, latTurning: 0.6, rollInfluence: 0.3 },
    drag: 0.9, angularDamp: 2.2,
    zones: {
      hull: { label: 'Wanne', hp: 520 },
      engine: { label: 'Motor', hp: 140 },
      tracks: { label: 'Ketten', hp: 140 },
      turret: { label: 'Turm', hp: 160 },
    },
    seats: [
      {
        id: 'driver', label: 'Fahrer', drive: true, weapons: [],
        pos: [0, 0.55, -1.2], exit: [[-1.8, 0, -1.0], [1.8, 0, -1.0], [0, 0, -3.0], [0, 0, 3.3]],
        views: [
          { id: 'sehschlitz', label: 'Sehschlitze der Bugklappen', space: 'hull', pos: [0, 1.36, -1.55], look: 'rel', yaw: [-0.55, 0.55], pitch: [-0.25, 0.2], zoom: [1.1], overlay: 'slit' },
          { id: 'aussen', label: 'Außenansicht', look: 'rel', yaw: [-3.1, 3.1], pitch: [-0.7, 0.75], zoom: [1], tp: { dist: 8, height: 3.4, pivot: 1.8 } },
        ],
      },
      {
        id: 'gunner', label: 'Kommandant (richtet und lädt)', weapons: ['mbt_ap', 'mbt_he'], mount: 'gun',
        pos: [0, 0.7, -0.3], exit: [[1.8, 0, -0.3], [-1.8, 0, -0.3], [0, 0, 3.3], [0, 0, -3.0]],
        views: [
          { id: 'optik', label: 'Zielfernrohr', space: 'gun', pos: [0.13, 0.36, -0.42], look: 'mount', zoom: [1.6, 2.6], overlay: 'optic' },
          { id: 'weit', label: 'Sehschlitze', space: 'gun', pos: [0.13, 0.36, -0.42], look: 'mount', zoom: [1.1], overlay: 'wide' },
          { id: 'innen', label: 'Turm innen', space: 'turret', pos: [0, 0.4, 0.12], look: 'relTurret', yaw: [-Math.PI, Math.PI], pitch: [-0.9, 0.5], zoom: [1], interior: true },
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 8, height: 3.5, pivot: 1.9 } },
        ],
      },
    ],
    hatches: {},
    // Kleiner Kampfraum (Aufbau des KP-1 auf 72 % verkleinert); Granatkörbe schräg am Wannenheck hinter dem Kommandanten
    interior: { scale: 0.72, shift: [0, -0.02, 0.06], breech: [0, 0.42, -0.55], breechScale: 0.5, loaderEye: [0, 0.62, 0.35], rack: [0, 0.3, 1.3], rackRot: [0.4, 0] },
    crew: { switchTime: 1.0, faceTol: 0.6 },
    ammo: { mbt_ap: 50, mbt_he: 70 },
    lights: [[-0.42, 1.3, -1.98], [0.42, 1.3, -1.98]],
    weaponMods: {
      mbt_ap: { name: '37 mm Panzergranate (PG)', speed: 380, life: 2.6, vehicleDamage: 110, actorDamage: 150, reload: 2.8, reloadNoLoader: 3.6, splash: { radius: 1.4, maxDamage: 55 }, shake: 0.22 },
      mbt_he: { name: '37 mm Sprenggranate (SG)', speed: 360, life: 2.8, vehicleDamage: 60, actorDamage: 140, reload: 2.8, reloadNoLoader: 3.6, splash: { radius: 4.2, maxDamage: 110, innerRadius: 1.0, minDamage: 12 }, shake: 0.2 },
    },
  },
};

export const VEHICLE_IDS = Object.keys(VEHICLES);

/** Schwerkraft der Fahrzeugsimulation (m/s², etwas „schwerer“ als 9,81 – Fahrzeuge kleben besser). */
export const VEHICLE_GRAVITY = 13;

/** Statische Einfederung (m) aus Masse, Federrate und Radzahl. */
export function staticComp(def) {
  const w = def.wheels;
  return (def.mass * VEHICLE_GRAVITY) / (w.stiffness * w.z.length * 2);
}

/** Aufhängungshöhe: Radunterkante bei statischer Last auf y = 0 (siehe Kopf). */
export function mountY(def) {
  const w = def.wheels;
  return w.rest + w.radius - staticComp(def);
}

/** Wiedererscheinen je Klasse (Plan §6.2): leicht 30 s, Panzer 90 s. */
export function respawnFor(type) {
  return (VEHICLES[type] && VEHICLES[type].respawn) || 45;
}

/** Fahrzeugwaffe eines Typs: Granaten-Kennungen (mbt_ap/mbt_he = Sorte PG/SG im Gestell, Netz, HUD) bleiben gleich,
 *  Kaliber/Geschwindigkeit/Schaden je Generation über def.weaponMods (gleiche id → Netz und Ladeablauf unverändert). */
const _wcache = new Map();
export function vehicleWeapon(type, id) {
  const base = VEHICLE_WEAPONS[id];
  const mod = base && VEHICLES[type] && VEHICLES[type].weaponMods && VEHICLES[type].weaponMods[id];
  if (!mod) return base || null;
  const key = `${type}|${id}`;
  let w = _wcache.get(key);
  if (!w) {
    w = { ...base, ...mod, id: base.id, splash: mod.splash ? { ...base.splash, ...mod.splash } : base.splash };
    _wcache.set(key, w);
  }
  return w;
}

/** Panzergeneration (Raum-/Offline-Einstellung „Panzer“): 'karte' = je Karte (Niemandsland 1. WK), sonst fest.
 *  Je Team ein eigenes Vorbild (Nutzer 11.10.): 2. WK Team A mittlerer, Team B schwerer Panzer; 1. WK Team A leichter
 *  Drehturm-Panzer, Team B schwerer Sturmpanzerwagen. Ohne Team (Jeder gegen jeden) gilt Team A. */
export const TANK_ERAS = { modern: { A: 'mbt', B: 'mbt' }, wk2: { A: 'wk2', B: 'wk2h' }, wk1: { A: 'wk1l', B: 'wk1' } };
export const MAP_TANK_ERA = { niemandsland: 'wk1' };
export function tankEraOf(era, mapId) {
  const e = era && era !== 'karte' ? era : (MAP_TANK_ERA[mapId] || 'modern');
  return TANK_ERAS[e] ? e : 'modern';
}
export function tankTypeFor(era, mapId, team = 'A') {
  const E = TANK_ERAS[tankEraOf(era, mapId)];
  return E[team === 'B' ? 'B' : 'A'];
}
