// NULLPUNKT — Schwierigkeitsgrade der Bots: Werte aus modes.data.js (DIFFICULTIES) + abgeleitete
// Größen für Wahrnehmung, Zielen, Taktik. Fairness: keine Sofort-Treffer, keine Sicht durch Wände.
const FALLBACK = {
  rekrut: { reactionTime: 0.85, aimError: 0.07, trackingSpeed: 1.6, burstMin: 2, burstMax: 4, accuracyFalloff: 0.03, grenadeChance: 0.03, strafeChance: 0.15, peekChance: 0.25, headshotChance: 0.04, viewDistance: 45, fov: 100 },
  regulaer: { reactionTime: 0.55, aimError: 0.04, trackingSpeed: 2.6, burstMin: 3, burstMax: 6, accuracyFalloff: 0.02, grenadeChance: 0.08, strafeChance: 0.35, peekChance: 0.4, headshotChance: 0.1, viewDistance: 60, fov: 110 },
  veteran: { reactionTime: 0.35, aimError: 0.022, trackingSpeed: 3.8, burstMin: 4, burstMax: 8, accuracyFalloff: 0.013, grenadeChance: 0.14, strafeChance: 0.55, peekChance: 0.6, headshotChance: 0.18, viewDistance: 80, fov: 120 },
  elite: { reactionTime: 0.22, aimError: 0.012, trackingSpeed: 5.2, burstMin: 5, burstMax: 10, accuracyFalloff: 0.008, grenadeChance: 0.2, strafeChance: 0.7, peekChance: 0.75, headshotChance: 0.28, viewDistance: 100, fov: 130 },
};

// Abgeleitete Werte je Stufe
const DERIVED = {
  rekrut: { senseHz: 4, thinkInterval: 0.42, spotRate: 1.5, damageScale: 0.6, jumpShot: 0, flank: 0.05, cover: 0.35, recoilComp: 2.5, prediction: 0, hearing: 0.75, tapInterval: [0.32, 0.55], retreatHealth: 25, grenadeCook: false, swapToPistol: false, chaseTime: 5 },
  regulaer: { senseHz: 6, thinkInterval: 0.32, spotRate: 2.2, damageScale: 0.78, jumpShot: 0, flank: 0.15, cover: 0.6, recoilComp: 4, prediction: 0.25, hearing: 0.9, tapInterval: [0.22, 0.4], retreatHealth: 32, grenadeCook: false, swapToPistol: false, chaseTime: 7 },
  veteran: { senseHz: 8, thinkInterval: 0.25, spotRate: 3.2, damageScale: 0.9, jumpShot: 0.04, flank: 0.3, cover: 0.8, recoilComp: 6, prediction: 0.55, hearing: 1.05, tapInterval: [0.15, 0.3], retreatHealth: 38, grenadeCook: true, swapToPistol: true, chaseTime: 9 },
  elite: { senseHz: 10, thinkInterval: 0.2, spotRate: 4.5, damageScale: 1.0, jumpShot: 0.12, flank: 0.45, cover: 0.95, recoilComp: 9, prediction: 0.85, hearing: 1.2, tapInterval: [0.11, 0.22], retreatHealth: 42, grenadeCook: true, swapToPistol: true, chaseTime: 11 },
};

export const DIFFICULTY_IDS = Object.keys(FALLBACK);

/** Vollständiges Profil einer Stufe (DIFFICULTIES aus G.data hat Vorrang). */
export function difficultyProfile(id, data = null) {
  const key = FALLBACK[id] ? id : 'regulaer';
  const src = (data && data[key]) || FALLBACK[key];
  const d = { ...FALLBACK[key], ...src };
  const x = DERIVED[key];
  return {
    id: key,
    name: d.name || key,
    reaction: d.reactionTime,
    aimError: d.aimError,
    tracking: d.trackingSpeed,
    burst: [d.burstMin, d.burstMax],
    falloff: d.accuracyFalloff,
    grenadeChance: d.grenadeChance,
    strafeChance: d.strafeChance,
    peekChance: d.peekChance,
    headshotChance: d.headshotChance,
    viewDistance: d.viewDistance,
    fov: (d.fov * Math.PI) / 180,
    ...x,
  };
}
