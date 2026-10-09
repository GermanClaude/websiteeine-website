// NULLPUNKT — Wetter & Tageszeit (atmosphere-weather; Owner: world). Ohne Niederschlag: Klar, Dunst, Morgennebel,
// Bewölkt – dazu Tageszeiten je Karte (MAPS[id].times). Rein datengetrieben: `applyConditions()` leitet aus der
// Kartendefinition (lighting, grade, assets.hdri) eine neue Definition ab, die loadWorld/loadBigWorld statt der
// Originaldefinition benutzen. Standard (Kartenwetter + Kartenzeit) = Originaldefinition unverändert.
//
// Wetter wirkt relativ zum Kartenwetter (`MAPS[id].weatherDefault`): multiplikative Größen (Sonne, Füllicht, Nebel,
// Strahlen, Staub, Bildraum-Strahlen) über das Verhältnis der Tabellenwerte, absolute Größen (Wolken, Dunstband,
// Bodennebel) nur, wenn das Wetter vom Kartenwetter abweicht. Tageszeiten setzen Sonnenstand/-farbe absolut und
// skalieren die Sonnenstärke mit der Luftmasse (f(Höhe)); das HDRI (Umgebungslicht/Himmelsfoto) folgt der Zeit.
import { MOODS, MOOD_FOR_MAP } from '../engine/post/grade.js';

/**
 * Wetter-Tabelle. sun/fill/fog/beams/dust/shafts: Faktoren relativ zu „klar“; ref: Faktor auf die Belichtungs-
 * referenz der Stimmung (dunklere Szenen gelten als „richtig“ belichtet); sky/fogAbs/lut: absolute Werte.
 */
export const WEATHER_FX = Object.freeze({
  klar: {
    sun: 1, fill: 1, fog: 1, beams: 1, dust: 1, shafts: 1, inscatter: 1, ref: 1,
    sky: { coverage: 0.12, density: 0.3, hazeAmount: 0.8, hazeHigh: 0.12 },
  },
  dunst: {
    sun: 0.74, fill: 1.12, fog: 2.6, beams: 1.7, dust: 1.5, shafts: 1.5, inscatter: 1.7, ref: 0.92,
    sky: { coverage: 0.3, density: 0.38, hazeAmount: 1, hazeHigh: 0.24, turbidity: 1.5 },
    fogTint: { toward: 'sun', amount: 0.18 },
    lut: { contrast: -0.05, saturation: 0.93 },
  },
  morgennebel: {
    sun: 0.6, fill: 1.15, fog: 4.6, beams: 2.3, dust: 1.9, shafts: 1.9, inscatter: 2.6, ref: 0.85,
    sky: { coverage: 0.18, density: 0.3, hazeAmount: 1, hazeHigh: 0.34, turbidity: 1.8 },
    // Bodennebel: geringe Skalenhöhe (≈ 6 m), früher Beginn, fast deckend in der Ferne; lineare Nebelweite für
    // Materialien ohne Welt-Shading (Himmelsdunst, Partikel)
    fogAbs: { falloff: 0.16, start: 4, max: 0.97, sunExp: 3, near: 14, far: 200, density: 0.014 },
    fogTint: { toward: '#cfd6dc', amount: 0.55 },
    lut: { contrast: -0.1, saturation: 0.86, blackLevel: 0.008 },
    time: 'morgen', // ohne gewählte Tageszeit: Morgen (falls die Karte ihn anbietet)
  },
  bewoelkt: {
    sun: 0.16, fill: 1.6, fog: 1.6, beams: 0.06, dust: 0.55, shafts: 0.06, inscatter: 0.25, ref: 0.6,
    sky: { coverage: 0.96, density: 0.82, hazeAmount: 0.95, hazeHigh: 0.22, turbidity: 2.2, exposure: 0.72, tint: '#c4c9cf', elevation: 0.42 },
    sunColor: { toward: '#e6ebf2', amount: 0.65 },
    fogTint: { toward: '#a9b0b8', amount: 0.45 },
    hemiTint: { toward: '#c5cbd2', amount: 0.6 },
    hdri: 'abandoned_slipway', hdriSky: false, envTint: '#c9cdd3',
    shadowRadius: 7,
    lut: { contrast: -0.1, saturation: 0.82, temperature: -0.08 },
  },
});

