// NULLPUNKT — Schwierigkeitsgrade der Bots: Grundwerte aus shared/modes.data.js (DIFFICULTIES, einzige
// Quelle) + abgeleitete Größen für Wahrnehmung, Zielen, Taktik. Fairness: keine Sofort-Treffer, keine
// Sicht durch Wände.
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../../shared/modes.data.js';

// Abgeleitete Werte je Stufe (nur KI-intern, nicht in den geteilten Daten)
const DERIVED = {
  rekrut: { senseHz: 4, thinkInterval: 0.42, spotRate: 1.5, damageScale: 0.6, jumpShot: 0, flank: 0.05, cover: 0.35, recoilComp: 2.5, prediction: 0, hearing: 0.75, tapInterval: [0.32, 0.55], retreatHealth: 25, grenadeCook: false, swapToPistol: false, chaseTime: 5 },
  regulaer: { senseHz: 6, thinkInterval: 0.32, spotRate: 2.2, damageScale: 0.78, jumpShot: 0, flank: 0.15, cover: 0.6, recoilComp: 4, prediction: 0.25, hearing: 0.9, tapInterval: [0.22, 0.4], retreatHealth: 32, grenadeCook: false, swapToPistol: false, chaseTime: 7 },
  veteran: { senseHz: 8, thinkInterval: 0.25, spotRate: 3.2, damageScale: 0.9, jumpShot: 0.04, flank: 0.3, cover: 0.8, recoilComp: 6, prediction: 0.55, hearing: 1.05, tapInterval: [0.15, 0.3], retreatHealth: 38, grenadeCook: true, swapToPistol: true, chaseTime: 9 },
  elite: { senseHz: 10, thinkInterval: 0.2, spotRate: 4.5, damageScale: 1.0, jumpShot: 0.12, flank: 0.45, cover: 0.95, recoilComp: 9, prediction: 0.85, hearing: 1.2, tapInterval: [0.11, 0.22], retreatHealth: 42, grenadeCook: true, swapToPistol: true, chaseTime: 11 },
};

export const DIFFICULTY_IDS = DIFFICULTY_ORDER.filter((id) => DERIVED[id]);

/**
 * Vollständiges Profil einer Stufe. `data` (z. B. G.data.DIFFICULTIES) hat Vorrang vor den importierten
 * DIFFICULTIES; unbekannte Stufen → 'regulaer'.
 */
export function difficultyProfile(id, data = null) {
  const key = DERIVED[id] ? id : 'regulaer';
  const d = { ...DIFFICULTIES[key], ...((data && data[key]) || null) };
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
