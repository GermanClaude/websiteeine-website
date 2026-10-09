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
          { id: 'aussen', label: 'Außenansicht', look: 'mount', zoom: [1], tp: { dist: 11, height: 4.7, pivot: 2.6 } },
        ],
      },
      {
        id: 'commander', label: 'Kommandant', weapons: ['mbt_cmg'], mount: 'cmg',
        pos: [-0.6, 0.95, 0.55], exit: [[-2.7, 0, 0.6], [2.7, 0, 0.6], [0, 0, 4.6]],
        views: [
          { id: 'periskop', label: 'Rundblickperiskop', space: 'cupola', pos: [0, 0.32, 0.55], look: 'mount', zoom: [1.5, 4, 8], overlay: 'peri' },
          { id: 'luke', label: 'Luke offen', space: 'turret', pos: [-0.62, 1.45, 0.75], look: 'mount', zoom: [1, 4, 7], overlay: 'binocular', exposed: true, hatch: 'commander', pin: [-0.62, 0.27, 0.62] },
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
    interior: { breech: [0, 0.42, -0.55], rack: [0, 0.45, 1.55], loaderEye: [0.55, 0.62, 0.35] },
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