/**
 * Tageszeiten (Sonnenstand absolut). hdri: passendes Foto für Umgebungslicht/Himmel; sky: Preetham-Streuung;
 * fog/hemi: Tönung der Kartenfarben; lut: Temperatur-Verschiebung der Kartenstimmung.
 */
export const TIME_FX = Object.freeze({
  morgen: { elevation: 10, azimuth: 102, sun: '#ffc596', hdri: 'zwartkops_straight_morning', sky: { turbidity: 4.5, rayleigh: 2.1, mieCoefficient: 0.007 }, fog: '#c8ccd6', hemi: '#c3cde0', lut: { temperature: 0.03 } },
  vormittag: { elevation: 36, azimuth: 150, sun: '#fff1dc', hdri: 'zwartkops_straight_morning', sky: { turbidity: 4, rayleigh: 1.5, mieCoefficient: 0.005 }, fog: '#bfcad4', hemi: '#cbd9e8' },
  mittag: { elevation: 58, azimuth: 196, sun: '#fff3e2', hdri: 'old_outdoor_theater', sky: { turbidity: 2.8, rayleigh: 1.1, mieCoefficient: 0.0035 }, fog: '#d3dee8', hemi: '#d6e0ea', lut: { temperature: 0 } },
  nachmittag: { elevation: 30, azimuth: 236, sun: '#ffe4bf', hdri: 'zwartkops_straight_morning', sky: { turbidity: 4, rayleigh: 1.5, mieCoefficient: 0.005 }, fog: '#d2d4d2', hemi: '#d2d8de', lut: { temperature: 0.05 } },
  abend: { elevation: 12, azimuth: 252, sun: '#ffb676', hdri: 'freight_station', sky: { turbidity: 7, rayleigh: 2.4, mieCoefficient: 0.009 }, fog: '#dcb08a', hemi: '#d6c2ad', lut: { temperature: 0.12 } },
});

/**
 * Typische Uhrzeit (Stunde, Ortszeit) je Tageszeit – für „Echtzeit“: gespielt wird die Tageszeit der Karte, die der
 * echten Uhrzeit am nächsten liegt (Sonnenstand der TIME_FX-Einträge: Morgen ≈ 7 Uhr … Abend ≈ 19 Uhr).
 */
export const TIME_HOURS = Object.freeze({ morgen: 7, vormittag: 10, mittag: 12.5, nachmittag: 15.5, abend: 19 });

/**
 * „Echtzeit“ auflösen: Tageszeit der Karte (Kartenzeit `timeDefault` oder eine aus `times`), die `date` (Ortszeit)
 * am nächsten liegt; nachts zählt der Abstand über Mitternacht. → Zeit-Id oder null (= Kartenzeit).
 */
export function realTimePreset(meta, date = new Date()) {
  const m = meta || {};
  const h = date.getHours() + date.getMinutes() / 60;
  const times = (Array.isArray(m.times) ? m.times : []).map((t) => t.id).filter((t) => TIME_FX[t]);
  const cands = [[null, m.timeDefault], ...times.map((t) => [t, t])];
  let best = null, bd = Infinity;
  for (const [id, key] of cands) {
    const th = TIME_HOURS[key];
    if (th == null) continue;
    let d = Math.abs(h - th);
    d = Math.min(d, 24 - d);
    if (d < bd - 1e-9) { bd = d; best = id; }
  }
  return best;
}

const hex = (c) => { const n = parseInt(String(c).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255); };
const toHex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const rad = (d) => (d * Math.PI) / 180;
/** Relative Sonnenstärke nach Höhe (Luftmasse, grob): 0,25 … 1. */
const airmass = (el) => 0.25 + 0.75 * Math.pow(Math.max(0.02, Math.sin(rad(Math.max(el, 1)))), 0.6);

