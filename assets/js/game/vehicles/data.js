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
  mbt_ap: {
    id: 'mbt_ap', name: '120 mm Panzergranate', short: 'PG', kind: 'shell',
    speed: 640, gravity: 9.81, reload: 4.2, mag: 1, life: 4,
    vehicleDamage: 300, actorDamage: 220, splash: { radius: 2.6, maxDamage: 95 },
    penetrating: true, shake: 0.55, icon: 'shell',
  },
  mbt_he: {
    id: 'mbt_he', name: '120 mm Sprenggranate', short: 'SG', kind: 'shell',
    speed: 430, gravity: 9.81, reload: 4.2, mag: 1, life: 5,
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
    gunLimits: { min: deg(-8), max: deg(18) },
    traverse: deg(42), elevate: deg(28),
    wheels: {
      radius: 0.36, rest: 0.44, stiffness: 430000, damping: 48000, comp: 0.12,
      x: 1.42, z: [-2.65, -1.32, 0, 1.32, 2.65],
    },
    engine: { force: 120000, maxSpeed: 13, reverseSpeed: 6, brake: 330000, turnRate: 0.95, turnRateMoving: 0.62 },
    grip: { long: 1.0, lat: 0.95, latTurning: 0.55, rollInfluence: 0.25 },
    drag: 0.9, angularDamp: 2.2,
    zones: {
      hull: { label: 'Wanne', hp: 1000 },
      engine: { label: 'Motor', hp: 260 },
      tracks: { label: 'Ketten', hp: 220 },
      turret: { label: 'Turm', hp: 300 },
    },
    seats: [
      {
        id: 'driver', label: 'Fahrer/Richtschütze', drive: true, weapons: ['mbt_ap', 'mbt_he', 'mbt_coax'], mount: 'gun',
        exposed: false, pos: [0.0, 1.0, -1.6], exit: [[-2.7, 0, -0.6], [2.7, 0, -0.6], [0, 0, -4.6], [0, 0, 4.6]],
        fp: { space: 'turret', pos: [0.48, 0.66, -1.3], zoom: [1, 3.5, 7] }, tp: { dist: 10.5, height: 3.6, pivot: 2.6 },
      },
      {
        id: 'commander', label: 'Kommandant (MG)', weapons: ['mbt_cmg'], mount: 'cmg',
        exposed: false, pos: [-0.6, 1.4, 0.5], exit: [[2.7, 0, 0.6], [-2.7, 0, 0.6], [0, 0, 4.6]],
        fp: { space: 'cmg', pos: [0, 0.32, 0.55], zoom: [1, 2.5] }, tp: { dist: 9.5, height: 3.8, pivot: 2.8 },
      },
    ],
    lights: [[-1.25, 1.32, -3.62], [1.25, 1.32, -3.62]],
  },

  jeep: {
    id: 'jeep', name: 'GW-4 Steppe', cls: 'Geländewagen', drive: 'wheeled', model: 'jeep', sound: 'car',
    health: 350, armored: false, respawn: 30, wreckTime: 15,
    smallArmsMult: 0.4, explosiveMult: 1.0, ramMult: 1,
    mass: 2400, com: [0, 0.62, 0.05],
    hullBox: [0, 0.98, 0.05, 1.0, 0.5, 2.32],
    wheels: {
      radius: 0.42, rest: 0.38, stiffness: 62000, damping: 5600, comp: 0.1,
      x: 0.86, z: [-1.45, 1.38], steer: [true, false], drive: [true, true], maxSteer: deg(34),
    },
    engine: { force: 15500, maxSpeed: 28, reverseSpeed: 8, brake: 30000 },
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
        fp: { space: 'hull', pos: [-0.46, 1.62, -0.05], free: true }, tp: { dist: 7.5, height: 2.6, pivot: 1.6 },
      },
      {
        id: 'gunner', label: 'MG-Schütze', weapons: ['jeep_mg'], mount: 'mg', exposed: true, pos: [0, 0.98, 0.95],
        exit: [[2.0, 0, 0.9], [-2.0, 0, 0.9], [0, 0, 3.4]],
        fp: { space: 'mg', pos: [0, 0.34, 0.62], zoom: [1, 2] }, tp: { dist: 7.0, height: 2.9, pivot: 2.0 },
      },
      {
        id: 'passenger', label: 'Beifahrer', weapons: [], exposed: true, pos: [0.46, 0.62, -0.1],
        exit: [[2.0, 0, -0.1], [-2.0, 0, -0.1], [0, 0, -3.4]],
        fp: { space: 'hull', pos: [0.46, 1.62, -0.05], free: true }, tp: { dist: 7.5, height: 2.6, pivot: 1.6 },
      },
      {
        id: 'rear', label: 'Rücksitz', weapons: [], exposed: true, pos: [0.52, 0.72, 1.5],
        exit: [[2.0, 0, 1.4], [-2.0, 0, 1.4], [0, 0, 3.4]],
        fp: { space: 'hull', pos: [0.52, 1.7, 1.55], free: true }, tp: { dist: 7.5, height: 2.6, pivot: 1.6 },
      },
    ],
    lights: [[-0.66, 1.08, -2.3], [0.66, 1.08, -2.3]],
  },
};

export const VEHICLE_IDS = Object.keys(VEHICLES);

/** Statische Einfederung → Aufhängungshöhe (siehe Kopf). */
export function mountY(def) {
  const w = def.wheels;
  return w.rest + w.radius - w.comp;
}

/** Wiedererscheinen je Klasse (Plan §6.2): leicht 30 s, Panzer 90 s. */
export function respawnFor(type) {
  return (VEHICLES[type] && VEHICLES[type].respawn) || 45;
}
