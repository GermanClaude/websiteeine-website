// Duellzeit = Anschlagzeit + Zeit, bis die nötigen Treffer sitzen (100 LP).
// Nicht jeder Schuss trifft: Die erwartete Trefferquote je Schuss kommt aus Zielgröße und Entfernung,
// Streuung im Anschlag (adsSpread), menschlichem Zielfehler (wie computeStats in weapons.data.js:
// 0,0025 rad / Vergrößerung) und dem Rückstoß, der bei Dauerfeuer trotz Gegenlenken stehen bleibt
// (Erholung recovery zwischen den Schüssen). Schrot: Anteil der Kugeln im Ziel aus dem Streukegel.
// Nutzt die Helfer aus weapons.data.js; lokale Rückfälle nur, wenn sie fehlen.

const MAX_HEALTH = 100;
/** Halbe Zielbreite (m): Oberkörper bzw. Kopf. */
const TARGET_R = { body: 0.28, head: 0.11, limb: 0.12 };
/** Menschlicher Zielfehler im Anschlag (rad, durch die Vergrößerung geteilt) – wie computeStats. */
const AIM_ERROR = 0.0025;
/** Anteil des Rückstoßes je Schuss, der nach dem Gegenlenken bleibt (Repetierer zielen jeden Schuss neu). */
const RECOIL_LEFT = { auto: 0.4, burst: 0.35, semi: 0.2, bolt: 0, pump: 0 };
/** Mehr Schüsse rechnet das Modell nicht (danach: außer Reichweite). */
const MAX_SHOTS = 200;

function localDamageAt(def, d) {
  if (!def?.damage || d > (def.range ?? Infinity)) return 0;
  const { max, min, rangeStart, rangeEnd } = def.damage;
  if (d <= rangeStart) return max;
  if (d >= rangeEnd) return min;
  return max + (min - max) * ((d - rangeStart) / (rangeEnd - rangeStart));
}
function localShotsToKill(def, d, zone = 'body', pelletsHit = def?.pellets || 1) {
  const mult = zone === 'head' ? def.headMult || 1 : zone === 'limb' ? def.limbMult || 1 : 1;
  const per = localDamageAt(def, d) * mult * pelletsHit;
  return per > 0 ? Math.max(1, Math.ceil(MAX_HEALTH / per - 1e-9)) : Infinity;
}
function localShotTime(def, i) { return def.rpm > 0 ? (i * 60) / def.rpm : Infinity; }
function localTtk(def, d, zone) {
  const n = localShotsToKill(def, d, zone);
  return Number.isFinite(n) ? Math.round(localShotTime(def, n - 1) * 1000) : Infinity;
}

/** Schnittfläche zweier Kreise (Radien r1, r2, Mittelpunktabstand d). */
function lens(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}

