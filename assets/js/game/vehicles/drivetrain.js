// NULLPUNKT — Triebwerk und Getriebe (docs/planung/panzer-mp.md §A): Motor mit Drehmomentkurve, Wandler, Gänge,
// Achsübersetzung, Motorbremse; Getriebe „Gang halten“ (wie Squad 44) oder Automatik. Zustand in `state`
// (= body.drive), den HUD, Klang und Netz lesen. (Zwischenstand: Schnittstelle steht, Rechnung folgt.)

/** Gangliste eines Fahrzeugs, aufsteigend: z. B. [-2, -1, 0, 1, 2, 3, 4, 5]. */
export function gearList(def) {
  const g = (def && def.engine && def.engine.gears) || {};
  const out = [0];
  for (const k of Object.keys(g)) { const n = +k; if (n && Number.isFinite(n)) out.push(n); }
  return out.sort((a, b) => a - b);
}

/** Anzeigename eines Gangs: 'R2' | 'R1' | 'N' | '1' … (GW-4 mit nur einem Rückwärtsgang: 'R'). */
export function gearName(def, g) {
  if (!g) return 'N';
  if (g > 0) return String(g);
  const list = gearList(def);
  return list[0] === -1 ? 'R' : 'R' + (-g);
}

export class Drivetrain {
  constructor(def) {
    this.def = def;
    this.E = def.engine || {};
    this.gears = gearList(def);
    this.state = {
      gear: 0, targetGear: 0, shifting: false,
      rpm: 0, rpmNorm: 0, throttle: 0,
      gearbox: 'auto', lugging: false, slip: 0,
    };
    this.shiftT = 0;
  }

  /** Schalten: n > 0 hoch, n < 0 runter. → true, wenn ein Schaltvorgang läuft. */
  shift(n) {
    const s = this.state;
    if (!n) return false;
    const i = this.gears.indexOf(s.targetGear);
    const j = Math.max(0, Math.min(this.gears.length - 1, i + Math.sign(n) * Math.abs(n | 0 || 1)));
    if (j === i) return false;
    s.targetGear = this.gears[j];
    s.gear = s.targetGear;
    return true;
  }

  /** Gang sofort setzen (ohne Schaltpause), z. B. N beim Verlassen des Fahrersitzes. */
  setGear(g) {
    const s = this.state;
    s.gear = s.targetGear = this.gears.includes(g) ? g : 0;
    s.shifting = false;
    this.shiftT = 0;
  }

  /** Ein Simulationsschritt (Zwischenstand: keine eigene Rechnung). */
  step() { return 0; }
}