/**
 * Wetter/Tageszeit für eine Karte auflösen. req: { weather: id|'standard'|'zufall'|null,
 * time: id|'standard'|'zufall'|'echtzeit'|null, now?: Date (für 'echtzeit', Standard: jetzt) }
 * → { weather, time (null = Kartenzeit), isDefault, key, realtime }. rnd: Zufallsquelle (Tests).
 * Online löst der Host auf (Zufall/Echtzeit nach seiner Uhr); die Clients bekommen die konkrete Zeit.
 */
export function resolveConditions(meta, req = {}, rnd = Math.random) {
  const m = meta || {};
  const allowed = Array.isArray(m.weathers) && m.weathers.length ? m.weathers.filter((w) => WEATHER_FX[w]) : ['klar'];
  const w0 = WEATHER_FX[m.weatherDefault] ? m.weatherDefault : allowed[0];
  const times = (Array.isArray(m.times) ? m.times : []).map((t) => t.id).filter((t) => TIME_FX[t]);
  let w = req.weather;
  if (w === 'zufall') w = allowed[Math.floor(rnd() * allowed.length)];
  if (!allowed.includes(w)) w = w0;
  let t = req.time;
  const realtime = t === 'echtzeit';
  if (t === 'zufall') { const pool = [null, ...times]; t = pool[Math.floor(rnd() * pool.length)]; }
  else if (realtime) t = realTimePreset(m, req.now instanceof Date ? req.now : new Date());
  if (!times.includes(t)) t = null;
  // Morgennebel ohne gewählte Zeit → Morgen (wenn angeboten bzw. die Karte ohnehin morgens spielt); Echtzeit bleibt
  if (!t && req.time !== 'standard' && !realtime && WEATHER_FX[w].time && times.includes(WEATHER_FX[w].time) && w !== w0) t = WEATHER_FX[w].time;
  return { weather: w, weatherDefault: w0, time: t, timeDefault: m.timeDefault || null, isDefault: w === w0 && !t, key: `${w}|${t || '-'}`, realtime };
}

/**
 * Abgeleitete Kartendefinition (flache Kopien; das Kartenmodul bleibt unverändert).
 * def: Kartenmodul-Default-Export · cond: resolveConditions() · mapId: für die Stimmung (Bildraum-Strahlen)
 */
