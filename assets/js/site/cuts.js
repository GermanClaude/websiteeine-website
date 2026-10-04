// Ruheschnitte aus Daten: Breite ist Reichweite, Stärke ist Schaden (Arsenal, Profil, Duell).
import { clamp } from './fmt.js';

/** Breitenachse einer Waffe: 62 + 0,63 × Reichweitenwert. */
export const cutW = (def) => clamp(62 + 0.63 * (def?.stats?.range ?? 50), 62, 125);
/** Stärkeachse einer Waffe: 100 + 8 × Schadenswert. */
export const cutG = (def) => clamp(100 + 8 * (def?.stats?.damage ?? 50), 100, 900);