export function makeBallistics(W) {
  const ttk = typeof W?.ttk === 'function' ? W.ttk : localTtk;
  const shotsToKill = typeof W?.shotsToKill === 'function' ? W.shotsToKill : localShotsToKill;
  const shotTime = typeof W?.shotTime === 'function' ? W.shotTime : localShotTime;
  const ids = () => (W?.WEAPON_IDS || []).filter((id) => W.WEAPONS[id] && W.WEAPONS[id].cls !== 'melee');

  /**
   * Erwartete Schusszahl bis zum Abschuss auf Distanz d: { hits (nötige Treffer), shots (erwartet abgegeben) }.
   * shots = Infinity: außer Reichweite oder praktisch nicht zu treffen.
   */
  function shotsNeeded(def, d, zone = 'body') {
    const theta = Math.atan((TARGET_R[zone] || TARGET_R.body) / Math.max(0.5, d));
    const pellets = def.pellets || 1;
    if (pellets > 1) {
      // Schrot: Kugeln im Ziel = Fläche des Ziels im Streukegel
      const frac = Math.min(1, (theta / Math.max(1e-6, def.adsSpread || def.hipSpread || 0.05)) ** 2);
      const n = shotsToKill(def, d, zone, pellets * frac);
      return { hits: n, shots: Number.isFinite(n) && n <= MAX_SHOTS ? n : Infinity };
    }
    const hits = shotsToKill(def, d, zone);
    if (!Number.isFinite(hits)) return { hits, shots: Infinity };
    const spread = (def.adsSpread || 0) + AIM_ERROR / Math.max(1, def.adsZoom || 1);
    const rc = def.recoil || {};
    const kick = (rc.vertical || 0) + 0.6 * (rc.horizontal || 0);
    const mode = def.rpm <= 90 ? 'bolt' : def.fireMode;
    const left = RECOIL_LEFT[mode] ?? 0.3;
    const decay = Math.exp(-(rc.recovery || 8) * (60 / Math.max(1, def.rpm)));
    const area = Math.PI * spread * spread;
    let got = 0;
    let drift = 0; // Abweichung des Haltepunkts durch verbliebenen Rückstoß (rad)
    for (let i = 0; i < MAX_SHOTS; i++) {
      got += spread > 0 ? lens(spread, theta, drift) / area : (drift <= theta ? 1 : 0);
      if (got >= hits - 1e-9) return { hits, shots: i + 1 };
      drift = (drift + left * kick * (i === 0 ? rc.firstShotMult || 1 : 1)) * decay;
    }
    return { hits, shots: Infinity };
  }

  /** Zeit bis zum Abschuss in ms mit erwarteter Trefferquote (inkl. Nachladen, wenn das Magazin nicht reicht). */
  function hitTtk(def, d, zone = 'body') {
    const { shots } = shotsNeeded(def, d, zone);
    if (!Number.isFinite(shots)) return Infinity;
    let t = shotTime(def, shots - 1);
    if (def.mag > 0 && shots > def.mag) t += Math.floor((shots - 1) / def.mag) * (def.perShellReload ? def.reloadEmptyTime : def.reloadTime);
    return Math.round(t * 1000);
  }

  /** Duellzeit in ms (Infinity = außer Reichweite). */
  function duelTime(def, d, zone = 'body') {
    const t = hitTtk(def, d, zone);
    if (!Number.isFinite(t)) return Infinity;
    return Math.round((def.adsTime || 0) * 1000 + t);
  }

  /** Rangliste auf Distanz d: [{ id, def, ms, shots (nötige Treffer), fired (erwartete Schüsse) }], aufsteigend. */
  function rankAt(d, zone = 'body', { slot = null } = {}) {
    const list = ids()
      .map((id, order) => ({ id, def: W.WEAPONS[id], order }))
      .filter((r) => !slot || r.def.slot === slot)
      .map((r) => {
        const s = shotsNeeded(r.def, d, zone);
        return { ...r, ms: duelTime(r.def, d, zone), shots: s.hits, fired: s.shots };
      });
    list.sort((a, b) => {
      const fa = Number.isFinite(a.ms);
      const fb = Number.isFinite(b.ms);
      if (fa && fb) return a.ms - b.ms || a.order - b.order;
      if (fa !== fb) return fa ? -1 : 1;
      return a.order - b.order;
    });
    return list;
  }

  /**
   * Beste Waffe für eine Sichtlage: mittlere Duellzeit über die Sichtweiten (z. B. 360 Strahlen eines Standorts).
   * Gegner können auf jedem Strahl zwischen 3 m und der Wand stehen (Viertel, Mitte, drei Viertel); was nicht
   * trifft, zählt als `cap` ms. → [{ id, def, score }] aufsteigend.
   */
  function rankForSightlines(dists, { slot = 'primary', cap = 3000 } = {}) {
    const samples = [];
    for (let i = 0; i < dists.length; i += 4) {
      const L = Math.max(3, dists[i]);
      for (const f of [0.25, 0.5, 0.75]) samples.push(Math.round(3 + (L - 3) * f));
    }
    const memo = new Map();
    return ids()
      .map((id, order) => ({ id, def: W.WEAPONS[id], order }))
      .filter((r) => !slot || r.def.slot === slot)
      .map((r) => {
        let sum = 0;
        for (const d of samples) {
          const k = `${r.id}:${d}`;
          let ms = memo.get(k);
          if (ms === undefined) { ms = duelTime(r.def, d); memo.set(k, ms); }
          sum += Number.isFinite(ms) ? Math.min(cap, ms) : cap;
        }
        return { ...r, score: samples.length ? sum / samples.length : Infinity };
      })
      .sort((a, b) => a.score - b.score || a.order - b.order);
  }

  return { duelTime, hitTtk, shotsNeeded, rankAt, rankForSightlines, ttk, shotsToKill, shotTime };
}