export function applyConditions(def, cond, mapId) {
  if (!cond || cond.isDefault) return def;
  const W = WEATHER_FX[cond.weather], W0 = WEATHER_FX[cond.weatherDefault] || WEATHER_FX.klar;
  const changed = cond.weather !== cond.weatherDefault;
  const T = cond.time ? TIME_FX[cond.time] : null;
  const L0 = def.lighting;
  const L = {
    ...L0,
    sun: { ...L0.sun }, sky: { ...(L0.sky || {}), clouds: { ...(L0.sky?.clouds || {}) } }, hemi: { ...L0.hemi },
    env: { ...(L0.env || {}) }, fog: { ...L0.fog }, shadow: { ...(L0.shadow || {}) }, atmos: { ...(L0.atmos || {}) },
    probes: L0.probes ? { ...L0.probes } : L0.probes,
  };
  const assets = { ...(def.assets || {}) };
  // ---------------------------------------------------------------- Tageszeit (absolut)
  if (T) {
    const k = airmass(T.elevation) / airmass(L0.sun.elevation);
    L.sun.elevation = T.elevation; L.sun.azimuth = T.azimuth;
    L.sun.color = T.sun;
    L.sun.intensity = L0.sun.intensity * k;
    const fk = Math.sqrt(k); // Himmelslicht folgt schwächer
    L.hemi.intensity *= fk; if (L.hemi.hdriIntensity != null) L.hemi.hdriIntensity *= fk;
    L.env.intensity = (L.env.intensity ?? 0.8) * fk; if (L.env.hdriIntensity != null) L.env.hdriIntensity *= fk;
    Object.assign(L.sky, T.sky);
    // Kartenbelichtung über 1 (Dämmerungsausgleich, z. B. Werk) schwindet mit höherer Sonne
    if ((L0.exposure ?? 1) > 1) L.exposure = 1 + (L0.exposure - 1) * Math.min(1, airmass(L0.sun.elevation) / airmass(T.elevation));
    L.fog.color = mixHex(L0.fog.color, T.fog, 0.6);
    L.hemi.sky = mixHex(L0.hemi.sky, T.hemi, 0.6);
    // Tönungen der Kartenzeit (z. B. Dämmerungsblau im Werk) größtenteils zurücknehmen
    if (L.env.hdriTint) L.env.hdriTint = mixHex(L.env.hdriTint, '#ffffff', 0.7);
    if (L.env.tint) L.env.tint = mixHex(L.env.tint, T.hemi, 0.5);
    if (L.sky.tint) L.sky.tint = mixHex(L.sky.tint, '#ffffff', 0.6);
    if (T.hdri && assets.hdri) assets.hdri = T.hdri;
    // Hof der tiefen Sonne bleibt begrenzt; Mischhimmel (Foto oben) nur bei der Originalzeit
    if (L.sky.hdriBlend && assets.hdri !== def.assets?.hdri) L.sky.hdriBlend = [0.3, 0.6];
  }
  // ---------------------------------------------------------------- Wetter (relativ zum Kartenwetter)
  const r = (k) => (W[k] ?? 1) / (W0[k] ?? 1);
  L.sun.intensity *= r('sun');
  L.hemi.intensity *= r('fill'); if (L.hemi.hdriIntensity != null) L.hemi.hdriIntensity *= r('fill');
  L.env.intensity = (L.env.intensity ?? 0.8) * r('fill'); if (L.env.hdriIntensity != null) L.env.hdriIntensity *= r('fill');
  if (L.sky.hdriIntensity != null) L.sky.hdriIntensity *= Math.sqrt(r('fill'));
  const span = Math.max(20, (L0.fog.far ?? 400) - (L0.fog.near ?? 60));
  if (L.fog.density != null || changed) L.fog.density = (L0.fog.density ?? 1.3 / span) * r('fog');
  L.fog.sun = (L0.fog.sun ?? 0.35) * r('inscatter');
  L.atmos.beams = (L0.atmos?.beams ?? 0.02) * r('beams');
  L.atmos.dust = (L0.atmos?.dust ?? 1) * r('dust');
  if (L0.atmos?.slots != null) L.atmos.slots = L0.atmos.slots * r('beams');
  if (changed) {
    const s = W.sky;
    L.sky.clouds.coverage = s.coverage; L.sky.clouds.density = s.density;
    if (s.elevation != null) L.sky.clouds.elevation = s.elevation;
    L.sky.hazeAmount = s.hazeAmount; L.sky.hazeHigh = s.hazeHigh;
    if (s.turbidity) L.sky.turbidity = (L.sky.turbidity ?? 4) * s.turbidity;
    if (s.exposure) L.sky.exposure = (L.sky.exposure ?? 0.5) * s.exposure;
    if (s.tint) L.sky.tint = s.tint;
    if (W.fogAbs) {
      const a = W.fogAbs;
      L.fog.falloff = a.falloff; L.fog.start = a.start; L.fog.max = a.max; L.fog.sunExp = a.sunExp;
      L.fog.density = Math.max(L.fog.density, a.density); // Bodennebel: Mindestdichte am Boden (dünner Kartendunst)
      L.fog.near = Math.min(L.fog.near ?? a.near, a.near); L.fog.far = Math.min(L.fog.far ?? a.far, a.far);
      if (L.fog.nearFactor != null) L.fog.nearFactor = Math.min(L.fog.nearFactor, 0.06);
      L.fog.farCap = a.far * 2.2; // Großkarte: Sichtweite der Stufe gedeckelt (bigworld)
    } else if (W0.fogAbs) {
      // vom Nebel-Kartenwetter weg: Abstände der Karte bleiben
    } else {
      // dichterer Dunst: lineare Nebelweite mitziehen (Materialien ohne Welt-Shading)
      const f = 1 / Math.sqrt(r('fog'));
      if (L0.fog.far != null) { L.fog.far = L0.fog.far * f; L.fog.near = (L0.fog.near ?? 60) * f; }
    }
    if (W.fogTint) L.fog.color = mixHex(L.fog.color, W.fogTint.toward === 'sun' ? L.sun.color : W.fogTint.toward, W.fogTint.amount);
    if (W.sunColor) L.sun.color = mixHex(L.sun.color, W.sunColor.toward, W.sunColor.amount);
    if (W.hemiTint) L.hemi.sky = mixHex(L.hemi.sky, W.hemiTint.toward, W.hemiTint.amount);
    if (W.hdri && assets.hdri) {
      assets.hdri = W.hdri;
      L.env.hdriTint = W.envTint || L.env.hdriTint;
      L.env.tint = W.envTint || L.env.tint;
      if (W.hdriSky === false) L.sky.hdri = false; // Himmel prozedural (geschlossene Wolkendecke)
    }
    if (W.shadowRadius) L.shadow.radius = W.shadowRadius;
  }
  // ---------------------------------------------------------------- Stimmung (core-render setMood)
  const moodId = def.grade?.mood || MOOD_FOR_MAP[mapId] || 'neutral';
  const M = MOODS[moodId] || MOODS.neutral;
  const g = { ...(def.grade || {}) };
  const baseLut = { ...M.lut, ...(def.grade?.lut || {}) };
  // LUT: Temperatur der Tageszeit absolut (+ Wetter-Verschiebung), Kontrast/Schwarz additiv, Sättigung als Faktor
  const tTemp = T?.lut?.temperature, wl = changed ? W.lut || {} : {};
  if (tTemp != null || Object.keys(wl).length) {
    g.lut = { ...(def.grade?.lut || {}) };
    if (tTemp != null || wl.temperature) g.lut.temperature = (tTemp ?? baseLut.temperature ?? 0) + (wl.temperature || 0);
    if (wl.contrast) g.lut.contrast = Math.max(1, (baseLut.contrast ?? 1.08) + wl.contrast);
    if (wl.saturation) g.lut.saturation = (baseLut.saturation ?? 1) * wl.saturation;
    if (wl.blackLevel) g.lut.blackLevel = (baseLut.blackLevel ?? 0.012) + wl.blackLevel;
  }
  const ex = { ...(def.grade?.exposure || {}) };
  const refK = r('ref') * (T ? Math.max(0.6, Math.min(2, airmass(T.elevation) / airmass(L0.sun.elevation))) : 1);
  if (refK !== 1) ex.ref = (ex.ref ?? M.exposure.ref) * refK;
  if (Object.keys(ex).length) g.exposure = ex;
  g.shafts = (Number.isFinite(def.grade?.shafts) ? def.grade.shafts : M.shafts ?? 0) * r('shafts') * (T ? Math.min(1.4, 0.6 + 0.4 * airmass(L0.sun.elevation) / airmass(T.elevation)) : 1);
  return { ...def, lighting: L, assets, grade: { mood: moodId, ...g }, conditions: cond };
}

/** Lesbare Bezeichnung (Ladebildschirm, Debug): „Dunst · Morgen“. names: { weather: {id: name}, times: [{id,name}] } */
export function conditionsLabel(cond, meta, weatherNames) {
  if (!cond) return '';
  const w = weatherNames?.[cond.weather]?.name || cond.weather;
  const t = cond.time ? (meta?.times || []).find((x) => x.id === cond.time)?.name || cond.time : meta?.timeOfDay || '';
  return [w, t].filter(Boolean).join(' · ');
}
