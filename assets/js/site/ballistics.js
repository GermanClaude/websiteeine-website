// Duellzeit = Anschlagzeit + Zeit bis zum Abschuss (100 LP, jeder Schuss trifft).
// Nutzt die Helfer aus weapons.data.js; lokale Rückfälle nur, wenn sie fehlen.

const MAX_HEALTH = 100;

function localDamageAt(def, d) {
  if (!def?.damage || d > (def.range ?? Infinity)) return 0;
  const { max, min, rangeStart, rangeEnd } = def.damage;
  if (d <= rangeStart) return max;
  if (d >= rangeEnd) return min;
  return max + (min - max) * ((d - rangeStart) / (rangeEnd - rangeStart));
}
function localShotsToKill(def, d, zone = 'body') {
  const mult = zone === 'head' ? def.headMult || 1 : zone === 'limb' ? def.limbMult || 1 : 1;
  const per = localDamageAt(def, d) * mult * (def.pellets || 1);
  return per > 0 ? Math.max(1, Math.ceil(MAX_HEALTH / per - 1e-9)) : Infinity;
}
function localShotTime(def, i) { return def.rpm > 0 ? (i * 60) / def.rpm : Infinity; }
function localTtk(def, d, zone) {
  const n = localShotsToKill(def, d, zone);
  return Number.isFinite(n) ? Math.round(localShotTime(def, n - 1) * 1000) : Infinity;
}

export function makeBallistics(W) {
  const ttk = typeof W?.ttk === 'function' ? W.ttk : localTtk;
  const shotsToKill = typeof W?.shotsToKill === 'function' ? W.shotsToKill : localShotsToKill;
  const shotTime = typeof W?.shotTime === 'function' ? W.shotTime : localShotTime;
  const ids = () => (W?.WEAPON_IDS || []).filter((id) => W.WEAPONS[id] && W.WEAPONS[id].cls !== 'melee');

  /** Duellzeit in ms (Infinity = außer Reichweite). */
  function duelTime(def, d, zone = 'body') {
    const t = ttk(def, d, zone);
    if (!Number.isFinite(t)) return Infinity;
    return Math.round((def.adsTime || 0) * 1000 + t);
  }

  /** Rangliste auf Distanz d: [{ id, def, ms, shots }], aufsteigend; Unendliche hinten in Datenreihenfolge. */
  function rankAt(d, zone = 'body', { slot = null } = {}) {
    const list = ids()
      .map((id, order) => ({ id, def: W.WEAPONS[id], order }))
      .filter((r) => !slot || r.def.slot === slot)
      .map((r) => ({ ...r, ms: duelTime(r.def, d, zone), shots: shotsToKill(r.def, d, zone) }));
    list.sort((a, b) => {
      const fa = Number.isFinite(a.ms);
      const fb = Number.isFinite(b.ms);
      if (fa && fb) return a.ms - b.ms || a.order - b.order;
      if (fa !== fb) return fa ? -1 : 1;
      return a.order - b.order;
    });
    return list;
  }

  return { duelTime, rankAt, ttk, shotsToKill, shotTime };
}
